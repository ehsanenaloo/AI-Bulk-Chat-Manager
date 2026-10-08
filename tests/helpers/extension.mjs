// Starts a real Chromium with the unpacked extension and a throwaway profile, for the browser tests.
// Needs Playwright (npm i --no-save playwright && npx playwright install chromium).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const extensionDir = process.env.EXTENSION_DIR ? path.resolve(process.env.EXTENSION_DIR) : path.join(repoRoot, 'extension');

/** Returns Playwright's chromium launcher, or null when Playwright is not installed. */
export async function loadChromium() {
  try {
    const modulePath = process.env.PLAYWRIGHT_MODULE;
    const mod = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
    return mod.chromium || mod.default?.chromium || null;
  } catch (error) {
    if (!/Cannot find (?:package|module)|ERR_MODULE_NOT_FOUND/.test(String(error?.code || '') + String(error?.message || ''))) console.error(`Could not load Playwright: ${error.message}`);
    return null;
  }
}

export async function launchExtension({ headless = true, viewport = { width: 1280, height: 800 }, locale = 'en-US', colorScheme = 'light', deviceScaleFactor = 1 } = {}) {
  const chromium = await loadChromium();
  if (!chromium) throw new Error('Playwright is not installed. Run: npm i --no-save playwright && npx playwright install chromium');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abcm-profile-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    headless,
    viewport,
    locale,
    colorScheme,
    deviceScaleFactor,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;

  /** Sends a message to the content script of the page that is currently in front. */
  async function tabMessage(page, message) {
    await page.bringToFront();
    return worker.evaluate(async (msg) => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return new Promise((resolve) => chrome.tabs.sendMessage(tabs[0].id, msg, (reply) => resolve(reply ?? { error: chrome.runtime.lastError?.message })));
    }, message);
  }

  /** The browser's id for the tab that is in front (page.bringToFront first). */
  async function activeTabId(page) {
    await page.bringToFront();
    return worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
  }

  /**
   * Opens the toolbar popup as an ordinary tab. A popup normally reads the tab that was in front when
   * it opened, so the query is pointed at `chatPage` (its real id and address) and everything else is real.
   */
  async function openPopup(chatPage, url = chatPage.url()) {
    const tabId = await activeTabId(chatPage);
    const popup = await context.newPage();
    await popup.addInitScript(({ tabId: id, url: address }) => {
      chrome.tabs.query = (info, callback) => callback([{ id, url: address, active: true }]);
    }, { tabId, url });
    await popup.setViewportSize({ width: 340, height: 560 });
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    return popup;
  }

  return {
    context, worker, extensionId, tabMessage, activeTabId, openPopup,
    extensionUrl: (p) => `chrome-extension://${extensionId}/${p}`,
    async close() {
      await context.close().catch(() => {});
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  };
}
