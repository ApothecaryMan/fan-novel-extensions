import { describe, it, expect, beforeAll } from 'vitest';
import { loadExtension, mockCtx, ok } from './helpers.js';
import { BOOK_HTML, EBOOK_HTML, TEXT_BOOK } from './fixtures/gutenberg.js';

let ext;

beforeAll(() => {
  ext = loadExtension('site.gutenberg.js');
});

describe('Gutenberg extension metadata', () => {
  it('has correct id and fields', () => {
    expect(ext.id).toBe('site:gutenberg');
    expect(ext.name).toBe('Project Gutenberg');
    expect(ext.lang).toBe('en');
    expect(ext.apiVersion).toBe(1);
    expect(ext.baseUrl).toBe('https://www.gutenberg.org');
  });

  it('exposes required methods', () => {
    const required = [
      'parseNovelInfo',
      'parseChapterList',
      'parseChapterContent',
      'searchNovels',
      'getPopularNovels',
      'getCategories',
      'getCategoryNovels',
      'getSortOptions',
      'fetchLatestChapters'
    ];
    for (const m of required) expect(typeof ext[m]).toBe('function');
  });
});

describe('Gutenberg local catalog', () => {
  it('searches by title without any network call', async () => {
    const results = await ext.searchNovels('pride and prejudice', 1, mockCtx());
    expect(results.some((r) => r.title === 'Pride and Prejudice')).toBe(true);
  });

  it('paginates search results', async () => {
    const page1 = await ext.searchNovels('the', 1, mockCtx());
    const page2 = await ext.searchNovels('the', 2, mockCtx());
    expect(page1.length).toBe(20);
    expect(page2.length).toBeGreaterThan(0);
    expect(page1[0].url).not.toBe(page2[0].url);
  });

  it('returns popular books from the catalog', async () => {
    const results = await ext.getPopularNovels(1, mockCtx());
    expect(results[0].url).toContain('/ebooks/2701');
  });

  it('lists categories and filters by tag', async () => {
    const cats = await ext.getCategories();
    expect(cats.some((c) => c.slug === 'poetry')).toBe(true);
    const poetry = await ext.getCategoryNovels('poetry', 1, mockCtx());
    expect(poetry.some((r) => r.url.includes('/ebooks/1727'))).toBe(true);
  });
});

describe('Gutenberg sort options', () => {
  it('returns the six catalogue orderings with Arabic labels', async () => {
    const opts = await ext.getSortOptions(mockCtx());
    expect(opts).toHaveLength(6);
    const bySlug = Object.fromEntries(opts.map((o) => [o.slug, o.name]));
    expect(bySlug.popular).toBe('الأكثر شعبية');
    expect(bySlug.title).toBe('A-Z');
    expect(bySlug['title-desc']).toBe('Z-A');
    expect(bySlug.author).toBe('المؤلف A-Z');
    expect(bySlug.oldest).toBe('الأقدم');
    expect(bySlug.newest).toBe('الأحدث');
  });
});

