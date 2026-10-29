import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, sidebarHtml } from '../helpers/dom.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value));
const URLS = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/', gemini: 'https://gemini.google.com/app', grok: 'https://grok.com/' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setup(site, handler = () => ({ status: 200 }), { count = 3, html } = {}) {
  const e = createEnv({ url: URLS[site], html: html || sidebarHtml(site, count) });
  e.calls = [];
  e.window.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    e.calls.push({ url: path, method: init.method || 'GET' });
    const out = await handler(path, init);
    return {
      ok: out.status >= 200 && out.status < 300,
      status: out.status,
      headers: { get: (name) => out.headers?.[name.toLowerCase()] ?? null },
      json: async () => out.json ?? {}
    };
  };
  e.ABCM.config.delays = { short: 0, medium: 0, long: 0, extended: 0 };
  e.ABCM.config.timeouts = { elementWait: 50, elementWaitShort: 50, rowGone: 900 };
  return e;
}

function bulkEnv(site, count, { api = true } = {}) {
  const e = setup(site, undefined, { count });
  e.ABCM.checkboxes.attachAll();
  e.ABCM.state.selectVisible();
  Object.assign(e.ABCM.config.api, { throttleMs: 0, concurrency: 1, rateLimitJitter: 0, rateLimitBackoffMs: 1, rateLimitRetries: 2 });
  e.ABCM.apiEngine.isEnabled = () => api;
  e.ABCM.apiEngine.prepare = async () => {};
  return e;
}

// ── outcome model ────────────────────────────────────────────────────────────────────────────
test('bulk.classify: only a confirmed change is a success', () => {
  const { bulk } = bulkEnv('chatgpt', 1).ABCM;
  assert.equal(bulk.classify({ ok: true }), 'succeeded');
  assert.equal(bulk.classify({ ok: true, verified: true }), 'succeeded');
  assert.equal(bulk.classify({ ok: true, verified: false }), 'unknown');
  assert.equal(bulk.classify({ ok: false, unknown: true }), 'unknown');
  assert.equal(bulk.classify({ ok: false, cancelled: true }), 'cancelled');
  assert.equal(bulk.classify({ ok: false, reason: 'x' }), 'failed');
  assert.equal(bulk.classify(undefined), 'failed');
});

test('bulk: an unknown API outcome is not a success, is not repeated in the page UI and is deselected', async () => {
  const e = bulkEnv('chatgpt', 3);
  e.ABCM.apiEngine.run = async () => ({ ok: false, unknown: true, reason: 'api-network-error' });
  e.ABCM.visualEngine.attempt = async () => { throw new Error('the page UI must not repeat an unknown change'); };
  const summary = await e.ABCM.bulk.run('DELETE');
  assert.equal(summary.succeeded, 0);
  assert.equal(summary.failures.length, 0);
  assert.equal(summary.unknown.length, 3);
  assert.equal(summary.unknown[0].reason, 'api-network-error');
  assert.equal(e.ABCM.state.selectedCount(), 0, 'a later Retry or Delete cannot repeat it by mistake');
  assert.equal(e.ABCM.state.visible().length, 3, 'rows are not retired');
});

test('bulk: after a mixed run only confirmed failures stay selected for Retry', async () => {
  const e = bulkEnv('chatgpt', 3);
  const [a, b] = e.ABCM.state.visible().map((r) => r.id);
  e.ABCM.apiEngine.run = async (op, id) => (id === a ? { ok: false, unknown: true, reason: 'api-timeout' } : id === b ? { ok: false, reason: 'api-http-400' } : { ok: true });
  e.ABCM.visualEngine.attempt = async () => ({ ok: false, reason: 'menu-not-opened' });
  const summary = await e.ABCM.bulk.run('DELETE');
  assert.deepEqual(plain(summary.unknown.map((u) => u.id)), [a]);
  assert.deepEqual(plain(summary.failures.map((f) => f.id)), [b]);
  assert.deepEqual(plain(e.ABCM.state.selectedItems().map((i) => i.id)), [b]);
});

test('bulk: a definite refusal still falls back to the page UI', async () => {
  const e = bulkEnv('chatgpt', 2);
  e.ABCM.apiEngine.run = async () => ({ ok: false, reason: 'api-http-403' });
  e.ABCM.visualEngine.attempt = async () => ({ ok: true });
  const summary = await e.ABCM.bulk.run('DELETE');
  assert.equal(summary.succeeded, 2);
});

