/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Exports the list of selected chats (title, address, id). Only what the sidebar shows is exported;
  conversation text is never read. Pure functions, so they can be tested without a page.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const FORMATS = {
    json: { extension: 'json', mime: 'application/json' },
    csv: { extension: 'csv', mime: 'text/csv' },
    md: { extension: 'md', mime: 'text/markdown' }
  };

  /** Titles come from the page and can be attacker-controlled: stop spreadsheets from reading them as formulas. */
  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function mdEscape(text) {
    return String(text ?? '').replace(/([\\`*_{}[\]()#+\-.!|<>])/g, '\\$1').replace(/\s+/g, ' ').trim();
  }

  function build(format, items, { siteName = '', exportedAt = new Date() } = {}) {
    const rows = items.map((item) => ({ title: item.title || '', url: item.url || '', id: item.id || '' }));
    if (format === 'json') {
      return JSON.stringify({ exportedAt: exportedAt.toISOString(), site: siteName, count: rows.length, chats: rows }, null, 2);
    }
    if (format === 'csv') {
      // A byte order mark lets Excel open the file as UTF-8 so non-Latin titles are not garbled.
      return `﻿${['title,url,id', ...rows.map((row) => [row.title, row.url, row.id].map(csvCell).join(','))].join('\r\n')}\r\n`;
    }
    if (format === 'md') {
      const heading = `# ${siteName ? `${mdEscape(siteName)} chats` : 'Chats'} (${rows.length})`;
      // The address goes inside (...): keep it https and encode what could end the link early.
      const safeUrl = (url) => (/^https:\/\//i.test(url) ? url.replace(/[()<>\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`) : '');
      return `${[heading, '', ...rows.map((row) => `- [${mdEscape(row.title) || row.id}](${safeUrl(row.url)})`)].join('\n')}\n`;
    }
    throw new Error(`Unknown export format: ${format}`);
  }

  function filename(format, siteId, now = new Date()) {
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `ai-chats-${siteId || 'export'}-${stamp}.${FORMATS[format].extension}`;
  }

  /** Builds the file and hands it to the browser as a download. Returns the file name. */
  function download(format, items, siteName, siteId) {
    const text = build(format, items, { siteName });
    const name = filename(format, siteId);
    const blob = new g.Blob([text], { type: `${FORMATS[format].mime};charset=utf-8` });
    const url = g.URL.createObjectURL(blob);
    const link = g.document.createElement('a');
    link.href = url;
    link.download = name;
    link.style.display = 'none';
    g.document.body.appendChild(link);
    link.click();
    link.remove();
    g.setTimeout(() => g.URL.revokeObjectURL(url), 2000);
    return name;
  }

  ABCM.define('exporter', { FORMATS, build, filename, download, csvCell });
})(globalThis);
