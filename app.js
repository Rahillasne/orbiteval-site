// Sandtable · Dallas: every unit is a piece on the city. See where they are and what they're on,
// switch their station like a chess move, follow what happens, and ask Orbit.
const $ = (s) => document.querySelector(s);
// Where the live server is: the same place as the page, or the address in <meta name="sandtable-api"> when the page is
// published on its own (orbiteval.com/sandtable/ talks to the board's server on Cloud Run).
const API = document.querySelector('meta[name="sandtable-api"]')?.content || "";
const api = (path) => (API ? new URL(path, API).href : path);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const COLORS = { 1: "#FF453A", 2: "#FF9F0A", 3: "#0A84FF", 4: "#0A84FF" }; // Apple system red, orange, blue
const GRAY = "#8E8E93", BLUE = "#0A84FF";
const PRI = { 1: "Emergency", 2: "Urgent", 3: "Routine", 4: "Low" };
const KIND = { 1: "emergency", 2: "urgent", 3: "routine", 4: "low-priority" }; // "on an urgent call"
const VIEW = { pitch: 55, bearing: -18 };
// left to right roughly as the city sits on the map; Central's units also cover the Central Business District
const ORDER = ["Northwest", "North Central", "Northeast", "Central", "Southwest", "South Central", "Southeast"];
const OTHER = "Other units";
const SHORT = { "Central Business District": "CBD", [OTHER]: "Other" };
const REASONS = ["Balance the load", "Cover an emergency", "Relief for a long scene", "Cover a gap", "Special event or detail"];
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fc = (features) => ({ type: "FeatureCollection", features });
const point = (coordinates, properties = {}) => ({ type: "Feature", properties, geometry: { type: "Point", coordinates } });
const mins = (m) => (m == null ? "—" : m < 60 ? `${Math.round(m)}m` : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`);
const ago = (m) => (m < 1 ? "just now" : `${mins(m)} ago`);
const hh = (h) => `${String(h % 24).padStart(2, "0")}:00`;
const clockOf = (iso) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) : "");
const dayOf = (iso) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" }).format(new Date(iso));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const short = (d) => SHORT[d] ?? d;
const areaKey = (division) => (division === "Central Business District" ? "Central" : division);
const areasOf = (station) => (station === "Central" ? ["Central", "Central Business District"] : [station]);
const metres = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * 111320;
const narrow = () => matchMedia("(max-width: 1100px)").matches;
const phone = () => matchMedia("(max-width: 760px)").matches;

const S = {
  calls: [], board: [], units: [], stations: [], events: [], fetchedAt: null, cityUpdatedAt: null, ok: false, issue: null, watchingSince: null,
  view: "map", sel: null, tab: "units", panelOpen: false, earlierOpen: false, switches: loadSwitches(), previous: null, proposals: [],
  is3d: true, divisions: null, map: null, card: { to: null, why: REASONS[0], pick: null }, firstLoad: true, alertSeen: null,
  heat: { on: false, wd: null, h: null, cat: "all", playing: null, data: null }, story: null, pos: new Map(),
};
function load(k, d) { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; } }
function save() { try { localStorage.setItem("sandtable.switches", JSON.stringify(S.switches)); } catch { /* storage may be blocked */ } }
function loadSwitches() {
  // the CBD is no longer a station of its own: its units belong to Central. A switch left from an earlier watch
  // (over 12 hours old) is dropped, so the next shift never copies it to dispatch.
  return load("sandtable.switches", []).map((s) => ({ ...s, from: s.from && areaKey(s.from), to: areaKey(s.to) }))
    .filter((s) => s.to && s.to !== s.from && Date.now() - Date.parse(s.t) < 12 * 3600e3);
}

const unitById = (id) => S.units.find((u) => u.unit === id);
const pendingOf = (id) => S.switches.find((s) => s.unit === id);
const effectiveHome = (u) => pendingOf(u.unit)?.to ?? u.home;
// The map, the Stations panel and the cards show where units belong now; the Board is the plan, with pending switches
// already in their new column.
const realKey = (u) => u.home ?? OTHER;
const planKey = (u) => effectiveHome(u) ?? OTHER;
const stationOf = (area) => (area && area !== OTHER ? S.stations.find((s) => s.division === area) ?? null : null);
const awayFromHome = (u) => u.status === "out" && !!u.home && !!u.area && areaKey(u.area) !== u.home;
const onBoard = (u) => u.status !== "earlier"; // on a scene, or cleared one in the last hour
const onScene = (u) => `${u.sinceKnown ? "" : "≥"}${mins(u.onScene)}`;
// the server's rule: patrol call signs (A, B, C, D, E, F, OT, CE) carry their division's digit; L units work downtown;
// a unit whose every call this shift was in one other area works there
const homeWhy = (u) => (u.sign && u.home !== u.sign ? `this shift: all its calls were here; its call sign says ${u.sign}`
  : /^L\d/.test(u.unit) ? "L units work downtown (the CBD)" : `from the call sign (${/^[A-Z]{1,2}(\d)/.exec(u.unit)?.[1] ?? ""}xx)`);
// The longest time on scene; only "at least" when a unit the board didn't see arrive could have been there longer.
function longestOf(units) {
  const out = units.filter((u) => u.status === "out");
  const top = out.reduce((m, u) => ((u.onScene ?? 0) > (m?.onScene ?? -1) ? u : m), null);
  return { top, atLeast: !!top && (!top.sinceKnown || out.some((u) => !u.sinceKnown && (u.callOpen ?? 0) > top.onScene)) };
}

/* ---------------- the 3D city ---------------- */
function cityStyle() {
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      sat: { type: "raster", tiles: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 16, attribution: "Imagery: USGS The National Map" },
      omt: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#000000" } },
      { id: "sat", type: "raster", source: "sat", paint: { "raster-saturation": -0.25, "raster-brightness-max": 0.72, "raster-contrast": 0.04 } },
      { id: "road-names", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 14, layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "symbol-placement": "line" }, paint: { "text-color": "#FFFFFF", "text-halo-color": "rgba(0,0,0,0.75)", "text-halo-width": 1.2 } },
      { id: "buildings", type: "fill-extrusion", source: "omt", "source-layer": "building", minzoom: 13, paint: { "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 6], 0, "#9FB0C2", 40, "#C9D5E1", 150, "#E6EEF6"], "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6], "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0], "fill-extrusion-opacity": 0.78 } },
    ],
  };
}

// The pieces: an Apple Maps-style annotation (white rim, soft shadow) with a pawn, coloured by what the unit is on.
function pieceImage(fill, pawn = "#FFFFFF") {
  const s = 72, c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  g.shadowColor = "rgba(0,0,0,0.45)"; g.shadowBlur = 8; g.shadowOffsetY = 2;
  g.beginPath(); g.arc(36, 34, 26, 0, Math.PI * 2); g.fillStyle = "#FFFFFF"; g.fill();
  g.shadowColor = "transparent";
  g.beginPath(); g.arc(36, 34, 22.5, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
  g.fillStyle = pawn;
  g.beginPath(); g.arc(36, 24.5, 5.6, 0, Math.PI * 2); g.fill(); // head
  g.beginPath(); g.moveTo(29.5, 43); g.quadraticCurveTo(31, 31, 36, 29.5); g.quadraticCurveTo(41, 31, 42.5, 43); g.closePath(); g.fill(); // body
  g.beginPath(); g.roundRect(27, 41.5, 18, 4.5, 2); g.fill(); // base
  return { width: s, height: s, data: g.getImageData(0, 0, s, s).data };
}
// A station chip: a dark pill with the blue shield, drawn in the map under the pieces so it never hides a unit. The
// middle stretches to fit the name and count; an emergency adds a red dot at the right end.
function chipImage({ sel = false, em = false } = {}) {
  const r = 2, L = 28, M = 8, R = em ? 22 : 10, H = 26, W = L + M + R;
  const c = document.createElement("canvas");
  c.width = W * r; c.height = H * r;
  const g = c.getContext("2d");
  g.scale(r, r);
  g.beginPath(); g.roundRect(0.5, 0.5, W - 1, H - 1, 11);
  g.fillStyle = sel ? "rgba(10,132,255,0.88)" : "rgba(28,28,30,0.82)"; g.fill();
  g.strokeStyle = "rgba(255,255,255,0.16)"; g.lineWidth = 1; g.stroke();
  g.save(); g.translate(8, 5.5); g.scale(15 / 24, 15 / 24);
  g.fillStyle = sel ? "#FFFFFF" : BLUE;
  g.fill(new Path2D("M12 2 3 6v6c0 5 3.8 9.4 9 10 5.2-.6 9-5 9-10V6l-9-4Z"));
  g.restore();
  if (em) { g.beginPath(); g.arc(L + M + 10, H / 2, 4, 0, Math.PI * 2); g.fillStyle = "#FF453A"; g.fill(); }
  return [{ width: W * r, height: H * r, data: g.getImageData(0, 0, W * r, H * r).data }, { pixelRatio: r, stretchX: [[L * r, (L + M) * r]], content: [L * r, 4 * r, (L + M) * r, (H - 4) * r] }];
}
const PIECES = ["piece-sel", "piece", "piece-clear"]; // top first

async function makeMap() {
  const [city, divisions, stations] = await Promise.all(["city", "divisions", "stations"].map((f) => fetch(`data/dallas/${f}.json`).then((r) => r.json())));
  S.divisions = divisions;
  S.stations = stations;
  const map = new maplibregl.Map({ container: "map", style: cityStyle(), center: [-96.8, 32.6], zoom: 5.6, pitch: 0, maxPitch: 75, attributionControl: false, maxZoom: 18 });
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Live: City of Dallas Open Data · geocoding US Census · buildings © OpenStreetMap" }), "bottom-right");
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
  await new Promise((r) => map.on("load", r));
  try { map.setSky({ "sky-color": "#000000", "horizon-color": "#1C1C1E", "fog-color": "#000000", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.5, "fog-ground-blend": 0.3 }); } catch { /* older engines */ }
  for (const [p, color] of Object.entries(COLORS)) map.addImage(`piece-${p}`, pieceImage(color), { pixelRatio: 2 });
  map.addImage("piece-clear", pieceImage(GRAY), { pixelRatio: 2 });

  const holes = (city.geometry.type === "Polygon" ? [city.geometry.coordinates] : city.geometry.coordinates).map((p) => p[0]);
  map.addSource("mask", { type: "geojson", data: { type: "Feature", geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ...holes] } } });
  map.addLayer({ id: "mask", type: "fill", source: "mask", paint: { "fill-color": "#000000", "fill-opacity": 0.4 } }, "road-names");
  map.addSource("city", { type: "geojson", data: city });
  map.addLayer({ id: "city-line", type: "line", source: "city", paint: { "line-color": "#FFFFFF", "line-width": 1.5, "line-opacity": 0.75 } });
  map.addSource("divisions", { type: "geojson", data: divisions });
  map.addLayer({ id: "division-fill", type: "fill", source: "divisions", paint: { "fill-color": BLUE, "fill-opacity": 0 } });
  // a selected division stands out: everything outside it is dimmed, buildings too
  map.addSource("outside", { type: "geojson", data: fc([]) });
  map.addLayer({ id: "outside", type: "fill", source: "outside", paint: { "fill-color": "#000000", "fill-opacity": 0.5 } }, "city-line");
  map.addLayer({ id: "division-line", type: "line", source: "divisions", paint: { "line-color": "rgba(255,255,255,0.38)", "line-width": 1, "line-dasharray": [3, 2] } });
  map.addLayer({ id: "division-sel", type: "line", source: "divisions", filter: ["==", ["get", "name"], ""], paint: { "line-color": BLUE, "line-width": 2.5 } });

  map.addSource("history", { type: "geojson", data: fc([]) });
  map.addLayer({ id: "history", type: "heatmap", source: "history", layout: { visibility: "none" }, paint: { "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 14, 11, 24, 14, 40], "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 0.5, 11, 0.8, 14, 1.6], "heatmap-opacity": 0.78, "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(10,132,255,0)", 0.3, "rgba(10,132,255,0.35)", 0.65, "rgba(255,159,10,0.55)", 1, "rgba(255,69,58,0.8)"] } });

  // the heat map outside a selected division dims too (a heat map can't be clipped, so a second dim lies over it)
  map.addLayer({ id: "outside-heat", type: "fill", source: "outside", layout: { visibility: "none" }, paint: { "fill-color": "#000000", "fill-opacity": 0.35 } });
  map.addSource("links", { type: "geojson", data: fc([]) });
  map.addLayer({ id: "links", type: "line", source: "links", layout: { "line-cap": "round" }, paint: { "line-color": BLUE, "line-opacity": ["case", ["==", ["get", "kind"], "switch"], 1, 0.7], "line-width": ["case", ["==", ["get", "kind"], "switch"], 3, 1.5], "line-dasharray": [1, 2] } });
  map.addSource("pulse", { type: "geojson", data: fc([]) });
  map.addLayer({ id: "pulse", type: "circle", source: "pulse", paint: { "circle-radius": 24, "circle-color": "#FF453A", "circle-opacity": 0.25, "circle-stroke-width": 2, "circle-stroke-color": "#FF453A", "circle-stroke-opacity": 0.6, "circle-pitch-alignment": "map" } });
  map.addSource("ping", { type: "geojson", data: fc([]) });
  map.addLayer({ id: "ping", type: "circle", source: "ping", paint: { "circle-radius": 20, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 2.5, "circle-stroke-color": "#FFFFFF", "circle-stroke-opacity": 0, "circle-pitch-alignment": "map" } });
  map.addSource("scenes", { type: "geojson", data: fc([]) });
  // a call placed at its beat's centre: a wide hollow ring, not a dot, because the block is not known
  map.addLayer({ id: "scene-approx", type: "circle", source: "scenes", filter: ["==", ["get", "approx"], true], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 12, 15, 46], "circle-color": "rgba(255,255,255,0.06)", "circle-stroke-width": 1.5, "circle-stroke-color": "rgba(255,255,255,0.55)", "circle-stroke-opacity": ["case", ["get", "dim"], 0.3, 1], "circle-pitch-alignment": "map" } });
  map.addLayer({ id: "scene", type: "circle", source: "scenes", filter: ["!=", ["get", "approx"], true], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 7], "circle-color": ["get", "color"], "circle-opacity": ["case", ["get", "dim"], 0.3, 0.9], "circle-stroke-width": 1.5, "circle-stroke-color": "rgba(255,255,255,0.8)", "circle-stroke-opacity": ["case", ["get", "dim"], 0.3, 1], "circle-pitch-alignment": "map" } });
  // stations: the home squares, a dot at the station and a chip above it, all under the pieces
  for (const sel of [false, true]) for (const em of [false, true]) map.addImage(`chip${sel ? "-sel" : ""}${em ? "-em" : ""}`, ...chipImage({ sel, em }));
  map.addSource("stations", { type: "geojson", data: fc([]) });
  map.addLayer({ id: "station-dot", type: "circle", source: "stations", paint: { "circle-radius": 4, "circle-color": BLUE, "circle-stroke-width": 2, "circle-stroke-color": "#FFFFFF", "circle-pitch-alignment": "map" } });
  const chip = {
    "icon-image": ["get", "chip"], "icon-text-fit": "width", "icon-text-fit-padding": [0, 4, 0, 2], "icon-allow-overlap": true, "icon-ignore-placement": true, "text-allow-overlap": true, "text-ignore-placement": true,
    "text-field": ["format", ["get", "name"], { "text-font": ["literal", ["Noto Sans Bold"]] }, ["get", "count"], { "text-font": ["literal", ["Noto Sans Regular"]], "text-color": "rgba(235,235,245,0.72)" }],
    // the pill is fitted to the text and centred on it: the text sits 19 px above the station's dot
    "text-size": 12, "text-max-width": 40, "text-anchor": "center", "text-offset": [0, -1.6], "text-font": ["Noto Sans Bold"], "symbol-z-order": "source",
  };
  map.addLayer({ id: "stations", type: "symbol", source: "stations", filter: ["!=", ["get", "kind"], "hq"], layout: chip, paint: { "icon-opacity": ["case", ["get", "dim"], 0.35, 1], "text-opacity": 0 } });
  map.addLayer({ id: "hq", type: "symbol", source: "stations", minzoom: 12.5, filter: ["==", ["get", "kind"], "hq"], layout: chip, paint: { "icon-opacity": ["case", ["get", "dim"], 0.3, 0.85], "text-opacity": 0 } });

  map.addSource("pieces", { type: "geojson", data: fc([]) });
  // the selected unit keeps its colour and gets a ring
  map.addLayer({ id: "sel-ring", type: "circle", source: "pieces", filter: ["==", ["get", "id"], ""], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 15, 13, 21, 16, 28], "circle-color": "rgba(10,132,255,0.3)", "circle-stroke-width": 2.5, "circle-stroke-color": "#FFFFFF" } });
  // Three layers so the order is right both ways: cleared pawns at the bottom, units on scene above them, the selected
  // unit on top; labels are placed top layer first, so the selected unit's name always shows.
  const layout = { "icon-image": ["get", "icon"], "icon-size": ["interpolate", ["linear"], ["zoom"], 10, ["*", 0.5, ["get", "size"]], 13, ["*", 0.72, ["get", "size"]], 16, ["*", 0.95, ["get", "size"]]], "icon-allow-overlap": true, "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 15, 12], "text-offset": [0, 1.35], "text-anchor": "top", "text-optional": true };
  const paint = { "icon-opacity": ["get", "opacity"], "text-opacity": ["get", "opacity"], "text-color": "#FFFFFF", "text-halo-color": "rgba(0,0,0,0.8)", "text-halo-width": 1.4 };
  for (const id of [...PIECES].reverse()) map.addLayer({ id, type: "symbol", source: "pieces", filter: ["==", ["get", "layer"], id], layout, paint });
  // The chip's words drawn again on top of the pieces (the pill itself stays under them): the station's name always
  // reads, and since labels are placed top layer first, unit names make way for it.
  const room = { ...chip, "icon-ignore-placement": false, "text-ignore-placement": false };
  const words = { "icon-opacity": 0, "text-opacity": ["case", ["get", "dim"], 0.4, 1], "text-color": "#FFFFFF", "text-halo-color": ["case", ["get", "sel"], "rgba(10,132,255,0.9)", "rgba(28,28,30,0.95)"], "text-halo-width": 1.6 };
  map.addLayer({ id: "stations-room", type: "symbol", source: "stations", filter: ["!=", ["get", "kind"], "hq"], layout: room, paint: words });
  map.addLayer({ id: "hq-room", type: "symbol", source: "stations", minzoom: 12.5, filter: ["==", ["get", "kind"], "hq"], layout: room, paint: { ...words, "text-opacity": ["case", ["get", "dim"], 0.35, 0.85] } });

  // Hover and click share one hit test, in drawing order: on a station's line of words (drawn over the pieces) the
  // station wins; then the top piece within 10 px (a piece under the words is still reachable just above or below
  // them, or closer in); then the rest of a station chip.
  const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 16, className: "tip" });
  const near = (pt, r) => [[pt.x - r, pt.y - r], [pt.x + r, pt.y + r]];
  const pickAt = (pt) => {
    const name = map.queryRenderedFeatures(pt, { layers: ["stations-room"] }).find((f) => Math.abs(map.project(f.geometry.coordinates).y - 19 - pt.y) <= 7);
    if (name) return { station: name.properties.division };
    const ps = map.queryRenderedFeatures(near(pt, 10), { layers: PIECES });
    const hit = ps.find((f) => { const c = map.project(f.geometry.coordinates); return Math.hypot(c.x - pt.x, c.y - pt.y) <= 5; }) ?? ps[0];
    if (hit) return { unit: hit };
    const st = map.queryRenderedFeatures(near(pt, 3), { layers: ["stations"] })[0];
    return st ? { station: st.properties.division } : null;
  };
  let tipFor = null;
  map.on("mousemove", (e) => {
    const p = pickAt(e.point);
    map.getCanvas().style.cursor = p ? "pointer" : "";
    const hit = p?.unit, u = hit && unitById(hit.properties.id);
    if (!u) { tip.remove(); tipFor = null; return; }
    if (tipFor === u.unit) return;
    tipFor = u.unit;
    tip.setLngLat(hit.geometry.coordinates).setText(u.status === "out" ? `${u.unit} · ${u.call} · on scene ${onScene(u)}${u.approx ? " · location approximate" : ""}` : u.lastApprox ? `${u.unit} · cleared a call placed at its beat's centre, ${ago(u.ago)}` : `${u.unit} · cleared here ${ago(u.ago)}`).addTo(map);
  });
  map.getCanvas().addEventListener("mouseleave", () => { map.getCanvas().style.cursor = ""; tip.remove(); tipFor = null; });
  let later = null; // a click on the bare map acts after a moment, so a double-click can zoom without selecting
  map.on("dblclick", () => clearTimeout(later));
  map.on("click", (e) => {
    clearTimeout(later);
    if (e.originalEvent?.detail > 1) return;
    const p = pickAt(e.point);
    if (p?.unit) return select({ kind: "unit", id: p.unit.properties.id });
    // a station chip: its card, and the map shows its whole division
    if (p?.station) return select(S.sel?.kind === "station" && S.sel.name === p.station ? null : { kind: "station", name: p.station });
    // the bare map clears a selection (the camera stays); with nothing selected, a click inside a division picks it
    const area = map.queryRenderedFeatures(e.point, { layers: ["division-fill"] })[0];
    later = setTimeout(() => (S.sel ? select(null, { move: false }) : area && select({ kind: "station", name: areaKey(area.properties.name) })), 260);
  });
  S.map = map;
  breathe();
}

