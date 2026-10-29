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

  Every chat ends in one of five states:
    succeeded  the change is confirmed (the backend accepted it, or the row left the list)
    failed     nothing changed; the reason is shown
    unknown    the change may or may not have happened (timeout, dropped connection, server error,
               a row that did not disappear); never counted as success and never repeated blindly
    skipped    the chat was unticked or left the list before its turn (reported as failed with a reason)
    cancelled  Stop was pressed before the chat was touched
  Failed and cancelled chats stay selected so they can be retried. An unknown chat is deselected and
  listed, so no Retry or later Delete repeats a change that may already have happened. Stop lets the request in flight finish
  and sends no further request.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const DELAY = () => ABCM.config.delays;

  /** One line of the run report. */
  const reportItem = (target, status, reason = '', evidence = '') => ({ id: target.id, title: target.title || '', url: target.url || '', status, reason, evidence });

  /** What backs a succeeded chat: the site's own reply ('api'), or its row leaving the page after the confirm click ('page'). */
  const evidenceOf = (outcome) => (outcome?.via === 'api' ? 'api' : 'page');

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

  /** Maps an engine outcome to the run state it counts as. */
  function classify(outcome) {
    if (outcome?.cancelled) return 'cancelled';
    if (outcome?.ok && outcome.verified !== false) return 'succeeded';
    if (outcome?.ok || outcome?.unknown) return 'unknown';
    return 'failed';
  }

  const cancelledOutcome = () => ({ ok: false, cancelled: true, reason: 'cancelled' });

  /** A delay that ends early when Stop is pressed. */
  async function waitUnlessStopped(ms) {
    const until = Date.now() + Math.max(0, ms);
    while (!ABCM.state.stopRequested) {
      const left = until - Date.now();
      if (left <= 0) return;
      await ABCM.util.delay(Math.min(left, 100));
    }
  }

  /** How long to pause after the n-th 429: the server's Retry-After, else a capped exponential with jitter. */
  function rateLimitWait(outcome, attempt) {
    const cfg = ABCM.config.api;
    if (outcome.retryAfterMs > 0) return outcome.retryAfterMs;
    const base = Math.min(cfg.rateLimitMaxBackoffMs, cfg.rateLimitBackoffMs * (2 ** attempt));
    const jitter = Number(cfg.rateLimitJitter) || 0;
    return Math.round(base * (1 - jitter + Math.random() * 2 * jitter));
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
      if (ABCM.state.stopRequested) return cancelledOutcome();
      const live = resolveLive(target); // the list may have re-rendered between attempts
      const pre = preflight(live);
      if (!pre.ok) return pre;
      if (live.checkbox && !live.checkbox.checked) return { ok: false, reason: 'selection-cleared' };
      last = await ABCM.visualEngine.attempt(operation, live, strategy);
      if (last.ok || last.unknown) return last; // an unknown outcome must not be repeated with another strategy
      if (['conversation-detached', 'stale-target', 'selection-cleared', 'delete-unconfirmed'].includes(last.reason)) return last;
      if (strategy !== 'aggressive') {
        ABCM.state.diagnostics.retries += 1;
        await ABCM.util.delay(DELAY().medium);
      }
    }
    return last;
  }

  function finalize(operation, target, outcome, status) {
    const state = ABCM.state;
    if (status === 'succeeded') {
      state.setSelected(target.id, false);
      if (operation === 'DELETE') state.unregister(target.id);
      return;
    }
    if (status === 'cancelled') return;
    if (status === 'unknown') {
      // Not confirmed: take it out of the selection so no later Retry or Delete repeats it by mistake.
      // The user checks the list and selects it again on purpose.
      state.diagnostics.unknownOutcomes = (state.diagnostics.unknownOutcomes || 0) + 1;
      state.setSelected(target.id, false);
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
    const unknown = [];
    const items = failures.map((failure) => {
      const known = state.get(failure.id) || {};
      return reportItem({ id: failure.id, title: failure.title, url: known.url }, 'failed', failure.reason);
    });
    const ctx = { operation, total, done: failures.length, succeeded: 0, failures, stopped: false, cancelled: 0 };
    const report = (title = '') => onProgress?.({
      operation, total, done: ctx.done, succeeded: ctx.succeeded, failed: failures.length, unknown: unknown.length, currentTitle: title
    });

    if (!entries.length) {
      report();
      return { operation, requested: requested.length, total, succeeded: 0, failures, unknown, items, cancelled: 0, stopped: false, durationMs: 0, concurrency: 1 };
    }

    state.clearStop();
    state.setStatus('running');
    state.diagnostics.runs += 1;
    const startedAt = Date.now();
    report();

    const record = (entry, outcome) => {
      const status = classify(outcome);
      finalize(operation, entry.target, outcome, status);
      const item = { id: entry.target.id, title: entry.target.title, reason: outcome?.reason || 'operation-failed' };
      items.push(reportItem(entry.target, status, outcome?.reason || (status === 'succeeded' ? '' : 'operation-failed'), status === 'succeeded' ? evidenceOf(outcome) : ''));
      if (status === 'cancelled') ctx.cancelled += 1;
      else {
        ctx.done += 1;
        if (status === 'succeeded') ctx.succeeded += 1;
        else if (status === 'unknown') unknown.push(item);
        else failures.push(item);
      }
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

        const callApi = (live) => api.run(operation, live.id).catch((error) => ({ ok: false, unknown: true, reason: error?.message || 'api-error' }));

        /** One chat through the API: waits its turn, honours Stop at every wait, retries only a 429. */
        const dispatch = async (live) => {
          for (let attempt = 0; ; attempt += 1) {
            await waitUnlessStopped(cooldownUntil - Date.now());
            if (state.stopRequested) return cancelledOutcome();
            await pace();
            if (state.stopRequested) return cancelledOutcome();
            const outcome = await callApi(live);
            if (outcome.reason !== 'api-rate-limited') return outcome;
            const wait = rateLimitWait(outcome, attempt);
            cooldownUntil = Math.max(cooldownUntil, Date.now() + wait);
            if (attempt >= cfg.rateLimitRetries) return outcome;
          }
        };

        const handle = async (entry) => {
          const live = resolveLive(entry.target);
          const pre = preflight(live);
          if (!pre.ok) { record(entry, pre); return; }
          if (live.checkbox && !live.checkbox.checked) { record(entry, { ok: false, reason: 'selection-cleared' }); return; }
          const outcome = await dispatch(live);
          if (outcome.ok) { api.retireRow(live); record(entry, outcome); return; }
          // Cancelled, unknown, rate limited for good, or no id: the page UI must not act on these.
          if (outcome.cancelled || outcome.unknown || outcome.reason === 'api-rate-limited' || outcome.reason === 'conversation-id-missing') { record(entry, outcome); return; }
          // A definite refusal changed nothing, so the page UI may try the same chat.
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
      // Chats Stop kept from being touched are part of the report too.
      const reported = new Set(items.map((item) => item.id));
      for (const entry of entries) if (!reported.has(entry.target.id)) items.push(reportItem(entry.target, 'cancelled'));
    } finally {
      state.clearStop();
      state.setStatus('ready');
    }

    return {
      operation, requested: requested.length, total, succeeded: ctx.succeeded, failures, unknown, items, cancelled: ctx.cancelled,
      stopped: ctx.stopped, durationMs: Date.now() - startedAt, concurrency
    };
  }

  /**
   * Whether the page list can say that a chat is no longer listed: rows must be on the page, and a
   * Load all that ended early or on a site that recycles rows means the list may be incomplete.
   */
  function listTrust() {
    if (!ABCM.dom.getAllConversations().length) return { trusted: false, basis: 'list-empty' };
    const listing = ABCM.state.listing;
    if (listing && listing.status !== 'complete') return { trusted: false, basis: `list-${listing.status}` };
    return { trusted: true, basis: 'page-list' };
  }

  /**
   * Looks at the page list again for chats whose result was not confirmed. It only reads: nothing is
   * sent to the site and the selection is not touched. Each answer is an observation:
   *   no-longer-listed  the trusted list does not show the chat (the site was not asked)
   *   still-listed      the list shows the chat
   *   not-confirmed     the list cannot be trusted, so nothing can be said
   */
  function recheck(items, { now = Date.now() } = {}) {
    const trust = listTrust();
    const at = new Date(now).toISOString();
    return (items || []).map((item) => {
      let result = 'not-confirmed';
      if (trust.trusted) {
        const live = findLiveAnchor(item.id);
        const listed = !!live && ABCM.dom.isVisible(live, { fast: true }) && !live.closest('[data-abcm-retired]');
        result = listed ? 'still-listed' : 'no-longer-listed';
      }
      return { id: item.id, result, at, basis: trust.basis };
    });
  }

  /** Counts the chats that were not confirmed by what Check again saw. A chat is in exactly one group. */
  function observedCounts(summary) {
    const counts = { 'no-longer-listed': 0, 'still-listed': 0, 'not-confirmed': 0 };
    for (const item of summary?.items || []) {
      if (item.status === 'unknown') counts[item.observation?.result || 'not-confirmed'] += 1;
    }
    return counts;
  }

  /** Records the latest observation on each unconfirmed item. Status and reason stay as the run left them. */
  function applyObservations(summary, observations) {
    const byId = new Map((observations || []).map((observation) => [observation.id, observation]));
    for (const item of summary?.items || []) {
      const observation = byId.get(item.id);
      if (!observation || item.status !== 'unknown') continue;
      item.observation = { result: observation.result, at: observation.at, basis: observation.basis, checks: (item.observation?.checks || 0) + 1 };
    }
    summary.observed = observedCounts(summary);
    return summary;
  }

  /** Puts archived chats back (ChatGPT only). Returns the ids that were restored and the ones that were not. */
  async function undoArchive(ids) {
    const api = ABCM.apiEngine;
    const restored = [];
    const failed = [];
    if (!api.canUndoArchive()) return { restored, failed: [...ids] };
    await api.prepare();
    for (const id of ids) {
      await ABCM.util.delay(ABCM.config.api.throttleMs);
      let outcome;
      try { outcome = await api.run('UNARCHIVE', id); } catch (_) { outcome = { ok: false }; }
      if (outcome?.ok) restored.push(id); else failed.push(id);
    }
    // Rows hidden after the archive come back if the site still has them; the page list refreshes on reload.
    for (const id of restored) {
      try {
        for (const anchor of ABCM.dom.getAllConversations()) {
          if (ABCM.dom.idFromElement(anchor) !== id) continue;
          (ABCM.dom.rowOf(anchor) || anchor).removeAttribute('data-abcm-retired');
        }
      } catch (_) { /* the row is gone; a reload shows it */ }
    }
    if (restored.length) ABCM.checkboxes.attachAll();
    return { restored, failed };
  }

  ABCM.define('bulk', { run, resolveLive, preflight, findLiveAnchor, classify, recheck, applyObservations, observedCounts, undoArchive });
})(globalThis);
