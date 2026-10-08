// Real-Firefox checks for the Firefox build of AI Bulk Chat Manager.
//
// Starts the installed desktop Firefox headless with a throwaway profile under os.tmpdir(), installs the
// package built by scripts/build-firefox.mjs as a temporary add-on, and answers https://chatgpt.com/,
// https://claude.ai/, https://gemini.google.com/ and https://grok.com/ with the fake chat sites from
// tests/fixtures/mock-site.mjs through WebDriver BiDi request interception. Nothing leaves the machine
// and your own Firefox profile is never opened.
//
// Run:   node tests/e2e/firefox.mjs [--require] [--only=<regex on check id or name>]
//   --require   fail instead of skipping when Firefox is not installed
// Env:   FIREFOX_BIN         Firefox executable (default: the standard install path, or "firefox" on PATH)
//        FIREFOX_SHOTS_DIR   keep screenshots in this folder
//        EXTENSION_DIR       extension source folder to build the Firefox package from (default: extension/)
//        FIREFOX_PACKAGE_DIR install this prebuilt package folder instead of building one
// Exit status is non-zero when any check fails. See tests/e2e/README.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildFirefox, FIREFOX_ADDON_ID } from '../../scripts/build-firefox.mjs';
import { launchFirefox, firefoxInstalled, FIREFOX_BIN, EXT_ORIGIN, sleep } from '../helpers/firefox.mjs';
import { makeChats } from '../fixtures/mock-site.mjs';
import { extensionDir } from '../helpers/paths.mjs';

const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const only = onlyArg ? new RegExp(onlyArg.slice(7), 'i') : null;

if (!firefoxInstalled()) {
  const message = `Firefox was not found (looked for "${FIREFOX_BIN}"). Install desktop Firefox 140 or newer, or set FIREFOX_BIN to its path (see tests/e2e/README.md).`;
  if (process.argv.includes('--require')) { console.error(`Firefox checks cannot run: ${message}`); process.exit(1); }
  console.log(`Firefox checks skipped. ${message}`);
  process.exit(0);
}

const START_URL = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/', gemini: 'https://gemini.google.com/app', grok: 'https://grok.com/' };
const MATCH = { chatgpt: 'https://chatgpt.com/*', claude: 'https://claude.ai/*', gemini: 'https://gemini.google.com/*', grok: 'https://grok.com/*' };
const SITES = Object.keys(START_URL);
const IDLE_TIMEOUT_MS = 8000; // extensions.background.idle.timeout, lowered so the event page really suspends
const shotsDir = process.env.FIREFOX_SHOTS_DIR ? path.resolve(process.env.FIREFOX_SHOTS_DIR) : null;

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abcm-firefox-work-'));
const downloadDir = path.join(workDir, 'downloads');
fs.mkdirSync(downloadDir);

let session; // the Firefox session
let util;    // an extension page kept open to run chrome.* calls "as the extension"

// ─── helpers ──────────────────────────────────────────────────────────────────────────────────
// Runs inside the page: finds an element (optionally inside the panel's shadow root) and returns where to click.
const locate = ({ shadow, css, text, index = 0, scroll = true }) => {
  const root = shadow ? document.querySelector('[data-abcm-root]')?.shadowRoot : document;
  if (!root) return false;
  const re = text ? new RegExp(text, 'i') : null;
  const found = [...root.querySelectorAll(css)].filter((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    return !re || re.test(`${el.textContent} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''}`);
  });
  const el = found[index];
  if (!el) return false;
  if (scroll) el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!el.disabled };
};

/** Clicks an element with a real (native) mouse click once its position has stopped moving (dialogs slide in). */
async function click(page, spec) {
  let point = await page.waitFor(locate, spec, { label: `click target ${JSON.stringify(spec)}` });
  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(60);
    const again = await page.waitFor(locate, spec, { label: `click target ${JSON.stringify(spec)}` });
    const settled = Math.abs(again.x - point.x) < 0.5 && Math.abs(again.y - point.y) < 0.5;
    point = again;
    if (settled) break;
  }
  await page.clickAt(point, { modifiers: spec.modifiers || [] });
}

async function focus(page, spec) {
  await page.waitFor(locate, { ...spec, scroll: false }, { label: `focus target ${JSON.stringify(spec)}` });
  await page.ev(({ shadow, css, index = 0 }) => {
    const root = shadow ? document.querySelector('[data-abcm-root]').shadowRoot : document;
    const el = root.querySelectorAll(css)[index];
    el.focus();
    if (el.select) el.select();
    return true;
  }, spec);
}

/** Focuses a text field and replaces its content with real key events. */
async function fill(page, spec, text) {
  await focus(page, spec);
  await page.press('Control', 'a');
  await page.press('Backspace');
  if (text) await page.type(text);
  await page.waitFor(({ shadow, css, index = 0, text }) => (shadow ? document.querySelector('[data-abcm-root]').shadowRoot : document).querySelectorAll(css)[index]?.value === text, { ...spec, text }, { timeout: 10000, label: 'typed text arrived in the field' });
}

const shadowText = (page, css, index = 0) => page.ev(({ css, index }) => document.querySelector('[data-abcm-root]')?.shadowRoot?.querySelectorAll(css)[index]?.textContent ?? null, { css, index });

/** Sends a message to the content script of the chat tab, from the extension page (what the popup and worker do). */
async function tabMessage(site, message) {
  return util.ev(({ match, message }) => new Promise((resolve, reject) => {
    chrome.tabs.query({ url: match }, (tabs) => {
      if (!tabs.length) return reject(new Error(`no tab for ${match}`));
      chrome.tabs.sendMessage(tabs[0].id, message, (reply) => resolve(reply ?? { error: chrome.runtime.lastError?.message }));
    });
  }), { match: MATCH[site], message });
}

const storageSet = (items) => util.ev((items) => new Promise((resolve) => chrome.storage.local.set(items, resolve)), items);
const storageGet = (keys) => util.ev((keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve)), keys);
const storageClear = () => util.ev(() => new Promise((resolve) => chrome.storage.local.clear(resolve)));

/**
 * Waits until the content script has finished booting. It starts at document_idle, after the fake
 * page's own scripts, and answers pings (the bridge) before it has loaded settings and the language,
 * so a ping alone is not enough: a panel opened in between would come up with default settings.
 * scripting.executeScript with func runs in the content scripts' own sandbox, where ABCM lives.
 */