let pingAt = 0;
function breathe() {
  const map = S.map;
  const k = (Math.sin(performance.now() / 420) + 1) / 2;
  if (map?.getLayer("pulse")) {
    map.setPaintProperty("pulse", "circle-radius", 18 + 12 * k);
    map.setPaintProperty("pulse", "circle-opacity", 0.32 - 0.22 * k);
  }
  const p = (performance.now() - pingAt) / 2600; // a ring where an event happened, for a moment
  if (map?.getLayer("ping") && p <= 1.05) {
    map.setPaintProperty("ping", "circle-radius", 14 + 40 * Math.min(1, p));
    map.setPaintProperty("ping", "circle-stroke-opacity", Math.max(0, 1 - p));
  }
  requestAnimationFrame(breathe);
}
function ping(lnglat) {
  S.map?.getSource("ping")?.setData(fc([point(lnglat)]));
  pingAt = performance.now();
}

function pieceSpot(u, i, n) {
  // units at the same spot (on its scene, or cleared from it) stand in a small ring around it
  const a = (2 * Math.PI * i) / n - Math.PI / 2;
  const r = n > 1 ? 0.0011 * Math.max(1, n / 7) : 0;
  return [u.lon + Math.cos(a) * r * 1.2, u.lat + Math.sin(a) * r];
}

