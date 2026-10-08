/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/* Every external address the interface links to, in one place. All are https. */
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const REPO = 'https://github.com/ehsanenaloo/AI-Bulk-Chat-Manager';

  const links = {
    guide: 'https://ehsanenaloo.github.io/AI-Bulk-Chat-Manager/',
    repo: REPO,
    issues: `${REPO}/issues/new/choose`,
    privacy: `${REPO}/blob/main/docs/PRIVACY.md`,
    support: 'https://buymeacoffee.com/enaloo',
    website: 'https://www.enaloo.com',
    store: {
      chrome: 'https://chromewebstore.google.com/detail/eppokcmemgiphpegpighpfnhpjggpmoc',
      firefox: 'https://addons.mozilla.org/firefox/addon/ai-bulk-chat-manager/',
      edge: 'https://microsoftedge.microsoft.com/addons/search/AI%20Bulk%20Chat%20Manager'
    },
    shortcuts: { chrome: 'chrome://extensions/shortcuts', edge: 'edge://extensions/shortcuts', firefox: 'about:addons' }
  };

  /** 'firefox', 'edge' or 'chrome' (the default for every other Chromium browser). */
  function browser() {
    const ua = g.navigator?.userAgent || '';
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Edg\//.test(ua)) return 'edge';
    return 'chrome';
  }

  /** Where "rate this extension" should go for the browser the user is running. */
  function reviewUrl() {
    const b = browser();
    return b === 'chrome' ? `${links.store.chrome}/reviews` : links.store[b];
  }

  ABCM.define('links', { ...links, browser, reviewUrl });
})(globalThis);
