/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
(function() {
  'use strict';

  function ensureState() {
    if (!window.__CHATGPT_BULK_AUTO_ATTACH__) {
      window.__CHATGPT_BULK_AUTO_ATTACH__ = {
        enabled: false,
        running: false,
        timer: null,
        scrollHandler: null,
        mutationObserver: null,
        lastPatchedCount: 0,
      };
    }
    return window.__CHATGPT_BULK_AUTO_ATTACH__;
  }

  function getSidebarRoots() {
    const roots = new Set();
    const history = document.querySelector('[id^="history"]');
    const nav = document.querySelector('nav');
    if (history) roots.add(history);
    if (nav) roots.add(nav);

    document.querySelectorAll('a[href^="/c/"]').forEach((a) => {
      const scrollable = findScrollableAncestor(a);
      if (scrollable) roots.add(scrollable);
      const navLike = a.closest('nav, [id^="history"], aside');
      if (navLike) roots.add(navLike);
    });

    return Array.from(roots).filter(Boolean);
  }

  function findScrollableAncestor(el) {
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      try {
        const style = getComputedStyle(cur);
        const overflowY = style.overflowY;
        const scrollable = /(auto|scroll|overlay)/.test(overflowY) && cur.scrollHeight > cur.clientHeight + 10;
        if (scrollable) return cur;
      } catch (_) {}
      cur = cur.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function shouldHandleScrollTarget(target) {
    if (!target || !(target instanceof Element || target === document || target === window)) return false;
    const roots = getSidebarRoots();
    if (!roots.length) return true;

    for (const root of roots) {
      if (target === root) return true;
      if (target instanceof Element && (root.contains(target) || target.contains(root))) return true;
    }
    return false;
  }

  function attachVisibleCheckboxes() {
    const state = ensureState();
    if (state.running) return { success: true, skipped: true };
    state.running = true;

    try {
      const core = window.ChatGPTBulkDelete;
      if (!core || !core.initialized) return { success: false, reason: 'Core system not ready' };

      const CheckboxManager = core.getModule('CheckboxManager');
      const DOMHandler = core.getModule('DOMHandler');
      const EventHandler = core.getModule('EventHandler');
      if (!CheckboxManager || !DOMHandler) return { success: false, reason: 'Required modules missing' };

      let conversations;
      try {
        conversations = Array.from(DOMHandler.getAllConversations());
      } catch (_) {
        conversations = Array.from(document.querySelectorAll('a[href^="/c/"]'));
      }

      const unique = [];
      const seen = new Set();
      conversations.forEach((conversation) => {
        const href = conversation.getAttribute('href') || conversation.href || '';
        if (!href || seen.has(href)) return;
        seen.add(href);
        unique.push(conversation);
      });

      let added = 0;
      unique.forEach((conversation, index) => {
        if (!conversation || conversation.querySelector?.(`.${CSS_CLASSES.CHECKBOX}`)) return;
        try {
          CheckboxManager.addCheckboxToConversation(conversation, index);
          CheckboxManager.setupConversationInteraction(conversation);
          added++;
        } catch (error) {
          console.error('[ChatGPTBulkDelete] Auto-attach failed:', error);
        }
      });

      if (EventHandler && EventHandler.addKeyboardListeners && !window.__CHATGPT_BULK_KEYBOARD_LISTENERS__) {
        try {
          EventHandler.addKeyboardListeners();
          window.__CHATGPT_BULK_KEYBOARD_LISTENERS__ = true;
        } catch (error) {
          console.error('[ChatGPTBulkDelete] Keyboard listener error:', error);
        }
      }

      state.lastPatchedCount = unique.length;
      if (added > 0) console.log(`[ChatGPTBulkDelete] Auto-attached ${added} new checkbox(es)`);
      return { success: true, added, total: unique.length };
    } finally {
      state.running = false;
    }
  }

  function scheduleAttach() {
    const state = ensureState();
    if (!state.enabled) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      attachVisibleCheckboxes();
    }, 280);
  }

  function enable() {
    const state = ensureState();
    if (state.enabled) {
      scheduleAttach();
      return { enabled: true, alreadyEnabled: true };
    }

    state.enabled = true;
    state.scrollHandler = (event) => {
      const target = event?.target || document;
      if (shouldHandleScrollTarget(target)) scheduleAttach();
    };

    document.addEventListener('scroll', state.scrollHandler, true);

    const history = document.querySelector('[id^="history"]') || document.querySelector('nav');
    if (history) {
      state.mutationObserver = new MutationObserver(() => scheduleAttach());
      state.mutationObserver.observe(history, { childList: true, subtree: true });
    }

    scheduleAttach();
    console.log('[ChatGPTBulkDelete] Auto attach on scroll enabled');
    return { enabled: true };
  }

  function disable() {
    const state = ensureState();
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.scrollHandler) {
      document.removeEventListener('scroll', state.scrollHandler, true);
    }
    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
      state.mutationObserver = null;
    }
    state.enabled = false;
    state.scrollHandler = null;
    console.log('[ChatGPTBulkDelete] Auto attach on scroll disabled');
    return { enabled: false };
  }

  const state = ensureState();
  const result = state.enabled ? disable() : enable();
  window.__CHATGPT_BULK_AUTO_ATTACH_STATE__ = result;
})();
