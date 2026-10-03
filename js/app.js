'use strict';

/* =========================================================
   ZenXpense — web app statica collegata ad Airtable
   ========================================================= */

const CFG = {
  baseId: 'appVPy0GkvpwALILK',
  tables: { mov: 'tbliiUZZUY2iWvRxc', cat: 'tblQI9K1EsdaLxUdP' },
  // Field ID: restano validi anche se i campi vengono rinominati in Airtable.
  f: {
    data: 'fldiEruLrfqe6lTzK',
    descr: 'fldwgENHmKc9lNWnH',
    tipo: 'fldjYAe5zXt96d5tY',
    conto: 'fld09W5bZFIOFs4z8',
    cat: 'fld4g61PAsAePICey',
    importo: 'fldhgb46UG2xz5jXB',
    valuta: 'fldR3nCUQBDG7sxv9',
  },
  fNames: { data: 'data', descr: 'descrizione', tipo: 'tipo', conto: 'conto', cat: 'categoria', importo: 'importo', valuta: 'valuta' },
  catField: 'fldQMO1i7QVLaap7K',
  catFieldName: 'categoria',
};

const LS = {
  token: 'zx.token',
  cache: 'zx.cache.v1',
  last: 'zx.last',
};

/* ---------------- Utility ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function lsGet(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / privata */ }
}
function lsDel(key) { try { localStorage.removeItem(key); } catch { } }

const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const MONTHS_LONG = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

const fmtCache = {};
function money(n, cur = 'EUR', signed = false) {
  const key = cur + signed;
  if (!fmtCache[key]) {
    try {
      fmtCache[key] = new Intl.NumberFormat('it-IT', { style: 'currency', currency: cur || 'EUR', useGrouping: 'always', signDisplay: signed ? 'exceptZero' : 'auto' });
    } catch {
      const nf = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always', signDisplay: signed ? 'exceptZero' : 'auto' });
      fmtCache[key] = { format: v => `${nf.format(v)} ${cur}` };
    }
  }
  return fmtCache[key].format(n);
}
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
function parseAmount(s) {
  s = String(s).trim().replace(/\s|€/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? round2(Math.abs(n)) : NaN;
}

let toastTimer;
function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', isErr);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), isErr ? 4500 : 2200);
}

/* ---------------- Airtable API ---------------- */
const API = {
  get token() { return lsGet(LS.token, ''); },

  async req(path, opts = {}) {
    const url = `https://api.airtable.com/v0/${CFG.baseId}/${path}`;
    for (let attempt = 0; attempt < 5; attempt++) {
      let res;
      try {
        res = await fetch(url, {
          ...opts,
          headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        });
      } catch {
        throw new Error('Connessione assente: impossibile raggiungere Airtable.');
      }
      if (res.status === 429) { await sleep(1200 * (attempt + 1)); continue; }
      if (!res.ok) {
        let detail = '';
        try { const j = await res.json(); detail = typeof j.error === 'string' ? j.error : (j.error?.message || j.error?.type || ''); } catch { }
        if (res.status === 401) throw new Error('Token non valido o scaduto. Controlla le Impostazioni.');
        if (res.status === 403) throw new Error('Il token non ha accesso a questa base o mancano gli scope richiesti.');
        if (res.status === 404) throw new Error('Base o tabella non trovata. Verifica che il token includa la base ZenXpense.');
        throw new Error(`Errore Airtable ${res.status}${detail ? ': ' + detail : ''}`);
      }
      return res.json();
    }
    throw new Error('Troppe richieste ad Airtable, riprova tra qualche secondo.');
  },

  async listAll(table, onProgress) {
    const out = [];
    let offset;
    do {
      const q = new URLSearchParams({ pageSize: '100', returnFieldsByFieldId: 'true' });
      if (offset) q.set('offset', offset);
      const j = await this.req(`${table}?${q}`);
      out.push(...j.records);
      offset = j.offset;
      onProgress?.(out.length);
      if (offset) await sleep(210); // limite Airtable: 5 richieste/s per base
    } while (offset);
    return out;
  },

  create(fields) {
    return this.req(`${CFG.tables.mov}?returnFieldsByFieldId=true`, {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
    }).then(j => j.records[0]);
  },

  update(id, fields) {
    return this.req(`${CFG.tables.mov}/${id}?returnFieldsByFieldId=true`, {
      method: 'PATCH',
      body: JSON.stringify({ fields, typecast: true }),
    });
  },

  remove(id) {
    return this.req(`${CFG.tables.mov}/${id}`, { method: 'DELETE' });
  },
};

