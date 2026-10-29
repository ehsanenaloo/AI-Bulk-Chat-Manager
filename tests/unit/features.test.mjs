import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, sidebarHtml } from '../helpers/dom.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value));
const URLS = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/' };

function bulkEnv(site, count) {
  const e = createEnv({ url: URLS[site], html: sidebarHtml(site, count) });
  e.ABCM.checkboxes.attachAll();
  e.ABCM.state.selectVisible();
  Object.assign(e.ABCM.config.api, { throttleMs: 0, concurrency: 1 });
  e.ABCM.config.delays = { short: 0, medium: 0, long: 0, extended: 0 };
  e.ABCM.apiEngine.isEnabled = () => true;
  e.ABCM.apiEngine.prepare = async () => {};
  return e;
}

// ── run report ───────────────────────────────────────────────────────────────────────────────
test('run report: every chat appears once with its state and reason', async () => {
  const e = bulkEnv('chatgpt', 4);
  const [a, b, c] = e.ABCM.state.visible().map((r) => r.id);
  e.ABCM.apiEngine.run = async (op, id) => (id === a ? { ok: false, unknown: true, reason: 'api-timeout' } : id === b ? { ok: false, reason: 'api-http-400' } : id === c ? { ok: true } : { ok: true });
  e.ABCM.visualEngine.attempt = async () => ({ ok: false, reason: 'menu-not-opened' });
  const summary = await e.ABCM.bulk.run('DELETE');
  const byId = Object.fromEntries(summary.items.map((item) => [item.id, item]));
  assert.equal(summary.items.length, 4);
  assert.equal(byId[a].status, 'unknown');
  assert.equal(byId[a].reason, 'api-timeout');
  assert.equal(byId[b].status, 'failed');
  assert.equal(byId[c].status, 'succeeded');
  assert.equal(byId[c].reason, '');
  assert.ok(byId[a].url.startsWith('https://chatgpt.com/c/'));
});

test('run report: chats Stop kept from being touched are listed as cancelled', async () => {
  const e = bulkEnv('chatgpt', 3);
  let calls = 0;
  e.ABCM.apiEngine.run = async () => { calls += 1; e.ABCM.state.requestStop(); return { ok: true }; };
  const summary = await e.ABCM.bulk.run('DELETE');
  assert.equal(summary.stopped, true);
  assert.deepEqual(plain(summary.items.map((item) => item.status).sort()), ['cancelled', 'cancelled', 'succeeded']);
  assert.equal(calls, 1);
});

test('report files: JSON counts and CSV neutralizes formulas', () => {
  const { exporter } = createEnv({ url: URLS.chatgpt, html: sidebarHtml('chatgpt', 1) }).ABCM;
  const summary = { operation: 'DELETE', items: [
    { id: '1', title: '=HYPERLINK("x")', url: 'https://chatgpt.com/c/1', status: 'succeeded', reason: '' },
    { id: '2', title: 'B', url: 'https://chatgpt.com/c/2', status: 'unknown', reason: 'api-timeout' }
  ] };
  const json = JSON.parse(exporter.buildReport('json', summary, { siteName: 'ChatGPT', exportedAt: new Date(0) }));
  assert.deepEqual(plain(json.counts), { succeeded: 1, failed: 0, unknown: 1, cancelled: 0 });
  assert.equal(json.operation, 'DELETE');
  assert.equal(json.chats[1].reason, 'api-timeout');
  const csv = exporter.buildReport('csv', summary);
  assert.ok(csv.includes("\"'=HYPERLINK(\"\"x\"\")\""), 'formula prefix is neutralized');
  assert.ok(csv.split('\r\n')[0].endsWith('title,url,id,status,reason,evidence,observation,observed_at'));
  assert.throws(() => exporter.buildReport('md', summary));
});

