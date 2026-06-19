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
  // Phase 6: per-entry format selections and global format availability maps
  plEntrySelections: {},  // { entryId: { video: format_id|null, audio: format_id|null } }
  plVideoFormatMap:  {},  // { key → { label, count, total, byEntry: {id: format_id} } }
  plAudioFormatMap:  {},
  plVideoEnabled:  true,
  plAudioEnabled:  true,
  plSubsEnabled:      false,
  plSubtitleFormatMap: {},   // { key → { lang, auto, count, total, hasEntry } }
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
    const h = qs('#video-size-hint');
    if (!enabled) {
      if (h) h.textContent = '';
    } else if (h && State.selectedVideo) {
      // Restore size hint for the currently selected chip
      const fmt = State.currentResult?.video_formats?.find(f => f.format_id === State.selectedVideo);
      h.textContent = fmt?.filesize_human ? `~${fmt.filesize_human}` : '';
    }
  } else if (type === 'audio') {
    State.audioEnabled = enabled;
    qs('#section-audio')?.classList.toggle('disabled', !enabled);
    const h = qs('#audio-size-hint');
    if (!enabled) {
      if (h) h.textContent = '';
    } else if (h && State.selectedAudio) {
      const fmt = State.currentResult?.audio_formats?.find(f => f.format_id === State.selectedAudio);
      h.textContent = fmt?.filesize_human ? `~${fmt.filesize_human}` : '';
    }
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
  // Update theme chip selection in settings (if rendered)
  setChipSel?.('theme-chip-row', theme, 'data-theme');
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
    extEl.style.cssText = 'color:var(--accent);cursor:pointer;text-decoration:underline;text-underline-offset:2px';
    extEl.title = result.webpage_url;
    extEl.innerHTML = `${result.extractor || ''} <span style="font-size:10px;opacity:0.7">↗</span>`;
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
  const wrap    = qs('#video-formats');
  const countEl = qs('#video-count');
  wrap.innerHTML = '';

  if (!formats.length) {
    wrap.innerHTML = `<span class="muted small">${I18N.t('formats.none')}</span>`;
    if (countEl) countEl.textContent = '';
    return;
  }
  if (countEl) countEl.textContent = `${formats.length} ${I18N.t('formats.video_count')}`;

  const groups = [
    { label: '4K',  test: h => h >= 2160 },
    { label: 'FHD', test: h => h >= 1080 && h < 2160 },
    { label: 'HD',  test: h => h >= 720  && h < 1080 },
    { label: 'SD',  test: h => h > 0     && h < 720  },
    { label: '',    test: () => true },
  ];

  let lastGroup = null;
  let chipArea  = null;    // the .format-group-chips div of the current group

  formats.forEach(f => {
    const h     = f.height || 0;
    const group = groups.find(g => g.test(h));

    if (group !== lastGroup) {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'format-group';

      const lbl = document.createElement('span');
      lbl.className = 'format-group-label';
      lbl.textContent = group.label;

      chipArea = document.createElement('div');
      chipArea.className = 'format-group-chips';

      groupDiv.appendChild(lbl);
      groupDiv.appendChild(chipArea);
      wrap.appendChild(groupDiv);
      lastGroup = group;
    }

    const chip = document.createElement('button');
    chip.className = 'format-chip';
    chip.dataset.formatId = f.format_id;

    const parts = [f.quality_label];
    if (f.codec) parts.push(f.codec);
    if (f.ext)   parts.push(f.ext);
    chip.textContent = parts.join(' · ');

    const tips = [];
    if (f.fps)            tips.push(`${f.fps}fps`);
    if (f.filesize_human) tips.push(`~${f.filesize_human}`);
    if (f.combined)       tips.push('video+audio');
    chip.title = tips.join(' · ');

    chip.onclick = () => selectVideoFormat(f.format_id);
    chipArea.appendChild(chip);
  });
}

