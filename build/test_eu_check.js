// EU Readiness Check: the shared interval maths and the check's own rules.
//     node build/test_eu_check.js
"use strict";
const assert = require("assert");
const path = require("path");
const SITE = path.dirname(__dirname);
const Stats = require(path.join(SITE, "stats.js"));

const close = (a, b, why) => assert(Math.abs(a - b) < 1e-12, `${why}: ${a} vs ${b}`);

// 1. Wilson gives the values real.js has always given (computed from its old code).
const W = [
  [376, 400, 0.912277150844435, 0.959352030010585],
  [188, 200, 0.898068306637827, 0.965347805893485],
  [0, 10, 0, 0.277532803026058],
  [10, 10, 0.722467196973942, 1],
  [940, 1000, 0.923528925064482, 0.953103527415307],
];
for (const [x, n, lo, hi] of W) {
  const [l, h] = Stats.wilson(x, n);
  close(l, lo, `wilson(${x},${n}) lo`); close(h, hi, `wilson(${x},${n}) hi`);
}
assert.deepStrictEqual(Stats.wilson(0, 0), [0, 1]);
assert.strictEqual(Stats.Z, 1.959964);

// 2. neededOne returns the smallest N from which every attempt count backs the
// claim at the observed rate, with the success count never rounded up.
const reaches = (p, c, n) => Stats.wilson(Math.floor(p * n + 1e-9), n)[0] >= c - 1e-12;
for (const [p, c] of [[0.96, 0.94], [0.98, 0.94], [92 / 96, 0.90], [18 / 20, 0.70], [0.95, 0.90], [0.99, 0.95]]) {
  const n = Stats.neededOne(p, c);
  assert(Number.isInteger(n), `neededOne(${p},${c}) = ${n}`);
  assert(reaches(p, c, n) && !reaches(p, c, n - 1), `neededOne(${p},${c}) = ${n}: holds at N, fails at N-1`);
  for (let m = n; m <= n + 5000; m++) assert(reaches(p, c, m), `neededOne(${p},${c}) = ${n}, but ${m} attempts do not back it`);
}
assert(Stats.neededOne(92 / 96, 0.90) > 96, "92 of 96 at a 90% claim: more than the 96 attempts already run");
assert(Stats.neededOne(18 / 20, 0.70) > 20, "18 of 20 at a 70% claim: more than the 20 attempts already run");
assert.strictEqual(Stats.neededOne(192 / 200, 0.94), 628, "192 of 200 at a 94% claim (the browser check uses this)");
assert(Stats.neededOne(0.98, 0.94) < Stats.neededOne(0.96, 0.94), "a bigger margin needs fewer attempts");
assert.strictEqual(Stats.neededOne(0.94, 0.94), null, "at the claim, no count backs it");
assert.strictEqual(Stats.neededOne(0.9, 0.94), null, "below the claim, no count backs it");
assert.strictEqual(Stats.neededOne(0.9401, 0.94), null, "beyond the 2,000,000 cap");

// neededOne remembers its answers (at most 500): a repeat call returns the same
// result without scanning again, and a call after its entry has been evicted
// still returns what the definition gives.
{
  const ms = (f) => { const t = process.hrtime.bigint(); const v = f(); return [v, Number(process.hrtime.bigint() - t) / 1e6]; };
  const [a, slow] = ms(() => Stats.neededOne(0.97, 0.95));
  const [b, fast] = ms(() => Stats.neededOne(0.97, 0.95));
  assert.strictEqual(b, a, "same arguments, same result");
  assert(fast * 5 < slow, `the repeat call does not scan again (${slow.toFixed(2)} ms, then ${fast.toFixed(3)} ms)`);
  const reference = (p, c, cap) => {
    if (!(p > c) || !reaches(p, c, cap)) return null;
    let last = 0;
    for (let n = 1; n < cap; n++) if (!reaches(p, c, n)) last = n;
    return last + 1;
  };
  const ps = Array.from({ length: 600 }, (_, i) => 0.9 + (i + 1) / 10000);   // 600 keys: more than the memo holds
  const firstPass = ps.map((p) => Stats.neededOne(p, 0.9, 3000));
  ps.forEach((p, i) => {
    assert.strictEqual(firstPass[i], reference(p, 0.9, 3000), `neededOne(${p}, 0.9, 3000)`);
    assert.strictEqual(Stats.neededOne(p, 0.9, 3000), firstPass[i], `neededOne(${p}, 0.9, 3000) after eviction`);
  });
  assert(firstPass.some((n) => n === null) && firstPass.some((n) => n !== null), "the keys cover both answers");
}

