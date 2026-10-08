/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  The popup's rotating footer, kept from version 8: a short message and a button for the active item,
  four tabs (About, GitHub, Rate, Support) and a thin progress line. It rotates every five seconds and
  pauses while the pointer is over it. Clicking a tab shows that item and restarts the timer.
*/
(function (g) {
  'use strict';
  const ABCM = g.ABCM;
  const t = (key, params) => ABCM.i18n.t(key, params);
  const $ = (id) => g.document.getElementById(id);

  const ROTATE_MS = 5000;
  const TICK_MS = 100; // 10 fps is indistinguishable from smooth for a strip this thin, and far cheaper

  const ITEMS = [
    { id: 'about', action: () => ABCM.ext.openTab(ABCM.links.website).then(() => g.close()) },
    { id: 'github', action: () => ABCM.ext.openTab(ABCM.links.repo) },
    { id: 'rate', action: () => ABCM.ext.openTab(ABCM.links.reviewUrl()) },
    { id: 'support', action: () => ABCM.ext.openTab(ABCM.links.support) }
  ];

  const state = { index: 0, startedAt: 0, pausedRemaining: null, timer: null, ticker: null, hovering: false };

  function setProgress(percent) {
    const bar = $('footer-indicator-progress');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  function moveIndicator() {
    const indicator = $('footer-indicator');
    const nav = $('footer-nav');
    const active = nav?.querySelector('.footer-nav-btn.active');
    if (!indicator || !active) return;
    const navRect = nav.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    indicator.style.width = `${rect.width}px`;
    // Offset from the start edge, so it also follows right-to-left layouts.
    const offset = g.document.documentElement.dir === 'rtl' ? navRect.right - rect.right : rect.left - navRect.left;
    indicator.style.insetInlineStart = `${offset}px`;
  }

  function show(index) {
    state.index = ((index % ITEMS.length) + ITEMS.length) % ITEMS.length;
    const item = ITEMS[state.index];
    g.document.querySelectorAll('.footer-nav-btn').forEach((button, i) => {
      button.classList.toggle('active', i === state.index);
      if (i === state.index) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    });
    $('footer-message').textContent = t(`footer.${item.id}.message`);
    const cta = $('footer-cta');
    cta.textContent = t(`footer.${item.id}.cta`);
    cta.onclick = () => item.action();
    state.startedAt = Date.now();
    state.pausedRemaining = null;
    moveIndicator();
    setProgress(0);
  }

  function stop() {
    g.clearTimeout(state.timer);
    g.clearInterval(state.ticker);
    state.timer = state.ticker = null;
    state.pausedRemaining = Math.max(0, ROTATE_MS - (Date.now() - state.startedAt));
  }

  const reducedMotion = () => !!g.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function start(fresh = false) {
    if (reducedMotion()) { setProgress(0); return; } // no automatic rotation for people who asked for less motion
    g.clearTimeout(state.timer);
    g.clearInterval(state.ticker);
    if (fresh) state.startedAt = Date.now();
    else if (state.pausedRemaining != null) state.startedAt = Date.now() - (ROTATE_MS - state.pausedRemaining);
    state.pausedRemaining = null;
    const delay = Math.max(120, ROTATE_MS - (Date.now() - state.startedAt));
    state.timer = g.setTimeout(() => { show(state.index + 1); start(true); }, delay);
    state.ticker = g.setInterval(() => setProgress(((Date.now() - state.startedAt) / ROTATE_MS) * 100), TICK_MS);
  }

  function render() {
    const nav = $('footer-nav');
    nav.replaceChildren(...ITEMS.map((item, i) => {
      const button = g.document.createElement('button');
      button.type = 'button';
      button.className = 'footer-nav-btn';
      button.textContent = t(`footer.${item.id}.label`);
      button.addEventListener('click', () => { show(i); start(true); });
      return button;
    }));
    show(state.index);
  }

  function init() {
    render();
    start(true);
    const dock = $('footer-dock');
    dock.addEventListener('mouseenter', () => { state.hovering = true; stop(); });
    dock.addEventListener('mouseleave', () => { state.hovering = false; start(); });
    dock.addEventListener('focusin', stop);
    dock.addEventListener('focusout', () => { if (!state.hovering) start(); });
    g.addEventListener('resize', moveIndicator);
  }

  ABCM.define('footer', { init, render, ITEMS });
})(globalThis);
