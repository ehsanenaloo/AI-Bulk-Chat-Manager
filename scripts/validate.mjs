#!/usr/bin/env node
// Dependency-free repository check. Fails (exit 1) when the extension or the repository breaks a rule
// that would get it rejected by a store or leak something. Run it with: node scripts/validate.mjs
//
// It checks: the manifest shape and permissions, that every referenced file exists, that every script
// parses, that translations are valid JSON, that nothing forbidden is packaged, a few code-policy rules
// (no eval, no HTML string injection, no remote code), the external addresses the code mentions, and the
// repository's root layout.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listRuntimeFiles } from './list-runtime-files.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Permissions the extension is allowed to ask for. Adding one must be a deliberate change here.
export const ALLOWED_PERMISSIONS = ['activeTab', 'scripting', 'storage'];
// Addresses the code may mention. Everything is https.
export const ALLOWED_HOSTS = new Set([
  'chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com', 'grok.com',
  'github.com', 'ehsanenaloo.github.io', 'buymeacoffee.com', 'www.enaloo.com',
  'chromewebstore.google.com', 'addons.mozilla.org', 'microsoftedge.microsoft.com',
  'www.w3.org' // XML namespaces in inline SVG
]);
const ROOT_ALLOWED = new Set([
  'README.md', 'LICENSE', 'CHANGELOG.md', 'package.json', 'package-lock.json', '.gitignore', '.gitattributes', '.editorconfig',
  'extension', 'docs', 'tests', 'scripts', '.github',
  // development repository only
  'technical-docs', 'tools', 'AGENTS.md', 'build', 'dist', 'dist-firefox', 'node_modules', '.git', '.legacy', 'store'
]);
const FORBIDDEN_NAMES = /^(\.env.*|_metadata|.*\.pem|.*\.key|.*\.crx|.*\.xpi|.*\.zip|node_modules|\.DS_Store|Thumbs\.db)$/;

