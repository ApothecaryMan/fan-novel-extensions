// Large-scale fixtures for site:kolnovel — 100 novels in a browse/home page and a
// single novel page with 100 chapters. Built programmatically so the expected data
// stays in sync with the big HTML snippets.

// 100 novels: slug, arabic title, and per-novel latest chapter number (each novel
// contributes one chapter to the "recent updates" list).
function makeNovels(count) {
  const arr = [];
  for (let i = 1; i <= count; i++) {
    arr.push({
      slug: 'رواية-' + i,
      title: 'رواية رقم ' + i,
      chapter: i, // each novel's latest chapter number differs
      url: 'https://kolnovel.com/series/رواية-' + i + '/',
      chapterUrl: 'https://kolnovel.com/series/رواية-' + i + '/الفصل-' + i + '/',
    });
  }
  return arr;
}

export const NOVELS_100 = makeNovels(100);

// Build a home/browse page whose "latest updates" (.utao) widget lists 100 chapters,
// each from a different novel. All 100 .uta cards sit inside a SINGLE .utao wrapper to
// stress the multi-item utao parser.
function buildBrowsePage() {
  const items = NOVELS_100.map((n, idx) => {
    const side = ['ساعة', 'ساعتين', 'يوم', 'يومين', 'دقيقتين'][idx % 5];
    const minutes = (idx + 1) * 13;
    return `      <div class="uta">
        <div class="imgu">
          <a rel="${10000 + idx}" class="series tip" href="${n.url}" title="${n.title}">
            <img src="https://kolnovel.com/wp-content/uploads/c${idx + 1}.png" class="ts-post-image" loading="lazy" itemprop="image" title="${n.title}" alt="${n.title}" width="315" height="500"/>
          </a>
        </div>
        <div class="luf">
          <a class="series tip" href="${n.url}" title="${n.title}">
            <h3>${n.title}</h3>
          </a>
          <ul>
            <li><a href="${n.chapterUrl}">الفصل ${n.chapter}</a><span>منذ ${minutes} ${side}</span></li>
          </ul>
        </div>
      </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html xmlns="https://www.w3.org/1999/xhtml" dir="rtl" lang="ar">
<head><title>كول نوفيل</title></head>
<body>
  <h2>آخر التحديثات</h2>
  <div class="utao styletree">
${items}
  </div>
</body>
</html>`;
}

export const BROWSE_100 = buildBrowsePage();

// Build a single novel detail page with 100 inline chapters. Chapters are emitted in
// REVERSE order (100 → 1) so tests can verify _finalizeChapters sorts them back to
// ascending, plus a duplicated row to prove URL dedup.
function buildNovelWithChapters() {
  const rows = [];
  // Reverse, so the parser must re-sort.
  for (let i = 100; i >= 1; i--) {
    const label = i === 1 ? 'الفصل 1: البداية' : (i % 2 === 0 ? `الفصل ${i}: أحداث الفصل ${i}` : `الفصل ${i}`);
    const title = i === 1 ? 'البداية' : (i % 2 === 0 ? `أحداث الفصل ${i}` : '');
    rows.push(`      <li data-ID="${1000 + i}">
        <a href="https://kolnovel.com/series/رواية-الضخمة/${i}/">
          <div class="epl-num">${label}</div>
          <div class="epl-title">${title}</div>
          <div class="epl-date">منذ ${i} يوماً</div>
        </a>
      </li>`);
  }
  // Append an exact duplicate of chapter 50 to exercise URL-level dedup in _finalizeChapters.
  rows.push(`      <li data-ID="2999">
        <a href="https://kolnovel.com/series/رواية-الضخمة/50/">
          <div class="epl-num">الفصل 50: أحداث الفصل 50</div>
          <div class="epl-title">أحداث الفصل 50</div>
          <div class="epl-date">منذ 50 يوماً</div>
        </a>
      </li>`);

  return `<!DOCTYPE html>
<html xmlns="https://www.w3.org/1999/xhtml" dir="rtl" lang="ar">
<head><title>رواية الضخمة – كول نوفيل</title></head>
<body>
  <h1 class="entry-title">رواية الضخمة</h1>
  <div class="sertothumb">
    <img src="https://kolnovel.com/wp-content/uploads/big.png" class="ts-post-image" loading="lazy" itemprop="image" title="رواية الضخمة" alt="رواية الضخمة"/>
  </div>
  <div class="serl"><span class="serlio">الكاتب</span><span class="serlist"><a href="https://kolnovel.com/author/big/">المؤلف الضخم</a></span></div>
  <span class="Ongoing">مستمرة</span>
  <div class="sersysn"><div class="sersys entry-content" itemprop="description"><p>رواية ضخمة بمئة فصل.</p></div></div>
  <div class="sertogenre">
    <a href="https://kolnovel.com/genre/action/">أكشن</a>
    <a href="https://kolnovel.com/genre/drama/">دراما</a>
  </div>
  <div class="eplister">
    <ul>
${rows.join('\n')}
    </ul>
  </div>
</body>
</html>`;
}

export const NOVEL_100_CHAPTERS = buildNovelWithChapters();
