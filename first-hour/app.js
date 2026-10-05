/* Orbit Evidence · First Hour. Left: where to look (map) and footage. Right: the assistant. */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const tfmt = (t) => {
  t = Math.max(0, Number(t) || 0);
  const m = Math.floor(t / 60);
  const s = Math.round((t - m * 60) * 100) / 100;
  if (Number.isInteger(s)) return `${m}:${String(s).padStart(2, "0")}`;
  const [whole, frac] = s.toFixed(2).replace(/0+$/, "").split(".");
  return `${m}:${whole.padStart(2, "0")}.${frac}`;
};
const dur = (t) => tfmt(Math.round(Number(t) || 0));
const COLORS = ["#E4572E", "#17BEBB", "#FFC914", "#76B041", "#9B5DE5", "#F15BB5", "#00BBF9", "#FEE440"];
const colorFor = (letter) => COLORS[(String(letter || "A").slice(-1).toUpperCase().charCodeAt(0) - 65) % COLORS.length] || COLORS[0];
const KIND_COLOR = { video_camera: "#D1495B", plate_reader: "#2E86AB", gunshot_detector: "#946000", likely_camera_place: "#8C8B85" };
const EVENT_NAME = { object_visible: "object visible", object_pointed: "object pointed", hands_raised: "hands raised", object_lowered: "object lowered", person_leaves: "leaves" };
const CASE_RE = /^\d{2}-\d{6}$/;
const CASE_LIKE = /^(case\s+)?(\d{2}-\d+)$/i;
const STATIC = window.ORBIT_STATIC || null; // the public copy: saved results, no server (static-mode.js)

const S = { cid: null, data: null, sid: null, events: null, reviewer: null, canvass: null, canvassError: null, drafts: null, pickup: false, chat: [], tracks: {}, selPerson: null, view: "map", flown: null, changing: new Set() };
const flagLine = (f) => ((f && f.flags) || []).length ? `<div class="flag">Needs rewording before it can go in a packet: ${f.flags.map(esc).join(", ")}</div>` : "";

function saved(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* storage blocked: keep going without it */ }
  return null;
}

async function api(path, opts = {}) {
  if (STATIC) return STATIC.api(path, opts);
  const init = { ...opts };
  if (opts.json !== undefined) {
    init.method = init.method || "POST";
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(opts.json);
    delete init.json;
  }
  const r = await fetch(path, init);
  const isJson = (r.headers.get("content-type") || "").includes("json");
  const body = isJson ? await r.json() : await r.text();
  if (!r.ok) throw new Error((body && body.detail) || `Request failed (${r.status})`);
  return body;
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 4500);
}

const source = (sid) => S.data?.case.sources.find((s) => s.sid === sid);
const stillUrl = (sid, t) => (STATIC ? STATIC.still(S.cid, sid, t) : `/api/cases/${S.cid}/sources/${sid}/still?t=${Number(t)}`);
const cropUrl = (sid, t, b, longest = 320) => STATIC ? STATIC.crop(S.cid, sid, t, b, longest) : `/api/cases/${S.cid}/sources/${sid}/crop?t=${t}&x1=${b[0]}&y1=${b[1]}&x2=${b[2]}&y2=${b[3]}&longest=${longest}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const titleCase = (s) => String(s || "").toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (m, d, x) => d + x.toLowerCase());
const fmtWhen = (w) => { const d = new Date(w); return isNaN(d) ? w : d.toLocaleString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); };
const fmtDate = (d) => new Date(`${d}T12:00`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
const daysLeft = (d) => { const n = Math.ceil((new Date(`${d}T23:59`) - new Date()) / 86400000); return n >= 0 ? `${n} day${n === 1 ? "" : "s"} left` : "deadline passed"; };
const niceType = (sc) => (sc.descriptions && sc.descriptions.length ? sc.descriptions : [sc.crimetype]).filter(Boolean).map((d) => d.toLowerCase().replace(/-/g, ", ").replace(/^\w/, (c) => c.toUpperCase())).join("; ");
const btn = (label, cmd, primary = false) => `<button class="btn small ${primary ? "primary" : "ghost"}" data-cmd="${esc(cmd)}" type="button">${esc(label)}</button>`;

// ---------- loading ----------
function loadChat(cid) { try { return JSON.parse(saved(`orbit.chat.${cid}`) || "[]"); } catch { return []; } }
function saveChat() { saved(`orbit.chat.${S.cid}`, JSON.stringify(S.chat.slice(-40))); }

async function openCase(cid) {
  Object.assign(S, { cid, sid: null, canvass: null, canvassError: null, drafts: null, pickup: false, tracks: {}, selPerson: null, flown: null });
  S.chat = loadChat(cid);
  saved("orbit.case", cid);
  await refresh();
  const c = S.data.case;
  if (c.sources[0]) selectSource(c.sources[0].sid);
  setView(c.scene ? "map" : c.sources.length ? "video" : "map");
  $("#feed").scrollTop = 0;
  listen();
}

async function refresh() {
  S.data = await api(`/api/cases/${S.cid}`);
  const c = S.data.case;
  if (c.scene && !S.canvass) {
    try { S.canvass = await api(`/api/cases/${S.cid}/canvass?radius=400`); S.canvassError = null; }
    catch (err) { S.canvassError = err.message; }
  }
  await Promise.all(c.sources.filter((s) => s.status === "done").map(loadTracks));
  renderAll();
}

async function loadTracks(s) {
  try { S.tracks[s.sid] = await api(`/api/cases/${S.cid}/sources/${s.sid}/tracks`); } catch { S.tracks[s.sid] = { people: [], tracks: {} }; }
}

function listen() {
  if (STATIC) return;
  if (S.events) S.events.close();
  S.events = new EventSource(`/api/cases/${S.cid}/events`);
  S.events.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    const src = source(ev.sid);
    if (ev.type === "notes" || ev.type === "status") {
      if (src) { src.status = "watching"; src.progress = ev.progress; }
      if (ev.type === "notes") (S.data.notes[ev.sid] ||= []).push(...ev.notes);
      renderFeed(); renderTimeline(); renderChips();
    } else if (ev.type === "done") {
      refresh().then(() => scrollFeed());
      toast(`Watched ${src ? src.camera : "the footage"} in ${ev.watch_seconds} s.`);
    } else if (ev.type === "error") {
      refresh();
      toast(`Watching stopped: ${ev.error}`);
    }
  };
}

// ---------- rendering ----------
function renderAll() {
  if (!S.data) return;
  const c = S.data.case;
  $("#caseBtn").textContent = [c.case_number, c.title].filter(Boolean).join(" · ");
  const ready = S.data.findings.some((f) => (f.state === "accepted" || f.state === "edited") && !(f.flags || []).length);
  for (const [id, page] of [["#lookoutBtn", "lookout"], ["#packetBtn", "packet"]]) {
    $(id).href = STATIC ? "#" : `/cases/${S.cid}/${page}`;
    $(id).setAttribute("aria-disabled", ready ? "false" : "true");
  }
  $("#fileCount").textContent = S.data.findings.filter((f) => f.state === "accepted" || f.state === "edited").length;
  renderChips(); renderFeed(); renderSuggest(); updateMap(); renderPlayer(); renderTimeline(); renderDrawer();
}

function renderChips() {
  $("#footageChips").innerHTML = S.data.case.sources.map((s) => `<button class="fchip ${s.sid === S.sid ? "on" : ""}" data-src="${s.sid}" type="button">${esc(s.camera)} · ${dur(s.duration)}${s.status === "watching" ? ` · ${Math.round((s.progress || 0) * 100)}%` : ""}</button>`).join("");
}

function bubble(html) { return `<div class="msg"><div class="who"><i></i>Orbit</div>${html}</div>`; }

function sceneCard() {
  const sc = S.data.case.scene;
  if (!sc) return bubble(`<p class="h">Where did it happen?</p><p>Type the CrimeWatch case number, like <span class="chip" data-cmd="case:26-041483">26-041483</span>, or click the map at the spot.</p>`);
  const title = [sc.casenumber ? `Case ${sc.casenumber}` : "Case location", niceType(sc)].filter(Boolean).join(" · ");
  return bubble(`<p class="h">${esc(title)}</p><p>${esc(titleCase(sc.address) || "Pinned location")}${sc.when ? ` · ${esc(fmtWhen(sc.when))}` : ""}</p>
    <p class="meta">${sc.source === "Oakland CrimeWatch" ? "From Oakland CrimeWatch. Block address, accurate to about 100 m." : "Placed on the map."}</p>`);
}

function itemNote(i) {
  const bits = [];
  if (i.faces_scene === true) bits.push("Faces the scene.");
  if (i.deadline) bits.push(`Kept until ${fmtDate(i.deadline)} (${daysLeft(i.deadline)}).`);
  bits.push(i.action);
  return bits.join(" ");
}

function canvassCard() {
  if (!S.data.case.scene) return "";
  if (S.canvassError) return bubble(`<p class="h">Where to look</p><p class="meta">${esc(S.canvassError)}</p>`);
  if (!S.canvass) return bubble(`<p class="meta">Looking for cameras around the scene…</p>`);
  const c = S.canvass.counts;
  const items = S.canvass.items;
  const soon = items.filter((i) => i.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
  return bubble(`<p class="h">Where to look</p>
    <p>Within ${S.canvass.radius_m} m I found <b>${plural(c.video_camera, "video camera")}</b>, <b>${plural(c.plate_reader, "plate reader")}</b> and <b>${plural(c.likely_camera_place, "place")}</b> likely to have a camera.</p>
    ${soon ? `<p class="alert">Oakland police plate reads here are kept until <b>${esc(fmtDate(soon.deadline))}</b>: ${esc(daysLeft(soon.deadline))}.</p>` : ""}
    <ol class="places">${items.slice(0, 5).map((i) => `<li data-item="${esc(i.id)}"><span class="dot k-${i.kind}"></span><div><b>${esc(i.name)}</b> <span class="meta">${i.distance_m} m · ${esc(i.label)}${i.operator && i.kind !== "likely_camera_place" ? ` · ${esc(i.operator)}` : ""}</span><div class="meta">${esc(itemNote(i))}</div></div></li>`).join("")}</ol>
    <div class="row">${btn("Draft preservation requests", "drafts", true)}${btn("Plan the pickup route", "pickup")}${btn("Show all on the map", "view:map")}</div>
    <p class="meta">Cameras from OpenStreetMap (${esc((S.canvass.osm_base || "").slice(0, 10))}). Places are likely, not confirmed, cameras. Cameras in OPD's private registry are not included.</p>`);
}

