/* Public copy of First Hour: cases exported by scripts/export_static.py, served as plain files.
   Stands in for the server: answers come from the assistant's saved runs, and decisions, the to-collect list and
   closer looks stay in this browser, per case. Loaded before app.js, which switches to it when
   window.ORBIT_STATIC is set. */
(function () {
  const BASE = new URL("first-hour/", document.baseURI);
  const abs = (p) => new URL(p, BASE).href;
  const KEY = (cid) => `orbit.static.v2.${cid}`;
  let INDEX = [];
  const ready = fetch(abs("cases.json"), { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(`Could not load the cases (${r.status}).`); return r.json(); })
    .then((ix) => { INDEX = ix; return ix; });
  const bundles = {}, loading = {}, states = {};
  const load = (cid) => (loading[cid] ||= fetch(abs(`cases/${encodeURIComponent(cid)}/case.json`), { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error("No such case."); return r.json(); })
    .then((b) => { bundles[cid] = b; return b; }));
  const stateOf = (cid) => {
    if (!states[cid]) {
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(KEY(cid)) || "{}") || {}; } catch { /* storage blocked */ }
      states[cid] = Object.assign({ findings: {}, ledger: [], collect: [], done: {}, notes: {}, closed: [] }, saved);
    }
    return states[cid];
  };
  const persist = (cid) => { try { localStorage.setItem(KEY(cid), JSON.stringify(states[cid])); } catch { /* storage blocked */ } };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const now = () => new Date().toISOString().slice(0, 19) + "+00:00";
  const fail = (msg) => { throw new Error(msg); };
  const LIVE = (what) => `${what} needs the live assistant. This public copy shows saved results.`;
  const caseFile = (cid, path) => abs(`cases/${encodeURIComponent(cid)}/${path}`);

  // ---------- the same rules the server applies to text (orbit_evidence/rules.py) ----------
  const BLOCKED = new RegExp([
    String.raw`\b(?:hispanic|latino|latina|latinx|asian|caucasian|african[- ]american|middle[- ]eastern|arab|ethnicity|ethnic|racial|complexion|light[- ]skinned|dark[- ]skinned)\b`,
    String.raw`\b(?:black|white|brown)\s+(?:man|men|male|males|woman|women|female|females|guy|guys|person|people|individual|kid|teen|teenager|boy|girl)\b`,
    String.raw`\b(?:suspects?|criminals?|robbers?|thie(?:f|ves)|perpetrators?|perps?|gunman|gang|identified as)\b|\b(?:his|her|their) name\b`,
    String.raw`\b\d{1,2}\s*(?:-|to)\s*\d{1,2}\s*(?:years?|yrs?)\b|\b\d{1,2}\s*(?:years?|yrs?)[- ]old\b|\bteen(?:ager)?s?\b|\bjuveniles?\b|\belderly\b|\bmiddle[- ]aged\b`,
  ].join("|"), "gi");
  const flagTerms = (text) => [...new Set([...String(text || "").matchAll(BLOCKED)].map((m) => m[0].toLowerCase()))].sort();
  const inPacket = (f) => (f.state === "accepted" || f.state === "edited") && !(f.flags || []).length;

  // ---------- state: the exported case plus what happened in this browser ----------
  function findings(cid) {
    const L = stateOf(cid);
    return clone(bundles[cid].view.findings).map((f) => Object.assign(f, L.findings[f.id] || {}));
  }

  function view(cid) {
    const B = bundles[cid], L = stateOf(cid);
    const v = clone(B.view);
    v.findings = findings(cid);
    v.ledger = v.ledger.concat(L.ledger);
    v.case.collect = (v.case.collect || []).concat(clone(L.collect)).map((it) => (it.id in L.done ? { ...it, done: L.done[it.id] } : it));
    for (const [sid, ns] of Object.entries(L.notes)) (v.notes[sid] ||= []).push(...ns);
    return v;
  }

  function decide(cid, fid, body) {
    const L = stateOf(cid);
    const reviewer = String(body.reviewer || "").trim(), reason = String(body.reason || "").trim(), decision = body.decision;
    if (!["proposed", "accepted", "edited", "rejected"].includes(decision)) fail(`unknown decision: ${decision}`);
    if (!reviewer) fail("type your name first; every decision is logged with a name");
    if (decision === "rejected" && !reason) fail("say why it is rejected");
    if (decision === "edited" && !String(body.text || "").trim()) fail("the edited text is empty");
    const f = findings(cid).find((x) => x.id === fid) || fail("No such finding.");
    const before = f.state;
    const change = L.findings[fid] || {};
    if (decision === "edited") {
      if (!("model_text" in change)) change.model_text = f.text;
      change.text = String(body.text).trim();
      change.flags = flagTerms(change.text);
      f.text = change.text;
    }
    Object.assign(change, { state: decision, decided_by: reviewer, decided_at: now(), reason });
    L.findings[fid] = change;
    L.ledger.push({ at: now(), event: "decision", finding: fid, from: before, to: decision, by: reviewer, reason, text: f.text });
    persist(cid);
    return Object.assign(f, change);
  }

  function addCollect(cid, body) {
    const B = bundles[cid], L = stateOf(cid);
    const camera = String(body.camera || "").trim();
    if (!camera) fail("name the camera");
    const days = body.retention_days ?? B.view.retention_days[body.source_type] ?? null;
    const item = { id: Math.random().toString(16).slice(2, 10), camera, source_type: body.source_type, retention_days: days, delete_by: null, done: false };
    const at = B.view.case.incident_at;
    if (days && at) {
      const d = new Date(`${at.slice(0, 10)}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + Number(days));
      item.delete_by = d.toISOString().slice(0, 10);
    }
    L.collect.push(item);
    persist(cid);
    return item;
  }

  const srcOf = (cid, sid) => (bundles[cid]?.view.case.sources || []).find((s) => s.sid === sid);
  const ms = (cid, sid, t) => {
    const src = srcOf(cid, sid);
    const d = src ? Number(src.duration) : 0;
    return Math.round(Math.min(Math.max(Number(t) || 0, 0), Math.max(d - 0.1, 0)) * 1000);
  };

  function closer(cid, sid, body) {
    const L = stateOf(cid);
    const key = `${sid}|${Math.round(Number(body.t0) * 1000)}`;
    const notes = bundles[cid].closer[key];
    if (!notes) fail(LIVE("A closer look at this moment"));
    if (!L.closed.includes(key)) {
      L.closed.push(key);
      (L.notes[sid] ||= []).push(...clone(notes));
      persist(cid);
    }
    return { notes: clone(notes) };
  }

  const norm = (q) => String(q || "").toLowerCase().replace(/[?.!\s]+$/g, "").replace(/\s+/g, " ").trim();

  async function api(path, opts = {}) {
    await ready;
    const method = (opts.method || (opts.json !== undefined ? "POST" : "GET")).toUpperCase();
    const p = new URL(path, "http://local").pathname;
    const body = opts.json || {};
    const m = p.match(/^\/api\/cases\/([^/]+)(\/.*)?$/);
    if (p === "/api/cases") return method === "GET" ? clone(INDEX) : fail(LIVE("Opening a new case"));
    if (p === "/api/library") fail(LIVE("The research library"));
    if (!m) fail("Not in this public copy.");
    const cid = decodeURIComponent(m[1]);
    if (!INDEX.some((c) => c.id === cid)) fail("No such case.");
    const B = await load(cid);
    const rest = m[2] || "";
    let r;
    if (!rest) return view(cid);
    if (rest === "/canvass") return clone(B.canvass);
    if (rest === "/requests") return clone(B.requests);
    if ((r = rest.match(/^\/sources\/([^/]+)\/tracks$/))) return clone(B.tracks[r[1]] || { people: [], tracks: {} });
    if ((r = rest.match(/^\/findings\/([^/]+)\/decide$/))) return decide(cid, decodeURIComponent(r[1]), body);
    if ((r = rest.match(/^\/sources\/([^/]+)\/closer$/))) return closer(cid, r[1], body);
    if (rest === "/ask") {
      const a = B.answers[norm(body.question)];
      return a ? clone(a) : fail("I have saved answers to the suggested questions only. A new question needs the live assistant, which looks at the video again.");
    }
    if (rest === "/scene") {
      const num = String(body.casenumber || "").trim();
      if (num === cid) return view(cid).case;
      fail(`This public copy holds ${INDEX.length} cases: ${INDEX.map((c) => c.case_number).join(", ")}. The live version looks up any Oakland CrimeWatch case number.`);
    }
    if (rest === "/collect") return addCollect(cid, body);
    if ((r = rest.match(/^\/collect\/([^/]+)\/done$/))) {
      const id = decodeURIComponent(r[1]);
      if (!view(cid).case.collect.some((it) => it.id === id)) fail("No such item.");
      stateOf(cid).done[id] = !!body.done; persist(cid);
      return { id, done: !!body.done };
    }
    if (rest === "/report" || rest === "/mismatch") fail(LIVE("Comparing a statement with the video"));
    if (/\/watch$/.test(rest)) fail(LIVE("Watching footage again"));
    if (/^\/sources(\/library)?$/.test(rest)) fail(LIVE("Adding footage"));
    fail("Not in this public copy.");
  }

  // ---------- files ----------
  function still(cid, sid, t) {
    const have = bundles[cid]?.stills[sid] || [];
    if (!have.length) return "";
    const want = ms(cid, sid, t);
    const best = have.includes(want) ? want : have.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
    return caseFile(cid, `media/${sid}/still-${best}.jpg`);
  }

  function crop(cid, sid, t, box, longest) {
    const src = srcOf(cid, sid);
    if (!src) return still(cid, sid, t);
    const cl = (v, hi) => Math.max(0, Math.min(Number(v), hi));
    const [x1, x2] = [cl(box[0], src.width), cl(box[2], src.width)].sort((a, b) => a - b);
    const [y1, y2] = [cl(box[1], src.height), cl(box[3], src.height)].sort((a, b) => a - b);
    const tt = Math.min(Math.max(Number(t), 0), Math.max(Number(src.duration) - 0.1, 0));
    const name = `c_${String(Math.trunc(tt * 1000)).padStart(8, "0")}_${Math.trunc(x1)}_${Math.trunc(y1)}_${Math.trunc(x2)}_${Math.trunc(y2)}_${Math.max(64, Math.min(longest, 960))}.jpg`;
    return (bundles[cid].crops[sid] || []).includes(name) ? caseFile(cid, `media/${sid}/${name}`) : still(cid, sid, t);
  }

  // ---------- printable pages (orbit_evidence/packets.py) ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]);
  const mmss = (t) => { t = Math.max(0, Number(t) || 0); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`; };
  const stamp = (iso) => esc(String(iso || "").slice(0, 16).replace("T", " "));
  const shown = (text) => (flagTerms(text).length ? '<span class="meta">Text withheld: needs rewording before it can go in a packet.</span>' : esc(text));
  const cameraOf = (c, sid) => (c.sources.find((s) => s.sid === sid) || { camera: sid }).camera;
  const EXAMPLE = "Example footage (public research video), not from this case.";
  const exampleNote = (c, s) => (c.scene && String(s.origin || "").startsWith("UCF-Crime") ? EXAMPLE : null);
  const withoutLabel = (f) => (f.label && f.text.startsWith(`${f.label}: `) ? f.text.slice(f.label.length + 2) : f.text);
  const stillsOf = (c, f) => {
    const fr = f.frames || [];
    const picks = fr.length <= 3 ? fr : [fr[0], fr[Math.floor(fr.length / 2)], fr[fr.length - 1]];
    return picks.map((t) => `<figure><img src="${esc(still(c.id, f.sid, t))}" alt=""><figcaption>${mmss(t)}</figcaption></figure>`).join("");
  };
  const head = (c, kind) => {
    const bits = [c.case_number, c.crime_type, String(c.incident_at || "").replace("T", " ")].filter(Boolean);
    return `<header><p class="kicker">${esc(kind)}</p><h1>${esc(c.title)}</h1><p class="meta">${esc(bits.join(" · "))}</p></header>`;
  };
  const page = (c, title, body) => {
    const d = new Date();
    const when = `${String(d.getUTCDate()).padStart(2, "0")} ${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${bundles[c.id].packet_css}</style></head><body><main>${body}</main><p class="foot">Built by Orbit Evidence on ${when}. Only findings a person accepted are included. Descriptions come from video; no one has been identified.</p></body></html>`;
  };

  function lookoutHtml(c, fs) {
    const ok = fs.filter(inPacket);
    let body = head(c, "Lookout") + '<p class="warn">Verify before any stop. These are descriptions from video, not an identification.</p>';
    const notes = [...new Set(c.sources.map((s) => exampleNote(c, s)).filter(Boolean))];
    if (notes.length) body += `<p class="warn">${esc(notes[0])}</p>`;
    if (!ok.length) return page(c, `Lookout · ${c.title}`, body + '<p class="empty">Nothing accepted yet. Accept findings first.</p>');
    for (const f of ok.filter((x) => x.kind === "person" || x.kind === "vehicle").sort((a, b) => a.t - b.t)) {
      body += `<section class="who"><div class="stills">${stillsOf(c, f)}</div><div><h2>${esc(f.label || f.kind[0].toUpperCase() + f.kind.slice(1))}</h2><p>${esc(withoutLabel(f))}</p><p class="meta">${esc(cameraOf(c, f.sid))} · seen ${mmss(f.t)}–${mmss(f.t_end)} · accepted by ${esc(f.decided_by || "")}</p></div></section>`;
    }
    const moments = ok.filter((f) => f.kind === "moment").sort((a, b) => (a.sid === b.sid ? a.t - b.t : a.sid < b.sid ? -1 : 1));
    if (moments.length) body += "<h2>What happened</h2><ol>" + moments.map((f) => `<li><span class="t">${esc(cameraOf(c, f.sid))} ${mmss(f.t)}</span> ${esc(f.text)}</li>`).join("") + "</ol>";
    return page(c, `Lookout · ${c.title}`, body);
  }

  function ledgerRow(e) {
    let what, note;
    if (e.event === "decision") {
      return `<tr><td class="t">${stamp(e.at)}</td><td>${esc(e.finding)}: ${esc(e.from)} → ${esc(e.to)}</td><td>${esc(e.by || "")}</td><td>${e.reason ? esc(e.reason) : shown(e.text || "")}</td></tr>`;
    } else if (e.event === "sealed") { what = `Sealed ${esc(e.sid)} · SHA-256 ${esc(e.sha256)}`; note = e.origin || ""; }
    else { what = esc(String(e.event || "").replace("_", " ")); note = e.title || ""; }
    return `<tr><td class="t">${stamp(e.at)}</td><td>${what}</td><td>${esc(e.by || "")}</td><td>${esc(note)}</td></tr>`;
  }

  function packetHtml(c, fs, ledger, types) {
    const ok = fs.filter(inPacket).sort((a, b) => (a.sid === b.sid ? a.t - b.t : a.sid < b.sid ? -1 : 1));
    const rejected = fs.filter((f) => f.state === "rejected");
    const waiting = fs.filter((f) => f.state === "proposed").length;
    const flagged = fs.filter((f) => (f.state === "accepted" || f.state === "edited") && (f.flags || []).length).length;
    let body = head(c, "Packet for the District Attorney");
    body += "<h2>Footage</h2><table><tr><th>Camera</th><th>Type</th><th>Length</th><th>Size</th><th>SHA-256 of the original</th><th>Sealed (UTC)</th></tr>";
    for (const s of c.sources) {
      const note = exampleNote(c, s);
      body += `<tr><td>${esc(s.camera)}<br><span class="meta">${esc(s.origin)}</span>${note ? `<br><b>${esc(note)}</b>` : ""}</td><td>${esc(types[s.source_type] || s.source_type)}</td><td>${mmss(s.duration)}</td><td>${s.width}×${s.height}</td><td class="hash">${esc(s.sha256)}</td><td class="t">${stamp(s.added_at)}</td></tr>`;
    }
    body += "</table><h2>Accepted findings</h2>";
    if (!ok.length) body += '<p class="empty">Nothing accepted yet.</p>';
    for (const f of ok) {
      const how = f.state === "edited" ? "Edited and accepted" : "Accepted";
      body += `<section class="finding"><div class="stills">${stillsOf(c, f)}</div><div><p class="t">${esc(cameraOf(c, f.sid))} ${mmss(f.t)}–${mmss(f.t_end)}</p><p>${esc(f.text)}</p><p class="meta">${how} by ${esc(f.decided_by || "")} at ${stamp(f.decided_at)} UTC${f.confidence ? ` · model confidence ${esc(f.confidence)}` : ""}</p></div></section>`;
    }
    if (rejected.length) body += "<h2>Rejected leads</h2><ul>" + rejected.map((f) => `<li>${shown(f.text)} <span class="meta">— rejected by ${esc(f.decided_by || "")}: ${esc(f.reason || "")}</span></li>`).join("") + "</ul>";
    const mm = c.mismatch || {};
    if ((c.gaps || []).length || (mm.disagrees || []).length) body += '<h2>Model notes, not reviewed by a person</h2><p class="meta">Written by the AI model from the video. No one has accepted these; treat them as leads to check.</p>';
    if ((c.gaps || []).length) body += "<h3>What the footage does not show</h3><ul>" + c.gaps.map((g) => `<li>${shown(g.text)}</li>`).join("") + "</ul>";
    if ((mm.disagrees || []).length) body += "<h3>Where the report and the video differ</h3><ul>" + mm.disagrees.map((d) => `<li><b>Report:</b> ${esc(d.claim)} <b>Video:</b> ${shown(d.video)} <span class="t">${d.frames.slice(0, 3).map(mmss).join(", ")}</span></li>`).join("") + "</ul>";
    body += `<p class="meta">Left out: ${waiting} findings not yet reviewed and ${flagged} accepted findings that need rewording.</p>`;
    body += "<h2>Log</h2><table><tr><th>Time (UTC)</th><th>What</th><th>Who</th><th>Note</th></tr>" + ledger.map(ledgerRow).join("") + "</table>";
    return page(c, `DA packet · ${c.title}`, body);
  }

  function sheet(kind, data) {
    const html = kind === "lookout" ? lookoutHtml(data.case, data.findings) : packetHtml(data.case, data.findings, data.ledger, data.source_types);
    return URL.createObjectURL(new Blob([html], { type: "text/html" }));
  }

  function reset() {
    try {
      for (const c of INDEX) { localStorage.removeItem(KEY(c.id)); localStorage.removeItem(`orbit.chat.${c.id}`); }
    } catch { /* storage blocked */ }
  }

  const startOver = document.createElement("button");
  startOver.className = "btn ghost small";
  startOver.type = "button";
  startOver.textContent = "Start over";
  startOver.title = "Clear the decisions and questions made in this browser";
  startOver.onclick = () => { if (confirm("Clear the decisions and questions made in this browser, for every case?")) { reset(); location.reload(); } };
  document.querySelector("#fileBtn")?.before(startOver);
  const note = document.createElement("p");
  note.className = "meta";
  note.style.margin = "8px 2px 0";
  note.textContent = "Public copy: the assistant's saved answers for these cases. Your decisions stay in this browser.";
  document.querySelector(".composer")?.append(note);

  window.ORBIT_STATIC = {
    api, still, crop, sheet, reset, ready,
    video: (cid, sid) => caseFile(cid, `media/${sid}.mp4`),
    questions: (cid) => (bundles[cid] ? bundles[cid].questions : []),
    hasCase: (num) => INDEX.some((c) => c.id === num),
  };
})();
