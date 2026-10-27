import { describe, it, expect, beforeAll } from "vitest";
import { loadExtension, mockCtx, ok } from "./helpers.js";

let ext;

const NOVEL_URL = "https://truthnovel.top/novels/لورد-الحقيقة";
const READ_URL = "https://truthnovel.top/read/لورد-الحقيقة/2525";

// Minimal but faithful slice of the live Nexus (Next.js) novel page: meta tags
// plus the RSC flight payload carrying the chapter array (escaped quotes,
// literal braces — exactly like the live page).
const NOVEL_PAGE = `
<!DOCTYPE html><html lang="ar"><head>
<title>لورد الحقيقة · Nexus Novels</title>
<meta property="og:title" content="لورد الحقيقة" />
<meta property="og:description" content="عظمة زيوس الجامدة جدي" />
<meta property="og:image" content="https://truthnovel.top/media/covers/cover1.webp" />
</head><body>
<span>المؤلف: اسلام النجار</span>
<span>367 قراءة</span><span>2 متابِع</span>
<span>مستمرة</span>
<script>self.__next_f.push([1,"42:[\\"$\\",\\"section\\",null,{\\"children\\":[{\\"slug\\":\\"لورد-الحقيقة\\",\\"chapters\\":[{\\"id\\":\\"c1\\",\\"number\\":2525,\\"title\\":\\"رقم مميز\\",\\"access\\":\\"FREE\\",\\"publishedAt\\":\\"2026-10-27T14:32:06.497Z\\"}]}]}"])</script>
</body></html>
`;

// Live chapter page: server-rendered body + embedded initialPage comments JSON.
const CHAPTER_PAGE = `
<!DOCTYPE html><html lang="ar"><head><title>لورد الحقيقة — الفصل 2525: رقم مميز</title></head><body>
<div id="chapter-body" class="prose-reader"><p style="text-align:right">"...هل لي بكلمة؟"</p><p style="text-align:right">نص الفصل الثاني &amp; تتمته…</p></div>
<script>self.__next_f.push([1,"39:[\\"$\\",\\"X\\",null,{\\"chapterId\\":\\"c1\\",\\"initialPage\\":{\\"comments\\":[{\\"id\\":\\"cm1\\",\\"parentId\\":null,\\"depth\\":0,\\"body\\":\\"اول تعليق\\",\\"status\\":\\"VISIBLE\\",\\"createdAt\\":\\"2026-10-27T14:46:14.335Z\\",\\"replyCount\\":1,\\"reactionCount\\":2,\\"reactions\\":{\\"HAHA\\":1,\\"SAD\\":1},\\"author\\":{\\"name\\":\\"az_xx\\",\\"username\\":\\"az_xx\\"},\\"replies\\":[{\\"id\\":\\"cm2\\",\\"parentId\\":\\"cm1\\",\\"depth\\":1,\\"body\\":\\"اول رد\\",\\"status\\":\\"VISIBLE\\",\\"createdAt\\":\\"2026-10-27T14:49:58.368Z\\",\\"replyCount\\":0,\\"reactionCount\\":0,\\"reactions\\":{},\\"author\\":{\\"name\\":\\"black\\",\\"username\\":\\"black\\"},\\"replies\\":[]}]}],\\"nextCursor\\":12,\\"total\\":23}}]"])</script>
</body></html>
`;

const USER_PAGE = `
<!DOCTYPE html><html lang="ar"><head><title>@az_xx · Nexus Novels</title></head><body>
<h1 class="text-3xl font-bold">az_xx</h1>
<span>1 تعليق</span>
<ul class="space-y-3"><li class="panel p-4"><a class="text-xs" href="/read/لورد-الحقيقة/2525#comments">لورد الحقيقة · الفصل 2,525</a><p class="mt-2">اول تعليق</p><time datetime="2026-10-27T14:46:14.335Z">27 أكتوبر 2026</time></li></ul>
</body></html>
`;

// Wayback CDX rows: [timestamp, original, statuscode].
const CDX_JSON = JSON.stringify([
  ["timestamp", "original", "statuscode"],
  ["20250101000000", "https://truthnovel.top/1-عبقري/", "200"],
  ["20250201000000", "https://truthnovel.top/2-البداية/", "200"],
  ["20250301000000", "https://truthnovel.top/wp-content/uploads/x.jpg", "200"],
  ["20250302000000", "https://truthnovel.top/2-البداية/feed/", "200"]
]);

// Archived WordPress chapter snapshot with wpDiscuz markup.
const ARCH_CHAPTER = `
<html><head><title>1 -عبقري</title></head><body>
<div class="bs-blog-post single"><h1>1 -عبقري</h1>
<p>القطاع 107 المتوسط—</p><p>نص تجريبي&#8230;</p></div>
<script type="application/ld+json">{"@type":"Article","commentCount":2}</script>
<div id="comment-10" class="wpd-comment"><div class="wpd-comment-author">A</div><div class="wpd-comment-text"><p>أهلا</p></div><span class="wpd-vote-result" title='11'>11</span></div>
<div id="comment-11" class="wpd-comment"><div class="wpd-comment-author">B</div><div class="wpd-comment-text"><p>اتفق</p></div></div>
</body></html>
`;

