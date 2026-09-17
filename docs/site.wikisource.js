// @id       site:wikisource
// @name     ويكي مصدر
// @version  1.0.2
// @lang     ar
// @apiVersion 1
// @baseUrl  https://ar.wikisource.org
// ==========================================
// site:wikisource — remote-JS extension for ar.wikisource.org
// Clean sandboxed scraper adhering to the Extension Runtime Specification (ctx.xFetch).
// Chapter strategy (3 branches):
//   1. Main page lists subpages (Title/Part) -> chapters = subpages.
//   2. Size guard: a subpage with >=5 h2 or >15000 chars expands to URL#h2id anchors.
//   3. No subpages -> chapters = h2 anchors on main; no h2 -> single chapter.
// Uses the MediaWiki Action API for search/category listing, HTML for content.

var _htmlCache = Object.create(null); // url -> { res|html, ts }
var _HTML_CACHE_TTL_MS = 5 * 60 * 1000;
var _HTML_CACHE_CAP = 24;
var _inFlight = Object.create(null); // url -> Promise

var _H2_SPLIT_MIN = 5;

// Headings that are site chrome, never chapters.
var _META_H2_RE = /^(المحتويات|طبعات|انظر أيضا|انظر أيضاً|مراجع|مصادر|وصلات خارجية|هوامش|ملاحظات|تصنيفات|وصلات|روابط)/;

