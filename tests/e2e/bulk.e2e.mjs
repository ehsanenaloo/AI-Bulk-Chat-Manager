// Delete, archive and the safety rules around them, against the fake chat sites.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openScenario, makeChats } from '../helpers/scenario.mjs';

async function pick(ui, indexes) {
  for (const i of indexes) await ui.checkbox(i).click();
}

test('chatgpt fast mode: confirm dialog, then PATCH with a bearer token; chosen chats only', async () => {
  const chats = makeChats(8);
  const ui = await openScenario('chatgpt', { chats });
  try {
    await ui.start();
    await pick(ui, [0, 2, 4]);
    await ui.button('Delete 3').click();

    const dialog = ui.page.getByRole('alertdialog');
    await dialog.waitFor();
    assert.match(await dialog.textContent(), /Delete 3 chats\?/);
    assert.match(await dialog.textContent(), /can't be undone/);
    assert.equal(await dialog.getByRole('button', { name: 'Cancel' }).evaluate((el) => el.getRootNode().activeElement === el), true, 'Cancel has focus, not the destructive button');
    await ui.confirmDelete();

    assert.equal(await ui.waitForResult(), '3 chats deleted');
    assert.deepEqual(new Set(ui.server.deleted), new Set([chats[0].id, chats[2].id, chats[4].id]));
    assert.ok(ui.server.requests.some((r) => r.startsWith('PATCH /backend-api/conversation/')), 'used the API');
    assert.ok(ui.server.requests.includes('BODY {"is_visible":false}'));
    assert.ok(!ui.server.requests.some((r) => r.includes('/__mock/delete')), 'did not drive the menus');
    // The rows are hidden, the rest are untouched and still selectable.
    assert.equal(await ui.page.locator('[data-list] .row:visible').count(), 5);
    await ui.button('Done').click();
    await ui.button('Select all').click();
    assert.equal(await ui.selectedCount(), 5);
    assert.deepEqual(ui.problems, []);
  } finally { await ui.close(); }
});

test('chatgpt archive goes through the API with is_archived', async () => {
  const chats = makeChats(5);
  const ui = await openScenario('chatgpt', { chats });
  try {
    await ui.start();
    await pick(ui, [1, 3]);
    await ui.page.locator('.footer').getByRole('button', { name: 'Archive' }).click();
    await ui.page.getByRole('alertdialog').getByRole('button', { name: /Archive 2 chats/ }).click();
    assert.equal(await ui.waitForResult(), '2 chats archived');
    assert.deepEqual(new Set(ui.server.archived), new Set([chats[1].id, chats[3].id]));
    assert.ok(ui.server.requests.includes('BODY {"is_archived":true}'));
  } finally { await ui.close(); }
});

test('Archive is offered on ChatGPT only', async () => {
  for (const site of ['claude', 'grok']) {
    const ui = await openScenario(site);
    try {
      await ui.start();
      assert.equal(await ui.page.locator('.footer').getByRole('button', { name: 'Archive' }).count(), 0, site);
    } finally { await ui.close(); }
  }
});

test('claude fast mode deletes through the organization endpoint', async () => {
  const chats = makeChats(6);
  const ui = await openScenario('claude', { chats });
  try {
    await ui.start();
    await pick(ui, [0, 1]);
    await ui.button('Delete 2').click();
    await ui.confirmDelete();
    assert.equal(await ui.waitForResult(), '2 chats deleted');
    assert.deepEqual(new Set(ui.server.deleted), new Set([chats[0].id, chats[1].id]));
    assert.ok(ui.server.requests.some((r) => r.startsWith('DELETE /api/organizations/org-1/chat_conversations/')));
  } finally { await ui.close(); }
});

test('grok fast mode deletes through its REST endpoint', async () => {
  const chats = makeChats(4);
  const ui = await openScenario('grok', { chats });
  try {
    await ui.start();
    await pick(ui, [3]);
    await ui.button('Delete 1').click();
    await ui.confirmDelete(/Delete 1 chat/);
    assert.equal(await ui.waitForResult(), '1 chat deleted');
    assert.ok(ui.server.requests.some((r) => r.startsWith('DELETE /rest/app-chat/conversations/')));
  } finally { await ui.close(); }
});

// With fast mode off (or no API, as on Gemini) the extension drives the page like a person would.
for (const site of ['chatgpt', 'claude', 'gemini', 'grok']) {
  test(`${site}: page-menu route deletes the chosen chats and nothing else`, async () => {
    const chats = makeChats(6);
    const ui = await openScenario(site, { chats, settings: { fastMode: false } });
    try {
      await ui.start();
      await pick(ui, [1, 4]);
      await ui.button('Delete 2').click();
      await ui.confirmDelete();
      assert.equal(await ui.waitForResult(), '2 chats deleted');
      assert.deepEqual(new Set(ui.server.deleted), new Set([chats[1].id, chats[4].id]));
      assert.ok(!ui.server.requests.some((r) => r.includes('/backend-api/') || r.includes('/chat_conversations/') || r.includes('/rest/app-chat/')), 'no API call was made');
      assert.equal(await ui.page.locator('[data-list] .row').count(), 4);
      assert.deepEqual(ui.problems, []);
    } finally { await ui.close(); }
  });
}

test('chatgpt menu route never picks "Remove from project" and archives through the menu', async () => {
  const chats = makeChats(4);
  const ui = await openScenario('chatgpt', { chats, settings: { fastMode: false } });
  try {
    await ui.start();
    await pick(ui, [0]);
    await ui.page.locator('.footer').getByRole('button', { name: 'Archive' }).click();
    await ui.page.getByRole('alertdialog').getByRole('button', { name: /Archive 1 chat/ }).click();
    assert.equal(await ui.waitForResult(), '1 chat archived');
    assert.deepEqual(ui.server.archived, [chats[0].id]);
    assert.deepEqual(ui.server.deleted, []);
  } finally { await ui.close(); }
});

test('failures are reported with a reason, stay selected, and can be retried', async () => {
  const chats = makeChats(5);
  const ui = await openScenario('chatgpt', { chats, failIds: [makeChats(5)[1].id] });
  try {
    await ui.start();
    await ui.button('Select all').click();
    await ui.button('Delete 5').click();
    await ui.confirmDelete();
    assert.equal(await ui.waitForResult(), '4 of 5 done, 1 failed');
    assert.match(await ui.page.locator('.fail-list').textContent(), /Project notes 2/);
    assert.match(await ui.page.locator('.fail-list').textContent(), /still in the list/);
    await ui.button('Retry failed').waitFor();
    assert.equal(ui.server.deleted.length, 4);

    ui.server.failIds.clear();
    await ui.button('Retry failed').click();
    await ui.page.getByRole('alertdialog').getByRole('button', { name: /Delete 1 chat/ }).click();
    assert.equal(await ui.waitForResult(), '1 chat deleted');
    assert.equal(ui.server.deleted.length, 5);
  } finally { await ui.close(); }
});

test('a rate limit pauses and retries instead of failing the chat', async () => {
  const chats = makeChats(3);
  const ui = await openScenario('chatgpt', { chats, rateLimitOnce: true });
  try {
    await ui.start();
    await ui.button('Select all').click();
    await ui.button('Delete 3').click();
    await ui.confirmDelete();
    assert.equal(await ui.waitForResult(), '3 chats deleted');
  } finally { await ui.close(); }
});

test('more than the threshold needs an acknowledgement tick before Delete is enabled', async () => {
  const chats = makeChats(25);
  const ui = await openScenario('chatgpt', { chats });
  try {
    await ui.start();
    await ui.button('Select all').click();
    await ui.button('Delete 25').click();
    const dialog = ui.page.getByRole('alertdialog');
    const confirm = dialog.getByRole('button', { name: /Delete 25 chats/ });
    await confirm.waitFor();
    assert.equal(await confirm.isDisabled(), true);
    await dialog.getByLabel(/I understand/).check();
    assert.equal(await confirm.isDisabled(), false);
    await ui.page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(ui.server.deleted.length, 0, 'cancelling deletes nothing');
  } finally { await ui.close(); }
});

test('Stop ends the run, keeps unfinished chats selected and says so', async () => {
  const chats = makeChats(12);
  const ui = await openScenario('chatgpt', { chats, settings: { fastMode: false } });
  try {
    await ui.start();
    await ui.button('Select all').click();
    await ui.button('Delete 12').click();
    await ui.confirmDelete();
    await ui.page.locator('.run-sub').filter({ hasText: /^[1-3] of 12/ }).waitFor({ timeout: 30000 });
    await ui.button('Stop').click();
    const title = await ui.waitForResult();
    assert.match(title, /Stopped after \d+ of 12/);
    const left = await ui.page.locator('[data-list] .row').count();
    assert.ok(left > 0 && left < 12, `some chats are left (${left})`);
    await ui.button('Done').click();
    assert.equal(await ui.selectedCount(), left, 'unfinished chats are still selected');
  } finally { await ui.close(); }
});

test('unticking a chat during a run skips it', async () => {
  const chats = makeChats(6);
  const ui = await openScenario('chatgpt', { chats, settings: { fastMode: false } });
  try {
    await ui.start();
    await ui.button('Select all').click();
    await ui.button('Delete 6').click();
    await ui.confirmDelete();
    await ui.checkbox(5).uncheck({ force: true });
    await ui.waitForResult();
    assert.ok(!ui.server.deleted.includes(chats[5].id), 'the unticked chat survived');
  } finally { await ui.close(); }
});

test('a row the site re-rendered during selection is rebound and still deleted', async () => {
  const chats = makeChats(4);
  const ui = await openScenario('chatgpt', { chats });
  try {
    await ui.start();
    await pick(ui, [2]);
    // Replace the row's DOM node the way a framework re-render would.
    await ui.page.evaluate(() => {
      const row = document.querySelectorAll('[data-list] .row')[2];
      const copy = row.cloneNode(true);
      // A real re-render gives brand-new nodes: no box, no reserved padding, no extension attributes.
      copy.querySelectorAll('[data-abcm-wrap]').forEach((n) => n.remove());
      [copy, ...copy.querySelectorAll('*')].forEach((el) => [...el.attributes].filter((a) => a.name.startsWith('data-abcm')).forEach((a) => el.removeAttribute(a.name)));
      copy.removeAttribute('style');
      row.replaceWith(copy);
    });
    await ui.button('Delete 1').click();
    await ui.confirmDelete(/Delete 1 chat/);
    assert.equal(await ui.waitForResult(), '1 chat deleted');
    assert.deepEqual(ui.server.deleted, [chats[2].id]);
  } finally { await ui.close(); }
});

test('a script on the site cannot press the panel buttons (only real input counts)', async () => {
  const chats = makeChats(3);
  const ui = await openScenario('chatgpt', { chats });
  try {
    await ui.start();
    await ui.button('Select all').click();
    // From the page's own world, try to open the delete confirmation and to confirm it.
    await ui.page.evaluate(() => {
      const root = document.querySelector('[data-abcm-root]').shadowRoot;
      root.querySelector('.btn-delete').click();
      root.querySelector('.btn-delete').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await ui.page.waitForTimeout(400);
    assert.equal(await ui.page.getByRole('alertdialog').count(), 0, 'no confirmation opened');
    // Open it properly, then try to confirm from the page.
    await ui.button('Delete 3').click();
    await ui.page.getByRole('alertdialog').waitFor();
    await ui.page.evaluate(() => {
      const root = document.querySelector('[data-abcm-root]').shadowRoot;
      root.querySelector('.dialog-actions .btn-danger').click();
    });
    await ui.page.waitForTimeout(600);
    assert.deepEqual(ui.server.deleted, [], 'nothing was deleted');
  } finally { await ui.close(); }
});
