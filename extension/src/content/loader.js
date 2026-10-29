/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  "Load all chats": the sites load their chat list in pages as you scroll, so most of a long history
  is not in the page yet. This scrolls the sidebar to the bottom again and again until no new chats
  appear, so Select all can reach every chat. It scrolls the list only (never the chat itself), puts
  the list back where it was, and can be stopped at any time.

  Progress is counted in distinct chat ids seen, not in rows mounted: a list that recycles its rows
  keeps a constant number of nodes while it loads more chats. The result says whether the end of the
  list was actually reached ("complete") or the loading just stopped producing chats ("stalled").
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

  /** Adds the ids of the rows now mounted to `seen` and returns how many distinct chats have been seen. */
  function collect(seen) {
    for (const row of ABCM.dom.getAllConversations()) {
      const id = ABCM.dom.idFromElement(row);
      if (id) seen.add(id);
    }
    return seen.size;
  }

  async function waitForGrowth(seen, before) {
    const until = Date.now() + STEP_WAIT_MS;
    while (Date.now() < until && !state.stop) {
      await ABCM.util.delay(POLL_MS);
      if (collect(seen) > before) { await ABCM.util.delay(120); return; }
    }
  }

  const heightOf = (scroller) => scroller.scrollHeight;
  const atBottom = (scroller) => scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
  const stillLoading = (scroller) => !!scroller.querySelector?.('[aria-busy="true"], [role="progressbar"]');

  /**
   * Resolves with { loaded, total, stopped, complete, status }. onProgress receives the number of
   * distinct chats seen so far. status is 'complete' (end of list reached, nothing loading, every
   * chat seen is still on the page), 'recycled' (the site unmounts rows, so fewer chats are selectable
   * than were seen), 'stalled' (no new chats, but the end was not confirmed), 'stopped' or 'limit'.
   */
  async function loadAll({ onProgress } = {}) {
    if (state.running) return { loaded: 0, total: ABCM.dom.getAllConversations().length, stopped: false, complete: false, status: 'busy' };
    const first = ABCM.dom.getAllConversations()[0];
    if (!first) return { loaded: 0, total: 0, stopped: false, complete: false, status: 'stalled' };
    state.running = true;
    state.stop = false;
    const scroller = scrollerOf(first);
    const startTop = scroller.scrollTop;
    const seen = new Set();
    const startCount = collect(seen);
    let count = startCount;
    let stable = 0;
    let status = 'limit';
    let lastHeight = heightOf(scroller);
    try {
      for (let round = 0; round < MAX_ROUNDS && !state.stop; round += 1) {
        scroller.scrollTop = scroller.scrollHeight;
        await waitForGrowth(seen, count);
        ABCM.checkboxes.attachAll();
        const now = collect(seen);
        // A list that keeps growing taller is still loading, even when this round added no new id.
        const height = heightOf(scroller);
        stable = now > count || height > lastHeight ? 0 : stable + 1;
        lastHeight = height;
        count = Math.max(count, now);
        onProgress?.(count);
        if (stable >= STABLE_ROUNDS) {
          if (!atBottom(scroller) || stillLoading(scroller)) status = 'stalled';
          // More ids seen than rows now mounted: the site recycles rows, so only the mounted ones can be selected.
          else status = count > ABCM.dom.getAllConversations().length ? 'recycled' : 'complete';
          break;
        }
      }
      if (state.stop) status = 'stopped';
    } finally {
      scroller.scrollTop = startTop;
      state.running = false;
    }
    ABCM.state.listing = { status, at: Date.now() };
    // total = distinct chats seen; actionable = rows on the page now, the only ones Select all can reach.
    return { loaded: count - startCount, total: count, actionable: ABCM.dom.getAllConversations().length, stopped: state.stop, complete: status === 'complete', status };
  }

  ABCM.define('loader', { loadAll, stop: () => { state.stop = true; }, isRunning: () => state.running, scrollerOf });
})(globalThis);
