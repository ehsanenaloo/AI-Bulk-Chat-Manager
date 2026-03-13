/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
(function() {
  'use strict';

  const checkboxes = Array.from(document.querySelectorAll('.conversation-checkbox'))
    .filter(cb => cb.offsetParent !== null);

  checkboxes.forEach(cb => {
    cb.checked = true;
  });

  const count = checkboxes.length;
  console.log(`[ChatGPTBulkDelete] Selected ${count} visible conversations`);
  if (window.CommonUtils && CommonUtils.showNotification) {
    CommonUtils.showNotification(`Selected ${count} visible conversations`, 'info');
  }
})();