function draftsCard() {
  if (!S.drafts) return "";
  return bubble(`<p class="h">Preservation requests</p><p>I drafted ${plural(S.drafts.length, "request")}. Nothing has been sent.</p>
    ${S.drafts.slice(0, 3).map((d, n) => `<details${n === 0 ? " open" : ""}><summary>${esc(d.to)}</summary><pre class="draft">${esc(d.text)}</pre><button class="link" data-copy="${n}" type="button">Copy</button></details>`).join("")}
    <p class="meta">All drafts are in the case file.</p>`);
}

function pickupCard() {
  if (!S.pickup || !S.canvass) return "";
  const byId = Object.fromEntries(S.canvass.items.map((i) => [i.id, i]));
  const order = S.canvass.pickup.order.map((id) => byId[id]);
  if (!order.length) return bubble(`<p class="meta">No places to visit within ${S.canvass.radius_m} m.</p>`);
  return bubble(`<p class="h">Pickup route</p><p>For a technician, nearest first. About ${(S.canvass.pickup.walk_m / 1000).toFixed(1)} km on foot.</p>
    <ol class="places">${order.map((i) => `<li data-item="${esc(i.id)}"><span class="dot k-${i.kind}"></span><div><b>${esc(i.name)}</b> <span class="meta">${i.distance_m} m from the scene</span></div></li>`).join("")}</ol>`);
}

function exampleNote(s) { return S.data.case.scene && String(s.origin || "").startsWith("UCF-Crime") ? "Example footage (public research video), not from this case." : ""; }

function footageCard() {
  const srcs = S.data.case.sources;
  if (!srcs.length) return bubble(`<p class="h">Footage</p><p>When footage comes in, add it and I'll watch it: store recorder exports, doorbell clips, city cameras.</p><div class="row">${btn("Add a video file", "addfile", true)}${btn("Public research library", "library")}</div>`);
  return bubble(`<p class="h">Footage</p>${srcs.map((s) => {
    const pct = Math.round((s.progress || 0) * 100);
    const status = s.status === "done" ? `Watched ${dur(s.duration)} of footage in ${Math.round(s.watch_seconds)} s.`
      : s.status === "watching" ? `Watching… ${pct}%` : s.status === "error" ? `<span style="color:var(--bad)">${esc(s.error || "Watching failed")}</span>` : "Not watched yet.";
    const action = s.status === "watching" ? `<div class="bar"><i style="width:${pct}%"></i></div>` : btn(s.status === "done" ? "Watch again" : s.status === "error" ? "Try again" : "Watch it", `watch:${s.sid}`, s.status !== "done");
    return `<div class="src-row"><img src="${stillUrl(s.sid, Math.min(s.duration * 0.25, 10))}" data-cmd="play:${s.sid}|0" alt=""><div style="flex:1"><b>${esc(s.camera)}</b> <span class="meta">${dur(s.duration)} · ${s.width}×${s.height}</span>
      <div class="meta"><span class="sealed" title="SHA-256 ${esc(s.sha256)}">Sealed ${esc(s.sha256.slice(0, 10))}…</span>${exampleNote(s) ? ` · <b>${esc(exampleNote(s))}</b>` : ""}</div><div class="meta">${status}</div>${action}</div></div>`;
  }).join("")}${S.data.case.tracking_error ? `<p class="flag">${esc(S.data.case.tracking_error)}</p>` : ""}<div class="row">${btn("Add another file", "addfile")}${btn("Public research library", "library")}</div>`);
}

