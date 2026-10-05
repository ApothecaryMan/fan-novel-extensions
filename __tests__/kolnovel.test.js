// Comprehensive tests for site:kolnovel extension
// Tests every public method, helper, strategy, edge case, and error path.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadExtension, mockCtx, ok } from './helpers.js';
import {
  HOME_PAGE,
  NOVEL_PAGE,
  NOVEL_PAGE_NO_GENRES,
  GENRE_PAGE_ACTION,
  SEARCH_RESULTS,
  CHAPTER_CONTENT,
  EMPTY_PAGE,
  NO_RESULTS_PAGE,
} from './fixtures/kolnovel.js';

let ext;

beforeAll(() => {
  ext = loadExtension('site.kolnovel.js');
});

// ──────────────────────────────────────────────────────────────────
// 1. Extension metadata
// ──────────────────────────────────────────────────────────────────
describe('Extension metadata', () => {
  it('has correct id', () => expect(ext.id).toBe('site:kolnovel'));
  it('has correct name', () => expect(ext.name).toBe('كول نوفيل'));
  it('has correct lang', () => expect(ext.lang).toBe('ar'));
  it('has correct version', () => expect(ext.version).toBe('1.9.1'));
  it('has apiVersion 2', () => expect(ext.apiVersion).toBe(2));
  it('has correct baseUrl', () => expect(ext.baseUrl).toBe('https://kolnovel.com'));

  it('exposes all required methods', () => {
    const required = [
      'parseNovelInfo', 'parseChapterList', 'parseChapterContent',
      'searchNovels', 'getPopularNovels', 'getCategories', 'getCategoryNovels',
      'fetchLatestChapters', 'getComments', 'getCommentCount', 'postComment', 'voteComment',
    ];
    for (const m of required) {
      expect(typeof ext[m]).toBe('function');
    }
  });
});

// ──────────────────────────────────────────────────────────────────
// 2. Helper: _absUrl
// ──────────────────────────────────────────────────────────────────
describe('_absUrl', () => {
  it('returns absolute URL unchanged', () => {
    expect(ext._absUrl('https://example.com/x')).toBe('https://example.com/x');
  });
  it('prepends baseUrl for relative path starting with /', () => {
    expect(ext._absUrl('/series/test/')).toBe('https://kolnovel.com/series/test/');
  });
  it('prepends baseUrl with / for relative path without /', () => {
    expect(ext._absUrl('series/test/')).toBe('https://kolnovel.com/series/test/');
  });
});

// ──────────────────────────────────────────────────────────────────
// 3. Helper: _stripTags
// ──────────────────────────────────────────────────────────────────
describe('_stripTags', () => {
  it('strips HTML tags and collapses whitespace', () => {
    expect(ext._stripTags('<p>  Hello  <b>world</b>  </p>')).toBe('Hello world');
  });
  it('returns plain text unchanged', () => {
    expect(ext._stripTags('no tags here')).toBe('no tags here');
  });
  it('handles empty string', () => {
    expect(ext._stripTags('')).toBe('');
  });
  it('strips nested tags', () => {
    expect(ext._stripTags('<div><span><a>text</a></span></div>')).toBe('text');
  });
});

// ──────────────────────────────────────────────────────────────────
// 4. Helper: _decodeEntities
// ──────────────────────────────────────────────────────────────────
describe('_decodeEntities', () => {
  it('decodes named entities', () => {
    expect(ext._decodeEntities('&amp;')).toBe('&');
    expect(ext._decodeEntities('&lt;')).toBe('<');
    expect(ext._decodeEntities('&gt;')).toBe('>');
    expect(ext._decodeEntities('&quot;')).toBe('"');
    expect(ext._decodeEntities('&apos;')).toBe("'");
  });
  it('decodes numeric entities', () => {
    expect(ext._decodeEntities('&#65;')).toBe('A');
    expect(ext._decodeEntities('&#x41;')).toBe('A');
  });
  it('decodes Arabic HTML entities', () => {
    expect(ext._decodeEntities('عربي&nbsp;نص')).toBe('عربي نص');
  });
  it('leaves unknown entities unchanged', () => {
    expect(ext._decodeEntities('&unknown;')).toBe('&unknown;');
  });
  it('handles empty string', () => {
    expect(ext._decodeEntities('')).toBe('');
  });
});

// ──────────────────────────────────────────────────────────────────
// 5. Helper: _toLatinDigits
// ──────────────────────────────────────────────────────────────────
describe('_toLatinDigits', () => {
  it('converts Arabic-Indic digits (٠-٩)', () => {
    expect(ext._toLatinDigits('١٢٣')).toBe('123');
    expect(ext._toLatinDigits('٤٥٦')).toBe('456');
    expect(ext._toLatinDigits('٠')).toBe('0');
  });
  it('converts Extended Arabic-Indic digits (۰-۹)', () => {
    expect(ext._toLatinDigits('۱۲۳')).toBe('123');
  });
  it('leaves Latin digits unchanged', () => {
    expect(ext._toLatinDigits('123abc')).toBe('123abc');
  });
  it('handles empty/null input', () => {
    expect(ext._toLatinDigits('')).toBe('');
    expect(ext._toLatinDigits(null)).toBe('');
    expect(ext._toLatinDigits(undefined)).toBe('');
  });
});

// ──────────────────────────────────────────────────────────────────
// 6. Helper: _stripChapterPrefix
// ──────────────────────────────────────────────────────────────────
describe('_stripChapterPrefix', () => {
  it('strips Arabic chapter prefix', () => {
    expect(ext._stripChapterPrefix('الفصل 5: العنوان')).toBe('العنوان');
    expect(ext._stripChapterPrefix('الفصل 5 العنوان')).toBe('العنوان');
  });
  it('strips English chapter prefix', () => {
    expect(ext._stripChapterPrefix('Chapter 12: Title')).toBe('Title');
    expect(ext._stripChapterPrefix('Ch. 5 - Name')).toBe('Name');
  });
  it('strips Arabic word-number prefixes', () => {
    expect(ext._stripChapterPrefix('الفصل الثالث')).toBe('');
    expect(ext._stripChapterPrefix('الفصل الثالث: العنوان')).toBe('العنوان');
  });
  it('handles empty/null input', () => {
    expect(ext._stripChapterPrefix('')).toBe('');
    expect(ext._stripChapterPrefix(null)).toBe('');
  });
  it('returns plain name unchanged', () => {
    expect(ext._stripChapterPrefix('العنوان العادي')).toBe('العنوان العادي');
  });
});