function drawMap() {
  const map = S.map;
  if (!map) return;
  const selUnit = S.sel?.kind === "unit" ? S.sel.id : null;
  const selStation = S.sel?.kind === "station" ? S.sel.name : null;
  const pieces = [], scenes = [], links = [];
  const selArea = selStation && selStation !== OTHER ? selStation : null;
  for (const c of S.calls) if (c.lon != null) scenes.push(point([c.lon, c.lat], { color: COLORS[c.priority] ?? COLORS[3], approx: !!c.approx, dim: !!selArea && areaKey(c.area) !== selArea }));
  const placed = S.units.filter((u) => (u.status === "out" || u.status === "cleared") && u.lon != null);
  const bySpot = new Map();
  for (const u of placed) { const k = `${u.lon.toFixed(5)},${u.lat.toFixed(5)}`; (bySpot.get(k) ?? bySpot.set(k, []).get(k)).push(u); }
  const pos = new Map();
  for (const [, us] of bySpot) us.sort((a, b) => (a.status === "out" ? 0 : 1) - (b.status === "out" ? 0 : 1) || a.unit.localeCompare(b.unit)).forEach((u, i) => pos.set(u.unit, pieceSpot(u, i, us.length)));
  for (const u of placed) {
    const mine = !selStation || realKey(u) === selStation || (!!selArea && u.status === "out" && areaKey(u.area) === selArea);
    const sel = u.unit === selUnit;
    const layer = sel ? "piece-sel" : u.status === "out" ? "piece" : "piece-clear";
    if (u.status === "out") pieces.push(point(pos.get(u.unit), { id: u.unit, layer, icon: `piece-${u.priority}`, label: u.approx ? `${u.unit} ≈` : u.unit, opacity: mine ? 1 : 0.3, size: sel ? 1.35 : 1 }));
    // where it cleared its last scene; fades over the hour
    else pieces.push(point(pos.get(u.unit), { id: u.unit, layer, icon: "piece-clear", label: `${u.unit}${u.lastApprox ? " ≈" : ""} · ${mins(u.ago)}`, opacity: (mine ? 1 : 0.3) * (sel ? 1 : Math.max(0.35, 1 - u.ago / 80)), size: sel ? 1.25 : 0.9 }));
  }
  // a selected station's lines to its units out on the city
  const st = stationOf(selStation);
  if (st) for (const u of S.units) if (realKey(u) === selStation && pos.has(u.unit)) links.push({ type: "Feature", properties: { kind: "home" }, geometry: { type: "LineString", coordinates: [[st.lon, st.lat], pos.get(u.unit)] } });
  // pending switches: an arc from the unit to its new station
  for (const sw of S.switches) {
    const u = sw.unit ? unitById(sw.unit) : null;
    const fromSt = stationOf(sw.from);
    const from = (u && pos.get(u.unit)) ?? (fromSt && [fromSt.lon, fromSt.lat]);
    const to = stationOf(sw.to);
    if (from && to) links.push({ type: "Feature", properties: { kind: "switch" }, geometry: { type: "LineString", coordinates: arc(from, [to.lon, to.lat]) } });
  }
  const fresh = S.calls.filter((c) => c.priority === 1 && c.lon != null && Date.now() - Date.parse(c.firstSeen) < 5 * 60000);
  map.getSource("pulse").setData(fc(fresh.map((c) => point([c.lon, c.lat]))));
  map.getSource("pieces").setData(fc(pieces));
  map.getSource("scenes").setData(fc(scenes));
  map.getSource("links").setData(fc(links));
  const names = selStation ? areasOf(selStation) : [];
  map.setFilter("division-sel", ["in", ["get", "name"], ["literal", names]]);
  if (S.outsideOf !== selArea) {
    // the world with the selected division cut out of it
    S.outsideOf = selArea;
    const polys = selArea ? S.divisions.features.filter((f) => names.includes(f.properties.name)).flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)) : [];
    const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
    map.getSource("outside").setData(selArea ? { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [[world, ...polys.map((poly) => poly[0])], ...polys.flatMap((poly) => poly.slice(1).map((inner) => [inner]))] } } : fc([]));
  }
  map.setPaintProperty("division-fill", "fill-opacity", ["case", ["in", ["get", "name"], ["literal", names]], 0.1, 0]);
  map.setFilter("sel-ring", ["==", ["get", "id"], selUnit ?? ""]);
  S.pos = pos;
  // station chips: each station's own units on scene, and a red dot when its area has an emergency
  map.getSource("stations").setData(fc(S.stations.map((s) => {
    const b = S.board.find((x) => x.name === s.division);
    const on = S.units.filter((u) => s.division && realKey(u) === s.division && u.status === "out").length;
    const chip = `chip${s.division && s.division === selStation ? "-sel" : ""}${b?.emergencies ? "-em" : ""}`;
    return point([s.lon, s.lat], { kind: s.division ? "station" : "hq", division: s.division ?? "", name: short(s.name), count: s.division && !phone() ? `  ${on} on scene` : "", chip, sel: !!s.division && s.division === selStation, dim: !!selArea && s.division !== selArea });
  })));
}
// How wide a station chip is on screen, for fitting All of Dallas: shield + name + count.
const chipHalf = (s) => Math.min(90, (40 + short(s.name).length * 7.4 + (phone() ? 0 : 66)) / 2);

function arc(a, b) {
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const bend = [mid[0] - (b[1] - a[1]) * 0.2, mid[1] + (b[0] - a[0]) * 0.2];
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push([(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * bend[0] + t ** 2 * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * bend[1] + t ** 2 * b[1]]);
  }
  return pts;
}

/* ---------------- the camera ---------------- */
// The part of the screen the panels leave free; the map centres things in it. `overlay` counts the Units panel when it
// opens over the map (1100 px and narrower) or as the phone's bottom sheet: a unit flown to must not land under it.
const shown = (el) => el && !el.hidden && getComputedStyle(el).display !== "none";
function freeRect({ overlay = true } = {}) {
  const st = $("#stations"), side = $("#side"), bar = $("#heatbar");
  const open = shown(side) && (overlay || !narrow()), r = open ? side.getBoundingClientRect() : null;
  const top = Math.round((shown(bar) ? bar.getBoundingClientRect().bottom : $(".top").getBoundingClientRect().bottom) + 12);
  const bottom = open && phone() ? Math.round(innerHeight - r.top + 12) : Math.round(innerHeight - $(".orbit").getBoundingClientRect().top + 12);
  return {
    top, bottom: Math.max(0, Math.min(bottom, innerHeight - top - 80)),
    left: shown(st) ? Math.round(st.getBoundingClientRect().right + 12) : 12,
    right: open && !phone() ? Math.round(innerWidth - r.left + 12) : 12,
  };
}
// All of Dallas: the zoom at which every station chip fits in the free part of the screen.
function homeCamera() {
  const map = S.map, pad = freeRect({ overlay: false });
  map.setPadding(pad);
  const pts = S.stations.filter((s) => s.division).map((s) => [s.lon, s.lat]);
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
  const center = [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
  const pitch = S.is3d ? VIEW.pitch : 0;
  const saved = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  let zoom = 12;
  for (; zoom > 8.5; zoom -= 0.25) {
    map.jumpTo({ center, zoom, pitch, bearing: VIEW.bearing });
    const fits = S.stations.filter((s) => s.division).every((s) => {
      const p = map.project([s.lon, s.lat]);
      const w = chipHalf(s);
      return p.x - w >= pad.left && p.x + w <= innerWidth - pad.right && p.y - 34 >= pad.top && p.y <= innerHeight - pad.bottom;
    });
    if (fits) break;
  }
  map.jumpTo(saved);
  return { center, zoom, pitch, bearing: VIEW.bearing, padding: pad };
}
// The camera that shows these points as large as they fit in the free part of the screen, at the board's tilt and the
// current bearing, centred there.
function fitCamera(points, { maxZoom = 14, minZoom = 8.5 } = {}) {
  const map = S.map, pad = freeRect();
  const saved = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), padding: map.getPadding() };
  map.setPadding(pad);
  const lons = points.map((p) => p[0]), lats = points.map((p) => p[1]);
  let center = [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
  const pitch = S.is3d ? VIEW.pitch : 0, bearing = map.getBearing();
  const right = innerWidth - pad.right, bottom = innerHeight - pad.bottom;
  const box = () => {
    const ps = points.map((p) => map.project(p));
    return { x0: Math.min(...ps.map((p) => p.x)), x1: Math.max(...ps.map((p) => p.x)), y0: Math.min(...ps.map((p) => p.y)), y1: Math.max(...ps.map((p) => p.y)) };
  };
  let zoom = maxZoom;
  for (; zoom >= minZoom; zoom -= 0.25) {
    map.jumpTo({ center, zoom, pitch, bearing });
    let b = box();
    const floor = zoom - 0.25 < minZoom; // the widest allowed: centre it there whatever fits
    if (!floor && (b.x1 - b.x0 > right - pad.left - 16 || b.y1 - b.y0 > bottom - pad.top - 16)) continue;
    // centre it: move the map's centre to the point now under the middle of the shape
    const mid = map.unproject([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]);
    center = [mid.lng, mid.lat];
    map.jumpTo({ center, zoom, pitch, bearing });
    b = box();
    if (floor || (b.x0 >= pad.left && b.x1 <= right && b.y0 >= pad.top && b.y1 <= bottom)) break;
  }
  map.jumpTo({ center: saved.center, zoom: saved.zoom, pitch: saved.pitch, bearing: saved.bearing });
  map.setPadding(saved.padding);
  return { center, zoom, pitch, bearing, padding: pad };
}
// A division's outline (Central's includes the CBD) and its station, to fit on screen.
function areaPoints(station) {
  const names = areasOf(station), pts = [];
  for (const f of S.divisions?.features ?? []) {
    if (!names.includes(f.properties.name)) continue;
    for (const poly of f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) {
      const ring = poly[0], k = Math.max(1, Math.floor(ring.length / 150));
      for (let i = 0; i < ring.length; i += k) pts.push(ring[i]);
    }
  }
  const st = stationOf(station);
  if (pts.length && st) pts.push([st.lon, st.lat]);
  return pts;
}
// Locate a division, as Locate does for a unit: the whole division on screen, from wherever the map is.
function locateArea(station) {
  if (!S.map) return;
  // Other units have no division: show where they are
  const pts = station === OTHER ? [...S.pos].filter(([id]) => realKey(unitById(id) ?? {}) === OTHER).map(([, p]) => p) : areaPoints(station);
  if (!pts.length) return station === OTHER && S.map.easeTo({ ...homeCamera(), duration: 1300, essential: true });
  S.map.easeTo({ ...fitCamera(pts, station === OTHER ? { maxZoom: 13 } : {}), duration: 1300, essential: true });
}
// Fly in to a unit or a place: zoom in, never out. Hops under 3 km glide; longer flights arc so the imagery keeps up,
// never wider than zoom 13 when they start closer in than that.
function locate(lnglat) {
  if (!lnglat || !S.map) return;
  const map = S.map, z = map.getZoom(), c = map.getCenter();
  const target = { center: lnglat, zoom: Math.max(z, 15.5), pitch: S.is3d ? Math.max(map.getPitch(), VIEW.pitch) : 0, padding: freeRect(), essential: true };
  if (z >= 13 && metres([c.lng, c.lat], lnglat) < 3000) map.easeTo({ ...target, duration: 900 });
  else map.flyTo({ ...target, duration: 1500, ...(z > 13 ? { minZoom: 13 } : {}) });
}

/* ---------------- live data ---------------- */
async function refresh() {
  try {
    const d = await fetch(api("api/live")).then((r) => r.json());
    Object.assign(S, { calls: d.calls ?? [], board: d.board ?? [], units: d.units ?? [], events: d.events ?? [], fetchedAt: d.fetchedAt, cityUpdatedAt: d.cityUpdatedAt, ok: d.ok, issue: d.issue ?? null, watchingSince: d.watchingSince, watchedSince: d.watchedSince });
    if (d.stations?.length) S.stations = d.stations;
    // the selected unit moved to another call: its story was about the old place
    const u = S.sel?.kind === "unit" ? unitById(S.sel.id) : null;
    if (u?.status === "out") loadStory(u.callId);
  } catch {
    S.ok = false;
  }
  render();
  alerts();
}

