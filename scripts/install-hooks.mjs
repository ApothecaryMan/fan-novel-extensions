#!/usr/bin/env node
/**
 * Install the repo pre-commit hook (local, non-versioned .git/hooks).
 * Copies the tracked script into .git/hooks/pre-commit so the manifest-staleness
 * guard runs on every commit. The script carries its own node shebang, so it is
 * used directly as the hook. Wired into package.json "postinstall" so `npm install`
 * recreates it automatically after a fresh clone.
 */
import { copyFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'scripts', 'pre-commit.mjs');
const hooksDir = join(root, '.git', 'hooks');
const dst = join(hooksDir, 'pre-commit');

try {
  mkdirSync(hooksDir, { recursive: true });
  copyFileSync(src, dst);
  chmodSync(dst, 0o755);
  console.log('pre-commit hook installed:', dst);
} catch (e) {
  console.warn('pre-commit hook not installed:', e.message);
}