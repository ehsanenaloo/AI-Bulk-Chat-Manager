/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  The in-page panel: selection tools, Export/Archive/Delete, live progress and the result summary.

  It is built once into a shadow root and then updated in place from the selection state. All text
  is set with textContent; chat titles come from the page and are never parsed as HTML.
  Views: "select" (default), "running" (a bulk action is in progress) and "result" (finished).
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const t = (key, params) => ABCM.i18n.t(key, params);

  /** Tiny element builder: h('button', { class: 'btn', text: 'Go', on: { click } }, ...children) */
  function h(tag, props = {}, ...children) {
    const el = g.document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'on') Object.entries(value).forEach(([type, fn]) => el.addEventListener(type, fn));
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
    children.flat().forEach((child) => { if (child !== null && child !== undefined && child !== false) el.append(child); });
    return el;
  }
  const icon = (name, cls) => ABCM.icons.icon(name, cls);

  const ui = {
    host: null, shadow: null, refs: {}, view: 'select', collapsed: false, summary: null,
    dialog: null, systemTheme: null, toastTimer: null, built: false, loading: false
  };

  async function loadStyles() {
    const reply = await ABCM.ext.sendMessage({ type: 'ABCM_GET_ASSET', names: ['tokens', 'components', 'panel'] });
    if (!reply?.ok) throw new Error(reply?.error || 'styles unavailable');
    return reply.css;
  }

  function applyStyles(css) {
    try {
      const sheet = new g.CSSStyleSheet();
      sheet.replaceSync(css);
      ui.shadow.adoptedStyleSheets = [sheet];
    } catch (_) {
      ui.shadow.prepend(h('style', { text: css })); // browsers without constructable stylesheets
    }
  }

  // ── theme, language, placement ───────────────────────────────────────────────────────────
  function applyAppearance() {
    if (!ui.host) return;
    const s = ABCM.settings.get();
    const dark = s.theme === 'dark' || (s.theme === 'system' && g.matchMedia?.('(prefers-color-scheme: dark)').matches);
    ui.host.setAttribute('data-theme', dark ? 'dark' : 'light');
    ui.host.setAttribute('data-accent', s.accent);
    ui.host.setAttribute('dir', ABCM.i18n.dir());
    ui.host.setAttribute('lang', ABCM.i18n.lang);
  }

  function clampToViewport() {
    const panel = ui.refs.panel;
    if (!panel || !panel.classList.contains('is-placed')) return;
    const rect = panel.getBoundingClientRect();
    const x = Math.min(Math.max(8, rect.left), Math.max(8, g.innerWidth - rect.width - 8));
    const y = Math.min(Math.max(8, rect.top), Math.max(8, g.innerHeight - rect.height - 8));
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  }

  function placeAt(x, y) {
    const panel = ui.refs.panel;
    panel.classList.add('is-placed');
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    clampToViewport();
  }

  function enableDragging() {
    const head = ui.refs.head;
    let drag = null;
    head.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const rect = ui.refs.panel.getBoundingClientRect();
      drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      head.setPointerCapture(event.pointerId);
      head.classList.add('is-dragging');
    });
    head.addEventListener('pointermove', (event) => {
      if (drag) placeAt(event.clientX - drag.dx, event.clientY - drag.dy);
    });
    const end = (event) => {
      if (!drag) return;
      drag = null;
      head.classList.remove('is-dragging');
      try { head.releasePointerCapture(event.pointerId); } catch (_) { /* already released */ }
      const rect = ui.refs.panel.getBoundingClientRect();
      ABCM.settings.save({ panelPosition: { x: rect.left, y: rect.top } }).catch(() => {});
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  }

  // ── rendering ────────────────────────────────────────────────────────────────────────────
  /**
   * Screen-reader announcement. One live region exists for the whole life of the panel and its text
   * is set shortly after it is cleared; a region that appears already filled is often not read.
   */
  function announce(message) {
    const live = ui.refs.live;
    if (!live) return;
    live.textContent = '';
    g.clearTimeout(ui.liveTimer);
    ui.liveTimer = g.setTimeout(() => { live.textContent = message; }, 60);
  }

  function toast(message) {
    announce(message);
    ui.refs.toastHost.replaceChildren(h('div', { class: 'toast', 'aria-hidden': 'true', text: message }));
    g.clearTimeout(ui.toastTimer);
    ui.toastTimer = g.setTimeout(() => ui.refs.toastHost.replaceChildren(), 2600);
  }

  function setView(view) {
    ui.view = view;
    ui.refs.panel.dataset.view = view;
    ['select', 'running', 'result'].forEach((name) => {
      ui.refs[`view-${name}`].hidden = name !== view;
      ui.refs[`footer-${name}`].hidden = name !== view;
    });
    render();
  }

  /** Brings every text and state in the panel in line with the current selection. */
  function render() {
    if (!ui.built) return;
    const state = ABCM.state;
    const site = ABCM.sites.current();
    state.prune();
    const selected = state.selectedCount();
    const shown = state.visible().length;
    const r = ui.refs;

    r.siteName.textContent = site?.name || '';
    if (ui.lastAnnounced !== undefined && ui.lastAnnounced !== selected && ui.view === 'select') {
      g.clearTimeout(ui.countTimer);
      ui.countTimer = g.setTimeout(() => announce(t('panel.selectedShort', { count: ABCM.state.selectedCount() })), 700);
    }
    ui.lastAnnounced = selected;
    r.count.textContent = ABCM.i18n.format(selected);
    r.headCount.textContent = t('panel.selectedShort', { count: selected });
    r.countSub.textContent = t('panel.shown', { count: shown });
    r.empty.hidden = shown > 0;
    r.loadAll.disabled = shown === 0 && !ui.loading;
    r.hint.hidden = shown === 0;

    const none = selected === 0;
    r.archive.hidden = !site?.archive;
    r.archive.disabled = none;
    r.delete.disabled = none;
    r.export.disabled = none;
    r.deleteLabel.textContent = none ? t('panel.delete') : t('panel.deleteN', { count: selected });
    r.clear.disabled = none;
    r.selectAll.disabled = shown === 0;
    r.invert.disabled = shown === 0;
    r.switchAuto.setAttribute('aria-checked', String(ABCM.autoAttach.isEnabled()));
    r.switchFast.setAttribute('aria-checked', String(ABCM.settings.get().fastMode));
    r.switchFast.disabled = !(site && site.method === 'api');
  }

  function menuClose() {
    ui.refs.menu.hidden = true;
    ui.refs.export.setAttribute('aria-expanded', 'false');
  }

  // ── actions ──────────────────────────────────────────────────────────────────────────────
  function doExport(format) {
    menuClose();
    const items = ABCM.state.selectedItems();
    if (!items.length) return;
    const site = ABCM.sites.current();
    ABCM.exporter.download(format, items, site?.name || '', site?.id || '');
    toast(t('toast.exported', { count: items.length, format: t(`export.${format}`) }));
  }

  function reasonText(reason) {
    const raw = String(reason || 'operation-failed');
    const http = raw.match(/^api-http-(\d+)$/);
    if (http) return t('reason.api-http', { code: http[1] });
    const key = `reason.${raw}`;
    const text = t(key);
    return text === key ? t('reason.unknown', { code: raw }) : text;
  }

  function summaryTitle(summary) {
    const failed = summary.failures.length;
    const verb = summary.operation === 'DELETE' ? 'deleted' : 'archived';
    if (summary.stopped) return t('result.stopped', { done: summary.succeeded, total: summary.total });
    if (!failed) return t(`result.${verb}`, { count: summary.succeeded });
    if (!summary.succeeded) return t('result.allFailed', { count: failed });
    return t('result.partial', { succeeded: summary.succeeded, total: summary.total, failed });
  }

  function showResult(summary) {
    ui.summary = summary;
    const r = ui.refs;
    const failed = summary.failures.length;
    const good = !failed && !summary.stopped;
    r.resultHead.className = `result-head ${good ? 'ok' : 'warn'}`;
    r.resultIcon.replaceChildren(icon(good ? 'checkCircle' : 'alert', 'result-icon'));
    r.resultTitle.textContent = summaryTitle(summary);
    r.resultSub.textContent = summary.stopped ? t('result.stoppedHint') : failed ? t('result.failedHint') : '';
    r.resultSub.hidden = !r.resultSub.textContent;
    r.failList.replaceChildren(...summary.failures.map((item) => h('li', {}, h('div', { class: 'fail-title', text: item.title || t('panel.untitled') }), h('div', { class: 'fail-reason', text: reasonText(item.reason) }))));
    r.failList.hidden = !failed;
    r.retry.hidden = !failed;
    r.copyReport.hidden = !failed;
    setView('result');
    announce(`${r.resultTitle.textContent}. ${r.resultSub.textContent}`.trim());
    r.done.focus({ preventScroll: true });
  }

  async function runOperation(operation) {
    const r = ui.refs;
    const verb = operation === 'DELETE' ? 'deleting' : 'archiving';
    r.runTitle.textContent = t(`running.${verb}`);
    r.runSub.textContent = '';
    r.runCurrent.textContent = '';
    r.runFailed.hidden = true;
    r.barFill.style.transform = 'scaleX(0)';
    r.bar.setAttribute('aria-valuenow', '0');
    setView('running');
    announce(r.runTitle.textContent);
    r.stop.disabled = false;
    r.stop.focus({ preventScroll: true });
    let summary;
    try {
      summary = await ABCM.bulk.run(operation, {
        onProgress: (p) => {
          const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
          r.runSub.textContent = t('running.progress', { done: p.done, total: p.total });
          r.barFill.style.transform = `scaleX(${pct / 100})`;
          r.bar.setAttribute('aria-valuenow', String(pct));
          r.bar.setAttribute('aria-valuetext', t('running.progress', { done: p.done, total: p.total }));
          r.runCurrent.textContent = p.currentTitle || '';
          r.runFailed.hidden = !p.failed;
          r.runFailed.textContent = t('running.failed', { count: p.failed });
        }
      });
    } catch (error) {
      summary = { operation, requested: 0, total: 0, succeeded: 0, stopped: false, failures: [{ id: '', title: '', reason: error?.message || 'operation-failed' }] };
    }
    showResult(summary);
  }

  // ── confirmation dialog ──────────────────────────────────────────────────────────────────
  function closeDialog(restoreFocus = true) {
    if (!ui.dialog) return;
    ui.refs.dialogHost.replaceChildren();
    const { previous } = ui.dialog;
    ui.dialog = null;
    if (restoreFocus && previous?.isConnected) previous.focus({ preventScroll: true });
  }

  function openConfirm(operation) {
    const items = ABCM.state.selectedItems();
    if (!items.length) return;
    const site = ABCM.sites.current();
    const isDelete = operation === 'DELETE';
    const count = items.length;
    const needsAck = isDelete && count > ABCM.settings.get().confirmThreshold;

    const search = count > 8 ? h('input', { class: 'input', type: 'search', placeholder: t('confirm.search'), 'aria-label': t('confirm.search') }) : null;
    const list = h('ul', { class: 'chat-list', tabindex: '0', 'aria-label': t('confirm.listLabel') });
    const paint = (query = '') => {
      const q = query.trim().toLowerCase();
      list.replaceChildren(...items.filter((item) => !q || `${item.title} ${item.id}`.toLowerCase().includes(q))
        .map((item) => h('li', { text: item.title || t('panel.untitled'), title: item.title })));
    };
    paint();
    search?.addEventListener('input', () => paint(search.value));

    const ack = needsAck ? h('input', { type: 'checkbox', id: 'abcm-ack' }) : null;
    const confirmBtn = h('button', {
      class: `btn ${isDelete ? 'btn-danger' : 'btn-primary'}`, type: 'button', disabled: needsAck,
      text: isDelete ? t('confirm.deleteAction', { count }) : t('confirm.archiveAction', { count }),
      on: { click: () => { closeDialog(false); runOperation(operation); } }
    });
    ack?.addEventListener('change', () => { confirmBtn.disabled = !ack.checked; });
    const cancelBtn = h('button', { class: 'btn', type: 'button', text: t('confirm.cancel'), on: { click: () => closeDialog() } });

    const dialog = h('div', {
      class: `dialog${isDelete ? ' is-danger' : ''}`, role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'abcm-dlg-title', 'aria-describedby': 'abcm-dlg-body'
    },
    h('div', { class: 'dialog-main' },
      h('h2', { id: 'abcm-dlg-title', text: isDelete ? t('confirm.deleteTitle', { count }) : t('confirm.archiveTitle', { count }) }),
      h('p', { id: 'abcm-dlg-body', text: isDelete ? t('confirm.deleteBody', { site: site?.name || '' }) : t('confirm.archiveBody', { site: site?.name || '' }) }),
      search, list,
      needsAck ? h('label', { class: 'ack', for: 'abcm-ack' }, ack, h('span', { text: t('confirm.ack') })) : null),
    h('div', { class: 'dialog-actions' }, cancelBtn, confirmBtn));

    let pressedOnScrim = false;
    const scrim = h('div', { class: 'scrim', on: {
      mousedown: (event) => { pressedOnScrim = event.target === scrim; },
      click: (event) => { if (pressedOnScrim && event.target === scrim) closeDialog(); pressedOnScrim = false; }
    } }, dialog);
    ui.dialog = { previous: ui.shadow.activeElement || ui.refs.panel, scrim, dialog };
    ui.refs.dialogHost.replaceChildren(scrim);
    cancelBtn.focus({ preventScroll: true }); // the safe choice has focus, never the destructive one
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      if (!ui.dialog && !ui.refs.settings.hidden) { ui.refs.settings.hidden = true; ui.refs.settingsBtn.setAttribute('aria-expanded', 'false'); ui.refs.settingsBtn.focus(); event.stopPropagation(); return; }
      if (ui.dialog) { event.preventDefault(); event.stopPropagation(); closeDialog(); return; }
      if (!ui.refs.menu.hidden) { menuClose(); ui.refs.export.focus(); event.stopPropagation(); return; }
    }
    if (event.key === 'Tab' && ui.dialog) {
      const focusable = Array.from(ui.dialog.dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex="0"]'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = ui.shadow.activeElement;
      if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    }
  }

  // ── construction ─────────────────────────────────────────────────────────────────────────
  function build() {
    const r = ui.refs;
    const act = (fn) => ({ click: fn });
    const state = ABCM.state;

    r.siteName = h('span', { class: 'head-site' });
    r.headCount = h('span', { class: 'head-count' });
    r.settingsBtn = h('button', { class: 'btn btn-quiet btn-icon is-toggle', type: 'button', 'aria-expanded': 'false', 'aria-label': t('panel.settings'), title: t('panel.settings'), on: act(() => {
      const open = r.settings.hidden;
      r.settings.hidden = !open;
      r.settingsBtn.setAttribute('aria-expanded', String(open));
    }) }, icon('sliders'));
    r.collapseBtn = h('button', { class: 'btn btn-quiet btn-icon', type: 'button', 'aria-expanded': 'true', 'aria-label': t('panel.collapse'), title: t('panel.collapse'), on: act(() => setCollapsed(!ui.collapsed)) }, icon('minus'));
    r.closeBtn = h('button', { class: 'btn btn-quiet btn-icon', type: 'button', 'aria-label': t('panel.close'), title: t('panel.close'), on: act(() => ABCM.app.stop()) }, icon('x'));
    r.head = h('div', { class: 'head' },
      ABCM.icons.logo('logo'),
      h('div', { class: 'head-text' }, h('div', { class: 'head-title', text: t('panel.title') }), r.siteName),
      r.headCount, r.settingsBtn, r.collapseBtn, r.closeBtn);

    const makeSwitch = (id) => h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-labelledby': id });
    r.switchAuto = makeSwitch('abcm-s-auto');
    r.switchFast = makeSwitch('abcm-s-fast');
    r.switchAuto.addEventListener('click', () => {
      ABCM.settings.save({ autoLoad: !ABCM.autoAttach.isEnabled() }).catch(() => {});
      if (ABCM.autoAttach.isEnabled()) ABCM.autoAttach.disable(); else { ABCM.autoAttach.enable(); }
      render();
    });
    r.switchFast.addEventListener('click', () => {
      ABCM.settings.save({ fastMode: !ABCM.settings.get().fastMode }).then(render).catch(() => {});
    });
    r.settings = h('div', { class: 'settings', hidden: true },
      h('div', { class: 'setting' }, h('div', { class: 'setting-text' }, h('div', { class: 'setting-title', id: 'abcm-s-auto', text: t('settings.autoLoad') }), h('div', { class: 'setting-hint', text: t('settings.autoLoadHint') })), r.switchAuto),
      h('div', { class: 'setting' }, h('div', { class: 'setting-text' }, h('div', { class: 'setting-title', id: 'abcm-s-fast', text: t('settings.fastMode') }), h('div', { class: 'setting-hint', text: t('settings.fastModeHint') })), r.switchFast),
      h('button', { class: 'link more', type: 'button', text: t('settings.all'), on: act(() => ABCM.ext.sendMessage({ type: 'ABCM_OPEN_OPTIONS' }).catch(() => {})) }));

    // select view
    r.count = h('span', { class: 'count-num' });
    r.countSub = h('div', { class: 'count-sub' });
    r.selectAll = h('button', { class: 'btn', type: 'button', on: act(() => { ABCM.state.selectVisible(); }) }, icon('listChecks'), h('span', { text: t('panel.selectAll') }));
    r.clear = h('button', { class: 'btn', type: 'button', on: act(() => { ABCM.state.clearSelection(); }) }, icon('clear'), h('span', { text: t('panel.clear') }));
    r.invert = h('button', { class: 'btn', type: 'button', on: act(() => { ABCM.state.invertVisible(); }) }, icon('invert'), h('span', { text: t('panel.invert') }));
    r.filter = h('input', { class: 'input', type: 'text', placeholder: t('panel.titlePlaceholder'), 'aria-label': t('panel.titlePlaceholder') });
    const byTitle = (mode) => () => {
      const n = ABCM.state.applyFilter(r.filter.value, mode);
      toast(t('toast.matched', { count: n }));
    };
    r.filter.addEventListener('keydown', (event) => { if (event.key === 'Enter' && event.isTrusted) byTitle('select')(); });
    r.oldest = h('input', { class: 'input', type: 'number', min: '1', max: '500', value: '10', 'aria-label': t('panel.oldest') });
    const byAge = (mode) => () => {
      const n = ABCM.state.applyOldest(r.oldest.value, mode);
      toast(t('toast.matched', { count: n }));
    };
    r.loadAllLabel = h('span', { text: t('panel.loadAll') });
    r.loadAll = h('button', { class: 'btn btn-quiet btn-sm load-all', type: 'button', on: act(async () => {
      if (ui.loading) { ABCM.loader.stop(); return; }
      ui.loading = true;
      r.loadAllLabel.textContent = t('panel.loadingAll', { count: ABCM.dom.getAllConversations().length });
      const result = await ABCM.loader.loadAll({ onProgress: (n) => { r.loadAllLabel.textContent = t('panel.loadingAll', { count: n }); } });
      ui.loading = false;
      r.loadAllLabel.textContent = t('panel.loadAll');
      toast(t('toast.loaded', { count: result.total }));
      render();
    }) }, icon('chevronsDown'), r.loadAllLabel);
    r.empty = h('div', { class: 'empty', role: 'status', text: t('panel.empty') });
    r.hint = h('p', { class: 'hint', text: t('panel.hint') });
    r['view-select'] = h('div', { class: 'view' },
      h('div', { class: 'count' }, r.count, h('span', { class: 'count-word', text: t('panel.selectedWord') })),
      r.countSub,
      h('div', { class: 'quick' }, r.selectAll, r.clear, r.invert),
      h('div', { class: 'load-row' }, r.loadAll),
      h('details', { class: 'more-ways' },
        h('summary', {}, h('span', { text: t('panel.moreWays') }), icon('chevronDown')),
        h('div', { class: 'more-row' }, r.filter, h('button', { class: 'btn', type: 'button', text: t('panel.select'), on: act(byTitle('select')) }), h('button', { class: 'btn btn-quiet', type: 'button', text: t('panel.unselect'), on: act(byTitle('clear')) })),
        h('div', { class: 'more-row with-label' }, h('span', { class: 'more-label', text: t('panel.oldest') }), r.oldest, h('button', { class: 'btn', type: 'button', text: t('panel.select'), on: act(byAge('select')) }), h('button', { class: 'btn btn-quiet', type: 'button', text: t('panel.unselect'), on: act(byAge('clear')) }))),
      r.empty, r.hint);

    // running view
    r.runTitle = h('div', { class: 'run-title' });
    r.runSub = h('div', { class: 'run-sub', 'aria-live': 'polite' });
    r.barFill = h('span');
    r.bar = h('div', { class: 'bar', role: 'progressbar', 'aria-label': t('panel.progress'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, r.barFill);
    r.runCurrent = h('div', { class: 'run-current' });
    r.runFailed = h('div', { class: 'run-failed', hidden: true });
    r['view-running'] = h('div', { class: 'view', hidden: true }, r.runTitle, r.runSub, r.bar, r.runCurrent, r.runFailed);

    // result view
    r.resultIcon = h('span');
    r.resultTitle = h('div', { class: 'run-title' });
    r.resultSub = h('div', { class: 'run-sub' });
    r.resultHead = h('div', { class: 'result-head' }, r.resultIcon, h('div', {}, r.resultTitle, r.resultSub));
    r.failList = h('ul', { class: 'fail-list', tabindex: '0', 'aria-label': t('result.failures') });
    r['view-result'] = h('div', { class: 'view', hidden: true }, r.resultHead, r.failList);

    r.body = h('div', { class: 'body' }, r['view-select'], r['view-running'], r['view-result']);

    // footers
    r.export = h('button', { class: 'btn', type: 'button', 'aria-expanded': 'false', on: act(() => {
      const open = r.menu.hidden;
      r.menu.hidden = !open;
      r.export.setAttribute('aria-expanded', String(open));
      if (open) r.menu.querySelector('button')?.focus();
    }) }, icon('download'), h('span', { text: t('panel.export') }));
    r.menu = h('div', { class: 'menu', role: 'group', 'aria-label': t('panel.export'), hidden: true },
      ...['json', 'csv', 'md'].map((format) => h('button', { type: 'button', text: t(`export.${format}`), on: act(() => doExport(format)) })));
    // Leaving the group (Tab out, click elsewhere) closes it.
    r.menu.addEventListener('focusout', (event) => { if (!r.menu.contains(event.relatedTarget) && event.relatedTarget !== r.export) menuClose(); });
    r.archive = h('button', { class: 'btn', type: 'button', on: act(() => openConfirm('ARCHIVE')) }, icon('archive'), h('span', { text: t('panel.archive') }));
    r.deleteLabel = h('span');
    r.delete = h('button', { class: 'btn btn-danger btn-delete', type: 'button', on: act(() => openConfirm('DELETE')) }, icon('trash'), r.deleteLabel);
    r['footer-select'] = h('div', { class: 'footer' }, h('div', { class: 'menu-wrap' }, r.export, r.menu), r.archive, r.delete);

    r.stop = h('button', { class: 'btn btn-outline-danger', type: 'button', on: act(() => { r.stop.disabled = true; ABCM.state.requestStop(); }) }, icon('stop'), h('span', { text: t('panel.stop') }));
    r['footer-running'] = h('div', { class: 'footer', hidden: true }, r.stop);

    r.retry = h('button', { class: 'btn', type: 'button', hidden: true, on: act(() => { setView('select'); openConfirm(ui.summary?.operation || 'DELETE'); }) }, icon('retry'), h('span', { text: t('result.retry') }));
    r.copyReport = h('button', { class: 'btn btn-quiet', type: 'button', hidden: true, on: act(async () => {
      const text = (ui.summary?.failures || []).map((f) => `${f.title || f.id} — ${reasonText(f.reason)}`).join('\n');
      try { await g.navigator.clipboard.writeText(text); toast(t('result.copied')); } catch (_) { toast(t('result.copyFailed')); }
    }) }, icon('copy'), h('span', { text: t('result.copy') }));
    r.done = h('button', { class: 'btn btn-primary', type: 'button', text: t('result.done'), on: act(() => { setView('select'); r.selectAll.focus({ preventScroll: true }); }) });
    r['footer-result'] = h('div', { class: 'footer', hidden: true }, r.copyReport, r.retry, r.done);

    r.panel = h('section', { class: 'panel', role: 'region', 'aria-label': t('panel.title'), dataset: { view: 'select', collapsed: 'false' } }, r.head, r.settings, r.body, r['footer-select'], r['footer-running'], r['footer-result']);
    r.dialogHost = h('div');
    r.toastHost = h('div');
    r.live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    r.launcher = h('button', { class: 'launcher', type: 'button', hidden: true, 'aria-label': t('launcher.label'), title: t('launcher.label'), on: act(() => ABCM.app.start()) }, ABCM.icons.logo('logo'));

    ui.shadow.append(r.panel, r.dialogHost, r.toastHost, r.live, r.launcher);
    ui.built = true;
    enableDragging();
    // The page can reach an open shadow root and call element.click() or dispatch events on it. Only
    // real user input may drive the panel, so a script on the site can never confirm a delete.
    const trusted = (event) => { if (!event.isTrusted) { event.stopImmediatePropagation(); event.preventDefault(); } };
    ['click', 'change', 'input', 'submit', 'pointerdown'].forEach((type) => ui.shadow.addEventListener(type, trusted, true));
    ui.shadow.addEventListener('keydown', onKeydown);
    ui.shadow.addEventListener('click', (event) => {
      if (!event.composedPath().includes(r.menu) && !event.composedPath().includes(r.export)) menuClose();
    });
    state.subscribe(render);
  }

  function setCollapsed(on) {
    ui.collapsed = on;
    ui.refs.panel.dataset.collapsed = String(on);
    const label = t(on ? 'panel.expand' : 'panel.collapse');
    ui.refs.collapseBtn.setAttribute('aria-label', label);
    ui.refs.collapseBtn.setAttribute('aria-expanded', String(!on));
    ui.refs.collapseBtn.title = label;
    ui.refs.collapseBtn.replaceChildren(icon(on ? 'chevronUp' : 'minus'));
    menuClose();
  }

  // ── lifecycle ────────────────────────────────────────────────────────────────────────────
  async function mount() {
    if (ui.host) return;
    const css = await loadStyles();
    ui.host = g.document.createElement('div');
    ui.host.setAttribute('data-abcm-root', '');
    ui.shadow = ui.host.attachShadow({ mode: 'open' });
    applyStyles(css);
    applyAppearance();
    build();
    // Keep typing inside the panel from reaching the site's own keyboard shortcuts.
    ['keydown', 'keyup', 'keypress'].forEach((type) => ui.host.addEventListener(type, (event) => event.stopPropagation()));
    g.document.documentElement.appendChild(ui.host);
    const pos = ABCM.settings.get().panelPosition;
    if (pos) placeAt(pos.x, pos.y);
    g.addEventListener('resize', clampToViewport);
    ui.systemTheme = g.matchMedia?.('(prefers-color-scheme: dark)');
    ui.systemTheme?.addEventListener?.('change', applyAppearance);
    setView('select');
  }

  async function open() {
    await mount();
    const wasHidden = ui.refs.panel.hidden;
    ui.refs.panel.hidden = false;
    ui.refs.launcher.hidden = true;
    render();
    if (wasHidden) {
      ui.refs.panel.tabIndex = -1;
      ui.refs.panel.focus({ preventScroll: true });
    }
  }

  function close() {
    if (!ui.host) return;
    closeDialog(false);
    menuClose();
    ui.refs.panel.hidden = true;
    ui.refs.launcher.hidden = !ABCM.settings.get().showLauncher;
    if (ui.view !== 'running') setView('select');
  }

  /** Shows the small launcher button when the setting is on and the panel is closed. */
  async function syncLauncher() {
    const want = ABCM.settings.get().showLauncher;
    if (!want && !ui.host) return;
    await mount();
    if (ui.refs.panel.hidden || !ABCM.app.isActive()) {
      ui.refs.panel.hidden = true;
      ui.refs.launcher.hidden = !want;
    }
  }

  function refreshLanguage() {
    if (!ui.host) return;
    const keep = { collapsed: ui.collapsed, hidden: ui.refs.panel.hidden };
    ui.host.remove();
    ui.shadow = ui.refs = null;
    ui.host = null; ui.built = false; ui.refs = {};
    return mount().then(() => {
      setCollapsed(keep.collapsed);
      ui.refs.panel.hidden = keep.hidden;
      ui.refs.launcher.hidden = !keep.hidden || !ABCM.settings.get().showLauncher;
      render();
    });
  }

  function destroy() {
    ui.host?.remove();
    ui.host = null;
    ui.built = false;
    ui.refs = {};
  }

  ABCM.define('panel', {
    open, close, destroy, syncLauncher, applyAppearance, refreshLanguage, render, toast,
    isOpen: () => !!ui.host && !ui.refs.panel.hidden,
    isRunning: () => ui.view === 'running'
  });
})(globalThis);