function personBox(sid, label, t) {
  const tr = S.tracks[sid];
  const p = tr && tr.people.find((x) => x.label === label);
  if (!p) return null;
  for (const tid of p.tracks) {
    const pts = tr.tracks[String(tid)] || [];
    let best = null;
    for (const q of pts) if (!best || Math.abs(q[0] - t) < Math.abs(best[0] - t)) best = q;
    if (best && Math.abs(best[0] - t) <= 0.35) return best.slice(1, 5);
  }
  return null;
}

function keyCard() {
  const km = S.data.case.key_moment;
  if (!km) return "";
  const f = S.data.findings.find((x) => x.key && x.sid === km.sid);
  const src = source(km.sid) || { width: 0, height: 0 };
  const boxes = [personBox(km.sid, km.person, km.t), personBox(km.sid, km.target, km.t)].filter(Boolean);
  const zoom = boxes.length ? cropUrl(km.sid, km.t, [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))], 480) : null;
  return bubble(`<p class="h">Key moment · ${tfmt(km.t)}</p>
    <div class="key"><img src="${stillUrl(km.sid, km.t)}" data-seek="${km.sid}|${km.t}" alt="">${zoom ? `<img class="zoom" src="${zoom}" data-seek="${km.sid}|${km.t}" alt="">` : ""}</div>
    <p>${esc(f ? f.text : km.text)}</p>${flagLine(f || km)}
    ${km.looks_like && km.looks_like !== "none" ? `<p><span class="tag">Looks like a ${esc(km.looks_like)}</span> <span class="meta">${esc(km.confidence)} confidence. The model's reading of a ${src.width}×${src.height} frame: check it by eye.</span></p>` : ""}
    ${f ? decideRow(f) : ""}
    <div class="row">${btn("Play from 2 s before", `play:${km.sid}|${Math.max(0, km.t - 2)}`)}${btn("Look closer", `closer:${km.sid}|${km.t}`)}</div>`);
}

function decideRow(f) {
  if (f.state !== "proposed" && !S.changing.has(f.id)) return `<p><span class="state ${f.state}">${f.state === "rejected" ? "Marked wrong" : "Confirmed"}</span> <span class="meta">by ${esc(f.decided_by || "")}${f.reason ? `: ${esc(f.reason)}` : ""}</span> · <button class="link" data-change="${f.id}" type="button">Change</button></p>`;
  return `<div class="row"><button class="btn small" data-decide="accepted" data-fid="${f.id}" type="button">Confirm</button><button class="btn small ghost" data-decide="rejected" data-fid="${f.id}" type="button">Wrong</button><button class="btn small ghost" data-decide="edited" data-fid="${f.id}" type="button">Edit</button></div>`;
}

function decideMini(f) {
  if (f.state !== "proposed" && !S.changing.has(f.id)) return `<span class="state ${f.state}">${f.state === "rejected" ? "Wrong" : "Confirmed"}</span> · <button class="link" data-change="${f.id}" type="button">Change</button>`;
  return `<button class="link" data-decide="accepted" data-fid="${f.id}" type="button">Confirm</button> · <button class="link" data-decide="rejected" data-fid="${f.id}" type="button">Wrong</button> · <button class="link" data-decide="edited" data-fid="${f.id}" type="button">Edit</button>`;
}

function peopleCard() {
  const ppl = (S.data.case.people || []).filter((p) => p.best && p.tracks);
  if (!ppl.length) return "";
  return bubble(`<p class="h">${ppl.length === 1 ? "1 person" : `${ppl.length} people`} tracked</p>
    <p class="meta">Each keeps one label, even when they leave the frame or are hidden. Described by clothing only; no one is identified.</p>
    <div class="people">${ppl.map((p) => {
      const f = S.data.findings.find((x) => x.kind === "person" && x.sid === p.sid && x.label === p.label);
      const b = p.best;
      return `<div class="person ${S.selPerson === `${p.sid}|${p.label}` ? "on" : ""}" data-person="${p.sid}|${esc(p.label)}">
        <img src="${cropUrl(p.sid, b[0], b.slice(1, 5), 200)}" alt="">
        <div><span class="pl" style="--c:${colorFor(p.letter)}">${esc(p.letter)}</span><b>${esc(p.label)}</b> <span class="meta">${tfmt(p.first_seen)}–${tfmt(p.last_seen)}</span></div>
        <div class="desc">${esc(p.description)}</div>${flagLine(f)}${f ? `<div class="mini">${decideMini(f)}</div>` : ""}</div>`;
    }).join("")}</div>`);
}

function happenedCard() {
  const fs = S.data.findings.filter((f) => f.kind === "moment" && !f.key).sort((a, b) => a.t - b.t);
  if (!fs.length) return "";
  return bubble(`<p class="h">What happened</p><ul class="steps">${fs.map((f) => `<li><span class="chip" data-seek="${f.sid}|${f.t}">${tfmt(f.t)}</span><div>${esc(f.text)}${f.event ? ` <span class="tag small">${esc(EVENT_NAME[f.event] || f.event)}</span>` : ""}
    ${(f.flags || []).length ? `<div class="flag">Needs rewording: ${f.flags.map(esc).join(", ")}</div>` : ""}<div class="mini">${decideMini(f)}</div></div></li>`).join("")}</ul>`);
}

function otherCard() {
  const tracked = new Set((S.data.case.people || []).filter((p) => p.tracks).map((p) => `${p.sid}|${p.label}`));
  const fs = S.data.findings.filter((f) => (f.kind === "person" || f.kind === "vehicle") && !tracked.has(`${f.sid}|${f.label}`));
  if (!fs.length) return "";
  return bubble(`<p class="h">People and vehicles from the notes</p><p class="meta">Not tracked frame by frame; described from the notes. Check each one.</p>
    <ul class="steps">${fs.map((f) => `<li><span class="chip" data-seek="${f.sid}|${f.t}">${tfmt(f.t)}</span><div><b>${esc(f.label || f.kind)}</b> ${esc(f.text.replace(`${f.label}: `, ""))}${flagLine(f)}<div class="mini">${decideMini(f)}</div></div></li>`).join("")}</ul>`);
}

function gapsCard() {
  const gaps = S.data.case.gaps || [];
  if (!gaps.length) return "";
  return bubble(`<p class="h">What the footage doesn't show</p><ul class="steps">${gaps.map((g) => `<li><div>${esc(g.text)}</div></li>`).join("")}</ul>`);
}

