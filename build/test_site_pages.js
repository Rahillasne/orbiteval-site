// Checks the site as a whole after a build: every local link resolves, every
// page carries the same header, menu and footer, the home page's figures are
// the generated data's figures, and a record link opens the record it names.
//     node build/test_site_pages.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const SITE = path.dirname(__dirname);
const read = (f) => fs.readFileSync(path.join(SITE, f), "utf8");
const json = (f) => JSON.parse(read(f));
const html = fs.readdirSync(SITE).filter((f) => f.endsWith(".html"));

// 1. Every local href and src on every page points at a file that exists.
const broken = [];
for (const f of html) {
  for (const m of read(f).matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const u = m[1];
    if (/^(https?:|mailto:|data:|#|javascript:)/.test(u)) continue;
    const file = u.split("#")[0].split("?")[0];
    if (file && !fs.existsSync(path.join(SITE, file))) broken.push(`${f} -> ${u}`);
  }
}
assert.deepStrictEqual(broken, [], "broken local links");

// 2. One header, one menu, one footer on every page that has them.
const NAV_PAGES = ["index", "record", "claims", "decision", "real", "demo",
  "release-check", "registry", "calibration", "specimen-report", "method"];
const block = (s, re) => { const m = s.match(re); assert(m, re); return m[0]; };
const chrome = (f) => {
  const s = read(f + ".html");
  return [/<nav class="pill__links"[\s\S]*?<\/nav>/, /<nav class="mnav"[\s\S]*?<\/nav>/,
    /<footer[\s\S]*?<\/footer>/].map((re) => block(s, re));
};
const first = chrome("index");
for (const f of NAV_PAGES) assert.deepStrictEqual(chrome(f), first, `${f}.html chrome differs`);
for (const h of ["record.html", "claims.html", "decision.html", "release-check.html", "real.html"]) {
  assert(first[0].includes(`href="${h}"`), `menu lacks ${h}`);
}

// 3. The home page's figures are the data's figures.
const home = read("index.html");
const has = (s, why) => assert(home.includes(s), `index.html should say ${JSON.stringify(s)} (${why})`);

const S = json("claims-data.json").summary;
has(`<td>Supported</td><td class="n mono">${S.survives}</td>`, "claims survives");
has(`<td>Inconclusive</td><td class="n mono">${S.inconclusive}</td>`, "claims inconclusive");
has(`<td>Not supported</td><td class="n mono">${S.erased + S.fails_on_episode_noise}</td>`, "claims not supported");
has(`<td>Count not stated</td><td class="n mono">${S.count_not_stated}</td>`, "claims no count");
has(`<td>Reported loss</td><td class="n mono">${S.negative_gain}</td>`, "claims loss");
assert.strictEqual(S.survives, 0, "the home page says none is supported");
assert.strictEqual(S.fails_on_episode_noise, 7, "the home page says seven fail on episode count alone");

const Dd = json("decision-data.json");
const pct = (k) => (100 * k / Dd.counts.n_cells).toFixed(1) + "%";
has(`${Dd.headline.rate_a.toFixed(1)}%`, "decision arm A");
has(`${Dd.headline.rate_b.toFixed(1)}%`, "decision arm B");
has(`${Dd.counts.n_cells.toLocaleString("en-US")} pairs`, "decision cells");
has(`false alarms</td><td class="n mono">${pct(Dd.counts.episode_level_rejects)}`, "episode-level rate");
has(`false alarms</td><td class="n mono">${pct(Dd.counts.retrain_level_rejects)}`, "retrain-level rate");
assert.strictEqual(Dd.headline.gap_pp, 41, "the home page says forty-one points");

const R = json("release-record-data.json");
const c = R.corpus2[2], d = c.display;
has(`record.html?embed=1#claim-2`, "hero embeds claim 2");
has(`${c.baseline_label} → ${c.candidate_label}`, "hero bar names the arms");
for (const s of [d.difference + " " + d.interval, "Detection limit " + d.detection_limit,
  `${(100 * c.k_baseline / c.n_baseline).toFixed(2)}% → ${(100 * c.k_candidate / c.n_candidate).toFixed(2)}%`,
  `${c.k_baseline.toLocaleString("en-US")} and ${c.k_candidate.toLocaleString("en-US")} of ${c.n_baseline.toLocaleString("en-US")} episodes`,
  `+${c.effect_pp} points`]) has(s, "featured record");
assert.strictEqual(c.claim, "insufficient evidence");
has(`${R.counts.corpus2_no_count} of ${R.counts.corpus2_records} papers`, "no-count papers");

const N = R.nhtsa;
has(`${N.n_baseline} incident reports`, "NHTSA arm A");
has(`${N.n_candidate} incident reports`, "NHTSA arm B");
has(`${N.events_in.toLocaleString("en-US")} reports read`, "NHTSA events in");
has(`${N.revisions_superseded} superseded revisions`, "NHTSA revisions");
has(`${N.flagged_for_adjudication.length} near-miss labels`, "NHTSA flags");
has(`${N.merged_variants[0].split("', '").length} spellings merged`, "NHTSA merges");

// The operator table on the home page repeats the NHTSA audit's own figures.
const audit = read("release-check.html");
for (const s of ["1,436", "1,211", "Avride", "Zoox", "Tesla", "Too coarse", "Too fine", "Scheme changed", "Withheld"]) {
  assert(home.includes(s) && audit.includes(s), `home and audit should both carry ${s}`);
}

// 4. A record link opens the record it names, and embed shows it alone.
function openRecord(search, hash) {
  const els = {}, cls = new Set();
  const el = () => ({ hidden: true, disabled: false, textContent: "", innerHTML: "", value: "",
    dataset: {}, tabIndex: 0, setAttribute() {}, appendChild() {}, addEventListener() {},
    scrollIntoView() { this.scrolled = true; }, focus() {} });
  const get = (k) => (els[k] = els[k] || el());
  const document = {
    documentElement: { classList: { add: (x) => cls.add(x) } },
    querySelector: get, getElementById: (id) => get("#" + id),
    querySelectorAll: () => [], createElement: () => ({}),
  };
  const ctx = { window: {}, document, location: { search, hash } };
  vm.createContext(ctx);
  vm.runInContext(read("release-record-data.js"), ctx);
  vm.runInContext(read("record.js"), ctx);
  return { root: get("[data-record]"), cls };
}
let o = openRecord("?embed=1", "#claim-2");
assert(!o.root.hidden && o.root.innerHTML.includes(c.candidate_label), "embed opens claim 2");
assert(o.cls.has("rr-embed") && !o.root.scrolled, "embed hides the page and does not scroll");
o = openRecord("", "#nhtsa");
assert(o.root.innerHTML.includes(N.candidate_label) && o.root.scrolled, "#nhtsa opens the NHTSA record");
o = openRecord("", "#claim-99");
assert(o.root.hidden, "an unknown record opens nothing");

console.log(`site pages: OK (${html.length} pages, links resolve, ${NAV_PAGES.length} share one header and footer, home figures match the data)`);
