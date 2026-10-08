/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Bulk engine: runs Delete or Archive over the selected chats.

  Two phases:
    1. API phase (sites with a backend, "fast mode" on): a small pool of workers calls the API engine.
       A shared pacer keeps a minimum gap between request starts and one 429 pauses every worker.
    2. Page-UI phase: whatever the API phase could not do, or everything on sites without an API,
       goes through the visual engine one chat at a time. The row menu and the confirm dialog are
       singletons in the page, so parallel workers would fight over them and could confirm the
       wrong chat. This phase therefore stays strictly serial.

  A chat that fails stays selected so it can be retried; one that succeeds is deselected. Unchecking
  a chat while a run is in progress skips it. Stop lets the request in flight finish and starts no more.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const DELAY = () => ABCM.config.delays;

  /** Finds the live row for an id after the site re-rendered the list and replaced the node. */
  function findLiveAnchor(id) {
    if (!id) return null;
    try {
      const stamped = g.document.querySelector(`[data-abcm-id="${g.CSS.escape(id)}"]`);
      if (stamped?.isConnected) return stamped;
      for (const row of ABCM.dom.getAllConversations()) if (ABCM.dom.idFromElement(row) === id) return row;
    } catch (_) { /* selector support differs; treat as not found */ }
    return null;
  }

  /** Returns the record with a connected anchor, rebinding to a fresh row when the old node went stale. */
  function resolveLive(target) {
    const state = ABCM.state;
    const current = state.get(target?.id) || target;
    if (!current?.id || current.anchor?.isConnected) return current;
    const rebound = findLiveAnchor(current.id);
    if (!rebound) return current;
    state.diagnostics.anchorRebinds += 1;
    ABCM.checkboxes.attach(rebound);
    return state.get(current.id) || { ...current, anchor: rebound };
  }

  function preflight(record) {
    if (!record?.anchor?.isConnected) return { ok: false, reason: 'conversation-detached' };
    if (!record.id) return { ok: false, reason: 'conversation-id-missing' };
    if (!ABCM.dom.isVisible(record.anchor, { fast: true })) return { ok: false, reason: 'conversation-not-visible' };
    return { ok: true };
  }

  function strategies() { return ['primary', 'fallback', 'aggressive']; }

  /** One chat through the page UI, retrying with progressively more forceful strategies. */
  async function runVisual(operation, target) {
    const site = ABCM.sites.current();
    if (site?.id === 'gemini') {
      const live = resolveLive(target);
      const pre = preflight(live);
      if (!pre.ok) return pre;
      const outcome = await ABCM.visualEngine.geminiDelete(operation, live);
      await ABCM.util.delay(ABCM.config.api.throttleMs);
      return outcome;
    }
    let last = { ok: false, reason: 'operation-failed' };
    for (const strategy of strategies()) {
      const live = resolveLive(target); // the list may have re-rendered between attempts
      const pre = preflight(live);
      if (!pre.ok) return pre;
      if (live.checkbox && !live.checkbox.checked) return { ok: false, reason: 'selection-cleared' };
      last = await ABCM.visualEngine.attempt(operation, live, strategy);
      if (last.ok) return last;
      if (['conversation-detached', 'stale-target', 'selection-cleared', 'delete-unconfirmed'].includes(last.reason)) return last;
      if (strategy !== 'aggressive') {
        ABCM.state.diagnostics.retries += 1;
        await ABCM.util.delay(DELAY().medium);
      }
    }
    return last;
  }

  function finalize(operation, target, outcome) {
    const state = ABCM.state;
    if (outcome?.ok) {
      state.setSelected(target.id, false);
      if (operation === 'DELETE') state.unregister(target.id);
      return;
    }
    state.countFailure(outcome?.reason);
  }

  function pacer(minGapMs) {
    let nextAt = 0;
    return async () => {
      const now = Date.now();
      const wait = Math.max(0, nextAt - now);
      nextAt = Math.max(now, nextAt) + Math.max(0, minGapMs);
      if (wait > 0) await ABCM.util.delay(wait);
    };
  }

  /**
   * Runs `operation` ('DELETE' | 'ARCHIVE') over the current selection.
   * onProgress receives { operation, total, done, succeeded, failed, currentTitle } after each chat.
   */
  async function run(operation, { onProgress } = {}) {
    const state = ABCM.state;
    const site = ABCM.sites.current();
    const api = ABCM.apiEngine;
    const cfg = ABCM.config.api;
    const requested = state.selectedRecords();

    // Resolve every selected chat to a live row; those with none are reported, not silently dropped.
    const entries = [];
    const failures = [];
    const seen = new Set();
    for (const record of requested) {
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      const live = resolveLive(record);
      if (!live.anchor?.isConnected) {
        failures.push({ id: record.id, title: record.title, reason: 'conversation-detached' });
        continue;
      }
      entries.push({ index: entries.length, target: live });
    }

    const total = entries.length + failures.length;
    const ctx = { operation, total, done: failures.length, succeeded: 0, failures, stopped: false };
    const report = (title = '') => onProgress?.({
      operation, total, done: ctx.done, succeeded: ctx.succeeded, failed: failures.length, currentTitle: title
    });

    if (!entries.length) {
      report();
      return { operation, requested: requested.length, total, succeeded: 0, failures, stopped: false, durationMs: 0, concurrency: 1 };
    }

    state.clearStop();
    state.setStatus('running');
    state.diagnostics.runs += 1;
    const startedAt = Date.now();
    report();

    const record = (entry, outcome) => {
      finalize(operation, entry.target, outcome);
      ctx.done += 1;
      if (outcome?.ok) ctx.succeeded += 1;
      else failures.push({ id: entry.target.id, title: entry.target.title, reason: outcome?.reason || 'operation-failed' });
      report(entry.target.title);
    };

    let concurrency = 1;
    try {
      let pending = entries;
      const useApi = !!site && site.method === 'api' && api.isEnabled();

      if (useApi) {
        await api.prepare();
        concurrency = Math.max(1, Math.min(cfg.concurrency, entries.length));
        const pace = pacer(cfg.throttleMs);
        const fallbacks = [];
        let cursor = 0;
        let cooldownUntil = 0; // shared 429 backoff across workers

        const callApi = (live) => api.run(operation, live.id).catch((error) => ({ ok: false, reason: error?.message || 'api-error' }));

        const handle = async (entry) => {
          const live = resolveLive(entry.target);
          const pre = preflight(live);
          if (!pre.ok) { record(entry, pre); return; }
          if (live.checkbox && !live.checkbox.checked) { record(entry, { ok: false, reason: 'selection-cleared' }); return; }
          const cooldown = cooldownUntil - Date.now();
          if (cooldown > 0) await ABCM.util.delay(cooldown);
          await pace();
          let outcome = await callApi(live);
          if (outcome.reason === 'api-rate-limited') {
            cooldownUntil = Date.now() + cfg.rateLimitBackoffMs;
            await ABCM.util.delay(Math.max(0, cooldownUntil - Date.now()));
            await pace();
            outcome = await callApi(live);
          }
          if (outcome.ok) { api.retireRow(live); record(entry, outcome); return; }
          if (outcome.reason === 'conversation-id-missing') { record(entry, outcome); return; }
          state.diagnostics.apiFallbacks += 1;
          fallbacks.push(entry);
        };

        const worker = async () => {
          for (;;) {
            if (state.stopRequested) return;
            const index = cursor;
            cursor += 1;
            if (index >= entries.length) return;
            const entry = entries[index];
            try { await handle(entry); } catch (error) { record(entry, { ok: false, reason: error?.message || 'operation-failed' }); }
          }
        };
        await Promise.all(Array.from({ length: concurrency }, worker));
        fallbacks.sort((a, b) => a.index - b.index);
        pending = fallbacks;
      }

      // Page-UI phase: strictly serial.
      for (const entry of pending) {
        if (state.stopRequested) break;
        report(entry.target.title);
        try { record(entry, await runVisual(operation, entry.target)); } catch (error) { record(entry, { ok: false, reason: error?.message || 'operation-failed' }); }
      }
      ctx.stopped = state.stopRequested && ctx.done < total;
    } finally {
      state.clearStop();
      state.setStatus('ready');
    }

    return {
      operation, requested: requested.length, total, succeeded: ctx.succeeded, failures,
      stopped: ctx.stopped, durationMs: Date.now() - startedAt, concurrency
    };
  }

  ABCM.define('bulk', { run, resolveLive, preflight, findLiveAnchor });
})(globalThis);
