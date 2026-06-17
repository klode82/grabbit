# GRABBIT — Roadmap di sviluppo

> Media downloader desktop con interfaccia web, basato su yt-dlp.
> Supporta qualsiasi sito compatibile con yt-dlp, gestione playlist, selezione
> formati/audio/sottotitoli, coda di download in background, multilingua.

---

## Stack tecnico

| Layer | Tecnologia | Ruolo |
|---|---|---|
| Entry point | `pywebview` | Finestra nativa OS che ospita la web UI |
| Backend | `FastAPI` + `uvicorn` | Server locale (thread daemon), REST API + WebSocket |
| Engine | `yt-dlp` | Analisi URL, parsing formati, download |
| Frontend | HTML / CSS / Vanilla JS | UI single-page, nessun framework |
| i18n | JSON locale files | Traduzioni: IT, EN, FR, DE, ES, PT |
| Persistenza | JSON file | Impostazioni in `~/.config/grabbit/settings.json` |
| Packaging | `PyInstaller` | Build nativo per Windows, macOS, Linux |

### Architettura runtime

```
main.py
  ├── trova porta libera
  ├── avvia FastAPI in thread daemon
  ├── attende che il server risponda
  └── apre pywebview → http://127.0.0.1:{PORT}

FastAPI
  ├── serve index.html (SPA)
  ├── serve /static/** (CSS, JS)
  ├── serve /locale/** (JSON traduzioni)
  └── /api/**
        ├── POST /analyze
        ├── POST /analyze/playlist-entry
        ├── GET|POST|DELETE /queue/**
        ├── GET|POST /settings
        └── WS /ws (progress in real-time)
```

---

## Setup

```bash
# 1. Crea e attiva la venv
python -m venv .venv
source .venv/bin/activate        # macOS / Linux
.venv\Scripts\activate           # Windows

# 2. Installa le dipendenze
pip install -r requirements.txt

# 3. Avvia
python main.py

# Modalità debug (DevTools aperto)
python main.py --debug
```

---

## Struttura del progetto

```
grabbit/
├── main.py                          # Entry point
├── requirements.txt
├── ROADMAP.md                       # Questo file
│
├── app/
│   ├── server.py                    # FastAPI factory
│   │
│   ├── core/
│   │   ├── ytdlp_wrapper.py         # Wrapper yt-dlp (analisi + download)
│   │   ├── download_queue.py        # Coda thread-safe con concorrenza
│   │   └── settings_manager.py      # Persistenza impostazioni JSON
│   │
│   ├── api/
│   │   └── routes.py                # Tutti gli endpoint REST + WebSocket
│   │
│   └── ui/
│       ├── index.html               # SPA — shell unica per tutti i tab
│       ├── static/
│       │   ├── css/main.css         # Design system (dark/light, componenti)
│       │   └── js/
│       │       ├── i18n.js          # Engine traduzioni
│       │       ├── api.js           # Client HTTP + WebSocket
│       │       └── app.js           # Logica UI principale
│       └── locale/
│           ├── en.json
│           ├── it.json
│           ├── fr.json
│           ├── de.json
│           ├── es.json
│           └── pt.json
│
└── assets/
    └── icon.png                     # (Phase 10)
```

---

## Fasi di sviluppo

---

### ✅ Phase 0 — Setup & Architettura
> Fondamenta del progetto.

- [x] Struttura cartelle
- [x] `requirements.txt`
- [x] `main.py` — pywebview + FastAPI + attesa server
- [x] `app/server.py` — factory FastAPI, mount static/locale
- [x] Test: finestra pywebview si apre e carica la UI

---

### ✅ Phase 1 — Core Engine
> Il motore yt-dlp e i servizi backend.

- [x] `core/ytdlp_wrapper.py`
  - `analyze(url)` — estrae metadati senza scaricare
  - `_parse_video()` — separa formati video-only, audio-only, combinati
  - `_parse_playlist()` — stub entries da playlist
  - `_parse_subtitles()` — manuali + auto-generati per lingua
  - `download(url, options, progress_callback)` — download con hook progress