async function contentReady(site, settings) {
  const probe = () => util.ev((match) => new Promise((resolve) => chrome.tabs.query({ url: match }, (tabs) => {
    if (!tabs.length) return resolve(null);
    chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: () => (globalThis.ABCM?.i18n ? { loaded: ABCM.i18n.t('panel.title') !== 'panel.title', settings: ABCM.settings.get() } : null) }, (results) => resolve(results?.[0]?.result ?? null));
  })), MATCH[site]).catch(() => null);
  const deadline = Date.now() + 20000;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last?.loaded && Object.entries(settings || {}).every(([key, value]) => JSON.stringify(last.settings[key]) === JSON.stringify(value))) return;
    await sleep(100);
  }
  throw new Error(`content script never finished booting on ${site}: ${JSON.stringify(last)}`);
}

/** Serves a fake site, opens it and returns a small driver for the panel. */
async function openSite(site, { chats = makeChats(12), settings = null, failIds = [], rateLimitOnce = false, dir = 'ltr', csp = '' } = {}) {
  const server = await session.serveSite(site, { chats, failIds, rateLimitOnce, dir, csp });
  await storageClear();
  if (settings) await storageSet({ settings });
  const mark = session.errors.length;
  const page = await session.newPage();
  await page.goto(START_URL[site]);
  await page.waitFor(() => document.querySelectorAll('[data-list] .row').length > 0, null, { label: 'fake site rows' });
  await contentReady(site, settings);
  const ui = {
    site, server, page,
    problems: () => session.errors.slice(mark),
    async start() {
      const reply = await tabMessage(site, { type: 'ABCM_START' });
      if (!reply?.ok) throw new Error(`ABCM_START failed: ${JSON.stringify(reply)}`);
      await page.waitFor(() => { const p = document.querySelector('[data-abcm-root]')?.shadowRoot?.querySelector('.panel'); return p && !p.hidden && p.getBoundingClientRect().width > 0; }, null, { label: 'panel visible' });
      return reply;
    },
    stop: () => tabMessage(site, { type: 'ABCM_STOP' }),
    clickBtn: (name, extra = {}) => click(page, { shadow: true, css: 'button', text: name, ...extra }),
    checkbox: (n) => ({ css: '[data-abcm-checkbox]', index: n }),
    clickCheckbox: (n, extra = {}) => click(page, { css: '[data-abcm-checkbox]', index: n, ...extra }),
    isChecked: (n) => page.ev((n) => document.querySelectorAll('[data-abcm-checkbox]')[n].checked, n),
    selectedCount: async () => Number((await shadowText(page, '.count-num') || '0').replace(/\D/g, '')),
    async confirmDelete(name = 'Delete \\d+ chat') {
      await page.waitFor(() => document.querySelector('[data-abcm-root]')?.shadowRoot?.querySelector('[role="alertdialog"]'), null, { label: 'confirm dialog' });
      await click(page, { shadow: true, css: '[role="alertdialog"] button', text: name });
    },
    async waitForResult() {
      await page.waitFor(() => document.querySelector('[data-abcm-root]')?.shadowRoot?.querySelector('.result-head')?.getBoundingClientRect().width > 0, null, { timeout: 60000, label: 'result view' });
      return (await shadowText(page, '.result-head .run-title')).trim();
    },
    rowCount: () => page.ev(() => document.querySelectorAll('[data-list] .row').length),
    async close() { await page.close(); }
  };
  return ui;
}

async function withSite(site, options, fn) {
  const ui = await openSite(site, options);
  try { return await fn(ui); } finally { await ui.close(); }
}

async function pick(ui, indexes) { for (const i of indexes) await ui.clickCheckbox(i); }
const idsOf = (chats, indexes) => new Set(indexes.map((i) => chats[i].id));

async function shot(page, name, size = { width: 1280, height: 800 }) {
  if (!shotsDir) return;
  await page.shot(path.join(shotsDir, `${name}.png`), { size });
}

// ─── checks ───────────────────────────────────────────────────────────────────────────────────
const checkDefs = [];
const check = (id, name, fn) => checkDefs.push({ id, name, fn });

