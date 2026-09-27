// EU Readiness Check page, in three steps: Document, Claims, Result. The rules
// and the wording live in eu-check-logic.js; this file reads the inputs and
// paints. Nothing is stored: no account, no storage, no analytics. A reload
// clears the page.
(() => {
  const E = window.EUCheck, $ = (s) => document.querySelector(s);
  // ?embed=1 is the home page's preview window: a read-only view with the reader
  // off, so the preview can never send anything to it. ?example=1 fills it with the example.
  const params = new URLSearchParams(location.search);
  const embed = params.get("embed") === "1";
  if (embed) document.documentElement.classList.add("ec-embed");
  const API = embed ? "" : (window.EUCHECK_API || "").replace(/\/$/, "");
  // pdf.js 3.11.174, served from this site so no third party sees a visitor's document.
  const PDFJS = "vendor/pdfjs-3.11.174/";
  const PDFJS_SRI = "sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e";
  // No reader address: hide its controls rather than offer a button that cannot work.
  if (!API) document.documentElement.classList.add("ec-noreader");
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  const today = () => E.localISO(new Date());   // YYYY-MM-DD, local, whatever the locale
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // filled: an answer's AI quote; notes: a plain line under a question; fromExample:
  // the answers the example set, until the person changes them.
  const fresh = () => ({ usesML: null, safetyJob: null, sellWhen: null, method: false, rows: [], filled: {}, notes: {}, fromExample: {}, example: false });
  let state = fresh(), nextId = 1, picked = null, limited = false;
  const withId = (r) => Object.assign({ id: nextId++, text: "", kind: "rate", claimedPct: "", attempts: "", successes: "", ai: null, edited: false }, r);
  // Step 1's one-line summary: where the claims came from (a file name,
  // "Pasted text" or "Example"; "By hand" when nothing was read), and the
  // reader's note on that read, shown above the cards. readNote is HTML built
  // with esc().
  let source = "", readNote = "", busy = false, limitMsg = "";
  const nClaims = (n) => n + (n === 1 ? " claim" : " claims");

  const PLACARD = { backed: "current", short: "caution", invalid: "revoked", nocount: "unknown", other: "unknown" };
  const ICON = { ok: "✓", warn: "!", bad: "✗", na: "–" };

  // The preview is read-only: nothing in it can be typed into or pressed. Run
  // after every re-render, since the cards, the step bar and the summaries are
  // rebuilt, and switched back on, each time the page repaints.
  function lockIfEmbed() {
    if (!embed) return;
    document.querySelectorAll("main input, main select, main textarea, main button").forEach((el) => { el.disabled = true; });
  }

  // ---- The three steps --------------------------------------------------------
  // Step 1 is always open to the visitor; Claims and Result once there is a claim.
  const reachable = (k) => k === 1 || state.rows.length > 0;

  function paintSteps(res) {
    const n = state.step || 1;
    document.querySelectorAll("#steps li").forEach((li) => {
      const k = Number(li.dataset.go), b = li.querySelector("button");
      li.classList.toggle("is-on", k === n);
      li.classList.toggle("is-done", k < n);
      b.disabled = !reachable(k);
      if (k === n) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
    });
    for (const k of [1, 2, 3]) {
      const sec = $("#s" + k), sum = sec.querySelector(".ec-step__sum");
      sec.hidden = k > n;                       // a step not reached yet lives only in the progress bar
      sec.classList.toggle("is-open", k === n);
      sec.querySelector(".ec-step__body").hidden = k !== n;
      if (sum) sum.hidden = !(k < n);
    }
    const backed = res.filter((r) => r.status === "backed").length;
    summary(1, `${esc(source || "By hand")} · ${nClaims(state.rows.length)}`, n === 2 ? readNote : "");
    summary(2, `${nClaims(state.rows.length)} · ${backed} backed`, "");
    $("#toresult").disabled = !state.rows.length;
  }

  function summary(k, html, note) {
    $(`#s${k} .ec-step__sum`).innerHTML = `<span class="ec-sum__txt"><span class="ec-tick" aria-hidden="true">✓</span> ${html}`
      + (note ? `<span class="small ec-sum__note">${note}</span>` : "") + `</span>`
      + `<button type="button" class="ec-linklike ec-edit" data-edit="${k}">Edit<span class="ec-sr"> step ${k}</span></button>`;
  }

  // Open step n, fold the others, and bring the progress bar and the step into view.
  function go(n, opts = {}) {
    if (!reachable(n)) return;
    state.step = n;
    paintAll();
    if (embed) return;   // the preview never takes focus, and never scrolls the home page around it
    const target = opts.focus || $(`#s${n} .ec-step__body > h2`);
    if (target) target.focus({ preventScroll: true });
    $("#steps").scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
  }

  $("#steps").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-go]"), b = li && li.querySelector("button");
    if (b && !b.disabled) go(Number(li.dataset.go));
  });
  document.querySelector("main").addEventListener("click", (e) => {
    const b = e.target.closest("[data-edit]");
    if (b) go(Number(b.dataset.edit));
  });

  // ---- Claim cards ----------------------------------------------------------------
  // Numbers in an escaped quote, marked. An escaped character (&#39;, &amp;) is
  // matched first and left whole, so its digits are never marked.
  const markNumbers = (html) => html.replace(/&#?\w+;|\d[\d,.]*%?/g, (m) => {
    if (m[0] === "&") return m;
    const tail = /[.,]*$/.exec(m)[0];
    return `<mark>${m.slice(0, m.length - tail.length)}</mark>${tail}`;
  });

  function cardHTML(r) {
    return `<article class="ec-card" data-id="${r.id}">
  <div class="ec-card__top"><span data-res class="ec-card__res"></span><button type="button" class="ec-del" data-del aria-label="Delete this claim">×</button></div>
  ${r.ai ? `<p class="ec-card__quote">${markNumbers(esc(r.ai.quote))}</p><details class="ec-ai"><summary>AI · check this</summary><q>${esc(r.ai.quote)}</q>${r.ai.page ? ` <span class="mono small">page ${esc(String(r.ai.page))}</span>` : ""}</details>`
    : `<input class="ec-card__text" data-f="text" aria-label="Claim" placeholder="e.g. 94% pick success">`}
  <div class="ec-card__kind"><label><input type="radio" name="kind-${r.id}" data-f="kind" value="rate"> Success rate</label><label><input type="radio" name="kind-${r.id}" data-f="kind" value="other"> Other claim</label></div>
  <div class="ec-card__nums" data-rate>
    <label>Claimed %<input data-f="claimedPct" inputmode="decimal"></label>
    <label>Attempts<input data-f="attempts" inputmode="numeric"></label>
    <label>Succeeded<input data-f="successes" inputmode="numeric"></label>
  </div>
</article>`;
  }

  const cardOf = (r) => $(`#cards .ec-card[data-id="${r.id}"]`);

  function renderCards() {
    $("#cards").innerHTML = state.rows.map(cardHTML).join("");
    state.rows.forEach((r) => {
      const c = cardOf(r);
      for (const f of ["text", "claimedPct", "attempts", "successes"]) {
        const el = c.querySelector(`[data-f="${f}"]`);
        if (el) el.value = r[f];
      }
      c.querySelectorAll('[data-f="kind"]').forEach((el) => { el.checked = el.value === r.kind; });
      c.querySelector("[data-rate]").hidden = r.kind === "other";
    });
    $("#more").hidden = state.rows.filter((r) => r.ai).length < 25;
    lockIfEmbed();
  }

  function paintCard(r, res) {
    const c = cardOf(r), el = c && c.querySelector("[data-res]");
    if (el) el.innerHTML = `<span class="placard placard--${PLACARD[res.status]}">${esc(res.label)}</span><span class="small">${esc(res.text)}</span>`;
  }

  function onCardInput(e) {
    const card = e.target.closest(".ec-card"), f = e.target.dataset.f;
    const r = card && state.rows.find((x) => x.id === Number(card.dataset.id));
    if (!r || !f) return;
    if (f === "kind") {
      if (!e.target.checked) return;
      r.kind = e.target.value;
      card.querySelector("[data-rate]").hidden = r.kind === "other";
    } else r[f] = e.target.value;
    if (r.ai) r.edited = true;   // the person's edit now owns this row; a later AI read must not erase it
    state.example = false;       // an edited example is the person's own check now
    paintAll();
  }
  $("#cards").addEventListener("input", onCardInput);
  $("#cards").addEventListener("change", (e) => { if (e.target.type === "radio") onCardInput(e); });

  $("#cards").addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (!del) return;
    const id = Number(del.closest(".ec-card").dataset.id), at = state.rows.findIndex((r) => r.id === id);
    state.rows = state.rows.filter((r) => r.id !== id);
    state.example = false;
    forgetExample();
    renderCards();
    if (!state.rows.length) {
      // Nothing left to check: back to step 1, where every way in is offered again,
      // with no word left over from the last read.
      source = ""; readNote = ""; status("");
      return go(1);
    }
    paintAll();
    const next = $(`#cards .ec-card:nth-child(${Math.min(at, state.rows.length - 1) + 1}) [data-del]`);
    (next || $("#add")).focus();
  });

  function addCard() {
    state.rows.push(withId({}));
    state.example = false;
    renderCards();
    return $("#cards .ec-card:last-child [data-f=text]");
  }
  $("#add").addEventListener("click", () => { const input = addCard(); paintAll(); input.focus(); });
  $("#manual").addEventListener("click", () => { const input = addCard(); go(2, { focus: input }); });
  $("#toresult").addEventListener("click", () => go(3));

  // ---- The result ---------------------------------------------------------------
  // The home demo's ring: one arc per claim, coloured as its verdict, backed first.
  const ORDER = ["backed", "short", "invalid", "nocount", "other"];
  let ringKey = null;

  function paintRing(res) {
    const svg = $("#result .demo-ring");
    const arcs = res.map((r) => r.status).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    if (arcs.join() === ringKey) return;   // redraw only when a verdict changes, so the arcs play in once
    ringKey = arcs.join();
    const C = 2 * Math.PI * 50, slot = C / Math.max(arcs.length, 1), gap = arcs.length > 1 ? Math.min(5, slot / 3) : 0;
    svg.innerHTML = !arcs.length ? `<circle class="bg" cx="60" cy="60" r="50"/>` : arcs.map((s, i) => `<circle class="demo-seg demo-seg--${PLACARD[s]}" style="--i:${i}" cx="60" cy="60" r="50"`
      + ` stroke-dasharray="${(slot - gap).toFixed(2)} ${(C - slot + gap).toFixed(2)}" stroke-dashoffset="${(-i * slot).toFixed(2)}"/>`).join("");
  }

  function paintResult(res) {
    const s1 = E.step1(state, today()), cl = E.checklist(state, res);
    const box = $("#result");
    if (!box.querySelector(".demo-ring")) {
      box.innerHTML = `<div class="ec-ring">
  <svg class="demo-ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="bg" cx="60" cy="60" r="50"/></svg>
  <p class="demo-ring__txt"><b data-r="backed"></b>/<span data-r="total"></span><small>claims backed</small></p>
</div>
<div class="ec-facts">
  <p class="ec-days" data-r="days"></p>
  <p class="ec-route"><span class="lbl">Route</span><span data-r="route"></span></p>
  <ul class="ec-list" data-r="list"></ul>
</div>`;
    }
    paintRing(res);
    const put = (k, html) => { const el = box.querySelector(`[data-r="${k}"]`); if (el.innerHTML !== html) el.innerHTML = html; };
    put("backed", String(cl.backed));
    put("total", String(cl.total));
    put("days", s1.days > 0
      ? `<span class="num num--big">${s1.days}</span><span>days to 20 January 2027</span>`
      : `<span>The Machinery Regulation has applied since 20 January 2027.</span>`);
    put("route", `<span class="placard placard--${s1.tone === "wait" ? "caution" : "unknown"}">${esc(s1.label)}</span>`);
    put("list", cl.items.map((i) => `<li class="ec-li ec-li--${i.state}"><span aria-hidden="true">${ICON[i.state]}</span>${esc(i.text)}</li>`).join(""));
    $("#why").innerHTML = s1.sentences.map((p) => `<p>${esc(p)}</p>`).join("")
      + (s1.directive ? `<p>${esc(s1.directive)}</p>` : "") + `<p class="small">${esc(s1.file)}</p>`;
    for (const k of ["usesML", "safetyJob"]) {
      const el = document.querySelector(`[data-hint="${k}"]`);
      if (el) el.innerHTML = state.filled[k] ? `AI · check this: <q>${esc(state.filled[k])}</q>` : esc(state.notes[k] || "");
    }
  }

  // Every card's verdict, the result, the step summaries and the Book-a-call mail.
  function paintAll() {
    const res = state.rows.map(E.claimRow);
    state.rows.forEach((r, i) => paintCard(r, res[i]));
    paintResult(res);
    paintSteps(res);
    $("#book").href = "mailto:rahil@orbiteval.com?subject=" + encodeURIComponent("EU check: the full check")
      + "&body=" + encodeURIComponent(E.mailBody(state, today()));
    lockIfEmbed();
  }

  // ---- Questions -------------------------------------------------------------
  document.querySelectorAll('input[name="usesML"], input[name="safetyJob"]').forEach((el) =>
    el.addEventListener("change", () => {
      state[el.name] = el.value;
      delete state.filled[el.name]; delete state.notes[el.name]; delete state.fromExample[el.name];
      state.example = false; paintAll();
    }));
  $("#sell").addEventListener("change", (e) => { state.sellWhen = e.target.value || null; state.example = false; paintAll(); });
  $("#method").addEventListener("change", (e) => { state.method = e.target.checked; state.example = false; paintAll(); });

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

  function applyAI(j) {
    // Keep any AI row the person has since edited -- it is theirs now. Only
    // untouched AI rows are replaced by this read's fresh suggestions.
    state.rows = state.rows.filter((r) => !r.ai || r.edited).concat(E.rowsFromAI(j.claims).map(withId));
    state.example = false;
    forgetExample();   // first, so this read's hints can fill what the example had answered
    const m = E.mergeHints(state, j.hints);
    state.usesML = m.usesML; state.safetyJob = m.safetyJob; state.filled = Object.assign({}, state.filled, m.filled);
    renderCards(); syncQuestions(); paintAll();
  }

  // While a read runs: the moving bar, the drop zone marked busy, the Read button off.
  function setBusy(on) {
    busy = on;
    $("#reading").hidden = !on;
    if (on) $("#drop").setAttribute("aria-busy", "true"); else $("#drop").removeAttribute("aria-busy");
    $("#read").disabled = on || limited;
    $("#drop").disabled = limited;
  }

  async function readWithAI() {
    if (busy) return;
    if (limited) return status(limitMsg);
    if (!API) return status("The AI reader is not switched on yet. Fill in the check by hand.");
    const from = picked ? picked.name : "Pasted text";
    setBusy(true);
    try {
      let pages;
      try { pages = await inputPages(); } catch (e) { return status("That file could not be opened. Paste the text instead."); }
      if (!pages.length) return status("Choose a file or paste some text first.");
      if (!E.hasText(pages)) return status("This file has no readable text. It may be a scan. Paste the text instead.");
      if (E.tooLong(pages)) return status("That is longer than the check reads (30,000 characters). Paste the part with your claims.");
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 65000);
      status(picked ? `Reading ${picked.name}…` : "Reading…");
      try {
        const r = await fetch(API + "/api/extract", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pages.length > 1 ? { pages } : { text: pages[0] }), signal: ctl.signal });
        const j = await r.json().catch(() => ({}));
        if (j && j.limited === true) {
          // The server's daily cap is reached. The reader stays off for the
          // rest of this session; the manual path keeps working.
          limited = true;
          limitMsg = j.error || "The daily limit has been reached. Fill in the check by hand.";
          // No dead controls: the drop zone and the paste box go; the example and the manual path stay.
          document.documentElement.classList.add("ec-limited");
          return status(limitMsg);
        }
        if (!r.ok || !Array.isArray(j.claims)) return status(j.error || "The AI reader is not available right now. Fill in the check by hand.");
        applyAI(j);
        status(E.readStatus(j.claims.length, j.dropped));
        if (!j.claims.length) { source = ""; readNote = ""; return paintAll(); }
        source = from;
        readNote = esc($("#readstatus").textContent);
        go(2);
      } catch (e) {
        status("The AI reader is not available right now. Fill in the check by hand.");
      } finally { clearTimeout(timer); }
    } finally { setBusy(false); }
  }

  // A chosen file is read at once; its name is the status line until the read ends.
  function setPicked(f) {
    picked = f;
    status(f ? `Reading ${f.name}…` : "");
  }

  $("#drop").addEventListener("click", () => {
    if (busy) return;
    $("#file").value = "";   // choosing the same file again must still start a read
    $("#file").click();
  });
  $("#file").addEventListener("change", (e) => {
    const f = e.target.files[0] || null;
    if (!f || busy) return;
    setPicked(f);
    readWithAI();
  });
  $("#pastetoggle").addEventListener("click", () => {
    $("#pastebox").hidden = false;
    $("#pastetoggle").hidden = true;
    $("#paste").focus();
  });
  $("#read").addEventListener("click", () => {
    if (busy) return;
    setPicked(null); $("#file").value = "";   // this button reads the pasted text
    readWithAI();
  });
  // Typing or pasting takes over from a chosen file -- otherwise the file
  // silently wins, and the pasted text is never sent.
  $("#paste").addEventListener("input", () => {
    if (!picked) return;
    setPicked(null); $("#file").value = "";
    status("Using the pasted text.");
  });

  // Drag and drop: the whole of step 1 takes a file while it is open. A file
  // dropped anywhere else is refused, rather than opened in place of the page.
  const drop = $("#drop"), s1 = $("#s1");
  const hasFiles = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  const takes = () => state.step === 1 && !!API && !limited && !busy;
  s1.addEventListener("dragover", (e) => {
    if (!hasFiles(e) || !takes()) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    drop.classList.add("is-over");
  });
  s1.addEventListener("dragleave", (e) => { if (!s1.contains(e.relatedTarget)) drop.classList.remove("is-over"); });
  s1.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation();
    drop.classList.remove("is-over");
    const f = e.dataTransfer.files[0] || null;
    if (!f || !takes()) return;
    setPicked(f);
    readWithAI();
  });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "none"; } });
  window.addEventListener("drop", (e) => { if (hasFiles(e)) e.preventDefault(); });

  // ---- The example: one real read of a real public datasheet, names hidden ----
  // A row the person made or changed: an edited AI row, or a hand row with anything typed in it.
  const ownRow = (r) => r.edited || (!r.ai && [r.text, r.claimedPct, r.attempts, r.successes].some((v) => String(v).trim() !== ""));

  async function loadExample() {
    if (state.rows.some(ownRow) && !confirm("Replace your claims with the example?")) return;   // a cancel keeps everything
    try {
      const j = await (await fetch("eu-check-demo.json")).json();
      state = fresh();
      applyAI(j);
      state.example = true;   // the checklist does not assess a testing method for the example
      state.rows.forEach((r) => { r.ex = true; });
      if (j.hints.safety_job === null) { state.safetyJob = "unsure"; if (j.note) state.notes.safetyJob = j.note; }
      for (const k of ["usesML", "safetyJob"]) if (state[k] != null) state.fromExample[k] = true;
      syncQuestions();
      setPicked(null); $("#file").value = "";
      source = "Example";
      readNote = `Example: a real public robot datasheet (names hidden), read by AI on ${esc(j.read.date)}; quotes checked against the source by code.`;
      statusHTML(readNote);
      go(2);
    } catch (e) { status("The example could not be loaded."); }
  }
  $("#example").addEventListener("click", loadExample);

  // Once no row from the example is left (deleted, or replaced by a read), nothing
  // else of it stays: not its name or note in step 1, nor an answer it set that
  // the person has not changed since.
  function forgetExample() {
    if (state.rows.some((r) => r.ex)) return;
    if (source === "Example") { source = ""; readNote = ""; status(""); }
    for (const k of Object.keys(state.fromExample)) { state[k] = null; delete state.filled[k]; delete state.notes[k]; }
    state.fromExample = {};
    syncQuestions();
  }

  // ---- Report ------------------------------------------------------------------
  $("#download").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([E.report(state, today())], { type: "text/markdown" }));
    a.download = "orbiteval-eu-check.md";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  state.step = 1;
  renderCards(); paintAll();
  // The preview opens on the example's claims (step 2), never on its result.
  if (embed && params.get("example") === "1") loadExample();
})();
