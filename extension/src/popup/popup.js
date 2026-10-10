/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Toolbar popup: a small control centre. It shows whether the current tab is a supported chat page,
  starts or stops selection mode there (the selection tools themselves live in the in-page panel),
  and holds the two quick preferences and the links.
*/
(function (g) {
  'use strict';
  const ABCM = g.ABCM;
  const t = (key, params) => ABCM.i18n.t(key, params);
  const $ = (id) => g.document.getElementById(id);
  const make = (tag, className, text) => {
    const node = g.document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  let tab = null;
  let site = null;
  let reply = null; // ping reply of the tab's content script, when it has one

  function setStatus(state, iconName, title, sub) {
    $('status').dataset.state = state;
    $('status-icon').replaceChildren(ABCM.icons.icon(iconName));
    $('status-title').textContent = title;
    $('status-sub').textContent = sub || '';
    $('status-sub').hidden = !sub;
  }

  async function shortcutLabel() {
    try {
      const commands = await new Promise((resolve) => g.chrome.commands.getAll(resolve));
      return commands.find((command) => command.name === 'toggle-panel')?.shortcut || '';
    } catch (_) { return ''; }
  }

  async function render() {
    const supported = !!site;
    $('supported').hidden = !supported;
    $('unsupported').hidden = supported;

    if (!supported) {
      setStatus('idle', 'info', t('popup.unsupportedTitle'), t('popup.unsupportedSub'));
      return;
    }
    const start = $('start');
    if (!reply) {
      setStatus('problem', 'alert', t('popup.unreachableTitle', { site: site.name }), t('popup.unreachableSub'));
      start.textContent = t('popup.reload');
      start.dataset.mode = 'reload';
      start.classList.add('btn-primary');
      return;
    }
    start.dataset.mode = reply.active ? 'stop' : 'start';
    if (reply.active) {
      setStatus('active', 'checkCircle', t('popup.activeTitle', { site: site.name }), t('popup.activeSub', { count: reply.selected }));
      start.textContent = t('popup.stop');
      start.classList.remove('btn-primary');
    } else {
      setStatus('ready', 'checkCircle', t('popup.readyTitle', { site: site.name }), t('popup.readySub'));
      start.textContent = t('popup.start');
      start.classList.add('btn-primary');
    }
    const shortcut = await shortcutLabel();
    const hint = $('shortcut');
    hint.hidden = !shortcut;
    if (shortcut) hint.replaceChildren(g.document.createTextNode(`${t('popup.shortcut')} `), make('kbd', 'kbd', shortcut));
  }

  async function onPrimary() {
    const mode = $('start').dataset.mode;
    if (mode === 'reload') {
      await new Promise((resolve) => g.chrome.tabs.reload(tab.id, resolve));
      g.close();
      return;
    }
    await ABCM.ext.tabsSendMessage(tab.id, { type: mode === 'stop' ? 'ABCM_STOP' : 'ABCM_START' }).catch(() => {});
    g.close(); // selecting happens in the page, so get out of the way
  }

  function buildSiteGrid() {
    $('site-grid').replaceChildren(...ABCM.sites.all.map((s) => {
      const button = make('button', 'btn');
      button.type = 'button';
      const dot = make('span', 'site-dot');
      dot.style.background = s.color;
      button.append(dot, g.document.createTextNode(s.name));
      button.addEventListener('click', () => { ABCM.ext.openTab(s.url); g.close(); });
      return button;
    }));
  }

  function wireSwitches() {
    const bind = (id, key) => {
      const el = $(id);
      const paint = () => el.setAttribute('aria-checked', String(!!ABCM.settings.get()[key]));
      paint();
      el.addEventListener('click', async () => {
        await ABCM.settings.save({ [key]: !ABCM.settings.get()[key] });
        paint();
      });
    };
    bind('sw-fast', 'fastMode');
    bind('sw-auto', 'autoLoad');
  }

  async function maybeShowNudge() {
    try {
      const nudge = await ABCM.nudge.read();
      if (!nudge) { await ABCM.nudge.seed(); return; }
      if (!ABCM.nudge.isDue(nudge)) return;
      await ABCM.nudge.markShown();
      try { g.chrome.action.setBadgeText({ text: '' }); } catch (_) { /* optional */ }

      // A dialog over the popup (a scrim and a card), so it never pushes the popup's own content around.
      const scrim = make('div', 'nudge-scrim');
      const banner = make('section', 'nudge');
      banner.setAttribute('role', 'dialog');
      banner.setAttribute('aria-modal', 'true');
      banner.setAttribute('aria-label', t('nudge.label'));
      scrim.append(banner);
      const head = make('div', 'nudge-head');
      head.append(ABCM.icons.icon('heart'), make('span', '', t('nudge.title')));
      const actions = make('div', 'nudge-actions');
      const dismiss = () => { g.document.body.classList.remove('has-dialog'); scrim.remove(); };
      const action = (className, label, onClick) => {
        const button = make('button', className, label);
        button.type = 'button';
        button.addEventListener('click', onClick);
        return button;
      };
      actions.append(
        action('btn btn-primary btn-sm', t('nudge.coffee'), () => { ABCM.ext.openTab(ABCM.links.support); dismiss(); }),
        action('btn btn-sm', t('nudge.rate'), () => { ABCM.ext.openTab(ABCM.links.reviewUrl()); dismiss(); }),
        action('btn btn-quiet btn-sm', t('nudge.later'), dismiss)
      );
      const never = action('link nudge-off', t('nudge.never'), async () => { await ABCM.nudge.optOut(); dismiss(); });
      banner.append(head, make('p', '', t('nudge.body')), actions, never);
      g.document.body.classList.add('has-dialog');
      $('nudge-mount').append(scrim);
      scrim.addEventListener('mousedown', (event) => { if (event.target === scrim) dismiss(); });
      scrim.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); dismiss(); } });
      actions.lastElementChild.focus();
    } catch (_) { /* the reminder is optional */ }
  }

  async function main() {
    await ABCM.page.init({ onChange: () => { render(); ABCM.footer.render(); } });
    setStatus('idle', 'info', t('popup.checking'), '');
    $('version').textContent = `v${ABCM.version}`;
    $('open-options').append(ABCM.icons.icon('sliders'));
    $('open-options').addEventListener('click', () => { ABCM.ext.openOptionsPage().finally(() => g.close()); });
    $('start').addEventListener('click', onPrimary);
    buildSiteGrid();
    wireSwitches();
    ABCM.footer.init();

    [tab] = await ABCM.ext.tabsQuery({ active: true, currentWindow: true }).catch(() => []);
    site = tab?.url ? ABCM.sites.match(tab.url) : null;
    if (site && tab.id !== undefined) reply = await ABCM.inject.ensure(tab.id);
    await render();
    maybeShowNudge();
  }

  main().catch((error) => { console.error(error); });
})(globalThis);
