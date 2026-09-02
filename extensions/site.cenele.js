// site:cenele — remote-JS extension for فضاء الروايات (cenele.com)
// Clean sandboxed scraper adhering to the Extension Runtime Specification (ctx.xFetch).
// Chapter lists are lazy: the novel page only renders the last 8, the full list is
// fetched over admin-ajax (nhv_manga_single_chapters_page). Host never opens sockets.
registerExtension({
  id: 'site:cenele',
  name: 'فضاء الروايات',
  lang: 'ar',
  version: '1.5.7',
  apiVersion: 1,
  baseUrl: 'https://cenele.com',

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
      hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
      ldquo: '“', rdquo: '”', middot: '·', bull: '•'
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
      .replace(/[\u066C\u066D\u060C,]/g, '');
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

  _parseDate: function (raw) {
    if (!raw) return undefined;
    var str = this._toLatinDigits(String(raw).trim());
    if (!str) return undefined;

    var now = Date.now();

    // Note: always return the raw epoch-ms timestamp. `uploadedAt` is typed as
    // `number` (NovelSource.ts / remoteSourceAdapter.ts) — formatting timestamps
    // to a "DD/MM/YY" string here would drop them entirely on device, so the
    // display layer is responsible for rendering friendly dates.

    // 1. Relative Arabic patterns — supports both "منذ N وحدة" and "N وحدة منذ",
    // Latin digits, Arabic digit words, and dual forms (يومين / ساعتين / …).
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

  _ajaxPost: function (url, data, ctx) {
    var body = [];
    for (var k in data) {
      if (Object.prototype.hasOwnProperty.call(data, k)) {
        body.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(data[k])));
      }
    }
    return ctx.xFetch({
      url: url,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body.join('&')
    });
  },

  _nhvProps: function (html) {
    var idx = html.indexOf('nhvNovelV2');
    if (idx === -1) return null;
    var region = html.slice(Math.max(0, idx), Math.min(html.length, idx + 1600));
    var postId = (region.match(/"postId"\s*:\s*"(\d+)"/) || [])[1];
    var chaptersNonce = (region.match(/"chaptersNonce"\s*:\s*"([^"]+)"/) || [])[1];
    var ajaxUrl = (region.match(/"ajaxurl"\s*:\s*"([^"]+)"/) || [])[1];
    if (!postId || !chaptersNonce || !ajaxUrl) return null;
    return { postId: postId, chaptersNonce: chaptersNonce, ajaxUrl: ajaxUrl };
  },

  _parseChapterRows: function (html) {
    var chapters = [];
    var regex = /<li[^>]*data-chapter-id="(\d+)"[^>]*class="[^"]*wp-manga-chapter[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    var match;
    while ((match = regex.exec(html)) !== null) {
      var block = match[2];
      var linkMatch = block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;
      var rawTitle = this._stripTags(linkMatch[2]);
      var cleanTitle = this._toLatinDigits(rawTitle);

      var numMatch = cleanTitle.match(/(?:الفصل|فصل|Chapter|Ch\.?)\s*(\d+(?:\.\d+)?)/i);
      var chapterNumber = numMatch ? parseFloat(numMatch[1]) : 0;
      if (!chapterNumber) {
        var numFallback = cleanTitle.match(/(\d+(?:\.\d+)?)/);
        chapterNumber = numFallback ? parseFloat(numFallback[1]) : 0;
      }

      var dateMatch = block.match(/<span[^>]*class="[^"]*chapter-release-date[^"]*"[^>]*>([\s\S]*?)<\/span>/i) ||
                      block.match(/<i>([\s\S]*?)<\/i>/i);
      var rawDate = dateMatch ? this._stripTags(dateMatch[1]) : '';
      var uploadedAt = this._parseDate(rawDate);

      chapters.push({
        url: linkMatch[1].trim(),
        number: chapterNumber,
        title: this._stripChapterPrefix(rawTitle),
        uploadedAt: uploadedAt
      });
    }
    return chapters;
  },

  // ---------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------
  parseNovelInfo: async function (url, ctx) {
    var fullUrl = this._absUrl(url);
    var res = await ctx.xFetch(fullUrl);
    if (!res.ok) throw new Error('فشل جلب تفاصيل الرواية: ' + res.status);
    var html = res.text;

    var titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/<title>([^–\-&#<]+)/i);
    var title = titleMatch ? this._stripTags(titleMatch[1]).replace(/فضاء الروايات/g, '').trim() : 'رواية';

    var coverMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ||
                     html.match(/<div[^>]*class="[^"]*nhv-novel-cover[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^">]+)"/i) ||
                     html.match(/<img[^>]+class="[^"]*wp-post-image[^"]*"[^>]+src="([^">]+)"/i);
    var coverUrl = coverMatch ? coverMatch[1].trim() : undefined;

    // Author is a /cont-author/<slug>/ link (slug = original name, possibly
    // URL-encoded Arabic); translator lives on /cont-artist/<slug>/.
    var authorSlug = (html.match(/https?:\/\/[^"\s]+\/cont-author\/([^"\/\?#]+)/i) || [])[1];
    var author = authorSlug
      ? decodeURIComponent(authorSlug).replace(/[-_]+/g, ' ').trim()
      : undefined;
    if (!author) {
      var artistSlug = (html.match(/https?:\/\/[^"\s]+\/cont-artist\/([^"\/\?#]+)/i) || [])[1];
      if (artistSlug) {
        author = 'المترجم: ' + decodeURIComponent(artistSlug).replace(/[-_]+/g, ' ').trim();
      }
    }

    var isCompleted = html.indexOf('مكتملة') !== -1 && html.indexOf('مستمرة') === -1;
    var status = isCompleted ? 'مكتملة' : 'مستمرة';

    var summary = undefined;
    var synopsisMatch = html.match(/<div[^>]*class="[^"]*nhv-novel-synopsis[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (synopsisMatch) {
      var block = synopsisMatch[1]
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
      var cut = block.search(/دعم المترجم|إقرأ وأكتب تعليقات|اقرأ وأكتب تعليقات|أكتب تعليقات/i);
      if (cut !== -1) block = block.slice(0, cut);
      summary = this._decodeEntities(this._stripTags(block)).replace(/[\s{]+$/g, '');
    }

    return {
      source: this.id,
      url: fullUrl,
      title: title,
      author: author,
      coverUrl: coverUrl,
      summary: summary,
      status: status,
      // The novel page only renders the last ~8 chapters inline; reporting that
      // lazy preview count as `totalChapters` makes the app show "8 chapters"
      // for every novel. Leave it undefined so the caller falls back to the real
      // full list returned by parseChapterList.
      totalChapters: undefined,
      category: 'روايات مترجمة'
    };
  },

  // ---------------------------------------------------------------
  // Chapter list — full list is lazy (admin-ajax)
  // ---------------------------------------------------------------
  parseChapterList: async function (novelUrl, ctx) {
    var fullUrl = this._absUrl(novelUrl);
    var res = await ctx.xFetch(fullUrl);
    if (!res.ok) throw new Error('فشل جلب قائمة الفصول: ' + res.status);
    var html = res.text;

    // Fallback: parse whatever chapter rows shipped in the page (usually the last 8).
    var fallbackChapters = this._parseChapterRows(html);
    var props = this._nhvProps(html);
    if (!props) return this._finalizeChapters(fallbackChapters);

    var nonce = props.chaptersNonce;
    var nonceRefreshed = false;
    var sleep = function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };

    // Fetch page 1 with volume: '-1' (covers all volumes seamlessly and provides exact total)
    var page1Res = null;
    for (var attempt = 0; attempt < 5; attempt++) {
      var r = await this._ajaxPost(props.ajaxUrl, {
        action: 'nhv_manga_single_chapters_page',
        nonce: nonce,
        manga_id: props.postId,
        volume: '-1',
        page: '1',
        per_page: '100',
        order: 'asc'
      }, ctx);
      if (r.status === 403 && !nonceRefreshed) {
        var ref = await this._ajaxPost(props.ajaxUrl, { action: 'nhv_refresh_front_nonces' }, ctx);
        var refJ = JSON.parse(ref.text || '{}');
        if (refJ.data && refJ.data.chapters_nonce) {
          nonce = refJ.data.chapters_nonce;
          nonceRefreshed = true;
        }
        continue;
      }
      if (r.status === 403 || r.status === 429 || r.status === 503 || !r.ok) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      page1Res = JSON.parse(r.text || '{}');
      break;
    }

    if (!page1Res || !page1Res.html) return this._finalizeChapters(fallbackChapters);

    var collected = [page1Res.html];
    var totalChapters = parseInt(page1Res.total, 10) || 0;
    var perPage = parseInt(page1Res.per_page, 10) || 100;
    var totalPages = totalChapters > 0 ? Math.ceil(totalChapters / perPage) : (page1Res.has_more ? 2 : 1);

    for (var p = 2; p <= totalPages; p++) {
      var pageJson = null;
      for (var attemptNum = 0; attemptNum < 5; attemptNum++) {
        var pr = await this._ajaxPost(props.ajaxUrl, {
          action: 'nhv_manga_single_chapters_page',
          nonce: nonce,
          manga_id: props.postId,
          volume: '-1',
          page: String(p),
          per_page: '100',
          order: 'asc'
        }, ctx);
        if (pr.status === 403 && !nonceRefreshed) {
          var ref2 = await this._ajaxPost(props.ajaxUrl, { action: 'nhv_refresh_front_nonces' }, ctx);
          var refJ2 = JSON.parse(ref2.text || '{}');
          if (refJ2.data && refJ2.data.chapters_nonce) {
            nonce = refJ2.data.chapters_nonce;
            nonceRefreshed = true;
          }
          continue;
        }
        if (pr.status === 403 || pr.status === 429 || pr.status === 503 || !pr.ok) {
          await sleep(700 * (attemptNum + 1));
          continue;
        }
        pageJson = JSON.parse(pr.text || '{}');
        break;
      }
      if (pageJson && pageJson.html) {
        collected.push(pageJson.html);
      }
      await sleep(100);
    }

    var allChapters = [];
    collected.forEach((function (pageHtml) {
      this._parseChapterRows(pageHtml).forEach(function (ch) {
        allChapters.push(ch);
      });
    }).bind(this));

    if (allChapters.length === 0) return this._finalizeChapters(fallbackChapters);

    return this._finalizeChapters(allChapters);
  },

  // ---------------------------------------------------------------
  // Chapter body
  // ---------------------------------------------------------------
  parseChapterContent: async function (chapterUrl, ctx) {
    var res = await ctx.xFetch(this._absUrl(chapterUrl));
    if (!res.ok) throw new Error('فشل جلب نص الفصل: ' + res.status);
    var html = res.text;
    var panelMatch = html.match(/<reading-panel[^>]*>([\s\S]*?)<\/reading-panel>/i) ||
                     html.match(/<div[^>]*class="[^"]*reading-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!panelMatch) throw new Error('تعذر العثور على نص الفصل');

    var rawContent = panelMatch[1];
    rawContent = rawContent.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    rawContent = rawContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    rawContent = rawContent.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '');
    rawContent = rawContent.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '');

    var paragraphs = [];
    // cenele lays the chapter body out in block elements (mostly <div>, sometimes
    // <p>/<li>), so extract from any block container instead of <p>-only.
    var blockRegex = /<(?:div|p|li|h[1-6])[^>]*>([\s\S]*?)<\/(?:div|p|li|h[1-6])>/gi;
    var blockMatch;
    while ((blockMatch = blockRegex.exec(rawContent)) !== null) {
      var text = this._decodeEntities(this._stripTags(blockMatch[1]));
      if (!text) continue;
      if (/^(نهاية الفصل|تم الفصل|الفصل التالي|انتهى الفصل|النهاية|تمت)/.test(text)) break;
      // Skip decorative ornament lines and the arabic basmala preamble.
      if (/^[-ـ—_]{3,}$/.test(text)) continue;
      if (/^بسم الله/.test(text)) continue;
      // Drop "المترجم : ..." / "ترجمة ..." credit lines.
      text = text.replace(/^\s*(المترجم|مترجم|الترجمة|ترجمة)\s*[:|]?\s*[^\n]*$/i, '').trim();
      if (!text) continue;
      // Drop the chapter-title header block entirely ("الفصل 663: لا، دانييل",
      // "Chapter 1: Name") so the name is not repeated beneath the title.
      // Otherwise just strip a leading prefix for blocks that begin with one.
      if (/^(?:chapter|ch\.?|فصل|الفصل)\s*\d+(?:\s*[:—|.-]|\s+)[^\n]*$/i.test(text)) {
        continue;
      }
      text = text.replace(/^\[?\s*(?:chapter|ch\.?|فصل|الفصل)\s*\d+(?:\s*[:—|.-]\s*|\s+)/i, '')
        .trim();
      if (!text) continue;
      paragraphs.push(text);
    }

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
      url = this._absUrl(pageNum > 1 ? '/cont/page/' + pageNum + '/' : '/cont/') + '?m_orderby=views';
    } else {
      url = this._absUrl('/?s=' + encodeURIComponent(query.trim()) + '&post_type=wp-manga' + (pageNum > 1 ? '&paged=' + pageNum : ''));
    }

    var res = await ctx.xFetch(url);
    if (!res.ok) return [];
    var html = res.text;
    var results = [];

    // Grid cards (browse + genre/search pages that use nhv-library-card)
    var cardRegex = /<article class="nhv-library-card">([\s\S]*?)<\/article>/gi;
    var cardMatch;
    while ((cardMatch = cardRegex.exec(html)) !== null) {
      var cardBlock = cardMatch[1];
      var linkMatch = cardBlock.match(/<h2 class="nhv-library-card__title">\s*<a href="([^"]+)">([^<]+)<\/a>/i) ||
                      cardBlock.match(/<a class="nhv-library-card__cover" href="([^"]+)"[^>]*aria-label="([^"]*)"/i);
      if (!linkMatch) continue;
      var novelUrl = linkMatch[1].trim();
      var title = this._decodeEntities((linkMatch[2] || '').trim());

      var coverMatch = cardBlock.match(/<img[^>]+src="([^">]+)"/i);
      var coverUrl = coverMatch ? coverMatch[1].trim() : undefined;

      var chip = (cardBlock.match(/class="[^"]*nhv-library-card__chip[^"]*"[^>]*>([\s\S]*?)<\/span>/i) || ['', ''])[1];
      chip = this._stripTags(chip);
      var cleanChip = this._toLatinDigits(chip);
      var chapMatch = cleanChip.match(/(\d+)\s*فصل/i);
      var totalChapters = chapMatch ? parseInt(chapMatch[1], 10) : 0;

      var excerptMatch = cardBlock.match(/<p class="nhv-library-card__excerpt">([^<]+)<\/p>/i);
      var summary = excerptMatch ? this._decodeEntities(excerptMatch[1].trim()) : '';

      var genreMatch = cardBlock.match(/<div class="nhv-library-card__genres">([\s\S]*?)<\/div>/i);
      var category = 'روايات مترجمة';
      if (genreMatch) {
        var firstGenre = genreMatch[1].match(/<a[^>]*>([^<]+)<\/a>/i);
        if (firstGenre) category = firstGenre[1].trim();
      }

      var statusMatch = cardBlock.match(/nhv-library-card__status[^>]*>([^<]+)<\/span>/i);
      var status = statusMatch ? statusMatch[1].trim() : 'مستمرة';

      results.push({
        source: this.id,
        url: novelUrl,
        title: title,
        coverUrl: coverUrl,
        author: 'غير معروف',
        category: category,
        totalChapters: totalChapters,
        summary: summary,
        status: status
      });
    }

    // Fallback: standard madara c-tabs-item rows (real search results / ?s=...&post_type=wp-manga)
    if (results.length === 0) {
      var rowRegex = /<div[^>]*class="[^"]*row c-tabs-item__content[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*row c-tabs-item__content[^"]*"|$)/gi;
      var rowMatch;
      while ((rowMatch = rowRegex.exec(html)) !== null) {
        var block = rowMatch[1];
        var mLink = block.match(/<h3[^>]*class="[^"]*h4[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/i);
        if (!mLink) continue;
        var mStatusMatch = block.match(/mg_status[^>]*>[\s\S]*?<div class="summary-content">([\s\S]*?)<\/div>/i);
        var mStatus = mStatusMatch ? this._stripTags(mStatusMatch[1]) : '';
        mStatus = mStatus.replace(/^(OnGoing|Ongoing|Ongoing)$/i, 'مستمرة')
          .replace(/^(Completed|Complete)$/i, 'مكتملة')
          .replace(/^(OnHold|Dropped)$/i, 'مستمرة');
        results.push({
          source: this.id,
          url: mLink[1].trim(),
          title: this._decodeEntities(mLink[2].trim()),
          coverUrl: (block.match(/<img[^>]+src="([^">]+)"/i) || [])[1] || undefined,
          author: (block.match(/mg_author[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i) || [])[1] || 'غير معروف',
          category: (block.match(/mg_genres[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i) || [])[1] || 'روايات مترجمة',
          status: mStatus || 'مستمرة'
        });
      }
    }

    return results;
  },

  getPopularNovels: async function (page, ctx) {
    return this.searchNovels('', page, ctx);
  }
});