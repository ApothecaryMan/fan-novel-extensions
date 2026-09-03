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
  it('has correct version', () => expect(ext.version).toBe('1.5.0'));
  it('has apiVersion 1', () => expect(ext.apiVersion).toBe(1));
  it('has correct baseUrl', () => expect(ext.baseUrl).toBe('https://kolnovel.com'));

  it('exposes all required methods', () => {
    const required = [
      'parseNovelInfo', 'parseChapterList', 'parseChapterContent',
      'searchNovels', 'getPopularNovels', 'getCategories', 'getCategoryNovels',
      'fetchLatestChapters',
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

  it('defaults category when no genres found', async () => {
    const ctx = mockCtx({ '/novel-nogenre': ok(NOVEL_PAGE_NO_GENRES) });
    const info = await ext.parseNovelInfo('/novel-nogenre', ctx);
    expect(info.category).toBe('روايات مترجمة');
    expect(info.tags).toEqual([]);
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
