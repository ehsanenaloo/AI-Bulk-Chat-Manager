/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Long image export. The conversation is drawn like the PDF view, measured off screen, wrapped in an
  SVG foreignObject and painted onto a canvas, one tile at a time. Tiles are cut between blocks where
  possible so a line is not split. One tile gives a .png; several are packed into a .zip. Only text
  the page already holds is drawn; no image is fetched (D-018). Nothing leaves the device.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const WIDTH = 800;
  const PAD_X = 36;
  const PAD_Y = 32;
  const MAX_TILE_PIXELS = 16000; // the canvas limit in Chromium is 16384 on a side

  const cc = (...codes) => codes.map((c) => String.fromCharCode(c)).join('');
  const BAD_XML = new RegExp(`[${cc(0)}-${cc(8)}${cc(0xb, 0xc)}${cc(0xe)}-${cc(0x1f)}${cc(0xfffe, 0xffff)}]`, 'g');
  const escapeText = (s) => String(s).replace(BAD_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

  const delay = (ms) => new Promise((resolve) => g.setTimeout(resolve, ms));

  /** Cut points (CSS px) for tiles no taller than maxTile, preferring the start of a block. */
  function cutPoints(total, tops, maxTile) {
    const cuts = [0];
    let start = 0;
    while (total - start > maxTile) {
      const limit = start + maxTile;
      const cut = tops.filter((t) => t > start + maxTile * 0.5 && t <= limit).pop() ?? limit;
      cuts.push(cut);
      start = cut;
    }
    cuts.push(total);
    return cuts;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new g.Image();
      const timer = g.setTimeout(() => reject(new Error('image load timed out')), 20000);
      img.onload = () => { g.clearTimeout(timer); resolve(img); };
      img.onerror = () => { g.clearTimeout(timer); reject(new Error('image could not be loaded')); };
      img.src = url;
    });
  }

  const toBlob = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas is empty'))), 'image/png'));

  /** Draws the Markdown text. Returns [{ blob, width, height }], one per tile. */
  async function draw(markdown, images = []) {
    const host = ABCM.print.render(markdown, images);
    host.removeAttribute('data-abcm-print');
    const inner = WIDTH - 2 * PAD_X;
    for (const [k, v] of [['position', 'fixed'], ['left', '-100000px'], ['top', '0'], ['visibility', 'hidden'], ['pointer-events', 'none'], ['width', `${inner}px`]]) host.style.setProperty(k, v, 'important');
    g.document.body.appendChild(host);
    try {
      const main = host.shadowRoot.querySelector('main');
      await Promise.all(Array.from(main.querySelectorAll('img')).map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())));
      await delay(0);
      const box = main.getBoundingClientRect();
      const height = Math.ceil(box.height) + 2 * PAD_Y;
      const tops = Array.from(main.children).map((c) => Math.round(c.getBoundingClientRect().top - box.top) + PAD_Y);
      const css = ABCM.print.css.replace(':host', '.abcm-root');
      const body = new g.XMLSerializer().serializeToString(main);
      const page = `<div xmlns="http://www.w3.org/1999/xhtml" class="abcm-root" style="box-sizing:border-box;width:${WIDTH}px;padding:${PAD_Y}px ${PAD_X}px;background:#fff"><style>${escapeText(css)}</style>${body.replace(BAD_XML, '')}</div>`;
      const scale = height > 60000 ? 1 : 2;
      const cuts = cutPoints(height, tops, Math.floor(MAX_TILE_PIXELS / scale));
      const tiles = [];
      for (let i = 0; i < cuts.length - 1; i++) {
        const y = cuts[i];
        const h = cuts[i + 1] - y;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${h}" viewBox="0 ${y} ${WIDTH} ${h}"><foreignObject x="0" y="0" width="${WIDTH}" height="${height}">${page}</foreignObject></svg>`;
        const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
        const canvas = g.document.createElement('canvas');
        canvas.width = WIDTH * scale;
        canvas.height = h * scale;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        tiles.push({ blob: await toBlob(canvas), width: canvas.width, height: canvas.height });
        canvas.width = canvas.height = 0;
      }
      return tiles;
    } finally {
      host.remove();
    }
  }

  /** Renders the conversation and downloads it: one PNG, or a ZIP of PNGs when it is too tall. Returns the file name. */
  async function save(conversation, options, name) {
    const { markdown, images } = ABCM.conversation.forRender(conversation, options);
    const tiles = await draw(markdown, images);
    if (tiles.length === 1) {
      ABCM.conversation.saveBlob(tiles[0].blob, name);
      return name;
    }
    const base = name.replace(/\.png$/, '');
    const files = [];
    for (let i = 0; i < tiles.length; i++) {
      files.push({ name: `${base}-${String(i + 1).padStart(2, '0')}.png`, data: new Uint8Array(await tiles[i].blob.arrayBuffer()) });
    }
    const zip = `${base}.zip`;
    ABCM.conversation.saveBlob(new g.Blob([ABCM.zip.create(files)], { type: 'application/zip' }), zip);
    return zip;
  }

  ABCM.define('image', { draw, save, cutPoints });
})(globalThis);
