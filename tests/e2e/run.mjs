#!/usr/bin/env node
// Runs the Chromium browser tests (tests/e2e/*.e2e.mjs) one file at a time.
//
//   node tests/e2e/run.mjs              run everything (skips politely when Playwright is missing)
//   node tests/e2e/run.mjs --require    fail instead of skipping
//   node tests/e2e/run.mjs bulk         only files whose name contains "bulk"
//
// Needs Playwright: npm i --no-save playwright && npx playwright install chromium
// The tests use a throwaway browser profile and fake chat sites; see tests/e2e/README.md.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChromium } from '../helpers/extension.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const require = args.includes('--require');
const filter = args.find((arg) => !arg.startsWith('--'));
const files = fs.readdirSync(here).filter((name) => name.endsWith('.e2e.mjs') && (!filter || name.includes(filter))).map((name) => path.join(here, name));

if (!files.length) { console.error(`No browser test matches "${filter}".`); process.exit(1); }
if (!(await loadChromium())) {
  const message = 'Playwright is not installed. Run "npm i --no-save playwright" and "npx playwright install chromium".';
  if (require) { console.error(`Browser tests cannot run: ${message}`); process.exit(1); }
  console.log(`Browser tests skipped. ${message}`);
  process.exit(0);
}
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
