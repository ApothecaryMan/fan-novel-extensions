// Real cenele fixtures captured from https://cenele.com on 2026-09-03.
// These are NOT fabricated: they are the actual HTML/JSON the site returns for
// https://cenele.com/cont/the-creatures-that-we-are-riwya/ (928 chapters) and the
// surrounding pages. Tests assert against them so results mirror what users see.
import { readFileSync } from 'fs';
import { resolve } from 'path';

const base = resolve(import.meta.dirname, 'cenele-real');

// Novel page — real inline HTML (holds the `nhvNovelV2` script with postId/
// chaptersNonce/ajaxurl, `<body class="...postid-104602...">`, and the last ~8
// chapters rendered inline as a lazy-load fallback).
export const REAL_NOVEL_PAGE = readFileSync(resolve(base, 'novel.html'), 'utf8');

export const REAL_HOME_PAGE = readFileSync(resolve(base, 'home.html'), 'utf8');
export const REAL_BROWSE_PAGE = readFileSync(resolve(base, 'browse.html'), 'utf8');
export const REAL_SEARCH_PAGE = readFileSync(resolve(base, 'search.html'), 'utf8');
export const REAL_GENRE_PAGE = readFileSync(resolve(base, 'genre.html'), 'utf8');
export const REAL_CHAPTER_PAGE = readFileSync(resolve(base, 'chapter-1.html'), 'utf8');

// The real admin-ajax chapter-list responses (ascending by chapter number, 100/page).
// IMPORTANT (observed on the live site): the server IGNORES the `order` param, so
// `page-1` holds chapters 1..100 and the NEWEST live on the LAST page.
export const REAL_AJAX = {};
for (let p = 1; p <= 10; p += 1) {
  REAL_AJAX[p] = JSON.parse(readFileSync(resolve(base, 'ajax', `page-${p}.json`), 'utf8'));
}

// Facts about the captured novel (verify against the real data if it changes).
export const REAL_NOVEL_URL = '/cont/the-creatures-that-we-are-riwya/';
export const REAL_POST_ID = '104602';
export const REAL_TOTAL = 928;
export const REAL_PER_PAGE = 100;
