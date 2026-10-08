import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { repoRoot, extensionDir } from '../helpers/paths.mjs';
import { toFirefoxManifest, BACKGROUND_SCRIPTS, buildFirefox, FIREFOX_ADDON_ID } from '../../scripts/build-firefox.mjs';
import { createZip, listZip } from '../../scripts/lib/zip.mjs';
import { listRuntimeFiles } from '../../scripts/list-runtime-files.mjs';
import { validate } from '../../scripts/validate.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));

test('the repository passes its own validation', () => {
  const { errors } = validate(repoRoot);
  assert.deepEqual(errors, []);
});

test('Firefox manifest: event page, add-on id, host permissions, no Chrome-only keys; the Chrome manifest is untouched', () => {
  const before = JSON.stringify(manifest);
  const firefox = toFirefoxManifest(manifest);
  assert.equal(JSON.stringify(manifest), before, 'the input is not modified');
  assert.deepEqual(firefox.background, { scripts: BACKGROUND_SCRIPTS });
  assert.equal(firefox.browser_specific_settings.gecko.id, FIREFOX_ADDON_ID);
  assert.deepEqual(firefox.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'] });
  assert.ok(!('minimum_chrome_version' in firefox));
  assert.deepEqual(firefox.host_permissions, manifest.content_scripts[0].matches);
  assert.deepEqual(firefox.permissions, manifest.permissions);
  assert.equal(firefox.version, manifest.version);
  assert.throws(() => toFirefoxManifest({ ...manifest, manifest_version: 2 }));
});

test('the Firefox background script list equals the importScripts() list of background.js', () => {
  const source = fs.readFileSync(path.join(extensionDir, 'background.js'), 'utf8');
  const call = source.match(/importScripts\(([^)]*)\)/)[1];
  const imported = [...call.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...imported, 'background.js'], BACKGROUND_SCRIPTS);
  for (const file of BACKGROUND_SCRIPTS) assert.ok(fs.existsSync(path.join(extensionDir, file)), file);
});

test('buildFirefox writes the runtime files with the rewritten manifest', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'abcm-ff-'));
  try {
    const result = buildFirefox({ outDir: out });
    assert.equal(result.version, manifest.version);
    const written = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.ok(written.background.scripts);
    for (const file of result.files) assert.ok(fs.existsSync(path.join(out, file)), file);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('zip writer: round trip, deterministic, UTF-8 names, correct data', () => {
  const entries = [
    { name: 'manifest.json', data: Buffer.from('{"a":1}') },
    { name: 'src/ü.txt', data: Buffer.from('x'.repeat(5000)) },
    { name: 'empty.txt', data: Buffer.alloc(0) }
  ];
  const a = createZip(entries);
  const b = createZip([...entries].reverse());
  assert.deepEqual(a, b, 'the same input always gives the same bytes');
  assert.deepEqual(listZip(a), ['empty.txt', 'manifest.json', 'src/ü.txt']);
  // read the compressed data of the big entry back
  const eocd = a.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = a.readUInt32LE(eocd + 16);
  for (let i = 0; i < 3; i += 1) {
    const method = a.readUInt16LE(p + 10);
    const size = a.readUInt32LE(p + 20);
    const nameLen = a.readUInt16LE(p + 28);
    const local = a.readUInt32LE(p + 42);
    const name = a.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (name === 'src/ü.txt') {
      const start = local + 30 + a.readUInt16LE(local + 26) + a.readUInt16LE(local + 28);
      const body = a.subarray(start, start + size);
      assert.equal(method, 8);
      assert.equal(zlib.inflateRawSync(body).toString(), 'x'.repeat(5000));
    }
    p += 46 + nameLen;
  }
});

test('the package contains exactly the runtime files and nothing from the development tree', () => {
  const files = listRuntimeFiles();
  assert.ok(files.includes('manifest.json') && files.includes('background.js'));
  assert.ok(files.every((f) => !/^(tests|docs|scripts|technical-docs|tools|build|node_modules)\//.test(f)));
});

test('the popup has a fixed pixel width (a popup sizes itself from its content, so vw or max-width: 100vw collapses it)', () => {
  const css = fs.readFileSync(path.join(extensionDir, 'src', 'popup', 'popup.css'), 'utf8');
  const body = css.match(/^body\s*\{([^}]*)\}/m)?.[1] || '';
  assert.match(body, /width:\s*340px/);
  assert.ok(!/\bv[wh]\b|\d\s*v[wh]/.test(body), body);
});
