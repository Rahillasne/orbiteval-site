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

// Today's date is built from the local calendar fields, never from a locale:
// a locale that prints "27/09/2026" must not turn the day count into NaN.
assert.strictEqual(E.localISO(new Date(2026, 0, 5)), "2026-01-05");
assert.strictEqual(E.localISO(new Date(2027, 11, 31, 23, 59, 59)), "2027-12-31");
assert.strictEqual(E.localISO(new Date(987, 2, 9)), "0987-03-09");
assert(Number.isNaN(E.daysUntilDeadline("27/09/2026")), "a locale-shaped date is why");
{
  const real = Date.prototype.toLocaleDateString;
  Date.prototype.toLocaleDateString = () => "27/09/2026";
  try {
    const d = E.localISO(new Date(2026, 8, 27));
    assert.strictEqual(d, "2026-09-27");
    assert.strictEqual(E.daysUntilDeadline(d), 115);
  } finally { Date.prototype.toLocaleDateString = real; }
}

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
assert.strictEqual(row("other", "", "", "").label, "Not a % claim");
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
// Counts typed but no claimed %: the row has test numbers, so the item says what it lacks.
const COUNTS_ONLY = { kind: "rate", claimedPct: "", attempts: "200", successes: "188" };
assert.strictEqual(E.claimRow(COUNTS_ONLY).status, "invalid");
assert.deepStrictEqual(clOf({ rows: [COUNTS_ONLY] }).items[1], { id: "tests", state: "warn", text: "1 claim needs a claimed %" });
assert.deepStrictEqual(clOf({ rows: [COUNTS_ONLY, COUNTS_ONLY] }).items[1], { id: "tests", state: "warn", text: "2 claims need a claimed %" });
assert.deepStrictEqual(clOf({ rows: [COUNTS_ONLY, BACKED] }).items[1], { id: "tests", state: "warn", text: "1 claim needs a claimed %" });
// Beside other open claims, both counts are given, and every open claim is counted once.
assert.deepStrictEqual(clOf({ rows: [COUNTS_ONLY, BACKED, OTHER] }).items[1],
  { id: "tests", state: "warn", text: "1 claim needs a claimed %; 1 claim without enough test proof" });
assert.deepStrictEqual(clOf({ rows: [COUNTS_ONLY, OTHER, OTHER] }).items[1],
  { id: "tests", state: "warn", text: "1 claim needs a claimed %; 2 claims without enough test proof" });
// Only attempts, or only successes, is not a test count yet.
assert.strictEqual(clOf({ rows: [{ kind: "rate", claimedPct: "", attempts: "200", successes: "" }] }).items[1].text,
  "No claim has test numbers yet");
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

// The status line after a read: the AI suggests claims, it does not find them.
assert.strictEqual(E.readStatus(2, 0), "The AI suggested 2 claims. Check each one.");
assert.strictEqual(E.readStatus(1, 0), "The AI suggested 1 claim. Check it.");
assert.strictEqual(E.readStatus(3, 1), "The AI suggested 3 claims. Check each one."
  + " 1 suggestion was dropped because their quote is not in your document.");
assert.strictEqual(E.readStatus(0, 0), "The AI suggested no claims for this document. Add them by hand?");
assert.strictEqual(E.readStatus(0, 2), "The AI suggested no claims for this document."
  + " 2 suggestions were dropped because their quote is not in your document. Add them by hand?");

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
// Three steps (Document, Claims, Result): the IDs the first-time-visitor run drives.
for (const id of ["steps", "s1", "s2", "s3",
  "drop", "file", "pastetoggle", "paste", "read", "example", "manual", "readstatus",
  "cards", "add", "toresult", "more",
  "result", "why", "sell", "method", "download", "book"]) {
  assert(page.includes(`id="${id}"`), `eu-check.html has #${id}`);
}
for (const name of ["usesML", "safetyJob"]) assert(page.includes(`name="${name}"`), `eu-check.html has the ${name} radios`);
// Long text is folded: each of these sits, word for word, after the nearest <details and before its </details>.
const folded = (s, why) => {
  const at = page.indexOf(s);
  assert(at > 0, `${why} is on the page, word for word`);
  const open = page.lastIndexOf("<details", at), close = open < 0 ? -1 : page.indexOf("</details>", open);
  assert(open > 0 && close > at + s.length, `${why} sits inside a <details>`);
};
folded(E.SENTENCES.privacy, "the privacy sentence");
folded('Each claim is read as "at least X%". A claim is backed when the lower end of its 95% interval reaches it, assuming independent attempts under the conditions the claim describes.', "how a claim is checked");
folded("An example, not a definition: stopping the machine when a person comes close.", "the safety-job guidance");
assert(/<legend>Does the AI do a safety job\?<\/legend>\s*<details class="ec-more"><summary>What counts\?<\/summary><p>An example, not a definition: stopping the machine when a person comes close\.<\/p><\/details>/.test(page),
  "the safety-job guidance sits right under its question, folded");
