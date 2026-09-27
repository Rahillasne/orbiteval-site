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

console.log("eu-check: stats OK");
