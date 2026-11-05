/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Bulk export of chat contents: reads each selected chat by its id, one at a time with a short pause,
  turns it into a file and puts all files into one ZIP on the user's device. Nothing is kept after
  the download. Stop ends the run after the chat in progress and still saves what is ready.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const FORMATS = ['md', 'txt', 'json', 'docx'];
  const RATE_LIMIT_WAIT = 4000;

  const sleep = (ms) => new Promise((resolve) => g.setTimeout(resolve, ms));

  /** A file name not used yet in this archive: "name.md", then "name (2).md". Names are compared without case, as Windows and macOS unpack them. */
  function uniqueName(name, used) {
    if (!used.has(name.toLowerCase())) { used.add(name.toLowerCase()); return name; }
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 2; ; n++) {
      const next = `${base} (${n})${ext}`;
      if (!used.has(next.toLowerCase())) { used.add(next.toLowerCase()); return next; }
    }
  }

  async function readOne(item) {
    let result = await ABCM.reader.readId(item.id, item.url);
    if (!result.ok && result.reason === 'rate-limited') {
      await sleep(RATE_LIMIT_WAIT);
      result = await ABCM.reader.readId(item.id, item.url);
    }
    return result;
  }

  /**
   * items: [{ id, title, url }]. Returns { operation: 'EXPORT', total, succeeded, stopped, failures, unknown, file }.
   * failures: [{ id, title, reason }] with a reader reason ('auth', 'not-found', 'rate-limited', 'network' ...).
   */
  async function run(items, { format = 'md', options = {}, onProgress = () => {}, pause = ABCM.config.delays.long } = {}) {
    if (!FORMATS.includes(format)) throw new Error(`Unknown bulk export format: ${format}`);
    ABCM.state.clearStop();
    ABCM.state.setStatus('running'); // the panel cannot be closed while chats are being read
    try {
      return await exportAll(items, { format, options, onProgress, pause });
    } finally {
      ABCM.state.clearStop();
      ABCM.state.setStatus('ready');
    }
  }

  async function exportAll(items, { format, options, onProgress, pause }) {
    const total = items.length;
    const files = [];
    const failures = [];
    const used = new Set();
    let done = 0;
    let stopped = false;
    for (const item of items) {
      if (ABCM.state.stopRequested) { stopped = true; break; }
      onProgress({ done, total, failed: failures.length, currentTitle: item.title || '' });
      const result = await readOne(item);
      if (result.ok) {
        try {
          const conversation = { ...result.conversation, title: result.conversation.title || item.title || '' };
          const data = ABCM.conversation.build(format, conversation, options);
          files.push({ name: uniqueName(ABCM.conversation.filename(format, conversation), used), data });
        } catch (_) {
          failures.push({ id: item.id, title: item.title || '', reason: 'other' });
        }
      } else {
        failures.push({ id: item.id, title: item.title || '', reason: result.reason || 'other' });
      }
      done++;
      onProgress({ done, total, failed: failures.length, currentTitle: '' });
      if (done < total && !ABCM.state.stopRequested) await sleep(pause);
    }
    if (ABCM.state.stopRequested && done < total) stopped = true;
    let file = '';
    if (files.length) {
      const site = ABCM.sites.current();
      file = `${site?.id || 'chat'}-chats-${new Date().toISOString().slice(0, 10)}.zip`;
      ABCM.conversation.saveBlob(new g.Blob([ABCM.zip.create(files)], { type: 'application/zip' }), file);
    }
    return { operation: 'EXPORT', requested: total, total, succeeded: files.length, stopped, failures, unknown: [], file };
  }

  ABCM.define('bulkExport', { FORMATS, run, uniqueName });
})(globalThis);
