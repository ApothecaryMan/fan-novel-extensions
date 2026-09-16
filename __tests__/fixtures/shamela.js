export const BOOK_PAGE = `<!DOCTYPE html>
<html><head><title>كتاب شواهد القرآن - المكتبة الشاملة</title></head>
<body>
<section class="page-header page-header-sm"><div class="container">
<h1 class="size-20"> <a href="https://shamela.ws/book/30196" class="text-primary">كتاب شواهد القرآن</a> </h1>
<div class="">[<a href="https://shamela.ws/author/26">أبو عبيد القاسم بن سلام</a>]</div>
<ol class="breadcrumb"><li><a href="https://shamela.ws/">الرئيسية</a></li><li><a href="https://shamela.ws/#categories">أقسام الكتب</a></li> <li><a href="https://shamela.ws/category/4">علوم القرآن وأصول التفسير</a></li></ol>
</div></section>
<div class="nass margin-top-10">
<h3 class="text-center">بطاقة الكتاب وفهرس الموضوعات</h3>
<div style="line-height: 1.8;">الكتاب: الشواهد (شواهد القرآن)<br />المؤلف: أبو عبيد القاسم بن سلام الهروي البغدادي (ت ٢٢٤ هـ)<br />عدد الصفحات: ١٩٦<br />[ترقيم الكتاب موافق للمطبوع]</div>
</div>
<div class="betaka-index"> <h4>فهرس الموضوعات</h4>
<ul>
<li><a href="javascript:;" data-id="1" data-book-id="30196" class="btn btn-white btn-3d btn-xs exp_bu"><b>[+]</b></a><a href="https://shamela.ws/book/30196/1">مقدمة المحقق</a></li>
<li>-<a href="https://shamela.ws/book/30196/49">مقدمة المؤلف</a></li>
<li>-<a href="https://shamela.ws/book/30196/51">١</a></li>
<li>-<a href="https://shamela.ws/book/30196/52">٢</a></li>
<li>-<a href="https://shamela.ws/book/30196/60">٩</a></li>
<li>-<a href="https://shamela.ws/book/30196/60">١٠</a></li>
</ul>
</div>
</section>
</body></html>`;

export const TITLECHILDS_FRAG = `<ul><li><a href="https://shamela.ws/book/30196/15">ترجمة المصنف</a></li><li><a href="https://shamela.ws/book/30196/33">دراسة وتحليل</a></li></ul>`;

export const PAGECONTENT_JSON = JSON.stringify({
  nass: '<p><span id="p1" class="anchor"></span>تقديم<a href="#p1" class="btn_tag btn btn-sm"><span class="text-gray fa fa-copy"></span></a></p><p><span class="anchor" id="p3"></span>الحمد لله الذي جعلنا خير أمة أخرجت للناس.<a href="#p3" class="btn_tag btn btn-sm"><span class="text-gray fa fa-copy"></span></a></p>',
  pageNum: 5,
  title: 'مقدمة المحقق',
  nextId: '2',
  prevId: null,
  pageId: 1
});

export const CONTENT_PAGE_HTML = `<!DOCTYPE html>
<html><body>
<div class="nass margin-top-10" data-page-id="1" data-page-num="5">
<p><span id="p1" class="anchor"></span>نص الفقرة الأولى.<a href="#p1" class="btn_tag btn btn-sm"><span class="text-gray fa fa-copy"></span></a></p>
<p>نص الفقرة الثانية<br/>مع بيت شعر.</p>
</div>
<div id="appended_pages"></div>
</body></html>`;

export const CATEGORY_PAGE = `<!DOCTYPE html>
<html><body>
<div id="cat_books">
<div class="book_item margin-top-10"><a href="https://shamela.ws/book/26537" class="book_title text-primary">كليلة ودمنة</a> [<a href="https://shamela.ws/author/794" class="text-gray">ابن المقفع</a>] <p class="margin-top-3 margin-bottom-6 des">الكتاب: كليلة ودمنة<br />المؤلف: عبد الله بن المقفع (ت ١٤٢ هـ)<br />عدد الصفحات: ٣٠٠<br />[ترقيم الكتاب موافق للمطبوع]</p></div>
<div class="book_item margin-top-10"><a href="https://shamela.ws/book/135" class="book_title text-primary">الأمثال - أبو عبيد</a> [<a href="https://shamela.ws/author/26" class="text-gray">أبو عبيد</a>] <p class="margin-top-3 margin-bottom-6 des">الكتاب: الأمثال<br />المؤلف: أبو عبيد<br />عدد الصفحات: ٣٩٥<br /></p></div>
</div>
</body></html>`;

export const SEARCH_JSON = JSON.stringify({
  results: {
    items: [
      { id: '30196', text: 'شواهد القرآن' },
      { id: '30195', text: 'الطوالات' }
    ]
  }
});
