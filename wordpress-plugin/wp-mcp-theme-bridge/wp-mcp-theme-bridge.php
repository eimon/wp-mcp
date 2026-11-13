<?php
/**
 * Plugin Name: WP MCP Theme Bridge
 * Description: Exposes plain REST API routes so an external MCP server can discover which CSS/JS a page actually renders (theme-agnostic), to produce new pages that visually match the site. Uses WordPress core REST infrastructure only — no third-party MCP plugin required.
 * Version: 0.3.0
 * License: GPL-2.0-or-later
 */

defined( 'ABSPATH' ) || exit;

add_action( 'rest_api_init', 'wpmtb_register_routes' );

function wpmtb_register_routes() {
	register_rest_route(
		'wp-mcp-bridge/v1',
		'/theme-styles',
		array(
			'methods'             => 'GET',
			'callback'            => 'wpmtb_get_theme_styles',
			'permission_callback' => function () {
				return current_user_can( 'edit_pages' );
			},
			'args'                => array(
				'path' => array(
					'type'              => 'string',
					'default'           => '/',
					'description'       => 'Ruta relativa de la página a inspeccionar (ej: "/", "/sobre-nosotros/"). Por defecto la home.',
					'sanitize_callback' => 'sanitize_text_field',
				),
			),
		)
	);

	register_rest_route(
		'wp-mcp-bridge/v1',
		'/page-templates',
		array(
			'methods'             => 'GET',
			'callback'            => 'wpmtb_get_page_templates',
			'permission_callback' => function () {
				return current_user_can( 'edit_pages' );
			},
		)
	);

	register_rest_route(
		'wp-mcp-bridge/v1',
		'/asset-content',
		array(
			'methods'             => 'GET',
			'callback'            => 'wpmtb_get_asset_content',
			'permission_callback' => function () {
				return current_user_can( 'edit_pages' );
			},
			'args'                => array(
				'url' => array(
					'type'              => 'string',
					'required'          => true,
					'description'       => 'URL absoluta del asset (debe pertenecer al mismo sitio).',
					'sanitize_callback' => 'esc_url_raw',
				),
			),
		)
	);
}

/**
 * Issues the actual HTTP request behind wpmtb_fetch_rendered_html() and
 * wpmtb_get_asset_content(). A loopback request made from inside this same
 * container can't reach the host-mapped port (e.g. 8080 -> 80): Apache
 * listens on 80 internally. So we always connect to 127.0.0.1 and send the
 * real Host header WordPress expects, keeping the given path/query intact.
 */
function wpmtb_internal_request( $public_url ) {
	$parts       = wp_parse_url( $public_url );
	$home_parts  = wp_parse_url( home_url() );
	$host_header = $home_parts['host'] . ( ! empty( $home_parts['port'] ) ? ':' . $home_parts['port'] : '' );

	$internal_url  = 'http://127.0.0.1';
	$internal_url .= isset( $parts['path'] ) ? $parts['path'] : '/';
	$internal_url .= isset( $parts['query'] ) ? '?' . $parts['query'] : '';

	return wp_remote_get(
		$internal_url,
		array(
			'timeout'   => 15,
			'sslverify' => false,
			'headers'   => array(
				'Host'          => $host_header,
				'Cache-Control' => 'no-cache',
			),
		)
	);
}

/**
 * Fetches a page's rendered HTML via an internal HTTP request, so we get
 * exactly what a browser would receive regardless of how the active theme
 * generates its styles (theme.json, Customizer, a page builder, etc).
 */
function wpmtb_fetch_rendered_html( $path ) {
	$path       = '/' . ltrim( (string) $path, '/' );
	$public_url = home_url( $path );

	$response = wpmtb_internal_request( $public_url );

	if ( is_wp_error( $response ) ) {
		return $response;
	}

	$code = wp_remote_retrieve_response_code( $response );
	if ( $code >= 400 ) {
		return new WP_Error( 'fetch_failed', sprintf( 'La URL %s devolvió %d', $public_url, $code ) );
	}

	return array(
		'url'  => $public_url,
		'html' => wp_remote_retrieve_body( $response ),
	);
}

