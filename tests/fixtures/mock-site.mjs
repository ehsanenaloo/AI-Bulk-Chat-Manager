// A stand-in for the four supported chat sites, used by the browser tests.
//
// The real sites need a signed-in account and change their pages often, so the tests serve a small
// fake page for each site's address (chatgpt.com, claude.ai, ...) through Playwright request routing.
// Each fake keeps the structure the extension depends on: a sidebar of chat links, a per-row "..."
// button, a menu in a portal, a confirmation dialog, and the site's backend endpoints.
//
// Structure notes (what each variant models):
//   chatgpt  <nav aria-label="Chat history"> <li><a href="/c/id">title</a> <div><button aria-haspopup="menu">…
//   claude   <aside> <div data-row><a href="/chat/id">title</a> <div><button aria-haspopup="menu" aria-label="More options for …">
//            (verified against the live site: the "..." button is a sibling of the link, not a child)
//   gemini   <nav role="navigation"> <div role="listitem"><a href="/app/id">… Material-style menu and dialog
//   grok     <div class="sidebar"> <a href="/c/id"> with a hover-revealed "Delete chat" button

export const SITE_HOSTS = {
  chatgpt: 'https://chatgpt.com',
  claude: 'https://claude.ai',
  gemini: 'https://gemini.google.com',
  grok: 'https://grok.com'
};

export function makeChats(count, prefix = 'Project notes') {
  return Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    title: `${prefix} ${i + 1}`
  }));
}

const CSS = `
  body{margin:0;font:14px system-ui,sans-serif;background:#fff;color:#111;display:flex;height:100vh}
  body.dark{background:#212121;color:#eee}
  .side{width:260px;background:#f4f4f4;overflow:auto;flex:none}
  body.dark .side{background:#171717}
  .main{flex:1;display:grid;place-items:center;color:#777}
  a{color:inherit;text-decoration:none}
  .row{position:relative;display:flex;align-items:center}
  .row a{flex:1;display:block;padding:9px 12px;min-width:0}
  .row a>span,.row a>div{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .row:hover{background:rgba(127,127,127,.15)}
  .row button.opt{opacity:0;border:0;background:none;cursor:pointer;padding:6px 10px;font:inherit;color:inherit}
  .row:hover button.opt{opacity:1}
  .menu{position:fixed;z-index:50;background:#fff;color:#111;border:1px solid #ccc;border-radius:8px;padding:4px;min-width:160px}
  body.dark .menu{background:#2f2f2f;color:#eee;border-color:#444}
  .menu [role=menuitem]{padding:8px 10px;cursor:pointer;border-radius:5px}
  .menu [role=menuitem]:hover{background:rgba(127,127,127,.2)}
  .dlg-back{position:fixed;inset:0;background:rgba(0,0,0,.4);display:grid;place-items:center;z-index:60}
  .dlg{background:#fff;color:#111;padding:20px;border-radius:12px;min-width:320px}
  body.dark .dlg{background:#2f2f2f;color:#eee}
  .dlg button{margin-inline-end:8px;padding:8px 14px;border-radius:8px;border:1px solid #888;background:none;color:inherit;cursor:pointer}
  .dlg button.danger{background:#c33;border-color:#c33;color:#fff}
  h4{margin:12px;opacity:.6;font-size:12px}
`;

