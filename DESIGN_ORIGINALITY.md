# Design originality note

Written 2026-09-20, after the founder pointed at tryclean.ai as the feel he wanted and then asked
that orbiteval.com must not be mistaken for a copy of it. This is the guideline for that.
It is a plain summary from general knowledge, not legal advice; for a real dispute, ask a lawyer.

## What is protected, in plain terms

- **Copyright** covers specific expression: source code, written copy, photographs, illustrations,
  icons drawn by them, logos. It does not cover a layout, a colour scheme, a font choice, or a
  general "look and feel".
- **Trade dress** covers a distinctive overall look that customers already associate with one
  company, where a copy would confuse buyers. It needs the same market and real confusion.
- **Trademarks** cover names, logos and slogans.

Orbit sells robot verification; Clean sells sales leads. No buyer would confuse the two. The
practical risk is therefore only copied material, so the rule is: copy nothing.

## What we did not take

- No HTML, CSS, JavaScript, images, icons, font files, logos or copy from tryclean.ai. Every file
  in this repository was written for Orbit.
- No customer logos, team photos, testimonials, investor marks or slogans.
- Icons are hand-drawn 24-unit strokes of common shapes (document, list, clock, code, arrow).

## What was inspired, and what was changed so it is ours (second pass, same evening)

| Reference trait | Orbit now |
|---|---|
| warm brown-black paper, warm off-white ink | warm cream paper `#FAF9F5`, near-black ink `#141413`, terracotta brand `#D4744F`. The founder asked for colours in the family Claude uses; the values are our own, and no Anthropic mark, name or wordmark appears anywhere |
| Inter headlines, Mona Sans text, blue links | Manrope headlines, Figtree text, IBM Plex Mono for IDs and columns, terracotta links |
| nav pill with the brand in the centre | pill with the brand on the left |
| screenshot of the product on a photograph | the real workspace, embedded live, in a framed window |
| four-item accordion beside a photo card with a floating panel | four numbered steps that switch a plain document sheet (protocol, sample manifest, scoring sheet, grade). Tabs-that-switch-a-preview is a pattern used by Stripe, Linear, GitHub and many others; the sheet, the artifacts and the styling are ours, and there is no photograph |
| three full-width alternating rows | two half cards and one wide |
| two-column FAQ with chevrons | one centred column with a plus marker |
| "Stop hunting. Start closing." | "A number they can check." |
| grain overlay, iridescent text-shadow | removed |
| customer-logo strip | one line of links to what we publish |
| six-column footer | one row |

What stayed is the general register both sites share with hundreds of others: a dark surface,
a short headline over a one-sentence sub, pill buttons, rounded cards, a product view under the
hero, one call to action. None of that belongs to anyone.

## Checklist for any future page

1. Never copy code, copy, images, icons or fonts from another site. Read for the idea, close
   the tab, write.
2. No other company's name, logo, customers, quotes or slogans.
3. Use the Orbit tokens in `site.css`. Do not paste another site's palette values.
4. Structure follows Orbit's own content (the Reading, the registry, the re-check), not another
   site's section order.
5. If a page could be mistaken for another company's at a glance, change it until it could not.
