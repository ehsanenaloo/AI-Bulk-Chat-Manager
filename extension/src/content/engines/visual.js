/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Visual engine: deletes or archives one chat by driving the site's own interface (hover the row,
  open its "..." menu, pick Delete/Archive, confirm), exactly as a person would.

  This is the safety net behind the API engine and the only route on sites without a usable
  backend. It must never act on the wrong item, so it matches menu items and buttons by label
  (in many interface languages), refuses candidates that do not match anything, and for deletes
  checks that the row really went away before it reports success.

  Menus and dialogs live in page-wide overlays, so the engine never takes "the last one on the page".
  It notes what is open before it clicks, accepts only an overlay that appeared because of its own
  click (or the one the trigger's aria-controls names), and refuses to act when that is not exactly one.
  An outcome it cannot confirm is returned as { ok: false, unknown: true }, never as success.
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

  const ROW_GONE_STABLE_MS = 400; // the row must stay gone this long before a deletion counts

  const visibleAll = (selector) => Array.from(g.document.querySelectorAll(selector)).filter((el) => isVisible(el));
  /** Drops overlays that contain another candidate (a wrapper pane around the real menu or dialog). */
  const innermost = (list) => list.filter((el) => !list.some((other) => other !== el && el.contains(other)));
  const snapshotMenus = () => new Set(visibleAll(cfg().selectors.menu));
  const snapshotDialogs = () => new Set(visibleAll(cfg().selectors.dialog));

  /**
   * The overlay this action opened: the one the trigger's aria-controls names, else the only one that
   * was not open before the click. Anything else (none, or several) returns null so nothing is clicked.
   */
  function pickOverlay(candidates, before, trigger) {
    const controls = trigger?.getAttribute?.('aria-controls');
    if (controls) {
      const bound = candidates.filter((el) => el.id === controls);
      if (bound.length === 1) return bound[0];
    }
    const fresh = before ? candidates.filter((el) => !before.has(el)) : candidates;
    return fresh.length === 1 ? fresh[0] : null;
  }

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

  function waitForMenu(scope, timeout, strategy, { before = null, trigger = null } = {}) {
    return util().waitForCondition(
      () => pickOverlay(innermost(findVisibleMenus(scope, strategy)), before, trigger),
      { root: g.document, timeout, pollMs: strategy === 'aggressive' ? 100 : 160 }
    );
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

  function findConfirmButton(operation, timeout, strategy, before = null) {
    return util().waitForCondition(() => {
      const open = innermost(visibleAll(cfg().selectors.dialog));
      const fresh = before ? open.filter((dialog) => !before.has(dialog)) : open;
      const matches = fresh.map((dialog) => ({
        dialog,
        best: Array.from(dialog.querySelectorAll(cfg().selectors.confirmButton))
          .map((candidate) => ({ candidate, score: scoreConfirm(candidate, operation) }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score)[0]
      })).filter((entry) => entry.best);
      // More than one dialog offering the action: it is not clear which one is ours.
      return matches.length === 1 ? { dialog: matches[0].dialog, button: matches[0].best.candidate } : null;
    }, { root: g.document, timeout: timeout || cfg().timeouts.elementWaitShort, pollMs: strategy === 'aggressive' ? 90 : 140 });
  }

  /** Whether the chat is still listed: its own row, or a re-rendered row carrying the same id. */
  function rowStillListed(record) {
    const anchor = record?.anchor;
    if (anchor?.isConnected && isVisible(anchor, true)) return true;
    const live = record?.id ? ABCM.bulk?.findLiveAnchor?.(record.id) : null;
    return !!(live && live !== anchor && live.isConnected && isVisible(live, true));
  }

  const rowGoneNow = (record) => !!record && !rowStillListed(record);

  /**
   * Waits until the chat has been absent for a short, unbroken stretch. A node swapped by the site's
   * re-render, or hidden for a moment, is not a deletion: the chat's id must be absent as well.
   */
  async function waitForRowGone(record, timeout) {
    let goneSince = 0;
    const gone = await util().waitForCondition(() => {
      if (rowStillListed(record)) { goneSince = 0; return null; }
      goneSince = goneSince || Date.now();
      return Date.now() - goneSince >= ROW_GONE_STABLE_MS ? true : null;
    }, { timeout, pollMs: 60 });
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
    const dialogsBefore = snapshotDialogs();
    await activate(button, { aggressive: strategy !== 'primary' });
    await util().delay(cfg().delays.medium);
    const confirm = await confirmAction(operation, strategy, record, dialogsBefore);
    if (!confirm?.ok) return { ok: false, unknown: !!confirm?.unknown, reason: confirm?.reason || 'confirm-not-found' };
    return { ok: true, via: 'direct-row-action' };
  }

  async function openMenu(record, strategy = 'primary') {
    const anchor = record?.anchor;
    if (!anchor?.isConnected || !isVisible(anchor, true)) return { ok: false, reason: 'stale-target' };
    ABCM.dom.dispatchHover(anchor);
    await util().delay(strategy === 'aggressive' ? 70 : cfg().delays.short);
    const button = resolveMenuButton(record, strategy);
    if (!button) return { ok: false, reason: 'menu-button-not-found' };
    const before = snapshotMenus();
    await activate(button, { aggressive: strategy !== 'primary' });
    await util().delay(strategy === 'aggressive' ? cfg().delays.long : cfg().delays.medium);
    const menu = await waitForMenu(sidebarScope(record), cfg().timeouts.elementWaitShort, strategy, { before, trigger: button });
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
  async function confirmAction(operation, strategy = 'primary', record = null, dialogsBefore = null) {
    if (operation !== 'DELETE') {
      // Without a row to watch there is nothing to confirm against.
      if (record && await waitForRowGone(record, cfg().timeouts.rowGone)) return { ok: true, verified: true };
      ABCM.state.diagnostics.unverifiedArchives = (ABCM.state.diagnostics.unverifiedArchives || 0) + 1;
      return { ok: false, unknown: true, reason: 'archive-unverified' };
    }

    const found = await findConfirmButton(operation, cfg().timeouts.elementWaitShort, strategy, dialogsBefore);
    if (!found?.button) return { ok: false, reason: 'confirm-not-found' };
    await activate(found.button, { aggressive: strategy !== 'primary' });
    await util().delay(cfg().delays.medium);
    // Only the dialog that was clicked counts: an unrelated dialog staying open says nothing about ours.
    const dialog = found.dialog;
    const dialogClosed = () => util().waitForCondition(() => (!dialog.isConnected || !isVisible(dialog, true) ? true : null), { timeout: cfg().timeouts.elementWaitShort, pollMs: 80 });
    let closed = await dialogClosed();
    if (!closed) {
      // The same dialog is still open with the same enabled button: the click most likely did not register.
      const retry = await findConfirmButton(operation, 320, 'aggressive', dialogsBefore);
      if (retry?.dialog === dialog && retry.button === found.button && !rowGoneNow(record)) {
        await activate(retry.button, { aggressive: true });
        await util().delay(cfg().delays.medium);
        closed = await dialogClosed();
      }
    }
    // The confirm button was clicked, so the site may have started the change: unknown, not a clean failure.
    if (!closed) return { ok: false, unknown: true, reason: 'confirm-not-completed' };
    // A closed dialog is not proof of deletion (it may have been cancelled): the row must be gone too.
    // The confirm was clicked, so the site may still be working: the outcome is unknown, not a clean failure.
    if (record && !(await waitForRowGone(record, cfg().timeouts.rowGone))) return { ok: false, unknown: true, reason: 'delete-unconfirmed' };
    return { ok: true, verified: true };
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
    const menusBefore = new Set(Array.from(g.document.querySelectorAll('[role="menu"], .mat-mdc-menu-panel, .cdk-overlay-pane')).filter(visible));
    const dialogsBefore = new Set(Array.from(g.document.querySelectorAll('[role="dialog"], [role="alertdialog"], mat-dialog-container, .cdk-dialog-container, .mat-mdc-dialog-container')).filter(visible));
    fire(menuButton, ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click']);

    // Only the menu this click opened, and only when exactly one new menu offers Delete.
    const MENUS = '[role="menu"], .mat-mdc-menu-panel, .cdk-overlay-pane';
    const DIALOGS = '[role="dialog"], [role="alertdialog"], mat-dialog-container, .cdk-dialog-container, .mat-mdc-dialog-container';
    const bestOf = (root, selector) => Array.from(root.querySelectorAll(selector))
      .map((el) => ({ el, score: visible(el) ? labelScore(el, 'DELETE') : 0 }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.el || null;
    const fresh = (selector, before) => innermost(Array.from(g.document.querySelectorAll(selector)).filter((el) => visible(el) && !before.has(el)));

    const hit = await util().waitForCondition(() => {
      const hits = fresh(MENUS, menusBefore).map((menu) => ({ menu, item: bestOf(menu, '[role="menuitem"], button[mat-menu-item], .mat-mdc-menu-item, button, [role="button"]') })).filter((entry) => entry.item);
      return hits.length === 1 ? hits[0] : null;
    }, { timeout: 3000, pollMs: 70 });
    if (!hit) return { ok: false, reason: fresh(MENUS, menusBefore).length ? 'operation-item-not-found' : 'menu-not-opened' };
    fire(hit.item, ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click']);

    // The confirmation dialog is a Material dialog: click its Delete button, never Cancel.
    const confirm = await util().waitForCondition(() => {
      const hits = fresh(DIALOGS, dialogsBefore).map((dialog) => bestOf(dialog, 'button, [role="button"]')).filter(Boolean);
      return hits.length === 1 ? hits[0] : null;
    }, { timeout: 1800, pollMs: 70 });
    if (confirm) {
      confirm.focus?.();
      fire(confirm, ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click']);
    }

    const gone = await waitForRowGone(record, 2200);
    if (gone) return { ok: true, verified: true, via: 'dom' };
    return confirm ? { ok: false, unknown: true, reason: 'delete-unconfirmed' } : { ok: false, reason: 'confirm-not-found' };
  }

  /** One complete attempt at an operation through the page UI using the given strategy. */
  async function attempt(operation, record, strategy = 'primary') {
    const site = ABCM.sites.current();
    if (site && site.id !== 'chatgpt') {
      const direct = await tryDirectRowAction(operation, record, strategy);
      if (direct?.ok) return { ok: true };
      // The direct action already asked the site; trying the menu route as well could act twice.
      if (direct?.unknown) return direct;
    }
    const opened = await openMenu(record, strategy);
    if (!opened.ok) return opened;
    const item = await resolveMenuItem(operation, opened.menu, strategy);
    if (!item) return { ok: false, reason: 'operation-item-not-found' };
    const dialogsBefore = snapshotDialogs();
    const triggered = await triggerOperation(operation, opened.menu, strategy, item);
    if (!triggered.ok) return triggered;
    const confirmed = await confirmAction(operation, strategy, record, dialogsBefore);
    if (!confirmed.ok) return confirmed;
    return { ok: true };
  }

  ABCM.define('visualEngine', {
    labelScore, resolveMenuButton, findMenuItem, resolveMenuItem, findConfirmButton, confirmAction,
    tryDirectRowAction, openMenu, triggerOperation, geminiDelete, attempt, activate
  });
})(globalThis);
