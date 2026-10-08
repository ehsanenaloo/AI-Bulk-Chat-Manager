import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const extensionDir = process.env.EXTENSION_DIR ? path.resolve(process.env.EXTENSION_DIR) : path.join(repoRoot, 'extension');
