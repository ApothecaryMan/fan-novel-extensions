// Large-scale + weakness-regression tests for site:kolnovel.
//
// Two big fixtures:
//   - BROWSE_100: a "latest updates" home widget with 100 chapters, each from a
//     different novel, all inside a SINGLE .utao wrapper.
//   - NOVEL_100_CHAPTERS: one novel page with 100 inline chapters (emitted in
//     reverse order + one duplicate row).

import { describe, it, expect, beforeAll } from 'vitest';
import { loadExtension, mockCtx, ok } from './helpers.js';
import { NOVELS_100, BROWSE_100, NOVEL_100_CHAPTERS } from './fixtures/kolnovel-large.js';

let ext;

beforeAll(() => {
  ext = loadExtension('site.kolnovel.js');
});

// ──────────────────────────────────────────────────────────────────
// 100 novels from 100 different chapter cards (browse / latest updates)
// ──────────────────────────────────────────────────────────────────
describe('Browse: 100 novels from 100 different chapters', () => {
  it('returns exactly 100 results from the latest-updates widget', async () => {
    const ctx = mockCtx({ 'kolnovel.com/': ok(BROWSE_100) });
    const results = await ext.searchNovels('', 1, ctx);
    expect(results.length).toBe(100);
  });

  it('emits one result per distinct novel URL (no duplicates)', async () => {
    const ctx = mockCtx({ 'kolnovel.com/': ok(BROWSE_100) });
    const results = await ext.searchNovels('', 1, ctx);
    const urls = results.map(r => r.url);
    const unique = new Set(urls);
    expect(unique.size).toBe(100);
    expect(urls.length).toBe(unique.size);
  });

  it('returns every one of the 100 novels (URL match)', async () => {
    const ctx = mockCtx({ 'kolnovel.com/': ok(BROWSE_100) });
    const results = await ext.searchNovels('', 1, ctx);
    const resultUrls = results.map(r => r.url);
    for (const n of NOVELS_100) {
      expect(resultUrls).toContain(n.url);
    }
  });

  it('keeps correct titles for all 100 novels', async () => {
    const ctx = mockCtx({ 'kolnovel.com/': ok(BROWSE_100) });
    const results = await ext.searchNovels('', 1, ctx);
    const byUrl = new Map(results.map(r => [r.url, r]));
    for (const n of NOVELS_100) {
      const res = byUrl.get(n.url);
      expect(res).toBeDefined();
      expect(res.title).toBe(n.title);
    }
  });

  it('each result has a valid NovelResult shape', async () => {
    const ctx = mockCtx({ 'kolnovel.com/': ok(BROWSE_100) });
    const results = await ext.searchNovels('', 1, ctx);
    for (const r of results) {
      expect(r).toHaveProperty('source', 'site:kolnovel');
      expect(r).toHaveProperty('url');
      expect(r).toHaveProperty('title');
      expect(r).toHaveProperty('author', 'غير معروف');
      expect(r).toHaveProperty('category', 'روايات مترجمة');
      expect(r).toHaveProperty('status', 'مستمرة');
      expect(typeof r.url).toBe('string');
      expect(r.url).toMatch(/\/series\//);
      expect(r.title.length).toBeGreaterThan(0);
    }
  });

  it('parses all 100 out-of-order-sourced rows without crash and stays complete', async () => {
    // Just a stability guarantee: repeated parsing yields a stable count.
    const ctx = mockCtx({ 'kolnovel.com/': ok(BROWSE_100) });
    const a = await ext.searchNovels('', 1, ctx);
    const b = await ext.searchNovels('', 1, ctx);
    expect(a.length).toBe(b.length);
    expect(a.length).toBe(100);
  });
});

// ──────────────────────────────────────────────────────────────────
// 100 chapters on a single novel page
// ──────────────────────────────────────────────────────────────────
describe('parseChapterList: 100 chapters', () => {
  it('parses all 100 chapters (dedupes the inserted duplicate)', async () => {
    const ctx = mockCtx({ '/big-novel': ok(NOVEL_100_CHAPTERS) });
    const chapters = await ext.parseChapterList('/big-novel', ctx);
    expect(chapters.length).toBe(100);
  });

  it('sorts chapters ascending (fixture was emitted in reverse)', async () => {
    const ctx = mockCtx({ '/big-novel': ok(NOVEL_100_CHAPTERS) });
    const chapters = await ext.parseChapterList('/big-novel', ctx);
    const nums = chapters.map(c => c.number);
    for (let i = 1; i < nums.length; i++) {
      expect(nums[i]).toBeGreaterThan(nums[i - 1]);
    }
  });

  it('first chapter is 1 and last is 100', async () => {
    const ctx = mockCtx({ '/big-novel': ok(NOVEL_100_CHAPTERS) });
    const chapters = await ext.parseChapterList('/big-novel', ctx);
    expect(chapters[0].number).toBe(1);
    expect(chapters[chapters.length - 1].number).toBe(100);
  });

  it('chapter URLs are all unique', async () => {
    const ctx = mockCtx({ '/big-novel': ok(NOVEL_100_CHAPTERS) });
    const chapters = await ext.parseChapterList('/big-novel', ctx);
    const urls = chapters.map(c => c.url);
    expect(new Set(urls).size).toBe(100);
  });

  it('formats every title as "الفصل N - name"', async () => {
    const ctx = mockCtx({ '/big-novel': ok(NOVEL_100_CHAPTERS) });
    const chapters = await ext.parseChapterList('/big-novel', ctx);
    for (const c of chapters) {
      expect(c.title).toMatch(new RegExp('^الفصل ' + c.number));
    }
  });

  it('keeps uploadedAt as epoch numbers', async () => {
    const ctx = mockCtx({ '/big-novel': ok(NOVEL_100_CHAPTERS) });
    const chapters = await ext.parseChapterList('/big-novel', ctx);
    for (const c of chapters) {
      expect(typeof c.uploadedAt).toBe('number');
      expect(c.uploadedAt).toBeLessThanOrEqual(Date.now());
    }
  });

  it('handles a chapter titled only with a lead number', async () => {
    // Chapter "الفصل 3" with no title in the fixture: _finalizeChapters must still
    // give it a sensible Arabic title.
    const ctx = mockCtx({ '/big-novel': ok(NOVEL_100_CHAPTERS) });
    const chapters = await ext.parseChapterList('/big-novel', ctx);
    const c3 = chapters.find(c => c.number === 3);
    expect(c3).toBeDefined();
    expect(c3.title).toBe('الفصل 3');
  });

  it('full parity: every 1..100 number appears exactly once', async () => {
    const ctx = mockCtx({ '/big-novel': ok(NOVEL_100_CHAPTERS) });
    const chapters = await ext.parseChapterList('/big-novel', ctx);
    const seen = new Set();
    for (const c of chapters) {
      expect(c.number).toBeGreaterThanOrEqual(1);
      expect(c.number).toBeLessThanOrEqual(100);
      expect(seen.has(c.number)).toBe(false);
      seen.add(c.number);
    }
    expect(seen.size).toBe(100);
  });
});

// ──────────────────────────────────────────────────────────────────
// fetchLatestChapters with 100 chapters
// ──────────────────────────────────────────────────────────────────
describe('fetchLatestChapters: 100 chapters', () => {
  it('returns only chapters newer than knownCount', async () => {
    const ctx = mockCtx({ '/latest-big': ok(NOVEL_100_CHAPTERS) });
    const latest = await ext.fetchLatestChapters('/latest-big', 90, ctx);
    const nums = latest.map(c => c.number).sort((a, b) => a - b);
    expect(nums).toEqual([91, 92, 93, 94, 95, 96, 97, 98, 99, 100]);
  });

  it('returns all 100 when knownCount is 0', async () => {
    const ctx = mockCtx({ '/latest-all': ok(NOVEL_100_CHAPTERS) });
    const latest = await ext.fetchLatestChapters('/latest-all', 0, ctx);
    expect(latest.length).toBe(100);
  });

  it('returns none when knownCount >= chapter count', async () => {
    const ctx = mockCtx({ '/latest-none': ok(NOVEL_100_CHAPTERS) });
    const latest = await ext.fetchLatestChapters('/latest-none', 100, ctx);
    expect(latest.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────
// Weakness regressions
// ──────────────────────────────────────────────────────────────────
describe('Weakness regressions', () => {
  it('utao strategy handles MULTIPLE .uta items inside one .utao wrapper', async () => {
    // BROWSE_100 packs all 100 .uta cards into one .utao wrapper; the improvement
    // must materialize all 100 of them (the old code read only the first link).
    const ctx = mockCtx({ 'kolnovel.com/': ok(BROWSE_100) });
    const results = await ext.searchNovels('', 1, ctx);
    expect(results.length).toBe(100);
    for (const n of [NOVELS_100[0], NOVELS_100[50], NOVELS_100[99]]) {
      expect(results.some(r => r.url === n.url)).toBe(true);
    }
  });

  it('deduplicates a novel that appears as BOTH maindet and hotoday on one page', async () => {
    // Same novel URL rendered in a maindet article AND a hotoday card => only one result.
    const sharedUrl = 'https://kolnovel.com/series/مكرر/';
    const html = `<!DOCTYPE html><html><body>
      <article class="maindet" itemscope="itemscope" itemtype="http://schema.org/CreativeWork">
        <div class="inmain">
          <div class="mdthumb"><a href="${sharedUrl}" title="رواية مكررة" class="tip"><img src="https://kolnovel.com/wp-content/uploads/dup.png" width="1" height="1" alt="x"/></a></div>
          <div class="mdinfo">
            <span class="mdgenre"><a href="https://kolnovel.com/genre/action/"># أكشن</a></span>
            <h2 itemprop="headline"><a href="${sharedUrl}">رواية مكررة</a></h2>
            <span class="mdminf">8.0</span>
          </div>
        </div>
      </article>
      <div class="hotoday">
        <div class="inhotoday">
          <a href="${sharedUrl}" class="tip" rel="1" title="رواية مكررة">
            <div class="todthumb"><div class="todstat Ongoing">مستمرة</div><img src="https://kolnovel.com/wp-content/uploads/dup.png" width="1" height="1" alt="x"/></div>
            <div class="todtitle">رواية مكررة</div>
            <div class="todgen"><a href="https://kolnovel.com/genre/action/">أكشن</a></div>
            <div class="todsco"><span class="todnum">8.0</span></div>
          </a>
        </div>
      </div>
    </body></html>`;
    const ctx = mockCtx({ 'kolnovel.com/': ok(html) });
    const results = await ext.searchNovels('', 1, ctx);
    const matching = results.filter(r => r.url === sharedUrl);
    expect(matching.length).toBe(1);
  });

  it('strips the "الفصل الـ N" chapter heading from content', async () => {
    const html = `<!DOCTYPE html><html><body><div id="kol_content">
      <p>الفصل الـ 45: بعد المعركة</p>
      <p>النص الفعلي يبدأ هنا.</p>
    </div></body></html>`;
    const ctx = mockCtx({ '/content-la': ok(html) });
    const content = await ext.parseChapterContent('/content-la', ctx);
    expect(content).not.toMatch(/^الفصل الـ/);
    expect(content).toContain('النص الفعلي');
  });

  it('strips the السادس عشر chapter heading from content', async () => {
    const html = `<!DOCTYPE html><html><body><div id="kol_content">
      <p>الفصل السادس عشر: هدوء ما قبل العاصفة</p>
      <p>النص الفعلي الثاني.</p>
    </div></body></html>`;
    const ctx = mockCtx({ '/content-16': ok(html) });
    const content = await ext.parseChapterContent('/content-16', ctx);
    expect(content).not.toMatch(/^الفصل السادس عشر/);
    expect(content).toContain('النص الفعلي الثاني');
  });

  it('parses chapter number from "الفصل الـ N" in epl-num', async () => {
    const html = `<!DOCTYPE html><html><body>
      <div class="eplister"><ul>
        <li data-ID="1"><a href="https://kolnovel.com/series/x/45/">
          <div class="epl-num">الفصل الـ 45</div>
          <div class="epl-title">بعد المعركة</div>
          <div class="epl-date">منذ يوم</div>
        </a></li>
      </ul></div>
    </body></html>`;
    const ctx = mockCtx({ '/novel-la': ok(html) });
    const chapters = await ext.parseChapterList('/novel-la', ctx);
    expect(chapters.length).toBe(1);
    expect(chapters[0].number).toBe(45);
  });
});
