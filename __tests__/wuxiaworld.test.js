import { describe, it, expect, beforeAll } from "vitest";
import { loadExtension, mockCtx, ok } from "./helpers.js";

let ext;

const NOVEL_HTML = `
<div class="novel-head cf">
<div class="cover"><img src="https://cdn.wuxiaworld.com/images/covers/mga.webp?ver=abc123" alt="" width="200" height="280" /></div>
<h1>Martial God Asura</h1>
<p class="muted small">Ongoing · Author: Kindhearted Bee · Translator: Starvecleric &amp; Yang Wenli · 6773 chapters</p>
<p><a class="btn" href="/novel/martial-god-asura/mga-chapter-1">Start reading</a></p>
</div>
<h2>Synopsis</h2><div class="chapter-body"><p>Regarding potential&mdash;even if you are not considered a genius.</p><p>Second paragraph here.</p></div>
<h2>Chapters</h2>
<ul class="toc"><li><a href="/novel/martial-god-asura/mga-chapter-1">Chapter 1 – Outer Court Disciple</a></li></ul>
<div class="pager cf"><a class="btn next" href="/novel/martial-god-asura?toc=2">Next &rarr;</a><span class="small muted"> Page 1 of 68</span></div>
`;

const TOC_PAGE_2 = `
<ul class="toc">
<li><a href="/novel/martial-god-asura/mga-chapter-101">Chapter 101 – Test</a></li>
<li class="grp">Volume 2</li>
<li><a href="/novel/martial-god-asura/mga-chapter-102">Chapter 102: Bizarre Hall</a></li>
</ul>
<div class="pager cf"><a class="btn" href="/novel/martial-god-asura">&larr; Previous</a><span class="small muted"> Page 2 of 68</span></div>
`;

const CHAPTER_HTML = `
<p class="small chapter-breadcrumb"><a href="/novel/martial-god-asura">Martial God Asura</a></p>
<h1 id="chapter-title">Chapter 1 – Outer Court Disciple</h1>
<div class="chapter-nav chapter-nav-top"><span class="muted">&larr; Previous</span></div>
<div class="chapter-viewport" id="chapter-viewport"><div class="chapter-body" id="chapter-body"><p>Night. The round moon was hanging high.</p><p>&ldquo;Abnormal signs appear&rdquo; &mdash; he said.</p></div></div>
`;

const BROWSE_HTML = `
<table class="novel-grid"><tbody><tr><td class="novel-cell">
<a class="cover" href="/novel/nine-star-hegemon"><img src="https://cdn.wuxiaworld.com/images/covers/nshba.webp?v=123" alt="" width="200" height="280" /></a>
<p class="title"><a href="/novel/nine-star-hegemon">Nine Star Hegemon Body Art</a></p>
<p class="tag">Ongoing · Fantasy, Comedy</p>
<p class="syn">Long Chen, a crippled youth…</p>
</td><td class="novel-cell">
<a class="cover" href="/novel/rmji"><img src="https://cdn.wuxiaworld.com/images/covers/rmji.webp?v=456" alt="" width="200" height="280" /></a>
<p class="title"><a href="/novel/rmji">A Record of a Mortal&rsquo;s Journey to Immortality</a></p>
<p class="tag">Completed · Fantasy, Cultivation</p>
<p class="syn">A poor boy…</p>
</td></tr></tbody></table>
<div class="pager cf"><a class="btn next" href="/novels?after=36">Next page &rarr;</a></div>
`;

const BROWSE_PAGE_2 = `
<table class="novel-grid"><tbody><tr><td class="novel-cell">
<a class="cover" href="/novel/puluo"><img src="https://cdn.wuxiaworld.com/images/covers/puluo.webp?v=789" alt="" width="200" height="280" /></a>
<p class="title"><a href="/novel/puluo">The Overlord of Puluo</a></p>
<p class="tag">Hiatus · Fantasy, Action</p>
<p class="syn">Li Banfeng…</p>
</td></tr></tbody></table>
`;

beforeAll(() => {
  ext = loadExtension("site.wuxiaworld.js");
});

