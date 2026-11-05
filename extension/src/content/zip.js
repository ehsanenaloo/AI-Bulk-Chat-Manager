/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  A small ZIP writer: stored entries only (no compression), UTF-8 names, CRC-32. Enough for the
  Word export, whose files are tiny XML. Pure: bytes in, bytes out.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** UTF-8 bytes of a string. Lone surrogates become U+FFFD, as in a normal encoder. */
  function utf8(text) {
    const out = [];
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      let cp = s.charCodeAt(i);
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
      } else if (cp >= 0xd800 && cp <= 0xdfff) {
        cp = 0xfffd;
      }
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return Uint8Array.from(out);
  }

  /** files: [{ name, data: Uint8Array | string }] in the order to write. Returns the archive as a Uint8Array. */
  function create(files, when = new Date()) {
    const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
    const date = (Math.max(0, when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
    const entries = files.map((file) => {
      const name = utf8(file.name);
      const data = typeof file.data === 'string' ? utf8(file.data) : file.data;
      return { name, data, crc: crc32(data) };
    });
    const local = entries.reduce((sum, e) => sum + 30 + e.name.length + e.data.length, 0);
    const central = entries.reduce((sum, e) => sum + 46 + e.name.length, 0);
    const out = new Uint8Array(local + central + 22);
    const view = new DataView(out.buffer);
    let at = 0;
    const offsets = [];
    for (const e of entries) {
      offsets.push(at);
      view.setUint32(at, 0x04034b50, true);
      view.setUint16(at + 4, 20, true);
      view.setUint16(at + 6, 0x0800, true);
      view.setUint16(at + 8, 0, true);
      view.setUint16(at + 10, time, true);
      view.setUint16(at + 12, date, true);
      view.setUint32(at + 14, e.crc, true);
      view.setUint32(at + 18, e.data.length, true);
      view.setUint32(at + 22, e.data.length, true);
      view.setUint16(at + 26, e.name.length, true);
      view.setUint16(at + 28, 0, true);
      out.set(e.name, at + 30);
      out.set(e.data, at + 30 + e.name.length);
      at += 30 + e.name.length + e.data.length;
    }
    const centralStart = at;
    entries.forEach((e, i) => {
      view.setUint32(at, 0x02014b50, true);
      view.setUint16(at + 4, 20, true);
      view.setUint16(at + 6, 20, true);
      view.setUint16(at + 8, 0x0800, true);
      view.setUint16(at + 10, 0, true);
      view.setUint16(at + 12, time, true);
      view.setUint16(at + 14, date, true);
      view.setUint32(at + 16, e.crc, true);
      view.setUint32(at + 20, e.data.length, true);
      view.setUint32(at + 24, e.data.length, true);
      view.setUint16(at + 28, e.name.length, true);
      view.setUint32(at + 42, offsets[i], true);
      out.set(e.name, at + 46);
      at += 46 + e.name.length;
    });
    view.setUint32(at, 0x06054b50, true);
    view.setUint16(at + 8, entries.length, true);
    view.setUint16(at + 10, entries.length, true);
    view.setUint32(at + 12, at - centralStart, true);
    view.setUint32(at + 16, centralStart, true);
    return out;
  }

  ABCM.define('zip', { crc32, utf8, create });
})(globalThis);
