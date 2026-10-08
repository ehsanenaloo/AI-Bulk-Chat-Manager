/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Shared namespace for every script of the extension (content scripts, popup, options, worker).

  Scripts are plain classic scripts that attach to one global, `ABCM`, in a fixed order, so the
  extension loads unpacked with no build step. Each later script starts with
  `if (globalThis.ABCM?.__skip) return;` so that a second injection into a tab that already has a
  healthy copy (for example the popup injecting again after a failed ping) does nothing.

  A copy left behind by an extension update or reload is "orphaned": `chrome.runtime.id` is gone
  and none of its calls work. That copy is replaced, and its leftovers in the page are removed by
  ABCM.cleanupLeftovers() (content/checkboxes.js).
*/
(function (g) {
  'use strict';

  const alive = () => {
    try { return !!g.chrome?.runtime?.id; } catch (_) { return false; }
  };

  const previous = g.ABCM;
  if (previous && typeof previous.isAlive === 'function' && previous.isAlive()) {
    previous.__skip = true; // a healthy copy exists: the rest of this injection must not run
    return;
  }

  let version = '0.0.0';
  try { version = g.chrome?.runtime?.getManifest?.().version || version; } catch (_) { /* orphaned or no manifest in tests */ }

  g.ABCM = {
    version,
    isAlive: alive,
    replacedStaleInstance: !!previous,
    /** Registers a module on the namespace and returns it. */
    define(name, value) { this[name] = value; return value; },
    log(...args) { if (this.debug) console.log('[ABCM]', ...args); },
    warn(...args) { console.warn('[ABCM]', ...args); },
    debug: false,
    /** Ignore events that scripts on the page dispatch (real clicks and keys only). Tests turn this off. */
    trustedOnly: true
  };
})(globalThis);
