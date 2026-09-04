import { describe, it, expect, beforeAll } from 'vitest';
import { loadExtension, mockCtx, ok } from './helpers.js';
import { CATALOG_PAGE, NOVEL_PAGE, CHAPTER_PAGE, SEARCH_PAGE } from './fixtures/hindawi.js';

let ext;

beforeAll(() => {
  ext = loadExtension('site.hindawi.js');
});

describe('Hindawi Extension metadata', () => {
  it('has correct id and fields', () => {
    expect(ext.id).toBe('site:hindawi');
    expect(ext.name).toBe('مؤسسة هنداوي');
    expect(ext.lang).toBe('ar');
    expect(ext.apiVersion).toBe(1);
    expect(ext.baseUrl).toBe('https://www.safahat.org');
  });

  it('exposes required methods', () => {
    const required = [
      'parseNovelInfo',
      'parseChapterList',
      'parseChapterContent',
      'searchNovels',
      'getPopularNovels',
      'getCategories',
      'getCategoryNovels'
    ];
    for (const m of required) {
      expect(typeof ext[m]).toBe('function');
    }
  });
});

describe('Hindawi Parsing logic with fixtures', () => {
  it('parses catalog books correctly', async () => {
    const ctx = mockCtx({ 'https://www.safahat.org/books/': ok(CATALOG_PAGE) });
    const books = await ext.getPopularNovels(1, ctx);
    expect(books.length).toBe(2);
    expect(books[0].title).toBe('التفسير الموضوعي للقرآن الكريم');
    expect(books[0].url).toContain('/books/75705282/');
    expect(books[0].coverUrl).toContain('75705282.jpg');
    expect(books[0].status).toBe('مكتملة');
  });

  it('parses novel details and metadata correctly', async () => {
    const novelUrl = 'https://www.safahat.org/books/25868315/';
    const ctx = mockCtx({ [novelUrl]: ok(NOVEL_PAGE) });
    const info = await ext.parseNovelInfo(novelUrl, ctx);

    expect(info.title).toBe('الحرير');
    expect(info.author).toBe('أليساندرو باريكو');
    expect(info.translator).toBe('طلعت الشايب');
    expect(info.status).toBe('مكتملة');
    expect(info.category).toBe('روايات');
    expect(info.tags).toEqual(['روايات']);
    expect(info.wordCount).toBe(13069);
    expect(info.readingMinutes).toBe(93);
    expect(info.coverUrl).toBe('https://downloads.hindawi.org/covers/304x406/25868315.jpg');
    expect(info.summary).toContain('هيرفي جونكور');
  });

  it('parses chapter list correctly from book index', async () => {
    const novelUrl = 'https://www.safahat.org/books/25868315/';
    const ctx = mockCtx({ [novelUrl]: ok(NOVEL_PAGE) });
    const chapters = await ext.parseChapterList(novelUrl, ctx);

    expect(chapters.length).toBe(2);
    expect(chapters[0].title).toContain('مقدمة الأعمال الكاملة');
    expect(chapters[1].title).toBe('الحرير');
    expect(chapters[1].url).toBe('https://www.safahat.org/books/25868315/1/');
  });

  it('parses chapter text content cleanly', async () => {
    const chUrl = 'https://www.safahat.org/books/25868315/1/';
    const ctx = mockCtx({ [chUrl]: ok(CHAPTER_PAGE) });
    const text = await ext.parseChapterContent(chUrl, ctx);

    expect(typeof text).toBe('string');
    expect(text).toContain('هيرفي جونكور');
    expect(text).not.toContain('<article');
  });

  it('parses search results correctly', async () => {
    const searchUrl = 'https://www.safahat.org/search/keyword/%D9%86%D8%AC%D9%8A%D8%A8/';
    const ctx = mockCtx({ [searchUrl]: ok(SEARCH_PAGE) });
    const results = await ext.searchNovels('نجيب', 1, ctx);

    expect(results.length).toBe(1);
    expect(results[0].title).toBe('نجيب محفوظ في عيون العالم');
    expect(results[0].author).toBe('محمد عناني');
    expect(results[0].status).toBe('مكتملة');
  });

  it('returns structured category topics', async () => {
    const categories = await ext.getCategories();
    expect(categories.length).toBeGreaterThan(10);
    const novelsCat = categories.find(c => c.slug === 'novels');
    expect(novelsCat).toBeDefined();
    expect(novelsCat.name).toBe('روايات');
  });
});
