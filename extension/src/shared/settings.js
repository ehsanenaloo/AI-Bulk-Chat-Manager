/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  User settings, kept in chrome.storage.local under one key and shared by every part of the
  extension. Stored values are always passed through normalize(), so a damaged or older entry
  can never put the UI into an undefined state.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const KEY = 'settings';
  const LEGACY_FAST_KEY = 'fastApiMode'; // written by versions before 9.0.0

  const THEMES = ['system', 'light', 'dark'];
  const ACCENTS = ['teal', 'blue', 'indigo', 'neutral'];

  const DEFAULTS = Object.freeze({
    language: 'auto',      // 'auto' follows the browser language, otherwise a code from i18n.LANGUAGES
    theme: 'system',
    accent: 'teal',
    fastMode: true,        // call the site's backend first, fall back to its page UI
    autoLoad: true,        // keep adding checkboxes to chats the site loads while you scroll
    confirmThreshold: 20,  // above this many chats a delete needs an extra confirmation tick
    showLauncher: false,   // small button on chat pages that opens the panel
    panelPosition: null    // { x, y } in CSS pixels from the top-left of the viewport, or null for the default corner
  });

  function number(value, min, max, fallback) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  function normalize(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const pos = s.panelPosition;
    return {
      language: typeof s.language === 'string' && /^[A-Za-z-]{2,10}$/.test(s.language) ? s.language : DEFAULTS.language,
      theme: THEMES.includes(s.theme) ? s.theme : DEFAULTS.theme,
      accent: ACCENTS.includes(s.accent) ? s.accent : DEFAULTS.accent,
      fastMode: typeof s.fastMode === 'boolean' ? s.fastMode : DEFAULTS.fastMode,
      autoLoad: typeof s.autoLoad === 'boolean' ? s.autoLoad : DEFAULTS.autoLoad,
      confirmThreshold: number(s.confirmThreshold, 1, 500, DEFAULTS.confirmThreshold),
      showLauncher: typeof s.showLauncher === 'boolean' ? s.showLauncher : DEFAULTS.showLauncher,
      panelPosition: pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) ? { x: Math.round(pos.x), y: Math.round(pos.y) } : null
    };
  }

  let current = normalize(null);
  const listeners = new Set();

  async function load() {
    const stored = await ABCM.ext.storageGet([KEY, LEGACY_FAST_KEY]);
    const raw = stored?.[KEY] && typeof stored[KEY] === 'object' ? { ...stored[KEY] } : {};
    if (!('fastMode' in raw) && typeof stored?.[LEGACY_FAST_KEY] === 'boolean') raw.fastMode = stored[LEGACY_FAST_KEY];
    current = normalize(raw);
    return current;
  }

  async function save(patch) {
    // Re-read first: another page (the popup, the options page, another tab) may have changed a different field.
    const stored = await ABCM.ext.storageGet([KEY]);
    const base = normalize(stored?.[KEY]);
    const next = normalize({ ...base, ...patch });
    await ABCM.ext.storageSet({ [KEY]: next });
    current = next;
    return next;
  }

  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // Keep the cached copy in step with changes made anywhere else in the browser.
  try {
    ABCM.ext.onStorageChanged((changes, area) => {
      if (area !== 'local' || !changes[KEY]) return;
      const before = current;
      current = normalize(changes[KEY].newValue);
      listeners.forEach((listener) => { try { listener(current, before); } catch (error) { ABCM.warn('settings listener failed', error); } });
    });
  } catch (_) { /* no storage API (unit tests without a chrome stub) */ }

  ABCM.define('settings', {
    KEY,
    DEFAULTS,
    THEMES,
    ACCENTS,
    normalize,
    load,
    save,
    onChange,
    get: () => current
  });
})(globalThis);
