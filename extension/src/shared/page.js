/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Shared start-up for extension pages (popup and options): loads settings and the language, then
  applies theme, accent, language and direction to the document, and keeps them in step when the
  settings change anywhere else.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const dark = g.matchMedia ? g.matchMedia('(prefers-color-scheme: dark)') : null;

  function applyAppearance() {
    const s = ABCM.settings.get();
    const root = g.document.documentElement;
    root.setAttribute('data-theme', s.theme === 'dark' || (s.theme === 'system' && dark?.matches) ? 'dark' : 'light');
    root.setAttribute('data-accent', s.accent);
    root.setAttribute('lang', ABCM.i18n.lang);
    root.setAttribute('dir', ABCM.i18n.dir());
  }

  /** Loads everything a page needs. `onChange(now, before)` runs after a setting changes elsewhere. */
  async function init({ onChange } = {}) {
    let settings;
    try { settings = await ABCM.settings.load(); } catch (_) { settings = ABCM.settings.get(); }
    await ABCM.i18n.init(settings.language);
    applyAppearance();
    ABCM.i18n.translateTree(g.document);
    dark?.addEventListener?.('change', applyAppearance);
    ABCM.settings.onChange(async (now, before) => {
      if (now.language !== before.language) {
        await ABCM.i18n.init(now.language);
        ABCM.i18n.translateTree(g.document);
      }
      applyAppearance();
      onChange?.(now, before);
    });
    return settings;
  }

  ABCM.define('page', { init, applyAppearance });
})(globalThis);