function _fetchCachedRaw(url, ctx) {
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
  id: 'site:wikisource',
  name: 'ويكي مصدر',
  lang: 'ar',
  version: '1.0.2',
  apiVersion: 1,
  baseUrl: 'https://ar.wikisource.org',

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  _absUrl: function (url) {
    if (!url) return '';
    if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) return url;
    if (url.indexOf('//') === 0) return 'https:' + url;
    var base = this.baseUrl.replace(/\/$/, '');
    if (url.charAt(0) !== '/') url = '/wiki/' + url;
    return base + url;
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
      middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', rlm: ''
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

  // Inline HTML -> text, preserving <br> verse breaks as \n.
  _cleanInline: function (html) {
    if (!html) return '';
    var s = String(html).replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/(?:li|tr|ul|ol|dd|dt)>/gi, '\n');
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

  _pageTitleFromUrl: function (url) {
    var s = String(url || '');
    var hash = s.indexOf('#');
    if (hash !== -1) s = s.substring(0, hash);
    var q = s.indexOf('?');
    if (q !== -1) s = s.substring(0, q);
    var m = s.match(/\/wiki\/([^?#]+)/);
    var t = m ? m[1] : s.replace(/^.*\//, '');
    try { t = decodeURIComponent(t); } catch (e) {}
    return t.replace(/_/g, ' ').trim();
  },

  _contentRoot: function (html) {
    if (!html) return '';
    var balanced = this._extractBalancedDiv(html, 'mw-parser-output');
    if (balanced) return balanced;
    var m = html.match(/<div[^>]*class="[^"]*mw-parser-output[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<noscript|<div class="printfooter")/i);
    if (m) return m[1];
    var body = html.match(/<div[^>]*id="mw-content-text"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/main>/i);
    return body ? body[1] : html;
  },

  _extractBalancedDiv: function (html, className) {
    if (!html) return null;
    var openRe = new RegExp('<div[^>]*class="[^"]*' + className + '[^"]*"[^>]*>', 'i');
    var open = openRe.exec(html);
    if (!open) return null;
    var startInner = open.index + open[0].length;
    var tagRe = /<\/?div\b[^>]*>/gi;
    tagRe.lastIndex = startInner;
    var depth = 1;
    var m;
    while ((m = tagRe.exec(html)) !== null) {
      depth += (m[0].charAt(1) === '/' ? -1 : 1);
      if (depth === 0) return html.substring(startInner, m.index);
    }
    return null;
  },

  _cleanContentRoot: function (rootHtml) {
    var c = String(rootHtml || '');
    c = c.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    c = c.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    c = c.replace(/<div[^>]*class="[^"]*(?:wst-header|ws-header|notes|printfooter)[^"]*"[^>]*>[\s\S]*?(?:<\/div>|$)/gi, '');
    c = c.replace(/<table[^>]*class="[^"]*metadata[^"]*"[^>]*>[\s\S]*?<\/table>/gi, '');
    c = c.replace(/<span[^>]*class="[^"]*mw-editsection[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '');
    c = c.replace(/<div[^>]*id="catlinks"[^>]*>[\s\S]*?<\/div>/gi, '');
    return c;
  },

  // Subpage links: href="/wiki/Title/..." (same-title prefix, no namespace colon).
  _extractSubpages: function (rootHtml, mainTitle) {
    var out = [];
    var seen = Object.create(null);
    if (!rootHtml || !mainTitle) return out;
    var normMain = mainTitle.replace(/\s+/g, ' ').trim();
    var re = /<a[^>]+href="(\/wiki\/([^"#?]+))"[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = re.exec(rootHtml)) !== null) {
      var href = m[1];
      if (href.indexOf('redlink=') !== -1) continue;
      var raw;
      try { raw = decodeURIComponent(m[2]).replace(/_/g, ' '); } catch (e) { continue; }
      raw = raw.replace(/\s+/g, ' ').trim();
      if (raw.indexOf(':') !== -1) continue; // namespace page (مؤلف:, تصنيف:...)
      if (raw === normMain) continue;
      if (raw.indexOf(normMain + '/') !== 0 && raw.indexOf(normMain + ' ') !== 0) continue;
      var full = this._absUrl(href);
      if (seen[full]) continue;
      seen[full] = true;
      var label = this._decodeEntities(this._stripTags(m[3])).trim();
      if (!label) label = raw.substring(normMain.length).replace(/^[\s\/\-–—:]+/, '').trim() || raw;
      out.push({ url: full, title: label });
    }
    return out;
  },

  // h2 sections: <h2 id="...">Text</h2> (Vector skin puts id on h2 directly).
  _extractH2: function (rootHtml) {
    var out = [];
    if (!rootHtml) return out;
    var re = /<h2[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/gi;
    var m;
    while ((m = re.exec(rootHtml)) !== null) {
      var id = m[1].trim();
      if (!id || /^toc|^mw-content-text/.test(id)) continue;
      var title = this._decodeEntities(this._stripTags(m[2])).trim();
      if (!title) continue;
      out.push({ id: id, title: title, index: m.index });
    }
    return out;
  },

  _sliceAnchor: function (cleanRoot, anchorId) {
    if (!cleanRoot || !anchorId) return cleanRoot;
    var idEsc = anchorId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var openRe = new RegExp('<h2[^>]*\\bid="' + idEsc + '"[^>]*>', 'i');
    var open = openRe.exec(cleanRoot);
    if (!open) {
      // Fallback: span anchor inside heading.
      var spanRe = new RegExp('<span[^>]*\\bid="' + idEsc + '"[^>]*>', 'i');
      var sm = spanRe.exec(cleanRoot);
      if (!sm) return null;
      var hStart = cleanRoot.lastIndexOf('<h', sm.index);
      open = { index: hStart !== -1 ? hStart : sm.index };
    }
    var from = open.index;
    var rest = cleanRoot.substring(from);
    var next = rest.search(/<h2[\s>]/i);
    // Skip the opening h2 tag itself when looking for the next one.
    var firstClose = rest.indexOf('>');
    var afterHead = firstClose !== -1 ? rest.substring(firstClose + 1) : rest;
    var nextRel = afterHead.search(/<h2[\s>]/i);
    if (nextRel !== -1) {
      return rest.substring(0, firstClose + 1 + nextRel);
    }
    return rest;
  },

  _textLength: function (cleanRoot) {
    return this._decodeEntities(this._stripTags(cleanRoot || '')).length;
  },

  // Real topic categories only (hrefs are percent-encoded): skip proofread
  // progress ("25%") and maintenance cats.
  // NOTE: kept linear on purpose — an earlier alternation-based pattern
  // (nested quantifiers over long %D9%83-style hrefs) caused catastrophic
  // backtracking that hung novel pages indefinitely. Never reintroduce
  // nested quantifiers here: match plain anchors, filter in JS.
  _categories: function (html) {
    var tags = [];
    if (!html) return tags;
    var seen = Object.create(null);
    var re = /<a\s[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var href = m[1];
      if (href.indexOf('/wiki/') !== 0) continue;
      var enc = href.substring(6).split('#')[0].split('?')[0];
      var raw;
      try { raw = decodeURIComponent(enc).replace(/_/g, ' ').trim(); } catch (e) { continue; }
      if (raw.indexOf('تصنيف:') !== 0) continue;
      var t = this._decodeEntities(m[2] || '').trim();
      if (!t) t = raw.substring('تصنيف:'.length);
      if (!t || seen[t]) continue;
      if (/^\d+%?$/.test(t)) continue;
      if (/صفحات تحوي|مجهولة المصدر|بوصلة موجودة|تحتاج|مطبوع|مقالات بدون|جميع المقالات/.test(t)) continue;
      seen[t] = true;
      tags.push(t);
      if (tags.length >= 8) break;
    }
    return tags;
  },

  _firstImage: function (html) {
    if (!html) return undefined;
    var re = /<img[^>]+src="((?:https:)?:?\/\/(?:thumb|upload)\.wikimedia\.org[^"]+)"[^>]*>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var src = m[1];
      if (/Wikidata-logo|EPUB|Mobi|mobi|Document-|Gnome-|Wikipedia-logo|OOjs|Ambox|Commons-logo|Wikisource-logo|Question_book|P_|Bible\.png|Jerusalem_dome/i.test(src)) continue;
      var px = src.match(/\/(\d+)px-/);
      if (px && parseInt(px[1], 10) < 80) continue;
      if (src.indexOf('//') === 0) src = 'https:' + src;
      return src;
    }
    return undefined;
  },

  _authorFromHtml: function (html) {
    if (!html) return '';
    var ws = html.match(/<span class="ws-author">([^<]+)<\/span>/i);
    if (ws) return this._decodeEntities(ws[1]).trim();
    var hdr = html.match(/<a[^>]+href="\/wiki\/مؤلف:[^"]*"[^>]*>([^<]+)<\/a>/i);
    if (hdr) return this._decodeEntities(hdr[1]).trim();
    return '';
  },

  _fetchHtml: async function (url, ctx) {
    var res = await _fetchCachedRaw(url, ctx);
    if (!res || !res.ok) {
      throw new Error('فشل جلب الصفحة: ' + (res ? res.status : 'Network error'));
    }
    return res.text;
  },

  _fetchJson: async function (url, ctx) {
    var res = await _fetchCachedRaw(url, ctx);
    if (!res || !res.ok) {
      throw new Error('فشل جلب البيانات: ' + (res ? res.status : 'Network error'));
    }
    try {
      return typeof res.text === 'string' ? JSON.parse(res.text) : res.text;
    } catch (e) {
      throw new Error('رد غير صالح من واجهة ويكي مصدر');
    }
  },

  // ---------------------------------------------------------------
  // Metadata & Novel Details
  // ---------------------------------------------------------------
  parseNovelInfo: async function (url, ctx) {
    var baseUrl = String(url || '').split('#')[0];
    var fullUrl = this._absUrl(baseUrl);
    var html = await this._fetchHtml(fullUrl, ctx);

    var title = '';
    var h1 = html.match(/<h1[^>]*id="firstHeading"[^>]*>([\s\S]*?)<\/h1>/i) ||
             html.match(/<span class="ws-title">([^<]+)<\/span>/i) ||
             html.match(/<title>([^<]+)<\/title>/i);
    if (h1) {
      title = this._decodeEntities(this._stripTags(h1[1])).replace(/\s*-\s*ويكي مصدر\s*$/i, '').trim();
    }
    if (!title) title = this._pageTitleFromUrl(fullUrl) || 'كتاب بدون عنوان';

    var author = this._authorFromHtml(html) || 'ويكي مصدر';

    var root = this._cleanContentRoot(this._contentRoot(html));
    var summary = '';
    var pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    var pm;
    var sumParts = [];
    while ((pm = pRe.exec(root)) !== null && sumParts.length < 3) {
      var pt = this._cleanInline(pm[1]);
      if (pt) sumParts.push(pt);
    }
    if (sumParts.length > 0) {
      summary = sumParts.join('\n\n');
      if (summary.length > 600) summary = summary.substring(0, 600).trim() + '…';
    }

    var coverUrl = this._firstImage(html);
    var tags = this._categories(html);
    var category = tags.length > 0 ? tags[0] : 'نصوص حرة';

    // Cheap chapter estimate (no subpage fetches here).
    var subpages = this._extractSubpages(root, this._pageTitleFromUrl(fullUrl));
    var h2 = this._extractH2(root);
    var totalChapters = subpages.length > 0 ? subpages.length : (h2.length > 0 ? h2.length : 1);

    var words = this._decodeEntities(this._stripTags(root)).split(/\s+/).filter(Boolean).length;

    return {
      source: this.id,
      url: fullUrl,
      title: title,
      author: author,
      coverUrl: coverUrl,
      summary: summary,
      status: 'مكتملة',
      category: category,
      tags: tags,
      totalChapters: totalChapters,
      wordCount: words > 0 ? words : undefined,
      readingMinutes: words > 0 ? Math.max(1, Math.round(words / 140)) : undefined
    };
  },

  // ---------------------------------------------------------------
  // Chapter List — 3 branches + size-guard anchor expansion
  // ---------------------------------------------------------------
  parseChapterList: async function (novelUrl, ctx) {
    var baseUrl = String(novelUrl || '').split('#')[0];
    var fullUrl = this._absUrl(baseUrl);
    var mainTitle = this._pageTitleFromUrl(fullUrl);
    var html = await this._fetchHtml(fullUrl, ctx);
    var root = this._cleanContentRoot(this._contentRoot(html));

    var subpages = this._extractSubpages(root, mainTitle);
    var chapters = [];
    var num = 1;
    var self = this;

    if (subpages.length > 0) {
      for (var i = 0; i < subpages.length; i++) {
        var sp = subpages[i];
        var subHtml = null;
        try {
          subHtml = await self._fetchHtml(sp.url, ctx);
        } catch (e) {
          subHtml = null;
        }
        if (!subHtml) {
          chapters.push({ url: sp.url, number: num++, title: sp.title });
          continue;
        }
        var subRoot = self._cleanContentRoot(self._contentRoot(subHtml));
        // Expand only on 5+ real story headings. Anything smaller stays one
        // chapter — expanding on size alone drops pages with few headings.
        var h2 = self._extractH2(subRoot).filter(function (h) {
          if (_META_H2_RE.test(h.title)) return false;
          var normH = h.title.replace(/\s+/g, ' ').trim();
          var normSp = sp.title.replace(/\s+/g, ' ').trim();
          if (normH === normSp) return false;
          return true;
        });
        if (h2.length >= _H2_SPLIT_MIN) {
          for (var j = 0; j < h2.length; j++) {
            chapters.push({
              url: sp.url.split('#')[0] + '#' + h2[j].id,
              number: num++,
              title: sp.title + ' — ' + h2[j].title
            });
          }
        } else {
          chapters.push({ url: sp.url, number: num++, title: sp.title });
        }
      }
    } else {
      var h2main = this._extractH2(root).filter(function (h) {
        return !_META_H2_RE.test(h.title);
      });
      var h2main = this._extractH2(root);
      if (h2main.length > 0) {
        for (var k = 0; k < h2main.length; k++) {
          chapters.push({
            url: fullUrl.split('#')[0] + '#' + h2main[k].id,
            number: num++,
            title: h2main[k].title
          });
        }
      }
    }

    if (chapters.length === 0) {
      chapters.push({ url: fullUrl, number: 1, title: mainTitle || 'قراءة الكتاب' });
    }

    return chapters;
  },

  // ---------------------------------------------------------------
  // Chapter Content — full page or single h2-anchor slice
  // ---------------------------------------------------------------
  parseChapterContent: async function (chapterUrl, ctx) {
    var raw = String(chapterUrl || '');
    var hashIdx = raw.indexOf('#');
    var anchor = hashIdx !== -1 ? raw.substring(hashIdx + 1) : '';
    try { anchor = decodeURIComponent(anchor); } catch (e) {}
    var baseUrl = this._absUrl(hashIdx !== -1 ? raw.substring(0, hashIdx) : raw);
    var html = await this._fetchHtml(baseUrl, ctx);

    var clean = this._cleanContentRoot(this._contentRoot(html));
    var scope = clean;
    if (anchor) {
      var sliced = this._sliceAnchor(clean, anchor);
      if (sliced) scope = sliced;
    }

    var paragraphs = [];
    var re = /<(p|h2|h3|h4|li|dd)[^>]*>([\s\S]*?)<\/\1>/gi;
    var m;
    while ((m = re.exec(scope)) !== null) {
      if (/<(ul|ol|dl|table)[\s>]/i.test(m[2]) && m[1] !== 'p') continue;
      var text = this._cleanInline(m[2]).trim();
      if (!text) continue;
      paragraphs.push(text);
    }

    // Poetry / centered-verse blocks without <p> wrappers.
    if (paragraphs.length === 0) {
      var verseBlocks = [];
      var vre = /<div[^>]*align="center"[^>]*>([\s\S]*?)<\/div>/gi;
      var vm;
      while ((vm = vre.exec(scope)) !== null) {
        var vt = this._cleanInline(vm[1]).trim();
        if (vt) verseBlocks.push(vt);
      }
      if (verseBlocks.length > 0) return verseBlocks.join('\n\n');
      var fallback = this._cleanInline(scope).replace(/\n\s*\n/g, '\n\n').trim();
      if (!fallback) throw new Error('لم يتم العثور على نص الفصل');
      return fallback;
    }

    return paragraphs.join('\n\n');
  },

  // ---------------------------------------------------------------
  // Search & Catalog (MediaWiki Action API)
  // ---------------------------------------------------------------
  _mapSearchResults: function (json) {
    var out = [];
    if (!json || !json.query || !json.query.search) return out;
    var arr = json.query.search;
    for (var i = 0; i < arr.length; i++) {
      var it = arr[i];
      if (!it || !it.title) continue;
      if (it.title.indexOf(':') !== -1) continue; // skip namespace hits
      out.push({
        source: this.id,
        url: this._absUrl('/wiki/' + encodeURIComponent(it.title.replace(/ /g, '_'))),
        title: it.title,
        author: 'ويكي مصدر',
        category: 'نصوص حرة',
        status: 'مكتملة'
      });
    }
    return out;
  },

  searchNovels: async function (query, page, ctx) {
    var q = (query || '').trim();
    if (!q) return this.getPopularNovels(page, ctx);
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    var offset = (pageNum - 1) * 20;
    var url = this._absUrl(
      '/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(q) +
      '&srnamespace=0&srlimit=20&sroffset=' + offset + '&format=json'
    );
    var json;
    try {
      json = await this._fetchJson(url, ctx);
    } catch (e) {
      return [];
    }
    return this._mapSearchResults(json);
  },

  // Popular shelf: merged main-namespace members of the two verified story
  // categories (تصنيف:قصص + تصنيف:روايات). The old بوابة:قصة shelf held 6
  // works only, and تصنيف:قصة holds a single page — hence the merge.
  _POPULAR_CATS: ['قصص', 'روايات'],

  _mergeUnique: function (lists) {
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < lists.length; i++) {
      var arr = lists[i] || [];
      for (var j = 0; j < arr.length; j++) {
        var it = arr[j];
        if (!it || !it.url || seen[it.url]) continue;
        seen[it.url] = true;
        out.push(it);
      }
    }
    return out;
  },

  _mapCategoryMembers: function (json) {
    var out = [];
    if (!json || !json.query || !json.query.categorymembers) return { results: out, cont: null };
    var arr = json.query.categorymembers;
    for (var i = 0; i < arr.length; i++) {
      var it = arr[i];
      if (!it || !it.title || it.ns !== 0) continue;
      out.push({
        source: this.id,
        url: this._absUrl('/wiki/' + encodeURIComponent(it.title.replace(/ /g, '_'))),
        title: it.title,
        author: 'ويكي مصدر',
        category: 'نصوص حرة',
        status: 'مكتملة'
      });
    }
    var cont = (json.continue && json.continue.cmcontinue) ? json.continue.cmcontinue : null;
    return { results: out, cont: cont };
  },

  _browseCategory: async function (category, page, ctx) {
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    var cont = null;
    var mapped = { results: [], cont: null };
    for (var hop = 1; hop <= pageNum; hop++) {
      var url = this._absUrl(
        '/w/api.php?action=query&list=categorymembers&cmtitle=' +
        encodeURIComponent('تصنيف:' + category) +
        '&cmtype=page&cmlimit=20&format=json' +
        (cont ? '&cmcontinue=' + encodeURIComponent(cont) : '')
      );
      var json;
      try {
        json = await this._fetchJson(url, ctx);
      } catch (e) {
        return hop === 1 ? [] : null;
      }
      mapped = this._mapCategoryMembers(json);
      cont = mapped.cont;
      if (hop < pageNum && !cont) return null;
    }
    return mapped.results;
  },

  getPopularNovels: async function (page, ctx) {
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    var self = this;
    var lists = [];
    for (var i = 0; i < self._POPULAR_CATS.length; i++) {
      var res = await self._browseCategory(self._POPULAR_CATS[i], pageNum, ctx);
      if (res && res.length > 0) lists.push(res);
    }
    return self._mergeUnique(lists);
  },

  // ---------------------------------------------------------------
  // Category / Topic browsing (verified main-namespace categories)
  // ---------------------------------------------------------------
  getCategories: async function () {
    return [
      { name: 'قصص وروايات', slug: 'qisas-riwayat' },
      { name: 'قصص', slug: 'قصص' },
      { name: 'روايات', slug: 'روايات' },
      { name: 'أدب', slug: 'أدب' },
      { name: 'شعر', slug: 'شعر' }
    ];
  },

  getCategoryNovels: async function (categorySlug, page, ctx) {
    var slug = (categorySlug || 'qisas-riwayat').trim() || 'qisas-riwayat';
    if (slug === 'qisas-riwayat' || slug === 'qissa') {
      return this.getPopularNovels(page, ctx);
    }
    var out = await this._browseCategory(slug, page, ctx);
    return out || [];
  }
});
