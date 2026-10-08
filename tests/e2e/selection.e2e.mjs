// Selection mode in a real browser: checkboxes, the panel's selection tools, and clean-up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openScenario } from '../helpers/scenario.mjs';

for (const site of ['chatgpt', 'claude', 'gemini', 'grok']) {
  test(`${site}: starting adds one checkbox per chat and stopping removes every trace`, async () => {
    const ui = await openScenario(site);
    try {
      const before = await ui.page.evaluate(() => document.querySelector('[data-list] a').getAttribute('style'));
      const reply = await ui.start();
      assert.equal(reply.ok, true);
      assert.equal(reply.visible, 12);
      assert.equal(await ui.page.locator('[data-abcm-checkbox]').count(), 12);
      assert.match(await ui.panel.locator('.count-sub').textContent(), /of 12 chats shown/);

      await ui.button('Finish and close').click();
      await ui.panel.waitFor({ state: 'hidden' });
      assert.equal(await ui.page.locator('[data-abcm-checkbox]').count(), 0);
      const after = await ui.page.evaluate(() => document.querySelector('[data-list] a').getAttribute('style'));
      assert.equal(after || '', before || '', 'the row style is restored');
      assert.deepEqual(ui.problems, []);
    } finally { await ui.close(); }
  });
}

test('panel selection tools: all, clear, invert, title filter, oldest N', async () => {
  const ui = await openScenario('chatgpt');
  try {
    await ui.start();
    await ui.button('Select all').click();
    assert.equal(await ui.selectedCount(), 12);
    await ui.button('Clear').click();
    assert.equal(await ui.selectedCount(), 0);

    await ui.checkbox(0).click();
    await ui.checkbox(1).click();
    assert.equal(await ui.selectedCount(), 2);
    await ui.button('Invert').click();
    assert.equal(await ui.selectedCount(), 10);
    assert.equal(await ui.checkbox(0).isChecked(), false);
    assert.equal(await ui.checkbox(5).isChecked(), true);
    await ui.button('Clear').click();

    await ui.page.getByText('Select by title or position').click();
    await ui.page.getByPlaceholder('Part of a chat title').fill('notes 1');
    await ui.page.locator('.more-row').first().getByRole('button', { name: 'Select', exact: true }).click();
    assert.equal(await ui.selectedCount(), 4, 'matches notes 1, 10, 11 and 12');
    await ui.button('Clear').click();

    await ui.page.getByLabel('Oldest').fill('3');
    await ui.page.locator('.more-row.with-label').getByRole('button', { name: 'Select', exact: true }).click();
    assert.equal(await ui.selectedCount(), 3);
    assert.equal(await ui.checkbox(11).isChecked(), true, 'the last rows are the oldest');
    assert.equal(await ui.checkbox(8).isChecked(), false);
  } finally { await ui.close(); }
});

test('clicking a row toggles it instead of opening the chat; Shift-click selects a range', async () => {
  const ui = await openScenario('claude');
  try {
    await ui.start();
    await ui.rows.nth(2).locator('a').click({ position: { x: 60, y: 8 } });
    assert.equal(await ui.selectedCount(), 1);
    assert.equal(await ui.page.evaluate(() => window.__navigated || 0), 0, 'the click did not reach the site');
    assert.equal(await ui.page.locator('[data-abcm-selected]').count(), 1);

    await ui.checkbox(6).click({ modifiers: ['Shift'] });
    assert.equal(await ui.selectedCount(), 5, 'rows 3 to 7 are selected');
    assert.equal(await ui.checkbox(4).isChecked(), true);
  } finally { await ui.close(); }
});

test('chats the site loads later get checkboxes (auto-load) and the count follows', async () => {
  const ui = await openScenario('chatgpt');
  try {
    await ui.start();
    await ui.page.evaluate(() => window.__addChats([{ id: '99999999-0000-4000-8000-000000000001', title: 'Loaded later' }]));
    await ui.page.waitForSelector('[data-list] .row:nth-child(13) [data-abcm-checkbox]');
    assert.match(await ui.panel.locator('.count-sub').textContent(), /of 13 chats shown/);
  } finally { await ui.close(); }
});

test('with auto-load off, new chats are picked up by Refresh-less start only', async () => {
  const ui = await openScenario('chatgpt', { settings: { autoLoad: false } });
  try {
    await ui.start();
    await ui.page.evaluate(() => window.__addChats([{ id: '99999999-0000-4000-8000-000000000002', title: 'Loaded later' }]));
    await ui.page.waitForTimeout(700);
    assert.equal(await ui.page.locator('[data-abcm-checkbox]').count(), 12);
  } finally { await ui.close(); }
});

