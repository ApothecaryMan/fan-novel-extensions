// Fixture: kolnovel.com home page snippet — slider with genre links + novel cards
// Covers: maindet, utao, hotoday, bsx strategies, and genre nav links.
// HTML structure verified against live kolnovel.com (Sep 2026).

export const HOME_PAGE = `<!DOCTYPE html>
<html xmlns="https://www.w3.org/1999/xhtml" dir="rtl" lang="ar">
<head><title>كول نوفيل</title></head>
<body>
  <!-- Slider with genre links in .slid-gen -->
  <div class="slide-item full">
    <div class="slide-content">
      <div class="info-left">
        <div class="slid-gen">
          <a href="https://kolnovel.com/genre/action/">أكشن</a>,
          <a href="https://kolnovel.com/genre/xianxia/">شيانشيا</a>
        </div>
      </div>
    </div>
  </div>
  <div class="slide-item full">
    <div class="slide-content">
      <div class="info-left">
        <div class="slid-gen">
          <a href="https://kolnovel.com/genre/action/">أكشن</a>,
          <a href="https://kolnovel.com/genre/fantasy/">خيال</a>
        </div>
      </div>
    </div>
  </div>
  <div class="slide-item full">
    <div class="slide-content">
      <div class="info-left">
        <div class="slid-gen">
          <a href="https://kolnovel.com/genre/romance/">رومانسي</a>
        </div>
      </div>
    </div>
  </div>

  <!-- Strategy 1: article.maindet cards -->
  <article class="maindet" itemscope="itemscope" itemtype="http://schema.org/CreativeWork">
    <div class="inmain">
      <div class="mdthumb">
        <a href="https://kolnovel.com/series/كتاب-المؤife/" title="كتاب الحياة" class="tip" rel="289950">
          <img src="https://kolnovel.com/wp-content/uploads/cover1.png" class="ts-post-image" loading="lazy" itemprop="image" title="كتاب الحياة" alt="كتاب الحياة" width="1086" height="1448"/>
        </a>
      </div>
      <div class="mdinfo">
        <span class="mdgenre"><a href="https://kolnovel.com/genre/action/"># أكشن</a> <a href="https://kolnovel.com/genre/fantasy/"># خيال</a></span>
        <h2 itemprop="headline"><a href="https://kolnovel.com/series/كتاب-المؤife/" rel="bookmark">كتاب الحياة</a></h2>
        <span class="mdminf">8.5</span>
      </div>
    </div>
  </article>

  <!-- Strategy 2: .utao list items -->
  <div class="utao styletree">
    <div class="uta">
      <div class="imgu">
        <a rel="278547" class="series tip" href="https://kolnovel.com/series/اتضح-أنا-مائن/" title="اتضح أنا مائن من عشيرة الأشرار">
          <img src="https://kolnovel.com/wp-content/uploads/cover2.gif" class="ts-post-image" loading="lazy" itemprop="image" title="اتضح أنا مائن من عشيرة الأشرار" alt="اتضح أنا مائن من عشيرة الأشرار" width="471" height="716"/>
        </a>
      </div>
      <div class="luf">
        <a class="series tip" href="https://kolnovel.com/series/اتضح-أنا-مائن/" title="اتضح أنا مائن من عشيرة الأشرار">
          <h3>اتضح أنا مائن من عشيرة الأشرار</h3>
        </a>
        <ul><li><a href="#">الفصل 250</a><span>منذ ساعتين </span></li></ul>
      </div>
    </div>
  </div>

  <!-- Strategy 3: hotoday items (each is a SEPARATE hotoday block) -->
  <div class="hotoday">
    <div class="inhotoday">
      <a href="https://kolnovel.com/series/ملح-البرية/" class="tip" rel="100001" title="ملح البرية">
        <div class="todthumb">
          <div class="todstat Completed">مكتملة</div>
          <img src="https://kolnovel.com/wp-content/uploads/cover3.png" loading="lazy" itemprop="image" title="ملح البرية" alt="ملح البرية"/>
          <div class="todchap">الفصل الأخير: ملح البرية 100</div>
        </div>
        <div class="todtitle" id="artodtitle1">ملح البرية</div>
          <div class="todgen"><a href="https://kolnovel.com/genre/adventure/">مغامرة</a></div>
          <div class="todsco"><span class="todnum">9.2</span><span class="todtext">التقييم</span></div>
      </a>
    </div>
  </div>
  <div class="hotoday">
    <div class="inhotoday">
      <a href="https://kolnovel.com/series/ساموراي-لا-قادر/" class="tip" rel="100002" title="ساموراي لا قادر">
        <div class="todthumb">
          <div class="todstat Ongoing">مستمرة</div>
          <img src="https://kolnovel.com/wp-content/uploads/cover4.png" loading="lazy" itemprop="image" title="ساموراي لا قادر" alt="ساموراي لا قادر"/>
          <div class="todchap">الفصل الأخير: ساموراي لا قادر 50</div>
        </div>
        <div class="todtitle" id="artodtitle2">ساموراي لا قادر</div>
          <div class="todgen"><a href="https://kolnovel.com/genre/comedy/">كوميدي</a></div>
          <div class="todsco"><span class="todnum">8.0</span><span class="todtext">التقييم</span></div>
      </a>
    </div>
  </div>

  <!-- Strategy 4: article.bs > .bsx grid cards -->
  <article class="bs" itemscope="itemscope" itemtype="http://schema.org/CreativeWork">
    <div class="bsx">
      <a href="https://kolnovel.com/series/ثعلب-بلا-قلب/" itemprop="url" title="Fox has no heart 6" class="tip" rel="94241">
        <div class="limit">
          <div class="ply"><i class="fas fa-book-open"></i></div>
          <img src="https://kolnovel.com/wp-content/uploads/fxhnt.png" class="ts-post-image" loading="lazy" itemprop="image" title="Fox has no heart 6" alt="Fox has no heart 6" width="200" height="280"/>
        </div>
        <div class="tt">
          <span class="ntitle">ثعلب بلا قلب 6</span>
          <span class="nchapter">الفصل 6</span>
          <span class="ndate">5 دقائق مضت</span>
          <h2 itemprop="headline">Fox has no heart 6</h2>
        </div>
      </a>
    </div>
  </article>
</body>
</html>`;