- [x] `core/download_queue.py`
  - Coda thread-safe con `threading.Lock`
  - Concorrenza configurabile (`max_concurrent`)
  - Stati: `pending → downloading → completed | error | cancelled`
  - Broadcast eventi a listener registrati
- [x] `core/settings_manager.py`
  - Default sensati per tutti i parametri
  - Persistenza in `~/.config/grabbit/settings.json`
  - Metodi `get`, `update`, `reset`
- [x] `api/routes.py`
  - `POST /api/analyze`
  - `POST /api/analyze/playlist-entry`
  - `GET|POST /api/queue`, `POST /api/queue/add`, `DELETE /api/queue/{id}`
  - `GET|POST /api/settings`, `POST /api/settings/reset`
  - `WS /api/ws` — WebSocket con auto-reconnect lato client
- [x] `ui/` — SPA base con tab Download / Coda / Impostazioni
- [x] `ui/static/css/main.css` — design system dark/light
- [x] `ui/static/js/i18n.js` — engine i18n con `t('key')`
- [x] `ui/static/js/api.js` — client fetch + WebSocket manager
- [x] `ui/static/js/app.js` — logica UI completa
- [x] Locale: EN, IT, FR, DE, ES, PT

---

### 🔲 Phase 2 — Test & Stabilizzazione
> Verificare che tutto funzioni con URL reali prima di andare avanti.

- [ ] Test `analyze()` con URL reali: YouTube, Vimeo, SoundCloud, TikTok
- [ ] Verifica parsing formati: video-only vs audio-only vs combinati
- [ ] Verifica rilevamento sottotitoli (manuali + auto-generati)
- [ ] Test download effettivo end-to-end con progress WebSocket
- [ ] Gestione edge case: video privati, geo-blocked, siti con login
- [ ] Fix eventuali bug emersi dai test
- [ ] Verifica UI: i chip formato si selezionano correttamente
- [ ] Verifica i18n: cambio lingua ricarica tutti i testi

---

### 🔲 Phase 3 — UX Polish
> Rifinire l'esperienza utente prima di aggiungere nuove funzioni.

