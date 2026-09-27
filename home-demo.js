// Home page demo: one real read of a real public datasheet (names hidden),
// shown in four steps. Every count comes from eu-check-demo.json through the
// check's own rules; nothing is typed into the page.
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./eu-check-logic.js") : root.EUCheck);
  if (isNode) module.exports = api; else root.HomeDemo = api;
})(typeof window !== "undefined" ? window : globalThis, function (E) {
  "use strict";
  function model(j, todayISO) {
    const rows = E.rowsFromAI(j.claims);
    const res = rows.map(E.claimRow);
    return {
      pages: j.source.pages, total: rows.length,
      withNumbers: rows.filter((r) => r.attempts !== "" && r.successes !== "").length,
      backed: res.filter((r) => r.status === "backed").length,
      days: E.daysUntilDeadline(todayISO),
      rows: rows.map((r, i) => ({ quote: r.text, label: res[i].label, status: res[i].status })),
    };
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const PLACARD = { backed: "current", short: "caution", invalid: "revoked", nocount: "unknown", other: "unknown" };
  // The days fact: a count down to the deadline, or -- once it has passed -- no
  // number at all, since a negative or zero count reads as a countdown that
  // never happened. Exported so its two branches can be unit-tested directly.
  function daysFact(days) {
    return days > 0 ? `<b>${days}</b> days to 20 January 2027` : "Applies since 20 January 2027";
  }
  function mount(doc, m) {
    const set = (k, v) => doc.querySelectorAll(`[data-hd="${k}"]`).forEach((el) => { el.textContent = v; });
    const setHTML = (k, v) => doc.querySelectorAll(`[data-hd="${k}"]`).forEach((el) => { el.innerHTML = v; });
    set("pages", m.pages); set("total", m.total); set("with-numbers", m.withNumbers);
    set("backed", m.backed); setHTML("days", daysFact(m.days));
    const shown = m.rows.slice(0, 5);
    const q = doc.querySelector('[data-hd="quotes"]');
    if (q) q.innerHTML = shown.map((r, i) => `<li style="--i:${i}"><mark>${esc(r.quote)}</mark></li>`).join("");
    const v = doc.querySelector('[data-hd="verdicts"]');
    if (v) v.innerHTML = shown.map((r, i) => `<li style="--i:${i}"><span>${esc(r.quote)}</span>`
      + `<span class="placard placard--${PLACARD[r.status]}">${esc(r.label)}</span></li>`).join("");
    // The ring: one arc per claim, coloured as its verdict's placard, backed first.
    const ring = doc.querySelector('[data-hd="ring"]');
    if (ring && m.total) {
      const C = 2 * Math.PI * 50, slot = C / m.total, gap = m.total > 1 ? Math.min(5, slot / 3) : 0;
      const order = ["backed", "short", "invalid", "nocount", "other"];
      const arcs = m.rows.map((r) => r.status).sort((a, b) => order.indexOf(a) - order.indexOf(b));
      ring.innerHTML = arcs.map((s, i) => `<circle class="demo-seg demo-seg--${PLACARD[s]}" style="--i:${i}" cx="60" cy="60" r="50"`
        + ` stroke-dasharray="${(slot - gap).toFixed(2)} ${(C - slot + gap).toFixed(2)}" stroke-dashoffset="${(-i * slot).toFixed(2)}"/>`).join("");
    }
    doc.querySelectorAll('[data-hd="stage"]').forEach((el) => el.classList.add("is-ready"));
  }
  if (typeof document !== "undefined") {
    fetch("eu-check-demo.json").then((r) => r.json())
      .then((j) => mount(document, model(j, E.localISO(new Date()))))
      .catch(() => {});
  }
  return { model, daysFact };
});