const SCRIPT = `
(async () => {
  const SITE = document.documentElement.dataset.site;
  const list = await (await fetch('/__mock/chats')).json();
  const side = document.getElementById('side');
  const KEY = { chatgpt: ['/c/', 'li'], claude: ['/chat/', 'div'], gemini: ['/app/', 'div'], grok: ['/c/', 'div'] }[SITE];

  function closeMenus() { document.querySelectorAll('.menu,.dlg-back').forEach((n) => n.remove()); }

  function confirmDialog(row, id) {
    const back = document.createElement('div');
    back.className = 'dlg-back';
    back.innerHTML = '<div class="dlg" role="dialog" aria-modal="true"><h3>Delete chat?</h3><p>This will delete the chat.</p><div><button data-act="cancel">Cancel</button><button class="danger" data-act="delete">Delete</button></div></div>';
    back.addEventListener('click', async (e) => {
      const act = e.target.dataset?.act;
      if (act === 'cancel') back.remove();
      if (act === 'delete') { const res = await fetch('/__mock/delete?id=' + id, { method: 'POST' }); back.remove(); if (res.ok) row.remove(); }
    });
    document.body.appendChild(back);
  }

  function openMenu(btn, row, id) {
    closeMenus();
    const r = btn.getBoundingClientRect();
    const m = document.createElement('div');
    m.className = 'menu';
    m.setAttribute('role', 'menu');
    m.style.left = Math.min(r.left, innerWidth - 180) + 'px';
    m.style.top = r.bottom + 'px';
    const items = SITE === 'chatgpt' ? ['Share', 'Rename', 'Remove from project', 'Archive', 'Delete'] : ['Pin', 'Rename', 'Delete'];
    items.forEach((label) => {
      const it = document.createElement('div');
      it.setAttribute('role', 'menuitem');
      it.textContent = label;
      it.addEventListener('click', () => {
        const text = label;
        m.remove();
        if (text === 'Delete') confirmDialog(row, id);
        if (text === 'Archive') { fetch('/__mock/archive?id=' + id, { method: 'POST' }); row.remove(); }
      });
      m.appendChild(it);
    });
    document.body.appendChild(m);
  }

  function makeRow(chat) {
    const row = document.createElement(KEY[1] === 'li' ? 'li' : 'div');
    row.className = 'row';
    if (SITE === 'claude') row.setAttribute('data-row', '');
    if (SITE === 'gemini') row.setAttribute('role', 'listitem');
    const a = document.createElement('a');
    a.href = KEY[0] + chat.id;
    if (SITE === 'chatgpt') a.innerHTML = '<div class="relative grow overflow-hidden whitespace-nowrap"></div>';
    else a.innerHTML = '<span></span>';
    a.firstElementChild.textContent = chat.title;
    a.addEventListener('click', (e) => { window.__navigated = (window.__navigated || 0) + 1; });
    row.appendChild(a);
    if (SITE === 'grok') {
      const del = document.createElement('button');
      del.className = 'opt';
      del.setAttribute('aria-label', 'Delete chat');
      del.textContent = '\\u00d7';
      del.addEventListener('click', (e) => { e.preventDefault(); confirmDialog(row, chat.id); });
      row.appendChild(del);
    } else {
      const wrap = document.createElement('div');
      const btn = document.createElement('button');
      btn.className = 'opt';
      btn.setAttribute('aria-haspopup', 'menu');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', SITE === 'claude' ? 'More options for ' + chat.title : 'Open conversation options');
      btn.textContent = '\\u22ef';
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openMenu(btn, row, chat.id); });
      wrap.appendChild(btn);
      row.appendChild(wrap);
    }
    return row;
  }

  const container = side.querySelector('[data-list]');
  list.forEach((chat) => container.appendChild(makeRow(chat)));
  window.__addChats = (chats) => chats.forEach((c) => container.appendChild(makeRow(c)));
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu,button.opt')) document.querySelectorAll('.menu').forEach((n) => n.remove()); });
})();
`;

const SIDEBARS = {
  chatgpt: '<nav aria-label="Chat history" id="side" class="side"><h4>Chats</h4><ol data-list></ol></nav>',
  claude: '<aside id="side" class="side"><h4>Recents</h4><div data-list></div></aside>',
  gemini: '<nav id="side" class="side" role="navigation"><h4>Recent</h4><div data-list></div></nav>',
  grok: '<div id="side" class="side sidebar"><h4>History</h4><div data-list></div></div>'
};

export function pageHtml(siteId, { dark = false, dir = 'ltr' } = {}) {
  return `<!doctype html><html data-site="${siteId}" dir="${dir}"><head><meta charset="utf-8"><title>${siteId} (test double)</title><style>${CSS}</style></head>
<body class="${dark ? 'dark' : ''}">${SIDEBARS[siteId]}<div class="main">Test double for ${siteId}</div><script>${SCRIPT}</script></body></html>`;
}

