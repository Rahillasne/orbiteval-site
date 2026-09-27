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

// 2. neededOne returns the smallest attempt count whose lower end reaches the claim.
const reaches = (p, c, n) => Stats.wilson(Math.round(p * n), n)[0] >= c - 1e-12;
for (const [p, c, want] of [[0.96, 0.94, 509], [0.98, 0.94, 118]]) {
  const n = Stats.neededOne(p, c);
  assert.strictEqual(n, want, `neededOne(${p},${c})`);
  assert(reaches(p, c, n) && !reaches(p, c, n - 1), `neededOne(${p},${c}) is the smallest`);
}
assert(Stats.neededOne(0.98, 0.94) < Stats.neededOne(0.96, 0.94), "a bigger margin needs fewer attempts");
assert.strictEqual(Stats.neededOne(0.94, 0.94), null, "at the claim, no count backs it");
assert.strictEqual(Stats.neededOne(0.9, 0.94), null, "below the claim, no count backs it");
assert.strictEqual(Stats.neededOne(0.9401, 0.94), null, "beyond the 2,000,000 cap");

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
assert.strictEqual(route("yes", "yes").label, "Outside body likely");
assert.strictEqual(route("yes", "no").label, "Self-declaration may be possible");
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
assert.strictEqual(row("rate", "94", "", "").status, "nocount");
assert.strictEqual(row("rate", "", "", "").status, "nocount");
assert.strictEqual(row("rate", "", "200", "188").status, "invalid");
assert.strictEqual(row("rate", "140", "200", "188").status, "invalid");
assert.strictEqual(row("rate", "94", "200", "210").status, "invalid");
assert.strictEqual(row("rate", "94", "0", "0").status, "invalid");
const backed = row("rate", "90", "1000", "940");
assert.strictEqual(backed.status, "backed");
assert.strictEqual(backed.text, "Your test backs at least 92.3%.");
const short = row("rate", "94", "200", "192");            // observed 96%
assert.strictEqual(short.status, "short");
assert(short.text.startsWith("Your test backs at least 92.3%."), short.text);
assert(short.text.includes("About 509 attempts would back it, if your success rate holds."), short.text);
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
assert.deepStrictEqual(cl.items.map((i) => [i.id, i.state]),
  [["claims", "ok"], ["tests", "warn"], ["method", "bad"], ["route", "ok"]]);
assert.strictEqual(cl.items[1].text, "1 claim: not enough proof");
assert.deepStrictEqual([cl.backed, cl.total, cl.missing], [1, 3, 2]);
const empty = E.checklist(st({ safetyJob: "unsure" }), []);
assert.deepStrictEqual(empty.items.map((i) => i.state), ["bad", "bad", "bad", "warn"]);

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
assert(rep.includes("Outside body likely") && rep.includes("116 days to 20 January 2027") && rep.includes("SECRET-QUOTE"));
assert(rep.includes("Not legal advice"));
const mail = E.mailBody(s2, TODAY);
assert(mail.includes("Outside body likely") && mail.includes("1 of 1 claims backed") && !mail.includes("SECRET-QUOTE"));

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
const cfg = fs.readFileSync(path.join(SITE, "eu-check-config.js"), "utf8");
assert(/window\.EUCHECK_API = "(https:\/\/[^"]+)?";/.test(cfg), "config sets EUCHECK_API to empty or an https URL");
const EX = JSON.parse(fs.readFileSync(path.join(SITE, "eu-check-example.json"), "utf8"));
assert.strictEqual(EX.source.commit, "215abfb217dbac7d5f1273282331b9b1866c0479");
assert(EX.claims.length > 0 && EX.claims.every((c) => typeof c.quote === "string"), "the example has real quotes");

console.log("eu-check: stats and logic OK");
