/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Registry and selection state for the chats on the page.

  A record is { id, anchor, checkbox, title, href, url }. The registry only ever holds records for
  rows that exist in the DOM; selection is a set of ids, so it survives a site re-rendering the row.
  Changes are announced to subscribers once per tick, however many records changed.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const records = new Map();
  const selected = new Set();
  const subscribers = new Set();

  const state = {
    /** 'idle' (no checkboxes), 'ready' (selecting) or 'running' (a bulk action is in progress). */
    status: 'idle',
    stopRequested: false,
    shiftPressed: false,
    lastChecked: null,
    diagnostics: { failures: {}, apiFallbacks: 0, anchorRebinds: 0, retries: 0, runs: 0 },

    // ── change notification ────────────────────────────────────────────────────────────────
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    _pending: false,
    emit() {
      if (state._pending) return;
      state._pending = true;
      Promise.resolve().then(() => {
        state._pending = false;
        subscribers.forEach((listener) => { try { listener(state); } catch (error) { ABCM.warn('state listener failed', error); } });
      });
    },

    // ── registry ───────────────────────────────────────────────────────────────────────────
    get(id) { return records.get(String(id || '')) || null; },

    /** Adds or updates a record. Returns it, or null when no id can be determined. */
    register(meta) {
      const id = String(meta?.id || ABCM.dom.idFromElement(meta?.anchor) || '').trim();
      if (!id) return null;
      let record = records.get(id);
      if (!record) {
        record = { id, anchor: null, checkbox: null, title: '', href: '', url: '' };
        records.set(id, record);
      }
      if (meta.anchor) record.anchor = meta.anchor;
      if (meta.checkbox) record.checkbox = meta.checkbox;
      if (record.anchor) {
        record.anchor.dataset.abcmId = id;
        record.href = record.anchor.getAttribute('href') || record.href;
        record.url = ABCM.dom.urlOf(record.anchor);
        if (!record.title || meta.refreshTitle) record.title = ABCM.dom.titleOf(record.anchor) || record.title;
      }
      if (record.checkbox) { record.checkbox.checked = selected.has(id); ABCM.checkboxes?.paint(record.checkbox); }
      state.emit();
      return record;
    },

    unregister(id) {
      const key = String(id || '');
      const record = records.get(key);
      if (record?.anchor) record.anchor.removeAttribute('data-abcm-id');
      selected.delete(key);
      records.delete(key);
      if (state.lastChecked === key) state.lastChecked = null;
      state.emit();
    },

    /** Forgets everything (used when selection mode ends). */
    reset() {
      records.forEach((record) => record.anchor?.removeAttribute?.('data-abcm-id'));
      records.clear();
      selected.clear();
      state.lastChecked = null;
      state.emit();
    },

    /**
     * Reconciles the registry with the page. A record whose row node went stale is rebound when the
     * site re-rendered the same chat (selection survives); it is dropped only when the chat is gone.
     */
    prune() {
      for (const [id, record] of Array.from(records)) {
        if (record.anchor?.isConnected) continue;
        const live = ABCM.bulk?.findLiveAnchor?.(id);
        if (live) ABCM.checkboxes.attach(live);
        else state.unregister(id);
      }
    },

    isLive: (record) => !!record?.anchor?.isConnected,

    /** Live records in the order they appear on the page. */
    ordered() {
      const live = Array.from(records.values()).filter(state.isLive);
      if (live.length < 2) return live;
      const rank = new Map();
      let cursor = 0;
      g.document.querySelectorAll('[data-abcm-id]').forEach((el) => rank.set(el, cursor++));
      const at = (record) => (rank.has(record.anchor) ? rank.get(record.anchor) : Number.MAX_SAFE_INTEGER);
      return live.sort((a, b) => at(a) - at(b));
    },

    /** Records the user can currently see (collapsed or filtered-out rows are excluded). */
    visible() {
      return state.ordered().filter((record) => ABCM.dom.isVisible(record.anchor));
    },

    // ── selection ──────────────────────────────────────────────────────────────────────────
    isSelected: (id) => selected.has(String(id)),
    selectedCount: () => selected.size,

    setSelected(id, on) {
      const key = String(id || '');
      if (!key) return false;
      if (on) selected.add(key); else selected.delete(key);
      const record = records.get(key);
      if (record?.checkbox && record.checkbox.checked !== !!on) { record.checkbox.checked = !!on; ABCM.checkboxes?.paint(record.checkbox); }
      if (record?.anchor) {
        const row = ABCM.dom.rowOf(record.anchor) || record.anchor;
        if (on) row.setAttribute('data-abcm-selected', '1'); else row.removeAttribute('data-abcm-selected');
      }
      state.emit();
      return !!on;
    },

    toggle(id) {
      return state.setSelected(id, !selected.has(String(id)));
    },

    selectedRecords() {
      state.prune();
      return state.ordered().filter((record) => selected.has(record.id));
    },

    selectedItems() {
      const site = ABCM.sites.current();
      return state.selectedRecords().map((record) => ({ id: record.id, title: record.title, url: record.url, site: site?.id || '' }));
    },

    selectVisible() {
      const list = state.visible();
      list.forEach((record) => state.setSelected(record.id, true));
      return list.length;
    },

    clearSelection() {
      const count = selected.size;
      Array.from(selected).forEach((id) => state.setSelected(id, false));
      return count;
    },

    invertVisible() {
      const list = state.visible();
      list.forEach((record) => state.setSelected(record.id, !selected.has(record.id)));
      return list.length;
    },

    /** Selects or clears every visible chat whose title or link contains `query`. Returns the number matched. */
    applyFilter(query, mode) {
      const needle = String(query || '').trim().toLowerCase();
      if (!needle) return 0;
      let matched = 0;
      state.visible().forEach((record) => {
        if (!`${record.title} ${record.href}`.toLowerCase().includes(needle)) return;
        state.setSelected(record.id, mode === 'select');
        matched += 1;
      });
      return matched;
    },

    /** Selects or clears the last `limit` visible chats (the oldest ones, as the list is newest-first). */
    applyOldest(limit, mode) {
      const n = Math.max(1, Math.min(500, Math.round(Number(limit)) || 10));
      const target = state.visible().slice(-n);
      target.forEach((record) => state.setSelected(record.id, mode === 'select'));
      return target.length;
    },

    /** Selects the visible chats between two ids, inclusive (Shift-click). */
    selectRange(fromId, toId) {
      const ids = state.visible().map((record) => record.id);
      const a = ids.indexOf(String(fromId));
      const b = ids.indexOf(String(toId));
      if (a === -1 || b === -1) return 0;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      for (let i = lo; i <= hi; i += 1) state.setSelected(ids[i], true);
      return hi - lo + 1;
    },

    // ── run control ────────────────────────────────────────────────────────────────────────
    setStatus(next) { state.status = next; state.emit(); },
    requestStop() { state.stopRequested = true; state.emit(); },
    clearStop() { state.stopRequested = false; },

    countFailure(reason) {
      const key = String(reason || 'unknown');
      state.diagnostics.failures[key] = (state.diagnostics.failures[key] || 0) + 1;
    },

    snapshot() {
      return {
        status: state.status,
        records: records.size,
        visible: state.visible().length,
        selected: selected.size
      };
    }
  };

  ABCM.define('state', state);
})(globalThis);