// Fixture: kolnovel.com novel detail page
export const NOVEL_PAGE = `<!DOCTYPE html>
<html xmlns="https://www.w3.org/1999/xhtml" dir="rtl" lang="ar">
<head><title>ملح البرية – كول نوفيل</title></head>
<body>
  <h1 class="entry-title">ملح البرية</h1>
  <div class="sertothumb">
    <img src="https://kolnovel.com/wp-content/uploads/melh.png" class="ts-post-image" loading="lazy" itemprop="image" title="ملح البرية" alt="ملح البرية"/>
  </div>
  <div class="serl">
    <span class="serlio">الكاتب</span>
    <span class="serlist"><a href="https://kolnovel.com/author/someauthor/">المؤلف العربي</a></span>
  </div>
  <div class="serl">
    <span class="serlio">المترجم</span>
    <span class="serlist"><a href="https://kolnovel.com/translator/someguy/">المترجم الأفضل</a></span>
  </div>
  <span class="completed">مكتملة</span>
  <div class="sersysn">
    <div class="sersys entry-content" itemprop="description">
      <p>هذه هي قصة ملح البرية، مغامرة مثيرة في عالم مليء بالأسرار.</p>
    </div>
  </div>
  <div class="sertogenre">
    <a href="https://kolnovel.com/genre/adventure/">مغامرة</a>
    <a href="https://kolnovel.com/genre/fantasy/">خيال</a>
    <a href="https://kolnovel.com/genre/action/">أكشن</a>
  </div>
  <!-- Inline chapter list -->
  <div class="eplister">
    <ul>
      <li data-ID="1001">
        <a href="https://kolnovel.com/series/ملح-البرية/1/">
          <div class="epl-num">الفصل 1: البداية</div>
          <div class="epl-title">البداية</div>
          <div class="epl-date">منذ 3 أيام</div>
        </a>
      </li>
      <li data-ID="1002">
        <a href="https://kolnovel.com/series/ملح-البرية/2/">
          <div class="epl-num">الفصل 2: المواجهة</div>
          <div class="epl-title">المواجهة</div>
          <div class="epl-date">منذ يومين</div>
        </a>
      </li>
      <li data-ID="1003">
        <a href="https://kolnovel.com/series/ملح-البرية/3/">
          <div class="epl-num">الفصل 3</div>
          <div class="epl-title">3 الاختبار الكبير</div>
          <div class="epl-date">منذ يوم</div>
        </a>
      </li>
    </ul>
  </div>
</body>
</html>`;

