import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from '../helpers/dom.mjs';

// Objects built inside the jsdom window have that window's prototypes; compare them as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));

const shared = ['src/shared/namespace.js', 'src/shared/ext.js', 'src/shared/sites.js', 'src/shared/settings.js', 'src/shared/nudge.js'];

test('sites.match accepts the supported hosts and rejects look-alikes', () => {
  const { ABCM } = createEnv({ files: shared });
  const id = (value) => ABCM.sites.match(value)?.id ?? null;
  assert.equal(id('chatgpt.com'), 'chatgpt');
  assert.equal(id('chat.openai.com'), 'chatgpt');
  assert.equal(id('https://claude.ai/chat/abc'), 'claude');
  assert.equal(id('https://gemini.google.com/app'), 'gemini');
  assert.equal(id('https://grok.com/c/1'), 'grok');
  assert.equal(id('https://www.chatgpt.com/'), null, 'only the exact hosts the manifest matches');
  assert.equal(id('https://chatgpt.com:8443/'), null);
  assert.equal(id('https://user@evil.example/'), null);
  assert.equal(id('https://evilchatgpt.com/'), null);
  assert.equal(id('https://chatgpt.com.evil.example/'), null);
  assert.equal(id('http://claude.ai/'), null, 'plain http is not a supported page');
  assert.equal(id('chrome://extensions'), null);
  assert.equal(id(''), null);
  assert.equal(id(undefined), null);
});

test('every site declares what the engines need', () => {
  const { ABCM } = createEnv({ files: shared });
  for (const site of ABCM.sites.all) {
    assert.ok(site.id && site.name && site.hosts.length && site.conversation && site.anchorMatch && Object.prototype.toString.call(site.idRe) === '[object RegExp]', site.id);
    assert.ok(['api', 'visual'].includes(site.method), site.id);
    assert.ok(site.history.length > 0, site.id);
    assert.match(site.url, /^https:\/\//);
    const sample = site.id === 'claude' ? '/chat/0a1b2c3d-0000-4000-8000-000000000001' : site.id === 'gemini' ? '/app/0a1b2c3d4e5f' : '/c/0a1b2c3d-0000-4000-8000-000000000001';
    assert.ok(sample.match(site.idRe)?.[1], `${site.id} id pattern reads a sample link`);
  }
  assert.equal(ABCM.sites.byId('chatgpt').archive, true);
  assert.equal(ABCM.sites.all.filter((site) => site.archive).length, 1, 'only ChatGPT archives');
});

test('manifest content-script matches line up with the registry', async () => {
  const { manifest } = await import('../helpers/dom.mjs');
  const { ABCM } = createEnv({ files: shared });
  const hosts = manifest.content_scripts[0].matches.map((pattern) => new URL(pattern.replace('/*', '/')).hostname);
  for (const host of hosts) assert.ok(ABCM.sites.match(host), `${host} is in the registry`);
  for (const site of ABCM.sites.all) for (const host of site.hosts) assert.ok(hosts.includes(host), `${host} is in the manifest`);
});

test('settings.normalize repairs any stored value', () => {
  const { ABCM } = createEnv({ files: shared });
  const n = ABCM.settings.normalize;
  assert.deepEqual(plain(n(null)), plain(ABCM.settings.DEFAULTS));
  assert.deepEqual(plain(n('junk')), plain(ABCM.settings.DEFAULTS));
  const odd = n({ theme: 'neon', accent: 'pink', fastMode: 'yes', autoLoad: 0, confirmThreshold: 'many', language: '<script>', showLauncher: 1, panelPosition: { x: 'a', y: 2 } });
  assert.deepEqual(plain(odd), plain(ABCM.settings.DEFAULTS));
  assert.equal(n({ confirmThreshold: 0 }).confirmThreshold, 1);
  assert.equal(n({ confirmThreshold: 99999 }).confirmThreshold, 500);
  assert.equal(n({ confirmThreshold: '35.6' }).confirmThreshold, 36);
  assert.deepEqual(plain(n({ panelPosition: { x: 10.4, y: 20.6 } }).panelPosition), { x: 10, y: 21 });
  assert.equal(n({ language: 'pt-BR' }).language, 'pt-BR');
});

test('settings.load migrates the version-8 fast mode flag; save merges instead of overwriting', async () => {
  const { ABCM, store } = createEnv({ files: shared, chromeOptions: { storage: { fastApiMode: false } } });
  const loaded = await ABCM.settings.load();
  assert.equal(loaded.fastMode, false, 'legacy flag carried over');

  store.settings = { theme: 'dark' };
  const saved = await ABCM.settings.save({ accent: 'blue' });
  assert.equal(saved.theme, 'dark', 'a field written elsewhere is kept');
  assert.equal(saved.accent, 'blue');
  assert.equal(store.settings.accent, 'blue');
});

test('settings listeners hear changes made in another page', async () => {
  const { ABCM, chrome } = createEnv({ files: shared });
  await ABCM.settings.load();
  const seen = [];
  ABCM.settings.onChange((now, before) => seen.push([before.theme, now.theme]));
  await new Promise((resolve) => chrome.storage.local.set({ settings: { theme: 'light' } }, resolve));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(plain(seen), [['system', 'light']]);
});

test('support reminder: grace period, monthly interval, opt-out', async () => {
  const { ABCM } = createEnv({ files: shared });
  const day = 86400000;
  const t0 = 1_700_000_000_000;
  const due = ABCM.nudge.isDue;
  assert.equal(due(null, t0), false);
  assert.equal(due({ installedAt: t0 }, t0 + 13 * day), false, 'not in the first two weeks');
  assert.equal(due({ installedAt: t0 }, t0 + 14 * day), true);
  assert.equal(due({ installedAt: t0, lastShownAt: t0 + 14 * day }, t0 + 40 * day), false, 'less than a month since last shown');
  assert.equal(due({ installedAt: t0, lastShownAt: t0 + 14 * day }, t0 + 44 * day), true);
  assert.equal(due({ installedAt: t0, optOut: true }, t0 + 400 * day), false);

  const seeded = await ABCM.nudge.seed(t0);
  assert.equal(seeded.installedAt, t0);
  assert.equal((await ABCM.nudge.seed(t0 + 5)).installedAt, t0, 'seeding twice keeps the first date');
  assert.equal((await ABCM.nudge.markShown(t0 + 20 * day)).shownCount, 1);
  assert.equal((await ABCM.nudge.optOut()).optOut, true);
});
