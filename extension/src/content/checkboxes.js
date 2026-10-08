/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Checkbox overlay for the chat rows.

  Each chat row gets one native checkbox, appended to the row's positioned container and shown over
  space reserved with padding. The site's own children are never moved or re-parented: external DOM
  surgery on framework-managed nodes makes React throw NotFoundError when it next reconciles. The
  chat link itself is left alone, because sites rely on it: ChatGPT's link is only the title text and
  stretches a ::before overlay over the whole row, which only works while the link is not positioned.
  While selecting, a click on the row toggles its checkbox instead of opening the chat.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const CHECKBOX_ATTR = 'data-abcm-checkbox';
  const WRAP_ATTR = 'data-abcm-wrap';
  const RESERVED_PX = 26; // room kept at the start of the row for the checkbox
  const handlers = new WeakMap(); // anchor -> click listener

  const PAGE_CSS = `
    [data-abcm-selected]{background-color:rgba(14,124,149,.16)!important;outline:1px solid rgba(14,124,149,.55)!important;outline-offset:-1px}
    [data-abcm-retired]{display:none!important}
  `;

  /** Adds the small page-level stylesheet (selected-row tint, retired rows) once. */
  function ensurePageStyles() {
    if (g.document.getElementById('abcm-page-style') || g.__abcmPageSheet) return;
    try {
      const sheet = new g.CSSStyleSheet();
      sheet.replaceSync(PAGE_CSS);
      g.document.adoptedStyleSheets = [...g.document.adoptedStyleSheets, sheet];
      g.__abcmPageSheet = sheet;
      return;
    } catch (_) { /* constructable stylesheets unavailable: use a <style> element */ }
    const style = g.document.createElement('style');
    style.id = 'abcm-page-style';
    style.textContent = PAGE_CSS;
    (g.document.head || g.document.documentElement).appendChild(style);
  }

  /*
   * The box. Sites restyle form controls (ChatGPT sets appearance:none, which leaves an invisible
   * box), and a native checkbox looks different on every site and OS. So the visible box is drawn by
   * the extension, entirely with inline !important styles that no site stylesheet can override, and
   * it is the same on ChatGPT, Claude, Gemini and Grok: an 18px rounded square, a grey border when
   * empty, the teal fill with a white tick when selected. The real <input type="checkbox"> stays on
   * top of it, invisible and larger (28px) for the pointer, the keyboard and screen readers.
   */
  const BOX = { size: 18, hit: 28, border: '#7a8e98', fill: '#0e7c95', ring: '#3fc4de' };

  function important(el, rules) {
    for (const [name, value] of Object.entries(rules)) el.style.setProperty(name, value, 'important');
  }

  function buildBox(anchor) {
    const doc = g.document;
    const wrap = doc.createElement('span');
    wrap.setAttribute(WRAP_ATTR, '1');
    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.setAttribute(CHECKBOX_ATTR, '1');
    const tick = ABCM.icons.icon('check');
    tick.setAttribute('data-abcm-tick', '1');
    wrap.append(input, tick);
    input.addEventListener('click', (event) => onCheckboxClick(event, anchor));
    const refocus = () => {
      let visible = false;
      try { visible = input.matches(':focus-visible'); } catch (_) { visible = false; }
      wrap.dataset.focus = visible && doc.activeElement === input ? '1' : '';
      paint(input);
    };
    input.addEventListener('focus', refocus);
    input.addEventListener('blur', refocus);
    return wrap;
  }

  function styleBox(wrap) {
    const input = wrap.querySelector(`[${CHECKBOX_ATTR}]`);
    const tick = wrap.querySelector('[data-abcm-tick]');
    important(wrap, {
      position: 'absolute', 'inset-inline-start': '8px', 'inset-block-start': '50%', transform: 'translateY(-50%)',
      display: 'block', width: `${BOX.size}px`, height: `${BOX.size}px`, 'box-sizing': 'border-box', margin: '0', padding: '0',
      'border-width': '2px', 'border-style': 'solid', 'border-radius': '5px', 'z-index': '5', opacity: '1', visibility: 'visible',
      'pointer-events': 'none', 'clip-path': 'none', 'line-height': '0'
    });
    important(input, {
      appearance: 'none', '-webkit-appearance': 'none', position: 'absolute',
      'inset-inline-start': `${(BOX.size - BOX.hit) / 2 - 2}px`, 'inset-block-start': `${(BOX.size - BOX.hit) / 2 - 2}px`,
      width: `${BOX.hit}px`, height: `${BOX.hit}px`, margin: '0', padding: '0', border: '0', opacity: '0', display: 'block',
      visibility: 'visible', 'pointer-events': 'auto', cursor: 'pointer', 'z-index': '1', background: 'transparent', 'clip-path': 'none'
    });
    important(tick, {
      position: 'absolute', 'inset-inline-start': '0', 'inset-block-start': '0', width: '100%', height: '100%', display: 'none',
      fill: 'none', stroke: '#ffffff', 'stroke-width': '3.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none'
    });
    paint(input);
  }

  /** Redraws one box from its input's state (checked, keyboard focus). */
  function paint(input) {
    const wrap = input?.parentElement;
    if (!wrap || !wrap.hasAttribute(WRAP_ATTR)) return;
    const on = !!input.checked;
    important(wrap, {
      'background-color': on ? BOX.fill : 'transparent',
      'border-color': on ? BOX.fill : BOX.border,
      outline: wrap.dataset.focus ? `2px solid ${BOX.ring}` : 'none',
      'outline-offset': '2px'
    });
    const tick = wrap.querySelector('[data-abcm-tick]');
    if (tick) tick.style.setProperty('display', on ? 'block' : 'none', 'important');
  }

  /**
   * The element the checkbox lives in: the nearest ancestor of the chat link (up to its row) that is
   * already positioned, so nothing about the site's layout has to change; otherwise the row itself.
   */
  function hostFor(anchor) {
    const row = ABCM.dom.rowOf(anchor) || anchor;
    for (let el = anchor.parentElement; el; el = el.parentElement) {
      if (g.getComputedStyle(el).position !== 'static') return el;
      if (el === row) break;
    }
    return row === anchor ? anchor.parentElement || anchor : row;
  }

  function reserveSpace(host) {
    if (host.dataset.abcmPad !== undefined) return;
    const computed = g.getComputedStyle ? g.getComputedStyle(host) : null;
    if (computed && computed.position === 'static') {
      host.style.position = 'relative';
      host.dataset.abcmPos = '1';
    }
    host.dataset.abcmPad = host.style.paddingInlineStart || '';
    const base = computed ? parseFloat(computed.paddingInlineStart) || 0 : 0;
    host.style.paddingInlineStart = `${base + RESERVED_PX}px`;
  }

  function releaseSpace(host) {
    if (host.dataset.abcmPad !== undefined) {
      host.style.paddingInlineStart = host.dataset.abcmPad;
      delete host.dataset.abcmPad;
    }
    if (host.dataset.abcmPos) {
      host.style.position = '';
      delete host.dataset.abcmPos;
    }
  }

  /** The checkbox's accessible name: "Select chat: <title>" in the current language. */
  function labelFor(anchor) {
    const base = ABCM.i18n ? ABCM.i18n.t('page.selectChat') : 'Select chat';
    const title = ABCM.dom.titleOf(anchor);
    return title ? `${base}: ${title}` : base;
  }

  /** Re-labels every checkbox (the language may have changed). */
  function relabel() {
    ABCM.state.ordered().forEach((record) => record.checkbox?.setAttribute('aria-label', labelFor(record.anchor)));
  }

  // Only real user input counts: a script on the site can dispatch clicks too, and must not be able to
  // build a selection for the user. (Tests clear ABCM.trustedOnly because jsdom events are never trusted.)
  const allowed = (event) => event.isTrusted || ABCM.trustedOnly === false;

  function onCheckboxClick(event, anchor) {
    event.stopPropagation();
    if (!allowed(event)) { event.preventDefault(); return; }
    const state = ABCM.state;
    const id = state.get(ABCM.dom.idFromElement(anchor))?.id || ABCM.dom.idFromElement(anchor);
    if (!id) return;
    const on = event.currentTarget.checked;
    if (event.shiftKey && state.lastChecked && on) state.selectRange(state.lastChecked, id);
    else state.setSelected(id, on);
    state.lastChecked = id;
    paint(event.currentTarget);
  }

  function onRowClick(event, anchor) {
    // Let the site's own buttons (the "..." menu, inputs) keep working.
    const target = event.target;
    if (target?.closest?.(`[${CHECKBOX_ATTR}]`)) return;
    if (target?.closest?.('button, [role="button"], [role="menuitem"], input, textarea, select')) return;
    event.preventDefault();
    event.stopPropagation();
    if (!allowed(event)) return;
    const state = ABCM.state;
    const id = ABCM.dom.idFromElement(anchor);
    if (!id) return;
    const on = !state.isSelected(id);
    if (event.shiftKey && state.lastChecked && on) state.selectRange(state.lastChecked, id);
    else state.setSelected(id, on);
    state.lastChecked = id;
  }

  /** Makes sure one wired checkbox exists inside the row and the registry knows about it. */
  function attach(anchor) {
    const id = ABCM.dom.idFromElement(anchor);
    if (!id) return null;
    ensurePageStyles();

    const row = ABCM.dom.rowOf(anchor) || anchor;
    const host = hostFor(anchor);
    const found = row.querySelectorAll(`[${WRAP_ATTR}]`);
    let wrap = found[0] || null;
    found.forEach((extra, i) => { if (i > 0) extra.remove(); });
    if (!wrap) wrap = buildBox(anchor);
    const checkbox = wrap.querySelector(`[${CHECKBOX_ATTR}]`);
    checkbox.setAttribute('aria-label', labelFor(anchor));
    if (wrap.parentElement !== host) {
      const previous = wrap.parentElement;
      host.appendChild(wrap);
      if (previous && previous !== host) releaseSpace(previous);
    }
    styleBox(wrap);
    reserveSpace(host);

    if (!handlers.has(anchor)) {
      const listener = (event) => onRowClick(event, anchor);
      handlers.set(anchor, listener);
      anchor.addEventListener('click', listener, true);
    }

    const record = ABCM.state.register({ id, anchor, checkbox });
    if (ABCM.state.isSelected(id)) row.setAttribute('data-abcm-selected', '1');
    return record;
  }

  /** Adds checkboxes to every chat row that has none (or whose row element was replaced). */
  function attachAll() {
    const anchors = ABCM.dom.getAllConversations();
    let added = 0;
    let skipped = 0;
    anchors.forEach((anchor) => {
      const id = ABCM.dom.idFromElement(anchor);
      if (!id) return;
      const record = ABCM.state.get(id);
      if (record && record.anchor === anchor && record.checkbox?.isConnected && handlers.has(anchor)) { skipped += 1; return; }
      if (attach(anchor)) added += 1;
    });
    return { added, skipped, total: anchors.length };
  }

  /** Removes the checkbox and every trace of selection mode from one row. */
  function detach(anchor) {
    if (!anchor) return false;
    const listener = handlers.get(anchor);
    if (listener) {
      anchor.removeEventListener('click', listener, true);
      handlers.delete(anchor);
    }
    const row = ABCM.dom.rowOf(anchor) || anchor;
    const boxes = row.querySelectorAll(`[${WRAP_ATTR}]`);
    boxes.forEach((box) => { const host = box.parentElement; box.remove(); if (host) releaseSpace(host); });
    row.removeAttribute('data-abcm-selected');
    anchor.removeAttribute('data-abcm-selected');
    return boxes.length > 0;
  }

  /** Ends selection mode: removes every checkbox and forgets the registry and the selection. */
  function removeAll() {
    let removed = 0;
    ABCM.state.ordered().forEach((record) => { if (detach(record.anchor)) removed += 1; });
    // Rows the registry lost track of (a re-rendered row keeps its old checkbox until the site drops it).
    g.document.querySelectorAll(`[${WRAP_ATTR}]`).forEach((box) => {
      const host = box.parentElement;
      box.remove();
      if (host) releaseSpace(host);
      removed += 1;
    });
    g.document.querySelectorAll('[data-abcm-selected]').forEach((el) => el.removeAttribute('data-abcm-selected'));
    ABCM.state.reset();
    return removed;
  }

  /**
   * Removes what an orphaned earlier copy left in the page after an update: its panel, its
   * checkboxes, and the padding and attributes of version 8 (data-bulk-*, .conversation-checkbox).
   */
  function cleanupLeftovers() {
    g.document.querySelectorAll('[data-abcm-root]').forEach((el) => el.remove());
    g.document.querySelectorAll(`[${WRAP_ATTR}], [${CHECKBOX_ATTR}], .conversation-checkbox, [data-bulk-checkbox]`).forEach((el) => {
      if (!el.isConnected) return; // already removed together with its box
      const anchor = el.parentElement;
      el.remove();
      if (anchor) {
        releaseSpace(anchor);
        if (anchor.dataset.bulkPadApplied) {
          anchor.style.paddingLeft = anchor.dataset.bulkPrevPadLeft || '';
          delete anchor.dataset.bulkPadApplied;
          delete anchor.dataset.bulkPrevPadLeft;
        }
        if (anchor.dataset.bulkPosApplied) { anchor.style.position = ''; delete anchor.dataset.bulkPosApplied; }
        ['data-bulk-bound', 'data-bulk-conversation-id', 'data-abcm-selected', 'data-abcm-id'].forEach((name) => anchor.removeAttribute(name));
        anchor.style.cursor = '';
      }
    });
  }

  ABCM.define('checkboxes', { attach, attachAll, detach, removeAll, cleanupLeftovers, ensurePageStyles, relabel, paint, RESERVED_PX });
})(globalThis);
