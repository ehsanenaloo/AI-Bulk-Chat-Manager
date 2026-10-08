import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createEnv } from '../helpers/dom.mjs';
import { extensionDir } from '../helpers/paths.mjs';

const files = ['src/shared/namespace.js', 'src/shared/ext.js', 'src/shared/i18n.js'];
const localesDir = path.join(extensionDir, 'src', 'i18n', 'locales');
const locale = (code) => JSON.parse(fs.readFileSync(path.join(localesDir, `${code}.json`), 'utf8'));

test('resolveLanguage maps browser languages to supported ones', () => {
  const { ABCM } = createEnv({ files });
  const r = ABCM.i18n.resolveLanguage;
  assert.equal(r('auto', 'en-US'), 'en');
  assert.equal(r('auto', 'fa'), 'fa');
  assert.equal(r('auto', 'pt'), 'pt-BR');
  assert.equal(r('auto', 'pt-PT'), 'pt-BR');
  assert.equal(r('auto', 'zh-TW'), 'zh-CN');
  assert.equal(r('auto', 'es-419'), 'es');
  assert.equal(r('auto', 'sv'), 'en', 'unsupported languages fall back to English');
  assert.equal(r('de', 'fa'), 'de', 'an explicit choice wins over the browser');
  assert.equal(r('pt_BR', 'en'), 'pt-BR');
  assert.equal(r('auto', undefined), 'en');
});

test('t() fills placeholders, formats numbers per language and falls back to English then the key', () => {
  const { ABCM } = createEnv({ files });
  ABCM.i18n._setCatalog('en', { hello: 'Hi {name}, {count} left', only: 'English only' });
  ABCM.i18n._setCatalog('fa', { hello: 'سلام {name}، {count} مانده' });
  ABCM.i18n.use('en');
  assert.equal(ABCM.i18n.t('hello', { name: 'Ana', count: 1234 }), 'Hi Ana, 1,234 left');
  assert.equal(ABCM.i18n.t('hello', { name: 'Ana' }), 'Hi Ana, {count} left', 'a missing parameter is left visible');
  ABCM.i18n.use('fa');
  assert.match(ABCM.i18n.t('hello', { name: 'علی', count: 12 }), /۱۲/, 'Persian digits for Persian');
  assert.equal(ABCM.i18n.t('only'), 'English only');
  assert.equal(ABCM.i18n.t('does.not.exist'), 'does.not.exist');
  assert.equal(ABCM.i18n.dir(), 'rtl');
  ABCM.i18n.use('en');
  assert.equal(ABCM.i18n.dir(), 'ltr');
});

test('plural forms follow each language rules', () => {
  const { ABCM } = createEnv({ files });
  const entry = { one: '{count} one', few: '{count} few', many: '{count} many', other: '{count} other' };
  ABCM.i18n._setCatalog('en', { n: { one: '{count} chat', other: '{count} chats' } });
  ABCM.i18n._setCatalog('ru', { n: entry });
  ABCM.i18n.use('en');
  assert.equal(ABCM.i18n.t('n', { count: 1 }), '1 chat');
  assert.equal(ABCM.i18n.t('n', { count: 0 }), '0 chats');
  ABCM.i18n.use('ru');
  assert.match(ABCM.i18n.t('n', { count: 1 }), /one/);
  assert.match(ABCM.i18n.t('n', { count: 3 }), /few/);
  assert.match(ABCM.i18n.t('n', { count: 5 }), /many/);
  assert.match(ABCM.i18n.t('n', { count: 21 }), /one/);
});

test('init loads English plus the chosen language through the worker and survives a failure', async () => {
  const catalogs = { en: { a: 'A' }, de: { a: 'Ä' } };
  const { ABCM } = createEnv({
    files,
    url: 'https://chatgpt.com/',
    chromeOptions: { uiLanguage: 'de-AT', messages: { ABCM_GET_LOCALE: (m) => (catalogs[m.lang] ? { ok: true, catalog: catalogs[m.lang] } : { ok: false, error: 'missing' }) } }
  });
  assert.equal(await ABCM.i18n.init('auto'), 'de');
  assert.equal(ABCM.i18n.t('a'), 'Ä');
  assert.equal(await ABCM.i18n.init('fr'), 'fr', 'a language whose file cannot load still resolves');
  assert.equal(ABCM.i18n.t('a'), 'A', 'and falls back to English text');
});

test('translateTree fills text and attributes from data attributes', () => {
  const { ABCM, document } = createEnv({ files, html: '<body><p data-i18n="x"></p><button data-i18n-attr="title:y;aria-label:y"></button></body>' });
  ABCM.i18n._setCatalog('en', { x: 'Text', y: 'Label' });
  ABCM.i18n.use('en');
  ABCM.i18n.translateTree(document);
  assert.equal(document.querySelector('p').textContent, 'Text');
  assert.equal(document.querySelector('button').getAttribute('title'), 'Label');
  assert.equal(document.querySelector('button').getAttribute('aria-label'), 'Label');
});

