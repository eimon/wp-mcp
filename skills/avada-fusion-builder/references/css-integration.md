# Custom CSS on Avada's rendered DOM

Confirmed live on 2026-11-13 (Avada + Fusion Builder 3.12, "Retro" demo, wp-mcp project) while building a
page that animates native elements with CSS scroll-driven animations. Every item below was a real bug on
the first attempt; the fix is what's documented.

## Full-width pages without white gaps

The default template boxes every container to `--site_width`: a container with `background_color` shows
white margins on both sides, and `#main` adds `padding: 55px … 45px` (via `--main_padding-top/bottom`).

1. Create/update the page with `template: "100-width.php"` (Avada's "100% Width"). Container backgrounds
   then reach the viewport edges; with `hundred_percent="no"` the *content* stays at `--site_width`.
2. Reset `#main`'s padding in the page's `fusion_code` `<style>` (the page ID is known after the first create):
   `.page-id-<ID> #main{padding-top:0!important;padding-bottom:0!important}`
3. Mark the page as a builder page (`fusion_builder_status = "active"`, SKILL.md Rule 6). Otherwise
   `wpautop` adds an empty `<p></p>` before the first and after the last container; its 20px margin
   collapses through `#content` and leaves a white strip under the header / above the footer even with
   step 2 done. Hiding `p:empty` with CSS hides the symptom; the meta removes the cause.
4. The footer widget area (`.fusion-footer-widget-area`) renders even with zero widgets: 1px on desktop,
   ~100px on tablet and ~200px on phones, transparent background. If the site has no footer widgets, the
   real fix is Avada → Global Options → Footer → disable Footer Widgets (site-wide; ask the user). Per page:
   `.page-id-<ID> .fusion-footer-widget-area:not(:has(.widget)){display:none}`.

## Hooking CSS onto native elements

- The `class="…"` attribute renders on: `fusion_builder_container` (on `.fusion-fullwidth`),
  `fusion_builder_column` (on `.fusion-layout-column`), `fusion_text`, `fusion_title`, `fusion_checklist`,
  `fusion_content_boxes`. `id="…"` renders on containers (usable as `#anchor` link targets).
- Rendered markup to target:
  - container `.fusion-fullwidth` > `.fusion-builder-row.fusion-row` > `.fusion-layout-column` > `.fusion-column-wrapper` > elements
  - `fusion_checklist` → `ul` > `li.fusion-li-item`
  - `fusion_content_boxes` → each box is `.content-box-column`
  - `fusion_text` → `div.fusion-text` with your HTML inside
- `fusion_text` always runs `wpautop` on its own content (in `fusion-text.php`, regardless of builder status):
  an inline element at the top level (`<span>`) gets wrapped/followed by `<p>`, breaking grid/flex layouts.
  Use block elements (`<div>`, `<h3>`, `<p>`) at the top level of a `fusion_text`.
- Theme typography applies to your HTML too (e.g. Retro sets `text-transform: capitalize` on headings):
  check the rendered result before assuming your markup's casing survives.

## Layout traps

- **Columns are forced to `flex-direction: column`** by
  `.fusion-flex-container .fusion-row .fusion-flex-column .fusion-column-wrapper:not(.fusion-flex-column-wrapper-legacy).fusion-content-layout-column`.
  To lay a column's elements out in a row, match it:
  `.my-col > .fusion-column-wrapper.fusion-content-layout-column{flex-direction:row!important;flex-wrap:nowrap!important}`.
  A column whose content is wider than the viewport also needs `width:max-content!important;flex:0 0 auto!important`.
- **`position: sticky` works.** `body` has `overflow-x:hidden`, but `html` stays `visible`, so the overflow
  propagates to the viewport and body is not a scroll container. `#boxed-wrapper` uses `overflow-x:clip`,
  which also doesn't break sticky. A full-bleed breakout inside the default template
  (`width:100vw;margin-left:calc(50% - 50vw)`) doesn't cause horizontal scroll for the same reason.
- **Never put `fusion_code` inside an element you animate or transform.** A `position:fixed` element (e.g. a
  reading-progress bar) inside a container whose row animates `transform` gets that row as its containing
  block and scrolls away with it. Put the `fusion_code` in a static container (the last one works well).
- Avada's own entrance animations (`animation_type` attributes, `revealContent`, etc.) run on the document
  timeline; don't add them to elements you also drive with `animation-timeline`.

## Scroll-driven animations (verified working)

Wrap them in `@supports (animation-timeline: view())` and `@media (prefers-reduced-motion: no-preference)`,
with the static layout outside, so unsupported browsers get the same content without motion. Confirmed on
native elements: reading progress (`scroll(root block)`), hero fade-out (`view()` exit range on the
container's row), fly-in list (`view()` on `.fusion-li-item`), stacking cards (named `view-timeline` on the
column, `exit-crossing` ranges per `fusion_text`), horizontal scroll section (container as the tall pin,
its row `position:sticky;height:100vh;overflow-x:clip`, the column as the translated track), and
clip-path reveal on `.content-box-column`.
