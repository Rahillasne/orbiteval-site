// EU Readiness Check: the rules and the wording, with no page in sight.
// Browser: window.EUCheck. Node: module.exports.
// Every sentence about the regulation is a constant in SENTENCES, checked
// against the source text before it shipped. Change one only after checking
// the new wording the same way.
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./stats.js") : root.OrbitStats);
  if (isNode) module.exports = api; else root.EUCheck = api;
})(typeof window !== "undefined" ? window : globalThis, function (Stats) {
  "use strict";
  const DEADLINE = "2027-01-20";
  const MAX_CHARS = 30000;

  const SENTENCES = {
    out: "The Machinery Regulation applies from 20 January 2027. This check covers machines with AI.",
    partA: "Annex I Part A lists safety components, and systems embedded in machinery, \"with fully or partially self-evolving behaviour using machine learning approaches ensuring safety functions\" (points 5 and 6). Part A products go through a notified body (modules B+C, H or G); self-assessment alone is not listed for them. For machinery under point 6, this applies only in respect of those embedded systems.",
    notA: "If the AI does not ensure a safety function, points 5 and 6 of Part A do not describe it. The machine can still be in Part A for another reason on that list.",
    unsure: "Whether the AI's behaviour is self-evolving and whether it ensures a safety function are the first questions to ask about the route.",
    file: "The technical file must include reports or results of tests carried out. For sensor-fed, remotely driven or autonomous machines whose safety-related operations are controlled by sensor data, it must also include, where appropriate, a description of the testing and validation processes used. It is kept at least 10 years.",
    directive: "Until 20 January 2027 the Machinery Directive 2006/42/EC applies; this check covers the Regulation that replaces it.",
    lawyer: "Have your lawyer confirm this.",
    privacy: "Your text is sent to our server and to OpenAI to be read. We do not store it. OpenAI does not use API data to train its models unless we opt in to share it. It keeps logs that can include your text for up to 30 days, or longer where the law requires it or to protect its services or others from harm (developers.openai.com/api/docs/guides/your-data, read 26 September 2026). Don't send anything you can't share with a third party. You can type everything by hand instead.",
  };

  const ROUTES = {
    incomplete: { label: "Answer the questions", tone: "grey", say: [] },
    outside: { label: "Outside this check", tone: "grey", say: ["out"] },
    notified: { label: "Notified body if Part A applies", tone: "wait", say: ["partA"] },
    self: { label: "Self-assessment (module A) may be open to you", tone: "grey", say: ["notA"] },
    unsure: { label: "First question for your lawyer", tone: "wait", say: ["unsure"] },
  };

  function daysUntilDeadline(todayISO) {
    const [y, m, d] = todayISO.split("-").map(Number);
    return Math.round((Date.UTC(2027, 0, 20) - Date.UTC(y, m - 1, d)) / 86400000);
  }

  function step1(a, todayISO) {
    let route = "incomplete";
    if (a.usesML === "no") route = "outside";
    else if (a.usesML === "yes") route = { yes: "notified", no: "self", unsure: "unsure" }[a.safetyJob] || "incomplete";
    const r = ROUTES[route];
    const sentences = r.say.map((k) => SENTENCES[k]);
    if (route !== "incomplete") sentences.push(SENTENCES.lawyer);
    const directive = a.sellWhen === "now" || a.sellWhen === "before" ? SENTENCES.directive : null;
    return { route, label: r.label, tone: r.tone, sentences, days: daysUntilDeadline(todayISO), directive, file: SENTENCES.file };
  }

  function parseCount(v) {
    const s = String(v == null ? "" : v).trim().replace(/[\s\xa0\u202f,']/g, "");
    if (s === "") return null;
    return /^\d+$/.test(s) ? Number(s) : NaN;
  }

  function parsePct(v) {
    const s = String(v == null ? "" : v).trim().replace(/[\s%]/g, "").replace(",", ".");
    if (s === "") return null;
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }

  // Floored to one decimal: the page never says a test backs more than it does.
  const floorPct = (x) => (Math.floor(x * 1000 + 1e-9) / 10).toFixed(1) + "%";
  const invalid = (text) => ({ status: "invalid", label: "Check the numbers", text });

  function claimRow(row) {
    if (row.kind === "other") return { status: "other", label: "Needs a test report", text: "The full check can cover it (up to ten claims)." };
    const pct = parsePct(row.claimedPct), n = parseCount(row.attempts), x = parseCount(row.successes);
    if (n === null && x === null) return { status: "nocount", label: "No test count stated", text: "Add the attempts and successes behind this claim." };
    if (pct === null || Number.isNaN(pct) || !(pct > 0 && pct <= 100)) return invalid("Enter the claimed success rate, between 0 and 100.");
    if (n === null || x === null || Number.isNaN(n) || Number.isNaN(x) || n < 1) return invalid("Enter whole numbers for attempts and successes.");
    if (x > n) return invalid("Successes cannot be more than attempts.");
    const claim = pct / 100, lower = Stats.wilson(x, n)[0], observed = x / n;
    const backs = "At 95% confidence, your test shows at least " + floorPct(lower) + ".";
    if (lower >= claim - 1e-12) return { status: "backed", label: "Backed", text: backs, lower };
    if (observed <= claim) {
      return { status: "short", label: "Not enough proof", lower, needed: null,
        text: backs + " At your current success rate, more attempts cannot back this claim." };
    }
    let needed = Stats.neededOne(observed, claim);
    if (needed !== null && !(needed > n)) needed = n + 1;   // never a total at or below the attempts already run
    return { status: "short", label: "Not enough proof", lower, needed,
      text: backs + (needed === null
        ? " More than 2,000,000 attempts would be needed at your current success rate."
        : " About " + needed.toLocaleString("en-US") + " attempts in total would back it, if you keep the same success rate ("
          + x.toLocaleString("en-US") + " of " + n.toLocaleString("en-US") + ").") };
  }

  const item = (id, state, text) => ({ id, state, text });

  // "na" is an item the check did not assess (the method, in the example): it
  // is shown, but it is not an open item.
  function checklist(state, results) {
    const rows = state.rows || [];
    const backed = results.filter((r) => r.status === "backed").length;
    const withCounts = results.filter((r) => r.status === "backed" || r.status === "short").length;
    const open = results.filter((r) => ["short", "nocount", "invalid", "other"].includes(r.status)).length;
    const answered = state.usesML === "no" || state.safetyJob === "yes" || state.safetyJob === "no";
    const items = [
      rows.length ? item("claims", "ok", "Claims listed") : item("claims", "bad", "No claims listed yet"),
      withCounts === 0 ? item("tests", "bad", "No claim has test numbers yet")
        : open > 0 ? item("tests", "warn", `${open} ${open === 1 ? "claim" : "claims"} without enough test proof`)
          : item("tests", "ok", "Test results back every claim"),
      state.example === true ? item("method", "na", "Testing method: not assessed in this example")
        : state.method ? item("method", "ok", "Testing method written down")
          : item("method", "bad", "Testing method not written down (needed where Annex IV (n) applies)"),
      answered ? item("route", "ok", "Route question answered")
        : state.safetyJob === "unsure" ? item("route", "warn", "Route question open: not sure")
          : item("route", "warn", "Route question not answered"),
    ];
    return { items, missing: items.filter((i) => i.state !== "ok" && i.state !== "na").length, backed, total: rows.length };
  }

  function mergeHints(answers, hints) {
    const out = { usesML: answers.usesML, safetyJob: answers.safetyJob, filled: {} };
    const h = hints || {};
    if (out.usesML == null && h.uses_ml) { out.usesML = h.uses_ml.answer; out.filled.usesML = h.uses_ml.quote; }
    if (out.safetyJob == null && h.safety_job) { out.safetyJob = h.safety_job.answer; out.filled.safetyJob = h.safety_job.quote; }
    return out;
  }

  const str = (v) => (v == null ? "" : String(v));

  function rowsFromAI(claims) {
    return (claims || []).map((c) => ({
      text: c.quote, kind: c.kind === "rate" ? "rate" : "other",
      claimedPct: str(c.claimed_pct), attempts: str(c.attempts), successes: str(c.successes),
      ai: { quote: c.quote, page: c.page == null ? null : c.page, file: c.file == null ? null : c.file },
    }));
  }

  const hasText = (pages) => pages.join("").replace(/\s/g, "").length >= 20;
  const tooLong = (pages) => pages.reduce((a, p) => a + p.length, 0) > MAX_CHARS;

  function deadlineLine(days) {
    return days > 0 ? days + " days to 20 January 2027." : "The Machinery Regulation has applied since 20 January 2027.";
  }

  const AI_MARK = " (read by AI, not checked by you)";
  const SAFETY = { yes: "yes", no: "no", unsure: "not sure" };
  const SELL = { now: "Already selling", before: "Before 20 January 2027", after: "From 20 January 2027", undecided: "Not decided" };

  function report(state, todayISO) {
    const s1 = step1(state, todayISO), res = (state.rows || []).map(claimRow), cl = checklist(state, res);
    const cell = (v) => str(v).replace(/\|/g, "\\|").replace(/\s+/g, " ");
    const filled = state.filled || {};
    const answer = (v, byAI) => (v == null ? "-" : v) + (byAI && v != null ? AI_MARK : "");
    const lines = [
      "# EU test-evidence check · OrbitEval", "", "Date: " + todayISO, "",
      "## Answers", "",
      "- Uses AI or machine learning: " + answer({ yes: "yes", no: "no" }[state.usesML], filled.usesML != null),
      "- AI does a safety job: " + answer(SAFETY[state.safetyJob], filled.safetyJob != null),
      "- Selling in the EU: " + answer(SELL[state.sellWhen], false), "",
      "## Route", "", "**" + s1.label + "**", "", ...s1.sentences, "",
    ];
    if (s1.directive) lines.push(s1.directive, "");
    lines.push("## Deadline", "", deadlineLine(s1.days), "", s1.file, "",
      "## Claims and tests", "", "Each claim is read as \"at least X%\". Intervals are 95% Wilson score intervals.", "",
      "| Claim | Claimed % | Attempts | Succeeded | Result |", "|---|---|---|---|---|");
    (state.rows || []).forEach((r, i) => lines.push("| " + [cell(r.text) + (r.ai && !r.edited ? AI_MARK : ""), cell(r.claimedPct), cell(r.attempts), cell(r.successes),
      cell(res[i].label + ". " + res[i].text)].join(" | ") + " |"));
    lines.push("", "## Checklist", "", ...cl.items.map((i) => "- [" + (i.state === "ok" ? "x" : " ") + "] " + i.text), "",
      "---", "Free check from orbiteval.com/eu-check. Not legal advice, not a conformity assessment and not a certificate.");
    return lines.join("\n") + "\n";
  }

  function mailBody(state, todayISO) {
    const s1 = step1(state, todayISO), res = (state.rows || []).map(claimRow), cl = checklist(state, res);
    return ["I ran the free EU check and would like the full check.", "",
      "Route: " + s1.label,
      "Test proof: " + cl.backed + " of " + cl.total + " claims backed",
      `Open items in this check: ${cl.missing}`,
      "", "Name:", "Company:", "Machine:", "A time that works for me:", ""].join("\n");
  }

  return { DEADLINE, MAX_CHARS, SENTENCES, daysUntilDeadline, step1, parseCount, parsePct, claimRow,
    checklist, mergeHints, rowsFromAI, hasText, tooLong, report, mailBody };
});
