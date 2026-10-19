export const BOOK_HTML = `<!DOCTYPE html>
<html lang="en"><head><title>Pride and Prejudice</title></head><body>
<div id="pg-header"><h1>The Project Gutenberg eBook of Pride and Prejudice</h1>
<p>Header boilerplate that must never reach a chapter.</p></div>
<div class="toc">
<a href="#PREFACE" class="pginternal">Preface.</a>
<a href="#LIST_OF_ILLUSTRATIONS" class="pginternal">List of Illustrations.</a>
<a href="#THE_ODYSSEY" class="pginternal">THE ODYSSEY</a>
<a href="#Chapter_I" class="pginternal">Chapter I.</a>
<a href="#Chapter_II" class="pginternal">Chapter II.</a>
</div>
<p><span class="pagenum"><a id="page_1">{1}</a></span></p>
<h2><a id="PREFACE"></a><span class="pagenum"><a id="page_ix">{ix}</a></span> <img alt="PREFACE." src="images/p.png"></h2>
<p>Preface paragraph.</p>
<h2><a id="LIST_OF_ILLUSTRATIONS"></a><span class="pagenum"><a id="page_xxv">{xxv}</a></span> <img alt="List of Illustrations." src="images/l.png"></h2>
<p>Illustration list noise.</p>
<h2><a id="THE_ODYSSEY"></a>THE ODYSSEY</h2>
<h2><a id="Chapter_I"></a> Chapter I.</h2>
<p>First chapter paragraph one
continues on the next line.</p>
<p>Windows line one\r\ncontinues here.</p>
<p class="verse">Line one<br>Line two<br>Line three.</p>
<p>First chapter paragraph two.</p>
<h2><a id="Chapter_II"></a><img alt="" src="images/i.png"><span class="caption">A caption.</span><br><br>Chapter II.</h2>
<p class="nind"><span class="letra"> <img alt="M" src="images/m.png"></span>R. BENNET was here.</p>
<p>Second chapter paragraph two.</p>
<div id="pg-footer"><h2>THE FULL PROJECT GUTENBERG LICENSE</h2>
<p>License text must not appear in chapter content.</p></div>
<footer><p>Footer element must not appear in chapter content.</p></footer>
</body></html>`;

export const EBOOK_HTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta name="description" content="Test Book by Jane Austen. Free eBook digitized and proofread by volunteers.">
<title>Test Book by Jane Austen</title></head><body>
<h1 itemprop="name" id="book_title">Test Book by Jane Austen</h1>
<img class="cover-art" src="https://www.gutenberg.org/cache/epub/999999/pg999999.cover.medium.jpg" alt="">
<table>
<tr><th>Author</th><td><a href="/ebooks/author/68">Austen, Jane, 1775-1817</a></td></tr>
<tr><th>Title</th><td itemprop="headline">Test Book</td></tr>
<tr><th>Language</th><td>English</td></tr>
<tr><th>Subject</th><td property="dcterms:subject">Fiction</td></tr>
<tr><th>Subject</th><td property="dcterms:subject">Romance</td></tr>
</table>
</body></html>`;

export const TEXT_BOOK = `The Project Gutenberg eBook of Test Text Book

*** START OF THE PROJECT GUTENBERG EBOOK TEST TEXT BOOK ***

CHAPTER I.

First text chapter paragraph.

CHAPTER II.

Second text chapter paragraph.

*** END OF THE PROJECT GUTENBERG EBOOK TEST TEXT BOOK ***
`;