// 3. The check's rules.
const E = require(path.join(SITE, "eu-check-logic.js"));
const TODAY = "2026-09-26";

assert.strictEqual(E.daysUntilDeadline("2026-09-26"), 116);
assert.strictEqual(E.daysUntilDeadline("2027-01-20"), 0);
assert(E.daysUntilDeadline("2027-02-01") < 0);

// Step 1: every answer combination, and the lawyer line on every real route.
const route = (usesML, safetyJob, sellWhen) => E.step1({ usesML, safetyJob, sellWhen }, TODAY);
assert.strictEqual(route(null, null).route, "incomplete");
assert.strictEqual(route("yes", null).route, "incomplete");
assert.strictEqual(route("no", "yes").route, "outside");
assert.strictEqual(route("yes", "yes").label, "Notified body if Part A applies");
assert.strictEqual(route("yes", "no").label, "Self-assessment (module A) may be open to you");
assert.strictEqual(route("yes", "unsure").label, "First question for your lawyer");
for (const r of [route("no"), route("yes", "yes"), route("yes", "no"), route("yes", "unsure")]) {
  assert.strictEqual(r.sentences[r.sentences.length - 1], E.SENTENCES.lawyer, `${r.route} ends with the lawyer line`);
  assert.strictEqual(r.file, E.SENTENCES.file);
}
assert.deepStrictEqual(route(null, null).sentences, []);
assert.strictEqual(route("yes", "yes").sentences[0], E.SENTENCES.partA);
assert.strictEqual(route("yes", "yes", "before").directive, E.SENTENCES.directive);
assert.strictEqual(route("yes", "yes", "now").directive, E.SENTENCES.directive);
assert.strictEqual(route("yes", "yes", "after").directive, null);
assert.strictEqual(route("yes", "yes").days, 116);

// Parsing: spaces, commas and percent signs people actually type.
assert.strictEqual(E.parseCount("1 000"), 1000);
assert.strictEqual(E.parseCount("1,000"), 1000);
assert.strictEqual(E.parseCount(""), null);
assert(Number.isNaN(E.parseCount("1.5")));
assert.strictEqual(E.parsePct("98,8 %"), 98.8);
assert.strictEqual(E.parsePct("94"), 94);
assert.strictEqual(E.parsePct(""), null);
assert(Number.isNaN(E.parsePct("abc")));

// Step 2: the five rules, in order.
const row = (kind, claimedPct, attempts, successes) => E.claimRow({ kind, claimedPct, attempts, successes });
assert.strictEqual(row("other", "", "", "").status, "other");
assert.strictEqual(row("other", "", "", "").text, "The full check can cover it (up to ten claims).");
assert.strictEqual(row("rate", "94", "", "").status, "nocount");
assert.strictEqual(row("rate", "", "", "").status, "nocount");
assert.strictEqual(row("rate", "", "200", "188").status, "invalid");
assert.strictEqual(row("rate", "140", "200", "188").status, "invalid");
assert.strictEqual(row("rate", "94", "200", "210").status, "invalid");
assert.strictEqual(row("rate", "94", "0", "0").status, "invalid");
const backed = row("rate", "90", "1000", "940");
assert.strictEqual(backed.status, "backed");
assert.strictEqual(backed.text, "At 95% confidence, your test shows at least 92.3%.");
const short = row("rate", "94", "200", "192");            // observed 96%
assert.strictEqual(short.status, "short");
assert.strictEqual(short.needed, Stats.neededOne(192 / 200, 0.94));
assert.strictEqual(short.text, "At 95% confidence, your test shows at least 92.3%."
  + " About 628 attempts in total would back it, if you keep the same success rate (192 of 200).");
