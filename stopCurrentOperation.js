/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
(function() {
  'use strict';

  if (window.GlobalState && GlobalState.requestStop) {
    GlobalState.requestStop();
    console.log('[ChatGPTBulkDelete] Stop requested');
    if (window.CommonUtils && CommonUtils.showNotification) {
      CommonUtils.showNotification('Stop requested. Current item may finish first.', 'info');
    }
  } else {
    console.warn('[ChatGPTBulkDelete] GlobalState not available for stop request');
  }
})();
