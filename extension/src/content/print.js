/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  PDF export through the browser's own print flow. The conversation is drawn into a hidden frame that
  belongs to this extension, and window.print() of that frame opens the print dialog where the user picks
  "Save as PDF". A separate frame keeps the site's styles (dark themes, print rules, other extensions)
  out of the page that is printed. The browser's font engine does the layout, so right-to-left and
  non-Latin text come out right. The frame is removed when printing ends.
  The text is built with DOM calls only (no innerHTML) from the same Markdown the .md export makes.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const HOST_ATTR = 'data-abcm-print';

  const VIEW_CSS = `
    :host{display:block;color:#111;background:#fff;font:11pt/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,"Noto Sans","Noto Naskh Arabic",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    *{box-sizing:border-box}
    h1,h2,h3,h4,h5,h6{margin:1.2em 0 .4em;line-height:1.25;break-after:avoid}
    h1{font-size:20pt;margin-top:0}h2{font-size:15pt}h3{font-size:13pt}h4,h5,h6{font-size:11.5pt}
    p{margin:0 0 .7em;white-space:pre-wrap;overflow-wrap:anywhere}
    ul,ol{margin:0 0 .7em;padding-inline-start:1.6em}
    li{margin:.15em 0;overflow-wrap:anywhere}
    pre{margin:0 0 .8em;padding:.6em .8em;background:#f3f4f6;border-radius:4px;font:9.5pt/1.4 ui-monospace,Consolas,"Courier New",monospace;white-space:pre-wrap;overflow-wrap:anywhere;direction:ltr;text-align:left;break-inside:avoid-page}
    code{font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:.92em;background:#f3f4f6;padding:0 .2em;border-radius:3px}
    pre code{background:none;padding:0;font-size:inherit}
    blockquote{margin:0 0 .8em;padding:.1em .9em;border-inline-start:3px solid #b0b7c3;color:#4b5563}
    table{border-collapse:collapse;width:100%;margin:0 0 .8em;break-inside:auto}
    tr{break-inside:avoid}
    th,td{border:1px solid #b0b7c3;padding:.3em .5em;vertical-align:top;overflow-wrap:anywhere}
    th{background:#f3f4f6}
    hr{border:0;border-top:1px solid #b0b7c3;margin:1em 0}
    a{color:#0563c1}
    img{max-width:100%;height:auto;break-inside:avoid;display:block;margin:.4em 0}
    .math{font-family:"Cambria Math","STIX Two Math",serif;font-style:italic}
    .item{margin-bottom:.9em}
  `;

  let dom = g.document; // the document the nodes are made in: the page for render(), the print frame for show()

  function el(tag, attrs, ...children) {
    const node = dom.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    for (const c of children) node.append(c);
    return node;
  }

  const direction = (text) => (ABCM.markdown.isRtl(text) ? 'rtl' : 'ltr');

  let pictures = []; // the pictures the Markdown being drawn points at, by number

  function inlineNodes(nodes) {
    return nodes.map((n) => {
      if (n.t === 'text') return dom.createTextNode(n.v);
      if (n.t === 'image') {
        const picture = pictures[n.n - 1];
        return picture?.bytes?.length ? el('img', { src: ABCM.markdown.dataUrl(picture), alt: n.alt || '' }) : dom.createTextNode(n.alt || '');
      }
      if (n.t === 'code') return el('code', {}, n.v);
      if (n.t === 'math') return el('span', { class: 'math' }, n.v);
      if (n.t === 'bold') return el('strong', {}, ...inlineNodes(n.c));
      if (n.t === 'italic') return el('em', {}, ...inlineNodes(n.c));
      if (n.t === 'link') return el('a', { href: n.href }, ...inlineNodes(n.c));
      return '';
    });
  }

  const text = (value) => inlineNodes(ABCM.markdown.inline(value));

  function listNodes(items) {
    const make = (item) => el(/^\d/.test(item.marker) ? 'ol' : 'ul');
    const root = make(items[0]);
    const stack = [{ level: items[0].level, list: root }];
    for (const it of items) {
      while (stack.length > 1 && it.level < stack[stack.length - 1].level) stack.pop();
      let top = stack[stack.length - 1];
      if (it.level > top.level) {
        const parent = top.list.lastElementChild || top.list.appendChild(el('li'));
        const inner = make(it);
        parent.append(inner);
        top = { level: it.level, list: inner };
        stack.push(top);
      }
      const li = el('li', { dir: direction(it.text) }, ...text(it.text));
      if (/^\d/.test(it.marker)) li.setAttribute('value', String(parseInt(it.marker, 10)));
      top.list.append(li);
    }
    return root;
  }

  function blockNodes(list) {
    return list.map((b) => {
      if (b.t === 'heading') return el(`h${b.level}`, { dir: direction(b.text) }, ...text(b.text));
      if (b.t === 'para') return el('p', { dir: direction(b.text) }, ...text(b.text));
      if (b.t === 'code') return el('pre', {}, el('code', {}, b.lines.join('\n')));
      if (b.t === 'hr') return el('hr');
      if (b.t === 'quote') return el('blockquote', {}, ...blockNodes(b.blocks));
      if (b.t === 'list') return listNodes(b.items);
      if (b.t === 'table') {
        const cols = Math.max(...b.rows.map((r) => r.length));
        const row = (cells, tag) => el('tr', {}, ...Array.from({ length: cols }, (_v, c) => el(tag, { dir: direction(cells[c] || '') }, ...text(cells[c] || ''))));
        return el('table', {}, el('thead', {}, row(b.rows[0], 'th')), el('tbody', {}, ...b.rows.slice(1).map((r) => row(r, 'td'))));
      }
      return '';
    });
  }

  let active = null;

  function cleanup() {
    if (!active) return;
    const { frame, title } = active;
    active = null;
    frame.contentWindow?.removeEventListener('afterprint', cleanup);
    g.removeEventListener('afterprint', cleanup);
    frame.remove();
    g.document.title = title;
  }

  /** Builds the print view of the Markdown text without showing anything yet. Returns the host element. */
  function render(markdown, images = []) {
    pictures = images;
    const host = el('div', { [HOST_ATTR]: '' });
    const root = host.attachShadow({ mode: 'open' });
    try {
      const sheet = new g.CSSStyleSheet();
      sheet.replaceSync(VIEW_CSS);
      root.adoptedStyleSheets = [sheet];
    } catch (_) { /* constructable stylesheets unavailable: use a <style> element */
      const style = el('style');
      style.textContent = VIEW_CSS;
      root.append(style);
    }
    root.append(el('main', {}, ...blockNodes(ABCM.markdown.parse(markdown))));
    return host;
  }

  /**
   * Opens the print dialog for the conversation. title becomes the suggested file name while printing.
   * Returns the frame (kept until printing ends).
   */
  function show(conversation, options = {}, { title = '' } = {}) {
    cleanup();
    const { markdown, images } = ABCM.conversation.forRender(conversation, options);
    const frame = g.document.createElement('iframe');
    frame.setAttribute(HOST_ATTR, '');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    for (const [k, v] of [['position', 'fixed'], ['right', '0'], ['bottom', '0'], ['width', '1px'], ['height', '1px'], ['border', '0'], ['opacity', '0'], ['pointer-events', 'none']]) frame.style.setProperty(k, v, 'important');
    active = { frame, title: g.document.title };
    if (title) g.document.title = title;
    g.addEventListener('afterprint', cleanup);
    let started = false;
    // Some browsers replace the new frame's first empty document when it finishes loading, so the text is
    // written after the load event (Chromium fires it while the frame is added, Firefox a little later).
    const start = () => {
      if (started || active?.frame !== frame) return;
      started = true;
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      const css = `${VIEW_CSS.replace(':host', 'body')}html,body{margin:0;background:#fff}`;
      try {
        const sheet = new win.CSSStyleSheet();
        sheet.replaceSync(css);
        doc.adoptedStyleSheets = [sheet];
      } catch (_) { /* constructable stylesheets unavailable: use a <style> element */
        const style = doc.createElement('style');
        style.textContent = css;
        doc.head.appendChild(style);
      }
      dom = doc;
      try {
        pictures = images;
        doc.body.append(el('main', {}, ...blockNodes(ABCM.markdown.parse(markdown))));
      } finally {
        dom = g.document;
      }
      if (title) doc.title = title;
      win.addEventListener('afterprint', cleanup);
      g.setTimeout(() => { win.focus(); win.print(); }, 100); // lets the hint toast paint before the dialog takes over
    };
    frame.addEventListener('load', start);
    g.document.body.appendChild(frame);
    g.setTimeout(start, 300);
    return frame;
  }

  ABCM.define('print', { render, show, cleanup, css: VIEW_CSS });
})(globalThis);
