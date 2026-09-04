// Comprehensive tests for site:cenele extension.
// Uses REAL captured HTML/JSON from https://cenele.com (see fixtures/cenele-real and
// fixtures/cenele.js) so results mirror what users actually see — not fabricated markup.
// Regression coverage for:
//   - _parseAjaxJson handling every runtime response shape (the "only last 8 chapters"
//     bug: runtimes that return parsed JSON under .data, or as the response object
//     itself, used to fall back to the 8-chapter inline preview).
//   - fetchLatestChapters returning the truly NEWEST chapters (the live server ignores
//     the `order` param, so "newest" live on the LAST page, not order:desc page 1).
//   - parseChapterContent reading the real <novel-chapter> body (was grabbing the
//     reading-content WRAPPER and returning only nav text).

import { describe, it, expect, beforeAll } from 'vitest';
import { loadExtension, mockCtx, ok, mockCeneleCtx } from './helpers.js';
import {
  REAL_NOVEL_PAGE,
  REAL_HOME_PAGE,
  REAL_BROWSE_PAGE,
  REAL_SEARCH_PAGE,
  REAL_GENRE_PAGE,
  REAL_CHAPTER_PAGE,
  REAL_AJAX,
  REAL_NOVEL_URL,
  REAL_POST_ID,
  REAL_TOTAL,
  REAL_PER_PAGE,
} from './fixtures/cenele.js';

const ajaxJson = (o) => ({ ok: true, status: 200, text: JSON.stringify(o) });

// Serve the real admin-ajax chapter-list pages keyed by their `page` param.
function realChaptersAjaxHandler() {
  return (params) => {
    const action = params.get('action');
    if (action === 'nhv_manga_single_chapters_page') {
      const page = params.get('page') || '1';
      const payload = REAL_AJAX[Number(page)];
      if (!payload) return { ok: false, status: 404, text: '{}' };
      return ajaxJson(payload);
    }
    if (action === 'nhv_refresh_front_nonces') {
      return ajaxJson({ success: true, data: { chapters_nonce: 'a35c585ac7' } });
    }
    return { ok: false, status: 404, text: '{}' };
  };
}

let ext;

beforeAll(() => {
  ext = loadExtension('site.cenele.js');
});

// ──────────────────────────────────────────────────────────────────
// 1. Extension metadata
// ──────────────────────────────────────────────────────────────────
describe('Extension metadata', () => {
  it('has correct id', () => expect(ext.id).toBe('site:cenele'));
  it('has correct name', () => expect(ext.name).toBe('فضاء الروايات'));
  it('has correct lang', () => expect(ext.lang).toBe('ar'));
  it('has correct version', () => expect(ext.version).toBe('1.9.2'));
  it('has apiVersion 1', () => expect(ext.apiVersion).toBe(1));
  it('has correct baseUrl', () => expect(ext.baseUrl).toBe('https://cenele.com'));

  it('exposes all required methods', () => {
    const required = [
      'parseNovelInfo', 'parseChapterList', 'parseChapterContent',
      'searchNovels', 'getPopularNovels',
      'getCategories', 'getCategoryNovels', 'fetchLatestChapters',
    ];
    required.forEach((m) => expect(typeof ext[m]).toBe('function'));
  });
});

// ──────────────────────────────────────────────────────────────────
// 2. Small helpers
// ──────────────────────────────────────────────────────────────────
describe('_absUrl', () => {
  it('returns absolute unchanged', () => {
    expect(ext._absUrl('https://cenele.com/x')).toBe('https://cenele.com/x');
  });
  it('prepends base for /-prefixed', () => {
    expect(ext._absUrl('/cont/x/')).toBe('https://cenele.com/cont/x/');
  });
  it('prepends base with / for bare', () => {
    expect(ext._absUrl('cont/x/')).toBe('https://cenele.com/cont/x/');
  });
});

