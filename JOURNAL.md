# GRABBIT — Journal di Sviluppo

> Traccia tecnica dettagliata di decisioni, bug fix e feature implementate.  
> Lingua: Italiano. Stack: Python · pywebview · FastAPI · PySide6 · yt-dlp · Vanilla JS.

---

## Sessione 3 — Giugno 2026
**Phase 7 (completamento) · Phase 8 · Frame OS · Bug vari**

---

### ACCORDION V/A/S — Video singolo e per-entry playlist

**Cosa:** aggiunto accordion per le sezioni Video/Audio/Sottotitoli nel singolo video e nelle entry della playlist, uguale al bar globale Download. Header cliccabile con badge del formato selezionato live e freccia ▾.

**Come:**
- `index.html`: ristrutturate le `format-section` con `id="fsh-{type}"`, `id="fsb-{type}"` (body), badge `id="{type}-sel-badge"`, freccia `.pl-accordion-arrow`
- `app.js`: aggiunta `initFormatSectionAccordions()` che attacca i click handler; aggiornate `selectVideoFormat()`, `selectAudioFormat()`, `selectSub()` per chiamare `updateFormatSectionBadge(type, label)` dopo ogni selezione
- Per-entry: in `renderEntryAccordionBody()` stesso pattern con ID unici `pefsh-{t}-{eid}`, `pef-{t}-{eid}`, `peb-{t}-{eid}`; accordion click handler attaccati inline dopo `innerHTML`
- CSS: `.format-section-header` con `cursor: pointer`; `.pl-accordion-arrow.open` per la rotazione

