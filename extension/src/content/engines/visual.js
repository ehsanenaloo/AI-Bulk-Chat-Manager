/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Visual engine: deletes or archives one chat by driving the site's own interface (hover the row,
  open its "..." menu, pick Delete/Archive, confirm), exactly as a person would.

  This is the safety net behind the API engine and the only route on sites without a usable
  backend. It must never act on the wrong item, so it matches menu items and buttons by label
  (in many interface languages), refuses candidates that do not match anything, and for deletes
  checks that the row really went away before it reports success.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const cfg = () => ABCM.config;
  const util = () => ABCM.util;
  const norm = (value) => util().normalize(value);

  const labelsFor = (operation) => cfg().labels[operation === 'DELETE' ? 'delete' : 'archive'].map(norm);
  const isVisible = (el, fast = false) => ABCM.dom.isVisible(el, { fast });

  /**
   * How well an element's text, aria-label and test id match the operation's words.
   * 0 means no match. Exact matches outrank partial ones so "Delete" beats "Delete forever from project".
   */
  function labelScore(el, operation) {
    const text = norm(`${el.textContent || ''} ${el.getAttribute?.('aria-label') || ''} ${el.getAttribute?.('data-testid') || ''}`);
    if (!text) return 0;
    let best = 0;
    for (const label of labelsFor(operation)) {
      if (!label) continue;
      // Short Latin labels (for example Turkish "sil") must match as a whole word, or they hit unrelated text.
      const wholeWordOnly = label.length < 4 && /^[ -~]+$/.test(label);
      if (text === label) best = Math.max(best, 3);
      else if (wholeWordOnly) { if (text.split(' ').includes(label)) best = Math.max(best, 1); }
      else if (text.startsWith(label)) best = Math.max(best, 2);
      else if (text.includes(label)) best = Math.max(best, 1);
    }
    return best;
  }

  // ── the row's "..." button ───────────────────────────────────────────────────────────────
  function sidebarScope(record) {
    return record?.anchor?.closest('nav, aside, [data-testid="history"], [id^="history"]') || ABCM.dom.getHistoryRoot() || g.document;
  }

  /**
   * Where this chat's own controls can be. Only the chat link and its row are ever searched, never
   * the whole sidebar: a "..." button found elsewhere would belong to a different chat.
   */
  function localScopes(record) {
    const scopes = [];
    const push = (scope) => { if (scope && !scopes.includes(scope)) scopes.push(scope); };
    push(record?.anchor);
    push(ABCM.dom.rowOf(record?.anchor));
    return scopes;
  }

  function scoreMenuButton(candidate, record) {
    if (!candidate?.isConnected || !isVisible(candidate, true)) return -1;
    if (candidate.disabled || candidate.getAttribute?.('aria-disabled') === 'true') return -1;
    if (candidate.hasAttribute?.('data-abcm-checkbox')) return -1;
    let score = 0;
    if (candidate.matches?.('button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"]')) score += 10;
    const hint = `${candidate.getAttribute?.('aria-label') || ''} ${candidate.textContent || ''}`.toLowerCase();
    if (hint.includes('more') || hint.includes('option') || hint.includes('menu')) score += 5;
    if (record?.anchor?.contains?.(candidate)) score += 3;
    const rect = candidate.getBoundingClientRect?.();
    if (rect && rect.width > 0 && rect.height > 0 && rect.width < 100 && rect.height < 100) score += 2;
    return score;
  }

  function resolveMenuButton(record, strategy) {
    for (const scope of localScopes(record)) {
      if (!scope?.querySelectorAll) continue;
      const best = Array.from(scope.querySelectorAll(cfg().selectors.menuButton))
        .map((candidate) => ({ candidate, score: scoreMenuButton(candidate, record) }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => b.score - a.score)[0]?.candidate;
      if (best?.isConnected && isVisible(best, true)) return best;
    }
    return null;
  }

  // ── menus and dialogs ────────────────────────────────────────────────────────────────────
  function findVisibleMenus(scope, strategy) {
    const collect = (root) => (root?.querySelectorAll ? Array.from(root.querySelectorAll(cfg().selectors.menu)).filter((menu) => isVisible(menu)) : []);
    const primary = collect(scope || g.document);
    if (primary.length) return primary;
    if (strategy !== 'primary' || (scope && scope !== g.document)) {
      const global = collect(g.document);
      if (global.length) return global;
    }
    return primary;
  }

  function waitForMenu(scope, timeout, strategy) {
    return util().waitForCondition(() => {
      const menus = findVisibleMenus(scope, strategy);
      return menus[menus.length - 1] || null;
    }, { root: g.document, timeout, pollMs: strategy === 'aggressive' ? 100 : 160 });
  }

  /** Dispatches the full pointer/mouse/click sequence frameworks listen for. */
  async function activate(element, { aggressive = false } = {}) {
    if (!element?.isConnected) return false;
    try { element.focus?.({ preventScroll: true }); } catch (_) { /* not focusable */ }
    const fire = (Ctor, type, extra = {}) => {
      try { element.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: g.window, ...extra })); } catch (_) { /* detached */ }
    };
    fire(MouseEvent, 'mouseover');
    fire(MouseEvent, 'mouseenter');
    fire(PointerEvent, 'pointerdown', { pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 });
    fire(MouseEvent, 'mousedown', { button: 0, buttons: 1 });
    fire(PointerEvent, 'pointerup', { pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0 });
    fire(MouseEvent, 'mouseup', { button: 0, buttons: 0 });
    try { element.click?.(); } catch (_) { /* detached */ }
    if (aggressive) {
      fire(KeyboardEvent, 'keydown', { key: 'Enter', code: 'Enter' });
      fire(KeyboardEvent, 'keyup', { key: 'Enter', code: 'Enter' });
    }
    return true;
  }

  function findMenuItem(operation, menu) {
    if (!menu?.querySelectorAll) return null;
    const matches = Array.from(menu.querySelectorAll(cfg().selectors.menuItem))
      .filter((item) => item.isConnected && isVisible(item, true) && item.getAttribute?.('aria-disabled') !== 'true')
      .map((item) => ({ item, score: labelScore(item, operation) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    if (matches.length) return matches[0].item;
    for (const selector of cfg().selectors.itemFallbacks[operation === 'DELETE' ? 'delete' : 'archive']) {
      const el = menu.querySelector(selector);
      if (el?.isConnected && isVisible(el, true)) return el;
    }
    return null;
  }

  function resolveMenuItem(operation, menu, strategy, timeout) {
    return util().waitForCondition(() => findMenuItem(operation, menu), {
      root: menu || g.document, timeout: timeout || cfg().timeouts.elementWaitShort, pollMs: strategy === 'aggressive' ? 90 : 140
    });
  }

  /** A confirm button must match the operation's words; "Cancel" and unknown buttons are never candidates. */
  function scoreConfirm(candidate, operation) {
    if (!candidate?.isConnected || !isVisible(candidate, true)) return 0;
    if (candidate.disabled || candidate.getAttribute?.('aria-disabled') === 'true') return 0;
    const base = labelScore(candidate, operation);
    if (!base) return 0;
    let score = base * 10;
    if (candidate.matches?.('button[type="submit"]')) score += 4;
    if (/danger|destructive|error|red/i.test(String(candidate.className || ''))) score += 6;
    return score;
  }

  function findConfirmButton(operation, timeout, strategy) {
    return util().waitForCondition(() => {
      const dialogs = Array.from(g.document.querySelectorAll(cfg().selectors.dialog)).filter((el) => isVisible(el));
      const dialog = dialogs[dialogs.length - 1];
      if (!dialog) return null;
      const best = Array.from(dialog.querySelectorAll(cfg().selectors.confirmButton))
        .map((candidate) => ({ candidate, score: scoreConfirm(candidate, operation) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)[0];
      return best ? { dialog, button: best.candidate } : null;
    }, { root: g.document, timeout: timeout || cfg().timeouts.elementWaitShort, pollMs: strategy === 'aggressive' ? 90 : 140 });
  }

  /** Waits until the row left the list or was hidden by the site. */
  async function waitForRowGone(anchor, timeout) {
    const gone = await util().waitForCondition(() => (!anchor.isConnected || !isVisible(anchor, true) ? true : null), { timeout, pollMs: 120 });
    return !!gone;
  }

  /**
   * Sites such as Grok reveal a per-row action button (aria-label "Delete chat") on hover instead of
   * a "..." menu. Tried first on non-ChatGPT sites; any non-success falls through to the menu route.
   */
  async function tryDirectRowAction(operation, record, strategy = 'primary') {
    const anchor = record?.anchor;
    if (!anchor?.isConnected) return { ok: false, reason: 'stale-target' };
    // The row scope must never widen to the whole list, or another chat's button could be clicked.
    const row = ABCM.dom.rowOf(anchor);
    ABCM.dom.dispatchHover(row);
    ABCM.dom.dispatchHover(anchor);
    await util().delay(strategy === 'aggressive' ? 140 : cfg().delays.short);
    const wanted = operation === 'DELETE' ? 'delete' : 'archive';
    const button = await util().waitForCondition(() => Array.from(row.querySelectorAll('button[aria-label], [role="button"][aria-label]'))
      .find((el) => (el.getAttribute('aria-label') || '').toLowerCase().includes(wanted) && isVisible(el, true)) || null,
    { root: row, timeout: strategy === 'aggressive' ? 700 : 450, pollMs: 90 });
    if (!button) return { ok: false, reason: 'direct-action-not-available' };
    await activate(button, { aggressive: strategy !== 'primary' });
    await util().delay(cfg().delays.medium);
    const confirm = await confirmAction(operation, strategy, record);
    if (!confirm?.ok) return { ok: false, reason: confirm?.reason || 'confirm-not-found' };
    return { ok: true, via: 'direct-row-action' };
  }

  async function openMenu(record, strategy = 'primary') {
    const anchor = record?.anchor;
    if (!anchor?.isConnected || !isVisible(anchor, true)) return { ok: false, reason: 'stale-target' };
    ABCM.dom.dispatchHover(anchor);
    await util().delay(strategy === 'aggressive' ? 70 : cfg().delays.short);
    const button = resolveMenuButton(record, strategy);
    if (!button) return { ok: false, reason: 'menu-button-not-found' };
    await activate(button, { aggressive: strategy !== 'primary' });
    await util().delay(strategy === 'aggressive' ? cfg().delays.long : cfg().delays.medium);
    const menu = await waitForMenu(sidebarScope(record), cfg().timeouts.elementWaitShort, strategy);
    if (!menu) return { ok: false, reason: 'menu-not-opened' };
    return { ok: true, menu, menuButton: button };
  }

  async function triggerOperation(operation, menu, strategy, preResolved = null) {
    const item = preResolved || await resolveMenuItem(operation, menu, strategy);
    if (!item || !item.isConnected || !menu?.contains?.(item) || !isVisible(item, true)) return { ok: false, reason: 'operation-item-not-found' };
    await activate(item, { aggressive: strategy !== 'primary' });
    return { ok: true, item };
  }

  /**
   * Confirms the action. Archive has no dialog, so success means the row left the list. Delete
   * clicks the dialog's matching button, waits for the dialog to close and then for the row to go.
   */
  async function confirmAction(operation, strategy = 'primary', record = null) {
    const anchor = record?.anchor;
    if (operation !== 'DELETE') {
      if (anchor?.isConnected) {
        if (await waitForRowGone(anchor, cfg().timeouts.elementWaitShort)) return { ok: true, verified: true };
        ABCM.state.diagnostics.unverifiedArchives = (ABCM.state.diagnostics.unverifiedArchives || 0) + 1;
        return { ok: true, verified: false };
      }
      await util().delay(cfg().delays.extended);
      return { ok: true };
    }

    const found = await findConfirmButton(operation, cfg().timeouts.elementWaitShort, strategy);
    if (!found?.button) return { ok: false, reason: 'confirm-not-found' };
    await activate(found.button, { aggressive: strategy !== 'primary' });
    await util().delay(cfg().delays.medium);
    let closed = await util().waitForGone(cfg().selectors.dialog, cfg().timeouts.elementWaitShort);
    if (!closed) {
      // One aggressive retry against whatever confirm button is present now.
      const retry = await findConfirmButton(operation, 320, 'aggressive');
      if (retry?.button) {
        await activate(retry.button, { aggressive: true });
        await util().delay(cfg().delays.medium);
        closed = await util().waitForGone(cfg().selectors.dialog, cfg().timeouts.elementWaitShort);
      }
    }
    if (!closed) return { ok: false, reason: 'confirm-not-completed' };
    // A closed dialog is not proof of deletion (it may have been cancelled): the row must be gone too.
    if (anchor && !(await waitForRowGone(anchor, 3000))) return { ok: false, reason: 'delete-unconfirmed' };
    return { ok: true };
  }

  /** Gemini has no usable REST endpoint, so the chat is deleted through the row's Material menu. */
  async function geminiDelete(operation, record) {
    if (operation !== 'DELETE') return { ok: false, reason: 'archive-unsupported' };
    const anchor = record?.anchor;
    if (!anchor?.isConnected) return { ok: false, reason: 'conversation-detached' };
    const fire = (el, types) => types.forEach((type) => {
      try {
        const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: g.window, pointerType: 'mouse' }));
      } catch (_) { /* detached */ }
    });
    const visible = (el) => {
      if (!el || !el.isConnected) return false;
      const rect = el.getBoundingClientRect();
      const style = g.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };

    const row = ABCM.dom.rowOf(anchor);
    try { row.scrollIntoView({ block: 'center' }); } catch (_) { /* not scrollable */ }
    fire(row, ['mouseover', 'mouseenter', 'mousemove', 'pointerover']);
    fire(anchor, ['mouseover', 'mouseenter', 'mousemove', 'pointerover']);
    await util().delay(160);

    const buttonSelector = 'button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"], button[aria-label*="more" i], button[aria-label*="option" i], button[aria-label*="menu" i], button.mat-mdc-icon-button, button.mat-icon-button, button[mat-icon-button]';
    let menuButton = Array.from(row.querySelectorAll(buttonSelector)).find((el) => !el.hasAttribute('data-abcm-checkbox')) || null;
    if (!menuButton) {
      const buttons = Array.from(row.querySelectorAll('button')).filter(visible);
      menuButton = buttons[buttons.length - 1] || null; // the actions button is usually the last one
    }
    if (!menuButton) return { ok: false, reason: 'menu-button-not-found' };
    menuButton.focus?.();
    fire(menuButton, ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click']);

    const menu = await util().waitForCondition(() => {
      const menus = Array.from(g.document.querySelectorAll('[role="menu"], .mat-mdc-menu-panel, .cdk-overlay-pane')).filter(visible);
      return menus[menus.length - 1] || null;
    }, { timeout: 1600, pollMs: 70 });
    if (!menu) return { ok: false, reason: 'menu-not-opened' };

    const item = await util().waitForCondition(() => Array.from(menu.querySelectorAll('[role="menuitem"], button[mat-menu-item], .mat-mdc-menu-item, button, [role="button"]'))
      .map((el) => ({ el, score: visible(el) ? labelScore(el, 'DELETE') : 0 }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.el || null, { timeout: 1400, pollMs: 70 });
    if (!item) return { ok: false, reason: 'operation-item-not-found' };
    fire(item, ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click']);

    // The confirmation dialog is a Material dialog: click its Delete button, never Cancel.
    const confirm = await util().waitForCondition(() => {
      const dialog = Array.from(g.document.querySelectorAll('[role="dialog"], [role="alertdialog"], mat-dialog-container, .cdk-dialog-container, .mat-mdc-dialog-container')).filter(visible).pop();
      if (!dialog) return null;
      return Array.from(dialog.querySelectorAll('button, [role="button"]'))
        .map((el) => ({ el, score: visible(el) ? labelScore(el, 'DELETE') : 0 }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.el || null;
    }, { timeout: 1800, pollMs: 70 });
    if (confirm) {
      confirm.focus?.();
      fire(confirm, ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click']);
    }

    const gone = await waitForRowGone(anchor, 2200);
    if (gone) return { ok: true, verified: true, via: 'dom' };
    return { ok: false, reason: confirm ? 'delete-unconfirmed' : 'confirm-not-found' };
  }

  /** One complete attempt at an operation through the page UI using the given strategy. */
  async function attempt(operation, record, strategy = 'primary') {
    const site = ABCM.sites.current();
    if (site && site.id !== 'chatgpt') {
      const direct = await tryDirectRowAction(operation, record, strategy);
      if (direct?.ok) return { ok: true };
    }
    const opened = await openMenu(record, strategy);
    if (!opened.ok) return opened;
    const item = await resolveMenuItem(operation, opened.menu, strategy);
    if (!item) return { ok: false, reason: 'operation-item-not-found' };
    const triggered = await triggerOperation(operation, opened.menu, strategy, item);
    if (!triggered.ok) return triggered;
    const confirmed = await confirmAction(operation, strategy, record);
    if (!confirmed.ok) return confirmed;
    return { ok: true };
  }

  ABCM.define('visualEngine', {
    labelScore, resolveMenuButton, findMenuItem, resolveMenuItem, findConfirmButton, confirmAction,
    tryDirectRowAction, openMenu, triggerOperation, geminiDelete, attempt, activate
  });
})(globalThis);
