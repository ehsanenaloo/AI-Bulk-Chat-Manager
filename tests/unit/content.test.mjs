import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, sidebarHtml } from '../helpers/dom.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value));

const env = (site = 'chatgpt', count = 6, extra = {}) => {
  const urls = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/', gemini: 'https://gemini.google.com/app', grok: 'https://grok.com/' };
  const e = createEnv({ url: urls[site], html: sidebarHtml(site, count), ...extra });
  e.ABCM.i18n._setCatalog('en', { 'page.selectChat': 'Select chat' });
  return e;
};

test('dom helpers read ids, titles, absolute addresses and the row of a chat', () => {
  const { ABCM, document } = env();
  const anchors = ABCM.dom.getAllConversations();
  assert.equal(anchors.length, 6);
  const first = anchors[0];
  assert.equal(ABCM.dom.idFromElement(first), '00000000-0000-4000-8000-000000000001');
  assert.equal(ABCM.dom.idFromElement(first.firstElementChild), '00000000-0000-4000-8000-000000000001', 'a child resolves to its link');
  assert.equal(ABCM.dom.titleOf(first), 'Chat 1');
  assert.equal(ABCM.dom.urlOf(first), 'https://chatgpt.com/c/00000000-0000-4000-8000-000000000001');
  assert.equal(ABCM.dom.rowOf(first), document.querySelector('li'), 'the row is the <li>, which holds one chat link');
});

test('rowOf never grows past a container that holds several chats', () => {
  const { ABCM, document } = createEnv({
    url: 'https://claude.ai/',
    html: '<body><aside><div id="list"><div class="wrap"><div data-row><a href="/chat/0a1b2c3d-0000-4000-8000-000000000001">One</a><div><button aria-haspopup="menu"></button></div></div></div><div class="wrap"><div data-row><a href="/chat/0a1b2c3d-0000-4000-8000-000000000002">Two</a><div><button aria-haspopup="menu"></button></div></div></div></div></aside></body>'
  });
  const [a] = ABCM.dom.getAllConversations();
  const row = ABCM.dom.rowOf(a);
  assert.equal(row.querySelectorAll('a').length, 1);
  assert.ok(row.querySelector('button'), 'the sibling "..." button is inside the row');
  assert.equal(row.parentElement.querySelectorAll('a').length, 2, 'one step further up would contain both chats');
  void document;
});

test('state: selection tools work on visible chats in page order', () => {
  const { ABCM } = env('chatgpt', 8);
  ABCM.checkboxes.attachAll();
  const s = ABCM.state;
  assert.equal(s.visible().length, 8);
  assert.equal(s.selectVisible(), 8);
  assert.equal(s.selectedCount(), 8);
  assert.equal(s.clearSelection(), 8);
  s.setSelected(s.visible()[1].id, true);
  assert.equal(s.invertVisible(), 8);
  assert.equal(s.selectedCount(), 7);
  s.clearSelection();
  assert.equal(s.applyFilter('chat 1', 'select'), 1);
  assert.equal(s.applyFilter('CHAT', 'clear'), 8, 'matching is case-insensitive');
  assert.equal(s.selectedCount(), 0);
  assert.equal(s.applyFilter('', 'select'), 0, 'an empty filter selects nothing');
  assert.equal(s.applyOldest(3, 'select'), 3);
  assert.deepEqual(plain(s.selectedItems().map((i) => i.title)), ['Chat 6', 'Chat 7', 'Chat 8'], 'the last three, in page order');
  assert.equal(s.applyOldest('abc', 'clear'), 8 > 10 ? 0 : 8, 'a bad number falls back to 10 (all 8 here)');
  assert.equal(s.selectRange(s.visible()[2].id, s.visible()[4].id), 3);
  assert.equal(s.selectRange('nope', s.visible()[4].id), 0);
});

test('state: hidden rows are not "visible"; a row that left the page is dropped with its selection', () => {
  const { ABCM, document } = env('chatgpt', 4);
  ABCM.checkboxes.attachAll();
  const s = ABCM.state;
  document.querySelectorAll('a')[0].hidden = true;
  assert.equal(s.visible().length, 3);
  const gone = s.visible()[0];
  s.setSelected(gone.id, true);
  gone.anchor.closest('li').remove();
  s.prune();
  assert.equal(s.selectedCount(), 0);
  assert.equal(s.get(gone.id), null);
});

