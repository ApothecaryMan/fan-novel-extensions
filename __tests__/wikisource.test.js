import { describe, it, expect, beforeAll } from 'vitest';
import { loadExtension, mockCtx, ok } from './helpers.js';
import {
  MAIN_INDEX,
  SUBPAGE_SMALL,
  MAIN_ONE_SUB_BIG,
  SUBPAGE_BIG,
  DIWAN_MAIN,
  CHAPTER_VERSE,
  SEARCH_JSON,
  CATEGORY_JSON
} from './fixtures/wikisource.js';

let ext;

beforeAll(() => {
  ext = loadExtension('site.wikisource.js');
});

describe('Wikisource Extension metadata', () => {
  it('has correct id and fields', () => {
    expect(ext.id).toBe('site:wikisource');
    expect(ext.name).toBe('ويكي مصدر');
    expect(ext.lang).toBe('ar');
    expect(ext.apiVersion).toBe(1);
    expect(ext.baseUrl).toBe('https://ar.wikisource.org');
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

describe('Wikisource Parsing logic with fixtures', () => {
  it('parses novel info from ws-data header', async () => {
    const url = 'https://ar.wikisource.org/wiki/%D9%83%D9%84%D9%8A%D9%84%D8%A9_%D9%88%D8%AF%D9%85%D9%86%D8%A9';
    const ctx = mockCtx({ [url]: ok(MAIN_INDEX) });
    const info = await ext.parseNovelInfo(url, ctx);

    expect(info.title).toBe('كليلة ودمنة');
    expect(info.author).toBe('ابن المقفع');
    expect(info.status).toBe('مكتملة');
    expect(info.totalChapters).toBe(2);
    expect(info.summary).toContain('كليلة ودمنة');
  });

  it('lists subpages as chapters without splitting small pages', async () => {
    const url = 'https://ar.wikisource.org/wiki/%D9%83%D9%84%D9%8A%D9%84%D8%A9_%D9%88%D8%AF%D9%85%D9%86%D8%A9';
    const ctx = mockCtx({
      '%D8%A8%D8%A7%D8%A8_%D9%85%D9%82%D8%AF%D9%85%D8%A9': ok(SUBPAGE_SMALL),
      '%D8%A8%D8%A7%D8%A8_%D8%A7%D9%84%D8%A3%D8%B3%D8%AF': ok(SUBPAGE_SMALL),
      [url]: ok(MAIN_INDEX)
    });
    const chapters = await ext.parseChapterList(url, ctx);

    expect(chapters.length).toBe(2);
    expect(chapters[0].number).toBe(1);
    expect(chapters[0].title).toContain('مقدمة');
    expect(chapters[1].title).toContain('الأسد');
  });

  it('expands mega subpages into h2 anchor chapters', async () => {
    const url = 'https://ar.wikisource.org/wiki/%D9%83%D8%AA%D8%A7%D8%A8_%D8%A7%D9%84%D8%A7%D8%AE%D8%AA%D8%A8%D8%A7%D8%B1';
    const subUrl = 'https://ar.wikisource.org/wiki/%D9%83%D8%AA%D8%A7%D8%A8_%D8%A7%D9%84%D8%A7%D8%AE%D8%AA%D8%A8%D8%A7%D8%B1/%D8%A7%D9%84%D8%AC%D8%B2%D8%A1_%D8%A7%D9%84%D8%A3%D9%88%D9%84';
    const ctx = mockCtx({
      [subUrl]: ok(SUBPAGE_BIG),
      [url]: ok(MAIN_ONE_SUB_BIG)
    });
    const chapters = await ext.parseChapterList(url, ctx);

    expect(chapters.length).toBe(6);
    expect(chapters[0].url).toContain('#story_one');
    expect(chapters[0].title).toContain('الحكاية الأولى');
    expect(chapters[5].url).toContain('#story_six');
  });

  it('falls back to h2 anchors when no subpages exist', async () => {
    const url = 'https://ar.wikisource.org/wiki/%D8%AF%D9%8A%D9%88%D8%A7%D9%86_%D8%A7%D9%84%D8%A7%D8%AE%D8%AA%D8%A8%D8%A7%D8%B1';
    const ctx = mockCtx({ [url]: ok(DIWAN_MAIN) });
    const chapters = await ext.parseChapterList(url, ctx);

    expect(chapters.length).toBe(2);
    expect(chapters[0].url).toContain('#qafiya_ra');
    expect(chapters[0].title).toBe('قافية الراء');
  });

  it('parses full chapter and preserves verse <br/> breaks', async () => {
    const url = 'https://ar.wikisource.org/wiki/test/Page';
    const ctx = mockCtx({ [url]: ok(CHAPTER_VERSE) });
    const text = await ext.parseChapterContent(url, ctx);

    expect(text).toContain('سطر أول\nسطر ثان');
    expect(text).toContain('فقرة عادية');
    expect(text).not.toContain('<p>');
  });

  it('slices a single h2 anchor section', async () => {
    const url = 'https://ar.wikisource.org/wiki/test/Page#story_two';
    const ctx = mockCtx({ 'test/Page': ok(CHAPTER_VERSE) });
    const text = await ext.parseChapterContent(url, ctx);

    expect(text).toContain('الحكاية الثانية');
    expect(text).not.toContain('سطر أول');
  });

  it('searches via Action API and skips namespace hits', async () => {
    const ctx = mockCtx({ 'action=query': ok(SEARCH_JSON) });
    const results = await ext.searchNovels('كليلة', 1, ctx);

    expect(results.length).toBe(2);
    expect(results[0].title).toBe('كليلة ودمنة');
    expect(results[0].url).toContain('/wiki/');
  });

  it('browses category members skipping non-main namespace', async () => {
    const ctx = mockCtx({ 'categorymembers': ok(CATEGORY_JSON) });
    const results = await ext.getPopularNovels(1, ctx);

    expect(results.length).toBe(2);
    expect(results[0].title).toBe('ألف ليلة وليلة');
  });

  it('returns story categories', async () => {
    const categories = await ext.getCategories();
    expect(categories.length).toBeGreaterThan(5);
    const qissa = categories.find(c => c.slug === 'قصة');
    expect(qissa).toBeDefined();
  });
});
