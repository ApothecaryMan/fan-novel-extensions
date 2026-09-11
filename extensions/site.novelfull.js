// site:novelfull — remote-JS extension for novelfull.com (English).
// Clean sandboxed scraper adhering to the Extension Runtime Specification (ctx.xFetch).
// Verified against live novelfull.com markup:
//   novel page  : /<slug>.html  (metadata + paginated chapter list)
//   chapter URL : /<slug>/chapter-<N>-<subtitle>.html
// Chapter titles are reported in "N title…" style, e.g. "1244 time undojfijijf".
registerExtension({
  id: 'site:novelfull',
  name: 'NovelFull',
  lang: 'en',
  version: '1.2.2',
  apiVersion: 1,
  baseUrl: 'https://novelfull.com',

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  _absUrl: function (url) {
    if (!url) return url;
    if (url.indexOf('http') === 0) return url;
    var base = this.baseUrl.replace(/\/$/, '');
    return base + (url.charAt(0) === '/' ? '' : '/') + url;
  },

  _stripTags: function (html) {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  },

  _extractImgSrc: function (tag) {
    if (!tag) return undefined;
    var m = tag.match(/\bdata-original\s*=\s*"([^"]+)"/i) ||
            tag.match(/\bdata-original\s*=\s*'([^']+)'/i) ||
            tag.match(/\bdata-lazy-src\s*=\s*"([^"]+)"/i) ||
            tag.match(/\bdata-lazy-src\s*=\s*'([^']+)'/i) ||
            tag.match(/\bdata-src\s*=\s*"([^"]+)"/i) ||
            tag.match(/\bdata-src\s*=\s*'([^']+)'/i) ||
            tag.match(/\bsrc\s*=\s*"([^"]+)"/i) ||
            tag.match(/\bsrc\s*=\s*'([^']+)'/i);
    if (!m) return undefined;
    var src = (m[1] || '').trim();
    if (!src || src.indexOf('data:') === 0 || src.indexOf('blank.') !== -1) return undefined;
    return src;
  },

  _extractCoverFromCard: function (card) {
    // Live markup puts src BEFORE class: <img src="..." class="cover" ...>.
    // So first find the <img> tag that carries the cover class (any attr order),
    // then pull src / data-src / data-original from it.
    var tagMatch = card.match(/<img[^>]*class="[^"]*cover[^"]*"[^>]*>/i);
    var src = this._extractImgSrc(tagMatch ? tagMatch[0] : null);
    if (src) return this._absUrl(src);
    // Fallback: first usable <img> in the card (search rows always carry one).
    var allImgs = card.match(/<img[^>]*>/gi) || [];
    for (var i = 0; i < allImgs.length; i++) {
      var s = this._extractImgSrc(allImgs[i]);
      if (s) return this._absUrl(s);
    }
    return undefined;
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
      ch.title = 'Chapter ' + num + (cleanName ? ' ' + cleanName : '');
      out.push(ch);
    }, this);
    return out;
  },

  _parseDate: function (raw) {
    if (!raw) return undefined;
    var s = String(raw).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!s) return undefined;
    var now = Date.now();

    if (/^\d+\s*(sec|secs|second|seconds)/.test(s)) return now;
    if (/^\d+\s*(min|mins|minute|minutes)(\s+ago)?/.test(s)) return now - parseInt(s.match(/(\d+)/)[1], 10) * 60 * 1000;
    if (/^\d+\s*(hour|hours|hr|hrs)(\s+ago)?/.test(s)) return now - parseInt(s.match(/(\d+)/)[1], 10) * 3600 * 1000;
    if (/^\d+\s*(day|days)(\s+ago)?/.test(s)) return now - parseInt(s.match(/(\d+)/)[1], 10) * 24 * 3600 * 1000;
    if (/^\d+\s*(week|weeks)(\s+ago)?/.test(s)) return now - parseInt(s.match(/(\d+)/)[1], 10) * 7 * 24 * 3600 * 1000;
    if (/^\d+\s*(month|months)(\s+ago)?/.test(s)) return now - parseInt(s.match(/(\d+)/)[1], 10) * 30 * 24 * 3600 * 1000;
    if (/^\d+\s*(year|years)(\s+ago)?/.test(s)) return now - parseInt(s.match(/(\d+)/)[1], 10) * 365 * 24 * 3600 * 1000;
    if (s.indexOf('yesterday') !== -1) return now - 24 * 3600 * 1000;
    if (s.indexOf('today') !== -1) return now;

    var parsed = Date.parse(s);
    if (!isNaN(parsed)) return parsed;
    return undefined;
  },

  // ---------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------
  parseNovelInfo: async function (url, ctx) {
    var fullUrl = this._absUrl(url);
    var html = await this._fetchCached(fullUrl, ctx);

    var title = (html.match(/<h3[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h3>/i) || [])[1];
    if (!title) title = (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) || [])[1];
    if (!title) title = (html.match(/<title>([^<]+)<\/title>/i) || [])[1];
    if (title) title = this._decodeEntities(this._stripTags(title)).replace(/\s*(\|Novelfull|- Novelfull)/i, '').trim();

    var infoHolderIdx = html.search(/class="[^"]*info-holder[^"]*"/i);
    var infoRegion = infoHolderIdx !== -1 ? html.slice(infoHolderIdx, infoHolderIdx + 8000) : html;
    var bookImgTag = infoRegion.match(/<div[^>]*class="[^"]*\bbook\b[^"]*"[^>]*>[\s\S]*?(<img[^>]*>)/i);
    var coverSrc = this._extractImgSrc(bookImgTag ? bookImgTag[1] : null);
    if (!coverSrc) {
      var coverImgTag = html.match(/<img[^>]*class="[^"]*cover[^"]*"[^>]*>/i);
      coverSrc = this._extractImgSrc(coverImgTag ? coverImgTag[0] : null);
    }
    var coverUrl;
    if (coverSrc) {
      coverUrl = coverSrc.indexOf('http') === 0 ? coverSrc : this._absUrl(coverSrc);
    } else {
      var ogImg = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
      if (ogImg) {
        var ogSrc = ogImg[1].trim();
        coverUrl = ogSrc.indexOf('http') === 0 ? ogSrc : this._absUrl(ogSrc);
      }
    }

    // info meta rows: "<div><h3>Field:</h3>value</div>"
    function metaRow(field) {
      var re = new RegExp('<div>\\s*<h3>' + field + ':</h3>([\\s\\S]*?)</div>', 'i');
      var m = html.match(re);
      return m ? m[1] : '';
    }

    var author = this._decodeEntities(this._stripTags(metaRow('Author')));

    // Parse multiple genres from the Genre meta row:
    //   <div><h3>Genre:</h3><a href="/genre/Action">Action</a>, <a href="/genre/Fantasy">Fantasy</a></div>
    var tags = [];
    var genreRow = metaRow('Genre');
    var genreTagRegex = /<a[^>]*href="[^"]*\/genre\/([^"\/]+)"[^>]*>([^<]+)<\/a>/gi;
    var gm;
    while ((gm = genreTagRegex.exec(genreRow)) !== null) {
      tags.push(this._decodeEntities(gm[2].trim()));
    }
    if (tags.length === 0) {
      // Fallback: plain text from metaRow (no <a> tags)
      var plainGenre = this._decodeEntities(this._stripTags(genreRow)).trim();
      if (plainGenre) tags = plainGenre.split(/,\s*/);
    }

    var status = 'مستمرة';
    var statusRaw = this._decodeEntities(this._stripTags(metaRow('Status')));
    if (/complete/i.test(statusRaw)) status = 'مكتملة';

    var summary = '';
    var sumMatch = html.match(/<div[^>]*class="[^"]*desc-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (sumMatch) summary = this._decodeEntities(this._stripTags(sumMatch[1]));

    var rating = parseFloat((html.match(/<span>(\d+(?:\.\d+)?)<\/span>/) || [])[1]);

    return {
      source: this.id,
      url: fullUrl,
      title: title || fullUrl,
      author: author || undefined,
      coverUrl: coverUrl,
      summary: summary || undefined,
      status: status,
      category: tags.length > 0 ? tags[0] : 'Translated Novels',
      tags: tags,
      rating: isNaN(rating) ? undefined : rating
    };
  },

  // ---------------------------------------------------------------
  // Chapter list — full list is paginated (/<slug>.html?page=N)
  // ---------------------------------------------------------------
  parseChapterList: async function (novelUrl, ctx) {
    var fullUrl = this._absUrl(novelUrl);
    // Normalize: strip trailing '?page=N' and base path so we can re-append page.
    var base = fullUrl.split('?')[0].replace(/\/$/, '');

    var html = await this._fetchCached(base, ctx);
    var pages = this._totalPages(html);

    var chapters = this._parseChapterPage(html);

    var self = this;
    var pageTasks = [];
    for (var p = 2; p <= pages; p++) {
      pageTasks.push(p);
    }
    var idx = 0;
    var concurrency = 4;
    var workers = [];
    var worker = async function () {
      while (idx < pageTasks.length) {
        var cur = pageTasks[idx++];
        var pageHtml = await self._fetch(base + '?page=' + cur, ctx);
        var pageChaps = self._parseChapterPage(pageHtml);
        if (pageChaps.length) chapters = chapters.concat(pageChaps);
      }
    };
    for (var w = 0; w < Math.min(concurrency, pageTasks.length); w++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    chapters = this._finalizeChapters(chapters);
    return chapters;
  },

  _fetch: async function (url, ctx) {
    var res = await ctx.xFetch(url);
    if (!res.ok) throw new Error('Failed to fetch: ' + res.status);
    return res.text;
  },

  // Tiny shared LRU cache for the (heavy, static) novel page, so parseNovelInfo and
  // parseChapterList don't each fetch the same HTML when the app calls them back to
  // back for one novel. Bounded and time-limited so the data can't go stale. Every
  // page share differs by URL so only the repeated novel URL is deduped.
  _novelCache: { ttl: 5 * 60 * 1000, cap: 8, map: Object.create(null) },

  _fetchCached: async function (url, ctx) {
    var cache = this._novelCache;
    var key = url.replace(/\/$/, '') || url;
    var hit = cache.map[key];
    if (hit && (Date.now() - hit.t) < cache.ttl) return hit.html;
    var html = await this._fetch(url, ctx);
    cache.map[key] = { t: Date.now(), html: html };
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

  _totalPages: function (html) {
    var input = html.match(/<input[^>]*id="total-page"[^>]*value="(\d+)"/i);
    if (input) return parseInt(input[1], 10);
    var last = html.match(/class="last"[^>]*>[\s\S]*?href="[^"]*\?page=(\d+)"/i) ||
               html.match(/<a[^>]+href="[^"]*\?page=(\d+)"[^>]*>\s*Last\s*<\/a>/i);
    if (last) return parseInt(last[1], 10);
    return 1;
  },

  _extractChapterDate: function (liBlock) {
    if (!liBlock) return undefined;
    // <time datetime="...">2024-01-02 ...</time> — prefer machine-readable attr.
    var dt = liBlock.match(/<time[^>]+datetime="([^"]+)"/i);
    if (dt) {
      var parsedDt = this._parseDate(dt[1]);
      if (parsedDt !== undefined) return parsedDt;
    }
    // Explicit date/time spans some mirrors render next to the chapter link.
    var span = liBlock.match(/<span[^>]*class="[^"]*(?:chapter-time|chapter-date|time|date|update-time|updated)[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    if (span) {
      var parsedSpan = this._parseDate(this._stripTags(span[1]));
      if (parsedSpan !== undefined) return parsedSpan;
    }
    return undefined;
  },

  _parseChapterPage: function (html) {
    var chapters = [];
    // Only the full paginated list: <ul class="list-chapter"> ... <li><a href=".."><span class="chapter-text">Chapter N: T</span></a></li>
    // Parse per-<li> so a date rendered inside the same row (<time>, .chapter-time)
    // can be attached to its chapter as uploadedAt.
    var listStart = html.indexOf('id="list-chapter"');
    var region = listStart !== -1 ? html.slice(listStart) : html;
    var liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    var liMatch;
    var fallbackItems = [];
    while ((liMatch = liRegex.exec(region)) !== null) {
      var li = liMatch[1];
      var aMatch = li.match(/<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<span[^>]*class="[^"]*chapter-text[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      if (!aMatch) continue;
      var href = aMatch[1].trim();
      if (href.indexOf('chapter-') === -1 && !/chapter/i.test(href)) continue;
      var rawTitle = this._decodeEntities(this._stripTags(aMatch[2]));

      var numParsed = rawTitle.match(/(?:^|\b)chapter\s*[:.#\-–—]?\s*(\d+)/i) || rawTitle.match(/(\d+)\s*[:.\-–—]/);
      var chapterNumber = numParsed ? parseInt(numParsed[1], 10) : 0;

      var title = this._stripChapterPrefix(rawTitle);
      var uploadedAt = this._extractChapterDate(li);

      var item = { url: this._absUrl(href), number: chapterNumber, title: title };
      if (uploadedAt !== undefined) item.uploadedAt = uploadedAt;
      chapters.push(item);
    }
    if (chapters.length > 0) return chapters;
    // Fallback for markup without <li> wrappers.
    var itemRegex = /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<span[^>]*class="[^"]*chapter-text[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
    var match;
    while ((match = itemRegex.exec(region)) !== null) {
      var href2 = match[1].trim();
      if (href2.indexOf('chapter-') === -1 && !/chapter/i.test(href2)) continue;
      var rawTitle2 = this._decodeEntities(this._stripTags(match[2]));

      var numParsed2 = rawTitle2.match(/(?:^|\b)chapter\s*[:.#\-–—]?\s*(\d+)/i) || rawTitle2.match(/(\d+)\s*[:.\-–—]/);
      var chapterNumber2 = numParsed2 ? parseInt(numParsed2[1], 10) : 0;

      var title2 = this._stripChapterPrefix(rawTitle2);

      fallbackItems.push({ url: this._absUrl(href2), number: chapterNumber2, title: title2 });
    }
    return fallbackItems.length ? fallbackItems : chapters;
  },

  // ---------------------------------------------------------------
  // Chapter body
  // ---------------------------------------------------------------
  parseChapterContent: async function (chapterUrl, ctx) {
    var res = await ctx.xFetch(this._absUrl(chapterUrl));
    if (!res.ok) throw new Error('Failed to fetch chapter: ' + res.status);
    var html = res.text;

    var panelMatch = html.match(/<div[^>]*id="chapter-content"[^>]*>([\s\S]*?)(?=<hr class="chapter-end"|<div class="chapter-nav|<a[^>]*id="(?:next_chap|prev_chap)")/i);
    if (!panelMatch) {
      panelMatch = html.match(/<div[^>]*class="[^"]*chapter-c[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    }
    if (!panelMatch) throw new Error('Chapter content not found');

    var raw = panelMatch[1];
    raw = raw.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    raw = raw.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    raw = raw.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '');
    raw = raw.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '');
    raw = raw.replace(/<ins[^>]*>[\s\S]*?<\/ins>/gi, '');
    raw = raw.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '');
    raw = raw.replace(/<div[^>]*class="[^"]*(?:ads\d*|adsbygoogle|advert|container-ads|inlinead|ads-area)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');

    // Strip the inline "Chapter N: Title" heading that repeats inside content.
    var paragraphs = [];
    var pRegex = /<(?:p|h3|h4)[^>]*>([\s\S]*?)<\/(?:p|h3|h4)>/gi;
    var pm;
    while ((pm = pRegex.exec(raw)) !== null) {
      var text = this._decodeEntities(this._stripTags(pm[1]));
      if (!text) continue;
      if (paragraphs.length === 0 && /^chapter\s*\d+\b/i.test(text) && !/^\d+\s*$/i.test(text)) continue;
      if (/^(the end\b|end of the chapter|next chapter|you are reading)/i.test(text)) break;
      paragraphs.push(text);
    }

    if (paragraphs.length === 0) {
      return this._decodeEntities(raw.replace(/<[^>]+>/g, '\n').replace(/\s+\n/g, '\n').trim());
    }
    return paragraphs.join('\n\n');
  },

  // ---------------------------------------------------------------
  // Search / browse (shared row markup)
  // ---------------------------------------------------------------
  _parseNovelRows: function (html) {
    var results = [];
    // each novel card is a <div class="row"> block; slice each to the next one
    var parts = [];
    var re = /<div class="row">/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var end = html.indexOf('<div class="row">', m.index + 15);
      parts.push(end === -1 ? html.slice(m.index) : html.slice(m.index, end));
    }
    if (parts.length === 0) {
      var aRe = /<h3[^>]*class="[^"]*truyen-title[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi;
      var am;
      while ((am = aRe.exec(html)) !== null) {
        parts.push(am[0]);
      }
    }
    return this._buildRows(parts);
  },

  _buildRows: function (cards) {
    var results = [];
    for (var r = 0; r < cards.length; r++) {
      var card = cards[r];
      var link = card.match(/<h3[^>]*class="[^"]*truyen-title[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/i);
      if (!link) continue;
      var novelUrl = this._absUrl(link[1].trim());
      var title = this._decodeEntities(this._stripTags(link[2]));
      if (!title) continue;

      var coverUrl = this._extractCoverFromCard(card);
      var authorMatch = (card.match(/class="[^"]*author[^"]*"[^>]*>[\s\S]*?glyphicon[^"]*"[^>]*>[\s\S]*?<\/span>([\s\S]*?)<\/span>/i) || ['', ''])[1];
      var author = authorMatch ? this._decodeEntities(this._stripTags(authorMatch)) : '';
      var statusStatus = card.match(/href="[^"]*\/status\/([^"]+)"/i);
      var statusRaw = statusStatus ? statusStatus[1] : '';

      results.push({
        source: this.id,
        url: novelUrl,
        title: title,
        coverUrl: coverUrl,
        author: author || 'Unknown',
        category: 'Translated Novels',
        status: (statusRaw && /complete/i.test(statusRaw)) ? 'مكتملة' : 'مستمرة'
      });
    }
    return results;
  },

  searchNovels: async function (query, page, ctx) {
    var isBrowse = !query || !query.trim();
    var url;
    if (isBrowse) {
      url = this._absUrl('/most-popular');
    } else {
      url = this._absUrl('/search?keyword=' + encodeURIComponent(query.trim()));
    }
    var res = await ctx.xFetch(url);
    if (!res.ok) return [];
    return this._parseNovelRows(res.text);
  },

  getPopularNovels: async function (page, ctx) {
    var res = await ctx.xFetch(this._absUrl('/most-popular'));
    if (!res.ok) return [];
    return this._parseNovelRows(res.text);
  },

  // ---------------------------------------------------------------
  // Categories / genres
  // ---------------------------------------------------------------
  // Scrape the Genre dropdown nav from the home page:
  //   <div class="dropdown-menu multi-column"> .col-md-4 > ul > li > a[href="/genre/<Name>"]
  getCategories: async function (ctx) {
    var res = await ctx.xFetch(this._absUrl('/'));
    if (!res.ok) return [];
    var html = res.text;
    var categories = [];
    var seen = {};
    var re = /<a[^>]+href="\/genre\/([^"\/]+)"[^>]*>([^<]+)<\/a>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var slug = decodeURIComponent(m[1].replace(/\+/g, ' '));
      var name = this._decodeEntities(m[2].trim());
      if (!name || seen[name]) continue;
      seen[name] = true;
      categories.push({ name: name, slug: slug });
    }
    return categories;
  },

  // Browse novels filtered by a genre.
  // URL: /genre/<Slug>  (same layout as /most-popular, parsed by _parseNovelRows)
  getCategoryNovels: async function (categorySlug, page, ctx) {
    // Slug is the raw URL segment (e.g. "Gender+Bender", "Harem", "Sci-fi").
    // If the caller passes a human-readable name, convert spaces to '+'.
    var slug = (categorySlug || '').replace(/\s+/g, '+');
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    var url = this._absUrl('/genre/' + slug);
    if (pageNum > 1) url += '?page=' + pageNum;
    var res = await ctx.xFetch(url);
    if (!res.ok) return [];
    return this._parseNovelRows(res.text);
  }
});