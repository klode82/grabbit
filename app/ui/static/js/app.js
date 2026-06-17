/* ─────────────────────────────────────────────────────────────────────────
   GRABBIT — Main app
   ───────────────────────────────────────────────────────────────────────── */

/* ── State ─────────────────────────────────────────────────────────────────── */
const State = {
  settings: {},
  currentResult: null,
  selectedVideo: null,
  selectedAudio: null,
  selectedSub:   null,
  // Phase 4: section toggles and container choice
  videoEnabled:    true,
  audioEnabled:    true,
  subsEnabled:     false,
  outputContainer: 'mp4',
  queueItems: [],
  queueStats: { total: 0, pending: 0, active: 0, completed: 0, error: 0 },
  playlistInfo: null,
  playlistEntries:  [],
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

/* ── Format section toggle ─────────────────────────────────────────────────── */
function toggleSection(type, enabled) {
  if (type === 'video') {
    State.videoEnabled = enabled;
    qs('#section-video')?.classList.toggle('disabled', !enabled);
    const cr = qs('#container-row');
    if (cr) cr.style.display = enabled ? '' : 'none';
    if (!enabled) { const h = qs('#video-size-hint'); if (h) h.textContent = ''; }
  } else if (type === 'audio') {
    State.audioEnabled = enabled;
    qs('#section-audio')?.classList.toggle('disabled', !enabled);
    if (!enabled) { const h = qs('#audio-size-hint'); if (h) h.textContent = ''; }
  } else if (type === 'subs') {
    State.subsEnabled = enabled;
    qs('#section-subs')?.classList.toggle('disabled', !enabled);
  }
}

function selectContainer(ext) {
  State.outputContainer = ext;
  ['mp4', 'mkv'].forEach(e => {
    qs(`#container-${e}`)?.classList.toggle('selected', e === ext);
  });
}

async function openSourceUrl() {
  const url = State.currentResult?.webpage_url;
  if (!url) return;
  try { if (window.pywebview?.api?.open_url) await window.pywebview.api.open_url(url); } catch {}
}

/* ── Custom dialog (replaces browser confirm/alert) ────────────────────────── */
function showDialog({ title, message, confirmText, cancelText = null, danger = false }) {
  return new Promise(resolve => {
    qs('#dialog-title').textContent   = title;
    qs('#dialog-message').textContent = message;

    const okBtn = qs('#dialog-ok-btn');
    okBtn.textContent = confirmText || I18N.t('dialog.ok');
    okBtn.className   = `btn ${danger ? 'btn-primary danger' : 'btn-primary'}`;

    const cancelBtn = qs('#dialog-cancel-btn');
    if (cancelText !== null) {
      cancelBtn.textContent  = cancelText || I18N.t('dialog.cancel');
      cancelBtn.style.display = '';
    } else {
      cancelBtn.style.display = 'none';
    }

    qs('#dialog-box').classList.toggle('danger', danger);
    qs('#dialog-overlay').classList.remove('hidden');

    const close = (result) => {
      qs('#dialog-overlay').classList.add('hidden');
      resolve(result);
    };

    okBtn.onclick     = () => close(true);
    cancelBtn.onclick = () => close(false);
    // Click outside the box to dismiss
    qs('#dialog-overlay').onclick = (e) => {
      if (e.target === qs('#dialog-overlay')) close(false);
    };
  });
}
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
  // CSS handles the fade transition via opacity — just toggle the active class.
  qsa('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
  qsa('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${id}`));

  // Auto-paste: whenever the user lands on the Download tab with an empty field
  if (id === 'download') checkAndAutoPaste();
}

/* ── Clipboard auto-paste helper ───────────────────────────────────────────── */
async function checkAndAutoPaste() {
  if (qs('#url-input').value.trim()) return;

  // Use the pywebview Python bridge only.
  // navigator.clipboard.readText() is intentionally NOT used: it triggers a
  // Qt WebEngine permission request that hits a bug in pywebview's PySide6
  // integration (setFeaturePermission called with wrong argument types).
  try {
    if (window.pywebview?.api?.get_clipboard) {
      const text = await window.pywebview.api.get_clipboard();
      if (text && /^https?:\/\//i.test(text.trim())) {
        qs('#url-input').value = text.trim();
        toast(I18N.t('download.auto_pasted'), 'info', 2500);
      }
    }
  } catch {}
}

/* ── Error parser — maps raw yt-dlp messages to user-friendly strings ──────── */
function parseYtdlpError(msg) {
  if (!msg) return I18N.t('errors.unknown');
  const m = msg.toLowerCase();
  // HTTP status codes
  if (m.includes('http error 403'))                                    return I18N.t('errors.forbidden');
  if (m.includes('http error 429'))                                    return I18N.t('errors.rate_limit');
  if (m.includes('http error 404') || m.includes('unable to download webpage')) return I18N.t('errors.not_found');
  // Video state
  if (m.includes('private video'))                                     return I18N.t('errors.private');
  if (m.includes('video unavailable') || m.includes('not available')) return I18N.t('errors.unavailable');
  if (m.includes('members-only') || m.includes('this video is only available')) return I18N.t('errors.members_only');
  // Site support
  if (m.includes('unable to extract') || m.includes('unsupported url')) return I18N.t('errors.unsupported');
  // Age restriction
  if (m.includes('confirm your age') || m.includes('age-restricted')) return I18N.t('errors.age_restricted');
  // Network
  if (m.includes('timed out') || m.includes('connection refused') || m.includes('network')) return I18N.t('errors.network');
  // Fallback: show first line only, capped at 120 chars — avoids walls of raw text
  const firstLine = msg.split('\n')[0].replace(/^ERROR:\s*/i, '').trim();
  return firstLine.length > 120 ? firstLine.substring(0, 117) + '…' : firstLine;
}

/* ── URL input ─────────────────────────────────────────────────────────────── */
async function handleAnalyze() {
  const url = qs('#url-input').value.trim();
  if (!url) {
    qs('#url-input').focus();
    return;
  }
  resetResult();
  showSkeleton(true);

  try {
    const result = await API.analyze(url);
    showSkeleton(false);

    if (result.type === 'playlist') {
      handlePlaylistResult(result);
    } else {
      handleVideoResult(result);
    }
  } catch (err) {
    showSkeleton(false);
    toast(parseYtdlpError(err.message), 'error');
  }
}

function resetResult() {
  State.currentResult  = null;
  State.selectedVideo  = null;
  State.selectedAudio  = null;
  State.selectedSub    = null;
  State.videoEnabled   = true;
  State.audioEnabled   = true;
  State.subsEnabled    = false;
  State.playlistInfo   = null;
  State.playlistEntries = [];
  qs('#result-card').classList.remove('visible');
  qs('#playlist-analysis').classList.remove('visible');
  const vh = qs('#video-size-hint'); if (vh) vh.textContent = '';
  const ah = qs('#audio-size-hint'); if (ah) ah.textContent = '';
}

/* ── Skeleton loader ────────────────────────────────────────────────────────── */
function showSkeleton(visible) {
  qs('#skeleton-card').classList.toggle('visible', visible);
  qs('#analyze-btn').disabled = visible;
}

/* ── Video result ──────────────────────────────────────────────────────────── */
function handleVideoResult(result) {
  State.currentResult = result;

  const thumb = qs('#result-thumb');
  if (result.thumbnail) {
    thumb.src = result.thumbnail;
    thumb.style.display = 'block';
    qs('#result-thumb-ph').style.display = 'none';
  } else {
    thumb.style.display = 'none';
    qs('#result-thumb-ph').style.display = 'flex';
  }

  qs('#result-title').textContent     = result.title || '—';
  qs('#result-duration').textContent  = fmtDuration(result.duration);
  qs('#result-uploader').textContent  = result.uploader || '';

  // Extractor — clickable link to source
  const extEl = qs('#result-extractor');
  extEl.textContent = result.extractor || '';
  if (result.webpage_url) {
    extEl.style.cssText = 'color:var(--accent);cursor:pointer;text-decoration:underline';
    extEl.title = result.webpage_url;
    extEl.onclick = openSourceUrl;
  } else {
    extEl.style.cssText = '';
    extEl.onclick = null;
  }

  const bestV = result.best_video;
  const bestA = result.best_audio;
  qs('#result-best-video').textContent = bestV ? bestV.quality_label : '—';
  qs('#result-best-audio').textContent = bestA ? bestA.quality_label : '—';
  qs('#result-has-subs').textContent = result.has_subtitles
    ? I18N.t('analyze.subs_yes') : I18N.t('analyze.subs_no');

  renderVideoFormats(result.video_formats || []);
  renderAudioFormats(result.audio_formats || []);
  renderSubtitles(result.subtitles || {});
  applyDefaults(result);

  // Bind toggle events
  qs('#video-toggle').onchange = e => toggleSection('video', e.target.checked);
  qs('#audio-toggle').onchange = e => toggleSection('audio', e.target.checked);
  qs('#subs-toggle').onchange  = e => toggleSection('subs',  e.target.checked);

  qs('#result-card').classList.add('visible');
}

function applyDefaults(result) {
  const s = State.settings;

  // Video toggle: ON only if there are video formats
  const hasVideo = (result.video_formats || []).length > 0;
  State.videoEnabled = hasVideo;
  qs('#video-toggle').checked = hasVideo;
  qs('#section-video').classList.toggle('disabled', !hasVideo);
  const cr = qs('#container-row');
  if (cr) cr.style.display = hasVideo ? '' : 'none';

  // Audio toggle: ON only if there are audio formats
  const hasAudio = (result.audio_formats || []).length > 0;
  State.audioEnabled = hasAudio;
  qs('#audio-toggle').checked = hasAudio;
  qs('#section-audio').classList.toggle('disabled', !hasAudio);

  // Subtitles toggle: default OFF unless settings has a sub lang AND subs exist
  const hasSubs = result.has_subtitles;
  const wantSubs = !!(s.default_sub_lang && hasSubs);
  State.subsEnabled = wantSubs;
  qs('#subs-toggle').checked = wantSubs;
  qs('#section-subs').classList.toggle('disabled', !wantSubs);

  // Container
  State.outputContainer = s.default_video_ext === 'mkv' ? 'mkv' : 'mp4';
  selectContainer(State.outputContainer);

  // Pre-select video format
  if (hasVideo) {
    if (s.default_video_quality === 'best') {
      selectVideoFormat(result.video_formats[0].format_id);
    } else {
      const target = parseInt(s.default_video_quality) || 9999;
      const match  = result.video_formats.find(f => (f.height || 0) <= target)
                     || result.video_formats[0];
      if (match) selectVideoFormat(match.format_id);
    }
  }

  // Pre-select audio format
  if (hasAudio) {
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
  const wrap   = qs('#video-formats');
  const countEl = qs('#video-count');
  wrap.innerHTML = '';

  if (!formats.length) {
    wrap.innerHTML = `<span class="muted small">${I18N.t('formats.none')}</span>`;
    if (countEl) countEl.textContent = '';
    return;
  }
  if (countEl) countEl.textContent = `${formats.length} ${I18N.t('formats.video_count')}`;

  // Group by resolution family
  const groups = [
    { label: '4K',  test: h => h >= 2160 },
    { label: 'FHD', test: h => h >= 1080 && h < 2160 },
    { label: 'HD',  test: h => h >= 720  && h < 1080 },
    { label: 'SD',  test: h => h > 0     && h < 720  },
    { label: '?',   test: () => true },   // catch-all
  ];

  let lastGroup = null;
  formats.forEach(f => {
    const h     = f.height || 0;
    const group = groups.find(g => g.test(h));
    if (group !== lastGroup && group.label !== '?') {
      const lbl = document.createElement('span');
      lbl.className = 'format-group-label';
      lbl.textContent = group.label;
      wrap.appendChild(lbl);
      lastGroup = group;
    }

    const chip = document.createElement('button');
    chip.className = 'format-chip';
    chip.dataset.formatId = f.format_id;

    // Label: quality · codec · ext
    const parts = [f.quality_label];
    if (f.codec) parts.push(f.codec);
    if (f.ext)   parts.push(f.ext);
    chip.textContent = parts.join(' · ');

    // Tooltip: fps, size
    const tips = [];
    if (f.fps)            tips.push(`${f.fps}fps`);
    if (f.filesize_human) tips.push(`~${f.filesize_human}`);
    if (f.combined)       tips.push('video+audio');
    chip.title = tips.join(' · ');

    chip.onclick = () => selectVideoFormat(f.format_id);
    wrap.appendChild(chip);
  });
}

function selectVideoFormat(id) {
  State.selectedVideo = id;
  qsa('.format-chip', qs('#video-formats')).forEach(c =>
    c.classList.toggle('selected', c.dataset.formatId === id)
  );
  // Show estimated file size
  const fmt  = State.currentResult?.video_formats?.find(f => f.format_id === id);
  const hint = qs('#video-size-hint');
  if (hint) hint.textContent = fmt?.filesize_human ? `~${fmt.filesize_human}` : '';
}

function renderAudioFormats(formats) {
  const wrap    = qs('#audio-formats');
  const countEl = qs('#audio-count');
  wrap.innerHTML = '';

  if (!formats.length) {
    wrap.innerHTML = `<span class="muted small">${I18N.t('formats.none')}</span>`;
    if (countEl) countEl.textContent = '';
    return;
  }
  if (countEl) countEl.textContent = `${formats.length} ${I18N.t('formats.audio_count')}`;

  formats.forEach(f => {
    const chip = document.createElement('button');
    chip.className = 'format-chip';
    chip.dataset.formatId = f.format_id;

    // Label: bitrate · codec · lang
    const parts = [f.quality_label];
    if (f.codec)    parts.push(f.codec);
    if (f.ext)      parts.push(f.ext);
    if (f.language) parts.push(`[${f.language}]`);
    chip.textContent = parts.join(' · ');

    if (f.filesize_human) chip.title = `~${f.filesize_human}`;
    chip.onclick = () => selectAudioFormat(f.format_id);
    wrap.appendChild(chip);
  });
}

function selectAudioFormat(id) {
  State.selectedAudio = id;
  qsa('.format-chip', qs('#audio-formats')).forEach(c =>
    c.classList.toggle('selected', c.dataset.formatId === id)
  );
  const fmt  = State.currentResult?.audio_formats?.find(f => f.format_id === id);
  const hint = qs('#audio-size-hint');
  if (hint) hint.textContent = fmt?.filesize_human ? `~${fmt.filesize_human}` : '';
}

/* ── Subtitle list ─────────────────────────────────────────────────────────── */
function renderSubtitles(subs) {
  const wrap = qs('#sub-list');
  wrap.innerHTML = '';

  const all = [];
  Object.entries(subs.manual    || {}).forEach(([lang]) => all.push({ lang, auto: false }));
  Object.entries(subs.automatic || {}).forEach(([lang]) => {
    if (!subs.manual?.[lang]) all.push({ lang, auto: true });
  });

  if (!all.length) {
    wrap.innerHTML = `<span class="muted small">${I18N.t('subtitles.none')}</span>`;
    return;
  }

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

  // Guard: at least one stream must be enabled
  if (!State.videoEnabled && !State.audioEnabled) {
    toast(I18N.t('download.no_streams'), 'error');
    return;
  }

  const options = {
    thumbnail:            result.thumbnail,
    output_dir:           State.settings.output_dir,
    merge_output_format:  State.outputContainer || 'mp4',
  };

  if (State.videoEnabled && State.selectedVideo)
    options.format_video = State.selectedVideo;

  if (State.audioEnabled && State.selectedAudio)
    options.format_audio = State.selectedAudio;

  if (State.subsEnabled && State.selectedSub) {
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

  const isActive    = item.status === 'downloading';
  const isComplete  = item.status === 'completed';
  const isPaused    = item.status === 'paused';
  const isError     = item.status === 'error';
  const isCancelled = item.status === 'cancelled';

  const progressHTML = (isActive || isPaused) ? `
    <div class="dl-progress-row">
      <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${item.progress}%"></div></div>
      <span class="dl-pct">${item.progress.toFixed(0)}%</span>
    </div>
    ${isActive ? `<div class="dl-meta"><span class="dl-speed">${item.speed || ''}</span>${item.eta ? ` · ETA ${item.eta}` : ''}</div>` : ''}` : '';

  const errorHTML = isError
    ? `<div class="dl-meta" style="color:var(--danger)">${parseYtdlpError(item.error)}</div>` : '';

  const badgeText = I18N.t(`queue.status.${item.status}`);
  const safeFilename = (item.filename || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  // SVG icons — defined once, reused across all states
  const svgPause   = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
  const svgPlay    = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`;
  const svgX       = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const svgRestart = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>`;
  const svgBin     = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>`;
  const svgFolder  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>`;
  const svgFile    = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`;

  const btn = (onclick, title, icon) =>
    `<button class="btn-icon" onclick="${onclick}" title="${title}">${icon}</button>`;

  let actionsHTML;
  if (isComplete) {
    actionsHTML = `<div class="dl-item-actions">
      ${btn(`openFolder('${safeFilename}')`, I18N.t('queue.open_folder'), svgFolder)}
      ${btn(`openFile('${safeFilename}')`,   I18N.t('queue.open_file'),   svgFile)}
      ${btn(`removeItem('${item.id}')`,      I18N.t('queue.remove'),      svgBin)}
    </div>`;
  } else if (isActive) {
    actionsHTML = `<div class="dl-item-actions">
      ${btn(`pauseItem('${item.id}')`,  I18N.t('queue.pause'),  svgPause)}
      ${btn(`cancelItem('${item.id}')`, I18N.t('queue.cancel'), svgX)}
    </div>`;
  } else if (isPaused) {
    actionsHTML = `<div class="dl-item-actions">
      <span class="dl-status-badge badge-paused">${badgeText}</span>
      ${btn(`resumeItem('${item.id}')`, I18N.t('queue.resume'), svgPlay)}
      ${btn(`removeItem('${item.id}')`, I18N.t('queue.remove'), svgBin)}
    </div>`;
  } else if (isError) {
    actionsHTML = `<div class="dl-item-actions">
      <span class="dl-status-badge badge-error">${badgeText}</span>
      ${btn(`restartItem('${item.id}')`, I18N.t('queue.restart'), svgRestart)}
      ${btn(`removeItem('${item.id}')`,  I18N.t('queue.remove'),  svgBin)}
    </div>`;
  } else {
    // PENDING or CANCELLED
    actionsHTML = `<div class="dl-item-actions">
      <span class="dl-status-badge badge-${item.status}">${badgeText}</span>
      ${!isCancelled
        ? btn(`cancelItem('${item.id}')`,  I18N.t('queue.cancel'),  svgX)
        : btn(`restartItem('${item.id}')`, I18N.t('queue.restart'), svgRestart)
          + btn(`removeItem('${item.id}')`, I18N.t('queue.remove'), svgBin)
      }
    </div>`;
  }

  el.innerHTML = `
    ${thumbHTML}
    <div class="dl-info">
      <div class="dl-title" title="${item.title}">${item.title}</div>
      ${progressHTML}
      ${errorHTML}
    </div>
    ${actionsHTML}`;
  return el;
}

function updateDlItem(item) {
  const el = document.getElementById(`dl-${item.id}`);
  if (!el) return;
  const fresh = buildDlItem(item);
  el.replaceWith(fresh);
}

// Lightweight progress-only update — does NOT rebuild the DOM node.
// Only mutates the bar fill, percentage, speed and ETA text, leaving
// the button elements entirely untouched so :hover state stays stable.
function updateDlProgress(item) {
  const el = document.getElementById(`dl-${item.id}`);
  if (!el) return;

  const fill  = el.querySelector('.progress-bar-fill');
  const pct   = el.querySelector('.dl-pct');
  const speed = el.querySelector('.dl-speed');
  const meta  = el.querySelector('.dl-meta');

  if (fill)  fill.style.width   = `${item.progress}%`;
  if (pct)   pct.textContent    = `${item.progress.toFixed(0)}%`;
  if (speed) speed.textContent  = item.speed || '';
  if (meta)  meta.innerHTML =
    `<span class="dl-speed">${item.speed || ''}</span>${item.eta ? ` · ETA ${item.eta}` : ''}`;
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
  // Remove from DOM first (optimistic), then sync with server.
  document.getElementById(`dl-${id}`)?.remove();
  try { await API.removeFromQueue(id); } catch {}
}

async function cancelItem(id) {
  // Mark as CANCELLED (red, stays in list) without removing.
  try { await API.cancelItem(id); } catch {}
}

async function pauseItem(id) {
  try { await API.pauseItem(id); } catch (err) {
    console.warn('[GRABBIT] pauseItem failed:', err);
  }
}

async function resumeItem(id) {
  try { await API.resumeItem(id); } catch (err) {
    console.warn('[GRABBIT] resumeItem failed:', err);
  }
}

async function retryItem(id) {
  await restartItem(id);
}

async function restartItem(id) {
  try { await API.restartItem(id); } catch (err) {
    console.warn('[GRABBIT] restartItem failed:', err);
  }
}

async function clearCompleted() {
  try { await API.clearCompleted(); } catch {}
}

async function clearAll() {
  const ok = await showDialog({
    title:       I18N.t('dialog.clear_all_title'),
    message:     I18N.t('dialog.clear_all_msg'),
    confirmText: I18N.t('dialog.clear_all_confirm'),
    cancelText:  I18N.t('dialog.cancel'),
    danger:      true,
  });
  if (ok) {
    try { await API.clearAll(); } catch {}
  }
}

// Open the downloaded file with the system's default application.
// Does nothing if filename is empty (download still in progress or path unknown).
async function openFile(path) {
  if (!path) { toast(I18N.t('errors.file_not_found'), 'error'); return; }
  try {
    if (window.pywebview?.api?.open_file) await window.pywebview.api.open_file(path);
  } catch (err) {
    console.error('[GRABBIT] openFile failed:', err);
  }
}

// Open the folder containing the downloaded file in the system file manager.
async function openFolder(path) {
  if (!path) { toast(I18N.t('errors.file_not_found'), 'error'); return; }
  try {
    if (window.pywebview?.api?.open_folder) await window.pywebview.api.open_folder(path);
  } catch (err) {
    console.error('[GRABBIT] openFolder failed:', err);
  }
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
  // Update the connection indicator dot in the header
  API.WS.on('connected', () => {
    const dot = qs('#ws-dot');
    dot.className = 'ws-dot connected';
    qs('#ws-indicator').title = I18N.t('ws.connected');
  });

  API.WS.on('disconnected', () => {
    const dot = qs('#ws-dot');
    dot.className = 'ws-dot reconnecting';
    qs('#ws-indicator').title = I18N.t('ws.reconnecting');
  });

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
    // Lightweight update: only touch the progress bar and meta text.
    // Calling updateDlItem (full DOM rebuild) on every progress tick resets
    // :hover state and causes the buttons to visibly "vibrate".
    updateDlProgress(item);
    renderStats(stats);
  });

  API.WS.on('status', ({ item, stats }) => {
    updateDlItem(item);
    renderStats(stats);
    if (item.status === 'completed') {
      toast(I18N.t('queue.done', { title: item.title }), 'success');
    }
    if (item.status === 'error') {
      const friendly = parseYtdlpError(item.error);
      toast(`${item.title}: ${friendly}`, 'error');
    }
  });

  // Fired after bulk operations (clear all / clear completed)
  API.WS.on('queue_update', ({ items, stats }) => {
    renderQueue(items, stats);
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
      const ok = await showDialog({
        title:       I18N.t('settings.reset_confirm_title'),
        message:     I18N.t('settings.reset_confirm'),
        confirmText: I18N.t('settings.reset'),
        cancelText:  I18N.t('dialog.cancel'),
        danger:      true,
      });
      if (ok) {
        try {
          State.settings = await API.resetSettings();
          renderSettings();
          toast(I18N.t('settings.reset_done'), 'info');
        } catch (err) {
          console.error('[GRABBIT] Could not reset settings:', err);
        }
      }
    });

    // Global queue controls
    qs('#btn-pause-all').addEventListener('click', async () => {
      try { await API.pauseAll(); } catch {}
    });
    qs('#btn-resume-all').addEventListener('click', async () => {
      try { await API.resumeAll(); } catch {}
    });
    qs('#btn-clear-completed').addEventListener('click', clearCompleted);
    qs('#btn-clear-all').addEventListener('click', clearAll);

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

    // ── Drag & drop URL onto the window ────────────────────────────────────
    // Show the overlay when something is dragged over the app window.
    document.addEventListener('dragover', e => {
      e.preventDefault();
      qs('#drag-overlay').classList.add('active');
    });

    // Hide the overlay when the drag leaves the window entirely.
    document.addEventListener('dragleave', e => {
      if (!e.relatedTarget) qs('#drag-overlay').classList.remove('active');
    });

    // On drop: extract the URL, put it in the input, and start analysis.
    document.addEventListener('drop', e => {
      e.preventDefault();
      qs('#drag-overlay').classList.remove('active');
      const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').trim();
      if (url) {
        switchTab('download');
        qs('#url-input').value = url;
        handleAnalyze();
      }
    });

    // ── Auto-paste from clipboard on window focus ───────────────────────────
    // Re-uses checkAndAutoPaste() — same logic as switching to the Download tab.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkAndAutoPaste();
    });

  } catch (err) {
    console.error('[GRABBIT] Initialization error:', err);
  }
});
