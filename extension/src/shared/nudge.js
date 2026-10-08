/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/*
  The monthly support reminder: a small heart on the toolbar icon and, in the popup, a short note
  that is shown at most once a month and can be turned off for good. Both the worker (badge) and
  the popup (note) decide "is it due?" with the same function, here.

  State lives in chrome.storage.local under "supportNudge": { installedAt, lastShownAt, shownCount, optOut }.
*/
(function (g) {
  'use strict';
  if (g.ABCM?.__skip) return;
  const ABCM = g.ABCM;

  const KEY = 'supportNudge';
  const DAY_MS = 86400000;
  const INITIAL_DELAY_DAYS = 14; // grace period after install
  const INTERVAL_DAYS = 30;      // "monthly"

  function isDue(nudge, now = Date.now()) {
    if (!nudge || typeof nudge !== 'object' || nudge.optOut) return false;
    const installedAt = nudge.installedAt || now;
    if (!nudge.lastShownAt) return now >= installedAt + INITIAL_DELAY_DAYS * DAY_MS;
    return now - nudge.lastShownAt >= INTERVAL_DAYS * DAY_MS;
  }

  async function read() {
    const stored = await ABCM.ext.storageGet([KEY]);
    return stored?.[KEY] && typeof stored[KEY] === 'object' ? stored[KEY] : null;
  }

  const write = (nudge) => ABCM.ext.storageSet({ [KEY]: nudge });

  /** Anchors the grace period to now the first time, so nobody is nudged right after installing. */
  async function seed(now = Date.now()) {
    const current = await read();
    if (current) return current;
    const created = { installedAt: now };
    await write(created);
    return created;
  }

  async function markShown(now = Date.now()) {
    const nudge = (await read()) || { installedAt: now };
    nudge.lastShownAt = now;
    nudge.shownCount = (nudge.shownCount || 0) + 1;
    await write(nudge);
    return nudge;
  }

  async function optOut(now = Date.now()) {
    const nudge = (await read()) || { installedAt: now };
    nudge.optOut = true;
    await write(nudge);
    return nudge;
  }

  ABCM.define('nudge', { KEY, INITIAL_DELAY_DAYS, INTERVAL_DAYS, isDue, read, seed, markShown, optOut });
})(globalThis);
