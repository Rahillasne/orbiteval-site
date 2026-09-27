// EU Readiness Check page. The rules and the wording live in eu-check-logic.js;
// this file reads the inputs and paints. Nothing is stored: no account, no
// storage, no analytics. A reload clears the page.
(() => {
  const E = window.EUCheck, $ = (s) => document.querySelector(s);
  const API = (window.EUCHECK_API || "").replace(/\/$/, "");
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  const PDFJS_SRI = "sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e";
  const params = new URLSearchParams(location.search);
  const embed = params.get("embed") === "1";
  if (embed) document.documentElement.classList.add("ec-embed");

  const today = () => new Date().toLocaleDateString("en-CA");   // YYYY-MM-DD, local
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fresh = () => ({ usesML: null, safetyJob: null, sellWhen: null, method: false, rows: [], filled: {}, example: false });
  let state = fresh(), nextId = 1, picked = null, limited = false;
  const withId = (r) => Object.assign({ id: nextId++, text: "", kind: "rate", claimedPct: "", attempts: "", successes: "", ai: null, edited: false }, r);

  // Embed mode is a read-only preview: nothing inside the page can be typed
  // into or clicked. Run after every re-render, since the claims table is
  // rebuilt from scratch each time a row is added, deleted or AI-filled.
  function lockIfEmbed() {
    if (!embed) return;
    document.querySelectorAll("main input, main select, main textarea, main button").forEach((el) => { el.disabled = true; });
  }

  // ---- Result panel --------------------------------------------------------
  const PLACARD = { backed: "current", short: "caution", invalid: "revoked", nocount: "unknown", other: "unknown" };
  const ICON = { ok: "✓", warn: "!", bad: "✗", na: "–" };

  function paintResult() {
    const s1 = E.step1(state, today()), res = state.rows.map(E.claimRow), cl = E.checklist(state, res);
    const days = s1.days > 0
      ? `<span class="num num--big">${s1.days}</span><span>days to 20 January 2027</span>`
      : `<span>The Machinery Regulation has applied since 20 January 2027.</span>`;
    $("#result").innerHTML = `
      <h2 class="ec-h">Your result</h2>
      <p class="ec-days">${days}</p>
      <dl class="ec-sum">
        <div><dt>Route</dt><dd><span class="placard placard--${s1.tone === "wait" ? "caution" : "unknown"}">${esc(s1.label)}</span></dd></div>
        <div><dt>Test proof</dt><dd>${cl.backed} of ${cl.total} ${cl.total === 1 ? "claim" : "claims"} backed</dd></div>
        <div><dt>Open items</dt><dd>${cl.missing} in this check</dd></div>
      </dl>
      <ul class="ec-list">${cl.items.map((i) => `<li class="ec-li ec-li--${i.state}"><span aria-hidden="true">${ICON[i.state]}</span>${esc(i.text)}</li>`).join("")}</ul>
      <div class="ec-why">${s1.sentences.map((p) => `<p>${esc(p)}</p>`).join("")}${s1.directive ? `<p>${esc(s1.directive)}</p>` : ""}<p class="small">${esc(s1.file)}</p></div>`;
    state.rows.forEach((r, i) => paintRow(r, res[i]));
    for (const k of ["usesML", "safetyJob"]) {
      const el = document.querySelector(`[data-hint="${k}"]`);
      if (el) el.innerHTML = state.filled[k] ? `AI · check this: <q>${esc(state.filled[k])}</q>` : "";
    }
    $("#book").href = "mailto:rahil@orbiteval.com?subject=" + encodeURIComponent("EU check: the full check")
      + "&body=" + encodeURIComponent(E.mailBody(state, today()));
  }

  // ---- Claims table --------------------------------------------------------
  function rowHTML(r) {
    const ai = r.ai ? `<details class="ec-ai"><summary>AI · check this</summary><q>${esc(r.ai.quote)}</q>${
      r.ai.page ? ` <span class="mono small">${r.ai.file ? esc(r.ai.file) : "page " + esc(String(r.ai.page))}</span>` : ""}</details>` : "";
    return `<tr data-id="${r.id}">
      <td data-label="Claim"><select data-f="kind" aria-label="Kind of claim"><option value="rate">Success rate</option><option value="other">Other claim</option></select>
        <input data-f="text" aria-label="Claim" placeholder="e.g. 94% pick success">${ai}</td>
      <td class="n" data-label="Claimed %"><input data-f="claimedPct" inputmode="decimal" aria-label="Claimed %"></td>
      <td class="n" data-label="Attempts"><input data-f="attempts" inputmode="numeric" aria-label="Attempts"></td>
      <td class="n" data-label="Succeeded"><input data-f="successes" inputmode="numeric" aria-label="Succeeded"></td>
      <td class="ec-res" data-res data-label="Result"></td>
      <td data-label=""><button type="button" class="ec-del" data-del aria-label="Delete this claim">×</button></td></tr>`;
  }

  function renderRows() {
    const body = $("#rows tbody");
    body.innerHTML = state.rows.map(rowHTML).join("");
    state.rows.forEach((r) => {
      const tr = body.querySelector(`tr[data-id="${r.id}"]`);
      for (const f of ["kind", "text", "claimedPct", "attempts", "successes"]) tr.querySelector(`[data-f="${f}"]`).value = r[f];
    });
    $("#more").hidden = state.rows.filter((r) => r.ai).length < 25;
    lockIfEmbed();
  }

  function paintRow(r, res) {
    const cell = document.querySelector(`tr[data-id="${r.id}"] [data-res]`);
    if (cell) cell.innerHTML = `<span class="placard placard--${PLACARD[res.status]}">${esc(res.label)}</span><span class="small">${esc(res.text)}</span>`;
  }

  $("#rows tbody").addEventListener("input", (e) => {
    const tr = e.target.closest("tr"), f = e.target.dataset.f;
    const r = tr && state.rows.find((x) => x.id === Number(tr.dataset.id));
    if (!r || !f) return;
    r[f] = e.target.value;
    if (r.ai) r.edited = true;   // the person's edit now owns this row; a later AI read must not erase it
    state.example = false;       // an edited example is the person's own check now
    paintResult();
  });
  $("#rows tbody").addEventListener("click", (e) => {
    if (!e.target.closest("[data-del]")) return;
    const id = Number(e.target.closest("tr").dataset.id);
    state.rows = state.rows.filter((r) => r.id !== id);
    state.example = false;
    renderRows(); paintResult();
  });
  $("#add").addEventListener("click", () => {
    state.rows.push(withId({}));
    state.example = false;
    renderRows(); paintResult();
    $("#rows tbody tr:last-child [data-f=text]").focus();
  });

  // ---- Questions -------------------------------------------------------------
  document.querySelectorAll('input[name="usesML"], input[name="safetyJob"]').forEach((el) =>
    el.addEventListener("change", () => { state[el.name] = el.value; delete state.filled[el.name]; state.example = false; paintResult(); }));
  $("#sell").addEventListener("change", (e) => { state.sellWhen = e.target.value || null; state.example = false; paintResult(); });
  $("#method").addEventListener("change", (e) => { state.method = e.target.checked; state.example = false; paintResult(); });

  function syncQuestions() {
    for (const k of ["usesML", "safetyJob"]) {
      document.querySelectorAll(`input[name="${k}"]`).forEach((el) => { el.checked = el.value === state[k]; });
    }
    $("#sell").value = state.sellWhen || "";
    $("#method").checked = state.method;
  }

  // ---- The AI reader ---------------------------------------------------------
  const status = (msg) => { $("#readstatus").textContent = msg; };
  const statusHTML = (html) => { $("#readstatus").innerHTML = html; };
  const loadPdfJs = () => new Promise((ok, no) => {
    if (window.pdfjsLib) return ok();
    const s = document.createElement("script");
    s.src = PDFJS + "pdf.min.js"; s.integrity = PDFJS_SRI; s.crossOrigin = "anonymous";
    s.onload = ok; s.onerror = no; document.head.appendChild(s);
  });

  async function pdfPages(file) {
    await loadPdfJs();
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
    const doc = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      pages.push(c.items.map((it) => it.str).join(" "));
    }
    return pages;
  }

  async function inputPages() {
    if (picked) return /\.pdf$/i.test(picked.name) || picked.type === "application/pdf" ? pdfPages(picked) : [await picked.text()];
    const t = $("#paste").value;
    return t.trim() ? [t] : [];
  }

  function applyAI(j, how) {
    // Keep any AI row the person has since edited -- it is theirs now. Only
    // untouched AI rows are replaced by this read's fresh suggestions.
    state.rows = state.rows.filter((r) => !r.ai || r.edited).concat(E.rowsFromAI(j.claims).map(withId));
    state.example = false;
    const m = E.mergeHints(state, j.hints);
    state.usesML = m.usesML; state.safetyJob = m.safetyJob; state.filled = Object.assign({}, state.filled, m.filled);
    renderRows(); syncQuestions(); paintResult();
    const n = j.claims.length;
    status(how + ` ${n} ${n === 1 ? "claim" : "claims"}.`
      + (j.dropped ? ` ${j.dropped} ${j.dropped === 1 ? "suggestion was" : "suggestions were"} dropped because their quote is not in your document.` : "")
      + " Check each one marked AI.");
  }

  async function readWithAI() {
    if (limited) return;
    if (!API) return status("The AI reader is not switched on yet. Fill in the check by hand.");
    let pages;
    try { pages = await inputPages(); } catch (e) { return status("That file could not be opened. Paste the text instead."); }
    if (!pages.length) return status("Choose a file or paste some text first.");
    if (!E.hasText(pages)) return status("This file has no readable text. It may be a scan. Paste the text instead.");
    if (E.tooLong(pages)) return status("That is longer than the check reads (30,000 characters). Paste the part with your claims.");
    const btn = $("#read"), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 65000);
    btn.disabled = true; status("Reading…");
    try {
      const r = await fetch(API + "/api/extract", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pages.length > 1 ? { pages } : { text: pages[0] }), signal: ctl.signal });
      const j = await r.json().catch(() => ({}));
      if (j && j.limited === true) {
        // The server's daily cap is reached. The button stays off for the
        // rest of this session; the manual path keeps working (SPEC §5).
        limited = true;
        return status(j.error || "The daily limit has been reached. Fill in the check by hand.");
      }
      if (!r.ok || !Array.isArray(j.claims)) return status(j.error || "The AI reader is not available right now. Fill in the check by hand.");
      applyAI(j, "Found");
    } catch (e) {
      status("The AI reader is not available right now. Fill in the check by hand.");
    } finally { clearTimeout(timer); btn.disabled = limited; }
  }

  function setPicked(f) {
    picked = f;
    $("#filerow").hidden = !f;
    $("#filename").textContent = f ? f.name : "";
  }

  $("#read").addEventListener("click", readWithAI);
  $("#pick").addEventListener("click", () => $("#file").click());
  $("#file").addEventListener("change", (e) => {
    const f = e.target.files[0] || null;
    setPicked(f);
    if (f) status("Chosen: " + f.name);
  });
  $("#removefile").addEventListener("click", () => {
    setPicked(null); $("#file").value = ""; status("");
  });
  // Typing or pasting takes over from a chosen file -- otherwise the file
  // silently wins forever, and the pasted text is never sent.
  $("#paste").addEventListener("input", () => {
    if (!picked) return;
    setPicked(null); $("#file").value = "";
    status("Using the pasted text.");
  });
  const drop = $("#drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("is-over");
    const f = e.dataTransfer.files[0] || null;
    setPicked(f);
    if (f) status("Chosen: " + f.name);
  });

  // ---- The real example ------------------------------------------------------
  async function loadExample() {
    try {
      const j = await (await fetch("eu-check-example.json")).json();
      state = fresh();
      applyAI(j, "Loaded a real example:");
      state.example = true;   // the checklist does not assess a testing method for the example
      if (j.hints.safety_job === null) state.safetyJob = "unsure";
      syncQuestions(); paintResult();
      // The source, linked, with its commit and each file's sha256 prefix (SPEC §4.6 / R24).
      // Built with esc() throughout: nothing here is a raw document string.
      const files = (j.source.files || []).map((f) =>
        `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a> (${esc(String(f.sha256).slice(0, 12))})`).join(", ");
      const commit = esc(String(j.source.commit || "").slice(0, 7));
      statusHTML(`Loaded a real example: ${esc(j.source.title)}, read by AI on ${esc(j.read.date)} and checked by code. `
        + `${j.claims.length} claims.` + (j.note ? " " + esc(j.note) : "")
        + (files ? ` Source: commit <span class="mono">${commit}</span> — ${files}.` : ""));
    } catch (e) { status("The example could not be loaded."); }
  }
  $("#example").addEventListener("click", loadExample);

  // ---- Report ------------------------------------------------------------------
  $("#download").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([E.report(state, today())], { type: "text/markdown" }));
    a.download = "orbiteval-eu-check.md";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  renderRows(); paintResult();
  if (embed && params.get("example") === "1") loadExample();
})();
