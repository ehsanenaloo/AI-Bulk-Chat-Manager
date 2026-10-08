// Shared set-up for the browser tests: launches the extension, serves a fake chat site, opens it and
// gives short helpers for driving the in-page panel.
import { launchExtension } from './extension.mjs';
import { serveMockSite, makeChats } from '../fixtures/mock-site.mjs';

export const START_URL = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/',
  gemini: 'https://gemini.google.com/app',
  grok: 'https://grok.com/'
};

export async function openScenario(siteId = 'chatgpt', { chats = makeChats(12), settings = null, dark = false, dir = 'ltr', failIds = [], rateLimitOnce = false, locale = 'en-US', colorScheme = 'light' } = {}) {
  const ext = await launchExtension({ locale, colorScheme: dark ? 'dark' : colorScheme });
  const server = await serveMockSite(ext.context, siteId, { chats, dark, dir, failIds, rateLimitOnce });

  if (settings) {
    // Seed settings through an extension page, before the chat page loads.
    const page = await ext.context.newPage();
    await page.goto(ext.extensionUrl('src/options/options.html'));
    await page.evaluate((value) => new Promise((resolve) => chrome.storage.local.set({ settings: value }, resolve)), settings);
    await page.close();
  }

  const page = await ext.context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') problems.push(`console: ${message.text()}`); });
  await page.goto(START_URL[siteId]);
  await page.waitForSelector('[data-list] .row');

  const ui = {
    ext, server, page, problems,
    panel: page.locator('.panel'),
    rows: page.locator('[data-list] .row'),
    checkbox: (n) => page.locator('[data-list] .row').nth(n).locator('[data-abcm-checkbox]'),
    async start() {
      const reply = await ext.tabMessage(page, { type: 'ABCM_START' });
      await page.locator('.panel').waitFor({ state: 'visible' });
      return reply;
    },
    async stop() { return ext.tabMessage(page, { type: 'ABCM_STOP' }); },
    async selectedCount() { return Number((await page.locator('.count-num').textContent()).replace(/[^\d]/g, '') || 0); },
    button: (name) => page.getByRole('button', { name, exact: false }),
    async confirmDelete(name = /Delete \d+ chats?/) {
      await page.getByRole('alertdialog').waitFor();
      await page.getByRole('alertdialog').getByRole('button', { name }).click();
    },
    async waitForResult() { await page.locator('.result-head').waitFor({ state: 'visible', timeout: 30000 }); return (await page.locator('.result-head .run-title').textContent()).trim(); },
    async close() { await ext.close(); }
  };
  return ui;
}

export { makeChats };
