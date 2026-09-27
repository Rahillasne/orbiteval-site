// Interval maths shared by the site's calculators. Browser: window.OrbitStats.
// Node: module.exports. No network, no storage.
(function (root) {
  "use strict";
  const Z = 1.959964;

  // Wilson score interval for one proportion. Not the Wald interval: its
  // coverage falls below nominal exactly in the 90-99% band where picking
  // robots operate, the one place a tool must not overstate certainty.
  function wilson(x, n) {
    if (n <= 0) return [0, 1];
    const d = n + Z * Z;
    const c = (x + (Z * Z) / 2) / d;
    const h = (Z / d) * Math.sqrt((x * (n - x)) / n + (Z * Z) / 4);
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }

  // The smallest attempt count at which, if the observed success rate p holds,
  // the lower end of the Wilson interval reaches the claimed rate. A straight
  // scan, because rounding makes the lower end wobble with n, so a bisection
  // could miss the smallest count. null when p is at or below the claim, or
  // when no count up to the cap is enough.
  function neededOne(p, claim, cap) {
    const max = cap || 2000000;
    if (!(p > claim)) return null;
    for (let n = 1; n <= max; n++) {
      if (wilson(Math.round(p * n), n)[0] >= claim - 1e-12) return n;
    }
    return null;
  }

  const api = { Z, wilson, neededOne };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrbitStats = api;
})(typeof window !== "undefined" ? window : globalThis);
