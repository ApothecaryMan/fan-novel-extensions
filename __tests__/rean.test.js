import { describe, it, expect, beforeAll } from 'vitest';
import { loadExtension, mockCtx, ok } from './helpers.js';
import {
  REAN_NOVEL_PAGE_INLINE,
  REAN_NOVEL_PAGE_AJAX,
  REAN_AJAX_CHAPTERS,
  REAN_SEARCH_RESULTS,
  REAN_CHAPTER_CONTENT
} from './fixtures/rean.js';

let ext;

beforeAll(() => {
  ext = loadExtension('site.rean.js');
});

describe('site:rean extension', () => {
  it('has valid metadata', () => {
    expect(ext.id).toBe('site:rean');
    expect(ext.name).toBe('شبكة ريان');
    expect(ext.lang).toBe('ar');
    expect(ext.version).toBe('1.0.0');
    expect(ext.apiVersion).toBe(1);
    expect(ext.baseUrl).toBe('https://rean.org');
  });

  it('exposes all required contract methods', () => {
    const methods = [
      'parseNovelInfo',
      'parseChapterList',
      'parseChapterContent',
      'searchNovels',
      'getPopularNovels',
      'getCategories',
      'getCategoryNovels',
      'fetchLatestChapters'
    ];
    for (const m of methods) {
      expect(typeof ext[m]).toBe('function');
    }
  });

  it('parses novel info correctly', async () => {
    const ctx = mockCtx({
      'novel/shadow-mage/': ok(REAN_NOVEL_PAGE_INLINE)
    });
    const info = await ext.parseNovelInfo('https://rean.org/novel/shadow-mage/', ctx);
    expect(info.title).toBe('رواية ساحر الظلال');
    expect(info.author).toBe('الكاتب المبدع');
    expect(info.coverUrl).toBe('https://rean.org/wp-content/uploads/cover.jpg');
    expect(info.status).toBe('مستمرة');
    expect(info.summary).toContain('بطل يستيقظ في عالم سحري غامض');
    expect(info.tags).toContain('أكشن');
    expect(info.tags).toContain('فنتازيا');
  });

  it('parses inline chapter list and normalizes titles/numbers in ascending order', async () => {
    const ctx = mockCtx({
      'novel/shadow-mage/': ok(REAN_NOVEL_PAGE_INLINE)
    });
    const chapters = await ext.parseChapterList('https://rean.org/novel/shadow-mage/', ctx);
    expect(chapters.length).toBe(2);
    expect(chapters[0].number).toBe(1);
    expect(chapters[0].title).toBe('الفصل 1 - البداية');
    expect(chapters[1].number).toBe(2);
    expect(chapters[1].title).toBe('الفصل 2 - القوة الخفية');
    expect(chapters[0].url).toBe('https://rean.org/novel/shadow-mage/chapter-1/');
  });

  it('fetches AJAX chapters dynamically when chapters are not inline', async () => {
    const ctx = {
      log: () => {},
      xFetch: async (urlOrOpts, init) => {
        const url = typeof urlOrOpts === 'string' ? urlOrOpts : urlOrOpts.url;
        const opts = init || (typeof urlOrOpts === 'object' ? urlOrOpts : {});

        if (url.includes('novel/dragon-lord/')) {
          return ok(REAN_NOVEL_PAGE_AJAX);
        }
        if (url.includes('admin-ajax.php')) {
          expect(opts.method).toBe('POST');
          expect(opts.body).toContain('action=manga_get_chapters&manga=54321');
          return ok(REAN_AJAX_CHAPTERS);
        }
        return { ok: false, status: 404, text: '' };
      }
    };

    const chapters = await ext.parseChapterList('https://rean.org/novel/dragon-lord/', ctx);
    expect(chapters.length).toBe(2);
    expect(chapters[0].number).toBe(10);
    expect(chapters[0].title).toBe('الفصل 10 - الاستيقاظ');
    expect(chapters[1].number).toBe(20);
    expect(chapters[1].title).toBe('الفصل 20 - المعركة الفاصلة');
  });

  it('filters latest chapters incrementally with fetchLatestChapters', async () => {
    const ctx = mockCtx({
      'novel/shadow-mage/': ok(REAN_NOVEL_PAGE_INLINE)
    });
    const latest = await ext.fetchLatestChapters('https://rean.org/novel/shadow-mage/', 1, ctx);
    expect(latest.length).toBe(1);
    expect(latest[0].number).toBe(2);
  });

  it('extracts chapter content cleanly without ads or code blocks', async () => {
    const ctx = mockCtx({
      'chapter-1/': ok(REAN_CHAPTER_CONTENT)
    });
    const content = await ext.parseChapterContent('https://rean.org/novel/shadow-mage/chapter-1/', ctx);
    expect(content).not.toContain('إعلان برعاية موقع كذا');
    expect(content).not.toContain('إعلان أسفل النص');
    expect(content).not.toContain('var x = 1;');
    expect(content).toContain('في ليلة مظلمة عاصفة');
    expect(content).toContain('كانت الرياح تعصف بشدة');
  });

  it('searches novels and extracts novel cards', async () => {
    const ctx = mockCtx({
      'post_type=wp-manga': ok(REAN_SEARCH_RESULTS)
    });
    const results = await ext.searchNovels('ظلال', 1, ctx);
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('رواية ساحر الظلال');
    expect(results[0].author).toBe('الكاتب المبدع');
    expect(results[0].url).toBe('https://rean.org/novel/shadow-mage/');
  });

  it('returns predefined categories', async () => {
    const cats = await ext.getCategories();
    expect(cats.length).toBeGreaterThan(5);
    expect(cats[0]).toHaveProperty('name');
    expect(cats[0]).toHaveProperty('slug');
  });
});