function chatCards() {
  return S.chat.map((m) => {
    if (m.kind === "q") return `<div class="msg me"><div class="me-bubble">${esc(m.text)}</div></div>`;
    if (m.kind === "note") return bubble(`<p>${esc(m.text)}</p>`);
    if (m.kind === "a") {
      const a = m.answer;
      return bubble(`<p>${esc(a.answer)}</p><div>${(a.citations || []).map((c) => `<span class="chip" data-seek="${c.sid}|${c.t}">${esc(source(c.sid)?.camera || c.sid)} ${tfmt(c.t)}</span>`).join(" ")}</div>
        <div class="stills">${(a.citations || []).slice(0, 3).map((c) => `<img src="${stillUrl(c.sid, c.t)}" data-seek="${c.sid}|${c.t}" alt="">`).join("")}</div>
        ${(a.flags || []).length ? `<div class="flag">Check the wording: ${a.flags.map(esc).join(", ")}</div>` : ""}<p class="meta">Model confidence: ${esc(a.confidence)}</p>`);
    }
    if (m.kind === "closer") return bubble(`<p class="h">Closer look · ${tfmt(m.t0)}–${tfmt(m.t1)}, 4 frames a second</p><ul class="steps">${m.notes.filter((n) => n.kind !== "scene").map((n) => `<li><span class="chip" data-seek="${m.sid}|${n.t_start}">${tfmt(n.t_start)}</span><div>${esc(n.text)} <span class="meta">(${esc(n.confidence)})</span></div></li>`).join("") || "<li class='meta'>Nothing more to see here.</li>"}</ul>`);
    if (m.kind === "mm") {
      const r = m.result;
      const item = (x) => `<li><div><b>Statement:</b> ${esc(x.claim)}<br><b>Video:</b> ${esc(x.video)} ${(x.frames || []).slice(0, 3).map((t) => `<span class="chip" data-seek="${x.sid}|${t}">${tfmt(t)}</span>`).join(" ")}</div></li>`;
      return bubble(`<p class="h">Statement vs video</p><p class="meta">Differs (${r.disagrees.length})</p><ul class="steps">${r.disagrees.map(item).join("") || "<li class='meta'>Nothing found.</li>"}</ul>
        <p class="meta">Agrees (${r.agrees.length})</p><ul class="steps">${r.agrees.map(item).join("")}</ul>
        <p class="meta">Video cannot show (${r.cannot_show.length})</p><ul class="steps">${r.cannot_show.map((x) => `<li><div>${esc(x.claim)} <span class="meta">— ${esc(x.why)}</span></div></li>`).join("")}</ul>`);
    }
    return "";
  }).join("");
}

function renderFeed() {
  const atBottom = $("#feed").scrollHeight - $("#feed").scrollTop - $("#feed").clientHeight < 40;
  $("#feed").innerHTML = [sceneCard(), canvassCard(), draftsCard(), pickupCard(), footageCard(), keyCard(), peopleCard(), otherCard(), happenedCard(), gapsCard(), chatCards()].join("");
  if (atBottom) scrollFeed();
}
function scrollFeed() { $("#feed").scrollTop = $("#feed").scrollHeight; }

function suggestions() {
  const c = S.data?.case;
  if (!c) return [];
  if (!c.scene) return [["Try case 26-041483", "case:26-041483"]];
  if (!c.sources.some((s) => s.status === "done")) return [["Draft preservation requests", "drafts"], ["Plan the pickup route", "pickup"], ["Add footage", "addfile"]];
  if (STATIC) return [...STATIC.questions(S.cid).map((q) => [q.label, `ask:${q.question}`]), ["Make the lookout sheet", "lookout"]];
  const who = c.key_moment?.person || c.people?.[0]?.label || "the person";
  return [["When was the weapon first visible?", "ask:When was an object first visible, and when was it pointed at someone?"],
    [`Where did ${who} go?`, `ask:Where did ${who} go after the key moment, and which way did they leave?`],
    ["Compare with a statement", "compare"], ["Make the lookout sheet", "lookout"]];
}
function renderSuggest() { $("#suggest").innerHTML = suggestions().map(([label, cmd]) => `<button data-cmd="${esc(cmd)}" type="button">${esc(label)}</button>`).join(""); }

// ---------- map ----------
let map = null, mapLoaded = false;
const fc = (features) => ({ type: "FeatureCollection", features });
const pointF = (lon, lat, props) => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [lon, lat] } });
const polyF = (ring, props) => ({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [ring] } });
const lineF = (coords) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } });
const offset = (lat, lon, north, east) => [lon + east / (111320 * Math.cos((lat * Math.PI) / 180)), lat + north / 111320];
function circleRing(lat, lon, r, n = 64) { const out = []; for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; out.push(offset(lat, lon, r * Math.cos(a), r * Math.sin(a))); } return out; }
function wedge(lat, lon, centre, half, len = 70) {
  const out = [[lon, lat]];
  const step = Math.max(4, half / 6);
  for (let a = centre - half; a <= centre + half + 0.01; a += step) { const r = (a * Math.PI) / 180; out.push(offset(lat, lon, len * Math.cos(r), len * Math.sin(r))); }
  out.push([lon, lat]);
  return out;
}

