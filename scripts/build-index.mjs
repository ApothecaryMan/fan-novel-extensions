#!/usr/bin/env node
// ==========================================
// Build and optionally sign the extension index.
// Usage:
//   npm run build:sign   (signed with keys/private.key or $EXTENSION_SIGNING_KEY)
// ==========================================

import { ed25519 } from '@noble/curves/ed25519';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

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

// ---- Icon Resolver & Auto-scraper ----
async function resolveIcon(meta, idSuffix, extensionMtime, forceRefresh) {
  if (meta.icon) return meta.icon;

  // 1. Check existing local icon
  let localPath = null;
  let localRel = null;
  if (existsSync(ICONS_DIR)) {
    for (const ext of ['.png', '.jpg', '.webp', '.svg', '.ico']) {
      const file = join(ICONS_DIR, `${idSuffix}${ext}`);
      if (existsSync(file)) {
        localPath = file;
        localRel = `icons/${idSuffix}${ext}`;
        break;
      }
    }
  }

  // Check if extension was modified after the icon was generated
  const needsScrape = !localPath || forceRefresh || (localPath && extensionMtime > statSync(localPath).mtimeMs);
  if (!needsScrape || !meta.baseUrl) return localRel;

  // 2. Scrape from site baseUrl
  try {
    const rootUrl = meta.baseUrl.replace(/\/$/, '');
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36' };
    const res = await fetch(rootUrl, { headers, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return localRel;

    const html = await res.text();
    const linkTags = html.match(/<link\b[^>]+>/gi) || [];
    const candidates = [];

    for (const tag of linkTags) {
      if (/rel=["'][^"']*(?:icon|apple-touch-icon)[^"']*["']/i.test(tag)) {
        const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
        if (hrefMatch?.[1]) {
          try {
            const url = new URL(hrefMatch[1].trim(), rootUrl).toString();
            const sizeMatch = tag.match(/sizes=["'](\d+)x(\d+)["']/i);
            let score = /apple-touch-icon/i.test(tag) ? 150 : (sizeMatch ? parseInt(sizeMatch[1], 10) : 32);
            candidates.push({ url, score });
          } catch {}
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const iconUrl = candidates[0]?.url || `${rootUrl}/favicon.ico`;

    const imgRes = await fetch(iconUrl, { headers, signal: AbortSignal.timeout(6000) });
    if (!imgRes.ok) return localRel;

    const ct = (imgRes.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('text/html')) return localRel;

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    if (buffer.length < 50) return localRel;

    let ext = '.png';
    if (ct.includes('svg') || iconUrl.endsWith('.svg')) ext = '.svg';
    else if (ct.includes('webp') || iconUrl.endsWith('.webp')) ext = '.webp';
    else if (ct.includes('jpeg') || ct.includes('jpg') || iconUrl.endsWith('.jpg')) ext = '.jpg';
    else if (ct.includes('icon') || iconUrl.endsWith('.ico')) ext = '.ico';

    mkdirSync(ICONS_DIR, { recursive: true });
    const savedName = `${idSuffix}${ext}`;
    const savePath = join(ICONS_DIR, savedName);
    writeFileSync(savePath, buffer);

    // Constrain to 96x96 (<= 100x100) if image tool is present
    if (['.png', '.jpg', '.webp'].includes(ext)) {
      try {
        execSync(`magick "${savePath}" -resize '96x96>' -strip "${savePath}" 2>/dev/null || convert "${savePath}" -resize '96x96>' -strip "${savePath}" 2>/dev/null`);
      } catch {}
    }

    console.log(`  🌐 Scraped favicon for ${idSuffix} -> icons/${savedName}`);
    return `icons/${savedName}`;
  } catch {
    return localRel;
  }
}

// ---- Main Build ----
async function main() {
  const sign = process.argv.includes('--sign');
  const forceRefresh = process.argv.includes('--refresh-icons');

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
    const fileMtime = statSync(filePath).mtimeMs;
    const icon = await resolveIcon(meta, idSuffix, fileMtime, forceRefresh);

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