function render() {
  renderTop();
  renderStations();
  renderSide();
  renderPlan();
  if (S.view === "board") renderBoard();
  drawMap();
  placeHud();
}

function renderTop() {
  const out = S.units.filter((u) => u.status === "out");
  const cleared = S.units.filter((u) => u.status === "cleared").length;
  const em = S.calls.filter((c) => c.priority === 1).length;
  const { top, atLeast } = longestOf(S.units);
  const html = `<div><b>${out.length}</b><span>units on scene</span></div><div><b>${cleared}</b><span>cleared, last hour</span></div><div><b>${S.calls.length}</b><span>scenes</span></div><div class="${em ? "red" : ""}"><b>${em}</b><span>emergenc${em === 1 ? "y" : "ies"}</span></div><div class="${(top?.onScene ?? 0) > 60 ? "amber" : ""}"><b>${top ? `${atLeast ? "≥" : ""}${mins(top.onScene)}` : "—"}</b><span>longest scene</span></div>`;
  if ($("#stats").dataset.h !== html) { $("#stats").innerHTML = html; $("#stats").dataset.h = html; }
  tick();
}
// The header shows the city's own update time, not ours: the city refreshes the feed every 2 minutes. When the city's
// last answer was an old copy of the list (it happens), the board keeps the last good one and says so.
function tick() {
  const city = S.cityUpdatedAt ? (Date.now() - Date.parse(S.cityUpdatedAt)) / 60000 : null;
  const skipped = !!S.issue && !!S.fetchedAt && S.issue.at > S.fetchedAt;
  const fresh = S.ok && !skipped && city != null && city < 10;
  const showing = clockOf(S.cityUpdatedAt ?? S.fetchedAt);
  $("#age").textContent = !S.fetchedAt ? "Dallas Police · connecting…"
    : !S.ok ? `Can't reach the city · showing ${showing}`
    : skipped ? `City sent ${S.issue.kind === "old" ? "an old list" : S.issue.kind === "empty" ? "an empty list" : "half a list"} · showing ${showing}`
    : fresh ? `Dallas Police · city data ${clockOf(S.cityUpdatedAt)}`
    : `City feed delayed · last update ${showing}`;
  $("#dot").className = `dot ${fresh ? "live" : S.fetchedAt ? "stale" : ""}`;
  $("#clock").innerHTML = `<b>${clockOf(new Date().toISOString())}</b><span>${new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "long" }).format(new Date())} · Dallas</span>`;
}

/* ---------------- stations (left) ---------------- */
function stationKeys() {
  return [...ORDER, ...(S.units.some((u) => realKey(u) === OTHER && onBoard(u)) ? [OTHER] : [])];
}
const OTHER_NOTE = "Traffic and specialist units, no station";
function stationRowsHtml() {
  const selStation = S.sel?.kind === "station" ? S.sel.name : null;
  return stationKeys().map((name) => {
    const b = S.board.find((x) => x.name === name) ?? {};
    const mine = S.units.filter((u) => realKey(u) === name && onBoard(u));
    const out = mine.filter((u) => u.status === "out"), cleared = mine.filter((u) => u.status === "cleared");
    const away = out.filter(awayFromHome).length;
    // pending switches stay pending: the counts are where units belong now, the moves are noted beside them
    const active = S.switches.filter((m) => !m.unit || unitById(m.unit));
    const goingIn = active.filter((m) => m.to === name).length, goingOut = active.filter((m) => m.from === name).length;
    const dots = [...out.sort((a, c) => a.priority - c.priority), ...cleared].map((u) => `<i class="pc ${u.status === "out" ? `p${u.priority}` : "clear"} ${pendingOf(u.unit) ? "pend" : ""}" title="${esc(u.unit)}"></i>`).join("");
    const l2 = name === OTHER ? OTHER_NOTE
      : [`${plural(b.scenes ?? 0, "scene")} here${b.cbdScenes ? ` (${b.cbdScenes} in the CBD)` : ""}`, b.emergencies ? `<span class="r">${plural(b.emergencies, "emergency", "emergencies")}</span>` : "", away ? `${away} helping elsewhere` : "", goingIn ? `<span class="blue">${goingIn} switching in</span>` : "", goingOut ? `<span class="blue">${goingOut} switching out</span>` : ""].filter(Boolean).map((x) => `<span class="nw">${x}</span>`).join(" · ");
    return `<button class="st ${selStation === name ? "sel" : ""}" data-station="${esc(name)}">
      <span class="l1"><b>${esc(name)}</b><span>${out.length} on scene · ${cleared.length} cleared</span></span>
      <span class="l2">${l2}</span>
      <span class="pieces">${dots || `<span class="none">No units seen in the last hour</span>`}</span></button>`;
  }).join("");
}
function renderStations() {
  const html = `<div class="head"><h2>Stations</h2><span>your units</span></div>${stationRowsHtml()}${planHtml(false)}`;
  const el = $("#stations");
  if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
  moreStations();
}
// a soft fade at the bottom while more station rows are below (the plan, when there is one, is its own footer)
function moreStations() {
  const el = $("#stations");
  el.classList.toggle("more", el.scrollTop + el.clientHeight < el.scrollHeight - 4 && !el.querySelector(".plan"));
}
$("#stations").addEventListener("scroll", moreStations, { passive: true });

/* ---------------- pending switches: always in view ---------------- */
function planHtml(compact) {
  const n = S.switches.length;
  if (!n) return "";
  const buttons = `<button class="btn primary" data-copy-plan>Copy for dispatch</button><button class="btn" data-clear-plan>Clear</button>`;
  if (compact) return `<b>${n} pending switch${n === 1 ? "" : "es"}</b><span class="list">${S.switches.map((m) => `${esc(m.unit ?? "1 unit")} → ${esc(short(m.to))}`).join(" · ")}</span>${buttons}`;
  // the list scrolls inside the plan, so the heading and Copy for dispatch always fit
  return `<div class="plan"><h3>Pending switches · ${n}</h3><div class="moves">${S.switches.map((m, i) => `<div class="move"><div class="m"><b>${esc(m.unit ?? "1 unit")} · ${esc(m.from ? short(m.from) : "No home")} → ${esc(short(m.to))}</b><small>${dayOf(m.t) === dayOf(new Date().toISOString()) ? "" : `${esc(dayOf(m.t))} ${clockOf(m.t)} · `}${esc(m.reason)}${m.by ? ` · ${esc(m.by)}` : ""}${m.unit && !unitById(m.unit) ? " · not on the board now" : ""}</small></div><button class="x" data-unswitch="${i}" aria-label="Cancel">×</button></div>`).join("")}</div><div class="row2">${buttons}</div></div>`;
}
// In the Board view and on a phone the Stations panel is hidden, so the plan gets its own bar.
function renderPlan() {
  const el = $("#plan");
  const show = S.switches.length > 0 && (S.view === "board" || phone());
  el.hidden = !show;
  document.body.classList.toggle("plan-open", show);
  const html = show ? planHtml(true) : "";
  if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
}
// The text dispatch gets: dated when it isn't today's, and honest about where each unit is now.
function planText() {
  const today = dayOf(new Date().toISOString());
  return S.switches.map((m) => {
    const u = m.unit ? unitById(m.unit) : null;
    const when = dayOf(m.t) === today ? clockOf(m.t) : `${dayOf(m.t)} ${clockOf(m.t)}`;
    const now = !m.unit ? "" : !u ? " (not on the board now)" : u.status === "out" ? ` (now on call ${u.callId}, ${KIND[u.priority]}: switch when it clears)` : u.status === "earlier" ? ` (last seen on a scene ${ago(u.ago)})` : "";
    return `${when} Switch ${m.unit ?? "1 unit"}${m.from ? ` from ${m.from}` : ""} to ${m.to}${now}. Reason: ${m.reason}.`;
  }).join("\n");
}

/* ---------------- units, events, and the cards (right) ---------------- */
function renderSide() {
  const el = $("#side");
  const sel = S.sel;
  el.hidden = S.view === "board" && sel?.kind !== "unit";
  document.body.classList.toggle("side-open", !el.hidden && (!!sel || S.panelOpen));
  document.body.classList.toggle("board-card", S.view === "board" && sel?.kind === "unit");
  let html;
  if (sel?.kind === "unit") html = unitCard(sel.id);
  else if (sel?.kind === "station") html = stationCard(sel.name);
  else html = tabsHtml() + (S.tab === "events" ? eventsHtml() : S.tab === "stations" && phone() ? stationRowsHtml() : unitsHtml());
  document.body.classList.toggle("station-card", sel?.kind === "station");
  const key = sel ? `${sel.kind}:${sel.id ?? sel.name}` : `list:${S.tab}`, moved = el.dataset.key !== key;
  if (moved && el.dataset.key) (S.scrollOf ??= {})[el.dataset.key] = el.scrollTop;
  if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
  if (moved) { el.dataset.key = key; el.scrollTop = sel ? 0 : S.scrollOf?.[key] ?? 0; }
}

function tabsHtml() {
  const recent = S.events.filter((e) => Date.now() - Date.parse(e.t) < 30 * 60000 && e.kind !== "start").length;
  const tab = (id, label, n) => `<button role="tab" data-tab="${id}" aria-selected="${S.tab === id || (id === "units" && S.tab === "stations" && !phone())}">${label}${n ? `<span class="n">${n}</span>` : ""}</button>`;
  return `<div class="tabs" role="tablist">${tab("units", "Units", S.units.filter(onBoard).length)}${tab("events", "Events", recent)}${phone() ? tab("stations", "Stations", 0) : ""}${narrow() ? `<button class="x" data-close-panel aria-label="Close">×</button>` : ""}</div>`;
}

const badge = (u, cls) => `<span class="badge ${cls} ${u.unit.length > 5 ? "long" : ""}">${esc(u.unit)}</span>`;
function offRow(u, own = false) {
  const pend = pendingOf(u.unit);
  // a pending switch leads the line, so the ellipsis can never cut it off
  const to = pend ? `<span class="blue">→ ${esc(short(pend.to))} (pending)</span> · ` : "";
  if (u.status === "out") {
    const t = u.onScene;
    return `<button class="off" data-unit="${esc(u.unit)}">${badge(u, `p${u.priority}`)}
      <span class="c"><b>${esc(u.call)}</b><small>${to}${awayFromHome(u) ? `${own ? `In ${esc(short(areaKey(u.area)))}` : `From ${esc(short(u.home))}`} · ` : ""}${u.approx ? "≈ " : ""}${esc(u.address)}</small></span>
      <span class="t ${t > 120 ? "bad" : t > 60 ? "warn" : ""}">${onScene(u)}<small>on scene</small></span></button>`;
  }
  const earlier = u.status === "earlier";
  return `<button class="off ${earlier ? "dim" : ""}" data-unit="${esc(u.unit)}">${badge(u, "clear")}
    <span class="c"><b>${earlier ? "Last seen on a scene" : `Cleared ${esc(u.lastType ?? "a call")}`}</b><small>${to}${esc(short(u.home ?? "No home station"))}${u.lastAddress ? ` · ${u.lastApprox ? "≈ " : ""}${esc(u.lastAddress)}` : ""}</small></span>
    <span class="t">${mins(u.ago)}<small>ago</small></span></button>`;
}

