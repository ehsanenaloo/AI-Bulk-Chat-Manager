/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
(function() {
  'use strict';

  const history = document.querySelector('[id^="history"]');
  const nav = document.querySelector('nav');
  const target = history || nav || document.scrollingElement;

  if (!target) {
    console.warn('[ChatGPTBulkDelete] No scroll target found');
    return;
  }

  const amount = Math.max(600, Math.floor((target.clientHeight || window.innerHeight) * 0.9));
  if (typeof target.scrollBy === 'function') {
    target.scrollBy({ top: amount, behavior: 'smooth' });
  } else {
    target.scrollTop += amount;
  }

  console.log(`[ChatGPTBulkDelete] Scrolled more by ${amount}px`);
})();
