/* ─────────────────────────────────────────────────────────────────────────
   GRABBIT — i18n engine
   ───────────────────────────────────────────────────────────────────────── */

// Assigned to window explicitly so the object is reachable from other script
// files in Qt WebEngine, which does not promote top-level const/let to globals.
window.I18N = (() => {
  const _cache = {};
  let _lang = 'en';

  async function _load(lang) {
    if (_cache[lang]) return _cache[lang];
    try {
      const r = await fetch(`/locale/${lang}.json`);
      if (!r.ok) throw new Error(`${r.status}`);
      _cache[lang] = await r.json();
      return _cache[lang];
    } catch (e) {
      console.warn(`[i18n] locale "${lang}" not found, using "en"`);
      return _cache['en'] || {};
    }
  }

  function _resolve(obj, key) {
    return key.split('.').reduce((o, k) => (o != null && o[k] !== undefined ? o[k] : null), obj);
  }

  function t(key, vars = {}) {
    const locale = _cache[_lang] || _cache['en'] || {};
    let str = _resolve(locale, key);
    if (str === null) str = key;          // fallback: show the key
    if (typeof str !== 'string') str = String(str);
    Object.entries(vars).forEach(([k, v]) => {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    });
    return str;
  }

  function applyDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.dataset.i18nTitle);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
  }

  async function setLocale(lang) {
    await _load('en');           // always have fallback
    if (lang !== 'en') await _load(lang);
    _lang = lang;
    applyDOM();
    document.documentElement.lang = lang;
  }

  function current() { return _lang; }

  return { t, setLocale, applyDOM, current };
})();