function unitsHtml() {
  const out = S.units.filter((u) => u.status === "out"), cleared = S.units.filter((u) => u.status === "cleared"), earlier = S.units.filter((u) => u.status === "earlier");
  return `<p class="note lead">Dallas publishes a unit only while it is on a scene. Calls waiting for a unit and confidential calls aren't published.</p>
    ${out.length ? `<div class="sect">On scene · ${out.length}</div>${out.map(offRow).join("")}` : ""}
    ${cleared.length ? `<div class="sect">Cleared in the last hour · ${cleared.length}</div>${cleared.map(offRow).join("")}` : ""}
    ${earlier.length ? `<button class="sect more" data-earlier>${S.earlierOpen ? "Hide" : "Show"} units seen earlier · ${earlier.length}</button>${S.earlierOpen ? earlier.map(offRow).join("") : ""}` : ""}
    ${!S.units.length ? `<p class="note">No units seen yet.</p>` : ""}
    ${S.watchingSince ? `<p class="note">Following since ${clockOf(S.watchingSince)}${S.watchedSince && Date.parse(S.watchedSince) - Date.parse(S.watchingSince) > 2 * 60000 ? `, without a break since ${clockOf(S.watchedSince)}` : ""}.</p>` : ""}`;
}

const EV_ICON = {
  call: '<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8Z"/>',
  arrive: '<path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/>',
  clear: '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z"/>',
  closed: '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z"/>',
  long: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.4 3.3 3.3-1.4 1.4L11 13.2V7h2v5.4Z"/>',
  zero: '<path d="M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z"/>',
  gap: '<path d="M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z"/>',
  start: '<path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"/>',
};
EV_ICON.back = EV_ICON.arrive;
function evTone(e) {
  if (e.kind === "call" && e.priority === 1) return "red";
  if (e.kind === "zero" || e.kind === "long" || e.kind === "gap" || (e.kind === "call" && e.priority === 2)) return "orange";
  if (e.kind === "arrive" || e.kind === "call") return "blue";
  return "gray"; // clears, closed calls, units back on a call they dropped off
}
// The last hour of events, all of them, newest first.
function eventsHtml() {
  const rows = [...S.events].reverse();
  const recent = rows.filter((e) => e.kind !== "start");
  return `<button class="btn full" style="margin:0 0 8px" data-q="What happened in the last hour? Tell it as a short story: what came in, who went where, what is still open, and anything that looks off." data-label="What happened in the last hour?">What happened? Ask Orbit</button>
    ${rows.map((e) => {
      const tone = evTone(e);
      const attrs = [e.unit && `data-evunit="${esc(e.unit)}"`, e.call && `data-evcall="${esc(e.call)}"`, e.division && `data-evdiv="${esc(e.division)}"`, e.lon != null && `data-lon="${e.lon}" data-lat="${e.lat}"`].filter(Boolean).join(" ");
      const where = e.where ? e.where.replace(/, ([^,·]+)( · |$)/, " · $1$2") : e.division ?? "";
      const tag = attrs ? "button" : "div";
      return `<${tag} class="ev ${tone === "red" ? "urgent" : e.kind === "zero" ? "notice" : ""} ${attrs ? "" : "static"}" ${attrs}>
        <span class="ic ${tone}"><svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="currentColor">${EV_ICON[e.kind] ?? EV_ICON.start}</svg></span>
        <span class="tx"><b>${esc(e.text)}</b>${where ? `<small>${e.approx ? "≈ " : ""}${esc(where)}</small>` : ""}${e.sowhat ? `<span class="so">${esc(e.sowhat)}</span>` : ""}</span>
        <time>${clockOf(e.t)}</time></${tag}>`;
    }).join("")}
    ${recent.length ? `<p class="note">The last hour of changes.</p>` : `<p class="note">New scenes, units arriving and clearing, and long scenes show here as they happen.</p>`}`;
}

function unitCard(id) {
  const back = S.backTo && S.view === "map" ? `<button class="back" data-back-to="${esc(S.backTo)}">‹ ${esc(S.backTo)}</button>` : `<button class="back" data-back>‹ ${S.view === "board" ? "Close" : "Units"}</button>`;
  const u = unitById(id);
  if (!u) return `${back}<p class="note">${esc(id)} is no longer on the board.</p>`;
  const pend = pendingOf(u.unit);
  const homeSt = stationOf(u.home);
  const call = u.status === "out" ? S.calls.find((c) => c.id === u.callId) : null;
  const partners = call ? call.units.filter((x) => x !== u.unit) : [];
  const status = u.status === "out" ? `On scene ${onScene(u)}${u.callOpen != null ? ` · call open ${mins(u.callOpen)}` : ""}` : u.status === "cleared" ? `Cleared ${ago(u.ago)}` : `Last seen on a scene ${ago(u.ago)}`;
  const tone = u.status === "out" ? (u.onScene > 120 ? "bad" : u.onScene > 60 ? "warn" : "") : "";
  const facts = [];
  if (u.status === "out") {
    facts.push(["Where", `<b>${u.approx ? "≈ " : ""}${esc(u.address)}</b><small>${[u.division, u.beat && `beat ${u.beat}`].filter(Boolean).map(esc).join(" · ")}${u.approx ? " · location approximate: shown at the beat's centre" : ""}</small>`]);
    facts.push(["Doing", `<b>${esc(u.call)}</b><small><span class="pri p${u.priority}">${PRI[u.priority]}</span>${call?.opened ? ` · came in ${clockOf(call.opened)}` : ""} · ${partners.length ? `with ${partners.map(esc).join(", ")}` : "only unit listed"}</small>`]);
    // the board's own sighting: it sees a unit arrive within a minute or two, or found it already there
    facts.push(["On scene", u.sinceKnown ? `<b>${mins(u.onScene)}</b><small>Arrived about ${clockOf(u.since)}</small>` : `<b>At least ${mins(u.onScene)}</b><small>Already there when the board looked at ${clockOf(u.since)}</small>`]);
  } else {
    const last = [u.lastAddress && `${u.lastApprox ? "≈ " : ""}${u.lastAddress}`, u.lastDivision].filter(Boolean).join(", ");
    facts.push(["Where", `<b>Not published off a scene</b><small>${last ? `${u.status === "cleared" ? "Cleared" : "Last seen"} at ${esc(last)}, ${ago(u.ago)}` : "No position"}</small>`]);
    facts.push(["Last scene", `<b>${esc(u.lastType ?? "—")}</b>`]);
  }
  facts.push(["Home", u.home ? `<b>${esc(homeSt ? `${homeSt.name} station` : u.home)}</b><small>${homeSt ? `${esc(homeSt.address)} · ` : ""}${esc(homeWhy(u))}${awayFromHome(u) ? ` · working in ${esc(short(areaKey(u.area)))}` : ""}</small>` : `<b>Not placed at a station</b><small>The board places only patrol call signs (A, B, C, D, E, F, OT, CE) and L units at a station, so it can't switch ${esc(u.unit)}</small>`]);
  if (pend) facts.push(["Switch", `<b class="blue">→ ${esc(stationOf(pend.to)?.name ?? pend.to)} station (pending)</b><small>${esc(pend.reason)}${u.status === "out" ? " · applies when it clears" : ""}</small>`]);
  facts.push(["Scenes seen", `<b>${plural(u.scenes, "scene")}</b><small>since ${clockOf(u.firstSeen)}</small>`]);
  const to = S.card.to;
  const options = ORDER.filter((d) => d !== effectiveHome(u)).map((d) => {
    const b = S.board.find((x) => x.name === d) ?? {};
    const mine = S.units.filter((x) => realKey(x) === d);
    return { value: d, label: d === u.home ? `${d} (its home)` : d, meta: `${mine.filter((x) => x.status === "out").length} on scene · ${mine.filter((x) => x.status === "cleared").length} cleared · ${plural(b.scenes ?? 0, "scene")} here`, tag: b.emergencies ? plural(b.emergencies, "emergency", "emergencies") : "", tagClass: "r" };
  });
  const where = S.pos?.get(u.unit);
  const why = u.status === "out" ? `It has been on a ${u.call} at ${u.address}${u.division ? ` (${u.division})` : ""} for ${u.sinceKnown ? "" : "at least "}${mins(u.onScene)}.` : `It cleared a ${u.lastType ?? "call"} ${ago(u.ago)}.`;
  // the actions stay pinned to the bottom of the panel, so Switch and Locate are always in reach
  const switching = u.home ? `<div class="row2">${dropdown("card-to", "To", to ? short(to) : "Pick a station", options, to)}${dropdown("card-why", "Why", S.card.why, REASONS.map((r) => ({ value: r, label: r })), S.card.why)}</div>
        <button class="btn primary full" data-switch="${esc(u.unit)}" ${to ? "" : "disabled"}>${to ? `Switch ${esc(u.unit)} to ${esc(short(to))}` : "Pick a station to switch"}</button>` : "";
  return `${back}
    <div class="card"><div class="who">${badge(u, u.status === "out" ? `p${u.priority}` : "clear")}<div><h2>${esc(u.home ? `${short(u.home)} unit` : "Unit with no station")}</h2><p class="${tone}">${status}</p></div></div>
      <div class="facts">${facts.map(([k, v]) => `<div class="fact"><span>${k}</span><div>${v}</div></div>`).join("")}</div>
      ${u.status === "out" ? storyHtml(u) : ""}
      <div class="acts">${switching}
        <div class="row2">${where ? `<button class="btn" data-locate="${esc(u.unit)}">Locate</button>` : ""}<button class="btn" data-label="What happened with ${esc(u.unit)}?" data-q="${esc(`What do you think happened with ${u.unit}? ${why} Use the events and the board. Say what is a guess and what the chief should check.`)}">What happened?</button></div>
      </div></div>`;
}

// The story of a place: reports from calls within 150 m in the last year. It belongs to the call, so every unit on the
// call shares it.
function storyHtml(u) {
  const s = S.story?.call === u.callId ? S.story : null;
  const box = (title, body) => `<div class="story"><h4>${title}</h4>${body}</div>`;
  if (!s || s.loading || (s.ready === false && !s.error)) return box("This place", `<p class="lead"><span>Loading the last year…</span></p>`);
  if (s.approx) return box("This place", `<p class="lead"><span>The location is approximate (beat ${esc(s.beat ?? u.beat)}), so there is no history for the block.</span></p>`);
  if (s.gone) return box("This place", `<p class="lead"><span>No unit is on this call any more.</span></p>`);
  if (typeof s.count !== "number") return box("This place", `<p class="lead"><span>History is unavailable right now. Trying again.</span></p>`);
  const day = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const named = (s.top ?? []).filter(([c]) => c !== "Category not given");
  return box("This place · last 52 weeks", `<p class="lead"><b>${s.count} report${s.count === 1 ? "" : "s"} from calls within 150 m</b>${named.length ? `<span>Mostly ${esc(named.slice(0, 2).map(([c]) => c.toLowerCase()).join(" and "))}</span>` : ""}</p>${(s.latest ?? []).slice(0, 3).map((x) => `<div>${esc(x.cat)}<span>${esc(day(x.day))}</span></div>`).join("")}`);
}
async function loadStory(call) {
  if (!call) return;
  if (S.story?.call === call && (S.story.loading || (S.story.ready && !S.story.error))) return; // have it, or on its way
  S.story = { call, loading: true };
  const d = await fetch(api(`api/story?call=${encodeURIComponent(call)}`)).then((r) => r.json()).catch(() => ({ ready: false, error: "unreachable" }));
  if (S.story?.call !== call) return; // moved on while this loaded
  S.story = { ...d, call, loading: false };
  renderSide();
  // the year is still loading, or the server was out of reach: try again while a unit on this call is open
  if (d.ready === false) setTimeout(() => {
    const v = S.sel?.kind === "unit" ? unitById(S.sel.id) : null;
    if (v?.callId === call && S.story?.call === call) { S.story = null; loadStory(call); }
  }, 4000);
}

