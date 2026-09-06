#!/usr/bin/env node
// ==========================================
// Build and optionally sign the extension index.
// Usage:
//   npm run build:sign   (signed with keys/private.key or $EXTENSION_SIGNING_KEY)
// ==========================================

import { ed25519 } from '@noble/curves/ed25519';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSIONS_DIR = join(ROOT, 'extensions');
const ICONS_DIR = join(ROOT, 'icons');
const DOCS_DIR = join(ROOT, 'docs');
const KEYS_DIR = join(ROOT, 'keys');

// ---- Canonical JSON (RFC 8785 subset) ----
function canonicalStringify(val) {
  if (val === null || typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) return '[' + val.map(canonicalStringify).join(',') + ']';
  return '{' + Object.keys(val).sort().map(k => JSON.stringify(k) + ':' + canonicalStringify(val[k])).join(',') + '}';
}

// ---- Metadata parser ----
function parseHeader(code) {
  const meta = {};
  const headerRe = /^\/\/\s*@(\w+)\s+(.+)$/gm;
  let match;
  while ((match = headerRe.exec(code)) !== null) {
    meta[match[1].trim()] = match[2].trim();
  }
  if (!meta.id) {
    for (const k of ['id', 'name', 'lang', 'version', 'baseUrl', 'icon']) {
      const m = code.match(new RegExp(`${k}\\s*:\\s*['"]([^'"]+)['"]`));
      if (m) meta[k] = m[1];
    }
    const apiMatch = code.match(/apiVersion\s*:\s*(\d+)/);
    if (apiMatch) meta.apiVersion = apiMatch[1];
  }
  return meta;
}

// ---- Icon Resolver ----
function resolveIcon(meta, idSuffix) {
  if (meta.icon) return meta.icon;

  if (existsSync(ICONS_DIR)) {
    for (const ext of ['.png', '.jpg', '.webp', '.svg', '.ico']) {
      const file = join(ICONS_DIR, `${idSuffix}${ext}`);
      if (existsSync(file)) {
        return `icons/${idSuffix}${ext}`;
      }
    }
  }

  return null;
}

// ---- Main Build ----
async function main() {
  const sign = process.argv.includes('--sign');

  if (!existsSync(EXTENSIONS_DIR)) {
    console.error('❌ No extensions/ directory found.');
    process.exit(1);
  }

  mkdirSync(DOCS_DIR, { recursive: true });
  const files = readdirSync(EXTENSIONS_DIR).filter(f => f.endsWith('.js'));
  const entries = [];

  for (const file of files) {
    const filePath = join(EXTENSIONS_DIR, file);
    const code = readFileSync(filePath, 'utf-8');
    const bytes = Buffer.from(code, 'utf-8');
    const meta = parseHeader(code);

    if (!meta.id?.startsWith('site:') || !meta.version) {
      console.error(`❌ ${file}: missing valid @id or @version`);
      process.exit(1);
    }

    copyFileSync(filePath, join(DOCS_DIR, file));

    const idSuffix = meta.id.replace(/^site:/, '');
    const icon = resolveIcon(meta, idSuffix);

    const entry = {
      id: meta.id,
      name: meta.name || meta.id,
      lang: meta.lang || 'ar',
      version: meta.version,
      apiVersion: parseInt(meta.apiVersion || '1', 10),
      size: bytes.length,
      sha256: createHash('sha256').update(code, 'utf-8').digest('hex'),
      url: file,
      ...(meta.baseUrl ? { baseUrl: meta.baseUrl } : {}),
      ...(icon ? { icon } : {})
    };

    entries.push(entry);
    console.log(`  ✅ ${meta.id} v${meta.version} (${bytes.length} bytes)${entry.icon ? ` [icon: ${entry.icon}]` : ''}`);
  }

  const index = {
    schemaVersion: 1,
    generatedAt: Date.now(),
    extensions: entries
  };

  let signature = 'unsigned-dev';
  if (sign) {
    const keyFile = join(KEYS_DIR, 'private.key');
    const privHex = process.env.EXTENSION_SIGNING_KEY || (existsSync(keyFile) ? readFileSync(keyFile, 'utf-8').trim() : null);
    if (!privHex) {
      console.error('❌ No signing key found in keys/private.key or $EXTENSION_SIGNING_KEY');
      process.exit(1);
    }
    const canonical = new TextEncoder().encode(canonicalStringify(index));
    const sigBytes = ed25519.sign(canonical, Buffer.from(privHex, 'hex'));
    signature = Buffer.from(sigBytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    console.log(`\n🔏 Index signed (${entries.length} extensions)`);
  } else {
    console.log(`\n⚠️  Index NOT signed (dev mode). Use --sign for production.`);
  }

  // Copy icons to docs/icons
  if (existsSync(ICONS_DIR)) {
    const docsIcons = join(DOCS_DIR, 'icons');
    mkdirSync(docsIcons, { recursive: true });
    for (const icon of readdirSync(ICONS_DIR)) {
      copyFileSync(join(ICONS_DIR, icon), join(docsIcons, icon));
    }
  }

  writeFileSync(join(DOCS_DIR, 'index.json'), JSON.stringify({ ...index, signature }, null, 2));
  writeFileSync(join(DOCS_DIR, '.nojekyll'), '# Disable Jekyll\n');
  console.log(`📄 docs/index.json written (${entries.length} extensions ready)`);
}

main();
