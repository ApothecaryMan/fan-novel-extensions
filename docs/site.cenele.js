// site:cenele — remote-JS extension for فضاء الروايات (cenele.com)
// Clean, fast scraper for the Extension Runtime Specification.
//
// The novel page only renders the last ~8 chapters inline; the FULL list is
// served lazily over the site's WordPress admin-ajax endpoint
// (nhv_manga_single_chapters_page). We fetch the page once (shared between
// parseNovelInfo and parseChapterList via a bounded module cache), then paginate
// the AJAX endpoint with bounded concurrency.
//
// Design notes (why this is lean):
//   - ONE AJAX page-driver serves both the full list and the incremental
//     "latest chapters" path, so there is no duplicated fetch logic.
//   - A single npm-agnostic `ctx.xFetch` bridge; the sandbox never opens sockets.
//   - The 403/429 anti-bot path is handled with retry + backoff + nonce refresh
//     in ONE place instead of being copy-pasted three times.

var _htmlCache = Object.create(null); // url -> { res, ts }
var _HTML_TTL_MS = 3 * 60 * 1000;
var _HTML_CAP = 8;
var _inFlight = Object.create(null); // url -> Promise<res>

function _fetchCached(url, ctx) {
  var now = Date.now();
  var hit = _htmlCache[url];
  if (hit && now - hit.ts < _HTML_TTL_MS) return Promise.resolve(hit.res);
  if (_inFlight[url]) return _inFlight[url];

  var p = ctx.xFetch(url).then(function (res) {
    delete _inFlight[url];
    if (res && res.ok) {
      _htmlCache[url] = { res: res, ts: now };
      var keys = Object.keys(_htmlCache);
      if (keys.length > _HTML_CAP) {
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

function _sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

registerExtension({
  id: 'site:cenele',
  name: 'فضاء الروايات',
  lang: 'ar',
  version: '1.8.0',
  apiVersion: 1,
  baseUrl: 'https://cenele.com',

  // ------------------------------------------------ base helpers
  _absUrl: function (url) {
    if (/^https?:\/\//i.test(url)) return url;
    var base = this.baseUrl.replace(/\/$/, '');
    return base + (url.charAt(0) === '/' ? '' : '/') + url;
  },

  _stripTags: function (html) {
    return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  },

  _decodeEntities: function (str) {
    var named = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
      hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
      ldquo: '“', rdquo: '”', middot: '·', bull: '•'
    };
    return String(str).replace(/&([a-zA-Z][a-zA-Z0-9]*|#[xX]?[0-9a-fA-F]+);/g, function (m, name) {
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

  // Strip "الفصل N"/"Chapter N" prefixes + quote wrappers from a chapter name.
  _stripChapterPrefix: function (name) {
    var s = String(name || '').trim()
      .replace(/^["«“']+|["»”']+$/g, '')
      .replace(/^(?:chapter|ch\.?|فصل|الفصل)\s*(?:الـ)?\s*(\d+(?:\.\d+)?)\s*(?:[-–—:.#|]\s*)?/i, '')
      .replace(/^(?:فصل|الفصل)\s*(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)\s*(?:[:|.\-–—]?\s*)/i, '')
      .replace(/^(?:فصل|الفصل)\s*[:|.\-–—]\s*/i, '');
    return s.replace(/["«»“”'´`^]/g, '').trim();
  },

  // Sort ascending by number, dedupe by url, build "الفصل N - name" titles.
  _finalizeChapters: function (list) {
    var seen = {};
    var out = [];
    list.slice().sort(function (a, b) { return (a.number || 0) - (b.number || 0); })
      .forEach(function (ch, i) {
        if (seen[ch.url]) return;
        seen[ch.url] = true;
        var num = ch.number || i + 1;
        var name = this._stripChapterPrefix(ch.title);
        out.push({ url: ch.url, number: num, title: 'الفصل ' + num + (name ? ' - ' + name : ''), uploadedAt: ch.uploadedAt });
      }, this);
    return out;
  },

  _parseDate: function (raw) {
    if (!raw) return undefined;
    var str = this._toLatinDigits(String(raw).trim());
    if (!str) return undefined;
    var now = Date.now();

    // Relative Arabic ("منذ N وحدة" / "N وحدة منذ").
    var relMs;
    if (/دقيق/.test(str)) relMs = 60 * 1000;
    else if (/ساع/.test(str)) relMs = 3600 * 1000;
    else if (/يوم|يام/.test(str)) relMs = 24 * 3600 * 1000;
    else if (/سبوع|سبيع/.test(str)) relMs = 7 * 24 * 3600 * 1000;
    else if (/شهر/.test(str)) relMs = 30 * 24 * 3600 * 1000;
    else if (/سن|عام/.test(str)) relMs = 365 * 24 * 3600 * 1000;
    if (relMs) {
      if (str.indexOf('منذ') !== -1) {
        var m = str.match(/(\d+)/);
        return now - relMs * (m ? parseInt(m[1], 10) : 1);
      }
    }

    // Absolute Arabic month names.
    var months = {
      'يناير': 0, 'كانون الثاني': 0, 'جانفي': 0, 'فبراير': 1, 'شباط': 1, 'فيفري': 1,
      'مارس': 2, 'آذار': 2, 'اذار': 2, 'أبريل': 3, 'ابريل': 3, 'نيسان': 3, 'افريل': 3,
      'مايو': 4, 'أيار': 4, 'ايار': 4, 'ماي': 4, 'يونيو': 5, 'حزيران': 5, 'جوان': 5,
      'يوليو': 6, 'تموز': 6, 'جويلية': 6, 'أغسطس': 7, 'اغسطس': 7, 'آب': 7, 'اب': 7, 'غشت': 7, 'اوت': 7,
      'سبتمبر': 8, 'أيلول': 8, 'ايلول': 8, 'شتنبر': 8, 'أكتوبر': 9, 'اكتوبر': 9,
      'تشرين الأول': 9, 'تشرين الاول': 9, 'نوفمبر': 10, 'تشرين الثاني': 10,
      'ديسمبر': 11, 'كانون الأول': 11, 'كانون الاول': 11, 'دجنبر': 11
    };
    for (var mName in months) {
      if (str.indexOf(mName) !== -1) {
        var nums = str.match(/\d+/g);
        if (!nums) return undefined;
        var day = parseInt(nums[0], 10);
        var year = nums.length > 1 ? parseInt(nums[1], 10) : new Date().getFullYear();
        if (day > 1000) { var t = day; day = year; year = t; }
        if (year < 100) year += 2000;
        var d = new Date(year, months[mName], day, 12, 0, 0);
        if (!isNaN(d.getTime())) return d.getTime();
      }
    }

    var parsed = Date.parse(str);
    return isNaN(parsed) ? undefined : parsed;
  },

  // POST form-encoded data to the site's admin-ajax endpoint via the host bridge.
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

  // Parse a JSON AJAX body regardless of host response shape (text string under
  // .text/.data, or an already-decoded object under .json/.body/.data, or the
  // response object itself). Non-JSON (anti-bot HTML) yields `def`.
  _parseAjaxJson: function (res, def) {
    def = def || {};
    if (!res) return def;
    for (var i = 0; i < 3; i++) {
      var key = ['json', 'body', 'data'][i];
      var holder = res[key];
      if (holder && typeof holder === 'object') return holder;
      if (typeof holder === 'string') {
        var parsed = this._tryJson(holder);
        if (parsed !== undefined) return parsed;
      }
    }
    var textJ = this._tryJson(res.text);
    if (textJ !== undefined) return textJ;
    if (typeof res === 'object' && ('success' in res || 'html' in res || 'data' in res)) return res;
    return def;
  },

  _tryJson: function (raw) {
    if (typeof raw !== 'string') return undefined;
    try {
      var p = JSON.parse(raw);
      return p && typeof p === 'object' ? p : undefined;
    } catch (e) {
      return undefined;
    }
  },

  // Wrap a network call so a genuine transport exception becomes a clear labeled
  // Error instead of an unhandled rejection.
  _safeFetch: async function (urlOrOpts, ctx, label) {
    try {
      return await ctx.xFetch(urlOrOpts);
    } catch (e) {
      throw new Error((label || 'فشل الاتصال') + ': ' + (e && e.message ? e.message : String(e)));
    }
  },

  // -------------------------------------------------- AJAX page driver
  // Resolve the IDs the chapter AJAX needs from the novel page. The nonce
  // lives in the inline `nhvNovelV2` script object; postId also appears in the
  // <body> class (postid-N) and the shortlink for when scripts are stripped.
  _nhvProps: function (html) {
    var postId, chaptersNonce, ajaxUrl;
    var idx = html.indexOf('nhvNovelV2');
    if (idx !== -1) {
      var region = html.slice(idx, idx + 1600);
      postId = (region.match(/"postId"\s*:\s*"(\d+)"/) || [])[1];
      chaptersNonce = (region.match(/"chaptersNonce"\s*:\s*"([^"]+)"/) || [])[1];
      ajaxUrl = (region.match(/"ajaxurl"\s*:\s*"([^"]+)"/) || [])[1];
    }
    if (!postId) {
      postId = (html.match(/<body[^>]*class="[^"]*\bpostid-(\d+)\b/i) || [])[1] ||
               (html.match(/<link[^>]+rel=['"]shortlink['"][^>]*\?p=(\d+)/i) || [])[1];
    }
    if (!ajaxUrl) {
      ajaxUrl = (html.match(/data-nhv-track-url="([^"]+)"/i) || [])[1] ||
                this.baseUrl + '/wp-admin/admin-ajax.php';
    }
    if (!postId || !ajaxUrl) return null;
    return { postId: postId, chaptersNonce: chaptersNonce, ajaxUrl: ajaxUrl };
  },

  // Fetch one chapter-list page with retry + backoff + nonce refresh.
  // Returns the unwrapped JSON payload, or null when un-fetchable.
  _fetchChapterPage: async function (props, pageNum, ctx, state) {
    for (var attempt = 0; attempt < 5; attempt++) {
      var r = await this._ajaxPost(props.ajaxUrl, {
        action: 'nhv_manga_single_chapters_page',
        nonce: state.nonce,
        manga_id: props.postId,
        volume: '-1',
        page: String(pageNum),
        per_page: '100'
      }, ctx);
      if (r.status === 403 && !state.nonceRefreshed) {
        var refJ = this._parseAjaxJson(await this._ajaxPost(props.ajaxUrl, { action: 'nhv_refresh_front_nonces' }, ctx));
        if (refJ.data && refJ.data.chapters_nonce) {
          state.nonce = refJ.data.chapters_nonce;
          state.nonceRefreshed = true;
        }
        continue;
      }
      if (r.status === 403 || r.status === 429 || r.status === 503 || !r.ok) {
        await _sleep(700 * (attempt + 1));
        continue;
      }
      var page = this._parseAjaxJson(r);
      // Unwrap WordPress {success, data: {html, total, ...}} envelope.
      if (page.data && typeof page.data === 'object' && page.data.html) page = page.data;
      return page && page.html ? page : null;
    }
    return null;
  },

  // Ensure we have a usable nonce, refreshing it once if the page's script
  // block (with the nonce) was stripped by the host. Mutates `state`.
  _ensureNonce: async function (props, ctx, state) {
    if (state.nonce) return;
    var refJ = this._parseAjaxJson(await this._ajaxPost(props.ajaxUrl, { action: 'nhv_refresh_front_nonces' }, ctx));
    if (refJ.data && refJ.data.chapters_nonce) state.nonce = refJ.data.chapters_nonce;
  },

  // Fetch the requested chapter-list pages. `onlyLast` fetches just the final
  // page (incremental path); otherwise every page up to the total is fetched
  // with bounded concurrency. Returns ChapterMeta[] from the page HTML.
  _loadChapters: async function (html, ctx, onlyLast) {
    var props = this._nhvProps(html);
    if (!props) return null;
    var state = { nonce: props.chaptersNonce, nonceRefreshed: false };
    await this._ensureNonce(props, ctx, state);

    var first = await this._fetchChapterPage(props, 1, ctx, state);
    if (!first) return null;
    var total = parseInt(first.total, 10) || 0;
    var perPage = parseInt(first.per_page, 10) || 100;
    var lastPage = total > 0 ? Math.ceil(total / perPage) : (first.has_more ? 2 : 1);

    var pageHtmls = [];
    if (onlyLast) {
      // Incremental: yield ONLY the newest chapters (last page). The server
      // ignores `order`, so the newest live on the final page — page 1 is only
      // fetched to learn the exact total/last page.
      if (lastPage > 1) {
        var last = await this._fetchChapterPage(props, lastPage, ctx, state);
        pageHtmls.push((last || first).html);
      } else {
        pageHtmls.push(first.html);
      }
    } else {
      pageHtmls = [first.html];
      var pages = [];
      for (var p = 2; p <= lastPage; p++) pages.push(p);
      var idx = 0;
      var collected = [];
      var worker = async () => {
        while (idx < pages.length) {
          var cur = pages[idx++];
          var ph = await this._fetchChapterPage(props, cur, ctx, state);
          if (ph) collected.push(ph.html);
        }
      };
      var workers = [];
      for (var w = 0; w < Math.min(4, pages.length); w++) workers.push(worker());
      await Promise.all(workers);
      pageHtmls = pageHtmls.concat(collected);
    }

    var all = [];
    pageHtmls.forEach(function (pageHtml) {
      this._parseChapterRows(pageHtml).forEach(function (ch) { all.push(ch); });
    }, this);
    return all.length ? this._finalizeChapters(all) : null;
  },

  // -------------------------------------------------- chapter rows
  _parseChapterRows: function (html) {
    var chapters = [];
    var regex = /<li[^>]*data-chapter-id="(\d+)"[^>]*class="[^"]*wp-manga-chapter[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    var match;
    while ((match = regex.exec(html)) !== null) {
      var block = match[2];
      var linkMatch = block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;
      var rawTitle = this._decodeEntities(this._stripTags(linkMatch[2]));
      var cleanTitle = this._toLatinDigits(rawTitle);
      var numMatch = cleanTitle.match(/(?:الفصل|فصل|Chapter|Ch\.?)\s*(?:الـ)?\s*(\d+(?:\.\d+)?)/i);
      var number = numMatch ? parseFloat(numMatch[1]) : 0;
      if (!number) {
        var nf = cleanTitle.match(/(\d+(?:\.\d+)?)/);
        number = nf ? parseFloat(nf[1]) : 0;
      }
      var dateMatch = block.match(/<span[^>]*class="[^"]*chapter-release-date[^"]*"[^>]*>([\s\S]*?)<\/span>/i) ||
                      block.match(/<i>([\s\S]*?)<\/i>/i);
      chapters.push({
        url: linkMatch[1].trim(),
        number: number,
        title: this._stripChapterPrefix(rawTitle),
        uploadedAt: dateMatch ? this._parseDate(this._stripTags(dateMatch[1])) : undefined
      });
    }
    return chapters;
  },

  // -------------------------------------------------- metadata
  parseNovelInfo: async function (url, ctx) {
    var fullUrl = this._absUrl(url);
    var res = await _fetchCached(fullUrl, ctx);
    if (!res.ok) throw new Error('فشل جلب تفاصيل الرواية: ' + res.status);
    var html = res.text;

    var titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/<title>([^–\-&#<]+)/i);
    var title = titleMatch ? this._stripTags(titleMatch[1]).replace(/فضاء الروايات/g, '').trim() : 'رواية';

    var coverMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ||
                     html.match(/<div[^>]*class="[^"]*nhv-novel-cover[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^">]+)"/i) ||
                     html.match(/<img[^>]+class="[^"]*wp-post-image[^"]*"[^>]+src="([^">]+)"/i);

    var authorSlug = (html.match(/https?:\/\/[^"\s]+\/cont-author\/([^"\/\?#]+)/i) || [])[1];
    var author = authorSlug
      ? decodeURIComponent(authorSlug).replace(/[-_]+/g, ' ').trim()
      : undefined;
    if (!author) {
      var artistSlug = (html.match(/https?:\/\/[^"\s]+\/cont-artist\/([^"\/\?#]+)/i) || [])[1];
      if (artistSlug) author = 'المترجم: ' + decodeURIComponent(artistSlug).replace(/[-_]+/g, ' ').trim();
    }

    var isCompleted = html.indexOf('مكتملة') !== -1 && html.indexOf('مستمرة') === -1;
    var summary;
    var synopsis = html.match(/<div[^>]*class="[^"]*nhv-novel-synopsis[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (synopsis) {
      var block = synopsis[1]
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
      var cut = block.search(/دعم المترجم|إقرأ وأكتب تعليقات|اقرأ وأكتب تعليقات|أكتب تعليقات/i);
      if (cut !== -1) block = block.slice(0, cut);
      summary = this._decodeEntities(this._stripTags(block)).replace(/[\s{]+$/g, '');
    }

    // The detail page exposes only numeric genre IDs (no names); browse/search
    // cards provide genres as tags, and the app preserves those preview tags.
    return {
      source: this.id,
      url: fullUrl,
      title: title,
      author: author,
      coverUrl: coverMatch ? coverMatch[1].trim() : undefined,
      summary: summary,
      status: isCompleted ? 'مكتملة' : 'مستمرة',
      totalChapters: undefined,
      category: 'روايات مترجمة'
    };
  },

  // -------------------------------------------------- chapter list
  parseChapterList: async function (novelUrl, ctx) {
    var fullUrl = this._absUrl(novelUrl);
    var res = await _fetchCached(fullUrl, ctx);
    if (!res.ok) throw new Error('فشل جلب قائمة الفصول: ' + res.status);
    var chapters = await this._loadChapters(res.text, ctx, false);
    return chapters || this._finalizeChapters(this._parseChapterRows(res.text));
  },

  // -------------------------------------------------- incremental refresh
  fetchLatestChapters: async function (novelUrl, knownCount, ctx) {
    var fullUrl = this._absUrl(novelUrl);
    var res = await _fetchCached(fullUrl, ctx);
    if (!res.ok) throw new Error('فشل جلب أحدث الفصول: ' + res.status);
    var chapters = await this._loadChapters(res.text, ctx, true);
    return chapters || this._finalizeChapters(this._parseChapterRows(res.text));
  },

  // -------------------------------------------------- chapter body
  parseChapterContent: async function (chapterUrl, ctx) {
    var res = await ctx.xFetch(this._absUrl(chapterUrl));
    if (!res.ok) throw new Error('فشل جلب نص الفصل: ' + res.status);
    var html = res.text;

    var panelMatch = html.match(/<novel-chapter[^>]*>([\s\S]*?)<\/novel-chapter>/i) ||
                     html.match(/<div[^>]*\bid="chapter-[^"]*"[^>]*class="[^"]*reading-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                     html.match(/<div[^>]*class="[^"]*reading-content[^"]*\bcurrent\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                     html.match(/<div[^>]*class="[^"]*reading-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!panelMatch) throw new Error('تعذر العثور على نص الفصل');

    var body = panelMatch[1]
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<div[^>]*class="[^"]*nhv-reading-chapter-head[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
      .replace(/<div[^>]*class="[^"]*\bad\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');

    var paragraphs = [];
    var blockRegex = /<(?:div|p|li|h[1-6])[^>]*>([\s\S]*?)<\/(?:div|p|li|h[1-6])>/gi;
    var bm;
    while ((bm = blockRegex.exec(body)) !== null) {
      var text = this._decodeEntities(this._stripTags(bm[1]));
      if (!text) continue;
      if (/^(نهاية الفصل|تم الفصل|الفصل التالي|انتهى الفصل|النهاية|تمت)/.test(text)) break;
      if (/^[-ـ—_]{3,}$/.test(text)) continue;
      if (/^بسم الله/.test(text)) continue;
      text = text.replace(/^\s*(المترجم|مترجم|الترجمة|ترجمة)\s*[:|]?\s*[^\n]*$/i, '').trim();
      if (!text) continue;
      text = text.replace(/^\s*(?:chapter|ch\.?)\s*\d+(?:\s*[:.—|-]\s*|\s+|$)/i, '').trim();
      text = text.replace(/^\s*(?:فصل|الفصل)\s*\d+(?:\s*[:.—|-]\s*|\s+|$)/i, '').trim();
      text = text.replace(/^\s*(?:فصل|الفصل)\s+(?:الـ|ال|رقم|عدد)\s*\d+(?:\s*[:.—|-]\s*|\s+|$)/i, '').trim();
      text = text.replace(/^\s*(?:فصل|الفصل)\s+(?:الحادي|الثانية?|الثانية?)?\s*عشر(?:اء)?\s*[:.—|-]?\s*/i, '').trim();
      text = text.replace(/^\s*(?:فصل|الفصل)\s+(?:الأول|الثاني|الثالث|الرابع|الخامس)\s+عشر\s*[:.—|-]?\s*/i, '').trim();
      text = text.replace(/^\s*(?:فصل|الفصل)\s+(?:السادس|السابع|الثامن|التاسع|العاشر)\s+عشر\s*[:.—|-]?\s*/i, '').trim();
      text = text.replace(/^\s*(?:فصل|الفصل)\s+(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)\s*[:.—|-]?\s*/i, '').trim();
      text = text.replace(/^\s*(?:فصل|الفصل)\s+(?:عشرون|ثلاثون|أربعون|خمسون|ستون|سبعون|ثمانون|تسعون)\s*[:.—|-]?\s*/i, '').trim();
      if (text) paragraphs.push(text);
    }

    if (!paragraphs.length) {
      return this._decodeEntities(body.replace(/<[^>]+>/g, '\n').replace(/\s+\n/g, '\n').trim());
    }
    return paragraphs.join('\n\n');
  },

  // -------------------------------------------------- search / browse
  searchNovels: async function (query, page, ctx) {
    var isBrowse = !query || !query.trim();
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    var url = isBrowse
      ? this._absUrl((pageNum > 1 ? '/cont/page/' + pageNum + '/' : '/cont/')) + '?m_orderby=views'
      : this._absUrl('/?s=' + encodeURIComponent(query.trim()) + '&post_type=wp-manga' + (pageNum > 1 ? '&paged=' + pageNum : ''));

    var res = await ctx.xFetch(url);
    if (!res.ok) return [];
    var results = this._parseNhvCards(res.text);
    if (results.length) return results;
    return this._parseSearchRows(res.text);
  },

  getPopularNovels: async function (page, ctx) {
    return this.searchNovels('', page, ctx);
  },

  // Fallback parser for ?s=...&post_type=wp-manga rows.
  _parseSearchRows: function (html) {
    var results = [];
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
      var genreBlock = block.match(/mg_genres[^>]*>([\s\S]*?)<\/div>/i);
      var tags = [];
      if (genreBlock) {
        var gr = /<a[^>]*>([^<]+)<\/a>/gi;
        var gm;
        while ((gm = gr.exec(genreBlock[1])) !== null) tags.push(gm[1].trim());
      }
      results.push({
        source: this.id,
        url: mLink[1].trim(),
        title: this._decodeEntities(mLink[2].trim()),
        coverUrl: (block.match(/<img[^>]+src="([^">]+)"/i) || [])[1] || undefined,
        author: (block.match(/mg_author[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i) || [])[1] || 'غير معروف',
        category: tags[0] || 'روايات مترجمة',
        tags: tags,
        status: mStatus || 'مستمرة'
      });
    }
    return results;
  },

  // -------------------------------------------------- categories
  getCategories: async function (ctx) {
    var res = await ctx.xFetch(this._absUrl('/cont/') + '?m_orderby=views');
    if (!res.ok) return [];
    var html = res.text;
    var collapse = html.match(/<div[^>]*class="[^"]*genres__collapse[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
    var region = collapse ? collapse[1] : html;
    var categories = [];
    var seen = {};
    var re = /<a[^>]+href="[^"]*\/cont-genre\/([^"\/]+)\/"[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = re.exec(region)) !== null) {
      var slug = decodeURIComponent(m[1]);
      if (seen[slug]) continue;
      seen[slug] = true;
      var name = m[2].replace(/<span[^>]*class="[^"]*count[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '');
      name = this._decodeEntities(this._stripTags(name));
      if (name) categories.push({ name: name, slug: slug });
    }
    return categories;
  },

  getCategoryNovels: async function (categorySlug, page, ctx) {
    var slug = categorySlug || '';
    var pageNum = (page && page > 1) ? Math.floor(page) : 1;
    var url = this._absUrl('/cont-genre/' + encodeURIComponent(slug) + '/');
    if (pageNum > 1) url += 'page/' + pageNum + '/';
    url += '?m_orderby=latest';
    var res = await ctx.xFetch(url);
    if (!res.ok) return [];
    return this._parseNhvCards(res.text);
  },

  // -------------------------------------------------- grid cards
  _parseNhvCards: function (html) {
    var results = [];
    var seen = {};
    var cardRegex = /<article class="nhv-library-card">([\s\S]*?)<\/article>/gi;
    var cardMatch;
    while ((cardMatch = cardRegex.exec(html)) !== null) {
      var card = cardMatch[1];
      var linkMatch = card.match(/<h2 class="nhv-library-card__title">\s*<a href="([^"]+)">([^<]+)<\/a>/i) ||
                      card.match(/<a class="nhv-library-card__cover" href="([^"]+)"[^>]*aria-label="([^"]*)"/i);
      if (!linkMatch) continue;
      var url = linkMatch[1].trim();
      if (seen[url]) continue;
      seen[url] = true;
      var chip = this._toLatinDigits(this._stripTags(
        (card.match(/class="[^"]*nhv-library-card__chip[^"]*"[^>]*>([\s\S]*?)<\/span>/i) || ['', ''])[1]
      ));
      var chapMatch = chip.match(/(\d+)\s*فصل/i);
      var genreMatch = card.match(/<div class="nhv-library-card__genres">([\s\S]*?)<\/div>/i);
      var tags = [];
      if (genreMatch) {
        var gr = /<a[^>]*>([^<]+)<\/a>/gi;
        var gm;
        while ((gm = gr.exec(genreMatch[1])) !== null) tags.push(gm[1].trim());
      }
      results.push({
        source: this.id,
        url: url,
        title: this._decodeEntities((linkMatch[2] || '').trim()),
        coverUrl: (card.match(/<img[^>]+src="([^">]+)"/i) || [])[1] || undefined,
        author: 'غير معروف',
        category: tags[0] || 'روايات مترجمة',
        tags: tags,
        totalChapters: chapMatch ? parseInt(chapMatch[1], 10) : 0,
        summary: (card.match(/<p class="nhv-library-card__excerpt">([^<]+)<\/p>/i) || [])[1] || '',
        status: (card.match(/nhv-library-card__status[^>]*>([^<]+)<\/span>/i) || [])[1] || 'مستمرة'
      });
    }
    return results;
  }
});
