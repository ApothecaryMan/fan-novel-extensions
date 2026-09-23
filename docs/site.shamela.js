// @id       site:shamela
// @name     المكتبة الشاملة
// @version  1.1.1
// @lang     ar
// @apiVersion 1
// @baseUrl  https://shamela.ws
// ==========================================
// site:shamela — remote-JS extension for shamela.ws
// Clean sandboxed scraper adhering to the Extension Runtime Specification (ctx.xFetch).
// Chapter strategy:
//   - TOC links (/book/{id}/{pageId}) from div.betaka-index / div.s-nav, deduped by URL
//     (the site repeats the same pageId for several logical titles).
//   - Collapsed [+] nodes expanded via GET ajax/titlechilds/{book}/{node}.
//   - Content: TOC entries are bab *starts*, not full babs. parseChapterContent
//     stitches GET ajax/pageContent/{book}/{page} JSON ({nass,title,pageNum,
//     nextId,prevId}) following nextId until the next TOC pageId (exclusive),
//     with div.nass HTML fallback for the first page only.

var _htmlCache = Object.create(null); // url -> { data, ts }
var _HTML_CACHE_TTL_MS = 5 * 60 * 1000;
var _HTML_CACHE_CAP = 24;
var _inFlight = Object.create(null); // url -> Promise