function wpmtb_to_absolute_url( $url ) {
	if ( 0 === strpos( $url, '//' ) ) {
		return ( is_ssl() ? 'https:' : 'http:' ) . $url;
	}
	if ( 0 === strpos( $url, 'http://' ) || 0 === strpos( $url, 'https://' ) ) {
		return $url;
	}
	return home_url( $url );
}

/**
 * REST callback for GET /wp-mcp-bridge/v1/theme-styles
 */
function wpmtb_get_theme_styles( WP_REST_Request $request ) {
	$path  = $request->get_param( 'path' );
	$fetch = wpmtb_fetch_rendered_html( $path );

	if ( is_wp_error( $fetch ) ) {
		return new WP_REST_Response( array( 'error' => $fetch->get_error_message() ), 502 );
	}

	$dom = new DOMDocument();
	libxml_use_internal_errors( true );
	$dom->loadHTML( $fetch['html'], LIBXML_NOWARNING | LIBXML_NOERROR );
	libxml_clear_errors();

	$stylesheets = array();
	foreach ( $dom->getElementsByTagName( 'link' ) as $link ) {
		if ( 'stylesheet' === strtolower( $link->getAttribute( 'rel' ) ) ) {
			$href = $link->getAttribute( 'href' );
			if ( $href ) {
				$stylesheets[] = wpmtb_to_absolute_url( $href );
			}
		}
	}

	$inline_styles = array();
	foreach ( $dom->getElementsByTagName( 'style' ) as $style ) {
		$css = trim( $style->textContent );
		if ( '' !== $css ) {
			$inline_styles[] = $css;
		}
	}

	$scripts        = array();
	$inline_scripts = array();
	foreach ( $dom->getElementsByTagName( 'script' ) as $script ) {
		$src = $script->getAttribute( 'src' );
		if ( $src ) {
			$scripts[] = wpmtb_to_absolute_url( $src );
		} else {
			$js = trim( $script->textContent );
			if ( '' !== $js ) {
				$inline_scripts[] = $js;
			}
		}
	}

	$theme = wp_get_theme();

	return new WP_REST_Response(
		array(
			'inspected_url'  => $fetch['url'],
			'theme'          => array(
				'name'       => $theme->get( 'Name' ),
				'stylesheet' => get_stylesheet(),
				'template'   => get_template(),
			),
			'stylesheets'    => array_values( array_unique( $stylesheets ) ),
			'scripts'        => array_values( array_unique( $scripts ) ),
			'inline_styles'  => $inline_styles,
			'inline_scripts' => $inline_scripts,
		),
		200
	);
}

/**
 * REST callback for GET /wp-mcp-bridge/v1/page-templates
 *
 * Core's wp/v2/pages schema no longer publishes the valid `template` values
 * (they're checked by a validate callback), so expose them here with their
 * human-readable names. "" is always valid and means the theme default.
 */
function wpmtb_get_page_templates() {
	$templates = array(
		array(
			'file' => '',
			'name' => 'Default',
		),
	);
	foreach ( wp_get_theme()->get_page_templates( null, 'page' ) as $file => $name ) {
		$templates[] = array(
			'file' => $file,
			'name' => $name,
		);
	}

	return new WP_REST_Response( $templates, 200 );
}

/**
 * REST callback for GET /wp-mcp-bridge/v1/asset-content
 */
function wpmtb_get_asset_content( WP_REST_Request $request ) {
	$url = $request->get_param( 'url' );

	$site_host  = wp_parse_url( home_url(), PHP_URL_HOST );
	$asset_host = wp_parse_url( $url, PHP_URL_HOST );

	if ( $asset_host !== $site_host ) {
		return new WP_REST_Response( array( 'error' => 'Solo se permiten assets del mismo sitio.' ), 400 );
	}

	$response = wpmtb_internal_request( $url );

	if ( is_wp_error( $response ) ) {
		return new WP_REST_Response( array( 'error' => $response->get_error_message() ), 502 );
	}

	return new WP_REST_Response(
		array(
			'url'          => $url,
			'content_type' => wp_remote_retrieve_header( $response, 'content-type' ),
			'content'      => wp_remote_retrieve_body( $response ),
		),
		200
	);
}
