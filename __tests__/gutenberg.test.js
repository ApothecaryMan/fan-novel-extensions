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
