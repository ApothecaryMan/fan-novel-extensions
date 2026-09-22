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
    expect(ext.version).toBe("1.1.11");
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

  it("parses site comments from feed with reply threading", async () => {    const FEED = `<?xml version="1.0"?><rss><channel>
      <item><title>بواسطة: A</title><link>https://truthnovel.top/x/#comment-10</link>
      <dc:creator><![CDATA[A]]></dc:creator><pubDate>Thu, 10 Sep 2026 11:00:00 +0000</pubDate>
      <guid>https://truthnovel.top/?p=1#comment-10</guid>
      <description><![CDATA[أهلا]]></description>
      <content:encoded><![CDATA[<p>أهلا</p>]]></content:encoded></item>
      <item><title>بواسطة: B</title><link>https://truthnovel.top/x/#comment-11</link>
      <dc:creator><![CDATA[B]]></dc:creator><pubDate>Thu, 10 Sep 2026 12:00:00 +0000</pubDate>
      <guid>https://truthnovel.top/?p=1#comment-11</guid>
      <description><![CDATA[ردًا على <a href="https://truthnovel.top/x/#comment-10">A</a>. اتفق]]></description>
      <content:encoded><![CDATA[<p>ردًا على <a href="https://truthnovel.top/x/#comment-10">A</a>.</p><p>اتفق</p><p><img src="https://truthnovel.top/wp-content/uploads/pic.jpg" /><img src="https://s.w.org/images/core/emoji/smile.png" class="wp-smiley" /></p>]]></content:encoded></item>
    </channel></rss>`;
    const ctx = mockCtx({
      "feed/": ok(FEED),
      "2430-x": ok('<script type="application/ld+json">{"@type":"Article","commentCount":2}</script><div id="comment-10"><div class="wpd-vote"><span class="wpd-vote-result wpd-vote-result-like wpd-up\' title=\'11\'>11</span></div></div><div class=\'wmu-comment-attachments\' data-comment-id=\'11\'><a href=\'https://truthnovel.top/wp-content/uploads/2026/09/attach.gif\'><img src=\'https://truthnovel.top/wp-content/uploads/2026/09/attach.gif\' /></a></div>')
    });
    const res = await ext.getComments("https://truthnovel.top/2430-x/", ctx);
    expect(res.count).toBe(2);
    expect(res.comments.length).toBe(2);
    expect(res.comments[1].parentId).toBe("10");
    expect(res.comments[1].body).toContain("اتفق");
    expect(res.comments[1].body).not.toContain("رد");
    expect(res.comments[1].images).toEqual(["https://truthnovel.top/wp-content/uploads/pic.jpg", "https://truthnovel.top/wp-content/uploads/2026/09/attach.gif"]);
    expect(res.comments[0].likes).toBe(11);
    expect(res.comments[1].images).toContain("https://truthnovel.top/wp-content/uploads/2026/09/attach.gif");
  });

  it("posts top-level comment via wpdGetNonce + wpdAddComment protocol", async () => {
    const seen = [];
    const ctx = mockCtx({
      "2430-x/": ok('<script>var wpdiscuzAjaxObj = {"wc_post_id":"10897"};</script>'),
      "admin-ajax.php": (url, init) => {
        const body = String(init.body || "");
        seen.push(body);
        if (body.includes("action=wpdGetNonce")) {
          return ok(JSON.stringify({ success: true, data: { wpdiscuz_nonce: "abc123" } }));
        }
        return ok(JSON.stringify({ success: true, data: { new_comment_id: 58719, held_moderate: 1 } }));
      }
    });
    const res = await ext.postComment("https://truthnovel.top/2430-x/", { author: "FanTest", email: "a@b.co", body: "hello" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.id).toBe("58719");
    expect(res.needsModeration).toBe(true);
    const add = seen.find((b) => b.includes("wpdAddComment"));
    expect(add).toContain("postId=10897");
    expect(add).toContain("wpdiscuz_unique_id=0_0");
    expect(add).toContain("wpd_comment_depth=1");
    expect(add).toContain("wc_name=FanTest");
    expect(add).toContain("wc_comment=hello");
    expect(add).toContain("wpdiscuz_nonce=abc123");
  });

  it("posts reply with parent threading + rejects short names", async () => {
    const seen = [];
    const ctx = mockCtx({
      "2430-x/": ok('<div id=\'wpd-comm-58659_0\' class=\'comment depth-1 wpd-comment wpd_comment_level-1\'>x</div><script>var w = {"wc_post_id":"10897"};</script>'),
      "admin-ajax.php": (url, init) => {
        const body = String(init.body || "");
        seen.push(body);
        if (body.includes("action=wpdGetNonce")) {
          return ok(JSON.stringify({ success: true, data: { wpdiscuz_nonce: "n1" } }));
        }
        return ok(JSON.stringify({ success: true, data: { new_comment_id: 58720, held_moderate: 1 } }));
      }
    });
    const res = await ext.postComment("https://truthnovel.top/2430-x/", { parentId: "58659", author: "FanTest", email: "a@b.co", body: "reply" }, ctx);
    expect(res.id).toBe("58720");
    const add = seen.find((b) => b.includes("wpdAddComment"));
    expect(add).toContain("wpdiscuz_unique_id=58659_0");
    expect(add).toContain("wpd_comment_depth=2");
    await expect(ext.postComment("https://truthnovel.top/2430-x/", { author: "AB", email: "a@b.co", body: "x" }, ctx)).rejects.toThrow();
  });

  it("votes via wpdVoteOnComment and returns server counts", async () => {
    const seen = [];
    const ctx = mockCtx({
      "admin-ajax.php": (url, init) => {
        const body = String(init.body || "");
        seen.push(body);
        if (body.includes("action=wpdGetNonce")) {
          return ok(JSON.stringify({ success: true, data: { wpdiscuz_nonce: "v1" } }));
        }
        return ok(JSON.stringify({ success: true, data: { likeCount: "15", curUserReaction: 1 } }));
      }
    });
    const res = await ext.voteComment("https://truthnovel.top/2430-x/", { commentId: "58659", vote: 1 }, ctx);
    expect(res.ok).toBe(true);
    expect(res.likes).toBe(15);
    expect(res.liked).toBe(true);
    const vote = seen.find((b) => b.includes("wpdVoteOnComment"));
    expect(vote).toContain("commentId=58659");
    expect(vote).toContain("voteType=1");
    expect(vote).toContain("wpdiscuz_nonce=v1");
    await expect(ext.voteComment("https://truthnovel.top/2430-x/", { commentId: "", vote: 1 }, ctx)).rejects.toThrow();
  });

  it("fetches author comments across chapters via WP REST API", async () => {
    const mockComments = [
      {
        id: 58826,
        post: 10907,
        author_name: "اورابوراس",
        date: "2026-09-12T19:02:45",
        content: { rendered: "<p>تعليق تجريبي رائع &#8230;</p>\n" },
        _embedded: {
          up: [
            {
              id: 10907,
              title: { rendered: "2432 -قرار روبين" },
              link: "https://truthnovel.top/2432-decision/"
            }
          ]
        }
      }
    ];

    const sampleChapterHtml = `
      <div id="comment-58826" class="wpd-comment-right">
        <div class="wpd-comment-header">اورابوراس</div>
        <div class='wpd-vote-result wpd-vote-result-like' title='15'>15</div>
      </div>
    `;

    const ctx = mockCtx({
      "/wp-json/wp/v2/comments": (url) => {
        return {
          status: 200,
          ok: true,
          headers: {
            "x-wp-total": "108",
            "x-wp-totalpages": "4"
          },
          text: JSON.stringify(mockComments)
        };
      },
      "https://truthnovel.top/2432-decision/": ok(sampleChapterHtml)
    });

    const res = await ext.getAuthorComments("اورابوراس", 1, ctx);
    expect(res.authorName).toBe("اورابوراس");
    expect(res.totalComments).toBe(108);
    expect(res.totalLikes).toBe(15);
    expect(res.hasMore).toBe(true);
    expect(res.comments.length).toBe(1);
    expect(res.comments[0].id).toBe("58826");
    expect(res.comments[0].likes).toBe(15);
    expect(res.comments[0].chapterTitle).toBe("2432 -قرار روبين");
    expect(res.comments[0].chapterUrl).toBe("https://truthnovel.top/2432-decision/");
    expect(res.comments[0].body).toBe("تعليق تجريبي رائع …");
  });

  it("quotes the parent comment inside reply cards", async () => {
    const mockComments = [
      {
        id: 60197,
        post: 11060,
        parent: 60185,
        author_name: "السائل عن الجن",
        date: "2026-09-22T23:00:00",
        content: { rendered: "<p>رد تجريبي</p>\n" },
        _embedded: {
          up: [
            {
              id: 11060,
              title: { rendered: "2455 &#8211;عنوان الفصل" },
              link: "https://truthnovel.top/2455-x/"
            }
          ]
        }
      },
      {
        id: 60190,
        post: 11060,
        parent: 0,
        author_name: "السائل عن الجن",
        date: "2026-09-22T22:00:00",
        content: { rendered: "<p>تعليق أساسي</p>\n" },
        _embedded: {
          up: [
            {
              id: 11060,
              title: { rendered: "2455 &#8211;عنوان الفصل" },
              link: "https://truthnovel.top/2455-x/"
            }
          ]
        }
      }
    ];
    const parentJson = {
      id: 60185,
      author_name: "القارئ الأصلي",
      content: { rendered: "<p>التعليق الأصلي &#8220;مقتبس&#8221;</p>" }
    };
    const ctx = mockCtx({
      "/wp-json/wp/v2/comments?search=": () => ({
        status: 200,
        ok: true,
        headers: { "x-wp-total": "2", "x-wp-totalpages": "1" },
        text: JSON.stringify(mockComments)
      }),
      "include=60185": ok(JSON.stringify([parentJson]))
    });

    const res = await ext.getAuthorComments("السائل عن الجن", 1, ctx);
    const reply = res.comments.find((c) => c.id === "60197");
    expect(reply.parentId).toBe("60185");
    expect(reply.replyToAuthor).toBe("القارئ الأصلي");
    expect(reply.replyToBody).toBe("التعليق الأصلي “مقتبس”");
    // Top-level comment carries no quote
    const top = res.comments.find((c) => c.id === "60190");
    expect(top.parentId).toBeUndefined();
    expect(top.replyToBody).toBeUndefined();
  });

  it("prefers RSS feed exact times over homepage day-level dates", async () => {
    const list = `
<div id="w4pl-inner-257" class="w4pl-inner"><ul>
<li><a class="post_title w4pl_post_title" href="https://truthnovel.top/2444-x/">2444 -التفاوض مع طاغوت</a></li>
<li><a class="post_title w4pl_post_title" href="https://truthnovel.top/2445-x/">2445 -عرض للطاغوت</a></li>
<li><a class="post_title w4pl_post_title" href="https://truthnovel.top/1-genius/" title="View 1 -عبقري">1 -عبقري</a></li>
</ul></div>`;
    const home = `
<div class="bs-blog-post">
<h4 class="title"><a href="https://truthnovel.top/2445-x/">2445 -عرض للطاغوت</a></h4>
<div class="bs-blog-meta"><span class="bs-blog-date"><a href="https://truthnovel.top/2026/09/"><time datetime="">16 سبتمبر، 2026</time></a></span></div>
</div>
<div class="bs-blog-post">
<h4 class="title"><a href="https://truthnovel.top/2444-x/">2444 -التفاوض مع طاغوت</a></h4>
<div class="bs-blog-meta"><span class="bs-blog-date"><a href="https://truthnovel.top/2026/09/"><time datetime="">16 سبتمبر، 2026</time></a></span></div>
</div>`;
    const feed = `<?xml version="1.0"?><rss><channel>
<item><title>2444 -التفاوض مع طاغوت</title><link>https://truthnovel.top/2444-x/</link><pubDate>Wed, 16 Sep 2026 13:02:07 +0000</pubDate></item>
<item><title>2445 -عرض للطاغوت</title><link>https://truthnovel.top/2445-x/</link><pubDate>Wed, 16 Sep 2026 19:15:57 +0000</pubDate></item>
</channel></rss>`;
    const ctx = mockCtx({
      "?w4pl=257": ok(list),
      "/feed/": ok(feed),
      "https://truthnovel.top/": ok(home)
    });
    const fresh = loadExtension("site.truthnovel.js");
    const chapters = await fresh.parseChapterList("https://truthnovel.top/?w4pl=257", ctx);
    const c44 = chapters.find((c) => c.number === 2444);
    const c45 = chapters.find((c) => c.number === 2445);
    const c1 = chapters.find((c) => c.number === 1);
    expect(c44.uploadedAt).toBe(Date.parse("Wed, 16 Sep 2026 13:02:07 +0000"));
    expect(c45.uploadedAt).toBe(Date.parse("Wed, 16 Sep 2026 19:15:57 +0000"));
    expect(c45.uploadedAt).toBeGreaterThan(c44.uploadedAt);
    // Old chapter must not be stamped as today
    expect(c1.uploadedAt).toBeLessThan(c44.uploadedAt);
  });

  it("parses Arabic relative times", async () => {
    const now = Date.now();
    const sixH = ext._parseDate("منذ 6 ساعات", now);
    expect(sixH).toBeGreaterThan(now - 6 * 60 * 60 * 1000 - 60000);
    expect(sixH).toBeLessThanOrEqual(now);
    const tenM = ext._parseDate("منذ 10 دقائق", now);
    expect(tenM).toBeGreaterThan(now - 10 * 60 * 1000 - 60000);
    expect(tenM).toBeLessThanOrEqual(now);
  });
});
