<?php
/**
 * Plugin Name: TN Author Comments API
 * Description: Exact "all comments by author" endpoint for the Fan Novel app.
 * Version: 1.0.0
 * Requires PHP: 7.4
 *
 * WHY THIS EXISTS
 * ---------------
 * WordPress' REST comments endpoint has NO author filter. `search` matches the
 * comment BODY, so the app used
 *
 *     /wp-json/wp/v2/comments?search=<author name>
 *
 * and then filtered rows client-side. Measured on this site, for the account
 * "تعليق":
 *
 *     true comment count            : 94
 *     x-wp-total reported by search : 1039
 *
 * i.e. 945 of those rows were other people's comments that merely happened to
 * contain the word "تعليق". The profile therefore showed a count 11x too high,
 * and its pages were sparse (page 2 returned zero of the author's own
 * comments) because their real comments were scattered across all 35 pages of
 * a 1039-row search.
 *
 * WP_Comment_Query DOES support `author_name` — it is simply not exposed as a
 * REST parameter. This route exposes it, which fixes the count, the pagination
 * and the cost (one small request per page instead of crawling a search).
 *
 * INSTALL
 * -------
 * 1. WordPress admin -> Plugins -> Add New -> Upload Plugin, choose this file,
 *    activate it. (Or drop the PHP into wp-content/mu-plugins/ so it cannot be
 *    deactivated by accident.)
 * 2. Verify:  https://truthnovel.top/wp-json/tn/v1/author-comments?author=تعليق
 *    Should print JSON with "total": 94.
 *
 * The app falls back to the old search path automatically while this plugin is
 * NOT installed, so deploying it is safe and can be done at any time.
 *
 * RESPONSE
 * --------
 * GET /wp-json/tn/v1/author-comments?author=<name>&per_page=30&offset=0
 *
 * {
 *   "total": 94,                  <- exact, for this author only
 *   "has_more": true,
 *   "data": [ { id, author_name, content: { rendered }, link, date_gmt,
 *               parent, post }, ... ]
 * }
 *
 * The shape deliberately mirrors core's wp/v2/comments rows, so the app's
 * existing parsing (chapter titles, reply quotes, vote counts) works unchanged.
 *
 * LIKE COUNTS ARE DELIBERATELY ABSENT. wpDiscuz keeps its rating in comment
 * meta whose key is not exposed through REST, so any guess here would return a
 * confident 0 for every comment — exactly the bug this endpoint is fixing. The
 * app already shows exact counts for chapters the reader has opened, and gets
 * an exact one back from a vote. Add the field later only once the key is
 * confirmed on this install.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', 'tn_register_author_comments_route' );

function tn_register_author_comments_route() {
	register_rest_route(
		'tn/v1',
		'/author-comments',
		array(
			'methods'             => WP_REST_Server::READABLE,
			// Public: the same data is already public via wp/v2/comments, and the
			// commenter profile is readable by signed-out readers.
			'permission_callback' => '__return_true',
			'callback'            => 'tn_author_comments',
			'args'                => array(
				'author' => array(
					'type'     => 'string',
					'required' => true,
				),
				'per_page' => array(
					'type'    => 'integer',
					'default' => 30,
				),
				'offset' => array(
					'type'    => 'integer',
					'default' => 0,
				),
			),
		)
	);
}

function tn_author_comments( WP_REST_Request $request ) {
	$author = trim( (string) $request->get_param( 'author' ) );
	if ( '' === $author ) {
		return new WP_REST_Response(
			array( 'total' => 0, 'has_more' => false, 'data' => array() ),
			200
		);
	}

	// Guard the per_page ceiling: this is a public endpoint and an unbounded
	// value would let one request pull the whole 59k-comment table.
	$per_page = (int) $request->get_param( 'per_page' );
	$per_page = max( 1, min( 100, $per_page ?: 30 ) );
	$offset   = max( 0, (int) $request->get_param( 'offset' ) );

	$query = array(
		// The whole point: an exact author match, which wp/v2/comments cannot do.
		'author_name' => $author,
		'status'      => 'approve',
		'number'      => $per_page,
		'offset'      => $offset,
		'orderby'     => 'comment_date_gmt',
		'order'       => 'DESC',
		// Replies are wanted, so no 'parent' filter here.
		'type'        => 'comment',
	);

	$rows = get_comments( $query );

	// One extra row would tell us has_more without a second COUNT query, but
	// get_comments has already run, so an exact count is the honest number the
	// profile header needs anyway.
	$total = (int) get_comments(
		array(
			'author_name' => $author,
			'status'      => 'approve',
			'count'       => true,
			'type'        => 'comment',
		)
	);

	$data = array();
	foreach ( $rows as $row ) {
		$data[] = array(
			'id'          => (int) $row->comment_ID,
			'author_name' => (string) $row->comment_author,
			'content'     => array( 'rendered' => (string) $row->comment_content ),
			'link'        => (string) get_comment_link( $row ),
			'date'        => (string) $row->comment_date,
			'date_gmt'    => (string) $row->comment_date_gmt,
			'parent'      => (int) $row->comment_parent,
			'post'        => (int) $row->comment_post_ID,
		);
	}

	return new WP_REST_Response(
		array(
			'total'    => $total,
			'has_more' => ( $offset + count( $data ) ) < $total,
			'data'     => $data,
		),
		200
	);
}
