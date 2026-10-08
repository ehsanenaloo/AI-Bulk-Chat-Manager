#!/usr/bin/env node
// Turns the Chrome/Edge extension in extension/ into the Firefox package.
//
// extension/manifest.json (the Chrome manifest) is never changed. This script reads it and writes a
// rewritten manifest, together with the same runtime files, into dist/firefox/.
//
//   node scripts/build-firefox.mjs          build dist/firefox/ and print a summary
//   node scripts/build-firefox.mjs --list   print the file list (one path per line)
//   node scripts/build-firefox.mjs --dir    print the output folder
//
// What differs for Firefox: the background is an event page listed as scripts (Firefox does not run
// service workers), the add-on id and minimum version are declared, the data-collection declaration
// AMO requires says "none", and the sites are declared as host permissions (Firefox asks for them at
// install, Chrome derives them from the content script matches).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRuntimeFiles } from './list-runtime-files.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const FIREFOX_ADDON_ID = 'ai-bulk-chat-manager@enaloo.com';
export const FIREFOX_MIN_VERSION = '140.0';
/** Same list as the importScripts() call at the top of background.js (a unit test keeps them equal). */
export const BACKGROUND_SCRIPTS = [
  'src/shared/namespace.js', 'src/shared/ext.js', 'src/shared/sites.js', 'src/shared/nudge.js', 'src/shared/inject.js', 'background.js'
];
const CHROME_ONLY_KEYS = ['minimum_chrome_version'];

/** Pure transformation of the Chrome manifest object into the Firefox manifest object. */
export function toFirefoxManifest(chromeManifest) {
  const manifest = structuredClone(chromeManifest);
  if (manifest.manifest_version !== 3) throw new Error('Expected a Manifest V3 source manifest.');
  if (!manifest.background?.service_worker) throw new Error('Source manifest has no background.service_worker to convert.');
  manifest.background = { scripts: [...BACKGROUND_SCRIPTS] };
  CHROME_ONLY_KEYS.forEach((key) => { delete manifest[key]; });
  manifest.host_permissions = [...new Set((manifest.content_scripts || []).flatMap((entry) => entry.matches || []))];
  manifest.browser_specific_settings = {
    gecko: {
      id: FIREFOX_ADDON_ID,
      strict_min_version: FIREFOX_MIN_VERSION,
      data_collection_permissions: { required: ['none'] }
    }
  };
  return manifest;
}

export function buildFirefox({ extensionDir = path.join(repoRoot, 'extension'), outDir = path.join(repoRoot, 'dist', 'firefox') } = {}) {
  const chromeManifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  const manifestText = `${JSON.stringify(toFirefoxManifest(chromeManifest), null, 2)}\n`;
  fs.rmSync(outDir, { recursive: true, force: true });
  const files = listRuntimeFiles(extensionDir);
  for (const rel of files) {
    const target = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (rel === 'manifest.json') fs.writeFileSync(target, manifestText);
    else fs.copyFileSync(path.join(extensionDir, rel), target);
  }
  return { outDir, files, version: chromeManifest.version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildFirefox();
  if (process.argv.includes('--dir')) console.log(result.outDir);
  else if (process.argv.includes('--list')) console.log(result.files.join('\n'));
  else console.log(`Firefox package ${result.version}: ${result.files.length} files in ${path.relative(repoRoot, result.outDir)}`);
}
