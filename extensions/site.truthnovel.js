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
  version: "1.1.1",
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
    try {
      var pageRes = await ctx.xFetch(fullUrl);
      if (pageRes && pageRes.ok && pageRes.text) {
        var cc = pageRes.text.match(/"commentCount"\s*:\s*(\d+)/);
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
      var body = this._decodeEntities(this._stripTags(rawBody.replace(/<a[^>]*>[\s\S]*?<\/a>/gi, " "))).trim();
      if (!body) continue;
      comments.push({ id: id, parentId: parentId, author: author, body: body, createdAt: createdAt, likes: 0, url: link });
    }
    comments.sort(function (a, b) { return a.createdAt - b.createdAt; });
    if (!count) count = comments.length;
    return { count: count, comments: comments };
  },

  // ---------------------------------------------------------------
  // Guest post to wpDiscuz (host enforces app login; author = username).
  // ---------------------------------------------------------------
  postComment: async function (chapterUrl, input, ctx) {
    var fullUrl = this._absUrl(chapterUrl);
    var pageRes = await ctx.xFetch(fullUrl);
    if (!pageRes.ok) throw new Error("فشل فتح صفحة الفصل: " + pageRes.status);
    var html = pageRes.text || "";
    var postIdM = html.match(/"wc_post_id"\s*:\s*"(\d+)"/) || html.match(/wc_post_id["']?\s*[:=]\s*["']?(\d+)/);
    if (!postIdM) throw new Error("تعذر تحديد معرف المقال");
    var postId = postIdM[1];
    var nonceM = html.match(/wpdiscuz_nonce["']?\s*[:=]\s*["']([a-zA-Z0-9]+)["']/);
    var author = (input && input.author || "").trim().slice(0, 50);
    var email = (input && input.email || "").trim().slice(0, 100);
    var body = (input && input.body || "").trim();
    if (!author || !body) throw new Error("الاسم والنص مطلوبان");
    var parentRaw = input && input.parentId ? String(input.parentId).replace(/\D/g, "") : "";
    var params = "action=wpdAddComment&post_id=" + encodeURIComponent(postId)
      + "&parent=" + encodeURIComponent(parentRaw || "0")
      + "&author=" + encodeURIComponent(author)
      + "&email=" + encodeURIComponent(email)
      + "&content=" + encodeURIComponent(body);
    if (nonceM) params += "&nonce=" + encodeURIComponent(nonceM[1]);
    var ajaxUrl = this._absUrl("/wp-admin/admin-ajax.php");
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
      throw new Error((payload && payload.message) || "رفض الموقع التعليق");
    }
    var newId = payload && (payload.comment_id || payload.commentId) ? String(payload.comment_id || payload.commentId) : undefined;
    var held = payload && (payload.held_for_moderation || payload.moderation) ? true : false;
    return { ok: true, id: newId, needsModeration: held };
  },

  getCategories: async function () {
    return [{ name: "فانتازيا", slug: "fantasy" }];
  },

  getCategoryNovels: async function (categorySlug, page, ctx) {
    return this.searchNovels("", page, ctx);
  }
});
