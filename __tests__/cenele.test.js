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
  it('has correct version', () => expect(ext.version).toBe('1.12.0'));
  it('has apiVersion 2', () => expect(ext.apiVersion).toBe(2));
  it('has correct baseUrl', () => expect(ext.baseUrl).toBe('https://cenele.com'));

  it('exposes all required methods', () => {
    const required = [
      'parseNovelInfo', 'parseChapterList', 'parseChapterContent',
      'searchNovels', 'getPopularNovels',
      'getCategories', 'getCategoryNovels', 'fetchLatestChapters',
      'getComments', 'getCommentCount', 'getCommentReplies', 'postComment', 'voteComment',
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
  it('extracts TRUE total views (المشاهدات), not rating count', async () => {
    const info = await ext.parseNovelInfo(REAL_NOVEL_URL, ctx);
    // Real page: <span>المشاهدات</span><strong>114٬616</strong>, rating count is only 407.
    expect(info.readersCount).toBe('114616');
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

// ──────────────────────────────────────────────────────────────────
// RSP chapter comments (read-only)
// ──────────────────────────────────────────────────────────────────
describe('getComments (RSP)', () => {
  const CHAPTER_HTML =
    '<div class="nhv-inline-comments"><div class="rspc-wrap rspc-rtl" ' +
    'data-entity-key="chapter:115766:الفصل-40" data-post-id="115766"></div></div>' +
    '<script id="rspc-front-js-extra">var RSPC = {"ajaxUrl":"https://cenele.com/wp-admin/admin-ajax.php",' +
    '"nonce":"11549b02df","isLogged":"","perPage":"10"}</script>';

  const cardTop = (id, author, time, body, likes) =>
    '<div class="rspc-comment" data-id="' + id + '">' +
    '<div class="rspc-comment__head"><span class="rspc-comment__author">' + author + '</span>' +
    // Chrome that must NEVER surface as attachments: avatar + XP level badge.
    '<img class="rspc-avatar__img" src="https://cenele.com/avatar/u1.png" />' +
    '<span class="rspc-user__level"><img class="nhv-xpl-badge-chip__img" src="https://cenele.com/badges/medal-gold.png" /></span>' +
    '<span class="rspc-comment__time">' + time + '</span></div>' +
    '<div class="rspc-comment__text"><p>' + body + '</p></div>' +
    '<div class="rspc-actions-inline"><button class="rspc-vote rspc-vote--like" data-comment-id="' + id + '" data-vote="like">' +
    '<span class="rspc-like-count">' + likes + '</span></button></div></div>';

  const cardReply = (id, author, body) =>
    '<div class="rspc-reply-item" data-id="' + id + '">' +
    '<span class="rspc-reply-item__author">' + author + '</span>' +
    '<div class="rspc-reply-item__text"><p>ردًا على <a href="#comment-101">قارئ</a>.</p><p>' + body + '</p></div></div>';

  const PAGE1 = JSON.stringify({
    success: true,
    data: {
      // Top-level card 101 embeds reply 102 inline; card 103 has an image.
      html:
        cardTop('101', 'قارئ', 'منذ ساعتين', 'تعليق رائع', '5').replace('</div></div>',
          cardReply('102', 'المترجم', 'شكرا لك') + '</div></div>') +
        '<div class="rspc-comment" data-id="103">' +
        '<span class="rspc-comment__author">زائر</span>' +
        '<div class="rspc-comment__text"><p>صورة مرفقة</p></div>' +
        '<div class="rspc-comment__images"><img src="https://cenele.com/wp-content/uploads/pic.jpg" /></div>' +
        '<span class="rspc-like-count">0</span></div>',
      total: 3, newOffset: 2, hasMore: true
    }
  });

  const PAGE2 = JSON.stringify({
    success: true,
    data: {
      html: cardTop('104', 'قارئ2', '2026-08-20', 'الأخير', '1'),
      total: 3, newOffset: 3, hasMore: false
    }
  });

  const commentCtx = () => mockCtx({
    'ch-test-40/': ok(CHAPTER_HTML),
    'admin-ajax.php': (url, init) => {
      const body = String((init && init.body) || '');
      expect(body).toContain('action=rspc_load_more');
      expect(body).toContain('entity_key=chapter');
      if (body.includes('offset=0')) return ok(PAGE1);
      return ok(PAGE2);
    }
  });

  it('paginates load_more and threads replies with likes/images', async () => {
    const res = await ext.getComments('https://cenele.com/ch-test-40/', commentCtx());
    expect(res.count).toBe(3);
    expect(res.comments.length).toBe(4);
    const top = res.comments.find((c) => c.id === '101');
    expect(top.author).toBe('قارئ');
    expect(top.likes).toBe(5);
    expect(top.parentId).toBeNull();
    expect(top.images).toBeUndefined();
    const reply = res.comments.find((c) => c.id === '102');
    expect(reply.parentId).toBe('101');
    expect(reply.body).toBe('شكرا لك');
    expect(reply.body).not.toContain('ردًا على');
    const img = res.comments.find((c) => c.id === '103');
    expect(img.images).toEqual(['https://cenele.com/wp-content/uploads/pic.jpg']);
    expect(typeof res.comments[0].createdAt).toBe('number');
  });

  it('getCommentCount returns the load_more total without parsing comments', async () => {
    let loadMoreCalls = 0;
    const ctx = mockCtx({
      'ch-test-40/': ok(CHAPTER_HTML),
      'admin-ajax.php': (url, init) => {
        loadMoreCalls += 1;
        const body = String((init && init.body) || '');
        expect(body).toContain('action=rspc_load_more');
        expect(body).toContain('offset=0');
        return ok(JSON.stringify({ success: true, data: { html: '', total: 42, newOffset: 0, hasMore: false } }));
      }
    });
    const res = await ext.getCommentCount('https://cenele.com/ch-test-40/', ctx);
    expect(res).toEqual({ count: 42 });
    expect(loadMoreCalls).toBe(1);
  });

  it('getCommentCount returns 0 when the chapter has no rspc-wrap', async () => {
    const ctx = mockCtx({ 'no-rspc/': ok('<html><body>no comments here</body></html>') });
    await expect(ext.getCommentCount('https://cenele.com/no-rspc/', ctx)).resolves.toEqual({ count: 0 });
  });

  it('returns empty when the chapter has no rspc-wrap', async () => {
    const ctx = mockCtx({ 'no-rspc/': ok('<html><body>no comments here</body></html>') });
    const res = await ext.getComments('https://cenele.com/no-rspc/', ctx);
    expect(res).toEqual({ count: 0, comments: [], nextOffset: 0, hasMore: false });
  });

  it('prefers machine timestamps and parses dual relative forms', async () => {
    const html =
      '<div class="rspc-comment" data-id="201">' +
      '<span class="rspc-comment__author">قارئ</span>' +
      '<time class="rspc-comment__time" datetime="2026-08-20T10:00:00+03:00">20 أغسطس 2026</time>' +
      '<div class="rspc-comment__text"><p>بتوقيت</p></div></div>' +
      '<div class="rspc-comment" data-id="202">' +
      '<span class="rspc-comment__author">قارئ2</span>' +
      '<span class="rspc-comment__time">منذ ساعتين</span>' +
      '<div class="rspc-comment__text"><p>مثنى</p></div></div>';
    const ctx = mockCtx({
      'ch-time/': ok(
        '<div class="rspc-wrap" data-entity-key="chapter:1:x"></div>' +
        '<script>var RSPC = {"ajaxUrl":"https://cenele.com/wp-admin/admin-ajax.php","nonce":"abc123"}</script>'
      ),
      'admin-ajax.php': ok(JSON.stringify({
        success: true, data: { html, total: 2, newOffset: 2, hasMore: false }
      }))
    });
    const res = await ext.getComments('https://cenele.com/ch-time/', ctx);
    const iso = res.comments.find((c) => c.id === '201');
    expect(iso.createdAt).toBe(Date.parse('2026-08-20T10:00:00+03:00'));
    const dual = res.comments.find((c) => c.id === '202');
    const expected = Date.now() - 2 * 3600 * 1000;
    expect(Math.abs(dual.createdAt - expected)).toBeLessThan(5 * 60 * 1000);
  });

  it('parses DD/MM/YYYY date format (cenele comment style)', async () => {
    const html =
      '<div class="rspc-comment" data-id="301">' +
      '<span class="rspc-comment__author">قارئ</span>' +
      '<span class="rspc-comment__time">19/08/2026</span>' +
      '<div class="rspc-comment__text"><p>تاريخ رقمي</p></div></div>' +
      '<div class="rspc-comment" data-id="302">' +
      '<span class="rspc-comment__author">قارئ2</span>' +
      '<span class="rspc-comment__time">06/08/2026</span>' +
      '<div class="rspc-comment__text"><p>تاريخ آخر</p></div></div>';
    const ctx = mockCtx({
      'ch-dmy/': ok(
        '<div class="rspc-wrap" data-entity-key="chapter:1:x"></div>' +
        '<script>var RSPC = {"ajaxUrl":"https://cenele.com/wp-admin/admin-ajax.php","nonce":"abc123"}</script>'
      ),
      'admin-ajax.php': ok(JSON.stringify({
        success: true, data: { html, total: 2, newOffset: 2, hasMore: false }
      }))
    });
    const res = await ext.getComments('https://cenele.com/ch-dmy/', ctx);
    const d1 = res.comments.find((c) => c.id === '301');
    const d2 = res.comments.find((c) => c.id === '302');
    // 19/08/2026 = 19 August 2026
    expect(d1.createdAt).toBe(new Date(2026, 7, 19, 12, 0, 0).getTime());
    // 06/08/2026 = 6 August 2026
    expect(d2.createdAt).toBe(new Date(2026, 7, 6, 12, 0, 0).getTime());
  });

  it('parses قبل-relative times (real cenele comment style)', async () => {
    const html =
      '<div class="rspc-comment" data-id="401">' +
      '<span class="rspc-comment__author">قارئ</span>' +
      '<span class="rspc-comment__time">قبل 18 ساعات</span>' +
      '<div class="rspc-comment__text"><p>نسبي برقم</p></div></div>' +
      '<div class="rspc-comment" data-id="402">' +
      '<span class="rspc-comment__author">قارئ2</span>' +
      '<span class="rspc-comment__time">قبل يومين</span>' +
      '<div class="rspc-comment__text"><p>مثنى بلا رقم</p></div></div>';
    const ctx = mockCtx({
      'ch-qabl/': ok(
        '<div class="rspc-wrap" data-entity-key="chapter:1:x"></div>' +
        '<script>var RSPC = {"ajaxUrl":"https://cenele.com/wp-admin/admin-ajax.php","nonce":"abc123"}</script>'
      ),
      'admin-ajax.php': ok(JSON.stringify({
        success: true, data: { html, total: 2, newOffset: 2, hasMore: false }
      }))
    });
    const res = await ext.getComments('https://cenele.com/ch-qabl/', ctx);
    const hours = res.comments.find((c) => c.id === '401');
    expect(Math.abs(hours.createdAt - (Date.now() - 18 * 3600 * 1000))).toBeLessThan(5 * 60 * 1000);
    const dual = res.comments.find((c) => c.id === '402');
    expect(Math.abs(dual.createdAt - (Date.now() - 2 * 24 * 3600 * 1000))).toBeLessThan(5 * 60 * 1000);
  });

  it('never prefetches threads; exposes repliesTotal from toggle buttons', async () => {
    const topHtml =
      '<div class="rspc-comment" data-id="501">' +
      '<span class="rspc-comment__author">قارئ</span>' +
      '<span class="rspc-comment__time">19/08/2026</span>' +
      '<div class="rspc-comment__text"><p>تعليق له ردود</p></div>' +
      '<button class="rspc-link rspc-thread-toggle" data-target="rspc-thread-501" data-parent="501" data-level="1" data-root="501">عرض الردود (2)</button>' +
      '<div class="rspc-replies rspc-thread rspc-hidden" id="rspc-thread-501" data-parent="501" data-level="1" data-loaded="0"></div>' +
      '</div>';
    let threadCalls = 0;
    const ctx = mockCtx({
      'ch-collapsed/': ok(
        '<div class="rspc-wrap" data-entity-key="chapter:1:x"></div>' +
        '<script>var RSPC = {"ajaxUrl":"https://cenele.com/wp-admin/admin-ajax.php","nonce":"abc123"}</script>'
      ),
      'admin-ajax.php': (url, init) => {
        const body = String((init && init.body) || '');
        if (body.includes('action=rspc_load_thread')) threadCalls++;
        if (body.includes('action=rspc_load_more')) {
          return ok(JSON.stringify({ success: true, data: { html: topHtml, total: 1, newOffset: 1, hasMore: false } }));
        }
        return { ok: false, status: 404, text: '' };
      }
    });
    const res = await ext.getComments('https://cenele.com/ch-collapsed/', ctx);
    expect(threadCalls).toBe(0);
    expect(res.comments.length).toBe(1);
    expect(res.comments[0].repliesTotal).toBe(2);
    expect(res.hasMore).toBe(false);
  });

  it('pages by offset and reports nextOffset/hasMore', async () => {
    // 6 server pages x 2 tops; one call loads at most 5 pages (same cap as
    // the pre-chunk behavior), the rest continues from nextOffset.
    const page = (ids) => ids.map((id) =>
      '<div class="rspc-comment" data-id="' + id + '">' +
      '<span class="rspc-comment__author">u' + id + '</span>' +
      '<span class="rspc-comment__time">19/08/2026</span>' +
      '<div class="rspc-comment__text"><p>body ' + id + '</p></div></div>'
    ).join('');
    const byOffset = {
      0: { ids: [701, 702], newOffset: 2, hasMore: true },
      2: { ids: [703, 704], newOffset: 4, hasMore: true },
      4: { ids: [705, 706], newOffset: 6, hasMore: true },
      6: { ids: [707, 708], newOffset: 8, hasMore: true },
      8: { ids: [709, 710], newOffset: 10, hasMore: true },
      10: { ids: [711, 712], newOffset: 12, hasMore: false }
    };
    const ctx = mockCtx({
      'ch-pages/': ok(
        '<div class="rspc-wrap" data-entity-key="chapter:1:x"></div>' +
        '<script>var RSPC = {"ajaxUrl":"https://cenele.com/wp-admin/admin-ajax.php","nonce":"abc123"}</script>'
      ),
      'admin-ajax.php': (url, init) => {
        const body = String((init && init.body) || '');
        const off = parseInt((body.match(/offset=(\d+)/) || [])[1] || '0', 10);
        const pg = byOffset[off] || { ids: [], newOffset: off, hasMore: false };
        return ok(JSON.stringify({ success: true, data: { html: page(pg.ids), total: 12, newOffset: pg.newOffset, hasMore: pg.hasMore } }));
      }
    });
    const first = await ext.getComments('https://cenele.com/ch-pages/', 0, ctx);
    expect(first.comments.map((c) => c.id)).toEqual(['701', '702', '703', '704', '705', '706', '707', '708', '709', '710']);
    expect(first.nextOffset).toBe(10);
    expect(first.hasMore).toBe(true);
    expect(first.count).toBe(12);
    const second = await ext.getComments('https://cenele.com/ch-pages/', first.nextOffset, ctx);
    expect(second.comments.map((c) => c.id)).toEqual(['711', '712']);
    expect(second.hasMore).toBe(false);
  });

  it('getCommentReplies fetches one thread with the site contract (parent_id/level/root_id)', async () => {
    const threadHtml =
      '<div class="rspc-reply-item" data-id="502">' +
      '<span class="rspc-reply-item__author">المترجم</span>' +
      '<span class="rspc-reply-item__time">20/08/2026</span>' +
      '<div class="rspc-reply-item__text"><p>رد حقيقي</p></div></div>';
    const seen = [];
    const ctx = mockCtx({
      'ch-replies/': ok(
        '<div class="rspc-wrap" data-entity-key="chapter:1:x"></div>' +
        '<script>var RSPC = {"ajaxUrl":"https://cenele.com/wp-admin/admin-ajax.php","nonce":"abc123"}</script>'
      ),
      'admin-ajax.php': (url, init) => {
        const body = String((init && init.body) || '');
        if (body.includes('action=rspc_load_thread')) {
          seen.push(body);
          return ok(JSON.stringify({ success: true, data: { html: threadHtml } }));
        }
        return { ok: false, status: 404, text: '' };
      }
    });
    const res = await ext.getCommentReplies('https://cenele.com/ch-replies/', '501', ctx);
    expect(seen.length).toBe(1);
    expect(seen[0]).toContain('parent_id=501');
    expect(seen[0]).toContain('level=1');
    expect(seen[0]).toContain('root_id=501');
    expect(seen[0]).not.toContain('comment_id');
    expect(res.comments.length).toBe(1);
    expect(res.comments[0].parentId).toBe('501');
    expect(res.comments[0].body).toBe('رد حقيقي');
    expect(res.comments[0].createdAt).toBe(new Date(2026, 7, 20, 12, 0, 0).getTime());
  });

  it('postComment and voteComment require login', async () => {
    const ctx = mockCtx();
    await expect(ext.postComment('https://cenele.com/ch-test-40/', { body: 'x' }, ctx)).rejects.toThrow('تسجيل الدخول');
    await expect(ext.voteComment('https://cenele.com/ch-test-40/', { commentId: '101', vote: 1 }, ctx)).rejects.toThrow('تسجيل الدخول');
  });
});
