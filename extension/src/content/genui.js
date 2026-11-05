/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  ChatGPT answers can carry its interface markup inside the text: citations (<Cite .../>), entity names, links,
  picture searches, small cards built from <box>, <row>, <grid>, <badge>, interactive code blocks, and template
  lines such as {@body ...} or {#each ...}. A file made from that text would be full of tags. This turns the
  markup that has a plain meaning into Markdown and drops the rest. Fenced code and `inline code` are never touched.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const NL = String.fromCharCode(10);
  const TAGS = new Set(['Cite', 'FileCite', 'MemoryCite', 'Entity', 'Link', 'AsyncImage', 'Chart', 'CodeBlock', 'box', 'row', 'col', 'grid', 'grid-item', 'list-item', 'badge', 'divider', 'icon', 'caption', 'title', 'text', 'radio', 'radio-group', 'checkbox', 'button']);
  const LINE_END = new Set(['box', 'row', 'col', 'grid', 'grid-item', 'list-item', 'caption', 'title', 'text', 'radio', 'radio-group', 'checkbox', 'button']);
  const TEMPLATE_LINE = /^[ \t]*\{[@#/:][^\n]*}[ \t]*$/;
  const NAME = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/;

  /** The tag that starts at text[at] ('<'), if it is one of the interface tags: { name, closing, selfClosing, attrs, end }. */
  function readTag(text, at) {
    const m = NAME.exec(text.slice(at, at + 40));
    if (!m || !TAGS.has(m[2])) return null;
    let i = at + m[0].length;
    let depth = 0;
    let quote = '';
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"') { quote = c; continue; }
      if (c === '{') { depth++; continue; }
      if (c === '}') { depth = Math.max(0, depth - 1); continue; }
      if (c === '>' && depth === 0) break;
      if (c === NL && depth === 0 && !quote && i - at > 4000) return null;
    }
    if (i >= text.length) return null;
    const raw = text.slice(at + m[0].length, i);
    const attrs = {};
    for (const a of raw.matchAll(/([A-Za-z][A-Za-z0-9-]*)=(?:"([^"]*)"|\{(.*)})/gs)) attrs[a[1]] = a[2] !== undefined ? a[2] : a[3];
    return { name: m[2], closing: m[1] === '/', selfClosing: raw.trimEnd().endsWith('/'), attrs, raw, end: i + 1 };
  }

  const fence = (code, language) => {
    const longest = Math.max(2, ...(String(code).match(/`+/g) || []).map((run) => run.length));
    const ticks = '`'.repeat(longest + 1);
    return `${NL}${ticks}${String(language || '').replace(/[^A-Za-z0-9_+#.-]/g, '')}${NL}${code}${NL}${ticks}${NL}`;
  };

  /** One stretch of text that holds no code: its interface tags become Markdown. */
  function convertPlain(text) {
    if (!/[<{]/.test(text)) return text;
    const body = text.split(NL).filter((line) => !TEMPLATE_LINE.test(line)).join(NL);
    let out = '';
    let first = -1;
    let last = -1;
    const mark = () => { const line = out.split(NL).length - 1; if (first < 0) first = line; last = line; };
    let i = 0;
    while (i < body.length) {
      const c = body[i];
      if (c === '`') {
        const run = /^`+/.exec(body.slice(i))[0];
        const stop = body.indexOf(run, i + run.length);
        const eol = body.indexOf(NL, i);
        if (stop > 0 && (eol < 0 || stop < eol)) { out += body.slice(i, stop + run.length); i = stop + run.length; continue; }
        out += run; i += run.length; continue;
      }
      if (c !== '<') { out += c; i++; continue; }
      const tag = readTag(body, i);
      if (!tag) { out += c; i++; continue; }
      mark();
      i = tag.end;
      const { name, attrs } = tag;
      if (tag.closing) {
        if (name === 'badge' || name === 'title') out += '**';
        if (LINE_END.has(name)) out += NL;
        continue;
      }
      if (name === 'Cite' || name === 'FileCite' || name === 'MemoryCite' || name === 'icon') continue;
      if (name === 'Entity') { out += attrs.value || ''; continue; }
      if (name === 'Link') {
        const url = attrs.url || '';
        out += /^https:\/\//.test(url) ? `[${attrs.title || url}](${url})` : (attrs.title || '');
        continue;
      }
      if (name === 'AsyncImage') { out += `*${attrs.query ? ABCM.i18n.t('export.image', { name: attrs.query }) : ABCM.i18n.t('export.imageUnnamed')}*`; continue; }
      if (name === 'Chart') {
        const title = /"title"\s*:\s*"([^"]*)"/.exec(tag.raw)?.[1] || '';
        out += `*${title ? ABCM.i18n.t('export.chart', { name: title }) : ABCM.i18n.t('export.chartUnnamed')}*`;
        continue;
      }
      if (name === 'CodeBlock') {
        const close = body.indexOf('</CodeBlock>', i);
        if (close < 0) continue;
        const code = body.slice(i, close).replace(/^\n/, '').replace(/\n$/, '');
        out += fence(code, attrs.language);
        i = close + '</CodeBlock>'.length;
        continue;
      }
      if (name === 'divider') { out += `${NL}---${NL}`; continue; }
      if (name === 'badge' || name === 'title') { out += '**'; continue; }
      if (name === 'list-item') { out += `${NL}- `; continue; }
      if (LINE_END.has(name)) out += tag.selfClosing ? NL : '';
    }
    // The cards are written with indentation and template placeholders; both would read as code or noise.
    const lines = out.split(NL);
    const templated = /{[@#]/.test(text);
    for (let n = Math.max(first, 0); first >= 0 && n <= last && n < lines.length; n++) {
      lines[n] = lines[n].replace(/^[ \t]+/, '');
      if (templated) lines[n] = lines[n].replace(/{[^{}\n]*}/g, '');
    }
    return lines.join(NL).replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, NL + NL);
  }

  /** Text in, Markdown out. Lines in fenced code stay as they are. */
  function toMarkdown(text) {
    const source = String(text ?? '');
    if (!/[<{]/.test(source)) return source;
    const out = [];
    let plain = [];
    let fenced = '';
    for (const line of source.split(NL)) {
      const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fenced) {
        out.push(line);
        if (m && m[1][0] === fenced[0] && m[1].length >= fenced.length && /^ {0,3}[`~]+ *$/.test(line)) fenced = '';
      } else if (m) {
        out.push(convertPlain(plain.join(NL)));
        plain = [];
        fenced = m[1];
        out.push(line);
      } else {
        plain.push(line);
      }
    }
    if (plain.length) out.push(convertPlain(plain.join(NL)));
    return out.join(NL);
  }

  ABCM.define('genui', { toMarkdown });
})(globalThis);