function selectVideoFormat(id) {
  State.selectedVideo = id;
  qsa('.format-chip', qs('#video-formats')).forEach(c =>
    c.classList.toggle('selected', c.dataset.formatId === id)
  );
  const fmt  = State.currentResult?.video_formats?.find(f => f.format_id === id);
  const hint = qs('#video-size-hint');
  if (hint) hint.textContent = fmt?.filesize_human ? `~${fmt.filesize_human}` : '';
  // Update accordion header badge
  updateFormatSectionBadge('video', fmt
    ? [fmt.quality_label, fmt.codec].filter(Boolean).join(' · ') : null);
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
  updateFormatSectionBadge('audio', fmt
    ? [fmt.quality_label, fmt.codec].filter(Boolean).join(' · ') : null);
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
  updateFormatSectionBadge('subs', lang ? langName(lang) + (auto ? ' (auto)' : '') : null);
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
  try {
    const resp = await API.clearCompleted();
    // Update counters immediately from the response — don't wait for WS
    if (resp?.stats) renderStats(resp.stats);
  } catch {}
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
/* ═══════════════════════════════════════════════════════════════════════════
   PLAYLIST — Phase 6
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Format availability computation ──────────────────────────────────────── */
function computePlaylistFormats(entries) {
  const total = entries.length;
  const videoMap = {};
  const audioMap = {};

  for (const entry of entries) {
    const eid = entry._stub?.id || entry.id;

    for (const f of (entry.video_formats || [])) {
      const key = `${f.height || 0}_${f.codec || ''}`;
      if (!videoMap[key]) {
        videoMap[key] = {
          key, label: `${f.quality_label} · ${f.codec || ''}`,
          height: f.height || 0, codec: f.codec || '', ext: f.ext,
          count: 0, total, byEntry: {},
        };
      }
      if (!videoMap[key].byEntry[eid]) {
        videoMap[key].byEntry[eid] = f.format_id;
        videoMap[key].count++;
      }
    }

    for (const f of (entry.audio_formats || [])) {
      const bitLabel = f.quality_label || `${Math.round(f.abr || 0)}k`;
      const key = `${bitLabel}_${f.codec || ''}`;
      if (!audioMap[key]) {
        audioMap[key] = {
          key, label: `${bitLabel} · ${f.codec || ''}`,
          bitrate: f.abr || 0, codec: f.codec || '', ext: f.ext,
          count: 0, total, byEntry: {},
        };
      }
      if (!audioMap[key].byEntry[eid]) {
        audioMap[key].byEntry[eid] = f.format_id;
        audioMap[key].count++;
      }
    }
  }

  // Sort: universal first, then partial; within each group sort by quality desc
  const sortV = arr => arr.sort((a, b) => {
    const ua = a.count === a.total, ub = b.count === b.total;
    if (ua !== ub) return ub - ua;
    return b.height - a.height;
  });
  const sortA = arr => arr.sort((a, b) => {
    const ua = a.count === a.total, ub = b.count === b.total;
    if (ua !== ub) return ub - ua;
    return b.bitrate - a.bitrate;
  });

  State.plVideoFormatMap = videoMap;
  State.plAudioFormatMap = audioMap;

  // ── Subtitles ─────────────────────────────────────────────────────────────
  const subMap = {};
  for (const entry of entries) {
    const eid  = entry._stub?.id || entry.id;
    const subs = entry.subtitles || {};
    const addSub = (lang, auto) => {
      const key = `${auto ? 'auto' : 'manual'}_${lang}`;
      if (!subMap[key]) subMap[key] = { key, lang, auto, count: 0, total, hasEntry: {} };
      if (!subMap[key].hasEntry[eid]) { subMap[key].hasEntry[eid] = true; subMap[key].count++; }
    };
    Object.keys(subs.manual    || {}).forEach(l => addSub(l, false));
    Object.keys(subs.automatic || {}).forEach(l => addSub(l, true));
  }
  State.plSubtitleFormatMap = subMap;

  return {
    videoFormats: sortV(Object.values(videoMap)),
    audioFormats: sortA(Object.values(audioMap)),
  };
}

/* Update the badge in a single-video format section header */
function updateFormatSectionBadge(type, label) {
  const badge = qs(`#${type}-sel-badge`);
  if (!badge) return;
  badge.innerHTML = label
    ? `<span class="format-chip selected" style="pointer-events:none;font-size:11px;height:22px">${label}</span>`
    : '';
}

/* Attach accordion click to single-video format section headers */
function initFormatSectionAccordions() {
  ['video', 'audio', 'subs'].forEach(type => {
    const header = qs(`#fsh-${type}`);
    if (!header) return;
    header.style.cursor = 'pointer';
    header.addEventListener('click', e => {
      if (e.target.closest('label')) return;
      const body  = qs(`#fsb-${type}`);
      const arrow = qs(`#fsa-${type}`);
      if (!body) return;
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : '';
      if (arrow) arrow.classList.toggle('open', !isOpen);
    });
  });
}

/* Helper: ISO/BCP-47 code → localised language name via Intl.DisplayNames */
function langName(code) {
  try {
    const dn = new Intl.DisplayNames([I18N.current() || 'en'], { type: 'language' });
    return dn.of(code) || code;
  } catch { return code; }
}

/* Filter subtitle items in a playlist per-entry accordion */
function filterEntrySubItems(eid, query) {
  const q = query.toLowerCase().trim();
  qsa(`#pefs-${eid} .sub-item`).forEach(item => {
    const lang = (item.dataset.lang || '').toLowerCase();
    const name = langName(item.dataset.lang || '').toLowerCase();
    item.style.display = (!q || lang.includes(q) || name.includes(q)) ? '' : 'none';
  });
}

/* Filter .sub-item elements in #sub-list (single video) */
function filterSingleVideoSubs(query) {
  const q = query.toLowerCase().trim();
  qsa('#sub-list .sub-item').forEach(item => {
    const lang = (item.dataset.lang || '').toLowerCase();
    const name = langName(item.dataset.lang || '').toLowerCase();
    item.style.display = (!q || lang.includes(q) || name.includes(q)) ? '' : 'none';
  });
}

/* Filter .format-chip elements in global playlist subtitle chip areas */
function filterPlSubtitleChips(query) {
  const q = query.toLowerCase().trim();
  qsa('#pl-manual-subs-chips .format-chip, #pl-auto-subs-chips .format-chip').forEach(chip => {
    const lang = (chip.dataset.lang || '').toLowerCase();
    const name = langName(chip.dataset.lang || '').toLowerCase();
    chip.style.display = (!q || lang.includes(q) || name.includes(q)) ? '' : 'none';
  });
}

/* ── Global chip rendering ─────────────────────────────────────────────────── */
function renderPlaylistGlobalChips() {
  const { videoFormats, audioFormats } = computePlaylistFormats(State.playlistEntries);

  _renderGlobalChipGroup(qs('#pl-video-chips'), videoFormats, selectPlVideoFormat);
  _renderGlobalChipGroup(qs('#pl-audio-chips'), audioFormats, selectPlAudioFormat);

  // Subtitle chips — split by manual / auto
  const subMap  = State.plSubtitleFormatMap;
  const manuals = Object.values(subMap).filter(f => !f.auto).sort((a,b) => b.count - a.count);
  const autos   = Object.values(subMap).filter(f =>  f.auto).sort((a,b) => b.count - a.count);

  _renderSubChipGroup(qs('#pl-manual-subs-chips'), manuals);
  _renderSubChipGroup(qs('#pl-auto-subs-chips'),   autos);

  const ms = qs('#pl-manual-subs-section');
  const as = qs('#pl-auto-subs-section');
  if (ms) ms.style.display = manuals.length ? '' : 'none';
  if (as) as.style.display = autos.length   ? '' : 'none';
}

function _renderSubChipGroup(wrap, formats) {
  if (!wrap) return;
  wrap.innerHTML = '';
  formats.forEach(fmt => {
    const chip = document.createElement('button');
    chip.className = `format-chip${fmt.count < fmt.total ? ' partial' : ''}`;
    chip.dataset.formatKey = fmt.key;
    chip.dataset.lang = fmt.lang;          // used by search filter
    const badge = fmt.count < fmt.total
      ? `<span class="chip-count">${fmt.count}/${fmt.total}</span>` : '';
    chip.innerHTML = `${langName(fmt.lang)}${badge}`;
    chip.onclick = () => selectPlSubtitle(fmt.key);
    wrap.appendChild(chip);
  });
}

function _renderGlobalChipGroup(wrap, formats, onSelect) {
  if (!wrap) return;
  wrap.innerHTML = '';
  formats.forEach(fmt => {
    const chip = document.createElement('button');
    chip.className = `format-chip${fmt.count < fmt.total ? ' partial' : ''}`;
    chip.dataset.formatKey = fmt.key;
    const badge = fmt.count < fmt.total
      ? `<span class="chip-count">${fmt.count}/${fmt.total}</span>` : '';
    chip.innerHTML = `${fmt.label}${badge}`;
    chip.onclick = () => onSelect(fmt.key);
    wrap.appendChild(chip);
  });
}

/* ── Global format selection ───────────────────────────────────────────────── */
function selectPlVideoFormat(key) {
  const fmt = State.plVideoFormatMap[key];
  if (!fmt) return;
  qsa('#pl-video-chips .format-chip').forEach(c =>
    c.classList.toggle('selected', c.dataset.formatKey === key));
  updateGlobalFormatBadge('video', fmt.label);

  for (const entry of State.playlistEntries) {
    const eid = entry._stub?.id || entry.id;
    if (!State.plEntrySelections[eid]) State.plEntrySelections[eid] = {};
    State.plEntrySelections[eid].video = fmt.byEntry[eid] || null;
    // Sync chip highlight inside open accordion
    _syncEntryVideoChips(eid, State.plEntrySelections[eid].video);
    updateEntryHeaderBadges(eid);
    updateEntryOrangeState(eid);
  }
  updateAddQueueBtn();
}

function selectPlAudioFormat(key) {
  const fmt = State.plAudioFormatMap[key];
  if (!fmt) return;
  qsa('#pl-audio-chips .format-chip').forEach(c =>
    c.classList.toggle('selected', c.dataset.formatKey === key));
  updateGlobalFormatBadge('audio', fmt.label);

  for (const entry of State.playlistEntries) {
    const eid = entry._stub?.id || entry.id;
    if (!State.plEntrySelections[eid]) State.plEntrySelections[eid] = {};
    State.plEntrySelections[eid].audio = fmt.byEntry[eid] || null;
    _syncEntryAudioChips(eid, State.plEntrySelections[eid].audio);
    updateEntryHeaderBadges(eid);
    updateEntryOrangeState(eid);
  }
  updateAddQueueBtn();
}

function selectPlSubtitle(key) {
  const fmt = State.plSubtitleFormatMap[key];
  if (!fmt) return;

  qsa('#pl-manual-subs-chips .format-chip, #pl-auto-subs-chips .format-chip')
    .forEach(c => c.classList.toggle('selected', c.dataset.formatKey === key));
  updateGlobalFormatBadge('subs', langName(fmt.lang) + (fmt.auto ? ' (auto)' : ''));

  for (const entry of State.playlistEntries) {
    const eid = entry._stub?.id || entry.id;
    if (!State.plEntrySelections[eid]) State.plEntrySelections[eid] = {};
    if (fmt.hasEntry[eid]) {
      State.plEntrySelections[eid].subs        = { lang: fmt.lang, auto: fmt.auto };
      State.plEntrySelections[eid].subsEnabled = true;
    } else {
      State.plEntrySelections[eid].subs = null;
    }
    _syncEntrySubtitleSelection(eid, State.plEntrySelections[eid].subs);
    updateEntryHeaderBadges(eid);
    updateEntryOrangeState(eid);
  }
  updateAddQueueBtn();
}

function _syncEntrySubtitleSelection(eid, subs) {
  if (!qs(`#pb-${eid}`)?.classList.contains('open')) return;
  qsa(`#pef-s-${eid} .sub-item`).forEach(el => {
    const active = subs
      ? (el.dataset.lang === subs.lang)
      : (el.dataset.lang === '__none__');
    el.classList.toggle('selected', active);
  });
}

/* ── Orange state & queue button ───────────────────────────────────────────── */
function updateEntryOrangeState(eid) {
  const el = qs(`#pe-${eid}`);
  if (!el) return;
  const sel = State.plEntrySelections[eid] || {};
  // Per-entry toggle overrides global when explicitly set (false = user disabled it)
  const videoOn = State.plVideoEnabled && (sel.videoEnabled !== false);
  const audioOn = State.plAudioEnabled && (sel.audioEnabled !== false);
  const subsOn  = State.plSubsEnabled  && (sel.subsEnabled  !== false);
  const needsVideo = videoOn && !sel.video;
  const needsAudio = audioOn && !sel.audio;
  const needsSubs  = subsOn  && !sel.subs;
  el.classList.toggle('needs-selection', needsVideo || needsAudio || needsSubs);
}

function countOrangeSelected() {
  return State.playlistEntries.filter(e => {
    const eid = e._stub?.id || e.id;
    if (!State.playlistSelected.has(eid)) return false;
    const sel = State.plEntrySelections[eid] || {};
    const videoOn = State.plVideoEnabled && (sel.videoEnabled !== false);
    const audioOn = State.plAudioEnabled && (sel.audioEnabled !== false);
    const subsOn  = State.plSubsEnabled  && (sel.subsEnabled  !== false);
    return (videoOn && !sel.video) || (audioOn && !sel.audio) || (subsOn && !sel.subs);
  }).length;
}

function updateAddQueueBtn() {
  const btn = qs('#playlist-add-all');
  if (!btn) return;
  const n = countOrangeSelected();
  if (n > 0) {
    btn.disabled = true;
    btn.textContent = I18N.t('playlist.needs_selection', { n });
  } else {
    btn.disabled = State.playlistEntries.length === 0;
    btn.textContent = I18N.t('playlist.add_selected');
  }
}

/* ── Global toggle handlers ────────────────────────────────────────────────── */
function initPlaylistFormatBar() {
  const vt = qs('#pl-video-toggle');
  const at = qs('#pl-audio-toggle');
  const st = qs('#pl-subs-toggle');

  // Accordion header click: open/close chip body (ignore toggle label clicks)
  ['video', 'audio', 'subs'].forEach(type => {
    const header = qs(`#pl-${type}-header`);
    if (!header) return;
    header.addEventListener('click', e => {
      if (e.target.closest('label')) return;
      const acc   = qs(`#pl-${type}-accordion`);
      const body  = qs(`#pl-${type}-chip-area`);
      const arrow = qs(`#pl-${type}-arrow`);
      if (!body || acc?.classList.contains('disabled')) return;
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : '';
      if (arrow) arrow.classList.toggle('open', !isOpen);
    });
  });

  // Video toggle
  if (vt) { vt.checked = State.plVideoEnabled; vt.onchange = e => {
    State.plVideoEnabled = e.target.checked;
    const acc = qs('#pl-video-accordion');
    const body = qs('#pl-video-chip-area');
    const arrow = qs('#pl-video-arrow');
    if (!e.target.checked) {
      if (body)  body.style.display = 'none';
      if (arrow) arrow.classList.remove('open');
      acc?.classList.add('disabled');
      qsa('#pl-video-chips .format-chip').forEach(c => c.classList.remove('selected'));
      updateGlobalFormatBadge('video', null);
      State.playlistEntries.forEach(entry => {
        const eid = entry._stub?.id || entry.id;
        if (State.plEntrySelections[eid]) State.plEntrySelections[eid].video = null;
        _syncEntryVideoChips(eid, null);
        updateEntryHeaderBadges(eid);
      });
    } else {
      acc?.classList.remove('disabled');
    }
    State.playlistEntries.forEach(entry =>
      updateEntryOrangeState(entry._stub?.id || entry.id));
    updateAddQueueBtn();
  }; }

  // Audio toggle
  if (at) { at.checked = State.plAudioEnabled; at.onchange = e => {
    State.plAudioEnabled = e.target.checked;
    const acc = qs('#pl-audio-accordion');
    const body = qs('#pl-audio-chip-area');
    const arrow = qs('#pl-audio-arrow');
    if (!e.target.checked) {
      if (body)  body.style.display = 'none';
      if (arrow) arrow.classList.remove('open');
      acc?.classList.add('disabled');
      qsa('#pl-audio-chips .format-chip').forEach(c => c.classList.remove('selected'));
      updateGlobalFormatBadge('audio', null);
      State.playlistEntries.forEach(entry => {
        const eid = entry._stub?.id || entry.id;
        if (State.plEntrySelections[eid]) State.plEntrySelections[eid].audio = null;
        _syncEntryAudioChips(eid, null);
        updateEntryHeaderBadges(eid);
      });
    } else {
      acc?.classList.remove('disabled');
    }
    State.playlistEntries.forEach(entry =>
      updateEntryOrangeState(entry._stub?.id || entry.id));
    updateAddQueueBtn();
  }; }

  // Subtitles toggle
  if (st) { st.checked = State.plSubsEnabled; st.onchange = e => {
    State.plSubsEnabled = e.target.checked;
    const acc = qs('#pl-subs-accordion');
    const body = qs('#pl-subs-chip-area');
    const arrow = qs('#pl-subs-arrow');
    if (!e.target.checked) {
      if (body)  body.style.display = 'none';
      if (arrow) arrow.classList.remove('open');
      acc?.classList.add('disabled');
      qsa('#pl-manual-subs-chips .format-chip, #pl-auto-subs-chips .format-chip')
        .forEach(c => c.classList.remove('selected'));
      updateGlobalFormatBadge('subs', null);
      State.playlistEntries.forEach(entry => {
        const eid = entry._stub?.id || entry.id;
        if (State.plEntrySelections[eid]) {
          State.plEntrySelections[eid].subs = null;
          State.plEntrySelections[eid].subsEnabled = false;
        }
        _syncEntrySubtitleSelection(eid, null);
        updateEntryHeaderBadges(eid);
      });
    } else {
      acc?.classList.remove('disabled');
    }
    State.playlistEntries.forEach(entry =>
      updateEntryOrangeState(entry._stub?.id || entry.id));
    updateAddQueueBtn();
  }; }
}

/* Update the selection badge in the global accordion header */
function updateGlobalFormatBadge(type, label) {
  const badge = qs(`#pl-${type}-badge`);
  if (!badge) return;
  badge.innerHTML = label
    ? `<span class="format-chip selected">${label}</span>`
    : '';
}

/* ── Playlist flow ──────────────────────────────────────────────────────────── */
async function handlePlaylistResult(playlist) {
  State.playlistInfo      = playlist;
  State.playlistEntries   = [];
  State.playlistSelected  = new Set(playlist.entries.map(e => e.id));
  State.plEntrySelections = {};
  State.plVideoFormatMap  = {};
  State.plAudioFormatMap  = {};
  State.plSubtitleFormatMap = {};

  // Pre-load subtitle toggle from settings: if user has a default lang, enable subs
  State.plSubsEnabled = !!State.settings.default_sub_lang;

  // ── Reset global format bar DOM (chips, badges, accordions) ──────────────
  qsa('#pl-video-chips .format-chip, #pl-audio-chips .format-chip,\
       #pl-manual-subs-chips .format-chip, #pl-auto-subs-chips .format-chip')
    .forEach(c => c.classList.remove('selected'));
  ['video', 'audio', 'subs'].forEach(type => {
    const badge = qs(`#pl-${type}-badge`);
    if (badge) badge.innerHTML = '';
    const chipArea = qs(`#pl-${type}-chip-area`);
    const arrow    = qs(`#pl-${type}-arrow`);
    const acc      = qs(`#pl-${type}-accordion`);
    if (chipArea) chipArea.style.display = 'none';
    if (arrow)    arrow.classList.remove('open');
    if (acc)      acc.classList.remove('disabled');
  });
  // Restore disabled state for subs accordion if subs toggle is OFF
  if (!State.plSubsEnabled) {
    qs('#pl-subs-accordion')?.classList.add('disabled');
  }

  const panel = qs('#playlist-analysis');
  panel.classList.add('visible');
  qs('#playlist-title-text').textContent = playlist.title || I18N.t('playlist.untitled');
  qs('#playlist-count-text').textContent = I18N.t('playlist.count', { n: playlist.count });

  initPlaylistFormatBar();
  qs('#pl-video-chips').innerHTML = '';
  qs('#pl-audio-chips').innerHTML = '';
  qs('#playlist-add-all').disabled = true;

  const itemsWrap  = qs('#playlist-items');
  itemsWrap.innerHTML = '';
  playlist.entries.forEach(entry => itemsWrap.appendChild(buildPlaylistAccordion(entry)));

  const progressLabel = qs('#playlist-progress-label');
  let done = 0;

  for (const entry of playlist.entries) {
    try {
      const full = await API.analyzePlaylistEntry(entry.url);
      State.playlistEntries.push({ ...full, _stub: entry });
      updatePlaylistEntryAnalyzed(entry.id, full);
    } catch {
      updatePlaylistEntryError(entry.id);
    }
    done++;
    progressLabel.textContent = I18N.t('playlist.analyzing', { done, total: playlist.count });
    qs('#playlist-progress-fill').style.width = `${(done / playlist.count) * 100}%`;
  }

  // After all entries analyzed → compute format maps and render global chips
  renderPlaylistGlobalChips();
  progressLabel.textContent = I18N.t('playlist.done', { n: done });

  // Auto-select video/audio/subtitle from settings defaults
  _autoSelectVideoChip();
  _autoSelectAudioChip();

  // Auto-select subtitle from settings default_sub_lang if available in this playlist
  const defaultLang = State.settings.default_sub_lang;
  if (defaultLang && State.plSubsEnabled) {
    const key = State.plSubtitleFormatMap[`manual_${defaultLang}`]
      ? `manual_${defaultLang}`
      : State.plSubtitleFormatMap[`auto_${defaultLang}`]
      ? `auto_${defaultLang}` : null;
    if (key) {
      selectPlSubtitle(key);
      const body  = qs('#pl-subs-chip-area');
      const arrow = qs('#pl-subs-arrow');
      if (body)  body.style.display = '';
      if (arrow) arrow.classList.add('open');
    }
  }

  updateAddQueueBtn();
}

/* ── Auto-select video/audio chips from settings defaults ──────────────────── */
function _autoSelectVideoChip() {
  const formats = Object.values(State.plVideoFormatMap).sort((a, b) => {
    const ua = a.count === a.total, ub = b.count === b.total;
    if (ua !== ub) return ub - ua;
    return b.height - a.height;
  });
  if (!formats.length) return;

  const quality        = State.settings.default_video_quality || 'best';
  const preferredCodec = State.settings.default_codec || '';

  let target = null;
  if (quality === 'best') {
    // Best = highest quality, prefer matching codec if set
    target = preferredCodec
      ? (formats.find(f => f.codec === preferredCodec && f.count === f.total)
         || formats.find(f => f.codec === preferredCodec))
      : formats[0];                    // first = highest universal quality
  } else {
    const maxH = parseInt(quality) || 9999;
    target = formats.find(f => f.height <= maxH && (!preferredCodec || f.codec === preferredCodec))
          || formats.find(f => f.height <= maxH)
          || formats[0];
  }
  if (target) selectPlVideoFormat(target.key);
}

function _autoSelectAudioChip() {
  const formats = Object.values(State.plAudioFormatMap).sort((a, b) => {
    const ua = a.count === a.total, ub = b.count === b.total;
    if (ua !== ub) return ub - ua;
    return b.bitrate - a.bitrate;
  });
  if (!formats.length) return;

  // Map audio ext setting to codec string used in format keys
  const extToCodec = { m4a: 'aac', mp3: 'mp3', opus: 'opus', flac: 'flac', wav: 'wav' };
  const preferredCodec = extToCodec[State.settings.default_audio_ext || ''] || '';
  const quality        = State.settings.default_audio_quality || 'best';

  let target = null;
  if (quality === 'best') {
    target = preferredCodec
      ? (formats.find(f => f.codec === preferredCodec && f.count === f.total)
         || formats.find(f => f.codec === preferredCodec))
      : formats[0];
  } else {
    const maxKbps = parseInt(quality) || 9999;
    target = formats.find(f => f.bitrate <= maxKbps && (!preferredCodec || f.codec === preferredCodec))
          || formats.find(f => f.bitrate <= maxKbps)
          || formats[0];
  }
  if (target) selectPlAudioFormat(target.key);
}

/* ── Accordion entry builder ───────────────────────────────────────────────── */
function buildPlaylistAccordion(entry) {
  const eid  = entry.id;
  const el   = document.createElement('div');
  el.className = 'playlist-entry';
  el.id = `pe-${eid}`;

  el.innerHTML = `
    <div class="pl-accordion-header" onclick="togglePlAccordion('${eid}')">
      <input type="checkbox" ${State.playlistSelected.has(eid) ? 'checked' : ''}
             onclick="event.stopPropagation()"
             onchange="togglePlaylistEntry('${eid}', this.checked)">
      <img class="playlist-entry-thumb" src="${entry.thumbnail || ''}" alt=""
           onerror="this.style.display='none'">
      <div class="playlist-entry-info">
        <div class="playlist-entry-title">${entry.title || eid}</div>
        <div class="pl-entry-sub" id="pm-${eid}">
          ${entry.duration ? fmtDuration(entry.duration) : ''}
        </div>
        <div class="pl-selected-formats" id="pf-${eid}"></div>
      </div>
      <span class="playlist-entry-status loading" id="ps-${eid}">…</span>
      <span class="pl-accordion-arrow" id="pa-${eid}">▾</span>
    </div>
    <div class="pl-accordion-body" id="pb-${eid}">
      <div class="pl-body-inner"></div>
    </div>`;

  return el;
}

function togglePlAccordion(eid) {
  const body  = qs(`#pb-${eid}`);
  const arrow = qs(`#pa-${eid}`);
  if (!body) return;
  const willOpen = !body.classList.contains('open');
  body.classList.toggle('open', willOpen);
  if (arrow) arrow.classList.toggle('open', willOpen);

  if (willOpen) {
    const entry = State.playlistEntries.find(e => (e._stub?.id || e.id) === eid);
    if (entry) renderEntryAccordionBody(eid, entry);
    else body.innerHTML = `<p class="muted small">${I18N.t('playlist.analyzing', { done: '…', total: '…' })}</p>`;
  }
}

/* ── Entry analyzed / error ────────────────────────────────────────────────── */
function updatePlaylistEntryAnalyzed(eid, full) {
  const el = qs(`#pe-${eid}`);
  if (!el) return;

  const st = qs(`#ps-${eid}`);
  if (st) { st.textContent = '✓'; st.className = 'playlist-entry-status done'; }

  if (full.title) {
    const titleEl = el.querySelector('.playlist-entry-title');
    if (titleEl) titleEl.textContent = full.title;
  }
  if (full.thumbnail) {
    const img = el.querySelector('.playlist-entry-thumb');
    if (img) {
      img.style.display = '';   // undo onerror display:none
      img.src = full.thumbnail;
    }
  }

  // Sub-meta: duration · extractor · uploader
  const sub = qs(`#pm-${eid}`);
  if (sub) {
    const parts = [];
    if (full.duration)  parts.push(fmtDuration(full.duration));
    if (full.extractor) parts.push(full.extractor);
    if (full.uploader)  parts.push(full.uploader);
    sub.textContent = parts.join(' · ');
  }

  // Selected-format badges: start empty — updated when user picks a format
  updateEntryHeaderBadges(eid);
  updateEntryOrangeState(eid);
}

function updatePlaylistEntryError(eid) {
  const el = qs(`#pe-${eid}`);
  if (!el) return;
  const st = qs(`#ps-${eid}`);
  if (st) { st.textContent = '✕'; st.className = 'playlist-entry-status error'; }
  const badges = qs(`#pf-${eid}`);
  if (badges) badges.innerHTML = `<span class="pl-format-badge unavailable">${I18N.t('playlist.unavailable')}</span>`;
  const cb = el.querySelector('input[type=checkbox]');
  if (cb) { cb.checked = false; cb.disabled = true; }
  State.playlistSelected.delete(eid);
}

/* ── Entry accordion body: format selection only (no header duplication) ───── */
function renderEntryAccordionBody(eid, entry) {
  const outer = qs(`#pb-${eid}`);
  if (!outer) return;
  const body = outer.querySelector('.pl-body-inner');
  if (!body) return;
  const sel = State.plEntrySelections[eid] || {};

  body.innerHTML = `
    <div class="result-formats">

      <!-- Video -->
      <div class="format-section${State.plVideoEnabled ? '' : ' disabled'}" id="pes-v-${eid}">
        <div class="format-section-header" id="pefsh-v-${eid}">
          <label class="toggle toggle-sm" onclick="event.stopPropagation()">
            <input type="checkbox" ${State.plVideoEnabled ? 'checked' : ''}
                   onchange="togglePlEntryStream('${eid}','video',this.checked)">
            <span class="toggle-slider"></span>
          </label>
          <span class="format-section-title">${I18N.t('formats.video')}</span>
          <span class="format-section-meta" id="pec-v-${eid}"></span>
          <span class="pl-global-badge" id="peb-v-${eid}"></span>
          <span class="pl-accordion-arrow open" id="pea-v-${eid}">▾</span>
        </div>
        <div id="pef-v-${eid}">
          <div id="peff-v-${eid}"></div>
          <div class="format-size-hint" id="peh-v-${eid}"></div>
        </div>
      </div>

      <!-- Audio -->
      <div class="format-section${State.plAudioEnabled ? '' : ' disabled'}" id="pes-a-${eid}">
        <div class="format-section-header" id="pefsh-a-${eid}">
          <label class="toggle toggle-sm" onclick="event.stopPropagation()">
            <input type="checkbox" ${State.plAudioEnabled ? 'checked' : ''}
                   onchange="togglePlEntryStream('${eid}','audio',this.checked)">
            <span class="toggle-slider"></span>
          </label>
          <span class="format-section-title">${I18N.t('formats.audio')}</span>
          <span class="format-section-meta" id="pec-a-${eid}"></span>
          <span class="pl-global-badge" id="peb-a-${eid}"></span>
          <span class="pl-accordion-arrow open" id="pea-a-${eid}">▾</span>
        </div>
        <div id="pef-a-${eid}">
          <div id="peff-a-${eid}"></div>
          <div class="format-size-hint" id="peh-a-${eid}"></div>
        </div>
      </div>

      <!-- Subtitles -->
      <div class="format-section" id="pes-s-${eid}">
        <div class="format-section-header" id="pefsh-s-${eid}">
          <label class="toggle toggle-sm" onclick="event.stopPropagation()">
            <input type="checkbox" ${sel.subsEnabled ? 'checked' : ''}
                   onchange="togglePlEntryStream('${eid}','subs',this.checked)">
            <span class="toggle-slider"></span>
          </label>
          <span class="format-section-title">${I18N.t('formats.subtitles')}</span>
          <span class="pl-global-badge" id="peb-s-${eid}"></span>
          <span class="pl-accordion-arrow open" id="pea-s-${eid}">▾</span>
        </div>
        <div id="pef-s-${eid}">
          <div class="search-wrap" style="margin-bottom:6px">
            <input type="text" class="sub-search"
                   placeholder="${I18N.t('subtitles.search_placeholder') || 'Search language…'}"
                   oninput="filterEntrySubItems('${eid}', this.value)" autocomplete="off">
            <button class="search-clear" type="button" tabindex="-1" aria-label="Clear">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg>
            </button>
          </div>
          <div class="sub-list" id="pefs-${eid}"></div>
        </div>
      </div>

    </div>`;

  // Attach accordion clicks for this entry's sections
  ['v','a','s'].forEach(t => {
    const header = qs(`#pefsh-${t}-${eid}`);
    if (!header) return;
    header.style.cursor = 'pointer';
    header.addEventListener('click', e => {
      if (e.target.closest('label')) return;
      const body2 = qs(`#pef-${t}-${eid}`);
      const arrow = qs(`#pea-${t}-${eid}`);
      if (!body2) return;
      const isOpen = body2.style.display !== 'none';
      body2.style.display = isOpen ? 'none' : '';
      if (arrow) arrow.classList.toggle('open', !isOpen);
    });
  });

  renderEntryFormatChips('video', eid, entry.video_formats || [], sel.video);
  renderEntryFormatChips('audio', eid, entry.audio_formats || [], sel.audio);
  renderEntrySubList(eid, entry.subtitles || {}, sel.subs);
  _restoreEntryHint('v', eid, entry.video_formats, sel.video);
  _restoreEntryHint('a', eid, entry.audio_formats, sel.audio);
}


function _restoreEntryHint(prefix, eid, formats, selectedId) {
  if (!selectedId || !formats) return;
  const fmt  = formats.find(f => f.format_id === selectedId);
  const hint = qs(`#peh-${prefix}-${eid}`);
  if (hint && fmt?.filesize_human) hint.textContent = `~${fmt.filesize_human}`;
}

/* Update the selected-format badges in the accordion header */
function updateEntryHeaderBadges(eid) {
  const el = qs(`#pf-${eid}`);
  if (!el) return;
  const sel   = State.plEntrySelections[eid] || {};
  const entry = State.playlistEntries.find(e => (e._stub?.id || e.id) === eid);
  if (!entry) { el.innerHTML = ''; return; }

  const videoOn = State.plVideoEnabled && (sel.videoEnabled !== false);
  const audioOn = State.plAudioEnabled && (sel.audioEnabled !== false);
  const subsOn  = State.plSubsEnabled  && (sel.subsEnabled  !== false);

  const parts = [];
  if (videoOn && sel.video) {
    const fmt = entry.video_formats?.find(f => f.format_id === sel.video);
    if (fmt) parts.push(`<span class="pl-format-badge">▶ ${[fmt.quality_label, fmt.codec].filter(Boolean).join(' · ')}</span>`);
  }
  if (audioOn && sel.audio) {
    const fmt = entry.audio_formats?.find(f => f.format_id === sel.audio);
    if (fmt) parts.push(`<span class="pl-format-badge">♪ ${[fmt.quality_label, fmt.codec].filter(Boolean).join(' · ')}</span>`);
  }
  if (subsOn && sel.subs) {
    parts.push(`<span class="pl-format-badge">SUB ${langName(sel.subs.lang)}</span>`);
  }
  el.innerHTML = parts.join('');
}

/* ── Entry subtitle list ───────────────────────────────────────────────────── */
function renderEntrySubList(eid, subs, selectedSub) {
  const wrap = qs(`#pefs-${eid}`);
  if (!wrap) return;
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
  none.className = `sub-item${!selectedSub ? ' selected' : ''}`;
  none.dataset.lang = '__none__';
  none.innerHTML = `<span class="sub-item-lang">${I18N.t('subtitles.none_option')}</span>`;
  none.onclick = () => selectEntrySubtitle(eid, null, false);
  wrap.appendChild(none);

  all.forEach(({ lang, auto }) => {
    const el = document.createElement('div');
    const active = selectedSub?.lang === lang && String(selectedSub?.auto) === String(auto);
    el.className = `sub-item${active ? ' selected' : ''}`;
    el.innerHTML = `
      <span class="sub-item-lang">${lang}</span>
      <span class="sub-item-type ${auto ? 'auto' : 'manual'}">
        ${auto ? I18N.t('subtitles.auto') : I18N.t('subtitles.manual')}
      </span>`;
    el.onclick = () => selectEntrySubtitle(eid, lang, auto);
    wrap.appendChild(el);
  });
}

function selectEntrySubtitle(eid, lang, auto) {
  if (!State.plEntrySelections[eid]) State.plEntrySelections[eid] = {};
  State.plEntrySelections[eid].subs = lang ? { lang, auto } : null;
  qsa(`#pef-s-${eid} .sub-item`).forEach(el => {
    const active = lang ? (el.dataset.lang === lang) : (el.dataset.lang === '__none__');
    el.classList.toggle('selected', active);
  });
  updateEntryHeaderBadges(eid);
}

function renderEntryFormatChips(type, eid, formats, selectedId) {
  const prefix = type === 'video' ? 'v' : 'a';
  // Chips go inside peff- (inner wrapper), not pef- (accordion body)
  const wrap    = qs(`#peff-${prefix}-${eid}`);
  const countEl = qs(`#pec-${prefix}-${eid}`);
  if (!wrap) return;
  wrap.innerHTML = '';

  if (!formats.length) {
    wrap.innerHTML = `<span class="muted small">${I18N.t('formats.none')}</span>`;
    return;
  }
  if (countEl) countEl.textContent = `${formats.length}`;

  if (type === 'video') {
    // Group by quality family
    const GROUPS = [
      { label: '4K',  test: h => h >= 2160 },
      { label: 'FHD', test: h => h >= 1080 && h < 2160 },
      { label: 'HD',  test: h => h >= 720  && h < 1080 },
      { label: 'SD',  test: h => h > 0     && h < 720  },
      { label: '',    test: () => true },
    ];
    let lastG = null, chipArea = null;
    formats.forEach(f => {
      const g = GROUPS.find(gr => gr.test(f.height || 0));
      if (g !== lastG) {
        const gDiv = document.createElement('div');
        gDiv.className = 'format-group';
        const lbl = document.createElement('span');
        lbl.className = 'format-group-label';
        lbl.textContent = g.label;
        chipArea = document.createElement('div');
        chipArea.className = 'format-group-chips';
        gDiv.appendChild(lbl); gDiv.appendChild(chipArea);
        wrap.appendChild(gDiv);
        lastG = g;
      }
      chipArea.appendChild(_makeEntryChip(eid, type, f, selectedId));
    });
  } else {
    formats.forEach(f => wrap.appendChild(_makeEntryChip(eid, type, f, selectedId)));
  }
}

function _makeEntryChip(eid, type, f, selectedId) {
  const chip = document.createElement('button');
  chip.className = `format-chip${f.format_id === selectedId ? ' selected' : ''}`;
  chip.dataset.formatId = f.format_id;
  const parts = [f.quality_label];
  if (f.codec)    parts.push(f.codec);
  if (f.ext)      parts.push(f.ext);
  if (f.language) parts.push(`[${f.language}]`);
  chip.textContent = parts.join(' · ');
  if (f.filesize_human) chip.title = `~${f.filesize_human}`;
  chip.onclick = () => selectEntryFormat(eid, type, f.format_id, f.filesize_human);
  return chip;
}

function selectEntryFormat(eid, type, formatId, filesizeHuman) {
  if (!State.plEntrySelections[eid]) State.plEntrySelections[eid] = {};
  State.plEntrySelections[eid][type === 'video' ? 'video' : 'audio'] = formatId;

  const prefix = type === 'video' ? 'v' : 'a';
  qsa(`#peff-${prefix}-${eid} .format-chip`).forEach(c =>
    c.classList.toggle('selected', c.dataset.formatId === formatId));

  const hint = qs(`#peh-${prefix}-${eid}`);
  if (hint) hint.textContent = filesizeHuman ? `~${filesizeHuman}` : '';

  // Badge in accordion header
  const entry = State.playlistEntries.find(e => (e._stub?.id || e.id) === eid);
  const fmt   = (type === 'video' ? entry?.video_formats : entry?.audio_formats)
                  ?.find(f => f.format_id === formatId);
  const badge = qs(`#peb-${prefix}-${eid}`);
  if (badge) {
    badge.innerHTML = fmt
      ? `<span class="format-chip selected" style="pointer-events:none;font-size:11px;height:22px">${[fmt.quality_label, fmt.codec].filter(Boolean).join(' · ')}</span>`
      : '';
  }

  updateEntryHeaderBadges(eid);
  updateEntryOrangeState(eid);
  updateAddQueueBtn();
}

function _syncEntryVideoChips(eid, formatId) {
  if (!qs(`#pb-${eid}`)?.classList.contains('open')) return;
  qsa(`#peff-v-${eid} .format-chip`).forEach(c =>
    c.classList.toggle('selected', c.dataset.formatId === formatId));
}
function _syncEntryAudioChips(eid, formatId) {
  if (!qs(`#pb-${eid}`)?.classList.contains('open')) return;
  qsa(`#peff-a-${eid} .format-chip`).forEach(c =>
    c.classList.toggle('selected', c.dataset.formatId === formatId));
}

function togglePlEntryStream(eid, type, enabled) {
  if (!State.plEntrySelections[eid]) State.plEntrySelections[eid] = {};

  if (type === 'video') {
    State.plEntrySelections[eid].videoEnabled = enabled;
    qs(`#pes-v-${eid}`)?.classList.toggle('disabled', !enabled);
  } else if (type === 'audio') {
    State.plEntrySelections[eid].audioEnabled = enabled;
    qs(`#pes-a-${eid}`)?.classList.toggle('disabled', !enabled);
  } else if (type === 'subs') {
    State.plEntrySelections[eid].subsEnabled = enabled;
    qs(`#pes-s-${eid}`)?.classList.toggle('disabled', !enabled);
  }

  updateEntryHeaderBadges(eid);
  updateEntryOrangeState(eid);
  updateAddQueueBtn();
}

/* ── Playlist selection helpers ────────────────────────────────────────────── */
function togglePlaylistEntry(id, checked) {
  if (checked) State.playlistSelected.add(id);
  else         State.playlistSelected.delete(id);
  updateAddQueueBtn();
}

function selectAllPlaylist(val) {
  State.playlistInfo?.entries.forEach(e => {
    const cb = qs(`#pe-${e.id} input[type=checkbox]`);
    if (cb && !cb.disabled) {
      if (val) State.playlistSelected.add(e.id);
      else     State.playlistSelected.delete(e.id);
      cb.checked = val;
    }
  });
  updateAddQueueBtn();
}

/* ── Add selected to queue ─────────────────────────────────────────────────── */
async function addPlaylistToQueue() {
  const selected = State.playlistEntries.filter(e =>
    State.playlistSelected.has(e._stub?.id || e.id));

  if (!selected.length) { toast(I18N.t('playlist.none_selected'), 'info'); return; }
  if (countOrangeSelected() > 0) {
    toast(I18N.t('playlist.needs_selection', { n: countOrangeSelected() }), 'error');
    return;
  }

  for (const entry of selected) {
    const eid  = entry._stub?.id || entry.id;
    const sel  = State.plEntrySelections[eid] || {};
    const opts = {
      thumbnail:           entry.thumbnail,
      output_dir:          State.settings.output_dir,
      merge_output_format: State.outputContainer || 'mp4',
    };
    if (State.plVideoEnabled && sel.video) opts.format_video = sel.video;
    if (State.plAudioEnabled && sel.audio) opts.format_audio = sel.audio;
    if (sel.subsEnabled && sel.subs) {
      opts.subtitle_lang = sel.subs.lang;
      opts.subtitle_auto = sel.subs.auto;
      opts.embed_subs    = State.settings.embed_subs;
    }
    try { await API.addToQueue(entry.webpage_url, entry.title, opts); } catch {}
  }

  toast(I18N.t('playlist.added', { n: selected.length }), 'success');
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

/* ── Settings chip helpers ─────────────────────────────────────────────────── */
function setChipSel(rowId, val, attr = 'data-val') {
  qsa(`#${rowId} .format-chip`).forEach(c =>
    c.classList.toggle('selected', c.getAttribute(attr) === val));
}
function getChipSel(rowId, attr = 'data-val') {
  return qs(`#${rowId} .format-chip.selected`)?.getAttribute(attr) ?? null;
}

/* Language datalist for subtitle preference */
const COMMON_LANGS = [
  ['af','Afrikaans'],['ar','Arabic / العربية'],['bg','Bulgarian'],
  ['zh-Hans','Chinese (Simplified)'],['zh-Hant','Chinese (Traditional)'],
  ['cs','Czech'],['da','Danish'],['nl','Dutch'],['en','English'],
  ['fi','Finnish'],['fr','French / Français'],['de','German / Deutsch'],
  ['el','Greek'],['he','Hebrew'],['hi','Hindi'],['hu','Hungarian'],
  ['id','Indonesian'],['it','Italian / Italiano'],['ja','Japanese / 日本語'],
  ['ko','Korean / 한국어'],['no','Norwegian'],['pl','Polish'],
  ['pt','Portuguese'],['pt-BR','Portuguese (Brazil)'],['ro','Romanian'],
  ['ru','Russian / Русский'],['sr','Serbian'],['sk','Slovak'],
  ['es','Spanish / Español'],['sv','Swedish'],['th','Thai'],
  ['tr','Turkish'],['uk','Ukrainian'],['vi','Vietnamese'],
];

/* ── Language picker component ────────────────────────────────────────────── */
function toggleLangPicker(pickerId) {
  const dropdown = qs(`#${pickerId}-dropdown`);
  if (!dropdown) return;
  const willOpen = !dropdown.classList.contains('open');
  // Close all pickers first
  qsa('.lang-picker-dropdown.open').forEach(d => d.classList.remove('open'));
  if (willOpen) {
    dropdown.classList.add('open');
    const search = dropdown.querySelector('.lang-picker-search');
    if (search) { search.value = ''; filterLangPicker(pickerId, ''); search.focus(); }
  }
}

function filterLangPicker(pickerId, query) {
  const q = query.toLowerCase().trim();
  qsa(`#${pickerId}-list .lang-picker-item`).forEach(item => {
    const text  = item.textContent.toLowerCase();
    const code  = (item.dataset.code || '').toLowerCase();
    item.classList.toggle('hidden', !!(q && !text.includes(q) && !code.includes(q)));
  });
}

function selectLangPickerItem(pickerId, inputId, code, label) {
  const noneLabel = I18N.t('settings.sub_lang_none');
  const display = qs(`#${pickerId}-display`);
  if (display) display.textContent = code ? label : noneLabel;
  const hidden = qs(`#${inputId}`);
  if (hidden) hidden.value = code;
  qsa(`#${pickerId}-list .lang-picker-item`).forEach(item =>
    item.classList.toggle('selected', item.dataset.code === code));
  qs(`#${pickerId}-dropdown`)?.classList.remove('open');
}

function buildLangPicker(pickerId, inputId, currentValue) {
  const list = qs(`#${pickerId}-list`);
  if (!list) return;

  const sorted = [...COMMON_LANGS].sort((a, b) =>
    langName(a[0]).localeCompare(langName(b[0])));

  const noneLabel = I18N.t('settings.sub_lang_none');
  const none = document.createElement('div');
  none.className = `lang-picker-item${!currentValue ? ' selected' : ''}`;
  none.dataset.code = '';
  none.textContent = noneLabel;
  none.onclick = () => selectLangPickerItem(pickerId, inputId, '', noneLabel);
  list.innerHTML = '';
  list.appendChild(none);

  sorted.forEach(([code]) => {
    const name  = langName(code);
    const label = `${name} (${code})`;
    const item  = document.createElement('div');
    item.className = `lang-picker-item${currentValue === code ? ' selected' : ''}`;
    item.dataset.code = code;
    item.textContent  = label;
    item.onclick = () => selectLangPickerItem(pickerId, inputId, code, label);
    list.appendChild(item);
  });

  // Set button display text
  const display = qs(`#${pickerId}-display`);
  if (display) {
    display.textContent = currentValue
      ? `${langName(currentValue)} (${currentValue})`
      : noneLabel;
  }
  // Sync hidden input
  const hidden = qs(`#${inputId}`);
  if (hidden) hidden.value = currentValue || '';
}

function renderSettings() {
  const s = State.settings;
  const set    = (id, val) => { const el = qs(`#${id}`); if (el) el.value = val ?? ''; };
  const setChk = (id, val) => { const el = qs(`#${id}`); if (el) el.checked = !!val; };

  set('s-lang',         s.language);
  set('s-output-dir',   s.output_dir);
  set('s-filename-tpl', s.filename_template);
  set('s-video-q',      s.default_video_quality);
  set('s-video-codec',  s.default_codec ?? '');
  set('s-audio-q',      s.default_audio_quality);
  set('s-audio-ext',    s.default_audio_ext);
  // Language pickers: build list then set current value
  buildLangPicker('lp-sub',   's-sub-lang',   s.default_sub_lang);
  buildLangPicker('lp-audio', 's-audio-lang', s.default_audio_lang);
  set('s-max-dl',       s.max_concurrent);
  set('s-rate-limit',   s.rate_limit);
  set('s-cookies',      s.cookies_file);
  set('s-proxy',        s.proxy);
  setChk('s-sub-auto',  s.default_sub_auto);
  setChk('s-embed-subs',s.embed_subs);

  // Chip selectors
  setChipSel('theme-chip-row',      s.theme,                 'data-theme');
  setChipSel('output-format-chips', s.default_output_format, 'data-val');
  setChipSel('sub-format-chips',    s.subtitle_format,       'data-val');

  populateSubLangDatalist();
}

async function saveSettingsFromForm() {
  const val = id => qs(`#${id}`)?.value ?? '';
  const chk = id => qs(`#${id}`)?.checked ?? false;

  const patch = {
    language:              val('s-lang'),
    output_dir:            val('s-output-dir'),
    filename_template:     val('s-filename-tpl'),
    default_video_quality: val('s-video-q'),
    default_codec:         val('s-video-codec'),
    default_output_format: getChipSel('output-format-chips') ?? 'mp4',
    default_audio_quality: val('s-audio-q'),
    default_audio_ext:     val('s-audio-ext'),
    default_audio_lang:    val('s-audio-lang'),   // hidden input from lang-picker
    default_sub_lang:      val('s-sub-lang'),      // hidden input from lang-picker
    default_sub_auto:      chk('s-sub-auto'),
    embed_subs:            chk('s-embed-subs'),
    subtitle_format:       getChipSel('sub-format-chips') ?? 'srt',
    theme:                 getChipSel('theme-chip-row', 'data-theme') ?? 'dark',
    max_concurrent:        parseInt(val('s-max-dl')) || 2,
    rate_limit:            val('s-rate-limit'),
    cookies_file:          val('s-cookies'),
    proxy:                 val('s-proxy'),
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

    qs('#theme-toggle')?.addEventListener('click', toggleTheme);
    qs('#add-queue-btn').addEventListener('click', addCurrentToQueue);

    // Close lang-pickers when clicking outside
    document.addEventListener('click', e => {
      if (!e.target.closest('.lang-picker')) {
        qsa('.lang-picker-dropdown.open').forEach(d => d.classList.remove('open'));
      }
    });

    // Format section accordions for single video (V/A/S)
    initFormatSectionAccordions();
    // ── Search-clear button: show X while typing, clear on click ───────────
    document.addEventListener('input', e => {
      if (!e.target.classList.contains('sub-search')) return;
      const clear = e.target.closest('.search-wrap')?.querySelector('.search-clear');
      if (clear) clear.classList.toggle('visible', e.target.value.length > 0);
    });
    document.addEventListener('click', e => {
      const clear = e.target.closest('.search-clear');
      if (!clear) return;
      const input = clear.closest('.search-wrap')?.querySelector('.sub-search');
      if (!input) return;
      input.value = '';
      clear.classList.remove('visible');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    });

    // Subtitle search — global playlist selector
    qs('#pl-subs-search')?.addEventListener('input', e =>
      filterPlSubtitleChips(e.target.value));

    qs('#save-settings-btn').addEventListener('click', saveSettingsFromForm);

    // Real-time language switch — no Save button needed
    qs('#s-lang')?.addEventListener('change', async e => {
      const lang = e.target.value;
      await I18N.setLocale(lang);
      State.settings.language = lang;
      try { await API.saveSettings({ language: lang }); } catch {}
    });

    // Native folder picker for output directory
    qs('#browse-dir-btn')?.addEventListener('click', async () => {
      if (!window.pywebview?.api?.pick_folder) return;
      try {
        const path = await window.pywebview.api.pick_folder();
        if (path) qs('#s-output-dir').value = path;
      } catch {}
    });

    // ── Template tokens: click to insert at cursor ──────────────────────────
    qsa('.tpl-token').forEach(btn => {
      btn.addEventListener('click', () => {
        const token = btn.dataset.token;
        const input = qs('#s-filename-tpl');
        if (!input) return;
        const start = input.selectionStart ?? input.value.length;
        const end   = input.selectionEnd   ?? input.value.length;
        input.value = input.value.slice(0, start) + token + input.value.slice(end);
        input.selectionStart = input.selectionEnd = start + token.length;
        input.focus();
      });
    });

    // ── Chip selectors: theme, output format, subtitle format ───────────────
    qsa('#theme-chip-row .format-chip').forEach(c => {
      c.addEventListener('click', () => {
        setChipSel('theme-chip-row', c.dataset.theme, 'data-theme');
        applyTheme(c.dataset.theme);
        API.saveSettings({ theme: c.dataset.theme });
      });
    });
    qsa('#output-format-chips .format-chip').forEach(c => {
      c.addEventListener('click', () => setChipSel('output-format-chips', c.dataset.val));
    });
    qsa('#sub-format-chips .format-chip').forEach(c => {
      c.addEventListener('click', () => setChipSel('sub-format-chips', c.dataset.val));
    });

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
          await I18N.setLocale(State.settings.language || 'en');
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
