/**
 * Extension: Lord of the Truth (سيد الحقيقة)
 * Custom site scraper for https://truthnovel.top/
 * Dedicated to the single novel "سيد الحقيقة" by author Zeus.
 */

var _htmlCache = {};
var _CACHE_TTL_MS = 10 * 60 * 1000;

// wpDiscuz vote counts, keyed by comment id. NO TTL on purpose.
//
// The commenter profile used to re-download up to 10 whole chapter pages
// (~195 KB each) purely to re-scrape counts it had already seen, because
// _htmlCache expires after 10 minutes. The reader path (getComments) already
// fetches that same page and parses the counts, so it fills this map for
// free; voteComment fills it from its own response. A chapter read once stays
// known for the whole runtime with zero further requests.
//
// A miss means UNKNOWN, which is not the same as zero — callers must render
// nothing rather than a fake 0.
var _voteCounts = {};

// wpDiscuz nonce. Cached because it was previously refetched on EVERY vote and
// every post, doubling the request count of both. wpDiscuz nonces are valid
// for hours; 30 min is comfortably inside that and still self-heals if the
// site ever rotates them (a rejected vote just refetches).
var _nonceCache = null;
var _NONCE_TTL_MS = 30 * 60 * 1000;

// chapter URL -> numeric post id. Small, permanent, and it makes replying to
// the same chapter free after the first time.
var _postIdByUrl = {};

/**
 * Resolve a chapter URL to its numeric WordPress post id.
 *
 * Cheap path: a tiny REST probe (a few hundred bytes) that matches the post's
 * canonical link. Expensive path: the old behaviour of downloading the whole
 * chapter page and scraping `wc_post_id`, kept only so an unusual URL that
 * REST cannot match still works instead of failing the post outright.
 */
