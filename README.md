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

## Building the evidence pages

The Claim Check, Decision card and "Is it real?" pages are generated from
the sensitivity study, which lives on branch `aistats2027-sensitivity`
(worktree `~/Orbit-Research-aistats`). Do not hand-edit the generated
files.

    python3 build/build.py                 # regenerate everything
    python3 build/build.py --check         # run the register guard only
    python3 build/build.py --study PATH    # point at a different checkout

The build fails, rather than skipping, when the research source is missing:
a site that quietly keeps serving last month's numbers is the exact failure
its own Claim Check page is about.

It also enforces `OVERLAP_REGISTER.md` mechanically. That register permits
publishing rejection rates and calibration from the banked panels and
forbids publishing a retraining-noise magnitude, which belongs to a sibling
paper still under review. The guard fails the build on a forbidden key and
on the *shape* of a per-seed vector under any name, because the first
version of the decision page shipped a per-run matrix and a spread column
and was live before anyone caught it.

Generated, never edited by hand:

| file | written by |
|---|---|
| `claims-data.json` / `.js` | `build/claims_export.py` |
| `decision-data.json` / `.js` | `build/decision_export.py` |
| `build-stamp.js` | `build/build.py` |
| `source/*.json` | vendored inputs, copied by `build/build.py` |

Every page prints the build commit, the corpus hash and the generation time
in its footer, and flags a build older than thirty days.
