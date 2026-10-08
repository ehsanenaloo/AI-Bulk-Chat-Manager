import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, sidebarHtml } from '../helpers/dom.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value));

const URLS = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/', gemini: 'https://gemini.google.com/app', grok: 'https://grok.com/' };

function setup(site, handler, { count = 4, storage = {} } = {}) {
  const e = createEnv({ url: URLS[site], html: sidebarHtml(site, count), chromeOptions: { storage } });
  const calls = [];
  e.window.fetch = async (url, init = {}) => {
    calls.push({ url: new URL(String(url)).pathname, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    const out = await handler(new URL(String(url)).pathname, init, calls);
    return { ok: out.status >= 200 && out.status < 300, status: out.status, json: async () => out.json ?? {} };
  };
  e.calls = calls;
  return e;
}

test('chatgpt API: tries the cookie, gets a bearer token on 401, then retries once', async () => {
  const e = setup('chatgpt', (url, init, calls) => {
    if (url === '/api/auth/session') return { status: 200, json: { accessToken: 'tok' } };
    if (init.headers?.Authorization === 'Bearer tok') return { status: 200 };
    return { status: 401 };
  });
  const result = await e.ABCM.apiEngine.run('DELETE', 'abc');
  assert.equal(result.ok, true);
  assert.deepEqual(e.calls.map((c) => `${c.method} ${c.url}`), ['PATCH /backend-api/conversation/abc', 'GET /api/auth/session', 'PATCH /backend-api/conversation/abc']);
  assert.equal(e.calls[2].body, '{"is_visible":false}');

  const archived = await e.ABCM.apiEngine.run('ARCHIVE', 'xyz');
  assert.equal(archived.ok, true);
  assert.equal(e.calls.at(-1).body, '{"is_archived":true}');
});

test('chatgpt API: error mapping and id encoding', async () => {
  let status = 500;
  const e = setup('chatgpt', (url) => (url === '/api/auth/session' ? { status: 200, json: {} } : { status }));
  assert.deepEqual(plain(await e.ABCM.apiEngine.run('DELETE', 'a')), { ok: false, reason: 'api-http-500' });
  status = 429;
  assert.equal((await e.ABCM.apiEngine.run('DELETE', 'a')).reason, 'api-rate-limited');
  status = 401;
  assert.equal((await e.ABCM.apiEngine.run('DELETE', 'a')).reason, 'api-auth-failed', 'no token available');
  assert.equal((await e.ABCM.apiEngine.run('DELETE', '')).reason, 'conversation-id-missing');
  await e.ABCM.apiEngine.run('DELETE', 'a/../b');
  assert.ok(e.calls.filter((c) => c.method === 'PATCH').at(-1).url.endsWith('a%2F..%2Fb'), 'the id cannot change the path');
});

test('claude API: finds the organization, refreshes it once when stale, never archives', async () => {
  let orgs = [{ uuid: 'org-old', capabilities: ['chat'] }];
  const e = setup('claude', (url, init) => {
    if (url === '/api/organizations') return { status: 200, json: orgs };
    if (url.includes('/org-old/')) return { status: 404 };
    if (url.includes('/org-new/')) return { status: 204 };
    return { status: 500 };
  });
  e.window.chrome.storage.local.set({}, () => {});
  const first = await e.ABCM.apiEngine.run('DELETE', 'c1'); // org-old answers 404; refresh happens; list unchanged → fails
  assert.equal(first.ok, false);
  orgs = [{ uuid: 'org-new', capabilities: ['chat'] }];
  const second = await e.ABCM.apiEngine.run('DELETE', 'c2');
  assert.equal(second.ok, true);
  assert.equal((await e.ABCM.apiEngine.run('ARCHIVE', 'c3')).reason, 'archive-unsupported');
  const noOrg = setup('claude', () => ({ status: 403 }));
  assert.equal((await noOrg.ABCM.apiEngine.run('DELETE', 'x')).reason, 'claude-no-org');
});

test('grok API: 404 stops further API use for the session', async () => {
  const e = setup('grok', () => ({ status: 404 }));
  await e.ABCM.settings.load();
  assert.equal(e.ABCM.apiEngine.isEnabled(), true);
  assert.equal((await e.ABCM.apiEngine.run('DELETE', 'g1')).reason, 'api-http-404');
  assert.equal(e.ABCM.apiEngine.isEnabled(), false);
});

test('API is enabled only where it makes sense and the setting allows it', async () => {
  for (const [site, expected] of [['chatgpt', true], ['claude', true], ['grok', true], ['gemini', false]]) {
    const e = setup(site, () => ({ status: 200 }));
    await e.ABCM.settings.load();
    assert.equal(e.ABCM.apiEngine.isEnabled(), expected, site);
  }
  const off = setup('chatgpt', () => ({ status: 200 }), { storage: { settings: { fastMode: false } } });
  await off.ABCM.settings.load();
  assert.equal(off.ABCM.apiEngine.isEnabled(), false);
});

// ── bulk engine, with the page-UI layer replaced so only the orchestration is under test ───────
function bulkEnv(site, count, { api = true } = {}) {
  const e = setup(site, () => ({ status: 200 }), { count });
  e.ABCM.checkboxes.attachAll();
  e.ABCM.state.selectVisible();
  e.ABCM.config.api.throttleMs = 0;
  e.ABCM.config.delays = { short: 0, medium: 0, long: 0, extended: 0 };
  e.ABCM.apiEngine.isEnabled = () => api;
  e.ABCM.apiEngine.prepare = async () => {};
  e.log = [];
  return e;
}

test('bulk: API phase succeeds for everyone, no page-UI fallback, deleted chats leave the registry', async () => {
  const e = bulkEnv('chatgpt', 5);
  e.ABCM.apiEngine.run = async (op, id) => { e.log.push(`${op}:${id.slice(-2)}`); return { ok: true }; };
  e.ABCM.visualEngine.attempt = async () => { throw new Error('page UI must not be used'); };
  const progress = [];
  const summary = await e.ABCM.bulk.run('DELETE', { onProgress: (p) => progress.push(p.done) });
  assert.equal(summary.succeeded, 5);
  assert.equal(summary.failures.length, 0);
  assert.equal(summary.stopped, false);
  assert.equal(summary.concurrency, 3);
  assert.equal(e.log.length, 5);
  assert.equal(e.ABCM.state.selectedCount(), 0);
  assert.equal(e.ABCM.state.visible().length, 0, 'rows were retired');
  assert.equal(progress.at(-1), 5);
  assert.equal(e.ABCM.state.status, 'ready', 'status restored after the run');
});

test('bulk: an API failure falls back to the page UI for that chat only', async () => {
  const e = bulkEnv('chatgpt', 4);
  const bad = e.ABCM.state.visible()[1].id;
  e.ABCM.apiEngine.run = async (op, id) => (id === bad ? { ok: false, reason: 'api-http-500' } : { ok: true });
  const viaUi = [];
  e.ABCM.visualEngine.attempt = async (op, record) => { viaUi.push(record.id); return { ok: true }; };
  const summary = await e.ABCM.bulk.run('DELETE');
  assert.deepEqual(viaUi, [bad]);
  assert.equal(summary.succeeded, 4);
  assert.equal(e.ABCM.state.diagnostics.apiFallbacks, 1);
});

test('bulk: failures keep the chat selected and carry a reason; a retry succeeds', async () => {
  const e = bulkEnv('claude', 3, { api: false });
  const target = e.ABCM.state.visible()[2].id;
  let broken = true;
  e.ABCM.visualEngine.attempt = async (op, record) => (record.id === target && broken ? { ok: false, reason: 'menu-not-opened' } : { ok: true });
  const first = await e.ABCM.bulk.run('DELETE');
  assert.equal(first.succeeded, 2);
  assert.deepEqual(plain(first.failures.map((f) => [f.id, f.reason])), [[target, 'menu-not-opened']]);
  assert.deepEqual(plain(e.ABCM.state.selectedItems().map((i) => i.id)), [target], 'only the failed chat is still selected');
  assert.equal(e.ABCM.state.diagnostics.failures['menu-not-opened'], 1);
  assert.equal(e.ABCM.state.diagnostics.retries, 2, 'three strategies were tried, so two retries');
  broken = false;
  const second = await e.ABCM.bulk.run('DELETE');
  assert.equal(second.succeeded, 1);
  assert.equal(e.ABCM.state.selectedCount(), 0);
});

test('bulk: Stop starts no further chats and leaves them selected', async () => {
  const e = bulkEnv('gemini', 6, { api: false });
  let n = 0;
  e.ABCM.visualEngine.geminiDelete = async () => { n += 1; if (n === 2) e.ABCM.state.requestStop(); return { ok: true }; };
  const summary = await e.ABCM.bulk.run('DELETE');
  assert.equal(summary.stopped, true);
  assert.equal(summary.succeeded, 2);
  assert.equal(e.ABCM.state.selectedCount(), 4);
  assert.equal(e.ABCM.state.stopRequested, false, 'the stop flag is cleared for the next run');
});

test('bulk: a chat unticked before its turn is skipped, and a vanished chat is reported', async () => {
  const e = bulkEnv('claude', 3, { api: false });
  const ids = e.ABCM.state.visible().map((r) => r.id);
  const attempted = [];
  e.ABCM.visualEngine.attempt = async (op, record) => {
    attempted.push(record.id);
    if (record.id === ids[0]) record.checkbox.checked = false; // the user unticks the next chat while the first is running
    if (record.id === ids[0]) e.ABCM.state.get(ids[1]).checkbox.checked = false;
    return { ok: true };
  };
  const summary = await e.ABCM.bulk.run('DELETE');
  assert.ok(!attempted.includes(ids[1]));
  assert.ok(summary.failures.some((f) => f.id === ids[1] && f.reason === 'selection-cleared'));
  assert.equal(summary.succeeded, 2);
});

test('bulk: rate limit pauses every worker once, then retries the chat', async () => {
  const e = bulkEnv('chatgpt', 2);
  e.ABCM.config.api.rateLimitBackoffMs = 5;
  let first = true;
  e.ABCM.apiEngine.run = async () => { if (first) { first = false; return { ok: false, reason: 'api-rate-limited' }; } return { ok: true }; };
  e.ABCM.visualEngine.attempt = async () => { throw new Error('should not fall back after a successful retry'); };
  const summary = await e.ABCM.bulk.run('DELETE');
  assert.equal(summary.succeeded, 2);
});

test('bulk: with nothing selected nothing happens', async () => {
  const e = bulkEnv('chatgpt', 3);
  e.ABCM.state.clearSelection();
  const summary = await e.ABCM.bulk.run('DELETE');
  assert.deepEqual(plain([summary.total, summary.succeeded, summary.failures.length]), [0, 0, 0]);
});

test('API calls always go to the page origin, even if a <base href> points elsewhere', async () => {
  const e = setup('chatgpt', () => ({ status: 200 }));
  const origins = [];
  const inner = e.window.fetch;
  e.window.fetch = (url, init) => { origins.push(new URL(String(url)).origin); return inner(url, init); };
  e.document.head.innerHTML = '<base href="https://evil.test/">';
  await e.ABCM.apiEngine.run('DELETE', 'abc');
  assert.ok(origins.length > 0);
  assert.deepEqual([...new Set(origins)], ['https://chatgpt.com']);
});
