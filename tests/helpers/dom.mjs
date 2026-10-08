// Loads the extension's classic scripts into a jsdom window with a fake `chrome`, for unit tests.
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { extensionDir } from './paths.mjs';

export const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
/** The content-script files in manifest order, without the entry point that starts the app on its own. */
export const CONTENT_FILES = manifest.content_scripts[0].js.filter((file) => !file.endsWith('content/main.js'));

/** In-memory stand-in for the extension APIs the scripts use (callback style, like the real ones). */
export function fakeChrome({ storage = {}, uiLanguage = 'en', manifestOverride = {}, messages = {} } = {}) {
  const store = structuredClone(storage);
  const storageListeners = [];
  const messageListeners = [];
  const sent = [];
  const chrome = {
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      getManifest: () => ({ ...manifest, ...manifestOverride }),
      getURL: (p) => `chrome-extension://test-extension-id/${p}`,
      sendMessage(message, callback) {
        sent.push(message);
        const reply = typeof messages[message?.type] === 'function' ? messages[message.type](message) : messages[message?.type];
        queueMicrotask(() => callback?.(reply));
      },
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      openOptionsPage: (cb) => cb?.()
    },
    storage: {
      local: {
        get(keys, cb) {
          const list = keys === null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of list) if (key in store) out[key] = structuredClone(store[key]);
          queueMicrotask(() => cb(out));
        },
        set(items, cb) {
          const changes = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: store[key], newValue: structuredClone(value) };
            store[key] = structuredClone(value);
          }
          queueMicrotask(() => { storageListeners.forEach((fn) => fn(changes, 'local')); cb?.(); });
        },
        remove(keys, cb) {
          const changes = {};
          for (const key of [].concat(keys)) { changes[key] = { oldValue: store[key] }; delete store[key]; }
          queueMicrotask(() => { storageListeners.forEach((fn) => fn(changes, 'local')); cb?.(); });
        }
      },
      onChanged: { addListener: (fn) => storageListeners.push(fn) }
    },
    i18n: { getUILanguage: () => uiLanguage }
  };
  return { chrome, store, sent, messageListeners, storageListeners };
}

/** Pretends layout exists: jsdom has none, so every attached element counts as visible. */
function installLayoutShims(window) {
  const proto = window.HTMLElement.prototype;
  Object.defineProperty(proto, 'offsetParent', { configurable: true, get() { return this.isConnected ? this.parentNode : null; } });
  window.Element.prototype.getClientRects = function getClientRects() { return this.isConnected ? [{ width: 10, height: 10 }] : []; };
  window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }; };
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};
  if (!window.CSS) window.CSS = { escape: (value) => String(value).replace(/[^\w-]/g, '\\$&') };
}

export function createEnv({ url = 'https://chatgpt.com/', html = '<!doctype html><body></body>', files = CONTENT_FILES, chromeOptions = {}, run = true } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  installLayoutShims(window);
  const fake = fakeChrome(chromeOptions);
  window.chrome = fake.chrome;
  if (!window.fetch) window.fetch = () => Promise.reject(new Error('fetch is not stubbed'));
  window.load = (file) => window.eval(`${fs.readFileSync(path.join(extensionDir, file), 'utf8')}\n//# sourceURL=${file}`);
  if (run) files.forEach((file) => window.load(file));
  if (window.ABCM) window.ABCM.trustedOnly = false; // jsdom never produces trusted events
  return { window, document: window.document, ABCM: window.ABCM, ...fake, close: () => window.close() };
}

/** A sidebar with chat rows in the shape of the given site. */
export function sidebarHtml(site = 'chatgpt', count = 5) {
  const rows = Array.from({ length: count }, (_, i) => {
    const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    const prefix = { chatgpt: '/c/', claude: '/chat/', gemini: '/app/', grok: '/c/' }[site];
    return `<li><a href="${prefix}${id}"><div class="relative grow overflow-hidden whitespace-nowrap">Chat ${i + 1}</div></a><div><button aria-haspopup="menu" aria-label="Open options">...</button></div></li>`;
  }).join('');
  return `<!doctype html><body><nav aria-label="Chat history"><ol>${rows}</ol></nav></body>`;
}
