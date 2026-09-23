import { describe, it, expect, beforeAll } from 'vitest';
import { loadExtension, mockCtx, ok } from './helpers.js';
import {
  BOOK_PAGE,
  TITLECHILDS_FRAG,
  PAGECONTENT_JSON,
  CONTENT_PAGE_HTML,
  CATEGORY_PAGE,
  SEARCH_JSON
} from './fixtures/shamela.js';

let ext;

beforeAll(() => {
  ext = loadExtension('site.shamela.js');
});

describe('Shamela Extension metadata', () => {
  it('has correct id and fields', () => {
    expect(ext.id).toBe('site:shamela');
    expect(ext.name).toBe('المكتبة الشاملة');
    expect(ext.lang).toBe('ar');
    expect(ext.apiVersion).toBe(1);
    expect(ext.baseUrl).toBe('https://shamela.ws');
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

describe('Shamela Parsing logic with fixtures', () => {
  it('parses novel info with author and category', async () => {
    const url = 'https://shamela.ws/book/30196';
    const ctx = mockCtx({ [url]: ok(BOOK_PAGE) });
    const info = await ext.parseNovelInfo(url, ctx);

    expect(info.title).toContain('شواهد القرآن');
    expect(info.author).toContain('أبو عبيد');
    expect(info.category).toBe('علوم القرآن وأصول التفسير');
    expect(info.status).toBe('مكتملة');
    expect(info.totalChapters).toBe(5);
    // Reading-time estimate: 196 printed pages × ~300 words ÷ 140 wpm.
    expect(info.wordCount).toBe(196 * 300);
    expect(info.readingMinutes).toBe(Math.max(1, Math.round(196 * 300 / 140)));
  });

  it('dedupes repeated pageIds in chapter list', async () => {
    const url = 'https://shamela.ws/book/30196';
    const ctx = mockCtx({
      '/ajax/titlechilds/': ok(TITLECHILDS_FRAG),
      [url]: ok(BOOK_PAGE)
    });
    const chapters = await ext.parseChapterList(url, ctx);
    const urls = chapters.map(c => c.url);

    // /60 appears twice (٩ and ١٠) but must yield one chapter
    expect(urls.filter(u => u.endsWith('/book/30196/60')).length).toBe(1);
    expect(new Set(urls).size).toBe(urls.length);
    expect(chapters[0].number).toBe(1);
  });

  it('expands collapsed [+] nodes via titlechilds', async () => {
    const url = 'https://shamela.ws/book/30196';
    const ctx = mockCtx({
      '/ajax/titlechilds/': ok(TITLECHILDS_FRAG),
      [url]: ok(BOOK_PAGE)
    });
    const chapters = await ext.parseChapterList(url, ctx);
    const titles = chapters.map(c => c.title);

    expect(titles).toContain('ترجمة المصنف');
    expect(titles).toContain('دراسة وتحليل');
  });

  it('parses chapter content from pageContent JSON and strips copy buttons', async () => {
    const url = 'https://shamela.ws/book/30196/1';
    const ctx = mockCtx({ '/ajax/pageContent/': ok(PAGECONTENT_JSON) });
    const text = await ext.parseChapterContent(url, ctx);

    expect(text).toContain('تقديم');
    expect(text).toContain('الحمد لله');
    expect(text).not.toContain('btn_tag');
    expect(text).not.toContain('fa-copy');
  });

  it('falls back to div.nass HTML when JSON fails', async () => {
    const url = 'https://shamela.ws/book/30195/2';
    const ctx = mockCtx({
      '/ajax/pageContent/30195/2': { ok: false, status: 500, text: '' },
      '/book/30195/2': ok(CONTENT_PAGE_HTML)
    });
    const text = await ext.parseChapterContent(url, ctx);

    expect(text).toContain('نص الفقرة الأولى');
    expect(text).toContain('نص الفقرة الثانية\nمع بيت شعر');
  });

  it('searches books via ajax select2 endpoint', async () => {
    const ctx = mockCtx({ '/ajax/book/': ok(SEARCH_JSON) });
    const results = await ext.searchNovels('شواهد', 1, ctx);

    expect(results.length).toBe(2);
    expect(results[0].url).toBe('https://shamela.ws/book/30196');
    expect(results[0].title).toBe('شواهد القرآن');
  });

  it('parses category book items with authors', async () => {
    const ctx = mockCtx({ '/category/32': ok(CATEGORY_PAGE) });
    const results = await ext.getCategoryNovels('32', 1, ctx);

    expect(results.length).toBe(2);
    expect(results[0].title).toBe('كليلة ودمنة');
    expect(results[0].author).toBe('ابن المقفع');
    expect(results[0].url).toContain('/book/26537');
  });

  it('returns fixed category list', async () => {
    const categories = await ext.getCategories();
    expect(categories.length).toBeGreaterThan(10);
    const adab = categories.find(c => c.slug === '32');
    expect(adab).toBeDefined();
    expect(adab.name).toBe('الأدب');
  });
});
