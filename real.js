// "Is that difference real?" — runs entirely in the page. No network calls,
// no storage, no analytics. Inputs live in the location fragment, which
// browsers do not send to servers.
(() => {
  const $ = (s) => document.querySelector(s);
  const D = window.DECISION_CARD, C = window.CLAIM_CHECK;
  const Z = 1.959964;

  // ---- Interval ----------------------------------------------------------
  // Wilson score interval for one proportion, then Newcombe's hybrid-score
  // interval for the difference. Not the Wald interval: its coverage falls
  // below nominal exactly in the 90-99% band where picking robots operate,
  // which is the one place this tool must not quietly overstate certainty.
  function wilson(x, n) {
    if (n <= 0) return [0, 1];
    const d = n + Z * Z;
    const c = (x + (Z * Z) / 2) / d;
    const h = (Z / d) * Math.sqrt((x * (n - x)) / n + (Z * Z) / 4);
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }
  function newcombe(x1, n1, x2, n2) {
    const p1 = x1 / n1, p2 = x2 / n2;
    const [l1, u1] = wilson(x1, n1), [l2, u2] = wilson(x2, n2);
    const d = p1 - p2;
    return [
      Math.max(-1, d - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2)),
      Math.min(1, d + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)),
    ];
  }

  // Attempts per side needed to bring the interval's half-width below the
  // threshold, assuming the rates hold. Solved by search on the actual
  // interval rather than a normal approximation, so the answer matches the
  // interval the tool actually reports.
  function needed(p1, p2, thr) {
    const halfWidth = (n) => {
      const [lo, hi] = newcombe(Math.round(p1 * n), n, Math.round(p2 * n), n);
      return (hi - lo) / 2;
    };
    let n = 50;
    while (n < 2000000 && halfWidth(n) > thr) n = Math.ceil(n * 1.35);
    return n >= 2000000 ? null : n;
  }

  // ---- Reference class ---------------------------------------------------
  // Picked by attempts per side. Each class is a set of comparisons in which
  // the true difference is zero, so the curve over it is a false-positive
  // rate for a threshold rule: "call it a difference at >= X points".
  const CLASSES = (D && D.reference_classes) || [];
  const pickClass = (n) => CLASSES.reduce((best, c) =>
    Math.abs(c.episodes_per_arm - n) < Math.abs(best.episodes_per_arm - n) ? c : best, CLASSES[0]);
  function fprAt(cls, gapPP) {
    const pts = cls.curve;
    let hit = pts[0];
    // Binary rates land a hair under their decimal value: 188/200 - 176/200
    // is 5.999999999999995, not 6, which without a tolerance drops a
    // six-point gap into the four-point bucket and reports a rate half
    // again too alarming. The tolerance is far below any threshold spacing.
    const EPS = 1e-9;
    for (const p of pts) if (p.threshold_pp <= gapPP + EPS) hit = p;
    const beyond = gapPP > pts[pts.length - 1].threshold_pp;
    return { rate: hit.false_positive_rate, at: hit.threshold_pp, beyond };
  }

  // ---- Inputs ------------------------------------------------------------
  const FIELDS = ["bn", "bx", "an", "ax", "th", "runs"];
  const num = (id) => parseFloat($("#" + id).value);

  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    FIELDS.forEach((f) => { if (h.has(f)) $("#" + f).value = h.get(f); });
  }
  function writeHash() {
    const h = new URLSearchParams();
    FIELDS.forEach((f) => h.set(f, $("#" + f).value));
    history.replaceState(null, "", "#" + h.toString());
  }

  const pp = (x) => (x * 100).toFixed(1);
  const sgn = (x) => (x >= 0 ? "+" : "−");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const STATE = {
    improvement: ["placard--current", "Supported improvement"],
    regression: ["placard--revoked", "Supported regression"],
    nodiff: ["placard--specimen", "No material difference"],
    insufficient: ["placard--caution", "Insufficient evidence"],
  };

  function render() {
    const bn = num("bn"), bx = num("bx"), an = num("an"), ax = num("ax");
    const thr = num("th") / 100, runs = Math.max(1, Math.round(num("runs")) || 1);

    const bad = [];
    if (!(bn > 0) || !(an > 0)) bad.push("Attempts must be at least one on each side.");
    if (!(bx >= 0) || !(ax >= 0)) bad.push("Successes cannot be negative.");
    if (bx > bn || ax > an) bad.push("Successes cannot exceed attempts.");
    if (!(thr > 0)) bad.push("The difference worth acting on must be greater than zero.");
    $("#brate").textContent = bn > 0 && bx >= 0 && bx <= bn ? `${pp(bx / bn)}% success` : "";
    $("#arate").textContent = an > 0 && ax >= 0 && ax <= an ? `${pp(ax / an)}% success` : "";
    if (bad.length) {
      $("#out").innerHTML = `<div class="rc-card rc-card--wait"><span class="lbl">Check the inputs</span>
        <ul class="rc-warn">${bad.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>`;
      return;
    }
    writeHash();

    const pb = bx / bn, pa = ax / an;
    const d = pa - pb;
    const [lo, hi] = newcombe(ax, an, bx, bn);

    let state;
    if (lo > 0) state = "improvement";
    else if (hi < 0) state = "regression";
    else if (lo > -thr && hi < thr) state = "nodiff";
    else state = "insufficient";
    const [cls, label] = STATE[state];

    const perSide = Math.min(an, bn);
    const rc = CLASSES.length ? pickClass(perSide) : null;
    const ref = rc ? fprAt(rc, Math.abs(d) * 100) : null;

    // Warnings, most consequential first.
    const warn = [];
    if (runs === 1) {
      warn.push(`Both sides come from a single training run, so nothing here measures what changes when the same recipe is trained again. That variation is usually the largest term, and this interval does not contain it. Treat every verdict below as the best case.`);
    }
    if (rc && (perSide < rc.episodes_per_arm / 2 || perSide > rc.episodes_per_arm * 2)) {
      warn.push(`Your ${perSide.toLocaleString()} attempts a side sit well outside the reference class, which has ${rc.episodes_per_arm} an arm. The comparison below is indicative only.`);
    }
    if (ref && ref.beyond) {
      warn.push(`Your gap is larger than any threshold in the published reference curve, so its rate is quoted at the widest point measured rather than at your gap.`);
    }
    if (state === "improvement" && ref && ref.rate >= 0.05) {
      warn.push(`The interval calls this an improvement, but in the reference class a gap this wide turns up ${(ref.rate * 100).toFixed(1)}% of the time when nothing has changed. If your setup resembles that one, do not act on this alone.`);
    }

    const n1 = needed(pa, pb, thr);
    const plan = state === "insufficient"
      ? (n1 ? `<p>To settle it at your threshold you would need roughly <strong>${n1.toLocaleString()} attempts a side</strong>, holding these rates. You have ${perSide.toLocaleString()}.</p>`
            : `<p>No practical number of attempts would settle this at your threshold while the two rates stay this close. The threshold, not the sample, is the thing to revisit.</p>`)
      : "";

    $("#out").innerHTML = `
      <div class="rc-card rc-card--${state}">
        <div class="rc-card__head"><span class="lbl">The reading</span><span class="placard ${cls}">${label}</span></div>
        <span class="num num--big">${sgn(d)}${Math.abs(d * 100).toFixed(1)}<small> points</small></span>
        <p class="ci">95% interval ${sgn(lo)}${Math.abs(lo * 100).toFixed(1)} to ${sgn(hi)}${Math.abs(hi * 100).toFixed(1)} points
          &nbsp;·&nbsp; ${pp(pb)}% → ${pp(pa)}%</p>
        <div class="verdict ${state === "improvement" ? "verdict--ok" : state === "regression" ? "verdict--bad" : state === "nodiff" ? "" : "verdict--wait"}">
          ${reading(state, d, lo, hi, thr)}
        </div>
        ${plan}
        ${ref ? `<div class="rc-ref">
          <span class="lbl">Against the reference class</span>
          <p>A rule of <em>call it a difference at ${ref.at} points or more</em> fires on
             <strong>${(ref.rate * 100).toFixed(1)}%</strong> of ${rc.n_comparisons.toLocaleString()} comparisons
             in which the true difference is zero, at ${rc.episodes_per_arm} attempts an arm and
             ${rc.retrains_per_arm} training runs a side.
             <a href="decision.html#evidence">See the curve</a>.</p></div>` : ""}
        ${warn.length ? `<div class="rc-warns"><span class="lbl">Read before you act</span>
          <ul class="rc-warn">${warn.map((w) => `<li>${w}</li>`).join("")}</ul></div>` : ""}
      </div>`;
  }

  function reading(state, d, lo, hi, thr) {
    const t = (thr * 100).toFixed(1);
    if (state === "improvement") return `<strong>The whole interval is above zero.</strong> At this number of attempts, a gap this size is larger than sampling alone tends to produce. What that does not establish is that the change caused it.`;
    if (state === "regression") return `<strong>The whole interval is below zero.</strong> The measured rate fell by more than sampling alone tends to produce at this number of attempts.`;
    if (state === "nodiff") return `<strong>There is nothing here worth acting on.</strong> The interval covers zero and stays inside the ${t} points you said would change your decision, so a difference that large has been ruled out in both directions.`;
    return `<strong>This does not settle anything.</strong> The interval covers zero, but it also reaches past the ${t} points you said would change your decision, so a difference you would care about has not been ruled out either way.`;
  }

  // ---- Provenance --------------------------------------------------------
  if (D) {
    const p = D.panel;
    $("#rcabout").innerHTML = `Every comparison in the reference class is between two arms trained from an
      identical recipe, so the true difference in all of them is zero and every apparent winner is an error.
      It is ${p.n_runs} retrainings of <span class="mono">${esc(p.policy_class)}</span> on
      <span class="mono">${esc(p.suite)}</span>, a simulation benchmark, not a warehouse and not your robot.
      It is the right starting point when you have nothing better and the wrong thing to finish with:
      the number to compare against is your own repeated measurements, once there are any.
      Reported as false-positive rates for a family of threshold rules, which is all it can honestly support.`;
    $("#prov").innerHTML = `Reference classes: ${CLASSES.map((c) => `${c.n_comparisons.toLocaleString()} comparisons at ${c.episodes_per_arm} an arm`).join(", ")}.
      Panel <span class="mono">${esc(p.name)}</span>, generated ${esc(D.generated)}.
      ${C ? `Claim Check corpus <span class="mono">sha256 ${esc(C.corpus_sha256.slice(0, 16))}…</span>, <a href="claims-data.json" download>downloadable</a>.` : ""}
      <a href="method.html">Method</a> · <a href="decision.html">how the reference class is built</a>.`;
  }

  // ---- Wiring ------------------------------------------------------------
  FIELDS.forEach((f) => $("#" + f).addEventListener("input", render));
  $("#calc").addEventListener("submit", (e) => e.preventDefault());
  $("#reset").addEventListener("click", () => setTimeout(() => { render(); }, 0));
  $("#share").addEventListener("click", async () => {
    writeHash();
    const t = $("#toast");
    try {
      await navigator.clipboard.writeText(location.href);
      t.textContent = "Link copied. The numbers travel in the link, not to us.";
    } catch { t.textContent = "Copy the address bar — the numbers are in the link."; }
    t.hidden = false;
    clearTimeout($("#share").t);
    $("#share").t = setTimeout(() => (t.hidden = true), 2800);
  });

  // A fragment change does not reload the page, so following a shared link
  // while already here would otherwise leave the previous numbers on screen
  // with a new address in the bar. writeHash uses replaceState, which does
  // not fire this, so there is no loop.
  addEventListener("hashchange", () => { readHash(); render(); });

  readHash();
  render();
})();
