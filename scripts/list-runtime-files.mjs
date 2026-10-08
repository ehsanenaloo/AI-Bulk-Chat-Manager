#!/usr/bin/env node
// Lists the files that go into the extension package (paths relative to extension/, one per line),
// as defined by scripts/runtime-files.json. Used by the build scripts and the release workflow.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function listRuntimeFiles(extensionDir = path.join(repoRoot, 'extension')) {
  const spec = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts', 'runtime-files.json'), 'utf8'));
  const out = [...spec.files];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(extensionDir, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Symbolic link not allowed in a runtime directory: ${rel}`);
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  for (const dir of spec.directories) walk(dir);
  return out.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${listRuntimeFiles().join('\n')}\n`);
}
