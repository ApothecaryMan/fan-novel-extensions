// site:cenele — remote-JS extension for فضاء الروايات (cenele.com)
// Clean sandboxed scraper adhering to the Extension Runtime Specification (ctx.xFetch).
// Chapter lists are lazy: the novel page only renders the last 8, the full list is
// fetched over admin-ajax (nhv_manga_single_chapters_page). Host never opens sockets.
//
// Cache lives at MODULE level (not on the extension object) so parseNovelInfo() then
// parseChapterList() share one fetch even if the host re-evaluates the script for each
// parser call. It is bounded (small eviction cap) and time-limited (3 min) so it can
// never grow without bound or serve dangerously stale HTML. Only successful GETs are
// cached; misses/failures are never stored. Null-prototype map avoids key collisions.
var _htmlCache = Object.create(null); // url -> { res, ts }
var _HTML_CACHE_TTL_MS = 3 * 60 * 1000;
var _HTML_CACHE_CAP = 8;

function _fetchCachedPage(url, ctx) {
  var now = Date.now();
  var hit = _htmlCache[url];
  if (hit && (now - hit.ts) < _HTML_CACHE_TTL_MS) {
    return Promise.resolve(hit.res);
  }
  return ctx.xFetch(url).then(function (res) {
    if (res && res.ok) {
      _htmlCache[url] = { res: res, ts: now };
      // Evict the oldest entry beyond the cap so the module cache stays bounded
      // even when a host reuses the module context for many novels.
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
  });
}

registerExtension({
  id: 'site:cenele',
  name: 'فضاء الروايات',
  lang: 'ar',
  version: '1.7.1',
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
  // chapter name so the number/word is not duplicated in the final title, and drop any
  // quote marks that cenele wraps chapter names in ("..."/«...»).
  _stripChapterPrefix: function (name) {
    var raw = (name || '').trim();
    var m = raw;
    m = m.replace(/^["«“']+|["»”']+$/g, '');
    m = m.replace(/^(?:chapter|ch\.?|فصل|الفصل)\s*(\d+(?:\.\d+)?)\s*(?:[-–—:.#|]\s*)?/i, '');
    if (m !== raw) return m.replace(/["«»“”'´`^]/g, '').trim();
    m = m.replace(/^(?:فصل|الفصل)\s*(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)\s*(?:[:|.\-–—]?\s*)/i, '');
    m = m.replace(/^(?:فصل|الفصل)\s*[:|.\-–—]\s*/i, '');
    return m.replace(/["«»“”'´`^]/g, '').trim();
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

  // Read a JSON object from an AJAX response regardless of how the host shapes it.
  // Some runtimes populate a pre-parsed `.json`/`.data`/`.body`, others return the raw
  // JSON string in `.text`. Never throw on a non-JSON payload (e.g. a bot/anti-bot HTML
  // challenge) — fall back to the provided default so the caller degrades gracefully
  // instead of aborting the whole chapter list.
  _parseAjaxJson: function (res, def) {
    def = def || {};
    if (!res) return def;
    if (res.json && typeof res.json === 'object') return res.json;
    if (res.body && typeof res.body === 'object' && res.body !== def) return res.body;
    var raw = res.json !== undefined ? res.json : res.text;
    if (typeof raw !== 'string') return def;
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : def;
    } catch (e) {
      return def;
    }
  },

  // Resolve the values the chapter AJAX needs (postId, chaptersNonce, ajaxUrl).
  // Preferred source is the inline `nhvNovelV2` script object, but some hosts strip
  // <script> blocks entirely from page HTML (which also removes that object and made
  // chapter lists silently fall back to the 8-chapter preview). postId is also present
  // in the <body> class (`postid-<N>`) and the shortlink, and ajaxUrl is effectively a
  // constant, so we recover both from non-script markup. chaptersNonce is left out when
  // the script is gone and is then refreshed via `nhv_refresh_front_nonces`.
  _nhvProps: function (html) {
    var postId, chaptersNonce, ajaxUrl;
    var idx = html.indexOf('nhvNovelV2');
    if (idx !== -1) {
      var region = html.slice(Math.max(0, idx), Math.min(html.length, idx + 1600));
      postId = (region.match(/"postId"\s*:\s*"(\d+)"/) || [])[1];
      chaptersNonce = (region.match(/"chaptersNonce"\s*:\s*"([^"]+)"/) || [])[1];
      ajaxUrl = (region.match(/"ajaxurl"\s*:\s*"([^"]+)"/) || [])[1];
    }
    if (!postId) {
      var bodyId = (html.match(/<body[^>]*class="[^"]*\bpostid-(\d+)\b/i) || [])[1];
      var shortLink = (html.match(/<link[^>]+rel=['"]shortlink['"][^>]*\?p=(\d+)/i) || [])[1];
      postId = bodyId || shortLink;
    }
    if (!ajaxUrl) {
      ajaxUrl = (html.match(/data-nhv-track-url="([^"]+)"/i) || [])[1] ||
                this.baseUrl + '/wp-admin/admin-ajax.php';
    }
    if (!postId || !ajaxUrl) return null;
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
      var rawTitle = this._decodeEntities(this._stripTags(linkMatch[2]));
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
    var res = await _fetchCachedPage(fullUrl, ctx);
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
    var res = await _fetchCachedPage(fullUrl, ctx);
    if (!res.ok) throw new Error('فشل جلب قائمة الفصول: ' + res.status);
    var html = res.text;

    // Fallback: parse whatever chapter rows shipped in the page (usually the last 8).
    var fallbackChapters = this._parseChapterRows(html);
    var props = this._nhvProps(html);
    if (!props) return this._finalizeChapters(fallbackChapters);

    var nonce = props.chaptersNonce;
    var nonceRefreshed = false;
    var sleep = function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };

    // When the page's <script> (nhvNovelV2) was stripped by the host, chaptersNonce is
    // absent — obtain a fresh one before paginating.
    if (!nonce) {
      var ref0 = await this._ajaxPost(props.ajaxUrl, { action: 'nhv_refresh_front_nonces' }, ctx);
      var refJ0 = this._parseAjaxJson(ref0);
      if (refJ0.data && refJ0.data.chapters_nonce) {
        nonce = refJ0.data.chapters_nonce;
      }
    }

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
        var refJ = this._parseAjaxJson(ref);
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
      page1Res = this._parseAjaxJson(r);
      // Unwrap WordPress-style {success, data: {html, total, …}} envelope.
      if (page1Res.data && typeof page1Res.data === 'object' && page1Res.data.html) {
        page1Res = page1Res.data;
      }
      break;
    }

    if (!page1Res || !page1Res.html) return this._finalizeChapters(fallbackChapters);

    var collected = [page1Res.html];
    var totalChapters = parseInt(page1Res.total, 10) || 0;
    var perPage = parseInt(page1Res.per_page, 10) || 100;
    var totalPages = totalChapters > 0 ? Math.ceil(totalChapters / perPage) : (page1Res.has_more ? 2 : 1);

    // Fetch subsequent pages with bounded concurrency (no forced sleep after each
    // success). Each page retries independently; backoff/sleep only happens inside
    // retries, and the shared nonce is re-read each attempt so a 403 nonce refresh.
    var state = { nonce: nonce, nonceRefreshed: nonceRefreshed };
    var self = this;
    var fetchPage = async function (p) {
      for (var attemptNum = 0; attemptNum < 5; attemptNum++) {
        var pr = await self._ajaxPost(props.ajaxUrl, {
          action: 'nhv_manga_single_chapters_page',
          nonce: state.nonce,
          manga_id: props.postId,
          volume: '-1',
          page: String(p),
          per_page: '100',
          order: 'asc'
        }, ctx);
        if (pr.status === 403 && !state.nonceRefreshed) {
          var ref2 = await self._ajaxPost(props.ajaxUrl, { action: 'nhv_refresh_front_nonces' }, ctx);
          var refJ2 = self._parseAjaxJson(ref2);
          if (refJ2.data && refJ2.data.chapters_nonce) {
            state.nonce = refJ2.data.chapters_nonce;
            state.nonceRefreshed = true;
          }
          continue;
        }
        if (pr.status === 403 || pr.status === 429 || pr.status === 503 || !pr.ok) {
          await sleep(700 * (attemptNum + 1));
          continue;
        }
        var pageJson = self._parseAjaxJson(pr);
        // Unwrap WordPress-style {success, data: {html, …}} envelope.
        if (pageJson.data && typeof pageJson.data === 'object' && pageJson.data.html) {
          pageJson = pageJson.data;
        }
        if (pageJson && pageJson.html) return pageJson.html;
        return null;
      }
      return null;
    };
    var pages = [];
    for (var pp = 2; pp <= totalPages; pp++) pages.push(pp);
    var concurrency = 4;
    var idx = 0;
    var workers = [];
    var worker = async function () {
      while (idx < pages.length) {
        var cur = pages[idx++];
        var html = await fetchPage(cur);
        if (html) collected.push(html);
      }
    };
    for (var w = 0; w < Math.min(concurrency, pages.length); w++) {
      workers.push(worker());
    }
    await Promise.all(workers);

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
  // Incremental chapter refresh (Tachiyomi-style)
  // Fetch ONLY the newest chapters in a single request so the app can diff
  // against its local store instead of crawling every page again. The host
  // passes `knownCount` (chapters already stored) but we don't strictly need it:
  // ORDER desc + per_page 100 always returns the newest 100, and the app inserts
  // only the URLs it doesn't already have.
  // ---------------------------------------------------------------
  fetchLatestChapters: async function (novelUrl, knownCount, ctx) {
    var fullUrl = this._absUrl(novelUrl);
    var res = await _fetchCachedPage(fullUrl, ctx);
    if (!res.ok) throw new Error('فشل جلب أحدث الفصول: ' + res.status);
    var html = res.text;

    // Fallback: whatever chapter rows shipped inline (usually the last ~8).
    var fallbackChapters = this._parseChapterRows(html);
    var props = this._nhvProps(html);
    if (!props) return this._finalizeChapters(fallbackChapters);

    var nonce = props.chaptersNonce;
    var nonceRefreshed = false;
    var sleep = function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };

    if (!nonce) {
      var ref0 = await this._ajaxPost(props.ajaxUrl, { action: 'nhv_refresh_front_nonces' }, ctx);
      var refJ0 = this._parseAjaxJson(ref0);
      if (refJ0.data && refJ0.data.chapters_nonce) {
        nonce = refJ0.data.chapters_nonce;
      }
    }

    // Single request, newest first. Usually this is the ONLY network call.
    var pageRes = null;
    for (var attempt = 0; attempt < 5; attempt++) {
      var r = await this._ajaxPost(props.ajaxUrl, {
        action: 'nhv_manga_single_chapters_page',
        nonce: nonce,
        manga_id: props.postId,
        volume: '-1',
        page: '1',
        per_page: '100',
        order: 'desc'
      }, ctx);
      if (r.status === 403 && !nonceRefreshed) {
        var ref = await this._ajaxPost(props.ajaxUrl, { action: 'nhv_refresh_front_nonces' }, ctx);
        var refJ = this._parseAjaxJson(ref);
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
      pageRes = this._parseAjaxJson(r);
      // WordPress admin-ajax wraps the payload as {success, data:{html,total,...}}.
      // Unwrap it so pageRes.html is read directly (same as parseChapterList).
      if (pageRes && pageRes.data && typeof pageRes.data === 'object' && pageRes.data.html) {
        pageRes = pageRes.data;
      }
      break;
    }

    if (!pageRes || !pageRes.html) return this._finalizeChapters(fallbackChapters);

    var latestChapters = this._parseChapterRows(pageRes.html);
    if (latestChapters.length === 0) return this._finalizeChapters(fallbackChapters);

    return this._finalizeChapters(latestChapters);
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
      // Handle a leading chapter-heading line ("الفصل 663: لا، دانييل", "Chapter 1: Name",
      // "الفصل 59"). We NO LONGER drop such a block entirely: the chapter title shown by the
      // app may be just "الفصل 59" when the site's list lacked a name, in which case the name
      // here is the ONLY copy and must be preserved. So strip the "الفصل N"/"Chapter N" prefix
      // and keep whatever name follows. Already-prefixed headings become empty and are skipped.
      text = text.replace(/^\s*(?:chapter|ch\.?)\s*\d+(?:\s*[:.—|-]\s*|\s+|$)/i, '').trim();
      text = text.replace(/^\s*(?:فصل|الفصل)\s*\d+(?:\s*[:.—|-]\s*|\s+|$)/i, '').trim();
      // Arabic word-number headings (اول..عاشر, 11-19, 20-90 و ...) + optional name.
      // NOTE: 11-19 composites (الثاني عشر/الثالث عشر...) MUST be handled before the
      // standalone ones (الثالث) or the tens "عشر" gets left as junk.
      text = text.replace(/^\s*(?:فصل|الفصل)\s+(?:الحادي|الثانية?|الثانية?)?\s*عشر(?:اء)?\s*[:.—|-]?\s*/i, '').trim();
      text = text.replace(/^\s*(?:فصل|الفصل)\s+(?:الأول|الثاني|الثالث|الرابع|الخامس)\s+عشر\s*[:.—|-]?\s*/i, '').trim();
      text = text.replace(/^\s*(?:فصل|الفصل)\s+(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)\s*[:.—|-]?\s*/i, '').trim();
      text = text.replace(/^\s*(?:فصل|الفصل)\s+(?:عشرون|ثلاثون|أربعون|خمسون|ستون|سبعون|ثمانون|تسعون)\s*[:.—|-]?\s*/i, '').trim();
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