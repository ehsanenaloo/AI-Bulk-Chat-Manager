/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Interface translations.

  Text for the popup, options page and in-page panel lives in src/i18n/locales/<code>.json: a flat
  { key: message } object. A message is a string with {name} placeholders, or an object of plural
  forms keyed by the CLDR category (one, few, many, other, ...) that is chosen with the `count`
  parameter. English is always loaded as the fallback, so a missing key never shows up blank.

  Only the strings the browser itself needs (name, description, shortcut label) live in
  _locales/<code>/messages.json.

  Extension pages read the files directly. Content scripts cannot, so they ask the worker
  (message ABCM_GET_LOCALE), which keeps the files out of web_accessible_resources.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const LANGUAGES = [
    { code: 'en', name: 'English', dir: 'ltr' },
    { code: 'fa', name: 'فارسی', dir: 'rtl' },
    { code: 'es', name: 'Español', dir: 'ltr' },
    { code: 'fr', name: 'Français', dir: 'ltr' },
    { code: 'de', name: 'Deutsch', dir: 'ltr' },
    { code: 'pt-BR', name: 'Português (Brasil)', dir: 'ltr' },
    { code: 'ru', name: 'Русский', dir: 'ltr' },
    { code: 'zh-CN', name: '简体中文', dir: 'ltr' },
    { code: 'ja', name: '日本語', dir: 'ltr' },
    { code: 'ar', name: 'العربية', dir: 'rtl' },
    { code: 'hi', name: 'हिन्दी', dir: 'ltr' }
  ];

  const FALLBACK = 'en';
  const catalogs = new Map(); // code -> { key: message }
  let lang = FALLBACK;
  let numberFormat = new Intl.NumberFormat(FALLBACK);
  let pluralRules = new Intl.PluralRules(FALLBACK);

  /** Picks a supported code for a setting ('auto' or a code) and the browser's UI language. */
  function resolveLanguage(setting, uiLanguage) {
    const want = String(setting && setting !== 'auto' ? setting : uiLanguage || FALLBACK).replace('_', '-').toLowerCase();
    const exact = LANGUAGES.find((l) => l.code.toLowerCase() === want);
    if (exact) return exact.code;
    const base = want.split('-')[0];
    if (base === 'zh') return 'zh-CN';
    if (base === 'pt') return 'pt-BR';
    const byBase = LANGUAGES.find((l) => l.code.toLowerCase().split('-')[0] === base);
    return byBase ? byBase.code : FALLBACK;
  }

  const isExtensionPage = () => /^(chrome|moz|ms-browser)-extension:$/.test(g.location?.protocol || '');

  async function fetchCatalog(code) {
    if (isExtensionPage()) {
      const response = await g.fetch(ABCM.ext.getURL(`src/i18n/locales/${code}.json`));
      if (!response.ok) throw new Error(`locale ${code}: HTTP ${response.status}`);
      return response.json();
    }
    const reply = await ABCM.ext.sendMessage({ type: 'ABCM_GET_LOCALE', lang: code });
    if (!reply?.ok) throw new Error(reply?.error || `locale ${code} unavailable`);
    return reply.catalog;
  }

  async function ensureCatalog(code) {
    if (catalogs.has(code)) return catalogs.get(code);
    try {
      const catalog = await fetchCatalog(code);
      catalogs.set(code, catalog && typeof catalog === 'object' ? catalog : {});
    } catch (error) {
      ABCM.warn('could not load locale', code, error);
      catalogs.set(code, {});
    }
    return catalogs.get(code);
  }

  /** Loads English plus the chosen language and makes it current. Returns the resolved code. */
  async function init(setting = 'auto') {
    const code = resolveLanguage(setting, ABCM.ext.uiLanguage());
    await ensureCatalog(FALLBACK);
    if (code !== FALLBACK) await ensureCatalog(code);
    use(code);
    return code;
  }

  function use(code) {
    lang = LANGUAGES.some((l) => l.code === code) ? code : FALLBACK;
    try {
      numberFormat = new Intl.NumberFormat(lang);
      pluralRules = new Intl.PluralRules(lang);
    } catch (_) {
      numberFormat = new Intl.NumberFormat(FALLBACK);
      pluralRules = new Intl.PluralRules(FALLBACK);
    }
  }

  function format(template, params) {
    return String(template).replace(/\{(\w+)\}/g, (match, name) => {
      if (!params || !(name in params)) return match;
      const value = params[name];
      return typeof value === 'number' ? numberFormat.format(value) : String(value);
    });
  }

  function lookup(key) {
    const own = catalogs.get(lang)?.[key];
    return own !== undefined ? own : catalogs.get(FALLBACK)?.[key];
  }

  /** Translates a key. Unknown keys return the key itself so a gap is visible, never blank. */
  function t(key, params) {
    const entry = lookup(key);
    if (entry === undefined) return key;
    if (typeof entry === 'string') return format(entry, params);
    if (entry && typeof entry === 'object') {
      const category = typeof params?.count === 'number' ? pluralRules.select(params.count) : 'other';
      return format(entry[category] ?? entry.other ?? '', params);
    }
    return key;
  }

  function dir(code = lang) {
    return LANGUAGES.find((l) => l.code === code)?.dir || 'ltr';
  }

  /**
   * Fills a document or subtree from data attributes:
   *   data-i18n="key"                       -> textContent
   *   data-i18n-attr="title:key;aria-label:key"  -> attributes
   */
  function translateTree(root) {
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
    root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      el.getAttribute('data-i18n-attr').split(';').forEach((pair) => {
        const [attr, key] = pair.split(':').map((part) => part.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      });
    });
  }

  ABCM.define('i18n', {
    LANGUAGES,
    FALLBACK,
    resolveLanguage,
    init,
    use,
    t,
    dir,
    translateTree,
    format: (n) => numberFormat.format(n),
    get lang() { return lang; },
    /** Test hook: registers a catalog without any fetching. */
    _setCatalog(code, catalog) { catalogs.set(code, catalog); }
  });
})(globalThis);
