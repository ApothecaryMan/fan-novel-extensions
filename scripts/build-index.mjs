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
  existsSync
} from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EXTENSIONS_DIR = join(ROOT, 'extensions');
const DIST_DIR = join(ROOT, 'dist');
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
    for (const key of ['id', 'name', 'lang', 'version', 'baseUrl']) {
      const m = code.match(FIELD_RE(key));
      if (m) meta[key] = m[1];
    }
    const apiMatch = code.match(/apiVersion\s*:\s*(\d+)/);
    if (apiMatch) meta.apiVersion = apiMatch[1];
  }

  return meta;
}

// ---- Main ----

function main() {
  const sign = process.argv.includes('--sign');

  if (!existsSync(EXTENSIONS_DIR)) {
    console.error('❌ No extensions/ directory found. Create it and add .js extension files.');
    process.exit(1);
  }

  mkdirSync(DIST_DIR, { recursive: true });

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

    // Copy to dist/
    copyFileSync(filePath, join(DIST_DIR, file));

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

    entries.push(entry);
    console.log(`  ✅ ${meta.id} v${meta.version} (${bytes.length} bytes)`);
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

  mkdirSync(DOCS_DIR, { recursive: true });
  for (const file of files) {
    copyFileSync(join(EXTENSIONS_DIR, file), join(DOCS_DIR, file));
  }

  writeFileSync(join(DIST_DIR, 'index.json'), JSON.stringify(output, null, 2));
  writeFileSync(join(DOCS_DIR, 'index.json'), JSON.stringify(output, null, 2));
  writeFileSync(join(DIST_DIR, '.nojekyll'), '# Disable Jekyll\n');
  writeFileSync(join(DOCS_DIR, '.nojekyll'), '# Disable Jekyll\n');
  console.log(`📄 dist/index.json & docs/index.json written`);
  console.log(`📦 ${entries.length} extension(s) ready`);
}

main();