folded('The route questions come from the regulation text; have your lawyer confirm your route. We store nothing you enter.<span class="ec-reader-only"> If you use the AI reader, your text passes through OpenAI, as the note above the reader explains.</span>', "the footnote");
assert(page.includes("Not legal advice"), "the page says it is not legal advice");
for (const s of [
  '<p class="eyebrow"><span class="dot"></span>Free · no login · no account</p>',
  "<h1>Check your test evidence.</h1>",
  '<meta name="description" content="Free, no login: the questions that decide your route under the Machinery Regulation, your deadline, and whether your test numbers back your claims.">',
  '<div class="small ec-note ec-reader-only">Read by OpenAI, which keeps logs for up to 30 days, sometimes longer. Not stored by us.',
  '<button type="button" class="ec-bigdrop ec-reader-only" id="drop">',
  '<button type="button" class="ec-linklike ec-reader-only" id="pastetoggle">Paste text instead</button>',
  '<button type="button" class="ec-linklike" id="example">Try the example</button>',
  '<button type="button" class="ec-linklike" id="manual">No document? Add claims by hand</button>',
  '<p class="small ec-note" id="more" hidden>The AI reader lists at most 25 claims per read.</p>',
  '<div class="small ec-foot">Not legal advice, not a conformity assessment and not a certificate.',
]) assert(page.includes(s), `eu-check.html should say ${s}`);
assert(!/nothing stored/i.test(page), "the page no longer says nothing is stored");
assert(!page.includes("<table"), "claims are cards, not a table");
const css = fs.readFileSync(path.join(SITE, "site.css"), "utf8");
// ?embed=1, the home page's preview: the check alone, with the site's chrome, the page heading
// and the page's own footnote hidden (the preview's caption on the home page carries the disclaimer).
{
  const hide = css.split("\n").find((l) => l.startsWith(".ec-embed .topbar"));
  assert(hide && / \{ display: none; \}$/.test(hide), "the embed has a rule that hides the chrome: " + hide);
  const sel = hide.slice(0, hide.indexOf(" {")).split(",").map((s) => s.trim());
  for (const s of [".ec-embed .topbar", ".ec-embed .footer", ".ec-embed .ec-head", ".ec-embed .ec-foot"]) {
    assert(sel.includes(s), `the embed hides ${s.slice(10)}: ${hide}`);
  }
}
assert(!/\.ec-rows\b/.test(css), "the claims table's rules are gone");
assert(css.includes(".ec-li--na > span { color: var(--ink-mute); }"), "the na icon is muted");
// The plate: the preview window on the home page, with its caption above the link that covers it.
for (const s of [".plate {", ".plate__win {", ".plate__bar {", ".plate iframe {", ".plate__link {", ".plate__open {", ".plate__note {"]) {
  assert(css.includes("\n" + s), `the plate's rule ${s}`);
}
assert(/\n\.plate iframe \{[^}]*pointer-events: none;/.test(css), "the preview cannot be clicked into; the link over it opens the check");
assert(/\n\.plate__note \{[^}]*z-index: 1;/.test(css), "the caption sits above the link that covers the plate");
assert(!/\.ec-sum[\s>{]/.test(css), "the old summary list's rules are gone");
// Once the reader's daily limit is reached, every control and sentence about the reader goes, the privacy line too.
assert(css.includes(".ec-limited .ec-reader-only, .ec-limited #pastebox, .ec-limited #reading { display: none !important; }"), "limited rule");
// Long unbroken strings (a file name, an AI quote) wrap inside the card on a phone.
for (const sel of [".ec-status", ".ec-aihint"]) {
  const rule = css.split("\n").find((l) => l.startsWith(sel + " {"));
  assert(rule && rule.includes("overflow-wrap: anywhere"), `${sel} wraps long strings: ${rule}`);
}
// A ring labelled "claims backed" fills only with backed claims: no other verdict colours an arc.
assert(css.includes(".demo-seg--current { stroke: var(--good); }") && !/\.demo-seg--(caution|revoked)\b/.test(css), "only backed arcs are coloured");
// Reduced motion: the home demo's sheets swap without sliding.
assert(/@media \(prefers-reduced-motion: reduce\) \{[^\n]*\.sheet \{ transform: none; transition: opacity \.45s; \}/.test(css), "sheets do not slide under reduced motion");
// With the reader off, its controls and every sentence about it are hidden (browser_check --reader off runs it).
assert(css.includes(".ec-noreader .ec-reader-only, .ec-noreader #pastebox { display: none !important; }"), "reader-off rule");
// The busy bar moves only when motion is welcome.
{
  const anim = css.indexOf("animation: ec-busy");
  const media = css.lastIndexOf("@media (prefers-reduced-motion: no-preference) {", anim);
  assert(anim > 0 && media > 0 && !/\n\}/.test(css.slice(media, anim)), "the busy bar's motion sits in the no-preference block");
}
// The home demo: its final state is the plain state, so reduced motion shows everything.
const cssAll = fs.readFileSync(path.join(SITE, "site.css"), "utf8");
const demoBlock = cssAll.slice(cssAll.indexOf("/* Home demo"));
assert(/@media \(prefers-reduced-motion: no-preference\)/.test(demoBlock), "demo motion only runs when motion is welcome");
assert(!/\.demo-[^{]*\{[^}]*opacity:\s*0/.test(demoBlock.split("@media (prefers-reduced-motion: no-preference)")[0]),
  "no demo element is invisible outside the motion block");
{
  const m = /\n\[data-hd="stage"\]:not\(\.is-ready\) :is\((.*)\) \{ visibility: hidden; \}/.exec(demoBlock);
  assert(m, "the demo's count lines are hidden until its data is in");
  const sel = m[1].split(",").map((x) => x.trim());
  assert.deepStrictEqual(sel, [".demo-cap", ".sheet__head span:has([data-hd])", ".demo-ring__txt", ".demo-facts"], "the lines that hold counts");
}
const js = fs.readFileSync(path.join(SITE, "eu-check.js"), "utf8");
assert(js.includes('if (!API) document.documentElement.classList.add("ec-noreader");'), "eu-check.js marks the page when the reader is off");
assert(!js.includes("toLocaleDateString") && js.includes("E.localISO(new Date())"), "today comes from localISO");
assert(!/§|\bR[0-9]{1,3}\b/.test(js), "no internal section or ruling numbers in a public file");
assert(js.includes('fetch("eu-check-demo.json")') && !js.includes("eu-check-example.json"), "the example is the home demo's data");
// The embed mode behind the home page's preview.
assert(js.includes('const embed = params.get("embed") === "1";')
  && js.includes('if (embed) document.documentElement.classList.add("ec-embed");'), "?embed=1 marks the page");
assert(js.includes('const API = embed ? "" : '), "the embed never calls the reader: its address is empty there");
assert(js.includes('document.querySelectorAll("main input, main select, main textarea, main button").forEach((el) => { el.disabled = true; });'),
  "the embed is read-only");
{
  const body = (name) => { const i = js.indexOf(`function ${name}(`); assert(i > 0, name); return js.slice(i, js.indexOf("\n  }\n", i)); };
  assert(body("renderCards").includes("lockIfEmbed();") && body("paintAll").includes("lockIfEmbed();"),
    "the lock is applied again after every re-render");
  assert(/paintAll\(\);\n\s*if \(embed\) return;/.test(body("go")), "the embed never takes focus or scrolls the home page");
  assert(!/go\(3\)/.test(body("loadExample")), "the example opens its claims, never its result");
}
assert(js.includes('if (embed && params.get("example") === "1") loadExample();'), "?example=1 loads the example through the normal path");
assert(js.includes('class="demo-ring"'), "the result ring is the home demo's ring");
assert(!js.includes('"--p"'), "the ring sets no variable nothing reads");
assert(js.includes("E.readStatus(") && !/Found|No claims found|marked AI/.test(js), "the read status comes from the rules module's wording");
assert(js.includes('confirm("Replace your claims with the example?")'), "the example asks before replacing the person's own claims");
assert(js.includes(">Attempts<input") && js.includes(">Succeeded<input"), "claim card fields are labelled Attempts/Succeeded");
assert(!js.includes(">Tests<input") && !js.includes(">Passed<input"), "the old Tests/Passed labels are gone");
assert(js.includes('`Example: a real public robot datasheet (names hidden), read by AI on ${esc(j.read.date)}; quotes checked against the source by code.`'),
  "the example status line names no product and points to the code check");
const cfg = fs.readFileSync(path.join(SITE, "eu-check-config.js"), "utf8");
assert(/window\.EUCHECK_API = "(https:\/\/[^"]+)?";/.test(cfg), "config sets EUCHECK_API to empty or an https URL");
const DEMO = JSON.parse(fs.readFileSync(path.join(SITE, "eu-check-demo.json"), "utf8"));
assert(DEMO.claims.length >= 5 && DEMO.claims.every((c) => typeof c.quote === "string" && c.quote.trim()), "the example has at least 5 real quotes");
assert(!/https?:\/\/|www\.|\S@\S/i.test(JSON.stringify(DEMO)), "the example has no links or addresses");
assert(!fs.existsSync(path.join(SITE, "eu-check-example.json")), "eu-check-demo.json is the only example");

// The process never exits 0 without printing OK.
let reachedOK = false;
process.on("exit", (code) => {
  if (code === 0 && !reachedOK) { console.error("eu-check: ended before the sweep reported"); process.exitCode = 1; }
});
sweep.then((asked) => {
  reachedOK = true;
  console.log(`eu-check: stats and logic OK (attempts sweep: ${asked} rows, every total above the attempts run)`);
}, (e) => { console.error(e); process.exitCode = 1; });
