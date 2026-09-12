import { describe, it, expect, beforeAll } from "vitest";
import { loadExtension, mockCtx, ok } from "./helpers.js";

let ext;

const NOVEL_HTML = `
<h3 class="title">Cultivation Online | Novelfull</h3>
<div class="info-holder"><div class="book"><img src="https://novelfull.com/uploads/covers/cultivation-online.jpg" alt="cover"></div>
<div><h3>Author:</h3>MyLittleBrother</div>
<div><h3>Genre:</h3><a href="/genre/Action">Action</a>, <a href="/genre/Fantasy">Fantasy</a></div>
<div><h3>Status:</h3>Ongoing</div>
<div><h3>Rating:</h3><span>8.7</span></div>
</div>
<div class="desc-text"><p>A game world.</p></div>
<input type="hidden" id="total-page" value="3">
<ul class="list-chapter" id="list-chapter">
<li><a href="/cultivation-online/chapter-1.html"><span class="chapter-text">Chapter 1: Begin</span></a></li>
<li><a href="/cultivation-online/chapter-2.html"><span class="chapter-text">Chapter 2: Next</span></a></li>
</ul>
`;

const PAGE_2_HTML = `
<ul class="list-chapter" id="list-chapter">
<li><a href="/cultivation-online/chapter-51-mid.html"><span class="chapter-text">Chapter 51: Middle</span></a></li>
</ul>
`;

const PAGE_3_HTML = `
<ul class="list-chapter" id="list-chapter">
<li><a href="/cultivation-online/chapter-101-late.html"><span class="chapter-text">Chapter 101: Late</span></a></li>
<li><a href="/cultivation-online/chapter-102-end.html"><span class="chapter-text">Chapter 102: End</span></a></li>
</ul>
`;

beforeAll(() => {
  ext = loadExtension("site.novelfull.js");
});

describe("site:novelfull extension", () => {
  it("has valid metadata", () => {
    expect(ext.id).toBe("site:novelfull");
    expect(ext.version).toBe("1.2.6");
    expect(ext.apiVersion).toBe(1);
    expect(ext.baseUrl).toBe("https://novelfull.com");
  });

  it("parses novel info with genres/rating", async () => {
    const ctx = mockCtx({ "cultivation-online": ok(NOVEL_HTML) });
    const info = await ext.parseNovelInfo("https://novelfull.com/cultivation-online.html", ctx);
    expect(info.title).toContain("Cultivation Online");
    expect(info.author).toBe("MyLittleBrother");
    expect(info.tags).toEqual(["Action", "Fantasy"]);
    expect(info.category).toBe("Action");
    expect(info.rating).toBe(8.7);
  });

  it("crawls all pages in parseChapterList", async () => {
    const ctx = mockCtx({
      "?page=2": ok(PAGE_2_HTML),
      "?page=3": ok(PAGE_3_HTML),
      "cultivation-online": ok(NOVEL_HTML),
    });
    const chapters = await ext.parseChapterList("https://novelfull.com/cultivation-online.html", ctx);
    expect(chapters.map((c) => c.number)).toEqual([1, 2, 51, 101, 102]);
  });

  it("fetchLatestChapters fetches only the last page (unfiltered, host diffs)", async () => {
    const seen = [];
    const ctx = {
      log: () => {},
      xFetch: async (url) => {
        seen.push(url);
        if (url.includes("?page=3")) return ok(PAGE_3_HTML);
        if (url.includes("cultivation-online")) return ok(NOVEL_HTML);
        return { ok: false, status: 404, text: "" };
      },
    };
    const latest = await ext.fetchLatestChapters("https://novelfull.com/cultivation-online.html", 100, ctx);
    expect(seen.filter((u) => u.includes("?page="))).toEqual([
      "https://novelfull.com/cultivation-online.html?page=3",
    ]);
    expect(latest.map((c) => c.number)).toEqual([101, 102]);
  });

  it("fetchLatestChapters falls back to [] when the last page fails", async () => {
    const ctx = mockCtx({
      "?page=3": { ok: false, status: 500, text: "" },
      "cultivation-online": ok(NOVEL_HTML),
    });
    const latest = await ext.fetchLatestChapters("https://novelfull.com/cultivation-online.html", 100, ctx);
    expect(latest).toEqual([]);
  });
});
