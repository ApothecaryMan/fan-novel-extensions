import { describe, it, expect, beforeAll } from 'vitest';
import { loadExtension, mockCtx, ok } from './helpers.js';

let ext;

const SAMPLE_LIST_PAGE = `
<div id="w4pl-inner-257" class="w4pl-inner">
  <ul>
    <li>
      <a class="post_title w4pl_post_title" href="https://truthnovel.top/2422-game/" title="View 2422 -حب اللعبة لذاتها">2422 -حب اللعبة لذاتها</a>
    </li>
    <li>
      <a class="post_title w4pl_post_title" href="https://truthnovel.top/1-genius/" title="View 1 -عبقري">1 -عبقري</a>
    </li>
  </ul>
</div>
`;

const SAMPLE_CHAPTER_PAGE = `
<div class="bs-blog-post single">
  <h1 class="entry-title">2422 -حب اللعبة لذاتها</h1>
  <p>القطاع 107 المتوسط—</p>
  <p>في هذه اللحظة، زافاروس كان يجلس على أريكة ضخمة.</p>
</div>
`;

beforeAll(() => {
  ext = loadExtension('site.truthnovel.js');
});

describe('site:truthnovel extension', () => {
  it('has valid metadata', () => {
    expect(ext.id).toBe('site:truthnovel');
    expect(ext.name).toContain('سيد الحقيقة');
    expect(ext.lang).toBe('ar');
    expect(ext.version).toBe('1.0.0');
    expect(ext.apiVersion).toBe(1);
    expect(ext.baseUrl).toBe('https://truthnovel.top');
  });

  it('parses novel info correctly', async () => {
    const ctx = mockCtx();
    const info = await ext.parseNovelInfo('https://truthnovel.top/', ctx);
    expect(info.title).toBe('سيد الحقيقة');
    expect(info.author).toBe('Zeus');
    expect(info.status).toBe('مستمرة');
    expect(info.category).toBe('فانتازيا');
  });

  it('parses chapters and sorts them ascending', async () => {
    const ctx = mockCtx({
      '?w4pl=257': ok(SAMPLE_LIST_PAGE)
    });
    const chapters = await ext.parseChapterList('https://truthnovel.top/?w4pl=257', ctx);
    expect(chapters.length).toBe(2);
    expect(chapters[0].number).toBe(1);
    expect(chapters[0].title).toBe('الفصل 1 - عبقري');
    expect(chapters[1].number).toBe(2422);
    expect(chapters[1].title).toBe('الفصل 2422 - حب اللعبة لذاتها');
  });

  it('parses chapter content cleanly', async () => {
    const ctx = mockCtx({
      '2422-game/': ok(SAMPLE_CHAPTER_PAGE)
    });
    const content = await ext.parseChapterContent('https://truthnovel.top/2422-game/', ctx);
    expect(content).toContain('القطاع 107 المتوسط—');
    expect(content).toContain('في هذه اللحظة، زافاروس كان يجلس');
  });

  it('returns single novel on search/browse', async () => {
    const ctx = mockCtx();
    const results = await ext.searchNovels('حقيقة', 1, ctx);
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('سيد الحقيقة');
  });
});