- [ ] Animazioni su cambio tab (fade/slide)
- [ ] Transizione fluida su apertura/chiusura result-card
- [ ] Drag & drop URL nella finestra (evento `drop` sull'input)
- [ ] Auto-paste: quando la finestra ottiene il focus e gli appunti contengono un URL, pre-compilare l'input
- [ ] Skeleton loader durante l'analisi (invece del semplice spinner)
- [ ] Indicatore di connessione WebSocket (online/offline)
- [ ] Rispetto `prefers-reduced-motion`
- [ ] Gestione errori più ricca: messaggi diversi per "link non supportato", "video privato", "rate limit", "rete assente"
- [ ] Keyboard shortcut: `Ctrl/Cmd+V` focalizza e incolla nell'input URL

---

### 🔲 Phase 4 — Analisi Link (rifinitura)
> Migliorare la scheda di analisi risultato.

- [ ] Mostrare il conteggio totale formati disponibili (`12 video · 8 audio`)
- [ ] Raggruppare i chip video per risoluzione (4K / FHD / HD / SD)
- [ ] Indicatore visivo sul chip selezionato con dimensione file stimata
- [ ] Se il video è solo audio (es. SoundCloud), nascondere la sezione video
- [ ] Link cliccabile al sorgente originale
- [ ] Mostrare il nome del sito (extractor) con favicon se disponibile
- [ ] **Selezione container output** (mp4 / mkv / webm) per singolo download — adesso è fisso mp4

---

### 🔲 Phase 5 — Download Queue (rifinitura)
> Funzionalità avanzate sulla coda.

**Controlli per singolo item:**
- [ ] **Pausa / Riprendi** download singolo
- [ ] **Retry** manuale su download in errore — con messaggio errore leggibile e bottone visibile
- [ ] **Annulla** download in corso
- [ ] Azione "Apri cartella" al completamento (apertura explorer/finder nativo)

**Controlli globali coda:**
- [ ] **Pausa tutto** — sospende tutti i download attivi
- [ ] **Riprendi tutto** — riprende tutti i download in pausa
- [ ] **Annulla tutto** — cancella tutti i pending e interrompe gli attivi

**Gestione errori:**
- [ ] Messaggio errore completo visibile sull'item (adesso è troncato)
- [ ] Retry automatico su errore di rete transitorio (max 3 tentativi con backoff)
- [ ] Distinguere errori recuperabili (rete) da errori permanenti (video rimosso, privato)

**UX coda:**
- [ ] Riordino drag & drop degli item in coda
- [ ] Filtro lista per stato: Tutti / In corso / Completati / Errori
- [ ] Pulizia batch: "Rimuovi completati"
- [ ] Stima tempo rimanente globale

---

### 🔲 Phase 6 — Gestione Playlist (rifinitura)
> Migliorare il flusso playlist.

- [ ] Analisi parallela degli entry (pool di thread configurabile)
- [ ] Checkbox "Applica stesso formato a tutti"
- [ ] Selezione formato per singolo video nella lista playlist
- [ ] Ordinamento colonne nella lista (titolo, durata)
- [ ] Salvataggio selezione se si chiude e riapre il pannello
- [ ] Supporto canali YouTube (non solo playlist)

---

### 🔲 Phase 7 — Impostazioni (rifinitura)
> Completare la pagina impostazioni.

- [ ] Pulsante "Sfoglia" nativo per scegliere la cartella di download
- [ ] Template nome file configurabile (es. `%(uploader)s - %(title)s`)
- [ ] Sezione "Avanzate" nascosta per le opzioni yt-dlp meno comuni
- [ ] Import/export impostazioni (file JSON)
- [ ] Profili: salvare preset diversi (es. "Podcast 128kbps" / "Video 1080p")

---

### 🔲 Phase 8 — Notifiche & Sistema
> Integrazione con l'OS.

- [ ] Notifica di sistema nativa al completamento download (pywebview API o `plyer`)
- [ ] Icona tray su Windows/macOS (minimizzazione in background)
- [ ] Apertura automatica della cartella di destinazione (opzionale)
- [ ] Log scaricabile degli errori

---

### 🔲 Phase 9 — Packaging & Release
> Preparare la distribuzione.

- [ ] Icona app vettoriale (SVG → PNG 512x512)
- [ ] Build PyInstaller: `--onefile` o `--onedir`
  - Windows: `.exe` + installer NSIS (opzionale)
  - macOS: `.app` bundle
  - Linux: `AppImage` o `tar.gz`
- [ ] Script di build cross-platform (`build.py`)
- [ ] Aggiornamento automatico di yt-dlp a runtime (già supportato da yt-dlp)
- [ ] README utente finale
- [ ] CHANGELOG
- [ ] Prima release `v1.0.0`

---

## Legenda stati

| Simbolo | Significato |
|---|---|
| ✅ | Completata e testata |
| 🔲 | Da fare |
| 🚧 | In lavorazione |
| ⏸ | In pausa / bloccata da dipendenza |

---

## Dipendenze principali

```
pywebview>=5.0.5          # Finestra nativa OS
fastapi>=0.115.0           # Backend web framework
uvicorn>=0.30.0            # ASGI server
yt-dlp>=2024.11.18         # Engine download
websockets>=13.0           # WebSocket support
aiofiles>=24.1.0           # File I/O async
pydantic>=2.9.0            # Validazione dati
python-multipart>=0.0.12   # Form parsing
```

---

*Ultimo aggiornamento: Phase 1 completata.*
