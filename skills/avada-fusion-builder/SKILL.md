---
name: avada-fusion-builder
description: "Trigger: Avada, Fusion Builder, fusion_builder_container. Author WordPress pages as native Fusion Builder shortcodes instead of raw HTML, so pages stay editable in Avada's visual builder."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.1"
---

# Avada / Fusion Builder Page Authoring

## Hard Rules

1. **Never mix formats in one page.** Avada Builder (shortcodes) and Gutenberg blocks are mutually exclusive per page — a page built with one cannot be edited with the other. Check an existing page's raw `content` first; match its format. For a brand-new page on an Avada site, default to Fusion Builder shortcodes.
2. **Native element first, always.** Reach for a Fusion Builder shortcode (see `references/elements.md`) before writing raw HTML. Only drop to the `[fusion_code]` escape hatch when no native element can reach the required visual result — never for convenience.
3. **Never invent shortcode attributes OR nesting structure from memory.** ThemeFusion documents the UI, not an attribute reference. Before using any element type not yet seen on this exact site, fetch a real existing page's raw content (`get_page`, needs `context=edit` for `content.raw`) and copy its actual attribute syntax. Several elements are parent/child pairs (`fusion_content_boxes`>`fusion_content_box`, `fusion_accordion`>`fusion_toggle`, `fusion_tabs`>`fusion_tab`, `fusion_checklist`>`fusion_li_item`, `fusion_images`>`fusion_image`) — using the child standalone or guessing the wrapper's name is as broken as a wrong attribute. If the first page you check doesn't have the element you need, check another before guessing.
4. **`[fusion_code]` fallback must use the site's real tokens**, never hardcoded hex/px. Confirmed global vars (names stable across sites, values aren't — always re-fetch): `--awb-color1`..`--awb-color8`, `--awb-typography1`..`5` (each with `-font-family`/`-font-size`/`-font-weight`/`-line-height`/`-letter-spacing`), `--site_width`. Get real values via `get_theme_styles` → `stylesheets[]` → `get_asset_content` (Avada compiles to a physical file under `wp-content/uploads/fusion-styles/`, not inline `<style>`). Details: `references/sources.md`.
5. `[fusion_code]` needs the author's `unfiltered_html` capability (WP admin) and Avada → Global Options → **Code Block Encoding** enabled. If injected code doesn't render, that setting is the first thing to check. With encoding on, the body is **base64** (confirmed live: `[fusion_code]PHN0eWxlPi4uLg==[/fusion_code]`); in the wp-mcp `execute` sandbox use `base64Encode(html)`.
6. **Mark every page you create as a Fusion Builder page**: `meta: { fusion_builder_status: "active" }`. Without it WordPress' `wpautop` leaves empty `<p></p>` between shortcodes (each with a real ~20px margin — shows up as white strips above the first and below the last container), and the page opens in the classic editor instead of the builder. Avada only runs its cleanup (`fix_builder_shortcodes`) when this meta is `active` — every demo-imported page has it. REST drops unregistered meta silently: it needs wp-mcp-theme-bridge ≥ 0.4.0, and you must check that `meta.fusion_builder_status` comes back in the response.

## Decision Gates

| Need | Reach for | Fallback only if it can't achieve the look |
|---|---|---|
| Heading | `fusion_title` (plain text/URL only) | `fusion_code` |
| Rich text / body copy with inline HTML | `fusion_text` (accepts nested `<p>`, links, bold) | `fusion_code` |
| CTA button | `fusion_button` | `fusion_code` |
| Feature grid / icon cards | `fusion_content_boxes` > `fusion_content_box` children | `fusion_code` |
| Image gallery | `fusion_images` > `fusion_image` children (confirmed — not `fusion_gallery`, unconfirmed) | `fusion_code` |
| FAQ / collapsible | `fusion_accordion` > `fusion_toggle` children (never bare) | `fusion_code` |
| Tabs | `fusion_tabs` > `fusion_tab` children (content allows nested HTML) | `fusion_code` |
| Checklist | `fusion_checklist` > `fusion_li_item` children | `fusion_code` |
| Before/after, counters, testimonials, pricing, team | — (unconfirmed on any real site seen so far) | `fusion_code`, tokens per Rule 4 |
| Anything bespoke/animated | Native elements + their `class` attribute, styled by ONE `fusion_code` holding a `<style>` (content stays editable in the builder) | Markup inside `fusion_code`, tokens per Rule 4 |

Full element inventory and container/row/column structure: `references/elements.md`. Layout/CSS behavior of Avada's rendered DOM (full-width pages, flex overrides, sticky, where to put `fusion_code`, footer): `references/css-integration.md` — read it before writing any custom CSS. Source URLs and confirmed-vs-gap notes: `references/sources.md`.

## Execution Steps

Tool names: wp-mcp exposes either classic tools (`get_theme_styles`, `get_page`, `create_page`…) or, in Code Mode, one `execute` tool with the same operations as `wp.theme.styles()`, `wp.pages.get()`, `wp.pages.create()`… Prefer `execute` when available: extract tokens from the ~1 MB compiled CSS and calibrate against several pages inside one snippet, returning only the summary.

1. Confirm the target theme is Avada via `get_theme_styles` (`theme.name`/`theme.template`).
2. Pull one real existing page's raw `content` via `get_page` (ask the user which, or use the first non-trivial page from `list_pages`) as your attribute-syntax reference — do this before writing any element type you haven't already seen on this site.
3. Decide the page template: if any container has a background color/image, use `template: "100-width.php"` (list options with `wp.pages.templates()`) plus the `#main` padding reset — see `references/css-integration.md`. The default template boxes every container to `--site_width` and leaves white margins around backgrounds.
4. Build `fusion_builder_container` > `fusion_builder_row` > `fusion_builder_column` (width via `type="1_3"` etc., sixths grid; use `_inner` row/column variants to nest). See `references/elements.md`.
5. Map each content need to a native element via the table above; only use `fusion_code` per Rules 2–5.
6. Validate shortcode nesting (every opened `fusion_*` tag closed in order) before writing, then create/update via `create_page`/`update_page` with `meta.fusion_builder_status = "active"` (Rule 6) and the chosen `template`.
7. Verify the rendered page, not just the API response: no `<p></p>` inside `.post-content`, first container touching the header, last container touching the footer, no horizontal overflow at phone width.

## Output Contract

Report: which native elements you used, whether you used `fusion_code` and why a native element couldn't do it, and which real page you calibrated attribute syntax against.
