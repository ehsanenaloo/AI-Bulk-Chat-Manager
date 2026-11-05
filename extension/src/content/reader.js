/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Reads the conversation open in this tab, only when the user clicks Export. ChatGPT, Claude and
  Grok are read through the site's own backend from the page, with the user's existing session:
  same-origin GETs (Grok also one POST that asks for message text), no new permission. Gemini has no
  plain request, so its page is read after older turns have been loaded by scrolling. The answer goes
  straight to conversation.js; it is not kept.

  The page's markup is not used where a request exists: it changes often and shows only what is
  mounted. Reading does not depend on Fast mode, which governs delete and archive.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const PATHS = {
    chatgpt: /^\/(?:g\/[^/]+\/)?c\/([a-zA-Z0-9-]{8,})\/?$/,
    claude: /^\/chat\/([0-9a-fA-F-]{8,})\/?$/,
    grok: /^\/c\/([0-9a-fA-F-]{8,})\/?$/,
    gemini: /^(?:\/u\/\d+)?\/app\/([\w-]{8,})\/?$/,
    deepseek: /^\/a\/chat\/s\/([\w-]{8,})\/?$/,
    perplexity: /^\/search\/([\w-]{8,})\/?$/
  };
  const GROK_CHUNK = 20;
  const GROK_MAX_NODES = 2000;
  const GEMINI_MAX_ROUNDS = 80;

  /** The page address without the site's tracking parameter (Grok adds ?rid=...). */
  function cleanAddress(url) {
    try {
      const u = new g.URL(url);
      u.searchParams.delete('rid');
      return u.href;
    } catch (_) {
      return url;
    }
  }

  const abs = (path) => new g.URL(path, g.location.origin).href;

  /** The id of the conversation open in this tab, or '' on a page that is not one. */
  function currentId() {
    const site = ABCM.sites.current();
    const re = site && PATHS[site.id];
    if (!re) return '';
    const match = re.exec(g.location.pathname);
    if (match) return match[1];
    if (site.id === 'grok' && /^\/project\//.test(g.location.pathname)) {
      const chat = new g.URLSearchParams(g.location.search).get('chat') || '';
      return /^[0-9a-fA-F-]{8,}$/.test(chat) ? chat : '';
    }
    return '';
  }

  function canRead() {
    return Boolean(currentId());
  }

  const fail = (reason) => ({ ok: false, reason });

  function statusFailure(res) {
    if (res.status === 401 || res.status === 403) return fail('auth');
    if (res.status === 404) return fail('not-found');
    if (res.status === 429) return fail('rate-limited');
    return fail(`http-${res.status}`);
  }

  async function readChatgpt(id, url) {
    const cfg = ABCM.config.api.chatgpt;
    for (const force of [false, true]) {
      const token = await ABCM.apiEngine.getAccessToken(force);
      if (!token) return fail('auth');
      let res;
      try {
        res = await ABCM.apiEngine.timedFetch(abs(`${cfg.conversation}${encodeURIComponent(id)}`), { credentials: 'include', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
      } catch (_) {
        return fail('network');
      }
      if (res.status === 401 && !force) continue; // the cached token may have expired: ask once more
      if (!res.ok) return statusFailure(res);
      const data = await res.json().catch(() => null);
      if (!data || typeof data.mapping !== 'object') return fail('bad-answer');
      return { ok: true, conversation: ABCM.conversation.fromChatgpt(data, { id, url }) };
    }
    return fail('auth');
  }

  async function readClaude(id, url) {
    const org = await ABCM.apiEngine.getClaudeOrg();
    if (!org) return fail('no-org');
    const base = ABCM.config.api.claude.organizations;
    let res;
    try {
      res = await ABCM.apiEngine.timedFetch(abs(`${base}/${encodeURIComponent(org)}/chat_conversations/${encodeURIComponent(id)}?tree=True&rendering_mode=messages&render_all_tools=true`), { credentials: 'include', headers: { Accept: 'application/json' } });
    } catch (_) {
      return fail('network');
    }
    if (!res.ok) return statusFailure(res);
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.chat_messages)) return fail('bad-answer');
    return { ok: true, conversation: ABCM.conversation.fromClaude(data, { id, url }) };
  }

  async function readGrok(id, url, title = '') {
    const base = ABCM.config.api.grok.chat;
    const headers = () => ({ Accept: 'application/json', ...(typeof g.crypto?.randomUUID === 'function' ? { 'x-xai-request-id': g.crypto.randomUUID() } : {}) });
    let res;
    try {
      res = await ABCM.apiEngine.timedFetch(abs(`${base}/${encodeURIComponent(id)}/response-node`), { credentials: 'include', headers: headers() });
    } catch (_) {
      return fail('network');
    }
    if (!res.ok) return statusFailure(res);
    const nodeData = await res.json().catch(() => null);
    if (!nodeData || !Array.isArray(nodeData.responseNodes)) return fail('bad-answer');
    const ids = nodeData.responseNodes.filter((n) => n && n.responseId && !n.threadParentId).map((n) => n.responseId).slice(-GROK_MAX_NODES);
    const responses = [];
    for (let i = 0; i < ids.length; i += GROK_CHUNK) {
      let chunk;
      try {
        chunk = await ABCM.apiEngine.timedFetch(abs(`${base}/${encodeURIComponent(id)}/load-responses`), { method: 'POST', credentials: 'include', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ responseIds: ids.slice(i, i + GROK_CHUNK) }) });
      } catch (_) {
        return fail('network');
      }
      if (!chunk.ok) return statusFailure(chunk);
      const data = await chunk.json().catch(() => null);
      if (!data || !Array.isArray(data.responses)) return fail('bad-answer');
      responses.push(...data.responses);
    }
    return { ok: true, conversation: ABCM.conversation.fromGrok(nodeData, responses, { id, url: cleanAddress(url), title }) };
  }

  /** Scrolls the conversation up until the page stops adding turns. Returns false when the round limit was hit first. */
  async function loadOlderGemini(sel, onProgress) {
    const count = () => g.document.querySelectorAll(`${sel.user}, ${sel.model}`).length;
    const scroller = Array.from(g.document.querySelectorAll(sel.scroller)).find((el) => el.scrollHeight > el.clientHeight && el.querySelector(`${sel.user}, ${sel.model}`));
    if (!scroller) return true;
    let still = 0;
    for (let round = 0; round < GEMINI_MAX_ROUNDS; round++) {
      const before = count();
      scroller.scrollTop = 0;
      await ABCM.util.delay(350);
      if (count() === before) { still++; if (still >= 2) break; } else { still = 0; onProgress?.(); }
      if (round === GEMINI_MAX_ROUNDS - 1) { scroller.scrollTop = scroller.scrollHeight; return false; }
    }
    scroller.scrollTop = scroller.scrollHeight;
    return true;
  }

  async function readGemini(id, onProgress) {
    const sel = ABCM.sites.byId('gemini').read;
    const any = () => g.document.querySelector(`${sel.user}, ${sel.model}`);
    for (let i = 0; i < 10 && !any(); i++) await ABCM.util.delay(300);
    if (!any()) return fail('empty');
    const complete = await loadOlderGemini(sel, onProgress);
    const conversation = ABCM.conversation.fromGemini(g.document, { id, url: g.location.href, title: g.document.title, selectors: sel, incomplete: !complete });
    return conversation.messages.length ? { ok: true, conversation } : fail('empty');
  }

  /** Perplexity: the whole thread in one same-origin GET. */
  async function readPerplexity(id, url, title = '') {
    const cfg = ABCM.config.api.perplexity;
    let res;
    try {
      res = await ABCM.apiEngine.timedFetch(abs(`${cfg.thread}${encodeURIComponent(id)}?with_schematized_response=true&${cfg.query}&limit=100`), { credentials: 'include', headers: { Accept: 'application/json' } });
    } catch (_) {
      return fail('network');
    }
    if (!res.ok) return statusFailure(res);
    const data = await res.json().catch(() => null);
    if (!data || data.status !== 'success' || !Array.isArray(data.entries)) return fail('bad-answer');
    const conversation = ABCM.conversation.fromPerplexity(data, { id, url, title });
    return conversation.messages.length ? { ok: true, conversation } : fail('empty');
  }

  /** DeepSeek: the whole chat in one same-origin GET with the page's own token. */
  async function readDeepseek(id, url, title = '') {
    const token = ABCM.apiEngine.deepseekToken();
    if (!token) return fail('auth');
    let res;
    try {
      res = await ABCM.apiEngine.timedFetch(abs(`${ABCM.config.api.deepseek.history}?chat_session_id=${encodeURIComponent(id)}`), { credentials: 'include', headers: ABCM.apiEngine.deepseekHeaders(token) });
    } catch (_) {
      return fail('network');
    }
    if (!res.ok) return statusFailure(res);
    const data = await res.json().catch(() => null);
    if (data?.code !== 0 || data?.data?.biz_code !== 0 || !Array.isArray(data?.data?.biz_data?.chat_messages)) return fail(data?.data?.biz_code ? 'unreadable' : 'bad-answer');
    const conversation = ABCM.conversation.fromDeepseek(data.data.biz_data, { id, url, title });
    return conversation.messages.length ? { ok: true, conversation } : fail('empty');
  }

  /** What a failed Gemini call means to the reader's callers. */
  function geminiReason(reason) {
    const text = String(reason || '');
    if (/^api-code-/.test(text)) return 'unreadable';
    if (text === 'gemini-no-token' || text === 'api-auth-failed') return 'auth';
    if (text === 'api-rate-limited') return 'rate-limited';
    if (/^api-(timeout|network)/.test(text)) return 'network';
    if (text === 'api-bad-answer') return 'bad-answer';
    const http = /^api-http-(\d+)$/.exec(text);
    return http ? `http-${http[1]}` : 'other';
  }

  /** Gemini through its own call: pages of turns, newest first, until the site gives no further page. */
  async function readGeminiApi(id, url, title = '') {
    const cfg = ABCM.config.api.gemini;
    const chatId = id.startsWith('c_') ? id : `c_${id}`;
    const turns = [];
    let cursor = null;
    for (let page = 0; page < cfg.readMaxPages; page++) {
      const answer = await ABCM.apiEngine.geminiRpc(cfg.readRpc, [chatId, cfg.readPageSize, cursor, 1, [0], [4], null, 1], id);
      if (!answer.ok) return fail(geminiReason(answer.reason));
      let data = null;
      try { data = JSON.parse(answer.entry[2]); } catch (_) { return fail('bad-answer'); }
      if (!Array.isArray(data?.[0])) return fail('bad-answer');
      turns.push(...data[0]);
      cursor = typeof data[1] === 'string' && data[1] ? data[1] : null;
      if (!cursor) break;
    }
    if (!turns.length) return fail('empty');
    return { ok: true, conversation: ABCM.conversation.fromGeminiRpc(turns.reverse(), { id, url, title }) };
  }

  const MAX_PICTURE_SIDE = 4096;

  /** The bytes of a picture the page has already loaded, as PNG, or null when the page does not let a script read it. */
  async function pictureOf(img) {
    if (!img?.complete || !img.naturalWidth || !img.naturalHeight) return null;
    const scale = Math.min(1, MAX_PICTURE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    try {
      const canvas = g.document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return null;
      return { mime: 'image/png', bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
    } catch (_) {
      return null; // the picture comes from another address and the page does not allow it to be read
    }
  }

  /**
   * Fills in the pictures of a Gemini conversation from what the page already shows (no request). The page
   * lists the turns that are loaded, newest last, so its messages are matched from the end. A picture the
   * page does not let a script read stays a note. A message with no picture on the page keeps its notes.
   */
  async function attachGeminiPictures(conversation) {
    const read = ABCM.sites.byId('gemini').read;
    for (const [role, rootSelector, imgSelector] of [['user', read.user, read.images.user], ['assistant', read.model, read.images.model]]) {
      const elements = Array.from(g.document.querySelectorAll(rootSelector));
      const messages = conversation.messages.filter((m) => m.role === role);
      const offset = messages.length - elements.length;
      for (let i = 0; i < elements.length; i++) {
        const message = messages[offset + i];
        const images = Array.from(elements[i].querySelectorAll(imgSelector));
        if (!message || !images.length) continue;
        message.parts = message.parts.filter((p) => p.kind !== 'image');
        for (const img of images) {
          const data = await pictureOf(img);
          message.parts.push(data ? { kind: 'image', name: '', alt: img.alt || '', data } : { kind: 'image', name: '' });
        }
      }
    }
  }

  /** { ok: true, conversation } or { ok: false, reason }. onProgress is called while older turns load. */
  async function read({ onProgress } = {}) {
    const site = ABCM.sites.current();
    const id = currentId();
    if (!site || !id) return fail('not-a-conversation');
    if (site.id === 'chatgpt') return readChatgpt(id, g.location.href);
    if (site.id === 'claude') return readClaude(id, g.location.href);
    if (site.id === 'grok') return readGrok(id, g.location.href, g.document.title);
    if (site.id === 'deepseek') return readDeepseek(id, g.location.href, g.document.title);
    if (site.id === 'perplexity') return readPerplexity(id, g.location.href, g.document.title);
    if (site.id === 'gemini') {
      // The site's own call gives model names and times and needs no scrolling; the page is the fallback.
      const viaApi = await readGeminiApi(id, g.location.href, g.document.title);
      if (!viaApi.ok) return readGemini(id, onProgress);
      try { await attachGeminiPictures(viaApi.conversation); } catch (error) { ABCM.warn('pictures of the page were not read', error); }
      return viaApi;
    }
    return fail('unsupported');
  }

  /** True where a chat can be read from its id alone, without opening it. */
  function canReadMany() {
    const site = ABCM.sites.current();
    return Boolean(site && ['chatgpt', 'claude', 'grok', 'gemini', 'deepseek', 'perplexity'].includes(site.id));
  }

  /** Reads any chat of this site by id: the same requests as read(), for a chat that is not open. */
  async function readId(id, url = '') {
    const site = ABCM.sites.current();
    if (!site || !id) return fail('not-a-conversation');
    const link = url ? abs(url) : '';
    if (site.id === 'chatgpt') return readChatgpt(id, link);
    if (site.id === 'claude') return readClaude(id, link);
    if (site.id === 'grok') return readGrok(id, link);
    if (site.id === 'gemini') return readGeminiApi(id, link);
    if (site.id === 'deepseek') return readDeepseek(id, link);
    if (site.id === 'perplexity') return readPerplexity(id, link);
    return fail('unsupported');
  }

  ABCM.define('reader', { currentId, canRead, canReadMany, read, readId });
})(globalThis);
