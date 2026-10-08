/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Makes sure a tab has a working copy of the content scripts.

  The browser only injects content scripts into pages that load after the extension is installed
  or updated. A chat tab that was already open has none (or an orphaned copy), so before talking to
  a tab we ping it and, if nobody answers, inject the same ordered file list the manifest declares.
  The popup and the keyboard-shortcut handler both rely on this, with the "activeTab" permission.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  /** The ordered content-script file list, read from the manifest so it is never duplicated. */
  function files() {
    const entry = (ABCM.ext.getManifest().content_scripts || [])[0];
    return entry?.js || [];
  }

  async function ping(tabId) {
    try {
      const reply = await ABCM.ext.tabsSendMessage(tabId, { type: 'ABCM_PING' });
      return reply?.ok && reply.ready ? reply : null;
    } catch (_) {
      return null;
    }
  }

  /** Resolves the ping reply once a healthy copy answers, or null when the tab cannot be reached. */
  async function ensure(tabId) {
    const first = await ping(tabId);
    if (first) return first;
    try {
      await ABCM.ext.executeScript({ target: { tabId }, files: files() });
    } catch (_) {
      return null; // no access to this tab (not a supported site, or a browser page)
    }
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 80 + attempt * 60));
      const reply = await ping(tabId);
      if (reply) return reply;
    }
    return null;
  }

  ABCM.define('inject', { files, ping, ensure });
})(globalThis);
