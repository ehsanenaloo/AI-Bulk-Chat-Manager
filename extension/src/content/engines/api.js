/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  API engine ("fast mode"): deletes or archives a chat by calling the site's own backend, from the
  page, with the user's existing session, instead of driving the row menu and confirm dialog.

  The requests are same-origin, so the session cookie rides along and no extra permission or host
  access is needed. These endpoints are internal and undocumented.

  Every result says what is known about the change:
    ok: true                    the backend accepted it
    ok: false                   the backend refused it, nothing changed (the page UI may try)
    ok: false, unknown: true    a timeout, dropped connection or server error: the backend may or may
                                not have applied it, so the caller must not repeat it blindly
    ok: false, retryAfterMs     rate limited, nothing changed
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const TOKEN_TTL_MS = 5 * 60 * 1000;
  const MAX_RETRY_AFTER_MS = 60 * 1000;
  const memo = { token: null, tokenAt: 0, claudeOrg: null, grokBroken: false, sessionsBroken: false, gemini: null, perplexity: null };

  const siteId = () => ABCM.sites.current()?.id || '';
  const cfg = () => ABCM.config.api;
  // Always address the page's own origin. A relative URL would follow a <base href> that the site (or
  // an injected tag) sets, and could then send the session token somewhere else.
  const abs = (path) => new g.URL(path, g.location.origin).href;

  /** Retry-After as milliseconds (seconds or an HTTP date), capped, or 0 when absent or invalid. */
  function parseRetryAfter(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return 0;
    let ms = 0;
    if (/^\d+$/.test(raw)) ms = Number(raw) * 1000;
    else {
      const at = Date.parse(raw);
      if (Number.isFinite(at)) ms = at - Date.now();
    }
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.round(ms)));
  }

  function result(res, okStatuses = [200, 201, 204]) {
    if (res.status === 429) return { ok: false, reason: 'api-rate-limited', retryAfterMs: parseRetryAfter(res.headers?.get?.('retry-after')) };
    // A reply that came through a redirect (for example a sign-in page) is not the endpoint's acknowledgement.
    if (res.redirected) return { ok: false, unknown: true, reason: 'api-redirected' };
    if (res.ok || okStatuses.includes(res.status)) return { ok: true, verified: true, via: 'api' };
    // A server error does not say whether the change was applied before it failed.
    if (res.status >= 500) return { ok: false, unknown: true, reason: `api-http-${res.status}` };
    return { ok: false, reason: `api-http-${res.status}` };
  }

  /** A timeout or dropped connection on a mutation leaves the outcome unknown. */
  function failure(error) {
    return { ok: false, unknown: true, reason: error?.name === 'TimeoutError' ? 'api-timeout' : 'api-network-error' };
  }

  /** fetch() that gives up after config.api.timeoutMs and always releases its timer. */
  async function timedFetch(url, init = {}) {
    const limit = Number(cfg().timeoutMs) > 0 ? Number(cfg().timeoutMs) : 0;
    if (!limit || typeof g.AbortController !== 'function') return g.fetch(url, init);
    const controller = new g.AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, limit);
    try {
      return await g.fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (timedOut) {
        const timeout = new Error('timeout');
        timeout.name = 'TimeoutError';
        throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Whether the API path should be tried at all for the current page. */
  function isEnabled() {
    const site = ABCM.sites.current();
    if (!site || site.method !== 'api') return false;
    if (ABCM.settings.get().fastMode === false) return false;
    if (site.id === 'grok' && memo.grokBroken) return false;
    return true;
  }

  // ── ChatGPT ──────────────────────────────────────────────────────────────────────────────
  async function getAccessToken(force = false) {
    const now = Date.now();
    if (!force && memo.token && now - memo.tokenAt < TOKEN_TTL_MS) return memo.token;
    try {
      const res = await timedFetch(abs(cfg().chatgpt.session), { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      memo.token = data?.accessToken || null;
      memo.tokenAt = now;
      return memo.token;
    } catch (_) {
      return null;
    }
  }

  function patchChatgpt(id, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return timedFetch(abs(`${cfg().chatgpt.conversation}${encodeURIComponent(id)}`), {
      method: 'PATCH', credentials: 'include', headers, body: JSON.stringify(body)
    });
  }

  async function chatgptAction(operation, id) {
    const body = operation === 'DELETE' ? cfg().chatgpt.deleteBody : operation === 'UNARCHIVE' ? cfg().chatgpt.unarchiveBody : cfg().chatgpt.archiveBody;
    let res;
    try { res = await patchChatgpt(id, body, memo.token); } catch (error) { return failure(error); }
    // The cookie alone was not accepted: fetch a bearer token and retry once.
    if (res.status === 401 || res.status === 403) {
      const token = await getAccessToken(true);
      if (!token) return { ok: false, reason: 'api-auth-failed' };
      try { res = await patchChatgpt(id, body, token); } catch (error) { return failure(error); }
    }
    return result(res);
  }

  // ── Claude: organisation-scoped REST. Delete only (Claude has no archive). ─────────────────
  /** The organisation the signed-in page is using, from the site's own "lastActiveOrg" cookie. */
  function activeOrgHint() {
    try {
      const match = String(g.document.cookie || '').match(/(?:^|;\s*)lastActiveOrg=([^;]+)/);
      return match ? decodeURIComponent(match[1]) : '';
    } catch (_) {
      return '';
    }
  }

  /**
   * Resolves the organisation to address. The page's active organisation wins when it is in the
   * account's list. Without that hint only an account with a single chat organisation is accepted:
   * guessing among several could send the request to an organisation that does not own the chat.
   */
  async function getClaudeOrg() {
    if (memo.claudeOrg) return memo.claudeOrg;
    try {
      const res = await timedFetch(abs(cfg().claude.organizations), { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const list = await res.json().catch(() => null);
      const orgs = (Array.isArray(list) ? list : []).filter((org) => typeof org?.uuid === 'string' && org.uuid);
      const hint = activeOrgHint();
      const active = hint ? orgs.find((org) => org.uuid === hint) : null;
      const chatOrgs = orgs.filter((org) => Array.isArray(org.capabilities) && org.capabilities.includes('chat'));
      const pool = chatOrgs.length ? chatOrgs : orgs;
      memo.claudeOrg = active?.uuid || (pool.length === 1 ? pool[0].uuid : null);
    } catch (_) {
      memo.claudeOrg = null;
    }
    return memo.claudeOrg;
  }

  async function claudeDeleteOnce(id) {
    const org = await getClaudeOrg();
    if (!org) return { kind: 'no-org' };
    try {
      const res = await timedFetch(abs(`${cfg().claude.organizations}/${encodeURIComponent(org)}/chat_conversations/${encodeURIComponent(id)}`), {
        method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }
      });
      return { kind: 'response', res };
    } catch (error) {
      return { kind: 'network', error };
    }
  }

  /**
   * Claude Code and Cowork session: the site itself sends DELETE /v1/code/sessions/<id> with the page's cookies and
   * the version, beta and organisation headers (read from its own requests on 2026-11-01). A refusal that says the
   * request shape differs stops further tries on this page, so the page UI takes over without a wasted request per session.
   */
  async function claudeSessionDelete(id) {
    if (memo.sessionsBroken) return { ok: false, reason: 'api-unsupported' };
    const org = await getClaudeOrg();
    if (!org) return { ok: false, reason: 'claude-no-org' };
    let res;
    try {
      res = await timedFetch(abs(`${cfg().claude.sessions}/${encodeURIComponent(id)}`), {
        method: 'DELETE', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...cfg().claude.sessionHeaders, 'x-organization-uuid': org }
      });
    } catch (error) {
      return failure(error);
    }
    if ([400, 401, 403, 404, 405, 422].includes(res.status)) memo.sessionsBroken = true;
    return result(res);
  }

  async function claudeAction(operation, id) {
    if (operation !== 'DELETE') return { ok: false, reason: 'archive-unsupported' };
    // Claude Code (session_) and Cowork (cse_) sessions share one endpoint and are not chats.
    if (/^(session|cse)_/.test(id)) return claudeSessionDelete(id);
    let attempt = await claudeDeleteOnce(id);
    // 403/404 can mean the cached organisation went stale (the user switched organisation): refresh it once.
    if (attempt.kind === 'response' && (attempt.res.status === 403 || attempt.res.status === 404)) {
      memo.claudeOrg = null;
      attempt = await claudeDeleteOnce(id);
    }
    if (attempt.kind === 'no-org') return { ok: false, reason: 'claude-no-org' };
    if (attempt.kind === 'network') return failure(attempt.error);
    return result(attempt.res);
  }

  // ── Grok: same-origin REST. Delete only. ───────────────────────────────────────────────────
  async function grokAction(operation, id) {
    if (operation !== 'DELETE') return { ok: false, reason: 'archive-unsupported' };
    let res;
    try {
      // The site sends DELETE .../conversations/soft/<id> with only a fresh request id (read from its own request on 2026-11-02).
      const headers = typeof g.crypto?.randomUUID === 'function' ? { 'x-xai-request-id': g.crypto.randomUUID() } : {};
      res = await timedFetch(abs(`${cfg().grok.conversations}/${encodeURIComponent(id)}`), { method: 'DELETE', credentials: 'include', headers });
    } catch (error) {
      return failure(error);
    }
    if (res.status === 404 || res.status === 405) {
      // The endpoint shape does not match this deployment: stop spending a request per chat.
      memo.grokBroken = true;
      return { ok: false, reason: `api-http-${res.status}` };
    }
    return result(res);
  }

  // ── Perplexity: same-origin REST. Delete only. ───────────────────────────────────────────────
  // The page lists a thread by its slug (the id in the sidebar link); deleting needs the thread's entry id and write token,
  // which the thread list holds. The list is read once per run and again only when a slug is missing from it.
  const PERPLEXITY_LIST_AGE_MS = 60 * 1000;

  async function loadPerplexityThreads() {
    const map = new Map();
    const url = abs(`${cfg().perplexity.list}?${cfg().perplexity.query}`);
    for (let offset = 0, pages = 0; pages < 200; pages++) {
      const res = await timedFetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 20, ascending: false, offset, search_term: '', exclude_asi: false }) });
      if (!res.ok) throw new Error(`list-${res.status}`);
      const page = await res.json().catch(() => null);
      if (!Array.isArray(page) || !page.length) break;
      for (const item of page) if (item?.slug && item?.uuid) map.set(String(item.slug), { uuid: String(item.uuid), token: String(item.read_write_token || '') });
      offset += page.length;
    }
    return map;
  }

  /** The thread list as a promise, shared by the workers of one run (they ask at the same moment). */
  function perplexityThreads(force) {
    const now = Date.now();
    if (!force && memo.perplexity && now - memo.perplexity.at < PERPLEXITY_LIST_AGE_MS) return memo.perplexity.promise;
    const promise = loadPerplexityThreads();
    memo.perplexity = { at: now, promise };
    promise.catch(() => { if (memo.perplexity?.promise === promise) memo.perplexity = null; });
    return promise;
  }

  async function perplexityAction(operation, id) {
    if (operation !== 'DELETE') return { ok: false, reason: 'archive-unsupported' };
    let entry = null;
    try {
      entry = (await perplexityThreads(false)).get(id) || (await perplexityThreads(true)).get(id);
    } catch (error) {
      return /^list-(401|403)$/.test(error?.message) ? { ok: false, reason: 'api-auth-failed' } : failure(error);
    }
    if (!entry) return { ok: false, reason: 'perplexity-not-listed' };
    let res;
    try {
      res = await timedFetch(abs(`${cfg().perplexity.remove}?${cfg().perplexity.query}`), { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry_uuid: entry.uuid, read_write_token: entry.token }) });
    } catch (error) { return failure(error); }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'api-auth-failed' };
    const verdict = result(res);
    if (!verdict.ok) return verdict;
    let reply = null;
    try { reply = await res.json(); } catch (_) { return { ok: false, unknown: true, reason: 'api-bad-answer' }; }
    if (reply?.status === 'success') { try { (await perplexityThreads(false)).delete(id); } catch (_) { /* the list is read again next time */ } return { ok: true, verified: true, via: 'api' }; }
    return reply?.status ? { ok: false, reason: `api-status-${String(reply.status).slice(0, 20)}` } : { ok: false, unknown: true, reason: 'api-bad-answer' };
  }

  // ── DeepSeek: same-origin REST with the user's own login token. Delete only. ───────────────────
  // The page keeps its token in its own storage (key userToken, JSON with a value). The call goes only to the page's origin.
  function deepseekToken() {
    try { return String(JSON.parse(g.localStorage.getItem('userToken') || 'null')?.value || ''); } catch (_) { return ''; }
  }

  const deepseekHeaders = (token, json = false) => ({
    Authorization: `Bearer ${token}`, Accept: '*/*', 'x-client-platform': 'web', ...(json ? { 'Content-Type': 'application/json' } : {})
  });

  async function deepseekAction(operation, id) {
    if (operation !== 'DELETE') return { ok: false, reason: 'archive-unsupported' };
    const token = deepseekToken();
    if (!token) return { ok: false, reason: 'deepseek-no-token' };
    let res;
    try {
      res = await timedFetch(abs(cfg().deepseek.remove), { method: 'POST', credentials: 'include', headers: deepseekHeaders(token, true), body: JSON.stringify({ chat_session_ids: [id] }) });
    } catch (error) { return failure(error); }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'api-auth-failed' };
    const verdict = result(res);
    if (!verdict.ok) return verdict;
    let reply = null;
    try { reply = await res.json(); } catch (_) { return { ok: false, unknown: true, reason: 'api-bad-answer' }; }
    // The site answers HTTP 200 with its own code: 0 is done, anything else says nothing changed.
    if (reply?.code === 0 && reply?.data?.biz_code === 0) return { ok: true, verified: true, via: 'api' };
    if (reply && (reply.code !== 0 || reply.data?.biz_code !== 0)) return { ok: false, reason: `api-code-${reply.data?.biz_code ?? reply.code}` };
    return { ok: false, unknown: true, reason: 'api-bad-answer' };
  }

  // ── Gemini: one batch endpoint ("batchexecute"). Delete only. ───────────────────────────────
  // The page keeps three values the site's own calls need: the request token (SNlM0e), the build label (cfb2h)
  // and the session id (FdrFJe). They sit in an inline script as plain text, which this script can read; it
  // cannot read the page's JS variables. The page address (/app) is fetched only when no such script is found.
  const GEMINI_KEYS = { at: 'SNlM0e', bl: 'cfb2h', sid: 'FdrFJe' };

  function geminiTokensFrom(text) {
    const pick = (key) => new RegExp(`"${key}":"([^"]+)"`).exec(text)?.[1] || '';
    const tokens = { at: pick(GEMINI_KEYS.at), bl: pick(GEMINI_KEYS.bl), sid: pick(GEMINI_KEYS.sid) };
    return tokens.at && tokens.bl ? tokens : null;
  }

  async function getGeminiTokens(force = false) {
    if (!force && memo.gemini) return memo.gemini;
    let tokens = null;
    if (!force) {
      for (const script of Array.from(g.document.scripts)) {
        const text = script.textContent || '';
        if (text.includes(`"${GEMINI_KEYS.at}"`)) { tokens = geminiTokensFrom(text); if (tokens) break; }
      }
    }
    if (!tokens) {
      try {
        const res = await timedFetch(abs(cfg().gemini.page), { credentials: 'include' });
        if (res.ok) tokens = geminiTokensFrom(await res.text());
      } catch (_) { /* no tokens: the page UI will do it */ }
    }
    memo.gemini = tokens;
    return tokens;
  }

  /** The reply is `)]}'` then length-prefixed JSON arrays. Returns the entry for the call, or null. */
  function geminiEntry(text, rpc) {
    for (const line of String(text).split(String.fromCharCode(10))) {
      if (!line.startsWith('[')) continue;
      let parsed;
      try { parsed = JSON.parse(line); } catch (_) { continue; }
      for (const entry of Array.isArray(parsed) ? parsed : []) if (Array.isArray(entry) && entry[0] === 'wrb.fr' && entry[1] === rpc) return entry;
    }
    return null;
  }

  async function geminiPost(tokens, rpc, payload, id) {
    const url = new g.URL(abs(cfg().gemini.batchexecute));
    url.searchParams.set('rpcids', rpc);
    url.searchParams.set('source-path', `/app/${id}`);
    url.searchParams.set('bl', tokens.bl);
    if (tokens.sid) url.searchParams.set('f.sid', tokens.sid);
    url.searchParams.set('hl', g.document.documentElement.lang || 'en');
    url.searchParams.set('_reqid', String(100000 + Math.floor(Math.random() * 900000)));
    url.searchParams.set('rt', 'c');
    const body = new g.URLSearchParams({ 'f.req': JSON.stringify([[[rpc, JSON.stringify(payload), null, 'generic']]]), at: tokens.at }).toString();
    return timedFetch(url.href, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body });
  }

  /**
   * One batchexecute call. id is the chat's id as it appears in the page address (no c_ prefix); it only names
   * the page the call comes from. Returns { ok: true, entry } or the usual failure shapes ({ ok: false, reason }).
   */
  async function geminiRpc(rpc, payload, id) {
    let tokens = await getGeminiTokens();
    if (!tokens) return { ok: false, reason: 'gemini-no-token' };
    let res;
    try { res = await geminiPost(tokens, rpc, payload, id); } catch (error) { return failure(error); }
    // An old token is refused: read fresh ones from the page address and try once more.
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      memo.gemini = null;
      tokens = await getGeminiTokens(true);
      if (!tokens) return { ok: false, reason: 'api-auth-failed' };
      try { res = await geminiPost(tokens, rpc, payload, id); } catch (error) { return failure(error); }
    }
    const verdict = result(res);
    if (!verdict.ok) return verdict;
    let text = '';
    try { text = await res.text(); } catch (_) { return { ok: false, unknown: true, reason: 'api-bad-answer' }; }
    const entry = geminiEntry(text, rpc);
    // Success is a reply for this call with no error code; anything else may or may not have changed something.
    if (entry && entry[5] == null) return { ok: true, verified: true, via: 'api', entry };
    if (entry && Array.isArray(entry[5])) return { ok: false, reason: `api-code-${entry[5][0] ?? 'unknown'}` };
    return { ok: false, unknown: true, reason: 'api-bad-answer' };
  }

  async function geminiAction(operation, id) {
    if (operation !== 'DELETE') return { ok: false, reason: 'archive-unsupported' };
    const chatId = id.startsWith('c_') ? id : `c_${id}`; // the site's links drop the prefix, its calls keep it
    const done = await geminiRpc(cfg().gemini.deleteRpc, [chatId], id);
    return done.ok ? { ok: true, verified: true, via: 'api' } : done;
  }

  /** Whether a finished archive can be undone: only ChatGPT, and only through its backend. */
  function canUndoArchive() {
    return siteId() === 'chatgpt' && isEnabled();
  }

  /** Does the one-time preparation a run benefits from (ChatGPT: fetch the bearer token up front). */
  async function prepare() {
    if (siteId() === 'chatgpt') await getAccessToken();
    if (siteId() === 'gemini') await getGeminiTokens();
  }

  /** Runs one operation on one chat id through the site's backend. */
  async function run(operation, id) {
    if (!id) return { ok: false, reason: 'conversation-id-missing' };
    switch (siteId()) {
      case 'chatgpt': return chatgptAction(operation, id);
      case 'claude': return claudeAction(operation, id);
      case 'grok': return grokAction(operation, id);
      case 'gemini': return geminiAction(operation, id);
      case 'deepseek': return deepseekAction(operation, id);
      case 'perplexity': return perplexityAction(operation, id);
      default: return { ok: false, reason: 'api-unsupported' };
    }
  }

  /**
   * Hides a row after the backend accepted the change. Removing a framework-owned node risks a
   * NotFoundError when the site later reconciles that subtree, so the row is hidden instead; the
   * site stays the owner of the node.
   */
  function retireRow(record) {
    const id = record?.id;
    const anchors = new Set();
    const known = record?.anchor || (id ? ABCM.state.get(id)?.anchor : null);
    if (known) anchors.add(known);
    // The same chat can be listed twice (for example under Recents and inside a Project): every row goes.
    if (id) { try { for (const a of ABCM.dom.getAllConversations()) if (ABCM.dom.idFromElement(a) === id) anchors.add(a); } catch (_) { /* the list is not readable now */ } }
    for (const anchor of anchors) {
      try { ABCM.checkboxes.detach(anchor); } catch (_) { /* row already gone */ }
      try {
        if (!anchor.isConnected) continue;
        (ABCM.dom.rowOf(anchor) || anchor).setAttribute('data-abcm-retired', '1');
      } catch (_) { /* row already gone */ }
    }
  }

  ABCM.define('apiEngine', { deepseekToken, deepseekHeaders, isEnabled, canUndoArchive, prepare, run, retireRow, getAccessToken, getClaudeOrg, geminiRpc, timedFetch, parseRetryAfter, _memo: memo });
})(globalThis);