test('archive: a row that is still listed after the timeout is unknown, never verified', async () => {
  const e = setup('chatgpt');
  e.ABCM.checkboxes.attachAll();
  const record = e.ABCM.state.visible()[0];
  const outcome = await e.ABCM.visualEngine.confirmAction('ARCHIVE', 'primary', record);
  assert.deepEqual(plain(outcome), { ok: false, unknown: true, reason: 'archive-unverified' });
  assert.equal(e.ABCM.bulk.classify(outcome), 'unknown');
});

test('archive: a row that is really gone is verified', async () => {
  const e = setup('chatgpt');
  e.ABCM.checkboxes.attachAll();
  const record = e.ABCM.state.visible()[0];
  record.anchor.closest('li').remove();
  const outcome = await e.ABCM.visualEngine.confirmAction('ARCHIVE', 'primary', record);
  assert.deepEqual(plain(outcome), { ok: true, verified: true });
});

test('row check: a re-rendered row with the same chat id is not a deletion', async () => {
  const e = setup('chatgpt');
  e.ABCM.checkboxes.attachAll();
  const record = e.ABCM.state.visible()[0];
  const href = record.anchor.getAttribute('href');
  const li = record.anchor.closest('li');
  const fresh = li.cloneNode(true);
  fresh.querySelector('a').removeAttribute('data-abcm-id');
  li.replaceWith(fresh); // the site swapped the node but the chat is still listed
  assert.equal(fresh.querySelector('a').getAttribute('href'), href);
  const outcome = await e.ABCM.visualEngine.confirmAction('ARCHIVE', 'primary', record);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.unknown, true);
});

test('row check: a row removed and put back inside the window is not a deletion', async () => {
  const e = setup('chatgpt');
  e.ABCM.checkboxes.attachAll();
  const record = e.ABCM.state.visible()[0];
  const li = record.anchor.closest('li');
  const parent = li.parentNode;
  const next = li.nextSibling;
  li.remove();
  setTimeout(() => parent.insertBefore(li, next), 200);
  const outcome = await e.ABCM.visualEngine.confirmAction('ARCHIVE', 'primary', record);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.unknown, true);
});

function confirmDialog(e, { onClick }) {
  const dialog = e.document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  const button = e.document.createElement('button');
  button.textContent = 'Delete';
  button.addEventListener('click', () => onClick(dialog));
  dialog.append(button);
  e.document.body.append(dialog);
  return dialog;
}

test('delete: an unrelated dialog that stays open does not hide that the target dialog closed', async () => {
  const e = setup('chatgpt');
  e.ABCM.checkboxes.attachAll();
  const record = e.ABCM.state.visible()[0];
  const modal = e.document.createElement('div');
  modal.setAttribute('role', 'dialog');
  modal.textContent = 'Cookie settings';
  e.document.body.append(modal);
  let clicks = 0;
  confirmDialog(e, { onClick: (dialog) => { clicks += 1; dialog.remove(); record.anchor.closest('li').remove(); } });
  const outcome = await e.ABCM.visualEngine.confirmAction('DELETE', 'primary', record, new Set([modal]));
  assert.deepEqual(plain(outcome), { ok: true, verified: true });
  assert.equal(clicks, 1);
});

test('delete: a dialog that never closes ends as unknown', async () => {
  const e = setup('chatgpt');
  e.ABCM.checkboxes.attachAll();
  const record = e.ABCM.state.visible()[0];
  let clicks = 0;
  confirmDialog(e, { onClick: () => { clicks += 1; } });
  const outcome = await e.ABCM.visualEngine.confirmAction('DELETE', 'primary', record, new Set());
  assert.equal(outcome.unknown, true);
  assert.equal(outcome.reason, 'confirm-not-completed');
  assert.ok(clicks <= 2);
});

