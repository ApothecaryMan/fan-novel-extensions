// site:wuxiaworld — remote-JS extension for WuxiaWorld (English).
// Scrapes the server-rendered lite site (lite.wuxiaworld.com): the main
// www site is a JS-only React SPA with an empty shell, so www novel URLs are
// transparently rewritten to lite for fetching.
// Verified against live lite markup:
//   novel page  : /novel/<slug> (meta line + 100-chapter TOC pages ?toc=N)
//   chapter URL : /novel/<slug>/<chapter-slug>
//   browse      : /novels (sort + cursor pager ?after=N)
//   search      : /novels?q=<keyword>
// The site publishes no per-chapter dates, so chapters carry no uploadedAt —
// a missing date must never read as "released today" (Today timeline only
// lists chapters with a real release date).
registerExtension({
  id: 'site:wuxiaworld',
  name: 'WuxiaWorld',
  lang: 'en',
  version: '1.0.0',
  apiVersion: 1,
  baseUrl: 'https://lite.wuxiaworld.com',

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  _absUrl: function (url) {
    if (!url) return url;
    // Rewrite www links to the scrapable lite host.
    var m = String(url).match(/^https?:\/\/(?:www\.)?wuxiaworld\.com(\/.*)?$/i);
    if (m) return 'https://lite.wuxiaworld.com' + (m[1] || '/');
    if (url.indexOf('http') === 0) return url;
    var base = this.baseUrl.replace(/\/$/, '');
    return base + (url.charAt(0) === '/' ? '' : '/') + url;
  },

  _stripTags: function (html) {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  },

  _decodeEntities: function (str) {
    if (!str) return '';
    var named = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
      hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
      ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
      middot: '·', bull: '•', copy: '©', reg: '®', trade: '™',
      dagger: '†', Dagger: '‡', prime: '′', Prime: '″',
      oelig: 'œ', OElig: 'Œ', scaron: 'š', Scaron: 'Š'
    };
    var res = String(str).replace(/&amp;/gi, '&');
    res = res.replace(/&([a-zA-Z][a-zA-Z0-9]*|#[xX]?[0-9a-fA-F]+);/g, function (m, name) {
      var low = name.toLowerCase();
      var cp = null;
      if (low.charAt(0) === '#') {
        var hex = low.charAt(1) === 'x';
        cp = parseInt(low.substring(hex ? 2 : 1), hex ? 16 : 10);
      } else {
        for (var k in named) {
          if (Object.prototype.hasOwnProperty.call(named, k) && k.toLowerCase() === low) {
            cp = named[k].charCodeAt(0);
            break;
          }
        }
        if (cp === null) return m;
      }
      if (!cp || cp < 0 || cp > 0x10FFFF) return m;
      if (cp > 0xFFFF) {
        cp -= 0x10000;
        return String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      }
      return String.fromCharCode(cp);
    });
    return res;
  },

  _stripChapterPrefix: function (name) {
    var m = (name || '').trim();
    m = m.replace(/^(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)\s*(?:[-–—:.#|]\s*)?/i, '');
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
      ch.title = 'Chapter ' + num + (cleanName ? ' ' + cleanName : '');
      out.push(ch);
    }, this);
    return out;
  },

  _mapStatus: function (raw) {
    var s = (raw || '').trim().toLowerCase();
    if (/complet/.test(s)) return 'مكتملة';
    if (/hiatus/.test(s)) return 'متوقفة';
    return 'مستمرة';
  },

  // ---------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------
  parseNovelInfo: async function (url, ctx) {
    var fullUrl = this._absUrl(url).split('?')[0];
    var html = await this._fetchCached(fullUrl, ctx);

    if (/<h1>\s*Not found\s*<\/h1>/i.test(html)) throw new Error('Novel not found');

    var titleMatch = html.match(/<div[^>]*class="[^"]*novel-head[^"]*"[^>]*>[\s\S]*?<h1[^>]*>([^<]+)<\/h1>/i) ||
                     html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    var title = titleMatch ? this._decodeEntities(this._stripTags(titleMatch[1])) : '';

    var coverTag = html.match(/<div[^>]*class="[^"]*novel-head[^"]*"[^>]*>[\s\S]*?(<img[^>]*>)/i);
    var coverUrl;
    if (coverTag) {
      var srcMatch = coverTag[1].match(/\bsrc\s*=\s*"([^"]+)"/i) || coverTag[1].match(/\bsrc\s*=\s*'([^']+)'/i);
      if (srcMatch) coverUrl = srcMatch[1].trim();
    }

    // "<p class="muted small">Ongoing · Author: X · Translator: Y · 6773 chapters</p>"
    var author, translator, totalChapters;
    var status = 'مستمرة';
    var metaMatch = html.match(/<div[^>]*class="[^"]*novel-head[^"]*"[^>]*>[\s\S]*?<p[^>]*class="[^"]*muted[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    if (metaMatch) {
      var metaText = this._decodeEntities(this._stripTags(metaMatch[1]));
      var parts = metaText.split('·');
      if (parts.length > 0) status = this._mapStatus(parts[0]);
      for (var i = 1; i < parts.length; i++) {
        var seg = parts[i].trim();
        var am = seg.match(/^Author\s*:\s*(.+)$/i);
        if (am) { author = am[1].trim(); continue; }
        var tm = seg.match(/^Translator\s*:\s*(.+)$/i);
        if (tm) { translator = tm[1].trim(); continue; }
        var cm = seg.match(/([\d,]+)\s*chapters?/i);
        if (cm) totalChapters = parseInt(cm[1].replace(/,/g, ''), 10);
      }
    }

    var summary;
    var sumMatch = html.match(/<h2[^>]*>\s*Synopsis\s*<\/h2>\s*<div[^>]*class="[^"]*chapter-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (sumMatch) {
      var block = sumMatch[1]
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
      var paras = [];
      var pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
      var pm;
      while ((pm = pRe.exec(block)) !== null) {
        var pt = this._decodeEntities(this._stripTags(pm[1]));
        if (pt) paras.push(pt);
      }
      if (paras.length) summary = paras.join('\n\n');
    }

    var info = {
      source: this.id,
      url: fullUrl,
      title: title || fullUrl,
      author: author || undefined,
      coverUrl: coverUrl,
      summary: summary || undefined,
      status: status,
      category: 'Translated Novels',
      tags: []
    };
    if (translator) info.translator = translator;
    if (totalChapters) info.totalChapters = totalChapters;
    return info;
  },

  // ---------------------------------------------------------------
  // Chapter list — TOC is 100/page (?toc=N, "Page X of Y")
  // ---------------------------------------------------------------
  parseChapterList: async function (novelUrl, ctx) {
    var fullUrl = this._absUrl(novelUrl).split('?')[0].replace(/\/$/, '');

    var html = await this._fetchCached(fullUrl, ctx);
    if (/<h1>\s*Not found\s*<\/h1>/i.test(html)) throw new Error('Novel not found');
    var pages = this._totalTocPages(html);

    var slots = [];
    slots[0] = this._parseTocPage(html);

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
        var pageHtml = null;
        try {
          pageHtml = await self._fetch(fullUrl + '?toc=' + cur, ctx);
        } catch (e) {
          try {
            pageHtml = await self._fetch(fullUrl + '?toc=' + cur, ctx);
          } catch (e2) {
            pageHtml = null;
          }
        }
        if (pageHtml) {
          var pageChaps = self._parseTocPage(pageHtml);
          if (pageChaps.length) slots[cur - 1] = pageChaps;
        }
      }
    };
    for (var w = 0; w < Math.min(concurrency, pageTasks.length); w++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    var chapters = [];
    for (var s = 0; s < slots.length; s++) {
      if (slots[s]) chapters = chapters.concat(slots[s]);
    }

    chapters = this._finalizeChapters(chapters);
    return chapters;
  },

  _fetch: async function (url, ctx) {
    var res = await ctx.xFetch(url);
    if (!res.ok) throw new Error('Failed to fetch: ' + res.status);
    return res.text;
  },

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

  _totalTocPages: function (html) {
    var m = html.match(/Page\s+\d+\s+of\s+(\d+)/i);
    if (m) return parseInt(m[1], 10);
    var max = 1;
    var re = /\?toc=(\d+)/gi;
    var mm;
    while ((mm = re.exec(html)) !== null) {
      var n = parseInt(mm[1], 10);
      if (n > max) max = n;
    }
    return max;
  },

  _parseTocPage: function (html) {
    var chapters = [];
    var tocStart = html.indexOf('class="toc"');
    var region = tocStart !== -1 ? html.slice(tocStart) : html;
    var liRegex = /<li([^>]*)>([\s\S]*?)<\/li>/gi;
    var liMatch;
    while ((liMatch = liRegex.exec(region)) !== null) {
      var liAttrs = liMatch[1] || '';
      var li = liMatch[2];
      // Group headers (".grp") carry no chapter link.
      if (/class="[^"]*grp[^"]*"/i.test(liAttrs)) continue;
      var aMatch = li.match(/<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/i);
      if (!aMatch) continue;
      var href = aMatch[1].trim();
      if (href === '#' || href.indexOf('/novel/') === -1) continue;
      var rawTitle = this._decodeEntities(this._stripTags(aMatch[2]));
      if (!rawTitle) continue;

      var numParsed = rawTitle.match(/(?:^|\b)chapter\s*(\d+(?:\.\d+)?)/i) ||
                      href.match(/chapter-(\d+(?:\.\d+)?)/i);
      var chapterNumber = numParsed ? parseFloat(numParsed[1]) : 0;
      var title = this._stripChapterPrefix(rawTitle) || rawTitle;

      chapters.push({
        url: this._absUrl(href),
        number: chapterNumber,
        title: title
      });
    }
    return chapters;
  },

  // ---------------------------------------------------------------
  // Chapter body
  // ---------------------------------------------------------------
  parseChapterContent: async function (chapterUrl, ctx) {
    var res = await ctx.xFetch(this._absUrl(chapterUrl));
    if (!res.ok) throw new Error('Failed to fetch chapter: ' + res.status);
    var html = res.text;

    if (/<h1>\s*Not found\s*<\/h1>/i.test(html)) throw new Error('Chapter not found');

    var bodyMatch = html.match(/<div[^>]*id="chapter-body"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
                    html.match(/<div[^>]*id="chapter-body"[^>]*>([\s\S]*?)<\/div>/i);
    if (!bodyMatch) throw new Error('Chapter content not found');

    var raw = bodyMatch[1];
    raw = raw.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    raw = raw.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    var paragraphs = [];
    var pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    var pm;
    while ((pm = pRegex.exec(raw)) !== null) {
      var text = this._decodeEntities(this._stripTags(pm[1]));
      if (!text) continue;
      // Drop the inline "MGA: Chapter 2 – Title" heading that repeats the title.
      if (paragraphs.length === 0 && /^(?:[A-Za-z]{1,8}\s*:\s*)?chapter\s*\d+\b/i.test(text)) continue;
      paragraphs.push(text);
    }

    if (paragraphs.length === 0) {
      var fallback = this._decodeEntities(raw.replace(/<[^>]+>/g, '\n').replace(/\s+\n/g, '\n').trim());
      if (!fallback) throw new Error('Chapter content not found');
      return fallback;
    }
    return paragraphs.join('\n\n');
  },

  // ---------------------------------------------------------------
  // Search / browse (novel-cell cards)
  // ---------------------------------------------------------------
  _parseNovelCards: function (html) {
    var results = [];
    var seen = {};
    var cellRe = /<td[^>]*class="[^"]*novel-cell[^"]*"[^>]*>([\s\S]*?)<\/td>/gi;
    var cm;
    while ((cm = cellRe.exec(html)) !== null) {
      var cell = cm[1];
      var link = cell.match(/<p[^>]*class="[^"]*title[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/i) ||
                 cell.match(/<a[^>]+href="(\/novel\/[^"]+)"[^>]*>([^<]*)<\/a>/i);
      if (!link) continue;
      var novelUrl = this._absUrl(link[1].trim());
      if (seen[novelUrl]) continue;
      seen[novelUrl] = true;
      var title = this._decodeEntities(this._stripTags(link[2]));
      if (!title) continue;

      var imgTag = cell.match(/(<img[^>]*>)/i);
      var coverUrl;
      if (imgTag) {
        var srcM = imgTag[1].match(/\bsrc\s*=\s*"([^"]+)"/i) || imgTag[1].match(/\bsrc\s*=\s*'([^']+)'/i);
        if (srcM) coverUrl = srcM[1].trim();
      }

      // "<p class="tag">Ongoing · Fantasy, Xuanhuan</p>"
      var status = 'مستمرة';
      var tags = [];
      var tagM = cell.match(/<p[^>]*class="[^"]*tag[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
      if (tagM) {
        var tagText = this._decodeEntities(this._stripTags(tagM[1]));
        var tagParts = tagText.split('·');
        if (tagParts.length > 0) status = this._mapStatus(tagParts[0]);
        if (tagParts.length > 1) {
          var genres = tagParts[1].split(',');
          for (var g = 0; g < genres.length; g++) {
            var genre = genres[g].trim();
            if (genre) tags.push(genre);
          }
        }
      }

      var synopsis;
      var synM = cell.match(/<p[^>]*class="[^"]*syn[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
      if (synM) synopsis = this._decodeEntities(this._stripTags(synM[1]));

      results.push({
        source: this.id,
        url: novelUrl,
        title: title,
        coverUrl: coverUrl,
        author: 'Unknown',
        category: tags.length > 0 ? tags[0] : 'Translated Novels',
        tags: tags,
        summary: synopsis || undefined,
        status: status
      });
    }
    return results;
  },

  _browseNextUrl: function (html) {
    var m = html.match(/<div[^>]*class="[^"]*pager[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>\s*Next/i);
    if (!m) return null;
    var href = m[1].replace(/&amp;/gi, '&');
    return this._absUrl(href);
  },

  // Follow the cursor pager (?after=N) to reach catalogue page N.
  _fetchBrowsePage: async function (baseUrl, page, ctx) {
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    var url = baseUrl;
    var html = null;
    for (var hop = 1; hop <= pageNum; hop++) {
      var res = await ctx.xFetch(url);
      if (!res.ok) return hop === 1 ? [] : null;
      html = res.text;
      if (hop < pageNum) {
        var next = this._browseNextUrl(html);
        if (!next) return null;
        url = next;
      }
    }
    return this._parseNovelCards(html || '');
  },

  searchNovels: async function (query, page, ctx) {
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    if (!query || !query.trim()) {
      return this.getPopularNovels(pageNum, ctx);
    }
    // Search results render on one page; later pages are empty.
    if (pageNum > 1) return [];
    var url = this._absUrl('/novels?q=' + encodeURIComponent(query.trim()));
    var res = await ctx.xFetch(url);
    if (!res.ok) return [];
    return this._parseNovelCards(res.text);
  },

  getPopularNovels: async function (page, ctx) {
    var out = await this._fetchBrowsePage(this._absUrl('/novels?sort=popular'), page, ctx);
    return out || [];
  },

  // ---------------------------------------------------------------
  // Categories — the lite browse sorts (no genre index on lite).
  // ---------------------------------------------------------------
  getCategories: async function (ctx) {
    return [
      { name: 'Popular', slug: 'popular' },
      { name: 'Newest', slug: 'new' },
      { name: 'Most chapters', slug: 'chapters' },
      { name: 'Name', slug: 'name' },
      { name: 'Rating', slug: 'rating' }
    ];
  },

  getCategoryNovels: async function (categorySlug, page, ctx) {
    var allowed = { popular: 1, new: 1, chapters: 1, name: 1, rating: 1 };
    var slug = (categorySlug || 'popular').trim();
    if (!Object.prototype.hasOwnProperty.call(allowed, slug)) slug = 'popular';
    var out = await this._fetchBrowsePage(this._absUrl('/novels?sort=' + slug), page, ctx);
    return out || [];
  }
});
