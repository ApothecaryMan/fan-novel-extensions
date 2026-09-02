// site:kolnovel — remote-JS extension for ملوك الروايات (kolnovel.com)
// Clean sandboxed scraper adhering to the Extension Runtime Specification (ctx.xFetch).
// Chapter lists are inline on the novel page (no AJAX pagination needed).
registerExtension({
  id: 'site:kolnovel',
  name: 'كول نوفيل',
  lang: 'ar',
  version: '1.3.0',
  apiVersion: 1,
  baseUrl: 'https://kolnovel.com',

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  _absUrl: function (url) {
    if (url.indexOf('http') === 0) return url;
    var base = this.baseUrl.replace(/\/$/, '');
    return base + (url.charAt(0) === '/' ? '' : '/') + url;
  },

  _stripTags: function (html) {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  },

  _decodeEntities: function (str) {
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

  _fetchNovelHtml: async function (url, ctx) {
    var cache = this._novelCache;
    var hit = cache.map[url];
    if (hit && (Date.now() - hit.t) < cache.ttl) return hit.html;
    var res = await ctx.xFetch(url);
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

    var titleMatch = html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([^<]+)<\/h1>/i) ||
                     html.match(/<title>([^–\-&#<]+)/i);
    var title = titleMatch ? this._stripTags(titleMatch[1]).replace(/ملوك الروايات/g, '').trim() : 'رواية';

    // Cover: look in .sertothumb img, then og:image, then wp-post-image
    var coverMatch = html.match(/<div[^>]*class="[^"]*sertothumb[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^">]+)"/i) ||
                     html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ||
                     html.match(/<img[^>]+class="[^"]*wp-post-image[^"]*"[^>]+src="([^">]+)"/i);
    var coverUrl = coverMatch ? coverMatch[1].trim() : undefined;

    // Author is inside .serl with الكاتب label
    var authorMatch = html.match(/الكاتب[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
    var author = authorMatch ? this._decodeEntities(authorMatch[1].trim()) : undefined;

    // Translator is inside .serl with المترجم label
    var translatorMatch = html.match(/المترجم[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
    if (translatorMatch) {
      var translator = this._decodeEntities(translatorMatch[1].trim());
      if (translator && !author) {
        author = 'المترجم: ' + translator;
      }
    }

    // Status: look for Completed/Ongoing span
    var statusMatch = html.match(/<span[^>]*class="[^"]*(Completed|Ongoing|Hiatus)[^"]*"[^>]*>([^<]+)<\/span>/i);
    var statusRaw = statusMatch ? statusMatch[1].toLowerCase() : '';
    var status;
    if (statusRaw === 'completed') status = 'مكتملة';
    else if (statusRaw === 'ongoing') status = 'مستمرة';
    else if (statusRaw === 'hiatus') status = 'متوقفة';
    else status = 'مستمرة';

    // Summary from .sersysn > .sersys.entry-content[itemprop="description"]
    var summary = undefined;
    var synopsisMatch = html.match(/<div[^>]*class="[^"]*sersysn[^"]*"[^>]*>[\s\S]*?<div[^>]*class="[^"]*sersys[^"]*entry-content[^"]*"[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/div>/i) ||
                      html.match(/<div[^>]*class="[^"]*sersysn[^"]*"[^>]*>[\s\S]*?<div[^>]*itemprop="description"[^>]*class="[^"]*sersys[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                      html.match(/<div[^>]*class="[^"]*sersys[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (synopsisMatch) {
      var block = synopsisMatch[1]
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
      summary = this._decodeEntities(this._stripTags(block)).replace(/[\s{]+$/g, '');
    }

    // Genres from .sertogenre
    var genres = [];
    var genreSection = html.match(/<div[^>]*class="[^"]*sertogenre[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (genreSection) {
      var genreRegex = /<a[^>]*>([^<]+)<\/a>/gi;
      var gm;
      while ((gm = genreRegex.exec(genreSection[1])) !== null) {
        genres.push(this._decodeEntities(gm[1].trim()));
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
  // Chapter list — inline on the novel page
  // ---------------------------------------------------------------
  parseChapterList: async function (novelUrl, ctx) {
    var fullUrl = this._absUrl(novelUrl);
    var html = await this._fetchNovelHtml(fullUrl, ctx);

    var chapters = [];
    // Chapters are in .eplister ul li elements (inside collapsible sections)
    var liRegex = /<li[^>]*data-ID="(\d+)"[^>]*>([\s\S]*?)<\/li>/gi;
    var match;
    while ((match = liRegex.exec(html)) !== null) {
      var block = match[2];
      var linkMatch = block.match(/<a[^>]+href="([^"]+)"[^>]*>/i);
      if (!linkMatch) continue;

      var chapterUrl = linkMatch[1].trim();
      // Chapter number from div.epl-num (e.g. "الفصل 1451: كلمة ختامية").
      // Prefer the number that follows "الفصل" so a volume number is not
      // mistaken for the chapter number.
      var numberMatch = block.match(/<div[^>]*class="[^"]*epl-num[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      var rawNum = numberMatch ? this._stripTags(numberMatch[1]) : '';
      var cleanNum = this._toLatinDigits(rawNum);
      var numParsed = cleanNum.match(/(?:الفصل\s*)?(\d+)/i);
      var chapterNumber = numParsed ? parseInt(numParsed[1], 10) : 0;

      // Chapter title from div.epl-title
      var titleMatch = block.match(/<div[^>]*class="[^"]*epl-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      var title = titleMatch ? this._decodeEntities(this._stripTags(titleMatch[1])) : '';

      // Fallback: if epl-num had no chapter number, the number may be missing
      // from the volume block and instead lead the title (e.g. "1235 نهاية...").
      if (!chapterNumber) {
        var cleanTitle = this._toLatinDigits(title);
        var titleNum = cleanTitle.match(/^(\d+)/);
        if (titleNum) {
          chapterNumber = parseInt(titleNum[1], 10);
          title = title.replace(/^[\s\u200E\u200F\u202A-\u202E]*\d+\s*/, '').trim();
        }
      }

      // Chapter date from div.epl-date or span.chapterdate
      var dateMatch = block.match(/<div[^>]*class="[^"]*epl-date[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                      block.match(/<span[^>]*class="[^"]*chapterdate[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      var rawDate = dateMatch ? this._stripTags(dateMatch[1]) : '';
      var uploadedAt = this._parseDate(rawDate);

      chapters.push({
        url: chapterUrl,
        number: chapterNumber,
        title: this._stripChapterPrefix(title),
        uploadedAt: uploadedAt
      });
    }

    // Fallback: parse from lastend first/last links if no inline chapters found
    if (chapters.length === 0) {
      var firstLink = html.match(/<div[^>]*class="[^"]*inepcx[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<span[^>]*class="[^"]*epcurfirst[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      if (firstLink) {
        chapters.push({
          url: firstLink[1].trim(),
          number: 1,
          title: this._decodeEntities(this._stripTags(firstLink[2]))
        });
      }
    }

    return this._finalizeChapters(chapters);
  },

  // ---------------------------------------------------------------
  // Chapter body
  // ---------------------------------------------------------------
  parseChapterContent: async function (chapterUrl, ctx) {
    var res = await ctx.xFetch(this._absUrl(chapterUrl));
    if (!res.ok) throw new Error('فشل جلب نص الفصل: ' + res.status);
    var html = res.text;

    // Content is in #kol_content.entry-content
    var contentMatch = html.match(/<div[^>]*id="kol_content"[^>]*>([\s\S]*?)<\/div>\s*<div/i) ||
                       html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*id="kol_content"[^>]*>([\s\S]*?)<\/div>/i) ||
                       html.match(/<div[^>]*id="kol_content"[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!contentMatch) throw new Error('تعذر العثور على نص الفصل');

    var rawContent = contentMatch[1];
    // Remove scripts, styles, ads, and hidden elements
    rawContent = rawContent.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    rawContent = rawContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    rawContent = rawContent.replace(/<i[^>]*id="Top_ad_s"[^>]*>[\s\S]*?<\/i>/gi, '');
    rawContent = rawContent.replace(/<div[^>]*class="[^"]*ad[s]?[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
    // Remove blockquote title headers (contain only the chapter title)
    rawContent = rawContent.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '\n');
    // Remove h2/h3/h4 heading tags
    rawContent = rawContent.replace(/<h[1-4][^>]*>[\s\S]*?<\/h[1-4]>/gi, '\n');

    // Extract paragraphs
    var paragraphs = [];
    var pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    var pMatch;
    while ((pMatch = pRegex.exec(rawContent)) !== null) {
      var text = this._decodeEntities(this._stripTags(pMatch[1]));
      if (!text) continue;
      // Skip footer markers
      if (/^(نهاية الفصل|تم الفصل|الفصل التالي|انتهى الفصل)/.test(text)) break;
      // Remove URL leaks (sponsor/source links)
      text = text.replace(/https?:\/\/\S+/g, '');
      // Remove leading chapter-heading prefixes: "الفصل N[:T]", "[ الفصل N]", "الفصل الـ N",
      // and Arabic-number words like "الفصل التاسع: ..."
      text = text.replace(/^\[?\s*(الفصل|فصل)\s+(الـ)?\s*\d+(?:\s*[:|].*)?\s*\]?\s*/i, '')
                 .replace(/^\s*\[\s*(الفصل|فصل)\s+(الـ)?\s*\d+\s*\]\s*/i, '')
                 .replace(/^\[?\s*(الفصل|فصل)\s+(الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)\s*[:|.]?\s*/i, '')
                 .replace(/^\[?\s*(الفصل|فصل)\s+(?:[أ-ي]{3,}\s+(?:و\s+)?)+[أ-ي]{3,}\s*:\s*/i, '')
                 .replace(/^\[?\s*(الفصل|فصل)\s+\S+:\s*/i, '');
      // Remove numeric-only headers: "N - Title", "N.md", standalone "N"
      text = text.replace(/^\d{1,6}\s*[-–:]\s*/, '')
                 .replace(/^\d{1,6}\.?md\.?\s*/i, '')
                 .replace(/^\d{1,6}$/, '');
      text = text.trim();
      if (!text) continue;
      paragraphs.push(text);
    }

    // Fallback: if no paragraphs found, try extracting from blockquotes
    if (paragraphs.length === 0) {
      var bqRegex = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi;
      var bqMatch;
      while ((bqMatch = bqRegex.exec(rawContent)) !== null) {
        var bqText = this._decodeEntities(this._stripTags(bqMatch[1]));
        if (bqText) paragraphs.push(bqText);
      }
    }

    // Final fallback: strip all tags
    if (paragraphs.length === 0) {
      return this._decodeEntities(rawContent.replace(/<[^>]+>/g, '\n').replace(/\s+\n/g, '\n').trim());
    }
    return paragraphs.join('\n\n');
  },

  // ---------------------------------------------------------------
  // Search / browse
  // ---------------------------------------------------------------
  searchNovels: async function (query, page, ctx) {
    var isBrowse = !query || !query.trim();
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    var url;
    if (isBrowse) {
      url = this._absUrl(pageNum > 1 ? '/page/' + pageNum + '/' : '/');
    } else {
      url = this._absUrl('/?s=' + encodeURIComponent(query.trim()) + (pageNum > 1 ? '&paged=' + pageNum : ''));
    }

    var res = await ctx.xFetch(url);
    if (!res.ok) return [];
    var html = res.text;
    var results = [];
    var seen = {};

    // Strategy 1: article.maindet cards (search results, /series/, and archive pages)
    var maindetRegex = /<article[^>]*class="[^"]*maindet[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
    var mdMatch;
    while ((mdMatch = maindetRegex.exec(html)) !== null) {
      var mdBlock = mdMatch[1];
      var mdLink = mdBlock.match(/<a[^>]+href="([^"]+\/series\/[^"]+)"[^>]*>/i);
      if (!mdLink) continue;
      var mdUrl = mdLink[1].trim();
      if (seen[mdUrl]) continue;
      seen[mdUrl] = true;

      var mdTitle = mdBlock.match(/<h2[^>]*itemprop="headline"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i) ||
                    mdBlock.match(/<h2[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i);
      var mdCover = mdBlock.match(/<img[^>]+src="([^">]+)"/i);
      var mdGenre = mdBlock.match(/<span[^>]*class="[^"]*mdgenre[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      var mdScore = mdBlock.match(/<span[^>]*class="[^"]*mdminf[^"]*"[^>]*>[\s\S]*?([\d.]+)/i);
      var mdCategory = 'روايات مترجمة';
      if (mdGenre) {
        var firstGenre = mdGenre[1].match(/<a[^>]*>([^<]+)<\/a>/i);
        if (firstGenre) mdCategory = firstGenre[1].replace(/^#\s*/, '').trim();
      }

      results.push({
        source: this.id,
        url: mdUrl,
        title: mdTitle ? this._decodeEntities(mdTitle[1].trim()) : '',
        coverUrl: mdCover ? mdCover[1].trim() : undefined,
        author: 'غير معروف',
        category: mdCategory,
        status: 'مستمرة',
        rating: mdScore ? parseFloat(this._toLatinDigits(mdScore[1])) : undefined
      });
    }

    // Strategy 2: .utao list items (homepage / paginated updates)
    var utaoRegex = /<div[^>]*class="[^"]*utao[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    var utaoMatch;
    while ((utaoMatch = utaoRegex.exec(html)) !== null) {
      var utaoBlock = utaoMatch[1];
      var utaoLink = utaoBlock.match(/<a[^>]+href="([^"]+\/series\/[^"]+)"[^>]*>/i);
      if (!utaoLink) continue;
      var utaoUrl = utaoLink[1].trim();
      if (seen[utaoUrl]) continue;
      seen[utaoUrl] = true;

      var utaoTitle = utaoBlock.match(/<h[23][^>]*>([^<]+)<\/h[23]>/i) || utaoBlock.match(/title="([^"]+)"/i);
      var utaoCover = utaoBlock.match(/<img[^>]+src="([^">]+)"/i);

      if (utaoTitle && utaoUrl) {
        results.push({
          source: this.id,
          url: utaoUrl,
          title: this._decodeEntities(this._stripTags(utaoTitle[1]).trim()),
          coverUrl: utaoCover ? utaoCover[1].trim() : undefined,
          author: 'غير معروف',
          category: 'روايات مترجمة',
          status: 'مستمرة'
        });
      }
    }

    // Strategy 3: .hotoday items (trending section)
    var hotRegex = /<div[^>]*class="[^"]*hotoday[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    var hotMatch;
    while ((hotMatch = hotRegex.exec(html)) !== null) {
      var hotBlock = hotMatch[1];
      var hotLink = hotBlock.match(/<a[^>]+href="([^"]+\/series\/[^"]+)"[^>]*>/i);
      if (!hotLink) continue;
      var hotUrl = hotLink[1].trim();
      if (seen[hotUrl]) continue;
      seen[hotUrl] = true;

      var hotTitle = hotBlock.match(/<div[^>]*class="[^"]*todtitle[^"]*"[^>]*>([^<]+)<\/div>/i) || hotBlock.match(/title="([^"]+)"/i);
      var hotCover = hotBlock.match(/<img[^>]+src="([^">]+)"/i);
      var hotScore = hotBlock.match(/<span[^>]*class="[^"]*todnum[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      var hotGen = hotBlock.match(/<div[^>]*class="[^"]*todgen[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      var hotCat = 'روايات مترجمة';
      if (hotGen) {
        var g = hotGen[1].match(/<a[^>]*>([^<]+)<\/a>/i);
        if (g) hotCat = g[1].trim();
      }
      var hotStat = hotBlock.match(/todstat\s+([^"]+)/i);
      var status = 'مستمرة';
      if (hotStat && /completed/i.test(hotStat[1])) status = 'مكتملة';
      else if (hotStat && /hiatus/i.test(hotStat[1])) status = 'متوقفة';

      results.push({
        source: this.id,
        url: hotUrl,
        title: hotTitle ? this._decodeEntities(this._stripTags(hotTitle[1]).trim()) : '',
        coverUrl: hotCover ? hotCover[1].trim() : undefined,
        author: 'غير معروف',
        category: hotCat,
        status: status,
        rating: hotScore ? parseFloat(this._toLatinDigits(hotScore[1])) : undefined
      });
    }

    // Strategy 4: article.bs > .bsx grid cards
    var bsxRegex = /<article[^>]*class="[^"]*bs[^"]*"[^>]*>\s*<div[^>]*class="[^"]*bsx[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/article>/gi;
    var bsxMatch;
    while ((bsxMatch = bsxRegex.exec(html)) !== null) {
      var bsxBlock = bsxMatch[1];
      var bsxLink = bsxBlock.match(/<a[^>]+href="([^"]+\/series\/[^"]+)"[^>]*>/i);
      if (!bsxLink) continue;
      var bsxUrl = bsxLink[1].trim();
      if (seen[bsxUrl]) continue;
      seen[bsxUrl] = true;

      var bsxTitle = bsxBlock.match(/<span[^>]*class="[^"]*ntitle[^"]*"[^>]*>([^<]+)<\/span>/i) ||
                     bsxBlock.match(/<h2[^>]*>([^<]+)<\/h2>/i);
      var bsxCover = bsxBlock.match(/<img[^>]+src="([^">]+)"/i);
      var bsxScore = bsxBlock.match(/<div[^>]*class="[^"]*numscore[^"]*"[^>]*>([^<]+)<\/div>/i);

      results.push({
        source: this.id,
        url: bsxUrl,
        title: bsxTitle ? this._decodeEntities(this._stripTags(bsxTitle[1]).trim()) : '',
        coverUrl: bsxCover ? bsxCover[1].trim() : undefined,
        author: 'غير معروف',
        category: 'روايات مترجمة',
        status: 'مستمرة',
        rating: bsxScore ? parseFloat(this._toLatinDigits(bsxScore[1])) : undefined
      });
    }

    return results;
  },

  getPopularNovels: async function (page, ctx) {
    return this.searchNovels('', page, ctx);
  }
});
