/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Background worker (a service worker in Chrome and Edge, an event page in Firefox).

  It stays small on purpose:
    - serves the content scripts the files they cannot read themselves (translations, panel styles),
    - opens the options page and links on their behalf,
    - turns the keyboard shortcut into "toggle the panel in this tab",
    - shows the monthly support heart on the toolbar icon.
  It has no host permissions, reads no pages and makes no network requests.
*/
if (typeof importScripts === 'function') {
  // Service worker: pull in the shared modules. In Firefox the manifest lists them as background scripts.
  importScripts('src/shared/namespace.js', 'src/shared/ext.js', 'src/shared/sites.js', 'src/shared/nudge.js', 'src/shared/inject.js');
}

(function (g) {
  'use strict';
  const ABCM = g.ABCM;
  const api = g.chrome;

  const ASSETS = {
    tokens: 'src/shared/tokens.css',
    components: 'src/shared/components.css',
    panel: 'src/content/ui/panel.css'
  };
  const LOCALE_RE = /^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$/;
  const BADGE_TEXT = '♥'; // heart
  const BADGE_COLOR = '#c8323a';

  async function readOwnFile(path) {
    const response = await g.fetch(api.runtime.getURL(path));
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response;
  }

  // ── support badge ──────────────────────────────────────────────────────────────────────────
  async function refreshBadge() {
    try {
      const nudge = await ABCM.nudge.read();
      const on = ABCM.nudge.isDue(nudge);
      await api.action.setBadgeText({ text: on ? BADGE_TEXT : '' });
      if (on) {
        await api.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
        try { await api.action.setBadgeTextColor?.({ color: '#ffffff' }); } catch (_) { /* not available everywhere */ }
      }
    } catch (_) { /* the badge is a convenience */ }
  }

  api.runtime.onInstalled.addListener(() => { ABCM.nudge.seed().then(refreshBadge).catch(() => {}); });
  api.runtime.onStartup.addListener(refreshBadge);
  api.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[ABCM.nudge.KEY]) refreshBadge(); });

  // ── messages from content scripts and pages ────────────────────────────────────────────────
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

    switch (message.type) {
      case 'ABCM_GET_LOCALE': {
        if (typeof message.lang !== 'string' || !LOCALE_RE.test(message.lang)) { sendResponse({ ok: false, error: 'invalid language' }); return false; }
        readOwnFile(`src/i18n/locales/${message.lang}.json`)
          .then((response) => response.json())
          .then((catalog) => sendResponse({ ok: true, catalog }))
          .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
      }
      case 'ABCM_GET_ASSET': {
        const names = (Array.isArray(message.names) ? message.names : []).filter((name) => typeof name === 'string' && Object.hasOwn(ASSETS, name));
        Promise.all(names.map((name) => readOwnFile(ASSETS[name]).then((response) => response.text())))
          .then((parts) => sendResponse({ ok: true, css: parts.join('\n') }))
          .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
      }
      case 'ABCM_OPEN_OPTIONS':
        api.runtime.openOptionsPage(() => { void api.runtime.lastError; sendResponse({ ok: true }); });
        return true;
      case 'ABCM_SUPPORT_PING':
        refreshBadge();
        sendResponse({ ok: true });
        return false;
      default:
        return false;
    }
  });

  // ── keyboard shortcut ──────────────────────────────────────────────────────────────────────
  api.commands?.onCommand.addListener(async (command) => {
    if (command !== 'toggle-panel') return;
    try {
      const [tab] = await ABCM.ext.tabsQuery({ active: true, currentWindow: true });
      if (!tab?.id || !ABCM.sites.match(tab.url || '')) return;
      if (await ABCM.inject.ensure(tab.id)) await ABCM.ext.tabsSendMessage(tab.id, { type: 'ABCM_TOGGLE' });
    } catch (_) { /* the tab went away or is not reachable */ }
  });
})(globalThis);
