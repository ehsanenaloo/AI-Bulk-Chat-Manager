/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
(function() {
  'use strict';

  const checkboxes = Array.from(document.querySelectorAll('.conversation-checkbox'));
  checkboxes.forEach(cb => {
    cb.checked = false;
  });

  const count = checkboxes.length;
  console.log(`[ChatGPTBulkDelete] Cleared selection on ${count} conversations`);
  if (window.CommonUtils && CommonUtils.showNotification) {
    CommonUtils.showNotification(`Cleared selection on ${count} conversations`, 'info');
  }
})();
