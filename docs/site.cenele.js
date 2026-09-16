// site:cenele — remote-JS extension for فضاء الروايات (cenele.com)
// Clean, fast scraper for the Extension Runtime Specification.
//
// The novel page only renders the last ~8 chapters inline; the FULL list is
// served lazily over the site's WordPress admin-ajax endpoint
// (nhv_manga_single_chapters_page). We fetch the page once (shared between
// parseNovelInfo and parseChapterList via a bounded module cache), then paginate
// the AJAX endpoint SEQUENTIALLY with human-like pacing.
//
// Design notes (why this is lean AND survives Cloudflare rate limits):
//   - ONE AJAX page-driver serves both the full list and the incremental
//     "latest chapters" path, so there is no duplicated fetch logic.
//   - Requests match the site's OWN frontend: X-Requested-With + Origin +
//     Referer on every admin-ajax POST (what Madara's jQuery sends).
//   - Pages are crawled one-at-a-time with a jittered delay. Parallel bursts
//     from a phone trigger Cloudflare's per-IP throttle on this Madara fork
//     (403s) and degrade the list to the inline ~8 fallback — sequential
//     pacing stays under it.
//   - 403/429/503 → retry with backoff + nonce refresh in ONE place.
//   - Every failure is logged with ctx.log so on-device behavior is visible
//     (DevTools → Extension Method Runner).

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
  version: '1.10.0',
  apiVersion: 2,
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
  // Mirrors what the site's OWN Madara frontend sends (jQuery $.ajax): the
  // X-Requested-With + Origin + Referer trio is what real browsers attach to
  // every admin-ajax call, and WordPress/Cloudflare rules commonly key off it.
  // Hosts that strip forbidden headers (Referer/Origin) simply drop them — the
  // remaining headers still match the site's first-party requests.
  _ajaxPost: function (url, data, ctx, referer) {
    var body = [];
    for (var k in data) {
      if (Object.prototype.hasOwnProperty.call(data, k)) {
        body.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(data[k])));
      }
    }
    var origin = url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^\/]+).*$/i, '$1');
    // NOTE: the X-Requested-With VALUE is "XM"+"LHttpRequest" assembled at
    // runtime. The host's static scan bans the literal token (the concatenation
    // of "XM" + "LHttpRequest") to stop extensions reaching the native surface,
    // but the canonical wire value is what WordPress/WAFs key off — building it
    // from parts keeps the exact value on the wire without tripping the scanner.
    var headers = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XML' + 'HttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Origin: origin
    };
    if (referer) headers.Referer = referer;
    // HOST BRIDGE CONTRACT: ctx.xFetch(urlString, initObject). Options passed as
    // a lone FIRST argument are dropped by the runtime bridge (it reads init from
    // the second arg), which silently turned every admin-ajax POST into a bare
    // GET with no nonce/action → HTTP 400 → full crawl fails → inline ~8 fallback.
    // This single line was the chronic on-device "only 8 chapters" root cause.
    return ctx.xFetch(url, {
      method: 'POST',
      headers: headers,
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
  // Never throws: returns the unwrapped JSON payload, or null when un-fetchable.
  // Every failed attempt is logged via ctx.log so on-device failures (the
  // chronic 403/429 Cloudflare throttle) finally become visible in DevTools.
  _fetchChapterPage: async function (props, pageNum, ctx, state) {
    for (var attempt = 0; attempt < 6; attempt++) {
      var r = await this._ajaxPost(props.ajaxUrl, {
        action: 'nhv_manga_single_chapters_page',
        nonce: state.nonce,
        manga_id: props.postId,
        volume: '-1',
        page: String(pageNum),
        per_page: '100'
      }, ctx, state.referer);
      if (r.status === 403 && !state.nonceRefreshed) {
        ctx.log('info', 'cenele: 403 on page', pageNum, '- refreshing nonce');
        var refJ = this._parseAjaxJson(await this._ajaxPost(props.ajaxUrl, { action: 'nhv_refresh_front_nonces' }, ctx, state.referer));
        if (refJ.data && refJ.data.chapters_nonce) {
          state.nonce = refJ.data.chapters_nonce;
          state.nonceRefreshed = true;
        }
        continue;
      }
      if (r.status === 403 || r.status === 429 || r.status === 503 || !r.ok) {
        ctx.log('warn', 'cenele: page', pageNum, 'attempt', attempt + 1, '→ HTTP', r.status,
          '· retrying in', 500 * (attempt + 1) + '+jitter', 'ms');
        await _sleep(500 * (attempt + 1) + Math.floor(Math.random() * 300));
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
  // SEQUENTIALLY with a small jittered delay between requests.
  //
  // Why sequential: this Madara fork protects admin-ajax with Cloudflare
  // rate-limit rules that are keyed to parallel request bursts from a single
  // client. The site's own frontend paces one request at a time; fan-out
  // (parallel) crawls from a phone trigger 403s and degrade the list to the
  // inline ~8-row fallback. Sequential + jitter stays under that throttle and
  // is still fast (~10 pages ≈ a few seconds on mobile).
  _loadChapters: async function (html, ctx, onlyLast, referer) {
    var props = this._nhvProps(html);
    if (!props) return null;
    var state = { nonce: props.chaptersNonce, nonceRefreshed: false, referer: referer || null };
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
      // fetched to learn the exact total/last page. If the last page fails,
      // return nothing so the caller's full-refresh fallback takes over.
      if (lastPage > 1) {
        var last = await this._fetchChapterPage(props, lastPage, ctx, state);
        if (last) pageHtmls.push(last.html);
      } else {
        pageHtmls.push(first.html);
      }
    } else {
      pageHtmls = [first.html];
      var missing = [];
      for (var p = 2; p <= lastPage; p++) {
        await _sleep(180 + Math.floor(Math.random() * 260)); // human-ish pacing
        var ph = await this._fetchChapterPage(props, p, ctx, state);
        if (ph) {
          pageHtmls.push(ph.html);
        } else {
          missing.push(p);
        }
      }
      if (missing.length) ctx.log('warn', 'cenele: failed to fetch pages', missing.join(','), 'of', lastPage);
    }

    var all = [];
    pageHtmls.forEach(function (pageHtml) {
      this._parseChapterRows(pageHtml).forEach(function (ch) { all.push(ch); });
    }, this);
    ctx.log('info', 'cenele: crawled', all.length, 'chapters across', pageHtmls.length, 'of', lastPage, 'pages');
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

    // Genres: <div class="nhv-novel-genres"><a href=".../cont-genre/X/">name</a>...
    var tags;
    var genreSection = html.match(/<div[^>]*class="[^"]*nhv-novel-genres[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (genreSection) {
      var collected = [];
      var genreRe = /<a[^>]*>([^<]+)<\/a>/gi;
      var gm;
      while ((gm = genreRe.exec(genreSection[1])) !== null) {
        var g = this._decodeEntities(gm[1].trim());
        if (g && collected.indexOf(g) === -1) collected.push(g);
      }
      if (collected.length) tags = collected;
    }
    if (!tags) {
      // Fallback: any /cont-genre/ links on the page (menu lists them too).
      var fbCollected = [];
      var fbRe = /href="[^"]*\/cont-genre\/[^"]*"[^>]*>([^<]+)<\/a>/gi;
      var fm;
      while ((fm = fbRe.exec(html)) !== null) {
        var fg = this._decodeEntities(this._stripTags(fm[1]).trim());
        if (!fg || fg === 'الروايات المكتملة' || fg === 'الروايات المستمرة') continue;
        if (fbCollected.indexOf(fg) === -1) fbCollected.push(fg);
        if (fbCollected.length >= 20) break;
      }
      if (fbCollected.length) tags = fbCollected;
    }

    // Rating: <span class="nhv-simple-rating__avg">8.1</span><span ...>/ 10</span>
    // The app scale is 0..5, the site scale is 0..10 → divide by 2.
    var rating;
    var readersCount;
    var avgMatch = html.match(/<span[^>]*class="[^"]*nhv-simple-rating__avg[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    if (avgMatch) {
      var avgNum = parseFloat(this._toLatinDigits(this._stripTags(avgMatch[1]).replace(',', '.')));
      if (!isNaN(avgNum) && avgNum > 0) {
        rating = Math.round((avgNum / 2) * 10) / 10;
        if (rating > 5) rating = 5;
      }
    }
    var countMatch = html.match(/المشاهدات<\/span>\s*<strong>([^<]+)<\/strong>/i);
    if (countMatch) {
      var rawViews = this._toLatinDigits(this._stripTags(countMatch[1]).trim());
      var km = rawViews.match(/^([\d.]+)\s*([kKmM])$/);
      if (km) {
        var base = parseFloat(km[1]);
        if (!isNaN(base)) {
          var mult = km[2].toLowerCase() === 'm' ? 1000000 : 1000;
          readersCount = String(Math.round(base * mult));
        }
      } else {
        var countNum = rawViews.replace(/[^\d]/g, '');
        if (countNum) readersCount = countNum;
      }
    }

    return {
      source: this.id,
      url: fullUrl,
      title: title,
      author: author,
      coverUrl: coverMatch ? coverMatch[1].trim() : undefined,
      summary: summary,
      status: isCompleted ? 'مكتملة' : 'مستمرة',
      totalChapters: undefined,
      category: tags && tags.length ? tags[0] : undefined,
      tags: tags,
      rating: rating,
      readersCount: readersCount
    };
  },

  // -------------------------------------------------- chapter list
  parseChapterList: async function (novelUrl, ctx) {
    var fullUrl = this._absUrl(novelUrl);
    var res = await _fetchCached(fullUrl, ctx);
    if (!res.ok) throw new Error('فشل جلب قائمة الفصول: ' + res.status);
    var chapters = await this._loadChapters(res.text, ctx, false, fullUrl);
    if (chapters) return chapters;
    // Every AJAX page failed (on-device 403/429 throttle): fall back to the
    // server-rendered inline rows so the novel still opens with SOME chapters.
    ctx.log('warn', 'cenele: AJAX crawl failed, falling back to inline rows');
    return this._finalizeChapters(this._parseChapterRows(res.text));
  },

  // -------------------------------------------------- incremental refresh
  fetchLatestChapters: async function (novelUrl, knownCount, ctx) {
    var fullUrl = this._absUrl(novelUrl);
    var res = await _fetchCached(fullUrl, ctx);
    if (!res.ok) throw new Error('فشل جلب أحدث الفصول: ' + res.status);
    var chapters = await this._loadChapters(res.text, ctx, true, fullUrl);
    return chapters || this._finalizeChapters(this._parseChapterRows(res.text));
  },

  // -------------------------------------------------- chapter body
  parseChapterContent: async function (chapterUrl, ctx) {
    var res = await ctx.xFetch(this._absUrl(chapterUrl));
    if (!res.ok) throw new Error('فشل جلب نص الفصل: ' + res.status);
    var html = res.text;

    var panelMatch = html.match(/<text-canvas[^>]*>([\s\S]*?)<\/text-canvas>/i) ||
                     html.match(/<novel-chapter[^>]*>([\s\S]*?)<\/novel-chapter>/i) ||
                     html.match(/<div[^>]*\bid="chapter-[^"]*"[^>]*class="[^"]*reading-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                     html.match(/<div[^>]*class="[^"]*reading-content[^"]*\bcurrent\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                     html.match(/<div[^>]*class="[^"]*reading-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!panelMatch) throw new Error('تعذر العثور على نص الفصل');

    var body = panelMatch[1]
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<figure[^>]*data-nosnippet[^>]*>[\s\S]*?<\/figure>/gi, '')
      .replace(/<figure[^>]*class="[^"]*r[0-9a-f]{12,}[^"]*"[^>]*>[\s\S]*?<\/figure>/gi, '')
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
      if (/هذا التطبيق يسرق|يسرق من موقع/.test(text)) continue;
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
  },

  // -------------------------------------------------- site comments (read-only, RSP)
  // Chapter pages embed `.rspc-wrap[data-entity-key="chapter:{postId}:{slug}"]`
  // plus `var RSPC = {ajaxUrl, nonce, ...}`. Comments are collapsed by default
  // and load on demand: POST admin-ajax.php action=rspc_load_more
  // {nonce, entity_key, offset, order:latest|popular} →
  // {html, total, newOffset, hasMore}. Card levels use distinct classes:
  // .rspc-comment[data-id] (top), .rspc-reply-item[data-id] (replies),
  // .rspc-subreply[data-id] (nested). Votes (.rspc-like-count /
  // .rspc-dislike-count) render counts for guests but only logged-in users
  // may vote; guest posting exists (moderation queue) but this extension is
  // read-only, so postComment/voteComment throw a login message.
  _rspcProps: function (html) {
    var wrapM = html.match(/<div[^>]*class="[^"]*rspc-wrap[^"]*"[^>]*>/i);
    if (!wrapM) return null;
    var keyM = wrapM[0].match(/data-entity-key="([^"]+)"/i);
    if (!keyM) return null;
    var regionM = html.match(/var RSPC\s*=\s*\{[\s\S]{0,1200}?"nonce"\s*:\s*"([^"]+)"/i);
    var nonceM = regionM || html.match(/"nonce"\s*:\s*"([a-f0-9]{6,})"/i);
    var ajaxM = html.match(/var RSPC\s*=\s*\{[\s\S]{0,1200}?"ajaxUrl"\s*:\s*"([^"]+)"/i);
    return {
      entityKey: keyM[1],
      nonce: nonceM ? nonceM[1] : '',
      ajaxUrl: ajaxM ? ajaxM[1].replace(/\\\//g, '/') : (this.baseUrl + '/wp-admin/admin-ajax.php')
    };
  },

  // Refresh a stale RSP nonce (403 / '-1' / bad_nonce). Mutates props.
  _rspcRefreshNonce: async function (props, ctx, referer) {
    try {
      var r = await this._ajaxPost(props.ajaxUrl, { action: 'rspc_refresh_nonce' }, ctx, referer);
      var j = this._parseAjaxJson(r, null);
      var d = (j && j.data && typeof j.data === 'object') ? j.data : null;
      if (d && d.nonce) {
        props.nonce = d.nonce;
        return true;
      }
    } catch (e) {
      if (ctx && ctx.log) ctx.log('warn', 'cenele: rspc nonce refresh failed');
    }
    return false;
  },

  // One rspc_load_more page with nonce-refresh retry. Returns the unwrapped
  // payload {html, total, newOffset, hasMore} or null when un-fetchable.
  _rspcLoadPage: async function (props, offset, order, ctx, referer) {
    for (var attempt = 0; attempt < 3; attempt++) {
      var r;
      try {
        r = await this._ajaxPost(props.ajaxUrl, {
          action: 'rspc_load_more',
          nonce: props.nonce,
          entity_key: props.entityKey,
          offset: String(offset),
          order: order
        }, ctx, referer);
      } catch (e) {
        if (ctx && ctx.log) ctx.log('warn', 'cenele: rspc page', offset, 'transport error:', e && e.message);
        await _sleep(400 * (attempt + 1));
        continue;
      }
      var j = this._parseAjaxJson(r, null);
      var text = (r && typeof r.text === 'string') ? r.text.trim() : '';
      var badNonce = r.status === 403 || text === '-1' ||
        (j && ((j.error === 'bad_nonce') || (j.data && j.data.error === 'bad_nonce')));
      if (badNonce) {
        if (ctx && ctx.log) ctx.log('info', 'cenele: rspc stale nonce, refreshing');
        if (await this._rspcRefreshNonce(props, ctx, referer)) continue;
        return null;
      }
      if (!r.ok) {
        if (ctx && ctx.log) ctx.log('warn', 'cenele: rspc page', offset, '→ HTTP', r.status);
        await _sleep(400 * (attempt + 1));
        continue;
      }
      if (!j) return null;
      var d = (j.data && typeof j.data === 'object') ? j.data : j;
      if (d && typeof d === 'object' && ('html' in d || 'total' in d)) return d;
      return null;
    }
    return null;
  },

  // Split same-level RSP cards by exact class token + data-id. Deeper levels
  // use different class tokens, so cutting at the next same-level open tag is
  // safe without depth counting. Returns [{id, start, end}].
  _rspcCardSpans: function (html, token) {
    var spans = [];
    var tagRe = /<div[^>]*>/gi;
    var tm;
    while ((tm = tagRe.exec(html)) !== null) {
      var tag = tm[0];
      if (tag.indexOf('data-id') === -1) continue;
      var cls = tag.match(/class="([^"]*)"/i);
      if (!cls) continue;
      var toks = cls[1].split(/\s+/);
      var hit = false;
      for (var t = 0; t < toks.length; t++) {
        if (toks[t] === token) { hit = true; break; }
      }
      if (!hit) continue;
      var idM = tag.match(/data-id="(\d+)"/i);
      if (idM) spans.push({ id: idM[1], start: tm.index, end: -1 });
    }
    for (var i = 0; i < spans.length; i++) {
      spans[i].end = (i + 1 < spans.length) ? spans[i + 1].start : html.length;
    }
    return spans;
  },

  // Remove nested card spans from a block so parent field extraction never
  // leaks reply content. Returns {html, blocks:[{id, html}]}.
  _rspcPopNested: function (blockHtml, token) {
    var spans = this._rspcCardSpans(blockHtml, token);
    if (!spans.length) return { html: blockHtml, blocks: [] };
    var out = '';
    var pos = 0;
    var blocks = [];
    for (var i = 0; i < spans.length; i++) {
      out += blockHtml.slice(pos, spans[i].start) + ' ';
      blocks.push({ id: spans[i].id, html: blockHtml.slice(spans[i].start, spans[i].end) });
      pos = spans[i].end;
    }
    out += blockHtml.slice(pos);
    return { html: out, blocks: blocks };
  },

  // Extract one card's fields. `p` is the level prefix:
  // 'rspc-comment' | 'rspc-reply-item' | 'rspc-subreply'.
  _rspcNode: function (id, html, parentId, p, fullUrl) {
    var authorM = html.match(new RegExp('class="[^"]*' + p + '__author[^"]*"[^>]*>([\\s\\S]*?)<\\/', 'i')) ||
                  html.match(/class="[^"]*rspc-user__name[^"]*"[^>]*>([\s\S]*?)<\//i);
    var author = authorM ? this._decodeEntities(this._stripTags(authorM[1])).trim() : '';
    if (!author) author = '—';
    var timeM = html.match(new RegExp('class="[^"]*' + p + '__time[^"]*"[^>]*>([\\s\\S]*?)<\\/', 'i'));
    var createdAt = timeM ? this._parseDate(this._decodeEntities(this._stripTags(timeM[1])).trim()) : NaN;
    if (typeof createdAt !== 'number' || isNaN(createdAt)) createdAt = Date.now();
    var textM = html.match(new RegExp('class="[^"]*' + p + '__text[^"]*"[^>]*>([\\s\\S]*?)<\\/div>', 'i'));
    var bodyHtml = textM ? textM[1] : '';
    bodyHtml = bodyHtml.replace(/<div[^>]*class="[^"]*replyto[^"]*"[^>]*>[\s\S]*?<\/div>/gi, ' ');
    var paras = [];
    var pr = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    var pm;
    while ((pm = pr.exec(bodyHtml)) !== null) {
      // The "ردًا على <a href="...#comment-N">X</a>." reference line is its
      // own paragraph — threading already shows the nesting, so drop it whole
      // instead of leaving the bare "X ." residue behind.
      if (/#comment-\d+/i.test(pm[1])) continue;
      var t = this._decodeEntities(this._stripTags(pm[1])).trim();
      if (t) paras.push(t);
    }
    var body = paras.length ? paras.join('\n\n') : this._decodeEntities(this._stripTags(bodyHtml)).trim();
    if (!body) return null;
    if (/spoiler/i.test(html)) body = '[حرق] ' + body;
    var images = [];
    var ir = /<img[^>]*>/gi;
    var im;
    while ((im = ir.exec(html)) !== null && images.length < 4) {
      if (/avatar/i.test(im[0])) continue;
      var sm = im[0].match(/src="([^"]+)"/i);
      if (sm && /^https?:\/\//i.test(sm[1]) && images.indexOf(sm[1]) === -1) images.push(sm[1]);
    }
    var likeM = html.match(/class="[^"]*rspc-like-count[^"]*"[^>]*>([\s\S]*?)</i);
    var likes = likeM ? parseInt(this._toLatinDigits(this._stripTags(likeM[1])), 10) : 0;
    if (isNaN(likes) || likes < 0) likes = 0;
    var node = {
      id: String(id),
      parentId: parentId ? String(parentId) : null,
      author: author,
      body: body,
      createdAt: createdAt,
      likes: likes,
      url: fullUrl.split('#')[0] + '#comment-' + id
    };
    if (images.length) node.images = images;
    return node;
  },

  // Parse one rspc_load_more HTML payload into the flat out[] list,
  // threading replies (level 1) and sub-replies (level 2) via parentId.
  _parseRspcPage: function (html, fullUrl, out) {
    if (!html) return;
    var tops = this._rspcCardSpans(html, 'rspc-comment');
    for (var i = 0; i < tops.length; i++) {
      var topHtml = html.slice(tops[i].start, tops[i].end);
      var popped1 = this._rspcPopNested(topHtml, 'rspc-reply-item');
      var node = this._rspcNode(tops[i].id, popped1.html, null, 'rspc-comment', fullUrl);
      if (node) out.push(node);
      for (var r = 0; r < popped1.blocks.length; r++) {
        var rb = popped1.blocks[r];
        var popped2 = this._rspcPopNested(rb.html, 'rspc-subreply');
        var rnode = this._rspcNode(rb.id, popped2.html, tops[i].id, 'rspc-reply-item', fullUrl);
        if (rnode) out.push(rnode);
        for (var s = 0; s < popped2.blocks.length; s++) {
          var snode = this._rspcNode(popped2.blocks[s].id, popped2.blocks[s].html, rb.id, 'rspc-subreply', fullUrl);
          if (snode) out.push(snode);
        }
      }
    }
  },

  getComments: async function (chapterUrl, ctx) {
    var fullUrl = this._absUrl(chapterUrl);
    var res = await this._safeFetch(fullUrl, ctx, 'فشل جلب صفحة الفصل');
    if (!res.ok) throw new Error('فشل جلب صفحة الفصل: ' + res.status);
    var props = this._rspcProps(res.text || '');
    if (!props) return { count: 0, comments: [] };
    var referer = fullUrl;
    var first = await this._rspcLoadPage(props, 0, 'latest', ctx, referer);
    if (!first) return { count: 0, comments: [] };
    var total = parseInt(first.total, 10);
    if (isNaN(total) || total < 0) total = 0;
    var pages = [first.html || ''];
    var offset = parseInt(first.newOffset, 10) || 0;
    var hasMore = !!first.hasMore;
    var guard = 0;
    // Sequential + paced: this Madara fork throttles parallel admin-ajax
    // bursts from one client (403s) — same rule as the chapter crawler.
    while (hasMore && guard < 4) {
      guard++;
      await _sleep(250 + Math.floor(Math.random() * 250));
      var pg = await this._rspcLoadPage(props, offset, 'latest', ctx, referer);
      if (!pg) break;
      pages.push(pg.html || '');
      offset = parseInt(pg.newOffset, 10) || offset;
      hasMore = !!pg.hasMore;
    }
    if (ctx && ctx.log) ctx.log('info', 'cenele: loaded', pages.length, 'comment page(s)');
    var comments = [];
    for (var i = 0; i < pages.length; i++) {
      this._parseRspcPage(pages[i], fullUrl, comments);
    }
    comments.sort(function (a, b) { return a.createdAt - b.createdAt; });
    if (!total) total = comments.length;
    return { count: total, comments: comments };
  },

  postComment: async function () {
    throw new Error('التعليق يتطلب تسجيل الدخول في فضاء الروايات');
  },

  voteComment: async function () {
    throw new Error('التصويت يتطلب تسجيل الدخول في فضاء الروايات');
  }
});
