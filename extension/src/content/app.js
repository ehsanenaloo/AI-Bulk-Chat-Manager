/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Selection mode: the one switch that turns the page into "selecting chats" and back.

  start(): add checkboxes to the chat list, keep them in step with the list if the setting is on,
           and open the panel.
  stop():  remove every checkbox, forget the selection and close the panel.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  let active = false;

  async function start() {
    await ABCM.ready; // boot (settings, language) finishes first; undefined in unit tests, which is fine
    if (active) {
      await ABCM.panel.open();
      return snapshot();
    }
    active = true;
    ABCM.state.setStatus('ready');
    ABCM.checkboxes.attachAll();
    if (ABCM.settings.get().autoLoad) ABCM.autoAttach.enable();
    await ABCM.panel.open();
    return snapshot();
  }

  function stop() {
    if (!active) return snapshot();
    if (ABCM.state.status === 'running') {
      ABCM.panel.toast(ABCM.i18n.t('toast.stopFirst'));
      return snapshot();
    }
    active = false;
    ABCM.autoAttach.disable();
    ABCM.checkboxes.removeAll();
    ABCM.state.setStatus('idle');
    ABCM.panel.close();
    return snapshot();
  }

  function toggle() {
    return active ? Promise.resolve(stop()) : start();
  }

  function snapshot() {
    const site = ABCM.sites.current();
    return {
      active,
      site: site?.id || '',
      status: ABCM.state.status,
      selected: ABCM.state.selectedCount(),
      visible: active ? ABCM.state.visible().length : 0,
      autoLoad: ABCM.autoAttach.isEnabled()
    };
  }

  ABCM.define('app', { start, stop, toggle, snapshot, isActive: () => active });
})(globalThis);
