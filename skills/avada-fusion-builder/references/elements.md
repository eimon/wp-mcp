# Fusion Builder element reference

## Base structure

```
[fusion_builder_container ...]
  [fusion_builder_row]
    [fusion_builder_column type="1_3"] ... [/fusion_builder_column]
    [fusion_builder_column type="2_3"]
      [fusion_builder_row_inner]
        [fusion_builder_column_inner type="1_2"] ... [/fusion_builder_column_inner]
        [fusion_builder_column_inner type="1_2"] ... [/fusion_builder_column_inner]
      [/fusion_builder_row_inner]
    [/fusion_builder_column]
  [/fusion_builder_row]
[/fusion_builder_container]
```

**One row per container.** Confirmed across TWO real demo imports ("Avada Portfolio": 2/2; "Avada Retro": 69/69 containers/rows, zero exceptions): every top-level `fusion_builder_container` wraps exactly ONE `fusion_builder_row` — never multiple sections stacked inside a shared container. Verified failure mode: two `fusion_builder_row`s inside one `fusion_builder_container` under `type="flex"` render as flex siblings that can sit side-by-side instead of stacking vertically, breaking the layout. One section = one container + one row, full stop.

Column width (`type` attribute): sixths grid — `1_1`, `1_2`, `1_3`, `1_4`, `1_5`, `1_6`, `2_3`, `3_4`, `5_6`, etc. Confirmed real example also used a bare percentage-style value (`type="42"`), so non-sixth fractions are also valid.
Container/column layout is flexbox-based in current Avada versions. Confirmed real flexbox attribute names (from the same demo page): container takes `type="flex"`, `align_content`, `flex_align_items`, `flex_justify_content`, `flex_wrap`; column takes `align_self`, `content_layout`, `align_content`, `valign_content`, `content_wrap`. `fusion_builder_row` is commonly used completely bare (`[fusion_builder_row]`, no attributes) — Fusion Builder shortcodes tolerate missing attributes and fall back to internal defaults, so omit anything not load-bearing rather than guessing full attribute lists.

**Inner content format varies by element — check which kind before writing it.** `fusion_title`/`fusion_button`/`fusion_imageframe` take plain text or a bare URL, no nested tags: `[fusion_title size="1"]Heading text[/fusion_title]` (size 1–6 = heading levels, `size="div"` = plain `<div>` for body copy), `[fusion_button link="URL" title="..."]Button label[/fusion_button]`, `[fusion_imageframe ...]https://.../image.jpg[/fusion_imageframe]`. But `fusion_text` and `fusion_tab` DO accept nested basic HTML (confirmed: `<p>`, `<img>`, bold/links) — `[fusion_text]<p>Body copy.</p>[/fusion_text]`. Don't assume one pattern for every element; when in doubt match what the real calibration page does for that exact tag.

**Shortcode attribute values can reference site tokens directly**: confirmed real usage like `font_size="var(--awb-typography3-font-size)"` and `fusion_font_family_button_font="var(--awb-custom_typography_2-font-family)"` as literal attribute values — not just inside a `fusion_code` fallback's raw CSS.

Nesting: use `fusion_builder_row_inner` / `fusion_builder_column_inner` for columns inside columns, not the top-level `fusion_builder_row`/`fusion_builder_column`.

**`class` / `id` attributes (confirmed live 2026-11-13):** `class="..."` renders on containers, columns, `fusion_text`, `fusion_title`, `fusion_checklist` and `fusion_content_boxes`; `id="..."` renders on containers. This is the way to attach custom CSS to native elements — see `css-integration.md` for the rendered markup to target.

## Confirmed real shortcode inventory

Source: live `wp-content/plugins/fusion-builder/shortcodes/` directory on a current Avada install (file → shortcode name: hyphens become underscores, e.g. `fusion-content-boxes.php` → `[fusion_content_boxes]`).

**Content elements (most relevant for page authoring):**
`fusion_title`, `fusion_text`, `fusion_button`, `fusion_separator`, `fusion_section_separator`, `fusion_image`, `fusion_image_carousel`, `fusion_image_before_after`, `fusion_image_hotspots`, `fusion_gallery`, `fusion_content_boxes`, `fusion_counters_box`, `fusion_counters_circle`, `fusion_testimonials`, `fusion_tabs`, `fusion_toggle`, `fusion_checklist`, `fusion_pricing_table`, `fusion_person`, `fusion_flip_boxes`, `fusion_modal`, `fusion_popover`, `fusion_tooltip`, `fusion_widget_area`, `fusion_menu_anchor`, `fusion_one_page_link`.

**Code/raw escape hatch:** `fusion_code` — see SKILL.md Rules 2, 4, 5.

**Other confirmed elements (long tail, use only if specifically needed):**
`fusion_alert`, `fusion_audio`, `fusion_blog`, `fusion_breadcrumbs`, `fusion_chart`, `fusion_circles_info`, `fusion_contact_form7`, `fusion_convertplus`, `fusion_countdown`, `fusion_dropcap`, `fusion_facebook_page`, `fusion_flickr`, `fusion_fontawesome`, `fusion_google_map`, `fusion_gravity_form`, `fusion_highlight`, `fusion_instagram`, `fusion_layer_slider`, `fusion_lightbox`, `fusion_lottie`, `fusion_news_ticker`, `fusion_open_street_map`, `fusion_post_cards`, `fusion_post_slider`, `fusion_progress`, `fusion_recent_posts`, `fusion_revolution_slider`, `fusion_scroll_progress`, `fusion_search`, `fusion_slider`, `fusion_social_links`, `fusion_social_sharing`, `fusion_soundcloud`, `fusion_star_rating`, `fusion_stripe_button`, `fusion_submenu`, `fusion_syntax_highlighter`, `fusion_table_of_contents`, `fusion_table`, `fusion_tagcloud`, `fusion_tagline`, `fusion_twitter_timeline`, `fusion_user_login`, `fusion_video`, `fusion_views_counter`, `fusion_vimeo`, `fusion_widget`.

