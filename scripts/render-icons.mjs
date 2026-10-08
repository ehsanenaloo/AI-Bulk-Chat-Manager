#!/usr/bin/env node
// Renders docs/assets/logo.svg into the extension's PNG icons (16/32/48/128) with Playwright's Chromium.
// Needs Playwright (npm i --no-save playwright). Only used when the logo changes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const svg = fs.readFileSync(path.join(root, 'docs', 'assets', 'logo.svg'), 'utf8');
const sizes = [16, 32, 48, 128];
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of sizes) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  const out = path.join(root, 'extension', 'icons', `icon-${size}.png`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', path.relative(root, out));
}
await browser.close();
