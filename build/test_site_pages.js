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
for (const f of NAV_PAGES) assert(/<title>[^<]*OrbitEval[^<]*<\/title>/.test(read(f + ".html")), `${f}.html title names OrbitEval`);

// 3. The home page: its figures are the data's figures, and it says only what was approved.
const home = read("index.html");
const has = (s, why) => assert(home.includes(s), `index.html should say ${JSON.stringify(s)} (${why})`);

const CC = json("claims-data.json"), S = CC.summary;
has(`<td>Supported</td><td class="n mono">${S.survives}</td>`, "claims survives");
has(`<td>Inconclusive</td><td class="n mono">${S.inconclusive}</td>`, "claims inconclusive");
has(`<td>Not supported</td><td class="n mono">${S.erased + S.fails_on_episode_noise}</td>`, "claims not supported");
has(`<td>Count not stated</td><td class="n mono">${S.count_not_stated}</td>`, "claims no count");
has(`<td>Reported loss</td><td class="n mono">${S.negative_gain}</td>`, "claims loss");
// The proof sentences, written from the data. Every claim lands in exactly one count.
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
  "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const word = (n) => { assert(Number.isInteger(n) && n >= 1 && n <= 20, `no word for ${n}`); return WORDS[n]; };
const Word = (n) => word(n)[0].toUpperCase() + word(n).slice(1);
const fail = S.erased + S.fails_on_episode_noise;
assert.strictEqual(fail + S.inconclusive + S.count_not_stated + S.negative_gain + S.survives, CC.n_claims,
  "every claim is counted once");
assert.strictEqual(S.survives, 0, "the home page says none passes");
const outcomes = `${Word(fail)} ${fail === 1 ? "fails" : "fail"} it, ${word(S.inconclusive)} ${S.inconclusive === 1 ? "is" : "are"} inconclusive, `
  + `${word(S.count_not_stated)} ${S.count_not_stated === 1 ? "does" : "do"} not state one clear episode count per arm, `
  + `and ${word(S.negative_gain)} ${S.negative_gain === 1 ? "reports" : "report"} a loss.`;
assert(!home.includes("claims that a robot AI got better"), "one of the twenty reports a loss");

// The Claim Check's venue sentence, counted over the field its Venue column reads.
const claimsPage = read("claims.html");
const venues = {};
for (const row of CC.claims) venues[row.venue] = (venues[row.venue] || 0) + 1;
assert.deepStrictEqual(Object.keys(venues).sort(), ["physical_robot", "simulation_benchmark", "unstated"]);
assert.strictEqual(venues.simulation_benchmark + venues.physical_robot + venues.unstated, CC.n_claims);
const venueSentence = `${Word(venues.simulation_benchmark)} name${venues.simulation_benchmark === 1 ? "s" : ""} a simulation benchmark, `
  + `${word(venues.physical_robot)} a physical robot, and ${word(venues.unstated)} ${venues.unstated === 1 ? "does" : "do"} not say.`;
assert(claimsPage.includes(venueSentence), `claims.html should say ${JSON.stringify(venueSentence)}`);
assert(!claimsPage.includes("Nineteen of the twenty"), "claims.html no longer says nineteen rest on simulation");
// Step 4 names no count of states: the tally shows five verdicts, the protocol has six states.
assert(!/\b(four|five|six) states\b/.test(claimsPage), "claims.html does not count the states");
assert(claimsPage.includes("<p>Report the verdict the numbers allow, and never force a claim into better or worse."), "Step 4");
assert(!/improvement claims|independently supported|researchers were careless, but/.test(claimsPage),
  "claims.html no longer calls all twenty improvements or gives episode count as the only reason");
// Its heading, description and lede name all four outcomes, with the same counts.
for (const s of [
  `<meta name="description" content="${Word(CC.n_claims)} published comparisons from robot-policy research, checked against a pre-registered protocol. None passes our check. Every number, the corpus and the code are here.">`,
  `<h1>${Word(CC.n_claims)} published comparisons from robot-policy research. We checked all ${word(CC.n_claims)}.</h1>`,
  `<p class="lede">None of them passes our check. ${outcomes} None of this says the researchers were careless, or that their numbers are false.</p>`,
  'The <a href="eu-check.html">free check</a> asks the same question of your own claims: is the test big enough to back the number?',
]) assert(claimsPage.includes(s), `claims.html should say ${s}`);

