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
// @version 1.0.0
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
  version: "1.0.0",
  apiVersion: 2,
  baseUrl: "https://truthnovel.top",

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
  _archivedChapters: async function (ctx) {
    var cdx = "https://web.archive.org/cdx/search/cdx?url=truthnovel.top/*"
      + "&output=json&fl=timestamp,original,statuscode"
      + "&filter=statuscode:200&collapse=urlkey&limit=10000";
    var res;
    try {
      res = await _fetchCachedPage(cdx, ctx);
    } catch (e) { return []; }
    if (!res || !res.ok || !res.text) return [];
    var rows;
    try { rows = JSON.parse(res.text); } catch (e) { return []; }
    if (!Array.isArray(rows) || !rows.length) return [];
    if (rows[0][0] === "timestamp") rows = rows.slice(1);
    var byNumber = {};
    for (var i = 0; i < rows.length; i++) {
      var ts = rows[i][0], original = rows[i][1];
      if (!original) continue;
      var m = original.match(/^https?:\/\/truthnovel\.top\/(\d+)-([^\/\?#]+)\/?$/);
      if (!m) continue;
      var num = parseInt(m[1], 10);
      if (isNaN(num) || num <= 0) continue;
      var slug = m[2];
      if (/^\d+$/.test(slug)) continue;
      try { slug = decodeURIComponent(slug); } catch (e) { /* keep raw */ }
      if (byNumber[num] && byNumber[num].ts <= ts) continue;
      var label = slug.replace(/[-_]+/g, " ").trim();
      var y = parseInt(ts.slice(0, 4), 10), mo = parseInt(ts.slice(4, 6), 10) - 1,
        d = parseInt(ts.slice(6, 8), 10), hh = parseInt(ts.slice(8, 10), 10) || 0,
        mi = parseInt(ts.slice(10, 12), 10) || 0;
      byNumber[num] = {
        url: "https://web.archive.org/web/" + ts + "id_/" + original,
        number: num,
        title: "الفصل " + num + (label ? " - " + label : ""),
        uploadedAt: Date.UTC(y, mo, d, hh, mi, 0),
        ts: ts
      };
    }
    var out = [];
    for (var k in byNumber) {
      delete byNumber[k].ts;
      out.push(byNumber[k]);
    }
    out.sort(function (a, b) { return a.number - b.number; });
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
    flat.sort(function (a, b) { return a.createdAt - b.createdAt; });
    var total = (typeof page.total === "number" && page.total >= 0) ? page.total : flat.length;
    return { count: total, comments: flat };
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

  /** New-site commenting is login-gated: read from the app, write on the site. */
  postComment: async function (chapterUrl, input, ctx) {
    throw new Error("التفاعل من التطبيق غير مدعوم بعد تحديث الموقع — سجّل الدخول على truthnovel.top للمشاركة");
  },

  voteComment: async function (chapterUrl, input, ctx) {
    throw new Error("التفاعل من التطبيق غير مدعوم بعد تحديث الموقع — سجّل الدخول على truthnovel.top للمشاركة");
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