function stationCard(name) {
  const b = S.board.find((x) => x.name === name) ?? {};
  const st = stationOf(name);
  const mine = S.units.filter((u) => realKey(u) === name);
  const on = mine.filter((u) => u.status === "out"), cl = mine.filter((u) => u.status === "cleared"), early = mine.filter((u) => u.status === "earlier");
  const away = on.filter(awayFromHome).length;
  const here = S.units.filter((u) => u.status === "out" && areaKey(u.area) === name && realKey(u) !== name);
  const helpers = here.filter((u) => u.home), unplaced = here.filter((u) => !u.home);
  const incoming = S.switches.filter((m) => m.to === name);
  const back = `<button class="back" data-back>‹ Units</button>`;
  const head = `<div class="who"><span class="badge station"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="${BLUE}" d="M12 2 3 6v6c0 5 3.8 9.4 9 10 5.2-.6 9-5 9-10V6l-9-4Z"/></svg></span><div><h2>${esc(name)}</h2><p>${esc(name === OTHER ? OTHER_NOTE : st ? `${st.name} station · ${st.address}` : "")}</p></div></div>`;
  const own = (u) => offRow(u, true);
  // its units at work first, then who is helping here, then the quieter lists; units seen earlier fold away
  const lists = `<div class="sect">Its units on scene · ${on.length}</div>${on.map(own).join("") || `<p class="note">None on a scene right now.</p>`}
      ${helpers.length ? `<div class="sect">From other stations, on scene here · ${helpers.length}</div>${helpers.map((u) => offRow(u)).join("")}` : ""}
      ${unplaced.length ? `<div class="sect">Not placed at a station, on scene here · ${unplaced.length}</div>${unplaced.map((u) => offRow(u)).join("")}` : ""}
      ${incoming.length ? `<div class="sect">Switching in (pending) · ${incoming.length}</div>${incoming.map((m) => (m.unit && unitById(m.unit) ? offRow(unitById(m.unit)) : `<p class="note">${esc(m.unit ?? "1 unit")} from ${esc(m.from ?? "another station")} · ${esc(m.reason)}</p>`)).join("")}` : ""}
      ${cl.length ? `<div class="sect">Its units cleared in the last hour · ${cl.length}</div>${cl.map(own).join("")}` : ""}
      ${early.length ? `<button class="sect more" data-earlier>${S.earlierOpen ? "Hide" : "Show"} its units seen earlier · ${early.length}</button>${S.earlierOpen ? early.map(own).join("") : ""}` : ""}`;
  if (name === OTHER) return `${back}<div class="card">${head}${lists}</div>`;
  // What is happening in the division now: its scenes, emergencies first, then the longest on scene. Each shows the
  // time its units have been there (as everywhere on the board), and which of them come from other stations.
  const now = Date.now();
  const scenes = S.calls.filter((c) => areaKey(c.area) === name).map((c) => {
    const { top, atLeast } = longestOf(S.units.filter((x) => x.callId === c.id));
    return { ...c, longest: top?.onScene ?? null, atLeast, open: c.opened ? Math.max(0, Math.round((now - Date.parse(c.opened)) / 60000)) : null };
  }).sort((a, c) => a.priority - c.priority || (c.longest ?? 0) - (a.longest ?? 0));
  const who = (id) => { const x = unitById(id); return x && realKey(x) !== name ? `${id} (${x.home ? short(x.home) : "no station"})` : id; };
  const sceneRow = (c) => `<button class="off" data-scene="${esc(c.id)}" data-from="${esc(name)}"><span class="badge p${c.priority} ${c.units.length > 9 ? "long" : ""}">${plural(c.units.length, "unit")}</span>
      <span class="c"><b>${esc(c.type)}</b><small>${c.priority <= 2 ? `<span class="pri p${c.priority}">${PRI[c.priority]}</span> ` : ""}${esc(c.units.map(who).join(", "))} · ${c.approx ? "≈ " : ""}${esc(c.address)}${c.division === "Central Business District" ? " (CBD)" : ""}${c.open != null ? ` · call open ${mins(c.open)}` : ""}</small></span>
      <span class="t ${c.longest > 120 ? "bad" : c.longest > 60 ? "warn" : ""}">${c.longest == null ? "—" : `${c.atLeast ? "≥" : ""}${mins(c.longest)}`}<small>on scene</small></span></button>`;
  const longest = scenes.reduce((m, c) => (c.longest ?? -1) > (m?.longest ?? -1) ? c : m, null);
  const happening = `<div class="sect">Scenes here now · ${scenes.length}${b.emergencies ? ` · <span class="r">${plural(b.emergencies, "emergency", "emergencies")}</span>` : ""}${b.cbdScenes ? ` · ${b.cbdScenes} in the CBD` : ""}</div>${scenes.map(sceneRow).join("") || `<p class="note">No scene with a unit on it in this division right now.</p>`}`;
  const u = b.usual;
  const factsHtml = (fs) => `<div class="facts">${fs.map(([k, v]) => `<div class="fact"><span>${k}</span><div>${v}</div></div>`).join("")}</div>`;
  const unitsFact = ["Units", `<b>${on.length} on scene · ${cl.length} cleared in the last hour</b><small>${[away ? `${away} of them helping elsewhere` : "", helpers.length ? `${helpers.length} from other stations here` : "None from other stations here", unplaced.length ? `${unplaced.length} not placed at a station` : "", longest ? `longest scene here ${longest.atLeast ? "≥" : ""}${mins(longest.longest)}` : ""].filter(Boolean).join(" · ")}</small>`];
  const history = [
    ["Usually", u ? `<b>About ${u.perWeek} report${u.perWeek === 1 ? "" : "s"} a week, ${WD[u.wd]}s ${hh(u.hour)}–${hh(u.hour + 1)}</b><small>Reports from calls in this area, last ${u.weeks} ${WD[u.wd]}s · Dallas Police Incidents</small>` : `<b>—</b><small>A year of reports is loading</small>`],
  ];
  // from Police Incidents: only calls that led to a report, so it counts reports, not all dispatched calls
  if (b.dispatch) history.push(["Dispatch", `<b>${b.dispatch.median} min median from call to dispatch</b><small>Calls that led to a report: ${b.dispatch.n.toLocaleString("en-US")} reports, last 30 days of Police Incidents, all hours and priorities</small>`]);
  // units from other stations; not ones with no home station (they can't be switched) or already switching here
  const options = S.units.filter((x) => x.home && x.home !== name && onBoard(x) && pendingOf(x.unit)?.to !== name)
    .sort((a, c) => (a.status === "cleared" ? 0 : 1) - (c.status === "cleared" ? 0 : 1) || (a.status === "cleared" ? a.ago - c.ago : (a.onScene ?? 0) - (c.onScene ?? 0)))
    .map((x) => ({ value: x.unit, label: `${x.unit} · ${short(x.home)}`, meta: x.status === "cleared" ? `Cleared ${ago(x.ago)}` : `On ${x.call} · ${onScene(x)}`, tag: x.status === "cleared" ? "cleared" : "" }));
  // the actions come last, so they stay pinned to the bottom of the panel through the whole card
  return `${back}<div class="card">${head}
      ${factsHtml([unitsFact])}
      ${happening}
      ${factsHtml(history)}
      ${lists}
      <div class="acts">${dropdown("st-pick", "Bring in", S.card.pick ?? "Pick a unit", options, S.card.pick)}
        <div class="row2"><button class="btn" data-locate-area="${esc(name)}">Locate</button><button class="btn primary" data-bring="${esc(name)}" ${S.card.pick ? "" : "disabled"}>${S.card.pick ? `Switch ${esc(S.card.pick)} here` : "Switch here"}</button></div></div></div>`;
}

/* ---------------- the board: units by station, drag to switch ---------------- */
function renderBoard() {
  const el = $("#boardview");
  const cols = stationKeys();
  el.style.setProperty("--cols", cols.length);
  const html = cols.map((name) => {
    const b = S.board.find((x) => x.name === name) ?? {};
    // the Board is the plan: a unit with a pending switch already stands in its new column
    const mine = S.units.filter((u) => planKey(u) === name);
    const out = mine.filter((u) => u.status === "out").sort((a, c) => a.priority - c.priority || (c.onScene ?? 0) - (a.onScene ?? 0));
    const clear = mine.filter((u) => u.status === "cleared").sort((a, c) => a.ago - c.ago);
    const helpers = S.units.filter((u) => u.status === "out" && u.home && areaKey(u.area) === name && planKey(u) !== name).length;
    const tile = (u) => {
      const pend = pendingOf(u.unit);
      const sub = u.status === "out" ? `${awayFromHome(u) ? `In ${short(areaKey(u.area))} · ` : ""}${u.call}` : `Cleared${u.lastAddress ? ` · ${u.lastApprox ? "≈ " : ""}${u.lastAddress}` : ""}`;
      const t = u.status === "out" ? onScene(u) : mins(u.ago);
      return `<button class="tile ${u.status === "out" ? `p${u.priority}` : "clear"} ${pend ? "pend" : ""}" ${name === OTHER ? "" : 'draggable="true"'} data-tile="${esc(u.unit)}"><span class="l1"><b>${esc(u.unit)}</b><em class="${u.status === "out" && u.onScene > 120 ? "bad" : u.status === "out" && u.onScene > 60 ? "warn" : ""}">${t}</em></span><small>${esc(pend ? `from ${short(pend.from ?? u.home ?? OTHER)} · ${sub}` : sub)}</small></button>`;
    };
    const empty = helpers ? `${plural(helpers, "unit")} from other stations on scene here` : name === OTHER ? "" : "Drop a unit here";
    const meta1 = `<span class="nw">${out.length} on scene</span> · <span class="nw">${clear.length} cleared</span>`;
    const meta2 = name === OTHER ? "No home station" : [b.emergencies ? `<span class="r">${plural(b.emergencies, "emergency", "emergencies")}</span>` : "", `${plural(b.scenes ?? 0, "scene")} here`].filter(Boolean).map((x) => `<span class="nw">${x}</span>`).join(" · ");
    return `<div class="glass col" ${name === OTHER ? "" : `data-col="${esc(name)}"`}><h3>${esc(short(name))}</h3>
      <div class="meta">${meta1}</div><div class="meta">${meta2}</div>
      <div class="list" data-list="${esc(name)}">${[...out, ...clear].map(tile).join("") || `<div class="empty">${empty}</div>`}</div></div>`;
  }).join("");
  if (el.dataset.h !== html) {
    const keep = new Map([...el.querySelectorAll("[data-list]")].map((l) => [l.dataset.list, l.scrollTop]));
    el.innerHTML = html;
    el.dataset.h = html;
    for (const l of el.querySelectorAll("[data-list]")) l.scrollTop = keep.get(l.dataset.list) ?? 0;
  }
}

function setView(v) {
  S.view = v;
  document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === v)));
  $("#boardview").hidden = v !== "board";
  $("#stations").hidden = v === "board";
  $(".tools").hidden = v === "board"; // 3D, the heat map, All of Dallas and the Units panel all act on the map
  if (v === "board" && S.sel?.kind === "station") S.sel = null;
  render();
  renderHeatBar();
  if (v === "map" && S.sel?.kind === "unit") locate(S.pos.get(S.sel.id));
  else if (v === "map" && S.sel?.kind === "station") locateArea(S.sel.name);
}

