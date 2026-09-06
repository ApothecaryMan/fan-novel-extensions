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
  name: "سيد الحقيقة (رواية خاصة)",
  lang: "ar",
  version: "1.0.1",
  apiVersion: 1,
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
    if (!str) return "";
    var named = {
      amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
      hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’",
      ldquo: "“", rdquo: "”", copy: "©", reg: "®", trade: "™"
    };
    var res = str.replace(/&amp;/gi, "&");
    res = res.replace(/&([a-zA-Z][a-zA-Z0-9]*|#[xX]?[0-9a-fA-F]+);/g, function (m, name) {
      var low = name.toLowerCase();
      if (low.charAt(0) === "#") {
        var hex = low.charAt(1) === "x";
        var cp = parseInt(low.substring(hex ? 2 : 1), hex ? 16 : 10);
        if (!isNaN(cp) && cp >= 0 && cp <= 0x10FFFF) {
          if (cp > 0xFFFF) {
            cp -= 0x10000;
            return String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
          }
          return String.fromCharCode(cp);
        }
        return m;
      }
      if (Object.prototype.hasOwnProperty.call(named, low)) {
        return named[low];
      }
      return m;
    });

    return res
      .replace(/;8230#/g, "…")
      .replace(/&#8230;/g, "…")
      .replace(/;8220#/g, "“")
      .replace(/;8221#/g, "”")
      .replace(/;8211#/g, "–")
      .replace(/;8212#/g, "—")
      .replace(/&hellip;/gi, "…");
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

  getCategories: async function () {
    return [{ name: "فانتازيا", slug: "fantasy" }];
  },

  getCategoryNovels: async function (categorySlug, page, ctx) {
    return this.searchNovels("", page, ctx);
  }
});
