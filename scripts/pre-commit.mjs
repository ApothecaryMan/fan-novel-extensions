#!/usr/bin/env node
/**
 * Pre-commit index sync guard.
 *
 * If any `extensions/*.js` is being committed (staged) but the corresponding
 * `dist/index.json` / `docs/index.json` manifest was not regenerated, this
 * rebuilds the index now so the app's extension list/versions never go stale.
 *
 * Detection: for each staged extension file, extract its `version:` field and
 * compare against the version recorded in dist/index.json. On mismatch (or if
 * dist/index.json is absent) the index is rebuilt via scripts/build-index.mjs.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const repo = process.cwd();
const indexFile = `${repo}/dist/index.json`;

function stagedFiles() {
  try {
    return execSync('git diff --cached --name-only --diff-filter=ACMR', {
      encoding: 'utf8',
      cwd: repo,
    })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function extVersion(file) {
  const p = `${repo}/${file}`;
  if (!existsSync(p)) return undefined;
  const src = readFileSync(p, 'utf8');
  const m = src.match(/version\s*:\s*['"]([^'"]+)['"]/);
  return m ? m[1] : undefined;
}

function manifestVersion(id) {
  try {
    const j = JSON.parse(readFileSync(indexFile, 'utf8'));
    const s = (j.extensions || []).find((e) => e.id === id);
    return s ? s.version : undefined;
  } catch {
    return undefined;
  }
}

const staged = stagedFiles();
const changed = staged.filter((f) => /^extensions\/[^/]+\.js$/.test(f));

if (changed.length === 0) {
  process.exit(0); // no extension source change -> nothing to sync
}

const stale = changed.filter((f) => {
  const id = f.replace(/^extensions\//, '').replace(/\.js$/, '');
  return extVersion(f) !== manifestVersion(id);
});

if (stale.length === 0) {
  process.exit(0); // manifest already in sync
}

console.warn(
  `pre-commit: extension source changed but index.json is stale for: ${stale.join(', ')}. Rebuilding signed index...`
);
try {
  execSync('npm run build:sign', { cwd: repo, stdio: 'inherit' });
  // Re-stage the regenerated manifest for this commit.
  execSync('git add dist/index.json docs/index.json dist/*.js docs/*.js', {
    cwd: repo,
    stdio: 'inherit',
  });
} catch (e) {
  console.error('pre-commit: failed to rebuild signed index', e);
  process.exit(1);
}
process.exit(0);