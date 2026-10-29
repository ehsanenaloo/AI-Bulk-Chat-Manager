/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/* Every external address the interface links to, in one place. All are https. */
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const REPO = 'https://github.com/ehsanenaloo/AI-Bulk-Chat-Manager';

  const links = {
    guide: 'https://enaloo.com/apps/ai-bulk-chat-manager/',
    pages: 'https://enaloo.com/apps/ai-bulk-chat-manager',
    repo: REPO,
    privacy: `${REPO}/blob/main/docs/PRIVACY.md`,
    support: 'https://enaloo.com/support/',
    website: 'https://www.enaloo.com',
    store: {
      chrome: 'https://chromewebstore.google.com/detail/eppokcmemgiphpegpighpfnhpjggpmoc',
      firefox: 'https://addons.mozilla.org/firefox/addon/ai-bulk-chat-manager/',
      edge: 'https://microsoftedge.microsoft.com/addons/detail/ihncdaihigbgnmiobihpnmijeaicbpjn'
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

  /** The browser name and major version for the enaloo.com pages: 'chrome', 'edge', 'firefox' or 'other'; the major is digits only. */
  function browserInfo() {
    const nav = g.navigator || {};
    const ua = nav.userAgent || '';
    const brands = nav.userAgentData?.brands;
    if (Array.isArray(brands) && brands.length) {
      const edge = brands.find((b) => /Edge/i.test(b.brand));
      const chrome = brands.find((b) => /^Google Chrome$/i.test(b.brand));
      const hit = edge || chrome;
      if (hit) return { name: edge ? 'edge' : 'chrome', major: String(hit.version || '').match(/^\d+/)?.[0] || '' };
    }
    const major = (re) => ua.match(re)?.[1] || '';
    if (/Firefox\//.test(ua)) return { name: 'firefox', major: major(/Firefox\/(\d+)/) };
    if (/Edg\//.test(ua)) return { name: 'edge', major: major(/Edg\/(\d+)/) };
    if (/OPR\/|Vivaldi\/|YaBrowser\//.test(ua) || !/Chrome\//.test(ua)) return { name: 'other', major: '' };
    return { name: 'chrome', major: major(/Chrome\/(\d+)/) };
  }

  const OS_NAMES = ['win', 'mac', 'linux', 'cros', 'android'];
  const osName = (os) => (OS_NAMES.includes(os) ? os : 'other');

  function installAge(installedAt, now = Date.now()) {
    if (!Number.isFinite(installedAt)) return 'unknown';
    const days = (now - installedAt) / 864e5;
    return days < 1 ? 'd1' : days < 7 ? 'w1' : days < 30 ? 'm1' : days < 90 ? 'm3' : 'more';
  }

  function pageUrl(page, params) {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) q.set(key, value);
    return `${links.pages}/${page}/?${q}`;
  }

  /** Opened once in a background tab after a fresh install. */
  function welcomeUrl({ version, lang }) {
    return pageUrl('welcome', { v: version, lang, b: browserInfo().name });
  }

  /** Read by the browser at the moment of removal. Carries only version, language, browser, system and install age. */
  function uninstallUrl({ version, lang, os, installedAt }) {
    const b = browserInfo();
    return pageUrl('uninstall', { v: version, lang, b: b.name, bv: b.major, os: osName(os), age: installAge(installedAt) });
  }

  /** kind: 'bug' or 'feature'. */
  function feedbackUrl(kind, version) {
    if (kind === 'feature') return pageUrl('feedback', { kind: 'feature', v: version });
    const b = browserInfo();
    return pageUrl('feedback', { kind: 'bug', v: version, b: b.name, bv: b.major });
  }

  ABCM.define('links', { ...links, browser, reviewUrl, browserInfo, installAge, welcomeUrl, uninstallUrl, feedbackUrl });
})(globalThis);
