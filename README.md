# orbiteval.com

Public site for Orbit, an independent verification body for deployed robots.

Static HTML, no build step. Pages: `index.html`, `method.html`, `registry.html`,
`calibration.html`, `specimen-report.html`, `demo.html`. Shared `site.css` and `site.js`.

Look (2026-09-20, founder's choice): dark, warm near-black paper with warm off-white ink,
modelled on tryclean.ai's landing page. Inter for headlines, Mona Sans for text, JetBrains
Mono for every number. One floating pill nav, a product view under the hero, rounded cards,
and a single action everywhere: book a demo. Tokens live at the top of `site.css`.

The header, `<head>` block, and footer are identical on every page; canonical copies live in
`build/partials/` so an edit can be applied to all six files with a find-and-replace.

"Book a demo" composes an email to rahil@orbiteval.com. To route it to a calendar link
instead, set `DEMO_URL` at the top of `site.js`.

The specimen report uses illustrative data and is labelled as such on the page. No
calibration figure is shown anywhere until a real human-agreement study exists.

## Legacy pages

`arena.html`, `battle.html`, `atlas.html`, `noisefloor.html`, `chat.html`, `check.html`,
`about.html`, `shell.css`, and the `data/`, `sample/`, `wheels/`, `notes/` folders are the
previous site (the capability arena). They are not linked from the new pages but remain at
their URLs so existing links resolve. Delete when no longer needed.
