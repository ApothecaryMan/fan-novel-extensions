#!/usr/bin/env node
// Generate extensions/site.gutenberg.js from the official Project Gutenberg CSV feed.
// Usage: npm run build:catalog

import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { get as httpsGet } from 'node:https';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(ROOT, 'scripts', 'gutenberg-extension.template.js');
const OUT = join(ROOT, 'extensions', 'site.gutenberg.js');
const CATALOG_CSV = 'https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv.gz';
const TOP_PAGE = 'https://www.gutenberg.org/browse/scores/top';
const LIMIT = 2000;

const FALLBACK_TOP_IDS = [
  2701, 1342, 1727, 2641, 2554, 65238, 3268, 1513, 2465, 2868,
  1661, 67979, 1260, 34413, 59828, 62215, 1695, 345, 11, 5197,
  21839, 601, 43, 6133, 84, 1400, 2600, 174, 120, 16,
  113, 768, 158, 161, 105, 121, 141, 45, 55, 236,
  1952, 5200, 1232, 1497
];

const LITERARY_RE = /fiction|novel|literature|short stories|poetry|drama|romance|adventure|mystery|fantasy|horror|fairy tales|folklore/i;
const EXCLUDE_TITLE_RE = /\b(bible|book of mormon|quran|koran|talmud)\b/i;

const TAGS = [
  ['fiction', /\bfiction\b/i],
  ['poetry', /\bpoetry\b/i],
  ['drama', /\bdrama\b/i],
  ['adventure', /\badventure\b/i],
  ['mystery', /\bmystery\b/i],
  ['romance', /\bromance\b/i],
  ['fantasy', /\bfantasy\b/i],
  ['horror', /\bhorror\b/i],
  ['short-stories', /\bshort stories\b/i],
  ['fairy-tales', /\bfairy tales\b/i],
  ['folklore', /\bfolklore\b/i],
  ['philosophy', /\bphilosophy\b/i],
  ['history', /\bhistory\b/i]
];

function download(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, {
      family: 4,
      headers: { 'User-Agent': 'FanNovelExtensions/1.0 (catalog build)' },
      timeout: 120000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).toString(), redirects - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`Timed out: ${url}`)));
    req.on('error', reject);
  });
}

async function fetchBuffer(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await download(url);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

async function fetchText(url) {
  return (await download(url)).toString('utf8');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizeAuthor(raw) {
  const first = String(raw || '').split(';')[0].trim();
  if (!first) return '';
  const parts = first.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return first;
  if (/^\d/.test(parts[1]) || /\b(?:BCE|CE|B\.C\.|A\.D\.|century|active|fl\.|d\.|ca\.)\b/i.test(parts[1])) {
    return parts[0];
  }
  return `${parts[1]} ${parts[0]}`.replace(/\s+/g, ' ').trim();
}

function normalizeTitle(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

function tagsFromText(text) {
  const tags = [];
  for (const [slug, re] of TAGS) {
    if (re.test(text)) tags.push(slug);
  }
  return tags.slice(0, 4);
}

async function main() {
  console.log('⬇️  Downloading Project Gutenberg catalog…');
  const gz = await fetchBuffer(CATALOG_CSV);
  const csv = gunzipSync(gz).toString('utf8');
  console.log(`   ${(csv.length / 1024 / 1024).toFixed(1)} MB decompressed`);

  let pageIds = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const top = await fetchText(TOP_PAGE);
      pageIds = [...new Set([...top.matchAll(/href="\/ebooks\/(\d+)"/g)].map((m) => Number(m[1])))];
      break;
    } catch (error) {
      if (attempt === 3) {
        console.warn(`⚠️  Top page unavailable (${error.message}); using fallback popularity list`);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  const topIds = [...new Set([...pageIds, ...FALLBACK_TOP_IDS])];
  console.log(`   ${pageIds.length} IDs from the Top 100 page, ${topIds.length} ranked`);
  const rank = new Map(topIds.map((id, index) => [id, index]));

  const rows = parseCsv(csv);
  const header = rows[0].map((name, index) => (index === 0 ? name.replace(/^\uFEFF/, '') : name));
  const data = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length < header.length) continue;
    const row = {};
    for (let h = 0; h < header.length; h++) row[header[h]] = rows[i][h] || '';
    if (row.Type !== 'Text') continue;
    if (!row.Language.split(';').map((lang) => lang.trim()).includes('en')) continue;
    const blob = `${row.Subjects} ${row.Bookshelves}`;
    if (!LITERARY_RE.test(blob)) continue;
    const title = normalizeTitle(row.Title);
    if (!title || EXCLUDE_TITLE_RE.test(title)) continue;
    const id = parseInt(row['Text#'], 10);
    if (!id) continue;
    data.push({
      rank: rank.has(id) ? rank.get(id) : Number.MAX_SAFE_INTEGER,
      id,
      title,
      author: normalizeAuthor(row.Authors),
      tags: tagsFromText(blob)
    });
  }

  data.sort((a, b) => a.rank - b.rank || a.id - b.id);
  const selected = data.slice(0, LIMIT);
  const catalog = selected.map((book) => [book.id, book.title, book.author, book.tags]);

  const template = readFileSync(TEMPLATE, 'utf8');
  const code = template
    .replace('/*__GENERATED_AT__*/0', String(Date.now()))
    .replace('/*__CATALOG__*/[]', JSON.stringify(catalog));

  writeFileSync(OUT, code);
  const rawBytes = Buffer.byteLength(JSON.stringify(catalog));
  console.log(`✅ ${selected.length} books → ${OUT}`);
  console.log(`   catalog ${(rawBytes / 1024).toFixed(1)} KB raw, ${(gzipSync(Buffer.from(JSON.stringify(catalog))).length / 1024).toFixed(1)} KB gzip`);
  console.log(`   extension ${(Buffer.byteLength(code) / 1024).toFixed(1)} KB`);
}

main().catch((error) => {
  console.error(`❌ ${error.stack || error.message}`);
  process.exit(1);
});
