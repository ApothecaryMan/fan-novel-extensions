// site:hindawi — remote-JS extension for مؤسسة هنداوي (hindawi.org / safahat.org)
// Clean sandboxed scraper adhering to the Extension Runtime Specification (ctx.xFetch).
// Features:
//   - Fast in-memory module-level cache to eliminate redundant requests between parseNovelInfo and parseChapterList.
//   - Clean chapter division based on the official book index.
//   - Rich book metadata (author, translator, tags, word count, high-res covers).
//   - Internal topic categorization (novels, detective, literature, history, philosophy, etc.).
//   - Fast search by keyword.
//
var _htmlCache = Object.create(null); // url -> { res, ts }
var _HTML_CACHE_TTL_MS = 5 * 60 * 1000;
var _HTML_CACHE_CAP = 12;
var _inFlight = Object.create(null); // url -> Promise<res>

function _fetchCachedPage(url, ctx) {
  var now = Date.now();
  var hit = _htmlCache[url];
  if (hit && (now - hit.ts) < _HTML_CACHE_TTL_MS) {
    return Promise.resolve(hit.res);
  }
  if (_inFlight[url]) {
    return _inFlight[url];
  }
  var p = ctx.xFetch(url).then(function (res) {
    delete _inFlight[url];
    if (res && res.ok) {
      _htmlCache[url] = { res: res, ts: now };
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
  id: 'site:hindawi',
  name: 'مؤسسة هنداوي',
  lang: 'ar',
  version: '1.0.0',
  apiVersion: 1,
  baseUrl: 'https://www.safahat.org',

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
      ldquo: '\u201C', rdquo: '\u201D', middot: '·', bull: '•', rlm: ''
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

  _getJpgCover: function (urlOrId) {
    if (!urlOrId) return undefined;
    var m = String(urlOrId).match(/(\d{7,10})/);
    if (m) {
      return 'https://downloads.hindawi.org/covers/304x406/' + m[1] + '.jpg';
    }
    return this._absUrl(urlOrId);
  },

  // ---------------------------------------------------------------
  // Metadata & Novel Details
  // ---------------------------------------------------------------
  parseNovelInfo: async function (url, ctx) {
    var fullUrl = this._absUrl(url);
    var res = await _fetchCachedPage(fullUrl, ctx);
    if (!res || !res.ok) {
      throw new Error('فشل جلب بيانات الكتاب: ' + (res ? res.status : 'Network error'));
    }
    var html = res.text;

    // 1. Title
    var title = '';
    var titleMatch = html.match(/<article[^>]*class="[^"]*book[^"]*"[\s\S]*?<div[^>]*class="[^"]*details[^"]*"[\s\S]*?<h2>([^<]+)<\/h2>/i);
    if (titleMatch) {
      title = this._decodeEntities(titleMatch[1]).trim();
    } else {
      var ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
      if (ogTitle) {
        title = this._decodeEntities(ogTitle[1]).split('|')[0].trim();
      }
    }

    // 2. Author & Translator
    var author = '';
    var authorMatch = html.match(/<div[^>]*class="[^"]*author[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
    if (authorMatch) {
      author = this._decodeEntities(authorMatch[1]).trim();
    }
    var translatorMatch = html.match(/<span>\s*ترجمة\s*<\/span>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
    if (translatorMatch) {
      var transName = this._decodeEntities(translatorMatch[1]).trim();
      if (transName) {
        author = author ? author + ' (ترجمة: ' + transName + ')' : 'ترجمة: ' + transName;
      }
    }

    // 3. Cover URL (Use 304x406 JPG for fast native mobile rendering)
    var coverUrl = this._getJpgCover(fullUrl);
    if (!coverUrl) {
      var coverMatch = html.match(/<div[^>]*class="[^"]*cover[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i) ||
                       html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
      if (coverMatch) {
        coverUrl = this._getJpgCover(coverMatch[1]);
      }
    }

    // 4. Tags & Categories & Word count
    var tags = [];
    var category = 'كتب وروايات';
    var catMatch = html.match(/<ul[^>]*class="[^"]*tags[^"]*"[^>]*>([\s\S]*?)<\/ul>/i);
    if (catMatch) {
      var tagRegex = /<a[^>]+href="[^"]*\/categories\/([^"\/]+)\/"[^>]*>([^<]+)<\/a>/gi;
      var tm;
      while ((tm = tagRegex.exec(catMatch[1])) !== null) {
        var tagName = this._decodeEntities(tm[2]).trim();
        if (tagName) {
          tags.push(tagName);
          if (category === 'كتب وروايات') category = tagName;
        }
      }
    }

    // Word count badge as tag
    var wordMatch = html.match(/<span>\s*([٠-٩0-9,]+)\s*كلمة\s*<\/span>/i);
    if (wordMatch) {
      var wordCountStr = this._decodeEntities(wordMatch[1]).trim();
      tags.push(wordCountStr + ' كلمة');
    }

    // Add source tag
    tags.push('مؤسسة هنداوي');

    // 5. Summary
    var summary = '';
    var summaryMatch = html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>[\s\S]*?<div>([\s\S]*?)<\/div>/i);
    if (summaryMatch) {
      var rawSummary = summaryMatch[1]
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
      summary = this._decodeEntities(this._stripTags(rawSummary));
    }

    // 6. Chapters count
    var totalChapters = 0;
    var indexBlockMatch = html.match(/<div[^>]*class="[^"]*bookIndex[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (indexBlockMatch) {
      var chMatches = indexBlockMatch[1].match(/<a[^>]+href="[^"]*"[^>]*>/gi);
      if (chMatches) totalChapters = chMatches.length;
    }

    return {
      source: this.id,
      url: fullUrl,
      title: title || 'كتاب بدون عنوان',
      author: author || 'مؤسسة هنداوي',
      coverUrl: coverUrl,
      summary: summary,
      status: 'مكتملة',
      category: category,
      tags: tags,
      totalChapters: totalChapters || undefined
    };
  },

  // ---------------------------------------------------------------
  // Chapter List
  // ---------------------------------------------------------------
  parseChapterList: async function (novelUrl, ctx) {
    var fullUrl = this._absUrl(novelUrl);
    var res = await _fetchCachedPage(fullUrl, ctx);
    if (!res || !res.ok) {
      throw new Error('فشل جلب فهرس الكتاب: ' + (res ? res.status : 'Network error'));
    }
    var html = res.text;
    var chapters = [];

    var indexBlockMatch = html.match(/<div[^>]*class="[^"]*bookIndex[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (indexBlockMatch) {
      var chRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      var cm;
      var num = 1;
      while ((cm = chRegex.exec(indexBlockMatch[1])) !== null) {
        var chUrl = this._absUrl(cm[1]);
        var rawTitle = this._decodeEntities(this._stripTags(cm[2])).trim();
        chapters.push({
          url: chUrl,
          number: num++,
          title: rawTitle || ('فصل ' + (num - 1))
        });
      }
    }

    // If the book does not have an index table (single-piece work), provide the book root as chapter 1
    if (chapters.length === 0) {
      chapters.push({
        url: fullUrl.replace(/\/$/, '') + '/1/',
        number: 1,
        title: 'قراءة الكتاب'
      });
    }

    return chapters;
  },

  // ---------------------------------------------------------------
  // Chapter Content
  // ---------------------------------------------------------------
  parseChapterContent: async function (chapterUrl, ctx) {
    var fullUrl = this._absUrl(chapterUrl);
    var res = await _fetchCachedPage(fullUrl, ctx);
    if (!res || !res.ok) {
      throw new Error('فشل جلب محتوى الفصل: ' + (res ? res.status : 'Network error'));
    }
    var html = res.text;

    var articleMatch = html.match(/<article[^>]*class="[^"]*chapterContent[^"]*"[^>]*>([\s\S]*?)<\/article>/i);
    if (!articleMatch) {
      articleMatch = html.match(/<div[^>]*class="[^"]*chapterContent[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    }
    if (!articleMatch) {
      throw new Error('لم يتم العثور على نص الفصل');
    }

    var content = articleMatch[1];
    // Remove scripts, styles, download buttons, navigations
    content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    content = content.replace(/<div[^>]*class="[^"]*(?:download-icons|shareActions|pages)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');

    // Extract all paragraphs and headers in order
    var paragraphs = [];
    var pRegex = /<(?:p|h1|h2|h3|h4|h5|h6)[^>]*>([\s\S]*?)<\/(?:p|h1|h2|h3|h4|h5|h6)>/gi;
    var pm;
    while ((pm = pRegex.exec(content)) !== null) {
      var text = this._decodeEntities(this._stripTags(pm[1])).trim();
      if (!text) continue;
      // Skip duplicate book-wide titles repeating at the start if it matches standard title
      paragraphs.push(text);
    }

    if (paragraphs.length === 0) {
      return this._decodeEntities(this._stripTags(content)).replace(/\n\s*\n/g, '\n\n').trim();
    }

    return paragraphs.join('\n\n');
  },

  // ---------------------------------------------------------------
  // Search & Catalog
  // ---------------------------------------------------------------
  _parseBookCards: function (html) {
    var results = [];
    var seen = Object.create(null);

    // 1. Search covers grid
    var cardRegex = /<li[^>]*class="[^"]*bookCover[^"]*"[^>]*>[\s\S]*?<a[^>]+href=['"]([^'"]+)['"][^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*alt="([^"]+)"/gi;
    var m;
    while ((m = cardRegex.exec(html)) !== null) {
      var rawUrl = m[1].trim();
      var fullUrl = this._absUrl(rawUrl);
      if (seen[fullUrl]) continue;
      seen[fullUrl] = true;

      var rawTitle = m[3].replace(/^كتاب بعنوان\s*/, '').trim();
      var title = this._decodeEntities(this._stripTags(rawTitle));
      var cover = this._getJpgCover(fullUrl) || m[2];

      results.push({
        source: this.id,
        url: fullUrl,
        title: title,
        coverUrl: cover,
        author: 'مؤسسة هنداوي',
        category: 'كتب وروايات',
        status: 'مكتملة'
      });
    }

    // 2. Search results list (e.g. from /search/keyword/<kw>/)
    if (results.length === 0) {
      var listRegex = /<li>[\s\S]*?<a[^>]+href=['"](\/books\/\d+\/)['"][^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/li>/gi;
      var lm;
      while ((lm = listRegex.exec(html)) !== null) {
        var bookUrl = this._absUrl(lm[1].trim());
        if (seen[bookUrl]) continue;
        seen[bookUrl] = true;

        var bookTitle = this._decodeEntities(this._stripTags(lm[2])).trim();
        var authorChunk = lm[3];
        var authorText = 'مؤسسة هنداوي';
        var authorAnchor = authorChunk.match(/<a[^>]+href=['"]\/contributors\/\d+\/['"][^>]*>([\s\S]*?)<\/a>/i);
        if (authorAnchor) {
          authorText = this._decodeEntities(this._stripTags(authorAnchor[1])).trim();
        }

        results.push({
          source: this.id,
          url: bookUrl,
          title: bookTitle,
          coverUrl: this._getJpgCover(bookUrl),
          author: authorText,
          category: 'كتب وروايات',
          status: 'مكتملة'
        });
      }
    }

    return results;
  },

  searchNovels: async function (query, page, ctx) {
    var q = (query || '').trim();
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;

    if (!q) {
      return this.getPopularNovels(pageNum, ctx);
    }

    // Direct search keyword endpoint
    var searchUrl = this._absUrl('/search/keyword/' + encodeURIComponent(q) + '/');
    if (pageNum > 1) {
      searchUrl += pageNum + '/';
    }

    var res = await _fetchCachedPage(searchUrl, ctx);
    if (!res || !res.ok) return [];
    return this._parseBookCards(res.text);
  },

  getPopularNovels: async function (page, ctx) {
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    var url = this._absUrl('/books/');
    if (pageNum > 1) {
      url += pageNum + '/';
    }
    var res = await _fetchCachedPage(url, ctx);
    if (!res || !res.ok) return [];
    return this._parseBookCards(res.text);
  },

  // ---------------------------------------------------------------
  // Category / Topic browsing
  // ---------------------------------------------------------------
  getCategories: async function () {
    return [
      { name: 'كل الكتب', slug: '' },
      { name: 'روايات', slug: 'novels' },
      { name: 'قصص بوليسية', slug: 'detective.fiction' },
      { name: 'أدب', slug: 'literature' },
      { name: 'أدب رحلات', slug: 'travel.literature' },
      { name: 'خيال علمي', slug: 'science.fiction' },
      { name: 'مسرحيات', slug: 'plays' },
      { name: 'شعر', slug: 'poetry' },
      { name: 'قصص الأطفال', slug: 'children.stories' },
      { name: 'نقد أدبي', slug: 'literary.criticism' },
      { name: 'تاريخ', slug: 'history' },
      { name: 'فلسفة', slug: 'philosophy' },
      { name: 'علم نفس', slug: 'psychology' },
      { name: 'سير الأعلام', slug: 'biographies' },
      { name: 'علوم اجتماعية', slug: 'social.sciences' },
      { name: 'علوم', slug: 'science' },
      { name: 'فنون', slug: 'arts' },
      { name: 'اقتصاد', slug: 'economics' },
      { name: 'سياسة', slug: 'politics' },
      { name: 'إدارة أعمال', slug: 'business' }
    ];
  },

  getCategoryNovels: async function (categorySlug, page, ctx) {
    var slug = (categorySlug || '').trim();
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    if (!slug) {
      return this.getPopularNovels(pageNum, ctx);
    }
    var url = this._absUrl('/books/categories/' + encodeURIComponent(slug) + '/');
    if (pageNum > 1) {
      url += pageNum + '/';
    }
    var res = await _fetchCachedPage(url, ctx);
    if (!res || !res.ok) return [];
    return this._parseBookCards(res.text);
  }
});
