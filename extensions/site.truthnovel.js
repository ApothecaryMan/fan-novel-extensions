// @id       site:truthnovel
// @name     سيد الحقيقة (رواية خاصة)
// @version  1.0.0
// @lang     ar
// @apiVersion 1
// @baseUrl  https://truthnovel.top
// ===================================================================
// site:truthnovel — Dedicated extension for the single-novel site (truthnovel.top).
// Houses all 2,400+ chapters of the novel "سيد الحقيقة" (Lord of the Truth).
// ===================================================================

var _htmlCache = Object.create(null);
var _HTML_CACHE_TTL_MS = 5 * 60 * 1000;

function _fetchCachedPage(url, ctx) {
  var now = Date.now();
  var hit = _htmlCache[url];
  if (hit && (now - hit.ts) < _HTML_CACHE_TTL_MS) {
    return Promise.resolve({ ok: true, status: 200, text: hit.text });
  }
  return ctx.xFetch(url).then(function (res) {
    if (res && res.ok) {
      _htmlCache[url] = { text: res.text, ts: now };
    }
    return res;
  });
}

registerExtension({
  id: 'site:truthnovel',
  name: 'سيد الحقيقة (رواية خاصة)',
  lang: 'ar',
  version: '1.0.0',
  apiVersion: 1,
  baseUrl: 'https://truthnovel.top',

  _absUrl: function (url) {
    if (!url) return '';
    if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) return url;
    var base = this.baseUrl.replace(/\/$/, '');
    return base + (url.charAt(0) === '/' ? '' : '/') + url;
  },

  _stripTags: function (html) {
    if (!html) return '';
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  },

  _decodeEntities: function (str) {
    if (!str) return '';
    var named = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
      hellip: '…', ndash: '–', mdash: '—', lsquo: '\u2018', rsquo: '\u2019'
    };
    return str.replace(/&([a-zA-Z][a-zA-Z0-9]*|#[xX]?[0-9a-fA-F]+);/g, function (m, name) {
      var low = name.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(named, low)) {
        return named[low];
      }
      return m;
    });
  },

  _toLatinDigits: function (str) {
    if (!str) return '';
    return String(str)
      .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x660); })
      .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x6F0); });
  },

  // ---------------------------------------------------------------
  // Metadata for the single novel
  // ---------------------------------------------------------------
  parseNovelInfo: async function (url, ctx) {
    var novelUrl = this._absUrl('/?w4pl=257');
    return {
      source: this.id,
      url: novelUrl,
      title: 'سيد الحقيقة',
      author: 'Zeus',
      coverUrl: undefined,
      summary: 'رواية سيد الحقيقة - موقع صمم خصيصاً لأجل الرواية. ملحمة خيالية ملحمية تتابع رحلة اللورد روبين والمجرات والقطاعات المتعددة في صراع القوى والهيمنة.',
      status: 'مستمرة',
      category: 'فانتازيا',
      tags: ['فانتازيا', 'خيال علمي', 'مغامرة', 'أكشن']
    };
  },

  // ---------------------------------------------------------------
  // Chapter list — all 2,400+ chapters are on the list index page
  // ---------------------------------------------------------------
  parseChapterList: async function (novelUrl, ctx) {
    var listUrl = this._absUrl('/?w4pl=257');
    var res = await _fetchCachedPage(listUrl, ctx);
    if (!res.ok) throw new Error('فشل جلب قائمة فصول سيد الحقيقة: ' + res.status);
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
      var cleanTitle = rawTitle.replace(/^\d+\s*[-–:]\s*/, '').trim();

      chapters.push({
        url: chUrl,
        number: chNum,
        title: 'الفصل ' + (chNum || chapters.length + 1) + (cleanTitle ? ' - ' + cleanTitle : '')
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
    if (!res.ok) throw new Error('فشل جلب نص الفصل: ' + res.status);
    var html = res.text;

    var contentMatch = html.match(/<div[^>]*class="[^"]*(?:bs-blog-post|entry-content)[^"]*"[^>]*>([\s\S]*?)(?=<footer|<div[^>]*class="[^"]*comments|$)/i);
    var block = contentMatch ? contentMatch[1] : html;

    // Remove scripts and styles
    block = block
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '');

    var paragraphs = [];
    var pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    var pm;
    while ((pm = pRegex.exec(block)) !== null) {
      var text = this._decodeEntities(this._stripTags(pm[1])).trim();
      if (!text) continue;

      // Skip common navigation / disclaimers
      if (/^(الموضوع التالي|الموضوع السابق|الرئيسية|قائمة الفصول)/.test(text)) continue;
      text = text.replace(/https?:\/\/\S+/g, ' ').replace(/[ \t\u00A0]{2,}/g, ' ');
      text = text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '').trim();

      if (text) paragraphs.push(text);
    }

    if (paragraphs.length === 0) {
      return this._decodeEntities(this._stripTags(block)).replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '').trim();
    }

    return paragraphs.join('\n\n');
  },

  // ---------------------------------------------------------------
  // Search & Browse — returns the single novel
  // ---------------------------------------------------------------
  searchNovels: async function (query, page, ctx) {
    // Only return the novel on page 1
    if (page && page > 1) return [];
    var novelUrl = this._absUrl('/?w4pl=257');
    var q = (query || '').trim().toLowerCase();

    // If query exists and doesn't match, still return or filter
    if (q && q.indexOf('حقيق') === -1 && q.indexOf('سيد') === -1 && q.indexOf('truth') === -1) {
      // If user searched for something completely different, return it anyway or empty
      return [{
        source: this.id,
        url: novelUrl,
        title: 'سيد الحقيقة',
        author: 'Zeus',
        category: 'فانتازيا',
        status: 'مستمرة'
      }];
    }

    return [{
      source: this.id,
      url: novelUrl,
      title: 'سيد الحقيقة',
      author: 'Zeus',
      category: 'فانتازيا',
      status: 'مستمرة'
    }];
  },

  getPopularNovels: async function (page, ctx) {
    return this.searchNovels('', page, ctx);
  },

  getCategories: async function () {
    return [{ name: 'فانتازيا', slug: 'fantasy' }];
  },

  getCategoryNovels: async function (categorySlug, page, ctx) {
    return this.searchNovels('', page, ctx);
  }
});
