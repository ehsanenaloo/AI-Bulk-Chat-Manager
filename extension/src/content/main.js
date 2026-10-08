/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/* Content script entry point: loads settings and language, then starts listening. */
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  let markReady;
  ABCM.ready = new Promise((resolve) => { markReady = resolve; });

  async function boot() {
    if (!ABCM.sites.current()) { markReady(); return; } // not a supported page
    if (ABCM.replacedStaleInstance) ABCM.checkboxes.cleanupLeftovers();

    // The bridge goes first so the popup can always reach this tab, even if settings fail to load.
    ABCM.bridge.install();

    try { await ABCM.settings.load(); } catch (error) { ABCM.warn('settings unavailable, using defaults', error); }
    try { await ABCM.i18n.init(ABCM.settings.get().language); } catch (error) { ABCM.warn('language unavailable, using English', error); }

    ABCM.settings.onChange(async (now, before) => {
      try {
        if (now.language !== before.language) {
          await ABCM.i18n.init(now.language);
          await ABCM.panel.refreshLanguage();
          ABCM.checkboxes.relabel();
        }
        if (now.theme !== before.theme || now.accent !== before.accent) ABCM.panel.applyAppearance();
        if (now.showLauncher !== before.showLauncher) await ABCM.panel.syncLauncher();
        ABCM.panel.render();
      } catch (error) {
        ABCM.warn('could not apply a settings change', error);
      }
    });

    markReady(); // settings and language are in place: the panel can open with the right language and theme
    ABCM.panel.syncLauncher().catch(() => {});
    // Lets the worker refresh the monthly support badge at a moment the extension is in use.
    ABCM.ext.sendMessage({ type: 'ABCM_SUPPORT_PING' }).catch(() => {});
  }

  boot().catch((error) => { markReady(); ABCM.warn('failed to start', error); });
})(globalThis);