test('state: a re-rendered row is rebound and keeps its selection', () => {
  const { ABCM, document } = env('chatgpt', 3);
  ABCM.checkboxes.attachAll();
  const s = ABCM.state;
  const [first] = s.visible();
  const oldAnchor = first.anchor;
  s.setSelected(first.id, true);
  const li = first.anchor.closest('li');
  const replacement = document.createElement('li');
  replacement.innerHTML = `<a href="/c/${first.id}"><div class="relative grow overflow-hidden whitespace-nowrap">Chat 1</div></a>`;
  li.replaceWith(replacement);
  ABCM.state.prune();
  const rebound = s.get(first.id);
  assert.ok(rebound.anchor.isConnected && rebound.anchor !== oldAnchor);
  assert.equal(s.isSelected(first.id), true);
  assert.equal(rebound.checkbox.checked, true, 'the new checkbox shows the selection');
});

test('state notifies subscribers once per tick', async () => {
  const { ABCM } = env('chatgpt', 4);
  let calls = 0;
  ABCM.state.subscribe(() => { calls += 1; });
  ABCM.checkboxes.attachAll();
  ABCM.state.selectVisible();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 1);
});

test('checkboxes: one per row, space reserved, row style restored on removal', () => {
  const { ABCM, document } = env('chatgpt', 3);
  const a = document.querySelector('a');
  const li = document.querySelector('li');
  li.style.paddingLeft = '5px';
  const before = li.getAttribute('style');
  const aBefore = a.getAttribute('style');
  const result = ABCM.checkboxes.attachAll();
  assert.deepEqual([result.added, result.skipped, result.total], [3, 0, 3]);
  assert.equal(document.querySelectorAll('[data-abcm-checkbox]').length, 3);
  assert.equal(ABCM.checkboxes.attachAll().added, 0, 'running again adds nothing');
  assert.equal(document.querySelectorAll('[data-abcm-checkbox]').length, 3);
  assert.equal(li.querySelectorAll('[data-abcm-checkbox]').length, 1, 'one box per row, in the row (not inside the link)');
  assert.equal(a.querySelectorAll('[data-abcm-checkbox]').length, 0);
  assert.equal(a.getAttribute('style'), aBefore, 'the chat link itself is left alone');
  assert.ok(li.style.paddingInlineStart, 'space is reserved for the box');

  assert.equal(ABCM.checkboxes.removeAll(), 3);
  assert.equal(document.querySelectorAll('[data-abcm-checkbox]').length, 0);
  assert.equal(li.getAttribute('style'), before, 'the row style is restored');
  assert.equal(ABCM.state.get('00000000-0000-4000-8000-000000000001'), null, 'registry is cleared');
});

test('checkboxes: a click on a row toggles it and is not passed on to the site', () => {
  const { ABCM, document, window } = env('chatgpt', 3);
  let reachedSite = false;
  document.body.addEventListener('click', () => { reachedSite = true; });
  ABCM.checkboxes.attachAll();
  const a = document.querySelectorAll('a')[1];
  a.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(ABCM.state.selectedCount(), 1);
  assert.equal(reachedSite, false);
  a.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(ABCM.state.selectedCount(), 0);
  // the site's own "..." button keeps working
  const button = document.querySelectorAll('button')[1];
  const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  button.dispatchEvent(event);
  assert.equal(ABCM.state.selectedCount(), 0);
});

test('cleanupLeftovers removes what version 8 and an orphaned copy left in the page', () => {
  const { ABCM, document } = createEnv({
    html: '<body><nav><li><a href="/c/00000000-0000-4000-8000-000000000001" data-bulk-pad-applied="1" style="padding-left: 30px"><input type="checkbox" class="conversation-checkbox" data-bulk-checkbox="1"></a></li><div data-abcm-root></div></nav></body>'
  });
  const a = document.querySelector('a');
  a.dataset.bulkPadApplied = '1';
  a.dataset.bulkPrevPadLeft = '4px';
  ABCM.checkboxes.cleanupLeftovers();
  assert.equal(document.querySelectorAll('.conversation-checkbox, [data-abcm-root]').length, 0);
  assert.equal(a.style.paddingLeft, '4px');
});

test('exporter: JSON, CSV and Markdown, with spreadsheet-formula and Markdown escaping', () => {
  const { ABCM } = env();
  const items = [{ id: 'a1', title: '=HYPERLINK("http://x")', url: 'https://chatgpt.com/c/a1' }, { id: 'b2', title: 'Plan, "Q4" [draft]', url: 'https://chatgpt.com/c/b2' }];
  const when = new Date('2026-01-02T03:04:05Z');
  const json = JSON.parse(ABCM.exporter.build('json', items, { siteName: 'ChatGPT', exportedAt: when }));
  assert.deepEqual([json.count, json.site, json.exportedAt, json.chats[1].url], [2, 'ChatGPT', '2026-01-02T03:04:05.000Z', 'https://chatgpt.com/c/b2']);
  assert.ok(json.chats.length === 2);

  const csv = ABCM.exporter.build('csv', items);
  assert.ok(csv.startsWith('﻿title,url,id\r\n'), 'byte order mark and header');
  assert.ok(csv.includes('"\'=HYPERLINK(""http://x"")"'), 'formula neutralised and quotes doubled');
  assert.ok(csv.includes('"Plan, ""Q4"" [draft]"'));

  const md = ABCM.exporter.build('md', items, { siteName: 'ChatGPT' });
  assert.ok(md.startsWith('# ChatGPT chats (2)\n'));
  assert.ok(md.includes('\\[draft\\]'));

  assert.equal(ABCM.exporter.filename('csv', 'claude', when), 'ai-chats-claude-2026-01-02T03-04-05.csv');
  assert.throws(() => ABCM.exporter.build('xml', items));
});