// The approved copy on the home page.
for (const s of [
  '<meta name="description" content="Free check for machines with AI entering the EU: the questions that decide your route under the Machinery Regulation, your deadline, and whether your test numbers back your claims.">',
  "<p>Our conflict policy.</p>",
  "<li>We take no equity, options, or warrants from any company whose machines or claims we check.</li>",
  '<li>When our own tool is wrong, we say so in public, as on the <a href="claims.html">Claim Check</a>.</li>',
  "<li>Missing test numbers never raise a verdict.</li>",
  "<h2>Get your test evidence in order before 20 January 2027.</h2>",
]) has(s, "approved copy");
assert(!home.includes("Missing information never raises a verdict."), "the old 'missing information' line is gone");
const demo = read("demo.html");
for (const s of [
  '<meta name="description" content="Thirty minutes on your machine: your claims, the evidence you keep, and which of it can go into the test part of your EU technical file.">',
  '<p class="lede">Your claims, the evidence you keep, and which of it can go into the test part of your EU technical file.</p>',
  "<h3>Handoff</h3><p>A report on each claim for your technical file, with a list of what is missing.</p>",
]) assert(demo.includes(s), `demo.html should say ${s}`);
// v2 home: a short hero, then the animated demo of one real read.
const HERO = /<div class="hero__copy">([\s\S]*?)<div class="hero__ctas">/.exec(home)[1];
const heroWords = HERO.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ")
  .split(/\s+/).filter((w) => /\w/.test(w)).length;
assert(heroWords <= 25, `hero text is short: ${heroWords} words (eyebrow, heading and one line)`);
for (const s of [
  '<p class="eyebrow"><span class="dot"></span>EU Machinery Regulation · applies 20 January 2027</p>',
  "<h1>Selling a machine with AI into Europe?</h1>",
  '<p class="lede">Free check: do your tests back your success rates? No login.</p>',
  `<h2>${CC.n_claims} published robot-AI comparisons. None passes our check.</h2>`,
  "<li>A report on each claim for your technical file.</li>",
  "<li>No certificates, declarations of conformity or CE marks.</li>",
  "<li>No legal advice. You decide your route, with your lawyer.</li>",
  '<p class="demo__note small">A real public datasheet. Names hidden, but the quotes are exact. Judges the document only; not legal advice.</p>',
  "<span class=\"how__title\">AI suggests claims</span>",
  '<div class="sheet__head"><b>AI suggests claims</b><span><span data-hd="total"></span> suggested</span></div>',
  "<span class=\"how__body\">Fixed rules decide. You check the AI's work.</span>",
  '<div class="sheet__head"><b>Each claim gets a verdict</b><span>by fixed rules</span></div>',
]) has(s, "v2 copy");
assert(!home.includes("From your test numbers, not from the AI."), "the old step-3 body line is gone");
assert(!/<span>from the numbers<\/span>/.test(home), "the old step-3 header span is gone");
assert(!home.includes("AI finds the claims"), "the old step-2 title/header text is gone");
assert(!/<span data-hd="total"><\/span> found/.test(home), "the old 'N found' header is gone");
assert(!home.includes("<iframe"), "the home page no longer embeds the check");
assert(!home.includes('id="how"'), "the demo replaces the How it works cards");
assert(home.includes('data-steps') && home.includes('src="home-demo.js"'), "the demo uses the step component and its script");
const HD = require(path.join(SITE, "home-demo.js"));
const DM = HD.model(json("eu-check-demo.json"), "2026-09-27");
assert(DM.total >= 5 && DM.backed <= DM.total && DM.withNumbers <= DM.total && DM.days === 115, JSON.stringify(DM));
assert(!/https?:\/\/|www\.|\S@\S/i.test(read("eu-check-demo.json")), "the demo has no links or addresses");
// The demo's hooks are data-hd: site.js treats every [data-demo] as a Book-a-call link.
assert(!/data-demo="/.test(home) && !read("home-demo.js").includes("data-demo"), "no demo hook uses data-demo");
for (const k of ["stage", "pages", "total", "quotes", "verdicts", "with-numbers", "ring", "backed", "days"]) has(`data-hd="${k}"`, "demo hook");
assert(!home.includes('data-hd="open"') && !home.includes("open items"), "the demo's open-items fact is gone");
has('<b data-hd="with-numbers"></b> of <span data-hd="total"></span> with test numbers', "the with-numbers fact replaces open items");
assert(!home.includes('class="fg"'), "the ring's unused placeholder arc is gone");
// After the deadline the days fact reads "Applies since", with no number.
const DM_PAST = HD.model(json("eu-check-demo.json"), "2027-02-01");
assert(DM_PAST.days <= 0, "2027-02-01 is on or after the deadline");
assert.strictEqual(HD.daysFact(DM_PAST.days), "Applies since 20 January 2027", "the mount text after the deadline has no number");
assert(HD.daysFact(1).includes("1") && HD.daysFact(1).includes("days to 20 January 2027"), "the mount text before the deadline has a number");
has(`<b>Claim Check<small>${CC.n_claims} published comparisons</small></b>`, "the mock header counts comparisons");
has("€20,000", "pilot price");
has('id="independence"', "the conflict policy anchor the footer links to");
for (const bad of [/\bcompliant\b/i, /guarantee/i, /passport/i, /EU ID/, /\bcertified\b/i]) {
  for (const f of ["index.html", "eu-check.html", "demo.html"]) assert(!bad.test(read(f)), `${f} uses a banned word: ${bad}`);
}
for (const gone of ["app.html", "app.js", "app.css", "app-data.json", "specimen-report.html", "registry.html"]) {
  assert(!fs.existsSync(path.join(SITE, gone)), `${gone} should be deleted`);
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
