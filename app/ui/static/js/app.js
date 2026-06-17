/* ─────────────────────────────────────────────────────────────────────────
   GRABBIT — Main app
   ───────────────────────────────────────────────────────────────────────── */

/* ── State ─────────────────────────────────────────────────────────────────── */
const State = {
  settings: {},
  currentResult: null,       // last analyzed video
  selectedVideo: null,       // chosen video format_id
  selectedAudio: null,       // chosen audio format_id
  selectedSub: null,         // { lang, auto }
  queueItems: [],
  queueStats: { total: 0, pending: 0, active: 0, completed: 0, error: 0 },
  // Playlist
  playlistInfo: null,
  playlistEntries: [],       // fully analyzed entries
  playlistSelected: new Set(),
};

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function qs(sel, ctx = document) { return ctx.querySelector(sel); }
function qsa(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

function fmtDuration(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

/* ── Toast ─────────────────────────────────────────────────────────────────── */
function toast(msg, type = 'info', duration = 3500) {
  const c = qs('#toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

/* ── Theme ─────────────────────────────────────────────────────────────────── */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  qs('#theme-toggle').setAttribute('data-i18n-title', theme === 'dark' ? 'header.light_mode' : 'header.dark_mode');
  qs('#theme-toggle-icon').textContent = theme === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  API.saveSettings({ theme: next });
  State.settings.theme = next;
}

/* ── Tab navigation ────────────────────────────────────────────────────────── */
function switchTab(id) {
  qsa('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
  qsa('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${id}`));
}

/* ── URL input ─────────────────────────────────────────────────────────────── */
async function handleAnalyze() {
  const url = qs('#url-input').value.trim();
  if (!url) {
    qs('#url-input').focus();
    return;
  }
  resetResult();
  showLoading(true, I18N.t('analyze.loading'));

  try {
    const result = await API.analyze(url);
    showLoading(false);

    if (result.type === 'playlist') {
      handlePlaylistResult(result);
    } else {
      handleVideoResult(result);
    }
  } catch (err) {
    showLoading(false);
    toast(err.message, 'error');
  }
}

function resetResult() {
  State.currentResult = null;
  State.selectedVideo = null;
  State.selectedAudio = null;
  State.selectedSub = null;
  State.playlistInfo = null;
  State.playlistEntries = [];
  qs('#result-card').classList.remove('visible');
  qs('#playlist-analysis').classList.remove('visible');
}

/* ── Loading indicator ─────────────────────────────────────────────────────── */
function showLoading(visible, label = '') {
  const el = qs('#analyze-loading');
  el.classList.toggle('visible', visible);
  if (label) qs('#analyze-loading-label').textContent = label;
  const fill = qs('#analyze-progress-fill');
  fill.style.width = visible ? '40%' : '0%';
  fill.classList.toggle('indeterminate', visible);
  qs('#analyze-btn').disabled = visible;
}

/* ── Video result ──────────────────────────────────────────────────────────── */
function handleVideoResult(result) {
  State.currentResult = result;

  // thumbnail
  const thumb = qs('#result-thumb');
  if (result.thumbnail) {
    thumb.src = result.thumbnail;
    thumb.style.display = 'block';
    qs('#result-thumb-ph').style.display = 'none';
  } else {
    thumb.style.display = 'none';
    qs('#result-thumb-ph').style.display = 'flex';
  }

  qs('#result-title').textContent = result.title || '—';
  qs('#result-duration').textContent = fmtDuration(result.duration);
  qs('#result-extractor').textContent = result.extractor || '';
  qs('#result-uploader').textContent = result.uploader || '';

  // summary badges
  const bestV = result.best_video;
  const bestA = result.best_audio;
  qs('#result-best-video').textContent = bestV ? bestV.quality_label : '—';
  qs('#result-best-audio').textContent = bestA ? `${bestA.quality_label}` : '—';
  qs('#result-has-subs').textContent = result.has_subtitles
    ? I18N.t('analyze.subs_yes')
    : I18N.t('analyze.subs_no');

  renderVideoFormats(result.video_formats);
  renderAudioFormats(result.audio_formats);
  renderSubtitles(result.subtitles);
  applyDefaults(result);

  qs('#result-card').classList.add('visible');
}

function applyDefaults(result) {
  const s = State.settings;

  // Pre-select video
  if (s.default_video_quality === 'best' && result.video_formats.length) {
    selectVideoFormat(result.video_formats[0].format_id);
  } else if (s.default_video_quality) {
    const target = parseInt(s.default_video_quality);
    const match = result.video_formats.find(f => (f.height || 0) <= target) || result.video_formats[0];
    if (match) selectVideoFormat(match.format_id);
  }

  // Pre-select audio
  if (result.audio_formats.length) {
    const langMatch = s.default_audio_lang
      ? result.audio_formats.find(f => f.language === s.default_audio_lang)
      : null;
    selectAudioFormat((langMatch || result.audio_formats[0]).format_id);
  }

  // Pre-select subtitle
  if (s.default_sub_lang) {
    const manual = result.subtitles?.manual?.[s.default_sub_lang];
    const auto   = result.subtitles?.automatic?.[s.default_sub_lang];
    if (manual) selectSub(s.default_sub_lang, false);
    else if (auto && s.default_sub_auto) selectSub(s.default_sub_lang, true);
  }
}

/* ── Format chips ──────────────────────────────────────────────────────────── */
function renderVideoFormats(formats) {
  const wrap = qs('#video-formats');
  wrap.innerHTML = '';
  if (!formats.length) {
    wrap.innerHTML = `<span class="muted small">${I18N.t('formats.none')}</span>`;
    return;
  }
  formats.forEach(f => {
    const chip = document.createElement('button');
    chip.className = 'format-chip';
    chip.dataset.formatId = f.format_id;
    chip.textContent = f.combined
      ? `${f.quality_label} (${f.ext})`
      : `${f.quality_label}${f.fps ? ` ${f.fps}fps` : ''} · ${f.ext}`;
    chip.title = [
      f.vcodec,
      f.filesize_human ? `~${f.filesize_human}` : '',
    ].filter(Boolean).join(' · ');
    chip.onclick = () => selectVideoFormat(f.format_id);
    wrap.appendChild(chip);
  });
}

function selectVideoFormat(id) {
  State.selectedVideo = id;
  qsa('.format-chip', qs('#video-formats')).forEach(c => {
    c.classList.toggle('selected', c.dataset.formatId === id);
  });
}

function renderAudioFormats(formats) {
  const wrap = qs('#audio-formats');
  wrap.innerHTML = '';
  if (!formats.length) {
    wrap.innerHTML = `<span class="muted small">${I18N.t('formats.none')}</span>`;
    return;
  }
  formats.forEach(f => {
    const chip = document.createElement('button');
    chip.className = 'format-chip';
    chip.dataset.formatId = f.format_id;
    const lang = f.language ? ` [${f.language}]` : '';
    chip.textContent = `${f.quality_label}${lang} · ${f.ext}`;
    chip.title = f.filesize_human ? `~${f.filesize_human}` : '';
    chip.onclick = () => selectAudioFormat(f.format_id);
    wrap.appendChild(chip);
  });
}

function selectAudioFormat(id) {
  State.selectedAudio = id;
  qsa('.format-chip', qs('#audio-formats')).forEach(c => {
    c.classList.toggle('selected', c.dataset.formatId === id);
  });
}

/* ── Subtitle list ─────────────────────────────────────────────────────────── */
function renderSubtitles(subs) {
  const wrap = qs('#sub-list');
  wrap.innerHTML = '';

  const all = [];
  Object.entries(subs.manual  || {}).forEach(([lang]) => all.push({ lang, auto: false }));
  Object.entries(subs.automatic || {}).forEach(([lang]) => {
    if (!subs.manual?.[lang]) all.push({ lang, auto: true });   // avoid duplicates
  });

  if (!all.length) {
    wrap.innerHTML = `<span class="muted small">${I18N.t('subtitles.none')}</span>`;
    return;
  }

  // "None" option
  const none = document.createElement('div');
  none.className = 'sub-item selected';
  none.dataset.lang = '__none__';
  none.innerHTML = `<span class="sub-item-lang">${I18N.t('subtitles.none_option')}</span>`;
  none.onclick = () => selectSub(null, false);
  wrap.appendChild(none);

  all.forEach(({ lang, auto }) => {
    const el = document.createElement('div');
    el.className = 'sub-item';
    el.dataset.lang = lang;
    el.dataset.auto = auto;
    el.innerHTML = `
      <span class="sub-item-lang">${lang}</span>
      <span class="sub-item-type ${auto ? 'auto' : 'manual'}">
        ${auto ? I18N.t('subtitles.auto') : I18N.t('subtitles.manual')}
      </span>`;
    el.onclick = () => selectSub(lang, auto);
    wrap.appendChild(el);
  });
}

function selectSub(lang, auto) {
  State.selectedSub = lang ? { lang, auto } : null;
  qsa('.sub-item', qs('#sub-list')).forEach(el => {
    const active = lang
      ? (el.dataset.lang === lang && String(el.dataset.auto) === String(auto))
      : (el.dataset.lang === '__none__');
    el.classList.toggle('selected', active);
  });
}

/* ── Add to queue ──────────────────────────────────────────────────────────── */
async function addCurrentToQueue() {
  const result = State.currentResult;
  if (!result) return;

  const options = {
    format_video: State.selectedVideo,
    format_audio: State.selectedAudio,
    thumbnail:    result.thumbnail,
    output_dir:   State.settings.output_dir,
  };
  if (State.selectedSub) {
    options.subtitle_lang = State.selectedSub.lang;
    options.subtitle_auto = State.selectedSub.auto;
    options.embed_subs    = State.settings.embed_subs;
  }

  try {
    await API.addToQueue(result.webpage_url, result.title, options);
    toast(I18N.t('queue.added'), 'success');
    qs('#url-input').value = '';
    resetResult();
    switchTab('queue');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ── Queue rendering ───────────────────────────────────────────────────────── */
function renderQueue(items, stats) {
  State.queueStats = stats;
  renderStats(stats);
  updateQueueBadge(stats.total);

  const list = qs('#dl-list');
  if (!items.length) {
    list.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 3v12m0 0l-4-4m4 4l4-4M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2"/>
        </svg>
        <p data-i18n="queue.empty">${I18N.t('queue.empty')}</p>
      </div>`;
    return;
  }

  list.innerHTML = '';
  items.forEach(item => {
    list.appendChild(buildDlItem(item));
  });
}

function buildDlItem(item) {
  const el = document.createElement('div');
  el.className = `dl-item status-${item.status}`;
  el.id = `dl-${item.id}`;

  const thumbHTML = item.thumbnail
    ? `<img class="dl-thumb" src="${item.thumbnail}" alt="" onerror="this.style.display='none'">`
    : `<div class="dl-thumb-ph">⬇</div>`;

  const isActive   = item.status === 'downloading';
  const isComplete = item.status === 'completed';
  const isError    = item.status === 'error';

  const progressHTML = isActive ? `
    <div class="dl-progress-row">
      <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${item.progress}%"></div></div>
      <span class="dl-pct">${item.progress.toFixed(0)}%</span>
    </div>
    <div class="dl-meta">
      <span class="dl-speed">${item.speed || ''}</span>
      ${item.eta ? `· ETA ${item.eta}` : ''}
    </div>` : '';

  const errorHTML = isError
    ? `<div class="dl-meta" style="color:var(--danger)">${item.error || 'Error'}</div>` : '';

  const badgeText = I18N.t(`queue.status.${item.status}`);
  const pct = isActive ? `${item.progress.toFixed(0)}%` : '';

  el.innerHTML = `
    ${thumbHTML}
    <div class="dl-info">
      <div class="dl-title" title="${item.title}">${item.title}</div>
      ${progressHTML}
      ${errorHTML}
    </div>
    <div class="dl-actions">
      <span class="dl-status-badge badge-${item.status}">${badgeText}</span>
      ${!isComplete ? `<button class="btn-icon" onclick="removeItem('${item.id}')" data-i18n-title="queue.remove">✕</button>` : ''}
      ${isError ? `<button class="btn-icon" onclick="retryItem('${item.id}')" title="Retry">↩</button>` : ''}
    </div>`;
  return el;
}

function updateDlItem(item) {
  const el = qs(`#dl-${item.id}`);
  if (!el) return;
  const fresh = buildDlItem(item);
  el.replaceWith(fresh);
}

function renderStats(stats) {
  qs('#stat-total').textContent  = stats.total;
  qs('#stat-active').textContent = stats.active;
  qs('#stat-done').textContent   = stats.completed;
}

function updateQueueBadge(total) {
  const badge = qs('#queue-badge');
  badge.textContent = total;
  badge.classList.toggle('hidden', total === 0);
}

async function removeItem(id) {
  try { await API.removeFromQueue(id); } catch {}
  qs(`#dl-${id}`)?.remove();
}

async function retryItem(id) {
  // TODO: Phase 6 — re-analyze and re-add
  toast('Retry coming in Phase 6', 'info');
}

/* ── Playlist flow ─────────────────────────────────────────────────────────── */
async function handlePlaylistResult(playlist) {
  State.playlistInfo = playlist;
  State.playlistEntries = [];
  State.playlistSelected = new Set(playlist.entries.map(e => e.id));

  const panel = qs('#playlist-analysis');
  panel.classList.add('visible');
  qs('#playlist-title-text').textContent = playlist.title || I18N.t('playlist.untitled');
  qs('#playlist-count-text').textContent = I18N.t('playlist.count', { n: playlist.count });

  const itemsWrap = qs('#playlist-items');
  itemsWrap.innerHTML = '';

  // Render stubs immediately
  playlist.entries.forEach(entry => {
    itemsWrap.appendChild(buildPlaylistEntry(entry, 'loading'));
  });

  // Update progress label
  const progressLabel = qs('#playlist-progress-label');
  let done = 0;

  // Analyze each entry sequentially (could be parallelised later)
  for (const entry of playlist.entries) {
    try {
      const full = await API.analyzePlaylistEntry(entry.url);
      State.playlistEntries.push({ ...full, _stub: entry });
      const entryEl = qs(`#pe-${entry.id}`);
      if (entryEl) {
        entryEl.querySelector('.playlist-entry-status').textContent = '✓';
        entryEl.querySelector('.playlist-entry-status').className = 'playlist-entry-status done';
        if (full.thumbnail) {
          const img = entryEl.querySelector('.playlist-entry-thumb');
          if (img) img.src = full.thumbnail;
        }
        if (full.duration_string) {
          entryEl.querySelector('.playlist-entry-dur').textContent = full.duration_string;
        }
      }
    } catch {
      const entryEl = qs(`#pe-${entry.id}`);
      if (entryEl) {
        entryEl.querySelector('.playlist-entry-status').textContent = '✕';
        entryEl.querySelector('.playlist-entry-status').className = 'playlist-entry-status error';
      }
    }
    done++;
    progressLabel.textContent = I18N.t('playlist.analyzing', { done, total: playlist.count });
    qs('#playlist-progress-fill').style.width = `${(done / playlist.count) * 100}%`;
  }

  progressLabel.textContent = I18N.t('playlist.done', { n: done });
  qs('#playlist-add-all').disabled = false;
}

function buildPlaylistEntry(entry, statusType = 'loading') {
  const el = document.createElement('div');
  el.className = 'playlist-entry';
  el.id = `pe-${entry.id}`;
  const checked = State.playlistSelected.has(entry.id) ? 'checked' : '';
  el.innerHTML = `
    <input type="checkbox" ${checked} onchange="togglePlaylistEntry('${entry.id}', this.checked)">
    <img class="playlist-entry-thumb" src="${entry.thumbnail || ''}" alt="" onerror="this.style.display='none'">
    <div class="playlist-entry-info">
      <div class="playlist-entry-title">${entry.title || entry.id}</div>
      <div class="playlist-entry-dur">${entry.duration ? fmtDuration(entry.duration) : ''}</div>
    </div>
    <span class="playlist-entry-status ${statusType}">
      ${statusType === 'loading' ? '…' : ''}
    </span>`;
  return el;
}

function togglePlaylistEntry(id, checked) {
  if (checked) State.playlistSelected.add(id);
  else         State.playlistSelected.delete(id);
}

function selectAllPlaylist(val) {
  State.playlistInfo?.entries.forEach(e => {
    if (val) State.playlistSelected.add(e.id);
    else     State.playlistSelected.delete(e.id);
    const cb = qs(`#pe-${e.id} input[type=checkbox]`);
    if (cb) cb.checked = val;
  });
}

async function addPlaylistToQueue() {
  const entries = State.playlistEntries.filter(e => State.playlistSelected.has(e._stub?.id || e.id));
  if (!entries.length) { toast(I18N.t('playlist.none_selected'), 'info'); return; }

  for (const entry of entries) {
    const opts = {
      thumbnail:  entry.thumbnail,
      output_dir: State.settings.output_dir,
    };
    // Apply default quality from settings
    if (entry.video_formats?.length) opts.format_video = entry.video_formats[0].format_id;
    if (entry.audio_formats?.length) opts.format_audio = entry.audio_formats[0].format_id;
    try {
      await API.addToQueue(entry.webpage_url, entry.title, opts);
    } catch {}
  }
  toast(I18N.t('playlist.added', { n: entries.length }), 'success');
  resetResult();
  qs('#url-input').value = '';
  switchTab('queue');
}

/* ── Settings ──────────────────────────────────────────────────────────────── */
async function loadSettings() {
  try {
    State.settings = await API.getSettings();
    applyTheme(State.settings.theme || 'dark');
    await I18N.setLocale(State.settings.language || 'en');
    renderSettings();
  } catch {}
}

function renderSettings() {
  const s = State.settings;
  const set = (id, val) => { const el = qs(`#${id}`); if (el) el.value = val ?? ''; };
  const setChk = (id, val) => { const el = qs(`#${id}`); if (el) el.checked = !!val; };

  set('s-lang',         s.language);
  set('s-output-dir',   s.output_dir);
  set('s-video-q',      s.default_video_quality);
  set('s-audio-q',      s.default_audio_quality);
  set('s-audio-ext',    s.default_audio_ext);
  set('s-audio-lang',   s.default_audio_lang);
  set('s-sub-lang',     s.default_sub_lang);
  set('s-max-dl',       s.max_concurrent);
  set('s-rate-limit',   s.rate_limit);
  set('s-cookies',      s.cookies_file);
  set('s-proxy',        s.proxy);
  setChk('s-sub-auto',  s.default_sub_auto);
  setChk('s-embed-subs',s.embed_subs);
}

async function saveSettingsFromForm() {
  const val  = id => qs(`#${id}`)?.value ?? '';
  const chk  = id => qs(`#${id}`)?.checked ?? false;

  const patch = {
    language:              val('s-lang'),
    output_dir:            val('s-output-dir'),
    default_video_quality: val('s-video-q'),
    default_audio_quality: val('s-audio-q'),
    default_audio_ext:     val('s-audio-ext'),
    default_audio_lang:    val('s-audio-lang'),
    default_sub_lang:      val('s-sub-lang'),
    max_concurrent:        parseInt(val('s-max-dl')) || 2,
    rate_limit:            val('s-rate-limit'),
    cookies_file:          val('s-cookies'),
    proxy:                 val('s-proxy'),
    default_sub_auto:      chk('s-sub-auto'),
    embed_subs:            chk('s-embed-subs'),
  };

  try {
    State.settings = await API.saveSettings(patch);
    await I18N.setLocale(State.settings.language);
    toast(I18N.t('settings.saved'), 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ── WebSocket events ──────────────────────────────────────────────────────── */
function initWebSocket() {
  API.WS.on('init', ({ items, stats }) => {
    renderQueue(items, stats);
  });

  API.WS.on('added', ({ item, stats }) => {
    const list = qs('#dl-list');
    if (list.querySelector('.empty-state')) list.innerHTML = '';
    list.appendChild(buildDlItem(item));
    renderStats(stats);
    updateQueueBadge(stats.total);
  });

  API.WS.on('progress', ({ item, stats }) => {
    updateDlItem(item);
    renderStats(stats);
  });

  API.WS.on('status', ({ item, stats }) => {
    updateDlItem(item);
    renderStats(stats);
    if (item.status === 'completed') {
      toast(I18N.t('queue.done', { title: item.title }), 'success');
    }
    if (item.status === 'error') {
      toast(I18N.t('queue.error', { title: item.title }), 'error');
    }
  });
}

/* ── Boot ──────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  // Outer try/catch: any uncaught error during initialisation is logged
  // clearly instead of surfacing as an opaque uncaught promise rejection.
  try {

    // Load persisted settings and apply theme + locale before rendering anything.
    await loadSettings();

    // Register WebSocket event handlers, then open the connection.
    // The WS manager handles reconnection automatically if the connection drops.
    initWebSocket();
    API.WS.connect();

    // Fetch the current queue state so items survive an app restart.
    try {
      const { items, stats } = await API.getQueue();
      renderQueue(items, stats);
    } catch (err) {
      console.warn('[GRABBIT] Could not load initial queue state:', err);
    }

    // ── UI event bindings ───────────────────────────────────────────────────

    qs('#analyze-btn').addEventListener('click', handleAnalyze);
    qs('#url-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') handleAnalyze();
    });

    qs('#theme-toggle').addEventListener('click', toggleTheme);
    qs('#add-queue-btn').addEventListener('click', addCurrentToQueue);
    qs('#save-settings-btn').addEventListener('click', saveSettingsFromForm);

    qs('#reset-settings-btn').addEventListener('click', async () => {
      if (confirm(I18N.t('settings.reset_confirm'))) {
        try {
          State.settings = await API.resetSettings();
          renderSettings();
          toast(I18N.t('settings.reset_done'), 'info');
        } catch (err) {
          console.error('[GRABBIT] Could not reset settings:', err);
        }
      }
    });

    // Playlist action buttons (present only on the download tab)
    qs('#playlist-select-all')?.addEventListener('click', () => selectAllPlaylist(true));
    qs('#playlist-deselect-all')?.addEventListener('click', () => selectAllPlaylist(false));
    qs('#playlist-add-all')?.addEventListener('click', addPlaylistToQueue);

    // Tab navigation
    qsa('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Global paste shortcut: Ctrl/Cmd+V focuses the URL input when
    // the user is not already typing in another input field.
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && document.activeElement.tagName !== 'INPUT') {
        qs('#url-input').focus();
      }
    });

  } catch (err) {
    console.error('[GRABBIT] Initialization error:', err);
  }
});
