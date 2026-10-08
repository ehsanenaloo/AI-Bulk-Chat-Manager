/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  API engine ("fast mode"): deletes or archives a chat by calling the site's own backend, from the
  page, with the user's existing session, instead of driving the row menu and confirm dialog.

  The requests are same-origin, so the session cookie rides along and no extra permission or host
  access is needed. These endpoints are internal and undocumented. The bulk engine therefore never
  treats this engine as the only way: on any failure it falls back to the page UI.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const TOKEN_TTL_MS = 5 * 60 * 1000;
  const memo = { token: null, tokenAt: 0, claudeOrg: null, grokBroken: false };

  const siteId = () => ABCM.sites.current()?.id || '';
  const cfg = () => ABCM.config.api;
  // Always address the page's own origin. A relative URL would follow a <base href> that the site (or
  // an injected tag) sets, and could then send the session token somewhere else.
  const abs = (path) => new g.URL(path, g.location.origin).href;

  function result(res, okStatuses = [200, 201, 204]) {
    if (res.status === 429) return { ok: false, reason: 'api-rate-limited' };
    if (!(res.ok || okStatuses.includes(res.status))) return { ok: false, reason: `api-http-${res.status}` };
    return { ok: true, verified: true, via: 'api' };
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
      const res = await g.fetch(abs(cfg().chatgpt.session), { credentials: 'include', headers: { Accept: 'application/json' } });
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
    return g.fetch(abs(`${cfg().chatgpt.conversation}${encodeURIComponent(id)}`), {
      method: 'PATCH', credentials: 'include', headers, body: JSON.stringify(body)
    });
  }

  async function chatgptAction(operation, id) {
    const body = operation === 'DELETE' ? cfg().chatgpt.deleteBody : cfg().chatgpt.archiveBody;
    let res;
    try { res = await patchChatgpt(id, body, memo.token); } catch (_) { return { ok: false, reason: 'api-network-error' }; }
    // The cookie alone was not accepted: fetch a bearer token and retry once.
    if (res.status === 401 || res.status === 403) {
      const token = await getAccessToken(true);
      if (!token) return { ok: false, reason: 'api-auth-failed' };
      try { res = await patchChatgpt(id, body, token); } catch (_) { return { ok: false, reason: 'api-network-error' }; }
    }
    return result(res);
  }

  // ── Claude: organisation-scoped REST. Delete only (Claude has no archive). ─────────────────
  async function getClaudeOrg() {
    if (memo.claudeOrg) return memo.claudeOrg;
    try {
      const res = await g.fetch(abs(cfg().claude.organizations), { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const list = await res.json().catch(() => null);
      const orgs = Array.isArray(list) ? list : [];
      const pick = orgs.find((org) => Array.isArray(org?.capabilities) && org.capabilities.includes('chat')) || orgs[0];
      memo.claudeOrg = pick?.uuid || null;
    } catch (_) {
      memo.claudeOrg = null;
    }
    return memo.claudeOrg;
  }

  async function claudeDeleteOnce(id) {
    const org = await getClaudeOrg();
    if (!org) return { kind: 'no-org' };
    try {
      const res = await g.fetch(abs(`${cfg().claude.organizations}/${org}/chat_conversations/${encodeURIComponent(id)}`), {
        method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }
      });
      return { kind: 'response', res };
    } catch (_) {
      return { kind: 'network' };
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
    if (attempt.kind === 'network') return { ok: false, reason: 'api-network-error' };
    return result(attempt.res);
  }

  // ── Grok: same-origin REST. Delete only. ───────────────────────────────────────────────────
  async function grokAction(operation, id) {
    if (operation !== 'DELETE') return { ok: false, reason: 'archive-unsupported' };
    let res;
    try {
      res = await g.fetch(abs(`${cfg().grok.conversations}/${encodeURIComponent(id)}`), { method: 'DELETE', credentials: 'include' });
    } catch (_) {
      return { ok: false, reason: 'api-network-error' };
    }
    if (res.status === 404 || res.status === 405) {
      // The endpoint shape does not match this deployment: stop spending a request per chat.
      memo.grokBroken = true;
      return { ok: false, reason: `api-http-${res.status}` };
    }
    return result(res);
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

  ABCM.define('apiEngine', { isEnabled, prepare, run, retireRow, getAccessToken, _memo: memo });
})(globalThis);