// The rate is given as the counts themselves: a rounded rate near the claim
// would print the claim itself (239 of 254 is 94.09%, which floors to 94.0%).
const near = row("rate", "94", "254", "239");
assert(near.needed > 254 && near.text.endsWith(" if you keep the same success rate (239 of 254)."), near.text);
assert(!near.text.includes("94.0%"), near.text);
assert(row("rate", "95", "1500", "1430").text.endsWith(" if you keep the same success rate (1,430 of 1,500)."), "counts are grouped");
// The rows the old rounding got wrong now ask for more than was already run.
assert(row("rate", "90", "96", "92").needed > 96, "92 of 96 at a 90% claim");
assert(row("rate", "70", "20", "18").needed > 20, "18 of 20 at a 70% claim");
// No claim from 90% to 99%, at any attempt count up to 300, is told a total at
// or below the attempts it already ran. Each new (rate, claim) scans to the
// 2,000,000 cap (~20 ms; neededOne's own memo skips repeats), so the sweep runs
// one worker per claimed percentage; the result is awaited at the end.
const SWEEP = `
const { parentPort, workerData: { site, pct } } = require("worker_threads");
const path = require("path");
const E = require(path.join(site, "eu-check-logic.js"));
let asked = 0;
const bad = [];
for (let n = 1; n <= 300; n++) {
  for (const x of new Set([n, n - 1, n - 2])) {
    if (x < 0) continue;
    const r = E.claimRow({ kind: "rate", claimedPct: String(pct), attempts: String(n), successes: String(x) });
    if (r.needed == null) continue;
    asked++;
    if (!(r.needed > n) || !r.text.includes(" About " + r.needed.toLocaleString("en-US") + " attempts in total")
      || !r.text.endsWith(" if you keep the same success rate (" + x + " of " + n + ")."))
      bad.push(x + " of " + n + " at " + pct + "%: " + r.text);
  }
}
parentPort.postMessage({ asked, bad });
`;
const { Worker } = require("worker_threads");
const sweep = Promise.all(Array.from({ length: 10 }, (_, i) => new Promise((done, fail) => {
  const w = new Worker(SWEEP, { eval: true, workerData: { site: SITE, pct: 90 + i } });
  w.once("message", done);
  w.once("error", fail);
  // A worker that ends without posting its result fails the test (after a
  // message, this rejection is ignored: the promise has already settled).
  w.once("exit", (code) => fail(new Error(`sweep worker for ${90 + i}% exited (code ${code}) without a result`)));
}))).then((parts) => {
  const asked = parts.reduce((a, r) => a + r.asked, 0);
  assert.deepStrictEqual(parts.flatMap((r) => r.bad), [], "rows told a total at or below their attempts");
  assert(asked > 1000, `the sweep reached ${asked} rows with a total`);
  return asked;
});
// The guard in claimRow: a total at or below the attempts run becomes attempts + 1.
{
  const real = Stats.neededOne;
  Stats.neededOne = () => 150;
  try {
    const r = row("rate", "94", "200", "192");
    assert.strictEqual(r.needed, 201);
    assert(r.text.includes(" About 201 attempts in total would back it"), r.text);
  } finally { Stats.neededOne = real; }
}
const equal = row("rate", "94", "100", "94");
assert.strictEqual(equal.status, "short");
assert(equal.text.endsWith("At your current success rate, more attempts cannot back this claim."), equal.text);
const perfect = row("rate", "100", "100", "100");
assert.strictEqual(perfect.status, "short");
assert(perfect.text.endsWith("more attempts cannot back this claim."), "a 100% claim is never backed");
assert(row("rate", "94", "1 000", "1 000").status === "backed", "spaced counts parse");

// Checklist.
const st = (o) => Object.assign({ usesML: "yes", safetyJob: "yes", sellWhen: null, method: false, rows: [] }, o);
const rowsA = [{ kind: "rate", claimedPct: "90", attempts: "1000", successes: "940" },
  { kind: "rate", claimedPct: "94", attempts: "", successes: "" },
  { kind: "other", claimedPct: "", attempts: "", successes: "" }];
const cl = E.checklist(st({ rows: rowsA }), rowsA.map(E.claimRow));
assert.deepStrictEqual(cl.items.map((i) => [i.id, i.state, i.text]), [
  ["claims", "ok", "Claims listed"],
  ["tests", "warn", "2 claims without enough test proof"],          // the no-count row and the "other" row
  ["method", "bad", "Testing method not written down (needed where Annex IV (n) applies)"],
  ["route", "ok", "Route question answered"]]);
assert.deepStrictEqual([cl.backed, cl.total, cl.missing], [1, 3, 2]);
const clOf = (o) => E.checklist(st(o), (o.rows || []).map(E.claimRow));
const BACKED = { kind: "rate", claimedPct: "90", attempts: "1000", successes: "940" };
const OTHER = { kind: "other", claimedPct: "", attempts: "", successes: "" };
// An "other" claim is open: a backed row beside it is not "every claim".
let c2 = clOf({ method: true, rows: [BACKED, OTHER] });
assert.deepStrictEqual(c2.items[1], { id: "tests", state: "warn", text: "1 claim without enough test proof" });
assert.strictEqual(c2.missing, 1);
c2 = clOf({ method: true, rows: [BACKED] });
assert.deepStrictEqual(c2.items.map((i) => [i.state, i.text]), [["ok", "Claims listed"],
  ["ok", "Test results back every claim"], ["ok", "Testing method written down"], ["ok", "Route question answered"]]);
