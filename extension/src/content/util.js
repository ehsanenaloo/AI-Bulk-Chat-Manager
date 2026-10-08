/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/* Small timing and waiting helpers shared by the content scripts. */
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Resolves with the first truthy value of evaluate(), or null on timeout.
   * A MutationObserver wakes the check when nodes are added or removed (menus and dialogs mount
   * through portals); the slow interval covers visibility changes that do not touch the DOM tree.
   */
  function waitForCondition(evaluate, { root = g.document, timeout = 2000, pollMs = 200 } = {}) {
    return new Promise((resolve) => {
      let settled = false;
      let observer = null;
      let interval = null;
      let timer = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        try { observer?.disconnect(); } catch (_) { /* already gone */ }
        if (interval) clearInterval(interval);
        if (timer) clearTimeout(timer);
        resolve(value ?? null);
      };
      const check = () => {
        if (settled) return;
        let value = null;
        try { value = evaluate(); } catch (_) { value = null; }
        if (value) finish(value);
      };
      check();
      if (settled) return;
      timer = setTimeout(() => finish(null), Math.max(0, timeout));
      try {
        observer = new MutationObserver(check);
        const target = root === g.document ? (g.document.documentElement || g.document.body) : root;
        if (target) observer.observe(target, { childList: true, subtree: true });
      } catch (_) { /* observation is an optimisation; the interval still runs */ }
      interval = setInterval(check, Math.max(60, pollMs));
    });
  }

  /** Resolves true when `selector` no longer matches anything in the document, false on timeout. */
  async function waitForGone(selector, timeout = 1000) {
    const gone = await waitForCondition(() => (g.document.querySelector(selector) ? null : true), { timeout, pollMs: 120 });
    return !!gone;
  }

  ABCM.define('util', {
    delay,
    waitForCondition,
    waitForGone,
    normalize: (value) => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  });
})(globalThis);