describe("site:wuxiaworld extension", () => {
  it("has valid metadata", () => {
    expect(ext.id).toBe("site:wuxiaworld");
    expect(ext.name).toBe("WuxiaWorld");
    expect(ext.lang).toBe("en");
    expect(ext.version).toBe("1.0.0");
    expect(ext.apiVersion).toBe(1);
    expect(ext.baseUrl).toBe("https://lite.wuxiaworld.com");
  });

  it("rewrites www URLs to lite", () => {
    expect(ext._absUrl("https://www.wuxiaworld.com/novel/mga-chapter-1")).toBe(
      "https://lite.wuxiaworld.com/novel/mga-chapter-1"
    );
    expect(ext._absUrl("/novel/x")).toBe("https://lite.wuxiaworld.com/novel/x");
  });

  it("parses novel info with author/translator/count/cover", async () => {
    const ctx = mockCtx({ "martial-god-asura": ok(NOVEL_HTML) });
    const info = await ext.parseNovelInfo("https://lite.wuxiaworld.com/novel/martial-god-asura", ctx);
    expect(info.title).toBe("Martial God Asura");
    expect(info.author).toBe("Kindhearted Bee");
    expect(info.translator).toBe("Starvecleric & Yang Wenli");
    expect(info.totalChapters).toBe(6773);
    expect(info.status).toBe("مستمرة");
    expect(info.coverUrl).toBe("https://cdn.wuxiaworld.com/images/covers/mga.webp?ver=abc123");
    expect(info.summary).toContain("Regarding potential—even if");
    expect(info.summary).toContain("Second paragraph");
  });

  it("throws on not-found novels", async () => {
    const ctx = mockCtx({ "nope": ok("<h1>Not found</h1>") });
    await expect(ext.parseNovelInfo("https://lite.wuxiaworld.com/novel/nope", ctx)).rejects.toThrow();
  });

  it("parses TOC pages, skips group headers, stamps crawl time", async () => {
    const ctx = mockCtx({
      "martial-god-asura?toc=2": ok(TOC_PAGE_2),
      "martial-god-asura": ok(NOVEL_HTML),
    });
    const before = Date.now();
    const chapters = await ext.parseChapterList("https://lite.wuxiaworld.com/novel/martial-god-asura", ctx);
    // NOVEL_HTML claims 68 pages but only page 2 is mocked; the rest fail and are skipped.
    expect(chapters.length).toBe(3);
    expect(chapters[0].number).toBe(1);
    expect(chapters[0].title).toBe("Chapter 1 Outer Court Disciple");
    expect(chapters[1].number).toBe(101);
    expect(chapters[2].number).toBe(102);
    expect(chapters[2].title).toBe("Chapter 102 Bizarre Hall");
    for (const c of chapters) {
      expect(typeof c.uploadedAt).toBe("number");
      expect(c.uploadedAt).toBeGreaterThanOrEqual(before);
    }
  });

  it("parses chapter content and decodes entities", async () => {
    const ctx = mockCtx({ "mga-chapter-1": ok(CHAPTER_HTML) });
    const content = await ext.parseChapterContent(
      "https://lite.wuxiaworld.com/novel/martial-god-asura/mga-chapter-1", ctx
    );
    expect(content).toContain("Night. The round moon was hanging high.");
    expect(content).toContain("“Abnormal signs appear” — he said.");
    expect(content).not.toContain("&ldquo;");
  });

  it("parses browse cards with status/tags/covers and follows the pager", async () => {
    const ctx = mockCtx({
      "after=36": ok(BROWSE_PAGE_2),
      "/novels": ok(BROWSE_HTML),
    });
    const p1 = await ext.getPopularNovels(1, ctx);
    expect(p1.length).toBe(2);
    expect(p1[0].title).toBe("Nine Star Hegemon Body Art");
    expect(p1[0].coverUrl).toContain("cdn.wuxiaworld.com/images/covers/nshba.webp");
    expect(p1[0].status).toBe("مستمرة");
    expect(p1[0].tags).toEqual(["Fantasy", "Comedy"]);
    expect(p1[1].title).toContain("Mortal");
    expect(p1[1].status).toBe("مكتملة");

    const p2 = await ext.getPopularNovels(2, ctx);
    expect(p2.length).toBe(1);
    expect(p2[0].title).toBe("The Overlord of Puluo");
    expect(p2[0].status).toBe("متوقفة");
  });

  it("searches single-page and returns [] past page 1", async () => {
    const ctx = mockCtx({ "/novels?q=": ok(BROWSE_HTML) });
    const r1 = await ext.searchNovels("hegemon", 1, ctx);
    expect(r1.length).toBe(2);
    const r2 = await ext.searchNovels("hegemon", 2, ctx);
    expect(r2).toEqual([]);
  });

  it("exposes sort categories", async () => {
    const cats = await ext.getCategories(mockCtx());
    expect(cats.map((c) => c.slug)).toEqual(["popular", "new", "chapters", "name", "rating"]);
    const ctx = mockCtx({ "sort=new": ok(BROWSE_HTML) });
    const res = await ext.getCategoryNovels("new", 1, ctx);
    expect(res.length).toBe(2);
  });
});
