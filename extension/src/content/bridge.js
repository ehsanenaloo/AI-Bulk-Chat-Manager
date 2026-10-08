/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Message bridge: lets the popup and the worker talk to this tab.

    ABCM_PING    -> { ok, ready, version, ...snapshot }   (is a healthy copy running here?)
    ABCM_STATE   -> { ok, ...snapshot }
    ABCM_START   -> starts selection mode and opens the panel
    ABCM_STOP    -> leaves selection mode
    ABCM_TOGGLE  -> switches between the two

  Only these types are answered; for anything else the listener returns false so it never holds a
  message channel open for another listener.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const HANDLED = new Set(['ABCM_PING', 'ABCM_STATE', 'ABCM_START', 'ABCM_STOP', 'ABCM_TOGGLE']);

  function install() {
    ABCM.ext.onMessage((message, _sender, sendResponse) => {
      if (!message || typeof message !== 'object' || !HANDLED.has(message.type)) return false;
      (async () => {
        try {
          if (message.type === 'ABCM_PING') sendResponse({ ok: true, ready: true, version: ABCM.version, ...ABCM.app.snapshot() });
          else if (message.type === 'ABCM_STATE') sendResponse({ ok: true, ...ABCM.app.snapshot() });
          else if (message.type === 'ABCM_START') sendResponse({ ok: true, ...(await ABCM.app.start()) });
          else if (message.type === 'ABCM_STOP') sendResponse({ ok: true, ...ABCM.app.stop() });
          else sendResponse({ ok: true, ...(await ABCM.app.toggle()) });
        } catch (error) {
          sendResponse({ ok: false, error: error?.message || String(error) });
        }
      })();
      return true; // the reply is asynchronous
    });
  }

  ABCM.define('bridge', { install });
})(globalThis);