// ── timeouts and error classes ───────────────────────────────────────────────────────────────
test('API: a request that never answers ends as a timeout with an unknown outcome', async () => {
  const e = setup('chatgpt');
  e.ABCM.config.api.timeoutMs = 30;
  e.window.fetch = (url, init) => new Promise((resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  e.ABCM.apiEngine._memo.token = 'tok';
  const outcome = await e.ABCM.apiEngine.run('DELETE', 'abc');
  assert.deepEqual(plain(outcome), { ok: false, unknown: true, reason: 'api-timeout' });
});

test('API: a dropped connection is unknown, a 5xx is unknown, a 4xx is a definite refusal', async () => {
  const e = setup('grok');
  e.window.fetch = async () => { throw new TypeError('network'); };
  assert.deepEqual(plain(await e.ABCM.apiEngine.run('DELETE', 'g')), { ok: false, unknown: true, reason: 'api-network-error' });
  e.window.fetch = async () => ({ ok: false, status: 502, headers: { get: () => null } });
  assert.equal((await e.ABCM.apiEngine.run('DELETE', 'g')).unknown, true);
  e.window.fetch = async () => ({ ok: false, status: 400, headers: { get: () => null } });
  assert.equal((await e.ABCM.apiEngine.run('DELETE', 'g')).unknown, undefined);
});

test('API: Retry-After is read as seconds or a date, capped, and ignored when invalid', () => {
  const { apiEngine } = setup('chatgpt').ABCM;
  assert.equal(apiEngine.parseRetryAfter('3'), 3000);
  assert.equal(apiEngine.parseRetryAfter('99999'), 60000);
  assert.equal(apiEngine.parseRetryAfter(''), 0);
  assert.equal(apiEngine.parseRetryAfter('soon'), 0);
  const soon = new Date(Date.now() + 5000).toUTCString();
  const ms = apiEngine.parseRetryAfter(soon);
  assert.ok(ms > 2000 && ms <= 5000, String(ms));
  assert.equal(apiEngine.parseRetryAfter(new Date(Date.now() - 5000).toUTCString()), 0);
});

test('API: a 429 carries the server Retry-After', async () => {
  const e = setup('grok', () => ({ status: 429, headers: { 'retry-after': '2' } }));
  assert.deepEqual(plain(await e.ABCM.apiEngine.run('DELETE', 'g')), { ok: false, reason: 'api-rate-limited', retryAfterMs: 2000 });
});

// ── rate limiting and Stop ───────────────────────────────────────────────────────────────────
test('bulk: the next attempt waits for Retry-After', async () => {
  const e = bulkEnv('chatgpt', 1);
  const times = [];
  e.ABCM.apiEngine.run = async () => {
    times.push(Date.now());
    return times.length === 1 ? { ok: false, reason: 'api-rate-limited', retryAfterMs: 150 } : { ok: true };
  };
  const summary = await e.ABCM.bulk.run('DELETE');
  assert.equal(summary.succeeded, 1);
  assert.ok(times[1] - times[0] >= 140, `waited ${times[1] - times[0]} ms`);
});

test('bulk: repeated 429 is bounded and reported as rate limited, without the page UI', async () => {
  const e = bulkEnv('chatgpt', 2);
  let calls = 0;
  e.ABCM.apiEngine.run = async () => { calls += 1; return { ok: false, reason: 'api-rate-limited', retryAfterMs: 1 }; };
  e.ABCM.visualEngine.attempt = async () => { throw new Error('no fallback after a rate limit'); };
  const summary = await e.ABCM.bulk.run('DELETE');
  assert.equal(calls, 2 * (1 + e.ABCM.config.api.rateLimitRetries));
  assert.deepEqual(plain(summary.failures.map((f) => f.reason)), ['api-rate-limited', 'api-rate-limited']);
  assert.equal(e.ABCM.state.selectedCount(), 2);
});

test('bulk: Stop during a 429 cooldown sends no further request and cancels the chat', async () => {
  const e = bulkEnv('chatgpt', 2);
  let calls = 0;
  e.ABCM.apiEngine.run = async () => { calls += 1; return { ok: false, reason: 'api-rate-limited', retryAfterMs: 5000 }; };
  const running = e.ABCM.bulk.run('DELETE');
  await sleep(60);
  e.ABCM.state.requestStop();
  const summary = await running;
  assert.equal(calls, 1);
  assert.equal(summary.stopped, true);
  assert.equal(summary.cancelled, 1);
  assert.equal(summary.failures.length, 0);
  assert.equal(e.ABCM.state.selectedCount(), 2);
});

test('bulk: Stop while a worker waits for its turn sends nothing more', async () => {
  const e = bulkEnv('chatgpt', 4);
  e.ABCM.config.api.throttleMs = 120;
  let calls = 0;
  e.ABCM.apiEngine.run = async () => { calls += 1; if (calls === 1) e.ABCM.state.requestStop(); return { ok: true }; };
  const summary = await e.ABCM.bulk.run('DELETE');
  assert.equal(calls, 1);
  assert.equal(summary.stopped, true);
  assert.equal(summary.succeeded, 1);
  assert.equal(e.ABCM.state.selectedCount(), 3);
});

// ── Claude organisation ──────────────────────────────────────────────────────────────────────
test('claude: with several organisations the active one is used', async () => {
  const orgs = [{ uuid: 'org-a', capabilities: ['chat'] }, { uuid: 'org-b', capabilities: ['chat'] }];
  const e = setup('claude', (path) => (path === '/api/organizations' ? { status: 200, json: orgs } : { status: 204 }));
  e.document.cookie = 'lastActiveOrg=org-b';
  const outcome = await e.ABCM.apiEngine.run('DELETE', 'chat-1');
  assert.equal(outcome.ok, true);
  assert.equal(e.calls.at(-1).url, '/api/organizations/org-b/chat_conversations/chat-1');
});

test('claude: with several organisations and no active one nothing is sent', async () => {
  const orgs = [{ uuid: 'org-a', capabilities: ['chat'] }, { uuid: 'org-b', capabilities: ['chat'] }];
  const e = setup('claude', (path) => (path === '/api/organizations' ? { status: 200, json: orgs } : { status: 204 }));
  const outcome = await e.ABCM.apiEngine.run('DELETE', 'chat-1');
  assert.deepEqual(plain(outcome), { ok: false, reason: 'claude-no-org' });
  assert.ok(!e.calls.some((c) => c.method === 'DELETE'), 'no mutation was sent');
});

test('claude: an active organisation that is not in the account list is not trusted', async () => {
  const orgs = [{ uuid: 'org-a', capabilities: ['chat'] }, { uuid: 'org-b', capabilities: ['chat'] }];
  const e = setup('claude', (path) => (path === '/api/organizations' ? { status: 200, json: orgs } : { status: 204 }));
  e.document.cookie = 'lastActiveOrg=org-evil';
  assert.equal((await e.ABCM.apiEngine.run('DELETE', 'chat-1')).reason, 'claude-no-org');
});

// ── overlays ─────────────────────────────────────────────────────────────────────────────────
function menuPage({ stale = true, opens = 1 } = {}) {
  const e = setup('chatgpt', undefined, { count: 2 });
  e.hits = [];
  const mkMenu = (label) => {
    const menu = e.document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.dataset.label = label;
    const item = e.document.createElement('div');
    item.setAttribute('role', 'menuitem');
    item.textContent = 'Delete';
    item.addEventListener('click', () => e.hits.push(label));
    menu.append(item);
    return menu;
  };
  if (stale) e.document.body.append(mkMenu('stale'));
  const button = e.document.querySelector('li button');
  button.addEventListener('click', () => { for (let i = 0; i < opens; i += 1) e.document.body.append(mkMenu(`fresh-${i}`)); });
  e.ABCM.checkboxes.attachAll();
  return e;
}

test('menu: a stale open menu is ignored; the menu the click opened is used', async () => {
  const e = menuPage({ stale: true, opens: 1 });
  const opened = await e.ABCM.visualEngine.openMenu(e.ABCM.state.visible()[0], 'primary');
  assert.equal(opened.ok, true);
  assert.equal(opened.menu.dataset.label, 'fresh-0');
});

test('menu: when it is unclear which menu is ours, nothing is clicked', async () => {
  const e = menuPage({ stale: true, opens: 2 });
  const opened = await e.ABCM.visualEngine.openMenu(e.ABCM.state.visible()[0], 'primary');
  assert.equal(opened.ok, false);
  assert.equal(opened.reason, 'menu-not-opened');
  assert.deepEqual(e.hits, []);
});

test('dialog: two new dialogs that both offer Delete are refused; a stale one is ignored', async () => {
  const e = setup('chatgpt');
  const dialog = (label) => {
    const d = e.document.createElement('div');
    d.setAttribute('role', 'dialog');
    d.dataset.label = label;
    const b = e.document.createElement('button');
    b.textContent = 'Delete';
    d.append(b);
    e.document.body.append(d);
    return d;
  };
  const stale = dialog('stale');
  const before = new Set([stale]);
  dialog('one');
  assert.equal((await e.ABCM.visualEngine.findConfirmButton('DELETE', 50, 'primary', before)).dialog.dataset.label, 'one');
  dialog('two');
  assert.equal(await e.ABCM.visualEngine.findConfirmButton('DELETE', 50, 'primary', before), null);
});

// ── settings ─────────────────────────────────────────────────────────────────────────────────
test('settings: simultaneous saves of different fields both survive', async () => {
  const e = createEnv({ url: URLS.chatgpt, html: sidebarHtml('chatgpt', 1) });
  await Promise.all([e.ABCM.settings.save({ theme: 'dark' }), e.ABCM.settings.save({ accent: 'blue' }), e.ABCM.settings.save({ confirmThreshold: 7 })]);
  assert.deepEqual(plain(e.store.settings), { ...plain(e.ABCM.settings.DEFAULTS), theme: 'dark', accent: 'blue', confirmThreshold: 7 });
});

test('settings: the background writer answers, the page does not write on its own', async () => {
  const messages = { ABCM_SAVE_SETTINGS: (m) => ({ ok: true, settings: { theme: m.patch.theme } }) };
  const e = createEnv({ url: URLS.chatgpt, html: sidebarHtml('chatgpt', 1), chromeOptions: { messages } });
  const saved = await e.ABCM.settings.save({ theme: 'light' });
  assert.equal(saved.theme, 'light');
  assert.equal(e.ABCM.settings.get().theme, 'light');
  assert.equal(e.store.settings, undefined, 'only the writer touched storage');
});

test('settings: a slow worker fails the save and the page does not write on its own', async () => {
  const e = createEnv({ url: URLS.chatgpt, html: sidebarHtml('chatgpt', 1) });
  e.window.chrome.runtime.sendMessage = () => {}; // the reply never comes
  const realSetTimeout = e.window.setTimeout;
  e.window.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, ms >= 8000 ? 20 : ms, ...args);
  await assert.rejects(e.ABCM.settings.save({ theme: 'dark' }), /settings-save-timeout/);
  assert.equal(e.store.settings, undefined, 'no second, unsynchronized write');
});

test('settings: a worker that answers with an error fails the save', async () => {
  const messages = { ABCM_SAVE_SETTINGS: { ok: false, error: 'x' } };
  const e = createEnv({ url: URLS.chatgpt, html: sidebarHtml('chatgpt', 1), chromeOptions: { messages } });
  await assert.rejects(e.ABCM.settings.save({ theme: 'dark' }), /settings-save-failed/);
  assert.equal(e.store.settings, undefined);
});

// ── Load all ─────────────────────────────────────────────────────────────────────────────────
function recyclingList({ batches = 4, busy = false } = {}) {
  const e = createEnv({ url: URLS.chatgpt, html: sidebarHtml('chatgpt', 3) });
  const anchors = Array.from(e.document.querySelectorAll('li a'));
  const scroller = e.ABCM.loader.scrollerOf(anchors[0]);
  let top = 0;
  let loaded = 0;
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => top,
    set(value) {
      top = value;
      if (loaded >= batches) return;
      loaded += 1;
      // The site recycles its three row nodes for the next page of chats.
      anchors.forEach((a, i) => a.setAttribute('href', `/c/00000000-0000-4000-8000-${String(100 * loaded + i).padStart(12, '0')}`));
    }
  });
  if (busy) { const spinner = e.document.createElement('div'); spinner.setAttribute('aria-busy', 'true'); e.document.body.append(spinner); }
  return e;
}

