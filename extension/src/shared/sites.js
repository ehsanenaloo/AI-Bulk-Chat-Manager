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
      // Chats inside a Project are listed as /g/<project>/c/<id>.
      conversation: 'a[href^="/c/"], a[href^="/g/"][href*="/c/"]',
      anchorMatch: 'a[href*="/c/"]',
      idRe: /\/c\/([a-zA-Z0-9-]+)/,
      // Pages whose chat links are not the sidebar list (the archived chats list in Settings).
      offPaths: /^\/settings(\/|$)/,
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
      // Chats (/chat/<uuid>) and sessions: Cowork (/cowork/cse_<id>) and Claude Code (/code/session_<id>).
      // Sessions have no delete endpoint known here, so they only ever go through the page UI.
      conversation: 'a[href*="/chat/"], a[href^="/cowork/cse_"], a[href^="/code/session_"]',
      anchorMatch: 'a[href*="/chat/"], a[href^="/cowork/cse_"], a[href^="/code/session_"]',
      idRe: /\/(?:chat|cowork|code)\/([0-9a-fA-F-]{8,}|cse_[A-Za-z0-9]+|session_[A-Za-z0-9]+)/,
      // Rows listed in the page itself (the chats and sessions table of a Project), beside the sidebar.
      extraRows: 'main a[href*="/chat/"], main a[href^="/cowork/cse_"], main a[href^="/code/session_"]',
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
      // Elements of a conversation page, read only when the user exports it.
      read: { user: 'user-query', model: 'model-response', userText: '.query-text', body: 'message-content', scroller: 'infinite-scroller', images: { user: 'img.preview-image', model: 'img.image' } },
      title: null,
      history: ['nav', '[role="navigation"]', 'aside', '[class*="conversation" i]'],
      method: 'api',
      archive: false
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      hosts: ['chat.deepseek.com'],
      url: 'https://chat.deepseek.com/',
      color: '#4d6bfe',
      // Chats live at /a/chat/s/{uuid}. The page's class names are hashed, so only the design system's scroll area is named.
      conversation: 'a[href*="/a/chat/s/"]',
      anchorMatch: 'a[href*="/a/chat/s/"]',
      idRe: /\/a\/chat\/s\/([\w-]+)/,
      title: null,
      history: ['.ds-scroll-area', 'nav', 'aside'],
      method: 'api',
      archive: false
    },
    {
      id: 'copilot',
      name: 'Copilot',
      hosts: ['copilot.com', 'www.copilot.com', 'copilot.microsoft.com'],
      url: 'https://copilot.com/chat',
      color: '#7b61ff',
      conversation: 'a[href*="/chat/conversation/"]',
      anchorMatch: 'a[href*="/chat/conversation/"]',
      idRe: /\/chat\/conversation\/([\w-]+)/,
      title: null,
      history: ['[class*="NavSubItemGroup"]', 'nav'],
      // No known backend call: the row menu of the page does the work, and the chat text cannot be read.
      method: 'visual',
      confirmWait: 5000,
      archive: false
    },
    {
      id: 'meta',
      name: 'Meta AI',
      hosts: ['www.meta.ai', 'meta.ai'],
      url: 'https://www.meta.ai/',
      color: '#0a7cff',
      conversation: 'a[href*="/prompt/"]',
      anchorMatch: 'a[href*="/prompt/"]',
      idRe: /\/prompt\/([\w-]+)/,
      title: null,
      history: ['nav', 'aside'],
      // The site deletes through a GraphQL call with a built-in document id, so only the page menu is used.
      method: 'visual',
      archive: false
    },
    {
      id: 'kimi',
      name: 'Kimi',
      hosts: ['www.kimi.ai', 'kimi.ai', 'www.kimi.com', 'kimi.com'],
      url: 'https://www.kimi.ai/',
      color: '#1783ff',
      // The "All chats" link is /chat/history; chats are /chat/<uuid>.
      conversation: 'a[href^="/chat/"]:not([href^="/chat/history"])',
      anchorMatch: 'a[href^="/chat/"]:not([href^="/chat/history"])',
      idRe: /\/chat\/([0-9a-f]{8}-[0-9a-f-]{27})/,
      title: null,
      history: ['[class*="sidebar-history-list"]', 'nav', 'aside'],
      method: 'visual',
      archive: false
    },
    {
      id: 'qwen',
      name: 'Qwen',
      hosts: ['chat.qwen.ai'],
      url: 'https://chat.qwen.ai/',
      color: '#615ced',
      // Rows are links without an address: a chat is known by its title and place (see dom.titleKey).
      conversation: 'a.chat-item-drag-link',
      anchorMatch: 'a.chat-item-drag-link',
      idRe: /^$/,
      idFromTitle: true,
      title: '.chat-item-title-text',
      history: ['.folder-content', 'nav', 'aside'],
      menuButton: 'button[aria-label="Chat Menu"]',
      // The confirmation dialog fades in slowly.
      confirmWait: 5000,
      method: 'visual',
      archive: false
    },
    {
      id: 'zai',
      name: 'Z.ai',
      hosts: ['chat.z.ai'],
      url: 'https://chat.z.ai/',
      color: '#2d6bff',
      // Rows are buttons without an address: a chat is known by its title and place (see dom.titleKey).
      conversation: '.AgentChatList .group > button',
      anchorMatch: '.AgentChatList .group > button',
      idRe: /^$/,
      idFromTitle: true,
      title: null,
      history: ['.AgentChatList', 'nav', 'aside'],
      // The menu trigger is a div, not a button.
      menuButton: '[aria-haspopup="menu"]',
      // The confirmation dialog fades in slowly.
      confirmWait: 5000,
      method: 'visual',
      archive: false
    },
    {
      id: 'perplexity',
      name: 'Perplexity',
      hosts: ['www.perplexity.ai', 'perplexity.ai'],
      url: 'https://www.perplexity.ai/',
      color: '#20808d',
      // Threads live at /search/{uuid}. The link only covers its row; its aria-label carries the title.
      conversation: 'a[href^="/search/"]',
      anchorMatch: 'a[href^="/search/"]',
      idRe: /\/search\/([\w-]+)/,
      title: null,
      history: ['nav', 'aside'],
      method: 'api',
      archive: false
    },
    {
      id: 'grok',
      name: 'Grok',
      hosts: ['grok.com'],
      url: 'https://grok.com/',
      color: '#6b7280',
      // Conversations live at /c/{uuid}; those inside a Project at /project/{id}?tab=conversations&chat={uuid}.
      // Same prefix as ChatGPT, but sites are matched by host so they never collide.
      conversation: 'a[href^="/c/"], a[href*="/project/"][href*="chat="]',
      anchorMatch: 'a[href*="/c/"], a[href*="/project/"][href*="chat="]',
      idRe: /(?:\/c\/|[?&]chat=)([\w-]+)/,
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
