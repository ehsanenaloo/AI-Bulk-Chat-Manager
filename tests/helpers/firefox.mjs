// Starts the installed desktop Firefox headless with a throwaway profile and drives it for the
// Firefox browser tests. No geckodriver, no Selenium, no downloads: it speaks WebDriver BiDi over
// Node's built-in WebSocket, and WebDriver classic over Marionette for trusted (native) input.
// Adapted from the Bookmark Scope Firefox harness.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { FIREFOX_ADDON_ID } from '../../scripts/build-firefox.mjs';
import { handleMockRequest, createMockServer, SITE_HOSTS } from '../fixtures/mock-site.mjs';

export const FIREFOX_BIN = process.env.FIREFOX_BIN
  || (process.platform === 'win32' ? 'C:\\Program Files\\Mozilla Firefox\\firefox.exe'
    : process.platform === 'darwin' ? '/Applications/Firefox.app/Contents/MacOS/firefox' : 'firefox');

/** Fixed so the moz-extension:// origin is known before the add-on is installed. */
export const EXT_UUID = '8c1d7f2e-3b4a-4d65-9a0e-5f6b7c8d9e10';
export const EXT_ORIGIN = `moz-extension://${EXT_UUID}/`;

const TRACE = !!process.env.FIREFOX_TRACE;
const KEYS = { Enter: '\uE007', Escape: '\uE00C', Control: '\uE009', Shift: '\uE008', Alt: '\uE00A', Tab: '\uE004', ArrowDown: '\uE015', ArrowUp: '\uE013', Backspace: '\uE003', Delete: '\uE017' };
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function firefoxInstalled(bin = FIREFOX_BIN) {
  if (path.isAbsolute(bin) || bin.includes('/') || bin.includes('\\')) return fs.existsSync(bin);
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE').split(';') : [''];
  return (process.env.PATH || '').split(path.delimiter).some((dir) => dir && extensions.some((ext) => fs.existsSync(path.join(dir, bin + ext))));
}

// ─── WebDriver BiDi client ───────────────────────────────────────────────────────────────────
export class Bidi {
  constructor(ws) {
    this.ws = ws; this.nextId = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && this.pending.has(message.id)) {
        const { resolve, reject, method } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.type === 'success') resolve(message.result); else reject(new Error(`${method}: ${message.error}: ${message.message}`));
      } else if (message.type === 'event') {
        for (const listener of this.listeners) listener(message);
      }
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => { const id = ++this.nextId; this.pending.set(id, { resolve, reject, method }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  onEvent(listener) { this.listeners.push(listener); }
}

// WebDriver classic over Marionette, used for trusted (native) mouse and keyboard input and screenshots.
export class Marionette {
  constructor(socket) {
    this.socket = socket; this.nextId = 0; this.pending = new Map(); this.buffer = Buffer.alloc(0);
    this.hello = new Promise((resolve) => { this.resolveHello = resolve; });
    socket.on('data', (chunk) => { this.buffer = Buffer.concat([this.buffer, chunk]); this.drain(); });
  }
  drain() {
    for (;;) {
      const colon = this.buffer.indexOf(0x3a);
      if (colon < 0) return;
      const length = Number(this.buffer.subarray(0, colon).toString());
      if (this.buffer.length < colon + 1 + length) return;
      const message = JSON.parse(this.buffer.subarray(colon + 1, colon + 1 + length).toString('utf8'));
      this.buffer = this.buffer.subarray(colon + 1 + length);
      if (!Array.isArray(message)) { this.resolveHello(message); continue; }
      const [, id, error, result] = message;
      const entry = this.pending.get(id);
      this.pending.delete(id);
      if (!entry) continue;
      if (error) entry.reject(new Error(`${entry.name}: ${error.message || JSON.stringify(error)}`)); else entry.resolve(result);
    }
  }
  send(name, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject, name });
      const body = JSON.stringify([0, id, name, params]);
      this.socket.write(`${Buffer.byteLength(body)}:${body}`);
    });
  }
}

