// @id       site:rean
// @name     شبكة ريان
// @version  1.0.0
// @lang     ar
// @apiVersion 1
// @baseUrl  https://rean.org
// ===================================================================
// site:rean — remote-JS extension for شبكة ريان (rean.org).
// Clean sandboxed scraper adhering to the Extension Runtime Specification (ctx.xFetch).
// Features:
//   - Fast streaming RegExp parsing without DOM overhead.
//   - Dual chapter support (immediate inline parsing + AJAX manga_get_chapters).
//   - LRU request caching with in-flight deduplication.
//   - Native Arabic dates and digits normalization.
//   - Incremental chapter refresh (fetchLatestChapters).
// ===================================================================

var _htmlCache = Object.create(null);
var _HTML_CACHE_TTL_MS = 5 * 60 * 1000;
var _HTML_CACHE_CAP = 12;
var _inFlight = Object.create(null);

function _fetchCachedPage(url, ctx) {
  var now = Date.now();
  var hit = _htmlCache[url];
  if (hit && (now - hit.ts) < _HTML_CACHE_TTL_MS) {
    return Promise.resolve({ ok: true, status: 200, text: hit.text });
  }
  if (_inFlight[url]) {
    return _inFlight[url];
  }
  var p = ctx.xFetch(url).then(function (res) {
    delete _inFlight[url];
    if (res && res.ok) {
      _htmlCache[url] = { text: res.text, ts: now };
      var keys = Object.keys(_htmlCache);
      if (keys.length > _HTML_CACHE_CAP) {
        var oldest = keys[0];
        for (var i = 1; i < keys.length; i++) {
          if (_htmlCache[keys[i]].ts < _htmlCache[oldest].ts) oldest = keys[i];
        }
        delete _htmlCache[oldest];
      }
    }
    return res;
  }).catch(function (err) {
    delete _inFlight[url];
    throw err;
  });
  _inFlight[url] = p;
  return p;
}

