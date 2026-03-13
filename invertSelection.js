/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
(function() {
  'use strict';

  const checkboxes = Array.from(document.querySelectorAll('.conversation-checkbox'))
    .filter(cb => cb.offsetParent !== null);

  checkboxes.forEach(cb => {
    cb.checked = !cb.checked;
  });

  const count = checkboxes.length;
  console.log(`[ChatGPTBulkDelete] Inverted ${count} visible conversations`);
  if (window.CommonUtils && CommonUtils.showNotification) {
    CommonUtils.showNotification(`Inverted ${count} visible conversations`, 'info');
  }
})();
