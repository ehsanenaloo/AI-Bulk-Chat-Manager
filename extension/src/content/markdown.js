/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  A small Markdown reader for the subset the conversation writer produces: headings, paragraphs,
  lists, tables, quotes, fenced code, rules, and the inline marks bold, italic, code, links and TeX
  math. It returns plain data (no DOM, no HTML), which the Word and PDF writers draw their own way.
    block:  { t: 'heading', level, text } | { t: 'para', text } | { t: 'code', lines } | { t: 'hr' }
          | { t: 'quote', blocks } | { t: 'list', items: [{ level, marker, text }] } | { t: 'table', rows: [[text]] }
    inline: { t: 'text', v } | { t: 'code', v } | { t: 'math', v } | { t: 'bold', c } | { t: 'italic', c } | { t: 'link', c, href }
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  // Math is \(...\), $$...$$ or $...$. A single $ opens math only before a non-space and closes it after a non-space
  // that is not followed by a digit, so "costs $5 and $10" stays text.
  const INLINE = /!\[([^\]\n]{0,200})\]\(abcm-image:(\d+)\)|\\\(([^\n]{1,500}?)\\\)|\$\$([^$]{1,2000}?)\$\$|\\([\\`*_{}\[\]()#+\-.!|$>~<])|(`+)([^`][\s\S]*?[^`]|[^`])\6(?!`)|\*\*([\s\S]+?)\*\*|\*([^*\s][\s\S]*?)\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\$(?=\S)([^$\n]*?\S)\$(?!\d)/g;

  /** Inline marks of one piece of text. */
  function inline(text) {
    const out = [];
    let last = 0;
    const re = new RegExp(INLINE.source, 'g'); // its own position: the nested calls below must not move this one
    let m;
    const plain = (v) => { if (v) out.push({ t: 'text', v }); };
    while ((m = re.exec(text))) {
      plain(text.slice(last, m.index));
      last = re.lastIndex;
      if (m[2] !== undefined) out.push({ t: 'image', alt: m[1], n: Number(m[2]) });
      else if (m[3] !== undefined) out.push({ t: 'math', v: m[3].trim() });
      else if (m[4] !== undefined) out.push({ t: 'math', v: m[4].trim() });
      else if (m[5] !== undefined) plain(m[5]);
      else if (m[7] !== undefined) out.push({ t: 'code', v: m[7].trim() || m[7] });
      else if (m[8] !== undefined) out.push({ t: 'bold', c: inline(m[8]) });
      else if (m[9] !== undefined) out.push({ t: 'italic', c: inline(m[9]) });
      else if (m[10] !== undefined) out.push({ t: 'link', href: m[11], c: inline(m[10]) });
      else if (m[12] !== undefined) out.push({ t: 'math', v: m[12] });
    }
    plain(text.slice(last));
    return out;
  }

  const FENCE = /^(`{3,})\s*([^`\s]*)\s*$/;
  const HEADING = /^(#{1,6})\s+(.*)$/;
  const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const startsBlock = (line, next) => FENCE.test(line) || HEADING.test(line) || LIST.test(line) || /^\s*>/.test(line) || /^---+\s*$/.test(line) || (line.includes('|') && next !== undefined && TABLE_SEP.test(next));
  const BULLET = String.fromCharCode(0x2022);

  function splitRow(line) {
    const cells = [];
    let cur = '';
    const s = line.trim().replace(/^\|/, '');
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; }
      else if (s[i] === '|') { cells.push(cur.trim()); cur = ''; }
      else cur += s[i];
    }
    if (cur.trim() || !/\|\s*$/.test(line)) cells.push(cur.trim());
    return cells;
  }

  function parseLines(lines) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m = FENCE.exec(line);
      if (m) {
        const body = [];
        i++;
        while (i < lines.length && !(lines[i].startsWith(m[1]) && /^`+\s*$/.test(lines[i]))) body.push(lines[i++]);
        i++;
        out.push({ t: 'code', lines: body, language: m[2] });
        continue;
      }
      if (/^---+\s*$/.test(line)) { out.push({ t: 'hr' }); i++; continue; }
      m = HEADING.exec(line);
      if (m) { out.push({ t: 'heading', level: m[1].length, text: m[2].trim() }); i++; continue; }
      if (/^\s*>/.test(line)) {
        const inner = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) inner.push(lines[i++].replace(/^\s*> ?/, ''));
        out.push({ t: 'quote', blocks: parseLines(inner) });
        continue;
      }
      if (line.includes('|') && TABLE_SEP.test(lines[i + 1] ?? '')) {
        const rows = [splitRow(line)];
        i += 2;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
        out.push({ t: 'table', rows });
        continue;
      }
      m = LIST.exec(line);
      if (m) {
        const items = [];
        const stack = [];
        while (i < lines.length && (m = LIST.exec(lines[i]))) {
          const width = m[1].replace(/\t/g, '    ').length;
          while (stack.length && width < stack[stack.length - 1]) stack.pop();
          if (!stack.length || width > stack[stack.length - 1]) stack.push(width);
          items.push({ level: stack.length - 1, marker: /^\d/.test(m[2]) ? m[2] : BULLET, text: m[3] });
          i++;
        }
        out.push({ t: 'list', items });
        continue;
      }
      const para = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) para.push(lines[i++]);
      out.push({ t: 'para', text: para.join('\n') });
    }
    return out;
  }

  const parse = (markdown) => parseLines(String(markdown).replace(/\r\n?/g, '\n').split('\n'));

  // Right-to-left detection: the first strongly directional letter decides.
  const RTL_CHAR = new RegExp('[' + [[0x590, 0x8ff], [0xfb1d, 0xfdff], [0xfe70, 0xfefc]].map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']');
  const LTR_CHAR = new RegExp('[A-Za-z' + [[0xc0, 0x24f], [0x370, 0x3ff], [0x400, 0x4ff], [0x3040, 0x9fff]].map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']');
  function isRtl(text) {
    for (const ch of String(text)) { if (RTL_CHAR.test(ch)) return true; if (LTR_CHAR.test(ch)) return false; }
    return false;
  }

  /** A data: address for a picture { mime, bytes }, for the writers that show it in a page. */
  function dataUrl(picture) {
    let binary = '';
    const bytes = picture.bytes;
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return `data:${picture.mime || 'image/png'};base64,${g.btoa(binary)}`;
  }

  ABCM.define('markdown', { parse, inline, isRtl, dataUrl });
})(globalThis);