async function freePort() {
  return new Promise((resolve) => { const server = net.createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
}

function writeUserJs(profile, marionettePort, extraPrefs) {
  const prefs = {
    'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ADDON_ID]: EXT_UUID }),
    'xpinstall.signatures.required': false,
    'browser.shell.checkDefaultBrowser': false,
    'browser.startup.homepage': 'about:blank',
    'browser.startup.page': 0,
    'browser.startup.homepage_override.mstone': 'ignore',
    'startup.homepage_welcome_url': '',
    'startup.homepage_welcome_url.additional': '',
    'browser.aboutwelcome.enabled': false,
    'browser.newtabpage.enabled': false,
    'browser.tabs.warnOnClose': false,
    'app.update.enabled': false, 'app.update.auto': false, 'app.update.service.enabled': false, 'app.update.checkInstallTime': false,
    'datareporting.policy.dataSubmissionEnabled': false, 'datareporting.healthreport.uploadEnabled': false,
    'toolkit.telemetry.enabled': false, 'toolkit.telemetry.reportingpolicy.firstRun': false,
    // Pages are fake sites served by the harness: never reach the network for anything else.
    'network.proxy.type': 1, 'network.proxy.http': '127.0.0.1', 'network.proxy.http_port': 9, 'network.proxy.ssl': '127.0.0.1', 'network.proxy.ssl_port': 9,
    'network.proxy.allow_hijacking_localhost': true,
    'marionette.port': marionettePort,
    ...extraPrefs
  };
  fs.writeFileSync(path.join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${typeof value === 'string' ? JSON.stringify(value) : value});`).join('\n') + '\n');
}

// ─── Page helper ─────────────────────────────────────────────────────────────────────────────
export class Page {
  constructor(session, context) { this.session = session; this.bidi = session.bidi; this.context = context; }

  async goto(url) { await this.bidi.send('browsingContext.navigate', { context: this.context, url, wait: 'complete' }); }

  /**
   * Runs `fn(arg)` in the page's own (main) world and returns its JSON-serialisable result. The page
   * world is where the site's scripts run, so this is what a web page could see of the extension.
   * For extension pages (moz-extension://) the page world holds the extension's APIs.
   */
  async ev(fn, arg) {
    const expression = typeof fn === 'function'
      ? `(async()=>{const __v=await (${fn.toString()})(${JSON.stringify(arg === undefined ? null : arg)});return __v===undefined?undefined:JSON.stringify(__v);})()`
      : fn;
    const result = await this.bidi.send('script.evaluate', { expression, target: { context: this.context }, awaitPromise: true, userActivation: false });
    if (result.type === 'exception') throw new Error(`page exception: ${result.exceptionDetails?.text || ''} ${JSON.stringify(result.exceptionDetails?.exception || '').slice(0, 300)}`);
    return result.result.type === 'string' ? JSON.parse(result.result.value) : undefined;
  }

  async waitFor(fn, arg, { timeout = 20000, label = '' } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try { last = await this.ev(fn, arg); if (last) return last; } catch (error) { last = error.message; }
      await sleep(60);
    }
    throw new Error(`waitFor timed out (${label || fn.toString().slice(0, 90)}); last=${JSON.stringify(last)}`);
  }

  /** Brings the tab to the front (it becomes "the active tab" the popup scopes itself to). BiDi's activate refuses extension pages, so Marionette does it. */
  async activate() { await this.session.marionette.send('WebDriver:SwitchToWindow', { handle: this.context, focus: true }); }

  /** Sends native input through Marionette. The tab is focused first because key events to an unfocused document are dropped. */
  async perform(actions) {
    if (TRACE) console.error(`  [trace ${Date.now() % 1000000}] input ${JSON.stringify(actions).slice(0, 120)}`);
    await this.session.marionette.send('WebDriver:SwitchToWindow', { handle: this.context, focus: !this.keepBackground });
    if (!this.keepBackground) await this.waitFor(() => document.hasFocus(), null, { timeout: 15000, label: 'tab document has focus before synthesized input' });
    await this.session.marionette.send('WebDriver:PerformActions', { actions });
    // A click can close the page it landed on (the popup closes itself): releasing then has nothing left to release.
    await this.session.marionette.send('WebDriver:ReleaseActions').catch((error) => { if (!/discarded|no such window|closed/i.test(error.message)) throw error; });
  }

  async clickAt(point, { modifiers = [] } = {}) {
    const keys = modifiers.map((key) => KEYS[key] || key);
    const pointer = { type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', x: Math.round(point.x), y: Math.round(point.y), origin: 'viewport' }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] };
    const actions = [pointer];
    if (keys.length) actions.unshift({ type: 'key', id: 'mods', actions: keys.map((value) => ({ type: 'keyDown', value })) });
    await this.perform(actions);
  }

  /** Presses on `from`, moves in small steps and releases on `to` (pointer capture and drag handlers need the in-between moves). */
  async drag(from, to, steps = 8) {
    const moves = Array.from({ length: steps }, (_, i) => ({ type: 'pointerMove', x: Math.round(from.x + ((to.x - from.x) * (i + 1)) / steps), y: Math.round(from.y + ((to.y - from.y) * (i + 1)) / steps), origin: 'viewport', duration: 30 }));
    await this.perform([{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', x: Math.round(from.x), y: Math.round(from.y), origin: 'viewport' }, { type: 'pointerDown', button: 0 }, ...moves, { type: 'pointerUp', button: 0 }] }]);
  }

  async press(...keys) {
    const mapped = keys.map((key) => KEYS[key] || key);
    await this.perform([{ type: 'key', id: 'kbd', actions: [...mapped.map((value) => ({ type: 'keyDown', value })), ...[...mapped].reverse().map((value) => ({ type: 'keyUp', value }))] }]);
  }

  async type(text) {
    await this.perform([{ type: 'key', id: 'kbd', actions: [...text].flatMap((value) => [{ type: 'keyDown', value }, { type: 'keyUp', value }]) }]);
  }

  /** Full-page PNG through Marionette (BiDi screenshots refuse privileged-scope contexts). */
  async shot(file, { size } = {}) {
    await this.session.marionette.send('WebDriver:SwitchToWindow', { handle: this.context, focus: true });
    if (size) await this.session.marionette.send('WebDriver:SetWindowRect', size);
    await sleep(400);
    const { value: data } = await this.session.marionette.send('WebDriver:TakeScreenshot', { full: false });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }

  async close() { await this.bidi.send('browsingContext.close', { context: this.context }).catch(() => {}); }
}

// ─── Session ─────────────────────────────────────────────────────────────────────────────────
/**
 * Starts Firefox, installs the package at `packageDir` as a temporary add-on and returns a session.
 * `session.serveSite(siteId, options)` makes https://chatgpt.com etc. answer with the fake site.
 */
export async function launchFirefox({ packageDir, bin = FIREFOX_BIN, prefs = {} } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'abcm-firefox-'));
  const marionettePort = await freePort();
  writeUserJs(profile, marionettePort, prefs);
  const port = await freePort();
  const child = spawn(bin, ['-headless', '-no-remote', '-marionette', '-remote-allow-system-access', '-profile', profile, `--remote-debugging-port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const session = { child, profile, log: '', bidi: null, marionette: null, errors: [], servers: new Map(), intercepts: new Map() };
  child.stdout.on('data', (chunk) => { session.log += chunk; });
  child.stderr.on('data', (chunk) => { session.log += chunk; });

  let socket;
  for (let attempt = 0; attempt < 150 && !socket; attempt++) {
    try { socket = await new Promise((resolve, reject) => { const s = net.connect(marionettePort, '127.0.0.1', () => resolve(s)); s.once('error', reject); }); }
    catch { await sleep(200); }
  }
  if (!socket) { kill(child); throw new Error(`Firefox Marionette endpoint never came up: ${session.log.slice(-1500)}`); }
  session.marionette = new Marionette(socket);
  await session.marionette.hello;
  const created = await session.marionette.send('WebDriver:NewSession', { webSocketUrl: true });
  const wsUrl = created.capabilities.webSocketUrl;
  assert.ok(wsUrl, `Marionette session has no BiDi webSocketUrl: ${JSON.stringify(created).slice(0, 900)}`);
  const ws = await new Promise((resolve, reject) => { const s = new WebSocket(wsUrl); s.addEventListener('open', () => resolve(s)); s.addEventListener('error', reject); });
  session.bidi = new Bidi(ws);
  session.version = created.capabilities.browserVersion;
  // Page errors from every context (the extension's background and pages included) are collected.
  session.bidi.onEvent((message) => {
    if (message.method !== 'log.entryAdded') return;
    const entry = message.params;
    session.logEntries?.push(entry);
    if (entry.type === 'javascript' && entry.level === 'error') session.errors.push(`${entry.text} (${entry.source?.realm ? 'realm' : ''}${entry.stackTrace?.callFrames?.[0]?.url || ''})`);
  });
  await session.bidi.send('session.subscribe', { events: ['log.entryAdded', 'network.beforeRequestSent'] });

  session.install = async () => {
    const installed = await session.bidi.send('webExtension.install', { extensionData: { type: 'path', path: packageDir } });
    assert.equal(installed.extension, FIREFOX_ADDON_ID);
    return installed;
  };

  session.newPage = async ({ background = false } = {}) => {
    const { context } = await session.bidi.send('browsingContext.create', { type: 'tab', background });
    return new Page(session, context);
  };

  // ── fake chat sites ──
  // network.addIntercept pauses each matching request in the "beforeRequestSent" phase; the harness
  // answers it with network.provideResponse, so no byte of the fake site ever touches the network.
  // The request body is read through a data collector (BiDi does not put it in the event).
  const collectorReady = session.bidi.send('network.addDataCollector', { dataTypes: ['request'], maxEncodedDataSize: 1024 * 1024 }).then((r) => r.collector).catch(() => null);
  session.serveSite = async (siteId, options = {}) => {
    // A fresh server per call (each test starts from clean state); the intercept itself is added once per site.
    const server = createMockServer(options);
    session.servers.set(siteId, server);
    if (!session.intercepts.has(siteId)) {
      const url = new URL(SITE_HOSTS[siteId]);
      const { intercept } = await session.bidi.send('network.addIntercept', { phases: ['beforeRequestSent'], urlPatterns: [{ type: 'pattern', protocol: 'https', hostname: url.hostname }] });
      session.intercepts.set(siteId, intercept);
    }
    return server;
  };
  const toLower = (headers) => Object.fromEntries((headers || []).map((h) => [h.name.toLowerCase(), h.value?.value ?? '']));
  session.bidi.onEvent(async (message) => {
    if (message.method !== 'network.beforeRequestSent' || !message.params.isBlocked) return;
    const { request } = message.params;
    const url = new URL(request.url);
    const siteId = Object.keys(SITE_HOSTS).find((id) => new URL(SITE_HOSTS[id]).hostname === url.hostname);
    const server = session.servers.get(siteId);
    if (!server) { session.bidi.send('network.continueRequest', { request: request.request }).catch(() => {}); return; }
    let postData = '';
    if (request.bodySize > 0) {
      try {
        const collector = await collectorReady;
        const data = await session.bidi.send('network.getData', { dataType: 'request', request: request.request, ...(collector ? {} : {}) });
        postData = data.bytes.type === 'base64' ? Buffer.from(data.bytes.value, 'base64').toString('utf8') : data.bytes.value;
      } catch (error) { session.errors.push(`could not read request body: ${error.message}`); }
    }
    const reply = handleMockRequest(siteId, server, {
      method: request.method, url: request.url, headers: toLower(request.headers), postData,
      resourceType: request.destination === 'document' ? 'document' : (request.initiatorType || 'fetch')
    });
    session.bidi.send('network.provideResponse', {
      request: request.request, statusCode: reply.status, reasonPhrase: reply.status === 200 ? 'OK' : String(reply.status),
      headers: [['Content-Type', reply.contentType], ['Cache-Control', 'no-store'], ...Object.entries(reply.headers || {})].map(([name, value]) => ({ name, value: { type: 'string', value } })),
      body: { type: 'string', value: reply.body }
    }).catch((error) => session.errors.push(`provideResponse failed: ${error.message}`));
  });

  session.close = async () => {
    try { session.bidi.ws.close(); session.marionette.socket.destroy(); } catch { /* already gone */ }
    kill(child);
    await sleep(1200);
    for (let attempt = 0; attempt < 10; attempt++) {
      try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(500); }
    }
  };
  return session;
}

function kill(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']); else child.kill('SIGKILL');
}
