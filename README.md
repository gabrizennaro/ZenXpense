# ZenXpense

Web app (PWA) per la gestione delle spese personali, collegata alla base Airtable **ZenXpense** (`appVPy0GkvpwALILK`).
Statica, senza build: HTML + CSS + JavaScript, pubblicata su GitHub Pages.

## Funzionalità
- **Dashboard**: saldo, entrate e uscite per periodo; riepilogo per conto; grafico ultimi 12 mesi; spese per categoria.
- **Movimenti**: elenco filtrabile per data (dal/al o periodi rapidi), conto, categoria, tipo e testo. Tocca un movimento per modificarlo o eliminarlo.
- **Nuovo**: inserimento rapido (importo con tastiera numerica, scorciatoie per conto e categoria, ricorda conto/tipo/valuta usati).
- **PWA**: installabile su iPhone/Android/desktop, app shell disponibile offline.

## Configurazione
1. Crea un Personal Access Token su <https://airtable.com/create/tokens>
   - scope: `data.records:read`, `data.records:write`
   - accesso: solo la base **ZenXpense**
2. Apri l'app → **Impostazioni** → incolla il token → **Collega**.

Il token è salvato solo nel browser del dispositivo (localStorage) e non è mai incluso nel repository.

## Struttura Airtable usata
| Tabella | Campi |
|---|---|
| CATEGORIE | `categoria` (testo) |
| MOVIMENTI | `data` (data), `descrizione` (testo), `tipo` (entrata/uscita), `conto` (testo), `categoria` (testo), `importo` (numero, 2 decimali), `valuta` (testo) |

L'app usa gli ID dei campi, quindi rinominare i campi in Airtable non la rompe.

## Sviluppo locale
```bash
python3 -m http.server 8080
```
Dopo modifiche ai file, incrementa `VERSION` in `sw.js` per aggiornare la cache delle app installate.
