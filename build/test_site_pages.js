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
const NAV_PAGES = ["index", "eu-check", "record", "claims", "decision", "real", "demo",
  "release-check", "calibration", "method"];
const block = (s, re) => { const m = s.match(re); assert(m, re); return m[0]; };
const chrome = (f) => {
  const s = read(f + ".html");
  return [/<nav class="pill__links"[\s\S]*?<\/nav>/, /<nav class="mnav"[\s\S]*?<\/nav>/,
    /<footer[\s\S]*?<\/footer>/].map((re) => block(s, re));
};
const first = chrome("index");
for (const f of NAV_PAGES) assert.deepStrictEqual(chrome(f), first, `${f}.html chrome differs`);
for (const h of ["eu-check.html"]) assert(first[0].includes(`href="${h}"`), `menu lacks ${h}`);

// 3. The home page: its figures are the data's figures, and it says only what was approved.
const home = read("index.html");
const has = (s, why) => assert(home.includes(s), `index.html should say ${JSON.stringify(s)} (${why})`);

const CC = json("claims-data.json"), S = CC.summary;
has(`<td>Supported</td><td class="n mono">${S.survives}</td>`, "claims survives");
has(`<td>Inconclusive</td><td class="n mono">${S.inconclusive}</td>`, "claims inconclusive");
has(`<td>Not supported</td><td class="n mono">${S.erased + S.fails_on_episode_noise}</td>`, "claims not supported");
has(`<td>Count not stated</td><td class="n mono">${S.count_not_stated}</td>`, "claims no count");
has(`<td>Reported loss</td><td class="n mono">${S.negative_gain}</td>`, "claims loss");
has(`We checked ${CC.n_claims} published claims`, "proof count");
assert.strictEqual(S.survives, 0, "the home page says none is supported");
assert.deepStrictEqual([S.fails_on_episode_noise, S.count_not_stated], [7, 8], "the home page says seven fail and eight do not state one");
has("Seven fail on episode count alone, and eight do not state one.", "proof detail");
has(`eu-check.html?embed=1&example=1`, "the hero embeds the check with the real example");
has("€20,000", "pilot price");
has('id="independence"', "the conflict policy anchor the footer links to");
for (const bad of [/\bcompliant\b/i, /guarantee/i, /passport/i, /EU ID/, /\bcertified\b/i]) {
  for (const f of ["index.html", "eu-check.html"]) assert(!bad.test(read(f)), `${f} uses a banned word: ${bad}`);
}
const R = json("release-record-data.json");
const c = R.corpus2[2];
const N = R.nhtsa;

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
let o = openRecord("?embed=1", "#" + c.id);
assert(!o.root.hidden && o.root.innerHTML.includes(c.candidate_label), "embed opens the featured claim");
assert(o.cls.has("rr-embed") && !o.root.scrolled, "embed hides the page and does not scroll");
o = openRecord("", "#nhtsa");
assert(o.root.innerHTML.includes(N.candidate_label) && o.root.scrolled, "#nhtsa opens the NHTSA record");
o = openRecord("", "#claim-99");
assert(o.root.hidden, "an unknown record opens nothing");
o = openRecord("", "#claim-2");
assert(o.root.hidden, "an unknown record opens nothing");

console.log(`site pages: OK (${html.length} pages, links resolve, ${NAV_PAGES.length} share one header and footer, home says only what was approved)`);
