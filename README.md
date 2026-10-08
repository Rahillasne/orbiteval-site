# orbiteval.com

The site is one page: **Sandtable · Dallas**, a live board of every Dallas police unit on a scene, from the City of
Dallas's own public feeds, with Orbit, an assistant you can ask.

- This repository holds the static page (published by GitHub Pages at orbiteval.com). It talks to the board's live
  server on Cloud Run (`sandtable-dallas`, project `orbiteval`), named in `<meta name="sandtable-api">`.
- The page is copied here by `live/publish_site.sh` in the Sandtable repository.
- `/sandtable/` and every other old address lead to the board.
- The site as it was before (First Hour, the EU check, the release record and the rest) is the tag
  `site-before-sandtable-home-2026-10-08`: `git checkout site-before-sandtable-home-2026-10-08 -- .` brings it back.