test('every language file has exactly the English keys, placeholders and plural forms', () => {
  const en = locale('en');
  const placeholders = (value) => (typeof value === 'string' ? value : Object.values(value).join(' ')).match(/\{\w+\}/g)?.sort().join(',') ?? '';
  const { ABCM } = createEnv({ files });
  const problems = [];
  for (const { code } of ABCM.i18n.LANGUAGES) {
    const file = path.join(localesDir, `${code}.json`);
    if (!fs.existsSync(file)) { problems.push(`${code}: file is missing`); continue; }
    const data = locale(code);
    const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
    for (const key of Object.keys(en)) {
      if (!(key in data)) { problems.push(`${code}: missing ${key}`); continue; }
      const value = data[key];
      const source = en[key];
      if (typeof source === 'object') {
        if (typeof value !== 'object') { problems.push(`${code}: ${key} must be plural forms`); continue; }
        for (const category of categories) if (!(category in value)) problems.push(`${code}: ${key} lacks plural form "${category}"`);
        for (const [category, text] of Object.entries(value)) {
          if (!String(text).trim()) problems.push(`${code}: ${key}.${category} is empty`);
          if (placeholders(text) !== placeholders(source.other)) problems.push(`${code}: ${key}.${category} placeholders differ`);
        }
      } else {
        if (typeof value !== 'string' || !value.trim()) problems.push(`${code}: ${key} is empty or not text`);
        else if (placeholders(value) !== placeholders(source)) problems.push(`${code}: ${key} placeholders differ`);
      }
    }
    for (const key of Object.keys(data)) if (!(key in en)) problems.push(`${code}: extra key ${key}`);
  }
  assert.deepEqual(problems, []);
});

test('every key the code uses exists in English, and every English key is used', () => {
  const en = locale('en');
  const sources = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'locales') walk(full);
    else if (/\.(js|html)$/.test(entry.name) && entry.name !== 'i18n.js') sources.push(fs.readFileSync(full, 'utf8')); // i18n.js only documents the syntax
  });
  walk(path.join(extensionDir, 'src'));
  const text = sources.join('\n');
  const used = new Set();
  for (const m of text.matchAll(/\bt\(\s*'([\w.-]+)'/g)) used.add(m[1]);
  for (const m of text.matchAll(/data-i18n="([\w.-]+)"/g)) used.add(m[1]);
  for (const m of text.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(';').forEach((pair) => used.add(pair.split(':')[1].trim()));
  for (const m of text.matchAll(/'(popup|panel|options|settings|nudge|toast|confirm|result|running|launcher|page)\.[\w.-]+'/g)) used.add(m[0].slice(1, -1));
  // keys built from a template: t(`export.${format}`), t(`result.${verb}`), t(`running.${verb}`), reason.*
  ['export.json', 'export.csv', 'export.md', 'result.deleted', 'result.archived', 'running.deleting', 'running.archiving'].forEach((k) => used.add(k));
  for (const id of ['about', 'github', 'rate', 'support']) for (const part of ['label', 'message', 'cta']) used.add(`footer.${id}.${part}`);
  const missing = [...used].filter((key) => !(key in en) && !key.startsWith('reason.${'));
  assert.deepEqual(missing, [], 'keys used but not defined');
  const unused = Object.keys(en).filter((key) => !used.has(key) && !key.startsWith('reason.'));
  assert.deepEqual(unused, [], 'keys defined but never used');
});

test('every language also has the browser-level strings in _locales/<code>/messages.json', () => {
  const { ABCM } = createEnv({ files });
  const en = JSON.parse(fs.readFileSync(path.join(extensionDir, '_locales', 'en', 'messages.json'), 'utf8'));
  const problems = [];
  for (const { code } of ABCM.i18n.LANGUAGES) {
    const folder = code.replace('-', '_'); // browsers want pt_BR, not pt-BR
    const file = path.join(extensionDir, '_locales', folder, 'messages.json');
    if (!fs.existsSync(file)) { problems.push(`${folder}: _locales folder is missing`); continue; }
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of Object.keys(en)) if (!data[key]?.message?.trim()) problems.push(`${folder}: ${key} is missing`);
    if (data.app_name?.message !== 'AI Bulk Chat Manager') problems.push(`${folder}: app_name must stay the brand name`);
    if ((data.app_description?.message || '').length > 132) problems.push(`${folder}: app_description exceeds 132 characters`);
  }
  assert.deepEqual(problems, []);
});
