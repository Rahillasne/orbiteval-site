# orbiteval.com

The home page is **Rari R2**: a robot that carries packages and food from an apartment building's lobby to
every door. It rides the elevator, presses buttons with a finger, taps the building's fob, and hands things over at
the door. The page explains it, shows the design, and takes free reservations from buildings and residents.

Plain static files on GitHub Pages. No build step.

## Run it locally

```sh
python3 -m http.server 8811 --bind 127.0.0.1
# open http://127.0.0.1:8811/
```

A server is needed (not `file://`) because the page loads ES modules and 3D models.

## What's where

| Path | What it is |
|---|---|
| `index.html` | The page |
| `assets/css/site.css` | All styles |
| `assets/js/config.js` | **Brand name, robot name, city, contact email, form endpoint, deposit link.** Change the name here. |
| `assets/js/main.js` | Arrival doors, nav, the how-it-works player (six film chapters), the tower clip, dialogs, reservation forms |
| `assets/js/viewer.js` | The interactive 3D robot (three.js, loaded when you scroll near it) |
| `assets/js/r2.js`, `stage.js` | Shared 3D kit: loads the CAD models, materials, lights |
| `assets/models/*.glb` | R2, the S2 station and the trays, exported from the v2 CAD |
| `assets/renders/` | CAD renders (v2) |
| `assets/video/`, `assets/img/stills/` | Film, hero loop, step clips (`assets/video/steps/`) and stills, rendered from the CAD models by `film.html` |
| `film.html`, `assets/js/film.js` | The film, as a 3D scene rendered frame by frame (see below) |
| `assets/vendor/three/` | three.js r187, vendored |
| `tools/` | Screenshot and video-render scripts (Playwright + system Chrome + ffmpeg) |

## Look

A black stage (`#030507`, the 3D viewer's own background, so footage and the model have no edges) with frosted
glass panels. One accent, ice blue `#C2E1FC`, used only as light: glows, live dots, progress, floor numbers.
Type is Mona Sans (headlines light and expanded) with Doto for the elevator's dot-matrix floor numbers.
Motion: glass elevator doors open on arrival, content rises in as each section arrives, the film chapters play in
order, and the tower's delivery trails run once behind the pricing cards. All of it stops under reduced motion.

**One screen per section.** On laptops and desktops (900 px wide and 680 px tall or more) every section is laid out to
fit the window exactly, with sizes that follow the window's height, and the page settles on a whole section after
each scroll (`scroll-snap-type: y mandatory` on `html.snap`). `main.js` checks that every section really fits and turns
snapping off if one doesn't (a very small window, zoomed text), so nothing can get stuck out of reach. Phones scroll
normally. Nothing on the page is cropped: the film shows whole clips, the 3D model's edges fade only outside the robot,
and no text is truncated.

## Checks

```sh
node tools/qa.mjs   # with the local server running; 30 checks: structure, labels, one screen per section at five
                    # window sizes, no clipped text (desktop and phone), doors, nav, player, questions, dialogs, 3D, forms
```

## Reservations

Each reservation is emailed to `CONTACT_EMAIL` (rahil@orbiteval.com) by [FormSubmit](https://formsubmit.co): free,
no account. `RESERVE_ENDPOINT` in `assets/js/config.js` posts to FormSubmit's alias for that inbox (from its
activation email), so the form doesn't name the address. The subject names the building, a table holds every field,
and replying answers the person who filled it in.

- **Activation:** the first submission from a new site makes FormSubmit send the inbox an "Activate Form" email.
  Reservations arrive once it's clicked. To use a different inbox, point `RESERVE_ENDPOINT` at
  `https://formsubmit.co/ajax/<address>`, submit once, click "Activate Form", then swap in the alias that email gives.
- **FormSubmit can be slow** (83 s for one send on Nov 1). The form posts plain form data, not JSON, so the browser
  skips the CORS preflight and the service is asked once. It shows "Sending…", then "Still sending…" after 8 s, keeps
  the send alive if the visitor leaves, and gives up after 2.5 minutes.
- **If sending fails** (not activated, or FormSubmit is down) the form says so and offers `CONTACT_EMAIL`. It never
  shows a false "Reserved".
- `tools/qa.mjs` never sends a real reservation: it answers for FormSubmit itself.
- An empty `RESERVE_ENDPOINT` makes the form open the visitor's email app instead.

`DEPOSIT_LINK` (a Stripe payment link) shows an optional refundable-deposit line. It is empty on purpose: take
free reservations and letters of intent until there is a working prototype.

## Honesty rules this page follows

- Every robot visual is labeled as a CAD render or CAD animation. No AI-generated video of the robot.
- Prices say "planned". Specs are design targets. No ship dates.
- Footage of the real prototype, when it exists, goes in as-is and is labeled (for example "remote control").

## Re-rendering the film, hero loop and stills

Needs Google Chrome, ffmpeg, Python with Pillow, and a network connection (the film loads its fonts from Google Fonts).

```sh
npm i --prefix tools playwright-core@1.64.1   # once
node tools/record.mjs film    # film.mp4, film-720.mp4, film-poster.jpg, chapters.json
node tools/record.mjs hero    # hero.mp4, hero.webm, hero-poster.jpg
node tools/stills.mjs         # every still; one still: node tools/stills.mjs station
```

The brand on the film's end card and the station screen comes from `assets/js/config.js`, so after a rename
re-render the film and the station still. `record.mjs film` writes silent files; the soundtrack is mixed separately
and muxed back in with ffmpeg (`-map 0:v -map 1:a -c:v copy -c:a aac`).

## Sandtable

Sandtable · Dallas, the board that was the home page until Nov 1, 2026, is gone: removed from this site, with its
Cloud Run server and every-minute scheduler deleted. Its code is in github.com/Rahillasne/sandtable. That repo's
`live/publish_site.sh` writes the board over this site's front page, so never run it against this repo.

The site from before the board (First Hour, the EU check, the release record) is the tag
`site-before-sandtable-home-2026-10-08`.
