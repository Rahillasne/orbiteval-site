# orbiteval.com

Public site for OrbitEval, the statistical release layer for robot policies. Static HTML,
no build step here; served by GitHub Pages from `main`.

Every page is **generated** from the private research repo (`capability-arena/build/`) and
copied across — edit there, rebuild, copy, commit. Nothing in this repo is hand-edited except
`CNAME`.

| page | what it is | built by |
|---|---|---|
| `index.html` | front door: the release check offer, the measured retrain result, pricing, then the public boards with intervals | `build.py` → `deploy.py` |
| `check.html` | the release check, runs in the browser (`wheels/`, `sample/`); pricing and FAQ | `pages.py` |
| `battle.html` | live policy battle (arena runtime on Cloud Run), on-the-boards battle, your-own-checkpoint instructions | `pages.py` |
| `chat.html` | the assistant (Cloud Run); two attached files are refereed as a battle | `pages.py` |
| `about.html`, `notes/` | company record; research notes | `pages.py` |
| `shell.css`, `data/matrix.json` | shared layout; the board data the battle page reads | `pages.py` |
| `arena.html` | the earlier rank-spread ranking layer, unlinked, kept reachable | `../arena/build/build.py` |
| `atlas.html`, `noisefloor.html` | earlier pages, unlinked, kept reachable | hand-written, frozen |