describe('_decodeEntities', () => {
  it('decodes named + numeric entities', () => {
    // `&nbsp;` maps to a plain space but numeric `&#160;` keeps NBSP; en-dash decoded.
    expect(ext._decodeEntities('a&#8211;b&nbsp;c&#160;')).toBe('a\u2013b c\u00a0');
  });
  it('leaves unknown unchanged', () => {
    expect(ext._decodeEntities('plain &amp; safe')).toBe('plain & safe');
  });
});

describe('_toLatinDigits', () => {
  it('converts Arabic-Indic + Extended digits and strips separators', () => {
    expect(ext._toLatinDigits('١٢٣')).toBe('123');
    expect(ext._toLatinDigits('٤٥٦')).toBe('456');
    expect(ext._toLatinDigits('1,234')).toBe('1234');
  });
});

describe('_stripChapterPrefix', () => {
  it('strips arabic + english prefixes', () => {
    expect(ext._stripChapterPrefix('الفصل 12 - شيء')).toBe('شيء');
    expect(ext._stripChapterPrefix('Chapter 3: Name')).toBe('Name');
  });
  it('strips الـ N prefix', () => {
    expect(ext._stripChapterPrefix('الفصل الـ 45')).toBe('');
  });
  it('strips quote wrappers', () => {
    expect(ext._stripChapterPrefix('"الإنتقال (2)"')).toBe('الإنتقال (2)');
  });
});

