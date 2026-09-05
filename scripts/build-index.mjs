#!/usr/bin/env node
// ==========================================
// Build (and optionally sign) the extension index.
//
// Usage:
//   npm run build          ← builds dist/index.json (unsigned, for local dev)
//   npm run build:sign     ← builds + signs with keys/private.key or $EXTENSION_SIGNING_KEY
//
// For each .js file in extensions/:
//   1. Reads a YAML-like header comment to extract metadata
//   2. Computes sha256 + size
//   3. Copies the file to dist/
//   4. Adds an entry to the index
//
// Extension .js files MUST have a header block like:
//   // @id       site:rwaya
//   // @name     روايه
//   // @version  1.0.0
//   // @lang     ar
//   // @apiVersion 1
//   // @baseUrl  https://rwaya.com
// ==========================================

import { ed25519 } from '@noble/curves/ed25519';
import { createHash } from 'node:crypto';
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  statSync,
  unlinkSync
} from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EXTENSIONS_DIR = join(ROOT, 'extensions');
const ICONS_DIR = join(ROOT, 'icons');
const DOCS_DIR = join(ROOT, 'docs');
const KEYS_DIR = join(ROOT, 'keys');

// ---- Canonical JSON (must match the mobile app's canonicalJson.ts) ----

function escapeString(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (code < 0x20) out += '\\u' + code.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

function canonicalStringify(value) {
  if (value === null || value === undefined) return 'null';
  const t = typeof value;
  if (t === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'string') return escapeString(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']';
  if (t === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => escapeString(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
  }
  return 'null';
}

function bytesToBase64Url(bytes) {
  const b64 = Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// ---- Metadata extractor ----
// Supports two formats:
//   1. YAML-like header comments:  // @id site:foo
//   2. registerExtension({ id: 'site:foo', ... })  — regex extraction

const FIELD_RE = (k) => new RegExp(`${k}\\s*:\\s*['"]([^'"]+)['"]`);

function parseHeader(code) {
  const meta = {};

  // Try YAML-like header comments first
  const headerRe = /^\/\/\s*@(\w+)\s+(.+)$/gm;
  let match;
  while ((match = headerRe.exec(code)) !== null) {
    meta[match[1].trim()] = match[2].trim();
  }

  // If no header comments found, extract from registerExtension({...})
  if (!meta.id) {
    for (const key of ['id', 'name', 'lang', 'version', 'baseUrl', 'icon']) {
      const m = code.match(FIELD_RE(key));
      if (m) meta[key] = m[1];
    }
    const apiMatch = code.match(/apiVersion\s*:\s*(\d+)/);
    if (apiMatch) meta.apiVersion = apiMatch[1];
  }

  return meta;
}

async function fetchFaviconForBaseUrl(baseUrl, idSuffix) {
  if (!baseUrl) return null;
  try {
    const rootUrl = baseUrl.replace(/\/$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    const res = await fetch(rootUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    let iconCandidateUrl = null;

    if (res.ok) {
      const html = await res.text();
      // Look for icon tags in HTML: rel="icon", rel="shortcut icon", rel="apple-touch-icon"
      const match = html.match(/<link[^>]+rel=['"][^'"]*(?:icon|apple-touch-icon)[^'"]*['"][^>]+href=['"]([^'"]+)['"]/i) ||
                    html.match(/<link[^>]+href=['"]([^'"]+)['"][^>]+rel=['"][^'"]*(?:icon|apple-touch-icon)[^'"]*['"]/i);
      if (match && match[1]) {
        const rawHref = match[1].trim();
        try {
          iconCandidateUrl = new URL(rawHref, rootUrl).toString();
        } catch {
          iconCandidateUrl = null;
        }
      }
    }

    // Fallback to /favicon.ico if no link tag found
    if (!iconCandidateUrl) {
      iconCandidateUrl = `${rootUrl}/favicon.ico`;
    }

    // Download the candidate icon
    const imgCtrl = new AbortController();
    const imgTimeout = setTimeout(() => imgCtrl.abort(), 6000);
    const imgRes = await fetch(iconCandidateUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      signal: imgCtrl.signal
    });
    clearTimeout(imgTimeout);

    if (imgRes.ok) {
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      if (buffer.length > 50) { // sanity check
        // Determine extension from content-type or candidate url
        const contentType = (imgRes.headers.get('content-type') || '').toLowerCase();
        let ext = '.png';
        if (contentType.includes('svg') || iconCandidateUrl.endsWith('.svg')) ext = '.svg';
        else if (contentType.includes('webp') || iconCandidateUrl.endsWith('.webp')) ext = '.webp';
        else if (contentType.includes('jpeg') || contentType.includes('jpg') || iconCandidateUrl.endsWith('.jpg')) ext = '.jpg';
        else if (contentType.includes('icon') || iconCandidateUrl.endsWith('.ico')) ext = '.ico';

        mkdirSync(ICONS_DIR, { recursive: true });
        const savedFileName = `${idSuffix}${ext}`;
        const savePath = join(ICONS_DIR, savedFileName);
        writeFileSync(savePath, buffer);
        console.log(`  🌐 Scraped favicon for ${idSuffix} -> icons/${savedFileName} (${buffer.length} bytes)`);
        return `icons/${savedFileName}`;
      }
    }
  } catch (err) {
    // Network or scraping failed, return null to gracefully use fallback
  }
  return null;
}

// ---- Main ----

async function main() {
  const sign = process.argv.includes('--sign');
  const forceRefreshIcons = process.argv.includes('--refresh-icons');

  if (!existsSync(EXTENSIONS_DIR)) {
    console.error('❌ No extensions/ directory found. Create it and add .js extension files.');
    process.exit(1);
  }

  mkdirSync(DOCS_DIR, { recursive: true });

  const files = readdirSync(EXTENSIONS_DIR).filter(f => f.endsWith('.js'));
  if (files.length === 0) {
    console.warn('⚠️  No .js files found in extensions/');
  }

  const entries = [];

  for (const file of files) {
    const filePath = join(EXTENSIONS_DIR, file);
    const code = readFileSync(filePath, 'utf-8');
    const bytes = Buffer.from(code, 'utf-8');
    const meta = parseHeader(code);

    // Validate required fields
    if (!meta.id || !meta.id.startsWith('site:')) {
      console.error(`❌ ${file}: missing or invalid @id (must start with "site:")`);
      process.exit(1);
    }
    if (!meta.version) {
      console.error(`❌ ${file}: missing @version`);
      process.exit(1);
    }

    const sha256 = createHash('sha256').update(code, 'utf-8').digest('hex');

    // Copy to docs/
    copyFileSync(filePath, join(DOCS_DIR, file));

    const entry = {
      id: meta.id,
      name: meta.name || meta.id,
      lang: meta.lang || 'ar',
      version: meta.version,
      apiVersion: parseInt(meta.apiVersion || '1', 10),
      size: bytes.length,
      sha256,
      url: file
    };
    if (meta.baseUrl) entry.baseUrl = meta.baseUrl;

    // Determine icon: from meta.icon, or auto-scraped for idSuffix
    const idSuffix = meta.id.replace(/^site:/, '');
    let iconFile = meta.icon;

    // Check if we already have an existing local icon for this extension
    let existingIconPath = null;
    if (existsSync(ICONS_DIR)) {
      for (const ext of ['.png', '.jpg', '.webp', '.svg', '.ico']) {
        const candidate = join(ICONS_DIR, `${idSuffix}${ext}`);
        if (existsSync(candidate)) {
          existingIconPath = candidate;
          iconFile = `icons/${idSuffix}${ext}`;
          break;
        }
      }
    }

    // If extension was modified/updated:
    // Check if extension file mtime is newer than existing icon, or previous index entry differed
    const fileStat = statSync(filePath);
    let shouldRefresh = forceRefreshIcons;

    if (!shouldRefresh && existingIconPath) {
      try {
        const iconStat = statSync(existingIconPath);
        // If extension file was touched/updated after icon was created, refresh the icon!
        if (fileStat.mtimeMs > iconStat.mtimeMs) {
          shouldRefresh = true;
        }
      } catch {
        shouldRefresh = true;
      }
    }

    if (!iconFile || shouldRefresh) {
      if (meta.baseUrl) {
        const refreshed = await fetchFaviconForBaseUrl(meta.baseUrl, idSuffix);
        if (refreshed) {
          iconFile = refreshed;
        }
      }
    }

    if (iconFile) entry.icon = iconFile;

    entries.push(entry);
    console.log(`  ✅ ${meta.id} v${meta.version} (${bytes.length} bytes)${entry.icon ? ` [icon: ${entry.icon}]` : ''}`);
  }

  const index = {
    schemaVersion: 1,
    generatedAt: Date.now(),
    extensions: entries
  };

  let output;

  if (sign) {
    // Load private key from env or file
    let privHex = process.env.EXTENSION_SIGNING_KEY;
    if (!privHex) {
      const keyFile = join(KEYS_DIR, 'private.key');
      if (existsSync(keyFile)) {
        privHex = readFileSync(keyFile, 'utf-8').trim();
      }
    }
    if (!privHex) {
      console.error('❌ No signing key found. Set EXTENSION_SIGNING_KEY env or run: npm run generate-keys');
      process.exit(1);
    }

    const privateKey = Buffer.from(privHex, 'hex');
    const canonical = new TextEncoder().encode(canonicalStringify(index));
    const signature = ed25519.sign(canonical, privateKey);
    const signatureB64 = bytesToBase64Url(signature);

    output = { ...index, signature: signatureB64 };
    console.log(`\n🔏 Index signed (${entries.length} extensions)`);
  } else {
    output = { ...index, signature: 'unsigned-dev' };
    console.log(`\n⚠️  Index NOT signed (dev mode). Use --sign for production.`);
  }

  // Copy icons to docs/icons if ICONS_DIR exists
  if (existsSync(ICONS_DIR)) {
    const docsIcons = join(DOCS_DIR, 'icons');
    mkdirSync(docsIcons, { recursive: true });

    const iconFiles = readdirSync(ICONS_DIR);
    for (const icon of iconFiles) {
      copyFileSync(join(ICONS_DIR, icon), join(docsIcons, icon));
    }
    console.log(`🖼️  Copied ${iconFiles.length} icon(s) to docs/icons`);
  }

  writeFileSync(join(DOCS_DIR, 'index.json'), JSON.stringify(output, null, 2));
  writeFileSync(join(DOCS_DIR, '.nojekyll'), '# Disable Jekyll\n');
  console.log(`📄 docs/index.json written`);
  console.log(`📦 ${entries.length} extension(s) ready`);
}

main();
