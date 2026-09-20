# orbiteval.com

Public site for Orbit, an independent verification body for deployed robots.

Static HTML, no build step. Pages: `index.html`, `method.html`, `registry.html`,
`calibration.html`, `specimen-report.html`, `demo.html`. Shared `site.css` and `site.js`.

Look (2026-09-20): warm cream paper, near-black ink, terracotta brand and links; Manrope for
headlines and big figures, Figtree for text, IBM Plex Mono for IDs and columns. One floating
pill nav, the live workspace framed under the hero, rounded cards, one action: book a demo.
Tokens live at the top of `site.css`. `DESIGN_ORIGINALITY.md` records what was inspired by
another site and what was changed so the design is ours.

## Workspace

`app.html` + `app.css` + `app.js` is a static, no-login workspace: deployments, grade pages
(the Reading, breakdown, trend, scorer error, sample, history, evidence index), reports,
registry lookup, calibration, protocols. It reads `app-data.json`; add a deployment there and
it appears everywhere. `python3 build/badges.py` regenerates the static badges in `badge/`.
The homepage embeds `app.html?embed=1#/d/ORB-0000-SPEC` under the hero.

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
