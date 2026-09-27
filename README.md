# orbiteval.com

Public site for OrbitEval: evidence for machines with AI entering Europe.

Static HTML, no build step for the pages. The home page (`index.html`) links to the free
EU Readiness Check (`eu-check.html`): no login, nothing stored. Its rules and every sentence
about the regulation live in `eu-check-logic.js`; interval maths in `stats.js`, shared with
`real.html`. `eu-check-config.js` holds the AI reader's address; empty means the reader is off
and the check works by hand. `eu-check-example.json` is a real public model card, read once by
the AI reader and checked by code.

    node build/test_eu_check.js      # the check's rules, maths and page wiring
    node build/test_site_pages.js    # links, shared chrome, home figures
    python3 build/apply_chrome.py    # write build/partials/ header and footer into every page

Look: warm cream paper, near-black ink, terracotta brand and links; Manrope, Figtree, IBM Plex
Mono. Tokens live at the top of `site.css`. `DESIGN_ORIGINALITY.md` records what was inspired by
another site and what was changed.

"Book a call" composes an email to rahil@orbiteval.com. To route it to a calendar link instead,
set `DEMO_URL` at the top of `site.js`.

## Legacy pages

`arena.html`, `battle.html`, `atlas.html`, `noisefloor.html`, `chat.html`, `check.html`,
`about.html`, `shell.css`, and the `data/`, `sample/`, `wheels/`, `notes/` folders are the
previous site (the capability arena). They are not linked from the new pages but remain at
their URLs so existing links resolve. Delete when no longer needed.

`decision.html`, `release-check.html`, `record.html`, `real.html`, `calibration.html` and
`method.html` are not linked from the menu but stay at their URLs.

## Building the evidence pages

The Claim Check, Decision card and "Is it real?" pages are generated from
the sensitivity study, which lives on branch `aistats2027-sensitivity`
(worktree `~/Orbit-Research-aistats`). Do not hand-edit the generated
files.

The Claim Check itself is computed from Corpus 2 v2 in Orbit-Research, read
through `research/audit_corpus/corpus2.py`, with the study's own functions
(`claims.classify`, `core.sigma_star`, the retraining-noise band). Nothing
about a claim is recomputed here.

    python3 build/build.py                 # regenerate everything
    python3 build/build.py --check         # run the register guard only
    python3 build/build.py --study PATH    # point at a different checkout
    python3 build/build.py --corpus2-dir PATH   # research/audit_corpus of an Orbit-Research checkout

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
