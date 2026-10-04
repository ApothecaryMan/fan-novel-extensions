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
  it("caches REST pages so a repeat full crawl costs nothing", async () => {
    // Regression guard: _restPosts briefly used raw xFetch, which silently
    // undid the caching the list always had — a second parseChapterList inside
    // the TTL re-downloaded all 26 pages (593 KB).
    const fresh = loadExtension("site.truthnovel.js");
    let hits = 0;
    const ctx = mockCtx({
      "/wp-json/wp/v2/posts?per_page=100": () => {
        hits += 1;
        return ok(JSON.stringify([{ id: 1, link: "https://truthnovel.top/1-x/", title: { rendered: "1 -أ" }, date_gmt: "2024-01-01T00:00:00" }]));
      }
    });
    await fresh.parseChapterList("https://truthnovel.top/?w4pl=257", ctx);
    const afterFirst = hits;
    await fresh.parseChapterList("https://truthnovel.top/?w4pl=257", ctx);
    expect(afterFirst).toBeGreaterThan(0);
    expect(hits).toBe(afterFirst);
  });

  it("bounds the page cache instead of pinning every chapter forever", async () => {
    // The comment reader pulls a ~225 KB page per chapter and the cache had no
    // eviction at all, so 8 chapters already retained 2.2 MB for the whole
    // session. 60 pages x 400 KB = 24 MB of input against a 12 MB ceiling, so
    // the oldest must be gone and the newest must survive — that is LRU.
    const fresh = loadExtension("site.truthnovel.js");
    const big = (url) => '<script>{"commentCount":5}</script><p>' + "x".repeat(400 * 1024) + url + "</p>";
    let n = 0;
    const ctx = mockCtx({
      "/ch-": (url) => { n += 1; return ok(big(url)); }
    });
    for (let i = 0; i < 60; i++) {
      await fresh.getCommentCount("https://truthnovel.top/ch-" + i + "-x/", ctx);
    }
    expect(n).toBe(60);

    // Oldest was evicted -> a real refetch.
    n = 0;
    await fresh.getCommentCount("https://truthnovel.top/ch-0-x/", ctx);
    expect(n).toBe(1);

    // Newest is still resident -> served from cache, no request.
    n = 0;
    await fresh.getCommentCount("https://truthnovel.top/ch-59-x/", ctx);
    expect(n).toBe(0);
  });

  it("only returns the novel for a query that actually matches it", async () => {
    const fresh = loadExtension("site.truthnovel.js");
    const ctx = mockCtx();
    expect(await fresh.searchNovels("سيد الحقيقة", 1, ctx)).toHaveLength(1);
    expect(await fresh.searchNovels("truth", 1, ctx)).toHaveLength(1);
    // Browse (empty query) always matches.
    expect(await fresh.searchNovels("", 1, ctx)).toHaveLength(1);
    // Previously EVERY query returned the novel, because both branches were
    // byte-identical.
    expect(await fresh.searchNovels("roman numerals cookbook", 1, ctx)).toHaveLength(0);
  });

  it("returns nothing for a category slug that does not exist", async () => {
    const fresh = loadExtension("site.truthnovel.js");
    const ctx = mockCtx();
    expect(await fresh.getCategoryNovels("fantasy", 1, ctx)).toHaveLength(1);
    expect(await fresh.getCategoryNovels("wrong-slug", 1, ctx)).toHaveLength(0);
  });

  it("never dates an undated comment as if it were just posted", async () => {
    // The feed is chronological, so an item with no pubDate inherits the last
    // good one. It used to be Date.now(), which pinned it to the present and
    // sorted it as the newest comment on the chapter.
    const fresh = loadExtension("site.truthnovel.js");
    const feed = `<rss><channel>
<item><link>https://truthnovel.top/c/#comment-1</link><dc:creator><![CDATA[a]]></dc:creator>
<pubDate>Mon, 01 Jan 2024 10:00:00 +0000</pubDate>
<content:encoded><![CDATA[<p>الأول</p>]]></content:encoded></item>
<item><link>https://truthnovel.top/c/#comment-2</link><dc:creator><![CDATA[b]]></dc:creator>
<content:encoded><![CDATA[<p>بلا تاريخ</p>]]></content:encoded></item>
</channel></rss>`;
    const ctx = mockCtx({
      // Order matters: mockCtx is first-match-wins, and "/c/" is a substring
      // of "/c/feed/".
      "https://truthnovel.top/c/feed/": ok(feed),
      "https://truthnovel.top/c/": ok('<script>{"commentCount":2}</script>')
    });
    const res = await fresh.getComments("https://truthnovel.top/c/", ctx);
    const undated = res.comments.find((c) => c.id === "2");
    expect(undated.createdAt).toBe(Date.parse("Mon, 01 Jan 2024 10:00:00 +0000"));
    // Explicitly NOT "now".
    expect(undated.createdAt).toBeLessThan(Date.now() - 86400000);
  });

  it("uses the site's exact-author endpoint when it is installed", async () => {
    // The real defect this fixes: with only wp/v2/comments available, the
    // profile reported 1039 for an account that has 94, because `search`
    // matches comment BODY (945 of those rows were other people writing the
    // word "تعليق") and the profile pages were sparse.
    const fresh = loadExtension("site.truthnovel.js");
    let exactHits = 0, searchHits = 0;
    const ctx = mockCtx({
      "/wp-json/tn/v1/author-comments": (url) => {
        exactHits += 1;
        expect(url).toContain("author=" + encodeURIComponent("تعليق"));
        expect(url).toContain("offset=0");
        return ok(JSON.stringify({
          total: 94,
          has_more: true,
          data: [
            { id: 1, author_name: "تعليق", content: { rendered: "<p>أول</p>" }, link: "https://truthnovel.top/1-x/#comment-1", date_gmt: "2026-09-01T10:00:00", parent: 0, post: 1 },
            { id: 2, author_name: "تعليق", content: { rendered: "<p>ثاني</p>" }, link: "https://truthnovel.top/1-x/#comment-2", date_gmt: "2026-09-02T10:00:00", parent: 1, post: 1 }
          ]
        }));
      },
      "/wp-json/wp/v2/comments?search=": () => { searchHits += 1; return ok("[]"); },
      "/wp-json/wp/v2/posts?include=": () => ok(JSON.stringify([
        { id: 1, title: { rendered: "1 -أ" }, link: "https://truthnovel.top/1-x/" }
      ]))
    });
    const res = await fresh.getAuthorComments("تعليق", 1, ctx);
    // The EXACT count, not a search total.
    expect(res.totalComments).toBe(94);
    expect(res.comments).toHaveLength(2);
    expect(res.comments[0].chapterTitle).toBe("1 -أ");
    expect(res.comments[1].parentId).toBe("1");
    expect(res.hasMore).toBe(true);
    expect(exactHits).toBe(1);
    // The DISPLAY still comes from the endpoint; the public search is now only
    // probed by the separate lifetime-likes crawl, which must not replace it.
    expect(searchHits).toBeGreaterThanOrEqual(1);
  });

  it("pages the exact endpoint with a real offset", async () => {
    const fresh = loadExtension("site.truthnovel.js");
    let seen = "";
    const ctx = mockCtx({
      "/wp-json/tn/v1/author-comments": (url) => {
        seen = url;
        return ok(JSON.stringify({ total: 94, has_more: false, data: [] }));
      }
    });
    const res = await fresh.getAuthorComments("تعليق", 3, ctx);
    expect(seen).toContain("offset=60"); // (page 3 - 1) * 30
    expect(res.hasMore).toBe(false);
  });

  it("falls back to the legacy search when the endpoint is absent", async () => {
    // Installing the plugin is optional; the app must not break before that.
    const fresh = loadExtension("site.truthnovel.js");
    const ctx = mockCtx({
      "/wp-json/tn/v1/author-comments": () => ({ ok: false, status: 404, text: "" }),
      "/wp-json/wp/v2/comments?search=": () => ({
        ok: true, status: 200,
        headers: { "x-wp-total": "1039", "x-wp-totalpages": "2" },
        text: JSON.stringify([
          { id: 1, author_name: "تعليق", content: { rendered: "<p>ملكي</p>" }, link: "https://truthnovel.top/1-x/#comment-1", date_gmt: "2026-09-01T10:00:00", parent: 0, post: 1 },
          { id: 2, author_name: "شخص آخر", content: { rendered: "<p>ذكر تعليق</p>" }, link: "https://truthnovel.top/1-x/#comment-2", date_gmt: "2026-09-02T10:00:00", parent: 0, post: 1 }
        ])
      }),
      "/wp-json/wp/v2/posts?include=": () => ok(JSON.stringify([
        { id: 1, title: { rendered: "1 -أ" }, link: "https://truthnovel.top/1-x/" }
      ]))
    });
    const res = await fresh.getAuthorComments("تعليق", 1, ctx);
    // Only the author's own row survives the client-side filter.
    expect(res.comments).toHaveLength(1);
    expect(res.comments[0].body).toBe("ملكي");
    // The search header's 1039 is inflated by body matches; the client-side
    // enumeration replaces it with the exact set (one unique comment here),
    // even without the endpoint plugin.
    expect(res.totalComments).toBe(1);
  });

  it("fetches a chapter's vote counts without the chapter page", async () => {
    // The point of this method: 117 KB of comment markup instead of a 239 KB
    // chapter page that is mostly text, and the whole chapter's set at once.
    const fresh = loadExtension("site.truthnovel.js");
    const CH = "https://truthnovel.top/2432-decision/";
    const votes = (id, n) => `<div id="comment-${id}"><span class="wpd-vote-result" title='${n}'></span></div>`;
    let ajaxBody = "";
    const ctx = mockCtx({
      // Warm the link -> post id map the way a profile load does.
      "/wp-json/tn/v1/author-comments": () => ok(JSON.stringify({
        total: 1, has_more: false,
        data: [{ id: 700, post: 2432, author_name: "n", date: "2026-09-12T19:02:45", content: { rendered: "<p>x</p>" }, link: CH + "#comment-700" }]
      })),
      "/wp-json/wp/v2/posts?include=": () => ok(JSON.stringify([
        { id: 2432, title: { rendered: "2432 -قرار" }, link: CH }
      ])),
      "/wp-admin/admin-ajax.php": (url, init) => {
        ajaxBody = String((init && init.body) || "");
        if (ajaxBody.includes("wpdGetNonce")) {
          return ok(JSON.stringify({ success: true, data: { wpdiscuz_nonce: "n1" } }));
        }
        return ok(JSON.stringify({
          success: true,
          data: { is_show_load_more: false, comments_count: 3, comment_list: votes(700, 12) + votes(701, 0) + votes(702, 5) }
        }));
      }
    });

    await fresh.getAuthorComments("n", 1, ctx);
    const res = await fresh.getCommentVotes(CH, ["700", "701", "702"], ctx);

    // One request, addressed by post id resolved from the titles batch.
    expect(ajaxBody).toContain("action=wpdLoadMoreComments");
    expect(ajaxBody).toContain("postId=2432");
    // Only the ids asked for come back, not the whole session cache.
    expect(res.counts).toEqual({ 700: 12, 701: 0, 702: 5 });
    // A comment nobody asked about is still banked for the next open.
    const after = await fresh.getAuthorComments("n", 1, ctx);
    expect(after.comments[0].likes).toBe(12);
  });

  it("spends no request when the chapter cannot be addressed", async () => {
    // A cold link -> post id map cannot be resolved without the chapter page,
    // and paying 239 KB to find an id is worse than reporting nothing.
    const fresh = loadExtension("site.truthnovel.js");
    let ajaxHits = 0;
    const ctx = mockCtx({
      "/wp-admin/admin-ajax.php": () => { ajaxHits += 1; return ok("{}"); }
    });
    const res = await fresh.getCommentVotes("https://truthnovel.top/2432-x/", ["700"], ctx);
    expect(res.counts).toEqual({});
    expect(ajaxHits).toBe(0);
  });

  it("returns attached images with the counts, since REST never carries them", async () => {
    // wpDiscuz keeps attached images OUTSIDE the comment body and renders them
    // as a sibling of the text, so `content.rendered` from REST has no <img> at
    // all. Verified live: 3 comments had attachment blocks on the chapter page
    // while 0 of the same comments had an image in REST. The only place they
    // exist is the chapter markup — the same markup the counts come from, so
    // this costs no extra request.
    const fresh = loadExtension("site.truthnovel.js");
    const CH = "https://truthnovel.top/2432-decision/";
    // Real markup shape: href comes BEFORE the class, and the block is a
    // sibling of wpd-comment-text, introduced by data-comment-id.
    const attach = (id, url) =>
      `<div class='wmu-comment-attachments' data-comment-id='${id}'>` +
      `<div class='wmu-attached-images wmu-count-single'>` +
      `<div class='wmu-attachment'><a href='${url}' class='wmu-attached-image-link wmu-lightbox'>` +
      `<img src='${url}' class='attachment'></a></div></div></div>`;
    let ajaxBody = "";
    const ctx = mockCtx({
      "/wp-json/tn/v1/author-comments": () => ok(JSON.stringify({
        total: 1, has_more: false,
        data: [{ id: 700, post: 2432, author_name: "n", date: "2026-09-12T19:02:45", content: { rendered: "<p>x</p>" }, link: CH + "#comment-700" }]
      })),
      "/wp-json/wp/v2/posts?include=": () => ok(JSON.stringify([
        { id: 2432, title: { rendered: "2432 -قرار" }, link: CH }
      ])),
      "/wp-admin/admin-ajax.php": (url, init) => {
        ajaxBody = String((init && init.body) || "");
        if (ajaxBody.includes("wpdGetNonce")) {
          return ok(JSON.stringify({ success: true, data: { wpdiscuz_nonce: "n1" } }));
        }
        return ok(JSON.stringify({
          success: true,
          data: {
            is_show_load_more: false,
            comment_list:
              `<div class="wpd-comment-text"><p>text</p></div>${attach(700, "https://truthnovel.top/wp-content/uploads/a.jpg")}` +
              `<div class="wpd-comment-text"><p>no images here</p></div>` +
              attach(701, "https://truthnovel.top/wp-content/uploads/b.jpg") +
              attach(701, "https://truthnovel.top/wp-content/uploads/c.jpg")
          }
        }));
      }
    });

    await fresh.getAuthorComments("n", 1, ctx);
    const res = await fresh.getCommentVotes(CH, ["700", "701", "702"], ctx);

    // Images come back per comment, deduped and in order.
    expect(res.images["700"]).toEqual(["https://truthnovel.top/wp-content/uploads/a.jpg"]);
    expect(res.images["701"]).toEqual([
      "https://truthnovel.top/wp-content/uploads/b.jpg",
      "https://truthnovel.top/wp-content/uploads/c.jpg"
    ]);
    // A comment with no attachments gets no entry rather than an empty list.
    expect("702" in res.images).toBe(false);
    // The counts still come from the very same single request.
    expect(ajaxBody).toContain("action=wpdLoadMoreComments");
  });

  it("walks the chapter list correctly at an exact multiple of 100", async () => {
    // THE severe one. The old code probed `per_page=1` and read
    // `x-wp-totalpages`, which for per_page=1 is the POST count (2,500), not
    // the page count (25). The "never probe past the end" guard could never
    // fire, and with no short page to stop on, the crawl asked for page 26,
    // got WordPress's 400, and threw — losing the ENTIRE chapter list.
    const fresh = loadExtension("site.truthnovel.js");
    const TOTAL = 2500;
    const hits = [];
    const ctx = mockCtx({
      "/wp-json/wp/v2/posts": (url) => {
        hits.push(url);
        const u = new URL(url);
        const pp = +u.searchParams.get("per_page") || 10;
        const pg = +u.searchParams.get("page") || 1;
        const tp = Math.ceil(TOTAL / pp);
        if (pg > tp) return ok(JSON.stringify({ code: "rest_post_invalid_page_number" }), 400);
        const f = (u.searchParams.get("_fields") || "").split(",").filter(Boolean);
        const list = Array.from({ length: Math.min(pp, TOTAL - (pg - 1) * pp) }, (_, i) => {
          const id = 1000 + (pg - 1) * pp + i;
          const row = { id, title: { rendered: `${id} -فصل` }, link: `https://truthnovel.top/${id}-x/` };
          const out = {}; f.forEach((k) => { out[k] = row[k]; }); return out;
        });
        return { ...ok(JSON.stringify(list)), headers: { "x-wp-total": String(TOTAL), "x-wp-totalpages": String(tp) } };
      }
    });
    const all = await fresh._allRestPosts("id,title,link", "asc", ctx);
    expect(all.length).toBe(TOTAL);
    // The page count came from x-wp-total on page 1: no wasted per_page=1 probe.
    expect(hits.some((u) => /per_page=1(&|_|$)/.test(u))).toBe(false);
    // And it stopped at the real end instead of asking for page 26.
    expect(hits.some((u) => /[?&]page=26\b/.test(u))).toBe(false);
  });

  it("gives the whole page's comments their own vote counts", async () => {
    // The old lazy-window regex crossed comment boundaries: a comment with no
    // counter stole its neighbour's count AND the neighbour lost its own.
    // Verified against the old code: comment1 -> 7, comment2 -> undefined.
    // Exercised through getComments so this asserts real output, not internals.
    const fresh = loadExtension("site.truthnovel.js");
    const CH = "https://truthnovel.top/2432-x/";
    const item = (id, body) =>
      `<item><link>${CH}#comment-${id}</link>` +
      `<dc:creator><![CDATA[u${id}]]></dc:creator>` +
      `<pubDate>Mon, 01 Jun 2026 10:00:00 +0000</pubDate>` +
      `<content:encoded><![CDATA[<p>${body}</p>]]></content:encoded></item>`;
    // Comments come from the feed; the vote counters come from the page.
    const feed = `<rss><channel>${item(1, "no votes")}${item(2, "seven")}${item(3, "zero")}</channel></rss>`;
    const page =
      '<div id="comment-1"><div class="wpd-comment-text"><p>no votes here</p></div></div>' +
      '<div id="comment-2"><div class="wpd-comment-text"><p>seven</p></div>' +
      "<span class=\"wpd-vote-result\" title='7'>7</span></div>" +
      '<div id="comment-3"><div class="wpd-comment-text"><p>zero</p></div>' +
      "<span class=\"wpd-vote-result\" title='0'>0</span></div>";
    const ctx = mockCtx({
      "/2432-x/feed/": () => ok(feed),
      [CH]: () => ok(page)
    });
    const res = await fresh.getComments(CH, ctx);
    const byId = Object.fromEntries(res.comments.map((c) => [c.id, c.likes]));
    // Comment 1 has no counter, so it must not borrow a neighbour's number.
    expect(byId["1"]).not.toBe(7);
    // Comment 2 keeps its OWN 7 (it used to come back with nothing).
    expect(byId["2"]).toBe(7);
    // A genuine zero is a real tally, not "unknown".
    expect(byId["3"]).toBe(0);
  });

  it("downloads a chapter page once even when two callers race for it", async () => {
    // getComments and getCommentCount fire together when a chapter opens. The
    // cache only helped requests arriving AFTER the first finished, so both
    // missed it and downloaded the same 221 KB twice.
    const fresh = loadExtension("site.truthnovel.js");
    const CH = "https://truthnovel.top/2432-x/";
    let pageDownloads = 0;
    const ctx = mockCtx({
      // Feed FIRST: mockCtx is first-match-wins on substring, and the feed URL
      // contains the chapter URL, so the reverse order would swallow it.
      "/2432-x/feed/": () => ok("<rss><channel></channel></rss>"),
      [CH]: () => { pageDownloads += 1; return ok('<div id="comment-1"><div class="wpd-comment-text"><p>x</p></div><span class="wpd-vote-result" title=\'3\'>3</span></div>'); }
    });
    await Promise.all([fresh.getComments(CH, ctx), fresh.getCommentCount(CH, ctx)]);
    expect(pageDownloads).toBe(1);
  });

  it("posts a reply at the parent's real depth, not always 2", async () => {
    // `html` was never defined in postComment, so the depth lookup threw a
    // ReferenceError that the catch swallowed: EVERY reply went out as depth 2.
    // Level-3 comments really exist on this site (61480_61478 -> depth 3).
    const fresh = loadExtension("site.truthnovel.js");
    const CH = "https://truthnovel.top/2432-x/";
    let sent = null;
    const ctx = mockCtx({
      "/wp-json/wp/v2/posts": () => ok(JSON.stringify([{ id: 2432, link: CH }])),
      "/2432-x/": () => ok(
        "<div id='wpd-comm-777_0' class='comment depth-2 wpd-comment wpd_comment_level-2'></div>" +
        "<div id='wpd-comm-778_0' class='comment depth-3 wpd-comment wpd_comment_level-3'></div>"
      ),
      "/wp-admin/admin-ajax.php": (url, init) => {
        const b = String((init && init.body) || "");
        if (b.includes("wpdGetNonce")) return ok(JSON.stringify({ success: true, data: { wpdiscuz_nonce: "n1" } }));
        if (b.includes("wpdAddComment")) { sent = b; return ok(JSON.stringify({ success: true, data: { new_comment_id: 9001 } })); }
        return ok("{}");
      }
    });
    await fresh.postComment(CH, { author: "abcd", body: "hi", parentId: "778" }, ctx);
    expect(new URLSearchParams(sent).get("wpd_comment_depth")).toBe("4");
  });

  it("retries once with a fresh nonce when the site says the nonce is stale", async () => {
    // Verified live: a bad nonce answers HTTP 200 with the body
    // "Nonce is invalid." — NOT 403 and NOT "-1". So a status check never
    // fires and the reader just gets a JSON parse error until the 30-minute
    // cache expires. The retry has to key on the BODY.
    const fresh = loadExtension("site.truthnovel.js");
    let nonceCalls = 0, voteCalls = 0;
    const ctx = mockCtx({
      "/wp-admin/admin-ajax.php": (url, init) => {
        const b = String((init && init.body) || "");
        if (b.includes("wpdGetNonce")) {
          nonceCalls += 1;
          return ok(JSON.stringify({ success: true, data: { wpdiscuz_nonce: "n" + nonceCalls } }));
        }
        voteCalls += 1;
        // First vote attempt is rejected with the real 200 + plain-text body.
        if (voteCalls === 1) return ok("Nonce is invalid.");
        return ok(JSON.stringify({ success: true, data: { likeCount: 4, curUserReaction: 1 } }));
      }
    });
    const res = await fresh.voteComment("https://truthnovel.top/2432-x/", { commentId: "5", vote: 1 }, ctx);
    expect(res.likes).toBe(4);
    expect(voteCalls).toBe(2);   // one rejection, one retry
    expect(nonceCalls).toBe(2); // the stale nonce was dropped and refetched
  });

  it("surfaces a broken endpoint instead of silently serving the wrong total", async () => {
    // The fallback search total is ~11x too high (1039 for an account with 94),
    // so quietly degrading to it on a 500 is a silent wrong answer. Only a 404
    // genuinely means "plugin not installed".
    const fresh = loadExtension("site.truthnovel.js");
    const broken = mockCtx({
      // `ok()` hardcodes ok:true whatever status you pass, so a real failure
      // response has to be spelled out.
      "/wp-json/tn/v1/author-comments": () => ({ ok: false, status: 500, text: "boom" }),
      "/wp-json/wp/v2/comments?search=": () => ok(JSON.stringify([]), 200)
    });
    await expect(fresh.getAuthorComments("n", 1, broken)).rejects.toThrow();

    // 404 = plugin absent, so the legacy path is still correct behaviour.
    const absent = mockCtx({
      "/wp-json/tn/v1/author-comments": () => ({ ok: false, status: 404, text: JSON.stringify({ code: "rest_no_route" }) }),
      "/wp-json/wp/v2/comments?search=": () => ({
        ok: true, status: 200, headers: { "x-wp-total": "1", "x-wp-totalpages": "1" },
        text: JSON.stringify([{ id: 1, post: 2432, author_name: "n", date: "2026-09-12T19:02:45", content: { rendered: "<p>x</p>" }, link: "https://truthnovel.top/2432-x/#comment-1" }])
      }),
      "/wp-json/wp/v2/posts?include=": () => ok(JSON.stringify([{ id: 2432, title: { rendered: "1 -أ" }, link: "https://truthnovel.top/2432-x/" }]))
    });
    const ok2 = await fresh.getAuthorComments("n", 1, absent);
    expect(ok2.comments.length).toBe(1);
  });

  it("decodes &rlm; instead of leaving it as literal text", async () => {
    // `rlm: ''` gave ''.charCodeAt(0) === NaN, the guard rejected it, and the
    // literal "&rlm;" survived into every comment that contained one.
    const { ext } = { ext: loadExtension("site.truthnovel.js") };
    expect(ext._decodeEntities("a&rlm;b")).toBe("a\u200Fb");
    expect(ext._decodeEntities("a&rlm;b")).not.toContain("rlm");
  });

  it("does not stop the latest-chapters scan at an unnumbered post", async () => {
    // A title with no leading digits gives number 0, and 0 <= knownCount was
    // true for every knownCount >= 0 — so one unnumbered post at the top of the
    // descending list ended the scan and hid the newest chapters, which are
    // exactly the ones the reader is missing.
    const fresh = loadExtension("site.truthnovel.js");
    const ctx = mockCtx({
      "/wp-json/wp/v2/posts": () => ({
        ...ok(JSON.stringify([
          { id: 3, title: { rendered: "إعلان" }, link: "https://truthnovel.top/3-x/", date_gmt: "2026-09-03T00:00:00" },
          { id: 2, title: { rendered: "2 -الثاني" }, link: "https://truthnovel.top/2-x/", date_gmt: "2026-09-02T00:00:00" },
          { id: 1, title: { rendered: "1 -الأول" }, link: "https://truthnovel.top/1-x/", date_gmt: "2026-09-01T00:00:00" }
        ])),
        headers: { "x-wp-total": "3", "x-wp-totalpages": "1" }
      })
    });
    const found = await fresh.fetchLatestChapters("u", 1, ctx);
    // The unnumbered post AND chapter 2 are both newer than what we had (1).
    expect(found.map((c) => c.url)).toContain("https://truthnovel.top/3-x/");
    expect(found.map((c) => c.url)).toContain("https://truthnovel.top/2-x/");
    expect(found.map((c) => c.url)).not.toContain("https://truthnovel.top/1-x/");
  });

  it("has valid metadata", () => {
    expect(ext.id).toBe("site:truthnovel");
    expect(ext.name).toContain("سيد الحقيقة");
    expect(ext.lang).toBe("ar");
    expect(ext.version).toBe("1.11.1");
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

  it("builds the chapter list from REST, with each chapter's real date", async () => {
    // Primary path. Every chapter gets the site's own `date_gmt` — the old
    // implementation downloaded an 18.9 MB RSS feed for this and INTERPOLATED
    // dates for anything the feed did not cover.
    const fresh = loadExtension("site.truthnovel.js");
    const posts = [
      { id: 2, link: "https://truthnovel.top/1-genius/", title: { rendered: "1 &#8211; عبقري" }, date_gmt: "2024-02-25T10:00:00" },
      { id: 9, link: "https://truthnovel.top/2422-game/", title: { rendered: "2422 &#8211; حب اللعبة لذاتها" }, date_gmt: "2026-09-12T08:30:00" }
    ];
    const ctx = mockCtx({
      "/wp-json/wp/v2/posts?per_page=100": () => ok(JSON.stringify(posts))
    });
    const chapters = await fresh.parseChapterList("https://truthnovel.top/?w4pl=257", ctx);
    expect(chapters.length).toBe(2);
    expect(chapters[0].number).toBe(1);
    expect(chapters[0].title).toBe("الفصل 1 - عبقري");
    expect(chapters[0].url).toBe("https://truthnovel.top/1-genius/");
    // The site's timestamp, not a guess.
    expect(chapters[0].uploadedAt).toBe(Date.parse("2024-02-25T10:00:00Z"));

    expect(chapters[1].number).toBe(2422);
    expect(chapters[1].title).toBe("الفصل 2422 - حب اللعبة لذاتها");
    expect(chapters[1].uploadedAt).toBeGreaterThan(chapters[0].uploadedAt);
  });

  it("never invents a date for a chapter the site did not date", async () => {
    const fresh = loadExtension("site.truthnovel.js");
    const ctx = mockCtx({
      "/wp-json/wp/v2/posts?per_page=100": () => ok(JSON.stringify([
        { id: 2, link: "https://truthnovel.top/1-genius/", title: { rendered: "1 - عبقري" } }
      ]))
    });
    const chapters = await fresh.parseChapterList("https://truthnovel.top/?w4pl=257", ctx);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].uploadedAt).toBeUndefined();
  });

  it("falls back to the HTML list page when REST is unavailable", async () => {
    // Deliberate safety net: if the site ever disables the REST API, the
    // chapters must still load. Dates are absent in this path — that is the
    // accepted trade, because the alternative was refetching the 18.9 MB feed.
    const fresh = loadExtension("site.truthnovel.js");
    const ctx = mockCtx({
      "/wp-json/wp/v2/posts": () => ok("[]"),
      "?w4pl=257": ok(SAMPLE_LIST_PAGE)
    });
    const chapters = await fresh.parseChapterList("https://truthnovel.top/?w4pl=257", ctx);
    expect(chapters.length).toBe(2);
    expect(chapters[0].number).toBe(1);
    expect(chapters[0].title).toBe("الفصل 1 - عبقري");
    expect(chapters[1].number).toBe(2422);
    expect(chapters[1].title).toBe("الفصل 2422 - حب اللعبة لذاتها");
  });

  it("fetchLatestChapters reads ONE descending page instead of the whole list", async () => {
    // The old implementation called the full parseChapterList — the entire
    // 19.6 MB crawl — and discarded everything but the newest chapters.
    const fresh = loadExtension("site.truthnovel.js");
    let pages = 0;
    const ctx = mockCtx({
      "/wp-json/wp/v2/posts?per_page=100": (url) => {
        pages += 1;
        if (!url.includes("order=desc")) throw new Error("must page newest-first");
        // Newest first: 2469 and 2468 are new, 2467 is already known.
        return ok(JSON.stringify([
          { id: 3, link: "https://truthnovel.top/2469-x/", title: { rendered: "2469 - إستهزاء" }, date_gmt: "2026-09-29T18:53:37" },
          { id: 2, link: "https://truthnovel.top/2468-x/", title: { rendered: "2468 - 제목" }, date_gmt: "2026-09-28T18:53:37" },
          { id: 1, link: "https://truthnovel.top/2467-x/", title: { rendered: "2467 - known" }, date_gmt: "2026-09-27T18:53:37" }
        ]));
      }
    });
    const latest = await fresh.fetchLatestChapters("https://truthnovel.top/?w4pl=257", 2467, ctx);
    expect(latest.map((c) => c.number)).toEqual([2468, 2469]);
    expect(pages).toBe(1);
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

  it("getCommentCount reads the page marker without fetching the feed", async () => {
    // Fresh instance: the page now goes through the shared HTML cache, so a
    // shared one would see a page cached by an earlier test.
    const fresh = loadExtension("site.truthnovel.js");
    let feedHit = false;
    let pageHits = 0;
    const ctx = mockCtx({
      "2430-x": () => {
        pageHits += 1;
        return ok('<script type="application/ld+json">{"@type":"Article","commentCount":7}</script>');
      },
      "feed/": () => { feedHit = true; return ok("<rss></rss>"); }
    });
    const res = await fresh.getCommentCount("https://truthnovel.top/2430-x/", ctx);
    expect(res).toEqual({ count: 7 });
    expect(feedHit).toBe(false);
    // The reason for the cache: the same 221 KB page is not downloaded twice.
    await fresh.getCommentCount("https://truthnovel.top/2430-x/", ctx);
    expect(pageHits).toBe(1);
  });

  it("getCommentCount falls back to counting feed items", async () => {
    const ctx = mockCtx({
      "2431-x": (url) => url.includes("feed/")
        ? ok("<rss><channel><item>a</item><item>b</item><item>c</item></channel></rss>")
        : ok("<html><body>no marker here</body></html>")
    });
    const res = await ext.getCommentCount("https://truthnovel.top/2431-x/", ctx);
    expect(res).toEqual({ count: 3 });
  });

  it("getTotalViews cold-fills from tiny id pages + bulk sums", async () => {
    const fresh = loadExtension("site.truthnovel.js");
    let postsHits = 0;
    let sumHits = 0;
    const ids100 = [];
    for (let i = 1; i <= 100; i += 1) ids100.push({ id: 1000 + i });
    const ctx = mockCtx({
      "/wp-json/wp/v2/posts": (url) => {
        postsHits += 1;
        const pg = Number((url.match(/page=(\d+)/) || [])[1] || 1);
        // Full first page, short second → one parallel wave of 8, then stop.
        return ok(JSON.stringify(pg === 1 ? ids100 : [{ id: 2001 }, { id: 2002 }]));      },
      "get-post-views/": () => {
        sumHits += 1;
        return ok("1500");
      }
    });
    const res = await fresh.getTotalViews("https://truthnovel.top/?w4pl=257", ctx);
    expect(res).toEqual({ count: 1500 });
    expect(postsHits).toBe(8); // one wave of 8, stops at the short page 2
    expect(sumHits).toBe(1); // one bulk sum, no per-chapter fetches
  });

  it("getTotalViews warm refresh adds only genuinely new posts", async () => {
    const fresh = loadExtension("site.truthnovel.js");
    let ascHits = 0;
    let descHits = 0;
    let feedHits = 0;
    const seenSums = [];
    // The cold crawl (ascending) only knows 101+102. The warm pass looks at the
    // newest page and finds 103, which is the only one worth summing.
    const ctx = mockCtx({
      "/wp-json/wp/v2/posts": (url) => {
        if (url.includes("order=desc")) {
          descHits += 1;
          return ok(JSON.stringify([{ id: 103 }, { id: 102 }, { id: 101 }]));
        }
        ascHits += 1;
        return ok(JSON.stringify([{ id: 101 }, { id: 102 }]));
      },
      "get-post-views/": (url) => {
        seenSums.push(url);
        return ok(url.includes("103") ? "60" : "1500");
      },
      "/feed/": () => {
        feedHits += 1;
        return ok("<rss></rss>");
      }
    });
    // Cold: crawl ids, sum both.
    await expect(fresh.getTotalViews("https://truthnovel.top/?w4pl=257", ctx)).resolves.toEqual({ count: 1500 });
    // Warm: one descending page finds 103 and sums only it.
    await expect(fresh.getTotalViews("https://truthnovel.top/?w4pl=257", ctx)).resolves.toEqual({ count: 1560 });
    expect(ascHits).toBe(8);
    expect(seenSums.filter((u) => u.includes("103")).length).toBe(1);
    // Third call: nothing new, and the descending page is served from the
    // shared cache, so no request at all.
    await expect(fresh.getTotalViews("https://truthnovel.top/?w4pl=257", ctx)).resolves.toEqual({ count: 1560 });
    expect(descHits).toBe(1);
    // The 18.9 MB site-wide feed is no longer part of this path at all.
    expect(feedHits).toBe(0);
  });

  it("parseNovelInfo exposes total views as readersCount", async () => {
    const fresh = loadExtension("site.truthnovel.js");
    const ctx = mockCtx({
      "/wp-json/wp/v2/posts": () => ok(JSON.stringify([{ id: 101 }])),
      "get-post-views/": () => ok("777")
    });
    const info = await fresh.parseNovelInfo("https://truthnovel.top/?w4pl=257", ctx);
    expect(info.readersCount).toBe("777");
  });

  it("parseNovelInfo still opens when views counting fails", async () => {
    const fresh = loadExtension("site.truthnovel.js");
    const info = await fresh.parseNovelInfo("https://truthnovel.top/?w4pl=257", mockCtx());
    expect(info.title).toBe("سيد الحقيقة");
    expect(info.readersCount).toBeUndefined();
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
    // A FRESH instance: the nonce is cached in module scope, so a shared
    // instance would leak a warmed nonce from an earlier test.
    const fresh = loadExtension("site.truthnovel.js");
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
    const res = await fresh.voteComment("https://truthnovel.top/2430-x/", { commentId: "58659", vote: 1 }, ctx);
    expect(res.ok).toBe(true);
    expect(res.likes).toBe(15);
    expect(res.liked).toBe(true);
    const vote = seen.find((b) => b.includes("wpdVoteOnComment"));
    expect(vote).toContain("commentId=58659");
    expect(vote).toContain("voteType=1");
    expect(vote).toContain("wpdiscuz_nonce=v1");
    await expect(fresh.voteComment("https://truthnovel.top/2430-x/", { commentId: "", vote: 1 }, ctx)).rejects.toThrow();

    // The nonce used to be refetched on EVERY vote, doubling the cost of a tap.
    // It is now cached, so a second vote adds no nonce request.
    const nonceFetches = () => seen.filter((b) => b.includes("action=wpdGetNonce")).length;
    const before = nonceFetches();
    await fresh.voteComment("https://truthnovel.top/2430-x/", { commentId: "58659", vote: 1 }, ctx);
    expect(nonceFetches()).toBe(before);
  });

  it("banks the count a vote returns so the profile needs no chapter fetch", async () => {
    const fresh = loadExtension("site.truthnovel.js");
    const ctx = mockCtx({
      "admin-ajax.php": (url, init) => {
        const body = String(init.body || "");
        if (body.includes("action=wpdGetNonce")) {
          return ok(JSON.stringify({ success: true, data: { wpdiscuz_nonce: "v1" } }));
        }
        return ok(JSON.stringify({ success: true, data: { likeCount: "42", curUserReaction: 1 } }));
      }
    });
    await fresh.voteComment("https://truthnovel.top/2430-x/", { commentId: "58659", vote: 1 }, ctx);

    const requested = [];
    const listCtx = mockCtx({
      "/wp-json/wp/v2/comments": (url) => {
        requested.push(url);
        return {
          status: 200, ok: true, headers: { "x-wp-total": "1", "x-wp-totalpages": "1" },
          text: JSON.stringify([{
            id: 58659, post: 2432, author_name: "n", date: "2026-09-12T19:02:45",
            content: { rendered: "<p>hi</p>" }, link: "https://truthnovel.top/2432-decision/#comment-58659"
          }])
        };
      },
      "/wp-json/wp/v2/posts?include=": () => ok(JSON.stringify([
        { id: 2432, title: { rendered: "2432 -قرار" }, link: "https://truthnovel.top/2432-decision/" }
      ]))
    });
    const res = await fresh.getAuthorComments("n", 1, listCtx);
    expect(res.comments[0].likes).toBe(42);
    expect(res.totalLikes).toBe(42);
    // Critically: no chapter page was downloaded to learn that.
    expect(requested.some((u) => /2432-decision\/?$/.test(u))).toBe(false);
  });

  it("fetches author comments across chapters via WP REST API", async () => {
    const mockComments = [
      {
        id: 58826,
        post: 2432,
        author_name: "اورابوراس",
        date: "2026-09-12T19:02:45",
        content: { rendered: "<p>تعليق تجريبي رائع &#8230;</p>\n" },
        link: "https://truthnovel.top/2432-decision/#comment-58826"
      }
    ];

    const requested = [];
    const ctx = mockCtx({
      "/wp-json/wp/v2/comments": (url) => {
        requested.push(url);
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
      "/wp-json/wp/v2/posts?include=": (url) => {
        requested.push(url);
        return ok(JSON.stringify([
          { id: 2432, title: { rendered: "2432 -قرار روبين" }, link: "https://truthnovel.top/2432-decision/" }
        ]));
      },
      "https://truthnovel.top/2432-decision/": () => {
        requested.push("CHAPTER-PAGE");
        return ok("<html>should never be fetched</html>");
      }
    });

    const res = await ext.getAuthorComments("اورابوراس", 1, ctx);
    expect(res.authorName).toBe("اورابوراس");
    // The search header (108) is only for the search; the exact author set is
    // what the enumeration found (the mock repeats one row across its 4 pages).
    expect(res.totalComments).toBe(1);
    expect(res.hasMore).toBe(true);
    expect(res.comments.length).toBe(1);
    expect(res.comments[0].id).toBe("58826");
    expect(res.comments[0].chapterTitle).toBe("2432 -قرار روبين");
    expect(res.comments[0].chapterUrl).toBe("https://truthnovel.top/2432-decision/");
    expect(res.comments[0].body).toBe("تعليق تجريبي رائع …");

    // The regression this locks down: the profile must NOT download chapter
    // pages any more. It used to pull up to 10 of them (~195 KB each) per open.
    expect(requested).not.toContain("CHAPTER-PAGE");
    // And it must not ask WordPress to inline every parent post either — that
    // alone was ~700 KB per page, because a "post" here is a whole chapter.
    expect(requested.some((u) => u.includes("_embed=up"))).toBe(false);
    // Chapter titles are still resolved in ONE batched request. The extra
    // comments-search calls are the client-side lifetime-likes crawl (display
    // page + enumeration pages), not the display path itself.
    expect(requested.filter((u) => u.includes("/wp-json/wp/v2/posts?include=")).length).toBe(1);
    expect(requested.filter((u) => u.includes("/wp-json/wp/v2/comments?search=")).length).toBe(5);
  });

  it("omits likes entirely when the count is unknown, rather than reporting 0", async () => {
    // A hardcoded 0 used to make an un-scraped comment look confidently
    // unliked. Absent means "we don't know", which the host renders as no
    // number at all.
    const fresh = loadExtension("site.truthnovel.js");
    const ctx = mockCtx({
      "/wp-json/wp/v2/comments": () => ({
        status: 200, ok: true, headers: { "x-wp-total": "1", "x-wp-totalpages": "1" },
        text: JSON.stringify([{
          id: 700, post: 2432, author_name: "n", date: "2026-09-12T19:02:45",
          content: { rendered: "<p>hi</p>" }, link: "https://truthnovel.top/2432-decision/#comment-700"
        }])
      }),
      "/wp-json/wp/v2/posts?include=": () => ok(JSON.stringify([
        { id: 2432, title: { rendered: "2432 -قرار" }, link: "https://truthnovel.top/2432-decision/" }
      ]))
    });
    const res = await fresh.getAuthorComments("n", 1, ctx);
    expect("likes" in res.comments[0]).toBe(false);
    // The total is unknown for the same reason the card is, and the host draws
    // "—" for it. A 0 here would have claimed nobody liked anything.
    expect(res.totalLikes).toBeNull();
  });

  it("reports a total only when every comment on the page is counted", async () => {
    // The header sits directly above the list, so a partial sum would disagree
    // with the cards under it. Null is the only honest middle answer.
    const fresh = loadExtension("site.truthnovel.js");
    const row = (id, post) => ({
      id, post, author_name: "n", date: "2026-09-12T19:02:45",
      content: { rendered: "<p>hi</p>" }, link: `https://truthnovel.top/${post}-c/#comment-${id}`
    });
    const ctx = mockCtx({
      "/wp-json/tn/v1/author-comments": () => ok(JSON.stringify({
        total: 2, has_more: false,
        data: [{ ...row(801, 2432), likes: 4 }, row(802, 2433)]
      })),
      "/wp-json/wp/v2/posts?include=": () => ok(JSON.stringify([
        { id: 2432, title: { rendered: "1 -أ" }, link: "https://truthnovel.top/2432-c/" },
        { id: 2433, title: { rendered: "2 -ب" }, link: "https://truthnovel.top/2433-c/" }
      ]))
    });
    // The endpoint only rated the first comment, so the second is unknown.
    const partial = await fresh.getAuthorComments("n", 1, ctx);
    expect(partial.comments[0].likes).toBe(4);
    expect("likes" in partial.comments[1]).toBe(false);
    expect(partial.totalLikes).toBeNull();

    // Rating both makes the total reportable.
    const both = loadExtension("site.truthnovel.js");
    const full = mockCtx({
      "/wp-json/tn/v1/author-comments": () => ok(JSON.stringify({
        total: 2, has_more: false,
        data: [{ ...row(801, 2432), likes: 4 }, { ...row(802, 2433), likes: 6 }]
      })),
      "/wp-json/wp/v2/posts?include=": () => ok(JSON.stringify([
        { id: 2432, title: { rendered: "1 -أ" }, link: "https://truthnovel.top/2432-c/" },
        { id: 2433, title: { rendered: "2 -ب" }, link: "https://truthnovel.top/2433-c/" }
      ]))
    });
    const res = await both.getAuthorComments("n", 1, full);
    expect(res.totalLikes).toBe(10);
  });

  it("reads counts off the site's endpoint, ahead of the session cache", async () => {
    // The endpoint is authoritative; the cache can be minutes stale after other
    // readers vote. A JSON null (plugin could not read the meta) must NOT be
    // taken as a count of zero.
    const fresh = loadExtension("site.truthnovel.js");
    const ctx = mockCtx({
      "/wp-json/tn/v1/author-comments": () => ok(JSON.stringify({
        total: 2, has_more: false,
        data: [
          { id: 901, post: 2432, author_name: "n", date: "2026-09-12T19:02:45", content: { rendered: "<p>a</p>" }, link: "https://truthnovel.top/2432-c/#comment-901", likes: 20 },
          { id: 902, post: 2432, author_name: "n", date: "2026-09-12T19:02:45", content: { rendered: "<p>b</p>" }, link: "https://truthnovel.top/2432-c/#comment-902", likes: null }
        ]
      })),
      "/wp-json/wp/v2/posts?include=": () => ok(JSON.stringify([
        { id: 2432, title: { rendered: "1 -أ" }, link: "https://truthnovel.top/2432-c/" }
      ]))
    });
    const res = await fresh.getAuthorComments("n", 1, ctx);
    expect(res.comments[0].likes).toBe(20);
    // null is "unknown", not 0 — it must not become a fabricated zero.
    expect(res.comments[1].likes).toBeUndefined();
    expect(res.totalLikes).toBeNull();
  });

  it("reports a count the reader path already saw, with no extra request", async () => {
    // getComments parses the chapter page for the reader anyway; it banks the
    // counts, so opening the same author's profile afterwards is free.
    const fresh = loadExtension("site.truthnovel.js");
    const chapterHtml = `
      <div id="comment-58826" class="wpd-comment-right">
        <div class='wpd-vote-result wpd-vote-result-like' title='15'>15</div>
      </div>
    `;
    const feedXml = `<rss><channel>
      <item>
        <link>https://truthnovel.top/2432-decision/#comment-58826</link>
        <dc:creator><![CDATA[اورابوراس]]></dc:creator>
        <pubDate>Sat, 12 Sep 2026 19:02:45 +0000</pubDate>
        <content:encoded><![CDATA[<p>مرحبا</p>]]></content:encoded>
      </item>
    </channel></rss>`;

    await fresh.getComments("https://truthnovel.top/2432-decision/", mockCtx({
      "https://truthnovel.top/2432-decision/": ok(chapterHtml),
      "https://truthnovel.top/2432-decision/feed/": ok(feedXml)
    }));

    const requested = [];
    const ctx = mockCtx({
      "/wp-json/wp/v2/comments": (url) => {
        requested.push(url);
        return {
          status: 200, ok: true, headers: { "x-wp-total": "1", "x-wp-totalpages": "1" },
          text: JSON.stringify([{
            id: 58826, post: 2432, author_name: "اورابوراس", date: "2026-09-12T19:02:45",
            content: { rendered: "<p>مرحبا</p>" }, link: "https://truthnovel.top/2432-decision/#comment-58826"
          }])
        };
      },
      "/wp-json/wp/v2/posts?include=": (url) => {
        requested.push(url);
        return ok(JSON.stringify([
          { id: 2432, title: { rendered: "2432 -قرار" }, link: "https://truthnovel.top/2432-decision/" }
        ]));
      }
    });
    const res = await fresh.getAuthorComments("اورابوراس", 1, ctx);
    expect(res.comments[0].likes).toBe(15);
    expect(res.totalLikes).toBe(15);
    // Comments + one batched titles call. No chapter page, because getComments
    // already banked that count.
    expect(requested.length).toBe(2);
  });

  it("computes the author's exact lifetime likes from public data alone", async () => {
    // The endpoint is absent (unmatched -> 404), so this exercises the
    // client-side crawl: enumerate the author's comments across search pages,
    // then read each thread's count from wpDiscuz's public action.
    const fresh = loadExtension("site.truthnovel.js");
    const row = (id, post) => ({
      id, author_name: "n", post, date_gmt: "2026-09-12T19:02:45",
      content: { rendered: "<p>hi</p>" }, link: `https://truthnovel.top/${post}-c/#comment-${id}`
    });
    const voteMarkup = (id, n) =>
      `<div id="comment-${id}"><span class="wpd-vote-result" title='${n}'></span></div>`;
    const votes = { 11: 2, 12: 5, 13: 1 };
    const rowsForPage = (page) => page === 1
      ? [row(11, 2432), row(12, 2433), { ...row(99, 2432), author_name: "someone else" }]
      : [row(13, 2434)];
    const ctx = mockCtx({
      "/wp-json/wp/v2/comments?search=": (url) => {
        const page = parseInt(new URL(url).searchParams.get("page"), 10) || 1;
        return { ok: true, status: 200,
          headers: { "x-wp-total": "1049", "x-wp-totalpages": "2" },
          text: JSON.stringify(rowsForPage(page)) };
      },
      "/wp-json/wp/v2/posts?include=": () => ok(JSON.stringify([
        { id: 2432, title: { rendered: "1 -أ" }, link: "https://truthnovel.top/2432-c/" },
        { id: 2433, title: { rendered: "2 -ب" }, link: "https://truthnovel.top/2433-c/" },
        { id: 2434, title: { rendered: "3 -ج" }, link: "https://truthnovel.top/2434-c/" }
      ])),
      "admin-ajax.php": (url, init) => {
        const body = String((init && init.body) || "");
        if (body.includes("action=wpdGetNonce")) {
          return ok(JSON.stringify({ success: true, data: { wpdiscuz_nonce: "n1" } }));
        }
        const m = /commentId=(\d+)/.exec(body);
        const id = m ? m[1] : "0";
        return ok(JSON.stringify({ success: true, data: { message: voteMarkup(id, votes[id] || 0) } }));
      }
    });

    const page1 = await fresh.getAuthorComments("n", 1, ctx);
    // Page 1 holds only two of the three comments, yet the header shows the
    // author's real lifetime total (2 + 5 + 1), not the page subtotal.
    expect(page1.totalLikes).toBe(8);
    // And the exact author count, not the search header's inflated 1049.
    expect(page1.totalComments).toBe(3);
    expect(page1.comments.find((c) => c.id === "11").likes).toBe(2);
    expect(page1.comments.find((c) => c.id === "12").likes).toBe(5);

    // A later page reports the SAME lifetime total, and its own cards too.
    const page2 = await fresh.getAuthorComments("n", 2, ctx);
    expect(page2.totalLikes).toBe(8);
    expect(page2.comments.find((c) => c.id === "13").likes).toBe(1);
  });

  it("keeps the total unknown when too many threads cannot be read", async () => {
    const fresh = loadExtension("site.truthnovel.js");
    const row = (id, post) => ({
      id, author_name: "n", post, date_gmt: "2026-09-12T19:02:45",
      content: { rendered: "<p>hi</p>" }, link: `https://truthnovel.top/${post}-c/#comment-${id}`
    });
    const ctx = mockCtx({
      "/wp-json/wp/v2/comments?search=": () => ({ ok: true, status: 200,
        headers: { "x-wp-total": "2", "x-wp-totalpages": "1" },
        text: JSON.stringify([row(21, 2432), row(22, 2433)]) }),
      "/wp-json/wp/v2/posts?include=": () => ok(JSON.stringify([
        { id: 2432, title: { rendered: "1 -أ" }, link: "https://truthnovel.top/2432-c/" },
        { id: 2433, title: { rendered: "2 -ب" }, link: "https://truthnovel.top/2433-c/" }
      ])),
      "admin-ajax.php": (url, init) => {
        const body = String((init && init.body) || "");
        if (body.includes("action=wpdGetNonce")) {
          return ok(JSON.stringify({ success: true, data: { wpdiscuz_nonce: "n1" } }));
        }
        // Threads come back without a readable vote for either comment.
        return ok(JSON.stringify({ success: true, data: { message: "<div>no counter</div>" } }));
      }
    });
    const res = await fresh.getAuthorComments("n", 1, ctx);
    // Half the set is unreadable, so no honest lifetime number exists. A page
    // sum would be equally wrong, so it is null ("—"), not 0.
    expect(res.totalLikes).toBeNull();
  });

  it("backs off and reports unknown when the site rate-limits the crawl", async () => {
    // A 429/403 must never turn into a retry storm against a site we do not
    // own: one throttled page ends the total as unknown and stops the crawl.
    const fresh = loadExtension("site.truthnovel.js");
    let enumPages = 0;
    const ctx = mockCtx({
      "/wp-json/wp/v2/comments?search=": (url) => {
        if (url.includes("per_page=100")) {
          enumPages += 1;
          return { ok: false, status: 429, text: "" };
        }
        return { ok: true, status: 200,
          headers: { "x-wp-total": "2", "x-wp-totalpages": "2" },
          text: JSON.stringify([{
            id: 31, author_name: "n", post: 2432, date_gmt: "2026-09-12T19:02:45",
            content: { rendered: "<p>x</p>" }, link: "https://truthnovel.top/2432-c/#comment-31"
          }]) };
      },
      "/wp-json/wp/v2/posts?include=": () => ok(JSON.stringify([
        { id: 2432, title: { rendered: "1 -أ" }, link: "https://truthnovel.top/2432-c/" }
      ])),
      "admin-ajax.php": (url, init) => {
        const body = String((init && init.body) || "");
        if (body.includes("action=wpdGetNonce")) {
          return ok(JSON.stringify({ success: true, data: { wpdiscuz_nonce: "n1" } }));
        }
        return { ok: false, status: 429, text: "" };
      }
    });
    const res = await fresh.getAuthorComments("n", 1, ctx);
    expect(res.totalLikes).toBeNull();
    // Page 1 was throttled, so the parallel page-2 fetch never went out.
    expect(enumPages).toBe(1);
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

  it("KNOWN LIMITATION: wpDiscuz page-only attachments are not merged into profile cards", async () => {
    // wpDiscuz's drag-and-drop attachments (wmu-attached-images) exist ONLY in
    // the chapter page HTML, never in the REST comment body. Reading them
    // therefore requires downloading that page — which is the ~195 KB x 10
    // (1.95 MB per profile open) this extension no longer does.
    //
    // So: profile cards now show images that are inline in the comment body,
    // and NOT wpDiscuz's separate attachment feature. That is a deliberate
    // trade for removing the 1.95 MB. If these thumbs matter more than the
    // bandwidth, the fix is a batched endpoint on the site — not re-adding the
    // page crawl.
    const mockComments = [
      {
        id: 60202,
        post: 11065,
        parent: 0,
        author_name: "اورابوراس",
        date: "2026-09-22T19:56:42",
        content: { rendered: "<p>قيصر وهو يسلك طريق التعالي…</p>" },
        link: "https://truthnovel.top/2456-x/#comment-60202"
      }
    ];
    const chapterHtml =
      `<div data-comment-id='60202'><div class='wmu-attached-images'>` +
      `<a href='https://truthnovel.top/wp-content/uploads/2026/09/g.9.gif'>` +
      `<img src='https://truthnovel.top/wp-content/uploads/2026/09/g.9.gif' /></a>` +
      `</div></div><div id="comment-60202"></div>`;

    const fresh = loadExtension("site.truthnovel.js");
    const requested = [];
    const ctx = mockCtx({
      "/wp-json/wp/v2/comments": (url) => {
        requested.push(url);
        return {
          status: 200, ok: true,
          headers: { "x-wp-total": "1", "x-wp-totalpages": "1" },
          text: JSON.stringify(mockComments)
        };
      },
      "/wp-json/wp/v2/posts?include=": () => ok(JSON.stringify([
        { id: 11065, title: { rendered: "2456 -الكائنات" }, link: "https://truthnovel.top/2456-x/" }
      ])),
      "https://truthnovel.top/2456-x/": () => {
        requested.push("CHAPTER-PAGE");
        return ok(chapterHtml);
      }
    });

    const res = await fresh.getAuthorComments("اورابوراس", 1, ctx);
    expect(res.comments[0].id).toBe("60202");
    expect(res.comments[0].images).toBeUndefined();
    expect(requested).not.toContain("CHAPTER-PAGE");
  });

  it("still shows images that are inline in the comment body", async () => {
    const fresh = loadExtension("site.truthnovel.js");
    const ctx = mockCtx({
      "/wp-json/wp/v2/comments": () => ({
        status: 200, ok: true, headers: { "x-wp-total": "1", "x-wp-totalpages": "1" },
        text: JSON.stringify([{
          id: 60203, post: 11065, parent: 0, author_name: "n", date: "2026-09-22T19:56:42",
          content: { rendered: '<p>hi</p><img src="https://truthnovel.top/wp-content/uploads/2026/09/inline.jpg" />' },
          link: "https://truthnovel.top/2456-x/#comment-60203"
        }])
      }),
      "/wp-json/wp/v2/posts?include=": () => ok(JSON.stringify([
        { id: 11065, title: { rendered: "2456 -الكائنات" }, link: "https://truthnovel.top/2456-x/" }
      ]))
    });
    const res = await fresh.getAuthorComments("n", 1, ctx);
    expect(res.comments[0].images).toEqual([
      "https://truthnovel.top/wp-content/uploads/2026/09/inline.jpg"
    ]);
  });

  it("dates every chapter from the site, including the oldest, and never the RSS feed", async () => {
    // Replaces "prefers RSS feed exact times over homepage day-level dates".
    // The 18.9 MB feed is gone entirely, and with it the interpolation that
    // used to spread un-dated chapters across a date range.
    const fresh = loadExtension("site.truthnovel.js");
    let feedHits = 0;
    const ctx = mockCtx({
      "/wp-json/wp/v2/posts?per_page=100": () => ok(JSON.stringify([
        { id: 1, link: "https://truthnovel.top/1-genius/", title: { rendered: "1 -عبقري" }, date_gmt: "2024-02-25T10:00:00" },
        { id: 2, link: "https://truthnovel.top/2444-x/", title: { rendered: "2444 -التفاوض مع طاغوت" }, date_gmt: "2026-09-16T13:02:07" },
        { id: 3, link: "https://truthnovel.top/2445-x/", title: { rendered: "2445 -عرض للطاغوت" }, date_gmt: "2026-09-16T19:15:57" }
      ])),
      "/feed/": () => { feedHits += 1; return ok("<rss></rss>"); },
      "https://truthnovel.top/": ok("<html>homepage</html>")
    });
    const chapters = await fresh.parseChapterList("https://truthnovel.top/?w4pl=257", ctx);
    const c44 = chapters.find((c) => c.number === 2444);
    const c45 = chapters.find((c) => c.number === 2445);
    const c1 = chapters.find((c) => c.number === 1);
    expect(c44.uploadedAt).toBe(Date.parse("2026-09-16T13:02:07Z"));
    expect(c45.uploadedAt).toBe(Date.parse("2026-09-16T19:15:57Z"));
    expect(c45.uploadedAt).toBeGreaterThan(c44.uploadedAt);
    // The invariant that used to need clamping: an old chapter must never be
    // stamped as recent. It now has a real 2024 date.
    expect(c1.uploadedAt).toBe(Date.parse("2024-02-25T10:00:00Z"));
    expect(c1.uploadedAt).toBeLessThan(c44.uploadedAt);
    expect(feedHits).toBe(0);
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
