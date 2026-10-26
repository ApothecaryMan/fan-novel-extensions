import { describe, it, expect } from "vitest";
import { loadExtension, mockCtx, mockCeneleCtx, ok } from "./helpers.js";

const ceneleNovelHtml = `
<html><body class="postid-104602">
<script>var nhvNovelV2={"postId":"104602","chaptersNonce":"abc","ajaxurl":"https://cenele.com/wp-admin/admin-ajax.php"};</script>
</body></html>`;

function cenelePageHtml(nums) {
  return nums.map((n) => `<li data-chapter-id="${n}" class="wp-manga-chapter"><a href="https://cenele.com/cont/x/ch-${n}/">الفصل ${n}</a></li>`).join("");
}

const ajaxJson = (o) => ({ ok: true, status: 200, text: JSON.stringify(o) });

describe("cheap dirty-check contract", () => {
  it("cenele clean returns [] with a single total probe", async () => {
    const ext = loadExtension("site.cenele.js");
    let posts = 0;
    const ctx = mockCeneleCtx({ "cont/x/": ok(ceneleNovelHtml) }, (params) => {
      if (params.get("action") !== "nhv_manga_single_chapters_page") return { ok: false, status: 404, text: "{}" };
      posts += 1;
      if (params.get("page") === "1") {
        return ajaxJson({ success: true, data: { html: cenelePageHtml([1, 2]), total: 200, per_page: 100 } });
      }
      return ajaxJson({ success: true, data: { html: cenelePageHtml([199, 200]), total: 200, per_page: 100 } });
    });
    const res = await ext.fetchLatestChapters("https://cenele.com/cont/x/", 200, ctx);
    expect(res).toEqual([]);
    expect(posts).toBe(1);
  });

  it("truthnovel clean returns [] instead of proof-of-fresh", async () => {
    const ext = loadExtension("site.truthnovel.js");
    const ctx = mockCtx({
      "/wp-json/wp/v2/posts": () => ({
        ...ok(JSON.stringify([
          { id: 2, link: "https://truthnovel.top/2-x/", title: { rendered: "2 -ب" }, date_gmt: "2026-09-02T00:00:00" },
          { id: 1, link: "https://truthnovel.top/1-x/", title: { rendered: "1 -أ" }, date_gmt: "2026-09-01T00:00:00" }
        ])),
        headers: { "x-wp-total": "2", "x-wp-totalpages": "1" }
      })
    });
    const res = await ext.fetchLatestChapters("https://truthnovel.top/?w4pl=257", 2, ctx);
    expect(res).toEqual([]);
  });

  it("kolnovel clean returns [] after one inline parse", async () => {
    const ext = loadExtension("site.kolnovel2.js");
    const html = `<ul><li class="kol-series-chapter"><a href="/series/x/1/" data-kol-series-chapter-link><span data-kol-series-chapter-number="1">فصل 1</span><span data-kol-series-chapter-title>أ</span></a></li>
<li class="kol-series-chapter"><a href="/series/x/2/" data-kol-series-chapter-link><span data-kol-series-chapter-number="2">فصل 2</span><span data-kol-series-chapter-title>ب</span></a></li></ul>`;
    const ctx = mockCtx({ "/series/x/": ok(html) });
    const res = await ext.fetchLatestChapters("https://kolnovel.com/series/x/", 2, ctx);
    expect(res).toEqual([]);
  });

  it("novelfull throws instead of [] when the last page fails", async () => {
    const ext = loadExtension("site.novelfull.js");
    const base = `<input type="hidden" id="total-page" value="3"><ul id="list-chapter"><li><a href="/s/chapter-1.html"><span class="chapter-text">Chapter 1</span></a></li></ul>`;
    const ctx = mockCtx({
      "cultivation-online.html?page=3": { ok: false, status: 500, text: "" },
      "cultivation-online": ok(base)
    });
    await expect(ext.fetchLatestChapters("https://novelfull.com/cultivation-online.html", 100, ctx)).rejects.toThrow();
  });

  it("wuxiaworld throws instead of [] when the last toc fails", async () => {
    const ext = loadExtension("site.wuxiaworld.js");
    const base = `<div>Page 1 of 3</div><div class="toc"><ul><li><a href="/novel/x/ch-1">Chapter 1</a></li></ul></div>`;
    const ctx = mockCtx({
      "?toc=3": { ok: false, status: 500, text: "" },
      "/novel/x": ok(base)
    });
    await expect(ext.fetchLatestChapters("https://lite.wuxiaworld.com/novel/x", 100, ctx)).rejects.toThrow();
  });

  it("wikisource exposes fetchLatestChapters", async () => {
    const ext = loadExtension("site.wikisource.js");
    expect(typeof ext.fetchLatestChapters).toBe("function");
  });

  it("shamela exposes fetchLatestChapters", async () => {
    const ext = loadExtension("site.shamela.js");
    expect(typeof ext.fetchLatestChapters).toBe("function");
  });
});
