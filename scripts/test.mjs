#!/usr/bin/env node
// Runs the unit tests (tests/unit/*.test.mjs) with Node's built-in test runner.
//   node scripts/test.mjs            run everything
//   node scripts/test.mjs i18n       only files whose name contains "i18n"
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'tests', 'unit');
const filter = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const files = fs.readdirSync(dir).filter((name) => name.endsWith('.test.mjs') && (!filter || name.includes(filter))).map((name) => path.join('tests', 'unit', name));

if (!files.length) { console.error('No unit test files found.'); process.exit(1); }
try { await import('jsdom'); } catch { console.error('jsdom is not installed. Run "npm install" first.'); process.exit(1); }

const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
