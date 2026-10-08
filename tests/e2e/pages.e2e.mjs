// The popup, the options page and settings that reach the in-page panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openScenario } from '../helpers/scenario.mjs';

test('popup on a supported page shows the site, starts selection and rotates its footer', async () => {
  const ui = await openScenario('claude');
  try {
    const popup = await ui.ext.openPopup(ui.page, 'https://claude.ai/');
    await popup.getByText('Ready on Claude').waitFor();
    assert.equal(await popup.locator('#version').textContent(), 'v9.0.0');
    assert.equal(await popup.locator('#sw-fast').getAttribute('aria-checked'), 'true');

    // footer: About is first, tabs switch the message, and it rotates by itself
    assert.match(await popup.locator('#footer-message').textContent(), /Released under the MIT License/);
    await popup.locator('.footer-nav-btn', { hasText: 'Rate' }).click();
    assert.equal(await popup.locator('#footer-cta').textContent(), 'Rate on Store');
    assert.equal(await popup.locator('.footer-nav-btn.active').textContent(), 'Rate');
    await popup.waitForTimeout(5400);
    assert.equal(await popup.locator('.footer-nav-btn.active').textContent(), 'Support', 'it moved on after five seconds');
    await popup.locator('#footer-dock').hover().catch(() => {});

    await popup.getByRole('button', { name: 'Start selecting chats' }).click();
    await ui.page.locator('.panel').waitFor({ state: 'visible' });
    assert.equal(await ui.page.locator('[data-abcm-checkbox]').count(), 12);
  } finally { await ui.close(); }
});

test('popup on an unsupported page lists the supported sites', async () => {
  const ui = await openScenario('chatgpt');
  try {
    const popup = await ui.ext.openPopup(ui.page, 'https://example.com/');
    await popup.getByText("This page isn't supported").waitFor();
    assert.deepEqual(await popup.locator('#site-grid .btn').allTextContents(), ['ChatGPT', 'Claude', 'Gemini', 'Grok']);
    assert.equal(await popup.locator('#start').isVisible(), false);
  } finally { await ui.close(); }
});

test('popup switches write to the shared settings', async () => {
  const ui = await openScenario('chatgpt');
  try {
    const popup = await ui.ext.openPopup(ui.page, 'https://chatgpt.com/');
    await popup.getByText('Ready on ChatGPT').waitFor();
    await popup.locator('#sw-fast').click();
    const stored = await ui.ext.worker.evaluate(() => new Promise((r) => chrome.storage.local.get('settings', (v) => r(v.settings))));
    assert.equal(stored.fastMode, false);
  } finally { await ui.close(); }
});

test('options: language list, theme, accent and threshold persist; reset restores defaults', async () => {
  const ui = await openScenario('chatgpt');
  try {
    const page = await ui.ext.context.newPage();
    await page.goto(ui.ext.extensionUrl('src/options/options.html'));
    await page.locator('#language option').nth(11).waitFor({ state: 'attached' });
    const options = await page.locator('#language option').allTextContents();
    assert.equal(options.length, 12, 'automatic plus 11 languages');
    assert.ok(options.includes('فارسی') && options.includes('日本語'));

    await page.getByRole('radio', { name: 'Dark' }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.getByRole('radio', { name: 'Indigo' }).click();
    assert.equal(await page.locator('html').getAttribute('data-accent'), 'indigo');
    await page.locator('#threshold').fill('7');
    await page.locator('#threshold').blur();
    await page.locator('#sw-launcher').click();

    const stored = await ui.ext.worker.evaluate(() => new Promise((r) => chrome.storage.local.get('settings', (v) => r(v.settings))));
    assert.deepEqual([stored.theme, stored.accent, stored.confirmThreshold, stored.showLauncher], ['dark', 'indigo', 7, true]);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Reset settings' }).click();
    await page.getByText('Settings were reset.').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-accent'), 'teal');
    assert.equal(await page.locator('#threshold').inputValue(), '20');
  } finally { await ui.close(); }
});

test('a setting changed in the options page reaches an open chat page without a reload', async () => {
  const ui = await openScenario('chatgpt');
  try {
    await ui.start();
    assert.equal(await ui.page.locator('[data-abcm-root]').getAttribute('data-theme'), 'light');
    const options = await ui.ext.context.newPage();
    await options.goto(ui.ext.extensionUrl('src/options/options.html'));
    await options.getByRole('radio', { name: 'Dark' }).click();
    await options.getByRole('radio', { name: 'Blue' }).click();
    await ui.page.waitForFunction(() => document.querySelector('[data-abcm-root]').getAttribute('data-theme') === 'dark');
    assert.equal(await ui.page.locator('[data-abcm-root]').getAttribute('data-accent'), 'blue');
  } finally { await ui.close(); }
});

test('the optional launcher button opens the panel and is hidden while the panel is open', async () => {
  const ui = await openScenario('chatgpt', { settings: { showLauncher: true } });
  try {
    const launcher = ui.page.getByRole('button', { name: 'Open AI Bulk Chat Manager' });
    await launcher.waitFor({ state: 'visible' });
    assert.equal(await ui.page.locator('.panel').isVisible(), false);
    await launcher.click();
    await ui.page.locator('.panel').waitFor({ state: 'visible' });
    assert.equal(await launcher.isVisible(), false);
    await ui.button('Finish and close').click();
    await launcher.waitFor({ state: 'visible' });
    assert.equal(await ui.page.locator('[data-abcm-checkbox]').count(), 0);
  } finally { await ui.close(); }
});

test('Load all older chats scrolls the list until nothing new arrives, then restores the scroll position', async () => {
  const ui = await openScenario('chatgpt');
  try {
    // Make the fake sidebar load 15 more chats each time it is scrolled to the bottom, until there are 42.
    await ui.page.evaluate(() => {
      const side = document.getElementById('side');
      side.style.overflow = 'auto';
      side.style.height = '300px';
      let loaded = 12;
      side.addEventListener('scroll', () => {
        if (side.scrollTop + side.clientHeight >= side.scrollHeight - 4 && loaded < 40) {
          const more = Array.from({ length: 15 }, (_, i) => ({ id: `11111111-0000-4000-8000-${String(loaded + i).padStart(12, '0')}`, title: `Older chat ${loaded + i}` }));
          loaded += 15;
          window.__addChats(more);
        }
      });
    });
    await ui.start();
    await ui.button('Load all older chats').click();
    await ui.page.locator('.toast', { hasText: '42 chats in the list' }).waitFor({ timeout: 30000 });
    assert.equal(await ui.page.locator('[data-abcm-checkbox]').count(), 42);
    assert.equal(await ui.page.evaluate(() => document.getElementById('side').scrollTop), 0);
    await ui.button('Select all').click();
    assert.equal(await ui.selectedCount(), 42);
  } finally { await ui.close(); }
});
