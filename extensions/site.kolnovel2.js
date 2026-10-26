// site:kolnovel-v2 — remote-JS extension for ملوك الروايات (kolnovel.com)
// Starless-theme port of site:kolnovel. Same 13-method contract, new selectors only.
// Chapter rows are paged via ?chapter_volume & chapter_page (followed sequentially, cap 5).
registerExtension({
  id: 'site:kolnovel-v2',
  name: 'كول نوفيل',
  lang: 'ar',
  version: '2.0.0',
  apiVersion: 2,
  baseUrl: 'https://kolnovel.com',

  // Login declaration (single place): the host auto-discovers this after
  // install and wires the login sheet, session storage, and auth header
  // injection with no app-side changes. Paths omitted = PocketBase defaults.
  auth: {
    kind: 'pocketbase',
    apiBaseUrl: 'https://cmtapi.kolnovel.com',
    sso: {
      authorizeUrl: 'https://kolnovel.com/wp-admin/admin-post.php?action=kol_comments_sso_authorize',
      clientId: 'kol-comments-widget',
      redirectUri: 'https://kolnovel.com/account/',
      exchangePath: '/api/auth/kolnovel/exchange',
    },
    registerUrl: 'https://kolnovel.com/registerr/',
  },

  // Custom comment backend (PocketBase). Chapter pages embed:
  // <kol-comments slug entity-title entity-url entity-id="WP_POST_ID"
  //   entity-type="post" series-id="WP_SERIES_ID"> which resolves via
  // entities/ensure to a PocketBase entity UUID for comments/comment_net.
  _cmtApi: 'https://cmtapi.kolnovel.com',

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  _absUrl: function (url) {
    if (url.indexOf('http') === 0) return url;
    if (url.indexOf('//') === 0) return 'https:' + url;
    var base = this.baseUrl.replace(/\/$/, '');
    return base + (url.charAt(0) === '/' ? '' : '/') + url;
  },

  // Normalize a cover URL from card/detail HTML (protocol-relative → https).
  // GIF→static conversion happens app-side (NovelCover), so covers stay
  // untouched apart from scheme normalization.
  _cover: function (raw) {
    if (!raw) return undefined;
    var u = String(raw).trim();
    if (!u) return undefined;
    if (u.indexOf('//') === 0) return 'https:' + u;
    return u;
  },

  _stripTags: function (html) {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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

  // Strip a leading chapter-prefix ("Chapter 1:", "الفصل 1:", "الفصل الثالث") from a
  // chapter name so the number/word is not duplicated in the final title.
  _stripChapterPrefix: function (name) {
    var m = (name || '').trim();
    m = m.replace(/^(?:chapter|ch\.?|فصل|الفصل)\s*(\d+(?:\.\d+)?)\s*(?:[-–—:.#|]\s*)?/i, '');
    if (m !== (name || '').trim()) return m.trim();
    m = m.replace(/^(?:فصل|الفصل)\s*(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)\s*(?:[:|.\-–—]?\s*)/i, '');
    m = m.replace(/^(?:فصل|الفصل)\s*[:|.\-–—]\s*/i, '');
    return m.trim();
  },

  // The site stores some titles slug-style ("نظام&سلالة&الدم-kol"): HTML entities
  // plus "&" word separators and a "-kol" dedupe suffix. Browsers show the raw symbols,
  // so clean them here instead of leaking "&amp;" / "&" / "-kol" into the library.
  _cleanNovelTitle: function (raw, fallback) {
    var t = this._decodeEntities(this._stripTags(raw || ''));
    t = t.replace(/ملوك الروايات/g, ' ');
    t = t.replace(/-kol\s*$/i, '');
    t = t.replace(/&/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    return t || fallback || '';
  },

  // Build the final "Chapter <number> <name>" title; auto-generate missing numbers.
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

  // Tiny shared LRU cache for the (heavy, static) novel page, so parseNovelInfo and
  // parseChapterList don't each fetch the same HTML when the app calls them back to
  // back for one novel. Bounded and time-limited so the data can't go stale. Misses
  // and failures are never cached; only ok GET responses are stored.
  _novelCache: { ttl: 5 * 60 * 1000, cap: 8, map: Object.create(null) },

  // Wrap network calls so a genuine exception (not an HTTP status) becomes a clear
  // Error instead of an unhandled rejection (bug #9).
  _safeFetch: async function (urlOrOpts, ctx, label) {
    try {
      return await ctx.xFetch(urlOrOpts);
    } catch (e) {
      throw new Error((label || 'فشل الاتصال') + ': ' + (e && e.message ? e.message : String(e)));
    }
  },

  _fetchNovelHtml: async function (url, ctx) {
    var cache = this._novelCache;
    var hit = cache.map[url];
    if (hit && (Date.now() - hit.t) < cache.ttl) return hit.html;
    var res = await this._safeFetch(url, ctx, 'فشل جلب صفحة الرواية');
    if (!res.ok) throw new Error('فشل جلب صفحة الرواية: ' + res.status);
    var html = res.text;
    cache.map[url] = { t: Date.now(), html: html };
    var keys = Object.keys(cache.map);
    if (keys.length > cache.cap) {
      var oldest = keys[0];
      for (var i = 1; i < keys.length; i++) {
        if (cache.map[keys[i]].t < cache.map[oldest].t) oldest = keys[i];
      }
      delete cache.map[oldest];
    }
    return html;
  },

  _parseDate: function (raw) {
    if (!raw) return undefined;
    var str = this._toLatinDigits(String(raw).trim());
    if (!str) return undefined;

    var now = Date.now();

    // 1. Relative Arabic patterns — supports both "منذ N وحدة" and "N وحدة منذ",
    // Latin digits, Arabic digit words, and dual forms (يومين / ساعتين / …).
    // Always returns an epoch-ms number so the app can store/format the date.
    if (str.indexOf('منذ') !== -1) {
      var relMs = this._relativeUnitMs(str);
      if (relMs !== undefined) {
        var amount = this._relativeAmount(str);
        return now - relMs * amount;
      }
    }

    // 2. Arabic Month Names Map
    var arabicMonths = {
      'يناير': 0, 'كانون الثاني': 0, 'جانفي': 0,
      'فبراير': 1, 'شباط': 1, 'فيفري': 1,
      'مارس': 2, 'آذار': 2, 'اذار': 2,
      'أبريل': 3, 'ابريل': 3, 'نيسان': 3, 'افريل': 3,
      'مايو': 4, 'أيار': 4, 'ايار': 4, 'ماي': 4,
      'يونيو': 5, 'حزيران': 5, 'جوان': 5,
      'يوليو': 6, 'تموز': 6, 'جويلية': 6,
      'أغسطس': 7, 'اغسطس': 7, 'آب': 7, 'اب': 7, 'غشت': 7, 'اوت': 7,
      'سبتمبر': 8, 'أيلول': 8, 'ايلول': 8, 'شتنبر': 8,
      'أكتوبر': 9, 'اكتوبر': 9, 'تشرين الأول': 9, 'تشرين الاول': 9,
      'نوفمبر': 10, 'تشرين الثاني': 10,
      'ديسمبر': 11, 'كانون الأول': 11, 'كانون الاول': 11, 'دجنبر': 11
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
        } else if (nums && nums.length === 1) {
          var dayOnly = parseInt(nums[0], 10);
          var curYear = new Date().getFullYear();
          var dObj = new Date(curYear, monthIdx, dayOnly, 12, 0, 0);
          if (!isNaN(dObj.getTime())) return dObj.getTime();
        }
      }
    }

    // 3. Standard date parse fallback
    var parsed = Date.parse(str);
    if (!isNaN(parsed)) return parsed;

    return undefined;
  },

  // ---------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------
  parseNovelInfo: async function (url, ctx) {
    var fullUrl = this._absUrl(url);
    var html = await this._fetchNovelHtml(fullUrl, ctx);

    var titleMatch = html.match(/<h1[^>]*class="[^"]*kol-series-editorial__title[^"]*"[^>]*>([^<]+)<\/h1>/i);
    var titleRaw = titleMatch ? titleMatch[1].trim() : '';
    if (!titleRaw) {
      var fallback = html.match(/<title>([^<]+)/i);
      titleRaw = fallback ? fallback[1].split(/–|-/)[0].trim() : '';
    }
    var title = this._cleanNovelTitle(titleRaw, 'رواية');

    // Cover: starless editorial cover first; og:image on novel pages is the site logo so ignore logos.
    var coverMatch = html.match(/<div[^>]*class="[^"]*kol-series-editorial__cover[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^">]+)"/i);
    if (coverMatch && /بدون-اسم|cropped-|32x32|180x180|2026\/10/.test(coverMatch[1])) coverMatch = null;
    if (!coverMatch) {
      var og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
      if (og && !/بدون-اسم|cropped-|32x32|180x180/.test(og[1])) coverMatch = og;
      else coverMatch = null;
    }
    var coverUrl = coverMatch ? this._cover(coverMatch[1]) : undefined;

    // Translators replace the old .serl author block on starless.
    var authorMatch = html.match(/kol-series-translators__item[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
    var author = authorMatch ? this._decodeEntities(authorMatch[1].trim()) : undefined;
    if (author) author = 'المترجم: ' + author;

    // Status: starless badge, Arabic text already.
    var statusMatch = html.match(/<span[^>]*class="[^"]*kol-series-editorial__status[^"]*"[^>]*>([^<]+)<\/span>/i) ||
                      html.match(/<span[^>]*class="[^"]*kol-series-archive__status[^"]*"[^>]*>([^<]+)<\/span>/i);
    var statusRaw = statusMatch ? statusMatch[1].trim() : '';
    var status = 'مستمرة';
    if (/مكتمل/.test(statusRaw)) status = 'مكتملة';
    else if (/متوقف/.test(statusRaw)) status = 'متوقفة';
    else if (/مستمر/.test(statusRaw)) status = 'مستمرة';

    // Summary from starless prose block.
    var summary = undefined;
    var synopsisMatch = html.match(/<div[^>]*class="[^"]*kol-series-editorial__prose[^"]*"[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/div>/i) ||
                      html.match(/<div[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/div>/i);
    if (synopsisMatch) {
      var block = synopsisMatch[1]
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
      summary = this._decodeEntities(this._stripTags(block)).replace(/[\s{]+$/g, '');
    }

    // Genres: starless links /genre/<slug>/ inside editorial genres block.
    var genres = [];
    var genreBlock = html.match(/<div[^>]*class="[^"]*kol-series-editorial__genres[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
                     html.match(/<div[^>]*class="[^"]*kol-series-editorial__genres[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    var genreHtml = genreBlock ? genreBlock[1] : html;
    // Only trust genreHtml when it actually contains /genre/ links; otherwise scan whole page once.
    if (genreHtml.indexOf('/genre/') === -1) genreHtml = html;
    var genreRegex = /<a[^>]+href="[^"]*\/genre\/[^"]*"[^>]*>([^<]+)<\/a>/gi;
    var gm;
    while ((gm = genreRegex.exec(genreHtml)) !== null) {
      var g = this._decodeEntities(gm[1].replace(/^#\s*/, '').trim());
      if (g && genres.indexOf(g) === -1) genres.push(g);
      if (genres.length > 30) break;
    }
    // If we scanned the whole page (fallback), genre links from nav/footer leak in;
    // keep only the first 8 ordered as on the editorial block.
    if (genreBlock && genres.length > 8) genres = genres.slice(0, 8);

    // Rating: V1 widget gone on novel page (lazy <kol-comment-review>); keep V1 selector
    // first, then starless ★ badges, gated 0 < r <= 5.
    var rating;
    var rateMatch = html.match(/<span[^>]*class="[^"]*custom-rating-value[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    var rateNum = rateMatch ? parseFloat(this._toLatinDigits(this._stripTags(rateMatch[1]).replace(',', '.'))) : NaN;
    if (isNaN(rateNum)) {
      var starMatch = html.match(/★\s*<b[^>]*>([\d.]+)<\/b>/i) || html.match(/★\s*([\d.]+)/);
      if (starMatch) rateNum = parseFloat(this._toLatinDigits(starMatch[1]));
    }
    if (!isNaN(rateNum) && rateNum > 0 && rateNum <= 10) {
      if (rateNum > 5) rateNum = Math.round((rateNum / 2) * 10) / 10;
      else rateNum = Math.round(rateNum * 10) / 10;
      rating = rateNum;
    }

    return {
      source: this.id,
      url: fullUrl,
      title: title,
      author: author,
      coverUrl: coverUrl,
      summary: summary,
      status: status,
      category: genres.length > 0 ? genres[0] : undefined,
      tags: genres.length > 0 ? genres : undefined,
      rating: rating
    };
  },

  // ---------------------------------------------------------------
  // Chapter list — inline on the novel page
  // ---------------------------------------------------------------
  // Parse the inline chapter list from the novel page HTML (shared by the full
  // parseChapterList and the incremental fetchLatestChapters). Returns raw rows:
  // the caller still applies _finalizeChapters.
  _fetchInlineChapters: function (html) {
    var chapters = [];
    var self = this;
    // Starless: <li class="kol-series-chapter" data-ID="..."><a href="..." ...>
    // <span data-kol-chapter-number="196"> + <span data-kol-chapter-title> + <time datetime="...">
    var liRegex = /<li[^>]*class="[^"]*kol-series-chapter[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    var match;
    while ((match = liRegex.exec(html)) !== null) {
      var block = match[1];
      var hrefM = block.match(/href="([^"]+)"/i);
      if (!hrefM) continue;
      var chapterUrl = hrefM[1].trim();
      var numM = block.match(/data-kol-chapter-number="(\d+(?:\.\d+)?)"/i) ||
                 block.match(/فصل\s*(\d+(?:\.\d+)?)/i);
      var chapterNumber = numM ? parseFloat(numM[1]) : 0;
      var titleM = block.match(/data-kol-chapter-title[^>]*>([^<]+)</i) ||
                   block.match(/class="[^"]*kol-series-chapter__title-copy[^"]*"[^>]*>([^<]+)</i) ||
                   block.match(/class="[^"]*kol-series-chapter__title[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      var title = titleM ? self._decodeEntities(self._stripTags(titleM[1])) : '';
      if (!chapterNumber) {
        var cleanTitle = self._toLatinDigits(title);
        var titleNum = cleanTitle.match(/^(\d+)/);
        if (titleNum) {
          chapterNumber = parseInt(titleNum[1], 10);
          title = title.replace(/^[\s\u200E\u200F\u202A-\u202E]*[0-9\u0660-\u0669\u06F0-\u06F9]+[\s\u200E\u200F\u202A-\u202E]*/, '').trim();
        }
      }
      var timeM = block.match(/<time[^>]+datetime="([^"]+)"/i) ||
                  block.match(/<time[^>]*>([^<]+)<\/time>/i);
      var rawDate = timeM ? self._stripTags(timeM[1]) : '';
      var uploadedAt = self._parseDate(rawDate);
      // datetime="2021-07-10T22:06:55+02:00" parses via Date.parse directly
      if (uploadedAt === undefined && timeM) {
        var t = Date.parse(timeM[1].trim());
        if (!isNaN(t)) uploadedAt = t;
      }
      chapters.push({ url: chapterUrl, number: chapterNumber, title: self._stripChapterPrefix(title), uploadedAt: uploadedAt });
    }
    return chapters;
  },

  _volumePages: function (html) {
    var pages = {};
    var re = /href="([^"]*chapter_volume[^"]*chapter_page[^"]*)"/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var u = m[1].replace(/&#0?38;/g, '&').replace(/&amp;/g, '&');
      if (pages[u]) continue;
      pages[u] = true;
      if (Object.keys(pages).length >= 5) break;
    }
    return Object.keys(pages);
  },

  parseChapterList: async function (novelUrl, ctx) {
    var fullUrl = this._absUrl(novelUrl);
    var html = await this._fetchNovelHtml(fullUrl, ctx);
    var all = this._fetchInlineChapters(html);
    // Follow volume pager (?chapter_volume=&chapter_page=N) sequentially, cap 5.
    // Static novel page ships empty <ul data-kol-chapter-volume-content> until paged.
    var seen = {};
    all.forEach(function (c) { seen[c.url] = true; });
    var pages = this._volumePages(html);
    for (var i = 0; i < pages.length; i++) {
      try {
        var pageUrl = pages[i].charAt(0) === '/' ? this._absUrl(pages[i]) : (pages[i].indexOf('http') === 0 ? pages[i] : this._absUrl('/' + pages[i].replace(/^\//, '')));
        var res = await this._safeFetch(pageUrl, ctx, 'فشل جلب صفحة الفصول');
        if (!res.ok) continue;
        var rows = this._fetchInlineChapters(res.text || '');
        for (var j = 0; j < rows.length; j++) {
          if (!seen[rows[j].url]) { seen[rows[j].url] = true; all.push(rows[j]); }
        }
      } catch (e) { /* one bad volume page must not kill the list */ }
      if (all.length > 2000) break;
    }
    // Fallback: start/latest shortcuts carry first+last when list is JS-gated.
    if (all.length === 0) {
      var linkRe = /<a[^>]+href="([^"]+)"[^>]*data-kol-chapter-transition-link[^>]*>/gi;
      var lm;
      while ((lm = linkRe.exec(html)) !== null) {
        if (!seen[lm[1]]) { seen[lm[1]] = true; all.push({ url: lm[1].trim(), number: 0, title: '' }); }
        if (all.length >= 2) break;
      }
    }
    return this._finalizeChapters(all);
  },

  // ---------------------------------------------------------------
  // Incremental chapter refresh (Tachiyomi-style)
  // The host tells us how many chapters it already has (`knownCount`); the list
  // is already inline on the novel page (1 request either way), so we just parse
  // it and return only chapters newer than what the app already stores. This
  // spares the app the DB upserts for hundreds of unchanged chapters.
  // ---------------------------------------------------------------
  fetchLatestChapters: async function (novelUrl, knownCount, ctx) {
    var all = await this.parseChapterList(novelUrl, ctx);
    var latest = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].number > knownCount) latest.push({ url: all[i].url, number: all[i].number, title: all[i].title, uploadedAt: all[i].uploadedAt });
    }
    return this._finalizeChapters(latest);
  },


  // ---------------------------------------------------------------
  // Chapter body
  // ---------------------------------------------------------------
  // Depth-aware block extraction: capture the body of the block whose opening tag matches
  // `opener` (e.g. the <div ... id="kol_content"> container) by counting nested same-tag
  // depth. Inner nested divs no longer truncate the capture (bug #2 - previously the
  // non-greedy `</div><div` regex stopped at the first inner </div>).
  _extractBlockContent: function (html, opener) {
    var openerRe = new RegExp(opener, 'i');
    var openMatch = openerRe.exec(html);
    if (!openMatch) return null;
    var openRe = /<div(?=[\s>])/gi;
    var closeRe = /<\/div\s*>/gi;
    var start = openMatch.index + openMatch[0].length;
    openRe.lastIndex = start;
    closeRe.lastIndex = start;
    var depth = 1;
    while (depth > 0) {
      var o = openRe.exec(html);
      var c = closeRe.exec(html);
      var oi = o ? o.index : Infinity;
      var ci = c ? c.index : Infinity;
      if (oi === Infinity && ci === Infinity) return null; // unbalanced
      if (oi < ci) {
        depth++;
        openRe.lastIndex = o.index + o[0].length;
        closeRe.lastIndex = openRe.lastIndex;
      } else {
        depth--;
        if (depth === 0) return { content: html.slice(start, c.index) };
        closeRe.lastIndex = c.index + c[0].length;
        openRe.lastIndex = closeRe.lastIndex;
      }
    }
    return null;
  },

  parseChapterContent: async function (chapterUrl, ctx) {
    var absUrl = this._absUrl(chapterUrl);
    var res = await this._safeFetch(absUrl, ctx, 'فشل جلب نص الفصل');
    if (!res.ok) throw new Error('فشل جلب نص الفصل: ' + res.status);
    var html = res.text;

    // Locate #kol_content then capture its full depth-matched body (bug #2: inner nested divs
    // no longer truncate the captured chapter text).
    var contentBlock = this._extractBlockContent(html, '<div[^>]*id="kol_content"[^>]*>') ||
                       this._extractBlockContent(html, '<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>');
    if (!contentBlock) throw new Error('تعذر العثور على نص الفصل');
    var rawContent = contentBlock.content;

    // Remove scripts, styles, known ad slots, and hidden elements.
    rawContent = rawContent.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    rawContent = rawContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    rawContent = rawContent.replace(/<i[^>]*id="Top_ad_s"[^>]*>[\s\S]*?<\/i>/gi, '');
    // Remove ad blocks by class, but only when "ad" is a whole token (word-boundary) in the
    // class/value, NOT a sub-string (fixes #1 over-broad match that deleted real content in
    // classes like shadow/reader/gradient/badge). This removes class="ad", "inline-ad",
    // "ad-banner", etc., while preserving any block that merely contains "ad" inside a word.
    rawContent = rawContent.replace(/<div[^>]*class="[^"]*\bad\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
    // Keep a copy of blockquotes so the no-<p> fallback can still read them (fixes #3).
    var blockquotes = [];
    var bqGrab = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi;
    var bqM;
    while ((bqM = bqGrab.exec(rawContent)) !== null) {
      var bqText = this._decodeEntities(this._stripTags(bqM[1]));
      if (bqText) blockquotes.push(bqText);
    }
    // Remove blockquote title headers (contain only the chapter title)
    rawContent = rawContent.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '\n');
    // Remove h2/h3/h4 heading tags
    rawContent = rawContent.replace(/<h[1-4][^>]*>[\s\S]*?<\/h[1-4]>/gi, '\n');

    var self = this;
    // Hidden decoy classes: the site hides scraper-trap paragraphs with CSS like
    // `.<hash>{height:0.1px;opacity:0;text-indent:-99999px}` (verified live: 9 hashes
    // per chapter, all matching the double-quoted <p class="HASH"> stream). Hashes are
    // random per chapter, so collect them from the page instead of hardcoding.
    var hiddenClasses = {};
    var styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    var stM;
    while ((stM = styleRe.exec(html)) !== null) {
      var css = stM[1];
      if (css.indexOf('0.1px') === -1 && css.indexOf('-99999') === -1) continue;
      var clsRe = /\.([a-f0-9]{16,64})/gi;
      var cM;
      while ((cM = clsRe.exec(css)) !== null) hiddenClasses[cM[1]] = true;
    }
    var isHiddenTag = function (tag) {
      var cm = tag.match(/class=(?:"([^"]*)"|'([^']*)')/i);
      var clsStr = cm ? (cm[1] !== undefined ? cm[1] : cm[2]) : '';
      var parts = clsStr.split(/\s+/);
      for (var hi = 0; hi < parts.length; hi++) {
        if (parts[hi] && hiddenClasses[parts[hi]]) return true;
      }
      return false;
    };
    var cleanPara = function (text) {
      if (!text) return null;
      if (/^(نهاية الفصل|تم الفصل|الفصل التالي|انتهى الفصل)/.test(text)) return 'BREAK';
      text = text.replace(/https?:\/\/\S+/g, ' ').replace(/[ \t\u00A0]{2,}/g, ' ');
      text = text.replace(/^\[?\s*(الفصل|فصل)\s+(الـ)?\s*\d+\s*(?:[:|\-–—]\s*)?\]?\s*/i, '')
                 .replace(/^\s*\[\s*(الفصل|فصل)\s+(الـ)?\s*\d+\s*\]\s*/i, '')
                 .replace(/^\[?\s*(الفصل|فصل)\s+(?:الحادي|الثاني)?\s*عشر(?:اء)?\s*[:|\-–—.]?\s*/i, '')
                 .replace(/^\[?\s*(الفصل|فصل)\s+(?:الأول|الثاني|الثالث|الرابع|الخامس)\s+عشر\s*[:|\-–—.]?\s*/i, '')
                 .replace(/^\[?\s*(الفصل|فصل)\s+(?:السادس|السابع|الثامن|التاسع|العاشر)\s+عشر\s*[:|\-–—.]?\s*/i, '')
                 .replace(/^\[?\s*(الفصل|فصل)\s+(?:الـ|ال|رقم|عدد)\s*\d+\s*[:|\-–—.]?\s*/i, '')
                 .replace(/^\[?\s*(الفصل|فصل)\s+(الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)\s*[:|.]?\s*/i, '')
                 .replace(/^\[?\s*(الفصل|فصل)\s+(?:[أ-ي]{3,}\s+(?:و\s+)?)+[أ-ي]{3,}\s*:\s*/i, '')
                 .replace(/^\[?\s*(الفصل|فصل)\s+\S+:\s*/i, '');
      text = text.replace(/^\d{1,6}\s*[-–:]\s*/, '')
                 .replace(/^\d{1,6}\.?md\.?\s*/i, '')
                 .replace(/^\d{1,6}$/, '');
      text = text.trim();
      if (!text) return null;
      return text;
    };

    // Extract paragraphs
    var paragraphs = [];
    // Anti-scraper layout: each real paragraph is <p class='HASH'>REAL<p class="HASH">DECOY</p>
    // where DECOY is a shuffled duplicate hidden via CSS (height:0.1px;opacity:0). A generic
    // <p>(REAL+DECOY)</p> match merges two distant sentences and scrambles the order
    // (e.g. سلالة الدم ch.1 started mid-story with merged sentences). The visible stream
    // is picked via the page's own hidden-class CSS, so a future quote-style flip still
    // resolves correctly; quote style is only the fallback when no hidden CSS is found.
    var collectStream = function (quote) {
      var q = quote === "'" ? "'" : '"';
      var re = new RegExp("<p\\s+class=" + q + "([a-f0-9]{16,64})" + q + "[^>]*>([\\s\\S]*?)(?=<p\\s+class=|</p>)", 'gi');
      var items = [];
      var m;
      while ((m = re.exec(rawContent)) !== null) {
        items.push({ cls: m[1], tag: m[0].slice(0, 200), raw: m[2] });
      }
      return items;
    };
    var singleItems = collectStream("'");
    var doubleItems = collectStream('"');
    var pickStream = function (items) {
      if (items.length < 5) return null;
      var hiddenCount = 0;
      for (var si = 0; si < items.length; si++) {
        if (hiddenClasses[items[si].cls]) hiddenCount++;
      }
      if (hiddenCount > items.length / 2) return null;
      var out = [];
      for (var oi = 0; oi < items.length; oi++) {
        if (hiddenClasses[items[oi].cls]) continue;
        var t = self._decodeEntities(self._stripTags(items[oi].raw));
        if (!t) continue;
        var c = cleanPara(t);
        if (c === 'BREAK') break;
        if (!c) continue;
        out.push(c);
      }
      return out.length > 0 ? out : null;
    };
    var visibleParas = pickStream(singleItems) || pickStream(doubleItems);
    if (visibleParas) return visibleParas.join('\n\n');

    var pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    var pMatch;
    while ((pMatch = pRegex.exec(rawContent)) !== null) {
      if (isHiddenTag(pMatch[0])) continue;
      var text = this._decodeEntities(this._stripTags(pMatch[1]));
      if (!text) continue;
      var cleaned = cleanPara(text);
      if (cleaned === 'BREAK') break;
      if (!cleaned) continue;
      paragraphs.push(cleaned);
    }

    // Fallback: if no <p> elements were found, fall back to the blockquotes we saved before
    // stripping them (fixes #3 - the old code searched after removal, so it could never match).
    if (paragraphs.length === 0 && blockquotes.length > 0) {
      paragraphs = blockquotes;
    }

    // Final fallback: strip all tags
    if (paragraphs.length === 0) {
      return this._decodeEntities(rawContent.replace(/<[^>]+>/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\s+\n/g, '\n').trim());
    }
    return paragraphs.join('\n\n');
  },

  // ---------------------------------------------------------------
  // Search / browse
  // ---------------------------------------------------------------
  _splitGenres: function (raw) {
    if (!raw) return [];
    var parts = String(raw).split(/[·•|,\/]/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var g = this._decodeEntities(parts[i].replace(/^#\s*/, '').trim());
      if (g && out.indexOf(g) === -1) out.push(g);
    }
    return out;
  },

  _parseRating: function (raw) {
    if (!raw) return undefined;
    var n = parseFloat(this._toLatinDigits(String(raw).replace(',', '.')));
    if (isNaN(n) || n <= 0 || n > 10) return undefined;
    return Math.round(n * 10) / 10;
  },

  _statusAr: function (raw) {
    var s = String(raw || '');
    if (/مكتمل/.test(s) || /completed/i.test(s)) return 'مكتملة';
    if (/متوقف/.test(s) || /hiatus/i.test(s)) return 'متوقفة';
    return 'مستمرة';
  },

  _parseSearchCards: function (html) {
    var self = this, results = [], seen = {};
    var re = /<article[^>]*class="[^"]*kol-search__item[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var block = m[1];
      var link = block.match(/<a[^>]+href="([^"]+\/series\/[^"]+)"[^>]*data-kol-series-title-source[^>]*>([^<]+)<\/a>/i) ||
                 block.match(/<h3[^>]*>[\s\S]*?<a[^>]+href="([^"]+\/series\/[^"]+)"[^>]*>([^<]+)<\/a>/i);
      if (!link) continue;
      var url = link[1].trim();
      if (seen[url]) continue;
      seen[url] = true;
      var cover = block.match(/<img[^>]+src="([^">]+)"/i);
      var meta = block.match(/<div[^>]*class="[^"]*kol-search__meta[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      var metaText = meta ? self._stripTags(meta[1]) : '';
      var ratingM = metaText.match(/★\s*([\d.]+)/) || block.match(/★\s*([\d.]+)/);
      var statusM = metaText.replace(/★[\d.\s]*/g, '').trim().split(/\s{2,}|[\n]/)[0] || '';
      var genM = block.match(/<p[^>]*class="[^"]*kol-search__genres[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
      var tags = self._splitGenres(genM ? self._stripTags(genM[1]) : '');
      results.push({
        source: self.id, url: url,
        title: self._cleanNovelTitle(link[2], ''),
        coverUrl: cover ? self._cover(cover[1]) : undefined,
        author: 'غير معروف',
        category: tags.length > 0 ? tags[0] : 'روايات مترجمة',
        tags: tags.length > 0 ? tags : undefined,
        status: self._statusAr(statusM || block),
        rating: self._parseRating(ratingM ? ratingM[1] : undefined)
      });
    }
    return results;
  },

  _parseArchiveCards: function (html) {
    var self = this, results = [], seen = {};
    var re = /<article[^>]*class="[^"]*kol-series-archive__item[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var block = m[1];
      var link = block.match(/<a[^>]+href="([^"]+\/series\/[^"]+)"[^>]*data-kol-series-title-source[^>]*>([^<]+)<\/a>/i) ||
                 block.match(/<a[^>]+href="([^"]+\/series\/[^"]+)"[^>]*>[\s\S]*?<\/a>[\s\S]*?<h3[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i) ||
 block.match(/<a[^>]+href="([^"]+\/series\/[^"]+)"[^>]*>/i);
      if (!link) continue;
      var url = (link[1] || '').trim();
      if (!url || seen[url]) continue;
      seen[url] = true;
      var titleM = block.match(/data-kol-series-title-source[^>]*>([^<]+)</i) || block.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
      var cover = block.match(/<img[^>]+src="([^">]+)"/i);
      var statusM = block.match(/class="[^"]*kol-series-archive__status[^"]*"[^>]*>([^<]+)</i);
      var ratingM = block.match(/class="[^"]*kol-series-archive__rating[^"]*"[^>]*>[\s\S]*?([\d.]+)/i) || block.match(/★\s*([\d.]+)/);
      var genBlock = block.match(/class="[^"]*kol-series-archive__genres-list[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                     block.match(/class="[^"]*kol-series-archive__genres[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      var tags = [];
      if (genBlock) {
        var gm, gre = /<span[^>]*>([^<]+)<\/span>|<a[^>]*>([^<]+)<\/a>/gi;
        while ((gm = gre.exec(genBlock[1])) !== null) {
          var g = self._decodeEntities((gm[1] || gm[2] || '').trim());
          if (!g || g === '·' || g === '•' || g === '|' || g === ',') continue;
          g = g.replace(/^#\s*/, '').trim();
          if (g && tags.indexOf(g) === -1) tags.push(g);
        }
      }
      results.push({
        source: self.id, url: url,
        title: titleM ? self._cleanNovelTitle(titleM[1], '') : self._cleanNovelTitle(url.split('/').filter(Boolean).pop() || '', ''),
        coverUrl: cover ? self._cover(cover[1]) : undefined,
        author: 'غير معروف',
        category: tags.length > 0 ? tags[0] : 'روايات مترجمة',
        tags: tags.length > 0 ? tags : undefined,
        status: self._statusAr(statusM ? statusM[1] : block),
        rating: self._parseRating(ratingM ? ratingM[1] : undefined)
      });
    }
    return results;
  },

  _parseHomeCards: function (html) {
    var self = this, results = [], seen = {};
    var covers = {}, titles = {};
    // Pass 1: cover-link anchors carry the <img> inside.
    var reC = /<a[^>]+href="([^"]+\/series\/[^"]+)"[^>]*data-kol-series-cover-link[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = reC.exec(html)) !== null) {
      var url = m[1].trim();
      var img = m[2].match(/<img[^>]+src="([^">]+)"/i);
      if (img && !covers[url]) covers[url] = img[1];
    }
    // Pass 2: title-source is any tag; anchors use href, others use data-kol-series-title-url.
    var reT = /<(\w+)[^>]*data-kol-series-title-source[^>]*>([^<]*)/gi;
    while ((m = reT.exec(html)) !== null) {
      var tag = m[0], title = self._decodeEntities(self._stripTags(m[2]).trim());
      var tu = tag.match(/data-kol-series-title-url="([^"]+)"/i) || tag.match(/href="([^"]+\/series\/[^"]+)"/i);
      if (tu && title && !titles[tu[1].trim()]) titles[tu[1].trim()] = title;
    }
    var urls = {};
    var k;
    for (k in covers) urls[k] = true;
    for (k in titles) urls[k] = true;
    for (k in urls) {
      if (seen[k]) continue;
      seen[k] = true;
      results.push({ source: self.id, url: k, title: self._cleanNovelTitle(titles[k] || k.split('/').filter(Boolean).pop() || '', ''), coverUrl: covers[k] ? self._cover(covers[k]) : undefined, author: 'غير معروف', category: 'روايات مترجمة', status: 'مستمرة' });
    }
    return results;
  },

  searchNovels: async function (query, page, ctx) {
    var isBrowse = !query || !query.trim();
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    var url;
    if (isBrowse) {
      // Starless homepage has no pagination (/page/N/ returns the same HTML);
      // default browse goes through the /series/ archive (14 pages, ?paged=N).
      url = this._absUrl('/series/' + (pageNum > 1 ? '?paged=' + pageNum : ''));
    } else {
      url = this._absUrl('/?s=' + encodeURIComponent(query.trim()) + (pageNum > 1 ? '&paged=' + pageNum : ''));
    }

    var res = await this._safeFetch(url, ctx, 'فشل البحث');
    if (!res.ok) return [];
    var html = res.text;
    var seen = {};
    var out = [];
    var add = function (list) {
      for (var i = 0; i < list.length; i++) {
        if (seen[list[i].url]) continue;
        seen[list[i].url] = true;
        out.push(list[i]);
      }
    };
    // Starless order: search items, archive items, home shelf/update rows.
    add(this._parseSearchCards(html));
    add(this._parseArchiveCards(html));
    if (out.length === 0) add(this._parseHomeCards(html));
    return out;
  },

  getPopularNovels: async function (page, sort, ctx) {
    if (sort && typeof sort.xFetch === 'function') { ctx = sort; sort = ''; }
    var order = (typeof sort === 'string' && sort) ? sort : '';
    if (!order) return this.searchNovels('', page, ctx);
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    var url = this._absUrl('/series/?order=' + encodeURIComponent(order) + (pageNum > 1 ? '&paged=' + pageNum : ''));
    var res = await this._safeFetch(url, ctx, 'فشل جلب التصفح المرتب');
    if (!res.ok) return [];
    return this._parseArchiveCards(res.text);
  },

  // Site-side catalogue orderings (verified against the /series/ filter form).
  getSortOptions: async function (ctx) {
    return [
      { name: 'أخر التحديثات', slug: 'update' },
      { name: 'أخر ما تم إضافته', slug: 'latest' },
      { name: 'الرائجة', slug: 'popular' },
      { name: 'التقييم', slug: 'rating' },
      { name: 'A-Z', slug: 'title' },
      { name: 'Z-A', slug: 'titlereverse' }
    ];
  },

  // ---------------------------------------------------------------
  // Categories / genres
  // ---------------------------------------------------------------
  // Scrape genres from homepage /genre/ links plus /series/ filter checkboxes
  // (starless homepage only ships 4 links; full list lives in the archive filter).
  getCategories: async function (ctx) {
    var categories = [];
    var seen = {};
    var push = function (slug, name) {
      slug = decodeURIComponent(String(slug || '').trim());
      name = String(name || '').replace(/^#\s*/, '').trim();
      if (!slug || !name || seen[slug]) return;
      seen[slug] = true;
      categories.push({ name: name, slug: slug });
    };
    var self = this;
    try {
      var home = await this._safeFetch(this._absUrl('/'), ctx, 'فشل جلب التصنيفات');
      if (home.ok) {
        var re = /href="[^"]*\/genre\/([^"\/]+)\/"[^>]*>([^<]+)<\/a>/gi;
        var m;
        while ((m = re.exec(home.text)) !== null) push(m[1], self._decodeEntities(m[2]));
      }
    } catch (e) { /* homepage alone is enough for offline fixtures */ }
    // Full taxonomy: <input name="genre[]" value="<slug>"> + <span>name</span>.
    try {
      var arch = await this._safeFetch(this._absUrl('/series/'), ctx, 'فشل جلب التصنيفات');
      if (arch.ok) {
        var re2 = /<input[^>]+name="genre\[\]"[^>]+value="([^"]+)"[^>]*>[\s\S]*?<span>([^<]+)<\/span>/gi;
        var m2;
        while ((m2 = re2.exec(arch.text)) !== null) push(m2[1], self._decodeEntities(m2[2]));
      }
    } catch (e) { /* keep homepage results */ }
    return categories;
  },

  // Browse novels filtered by a genre.
  // URL: /genre/<slug>/  (pagination: /genre/<slug>/page/N/)
  getCategoryNovels: async function (categorySlug, page, sort, ctx) {
    if (sort && typeof sort.xFetch === 'function') { ctx = sort; sort = ''; }
    var order = (typeof sort === 'string' && sort) ? sort : '';
    var slug = (categorySlug || '').replace(/\s+/g, '-');
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    var url;
    if (order) {
      url = this._absUrl('/series/?genre%5B%5D=' + encodeURIComponent(slug) + '&order=' + encodeURIComponent(order) + (pageNum > 1 ? '&paged=' + pageNum : ''));
    } else {
      url = this._absUrl('/genre/' + encodeURIComponent(slug) + '/');
      if (pageNum > 1) url += '?paged=' + pageNum;
    }
    var res = await this._safeFetch(url, ctx, 'فشل جلب صفحة التصنيف');
    if (!res.ok) return [];
    return this._parseArchiveCards(res.text);
  },

  _parseMaindetCards: function (html) {    return this._parseArchiveCards(html); },

  // ---------------------------------------------------------------
  // Chapter comments — read-only via cmtapi.kolnovel.com (PocketBase).
  // 1. GET chapter HTML -> <kol-comments slug entity-title
  //    entity-id="WP_POST_ID" series-id="WP_SERIES_ID">
  // 2. POST /api/kol/entities/ensure -> PocketBase entity UUID + commentsCount
  // 3. GET /api/collections/comments/records?filter=entity="UUID"
  //    (Lexical JSON in `text`, plain fallback in `normalizedContent`)
  // 4. GET /api/collections/comment_net/records?filter=entity="UUID"
  //    ({comment, likes, dislikes, net}) -> mapped to likes.
  // Write/vote are authenticated via the bundle's `auth` declaration above:
  // the host injects the saved PocketBase token, this supplies the user id,
  // and `kolnovel-auth-*` errors tell the app to (re)open login.
  // ---------------------------------------------------------------
  // Per-chapter comment state: the <kol-comments> tag and the entity UUID.
  // Both are tiny (a few hundred bytes) and never change for a chapter, but
  // the reader fires getComments and getCommentCount together the moment a
  // chapter opens, and each used to download the whole ~150 KB chapter page and
  // POST its own `ensure` just to read them.
  _cmtState: { tags: Object.create(null), ensure: Object.create(null) },
  _CMT_STATE_MAX: 500,
  _CMT_ENSURE_TTL: 5 * 60 * 1000,
  _CMT_PAGES_CAP: 5,

  _cmtKey: function (url) {
    var s = String(url || '').split('#')[0].split('?')[0].replace(/\/+$/, '');
    try { s = decodeURI(s); } catch (e) { /* keep encoded */ }
    return s.toLowerCase();
  },

  // One in-flight promise per key, so two concurrent callers share one request.
  _cmtOnce: function (key, make) {
    var flight = this._cmtState.flight || (this._cmtState.flight = Object.create(null));
    if (flight[key]) return flight[key];
    var p = make().then(
      function (v) { delete flight[key]; return v; },
      function (e) { delete flight[key]; throw e; }
    );
    flight[key] = p;
    return p;
  },

  // <kol-comments ...> -> {slug,title,wpPostId,wpSeriesId} | null.
  //
  // Two bugs the old `/<kol-comments\s+([^>]*?)>/` had:
  //   - `[^>]*?` stops at the FIRST ">" anywhere, so a chapter title containing
  //     ">" truncated the tag before entity-id. wpPostId then failed to parse
  //     and the chapter silently reported zero comments, with no error.
  //   - it only accepted double-quoted attribute values, so a single-quoted
  //     entity-id read as absent.
  // This alternation consumes whole quoted values, so a ">" inside one is safe,
  // and it requires an attribute boundary so "slug" cannot match inside "x-slug".
  _cmtTag: function (html) {
    var m = html.match(/<kol-comments\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i);
    if (!m) return null;
    var attrs = m[1];
    var get = function (name) {
      var r = attrs.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i'));
      if (!r) return '';
      return r[1] !== undefined ? r[1] : (r[2] !== undefined ? r[2] : (r[3] || ''));
    };
    var wpPostId = parseInt(get('wp-post-id') || get('entity-id'), 10);
    if (isNaN(wpPostId) || wpPostId <= 0) return null;
    var wpSeriesId = parseInt(get('wp-series-id') || get('series-id'), 10);
    if (isNaN(wpSeriesId) || wpSeriesId < 0) wpSeriesId = 0;
    return {
      slug: get('slug') || get('entity-slug'),
      title: this._decodeEntities(get('entity-title')),
      wpPostId: wpPostId,
      wpSeriesId: wpSeriesId
    };
  },

  // The tag identifies the chapter and never changes, so fetch it once per
  // chapter instead of once per caller.
  _cmtTagFor: function (fullUrl, ctx) {
    var self = this, st = self._cmtState, key = self._cmtKey(fullUrl);
    var hit = st.tags[key];
    if (hit) return Promise.resolve(hit);
    return self._cmtOnce('tag:' + key, async function () {
      var pageRes = await self._safeFetch(fullUrl, ctx, 'فشل جلب صفحة الفصل');
      if (!pageRes.ok) throw new Error('فشل جلب صفحة الفصل: ' + pageRes.status);
      var tag = self._cmtTag(pageRes.text || '');
      // A MISSING tag is not cached: it may be a transient bad page, and
      // caching "no comments" would stick for the whole session.
      if (tag) {
        if (self._CMT_STATE_MAX && Object.keys(st.tags).length >= self._CMT_STATE_MAX) {
          st.tags = Object.create(null);
        }
        st.tags[key] = tag;
      }
      return tag;
    });
  },

  // A PocketBase author record -> an absolute avatar URL, or '' when it has none.
  //
  // Verified against the live API: `expand.author.avatar` is a BARE FILENAME
  // (e.g. "645cac..._.png"), and the file is served from
  // /api/files/ + collection + recordId + filename. Sampled 50 comments: 32/32
  // authors had an avatar and every one was a bare filename. Both the
  // collectionId ("_pb_users_auth_") and the collectionName ("users") forms
  // were checked and both serve the image, so collectionId is used because a
  // display name can be renamed while the id cannot.
  //
  // The other shapes are handled defensively because an OAuth sign-in stores the
  // provider's picture URL instead of uploading a file.
  _cmtAvatar: function (rec) {
    if (!rec) return '';
    var raw = rec.avatar;
    if (Array.isArray(raw)) raw = raw[0];      // multi-file field
    if (typeof raw !== 'string') return '';
    var v = raw.trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;    // already absolute (OAuth)
    if (v.indexOf('//') === 0) return 'https:' + v;
    if (v.charAt(0) === '/') return this._cmtApi + v;
    var coll = rec.collectionId || rec.collectionName;
    if (!coll || !rec.id) return '';
    return this._cmtApi + '/api/files/' + encodeURIComponent(coll)
      + '/' + encodeURIComponent(rec.id) + '/' + encodeURIComponent(v);
  },

  // Lexical JSON ({"root":{"children":[{"children":[{"text":...}]...}]}})
  // -> plain text. Paragraph blocks joined with blank lines; emoji nodes
  // use their alt text; unknown nodes are skipped. Falls back to
  // `normalizedContent` when parsing fails or yields nothing.
  _lexicalToText: function (lexStr, fallback) {
    var blocks = [];
    try {
      var doc = JSON.parse(lexStr);
      var root = doc && doc.root && doc.root.children;
      if (root && root.length) {
        var walk = function (node) {
          if (!node) return '';
          if (node.type === 'text') return node.text || '';
          if (node.type === 'emoji') return node.alt || node.text || ' ';
          if (node.children && node.children.length) {
            var parts = [];
            for (var i = 0; i < node.children.length; i++) {
              parts.push(walk(node.children[i]));
            }
            return parts.join('');
          }
          return '';
        };
        for (var b = 0; b < root.length; b++) {
          var t = walk(root[b]).replace(/[ \t\u00A0]+/g, ' ').trim();
          if (t) blocks.push(t);
        }
      }
    } catch (e) { /* fall through to normalizedContent */ }
    if (blocks.length > 0) return blocks.join('\n\n');
    return (fallback || '').replace(/\s+/g, ' ').trim();
  },

  _cmtJson: async function (url, ctx, label, init) {
    var res;
    try {
      res = init ? await ctx.xFetch(url, init) : await ctx.xFetch(url);
    } catch (e) {
      throw new Error(label + ': ' + (e && e.message ? e.message : String(e)));
    }
    if (!res.ok) throw new Error(label + ': ' + res.status);
    try {
      return JSON.parse(res.text);
    } catch (e) {
      throw new Error('رد غير متوقع من نظام التعليقات');
    }
  },

  // Shared entity-ensure step: chapter page tag -> PocketBase entity UUID
  // (+ commentsCount). Cached briefly and shared between concurrent callers.
  _cmtEnsure: function (fullUrl, tag, ctx) {
    var self = this, st = self._cmtState, key = self._cmtKey(fullUrl);
    var hit = st.ensure[key];
    if (hit && Date.now() - hit.ts < self._CMT_ENSURE_TTL) return Promise.resolve(hit.value);
    return self._cmtOnce('ens:' + key, async function () {
      var value = await self._cmtJson(self._cmtApi + '/api/kol/entities/ensure', ctx, 'فشل تجهيز التعليقات', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: tag.slug || '',
          title: tag.title || '',
          url: fullUrl,
          wpPostId: tag.wpPostId,
          wpPostType: 'post',
          wpSeriesId: tag.wpSeriesId
        })
      });
      if (value && value.id) {
        if (self._CMT_STATE_MAX && Object.keys(st.ensure).length >= self._CMT_STATE_MAX) {
          st.ensure = Object.create(null);
        }
        st.ensure[key] = { ts: Date.now(), value: value };
      }
      return value;
    });
  },

  // Every item of one PocketBase collection: page 1, then the remaining pages
  // IN PARALLEL (they were fetched one after another).
  //
  // Applied to BOTH collections. comment_net used to read page 1 ONLY, so on any
  // chapter past 100 comments every later comment was reported with a confident
  // 0 likes — the same invented zero that was removed from the reader profile.
  _cmtPaged: async function (collection, filter, extra, ctx, label) {
    var self = this;
    var base = self._cmtApi + '/api/collections/' + collection + '/records?perPage=100'
      + extra + '&filter=' + filter + '&page=';
    var first = await self._cmtJson(base + 1, ctx, label);
    var items = (first && first.items) || [];
    var totalPages = Math.min((first && first.totalPages) || 1, self._CMT_PAGES_CAP);
    if (totalPages < 2) return items;
    var jobs = [];
    for (var p = 2; p <= totalPages; p++) jobs.push(self._cmtJson(base + p, ctx, label));
    var rest = await Promise.all(jobs);
    for (var r = 0; r < rest.length; r++) {
      if (rest[r] && rest[r].items) items = items.concat(rest[r].items);
    }
    return items;
  },

  // Count-only fast path for the reader badge: tag + ensure carry commentsCount,
  // so no records fetch and no comment parsing. After the chapter has been opened
  // once this costs nothing at all.
  getCommentCount: async function (chapterUrl, ctx) {
    var fullUrl = this._absUrl(chapterUrl);
    var tag = await this._cmtTagFor(fullUrl, ctx);
    if (!tag) return { count: 0 };
    var ensure = await this._cmtEnsure(fullUrl, tag, ctx);
    return { count: this._cmtCount(ensure && ensure.commentsCount) };
  },

  _cmtCount: function (v) {
    var n = parseInt(v, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  },

  getComments: async function (chapterUrl, ctx) {
    var fullUrl = this._absUrl(chapterUrl);
    var tag = await this._cmtTagFor(fullUrl, ctx);
    if (!tag) return { count: 0, comments: [] };

    var ensure = await this._cmtEnsure(fullUrl, tag, ctx);
    var pbId = ensure && ensure.id;
    if (!pbId) return { count: 0, comments: [] };
    // A number, not whatever the API typed it as: the host compares this against
    // a list length, and a string would break that comparison silently.
    var total = this._cmtCount(ensure.commentsCount);

    var filter = encodeURIComponent('entity="' + pbId + '"');
    // Comments and vote counts are independent, so fetch them together.
    var both = await Promise.all([
      this._cmtPaged('comments', filter, '&sort=created&expand=author', ctx, 'فشل جلب التعليقات'),
      this._cmtPaged('comment_net', filter, '', ctx, 'فشل جلب الإعجابات').catch(function () { return null; })
    ]);
    var items = both[0] || [];
    var nets = both[1]; // null = the vote table failed; likes then stay unknown-as-0

    var netMap = {};
    for (var n = 0; n < nets.length; n++) {
      var row = nets[n];
      var key = row.comment || row.id;
      var v = parseInt(typeof row.net !== 'undefined' ? row.net : row.likes, 10);
      if (isNaN(v) || v < 0) v = 0;
      if (key) netMap[key] = v;
    }

    var comments = [];
    var present = {};
    // Rows arrive sorted by `created`, so an unparseable date is almost certainly
    // next to a good one. Stamping it Date.now() put it in the present and
    // sorted it as the newest comment on the chapter.
    var lastGood = 0;
    for (var i = 0; i < items.length; i++) {
      var c = items[i];
      if (!c || c.isDeleted) continue;
      var body = this._lexicalToText(c.text || '', c.normalizedContent || '');
      if (!body) continue;
      if (c.containsSpoiler) body = '[حرق] ' + body;
      var author = '—';
      var avatar = this._cmtAvatar(c.expand && c.expand.author);
      if (c.expand && c.expand.author && c.expand.author.name) {
        author = String(c.expand.author.name).trim() || '—';
      }
      var createdAt = this._cmtTime(c.created);
      if (isNaN(createdAt)) createdAt = lastGood; else lastGood = createdAt;
      var likes = netMap[c.id];
      if (typeof likes !== 'number') likes = 0;
      present[String(c.id)] = true;
      comments.push({
        id: String(c.id),
        parentId: c.parentId ? String(c.parentId) : null,
        author: author,
        body: body,
        createdAt: createdAt,
        likes: likes,
        url: fullUrl.split('#')[0] + '#comment-' + c.id
      });
      // Only when the author actually has one, so the host can tell "no avatar"
      // from an empty string and fall back to the letter avatar.
      if (avatar) comments[comments.length - 1].authorAvatar = avatar;
    }
    // A reply whose parent is not in this list (deleted, empty after cleaning, or
    // beyond the page cap) would point at nothing, and the host would nest it
    // under a comment it cannot find. Show it as top-level instead.
    for (var k = 0; k < comments.length; k++) {
      if (comments[k].parentId && !present[comments[k].parentId]) comments[k].parentId = null;
    }
    comments.sort(function (a, b) { return a.createdAt - b.createdAt; });
    if (!total) total = comments.length;
    return { count: total, comments: comments };
  },

  // PocketBase writes dates as "2026-06-01 10:00:00.123Z" — a space, not the "T"
  // of ISO 8601. V8 parses both identically (verified), so this only matters for
  // a runtime that is stricter; it costs nothing to normalise.
  _cmtTime: function (raw) {
    var s = String(raw || '').trim();
    if (!s) return NaN;
    var t = Date.parse(s.replace(' ', 'T'));
    return isNaN(t) ? Date.parse(s) : t;
  },

  // Authenticated write path. The PocketBase token never enters the sandbox:
  // the host injects `Authorization` on every cmtapi request (WebViewRuntime),
  // so this only supplies the user id the server requires as the author/voter.
  // Missing id = the app never logged in; 401/403 = the saved session died.
  // Both surface as stable `kolnovel-auth-*` prefixes the app matches on.
  _cmtSiteUserId: function (input) {
    var id = input && (input.siteUserId || input.authUserId);
    id = id ? String(id).trim() : '';
    if (!id) throw new Error('kolnovel-auth-required: سجّل الدخول في كول نوفيل للتعليق');
    return id;
  },

  _cmtAuthError: function (res, label) {
    if (res && (res.status === 401 || res.status === 403)) {
      throw new Error('kolnovel-auth-expired: انتهت جلسة كول نوفيل، سجّل الدخول مجددا');
    }
    throw new Error(label + ': ' + (res ? res.status : 'network'));
  },

  // Plain text -> TipTap doc JSON (what the site widget stores in `text`).
  _cmtStoredDoc: function (body) {
    var parts = String(body || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
    if (!parts.length) parts = [String(body || '').trim()];
    return JSON.stringify({
      type: 'doc',
      content: parts.map(function (paragraph) {
        return { type: 'paragraph', content: [{ type: 'text', text: paragraph }] };
      })
    });
  },

  _cmtEscFilter: function (value) {
    return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  },

  _cmtAuthedJson: async function (url, ctx, label, init) {
    var res;
    try {
      res = await ctx.xFetch(url, init);
    } catch (e) {
      throw new Error(label + ': ' + (e && e.message ? e.message : String(e)));
    }
    if (res.status === 401 || res.status === 403) this._cmtAuthError(res, label);
    if (!res.ok) throw new Error(label + ': ' + res.status);
    try {
      return JSON.parse(res.text);
    } catch (e) {
      throw new Error('رد غير متوقع من نظام التعليقات');
    }
  },

  postComment: async function (chapterUrl, input, ctx) {
    var userId = this._cmtSiteUserId(input);
    var body = input && input.body ? String(input.body).trim() : '';
    if (!body) throw new Error('نص التعليق فارغ');
    var fullUrl = this._absUrl(chapterUrl);
    var tag = await this._cmtTagFor(fullUrl, ctx);
    if (!tag) throw new Error('تعذر تحديد صفحة التعليقات');
    var ensure = await this._cmtEnsure(fullUrl, tag, ctx);
    var pbId = ensure && ensure.id;
    if (!pbId) throw new Error('فشل تجهيز التعليقات');
    var payload = { author: userId, entity: pbId, isDeleted: false, text: this._cmtStoredDoc(body) };
    var parentRaw = input && input.parentId ? String(input.parentId).trim() : '';
    if (parentRaw) payload.parentId = parentRaw;
    var created = await this._cmtAuthedJson(this._cmtApi + '/api/collections/comments/records', ctx, 'فشل نشر التعليق', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { ok: true, id: created && created.id ? String(created.id) : undefined };
  },

  voteComment: async function (chapterUrl, input, ctx) {
    var userId = this._cmtSiteUserId(input);
    var cid = input && input.commentId ? String(input.commentId).trim() : '';
    if (!cid) throw new Error('تعذر تحديد التعليق');
    var vote = input && input.vote === -1 ? -1 : 1;
    var filter = encodeURIComponent('comment="' + this._cmtEscFilter(cid) + '" && user="' + this._cmtEscFilter(userId) + '"');
    var found = await this._cmtAuthedJson(
      this._cmtApi + '/api/collections/comment_votes/records?perPage=1&filter=' + filter,
      ctx, 'فشل التصويت');
    var existing = found && found.items && found.items[0];
    var liked = vote === 1;
    if (existing && existing.id) {
      if (existing.value === vote) {
        await this._cmtAuthedJson(this._cmtApi + '/api/collections/comment_votes/records/' + encodeURIComponent(existing.id), ctx, 'فشل التصويت', { method: 'DELETE' });
        liked = false;
      } else {
        await this._cmtAuthedJson(this._cmtApi + '/api/collections/comment_votes/records/' + encodeURIComponent(existing.id), ctx, 'فشل التصويت', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: vote })
        });
      }
    } else {
      await this._cmtAuthedJson(this._cmtApi + '/api/collections/comment_votes/records', ctx, 'فشل التصويت', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: cid, user: userId, value: vote })
      });
    }
    var netFilter = encodeURIComponent('comment="' + this._cmtEscFilter(cid) + '"');
    var net = await this._cmtAuthedJson(
      this._cmtApi + '/api/collections/comment_net/records?perPage=1&filter=' + netFilter,
      ctx, 'فشل التصويت');
    var row = net && net.items && net.items[0];
    var likes = 0;
    if (row) {
      var v = parseInt(typeof row.net !== 'undefined' ? row.net : row.likes, 10);
      if (!isNaN(v) && v >= 0) likes = v;
    }
    return { ok: true, likes: likes, liked: liked };
  }
});