export function validate(root = repoRoot) {
  const errors = [];
  const notes = [];
  const err = (message) => errors.push(message);
  const extDir = path.join(root, 'extension');
  const read = (rel) => fs.readFileSync(path.join(extDir, rel), 'utf8');
  const exists = (rel) => fs.existsSync(path.join(extDir, rel));

  if (!fs.existsSync(path.join(extDir, 'manifest.json'))) return { errors: ['extension/manifest.json is missing'], notes };
  let manifest;
  try { manifest = JSON.parse(read('manifest.json')); } catch (e) { return { errors: [`manifest.json is not valid JSON: ${e.message}`], notes }; }

  // ── manifest ───────────────────────────────────────────────────────────────────────────────
  if (manifest.manifest_version !== 3) err('manifest_version must be 3');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) err(`version "${manifest.version}" must look like 1.2.3`);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.version && pkg.version !== manifest.version) err(`package.json version ${pkg.version} differs from manifest ${manifest.version}`);
  for (const key of ['key', 'update_url']) if (key in manifest) err(`manifest must not contain "${key}" (the stores assign it)`);
  if (manifest.host_permissions?.length) err('host_permissions must stay empty: sites are reached through content script matches only');
  if (manifest.optional_host_permissions?.length) err('optional_host_permissions is not used');
  for (const permission of manifest.permissions || []) if (!ALLOWED_PERMISSIONS.includes(permission)) err(`permission "${permission}" is not allowed (see ALLOWED_PERMISSIONS in scripts/validate.mjs)`);
  if (manifest.default_locale !== 'en') err('default_locale must be "en"');
  if (manifest.content_security_policy) err('a custom content_security_policy is not expected');
  for (const key of ['externally_connectable', 'optional_permissions', 'declarative_net_request', 'devtools_page', 'chrome_url_overrides']) if (key in manifest) err(`manifest must not declare "${key}"`);
  for (const entry of manifest.content_scripts || []) {
    for (const key of ['all_frames', 'world', 'match_about_blank', 'match_origin_as_fallback']) if (key in entry) err(`content_scripts must not set "${key}"`);
    for (const pattern of entry.matches || []) {
      const m = pattern.match(/^https:\/\/([a-z0-9.-]+)\/\*$/);
      if (!m || !ALLOWED_HOSTS.has(m[1])) err(`content script match "${pattern}" is not an exact https host on the allowlist`);
    }
  }
  if (manifest.web_accessible_resources?.length) err('web_accessible_resources must stay empty: it lets sites detect the extension');

  // strings the manifest asks for exist in the default locale
  const messages = JSON.parse(read('_locales/en/messages.json'));
  for (const match of JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)) if (!messages[match[1]]) err(`manifest uses __MSG_${match[1]}__ but _locales/en/messages.json has no "${match[1]}"`);
  if ((messages.app_description?.message || '').length > 132) err('app_description is longer than 132 characters (the store limit)');
  if ((messages.app_name?.message || '').length > 45) err('app_name is longer than 45 characters (the store limit)');
  for (const dirent of fs.readdirSync(path.join(extDir, '_locales'), { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    // Browsers only accept codes like "en" and "pt_BR" (underscore) as _locales folder names.
    if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(dirent.name)) err(`_locales/${dirent.name}: folder names look like "en" or "pt_BR"`);
    const file = `_locales/${dirent.name}/messages.json`;
    try {
      const data = JSON.parse(read(file));
      for (const key of Object.keys(messages)) if (!data[key]?.message) err(`${file}: missing "${key}"`);
      if ((data.app_description?.message || '').length > 132) err(`${file}: app_description is longer than 132 characters`);
    } catch (e) { err(`${file}: ${e.message}`); }
  }

  // ── referenced files ───────────────────────────────────────────────────────────────────────
  const refs = new Set();
  const addRef = (p) => { if (p) refs.add(p); };
  Object.values(manifest.icons || {}).forEach(addRef);
  Object.values(manifest.action?.default_icon || {}).forEach(addRef);
  addRef(manifest.action?.default_popup);
  addRef(manifest.background?.service_worker);
  addRef(manifest.options_ui?.page);
  (manifest.content_scripts || []).forEach((entry) => { (entry.js || []).forEach(addRef); (entry.css || []).forEach(addRef); });
  for (const ref of refs) if (!exists(ref)) err(`manifest references a file that does not exist: ${ref}`);

  // content scripts: unique files, shared namespace first, entry point last
  const scripts = manifest.content_scripts?.[0]?.js || [];
  if (new Set(scripts).size !== scripts.length) err('content_scripts lists a file twice');
  if (scripts[0] !== 'src/shared/namespace.js') err('src/shared/namespace.js must be the first content script');
  if (scripts.at(-1) !== 'src/content/main.js') err('src/content/main.js must be the last content script');

  // icons are real PNGs of the stated size
  for (const [size, rel] of Object.entries(manifest.icons || {})) {
    try {
      const buf = fs.readFileSync(path.join(extDir, rel));
      const isPng = buf.subarray(1, 4).toString() === 'PNG';
      if (!isPng || buf.readUInt32BE(16) !== Number(size) || buf.readUInt32BE(20) !== Number(size)) err(`${rel} is not a ${size}x${size} PNG`);
    } catch { /* missing file already reported */ }
  }

  // HTML pages reference existing scripts and styles
  const files = listRuntimeFiles(extDir);
  for (const rel of files.filter((f) => f.endsWith('.html'))) {
    const html = read(rel);
    for (const match of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
      const target = match[1];
      if (/^(https?:|data:|chrome-extension:)/.test(target)) { err(`${rel}: external or inline reference "${target}" is not allowed`); continue; }
      if (!/\.(js|css|png|svg)$/.test(target)) continue;
      if (!exists(path.posix.normalize(path.posix.join(path.posix.dirname(rel), target)))) err(`${rel}: "${target}" does not exist`);
    }
    if (/<script(?![^>]*\bsrc=)[^>]*>[^<]/i.test(html)) err(`${rel}: inline scripts are not allowed`);
    if (/\son\w+="/i.test(html)) err(`${rel}: inline event handlers are not allowed`);
  }

  // ── scripts parse, JSON parses, policy rules ───────────────────────────────────────────────
  const hostsSeen = new Map();
  for (const rel of files) {
    const text = fs.readFileSync(path.join(extDir, rel));
    if (FORBIDDEN_NAMES.test(path.basename(rel))) err(`forbidden file in the package: ${rel}`);
    if (rel.endsWith('.json')) { try { JSON.parse(text.toString('utf8')); } catch (e) { err(`${rel}: invalid JSON (${e.message})`); } continue; }
    if (!/\.(js|css|html)$/.test(rel)) continue;
    const source = text.toString('utf8');
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(source)) err(`${rel}: contains a private key`);
    if (rel.endsWith('.js')) {
      try { new vm.Script(source, { filename: rel }); } catch (e) { err(`${rel}: syntax error (${e.message})`); }
      if (/\beval\s*\(|new\s+Function\s*\(|document\.write\s*\(/.test(source)) err(`${rel}: eval, new Function and document.write are not allowed`);
      if (/\.(?:innerHTML|outerHTML)\s*\+?=|insertAdjacentHTML\s*\(|\.srcdoc\s*=/.test(source)) err(`${rel}: build elements with createElement/textContent, not HTML strings`);
      if (/importScripts\(\s*['"]https?:/.test(source) || /import\(\s*['"]https?:/.test(source)) err(`${rel}: remote code is not allowed`);
    }
    for (const match of source.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = match[1].toLowerCase();
      if (!hostsSeen.has(host)) hostsSeen.set(host, rel);
    }
  }
  for (const [host, rel] of hostsSeen) {
    if (!ALLOWED_HOSTS.has(host)) err(`${rel}: mentions an address that is not on the allowlist: ${host}`);
  }
  for (const rel of listRuntimeFiles(extDir)) if (rel.includes('..')) err(`bad path ${rel}`);

  // nothing in extension/ lies outside what the package includes
  const shipped = new Set(files);
  const walk = (dir) => fs.readdirSync(path.join(extDir, dir), { withFileTypes: true }).forEach((entry) => {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(rel); else if (!shipped.has(rel)) err(`extension/${rel} exists but is not part of the package (scripts/runtime-files.json)`);
  });
  walk('');

  // ── the repository's own scripts must parse too (a broken tool must not pass validation) ───
  for (const dir of ['scripts', 'tests', 'tools']) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    const sources = (d) => fs.readdirSync(path.join(base, d), { withFileTypes: true }).flatMap((entry) => {
      const rel = d ? `${d}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(rel);
      return /\.(mjs|js)$/.test(entry.name) ? [rel] : [];
    });
    for (const rel of sources('')) {
      const result = spawnSync(process.execPath, ['--check', path.join(base, rel)], { encoding: 'utf8' });
      if (result.status !== 0) err(`${dir}/${rel}: syntax error (${(result.stderr || '').split('\n').find((line) => /Error/.test(line)) || 'node --check failed'})`);
    }
  }

  // ── repository ─────────────────────────────────────────────────────────────────────────────
  // agent instruction files are allowed only in the development tree (recognised by technical-docs/); the public repository must never contain them
  const developmentTree = fs.existsSync(path.join(root, 'technical-docs'));
  for (const name of fs.readdirSync(root)) if (!ROOT_ALLOWED.has(name) && !(developmentTree && (name === 'CLAUDE.md' || name === '.claude'))) err(`unexpected file or folder in the repository root: ${name}`);
  const changelog = fs.existsSync(path.join(root, 'CHANGELOG.md')) ? fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8') : '';
  if (changelog && !new RegExp(`^## \\[?${manifest.version.replace(/\./g, '\\.')}\\]?`, 'm').test(changelog)) err(`CHANGELOG.md has no section for version ${manifest.version}`);

  notes.push(`version ${manifest.version}, ${files.length} package files, ${hostsSeen.size} distinct addresses mentioned`);
  return { errors, notes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, notes } = validate();
  notes.forEach((note) => console.log(note));
  if (errors.length) {
    console.error(`\n${errors.length} problem${errors.length === 1 ? '' : 's'} found:`);
    errors.forEach((message) => console.error(`  - ${message}`));
    process.exit(1);
  }
  console.log('validate: ok');
}