test('label matching: Delete beats look-alikes, Remove-from-project is never a Delete, short words match whole words', () => {
  const { ABCM, document } = env();
  const mk = (text, attrs = '') => { const d = document.createElement('div'); d.innerHTML = `<div role="menuitem" ${attrs}>${text}</div>`; return d.firstChild; };
  const score = (text, op = 'DELETE') => ABCM.visualEngine.labelScore(mk(text), op);
  assert.ok(score('Delete') > score('Delete forever from the project'));
  assert.equal(score('Remove from project'), 0);
  assert.equal(score('Move to trash'), 0);
  assert.equal(score('Archive', 'DELETE'), 0);
  assert.ok(score('Archive', 'ARCHIVE') > 0);
  assert.ok(score('حذف') > 0, 'Arabic and Persian');
  assert.ok(score('删除聊天') > 0, 'Chinese');
  assert.ok(score('Löschen') > 0, 'German');
  assert.ok(score('بایگانی', 'ARCHIVE') > 0, 'Persian archive');
  assert.equal(score('Silent mode'), 0, 'the Turkish word "sil" does not match inside other words');
  assert.ok(score('Sil') > 0);
  assert.equal(score(''), 0, 'an empty item matches nothing');
  assert.equal(ABCM.visualEngine.labelScore(mk('', 'aria-label="Delete chat"'), 'DELETE') > 0, true, 'aria-label counts');
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  assert.equal(ABCM.visualEngine.labelScore(cancel, 'DELETE'), 0);
});

test('findMenuItem picks Delete over similar items and never an unrelated one', () => {
  const { ABCM, document } = env();
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.innerHTML = ['Share', 'Rename', 'Remove from project', 'Archive', 'Delete'].map((t) => `<div role="menuitem">${t}</div>`).join('');
  document.body.append(menu);
  assert.equal(ABCM.visualEngine.findMenuItem('DELETE', menu).textContent, 'Delete');
  assert.equal(ABCM.visualEngine.findMenuItem('ARCHIVE', menu).textContent, 'Archive');
  menu.innerHTML = ['Share', 'Rename'].map((t) => `<div role="menuitem">${t}</div>`).join('');
  assert.equal(ABCM.visualEngine.findMenuItem('DELETE', menu), null);
});

test('confirm dialog: only a button that matches the operation is ever clicked, never Cancel', async () => {
  const { ABCM, document } = env();
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.innerHTML = '<button id="cancel">Cancel</button><button id="ok">Delete</button>';
  document.body.append(dialog);
  const found = await ABCM.visualEngine.findConfirmButton('DELETE', 200, 'primary');
  assert.equal(found.button.id, 'ok');
  dialog.innerHTML = '<button id="cancel">Cancel</button><button id="x">Continue</button>';
  assert.equal(await ABCM.visualEngine.findConfirmButton('DELETE', 150, 'primary'), null, 'no matching button means no click');
});

test('exporter: a link target cannot break out of its Markdown link or point away from https', () => {
  const { ABCM } = env();
  const md = ABCM.exporter.build('md', [
    { id: 'a', title: 'x', url: 'https://chatgpt.com/c/1)![](https://evil.test/p.png)' },
    { id: 'b', title: 'y', url: 'javascript:alert(1)' }
  ]);
  assert.ok(!md.includes('![]('), md);
  assert.ok(md.includes('%29%21%5B%5D') || md.includes('%29!%5B%5D') || !md.includes(')![]'), md);
  assert.ok(md.includes('- [y]()'), 'a non-https address is dropped');
});

test('checkbox and row clicks that did not come from a person are ignored', () => {
  const { ABCM, document, window } = env('chatgpt', 3);
  ABCM.checkboxes.attachAll();
  ABCM.trustedOnly = true; // the page-facing default; jsdom events are never trusted
  document.querySelector('[data-abcm-checkbox]').click();
  document.querySelector('a').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(ABCM.state.selectedCount(), 0);
  ABCM.trustedOnly = false;
  document.querySelector('a').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(ABCM.state.selectedCount(), 1);
});