// ── check again: observations, never manufactured success ───────────────────────────────────
/** Runs a delete where the first chat times out and the others succeed; returns the env, the summary and the timed-out id. */
async function runWithTimeout(site = 'chatgpt', count = 3) {
  const e = bulkEnv(site, count);
  const ids = e.ABCM.state.visible().map((r) => r.id);
  e.ABCM.apiEngine.run = async (op, id) => (id === ids[0] ? { ok: false, unknown: true, reason: 'api-timeout' } : { ok: true, verified: true, via: 'api' });
  const summary = await e.ABCM.bulk.run('DELETE');
  return { e, summary, ids };
}
const itemOf = (summary, id) => summary.items.find((item) => item.id === id);
const removeRow = (e, id) => e.document.querySelector('[data-abcm-id="' + id + '"]').closest('li').remove();

test('check again: an API-confirmed deletion is completed with API evidence', async () => {
  const { summary, ids } = await runWithTimeout();
  assert.equal(itemOf(summary, ids[1]).status, 'succeeded');
  assert.equal(itemOf(summary, ids[1]).evidence, 'api');
  assert.equal(itemOf(summary, ids[0]).evidence, '');
});

test('check again: a timeout followed by a missing row is no-longer-listed, not a success', async () => {
  const { e, summary, ids } = await runWithTimeout();
  const succeededBefore = summary.succeeded;
  removeRow(e, ids[0]);
  e.ABCM.bulk.applyObservations(summary, e.ABCM.bulk.recheck(summary.unknown));
  const item = itemOf(summary, ids[0]);
  assert.equal(item.status, 'unknown');
  assert.equal(item.reason, 'api-timeout');
  assert.equal(item.observation.result, 'no-longer-listed');
  assert.equal(item.observation.basis, 'page-list');
  assert.equal(summary.succeeded, succeededBefore);
  assert.deepEqual(plain(summary.observed), { 'no-longer-listed': 1, 'still-listed': 0, 'not-confirmed': 0 });
});

test('check again: a timeout followed by a visible row is still-listed and nothing is selected or sent', async () => {
  const { e, summary, ids } = await runWithTimeout();
  assert.equal(e.ABCM.state.isSelected(ids[0]), false);
  let sent = 0;
  e.window.fetch = async () => { sent += 1; return { ok: true, status: 200 }; };
  const selectedBefore = plain(e.ABCM.state.selectedItems().map((i) => i.id));
  e.ABCM.bulk.applyObservations(summary, e.ABCM.bulk.recheck(summary.unknown));
  assert.equal(itemOf(summary, ids[0]).observation.result, 'still-listed');
  assert.equal(e.ABCM.state.isSelected(ids[0]), false);
  assert.deepEqual(plain(e.ABCM.state.selectedItems().map((i) => i.id)), selectedBefore);
  assert.equal(sent, 0);
});

test('check again: a list that cannot be trusted gives not-confirmed', async () => {
  for (const status of ['recycled', 'stalled', 'stopped', 'limit']) {
    const { e, summary, ids } = await runWithTimeout();
    removeRow(e, ids[0]);
    e.ABCM.state.listing = { status, at: Date.now() };
    e.ABCM.bulk.applyObservations(summary, e.ABCM.bulk.recheck(summary.unknown));
    assert.equal(itemOf(summary, ids[0]).observation.result, 'not-confirmed', status);
    assert.equal(itemOf(summary, ids[0]).observation.basis, 'list-' + status);
  }
  const { e, summary, ids } = await runWithTimeout('chatgpt', 1);
  removeRow(e, ids[0]);
  assert.equal(e.ABCM.dom.getAllConversations().length, 0);
  e.ABCM.bulk.applyObservations(summary, e.ABCM.bulk.recheck(summary.unknown));
  assert.equal(itemOf(summary, ids[0]).observation.result, 'not-confirmed');
  assert.equal(itemOf(summary, ids[0]).observation.basis, 'list-empty');
});

test('check again: a complete Load all keeps the list trusted', async () => {
  const { e, summary, ids } = await runWithTimeout();
  e.ABCM.state.listing = { status: 'complete', at: Date.now() };
  removeRow(e, ids[0]);
  e.ABCM.bulk.applyObservations(summary, e.ABCM.bulk.recheck(summary.unknown));
  assert.equal(itemOf(summary, ids[0]).observation.result, 'no-longer-listed');
});