// Fixture: kolnovel.com novel detail page — ongoing status variant
export const NOVEL_PAGE_ONGOING = NOVEL_PAGE.replace(
  '<span class="completed">مكتملة</span>',
  '<span class="Ongoing">مستمرة</span>'
);

// Fixture: kolnovel.com novel detail page — no genres
export const NOVEL_PAGE_NO_GENRES = `<!DOCTYPE html>
<html xmlns="https://www.w3.org/1999/xhtml" dir="rtl" lang="ar">
<head><title>ملح البرية – كول نوفيل</title></head>
<body>
  <h1 class="entry-title">ملح البرية</h1>
  <div class="sertothumb">
    <img src="https://kolnovel.com/wp-content/uploads/melh.png" class="ts-post-image" loading="lazy" itemprop="image" title="ملح البرية" alt="ملح البرية"/>
  </div>
  <div class="serl">
    <span class="serlio">الكاتب</span>
    <span class="serlist"><a href="https://kolnovel.com/author/someauthor/">المؤلف العربي</a></span>
  </div>
  <div class="serl">
    <span class="serlio">المترجم</span>
    <span class="serlist"><a href="https://kolnovel.com/translator/someguy/">المترجم الأفضل</a></span>
  </div>
  <span class="completed">مكتملة</span>
  <div class="sersysn">
    <div class="sersys entry-content" itemprop="description">
      <p>هذه هي قصة ملح البرية، مغامرة مثيرة في عالم مليء بالأسرار.</p>
    </div>
  </div>
  <div class="sertogenre"></div>
</body>
</html>`;

// Fixture: kolnovel.com genre page (action)
export const GENRE_PAGE_ACTION = `<!DOCTYPE html>
<html xmlns="https://www.w3.org/1999/xhtml" dir="rtl" lang="ar">
<head><title>أكشن – كول نوفيل</title></head>
<body>
  <article class="maindet" itemscope="itemscope" itemtype="http://schema.org/CreativeWork">
    <div class="inmain">
      <div class="mdthumb">
        <a href="https://kolnovel.com/series/رحلة-المحارب/" title="رحلة المحارب" class="tip">
          <img src="https://kolnovel.com/wp-content/uploads/warrior.png" class="ts-post-image" loading="lazy" itemprop="image" title="رحلة المحارب" alt="رحلة المحارب"/>
        </a>
      </div>
      <div class="mdinfo">
        <span class="mdgenre"><a href="https://kolnovel.com/genre/action/"># أكشن</a></span>
        <h2 itemprop="headline"><a href="https://kolnovel.com/series/رحلة-المحارب/" rel="bookmark">رحلة المحارب</a></h2>
        <span class="mdminf">9.0</span>
      </div>
    </div>
  </article>
  <article class="maindet" itemscope="itemscope" itemtype="http://schema.org/CreativeWork">
    <div class="inmain">
      <div class="mdthumb">
        <a href="https://kolnovel.com/series/الServerError/" title="سيࠎرفر" class="tip">
          <img src="https://kolnovel.com/wp-content/uploads/svr.png" class="ts-post-image" loading="lazy" itemprop="image" title="سيࠎرفر" alt="سيࠎرفر"/>
        </a>
      </div>
      <div class="mdinfo">
        <span class="mdgenre"><a href="https://kolnovel.com/genre/action/"># أكشن</a> <a href="https://kolnovel.com/genre/fantasy/"># خيال</a></span>
        <h2 itemprop="headline"><a href="https://kolnovel.com/series/الServerError/" rel="bookmark">سيࠎرفر</a></h2>
        <span class="mdminf">7.8</span>
      </div>
    </div>
  </article>
  <!-- Pagination -->
  <div class="pagination">
    <span aria-current="page" class="page-numbers current">1</span>
    <a class="page-numbers" href="https://kolnovel.com/genre/action/page/2/">2</a>
    <a class="page-numbers" href="https://kolnovel.com/genre/action/page/3/">3</a>
    <span class="page-numbers dots">&hellip;</span>
    <a class="page-numbers" href="https://kolnovel.com/genre/action/page/7/">7</a>
    <a class="next page-numbers" href="https://kolnovel.com/genre/action/page/2/">التالي &raquo;</a>
  </div>
</body>
</html>`;

