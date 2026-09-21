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
  const FIELDS = ["bn", "bx", "an", "ax", "th", "design"];
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
    const thr = num("th") / 100;
    const design = $("#design").value;

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
    // An unknown design overrides the arithmetic. The numbers still print,
    // because hiding them helps nobody, but the verdict says what it is.
    const undefined_design = design === "unknown";
    const [cls, label] = undefined_design
      ? ["placard--caution", "Not a defensible comparison"]
      : STATE[state];

    const perSide = Math.min(an, bn);
    const rc = CLASSES.length ? pickClass(perSide) : null;
    const ref = rc ? fprAt(rc, Math.abs(d) * 100) : null;

    // Warnings, most consequential first.
    const warn = [];
    // The design question outranks everything else: a matched or replayed
    // comparison is not what a two-proportion interval describes, and an
    // unknown design means the arithmetic has no standing at all.
    if (design === "matched" || design === "replay") {
      // Not "wider than it should be": pairing moves the variance in
      // either direction depending on how the pairs correlate, and this
      // page cannot know which. Say what is actually true — it is the
      // wrong estimator — and stop there.
      warn.push(`You said the two sides used ${design === "replay" ? "the same recorded episodes, replayed" : "the same tasks or items, matched one to one"}. This calculation does not use the pairing structure, so it is <strong>not the appropriate matched-design estimator</strong>. A paired analysis needs the per-item outcomes, which two totals do not carry; depending on how the pairs correlate, the correct interval could be narrower or wider than the one below.`);
    }
    warn.push(`This is an episode-level check. It cannot see training-run variation, because two success totals do not contain it, and on the evidence below that variation is usually larger than anything here. Read every verdict as a best case.`);
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

    window.__lastResult = {
      before: { attempts: bn, successes: bx, rate_pct: +(pb * 100).toFixed(1) },
      after: { attempts: an, successes: ax, rate_pct: +(pa * 100).toFixed(1) },
      difference_pp: +(d * 100).toFixed(1),
      interval_pp: [+(lo * 100).toFixed(1), +(hi * 100).toFixed(1)],
      interval_method: "Newcombe hybrid-score, 95%",
      design: $("#design").selectedOptions[0].textContent.trim(),
      threshold_pp: +(thr * 100).toFixed(1),
      verdict: label,
      verdict_key: undefined_design ? "not_defensible" : state,
      next_action: nextAction(undefined_design ? "unknown" : state, n1, perSide),
      reference: rc ? {
        n_comparisons: rc.n_comparisons, episodes_per_arm: rc.episodes_per_arm,
        retrains_per_arm: rc.retrains_per_arm, suite: (D.panel || {}).suite,
        threshold_pp: ref.at, false_positive_pct: +(ref.rate * 100).toFixed(1),
      } : null,
      corpus_sha256: C ? C.corpus_sha256 : null,
      generated: new Date().toISOString().slice(0, 19) + "Z",
      computed: "locally in the browser; no data sent to any server",
    };

    $("#out").innerHTML = `
      <div class="rc-card rc-card--${undefined_design ? "insufficient" : state}">
        <div class="rc-card__head"><span class="lbl">The reading</span><span class="placard ${cls}">${label}</span></div>
        <span class="num num--big">${sgn(d)}${Math.abs(d * 100).toFixed(1)}<small> percentage points</small></span>
        <p class="ci">95% interval ${sgn(lo)}${Math.abs(lo * 100).toFixed(1)} to ${sgn(hi)}${Math.abs(hi * 100).toFixed(1)} percentage points
          &nbsp;·&nbsp; ${pp(pb)}% → ${pp(pa)}%</p>
        <div class="verdict ${undefined_design ? "verdict--wait" : state === "improvement" ? "verdict--ok" : state === "regression" ? "verdict--bad" : state === "nodiff" ? "" : "verdict--wait"}">
          ${undefined_design
            ? `<strong>The arithmetic ran; the study design is unknown.</strong> Two totals cannot tell us whether the same items, tasks and conditions sat behind both, and if they did not, no interval here means what it appears to mean. Say how the attempts were collected and this becomes a verdict. Until then it is a calculation, not evidence.`
            : reading(state, d, lo, hi, thr)}
        </div>
        <div class="rc-next"><span class="lbl">What to do next</span><p>${nextAction(undefined_design ? "unknown" : state, n1, perSide)}</p></div>
        ${plan}
        ${ref ? `<div class="rc-ref">
          <span class="lbl">Against the reference class</span>
          <p>A rule of <em>call it a difference at ${ref.at} percentage points or more</em> fires on
             <strong>${(ref.rate * 100).toFixed(1)}%</strong> of ${rc.n_comparisons.toLocaleString()} comparisons
             in which the true difference is zero, at ${rc.episodes_per_arm} attempts an arm and
             ${rc.retrains_per_arm} training runs a side.
             <a href="decision.html#evidence">See the curve</a>.</p></div>` : ""}
        ${warn.length ? `<div class="rc-warns"><span class="lbl">Read before you act</span>
          <ul class="rc-warn">${warn.map((w) => `<li>${w}</li>`).join("")}</ul></div>` : ""}
      </div>`;
  }

  function nextAction(state, n1, perSide) {
    if (state === "unknown") return `Write down how the two sets of attempts were collected — same items or different, same shift or not, same scorer or not — and run this again. That sentence is worth more than any interval on this page.`;
    if (state === "improvement") return `Before you roll this out, repeat it across independent training runs. A gap that survives one comparison at one sample size is the weakest form of this evidence, and retraining is where most apparent wins go.`;
    if (state === "regression") return `Hold the rollout and investigate. Check whether the item mix, the scorer or the shift pattern also changed over the same window before concluding the software caused it.`;
    if (state === "nodiff") return `Do not spend effort reverting this change on the strength of the numbers. They rule out a difference as large as the one you said you would act on, in both directions.`;
    return n1
      ? `Collect roughly ${n1.toLocaleString()} attempts a side under the same protocol — you have ${perSide.toLocaleString()} — and run this again. Changing the protocol partway through makes the combined total worth less than either half.`
      : `Revisit the threshold rather than the sample. At these rates no practical number of attempts settles a difference this small.`;
  }

  function reading(state, d, lo, hi, thr) {
    const t = (thr * 100).toFixed(1);
    if (state === "improvement") return `<strong>The whole interval is above zero.</strong> At this number of attempts, a gap this size is larger than sampling alone tends to produce. What that does not establish is that the change caused it.`;
    if (state === "regression") return `<strong>The whole interval is below zero.</strong> The measured rate fell by more than sampling alone tends to produce at this number of attempts.`;
    if (state === "nodiff") return `<strong>There is nothing here worth acting on.</strong> The interval covers zero and stays inside the ${t} percentage points you said would change your decision, so a difference that large has been ruled out in both directions.`;
    return `<strong>This does not settle anything.</strong> The interval covers zero, but it also reaches past the ${t} percentage points you said would change your decision, so a difference you would care about has not been ruled out either way.`;
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
  function brief(fmt) {
    const b = window.__lastResult;
    if (!b) return "";
    if (fmt === "json") return JSON.stringify(b, null, 2);
    return [
      `# Difference check — orbiteval.com/real.html`,
      ``,
      `Before: ${b.before.successes} of ${b.before.attempts} (${b.before.rate_pct.toFixed(1)}%)`,
      `After:  ${b.after.successes} of ${b.after.attempts} (${b.after.rate_pct.toFixed(1)}%)`,
      `Difference: ${b.difference_pp.toFixed(1)} percentage points`,
      `95% interval: ${b.interval_pp[0].toFixed(1)} to ${b.interval_pp[1].toFixed(1)} percentage points (Newcombe hybrid-score)`,
      `Study design as stated: ${b.design}`,
      `Threshold that would change a decision: ${b.threshold_pp.toFixed(1)} percentage points`,
      ``,
      `Verdict: ${b.verdict}`,
      `Next: ${b.next_action}`,
      ``,
      `Reference class: ${b.reference.n_comparisons} comparisons of the same recipe`,
      `  at ${b.reference.episodes_per_arm} episodes an arm, ${b.reference.retrains_per_arm} training runs a side,`,
      `  simulated ${b.reference.suite} benchmark, true difference zero by construction.`,
      `  A rule of "at least ${b.reference.threshold_pp} percentage points" fires on ${b.reference.false_positive_pct.toFixed(1)}% of them.`,
      ``,
      `Limits: episode-level only; cannot see training-run variation.`,
      `  The reference class is a simulation benchmark, not warehouse evidence`,
      `  and not a universal error rate.`,
      `Corpus sha256: ${b.corpus_sha256}`,
      `Generated: ${b.generated} · computed in the browser, nothing uploaded.`,
    ].join("\n");
  }

  function copyBrief(fmt, label) {
    const t = $("#toast");
    navigator.clipboard.writeText(brief(fmt)).then(
      () => { t.textContent = `${label} copied. Built in your browser.`; },
      () => { t.textContent = "Could not copy — your browser blocked it."; }
    ).then(() => {
      t.hidden = false; clearTimeout(copyBrief.t);
      copyBrief.t = setTimeout(() => (t.hidden = true), 2800);
    });
  }
  $("#copy-md").addEventListener("click", () => copyBrief("md", "Markdown brief"));
  $("#copy-json").addEventListener("click", () => copyBrief("json", "JSON"));

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
