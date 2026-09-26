// Renders claims.js against the generated claims-data.js in a stub DOM and
// checks what a reader would see. Run after the build has written
// claims-data.js:
//     node build/test_claims_page.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const SITE = path.dirname(__dirname);
const els = {};
function el() {
  return {
    innerHTML: "", textContent: "", hidden: false, value: "", dataset: {},
    addEventListener() {}, setAttribute() {}, getAttribute() { return "false"; },
    classList: { toggle() {} },
  };
}
const document = {
  querySelector: (s) => (els[s] = els[s] || el()),
  querySelectorAll: () => [],
};
const ctx = { window: {}, document };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(SITE, "claims-data.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(SITE, "claims.js"), "utf8"), ctx);

const D = ctx.window.CLAIM_CHECK;
const rows = els["#rows"].innerHTML;
const tally = els["#tally"].innerHTML;
const robust = els["#robustness"].innerHTML;
const count = (s, sub) => s.split(sub).length - 1;

// Review Focus 1: a null count never reaches the page as text.
for (const bad of ["undefined", "NaN", ">null<", " null "]) {
  assert.strictEqual(count(rows, bad), 0, "rows contain " + bad);
  assert.strictEqual(count(tally, bad), 0, "tally contains " + bad);
}
assert.strictEqual(count(rows, "placard--unknown"), D.summary.count_not_stated);
assert.strictEqual(D.summary.count_not_stated, 8);
assert.strictEqual(count(rows, '<td class="n mono">not stated</td>'), 8);
assert.ok(tally.includes("Count not stated"));
assert.ok(tally.includes("0<small> / 20</small>"), "supported tile");
assert.ok(rows.includes("π0.5") && rows.includes("FAST") && rows.includes("ActionCodec"));
assert.strictEqual(count(rows, "comparator"), 0);
assert.ok(robust.includes("state no single episode count"));
assert.ok(els["#repro"].innerHTML.includes("source/audit_corpus.json"));
console.log("claims page: OK (" + D.claims.length + " rows, " +
            D.summary.count_not_stated + " count not stated)");