test('the panel can be minimized, dragged and keeps its place', async () => {
  const ui = await openScenario('chatgpt');
  try {
    await ui.start();
    await ui.button('Minimize').click();
    assert.equal(await ui.panel.getAttribute('data-collapsed'), 'true');
    await ui.button('Expand').click();
    const head = ui.page.locator('.head');
    const box = await head.boundingBox();
    await ui.page.mouse.move(box.x + 60, box.y + 12);
    await ui.page.mouse.down();
    await ui.page.mouse.move(box.x - 300, box.y - 200, { steps: 6 });
    await ui.page.mouse.up();
    const moved = await ui.panel.boundingBox();
    assert.ok(moved.x < box.x - 200, 'moved left');
    const stored = await ui.ext.worker.evaluate(() => new Promise((r) => chrome.storage.local.get('settings', (v) => r(v.settings))));
    assert.ok(stored.panelPosition, 'position saved');
  } finally { await ui.close(); }
});

// What the box looks like, read from the computed styles of the page (not from the extension's code).
const BOX_LOOK = () => {
  const wrap = document.querySelector('[data-abcm-wrap]');
  const s = getComputedStyle(wrap);
  const r = wrap.getBoundingClientRect();
  const tick = getComputedStyle(wrap.querySelector('[data-abcm-tick]'));
  return { width: r.width, height: r.height, border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`, radius: s.borderTopLeftRadius, background: s.backgroundColor, tick: tick.display, opacity: s.opacity, visibility: s.visibility };
};

test('checkboxes stay visible when the site hides form controls, and the chat link keeps its own layout', async () => {
  const ui = await openScenario('chatgpt');
  try {
    // What ChatGPT really does: every checkbox gets appearance:none (an invisible box), and the chat
    // link is a static element whose ::before overlay stretches over the whole row.
    await ui.page.addStyleTag({ content: 'input[type="checkbox"]{appearance:none!important;-webkit-appearance:none!important;border:0!important;opacity:0!important}' });
    const before = await ui.page.evaluate(() => getComputedStyle(document.querySelector('[data-list] a')).position);
    await ui.start();
    const look = await ui.page.evaluate(BOX_LOOK);
    assert.deepEqual([look.width, look.height, look.border, look.opacity, look.visibility, look.tick], [18, 18, '2px solid rgb(122, 142, 152)', '1', 'visible', 'none']);
    assert.equal(await ui.page.evaluate(() => getComputedStyle(document.querySelector('[data-list] a')).position), before, 'the chat link was not repositioned');
    assert.equal(await ui.page.evaluate(() => !!document.querySelector('[data-list] a [data-abcm-wrap]')), false, 'the box is not inside the link');
    await ui.checkbox(0).click();
    assert.equal(await ui.selectedCount(), 1);
    const on = await ui.page.evaluate(BOX_LOOK);
    assert.deepEqual([on.background, on.border, on.tick], ['rgb(14, 124, 149)', '2px solid rgb(14, 124, 149)', 'block']);
    assert.equal(await ui.page.evaluate(() => document.querySelectorAll('[data-abcm-selected]').length), 1);
    await ui.button('Finish and close').click();
    assert.equal(await ui.page.evaluate(() => document.querySelectorAll('[data-abcm-selected], [data-abcm-wrap], [data-abcm-checkbox], [data-abcm-pad]').length), 0, 'no trace is left on the page');
  } finally { await ui.close(); }
});

test('the checkbox looks exactly the same on ChatGPT, Claude, Gemini and Grok, ticked and not', async () => {
  const looks = {};
  for (const site of ['chatgpt', 'claude', 'gemini', 'grok']) {
    const ui = await openScenario(site);
    try {
      await ui.start();
      const off = await ui.page.evaluate(BOX_LOOK);
      await ui.checkbox(1).click();
      const on = await ui.page.evaluate(() => { const w = document.querySelectorAll('[data-abcm-wrap]')[1]; const s = getComputedStyle(w); return { background: s.backgroundColor, border: s.borderTopColor, tick: getComputedStyle(w.querySelector('[data-abcm-tick]')).display }; });
      looks[site] = { off, on };
    } finally { await ui.close(); }
  }
  const first = JSON.stringify(looks.chatgpt);
  for (const site of ['claude', 'gemini', 'grok']) assert.equal(JSON.stringify(looks[site]), first, `${site} matches ChatGPT`);
});
