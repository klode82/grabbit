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
│   │   ├── settings_manager.py      # Persistenza impostazioni JSON
│   │   ├── logger.py                # Logger rotante (file + console)
│   │   └── notifier.py              # Notifiche di sistema native (osascript / notify-send / winotify)
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
│           ├── en.json / it.json / fr.json / de.json / es.json / pt.json
│
└── assets/
    ├── icon.png / icon.ico / icon.icns
    └── logo.png
```

---

## Fasi di sviluppo

---

### ✅ Phase 0 — Setup & Architettura
> Fondamenta del progetto.

- [x] Struttura cartelle e `requirements.txt`
- [x] `main.py` — pywebview + FastAPI + attesa server
- [x] `app/server.py` — factory FastAPI, mount static/locale
- [x] Icona app (PNG 1024×1024, ICO multi-size, ICNS macOS)

---

### ✅ Phase 1 — Core Engine
> Il motore yt-dlp e i servizi backend.

- [x] `ytdlp_wrapper.py` — `analyze()`, `_parse_video()`, `_parse_playlist()`, `download()`
- [x] `download_queue.py` — coda thread-safe, concorrenza, stati completi, WebSocket broadcast
- [x] `settings_manager.py` — persistenza JSON, default, get/update/reset
- [x] `routes.py` — tutti gli endpoint REST + WebSocket
- [x] SPA base con tab Download / Coda / Impostazioni
- [x] Design system dark/light, i18n engine, client API
- [x] Locale: EN, IT, FR, DE, ES, PT

---

### ✅ Phase 2 — Test & Stabilizzazione
> Verificare e correggere durante lo sviluppo.

- [x] Test `analyze()` con URL reali: YouTube, playlist, video singoli
- [x] Fix race condition scheduler (`_schedule()` atomico dentro lock)
- [x] Fix `_DownloadInterrupted(BaseException)` — cattura corretta
- [x] Fix `_emit_item()` chiamata fuori dal lock (deadlock)
- [x] Fix `navigator.clipboard` → `window.pywebview.api.get_clipboard()` (Qt WebEngine)
- [x] Fix `getElementById` invece di `querySelector` per UUID con caratteri speciali
- [x] `_cleanup_partial_files()` — rimuove `.part`, `.ytdl`, `*.f[0-9]+.*`
- [x] `ignoreerrors: True` in `analyze()` per playlist con video non disponibili

---

### ✅ Phase 3 — UX Polish
> Esperienza utente base.

- [x] Dialog custom (sostituisce `confirm()` e `alert()` nativi)
- [x] Indicatore connessione WebSocket (online/offline) in header
- [x] Gestione errori: messaggi differenziati per tipo di errore
- [x] Keyboard: `Ctrl/Cmd+V` pre-incolla nell'input URL
- [x] Rispetto `prefers-reduced-motion`

---

### ✅ Phase 4 — Analisi Link
> Scheda di analisi risultato completa.

- [x] Chip video raggruppati per qualità: **4K / FHD / HD / SD** con etichetta in colonna fissa
- [x] Chip con `qualità · codec · ext` — layout grid `label | chips`
- [x] Size hint sul chip selezionato (`~199 MB`)
- [x] Contatore formati disponibili (`13 formats`, `4 tracks`)
- [x] Toggle Video / Audio / Sottotitoli (ON/OFF) con ripristino size hint
- [x] Lista sottotitoli con separazione manuali/auto-generati, selezione lingua
- [x] Selettore container **MP4 / MKV**
- [x] Link extractor cliccabile con `↗` (apertura browser nativo)
- [x] Badge qualità e audio nella result-header

---

### ✅ Phase 5 — Download Queue
> Controllo completo della coda di download.

- [x] **Per item:** pausa / riprendi / annulla / riavvia / apri cartella / apri file / rimuovi
- [x] **Globali:** Pausa tutto / Riprendi tutto / Pulisci completati / Svuota tutto
- [x] Bottoni SVG unificati per tutti gli stati
- [x] `updateDlProgress()` separato da `updateDlItem()` — no vibrazione UI durante download
- [x] Retry automatico su errore (backoff configurabile)
- [x] Messaggio errore completo sull'item
- [x] Counter naming con `prepare_filename()` per file duplicati

---

### ✅ Phase 6 — Gestione Playlist
> Analisi e download di playlist complete.

- [x] Analisi sequenziale di tutti gli entry con progress bar
- [x] Video non disponibili: badge rosso, checkbox disabilitata, saltati
- [x] **Selettore globale video** — intersezione `qualità · codec` su tutti i video
  - Chip viola = disponibile in tutti; chip arancione `X/Y` = parziale
- [x] **Selettore globale audio** — stessa logica su `bitrate · codec`
- [x] **Selettore globale sottotitoli** — sezioni *Reali* / *Generati*, nomi lingua via `Intl.DisplayNames`
- [x] Toggle globale V/A/S — OFF azzera le selezioni per tutti, ri-evaluta stato
- [x] **Accordion per-entry** — ogni video espandibile mostra: thumbnail, titolo, `durata · extractor · uploader`, badge formato selezionato (live)
- [x] Body accordion: sezioni Video / Audio / Sottotitoli identiche al singolo video
- [x] **Stato arancione** per-entry: canale attivo senza selezione → bordo arancione
- [x] Toggle per-entry V/A/S — disattivare un canale risolve l'arancione per quell'entry
- [x] **"Add to queue" bloccato** finché almeno un video selezionato ha canali attivi senza selezione
- [x] Selezione per-entry sovrascrive la globale

---

### ✅ Phase 7 — Impostazioni & UX Polish
> Completare la pagina impostazioni e rifinitura UX generale.

- [x] Pulsante **"Sfoglia"** nativo per cartella di download (bridge pywebview)
- [x] Template nome file con **guida token sempre visibile e cliccabile** (inserisce al cursore)
- [x] **Counter naming** per file duplicati (`_01`, `_02` …) via `prepare_filename()`
- [x] Impostazione concorrenza download (1–5 thread), applicata a runtime senza riavvio
- [x] **Aggiornamento lingua in tempo reale** (senza premere Save)
- [x] Tema Dark/Light spostato dall'header alla sezione Interface nelle impostazioni
- [x] **Formato di uscita default** (MP4/MKV) come chip selector
- [x] **Codec video default** (Any / H.264 / VP9 / AV1 / H.265)
- [x] **Formato sottotitoli** (SRT / ASS / VTT) — SRT default; conversione via `FFmpegSubtitlesConvertorPP`
- [x] Layout pagina Config riscritto: INTERFACE / DOWNLOAD / VIDEO / AUDIO / SUBTITLES / NETWORK a larghezza piena
- [x] **Selettore lingua custom** (Audio e Sottotitoli) — dropdown con ricerca, nomi localizzati via `Intl.DisplayNames`, ordinato per locale corrente
- [x] **Campo ricerca sottotitoli** con pulsante X per cancellare — singolo video, playlist per-entry, selettore globale
- [x] **Accordion V/A/S** nel singolo video e nelle entry playlist — header con badge formato selezionato live
- [x] **Auto-selezione da impostazioni** all'analisi playlist: video (qualità+codec), audio (codec+bitrate), sottotitoli (lingua)
- [x] Chip formato uniformi: colonne fisse 170px (video/audio), 155px (chip globali)
- [x] Separatori verticali tra gruppi qualità (HD/SD/4K) con linea laterale full-height
- [x] **Toggle OFF** nel bar globale playlist ripristinabile — fix `pointer-events: none` sull'intero accordion
- [x] **Bar globale disabilitato durante analisi playlist** — classe `analyzing` con opacity + pointer-events none
- [x] **Highlight sezione con problemi** nell'accordion per-entry — bordo arancione + sfondo + titolo colorato
- [x] **Orange state sottotitoli coerente** — `sel.subsEnabled` inizializzato da disponibilità reale; toggle e stato arancione sempre allineati
- [x] Pulsanti finestra custom nell'header (Riduci/Ingrandisci/Chiudi via bridge pywebview)
- [x] **Logo header unificato** — immagine combinata coniglio+testo, padding asimmetrico compensato
- [x] Toggle slider visibile in Light Mode (fix colore OFF stato)
- [x] `select` nativo stilizzato con `font-size` per coerenza con i campi input
- [x] Bug fix queue: `clear_all()` resetta `is_paused` → nuovi download partono dopo Clear All
- [x] Bug fix queue: `_emit_item()` non emette per item già rimossi → no badge zombie dopo Clear All
- [x] **Nomi lingua completi** nella lista sottotitoli (singolo + per-entry) via `langName()` invece del codice grezzo
- [x] **Badge lingua selezionata** nell'header accordion sottotitoli per-entry
- [x] Bug fix ricerca sottotitoli singolo video — listener `input` su `#sub-search` rimosso per errore, ripristinato
- [x] Bug fix ricerca sottotitoli per-entry — `data-lang` mancante sugli elementi, filter non trovava nulla
- [x] **Codici ANSI rimossi** dalla stringa speed/ETA di yt-dlp (`_speed_str`, `_eta_str`) prima dell'invio al frontend
- [x] **Embed sottotitoli corretto** — ordine post-processor: converti prima, embeds dopo; fix MKV con traccia sub embedded