**Nota:** `peff-v-${eid}` e `peff-a-${eid}` sono i wrapper interni ai chip (dentro il body dell'accordion); `pef-v-${eid}` è il body dell'accordion stesso. Questa distinzione è fondamentale per `_syncEntryVideoChips` e `renderEntryFormatChips`.

---

### FRAME OS PERSONALIZZATO — Finestra frameless

**Problema:** `frameless=True` in `webview.create_window()` causava **segfault** immediato con pywebview+Qt su Linux. La causa è una race condition: Qt e WebEngine non sono ancora completamente inizializzati quando il flag `FramelessWindowHint` viene applicato a creazione.

**Soluzione adottata:** applicare il flag *dopo* l'inizializzazione tramite `QTimer.singleShot` sul thread GUI.

**Iterazioni:**
1. `frameless=True` a creazione → segfault immediato ❌
2. `QTimer.singleShot(800, _apply_frameless)` dal worker thread → `QObject::startTimer: event dispatcher destroyed` perché il worker thread esce prima che il timer scatti ❌
3. Forma a 3 argomenti `QTimer.singleShot(ms, app, callback)` — lega il callback al thread dell'`app` (GUI thread), ma il *timer* è ancora creato nel worker thread che muore subito → stesso problema ❌
4. **Soluzione finale:** catena sul GUI thread:
   ```python
   QTimer.singleShot(0, app, _apply_then_schedule_frameless)
   # dentro _apply_then_schedule_frameless (ora sul GUI thread):
   QTimer.singleShot(0, app, _apply_frameless)
   ```
   Il secondo `singleShot(0)` è creato **sul GUI thread** → l'event loop è attivo → il callback gira ✓

**Implementazione in `main.py`:**
```python
def _apply_frameless() -> None:
    from PySide6.QtWidgets import QMainWindow
    app = QApplication.instance()
    for w in app.topLevelWidgets():
        if isinstance(w, QMainWindow) and w.isVisible():
            pos = w.pos()
            w.setWindowFlag(Qt.WindowType.FramelessWindowHint, True)
            w.show()
            w.move(pos)
            return
```

**Chiusura finestra:** `destroy()` pywebview rimuoveva la finestra ma il processo restava vivo. `QApplication.quit()` dal bridge thread causava deadlock. Soluzione: `os._exit(0)` — termina il processo a livello OS da qualsiasi thread, nessun lock possibile.

**Maximize toggle:** `webview.windows[0].maximize()` non supportava il toggle. Soluzione:
```python
if w.isMaximized():
    w.showNormal()
else:
    w.showMaximized()
```

**Drag della finestra:** già implementato con `-webkit-app-region: drag` sull'header (CSS) e `-webkit-app-region: no-drag` sugli elementi interattivi.

---

### BUG FIX — `initEventListeners` null reference

**Problema:** `TypeError: Cannot read properties of null (reading 'addEventListener')` all'avvio. Causato da `#theme-toggle` rimosso dall'HTML ma ancora referenziato direttamente in `initEventListeners()` e `applyTheme()`.

**Fix:** `qs('#theme-toggle')?.addEventListener(...)` con optional chaining; `applyTheme()` aggiornata per usare `setChipSel()` al posto degli accessi diretti al DOM.

---

### BUG FIX — Chip video impilati (format-grid wrapper)

**Problema:** `#video-formats` e `#audio-formats` avevano `class="format-grid"` che metteva ogni `format-group` (HD/SD) in colonne da 155px → chip schiacciati in una singola colonna per gruppo.

**Fix:** rimosso `class="format-grid"` dai container `#video-formats` e `#audio-formats`. La classe va solo su wrapper di chip *flat*, non su wrapper di `format-group`.

---

### MIGLIORAMENTO — Separatori gruppi qualità (HD/SD/4K)

**Cosa:** separazione visiva tra i gruppi di qualità nella lista dei formati video.

**CSS applicato:**
```css
.format-group { margin-bottom: 14px; }
.format-group:last-child { margin-bottom: 0; }
.format-group-label {
  align-self: stretch;         /* estende al full-height del gruppo */
  border-right: 2px solid var(--border-md);
  padding-right: 6px;
  font-weight: 800;
}
```

`align-self: stretch` fa sì che il `border-right` copra l'intera altezza del gruppo chip, non solo l'altezza del testo dell'etichetta.

---

### SELETTORE LINGUA CUSTOM (Settings)

**Problema:** `<select>` nativo per lingua audio/sottotitoli in Settings mostrava codici ISO grezzi (`it`, `en`) e aveva l'aspetto del browser nativo.

**Soluzione:** componente `lang-picker` custom con:
- Pulsante display con testo lingua corrente
- Dropdown con campo ricerca
- Lista ordinata alfabeticamente per locale corrente via `Intl.DisplayNames`
- Hidden `<input>` che mantiene il codice ISO per il salvataggio

**Funzioni JS principali:**
- `buildLangPicker(pickerId, inputId, currentValue)` — costruisce la lista
- `toggleLangPicker(pickerId)` — apre/chiude
- `filterLangPicker(pickerId, query)` — filtra per nome o codice
- `selectLangPickerItem(pickerId, inputId, code, label)` — seleziona e chiude
- Listener globale `click` su `document` per chiudere cliccando fuori

---

### RICERCA SOTTOTITOLI — Pulsante X per svuotare

**Implementazione:**
- HTML: `<div class="search-wrap">` wrappa il campo con un `<button class="search-clear">`
- CSS: `.search-clear` è `display: none` di default, `.search-clear.visible` lo mostra
- JS: **event delegation** su `document` — un solo listener gestisce tutti i campi `.sub-search` presenti e futuri:
  ```javascript
  document.addEventListener('input', e => {
    if (!e.target.classList.contains('sub-search')) return;
    e.target.closest('.search-wrap')?.querySelector('.search-clear')
      ?.classList.toggle('visible', e.target.value.length > 0);
  });
  document.addEventListener('click', e => {
    const clear = e.target.closest('.search-clear');
    if (!clear) return;
    const input = clear.closest('.search-wrap')?.querySelector('.sub-search');
    input.value = '';
    clear.classList.remove('visible');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });
  ```

Applicato a: singolo video, selettore globale playlist, per-entry accordion.

---

### AUTO-SELEZIONE DA IMPOSTAZIONI ALL'ANALISI PLAYLIST

**Cosa:** dopo l'analisi di una playlist, video/audio/sottotitoli vengono pre-selezionati in base alle impostazioni globali.

**Funzioni:**
- `_autoSelectVideoChip()` — best quality (primo chip, già ordinati: universali per height desc) o matching codec se impostato
- `_autoSelectAudioChip()` — mapping `default_audio_ext → codec` (`m4a→aac`, `mp3→mp3`, ecc.), poi best bitrate con quel codec
- Auto-select sottotitoli: cerca `manual_${lang}` poi `auto_${lang}` in `State.plSubtitleFormatMap`
- `State.plSubsEnabled = !!State.settings.default_sub_lang` all'inizio di ogni analisi
- Accordion sottotitoli NON viene aperto automaticamente dopo la selezione (preferenza utente)

**Reset DOM all'inizio di ogni nuova analisi:**
```javascript
qsa('#pl-video-chips .format-chip, ...').forEach(c => c.classList.remove('selected'));
['video','audio','subs'].forEach(type => { /* reset badge, accordion, disabled */ });
```
Senza questo reset, i chip della sessione precedente rimanevano selezionati.

---

### BUG FIX — Toggle globale playlist non riattivabile

**Problema:** `.pl-global-accordion.disabled` aveva `pointer-events: none` sull'intero accordion, incluso il toggle che serve per riabilitarlo.

**Fix:** spostato su `.pl-global-accordion.disabled .pl-global-body` — solo il body dei chip è non-interagibile, l'header (con il toggle) rimane cliccabile.

---

### BAR GLOBALE DISABILITATO DURANTE ANALISI

**Cosa:** durante l'analisi di una playlist il bar V/A/S risulta opaco e non interagibile.

**Implementazione:**
- All'inizio di `handlePlaylistResult()`: `qs('#pl-format-bar')?.classList.add('analyzing')`
- Al termine: `qs('#pl-format-bar')?.classList.remove('analyzing')`
- CSS: `.pl-format-bar.analyzing { opacity: 0.38; pointer-events: none; }`

---

### ORANGE STATE SOTTOTITOLI — Fix coerenza toggle/stato

**Problema:** `sel.subsEnabled` partiva `undefined`. Il toggle lo renderizzava OFF (`undefined` è falsy) ma l'orange state usava `sel.subsEnabled !== false` → `true` per `undefined` → falso positivo arancione.

**Soluzione:**
1. In `renderEntryAccordionBody()`, al primo apertura accordion: inizializza `sel.subsEnabled` in base alla disponibilità reale:
   ```javascript
   if (sel.subsEnabled === undefined) {
     const hasSubs = !!(entry?.subtitle_data && Object.keys(entry.subtitle_data).length);
     sel.subsEnabled = State.plSubsEnabled && hasSubs;
   }
   ```
2. In `updateEntryOrangeState()` e `countOrangeSelected()`: usa `sel.subsEnabled === true` invece di `sel.subsEnabled !== false`

---

### HIGHLIGHT SEZIONE CON PROBLEMI

**Cosa:** quando un'entry ha un problema (es. sottotitolo attivo ma non disponibile), la sezione specifica V/A/S viene evidenziata con bordo arancione.

**CSS:**
```css
.format-section.needs-selection > .format-section-header {
  background: var(--warn-dim);
  border-radius: var(--r) var(--r) 0 0;
  position: relative;
}
.format-section.needs-selection > .format-section-header::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0;
  width: 3px; background: var(--warn);
}
.format-section.needs-selection .format-section-title { color: var(--warn); font-weight: 700; }
```

**JS:** `updateEntryOrangeState()` aggiunge `.needs-selection` a ogni `#pes-{t}-{eid}` che necessita attenzione.

---

### BUG FIX — Badge e ricerca sottotitoli per-entry

**Problema 1:** `selectEntrySubtitle()` non aggiornava il badge `#peb-s-${eid}` nell'header accordion.

**Problema 2:** La ricerca nei sottotitoli per-entry non funzionava. Causa: gli elementi DOM creati da `renderEntrySubList()` non avevano `el.dataset.lang` impostato → `filterEntrySubItems` leggeva sempre `undefined`.

**Fix:** aggiunto `el.dataset.lang = lang` e `el.dataset.auto = String(auto)` a ogni elemento; usato `langName(lang)` per il testo display (es. "Italiano" invece di "it").

**Problema 3:** Ricerca singolo video non funzionava. Causa: il listener `qs('#sub-search')?.addEventListener('input', ...)` era stato rimosso accidentalmente durante un refactoring. Ripristinato in `initEventListeners()`.

---

### CODICI ANSI — Stringa progress yt-dlp

**Problema:** il terminale mostrava `□[0;32m 4.04MiB/s□[0m · ETA □[0;33m00:17□[0m` — codici ANSI di colore di yt-dlp passati grezzi alla UI.

**Fix in `ytdlp_wrapper.py`:**
```python
_ANSI_RE = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]')
def _strip_ansi(s: str) -> str:
    return _ANSI_RE.sub('', s or '')
# Applicato a _speed_str e _eta_str nel progress callback
```

---

### EMBED SOTTOTITOLI — Fix ordine post-processor

**Problema:** con `embedsubtitles: True` + `FFmpegSubtitlesConvertor` nella lista `postprocessors`, yt-dlp eseguiva l'embed PRIMA della conversione VTT→SRT. Il VTT non veniva embedded correttamente in MKV, e poi l'SRT veniva creato ma non embedded.

**Causa:** yt-dlp aggiunge `FFmpegEmbedSubtitlePP` *prima* della lista `postprocessors` esplicita quando `embedsubtitles=True` è nel dict.

**Fix:** rimosso `embedsubtitles=True` dal dict; aggiunto `FFmpegEmbedSubtitle` esplicitamente **dopo** `FFmpegSubtitlesConvertor` nella lista `postprocessors`:
```python
pps = ydl_opts.setdefault("postprocessors", [])
if sub_fmt and sub_fmt != "vtt":
    pps.append({"key": "FFmpegSubtitlesConvertor", "format": sub_fmt})
if options.get("embed_subs"):
    pps.append({"key": "FFmpegEmbedSubtitle"})
```

---

### BUG FIX — Queue: Pause All + Clear All → download bloccati

**Causa:** `clear_all()` non resettava `self.is_paused = False` → `_schedule()` ritornava immediatamente → nuovi item restavan PENDING per sempre.

**Fix:** aggiunto `self.is_paused = False` in `clear_all()`.

**Problema correlato:** thread di download che finiva dopo `clear_all()` chiamava `_emit_item()` con item già rimosso → badge zombie a 1 nella UI.

**Fix:** `_emit_item()` controlla `if item.id not in self._items: return` prima di emettere.

---

### PHASE 8 — MODAL PARAMETRI YT-DLP

**Architettura:**
- `PARAM_GROUPS` array di dati → HTML generato una volta sola in `initYtdlpModal()`
- `ModalState` object con `params` (in-modal) e `applied` (usati nel download)
- `selectYtdlpSection(id)` sostituisce il pannello destro con i controlli della sezione selezionata
- Badge per sezione nel menu sinistro mostra parametri attivi per quella sezione

**Sezioni:** 🌐 Rete · 📦 File & Metadati · 🛡️ SponsorBlock · ⚙️ Comportamento · 🔧 Extra

**Bug critico — lettura preset:**
`_readModalControls()` leggeva dal DOM, ma solo la sezione corrente era nel DOM. Fix: prima sincronizza la sezione visibile in `ModalState.params`, poi ritorna `{ ...ModalState.params }` — legge da state (tutte le sezioni), non dal DOM (solo quella visibile).

**Salvataggio preset — no prompt():**
`prompt()` nativo sostituito con input inline nel footer:
- Click "Salva preset" → pulsante sparisce, appare `[input] [Salva] [✕]`
- Enter conferma, Escape annulla
- Si nasconde anche alla chiusura della modal

**Backend — `_apply_extra_params()`:**
```python
# Mapping: params modal → yt-dlp ydl_opts
# addmetadata e embedthumbnail: solo flag booleano (yt-dlp aggiunge il PP automaticamente)
# NON aggiungere manualmente FFmpegMetadataPP → verrebbe cercata FFmpegMetadataPPPP (3 P!)
```

**Log di verifica:**
```python
log.info("[GRABBIT] extra_params: %s", extra)
log.info("[GRABBIT] ydl_opts finali → %s", loggable)
log.info("[GRABBIT] postprocessors → %s", [pp.get('key') for pp in pps])
```

---

### PHASE 8 — PERSISTENZA QUEUE

**File:** `~/.config/grabbit/queue.json` (Linux/macOS) · `%APPDATA%\grabbit\queue.json` (Windows)

**Struttura JSON:**
```json
{
  "version": 1,
  "order": ["id1", "id2"],
  "items": {
    "id1": { "id", "url", "title", "thumbnail", "status", "progress", "error", "filename", "options" }
  }
}
```

**Politica di ripristino al riavvio:**
- `DOWNLOADING` → `PENDING` (era interrotto, riparte dall'inizio; yt-dlp usa `.part` automaticamente)
- `PAUSED` → `PAUSED` (scelta esplicita dell'utente, va rispettata)
- `COMPLETED` → `COMPLETED` (mantieni come history)
- `ERROR` → `ERROR` (l'utente vede cosa è fallito)
- `CANCELLED` → non salvato

**Scheduling al riavvio:**
`_load_queue()` NON chiama `_schedule()` perché i WS listener non sono ancora registrati. Lo `_schedule()` viene triggerato quando il primo client WS si connette:
```python
if len(_ws_clients) == 1 and queue.auto_start:
    loop.run_in_executor(None, queue._schedule)
```

**Impostazione auto-start:**
Aggiunto `auto_start_downloads: True` (default) in Settings → Download. Se disattivato, gli item restano PENDING finché l'utente non preme "Resume All".

---

### LOGO HEADER — Immagine unificata

**Cambiamento:** sostituiti `icon.png` (coniglio) + `logo.png` (testo) separati con `logo_full.png` — immagine 1458×360 RGBA che combina entrambi. Dimensione header: `height: 36px; width: auto`.

Il favicon (`icon.png`) rimane separato per la tab del browser.

---

### SELETTORE LINGUA CUSTOM — Correzione `data-lang` nei sub

**Causa bug ricerca per-entry:** gli elementi `<div class="sub-item">` creati da `renderEntrySubList()` non avevano `el.dataset.lang` impostato → `filterEntrySubItems` leggeva sempre `undefined`.

**Pattern corretto:**
```javascript
el.dataset.lang = lang;     // necessario per il filtro ricerca
el.dataset.auto = String(auto);
el.innerHTML = `<span class="sub-item-lang">${langName(lang)}</span>...`;
```

Stessa correzione applicata a `renderSubtitles()` per il singolo video.

---

### TOGGLE SLIDER — Light Mode

**Problema:** `.toggle-slider` in light mode usava `background: var(--border-str)` = `rgba(0,0,0,0.18)` su sfondo bianco → quasi invisibile.

**Fix:**
```css
[data-theme="light"] .toggle-slider { background: #a0aab8; }
```

---

### IMPOSTAZIONE AUTO-START DOWNLOADS

**Flusso completo:**
1. `settings_manager.py`: `"auto_start_downloads": True` in `_DEFAULTS`
2. `routes.py`: `queue.auto_start = settings.get("auto_start_downloads", True)` al module level
3. `routes.py` `save_settings()`: `queue.auto_start = bool(patch.get("auto_start_downloads", True))`
4. `download_queue.py` `add()`: `if self.auto_start: self._schedule()`
5. `index.html`: toggle in Settings → DOWNLOAD con hint esplicativo
6. `app.js`: `setChk('s-auto-start', ...)` in `renderSettings()` e `chk('s-auto-start')` in `saveSettingsFromForm()`

---

### CONVERSIONE SOTTOTITOLI — Fix `FFmpegSubtitlesConvertor`

**Problema precedente:** `convertsubtitles` come chiave nel dict params yt-dlp non è affidabile tra versioni.

**Soluzione stabile:**
```python
ydl_opts.setdefault("postprocessors", []).append({
    "key":    "FFmpegSubtitlesConvertor",
    "format": sub_fmt,
})
```
`postprocessors` list è l'API stabile documentata di yt-dlp.

---

### BUG FIX — `FFmpegMetadataPP` con tre P

**Errore:** `FFmpegMetaDataPPP` — yt-dlp aggiunge `PP` al `key` nella lista `postprocessors`. Se il key era già `FFmpegMetadataPP`, cercava `FFmpegMetadataPPPP`.

**Regola:** nel dict `postprocessors`, il `key` è il nome della classe **senza** il suffisso `PP`:
- ✓ `"key": "FFmpegMetadata"` → classe `FFmpegMetadataPP`
- ✓ `"key": "FFmpegSubtitlesConvertor"` → classe `FFmpegSubtitlesConvertorPP`
- ✓ `"key": "FFmpegEmbedSubtitle"` → classe `FFmpegEmbedSubtitlePP`

**Fix applicato:** per `addmetadata` e `embedthumbnail` rimosso l'append manuale — yt-dlp aggiunge automaticamente il PP quando il flag booleano è `True` nel dict.

---

## Decisioni Architetturali Chiave

| Decisione | Motivazione |
|---|---|
| `os._exit(0)` per chiudere l'app | Unico modo thread-safe di terminare da bridge non-GUI; evita deadlock con Qt event loop |
| `QTimer.singleShot` a catena per frameless | Il timer deve essere creato sul GUI thread; catena: worker → singleShot(0,GUI) → singleShot(0,GUI) |
| `postprocessors` list per yt-dlp invece di flag singoli | API stabile, ordine garantito, key names senza ambiguità |
| Event delegation per search-clear X | Un solo listener gestisce tutti i campi `.sub-search` presenti e futuri |
| `ModalState.params` invece di DOM per `_readModalControls` | Solo la sezione corrente è nel DOM; le altre sezioni sono in state ma non nel DOM |
| `sel.subsEnabled` inizializzato al primo open accordion | Evita falsi positivi orange state per entry senza sottotitoli disponibili |
| `queue.json` salvato ad ogni modifica | Garantisce che nessun download in pending vada perso al riavvio |
| `_schedule()` triggerato al primo WS connect | Garantisce che i listener siano attivi prima che i thread emettano progress update |

---

## File Modificati in Questa Sessione

| File | Percorso | Modifiche principali |
|---|---|---|
| `main.py` | `/` | Frameless post-init, maximize toggle, close via `os._exit(0)`, window control bridge |
| `download_queue.py` | `app/core/` | Persistenza queue, auto_start, fix pause recovery, fix clear_all is_paused, fix _emit_item zombie |
| `ytdlp_wrapper.py` | `app/core/` | `_apply_extra_params()`, `_strip_ansi()`, fix embed sub order, fix FFmpegMetadataPP key |
| `settings_manager.py` | `app/core/` | `presets`, `auto_start_downloads` nei defaults |
| `routes.py` | `app/api/` | `queue.auto_start` sync, WS schedule on connect, `extra_params` passthrough |
| `app.js` | `app/ui/static/js/` | Modal yt-dlp, preset, lang-picker, accordions V/A/S, auto-select playlist, bug fix ricerca sub |
| `main.css` | `app/ui/static/css/` | Modal styles, lang-picker, search-clear, format-group separators, toggle light mode |
| `index.html` | `app/ui/` | Modal HTML, pulsanti finestra, logo unificato, accordion V/A/S, auto-start toggle |
| `locale/*.json` | `app/ui/locale/` | Chiavi: `sub_lang_none`, `auto_start`, `auto_start_hint` (6 lingue) |

---

*Prossima sessione: Phase 9 — Notifiche & Sistema (conferma chiusura durante download/analisi, notifiche OS, tray icon).*

---

## Sessione 4 — Luglio 2026
**Phase 9 (Notifiche & Sistema) · Phase 10 (Packaging) · Rilascio v1.0.0**

---

### PHASE 9 — Conferma chiusura durante download/analisi

**Problema:** chiudere l'app durante un download attivo o un'analisi in corso causava la perdita del lavoro senza alcun avviso.

**Soluzione:** tutte le vie di chiusura confluiscono in un'unica funzione JS `requestClose()`. Il pulsante X della UI la chiama direttamente; la chiusura a livello OS (Alt+F4) è intercettata dall'handler `window.events.closing` in `main.py`, che esegue `evaluate_js("window.requestClose()")` e ritorna `False` per annullare la chiusura nativa.

`isAppBusy()` mostra il dialog di conferma se `State.analyzing` **oppure** `State.queueStats.active > 0`. I **pending NON vengono contati** — la coda è persistita su `queue.json`, quindi chiudere con item in attesa non perde nulla.

**Bug risolto (stato coda stantio):** `State.queueStats` veniva aggiornato solo da `renderQueue`, quindi durante i download era disallineato e la conferma non scattava. Fix: centralizzato `State.queueStats = stats` dentro `renderStats()` — unica fonte di verità, attraversata da ogni evento WS.

---

### PHASE 9 — Notifica di sistema al completamento

**Implementazione:** nuovo modulo `app/core/notifier.py` con `notify(title, body, icon)` per-piattaforma e best-effort (macOS `osascript`, Linux `notify-send`, Windows `winotify`; gli errori vengono inghiottiti). `GrabbitAPI.notify()` passa `assets/icon.png`.

Frontend: `notifyIfBackground(body)` invia la notifica **solo** se `settings.notify_on_complete` **e** `!document.hasFocus()` — niente notifiche se la finestra è già davanti. Chiamata nell'handler WS `status` per completed/error.

**Iterazione scartata:** tentato un "riepilogo batch" (una sola notifica a fine coda) con gate su `active===0 && pending===0`. Causava una regressione: il rilevamento di "coda svuotata" bloccava del tutto le notifiche. **Revert** a notifica per-item. Nota per il futuro: se si rivuole il batch, usare un timer di **debounce**, non il conteggio della coda.

**Nota XFCE (non era un bug GRABBIT):** le notifiche non comparivano nel log di `xfce4-notifyd` perché il logging era impostato su "solo durante Non Disturbare". Le versioni recenti usano SQLite (`~/.cache/xfce4/notifyd/log.sqlite`), non un file di testo.

---

### PHASE 9 — Override destinazione per-download + accesso al log

- **Destinazione per-download:** `State.destDir` + righe "Destinazione" (campo + Sfoglia + ↺ reset) nei pannelli risultato. `addCurrentToQueue`/`addPlaylistToQueue` usano `State.destDir || settings.output_dir`. Riusa `pick_folder()` nativo; il backend supportava già `output_dir` per-item.
- **Diagnostica:** `GrabbitAPI.open_log_folder()` + sezione "Diagnostica" in Impostazioni con pulsante "Apri cartella log".
- **Tray icon:** rimandata — pywebview non ha API tray; serve codice nativo per piattaforma.
- **Auto-apri cartella a fine download:** scartata, superata dall'override manuale della destinazione.

---

### PHASE 10 — Resolver risorse frozen-aware

**Problema:** da impacchettato, i percorsi a `app/ui` e `assets` cambiano (PyInstaller estrae in `sys._MEIPASS`).

**Soluzione:** nuovo `app/core/paths.py`: `_base_dir()` ritorna `sys._MEIPASS` se frozen, altrimenti la root del progetto. Esporta `BASE_DIR`, `UI_DIR`, `ASSETS_DIR`. `server.py` e `main.py` aggiornati.

---

### PHASE 10 — Trascinamento finestra frameless (Linux)

**Problema:** la finestra è frameless via Qt post-init (non via `frameless=True` di pywebview, che segfaulta su Linux) → i meccanismi drag di pywebview sono inattivi → la finestra non si spostava.

**Soluzione:** `GrabbitAPI.start_drag()` chiama `windowHandle().startSystemMove()` (move nativo del window manager via `_NET_WM_MOVERESIZE`). `app.js` aggancia il `mousedown` su `.app-header` (escludendo i pulsanti, solo tasto sinistro) → `start_drag`.

---

### PHASE 10 — Rilevamento ffmpeg autonomo (anticipato dalla Phase 11)

**Problema:** l'app impacchettata riportava "ffmpeg is not installed" anche con ffmpeg presente. yt-dlp si affidava al solo PATH del processo, più povero di quello della shell interattiva.

**Causa radice:** ffmpeg dell'utente in `/usr/local/bin/ffmpeg/ffmpeg` — build statica in una sottocartella aggiunta al `$PATH` da `.bashrc`/pyenv. Non ereditata dal processo frozen; `shutil.which` la salta perché la cartella non è un eseguibile.

**Soluzione — cascata in `app/core/ffmpeg.py`:**
```
1. percorso configurato in Settings (se valido)
2. PATH del processo            → shutil.which("ffmpeg")
3. PATH della shell di login    → $SHELL -lic 'printf "%s" "$PATH"' poi shutil.which(path=...)
4. posizioni note delle build statiche
```
Lo step 3 ricostruisce il PATH che vede il terminale, risolvendo il caso in modo autonomo senza percorsi hardcoded. Il risultato è passato a yt-dlp via `ffmpeg_location`. Lo step shell-di-login è POSIX-only (`sys.platform != "win32"`).

**UX correlata:** sezione "FFmpeg" in Impostazioni (campo + Sfoglia con nuovo `pick_file()` nativo + riga di stato verde/rossa), endpoint `GET /api/ffmpeg`, **banner** sotto l'header quando ffmpeg non è raggiungibile.

---

### PHASE 10 — Snellimento del bundle (628 → 454 MB)

**Scoperta chiave:** gli `excludes` nello spec **non** rimuovono i blob `.so` (l'hook PySide6 li imbarca comunque). Il taglio va fatto **dopo** il build, eliminando fisicamente i file.

**Interventi:**
1. Rimosso `collect_submodules('qtpy')` dallo spec → ~40 MB, trascinava tutti i binding PySide6 inutili.
2. Filtro dei locale WebEngine: tenuti solo i 7 necessari (`en-US` + le 6 lingue dell'app).
3. **Pruning post-build** in `build.py`: rimozione di `Qt3D*`, `Quick3D*`, `Charts`, `Multimedia`, `Location`, `Pdf`, `WebEngineQuick` e relative directory `qml/`.

**Cosa NON si tocca** (dipendenze reali di WebEngine): `Quick`, `Qml`, `QmlModels`, `ShaderTools`, `OpenGL`, `Network`, `WebChannel`, `PrintSupport`, `WaylandClient`, `WebEngineCore` (195 MB), `icudata` (31 MB).

---

### PHASE 10 — `build.py` e AppImage

**`build.py`:** orchestratore → PyInstaller → prune Qt → AppImage (opzionale). Flag `--no-build` / `--no-prune` / `--appimage`.

**Bug risolto (symlink penzolanti):** PyInstaller rispecchia alcune `.so` come symlink in `_internal/`. Il prune cancellava le librerie reali lasciando symlink orfani → `shutil.copytree` falliva. Fix: sweep dei symlink penzolanti dopo il prune + `copytree(..., symlinks=True)`.

**Bug risolto (conteggio dimensioni gonfiato):** il report sommava i symlink versionati due volte (782 MB vs 454 reali). Fix: `_real_size()` ignora i symlink; totale via `du`.

**Compressione AppImage:** `appimagetool` corrente supporta solo `zstd` (non xz). `build_appimage` tenta il compressore configurato e ripiega automaticamente. Lanciato con `APPIMAGE_EXTRACT_AND_RUN=1` (niente FUSE).

**Risultato finale:** `GRABBIT-x86_64.AppImage` da **188 MB**.

---

### POLISH — UI Impostazioni (allineamenti, titoli, ritmo)

- **Toggle disallineati:** `.settings-toggle-row` mancava `flex-direction: row` → ereditava `column` da `.settings-field`. Fix: aggiunto `flex-direction: row`.
- **Titoli troppo piccoli:** `.settings-section-title` a 11px vs 13px delle label → gerarchia invertita. Portato a 14px con colore più marcato.
- **Righe appiccicate:** aggiunti margini verticali ai `.settings-field` figli diretti della sezione.

---

### POLISH — Font Manrope (bundled)

Integrato **Manrope** (variabile, SIL OFL) da `@fontsource-variable/manrope`: due woff2 (latin + latin-ext, ~39 KB) in `app/ui/static/fonts/`, due `@font-face` (pesi 200–800) con `unicode-range`, `"Manrope"` in testa a `--font`. Bundling automatico (è sotto `app/ui`). Nessun tocco allo spec.

---

### POLISH — Default Light Mode + lingua di sistema

- **Default Light:** cambiato in 4 punti: `settings_manager.py`, `data-theme` nell'HTML, due fallback in `app.js`. Vale solo per installazioni nuove.
- **Lingua all'avvio:** `_detect_system_language()` legge `LANGUAGE`/`LC_*`/`LANG` (+ `getdefaultlocale` come fallback Windows), mappa su una delle 6 lingue (default `en`). Colpisce solo il primo avvio; ignora `C`/`POSIX`.

---

### POLISH — Versione in app + icona connessione

- **Versione:** fonte di verità unica in `app/version.py`. Servita da `GET /api/version`, mostrata accanto al logo (`v1.0.0`).
- **Icona connessione:** sostituito il pallino con un'icona **spina** SVG (`.ws-icon`), colorata per stato (verde connesso, ambra con pulse in riconnessione, rosso disconnesso).

---

### BUG FIX — `resume_all` non avviava i pending

**Problema:** con auto-start OFF, i pending non partivano premendo "Resume All".

**Causa:** `resume_all()` impostava `is_paused = False` e riprendeva solo gli item `PAUSED`. Se non c'era nulla in pausa, `_schedule()` non veniva mai invocato.

**Fix:** chiamata a `self._schedule()` **incondizionata** in coda a `resume_all()`.

---

### RILASCIO v1.0.0

Prodotti `README.md` (logo centrato, badge shields.io, screenshot della coda), `CHANGELOG.md` (Keep a Changelog + SemVer), `LICENSE` (MIT). Prima release pubblica su **github.com/klode82/grabbit** con AppImage Linux come asset.

---

## Sessione 5 — Luglio 2026
**Supporto Windows · Rilascio v1.0.1**

---

### WINDOWS — Finestra cross-platform

**Problema:** su Windows pywebview usa **WebView2** (non Qt): la finestra si apriva col frame nativo di Windows, e chiudendo dalla X nativa si **congelava** (deadlock tra l'handler `closing` e `evaluate_js` su WebView2).

**Soluzione — ramo per piattaforma in `main.py`:**

`_native_frameless = sys.platform != "linux"` → `frameless=True` alla creazione su Windows/macOS (lì funziona); Linux resta sulla via Qt post-init (dove il frameless nativo segfaulta).

- `maximize_window`: Linux via Qt (`showMaximized`/`showNormal`); Windows/macOS via pywebview nativo (`window.maximize()`/`restore()` con flag `_maximized`).
- `start_drag`: guardato Linux-only.
- Il freeze sparisce: senza frame nativo, la chiusura passa solo dal pulsante UI → `close_window()` → `os._exit(0)`.

---

### WINDOWS — Trascinamento via `pywebview-drag-region`

**Problema:** `startSystemMove()` è Qt/Linux; su Windows va usata la classe CSS `pywebview-drag-region`.

**Soluzione:** marcati come zone trascinabili il **logo** e un nuovo **spaziatore centrale** (`.header-spacer`, `flex:1`). Rimosso `-webkit-app-region: drag` dall'intero header (copriva anche i pulsanti) e riapplicato solo a logo/spaziatore; `no-drag` esplicito su `ws-indicator` e `window-controls` per sicurezza. Su Linux la classe è inerte — il drag Qt continua a funzionare senza conflitti.

---

### WINDOWS — Flash all'avvio (bianco → nero → app)

**Problema:** sequenza bianco → nero → UI durante l'inizializzazione di WebView2.

**Soluzione:** `background_color="#F2F2F7"` su `create_window` (colore del tema Light) + `style="background-color:#F2F2F7"` inline sull'`<html>`, così la pagina è già chiara prima che il CSS carichi. Sequenza ridotta a chiaro → app.

---

### WINDOWS — SSL `CERTIFICATE_VERIFY_FAILED`

**Problema:** da sorgente su Windows, i download fallivano con `CERTIFICATE_VERIFY_FAILED`. Python su Windows non usa il magazzino certificati di sistema.

**Soluzione:** da sorgente `pip install --upgrade certifi`. Per l'`.exe`: `collect_data_files('certifi')` nello spec Windows.

---

### WINDOWS — Spec e build cross-platform

- **`GRABBIT-win.spec`:** spec dedicato per il backend EdgeChromium — niente PySide6/Qt, hiddenimports `clr` (pythonnet), `collect_data_files('webview')` (DLL WebView2) + `collect_data_files('certifi')`, `excludes` di PySide6/PyQt, `console=False` per la release (True in fase debug).
- **`build.py` cross-platform:** rileva `sys.platform`. Su Windows: usa `GRABBIT-win.spec` e crea `GRABBIT-<ver>-windows-x64.zip` (versione letta da `app_version()` via regex su `app/version.py`). Su Linux: prune + AppImage come prima. Nuovo flag `--no-zip`.

**Distribuzione Windows:** zip portabile (onedir) — l'utente estrae e lancia `GRABBIT.exe`. Nessuna dipendenza di installazione; installer Inno Setup valutato come passo futuro.

---

### RILASCIO v1.0.1

Primo build Windows confermato: frameless, drag, minimize/maximize/close funzionanti, niente flash. `app/version.py` → `1.0.1`. Release su GitHub con due asset: `GRABBIT-x86_64.AppImage` (Linux) e `GRABBIT-1.0.1-windows-x64.zip` (Windows).

---

## Decisioni Architetturali Chiave (Sessioni 4–5)

| Decisione | Motivazione |
|---|---|
| Rilevamento ffmpeg via PATH della shell di login | Ricostruisce il PATH del terminale (pyenv/.bashrc) senza percorsi hardcoded; risolve il binario in sottocartella non ereditata dal processo frozen |
| `ffmpeg_location` passato esplicitamente a yt-dlp | La detection PATH interna di yt-dlp è inaffidabile nell'app impacchettata |
| Pruning Qt **post-build** in `build.py`, non via `excludes` | Gli `excludes` dello spec non rimuovono i blob `.so`; serve cancellarli fisicamente a valle |
| `frameless=True` solo su Windows/macOS; Qt post-init su Linux | Su Linux il frameless nativo segfaulta; su Windows/macOS è la via corretta e più semplice |
| Drag: `startSystemMove` (Linux) vs `pywebview-drag-region` (Win/macOS) | Backend diversi (Qt vs WebView2); le due vie convivono senza conflitti |
| `background_color` + sfondo inline HTML | Elimina il flash di init di WebView2 senza logica di show-on-load |
| Default Light + lingua da OS solo al primo avvio | La preferenza salvata dell'utente deve sempre prevalere |
| Versione in `app/version.py` (fonte unica) | Letta da API (header app) e da `build.py` (nome zip/AppImage); zero duplicazione |
| `_schedule()` incondizionato in `resume_all` | I PENDING con auto-start OFF non partivano se non c'era nulla in PAUSED |
| Distribuzione: AppImage (Linux) + zip portabile (Windows) | Self-contained, nessuna installazione richiesta all'utente |

---

## File Aggiunti/Modificati (Sessioni 4–5)

| File | Percorso | Modifiche principali |
|---|---|---|
| `paths.py` | `app/core/` | **(nuovo)** resolver risorse frozen-aware (`sys._MEIPASS`) |
| `ffmpeg.py` | `app/core/` | **(nuovo)** cascata di rilevamento ffmpeg (configurato → PATH → shell login → posizioni note) |
| `version.py` | `app/` | **(nuovo)** fonte di verità unica della versione |
| `notifier.py` | `app/core/` | **(nuovo)** notifiche native per-piattaforma (macOS/Linux/Windows) |
| `GRABBIT-win.spec` | `/` | **(nuovo)** spec Windows (EdgeChromium, certifi, no Qt) |
| `main.py` | `/` | conferma chiusura, finestra cross-platform (frameless/maximize/drag/background), `pick_file` |
| `download_queue.py` | `app/core/` | fix `resume_all` (pending), destinazione per-item |
| `ytdlp_wrapper.py` | `app/core/` | `ffmpeg_location` via `resolve_ffmpeg()` |
| `settings_manager.py` | `app/core/` | `ffmpeg_path`, default Light, `_detect_system_language()` |
| `routes.py` | `app/api/` | endpoint `/api/ffmpeg`, `/api/version` |
| `app.js` | `app/ui/static/js/` | requestClose/isAppBusy, destinazione per-download, drag header, ffmpeg banner, versione, icona connessione |
| `api.js` | `app/ui/static/js/` | `getFfmpegInfo`, `getVersion` |
| `index.html` | `app/ui/` | banner ffmpeg, sezioni FFmpeg/Diagnostica, versione + icona header, drag-region, sfondo inline |
| `main.css` | `app/ui/static/css/` | FFmpeg/banner, fix toggle/titoli/ritmo verticale, Manrope `@font-face`, `.ws-icon`, drag-region |
| `GRABBIT.spec` | `/` | rimosso qtpy, `excludes`, filtro locale WebEngine |
| `build.py` | `/` | cross-platform: prune+AppImage (Linux) / build+zip versionato (Windows) |
| `README.md` | `/` | **(nuovo)** logo, badge shields.io, screenshot, install, build, stack |
| `CHANGELOG.md` | `/` | **(nuovo)** Keep a Changelog, voci 1.0.0 e 1.0.1 |
| `LICENSE` | `/` | **(nuovo)** MIT 2026 |
| `app/ui/static/fonts/` | `app/ui/static/fonts/` | **(nuovi)** woff2 Manrope (latin + latin-ext) |

---

*Prossima sessione: Phase 11 — bundling di ffmpeg/yt-dlp (il resolver punterà prima alla copia impacchettata), tray icon, eventuale installer Windows (Inno Setup), build macOS.*