describe('_finalizeChapters', () => {
  it('sorts + formats Arabic titles + dedupes by url', () => {
    const out = ext._finalizeChapters([
      { url: 'b', number: 2, title: 'ثاني' },
      { url: 'a', number: 1, title: 'أول' },
      { url: 'a', number: 1, title: 'أول' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe('الفصل 1 - أول');
    expect(out[1].title).toBe('الفصل 2 - ثاني');
  });
  it('auto-generates missing numbers', () => {
    const out = ext._finalizeChapters([{ url: 'x', number: 0, title: 'بدون رقم' }]);
    expect(out[0].number).toBe(1);
  });
});

describe('_safeFetch', () => {
  it('returns response on success', async () => {
    const ctx = mockCtx({ '/x': ok('<h1>t</h1>') });
    const res = await ext._safeFetch('https://cenele.com/x', ctx, 'label');
    expect(res.ok).toBe(true);
  });
  it('throws labelled error on network failure', async () => {
    const ctx = { xFetch: async () => { throw new Error('boom'); } };
    await expect(ext._safeFetch('/x', ctx, 'فشل')).rejects.toThrow('فشل');
  });
});

// ──────────────────────────────────────────────────────────────────
// 3. _parseAjaxJson robustness (the "only last 8 chapters" root cause)
// ──────────────────────────────────────────────────────────────────
describe('_parseAjaxJson response shapes', () => {
  const real = REAL_AJAX[1]; // {success, html, total:928, per_page:100, ...} top-level
  it('parses .text (raw JSON string)', () => {
    const got = ext._parseAjaxJson({ ok: true, status: 200, text: JSON.stringify(real) });
    expect(got.total).toBe(REAL_TOTAL);
  });
  it('parses .json (pre-parsed object)', () => {
    const got = ext._parseAjaxJson({ ok: true, status: 200, json: real });
    expect(got.html).toBeTruthy();
    expect(got.total).toBe(REAL_TOTAL);
  });
  it('parses .body (pre-parsed object)', () => {
    const got = ext._parseAjaxJson({ ok: true, status: 200, body: real });
    expect(got.total).toBe(REAL_TOTAL);
  });
  it('parses .data (runtime that auto-decodes into data) — regression for 8-chapter bug', () => {
    const got = ext._parseAjaxJson({ ok: true, status: 200, data: real });
    expect(got.total).toBe(REAL_TOTAL);
    expect(got.html).toBeTruthy();
  });
  it('parses when the response object IS the decoded payload', () => {
    const got = ext._parseAjaxJson(Object.assign({ ok: true, status: 200 }, real));
    expect(got.total).toBe(REAL_TOTAL);
  });
  it('parses .data as a JSON string', () => {
    const got = ext._parseAjaxJson({ ok: true, status: 200, data: JSON.stringify(real) });
    expect(got.total).toBe(REAL_TOTAL);
  });
  it('returns default on garbage / anti-bot HTML', () => {
    expect(ext._parseAjaxJson({ ok: true, status: 200, text: '<html>challenge</html>' })).toEqual({});
  });
  it('returns default when res is null', () => {
    expect(ext._parseAjaxJson(null, { x: 1 })).toEqual({ x: 1 });
  });
});

// ──────────────────────────────────────────────────────────────────
// 4. parseNovelInfo (real page)
// ──────────────────────────────────────────────────────────────────
describe('parseNovelInfo (real novel page)', () => {
  const ctx = mockCtx({ 'the-creatures': ok(REAL_NOVEL_PAGE) });
  it('extracts title, cover, author, status, summary, source', async () => {
    const info = await ext.parseNovelInfo(REAL_NOVEL_URL, ctx);
    expect(info.source).toBe('site:cenele');
    expect(info.url).toContain('the-creatures');
    expect(info.title).toBeTruthy();
    expect(info.title).not.toContain('فضاء الروايات');
    expect(info.coverUrl).toMatch(/^https:\/\//);
    expect(info.author).toBeTruthy();
    expect(info.status).toBe('مستمرة');
    expect(info.summary).toBeTruthy();
    expect(info.summary.length).toBeGreaterThan(20);
  });
  it('throws on HTTP error', async () => {
    const bad = mockCtx({ '/nope': { ok: false, status: 404, text: '' } });
    await expect(ext.parseNovelInfo('/nope', bad)).rejects.toThrow('فشل');
  });
});

// ──────────────────────────────────────────────────────────────────
// 5. parseChapterList — real full list MUST be 928
// ──────────────────────────────────────────────────────────────────
describe('parseChapterList (real 928-chapter novel)', () => {
  it('fetches all 10 pages and returns all REAL chapters (not just the 8 inline)', async () => {
    const ctx = mockCeneleCtx({ 'the-creatures': ok(REAL_NOVEL_PAGE) }, realChaptersAjaxHandler());
    const chapters = await ext.parseChapterList(REAL_NOVEL_URL, ctx);
    // The real inline fallback is only 8; the lazy AJAX path must yield the full 928.
    expect(chapters.length).toBe(REAL_TOTAL);
    expect(chapters.length).toBeGreaterThan(100);
    const uniqueUrls = new Set(chapters.map((c) => c.url));
    expect(uniqueUrls.size).toBe(REAL_TOTAL);
    expect(chapters.every((c) => c.number > 0)).toBe(true);
    expect(chapters.every((c) => c.title.startsWith('الفصل '))).toBe(true);
    // Ascending by number
    for (let i = 1; i < chapters.length; i += 1) {
      expect(chapters[i].number).toBeGreaterThanOrEqual(chapters[i - 1].number);
    }
  });

  it('parses real uploadedAt as epoch numbers', async () => {
    const ctx = mockCeneleCtx({ 'the-creatures': ok(REAL_NOVEL_PAGE) }, realChaptersAjaxHandler());
    const chapters = await ext.parseChapterList(REAL_NOVEL_URL, ctx);
    const withDates = chapters.filter((c) => c.uploadedAt);
    expect(withDates.length).toBeGreaterThan(0);
    withDates.forEach((c) => expect(typeof c.uploadedAt).toBe('number'));
  });

  it('works even when the runtime returns AJAX under response.data (regression for 8-chapter bug)', async () => {
    const dataWrapped = (params) => {
      if (params.get('action') === 'nhv_manga_single_chapters_page') {
        const page = params.get('page') || '1';
        const payload = REAL_AJAX[Number(page)];
        return payload ? { ok: true, status: 200, data: payload } : { ok: false, status: 404, data: {} };
      }
      return { ok: true, status: 200, data: { success: true, data: { chapters_nonce: 'x' } } };
    };
    const ctx = mockCeneleCtx({ 'the-creatures': ok(REAL_NOVEL_PAGE) }, dataWrapped);
    const chapters = await ext.parseChapterList(REAL_NOVEL_URL, ctx);
    expect(chapters.length).toBe(REAL_TOTAL);
  });

  it('falls back to the real inline rows when AJAX is unusable', async () => {
    // Real inline fallback = the last ~8 chapters (918-925) in the captured page.
    const ctx = mockCeneleCtx({ 'the-creatures': ok(REAL_NOVEL_PAGE) }, () => ({ ok: true, status: 200, text: '{}' }));
    const chapters = await ext.parseChapterList(REAL_NOVEL_URL, ctx);
    expect(chapters.length).toBe(8);
    const nums = chapters.map((c) => c.number);
    expect(nums).toEqual([918, 919, 920, 921, 922, 923, 924, 925]);
  });

  it('sends admin-ajax as a REAL POST with nonce+page in the body (bridge contract regression)', async () => {
    // Earlier versions called ctx.xFetch({url, method, headers, body}) with ONE
    // object. The host runtime reads init from the SECOND argument, so those
    // requests went out as bare GETs with no body → HTTP 400 → 8-chapter fallback.
    // Pin the contract: xFetch(url, init) with method POST + form-encoded body.
    const seen = [];
    const spyHandler = (params, init) => {
      seen.push({ method: init.method, headers: init.headers, body: Object.fromEntries(params.entries()) });
      return { ok: true, status: 200, text: '{}' }; // empty html so crawl ends after page 1
    };
    await ext.parseChapterList(REAL_NOVEL_URL, mockCeneleCtx({ 'the-creatures': ok(REAL_NOVEL_PAGE) }, spyHandler));
    expect(seen.length).toBeGreaterThan(0);
    const first = seen[0];
    expect(first.method).toBe('POST');
    expect(first.headers['Content-Type']).toContain('application/x-www-form-urlencoded');
    expect(first.headers['X-Requested-With']).toBe('XMLHttpRequest');
    expect(first.headers.Origin).toBe('https://cenele.com');
    expect(first.headers.Referer).toBe('https://cenele.com/cont/the-creatures-that-we-are-riwya/');
    expect(first.body.action).toBe('nhv_manga_single_chapters_page');
    expect(first.body.manga_id).toBe('104602');
    expect(first.body.per_page).toBe('100');
    expect(first.body.page).toBe('1');
  });
});

// ──────────────────────────────────────────────────────────────────
// 6. fetchLatestChapters — newest chapters, NOT the oldest 100
// ──────────────────────────────────────────────────────────────────
describe('fetchLatestChapters (real data)', () => {
  it('returns the NEWEST chapters (last page), since the server ignores order=desc', async () => {
    const ctx = mockCeneleCtx({ 'the-creatures': ok(REAL_NOVEL_PAGE) }, realChaptersAjaxHandler());
    const latest = await ext.fetchLatestChapters(REAL_NOVEL_URL, 0, ctx);
    // Newest live on the LAST page (chapters ~901-928), not order:desc page-1 (1-100).
    const nums = latest.map((c) => c.number).sort((a, b) => a - b);
    expect(nums[0]).toBeGreaterThan(REAL_TOTAL - 40); // ~901+
    expect(nums[nums.length - 1]).toBe(9999999); // the max-number special chapter
    expect(latest.length).toBeLessThan(REAL_PER_PAGE); // 28, not 100
  });

  it('returns at least the inline 8 on AJAX failure', async () => {
    const ctx = mockCeneleCtx({ 'the-creatures': ok(REAL_NOVEL_PAGE) }, () => ({ ok: false, status: 500, text: '' }));
    const latest = await ext.fetchLatestChapters(REAL_NOVEL_URL, 0, ctx);
    expect(latest.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────
// 7. parseChapterContent — real <novel-chapter> body
// ──────────────────────────────────────────────────────────────────
describe('parseChapterContent (real chapter page)', () => {
  it('extracts the real narrative, not the reading-content wrapper nav', async () => {
    const ctx = mockCtx({ 'cenele.com/cont': ok(REAL_CHAPTER_PAGE) });
    const content = await ext.parseChapterContent('https://cenele.com/cont/the-creatures-that-we-are-riwya/x/1/', ctx);
    // Must contain the actual first line of prose from chapter 1.
    expect(content).toContain('مرت اثنتا عشرة سنة منذ أن انتقل غاو يانغ إلى هذا العالم');
    // Must NOT contain the wrapper/nav junk that the old regex captured.
    expect(content).not.toContain('صفحة الرواية');
    expect(content).not.toContain('المترجم');
    expect(content.length).toBeGreaterThan(1000);
  });
  it('strips the chapter-head metadata + translator credit', async () => {
    const ctx = mockCtx({ 'cenele.com/cont': ok(REAL_CHAPTER_PAGE) });
    const content = await ext.parseChapterContent('https://cenele.com/cont/the-creatures-that-we-are-riwya/x/1/', ctx);
    expect(content).not.toContain('المترجم :');
    expect(content).not.toContain('عدد الكلمات');
    expect(content).not.toContain('فصل من 928 فصل');
  });
  it('throws when the chapter body is missing', async () => {
    const ctx = mockCtx({ '/empty': ok('<html><body>no panel</body></html>') });
    await expect(ext.parseChapterContent('/empty', ctx)).rejects.toThrow('تعذر العثور على نص الفصل');
  });
});

// ──────────────────────────────────────────────────────────────────
// 8. Search / browse
// ──────────────────────────────────────────────────────────────────
describe('searchNovels (real pages)', () => {
  it('parses the real nhv-library-card grid from the browse page', async () => {
    const ctx = mockCtx({ '/cont/': ok(REAL_BROWSE_PAGE) });
    const results = await ext.searchNovels(null, 1, ctx);
    expect(results.length).toBe(10);
    expect(results[0].source).toBe('site:cenele');
    expect(results[0].url).toMatch(/^https:\/\//);
    expect(results[0].title).toBeTruthy();
  });
  it('extracts genres/tags + totalChapters from real cards', async () => {
    const ctx = mockCtx({ '/cont/': ok(REAL_BROWSE_PAGE) });
    const results = await ext.searchNovels(null, 1, ctx);
    const withTags = results.filter((r) => Array.isArray(r.tags) && r.tags.length > 0);
    expect(withTags.length).toBeGreaterThan(0);
    const withTotal = results.filter((r) => r.totalChapters);
    expect(withTotal.length).toBeGreaterThan(0);
  });
  it('deduplicates repeated cards by URL', async () => {
    const ctx = mockCtx({ '/cont/': ok(REAL_BROWSE_PAGE) });
    const results = await ext.searchNovels(null, 1, ctx);
    const urls = results.map((r) => r.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
  it('parses the real fallback rows from the search results page', async () => {
    const ctx = mockCtx({ '?s=': ok(REAL_SEARCH_PAGE) });
    const results = await ext.searchNovels('الحارس', 1, ctx);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].status).toBeTruthy();
  });
  it('returns empty on HTTP error', async () => {
    const bad = mockCtx({ '/cont/': { ok: false, status: 500, text: '' } });
    const results = await ext.searchNovels(null, 1, bad);
    expect(results).toEqual([]);
  });
});

describe('getPopularNovels (real browse)', () => {
  it('returns real cards in NovelResult shape', async () => {
    const ctx = mockCtx({ '/cont/': ok(REAL_BROWSE_PAGE) });
    const results = await ext.getPopularNovels(1, ctx);
    expect(results.length).toBe(10);
    ['url', 'title', 'source'].forEach((k) => expect(results[0]).toHaveProperty(k));
    expect(results[0].source).toBe('site:cenele');
  });
});

// ──────────────────────────────────────────────────────────────────
// 9. Categories (real browse page has a genres__collapse list)
// ──────────────────────────────────────────────────────────────────
describe('getCategories (real browse page)', () => {
  it('extracts genres from the real genres__collapse', async () => {
    const ctx = mockCtx({ '/cont/': ok(REAL_BROWSE_PAGE) });
    const cats = await ext.getCategories(ctx);
    // The real home/browse genre dropdown has 50 genres.
    expect(cats.length).toBeGreaterThan(0);
    expect(cats.every((c) => c.slug)).toBe(true);
    expect(cats.every((c) => c.name)).toBe(true);
    expect(cats.some((c) => c.slug === 'أكشن')).toBe(true);
  });
  it('deduplicates categories by slug', async () => {
    const ctx = mockCtx({ '/cont/': ok(REAL_BROWSE_PAGE) });
    const cats = await ext.getCategories(ctx);
    const slugs = cats.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
  it('returns empty on HTTP error', async () => {
    const bad = mockCtx({ '/cont/': { ok: false, status: 500, text: '' } });
    expect(await ext.getCategories(bad)).toEqual([]);
  });
});

describe('getCategoryNovels (real genre page)', () => {
  it('returns real nhv-library-card novels for a genre', async () => {
    const ctx = mockCtx({ 'cont-genre': ok(REAL_GENRE_PAGE) });
    const results = await ext.getCategoryNovels('مكتللة', 1, ctx);
    expect(results.length).toBe(10);
    expect(results[0].url).toMatch(/^https:\/\//);
    expect(results[0].status).toBeTruthy();
  });
  it('returns empty on HTTP error', async () => {
    const bad = mockCtx({ 'cont-genre': { ok: false, status: 500, text: '' } });
    expect(await ext.getCategoryNovels('مكتللة', 1, bad)).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// 10. _parseNhvCards
// ──────────────────────────────────────────────────────────────────
describe('_parseNhvCards', () => {
  it('parses real cards, dedupes, and sets source from this.id', () => {
    const results = ext._parseNhvCards(REAL_BROWSE_PAGE);
    expect(results.length).toBe(10);
    expect(new Set(results.map((r) => r.url)).size).toBe(results.length);
    expect(results[0].source).toBe('site:cenele');
  });
  it('returns empty for no cards', () => {
    expect(ext._parseNhvCards('<html><body>no cards</body></html>')).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// 11. Caching
// ──────────────────────────────────────────────────────────────────
describe('Caching', () => {
  it('caches the novel page across parseNovelInfo + parseChapterList (single fetch)', async () => {
    let fetchCount = 0;
    const ctx = {
      log: () => {},
      xFetch: async (input, init) => {
        if (init && typeof init === 'object') {
          return realChaptersAjaxHandler()(new URLSearchParams(init.body || ''));
        }
        if (typeof input === 'string' && input.includes('the-creatures')) {
          fetchCount += 1;
          return { ok: true, status: 200, text: REAL_NOVEL_PAGE };
        }
        return { ok: false, status: 404, text: '' };
      },
    };
    // Use a UNIQUE cache-busting URL so earlier cached copies of the shared novel page
    // don't hide the fetch-count assertion, and call BOTH methods with the SAME URL.
    const uniqueUrl = '/cont/the-creatures-that-we-are-riwya/?cache-bust=cache-test';
    await ext.parseNovelInfo(uniqueUrl, ctx);
    await ext.parseChapterList(uniqueUrl, ctx);
    expect(fetchCount).toBe(1);
  });
});