assert.strictEqual(c2.missing, 0);
assert.deepStrictEqual(clOf({ rows: [OTHER] }).items[1], { id: "tests", state: "bad", text: "No claim has test numbers yet" });
const empty = clOf({ safetyJob: "unsure" });
assert.deepStrictEqual(empty.items.map((i) => [i.state, i.text]), [["bad", "No claims listed yet"],
  ["bad", "No claim has test numbers yet"],
  ["bad", "Testing method not written down (needed where Annex IV (n) applies)"],
  ["warn", "Route question open: not sure"]]);
assert.strictEqual(empty.missing, 4);
assert.deepStrictEqual(clOf({ usesML: null, safetyJob: null }).items[3], { id: "route", state: "warn", text: "Route question not answered" });
assert.deepStrictEqual(clOf({ usesML: "yes", safetyJob: null }).items[3], { id: "route", state: "warn", text: "Route question not answered" });
assert.strictEqual(clOf({ usesML: "no", safetyJob: null }).items[3].state, "ok");
// The example has no testing method to assess: "na", and "na" is not an open item.
for (const method of [false, true]) {
  const ex = clOf({ example: true, method, safetyJob: "unsure", rows: [OTHER] });
  assert.deepStrictEqual(ex.items[2], { id: "method", state: "na", text: "Testing method: not assessed in this example" });
  assert.strictEqual(ex.missing, 2, "tests and route are open; the method is not counted");
}
assert.strictEqual(clOf({ example: false, rows: [OTHER] }).items[2].state, "bad");

// AI hints never overwrite a person's answer.
const hints = { uses_ml: { answer: "yes", quote: "Uses a neural network." },
  safety_job: { answer: "no", quote: "A safety PLC stops it." } };
let m = E.mergeHints({ usesML: null, safetyJob: "yes" }, hints);
assert.strictEqual(m.usesML, "yes"); assert.strictEqual(m.safetyJob, "yes");
assert.deepStrictEqual(m.filled, { usesML: "Uses a neural network." });
m = E.mergeHints({ usesML: null, safetyJob: null }, { uses_ml: null, safety_job: null });
assert.deepStrictEqual([m.usesML, m.safetyJob, m.filled], [null, null, {}]);

// Rows from the AI keep the quote and turn numbers into editable text.
const rs = E.rowsFromAI([{ quote: "188 of 200 picks", page: 2, kind: "rate", claimed_pct: null,
  attempts: 200, successes: 188, file: null }]);
assert.deepStrictEqual(rs[0], { text: "188 of 200 picks", kind: "rate", claimedPct: "", attempts: "200",
  successes: "188", ai: { quote: "188 of 200 picks", page: 2, file: null } });

// Text checks done before anything is sent.
assert.strictEqual(E.hasText(["", "   "]), false, "a scanned PDF has no text");
assert.strictEqual(E.hasText(["Our picker reaches 98.8% success."]), true);
assert.strictEqual(E.tooLong(["x".repeat(30001)]), true);
assert.strictEqual(E.tooLong(["x".repeat(15000), "y".repeat(15000)]), false);

// Report and mail carry the result; the mail carries no document text.
const s2 = st({ rows: [{ kind: "rate", text: "SECRET-QUOTE", claimedPct: "90", attempts: "1000", successes: "940" }] });
const rep = E.report(s2, TODAY);
assert(rep.startsWith("# EU test-evidence check · OrbitEval\n"), rep.split("\n")[0]);
assert(rep.includes("Notified body if Part A applies") && rep.includes("116 days to 20 January 2027") && rep.includes("SECRET-QUOTE"));
assert(rep.includes("Not legal advice"));
assert(rep.includes("\n## Answers\n\n- Uses AI or machine learning: yes\n- AI does a safety job: yes\n- Selling in the EU: -\n"), rep);
assert(!rep.includes("read by AI"), "nothing here was read by AI");
const mail = E.mailBody(s2, TODAY);
assert(mail.includes("Notified body if Part A applies") && mail.includes("1 of 1 claims backed") && !mail.includes("SECRET-QUOTE"));
assert(mail.includes("\nOpen items in this check: 1\n") && !mail.includes("Missing"), mail);

// The report marks what the AI read and nobody has checked since.
const AIMARK = " (read by AI, not checked by you)";
const aiRow = (text, edited) => ({ kind: "rate", text, claimedPct: "90", attempts: "1000", successes: "940",
  ai: { quote: text, page: 1, file: null }, edited });
const s3 = st({ safetyJob: null, sellWhen: "before", filled: { usesML: "Uses a neural network." },
  rows: [aiRow("AI-ROW", false), aiRow("EDITED-ROW", true), Object.assign({}, BACKED, { text: "HAND-ROW" })] });