function pick(fields, key) {
  return fields[CFG.f[key]] ?? fields[CFG.fNames[key]];
}
function normalize(rec) {
  const f = rec.fields || {};
  const tipo = pick(f, 'tipo');
  return {
    id: rec.id,
    data: pick(f, 'data') || '',
    descr: pick(f, 'descr') || '',
    tipo: (typeof tipo === 'object' && tipo ? tipo.name : tipo) || 'uscita',
    conto: (pick(f, 'conto') || '').trim(),
    cat: (pick(f, 'cat') || '').trim(),
    importo: Number(pick(f, 'importo')) || 0,
    valuta: (pick(f, 'valuta') || 'EUR').trim().toUpperCase(),
  };
}
function toFields(m) {
  return {
    [CFG.f.data]: m.data,
    [CFG.f.descr]: m.descr,
    [CFG.f.tipo]: m.tipo,
    [CFG.f.conto]: m.conto,
    [CFG.f.cat]: m.cat,
    [CFG.f.importo]: m.importo,
    [CFG.f.valuta]: m.valuta,
  };
}

/* ---------------- Store ---------------- */
const store = {
  records: [],
  categories: [],
  syncedAt: null,
  loading: false,
  error: null,
  listeners: new Set(),

  emit() { this.listeners.forEach(fn => fn()); },

  loadCache() {
    const c = lsGet(LS.cache);
    if (c?.records) {
      this.records = c.records;
      this.categories = c.categories || [];
      this.syncedAt = c.syncedAt;
      this.sort();
    }
  },
  saveCache() {
    lsSet(LS.cache, { records: this.records, categories: this.categories, syncedAt: this.syncedAt });
  },
  sort() {
    this.records.sort((a, b) => (b.data || '').localeCompare(a.data || '') || a.descr.localeCompare(b.descr));
  },

  async sync() {
    if (!API.token || this.loading) return;
    this.loading = true; this.error = null; this.emit();
    try {
      const cats = await API.listAll(CFG.tables.cat);
      const recs = await API.listAll(CFG.tables.mov, n => {
        setSync(`Caricamento… ${n}`);
        const el = $('#load-msg'); if (el) el.textContent = `Caricamento movimenti da Airtable… ${n}`;
      });
      this.categories = cats
        .map(r => (r.fields[CFG.catField] ?? r.fields[CFG.catFieldName] ?? '').trim())
        .filter(Boolean);
      this.records = recs.map(normalize);
      this.sort();
      this.syncedAt = Date.now();
      this.saveCache();
    } catch (e) {
      this.error = e.message;
      toast(e.message, true);
    } finally {
      this.loading = false;
      this.emit();
    }
  },

  upsert(m) {
    const i = this.records.findIndex(r => r.id === m.id);
    if (i >= 0) this.records[i] = m; else this.records.push(m);
    this.sort(); this.saveCache(); this.emit();
  },
  drop(id) {
    this.records = this.records.filter(r => r.id !== id);
    this.saveCache(); this.emit();
  },

  // Valori distinti, ordinati per frequenza d'uso
  distinct(key) {
    const counts = new Map();
    for (const r of this.records) if (r[key]) counts.set(r[key], (counts.get(r[key]) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  },
  accounts() { return this.distinct('conto'); },
  currencies() { const c = this.distinct('valuta'); return c.length ? c : ['EUR']; },
  mainCurrency() { return this.currencies()[0] || 'EUR'; },
  allCategories() {
    const set = new Set(this.categories);
    for (const r of this.records) if (r.cat) set.add(r.cat);
    return [...set].sort((a, b) => a.localeCompare(b, 'it'));
  },
};

function setSync(text) {
  const el = $('#sync');
  if (el) el.textContent = text;
}
function syncLabel() {
  if (store.loading) return 'Sincronizzazione…';
  if (!store.syncedAt) return '';
  const d = new Date(store.syncedAt);
  return `Aggiornato ${fmtDate(isoDate(d))} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------------- Periodi ---------------- */
function periodRange(p) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (p) {
    case 'month': return [isoDate(new Date(y, m, 1)), isoDate(new Date(y, m + 1, 0))];
    case 'prev': return [isoDate(new Date(y, m - 1, 1)), isoDate(new Date(y, m, 0))];
    case 'year': return [`${y}-01-01`, `${y}-12-31`];
    case '12m': return [isoDate(new Date(y, m - 11, 1)), isoDate(new Date(y, m + 1, 0))];
    default: return ['', ''];
  }
}
const PERIODS = [['month', 'Questo mese'], ['prev', 'Mese scorso'], ['year', 'Quest\'anno'], ['12m', '12 mesi'], ['all', 'Tutto']];

function inRange(r, from, to) {
  return (!from || r.data >= from) && (!to || r.data <= to);
}
function totals(list) {
  let inc = 0, out = 0;
  for (const r of list) { if (r.tipo === 'entrata') inc += r.importo; else out += r.importo; }
  return { inc: round2(inc), out: round2(out), bal: round2(inc - out), n: list.length };
}

/* ---------------- Router ---------------- */
const views = {};
let currentView = null;

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [path, qs] = h.split('?');
  const parts = path.split('/');
  return { name: parts[0], arg: parts[1] ? decodeURIComponent(parts[1]) : null, params: new URLSearchParams(qs || '') };
}

function route() {
  const r = parseHash();
  let name = r.name;
  if (!API.token && name !== 'impostazioni') { location.hash = '#/impostazioni'; return; }
  if (!views[name]) name = 'dashboard';
  const navName = name === 'modifica' ? 'movimenti' : name;
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === navName));
  currentView = () => views[name](r);
  render();
  $('#view').focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function render() {
  setSync(syncLabel());
  if (!currentView) return;
  $('#view').innerHTML = '';
  currentView();
}

/* ---------------- Componenti ---------------- */
function refreshButton() {
  return `<button class="btn icon-btn ${store.loading ? 'spin' : ''}" data-action="sync" title="Aggiorna dati da Airtable" aria-label="Aggiorna dati">
    <svg viewBox="0 0 24 24"><path d="M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h7V4z"/></svg></button>`;
}
function loadingBlock() {
  return `<div class="loading"><span class="loader"></span><span id="load-msg">Caricamento movimenti da Airtable…</span></div>`;
}
function needsData(view) {
  if (store.records.length) return false;
  if (store.loading) { view.innerHTML += loadingBlock(); return true; }
  if (store.error) { view.innerHTML += `<div class="error-box">${esc(store.error)}</div>`; return true; }
  view.innerHTML += `<div class="empty">Nessun movimento.</div>`;
  return true;
}

/* ---------------- Dashboard ---------------- */
const dashState = { period: 'year', conto: '' };

views.dashboard = () => {
  const v = $('#view');
  const [from, to] = periodRange(dashState.period);
  const label = PERIODS.find(p => p[0] === dashState.period)[1];

  v.innerHTML = `
    <div class="page-head">
      <h1>Home</h1>
      ${refreshButton()}
    </div>
    <div class="chips" role="group" aria-label="Periodo">
      ${PERIODS.map(([k, l]) => `<button class="chip" data-period="${k}" aria-pressed="${k === dashState.period}">${l}</button>`).join('')}
    </div>`;
  if (needsData(v)) return;

  const cur = store.mainCurrency();
  const periodRecs = store.records.filter(r => inRange(r, from, to));
  const mainRecs = periodRecs.filter(r => r.valuta === cur);

  // Riepilogo per conto (e valuta, se diverse)
  const byAcc = new Map();
  for (const r of periodRecs) {
    const key = `${r.conto || '—'}|${r.valuta}`;
    if (!byAcc.has(key)) byAcc.set(key, []);
    byAcc.get(key).push(r);
  }
  const accounts = [...byAcc.entries()]
    .map(([k, list]) => { const [conto, valuta] = k.split('|'); return { conto, valuta, ...totals(list) }; })
    .sort((a, b) => (b.inc + b.out) - (a.inc + a.out));

  // Grafico mensile: ultimi 12 mesi (indipendente dal periodo)
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: MONTHS[d.getMonth()], inc: 0, out: 0 });
  }
  const mIdx = Object.fromEntries(months.map((m, i) => [m.key, i]));
  for (const r of store.records) {
    if (r.valuta !== cur || (dashState.conto && r.conto !== dashState.conto)) continue;
    const i = mIdx[r.data.slice(0, 7)];
    if (i === undefined) continue;
    if (r.tipo === 'entrata') months[i].inc += r.importo; else months[i].out += r.importo;
  }

  // Top categorie di spesa nel periodo
  const catMap = new Map();
  for (const r of mainRecs) {
    if (r.tipo !== 'uscita' || (dashState.conto && r.conto !== dashState.conto)) continue;
    const c = r.cat || 'senza categoria';
    catMap.set(c, (catMap.get(c) || 0) + r.importo);
  }
  const cats = [...catMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const catMax = cats[0]?.[1] || 1;

  v.innerHTML += `
    <div class="section">
      <h2>Riepilogo per conto</h2>
      ${accounts.length ? `<div class="grid accounts">${accounts.map(a => accountCard(a, from, to)).join('')}</div>`
      : `<div class="card empty">Nessun movimento nel periodo selezionato.</div>`}
    </div>

    <div class="grid two-col section">
      <div class="card chart">
        <div class="page-head" style="margin-bottom:8px">
          <h2>Ultimi 12 mesi</h2>
          <select id="dash-conto" style="width:auto;min-height:34px;padding:4px 10px;font-size:13px">
            <option value="">Tutti i conti</option>
            ${store.accounts().map(c => `<option ${c === dashState.conto ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
        ${monthChart(months, cur)}
        <div class="legend"><span><i style="background:var(--in)"></i>Entrate</span><span><i style="background:var(--out)"></i>Uscite</span></div>
      </div>
      <div class="card">
        <h2 style="margin-bottom:12px">Spese per categoria · ${esc(label.toLowerCase())}</h2>
        ${cats.length ? `<div class="bars">${cats.map(([c, val]) => `
          <a class="bar-row" href="#/movimenti?cat=${encodeURIComponent(c)}&dal=${from}&al=${to}${dashState.conto ? '&conto=' + encodeURIComponent(dashState.conto) : ''}">
            <span>${esc(c)}</span><span class="num">${money(val, cur)}</span>
            <span class="track"><i style="width:${(val / catMax * 100).toFixed(1)}%"></i></span>
          </a>`).join('')}</div>` : '<p class="muted">Nessuna spesa nel periodo.</p>'}
      </div>
    </div>`;

  $$('[data-period]', v).forEach(b => b.onclick = () => { dashState.period = b.dataset.period; render(); });
  $('#dash-conto', v).onchange = e => { dashState.conto = e.target.value; render(); };
};

function accountCard(a, from, to) {
  const tot = a.inc + a.out || 1;
  const href = `#/movimenti?conto=${encodeURIComponent(a.conto)}&dal=${from}&al=${to}`;
  return `<a class="card account" href="${href}">
    <div class="account-top">
      <span class="account-name">${esc(a.conto)}</span>
      <span class="muted" style="font-size:12px">${a.n} mov.${a.valuta !== 'EUR' ? ' · ' + esc(a.valuta) : ''}</span>
    </div>
    <div class="account-bal num ${a.bal >= 0 ? 'in' : 'out'}">${money(a.bal, a.valuta, true)}</div>
    <div class="meter" aria-hidden="true"><i style="width:${(a.inc / tot * 100).toFixed(1)}%"></i></div>
    <div class="account-row"><span class="muted">Entrate</span><span class="num in">${money(a.inc, a.valuta)}</span></div>
    <div class="account-row"><span class="muted">Uscite</span><span class="num out">${money(a.out, a.valuta)}</span></div>
  </a>`;
}

function monthChart(months, cur) {
  const W = 600, H = 220, padL = 44, padB = 22, padT = 8;
  const max = Math.max(1, ...months.map(m => Math.max(m.inc, m.out)));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const cw = (W - padL) / months.length;
  const bw = Math.min(14, cw / 2 - 3);
  const y = v => padT + (H - padT - padB) * (1 - v / top);
  const nf = new Intl.NumberFormat('it-IT', { notation: 'compact', maximumFractionDigits: 1 });
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    g += `<line class="grid-line" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${padL - 6}" y="${y(v) + 3}" text-anchor="end">${nf.format(v)}</text>`;
  }
  months.forEach((m, i) => {
    const cx = padL + cw * i + cw / 2;
    const title = `${m.label}: entrate ${money(m.inc, cur)}, uscite ${money(m.out, cur)}`;
    g += `<g><title>${esc(title)}</title>
      <rect x="${cx - bw - 1}" y="${y(m.inc)}" width="${bw}" height="${Math.max(0, y(0) - y(m.inc))}" rx="3" fill="var(--in)"/>
      <rect x="${cx + 1}" y="${y(m.out)}" width="${bw}" height="${Math.max(0, y(0) - y(m.out))}" rx="3" fill="var(--out)"/>
      <rect x="${cx - cw / 2}" y="${padT}" width="${cw}" height="${H - padT - padB}" fill="transparent"/>
      <text class="axis" x="${cx}" y="${H - 6}" text-anchor="middle">${m.label}</text></g>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Entrate e uscite degli ultimi 12 mesi">${g}</svg>`;
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/* ---------------- Movimenti ---------------- */
const listState = { dal: '', al: '', conto: '', cat: '', tipo: '', q: '', limit: 150, open: false, preset: 'all' };

views.movimenti = (r) => {
  const v = $('#view');
  // Filtri passati via URL (es. dalla dashboard)
  if ([...r.params.keys()].length) {
    Object.assign(listState, { dal: '', al: '', conto: '', cat: '', tipo: '', q: '', preset: '' });
    for (const k of ['dal', 'al', 'conto', 'cat', 'tipo', 'q']) if (r.params.get(k)) listState[k] = r.params.get(k);
    listState.limit = 150;
    history.replaceState(null, '', '#/movimenti');
  }

  v.innerHTML = `
    <div class="page-head">
      <h1>Movimenti</h1>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm filters-toggle" data-action="toggle-filters">Filtri${activeFilterCount() ? ` (${activeFilterCount()})` : ''}</button>
        ${refreshButton()}
      </div>
    </div>`;
  if (needsData(v)) return;

  const conti = store.accounts();
  const cats = store.allCategories();
  const s = listState;

  const chip = (key, val, label) =>
    `<button class="chip" data-quick="${key}" data-val="${esc(val)}" aria-pressed="${s[key] === val}">${esc(label)}</button>`;

  v.innerHTML += `
    <div class="quick-filters">
      <div class="quick-chips" role="group" aria-label="Filtro rapido per tipo">
        ${chip('tipo', '', 'Tutti')}${chip('tipo', 'uscita', 'Uscite')}${chip('tipo', 'entrata', 'Entrate')}
      </div>
      <div class="quick-chips" role="group" aria-label="Filtro rapido per conto">
        ${chip('conto', '', 'Tutti i conti')}${conti.map(c => chip('conto', c, c)).join('')}
      </div>
    </div>
    <div class="filters-wrap" data-open="${s.open}">
      <div class="card">
        <div class="filters">
          <div class="full chips" role="group" aria-label="Periodo rapido">
            ${PERIODS.map(([k, l]) => `<button class="chip" data-preset="${k}" aria-pressed="${k === s.preset}">${l}</button>`).join('')}
          </div>
          <label class="field">Dal<input type="date" id="f-dal" value="${s.dal}"></label>
          <label class="field">Al<input type="date" id="f-al" value="${s.al}"></label>
          <label class="field">Conto<select id="f-conto"><option value="">Tutti</option>${conti.map(c => `<option ${c === s.conto ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label class="field">Categoria<select id="f-cat"><option value="">Tutte</option>${cats.map(c => `<option ${c === s.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label class="field">Tipo<select id="f-tipo">
            <option value="">Tutti</option>
            <option value="uscita" ${s.tipo === 'uscita' ? 'selected' : ''}>Uscite</option>
            <option value="entrata" ${s.tipo === 'entrata' ? 'selected' : ''}>Entrate</option>
          </select></label>
          <label class="field search">Cerca<input type="search" id="f-q" placeholder="Descrizione…" value="${esc(s.q)}"></label>
          <div class="full" style="display:flex;justify-content:flex-end">
            <button class="btn btn-sm" data-action="reset-filters">Azzera filtri</button>
          </div>
        </div>
      </div>
    </div>
    <div id="results"></div>`;

  const bind = (id, key, ev = 'change') => {
    $(id, v).addEventListener(ev, e => { s[key] = e.target.value; s.limit = 150; if (key === 'dal' || key === 'al') { s.preset = ''; syncPresetChips(); } syncQuickChips(); renderResults(); updateFilterCount(); });
  };
  bind('#f-dal', 'dal'); bind('#f-al', 'al'); bind('#f-conto', 'conto'); bind('#f-cat', 'cat'); bind('#f-tipo', 'tipo'); bind('#f-q', 'q', 'input');

  $$('[data-quick]', v).forEach(b => b.onclick = () => {
    const key = b.dataset.quick;
    s[key] = b.dataset.val;
    $(key === 'tipo' ? '#f-tipo' : '#f-conto', v).value = s[key];
    s.limit = 150; syncQuickChips(); renderResults(); updateFilterCount();
  });

  $$('[data-preset]', v).forEach(b => b.onclick = () => {
    s.preset = b.dataset.preset;
    [s.dal, s.al] = periodRange(s.preset);
    $('#f-dal', v).value = s.dal; $('#f-al', v).value = s.al;
    s.limit = 150; syncPresetChips(); renderResults(); updateFilterCount();
  });

  renderResults();
};

function syncPresetChips() {
  $$('[data-preset]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preset === listState.preset)));
}
function syncQuickChips() {
  $$('[data-quick]').forEach(b => b.setAttribute('aria-pressed', String(listState[b.dataset.quick] === b.dataset.val)));
}
function activeFilterCount() {
  const s = listState;
  return [s.dal || s.al, s.conto, s.cat, s.tipo, s.q].filter(Boolean).length;
}
function updateFilterCount() {
  const b = $('[data-action="toggle-filters"]');
  if (b) b.textContent = `Filtri${activeFilterCount() ? ` (${activeFilterCount()})` : ''}`;
}
function filtered() {
  const s = listState;
  const q = s.q.trim().toLowerCase();
  return store.records.filter(r =>
    inRange(r, s.dal, s.al) &&
    (!s.conto || r.conto === s.conto) &&
    (!s.cat || r.cat === s.cat) &&
    (!s.tipo || r.tipo === s.tipo) &&
    (!q || r.descr.toLowerCase().includes(q) || r.cat.toLowerCase().includes(q))
  );
}

function renderResults() {
  const box = $('#results');
  if (!box) return;
  const list = filtered();
  const byCur = new Map();
  for (const r of list) { if (!byCur.has(r.valuta)) byCur.set(r.valuta, []); byCur.get(r.valuta).push(r); }
  const sums = [...byCur.entries()].map(([cur, l]) => ({ cur, ...totals(l) }));

  box.innerHTML = `
    <div class="summary">
      <span><b class="num">${list.length}</b> <span class="muted">movimenti</span></span>
      ${sums.map(t => `
        <span><span class="muted">Entrate</span> <b class="num in">${money(t.inc, t.cur)}</b></span>
        <span><span class="muted">Uscite</span> <b class="num out">${money(t.out, t.cur)}</b></span>
        <span><span class="muted">Saldo</span> <b class="num">${money(t.bal, t.cur, true)}</b></span>`).join('')}
    </div>
    ${list.length ? `<div class="list">
      ${list.slice(0, listState.limit).map(rowHtml).join('')}
    </div>
    ${list.length > listState.limit ? `<div class="more"><button class="btn" data-action="more">Mostra altri (${list.length - listState.limit})</button></div>` : ''}`
      : `<div class="card empty">Nessun movimento corrisponde ai filtri.</div>`}`;
}

function rowHtml(r) {
  const [y, m, d] = r.data ? r.data.split('-') : ['', '', ''];
  const sign = r.tipo === 'entrata' ? 1 : -1;
  return `<a class="row" href="#/modifica/${r.id}">
    <div class="date num"><b>${d || '–'}</b><small>${m ? MONTHS[+m - 1] + ' ' + y.slice(2) : ''}</small></div>
    <div style="min-width:0">
      <div class="desc">${esc(r.descr) || '<span class="muted">(senza descrizione)</span>'}</div>
      <div class="meta"><span class="tag">${esc(r.conto || '—')}</span>${esc(r.cat)}</div>
    </div>
    <div class="amt num ${sign > 0 ? 'in' : 'out'}">${money(sign * r.importo, r.valuta, true)}</div>
  </a>`;
}

/* ---------------- Form inserimento / modifica ---------------- */
views.nuovo = () => formView(null);
views.modifica = (r) => formView(r.arg);

function formView(id) {
  const v = $('#view');
  const editing = id ? store.records.find(r => r.id === id) : null;
  if (id && !editing) {
    v.innerHTML = `<div class="page-head"><h1>Modifica</h1></div>`;
    if (!needsData(v)) v.innerHTML += `<div class="card empty">Movimento non trovato.</div>`;
    return;
  }
  const last = lsGet(LS.last, {});
  const conti = store.accounts();
  const cats = store.allCategories();
  const m = editing ? { ...editing } : {
    data: today(), descr: '', tipo: last.tipo || 'uscita',
    conto: last.conto || conti[0] || '', cat: '', importo: '', valuta: last.valuta || store.mainCurrency(),
  };

  // Categorie più usate per il conto/tipo correnti, come scorciatoie
  const topCats = store.distinct('cat').slice(0, 8);

  v.innerHTML = `
    <div class="page-head"><h1>${editing ? 'Modifica movimento' : 'Nuovo movimento'}</h1></div>
    <form class="form card" id="mov-form" novalidate autocomplete="off">
      <div class="seg" role="group" aria-label="Tipo">
        <button type="button" data-v="uscita" aria-pressed="${m.tipo !== 'entrata'}">Uscita</button>
        <button type="button" data-v="entrata" aria-pressed="${m.tipo === 'entrata'}">Entrata</button>
      </div>
      <input class="amount-input num" id="m-importo" inputmode="decimal" placeholder="0,00" aria-label="Importo"
        value="${m.importo !== '' ? String(m.importo).replace('.', ',') : ''}" required>
      <label class="field">Descrizione<input id="m-descr" value="${esc(m.descr)}" placeholder="Es. Spesa Esselunga" maxlength="200"></label>
      <div class="pair">
        <label class="field">Data<input type="date" id="m-data" value="${m.data}" required></label>
        <label class="field">Valuta<input id="m-valuta" value="${esc(m.valuta)}" list="dl-valute" maxlength="3" style="text-transform:uppercase"></label>
      </div>
      <label class="field">Conto
        <input id="m-conto" value="${esc(m.conto)}" list="dl-conti" placeholder="Es. Gabri" required>
      </label>
      ${conti.length ? `<div class="quick-chips" id="conto-chips">${conti.map(c => `<button type="button" class="chip" data-conto="${esc(c)}" aria-pressed="${c === m.conto}">${esc(c)}</button>`).join('')}</div>` : ''}
      <label class="field">Categoria
        <select id="m-cat" required>
          <option value="">Scegli…</option>
          ${cats.map(c => `<option ${c === m.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
      </label>
      ${topCats.length ? `<div class="quick-chips" id="cat-chips">${topCats.map(c => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${c === m.cat}">${esc(c)}</button>`).join('')}</div>` : ''}
      <div id="form-err"></div>
      <div class="form-actions">
        ${editing ? `<button type="button" class="btn btn-danger" data-action="delete">Elimina</button>` : ''}
        ${editing ? `<a class="btn" href="#/movimenti">Annulla</a>` : ''}
        <button type="submit" class="btn btn-primary" id="m-save">${editing ? 'Salva modifiche' : 'Aggiungi movimento'}</button>
      </div>
    </form>
    <datalist id="dl-conti">${conti.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <datalist id="dl-valute">${store.currencies().concat(['EUR', 'USD', 'CHF', 'GBP']).filter((c, i, a) => a.indexOf(c) === i).map(c => `<option value="${c}">`).join('')}</datalist>`;

  const form = $('#mov-form', v);
  let tipo = m.tipo === 'entrata' ? 'entrata' : 'uscita';

  $$('.seg button', form).forEach(b => b.onclick = () => {
    tipo = b.dataset.v;
    $$('.seg button', form).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  $$('[data-conto]', form).forEach(b => b.onclick = () => {
    $('#m-conto', form).value = b.dataset.conto;
    $$('[data-conto]', form).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  $('#m-conto', form).oninput = e => $$('[data-conto]', form).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.conto === e.target.value)));
  $$('[data-cat]', form).forEach(b => b.onclick = () => {
    $('#m-cat', form).value = b.dataset.cat;
    $$('[data-cat]', form).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  $('#m-cat', form).onchange = e => $$('[data-cat]', form).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.cat === e.target.value)));

  if (!editing) setTimeout(() => $('#m-importo', form).focus(), 50);

  form.onsubmit = async e => {
    e.preventDefault();
    const err = $('#form-err', form);
    const data = {
      data: $('#m-data', form).value,
      descr: $('#m-descr', form).value.trim(),
      tipo,
      conto: $('#m-conto', form).value.trim(),
      cat: $('#m-cat', form).value,
      importo: parseAmount($('#m-importo', form).value),
      valuta: ($('#m-valuta', form).value.trim() || 'EUR').toUpperCase(),
    };
    const problems = [];
    if (!(data.importo > 0)) problems.push('inserisci un importo valido');
    if (!data.data) problems.push('indica la data');
    if (!data.conto) problems.push('indica il conto');
    if (!data.cat) problems.push('scegli una categoria');
    if (problems.length) {
      err.innerHTML = `<div class="error-box">Per favore ${problems.join(', ')}.</div>`;
      return;
    }
    err.innerHTML = '';
    const btn = $('#m-save', form);
    btn.disabled = true; btn.textContent = 'Salvataggio…';
    try {
      if (editing) {
        const rec = await API.update(editing.id, toFields(data));
        store.upsert(normalize(rec));
        toast('Movimento aggiornato');
        location.hash = '#/movimenti';
      } else {
        const rec = await API.create(toFields(data));
        store.upsert(normalize(rec));
        lsSet(LS.last, { conto: data.conto, tipo: data.tipo, valuta: data.valuta });
        toast(`Aggiunto: ${data.tipo === 'entrata' ? '+' : '−'}${money(data.importo, data.valuta)} · ${data.cat}`);
        // Pronto per un nuovo inserimento: mantiene data, conto, tipo e valuta
        $('#m-importo', form).value = '';
        $('#m-descr', form).value = '';
        $('#m-cat', form).value = '';
        $$('[data-cat]', form).forEach(x => x.setAttribute('aria-pressed', 'false'));
        $('#m-importo', form).focus();
        btn.disabled = false; btn.textContent = 'Aggiungi movimento';
      }
    } catch (ex) {
      err.innerHTML = `<div class="error-box">${esc(ex.message)}</div>`;
      btn.disabled = false; btn.textContent = editing ? 'Salva modifiche' : 'Aggiungi movimento';
    }
  };

  const del = $('[data-action="delete"]', form);
  if (del) del.onclick = async () => {
    if (!confirm(`Eliminare "${editing.descr || 'movimento'}" del ${fmtDate(editing.data)}?\nIl record verrà spostato nel cestino di Airtable.`)) return;
    del.disabled = true;
    try {
      await API.remove(editing.id);
      store.drop(editing.id);
      toast('Movimento eliminato');
      location.hash = '#/movimenti';
    } catch (ex) {
      toast(ex.message, true);
      del.disabled = false;
    }
  };
}

/* ---------------- Impostazioni ---------------- */
views.impostazioni = () => {
  const v = $('#view');
  const has = !!API.token;
  v.innerHTML = `
    <div class="page-head"><h1>Impostazioni</h1></div>
    <div class="settings">
      ${has ? '' : `<div class="card"><h2 style="margin-bottom:6px">Benvenuto in ZenXpense</h2>
        <p class="hint" style="margin:0">Per iniziare collega la tua base Airtable inserendo un Personal Access Token.</p></div>`}
      <form class="card form" id="tok-form" style="max-width:none">
        <h2>Connessione Airtable</h2>
        <label class="field">Personal Access Token
          <input type="password" id="tok" placeholder="pat…" value="${has ? '••••••••••••••••' : ''}" autocomplete="off" spellcheck="false">
        </label>
        <div class="hint">
          Crea il token su <a href="https://airtable.com/create/tokens" target="_blank" rel="noopener">airtable.com/create/tokens</a>:
          <ol>
            <li>Scope: <code>data.records:read</code> e <code>data.records:write</code></li>
            <li>Accesso: solo la base <b>ZenXpense</b></li>
          </ol>
          Il token resta salvato solo su questo dispositivo (localStorage) e viene inviato esclusivamente ad <code>api.airtable.com</code>.
        </div>
        <div id="tok-msg"></div>
        <div class="form-actions">
          ${has ? `<button type="button" class="btn btn-danger" data-action="logout">Disconnetti</button>` : ''}
          <button type="submit" class="btn btn-primary">${has ? 'Aggiorna token' : 'Collega'}</button>
        </div>
      </form>
      ${has ? `
      <div class="card form" style="max-width:none">
        <h2>Dati</h2>
        <p class="hint" style="margin:0">${store.records.length} movimenti e ${store.categories.length} categorie in cache locale. ${esc(syncLabel())}</p>
        <div class="form-actions">
          <button class="btn" data-action="sync">Risincronizza ora</button>
        </div>
      </div>` : ''}
      <div class="card form" style="max-width:none">
        <h2>Installa come app</h2>
        <p class="hint" style="margin:0">
          <b>iPhone/iPad</b>: in Safari tocca Condividi → <i>Aggiungi alla schermata Home</i>.<br>
          <b>Android</b>: in Chrome apri il menu ⋮ → <i>Installa app</i>.<br>
          <b>Desktop</b>: in Chrome/Edge usa l'icona di installazione nella barra degli indirizzi.
        </p>
      </div>
      <p class="hint">Base: <code>${CFG.baseId}</code></p>
    </div>`;

  const tokInput = $('#tok', v);
  tokInput.onfocus = () => { if (tokInput.value.startsWith('•')) tokInput.value = ''; };

  $('#tok-form', v).onsubmit = async e => {
    e.preventDefault();
    const val = tokInput.value.trim();
    const msg = $('#tok-msg', v);
    if (!val || val.startsWith('•')) { msg.innerHTML = '<div class="error-box">Incolla il token.</div>'; return; }
    const prev = API.token;
    lsSet(LS.token, val);
    msg.innerHTML = '<p class="hint">Verifica in corso…</p>';
    try {
      await API.req(`${CFG.tables.cat}?pageSize=1`);
      toast('Collegato ad Airtable');
      location.hash = '#/dashboard';
      store.sync();
    } catch (ex) {
      if (prev) lsSet(LS.token, prev); else lsDel(LS.token);
      msg.innerHTML = `<div class="error-box">${esc(ex.message)}</div>`;
    }
  };

  const out = $('[data-action="logout"]', v);
  if (out) out.onclick = () => {
    if (!confirm('Rimuovere il token e i dati in cache da questo dispositivo?')) return;
    lsDel(LS.token); lsDel(LS.cache);
    store.records = []; store.categories = []; store.syncedAt = null;
    toast('Disconnesso');
    render();
  };
};

/* ---------------- Azioni globali ---------------- */
document.addEventListener('click', e => {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  switch (a.dataset.action) {
    case 'sync': store.sync(); break;
    case 'more': listState.limit += 300; renderResults(); break;
    case 'toggle-filters': {
      listState.open = !listState.open;
      const w = $('.filters-wrap'); if (w) w.dataset.open = String(listState.open);
      break;
    }
    case 'reset-filters':
      Object.assign(listState, { dal: '', al: '', conto: '', cat: '', tipo: '', q: '', preset: 'all', limit: 150 });
      render();
      break;
  }
});

// Ri-renderizza le viste "di sola lettura" quando cambiano i dati (non il form, per non perdere input)
store.listeners.add(() => {
  const name = parseHash().name;
  setSync(syncLabel());
  if (name === 'nuovo' || name === 'modifica') return;
  if (name === 'movimenti' && store.records.length && $('#results')) { renderResults(); return; }
  render();
});

window.addEventListener('hashchange', route);

/* ---------------- Avvio ---------------- */
store.loadCache();
route();
if (API.token) {
  // Con cache: aggiornamento silenzioso se più vecchia di 5 minuti
  if (!store.syncedAt || Date.now() - store.syncedAt > 5 * 60 * 1000) store.sync();
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
