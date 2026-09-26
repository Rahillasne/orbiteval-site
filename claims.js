// Claim Check — renders claims-data.js, which build/claims_export.py writes
// from Corpus 2 v2 and the audit modules. Nothing is computed here; this file
// only formats.
(() => {
  const D = window.CLAIM_CHECK;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  if (!D) { $("#rows").innerHTML = '<tr><td colspan="8">Could not load the data file.</td></tr>'; return; }

  const pct = (x) => (x * 100).toFixed(1) + "%";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // A rate exactly as the paper printed it, with its unit.
  const printed = (c, v) => (c.printed_unit === "percent" ? v + "%" : v);
  // A count, or the words for its absence. Never a formatted null.
  const count = (c) => (c.n_episodes === null ? "not stated" : c.n_episodes.toLocaleString());
  const sign = (x) => (x > 0 ? "+" : "");

  // States shown to a reader, folded from the study's five plus one. "erased"
  // and "fails_on_episode_noise" are both "not supported"; the row detail says
  // which kind of noise was enough.
  const S = D.summary;
  const notSupported = S.erased + S.fails_on_episode_noise;

  const VENUE = {
    simulation_benchmark: ["Simulation", "tag--grey"],
    physical_robot: ["Physical robot", "tag--venue"],
    unstated: ["Unstated", "tag--grey"],
  };
  const PLACARD = {
    survives: "placard--current",
    inconclusive: "placard--caution",
    erased: "placard--revoked",
    fails_on_episode_noise: "placard--revoked",
    negative_gain: "placard--specimen",
    count_not_stated: "placard--unknown",
  };

  // ---- Tally -------------------------------------------------------------
  const tally = [
    { n: S.survives, label: "Supported", sub: "Gain larger than retraining noise at its harshest.", cls: "is-zero" },
    { n: S.inconclusive, label: "Inconclusive", sub: "Gain sits inside the observed range of retraining noise.", cls: "" },
    { n: notSupported, label: "Not supported", sub: `Gain smaller than noise. ${S.fails_on_episode_noise} fail on episode count alone.`, cls: "" },
    { n: S.count_not_stated, label: "Count not stated", sub: "The paper states no single episode count, so the gain cannot be sized.", cls: "" },
    { n: S.negative_gain, label: "Reported loss", sub: "Authors report a decrease. Excluded from the tally.", cls: "" },
  ];
  $("#tally").innerHTML = tally.map((t) => `
    <div class="cc-stat ${t.cls}">
      <span class="num num--big">${t.n}<small> / ${D.n_claims}</small></span>
      <span class="lbl">${t.label}</span>
      <p class="small">${t.sub}</p>
    </div>`).join("");

  // ---- Robustness --------------------------------------------------------
  const Z = D.summary_at_zero_floor;
  $("#robustness").innerHTML = `<strong>This does not turn on how harsh we were.</strong>
    Set the retraining-noise floor to zero — the most forgiving assumption available, under which no claim can be erased by retraining at all —
    and the count of supported claims is still <strong>${Z.survives} of ${D.n_claims}</strong>.
    ${Z.fails_on_episode_noise} of them do not clear the noise in their own episode counts before retraining is considered,
    and ${Z.count_not_stated} state no single episode count at all.`;

  // ---- Table -------------------------------------------------------------
  const rows = D.claims.map((c, i) => ({ ...c, i }));
  let active = "all";

  function detail(c) {
    let sig;
    if (c.state === "count_not_stated") {
      sig = `<p>No <span class="mono">σ*</span> is computed.${c.n_note ? " " + esc(c.n_note) : ""}</p>`;
    } else if (c.sigma_star_pp === null) {
      sig = `<p>No amount of retraining noise is needed to erase this gain: it does not clear the noise in its own ${count(c)} episodes per arm. <span class="mono">σ*</span> does not exist.</p>`;
    } else {
      sig = `<p><span class="mono">σ* = ${c.sigma_star_pp.toFixed(2)} pp</span> — retraining noise of that size would erase the reported gain.
         At this comparison's pooled rate of ${pct(c.pooled_rate)}, the mean of the two printed rates, external sources put retraining noise between
         <span class="mono">${c.band_lo_pp.toFixed(2)}</span> and <span class="mono">${c.band_hi_pp.toFixed(2)} pp</span>.</p>`;
    }
    const basis = c.n_basis.map((q) => `p.${q.page}: “${esc(q.quote)}”`).join(" ");
    const took = c.n_episodes === null
      ? "and no episode count, because the paper does not state one"
      : `over ${count(c)} episodes per arm`;
    return `<tr class="cc-detail" data-for="${c.i}" hidden><td colspan="8">
      <div class="cc-detail__in">
        <div><span class="lbl">Verdict</span><p>${esc(c.state_line)}</p>${sig}</div>
        <div><span class="lbl">Go and check it</span>
          <p class="cc-cite">${esc(c.source.title || c.paper)}<br>
            <span class="small">${esc((c.source.authors || "").split(" and ").slice(0, 3).join(", "))}${(c.source.authors || "").split(" and ").length > 3 ? " and others" : ""}</span></p>
          <p><a class="cc-src" href="${esc(c.source.url)}" target="_blank" rel="noopener">arXiv:${esc(c.source.arxiv)}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg></a></p>
          <p class="small"><strong>What the paper prints:</strong> ${esc(c.candidate_display)}: ${esc(printed(c, c.candidate_printed))}; ${esc(c.baseline_display)}: ${esc(printed(c, c.baseline_printed))} (p.${c.source.page}, ${esc(c.source.where)}).</p>
          <p class="small"><strong>What it says about episodes:</strong> ${basis}</p>
          <p class="small"><strong>What we took from it:</strong> a gain of ${sign(c.delta_pp)}${c.delta_pp.toFixed(2)} points, ${took}, at the ${esc(c.level)} level. Nothing else from the paper is used.</p>
          <p class="mono small">${esc(c.citation_key)}</p>
        </div>
      </div>
    </td></tr>`;
  }

  function render() {
    const q = ($("#q").value || "").trim().toLowerCase();
    let shown = 0;
    const html = rows.map((c) => {
      const bucket = c.state === "erased" || c.state === "fails_on_episode_noise" ? "not_supported" : c.state;
      const hit = (active === "all" || bucket === active)
        && (!q || `${c.paper} ${c.claim} ${c.candidate_display} ${c.baseline_display} ${c.state_label} ${c.venue}`.toLowerCase().includes(q));
      if (hit) shown++;
      const [vl, vc] = VENUE[c.venue] || VENUE.unstated;
      return `<tr class="cc-row" data-i="${c.i}" ${hit ? "" : "hidden"}>
        <td><a class="cc-src" href="${esc(c.source.url)}" target="_blank" rel="noopener">${esc(c.paper)}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg></a></td>
        <td>${esc(c.candidate_display)} <span class="small">vs</span> ${esc(c.baseline_display)}<br><span class="small">${esc(c.claim)}</span></td>
        <td><span class="tag ${vc}">${vl}</span></td>
        <td class="n mono">${sign(c.delta_pp)}${c.delta_pp.toFixed(2)} pp</td>
        <td class="n mono">${count(c)}</td>
        <td class="n mono">${esc(printed(c, c.baseline_printed))} → ${esc(printed(c, c.candidate_printed))}</td>
        <td><span class="placard ${PLACARD[c.state]}">${esc(c.state_label)}</span></td>
        <td class="n"><button class="cc-more" type="button" aria-expanded="false" data-i="${c.i}">Why</button></td>
      </tr>${detail(c)}`;
    }).join("");
    $("#rows").innerHTML = html;
    $("#nomatch").hidden = shown > 0;
    $("#rowcount").textContent = `Showing ${shown} of ${D.n_claims} claims. Screened ${D.n_papers_screened} papers to find them.`;
    $$(".cc-more").forEach((b) => b.addEventListener("click", () => {
      const d = document.querySelector(`.cc-detail[data-for="${b.dataset.i}"]`);
      const open = b.getAttribute("aria-expanded") === "true";
      b.setAttribute("aria-expanded", String(!open));
      b.textContent = open ? "Why" : "Hide";
      d.hidden = open;
    }));
  }

  // ---- Filters -----------------------------------------------------------
  const FILTERS = [
    ["all", `All ${D.n_claims}`],
    ["not_supported", `Not supported ${notSupported}`],
    ["inconclusive", `Inconclusive ${S.inconclusive}`],
    ["count_not_stated", `Count not stated ${S.count_not_stated}`],
    ["survives", `Supported ${S.survives}`],
    ["negative_gain", `Reported loss ${S.negative_gain}`],
  ];
  $("#filters").innerHTML = FILTERS.map(([k, l]) =>
    `<button type="button" class="cc-filter${k === "all" ? " is-on" : ""}" data-k="${k}">${l}</button>`).join("");
  $$(".cc-filter").forEach((b) => b.addEventListener("click", () => {
    active = b.dataset.k;
    $$(".cc-filter").forEach((o) => o.classList.toggle("is-on", o === b));
    render();
  }));
  $("#q").addEventListener("input", render);

  // ---- Null reference ----------------------------------------------------
  const nr = D.null_reference;
  if (nr) {
    const j2 = nr.by_retrains.find((r) => r.retrains_per_arm === 2) || nr.by_retrains[0];
    $("#nullref").innerHTML = `
      <div class="cc-null__row">
        <div><span class="lbl">The usual test</span>
          <span class="num num--big cc-bad">${pct(j2.episode_level_reject)}</span>
          <p class="small">of ${j2.n_cells.toLocaleString()} comparisons announced a winner, where the true difference was zero.</p></div>
        <div><span class="lbl">Counting retraining as a source of noise</span>
          <span class="num num--big cc-good">${pct(j2.retrain_level_reject)}</span>
          <p class="small">of the same comparisons announced a winner.</p></div>
      </div>
      <p class="small cc-null__foot">Nominal rate for both: ${pct(nr.nominal_alpha)}. ${j2.episodes_per_cell} episodes per cell, ${j2.n_tasks} tasks, ${j2.retrains_per_arm} retrains per arm.</p>`;
    const more = nr.by_retrains.filter((r) => r.retrains_per_arm !== j2.retrains_per_arm)
      .map((r) => `${pct(r.episode_level_reject)} at ${r.retrains_per_arm} retrains per arm`).join(", ");
    $("#nullnote").innerHTML = `Adding data does not fix it: the usual test gets <em>worse</em> as more retrains are averaged in — ${esc(more)}. Panel: <span class="mono">${esc(nr.panel)}</span>.`;
  }

  // ---- Provenance line ---------------------------------------------------
  $("#repro").innerHTML = `The corpus is ${D.n_claims} claims from papers by external groups: Corpus 2 v${D.corpus_version}, corrected ${esc(D.corrected)},
    hashed <span class="mono">sha256 ${esc(D.corpus_sha256.slice(0, 16))}…</span> and published as
    <a href="${esc(D.corpus_file)}" download>${esc(D.corpus_file)}</a>, with the data behind this page in <a href="claims-data.json" download>claims-data.json</a>.
    The previous version stays published as <a href="${esc(D.corpus_v1_file)}" download>${esc(D.corpus_v1_file)}</a>.
    The retraining-noise band comes from ${D.band.n_cells} cells across ${Object.keys(D.band.sources).length} external sources and is derived at run time, not typed:
    <span class="mono">${D.band.coef_min.toFixed(4)}</span> to <span class="mono">${D.band.coef_max.toFixed(4)}</span>.
    Generated ${esc(D.generated)} under protocol v${D.protocol_version}.`;

  render();
})();
