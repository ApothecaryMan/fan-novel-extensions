import { describe, it, expect, beforeAll } from "vitest";
import { loadExtension, mockCtx, ok } from "./helpers.js";

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

const SAMPLE_HOME_PAGE = `
<div class="bs-blog-post">
  <h4 class="title"><a href="https://truthnovel.top/2422-game/">2422 -حب اللعبة لذاتها</a></h4>
  <div class="bs-blog-meta">
    <span class="bs-blog-date">
      <a href="https://truthnovel.top/2026/09/"><time datetime="">6 سبتمبر، 2026</time></a>
    </span>
  </div>
</div>
`;

const SAMPLE_CHAPTER_PAGE = `
<div class="bs-blog-post single">
  <h1 class="entry-title">2422 -حب اللعبة لذاتها</h1>
  <p>القطاع 107 المتوسط—</p>
  <p>في هذه اللحظة، زافاروس كان يجلس على أريكة ضخمة&#8230;</p>
  <p>ما هو أبعد من ذلك;8230# من مكانه ذاك.</p>
  <p>&#8220;أليس من الأفضل الانتظار&#8221;؟</p>
</div>
`;

beforeAll(() => {
  ext = loadExtension("site.truthnovel.js");
});

describe("site:truthnovel extension", () => {
  it("has valid metadata", () => {
    expect(ext.id).toBe("site:truthnovel");
    expect(ext.name).toContain("سيد الحقيقة");
    expect(ext.lang).toBe("ar");
    expect(ext.version).toBe("1.1.0");
    expect(ext.apiVersion).toBe(2);
    expect(ext.baseUrl).toBe("https://truthnovel.top");
  });

  it("parses novel info correctly with valid coverUrl", async () => {
    const ctx = mockCtx();
    const info = await ext.parseNovelInfo("https://truthnovel.top/", ctx);
    expect(info.title).toBe("سيد الحقيقة");
    expect(info.author).toBe("Zeus");
    expect(info.status).toBe("مستمرة");
    expect(info.category).toBe("فانتازيا");
    expect(info.coverUrl).toBeDefined();
    expect(info.coverUrl).toContain("truthnovel.top/wp-content/uploads/");
  });

  it("parses chapters, sorts ascending, and populates uploadedAt", async () => {
    const ctx = mockCtx({
      "?w4pl=257": ok(SAMPLE_LIST_PAGE),
      "https://truthnovel.top/": ok(SAMPLE_HOME_PAGE)
    });
    const chapters = await ext.parseChapterList("https://truthnovel.top/?w4pl=257", ctx);
    expect(chapters.length).toBe(2);
    expect(chapters[0].number).toBe(1);
    expect(chapters[0].title).toBe("الفصل 1 - عبقري");
    expect(typeof chapters[0].uploadedAt).toBe("number");

    expect(chapters[1].number).toBe(2422);
    expect(chapters[1].title).toBe("الفصل 2422 - حب اللعبة لذاتها");
    expect(typeof chapters[1].uploadedAt).toBe("number");
    expect(chapters[1].uploadedAt).toBeGreaterThan(chapters[0].uploadedAt);
  });

  it("parses chapter content and properly cleans entity codes like &#8230; and ;8230#", async () => {
    const ctx = mockCtx({
      "2422-game/": ok(SAMPLE_CHAPTER_PAGE)
    });
    const content = await ext.parseChapterContent("https://truthnovel.top/2422-game/", ctx);
    expect(content).toContain("القطاع 107 المتوسط—");
    expect(content).toContain("أريكة ضخمة…");
    expect(content).toContain("ما هو أبعد من ذلك… من مكانه ذاك.");
    expect(content).toContain("“أليس من الأفضل الانتظار”؟");
    expect(content).not.toContain("8230");
    expect(content).not.toContain(";8230#");
    expect(content).not.toContain("&#8230;");
  });

  it("returns single novel on search/browse with coverUrl", async () => {
    const ctx = mockCtx();
    const results = await ext.searchNovels("حقيقة", 1, ctx);
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("سيد الحقيقة");
    expect(results[0].coverUrl).toBeDefined();
    expect(results[0].coverUrl).toContain("truthnovel.top/wp-content/uploads/");
  });

  it("parses site comments from feed with reply threading", async () => {
    const FEED = `<?xml version="1.0"?><rss><channel>
      <item><title>بواسطة: A</title><link>https://truthnovel.top/x/#comment-10</link>
      <dc:creator><![CDATA[A]]></dc:creator><pubDate>Thu, 10 Sep 2026 11:00:00 +0000</pubDate>
      <guid>https://truthnovel.top/?p=1#comment-10</guid>
      <description><![CDATA[أهلا]]></description>
      <content:encoded><![CDATA[<p>أهلا</p>]]></content:encoded></item>
      <item><title>بواسطة: B</title><link>https://truthnovel.top/x/#comment-11</link>
      <dc:creator><![CDATA[B]]></dc:creator><pubDate>Thu, 10 Sep 2026 12:00:00 +0000</pubDate>
      <guid>https://truthnovel.top/?p=1#comment-11</guid>
      <description><![CDATA[ردًا على <a href="https://truthnovel.top/x/#comment-10">A</a>. اتفق]]></description>
      <content:encoded><![CDATA[<p>ردًا على <a href="https://truthnovel.top/x/#comment-10">A</a>.</p><p>اتفق</p>]]></content:encoded></item>
    </channel></rss>`;
    const ctx = mockCtx({
      "feed/": ok(FEED),
      "2430-x": ok('<script type="application/ld+json">{"@type":"Article","commentCount":2}</script>')
    });
    const res = await ext.getComments("https://truthnovel.top/2430-x/", ctx);
    expect(res.count).toBe(2);
    expect(res.comments.length).toBe(2);
    expect(res.comments[1].parentId).toBe("10");
    expect(res.comments[1].body).toContain("اتفق");
  });
});