check('F01', 'package as installed in Firefox: event-page manifest, gecko id, granted host permissions, no manifest warnings', async () => {
  const info = await util.ev(async () => ({
    manifest: chrome.runtime.getManifest(), id: chrome.runtime.id, perms: await chrome.permissions.getAll(),
    ua: navigator.userAgent, lang: chrome.i18n.getUILanguage(), name: chrome.i18n.getMessage('app_name')
  }));
  assert.equal(info.id, FIREFOX_ADDON_ID);
  assert.ok(Array.isArray(info.manifest.background.scripts) && info.manifest.background.scripts.at(-1).endsWith('background.js'), JSON.stringify(info.manifest.background));
  assert.ok(!info.manifest.background.service_worker, "Firefox has no service worker background");
  assert.equal(info.manifest.browser_specific_settings.gecko.id, FIREFOX_ADDON_ID);
  assert.deepEqual(info.manifest.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
  for (const host of Object.values(MATCH)) assert.ok(info.perms.origins.includes(host), `host permission ${host} not granted: ${JSON.stringify(info.perms.origins)}`);
  assert.deepEqual([...info.perms.permissions].sort(), ['activeTab', 'scripting', 'storage']);
  assert.equal(info.name, 'AI Bulk Chat Manager', 'manifest __MSG_ placeholders resolve');
  // Firefox's own verdict on the manifest, read from the browser (chrome context).
  await session.marionette.send('Marionette:SetContext', { value: 'chrome' });
  try {
    const { value } = await session.marionette.send('WebDriver:ExecuteScript', {
      script: 'const e = WebExtensionPolicy.getByID(arguments[0]).extension; return { warnings: e.warnings || [], errors: e.errors || [], state: e.backgroundState };',
      args: [FIREFOX_ADDON_ID]
    });
    assert.deepEqual(value.warnings, [], JSON.stringify(value.warnings));
    assert.deepEqual(value.errors, [], JSON.stringify(value.errors));
  } finally { await session.marionette.send('Marionette:SetContext', { value: 'content' }); }
  return { permissions: info.perms, ua: info.ua };
});

check('F02', 'content scripts run on all four fake sites and stay out of the page world', async () => {
  const out = {};
  for (const site of SITES) {
    await withSite(site, {}, async (ui) => {
      const reply = await tabMessage(site, { type: 'ABCM_PING' });
      assert.equal(reply.ok, true, `${site}: ${JSON.stringify(reply)}`);
      assert.equal(reply.ready, true);
      assert.equal(reply.site, site);
      assert.equal(reply.version, '9.0.0');
      assert.equal(reply.active, false);
      const world = await ui.page.ev(() => ({ abcm: typeof window.ABCM, chromeApi: typeof window.chrome?.runtime?.id, roots: document.querySelectorAll('[data-abcm-root]').length, boxes: document.querySelectorAll('[data-abcm-checkbox]').length }));
      assert.deepEqual(world, { abcm: 'undefined', chromeApi: 'undefined', roots: 0, boxes: 0 }, `${site}: nothing is added until selection starts`);
      assert.deepEqual(ui.problems(), []);
      out[site] = reply.status;
    });
  }
  return out;
});

check('F03', 'selection mode: panel is visible in its Shadow DOM and its styles are applied (adoptedStyleSheets or <style> fallback)', async () => {
  return withSite('chatgpt', {}, async (ui) => {
    const reply = await ui.start();
    assert.equal(reply.ok, true);
    assert.equal(reply.visible, 12);
    const info = await ui.page.ev(() => {
      const host = document.querySelector('[data-abcm-root]');
      const root = host.shadowRoot;
      const panel = root.querySelector('.panel');
      const css = getComputedStyle(panel);
      const rect = panel.getBoundingClientRect();
      const del = root.querySelector('.btn-delete');
      let adopted = null;
      try { adopted = root.adoptedStyleSheets.length; } catch (error) { adopted = `unreadable: ${error.message}`; }
      return {
        shadowMode: root ? 'open' : 'none', adopted, styleElements: root.querySelectorAll('style').length,
        position: css.position, background: css.backgroundColor, radius: css.borderTopLeftRadius, font: css.fontFamily.slice(0, 40),
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, viewport: { w: innerWidth, h: innerHeight },
        deleteBg: del ? getComputedStyle(del).backgroundColor : null, deleteDisabled: del?.disabled,
        title: root.querySelector('.head-title')?.textContent, theme: host.getAttribute('data-theme'), dir: host.getAttribute('dir')
      };
    });
    assert.equal(info.position, 'fixed', `panel CSS not applied: ${JSON.stringify(info)}`);
    assert.notEqual(info.background, 'rgba(0, 0, 0, 0)', 'panel has a background');
    assert.notEqual(info.radius, '0px', 'rounded corners from panel.css');
    assert.ok(info.rect.w > 200 && info.rect.w < 480, `panel width ${info.rect.w}`);
    assert.ok(info.rect.x + info.rect.w <= info.viewport.w && info.rect.y + info.rect.h <= info.viewport.h, 'panel inside the viewport');
    assert.ok(info.rect.x > info.viewport.w / 2, 'LTR panel sits at the right edge');
    assert.equal(info.title, 'AI Bulk Chat Manager');
    assert.equal(info.deleteDisabled, true, `Delete is disabled with nothing selected: ${JSON.stringify(info)}`);
    assert.equal(info.dir, 'ltr');
    await shot(ui.page, 'panel-light');
    // The page-level stylesheet (selected-row tint) is applied too.
    await ui.clickCheckbox(0);
    // The selected row (the row or its link, depending on the version) gets the tint from the page-level stylesheet.
    const tint = await ui.page.ev(() => { const el = document.querySelector('[data-list] [data-abcm-selected]'); return { selected: !!el, bg: el && getComputedStyle(el).backgroundColor, style: !!document.getElementById('abcm-page-style') }; });
    assert.equal(tint.selected, true, JSON.stringify(tint));
    assert.match(tint.bg, /rgba\(14, 124, 149, 0\.16\)/, `selected-row tint not applied: ${JSON.stringify(tint)}`);
    assert.deepEqual(ui.problems(), []);
    return { via: info.adopted > 0 ? 'adoptedStyleSheets' : info.styleElements ? '<style> fallback' : 'NONE', pageSheetVia: tint.style ? '<style> fallback' : 'adoptedStyleSheets', ...info };
  });
});

check('F04', 'checkboxes and counts with real mouse clicks: single, Select all, Clear, Invert, Shift range, row click, Finish', async () => {
  await withSite('claude', {}, async (ui) => {
    const before = await ui.page.ev(() => document.querySelector('[data-list] a').getAttribute('style'));
    await ui.start();
    assert.equal(await ui.page.ev(() => document.querySelectorAll('[data-abcm-checkbox]').length), 12);
    assert.match(await shadowText(ui.page, '.count-sub'), /of 12 chats shown/);
    await pick(ui, [0, 1]);
    assert.equal(await ui.selectedCount(), 2);
    await ui.clickBtn('^Invert');
    assert.equal(await ui.selectedCount(), 10);
    assert.equal(await ui.isChecked(0), false);
    assert.equal(await ui.isChecked(5), true);
    await ui.clickBtn('^Clear');
    assert.equal(await ui.selectedCount(), 0);
    await ui.clickBtn('Select all');
    assert.equal(await ui.selectedCount(), 12);
    await ui.clickBtn('^Clear');

    // A click on the row toggles it and does not open the chat; Shift-click selects a range.
    await click(ui.page, { css: '[data-list] .row a', index: 2 });
    assert.equal(await ui.selectedCount(), 1);
    assert.equal(await ui.page.ev(() => window.__navigated || 0), 0, 'the click did not reach the site');
    await ui.clickCheckbox(6, { modifiers: ['Shift'] });
    assert.equal(await ui.selectedCount(), 5, 'rows 3 to 7 are selected');
    assert.equal(await ui.isChecked(4), true);

    // Typing into a field inside the Shadow DOM works with real key events, and Enter applies it.
    await ui.clickBtn('^Clear');
    await click(ui.page, { shadow: true, css: 'summary' });
    await fill(ui.page, { shadow: true, css: 'input[type="text"]' }, 'notes 1');
    await ui.page.press('Enter');
    await ui.page.waitFor(async () => /^4/.test(document.querySelector('[data-abcm-root]').shadowRoot.querySelector('.count-num').textContent.trim()), null, { label: 'title filter selected 4' });

    await ui.clickBtn('Finish and close');
    await ui.page.waitFor(() => document.querySelectorAll('[data-abcm-checkbox]').length === 0 && !document.querySelector('[data-abcm-root]')?.shadowRoot?.querySelector('.panel:not([hidden])'), null, { label: 'selection mode ended' });
    const after = await ui.page.ev(() => document.querySelector('[data-list] a').getAttribute('style'));
    assert.equal(after || '', before || '', 'the row style is restored');
    assert.deepEqual(ui.problems(), []);
  });
});

check('F05', 'delete through the site API (fast mode): confirm dialog, fetch from the content script, exactly the chosen chats', async () => {
  const out = {};
  const plan = [
    ['chatgpt', 'PATCH /backend-api/conversation/', 'BODY {"is_visible":false}'],
    ['claude', 'DELETE /api/organizations/org-1/chat_conversations/', null],
    ['grok', 'DELETE /rest/app-chat/conversations/', null]
  ];
  for (const [site, route, body] of plan) {
    const chats = makeChats(8);
    await withSite(site, { chats }, async (ui) => {
      await ui.start();
      await pick(ui, [0, 2, 4]);
      await ui.clickBtn('Delete 3');
      const dialog = await ui.page.waitFor(() => { const d = document.querySelector('[data-abcm-root]')?.shadowRoot?.querySelector('[role="alertdialog"]'); return d ? d.textContent : false; }, null, { label: 'dialog' });
      assert.match(dialog, /Delete 3 chats\?/);
      assert.match(dialog, /can't be undone/);
      const cancelFocused = await ui.page.ev(() => { const root = document.querySelector('[data-abcm-root]').shadowRoot; return root.activeElement?.textContent.trim(); });
      assert.equal(cancelFocused, 'Cancel', 'the safe choice has focus, not the destructive button');
      await ui.confirmDelete();
      assert.equal(await ui.waitForResult(), '3 chats deleted');
      assert.deepEqual(new Set(ui.server.deleted), idsOf(chats, [0, 2, 4]), `${site}: only the chosen chats were deleted`);
      assert.ok(ui.server.requests.some((r) => r.startsWith(route)), `${site}: used ${route} (${ui.server.requests.join(' | ')})`);
      if (body) assert.ok(ui.server.requests.includes(body), `${site}: request body reached the server (${ui.server.requests.join(' | ')})`);
      assert.ok(!ui.server.requests.some((r) => r.includes('/__mock/delete')), 'did not drive the page menus');
      assert.equal(await ui.page.ev(() => [...document.querySelectorAll('[data-list] .row')].filter((r) => r.getBoundingClientRect().height > 0).length), 5, 'the rows are hidden, the rest untouched');
      assert.deepEqual(ui.problems(), []);
      out[site] = ui.server.requests.filter((r) => !r.startsWith('GET /__mock')).slice(0, 4);
    });
  }
  return out;
});

check('F06', 'archive through the API (ChatGPT only) sends is_archived and offers no Archive elsewhere', async () => {
  const chats = makeChats(5);
  await withSite('chatgpt', { chats }, async (ui) => {
    await ui.start();
    await pick(ui, [1, 3]);
    await click(ui.page, { shadow: true, css: '.footer button', text: '^Archive' });
    await click(ui.page, { shadow: true, css: '[role="alertdialog"] button', text: 'Archive 2 chats' });
    assert.equal(await ui.waitForResult(), '2 chats archived');
    assert.deepEqual(new Set(ui.server.archived), idsOf(chats, [1, 3]));
    assert.ok(ui.server.requests.includes('BODY {"is_archived":true}'));
  });
  await withSite('claude', {}, async (ui) => {
    await ui.start();
    assert.equal(await ui.page.ev(() => [...document.querySelector('[data-abcm-root]').shadowRoot.querySelectorAll('.footer button')].filter((b) => /^Archive/.test(b.textContent.trim()) && b.getBoundingClientRect().width > 0).length), 0);
  });
});

for (const site of SITES) {
  check(`F07-${site}`, `${site}: page-menu route (fast mode off) deletes the chosen chats and nothing else`, async () => {
    const chats = makeChats(6);
    await withSite(site, { chats, settings: { fastMode: false } }, async (ui) => {
      await ui.start();
      await pick(ui, [1, 4]);
      await ui.clickBtn('Delete 2');
      await ui.confirmDelete();
      assert.equal(await ui.waitForResult(), '2 chats deleted', `${site}: ${JSON.stringify(ui.server.requests)}`);
      assert.deepEqual(new Set(ui.server.deleted), idsOf(chats, [1, 4]));
      assert.ok(!ui.server.requests.some((r) => r.includes('/backend-api/') || r.includes('/chat_conversations/') || r.includes('/rest/app-chat/')), 'no API call was made');
      assert.equal(await ui.rowCount(), 4);
      assert.deepEqual(ui.problems(), []);
    });
  });
}

check('F08', 'failures are reported, stay selected and can be retried; a 429 pauses instead of failing; a large delete needs the acknowledgement', async () => {
  const chats = makeChats(5);
  await withSite('chatgpt', { chats, failIds: [chats[1].id] }, async (ui) => {
    await ui.start();
    await ui.clickBtn('Select all');
    await ui.clickBtn('Delete 5');
    await ui.confirmDelete();
    assert.equal(await ui.waitForResult(), '4 of 5 done, 1 failed');
    assert.match(await shadowText(ui.page, '.fail-list'), /Project notes 2/);
    ui.server.failIds.clear();
    await ui.clickBtn('Retry failed');
    await ui.confirmDelete(/Delete 1 chat/.source);
    assert.equal(await ui.waitForResult(), '1 chat deleted');
    assert.equal(ui.server.deleted.length, 5);
  });
  await withSite('chatgpt', { chats: makeChats(3), rateLimitOnce: true }, async (ui) => {
    await ui.start();
    await ui.clickBtn('Select all');
    await ui.clickBtn('Delete 3');
    await ui.confirmDelete();
    assert.equal(await ui.waitForResult(), '3 chats deleted');
  });
  await withSite('chatgpt', { chats: makeChats(25) }, async (ui) => {
    await ui.start();
    await ui.clickBtn('Select all');
    await ui.clickBtn('Delete 25');
    await ui.page.waitFor(() => document.querySelector('[data-abcm-root]')?.shadowRoot?.querySelector('[role="alertdialog"]'), null, { label: 'dialog' });
    const state = () => ui.page.ev(() => [...document.querySelector('[data-abcm-root]').shadowRoot.querySelectorAll('[role="alertdialog"] .btn-danger')].map((b) => b.disabled));
    assert.deepEqual(await state(), [true]);
    await click(ui.page, { shadow: true, css: '[role="alertdialog"] input[type="checkbox"]' });
    assert.deepEqual(await state(), [false]);
    await ui.page.press('Escape'); // a real Escape key closes the dialog and deletes nothing
    await ui.page.waitFor(() => !document.querySelector('[data-abcm-root]').shadowRoot.querySelector('[role="alertdialog"]'), null, { label: 'dialog closed by Escape' });
    assert.equal(ui.server.deleted.length, 0, 'cancelling deletes nothing');
  });
});

check('F09', 'export downloads a real file from the content script (JSON)', async () => {
  const chats = makeChats(4);
  for (const file of fs.readdirSync(downloadDir)) fs.rmSync(path.join(downloadDir, file), { force: true });
  return withSite('grok', { chats }, async (ui) => {
    await ui.start();
    await pick(ui, [0, 3]);
    await click(ui.page, { shadow: true, css: '.menu-wrap > button' });
    try { await click(ui.page, { shadow: true, css: '.menu button', text: 'JSON' }); } catch (error) {
      const state = await ui.page.ev(() => { const root = document.querySelector('[data-abcm-root]').shadowRoot; const exp = root.querySelector('.menu-wrap > button'); const menu = root.querySelector('.menu'); return { exportDisabled: exp.disabled, expanded: exp.getAttribute('aria-expanded'), menuHidden: menu.hidden, count: root.querySelector('.count-num').textContent, active: root.activeElement?.outerHTML.slice(0, 80) }; });
      throw new Error(`${error.message}; export button state: ${JSON.stringify(state)}`);
    }
    const deadline = Date.now() + 20000;
    let file;
    while (Date.now() < deadline && !file) { file = fs.readdirSync(downloadDir).find((name) => /^ai-chats-grok-.*\.json$/.test(name) && !name.endsWith('.part')); await sleep(150); }
    assert.ok(file, `no download appeared in ${downloadDir}: ${fs.readdirSync(downloadDir)}`);
    await sleep(300);
    const data = JSON.parse(fs.readFileSync(path.join(downloadDir, file), 'utf8'));
    assert.equal(data.count, 2);
    assert.deepEqual(data.chats.map((c) => c.id).sort(), [chats[0].id, chats[3].id].sort());
    assert.match(await shadowText(ui.page, '.toast'), /Exported 2 chats as JSON/);
    return { file };
  });
});

check('F10', 'popup page renders, reports the active chat tab, and its Start/Finish buttons drive the page (trusted clicks)', async () => {
  const chat = await openSite('chatgpt', {});
  try {
    await chat.page.activate();
    let popup;
    const open = async () => {
      // The popup closes its own tab after Start/Finish (window.close()), so every visit is a fresh background tab.
      popup = await session.newPage({ background: true });
      popup.keepBackground = true; // a popup never takes the browser window's focus from the chat tab
      await popup.goto(`${EXT_ORIGIN}src/popup/popup.html`);
      await popup.waitFor(() => document.getElementById('status-title')?.textContent.trim() && !document.getElementById('supported').hidden, null, { label: 'popup supported view' });
    };
    await open();
    const read = () => popup.ev(() => ({
      title: document.getElementById('status-title').textContent, sub: document.getElementById('status-sub').textContent, start: document.getElementById('start').textContent,
      shortcut: document.getElementById('shortcut').textContent, version: document.getElementById('version').textContent, theme: document.documentElement.dataset.theme,
      bodyBg: getComputedStyle(document.body).backgroundColor, switches: [...document.querySelectorAll('.switch')].map((s) => s.getAttribute('aria-checked')),
      footer: document.getElementById('footer-message').textContent.length > 0, icon: document.querySelectorAll('#status-icon svg').length
    }));
    const ready = await read();
    assert.equal(ready.title, 'Ready on ChatGPT');
    assert.equal(ready.start, 'Start selecting chats');
    assert.equal(ready.version, 'v9.0.0');
    assert.match(ready.shortcut, /Alt\+Shift\+B/i, `shortcut hint: ${ready.shortcut}`);
    assert.notEqual(ready.bodyBg, 'rgba(0, 0, 0, 0)');
    assert.equal(ready.icon, 1, 'status icon SVG rendered');
    assert.deepEqual(ready.switches, ['true', 'true']);
    await click(popup, { css: '#start' });
    await chat.page.waitFor(() => { const p = document.querySelector('[data-abcm-root]')?.shadowRoot?.querySelector('.panel'); return p && !p.hidden; }, null, { label: 'popup Start opened the panel on the chat tab' });
    await open();
    const active = await read();
    assert.equal(active.title, 'Selecting on ChatGPT');
    assert.equal(active.start, 'Finish selecting');
    await click(popup, { css: '#start' });
    await chat.page.waitFor(() => document.querySelectorAll('[data-abcm-checkbox]').length === 0, null, { label: 'popup Finish ended selection' });
    // A toggled preference reaches storage.
    await open();
    await click(popup, { css: '#sw-fast' });
    await popup.waitFor(() => document.getElementById('sw-fast').getAttribute('aria-checked') === 'false', null, { label: 'switch flipped' });
    assert.equal((await storageGet('settings')).settings.fastMode, false);
    await shot(popup, 'popup', { width: 360, height: 640 });
    await popup.close();

    // Active tab is not a chat site: unsupported view with the four site buttons.
    await util.activate();
    const popup2 = await session.newPage({ background: true });
    popup2.keepBackground = true;
    await popup2.goto(`${EXT_ORIGIN}src/popup/popup.html`);
    await popup2.waitFor(() => document.getElementById('status-title')?.textContent.trim(), null, { label: 'popup rendered' });
    const unsupported = await popup2.ev(() => ({ hidden: document.getElementById('unsupported').hidden, title: document.getElementById('status-title').textContent, buttons: document.querySelectorAll('#site-grid button').length, tabs: null }));
    const tabsSeen = await util.ev(() => new Promise((resolve) => chrome.tabs.query({}, (tabs) => resolve(tabs.map((t) => `${t.id}:${t.active}:${(t.url || '').slice(0, 40)}`)))));
    assert.equal(unsupported.hidden, false, `popup should show the unsupported view; it shows ${JSON.stringify(unsupported)}; tabs ${JSON.stringify(tabsSeen)}`);
    assert.equal(unsupported.title, "This page isn't supported");
    assert.equal(unsupported.buttons, 4);
    await popup2.close();
    assert.deepEqual(chat.problems(), []);
    return { ready, active };
  } finally { await chat.close(); }
});

check('F11', 'options page renders; changes reach storage and a running panel live; reset works', async () => {
  const chat = await openSite('chatgpt', {});
  try {
    await chat.start();
    const options = await session.newPage();
    await options.goto(`${EXT_ORIGIN}src/options/options.html`);
    await options.waitFor(() => document.getElementById('language')?.options.length > 3 && document.getElementById('version').textContent, null, { label: 'options ready' });
    const info = await options.ev(() => ({
      languages: [...document.getElementById('language').options].map((o) => o.value), shortcut: document.getElementById('shortcut-key').textContent,
      threshold: document.getElementById('threshold').value, theme: document.documentElement.dataset.theme, h1: document.querySelector('h1,h2')?.textContent
    }));
    assert.ok(info.languages.includes('fa') && info.languages.includes('ja'));
    assert.match(info.shortcut, /Alt\+Shift\+B/i);
    assert.equal(info.threshold, '20');
    await shot(options, 'options', { width: 1000, height: 900 });
    // Dark theme chosen on the options page re-themes the open panel in the chat tab (storage.onChanged in the content script).
    await click(options, { css: '#theme button[data-value="dark"]' });
    await chat.page.waitFor(() => document.querySelector('[data-abcm-root]')?.getAttribute('data-theme') === 'dark', null, { label: 'panel turned dark' });
    assert.equal((await storageGet('settings')).settings.theme, 'dark');
    await shot(chat.page, 'panel-dark');
    await click(options, { css: '#sw-launcher' });
    assert.equal((await storageGet('settings')).settings.showLauncher, true);
    // Japanese is a bundled catalog: the panel re-mounts in Japanese.
    await options.ev(() => { const s = document.getElementById('language'); s.value = 'ja'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; });
    await chat.page.waitFor(() => /[぀-ヿ一-鿿]/.test(document.querySelector('[data-abcm-root]')?.shadowRoot?.querySelector('.quick')?.textContent || ''), null, { label: 'panel re-mounted in Japanese' });
    // Reset (window.confirm is auto-accepted in the page) returns to defaults.
    await options.ev(() => { window.confirm = () => true; return true; });
    await click(options, { css: '#reset' });
    await options.waitFor(async () => (await new Promise((r) => chrome.storage.local.get('settings', r))).settings === undefined, null, { label: 'settings cleared' });
    await options.close();
    assert.deepEqual(chat.problems(), []);
  } finally { await chat.close(); }
});

check('F12', 'Persian (fa): RTL panel and options render, mirrored and translated', async () => {
  return withSite('chatgpt', { settings: { language: 'fa' }, dir: 'rtl' }, async (ui) => {
    await ui.start();
    const info = await ui.page.ev(() => {
      const host = document.querySelector('[data-abcm-root]');
      const panel = host.shadowRoot.querySelector('.panel');
      const r = panel.getBoundingClientRect();
      const bar = host.shadowRoot.querySelector('.bar > span');
      return { dir: host.getAttribute('dir'), lang: host.getAttribute('lang'), cssDir: getComputedStyle(panel).direction, left: r.left, right: innerWidth - r.right, count: host.shadowRoot.querySelector('.count-num').textContent, quick: host.shadowRoot.querySelector('.quick').textContent, title: host.shadowRoot.querySelector('.head-title').textContent, origin: bar && getComputedStyle(bar).transformOrigin };
    });
    assert.equal(info.dir, 'rtl', JSON.stringify(info));
    assert.equal(info.lang, 'fa', JSON.stringify(info));
    assert.equal(info.cssDir, 'rtl', JSON.stringify(info));
    assert.ok(info.left < info.right, `RTL panel sits at the physical left edge (left ${info.left}, right ${info.right})`);
    assert.match(info.count, /[۰-۹]/, 'Persian digits from Intl.NumberFormat("fa")');
    if (fs.existsSync(path.join(extensionDir, 'src/i18n/locales/fa.json'))) assert.match(info.quick, /[\u0600-\u06FF]/, `panel text is Persian: ${info.quick}`);
    await shot(ui.page, 'panel-fa-rtl');
    const popup = await session.newPage();
    await popup.goto(`${EXT_ORIGIN}src/options/options.html`);
    const page = await popup.waitFor(() => document.documentElement.dir === 'rtl' && { dir: document.documentElement.dir, lang: document.documentElement.lang, h: document.querySelector('h1')?.textContent }, null, { label: 'options rtl' });
    assert.equal(page.lang, 'fa', JSON.stringify(page));
    await shot(popup, 'options-fa-rtl', { width: 1000, height: 900 });
    await popup.close();
    assert.deepEqual(ui.problems(), []);
    return { info, page };
  });
});

check('F13', 'chrome.* callback APIs from an extension page: storage, runtime.sendMessage (worker), tabs, scripting, commands, action', async () => {
  const chat = await openSite('chatgpt', {});
  try {
    const out = await util.ev(async (match) => {
      const cb = (fn) => new Promise((resolve) => fn((value) => resolve({ value, error: chrome.runtime.lastError?.message || null })));
      const res = {};
      res.set = await cb((done) => chrome.storage.local.set({ probe: { a: 1 } }, done));
      res.get = await cb((done) => chrome.storage.local.get('probe', done));
      res.remove = await cb((done) => chrome.storage.local.remove('probe', done));
      res.locale = await cb((done) => chrome.runtime.sendMessage({ type: 'ABCM_GET_LOCALE', lang: 'ja' }, done));
      res.badLocale = await cb((done) => chrome.runtime.sendMessage({ type: 'ABCM_GET_LOCALE', lang: '../x' }, done));
      res.missingLocale = await cb((done) => chrome.runtime.sendMessage({ type: 'ABCM_GET_LOCALE', lang: 'xx' }, done));
      res.asset = await cb((done) => chrome.runtime.sendMessage({ type: 'ABCM_GET_ASSET', names: ['tokens', 'components', 'panel', 'nope'] }, done));
      res.unknown = await cb((done) => chrome.runtime.sendMessage({ type: 'NOPE' }, done));
      res.created = await cb((done) => chrome.tabs.create({ url: 'about:blank', active: false }, done));
      res.removed = await cb((done) => chrome.tabs.remove(res.created.value.id, done));
      res.ping = await cb((done) => chrome.runtime.sendMessage({ type: 'ABCM_SUPPORT_PING' }, done));
      const tabs = await cb((done) => chrome.tabs.query({ url: match }, done));
      res.tabCount = tabs.value.length;
      res.tabsSend = await cb((done) => chrome.tabs.sendMessage(tabs.value[0].id, { type: 'ABCM_STATE' }, done));
      res.tabsSendUnknown = await cb((done) => chrome.tabs.sendMessage(tabs.value[0].id, { type: 'NOPE' }, done));
      res.exec = await cb((done) => chrome.scripting.executeScript({ target: { tabId: tabs.value[0].id }, files: chrome.runtime.getManifest().content_scripts[0].js }, done));
      res.pingAfter = await cb((done) => chrome.tabs.sendMessage(tabs.value[0].id, { type: 'ABCM_PING' }, done));
      res.func = await cb((done) => chrome.scripting.executeScript({ target: { tabId: tabs.value[0].id }, func: () => location.hostname }, done));
      res.commands = await cb((done) => chrome.commands.getAll(done));
      res.badge = await cb((done) => chrome.action.setBadgeText({ text: '' }, done));
      res.opts = await cb((done) => chrome.runtime.sendMessage({ type: 'ABCM_OPEN_OPTIONS' }, done));
      res.url = chrome.runtime.getURL('x.json');
      return res;
    }, MATCH.chatgpt).catch((error) => { throw error; });
    try {
    assert.equal(out.set.error, null);
    assert.deepEqual(out.get.value, { probe: { a: 1 } });
    assert.equal(out.remove.error, null);
    assert.equal(out.locale.value.ok, true);
    assert.ok(Object.keys(out.locale.value.catalog).length > 50, 'ja catalog delivered through the event page');
    assert.equal(out.badLocale.value.ok, false);
    assert.equal(out.missingLocale.value.ok, false, 'a language without a catalog file: the worker answers with an error, not a hang');
    assert.equal(out.asset.value.ok, true);
    assert.match(out.asset.value.css, /\.panel/);
    assert.match(out.asset.value.css, /--accent|:host/);
    assert.equal(out.unknown.value, undefined, 'unhandled message types are not answered');
    assert.equal(out.created.error, null, 'tabs.create (callback form)');
    assert.equal(out.removed.error, null);
    assert.equal(out.ping.value.ok, true);
    assert.equal(out.tabCount, 1);
    assert.equal(out.tabsSend.value.ok, true);
    assert.equal(out.tabsSendUnknown.value, undefined);
    assert.equal(out.exec.error, null, 'scripting.executeScript with files (callback form)');
    assert.equal(out.pingAfter.value.ready, true, 'a second injection leaves the healthy copy alone');
    assert.equal(out.func.value[0].result, 'chatgpt.com');
    assert.ok(out.commands.value.some((c) => c.name === 'toggle-panel' && /Alt\+Shift\+B/i.test(c.shortcut)), JSON.stringify(out.commands.value));
    assert.equal(out.badge.error, null);
    assert.equal(out.opts.value.ok, true);
    assert.equal(await chat.page.ev(() => document.querySelectorAll('[data-abcm-root]').length), 0, 'the re-injection created nothing extra');
    } catch (error) { error.message += `\nreplies: ${JSON.stringify(out, (key, value) => (key === "catalog" || key === "css" ? "…" : value)).slice(0, 2500)}`; throw error; }
    return { exec: out.exec };
  } finally { await chat.close(); }
});

check('F14', 'keyboard command: Firefox registers Alt+Shift+B and the event page toggles the panel, also after it was suspended', async () => {
  return withSite('chatgpt', {}, async (ui) => {
    const panelOpen = () => { const p = document.querySelector('[data-abcm-root]')?.shadowRoot?.querySelector('.panel'); return !!p && !p.hidden && p.getBoundingClientRect().width > 0; };
    const panelClosed = () => { const p = document.querySelector('[data-abcm-root]')?.shadowRoot?.querySelector('.panel'); return !p || p.hidden; };
    const chromeScript = async (script, args = []) => {
      await session.marionette.send('Marionette:SetContext', { value: 'chrome' });
      try { return (await session.marionette.send('WebDriver:ExecuteScript', { script, args })).value; }
      finally { await session.marionette.send('Marionette:SetContext', { value: 'content' }); }
    };
    const backgroundState = () => chromeScript('return WebExtensionPolicy.getByID(arguments[0]).extension.backgroundState;', [FIREFOX_ADDON_ID]);
    // Headless native key events do not reach the browser's own shortcut handler, so the test (1) checks that
    // Firefox turned the manifest shortcut into a <key> in the browser window and (2) fires the same
    // callback that key would (ExtensionShortcuts.onCommand), which emits the command to the extension.
    const keys = await chromeScript("return [...Services.wm.getMostRecentWindow('navigator:browser').document.querySelectorAll('key')].map((k) => k.getAttribute('modifiers') + '+' + k.getAttribute('key'));");
    assert.ok(keys.includes('alt,shift+B'), `Firefox did not register Alt+Shift+B: ${JSON.stringify(keys.filter((k) => /alt/.test(k)))}`);
    const fire = () => chromeScript("WebExtensionPolicy.getByID(arguments[0]).extension.shortcuts.onCommand('toggle-panel'); return true;", [FIREFOX_ADDON_ID]);

    await ui.page.activate();
    await fire();
    await ui.page.waitFor(panelOpen, null, { label: 'panel opened by the command', timeout: 15000 });
    await fire();
    await ui.page.waitFor(panelClosed, null, { label: 'panel closed by the command' });

    // Let the event page suspend, then use the command again: its listener must be registered at start-up.
    const deadline = Date.now() + IDLE_TIMEOUT_MS + 30000;
    let state;
    while (Date.now() < deadline) { state = await backgroundState(); if (state === 'stopped') break; await sleep(1000); }
    assert.equal(state, 'stopped', 'the event page suspends when idle');
    await fire();
    await ui.page.waitFor(panelOpen, null, { label: 'panel opened by the command after the event page was suspended', timeout: 15000 });
    assert.deepEqual(ui.problems(), []);
    return { stateBeforeWake: state, stateAfter: await backgroundState() };
  });
});

check('F15', 'events the visual engine dispatches from the content-script realm reach the page (pointer, mouse, keyboard)', async () => {
  // Menus built with Radix/Material open on pointerdown/mousedown, not on click(), so these must arrive.
  return withSite('chatgpt', {}, async (ui) => {
    await ui.page.ev(() => {
      const probe = document.createElement('button');
      probe.id = 'abcm-probe';
      probe.textContent = 'probe';
      document.body.appendChild(probe);
      window.__seen = [];
      ['mouseover', 'mouseenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'keydown', 'keyup'].forEach((type) => probe.addEventListener(type, (event) => window.__seen.push(`${type}:${event.constructor.name}`)));
      return true;
    });
    // scripting.executeScript with func runs in the same sandbox as the extension's content scripts.
    const ran = await util.ev((match) => new Promise((resolve) => chrome.tabs.query({ url: match }, (tabs) => chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: async () => {
        const probe = document.getElementById('abcm-probe');
        await ABCM.visualEngine.activate(probe, { aggressive: true });
        ABCM.dom.dispatchHover(probe);
        return typeof ABCM.visualEngine.activate;
      }
    }, (results) => resolve(results?.[0]?.result ?? chrome.runtime.lastError?.message)))), MATCH.chatgpt);
    assert.equal(ran, 'function', `could not run in the content-script realm: ${ran}`);
    const seen = await ui.page.ev(() => window.__seen);
    for (const expected of ['mouseover:MouseEvent', 'pointerdown:PointerEvent', 'mousedown:MouseEvent', 'pointerup:PointerEvent', 'mouseup:MouseEvent', 'keydown:KeyboardEvent', 'keyup:KeyboardEvent']) {
      assert.ok(seen.includes(expected), `${expected} never reached the page; seen: ${JSON.stringify(seen)}`);
    }
    return { seen };
  });
});

check('F16', 'the panel and the API route work under a strict page Content-Security-Policy (the real sites send one)', async () => {
  const chats = makeChats(4);
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'";
  return withSite('claude', { chats, csp }, async (ui) => {
    await ui.start();
    const styled = await ui.page.ev(() => { const p = document.querySelector('[data-abcm-root]').shadowRoot.querySelector('.panel'); return { position: getComputedStyle(p).position, w: p.getBoundingClientRect().width }; });
    assert.equal(styled.position, 'fixed', 'panel styles applied under CSP');
    await pick(ui, [1]);
    await ui.clickBtn('Delete 1');
    await ui.confirmDelete(/Delete 1 chat/.source);
    assert.equal(await ui.waitForResult(), '1 chat deleted');
    assert.deepEqual(ui.server.deleted, [chats[1].id], 'fetch from the content script reached the backend under connect-src self');
    assert.deepEqual(ui.problems(), []);
  });
});

check('F17', 'the panel can be minimized, dragged with the mouse (pointer capture) and keeps its place', async () => {
  return withSite('chatgpt', {}, async (ui) => {
    await ui.start();
    await ui.clickBtn('Minimize');
    assert.equal(await ui.page.ev(() => document.querySelector('[data-abcm-root]').shadowRoot.querySelector('.panel').dataset.collapsed), 'true');
    await ui.clickBtn('Expand');
    assert.equal(await ui.page.ev(() => document.querySelector('[data-abcm-root]').shadowRoot.querySelector('.panel').dataset.collapsed), 'false');
    const head = await ui.page.waitFor(locate, { shadow: true, css: '.head-text' }, { label: 'panel head' });
    const before = await ui.page.ev(() => { const r = document.querySelector('[data-abcm-root]').shadowRoot.querySelector('.panel').getBoundingClientRect(); return { x: r.x, y: r.y }; });
    await ui.page.drag(head, { x: head.x - 300, y: head.y - 150 });
    const after = await ui.page.ev(() => { const r = document.querySelector('[data-abcm-root]').shadowRoot.querySelector('.panel').getBoundingClientRect(); return { x: r.x, y: r.y }; });
    assert.ok(after.x < before.x - 200 && after.y < before.y - 100, `panel moved: ${JSON.stringify({ before, after })}`);
    let saved;
    for (let attempt = 0; attempt < 30 && !saved; attempt++) { saved = (await storageGet('settings')).settings?.panelPosition; if (!saved) await sleep(100); }
    assert.ok(saved, 'position saved to storage');
    return { before, after };
  });
});

check('F18', 'Copy report writes the failure list to the clipboard from the content script', async () => {
  const chats = makeChats(3);
  return withSite('chatgpt', { chats, failIds: [chats[0].id] }, async (ui) => {
    await ui.start();
    await ui.clickBtn('Select all');
    await ui.clickBtn('Delete 3');
    await ui.confirmDelete();
    await ui.waitForResult();
    await ui.clickBtn('^Copy report');
    const toast = await ui.page.waitFor(() => document.querySelector('[data-abcm-root]')?.shadowRoot?.querySelector('.toast')?.textContent, null, { label: 'copy toast' });
    assert.equal(toast, 'Report copied', `clipboard write from the content script: ${toast}`);
  });
});

check('F19', 'options page links open real tabs (tabs.create from an extension page) and the shortcut link degrades gracefully', async () => {
  const options = await session.newPage();
  await options.goto(`${EXT_ORIGIN}src/options/options.html`);
  await options.waitFor(() => document.getElementById('version')?.textContent, null, { label: 'options ready' });
  const contexts = async () => (await session.bidi.send('browsingContext.getTree', {})).contexts.map((c) => ({ id: c.context, url: c.url }));
  const waitForTab = async (test, label) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { const hit = (await contexts()).find((c) => test(c.url)); if (hit) return hit; await sleep(150); }
    throw new Error(`no tab appeared: ${label}; tabs: ${JSON.stringify(await contexts())}`);
  };
  const bring = (selector) => options.ev((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), selector);
  await bring('[data-link="repo"]');
  await click(options, { css: '[data-link="repo"]' });
  const repo = await waitForTab((url) => url.startsWith('https://github.com/ehsanenaloo/'), 'GitHub repository link');
  await session.bidi.send('browsingContext.close', { context: repo.id });
  // Firefox does not let extensions open about:addons with tabs.create: the page must fall back to telling the user where to go.
  await options.activate();
  await bring('#shortcut-change');
  await click(options, { css: '#shortcut-change' });
  await sleep(1500);
  const note = await options.ev(() => document.getElementById('note').textContent);
  const opened = (await contexts()).find((c) => c.url.startsWith('about:addons'));
  assert.ok(opened || /addons/i.test(note), `neither a tab nor a hint appeared (note: "${note}")`);
  if (opened) await session.bidi.send('browsingContext.close', { context: opened.id });
  await options.close();
  return { shortcutLink: opened ? 'opened about:addons' : `note: ${note}` };
});