/** The mutable state of one fake site's backend. A test reads it to see what the "server" received. */
export function createMockServer({ chats = makeChats(12), dark = false, dir = 'ltr', failIds = [], rateLimitOnce = false, csp = '' } = {}) {
  return { chats: [...chats], deleted: [], archived: [], requests: [], failIds: new Set(failIds), rateLimitOnce, dark, dir, csp };
}

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * The fake site and its backend as a pure function, so any browser driver can serve it (Playwright
 * request routing for Chromium, WebDriver BiDi interception for Firefox).
 *   request: { method, url, headers (lower-case names), postData, resourceType ('document' for page loads) }
 *   returns: { status, contentType, body, headers? } (headers only carries the page's Content-Security-Policy, when the test asks for one)
 */
export function handleMockRequest(siteId, server, { method = 'GET', url, headers = {}, postData = '', resourceType = '' }) {
  const parsed = new URL(url);
  const path = parsed.pathname;
  server.requests.push(`${method} ${path}`);

  if (path === '/__mock/chats') return json(server.chats);
  if (path === '/__mock/delete') { const id = parsed.searchParams.get('id'); if (server.failIds.has(id)) return json({ detail: 'nope' }, 500); server.deleted.push(id); server.chats = server.chats.filter((c) => c.id !== id); return json({ ok: true }); }
  if (path === '/__mock/archive') { const id = parsed.searchParams.get('id'); server.archived.push(id); server.chats = server.chats.filter((c) => c.id !== id); return json({ ok: true }); }

  // Backend endpoints the API engine calls.
  if (path === '/api/auth/session') return json({ accessToken: 'test-token' });
  if (path === '/api/organizations') return json([{ uuid: 'org-1', capabilities: ['chat'] }]);
  const chatgpt = path.match(/^\/backend-api\/conversation\/([\w-]+)$/);
  const claude = path.match(/^\/api\/organizations\/org-1\/chat_conversations\/([\w-]+)$/);
  const grok = path.match(/^\/rest\/app-chat\/conversations\/([\w-]+)$/);
  const hit = chatgpt || claude || grok;
  if (hit) {
    const id = hit[1];
    if (server.rateLimitOnce) { server.rateLimitOnce = false; return json({}, 429); }
    if (server.failIds.has(id)) return json({ detail: 'nope' }, 500);
    if (chatgpt && method === 'PATCH') {
      const body = JSON.parse(postData || '{}');
      server.requests.push(`BODY ${JSON.stringify(body)}`);
      if (headers.authorization !== 'Bearer test-token') return json({}, 401);
      if (body.is_visible === false) server.deleted.push(id);
      if (body.is_archived === true) server.archived.push(id);
    } else if (method === 'DELETE') {
      server.deleted.push(id);
    } else {
      return json({}, 405);
    }
    server.chats = server.chats.filter((c) => c.id !== id);
    return json({ ok: true });
  }

  if (resourceType === 'document') return { status: 200, contentType: 'text/html', body: pageHtml(siteId, { dark: server.dark, dir: server.dir }), ...(server.csp ? { headers: { 'content-security-policy': server.csp } } : {}) };
  return { status: 204, contentType: 'text/plain', body: '' };
}

/**
 * Serves the fake site and its backend on a Playwright `context`. Returns the mutable server state so a
 * test can inspect what the "server" received (deleted ids, archived ids, requests).
 */
export async function serveMockSite(context, siteId, options = {}) {
  const origin = SITE_HOSTS[siteId];
  const server = createMockServer(options);
  await context.route(`${origin}/**`, async (route) => {
    const request = route.request();
    const reply = handleMockRequest(siteId, server, {
      method: request.method(), url: request.url(), headers: request.headers(), postData: request.postData() || '', resourceType: request.resourceType()
    });
    route.fulfill(reply);
  });
  return server;
}