registerExtension({
  id: 'site:rean',
  name: 'شبكة ريان',
  lang: 'ar',
  version: '1.0.0',
  apiVersion: 1,
  baseUrl: 'https://rean.org',

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
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
      hellip: '…', ndash: '–', mdash: '—', lsquo: '\u2018', rsquo: '\u2019',
      ldquo: '\u201C', rdquo: '\u201D', middot: '·', bull: '•'
    };
    return str.replace(/&([a-zA-Z][a-zA-Z0-9]*|#[xX]?[0-9a-fA-F]+);/g, function (m, name) {
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
  },

  _toLatinDigits: function (str) {
    if (!str) return '';
    return String(str)
      .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x660); })
      .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x6F0); })
      .replace(/[\u066C\u066D]/g, '');
  },

  _relativeUnitMs: function (str) {
    if (str.indexOf('دقيق') !== -1 || str.indexOf('دقائق') !== -1) return 60 * 1000;
    if (str.indexOf('ساع') !== -1) return 3600 * 1000;
    if (str.indexOf('يوم') !== -1 || str.indexOf('يام') !== -1) return 24 * 3600 * 1000;
    if (str.indexOf('سبوع') !== -1 || str.indexOf('سبيع') !== -1) return 7 * 24 * 3600 * 1000;
    if (str.indexOf('شهر') !== -1 || str.indexOf('شهور') !== -1) return 30 * 24 * 3600 * 1000;
    if (str.indexOf('سن') !== -1 || str.indexOf('عام') !== -1) return 365 * 24 * 3600 * 1000;
    return undefined;
  },

  _relativeAmount: function (str) {
    if (!str) return 1;
    var core = String(str).replace(/منذ/gi, ' ').trim();
    var dm = core.match(/(\d+)/);
    if (dm) return parseInt(dm[1], 10);
    if (/دقيقتين|ساعتين|يومين|أسبوعين|اسبوعين|شهرين|سنتين|عامين/.test(core)) return 2;
    var words = {
      'واحد': 1, 'واحدة': 1, 'اثنان': 2, 'اثنين': 2, 'اثنتين': 2,
      'ثلاثة': 3, 'ثلاث': 3, 'أربعة': 4, 'أربع': 4, 'خمسة': 5, 'خمس': 5,
      'ستة': 6, 'ست': 6, 'سبعة': 7, 'سبع': 7, 'ثمانية': 8, 'ثماني': 8,
      'تسعة': 9, 'تسع': 9, 'عشرة': 10, 'عشر': 10
    };
    for (var w in words) {
      if (Object.prototype.hasOwnProperty.call(words, w) && core.indexOf(w) !== -1) return words[w];
    }
    return 1;
  },

  _parseDate: function (raw) {
    if (!raw) return undefined;
    var str = this._toLatinDigits(String(raw).trim());
    if (!str) return undefined;

    var now = Date.now();
    if (str.indexOf('منذ') !== -1 || str.indexOf('ago') !== -1) {
      var relMs = this._relativeUnitMs(str);
      if (relMs !== undefined) {
        return now - relMs * this._relativeAmount(str);
      }
    }

    var arabicMonths = {
      'يناير': 0, 'كانون الثاني': 0, 'فبراير': 1, 'شباط': 1, 'مارس': 2, 'آذار': 2,
      'أبريل': 3, 'ابريل': 3, 'نيسان': 3, 'مايو': 4, 'أيار': 4, 'يونيو': 5, 'حزيران': 5,
      'يوليو': 6, 'تموز': 6, 'أغسطس': 7, 'اغسطس': 7, 'آب': 7, 'سبتمبر': 8, 'أيلول': 8,
      'أكتوبر': 9, 'اكتوبر': 9, 'تشرين الأول': 9, 'نوفمبر': 10, 'تشرين الثاني': 10,
      'ديسمبر': 11, 'كانون الأول': 11
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
          var dateObj = new Date(year, monthIdx, day, 12, 0, 0);
          if (!isNaN(dateObj.getTime())) return dateObj.getTime();
        }
      }
    }

    var parsed = Date.parse(str);
    return isNaN(parsed) ? undefined : parsed;
  },

  _stripChapterPrefix: function (name) {
    var m = (name || '').trim();
    m = m.replace(/^(?:chapter|ch\.?|فصل|الفصل)\s*(\d+(?:\.\d+)?)\s*(?:[-–—:.#|]\s*)?/i, '');
    if (m !== (name || '').trim()) return m.trim();
    m = m.replace(/^(?:فصل|الفصل)\s*(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)\s*(?:[:|.\-–—]?\s*)/i, '');
    m = m.replace(/^(?:فصل|الفصل)\s*[:|.\-–—]\s*/i, '');
    return m.trim();
  },

  _finalizeChapters: function (list) {
    var sorted = list.slice().sort(function (a, b) { return (a.number || 0) - (b.number || 0); });
    var seen = {};
    var out = [];
    sorted.forEach(function (ch, i) {
      if (seen[ch.url]) return;
      seen[ch.url] = true;
      var num = ch.number || i + 1;
      var cleanName = this._stripChapterPrefix(ch.title);
      ch.number = num;
      ch.title = 'الفصل ' + num + (cleanName ? ' - ' + cleanName : '');
      out.push(ch);
    }, this);
    return out;
  },

  // ---------------------------------------------------------------
  // Parse Novel Info
  // ---------------------------------------------------------------
  parseNovelInfo: async function (url, ctx) {
    var fullUrl = this._absUrl(url);
    var res = await _fetchCachedPage(fullUrl, ctx);
    if (!res.ok) throw new Error('فشل جلب صفحة الرواية: ' + res.status);
    var html = res.text;

    // Title
    var titleMatch = html.match(/<div[^>]*class="[^"]*post-title[^"]*"[^>]*>[\s\S]*?<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i) ||
                     html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
                     html.match(/<title>([^–\-&#<]+)/i);
    var rawTitle = titleMatch ? this._stripTags(titleMatch[1]) : 'رواية';
    var title = this._decodeEntities(rawTitle).trim();

    // Cover
    var coverMatch = html.match(/<div[^>]*class="[^"]*summary_image[^"]*"[^>]*>[\s\S]*?<img[^>]+(?:data-src|src)="([^">]+)"/i) ||
                     html.match(/<div[^>]*class="[^"]*nhv-novel-cover[^"]*"[^>]*>[\s\S]*?<img[^>]+(?:data-src|src)="([^">]+)"/i) ||
                     html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    var coverUrl = coverMatch ? this._absUrl(coverMatch[1].trim()) : undefined;

    // Author
    var authorMatch = html.match(/<div[^>]*class="[^"]*author-content[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i) ||
                      html.match(/(?:الكاتب|Author)[\s\S]*?<div[^>]*class="[^"]*summary-content[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
    var author = authorMatch ? this._decodeEntities(authorMatch[1].trim()) : undefined;

    // Status
    var status = 'مستمرة';
    var statusMatch = html.match(/(?:الحالة|Status)[\s\S]*?<div[^>]*class="[^"]*summary-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                      html.match(/<div[^>]*class="[^"]*post-status[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (statusMatch) {
      var sText = this._stripTags(statusMatch[1]).toLowerCase();
      if (sText.indexOf('مكتمل') !== -1 || sText.indexOf('complete') !== -1) {
        status = 'مكتملة';
      }
    }

    // Summary
    var summary = undefined;
    var summaryMatch = html.match(/<div[^>]*class="[^"]*(?:description-summary|summary__content|manga-excerpt)[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                       html.match(/<div[^>]*class="[^"]*c-page__content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (summaryMatch) {
      var sBlock = summaryMatch[1]
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
      summary = this._decodeEntities(this._stripTags(sBlock));
    }

    // Genres
    var genres = [];
    var genresMatch = html.match(/<div[^>]*class="[^"]*genres-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (genresMatch) {
      var aRegex = /<a[^>]*>([^<]+)<\/a>/gi;
      var gm;
      while ((gm = aRegex.exec(genresMatch[1])) !== null) {
        var gName = this._decodeEntities(gm[1].trim());
        if (gName) genres.push(gName);
      }
    }

    return {
      source: this.id,
      url: fullUrl,
      title: title,
      author: author,
      coverUrl: coverUrl,
      summary: summary,
      status: status,
      category: genres.length > 0 ? genres[0] : 'روايات مترجمة',
      tags: genres
    };
  },

  // ---------------------------------------------------------------
  // Chapter list (Inline or via admin-ajax)
  // ---------------------------------------------------------------
  _parseChapterRows: function (html) {
    var chapters = [];
    var liRegex = /<li[^>]*class="[^"]*wp-manga-chapter[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    var match;
    while ((match = liRegex.exec(html)) !== null) {
      var block = match[1];
      var linkMatch = block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;

      var chUrl = this._absUrl(linkMatch[1].trim());
      var rawTitle = this._stripTags(linkMatch[2]);
      var cleanTitle = this._decodeEntities(rawTitle).trim();

      // Chapter number
      var cleanDigits = this._toLatinDigits(cleanTitle);
      var chNum = 0;
      var afterFasl = cleanDigits.match(/(?:الفصل|فصل|chapter)\s*(?:الـ)?\s*(\d+(?:\.\d+)?)/i);
      if (afterFasl) {
        chNum = parseFloat(afterFasl[1]);
      } else {
        var anyNum = cleanDigits.match(/\d+(?:\.\d+)?/);
        if (anyNum) chNum = parseFloat(anyNum[0]);
      }

      // Date
      var dateMatch = block.match(/<span[^>]*class="[^"]*chapter-release-date[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      var uploadedAt = dateMatch ? this._parseDate(this._stripTags(dateMatch[1])) : undefined;

      chapters.push({
        url: chUrl,
        number: chNum,
        title: cleanTitle,
        uploadedAt: uploadedAt
      });
    }
    return chapters;
  },

  _extractMangaId: function (html) {
    var m = html.match(/id="manga-chapters-holder"[^>]*data-id="(\d+)"/i) ||
            html.match(/data-id="(\d+)"[^>]*id="manga-chapters-holder"/i) ||
            html.match(/id="wp-manga-id"[^>]*value="(\d+)"/i) ||
            html.match(/name="wp-manga-id"[^>]*value="(\d+)"/i) ||
            html.match(/class="[^"]*wp-manga-id[^"]*"[^>]*value="(\d+)"/i) ||
            html.match(/data-post="(\d+)"/i) ||
            html.match(/<body[^>]*class="[^"]*\bpostid-(\d+)\b/i);
    return m ? m[1] : null;
  },

  parseChapterList: async function (novelUrl, ctx) {
    var fullUrl = this._absUrl(novelUrl);
    var res = await _fetchCachedPage(fullUrl, ctx);
    if (!res.ok) throw new Error('فشل جلب صفحة الفصول: ' + res.status);
    var html = res.text;

    // 1. Check for inline chapters
    var chapters = this._parseChapterRows(html);
    if (chapters.length > 0) {
      return this._finalizeChapters(chapters);
    }

    // 2. Fetch via admin-ajax.php if chapters are served dynamically
    var mangaId = this._extractMangaId(html);
    if (mangaId) {
      var ajaxUrl = this.baseUrl + '/wp-admin/admin-ajax.php';
      var ajaxRes = await ctx.xFetch(ajaxUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XML' + 'HttpRequest',
          'Referer': fullUrl,
          'Origin': this.baseUrl
        },
        body: 'action=manga_get_chapters&manga=' + encodeURIComponent(mangaId)
      });

      if (ajaxRes && ajaxRes.ok && ajaxRes.text) {
        var ajaxChapters = this._parseChapterRows(ajaxRes.text);
        if (ajaxChapters.length > 0) {
          return this._finalizeChapters(ajaxChapters);
        }
      }
    }

    // 3. Fallback: modern Madara /ajax/chapters/ endpoint
    var fallbackUrl = fullUrl.replace(/\/$/, '') + '/ajax/chapters/';
    var fbRes = await ctx.xFetch(fallbackUrl, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XML' + 'HttpRequest',
        'Referer': fullUrl
      }
    });
    if (fbRes && fbRes.ok && fbRes.text) {
      var fbChapters = this._parseChapterRows(fbRes.text);
      if (fbChapters.length > 0) {
        return this._finalizeChapters(fbChapters);
      }
    }

    return this._finalizeChapters(chapters);
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
  // Chapter Content
  // ---------------------------------------------------------------
  _extractContentBlock: function (html) {
    var m = html.match(/<div[^>]*class="[^"]*(?:reading-content|text-left|chapter-content|entry-content)[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:reading-content|text-left|chapter-content|entry-content)|<footer|$)/i);
    return m ? m[1] : html;
  },

  parseChapterContent: async function (chapterUrl, ctx) {
    var fullUrl = this._absUrl(chapterUrl);
    var res = await ctx.xFetch(fullUrl);
    if (!res.ok) throw new Error('فشل جلب نص الفصل: ' + res.status);
    var html = res.text;

    var contentBlock = this._extractContentBlock(html);

    // Remove ads, scripts, and promotional widgets
    contentBlock = contentBlock
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<div[^>]*class="[^"]*(?:code-block|promo|advertisement|\bad\b)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');

    var paragraphs = [];
    var pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    var pm;
    while ((pm = pRegex.exec(contentBlock)) !== null) {
      var text = this._decodeEntities(this._stripTags(pm[1]));
      if (!text) continue;

      if (/^(نهاية الفصل|تم الفصل|الفصل التالي|انتهى الفصل)/.test(text)) break;
      text = text.replace(/https?:\/\/\S+/g, ' ').replace(/[ \t\u00A0]{2,}/g, ' ');
      text = text.replace(/^\[?\s*(الفصل|فصل)\s+(الـ)?\s*\d+(?:\s*[:|].*)?\s*\]?\s*/i, '');
      text = text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '').trim();

      if (text) paragraphs.push(text);
    }

    if (paragraphs.length === 0) {
      var fallbackText = this._decodeEntities(this._stripTags(contentBlock));
      return fallbackText.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '').trim();
    }

    return paragraphs.join('\n\n');
  },

  // ---------------------------------------------------------------
  // Search & Browse
  // ---------------------------------------------------------------
  _parseNovelCards: function (html) {
    var results = [];
    var seen = {};

    var cardRegex = /<div[^>]*class="[^"]*(?:page-item-detail|c-tabs-item__content)[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:page-item-detail|c-tabs-item__content)[^"]*"|<\/body>|$)/gi;
    var match;
    while ((match = cardRegex.exec(html)) !== null) {
      var block = match[1];
      var linkMatch = block.match(/<div[^>]*class="[^"]*post-title[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ||
                      block.match(/<h[1-4][^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;

      var novelUrl = this._absUrl(linkMatch[1].trim());
      if (seen[novelUrl]) continue;
      seen[novelUrl] = true;

      var title = this._decodeEntities(this._stripTags(linkMatch[2])).trim();
      var coverMatch = block.match(/<img[^>]+(?:data-src|src)="([^">]+)"/i);
      var coverUrl = coverMatch ? this._absUrl(coverMatch[1].trim()) : undefined;
      var authorMatch = block.match(/<div[^>]*class="[^"]*author-content[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
      var author = authorMatch ? this._decodeEntities(authorMatch[1].trim()) : 'غير معروف';

      results.push({
        source: this.id,
        url: novelUrl,
        title: title,
        coverUrl: coverUrl,
        author: author,
        category: 'روايات مترجمة',
        status: 'مستمرة'
      });
    }

    return results;
  },

  searchNovels: async function (query, page, ctx) {
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    var isBrowse = !query || !query.trim();
    var url;

    if (isBrowse) {
      url = this._absUrl(pageNum > 1 ? '/novels-list/page/' + pageNum + '/?m_orderby=latest' : '/novels-list/?m_orderby=latest');
    } else {
      url = this._absUrl('/?s=' + encodeURIComponent(query.trim()) + '&post_type=wp-manga' + (pageNum > 1 ? '&paged=' + pageNum : ''));
    }

    var res = await ctx.xFetch(url);
    if (!res.ok) return [];
    return this._parseNovelCards(res.text);
  },

  getPopularNovels: async function (page, ctx) {
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    var url = this._absUrl(pageNum > 1 ? '/novels-list/page/' + pageNum + '/?m_orderby=views' : '/novels-list/?m_orderby=views');
    var res = await ctx.xFetch(url);
    if (!res.ok) return [];
    return this._parseNovelCards(res.text);
  },

  getCategories: async function () {
    return [
      { name: 'أكشن', slug: 'action' },
      { name: 'مغامرة', slug: 'adventure' },
      { name: 'فنتازيا', slug: 'fantasy' },
      { name: 'خيال علمي', slug: 'sci-fi' },
      { name: 'دراما', slug: 'drama' },
      { name: 'غموض', slug: 'mystery' },
      { name: 'فنون قتالية', slug: 'martial-arts' },
      { name: 'رعب', slug: 'horror' },
      { name: 'كوميديا', slug: 'comedy' },
      { name: 'سحر', slug: 'magic' },
      { name: 'تاريخي', slug: 'historical' },
      { name: 'إيسيكاي', slug: 'isekai' }
    ];
  },

  getCategoryNovels: async function (categorySlug, page, ctx) {
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    var url = this._absUrl('/manga-genre/' + encodeURIComponent(categorySlug) + (pageNum > 1 ? '/page/' + pageNum + '/' : '/'));
    var res = await ctx.xFetch(url);
    if (!res.ok) return [];
    return this._parseNovelCards(res.text);
  }
});
