/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Conversation export, the pure part: turns what a site's own read request returns into one
  neutral shape and writes it as Markdown, plain text, JSON, Word or PDF (through the print dialog). Nothing here touches the page or
  the network, so it can be tested without either. The text is held in memory only for the time it
  takes to build one file; it is never stored or logged.

  Shape:
    conversation: { site, siteName, id, title, url, model, createdAt, messages: [message] }
    message:      { role: 'user' | 'assistant', time, model, parts: [part] }
    part:         { kind: 'markdown' | 'thinking' | 'code' | 'tool' | 'file', text, language, name }
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const FORMATS = {
    md: { extension: 'md', mime: 'text/markdown' },
    txt: { extension: 'txt', mime: 'text/plain' },
    json: { extension: 'json', mime: 'application/json' },
    docx: { extension: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', binary: true },
    pdf: { extension: 'pdf', mime: 'application/pdf', print: true },
    png: { extension: 'png', mime: 'image/png', image: true }
  };

  const isoFromSeconds = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : '';
  };
  const isoFromText = (value) => {
    const at = Date.parse(value);
    return Number.isFinite(at) ? new Date(at).toISOString() : '';
  };

  /**
   * ChatGPT wraps citations and widgets in private-use characters: U+E200 name U+E202 payload U+E201.
   * An entity keeps its display name, everything else is dropped, and stray private-use characters go too.
   */
  function cleanChatgptText(text) {
    const cleaned = String(text ?? '')
      .replace(/([a-z_]+)([^]*)/g, (_all, name, payload) => {
        if (name !== 'entity') return '';
        try {
          const list = JSON.parse(payload);
          return Array.isArray(list) && typeof list[1] === 'string' ? list[1] : '';
        } catch (_) {
          return '';
        }
      })
      .replace(/[-]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
    return ABCM.genui.toMarkdown(cleaned);
  }

  const isImageName = (name) => /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)$/i.test(String(name || ''));

  /**
   * DeepSeek: GET /api/v0/chat/history_messages. A message has a role (USER or ASSISTANT), a parent_id and fragments:
   * REQUEST (the question), RESPONSE (the answer), THINK (the thinking), TEMPLATE_RESPONSE (a canned answer),
   * TIP (a notice, skipped) and FILE (attachments). The chat is the path from the last message back through parent_id.
   */
  function fromDeepseek(data, { id = '', url = '', title = '' } = {}) {
    const all = Array.isArray(data?.chat_messages) ? data.chat_messages : [];
    const byId = new Map(all.map((m) => [m.message_id, m]));
    let ordered = all;
    const last = all[all.length - 1];
    if (last) {
      const chain = [];
      const seen = new Set();
      for (let m = last; m && !seen.has(m.message_id); m = byId.get(m.parent_id)) { seen.add(m.message_id); chain.push(m); }
      if (chain.length > 1) ordered = chain.reverse();
    }
    const messages = [];
    for (const m of ordered) {
      const parts = [];
      for (const f of Array.isArray(m.fragments) ? m.fragments : []) {
        const text = typeof f?.content === 'string' ? f.content.trim() : '';
        if (f?.type === 'THINK' && text) parts.push({ kind: 'thinking', text });
        else if ((f?.type === 'REQUEST' || f?.type === 'RESPONSE' || f?.type === 'TEMPLATE_RESPONSE') && text) parts.push({ kind: 'markdown', text });
        else if (f?.type === 'FILE') {
          for (const file of Array.isArray(f.files) ? f.files : []) {
            const name = file?.file_name || file?.name;
            if (name) parts.push({ kind: isImageName(name) ? 'image' : 'file', name: String(name) });
          }
        }
      }
      pushMessage(messages, { role: m.role === 'USER' ? 'user' : 'assistant', time: isoFromSeconds(m.inserted_at), model: String(m.model || ''), parts });
    }
    const site = ABCM.sites.byId('deepseek');
    const session = data?.chat_session || {};
    return {
      site: 'deepseek',
      siteName: site?.name || 'DeepSeek',
      id,
      title: String(session.title || title || '').replace(/\s*[-–]\s*DeepSeek.*$/i, '').trim(),
      url,
      model: String(session.model_type || messages.map((m) => m.model).filter(Boolean).pop() || ''),
      createdAt: messages[0]?.time || '',
      messages
    };
  }

  /**
   * Perplexity: GET /rest/thread/<slug>. A thread has entries (one question and its answer each). The answer is the
   * markdown_block of the block used as ask_text.
   */
  function fromPerplexity(data, { id = '', url = '', title = '' } = {}) {
    const entries = (Array.isArray(data?.entries) ? data.entries : []).slice().sort((a, b) => String(a.entry_created_datetime || '').localeCompare(String(b.entry_created_datetime || '')));
    const messages = [];
    let model = '';
    for (const entry of entries) {
      const time = isoFromText(entry.entry_created_datetime);
      const question = typeof entry.query_str === 'string' ? entry.query_str.trim() : '';
      if (question) pushMessage(messages, { role: 'user', time, model: '', parts: [{ kind: 'markdown', text: question }] });
      const block = (Array.isArray(entry.blocks) ? entry.blocks : []).find((b) => b?.intended_usage === 'ask_text' && b.markdown_block) || (Array.isArray(entry.blocks) ? entry.blocks : []).find((b) => b?.markdown_block);
      const mb = block?.markdown_block;
      const answer = typeof mb?.answer === 'string' && mb.answer.trim() ? mb.answer.trim() : (Array.isArray(mb?.chunks) ? mb.chunks.join('') .trim() : '');
      const name = String(entry.display_model || '');
      if (answer) { pushMessage(messages, { role: 'assistant', time, model: name, parts: [{ kind: 'markdown', text: answer }] }); if (name) model = name; }
    }
    const site = ABCM.sites.byId('perplexity');
    return {
      site: 'perplexity',
      siteName: site?.name || 'Perplexity',
      id,
      title: String(entries[0]?.thread_title || title || '').replace(/\s*[-–]\s*Perplexity.*$/i, '').trim(),
      url,
      model,
      createdAt: messages[0]?.time || '',
      incomplete: Boolean(data?.has_next_page),
      messages
    };
  }

  /** Adds a part, and joins a message to the previous one when the same side keeps talking. */
  function pushMessage(list, message) {
    if (!message.parts.length) return;
    const last = list[list.length - 1];
    if (last && last.role === message.role && message.role === 'assistant') {
      last.parts.push(...message.parts);
      last.model = message.model || last.model;
      return;
    }
    list.push(message);
  }

  /** ChatGPT: /backend-api/conversation/<id>. A tree of nodes; the chat is the path from current_node up to the root. */
  function fromChatgpt(data, { id = '', url = '' } = {}) {
    const mapping = data && typeof data.mapping === 'object' && data.mapping ? data.mapping : {};
    const path = [];
    const seen = new Set();
    for (let key = data?.current_node; key && mapping[key] && !seen.has(key); key = mapping[key].parent) {
      seen.add(key);
      path.push(mapping[key]);
    }
    path.reverse();

    const messages = [];
    for (const node of path) {
      const m = node.message;
      if (!m || (m.author?.role !== 'user' && m.author?.role !== 'assistant')) continue;
      if (m.recipient && m.recipient !== 'all') continue; // a call to a tool, not text for the reader
      if (m.metadata?.is_visually_hidden_from_conversation || m.metadata?.is_thinking_preamble_message) continue;
      const content = m.content || {};
      const parts = [];
      if (content.content_type === 'text' || content.content_type === 'multimodal_text') {
        const strings = [];
        for (const part of content.parts || []) {
          if (typeof part === 'string') strings.push(part);
          else if (part && typeof part === 'object') {
            if (strings.length) { parts.push({ kind: 'markdown', text: cleanChatgptText(strings.join('\n\n')) }); strings.length = 0; }
            if (/image/i.test(String(part.content_type || ''))) parts.push({ kind: 'image', name: '' });
            else parts.push({ kind: 'file', name: String(part.content_type || 'attachment') });
          }
        }
        if (strings.length) parts.push({ kind: 'markdown', text: cleanChatgptText(strings.join('\n\n')) });
      } else if (content.content_type === 'thoughts') {
        const text = (content.thoughts || []).map((t) => [t?.summary ? `**${t.summary}**` : '', t?.content || ''].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
        if (text) parts.push({ kind: 'thinking', text: cleanChatgptText(text) });
      } else if (content.content_type === 'code' && typeof content.text === 'string') {
        parts.push({ kind: 'code', language: String(content.language || ''), text: content.text });
      }
      pushMessage(messages, {
        role: m.author.role,
        time: isoFromSeconds(m.create_time),
        model: String(m.metadata?.model_slug || ''),
        parts: parts.filter((p) => p.kind === 'file' || p.kind === 'image' || p.text)
      });
    }
    const site = ABCM.sites.byId('chatgpt');
    return {
      site: 'chatgpt',
      siteName: site?.name || 'ChatGPT',
      id: String(data?.conversation_id || id),
      title: String(data?.title || ''),
      url,
      model: String(data?.default_model_slug || messages.map((m) => m.model).filter(Boolean).pop() || ''),
      createdAt: isoFromSeconds(data?.create_time),
      messages
    };
  }

  /** Claude: /api/organizations/<org>/chat_conversations/<id>?tree=True. Messages point at their parent; the chat is the path from the current leaf. */
  function fromClaude(data, { id = '', url = '' } = {}) {
    const all = Array.isArray(data?.chat_messages) ? data.chat_messages : [];
    const byId = new Map(all.map((m) => [m.uuid, m]));
    let ordered = all;
    if (data?.current_leaf_message_uuid && byId.has(data.current_leaf_message_uuid)) {
      ordered = [];
      const seen = new Set();
      for (let m = byId.get(data.current_leaf_message_uuid); m && !seen.has(m.uuid); m = byId.get(m.parent_message_uuid)) {
        seen.add(m.uuid);
        ordered.push(m);
      }
      ordered.reverse();
    }

    const messages = [];
    for (const m of ordered) {
      const role = m.sender === 'human' ? 'user' : 'assistant';
      const parts = [];
      const blocks = Array.isArray(m.content) && m.content.length ? m.content : (m.text ? [{ type: 'text', text: m.text }] : []);
      for (const block of blocks) {
        if (block.type === 'text' && block.text) parts.push({ kind: 'markdown', text: String(block.text).trim() });
        else if (block.type === 'thinking' && block.thinking) parts.push({ kind: 'thinking', text: String(block.thinking).trim() });
        else if (block.type === 'tool_use' && block.name) parts.push({ kind: 'tool', name: String(block.name) });
      }
      for (const file of [...(m.attachments || []), ...(m.files || [])]) {
        const name = file?.file_name || file?.name;
        if (!name) continue;
        const image = file?.file_kind === 'image' || /^image\//i.test(String(file?.file_type || file?.mime_type || '')) || isImageName(name);
        parts.push({ kind: image ? 'image' : 'file', name: String(name) });
      }
      pushMessage(messages, { role, time: isoFromText(m.created_at), model: '', parts: parts.filter((p) => p.kind === 'file' || p.kind === 'image' || p.kind === 'tool' || p.text) });
    }
    const site = ABCM.sites.byId('claude');
    return {
      site: 'claude',
      siteName: site?.name || 'Claude',
      id: String(data?.uuid || id),
      title: String(data?.name || ''),
      url,
      model: String(data?.model || ''),
      createdAt: isoFromText(data?.created_at),
      messages
    };
  }

  /** Grok: GET .../response-node lists the nodes, POST .../load-responses returns their text. The chat is the main thread, walked back from its last node. */
  function fromGrok(nodeData, responses, { id = '', url = '', title = '' } = {}) {
    const nodes = Array.isArray(nodeData?.responseNodes) ? nodeData.responseNodes.filter((n) => n && n.responseId) : [];
    const byId = new Map((responses || []).filter((r) => r && r.responseId).map((r) => [r.responseId, r]));
    const main = nodes.filter((n) => !n.threadParentId);
    const nodeById = new Map(main.map((n) => [n.responseId, n]));
    let ordered = main;
    const leaf = main[main.length - 1];
    if (leaf) {
      const chain = [];
      const seen = new Set();
      for (let n = leaf; n && !seen.has(n.responseId); n = nodeById.get(n.parentResponseId)) {
        seen.add(n.responseId);
        chain.push(n);
      }
      if (chain.length > 1) ordered = chain.reverse();
    }
    const messages = [];
    for (const node of ordered) {
      const r = byId.get(node.responseId);
      if (!r) continue;
      const role = (r.sender || node.sender) === 'human' ? 'user' : 'assistant';
      const parts = [];
      if (r.thinkingTrace && typeof r.thinkingTrace === 'string' && r.thinkingTrace.trim()) parts.push({ kind: 'thinking', text: r.thinkingTrace.trim() });
      if (typeof r.message === 'string' && r.message.trim()) parts.push({ kind: 'markdown', text: r.message.trim() });
      for (const file of Array.isArray(r.fileAttachments) ? r.fileAttachments : []) {
        const name = typeof file === 'string' ? '' : (file?.fileName || file?.name || '');
        if (name) parts.push({ kind: isImageName(name) ? 'image' : 'file', name: String(name) });
      }
      pushMessage(messages, { role, time: isoFromText(r.createTime), model: String(r.model || ''), parts });
    }
    const site = ABCM.sites.byId('grok');
    return {
      site: 'grok',
      siteName: site?.name || 'Grok',
      id,
      title: String(title || '').replace(/\s*[-–]\s*Grok\s*$/i, '').trim(),
      url,
      model: messages.map((m) => m.model).filter(Boolean).pop() || '',
      createdAt: messages[0]?.time || '',
      messages
    };
  }

  // ── page markup to Markdown (Gemini) ─────────────────────────────────────────────────────
  const SKIP_TAGS = new Set(['button', 'script', 'style', 'svg', 'gem-icon', 'gem-icon-button', 'mat-icon', 'gem-popover', 'mat-menu', 'sources-list', 'message-actions', 'thinking-overlay', 'model-response-disclaimers', 'election-info-disclaimer', 'finance-info-disclaimer', 'sensitive-memories-banner', 'freemium-rag-disclaimer', 'copy-button']);
  const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'figure', 'ul', 'ol', 'pre', 'blockquote', 'table', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

  /** Escapes what would turn plain page text into Markdown syntax. */
  function escapeMd(text) {
    return String(text).replace(/([\\`*_[\]<>])/g, '\\$1');
  }

  function mathSource(el) {
    if (el.hasAttribute?.('data-math')) return el.getAttribute('data-math') || '';
    const tex = el.querySelector?.('annotation[encoding="application/x-tex"]');
    return tex ? tex.textContent : '';
  }

  function isMath(el) {
    return el.hasAttribute?.('data-math') || el.localName === 'math';
  }

  function inlineMd(node) {
    if (node.nodeType === 3) return escapeMd(node.nodeValue.replace(/\s+/g, ' '));
    if (node.nodeType !== 1) return '';
    const tag = node.localName;
    if (SKIP_TAGS.has(tag)) return '';
    if (isMath(node)) {
      const tex = mathSource(node).trim();
      if (!tex) return '';
      return node.getAttribute('display') === 'block' ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
    }
    if (tag === 'br') return '  \n';
    const inner = () => Array.from(node.childNodes).map(inlineMd).join('');
    if (tag === 'strong' || tag === 'b') { const s = inner(); return s.trim() ? `**${s.trim()}**` : s; }
    if (tag === 'em' || tag === 'i') { const s = inner(); return s.trim() ? `*${s.trim()}*` : s; }
    if (tag === 'code') { const s = node.textContent; return s ? `\`${s.replace(/`/g, '\\`')}\`` : ''; }
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      const s = inner();
      return /^https:\/\//i.test(href) && s.trim() ? `[${s.trim()}](${href.replace(/[()\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)})` : s;
    }
    if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      return /^https:\/\//i.test(src) ? `![${escapeMd(node.getAttribute('alt') || '')}](${src.replace(/[()\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)})` : '';
    }
    return inner();
  }

  function codeBlockMd(el) {
    const code = el.localName === 'pre' ? el : (el.querySelector('pre') || el);
    const codeEl = code.querySelector('code') || code;
    const label = el.querySelector?.('.code-block-decoration span')?.textContent || codeEl.className.match(/language-([\w+#.-]+)/)?.[1] || '';
    return fence(codeEl.textContent.replace(/\n$/, ''), label.trim().toLowerCase());
  }

  function tableMd(table) {
    const rows = Array.from(table.querySelectorAll('tr')).map((tr) => Array.from(tr.children).filter((c) => c.localName === 'th' || c.localName === 'td').map((c) => blocksMd(c).join(' ').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()));
    if (!rows.length) return '';
    const width = Math.max(...rows.map((r) => r.length));
    const line = (r) => `| ${Array.from({ length: width }, (_v, i) => r[i] || '').join(' | ')} |`;
    return [line(rows[0]), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
  }

  function listMd(list) {
    const ordered = list.localName === 'ol';
    let n = Number(list.getAttribute('start')) || 1;
    return Array.from(list.children).filter((li) => li.localName === 'li').map((li) => {
      const text = blocksMd(li).join('\n').split('\n');
      const marker = ordered ? `${n++}. ` : '- ';
      return text.map((line, i) => (i === 0 ? marker : ' '.repeat(marker.length)) + line).join('\n').trimEnd();
    }).join('\n');
  }

  /** Block-level Markdown strings for the children of a node. */
  function blocksMd(parent) {
    const out = [];
    let buffer = '';
    const flush = () => { const s = buffer.replace(/[ \t]+\n/g, '\n').trim(); if (s) out.push(s); buffer = ''; };
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType !== 1) { buffer += inlineMd(node); continue; }
      const tag = node.localName;
      if (SKIP_TAGS.has(tag)) continue;
      if (isMath(node)) { buffer += inlineMd(node); continue; }
      if (tag === 'code-block' || tag === 'pre') { flush(); out.push(codeBlockMd(node)); continue; }
      if (tag === 'table' || tag === 'table-block') { flush(); const tbl = tag === 'table' ? node : node.querySelector('table'); const md = tbl ? tableMd(tbl) : ''; if (md) out.push(md); continue; }
      if (tag === 'ul' || tag === 'ol') { flush(); const md = listMd(node); if (md) out.push(md); continue; }
      if (tag === 'blockquote') { flush(); const md = blocksMd(node).join('\n\n'); if (md) out.push(quote(md)); continue; }
      if (tag === 'hr') { flush(); out.push('---'); continue; }
      if (/^h[1-6]$/.test(tag)) { flush(); const s = Array.from(node.childNodes).map(inlineMd).join('').trim(); if (s) out.push(`${'#'.repeat(Number(tag[1]))} ${s}`); continue; }
      if (tag === 'p') { flush(); const s = Array.from(node.childNodes).map(inlineMd).join('').replace(/[ \t]+\n/g, '\n').trim(); if (s) out.push(s); continue; }
      if (BLOCK_TAGS.has(tag) || tag.includes('-')) { flush(); out.push(...blocksMd(node)); continue; }
      buffer += inlineMd(node);
    }
    flush();
    return out;
  }

  /** Markdown for a page node. Only the structure the reader sees: no styles, no scripts, no buttons. */
  function htmlToMarkdown(node) {
    return blocksMd(node).join('\n\n').trim();
  }

  /** Gemini: the page holds user-query and model-response elements in order. Older turns must already be on the page. */
  function fromGemini(root, { id = '', url = '', title = '', selectors = {}, incomplete = false } = {}) {
    const sel = { user: 'user-query', model: 'model-response', userText: '.query-text', body: 'message-content', ...selectors };
    const messages = [];
    for (const el of Array.from(root.querySelectorAll(`${sel.user}, ${sel.model}`))) {
      const isUser = el.matches(sel.user);
      const parts = [];
      if (isUser) {
        const text = htmlToMarkdown(el.querySelector(sel.userText) || el);
        if (text) parts.push({ kind: 'markdown', text });
      } else {
        for (const body of Array.from(el.querySelectorAll(sel.body))) {
          const text = htmlToMarkdown(body);
          if (text) parts.push({ kind: 'markdown', text });
        }
      }
      pushMessage(messages, { role: isUser ? 'user' : 'assistant', time: '', model: '', parts });
    }
    const site = ABCM.sites.byId('gemini');
    return {
      site: 'gemini',
      siteName: site?.name || 'Gemini',
      id,
      title: String(title || '').replace(/\s*[-–]\s*Google Gemini\s*$/i, '').trim(),
      url,
      model: '',
      createdAt: '',
      incomplete: Boolean(incomplete),
      messages
    };
  }

  /** The number of different image addresses in a piece of a Gemini turn (its pictures are Google user-content links). */
  function geminiImageCount(node) {
    const seen = new Set();
    const walk = (n) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (typeof n === 'string' && /^https:\/\/(?:[\w-]+\.)?googleusercontent\.com\//.test(n)) seen.add(n.split('?')[0]);
    };
    walk(node);
    return seen.size;
  }

  /**
   * Gemini through the site's own call (ListConversationTurns): a list of turns, oldest first. A turn is
   * [[chatId, replyId], null, [[prompt text], ...], [[[replyId, [reply text], ...]], ..., model name at 21], [seconds, nanos]].
   */
  function fromGeminiRpc(turns, { id = '', url = '', title = '' } = {}) {
    const messages = [];
    let model = '';
    let createdAt = '';
    for (const turn of Array.isArray(turns) ? turns : []) {
      const time = isoFromSeconds(turn?.[4]?.[0]);
      if (!createdAt) createdAt = time;
      const prompt = turn?.[2]?.[0]?.[0];
      const userParts = [];
      if (typeof prompt === 'string' && prompt.trim()) userParts.push({ kind: 'markdown', text: prompt });
      for (let i = 0; i < geminiImageCount(turn?.[2]); i++) userParts.push({ kind: 'image', name: '' });
      pushMessage(messages, { role: 'user', time, model: '', parts: userParts });
      const candidate = turn?.[3]?.[0]?.[0];
      const reply = candidate?.[1]?.[0];
      const name = typeof turn?.[3]?.[21] === 'string' ? turn[3][21] : '';
      const replyParts = [];
      if (typeof reply === 'string' && reply.trim()) replyParts.push({ kind: 'markdown', text: reply });
      // The reply text sits at index 1 of the candidate; any image address elsewhere in it is a picture.
      for (let i = 0; i < geminiImageCount(Array.isArray(candidate) ? candidate.filter((_v, k) => k !== 1) : null); i++) replyParts.push({ kind: 'image', name: '' });
      if (replyParts.length) {
        pushMessage(messages, { role: 'assistant', time, model: name, parts: replyParts });
        if (name) model = name;
      }
    }
    const site = ABCM.sites.byId('gemini');
    return {
      site: 'gemini',
      siteName: site?.name || 'Gemini',
      id,
      title: String(title || '').replace(/\s*[-–]\s*Google Gemini\s*$/i, '').trim(),
      url,
      model,
      createdAt,
      messages
    };
  }

  // ── writers ──────────────────────────────────────────────────────────────────────────────
  const t = (key, params) => ABCM.i18n.t(key, params);

  const wanted = (part, options) => (part.kind !== 'thinking' || options.thinking);
  /** The messages to write: the picked ones (by position), or only the user's with promptsOnly, without the parts the options leave out. */
  const visibleMessages = (conversation, options) => {
    const picked = Array.isArray(options.pick) ? new Set(options.pick) : null;
    return conversation.messages
      .map((m, index) => ({ ...m, index, parts: m.parts.filter((p) => wanted(p, options)) }))
      .filter((m) => m.parts.length && (!picked || picked.has(m.index)) && (!options.promptsOnly || m.role === 'user'));
  };

  /** A code fence longer than any run of backticks inside the text, so the text cannot close it early. */
  function fence(text, language) {
    const longest = Math.max(2, ...(String(text).match(/`+/g) || []).map((run) => run.length));
    const ticks = '`'.repeat(longest + 1);
    return `${ticks}${String(language || '').replace(/[^\w+#.-]/g, '')}\n${text}\n${ticks}`;
  }

  const quote = (text) => String(text).split('\n').map((line) => `> ${line}`.trimEnd()).join('\n');

  const imageLabel = (part) => (part.name ? t('export.image', { name: part.name }) : t('export.imageUnnamed'));

  const EXTENSION_OF = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

  /**
   * sink.mode 'tokens': a picture the page let us read becomes ![alt](abcm-image:N) and is put in sink.list
   * (the writers that draw the text resolve the number); 'files': ![alt](images/image-N.ext) for a ZIP.
   * Without a sink, or when the picture's bytes are not there, it is the one-line note.
   */
  function partToMarkdown(part, sink) {
    if (part.kind === 'image' && part.data && sink) {
      sink.list.push(part.data);
      const n = sink.list.length;
      // Gemini's own alt text starts with a comma (", AI generated"); keep the words.
      const alt = String(part.name || part.alt || '').replace(/[\[\]\n]/g, ' ').replace(/^[\s,;:.-]+/, '').trim() || t('export.imageUnnamed');
      return sink.mode === 'files' ? `![${alt}](images/image-${n}.${EXTENSION_OF[part.data.mime] || 'png'})` : `![${alt}](abcm-image:${n})`;
    }
    if (part.kind === 'markdown') return part.text;
    if (part.kind === 'thinking') return `${quote(`**${t('export.thinking')}**`)}\n>\n${quote(part.text)}`;
    if (part.kind === 'code') return fence(part.text, part.language);
    if (part.kind === 'tool') return `*${t('export.tool', { name: part.name })}*`;
    if (part.kind === 'file') return `*${t('export.file', { name: part.name })}*`;
    if (part.kind === 'image') return `*${imageLabel(part)}*`;
    return '';
  }

  const roleLabel = (conversation, role) => (role === 'user' ? t('export.roleUser') : conversation.siteName);

  function headerLines(conversation, options, exportedAt) {
    const lines = [];
    if (options.metadata) {
      lines.push(`- ${t('export.metaSite')}: ${conversation.siteName}`);
      if (conversation.model) lines.push(`- ${t('export.metaModel')}: ${conversation.model}`);
      if (conversation.createdAt) lines.push(`- ${t('export.metaStarted')}: ${conversation.createdAt}`);
      lines.push(`- ${t('export.metaExported')}: ${exportedAt.toISOString()}`);
    }
    if (options.sourceUrl && conversation.url) lines.push(`- ${t('export.metaSource')}: ${conversation.url}`);
    if (conversation.incomplete) lines.push(`- ${t('export.incomplete')}`);
    return lines;
  }

  function toMarkdown(conversation, options, exportedAt = new Date(), sink = null) {
    const out = [`# ${String(conversation.title || conversation.siteName).replace(/\s+/g, ' ').trim()}`];
    const head = headerLines(conversation, options, exportedAt);
    if (head.length) out.push(head.join('\n'));
    for (const m of visibleMessages(conversation, options)) {
      const when = options.metadata && m.time ? `\n*${m.time}*` : '';
      out.push(`## ${roleLabel(conversation, m.role)}${when}`, m.parts.map((p) => partToMarkdown(p, sink)).join('\n\n'));
    }
    return `${out.join('\n\n')}\n`;
  }

  function partToText(part) {
    if (part.kind === 'tool') return `[${t('export.tool', { name: part.name })}]`;
    if (part.kind === 'file') return `[${t('export.file', { name: part.name })}]`;
    if (part.kind === 'image') return `[${imageLabel(part)}]`;
    if (part.kind === 'thinking') return `[${t('export.thinking')}]\n${part.text}`;
    return part.text;
  }

  function toText(conversation, options, exportedAt = new Date()) {
    const out = [String(conversation.title || conversation.siteName).replace(/\s+/g, ' ').trim()];
    const head = headerLines(conversation, options, exportedAt).map((line) => line.replace(/^- /, ''));
    if (head.length) out.push(head.join('\n'));
    for (const m of visibleMessages(conversation, options)) {
      const when = options.metadata && m.time ? ` (${m.time})` : '';
      out.push(`${'='.repeat(24)}\n${roleLabel(conversation, m.role)}${when}\n${'='.repeat(24)}\n${m.parts.map(partToText).join('\n\n')}`);
    }
    return `${out.join('\n\n')}\n`;
  }

  function toJson(conversation, options, exportedAt = new Date()) {
    return JSON.stringify({
      schema: 1,
      exportedAt: exportedAt.toISOString(),
      site: conversation.site,
      id: conversation.id,
      title: conversation.title,
      url: options.sourceUrl ? conversation.url : '',
      model: conversation.model,
      createdAt: conversation.createdAt,
      incomplete: Boolean(conversation.incomplete),
      messages: visibleMessages(conversation, options).map((m) => ({
        role: m.role,
        time: m.time,
        model: m.model,
        parts: m.parts.map((p) => ({ kind: p.kind, ...(p.text != null ? { text: p.text } : {}), ...(p.language ? { language: p.language } : {}), ...(p.name ? { name: p.name } : {}) }))
      }))
    }, null, 2);
  }

  function build(format, conversation, options = {}, exportedAt = new Date()) {
    const o = { thinking: false, metadata: true, sourceUrl: true, ...options };
    if (format === 'md') return toMarkdown(conversation, o, exportedAt);
    if (format === 'txt') return toText(conversation, o, exportedAt);
    if (format === 'json') return toJson(conversation, o, exportedAt);
    if (format === 'docx') {
      const sink = { mode: 'tokens', list: [] };
      const markdown = toMarkdown(conversation, o, exportedAt, sink);
      return ABCM.docx.fromMarkdown(markdown, { title: conversation.title || conversation.siteName, created: exportedAt, images: sink.list });
    }
    throw new Error(`Unknown conversation format: ${format}`);
  }

  /** A file name that is safe on Windows, macOS and Linux and keeps non-Latin titles. */
  function filename(format, conversation, now = new Date()) {
    const stamp = now.toISOString().slice(0, 10);
    const title = String(conversation.title || '')
      .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 80)
      .trim();
    const base = `${conversation.site || 'chat'}-${title || 'conversation'}-${stamp}`;
    return `${base}.${FORMATS[format].extension}`;
  }

  /** Hands a Blob to the browser as a download. */
  function saveBlob(blob, name) {
    const url = g.URL.createObjectURL(blob);
    const link = g.document.createElement('a');
    link.href = url;
    link.download = name;
    link.style.display = 'none';
    g.document.body.appendChild(link);
    link.click();
    link.remove();
    g.setTimeout(() => g.URL.revokeObjectURL(url), 30000);
  }

  /** The Markdown for the writers that draw the text (PDF, long image), and the pictures it points at. */
  function forRender(conversation, options = {}, exportedAt = new Date()) {
    const sink = { mode: 'tokens', list: [] };
    const markdown = toMarkdown(conversation, { thinking: false, metadata: true, sourceUrl: true, ...options }, exportedAt, sink);
    return { markdown, images: sink.list };
  }

  /** Markdown that links its pictures as images/image-N.ext, with the files, for a ZIP. Null when no picture could be read. */
  function markdownPackage(conversation, options = {}, exportedAt = new Date()) {
    const sink = { mode: 'files', list: [] };
    const markdown = toMarkdown(conversation, { thinking: false, metadata: true, sourceUrl: true, ...options }, exportedAt, sink);
    if (!sink.list.length) return null;
    const files = sink.list.map((data, i) => ({ name: `images/image-${i + 1}.${EXTENSION_OF[data.mime] || 'png'}`, data: data.bytes }));
    return { markdown, files };
  }

  /** Delivers the file: a download, the print dialog (PDF) or a rendered image. Returns (a promise of) the file name. */
  function download(format, conversation, options = {}) {
    const name = filename(format, conversation);
    const { mime, binary, print, image } = FORMATS[format];
    if (print) { ABCM.print.show(conversation, options, { title: name.replace(/\.pdf$/, '') }); return name; }
    if (image) return ABCM.image.save(conversation, options, name);
    if (format === 'md') {
      const pack = markdownPackage(conversation, options);
      if (pack) {
        const zipName = `${name.replace(/\.md$/, '')}.zip`;
        ABCM.conversation.saveBlob(new g.Blob([ABCM.zip.create([{ name, data: pack.markdown }, ...pack.files])], { type: 'application/zip' }), zipName);
        return zipName;
      }
    }
    const data = build(format, conversation, options);
    ABCM.conversation.saveBlob(new g.Blob([data], { type: binary ? mime : `${mime};charset=utf-8` }), name);
    return name;
  }

  ABCM.define('conversation', { FORMATS, fromChatgpt, fromClaude, fromGrok, fromDeepseek, fromPerplexity, fromGemini, fromGeminiRpc, htmlToMarkdown, cleanChatgptText, build, forRender, markdownPackage, filename, download, saveBlob });
})(globalThis);
