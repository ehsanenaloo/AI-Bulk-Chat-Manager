/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Keeps selection mode in step with the list while the site loads more chats as you scroll.

  A MutationObserver on the sidebar queues new rows and forgets removed ones; a debounced pass then
  adds checkboxes to the new rows only. The sidebar can also be replaced wholesale when the site
  re-renders, so a slow safety check re-finds the container and runs a full pass when a row on the
  page is not registered or a registered row left the page. Rows are compared by their stamp, not by
  count, so a re-render that swaps nodes without changing their number is still caught.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const DEBOUNCE_MS = 150;
  const HEALTH_CHECK_MS = 4000;

  const auto = {
    enabled: false,
    observer: null,
    root: null,
    timer: null,
    health: null,
    dirty: false
  };

  function schedule() {
    if (!auto.enabled) return;
    if (auto.timer) g.clearTimeout(auto.timer);
    auto.timer = g.setTimeout(() => { auto.timer = null; reconcile(); }, DEBOUNCE_MS);
  }

  function reconcile() {
    if (!auto.enabled || ABCM.state.status === 'running') return { skipped: true };
    auto.dirty = false;
    ABCM.state.prune();
    return ABCM.checkboxes.attachAll();
  }

  function observe(root) {
    if (auto.observer) auto.observer.disconnect();
    auto.root = root;
    auto.observer = new g.MutationObserver(() => { auto.dirty = true; schedule(); });
    auto.observer.observe(root, { childList: true, subtree: true });
  }

  /** A row on the page that carries no stamp was added or replaced since the last pass. */
  function hasUnregisteredRow() {
    return ABCM.dom.getAllConversations().some((row) => !row.hasAttribute('data-abcm-id') && !row.closest('[data-abcm-retired]'));
  }

  function healthCheck() {
    if (!auto.enabled || g.document.hidden) return;
    const root = ABCM.dom.getHistoryRoot();
    if (root && root !== auto.root) { observe(root); auto.dirty = true; }
    if (auto.dirty || hasUnregisteredRow() || ABCM.state.hasStaleRecord()) reconcile();
  }

  function enable() {
    if (auto.enabled) return { enabled: true };
    auto.enabled = true;
    const root = ABCM.dom.getHistoryRoot();
    if (root) observe(root);
    auto.health = g.setInterval(healthCheck, HEALTH_CHECK_MS);
    schedule();
    return { enabled: true };
  }

  function disable() {
    auto.enabled = false;
    if (auto.timer) g.clearTimeout(auto.timer);
    if (auto.health) g.clearInterval(auto.health);
    if (auto.observer) auto.observer.disconnect();
    auto.timer = auto.health = auto.observer = auto.root = null;
    return { enabled: false };
  }

  ABCM.define('autoAttach', { enable, disable, isEnabled: () => auto.enabled, reconcile });
})(globalThis);
