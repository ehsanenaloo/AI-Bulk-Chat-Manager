#!/usr/bin/env node
// Builds the release packages into dist/:
//   ai-bulk-chat-manager-<version>.zip           Chrome and Edge (manifest.json at the zip root)
//   ai-bulk-chat-manager-<version>-firefox.zip   Firefox
// each with a .sha256 file. LICENSE is added at the root of every zip.
//
//   node scripts/build.mjs                build both
//   node scripts/build.mjs --chrome       Chrome/Edge only
//   node scripts/build.mjs --firefox      Firefox only
//
// Local builds are for testing. Nothing here uploads anything.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from './lib/zip.mjs';
import { listRuntimeFiles } from './list-runtime-files.mjs';
import { buildFirefox } from './build-firefox.mjs';
import { validate } from './validate.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(repoRoot, 'dist');

function zipFolder(folder, files, zipPath) {
  const entries = files.map((name) => ({ name, data: fs.readFileSync(path.join(folder, name)) }));
  entries.push({ name: 'LICENSE', data: fs.readFileSync(path.join(repoRoot, 'LICENSE')) });
  const buffer = createZip(entries);
  fs.writeFileSync(zipPath, buffer);
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  fs.writeFileSync(`${zipPath}.sha256`, `${sha}  ${path.basename(zipPath)}\n`);
  return { zip: path.relative(repoRoot, zipPath), files: entries.length, bytes: buffer.length, sha256: sha };
}

const wantChrome = !process.argv.includes('--firefox');
const wantFirefox = !process.argv.includes('--chrome');

const { errors } = validate(repoRoot);
if (errors.length) { console.error(`Cannot build: validate found ${errors.length} problem(s). Run "node scripts/validate.mjs".`); process.exit(1); }

const version = JSON.parse(fs.readFileSync(path.join(repoRoot, 'extension', 'manifest.json'), 'utf8')).version;
fs.mkdirSync(dist, { recursive: true });
const out = [];
if (wantChrome) out.push(zipFolder(path.join(repoRoot, 'extension'), listRuntimeFiles(), path.join(dist, `ai-bulk-chat-manager-${version}.zip`)));
if (wantFirefox) {
  const built = buildFirefox();
  out.push(zipFolder(built.outDir, built.files, path.join(dist, `ai-bulk-chat-manager-${version}-firefox.zip`)));
}
console.log(JSON.stringify(out, null, 2));