const rep3 = E.report(s3, TODAY);
assert(rep3.includes("| AI-ROW" + AIMARK + " | 90 |"), rep3);
assert(rep3.includes("| EDITED-ROW | 90 |") && rep3.includes("| HAND-ROW | 90 |"), rep3);
assert(rep3.includes("\n## Answers\n\n- Uses AI or machine learning: yes" + AIMARK
  + "\n- AI does a safety job: -\n- Selling in the EU: Before 20 January 2027\n"), rep3);
assert.strictEqual(rep3.split(AIMARK).length - 1, 2, "one AI row and one AI answer");
const rep4 = E.report(st({ safetyJob: "no", sellWhen: "undecided", filled: { safetyJob: "A safety PLC stops it." } }), TODAY);
assert(rep4.includes("- Uses AI or machine learning: yes\n- AI does a safety job: no" + AIMARK + "\n- Selling in the EU: Not decided\n"), rep4);
const rep5 = E.report(st({ usesML: null, safetyJob: "unsure", sellWhen: "now" }), TODAY);
assert(rep5.includes("- Uses AI or machine learning: -\n- AI does a safety job: not sure\n- Selling in the EU: Already selling\n"), rep5);

// 4. The page wires the modules in the right order and carries the approved text.
const fs = require("fs");
const page = fs.readFileSync(path.join(SITE, "eu-check.html"), "utf8");
const order = ["stats.js", "eu-check-logic.js", "eu-check-config.js", "eu-check.js"].map((s) => page.indexOf(`src="${s}"`));
assert(order.every((i) => i > 0) && order.join() === [...order].sort((a, b) => a - b).join(), "scripts load in order");
for (const id of ["drop", "file", "paste", "read", "example", "sell", "method", "rows", "add", "result", "download", "book", "readstatus"]) {
  assert(page.includes(`id="${id}"`), `eu-check.html has #${id}`);
}
assert(page.includes(E.SENTENCES.privacy), "the privacy sentence sits next to the drop zone");
assert(page.includes("Not legal advice"), "the page says it is not legal advice");
for (const s of [
  '<p class="eyebrow"><span class="dot"></span>Free · no login · no account</p>',
  "<h1>Selling a machine with AI into Europe? See where your test evidence stands.</h1>",
  '<meta name="description" content="Free, no login: the questions that decide your route under the Machinery Regulation, your deadline, and whether your test numbers back your claims.">',
  ">Try an example: a public research model card (π0.5)</button>",
  'Each claim is read as "at least X%". A claim is backed when the lower end of its 95% interval reaches it, assuming independent attempts under the conditions the claim describes.',
  '<p class="small ec-note" id="more" hidden>The AI reader lists at most 25 claims per read.</p>',
  "Not legal advice, not a conformity assessment and not a certificate. The route questions come from the regulation text; have your lawyer confirm your route. We store nothing you enter. If you use the AI reader, your text passes through OpenAI, as the note above the reader explains.",
]) assert(page.includes(s), `eu-check.html should say ${s}`);
assert(!/nothing stored/i.test(page), "the page no longer says nothing is stored");
const css = fs.readFileSync(path.join(SITE, "site.css"), "utf8");
const hide = css.split("\n").find((l) => l.startsWith(".ec-embed .topbar"));
assert(hide && !hide.includes(".ec-foot"), "the embed keeps the disclaimer: " + hide);
assert(css.includes(".ec-li--na > span { color: var(--ink-mute); }"), "the na icon is muted");
const cfg = fs.readFileSync(path.join(SITE, "eu-check-config.js"), "utf8");
assert(/window\.EUCHECK_API = "(https:\/\/[^"]+)?";/.test(cfg), "config sets EUCHECK_API to empty or an https URL");
const EX = JSON.parse(fs.readFileSync(path.join(SITE, "eu-check-example.json"), "utf8"));
assert.strictEqual(EX.source.commit, "215abfb217dbac7d5f1273282331b9b1866c0479");
assert(EX.claims.length > 0 && EX.claims.every((c) => typeof c.quote === "string"), "the example has real quotes");

// The process never exits 0 without printing OK.
let reachedOK = false;
process.on("exit", (code) => {
  if (code === 0 && !reachedOK) { console.error("eu-check: ended before the sweep reported"); process.exitCode = 1; }
});
sweep.then((asked) => {
  reachedOK = true;
  console.log(`eu-check: stats and logic OK (attempts sweep: ${asked} rows, every total above the attempts run)`);
}, (e) => { console.error(e); process.exitCode = 1; });
