import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from '../helpers/dom.mjs';

const files = ['src/shared/namespace.js', 'src/shared/ext.js', 'src/shared/settings.js', 'src/shared/sites.js', 'src/shared/links.js', 'src/shared/nudge.js', 'src/shared/inject.js'];
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function setNavigator(window, { userAgent, brands } = {}) {
  Object.defineProperty(window, 'navigator', { configurable: true, value: { userAgent, userAgentData: brands ? { brands } : undefined } });
}

test('browserInfo names the browser and gives digits only', () => {
  const { window, ABCM } = createEnv({ files });
  const info = (nav) => { setNavigator(window, nav); return JSON.parse(JSON.stringify(ABCM.links.browserInfo())); };
  assert.deepEqual(info({ userAgent: CHROME_UA }), { name: 'chrome', major: '131' });
  assert.deepEqual(info({ userAgent: `${CHROME_UA} Edg/130.0.2849.5` }), { name: 'edge', major: '130' });
  assert.deepEqual(info({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0' }), { name: 'firefox', major: '132' });
  assert.deepEqual(info({ userAgent: `${CHROME_UA} OPR/115.0.0.0` }), { name: 'other', major: '' });
  assert.deepEqual(info({ userAgent: 'curl/8' }), { name: 'other', major: '' });
  assert.deepEqual(info({ userAgent: CHROME_UA, brands: [{ brand: 'Chromium', version: '131' }, { brand: 'Microsoft Edge', version: '131' }] }), { name: 'edge', major: '131' });
  assert.deepEqual(info({ userAgent: CHROME_UA, brands: [{ brand: 'Chromium', version: '131' }, { brand: 'Google Chrome', version: '131' }] }), { name: 'chrome', major: '131' });
  assert.equal(info({ userAgent: CHROME_UA, brands: [{ brand: 'Chromium', version: '131' }, { brand: 'Brave', version: '131' }] }).name, 'chrome', 'falls back to the user agent');
});

test('installAge buckets', () => {
  const { ABCM } = createEnv({ files });
  const now = 1_000 * 864e5;
  const age = (days) => ABCM.links.installAge(now - days * 864e5, now);
  assert.equal(ABCM.links.installAge(undefined, now), 'unknown');
  assert.equal(ABCM.links.installAge(NaN, now), 'unknown');
  assert.deepEqual([0.5, 1, 6.9, 7, 29.9, 30, 89.9, 90, 400].map(age), ['d1', 'w1', 'w1', 'm1', 'm1', 'm3', 'm3', 'more', 'more']);
});

test('page links carry only the documented values', () => {
  const { window, ABCM } = createEnv({ files });
  setNavigator(window, { userAgent: CHROME_UA });
  const L = ABCM.links;
  assert.equal(L.welcomeUrl({ version: '9.0.1', lang: 'pt-BR' }), 'https://enaloo.com/apps/ai-bulk-chat-manager/welcome/?v=9.0.1&lang=pt-BR&b=chrome');
  const now = Date.now();
  const uninstall = new URL(L.uninstallUrl({ version: '9.0.1', lang: 'en', os: 'win', installedAt: now - 3 * 864e5 }));
  assert.equal(uninstall.pathname, '/apps/ai-bulk-chat-manager/uninstall/');
  assert.deepEqual(Object.fromEntries(uninstall.searchParams), { v: '9.0.1', lang: 'en', b: 'chrome', bv: '131', os: 'win', age: 'w1' });
  assert.equal(new URL(L.uninstallUrl({ version: '9.0.1', lang: 'en', os: 'openbsd' })).searchParams.get('os'), 'other');
  assert.equal(new URL(L.uninstallUrl({ version: '9.0.1', lang: 'en', os: 'mac' })).searchParams.get('age'), 'unknown');
  assert.ok(L.uninstallUrl({ version: '9.0.1', lang: 'zh-CN', os: 'cros', installedAt: 1 }).length < 1000);
  assert.equal(L.feedbackUrl('bug', '9.0.1'), 'https://enaloo.com/apps/ai-bulk-chat-manager/feedback/?kind=bug&v=9.0.1&b=chrome&bv=131');
  assert.equal(L.feedbackUrl('feature', '9.0.1'), 'https://enaloo.com/apps/ai-bulk-chat-manager/feedback/?kind=feature&v=9.0.1');
});

function workerEnv({ storage = {} } = {}) {
  const env = createEnv({ files, chromeOptions: { storage } });
  const { window, chrome } = env;
  setNavigator(window, { userAgent: CHROME_UA });
  const created = [];
  const uninstall = [];
  const listeners = {};
  chrome.tabs = { create(options, cb) { created.push(options); cb?.({ id: 1 }); } };
  chrome.action = { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setBadgeTextColor: async () => {} };
  chrome.commands = { onCommand: { addListener() {} } };
  chrome.runtime.getPlatformInfo = (cb) => cb({ os: 'win' });
  chrome.runtime.setUninstallURL = (url, cb) => { uninstall.push(url); cb?.(); };
  chrome.runtime.onInstalled = { addListener: (fn) => { listeners.installed = fn; } };
  chrome.runtime.onStartup = { addListener: (fn) => { listeners.startup = fn; } };
  window.load('background.js');
  return { ...env, created, uninstall, listeners };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('a fresh install opens the welcome page once, in a background tab', async () => {
  const env = workerEnv();
  await env.listeners.installed({ reason: 'install' });
  await settle();
  assert.equal(env.created.length, 1);
  assert.equal(env.created[0].active, false);
  assert.match(env.created[0].url, /^https:\/\/enaloo\.com\/apps\/ai-bulk-chat-manager\/welcome\/\?v=/);
  assert.ok(env.store.supportNudge.installedAt, 'the install time is recorded');
  assert.match(env.uninstall.at(-1), /age=d1/);
});

test('an update or a browser update opens nothing', async () => {
  const env = workerEnv({ storage: { supportNudge: { installedAt: Date.now() - 10 * 864e5 } } });
  await env.listeners.installed({ reason: 'update' });
  await env.listeners.installed({ reason: 'chrome_update' });
  await settle();
  assert.equal(env.created.length, 0);
  assert.match(env.uninstall.at(-1), /age=m1/);
});

test('the uninstall URL is set on every worker start and after startup', async () => {
  const env = workerEnv();
  await settle();
  assert.equal(env.uninstall.length, 1);
  assert.match(env.uninstall[0], /age=unknown/);
  env.listeners.startup();
  await settle();
  assert.equal(env.uninstall.length, 2);
  const url = new URL(env.uninstall[1]);
  assert.deepEqual([...url.searchParams.keys()], ['v', 'lang', 'b', 'bv', 'os', 'age']);
});