// ──────────────────────────────────────────────────────────────────
// 7. Helper: _finalizeChapters
// ──────────────────────────────────────────────────────────────────
describe('_finalizeChapters', () => {
  it('sorts by chapter number and assigns Arabic title format', () => {
    const input = [
      { url: '/ch/2', number: 2, title: 'B' },
      { url: '/ch/1', number: 1, title: 'A' },
    ];
    const result = ext._finalizeChapters(input);
    expect(result[0].number).toBe(1);
    expect(result[0].title).toBe('الفصل 1 - A');
    expect(result[1].number).toBe(2);
    expect(result[1].title).toBe('الفصل 2 - B');
  });

  it('deduplicates by URL', () => {
    const input = [
      { url: '/ch/1', number: 1, title: 'A' },
      { url: '/ch/1', number: 1, title: 'A dup' },
    ];
    const result = ext._finalizeChapters(input);
    expect(result.length).toBe(1);
  });

  it('auto-generates missing chapter numbers', () => {
    const input = [
      { url: '/ch/a', title: 'First' },
      { url: '/ch/b', title: 'Second' },
    ];
    const result = ext._finalizeChapters(input);
    expect(result[0].number).toBe(1);
    expect(result[1].number).toBe(2);
  });

  it('strips leading chapter prefix from name before re-formatting', () => {
    const input = [{ url: '/ch/1', number: 1, title: 'الفصل 1: العنوان الفعلي' }];
    const result = ext._finalizeChapters(input);
    expect(result[0].title).toBe('الفصل 1 - العنوان الفعلي');
  });

  it('handles empty list', () => {
    expect(ext._finalizeChapters([])).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// 8. Helper: _parseDate
// ──────────────────────────────────────────────────────────────────
describe('_parseDate', () => {
  it('parses relative Arabic "منذ N دقيقة"', () => {
    const now = Date.now();
    const result = ext._parseDate('منذ 5 دقائق');
    expect(result).toBeGreaterThan(now - 6 * 60 * 1000);
    expect(result).toBeLessThanOrEqual(now);
  });

  it('parses relative Arabic "منذ N ساعة"', () => {
    const now = Date.now();
    const result = ext._parseDate('منذ 2 ساعات');
    expect(result).toBeGreaterThan(now - 3 * 3600 * 1000);
    expect(result).toBeLessThanOrEqual(now);
  });

  it('parses relative Arabic "منذ N يوم"', () => {
    const now = Date.now();
    const result = ext._parseDate('منذ 3 أيام');
    expect(result).toBeGreaterThan(now - 4 * 24 * 3600 * 1000);
    expect(result).toBeLessThanOrEqual(now);
  });

  it('parses dual form "يومين"', () => {
    const now = Date.now();
    const result = ext._parseDate('منذ يومين');
    expect(result).toBeGreaterThan(now - 3 * 24 * 3600 * 1000);
    expect(result).toBeLessThanOrEqual(now);
  });

  it('parses Arabic month names', () => {
    const result = ext._parseDate('15 يناير 2024');
    expect(result).toBeDefined();
    const d = new Date(result);
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(15);
  });

  it('parses standard date format', () => {
    const result = ext._parseDate('2024-01-15');
    expect(result).toBeDefined();
    expect(new Date(result).getFullYear()).toBe(2024);
  });

  it('returns undefined for null/empty input', () => {
    expect(ext._parseDate(null)).toBeUndefined();
    expect(ext._parseDate('')).toBeUndefined();
    expect(ext._parseDate('   ')).toBeUndefined();
  });

  it('converts Arabic-Indic digits before parsing', () => {
    const now = Date.now();
    const result = ext._parseDate('منذ ٥ ساعات');
    expect(result).toBeGreaterThan(now - 6 * 3600 * 1000);
    expect(result).toBeLessThanOrEqual(now);
  });
});

// ──────────────────────────────────────────────────────────────────
// 9. Helper: _safeFetch
// ──────────────────────────────────────────────────────────────────
describe('_safeFetch', () => {
  it('returns response on success', async () => {
    const ctx = mockCtx({ '/safe-ok': ok('<html>ok</html>') });
    const res = await ext._safeFetch('https://kolnovel.com/safe-ok', ctx, 'error');
    expect(res.ok).toBe(true);
    expect(res.text).toBe('<html>ok</html>');
  });

  it('throws Arabic error on network failure', async () => {
    const ctx = {
      xFetch: async () => { throw new Error('network down'); }
    };
    await expect(ext._safeFetch('/test-fail', ctx, 'فشل الاتصال'))
      .rejects.toThrow('فشل الاتصال: network down');
  });
});

// ──────────────────────────────────────────────────────────────────
// 10. parseNovelInfo
// ──────────────────────────────────────────────────────────────────
describe('parseNovelInfo', () => {
  it('extracts title from <h1 class="entry-title">', async () => {
    const ctx = mockCtx({ '/novel-title': ok(NOVEL_PAGE) });
    const info = await ext.parseNovelInfo('/novel-title', ctx);
    expect(info.title).toBe('ملح البرية');
  });

  it('extracts author from الكاتب section', async () => {
    const ctx = mockCtx({ '/novel-author': ok(NOVEL_PAGE) });
    const info = await ext.parseNovelInfo('/novel-author', ctx);
    expect(info.author).toBe('المؤلف العربي');
  });

  it('extracts cover URL', async () => {
    const ctx = mockCtx({ '/novel-cover': ok(NOVEL_PAGE) });
    const info = await ext.parseNovelInfo('/novel-cover', ctx);
    expect(info.coverUrl).toContain('melh.png');
  });

  it('detects completed status', async () => {
    const ctx = mockCtx({ '/novel-completed': ok(NOVEL_PAGE) });
    const info = await ext.parseNovelInfo('/novel-completed', ctx);
    expect(info.status).toBe('مكتملة');
  });

  it('detects ongoing status', async () => {
    // Build ongoing page by modifying the status span
    const ongoingHtml = NOVEL_PAGE.replace(
      /<span class="completed">مكتملة<\/span>/,
      '<span class="Ongoing">مستمرة</span>'
    );
    const ctx = mockCtx({ '/novel-ongoing': ok(ongoingHtml) });
    const info = await ext.parseNovelInfo('/novel-ongoing', ctx);
    expect(info.status).toBe('مستمرة');
  });

  it('extracts summary from .sersysn', async () => {
    const ctx = mockCtx({ '/novel-summary': ok(NOVEL_PAGE) });
    const info = await ext.parseNovelInfo('/novel-summary', ctx);
    expect(info.summary).toContain('ملح البرية');
    expect(info.summary).toContain('مغامرة مثيرة');
  });

  it('extracts genres into tags array from .sertogenre', async () => {
    const ctx = mockCtx({ '/novel-tags': ok(NOVEL_PAGE) });
    const info = await ext.parseNovelInfo('/novel-tags', ctx);
    expect(info.tags).toEqual(['مغامرة', 'خيال', 'أكشن']);
  });

  it('sets category to first genre', async () => {
    const ctx = mockCtx({ '/novel-cat': ok(NOVEL_PAGE) });
    const info = await ext.parseNovelInfo('/novel-cat', ctx);
    expect(info.category).toBe('مغامرة');
  });

  it('returns undefined category/tags when no genres found (no fake default)', async () => {
    const ctx = mockCtx({ '/novel-nogenre': ok(NOVEL_PAGE_NO_GENRES) });
    const info = await ext.parseNovelInfo('/novel-nogenre', ctx);
    expect(info.category).toBeUndefined();
    expect(info.tags).toBeUndefined();
  });

  it('parses genres when .sertogenre nests a heading div (live-site layout)', async () => {
    // Live kolnovel.com wraps a <div class="series-card-heading"> inside
    // .sertogenre; the old non-greedy </div> regex stopped at the heading and
    // lost every genre.
    const nested = NOVEL_PAGE.replace(
      '<div class="sertogenre">',
      '<div class="sertogenre"><div class="series-card-heading sertogenre-title">التصنيفات</div>'
    );
    const ctx = mockCtx({ '/novel-nested': ok(nested) });
    const info = await ext.parseNovelInfo('/novel-nested', ctx);
    expect(info.tags).toEqual(['مغامرة', 'خيال', 'أكشن']);
    expect(info.category).toBe('مغامرة');
  });

  it('parses detail-page rating from .custom-rating-value', async () => {
    const rated = NOVEL_PAGE.replace(
      '</body>',
      '<div id="kol-series-rating"><span class="custom-rating-value">4.5 / 5</span></div></body>'
    );
    const ctx = mockCtx({ '/novel-rated': ok(rated) });
    const info = await ext.parseNovelInfo('/novel-rated', ctx);
    expect(info.rating).toBe(4.5);
  });

  it('returns undefined rating when the site reports 0.0 (no votes yet)', async () => {
    const unrated = NOVEL_PAGE.replace(
      '</body>',
      '<div id="kol-series-rating"><span class="custom-rating-value">0.0 / 5</span></div></body>'
    );
    const ctx = mockCtx({ '/novel-unrated': ok(unrated) });
    const info = await ext.parseNovelInfo('/novel-unrated', ctx);
    expect(info.rating).toBeUndefined();
  });

  it('sets source to extension id', async () => {
    const ctx = mockCtx({ '/novel-source': ok(NOVEL_PAGE) });
    const info = await ext.parseNovelInfo('/novel-source', ctx);
    expect(info.source).toBe('site:kolnovel');
  });

  it('returns full URL', async () => {
    const ctx = mockCtx({ '/novel-fullurl': ok(NOVEL_PAGE) });
    const info = await ext.parseNovelInfo('/novel-fullurl', ctx);
    expect(info.url).toBe('https://kolnovel.com/novel-fullurl');
  });

  it('throws on HTTP error', async () => {
    const ctx = mockCtx({ '/novel-err': { ok: false, status: 404, text: '' } });
    await expect(ext.parseNovelInfo('/novel-err', ctx)).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────
// 11. parseChapterList
// ──────────────────────────────────────────────────────────────────
describe('parseChapterList', () => {
  it('parses inline chapters from novel page', async () => {
    const ctx = mockCtx({ '/chapters-basic': ok(NOVEL_PAGE) });
    const chapters = await ext.parseChapterList('/chapters-basic', ctx);
    expect(chapters.length).toBe(3);
  });

  it('extracts chapter numbers', async () => {
    const ctx = mockCtx({ '/chapters-nums': ok(NOVEL_PAGE) });
    const chapters = await ext.parseChapterList('/chapters-nums', ctx);
    expect(chapters[0].number).toBe(1);
    expect(chapters[1].number).toBe(2);
    expect(chapters[2].number).toBe(3);
  });

  it('formats chapter titles in Arabic format', async () => {
    const ctx = mockCtx({ '/chapters-titles': ok(NOVEL_PAGE) });
    const chapters = await ext.parseChapterList('/chapters-titles', ctx);
    expect(chapters[0].title).toBe('الفصل 1 - البداية');
    expect(chapters[1].title).toBe('الفصل 2 - المواجهة');
  });

  it('extracts chapter dates', async () => {
    const ctx = mockCtx({ '/chapters-dates': ok(NOVEL_PAGE) });
    const chapters = await ext.parseChapterList('/chapters-dates', ctx);
    expect(chapters[0].uploadedAt).toBeDefined();
    expect(typeof chapters[0].uploadedAt).toBe('number');
  });

  it('extracts chapter URLs', async () => {
    const ctx = mockCtx({ '/chapters-urls': ok(NOVEL_PAGE) });
    const chapters = await ext.parseChapterList('/chapters-urls', ctx);
    expect(chapters[0].url).toContain('/1/');
    expect(chapters[1].url).toContain('/2/');
  });

  it('auto-generates missing chapter numbers', async () => {
    const ctx = mockCtx({ '/chapters-autonum': ok(NOVEL_PAGE) });
    const chapters = await ext.parseChapterList('/chapters-autonum', ctx);
    expect(chapters[2].number).toBe(3);
  });

  it('returns empty list for page with no chapters', async () => {
    const noChapHtml = NOVEL_PAGE.replace(
      /<div class="eplister">[\s\S]*?<\/div>\s*(?=<\/body>)/,
      ''
    );
    const ctx = mockCtx({ '/chapters-empty': ok(noChapHtml) });
    const chapters = await ext.parseChapterList('/chapters-empty', ctx);
    expect(chapters.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────
// 12. fetchLatestChapters
// ──────────────────────────────────────────────────────────────────
describe('fetchLatestChapters', () => {
  it('returns only chapters newer than knownCount', async () => {
    const ctx = mockCtx({ '/latest-partial': ok(NOVEL_PAGE) });
    const latest = await ext.fetchLatestChapters('/latest-partial', 2, ctx);
    expect(latest.length).toBe(1);
    expect(latest[0].number).toBe(3);
  });

  it('returns all chapters when knownCount is 0', async () => {
    const ctx = mockCtx({ '/latest-all': ok(NOVEL_PAGE) });
    const latest = await ext.fetchLatestChapters('/latest-all', 0, ctx);
    expect(latest.length).toBe(3);
  });

  it('returns empty when all chapters are known', async () => {
    const ctx = mockCtx({ '/latest-none': ok(NOVEL_PAGE) });
    const latest = await ext.fetchLatestChapters('/latest-none', 100, ctx);
    expect(latest.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────
// 13. parseChapterContent
// ──────────────────────────────────────────────────────────────────
describe('parseChapterContent', () => {
  it('extracts paragraphs from #kol_content', async () => {
    const ctx = mockCtx({ '/content-basic': ok(CHAPTER_CONTENT) });
    const content = await ext.parseChapterContent('/content-basic', ctx);
    expect(content).toContain('بداية المغامرة');
    expect(content).toContain('قال له الشيخ');
  });

  it('strips ad divs', async () => {
    const ctx = mockCtx({ '/content-ads': ok(CHAPTER_CONTENT) });
    const content = await ext.parseChapterContent('/content-ads', ctx);
    expect(content).not.toContain('إعلان');
  });

  it('stops at footer markers', async () => {
    const ctx = mockCtx({ '/content-footer': ok(CHAPTER_CONTENT) });
    const content = await ext.parseChapterContent('/content-footer', ctx);
    expect(content).not.toContain('نهاية الفصل');
  });

  it('removes URL leaks from paragraphs', async () => {
    const html = `<!DOCTYPE html><html><body><div id="kol_content">
      <p>Visit https://spam.com/bad for more info</p>
      <p>Normal paragraph text here</p>
    </div></body></html>`;
    const ctx = mockCtx({ '/content-urls': ok(html) });
    const content = await ext.parseChapterContent('/content-urls', ctx);
    expect(content).not.toContain('https://spam.com');
    expect(content).toContain('Normal paragraph text');
  });

  it('strips leading chapter heading from first paragraph', async () => {
    const html = `<!DOCTYPE html><html><body><div id="kol_content">
      <p>الفصل 1: البداية الجديدة</p>
      <p>النص الفعلي يبدأ هنا</p>
    </div></body></html>`;
    const ctx = mockCtx({ '/content-heading': ok(html) });
    const content = await ext.parseChapterContent('/content-heading', ctx);
    expect(content).not.toMatch(/^الفصل 1/);
    expect(content).toContain('النص الفعلي');
  });

  it('throws on missing content', async () => {
    const ctx = mockCtx({ '/content-missing': ok('<html><body>no content div</body></html>') });
    await expect(ext.parseChapterContent('/content-missing', ctx)).rejects.toThrow('تعذر العثور على نص الفصل');
  });

  it('handles entry-content fallback', async () => {
    const html = `<!DOCTYPE html><html><body>
      <div class="entry-content">
        <p>Entry content paragraph</p>
      </div>
    </body></html>`;
    const ctx = mockCtx({ '/content-fallback': ok(html) });
    const content = await ext.parseChapterContent('/content-fallback', ctx);
    expect(content).toContain('Entry content paragraph');
  });

  it('keeps chapter title text after the heading prefix (سلالة الدم ch.1)', async () => {
    const html = `<!DOCTYPE html><html><body><div id="kol_content">
      <p>الفصل 1: كيف بدأ كل شيء</p>
      <p>النص الفعلي يبدأ هنا</p>
    </div></body></html>`;
    const ctx = mockCtx({ '/content-heading-title': ok(html) });
    const content = await ext.parseChapterContent('/content-heading-title', ctx);
    expect(content).toContain('كيف بدأ كل شيء');
    expect(content).toContain('النص الفعلي');
  });

  it('ignores hidden decoy paragraphs (anti-scraper shuffle)', async () => {
    const html = `<!DOCTYPE html><html><head><style>
      .a22222222222222222222222222222222,.a33333333333333333333333333333333{height:0.1px;overflow:hidden;opacity:0;text-indent:-99999px;bottom:-999px;}
    </style></head><body><div id="kol_content">
      <p class='a11111111111111111111111111111111'><strong>في ساحة كبيرة هتافات الجمهور</strong><p class="a22222222222222222222222222222222">نعم هذا أنا غوستاف من المستقبل البعيد</p>
      <p class='a44444444444444444444444444444444'><strong>تراجعت مجموعة من خمسة أفراد</strong><p class="a33333333333333333333333333333333">استقبلت والدة غوستاف طفل آخر</p>
      <p class='a55555555555555555555555555555555'><strong>كان طوله ستة أقدام</strong><p class="a66666666666666666666666666666666">ما الخطأ في هذا النجم</p>
      <p class='a77777777777777777777777777777777'><strong>سار ببطء نحو المجموعة</strong><p class="a88888888888888888888888888888888">اتسعت عينا غوستاف</p>
      <p class='a99999999999999999999999999999999'><strong>رحلتك تنتهي هنا</strong><p class="a00000000000000000000000000000000">كان دائما يتراجع</p>
      <p class='aabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'><strong>مد يده اليمنى</strong><p class="aacccccccccccccccccccccccccccccccc">كان غوستاف مكروه</p>
    </div></body></html>`;
    const ctx = mockCtx({ '/content-decoy': ok(html) });
    const content = await ext.parseChapterContent('/content-decoy', ctx);
    const paras = content.split('\n\n');
    expect(paras).toContain('في ساحة كبيرة هتافات الجمهور');
    expect(paras).toContain('تراجعت مجموعة من خمسة أفراد');
    expect(content).not.toContain('نعم هذا أنا غوستاف من المستقبل البعيد');
    expect(content).not.toContain('استقبلت والدة غوستاف طفل آخر');
    paras.forEach((p) => {
      expect(p).not.toContain('في ساحة كبيرة هتافات الجمهور نعم هذا أنا');
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// 14. searchNovels — all 4 strategies
// ──────────────────────────────────────────────────────────────────
describe('searchNovels', () => {
  describe('Strategy 1: maindet cards', () => {
    it('parses maindet articles from search results', async () => {
      const ctx = mockCtx({ '?s=test': ok(SEARCH_RESULTS) });
      const results = await ext.searchNovels('test', 1, ctx);
      const maindet = results.filter(r => r.url.includes('نتيجة-بحث-1'));
      expect(maindet.length).toBe(1);
      expect(maindet[0].title).toBe('نتيجة بحث 1');
    });

    it('extracts genres into tags array', async () => {
      const ctx = mockCtx({ '?s=test': ok(SEARCH_RESULTS) });
      const results = await ext.searchNovels('test', 1, ctx);
      const item = results.find(r => r.url.includes('نتيجة-بحث-1'));
      expect(item.tags).toEqual(['رومانسي']);
      expect(item.category).toBe('رومانسي');
    });

    it('extracts rating', async () => {
      const ctx = mockCtx({ '?s=test': ok(SEARCH_RESULTS) });
      const results = await ext.searchNovels('test', 1, ctx);
      const item = results.find(r => r.url.includes('نتيجة-بحث-1'));
      expect(item.rating).toBe(8.1);
    });
  });

  describe('Strategy 4: bsx grid cards', () => {
    it('parses bsx article cards', async () => {
      const ctx = mockCtx({ '?s=test': ok(SEARCH_RESULTS) });
      const results = await ext.searchNovels('test', 1, ctx);
      const bsx = results.filter(r => r.url.includes('نتيجة-بحث-2'));
      expect(bsx.length).toBe(1);
      expect(bsx[0].title).toBe('نتيجة بحث 2');
    });

    it('defaults category for bsx cards (no genre in HTML)', async () => {
      const ctx = mockCtx({ '?s=test': ok(SEARCH_RESULTS) });
      const results = await ext.searchNovels('test', 1, ctx);
      const bsx = results.find(r => r.url.includes('نتيجة-بحث-2'));
      expect(bsx.category).toBe('روايات مترجمة');
    });
  });

  describe('Browse mode (empty query)', () => {
    it('fetches homepage when query is empty', async () => {
      const ctx = mockCtx({ 'kolnovel.com/': ok(HOME_PAGE) });
      const results = await ext.searchNovels('', 1, ctx);
      expect(results.length).toBeGreaterThan(0);
    });

    it('fetches homepage when query is null', async () => {
      const ctx = mockCtx({ 'kolnovel.com/': ok(HOME_PAGE) });
      const results = await ext.searchNovels(null, 1, ctx);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Strategy 2: utao items', () => {
    it('parses utao list items', async () => {
      const ctx = mockCtx({ '?s=test': ok(HOME_PAGE) });
      const results = await ext.searchNovels('test', 1, ctx);
      const utao = results.filter(r => r.url.includes('اتضح'));
      expect(utao.length).toBe(1);
      expect(utao[0].title).toContain('اتضح');
    });
  });

  describe('Strategy 3: hotoday items', () => {
    it('parses hotoday items', async () => {
      const ctx = mockCtx({ '?s=test': ok(HOME_PAGE) });
      const results = await ext.searchNovels('test', 1, ctx);
      const hot = results.filter(r => r.url.includes('ملح-البرية'));
      expect(hot.length).toBe(1);
    });

    it('extracts genre from hotoday into tags', async () => {
      const ctx = mockCtx({ '?s=test': ok(HOME_PAGE) });
      const results = await ext.searchNovels('test', 1, ctx);
      const hot = results.find(r => r.url.includes('ملح-البرية'));
      expect(hot.tags).toEqual(['مغامرة']);
      expect(hot.category).toBe('مغامرة');
    });

    it('extracts status from hotoday', async () => {
      const ctx = mockCtx({ '?s=test': ok(HOME_PAGE) });
      const results = await ext.searchNovels('test', 1, ctx);
      const completed = results.find(r => r.url.includes('ملح-البرية'));
      expect(completed.status).toBe('مكتملة');
      const ongoing = results.find(r => r.url.includes('ساموراي'));
      expect(ongoing.status).toBe('مستمرة');
    });

    it('extracts rating from hotoday', async () => {
      const ctx = mockCtx({ '?s=test': ok(HOME_PAGE) });
      const results = await ext.searchNovels('test', 1, ctx);
      const hot = results.find(r => r.url.includes('ملح-البرية'));
      expect(hot.rating).toBe(9.2);
    });
  });

  describe('Deduplication', () => {
    it('deduplicates results by URL across strategies', async () => {
      const ctx = mockCtx({ 'kolnovel.com/': ok(HOME_PAGE) });
      const results = await ext.searchNovels('', 1, ctx);
      const urls = results.map(r => r.url);
      const uniqueUrls = [...new Set(urls)];
      expect(urls.length).toBe(uniqueUrls.length);
    });
  });

  describe('Error handling', () => {
    it('returns empty array on HTTP error', async () => {
      const ctx = mockCtx({ '?s=bad': { ok: false, status: 500, text: '' } });
      const results = await ext.searchNovels('bad', 1, ctx);
      expect(results).toEqual([]);
    });

    it('returns empty array when no results found', async () => {
      const ctx = mockCtx({ '?s=none': ok(NO_RESULTS_PAGE) });
      const results = await ext.searchNovels('none', 1, ctx);
      expect(results).toEqual([]);
    });
  });

  describe('Pagination', () => {
    it('builds correct URL for page 2', async () => {
      let fetchedUrl = '';
      const ctx = {
        xFetch: async (url) => {
          fetchedUrl = typeof url === 'string' ? url : url.url;
          return ok(NO_RESULTS_PAGE);
        }
      };
      await ext.searchNovels('test', 2, ctx);
      expect(fetchedUrl).toContain('paged=2');
    });

    it('defaults to page 1', async () => {
      let fetchedUrl = '';
      const ctx = {
        xFetch: async (url) => {
          fetchedUrl = typeof url === 'string' ? url : url.url;
          return ok(NO_RESULTS_PAGE);
        }
      };
      await ext.searchNovels('test', 1, ctx);
      expect(fetchedUrl).not.toContain('paged=');
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// 15. getPopularNovels
// ──────────────────────────────────────────────────────────────────
describe('getPopularNovels', () => {
  it('delegates to searchNovels with empty query', async () => {
    const ctx = mockCtx({ 'kolnovel.com/': ok(HOME_PAGE) });
    const results = await ext.getPopularNovels(1, ctx);
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns NovelResult objects with correct shape', async () => {
    const ctx = mockCtx({ 'kolnovel.com/': ok(HOME_PAGE) });
    const results = await ext.getPopularNovels(1, ctx);
    for (const r of results) {
      expect(r).toHaveProperty('source', 'site:kolnovel');
      expect(r).toHaveProperty('url');
      expect(r).toHaveProperty('title');
      expect(r).toHaveProperty('author');
      expect(r).toHaveProperty('category');
      expect(r).toHaveProperty('status');
      expect(typeof r.url).toBe('string');
      expect(r.url.length).toBeGreaterThan(0);
    }
  });
});

// ──────────────────────────────────────────────────────────────────
// 16. getCategories
// ──────────────────────────────────────────────────────────────────
describe('getCategories', () => {
  it('extracts genre categories from home page', async () => {
    const ctx = mockCtx({ 'kolnovel.com/': ok(HOME_PAGE) });
    const cats = await ext.getCategories(ctx);
    expect(cats.length).toBeGreaterThan(0);
  });

  it('returns objects with name and slug', async () => {
    const ctx = mockCtx({ 'kolnovel.com/': ok(HOME_PAGE) });
    const cats = await ext.getCategories(ctx);
    for (const c of cats) {
      expect(c).toHaveProperty('name');
      expect(c).toHaveProperty('slug');
      expect(typeof c.name).toBe('string');
      expect(typeof c.slug).toBe('string');
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.slug.length).toBeGreaterThan(0);
    }
  });

  it('extracts known genres from fixture', async () => {
    const ctx = mockCtx({ 'kolnovel.com/': ok(HOME_PAGE) });
    const cats = await ext.getCategories(ctx);
    const slugs = cats.map(c => c.slug);
    expect(slugs).toContain('action');
    expect(slugs).toContain('fantasy');
    expect(slugs).toContain('adventure');
    expect(slugs).toContain('romance');
  });

  it('deduplicates genres', async () => {
    const ctx = mockCtx({ 'kolnovel.com/': ok(HOME_PAGE) });
    const cats = await ext.getCategories(ctx);
    const slugs = cats.map(c => c.slug);
    const uniqueSlugs = [...new Set(slugs)];
    expect(slugs.length).toBe(uniqueSlugs.length);
  });

  it('decodes genre names correctly', async () => {
    const ctx = mockCtx({ 'kolnovel.com/': ok(HOME_PAGE) });
    const cats = await ext.getCategories(ctx);
    const action = cats.find(c => c.slug === 'action');
    expect(action).toBeDefined();
    expect(action.name).toBe('أكشن');
  });

  it('returns empty array on HTTP error', async () => {
    const ctx = mockCtx({ 'kolnovel.com/': { ok: false, status: 500, text: '' } });
    const cats = await ext.getCategories(ctx);
    expect(cats).toEqual([]);
  });

  it('returns empty array for page with no genres', async () => {
    const ctx = mockCtx({ 'kolnovel.com/': ok(NO_RESULTS_PAGE) });
    const cats = await ext.getCategories(ctx);
    expect(cats).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// 17. getCategoryNovels
// ──────────────────────────────────────────────────────────────────
describe('getCategoryNovels', () => {
  it('fetches genre page and returns novel results', async () => {
    const ctx = mockCtx({ '/genre/action/': ok(GENRE_PAGE_ACTION) });
    const results = await ext.getCategoryNovels('action', 1, ctx);
    expect(results.length).toBe(2);
  });

  it('returns NovelResult objects with correct shape', async () => {
    const ctx = mockCtx({ '/genre/fantasy/': ok(GENRE_PAGE_ACTION) });
    const results = await ext.getCategoryNovels('fantasy', 1, ctx);
    for (const r of results) {
      expect(r).toHaveProperty('source', 'site:kolnovel');
      expect(r).toHaveProperty('url');
      expect(r).toHaveProperty('title');
      expect(r).toHaveProperty('category');
      expect(r).toHaveProperty('tags');
    }
  });

  it('extracts genres into tags array', async () => {
    const ctx = mockCtx({ '/genre/multi/': ok(GENRE_PAGE_ACTION) });
    const results = await ext.getCategoryNovels('multi', 1, ctx);
    const multiGenre = results.find(r => r.tags.length > 1);
    expect(multiGenre).toBeDefined();
    expect(multiGenre.tags).toContain('أكشن');
    expect(multiGenre.tags).toContain('خيال');
  });

  it('builds correct URL with page number', async () => {
    let fetchedUrl = '';
    const ctx = {
      xFetch: async (url) => {
        fetchedUrl = typeof url === 'string' ? url : url.url;
        return ok(GENRE_PAGE_ACTION);
      }
    };
    await ext.getCategoryNovels('action', 3, ctx);
    expect(fetchedUrl).toContain('/genre/');
    expect(fetchedUrl).toContain('page/3/');
  });

  it('defaults to page 1', async () => {
    let fetchedUrl = '';
    const ctx = {
      xFetch: async (url) => {
        fetchedUrl = typeof url === 'string' ? url : url.url;
        return ok(GENRE_PAGE_ACTION);
      }
    };
    await ext.getCategoryNovels('action', 1, ctx);
    expect(fetchedUrl).not.toContain('page/');
  });

  it('returns empty array on HTTP error', async () => {
    const ctx = mockCtx({ '/genre/nonexistent/': { ok: false, status: 404, text: '' } });
    const results = await ext.getCategoryNovels('nonexistent', 1, ctx);
    expect(results).toEqual([]);
  });

  it('returns empty array when no results found', async () => {
    const ctx = mockCtx({ '/genre/empty/': ok(NO_RESULTS_PAGE) });
    const results = await ext.getCategoryNovels('empty', 1, ctx);
    expect(results).toEqual([]);
  });

  it('handles slug with spaces (converts to -)', async () => {
    let fetchedUrl = '';
    const ctx = {
      xFetch: async (url) => {
        fetchedUrl = typeof url === 'string' ? url : url.url;
        return ok(GENRE_PAGE_ACTION);
      }
    };
    await ext.getCategoryNovels('web novel', 1, ctx);
    expect(fetchedUrl).toContain('/genre/web-novel/');
  });
});

// ──────────────────────────────────────────────────────────────────
// 18. _parseMaindetCards (shared helper)
// ──────────────────────────────────────────────────────────────────
describe('_parseMaindetCards', () => {
  it('parses maindet articles from HTML', () => {
    const results = ext._parseMaindetCards(GENRE_PAGE_ACTION);
    expect(results.length).toBe(2);
  });

  it('extracts multi-genre tags', () => {
    const results = ext._parseMaindetCards(GENRE_PAGE_ACTION);
    const multi = results.find(r => r.tags.length > 1);
    expect(multi.tags).toEqual(['أكشن', 'خيال']);
  });

  it('sets category to first genre', () => {
    const results = ext._parseMaindetCards(GENRE_PAGE_ACTION);
    for (const r of results) {
      expect(r.category).toBe(r.tags[0] || 'روايات مترجمة');
    }
  });

  it('deduplicates by URL', () => {
    const html = GENRE_PAGE_ACTION + GENRE_PAGE_ACTION;
    const results = ext._parseMaindetCards(html);
    expect(results.length).toBe(2);
  });

  it('returns empty for HTML with no maindet articles', () => {
    const results = ext._parseMaindetCards('<html><body>no articles</body></html>');
    expect(results).toEqual([]);
  });

  it('extracts rating', () => {
    const results = ext._parseMaindetCards(GENRE_PAGE_ACTION);
    expect(results[0].rating).toBe(9.0);
  });
});

// ──────────────────────────────────────────────────────────────────
// 19. Caching behavior
// ──────────────────────────────────────────────────────────────────
describe('Caching', () => {
  it('caches novel page HTML (same URL = one fetch)', async () => {
    let fetchCount = 0;
    const ctx = {
      xFetch: async () => {
        fetchCount++;
        return ok(NOVEL_PAGE);
      }
    };
    await ext.parseNovelInfo('/unique-cache-a/', ctx);
    await ext.parseChapterList('/unique-cache-a/', ctx);
    expect(fetchCount).toBe(1);
  });

  it('does not cache different URLs', async () => {
    let fetchCount = 0;
    const ctx = {
      xFetch: async () => {
        fetchCount++;
        return ok(NOVEL_PAGE);
      }
    };
    await ext.parseNovelInfo('/unique-cache-x/', ctx);
    await ext.parseNovelInfo('/unique-cache-y/', ctx);
    expect(fetchCount).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────
// 20. Chapter comments (cmtapi PocketBase backend)
// ──────────────────────────────────────────────────────────────────
describe('getComments', () => {
  const CHAPTER_HTML = '<div class="cmt commentx"><script type="module" src="https://cmtapi.kolnovel.com/embed/comments/kol-comments.js"></script>' +
    '<kol-comments slug="test-280" entity-title="رواية تجريبية 280" ' +
    'entity-url="https://kolnovel.com/ch-test-291266/" entity-id="291266" ' +
    'entity-type="post" series-id="278547"></kol-comments></div>';

  const ENSURE = JSON.stringify({
    id: 'pbentity1', commentsCount: 2, allowReplies: true,
    isLocked: false, isArchived: false
  });

  const lexBody = (text) => JSON.stringify({
    root: {
      children: [{ children: [{ detail: 0, format: 0, mode: 'normal', style: '', text: text, type: 'text', version: 1 }], direction: null, format: '', indent: 0, type: 'paragraph', version: 1 }],
      direction: null, format: '', indent: 0, type: 'root', version: 1
    }
  });

  const COMMENTS_PAGE = JSON.stringify({
    items: [
      { id: 'c1', parentId: '', text: lexBody('شكرا علي الترجمة'), normalizedContent: 'شكرا علي الترجمة', created: '2026-09-15T14:34:54.770Z', containsSpoiler: false, isDeleted: false, expand: { author: { name: 'اسامه وائل' } } },
      { id: 'c2', parentId: 'c1', text: lexBody('عفوا'), normalizedContent: 'عفوا', created: '2026-09-15T15:00:00.000Z', containsSpoiler: false, isDeleted: false, expand: { author: { name: 'المترجم' } } }
    ],
    page: 1, perPage: 100, totalItems: 2, totalPages: 1
  });

  const NET_PAGE = JSON.stringify({
    items: [
      { comment: 'c1', id: 'c1', likes: 3, dislikes: 1, net: 2 },
      { comment: 'c2', id: 'c2', likes: 0, dislikes: 0, net: 0 }
    ],
    page: 1, perPage: 100, totalItems: 2, totalPages: 1
  });

  const commentCtx = () => mockCtx({
    'ch-test-291266/': ok(CHAPTER_HTML),
    'entities/ensure': (url, init) => {
      expect(String(init.body)).toContain('291266');
      return ok(ENSURE);
    },
    'collections/comments/records': ok(COMMENTS_PAGE),
    'collections/comment_net/records': ok(NET_PAGE)
  });

  it('resolves entity via ensure and returns threaded comments with net likes', async () => {
    const res = await ext.getComments('https://kolnovel.com/ch-test-291266/', commentCtx());
    expect(res.count).toBe(2);
    expect(res.comments.length).toBe(2);
    expect(res.comments[0].id).toBe('c1');
    expect(res.comments[0].author).toBe('اسامه وائل');
    expect(res.comments[0].body).toContain('شكرا علي الترجمة');
    expect(res.comments[0].likes).toBe(2);
    expect(res.comments[0].parentId).toBeNull();
    expect(res.comments[1].parentId).toBe('c1');
    expect(res.comments[1].url).toContain('#comment-c2');
  });

  it('returns empty list when chapter has no comment tag', async () => {
    const ctx = mockCtx({ 'no-comments/': ok('<html><body>no tag</body></html>') });
    const res = await ext.getComments('https://kolnovel.com/no-comments/', ctx);
    expect(res).toEqual({ count: 0, comments: [] });
  });

  it('getCommentCount returns ensure count without fetching records', async () => {
    let recordsHit = false;
    const ctx = mockCtx({
      'ch-test-291266/': ok(CHAPTER_HTML),
      'entities/ensure': ok(ENSURE),
      'collections/comments/records': () => { recordsHit = true; return ok('{}'); },
      'collections/comment_net/records': () => { recordsHit = true; return ok('{}'); }
    });
    const res = await ext.getCommentCount('https://kolnovel.com/ch-test-291266/', ctx);
    expect(res).toEqual({ count: 2 });
    expect(recordsHit).toBe(false);
  });

  it('getCommentCount returns 0 when chapter has no comment tag', async () => {
    const ctx = mockCtx({ 'no-comments/': ok('<html><body>no tag</body></html>') });
    await expect(ext.getCommentCount('https://kolnovel.com/no-comments/', ctx)).resolves.toEqual({ count: 0 });
  });

  it('falls back to normalizedContent when Lexical parse fails', async () => {
    const badLex = JSON.stringify({
      items: [{ id: 'c9', parentId: '', text: 'not-json{{{', normalizedContent: 'نص بديل', created: '2026-09-15T14:00:00.000Z', isDeleted: false, expand: { author: { name: 'قارئ' } } }],
      page: 1, perPage: 100, totalItems: 1, totalPages: 1
    });
    const ctx = mockCtx({
      'ch-test-291266/': ok(CHAPTER_HTML),
      'entities/ensure': ok(ENSURE),
      'collections/comments/records': ok(badLex),
      'collections/comment_net/records': ok(JSON.stringify({ items: [], page: 1, perPage: 100, totalItems: 0, totalPages: 1 }))
    });
    const res = await ext.getComments('https://kolnovel.com/ch-test-291266/', ctx);
    expect(res.comments.length).toBe(1);
    expect(res.comments[0].body).toBe('نص بديل');
    expect(res.comments[0].likes).toBe(0);
  });

  // ── The six fixes ──────────────────────────────────────────────────

  it('reads vote counts past the first 100 comments', async () => {
    // comment_net used to request `page=1&perPage=100` ONLY, so on a chapter
    // with more than 100 comments every later row got a confident 0 likes.
    // The comments table was paged; the vote table was not.
    const fresh = loadExtension('site.kolnovel.js');
    const CH = 'https://kolnovel.com/ch-big/';
    const TAG = `<kol-comments slug="s" entity-title="t" entity-id="900" series-id="7"></kol-comments>`;
    const row = (i) => ({
      id: `c${i}`, parentId: '', created: '2026-06-01T10:00:00.000Z',
      normalizedContent: `تعليق ${i}`, text: '',
      expand: { author: { name: `user${i}` } }
    });
    const ctx = mockCtx({
      'ch-big/': () => ok(TAG),
      'entities/ensure': () => ok(JSON.stringify({ id: 'pb-1', commentsCount: 250 })),
      'collections/comments/records': (url) => {
        const pg = Number(new URL(url).searchParams.get('page') || 1);
        const start = (pg - 1) * 100;
        const n = Math.max(0, Math.min(100, 250 - start)); // last page is short
        const items = Array.from({ length: n }, (_, k) => row(start + k + 1));
        return ok(JSON.stringify({ items, page: pg, totalItems: 250, totalPages: 3 }));
      },
      'collections/comment_net/records': (url) => {
        const pg = Number(new URL(url).searchParams.get('page') || 1);
        // Only every third comment has a vote row, on purpose.
        const items = Array.from({ length: 100 }, (_, k) => {
          const n = (pg - 1) * 100 + k + 1;
          return n % 3 === 0 ? { comment: `c${n}`, net: n } : null;
        }).filter(Boolean);
        return ok(JSON.stringify({ items, page: pg, totalItems: 84, totalPages: 3 }));
      }
    });
    const res = await fresh.getComments(CH, ctx);
    expect(res.comments.length).toBe(250);
    const byId = Object.fromEntries(res.comments.map((c) => [c.id, c.likes]));
    // Past the first 100 the old code reported 0 for EVERY later comment,
    // because comment_net was only ever asked for page 1.
    expect(byId.c102).toBe(102);  // page 2
    expect(byId.c201).toBe(201);  // page 3
    // A comment with no vote row is genuinely unliked, not a missing page.
    expect(byId.c1).toBe(0);
    expect(byId.c101).toBe(0);
  });

  it('reads the tag when the chapter title contains ">"', async () => {
    // `[^>]*?` stopped at the first ">" anywhere, so a title with one truncated
    // the tag before entity-id. wpPostId then failed to parse and the chapter
    // silently reported ZERO comments with no error at all.
    const fresh = loadExtension('site.kolnovel.js');
    const CH = 'https://kolnovel.com/ch-gt/';
    const ctx = mockCtx({
      'ch-gt/': () => ok(`<kol-comments slug="s" entity-title="الفصل 1 &gt; البداية" entity-id="900" series-id="7"></kol-comments>`),
      'entities/ensure': (url, init) => {
        const sent = JSON.parse(init.body);
        expect(sent.wpPostId).toBe(900); // reached the ensure call at all
        return ok(JSON.stringify({ id: 'pb-1', commentsCount: 1 }));
      },
      'collections/comments/records': () => ok(JSON.stringify({
        items: [{ id: 'c1', parentId: '', created: '2026-06-01T10:00:00.000Z', normalizedContent: 'x', expand: { author: { name: 'u' } } }],
        totalPages: 1
      })),
      'collections/comment_net/records': () => ok(JSON.stringify({ items: [], totalPages: 1 }))
    });
    const res = await fresh.getComments(CH, ctx);
    expect(res.comments.length).toBe(1);
  });

  it('reads single-quoted and unquoted tag attributes', async () => {
    // The old attribute reader only accepted double quotes, so a single-quoted
    // entity-id read as absent and the chapter reported zero comments.
    const fresh = loadExtension('site.kolnovel.js');
    const single = loadExtension('site.kolnovel.js');
    const base = { 'entities/ensure': () => ok(JSON.stringify({ id: 'pb', commentsCount: 0 })) };
    const s1 = mockCtx({ 'ch-a/': () => ok(`<kol-comments slug='s' entity-title='t' entity-id='900' series-id='7'></kol-comments>`), ...base });
    expect(await single.getCommentCount('https://kolnovel.com/ch-a/', s1)).toEqual({ count: 0 });
    // And an attribute name must not match inside another name ("x-slug").
    const s2 = mockCtx({ 'ch-b/': () => ok(`<kol-comments x-slug="decoy" entity-title="t" entity-id=900 series-id="7"></kol-comments>`), ...base });
    expect((await fresh.getCommentCount('https://kolnovel.com/ch-b/', s2)).count).toBe(0);
  });

  it('downloads the chapter page once when the badge and the list race', async () => {
    // getComments and getCommentCount fire together on chapter open. Each used
    // to fetch the whole ~150 KB page for the tag and POST its own `ensure`.
    const fresh = loadExtension('site.kolnovel.js');
    const CH = 'https://kolnovel.com/ch-race/';
    let pages = 0, ensures = 0;
    const ctx = mockCtx({
      'ch-race/': () => { pages += 1; return ok(`<kol-comments slug="s" entity-title="t" entity-id="900" series-id="7"></kol-comments>`); },
      'entities/ensure': () => { ensures += 1; return ok(JSON.stringify({ id: 'pb', commentsCount: 1 })); },
      'collections/comments/records': () => ok(JSON.stringify({
        items: [{ id: 'c1', parentId: '', created: '2026-06-01T10:00:00.000Z', normalizedContent: 'x', expand: { author: { name: 'u' } } }],
        totalPages: 1
      })),
      'collections/comment_net/records': () => ok(JSON.stringify({ items: [], totalPages: 1 }))
    });
    await Promise.all([fresh.getComments(CH, ctx), fresh.getCommentCount(CH, ctx)]);
    expect(pages).toBe(1);
    expect(ensures).toBe(1);
  });

  it('reports the comment count as a number, not whatever the API typed', async () => {
    // The old line was `ensure.commentsCount || 0` with no conversion, so a
    // string count reached the host, where it is compared against a list length.
    const fresh = loadExtension('site.kolnovel.js');
    const CH = 'https://kolnovel.com/ch-str/';
    const ctx = mockCtx({
      'ch-str/': () => ok(`<kol-comments slug="s" entity-title="t" entity-id="900" series-id="7"></kol-comments>`),
      'entities/ensure': () => ok(JSON.stringify({ id: 'pb', commentsCount: '250' })),
      'collections/comments/records': () => ok(JSON.stringify({ items: [], totalPages: 1 })),
      'collections/comment_net/records': () => ok(JSON.stringify({ items: [], totalPages: 1 }))
    });
    const res = await fresh.getComments(CH, ctx);
    expect(typeof res.count).toBe('number');
    expect(res.count).toBe(250);
  });

  it('shows a reply whose parent was deleted as a top-level comment', async () => {
    // A dangling parentId points at a comment the host cannot find, so the reply
    // has nowhere to nest.
    const fresh = loadExtension('site.kolnovel.js');
    const CH = 'https://kolnovel.com/ch-del/';
    const ctx = mockCtx({
      'ch-del/': () => ok(`<kol-comments slug="s" entity-title="t" entity-id="900" series-id="7"></kol-comments>`),
      'entities/ensure': () => ok(JSON.stringify({ id: 'pb', commentsCount: 1 })),
      'collections/comments/records': () => ok(JSON.stringify({
        items: [{ id: 'c2', parentId: 'c-deleted', created: '2026-06-01T10:00:00.000Z', normalizedContent: 'orphan', expand: { author: { name: 'u' } } }],
        totalPages: 1
      })),
      'collections/comment_net/records': () => ok(JSON.stringify({ items: [], totalPages: 1 }))
    });
    const res = await fresh.getComments(CH, ctx);
    expect(res.comments[0].parentId).toBeNull();
  });

  it('does not stamp an undated comment with the current time', async () => {
    // Date.now() pinned it to the present and sorted it as the newest comment on
    // the chapter. Rows arrive sorted by `created`, so the last good timestamp is
    // the honest fallback.
    const fresh = loadExtension('site.kolnovel.js');
    const CH = 'https://kolnovel.com/ch-date/';
    const good = Date.parse('2026-06-01T10:00:00.000Z');
    const ctx = mockCtx({
      'ch-date/': () => ok(`<kol-comments slug="s" entity-title="t" entity-id="900" series-id="7"></kol-comments>`),
      'entities/ensure': () => ok(JSON.stringify({ id: 'pb', commentsCount: 2 })),
      'collections/comments/records': () => ok(JSON.stringify({
        items: [
          { id: 'c1', parentId: '', created: '2026-06-01T10:00:00.000Z', normalizedContent: 'ok', expand: { author: { name: 'u' } } },
          { id: 'c2', parentId: '', created: 'not-a-date', normalizedContent: 'bad', expand: { author: { name: 'u' } } }
        ],
        totalPages: 1
      })),
      'collections/comment_net/records': () => ok(JSON.stringify({ items: [], totalPages: 1 }))
    });
    const res = await fresh.getComments(CH, ctx);
    expect(res.comments[1].createdAt).toBe(good);
    expect(Math.abs(Date.now() - res.comments[1].createdAt)).toBeGreaterThan(1000);
  });

  it('resolves the author avatar from the real PocketBase shapes', async () => {
    // Verified live against cmtapi.kolnovel.com: `expand.author.avatar` is a
    // BARE FILENAME and the file is served from /api/files/<coll>/<id>/<file>.
    // 32 of 32 sampled authors had one. A wrong URL form would 404 silently and
    // look exactly like "avatars do not work".
    const fresh = loadExtension('site.kolnovel.js');
    const API = 'https://cmtapi.kolnovel.com';
    const rec = { avatar: '645cac_x.png', collectionId: '_pb_users_auth_', collectionName: 'users', id: 'fhzs25k2u2dyf5p' };
    // Bare filename -> the files path, using collectionId (a rename-stable key).
    expect(fresh._cmtAvatar(rec))
      .toBe(`${API}/api/files/_pb_users_auth_/fhzs25k2u2dyf5p/645cac_x.png`);
    // An OAuth sign-in stores the provider's URL instead of uploading a file.
    expect(fresh._cmtAvatar({ avatar: 'https://cdn.example/p.jpg' })).toBe('https://cdn.example/p.jpg');
    expect(fresh._cmtAvatar({ avatar: '//cdn.example/p.jpg' })).toBe('https://cdn.example/p.jpg');
    expect(fresh._cmtAvatar({ avatar: '/uploads/p.jpg' })).toBe(`${API}/uploads/p.jpg`);
    // Multi-file fields arrive as an array; the first entry wins.
    expect(fresh._cmtAvatar({ avatar: ['a.png', 'b.png'], collectionId: 'c', id: 'i' }))
      .toBe(`${API}/api/files/c/i/a.png`);
    // Nothing to build a URL from -> '' so the key is never emitted at all.
    expect(fresh._cmtAvatar({ avatar: 'x.png' })).toBe('');           // no collection/id
    expect(fresh._cmtAvatar({ avatar: '' })).toBe('');
    expect(fresh._cmtAvatar({})).toBe('');
    expect(fresh._cmtAvatar(null)).toBe('');
  });

  it('emits authorAvatar on comments that have one, and omits it otherwise', async () => {
    const fresh = loadExtension('site.kolnovel.js');
    const CH = 'https://kolnovel.com/ch-av/';
    const withAvatar = (id, avatar) => ({
      id, parentId: '', created: '2026-06-01T10:00:00.000Z', normalizedContent: 'x',
      expand: { author: { name: 'u' + id, avatar, collectionId: '_pb_users_auth_', id: 'rec' + id } }
    });
    const ctx = mockCtx({
      'ch-av/': ok(`<kol-comments slug="s" entity-title="t" entity-id="900" series-id="7"></kol-comments>`),
      'entities/ensure': ok(JSON.stringify({ id: 'pb', commentsCount: 2 })),
      'collections/comments/records': ok(JSON.stringify({
        items: [withAvatar(1, 'a.png'), withAvatar(2, '')], totalPages: 1
      })),
      'collections/comment_net/records': ok(JSON.stringify({ items: [], totalPages: 1 }))
    });
    const res = await fresh.getComments(CH, ctx);
    expect(res.comments[0].authorAvatar)
      .toBe('https://cmtapi.kolnovel.com/api/files/_pb_users_auth_/rec1/a.png');
    // No key at all for the author without one, so the host can tell it apart
    // from an empty string and keep the letter avatar.
    expect('authorAvatar' in res.comments[1]).toBe(false);
  });

  it('postComment and voteComment require a saved login', async () => {
    const ctx = mockCtx();
    await expect(ext.postComment('https://kolnovel.com/ch-test-291266/', { body: 'x' }, ctx)).rejects.toThrow('kolnovel-auth-required');
    await expect(ext.voteComment('https://kolnovel.com/ch-test-291266/', { commentId: 'c1', vote: 1 }, ctx)).rejects.toThrow('kolnovel-auth-required');
  });

  it('postComment creates a comment record with the saved user id', async () => {
    const fresh = loadExtension('site.kolnovel.js');
    const CH = 'https://kolnovel.com/ch-post/';
    let sentBody = null;
    const ctx = mockCtx({
      'ch-post/': ok(`<kol-comments slug="s" entity-title="t" entity-id="900" series-id="7"></kol-comments>`),
      'entities/ensure': ok(JSON.stringify({ id: 'pb-entity', commentsCount: 0 })),
      'collections/comments/records': (url, init) => {
        sentBody = JSON.parse(init.body);
        return ok(JSON.stringify({ id: 'new-c1' }));
      },
    });
    const res = await fresh.postComment(CH, { body: 'hello', siteUserId: 'u1', author: 'u', email: 'e' }, ctx);
    expect(res).toEqual({ ok: true, id: 'new-c1' });
    expect(sentBody.author).toBe('u1');
    expect(sentBody.entity).toBe('pb-entity');
    expect(sentBody.text).toContain('hello');
  });

  it('postComment surfaces an expired session with a stable code', async () => {
    const fresh = loadExtension('site.kolnovel.js');
    const CH = 'https://kolnovel.com/ch-exp/';
    const ctx = mockCtx({
      'ch-exp/': ok(`<kol-comments slug="s" entity-title="t" entity-id="900" series-id="7"></kol-comments>`),
      'entities/ensure': ok(JSON.stringify({ id: 'pb', commentsCount: 0 })),
      'collections/comments/records': { ok: false, status: 401, text: '' },
    });
    await expect(fresh.postComment(CH, { body: 'x', siteUserId: 'u1' }, ctx)).rejects.toThrow('kolnovel-auth-expired');
  });

  it('voteComment toggles an existing vote off', async () => {
    const fresh = loadExtension('site.kolnovel.js');
    const calls = [];
    const ctx = mockCtx({
      'comment_votes/records?perPage=1&filter=': ok(JSON.stringify({ items: [{ id: 'v1', value: 1 }] })),
      'comment_votes/records/v1': (url, init) => {
        calls.push(init.method);
        return init.method === 'DELETE' ? ok('{}') : { ok: false, status: 500, text: '' };
      },
      'comment_net/records': ok(JSON.stringify({ items: [{ comment: 'c1', net: 4 }] })),
    });
    const res = await fresh.voteComment('https://kolnovel.com/ch/', { commentId: 'c1', vote: 1, siteUserId: 'u1' }, ctx);
    expect(calls).toEqual(['DELETE']);
    expect(res).toEqual({ ok: true, likes: 4, liked: false });
  });

  it('voteComment creates a vote when none exists', async () => {
    const fresh = loadExtension('site.kolnovel.js');
    let created = null;
    const ctx = mockCtx({
      'comment_votes/records?perPage=1&filter=': ok(JSON.stringify({ items: [] })),
      'comment_votes/records': (url, init) => {
        if (init.method === 'POST') {
          created = JSON.parse(init.body);
          return ok(JSON.stringify({ id: 'v9' }));
        }
        return { ok: false, status: 404, text: '' };
      },
      'comment_net/records': ok(JSON.stringify({ items: [{ comment: 'c1', net: 1 }] })),
    });
    const res = await fresh.voteComment('https://kolnovel.com/ch/', { commentId: 'c1', vote: 1, siteUserId: 'u1' }, ctx);
    expect(created).toMatchObject({ comment: 'c1', user: 'u1', value: 1 });
    expect(res).toEqual({ ok: true, likes: 1, liked: true });
  });

  it('declares a valid login descriptor for host auto-discovery', () => {
    expect(ext.auth).toMatchObject({
      kind: 'pocketbase',
      apiBaseUrl: 'https://cmtapi.kolnovel.com',
    });
    expect(ext.auth.sso).toMatchObject({
      clientId: 'kol-comments-widget',
      exchangePath: '/api/auth/kolnovel/exchange',
    });
    expect(typeof ext.auth.registerUrl).toBe('string');
  });
});