/* ---------------- selecting and switching ---------------- */
// Selecting a unit flies to it (zooming in only, never out). Selecting a station shows its whole division.
function select(sel, { move = true, at = null, backTo = null } = {}) {
  S.sel = sel;
  S.backTo = backTo; // the division a unit card was opened from, for its back button
  S.card = { to: null, why: REASONS[0], pick: null };
  closeDD();
  if (sel?.kind === "unit") {
    const u = unitById(sel.id);
    if (u?.status === "out") loadStory(u.callId);
  }
  render();
  if (!move || S.view !== "map") return;
  if (sel?.kind === "unit") locate(S.pos?.get(sel.id) ?? at);
  else if (sel?.kind === "station") locateArea(sel.name);
  else if (at) locate(at);
}

function addSwitch(unit, to, reason, by = "Chief") {
  const u = unitById(unit);
  if (!u?.home) return; // a unit with no home station can't be switched
  const prev = pendingOf(unit);
  const from = u.home;
  S.switches = S.switches.filter((s) => s.unit !== unit);
  if (to !== from) S.switches.push({ unit, from, to, reason, by, t: new Date().toISOString() });
  save();
  render();
  const kind = KIND[u.priority] ?? "";
  const busy = u.status === "out" ? `On ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind} call now: the switch applies when it clears.` : "";
  toast(to === from ? `${unit} back to ${short(from)}` : `${unit} → ${short(to)} · pending`, () => { S.switches = S.switches.filter((s) => s.unit !== unit).concat(prev ? [prev] : []); save(); render(); }, { sub: to === from ? "" : busy });
}

/* ---------------- custom dropdown ---------------- */
const DD = {};
function dropdown(id, key, label, options, value) {
  DD[id] = { options, value };
  return `<button type="button" class="dd" data-dd="${id}" aria-haspopup="listbox"><span class="k">${esc(key)}</span><span class="v">${esc(label)}</span><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg></button>`;
}
let ddOpen = null;
function openDD(btn) {
  const id = btn.dataset.dd;
  const dd = DD[id];
  if (!dd) return;
  const menu = $("#ddmenu");
  const current = Math.max(0, dd.options.findIndex((o) => o.value === dd.value));
  menu.innerHTML = dd.options.map((o, i) => `<button type="button" class="dd-opt ${i === current ? "active" : ""}" role="option" aria-selected="${o.value === dd.value}" data-ddv="${esc(o.value)}"><span class="ck">${o.value === dd.value ? "✓" : ""}</span><b>${esc(o.label)}</b>${o.tag ? `<span class="tag ${o.tagClass ?? ""}">${esc(o.tag)}</span>` : "<span></span>"}${o.meta ? `<small>${esc(o.meta)}</small>` : ""}</button>`).join("") || `<div class="note" style="padding:10px">Nothing to pick yet.</div>`;
  const r = btn.getBoundingClientRect();
  menu.hidden = false;
  const w = Math.min(Math.max(r.width, 280), innerWidth - 16);
  menu.style.width = `${w}px`;
  const h = Math.min(360, menu.scrollHeight);
  const below = innerHeight - r.bottom > h + 12;
  Object.assign(menu.style, { left: `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`, top: below ? `${r.bottom + 6}px` : `${Math.max(8, r.top - h - 6)}px` });
  menu.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  ddOpen = id;
}
function closeDD() { $("#ddmenu").hidden = true; ddOpen = null; }
function pickDD(value) {
  const id = ddOpen;
  closeDD();
  if (id === "card-to") S.card.to = value;
  if (id === "card-why") S.card.why = value;
  if (id === "st-pick") S.card.pick = value;
  if (id === "heat-wd") { S.heat.wd = Number(value); renderHeatBar(); return loadHeat(); }
  if (id === "heat-cat") { S.heat.cat = value; renderHeatBar(); return loadHeat(); }
  renderSide();
}

/* ---------------- history: the heat map ---------------- */
function dallasNow() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date());
  return { wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday").value), hour: Number(parts.find((p) => p.type === "hour").value) % 24 };
}
// Where reports from calls usually came in, on the last 52 of this weekday, in this hour.
const CATS = [{ value: "all", label: "All reports" }, { value: "violent", label: "Violent" }, { value: "property", label: "Property" }, { value: "vehicle", label: "Vehicle theft" }];
const PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
async function toggleHeat(force) {
  S.heat.on = force ?? !S.heat.on;
  $("#hist").setAttribute("aria-pressed", String(S.heat.on));
  if (S.heat.on) {
    if (S.heat.wd == null) { const { wd, hour } = dallasNow(); Object.assign(S.heat, { wd, h: hour }); }
    renderHeatBar();
    await loadHeat();
  } else {
    clearInterval(S.heat.playing);
    S.heat.playing = null;
  }
  S.map.setLayoutProperty("history", "visibility", S.heat.on ? "visible" : "none");
  S.map.setLayoutProperty("outside-heat", "visibility", S.heat.on ? "visible" : "none");
  renderHeatBar();
}
function showHeat(wd, h) {
  Object.assign(S.heat, { wd, h });
  if (S.heat.on) { renderHeatBar(); loadHeat(); } else toggleHeat(true);
}
async function loadHeat() {
  const want = `${S.heat.wd}-${S.heat.h}-${S.heat.cat}`;
  const d = await fetch(api(`api/heat?wd=${S.heat.wd}&h=${S.heat.h}&cat=${S.heat.cat}`)).then((r) => r.json().then((j) => ({ ...j, bad: r.status === 400 }))).catch(() => null);
  if (want !== `${S.heat.wd}-${S.heat.h}-${S.heat.cat}`) return; // the hour moved on while this loaded
  S.heat.data = d;
  S.map.getSource("history").setData(fc((d?.ready ? d.points ?? [] : []).map((p) => point(p))));
  renderHeatBar();
  // the year of reports is still loading on the server, or the server was out of reach: try again (never for a bad ask)
  clearTimeout(S.heat.retry);
  if ((!d || (!d.ready && !d.bad)) && S.heat.on) S.heat.retry = setTimeout(loadHeat, 4000);
}
function renderHeatBar() {
  const el = $("#heatbar");
  el.hidden = !S.heat.on || S.view === "board";
  if (!el.hidden) {
    const d = S.heat.data;
    const sum = !d ? "Loading…" : d.bad ? "There is no history for that choice." : !d.ready ? (d.error ? "History is unavailable right now. Trying again." : "Loading a year of reports…")
      : `${d.count.toLocaleString("en-US")} reports from calls on the last ${d.weeks} ${WD[d.wd]}s, ${hh(d.hour)}–${hh(d.hour + 1)} · about ${d.perWeek} a week${d.busiest?.[0] ? ` · most in ${short(d.busiest[0][0])}` : ""}`;
    const html = `<div class="hrow"><span class="lbl">Usually</span>
      ${dropdown("heat-wd", "", WD[S.heat.wd], WD.map((w, i) => ({ value: String(i), label: w })), String(S.heat.wd))}
      <span class="stepper"><button data-heat-step="-1" aria-label="An hour earlier">‹</button><b>${hh(S.heat.h)}–${hh(S.heat.h + 1)}</b><button data-heat-step="1" aria-label="An hour later">›</button></span>
      <button class="play" data-heat-play aria-label="${S.heat.playing ? "Pause" : "Play through the day"}">${S.heat.playing ? PAUSE : PLAY}</button>
      ${dropdown("heat-cat", "", CATS.find((c) => c.value === S.heat.cat).label, CATS, S.heat.cat)}</div>
      <div class="hrow sub"><span class="sum">${esc(sum)}</span><span class="legend">Fewer<i></i>More</span></div>`;
    el.title = "City of Dallas Police Incidents: reports from calls, by the hour the call came in, last 52 weeks. Reports taken at police stations are left out. History, not a forecast.";
    if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
  }
  placeHud();
}
// Banners sit under the heat bar while it is open, so they never cover its controls; on the Board they sit at the
// bottom, clear of the column headers and the card. On a phone they stay at the top while the Units sheet is open
// (there is no free space then), and the sheet is capped below the heat bar.
function placeHud() {
  const bar = $("#heatbar"), hud = $("#hud");
  const below = shown(bar) ? Math.round(bar.getBoundingClientRect().bottom) : 0;
  const sheet = phone() && document.body.classList.contains("side-open");
  hud.classList.toggle("low", S.view === "board");
  hud.classList.toggle("short", sheet);
  hud.style.top = S.view === "map" && below && !sheet ? `${below + 10}px` : "";
  const st = $("#stations"), side = $("#side"), free = S.view === "map" && !phone();
  hud.style.left = free && shown(st) ? `${Math.round(st.getBoundingClientRect().right + 12)}px` : "";
  hud.style.right = free && shown(side) ? `${Math.round(innerWidth - side.getBoundingClientRect().left + 12)}px` : "";
  document.body.style.setProperty("--heat-bottom", `${below}px`);
}
function stepHeat(n) {
  S.heat.h = (S.heat.h + n + 24) % 24;
  renderHeatBar();
  loadHeat();
}
function playHeat() {
  if (S.heat.playing) { clearInterval(S.heat.playing); S.heat.playing = null; return renderHeatBar(); }
  S.heat.playing = setInterval(() => stepHeat(1), 1400);
  renderHeatBar();
}

function toggle3d() {
  S.is3d = !S.is3d;
  $("#view3d").setAttribute("aria-pressed", String(S.is3d));
  S.map.setLayoutProperty("buildings", "visibility", S.is3d ? "visible" : "none");
  if (S.sel?.kind === "station" && S.view === "map") locateArea(S.sel.name);
  else S.map.easeTo({ pitch: S.is3d ? VIEW.pitch : 0, duration: 900 });
}

/* ---------------- Orbit, the assistant ---------------- */
const CHIPS = [
  ["Brief me", "Brief me: which stations are stretched, which units have been on scene longest, and anything new. Propose one switch if it would help."],
  ["What happened?", "What happened in the last hour? Tell it as a short story: what came in, who went where, what is still open, and anything that looks off."],
  ["Who needs relief?", "Which units have been on one scene the longest, and who could relieve them?"],
  ["Where do I need people?", "Where do I need people right now, and who could I switch there?"],
];
function renderChips(show) { $("#chips").innerHTML = show ? CHIPS.map(([l, q]) => `<button type="button" data-q="${esc(q)}" data-label="${esc(l)}">${esc(l)}</button>`).join("") : ""; }

async function ask(q, label, spoken = false) {
  q = q.trim();
  if (!q) return;
  $("#q").value = "";
  renderChips(false);
  const box = $("#answer");
  box.hidden = false;
  box.className = "glass answer thinking";
  const shown = label ?? q;
  box.innerHTML = `<div class="who"><span>${esc(shown)}</span></div><div class="text">Orbit is looking at the city…</div>`;
  try {
    const d = await fetch(api("api/ask"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, previous: S.previous }) }).then((r) => r.json());
    S.previous = d.id ?? S.previous;
    S.proposals = (d.actions ?? []).filter((a) => a.move).map((a) => a.move);
    box.className = "glass answer";
    box.innerHTML = `<div class="who"><span>Orbit · ${esc(shown.length > 70 ? `${shown.slice(0, 70)}…` : shown)}</span><button class="x" data-close-answer aria-label="Close">×</button></div><div class="text">${esc(d.answer ?? d.error ?? "No answer.").replace(/\n/g, "<br>")}</div>
      ${S.proposals.map((m, i) => `<div class="proposal"><div class="m"><b>Switch ${esc(m.unit ?? "1 unit")} · ${esc(short(m.from ?? "?"))} → ${esc(short(m.to))}</b><small>${esc(m.reason)}</small></div><button class="btn primary" data-take="${i}">Approve</button></div>`).join("")}`;
    for (const a of d.actions ?? []) if (a.heat) showHeat(a.heat.wd, a.heat.h); else if (!a.move) pointAt(a);
    if (spoken && "speechSynthesis" in window && d.answer) speechSynthesis.speak(new SpeechSynthesisUtterance(d.answer));
  } catch {
    box.className = "glass answer";
    box.innerHTML = `<div class="who"><span>Orbit</span><button class="x" data-close-answer>×</button></div><div class="text">Orbit could not be reached.</div>`;
  }
}

