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
      On this reading, arm ${hi ? "B" : "A"} is better and the matter is settled.</p>
    </div>`;

  // ---- The card ----------------------------------------------------------
  $("#card").innerHTML = `
    <div class="dc-card__head">
      <span class="lbl">Decision card</span>
      <span class="placard placard--specimen">No material difference</span>
    </div>
    <dl class="dc-kv">
      <div><dt>Compared</dt><dd class="mono">arm A (${H.arm_a.map(seed).join(", ")}) against arm B (${H.arm_b.map(seed).join(", ")})</dd></div>
      <div><dt>Task</dt><dd class="mono">${esc(P.suite)} · task ${H.task}</dd></div>
      <div><dt>Evidence</dt><dd>${H.n_a + H.n_b} episodes, ${D.arm_size * 2} training runs</dd></div>
      <div><dt>Per-run rates</dt><dd class="mono">A: ${H.per_run_a.map(pp).join("%, ")}% &nbsp;·&nbsp; B: ${H.per_run_b.map(pp).join("%, ")}%</dd></div>
    </dl>
    <div class="verdict">
      <strong>The gap is not evidence of a difference.</strong>
      Treating each training run as the unit rather than each episode, the statistic is
      <span class="mono">t = ${H.welch_t.toFixed(2)}</span> against a critical value of
      <span class="mono">${H.t_crit.toFixed(3)}</span> at ${H.df} degree of freedom, and the comparison does not reject.
      Two runs per arm cannot resolve a gap of this size from the variation between runs of the same recipe.
    </div>
    <div class="dc-truth">
      <span class="lbl">Known truth</span>
      <p>Both arms are retrainings of one recipe on identical data, so the real difference between them is exactly zero. The pooled-episode reading above is wrong, and this is a case where that can be stated rather than suspected.</p>
    </div>
    <div class="dc-rec">
      <span class="lbl">Recommendation</span>
      <p>Do not act on a single-run comparison at this task's noise level. Repeat the training run, or accept that a difference below the run-to-run spread is not measurable with the data in hand.</p>
    </div>`;

  // ---- Heat table --------------------------------------------------------
  // Sequential encoding: one hue, light to dark, on the ink token. Success
  // rate here is neither good nor bad — the spread across a row is the
  // point — so it must not borrow a status hue or the brand hue.
  const runs = P.runs;
  const shade = (v) => 0.05 + (v / 100) * 0.72;   // 0..100 -> alpha
  const ink = (v) => (shade(v) > 0.46 ? "var(--paper)" : "var(--ink-2)");
  const maxSpread = Math.max(...D.matrix.map((m) => m.spread));

  const head = `<div class="dc-heat__r dc-heat__r--head">
      <span class="dc-heat__t">Task</span>
      ${runs.map((r) => `<span class="dc-heat__c dc-heat__c--head">${esc(seed(r))}</span>`).join("")}
      <span class="dc-heat__s dc-heat__s--head">Spread</span></div>`;

  const body = D.matrix.map((m) => {
    const cells = m.cells.map((c) => {
      const v = c.successes / c.n * 100;
      const edge = v === m.min ? " is-min" : (v === m.max ? " is-max" : "");
      return `<span class="dc-heat__c${edge}" style="background:rgba(20,20,19,${shade(v).toFixed(3)});color:${ink(v)}"
        tabindex="0" data-tip="${esc(seed(c.run))}, task ${m.task}: ${c.successes} of ${c.n} episodes succeeded (${pp(v)}%)">${tidy(v)}</span>`;
    }).join("");
    return `<div class="dc-heat__r">
      <span class="dc-heat__t">${m.task}</span>${cells}
      <span class="dc-heat__s"><i style="width:${(m.spread / maxSpread * 100).toFixed(1)}%"></i><b>${tidy(m.spread)}</b></span></div>`;
  }).join("");

  $("#heat").innerHTML = head + body;

  $("#evidence-lede").innerHTML = `Every cell is a real evaluation: ${P.episodes_per_cell} episodes of
    <span class="mono">${esc(P.policy_class)}</span> on one task of <span class="mono">${esc(P.suite)}</span>.
    Reading across a row, the only thing that changes between the columns is the training seed.
    ${P.total_episodes.toLocaleString()} episodes in total.`;

  const worst = D.matrix.reduce((a, b) => (b.spread > a.spread ? b : a));
  $("#heatnote").innerHTML = `Darker is a higher success rate. The outlined cells are the lowest and highest run in each row.
    The widest row is task ${worst.task}, where identical recipes land anywhere from <strong>${pp(worst.min)}%</strong> to
    <strong>${pp(worst.max)}%</strong>. Not one row is flat.`;

  $("#legend").innerHTML = `<span class="lbl">Success rate</span>
    <span class="dc-ramp">${[0, 20, 40, 60, 80, 100].map((v) =>
      `<i style="background:rgba(20,20,19,${shade(v).toFixed(3)})" title="${v}%"></i>`).join("")}</span>
    <span class="small mono">0% → 100%</span>`;

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
    arithmetic: a deployment logging a few hundred in-scope attempts a week has less data than a row of this table, not more.`;

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
  $("#heat").addEventListener("mouseover", show);
  $("#heat").addEventListener("focusin", show);
  $("#heat").addEventListener("mouseout", hide);
  $("#heat").addEventListener("focusout", hide);
})();
