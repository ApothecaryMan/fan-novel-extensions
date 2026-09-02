// site:novelfull — remote-JS extension for novelfull.com (English).
// Clean sandboxed scraper adhering to the Extension Runtime Specification (ctx.xFetch).
// Chapter lists are inline on the novel page (no AJAX pagination needed).
// Chapter titles are reported in "N title…" style, e.g. "1244 time undojfijijf".
registerExtension({
  id: 'site:novelfull',
  name: 'NovelFull',
  lang: 'en',
  version: '1.0.0',
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

  _decodeEntities: function (str) {
    var named = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
      hellip: '…', ndash: '–', mdash: '—', lsquo: '\u2018', rsquo: '\u2019',
      ldquo: '\u201C', rdquo: '\u201D', middot: '·', bull: '•', aacute: 'á'
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

  _parseDate: function (raw) {
    if (!raw) return undefined;
    var s = String(raw).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!s) return undefined;
    var now = Date.now();

    // Relative / friendly English dates
    if (/^\d+\s*(sec|secs|second|seconds)/.test(s)) return now;
    if (/^\d+\s*(min|mins|minute|minutes)\s*(ago)?/.test(s)) {
      var m = s.match(/^(\d+)/);
      return now - parseInt(m[1], 10) * 60 * 1000;
    }
    if (/^\d+\s*(hour|hours|hr|hrs)\s*(ago)?/.test(s)) {
      var h = s.match(/^(\d+)/);
      return now - parseInt(h[1], 10) * 3600 * 1000;
    }
    if (/^\d+\s*(day|days)\s*(ago)?/.test(s)) {
      var d = s.match(/^(\d+)/);
      return now - parseInt(d[1], 10) * 24 * 3600 * 1000;
    }
    if (/^\d+\s*(week|weeks)\s*(ago)?/.test(s)) {
      var w = s.match(/^(\d+)/);
      return now - parseInt(w[1], 10) * 7 * 24 * 3600 * 1000;
    }
    if (/^\d+\s*(month|months)\s*(ago)?/.test(s)) {
      var mo = s.match(/^(\d+)/);
      return now - parseInt(mo[1], 10) * 30 * 24 * 3600 * 1000;
    }
    if (/^\d+\s*(year|years)\s*(ago)?/.test(s)) {
      var y = s.match(/^(\d+)/);
      return now - parseInt(y[1], 10) * 365 * 24 * 3600 * 1000;
    }
    if (s.indexOf('yesterday') !== -1) return now - 24 * 3600 * 1000;
    if (s.indexOf('today') !== -1) return now;

    // Absolute English dates: "January 5, 2024" or "2024-01-05"
    var parsed = Date.parse(s);
    if (!isNaN(parsed)) return parsed;
    return undefined;
  },

  // ---------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------
  parseNovelInfo: async function (url, ctx) {
    var fullUrl = this._absUrl(url);
    var res = await ctx.xFetch(fullUrl);
    if (!res.ok) throw new Error('Failed to fetch novel: ' + res.status);
    var html = res.text;

    var title = (html.match(/<h1[^>]*[^>]*>([^<]+)<\/h1>/i) || [])[1];
    var mTitle = html.match(/<h3[^>]*class="[^"]*name[^"]*"[^>]*>([^<]+)<\/h3>/i) || html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    title = mTitle ? this._decodeEntities(this._stripTags(mTitle[1])) : (title ? this._decodeEntities(this._stripTags(title)) : undefined);

    var coverMatch = html.match(/<div[^>]*class="[^"]*book[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^">]+)"/i) ||
                     html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ||
                     html.match(/<img[^>]+class="[^"]*cover[^"]*"[^>]+src="([^">]+)"/i);
    var coverUrl = coverMatch ? coverMatch[1].trim() : undefined;

    var author = '';
    var authorMatch = html.match(/href="[^"]*\/author\/[^"]*"[^>]*>([^<]+)<\/a>/i);
    if (authorMatch) author = this._decodeEntities(this._stripTags(authorMatch[1]));

    var status = 'مستمرة';
    if (/complete/i.test(html) && !/ongoing/i.test(html)) status = 'مكتملة';

    var summary = '';
    var sumMatch = html.match(/<div[^>]*class="[^"]*desc-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                   html.match(/<div[^>]*class="[^"]*summary-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                   html.match(/<div[^>]*class="[^"]*desc[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (sumMatch) {
      summary = this._decodeEntities(this._stripTags(sumMatch[1])
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ''));
    }

    return {
      source: this.id,
      url: fullUrl,
      title: title || fullUrl,
      author: author || undefined,
      coverUrl: coverUrl,
      summary: summary || undefined,
      status: status,
      category: 'Translated Novels',
    };
  },

  // ---------------------------------------------------------------
  // Chapter list — inline on the novel page
  // ---------------------------------------------------------------
  parseChapterList: async function (novelUrl, ctx) {
    var fullUrl = this._absUrl(novelUrl);
    var res = await ctx.xFetch(fullUrl);
    if (!res.ok) throw new Error('Failed to fetch chapter list: ' + res.status);
    var html = res.text;

    var chapters = [];
    var anchorRegex = /<a[^>]+href="([^"]+)">[\s\S]*?<span[^>]*class="[^"]*chapter-text[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
    var match;
    while ((match = anchorRegex.exec(html)) !== null) {
      var href = match[1].trim();
      var rawTitle = this._decodeEntities(this._stripTags(match[2]));

      // Chapter number from leading "Chapter N" / "N"
      var numParsed = rawTitle.match(/\bchapter\s*(\d+)\b/i);
      var chapterNumber = numParsed ? parseInt(numParsed[1], 10) : 0;
      if (!chapterNumber) {
        var leadNum = rawTitle.match(/^(\d+)/);
        chapterNumber = leadNum ? parseInt(leadNum[1], 10) : 0;
      }

      // Title in "N title…" style: strip the "Chapter N:" prefix and put the
      // number at the front, e.g. "Chapter 1244: time" -> "1244 time".
      var title = rawTitle.replace(/^chapter\s*\d+\s*[:.\-–—]?\s*/i, '').trim();
      if (chapterNumber) title = chapterNumber + (title ? ' ' + title : '');

      chapters.push({
        url: href,
        number: chapterNumber,
        title: title
      });
    }

    // Fallback: anchors whose text carries the chapter number without .chapter-text
    if (chapters.length === 0) {
      var rowRegex = /<div[^>]*class="[^"]*row[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      var rm;
      while ((rm = rowRegex.exec(html)) !== null) {
        if (rm[1].indexOf('http') !== 0 && rm[1].indexOf('/') !== 0) continue;
        var rTitle = this._decodeEntities(this._stripTags(rm[2])).replace(/\s+/g, ' ').trim();
        if (/chapter\s*\d+/i.test(rTitle)) {
          var rNum = rTitle.match(/chapter\s*(\d+)/i);
          var num = rNum ? parseInt(rNum[1], 10) : 0;
          var subtitle = rTitle.replace(/^chapter\s*\d+\s*[:.\-–—]?\s*/i, '').trim();
          chapters.push({ url: rm[1].trim(), number: num, title: num + (subtitle ? ' ' + subtitle : '') });
        }
      }
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

    var panelMatch = html.match(/<div[^>]*id="chapter-content"[^>]*>([\s\S]*?)<\/div>/i) ||
                     html.match(/<div[^>]*class="[^"]*channel-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                     html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!panelMatch) throw new Error('Chapter content not found');

    var raw = panelMatch[1];
    raw = raw.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    raw = raw.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    raw = raw.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '');
    raw = raw.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '');
    raw = raw.replace(/<ins[^>]*>[\s\S]*?<\/ins>/gi, '');
    raw = raw.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '');
    raw = raw.replace(/<div[^>]*class="[^"]*(?:ads\d*|adsbygoogle|advert|container-ads|inlinead)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
    raw = raw.replace(/<div[^>]*class="[^"]*(?:ads\d*|adsbygoogle|advert|container-ads|inlinead)[^"]*"\s*\/>/gi, '');

    var paragraphs = [];
    var pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    var pm;
    while ((pm = pRegex.exec(raw)) !== null) {
      var text = this._decodeEntities(this._stripTags(pm[1]));
      if (!text) continue;
      if (/^(the end\b|end of the chapter|next chapter|you are reading)/i.test(text)) break;
      paragraphs.push(text);
    }

    if (paragraphs.length === 0) {
      return this._decodeEntities(raw.replace(/<[^>]+>/g, '\n').replace(/\s+\n/g, '\n').trim());
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
      url = pageNum > 1 ? this._absUrl('/page/' + pageNum) : this._absUrl('/genre/novel');
    } else {
      url = this._absUrl('/search?keyword=' + encodeURIComponent(query.trim()));
    }

    var res = await ctx.xFetch(url);
    if (!res.ok) return [];
    var html = res.text;
    var results = [];

    var cardRegex = /<div[^>]*class="[^"]*col-novel[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
    var cm;
    while ((cm = cardRegex.exec(html)) !== null) {
      var card = cm[1];
      var link = (card.match(/<h3[^>]*class="[^"]*title[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/i) ||
                  card.match(/<(?:div|h3|h2)[^>]*class="[^"]*(novel-title|title)[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/i));
      if (!link) continue;
      var novelUrl = link[1] || link[2];
      var title = this._decodeEntities(this._stripTags(link[2] || link[3] || ''));
      if (!title) continue;

      var cov = (card.match(/<img[^>]+src="([^">]+)"/i) || [])[1];
      var author = (card.match(/href="[^"]*\/author\/[^"]*"[^>]*>([^<]+)<\/a>/i) || [])[1] || 'Unknown';
      results.push({
        source: this.id,
        url: novelUrl,
        title: title,
        coverUrl: cov ? cov.trim() : undefined,
        author: this._decodeEntities(this._stripTags(author)),
        category: 'Translated Novels'
      });
    }

    // Fallback: search results item markup
    if (results.length === 0) {
      var itemRegex = /<div[^>]*class="[^"]*search-item[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
      var im;
      while ((im = itemRegex.exec(html)) !== null) {
        var item = im[1];
        var iLink = (item.match(/<a[^>]+href="([^"]+)"[^>]*>\s*([^<]+)\s*<\/a>/) || [])[1];
        var iTitle = (item.match(/<h3[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/i) ||
                      item.match(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/i));
        if (!iTitle) continue;
        results.push({
          source: this.id,
          url: iTitle[1].trim(),
          title: this._decodeEntities(this._stripTags(iTitle[2])),
          coverUrl: (item.match(/<img[^>]+src="([^">]+)"/i) || [])[1] || undefined,
          author: 'Unknown',
          category: 'Translated Novels'
        });
      }
    }

    return results;
  },

  getPopularNovels: async function (page, ctx) {
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    return this.searchNovels('', pageNum, ctx);
  }
});