**WooCommerce-only (ignore unless the target page is a shop page):** `fusion_woo_*` (10 variants), `woo_checkout_*` (5 variants), `woo_mini_cart`, `woo_notices`, `woo_upsells`.

## Confirmed parent/child elements (from real "Avada Retro" demo pages)

Several elements are always a PARENT wrapping repeated CHILD shortcodes — not standalone. Confirmed real usage:

**Feature grid** — `fusion_content_boxes` (parent) > `fusion_content_box` (one child per box):
```
[fusion_content_boxes layout="icon-on-top" columns="3" heading_size="2" icon_align="left" icon_size="80" iconcolor="var(--awb-color4)" icon_circle="yes" circlecolor="hsla(var(--awb-color2-h),var(--awb-color2-s),var(--awb-color2-l),calc(var(--awb-color2-a) - 50%))"]
  [fusion_content_box linktext="Learn More" title="Our Mission" icon="fusion-prefix-retro-mission"]<p>Body text.</p>[/fusion_content_box]
  ... one fusion_content_box per box, no separator ...
[/fusion_content_boxes]
```

**FAQ/accordion** — `fusion_accordion` (parent) > `fusion_toggle` (one child per item). `fusion_toggle` was NEVER used standalone (bare) in the real demo — always nested in `fusion_accordion`:
```
[fusion_accordion border_size="1" title_tag="h4" icon_size="24" inactive_icon="fa-arrow-alt-circle-up far" active_icon="fa-arrow-alt-circle-down far" icon_color="var(--awb-color5)" boxed_mode="no"]
  [fusion_toggle title="How can I book a project consultation?" open="no"]Plain answer text.[/fusion_toggle]
[/fusion_accordion]
```

**Tabs** — `fusion_tabs` (parent) > `fusion_tab` (one child per tab). `fusion_tab` content DOES accept nested HTML (`<img>`, `<p>`) — the plain-text-only rule above does not apply to it:
```
[fusion_tabs design="classic" layout="horizontal" justified="yes" title_tag="h4" mobile_mode="accordion"]
  [fusion_tab title="Strategy" icon="fa-heart far"]<img class="alignleft" src="..." alt="" width="300" height="232" /><p>Body copy.</p>[/fusion_tab]
[/fusion_tabs]
```

**Checklist** — `fusion_checklist` (parent) > `fusion_li_item` (child, no attributes ever):
```
[fusion_checklist type="icons" iconcolor="var(--awb-color4)" circlecolor="var(--awb-color2)" icon="fa-arrow-alt-circle-right far"]
  [fusion_li_item]<p>UI/UX Design</p>[/fusion_li_item]
  [fusion_li_item]Branding &amp; Identity[/fusion_li_item]
[/fusion_checklist]
```

**Manual image gallery** — `fusion_images` (parent, plural — different tag from `fusion_gallery`, which never appeared in either demo) > `fusion_image` (self-closing child, singular):
```
[fusion_images order_by="desc" picture_size="auto" hover_type="zoomin" columns="3" column_spacing="50" lightbox="yes" caption_style="below"]
  [fusion_image image="https://.../file.jpg" image_id="1883|full" linktarget="_self" image_title="Mark Smail" image_caption="CEO & Founder" /]
[/fusion_images]
```

**Rich text block** — `fusion_text` is its own shortcode (NOT a `fusion_title` variant), very common, accepts nested HTML: `[fusion_text content_alignment="center" font_size="var(--awb-typography2-font-size)"]<p>Body copy.</p>[/fusion_text]`.

**Popover**: `[fusion_popover trigger="hover" title="Heading" content="<base64-encoded-string>"]Trigger label[/fusion_popover]` — the `content` attribute (popover body) is base64-encoded, not plain text.

## What is NOT confirmed (don't guess)

Checked against two real demo imports ("Avada Portfolio" + "Avada Retro", 10+ pages) and genuinely absent from both — treat as an honest gap, don't invent syntax for these until seen on a real site: `fusion_separator`, `fusion_section_separator`, `fusion_counters_box`, `fusion_counters_circle`, `fusion_testimonials`, `fusion_pricing_table`, `fusion_person`, `fusion_gallery` (note: `fusion_images`/`fusion_image` IS confirmed, see above — `fusion_gallery` specifically is not), `fusion_flip_boxes`, `fusion_form`, `fusion_lottie`.

Still genuinely undocumented anywhere (ThemeFusion documents via UI screenshots, not a code reference table) for elements not covered above:
- Any nesting-limit, performance, or accessibility guidance from ThemeFusion for authoring Fusion Builder content.

For all of the above: read a real page on the target site (`get_page`) and/or its rendered CSS (`get_theme_styles`, `get_asset_content`) rather than assuming.
