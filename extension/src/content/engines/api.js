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
  const memo = { token: null, tokenAt: 0, claudeOrg: null, grokBroken: false };

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

  async function claudeAction(operation, id) {
    if (operation !== 'DELETE') return { ok: false, reason: 'archive-unsupported' };
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
      res = await timedFetch(abs(`${cfg().grok.conversations}/${encodeURIComponent(id)}`), { method: 'DELETE', credentials: 'include' });
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

  /** Whether a finished archive can be undone: only ChatGPT, and only through its backend. */
  function canUndoArchive() {
    return siteId() === 'chatgpt' && isEnabled();
  }

  /** Does the one-time preparation a run benefits from (ChatGPT: fetch the bearer token up front). */
  async function prepare() {
    if (siteId() === 'chatgpt') await getAccessToken();
  }

  /** Runs one operation on one chat id through the site's backend. */
  async function run(operation, id) {
    if (!id) return { ok: false, reason: 'conversation-id-missing' };
    switch (siteId()) {
      case 'chatgpt': return chatgptAction(operation, id);
      case 'claude': return claudeAction(operation, id);
      case 'grok': return grokAction(operation, id);
      default: return { ok: false, reason: 'api-unsupported' };
    }
  }

  /**
   * Hides a row after the backend accepted the change. Removing a framework-owned node risks a
   * NotFoundError when the site later reconciles that subtree, so the row is hidden instead; the
   * site stays the owner of the node.
   */
  function retireRow(record) {
    const anchor = record?.anchor || (record?.id ? ABCM.state.get(record.id)?.anchor : null);
    if (!anchor) return;
    try { ABCM.checkboxes.detach(anchor); } catch (_) { /* row already gone */ }
    try {
      if (!anchor.isConnected) return;
      (ABCM.dom.rowOf(anchor) || anchor).setAttribute('data-abcm-retired', '1');
    } catch (_) { /* row already gone */ }
  }

  ABCM.define('apiEngine', { isEnabled, canUndoArchive, prepare, run, retireRow, getAccessToken, parseRetryAfter, _memo: memo });
})(globalThis);
