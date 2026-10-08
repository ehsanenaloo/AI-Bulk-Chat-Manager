/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
/* Options page: every setting in one place, plus privacy facts, diagnostics and links. */
(function (g) {
  'use strict';
  const ABCM = g.ABCM;
  const t = (key, params) => ABCM.i18n.t(key, params);
  const $ = (id) => g.document.getElementById(id);

  function say(message) { $('note').textContent = message; }

  function paint() {
    const s = ABCM.settings.get();
    $('language').value = s.language;
    $('threshold').value = String(s.confirmThreshold);
    $('sw-fast').setAttribute('aria-checked', String(s.fastMode));
    $('sw-auto').setAttribute('aria-checked', String(s.autoLoad));
    $('sw-launcher').setAttribute('aria-checked', String(s.showLauncher));
    const sync = (selector, value) => g.document.querySelectorAll(selector).forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.value === value));
      b.tabIndex = b.dataset.value === value ? 0 : -1; // roving tabindex
    });
    sync('#theme button', s.theme);
    sync('#accent button', s.accent);
  }

  function fillLanguages() {
    const select = $('language');
    const auto = g.document.createElement('option');
    auto.value = 'auto';
    auto.textContent = t('options.languageAuto');
    select.replaceChildren(auto, ...ABCM.i18n.LANGUAGES.map((l) => {
      const option = g.document.createElement('option');
      option.value = l.code;
      option.textContent = l.name;
      option.lang = l.code;
      return option;
    }));
  }

  async function shortcutText() {
    try {
      const commands = await new Promise((resolve) => g.chrome.commands.getAll(resolve));
      return commands.find((command) => command.name === 'toggle-panel')?.shortcut || '';
    } catch (_) { return ''; }
  }

  /** A radio group: click or arrow keys choose; only the chosen option is in the Tab order. */
  function bindRadioGroup(id, key) {
    const group = $(id);
    const buttons = () => Array.from(group.querySelectorAll('button[data-value]'));
    const choose = async (button) => {
      await ABCM.settings.save({ [key]: button.dataset.value });
      paint();
    };
    group.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-value]');
      if (button) choose(button);
    });
    group.addEventListener('keydown', (event) => {
      const list = buttons();
      const at = list.indexOf(g.document.activeElement);
      if (at < 0) return;
      const rtl = g.document.documentElement.dir === 'rtl';
      const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 1, ArrowUp: -1 }[event.key];
      const jump = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : null;
      if (step === undefined && jump === null) return;
      event.preventDefault();
      const next = list[jump ?? (at + step + list.length) % list.length];
      next.focus();
      choose(next);
    });
  }

  function bindSwitch(id, key) {
    $(id).addEventListener('click', async () => {
      await ABCM.settings.save({ [key]: !ABCM.settings.get()[key] });
      paint();
    });
  }

  function diagnostics() {
    const s = ABCM.settings.get();
    return [
      `AI Bulk Chat Manager ${ABCM.version}`,
      `Browser: ${ABCM.links.browser()} (${g.navigator.userAgent})`,
      `Interface language: ${ABCM.i18n.lang} (setting: ${s.language})`,
      `Settings: theme=${s.theme}, accent=${s.accent}, fastMode=${s.fastMode}, autoLoad=${s.autoLoad}, confirmThreshold=${s.confirmThreshold}, launcher=${s.showLauncher}`,
      'No chat titles, addresses or other page content are included in this report.'
    ].join('\n');
  }

  function wireLinks() {
    const urls = { guide: ABCM.links.guide, repo: ABCM.links.repo, issues: ABCM.links.issues, rate: ABCM.links.reviewUrl(), support: ABCM.links.support, website: ABCM.links.website };
    const labels = { guide: 'popup.guide', repo: 'popup.source', issues: 'options.reportIssue', rate: 'popup.rate', support: 'popup.support', website: 'options.website' };
    g.document.querySelectorAll('[data-link]').forEach((button) => {
      const kind = button.dataset.link;
      button.textContent = t(labels[kind]);
      button.addEventListener('click', () => ABCM.ext.openTab(urls[kind]));
    });
  }

  function highlightNav() {
    const links = Array.from(g.document.querySelectorAll('.nav a'));
    const sections = links.map((a) => g.document.querySelector(a.getAttribute('href')));
    const observer = new g.IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === `#${entry.target.id}`)));
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    sections.forEach((section) => section && observer.observe(section));
  }

  async function main() {
    await ABCM.page.init({ onChange: paint });
    $('version').textContent = `v${ABCM.version}`;
    fillLanguages();
    paint();

    $('language').addEventListener('change', async () => { await ABCM.settings.save({ language: $('language').value }); });
    $('threshold').addEventListener('change', async () => { await ABCM.settings.save({ confirmThreshold: $('threshold').value }); paint(); });
    bindRadioGroup('theme', 'theme');
    bindRadioGroup('accent', 'accent');
    bindSwitch('sw-fast', 'fastMode');
    bindSwitch('sw-auto', 'autoLoad');
    bindSwitch('sw-launcher', 'showLauncher');
    wireLinks();
    highlightNav();

    const shortcut = await shortcutText();
    $('shortcut-key').textContent = shortcut || t('options.shortcut.none');
    $('shortcut-change').addEventListener('click', async () => {
      try { if (g.chrome.commands?.openShortcutSettings) { await g.chrome.commands.openShortcutSettings(); return; } } catch (_) { /* fall back to the address below */ }
      const where = ABCM.links.shortcuts[ABCM.links.browser()];
      ABCM.ext.openTab(where).catch(() => say(t('options.shortcut.manual', { where })));
    });

    $('byline-site').addEventListener('click', () => ABCM.ext.openTab(ABCM.links.website));
    $('open-privacy').addEventListener('click', () => ABCM.ext.openTab(ABCM.links.privacy));
    $('copy-diagnostics').addEventListener('click', async () => {
      try { await g.navigator.clipboard.writeText(diagnostics()); say(t('options.diagnosticsCopied')); } catch (_) { say(t('result.copyFailed')); }
    });
    $('reset').addEventListener('click', async () => {
      if (!g.confirm(t('options.resetConfirm'))) return;
      await ABCM.ext.storageRemove([ABCM.settings.KEY]);
      await ABCM.settings.load();
      await ABCM.i18n.init('auto');
      ABCM.page.applyAppearance();
      ABCM.i18n.translateTree(g.document);
      fillLanguages();
      paint();
      say(t('options.resetDone'));
    });
  }

  main().catch((error) => console.error(error));
})(globalThis);
