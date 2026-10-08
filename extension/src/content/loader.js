/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  "Load all chats": the sites load their chat list in pages as you scroll, so most of a long history
  is not in the page yet. This scrolls the sidebar to the bottom again and again until no new chats
  appear, so Select all can reach every chat. It scrolls the list only (never the chat itself), puts
  the list back where it was, and can be stopped at any time.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const STEP_WAIT_MS = 900;   // how long to wait for the site to answer one scroll
  const POLL_MS = 80;
  const STABLE_ROUNDS = 3;    // this many scrolls in a row with no new chat means "that is all"
  const MAX_ROUNDS = 600;

  /** The nearest ancestor that scrolls (the sidebar list), or the page itself. */
  function scrollerOf(el) {
    for (let node = el?.parentElement; node && node !== g.document.body; node = node.parentElement) {
      const style = g.getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) return node;
    }
    return g.document.scrollingElement || g.document.documentElement;
  }

  const state = { running: false, stop: false };

  async function waitForGrowth(before) {
    const until = Date.now() + STEP_WAIT_MS;
    while (Date.now() < until && !state.stop) {
      await ABCM.util.delay(POLL_MS);
      if (ABCM.dom.getAllConversations().length > before) { await ABCM.util.delay(120); return; }
    }
  }

  /** Resolves with { loaded, total, stopped }. onProgress receives the current number of chats. */
  async function loadAll({ onProgress } = {}) {
    if (state.running) return { loaded: 0, total: ABCM.dom.getAllConversations().length, stopped: false };
    const first = ABCM.dom.getAllConversations()[0];
    if (!first) return { loaded: 0, total: 0, stopped: false };
    state.running = true;
    state.stop = false;
    const scroller = scrollerOf(first);
    const startTop = scroller.scrollTop;
    const startCount = ABCM.dom.getAllConversations().length;
    let count = startCount;
    let stable = 0;
    try {
      for (let round = 0; round < MAX_ROUNDS && stable < STABLE_ROUNDS && !state.stop; round += 1) {
        scroller.scrollTop = scroller.scrollHeight;
        await waitForGrowth(count);
        ABCM.checkboxes.attachAll();
        const now = ABCM.dom.getAllConversations().length;
        stable = now > count ? 0 : stable + 1;
        count = Math.max(count, now);
        onProgress?.(count);
      }
    } finally {
      scroller.scrollTop = startTop;
      state.running = false;
    }
    return { loaded: count - startCount, total: count, stopped: state.stop };
  }

  ABCM.define('loader', { loadAll, stop: () => { state.stop = true; }, isRunning: () => state.running, scrollerOf });
})(globalThis);
