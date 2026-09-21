// Decision card — renders decision-data.js, which build/decision_export.py
// writes from the pi05_libero_object panel. Formatting only; every number
// here was computed by the study's own modules.
(() => {
  const D = window.DECISION_CARD;
  const $ = (s) => document.querySelector(s);
  if (!D) return;

  const P = D.panel, H = D.headline, C = D.counts;
  const pp = (x) => x.toFixed(1);
  const tidy = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const seed = (r) => r.split("_").pop();

  // A p of 1.6e-17 has no useful decimal form, and "p < 0.000001" would
  // understate it by eleven orders of magnitude. Print the exponent, and
  // give the same number again as odds, which is the form a reader who
  // does not work in p-values can actually feel.
  const sci = (x) => {
    const e = Math.floor(Math.log10(x));
    return `${(x / Math.pow(10, e)).toFixed(1)} \u00d7 10\u207b${String(-e).split("").map((d) => "\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079"[+d]).join("")}`;
  };
  const SCALES = [[1e15, "quadrillion"], [1e12, "trillion"], [1e9, "billion"], [1e6, "million"], [1e3, "thousand"]];
  const odds = (x) => {
    const n = 1 / x;
    for (const [v, name] of SCALES) if (n >= v) return `${Math.round(n / v).toLocaleString()} ${name}`;
    return Math.round(n).toLocaleString();
  };


  // ---- The naive read ----------------------------------------------------
  // The four labels on this card are load-bearing. The arm rates stay
  // visible because without them there is no case to decide, but each one
  // is named for exactly what it is: an observed rate, a naive read, a
  // run-level read, and an interpretation that is not a recommendation
  // about any deployment.
  const hi = H.rate_b >= H.rate_a;
  $("#naive").innerHTML = `
    <div class="dc-two">
      <div><span class="dc-arm">Arm A</span><span class="num num--big">${pp(H.rate_a)}<small>%</small></span>
        <p class="small mono">${H.x_a} of ${H.n_a} episodes</p></div>
      <div><span class="dc-arm">Arm B</span><span class="num num--big">${pp(H.rate_b)}<small>%</small></span>
        <p class="small mono">${H.x_b} of ${H.n_b} episodes</p></div>
    </div>
    <div class="dc-gap">
      <span class="num cc-bad">${pp(H.gap_pp)} points apart</span>
      <p class="small mono">z = ${H.z.toFixed(2)} · p = ${sci(H.p_two_sided)}</p>
      <p class="small">Pooling the episodes and comparing the two rates, the gap clears every conventional threshold by a wide margin.
      This test puts the odds of a gap this large, if the two were really the same, at about <strong>one in ${odds(H.p_two_sided)}</strong>.
      On this reading, arm ${hi ? "B" : "A"} is the winner and the matter is settled. It is not.</p>
    </div>`;

  // ---- The card ----------------------------------------------------------
  $("#card").innerHTML = `
    <div class="dc-card__head">
      <span class="lbl">Decision card</span>
      <span class="placard placard--specimen">No material difference detected</span>
    </div>
    <dl class="dc-kv">
      <div><dt>Observed arm rates</dt>
        <dd class="mono">${pp(H.rate_a)}% vs ${pp(H.rate_b)}%
          <span class="dc-sub">arm A ${H.x_a}/${H.n_a} · arm B ${H.x_b}/${H.n_b} · ${esc(P.suite)} task ${H.task}</span></dd></div>
      <div><dt>Naive episode-level read</dt>
        <dd><strong>Winner</strong>
          <span class="dc-sub mono">z = ${H.z.toFixed(2)} · p = ${sci(H.p_two_sided)}, pooling all ${H.n_a + H.n_b} episodes</span></dd></div>
      <div><dt>Run-level read</dt>
        <dd><strong>No material difference detected</strong>
          <span class="dc-sub mono">t = ${H.welch_t.toFixed(2)} against ${H.t_crit.toFixed(3)} at ${H.df} df, over ${D.arm_size * 2} training runs</span></dd></div>
      <div><dt>Interpretation</dt>
        <dd>Same recipe, different seed. <strong>Not a deployment recommendation.</strong>
          <span class="dc-sub">Both arms were trained from one recipe on identical data, so the true difference is exactly zero and the naive read is a known error.</span></dd></div>
    </dl>
    <div class="verdict">
      <strong>The gap is not evidence of a difference.</strong>
      Two runs per arm cannot separate a gap of this size from the variation between runs of the same recipe.
      Nothing here says anything about whether either arm is fit to deploy; the comparison is between a thing and a copy of itself.
    </div>
    <div class="dc-rec">
      <span class="lbl">What to do with a comparison shaped like this</span>
      <p>Do not act on two runs a side at this sample size. Either repeat the training runs, or raise the gap at which a difference counts as one — the curve below prices both choices.</p>
    </div>`;

  // ---- False-positive curve ----------------------------------------------
  // What the register permits and what a reader actually needs: for a family
  // of decision rules of the form "call it a difference at >= X points",
  // how often each one fires when the truth is zero. One series, so the
  // title names it and no legend is needed.
  const RC = D.reference_classes.find((r) => r.retrains_per_arm === D.arm_size);
  const curve = RC.curve;
  const W = 720, Hh = 300, M = { t: 18, r: 22, b: 44, l: 54 };
  const xMax = curve[curve.length - 1].threshold_pp;
  const sx = (v) => M.l + (v / xMax) * (W - M.l - M.r);
  const sy = (v) => M.t + (1 - v) * (Hh - M.t - M.b);
  const path = curve.map((c, i) => `${i ? "L" : "M"}${sx(c.threshold_pp).toFixed(1)},${sy(c.false_positive_rate).toFixed(1)}`).join("");

  // Where the rule finally reaches the 5% a reader assumes they are getting.
  const cross = curve.find((c) => c.false_positive_rate <= 0.05);

  const gridY = [0, 0.25, 0.5, 0.75, 1];
  $("#fpr").innerHTML = `
  <svg viewBox="0 0 ${W} ${Hh}" class="dc-svg" role="img"
       aria-label="False-positive rate against decision threshold, over ${RC.n_comparisons} comparisons where the true difference is zero">
    ${gridY.map((g) => `<line x1="${M.l}" x2="${W - M.r}" y1="${sy(g)}" y2="${sy(g)}" class="dc-grid"/>
      <text x="${M.l - 10}" y="${sy(g) + 4}" class="dc-ax dc-ax--y">${(g * 100).toFixed(0)}%</text>`).join("")}
    ${[0, 10, 20, 30, 40].map((t) => `<text x="${sx(t)}" y="${Hh - 22}" class="dc-ax">${t}</text>`).join("")}
    <text x="${(M.l + W - M.r) / 2}" y="${Hh - 4}" class="dc-ax dc-ax--title">Call it a difference at this many points or more</text>
    <line x1="${M.l}" x2="${W - M.r}" y1="${sy(0.05)}" y2="${sy(0.05)}" class="dc-ref"/>
    <text x="${W - M.r}" y="${sy(0.05) - 8}" class="dc-ax dc-ax--ref" text-anchor="end">the 5% you think you are getting</text>
    <path d="${path}" class="dc-line"/>
    ${curve.map((c) => `<circle cx="${sx(c.threshold_pp)}" cy="${sy(c.false_positive_rate)}" r="9" class="dc-hit"
      tabindex="0" data-tip="A rule of &quot;at least ${c.threshold_pp} points&quot; fires on ${(c.false_positive_rate * 100).toFixed(1)}% of ${RC.n_comparisons.toLocaleString()} comparisons where the true difference is zero"/>`).join("")}
  </svg>`;

  $("#evidence-lede").innerHTML = `Take every way of splitting these ${P.n_runs} runs into two arms of ${D.arm_size}, across all ${P.n_tasks} tasks:
    <strong>${RC.n_comparisons.toLocaleString()} comparisons</strong> of ${RC.episodes_per_arm} episodes a side in which the true difference is zero.
    Now pick a rule — <em>call it a difference when the gap is at least X points</em> — and count how often it fires. Every firing is a false positive.`;

  $("#fprnote").innerHTML = cross
    ? `A rule has to wait for a gap of <strong>${cross.threshold_pp} points</strong> before its false-positive rate drops to the 5% most people assume they are working at. At ten points it is still ${(curve.find((c) => c.threshold_pp === 10).false_positive_rate * 100).toFixed(1)}%.`
    : `Across the whole range shown, no threshold rule reaches a 5% false-positive rate.`;

  // Every threshold except zero, which is trivially 100%. The table is the
  // chart's data, so nothing here is encoded in position alone.
  $("#fprrows").innerHTML = curve.filter((c) => c.threshold_pp > 0)
    .map((c) => `<tr><td class="mono">≥ ${c.threshold_pp} points</td>
      <td class="n mono">${Math.round(c.false_positive_rate * RC.n_comparisons).toLocaleString()} of ${RC.n_comparisons.toLocaleString()}</td>
      <td class="n mono">${(c.false_positive_rate * 100).toFixed(1)}%</td></tr>`).join("");

  // ---- Frequency ---------------------------------------------------------
  const rate = (n) => (n / C.n_cells * 100).toFixed(1) + "%";
  $("#freq-lede").innerHTML = `The pair on the card is the widest of its kind, but not a rarity.
    Splitting the ${P.n_runs} runs into every possible pair of arms of ${D.arm_size}, across all ${P.n_tasks} tasks,
    gives <strong>${C.n_cells.toLocaleString()}</strong> comparisons in which the true difference is zero.`;
  $("#freq").innerHTML = `
    <div class="cc-null__row">
      <div><span class="lbl">Pooled episodes</span><span class="num num--big cc-bad">${rate(C.episode_level_rejects)}</span>
        <p class="small">${C.episode_level_rejects} of ${C.n_cells.toLocaleString()} comparisons announced a winner.</p></div>
      <div><span class="lbl">Runs as the unit</span><span class="num num--big cc-good">${rate(C.retrain_level_rejects)}</span>
        <p class="small">${C.retrain_level_rejects} of the same comparisons announced a winner.</p></div>
    </div>
    <p class="small cc-null__foot">Both tested at the 5% level. Every rejection by the stricter test is also one by the looser: ${C.episode_only_rejects} comparisons are called by pooling alone.</p>`;

  // ---- Provenance --------------------------------------------------------
  $("#limit-provenance").innerHTML = `<strong>This is a simulation benchmark, not a warehouse.</strong>
    The panel is ${P.n_runs} retrainings of <span class="mono">${esc(P.policy_class)}</span> evaluated on
    <span class="mono">${esc(P.suite)}</span>, ${P.n_tasks} tasks, ${P.episodes_per_cell} episodes each.
    No robot picked a real item here, and no rate on this page describes any deployed system. What transfers is the
    arithmetic: a deployment logging a few hundred in-scope attempts a week sits at the left end of this curve, not the right.`;

  // ---- Hover -------------------------------------------------------------
  const tip = $("#tip");
  const show = (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) return;
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    const r = t.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, r.left + r.width / 2 - tip.offsetWidth / 2)) + "px";
    tip.style.top = (r.top + window.scrollY - tip.offsetHeight - 10) + "px";
  };
  const hide = () => { tip.hidden = true; };
  $("#fpr").addEventListener("mouseover", show);
  $("#fpr").addEventListener("focusin", show);
  $("#fpr").addEventListener("mouseout", hide);
  $("#fpr").addEventListener("focusout", hide);
})();
