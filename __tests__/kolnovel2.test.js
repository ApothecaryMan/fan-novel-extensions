import { describe, it, expect, beforeAll } from 'vitest';
import { loadExtension, mockCtx, ok } from './helpers.js';
import { SEARCH_V2, ARCHIVE_V2, GENRE_V2, HOME_V2, NOVEL_V2, CHAPTER_V2, NO_RESULTS_V2 } from './fixtures/kolnovel2.js';

let ext;
beforeAll(() => { ext = loadExtension('site.kolnovel2.js'); });

describe('V2 metadata', () => {
  it('has correct id', () => expect(ext.id).toBe('site:kolnovel-v2'));
  it('has correct name', () => expect(ext.name).toBe('كول نوفيل'));
  it('has version 2.1.0', () => expect(ext.version).toBe('2.1.0'));
  it('has apiVersion 2', () => expect(ext.apiVersion).toBe(2));
  it('exposes 13 methods', () => {
    for (const m of ['parseNovelInfo','parseChapterList','fetchLatestChapters','parseChapterContent','searchNovels','getPopularNovels','getCategories','getCategoryNovels','getSortOptions','getComments','getCommentCount','postComment','voteComment']) expect(typeof ext[m]).toBe('function');
  });
});

describe('V2 search', () => {
  it('parses kol-search__item', async () => {
    const ctx = mockCtx({ '?s=': ok(SEARCH_V2) });
    const r = await ext.searchNovels('ناروتو', 1, ctx);
    expect(r.length).toBe(2);
    expect(r[0].title).toContain('ناروتو');
    expect(r[0].tags).toContain('أكشن');
    expect(r[0].rating).toBe(7.0);
    expect(r[1].rating).toBeUndefined();
  });
  it('returns empty on no results', async () => {
    const ctx = mockCtx({ '?s=': ok(NO_RESULTS_V2) });
    expect(await ext.searchNovels('zzz', 1, ctx)).toEqual([]);
  });
  it('browse page 2 uses ?paged=2 on /series/', async () => {
    let fetched = '';
    const ctx = { xFetch: async (u) => { fetched = String(typeof u === 'string' ? u : u.url); return ok(HOME_V2); } };
    await ext.searchNovels('', 2, ctx);
    expect(fetched).toContain('/series/');
    expect(fetched).toContain('paged=2');
  });
  it('genre page 2 uses ?paged=2', async () => {
    let fetched = '';
    const ctx = { xFetch: async (u) => { fetched = String(typeof u === 'string' ? u : u.url); return ok(GENRE_V2); } };
    await ext.getCategoryNovels('action', 2, ctx);
    expect(fetched).toContain('paged=2');
    expect(fetched).not.toContain('page/2/');
  });
  it('archive tags exclude separators', async () => {
    const ctx = mockCtx({ '/genre/action/': ok(GENRE_V2) });
    const r = await ext.getCategoryNovels('action', 1, ctx);
    expect(r[0].tags).not.toContain('·');
  });
  it('pairs separate hero title-source and cover-link anchors', async () => {
    const live = '<div><a class="tw:block" href="https://kolnovel.com/series/hero-novel/" data-kol-series-cover-link><span class="kol-ui-cover"><img src="https://kolnovel.com/wp-content/uploads/hero.jpg"/></span></a>'
      + '<h1 data-kol-series-title-source data-kol-series-title-url="https://kolnovel.com/series/hero-novel/">رواية البطل</h1></div>';
    const r = ext._parseHomeCards(live);
    expect(r.length).toBe(1);
    expect(r[0].title).toBe('رواية البطل');
    expect(r[0].coverUrl).toContain('hero.jpg');
  });
  it('browse homepage finds novels', async () => {
    const ctx = mockCtx({ 'kolnovel.com/': ok(HOME_V2) });
    expect((await ext.searchNovels('', 1, ctx)).length).toBeGreaterThan(0);
  });
  it('parses archive items', async () => {
    const ctx = mockCtx({ '/genre/action/': ok(GENRE_V2) });
    const r = await ext.getCategoryNovels('action', 1, ctx);
    expect(r.length).toBe(2);
    expect(r[0].tags).toContain('أكشن');
  });
  it('extracts categories', async () => {
    const ctx = mockCtx({ 'kolnovel.com/': ok(HOME_V2) });
    const slugs = (await ext.getCategories(ctx)).map(c => c.slug);
    expect(slugs).toContain('action');
  });
});

describe('V2 novel', () => {
  it('title from editorial h1 not <title>', async () => {
    const info = await ext.parseNovelInfo('https://kolnovel.com/series/x/', mockCtx({ '/series/x/': ok(NOVEL_V2) }));
    expect(info.title).toBe('في عالم أخر مع نظام ناروتو');
    expect(info.coverUrl).toContain('In-Different-World');
    expect(info.tags).toContain('أكشن');
  });
  it('chapters from kol-series-chapter rows', async () => {
    const ch = await ext.parseChapterList('https://kolnovel.com/series/x/', mockCtx({ '/series/x/': ok(NOVEL_V2) }));
    expect(ch.length).toBe(3);
    expect(ch[0].title).toBe('الفصل 1 - ولادة جديدة فى عالم مختلف');
  });
  it('latest filters by knownCount', async () => {
    const ctx = mockCtx({ '/series/x/': ok(NOVEL_V2) });
    expect((await ext.fetchLatestChapters('https://kolnovel.com/series/x/', 2, ctx)).length).toBe(1);
  });
  it('content from #kol_content ignores decoy and footer', async () => {
    const c = await ext.parseChapterContent('https://kolnovel.com/ch/', mockCtx({ '/ch/': ok(CHAPTER_V2) }));
    expect(c).toContain('بداية المغامرة');
    expect(c).not.toContain('decoy');
    expect(c).not.toContain('نهاية الفصل');
  });
});

describe('V2 comments wp-post-id', () => {
  const ENSURE = JSON.stringify({ id: 'pb1', commentsCount: 2 });
  const lex = (t) => JSON.stringify({ root: { children: [{ children: [{ text: t, type: 'text' }], type: 'paragraph' }], type: 'root' } });
  const ctxV2 = () => mockCtx({
    '/ch/': ok(CHAPTER_V2),
    'entities/ensure': (u, init) => { expect(String(init.body)).toContain('97205'); return ok(ENSURE); },
    'collections/comments/records': ok(JSON.stringify({ items: [{ id: 'c1', parentId: '', text: lex('شكرا'), normalizedContent: 'شكرا', created: '2026-09-15T14:34:54.770Z', isDeleted: false, expand: { author: { name: 'قارئ' } } }], page: 1, totalPages: 1 })),
    'collections/comment_net/records': ok(JSON.stringify({ items: [{ comment: 'c1', net: 2 }], page: 1, totalPages: 1 }))
  });
  it('resolves via wp-post-id', async () => {
    const res = await ext.getComments('https://kolnovel.com/ch/', ctxV2());
    expect(res.count).toBe(2);
    expect(res.comments[0].body).toContain('شكرا');
  });
  it('count fast path', async () => {
    const res = await ext.getCommentCount('https://kolnovel.com/ch/', ctxV2());
    expect(res).toEqual({ count: 2 });
  });
});
