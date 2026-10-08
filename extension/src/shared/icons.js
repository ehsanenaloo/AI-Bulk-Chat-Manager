/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  Icon set: 24x24 outline glyphs drawn with one stroke weight (set in components.css), based on
  the open Lucide icon style (ISC licence, see THIRD_PARTY_NOTICES.md). Built with DOMParser, never
  innerHTML, so nothing here can be confused with page content.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const PATHS = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronUp: '<path d="m18 15-6-6-6 6"/>',
    minus: '<path d="M5 12h14"/>',
    chevronsDown: '<path d="m7 6 5 5 5-5"/><path d="m7 13 5 5 5-5"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
    stop: '<rect width="12" height="12" x="6" y="6" rx="2"/>',
    retry: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
    book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    listChecks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    invert: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
    clear: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    copy: '<rect width="13" height="13" x="9" y="9" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>'
  };

  const cache = new Map();

  /** Returns a new <svg class="icon"> element for the named glyph. */
  function icon(name, className = '') {
    if (!cache.has(name)) {
      const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name] || PATHS.info}</svg>`;
      cache.set(name, new g.DOMParser().parseFromString(markup, 'image/svg+xml').documentElement);
    }
    const node = g.document.importNode(cache.get(name), true);
    node.setAttribute('class', `icon ${className}`.trim());
    return node;
  }

  const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" aria-hidden="true" focusable="false"><defs><linearGradient id="abcm-logo-bg" x1="14" y1="8" x2="116" y2="122" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#19B0CC"/><stop offset="1" stop-color="#0A5570"/></linearGradient></defs><rect width="128" height="128" rx="30" fill="url(#abcm-logo-bg)"/><rect x="50" y="22" width="60" height="44" rx="13" fill="#fff" fill-opacity=".42"/><path d="M34 42h34c8.3 0 15 6.7 15 15v20c0 8.3-6.7 15-15 15H48.500L33.400 107.600a2 2 0 0 1-3.400-1.500V92c-7.200-1-12-7.200-12-14.600V57c0-8.300 6.700-15 16-15z" fill="#fff"/><path d="M38.500 68.500l9.500 9.500 19-21" fill="none" stroke="#0E7C95" stroke-width="8.500" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /** The product mark as an <svg> element (sized by CSS). */
  function logo(className = '') {
    const node = g.document.importNode(new g.DOMParser().parseFromString(LOGO, 'image/svg+xml').documentElement, true);
    node.setAttribute('class', className);
    return node;
  }

  ABCM.define('icons', { icon, logo, names: Object.keys(PATHS) });
})(globalThis);