function pointAt(a) {
  if (a.unit && unitById(String(a.unit).toUpperCase())) return select({ kind: "unit", id: String(a.unit).toUpperCase() });
  if (a.call) {
    const u = S.units.find((x) => x.callId === a.call && x.status === "out");
    if (u) return select({ kind: "unit", id: u.unit });
  }
  if (a.division && S.view === "map") {
    const s = String(a.division).toLowerCase();
    const d = /^(cbd|central business district)$/.test(s) ? "Central" : ORDER.find((x) => x.toLowerCase() === s);
    if (d) select({ kind: "station", name: d });
  }
}

function setupMic() {
  const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  const mic = $("#mic");
  if (!SR) { mic.title = "Voice needs Chrome or Safari"; mic.disabled = true; mic.style.opacity = 0.4; return; }
  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = true;
  let heard = "";
  rec.onresult = (e) => { heard = [...e.results].map((r) => r[0].transcript).join(" "); $("#q").value = heard; };
  rec.onend = () => { mic.classList.remove("on"); if (heard.trim()) ask(heard, null, true); heard = ""; };
  mic.addEventListener("click", () => { if (mic.classList.contains("on")) return rec.stop(); heard = ""; mic.classList.add("on"); rec.start(); });
}

// Banners at the top: short confirmations, red alerts for a new emergency, orange notices for a stretched station.
function toast(msg, undo, { tone = "", sub = "", show = null, ttl = 3500 } = {}) {
  const hud = $("#hud");
  const el = document.createElement("div");
  el.className = `glass toast ${tone}`;
  el.innerHTML = `<i></i><span class="t"><b>${esc(msg)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>${show ? `<button class="btn primary" data-act="show">Show</button>` : ""}${undo ? `<button class="btn" data-act="undo">Undo</button>` : ""}<button class="x" data-act="close" aria-label="Dismiss">×</button>`;
  el.addEventListener("click", (e) => {
    const a = e.target.closest("[data-act]")?.dataset.act;
    if (a === "undo") undo?.();
    if (a === "show") show?.();
    if (a) el.remove();
  });
  hud.prepend(el);
  while (hud.children.length > (phone() ? 2 : 3)) hud.lastChild.remove();
  setTimeout(() => el.remove(), ttl);
}
function alerts() {
  const fresh = S.events.filter((e) => e.alert && (!S.alertSeen || e.t > S.alertSeen));
  S.alertSeen = S.events.at(-1)?.t ?? S.alertSeen;
  if (S.firstLoad) { S.firstLoad = false; return; } // don't replay old alerts on opening
  for (const e of fresh.slice(-3)) {
    const at = e.lon != null ? [e.lon, e.lat] : null;
    toast(e.text, null, {
      tone: e.kind === "zero" ? "notice" : "alert", ttl: 12000, sub: [e.where, e.sowhat].filter(Boolean).join(" · "),
      show: () => {
        const u = e.call ? S.units.find((x) => x.callId === e.call && x.status === "out") : null;
        if (u) return select({ kind: "unit", id: u.unit }, { at });
        if (S.view !== "map") setView("map");
        if (e.division) select({ kind: "station", name: areaKey(e.division) });
        else if (at) locate(at);
      },
    });
  }
}

/* ---------------- events ---------------- */
document.addEventListener("click", (e) => {
  const t = (sel) => e.target.closest(sel);
  if (!t("#ddmenu") && !t("[data-dd]")) closeDD();
  if (t("[data-ddv]")) return pickDD(t("[data-ddv]").dataset.ddv);
  if (t("[data-dd]")) { const b = t("[data-dd]"); return ddOpen === b.dataset.dd ? closeDD() : openDD(b); }
  if (t("[data-q]")) { const b = t("[data-q]"); return ask(b.dataset.q, b.dataset.label ?? b.textContent.trim()); }
  if (t("[data-heat-step]")) return stepHeat(Number(t("[data-heat-step]").dataset.heatStep));
  if (t("[data-heat-play]")) return playHeat();
  if (t("[data-view]")) return setView(t("[data-view]").dataset.view);
  if (t("[data-tab]")) { S.tab = t("[data-tab]").dataset.tab; return renderSide(); }
  if (t("[data-close-panel]")) { S.panelOpen = false; return renderSide(); }
  if (t("[data-earlier]")) { S.earlierOpen = !S.earlierOpen; return renderSide(); }
  if (t("[data-station]")) { const n = t("[data-station]").dataset.station; return select(S.sel?.kind === "station" && S.sel.name === n ? null : { kind: "station", name: n }); }
  if (t("[data-scene]")) {
    const c = S.calls.find((x) => x.id === t("[data-scene]").dataset.scene);
    const u = c && S.units.find((x) => x.callId === c.id && x.status === "out");
    return u ? select({ kind: "unit", id: u.unit }, { at: c.lon != null ? [c.lon, c.lat] : null, backTo: t("[data-scene]").dataset.from }) : undefined;
  }
  if (t("[data-locate-area]")) return locateArea(t("[data-locate-area]").dataset.locateArea);
  if (t("[data-tile]")) return select({ kind: "unit", id: t("[data-tile]").dataset.tile });
  if (t("[data-unit]")) return select({ kind: "unit", id: t("[data-unit]").dataset.unit });
  if (t("button.ev")) {
    // go to where the event happened: the unit, if it is still on that call; otherwise the event's own place
    const b = t("button.ev"), ds = b.dataset;
    const at = ds.lon ? [Number(ds.lon), Number(ds.lat)] : null;
    const u = ds.evunit ? unitById(ds.evunit) : null;
    if (u?.status === "out" && u.callId === ds.evcall) return select({ kind: "unit", id: u.unit }, { at });
    const onCall = !ds.evunit && ds.evcall ? S.units.find((x) => x.callId === ds.evcall && x.status === "out") : null;
    if (onCall) return select({ kind: "unit", id: onCall.unit }, { at });
    if (at) { if (S.view === "map") { locate(at); ping(at); } return; }
    if (ds.evdiv) return select({ kind: "station", name: areaKey(ds.evdiv) });
    return;
  }
  if (t("[data-back-to]")) return select({ kind: "station", name: t("[data-back-to]").dataset.backTo });
  if (t("[data-back]")) {
    // "‹ Units" promises the Units list; where it opens over the map, open it
    if (narrow() && S.view === "map") S.panelOpen = true;
    return select(null, { move: false });
  }
  if (t("[data-locate]")) {
    if (S.view !== "map") return setView("map"); // the map flies to the selected unit as it opens
    return locate(S.pos?.get(t("[data-locate]").dataset.locate));
  }
  if (t("[data-switch]")) { if (!S.card.to) return; addSwitch(t("[data-switch]").dataset.switch, S.card.to, S.card.why); S.card.to = null; return renderSide(); }
  if (t("[data-bring]")) { if (!S.card.pick) return; addSwitch(S.card.pick, t("[data-bring]").dataset.bring, "Balance the load"); S.card.pick = null; return renderSide(); }
  if (t("[data-close-answer]")) { $("#answer").hidden = true; return renderChips(true); }
  if (t("[data-take]")) {
    const m = S.proposals[Number(t("[data-take]").dataset.take)];
    if (m.unit && unitById(m.unit)) addSwitch(m.unit, m.to, m.reason, "Orbit, approved by the chief");
    else { S.switches.push({ unit: null, from: m.from, to: m.to, reason: m.reason, by: "Orbit, approved by the chief", t: new Date().toISOString() }); save(); render(); }
    t("[data-take]").closest(".proposal").remove();
    if (narrow() && !$("#answer .proposal")) { $("#answer").hidden = true; renderChips(true); }
    return;
  }
  if (t("[data-unswitch]")) { S.switches.splice(Number(t("[data-unswitch]").dataset.unswitch), 1); save(); return render(); }
  if (t("[data-clear-plan]")) {
    const kept = S.switches;
    S.switches = [];
    save();
    render();
    return toast(`Cleared ${kept.length} pending switch${kept.length === 1 ? "" : "es"}`, () => { S.switches = kept; save(); render(); });
  }
  if (t("[data-copy-plan]")) navigator.clipboard?.writeText(planText()).then(() => toast("Copied for dispatch"), () => toast("Copy did not work here"));
});
document.addEventListener("keydown", (e) => {
  if (ddOpen) {
    const opts = [...document.querySelectorAll("#ddmenu .dd-opt")];
    const i = opts.findIndex((o) => o.classList.contains("active"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const j = Math.max(0, Math.min(opts.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
      opts.forEach((o, k) => o.classList.toggle("active", k === j));
      opts[j]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "Enter" && opts[i]) { e.preventDefault(); return pickDD(opts[i].dataset.ddv); }
    if (e.key === "Escape") return closeDD();
  }
  if (e.key === "Escape" && (!e.target.closest("input") || !e.target.value)) {
    e.target.blur?.();
    $("#answer").hidden = true; renderChips(true); S.panelOpen = false;
    if (S.sel) select(null, { move: false }); else renderSide();
  }
});
// drag a unit to another station
document.addEventListener("dragstart", (e) => { const t = e.target.closest?.("[data-tile]"); if (!t) return; e.dataTransfer.setData("text/plain", t.dataset.tile); e.dataTransfer.effectAllowed = "move"; t.classList.add("dragging"); });
document.addEventListener("dragend", (e) => { e.target.closest?.("[data-tile]")?.classList.remove("dragging"); document.querySelectorAll(".col.over").forEach((c) => c.classList.remove("over")); });
document.addEventListener("dragover", (e) => { const c = e.target.closest?.("[data-col]"); if (!c) return; e.preventDefault(); document.querySelectorAll(".col.over").forEach((x) => x !== c && x.classList.remove("over")); c.classList.add("over"); });
document.addEventListener("drop", (e) => {
  const c = e.target.closest?.("[data-col]");
  if (!c) return;
  e.preventDefault();
  c.classList.remove("over");
  const unit = e.dataTransfer.getData("text/plain");
  const u = unitById(unit);
  if (u?.home && effectiveHome(u) !== c.dataset.col) addSwitch(unit, c.dataset.col, "Moved on the board");
});
$("#ask").addEventListener("submit", (e) => { e.preventDefault(); ask($("#q").value); });
$("#hist").addEventListener("click", () => toggleHeat());
$("#view3d").addEventListener("click", toggle3d);
$("#home").addEventListener("click", () => S.map.flyTo({ ...homeCamera(), duration: 1800, essential: true }));
$("#panel").addEventListener("click", () => { S.panelOpen = !S.panelOpen || !!S.sel; if (S.sel) S.sel = null; S.tab = S.tab === "stations" && !phone() ? "units" : S.tab; render(); });
let resizing;
addEventListener("resize", () => { clearTimeout(resizing); resizing = setTimeout(() => { closeDD(); render(); renderHeatBar(); S.map?.setPadding(freeRect()); }, 150); });

renderChips(true);
setupMic();
tick();
await makeMap();
await refresh();
S.map.flyTo({ ...homeCamera(), duration: 4200, essential: true, curve: 1.6 });
setInterval(refresh, 30000);
setInterval(tick, 1000);
window.__live = { state: () => ({ units: S.units.length, calls: S.calls.length, sel: S.sel, view: S.view, switches: S.switches.length, zoom: S.map?.getZoom(), pitch: S.map?.getPitch(), panelOpen: S.panelOpen }), ask, select, setView, addSwitch, toast, map: () => S.map, pos: (id) => S.pos.get(id) };
