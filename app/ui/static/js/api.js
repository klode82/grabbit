/* ─────────────────────────────────────────────────────────────────────────
   GRABBIT — API client
   ───────────────────────────────────────────────────────────────────────── */

// Assigned to window explicitly so the object is reachable from other script
// files in Qt WebEngine, which does not promote top-level const/let to globals.
window.API = (() => {
  const BASE = '';   // same origin

  async function _request(method, path, body = null) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== null) opts.body = JSON.stringify(body);
    const r = await fetch(BASE + path, opts);
    if (!r.ok) {
      let detail = `HTTP ${r.status}`;
      try { detail = (await r.json()).detail || detail; } catch {}
      throw new Error(detail);
    }
    return r.json();
  }

  // ── Analyze ───────────────────────────────────────────────────────────────

  function analyze(url) {
    return _request('POST', '/api/analyze', { url });
  }

  function analyzePlaylistEntry(url) {
    return _request('POST', '/api/analyze/playlist-entry', { url });
  }

  // ── Queue ─────────────────────────────────────────────────────────────────

  function getQueue() {
    return _request('GET', '/api/queue');
  }

  function addToQueue(url, title, options = {}) {
    return _request('POST', '/api/queue/add', { url, title, options });
  }

  function removeFromQueue(itemId) {
    return _request('DELETE', `/api/queue/${itemId}`);
  }

  function cancelItem(itemId) {
    return _request('POST', `/api/queue/${itemId}/cancel`);
  }

  function pauseItem(itemId) {
    return _request('POST', `/api/queue/${itemId}/pause`);
  }

  function resumeItem(itemId) {
    return _request('POST', `/api/queue/${itemId}/resume`);
  }

  function restartItem(itemId) {
    return _request('POST', `/api/queue/${itemId}/restart`);
  }

  function pauseAll() {
    return _request('POST', '/api/queue/pause-all');
  }

  function resumeAll() {
    return _request('POST', '/api/queue/resume-all');
  }

  function clearCompleted() {
    return _request('DELETE', '/api/queue/completed');
  }

  function clearAll() {
    return _request('DELETE', '/api/queue/all');
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  function getSettings() {
    return _request('GET', '/api/settings');
  }

  function getFfmpegInfo() {
    return _request('GET', '/api/ffmpeg');
  }

  function saveSettings(patch) {
    return _request('POST', '/api/settings', patch);
  }

  function resetSettings() {
    return _request('POST', '/api/settings/reset');
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  const WS = (() => {
    let _ws = null;
    let _handlers = {};
    let _reconnectTimer = null;

    function on(event, fn) {
      if (!_handlers[event]) _handlers[event] = [];
      _handlers[event].push(fn);
    }

    function off(event, fn) {
      if (_handlers[event])
        _handlers[event] = _handlers[event].filter(h => h !== fn);
    }

    function _emit(event, data) {
      (_handlers[event] || []).forEach(fn => fn(data));
      (_handlers['*'] || []).forEach(fn => fn(event, data));
    }

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      _ws = new WebSocket(`${proto}://${location.host}/api/ws`);

      _ws.onopen = () => {
        clearTimeout(_reconnectTimer);
        _emit('connected', {});
      };

      _ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          _emit(msg.event || 'message', msg);
        } catch {}
      };

      _ws.onclose = () => {
        _emit('disconnected', {});
        _reconnectTimer = setTimeout(connect, 3000);   // auto-reconnect
      };

      _ws.onerror = () => {};
    }

    function disconnect() {
      clearTimeout(_reconnectTimer);
      if (_ws) { _ws.close(); _ws = null; }
    }

    return { connect, disconnect, on, off };
  })();

  return {
    analyze,
    analyzePlaylistEntry,
    getQueue,
    addToQueue,
    removeFromQueue,
    cancelItem,
    pauseItem,
    resumeItem,
    restartItem,
    pauseAll,
    resumeAll,
    clearCompleted,
    clearAll,
    getSettings,
    getFfmpegInfo,
    saveSettings,
    resetSettings,
    WS,
  };
})();