---

### ✅ Phase 8 — Modal Parametri yt-dlp & Preset
> Accesso avanzato ai parametri di yt-dlp con sistema di preset salvabili.

**Modal parametri**
- [x] Pulsante **"⚙ Avanzato"** nel footer della result card → apre la modal
- [x] Layout a navigazione laterale: **menu sezioni a sinistra** → controlli a destra
- [x] Sezioni implementate: 🌐 Rete · 📦 File & Metadati · 🛡️ SponsorBlock · ⚙️ Comportamento · 🔧 Extra
- [x] Badge per sezione nel menu laterale mostra numero parametri attivi
- [x] Badge sul pulsante ⚙ Avanzato mostra totale parametri attivi
- [x] Parametri applicati passati al download via `extra_params` → `_apply_extra_params()` in backend
- [x] Pulsante modal equivalente nel **bar globale playlist** → applica a tutti i video selezionati

**Persistenza Queue**
- [x] Salvataggio queue su disco (JSON) ad ogni modifica: add, complete, cancel, pause
- [x] Ripristino automatico all'avvio: PENDING e PAUSED ripartono, DOWNLOADING → PENDING, COMPLETED mantenuti come history
- [x] Gestione file `.part` al riavvio (download interrotti)

**Preset**
- [x] Input inline nel footer (no `prompt()` di sistema) — nome + Salva + ✕
- [x] Preset visualizzati come chip nell'header della modal con badge attivo
- [x] Preset salvati in `settings.json` sotto chiave `presets[]`
- [x] Caricamento preset pre-popola i controlli della sezione corrente
- [x] Elimina preset singolarmente (×)


