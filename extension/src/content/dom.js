/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/* Site-aware access to the chat list on the current page. All selectors come from ABCM.sites. */
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const site = () => ABCM.sites.current();

  /** True when the element is attached, not hidden and actually rendered. */
  function isVisible(el, { fast = false } = {}) {
    if (!el || !el.isConnected) return false;
    if (el.hidden || el.getAttribute?.('aria-hidden') === 'true') return false;
    if (fast) return true;
    const style = g.getComputedStyle ? g.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
    return el.offsetParent !== null || (el.getClientRects?.().length || 0) > 0;
  }

  /**
   * The container that holds the chat rows. The first selector hit is not always the sidebar (a bare
   * <nav> can be a top bar with no rows), so prefer the first candidate that actually contains rows
   * and keep the first structural hit only as a fallback.
   */
  function getHistoryRoot() {
    const current = site();
    if (!current) return g.document.querySelector('nav') || g.document.body;
    let firstFound = null;
    for (const selector of current.history) {
      let el = null;
      try { el = g.document.querySelector(selector); } catch (_) { el = null; }
      if (!el) continue;
      if (!firstFound) firstFound = el;
      if (el.querySelector(current.conversation)) return el;
    }
    return firstFound || g.document.querySelector('nav') || g.document.body;
  }

  /** All chat rows (anchors) currently in the DOM, scoped to the sidebar when it can be found. */
  function getAllConversations() {
    const current = site();
    if (!current) return [];
    if (current.offPaths?.test(g.location.pathname)) return [];
    const scoped = getHistoryRoot()?.querySelectorAll(current.conversation);
    if (scoped && scoped.length) {
      const rows = Array.from(scoped);
      if (current.extraRows) {
        // One row per chat: a chat already in the sidebar keeps its sidebar row.
        const seen = new Set(rows.map((row) => idFromHref(row.getAttribute('href'))));
        g.document.querySelectorAll(current.extraRows).forEach((row) => {
          const id = idFromHref(row.getAttribute('href'));
          if (!id || seen.has(id)) return;
          seen.add(id);
          rows.push(row);
        });
      }
      return rows;
    }
    // Virtualised or portal-rendered sidebars can place rows outside every structural candidate.
    // The selector only applies on this site, so the worst case is an extra checkbox on a chat link.
    return Array.from(g.document.querySelectorAll(current.conversation));
  }

  function idFromHref(href) {
    const current = site();
    if (!current) return '';
    const match = String(href || '').match(current.idRe);
    return match ? match[1] : '';
  }

  function anchorOf(element) {
    const current = site();
    if (!element || !current) return null;
    return element.matches?.(current.anchorMatch) ? element : element.closest?.(current.anchorMatch) || null;
  }

  /**
   * Sites whose rows carry no link or id (Qwen, Z.ai): the chat is known by its title and, among chats with
   * the same title, by its place in the list. The row itself is what the page menu acts on, so no site id is needed.
   */
  function titleKey(anchor) {
    const title = titleOf(anchor);
    if (!title) return '';
    let nth = 0;
    for (const row of getAllConversations()) {
      if (row === anchor) return `t:${title}#${nth}`;
      if (titleOf(row) === title) nth += 1;
    }
    return '';
  }

  function idFromElement(element) {
    const anchor = anchorOf(element);
    if (site()?.idFromTitle) return anchor ? titleKey(anchor) : '';
    return idFromHref(anchor?.getAttribute?.('href') || anchor?.href || '');
  }

  /** The text of a node without screen-reader-only and tooltip parts (a status or environment label is not the title). */
  function visibleText(node) {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) out += child.nodeValue;
      else if (child.nodeType === 1 && !child.matches?.('.sr-only, [role="tooltip"]')) out += visibleText(child);
    }
    return out;
  }

  function titleOf(anchor) {
    if (!anchor) return '';
    const current = site();
    if (current?.title) {
      const node = anchor.querySelector(current.title);
      const text = (node?.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    const text = visibleText(anchor).replace(/\s+/g, ' ').trim();
    // A link that only covers its row has no text of its own; its label carries the title.
    return text || (anchor.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim();
  }

  /** The absolute address of a chat, so exports stay useful outside the page. */
  function urlOf(anchor) {
    if (site()?.idFromTitle) return site().url;
    const raw = anchor?.getAttribute?.('href') || anchor?.href || '';
    try { return new URL(raw, g.location.href).href; } catch (_) { return raw; }
  }

  /**
   * The smallest ancestor of a chat link that still contains no other chat link: the "row" that
   * owns this chat's hover controls (for example its "..." button, which on some sites is a
   * sibling of the link, not a child). The walk is short and never leaves the list, so a control
   * found inside the row can only belong to this chat.
   */
  function rowOf(anchor) {
    const current = site();
    if (!anchor) return null;
    let row = anchor;
    for (let i = 0; i < 4; i += 1) {
      const parent = row.parentElement;
      if (!parent || parent.matches('nav, aside, ul, ol, main, body, [role="list"], [role="navigation"]')) break;
      if (current && parent.querySelectorAll(current.conversation).length > 1) break;
      row = parent;
    }
    return row;
  }

  function dispatchHover(el) {
    try { el.dispatchEvent(new MouseEvent('mouseover', { view: g.window, bubbles: true, cancelable: true })); } catch (_) { /* detached */ }
  }

  ABCM.define('dom', { isVisible, getHistoryRoot, getAllConversations, idFromHref, idFromElement, anchorOf, titleOf, urlOf, rowOf, dispatchHover });
})(globalThis);