test('Load all: a list that recycles its rows is not complete; seen and actionable are kept apart', async () => {
  const e = recyclingList({ batches: 4 });
  const result = await e.ABCM.loader.loadAll();
  assert.equal(result.total, 3 + 4 * 3, 'distinct chats seen');
  assert.equal(result.actionable, 3, 'rows that can be selected now');
  assert.equal(result.loaded, 12);
  assert.equal(result.status, 'recycled');
  assert.equal(result.complete, false);
});

test('Load all: a list that keeps its rows and reaches the end is complete', async () => {
  const e = createEnv({ url: URLS.chatgpt, html: sidebarHtml('chatgpt', 3) });
  const ol = e.document.querySelector('ol');
  const scroller = e.ABCM.loader.scrollerOf(e.document.querySelector('li a'));
  let top = 0;
  let batches = 0;
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => top,
    set(value) {
      top = value;
      if (batches >= 2) return;
      batches += 1;
      for (let i = 0; i < 3; i += 1) {
        const li = e.document.createElement('li');
        li.innerHTML = `<a href="/c/00000000-0000-4000-8000-${String(900 + batches * 10 + i).padStart(12, '0')}"><div>New</div></a>`;
        ol.append(li);
      }
    }
  });
  const result = await e.ABCM.loader.loadAll();
  assert.equal(result.total, 9);
  assert.equal(result.actionable, 9);
  assert.equal(result.status, 'complete');
});

test('Load all: a list that is still loading is reported as stalled, not complete', async () => {
  const e = recyclingList({ batches: 1, busy: true });
  const result = await e.ABCM.loader.loadAll();
  assert.equal(result.status, 'stalled');
  assert.equal(result.complete, false);
});