function _fetchCached(url, ctx) {
  var now = Date.now();
  var hit = _htmlCache[url];
  if (hit && (now - hit.ts) < _HTML_CACHE_TTL_MS) {
    return Promise.resolve(hit.data);
  }
  if (_inFlight[url]) {
    return _inFlight[url];
  }
  var p = ctx.xFetch(url).then(function (res) {
    delete _inFlight[url];
    if (res && res.ok) {
      _htmlCache[url] = { data: res, ts: now };
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
  id: 'site:shamela',
  name: 'المكتبة الشاملة',
  lang: 'ar',
  version: '1.1.1',
  apiVersion: 1,
  baseUrl: 'https://shamela.ws',

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
    return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  },

  _decodeEntities: function (str) {
    if (!str) return '';
    var named = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
      hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
      ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
      middot: '·', bull: '•', copy: '©', reg: '®', trade: '™'
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
    return res;
  },

  _toLatinDigits: function (str) {
    if (!str) return '';
    return String(str)
      .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x660); })
      .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x6F0); });
  },

  // Inline HTML -> text, preserving <br> breaks as \n.
  _cleanInline: function (html) {
    if (!html) return '';
    var s = String(html).replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<[^>]+>/g, ' ');
    s = this._decodeEntities(s);
    var lines = s.split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\s+/g, ' ').trim();
      if (line) out.push(line);
    }
    return out.join('\n');
  },

  _bookIdFromUrl: function (url) {
    var m = String(url || '').match(/\/book\/(\d+)/);
    return m ? m[1] : null;
  },

  _pageIdFromUrl: function (url) {
    var m = String(url || '').match(/\/book\/\d+\/(\d+)/);
    return m ? m[1] : null;
  },

  _fetchText: async function (url, ctx) {
    var res = await _fetchCached(url, ctx);
    if (!res || !res.ok) {
      throw new Error('فشل جلب الصفحة: ' + (res ? res.status : 'Network error'));
    }
    return res.text;
  },

  _fetchJson: async function (url, ctx) {
    var text = await this._fetchText(url, ctx);
    try {
      return typeof text === 'string' ? JSON.parse(text) : text;
    } catch (e) {
      throw new Error('رد غير صالح من المكتبة الشاملة');
    }
  },

  // Collect {url,title} TOC links from betaka-index / s-nav regions.
  _collectTocLinks: function (html) {
    var out = [];
    if (!html) return out;
    var regions = [];
    var bm = html.match(/<div[^>]*class="[^"]*betaka-index[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/(?:section|div)>/i);
    if (bm) regions.push(bm[1]);
    var sm = html.match(/<div[^>]*class="[^"]*s-nav[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div[^>]*class="col-md-8/i);
    if (sm) regions.push(sm[1]);
    if (regions.length === 0) {
      var liScope = html.match(/<div[^>]*class="[^"]*(?:betaka-index|s-nav)[^"]*"[^>]*>([\s\S]*)/i);
      if (liScope) regions.push(liScope[1].substring(0, 400000));
    }
    var scope = regions.join('\n');
    var re = /<a[^>]+href="(https?:\/\/shamela\.ws)?\/book\/(\d+)\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = re.exec(scope)) !== null) {
      var full = this._absUrl('/book/' + m[2] + '/' + m[3]);
      var label = this._decodeEntities(this._stripTags(m[4])).trim();
      if (!label || /^\[\+\]$/.test(label)) continue;
      out.push({ url: full, title: label });
    }
    return out;
  },

  // Collapsed [+] nodes: <a ... class="...exp_bu..." data-id="N" data-book-id="B">
  _collectCollapsedNodes: function (html) {
    var out = [];
    var seen = Object.create(null);
    if (!html) return out;
    var re = /<a[^>]*class="[^"]*exp_bu[^"]*"[^>]*>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var tag = m[0];
      var idm = tag.match(/data-id="(\d+)"/i);
      var bkm = tag.match(/data-book-id="(\d+)"/i);
      if (!idm || !bkm) continue;
      var key = bkm[1] + ':' + idm[1];
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ bookId: bkm[1], nodeId: idm[1] });
    }
    return out;
  },

  // ---------------------------------------------------------------
  // Metadata & Novel Details
  // ---------------------------------------------------------------
  parseNovelInfo: async function (url, ctx) {
    var bookId = this._bookIdFromUrl(url);
    var fullUrl = this._absUrl(bookId ? '/book/' + bookId : String(url || '').split('#')[0]);
    var html = await this._fetchText(fullUrl, ctx);

    var title = '';
    var h1 = html.match(/<section[^>]*class="[^"]*page-header[^"]*"[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
             html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) title = this._decodeEntities(this._stripTags(h1[1])).replace(/^كتاب\s+/, '').trim();
    if (!title) title = 'كتاب بدون عنوان';

    var author = '';
    var am = html.match(/<a[^>]+href="(?:https?:\/\/shamela\.ws)?\/author\/\d+"[^>]*>([^<]+)<\/a>/i);
    if (am) author = this._decodeEntities(am[1]).trim();

    var category = 'كتب وروايات';
    var cm = html.match(/<ol[^>]*class="[^"]*breadcrumb[^"]*"[^>]*>([\s\S]*?)<\/ol>/i);
    if (cm) {
      var links = [];
      var cre = /<a[^>]*>([^<]+)<\/a>/gi;
      var cx;
      while ((cx = cre.exec(cm[1])) !== null) {
        links.push(this._decodeEntities(cx[1]).trim());
      }
      if (links.length > 0) {
        var last = links[links.length - 1];
        if (last && last !== 'الرئيسية' && last !== 'أقسام الكتب') category = last;
      }
    }

    // Book card details block.
    var summary = '';
    var card = html.match(/<h3[^>]*>بطاقة الكتاب وفهرس الموضوعات<\/h3>([\s\S]*?)<div[^>]*class="[^"]*betaka-index/i);
    if (card) {
      var cardText = card[1].replace(/<div[^>]*>صفحة المؤلف[\s\S]*$/i, '');
      summary = this._cleanInline(cardText);
      if (summary.length > 600) summary = summary.substring(0, 600).trim() + '…';
    }

    var tocLinks = this._collectTocLinks(html);
    var seenUrls = Object.create(null);
    var totalChapters = 0;
    for (var i = 0; i < tocLinks.length; i++) {
      if (!seenUrls[tocLinks[i].url]) {
        seenUrls[tocLinks[i].url] = true;
        totalChapters += 1;
      }
    }

    var pages = undefined;
    var pm = html.match(/عدد الصفحات:\s*([٠-٩0-9]+)/i);
    if (pm) {
      var n = parseInt(this._toLatinDigits(pm[1]), 10);
      if (n > 0) pages = n;
    }

    // Reading-time estimate from the published printed-page count (zero extra
    // fetches; full-book stitching would cost hundreds of requests).
    // ~300 words per Arabic printed page, ~140 wpm deliberate reading speed.
    var wordCount = undefined;
    var readingMinutes = undefined;
    if (pages) {
      wordCount = pages * 300;
      readingMinutes = Math.max(1, Math.round(wordCount / 140));
    }

    return {
      source: this.id,
      url: fullUrl,
      title: title,
      author: author || 'المكتبة الشاملة',
      coverUrl: undefined,
      summary: summary,
      status: 'مكتملة',
      category: category,
      tags: category !== 'كتب وروايات' ? [category] : [],
      totalChapters: totalChapters || undefined,
      totalPages: pages,
      wordCount: wordCount,
      readingMinutes: readingMinutes
    };
  },

  // ---------------------------------------------------------------
  // Chapter List — TOC + collapsed-node expansion + URL dedupe
  // ---------------------------------------------------------------
  parseChapterList: async function (novelUrl, ctx) {
    var bookId = this._bookIdFromUrl(novelUrl);
    var fullUrl = this._absUrl(bookId ? '/book/' + bookId : String(novelUrl || '').split('#')[0]);
    if (!bookId) throw new Error('رابط الكتاب غير صالح');
    var html = await this._fetchText(fullUrl, ctx);

    var links = this._collectTocLinks(html);

    // Expand collapsed [+] nodes (their children load via ajax/titlechilds).
    var nodes = this._collectCollapsedNodes(html);
    var visitedNodes = Object.create(null);
    var self = this;
    for (var n = 0; n < nodes.length; n++) {
      var key = nodes[n].bookId + ':' + nodes[n].nodeId;
      if (visitedNodes[key]) continue;
      visitedNodes[key] = true;
      var frag = null;
      try {
        frag = await self._fetchText(
          self._absUrl('/ajax/titlechilds/' + nodes[n].bookId + '/' + nodes[n].nodeId), ctx
        );
      } catch (e) {
        frag = null;
      }
      if (!frag) continue;
      var extra = self._collectTocLinks('<div class="betaka-index">' + frag + '</div></section>');
      for (var e = 0; e < extra.length; e++) links.push(extra[e]);
      var nested = self._collectCollapsedNodes(frag);
      for (var g = 0; g < nested.length; g++) {
        var gkey = nested[g].bookId + ':' + nested[g].nodeId;
        if (!visitedNodes[gkey]) nodes.push(nested[g]);
      }
    }

    var chapters = [];
    var seen = Object.create(null);
    var num = 1;
    for (var i = 0; i < links.length; i++) {
      if (seen[links[i].url]) continue;
      seen[links[i].url] = true;
      chapters.push({ url: links[i].url, number: num++, title: links[i].title });
    }

    if (chapters.length === 0) {
      chapters.push({ url: fullUrl + '/1', number: 1, title: 'قراءة الكتاب' });
    }

    return chapters;
  },

  // ---------------------------------------------------------------
  // Chapter Content — stitch all printed pages of a bab.
  // TOC links are only bab *start* pages (e.g. باب الأسد والثور = p83..p145).
  // A single pageContent call is ~100-200 words, so we follow nextId until
  // the next TOC pageId (exclusive), capped at 150 pages.
  // ---------------------------------------------------------------
  _orderedTocPageIds: function (html) {
    var links = this._collectTocLinks(html);
    var ids = [];
    var seen = Object.create(null);
    for (var i = 0; i < links.length; i++) {
      var pid = this._pageIdFromUrl(links[i].url);
      if (!pid || seen[pid]) continue;
      seen[pid] = true;
      ids.push(pid);
    }
    return ids;
  },

  _stopPageIdFor: async function (bookId, pageId, ctx) {
    try {
      var html = await this._fetchText(this._absUrl('/book/' + bookId), ctx);
      var ids = this._orderedTocPageIds(html);
      if (ids.length === 0) return undefined; // no TOC — unknown boundary
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i]) === String(pageId)) {
          return (i + 1 < ids.length) ? String(ids[i + 1]) : null;
        }
      }
      return undefined; // current page not in TOC — unknown boundary
    } catch (e) {
      return undefined; // TOC unreachable — caller falls back to single page
    }
  },
  _cleanNass: function (nassHtml) {
    var c = String(nassHtml || '');
    c = c.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    c = c.replace(/<span[^>]*class="[^"]*anchor[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '');
    c = c.replace(/<a[^>]*class="[^"]*btn_tag[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '');
    var paragraphs = [];
    var re = /<(p|h1|h2|h3|h4|h5|h6|li)[^>]*>([\s\S]*?)<\/\1>/gi;
    var m;
    while ((m = re.exec(c)) !== null) {
      var text = this._cleanInline(m[2]).trim();
      if (!text) continue;
      paragraphs.push(text);
    }
    if (paragraphs.length === 0) {
      var fallback = this._cleanInline(c).replace(/\n\s*\n/g, '\n\n').trim();
      if (!fallback) throw new Error('لم يتم العثور على نص الفصل');
      return fallback;
    }
    return paragraphs.join('\n\n');
  },

  parseChapterContent: async function (chapterUrl, ctx) {
    var bookId = this._bookIdFromUrl(chapterUrl);
    var pageId = this._pageIdFromUrl(chapterUrl);
    if (!bookId || !pageId) throw new Error('رابط الفصل غير صالح');

    // Find where this bab ends (next TOC start page, exclusive).
    // undefined = TOC unknown -> single-page safe fallback (old behavior).
    var stopId = await this._stopPageIdFor(bookId, pageId, ctx);

    // Primary: pageContent JSON API, stitched across printed pages.
    var parts = [];
    if (stopId !== undefined) {
    var cur = String(pageId);
    var visited = Object.create(null);
    for (var step = 0; step < 150 && cur && !visited[cur]; step++) {
      if (stopId && cur === stopId) break;
      visited[cur] = true;
      var json = null;
      try {
        json = await this._fetchJson(this._absUrl('/ajax/pageContent/' + bookId + '/' + cur), ctx);
      } catch (e) {
        json = null;
      }
      if (!json || !json.nass) break;
      try {
        parts.push(this._cleanNass(json.nass));
      } catch (e) {
        // Skip empty pages but keep walking.
      }
      var nxt = (json.nextId !== undefined && json.nextId !== null) ? String(json.nextId) : '';
      if (!nxt || nxt === 'null' || nxt === 'undefined' || nxt === cur) break;
      cur = nxt;
    }
    }
    if (parts.length > 0) return parts.join('\n\n');

    // Single-page fallback (unknown boundary or stitched fetch failed).
    var single = null;
    try {
      single = await this._fetchJson(this._absUrl('/ajax/pageContent/' + bookId + '/' + pageId), ctx);
    } catch (e) {
      single = null;
    }
    if (single && single.nass) return this._cleanNass(single.nass);

    var html = await this._fetchText(this._absUrl('/book/' + bookId + '/' + pageId), ctx);
    var nm = html.match(/<div[^>]*class="[^"]*\bnass\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*id="appended_pages"/i) ||
             html.match(/<div[^>]*class="[^"]*\bnass\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!nm) throw new Error('لم يتم العثور على نص الفصل');
    return this._cleanNass(nm[1]);
  },

  // ---------------------------------------------------------------
  // Search & Catalog
  // ---------------------------------------------------------------
  _parseBookItems: function (html) {
    var results = [];
    var seen = Object.create(null);
    if (!html) return results;
    var re = /<div[^>]*class="[^"]*book_item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*book_item|<\/div>|<\/body|<!--|$)/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var block = m[1];
      var lm = block.match(/<a[^>]+href="((?:https?:\/\/shamela\.ws)?\/book\/(\d+))"[^>]*>([\s\S]*?)<\/a>/i);
      if (!lm) continue;
      var full = this._absUrl('/book/' + lm[2]);
      if (seen[full]) continue;
      seen[full] = true;
      var title = this._decodeEntities(this._stripTags(lm[3])).trim();
      if (!title) continue;
      var author = 'المكتبة الشاملة';
      var am = block.match(/<a[^>]+href="(?:https?:\/\/shamela\.ws)?\/author\/\d+"[^>]*>([^<]+)<\/a>/i);
      if (am) author = this._decodeEntities(am[1]).trim();
      var des = '';
      var dm = block.match(/<p[^>]*class="[^"]*des[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
      if (dm) des = this._cleanInline(dm[1]);
      results.push({
        source: this.id,
        url: full,
        title: title,
        author: author,
        category: 'كتب وروايات',
        summary: des ? des.substring(0, 300) : undefined,
        status: 'مكتملة'
      });
    }
    return results;
  },

  searchNovels: async function (query, page, ctx) {
    var q = (query || '').trim();
    if (!q) return this.getPopularNovels(page, ctx);
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    if (pageNum > 1) return [];
    var json;
    try {
      json = await this._fetchJson(this._absUrl('/ajax/book/?q=' + encodeURIComponent(q)), ctx);
    } catch (e) {
      return [];
    }
    var items = (json && json.results && json.results.items) ? json.results.items : [];
    var out = [];
    for (var i = 0; i < items.length && out.length < 20; i++) {
      var it = items[i];
      if (!it || !it.id || !it.text) continue;
      out.push({
        source: this.id,
        url: this._absUrl('/book/' + it.id),
        title: String(it.text).trim(),
        author: 'المكتبة الشاملة',
        category: 'كتب وروايات',
        status: 'مكتملة'
      });
    }
    return out;
  },

  getPopularNovels: async function (page, ctx) {
    return this.getCategoryNovels('32', page, ctx);
  },

  // ---------------------------------------------------------------
  // Category / Topic browsing (40 fixed sections, single HTML page each)
  // ---------------------------------------------------------------
  getCategories: async function () {
    return [
      { name: 'كل الكتب', slug: '' },
      { name: 'العقيدة', slug: '1' },
      { name: 'الفرق والردود', slug: '2' },
      { name: 'التفسير', slug: '3' },
      { name: 'علوم القرآن', slug: '4' },
      { name: 'التجويد والقراءات', slug: '5' },
      { name: 'كتب السنة', slug: '6' },
      { name: 'شروح الحديث', slug: '7' },
      { name: 'علوم الحديث', slug: '10' },
      { name: 'أصول الفقه', slug: '11' },
      { name: 'الفقه العام', slug: '18' },
      { name: 'الفتاوى', slug: '22' },
      { name: 'الرقائق والآداب', slug: '23' },
      { name: 'السيرة النبوية', slug: '24' },
      { name: 'التاريخ', slug: '25' },
      { name: 'التراجم والطبقات', slug: '26' },
      { name: 'البلدان والرحلات', slug: '28' },
      { name: 'كتب اللغة', slug: '29' },
      { name: 'النحو والصرف', slug: '31' },
      { name: 'الأدب', slug: '32' },
      { name: 'الشعر ودواوينه', slug: '34' },
      { name: 'البلاغة', slug: '35' },
      { name: 'الطب', slug: '38' },
      { name: 'كتب عامة', slug: '39' }
    ];
  },

  getCategoryNovels: async function (categorySlug, page, ctx) {
    var slug = (categorySlug || '').trim();
    if (!slug) slug = '32';
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    var perPage = 100;
    var html;
    try {
      html = await this._fetchText(this._absUrl('/category/' + encodeURIComponent(slug)), ctx);
    } catch (e) {
      return [];
    }
    var all = this._parseBookItems(html);
    var start = (pageNum - 1) * perPage;
    return all.slice(start, start + perPage);
  }
});
