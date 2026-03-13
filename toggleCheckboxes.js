/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/**
 * ChatGPT Bulk Delete - Toggle Checkboxes Visibility
 */

(function() {
  'use strict';

  const containers = Array.from(document.querySelectorAll('.checkbox-container'));
  const checkboxes = Array.from(document.querySelectorAll('.conversation-checkbox'));

  if (!containers.length && !checkboxes.length) {
    console.log('[ChatGPTBulkDelete] No checkboxes found to show/hide');
    if (window.CommonUtils && CommonUtils.showNotification) {
      CommonUtils.showNotification('No checkboxes found to show or hide', 'warning');
    }
    return;
  }

  const visibleSample = containers.find(el => el.offsetParent !== null) || checkboxes.find(el => el.offsetParent !== null);
  const shouldHide = !!visibleSample;

  containers.forEach(el => {
    el.style.display = shouldHide ? 'none' : '';
  });
  checkboxes.forEach(el => {
    el.style.display = shouldHide ? 'none' : '';
  });

  const count = Math.max(containers.length, checkboxes.length);
  const verb = shouldHide ? 'Hid' : 'Showed';
  console.log(`[ChatGPTBulkDelete] ${verb} ${count} checkboxes`);
  if (window.CommonUtils && CommonUtils.showNotification) {
    CommonUtils.showNotification(`${verb} ${count} checkboxes`, 'info');
  }
})();
