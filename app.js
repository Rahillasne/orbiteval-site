// Orbit workspace. Static: reads app-data.json, routes on the hash, no accounts.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n).toLocaleString("en-US");
  const pct = (x) => (x == null ? "—" : Number(x).toFixed(1) + "%");
  const ci = (c) => (c && c.ci ? `${c.ci[0].toFixed(1)}–${c.ci[1].toFixed(1)}` : "");
  const STATUS = { current: ["Current", "current"], insufficient: ["Insufficient data", "caution"], revoked: ["Revoked", "revoked"] };
  const placard = (s) => { const [l, c] = STATUS[s] || [s, "specimen"]; return `<span class="placard placard--${c}">${l}</span>`; };
  const spec = (d) => (d.specimen ? `<span class="placard placard--specimen">Specimen</span>` : "");
  const ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
  const embed = new URLSearchParams(location.search).has("embed");
  if (embed) document.body.classList.add("is-embed");
  const main = $("#ws-main");
  let DATA = null;
  const state = { q: "", f: "all" };

  const last = (d) => d.checks[d.checks.length - 1];
  const byId = (id) => DATA.deployments.find((d) => d.id.toLowerCase() === String(id).toLowerCase());
  const pageURL = (id) => location.origin + location.pathname + "#/d/" + id;

  // ---------- storage (per-viewer conveniences only) ----------
  const recent = {
    get() { try { return JSON.parse(localStorage.getItem("orbit-ws-recent") || "[]"); } catch { return []; } },
    push(id) { try { const r = [id, ...this.get().filter((x) => x !== id)].slice(0, 5); localStorage.setItem("orbit-ws-recent", JSON.stringify(r)); } catch {} },
  };
  function renderHistory() {
    const el = $("#ws-hist"); if (!el) return;
    el.innerHTML = recent.get().filter(byId).map((id) => `<a href="#/d/${esc(id)}">${esc(id)}</a>`).join("");
  }

  // ---------- routing ----------
  function parse() {
    const h = location.hash.replace(/^#\/?/, "");
    const [path, qs] = h.split("?");
    return { parts: path.split("/").filter(Boolean), q: new URLSearchParams(qs || "") };
  }
  function route() {
    if (!DATA) return;
    const { parts, q } = parse();
    const view = parts[0] || "deployments";
    let html;
    if (view === "d" && parts[1]) html = viewGrade(decodeURIComponent(parts[1]), parts[2]);
    else if (view === "reports") html = viewReports();
    else if (view === "registry") html = viewRegistry(q.get("q") || "");
    else if (view === "calibration") html = viewCalibration();
    else if (view === "protocols") html = viewProtocols();
    else html = viewDeployments();
    main.innerHTML = html;
    if (!embed) window.scrollTo(0, 0);
    $$("#ws-nav a").forEach((a) => a.classList.toggle("is-on", a.dataset.route === (view === "d" ? "deployments" : view)));
    bind();
    renderHistory();
  }

  // ---------- pieces ----------
  const notice = () => (DATA.real_deployments === 0 ? `<div class="notice">${esc(DATA.notice)}</div>` : "");
  function head(title, sub, actions = "") {
    return `<header class="v__head"><div><div class="v__title"><h1>${title}</h1></div>${sub ? `<p class="v__sub">${sub}</p>` : ""}</div><div class="v__actions">${actions}</div></header>`;
  }
  function measuredCell(d, c) {
    return d.status === "insufficient" && c === last(d) ? `<span class="mono">—</span>` : `<span class="mono">${pct(c.measured)}</span> <span class="small">(${ci(c)})</span>`;
  }
  function rows(list) {
    return list.map((d) => { const c = last(d); return `<tr data-href="#/d/${esc(d.id)}"><td class="mono"><a href="#/d/${esc(d.id)}">${esc(d.id)}</a></td><td>${esc(d.site)}</td><td>${esc(d.vendor)}</td><td class="n">${measuredCell(d, c)}</td><td>${spec(d)} ${placard(d.status)}</td><td class="mono">${esc(c.issued)}</td><td class="mono">${esc(c.next_due)}</td></tr>`; }).join("");
  }
  function reading(d, c, live) {
    const vals = [c.ci[0], c.measured, d.threshold, d.claim];
    let min = Math.floor((Math.min(...vals) - 4) / 5) * 5; if (min < 0) min = 0;
    const step = 100 - min > 30 ? 10 : 5;
    const ticks = []; for (let t = min; t <= 100; t += step) ticks.push(t);
    return `<figure class="reading ${live ? "reading--live" : ""}" aria-label="Claimed ${d.claim} percent, measured ${c.measured} percent, interval ${ci(c)}">
      <figcaption class="reading__cap"><span>The reading</span><span>n = ${fmt(c.sampled)} of ${fmt(c.population)}</span></figcaption>
      <div class="reading__row"><span class="lbl">Claimed</span><span class="num">${d.claim.toFixed(1)}<small>%</small></span></div>
      <div class="reading__row"><span class="lbl">Measured</span><span><span class="num num--big">${c.measured.toFixed(1)}<small>%</small></span><span class="ci">95% interval ${ci(c)} · ${fmt(c.successes)} of ${fmt(c.sampled)} · design effect ${c.design_effect} · scorer error included</span></span></div>
      <div class="axis" style="--min:${min}; --max-v:100" aria-hidden="true">
        <div class="axis__track"></div>
        <div class="axis__bar" style="--lo:${c.ci[0]}; --hi:${c.ci[1]}"></div>
        <div class="axis__point" style="--x:${c.measured}"></div>
        <div class="axis__claim" style="--x:${d.claim}"><span>claim</span></div>
        <div class="axis__ticks">${ticks.map((t) => `<span style="--x:${t}">${t}</span>`).join("")}</div>
      </div>
      <div class="reading__meta"><span>seed ${esc(c.seed)}</span><span>κ ${c.kappa.toFixed(2)}</span><span>threshold ${d.threshold.toFixed(1)}%</span><span>${c.next_due === "—" ? "no re-check scheduled" : "re-check due " + esc(c.next_due)}</span></div>
    </figure>`;
  }
  function trendSVG(points, threshold, unit) {
    const W = 640, H = 220, pl = 46, pr = 18, pt = 20, pb = 36;
    const vals = points.map((p) => p.value).concat(threshold != null ? [threshold] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = Math.max(1.5, (hi - lo) * 0.4); lo = Math.floor(lo - pad); hi = Math.min(100, Math.ceil(hi + pad));
    const x = (i) => (points.length === 1 ? pl + (W - pl - pr) / 2 : pl + (i * (W - pl - pr)) / (points.length - 1));
    const y = (v) => pt + ((hi - v) / (hi - lo)) * (H - pt - pb);
    const ticks = [lo, (lo + hi) / 2, hi];
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Measured rate by ${unit}">`;
    ticks.forEach((t) => { s += `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" stroke="rgba(255,255,255,.1)" stroke-width="1"/><text x="${pl - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="#71807a" font-family="IBM Plex Mono, monospace">${Math.round(t * 10) / 10}</text>`; });
    if (threshold != null) s += `<line x1="${pl}" x2="${W - pr}" y1="${y(threshold)}" y2="${y(threshold)}" stroke="#e3b341" stroke-width="1"/><text x="${W - pr}" y="${y(threshold) - 6}" text-anchor="end" font-size="11" fill="#97a29c" font-family="Figtree, sans-serif">threshold ${threshold.toFixed(1)}</text>`;
    if (points.length > 1) s += `<path d="${points.map((p, i) => `${i ? "L" : "M"}${x(i)} ${y(p.value)}`).join(" ")}" fill="none" stroke="#8fd7b6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    points.forEach((p, i) => { s += `<circle cx="${x(i)}" cy="${y(p.value)}" r="4.5" fill="#8fd7b6" stroke="#151b18" stroke-width="2"/><text x="${x(i)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#71807a" font-family="Figtree, sans-serif">${esc(p.label)}</text>`; });
    const lp = points[points.length - 1]; s += `<text x="${x(points.length - 1)}" y="${y(lp.value) - 12}" text-anchor="${points.length > 1 ? "end" : "middle"}" font-size="12" fill="#d9dfdb" font-family="Figtree, sans-serif">${lp.value.toFixed(1)}%</text>`;
    const slot = points.length > 1 ? (W - pl - pr) / (points.length - 1) : W - pl - pr;
    points.forEach((p, i) => { s += `<rect data-i="${i}" x="${x(i) - slot / 2}" y="0" width="${slot}" height="${H}" fill="transparent"><title>${esc(unit)} ${esc(p.label)}: ${p.value.toFixed(1)}% · n ${fmt(p.n)}</title></rect>`; });
    return s + `</svg>`;
  }

  // ---------- views ----------
  function viewDeployments() {
    const list = DATA.deployments.filter((d) => (state.f === "all" || d.status === state.f) && (!state.q || [d.id, d.site, d.vendor, d.task].join(" ").toLowerCase().includes(state.q)));
    const count = (s) => DATA.deployments.filter((d) => s === "all" || d.status === s).length;
    return `${head("Deployments", `${DATA.deployments.length} listed · ${DATA.real_deployments} real`, `<a class="btn btn--primary btn--sm" href="demo.html" data-demo>Request an audit ${ARROW}</a>`)}
      ${notice()}
      <div class="toolbar"><input id="f-q" type="search" placeholder="Filter by ID, site, vendor" value="${esc(state.q)}" autocomplete="off"><div class="chips">${["all", "current", "insufficient", "revoked"].map((s) => `<button type="button" data-f="${s}" class="${state.f === s ? "is-on" : ""}">${s === "all" ? "All" : STATUS[s][0]} ${count(s)}</button>`).join("")}</div></div>
      <div class="tbl"><table><thead><tr><th>ID</th><th>Site</th><th>Vendor</th><th class="n">Measured</th><th>Status</th><th>Last check</th><th>Next due</th></tr></thead><tbody>${rows(list) || `<tr><td colspan="7" class="small">Nothing matches.</td></tr>`}</tbody></table></div>`;
  }

  function viewGrade(id, n) {
    const d = byId(id);
    if (!d) return `<div class="nf"><h1>No grade for “${esc(id)}”.</h1><p class="lede">If a vendor gave you this ID, it isn't verified. <a href="mailto:rahil@orbiteval.com?subject=Registry%20lookup%20${encodeURIComponent(id)}" style="color:var(--accent)">Tell us</a>, or <a href="#/registry" style="color:var(--accent)">search the registry</a>.</p></div>`;
    recent.push(d.id);
    const c = d.checks.find((x) => String(x.n) === String(n)) || last(d);
    const vClass = c.status === "current" ? "verdict--ok" : c.status === "insufficient" ? "verdict--wait" : "verdict--bad";
    const actions = `<button class="btn btn--ghost" type="button" data-act="link" data-id="${esc(d.id)}">Copy link</button><button class="btn btn--ghost" type="button" data-act="badge" data-id="${esc(d.id)}">Badge</button>${c.evidence ? `<button class="btn btn--ghost" type="button" data-act="csv" data-id="${esc(d.id)}" data-n="${c.n}">Evidence CSV</button>` : ""}<button class="btn btn--ghost" type="button" data-act="print">Print report</button>`;
    const checks = d.checks.map((x) => `<a href="#/d/${esc(d.id)}/${x.n}" class="${x === c ? "is-on" : ""}">Check ${x.n} · ${esc(x.window)} ${placard(x.status)}</a>`).join("");
    const series = c.weekly ? c.weekly.map((w) => ({ label: "wk " + w.label, value: w.rate, n: w.sampled })) : d.checks.length > 1 ? d.checks.map((x) => ({ label: "check " + x.n, value: x.measured, n: x.sampled })) : null;
    const unit = c.weekly ? "week" : "check";
    const failures = c.classes ? `<div class="table-wrap"><table class="bars"><thead><tr><th>Item class</th><th class="n">Sampled</th><th class="n">Success</th><th>Rate</th></tr></thead><tbody>${c.classes.map((k) => `<tr><td>${esc(k.name)}</td><td class="n mono">${fmt(k.sampled)}</td><td class="n val">${pct(k.rate)}</td><td><span class="bar ${k.rate < d.threshold ? "bar--low" : ""}" style="width:${k.rate}%"></span></td></tr>`).join("")}</tbody></table></div>${c.modes ? `<p class="small mt" style="margin-top:14px">By failure mode: ${c.modes.map((m) => `${esc(m.name)} ${m.picks}`).join(" · ")}.</p>` : ""}${c.lever ? `<p class="small" style="margin-top:8px">${esc(c.lever)}</p>` : ""}` : `<p>The breakdown by item class and failure mode is in the issued report.</p>`;
    const error = `<dl class="kvl"><dt>Double-scored</dt><dd>${fmt(c.double_scored)} of ${fmt(c.sampled)}, blind</dd><dt>Agreement</dt><dd class="mono">κ ${c.kappa.toFixed(2)}</dd><dt>Disagreements</dt><dd>${c.disagreements}</dd>${c.weakest_class ? `<dt>Weakest class</dt><dd>${esc(c.weakest_class)}, κ ${c.weakest_kappa.toFixed(2)}</dd>` : ""}</dl>${c.disagreement_rows ? `<div class="table-wrap" style="margin-top:12px"><table><tbody>${c.disagreement_rows.map((r) => `<tr><td class="mono">${esc(r.pair)}</td><td class="n mono">${r.count}</td><td class="small">${esc(r.effect)}</td></tr>`).join("")}</tbody></table></div>` : ""}<p class="small" style="margin-top:12px">Misclassification rates correct the estimate and widen the interval. <a href="calibration.html" style="color:var(--accent)">Our published error rate</a>.</p>`;
    const trend = series ? `<div class="trend">${trendSVG(series, d.threshold, unit)}</div><div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>${unit === "week" ? "Week" : "Check"}</th><th class="n">Sampled</th><th class="n">Measured</th></tr></thead><tbody>${series.map((p) => `<tr><td class="mono">${esc(p.label)}</td><td class="n mono">${fmt(p.n)}</td><td class="n mono">${pct(p.value)}</td></tr>`).join("")}</tbody></table></div>${c.trend_note ? `<p class="small" style="margin-top:10px">${esc(c.trend_note)}</p>` : `<p class="small" style="margin-top:10px">A trend is only called when the pre-registered test across re-checks rejects "no change".</p>`}` : `<p>One check so far. A trend appears after the first re-check, and is only called when the pre-registered test rejects "no change".</p>`;
    const sample = `<dl class="kvl"><dt>Site</dt><dd>${esc(c.site_rule || "Drawn at random by Orbit from the vendor's sites operated for at least eight weeks.")}</dd><dt>Window</dt><dd>${esc(c.window)}, the four most recent complete weeks at pre-registration</dd><dt>Seed</dt><dd class="mono">${esc(c.seed)}</dd><dt>Size</dt><dd>${fmt(c.sampled)} of ${fmt(c.population)} logged picks, stratified by item class, for ${esc(d.precision)}</dd><dt>Protocol</dt><dd class="mono">sha256 ${esc(c.protocol_hash)} · pre-registered ${esc(c.preregistered)}</dd><dt>Rubric</dt><dd class="mono">${esc(c.rubric)}</dd></dl>`;
    const history = `<div class="table-wrap"><table><thead><tr><th>Check</th><th>Window</th><th class="n">n</th><th class="n">Measured</th><th class="n">κ</th><th>Status</th></tr></thead><tbody>${d.checks.map((x) => `<tr><td class="mono"><a href="#/d/${esc(d.id)}/${x.n}" style="color:var(--accent)">${x.n}</a></td><td class="mono">${esc(x.window)}</td><td class="n mono">${fmt(x.sampled)}</td><td class="n mono">${pct(x.measured)} <span class="small">(${ci(x)})</span></td><td class="n mono">${x.kappa.toFixed(2)}</td><td>${placard(x.status)}</td></tr>`).join("")}</tbody></table></div><p class="small" style="margin-top:10px">Nothing is ever removed from this list.${d.revoked_reason ? " " + esc(d.revoked_reason) : ""}</p>`;
    const evidence = c.evidence ? `<section class="tile tile--wide"><h2>Evidence index <span>${c.evidence.length} of ${fmt(c.evidence_total)} rows shown</span></h2><div class="table-wrap"><table><thead><tr><th>Logged</th><th>Pick</th><th>Class</th><th>Outcome</th><th>Double-scored</th></tr></thead><tbody>${c.evidence.map((e) => `<tr><td class="mono">${esc(e.t)}</td><td class="mono">${esc(e.pick)}</td><td>${esc(e.class)}</td><td class="mono">${esc(e.outcome)}</td><td class="small">${esc(e.double || "—")}</td></tr>`).join("")}</tbody></table></div><p class="small" style="margin-top:10px">Every scored pick by the vendor's own log identifier. Video stays with the operator; the index lets either party pull any pick from their own records. The full index is attached to the issued report.</p></section>` : "";
    return `<nav class="crumb"><a href="#/deployments">Deployments</a><i>/</i><b>${esc(d.site)}</b><i>/</i>${esc(c.window)}</nav>
      <header class="v__head"><div><div class="v__title"><h1>${esc(d.site)}</h1>${spec(d)}${placard(d.status)}</div><p class="v__sub"><span class="mono">${esc(d.id)}</span> · ${esc(d.vendor)} · ${esc(d.task)}</p></div><div class="v__actions">${actions}</div></header>
      ${d.specimen ? `<div class="notice">Illustrative data. Every figure on this page was chosen to show the format, not measured from a deployment.</div>` : ""}
      <div class="checks">${checks}</div>
      <div class="grid">
        <section class="tile">${reading(d, c, true)}</section>
        <section class="tile"><h2>Verdict <span>check ${c.n} · issued ${esc(c.issued)}</span></h2><div class="verdict ${vClass}">${esc(c.verdict)}</div><dl class="kvl"><dt>Claim</dt><dd>${d.claim.toFixed(1)}% on in-scope SKUs</dd><dt>Threshold</dt><dd>${d.threshold.toFixed(1)}%, pre-registered</dd><dt>Precision</dt><dd>${esc(d.precision)}</dd>${c.needed ? `<dt>Needed</dt><dd>${fmt(c.needed)} in-scope picks in the window</dd>` : ""}<dt>Scope</dt><dd>${esc(d.scope)}</dd><dt>Policy</dt><dd>${esc(d.policy_version)}</dd></dl></section>
        <section class="tile"><h2>Where the failures are <span>${c.classes ? "descriptive, not a test" : ""}</span></h2>${failures}</section>
        <section class="tile"><h2>Our error on this report</h2>${error}</section>
        <section class="tile tile--wide"><h2>Trend <span>measured rate by ${unit}</span></h2>${trend}</section>
        <section class="tile"><h2>How the sample was chosen</h2>${sample}</section>
        <section class="tile"><h2>History <span>${d.checks.length} check${d.checks.length > 1 ? "s" : ""}</span></h2>${history}</section>
        ${evidence}
      </div>`;
  }

  function viewReports() {
    const list = DATA.deployments.flatMap((d) => d.checks.map((c) => ({ d, c }))).sort((a, b) => b.c.issued.localeCompare(a.c.issued));
    return `${head("Reports", "One report per check. Open it, print it, or download the evidence rows.")}${notice()}
      <div class="tbl"><table><thead><tr><th>ID</th><th>Check</th><th>Window</th><th>Issued</th><th class="n">Measured</th><th>Status</th><th></th></tr></thead><tbody>${list.map(({ d, c }) => `<tr data-href="#/d/${esc(d.id)}/${c.n}"><td class="mono"><a href="#/d/${esc(d.id)}/${c.n}">${esc(d.id)}</a></td><td class="mono">${c.n}</td><td class="mono">${esc(c.window)}</td><td class="mono">${esc(c.issued)}</td><td class="n mono">${pct(c.measured)} <span class="small">(${ci(c)})</span></td><td>${spec(d)} ${placard(c.status)}</td><td><a href="#/d/${esc(d.id)}/${c.n}">Open ${ARROW}</a></td></tr>`).join("")}</tbody></table></div>`;
  }

  function registryResults(q) {
    const v = q.trim().toLowerCase();
    const list = DATA.deployments.filter((d) => !v || [d.id, d.site, d.vendor].join(" ").toLowerCase().includes(v));
    if (!list.length) return `<div class="empty"><p class="lbl" style="margin-bottom:8px">No grade matches “${esc(q)}”</p><p>If a vendor gave you this ID, it isn't verified. <a href="mailto:rahil@orbiteval.com?subject=Registry%20lookup%20${encodeURIComponent(q)}">Tell us</a>.</p></div>`;
    return list.map((d) => { const c = last(d); return `<div class="result"><div><h3><span class="mono">${esc(d.id)}</span>${spec(d)}${placard(d.status)}</h3><p>${esc(d.site)} · ${esc(d.vendor)} · ${d.status === "insufficient" ? "no verdict" : "measured " + pct(c.measured) + " (" + ci(c) + ")"} · last check ${esc(c.issued)}</p></div><div class="v__actions"><a class="btn btn--ghost" href="#/d/${esc(d.id)}">Open</a><button class="btn btn--ghost" type="button" data-act="link" data-id="${esc(d.id)}">Copy link</button><button class="btn btn--ghost" type="button" data-act="badge" data-id="${esc(d.id)}">Badge</button></div></div>`; }).join("");
  }
  function viewRegistry(q) {
    return `${head("Registry", "Every audited deployment. If it isn't here, it isn't verified.")}${notice()}
      <div class="field" style="max-width:40em"><label for="r-q">Verify a grade</label><input id="r-q" type="search" placeholder="Verification ID, vendor, or site" value="${esc(q)}" autocomplete="off"></div>
      <div id="r-results">${registryResults(q)}</div>`;
  }

  function viewCalibration() {
    const rows = DATA.deployments.flatMap((d) => d.checks.map((c) => `<tr><td class="mono">${esc(d.id)}</td><td class="mono">${c.n}</td><td class="n mono">${fmt(c.double_scored)}</td><td class="n mono">${c.kappa.toFixed(2)}</td><td class="n mono">${c.disagreements}</td><td>${spec(d)}</td></tr>`)).join("");
    return `${head("Calibration", "How often our scorer is wrong, by version, outcome and item class.")}
      <div class="notice">First calibration study in progress. No agreement figure is published until it completes, and no report is issued before then.</div>
      <div class="grid">
        <section class="tile tile--wide"><h2>Studies <span>model against human, on the same picks</span></h2><div class="table-wrap"><table><thead><tr><th>Scorer version</th><th>Period</th><th class="n">Double-scored picks</th><th class="n">κ</th><th class="n">95% interval</th><th>Weakest outcome</th></tr></thead><tbody>${DATA.calibration.studies.length ? "" : `<tr><td class="mono">—</td><td class="mono">—</td><td class="n mono">—</td><td class="n mono">—</td><td class="n mono">—</td><td class="mono">—</td></tr>`}</tbody></table></div><p class="small" style="margin-top:10px">Empty by design until the first study completes. What will appear, and how error enters a report, is on the <a href="calibration.html" style="color:var(--accent)">calibration page</a>.</p></section>
        <section class="tile tile--wide"><h2>Agreement on listed checks <span>illustrative</span></h2><div class="table-wrap"><table><thead><tr><th>ID</th><th>Check</th><th class="n">Double-scored</th><th class="n">κ</th><th class="n">Disagreements</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>
      </div>`;
  }

  function viewProtocols() {
    const rows = DATA.deployments.flatMap((d) => d.checks.map((c) => `<tr data-href="#/d/${esc(d.id)}/${c.n}"><td class="mono"><a href="#/d/${esc(d.id)}/${c.n}">${esc(d.id)}</a></td><td class="mono">${c.n}</td><td class="mono">${esc(c.preregistered)}</td><td class="mono">${esc(c.protocol_hash)}</td><td class="mono">${esc(c.rubric)}</td><td class="n mono">${d.threshold.toFixed(1)}%</td><td class="mono">${esc(d.precision)}</td><td class="mono">${esc(c.seed)}</td><td class="n mono">${fmt(c.sampled)}</td></tr>`)).join("");
    return `${head("Protocols", "What was fixed before any data was seen, for every check.")}${notice()}
      <div class="tbl"><table><thead><tr><th>ID</th><th>Check</th><th>Pre-registered</th><th>Protocol hash</th><th>Rubric</th><th class="n">Threshold</th><th>Precision</th><th>Seed</th><th class="n">n</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="notice notice--plain" style="margin-top:16px">To regenerate a sample, take the vendor's pick log for the window and the seed above, and run the sampler in the <a href="https://github.com/Rahillasne/orbit-eval" style="color:var(--accent);margin-left:4px">open code</a>.</div>`;
  }

  // ---------- behaviour ----------
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 1600); }
  async function copy(text, msg) { try { await navigator.clipboard.writeText(text); toast(msg); } catch { prompt("Copy this:", text); } }
  function badgeDialog(id) {
    const d = byId(id); if (!d) return;
    const img = location.origin + location.pathname.replace(/[^/]*$/, "") + "badge/" + d.id + ".svg";
    const snippet = `<a href="${pageURL(d.id)}"><img src="${img}" alt="Orbit verification ${d.id}: ${STATUS[d.status][0]}" height="28"></a>`;
    const dlg = $("#badge-dlg");
    dlg.innerHTML = `<h2>Badge for ${esc(d.id)}</h2><p>Paste this on your site. It links to the grade page, and what it says changes when the grade does.</p><img src="badge/${esc(d.id)}.svg" alt="" height="28"><pre id="badge-code">${esc(snippet)}</pre><div class="row"><button class="btn btn--primary btn--sm" type="button" id="badge-copy">Copy snippet</button><button class="btn btn--ghost btn--sm" type="button" id="badge-close">Close</button></div>`;
    dlg.showModal();
    $("#badge-copy").onclick = () => copy(snippet, "Snippet copied");
    $("#badge-close").onclick = () => dlg.close();
  }
  function csv(id, n) {
    const d = byId(id); const c = d && d.checks.find((x) => String(x.n) === String(n)); if (!c || !c.evidence) return;
    const lines = [["logged", "pick", "class", "outcome", "double_scored"].join(","), ...c.evidence.map((e) => [e.t, e.pick, e.class, e.outcome, e.double].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${d.id}-check${c.n}-evidence.csv` });
    document.body.appendChild(a); a.click(); a.remove(); toast("Evidence rows downloaded");
  }
  function bind() {
    $$("tr[data-href]").forEach((tr) => tr.addEventListener("click", (e) => { if (e.target.closest("a,button")) return; location.hash = tr.dataset.href; }));
    const fq = $("#f-q"); if (fq) fq.addEventListener("input", () => { state.q = fq.value.trim().toLowerCase(); const tb = $(".tbl tbody"); const list = DATA.deployments.filter((d) => (state.f === "all" || d.status === state.f) && (!state.q || [d.id, d.site, d.vendor, d.task].join(" ").toLowerCase().includes(state.q))); tb.innerHTML = rows(list) || `<tr><td colspan="7" class="small">Nothing matches.</td></tr>`; bindRows(); });
    $$(".chips button").forEach((b) => b.addEventListener("click", () => { state.f = b.dataset.f; route(); }));
    $$("[data-act]").forEach((b) => b.addEventListener("click", () => {
      const act = b.dataset.act;
      if (act === "link") copy(pageURL(b.dataset.id), "Verification link copied");
      else if (act === "badge") badgeDialog(b.dataset.id);
      else if (act === "csv") csv(b.dataset.id, b.dataset.n);
      else if (act === "print") window.print();
    }));
    const rq = $("#r-q"); if (rq) rq.addEventListener("input", () => { $("#r-results").innerHTML = registryResults(rq.value); bindActs(); });
    const tip = $("#tip");
    $$(".trend [data-i]").forEach((r) => {
      r.addEventListener("mousemove", (e) => { tip.textContent = r.querySelector("title").textContent; tip.hidden = false; tip.style.left = e.clientX + 12 + "px"; tip.style.top = e.clientY - 34 + "px"; });
      r.addEventListener("mouseleave", () => (tip.hidden = true));
    });
    function bindRows() { $$("tr[data-href]").forEach((tr) => tr.addEventListener("click", (e) => { if (e.target.closest("a,button")) return; location.hash = tr.dataset.href; })); }
    function bindActs() { $$("[data-act]").forEach((b) => b.addEventListener("click", () => { const act = b.dataset.act; if (act === "link") copy(pageURL(b.dataset.id), "Verification link copied"); else if (act === "badge") badgeDialog(b.dataset.id); })); }
  }

  // ---------- command palette ----------
  const pal = $("#pal"), palQ = $("#pal-q"), palList = $("#pal-list");
  const VIEWS = [["Deployments", "#/deployments"], ["Reports", "#/reports"], ["Registry", "#/registry"], ["Calibration", "#/calibration"], ["Protocols", "#/protocols"]];
  function palRender() {
    const v = palQ.value.trim().toLowerCase();
    const items = [...DATA.deployments.filter((d) => !v || [d.id, d.site, d.vendor].join(" ").toLowerCase().includes(v)).map((d) => [`${d.site} · ${d.vendor}`, `#/d/${d.id}`, d.id]), ...VIEWS.filter(([n]) => !v || n.toLowerCase().includes(v)).map(([n, h]) => [n, h, "view"])];
    palList.innerHTML = items.map(([n, h, s], i) => `<a href="${h}" class="${i === 0 ? "is-on" : ""}">${esc(n)}<span>${esc(s)}</span></a>`).join("") || `<a><span>Nothing matches</span></a>`;
    $$("a", palList).forEach((a) => a.addEventListener("click", palClose));
  }
  function palOpen() { if (!DATA) return; pal.hidden = false; palQ.value = ""; palRender(); palQ.focus(); }
  function palClose() { pal.hidden = true; }
  $("#ws-search").addEventListener("click", palOpen);
  palQ.addEventListener("input", palRender);
  palQ.addEventListener("keydown", (e) => { if (e.key === "Enter") { const a = $("a.is-on", palList); if (a && a.getAttribute("href")) { location.hash = a.getAttribute("href"); palClose(); } } });
  pal.addEventListener("click", (e) => { if (e.target === pal) palClose(); });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); pal.hidden ? palOpen() : palClose(); }
    if (e.key === "Escape") { palClose(); const dlg = $("#badge-dlg"); if (dlg.open) dlg.close(); }
  });

  // ---------- boot ----------
  addEventListener("hashchange", route);
  fetch("app-data.json", { cache: "no-store" }).then((r) => r.json()).then((d) => { DATA = d; route(); }).catch((e) => { main.innerHTML = `<div class="notice">The data file could not be loaded (${esc(e.message)}). Open this page over http, or from orbiteval.com.</div>`; });
})();
