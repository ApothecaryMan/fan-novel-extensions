/**
 * Extension: Truth Novel Beta (تجريبية لمنصة Nexus الجديدة + أرشيف القديم)
 *
 * Live site (https://truthnovel.top) was rebuilt from WordPress into a
 * Next.js platform ("Nexus Novels") with a single novel so far. This beta
 * reads the new server-rendered pages:
 *   novel info / chapter list / chapter text / comments are all embedded
 *   in the HTML (meta tags + RSC flight payload), no login needed.
 *
 * Old chapters (1..2524) are gone from the live site, so the chapter list is
 * completed from the Wayback Machine CDX index and each archived chapter is
 * read from its web.archive.org snapshot (WordPress markup, read-only).
 *
 * Writing (post/vote) on the new site is login-gated server actions, which
 * the sandbox cannot perform: those methods throw an Arabic message telling
 * the reader to participate on the site directly.
 */

// @id site:truthnovelbeta
// @name Truth Novel Beta
// @lang ar
// @version 1.3.0
// @apiVersion 2
// @baseUrl https://truthnovel.top

var _htmlCache = {};
var _CACHE_TTL_MS = 10 * 60 * 1000;
var _CACHE_MAX_ENTRIES = 40;
var _CACHE_MAX_BYTES = 12 * 1024 * 1024;
var _CACHE_BYTES = 0;
var _inflight = {};

function _evictCache() {
  var keys = Object.keys(_htmlCache);
  while (keys.length > _CACHE_MAX_ENTRIES || _CACHE_BYTES > _CACHE_MAX_BYTES) {
    var oldestKey = null;
    var oldestUsed = Infinity;
    for (var i = 0; i < keys.length; i++) {
      var e = _htmlCache[keys[i]];
      if (!e) continue;
      if (e.used < oldestUsed) { oldestUsed = e.used; oldestKey = keys[i]; }
    }
    if (!oldestKey) return;
    _CACHE_BYTES -= _htmlCache[oldestKey].text.length;
    delete _htmlCache[oldestKey];
    keys = Object.keys(_htmlCache);
  }
}

function _fetchCachedPage(url, ctx) {
  var now = Date.now();
  var hit = _htmlCache[url];
  if (hit && now - hit.ts < _CACHE_TTL_MS) {
    hit.used = now;
    return Promise.resolve({ ok: true, status: hit.status || 200, text: hit.text, headers: hit.headers });
  }
  if (hit) _CACHE_BYTES -= hit.text.length;
  var pending = _inflight[url];
  if (pending) return pending;
  var p = ctx.xFetch(url).then(function (res) {
    delete _inflight[url];
    if (res.ok && typeof res.text === "string") {
      _htmlCache[url] = { text: res.text, ts: now, used: now, headers: res.headers, status: res.status };
      _CACHE_BYTES += res.text.length;
      _evictCache();
    }
    return res;
  }, function (err) {
    delete _inflight[url];
    throw err;
  });
  _inflight[url] = p;
  return p;
}

/** Unescape a JS-string-escaped payload (RSC flight data). */
function _unescapeJs(s) {
  return String(s).replace(/\\(u[0-9a-fA-F]{4}|n|t|r|b|f|"|\\|\/)/g, function (m, c) {
    if (c === "n") return "\n";
    if (c === "t") return "\t";
    if (c === "r") return "\r";
    if (c === "b") return "\b";
    if (c === "f") return "\f";
    if (c === "\"") return "\"";
    if (c === "\\") return "\\";
    if (c === "/") return "/";
    return String.fromCharCode(parseInt(c.slice(1), 16));
  });
}

/**
 * Balanced scan from an opening bracket, respecting "..." strings and
 * backslash escapes. Returns the substring INCLUDING the brackets.
 */