function initMap() {
  if (map || !window.maplibregl) return;
  map = new maplibregl.Map({ container: "map", style: "https://tiles.openfreemap.org/styles/positron", center: [-122.2712, 37.8044], zoom: 13, attributionControl: false });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.on("load", () => {
    map.addLayer({ id: "orbit-buildings-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 14,
      paint: { "fill-extrusion-color": "#E6E1D3", "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6], "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0], "fill-extrusion-opacity": 0.85 } });
    for (const id of ["scene", "items", "cones", "pickup"]) map.addSource(id, { type: "geojson", data: fc([]) });
    map.addLayer({ id: "cones", type: "fill", source: "cones", paint: { "fill-color": ["match", ["get", "kind"], "video_camera", KIND_COLOR.video_camera, "plate_reader", KIND_COLOR.plate_reader, "#8C8B85"], "fill-opacity": 0.22 } });
    map.addLayer({ id: "scene-area", type: "fill", source: "scene", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#C4603C", "fill-opacity": 0.16 } });
    map.addLayer({ id: "scene-edge", type: "line", source: "scene", filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-color": "#C4603C", "line-width": 1.5, "line-dasharray": [2, 2] } });
    map.addLayer({ id: "pickup", type: "line", source: "pickup", paint: { "line-color": "#141413", "line-width": 2.5, "line-dasharray": [1.5, 1.2] } });
    map.addLayer({ id: "items", type: "circle", source: "items", paint: { "circle-radius": ["case", ["!=", ["get", "rank"], ""], 10, 6], "circle-color": ["match", ["get", "kind"], "video_camera", KIND_COLOR.video_camera, "plate_reader", KIND_COLOR.plate_reader, "gunshot_detector", KIND_COLOR.gunshot_detector, KIND_COLOR.likely_camera_place], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    map.addLayer({ id: "ranks", type: "symbol", source: "items", filter: ["!=", ["get", "rank"], ""], layout: { "text-field": ["get", "rank"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-allow-overlap": true }, paint: { "text-color": "#fff" } });
    map.addLayer({ id: "scene-dot", type: "circle", source: "scene", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 8, "circle-color": "#C4603C", "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
    map.on("click", "items", (e) => showItem(e.features[0].properties.id, e.lngLat));
    map.on("mouseenter", "items", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "items", () => { map.getCanvas().style.cursor = ""; });
    map.on("click", (e) => {
      if (S.data && !S.data.case.scene && !map.queryRenderedFeatures(e.point, { layers: ["items"] }).length) setSceneAt(e.lngLat);
    });
    mapLoaded = true;
    updateMap();
  });
}

function showItem(id, lngLat) {
  const i = S.canvass?.items.find((x) => x.id === id);
  if (!i || !map) return;
  new maplibregl.Popup({ closeButton: true }).setLngLat(lngLat || [i.lon, i.lat])
    .setHTML(`<b>${esc(i.name)}</b><br><span class="meta">${esc(i.label)}${i.operator ? ` · ${esc(i.operator)}` : ""} · ${i.distance_m} m</span><br>${i.faces_scene === true ? "Faces the scene.<br>" : i.faces_scene === false ? "Faces away from the scene.<br>" : ""}${esc(i.deadline ? `Kept until ${fmtDate(i.deadline)}.` : i.retention_note)}<br>${esc(i.action)}<br><a href="${esc(i.osm)}" target="_blank">OpenStreetMap record</a>`)
    .addTo(map);
}

function updateMap() {
  if (!mapLoaded || !S.data) return;
  const sc = S.data.case.scene;
  const items = S.canvass?.items || [];
  map.getSource("scene").setData(sc ? fc([polyF(circleRing(sc.lat, sc.lon, Math.max(sc.accuracy_m || 0, 25)), {}), pointF(sc.lon, sc.lat, {})]) : fc([]));
  map.getSource("items").setData(fc(items.map((i, n) => pointF(i.lon, i.lat, { id: i.id, kind: i.kind, rank: n < 5 ? String(n + 1) : "" }))));
  map.getSource("cones").setData(fc(items.flatMap((i) => (i.arcs || []).map(([c, h]) => polyF(wedge(i.lat, i.lon, c, h), { kind: i.kind })))));
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const order = S.pickup && S.canvass ? S.canvass.pickup.order.filter((id) => byId[id]) : [];
  map.getSource("pickup").setData(fc(sc && order.length ? [lineF([[sc.lon, sc.lat], ...order.map((id) => [byId[id].lon, byId[id].lat])])] : []));
  $("#mapEmpty").classList.toggle("hidden", !!sc);
  const key = sc ? `${S.cid}|${sc.lat}|${sc.lon}` : null;
  if (sc && S.flown !== key && S.view === "map") {
    S.flown = key;
    map.flyTo({ center: [sc.lon, sc.lat], zoom: 16.6, pitch: 58, bearing: -28, duration: 2200 });
  }
}

async function setSceneAt(lngLat) {
  if (!confirm("Set the case location here?")) return;
  try {
    await api(`/api/cases/${S.cid}/scene`, { json: { lat: lngLat.lat, lon: lngLat.lng, address: "" } });
    S.canvass = null;
    await refresh();
  } catch (err) { toast(err.message); }
}

async function setScene(num) {
  try {
    await api(`/api/cases/${S.cid}/scene`, { json: { casenumber: num } });
    S.canvass = null; S.drafts = null; S.pickup = false; S.flown = null;
    setView("map");
    await refresh();
  } catch (err) { S.chat.push({ kind: "note", text: err.message }); saveChat(); renderFeed(); }
  scrollFeed();
}

// ---------- footage ----------
function setView(v) {
  S.view = v;
  document.querySelectorAll("#seg button").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  $("#mapView").classList.toggle("on", v === "map");
  $("#videoView").classList.toggle("on", v === "video");
  if (v === "map") { initMap(); setTimeout(() => { if (map) { map.resize(); updateMap(); } }, 50); }
  else drawOverlay();
}

function selectSource(sid, t) {
  if (!source(sid)) return;
  const changed = S.sid !== sid;
  S.sid = sid;
  const v = $("#player");
  if (changed) v.src = STATIC ? STATIC.video(S.cid, sid) : `/api/cases/${S.cid}/sources/${sid}/video`;
  if (t !== undefined) {
    const go = () => { v.currentTime = Number(t); drawOverlay(); };
    if (!changed && v.readyState >= 1) go(); else v.addEventListener("loadedmetadata", go, { once: true });
  }
  renderChips(); renderPlayer(); renderTimeline();
}

function renderPlayer() {
  const s = source(S.sid);
  $("#playerEmpty").classList.toggle("hidden", !!s);
  $("#player").classList.toggle("hidden", !s);
  $("#exampleTag").classList.toggle("hidden", !(s && exampleNote(s)));
}

function seek(sid, t, play = false) {
  setView("video");
  selectSource(sid, t);
  if (play) $("#player").play().catch(() => {});
}

function drawOverlay() {
  const v = $("#player"), cv = $("#overlay");
  const rect = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(rect.width * dpr); cv.height = Math.round(rect.height * dpr);
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const tr = S.tracks[S.sid];
  if (!tr || !tr.people.length || !v.videoWidth || S.view !== "video") return;
  const scale = Math.min(rect.width / v.videoWidth, rect.height / v.videoHeight);
  const ox = (rect.width - v.videoWidth * scale) / 2, oy = (rect.height - v.videoHeight * scale) / 2;
  for (const p of tr.people) {
    const b = personBox(S.sid, p.label, v.currentTime);
    if (!b) continue;
    const sel = S.selPerson === `${S.sid}|${p.label}`;
    ctx.globalAlpha = S.selPerson && !sel ? 0.35 : 1;
    ctx.strokeStyle = colorFor(p.letter);
    ctx.lineWidth = sel ? 3 : 1.5;
    const x = ox + b[0] * scale, y = oy + b[1] * scale, w = (b[2] - b[0]) * scale, h = (b[3] - b[1]) * scale;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = colorFor(p.letter);
    ctx.fillRect(x, Math.max(0, y - 16), sel ? 76 : 18, 16);
    ctx.fillStyle = "#141413";
    ctx.font = "600 11px Figtree, sans-serif";
    ctx.fillText(sel ? p.label : p.letter, x + 4, Math.max(12, y - 4));
  }
  ctx.globalAlpha = 1;
}

let raf = null;
function loop() { drawOverlay(); updatePlayhead(); raf = $("#player").paused ? null : requestAnimationFrame(loop); }
$("#player").addEventListener("play", () => { if (!raf) loop(); });
$("#player").addEventListener("timeupdate", () => { drawOverlay(); updatePlayhead(); });
$("#player").addEventListener("loadedmetadata", drawOverlay);
window.addEventListener("resize", drawOverlay);

function updatePlayhead() {
  const s = source(S.sid);
  if (!s) return;
  document.querySelectorAll(".playhead").forEach((ph) => { ph.style.left = `${Math.min(100, ($("#player").currentTime / s.duration) * 100)}%`; });
}

function renderTimeline() {
  const s = source(S.sid);
  if (!s) { $("#timeline").innerHTML = `<p class="empty">The timeline appears when footage is added.</p>`; return; }
  const pct = (t) => `${Math.min(100, (t / s.duration) * 100)}%`;
  const evs = (S.data.case.events || []).filter((e) => e.sid === s.sid);
  const km = S.data.case.key_moment;
  const notes = (S.data.notes[s.sid] || []).filter((n) => n.kind !== "scene");
  const tr = S.tracks[s.sid] || { people: [], tracks: {} };
  const lanes = [`<div class="lane"><div class="lname">Events</div><div class="track" data-sid="${s.sid}">
      ${notes.map((n) => `<div class="mk" style="left:${pct(n.t_start)}" title="${esc(`${tfmt(n.t_start)} ${n.text}`)}"></div>`).join("")}
      ${evs.map((e) => `<div class="ev ${km && km.sid === s.sid && km.t === e.t && km.kind === e.kind ? "key" : ""}" style="left:${pct(e.t)}" data-seek="${s.sid}|${e.t}" title="${esc(`${tfmt(e.t)} ${EVENT_NAME[e.kind] || e.kind}: ${e.text}`)}"></div>`).join("")}
      <div class="playhead"></div></div></div>`];
  for (const p of tr.people) {
    const segs = p.tracks.map((tid) => tr.tracks[String(tid)] || []).filter((pts) => pts.length).map((pts) => [pts[0][0], pts[pts.length - 1][0]]);
    lanes.push(`<div class="lane"><div class="lname"><i style="background:${colorFor(p.letter)}"></i>${esc(p.label)}</div><div class="track" data-sid="${s.sid}" data-person="${s.sid}|${esc(p.label)}">
      ${segs.map(([a, b]) => `<div class="seg-bar" style="left:${pct(a)};width:${Math.max(0.6, ((b - a) / s.duration) * 100)}%;background:${colorFor(p.letter)}"></div>`).join("")}
      <div class="playhead"></div></div></div>`);
  }
  $("#timeline").innerHTML = lanes.join("") + `<div class="axis"><div></div><div><span>0:00</span><span>${dur(s.duration / 2)}</span><span>${dur(s.duration)}</span></div></div>`;
  updatePlayhead();
}

$("#timeline").addEventListener("click", (e) => {
  if (e.target.closest("[data-seek]")) return;
  const tr = e.target.closest(".track");
  if (!tr) return;
  const s = source(tr.dataset.sid);
  const r = tr.getBoundingClientRect();
  if (tr.dataset.person) S.selPerson = tr.dataset.person;
  seek(tr.dataset.sid, ((e.clientX - r.left) / r.width) * s.duration);
  renderFeed();
});

// ---------- decisions ----------
function who() {
  if (S.reviewer) return Promise.resolve(S.reviewer);
  const known = saved("orbit.reviewer");
  if (known) { S.reviewer = known; return Promise.resolve(known); }
  return new Promise((resolve) => {
    $("#whoDlg").showModal();
    $("#whoForm").onsubmit = (e) => {
      e.preventDefault();
      S.reviewer = $("#whoName").value.trim();
      saved("orbit.reviewer", S.reviewer);
      $("#whoDlg").close();
      resolve(S.reviewer);
    };
  });
}

async function send(fid, body) {
  try { await api(`/api/cases/${S.cid}/findings/${fid}/decide`, { json: body }); await refresh(); }
  catch (err) { toast(err.message); }
}

async function decide(fid, decision) {
  const reviewer = await who();
  if (!reviewer) return;
  if (decision === "accepted") return send(fid, { decision, reviewer });
  const f = S.data.findings.find((x) => x.id === fid);
  $("#dTitle").textContent = decision === "rejected" ? "Mark as wrong" : "Edit";
  $("#dLabel").textContent = decision === "rejected" ? "What is wrong? This goes in the log and the DA packet." : "Write it the way you would put it in the report.";
  $("#dText").value = decision === "edited" ? f.text : "";
  $("#decideDlg").showModal();
  $("#decideForm").onsubmit = async (e) => {
    e.preventDefault();
    const text = $("#dText").value.trim();
    $("#decideDlg").close();
    await send(fid, decision === "rejected" ? { decision, reviewer, reason: text } : { decision, reviewer, text });
  };
}

// ---------- commands ----------
async function ask(q) {
  S.chat.push({ kind: "q", text: q });
  saveChat(); renderFeed(); scrollFeed();
  try {
    const a = await api(`/api/cases/${S.cid}/ask`, { json: { question: q } });
    S.chat.push({ kind: "a", answer: a });
  } catch (err) { S.chat.push({ kind: "note", text: err.message }); }
  saveChat(); renderFeed(); scrollFeed();
}

async function lookCloser(sid, t) {
  const t0 = Math.max(0, t - 2), t1 = t + 6;
  S.chat.push({ kind: "note", text: `Looking closer at ${tfmt(t0)}–${tfmt(t1)}, 4 frames a second…` });
  renderFeed(); scrollFeed();
  try {
    const r = await api(`/api/cases/${S.cid}/sources/${sid}/closer`, { json: { t0, t1 } });
    S.chat.pop();
    S.chat.push({ kind: "closer", sid, t0, t1, notes: r.notes });
    (S.data.notes[sid] ||= []).push(...r.notes);
  } catch (err) { S.chat.pop(); S.chat.push({ kind: "note", text: err.message }); }
  saveChat(); renderFeed(); renderTimeline(); scrollFeed();
}

async function loadDrafts() {
  try {
    S.drafts = (await api(`/api/cases/${S.cid}/requests?radius=400`)).drafts;
    renderFeed(); renderDrawer(); scrollFeed();
  } catch (err) { toast(err.message); }
}

async function run(cmd) {
  const [name, ...rest] = cmd.split(":");
  const arg = rest.join(":");
  if (name === "case") return setScene(arg);
  if (name === "view") return setView(arg);
  if (name === "drafts") return loadDrafts();
  if (name === "pickup") { S.pickup = true; setView("map"); updateMap(); renderFeed(); return scrollFeed(); }
  if (name === "addfile") { typeOptions($("#fType"), "business_recorder"); return $("#fileDlg").showModal(); }
  if (name === "library") { $("#libDlg").showModal(); return loadLibrary("Robbery"); }
  if (name === "watch") {
    try { await api(`/api/cases/${S.cid}/sources/${arg}/watch`, { method: "POST" }); const s = source(arg); s.status = "watching"; s.progress = 0; S.data.notes[arg] = []; renderFeed(); renderChips(); }
    catch (err) { toast(err.message); }
    return;
  }
  if (name === "play") { const [sid, t] = arg.split("|"); return seek(sid, Number(t), true); }
  if (name === "closer") { const [sid, t] = arg.split("|"); return lookCloser(sid, Number(t)); }
  if (name === "ask") return ask(arg);
  if (name === "compare") { $("#reportText").value = S.data.case.report_text || ""; return $("#reportDlg").showModal(); }
  if (name === "lookout") {
    if ($("#lookoutBtn").getAttribute("aria-disabled") === "true") {
      S.chat.push({ kind: "note", text: "Confirm the key moment and the people you want on the sheet first. Only confirmed items go on it." });
      saveChat(); renderFeed(); return scrollFeed();
    }
    return window.open(STATIC ? STATIC.sheet("lookout", S.data) : `/cases/${S.cid}/lookout`, "_blank");
  }
}

document.body.addEventListener("click", (e) => {
  const c = e.target.closest("[data-cmd]");
  if (c) { e.preventDefault(); return run(c.dataset.cmd); }
  const ch = e.target.closest("[data-change]");
  if (ch) { S.changing.add(ch.dataset.change); renderFeed(); return; }
  const d = e.target.closest("[data-decide]");
  if (d) { S.changing.delete(d.dataset.fid); return decide(d.dataset.fid, d.dataset.decide); }
  const s = e.target.closest("[data-seek]");
  if (s) { const [sid, t] = s.dataset.seek.split("|"); return seek(sid, Number(t)); }
  const p = e.target.closest("[data-person]");
  if (p && !e.target.closest(".track")) {
    S.selPerson = S.selPerson === p.dataset.person ? null : p.dataset.person;
    const [sid, label] = p.dataset.person.split("|");
    const person = (S.data.case.people || []).find((x) => x.sid === sid && x.label === label);
    seek(sid, person ? person.best[0] : 0);
    return renderFeed();
  }
  const it = e.target.closest("[data-item]");
  if (it && S.canvass) {
    const i = S.canvass.items.find((x) => x.id === it.dataset.item);
    setView("map");
    if (map && i) { map.flyTo({ center: [i.lon, i.lat], zoom: 17.5, pitch: 58, duration: 1200 }); showItem(i.id); }
    return;
  }
  const copy = e.target.closest("[data-copy]");
  if (copy && S.drafts) { navigator.clipboard?.writeText(S.drafts[Number(copy.dataset.copy)].text).then(() => toast("Copied.")).catch(() => toast("Copy blocked by the browser.")); }
  const f = e.target.closest("[data-src]");
  if (f) { setView("video"); selectSource(f.dataset.src); }
});

for (const [id, page] of [["#lookoutBtn", "lookout"], ["#packetBtn", "packet"]]) {
  $(id).addEventListener("click", (e) => {
    if (!STATIC) return;
    if (e.currentTarget.getAttribute("aria-disabled") === "true") return e.preventDefault();
    e.currentTarget.href = STATIC.sheet(page, S.data);
  });
}

$("#seg").addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b) setView(b.dataset.view); });

$("#askForm").onsubmit = (e) => {
  e.preventDefault();
  const q = $("#askInput").value.trim();
  if (!q || !S.cid) return;
  $("#askInput").value = "";
  const caseLike = q.match(CASE_LIKE);
  if (caseLike && STATIC && STATIC.hasCase(caseLike[2])) return openCase(caseLike[2]);
  if (caseLike) return setScene(caseLike[2]);
  if (!S.data.case.sources.some((s) => s.status === "done")) {
    S.chat.push({ kind: "q", text: q }, { kind: "note", text: "Add footage and let me watch it first; then I can answer questions about it." });
    saveChat(); renderFeed(); return scrollFeed();
  }
  ask(q);
};

$("#reportForm").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("#reportText").value.trim();
  $("#reportDlg").close();
  if (!text) return;
  S.chat.push({ kind: "q", text: `Compare: ${text}` });
  saveChat(); renderFeed(); scrollFeed();
  try {
    await api(`/api/cases/${S.cid}/report`, { method: "PUT", json: { text } });
    const result = await api(`/api/cases/${S.cid}/mismatch`, { method: "POST" });
    S.chat.push({ kind: "mm", result });
  } catch (err) { S.chat.push({ kind: "note", text: err.message }); }
  saveChat(); await refresh(); scrollFeed();
};

// ---------- case file drawer ----------
function renderDrawer() {
  if (!S.data) return;
  const c = S.data.case;
  const ok = S.data.findings.filter((f) => f.state === "accepted" || f.state === "edited");
  const collect = c.collect || [];
  $("#drawerBody").innerHTML = `
    <h3>Confirmed (${ok.length})</h3>${ok.map((f) => `<div class="steps"><li><span class="chip" data-seek="${f.sid}|${f.t}">${tfmt(f.t)}</span><div>${esc(f.text)}${flagLine(f)}</div></li></div>`).join("") || `<p class="meta">Nothing confirmed yet. Only confirmed items go on the lookout sheet and in the DA packet.</p>`}
    <h3>Preservation requests</h3>${S.drafts ? S.drafts.map((d, n) => `<details><summary>${esc(d.to)}</summary><pre class="draft">${esc(d.text)}</pre><button class="link" data-copy="${n}" type="button">Copy</button></details>`).join("") : `<p class="meta">${c.scene ? `<button class="link" data-cmd="drafts" type="button">Draft them</button> from the where-to-look list.` : "Set the case location first."}</p>`}
    <h3>Footage</h3>${c.sources.map((s) => `<p><b>${esc(s.camera)}</b> <span class="meta">${dur(s.duration)} · ${esc(S.data.source_types[s.source_type] || s.source_type)} · SHA-256 ${esc(s.sha256.slice(0, 16))}…</span>${exampleNote(s) ? `<br><b>${esc(exampleNote(s))}</b>` : ""}</p>`).join("") || `<p class="meta">None yet.</p>`}
    <div class="row">${btn("Add file", "addfile")}${btn("Public research library", "library")}</div>
    <h3>Still to collect</h3>
    ${collect.map((it) => `<label class="collect-item ${it.done ? "done" : ""}"><input type="checkbox" data-collect="${it.id}" ${it.done ? "checked" : ""}><span><span class="cname">${esc(it.camera)}</span><br>${it.delete_by ? `<span class="due">Deleted after ${esc(it.delete_by)}</span>` : it.retention_days ? `<span class="meta">Deleted ${it.retention_days} days after the incident</span>` : `<span class="meta">Ask the owner how long it keeps video</span>`}</span></label>`).join("")}
    <form id="collectForm" class="row"><input id="collectCamera" type="text" placeholder="Camera to collect"><select id="collectType">${Object.entries(S.data.source_types).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select><button class="btn ghost small" type="submit">Add</button></form>
    <h3>Log</h3>${[...S.data.ledger].reverse().slice(0, 30).map((e) => `<p class="meta">${esc(e.at.replace("T", " ").slice(0, 16))} UTC · ${esc(e.event === "decision" ? `${e.finding}: ${e.from} → ${e.to}${e.by ? ` (${e.by})` : ""}` : e.event === "sealed" ? `Sealed ${e.sid}, SHA-256 ${e.sha256.slice(0, 12)}…` : String(e.event).replace("_", " "))}</p>`).join("")}`;
}

$("#fileBtn").onclick = () => { renderDrawer(); $("#drawer").classList.add("open"); };
$("#drawerClose").onclick = () => $("#drawer").classList.remove("open");
$("#drawerBody").addEventListener("change", async (e) => {
  const id = e.target.dataset.collect;
  if (!id) return;
  try { await api(`/api/cases/${S.cid}/collect/${id}/done`, { json: { done: e.target.checked } }); await refresh(); } catch (err) { toast(err.message); }
});
$("#drawerBody").addEventListener("submit", async (e) => {
  if (e.target.id !== "collectForm") return;
  e.preventDefault();
  const camera = $("#collectCamera").value.trim();
  if (!camera) return;
  try { await api(`/api/cases/${S.cid}/collect`, { json: { camera, source_type: $("#collectType").value } }); await refresh(); } catch (err) { toast(err.message); }
});

// ---------- dialogs: cases, files, library ----------
function typeOptions(sel, value) { sel.innerHTML = Object.entries(S.data?.source_types || {}).map(([k, v]) => `<option value="${k}" ${k === value ? "selected" : ""}>${esc(v)}</option>`).join(""); }

$("#fileForm").onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData();
  fd.append("file", $("#fFile").files[0]);
  fd.append("source_type", $("#fType").value);
  fd.append("camera", $("#fCamera").value);
  fd.append("clock_offset_s", $("#fOffset").value || "0");
  const b = e.submitter;
  b.disabled = true; b.textContent = "Sealing…";
  try {
    const s = await api(`/api/cases/${S.cid}/sources`, { method: "POST", body: fd });
    $("#fileDlg").close();
    await refresh();
    selectSource(s.sid);
  } catch (err) { toast(err.message); }
  finally { b.disabled = false; b.textContent = "Seal and add"; }
};

async function loadLibrary(cat) {
  $("#libList").innerHTML = `<p class="empty">Loading…</p>`;
  try {
    const lib = await api(`/api/library?category=${encodeURIComponent(cat)}`);
    $("#libCat").innerHTML = lib.categories.map((c) => `<option ${c === cat ? "selected" : ""}>${esc(c)}</option>`).join("");
    $("#libList").innerHTML = lib.items.map((i) => `<div class="item"><span><b>${esc(i.file.replace("_x264.mp4", ""))}</b> <span class="meta">${i.mb} MB${i.vetted ? ` · ${esc(i.vetted)}` : ""}</span></span><button class="btn small ${i.vetted ? "primary" : "ghost"}" data-pick="${esc(i.file)}" type="button">Add</button></div>`).join("");
  } catch (err) { $("#libList").innerHTML = `<p class="meta">${esc(err.message)}</p>`; }
}
$("#libCat").onchange = (e) => loadLibrary(e.target.value);
$("#libList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-pick]");
  if (!b) return;
  b.disabled = true; b.textContent = "Fetching…";
  try {
    const s = await api(`/api/cases/${S.cid}/sources/library`, { json: { file: b.dataset.pick, source_type: "business_recorder", camera: "Store camera" } });
    $("#libDlg").close();
    await refresh();
    selectSource(s.sid);
  } catch (err) { toast(err.message); b.disabled = false; b.textContent = "Add"; }
});

async function showCases() {
  const cases = await api("/api/cases");
  $("#caseList").innerHTML = cases.length ? cases.map((c) => `<div class="item"><span><b>${esc(c.title)}</b> <span class="meta">${esc(c.case_number)} · ${plural(c.sources.length, "video")}</span></span><button class="btn small" data-open="${c.id}" type="button">Open</button></div>`).join("") : `<p class="meta">No cases yet.</p>`;
  $("#caseDlg").showModal();
}
$("#caseBtn").onclick = showCases;
$("#caseList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-open]");
  if (!b) return;
  $("#caseDlg").close();
  openCase(b.dataset.open);
});
$("#caseForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const c = await api("/api/cases", { json: { title: $("#cTitle").value, case_number: $("#cNumber").value, crime_type: $("#cType").value, incident_at: $("#cWhen").value } });
    $("#caseDlg").close();
    await openCase(c.id);
    if (CASE_RE.test(c.case_number)) setScene(c.case_number);
  } catch (err) { toast(err.message); }
};
document.querySelectorAll("[data-close]").forEach((b) => { b.onclick = () => b.closest("dialog").close(); });

(async function boot() {
  initMap();
  const last = saved("orbit.case");
  if (last) {
    try { await openCase(last); return; } catch { /* the case is gone; fall through */ }
  }
  const cases = await api("/api/cases");
  if (cases.length) return openCase(cases[0].id);
  showCases();
})();