// Fixture: kolnovel.com search results page
export const SEARCH_RESULTS = `<!DOCTYPE html>
<html xmlns="https://www.w3.org/1999/xhtml" dir="rtl" lang="ar">
<head><title>نتائج البحث – كول نوفيل</title></head>
<body>
  <!-- maindet card -->
  <article class="maindet" itemscope="itemscope" itemtype="http://schema.org/CreativeWork">
    <div class="inmain">
      <div class="mdthumb">
        <a href="https://kolnovel.com/series/نتيجة-بحث-1/" title="نتيجة بحث 1" class="tip">
          <img src="https://kolnovel.com/wp-content/uploads/r1.png" class="ts-post-image" loading="lazy" itemprop="image" title="نتيجة بحث 1" alt="نتيجة بحث 1"/>
        </a>
      </div>
      <div class="mdinfo">
        <span class="mdgenre"><a href="https://kolnovel.com/genre/romance/"># رومانسي</a></span>
        <h2 itemprop="headline"><a href="https://kolnovel.com/series/نتيجة-بحث-1/" rel="bookmark">نتيجة بحث 1</a></h2>
        <span class="mdminf">8.1</span>
      </div>
    </div>
  </article>
  <!-- bsx card -->
  <article class="bs" itemscope="itemscope" itemtype="http://schema.org/CreativeWork">
    <div class="bsx">
      <a href="https://kolnovel.com/series/نتيجة-بحث-2/" itemprop="url" title="نتيجة بحث 2" class="tip" rel="123">
        <div class="limit">
          <div class="ply"><i class="fas fa-book-open"></i></div>
          <img src="https://kolnovel.com/wp-content/uploads/r2.png" class="ts-post-image" loading="lazy" itemprop="image" title="نتيجة بحث 2" alt="نتيجة بحث 2"/>
        </div>
        <div class="tt">
          <span class="ntitle">نتيجة بحث 2</span>
          <span class="nchapter">الفصل 10</span>
          <span class="ndate">منذ ساعة</span>
          <h2 itemprop="headline">نتيجة بحث 2</h2>
        </div>
      </a>
    </div>
  </article>
</body>
</html>`;

// Fixture: kolnovel.com chapter content page
export const CHAPTER_CONTENT = `<!DOCTYPE html>
<html xmlns="https://www.w3.org/1999/xhtml" dir="rtl" lang="-ar">
<head><title>الفصل 1: البداية – كول نوفيل</title></head>
<body>
  <div id="kol_content">
    <p>هذه هي بداية المغامرة. خرج البطل من قريته بحثاً عن المغامرة.</p>
    <p>قال له الشيخ: "اذهب يا بني، فالطريق طويل والأحلام كبيرة."</p>
    <div class="ad">إعلان</div>
    <p>وصل إلى الغابة الكبيرة ووجد وحشاً يحرس البوابة.</p>
    <p>نهاية الفصل</p>
  </div>
</body>
</html>`;

// Fixture: kolnovel.com empty page (for error handling)
export const EMPTY_PAGE = `<!DOCTYPE html>
<html><head><title>404</title></head><body><h1>Not Found</h1></body></html>`;

// Fixture: kolnovel.com page with no results
export const NO_RESULTS_PAGE = `<!DOCTYPE html>
<html xmlns="https://www.w3.org/1999/xhtml" dir="rtl" lang="ar">
<head><title>نتائج البحث – كول نوفيل</title></head>
<body>
  <div class="not-found">
    <p>لم يتم العثور على نتائج</p>
  </div>
</body>
</html>`;

// Fixture: novel page with no chapter list
export const NOVEL_PAGE_NO_CHAPTERS = NOVEL_PAGE.replace(
  /<div class="eplister">[\s\S]*?<\/div>\s*<\/body>/,
  '</body>'
);