function _balanced(src, openIdx, openCh, closeCh) {
  var depth = 0;
  var inStr = false;
  for (var i = openIdx; i < src.length; i++) {
    var c = src[i];
    if (c === '"') {
      var bs = 0;
      for (var j = i - 1; j >= openIdx && src[j] === "\\"; j--) bs++;
      if (bs % 2 === 0) inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return null;
}

/** Extract the object after `"key":` (raw or JS-escaped marker), unescaped. */
function _extractObject(html, key) {
  var at = html.indexOf('"' + key + '":');
  if (at === -1) at = html.indexOf('\\"' + key + '\\":');
  if (at === -1) return null;
  var open = html.indexOf("{", at);
  if (open === -1) return null;
  var raw = _balanced(html, open, "{", "}");
  if (!raw) return null;
  return raw.indexOf('\"') !== -1 ? _unescapeJs(raw) : raw;
}

/** Extract the array after `"key":` (raw or JS-escaped marker), unescaped. */
function _extractArray(html, key) {
  var at = html.indexOf('"' + key + '":');
  if (at === -1) at = html.indexOf('\\"' + key + '\\":');
  if (at === -1) return null;
  var open = html.indexOf("[", at);
  if (open === -1) return null;
  var raw = _balanced(html, open, "[", "]");
  if (!raw) return null;
  return raw.indexOf('\"') !== -1 ? _unescapeJs(raw) : raw;
}

registerExtension({
  id: "site:truthnovelbeta",
  name: "Truth Novel Beta",
  lang: "ar",
  version: "1.3.0",
  apiVersion: 2,
  baseUrl: "https://truthnovel.top",

  // Login contract for the host (same shape as the kolnovel auth block:
  // the host discovers this after install and wires the login sheet,
  // session storage, and credential injection — the sandbox never sees
  // passwords). Nexus signs in via Better Auth (email + password) and
  // keeps a session cookie the host cookie-jar replays on xFetch.
  auth: {
    kind: "better-auth",
    apiBaseUrl: "https://truthnovel.top",
    loginPath: "/login",
    registerPath: "/register"
  },

  _NOVEL_SLUG: "لورد-الحقيقة",
  _AUTHOR: "اسلام النجار",
  _coverFallback: "https://truthnovel.top/media/covers/1eb35d9a-cb8d-4d7f-ae0e-51912e07b049.webp",

  _novelUrl: function () {
    return this.baseUrl.replace(/\/$/, "") + "/novels/" + this._NOVEL_SLUG;
  },

  _readUrl: function (number) {
    return this.baseUrl.replace(/\/$/, "") + "/read/" + this._NOVEL_SLUG + "/" + number;
  },

  _isArchiveUrl: function (url) {
    return String(url || "").indexOf("web.archive.org") !== -1;
  },

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
      ldquo: '“', rdquo: '”', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™',
      rlm: '\u200F'
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
      .replace(/[[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]]/g, function (d) { return String(d.charCodeAt(0) - 0x660); })
      .replace(/[[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]]/g, function (d) { return String(d.charCodeAt(0) - 0x6F0); });
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
    var rel = str.replace(/،/g, " ");
    var dualUnit = null;
    if (/ساعتين/.test(rel)) dualUnit = "hours2";
    else if (/دقيقتين/.test(rel)) dualUnit = "minutes2";
    else if (/يومين/.test(rel)) dualUnit = "days2";
    else if (/أسبوعين|اسبوعين/.test(rel)) dualUnit = "weeks2";
    else if (/شهرين/.test(rel)) dualUnit = "months2";
    else if (/سنتين|عامين/.test(rel)) dualUnit = "years2";
    var mNum = rel.match(/(\d+)\s*(?:من\s*)?(?:ثاني|ثانية|ثواني|دقيق|دقيقة|دقائق|ساع|ساعة|ساعات|يوم|أيام|ايام|أسبوع|اسبوع|أسابيع|اسابيع|شهر|شهور|أشهر|اشهر|سنة|سنوات|عام|أعوام|اعوام)/);
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
        if (delta > 0) return now - delta;
      } else if (/الآن|الان|just now/i.test(rel)) {
        return now;
      }
    }
    return undefined;
  },

  _parseChapterNumber: function (rawTitle) {
    var latin = this._toLatinDigits(rawTitle || "");
    var m = latin.match(/^(\d+(?:\.\d+)*)/);
    if (!m) return 0;
    var parts = m[1].split(".");
    if (parts.length <= 2) {
      var v = parseFloat(m[1]);
      return isNaN(v) ? 0 : v;
    }
    var head = parseInt(parts[0], 10);
    var tail = parts.slice(1).join("");
    var frac = parseFloat("0." + tail);
    if (isNaN(head)) return 0;
    return head + (isNaN(frac) ? 0 : frac);
  },

  _meta: function (html, prop) {
    var m = html.match(new RegExp('<meta[^>]+property="' + prop + '"[^>]+content="([^"]*)"', 'i'))
      || html.match(new RegExp('<meta[^>]+content="([^"]*)"[^>]+property="' + prop + '"', 'i'))
      || html.match(new RegExp('<meta[^>]+name="' + prop + '"[^>]+content="([^"]*)"', 'i'));
    return m ? m[1] : "";
  },

  /**
   * Novel page -> metadata + live chapter entries.
   * Chapters come from the RSC payload `"chapters":[{number,title,publishedAt}]`.
   */
  _parseNovelPage: function (html) {
    var self = this;
    var title = self._decodeEntities(self._meta(html, "og:title")).trim();
    if (!title) {
      var tm = html.match(/<title>([\s\S]*?)<\/title>/i);
      title = tm ? self._decodeEntities(self._stripTags(tm[1])).split(/[·—|\-]/)[0].trim() : "لورد الحقيقة";
    }
    var author = this._AUTHOR;
    var cover = self._meta(html, "og:image") || "";
    if (cover && cover.charAt(0) === "/") cover = self._absUrl(cover);
    if (!cover) cover = self._coverFallback;
    var summary = self._decodeEntities(self._meta(html, "og:description") || self._meta(html, "description")).trim();
    var status = "مستمرة";
    if (/متوقفة/.test(html)) status = "متوقفة";
    else if (/مكتملة/.test(html)) status = "مكتملة";
    var readersCount;
    try {
      var pairRe = /<dt[\s\S]*?<\/dt>\s*<dd[^>]*>([^<]*)<\/dd>/gi;
      var pm;
      while ((pm = pairRe.exec(html)) !== null) {
        var dtPart = pm[0].slice(0, pm[0].indexOf("</dt>") + 5);
        var label = self._decodeEntities(self._stripTags(dtPart)).trim();
        if (label === "\u0642\u0631\u0627\u0621\u0629" || (label.indexOf("\u0642\u0631\u0627\u0621\u0629") !== -1 && label.indexOf("\u062f\u0642\u064a\u0642\u0629") === -1)) {
          readersCount = self._normCompactCount(pm[1]);
          break;
        }
      }
    } catch (e) { readersCount = undefined; }
    if (!readersCount) {
      var rm = self._toLatinDigits(html).match(/([\d,]+)\s*قراءة/);
      if (rm) readersCount = rm[1].replace(/,/g, "");
    }
    var chapters = [];
    var arr = _extractArray(html, "chapters");
    if (arr) {
      var objRe = /\{([^{}]*)\}/g;
      var om;
      while ((om = objRe.exec(arr)) !== null) {
        var body = om[1];
        var nm = body.match(/"number"\s*:\s*(\d+(?:\.\d+)?)/);
        if (!nm) continue;
        var num = parseFloat(nm[1]);
        var titleM = body.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        var chTitle = titleM ? _unescapeJs(titleM[1]) : "";
        var dateM = body.match(/"publishedAt"\s*:\s*"([^"]*)"/);
        var ts = dateM ? Date.parse(dateM[1]) : NaN;
        chapters.push({ number: num, title: chTitle, publishedAt: isNaN(ts) ? 0 : ts });
      }
    }
    return { title: title, author: author, cover: cover, summary: summary, status: status, readersCount: readersCount, chapters: chapters };
  },

  /** Compact Arabic counters ("1.2 ألف", "367") -> plain digits. */
  _normCompactCount: function (raw) {
    var s = this._toLatinDigits(String(raw || "")).replace(/,/g, "");
    var m = s.match(/([\d.]+)\s*(ألف|مليون)/);
    if (m) {
      var v = parseFloat(m[1]);
      if (isNaN(v)) return undefined;
      if (m[2] === "ألف") v *= 1000;
      else v *= 1000000;
      return String(Math.round(v));
    }
    var d = s.match(/\d+/);
    return d ? d[0] : undefined;
  },

  /** Live chapter entry -> ChapterMeta. */
  _liveChapter: function (entry) {
    var num = entry.number || 0;
    var clean = String(entry.title || "").trim();
    var ch = {
      url: this._readUrl(num),
      number: num,
      title: "الفصل " + (num || "") + (clean ? " - " + clean : "")
    };
    if (entry.publishedAt) ch.uploadedAt = entry.publishedAt;
    return ch;
  },

  /**
   * Archived chapters via the Wayback CDX index: one lightweight JSON listing
   * every captured truthnovel.top chapter URL. Best-effort: any failure
   * resolves to [] so the live list still loads.
   */
  /**
   * Archived chapters (1..2524) from a baked Wayback index.
   *
   * The live site only serves the newest chapter, and a runtime CDX query
   * proved too slow/flaky inside the app (60s+ timeouts), so the index is
   * baked in at build time: verified CDX captures carry their exact
   * timestamp, list-page-only links fall back to a partial-timestamp URL
   * that the archive resolves to the nearest capture. No network needed
   * to build the list; snapshots load on demand when a chapter opens.
   */
  _ARCH_INDEX: [[1,"%D8%B9%D8%A8%D9%82%D8%B1%D9%8A","20250321183621"],[2,"%d8%a7%d8%ae%d8%aa%d9%8a%d8%a7%d8%b1",""],[3,"%D9%82%D8%B1%D8%A7%D8%B1","20260606021210"],[4,"%D8%AE%D8%B7%D9%88%D8%A7%D8%AA-%D9%85%D9%87%D8%AA%D8%B2%D8%A9","20260610180537"],[5,"%d8%b9%d8%b4%d8%b1-%d8%b3%d9%86%d9%88%d8%a7%d8%aa",""],[6,"%D8%B5%D8%B1%D8%AE%D8%A9","20260612045235"],[7,"%D8%AA%D8%AC%D8%B1%D9%8A-%D8%A7%D9%84%D8%B3%D9%86%D9%8A%D9%86","20260610191821"],[8,"%D9%88%D8%B1%D9%8A%D8%AB","20260610191955"],[9,"%D8%A7%D9%84%D8%B6%D9%88%D8%A1-%D9%81%D9%8A-%D9%86%D9%87%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%B3%D8%B1%D9%8A%D8%B1","20250322182255"],[10,"%d8%b1%d8%ac%d9%84-%d8%a7%d9%84%d8%b6%d9%88%d8%a1",""],[11,"%D8%A8%D8%AF%D8%A3-%D8%A7%D9%84%D8%B1%D8%AD%D9%84%D8%A9","20260610192327"],[12,"%D9%84%D9%82%D8%A7%D8%A1-%D9%85%D9%8A%D9%84%D8%A7-%D9%85%D8%AC%D8%AF%D8%AF%D8%A7%D9%8B","20260606015807"],[13,"%d8%a7%d8%aa%d9%81%d8%a7%d9%82",""],[14,"%D9%85%D9%81%D8%AA%D8%A7%D8%AD","20260606015516"],[15,"%D8%A3%D9%86%D9%85%D8%A7%D8%B7","20260610191843"],[16,"%D8%A7%D9%88%D9%84-%D8%AE%D8%B7%D9%88%D8%A9","20260606011851"],[17,"%D8%A7%D9%84%D8%B5%D8%A7%D9%85%D8%AA","20260606021543"],[18,"%d8%a7%d8%b9%d9%85%d8%a7%d9%84-%d8%b9%d8%a7%d9%84%d9%82%d8%a9",""],[19,"%D8%AA%D8%A8%D8%B6%D8%B9","20260610180357"],[20,"%D8%BA%D8%B6%D8%A8","20260606020606"],[21,"%D8%B9%D9%86%D8%AF-%D8%A7%D9%84%D9%85%D9%86%D8%B5%D8%A9-%D9%85%D8%AC%D8%AF%D8%AF%D8%A7%D9%8B","20260607235546"],[22,"%D8%A3%D8%A8%D9%86%D8%A7%D8%A1-%D9%83%D8%A7%D9%85%D8%AF%D9%8A%D9%86","20260612045838"],[23,"%D8%A7%D9%84%D8%B8%D9%84%D8%A7%D9%85","20260612043150"],[24,"%D8%AD%D8%A8%D9%88%D8%A8%D8%9F","20260606013618"],[25,"%D9%8A%D9%88%D9%85-%D8%A7%D9%84%D9%88%D8%B9%D8%AF","20260610180432"],[26,"%d9%82%d8%aa%d8%a7%d9%84",""],[27,"%D8%A7%D9%84%D8%B4%D8%B9%D9%84%D8%A9-%D8%A7%D9%84%D8%A8%D9%8A%D8%B6%D8%A7%D8%A1","20250404080211"],[28,"%D8%A7%D9%84%D9%85%D9%8A%D8%B2%D8%A7%D9%86","20260612053818"],[29,"%D9%82%D8%B7%D8%B9%D8%A9-%D8%AC%D9%90%D9%84%D8%AF","20260606022626"],[30,"%d8%a7%d8%ae%d8%a8%d8%a7%d8%b1",""],[31,"%d9%84%d9%82%d8%a7%d8%a1-%d8%a8%d8%b9%d8%af-%d8%b2%d9%85%d9%86",""],[32,"%D8%A7%D9%86%D9%87-%D8%A5%D8%A8%D9%86%D9%8A","20260610175403"],[33,"%D9%81%D8%B1%D8%A7%D9%82","20260612042802"],[34,"%D8%A7%D9%84%D8%B8%D9%84%D8%A7%D9%85-%D8%A7%D9%84%D9%85%D8%AB%D8%A7%D9%84%D9%8A","20260610192107"],[35,"%D9%82%D8%A7%D8%B9%D8%A9-%D9%85%D8%B2%D8%A7%D8%AF","20260610191008"],[36,"%D8%A7%D8%AE%D8%A8%D8%A7%D8%B1-%D9%82%D9%8A%D8%B5%D8%B1","20260612045743"],[37,"%D8%B9%D8%AA%D8%A7%D8%AF-%D8%A7%D9%84%D8%B9%D8%A7%D9%84%D9%85","20260606010101"],[38,"%D8%A7%D8%B9%D9%84%D8%A7%D9%86","20260612044557"],[39,"%d8%a8%d9%8a%d8%b9%d9%8e%d8%aa",""],[40,"%D8%AF%D9%88%D8%B1%D8%A9-%D8%A7%D9%84%D9%85%D9%85%D8%A7%D9%84%D9%83-%D8%A7%D9%84%D8%AB%D9%85%D8%A7%D9%86%D9%8A%D8%A9","20250405012134"],[41,"%d9%85%d9%85%d9%84%d9%83%d8%a9-%d8%af%d9%88%d9%84%d9%8a%d9%81%d8%a7%d8%b1",""],[42,"%d8%a7%d9%84%d8%b5%d8%af%d8%a7%d9%85-%d8%a7%d9%84%d8%a7%d9%88%d9%84",""],[43,"%d8%b9%d9%82%d8%a7%d8%a8",""],[44,"%d9%82%d8%a8%d9%84-%d8%a7%d9%84%d8%a5%d8%b9%d9%84%d8%a7%d9%86",""],[45,"%D8%AD%D8%AF%D8%AB-%D8%B5%D9%8A%D8%AF%D8%9F","20260607230604"],[46,"%D8%B4%D8%A7%D8%A8%D8%A7%D9%86","20260610182940"],[47,"%D8%AF%D8%B9%D9%85","20260612044212"],[48,"%D8%B9%D9%84%D9%89-%D8%A7%D9%84%D8%A3%D8%B9%D8%AA%D8%A7%D8%A8","20250420134632"],[49,"%D8%A8%D8%AF%D8%A3-%D8%AD%D8%AF%D8%AB-%D8%A7%D9%84%D8%B5%D9%8A%D8%AF","20260610181714"],[50,"%D8%A7%D9%84%D8%B9%D8%AF-%D8%A7%D9%84%D8%AA%D9%86%D8%A7%D8%B2%D9%84%D9%8A","20260612043556"],[51,"%d8%b0%d8%b1%d8%a7%d8%b9-%d8%ac%d8%af%d9%8a%d8%af%d8%a9%d8%9f",""],[52,"%D9%88%D9%87%D8%AC","20250420143546"],[53,"%D8%AD%D8%B5%D8%A7%D8%B1-%D8%B9%D9%83%D8%B3%D9%8A","20260607230121"],[54,"%d9%86%d9%87%d8%a7%d9%8a%d8%a9-%d9%85%d8%ac%d9%85%d9%88%d8%b9%d8%a9",""],[55,"%D8%B1%D8%A4%D9%88%D8%B3","20260610184628"],[56,"%d9%86%d8%ad%d9%88-%d8%a7%d9%84%d8%a8%d9%88%d8%a7%d8%a8%d8%a9",""],[57,"%D8%B9%D9%90%D8%AF%D8%A7%D8%A1","20250405154133"],[58,"%D8%AA%D8%AD%D9%82%D9%8A%D9%82","20260608000041"],[59,"%D8%AA%D9%81%D8%B3%D9%8A%D8%B1","20260607224758"],[60,"%D9%85%D8%B3%D8%AC%D9%88%D9%86%D8%9F","20260606020742"],[61,"%D9%85%D9%86-%D8%A7%D8%AC%D9%84-%D8%B9%D8%A8%D8%AF%D8%9F","20260610191646"],[62,"%d8%ae%d8%b7%d8%a9",""],[63,"%d8%a5%d9%82%d8%aa%d9%8a%d8%a7%d8%af",""],[64,"%D9%85%D9%88%D8%B1%D9%81%D9%8A","20260610190615"],[65,"%D8%AA%D8%B9%D8%B2%D9%8A%D8%B2%D8%A7%D8%AA","20260612043354"],[66,"%D9%82%D8%B1%D9%8A%D8%A8%D9%8A-%D8%A7%D9%84%D9%88%D8%AD%D9%8A%D8%AF","20260607224824"],[67,"%D8%AA%D9%82%D8%B1%D9%8A%D8%B1","20260610175010"],[68,"%D9%88-%D9%85%D8%A7%D8%B0%D8%A7-%D8%A5%D9%86-%D9%83%D8%A7%D9%86-%D8%AF%D9%88%D9%82%D8%9F","20260610185216"],[69,"%D8%AA%D9%81%D8%A7%D9%88%D8%B6","20260612054049"],[70,"%D8%A7%D8%AA%D9%81%D8%A7%D9%82","20260606020807"],[71,"%D9%8A%D9%88%D9%85-%D8%A7%D9%84%D8%AA%D8%AD%D8%B1%D9%83","20260612043224"],[72,"%d8%aa%d9%82%d8%b1%d9%8a%d8%b1",""],[73,"%d9%85%d8%b9%d8%b1%d9%83%d8%a9",""],[74,"%D8%B5%D9%8A%D8%AD%D8%A9-%D9%8A%D8%A7%D8%A6%D8%B3%D8%A9","20260607230925"],[75,"%D8%A5%D9%85%D8%AF%D8%A7%D8%AF%D8%A7%D8%AA","20260610180838"],[76,"%D8%AA%D8%AC%D9%87%D9%8A%D8%B2","20260610183441"],[77,"%d8%a7%d9%84%d9%86%d8%b8%d8%b1-%d8%aa%d8%ad%d8%aa-%d8%a7%d9%84%d8%a7%d9%82%d8%af%d8%a7%d9%85",""],[78,"%D8%AA%D8%B6%D8%AD%D9%8A%D8%A9","20260606022142"],[79,"%D9%85%D8%BA%D8%AA%D8%A7%D9%84","20260612050452"],[80,"%d8%a7%d8%b3%d9%85-%d9%85%d9%86-%d8%a7%d9%84%d9%85%d8%a7%d8%b6%d9%8a",""],[81,"%D8%B1%D9%82%D8%B9%D8%A9-%D8%A7%D9%84%D9%85%D8%B9%D8%B1%D9%83%D8%A9","20260612043426"],[82,"%D9%83%D8%B4-%D9%85%D9%84%D9%83","20260612050532"],[83,"%D8%AA%D9%82%D8%B1%D9%8A%D8%B1","20250405235023"],[84,"%d9%85%d8%a7%d8%b0%d8%a7-%d9%86%d9%81%d8%b9%d9%84%d8%9f",""],[85,"%D8%B9%D8%AF%D9%85-%D8%A5%D8%B9%D8%AA%D8%AF%D8%A7%D8%A1","20260607224946"],[86,"%D8%B9%D9%88%D8%AF%D8%A9","20260606013453"],[87,"%D9%83%D9%86%D8%AA-%D8%AA%D9%82%D9%88%D9%84%D8%9F","20260610185458"],[88,"%D8%AA%D9%81%D8%A7%D9%88%D8%B6-%D9%85%D8%B9-%D8%A7%D9%84%D8%AF%D9%88%D9%82","20260606011738"],[89,"%d8%b1%d8%ad%d9%84%d8%a9-%d9%84%d9%84%d8%b9%d8%a7%d8%b5%d9%85%d8%a9",""],[90,"%D9%84%D9%82%D8%A7%D8%A1-%D9%85%D8%B9-%D8%AD%D9%83%D9%8A%D9%85","20260607231220"],[91,"%D8%B4%D8%B1%D9%88%D8%B7","20260606020718"],[92,"%D8%A7%D9%8A%D9%86-%D9%81%D8%B1%D8%A7%D8%AE%D9%8A%D8%9F","20260606012553"],[93,"%d9%85%d9%81%d8%aa%d8%a7%d8%ad",""],[94,"%D8%A7%D8%AA%D9%81%D8%A7%D9%82-%D9%85%D8%A7%D8%A6%D8%B9","20260610184310"],[95,"%D8%A5%D9%84%D9%89-%D8%A7%D9%84%D9%85%D9%86%D8%B2%D9%84","20260612042427"],[96,"%D8%AA%D9%86%D9%81%D9%8A%D8%B0-%D8%A7%D9%84%D9%88%D8%B9%D8%AF","20260606020631"],[97,"%D9%86%D9%82%D9%88%D8%AF%D8%9F-%D9%84%D8%A7-%D9%85%D8%B4%D9%83%D9%84%D8%A9","20260610180506"],[98,"%d8%a5%d8%b9%d8%af%d8%a7%d9%85",""],[99,"%d8%b2%d9%8a%d8%a7%d8%b1%d8%a9-%d9%85%d9%81%d8%a7%d8%ac%d8%a6%d8%a9",""],[100,"%d9%85%d8%a7%d8%b0%d8%a7-%d9%84%d8%af%d9%8a%d9%83%d9%85-%d8%a7%d9%8a%d8%b6%d8%a7%d9%8b%d8%9f",""],[101,"%D8%A7%D9%84%D8%A5%D8%AC%D8%A7%D8%A8%D8%A9-%D9%85%D9%8A%D9%84%D8%A7","20250406010345"],[102,"%D8%AA%D8%AA%D8%B2%D9%88%D8%AC-%D9%85%D9%86%D8%9F","20250327211152"],[103,"%D8%A7%D8%AE%D8%A8%D8%A7%D8%B1","20260612052911"],[104,"3-%D8%AC%D8%A8%D9%87%D8%A7%D8%AA","20260610182919"],[105,"%D8%A7%D9%84%D8%A7%D9%88%D9%84%D8%A7%D8%AF-%D8%A7%D9%84%D8%AB%D9%84%D8%A7%D8%AB%D8%A9-%D8%A8%D8%AE%D9%8A%D8%B1%D8%9F","20260612051420"],[106,"%D9%84%D9%86-%D8%A3%D8%B1%D8%B3%D9%84%D9%87%D9%85","20260612051452"],[107,"%D9%84%D9%85%D8%A7%D8%B0%D8%A7-%D8%A7%D9%84%D9%82%D8%AA%D9%84","20260610182459"],[108,"%D9%85%D8%B5%D8%A7%D9%86%D8%B9%D8%9F","20260606011617"],[109,"%D8%AA%D8%B9%D8%A7%D9%84%D9%8A-%D9%86%D8%AA%D8%A3%D9%85%D9%84","20260610190941"],[110,"%D8%A8%D8%AF%D8%A3-%D8%A7%D9%84%D8%B3%D8%A8%D8%A7%D9%82-%D8%B6%D8%AF-%D8%A7%D9%84%D8%B2%D9%85%D9%86","20260612051712"],[111,"%D9%86%D9%85%D8%B7-%D8%AA%D9%88%D9%84%D9%8A%D8%AF-%D8%A7%D9%84%D8%AD%D8%B1%D8%A7%D8%B1%D8%A9","20260606010635"],[112,"%D8%AE%D8%AA%D9%85-%D8%AA%D9%88%D9%84%D9%8A%D8%AF-%D8%A7%D9%84%D8%B7%D8%A7%D9%82%D8%A9","20260612045059"],[113,"%D9%85%D8%A8%D8%B9%D9%88%D8%AB","20260610180609"],[114,"%d8%a3%d9%87%d9%83%d8%b0%d8%a7-%d8%aa%d8%b9%d8%a7%d9%85%d9%84%d9%88%d9%86-%d8%a7%d8%b5%d8%af%d9%82%d8%a7%d8%a6%d9%83%d9%85%d8%9f",""],[115,"%D8%AA%D8%B9%D9%88%D9%8A%D8%B6","20260606014148"],[116,"%D8%A7%D9%84%D8%AE%D8%B7%D9%88%D8%A9-%D8%A7%D9%84%D8%A7%D8%AE%D9%8A%D8%B1%D8%A9","20260612052626"],[117,"%D9%86%D9%87%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%B3%D8%A8%D8%A7%D9%82","20260610190734"],[118,"%d9%84%d9%88%d8%ad-%d8%a7%d9%84%d9%82%d8%b3%d9%85",""],[119,"%D9%84%D9%82%D8%A7%D8%A1-%D9%85%D8%B9-%D9%85%D8%B1%D8%B4%D8%AD%D9%8A-%D8%A7%D9%84%D8%B1%D9%88%D8%AD-1","20260610183022"],[120,"%D9%84%D9%82%D8%A7%D8%A1-%D9%85%D8%B9-%D9%85%D8%B1%D8%B4%D8%AD%D9%8A-%D8%A7%D9%84%D8%B1%D9%88%D8%AD-2","20260606021607"],[121,"%D9%84%D9%82%D8%A7%D8%A1-%D9%85%D8%B9-%D9%85%D8%B1%D8%B4%D8%AD%D9%8A-%D8%A7%D9%84%D8%B1%D9%88%D8%AD-3","20260606021145"],[122,"%D8%A7%D8%B3%D9%8A%D8%A7%D8%AF-%D8%A7%D9%84%D9%86%D9%82%D9%88%D8%B4","20260610175727"],[123,"%D8%A7%D9%86%D9%81%D8%AC%D8%A7%D8%B1-%D8%B5%D8%BA%D9%8A%D8%B1","20260612051647"],[124,"%D8%A7%D9%84%D9%85%D8%AD%D8%A7%D8%B6%D8%B1%D8%A9-%D8%A7%D9%84%D8%A7%D9%88%D9%84%D9%89","20260610191241"],[125,"%d8%a7%d9%84%d9%8a%d9%88%d9%85-%d8%a7%d9%84%d9%85%d9%88%d8%b9%d9%88%d8%af",""],[126,"%D8%B9%D8%A7%D9%82%D8%A8%D8%A9","20260607225752"],[127,"%D8%B3%D9%84%D8%A7%D8%AD-%D9%85%D8%AA%D9%88%D8%B3%D8%B7-%D8%A7%D9%84%D9%85%D8%A7%D8%B0%D8%A7%D8%9F","20260610185949"],[128,"%D9%88-%D8%A7%D9%84%D9%85%D8%B7%D9%84%D9%88%D8%A8%D8%9F","20260610190708"],[129,"%D9%81%D8%B1%D8%A7%D8%B1","20260612044623"],[130,"%D8%A7%D9%84%D9%85%D9%84%D9%88%D9%83-%D8%A7%D9%84%D8%AB%D9%84%D8%A7%D8%AB","20260606014246"],[131,"%d9%85%d8%a4%d8%a7%d9%85%d8%b1%d8%a9",""],[132,"%D8%B2%D9%8A%D8%A7%D8%B1%D8%A9-%D8%B9%D8%A7%D9%84%D9%8A%D8%A9-%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D9%88%D9%89","20260610181300"],[133,"%D8%AE%D9%8A%D8%A7%D8%B1-%D9%84%D9%83%D9%86-%D8%A5%D8%AC%D8%A8%D8%A7%D8%B1%D9%8A","20260610185715"],[134,"%d8%a7%d9%84%d9%81%d8%b1%d9%88%d8%b3%d9%8a%d8%a9",""],[135,"%D8%B4%D9%83%D8%B1%D8%A7%D9%8B-%D9%84%D9%83%D8%9F","20260612053621"],[136,"%D8%AF%D9%88%D9%82%D9%8A%D8%A9-%D8%A2%D9%8A%D9%81%D8%B1%D9%8A%D9%86","20260610184850"],[137,"%D8%B6%D9%8A%D9%88%D9%81","20260610182339"],[138,"%D8%AC%D9%88%D8%B9","20260606012418"],[139,"%D8%A7%D8%B1%D9%8A%D8%AF-%D8%AE%D8%AF%D9%85%D8%A9-%D8%A7%D9%84%D9%85%D9%85%D9%84%D9%83%D8%A9","20260612054728"],[140,"%D8%A7%D9%84%D8%AB%D9%85%D9%86","20260612050817"],[141,"%D8%A7%D8%AA%D9%81%D8%A7%D9%82","20260606021849"],[142,"%D9%87%D8%B1%D9%85","20260610191508"],[143,"%d9%85%d8%b4%d8%b1%d9%88%d8%b9-%d8%aa%d9%82%d9%86%d9%8a%d8%a9-1",""],[144,"%d9%85%d8%b4%d8%b1%d9%88%d8%b9-%d8%aa%d9%82%d9%86%d9%8a%d8%a9-2",""],[145,"%D9%84%D9%8A%D9%84%D8%A9-%D8%AF%D8%A7%D9%85%D9%8A%D8%A9","20260607231151"],[146,"%D9%82%D9%80-%D9%82%D9%80","20260610191355"],[147,"%D8%A7%D9%84%D8%AF%D8%B1%D8%AC%D8%A9-%D8%A7%D9%84%D8%B1%D8%A7%D8%A8%D8%B9%D8%A9%D8%9F","20260612044946"],[148,"%d9%81%d8%b1%d9%82-%d8%ae%d8%a7%d8%b5%d8%a9",""],[150,"%D8%AA%D9%86%D8%B3%D9%8A%D9%82","20260606021630"],[151,"%D8%A7%D9%84%D9%84%D8%B9%D8%A8-%D9%85%D8%B9-%D8%A7%D9%84%D9%83%D8%A8%D8%A7%D8%B1","20260610175653"],[152,"%D8%AD%D9%84","20260606012331"],[153,"%D8%A7%D9%84%D9%82%D9%88%D8%A7%D9%86%D9%8A%D9%86-%D8%A7%D9%84%D8%AE%D9%85%D8%B3%D8%A9","20260606021416"],[154,"%D8%AA%D8%B9%D8%AF%D9%8A%D9%84-%D8%A7%D9%84%D8%A7%D8%B3%D8%A7%D8%B3","20260607223448"],[155,"%D9%85%D8%B1%D8%AD%D8%A8%D8%A7%D9%8B-%D9%85%D8%AC%D8%AF%D8%AF%D8%A7%D9%8B","20260612053151"],[156,"%D9%83%D9%88%D9%83%D8%A8-%D9%86%D9%8A%D9%87%D8%A7%D8%B1%D9%8A","20260612050328"],[157,"%D9%85%D9%87%D9%85%D8%A9-%D9%85%D8%B3%D8%AA%D8%AD%D9%8A%D9%84%D8%A9","20260607231413"],[158,"%D8%A5%D9%86-%D9%84%D9%85-%D9%8A%D9%83%D8%AA%D9%81%D9%8A-%D8%A8%D9%85%D8%B1%D8%A9","20260606014455"],[159,"%D8%A5%D9%86%D8%AA%D8%A7%D8%AC-%D9%83%D9%85%D9%8A","20260612050254"],[160,"%D8%B9%D9%84%D8%A7%D8%AC","20260607225441"],[161,"%D9%8A%D9%85%D9%83%D9%86%D9%86%D9%8A-%D8%AA%D8%BA%D9%8A%D9%8A%D8%B1%D9%83","20260612045705"],[162,"%D8%A2%D9%86-%D8%A7%D9%84%D8%A2%D9%88%D8%A7%D9%86","20260612045915"],[163,"%D9%86%D8%AD%D9%88-%D8%A5%D9%8A%D9%81%D8%B1%D9%8A%D9%86-1","20260612045513"],[164,"%D9%86%D8%AD%D9%88-%D8%A7%D9%8A%D9%81%D8%B1%D9%8A%D9%86-2","20260607235954"],[165,"%D8%A8%D8%AF%D8%A3-%D8%A7%D9%84%D8%B9%D8%B1%D8%B6","20260607231031"],[166,"%d8%b4%d8%b1%d8%a7%d8%b1%d8%a9-%d8%a7%d9%84%d8%a8%d8%af%d8%a3",""],[167,"%D8%A7%D8%B1%D9%8A%D8%AF-%D9%85%D9%81%D8%A7%D9%88%D8%B6%D8%A7%D8%AA","20260606014535"],[168,"%d9%81%d9%87%d9%85%d8%aa",""],[169,"%d9%86%d9%87%d8%a7%d9%8a%d8%a9-%d8%ad%d9%8f%d9%84%d9%85",""],[170,"%d8%a7%d9%84%d8%b2%d8%ad%d9%81",""],[171,"%D9%85%D9%83%D8%A7%D9%84%D9%85%D8%A9-%D8%B9%D8%A7%D8%AC%D9%84%D8%A9","20260612051252"],[172,"%D8%AA%D8%BA%D9%8A%D9%8A%D8%B1-%D8%A5%D8%AA%D8%AC%D8%A7%D9%87","20260606021056"],[173,"%D9%84%D9%87%D8%A8-%D8%B9%D9%84%D9%89-%D9%85%D8%AF-%D8%A7%D9%84%D8%A8%D8%B5%D8%B1","20260610185313"],[174,"%D9%85%D8%B3%D8%A7%D9%81%D8%A7%D8%AA","20260612050027"],[175,"%D8%A7%D9%84%D9%82%D9%88%D8%A7%D8%AA-%D8%A7%D9%84%D8%AE%D8%A7%D8%B5%D8%A9-%D8%AA%D8%AA%D8%AD%D8%B1%D9%83","20260606012214"],[176,"%d9%81%d8%ac%d9%88%d8%a9",""],[177,"%D8%AA%D8%B6%D8%AD%D9%8A%D8%A9","20260612052422"],[178,"%D9%83%D8%B3%D8%B1","20260606012503"],[179,"%d8%aa%d8%b6%d8%ad%d9%8a%d8%a9",""],[180,"%d8%aa%d8%a3%d9%85%d9%8a%d9%86-%d8%a7%d9%84%d8%b8%d9%87%d8%b1",""],[181,"%d8%b3%d9%82%d9%88%d8%b7-%d9%85%d8%af%d9%88%d9%8a",""],[182,"%d8%aa%d8%b7%d9%88%d8%b1-%d8%ba%d9%8a%d8%b1-%d9%85%d8%aa%d9%88%d9%82%d8%b9",""],[183,"%d9%84%d9%88-%d9%83%d9%86%d8%aa-%d9%85%d9%87%d8%aa%d9%85",""],[184,"%d9%85%d9%8a%d9%84%d8%a7-26",""],[185,"%d8%b9%d8%b6%d9%88-%d8%ac%d8%af%d9%8a%d8%af",""],[186,"%d8%ba%d8%b2%d9%88",""],[187,"%d9%87%d8%ac%d9%88%d9%85-%d9%85%d9%86%d8%b8%d9%85",""],[188,"%d8%ad%d8%b3%d9%85-%d8%ac%d8%a8%d9%87%d8%aa%d8%a7%d9%86",""],[189,"%d9%81%d9%88%d8%b6%d9%89",""],[190,"%d9%83%d9%84%d9%85%d8%a9-%d9%88%d8%a7%d8%ad%d8%af%d8%a9",""],[191,"%d9%85%d9%81%d8%a7%d9%88%d8%b6%d8%a7%d8%aa-%d9%82%d8%a7%d8%b3%d9%8a",""],[192,"%d8%aa%d8%ba%d9%8a%d8%b1-%d8%a7%d9%84%d9%84%d9%87%d8%ac%d8%a9",""],[193,"%d9%85%d8%aa%d8%b7%d9%84%d8%a8%d8%a7%d8%aa",""],[194,"%d8%aa%d8%a3%d9%85%d9%8a%d9%86-%d8%a7%d9%84%d9%85%d9%88%d8%a7%d8%b1%d8%af",""],[195,"%d8%ae%d8%a8%d8%b1-%d8%b3%d8%b9%d9%8a%d8%af",""],[196,"%d8%af%d9%85%d8%a7%d8%b1%d8%9f",""],[197,"%d9%85%d8%b4%d8%b1%d9%88%d8%b9-%d8%b9%d9%85%d9%84%d8%a7%d9%82",""],[198,"%d9%83%d9%81-%d8%ab%d9%84%d8%a7%d8%ab%d9%8a-%d8%a7%d9%84%d9%85%d8%ae%d8%a7%d9%84%d8%a8",""],[199,"%d9%87%d9%84-%d8%a7%d9%81%d8%b9%d9%84%d9%87%d8%a7-%d8%9f",""],[200,"%d8%a7%d8%b9%d8%a7%d8%af%d8%a9-%d8%a7%d9%84%d8%a7%d9%81%d8%aa%d8%aa%d8%a7%d8%ad",""],[201,"%d8%a7%d9%86%d8%aa%d8%a8%d8%a7%d9%87-%d8%ba%d9%8a%d8%b1-%d9%85%d8%b1%d8%ba%d9%88%d8%a8",""],[202,"%d8%b1%d8%af-%d8%b9%d9%86%d9%8a%d9%81",""],[203,"%d9%82%d8%a7%d9%86%d9%88%d9%86-%d8%a7%d9%84%d8%b3%d8%b9%d9%8a%d8%b1-%d8%a7%d9%84%d8%ab%d8%a7%d9%86%d9%88%d9%8a",""],[204,"%d8%a7%d8%b9%d9%84%d8%a7%d9%86",""],[205,"%d8%a7%d9%84%d8%b3%d9%84%d9%81-%d9%86%d9%88%d8%ad",""],[206,"%d9%84%d9%8a%d9%84%d8%a9-%d8%a7%d9%84%d8%a7%d8%b1%d9%82%d8%a7%d9%85-%d8%a7%d9%84%d9%82%d9%8a%d8%a7%d8%b3%d9%8a%d8%a9",""],[207,"%d8%ad%d9%84%d9%85-%d8%a7%d9%84%d8%a7%d8%ac%d8%a7%d8%b2%d8%a9",""],[208,"%d8%a8%d8%af%d8%a7%d9%8a%d8%a9-%d8%a7%d9%84%d8%b9%d9%85%d9%84-%d8%b9%d9%84%d9%89-%d8%a7%d9%84%d8%a8%d9%88%d8%a7%d8%a8%d8%a9",""],[209,"%d8%a8%d8%b3%d8%a8%d8%a8-%d8%a5%d9%85%d8%b1%d8%a3%d8%a9%d8%9f",""],[210,"%d9%84%d9%82%d8%a7%d8%a1-%d9%85%d9%86-%d8%ac%d8%af%d9%8a%d8%af",""],[211,"%d8%ad%d9%83%d8%a7%d9%8a%d8%aa%d9%8a",""],[212,"%d8%aa%d8%ad%d8%af%d9%8a%d8%af-%d8%a7%d9%84%d9%85%d9%88%d8%b9%d8%af",""],[213,"%d9%8a%d9%88%d9%85-%d8%a7%d9%84%d9%85%d9%87%d8%b1%d8%ac%d8%a7%d9%86",""],[214,"%d8%a7%d9%84%d8%ac%d9%84%d8%b3%d8%a9-%d8%a7%d9%84%d8%a7%d8%ae%d9%8a%d8%b1%d8%a9",""],[215,"%d8%a7%d8%ae%d8%aa%d8%b5%d8%a7%d8%b5",""],[216,"%d9%84%d9%82%d8%a7%d8%a1-%d8%a7%d9%84%d9%88%d8%af%d8%a7%d8%b9",""],[217,"%d9%87%d8%af%d8%a7%d9%8a%d8%a7",""],[218,"%d8%aa%d8%ad%d8%b6%d9%8a%d8%b1%d8%a7%d8%aa",""],[219,"%d9%82%d9%81%d8%b2%d8%a9-%d9%86%d8%ad%d9%88-%d8%a7%d9%84%d9%85%d8%ac%d9%87%d9%88%d9%84",""],[220,"%d9%83%d9%88%d9%83%d8%a8-%d9%86%d9%8a%d9%87%d8%a7%d8%b1%d9%8a",""],[221,"%d8%a7%d9%88%d9%84-%d9%85%d9%88%d8%a7%d8%ac%d9%87%d8%a9",""],[222,"%d9%88%d8%ac%d9%87-%d8%ac%d8%af%d9%8a%d8%af",""],[223,"%d8%b9%d9%85%d8%a7%d9%84%d9%82%d8%a9-%d9%86%d9%8a%d9%87%d8%a7%d8%b1%d9%8a",""],[224,"%d9%83%d8%a7%d8%a6%d9%86%d8%a7%d8%aa-%d8%ba%d8%b1%d9%8a%d8%a8%d8%a9",""],[225,"%d8%b6%d8%ad%d9%83%d8%a7%d8%aa%d9%8d-%d9%88-%d8%af%d9%85%d8%a7%d8%a1",""],[226,"%d8%ad%d9%82%d9%8a%d9%82%d8%a9-%d8%a7%d9%84%d9%82%d8%a7%d9%81%d9%84%d8%a9",""],[227,"%d8%b9%d8%b1%d8%b6",""],[228,"%d8%b1%d9%87%d8%a7%d9%86",""],[229,"%d8%b9%d8%a7%d9%84%d9%85-%d8%a7%d9%84%d8%b9%d9%85%d8%a7%d9%84%d9%82%d8%a9",""],[230,"%d8%ad%d8%a7%d9%84%d8%a9-%d8%a7%d9%84%d8%b9%d8%a7%d9%84%d9%85",""],[231,"%d8%a7%d9%84%d8%b9%d9%81%d8%a7%d8%b1%d9%8a%d8%aa",""],[232,"%d8%b5%d8%b1%d8%ae%d8%a9",""],[233,"%d8%aa%d8%ba%d9%8a%d8%b1-%d9%85%d9%81%d8%a7%d8%ac%d8%a6",""],[234,"%d9%86%d8%b8%d8%b1%d8%a9-%d9%85%d9%8f%d8%aa%d8%b7%d9%84%d8%b9%d8%a9",""],[235,"%d9%84%d8%b0%d9%8a%d8%b0",""],[236,"%d8%ae%d8%b7%d8%a9-%d8%b3%d8%b1%d9%8a%d8%b9%d8%a9",""],[237,"%d9%82%d8%b6%d9%85",""],[238,"%d9%85%d8%b7%d8%b9%d9%85%d8%9f",""],[239,"%d9%82%d8%aa%d9%84-%d9%85%d9%83%d8%b1%d9%88%d9%87",""],[240,"%d8%a7%d9%86%d8%a7%d8%9f",""],[241,"%d8%a3%d8%b5%d8%ad%d8%a7%d8%a8-%d8%a7%d9%84%d8%b9%d8%a8%d8%a7%d8%a1%d8%a7%d8%aa-%d8%a7%d9%84%d8%b3%d9%88%d8%af%d8%a7%d8%a1",""],[242,"%d9%85%d8%b7%d8%b1-%d8%b7%d9%84%d8%a7%d8%b3%d9%85",""],[243,"%d8%a7%d8%b1%d8%a8%d8%b9-%d9%81%d8%b1%d8%b3%d8%a7%d9%86",""],[244,"%d8%aa%d8%af%d8%ae%d9%84-%d9%85%d9%81%d8%a7%d8%ac%d8%a6",""],[245,"%d8%b3%d8%a4%d8%a7%d9%84",""],[246,"%d9%88-%d8%a5%d9%84%d8%a7",""],[247,"%d9%85%d8%ae%d8%aa%d8%a7%d8%b1-%d8%a7%d9%84%d8%b3%d9%85%d8%a7%d8%a1-%d8%a7%d9%84%d8%ab%d8%a7%d9%84%d8%ab%d8%9f",""],[248,"%d9%86%d8%b8%d8%a7%d9%85-%d8%b7%d8%a7%d9%82%d8%a9-%d9%86%d9%8a%d9%87%d8%a7%d8%b1%d9%8a",""],[249,"%d9%84%d8%a4%d9%84%d8%a4-%d8%a7%d9%84%d8%b7%d8%a7%d9%82%d8%a9",""],[250,"%d8%b3%d8%a8%d8%a8",""],[251,"%d8%b9%d8%b1%d8%b6",""],[252,"%d8%ac%d9%85%d8%a7%d8%b9%d8%a9-%d8%b3%d9%84%d9%85%d9%86%d8%af%d8%b1-%d8%a7%d9%84%d9%86%d8%a7%d8%b1",""],[253,"%d8%a7%d9%84%d8%af%d8%b1%d8%a7%d9%83%d9%88",""],[254,"%d8%a7%d9%84%d9%85%d8%b3%d8%aa%d8%b9%d9%85%d8%b1%d8%a9-%d8%a7%d9%84%d8%a8%d8%b4%d8%b1%d9%8a%d8%a9-53",""],[255,"%d8%a7%d9%84%d8%b2%d8%b9%d9%8a%d9%85-%d8%a7%d9%88%d8%b1%d8%b2%d9%88%d9%86",""],[256,"%d8%aa%d8%ba%d9%8a%d9%8a%d8%b1-%d9%85%d9%81%d8%a7%d8%ac%d8%a6",""],[257,"%d9%85%d8%a7-%d8%ae%d9%81%d9%8a",""],[258,"%d9%85%d8%ae%d8%aa%d8%a7%d8%b1-%d8%a7%d9%84%d8%b3%d9%85%d8%a7%d8%a1-%d8%a7%d9%84%d8%a7%d9%88%d9%84",""],[259,"%d9%85%d8%ae%d8%aa%d8%a7%d8%b1-%d8%a7%d9%84%d8%b3%d9%85%d8%a7%d8%a1-%d8%a7%d9%84%d8%a7%d9%88%d9%84-2",""],[260,"%d9%85%d8%a7-%d8%a8%d8%b9%d8%af-%d8%a7%d9%84%d9%85%d8%ae%d8%aa%d8%a7%d8%b1-%d8%a7%d9%84%d8%a7%d9%88%d9%84",""],[261,"%d9%85%d8%ae%d8%aa%d8%a7%d8%b1-%d8%a7%d9%84%d8%b3%d9%85%d8%a7%d8%a1-%d8%a7%d9%84%d8%ab%d8%a7%d9%86%d9%8a",""],[262,"%d9%86%d9%87%d8%a7%d9%8a%d8%a9-%d9%85%d8%ae%d8%aa%d8%a7%d8%b1-%d8%a7%d9%84%d8%b3%d9%85%d8%a7%d8%a1-%d8%a7%d9%84%d8%ab%d8%a7%d9%86%d9%8a",""],[263,"%d8%a8%d8%af%d8%a7%d9%8a%d8%a9-%d8%a7%d9%84%d8%ac%d9%85%d8%a7%d8%b9%d8%a7%d8%aa-%d8%a7%d9%84%d9%85%d8%b3%d9%84%d8%ad%d8%a9",""],[264,"%d8%a5%d8%b9%d8%af%d8%a7%d8%af",""],[265,"%d9%84%d9%88%d8%ad-%d8%a7%d9%84%d9%82%d8%b3%d9%85",""],[266,"%d8%a7%d8%b9%d8%aa%d8%b1%d8%a7%d9%81",""],[267,"%d9%85%d9%85%d9%84%d9%83%d8%a9%d8%9f",""],[268,"%d8%b5%d8%ad%d8%b1%d8%a7%d8%a1-%d8%a7%d9%84%d9%85%d9%88%d8%aa",""],[269,"%d8%a8%d8%af%d8%a3-%d8%a7%d9%84%d8%b9%d9%85%d9%84",""],[270,"%d8%a2%d9%85%d9%88%d9%86",""],[271,"%d8%a7%d9%84%d9%87%d8%ac%d8%b1%d8%a9",""],[272,"%d8%a7%d9%84%d9%85%d9%84%d9%83",""],[273,"%d8%a7%d9%83%d8%a7%d8%af%d9%8a%d9%85%d9%8a%d8%a9",""],[274,"%d8%b9%d8%a8%d9%82%d8%b1%d9%8a%d8%a9-%d8%a7%d9%84%d9%88%d8%b4%d9%85",""],[275,"%d9%85%d9%8f%d8%b9%d9%84%d9%85%d9%8a",""],[276,"%d8%b5%d9%90%d8%af%d8%a7%d9%85",""],[277,"%d8%a5%d8%a8%d9%86-%d9%85%d9%86%d8%9f",""],[278,"%d8%b3%d8%a3%d8%b5%d8%a8%d8%ad-%d8%ba%d9%86%d9%8a",""],[279,"%d8%a7%d9%84%d8%ad%d8%b1%d8%a8",""],[280,"%d9%84%d9%83%d9%85%d8%a9",""],[281,"%d8%b5%d8%b1%d8%a7%d8%ae",""],[282,"%d9%85%d9%8f%d9%87%d9%84%d8%a9",""],[283,"%d8%a8%d8%a7%d9%84%d8%b7%d8%a8%d8%b9",""],[284,"%d9%85%d9%86%d8%b8%d9%85%d8%a9-%d8%b3%d9%84%d9%85%d9%86%d8%af%d8%b1-%d8%a7%d9%84%d9%86%d8%a7%d8%b1",""],[285,"%d9%85%d9%8f%d8%aa%d8%b9%d8%a8",""],[286,"%d8%aa%d9%82%d8%af%d9%85-%d8%a8%d9%87%d8%af%d9%88%d8%a1",""],[287,"%d8%b9%d8%b4%d8%b1-%d8%b3%d9%86%d9%8a%d9%86",""],[288,"%d9%85%d9%82%d8%a7%d8%a8%d9%84%d8%a9-%d8%ab%d8%a7%d9%86%d8%af%d9%88%d8%b1",""],[289,"%d8%aa%d8%ba%d9%8a%d9%8a%d8%b1-%d9%81%d9%8a-%d8%a7%d8%b1%d8%b6-%d8%a7%d9%84%d8%a8%d8%b1%d9%82",""],[290,"%d8%b9%d8%af%d9%88%d8%a7%d9%86-%d8%ab%d9%86%d8%a7%d8%a6%d9%8a",""],[291,"%d8%a3%d9%85%d9%8a",""],[292,"%d8%ae%d9%84%d9%81-%d8%a7%d8%b3%d9%88%d8%a7%d8%b1-%d9%8a%d9%88%d8%b1%d8%a7",""],[293,"%d8%a7%d9%86%d8%aa%d9%82%d8%a7%d9%85-%d8%a7%d9%84%d8%a7%d8%ac%d9%86%d8%a7%d8%b3-%d8%a7%d9%84%d9%85%d8%aa%d8%af%d9%86%d9%8a%d8%a9",""],[294,"%d8%ae%d9%85%d8%b3-%d8%b3%d9%86%d9%88%d8%a7%d8%aa",""],[295,"%d8%aa%d8%b7%d9%88%d8%b1-%d8%b3%d8%b1%d9%8a%d8%b9",""],[296,"%d9%85%d8%af%d9%8a%d9%86%d8%a9-%d8%a7%d9%84%d8%a3%d9%85%d9%84",""],[297,"%d9%85%d8%b3%d8%aa%d8%ac%d8%af%d8%a7%d8%aa",""],[298,"%d8%a7%d8%ae%d8%a8%d8%a7%d8%b1-%d9%85%d9%86-%d8%a7%d9%84%d8%b4%d9%85%d8%a7%d9%84",""],[299,"%d8%a5%d9%84%d9%89-%d9%82%d8%a8%d9%8a%d9%84%d8%a9-%d8%b9%d8%b2%d9%8a%d9%84",""],[300,"%d8%b5%d8%af%d9%85%d8%a9",""],[301,"%d9%85%d8%b5%d9%8a%d8%b1",""],[302,"%d9%83%d8%a7%d8%b1%d8%ab%d8%a9",""],[303,"%d8%ae%d8%b7%d9%88%d8%a9",""],[304,"%d8%b7%d8%b9%d9%86%d8%a9",""],[305,"%d9%84%d9%83%d9%85%d8%a9",""],[306,"%d8%a5%d8%b9%d9%84%d8%a7%d9%86",""],[307,"%d9%85%d8%b0%d8%a8%d8%ad%d8%a9-%d9%8a%d9%88%d8%b1%d8%a7",""],[309,"%d8%ad%d8%b5%d8%a7%d8%b1-%d9%81%d9%88%d9%82-%d8%a7%d9%84%d8%aa%d9%84",""],[310,"%d9%85%d9%84%d9%83-%d8%a7%d9%84%d8%b9%d9%81%d8%a7%d8%b1%d9%8a%d8%aa-%d8%b3%d8%a7%d9%83%d8%a7%d8%b1",""],[311,"%d8%b1%d8%b9%d8%a8",""],[312,"%d9%84%d9%82%d8%a7%d8%a1-%d9%85%d8%b9-%d8%b5%d8%af%d9%8a%d9%82-%d9%82%d8%af%d9%8a%d9%85",""],[313,"%d8%a7%d9%84%d8%a7%d9%85%d8%a8%d8%b1%d8%a7%d8%b7%d9%88%d8%b1%d9%8a%d8%a7%d8%aa-%d8%a7%d9%84%d8%a7%d8%b1%d8%a8%d8%b9%d8%a9",""],[314,"%d8%b4%d9%88%d8%a7%d8%b1%d8%b9-%d9%8a%d9%88%d8%b1%d8%a7",""],[315,"%d8%a7%d9%86%d8%aa%d9%85-%d8%ac%d8%a7%d8%a6%d8%b9%d9%88%d9%86%d8%9f",""],[316,"%d8%a7%d9%8a-%d8%b9%d8%a7%d9%84%d9%85%d8%9f",""],[317,"%d8%a7%d9%84%d8%b1%d9%85%d8%ad-%d8%a7%d9%84%d8%a7%d8%b3%d9%88%d8%af",""],[318,"%d8%ae%d9%8a%d8%a7%d8%b1%d9%8a%d9%86",""],[319,"%d8%a5%d8%a8%d8%a7%d8%af%d8%a9-%d8%ac%d9%85%d8%a7%d8%b9%d9%8a%d8%a9%d8%9f",""],[320,"%d8%b1%d8%ad%d9%84%d8%a9",""],[321,"%d8%ba%d9%8a%d9%85%d8%a9-%d9%82%d8%a7%d8%af%d9%85%d8%a9-%d9%85%d9%86-%d8%a7%d9%84%d9%85%d8%ad%d9%8a%d8%b7",""],[322,"%d9%86%d8%b4%d8%b1",""],[323,"%d9%81%d9%8a-%d8%a7%d9%84%d9%88%d8%a7%d8%af%d9%8a",""],[324,"%d8%ba%d8%b7%d8%b1%d8%b3%d8%a9-%d9%81%d9%8a-%d9%85%d8%ad%d9%84%d9%87%d8%a7",""],[325,"%d8%a3%d8%b1%d9%8a%d8%af-%d8%a7%d9%84%d8%aa%d8%a8%d8%a7%d8%af%d9%84",""],[326,"%d8%ae%d8%b7%d8%a9-%d9%85%d8%b6%d8%a7%d8%af%d8%a9",""],[327,"%d9%88%d8%b5%d9%84",""],[328,"%d8%b9%d9%85%d9%84%d8%a7%d9%82-%d8%a7%d9%84%d9%84%d9%87%d8%a8-%d8%a7%d9%84%d8%a7%d8%a8%d9%8a%d8%b6",""],[329,"%d8%a3%d8%a8%d9%8a",""],[330,"%d9%86%d8%b5%d9%81-%d8%b3%d8%a7%d8%b9%d8%a9",""],[331,"%d9%8a%d8%b3%d8%a7%d8%b1",""],[332,"%d8%aa%d8%b9%d8%b2%d9%8a%d8%b2%d8%a7%d8%aa",""],[333,"%d9%85%d8%a7-%d8%a8%d8%b9%d8%af-%d8%a7%d9%84%d9%85%d8%b0%d8%a8%d8%ad%d8%a9",""],[334,"%d8%a5%d9%84%d9%89-%d8%a7%d9%8a%d9%86%d8%9f",""],[335,"%d8%a7%d8%b9%d9%84%d8%a7%d9%86",""],[336,"%d8%a7%d9%84%d8%b4%d8%a7%d8%b7%d8%a6-%d8%a7%d9%84%d9%85%d9%85%d9%84",""],[337,"%d8%a7%d9%82%d8%aa%d9%84%d9%86%d9%8a-%d8%a7%d9%88%d9%84%d8%a7%d9%8b",""],[338,"%d8%a5%d8%b3%d8%aa%d9%8a%d9%82%d8%b8",""],[339,"%d8%a3%d8%ad%d8%b3%d8%af%d9%83",""],[340,"%d9%82%d8%b1%d8%a7%d8%b1",""],[341,"%d8%a7%d9%84%d9%85%d8%af%d9%8a%d9%86%d8%a9-%d8%a7%d9%84%d9%85%d9%86%d9%83%d9%88%d8%a8%d8%a9",""],[342,"%d8%b3%d8%a7%d8%ad%d8%a9-%d9%81%d8%a7%d8%b1%d8%ba%d8%a9",""],[343,"%d8%ac%d9%88-%d8%ae%d8%a7%d9%86%d9%82",""],[344,"%d9%85%d9%86-%d8%a7%d9%86%d8%a7",""],[345,"%d8%a5%d9%84%d9%89-%d8%a7%d9%8a%d9%86-%d8%aa%d8%b8%d9%86-%d8%a3%d9%86%d9%83-%d8%b0%d8%a7%d9%87%d8%a8%d8%9f",""],[346,"%d8%b9%d8%a8%d9%8a%d8%af%d9%8c-%d9%88%d9%83%d9%84%d8%a7%d8%a8",""],[347,"%d8%ba%d8%a7%d8%b6%d8%a8%d8%9f",""],[348,"%d8%a3%d9%81%d8%b6%d9%84%d9%8a%d8%a9-%d8%a7%d9%84%d8%a3%d8%b1%d8%b6",""],[349,"%d8%ae%d8%b1%d9%8a%d8%b7%d8%a9-%d8%a7%d9%84%d8%b7%d8%b1%d9%8a%d9%82",""],[350,"%d9%86%d9%88-%d8%b4%d9%90%d8%aa",""],[351,"%d9%8a%d9%84%d8%a7-%d9%8a%d8%a7-%d8%b1%d8%ac%d8%a7%d9%84%d8%a9",""],[352,"%d8%b1%d9%81%d8%b9-%d8%a7%d9%84%d8%a3%d8%b5%d9%88%d8%a7%d8%aa-%d9%88%d8%a7%d9%84%d8%a3%d9%8a%d8%a7%d8%af%d9%8a",""],[353,"%d8%b9%d8%b1%d8%b4%d9%8a",""],[354,"%d8%b3%d8%a3%d8%b5%d8%ad%d8%ad-%d8%ae%d8%b7%d8%a6%d9%8a-%d8%a8%d9%8a%d8%af%d9%8a",""],[355,"%d8%af%d8%ac%d8%a7%d8%ac%d8%a9",""],[356,"%d9%83%d9%84%d8%a8",""],[357,"%d8%b7%d8%b9%d9%86%d8%a9",""],[358,"%d9%85%d8%b7%d8%b9%d9%85-%d8%af%d8%a7%d9%85%d9%8d",""],[359,"%d8%b5%d9%88%d8%aa-%d9%85%d8%a3%d9%84%d9%88%d9%81",""],[360,"%d9%81%d9%84%d9%86%d8%aa%d9%83%d9%84%d9%85",""],[361,"%d9%85%d9%88%d8%a7%d8%ac%d9%87%d8%a9",""],[362,"%d9%85%d9%88%d8%a7%d8%ac%d9%87%d8%a9-2",""],[363,"%d9%84%d8%a7-%d8%a7%d8%ad%d8%af-%d9%84%d9%8a%d9%8f%d9%84%d8%a7%d9%85",""],[364,"%d8%b4%d8%a6-%d9%88%d8%a7%d8%ad%d8%af",""],[365,"%d8%ab%d9%84%d8%a7%d8%ab%d8%a9-%d8%a7%d9%81%d8%b1%d8%a7%d8%af",""],[366,"%d8%b9%d9%84%d9%89-%d8%a8%d9%8f%d8%b9%d8%af-%d8%ae%d8%b7%d9%88%d8%a9-%d9%85%d9%86-%d8%a7%d9%84%d9%85%d9%88%d8%aa",""],[367,"%d8%a7%d9%84%d9%85%d8%a8%d8%a7%d8%af%d8%b1%d8%a9",""],[368,"17-%d8%a3%d8%b3%d9%85",""],[369,"%d8%b9%d8%a8%d8%af-%d8%a7%d9%88-%d9%85%d9%8a%d8%aa%d8%9f",""],[370,"%d9%83%d9%84%d9%8a-%d8%a2%d8%b0%d8%a7%d9%86-%d8%b5%d8%a7%d8%ba%d9%8a%d8%a9",""],[371,"%d9%85%d9%90%d9%84%d9%83%d9%8a",""],[372,"%d8%a7%d9%84%d8%aa%d9%88%d9%82%d8%b9%d8%a7%d8%aa-%d8%b6%d8%af-%d8%a7%d9%84%d9%88%d8%a7%d9%82%d8%b9",""],[373,"%d8%b9%d9%88%d8%a7%d9%84%d9%85%d8%9f",""],[374,"%d8%b2%d8%b9%d9%8a%d9%85",""],[375,"%d8%a7%d8%ae%d8%aa%d8%b1%d8%a7%d9%82%d8%9f",""],[376,"%d8%a5%d9%84%d9%89-%d8%a7%d9%84%d8%a7%d8%b1%d8%b6",""],[377,"%d8%aa%d9%82%d9%86%d9%8a%d8%a9-%d8%a7%d9%84%d9%81%d8%b1%d9%85%d8%a7%d9%86-%d8%a7%d9%84%d8%a5%d9%84%d9%87%d9%8a",""],[378,"%d8%a7%d9%84%d8%a7%d9%88%d9%84%d8%9f",""],[379,"%d8%b1%d9%8a%d8%a7%d8%ad-%d8%a7%d9%84%d8%aa%d8%ba%d9%8a%d9%8a%d8%b1",""],[380,"%d9%84%d8%a7-%d8%b4%d9%83%d8%b1%d8%a7%d9%8b",""],[381,"%d8%a8%d9%86%d8%af-%d8%ac%d8%af%d9%8a%d8%af",""],[382,"%d8%a5%d8%b0%d9%86",""],[383,"%d8%a7%d9%85%d8%a8%d8%b1%d8%a7%d8%b7%d9%88%d8%b1%d9%8a%d8%a9",""],[384,"%d9%8a%d9%88%d8%b1%d8%a7",""],[385,"%d9%86%d9%87%d8%a7%d9%8a%d8%a9-%d8%a7%d9%84%d8%a7%d8%ac%d8%aa%d9%85%d8%a7%d8%b9",""],[386,"%d8%a3%d9%86%d8%a7-%d8%a5%d9%86%d8%b3%d8%a7%d9%86",""],[387,"%d8%a7%d9%81%d8%b9%d9%84%d9%88%d8%a7-%d9%85%d8%a7-%d8%b9%d9%84%d9%8a%d9%83%d9%85-%d9%81%d8%b9%d9%84%d9%87",""],[388,"%d8%a7%d8%b9%d9%84%d8%a7%d9%86-%d8%a7%d9%84%d8%aa%d9%84-%d8%a7%d9%84%d8%a7%d8%ae%d8%b6%d8%b1-%d8%a7%d9%84%d9%83%d8%a8%d9%8a%d8%b1",""],[389,"%d8%b9%d8%a7%d9%85",""],[390,"%d8%aa%d8%b7%d9%88%d8%b1%d8%a7%d8%aa-%d9%81%d9%8a-%d9%82%d8%a7%d8%b1%d8%a9-%d8%a7%d9%84%d8%b3%d9%84%d9%81",""],[391,"%d8%b9%d8%a7%d9%85%d8%a7%d9%86",""],[392,"%d8%aa%d8%ae%d8%b5%d8%b5",""],[393,"%d8%b3%d9%8a%d9%88%d9%81-%d8%a7%d9%84%d8%b8%d9%84",""],[394,"%d8%b9%d9%8a%d8%af-%d9%85%d9%8a%d9%84%d8%a7%d8%af",""],[395,"%d9%86%d8%b2%d9%88%d8%ad",""],[396,"%d8%aa%d8%ac%d8%a7%d8%b1%d8%a9-%d9%85%d8%b9-%d8%a7%d9%84%d8%a5%d8%ae%d9%88%d8%a9-%d8%a7%d9%84%d8%a3%d8%b9%d8%af%d8%a7%d8%a1",""],[397,"%d8%b2%d9%8a%d8%a7%d8%b1%d8%a9-%d8%ba%d9%8a%d8%b1-%d9%85%d8%b1%d8%ad%d8%a8-%d8%a8%d9%87%d8%a7",""],[398,"%d8%aa%d9%87%d8%af%d9%8a%d8%af-%d8%b3%d9%84%d9%85%d9%8a",""],[399,"%d8%a8%d9%8a%d8%b9-%d8%a7%d9%84%d9%87%d9%88%d8%a7%d8%a1%d8%9f",""],[400,"%d8%a3%d9%8a%d9%86-%d9%87%d9%88%d8%9f",""],[401,"%d8%a7%d9%84%d9%8a%d9%88%d9%85-%d8%a7%d9%84%d9%85%d9%88%d8%b9%d9%88%d8%af",""],[402,"%d9%85%d9%8a%d8%b2%d8%a9-%d9%82%d8%a7%d8%aa%d9%84%d8%a9",""],[403,"%d8%b9%d9%84%d9%8e%d9%85%d8%9f",""],[404,"%d8%b0%d9%8e%d9%87%d8%a8",""],[405,"%d8%a3%d8%b9%d9%88%d8%af-%d9%84%d9%86%d9%8a%d9%87%d8%a7%d8%b1%d9%8a%d8%9f",""],[406,"%d8%a3%d8%ae%d8%b0-%d8%a7%d9%84%d8%ae%d8%b7%d9%88%d8%a9",""],[407,"%d9%85%d8%b7%d8%b1",""],[408,"%d8%ac%d9%86%d9%88%d9%86",""],[409,"%d8%b1%d9%87%d8%a8%d8%a9",""],[410,"%d8%b0%d9%87%d8%a8-%d9%88-%d8%ad%d9%84%d9%8a%d8%a8",""],[411,"%d8%b9%d8%af%d9%88%d9%8c-%d8%b4%d8%b1%d8%b3",""],[412,"%d9%81%d8%ae",""],[413,"%d9%82%d8%a8%d8%a9",""],[414,"%d8%b3%d8%a4%d8%a7%d9%84-%d9%85%d8%ae%d9%8a%d9%81",""],[415,"%d8%a7%d9%84%d9%88%d8%ba%d8%af",""],[416,"%d8%a7%d8%b3%d8%aa%d9%86%d8%b2%d8%a7%d9%81",""],[417,"%d8%a7%d8%b3%d8%aa%d9%82%d8%b1%d8%a7%d8%b1",""],[418,"%d8%a8%d8%b1%d8%af",""],[419,"%d9%85%d8%af%d9%8a%d9%86%d8%a9",""],[420,"%d8%b3%d9%82%d9%88%d8%b7",""],[421,"%d9%85%d8%b7%d8%b1-%d8%a3%d8%ac%d8%b3%d8%a7%d8%af-%d8%ab%d8%a7%d9%86",""],[422,"%d9%85%d8%b5%d9%8a%d8%a8%d8%a9-%d8%a3%d9%84%d9%8a%d9%83%d8%b3%d8%a7%d9%86%d8%af%d8%b1",""],[423,"%d8%a7%d9%85%d8%a8%d8%b1%d8%a7%d8%b7%d9%88%d8%b1%d8%9f",""],[424,"%d8%a5%d9%84%d9%89-%d8%a7%d9%84%d8%ae%d8%a7%d8%b1%d8%ac",""],[425,"%d8%b3%d8%a3%d9%82%d9%88%d8%af%d9%83%d9%85-%d8%a8%d9%86%d9%81%d8%b3%d9%8a",""],[426,"%d8%b5%d8%af%d9%85%d8%a9-%d8%a7%d9%84%d8%ac%d9%85%d9%8a%d8%b9",""],[427,"%d9%86%d8%b5%d9%81-%d9%85%d9%8a%d8%aa",""],[428,"%d9%85%d8%b9%d8%b1%d9%83%d8%a9-%d8%b5%d8%ba%d9%8a%d8%b1%d8%a9",""],[429,"%d8%a7%d9%84%d9%82%d8%a7%d8%a6%d8%af-%d8%a7%d9%84%d8%ab%d8%a7%d9%86%d9%8a",""],[430,"%d8%a7%d9%84%d9%85%d9%88%d8%ac%d8%a9-%d8%a7%d9%84%d8%ab%d8%a7%d9%86%d9%8a%d8%a9",""],[431,"%d9%86%d8%aa%d8%a7%d8%a6%d8%ac-%d9%81%d9%88%d8%b1%d9%8a%d8%a9",""],[432,"%d8%aa%d8%ad%d8%af%d9%8a",""],[433,"%d8%a5%d9%86%d8%b3%d8%ad%d8%a7%d8%a8-%d8%aa%d9%83%d8%aa%d9%8a%d9%83%d9%8a",""],[434,"%d9%81%d9%84%d9%86%d8%b0%d9%87%d8%a8-%d8%a5%d9%84%d9%89-%d9%86%d8%b2%d9%87%d8%a9",""],[435,"%d8%a8%d8%b4%d8%b1",""],[436,"%d9%85%d8%b9%d8%b1%d9%83%d8%a9-%d8%a5%d8%a8%d8%a7%d8%af%d8%a9",""],[437,"%d9%87%d8%ac%d9%88%d9%85",""],[438,"%d9%85%d8%b3%d8%aa%d9%8a%d9%82%d8%b8",""],[439,"%d8%ad%d9%88%d8%aa-%d8%b9%d9%84%d9%89-%d8%a7%d9%84%d8%a8%d8%b1",""],[440,"%d8%a7%d9%84%d8%ac%d8%a7%d9%86%d8%a8-%d8%a7%d9%84%d8%ae%d8%a7%d8%b3%d8%b1%d8%9f",""],[441,"%d9%85%d9%83%d8%a7%d8%b3%d8%a8%d8%9f",""],[442,"%d8%a5%d8%ae%d8%b6%d8%a7%d8%b9-%d8%a8%d8%ba%d9%8a%d8%b1-%d9%82%d8%b5%d8%af",""],[443,"%d8%a3%d8%b1%d9%8a%d8%af-%d8%a3%d9%86-%d8%a3%d8%b9%d8%b1%d9%81",""],[444,"3-%d8%a3%d8%b4%d9%87%d8%b1",""],[445,"%d8%b5%d9%8a%d8%ad%d8%a9",""],[446,"%d8%a8%d8%b1%d8%a7%d8%b9%d9%85",""],[447,"%d8%a7%d9%84%d8%a7%d8%aa%d8%b5%d8%a7%d9%84-%d8%a7%d9%84%d8%a7%d9%88%d9%84",""],[448,"%d8%a7%d9%82%d8%a7%d8%b1%d8%a8%d8%9f",""],[449,"%d9%82%d8%a8%d9%88%d9%84",""],[450,"%d9%82%d9%8c%d8%a8%d9%88%d9%84-2",""],[451,"%d8%aa%d8%a7%d8%b1%d9%8a%d8%ae-%d8%a7%d9%84%d8%b9%d8%a7%d9%84%d9%85",""],[452,"%d8%aa%d8%a7%d8%b1%d9%8a%d8%ae-%d8%a7%d9%84%d8%b9%d8%a7%d9%84%d9%85-2",""],[453,"%d8%aa%d8%a7%d8%b1%d9%8a%d8%ae-%d8%a7%d9%84%d8%b9%d8%a7%d9%84%d9%85-3",""],[454,"%d8%aa%d8%a7%d8%b1%d9%8a%d8%ae-%d8%a7%d9%84%d8%b9%d8%a7%d9%84%d9%85-4",""],[455,"%d8%a3%d8%b3%d8%a8%d8%a7%d8%a8",""],[456,"%d8%aa%d8%b5%d8%b9%d9%8a%d8%af-%d9%85%d9%81%d8%a7%d8%ac%d8%a6",""],[457,"%d8%a3%d9%81%d9%83%d8%a7%d8%b1",""],[458,"%d8%ae%d9%8a%d8%a7%d8%b1%d8%a7%d9%86",""],[459,"%d8%a3%d9%84%d8%b3%d8%ad%d8%a7%d8%a8%d8%a9-%d8%a7%d9%84%d9%81%d8%b6%d9%8a%d8%a9",""],[460,"%d9%86%d8%b7%d8%a7%d9%82-%d8%a7%d9%84%d8%b1%d9%88%d8%ad",""],[461,"%d8%a3%d9%86%d9%85%d8%a7%d8%b7",""],[462,"%d8%a7%d9%81%d8%b6%d9%84-%d9%84%d8%ad%d9%85",""],[463,"%d8%ba%d8%b6%d8%a8",""],[464,"%d8%b1%d9%8a%d8%aa%d8%b4%d8%a7%d8%b1%d8%af-%d8%a7%d8%a8%d9%86-%d8%a7%d9%84%d9%80-26",""],[465,"%d8%a7%d9%86%d8%aa%d8%b5%d8%a7%d8%b1-%d9%84%d8%a7-%d9%8a%d8%ac%d9%84%d8%a8-%d8%a7%d9%84%d8%b3%d8%b9%d8%a7%d8%af%d8%a9",""],[466,"%d8%b3%d8%a3%d8%a8%d9%82%d9%89",""],[467,"%d8%ac%d9%8a%d8%b4-%d9%85%d8%b1%d8%b9%d9%80%d9%88%d9%80%d8%a8",""],[468,"%d8%a7%d9%84%d8%ae%d8%b7%d8%a9-%d8%a7%d9%84%d8%ad%d9%82%d9%8a%d9%82%d9%8a%d8%a9",""],[469,"%d8%a7%d9%84%d8%ae%d9%88%d9%81-%d9%85%d9%86-%d8%a7%d9%84%d9%85%d8%ac%d9%87%d9%88%d9%84",""],[470,"%d8%ba%d8%b1%d9%88%d8%b1",""],[471,"%d8%a7%d9%86%d8%aa%d8%b8%d8%a7%d8%b1",""],[472,"%d8%a8%d9%88%d8%a7%d8%a8%d8%a9%d8%9f",""],[473,"%d8%a8%d9%84%d8%a7-%d9%86%d9%87%d8%a7%d9%8a%d8%a9",""],[474,"%d8%ac%d9%8a%d8%b4-%d9%8a%d9%88%d8%b1%d8%a7",""],[475,"%d8%ad%d9%85%d9%8a%d8%a9",""],[476,"%d8%a7%d9%84%d8%ae%d8%b7%d9%8a%d8%a6%d8%a9",""],[477,"%d9%84%d8%b7%d9%85%d8%a9",""],[478,"%d8%a7%d9%81%d8%b6%d9%84-%d9%85%d8%a7-%d9%81%d9%8a-%d8%a7%d9%84%d8%b9%d8%a7%d9%84%d9%85%d9%8a%d9%86%d8%9f",""],[479,"%d8%b1%d8%a8%d8%b9-%d8%a7%d9%84%d8%a8%d8%b4%d8%b1",""],[480,"%d8%a5%d9%85%d8%a8%d8%b1%d8%a7%d8%b7%d9%88%d8%b1%d8%9f",""],[481,"%d8%a5%d8%b9%d9%84%d8%a7%d9%86-%d8%a7%d9%84%d8%ad%d8%b1%d8%a8",""],[482,"%d9%85%d8%b2%d8%b1%d8%b9%d8%a9",""],[483,"%d8%b3%d8%b1-%d8%a7%d9%84%d8%af%d9%85",""],[484,"%d9%88%d8%ad%d8%b4",""],[485,"%d9%86%d8%b8%d8%a7%d9%85-%d8%a7%d9%84%d9%86%d9%82%d8%a7%d8%b7",""],[486,"%d9%86%d8%b5%d9%81-%d9%85%d8%aa%d8%b1-%d9%85%d9%86-%d8%a7%d9%84%d9%83%d8%b1%d8%a7%d9%85%d8%a9",""],[487,"%d8%af%d8%a7%d8%a6%d8%b1%d8%a9-%d8%a7%d9%84%d8%af%d9%85",""],[488,"%d9%85%d8%ae%d8%b1%d8%ac-%d8%a3%d8%ae%d9%8a%d8%b1",""],[489,"%d9%82%d9%88%d8%a9-%d8%b1%d9%88%d8%ad",""],[490,"%d9%81%d8%ae%d8%b1",""],[491,"%d8%b9%d9%85%d9%8a%d8%a7%d8%a1",""],[492,"%d8%a7%d9%84%d8%b3%d8%ad%d8%b1%d8%a9-%d8%a7%d9%84%d8%aa%d8%a7%d8%b1%d9%8a%d8%ae%d9%8a%d9%8a%d9%86",""],[493,"%d8%a3%d9%88%d8%b1%d8%a7%d8%b3%d9%8a%d9%84%d9%8a%d9%88%d9%85",""],[494,"%d9%82%d8%a7%d8%a6%d9%85%d8%a9-%d8%a7%d9%84%d8%ac%d9%8a%d9%86%d8%b1%d8%a7%d9%84%d8%a7%d8%aa",""],[495,"%d8%b7%d8%b1%d9%8a%d9%82%d8%a7%d9%86",""],[496,"%d8%a7%d9%84%d9%85%d9%88%d9%87%d8%a8%d8%a9",""],[497,"%d9%85%d8%b5%d9%8a%d8%b1",""],[498,"%d9%85%d8%b5%d9%8a%d8%b1-%d8%a7%d9%84%d9%81%d9%8a%d9%84%d9%82-%d8%a7%d9%84%d8%b9%d8%a7%d8%b4%d8%b1",""],[499,"%d8%b9%d9%85%d9%84%d8%a7%d9%82",""],[500,"%D9%82%D9%88%D8%A9-%D8%A5%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1","20250328155446"],[501,"%d8%a5%d8%b3%d8%aa%d8%b1%d8%ad",""],[502,"%d9%83%d8%a7%d8%a6%d9%86%d8%a7%d8%aa-%d8%b4%d8%a8%d8%ad%d9%8a%d8%a9",""],[503,"%d8%b1%d9%88%d8%ad",""],[504,"%d9%85%d8%ab%d8%a7%d9%84%d9%8a",""],[505,"%d8%ab%d8%ba%d8%b1%d8%a7%d8%aa",""],[506,"%d9%85%d8%b9%d8%b1%d9%83%d8%a9-%d8%aa%d8%ad%d8%aa-%d8%a7%d9%84%d8%b3%d9%85%d8%a7%d8%a1-%d8%a7%d9%84%d9%85%d9%83%d8%b3%d9%88%d8%b1%d8%a9-1",""],[507,"%d9%85%d8%b9%d8%b1%d9%83%d8%a9-%d8%aa%d8%ad%d8%aa-%d8%a7%d9%84%d8%b3%d9%85%d8%a7%d8%a1-%d8%a7%d9%84%d9%85%d9%83%d8%b3%d9%88%d8%b1%d8%a9-2",""],[508,"%D9%83%D9%87%D9%81-%D8%B9%D9%81%D8%A7-%D8%B9%D9%84%D9%8A%D9%87-%D8%A7%D9%84%D8%B2%D9%85%D9%86","20250322212849"],[509,"%D8%A7%D9%84%D8%B2%D9%85%D8%A7%D9%86-%D9%88-%D8%A7%D9%84%D9%85%D9%83%D8%A7%D9%86%D8%9F","20250322202029"],[510,"%d9%81%d8%ac%d8%b1-%d8%ac%d8%af%d9%8a%d8%af",""],[511,"%d9%86%d8%b5%d9%81-%d9%85%d9%8a%d8%aa",""],[512,"%d8%aa%d8%b9%d8%af%d9%8a%d9%84-%d9%82%d8%a7%d9%86%d9%88%d9%86-%d8%b3%d9%8a%d8%a7%d8%af%d9%8a",""],[513,"%d8%aa%d8%b9%d8%af%d9%8a%d9%84-%d9%82%d8%a7%d9%86%d9%88%d9%86-%d8%b3%d9%8a%d8%a7%d8%af%d9%8a-2",""],[514,"%d8%a7%d9%84%d8%a7%d8%ae-%d8%a7%d9%84%d8%ab%d8%a7%d9%86%d9%8a",""],[515,"%d8%ae%d8%b7%d8%a9-%d9%83%d8%a8%d8%b1%d9%89",""],[516,"%d8%b4%d8%ae%d8%b5%d9%8a%d8%a9-%d9%85%d8%ae%d8%aa%d9%84%d9%81%d8%a9",""],[517,"%d8%a7%d9%81%d9%83%d8%a7%d8%b1-%d8%b1%d9%8a%d8%aa%d8%b4%d8%a7%d8%b1%d8%af",""],[518,"%d8%aa%d8%ba%d9%8a%d9%8a%d8%b1-%d9%85%d9%81%d8%a7%d8%ac%d8%a6",""],[519,"%d8%b9%d8%a7%d9%84%d9%85-%d8%a7%d9%84%d8%b1%d9%88%d8%ad",""],[520,"%d8%a7%d9%84%d8%af%d8%b1%d8%ac%d8%a9-%d8%a7%d9%84%d8%ab%d8%a7%d9%84%d8%ab%d8%a9",""],[521,"%D9%85%D8%AD%D8%B8%D9%88%D8%B8-%D9%84%D8%A3%D9%86%D9%83-%D8%A8%D8%AC%D8%A7%D9%86%D8%A8%D9%8A","20250906105242"],[522,"%d9%85%d8%aa%d8%a3%d8%ae%d8%b1-%d8%ac%d8%af%d8%a7%d9%8b",""],[523,"%d8%a8%d9%81%d8%b6%d9%84%d9%83",""],[524,"%d8%a3%d8%b5%d9%84",""],[525,"%d8%a7%d9%84%d8%a7%d8%a8%d9%86%d8%a7%d8%a1-%d8%a7%d9%84%d9%85%d8%af%d9%84%d9%84%d9%8a%d9%86",""],[526,"%d8%a7%d8%b3%d8%b1%d8%a7%d8%b1-%d8%a7%d9%84%d8%af%d9%85",""],[527,"%d8%a7%d8%b5%d9%84-%d8%a7%d9%84%d8%a7%d9%88%d8%b4%d8%a7%d9%85",""],[528,"%D8%A7%D8%AE%D8%AA%D9%84%D8%A7%D9%81-%D8%A7%D9%84%D8%AF%D9%85%D8%A7%D8%A1","20260606010813"],[529,"%D8%AF%D9%85-%D8%A7%D9%84%D8%B9%D9%81%D8%A7%D8%B1%D9%8A%D8%AA","20260610190141"],[530,"%D9%84%D8%AD%D8%B8%D8%A9-%D8%A5%D8%AF%D8%B1%D8%A7%D9%83","20260612050009"],[531,"%d9%85%d8%a7-%d8%ad%d8%af%d8%ab-%d9%84%d8%ac%d8%a7%d8%a8%d8%a7",""],[532,"%D9%81%D8%AE%D8%B1","20260612053515"],[533,"%D9%85%D9%86-%D8%A5%D9%86%D8%B3%D8%A7%D9%86-%D9%84%D8%A5%D9%86%D8%B3%D8%A7%D9%86","20260607224008"],[534,"%D9%81%D8%B1%D9%8A%D9%82-%D8%AC%D8%AF%D9%8A%D8%AF","20260612043012"],[535,"%d8%b3%d8%a7%d8%ad%d8%a9-%d9%85%d8%b9%d8%b1%d9%83%d8%a9",""],[536,"%D8%AE%D8%B7%D8%A9-%D8%A8%D8%AF%D9%8A%D9%84%D8%A9","20260612050917"],[537,"%D9%82%D9%88%D8%A9-%D8%AC%D8%AF%D9%8A%D8%AF%D8%A9","20260610184027"],[538,"%D8%A5%D8%B3%D8%AA%D9%81%D8%B2%D8%A7%D8%B2","20260612042934"],[539,"%D8%B4%D8%B1%D9%88%D8%B7","20260612053759"],[540,"%d8%aa%d8%ba%d9%8a%d9%8a%d8%b1-%d9%85%d9%81%d8%a7%d8%ac%d8%a6",""],[541,"%D8%AE%D8%B7%D8%A9-%D8%A7%D9%84%D8%A7%D8%A8-%D8%A7%D9%84%D8%B4%D8%AC%D8%B1%D8%A9","20260606013041"],[542,"%d8%a7%d8%ae%d8%aa%d9%8a%d8%a7%d8%b1-%d8%a7%d9%84%d8%b7%d8%a7%d8%ba%d9%8a%d8%a9",""],[543,"%D9%86%D8%B5%D8%B1","20260610185524"],[544,"%d8%a7%d8%b3%d8%aa%d8%b3%d9%84%d9%85%d9%88%d8%a7",""],[545,"%D8%B0%D9%83%D8%B1%D9%8A%D8%A7%D8%AA","20260607233103"],[546,"%D8%B2%D8%A7%D8%A6%D8%B1-%D9%85%D9%8F%D9%86%D8%AA%D8%B8%D8%B1","20260606020257"],[547,"%D8%AA%D8%B9%D9%84%D9%8A%D9%85%D8%A7%D8%AA","20260612053044"],[548,"%D8%A7%D8%AE%D8%A8%D8%A7%D8%B1-%D9%85%D9%86-%D9%86%D9%8A%D9%87%D8%A7%D8%B1%D9%8A","20260610190018"],[549,"%D8%B9%D9%86%D8%AF%D9%85%D8%A7-%D8%B0%D8%B1%D9%81-%D8%A7%D9%84%D8%A5%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1-%D8%A7%D9%84%D8%AF%D9%85%D9%88%D8%B9","20260606020206"],[550,"%d9%87%d8%af%d9%81-%d8%ac%d8%af%d9%8a%d8%af",""],[551,"%d8%a7%d9%84%d8%b7%d9%85%d8%b9",""],[552,"%D8%B2%D8%A7%D8%B1%D8%A7","20260606015957"],[553,"%d8%ae%d8%b2%d9%8a%d9%86%d8%a9",""],[554,"%D8%A8%D9%8A%D9%88%D9%86","20260612042029"],[555,"%D9%85%D8%AD%D8%A7%D8%AF%D8%AB%D8%A9-%D9%85%D8%B9-%D8%A7%D9%84%D8%A7%D8%A8-%D8%A7%D9%84%D8%B4%D8%AC%D8%B1%D8%A9-1","20260606022408"],[556,"%D8%AD%D9%88%D8%A7%D8%B1-%D9%85%D8%B9-%D8%A7%D8%A8-%D8%B4%D8%AC%D8%B1%D8%A9-2","20260612053129"],[557,"%D8%AD%D9%88%D8%A7%D8%B1-%D9%85%D8%B9-%D8%A7%D8%A8-%D8%B4%D8%AC%D8%B1%D8%A9-3","20250429060702"],[558,"%D9%85%D9%86-%D9%84%D8%A7%D8%B9%D8%A8-%D9%84%D8%A8%D9%8A%D8%AF%D9%82","20260610181426"],[559,"%D8%A7%D9%84%D8%AD%D9%8A%D8%A7%D8%A9-%D8%A7%D9%84%D8%A7%D8%A8%D8%AF%D9%8A%D8%A9","20260607225014"],[560,"%D8%A7%D8%B3%D8%B1%D8%A7%D8%B1-%D8%B9%D8%AA%D9%8A%D9%82%D8%A9","20260612045211"],[561,"%D8%B4%D9%8A%D8%B7%D8%A7%D9%86-%D9%86%D8%B9%D8%B1%D9%81%D9%87","20260606013638"],[562,"%D9%84%D9%82%D8%A7%D8%A1-%D9%85%D8%B5%D8%A7%D8%AF%D9%81%D8%A9","20260606012731"],[563,"%d8%a7%d9%84%d9%81%d8%aa%d8%a7%d8%a9-%d8%a7%d9%84%d8%ba%d8%b2%d8%a7%d9%84",""],[564,"%D8%AD%D9%82%D9%8A%D9%82%D8%A9-%D8%A7%D9%84%D8%AD%D9%8A%D8%A7%D8%A9-%D8%A7%D9%84%D8%A7%D8%A8%D8%AF%D9%8A%D8%A9","20250429035429"],[565,"%D8%AD%D9%82%D9%8A%D9%82%D8%A9-%D8%B1%D9%88%D8%AD-%D8%A7%D9%84%D9%83%D9%88%D9%83%D8%A8","20260610191733"],[566,"%D8%A7%D8%AE%D8%AA%D9%8A%D8%A7%D8%B1-%D8%A7%D9%84%D8%A7%D8%A8%D8%A7%D8%A1-%D8%A7%D9%84%D8%A7%D8%B4%D8%AC%D8%A7%D8%B1","20260606015645"],[567,"%D8%A7%D8%B3%D8%B1%D8%A7%D8%B1-1","20260612050409"],[568,"%D8%A7%D8%B3%D8%B1%D8%A7%D8%B1-2","20260606015712"],[569,"%D8%B0%D9%87%D8%A8%D9%8A","20260607223132"],[570,"%D8%A7%D9%84%D8%B5%D9%82%D9%84","20260612053559"],[571,"%D9%85%D8%AE%D8%A7%D9%88%D9%81","20260612054804"],[572,"%D9%85%D8%AC%D9%84%D8%B3-%D8%A7%D9%84%D8%AD%D8%B1%D8%A8-1","20260606022016"],[573,"%d9%85%d8%ac%d9%84%d8%b3-%d8%a7%d9%84%d8%ad%d8%b1%d8%a8-2",""],[574,"%D9%85%D8%AC%D9%84%D8%B3-%D8%A7%D9%84%D8%AD%D8%B1%D8%A8-3","20260612050221"],[575,"%D9%85%D8%AC%D9%84%D8%B3-%D8%A7%D9%84%D8%AD%D8%B1%D8%A8-4","20260606021005"],[576,"%D9%85%D8%AC%D9%84%D8%B3-%D8%A7%D9%84%D8%AD%D8%B1%D8%A8-5","20260610174150"],[577,"%d8%a8%d8%b1%d9%83%d8%a7%d9%86",""],[578,"%D8%A7%D9%84%D9%82%D9%86%D8%A8%D9%84%D8%A9-%D8%A7%D9%84%D9%85%D9%88%D9%82%D9%88%D8%AA%D8%A9","20260607222739"],[579,"%D8%AF%D9%85%D8%A7%D8%A1-%D8%AD%D9%85%D8%B1%D8%A7%D8%A1-%D9%88-%D8%AE%D8%B6%D8%B1%D8%A7%D8%A1","20250410190608"],[580,"%d8%ab%d9%84%d8%a7%d8%ab-%d8%b3%d9%86%d9%88%d8%a7%d8%aa",""],[581,"%D8%A7%D9%84%D8%A7%D8%B3%D8%A7%D8%B3-%D8%B1%D9%82%D9%85-41","20260610184343"],[582,"%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1-%D8%A7%D8%AE%D8%B1","20260606013736"],[583,"%D9%86%D8%B8%D8%A7%D9%85-%D8%AA%D8%AF%D8%B1%D9%8A%D8%A8-%D8%A7%D9%84%D8%AC%D8%B3%D8%AF","20260607225109"],[584,"%D9%86%D8%B8%D8%A7%D9%85-%D8%AA%D8%AF%D8%B1%D9%8A%D8%A8-%D8%AC%D8%B3%D8%AF-%D8%AC%D8%AF%D9%8A%D8%AF","20260612050100"],[585,"%D8%A7%D9%84%D9%88%D8%A7%D9%82%D8%B9-%D9%81%D9%8A-%D8%A7%D8%B1%D8%B6-%D8%A7%D9%84%D9%85%D9%88%D8%AA","20260610190549"],[586,"%D8%AB%D9%88%D8%B1%D8%A9-%D9%85%D9%86-%D8%A7%D9%84%D8%B9%D8%AF%D9%85","20260610182151"],[587,"%D8%B9%D8%B5%D9%8A%D8%A7%D9%86","20260610185245"],[588,"%D8%A7%D8%B3%D8%AA%D8%AF%D8%B9%D8%A7%D8%A1","20260606022448"],[589,"%D8%A7%D8%B0%D8%B1%D8%B9-%D8%B5%D8%AE%D8%B1%D9%8A%D8%A9","20260607234749"],[590,"%D8%B9%D9%85%D9%84-%D8%B9%D8%A7%D9%84%D9%82","20260612043454"],[591,"%D8%A7%D9%84%D8%B4%D9%85%D8%B3-%D8%A7%D9%84%D8%B0%D8%A7%D8%A6%D8%A8%D8%A9","20260607234835"],[592,"%D8%A7%D9%84%D8%B9%D9%85%D9%84%D8%A7%D9%82-%D8%A7%D9%84%D8%B0%D9%87%D8%A8%D9%8A","20260606010422"],[593,"%D9%88%D8%AD%D9%88%D8%B4%D9%8C-%D8%BA%D8%A8%D9%8A%D8%A9","20260610185049"],[594,"%D8%B3%D9%8A%D8%AF-%D8%A7%D9%84%D8%AD%D8%B1%D8%A8-%D8%A7%D9%84%D8%B0%D9%87%D8%A8%D9%8A","20260606010742"],[595,"%D9%85%D8%B4%D8%BA%D9%88%D9%84%D9%88%D9%86","20260612054555"],[596,"%D8%A7%D9%84%D9%88%D8%B6%D8%B9-%D9%81%D9%8A-%D8%A7%D9%84%D9%85%D8%B2%D8%B1%D8%B9%D8%A9","20260606013755"],[597,"%D8%AD%D8%B1%D8%A7%D8%B3-%D8%A7%D9%84%D8%B9%D8%A7%D9%84%D9%85","20260606021933"],[598,"%D9%81%D8%B1%D8%B5%D8%A9-%D8%A7%D9%84%D9%85%D8%B2%D8%B1%D8%B9%D8%A9-%D8%A7%D9%84%D8%A7%D8%AE%D9%8A%D8%B1%D8%A9","20260612043306"],[599,"%D9%85%D8%B4%D8%A7%D9%83%D9%84-%D8%B3%D9%8A%D8%AF-%D8%A7%D9%84%D8%AD%D8%B1%D8%A8","20260612053328"],[600,"%D9%85%D8%B4%D9%83%D9%84%D8%A9-%D9%81%D9%8A-%D8%A7%D9%84%D8%B4%D8%B1%D9%82-%D8%A7%D9%84%D8%A7%D9%82%D8%B5%D9%89","20260607235006"],[601,"%D9%81%D9%88%D8%B6%D9%88%D9%8A","20260612052446"],[602,"%D8%AA%D9%82%D9%86%D9%8A%D8%A9-%D9%85%D9%86%D8%B3%D9%8A%D8%A9-%D8%AA%D9%86%D9%82%D8%B0-%D8%A7%D9%84%D9%88%D8%B6%D8%B9","20260612045147"],[603,"%D8%A7%D9%86%D8%AA%D8%B5%D8%A7%D8%B1-%D9%85%D8%B1%D9%8A%D8%B1%D8%9F","20260606014912"],[604,"%D9%86%D8%A7%D8%B1-%D8%A7%D9%84%D9%85%D9%88%D8%AA","20260607223716"],[605,"%d8%a7%d9%84%d9%88%d8%ac%d9%87-%d9%81%d9%8a-%d8%a7%d9%84%d8%b3%d9%85%d8%a7%d8%a1",""],[606,"%D8%A7%D9%84%D9%87%D8%AF%D9%8A%D8%A9","20260607234614"],[607,"%D8%A7%D9%84%D9%85%D8%B7%D9%8A%D8%A9-%D8%A7%D9%84%D9%85%D8%AB%D8%A7%D9%84%D9%8A%D8%A9","20260607231527"],[608,"%D9%88%D8%AD%D8%B4-%D8%A7%D9%84%D8%AA%D9%8A%D8%B1%D8%A7","20260610181454"],[609,"%D8%B3%D9%88%D9%81-%D8%A7%D8%B3%D8%A7%D8%B9%D8%AF%D9%83","20260606015313"],[610,"%d8%a7%d8%aa%d9%81%d8%a7%d9%82",""],[611,"%D9%84%D9%82%D8%A7%D8%A1-%D9%81%D8%B1%D9%82-%D8%A7%D9%84%D8%A8%D8%AD%D8%AB-%D9%88-%D8%A7%D9%84%D8%AA%D8%B7%D9%88%D9%8A%D8%B1","20260612052713"],[612,"%D9%85%D8%B9%D8%AC%D8%B2%D8%A9-%D8%A7%D9%84%D8%AC%D9%8A%D9%86%D8%B1%D8%A7%D9%84-%D8%B1%D8%A7%D9%8A%D8%AF%D9%8A%D9%86","20260612050116"],[613,"%d8%a7%d9%84%d8%b6%d9%88%d8%a1",""],[614,"%D8%B9%D9%87%D8%AF-%D8%AC%D8%AF%D9%8A%D8%AF","20250429150717"],[615,"%D8%A7%D9%84%D8%A7%D8%AE%D8%AA%D8%A8%D8%A7%D8%B1-%D8%A7%D9%84%D8%AB%D8%A7%D9%86%D9%8A","20260610182015"],[616,"%D8%AF%D8%B1%D8%B9-%D8%A7%D9%84%D8%AA%D9%8A%D8%B1%D8%A7","20260606021954"],[617,"%D8%A7%D9%84%D9%87%D9%8A%D8%A6%D8%A9-%D8%A7%D9%84%D9%86%D9%87%D8%A7%D8%A6%D9%8A%D8%A9","20260606010845"],[618,"%D8%A8%D8%A7%D8%B1%D9%82%D8%A9-%D8%A7%D9%85%D9%84","20260607222230"],[619,"%D9%85%D8%B5%D9%86%D8%B9-%D9%82%D8%A7%D8%B1%D8%A9-%D8%A7%D9%84%D8%B3%D9%84%D9%81","20260607233826"],[620,"%D8%AA%D9%88%D8%A7%D8%B2%D9%86","20260607224921"],[621,"%d8%a7%d9%84%d9%88%d8%b6%d8%b9-%d9%81%d9%8a-%d9%83%d9%88%d9%83%d8%a8-%d8%a7%d9%84%d9%85%d8%b2%d8%b1%d8%b9%d8%a9",""],[622,"%D8%AE%D9%88%D9%81%D9%8F-%D9%88-%D8%BA%D8%B6%D8%A8","20260607234703"],[623,"%D8%B9%D8%A8%D8%A7%D8%A1%D8%A9-%D8%A7%D9%84%D8%B0%D9%87%D8%A8","20260606020655"],[624,"%D8%A7%D9%84%D8%B3%D8%B1","20260606012303"],[625,"%d9%85%d9%86-%d8%a7%d9%84%d9%88%d8%ad%d8%b4%d8%9f",""],[626,"%d8%aa%d9%81%d8%a7%d9%88%d8%b6",""],[627,"%D8%B1%D9%87%D9%8A%D9%86%D8%A9","20260612051950"],[628,"%D9%82%D8%B1%D8%A7%D8%B1-%D8%A7%D8%B3%D9%81%D9%84-%D8%A7%D9%84%D8%B4%D8%AC%D8%B1%D8%A9","20260612042615"],[629,"%D8%AF%D9%85-%D8%A7%D9%84%D9%8A%D8%AA%D9%8A%D9%85","20260610175535"],[630,"%D8%A7%D9%84%D8%B7%D9%85%D8%B9","20260610183701"],[631,"%D8%AC%D9%86%D8%A9-%D8%B9%D9%84%D9%89-%D8%A8%D8%AD%D8%B1-%D8%A7%D9%84%D8%AF%D9%85","20260612050210"],[632,"%D9%85%D8%B9%D8%B1%D9%81%D8%A9-%D8%A7%D9%84%D8%AD%D8%AF%D9%88%D8%AF","20260606014644"],[633,"%D8%A7%D9%84%D9%85%D8%AF%D9%8A%D9%86%D8%A9-%D8%A7%D9%84%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1%D9%8A%D8%A9","20260612054825"],[634,"%D8%A7%D9%84%D8%B1%D9%85%D8%A7%D8%AF-%D8%A7%D9%84%D9%85%D8%B4%D8%AA%D8%B9%D9%84","20260607231753"],[635,"%d9%85%d8%ae%d8%aa%d8%b7%d9%81%d9%8a-%d9%85%d9%86%d8%aa%d8%b5%d9%81-%d8%a7%d9%84%d9%84%d9%8a%d9%84",""],[636,"%D8%A7%D9%84%D8%AC%D8%B2%D9%8A%D8%A6%D8%A7%D8%AA-%D8%A7%D9%84%D9%85%D8%AA%D8%BA%D9%8A%D8%B1%D8%A9-%D9%85%D8%AC%D8%AF%D8%AF%D8%A7%D9%8B","20260612053641"],[637,"%D8%B3%D9%88%D9%81-%D8%A7%D8%B3%D8%A7%D8%B9%D8%AF","20260610183554"],[638,"%D8%AB%D9%84%D8%A7%D8%AB-%D8%B3%D9%86%D9%88%D8%A7%D8%AA","20260612045035"],[639,"%d9%85%d9%81%d8%a7%d8%ac%d8%a3%d8%a9-%d9%85%d9%86-%d8%b1%d8%a7%d9%8a%d8%af%d9%8a%d9%86",""],[640,"%D9%84%D8%A7-%D8%A7%D8%B1%D9%8A%D8%AF","20260612043845"],[641,"%D8%B4%D9%83%D8%B1%D8%A7%D9%8B-%D9%84%D9%83","20260610191330"],[642,"%D8%A7%D9%84%D9%85%D9%86%D9%81%D9%89-%D8%A7%D9%84%D8%AC%D9%85%D9%8A%D9%84","20260612050719"],[643,"%d8%b9%d8%b1%d8%b6",""],[644,"%D8%AA%D8%AD%D9%82%D9%8A%D9%82-%D8%A7%D9%84%D9%88%D8%B9%D8%AF","20260612054917"],[645,"%D8%A7%D9%84%D9%85%D8%B4%D9%81%D9%89-%D8%A7%D9%84%D9%85%D9%8A%D8%AF%D8%A7%D9%86%D9%8A","20250906124905"],[646,"%D8%A7%D9%84%D9%85%D8%B5%D9%81%D9%88%D9%81%D8%A9-%D8%A7%D9%84%D9%81%D9%88%D8%B1%D9%8A%D8%A9","20260607223526"],[647,"%D8%A7%D9%84%D9%85%D8%B5%D9%81%D9%88%D9%81%D8%A9-%D8%A7%D9%84%D9%81%D9%88%D8%B1%D9%8A%D8%A9-2","20260610180318"],[648,"%D8%A7%D9%87%D8%AA%D8%B2%D8%A7%D8%B2-%D8%A7%D9%84%D9%85%D9%86%D8%B7%D9%82%D8%A9-%D8%A7%D9%84%D8%B4%D9%85%D8%A7%D9%84%D9%8A%D8%A9","20260610175936"],[649,"%d8%b9%d8%a8%d8%af-%d8%a7%d9%84%d8%b3%d9%84%d8%a7%d9%84%d8%a9",""],[650,"%D9%85%D8%A7-%D9%8A%D8%B1%D9%8A%D8%AF%D9%87-%D9%85%D8%B9%D8%A7%D9%84%D9%8A%D9%87","20260610190849"],[651,"%D8%A7%D9%84%D8%B3%D8%A8%D9%8A%D9%84-%D8%A7%D9%84%D9%88%D8%AD%D9%8A%D8%AF","20260606021031"],[652,"%D9%86%D9%82%D9%84-%D8%A7%D9%84%D8%B1%D8%B3%D8%A7%D9%84%D8%A9","20260610175802"],[653,"%d8%b3%d8%ad%d8%a8-%d8%a7%d9%84%d8%b3%d9%8a%d9%88%d9%81",""],[654,"%D9%85%D8%B9%D8%B1%D9%83%D8%A9-%D8%A7%D9%84%D8%A8%D8%B1%D9%82","20250430053422"],[655,"%d9%85%d8%b9%d8%b1%d9%83%d8%a9-%d8%a7%d9%84%d8%a8%d8%b1%d9%82",""],[656,"%D8%B1%D9%81%D9%8A%D9%82-%D8%A7%D9%84%D9%85%D8%AC%D8%AF","20260612044858"],[657,"%D9%88%D8%AD%D8%AF%D8%A7%D8%AA-%D8%A7%D9%84%D8%B1%D9%88%D8%AD","20260606021353"],[658,"%D8%A7%D9%84%D8%AA%D9%82%D9%86%D9%8A%D8%A9-%D8%A7%D9%84%D9%85%D8%AD%D8%B1%D9%85%D8%A9","20260607233256"],[659,"%D9%85%D8%AE%D9%84%D9%88%D9%82%D8%A7%D8%AA-%D8%A7%D9%84%D8%B1%D9%88%D8%AD","20260610184116"],[660,"%D9%85%D9%83%D8%A7%D9%81%D8%A3%D8%A9-%D8%A7%D9%8A%D9%81%D8%B1%D8%AC%D8%B1%D9%8A%D9%86","20260606020346"],[661,"%D8%B4%D8%B1%D9%8A%D8%A7%D9%86-%D8%A7%D9%84%D8%AD%D9%8A%D8%A7%D8%A9","20250907175843"],[662,"%D9%85%D8%B1%D9%83%D8%A8%D8%A9-%D9%81%D8%B6%D8%A7%D8%A6%D9%8A%D8%A9","20250430223414"],[663,"%D8%A7%D9%88%D9%84-%D8%AA%D9%88%D8%A7%D8%B5%D9%84","20250323142330"],[664,"%d9%85%d8%b4%d9%83%d9%84%d8%aa%d8%a7%d9%86",""],[665,"%D9%85%D8%AE%D8%AA%D8%A7%D8%B1-%D8%A7%D9%84%D8%AD%D9%82%D9%8A%D9%82%D8%A9-%D8%A7%D9%84%D8%AB%D8%A7%D9%84%D8%AB","20250430231503"],[666,"%d8%b9%d9%84%d9%89-%d8%a7%d9%84%d8%a7%d8%a8%d9%88%d8%a7%d8%a8",""],[667,"%D8%A7%D9%84%D8%AE%D8%B7-%D8%A7%D9%84%D8%A7%D9%88%D9%84","20250430232815"],[668,"%D8%A7%D9%84%D8%B9%D8%B5%D8%A7","20250430223225"],[669,"%D9%85%D9%82%D8%A7%D9%88%D9%85%D8%A9","20240712173753"],[670,"%D8%A7%D9%84%D9%85%D9%88%D9%82%D9%81-%D9%81%D9%8A-%D8%A7%D9%84%D8%AC%D9%86%D9%88%D8%A8","20240225073559"],[671,"%D8%AC%D9%86%D9%88%D9%86-%D8%A7%D9%84%D9%85%D9%86%D8%B7%D9%82%D8%A9-%D8%A7%D9%84%D8%B4%D8%B1%D9%82%D9%8A%D8%A9","20240226011051"],[673,"%D9%84%D9%8A%D8%A7%D9%84%D9%8A-%D8%B9%D8%B2%D9%8A%D9%84-%D8%A7%D9%84%D8%AF%D8%A7%D9%85%D9%8A%D8%A9","20240227065518"],[674,"%D9%84%D9%8A%D8%A7%D9%84%D9%8A-%D8%B9%D8%B2%D9%8A%D9%84-%D8%A7%D9%84%D8%AF%D8%A7%D9%85%D9%8A%D8%A9-2","20240228050430"],[675,"%D8%AD%D8%B5%D8%A7%D8%B1-%D8%A8%D9%84%D8%A7-%D8%AC%D9%86%D9%88%D8%AF","20240228141830"],[676,"%D9%85%D8%A3%D8%B3%D8%A7%D8%A9","20240229133757"],[677,"%D9%85%D9%86%D8%A7%D9%82%D8%B4%D8%A9-%D8%A7%D9%84%D9%85%D8%B5%D9%8A%D8%B1","20240229205308"],[678,"%D9%85%D8%B3%D9%85%D8%A7%D8%B1-%D8%A7%D9%84%D8%AE%D8%AA%D9%85","20260610183944"],[679,"%D8%A7%D9%84%D8%A7%D8%A8%D9%86-%D8%A7%D9%84%D9%85%D8%AD%D8%B8%D9%88%D8%B8","20240303005127"],[681,"%D9%85%D8%B9%D8%B1%D9%83%D8%A9","20240805192823"],[682,"%D8%A3%D9%84%D9%85","20240828175532"],[683,"%D9%86%D8%A7%D8%B1-%D8%A7%D9%84%D8%AD%D9%8A%D8%A7%D8%A9","20240717032600"],[684,"%D9%84%D9%87%D8%A8-%D8%A7%D9%84%D8%B1%D9%88%D8%AD-%D8%A7%D9%84%D8%A7%D8%AE%D8%B6%D8%B1","20240920104111"],[685,"%D8%A3%D8%B9%D9%8A%D9%86-%D9%81%D9%8A-%D8%A7%D9%84%D8%B8%D9%84%D9%85%D8%A9","20240713024342"],[686,"%D8%B9%D9%8A%D8%A8-%D9%81%D8%A7%D8%AF%D8%AD","20240918060043"],[687,"%D8%AD%D8%B5%D9%86","20240902224552"],[688,"%D8%AA%D8%AF%D8%AE%D9%8F%D9%84","20240715141531"],[689,"%D8%A7%D9%84%D8%B6%D8%B1%D8%A8%D8%A9-%D8%A7%D9%84%D9%86%D9%87%D8%A7%D8%A6%D9%8A%D8%A9-%D9%84%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B9%D9%86%D8%A7%D8%B5%D8%B1%D9%8A","20240828092139"],[690,"%D9%84%D9%85%D8%AD%D8%A9-%D9%85%D9%86-%D8%A7%D9%84%D9%85%D8%A7%D8%B6%D9%8A","20240718024001"],[692,"%D8%A8%D8%AF%D8%A3%D8%AA-%D8%A7%D9%84%D9%85%D8%B9%D8%B1%D9%83%D8%A9","20240724074455"],[693,"%D8%A7%D9%88%D9%84-%D8%B6%D8%AD%D9%8A%D8%A9","20241117184732"],[694,"%D8%A7%D9%84%D8%B5%D8%AF%D8%A7%D9%85-%D8%A7%D9%84%D8%A7%D8%AE%D9%8A%D8%B1","20240717020233"],[695,"%D8%AB%D8%A7%D9%84%D8%AB","20240716162245"],[696,"%d8%af%d8%ae%d9%84%d8%a7%d8%a1",""],[697,"%D9%83%D8%B1%D9%8A%D9%83%D8%B3%D9%88%D8%B3-%D8%A7%D9%84%D8%B9%D8%B8%D9%8A%D9%85","20240717022310"],[698,"%D8%AA%D8%A7%D8%B1%D9%8A%D8%AE-%D9%85%D9%86%D8%B3%D9%8A","20240718001158"],[699,"%D8%A7%D9%84%D8%B9%D8%A8%D9%82%D8%B1%D9%8A-%D8%A7%D9%84%D9%85%D9%86%D8%B3%D9%8A","20240911072308"],[700,"%D9%87%D9%8A%D8%A8%D8%A9","20240717004357"],[701,"%D9%86%D8%AA%D9%8A%D8%AC%D8%A9-%D8%A7%D9%84%D9%85%D8%B9%D8%B1%D9%83%D8%A9","20240717220908"],[702,"%D8%B7%D9%81%D9%84%D8%A7%D9%86","20240801183948"],[703,"%D8%B5%D9%85%D8%AA%D9%8F-%D9%85%D8%B1%D8%AA%D9%81%D8%B9","20240717205059"],[704,"%D9%85%D8%A8%D8%A7%D9%84%D8%BA%D8%A9-%D9%81%D9%8A-%D8%A7%D9%84%D8%AA%D9%82%D8%AF%D9%8A%D8%B1","20240801182612"],[705,"%D8%A7%D9%84%D8%B3%D9%84%D9%81-%D8%A7%D9%84%D9%85%D8%AC%D9%86%D9%88%D9%86","20240715045535"],[706,"%D9%81%D9%88%D8%A7%D8%A6%D8%AF-%D9%88-%D8%AE%D8%B3%D8%A7%D8%A6%D8%B1","20260610182751"],[707,"%D8%A7%D9%84%D9%88%D8%B6%D8%B9-%D8%B9%D9%84%D9%89-%D9%86%D9%8A%D9%87%D8%A7%D8%B1%D9%8A","20240814215053"],[708,"%D8%AE%D8%B7%D8%A9-%D8%A7%D9%84%D8%AD%D8%B1%D8%A8","20240717102616"],[709,"%D8%A7%D8%AA%D9%81%D8%A7%D9%82","20240717085126"],[710,"%D8%A7%D9%84%D9%88%D8%B7%D9%86","20241124064542"],[711,"%D9%85%D8%B5%D9%8A%D8%B1","20240717013836"],[712,"%D9%84%D9%82%D8%A7%D8%A1-%D9%85%D8%A4%D8%AC%D9%84","20240717233257"],[713,"%D8%A7%D9%84%D8%B4%D9%85%D8%A7%D9%84-%D8%A8%D8%B9%D8%AF-%D8%A7%D9%84%D8%B9%D8%A7%D8%B5%D9%81%D8%A9","20240717190727"],[714,"%D9%88%D8%B5%D9%88%D9%84","20240717061212"],[715,"%D8%AA%D8%B1%D8%AD%D9%8A%D8%A8","20240717022700"],[716,"%D8%BA%D8%B6%D8%A8%D9%8C-%D9%85%D8%B6%D8%B7%D8%B1%D8%A8","20240912081111"],[717,"%D8%A7%D9%84%D8%A8%D9%88%D8%A7%D8%A8%D8%A7%D8%AA","20240717065224"],[718,"%D8%B5%D9%90%D8%AF%D8%A7%D9%85-%D8%A8%D9%8A%D9%86-%D8%A7%D9%84%D8%B9%D8%B4%D9%8A%D8%B1%D8%A9-%D9%88-%D8%A7%D9%84%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1%D9%8A%D8%A9","20260606012650"],[719,"%D8%A7%D9%84%D8%AC%D9%8A%D8%B4-%D8%A7%D9%84%D9%85%D8%AD%D9%84%D9%8A","20240717202840"],[720,"%D9%86%D9%90%D8%AF","20240813213958"],[721,"%D8%A7%D9%86%D8%B3%D8%AD%D8%A7%D8%A8","20240828190922"],[722,"%D9%85%D8%A7-%D8%A8%D8%B9%D8%AF-%D8%A7%D9%84%D8%AD%D8%B5%D8%A7%D8%B1","20250121135031"],[723,"%d8%ae%d9%85%d8%b3%d8%a9",""],[724,"%D8%A7%D9%84%D8%AD%D8%AF-%D8%A7%D9%84%D9%81%D8%A7%D8%B5%D9%84","20240911182609"],[725,"%D8%AF%D8%B9%D9%85","20240913092224"],[726,"%D9%87%D8%AF%D9%81-%D8%AC%D8%AF%D9%8A%D8%AF","20240911205301"],[727,"%D8%AD%D9%88%D8%A7%D8%B1-%D8%A7%D9%84%D8%A7%D8%AE%D9%88%D9%8A%D9%86","20240717025539"],[728,"%D8%A7%D9%84%D8%A7%D9%81%D9%82","20240717165937"],[729,"%d8%aa%d9%88%d9%82%d9%81",""],[730,"%D8%A7%D9%84%D8%AC%D8%A8%D9%84-%D8%A7%D9%84%D8%B3%D8%A7%D9%82%D8%B7","20240717180639"],[731,"%D8%A7%D9%84%D8%A7%D9%88%D9%84","20240717022223"],[732,"%D8%AA%D8%A7%D9%81%D9%8A%D9%86%D8%A7","20240717162546"],[733,"%D8%AD%D8%B1%D9%83%D8%A9-%D9%85%D9%81%D8%A7%D8%AC%D8%A6%D8%A9","20260607235933"],[734,"%D9%87%D8%AC%D9%88%D9%85-%D9%85%D9%81%D8%A7%D8%AC%D8%A6","20260607233413"],[735,"%D8%B9%D9%85%D9%84%D9%8A%D8%A9-%D9%85%D8%B1%D9%8A%D8%A8%D8%A9","20250122063908"],[736,"%D8%A7%D9%86%D8%B3%D8%AD%D8%A7%D8%A8","20241117170118"],[737,"%D8%B4%D9%87%D8%B1%D9%8A%D9%86","20241116022914"],[738,"%D9%85%D8%B5%D8%B7%D9%86%D8%B9%D9%88%D9%86","20240717132832"],[739,"%D8%A7%D9%84%D8%AD%D9%84-%D9%88-%D8%A7%D9%84%D8%AA%D8%AC%D9%86%D8%A8","20240718044032"],[740,"%D8%AA%D8%B1%D8%AA%D9%8A%D8%A8-%D8%A7%D9%84%D9%82%D8%B7%D8%B9","20240912045815"],[741,"%D8%A7%D9%84%D8%B7%D9%85%D9%88%D8%AD-%D9%88-%D8%A7%D9%84%D8%AF%D9%85-1","20240717045707"],[742,"%D8%A7%D9%84%D8%B7%D9%85%D9%88%D8%AD-%D9%88-%D8%A7%D9%84%D8%AF%D9%85-2","20240717115853"],[743,"%D8%A7%D9%84%D8%B7%D9%85%D9%88%D8%AD-%D9%88-%D8%A7%D9%84%D8%AF%D9%85-3","20241117075326"],[744,"%D8%B1%D9%88%D9%83%D9%8A","20240802002137"],[745,"%D8%A7%D9%84%D8%B9%D8%AA%D8%A7%D8%AF-%D8%A7%D9%84%D9%85%D9%84%D8%AD%D9%85%D9%8A","20250119112928"],[746,"%D8%A7%D9%84%D8%AD%D9%82%D9%8A%D9%82%D8%A9-%D8%A7%D9%84%D9%85%D8%B1%D8%A9","20240918080404"],[747,"%D9%85%D8%A7-%D8%AD%D8%AF%D8%AB","20250119120425"],[748,"%D8%B5%D9%81%D8%B1-%D8%A7%D8%AD%D8%AA%D8%B1%D8%A7%D9%85","20240911233312"],[749,"%D8%AE%D8%A7%D8%B1%D8%AC-%D8%B9%D9%86-%D8%A7%D9%84%D8%A7%D9%8A%D8%AF%D9%8A","20240913103815"],[750,"%D8%B8%D9%84-%D8%AF%D8%A7%D9%83%D9%86-%D9%81%D9%88%D9%82-%D9%86%D9%8A%D9%87%D8%A7%D8%B1%D9%8A","20240805162156"],[751,"%D8%B8%D9%84-%D8%AF%D8%A7%D9%83%D9%86-%D9%81%D9%88%D9%82-%D9%86%D9%8A%D9%87%D8%A7%D8%B1%D9%8A-2","20240717213613"],[752,"%D8%AD%D9%82%D9%8A%D9%82%D8%A9-%D8%A7%D9%84%D8%AB%D8%A7%D9%84%D8%AB","20240905145511"],[753,"%D9%88%D8%AC%D9%87%D8%A9-%D9%86%D8%B8%D8%B1-%D8%A7%D8%AE%D8%B1%D9%89","20240717214045"],[754,"%D9%85%D8%AE%D8%AA%D8%A7%D8%B1-%D8%A7%D9%84%D8%AD%D9%82%D9%8A%D9%82%D8%A9-%D8%B1%D9%88%D8%A8%D9%8A%D9%86-%D8%A8%D9%88%D8%B1%D8%AA%D9%88%D9%86","20240717124922"],[755,"%D8%A7%D9%84%D8%B7%D8%A7%D8%B9%D9%88%D9%86","20240905135339"],[756,"%d8%b4%d8%a6-%d9%84%d8%a7-%d9%8a%d8%ac%d8%a8-%d8%a7%d9%86-%d9%8a%d8%ad%d8%af%d8%ab",""],[757,"%D8%A8%D8%B0%D8%B1%D8%A9","20240718025046"],[758,"%D9%87%D9%8A%D9%84%D9%8A%D9%86","20240718013318"],[759,"%D9%85%D8%B5%D9%81%D9%88%D9%81%D8%A9-%D8%AE%D8%AA%D9%85-%D8%A7%D9%84%D8%B3%D9%85%D8%A7%D8%A1-%D8%A7%D9%84%D8%B9%D9%85%D9%84%D8%A7%D9%82%D8%A9","20240718085427"],[760,"%D8%AD%D8%B1%D8%A8-%D8%B9%D9%84%D9%89-%D8%A7%D9%84%D8%A7%D8%A8%D9%88%D8%A7%D8%A8","20240912013937"],[761,"%D8%A7%D9%84%D8%AC%D9%8A%D9%86%D8%B1%D8%A7%D9%84-%D8%A7%D9%84%D8%A7%D8%B9%D9%84%D9%89","20240912190345"],[762,"%D9%85%D8%B9%D8%B1%D9%83%D8%A9-%D8%A7%D9%84%D8%AC%D9%8A%D9%86%D8%B1%D8%A7%D9%84%D8%A7%D8%AA","20250119140046"],[763,"%D9%86%D9%83%D8%AA%D8%A9","20250119140843"],[764,"%D8%AC%D8%AF%D8%A7%D8%B1","20250123152803"],[765,"%D9%81%D8%AE-%D8%A7%D9%84%D9%85%D9%88%D8%AA","20240912200915"],[766,"%d9%81%d8%a3%d9%84-%d8%a7%d9%84%d8%ad%d9%82",""],[767,"%D8%A7%D9%84%D9%85%D8%B3%D8%AD-%D8%A7%D9%84%D9%85%D9%85%D9%86%D9%87%D8%AC","20240717060208"],[768,"%D8%B1%D8%A8%D9%85%D8%A7-%D9%83%D9%84-%D8%B4%D8%A6-%D8%B3%D9%8A%D9%83%D9%88%D9%86-%D8%B9%D9%84%D9%89-%D9%85%D8%A7-%D9%8A%D8%B1%D8%A7%D9%85","20240912220125"],[770,"%D9%85%D8%B2%D8%B9%D8%AC","20240718050443"],[771,"%D8%A8%D8%B5%D9%85%D8%A9-%D8%A8%D9%8A%D9%88%D9%86","20250119155014"],[772,"%D9%84%D8%AF%D9%8A%D9%86%D8%A7-%D8%A7%D9%84%D9%82%D9%88%D8%A9","20241228093346"],[773,"%D8%A7%D9%84%D9%82%D9%84%D8%B9%D8%A9-%D8%A7%D9%84%D8%B7%D8%A7%D8%A6%D8%B1%D8%A9","20250119155959"],[774,"%D8%A7%D9%84%D9%85%D8%B4%D8%B1%D9%88%D8%B9","20240912191905"],[775,"%D8%B1%D9%81%D8%B6","20241118064410"],[776,"%D9%85%D9%88%D9%82%D9%81-%D8%AC%D8%A7%D8%A8%D8%A7","20240718035437"],[777,"%D8%A7%D9%84%D8%AC%D9%8A%D9%86%D8%B1%D8%A7%D9%84-%D8%A7%D9%84%D9%85%D9%86%D8%B3%D9%8A","20240718005714"],[778,"%D8%A7%D9%84%D9%85%D8%B9%D8%B1%D9%83%D8%A9-%D8%A7%D9%84%D8%A7%D8%B1%D8%B6%D9%8A%D8%A9-%D8%A7%D9%84%D8%AB%D8%A7%D9%86%D9%8A%D8%A9","20240912191106"],[779,"%D9%82%D8%AA%D8%A7%D9%84-%D8%B3%D9%88%D9%84%D9%8A-%D8%A7%D9%84%D8%A7%D8%AE%D9%8A%D8%B1","20260606021304"],[780,"%D8%AF%D8%B9%D9%85-%D8%A7%D9%84%D8%B4%D9%85%D8%A7%D9%84","20240717122853"],[781,"%D9%88%D9%82%D8%A7%D8%AD%D8%A9","20250119171849"],[782,"%D8%B9%D9%84%D9%85-%D8%A7%D9%84%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1%D9%8A%D8%A9-%D9%8A%D8%B1%D8%AA%D9%81%D8%B9-%D9%85%D9%86-%D8%AC%D8%AF%D9%8A%D8%AF","20240913001708"],[783,"%D8%A5%D8%B3%D8%AA%D9%84%D8%A7%D9%85-%D8%A7%D9%84%D8%B2%D9%85%D8%A7%D9%85","20240913002413"],[784,"%D8%B5%D9%88%D8%AA-%D8%A7%D9%84%D8%AA%D8%BA%D9%8A%D9%8A%D8%B1","20240717052639"],[785,"%D8%AA%D9%83%D8%B3%D8%B1","20240912213613"],[786,"%D8%A7%D9%84%D8%A7%D8%AA%D8%AC%D8%A7%D9%87-%D8%A7%D9%84%D9%88%D8%AD%D9%8A%D8%AF-%D8%A7%D9%84%D9%85%D8%B3%D9%85%D9%88%D8%AD","20240913103620"],[787,"%D8%AD%D8%A7%D9%81%D8%A9-%D8%A7%D9%84%D9%84%D8%A7%D8%B9%D9%88%D8%AF%D8%A9","20240912203557"],[788,"%D9%81%D8%B1%D8%B5%D8%A9-%D8%A7%D8%AE%D9%8A%D8%B1%D8%A9","20240721100240"],[789,"%d8%b7%d9%8f%d8%b9%d9%85",""],[790,"%D9%85%D8%A3%D8%AF%D8%A8%D8%A9","20240912214035"],[791,"%D9%84%D8%A7-%D9%85%D8%AC%D8%A7%D9%84-%D9%84%D9%84%D8%AE%D8%B7%D8%A3","20240716132144"],[792,"%D9%82%D8%B1%D8%A7%D8%B1-%D8%B1%D9%8A%D8%AA%D8%B4%D8%A7%D8%B1%D8%AF","20240807002825"],[793,"%D8%AA%D8%AF%D9%85%D9%8A%D8%B1-%D9%85%D8%AF%D9%8A%D9%86%D8%A9-%D9%8A%D9%88%D8%B1%D8%A7","20240712165525"],[794,"%D8%A7%D8%A8%D9%86%D8%A7%D8%A1-%D9%8A%D9%88%D8%B1%D8%A7","20240712173842"],[795,"%D8%A7%D9%86%D9%81%D8%B5%D8%A7%D9%85","20240712181246"],[796,"%D8%A7%D9%86%D9%81%D8%B5%D8%A7%D9%85-2","20240712174531"],[797,"%D9%85%D8%B9%D8%B6%D9%84%D8%A9","20240712173542"],[798,"%D8%A7%D9%84%D8%BA%D8%B2%D9%88-%D8%B9%D9%84%D9%89-%D9%8A%D9%88%D8%B1%D8%A7","20240712175116"],[799,"%D9%88%D9%84%D9%8A-%D8%A7%D9%84%D8%B9%D9%87%D8%AF","20240712173928"],[800,"%D8%AC%D9%8A%D8%B4-%D8%A7%D9%84%D8%B1%D8%AC%D9%84-%D8%A7%D9%84%D9%88%D8%A7%D8%AD%D8%AF","20240712164224"],[801,"%D8%A7%D8%B3%D8%AA%D9%8A%D9%82%D8%A7%D8%B8","20240715232807"],[802,"%D8%A7%D8%AE%D8%A8%D8%A7%D8%B1-%D9%85%D9%86-%D8%A7%D9%84%D8%AC%D9%86%D9%88%D8%A8","20240712170306"],[803,"%D8%AF%D9%85-%D8%A7%D9%84%D9%8A%D8%AA%D9%8A%D9%85","20240712172000"],[804,"%D8%AB%D9%84%D8%A7%D8%AB%D8%A9-%D8%A7%D8%AD%D8%B2%D8%A7%D8%A8","20240712202913"],[805,"%D8%B1%D8%B3%D8%A7%D9%84%D8%A9-%D9%85%D9%86-%D9%88%D9%84%D9%8A-%D8%A7%D9%84%D8%B9%D9%87%D8%AF","20240713230758"],[806,"%D8%A7%D9%84%D8%A7%D8%AE%D8%A8%D8%A7%D8%B1-%D8%A7%D9%84%D8%B3%D9%8A%D8%A6%D8%A9-%D9%84%D8%A7-%D8%AA%D8%A3%D8%AA%D9%8A-%D9%81%D8%B1%D8%A7%D8%AF%D9%89","20240715050110"],[807,"%D8%AC%D9%86%D9%88%D9%86-%D8%A7%D9%8A%D9%81%D8%B1%D8%AC%D8%B1%D9%8A%D9%86","20240717010542"],[808,"%D9%81%D9%84%D9%86%D9%84%D8%B9%D8%A8-%D8%A7%D8%B0%D8%A7%D9%8B","20240717135630"],[809,"%D9%88%D8%B5%D9%88%D9%84-%D8%A7%D9%84%D8%AF%D8%B9%D9%85","20240718220859"],[810,"%D8%A7%D9%84%D8%B9%D8%A7%D8%B5%D9%85%D8%A9-%D8%A7%D9%84%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1%D9%8A%D8%A9","20240719230114"],[812,"%D8%B3%D9%82%D9%88%D8%B7-%D8%A7%D9%84%D8%B9%D8%A7%D8%B5%D9%85%D8%A9","20240723184543"],[813,"%D9%88%D8%B5%D9%88%D9%84","20240724204550"],[814,"%D9%85%D8%AC%D8%AF%D8%AF%D8%A7%D9%8B","20240726000534"],[815,"%D8%A7%D9%84%D8%BA%D8%B6%D8%A8-%D8%A7%D9%84%D8%B5%D8%A7%D9%85%D8%AA","20240727222107"],[817,"%D9%82%D8%AA%D8%A7%D9%84-%D8%A7%D9%84%D9%85%D8%A7%D8%B1%D8%B4%D8%A7%D9%84%D9%8A%D9%86","20240915134636"],[818,"%D8%A7%D9%84%D8%B9%D8%A7%D8%A6%D9%84%D8%A9-%D8%A7%D9%84%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1%D9%8A%D8%A9","20240730232043"],[819,"%D8%A7%D8%B4%D8%AA%D8%B9%D8%A7%D9%84-%D9%85%D8%B9%D8%B1%D9%83%D8%A9-%D8%A7%D9%84%D9%85%D8%AF%D9%8A%D9%86%D8%A9","20240731035454"],[820,"%D8%B5%D9%90%D8%AF%D8%A7%D9%85-%D9%82%D9%88%D8%A9","20240731032959"],[821,"%D9%83%D8%B3%D8%B1-%D8%A7%D9%84%D8%B9%D9%87%D8%AF","20240802022931"],[822,"%D8%A7%D9%84%D8%AC%D9%8A%D9%86%D8%B1%D8%A7%D9%84-%D8%A7%D9%84%D8%A7%D8%B9%D9%84%D9%89-%D9%8A%D9%86%D8%B6%D9%85-%D9%84%D9%84%D9%85%D8%B9%D8%B1%D9%83%D8%A9","20240731233210"],[823,"%D9%84%D9%87%D8%A8-%D8%A7%D9%84%D9%85%D9%88%D8%AA","20240731234743"],[824,"%D8%AC%D9%86%D9%88%D9%86-%D8%A7%D9%84%D8%AC%D9%8A%D9%86%D8%B1%D8%A7%D9%84-%D8%A7%D9%84%D8%A7%D8%B9%D9%84%D9%89","20240803122758"],[825,"%D8%AE%D8%A7%D8%AA%D9%85%D8%A9-%D9%85%D8%B9%D8%B1%D9%83%D8%A9-%D8%A7%D9%84%D8%B9%D8%A7%D8%B5%D9%85%D8%A9","20240801014035"],[826,"%D8%A7%D9%86%D8%AA%D9%87%D8%A7%D8%A1-%D8%A7%D9%84%D9%85%D8%B7%D8%A7%D8%B1%D8%AF%D8%A9","20240804131738"],[827,"%D8%AA%D8%BA%D9%8A%D9%8A%D8%B1-%D9%81%D9%8A-%D8%A7%D9%84%D8%AE%D8%B7%D8%A9","20240804220705"],[828,"%D8%B9%D8%B2%D9%8A%D8%B2-%D9%82%D9%88%D9%85%D9%8D-%D8%B0%D9%8F%D9%84","20240806142352"],[829,"%D9%83%D8%B3%D8%B1-%D8%A7%D9%84%D9%82%D9%8A%D9%88%D8%AF","20240805231046"],[830,"%D9%85%D8%A7-%D9%82%D8%A8%D9%84-%D8%A7%D9%84%D8%B9%D8%A7%D8%B5%D9%81%D8%A9","20240807225829"],[831,"%D8%B6%D8%AD%D9%83","20240808222143"],[832,"%D8%A7%D9%84%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1-%D8%A7%D9%84%D9%83%D9%88%D9%83%D8%A8%D9%8A-%D8%B1%D9%88%D8%A8%D9%8A%D9%86-%D8%A8%D9%88%D8%B1%D8%AA%D9%88%D9%86","20240809235822"],[833,"%D8%A7%D9%86%D9%82%D9%84%D8%A7%D8%A8-%D8%A7%D9%84%D8%B3%D8%AD%D8%B1-%D8%B9%D9%84%D9%89-%D8%A7%D9%84%D8%B3%D8%A7%D8%AD%D8%B1","20240809205712"],[834,"%D9%82%D9%81%D8%B2-%D9%85%D9%86-%D8%A7%D9%84%D9%85%D9%82%D9%84%D8%A7%D8%A9-%D9%81%D9%88%D9%82%D8%B9-%D8%B9%D9%84%D9%89-%D8%A7%D9%84%D9%86%D8%A7%D8%B1","20240811222747"],[835,"%D8%A7%D9%84%D8%B9%D9%88%D8%AF%D8%A9-%D9%84%D9%84%D8%AF%D9%8A%D8%A7%D8%B1","20240811221433"],[836,"%D8%A7%D9%86%D8%B3%D8%AD%D8%A7%D8%A8-%D8%AA%D9%83%D8%AA%D9%8A%D9%83%D9%8A","20240812212042"],[837,"%D8%A7%D9%84%D9%85%D9%87%D9%85%D8%A9-%D8%A7%D9%84%D8%AA%D8%A7%D9%84%D9%8A%D8%A9","20240813184835"],[838,"%D8%B7%D9%84%D8%A8-%D8%B1%D9%8A%D8%AA%D8%B4%D8%A7%D8%B1%D8%AF","20240816005029"],[839,"%D8%B9%D9%88%D8%AF%D8%A9-%D8%A7%D9%84%D9%87%D8%AF%D9%81","20240817203524"],[840,"%D8%B1%D9%88%D8%AD-%D9%83%D9%88%D9%83%D8%A8-%D9%8A%D9%88%D8%B1%D8%A7","20240819025027"],[841,"%D8%A7%D9%84%D9%85%D8%AC%D8%AF-%D9%88-%D8%A7%D9%84%D9%83%D8%A7%D8%B1%D8%AB%D8%A9","20240820000036"],[842,"%D9%85%D8%B5%D9%8A%D8%B1-%D9%8A%D9%88%D8%B1%D8%A7","20241120225055"],[843,"%D9%85%D8%A7%D9%84%D9%83-%D9%8A%D9%88%D8%B1%D8%A7","20240903190104"],[844,"%D8%AA%D8%AC%D9%85%D8%B9-%D8%A7%D9%84%D8%AC%D9%8A%D9%86%D8%B1%D8%A7%D9%84%D8%A7%D8%AA","20240905061818"],[845,"%D8%B9%D8%A7%D9%85%D9%84-%D8%A7%D9%84%D8%AD%D8%B3%D9%85","20240907002322"],[846,"%D8%B1%D9%82%D8%B9%D8%A9-%D9%86%D9%8A%D9%87%D8%A7%D8%B1%D9%8A","20240911114611"],[847,"%D8%A7%D9%84%D8%B1%D9%82%D8%B9%D8%A9-%D8%A7%D9%84%D8%AE%D8%B6%D8%B1%D8%A7%D8%A1-%D9%88-%D8%A7%D9%84%D8%B1%D9%82%D8%B9%D8%A9-%D8%A7%D9%84%D8%AD%D9%85%D8%B1%D8%A7%D8%A1","20240913021527"],[849,"%D9%8A%D9%88%D8%B1%D9%8A-%D8%A7%D9%84%D9%84%D8%B7%D9%8A%D9%81%D8%A9","20240828011247"],[850,"%D9%85%D9%84%D9%83-%D8%A7%D9%84%D9%88%D8%AD%D9%88%D8%B4","20240918122109"],[851,"%D9%81%D8%B1%D8%B5%D8%A9-%D8%A7%D8%AE%D8%B1%D9%89","20240828205041"],[852,"%D9%85%D8%B9%D8%B1%D9%83%D8%A9-%D8%A7%D9%84%D8%B4%D9%85%D8%A7%D9%84","20240919020907"],[853,"%D8%A7%D8%B3%D8%AA%D8%A6%D8%B5%D8%A7%D9%84-%D8%A7%D9%84%D9%88%D8%B1%D9%85","20240925113448"],[854,"%D8%A7%D8%A7%D9%84%D9%83%D8%A7%D8%B1%D9%87%D9%90-%D8%A7%D9%84%D8%A7%D9%83%D8%A8%D8%B1","20240831172913"],[855,"%D9%83%D9%88%D9%83%D8%A8-%D8%A7%D9%84%D8%AC%D8%AD%D9%8A%D9%85-%D8%A7%D9%84%D8%AB%D9%86%D8%A7%D8%A6%D9%8A","20240925150915"],[856,"%D9%85%D9%87%D9%85%D8%A9-%D9%81%D9%8A-%D8%B9%D8%A7%D9%84%D9%85-%D8%A7%D8%AE%D8%B1","20240924044838"],[857,"%D8%A7%D9%88%D9%84-%D8%AA%D9%88%D8%A7%D8%B5%D9%84","20241008134129"],[858,"%D9%82%D9%81-%D8%A8%D8%AC%D8%A7%D9%86%D8%A8%D9%8A","20240902210200"],[859,"%D9%85%D9%88%D8%A7%D8%AC%D9%87%D8%A9-%D8%A7%D9%84%D8%AC%D9%8A%D9%86%D8%B1%D8%A7%D9%84-%D8%A7%D9%84%D8%A7%D9%88%D9%84","20240904014240"],[860,"%D8%A8%D8%AF%D8%A3-%D8%A7%D9%84%D9%84%D8%B9%D8%A8%D8%A9-%D8%A7%D9%84%D8%B0%D9%87%D9%86%D9%8A%D8%A9","20240903220911"],[861,"%D9%88%D9%82%D8%AA-%D8%A7%D9%84%D8%B6%D9%8A%D9%82","20241027074539"],[862,"%D9%82%D9%88%D8%A9-%D8%A7%D9%84%D8%B9%D9%81%D8%A7%D8%B1%D9%8A%D8%AA","20240905225124"],[863,"%D8%AE%D9%84%D9%82-%D9%84%D9%8A%D9%82%D8%A7%D8%AA%D9%84","20241108161009"],[864,"%D9%85%D8%B3%D8%AD","20240906222406"],[865,"%D8%A7%D8%AD%D9%88%D8%A7%D9%84-%D9%83%D9%88%D9%83%D8%A8-%D8%AC%D9%88%D8%AF%D8%A7","20240908000451"],[866,"%D8%AF%D9%8A%D9%81%D9%88%D8%B3-%D8%A7%D9%84%D9%85%D8%AA%D8%B9%D8%A7%D9%84%D9%8A","20240909032433"],[867,"%D8%AA%D8%B1%D9%82%D9%8A%D8%A9-%D8%A7%D9%84%D8%B9%D9%90%D8%B1%D9%82","20240909003931"],[868,"%D8%B9%D8%A7%D9%84%D9%85%D9%86%D8%A7-%D9%85%D8%AE%D8%AA%D9%84%D9%81%D8%A7%D9%86","20241115153711"],[869,"%D8%AC%D8%AD%D9%8A%D9%85-%D9%84%D9%84%D8%A3%D9%87%D9%84-%D9%86%D8%B9%D9%8A%D9%85-%D9%84%D9%84%D8%A3%D8%BA%D8%B1%D8%A7%D8%A8","20240910233253"],[870,"%D8%B9%D9%90%D8%B2%D8%A9-%D8%A7%D9%84%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1","20241115203514"],[871,"%D8%AA%D9%82%D9%86%D9%8A%D8%A9-%D9%85%D9%84%D8%A6-%D8%A7%D9%84%D8%B1%D9%88%D8%AD","20240912005045"],[872,"%D8%A5%D8%AF%D8%B1%D8%A7%D9%83-%D8%A7%D9%84%D9%85%D9%82%D8%A7%D9%85","20240911225707"],[873,"%D9%83%D9%88%D9%83%D8%A8-%D8%AC%D8%B1%D9%8A%D9%86%D9%84%D8%A7%D9%86%D8%AF-%D8%A7%D9%84%D8%BA%D8%B1%D9%8A%D8%A8","20241116210638"],[874,"%D8%A7%D8%B3%D9%84%D9%88%D8%A8-%D8%A8%D9%8A%D9%88%D9%86","20240914223454"],[875,"%D8%AC%D9%88%D9%87%D8%B1-%D8%A7%D9%84%D8%B7%D8%A7%D9%82%D8%A9","20240915203551"],[876,"%D8%B1%D8%AC%D9%84-%D9%84%D8%B1%D8%AC%D9%84","20240915202421"],[877,"%D9%84%D8%A7-%D8%AA%D8%AA%D8%AD%D8%AF%D8%AB-%D8%B9%D9%86-%D9%85%D9%85%D8%AA%D9%84%D9%83%D8%A7%D8%AA%D9%8A","20240916233436"],[878,"%D8%B9%D8%A8%D8%AB","20240916210300"],[879,"%D9%86%D8%B3%D9%8A%D8%AC-%D8%A7%D9%84%D8%B2%D9%85%D9%83%D8%A7%D9%86","20260612052225"],[880,"%D8%B8%D9%87%D9%88%D8%B1-%D9%81%D9%8A-%D8%A7%D9%84%D9%85%D9%88%D8%B7%D9%86","20241118173800"],[881,"%D8%A7%D9%84%D9%82%D8%AA%D8%A7%D9%84-%D9%83%D9%85%D8%A7%D9%84%D9%90%D9%83","20241118094910"],[882,"%D8%A7%D8%BA%D8%B1%D8%A8%D9%88%D8%A7-%D8%B9%D9%86-%D9%85%D9%85%D8%AA%D9%84%D9%83%D8%A7%D8%AA%D9%8A","20240917211718"],[883,"%D9%86%D9%87%D8%A7%D9%8A%D8%A9-%D9%85%D8%A7%D8%B1%D8%B4%D8%A7%D9%84","20240917211902"],[884,"%D8%A7%D9%84%D9%86%D8%B5%D8%B1-%D8%A7%D9%84%D8%A7%D9%88%D9%84","20240918204534"],[885,"%D8%AD%D8%A7%D9%84%D8%A9-%D9%83%D9%88%D9%83%D8%A8-%D9%8A%D9%88%D8%B1%D8%A7","20240919011914"],[886,"%D9%85%D8%AD%D8%A7%D8%AF%D8%AB%D8%A9-%D8%A8%D9%8A%D9%86-%D8%A7%D9%84%D9%82%D8%A7%D8%AF%D8%A9","20240920011246"],[887,"%D8%AE%D8%B7%D8%A9-%D8%A7%D9%84%D9%8A%D9%83%D8%B3%D8%A7%D9%86%D8%AF%D8%B1","20240920152630"],[888,"%D8%AC%D8%B1%D9%8A%D9%86%D9%84%D8%A7%D9%86%D8%AF-%D9%85%D8%A7-%D8%A8%D8%B9%D8%AF-%D8%A7%D9%84%D8%B9%D8%A7%D8%B5%D9%81%D8%A9","20240920193223"],[889,"%D8%A7%D9%84%D8%B1%D9%88%D8%AD-%D8%A7%D9%84%D9%85%D8%A8%D8%AF%D8%A6%D9%8A%D8%A9","20240920193242"],[890,"%D8%A2%D9%84%D8%A7%D9%85-%D8%A7%D9%84%D8%B4%D9%85%D8%A7%D9%84","20240921193953"],[891,"%D8%A7%D9%84%D8%B7%D8%B1%D9%8A%D9%82-%D9%84%D9%84%D8%B3%D9%8A%D8%B7%D8%B1%D8%A9-%D8%B9%D9%84%D9%89-%D9%86%D9%8A%D9%87%D8%A7%D8%B1%D9%8A","20240921193941"],[892,"%D9%87%D9%90%D9%85%D8%A9-%D8%B3%D8%A7%D9%83%D8%A7%D8%B1","20240923033300"],[893,"%D8%AA%D8%BA%D9%8A%D9%8A%D8%B1-%D9%81%D9%8A-%D8%A7%D9%84%D8%AC%D9%86%D9%88%D8%A8","20240923080602"],[894,"%D8%A7%D9%84%D8%B3%D9%83%D8%A7%D9%86-%D8%A7%D9%84%D8%A7%D8%B5%D9%84%D9%8A%D9%8A%D9%86-%D9%84%D8%AC%D9%88%D8%AF%D8%A7","20240923200127"],[895,"%D8%A7%D9%84%D9%85%D9%82%D8%A7%D8%A8%D9%84","20240923200229"],[896,"%D8%A7%D8%B1%D8%B6%D9%8A%D8%A9","20240924201023"],[897,"%D8%AD%D9%82%D9%84-%D8%A7%D9%84%D8%AC%D9%84%D9%8A%D8%AF","20240924201000"],[898,"%D8%A7%D8%AA%D9%81%D8%A7%D9%82","20240925212453"],[899,"%D8%A8%D9%86%D8%AF-%D8%A7%D8%B6%D8%A7%D9%81%D9%8A","20240925212422"],[900,"%D8%A7%D9%84%D9%82%D8%A7%D8%A6%D8%AF-%D8%A7%D9%84%D8%B9%D8%B3%D9%83%D8%B1%D9%8A-%D8%B3%D8%A7%D9%83%D8%A7%D8%B1","20240925212622"],[901,"%D9%86%D8%AD%D9%88-%D8%A7%D9%84%D8%AC%D9%86%D9%88%D8%A8","20240926215324"],[902,"%D8%A8%D8%AD%D8%B1-%D8%A7%D9%84%D8%AF%D9%85","20240927005119"],[903,"%D8%A7%D9%84%D9%83%D9%85-%D9%88-%D8%A7%D9%84%D8%AC%D9%88%D8%AF%D8%A9","20240926212258"],[904,"%D8%A8%D9%88%D8%A7%D8%A8%D8%A9-%D8%A7%D9%84%D8%AC%D9%86%D9%88%D8%A8","20240927064005"],[905,"%D8%AA%D8%B9%D8%B2%D9%8A%D8%B2%D8%A7%D8%AA-%D8%AC%D8%A7%D9%87%D9%84%D8%A9","20240927211413"],[906,"%D9%86%D9%87%D8%A7%D9%8A%D8%A9-%D9%85%D8%A3%D8%B3%D8%A7%D9%88%D9%8A%D8%A9","20240927220040"],[907,"%D9%82%D8%B1%D8%A7%D8%B1-%D8%B3%D8%A7%D9%83%D8%A7%D8%B1","20240928160746"],[908,"%D9%81%D9%83%D8%B1%D8%A9-%D8%B1%D9%88%D8%A8%D9%8A%D9%86","20240928211821"],[909,"%D8%B1%D8%B3%D8%A7%D9%84%D8%A9-%D9%85%D8%B1%D8%B9%D8%A8%D8%A9","20240928223359"],[910,"%D8%B5%D8%AF%D9%85%D8%A7%D8%AA-%D9%85%D8%AA%D8%AA%D8%A7%D9%84%D9%8A%D8%A9","20240929214712"],[911,"%D9%85%D8%B1%D8%A7%D8%AF-%D8%B3%D8%A7%D9%83%D8%A7%D8%B1","20240930023635"],[912,"%D8%AE%D8%B7%D8%A9-%D8%B9%D9%84%D9%89-%D9%85%D8%B3%D8%A7%D8%AD%D8%A9-%D9%83%D9%88%D9%83%D8%A8","20240929225940"],[913,"%D9%81%D8%B1%D9%85%D8%A7%D9%86","20240930102207"],[914,"%D8%A7%D9%84%D8%A7%D9%85%D8%B1-%D8%B1%D8%B3%D9%85%D9%8A","20240930201935"],[915,"%D8%B2%D8%B9%D9%85%D8%A7%D8%A1-%D8%A7%D9%84%D8%A3%D9%85%D9%85","20241001010702"],[916,"%D8%A8%D9%83%D8%A7%D8%A1-%D8%A8%D8%AF%D9%88%D9%86-%D8%AF%D9%85%D9%88%D8%B9","20241003100600"],[917,"%D8%A7%D8%AA%D9%81%D8%A7%D9%82-%D9%84%D8%A7-%D9%8A%D9%85%D9%83%D9%86-%D8%B1%D8%AF%D9%87","20241002204405"],[918,"%D8%A7%D9%84%D8%B9%D9%85%D9%84-%D8%A7%D9%84%D9%85%D9%85%D8%AA%D8%B9-%D8%A7%D9%84%D9%82%D8%B0%D8%B1","20241003232423"],[919,"%D8%A7%D9%84%D9%85%D9%84%D9%83","20241003231410"],[920,"%D8%A7%D9%84%D8%B3%D9%85%D8%A7%D8%B9-%D8%B9%D9%86-%D8%A7%D9%84%D9%85%D9%88%D9%84%D9%89","20241020232254"],[921,"%D8%A7%D9%84%D9%85%D8%B3%D8%A4%D9%88%D9%84%D9%8A%D8%A9","20241104174602"],[922,"%D8%AE%D9%8A%D8%A7%D8%B1%D9%8A%D9%86","20241007113137"],[923,"%D8%AD%D8%A7%D9%84%D8%A9-%D8%A7%D9%84%D8%AD%D8%B1%D8%A8-1","20241008222038"],[924,"%D8%AD%D8%A7%D9%84%D8%A9-%D8%A7%D9%84%D8%AD%D8%B1%D8%A8-2","20241104183941"],[925,"%D8%B4%D9%85%D8%B3-%D8%AF%D9%8A%D8%B3%D8%AA%D8%B1%D8%A7","20241104181547"],[926,"%D8%A7%D9%84%D8%A7%D8%B4%D9%82%D8%A7%D8%A1-%D8%A7%D9%84%D8%A7%D8%B1%D8%A8%D8%B9%D8%A9","20241103030348"],[927,"%D8%A7%D9%84%D8%B9%D8%A7%D8%A6%D9%84%D8%A9-%D8%A7%D9%84%D9%85%D9%8E%D8%AC%D8%B1%D9%8A%D8%A9","20241020220429"],[928,"%D8%B1%D9%87%D8%A7%D9%86-%D8%B9%D9%84%D9%89-%D9%83%D9%84-%D8%B4%D8%A6","20241108105354"],[929,"%D9%84%D9%87%D8%A8-%D8%A7%D9%84%D9%85%D8%B7%D9%87%D8%B1","20241021154406"],[930,"%D8%B1%D8%A3%D8%B3-%D8%A7%D9%84%D8%AF%D8%AC%D8%A7%D8%AC%D8%A9","20241023184919"],[931,"%D8%B9%D9%88%D8%AF%D8%A9-%D8%A7%D9%84%D8%AC%D9%8A%D9%86%D8%B1%D8%A7%D9%84-%D8%A7%D9%84%D8%A7%D8%B9%D9%84%D9%89-%D9%84%D9%84%D8%AC%D9%8A%D8%B4-%D8%A7%D9%84%D8%A7%D9%88%D9%84","20241022184219"],[932,"%D8%A7%D8%AC%D8%AA%D9%85%D8%A7%D8%B9-%D8%AC%D9%8A%D9%86%D8%B1%D8%A7%D9%84%D8%A7%D8%AA-%D9%8A%D9%88%D8%B1%D8%A7","20241108101410"],[933,"%D8%AA%D9%88%D8%B2%D9%8A%D8%B9-%D8%A7%D9%84%D9%82%D9%88%D8%A7%D8%AA","20241021000944"],[934,"%D8%AA%D8%AF%D9%85%D9%8A%D8%B1","20241023092301"],[935,"%D8%AD%D8%B1%D8%A8-%D8%A7%D9%84%D8%B3%D8%A8%D8%B9-%D9%83%D9%88%D8%A7%D9%83%D8%A8-1","20241020213812"],[936,"%D8%AD%D8%B1%D8%A8-%D8%A7%D9%84%D8%B3%D8%A8%D8%B9-%D9%83%D9%88%D8%A7%D9%83%D8%A8-2","20241020191658"],[937,"%D8%AA%D9%81%D8%B9%D9%8A%D9%84-%D9%85%D9%81%D8%A7%D8%AC%D8%A6","20241020183657"],[938,"%D8%A7%D9%84%D8%A7%D8%A8-%D9%88-%D8%B3%D9%84%D8%A7%D9%84%D8%AA%D9%87","20241021211135"],[939,"%D8%AA%D8%A7%D8%B1%D9%8A%D8%AE-%D8%AF%D9%85-%D8%A7%D9%84%D9%8A%D8%AA%D9%8A%D9%85","20241022193756"],[940,"%D8%AD%D9%82%D9%8A%D9%82%D8%A9-%D8%A2%D8%B1%D9%88","20241022194240"],[941,"%D9%85%D8%B5%D9%8A%D8%B1-%D8%A2%D8%B1%D9%88","20241023184351"],[942,"%D8%B1%D8%B3%D8%A7%D9%84%D8%AA%D9%8A%D9%86","20241023193129"],[943,"%D9%83%D8%B1%D8%A7%D8%AA-%D8%A7%D9%84%D8%B9%D9%86%D8%A7%D8%B5%D8%B1","20241024194715"],[944,"%D8%A7%D8%B4%D8%AE%D8%A7%D8%B5-%D9%85%D8%B1%D8%B9%D8%A8%D9%88%D9%86","20241025004608"],[945,"%D9%87%D9%88%D9%84%D8%A7%D9%83-%D9%88-%D8%A7%D9%84%D8%B8%D9%84","20241027054043"],[946,"%D9%85%D9%88%D8%B1%D9%8A%D9%86-%D9%88-%D8%A7%D9%84%D8%B8%D9%84","20241026180147"],[947,"%D8%B3%D8%A7%D9%83%D8%A7%D8%B1-%D9%88-%D8%A7%D9%84%D8%B8%D9%84","20241026222139"],[948,"%D9%83%D9%88%D9%83%D8%A8-%D8%AF%D9%85-%D8%A7%D9%84%D9%8A%D8%AA%D9%8A%D9%85-%D8%A7%D9%84%D8%AC%D8%AF%D9%8A%D8%AF","20241027215143"],[949,"%D9%81%D9%82%D8%AF%D8%A7%D9%86-%D9%83%D9%88%D9%83%D8%A8","20241028013346"],[950,"%D8%A7%D9%84%D9%81%D9%8A%D9%84-%D9%81%D9%8A-%D8%A7%D9%84%D8%BA%D8%B1%D9%81%D8%A9","20241028220714"],[951,"%D8%A7%D9%84%D8%AD%D8%B1%D8%A8-%D8%A7%D9%84%D9%85%D8%B9%D9%84%D9%88%D9%85%D8%A7%D8%AA%D9%8A%D8%A9-%D9%84%D8%B3%D9%8A%D9%88%D9%81-%D8%A7%D9%84%D8%B8%D9%84","20241028192351"],[952,"%D8%B6%D9%8A%D9%81-%D8%B9%D9%84%D9%89-%D9%8A%D9%88%D8%B1%D8%A7","20241029151603"],[953,"%D9%88%D8%A7%D8%AC%D8%A8-%D8%A7%D9%84%D8%B6%D9%8A%D8%A7%D9%81%D8%A9","20241029193629"],[954,"%D8%A3%D8%B5%D9%84%D8%AD%D9%87","20241030204820"],[955,"%D8%B1%D9%88%D8%AD-%D9%86%D9%82%D9%8A%D8%A9","20241031004220"],[956,"%D9%85%D8%AD%D8%A7%D8%AF%D8%AB%D8%A9-%D8%A8%D8%B1%D8%AC-%D8%A7%D9%84%D8%B4%D9%8A%D9%88%D8%AE","20241030194002"],[957,"%D8%AE%D9%88%D8%A7%D8%B7%D8%B1","20241031221443"],[958,"%D8%B5%D8%AE%D8%B1%D8%A9-%D8%A7%D9%84%D8%B3%D9%85-1","20241107015831"],[959,"%D8%B5%D8%AE%D8%B1%D8%A9-%D8%A7%D9%84%D8%B3%D9%85-2","20241104150914"],[960,"%D8%B1%D8%AF%D8%A9-%D8%A7%D9%84%D9%81%D8%B9%D9%84-%D8%A7%D9%84%D9%85%D9%86%D8%AA%D8%B8%D8%B1%D8%A9","20241104021321"],[961,"%D8%A7%D9%86%D8%AA%D9%82%D8%A7%D9%85","20241106202553"],[962,"%D9%85%D9%8A%D9%88%D9%84-%D8%B1%D9%88%D9%83%D9%8A","20241105214932"],[963,"%D8%B3%D9%8A%D8%A7%D8%AF%D8%A9-%D8%AC%D9%88%D9%8A%D8%A9","20241106192224"],[964,"%D8%A3%D8%B1-1","20241107174238"],[965,"%D8%AF%D9%86%D9%8A%D8%A7-%D8%A7%D9%84%D8%A7%D9%82%D8%B2%D8%A7%D9%85","20241108193045"],[966,"%D8%A7%D9%84%D9%83%D9%88%D9%83%D8%A8-%D8%A3%D8%B1-2","20241109195803"],[967,"%D8%A7%D9%84%D8%A7%D8%B3%D9%84%D9%88%D8%A8-%D8%A7%D9%84%D9%85%D9%8F%D8%AC%D8%AF%D9%8A","20241110192736"],[968,"%D8%A7%D9%84%D8%A7%D8%B3%D9%84%D9%88%D8%A8-%D8%A7%D9%84%D9%85%D9%8F%D8%AC%D8%AF%D9%8A-2","20241110192816"],[969,"%D8%AE%D8%B7%D8%A9%D8%9F","20241112185121"],[970,"%D9%83%D8%A7%D8%A8%D9%88%D8%B3","20241113184837"],[971,"%D8%AA%D8%BA%D9%8A%D9%8A%D8%B1-%D8%A7%D9%84%D9%86%D8%B8%D8%B1%D8%A9","20241115001327"],[972,"%D9%86%D8%B8%D8%B1%D8%A9-%D8%A8%D8%A7%D9%8A%D8%AB%D9%88%D8%B1","20241116190753"],[973,"%D8%B1%D8%AF-%D8%A7%D9%84%D8%AC%D9%85%D9%8A%D9%84","20241116191606"],[974,"%D8%AE%D9%8A%D8%A7%D8%B1%D8%A7%D8%AA-%D9%87%D9%88%D9%84%D8%A7%D9%83","20241119010457"],[975,"%D8%B1%D8%AF-%D8%A7%D9%84%D9%81%D8%B9%D9%84","20241119204135"],[976,"%D8%B1%D8%B3%D8%A7%D9%84%D8%A9-%D8%A8%D8%A7%D9%8A%D8%AB%D9%88%D8%B1","20241119211944"],[977,"%D8%A7%D8%B1%D8%A8%D8%B9%D8%A9-%D9%85%D8%B1%D8%A7%D9%81%D9%82%D9%8A%D9%86","20241119212255"],[978,"%D8%A7%D9%84%D8%AE%D8%B7%D8%A9-%D8%A7%D9%84%D9%85%D8%AC%D9%86%D9%88%D9%86%D8%A9","20241121212407"],[979,"%D8%B9%D8%B2%D9%85","20241123193946"],[980,"%D8%AA%D8%AD%D8%B1%D9%83-%D8%AF%D9%88%D8%B1%D8%BA%D8%B1","20241124201531"],[981,"%D9%84%D8%B9%D8%A8%D8%A9-%D9%85%D8%A4%D9%82%D8%AA%D8%A9","20241124201526"],[982,"%D9%88%D8%B5%D9%88%D9%84-%D8%A7%D9%84%D8%AF%D8%B9%D9%85","20241126220743"],[983,"%D8%B6%D8%AD%D9%83%D8%A9","20241207173628"],[984,"%D8%AF%D8%AE%D9%8A%D9%84","20241207173521"],[985,"%D8%A7%D8%AE%D8%A8%D8%A7%D8%B1-%D8%A7%D9%84%D9%83%D9%88%D8%A7%D9%83%D8%A8","20241207184912"],[986,"%D8%B7%D9%84%D8%A8-%D8%A7%D9%84%D8%AF%D8%B9%D9%85","20241129230644"],[987,"%D8%AC%D9%87%D8%AA%D9%8A%D9%86-%D9%85%D9%86%D8%B3%D9%8A%D9%8A%D8%AA%D9%8A%D9%86","20241130194417"],[988,"%D8%A8%D8%A7%D9%8A%D8%AB%D9%88%D8%B1-%D8%A7%D9%84%D8%BA%D8%A7%D8%B6%D8%A8","20250528134156"],[989,"%D8%AE%D8%B7%D8%A9-%D8%B3%D8%A7%D9%83%D8%A7%D8%B1","20241130205621"],[990,"%D9%85%D8%B4%D9%87%D8%AF-%D9%85%D8%A3%D9%84%D9%88%D9%81","20250427141754"],[991,"%D8%A7%D9%82%D8%AD%D9%88%D8%A7%D9%86%D8%A9-%D9%88%D8%A7%D8%AD%D8%AF%D8%A9","20250610062544"],[992,"%D8%A7%D8%AE%D8%A8%D8%A7%D8%B1-%D8%B5%D8%A7%D8%AF%D9%85%D8%A9-%D9%85%D9%86-%D8%A7%D9%84%D8%AC%D9%86%D9%88%D8%A8","20241202201449"],[993,"%d8%a7%d9%84%d8%af%d8%b9%d9%85-%d9%88%d8%b5%d9%84","20250115181850"],[994,"%d9%85%d8%b9%d8%b1%d9%83%d8%a9-%d8%a7%d9%84%d8%b3%d8%a7%d8%ad%d8%a9","20250115181936"],[995,"%d8%a7%d9%84%d8%a7%d9%86%d8%b5%d8%a7%d9%84-%d8%a7%d9%84%d9%81%d8%b6%d9%8a%d8%a9","20250115182027"],[996,"%d9%82%d9%88%d8%a9-%d8%b1%d9%88%d8%a8%d9%8a%d9%86-%d8%a7%d9%84%d8%ac%d8%b3%d8%af%d9%8a%d8%a9","20250115182119"],[997,"%d9%85%d9%88%d8%a7%d8%ac%d9%87%d8%a9-130-%d8%ad%d8%a7%d8%b1%d8%b3-%d8%a7%d9%85%d8%a8%d8%b1%d8%a7%d8%b7%d9%88%d8%b1%d9%8a-%d9%88%d8%ad%d9%8a%d8%af%d8%a7%d9%8b","20250115184616"],[998,"%d8%aa%d8%ba%d9%8a%d9%8a%d8%b1-%d9%81%d9%8a-%d8%a7%d9%84%d9%85%d8%b9%d8%a7%d9%85%d9%84%d8%a9","20250115184757"],[999,"%d8%b4%d9%84%d8%a7%d9%84-%d9%85%d9%86-%d8%a7%d9%84%d8%ac%d8%ad%d9%8a%d9%85","20250115184846"],[1000,"%d8%ad%d8%b5%d8%a7%d8%b1-%d9%81%d9%88%d9%82-%d8%ad%d8%b5%d8%a7%d8%b1","20250115184928"],[1003,"%D9%81%D8%AE%D8%B1","20260606022308"],[1004,"%D9%84%D9%82%D8%A7%D8%A1-%D8%A7%D9%84%D9%85%D9%84%D9%83%D9%8A%D9%86","20260610180638"],[1005,"%D8%AE%D8%A7%D8%AA%D9%85%D8%A9","20250119220516"],[1006,"%D8%AD%D8%AF%D9%8A%D8%AB-%D9%85%D8%B9-%D9%85%D9%84%D9%83-%D8%A7%D9%84%D9%88%D8%AD%D9%88%D8%B4","20260606012830"],[1007,"%d8%ab%d9%84%d8%a7%d8%ab-%d8%ae%d9%8a%d8%a7%d8%b1%d8%a7%d8%aa",""],[1008,"%D9%86%D9%87%D8%A7%D9%8A%D8%A9-%D8%AD%D8%B1%D8%A8-%D8%A7%D9%84%D9%88%D8%AD%D9%88%D8%B4","20260606014023"],[1009,"%d8%ba%d9%86%d8%a7%d8%a6%d9%85-%d8%a7%d9%84%d9%83%d9%88%d9%83%d8%a8-%d8%a5%d8%b3-1",""],[1010,"%D9%85%D8%A2%D8%B1%D8%A8-%D8%A2%D8%B1%D9%88","20260612045645"],[1011,"%D8%AA%D8%B1%D9%83%D9%8A%D8%B2-%D8%A7%D9%84%D9%8A%D9%88%D9%85-%D8%A7%D9%84%D8%A7%D8%AE%D9%8A%D8%B1","20260612044149"],[1012,"%D9%82%D8%B6%D9%85%D8%A9","20241216161306"],[1013,"%D9%87%D8%AC%D9%88%D9%85-%D8%B9%D9%84%D9%89-%D8%AC%D9%8A%D8%B4-%D8%A8%D8%AF%D9%88%D9%86-%D9%82%D8%A7%D8%A6%D8%AF","20260612053239"],[1014,"%D8%A7%D9%84%D9%85%D9%84%D9%83%D8%A9-%D8%AA%D8%A7%D9%88","20260610182039"],[1015,"%D8%B8%D9%87%D9%88%D8%B1-%D8%A7%D9%84%D9%85%D8%AD%D8%AA%D9%88%D9%85","20260607224514"],[1016,"%D8%A7%D9%84%D8%A7%D8%B3%D9%84%D9%88%D8%A8-%D8%A7%D9%84%D9%85%D8%AC%D8%AF%D9%8A","20260610190826"],[1017,"%d9%82%d8%a8%d9%84-%d8%a7%d9%84%d8%aa%d9%81%d8%a7%d9%88%d8%b6",""],[1018,"%D8%AD%D8%A8%D8%B3-%D8%A7%D9%84%D8%A7%D9%86%D9%81%D8%A7%D8%B3","20260607224852"],[1019,"%D8%A8%D8%A7%D9%8A%D8%AB%D9%88%D8%B1-%D8%A7%D9%84%D9%81%D8%A7%D8%AA%D9%86","20260606020431"],[1020,"%D8%A7%D8%AD%D9%88%D8%A7%D9%84-%D9%86%D9%8A%D9%87%D8%A7%D8%B1%D9%8A-%D9%82%D8%A8%D9%8A%D9%84-%D8%A7%D9%84%D9%85%D9%81%D8%A7%D9%88%D8%B6%D8%A7%D8%AA","20260606022841"],[1021,"%D8%B8%D9%87%D9%88%D8%B1-%D8%B4%D8%A8%D8%AD","20260606011710"],[1022,"%D9%87%D8%AF%D9%88%D8%A1-%D8%A7%D9%84%D8%B9%D8%A7%D8%B5%D9%81%D8%A9-%D8%A7%D9%84%D8%AA%D8%B1%D8%A7%D8%A8%D9%8A%D8%A9","20260607233643"],[1023,"%D8%A7%D9%84%D8%B3%D8%A4%D8%A7%D9%84-%D8%B9%D9%86-%D8%A7%D9%84%D8%A7%D9%85%D9%88%D8%B1-%D8%A7%D9%84%D9%85%D9%87%D9%85%D8%A9","20260607224541"],[1024,"%D8%A7%D9%84%D8%AF%D9%84%D9%8A%D9%84-%D8%A7%D9%84%D8%B4%D8%A7%D9%81%D9%8A","20260612043816"],[1025,"%D9%86%D9%87%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D9%85%D9%81%D8%A7%D9%88%D8%B6%D8%A7%D8%AA","20260612050648"],[1026,"%d8%a5%d9%84%d8%aa%d8%ad%d8%a7%d9%85",""],[1027,"%d8%ab%d9%84%d8%a7%d8%ab%d8%a9-%d8%b6%d8%af-%d8%a7%d8%b1%d8%a8%d8%b9%d8%a9",""],[1028,"%D9%85%D8%AD%D9%88%D8%B1-%D8%A7%D9%84%D8%A5%D9%86%D8%AA%D8%A8%D8%A7%D9%87","20260606020856"],[1029,"%D9%86%D9%8A%D8%A9-%D9%82%D8%AA%D9%84-%D9%81%D9%8A-%D8%A7%D9%84%D8%A7%D8%AA%D8%AC%D8%A7%D9%87-%D8%A7%D9%84%D8%AE%D8%A7%D8%B7%D8%A6","20260606005657"],[1030,"%d8%aa%d9%88%d8%b3%d8%b7-%d8%b3%d8%a7%d9%83%d8%a7%d8%b1",""],[1031,"%D8%AD%D9%88%D8%A7%D8%B1-%D8%A8%D9%8A%D9%86-%D8%A7%D9%84%D9%86%D8%AF%D9%8A%D9%86","20260610175301"],[1032,"%D8%A7%D8%B3%D8%AA%D8%AF%D8%B9%D8%A7%D8%A1-%D8%A7%D9%84%D8%AC%D9%8A%D8%B4-%D8%A7%D9%84%D8%A7%D8%B1%D8%B6%D9%8A-%D9%84%D9%8A%D9%84%D8%A9-%D8%BA%D8%AF%D8%B1-%D8%A7%D9%84%D9%82%D8%B1%D8%A7%D8%A1","20241228043006"],[1033,"%D8%A5%D9%84%D8%AA%D8%AD%D8%A7%D9%85-%D8%A8%D8%B1%D9%8A","20241227211429"],[1035,"%D9%81%D9%86-%D9%82%D8%AA%D8%A7%D9%84%D9%8A%D8%8C-%D8%A7%D9%85-%D9%82%D8%A7%D9%86%D9%88%D9%86-%D9%85%D8%AF%D9%85%D8%AC%D8%9F","20241228000314"],[1036,"%D8%A7%D9%84%D9%85%D8%B3%D8%A7%D8%B1%D8%A7%D8%AA-%D8%A7%D9%84%D8%A7%D8%B1%D8%A8%D8%B9%D8%A9-1","20241228050246"],[1037,"%D8%A7%D9%84%D9%85%D8%B3%D8%A7%D8%B1%D8%A7%D8%AA-%D8%A7%D9%84%D8%A7%D8%B1%D8%A8%D8%B9%D8%A9-2","20241227193928"],[1038,"%D8%AD%D8%A7%D9%84%D8%A9-%D8%A7%D9%84%D9%88%D8%B5%D9%84","20241228122358"],[1039,"%D8%A7%D9%84%D8%AB%D8%A7%D9%84%D8%AB","20250215211005"],[1040,"%D8%BA%D8%B6%D8%A8-%D8%A7%D8%AD%D9%85%D8%B1-%D8%A7%D9%84%D9%88%D8%AC%D9%86%D8%AA%D9%8A%D9%86","20241228081522"],[1041,"%D8%A7%D8%AB%D9%86%D8%A7%D9%86-%D8%B6%D8%AF-%D9%88%D8%A7%D8%AD%D8%AF","20241228124035"],[1042,"%D8%A7%D9%84%D9%85%D8%B3%D8%A7%D8%B1-%D8%A7%D9%84%D8%B1%D8%A7%D8%A8%D8%B9-%D8%A7%D9%84%D8%A8%D8%A7%D8%A6%D8%B3","20241227145636"],[1043,"%D8%AE%D8%B2%D9%84%D8%A7%D9%86-%D8%A7%D9%84%D8%B4%D9%85%D8%A7%D9%84","20241228011056"],[1044,"%D9%85%D9%87%D9%85%D8%A9-%D8%A2%D9%85%D9%88%D9%86-%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D8%AD%D9%8A%D9%84%D8%A9","20241227145924"],[1045,"%D9%81%D9%86%D9%88%D9%86-%D8%A7%D9%84%D9%82%D8%AA%D8%A7%D9%84","20241228024335"],[1046,"%D9%81%D9%86%D9%88%D9%86-%D8%A7%D9%84%D9%82%D8%AA%D8%A7%D9%84-%D8%A7%D9%84%D8%A7%D8%B3%D8%B7%D9%88%D8%B1%D9%8A%D8%A9","20260610182127"],[1047,"%D9%85%D9%82%D8%A7%D8%AA%D9%84","20241227160302"],[1048,"%D8%A7%D9%84%D9%82%D9%88%D8%A7%D9%86%D9%8A%D9%86-%D8%A7%D9%84%D9%85%D8%AF%D9%85%D8%AC%D8%A9","20241227161226"],[1049,"%D8%A7%D9%84%D8%B3%D8%B9%D8%B1","20241227210958"],[1050,"%D8%A7%D9%84%D9%85%D8%B7%D8%B9%D9%85-%D8%A7%D9%84%D9%82%D8%AF%D9%8A%D9%85","20241227212532"],[1051,"%D8%A7%D9%84%D8%AC%D9%88%D8%B9","20241227220922"],[1052,"%D8%A7%D8%B3%D8%AA%D8%AF%D8%B9%D8%A7%D8%A1-%D9%85%D8%AE%D9%84%D9%88%D9%82%D8%A7%D8%AA-%D8%A7%D9%84%D8%B1%D9%88%D8%AD-1","20241228161713"],[1054,"%D8%AE%D8%B7%D8%A9-%D8%B3%D8%A7%D9%83%D8%A7%D8%B1-1","20241228222642"],[1055,"%D8%AE%D8%B7%D8%A9-%D8%B3%D8%A7%D9%83%D8%A7%D8%B1-2","20241228222356"],[1056,"%D9%85%D9%86-%D8%A7%D9%86%D8%A7%D8%9F","20241228220652"],[1057,"%d8%b1%d9%8a%d8%aa%d8%b4%d8%a7%d8%b1%d8%af-%d8%b6%d8%af-%d9%85%d8%a7%d8%b1%d8%b4%d8%a7%d9%84%d9%8a%d9%86",""],[1058,"%D8%A7%D8%B1%D8%B3%D8%A7%D9%84-%D9%88%D8%A7%D8%AD%D8%AF-%D8%A7%D8%AE%D8%B1-%D9%81%D9%8A-%D8%B7%D8%B1%D9%8A%D9%82%D9%87","20250419091023"],[1059,"%D8%B7%D8%B1%D9%8A%D9%82%D8%A9-%D9%82%D8%AA%D8%A7%D9%84-%D8%A7%D9%84%D8%B9%D9%81%D8%A7%D8%B1%D9%8A%D8%AA","20250419075142"],[1060,"%D8%A7%D9%84%D9%81%D8%A7%D8%B1%D9%82-%D8%A8%D9%8A%D9%86%D9%86%D8%A7","20250419090107"],[1061,"%D9%84%D8%B3%D8%AA-%D8%B3%D8%A7%D9%83%D8%A7%D8%B1","20250103174101"],[1062,"%D8%AE%D8%B7%D9%88%D8%A7%D8%AA","20250419073717"],[1063,"%D8%A2%D9%85%D9%88%D9%86","20250419090240"],[1064,"%D8%AA%D8%BA%D9%8A%D9%8A%D8%B1-%D9%81%D9%8A-%D8%B3%D8%A7%D8%AD%D8%A7%D8%AA-%D8%A7%D9%84%D9%85%D8%B9%D8%A7%D8%B1%D9%83","20250419082624"],[1065,"%D8%A7%D9%84%D8%B7%D8%A7%D8%B9%D9%88%D9%86-%D8%A7%D9%84%D8%A7%D8%AD%D9%85%D8%B1-%D9%81%D9%8A-%D8%A7%D9%84%D8%AD%D8%B2%D8%A7%D9%85-%D8%A7%D9%84%D9%85%D8%AA%D9%88%D8%B3%D8%B7","20250127090720"],[1066,"%D9%88%D9%85%D8%B6%D8%A9-%D8%A7%D9%84%D8%B2%D9%85%D9%86","20250127091345"],[1067,"%D8%B3%D9%8A%D8%AF-%D8%A7%D9%84%D8%B1%D9%88%D8%AD-%D8%B0%D8%A7-%D8%A7%D9%84%D9%82%D8%A8%D8%B6%D8%A7%D8%AA","20250419083932"],[1068,"%d8%aa%d8%b9%d8%a7%d9%88%d9%86-%d8%a7%d9%84%d8%ac%d9%8a%d9%86%d8%b1%d8%a7%d9%84%d8%a7%d8%aa-%d8%a7%d9%84%d8%b9%d9%84%d9%8a%d8%a7",""],[1069,"%D8%A7%D9%84%D8%A7%D8%AE%D8%AA%D9%8A%D8%A7%D8%B1-%D8%A7%D9%84%D9%85%D9%86%D8%A7%D8%B3%D8%A8","20250103183031"],[1070,"%D8%B0%D8%B1%D9%88%D8%A9-%D8%A7%D9%84%D9%85%D8%B3%D8%A7%D8%B1-%D8%A7%D9%84%D8%AA%D8%AF%D8%B1%D9%8A%D8%A8%D9%8A-%D8%A7%D9%84%D8%AB%D8%A7%D9%84%D8%AB","20250103201216"],[1071,"%D8%A7%D9%83%D8%AA%D8%B4%D8%A7%D9%81-%D8%A7%D9%84%D8%AB%D8%BA%D8%B1%D8%A9","20250522085853"],[1072,"%D8%B1%D9%88%D8%A8%D9%8A%D9%86-%D8%A7%D9%84%D9%83%D8%B0%D8%A7%D8%A8","20250522060310"],[1073,"%D8%AD%D8%AF%D9%88%D8%AF-%D8%B3%D9%8A%D8%AF-%D8%A7%D9%84%D8%B1%D9%88%D8%AD","20250511233458"],[1074,"%D8%AA%D9%88%D8%A7%D8%B2%D9%86-%D8%A7%D9%84%D9%85%D8%B9%D8%A7%D8%B1%D9%83","20250520110845"],[1075,"%D8%AD%D8%AC%D8%A7%D8%A8-%D8%A7%D9%84%D9%86%D8%A7%D8%B1-%D8%A7%D9%84%D8%A7%D8%B3%D9%88%D8%AF","20250906095349"],[1076,"%D8%AA%D8%AB%D8%A8%D9%8A%D8%AA-%D8%A7%D9%84%D8%AB%D8%B9%D8%A8%D8%A7%D9%86","20250906094944"],[1077,"%D8%B3%D9%82%D9%88%D8%B7-%D9%85%D8%B2%D8%AF%D9%88%D8%AC","20250409014828"],[1078,"%D8%B4%D8%B9%D9%88%D8%B1-%D8%A8%D8%A7%D9%84%D8%AE%D8%B7%D8%B1","20250906093506"],[1079,"%D8%B4%D9%85%D8%B3%D9%8C-%D9%81%D9%8A-%D8%BA%D9%8A%D8%B1-%D9%85%D9%88%D8%B6%D8%B9%D9%87%D8%A7","20250127131938"],[1080,"%D9%82%D9%88%D8%A9-%D9%85%D9%84%D9%83-%D8%A7%D9%84%D8%B4%D9%85%D8%A7%D9%84","20250411030823"],[1081,"%D9%87%D8%A8%D8%A9-%D9%85%D8%A7%D9%84%D9%83-%D9%83%D9%88%D9%83%D8%A8-%D8%B5%D8%AE%D8%B1%D8%A9-%D8%A7%D9%84%D8%B3%D9%85","20250120062324"],[1082,"%D9%86%D8%AF%D8%A7%D8%A1-%D8%A7%D9%84%D9%81%D8%B2%D8%B9","20260610182247"],[1083,"%D9%85%D9%84%D9%83%D8%A7%D9%86-%D9%85%D8%AA%D8%AD%D9%88%D8%B1%D8%A7%D9%86","20260607232158"],[1084,"%D8%A7%D9%84%D8%B9%D9%85%D9%84%D8%A7%D9%82-%D8%A7%D9%84%D8%BA%D8%A7%D8%B6%D8%A8","20250111085802"],[1085,"%D8%A8%D8%AF%D8%A3-%D8%A7%D9%84%D8%B9%D8%AF-%D8%A7%D9%84%D8%AA%D9%86%D8%A7%D8%B2%D9%84%D9%8A","20250111103604"],[1086,"%D9%85%D8%B9%D9%85%D8%B9%D8%A9","20250112065209"],[1087,"%D9%82%D9%88%D8%A9-%D8%A2%D9%85%D9%88%D9%86","20260610182524"],[1088,"%D9%85%D9%84%D8%AD%D9%85%D8%A9-%D8%A7%D9%84%D8%A7%D8%B4%D9%84%D8%A7%D8%A1-%D8%A7%D9%84%D9%85%D8%AA%D8%B7%D8%A7%D9%8A%D8%B1%D8%A9-1","20250112012330"],[1090,"%D9%83%D9%84-%D8%B4%D8%A6-%D9%8A%D8%AA%D9%85%D8%AD%D9%88%D8%B1-%D8%AD%D9%88%D9%84%D9%8A","20250112213632"],[1091,"%D8%B9%D8%B4%D8%B1-%D8%AB%D9%88%D8%A7%D9%86","20250112224838"],[1092,"%D8%A8%D9%88%D9%85","20250114004056"],[1093,"%D8%AF%D8%A7%D8%AE%D9%84-%D8%A7%D9%84%D9%82%D8%A8%D8%A9","20250209172549"],[1094,"%D8%A8%D8%AF%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D9%86%D9%87%D8%A7%D9%8A%D8%A9","20250115013414"],[1095,"%D8%A7%D9%84%D8%B1%D9%87%D8%A7%D9%86-%D8%A7%D9%84%D8%A7%D9%83%D8%A8%D8%B1","20250115015026"],[1096,"%D8%A7%D9%84%D8%A8%D9%8F%D8%B9%D8%AF-%D8%A7%D9%84%D8%AC%D8%AF%D9%8A%D8%AF","20250115234502"],[1097,"%D8%A7%D9%86%D8%B7%D9%81%D8%A7%D8%A1-%D8%A7%D9%84%D8%AD%D9%8A%D8%A7%D8%A9","20250116011900"],[1098,"%D8%A7%D9%84%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1-%D8%A7%D9%84%D9%83%D9%88%D9%83%D8%A8%D9%8A-%D8%B1%D9%88%D8%A8%D9%8A%D9%86-%D8%A8%D9%88%D8%B1%D8%AA%D9%88%D9%86","20250116204240"],[1099,"%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1-%D8%A7%D9%84%D9%86%D9%85%D9%84","20250116235250"],[1100,"%D9%86%D9%81%D8%A7%D8%B0-%D8%A7%D9%84%D8%B5%D8%A8%D8%B1","20250117142611"],[1101,"%D8%AC%D9%86%D9%88%D9%86-%D8%A7%D9%84%D8%B8%D9%84","20250117213550"],[1102,"%D8%AE%D9%86%D9%81%D8%B3%D8%A7%D8%A1","20250118201238"],[1103,"%D8%AD%D8%B2%D9%85","20250118223521"],[1104,"%D8%B4%D8%B8%D9%8A%D8%A9","20250119203131"],[1106,"%D8%A7%D9%84%D8%AF%D9%8A%D9%88%D9%86-%D8%A7%D9%84%D8%A3%D8%A8%D8%AF%D9%8A%D8%A9","20250121120008"],[1107,"%D8%A7%D9%84%D8%BA%D8%B6%D8%A8-%D8%A7%D9%84%D8%A7%D8%B9%D9%85%D9%89","20250120200813"],[1108,"%D8%A7%D9%84%D8%B5%D9%85%D8%AA-%D8%A7%D9%84%D8%AC%D9%85%D9%8A%D9%84","20250122223826"],[1109,"%D9%85%D9%86-%D8%B1%D8%B9%D8%A8-%D8%B1%D9%88%D8%A8%D9%8A%D9%86","20250122231416"],[1110,"%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%A7%D9%84%D9%83%D8%A7%D8%B1%D9%85%D8%A7","20250122225439"],[1111,"%D8%AC%D9%88%D9%87%D8%B1-%D8%A7%D9%84%D8%B1%D9%88%D8%AD","20250122234801"],[1112,"%D8%A7%D9%84%D8%A8%D9%82%D8%A7%D9%8A%D8%A7-%D8%A7%D9%84%D9%86%D8%A7%D8%AC%D9%8A%D8%A9","20250123221102"],[1113,"%D8%B5%D9%88%D8%AA%D9%87%D9%8E","20250123224037"],[1114,"%D8%A7%D9%84%D9%85%D9%8F%D8%B9%D9%84%D9%85","20250123215128"],[1116,"%D8%B9%D9%84%D9%8A-%D8%A7%D9%8A%D8%AC%D8%A7%D8%AF%D9%87","20250124215853"],[1117,"%D8%A7%D9%84%D8%AA%D8%AC%D9%88%D9%8A%D9%81","20250125121046"],[1118,"%D8%AA%D9%85%D8%AB%D8%A7%D9%84","20250124214844"],[1119,"%D8%AC%D8%A7%D8%A8%D8%A7-%D8%A7%D9%84%D9%85%D8%AA%D9%86%D8%A7%D9%82%D8%B6","20250125201838"],[1120,"%D9%83%D8%B3%D8%B1","20250126223832"],[1121,"%D9%85%D8%A7-%D8%A8%D8%B9%D8%AF-%D8%A7%D9%84%D8%B9%D8%A7%D8%B5%D9%81%D8%A9","20250126224426"],[1122,"%D9%86%D8%B3%D8%A8%D8%A9-%D8%A7%D9%84%D9%85%D9%88%D8%AA","20250127200455"],[1123,"%D8%AA%D9%82%D8%A7%D8%B1%D9%8A%D8%B1-%D8%A7%D9%84%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1%D9%8A%D8%A9-%D8%A7%D9%84%D9%83%D8%A8%D8%B1%D9%89","20250127202720"],[1124,"%D8%AD%D9%84-%D9%82%D9%8A%D8%B5%D8%B1","20250127203223"],[1125,"%D8%A7%D9%84%D8%B7%D8%A7%D8%BA%D9%8A%D8%A9-%D8%A5%D9%86%D8%AA%D9%8A%D8%B1%D8%A7%D8%B3","20250219175206"],[1126,"%D8%B2%D9%8A%D8%A7%D8%B1%D8%A9-%D8%A7%D9%84%D9%83%D9%88%D9%83%D8%A8-%D8%A7%D9%84%D8%A8%D8%A7%D8%B1%D8%AF","20250128210221"],[1127,"%D8%AC%D8%B1%D9%88%D9%8C-%D8%B6%D8%AE%D9%85","20250128200255"],[1128,"%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1%D9%8A%D8%A9-%D8%A7%D9%84%D9%85%D8%B3%D8%A7%D8%B1%D8%A7%D8%AA-%D8%A7%D9%84%D8%AA%D8%B3%D8%B9%D8%A9","20250128220327"],[1129,"%D8%AA%D8%B3%D8%B1%D9%8A%D8%A8%D8%A7%D8%AA","20250129194645"],[1130,"%D9%81%D9%83%D8%B1%D8%A9","20250131004908"],[1131,"%D9%81%D9%83%D8%B1%D8%A9-2","20250131175401"],[1132,"%D8%A7%D9%84%D8%AC%D9%8A%D9%84-%D8%A7%D9%84%D8%AC%D8%AF%D9%8A%D8%AF","20250131162434"],[1133,"%d9%88%d8%b8%d9%8a%d9%81%d8%a9-%d9%87%d8%b1%d9%85-%d8%a7%d9%84%d8%aa%d8%b6%d8%ad%d9%8a%d8%a7%d8%aa-%d8%a7%d9%84%d8%ac%d8%af%d9%8a%d8%af%d8%a9","20250225133408"],[1134,"%d9%85%d8%ae%d8%a7%d9%88%d9%81-%d8%a2%d8%b1%d9%88","20250222170024"],[1135,"%D8%A7%D9%84%D9%85%D9%88%D8%A7%D8%B1%D8%AF-%D8%A7%D9%84%D9%86%D9%87%D8%A7%D8%A6%D9%8A%D8%A9-%D8%A7%D9%84%D8%AB%D9%84%D8%A7%D8%AB","20250215182023"],[1136,"%D8%A7%D9%84%D9%88%D8%B9%D8%AF","20250215195859"],[1137,"%D8%A7%D9%84%D9%81%D9%87%D8%B1%D8%B3","20250215211945"],[1138,"%D9%85%D9%88%D8%B3%D9%88%D8%B9%D8%A9-%D8%A7%D9%84%D8%A7%D8%B1%D8%B6","20250216133456"],[1140,"%D8%AC%D8%AF%D8%A7%D8%B1-%D8%A7%D9%84%D8%A7%D9%88%D8%B4%D8%A7%D9%85","20250216143134"],[1141,"%D8%B1%D8%B3%D8%A7%D9%84%D8%A9","20250215213845"],[1142,"%D8%A7%D9%84%D8%B7%D9%84%D8%A8-%D8%A7%D9%84%D8%A7%D8%AE%D9%8A%D8%B1","20250307055352"],[1143,"%D8%B5%D8%AF%D9%85%D8%A9","20250320202935"],[1144,"%D8%AB%D9%85%D8%A7%D9%86%D9%8A%D8%A9","20250215225725"],[1145,"%D8%A7%D9%84%D9%85%D8%B2%D9%8A%D8%AF-%D9%85%D9%86-%D8%A7%D9%84%D8%A7%D8%AC%D8%A7%D8%A8%D8%A7%D8%AA-%D9%88-%D8%A7%D9%84%D8%A7%D8%B3%D8%B1%D8%A7%D8%B1-1","20250214150643"],[1146,"%D8%A7%D9%84%D9%85%D8%B2%D9%8A%D8%AF-%D9%85%D9%86-%D8%A7%D9%84%D8%A7%D8%AC%D8%A7%D8%A8%D8%A7%D8%AA-%D9%88-%D8%A7%D9%84%D8%A7%D8%B3%D8%B1%D8%A7%D8%B1-2","20250214100016"],[1147,"%D8%A7%D9%84%D9%85%D8%AC%D8%B1%D8%A7%D8%AA-%D8%A7%D9%84%D8%B7%D8%A8%D9%8A%D8%B9%D9%8A%D8%A9","20250214213613"],[1148,"%D8%A7%D9%84%D9%83%D9%88%D9%86","20250215212035"],[1149,"%D8%A7%D9%84%D9%82%D8%B7%D8%A7%D8%B9-%D8%A7%D9%84%D9%8A%D8%A7%D9%81%D8%B9-%D8%B1%D9%82%D9%85-99","20250216231447"],[1150,"%D8%A7%D9%84%D9%87%D8%AF%D9%81-%D8%A7%D9%84%D8%AC%D8%AF%D9%8A%D8%AF","20250217172309"],[1151,"%D8%A8%D8%B0%D8%B1%D8%A9-%D8%A7%D9%84%D9%85%D8%AC%D8%B1%D8%A9-%D9%86%D9%8A%D9%87%D8%A7%D8%B1%D9%8A","20250218203135"],[1153,"%D8%AD%D9%85%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%A8%D8%B0%D8%B1%D8%A9","20250220161839"],[1154,"%D8%A7%D9%84%D8%B7%D9%85%D8%B9","20250221214703"],[1155,"%D8%B1%D8%B3%D8%A7%D9%84%D8%A9-%D9%85%D9%86-%D9%85%D8%B9%D8%A7%D9%84%D9%8A%D9%87","20250222204511"],[1156,"%D8%A7%D8%B3%D9%84%D9%88%D8%A8-%D8%A2%D8%B1%D9%88","20250224182937"],[1157,"%D8%A7%D8%B3%D9%84%D9%88%D8%A8-%D8%A2%D8%B1%D9%88-2","20250224183812"],[1158,"%D8%A7%D8%B3%D9%84%D9%88%D8%A8-%D8%A7%D8%B1%D9%88-3","20250224185248"],[1159,"%D9%81%D8%AA%D8%AD-%D8%A7%D9%84%D8%AE%D8%B2%D8%A7%D9%86%D8%A9-1","20250225191856"],[1160,"%D9%81%D8%AA%D8%AD-%D8%A7%D9%84%D8%AE%D8%B2%D8%A7%D9%86%D8%A9-2","20250225191840"],[1161,"%D9%81%D8%AA%D8%AD-%D8%A7%D8%A8%D9%88%D8%A7%D8%A8-%D8%A7%D9%84%D8%AA%D8%B7%D9%88%D9%8A%D8%B1-%D9%81%D9%8A-%D8%A7%D9%84%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1%D9%8A%D8%A9-1","20250227053147"],[1162,"%D9%81%D8%AA%D8%AD-%D8%A7%D8%A8%D9%88%D8%A7%D8%A8-%D8%A7%D9%84%D8%AA%D8%B7%D9%88%D9%8A%D8%B1-%D9%81%D9%8A-%D8%A7%D9%84%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1%D9%8A%D8%A9-2","20250226211200"],[1163,"%D8%B3%D9%8A%D9%88%D9%81-%D8%A7%D9%84%D8%B6%D9%88%D8%A1-%D9%88-%D8%BA%D9%90%D9%86%D9%89-%D8%A7%D9%84%D8%AB%D8%B9%D8%A7%D8%A8%D9%8A%D9%86","20250226212216"],[1164,"%D8%A7%D9%84%D8%B3%D8%AC%D9%8A%D9%86","20250228065110"],[1165,"%D8%B3%D9%8A%D8%B1%D9%81%D9%88%D9%86","20250227225912"],[1166,"%D8%AA%D8%BA%D9%8A%D9%8A%D8%B1-%D9%81%D9%8A-%D8%B8%D9%87%D8%B1-%D9%8A%D9%88%D8%B1%D8%A7","20250312152315"],[1167,"%D9%8A%D8%AF-%D8%AE%D9%81%D9%8A%D8%A9","20250406192254"],[1168,"%D8%A7%D8%B3%D8%AA%D8%B1%D8%A7%D8%AD%D8%A9-%D9%85%D8%AD%D8%A7%D8%B1%D8%A8","20250406191851"],[1169,"%D8%AA%D8%B1%D9%82%D9%8A%D8%A9-%D8%A7%D9%84%D8%B9%D8%B1%D9%82","20250406160147"],[1170,"%D8%A7%D9%84%D8%AB%D8%A7%D9%86%D9%8A","20250306043018"],[1171,"%D8%AD%D8%A7%D9%84%D8%A9-%D9%86%D8%B7%D8%A7%D9%82-%D8%A7%D9%84%D8%B1%D9%88%D8%AD-%D8%A7%D9%84%D8%AC%D8%AF%D9%8A%D8%AF%D8%A9","20250306215956"],[1172,"%D9%85%D9%85%D8%B4%D9%89-%D8%A7%D9%84%D9%82%D8%AF%D8%B1","20250312200616"],[1173,"%D8%A7%D9%84%D8%AC%D9%8A%D8%B4-%D8%A7%D9%84%D8%A7%D9%88%D9%84-%D9%88-%D8%A7%D9%84%D8%B3%D9%88%D8%B1","20250309204838"],[1174,"%D8%A5%D9%86%D9%83%D8%B3%D8%A7%D8%B1","20250309211048"],[1175,"%D9%81%D8%AE%D8%B1-%D8%B5%D9%86%D8%A7%D8%B9%D8%A9-%D8%A7%D9%84%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1%D9%8A%D8%A9","20250310225609"],[1176,"%D8%B1%D8%A6%D9%8A%D8%B3-%D8%A7%D9%84%D8%B4%D8%B1%D8%B7%D8%A9-%D8%A7%D9%84%D9%83%D9%88%D9%83%D8%A8%D9%8A%D8%A9","20250310232921"],[1177,"%D8%A7%D9%84%D8%AC%D9%8A%D8%B4-%D8%A7%D9%84%D8%A7%D8%B2%D8%B1%D9%82","20250315105338"],[1178,"%D8%B9%D8%B1%D9%82-%D8%AC%D8%AF%D9%8A%D8%AF","20250311205648"],[1179,"%D8%AA%D9%86%D9%85%D8%B1-%D9%85%D9%86%D8%AA%D8%B8%D8%B1","20250312005157"],[1180,"%D8%B9%D8%AC%D8%B2-%D8%A7%D9%84%D8%AC%D9%8A%D8%B4-%D8%A7%D9%84%D8%AB%D8%A7%D9%84%D8%AB","20250316173509"],[1181,"%D8%BA%D9%8A%D8%B1-%D9%85%D8%AF%D8%B9%D9%88","20250312223919"],[1182,"%D9%86%D9%82%D8%A7%D8%B4-%D9%85%D8%B9-%D8%A7%D9%84%D9%87%D9%85%D8%AC%D9%8A","20250313004245"],[1183,"%D8%B0%D9%8F%D9%84","20250313201950"],[1184,"%D8%A7%D9%84%D8%AD%D8%A7%D9%85%D9%8A","20250313194939"],[1185,"%D8%A5%D9%83%D8%AA%D9%85%D8%A7%D9%84-%D8%A7%D9%84%D8%B9%D8%AF%D8%AF","20250314214502"],[1186,"%D9%85%D9%86-%D8%B3%D9%8A%D8%AA%D9%88%D8%AC-%D9%85%D8%B9%D8%A7%D9%84%D9%8A%D9%87%D8%9F","20250314210820"],[1187,"%D9%83%D9%86%D9%88%D8%B2-%D9%85%D9%84%D9%82%D8%A7%D8%A9-%D9%81%D9%8A-%D9%83%D9%84-%D9%85%D9%83%D8%A7%D9%86","20250316023606"],[1188,"%D8%AA%D8%B7%D9%88%D8%B1-%D8%A7%D9%84%D8%A7%D9%88%D8%B6%D8%A7%D8%B9","20250315230544"],[1189,"%D9%82%D8%AA%D8%A7%D9%84","20250316182948"],[1190,"%D9%84%D8%A7-%D8%AA%D8%B1%D8%A7%D8%AC%D8%B9","20250316183505"],[1191,"%D8%B1%D9%8A%D9%86%D8%A7%D8%B1%D8%A7","20250317020939"],[1192,"%D8%A7%D9%84%D8%B3%D9%8A%D8%AF-%D8%A7%D9%84%D8%A7%D8%B9%D9%84%D9%89-%D8%A7%D9%84%D8%A7%D9%82%D9%88%D9%89","20250317000805"],[1193,"%D9%85%D8%AD%D8%A7%D8%AF%D8%AB%D8%A9-%D9%85%D8%B9-%D8%B3%D9%8A%D8%AF-%D8%A7%D8%B9%D9%84%D9%89-1","20250318005236"],[1194,"%D9%85%D8%AD%D8%A7%D8%AF%D8%AB%D8%A9-%D9%85%D8%B9-%D8%B3%D9%8A%D8%AF-%D8%A7%D8%B9%D9%84%D9%89-2","20250319063846"],[1195,"%D9%85%D8%AD%D8%A7%D8%AF%D8%AB%D8%A9-%D9%85%D8%B9-%D8%B3%D9%8A%D8%AF-%D8%A7%D8%B9%D9%84%D9%89-3","20250319062255"],[1196,"%D8%A8%D9%8A%D9%86-%D8%A7%D9%84%D9%85%D8%B7%D8%B1%D9%82%D8%A9-%D9%88-%D8%A7%D9%84%D8%B3%D9%86%D8%AF%D8%A7%D9%86-1","20250318202806"],[1197,"%D8%A8%D9%8A%D9%86-%D8%A7%D9%84%D9%85%D8%B7%D8%B1%D9%82%D8%A9-%D9%88-%D8%A7%D9%84%D8%B3%D9%86%D8%AF%D8%A7%D9%86-2","20250318222140"],[1198,"%D8%AE%D9%88%D9%81%D9%8C-%D9%85%D9%8F%D8%B9%D9%84%D9%82","20250319164820"],[1199,"%D9%83%D8%B3%D8%B1","20250319160037"],[1200,"%D9%86%D9%87%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%B9%D8%A7%D9%84%D9%85","20250322052609"],[1201,"%D8%B5%D9%90%D8%AF%D8%A7%D9%85","20250322212854"],[1202,"%D9%86%D9%81%D8%B3-%D8%A7%D9%84%D9%85%D8%A2%D9%84","20250323021920"],[1203,"%D8%A7%D9%86%D9%81%D8%B5%D8%A7%D9%84-%D8%B9%D9%86-%D8%A7%D9%84%D9%88%D8%A7%D9%82%D8%B9","20250322230628"],[1204,"%D8%A7%D9%84%D9%82%D8%AA%D8%A7%D9%84-%D8%B6%D8%AF-%D8%AD%D8%A7%D9%84%D8%A9-%D9%88%D8%B5%D9%84-1","20250321224215"],[1205,"%D8%A7%D9%84%D9%82%D8%AA%D8%A7%D9%84-%D8%B6%D8%AF-%D8%AD%D8%A7%D9%84%D8%A9-%D9%88%D8%B5%D9%84-2","20250321221638"],[1206,"%D8%A5%D8%B9%D8%A7%D8%AF%D8%A9-%D8%AA%D9%82%D9%8A%D9%8A%D9%85-%D8%A7%D9%84%D8%AC%D8%A7%D8%B0%D8%A8%D9%8A%D8%A9","20250323062935"],[1207,"%D8%A7%D9%8A%D9%82%D8%A7%D9%81-%D9%85%D8%A7-%D9%84%D8%A7-%D9%8A%D9%85%D9%83%D9%86-%D8%A7%D9%8A%D9%82%D8%A7%D9%81%D9%87","20250322233011"],[1208,"%D8%AD%D8%B2%D9%85","20250323011845"],[1209,"%D8%A7%D9%84%D9%85%D8%A2%D9%84-%D8%A7%D9%84%D8%A7%D8%AE%D9%8A%D8%B1","20250323223711"],[1210,"%D9%87%D8%A8%D8%A9-%D8%AC%D8%B1%D9%8A%D9%86%D9%84%D8%A7%D9%86%D8%AF-%D8%A7%D9%84%D9%83%D8%A6%D9%8A%D8%A8%D8%A9","20250324235014"],[1211,"%D9%85%D8%B9%D8%AC%D8%B2%D8%A9","20250324235311"],[1212,"%D9%85%D8%B9%D8%AC%D8%B2%D8%A9-2","20250325204006"],[1213,"%D8%AE%D8%B3%D8%A7%D8%A6%D8%B1-%D8%A7%D9%84%D9%84%D8%B9%D8%A8-%D9%85%D8%B9-%D8%A7%D9%84%D9%83%D8%A8%D8%A7%D8%B1","20250325213931"],[1214,"%D8%B9%D8%B1%D8%B6-%D8%AC%D8%AF%D9%8A%D8%AF","20250326214125"],[1215,"%D9%86%D9%87%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%A8%D8%AF%D8%A7%D9%8A%D8%A9-1","20250327001657"],[1216,"%D9%86%D9%87%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%A8%D8%AF%D8%A7%D9%8A%D8%A9-2","20250326215533"],[1217,"%D9%81%D8%B4%D9%84","20250327212123"],[1218,"%D8%AD%D9%82%D9%8A%D9%82%D8%A9-%D8%A7%D9%84%D9%85%D9%8F%D9%87%D9%85%D8%A9","20250327223913"],[1219,"%D8%A7%D9%84%D8%B4%D8%A8%D9%83%D8%A9","20250328161758"],[1220,"%D8%AE%D9%8A%D9%88%D8%B7-%D8%A7%D9%84%D9%82%D8%AF%D8%B1","20250328162104"],[1221,"%D9%85%D8%AC%D8%B1%D8%AF-%D9%84%D9%88%D9%86","20250328220850"],[1222,"%D8%B4%D8%AE%D8%B5%D9%8A%D8%A9-%D8%B1%D9%88%D8%A8%D9%8A%D9%86","20250328224723"],[1224,"%D8%A7%D9%84%D9%85%D9%87%D9%85%D8%A9-%D8%A7%D9%84%D8%A7%D9%88%D9%84%D9%89","20250329040819"],[1225,"%D8%A7%D9%84%D9%82%D8%AF%D8%B1","20250329203923"],[1226,"%D8%A7%D9%84%D8%AC%D9%85%D9%8A%D8%B9","20250329204059"],[1227,"%D8%A7%D9%84%D8%B7%D8%B1%D9%8A%D9%82-%D9%86%D8%AD%D9%88-%D8%A7%D9%84%D9%85%D8%AC%D8%AF-%D8%A7%D9%84%D8%A3%D8%A8%D8%AF%D9%8A","20250329204454"],[1228,"%D8%A7%D9%86%D8%AA%D9%87%D8%A7%D8%A1-%D8%A7%D9%84%D8%A7%D8%B2%D9%85%D8%A9","20250329230430"],[1229,"%D9%82%D8%A7%D8%A6%D8%AF-%D8%A7%D9%84%D8%AD%D8%B1%D8%B3","20250330031234"],[1230,"%D8%A7%D8%B9%D8%A7%D8%AF%D8%A9-%D8%AA%D8%B1%D8%AA%D9%8A%D8%A8","20250330222019"],[1231,"%D8%AA%D8%AA%D9%88%D9%8A%D8%AC","20250330213846"],[1232,"%D9%84%D8%B9%D9%86%D8%A9-%D8%A7%D9%84%D8%B3%D9%83%D9%88%D9%86-%D8%A7%D9%84%D8%A3%D8%A8%D8%AF%D9%8A","20250331001748"],[1233,"%D8%A7%D9%84%D8%A5%D8%B3%D8%AA%D8%B9%D8%A7%D8%B1%D8%A9-%D8%A7%D9%84%D8%B1%D9%88%D8%AD%D9%8A%D8%A9","20250401011623"],[1234,"%D8%B1%D9%82%D9%85-%D9%81%D8%B5%D9%84-%D9%85%D9%85%D9%8A%D8%B2-%D9%84%D8%A7-%D9%8A%D8%AD%D8%AA%D8%A7%D8%AC-%D8%B9%D9%86%D9%88%D8%A7%D9%86","20250401001550"],[1235,"%D8%A7%D9%84%D9%83%D8%B4%D8%A7%D9%81-%D8%A7%D9%84%D9%86%D8%AC%D9%85%D9%8A","20250401223611"],[1236,"%D8%A7%D9%88%D9%84-%D8%B5%D9%81%D9%82%D8%A9-%D8%AE%D8%A7%D8%B1%D8%AC%D9%8A%D8%A9-1","20250402231016"],[1237,"%D8%A7%D9%88%D9%84-%D8%B5%D9%81%D9%82%D8%A9-%D8%AE%D8%A7%D8%B1%D8%AC%D9%8A%D8%A9-2","20250404135747"],[1238,"%D8%A8%D8%AF%D8%A3-%D8%B9%D8%B5%D8%B1-%D8%A7%D9%84%D9%81%D8%AA%D8%AD-1","20250403222527"],[1239,"%D8%A8%D8%AF%D8%A3-%D8%B9%D8%B5%D8%B1-%D8%A7%D9%84%D9%81%D8%AA%D8%AD-2","20250403212609"],[1240,"%D8%AD%D8%B1%D9%88%D8%A8-%D8%A7%D9%84%D8%AD%D8%B2%D8%A7%D9%85-%D8%A7%D9%84%D9%85%D8%AA%D9%88%D8%B3%D8%B7-1","20250404211014"],[1241,"%D8%AD%D8%B1%D9%88%D8%A8-%D8%A7%D9%84%D8%AD%D8%B2%D8%A7%D9%85-%D8%A7%D9%84%D9%85%D8%AA%D9%88%D8%B3%D8%B7-2","20250404215837"],[1242,"%D8%AD%D8%B1%D9%88%D8%A8-%D8%A7%D9%84%D8%AD%D8%B2%D8%A7%D9%85-%D8%A7%D9%84%D9%85%D8%AA%D9%88%D8%B3%D8%B7-3","20250405210503"],[1243,"%D8%A7%D8%B3%D8%A7%D8%B3-%D9%87%D8%B4","20250406184342"],[1244,"%D9%82%D8%AF%D8%B1%D8%A9-%D8%AC%D8%AF%D9%8A%D8%AF%D8%A9-%D9%88-%D8%B7%D8%B1%D9%8A%D9%82-%D8%AC%D8%AF%D9%8A%D8%AF","20250407073929"],[1245,"%D8%A7%D9%84%D9%85%D8%B3%D8%A7%D8%B1-%D8%A7%D9%84%D8%AE%D8%A7%D9%85%D8%B3-1","20250407221305"],[1246,"%D8%A7%D9%84%D9%85%D8%B3%D8%A7%D8%B1-%D8%A7%D9%84%D8%AE%D8%A7%D9%85%D8%B3-2","20250407221008"],[1247,"%D9%85%D8%A7-%D8%A8%D8%B9%D8%AF-%D8%A7%D9%84%D8%AD%D9%82%D9%8A%D9%82%D8%A9","20250408202802"],[1248,"%D9%8A%D8%A3%D8%B3","20250408203310"],[1249,"%D8%A7%D9%84%D9%85%D8%BA%D8%A7%D8%AF%D8%B1%D8%A9","20250409181231"],[1250,"%D8%A7%D9%84%D9%86%D8%B4%D8%B1%D8%A9-%D8%A7%D9%84%D9%83%D9%88%D9%83%D8%A8%D9%8A%D8%A9","20250409181422"],[1251,"%D8%A7%D9%84%D8%B9%D9%88%D8%AF%D8%A9-%D9%84%D9%84%D8%B3%D8%A7%D8%AD%D8%A9","20250410095746"],[1252,"%D9%87%D8%AF%D9%8A%D8%A9-%D8%AE%D8%AF%D9%85%D8%A9-%D9%85%D8%AA%D9%85%D9%8A%D8%B2%D8%A9","20250413234526"],[1253,"%D8%A8%D8%B0%D8%B1%D8%A9-%D9%82%D9%88%D8%A7%D8%AA-%D8%A7%D9%84%D8%B1%D9%88%D8%AD","20250414214309"],[1254,"%D8%BA%D9%85%D9%88%D8%B6-%D8%AD%D8%B1%D9%83%D8%A9-%D8%A7%D8%B3%D8%AA%D9%82%D8%B1%D8%A7%D8%B1","20250414204927"],[1255,"%D8%B4%D9%85%D8%B3","20250415202644"],[1256,"%D8%A7%D8%AA%D9%85%D8%A7%D9%85-%D8%A7%D9%84%D9%88%D8%B9%D8%AF","20250415214041"],[1257,"%D9%82%D9%88%D8%A9-%D8%A7%D9%84%D8%AC%D9%8A%D8%B4-%D8%A7%D9%84%D8%AB%D8%A7%D9%84%D8%AB","20250416204909"],[1258,"%D9%85%D8%B9%D8%A7%D9%86%D8%A7%D8%A9-%D8%A7%D9%84%D8%AD%D8%B1%D8%A7%D8%B3","20250417201958"],[1259,"%D9%87%D9%88%D9%84%D8%A7%D9%83-%D8%AC%D8%AF%D9%8A%D8%AF","20250417205843"],[1260,"%D8%A7%D8%AE%D8%A8%D8%A7%D8%B1-%D8%A7%D9%84%D8%B9%D9%81%D8%A7%D8%B1%D9%8A%D8%AA-1","20250418212920"],[1261,"%D8%A7%D8%AE%D8%A8%D8%A7%D8%B1-%D8%A7%D9%84%D8%B9%D9%81%D8%A7%D8%B1%D9%8A%D8%AA-2","20250418191522"],[1262,"%D8%AC%D8%B1%D8%AD","20250419224555"],[1263,"%D9%86%D8%AF%D8%A8%D8%A9-1","20250420180455"],[1264,"%D9%86%D8%AF%D8%A8%D8%A9-2","20250420163944"],[1265,"%D8%B4%D9%83%D9%88%D9%89-%D9%82%D9%8A%D8%B5%D8%B1","20250421203324"],[1266,"%D9%87%D8%AF%D8%A7%D9%8A%D8%A7-%D8%A7%D9%84%D8%AC%D9%8A%D8%B4-%D8%A7%D9%84%D8%A7%D9%88%D9%84-1","20250421230941"],[1267,"%D9%87%D8%AF%D8%A7%D9%8A%D8%A7-%D8%A7%D9%84%D8%AC%D9%8A%D8%B4-%D8%A7%D9%84%D8%A7%D9%88%D9%84-2","20250421223535"],[1268,"%D9%88%D8%B4%D9%85-%D8%B1%D8%A7%D9%8A%D8%AF%D9%8A%D9%86","20250422224357"],[1269,"%D8%AD%D9%83%D8%A7%D9%8A%D8%A7-%D8%B1%D8%A7%D9%8A%D8%AF%D9%8A%D9%86","20250422215652"],[1270,"%D8%A7%D9%85%D9%8A%D8%B1%D8%A9-%D8%A7%D9%84%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1%D9%8A%D8%A9","20250423212306"],[1271,"%D9%87%D8%AF%D8%A7%D9%8A%D8%A7-%D8%A7%D9%84%D8%A8%D8%A7%D8%AD%D8%AB%D9%8A%D9%86","20250423212150"],[1272,"%D9%85%D8%B3%D8%A4%D9%88%D9%84%D9%8A%D8%A9-%D9%85%D8%B3%D8%AA%D8%AD%D9%8A%D9%84%D8%A9","20250423215505"],[1274,"%D8%B3%D8%AC%D9%8A%D9%86-%D8%A7%D9%84%D9%83%D8%B1%D8%A7%D9%87%D9%8A%D8%A9","20250424211820"],[1275,"%D8%A7%D8%A8%D9%86-%D8%A7%D9%84%D9%82%D8%AF%D8%B1-%D8%A7%D9%84%D9%85%D9%86%D8%AD%D9%88%D8%B3","20250425010411"],[1276,"%D9%88%D8%AF%D8%A7%D8%B9","20250425192448"],[1277,"%D8%A8%D8%AF%D8%A7%D9%8A%D8%A9-%D8%AC%D8%AF%D9%8A%D8%AF%D8%A9","20250426184914"],[1278,"%D8%AA%D8%BA%D9%8A%D8%B1-%D9%85%D9%81%D8%A7%D8%AC%D8%A6","20250426184921"],[1279,"%D8%A7%D9%84%D8%B3%D9%8A%D8%AF-%D9%88-%D8%A7%D9%84%D8%A7%D8%AA%D8%A8%D8%A7%D8%B9","20250426213818"],[1280,"%D9%85%D9%87%D8%A7%D8%AC%D9%85%D8%A9-%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1%D9%8A%D8%A9-%D9%85%D8%AA%D9%88%D8%B3%D8%B7%D8%A9","20250427195025"],[1281,"%D8%AA%D9%87%D8%AF%D8%A6%D8%A9-%D8%A7%D9%84%D8%A7%D9%88%D8%B6%D8%A7%D8%B9","20250427200147"],[1282,"%D8%A7%D9%85%D9%86%D9%8A%D8%A9-%D8%B1%D9%88%D8%A8%D9%8A%D9%86","20250427195451"],[1283,"%D8%A7%D9%82%D8%AA%D8%B1%D8%A7%D8%AD-%D8%B1%D9%88%D8%A8%D9%8A%D9%86-%D9%84%D9%83%D9%88%D8%A7%D9%83%D8%A8-%D8%A7%D9%84%D8%AD%D8%B2%D8%A7%D9%85-%D8%A7%D9%84%D9%85%D8%AA%D9%88%D8%B3%D8%B7","20250428032207"],[1284,"%D8%A2%D9%84%D9%8A%D9%86%D9%88%D8%B1","20250428031013"],[1285,"%D8%A7%D9%84%D9%83%D9%88%D9%83%D8%A8-%D8%A7%D9%84%D8%AA%D8%AC%D8%A7%D8%B1%D9%8A-%D8%B2%D8%A7%D8%B1%D9%88%D9%86","20250428223655"],[1286,"%D8%A7%D9%84%D8%A3%D8%B9%D9%85%D9%89","20250428210955"],[1287,"%D8%A7%D9%84%D8%B5%D9%81%D8%AD%D8%A7%D8%AA-%D8%A7%D9%84%D8%B9%D8%B4%D8%B1","20250428210909"],[1289,"%D8%A7%D9%84%D9%86%D8%B8%D8%A7%D8%B1%D8%A9-%D8%A7%D9%84%D8%B1%D9%85%D8%A7%D8%AF%D9%8A%D8%A9","20250429205600"],[1290,"%D8%AE%D8%B5%D8%A7%D9%84-%D8%A7%D9%84%D8%B1%D9%88%D8%AD","20250429225732"],[1291,"%D8%AE%D8%B5%D9%84%D8%A9-%D8%B1%D9%88%D8%AD-%D8%B1%D9%88%D8%A8%D9%8A%D9%86","20250430192556"],[1292,"%D8%A7%D9%84%D8%A7%D9%85%D8%A8%D8%B1%D8%A7%D8%B7%D9%88%D8%B1%D9%8A%D8%A7%D8%AA-%D8%A7%D9%84%D8%A8%D8%B4%D8%B1%D9%8A%D8%A9","20250430193402"],[1293,"%D9%85%D8%B1%D8%A7%D9%83%D8%B2-%D8%A7%D9%84%D9%82%D9%88%D9%89-%D8%A7%D9%84%D8%A7%D8%B1%D8%A8%D8%B9%D8%A9-%D9%84%D9%84%D8%A8%D8%B4%D8%B1","20250501193638"],[1294,"%D8%A7%D9%84%D8%B9%D8%A7%D8%A6%D9%84%D8%A7%D8%AA-%D9%88-%D8%A7%D9%84%D8%B7%D9%88%D8%A7%D8%BA%D9%8A%D8%AA","20250501194636"],[1295,"%D8%A7%D8%B5%D9%84-%D8%A7%D9%84%D8%B9%D8%A7%D8%A6%D9%84%D8%A7%D8%AA-%D9%88-%D8%A7%D9%84%D8%B7%D9%88%D8%A7%D8%BA%D9%8A%D8%AA","20250502191002"],[1296,"%D8%B1%D8%B6%D8%A7","20250503220601"],[1297,"%D8%A7%D9%84%D9%88%D9%82%D9%88%D8%B9-%D9%81%D9%8A-%D8%B9%D8%B4%D9%82-%D8%AE%D8%B5%D9%84%D8%A9-%D8%A7%D9%84%D8%B1%D9%88%D8%AD","20250504023824"],[1298,"%D8%AF%D8%B1%D8%B3-%D9%85%D9%86-%D8%B1%D9%88%D8%AD-%D8%A7%D9%84%D9%83%D9%88%D9%83%D8%A8","20260612052043"],[1299,"%D9%87%D8%AC%D9%88%D9%85-%D9%85%D9%81%D8%A7%D8%AC%D8%A6","20260612041857"],[1300,"%D8%AE%D8%B7%D8%A9-%D8%B1%D9%88%D8%A8%D9%8A%D9%86-%D8%A7%D9%84%D9%85%D8%AA%D9%88%D9%82%D9%81%D8%A9","20260612045447"],[1302,"%D9%85%D8%AC%D8%AA%D9%85%D8%B9-%D8%A7%D9%84%D8%B1%D9%88%D8%AD-%D8%A7%D8%AE%D9%8A%D8%B1%D8%A7%D9%8B","20260612044811"],[1303,"%D8%A7%D9%86%D8%B3%D8%A7%D9%86","20260607233529"],[1304,"%D8%A7%D8%B5%D9%84-%D8%A7%D9%84%D8%B9%D8%AA%D8%A7%D8%AF-%D8%A7%D9%84%D9%83%D9%88%D9%83%D8%A8%D9%8A","20260607223643"],[1305,"%D9%85%D8%B9%D9%84%D9%88%D9%85%D8%A9-%D9%85%D8%B1%D8%B9%D8%A8%D8%A9","20260610191906"],[1306,"%D8%B7%D8%B1%D9%8A%D9%82-%D8%A7%D8%AC%D8%A8%D8%A7%D8%B1%D9%8A","20260606022701"],[1307,"%d9%86%d8%b5%d8%a7%d8%a6%d8%ad-%d9%85%d9%86-%d9%85%d8%ae%d8%aa%d8%a7%d8%b1-%d8%ad%d9%82%d9%8a%d9%82%d8%a9",""],[1308,"%D9%85%D8%B5%D9%8A%D8%B1-%D9%85%D8%AE%D8%AA%D8%A7%D8%B1%D9%8A-%D8%A7%D9%84%D8%AD%D9%82%D9%8A%D9%82%D8%A9","20260607232450"],[1309,"%d8%ba%d8%b1%d9%8a%d9%85",""],[1310,"%D8%B7%D9%81%D9%84","20260610182407"],[1311,"%D8%A7%D9%84%D8%B9%D9%85%D9%8A%D9%84-%D8%A7%D9%84%D8%A7%D9%88%D9%84","20260607234550"],[1312,"%d8%b7%d9%81%d9%84-%d9%83%d8%a8%d9%8a%d8%b1",""],[1314,"%D8%B3%D8%B1-%D9%82%D9%88%D8%A9-%D9%85%D8%AE%D9%84%D9%88%D9%82%D8%A7%D8%AA-%D8%A7%D9%84%D8%B1%D9%88%D8%AD","20260606022547"],[1315,"%D8%B1%D8%AF%D8%A7%D8%A1-%D8%A7%D9%84%D8%B1%D9%88%D8%AD","20260607225042"],[1317,"%D8%A7%D9%84%D8%B8%D9%87%D9%88%D8%B1-%D8%B9%D9%84%D9%89-%D8%A7%D9%84%D8%B3%D8%A7%D8%AD%D8%A9-%D8%A7%D9%84%D8%B9%D8%A7%D9%85%D8%A9","20260612053702"],[1318,"%D8%A7%D9%84%D9%85%D9%8F%D8%AB%D8%A8%D9%8D%D8%AA","20260612054945"],[1319,"%D8%B1%D8%B9%D8%A8","20260606021824"],[1320,"%d8%b4%d9%87%d8%b1%d8%a9",""],[1321,"%D9%86%D9%8A%D8%B1%D9%8A-%D8%A7%D9%84%D8%AD%D9%83%D9%8A%D9%85%D8%A9","20260612043101"],[1322,"%D8%B1%D8%B4%D9%81%D8%A9-%D8%A7%D9%84%D8%B8%D9%84%D8%A7%D9%85","20260610180157"],[1323,"%d8%ad%d8%b1%d8%a8",""],[1325,"%d8%b9%d9%84%d9%85%d9%86%d9%8a",""],[1326,"%D9%82%D8%A7%D8%A6%D9%85%D8%A9-%D8%A7%D9%84%D9%85%D8%B2%D8%A7%D8%AF","20260607234921"],[1327,"%D8%B2%D9%8A%D8%A7%D8%B1%D8%A9-%D8%A7%D8%B5%D8%AF%D9%82%D8%A7%D8%A1-%D9%82%D8%AF%D8%A7%D9%85%D9%89-1","20250615044621"],[1328,"%D8%B2%D9%8A%D8%A7%D8%B1%D8%A9-%D8%A7%D8%B5%D8%AF%D9%82%D8%A7%D8%A1-%D9%82%D8%AF%D8%A7%D9%85%D9%89-2","20250615050521"],[1329,"%D8%A7%D9%84%D9%88%D8%B5%D9%88%D9%84-%D9%84%D8%B3%D8%A7%D8%AD%D8%A9-%D8%A7%D9%84%D9%85%D8%B2%D8%A7%D8%AF","20250615061224"],[1330,"%D8%A7%D8%AE%D8%A8%D8%A7%D8%B1-%D8%A7%D9%84%D8%B9%D8%A7%D9%84%D9%85","20250615053253"],[1332,"%D8%A7%D9%84%D8%B9%D9%86%D8%B5%D8%B1-%D8%A7%D9%84%D8%A7%D8%B3%D8%A7%D8%B3%D9%8A-%D9%81%D9%8A-%D8%A7%D9%84%D9%85%D8%B2%D8%A7%D8%AF","20260610190915"],[1333,"%D9%84%D8%A7%D9%85%D9%88%D8%AA%D9%89","20260606013514"],[1334,"%D9%85%D9%8F%D8%B3%D8%A7%D8%B9%D8%AF%D8%A9-%D8%A8%D9%86%D9%8A%D8%A9-%D8%B3%D9%8A%D8%A6%D8%A9","20260607230055"],[1335,"%D8%AE%D8%B7%D8%B1-%D8%B6%D8%B1%D9%88%D8%B1%D9%8A","20260607235523"],[1337,"%D9%87%D9%8A%D8%AF%D8%B1%D9%8A%D9%83","20260610184158"],[1338,"%d8%ad%d8%b1%d8%a8-%d8%b9%d8%a7%d8%a6%d9%84%d8%a9-%d8%af%d9%8a%d8%b3%d8%aa%d8%b1%d8%a7",""],[1339,"%D8%A7%D9%84%D8%B0%D8%B1%D9%88%D8%A9","20260612045320"],[1340,"%D9%85%D9%86%D8%A7%D8%B7%D8%AD%D8%A9-%D8%A7%D9%84%D9%81%D8%B7%D8%A7%D8%AD%D9%84","20260612044058"],[1341,"%D9%82%D8%B1%D8%AF-%D8%AC%D8%B1%D8%A6","20260606010550"],[1343,"%D8%B8%D9%87%D9%88%D8%B1-%D8%A7%D8%B3%D9%85-%D8%BA%D9%8A%D8%B1-%D9%85%D8%AA%D9%88%D9%82%D8%B9","20260606015159"],[1344,"%D8%B1%D9%81%D8%B9-%D8%A7%D9%84%D8%BA%D8%B7%D8%A7%D8%A1","20260612053538"],[1345,"%d8%a7%d9%84%d9%81%d8%a7%d8%a6%d8%b2-%d8%a8%d8%a7%d9%84%d8%b9%d8%aa%d8%a7%d8%af-%d8%a7%d9%84%d9%83%d9%88%d9%83%d8%a8%d9%8a",""],[1346,"%d8%a7%d9%84%d9%83%d8%b4%d9%81-%d8%b9%d9%86-%d8%ba%d8%b1%d8%b6-%d8%a7%d9%84%d9%81%d8%a6%d8%a9-%d8%a7%d8%b3-%d8%a7%d8%b3",""],[1347,"%D9%85%D9%83%D9%88%D9%86%D8%A7%D8%AA-%D8%A7%D9%86%D9%81%D8%A7%D8%B3-%D8%A7%D9%84%D8%AF%D9%87%D8%B1","20260607224446"],[1348,"%d8%a3%d8%b3%d8%a7%d8%b3-%d9%82%d9%88%d9%8a",""],[1349,"%d8%a7%d8%aa%d9%87%d8%a7%d9%85-%d8%ae%d8%b7%d9%8a%d8%b1",""],[1350,"%D8%A7%D9%84%D9%81%D8%A7%D8%A6%D8%B2-%D8%A8%D8%A3%D9%86%D9%81%D8%A7%D8%B3-%D8%A7%D9%84%D8%AF%D9%87%D8%B1","20260606015050"],[1351,"%D8%A7%D9%86%D8%AA%D9%87%D8%A7%D8%A1-%D8%A7%D9%84%D9%85%D8%B2%D8%A7%D8%AF-%D8%A7%D9%84%D9%83%D8%A8%D9%8A%D8%B1","20260612051833"],[1352,"%D8%A8%D9%8A%D9%86-%D8%B9%D9%84%D9%8A%D8%A9-%D8%A7%D9%84%D9%82%D9%88%D9%85","20260606011644"],[1353,"%d8%a7%d9%84%d9%85%d8%b4%d9%83%d9%84%d8%a9-%d8%a7%d9%84%d8%ad%d9%82%d9%8a%d9%82%d9%8a%d8%a9",""],[1354,"%d8%aa%d9%88%d8%aa%d8%b1",""],[1355,"%D9%85%D8%B5%D9%8A%D8%A8%D8%A9-%D8%B9%D8%A7%D8%A6%D9%84%D8%A9-%D9%85%D8%A7%D9%8A%D8%B2%D8%B1","20260606020919"],[1356,"%D8%A7%D9%84%D9%86%D9%81%D8%B3-%D8%A7%D9%84%D8%A8%D8%B4%D8%B1%D9%8A%D8%A9","20260607234726"],[1357,"%D8%AE%D8%B7%D8%A9-%D8%A7%D9%84%D9%81%D8%AA%D8%B1%D8%A9-%D8%A7%D9%84%D9%82%D8%A7%D8%AF%D9%85%D8%A9","20260612052108"],[1358,"%D8%B7%D8%BA%D9%8A%D8%A7%D9%86-%D9%85%D9%8F%D9%82%D9%86%D9%86-1","20260606015833"],[1359,"%D9%88%D8%AC%D9%87-%D8%A7%D9%84%D8%B7%D8%BA%D9%8A%D8%A7%D9%86-2","20260610185856"],[1360,"%d8%a7%d9%84%d8%ad%d8%a7%d9%83%d9%85-%d8%a7%d9%84%d9%84%d8%a7%d8%b3%d8%b9",""],[1361,"%D9%86%D9%82%D8%A7%D8%A8%D8%A9-%D8%A7%D9%84%D9%80","20260607232642"],[1362,"%D8%AA%D8%AC%D8%A7%D8%B1%D8%A9-%D8%A7%D9%84%D8%B9%D8%A8%D9%8A%D8%AF","20260607234413"],[1363,"%D8%A7%D9%81%D9%83%D8%A7%D8%B1-%D9%84%D8%AC%D9%86%D9%8A-%D8%A7%D9%84%D8%A7%D8%B1%D8%A8%D8%A7%D8%AD","20260610183044"],[1364,"%D8%A7%D9%84%D9%82%D8%B7%D8%A7%D8%B9%D9%8A%D9%86-99-%D9%88-101","20260612053934"],[1365,"%d8%ad%d8%a7%d9%84%d8%a7%d8%aa-%d8%a7%d9%84%d9%88%d8%b5%d9%84-%d8%a7%d9%84%d8%ac%d8%a8%d9%86%d8%a7%d8%a1",""],[1366,"%d8%a7%d8%ae%d8%a8%d8%a7%d8%b1-%d8%b3%d8%b9%d9%8a%d8%af%d8%a9-%d8%a7%d8%ae%d9%8a%d8%b1%d8%a7%d9%8b",""],[1367,"%D8%AE%D8%B7%D8%A9-%D8%A7%D9%84%D9%81%D8%AA%D8%B1%D8%A9-%D8%A7%D9%84%D9%82%D8%A7%D8%AF%D9%85%D8%A9","20260610190308"],[1368,"%d8%b6%d8%a8%d8%b7-%d8%a7%d9%84%d8%a7%d9%88%d8%b6%d8%a7%d8%b9-%d9%85%d8%b1%d8%a9-%d8%a7%d8%ae%d9%8a%d8%b1%d8%a9",""],[1369,"%D8%AA%D9%88%D8%AF%D9%8A%D8%B9-%D8%B2%D8%A7%D8%B1%D9%88%D9%86","20260610181857"],[1370,"%D8%AD%D9%88%D8%A7%D8%B1%D9%8C-%D9%85%D9%8F%D8%AD%D8%B1%D9%85-1","20260606013106"],[1371,"%D8%AD%D9%88%D8%A7%D8%B1%D9%8C-%D9%85%D9%8F%D8%AD%D8%B1%D9%85-2","20260612044836"],[1373,"%d8%aa%d9%88%d8%aa%d8%b1-%d8%a8%d9%8a%d9%86-%d8%a7%d9%84%d8%ad%d9%84%d9%81%d8%a7%d8%a1-2",""],[1374,"%D8%AA%D9%88%D8%AA%D8%B1-%D8%A8%D9%8A%D9%86-%D8%A7%D9%84%D8%AD%D9%84%D9%81%D8%A7%D8%A1-3","20260606012058"],[1375,"%D8%AA%D9%88%D8%AA%D8%B1-%D8%A8%D9%8A%D9%86-%D8%A7%D9%84%D8%AD%D9%84%D9%81%D8%A7%D8%A1-4","20260612053838"],[1376,"%D8%A7%D8%B3%D8%AA%D8%B9%D8%AF%D8%A7%D8%AF-%D8%A7%D9%84%D8%B9%D9%81%D8%A7%D8%B1%D9%8A%D8%AA","20260610191930"],[1377,"%d8%ad%d9%84%d9%85-%d8%a7%d9%84%d8%ac%d9%8a%d8%b4-%d8%a7%d9%84%d8%ab%d8%a7%d9%84%d8%ab",""],[1378,"%d8%b9%d8%a8%d9%8a%d8%af%d9%8c-%d9%85%d8%ad%d8%b8%d9%88%d8%b8%d9%88%d9%86",""],[1379,"%d8%ad%d9%81%d9%84-%d8%b4%d9%88%d8%a7%d8%a1-%d8%a7%d9%81%d8%b6%d9%84-%d8%a7%d9%84%d8%a7%d8%b5%d8%ad%d8%a7%d8%a8",""],[1380,"%d9%82%d8%a7%d8%af%d8%a9-%d8%a7%d9%84%d9%81%d8%b1%d9%82-%d8%a7%d9%84%d8%ab%d9%84%d8%a7%d8%ab",""],[1381,"%d8%b9%d9%87%d8%af-%d8%a7%d9%84%d8%ad%d8%b1%d8%a7%d8%b3",""],[1382,"%d8%a7%d8%ac%d8%aa%d9%8a%d8%a7%d8%ad",""],[1383,"%d8%ad%d8%a7%d8%b1%d8%b3-%d8%a7%d9%85%d8%a8%d8%b1%d8%a7%d8%b7%d9%88%d8%b1%d9%8a-%d8%b6%d8%af-%d9%83%d8%a7%d8%b1%d8%ab%d8%a9-%d8%b9%d8%a7%d9%84%d9%85",""],[1384,"%d8%a7%d8%b3%d8%aa%d8%b9%d8%af%d8%a7%d8%af%d8%a7%d8%aa-%d8%a7%d9%84%d8%ad%d8%b1%d8%a7%d8%b3",""],[1385,"%d9%82%d8%aa%d8%a7%d9%84-%d8%ad%d8%a7%d9%84%d8%a9-%d9%88%d8%b5%d9%84",""],[1386,"%d9%85%d8%b5%d9%8a%d8%b1-%d8%a7%d9%85%d8%a8%d8%b1%d8%a7%d8%b7%d9%88%d8%b1%d9%8a%d8%a9-%d9%85%d8%aa%d8%b9%d8%af%d8%af%d8%a9",""],[1387,"%d9%86%d9%87%d8%a7%d9%8a%d8%a9-%d8%a7%d9%84%d8%b9%d8%a7%d9%84%d9%85",""],[1388,"%d8%ba%d8%b0%d8%a7%d8%a1-%d8%a7%d9%84%d8%b3%d9%85%d9%83",""],[1389,"%d8%a7%d9%84%d8%b9%d9%8a%d9%86-%d9%88-%d8%a7%d9%84%d8%ad%d9%82%d9%8a%d9%82%d8%a9",""],[1390,"%d9%83%d9%84-%d8%b4%d8%a6",""],[1391,"%d8%ad%d9%82%d9%8a%d9%82%d8%a9-%d8%a7%d9%84%d9%85%d8%b3%d8%aa%d8%a8%d8%b5%d8%b1-%d8%b9%d8%a8%d8%b1-%d8%a7%d9%84%d8%aa%d8%a7%d8%b1%d9%8a%d8%ae",""],[1392,"%d8%b7%d8%b1%d9%8a%d9%82-%d8%a7%d9%84%d9%87%d8%b1%d8%a8",""],[1393,"%d9%8a%d8%af-%d8%a7%d9%84%d8%ae%d9%81%d8%a7%d8%a1",""],[1394,"%d9%88%d8%b1%d9%8a%d8%ab",""],[1395,"%d8%a7%d9%84%d8%b4%d9%8a%d8%ae-%d8%a7%d9%84%d9%83%d9%88%d9%86%d9%8a",""],[1396,"%d8%a7%d9%84%d8%ad%d9%82%d9%8a%d9%82%d8%a9-%d8%a7%d9%84%d8%ae%d8%a7%d8%b5%d8%a9",""],[1397,"%d8%a7%d9%84%d8%ab%d8%a7%d9%85%d9%86",""],[1398,"%d9%81%d8%b1%d8%b6%d9%8a%d8%a9-%d8%a7%d9%84%d8%ad%d9%82%d9%8a%d9%82%d8%a9",""],[1399,"%d9%86%d9%87%d8%a7%d9%8a%d8%a9-%d8%a7%d9%84%d8%b9%d8%a7%d9%84%d9%85%d8%9f",""],[1400,"%d8%a7%d8%ae%d8%b0-%d8%ae%d8%b7%d9%88%d8%a9",""],[1401,"%d9%84%d9%88%d8%b1%d8%af-%d8%a7%d9%84%d8%aa%d9%88%d8%a7%d8%b2%d9%86",""],[1402,"%d8%a7%d9%84%d9%85%d9%8a%d8%b2%d8%a7%d9%86",""],[1403,"%d8%a7%d9%84%d8%b3%d9%85%d9%83%d8%a9-%d8%a7%d9%84%d8%a7%d8%b3%d8%b7%d9%88%d8%b1%d9%8a%d8%a9",""],[1404,"%d8%aa%d8%b9%d9%88%d9%8a%d8%b6",""],[1405,"%d9%83%d9%84%d9%85%d8%a7%d8%aa-%d8%ba%d8%a7%d9%85%d8%b6%d8%a9",""],[1406,"%d8%b9%d8%a7%d9%87%d9%84",""],[1407,"%d9%87%d8%a7%d9%88%d9%8a%d8%a9-%d8%a7%d9%84%d9%87%d9%84%d8%a7%d9%83",""],[1408,"%d9%85%d9%8f%d8%b9%d9%84%d9%85",""],[1409,"%d8%a3%d9%85%d9%8a%d9%86-%d8%a7%d9%84%d9%85%d9%83%d8%aa%d8%a8%d8%a9",""],[1410,"%d8%b4%d8%af%d8%a7%d8%af",""],[1411,"%d9%85%d8%ae%d8%aa%d8%a7%d8%b1-%d8%a7%d9%84%d8%ad%d9%82%d9%8a%d9%82%d8%a9-%d8%b4%d8%af%d8%a7%d8%af",""],[1412,"%d9%85%d8%b3%d8%a7%d8%b1-%d8%a7%d9%84%d8%aa%d8%af%d8%b1%d9%8a%d8%a8-%d8%a7%d9%84%d9%85%d8%b9%d8%b7%d9%88%d8%a8",""],[1413,"%d9%85%d8%b3%d8%a7%d8%b1-%d8%a7%d9%84%d8%aa%d8%af%d8%b1%d9%8a%d8%a8-%d8%a7%d9%84%d9%85%d8%b9%d8%b7%d9%88%d8%a8-2",""],[1414,"%d8%a8%d8%a7%d8%b1%d9%88%d9%83",""],[1415,"%d9%85%d9%83%d8%a7%d9%86%d8%a9-%d8%a7%d9%84%d8%a7%d9%83%d8%a7%d8%af%d9%8a%d9%85%d9%8a%d8%a7%d8%aa-%d8%a7%d9%84%d9%86%d8%ac%d9%85%d9%8a%d8%a9",""],[1416,"%d8%a7%d9%84%d9%86%d9%85%d8%b7-%d8%a7%d9%84%d8%a7%d9%88%d9%84",""],[1417,"%D8%A7%D9%84%D8%B7%D9%84%D8%A7%D8%A8","20250718164513"],[1418,"%D8%A7%D9%86%D9%88%D8%A7%D8%B9-%D8%A7%D9%84%D8%B7%D9%84%D8%A7%D8%A8","20250718164353"],[1419,"%D9%85%D9%86%D8%B5%D8%A9-%D8%AD%D8%B1%D8%A8-%D8%A7%D9%84%D8%B7%D9%84%D8%A7%D8%A8","20250718165851"],[1420,"%D8%A7%D8%B3%D9%84%D9%88%D8%A8-%D9%82%D8%AA%D8%A7%D9%84-%D8%A7%D9%84%D8%A7%D9%83%D8%A7%D8%AF%D9%8A%D9%85%D9%8A%D8%A9","20250718164552"],[1421,"%d8%a7%d9%84%d9%86%d9%87%d8%a7%d9%8a%d8%a9-%d8%a7%d9%84%d9%83%d8%a8%d8%b1%d9%89",""],[1422,"%d8%a7%d9%84%d8%a7%d8%b1%d8%b4%d9%8a%d9%81-%d8%a7%d9%84%d8%b3%d8%b1%d9%8a",""],[1423,"%d8%b3%d8%ae%d8%b7-%d8%a7%d9%84%d8%b3%d9%84%d9%81",""],[1424,"%d8%a7%d8%b3%d8%aa%d8%a7%d8%b0-%d8%a8%d8%af%d9%8a%d9%84",""],[1425,"%d8%a7%d8%b3%d9%84%d9%88%d8%a8-%d9%82%d8%aa%d8%a7%d9%84-%d8%a7%d9%84%d8%af%d8%a8",""],[1426,"%d9%81%d9%86%d9%88%d9%86-%d8%a7%d9%84%d8%a7%d8%b4%d8%aa%d8%a8%d8%a7%d9%83-%d8%a7%d9%84%d9%82%d8%b1%d9%8a%d8%a8",""],[1427,"%d8%aa%d8%b9%d9%84%d9%8a%d9%85-%d8%a7%d9%84%d8%af%d8%b1%d8%b3-%d8%a7%d9%84%d8%a7%d9%88%d9%84",""],[1428,"%d9%85%d9%83%d8%a7%d9%86%d8%a9-%d8%a7%d9%84%d9%82%d9%88%d8%a7%d9%86%d9%8a%d9%86",""],[1429,"%d8%b5%d9%81%d9%82%d8%a9-%d8%ae%d8%a7%d8%b3%d8%b1%d8%a9",""],[1430,"%d8%ae%d8%b7%d9%88%d8%a7%d8%aa-%d8%ac%d8%af%d9%8a%d8%af%d8%a9-%d9%86%d8%ad%d9%88-%d8%a7%d9%84%d8%ba%d9%86%d9%89",""],[1431,"%d8%ae%d9%8a%d8%a7%d8%b1-%d8%a8%d8%af%d9%8a%d9%84",""],[1432,"%d8%a7%d9%84%d8%a7%d8%aa%d9%81%d8%a7%d9%82",""],[1433,"%d8%b4%d8%b1%d8%a7%d8%a1-%d8%ad%d8%a7%d9%84%d8%a9-%d9%88%d8%b5%d9%84",""],[1434,"%d8%a7%d8%aa%d9%81%d8%a7%d9%82-%d8%ba%d9%8a%d8%b1-%d8%b9%d8%a7%d8%af%d9%84",""],[1435,"%d8%a7%d8%aa%d9%81%d8%a7%d9%82-%d8%ba%d9%8a%d8%b1-%d8%b9%d8%a7%d8%af%d9%84-2",""],[1436,"%d9%88%d8%b3%d9%88%d8%a7%d8%b3",""],[1437,"%d8%ba%d9%8a%d8%a7%d8%a8-%d8%a7%d9%84%d8%b1%d8%af",""],[1439,"%d9%85%d9%82%d8%a7%d9%88%d9%85%d8%a9-%d8%b6%d8%af-%d8%a7%d9%84%d8%a3%d9%84%d9%85",""],[1440,"%d8%a7%d9%86%d8%b7%d9%84%d8%a7%d9%82%d8%a9-%d8%ac%d8%af%d9%8a%d8%af%d8%a9-1",""],[1441,"%d8%a7%d9%86%d8%b7%d9%84%d8%a7%d9%82%d8%a9-%d8%ac%d8%af%d9%8a%d8%af%d8%a9-2",""],[1442,"%d8%a2%d9%85%d8%a7%d9%84",""],[1443,"%d8%b5%d8%af%d9%85%d8%a9-%d8%b1%d8%a7%d8%b6%d9%8a%d8%a9",""],[1444,"%d8%a7%d9%84%d8%aa%d8%b9%d8%a7%d9%88%d9%8a%d8%b0-%d9%88-%d8%a7%d9%84%d9%84%d8%b9%d9%86%d8%a7%d8%aa",""],[1445,"%d8%a7%d9%84%d8%ad%d9%85%d8%a7%d9%85%d8%a7%d8%aa-%d8%a7%d9%84%d8%ab%d9%84%d8%a7%d8%ab",""],[1446,"%d8%aa%d9%88%d8%b2%d9%8a%d8%b9-%d9%81%d9%8f%d8%b1%d8%b5",""],[1447,"%d9%88%d8%a7%d8%af%d9%8a-%d8%a7%d9%84%d8%a7%d8%b4%d8%a8%d8%a7%d8%ad",""],[1448,"%d8%a7%d9%84%d8%b2%d9%85%d8%b1%d8%af",""],[1449,"%d9%81%d9%8a-%d8%a7%d9%84%d8%b3%d8%b1%d9%8a%d8%b1",""],[1450,"%d8%a7%d8%ae%d8%a8%d8%a7%d8%b1-%d8%ac%d8%af%d9%8a%d8%af%d8%a9-%d8%b9%d9%86-%d8%a7%d9%86%d8%b3%d8%a7%d9%86",""],[1451,"%d8%a7%d9%84%d9%84%d8%ad%d8%af",""],[1452,"%d9%85%d8%a3%d8%b2%d9%82",""],[1453,"%d8%b1%d8%b3%d8%a7%d8%a6%d9%84-%d8%a7%d9%84%d9%84%d9%88%d8%b1%d8%af%d8%a7%d8%aa",""],[1454,"%d8%b9%d8%b0%d8%b1%d8%a7%d9%8b%d8%9f",""],[1455,"%d8%aa%d9%87%d8%af%d9%8a%d8%af%d8%a7%d8%aa-%d8%b9%d9%84%d9%89-%d8%a7%d9%84%d8%b1%d9%81",""],[1456,"%d9%85%d8%b9%d8%b6%d9%84%d8%a9",""],[1457,"%d8%a7%d9%84%d9%85%d8%ac%d8%b1%d9%85-%d9%88-%d8%a7%d9%84%d9%82%d8%b7%d8%a7%d8%b9-101",""],[1458,"%d8%ad%d9%84%d9%85-%d8%a5%d8%a8%d9%86-%d8%a7%d9%84%d8%af%d9%85%d8%a7%d8%b1",""],[1459,"%d8%b3%d8%b1",""],[1460,"%d8%b4%d8%b1%d9%8a%d9%83-%d8%a7%d9%84%d9%85%d9%87%d9%85%d8%a9",""],[1461,"%d8%a7%d9%84%d8%aa%d8%a8%d8%a7%d8%af%d9%84-%d8%a7%d9%84%d8%b9%d8%a7%d8%af%d9%84",""],[1462,"%d9%85%d8%b9%d9%86%d9%89-%d8%a7%d9%84%d8%b4%d8%b1%d8%a7%d9%83%d8%a9",""],[1463,"%d8%a7%d9%84%d8%ad%d8%b1%d8%a8-%d8%a7%d9%84%d9%85%d9%86%d8%aa%d8%b8%d8%b1%d8%a9",""],[1464,"%d8%b1%d9%88%d8%a8%d9%8a%d9%86-%d8%a7%d9%84%d9%85%d9%8f%d8%aa%d8%b1%d8%af%d8%af",""],[1465,"%d8%a7%d8%aa%d9%81%d8%a7%d9%82",""],[1466,"%d8%ad%d8%b1%d8%a8-%d9%86%d9%87%d8%a7%d9%8a%d8%a9-%d8%a7%d9%84%d8%b9%d8%a7%d9%84%d9%85",""],[1467,"%d8%a7%d9%84%d9%85%d9%81%d8%aa%d8%a7%d8%ad",""],[1468,"%D8%B9%D8%B2%D9%8A%D9%85%D8%A9-%D8%AC%D8%AF%D9%8A%D8%AF%D8%A9","20260514080726"],[1469,"%D8%A8%D8%A7%D8%AD%D8%A9-%D8%A7%D9%84%D8%AD%D8%B1%D8%B3","20260514080636"],[1470,"%D9%82%D8%A7%D8%A6%D8%AF%D8%A9-%D8%A7%D9%84%D9%81%D8%B1%D9%82%D8%A9-%D8%A7%D9%84%D8%AB%D8%A7%D9%84%D8%AB%D8%A9","20260514075646"],[1471,"%D9%84%D9%82%D8%A7%D8%A1-%D9%82%D8%A7%D8%A6%D8%AF-%D8%A7%D9%84%D9%81%D8%B1%D9%82%D8%A9-%D8%A7%D9%84%D8%AB%D8%A7%D9%86%D9%8A%D8%A9","20260514082515"],[1472,"%D9%85%D8%A8%D9%86%D9%89-%D8%A7%D9%84%D9%85%D9%87%D9%85%D8%A7%D8%AA","20260514071505"],[1473,"%D8%B1%D8%A7%D8%B9%D9%8A%D8%A9-%D8%A7%D9%84%D8%A7%D8%B4%D8%A8%D8%A7%D8%AD","20260514075153"],[1474,"%D8%B5%D8%AF%D8%A7%D9%85-%D8%AC%D8%A7%D9%86%D8%A8%D9%8A","20260514080336"],[1475,"%D8%A7%D9%84%D8%AC%D9%87%D8%A9-%D8%A7%D9%84%D8%B3%D9%8A%D8%A7%D8%AF%D9%8A%D8%A9","20260514081838"],[1476,"%D9%85%D8%B5%D9%8A%D8%A8%D8%A9-%D8%A7%D9%84%D9%85%D8%B3%D8%A7%D8%B1%D8%A7%D8%AA-%D8%A7%D9%84%D8%AA%D8%B3%D8%B9%D8%A9-1","20260514075459"],[1478,"%d8%a7%d9%84%d8%a7%d8%aa%d9%81%d8%a7%d9%82%d8%a7%d8%aa-%d8%a7%d9%84%d8%b3%d8%b1%d9%8a%d8%a9",""],[1479,"%d8%a7%d8%b9%d8%b6%d8%a7%d8%a1-%d8%aa%d9%84%d9%83-%d8%a7%d9%84%d9%86%d9%82%d8%a7%d8%a8%d8%a9",""],[1480,"%d9%85%d8%b2%d8%a7%d8%b1%d8%b9-%d8%a7%d9%84%d8%b2%d9%85%d8%b1%d8%af",""],[1481,"%d9%86%d8%b5%d8%a7%d8%a6%d8%ad-%d8%a7%d9%84%d8%a3%d8%b3%d8%a7%d8%b3",""],[1482,"%d8%aa%d9%87%d8%af%d9%8a%d8%af",""],[1483,"%d8%a7%d9%84%d9%86%d8%ac%d9%88%d9%85-%d8%a7%d9%84%d9%85%d9%84%d9%83%d9%8a%d8%a9",""],[1484,"%d9%85%d8%b7%d8%a7%d8%b1%d8%af%d8%a9",""],[1485,"%d8%aa%d8%b1%d9%86%d9%8a%d9%85%d8%a9-%d8%a7%d9%84%d8%b4%d8%b1%d9%82",""],[1486,"%d8%aa%d8%b1%d9%86%d9%8a%d9%85%d8%a9-%d8%a7%d9%84%d8%b4%d8%b1%d9%82-2",""],[1487,"%d8%a7%d9%84%d8%ad%d9%8a%d9%88%d8%a7%d9%86",""],[1488,"%d8%a7%d9%84%d9%83%d9%88%d8%a8-%d9%88-%d9%85%d8%a7-%d9%8a%d8%ad%d8%aa%d9%88%d9%8a%d9%87",""],[1489,"%d9%85%d8%ae%d9%84%d9%88%d9%82%d8%a7%d8%aa-%d8%a7%d9%84%d8%b1%d9%88%d8%ad",""],[1490,"%d9%85%d9%8f%d8%b3%d8%a7%d8%b9%d8%af%d8%a9",""],[1491,"%d8%a7%d9%84%d9%86%d8%b5%d9%81-%d8%a7%d9%84%d8%ad%d9%84%d9%88",""],[1492,"%d8%a7%d9%85%d8%aa%d8%b5%d8%a7%d8%b5",""],[1493,"%d9%85%d9%83%d8%b3%d8%a8-%d8%ba%d9%8a%d8%b1-%d9%85%d8%aa%d9%88%d9%82%d8%b9",""],[1494,"%d9%85%d8%b7%d8%a7%d8%b1%d8%af%d8%a9-%d8%a7%d9%84%d9%82%d8%b7%d8%b9%d8%a7%d9%86",""],[1495,"%d8%b3%d8%ad%d8%a8-%d8%a7%d9%84%d8%b3%d9%86%d8%a7%d8%b1%d8%a9%d8%9f",""],[1496,"%d8%a7%d8%b1%d9%83%d8%a7%d9%84%d9%88%d9%86",""],[1497,"%d9%82%d8%aa%d8%a7%d9%84",""],[1498,"%d8%ab%d9%84%d8%a7%d8%ab-%d8%ac%d8%a8%d9%87%d8%a7%d8%aa",""],[1499,"%d9%81%d9%83%d8%b1%d8%a9-%d8%ac%d8%a7%d9%85%d8%ad%d8%a9",""],[1500,"%d9%86%d9%82%d8%b7%d8%a9-%d8%a7%d9%84%d9%84%d8%a7%d8%b9%d9%88%d8%af%d8%a9",""],[1501,"%d9%87%d8%ac%d9%88%d9%85-%d8%af%d8%a7%d8%ae%d9%84%d9%8a",""],[1502,"%d8%a5%d8%b8%d9%87%d8%a7%d8%b1",""],[1503,"%d8%aa%d8%ac%d8%b3%d9%8a%d8%af-%d9%81%d8%b1%d9%85%d8%a7%d9%86-%d8%a7%d9%84%d8%ad%d9%82%d9%8a%d9%82%d8%a9",""],[1504,"%d8%aa%d8%ac%d8%b3%d9%8a%d8%af-%d9%81%d8%b1%d9%85%d8%a7%d9%86-%d8%a7%d9%84%d8%ad%d9%82%d9%8a%d9%82%d8%a9-2",""],[1505,"%d9%88%d8%ac%d9%87%d8%a9-%d8%ac%d8%af%d9%8a%d8%af%d8%a9",""],[1506,"%d9%87%d9%84%d9%88%d8%b3%d8%a9",""],[1507,"%d9%82%d8%aa%d9%84",""],[1508,"%d8%aa%d8%b9%d8%b1%d9%8a%d9%81-%d8%a7%d9%84%d9%83%d8%a7%d8%b1%d8%ab%d8%a9",""],[1509,"%d8%ac%d8%ad%d9%8a%d9%85",""],[1510,"%d8%af%d8%a7%d8%ae%d9%84-%d8%b9%d9%82%d9%84-%d8%a7%d9%84%d8%ad%d8%a7%d8%b1%d8%b3",""],[1511,"%d9%8a%d8%af-%d8%a7%d9%84%d8%b6%d9%88%d8%a1",""],[2026,"%D8%B9%D9%8A%D8%B4-%D8%A7%D9%84%D9%88%D8%A7%D9%82%D8%B9","20260610182313"],[2030,"%D8%B1%D8%A4%D9%8A%D8%A9","20260606014718"],[2031,"%D8%AE%D9%86%D8%AC%D8%B1-%D8%A7%D9%84%D8%B2%D9%85%D9%83%D8%A7%D9%86","20260612044738"],[2032,"%D8%AD%D8%A7%D8%AC%D8%B2-%D8%A7%D9%84%D8%B4%D9%85%D8%A7%D9%84","20260610192305"],[2033,"%D8%B9%D9%86%D8%AF%D9%85%D8%A7-%D8%AA%D9%86%D8%B8%D8%B1-%D9%84%D9%84%D9%87%D8%A7%D9%88%D9%8A%D8%A9","20260612050304"],[2036,"%D9%84%D9%8A%D9%84%D8%A9-%D8%A7%D9%84%D8%B9%D9%8A%D8%AF","20260606013238"],[2037,"%D8%B9%D9%8A%D9%86-%D8%A7%D9%84%D9%81%D9%88%D8%B6%D9%89","20260607233734"],[2038,"%D8%A7%D9%84%D9%88%D8%B1%D9%82%D8%A9-%D8%A7%D9%84%D8%A7%D8%AE%D9%8A%D8%B1%D8%A9","20260610192130"],[2039,"%D8%B1%D9%88%D8%A8%D9%8A%D9%86-%D8%A7%D9%84%D9%85%D8%AC%D9%86%D9%88%D9%86","20260612052933"],[2152,"%D9%85%D8%AA%D8%B7%D9%84%D8%A8%D8%A7%D8%AA-%D8%A7%D9%84%D8%B2%D9%85%D9%86","20260514063517"],[2153,"%D8%A7%D9%84%D8%B4%D8%B1%D8%A7%D9%83%D8%A9","20260514070129"],[2154,"%D9%85%D8%BA%D8%A7%D9%85%D8%B1%D8%A7%D8%AA-%D8%A7%D9%84%D9%85%D8%A7%D8%B1%D8%B4%D8%A7%D9%84","20260514075838"],[2244,"%D8%A7%D9%84%D8%A7%D8%B5%D9%84","20260710113801"],[2245,"%D8%B9%D9%84%D9%89-%D9%88%D8%B4%D9%8E%D9%83","20260710113410"],[2246,"%D8%A7%D9%85%D9%88%D8%B1-%D8%AC%D8%A7%D9%86%D8%A8%D9%8A%D8%A9","20260710114050"],[2247,"%D8%A7%D9%84%D9%85%D9%81%D8%A7%D9%88%D8%B6","20260710104742"],[2250,"%D9%85%D9%83%D8%A7%D9%86%D8%A9-%D8%A7%D9%84%D9%85%D8%AE%D9%84%D9%88%D9%82%D8%A7%D8%AA","20260710114925"],[2251,"%D9%85%D8%B3%D8%A7%D8%B9%D8%AF%D8%A9","20260710105507"],[2253,"%D8%A7%D9%84%D8%AF%D8%B9%D9%85","20260710113046"],[2254,"%D9%83%D8%B4-%D9%85%D9%84%D9%83","20260710102715"],[2255,"%D8%A7%D9%84%D9%86%D9%88%D9%85-%D9%81%D9%8A-%D8%A7%D9%84%D8%B9%D8%B3%D9%84","20260710112655"],[2256,"%D8%A7%D9%84%D9%85%D8%B1%D8%A7%D9%81%D9%82","20260710113643"],[2257,"%D8%AA%D9%87%D8%AF%D9%8A%D8%AF","20260710105350"],[2259,"%D9%82%D8%B1%D8%A7%D8%A1%D8%A9-%D8%A7%D9%84%D9%85%D8%B4%D9%87%D8%AF","20260710104027"],[2260,"%D8%A7%D9%84%D9%85%D8%B4%D9%8A-%D9%85%D8%B9-%D8%A7%D9%84%D8%AA%D9%8A%D8%A7%D8%B1","20260710111411"],[2299,"%D8%A7%D9%84%D8%B3%D8%B1","20260710105212"],[2300,"%D8%A7%D9%84%D8%A3%D8%B9%D9%85%D8%A7%D9%84","20260710110240"],[2301,"%D8%B5%D8%BA%D8%A7%D8%B1","20260710110716"],[2302,"%D8%B7%D8%B1%D9%8A%D9%82-%D8%A7%D9%84%D8%AD%D9%82","20260710111307"],[2303,"%D8%A7%D9%84%D9%85%D8%B3%D8%A7%D8%B1-%D8%A7%D9%84%D8%BA%D8%A7%D9%85%D8%B6","20260710112815"],[2304,"%D8%AD%D9%82%D9%8A%D9%82%D8%A9-%D8%A7%D9%84%D9%82%D8%A7%D9%86%D9%88%D9%86","20260710105728"],[2305,"%D8%B1%D8%AC%D9%84-%D8%A7%D9%84%D8%B6%D9%88%D8%A1","20260710110647"],[2306,"%D9%82%D9%88%D8%A9-%D8%AC%D8%AF%D9%8A%D8%AF%D8%A9","20260710102348"],[2307,"%D8%B1%D8%A3%D8%B3-%D8%A7%D9%84%D8%AD%D8%B1%D8%A8%D8%A9","20260710101722"],[2308,"%D8%A7%D8%AE%D8%A8%D8%A7%D8%B1-%D8%BA%D9%8A%D8%B1-%D8%B3%D8%A7%D8%B1%D8%A9","20260710113234"]],

  _archivedChapters: async function (ctx) {
    var out = [];
    var idx = this._ARCH_INDEX || [];
    for (var i = 0; i < idx.length; i++) {
      var num = idx[i][0], slug = idx[i][1], ts = idx[i][2];
      var original = "https://truthnovel.top/" + num + "-" + slug + "/";
      var url = ts
        ? "https://web.archive.org/web/" + ts + "id_/" + original
        : "https://web.archive.org/web/2026id_/" + original;
      var label = slug;
      try { label = decodeURIComponent(slug); } catch (e) { /* keep raw */ }
      label = label.replace(/[-_]+/g, " ").trim();
      var ch = {
        url: url,
        number: num,
        title: "الفصل " + num + (label ? " - " + label : "")
      };
      if (ts && ts.length >= 12) {
        ch.uploadedAt = Date.UTC(parseInt(ts.slice(0, 4), 10), parseInt(ts.slice(4, 6), 10) - 1,
          parseInt(ts.slice(6, 8), 10), parseInt(ts.slice(8, 10), 10) || 0, parseInt(ts.slice(10, 12), 10) || 0, 0);
      }
      out.push(ch);
    }
    return out;
  },

  parseNovelInfo: async function (url, ctx) {
    var parsed = null;
    try {
      var res = await _fetchCachedPage(this._novelUrl(), ctx);
      if (res && res.ok && res.text) parsed = this._parseNovelPage(res.text);
    } catch (e) { parsed = null; }
    var info = {
      source: this.id,
      url: this._novelUrl(),
      title: (parsed && parsed.title) || "لورد الحقيقة",
      author: this._AUTHOR,
      coverUrl: (parsed && parsed.cover) || this._coverFallback,
      summary: (parsed && parsed.summary) || "لورد الحقيقة — رواية عربية على منصة Nexus Novels.",
      status: (parsed && parsed.status) || "مستمرة",
      category: "فانتازيا",
      tags: ["فانتازيا", "مغامرة", "أكشن"]
    };
    if (parsed && parsed.readersCount) info.readersCount = parsed.readersCount;
    return info;
  },

  getTotalViews: async function (novelUrl, ctx) {
    try {
      var res = await _fetchCachedPage(this._novelUrl(), ctx);
      if (res && res.ok && res.text) {
        var parsed = this._parseNovelPage(res.text);
        var n = parsed.readersCount ? parseInt(parsed.readersCount, 10) : NaN;
        if (!isNaN(n) && n >= 0) return { count: n };
      }
    } catch (e) { /* unavailable */ }
    return { count: 0 };
  },

  parseChapterList: async function (novelUrl, ctx) {
    var live = [];
    try {
      var res = await _fetchCachedPage(this._novelUrl(), ctx);
      if (res && res.ok && res.text) {
        var parsed = this._parseNovelPage(res.text);
        for (var i = 0; i < parsed.chapters.length; i++) live.push(this._liveChapter(parsed.chapters[i]));
      }
    } catch (e) { live = []; }
    var archived = [];
    try { archived = await this._archivedChapters(ctx); } catch (e) { archived = []; }
    var seen = {};
    var out = [];
    for (var l = 0; l < live.length; l++) { seen[live[l].number] = true; out.push(live[l]); }
    for (var a = 0; a < archived.length; a++) {
      if (!seen[archived[a].number]) out.push(archived[a]);
    }
    out.sort(function (x, y) { return (x.number || 0) - (y.number || 0); });
    return out;
  },

  /**
   * Incremental refresh: rows are append-only, so the newest
   * `total - knownCount` rows are exactly the unknown ones.
   */
  fetchLatestChapters: async function (novelUrl, knownCount, ctx) {
    var known = parseInt(knownCount, 10);
    if (isNaN(known) || known < 0) known = 0;
    var all = await this.parseChapterList(novelUrl, ctx);
    if (known >= all.length) return [];
    return all.slice(known);
  },

  /** Live #chapter-body inner paragraphs -> text. */
  _liveContent: function (html) {
    var start = html.indexOf('id="chapter-body"');
    if (start === -1) return null;
    start = html.indexOf(">", start);
    if (start === -1) return null;
    start += 1;
    var end = html.indexOf('id="comments"', start);
    if (end === -1) end = html.indexOf("نهاية الفصل", start);
    if (end === -1) end = Math.min(start + 500000, html.length);
    var block = html.slice(start, end);
    block = block
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    var paragraphs = [];
    var pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    var pm;
    while ((pm = pRegex.exec(block)) !== null) {
      var text = this._decodeEntities(this._stripTags(pm[1])).trim();
      if (!text) continue;
      text = text.replace(/https?:\/\/\S+/g, " ").replace(/[ \t ]{2,}/g, " ");
      text = text.replace(/[[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]]/g, "").trim();
      if (text) paragraphs.push(text);
    }
    return paragraphs.length ? paragraphs.join("\n\n") : null;
  },

  /** Archived WordPress chapter body -> text (old bs-blog-post markup). */
  _archContent: function (html) {
    var contentMatch = html.match(/<div[^>]*class="[^"]*(?:bs-blog-post|entry-content)[^"]*"[^>]*>([\s\S]*?)(?=<footer|<div[^>]*class="[^"]*comments|$)/i);
    var block = contentMatch ? contentMatch[1] : html;
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
      if (/^(الموضوع التالي|الموضوع السابق|الرئيسية|قائمة الفصول)/.test(text)) continue;
      text = text.replace(/https?:\/\/\S+/g, " ").replace(/[ \t ]{2,}/g, " ");
      text = text.replace(/[[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]]/g, "").trim();
      if (text) paragraphs.push(text);
    }
    if (paragraphs.length) return paragraphs.join("\n\n");
    return this._decodeEntities(this._stripTags(block)).replace(/[[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]]/g, "").trim();
  },

  parseChapterContent: async function (chapterUrl, ctx) {
    var fullUrl = this._isArchiveUrl(chapterUrl) ? String(chapterUrl) : this._absUrl(chapterUrl);
    var res = await ctx.xFetch(fullUrl);
    if (!res.ok) throw new Error("فشل جلب نص الفصل: " + res.status);
    var html = res.text || "";
    if (!this._isArchiveUrl(chapterUrl)) {
      var titleM = html.match(/<title>([\s\S]*?)<\/title>/i);
      var titleText = titleM ? titleM[1] : "";
      if (/الفصل غير متاح|٤٠٤|ضاعت بين الرفوف/.test(titleText)) {
        throw new Error("الفصل غير متوفر على الموقع الجديد");
      }
    }
    var content = this._isArchiveUrl(chapterUrl) ? this._archContent(html) : this._liveContent(html);
    if (!content) throw new Error("تعذر استخراج نص الفصل");
    return content;
  },

  /** Flatten the embedded initialPage tree (replies nested under parents). */
  _flattenInitial: function (nodes, chapterUrl, out) {
    for (var i = 0; i < (nodes || []).length; i++) {
      var n = nodes[i];
      if (!n || !n.id) continue;
      var reactions = n.reactions || {};
      var likes = (typeof n.reactionCount === "number") ? n.reactionCount : 0;
      if (typeof n.reactionCount !== "number") {
        for (var k in reactions) likes += reactions[k] || 0;
      }
      var author = (n.author && (n.author.name || n.author.username)) || "—";
      out.push({
        id: String(n.id),
        parentId: n.parentId ? String(n.parentId) : null,
        author: String(author),
        body: String(n.body || ""),
        createdAt: Date.parse(n.createdAt) || 0,
        likes: likes,
        url: chapterUrl
      });
      if (n.replies && n.replies.length) this._flattenInitial(n.replies, chapterUrl, out);
    }
    return out;
  },

  /** Archived wpDiscuz markup -> flat comments. */
  _archComments: function (html, chapterUrl) {
    var count = 0;
    var cc = html.match(/"commentCount"\s*:\s*(\d+)/);
    if (cc) count = parseInt(cc[1], 10);
    var marks = [];
    var re = /id="comment-(\d+)"/g;
    var m;
    while ((m = re.exec(html)) !== null) marks.push({ id: m[1], at: m.index });
    var comments = [];
    for (var i = 0; i < marks.length; i++) {
      var seg = html.slice(marks[i].at, marks[i + 1] ? marks[i + 1].at : html.length);
      var authorM = seg.match(/wpd-comment-author[^>]*>([\s\S]*?)<\/div>/i);
      var author = authorM ? this._decodeEntities(this._stripTags(authorM[1])).trim() || "—" : "—";
      var bodyM = seg.match(/wpd-comment-text[^>]*>([\s\S]*?)<\/div>/i);
      var body = bodyM ? this._decodeEntities(this._stripTags(bodyM[1])).trim() : "";
      if (!body) continue;
      var likes = 0;
      var vm = seg.match(/wpd-vote-result[^>]*title='(-?\d+)'/);
      if (vm) { var v = parseInt(vm[1], 10); if (!isNaN(v) && v >= 0) likes = v; }
      var tm = seg.match(/<time[^>]+datetime="([^"]*)"/i);
      comments.push({
        id: marks[i].id, parentId: null, author: author, body: body,
        createdAt: tm ? (Date.parse(tm[1]) || 0) : 0, likes: likes, url: chapterUrl
      });
    }
    comments.sort(function (a, b) { return a.createdAt - b.createdAt; });
    if (!count) count = comments.length;
    return { count: count, comments: comments };
  },

  getComments: async function (chapterUrl, ctx) {
    var fullUrl = this._isArchiveUrl(chapterUrl) ? String(chapterUrl) : this._absUrl(chapterUrl);
    var res = await _fetchCachedPage(fullUrl, ctx);
    if (!res.ok) throw new Error("فشل جلب تعليقات الفصل: " + res.status);
    var html = res.text || "";
    if (this._isArchiveUrl(chapterUrl)) return this._archComments(html, fullUrl);
    var raw = _extractObject(html, "initialPage");
    if (!raw) return { count: 0, comments: [] };
    var page;
    try { page = JSON.parse(raw); } catch (e) { return { count: 0, comments: [] }; }
    var flat = this._flattenInitial(page.comments, fullUrl, []);
    var total = (typeof page.total === "number" && page.total >= 0) ? page.total : flat.length;
    // The embedded page is only the first chunk (nextCursor != null means
    // more). Follow the cursor chain exactly like the site client does:
    // same chapterId, same "top" sort, until nextCursor comes back null.
    // Any failure keeps the embedded page instead of failing the drawer.
    try {
      var chapterId = this._nxChapterId(html);
      var ids = null;
      try { ids = await this._nxActionIds(fullUrl, ctx); } catch (e) { ids = null; }
      var cursor = (page && typeof page.nextCursor !== "undefined") ? page.nextCursor : null;
      if (chapterId && ids && ids.list && cursor !== null) {
        var guard = 0;
        while (cursor !== null && guard++ < 50) {
          var pr = await this._nxCall(fullUrl, ids.list,
            { chapterId: chapterId, sort: "top", cursor: cursor }, ctx, "فشل جلب باقي التعليقات");
          var pd = (pr && pr.data) ? pr.data : {};
          this._flattenInitial(pd.comments || [], fullUrl, flat);
          if (typeof pd.total === "number" && pd.total >= 0) total = pd.total;
          cursor = (typeof pd.nextCursor === "undefined") ? null : pd.nextCursor;
        }
      }
    } catch (e) { /* keep the embedded page */ }
    var seenIds = {};
    var dedup = [];
    for (var di = 0; di < flat.length; di++) {
      var cid = String(flat[di].id);
      if (seenIds[cid]) continue;
      seenIds[cid] = true;
      dedup.push(flat[di]);
    }
    dedup.sort(function (a, b) { return a.createdAt - b.createdAt; });
    if (!total) total = dedup.length;
    return { count: total, comments: dedup };
  },

  getCommentCount: async function (chapterUrl, ctx) {
    var fullUrl = this._isArchiveUrl(chapterUrl) ? String(chapterUrl) : this._absUrl(chapterUrl);
    var res = await _fetchCachedPage(fullUrl, ctx);
    if (!res || !res.ok || !res.text) throw new Error("فشل جلب عدد التعليقات");
    var html = res.text;
    if (this._isArchiveUrl(chapterUrl)) {
      var cc = html.match(/"commentCount"\s*:\s*(\d+)/);
      if (cc) return { count: parseInt(cc[1], 10) };
      var n = (html.match(/id="comment-\d+"/g) || []).length;
      return { count: n };
    }
    var raw = _extractObject(html, "initialPage");
    if (raw) {
      try {
        var page = JSON.parse(raw);
        if (typeof page.total === "number" && page.total >= 0) return { count: page.total };
      } catch (e) { /* fall through */ }
    }
    return { count: 0 };
  },

  getCommentReplies: async function (chapterUrl, parentId, rootId, ctx) {
    var target = String(rootId || parentId || "");
    var res = await this.getComments(chapterUrl, ctx);
    return { comments: res.comments.filter(function (c) { return c.parentId === target; }) };
  },

  /**
   * Recent comments of a reader from their public /u/<username> page.
   * Read-only and login-free; the page shows recent items only.
   */
  getAuthorComments: async function (authorName, page, ctx) {
    var name = (authorName || "").trim();
    if (!name) return { authorName: "", totalComments: 0, totalLikes: null, comments: [], hasMore: false };
    var pageNum = typeof page === "number" && page >= 1 ? page : 1;
    if (pageNum > 1) {
      return { authorName: name, totalComments: 0, totalLikes: null, comments: [], hasMore: false };
    }
    var profileUrl = this.baseUrl.replace(/\/$/, "") + "/u/" + encodeURIComponent(name);
    var res;
    try { res = await _fetchCachedPage(profileUrl, ctx); }
    catch (e) { return { authorName: name, totalComments: 0, totalLikes: null, comments: [], hasMore: false }; }
    if (!res || !res.ok || !res.text) {
      return { authorName: name, totalComments: 0, totalLikes: null, comments: [], hasMore: false };
    }
    var html = res.text;
    var total = 0;
    var tm = this._toLatinDigits(html).match(/([\d,]+)\s*تعليق/);
    if (tm) total = parseInt(tm[1].replace(/,/g, ""), 10) || 0;
    var comments = [];
    var liRe = /<li[^>]*class="[^"]*panel[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    var lm;
    while ((lm = liRe.exec(html)) !== null) {
      var item = lm[1];
      var hrefM = item.match(/href="([^"]+)"/i);
      var link = hrefM ? hrefM[1] : "";
      var chUrl = link ? this._absUrl(link.split("#")[0]) : "";
      var labelM = item.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
      var label = labelM ? this._decodeEntities(this._stripTags(labelM[1])).trim() : "";
      var bodyM = item.match(/<\/a>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i) || item.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      var body = bodyM ? this._decodeEntities(this._stripTags(bodyM[1])).trim() : "";
      if (!body) continue;
      var timeM = item.match(/<time[^>]+datetime="([^"]*)"/i);
      comments.push({
        id: chUrl + "#" + comments.length,
        body: body,
        createdAt: timeM ? (Date.parse(timeM[1]) || Date.now()) : Date.now(),
        chapterTitle: label || "لورد الحقيقة",
        chapterUrl: chUrl
      });
    }
    if (!total) total = comments.length;
    return { authorName: name, totalComments: total, totalLikes: null, comments: comments, hasMore: false };
  },

  // ---------------------------------------------------------------
  // Authenticated writes via the site's own Next.js Server Actions.
  //
  // Verified live (Oct 2026): POSTing the chapter URL with a `Next-Action`
  // header and a JSON-arg body reaches the action; without a session the
  // site answers {"ok":false,"error":{"code":"UNAUTHENTICATED",...}} and
  // creates nothing. So the channel is proven and login is the only gate:
  // the host must sign in (Better Auth email+password, cookie session
  // replayed by its cookie jar) and hand the user id in as siteUserId,
  // exactly like the kolnovel auth block. Missing id / 401 / UNAUTHENTICATED
  // surface as stable `truthnovel-auth-*` errors the app matches to reopen
  // login. Action ids rotate per site deploy and are re-parsed every time
  // (cached per session), so a redeploy cannot strand a hardcoded id.
  // ---------------------------------------------------------------
  _nxActionCache: {},

  /** create/react/list Server Action ids parsed out of the page chunks. */
  _nxActionIds: async function (readUrl, ctx) {
    var key = this._normKey(readUrl);
    if (this._nxActionCache[key]) return this._nxActionCache[key];
    var pageRes = await _fetchCachedPage(readUrl, ctx);
    if (!pageRes || !pageRes.ok || !pageRes.text) throw new Error("فشل فتح صفحة الفصل");
    var html = pageRes.text;
    var found = {};
    var chunkRe = /src="(\/_next\/static\/chunks\/[^"]+\.js)"/g;
    var cm;
    while ((cm = chunkRe.exec(html)) !== null) {
      var curl = this._absUrl(cm[1]);
      var cres;
      try { cres = await _fetchCachedPage(curl, ctx); }
      catch (e) { continue; }
      if (!cres || !cres.ok || !cres.text) continue;
      var names = ["createCommentAction", "reactAction", "listCommentsAction"];
      for (var i = 0; i < names.length; i++) {
        if (found[names[i]]) continue;
        var am = cres.text.match(new RegExp("createServerReference\\)?\\(\"([0-9a-f]{10,})\"[^)]*\"" + names[i] + "\""));
        if (am) found[names[i]] = am[1];
      }
      if (found.createCommentAction && found.reactAction) break;
    }
    var ids = { create: found.createCommentAction || "", react: found.reactAction || "", list: found.listCommentsAction || "" };
    this._nxActionCache[key] = ids;
    return ids;
  },

  _normKey: function (url) {
    return String(url || "").split("#")[0].split("?")[0].replace(/\/+$/, "").toLowerCase();
  },

  /** Nexus chapter id (e.g. cmvqsb...) the actions address chapters by. */
  _nxChapterId: function (html) {
    var m = String(html || "").match(/\\"chapterId\\":\\"([^"\\]+)\\"/)
      || String(html || "").match(/"chapterId":"([^"]+)"/);
    return m ? m[1] : "";
  },

  _nxSiteUserId: function (input) {
    var id = input && (input.siteUserId || input.authUserId);
    id = id ? String(id).trim() : "";
    if (!id) throw new Error("truthnovel-auth-required: سجّل الدخول على truthnovel.top للمشاركة");
    return id;
  },

  _nxAuthError: function (res, parsed, label) {
    var code = parsed && parsed.error && parsed.error.code;
    if (code === "UNAUTHENTICATED" || res.status === 401 || res.status === 403) {
      throw new Error("truthnovel-auth-expired: انتهت الجلسة، سجّل الدخول مجددا");
    }
    var msg = (parsed && parsed.error && parsed.error.message) || (label + ": " + res.status);
    throw new Error(msg);
  },

  /** One Server Action call; returns the parsed {ok,...} envelope. */
  _nxCall: async function (readUrl, actionId, args, ctx, label) {
    var res = await ctx.xFetch(readUrl, {
      method: "POST",
      headers: { "Next-Action": actionId, "Content-Type": "application/json", "Accept": "text/x-component" },
      body: JSON.stringify([args])
    });
    if (!res) throw new Error(label + ": network");
    var parsed = null;
    var fallback = null;
    var text = res.text || "";
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].replace(/^[0-9a-zA-Z]+:/, "");
      if (ln.charAt(0) !== "{" && ln.charAt(0) !== "[") continue;
      try {
        var cand = JSON.parse(ln);
        if (!cand || typeof cand !== "object") continue;
        if (typeof cand.ok !== "undefined" || cand.error || typeof cand.success !== "undefined") { parsed = cand; break; }
        if (cand.id || cand.commentId || cand.comment_id) fallback = cand;
        else if (!fallback) fallback = cand;
      } catch (e) { /* not JSON */ }
    }
    if (!parsed) parsed = fallback;
    if (!res.ok && !parsed) this._nxAuthError(res, parsed, label);
    if (!parsed) throw new Error(label + ": " + res.status);
    if (parsed.ok === false || parsed.success === false) this._nxAuthError(res, parsed, label);
    return parsed;
  },

  _nxBustChapter: function (readUrl) {
    for (var k in _htmlCache) {
      if (this._normKey(k) === this._normKey(readUrl)) {
        _CACHE_BYTES -= _htmlCache[k].text.length;
        delete _htmlCache[k];
      }
    }
    for (var u in _inflight) {
      if (this._normKey(u) === this._normKey(readUrl)) delete _inflight[u];
    }
  },

  postComment: async function (chapterUrl, input, ctx) {
    this._nxSiteUserId(input);
    var body = input && input.body ? String(input.body).trim() : "";
    if (!body) throw new Error("نص التعليق فارغ");
    if (body.length > 2000) throw new Error("التعليق طويل (2000 حرف كحد أقصى)");
    var fullUrl = this._isArchiveUrl(chapterUrl) ? String(chapterUrl) : this._absUrl(chapterUrl);
    if (this._isArchiveUrl(chapterUrl)) throw new Error("الأرشيف للقراءة فقط — علّق على الفصل في الموقع الحالي");
    var pageRes = await _fetchCachedPage(fullUrl, ctx);
    if (!pageRes || !pageRes.ok || !pageRes.text) throw new Error("فشل فتح صفحة الفصل");
    var chapterId = this._nxChapterId(pageRes.text);
    if (!chapterId) throw new Error("تعذر تحديد الفصل");
    var ids = await this._nxActionIds(fullUrl, ctx);
    if (!ids.create) throw new Error("تعذر تجهيز التعليقات (تحديث الموقع؟)");
    var parentRaw = input && input.parentId ? String(input.parentId).trim() : "";
    var created = await this._nxCall(fullUrl, ids.create, {
      chapterId: chapterId, parentId: parentRaw || null, body: body
    }, ctx, "فشل نشر التعليق");
    this._nxBustChapter(fullUrl);
    var d = created && created.data ? created.data : created;
    var newId = d && (d.id || d.commentId || d.comment_id);
    return { ok: true, id: newId ? String(newId) : undefined };
  },

  voteComment: async function (chapterUrl, input, ctx) {
    this._nxSiteUserId(input);
    var cid = input && input.commentId ? String(input.commentId).trim() : "";
    if (!cid) throw new Error("تعذر تحديد التعليق");
    var vote = input && input.vote === -1 ? -1 : 1;
    if (vote === -1) throw new Error("التصويت السلبي غير مدعوم على الموقع الجديد");
    var fullUrl = this._isArchiveUrl(chapterUrl) ? String(chapterUrl) : this._absUrl(chapterUrl);
    if (this._isArchiveUrl(chapterUrl)) throw new Error("الأرشيف للقراءة فقط");
    var ids = await this._nxActionIds(fullUrl, ctx);
    if (!ids.react) throw new Error("تعذر تجهيز التصويت (تحديث الموقع؟)");
    var out = await this._nxCall(fullUrl, ids.react, { commentId: cid, type: "LIKE" }, ctx, "فشل التصويت");
    var d = out && out.data ? out.data : out;
    var likes = undefined;
    if (d) {
      if (typeof d.likeCount === "number") likes = d.likeCount;
      else if (typeof d.likes === "number") likes = d.likes;
      else if (typeof d.reactionCount === "number") likes = d.reactionCount;
    }
    var liked = true;
    if (d && typeof d.liked !== "undefined") liked = !!d.liked;
    else if (d && typeof d.myReaction !== "undefined") liked = !!d.myReaction;
    if (typeof likes !== "number") {
      try {
        this._nxBustChapter(fullUrl);
        var fresh = await this.getComments(fullUrl, ctx);
        for (var i = 0; i < fresh.comments.length; i++) {
          if (String(fresh.comments[i].id) === String(cid)) { likes = fresh.comments[i].likes; break; }
        }
      } catch (e) { /* keep unknown */ }
    }
    if (typeof likes !== "number" || likes < 0) likes = 0;
    return { ok: true, likes: likes, liked: liked };
  },

  getCommentVotes: async function (chapterUrl, commentIds, ctx) {
    return { ok: true, counts: {}, images: {} };
  },

  _onlyNovel: function (parsed) {
    return [{
      source: this.id,
      url: this._novelUrl(),
      title: (parsed && parsed.title) || "لورد الحقيقة",
      author: this._AUTHOR,
      coverUrl: (parsed && parsed.cover) || this._coverFallback,
      category: "فانتازيا",
      status: (parsed && parsed.status) || "مستمرة"
    }];
  },

  _novelMatches: function (query) {
    var q = (query || "").trim().toLowerCase();
    if (!q) return true;
    return ["سيد", "لورد", "حقيق", "truth", "zeus", "اسلام", "نجار", "فانتازيا"].some(function (t) {
      return q.indexOf(t) !== -1;
    });
  },

  searchNovels: async function (query, page, ctx) {
    if (page && page > 1) return [];
    if (!this._novelMatches(query)) return [];
    var parsed = null;
    try {
      var res = await _fetchCachedPage(this._novelUrl(), ctx);
      if (res && res.ok && res.text) parsed = this._parseNovelPage(res.text);
    } catch (e) { parsed = null; }
    return this._onlyNovel(parsed);
  },

  getPopularNovels: async function (page, ctx) {
    return this.searchNovels("", page, ctx);
  },

  getCategories: async function () {
    return [{ name: "فانتازيا", slug: "fantasy" }];
  },

  getCategoryNovels: async function (categorySlug, page, ctx) {
    var slug = (categorySlug || "").trim().toLowerCase();
    if (slug !== "fantasy") return [];
    return this.searchNovels("", page, ctx);
  }
});
