# Sources (as of research date; Avada docs URLs redirect to classic.avada.com)

- Gutenberg/Avada Builder mutual exclusivity, Global Color Palette from 7.10.0: avada.com/documentation/avada-and-wordpress-gutenberg-compatibility/
- Flexbox container/column redesign: avada.com/documentation/flexbox-for-containers-and-columns/
- Container element (UI only, no attribute table): avada.com/documentation/container-element/
- Column element (UI only, no attribute table): avada.com/documentation/column-element/
- Code Block element (UI only; exact tag `[fusion_code]` and base64/"Code Block Encoding" behavior confirmed via cross-referencing, not stated directly on this page): avada.com/documentation/code-block-element/
- Global color CSS custom properties `--awb-color1`, `--awb-color2`, ... (community source, stronger on specifics than ThemeFusion's own page): awb4wp.com/general/css-variables-in-avada/, awb4wp.com/avada-updates/global-colors/
- Global Options panel location confirmation: avada.com/documentation/avada-global-options/
- Real, current shortcode file inventory (live site plugin directory, not docs — high confidence for "which elements exist", zero confidence for attributes): https://www.statmedevac.com/wp-content/plugins/fusion-builder/shortcodes/

## Confirmed live (2026-09-13, local install: Avada + Fusion Builder 3.12, wp-mcp project)

Fetched the real compiled CSS (`get_theme_styles` → `stylesheets[0]` → `get_asset_content`; Avada writes it to `wp-content/uploads/fusion-styles/<hash>.min.css`, not an inline `<style>` tag — different mechanism than Astra, still caught by the same theme-agnostic MCP tools). Confirmed present in `:root`, ~1200 total `--awb-*` custom properties, mostly per-component (e.g. `--awb-button-font-size`, `--awb-arrow-border-color`) — but these are GLOBAL and safe to rely on across sites:

- `--awb-color1` .. `--awb-color8`, each with `-h`/`-s`/`-l`/`-a` components. On this install: color1 `rgba(255,255,255,1)` (white), color4 `rgba(101,189,125,1)` (accent green), color5 `rgba(25,143,217,1)` (primary blue — aliased as `--primary_color`), color8 `rgba(20,22,23,1)` (near-black, body/heading text via `--body_typography-color`/`--h1_typography-color`/etc.). **Exact hex/rgba values are per-site — re-fetch, don't reuse these.**
- `--awb-typography1-font-family` / `-font-size` / `-font-weight` / `-font-style` / `-line-height` / `-letter-spacing` / `-text-transform`, repeated for `typography1`..`typography5` (1 = largest heading scale down to 5 = smallest/meta text). `h1`..`h6` reference `--awb-typography1-*` with per-level `font-size` overrides.
- `--site_width` (page content max-width, e.g. `1200px` on this install) and `--site_width-int` (unitless).

No live example page using Fusion Builder shortcodes existed on this install as of this check — a new page's raw `content` is still the best attribute-syntax reference once one exists; these confirmed variables only cover global color/typography/width tokens, not per-element attribute names (still a gap, see below).

## Re-checked live (2026-11-13, same install after importing the "Retro" demo)

- Token **values changed** with the demo import (now color2 `#faf1e2` cream, color4 `#e75438` coral, color8 `#1f2020`; typography1 "Yeseva One" 56px, typography2–5 "Quattrocento Sans"; `--site_width` 1280px) — proof that the values above must always be re-fetched. Token **names** were stable.
- `fusion_code` base64 body, `class`/`id` attributes, `fusion_builder_status` cleanup of `wpautop`, `100-width.php` template and the DOM/CSS behavior in `css-integration.md` all confirmed on this install. Mechanism of the cleanup: `FusionBuilder::fix_builder_shortcodes()` in `fusion-builder/inc/class-fusion-builder.php` runs only when `fusion_builder_status === 'active'` (or `fusion_builder_converted === 'yes'`).

## Known gaps (do not fill from memory)

- Per-shortcode attribute reference (ThemeFusion doesn't publish one).
- Flexbox alignment/justification attribute names.
- Official nesting-limit/performance/accessibility guidance for Fusion Builder content.