test('check again: repeated checks do not double count and keep the original context', async () => {
  const { e, summary, ids } = await runWithTimeout('chatgpt', 4);
  const total = summary.items.filter((item) => item.status === 'unknown').length;
  for (let i = 0; i < 3; i += 1) e.ABCM.bulk.applyObservations(summary, e.ABCM.bulk.recheck(summary.unknown));
  const counts = summary.observed;
  assert.equal(Object.values(counts).reduce((x, y) => x + y, 0), total);
  assert.equal(itemOf(summary, ids[0]).observation.checks, 3);
  assert.equal(itemOf(summary, ids[0]).reason, 'api-timeout');
  assert.equal(summary.succeeded, 3);
  removeRow(e, ids[0]);
  e.ABCM.bulk.applyObservations(summary, e.ABCM.bulk.recheck(summary.unknown));
  assert.equal(itemOf(summary, ids[0]).observation.checks, 4);
  assert.deepEqual(plain(summary.observed), { 'no-longer-listed': 1, 'still-listed': 0, 'not-confirmed': 0 });
});

test('check again: a retired (hidden) row does not count as still listed', () => {
  const e = bulkEnv('chatgpt', 3);
  const [a] = e.ABCM.state.visible().map((r) => r.id);
  e.document.querySelector('[data-abcm-id="' + a + '"]').closest('li').setAttribute('data-abcm-retired', '1');
  const [observation] = e.ABCM.bulk.recheck([{ id: a, title: 'A' }]);
  assert.equal(observation.result, 'no-longer-listed');
});

// ── undo archive ─────────────────────────────────────────────────────────────────────────────
test('undo archive: ChatGPT chats are put back with is_archived false', async () => {
  const e = bulkEnv('chatgpt', 2);
  e.ABCM.apiEngine.isEnabled = () => true;
  const sent = [];
  e.window.fetch = async (url, init = {}) => { sent.push({ path: new URL(String(url)).pathname, method: init.method, body: init.body }); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }; };
  const result = await e.ABCM.bulk.undoArchive(['x1', 'x2']);
  assert.deepEqual(plain(result), { restored: ['x1', 'x2'], failed: [] });
  assert.deepEqual(plain(sent.map((s) => [s.method, s.path, s.body])), [
    ['PATCH', '/backend-api/conversation/x1', '{"is_archived":false}'],
    ['PATCH', '/backend-api/conversation/x2', '{"is_archived":false}']
  ]);
});

test('undo archive: a failed restore is reported, and other sites offer no undo', async () => {
  const e = bulkEnv('chatgpt', 1);
  e.window.fetch = async () => ({ ok: false, status: 400, headers: { get: () => null }, json: async () => ({}) });
  assert.deepEqual(plain(await e.ABCM.bulk.undoArchive(['x1'])), { restored: [], failed: ['x1'] });
  const claude = bulkEnv('claude', 1);
  assert.equal(claude.ABCM.apiEngine.canUndoArchive(), false);
  assert.deepEqual(plain(await claude.ABCM.bulk.undoArchive(['x1'])), { restored: [], failed: ['x1'] });
});

test('report files: observations stay beside the original status and agree with the counters', async () => {
  const { e, summary, ids } = await runWithTimeout('chatgpt', 4);
  removeRow(e, ids[0]);
  e.ABCM.bulk.applyObservations(summary, e.ABCM.bulk.recheck(summary.unknown));
  const json = JSON.parse(e.ABCM.exporter.buildReport('json', summary, { siteName: 'ChatGPT', exportedAt: new Date(0) }));
  assert.deepEqual(plain(json.counts), { succeeded: 3, failed: 0, unknown: 1, cancelled: 0 });
  assert.deepEqual(plain(json.observed), plain(summary.observed));
  const row = json.chats.find((chat) => chat.id === ids[0]);
  assert.equal(row.status, 'unknown');
  assert.equal(row.reason, 'api-timeout');
  assert.equal(row.observation, 'no-longer-listed');
  assert.equal(row.checks, 1);
  assert.equal(json.chats.find((chat) => chat.id === ids[1]).evidence, 'api');
  const csv = e.ABCM.exporter.buildReport('csv', summary).split('\r\n');
  const line = csv.find((l) => l.includes(ids[0]));
  assert.ok(line.includes('"unknown","api-timeout","","no-longer-listed",'), line);
});
