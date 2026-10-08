/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Promise wrappers over the callback style of the `chrome.*` extension APIs.

  The callback form is the one that behaves the same in Chrome, Edge and Firefox (Manifest V3),
  so every extension call in this project goes through here. A rejected promise carries
  chrome.runtime.lastError's message.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  function call(fn, thisArg, ...args) {
    return new Promise((resolve, reject) => {
      try {
        fn.call(thisArg, ...args, (result) => {
          const error = g.chrome?.runtime?.lastError;
          if (error) reject(new Error(error.message || String(error)));
          else resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  const api = () => g.chrome;

  const ext = {
    isAlive: () => ABCM.isAlive(),
    getURL: (path) => api().runtime.getURL(path),
    getManifest: () => api().runtime.getManifest(),
    uiLanguage: () => { try { return api().i18n?.getUILanguage?.() || g.navigator?.language || 'en'; } catch (_) { return 'en'; } },

    storageGet: (keys) => call(api().storage.local.get, api().storage.local, keys),
    storageSet: (items) => call(api().storage.local.set, api().storage.local, items),
    storageRemove: (keys) => call(api().storage.local.remove, api().storage.local, keys),
    onStorageChanged: (listener) => api().storage.onChanged.addListener(listener),

    sendMessage: (message) => call(api().runtime.sendMessage, api().runtime, message),
    onMessage: (listener) => api().runtime.onMessage.addListener(listener),

    tabsQuery: (query) => call(api().tabs.query, api().tabs, query),
    tabsSendMessage: (tabId, message) => call(api().tabs.sendMessage, api().tabs, tabId, message),
    tabsCreate: (options) => call(api().tabs.create, api().tabs, options),
    openOptionsPage: () => call(api().runtime.openOptionsPage, api().runtime),
    executeScript: (injection) => call(api().scripting.executeScript, api().scripting, injection),

    /** Opens a link in a new tab (extension pages only: content scripts have no tabs API and never open links). */
    openTab(url) {
      return ext.tabsCreate({ url });
    }
  };

  ABCM.define('ext', ext);
})(globalThis);