function _resolvePostId(fullUrl, ctx) {
  if (_postIdByUrl[fullUrl]) return Promise.resolve(_postIdByUrl[fullUrl]);
  return ctx.xFetch("https://truthnovel.top/wp-json/wp/v2/posts?per_page=1&_fields=id,link&slug="
      + encodeURIComponent(_slugFromUrl(fullUrl)))
    .then(function (res) {
      if (!res.ok) return null;
      var list;
      try { list = JSON.parse(res.text); } catch (e) { return null; }
      if (!Array.isArray(list) || !list[0] || !list[0].id) return null;
      // Trust the link only when it really is this chapter — the slug probe can
      // land on a different post with the same slug on a multi-novel site.
      if (list[0].link && fullUrl && list[0].link.split("#")[0].replace(/\/+$/, "") !== fullUrl.replace(/\/+$/, "")) {
        return null;
      }
      _postIdByUrl[fullUrl] = String(list[0].id);
      return _postIdByUrl[fullUrl];
    })
    .catch(function () { return null; })
    .then(function (id) {
      if (id) return id;
      return ctx.xFetch(fullUrl).then(function (pageRes) {
        if (!pageRes.ok) throw new Error("فشل فتح صفحة الفصل: " + pageRes.status);
        var html = pageRes.text || "";
        var m = html.match(/"wc_post_id"\s*:\s*"(\d+)"/) || html.match(/wc_post_id["']?\s*[:=]\s*["']?(\d+)/);
        if (!m) throw new Error("تعذر تحديد معرف المقال");
        _postIdByUrl[fullUrl] = m[1];
        return m[1];
      });
    });
}

/** Trailing slug of a permalink, e.g. "/2469-اسم/" -> "2469-اسم". */
function _slugFromUrl(fullUrl) {
  var s = String(fullUrl || "").split("#")[0].split("?")[0].replace(/\/+$/, "");
  var seg = s.substring(s.lastIndexOf("/") + 1);
  try { return decodeURIComponent(seg); } catch (e) { return seg; }
}

/** Cached wpDiscuz nonce; one request per 30 min instead of one per call. */
function _getNonce(ctx) {
  var now = Date.now();
  if (_nonceCache && now - _nonceCache.ts < _NONCE_TTL_MS) {
    return Promise.resolve(_nonceCache.nonce);
  }
  var ajaxUrl = "https://truthnovel.top/wp-admin/admin-ajax.php";
  return ctx.xFetch(ajaxUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: "action=wpdGetNonce"
  }).then(function (res) {
    if (!res.ok) throw new Error("فشل تجهيز التفاعل: " + res.status);
    var data;
    try { data = JSON.parse(res.text); } catch (e) { throw new Error("رد غير متوقع من الموقع"); }
    var nonce = data && data.data && data.data.wpdiscuz_nonce;
    if (!nonce) throw new Error("تعذر تجهيز التفاعل (nonce)");
    _nonceCache = { nonce: nonce, ts: now };
    return nonce;
  });
}

/** Remember a count so the profile never has to refetch the chapter for it. */
function _rememberVotes(pageHtml) {
  if (!pageHtml) return;
  var re = /id="comment-(\d+)"[\s\S]{0,6000}?wpd-vote-result[^>]*title='(-?\d+)'/g;
  var m;
  while ((m = re.exec(pageHtml)) !== null) {
    var v = parseInt(m[2], 10);
    if (!isNaN(v) && v >= 0) _voteCounts[m[1]] = v;
  }
}

/** Known count for a comment, or undefined when we genuinely don't know. */
function _knownVotes(id) {
  var v = _voteCounts[String(id)];
  return typeof v === "number" ? v : undefined;
}

// Total-views state (module cache, lives while the runtime is alive):
// post IDs + summed views. Cold fill crawls tiny _fields=id REST pages;
// warm refreshes resolve ONLY new chapters from the chapter feed.
var _viewsIds = [];
var _viewsTotal = 0;
var _viewsFilled = false;

function _fetchCachedPage(url, ctx) {
  var now = Date.now();
  var hit = _htmlCache[url];
  if (hit && now - hit.ts < _CACHE_TTL_MS) {
    return Promise.resolve({ ok: true, status: 200, text: hit.text });
  }
  return ctx.xFetch(url).then(function (res) {
    if (res.ok && typeof res.text === "string") {
      _htmlCache[url] = { text: res.text, ts: now };
    }
    return res;
  });
}

registerExtension({
  id: "site:truthnovel",
  name: "رواية سيد الحقيقة",
  lang: "ar",
  version: "1.5.0",
  apiVersion: 2,
  baseUrl: "https://truthnovel.top",

  _absUrl: function (url) {
    if (!url) return "";
    if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) return url;
    var base = this.baseUrl.replace(/\/$/, "");
    return base + (url.charAt(0) === "/" ? "" : "/") + url;
  },

  _stripTags: function (html) {
    if (!html) return "";
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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
    if (!str) return "";
    return String(str)
      .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x660); })
      .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x6F0); });
  },

  _normUrl: function (url) {
    if (!url) return "";
    var u = this._absUrl(url).trim();
    u = u.replace(/\/+$/, "");
    try { u = decodeURI(u); } catch (e) { /* keep encoded */ }
    return u;
  },

  _parseDate: function (raw, nowMs) {
    if (!raw) return undefined;
    var str = this._toLatinDigits(String(raw).trim());
    if (!str) return undefined;
    var now = (typeof nowMs === "number" && nowMs > 0) ? nowMs : Date.now();

    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      var t = Date.parse(str);
      if (!isNaN(t)) return t;
    }

    // Relative Arabic times: "منذ 6 ساعات", "قبل ساعتين", "منذ 10 دقائق", ...
    var rel = str.replace(/،/g, " ");
    var dualUnit = null;
    if (/ساعتين/.test(rel)) dualUnit = "hours2";
    else if (/دقيقتين/.test(rel)) dualUnit = "minutes2";
    else if (/يومين/.test(rel)) dualUnit = "days2";
    else if (/أسبوعين|اسبوعين/.test(rel)) dualUnit = "weeks2";
    else if (/شهرين/.test(rel)) dualUnit = "months2";
    else if (/سنتين|عامين/.test(rel)) dualUnit = "years2";
    var mNum = rel.match(/(\d+)\s*(?:من\s*)?(?:ثاني|ثانية|ثواني|دقيق|دقيقة|دقائق|ساع|ساعة|ساعات|يوم|أيام|ايام|أسبوع|اسبوع|أسابيع|اسابيع|شهر|شهور|أشهر|اشهر|سنة|سنوات|عام|أعوام|اعوام)/);
    // Also handle "منذ X" / "قبل X" without unit repetition issues
    if (!mNum) mNum = rel.match(/(\d+)/);
    if (/(منذ|قبل|من\s*قبل)\s/.test(rel) || /^(منذ|قبل)/.test(rel) || dualUnit) {
      var amount = dualUnit ? 2 : (mNum ? parseInt(mNum[1], 10) : NaN);
      if (!isNaN(amount)) {
        var delta = 0;
        if (/ثان/.test(rel)) delta = amount * 1000;
        else if (/دقيق|دقائق|دقيقة/.test(rel) || dualUnit === "minutes2") delta = amount * 60 * 1000;
        else if (/ساع/.test(rel) || dualUnit === "hours2") delta = amount * 60 * 60 * 1000;
        else if (/يوم|أيام|ايام/.test(rel) || dualUnit === "days2") delta = amount * 24 * 60 * 60 * 1000;
        else if (/أسبوع|اسبوع/.test(rel) || dualUnit === "weeks2") delta = amount * 7 * 24 * 60 * 60 * 1000;
        else if (/شهر|شهور|أشهر|اشهر/.test(rel) || dualUnit === "months2") delta = amount * 30 * 24 * 60 * 60 * 1000;
        else if (/سنة|سنوات|عام|أعوام|اعوام/.test(rel) || dualUnit === "years2") delta = amount * 365 * 24 * 60 * 60 * 1000;
        else delta = 0;
        if (delta > 0) return now - delta;
      } else if (/الآن|الان|just now/i.test(rel)) {
        return now;
      }
    }

    var arabicMonths = {
      "يناير": 0, "كانون الثاني": 0, "فبراير": 1, "شباط": 1, "مارس": 2, "آذار": 2,
      "أبريل": 3, "ابريل": 3, "نيسان": 3, "مايو": 4, "أيار": 4, "يونيو": 5, "حزيران": 5,
      "يوليو": 6, "تموز": 6, "أغسطس": 7, "اغسطس": 7, "آب": 7, "سبتمبر": 8, "أيلول": 8,
      "أكتوبر": 9, "اكتوبر": 9, "تشرين الأول": 9, "نوفمبر": 10, "تشرين الثاني": 10,
      "ديسمبر": 11, "كانون الأول": 11
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
          // Optional time-of-day "HH:mm" after the date, e.g. "16 سبتمبر 2026 19:15"
          var hh = 12, mm = 0, hasTime = false;
          var tm = str.match(/(\d{1,2}):(\d{2})/);
          if (tm) {
            var th = parseInt(tm[1], 10), tmi = parseInt(tm[2], 10);
            if (th >= 0 && th <= 23 && tmi >= 0 && tmi <= 59) { hh = th; mm = tmi; hasTime = true; }
          }
          // Day-only dates keep noon UTC to avoid timezone day-shift;
          // dates with explicit time use it as UTC.
          var dateObj = new Date(Date.UTC(year, monthIdx, day, hh, mm, 0));
          if (!isNaN(dateObj.getTime())) {
            if (!hasTime) return dateObj.getTime();
            return dateObj.getTime();
          }
        }
      }
    }
    return undefined;
  },

  _coverUrl: "https://truthnovel.top/wp-content/uploads/2024/12/%D9%86%D8%B3%D8%AE%D8%A9-%D8%A7%D9%84%D9%81%D8%B5%D9%84-%D8%A7%D9%84%D9%81-%D8%A7%D9%84%D8%B5%D8%BA%D9%8A%D8%B1%D8%A9-%D9%84%D9%84%D9%85%D9%88%D9%82%D8%B9-%D8%A7%D9%84%D8%B9%D8%B1%D8%A8%D9%8A.jpg",

  // Bounded-concurrency pool: run async jobs `limit` at a time so the
  // cold views crawl stays fast without hammering the server.
  _poolAll: async function (items, limit, fn) {
    var out = new Array(items.length);
    var next = 0;
    async function worker() {
      while (next < items.length) {
        var i = next++;
        out[i] = await fn(items[i], i);
      }
    }
    var workers = [];
    var n = Math.min(limit > 0 ? limit : 1, items.length);
    for (var w = 0; w < n; w++) workers.push(worker());
    await Promise.all(workers);
    return out;
  },

  // Sum views for post IDs via the bulk counter endpoint (200 IDs/request).
  _viewsSumIds: async function (ids, ctx) {
    var self = this;
    if (!ids || !ids.length) return 0;
    var chunks = [];
    for (var i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
    var parts = await self._poolAll(chunks, 8, async function (ch) {
      try {
        var r = await ctx.xFetch(self._absUrl("/wp-json/post-views-counter/get-post-views/" + ch.join(",")));
        if (!r || !r.ok || !r.text) return 0;
        var n = parseInt(String(r.text).replace(/[^\d]/g, ""), 10);
        return isNaN(n) || n < 0 ? 0 : n;
      } catch (e) { return 0; }
    });
    var sum = 0;
    for (var k = 0; k < parts.length; k++) sum += parts[k] || 0;
    return sum;
  },

  // All chapter post IDs via tiny _fields=id REST pages (~1KB each),
  // fetched in parallel waves of 8. Stops at the first short page;
  // no header parsing needed. A failed page aborts (caller treats the
  // whole count as unavailable rather than reporting a wrong total).
  _viewsAllIds: async function (ctx) {
    var self = this;
    var ids = [];
    var page = 1;
    var done = false;
    while (!done) {
      var batch = [];
      for (var p = page; p < page + 8; p++) batch.push(p);
      var pages = await self._poolAll(batch, 8, async function (pg) {
        var r = await ctx.xFetch(self._absUrl("/wp-json/wp/v2/posts?per_page=100&_fields=id&orderby=id&order=asc&page=" + pg));
        if (!r || !r.ok || !r.text) return null;
        try {
          var arr = JSON.parse(r.text);
          return Array.isArray(arr) ? arr : null;
        } catch (e) { return null; }
      });
      for (var b = 0; b < pages.length; b++) {
        var arr = pages[b];
        if (!arr) throw new Error("فشل جلب معرفات الفصول");
        for (var i = 0; i < arr.length; i++) {
          if (arr[i] && arr[i].id) ids.push(String(arr[i].id));
        }
        if (arr.length < 100) { done = true; break; }
      }
      page += 8;
      if (page > 101) break; // sanity cap (~8k posts)
    }
    return ids;
  },

  // Total novel views via the post-views-counter bulk endpoint.
  // Cold: crawl IDs once + batched sums (all tiny JSON, ~30KB total),
  // then cache for the runtime lifetime. Warm: ONE chapter-feed fetch
  // resolves only chapters published since (their ?p= IDs) and adds
  // their views — old-chapter view growth refreshes on the next cold
  // fill (runtime restart).
  getTotalViews: async function (novelUrl, ctx) {
    var self = this;
    if (!_viewsFilled) {
      var ids = await self._viewsAllIds(ctx);
      var total = await self._viewsSumIds(ids, ctx);
      _viewsIds = ids;
      _viewsTotal = total;
      _viewsFilled = true;
      return { count: total };
    }
    var seen = {};
    for (var s = 0; s < _viewsIds.length; s++) seen[_viewsIds[s]] = true;
    var fresh = [];
    try {
      // New posts are the highest ids, so ONE descending REST page finds any
      // that appeared since the cold fill. This used to download the site-wide
      // RSS feed — 18.9 MB, all 2,482 items — to regex out `?p=<id>` values,
      // and after a cold fill that scan found nothing at all, because every id
      // was already known. Paging continues only if the whole page is new.
      var page = 1;
      while (page < 20) {
        var arr = await self._restPosts(page, "id", "desc", ctx);
        if (!arr || !arr.length) break;
        var allNew = true;
        for (var i = 0; i < arr.length; i++) {
          var id = String(arr[i].id);
          if (!seen[id]) { seen[id] = true; fresh.push(id); }
          else { allNew = false; }
        }
        if (!allNew || arr.length < 100) break;
        page++;
      }
    } catch (e) { /* treat as no new chapters */ }
    if (!fresh.length) return { count: _viewsTotal };
    var add = await self._viewsSumIds(fresh, ctx);
    _viewsTotal += add;
    _viewsIds = _viewsIds.concat(fresh);
    return { count: _viewsTotal };
  },

  // ---------------------------------------------------------------
  // Metadata for the single novel (views filled when computable)
  // ---------------------------------------------------------------
  parseNovelInfo: async function (url, ctx) {
    var novelUrl = this._absUrl("/?w4pl=257");
    var info = {
      source: this.id,
      url: novelUrl,
      title: "سيد الحقيقة",
      author: "Zeus",
      coverUrl: this._coverUrl,
      summary: "رواية سيد الحقيقة - موقع صمم خصيصاً لأجل الرواية. ملحمة خيالية ملحمية تتابع رحلة اللورد روبين والمجرات والقطاعات المتعددة في صراع القوى والهيمنة.",
      status: "مستمرة",
      category: "فانتازيا",
      tags: ["فانتازيا", "خيال علمي", "مغامرة", "أكشن"]
    };
    // Total views are best-effort: never break the novel page if counting fails.
    try {
      var total = await this.getTotalViews(novelUrl, ctx);
      if (total && total.count > 0) info.readersCount = String(total.count);
    } catch (e) { /* keep info without views */ }
    return info;
  },

  // ---------------------------------------------------------------
  // Chapter list
  //
  // PRIMARY: paginated WP REST. Every post carries id, title, link and an
  // exact `date_gmt`, so the whole list is 25 small JSON pages (~570 KB) with
  // REAL dates for all 2,400+ chapters.
  //
  // This replaced a path that downloaded the site-wide RSS feed — measured at
  // 18.9 MB for 2,482 items — purely to read `pubDate` for recent chapters,
  // then interpolated plausible-looking but false dates for everything older.
  // The feed, the homepage date scrape, and the whole interpolation block are
  // gone; REST is both smaller and strictly more accurate.
  // ---------------------------------------------------------------

  /** One page of posts, or null on failure. */
  _restPosts: async function (page, fields, order, ctx) {
    var url = this._absUrl("/wp-json/wp/v2/posts?per_page=100&orderby=id&order="
      + (order || "asc") + "&page=" + page + "&_fields=" + fields);
    var r = await ctx.xFetch(url);
    if (!r || !r.ok || !r.text) return null;
    try {
      var arr = JSON.parse(r.text);
      return Array.isArray(arr) ? arr : null;
    } catch (e) { return null; }
  },

  /**
   * Every post, in waves of 8. Stops on the first short page, and uses
   * `x-wp-totalpages` when available so it never probes past the end.
   */
  _allRestPosts: async function (fields, order, ctx) {
    var self = this;
    var first = await self._restPosts(1, fields, order, ctx);
    if (!first || !first.length) return [];
    var out = first.slice();
    if (first.length < 100) return out;

    // The total-pages header is the cheapest way to learn the page count.
    // It is an optimisation only — without it we walk until a short page,
    // which is the same rule _viewsAllIds already relies on.
    var totalPages = 0;
    try {
      var probe = await ctx.xFetch(self._absUrl("/wp-json/wp/v2/posts?per_page=1&_fields=id"));
      var hdr = probe && probe.headers
        ? (probe.headers["x-wp-totalpages"] || probe.headers["X-WP-TotalPages"])
        : null;
      totalPages = hdr ? parseInt(hdr, 10) : 0;
    } catch (e) { /* fine */ }

    var next = 2;
    while (next < 400) {
      if (totalPages && next > totalPages) break;
      var batch = [];
      for (var p = next; p < next + 8; p++) batch.push(p);
      if (totalPages && batch[0] > totalPages) break;
      var pages = await self._poolAll(batch, 8, function (pg) {
        return self._restPosts(pg, fields, order, ctx);
      });
      var short = false;
      for (var i = 0; i < pages.length; i++) {
        var arr = pages[i];
        // A failed page must NOT silently truncate the list: to the app that is
        // indistinguishable from chapters being deleted, and the refresh is
        // append-only so they would never come back.
        if (!arr) throw new Error("فشل جلب قائمة الفصول");
        for (var j = 0; j < arr.length; j++) out.push(arr[j]);
        if (arr.length < 100) { short = true; break; }
      }
      if (short) break;
      next += 8;
    }
    return out;
  },

  /** A REST post row -> ChapterMeta. */
  _postToChapter: function (post, index) {
    var rawTitle = this._decodeEntities(this._stripTags(
      (post.title && (post.title.rendered || post.title)) || ""
    )).trim();
    var numMatch = this._toLatinDigits(rawTitle).match(/^(\d+)/);
    var num = numMatch ? parseInt(numMatch[1], 10) : 0;
    var cleanTitle = rawTitle.replace(/^\d+\s*[-–:]\s*/, "").trim();
    var ts = Date.parse(post.date_gmt ? post.date_gmt + "Z" : (post.date || ""));
    var ch = {
      url: this._absUrl(post.link || ""),
      number: num,
      title: "الفصل " + (num || index + 1) + (cleanTitle ? " - " + cleanTitle : "")
    };
    // The site's own timestamp, or nothing at all. Never invented: the old
    // code spread un-dated chapters evenly across a date range, which put old
    // chapters on confident but false dates.
    if (!isNaN(ts) && ts > 0) ch.uploadedAt = ts;
    return ch;
  },

  parseChapterList: async function (novelUrl, ctx) {
    var self = this;
    var chapters = [];
    try {
      var posts = await self._allRestPosts("id,title,link,date_gmt", "asc", ctx);
      for (var i = 0; i < posts.length; i++) chapters.push(self._postToChapter(posts[i], i));
    } catch (e) {
      chapters = [];
    }
    if (chapters.length) {
      chapters.sort(function (a, b) { return (a.number || 0) - (b.number || 0); });
      return chapters;
    }
    // FALLBACK, kept on purpose: the HTML index page. If the site ever disables
    // the REST API, this regex still returns the full list, where a REST-only
    // implementation would report no chapters at all.
    return await self._chaptersFromListPage(ctx);
  },

  /**
   * Incremental refresh. Used to call the full parseChapterList and throw away
   * everything except the newest chapters — i.e. the "fast path" was paying the
   * entire 19.6 MB crawl. New posts are the highest ids, so one descending page
   * normally covers the gap; further pages are only fetched if the caller is
   * more than 100 chapters behind.
   */
  fetchLatestChapters: async function (novelUrl, knownCount, ctx) {
    var self = this;
    var found = [];
    var page = 1;
    while (page < 400) {
      // Page 1 is fetched ALONE, not as part of a parallel wave. The common case
      // is "a few new chapters at most", so a wave of speculative pages would
      // spend 4 requests to find out that 1 was enough. Further pages are only
      // requested once a whole page has come back unknown, which only happens
      // when the reader is genuinely far behind.
      var first = await self._restPosts(page, "id,title,link,date_gmt", "desc", ctx);
      if (!first) throw new Error("فشل جلب أحدث الفصول");
      var reachedKnown = false;
      var allNew = true;
      for (var i = 0; i < first.length; i++) {
        var ch = self._postToChapter(first[i], found.length);
        if (ch.number <= knownCount) { reachedKnown = true; allNew = false; break; }
        found.push(ch);
      }
      if (reachedKnown || first.length < 100 || !allNew) break;
      page++;
    }
    found.sort(function (a, b) { return (a.number || 0) - (b.number || 0); });
    return found;
  },

  _chaptersFromListPage: async function (ctx) {
    var listUrl = this._absUrl("/?w4pl=257");
    var res = await _fetchCachedPage(listUrl, ctx);
    if (!res.ok) throw new Error("فشل جلب قائمة فصول سيد الحقيقة: " + res.status);
    var html = res.text;

    var chapters = [];
    var seen = {};

    // Match links: <a class="...w4pl_post_title..." href="...">2422 -حب اللعبة لذاتها</a>
    var aRegex = /<a[^>]*class="[^"]*w4pl_post_title[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    var match;
    while ((match = aRegex.exec(html)) !== null) {
      var chUrl = this._absUrl(match[1].trim());
      if (seen[chUrl]) continue;
      seen[chUrl] = true;

      var rawTitle = this._decodeEntities(this._stripTags(match[2])).trim();
      var numMatch = this._toLatinDigits(rawTitle).match(/^(\d+)/);
      var chNum = numMatch ? parseInt(numMatch[1], 10) : 0;
      var cleanTitle = rawTitle.replace(/^\d+\s*[-–:]\s*/, "").trim();

      chapters.push({
        url: chUrl,
        number: chNum,
        title: "الفصل " + (chNum || chapters.length + 1) + (cleanTitle ? " - " + cleanTitle : "")
      });
    }

    // Fallback: search any links matching number pattern
    if (chapters.length === 0) {
      var fallbackRegex = /<a[^>]+href="([^"]*truthnovel\.top\/\d+-[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = fallbackRegex.exec(html)) !== null) {
        var fbUrl = this._absUrl(match[1].trim());
        if (seen[fbUrl]) continue;
        seen[fbUrl] = true;
        var fbTitle = this._decodeEntities(this._stripTags(match[2])).trim();
        var fbNumMatch = this._toLatinDigits(fbTitle).match(/^(\d+)/);
        var fbNum = fbNumMatch ? parseInt(fbNumMatch[1], 10) : 0;
        chapters.push({
          url: fbUrl,
          number: fbNum,
          title: fbTitle
        });
      }
    }

    // Sort ascending (Chapter 1 to Chapter 2400+)
    chapters.sort(function (a, b) {
      return (a.number || 0) - (b.number || 0);
    });
    return chapters;
  },

  // ---------------------------------------------------------------
  // Chapter content
  // ---------------------------------------------------------------
  parseChapterContent: async function (chapterUrl, ctx) {
    var fullUrl = this._absUrl(chapterUrl);
    var res = await ctx.xFetch(fullUrl);
    if (!res.ok) throw new Error("فشل جلب نص الفصل: " + res.status);
    var html = res.text;

    var contentMatch = html.match(/<div[^>]*class="[^"]*(?:bs-blog-post|entry-content)[^"]*"[^>]*>([\s\S]*?)(?=<footer|<div[^>]*class="[^"]*comments|$)/i);
    var block = contentMatch ? contentMatch[1] : html;

    // Remove scripts and styles
    block = block
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, "");

    var paragraphs = [];
    var pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    var pm;
    while ((pm = pRegex.exec(block)) !== null) {
      var text = this._decodeEntities(this._stripTags(pm[1])).trim();
      if (!text) continue;

      // Skip common navigation / disclaimers
      if (/^(الموضوع التالي|الموضوع السابق|الرئيسية|قائمة الفصول)/.test(text)) continue;
      text = text.replace(/https?:\/\/\S+/g, " ").replace(/[ \t\u00A0]{2,}/g, " ");
      text = text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "").trim();

      if (text) paragraphs.push(text);
    }

    if (paragraphs.length === 0) {
      return this._decodeEntities(this._stripTags(block)).replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "").trim();
    }

    return paragraphs.join("\n\n");
  },

  // ---------------------------------------------------------------
  // Search & Browse — returns the single novel
  // ---------------------------------------------------------------
  searchNovels: async function (query, page, ctx) {
    if (page && page > 1) return [];
    var novelUrl = this._absUrl("/?w4pl=257");
    var q = (query || "").trim().toLowerCase();

    if (q && q.indexOf("حقيق") === -1 && q.indexOf("سيد") === -1 && q.indexOf("truth") === -1) {
      return [{
        source: this.id,
        url: novelUrl,
        title: "سيد الحقيقة",
        author: "Zeus",
        coverUrl: this._coverUrl,
        category: "فانتازيا",
        status: "مستمرة"
      }];
    }

    return [{
      source: this.id,
      url: novelUrl,
      title: "سيد الحقيقة",
      author: "Zeus",
      coverUrl: this._coverUrl,
      category: "فانتازيا",
      status: "مستمرة"
    }];
  },

  getPopularNovels: async function (page, ctx) {
    return this.searchNovels("", page, ctx);
  },

  // ---------------------------------------------------------------
  // Site comments — read via WordPress RSS feed per chapter.
  // Flat list; host builds the reply tree from parentId.
  // ---------------------------------------------------------------
  getComments: async function (chapterUrl, ctx) {
    var fullUrl = this._absUrl(chapterUrl);
    var count = 0;
    var pageHtml = "";
    try {
      // Cached, not raw: the comment badge (getCommentCount) reads the SAME
      // 221 KB page for a single integer. Fetching it twice per chapter cost
      // ~443 KB; through the shared page cache the second read is free.
      // Trade-off, stated plainly: vote counts and the badge can be up to
      // _CACHE_TTL_MS stale instead of always-fresh.
      var pageRes = await _fetchCachedPage(fullUrl, ctx);
      if (pageRes && pageRes.ok && pageRes.text) {
        pageHtml = pageRes.text;
        var cc = pageHtml.match(/"commentCount"\s*:\s*(\d+)/);
        if (cc) count = parseInt(cc[1], 10);
        // The page is already in hand, so bank every count on it. This is what
        // lets the commenter profile show real numbers for a chapter the
        // reader has opened, with no extra request of its own.
        _rememberVotes(pageHtml);
      }
    } catch (e) { /* non-fatal */ }

    var feedUrl = fullUrl.replace(/\/?$/, "/") + "feed/";
    var feedRes = await ctx.xFetch(feedUrl);
    if (!feedRes.ok) throw new Error("فشل جلب تعليقات الفصل: " + feedRes.status);
    var xml = feedRes.text || "";
    var comments = [];
    var itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    var im;
    while ((im = itemRegex.exec(xml)) !== null) {
      var item = im[1];
      var linkM = item.match(/<link>([\s\S]*?)<\/link>/i);
      var link = linkM ? linkM[1].trim() : "";
      var idM = link.match(/#comment-(\d+)/);
      if (!idM) {
        var guidM = item.match(/#comment-(\d+)/);
        if (!guidM) continue;
        idM = guidM;
      }
      var id = idM[1];
      var authorM = item.match(/<dc:creator><!\[CDATA\[([\s\S]*?)\]\]><\/dc:creator>/i)
        || item.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/i);
      var author = authorM ? this._decodeEntities(this._stripTags(authorM[1])).trim() || "—" : "—";
      var dateM = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
      var createdAt = dateM ? Date.parse(dateM[1].trim()) : NaN;
      if (isNaN(createdAt)) createdAt = Date.now();
      var bodyM = item.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/i)
        || item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i);
      var rawBody = bodyM ? bodyM[1] : "";
      // Reply parent: "ردًا على <a href="...#comment-XXXX">" — ignore self-link
      var parentId = null;
      var pm = rawBody.match(/#comment-(\d+)/);
      if (pm && pm[1] !== id) parentId = pm[1];
      // Attachment images (wpDiscuz uploads). Skip WP smiley/emoji so they
      // don't render as full-width attachments (they stay as text).
      var images = [];
      try {
        var imgRegex = /<img[^>]*>/gi;
        var imgM;
        while ((imgM = imgRegex.exec(rawBody)) !== null && images.length < 4) {
          var tag = imgM[0];
          if (/wp-smiley/i.test(tag) || /s\.w\.org\/images/i.test(tag)) continue;
          var srcM = tag.match(/src=["']([^"']+)["']/i);
          if (srcM && /^https?:\/\//i.test(srcM[1]) && images.indexOf(srcM[1]) === -1) {
            images.push(srcM[1]);
          }
        }
      } catch (e3) { /* non-fatal */ }
      // Drop the "ردًا على ..." reference paragraph — threading already
      // shows the reply nesting, so keeping it duplicates it on every reply.
      var cleanHtml = rawBody
        .replace(/<p[^>]*>\s*رد[^<]*<a[^>]*>[\s\S]*?<\/a>\s*\.?\s*<\/p>/gi, " ")
        .replace(/<a[^>]*>[\s\S]*?<\/a>/gi, " ")
        .replace(/<img[^>]*>/gi, " ");
      var body = this._decodeEntities(this._stripTags(cleanHtml)).trim();
      body = body.replace(/^رد[ً'’]?\s*ا?\s*على\s*\.?\s*/i, "").trim();
      if (!body && images.length === 0) continue;
      var comment = { id: id, parentId: parentId, author: author, body: body, createdAt: createdAt, likes: 0, url: link };
      if (images.length > 0) comment.images = images;
      comments.push(comment);
    }
    // Likes: wpDiscuz up-votes rendered in chapter HTML as
    // id="comment-XXXX" ... wpd-vote-result ... title='N'>N. Feed has no
    // votes, so patch counts from the page (missing → 0).
    // Images: wpDiscuz attachments (wmu-comment-attachments) are NOT in the
    // RSS feed — merge them from the page by data-comment-id.
    try {
      if (pageHtml) {
        var attachMap = {};
        var attRe = /data-comment-id='(\d+)'/g;
        var attM;
        while ((attM = attRe.exec(pageHtml)) !== null) {
          var aid = attM[1];
          var awin = pageHtml.substr(attM.index, 4000);
          var urls = awin.match(/https?:\/\/truthnovel\.top\/wp-content\/uploads\/[^'"()\s]+?\.(?:gif|jpe?g|png|webp|bmp)/gi);
          if (urls) {
            var uniq = [];
            for (var ui = 0; ui < urls.length && uniq.length < 4; ui++) {
              if (uniq.indexOf(urls[ui]) === -1) uniq.push(urls[ui]);
            }
            if (uniq.length > 0) attachMap[aid] = uniq;
          }
        }
        for (var vi = 0; vi < comments.length; vi++) {
          var cid = comments[vi].id;
          if (attachMap[cid]) {
            var merged = (comments[vi].images || []).concat(attachMap[cid]);
            var dedup = [];
            for (var mi = 0; mi < merged.length && dedup.length < 4; mi++) {
              if (dedup.indexOf(merged[mi]) === -1) dedup.push(merged[mi]);
            }
            comments[vi].images = dedup;
          }
          var idx = pageHtml.indexOf('id="comment-' + cid + '"');
          if (idx === -1) continue;
          var window_ = pageHtml.substr(idx, 6000);
          var vm = window_.match(/wpd-vote-result[^>]*title='(-?\d+)'/);
          if (vm) {
            var v = parseInt(vm[1], 10);
            if (!isNaN(v) && v >= 0) comments[vi].likes = v;
          }
        }
      }
    } catch (e2) { /* non-fatal: keep 0 */ }
    comments.sort(function (a, b) { return a.createdAt - b.createdAt; });
    if (!count) count = comments.length;
    return { count: count, comments: comments };
  },

  // ---------------------------------------------------------------
  // Count-only fast path for the reader badge: the chapter page already
  // embeds "commentCount" — no feed fetch, no comment parsing. Falls back
  // to counting feed items when the page marker is absent.
  // ---------------------------------------------------------------
  getCommentCount: async function (chapterUrl, ctx) {
    var fullUrl = this._absUrl(chapterUrl);
    try {
      // Shared cache: opening a chapter makes getComments pull this exact
      // 221 KB page, so the badge is normally free instead of a second full
      // download of the same bytes.
      var pageRes = await _fetchCachedPage(fullUrl, ctx);
      if (pageRes && pageRes.ok && pageRes.text) {
        var cc = pageRes.text.match(/"commentCount"\s*:\s*(\d+)/);
        if (cc) return { count: parseInt(cc[1], 10) };
      }
    } catch (e) { /* fall through to feed */ }
    var feedUrl = fullUrl.replace(/\/?$/, "/") + "feed/";
    var feedRes = await ctx.xFetch(feedUrl);
    if (!feedRes.ok) throw new Error("فشل جلب عدد التعليقات: " + feedRes.status);
    var n = ((feedRes.text || "").match(/<item>/gi) || []).length;
    return { count: n };
  },

  // ---------------------------------------------------------------
  // Guest post to wpDiscuz (host enforces app login; author = username).
  // Verified protocol (Sep 2026, wpDiscuz 7.6.62):
  // 1. GET chapter HTML -> "wc_post_id":"10897"
  // 2. POST admin-ajax.php action=wpdGetNonce -> data.wpdiscuz_nonce
  // 3. POST admin-ajax.php action=wpdAddComment with postId,
  //    wpdiscuz_unique_id (0_0 top-level, {parentId}_0 reply),
  //    wpd_comment_depth, wc_comment/wc_name/wc_email + nonce.
  // Replies return is_main:0 + level-2; first-time guests get
  // held_moderate:1 (invisible in feed until approved).
  // ---------------------------------------------------------------
  postComment: async function (chapterUrl, input, ctx) {
    // Step 1 is RESOLVING the post id, and it used to do that by downloading
    // the entire chapter page (~195 KB) on every single post. The REST posts
    // endpoint is a few hundred bytes for the same number, so the page fetch
    // only remains as a fallback for a URL REST cannot resolve.
    var fullUrl = this._absUrl(chapterUrl);
    var postId = await _resolvePostId(fullUrl, ctx);
    var author = (input && input.author || "").trim().slice(0, 50);
    var email = (input && input.email || "").trim().slice(0, 100);
    var body = (input && input.body || "").trim();
    if (!author || !body) throw new Error("الاسم والنص مطلوبان");
    if (author.length < 3) throw new Error("الاسم قصير (3 أحرف على الأقل)");
    var parentRaw = input && input.parentId ? String(input.parentId).replace(/\D/g, "") : "";
    var ajaxUrl = this._absUrl("/wp-admin/admin-ajax.php");
    // 1) Nonce (cached — see _getNonce; wpDiscuz does not embed it in the HTML)
    var nonce = await _getNonce(ctx);
    // 2) Threading: top-level 0_0/depth 1; reply {parent}_0/depth parent+1
    var uniqueId = "0_0";
    var depth = "1";
    if (parentRaw) {
      uniqueId = parentRaw + "_0";
      depth = "2";
      try {
        var lvlM = html.match(new RegExp("wpd-comm-" + parentRaw + "[^']*'[^>]*wpd_comment_level-(\\d)"));
        if (lvlM) {
          var pd = parseInt(lvlM[1], 10);
          if (!isNaN(pd) && pd >= 1 && pd < 5) depth = String(pd + 1);
        }
      } catch (e2) { /* keep depth 2 */ }
    }
    var params = "action=wpdAddComment&postId=" + encodeURIComponent(postId)
      + "&wpdiscuz_unique_id=" + encodeURIComponent(uniqueId)
      + "&wpdiscuz_nonce=" + encodeURIComponent(nonce)
      + "&wc_comment=" + encodeURIComponent(body)
      + "&wc_name=" + encodeURIComponent(author)
      + "&wc_email=" + encodeURIComponent(email)
      + "&wc_website=&wpd_comment_depth=" + encodeURIComponent(depth);
    var res = await ctx.xFetch(ajaxUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: params
    });
    if (!res.ok) throw new Error("فشل إرسال التعليق: " + res.status);
    var data;
    try { data = JSON.parse(res.text); } catch (e) { throw new Error("رد غير متوقع من الموقع"); }
    var payload = data && data.data ? data.data : data;
    if (data && data.success === false) {
      throw new Error((payload && (payload.message || payload)) || "رفض الموقع التعليق");
    }
    var newId = payload && (payload.new_comment_id || payload.comment_id || payload.commentId)
      ? String(payload.new_comment_id || payload.comment_id || payload.commentId)
      : undefined;
    var held = payload && (payload.held_moderate === 1 || payload.held_moderate === "1"
      || payload.held_for_moderation || payload.moderation) ? true : false;
    return { ok: true, id: newId, needsModeration: held };
  },

  // ---------------------------------------------------------------
  // Guest vote (verified Sep 2026: wpDiscuz accepts guest votes,
  // tracked by IP/cookie — no login needed). Sending the same voteType
  // again toggles it off (curUserReaction 0). Returns server counts.
  // ---------------------------------------------------------------
  voteComment: async function (chapterUrl, input, ctx) {
    var rawId = input && input.commentId ? String(input.commentId).replace(/\D/g, "") : "";
    if (!rawId) throw new Error("تعذر تحديد التعليق");
    var vote = input && input.vote === -1 ? "-1" : "1";
    var ajaxUrl = this._absUrl("/wp-admin/admin-ajax.php");
    // Cached nonce: this used to be its own request on every single vote,
    // doubling the cost of tapping a heart.
    var nonce = await _getNonce(ctx);
    var params = "action=wpdVoteOnComment&commentId=" + encodeURIComponent(rawId)
      + "&voteType=" + encodeURIComponent(vote)
      + "&wpdiscuz_nonce=" + encodeURIComponent(nonce);
    var res = await ctx.xFetch(ajaxUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: params
    });
    if (!res.ok) throw new Error("فشل التصويت: " + res.status);
    var data;
    try { data = JSON.parse(res.text); } catch (e) { throw new Error("رد غير متوقع من الموقع"); }
    if (data && data.success === false) {
      var msg = data.data && (data.data.message || data.data);
      throw new Error(msg || "رفض الموقع التصويت");
    }
    var d = data && data.data ? data.data : {};
    var likes = parseInt(d.likeCount, 10);
    if (isNaN(likes) || likes < 0) likes = 0;
    // The vote response is the only place a count appears without a chapter
    // fetch, so bank it: the profile shows the exact number straight away and
    // keeps it for the rest of the session.
    _voteCounts[rawId] = likes;
    return { ok: true, likes: likes, liked: d.curUserReaction === 1 || d.curUserReaction === "1" };
  },

  getCategories: async function () {
    return [{ name: "فانتازيا", slug: "fantasy" }];
  },

  getCategoryNovels: async function (categorySlug, page, ctx) {
    return this.searchNovels("", page, ctx);
  },

  // ---------------------------------------------------------------
  // Author comments across all chapters (WP REST API)
  // ---------------------------------------------------------------
  getAuthorComments: async function (authorName, page, ctx) {
    var self = this;
    var name = (authorName || "").trim();
    if (!name) return { authorName: "", totalComments: 0, totalLikes: 0, comments: [], hasMore: false };
    var pageNum = typeof page === "number" && page >= 1 ? page : 1;
    var perPage = 30;
    // `_embed=up` inlines each comment's ENTIRE parent post. On a novel site a
    // post IS a chapter, so that embedded the full chapter text under every
    // comment: measured 700 KB for one 30-card page. `_fields` asks for the six
    // keys actually used, and the chapter title/link is then resolved in ONE
    // batched `include=` request below. Same data, ~12 KB.
    var apiUrl = this._absUrl("/wp-json/wp/v2/comments?search=" + encodeURIComponent(name)
      + "&per_page=" + perPage + "&page=" + pageNum
      + "&_fields=id,author_name,content,link,date,date_gmt,parent,post");
    var res = await ctx.xFetch(apiUrl);
    if (!res.ok) {
      if (res.status === 400 || res.status === 404) {
        return { authorName: name, totalComments: 0, totalLikes: 0, comments: [], hasMore: false };
      }
      throw new Error("فشل جلب تعليقات المعلق: " + res.status);
    }
    var totalHeader = (res.headers && (res.headers["x-wp-total"] || res.headers["X-WP-Total"])) || "0";
    var totalPagesHeader = (res.headers && (res.headers["x-wp-totalpages"] || res.headers["X-WP-TotalPages"])) || "1";
    var total = parseInt(totalHeader, 10);
    if (isNaN(total) || total < 0) total = 0;
    var totalPages = parseInt(totalPagesHeader, 10);
    if (isNaN(totalPages) || totalPages < 1) totalPages = 1;

    var rawList = [];
    try {
      rawList = JSON.parse(res.text) || [];
    } catch (e) {
      throw new Error("رد غير متوقع من الموقع");
    }
    if (!Array.isArray(rawList)) rawList = [];

    var normalizedTarget = name.toLowerCase();
    var filtered = rawList.filter(function (item) {
      var an = (item && item.author_name ? String(item.author_name) : "").trim().toLowerCase();
      return an === normalizedTarget;
    });

    var cleanText = function (html) {
      if (!html) return "";
      var stripped = html.replace(/<[^>]+>/g, " ");
      return self._decodeEntities(stripped)
        .replace(/\s+/g, " ")
        .trim();
    };

    // Chapter title + permalink, for EVERY post referenced on this page, in a
    // single request. This replaces both the inlined `_embed=up` copies and
    // the old one-request-per-post loop (up to 10 round trips).
    var postIds = [];
    for (var i = 0; i < filtered.length; i++) {
      var pidRaw = filtered[i] && filtered[i].post;
      if (pidRaw && postIds.indexOf(pidRaw) === -1) postIds.push(pidRaw);
    }
    var postMap = {};
    if (postIds.length) {
      try {
        var postsRes = await ctx.xFetch(this._absUrl("/wp-json/wp/v2/posts?include="
          + postIds.join(",") + "&per_page=" + Math.min(postIds.length, 100)
          + "&_fields=id,title,link"));
        if (postsRes.ok) {
          var postsJson = JSON.parse(postsRes.text);
          if (Array.isArray(postsJson)) {
            for (var pi = 0; pi < postsJson.length; pi++) {
              var pj = postsJson[pi];
              if (!pj || !pj.id) continue;
              var pt2 = pj.title && (pj.title.rendered || pj.title);
              postMap[pj.id] = { title: cleanText(pt2), link: pj.link || "" };
            }
          }
        }
      } catch (pe2) { /* non-fatal: cards fall back to the number label */ }
    }

    var comments = [];
    var totalLikes = 0;
    for (var j = 0; j < filtered.length; j++) {
      var c = filtered[j];
      var postInfo = postMap[c.post] || {};
      var dateMs = Date.parse(c.date_gmt ? c.date_gmt + "Z" : c.date) || Date.now();
      var body = cleanText(c.content && c.content.rendered ? c.content.rendered : "");
      
      var images = [];
      if (c.content && c.content.rendered) {
        var imgMatches = c.content.rendered.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/g);
        if (imgMatches) {
          for (var im = 0; im < imgMatches.length; im++) {
            var srcM = imgMatches[im].match(/src=["'](https?:\/\/[^"']+)["']/);
            if (srcM && srcM[1] && !/wpdiscuz|smiles|emoji/i.test(srcM[1])) {
              images.push(srcM[1]);
            }
          }
        }
      }

      var chapterUrl = (c.link ? c.link.split("#")[0] : "") || postInfo.link || "";

      var entry = {
        id: String(c.id),
        body: body,
        createdAt: dateMs,
        chapterTitle: postInfo.title || ("الفصل " + (c.post || "")),
        chapterUrl: chapterUrl,
        images: images.length > 0 ? images.slice(0, 4) : undefined
      };
      // `likes` is set ONLY when we actually know the number (from the reader
      // path, or from an earlier vote). The field is otherwise absent, which
      // the host renders as "no count". The old code wrote a hardcoded 0 for
      // every comment, so any card whose chapter it had not scraped displayed
      // a confident, wrong zero.
      var known = _knownVotes(c.id);
      if (known !== undefined) {
        entry.likes = known;
        totalLikes += known;
      }
      // WP REST parent id (0 = top-level). Kept so the host can show the
      // original comment inside reply cards; resolved below.
      var pId = parseInt(c.parent, 10);
      if (!isNaN(pId) && pId > 0) entry.parentId = String(pId);
      comments.push(entry);
    }

    // Resolve reply parents: ONE batched request (include=) for all unique
    // parents instead of N sequential fetches, so reply cards can quote the
    // original. Capped at 10 parents; failures are non-fatal (reply just
    // shows without the quote).
    try {
      var parentIds = [];
      for (var qi = 0; qi < comments.length; qi++) {
        var qpid = comments[qi].parentId;
        if (qpid && parentIds.indexOf(qpid) === -1 && parentIds.length < 10) parentIds.push(qpid);
      }
      if (parentIds.length > 0) {
        var parentMap = {};
        try {
          var qpRes = await _fetchCachedPage(self._absUrl("/wp-json/wp/v2/comments?include=" + parentIds.join(",") + "&_fields=id,author_name,content&per_page=100"), ctx);
          if (qpRes && qpRes.ok && qpRes.text) {
            var qpList = JSON.parse(qpRes.text);
            if (!Array.isArray(qpList)) qpList = [];
            for (var qj = 0; qj < qpList.length; qj++) {
              var qp = qpList[qj];
              if (qp && qp.id) {
                parentMap[String(qp.id)] = {
                  author: cleanText(qp.author_name) || "—",
                  body: cleanText(qp.content && qp.content.rendered ? qp.content.rendered : "")
                };
              }
            }
          }
        } catch (qe) { /* non-fatal: skip quotes */ }
        for (var qk = 0; qk < comments.length; qk++) {
          var qInfo = comments[qk].parentId && parentMap[comments[qk].parentId];
          if (qInfo && (qInfo.body || qInfo.author)) {
            comments[qk].replyToAuthor = qInfo.author;
            if (qInfo.body) comments[qk].replyToBody = qInfo.body;
          }
        }
      }
    } catch (qe2) { /* non-fatal: keep comments without quotes */ }

    // Counts are NOT fetched here any more.
    //
    // This block used to download up to 10 whole chapter pages (~195 KB each,
    // ~1.95 MB per profile open) purely to re-scrape wpDiscuz vote totals —
    // and still got it wrong for every comment past the 10-chapter cap, which
    // silently rendered as a hardcoded 0. The reader path already parses that
    // identical page and banks every count into `_voteCounts`, so a chapter you
    // have opened is known here for free and forever. Anything not in that map
    // is reported WITHOUT a `likes` key, and the host draws no number rather
    // than a wrong one. Tapping the heart on such a card returns the exact
    // count and banks it for next time.
    return {
      authorName: name,
      totalComments: total > 0 ? total : comments.length,
      // Sum of what is actually known, not a guess. A partial total is honest;
      // the old code summed a mix of real and fabricated zeros.
      totalLikes: totalLikes,
      comments: comments,
      hasMore: pageNum < totalPages
    };
  }
});