describe('Gutenberg sorted browse', () => {
  const sortTitle = (s) => String(s || '').toLowerCase()
    .replace(/^[\s"'“”‘’\[\](){}.,;:!?—–\-$]+/, '')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/^[\s"'“”‘’\[\](){}.,;:!?—–\-$]+/, '');
  const titlesOf = (list) => list.map((r) => sortTitle(r.title));
  const idsOf = (list) => list.map((r) => Number(r.url.match(/\/(\d+)$/)[1]));

  it('sorts the whole catalog by title before paginating', async () => {
    const page1 = await ext.getPopularNovels(1, 'title', mockCtx());
    const page2 = await ext.getPopularNovels(2, 'title', mockCtx());
    expect(page1).toHaveLength(20);
    const titles = titlesOf(page1);
    expect(page1[0].title.charAt(0)).not.toBe('"');
    expect(titles).toEqual(titles.slice().sort());
    expect(titles[titles.length - 1] <= titlesOf(page2)[0]).toBe(true);
  });

  it('sorts title-desc', async () => {
    const page1 = await ext.getPopularNovels(1, 'title-desc', mockCtx());
    const titles = titlesOf(page1);
    expect(titles).toEqual(titles.slice().sort().reverse());
  });

  it('sorts by Gutenberg id', async () => {
    const oldest = await ext.getPopularNovels(1, 'oldest', mockCtx());
    const newest = await ext.getPopularNovels(1, 'newest', mockCtx());
    expect(idsOf(oldest)).toEqual(idsOf(oldest).slice().sort((a, b) => a - b));
    expect(idsOf(newest)).toEqual(idsOf(newest).slice().sort((a, b) => b - a));
  });

  it('keeps the default popular order when no sort is given', async () => {
    const def = await ext.getPopularNovels(1, mockCtx());
    const popular = await ext.getPopularNovels(1, 'popular', mockCtx());
    const unknown = await ext.getPopularNovels(1, 'nope', mockCtx());
    expect(def.map((r) => r.url)).toEqual(popular.map((r) => r.url));
    expect(def.map((r) => r.url)).toEqual(unknown.map((r) => r.url));
  });

  it('sorts category results and keeps the old signature', async () => {
    const sorted = await ext.getCategoryNovels('poetry', 1, 'title', mockCtx());
    const titles = titlesOf(sorted);
    expect(sorted.length).toBeGreaterThan(0);
    expect(titles).toEqual(titles.slice().sort());
    expect(sorted.every((r) => r.title && r.title.charAt(0) !== '"')).toBe(true);

    const legacy = await ext.getCategoryNovels('poetry', 1, mockCtx());
    const explicit = await ext.getCategoryNovels('poetry', 1, 'popular', mockCtx());
    expect(legacy.map((r) => r.url)).toEqual(explicit.map((r) => r.url));
  });
});

describe('Gutenberg metadata and chapters', () => {
  it('builds novel info from the local catalog and the book html', async () => {
    const url = 'https://www.gutenberg.org/ebooks/1342';
    const ctx = mockCtx({ 'pg1342-images.html': ok(BOOK_HTML) });
    const info = await ext.parseNovelInfo(url, ctx);

    expect(info.title).toBe('Pride and Prejudice');
    expect(info.author).toBe('Jane Austen');
    expect(info.coverUrl).toContain('pg1342.cover.medium.jpg');
    expect(info.totalChapters).toBe(3);
    expect(info.wordCount).toBeGreaterThan(0);
    expect(info.readingMinutes).toBeGreaterThan(0);
    expect(info.summary).toContain('Project Gutenberg');
  });

  it('lists TOC chapters from html', async () => {
    const url = 'https://www.gutenberg.org/ebooks/1342';
    const ctx = mockCtx({ 'pg1342-images.html': ok(BOOK_HTML) });
    const chapters = await ext.parseChapterList(url, ctx);

    expect(chapters.map((c) => c.title)).toEqual(['Preface.', 'Chapter I.', 'Chapter II.']);
    expect(chapters[0].url).toBe('https://www.gutenberg.org/ebooks/1342#PREFACE');
    expect(chapters[1].url).toBe('https://www.gutenberg.org/ebooks/1342#Chapter_I');
    expect(chapters[2].number).toBe(3);
    expect(chapters.some((c) => /^\{/.test(c.title))).toBe(false);
    expect(chapters.some((c) => /caption/i.test(c.title))).toBe(false);
  });

  it('returns only the selected chapter and strips the pg footer', async () => {
    const url = 'https://www.gutenberg.org/ebooks/1342';
    const ctx = mockCtx({ 'pg1342-images.html': ok(BOOK_HTML) });
    await ext.parseChapterList(url, ctx);

    const content = await ext.parseChapterContent(url + '#Chapter_II', ctx);
    expect(content).toContain('MR. BENNET was here.');
    expect(content).toContain('Second chapter paragraph two.');
    expect(content).not.toContain('First chapter paragraph');
    expect(content).not.toContain('A caption.');
    expect(content).not.toContain('LICENSE');
  });

  it('falls back to plain text and the ebook page for unknown ids', async () => {
    const url = 'https://www.gutenberg.org/ebooks/999999';
    const ctx = mockCtx({
      '/ebooks/999999': ok(EBOOK_HTML),
      'pg999999.txt': ok(TEXT_BOOK)
    });

    const info = await ext.parseNovelInfo(url, ctx);
    expect(info.title).toBe('Test Book');
    expect(info.author).toBe('Jane Austen');
    expect(info.totalChapters).toBe(2);

    const chapters = await ext.parseChapterList(url, ctx);
    expect(chapters.length).toBe(2);
    expect(chapters[0].url).toBe('https://www.gutenberg.org/ebooks/999999#pg-chapter-1');

    const content = await ext.parseChapterContent(chapters[1].url, ctx);
    expect(content).toContain('Second text chapter paragraph.');
    expect(content).not.toContain('START OF');
  });

  it('never reports new chapters for a static book', async () => {
    expect(await ext.fetchLatestChapters('https://www.gutenberg.org/ebooks/1342', 2, mockCtx())).toEqual([]);
  });
});
