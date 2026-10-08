/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Site registry: the single place that knows which AI chat sites are supported and how to find
  their conversations. Shared by the content scripts, the popup, the options page and the worker.

  Selectors here describe each site's sidebar as observed in the browser. They are the part most
  likely to need updating when a site changes its page; everything else reads from this table.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const SITES = [
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      hosts: ['chatgpt.com', 'chat.openai.com'],
      url: 'https://chatgpt.com/',
      color: '#10a37f',
      // Rows in the history sidebar and how to read an id out of their link.
      conversation: 'a[href^="/c/"]',
      anchorMatch: 'a[href*="/c/"]',
      idRe: /\/c\/([a-zA-Z0-9-]+)/,
      title: '.relative.grow.overflow-hidden.whitespace-nowrap',
      // Candidates for the sidebar container, most specific first.
      history: ['[data-testid="history"]', '[id^="history"]', 'nav[aria-label*="chat" i]', 'nav'],
      // 'api' sites are tried through the site's own backend first; 'visual' sites only through the page UI.
      method: 'api',
      archive: true
    },
    {
      id: 'claude',
      name: 'Claude',
      hosts: ['claude.ai'],
      url: 'https://claude.ai/',
      color: '#d97757',
      conversation: 'a[href*="/chat/"]',
      anchorMatch: 'a[href*="/chat/"]',
      idRe: /\/chat\/([0-9a-fA-F-]{8,})/,
      title: null,
      history: ['nav', 'aside', '[data-testid*="menu" i]', '[class*="sidebar" i]'],
      method: 'api',
      archive: false
    },
    {
      id: 'gemini',
      name: 'Gemini',
      hosts: ['gemini.google.com'],
      url: 'https://gemini.google.com/',
      color: '#4285f4',
      conversation: 'a[href*="/app/"]',
      anchorMatch: 'a[href*="/app/"]',
      idRe: /\/app\/([\w-]+)/,
      title: null,
      history: ['nav', '[role="navigation"]', 'aside', '[class*="conversation" i]'],
      method: 'visual',
      archive: false
    },
    {
      id: 'grok',
      name: 'Grok',
      hosts: ['grok.com'],
      url: 'https://grok.com/',
      color: '#6b7280',
      // Conversations live at /c/{uuid}. Same prefix as ChatGPT, but sites are matched by host so they never collide.
      conversation: 'a[href^="/c/"]',
      anchorMatch: 'a[href*="/c/"]',
      idRe: /\/c\/([\w-]+)/,
      title: null,
      // The Grok sidebar is not a <nav>/<aside>, so class-based candidates come first.
      history: ['[class*="sidebar" i]', '[class*="history" i]', '[role="navigation"]', 'nav', 'aside'],
      method: 'api',
      archive: false
    }
  ];

  // Exact host, the same rule the manifest's content-script matches use (a subdomain is not a supported page).
  function hostMatches(hostname, host) {
    return hostname === host;
  }

  /** Returns the site for a hostname or a full URL, or null when the page is not supported. */
  function matchSite(hostOrUrl) {
    let hostname = String(hostOrUrl || '').trim().toLowerCase();
    if (!hostname) return null;
    if (hostname.includes('/') || hostname.includes(':')) {
      try {
        const url = new URL(hostname);
        if (url.protocol !== 'https:' || url.port) return null;
        hostname = url.hostname;
      } catch (_) {
        return null;
      }
    }
    return SITES.find((site) => site.hosts.some((host) => hostMatches(hostname, host))) || null;
  }

  ABCM.define('sites', {
    all: SITES,
    byId: (id) => SITES.find((site) => site.id === id) || null,
    match: matchSite,
    /** Content-script entry point: the site of the current page. */
    current: () => matchSite(g.location?.hostname || '')
  });
})(globalThis);
