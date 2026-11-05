/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Word export, the pure part: turns the Markdown the conversation writer produces into a .docx
  file (Office Open XML in a ZIP). Handles headings, paragraphs, lists, tables, quotes, code
  blocks, rules, bold, italic, inline code, links and TeX math (kept as text). Right-to-left text
  gets right-to-left paragraphs. No network, no page access; bytes in, bytes out.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  // Characters XML 1.0 does not allow.
  const BAD_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
  const esc = (s) => String(s).replace(BAD_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ── inline ───────────────────────────────────────────────────────────────────────────────
  const NBSP = String.fromCharCode(0xa0);

  function runXml(text, fmt) {
    if (!text) return '';
    const props = [];
    if (fmt.code) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
    if (fmt.math) props.push('<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>');
    if (fmt.bold) props.push('<w:b/><w:bCs/>');
    if (fmt.italic || fmt.math) props.push('<w:i/><w:iCs/>');
    if (fmt.gray) props.push('<w:color w:val="4B5563"/>');
    if (fmt.link) props.push('<w:color w:val="0563C1"/><w:u w:val="single"/>');
    if (fmt.rtl) props.push('<w:rtl/>');
    const pr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
    const parts = String(text).split(/(\n|\t)/);
    const body = parts.map((p) => (p === '\n' ? '<w:br/>' : p === '\t' ? '<w:tab/>' : p ? `<w:t xml:space="preserve">${esc(p)}</w:t>` : '')).join('');
    return `<w:r>${pr}${body}</w:r>`;
  }

  // A picture is an inline drawing; its size is the picture's own, scaled down to the text width.
  const EMU_PER_PIXEL = 9525;
  const MAX_PICTURE_WIDTH = 5500000;
  const MEDIA_TYPE = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif' };

  function pictureRun(node, ctx) {
    const data = ctx.images?.[node.n - 1];
    if (!data?.bytes?.length) return runXml(node.alt, {});
    const ext = data.mime === 'image/jpeg' ? 'jpg' : data.mime === 'image/gif' ? 'gif' : 'png';
    ctx.media.push({ data, ext });
    const id = ctx.media.length;
    let cx = Math.max(1, Math.round(Number(data.width) || 600)) * EMU_PER_PIXEL;
    let cy = Math.max(1, Math.round(Number(data.height) || 400)) * EMU_PER_PIXEL;
    if (cx > MAX_PICTURE_WIDTH) { cy = Math.round(cy * MAX_PICTURE_WIDTH / cx); cx = MAX_PICTURE_WIDTH; }
    const name = esc(node.alt || `Picture ${id}`);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}" descr="${name}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}.${ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdI${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  /** Runs for inline nodes. ctx.links collects the hyperlink targets, ctx.media the pictures. */
  function runs(nodes, fmt, ctx) {
    return nodes.map((n) => {
      if (n.t === 'text') return runXml(n.v, fmt);
      if (n.t === 'code') return runXml(n.v, { ...fmt, code: true });
      if (n.t === 'math') return runXml(n.v, { ...fmt, math: true });
      if (n.t === 'image') return pictureRun(n, ctx);
      if (n.t === 'bold') return runs(n.c, { ...fmt, bold: true }, ctx);
      if (n.t === 'italic') return runs(n.c, { ...fmt, italic: true }, ctx);
      if (n.t === 'link') {
        ctx.links.push(n.href);
        return `<w:hyperlink r:id="rIdL${ctx.links.length}" w:history="1">${runs(n.c, { ...fmt, link: true }, ctx)}</w:hyperlink>`;
      }
      return '';
    }).join('');
  }

  // ── blocks ───────────────────────────────────────────────────────────────────────────────
  function paragraph(text, ctx, { style = '', indent = 0, hanging = 0, quote = false, bold = false, keepNext = false } = {}) {
    const rtl = ABCM.markdown.isRtl(text);
    const props = [];
    if (style) props.push(`<w:pStyle w:val="${style}"/>`);
    if (keepNext) props.push('<w:keepNext/>');
    if (quote) props.push(`<w:pBdr><w:${rtl ? 'right' : 'left'} w:val="single" w:sz="18" w:space="8" w:color="B0B7C3"/></w:pBdr>`);
    if (rtl) props.push('<w:bidi/>');
    const left = indent + (quote ? 360 : 0);
    if (left || hanging) props.push(`<w:ind w:${rtl ? 'right' : 'left'}="${left}"${hanging ? ` w:hanging="${hanging}"` : ''}/>`);
    return `<w:p>${props.length ? `<w:pPr>${props.join('')}</w:pPr>` : ''}${runs(ABCM.markdown.inline(text), { bold, rtl, gray: quote }, ctx)}</w:p>`;
  }

  function codeBlock(lines) {
    return lines.map((line, i) => {
      const p = `<w:pPr><w:pStyle w:val="Code"/>${i < lines.length - 1 ? '<w:contextualSpacing/>' : ''}</w:pPr>`;
      return `<w:p>${p}${runXml(line.replace(/ /g, NBSP), { code: true })}</w:p>`;
    }).join('') || '<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr></w:p>';
  }

  function tableXml(rows, ctx) {
    const cols = Math.max(...rows.map((r) => r.length));
    const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="B0B7C3"/>`).join('');
    const grid = '<w:tblGrid>' + Array.from({ length: cols }, () => '<w:gridCol w:w="2000"/>').join('') + '</w:tblGrid>';
    const trs = rows.map((cells, r) => {
      const tcs = Array.from({ length: cols }, (_v, c) => {
        const shade = r === 0 ? '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/></w:tcPr>' : '';
        return `<w:tc>${shade}${paragraph(cells[c] || '', ctx, { bold: r === 0 })}</w:tc>`;
      });
      return `<w:tr>${r === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${tcs.join('')}</w:tr>`;
    });
    return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="autofit"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>${grid}${trs.join('')}</w:tbl><w:p/>`;
  }

  function blocks(list, ctx, quote = false) {
    return list.map((b) => {
      if (b.t === 'code') return codeBlock(b.lines);
      if (b.t === 'hr') return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="B0B7C3"/></w:pBdr></w:pPr></w:p>';
      if (b.t === 'heading') return paragraph(b.text, ctx, { style: `Heading${b.level}`, keepNext: true, quote });
      if (b.t === 'quote') return blocks(b.blocks, ctx, true).join('');
      if (b.t === 'table') return tableXml(b.rows, ctx);
      if (b.t === 'list') return b.items.map((it) => paragraph(`${it.marker}\t${it.text}`, ctx, { indent: 540 + it.level * 360, hanging: 360, quote })).join('');
      return paragraph(b.text, ctx, { quote });
    });
  }

  // ── package ──────────────────────────────────────────────────────────────────────────────
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const DOCUMENT_NS = `${NS} xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  const heading = (n, size, before) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;

  const STYLES = `${XML}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="fa-IR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + heading(1, 36, 240) + heading(2, 30, 240) + heading(3, 26, 200) + heading(4, 24, 160) + heading(5, 22, 160) + heading(6, 22, 160)
    + '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="120" w:right="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>'
    + '</w:styles>';

  /**
   * Builds the .docx bytes from Markdown text. meta: { title, created: Date }.
   * Returns a Uint8Array.
   */
  function fromMarkdown(markdown, { title = '', created = new Date(), images = [] } = {}) {
    const ctx = { links: [], images, media: [] };
    const body = blocks(ABCM.markdown.parse(markdown), ctx).join('');
    const document = `${XML}<w:document ${DOCUMENT_NS}><w:body>${body || '<w:p/>'}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const mediaRels = ctx.media.map((m, i) => `<Relationship Id="rIdI${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.${m.ext}"/>`).join('');
    const mediaTypes = [...new Set(ctx.media.map((m) => m.ext))].map((ext) => `<Default Extension="${ext}" ContentType="${MEDIA_TYPE[ext]}"/>`).join('');
    const rels = mediaRels + ctx.links.map((url, n) => `<Relationship Id="rIdL${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(url)}" TargetMode="External"/>`).join('');
    const iso = created.toISOString().replace(/\.\d+Z$/, 'Z');
    return ABCM.zip.create([
      { name: '[Content_Types].xml', data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${mediaTypes}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
      { name: '_rels/.rels', data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
      { name: 'word/document.xml', data: document },
      { name: 'word/styles.xml', data: STYLES },
      { name: 'word/_rels/document.xml.rels', data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels}</Relationships>` },
      ...ctx.media.map((m, i) => ({ name: `word/media/image${i + 1}.${m.ext}`, data: m.data.bytes })),
      { name: 'docProps/core.xml', data: `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created></cp:coreProperties>` }
    ], created);
  }

  ABCM.define('docx', { fromMarkdown });
})(globalThis);
