/**
 * Extension: Lord of the Truth (سيد الحقيقة)
 * Custom site scraper for https://truthnovel.top/
 * Dedicated to the single novel "سيد الحقيقة" by author Zeus.
 */

var _htmlCache = {};
var _CACHE_TTL_MS = 10 * 60 * 1000;

function _fetchCachedPage(url, ctx) {
  var now = Date.now();
  var hit = _htmlCache[url];
  if (hit && now - hit.ts < _CACHE_TTL_MS) {
    return Promise.resolve({ ok: true, status: 200, text: hit.text });
  }
  return ctx.xFetch(url).then(function (res) {
    if (res.ok && typeof res.text === "string") {
      _htmlCache[url] = { text: res.text, ts: now };
    }
    return res;
  });
}

registerExtension({
  id: "site:truthnovel",
  name: "رواية سيد الحقيقة",
  lang: "ar",
  version: "1.1.8",
  apiVersion: 2,
  baseUrl: "https://truthnovel.top",

  _absUrl: function (url) {
    if (!url) return "";
    if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) return url;
    var base = this.baseUrl.replace(/\/$/, "");
    return base + (url.charAt(0) === "/" ? "" : "/") + url;
  },

  _stripTags: function (html) {
    if (!html) return "";
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  },

  _decodeEntities: function (str) {
    if (!str) return '';
    var named = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
      hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
      ldquo: '“', rdquo: '”', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', rlm: ''
    };
    var res = String(str).replace(/&amp;/gi, '&');
    res = res.replace(/&([a-zA-Z][a-zA-Z0-9]*|#[xX]?[0-9a-fA-F]+);/g, function (m, name) {
      var low = name.toLowerCase();
      var cp = null;
      if (low.charAt(0) === '#') {
        var hex = low.charAt(1) === 'x';
        cp = parseInt(low.substring(hex ? 2 : 1), hex ? 16 : 10);
      } else if (Object.prototype.hasOwnProperty.call(named, low)) {
        cp = named[low].charCodeAt(0);
      } else {
        return m;
      }
      if (!cp || cp < 0 || cp > 0x10FFFF) return m;
      if (cp > 0xFFFF) {
        cp -= 0x10000;
        return String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      }
      return String.fromCharCode(cp);
    });

    res = res.replace(/;(\d{2,6})#/g, function (m, digits) {
      var cp = parseInt(digits, 10);
      if (!cp || cp < 0 || cp > 0x10FFFF) return m;
      if (cp > 0xFFFF) {
        cp -= 0x10000;
        return String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      }
      return String.fromCharCode(cp);
    });

    return res
      .replace(/;8230#/g, '…')
      .replace(/&#8230;/g, '…')
      .replace(/;8220#/g, '“')
      .replace(/;8221#/g, '”')
      .replace(/;8211#/g, '–')
      .replace(/;8212#/g, '—')
      .replace(/&hellip;/gi, '…');
  },

  _toLatinDigits: function (str) {
    if (!str) return "";
    return String(str)
      .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x660); })
      .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x6F0); });
  },

  _parseDate: function (raw) {
    if (!raw) return undefined;
    var str = this._toLatinDigits(String(raw).trim());
    if (!str) return undefined;

    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      var t = Date.parse(str);
      if (!isNaN(t)) return t;
    }

    var arabicMonths = {
      "يناير": 0, "كانون الثاني": 0, "فبراير": 1, "شباط": 1, "مارس": 2, "آذار": 2,
      "أبريل": 3, "ابريل": 3, "نيسان": 3, "مايو": 4, "أيار": 4, "يونيو": 5, "حزيران": 5,
      "يوليو": 6, "تموز": 6, "أغسطس": 7, "اغسطس": 7, "آب": 7, "سبتمبر": 8, "أيلول": 8,
      "أكتوبر": 9, "اكتوبر": 9, "تشرين الأول": 9, "نوفمبر": 10, "تشرين الثاني": 10,
      "ديسمبر": 11, "كانون الأول": 11
    };
    for (var mName in arabicMonths) {
      if (str.indexOf(mName) !== -1) {
        var monthIdx = arabicMonths[mName];
        var nums = str.match(/\d+/g);
        if (nums && nums.length >= 2) {
          var day = parseInt(nums[0], 10);
          var year = parseInt(nums[1], 10);
          if (day > 1000) { var tmp = day; day = year; year = tmp; }
          if (year < 100) year += 2000;
          var dateObj = new Date(Date.UTC(year, monthIdx, day, 12, 0, 0));
          if (!isNaN(dateObj.getTime())) return dateObj.getTime();
        }
      }
    }
    return undefined;
  },

  _coverUrl: "https://truthnovel.top/wp-content/uploads/2024/12/%D9%86%D8%B3%D8%AE%D8%A9-%D8%A7%D9%84%D9%81%D8%B5%D9%84-%D8%A7%D9%84%D9%81-%D8%A7%D9%84%D8%B5%D8%BA%D9%8A%D8%B1%D8%A9-%D9%84%D9%84%D9%85%D9%88%D9%82%D8%B9-%D8%A7%D9%84%D8%B9%D8%B1%D8%A8%D9%8A.jpg",

  // ---------------------------------------------------------------
  // Metadata for the single novel
  // ---------------------------------------------------------------
  parseNovelInfo: async function (url, ctx) {
    var novelUrl = this._absUrl("/?w4pl=257");
    return {
      source: this.id,
      url: novelUrl,
      title: "سيد الحقيقة",
      author: "Zeus",
      coverUrl: this._coverUrl,
      summary: "رواية سيد الحقيقة - موقع صمم خصيصاً لأجل الرواية. ملحمة خيالية ملحمية تتابع رحلة اللورد روبين والمجرات والقطاعات المتعددة في صراع القوى والهيمنة.",
      status: "مستمرة",
      category: "فانتازيا",
      tags: ["فانتازيا", "خيال علمي", "مغامرة", "أكشن"]
    };
  },

  // ---------------------------------------------------------------
  // Chapter list — all 2,400+ chapters are on the list index page
  // ---------------------------------------------------------------
  parseChapterList: async function (novelUrl, ctx) {
    var listUrl = this._absUrl("/?w4pl=257");
    var res = await _fetchCachedPage(listUrl, ctx);
    if (!res.ok) throw new Error("فشل جلب قائمة فصول سيد الحقيقة: " + res.status);
    var html = res.text;

    var chapters = [];
    var seen = {};

    // Match links: <a class="...w4pl_post_title..." href="...">2422 -حب اللعبة لذاتها</a>
    var aRegex = /<a[^>]*class="[^"]*w4pl_post_title[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    var match;
    while ((match = aRegex.exec(html)) !== null) {
      var chUrl = this._absUrl(match[1].trim());
      if (seen[chUrl]) continue;
      seen[chUrl] = true;

      var rawTitle = this._decodeEntities(this._stripTags(match[2])).trim();
      var cleanDigits = this._toLatinDigits(rawTitle);

      var numMatch = cleanDigits.match(/^(\d+)/);
      var chNum = numMatch ? parseInt(numMatch[1], 10) : 0;
      var cleanTitle = rawTitle.replace(/^\d+\s*[-–:]\s*/, "").trim();

      chapters.push({
        url: chUrl,
        number: chNum,
        title: "الفصل " + (chNum || chapters.length + 1) + (cleanTitle ? " - " + cleanTitle : "")
      });
    }

    // Fallback: search any links matching number pattern
    if (chapters.length === 0) {
      var fallbackRegex = /<a[^>]+href="([^"]*truthnovel\.top\/\d+-[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = fallbackRegex.exec(html)) !== null) {
        var fbUrl = this._absUrl(match[1].trim());
        if (seen[fbUrl]) continue;
        seen[fbUrl] = true;
        var fbTitle = this._decodeEntities(this._stripTags(match[2])).trim();
        var fbNumMatch = this._toLatinDigits(fbTitle).match(/^(\d+)/);
        var fbNum = fbNumMatch ? parseInt(fbNumMatch[1], 10) : 0;
        chapters.push({
          url: fbUrl,
          number: fbNum,
          title: fbTitle
        });
      }
    }

    // Sort ascending (Chapter 1 to Chapter 2400+)
    chapters.sort(function (a, b) {
      return (a.number || 0) - (b.number || 0);
    });

    // Populate uploadedAt
    var homeDateMap = {};
    try {
      var homeRes = await _fetchCachedPage(this._absUrl("/"), ctx);
      if (homeRes && homeRes.ok && homeRes.text) {
        var itemRegex = /<h4[^>]*class="title"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<span[^>]*class="bs-blog-date"[^>]*>[\s\S]*?<time[^>]*>([\s\S]*?)<\/time>/gi;
        var im;
        while ((im = itemRegex.exec(homeRes.text)) !== null) {
          var itemUrl = this._absUrl(im[1].trim());
          var dateStr = this._stripTags(im[3]).trim();
          var ts = this._parseDate(dateStr);
          if (ts) {
            homeDateMap[itemUrl] = ts;
          }
        }
      }
    } catch (e) {
      // Non-fatal if homepage fails
    }

    var startTs = 1708473600000; // 21 Feb 2024 (website launch)
    var latestTs = 0;
    for (var k in homeDateMap) {
      if (homeDateMap[k] > latestTs) latestTs = homeDateMap[k];
    }
    if (!latestTs) latestTs = Date.now();

    var maxChapterNum = chapters.length > 0 ? (chapters[chapters.length - 1].number || chapters.length) : 1;

    for (var i = 0; i < chapters.length; i++) {
      var ch = chapters[i];
      if (homeDateMap[ch.url]) {
        ch.uploadedAt = homeDateMap[ch.url];
      } else if (maxChapterNum > 1 && ch.number) {
        var ratio = Math.max(0, Math.min(1, (ch.number - 1) / (maxChapterNum - 1)));
        ch.uploadedAt = Math.round(startTs + ratio * (latestTs - startTs));
      } else {
        ch.uploadedAt = latestTs;
      }
    }

    return chapters;
  },

  fetchLatestChapters: async function (novelUrl, knownCount, ctx) {
    var all = await this.parseChapterList(novelUrl, ctx);
    var latest = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].number > knownCount) {
        latest.push(all[i]);
      }
    }
    return latest;
  },

  // ---------------------------------------------------------------
  // Chapter content
  // ---------------------------------------------------------------
  parseChapterContent: async function (chapterUrl, ctx) {
    var fullUrl = this._absUrl(chapterUrl);
    var res = await ctx.xFetch(fullUrl);
    if (!res.ok) throw new Error("فشل جلب نص الفصل: " + res.status);
    var html = res.text;

    var contentMatch = html.match(/<div[^>]*class="[^"]*(?:bs-blog-post|entry-content)[^"]*"[^>]*>([\s\S]*?)(?=<footer|<div[^>]*class="[^"]*comments|$)/i);
    var block = contentMatch ? contentMatch[1] : html;

    // Remove scripts and styles
    block = block
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, "");

    var paragraphs = [];
    var pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    var pm;
    while ((pm = pRegex.exec(block)) !== null) {
      var text = this._decodeEntities(this._stripTags(pm[1])).trim();
      if (!text) continue;

      // Skip common navigation / disclaimers
      if (/^(الموضوع التالي|الموضوع السابق|الرئيسية|قائمة الفصول)/.test(text)) continue;
      text = text.replace(/https?:\/\/\S+/g, " ").replace(/[ \t\u00A0]{2,}/g, " ");
      text = text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "").trim();

      if (text) paragraphs.push(text);
    }

    if (paragraphs.length === 0) {
      return this._decodeEntities(this._stripTags(block)).replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "").trim();
    }

    return paragraphs.join("\n\n");
  },

  // ---------------------------------------------------------------
  // Search & Browse — returns the single novel
  // ---------------------------------------------------------------
  searchNovels: async function (query, page, ctx) {
    if (page && page > 1) return [];
    var novelUrl = this._absUrl("/?w4pl=257");
    var q = (query || "").trim().toLowerCase();

    if (q && q.indexOf("حقيق") === -1 && q.indexOf("سيد") === -1 && q.indexOf("truth") === -1) {
      return [{
        source: this.id,
        url: novelUrl,
        title: "سيد الحقيقة",
        author: "Zeus",
        coverUrl: this._coverUrl,
        category: "فانتازيا",
        status: "مستمرة"
      }];
    }

    return [{
      source: this.id,
      url: novelUrl,
      title: "سيد الحقيقة",
      author: "Zeus",
      coverUrl: this._coverUrl,
      category: "فانتازيا",
      status: "مستمرة"
    }];
  },

  getPopularNovels: async function (page, ctx) {
    return this.searchNovels("", page, ctx);
  },

  // ---------------------------------------------------------------
  // Site comments — read via WordPress RSS feed per chapter.
  // Flat list; host builds the reply tree from parentId.
  // ---------------------------------------------------------------
  getComments: async function (chapterUrl, ctx) {
    var fullUrl = this._absUrl(chapterUrl);
    var count = 0;
    var pageHtml = "";
    try {
      var pageRes = await ctx.xFetch(fullUrl);
      if (pageRes && pageRes.ok && pageRes.text) {
        pageHtml = pageRes.text;
        var cc = pageHtml.match(/"commentCount"\s*:\s*(\d+)/);
        if (cc) count = parseInt(cc[1], 10);
      }
    } catch (e) { /* non-fatal */ }

    var feedUrl = fullUrl.replace(/\/?$/, "/") + "feed/";
    var feedRes = await ctx.xFetch(feedUrl);
    if (!feedRes.ok) throw new Error("فشل جلب تعليقات الفصل: " + feedRes.status);
    var xml = feedRes.text || "";
    var comments = [];
    var itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    var im;
    while ((im = itemRegex.exec(xml)) !== null) {
      var item = im[1];
      var linkM = item.match(/<link>([\s\S]*?)<\/link>/i);
      var link = linkM ? linkM[1].trim() : "";
      var idM = link.match(/#comment-(\d+)/);
      if (!idM) {
        var guidM = item.match(/#comment-(\d+)/);
        if (!guidM) continue;
        idM = guidM;
      }
      var id = idM[1];
      var authorM = item.match(/<dc:creator><!\[CDATA\[([\s\S]*?)\]\]><\/dc:creator>/i)
        || item.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/i);
      var author = authorM ? this._stripTags(authorM[1]).trim() || "—" : "—";
      var dateM = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
      var createdAt = dateM ? Date.parse(dateM[1].trim()) : NaN;
      if (isNaN(createdAt)) createdAt = Date.now();
      var bodyM = item.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/i)
        || item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i);
      var rawBody = bodyM ? bodyM[1] : "";
      // Reply parent: "ردًا على <a href="...#comment-XXXX">" — ignore self-link
      var parentId = null;
      var pm = rawBody.match(/#comment-(\d+)/);
      if (pm && pm[1] !== id) parentId = pm[1];
      // Attachment images (wpDiscuz uploads). Skip WP smiley/emoji so they
      // don't render as full-width attachments (they stay as text).
      var images = [];
      try {
        var imgRegex = /<img[^>]*>/gi;
        var imgM;
        while ((imgM = imgRegex.exec(rawBody)) !== null && images.length < 4) {
          var tag = imgM[0];
          if (/wp-smiley/i.test(tag) || /s\.w\.org\/images/i.test(tag)) continue;
          var srcM = tag.match(/src=["']([^"']+)["']/i);
          if (srcM && /^https?:\/\//i.test(srcM[1]) && images.indexOf(srcM[1]) === -1) {
            images.push(srcM[1]);
          }
        }
      } catch (e3) { /* non-fatal */ }
      // Drop the "ردًا على ..." reference paragraph — threading already
      // shows the reply nesting, so keeping it duplicates it on every reply.
      var cleanHtml = rawBody
        .replace(/<p[^>]*>\s*رد[^<]*<a[^>]*>[\s\S]*?<\/a>\s*\.?\s*<\/p>/gi, " ")
        .replace(/<a[^>]*>[\s\S]*?<\/a>/gi, " ")
        .replace(/<img[^>]*>/gi, " ");
      var body = this._decodeEntities(this._stripTags(cleanHtml)).trim();
      body = body.replace(/^رد[ً'’]?\s*ا?\s*على\s*\.?\s*/i, "").trim();
      if (!body && images.length === 0) continue;
      var comment = { id: id, parentId: parentId, author: author, body: body, createdAt: createdAt, likes: 0, url: link };
      if (images.length > 0) comment.images = images;
      comments.push(comment);
    }
    // Likes: wpDiscuz up-votes rendered in chapter HTML as
    // id="comment-XXXX" ... wpd-vote-result ... title='N'>N. Feed has no
    // votes, so patch counts from the page (missing → 0).
    // Images: wpDiscuz attachments (wmu-comment-attachments) are NOT in the
    // RSS feed — merge them from the page by data-comment-id.
    try {
      if (pageHtml) {
        var attachMap = {};
        var attRe = /data-comment-id='(\d+)'/g;
        var attM;
        while ((attM = attRe.exec(pageHtml)) !== null) {
          var aid = attM[1];
          var awin = pageHtml.substr(attM.index, 4000);
          var urls = awin.match(/https?:\/\/truthnovel\.top\/wp-content\/uploads\/[^'"()\s]+?\.(?:gif|jpe?g|png|webp|bmp)/gi);
          if (urls) {
            var uniq = [];
            for (var ui = 0; ui < urls.length && uniq.length < 4; ui++) {
              if (uniq.indexOf(urls[ui]) === -1) uniq.push(urls[ui]);
            }
            if (uniq.length > 0) attachMap[aid] = uniq;
          }
        }
        for (var vi = 0; vi < comments.length; vi++) {
          var cid = comments[vi].id;
          if (attachMap[cid]) {
            var merged = (comments[vi].images || []).concat(attachMap[cid]);
            var dedup = [];
            for (var mi = 0; mi < merged.length && dedup.length < 4; mi++) {
              if (dedup.indexOf(merged[mi]) === -1) dedup.push(merged[mi]);
            }
            comments[vi].images = dedup;
          }
          var idx = pageHtml.indexOf('id="comment-' + cid + '"');
          if (idx === -1) continue;
          var window_ = pageHtml.substr(idx, 6000);
          var vm = window_.match(/wpd-vote-result[^>]*title='(-?\d+)'/);
          if (vm) {
            var v = parseInt(vm[1], 10);
            if (!isNaN(v) && v >= 0) comments[vi].likes = v;
          }
        }
      }
    } catch (e2) { /* non-fatal: keep 0 */ }
    comments.sort(function (a, b) { return a.createdAt - b.createdAt; });
    if (!count) count = comments.length;
    return { count: count, comments: comments };
  },

  // ---------------------------------------------------------------
  // Guest post to wpDiscuz (host enforces app login; author = username).
  // Verified protocol (Sep 2026, wpDiscuz 7.6.62):
  // 1. GET chapter HTML -> "wc_post_id":"10897"
  // 2. POST admin-ajax.php action=wpdGetNonce -> data.wpdiscuz_nonce
  // 3. POST admin-ajax.php action=wpdAddComment with postId,
  //    wpdiscuz_unique_id (0_0 top-level, {parentId}_0 reply),
  //    wpd_comment_depth, wc_comment/wc_name/wc_email + nonce.
  // Replies return is_main:0 + level-2; first-time guests get
  // held_moderate:1 (invisible in feed until approved).
  // ---------------------------------------------------------------
  postComment: async function (chapterUrl, input, ctx) {
    var fullUrl = this._absUrl(chapterUrl);
    var pageRes = await ctx.xFetch(fullUrl);
    if (!pageRes.ok) throw new Error("فشل فتح صفحة الفصل: " + pageRes.status);
    var html = pageRes.text || "";
    var postIdM = html.match(/"wc_post_id"\s*:\s*"(\d+)"/) || html.match(/wc_post_id["']?\s*[:=]\s*["']?(\d+)/);
    if (!postIdM) throw new Error("تعذر تحديد معرف المقال");
    var postId = postIdM[1];
    var author = (input && input.author || "").trim().slice(0, 50);
    var email = (input && input.email || "").trim().slice(0, 100);
    var body = (input && input.body || "").trim();
    if (!author || !body) throw new Error("الاسم والنص مطلوبان");
    if (author.length < 3) throw new Error("الاسم قصير (3 أحرف على الأقل)");
    var parentRaw = input && input.parentId ? String(input.parentId).replace(/\D/g, "") : "";
    var ajaxUrl = this._absUrl("/wp-admin/admin-ajax.php");
    // 1) Fresh nonce (wpDiscuz does not embed it in the form HTML)
    var nonceRes = await ctx.xFetch(ajaxUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: "action=wpdGetNonce"
    });
    if (!nonceRes.ok) throw new Error("فشل تجهيز التعليق: " + nonceRes.status);
    var nonceData;
    try { nonceData = JSON.parse(nonceRes.text); } catch (e) { throw new Error("رد غير متوقع من الموقع"); }
    var nonce = nonceData && nonceData.data && nonceData.data.wpdiscuz_nonce;
    if (!nonce) throw new Error("تعذر تجهيز التعليق (nonce)");
    // 2) Threading: top-level 0_0/depth 1; reply {parent}_0/depth parent+1
    var uniqueId = "0_0";
    var depth = "1";
    if (parentRaw) {
      uniqueId = parentRaw + "_0";
      depth = "2";
      try {
        var lvlM = html.match(new RegExp("wpd-comm-" + parentRaw + "[^']*'[^>]*wpd_comment_level-(\\d)"));
        if (lvlM) {
          var pd = parseInt(lvlM[1], 10);
          if (!isNaN(pd) && pd >= 1 && pd < 5) depth = String(pd + 1);
        }
      } catch (e2) { /* keep depth 2 */ }
    }
    var params = "action=wpdAddComment&postId=" + encodeURIComponent(postId)
      + "&wpdiscuz_unique_id=" + encodeURIComponent(uniqueId)
      + "&wpdiscuz_nonce=" + encodeURIComponent(nonce)
      + "&wc_comment=" + encodeURIComponent(body)
      + "&wc_name=" + encodeURIComponent(author)
      + "&wc_email=" + encodeURIComponent(email)
      + "&wc_website=&wpd_comment_depth=" + encodeURIComponent(depth);
    var res = await ctx.xFetch(ajaxUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: params
    });
    if (!res.ok) throw new Error("فشل إرسال التعليق: " + res.status);
    var data;
    try { data = JSON.parse(res.text); } catch (e) { throw new Error("رد غير متوقع من الموقع"); }
    var payload = data && data.data ? data.data : data;
    if (data && data.success === false) {
      throw new Error((payload && (payload.message || payload)) || "رفض الموقع التعليق");
    }
    var newId = payload && (payload.new_comment_id || payload.comment_id || payload.commentId)
      ? String(payload.new_comment_id || payload.comment_id || payload.commentId)
      : undefined;
    var held = payload && (payload.held_moderate === 1 || payload.held_moderate === "1"
      || payload.held_for_moderation || payload.moderation) ? true : false;
    return { ok: true, id: newId, needsModeration: held };
  },

  // ---------------------------------------------------------------
  // Guest vote (verified Sep 2026: wpDiscuz accepts guest votes,
  // tracked by IP/cookie — no login needed). Sending the same voteType
  // again toggles it off (curUserReaction 0). Returns server counts.
  // ---------------------------------------------------------------
  voteComment: async function (chapterUrl, input, ctx) {
    var rawId = input && input.commentId ? String(input.commentId).replace(/\D/g, "") : "";
    if (!rawId) throw new Error("تعذر تحديد التعليق");
    var vote = input && input.vote === -1 ? "-1" : "1";
    var ajaxUrl = this._absUrl("/wp-admin/admin-ajax.php");
    var nonceRes = await ctx.xFetch(ajaxUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: "action=wpdGetNonce"
    });
    if (!nonceRes.ok) throw new Error("فشل تجهيز التصويت: " + nonceRes.status);
    var nonceData;
    try { nonceData = JSON.parse(nonceRes.text); } catch (e) { throw new Error("رد غير متوقع من الموقع"); }
    var nonce = nonceData && nonceData.data && nonceData.data.wpdiscuz_nonce;
    if (!nonce) throw new Error("تعذر تجهيز التصويت (nonce)");
    var params = "action=wpdVoteOnComment&commentId=" + encodeURIComponent(rawId)
      + "&voteType=" + encodeURIComponent(vote)
      + "&wpdiscuz_nonce=" + encodeURIComponent(nonce);
    var res = await ctx.xFetch(ajaxUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: params
    });
    if (!res.ok) throw new Error("فشل التصويت: " + res.status);
    var data;
    try { data = JSON.parse(res.text); } catch (e) { throw new Error("رد غير متوقع من الموقع"); }
    if (data && data.success === false) {
      var msg = data.data && (data.data.message || data.data);
      throw new Error(msg || "رفض الموقع التصويت");
    }
    var d = data && data.data ? data.data : {};
    var likes = parseInt(d.likeCount, 10);
    if (isNaN(likes) || likes < 0) likes = 0;
    return { ok: true, likes: likes, liked: d.curUserReaction === 1 || d.curUserReaction === "1" };
  },

  getCategories: async function () {
    return [{ name: "فانتازيا", slug: "fantasy" }];
  },

  getCategoryNovels: async function (categorySlug, page, ctx) {
    return this.searchNovels("", page, ctx);
  },

  // ---------------------------------------------------------------
  // Author comments across all chapters (WP REST API)
  // ---------------------------------------------------------------
  getAuthorComments: async function (authorName, page, ctx) {
    var name = (authorName || "").trim();
    if (!name) return { authorName: "", totalComments: 0, totalLikes: 0, comments: [], hasMore: false };
    var pageNum = typeof page === "number" && page >= 1 ? page : 1;
    var perPage = 30;
    var apiUrl = this._absUrl("/wp-json/wp/v2/comments?search=" + encodeURIComponent(name) + "&per_page=" + perPage + "&page=" + pageNum + "&_embed=up");
    var res = await ctx.xFetch(apiUrl);
    if (!res.ok) {
      if (res.status === 400 || res.status === 404) {
        return { authorName: name, totalComments: 0, totalLikes: 0, comments: [], hasMore: false };
      }
      throw new Error("فشل جلب تعليقات المعلق: " + res.status);
    }
    var totalHeader = (res.headers && (res.headers["x-wp-total"] || res.headers["X-WP-Total"])) || "0";
    var totalPagesHeader = (res.headers && (res.headers["x-wp-totalpages"] || res.headers["X-WP-TotalPages"])) || "1";
    var total = parseInt(totalHeader, 10);
    if (isNaN(total) || total < 0) total = 0;
    var totalPages = parseInt(totalPagesHeader, 10);
    if (isNaN(totalPages) || totalPages < 1) totalPages = 1;

    var rawList = [];
    try {
      rawList = JSON.parse(res.text) || [];
    } catch (e) {
      throw new Error("رد غير متوقع من الموقع");
    }
    if (!Array.isArray(rawList)) rawList = [];

    var normalizedTarget = name.toLowerCase();
    var filtered = rawList.filter(function (item) {
      var an = (item && item.author_name ? String(item.author_name) : "").trim().toLowerCase();
      return an === normalizedTarget;
    });

    var cleanText = function (html) {
      if (!html) return "";
      var stripped = html.replace(/<[^>]+>/g, " ");
      return stripped
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&#8230;/g, "…")
        .replace(/&#8217;/g, "'")
        .replace(/&#8216;/g, "'")
        .replace(/&#8220;/g, '"')
        .replace(/&#8221;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
    };

    var postMap = {};
    var missingPostIds = [];
    for (var i = 0; i < filtered.length; i++) {
      var item = filtered[i];
      var embeddedUp = item._embedded && item._embedded.up && item._embedded.up[0];
      if (embeddedUp && embeddedUp.title) {
        var t = typeof embeddedUp.title === "object" ? embeddedUp.title.rendered : embeddedUp.title;
        postMap[item.post] = {
          title: cleanText(t),
          link: embeddedUp.link || ""
        };
      } else if (item.post && !postMap[item.post] && missingPostIds.indexOf(item.post) === -1) {
        missingPostIds.push(item.post);
      }
    }

    for (var m = 0; m < Math.min(missingPostIds.length, 10); m++) {
      var pid = missingPostIds[m];
      try {
        var pRes = await ctx.xFetch(this._absUrl("/wp-json/wp/v2/posts/" + pid + "?_fields=id,title,link"));
        if (pRes.ok) {
          var pJson = JSON.parse(pRes.text);
          if (pJson) {
            var pt = pJson.title && (pJson.title.rendered || pJson.title);
            postMap[pid] = {
              title: cleanText(pt),
              link: pJson.link || ""
            };
          }
        }
      } catch (pe) { /* non-fatal fallback */ }
    }

    var comments = [];
    var totalLikes = 0;
    for (var j = 0; j < filtered.length; j++) {
      var c = filtered[j];
      var postInfo = postMap[c.post] || {};
      var dateMs = Date.parse(c.date_gmt ? c.date_gmt + "Z" : c.date) || Date.now();
      var body = cleanText(c.content && c.content.rendered ? c.content.rendered : "");
      
      var images = [];
      if (c.content && c.content.rendered) {
        var imgMatches = c.content.rendered.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/g);
        if (imgMatches) {
          for (var im = 0; im < imgMatches.length; im++) {
            var srcM = imgMatches[im].match(/src=["'](https?:\/\/[^"']+)["']/);
            if (srcM && srcM[1] && !/wpdiscuz|smiles|emoji/i.test(srcM[1])) {
              images.push(srcM[1]);
            }
          }
        }
      }

      var chapterUrl = (c.link ? c.link.split("#")[0] : "") || postInfo.link || "";

      comments.push({
        id: String(c.id),
        body: body,
        createdAt: dateMs,
        likes: 0,
        chapterTitle: postInfo.title || ("الفصل " + (c.post || "")),
        chapterUrl: chapterUrl,
        images: images.length > 0 ? images.slice(0, 4) : undefined
      });
    }

    // Fetch chapter pages to extract real wpDiscuz likes
    var uniqueChapterUrls = [];
    for (var k = 0; k < comments.length; k++) {
      var cu = comments[k].chapterUrl;
      if (cu && uniqueChapterUrls.indexOf(cu) === -1) {
        uniqueChapterUrls.push(cu);
      }
    }

    for (var u = 0; u < Math.min(uniqueChapterUrls.length, 10); u++) {
      var chUrl = uniqueChapterUrls[u];
      try {
        var pageRes = await _fetchCachedPage(this._absUrl(chUrl), ctx);
        if (pageRes && pageRes.ok && pageRes.text) {
          var pageHtml = pageRes.text;
          for (var ci = 0; ci < comments.length; ci++) {
            if (comments[ci].chapterUrl === chUrl) {
              var cid = comments[ci].id;
              var idx = pageHtml.indexOf('id="comment-' + cid + '"');
              if (idx !== -1) {
                var window_ = pageHtml.substr(idx, 6000);
                var vm = window_.match(/wpd-vote-result[^>]*title=['"](-?\d+)['"]/);
                if (vm) {
                  var v = parseInt(vm[1], 10);
                  if (!isNaN(v) && v >= 0) {
                    totalLikes += v - comments[ci].likes;
                    comments[ci].likes = v;
                  }
                }
              }
            }
          }
        }
      } catch (pe) { /* non-fatal: keep 0 */ }
    }

    return {
      authorName: name,
      totalComments: total > 0 ? total : comments.length,
      totalLikes: totalLikes,
      comments: comments,
      hasMore: pageNum < totalPages
    };
  }
});