---

### 🚧 Phase 9 — Notifiche & Sistema
> Integrazione con l'OS.

- [x] **Conferma chiusura** — dialog inline se download attivo o analisi in corso; intercetta sia il pulsante X sia la chiusura OS (Alt+F4 / Cmd+Q) via handler `closing` → `requestClose()`. Item solo in coda (PENDING/PAUSED) esclusi dal trigger perché la coda è persistente. `State.queueStats` centralizzato in `renderStats` come unica fonte live
- [ ] Notifica di sistema nativa al completamento download (`plyer` o pywebview API)
- [ ] Icona tray su Windows/macOS con menu contestuale (minimizza in background)
- [ ] Apertura automatica cartella di destinazione (opzionale, configurabile)
- [ ] Log errori scaricabile da UI

---

### 🔲 Phase 10 — Packaging & Release
> Prima distribuzione pubblica.

- [ ] Build **PyInstaller**: `--onefile` o `--onedir`
  - Windows: `.exe` standalone
  - macOS: `.app` bundle
  - Linux: `AppImage` o `tar.gz`
- [ ] Script di build cross-platform (`build.py`)
- [ ] Investigare `frameless=True` su Windows (su Linux causa segfault con Qt)
- [ ] README utente finale
- [ ] CHANGELOG
- [ ] Prima release `v1.0.0`

---

### 🔲 Phase 11 — Controllo e Gestione yt-dlp & FFmpeg
> L'app deve sapere dove sono le dipendenze e guidare l'utente se mancano.

**Rilevamento all'avvio**
- [ ] Verifica `ffmpeg` e `yt-dlp` nel PATH (o path configurate)
- [ ] Banner/dialog con istruzioni contestuali se mancanti
- [ ] Blocco soft se manca FFmpeg (funzioni base ok), blocco hard se manca yt-dlp

**Windows — bundling binari**
- [ ] Includi nel pacchetto: `ffmpeg.exe` + `ffprobe.exe` + `yt-dlp.exe`
- [ ] Fallback automatico ai binari bundled se non trovati nel PATH
- [ ] Override manuale percorso in Settings → Rete

**macOS / Linux — guida installazione**
- [ ] Istruzioni contestuali per OS:
  - macOS: `brew install ffmpeg yt-dlp`
  - Ubuntu/Debian: `sudo apt install ffmpeg` + `pip install yt-dlp`
  - Arch: `sudo pacman -S ffmpeg yt-dlp`

---

### 🔲 Phase 12 — Controlli Avanzati FFmpeg (Video, Audio, Sottotitoli)
> Conversione e post-processing FFmpeg accessibile dalla UI.

- [ ] **Singolo video** — sezione dedicata nella result card:
  - Estrazione audio pura: MP3 / AAC / M4A / FLAC / OPUS con scelta bitrate
  - Conversione container: MP4 → MKV e viceversa post-download
  - Sottotitoli: burn-in (hardcode) vs embed vs file separato
- [ ] **Playlist** — controlli equivalenti nel bar globale (applicati a tutti i video)
- [ ] Usa `FFmpegExtractAudioPP`, `FFmpegVideoConvertor`, `FFmpegEmbedSubtitlePP` di yt-dlp
- [ ] Verifica FFmpeg disponibile prima di mostrare le opzioni

---

### 🔲 Phase 13 — Upgrade Package
> Aggiornamento dell'applicazione e delle sue dipendenze.

- [ ] Check versione GRABBIT all'avvio vs ultima release GitHub
- [ ] Notifica in-app "Nuova versione disponibile" con link al download
- [ ] Aggiornamento automatico yt-dlp bundled (`yt-dlp -U`)
- [ ] Aggiornamento automatico yt-dlp da pip (se installato via pip)
- [ ] Changelog in-app per ogni release

---

### 🔲 Phase 14 — Dipendenze (TBD)
> Da definire in base all'evoluzione del progetto dopo Phase 13.

- [ ] *Da definire*

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
pywebview>=5.0.5
fastapi>=0.115.0
uvicorn>=0.30.0
yt-dlp>=2024.11.18
websockets>=13.0
aiofiles>=24.1.0
pydantic>=2.9.0
python-multipart>=0.0.12
```