// ─── runner ───────────────────────────────────────────────────────────────────────────────────
async function main() {
  const packageDir = process.env.FIREFOX_PACKAGE_DIR ? path.resolve(process.env.FIREFOX_PACKAGE_DIR) : buildFirefox({ extensionDir, outDir: path.join(workDir, 'package') }).outDir;
  session = await launchFirefox({
    packageDir,
    prefs: {
      'extensions.background.idle.timeout': IDLE_TIMEOUT_MS,
      'browser.download.folderList': 2, 'browser.download.dir': downloadDir, 'browser.download.useDownloadDir': true,
      'browser.download.always_ask_before_handling_new_types': false, 'browser.helperApps.neverAsk.saveToDisk': 'application/json,text/csv,text/markdown,text/plain',
      'browser.download.alwaysOpenPanel': false
    }
  });
  session.logEntries = [];
  await session.install();
  util = await session.newPage();
  await util.goto(`${EXT_ORIGIN}src/options/options.html`);
  await util.waitFor(() => document.getElementById('version')?.textContent, null, { label: 'util options page' });
  console.error(`Firefox ${session.version}, package ${packageDir}`);

  const results = [];
  for (const def of checkDefs) {
    if (only && !only.test(`${def.id} ${def.name}`)) continue;
    const started = Date.now();
    try {
      const detail = await def.fn();
      results.push({ id: def.id, name: def.name, passed: true, ms: Date.now() - started, detail });
      console.error(`PASS ${def.id} ${def.name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (error) {
      results.push({ id: def.id, name: def.name, passed: false, ms: Date.now() - started, failure: String(error.stack || error).split('\n').slice(0, 8).join('\n') });
      console.error(`FAIL ${def.id} ${def.name}\n  ${String(error.message).slice(0, 1500)}`);
    }
  }
  return results;
}

let results = [];
let fatal;
try { results = await main(); } catch (error) { fatal = error; console.error('FATAL', error.stack || error); }
let log = '';
try { log = session?.log || ''; await session?.close(); } catch { /* the browser is already gone */ }
const pageErrors = session?.errors || [];
const backgroundErrors = log.split(/\r?\n/).filter((line) => /JavaScript error: moz-extension:|Reading manifest|Warning processing|Error processing/i.test(line));
fs.rmSync(workDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.passed);
console.log(JSON.stringify({
  firefox: session?.version, binary: FIREFOX_BIN, total: results.length, passed: results.length - failed.length, failed: failed.length,
  fatal: fatal ? String(fatal.message) : undefined, pageErrors, backgroundErrors,
  checks: results.map((r) => ({ id: r.id, passed: r.passed, ms: r.ms, ...(r.passed ? { detail: r.detail } : { failure: r.failure }) }))
}, null, 2));
process.exitCode = fatal || failed.length || backgroundErrors.length ? 1 : 0;