beforeAll(() => {
  ext = loadExtension("site.truthnovelbeta.js");
});

describe("site:truthnovelbeta (Nexus live + Wayback fallback)", () => {
  it("has beta metadata and leaves the old extension untouched", () => {
    expect(ext.id).toBe("site:truthnovelbeta");
    expect(ext.name).toContain("Beta");
    expect(ext.lang).toBe("ar");
    expect(ext.version).toBe("1.0.0");
    expect(ext.apiVersion).toBe(2);
    expect(ext.baseUrl).toBe("https://truthnovel.top");
    const old = loadExtension("site.truthnovel.js");
    expect(old.id).toBe("site:truthnovel");
    expect(old.version).toBe("1.11.5");
  });

  it("parses novel info from the Nexus novel page", async () => {
    const ctx = mockCtx({ [NOVEL_URL]: ok(NOVEL_PAGE), "web.archive.org": ok(CDX_JSON) });
    const info = await ext.parseNovelInfo(NOVEL_URL, ctx);
    expect(info.title).toBe("لورد الحقيقة");
    expect(info.author).toBe("اسلام النجار");
    expect(info.status).toBe("مستمرة");
    expect(info.coverUrl).toContain("truthnovel.top/media/covers/");
    expect(info.summary).toContain("عظمة زيوس");
    expect(info.readersCount).toBe("367");
  });

  it("merges the live chapter with archived chapters from CDX", async () => {
    const ctx = mockCtx({
      [NOVEL_URL]: ok(NOVEL_PAGE),
      "web.archive.org/cdx": ok(CDX_JSON)
    });
    const chapters = await ext.parseChapterList(NOVEL_URL, ctx);
    expect(chapters.map((c) => c.number)).toEqual([1, 2, 2525]);
    const live = chapters.find((c) => c.number === 2525);
    expect(live.url).toBe(READ_URL);
    expect(live.uploadedAt).toBe(Date.parse("2026-10-27T14:32:06.497Z"));
    const arch = chapters.find((c) => c.number === 1);
    expect(arch.url).toContain("web.archive.org");
    expect(arch.title).toContain("1");
  });

  it("parses live chapter content from #chapter-body", async () => {
    const ctx = mockCtx({ [READ_URL]: ok(CHAPTER_PAGE) });
    const content = await ext.parseChapterContent(READ_URL, ctx);
    expect(content).toContain('"...هل لي بكلمة؟"');
    expect(content).toContain("نص الفصل الثاني & تتمته…");
  });

  it("parses archived WordPress chapter content", async () => {
    const archUrl = "https://web.archive.org/web/2025/https://truthnovel.top/1-عبقري/";
    const ctx = mockCtx({ [archUrl]: ok(ARCH_CHAPTER) });
    const content = await ext.parseChapterContent(archUrl, ctx);
    expect(content).toContain("القطاع 107 المتوسط—");
    expect(content).toContain("نص تجريبي…");
  });

  it("parses live site comments with nested replies flattened", async () => {
    const ctx = mockCtx({ [READ_URL]: ok(CHAPTER_PAGE) });
    const res = await ext.getComments(READ_URL, ctx);
    expect(res.count).toBe(23);
    expect(res.comments).toHaveLength(2);
    expect(res.comments[0]).toMatchObject({ id: "cm1", parentId: null, author: "az_xx", likes: 2 });
    expect(res.comments[1]).toMatchObject({ id: "cm2", parentId: "cm1", author: "black", likes: 0 });
    expect(res.comments[0].createdAt).toBeLessThan(res.comments[1].createdAt);
  });

  it("parses archived chapter comments from wpDiscuz markup", async () => {
    const archUrl = "https://web.archive.org/web/2025/https://truthnovel.top/1-عبقري/";
    const ctx = mockCtx({ [archUrl]: ok(ARCH_CHAPTER) });
    const res = await ext.getComments(archUrl, ctx);
    expect(res.count).toBe(2);
    expect(res.comments.map((c) => c.id)).toEqual(["10", "11"]);
    expect(res.comments[0]).toMatchObject({ author: "A", likes: 11, body: "أهلا" });
  });

  it("getCommentCount reads the embedded total without a second fetch", async () => {
    const fresh = loadExtension("site.truthnovelbeta.js");
    let hits = 0;
    const ctx = mockCtx({ [READ_URL]: () => { hits += 1; return ok(CHAPTER_PAGE); } });
    expect(await fresh.getCommentCount(READ_URL, ctx)).toEqual({ count: 23 });
    expect(await fresh.getCommentCount(READ_URL, ctx)).toEqual({ count: 23 });
    expect(hits).toBe(1);
  });

  it("reads author comments from the /u/ profile page", async () => {
    const ctx = mockCtx({ "/u/az_xx": ok(USER_PAGE) });
    const res = await ext.getAuthorComments("az_xx", 1, ctx);
    expect(res.authorName).toBe("az_xx");
    expect(res.totalComments).toBe(1);
    expect(res.totalLikes).toBeNull();
    expect(res.comments).toHaveLength(1);
    expect(res.comments[0].body).toBe("اول تعليق");
    expect(res.comments[0].chapterUrl).toContain("/read/");
    expect(res.hasMore).toBe(false);
  });

  it("refuses writes with a clear Arabic message (login-gated actions)", async () => {
    const ctx = mockCtx();
    await expect(ext.postComment(READ_URL, { author: "x", body: "hi" }, ctx)).rejects.toThrow(/الموقع/);
    await expect(ext.voteComment(READ_URL, { commentId: "cm1", vote: 1 }, ctx)).rejects.toThrow(/الموقع/);
  });

  it("getCommentVotes resolves empty without spending requests", async () => {
    const fresh = loadExtension("site.truthnovelbeta.js");
    let hits = 0;
    const ctx = mockCtx({ "truthnovel.top": () => { hits += 1; return ok("x"); } });
    const res = await fresh.getCommentVotes(READ_URL, ["cm1"], ctx);
    expect(res).toEqual({ ok: true, counts: {}, images: {} });
    expect(hits).toBe(0);
  });

  it("only returns the novel for a query that actually matches it", async () => {
    const ctx = mockCtx({ [NOVEL_URL]: ok(NOVEL_PAGE), "web.archive.org": ok(CDX_JSON) });
    expect(await ext.searchNovels("لورد الحقيقة", 1, ctx)).toHaveLength(1);
    expect(await ext.searchNovels("سيد الحقيقة", 1, ctx)).toHaveLength(1);
    expect(await ext.searchNovels("", 1, ctx)).toHaveLength(1);
    expect(await ext.searchNovels("roman numerals cookbook", 1, ctx)).toHaveLength(0);
    expect(await ext.searchNovels("whatever", 2, ctx)).toHaveLength(0);
  });

  it("reads compact Arabic thousands in the stats card", async () => {
    const page = NOVEL_PAGE.replace("367 قراءة", "ignore").replace(
      "367",
      "ignore"
    );
    const rsc = '<dl><div><dt>\u0642\u0631\u0627\u0621\u0629</dt><dd>1.2 \u0623\u0644\u0641</dd></div></dl>';
    const ctx = mockCtx({ [NOVEL_URL]: ok(page + rsc), "web.archive.org": ok(CDX_JSON) });
    const fresh = loadExtension("site.truthnovelbeta.js");
    const info = await fresh.parseNovelInfo(NOVEL_URL, ctx);
    expect(info.readersCount).toBe("1200");
  });

  it("skips numeric-only archive slugs that are not chapters", async () => {
    const cdx = JSON.stringify([
      ["timestamp", "original", "statuscode"],
      ["20260514081758", "https://truthnovel.top/4282-2/", "200"],
      ["20250101000000", "https://truthnovel.top/1-عبقري/", "200"]
    ]);
    const fresh = loadExtension("site.truthnovelbeta.js");
    const ctx = mockCtx({ [NOVEL_URL]: ok(NOVEL_PAGE), "web.archive.org/cdx": ok(cdx) });
    const chapters = await fresh.parseChapterList(NOVEL_URL, ctx);
    expect(chapters.map((c) => c.number)).toEqual([1, 2525]);
  });

  it("scopes the unavailable-chapter check to the page title", async () => {
    const withTemplate = CHAPTER_PAGE.replace(
      "</body>",
      '<div style="display:none">هذه الصفحة ضاعت بين الرفوف</div></body>'
    );
    const ctx = mockCtx({ [READ_URL]: ok(withTemplate) });
    const content = await ext.parseChapterContent(READ_URL, ctx);
    expect(content).toContain("هل لي بكلمة");
    const gone =
      '<html><head><title>الفصل غير متاح · Nexus Novels</title></head><body>404</body></html>';
    await expect(
      ext.parseChapterContent(READ_URL, mockCtx({ [READ_URL]: ok(gone) }))
    ).rejects.toThrow(/غير متوفر/);
  });

  it("uses the hardcoded author even when the page carries no author markup", async () => {
    const bare = NOVEL_PAGE.replace(/<span>\u0627\u0644\u0645\u0624\u0644\u0641:[^<]*<\/span>/, "<span></span>");
    expect(bare).not.toContain("اسلام النجار");
    const fresh = loadExtension("site.truthnovelbeta.js");
    const ctx = mockCtx({ [NOVEL_URL]: ok(bare), "web.archive.org": ok(CDX_JSON) });
    const info = await fresh.parseNovelInfo(NOVEL_URL, ctx);
    expect(info.author).toBe("اسلام النجار");
  });

  it("decodes entities and parses Arabic relative times", async () => {
    expect(ext._decodeEntities("a&rlm;b")).toBe("a\u200Fb");
    const now = Date.now();
    const sixH = ext._parseDate("منذ 6 ساعات", now);
    expect(sixH).toBeGreaterThan(now - 6 * 60 * 60 * 1000 - 60000);
    expect(sixH).toBeLessThanOrEqual(now);
  });
});
