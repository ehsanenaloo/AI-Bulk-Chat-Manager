/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Input shield for the page-menu route. While the extension drives the site's own menus and dialogs, a
  click or key press from the user could open another chat's menu or close the dialog at the wrong
  moment. The shield is a transparent layer over the page (below this extension's panel) that takes real
  mouse and touch input, and a key filter that drops real key presses outside the panel. Events the
  extension itself sends are script events (isTrusted is false) and pass: they go straight to their target.
  The panel stays usable, so Stop always works, and a click on one of this extension's own checkboxes still
  ticks or unticks it (a chat unticked during a run is skipped). Nothing is kept: off() removes the layer and the filters.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const POINTER_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'wheel', 'touchstart', 'touchmove', 'dragstart'];
  const KEY_EVENTS = ['keydown', 'keyup', 'keypress', 'beforeinput'];
  const MOVE_EVENTS = ['pointermove', 'mousemove'];
  const HINT_GAP_MS = 4000;

  let layer = null;
  let lastHint = 0;

  const fromPanel = (event) => event.composedPath().some((el) => el?.nodeType === 1 && el.hasAttribute?.('data-abcm-root'));

  function hint() {
    const now = Date.now();
    if (now - lastHint < HINT_GAP_MS) return;
    lastHint = now;
    try { ABCM.panel?.toast?.(ABCM.i18n.t('running.hold')); } catch (_) { /* the panel is not mounted */ }
  }

  /** Whether the point is over one of this extension's own checkboxes. */
  function overCheckbox(x, y) {
    return Array.from(g.document.querySelectorAll('[data-abcm-checkbox]')).some((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
  }

  /** Over a checkbox the layer lets real input through, so a chat can still be unticked during a run. */
  function track(event) {
    if (layer) layer.style.setProperty('pointer-events', overCheckbox(event.clientX, event.clientY) ? 'none' : 'auto', 'important');
  }

  function swallow(event) {
    if (!event.isTrusted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    hint();
  }

  function filterKeys(event) {
    if (!event.isTrusted || fromPanel(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    hint();
  }

  function on() {
    if (layer) return;
    layer = g.document.createElement('div');
    layer.setAttribute('data-abcm-shield', '');
    layer.setAttribute('aria-hidden', 'true');
    for (const [k, v] of [['position', 'fixed'], ['top', '0'], ['left', '0'], ['right', '0'], ['bottom', '0'], ['z-index', '2147482999'], ['background', 'transparent'], ['cursor', 'progress'], ['pointer-events', 'auto']]) layer.style.setProperty(k, v, 'important');
    for (const type of POINTER_EVENTS) layer.addEventListener(type, swallow, { passive: false });
    g.document.documentElement.appendChild(layer);
    for (const type of KEY_EVENTS) g.addEventListener(type, filterKeys, true);
    for (const type of MOVE_EVENTS) g.addEventListener(type, track, true);
    lastHint = 0;
    hint(); // tells the user once, at the start
  }

  function off() {
    if (!layer) return;
    for (const type of KEY_EVENTS) g.removeEventListener(type, filterKeys, true);
    for (const type of MOVE_EVENTS) g.removeEventListener(type, track, true);
    layer.remove();
    layer = null;
  }

  ABCM.define('shield', { on, off, isOn: () => Boolean(layer) });
})(globalThis);
