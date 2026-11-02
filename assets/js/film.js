// R2 concept film: every frame is a pure function of t (seconds), so tools/record.mjs can render it
// frame by frame. Modes: ?mode=film (default), ?mode=hero (12 s seamless loop), ?mode=still&name=...
import * as THREE from 'three';
import { createStage, ease, easeInOut, easeOut, lerp, seg, clamp01 } from './stage.js';
import { loadR2, loadStation, splitMesh, contactShadow, makeTray } from './r2.js';
import { makeElevator, makeHallway, makeTower, makeTrail, canvasTex, glowMat, setGlowK, C } from './env.js';
import { BRAND, ROBOT, SITE_URL } from './config.js';

const q = new URLSearchParams(location.search);
const MODE = q.get('mode') || 'film';
const W = +q.get('w') || 1920, H = +q.get('h') || 1080, PR = +q.get('pr') || 1;
const CLEAN = q.has('clean') || MODE !== 'film';
const DURATION = 68, HERO_T = 12;
window.FILM_DURATION = MODE === 'hero' ? HERO_T : DURATION;
if (CLEAN) document.getElementById('wrap').classList.add('clean');

document.querySelectorAll('[data-brand]').forEach((e) => { e.textContent = BRAND; });
document.querySelectorAll('[data-url]').forEach((e) => { e.textContent = SITE_URL; });
document.querySelectorAll('[data-fine]').forEach((e) => { e.textContent = `Concept film rendered from our CAD models. ${ROBOT} is in development; nothing here is footage of a working robot.`; });

// canvas textures (screens, labels, plates) need the web fonts before they are drawn
await Promise.all(['600 64px Inter', '700 64px Inter', '500 20px Inter', '400 20px Inter', '500 20px "JetBrains Mono"', '600 20px "JetBrains Mono"'].map((f) => document.fonts.load(f))).catch(() => {});
const st = createStage({ canvas: document.getElementById('c'), width: W, height: H, pixelRatio: PR, floorSize: 400 });
const { scene, camera } = st;
st.grade.uniforms.uGrain.value = q.has('grain') ? +q.get('grain') : MODE === 'hero' ? 0.01 : 0.018;

const SET = {
  wake: new THREE.Vector3(-30, 0, 0),
  station: new THREE.Vector3(0, 0, 0),
  elev: new THREE.Vector3(30, 0, 0),
  hall: new THREE.Vector3(60, 0, 0),
  tower: new THREE.Vector3(120, 0, 0),
};

// ------------------------------------------------------------------ assets
const [r2, s2] = await Promise.all([loadR2('assets/models/robot_v2.glb'), loadStation('assets/models/station_v2.glb')]);
scene.add(r2.root, s2.root);
r2.root.add(contactShadow(0.95, 0.95, 0.6));
const eyeMat = r2.eyeMat;
const bodyGlow = r2.glow.filter((m) => m !== eyeMat);
const rackLight = r2.body.getObjectByName('rack_backlight')?.material;
const elev = makeElevator(); elev.group.position.copy(SET.elev); scene.add(elev.group);
const hall = makeHallway(); hall.group.position.copy(SET.hall); scene.add(hall.group);
const tower = makeTower(); tower.group.position.copy(SET.tower); scene.add(tower.group);
const trail = makeTrail(260, 0.36); scene.add(trail.mesh);

// x-ray for INSIDE: below a scan line the shell is solid, above it the shell is a cyan wireframe over the real internals
const SHELL = ['body_shell', 'head_cap', 'head_visor', 'head_screen', 'body_shutter', 'base_skirt', 'base_bumper', 'body_seam', 'finger_slot', 'body_guides', 'body_meter_dim'];
const solidClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10);
const ghostClip = new THREE.Plane(new THREE.Vector3(0, 1, 0), -10);
const ghostFill = new THREE.MeshBasicMaterial({ color: new THREE.Color(C.cyan).multiplyScalar(0.3), transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, clippingPlanes: [ghostClip] });
const ghostLine = new THREE.LineBasicMaterial({ color: new THREE.Color(C.cyan).multiplyScalar(1.05), transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, clippingPlanes: [ghostClip] });
const ghosts = [];
r2.body.traverse((m) => {
  if (!m.isMesh || !SHELL.includes(m.name)) return;
  m.material = m.material.clone(); m.material.clippingPlanes = [solidClip]; m.material.clipShadows = true;
  const fill = new THREE.Mesh(m.geometry, ghostFill), edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 28), ghostLine);
  fill.visible = edges.visible = false; fill.renderOrder = edges.renderOrder = 3;
  m.add(fill, edges); ghosts.push(fill, edges);
});
const scanRing = new THREE.Group();
{
  const pts = []; const hw = 0.33, hd = 0.35, r = 0.07;
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    pts.push(new THREE.Vector3(Math.sign(c) * (hw - r) + r * c, 0, -0.02 + Math.sign(sn) * (hd - r) + r * sn));
  }
  scanRing.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: new THREE.Color(C.cyan).multiplyScalar(3.0), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(2 * hw, 2 * hd), new THREE.MeshBasicMaterial({ color: new THREE.Color(C.cyan).multiplyScalar(0.5), transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  sheet.rotation.x = -Math.PI / 2; sheet.position.z = -0.02; scanRing.add(sheet);
  scanRing.visible = false; scene.add(scanRing);
}
function setXray(o, h, ringK) {
  solidClip.constant = h; ghostClip.constant = -h;
  const on = h < 1.25;
  for (const g of ghosts) g.visible = on;
  glowClip.constant = Math.min(10, h);
  for (const e of r2.eyes) e.visible = h > 1.11;
  if (rackLight) rackLight.emissiveIntensity = on ? 1.5 : 0.9;
  scanRing.visible = ringK > 0.001; scanRing.position.set(o.x, Math.max(0.005, h), o.z);
  scanRing.children[0].material.opacity = ringK; scanRing.children[1].material.opacity = 0.1 * ringK;
}

// station extras: screen, the parcel in the window, the window door, the scan line
const scr = canvasTex(512, 860, drawScreen);
const scrMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.214, 0.36), new THREE.MeshBasicMaterial({ map: scr.tex }));
scrMesh.position.set(-0.465, 1.04, 0.2918); s2.root.add(scrMesh);
const parcel = new THREE.Group(); s2.root.add(parcel);
const inWindow = (x, y, z) => x > -0.33 && x < 0.19 && y > 0.86 && y < 1.46 && z > -0.32;
for (const n of ['ltray_box', 'ltray_box_tape', 'ltray_box_label']) { const m = s2.byName(n); const part = m && splitMesh(m, inWindow); if (part) parcel.add(part); }
const winDoor = new THREE.Group();
const wd = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.58, 0.01), new THREE.MeshPhysicalMaterial({ color: '#0b1216', roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.9, clearcoat: 1 }));
const wdLine = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.005, 0.012), glowMat(C.cyan, 2.6));
wdLine.position.y = -0.29; winDoor.add(wd, wdLine); winDoor.position.set(-0.07, 1.78, 0.262); s2.root.add(winDoor);
const beam = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.012), glowMat(C.cyan, 3.2, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
beam.rotation.x = -Math.PI / 2; s2.root.add(beam);
const haloMat = s2.byName('station_window_halo')?.material;

// hand-off items on the robot tray
const parcelItem = r2.tray.getObjectByName('item');

// floor "ping" ring (hero)
const ping = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.0, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(C.cyan).multiplyScalar(2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
ping.rotation.x = -Math.PI / 2; ping.position.y = 0.006; scene.add(ping);

// DEPART path (station coordinates)
const departPath = new THREE.CatmullRomCurve3([
  [0.51, 0.006], [0.51, 0.6], [0.53, 1.2], [0.8, 1.78], [1.38, 2.1], [2.5, 2.2], [6.2, 2.2],
].map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
const departLen = departPath.getLength();
const departPts = departPath.getSpacedPoints(600);

// ------------------------------------------------------------------ helpers
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
function camPath(keys) {
  const P = new THREE.CatmullRomCurve3(keys.map((k) => V(k.slice(0, 3))), false, 'centripetal');
  const L = new THREE.CatmullRomCurve3(keys.map((k) => V(k.slice(3, 6))), false, 'centripetal');
  const F = keys.map((k) => k[6]);
  return (u) => {
    u = clamp01(u);
    const fi = u * (F.length - 1), i = Math.min(F.length - 2, Math.floor(fi));
    return { p: P.getPoint(u), l: L.getPoint(u), f: lerp(F[i], F[i + 1], fi - i) };
  };
}
function setCam(o, c) {
  camera.position.set(o.x + c.p.x, c.p.y, o.z + c.p.z);
  camera.lookAt(o.x + c.l.x, c.l.y, o.z + c.l.z);
  if (Math.abs(camera.fov - c.f) > 1e-4) { camera.fov = c.f; camera.updateProjectionMatrix(); }
}
const bump = (t, a, b) => { const k = seg(t, a, b); return Math.sin(Math.PI * k); };
function placeLights(o, { key = 26, rim = 22, keyPos = [-2.5, 5.2, 3.2], keyTgt = [0, 0.5, 0], rimPos = [3.0, 2.2, -3.5], rimTgt = [0, 0.9, 0], fill = 0.35, env = 0.32, fog = 0.07 } = {}) {
  st.key.intensity = key; st.key.position.set(o.x + keyPos[0], keyPos[1], o.z + keyPos[2]); st.key.target.position.set(o.x + keyTgt[0], keyTgt[1], o.z + keyTgt[2]);
  st.rim.intensity = rim; st.rim.position.set(o.x + rimPos[0], rimPos[1], o.z + rimPos[2]); st.rim.target.position.set(o.x + rimTgt[0], rimTgt[1], o.z + rimTgt[2]);
  st.fill.intensity = fill; scene.environmentIntensity = env; scene.fog.density = fog;
  st.floor.position.set(o.x, 0, o.z);
}
function robot(o, x, z, ry) { r2.root.position.set(o.x + x, 0, o.z + z); r2.root.rotation.set(0, ry, 0); }
st.renderer.localClippingEnabled = true;
const glowClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10);
for (const m of r2.glow) if (m !== r2.eyeMat) m.clippingPlanes = [glowClip];
const GLOW = 0.66; // body strips: bright enough to bloom a little, not a lot
function setBodyGlow(k) { for (const m of bodyGlow) m.emissiveIntensity = 4.0 * GLOW * k; if (rackLight) rackLight.emissiveIntensity = 0.9 * Math.max(0.15, k); }
function setEyeGlow(k) { eyeMat.emissiveIntensity = 5.0 * k; }
function showSets(name) {
  s2.root.visible = name === 'station';
  elev.group.visible = name === 'elev';
  hall.group.visible = name === 'hall';
  tower.group.visible = name === 'tower';
}

// ------------------------------------------------------------------ station screen
function drawScreen(x, w, h, state) {
  x.fillStyle = '#03080a'; x.fillRect(0, 0, w, h);
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(46,230,240,0.10)'); g.addColorStop(0.4, 'rgba(46,230,240,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  x.fillStyle = '#2EE6F0'; x.font = '600 28px "JetBrains Mono", monospace'; x.fillText('DROP-OFF', 40, 74);
  x.fillStyle = 'rgba(255,255,255,0.45)'; x.font = '500 22px "JetBrains Mono", monospace'; x.fillText(`${BRAND.toUpperCase()} ${'S2'}`, 40, 108);
  x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(40, 130, w - 80, 2);
  const btn = (y, label, filled, glow) => {
    x.beginPath(); x.roundRect(40, y, w - 80, 86, 43);
    if (filled) { x.fillStyle = glow ? '#8ff8ff' : '#2EE6F0'; x.fill(); x.fillStyle = '#021014'; }
    else { x.strokeStyle = 'rgba(255,255,255,0.4)'; x.lineWidth = 3; x.stroke(); x.fillStyle = 'rgba(255,255,255,0.85)'; }
    x.font = '600 32px Inter, Arial'; x.textAlign = 'center'; x.fillText(label, w / 2, y + 55); x.textAlign = 'left';
  };
  if (state === 'idle' || state === 'read') {
    x.fillStyle = '#fff'; x.font = '600 52px Inter, Arial'; x.fillText('Place it', 40, 250); x.fillText('in the window', 40, 312);
    x.fillStyle = 'rgba(255,255,255,0.6)'; x.font = '400 28px Inter, Arial'; x.fillText('The label is read for you.', 40, 370);
    if (state === 'read') {
      x.fillStyle = '#2EE6F0'; x.font = '600 30px "JetBrains Mono", monospace'; x.fillText('READING LABEL…', 40, 520);
      x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(40, 548, w - 80, 10); x.fillStyle = '#2EE6F0'; x.fillRect(40, 548, (w - 80) * 0.62, 10);
    } else {
      x.strokeStyle = '#2EE6F0'; x.lineWidth = 6; x.beginPath(); x.moveTo(w / 2, 480); x.lineTo(w / 2, 600); x.moveTo(w / 2 - 40, 560); x.lineTo(w / 2, 600); x.lineTo(w / 2 + 40, 560); x.stroke();
    }
  } else if (state === 'found' || state === 'confirm') {
    x.fillStyle = 'rgba(255,255,255,0.6)'; x.font = '500 26px Inter, Arial'; x.fillText('Apartment', 40, 200);
    x.fillStyle = '#fff'; x.font = '700 168px Inter, Arial'; x.fillText('1104', 30, 360);
    x.fillStyle = '#2EE6F0'; x.font = '600 34px Inter, Arial'; x.fillText('Apartment found ✓', 40, 430);
    btn(560, state === 'confirm' ? 'Confirmed ✓' : 'Confirm', true, state === 'confirm');
    btn(666, 'Type apartment', false);
  } else if (state === 'stored') {
    x.fillStyle = '#2EE6F0'; x.beginPath(); x.arc(w / 2, 300, 92, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#021014'; x.lineWidth = 16; x.lineCap = 'round'; x.beginPath(); x.moveTo(w / 2 - 42, 302); x.lineTo(w / 2 - 10, 334); x.lineTo(w / 2 + 46, 270); x.stroke();
    x.fillStyle = '#fff'; x.font = '600 50px Inter, Arial'; x.textAlign = 'center'; x.fillText('Stored', w / 2, 480);
    x.fillStyle = 'rgba(255,255,255,0.65)'; x.font = '400 28px Inter, Arial'; x.fillText(`${ROBOT} is taking it to 1104`, w / 2, 532); x.textAlign = 'left';
    x.fillStyle = 'rgba(255,255,255,0.4)'; x.font = '500 24px "JetBrains Mono", monospace'; x.fillText('NEXT COURIER: GO AHEAD', 40, 780);
  }
}

// ------------------------------------------------------------------ overlays
const $ = (id) => document.getElementById(id);
const ov = { fade: $('fade'), dim: $('dim'), chip: $('chip'), caption: $('caption'), floor: $('floor'), notify: $('notify'), end: $('end') };
const capEls = { label: ov.caption.querySelector('.label'), title: ov.caption.querySelector('.title'), sub: ov.caption.querySelector('.sub'), tag: ov.caption.querySelector('.tag') };
const floorN = ov.floor.querySelector('.n'), trace = $('trace'), traceDot = $('traceDot');
const U = innerWidth / 1920;
const CAPS = [
  { t0: 3.3, t1: 5.55, label: `${ROBOT} · in development`, title: 'The last hundred steps.' },
  { t0: 6.9, t1: 14.6, label: '01 · Drop-off', title: 'Couriers drop it off in seconds.', sub: 'No app. No key.' },
  { t0: 16.0, t1: 21.55, label: '02 · Depart', title: `${ROBOT} takes it from there.` },
  { t0: 22.8, t1: 31.55, label: '03 · Call', title: 'It presses the button like a person.', sub: 'Nothing to install on the elevator.' },
  { t0: 32.7, t1: 39.6, label: '04 · Ride', title: 'Taps the building’s own fob.', sub: 'Counts floors with no signal.' },
  { t0: 40.9, t1: 49.6, label: '05 · Deliver', title: 'Handed over at counter height.', sub: 'Nobody home? Left on the mat, with a photo.' },
  { t0: 50.7, t1: 55.55, label: '06 · Inside', title: 'Designed down to the parts list.', sub: 'Belt trays, the finger mast and fob, lidars and the drive base.' },
  { t0: 56.7, t1: 59.55, label: '07 · Every floor', title: 'Every package. Every floor.' },
  { t0: 59.85, t1: 62.85, label: '07 · Every floor', title: 'Apartments first. Then any building with an elevator.' },
];
const FADES = [[0, 0.9, 1, 0], [5.6, 6.0, 0, 1], [6.0, 6.4, 1, 0], [21.65, 22.0, 0, 1], [22.0, 22.35, 1, 0], [27.45, 27.6, 0, 1], [27.6, 27.85, 1, 0], [31.8, 32.0, 0, 1], [32.0, 32.25, 1, 0], [39.65, 40.0, 0, 1], [40.0, 40.35, 1, 0], [49.65, 50.0, 0, 1], [50.0, 50.35, 1, 0], [55.6, 56.0, 0, 1], [56.0, 56.5, 1, 0]];
let capKey = -1;
function overlays(t) {
  let f = 0;
  for (const [a, b, x, y] of FADES) if (t >= a && t <= b) f = lerp(x, y, easeInOut(seg(t, a, b)));
  ov.fade.style.opacity = f.toFixed(3);
  if (CLEAN) return;
  ov.chip.style.opacity = (0.6 * ease(seg(t, 0.6, 1.4))).toFixed(3);
  // captions
  const i = CAPS.findIndex((c) => t >= c.t0 && t <= c.t1);
  if (i >= 0) {
    const c = CAPS[i];
    if (capKey !== i) { capKey = i; capEls.label.textContent = c.label || ''; capEls.title.textContent = c.title || ''; capEls.sub.textContent = c.sub || ''; capEls.tag.textContent = c.tag || ''; capEls.sub.style.display = c.sub ? '' : 'none'; }
    const a = easeOut(seg(t, c.t0, c.t0 + 0.6)) * (1 - easeInOut(seg(t, c.t1 - 0.45, c.t1)));
    ov.caption.style.opacity = a.toFixed(3);
    ov.caption.style.transform = `translateY(${((1 - easeOut(seg(t, c.t0, c.t0 + 0.7))) * 22 * U).toFixed(2)}px)`;
  } else ov.caption.style.opacity = '0';
  // floor counter
  const fa = ease(seg(t, 36.35, 36.8)) * (1 - ease(seg(t, 39.45, 39.8)));
  ov.floor.style.opacity = fa.toFixed(3);
  if (fa > 0) {
    const n = floorAt(t); floorN.textContent = n === 1 ? 'L' : String(n);
    const pts = []; const t0 = 36.5, t1 = 39.6;
    const tn = Math.min(t, t1);
    for (let s = t0; s <= tn + 1e-6; s += 0.04) pts.push(`${((s - t0) / (t1 - t0) * 420).toFixed(1)},${(126 - altAt(s) / 30 * 112).toFixed(1)}`);
    trace.setAttribute('points', pts.join(' '));
    const last = pts[pts.length - 1] || '0,126'; const [lx, ly] = last.split(',');
    traceDot.setAttribute('cx', lx); traceDot.setAttribute('cy', ly);
  }
  // notification
  const na = easeOut(seg(t, 46.7, 47.2)) * (1 - ease(seg(t, 49.4, 49.8)));
  ov.notify.style.opacity = na.toFixed(3);
  ov.notify.style.transform = `translateX(${((1 - easeOut(seg(t, 46.7, 47.3))) * 60 * U).toFixed(2)}px)`;
  // end card
  ov.dim.style.opacity = (0.82 * ease(seg(t, 62.9, 64.0))).toFixed(3);
  const ea = easeOut(seg(t, 63.4, 64.4));
  ov.end.style.opacity = ea.toFixed(3);
  ov.end.style.transform = `scale(${(0.985 + 0.015 * ea).toFixed(4)})`;
}
// part callouts for INSIDE: anchors are robot-local points on parts that exist in the CAD
const CALLOUTS = [
  { t: 52.2, text: 'BELT TRAYS', at: [-0.2, 0.62, 0.1], dx: -250, dy: -70 },
  { t: 52.7, text: 'FINGER MAST · FOB', at: [0.2, 0.89, 0.3], dx: 230, dy: -80 },
  { t: 53.2, text: 'LIDAR · DRIVE BASE', at: [0.22, 0.15, 0.24], dx: 250, dy: 30 },
];
const svgNS = 'http://www.w3.org/2000/svg';
const callSvg = document.getElementById('callouts');
callSvg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
const callEls = CALLOUTS.map((c) => {
  const g = document.createElementNS(svgNS, 'g');
  const line = document.createElementNS(svgNS, 'polyline'), dot = document.createElementNS(svgNS, 'circle'), ring = document.createElementNS(svgNS, 'circle'), text = document.createElementNS(svgNS, 'text');
  line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#2EE6F0'); line.setAttribute('stroke-width', String(1.5 * U));
  dot.setAttribute('r', String(4.5 * U)); dot.setAttribute('fill', '#2EE6F0');
  ring.setAttribute('r', String(11 * U)); ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', 'rgba(46,230,240,0.55)'); ring.setAttribute('stroke-width', String(1.2 * U));
  text.textContent = c.text; text.setAttribute('fill', '#ffffff'); text.setAttribute('font-family', 'JetBrains Mono, monospace'); text.setAttribute('font-weight', '500');
  text.setAttribute('font-size', String(17 * U)); text.setAttribute('letter-spacing', String(2.6 * U)); text.setAttribute('text-anchor', c.dx < 0 ? 'end' : 'start');
  g.append(line, ring, dot, text); callSvg.appendChild(g); return { g, line, dot, ring, text };
});
const tmpV = new THREE.Vector3();
function calloutsOff() { callSvg.style.opacity = '0'; }
function callouts(t, o) {
  if (CLEAN) return;
  camera.updateMatrixWorld();
  callSvg.style.opacity = '1';
  CALLOUTS.forEach((c, i) => {
    const e = callEls[i];
    const a = easeOut(seg(t, c.t, c.t + 0.45)) * (1 - ease(seg(t, 54.6, 54.95)));
    e.g.style.opacity = a.toFixed(3);
    tmpV.set(o.x + c.at[0], c.at[1], o.z + c.at[2]).project(camera);
    const x = (tmpV.x + 1) / 2 * innerWidth, y = (1 - tmpV.y) / 2 * innerHeight;
    const grow = easeOut(seg(t, c.t, c.t + 0.4));
    const ex = x + c.dx * U * 0.55 * grow, ey = y + c.dy * U * grow, lx = x + c.dx * U * grow;
    e.line.setAttribute('points', `${x.toFixed(1)},${y.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)} ${lx.toFixed(1)},${ey.toFixed(1)}`);
    e.dot.setAttribute('cx', x.toFixed(1)); e.dot.setAttribute('cy', y.toFixed(1));
    e.ring.setAttribute('cx', x.toFixed(1)); e.ring.setAttribute('cy', y.toFixed(1));
    e.text.setAttribute('x', (lx + (c.dx < 0 ? -10 : 10) * U).toFixed(1)); e.text.setAttribute('y', (ey + 6 * U).toFixed(1));
  });
}
const altAt = (t) => 30 * easeInOut(seg(t, 36.8, 39.5));
const floorAt = (t) => Math.min(11, 1 + Math.floor(altAt(t) / 3.0 + 1e-6));

// ------------------------------------------------------------------ the film
const cams = {
  wake: camPath([[0, 1.1, 0.95, 0, 1.09, 0.27, 30], [-0.12, 1.13, 1.45, 0.0, 1.0, 0.1, 31], [-1.0, 1.2, 2.45, 0.03, 0.72, 0, 32], [-1.81, 1.1, 2.59, 0, 0.6, 0, 32]]),
  drop: camPath([[-1.32, 1.4, 2.25, -0.2, 1.06, 0.16, 32], [-0.75, 1.32, 2.15, -0.08, 1.03, 0.12, 32], [0.15, 1.2, 2.35, 0.12, 0.95, 0.1, 33], [1.25, 1.06, 2.6, 0.42, 0.8, 0.05, 34]]),
  depart: camPath([[1.25, 1.06, 2.6, 0.42, 0.8, 0.05, 34], [1.5, 0.7, 3.3, 0.5, 0.6, 0.4, 34]]),
  call: camPath([[-1.55, 1.52, 3.0, 0.75, 0.98, 0.55, 36], [-0.6, 1.36, 1.9, 0.92, 1.0, 0.3, 34], [-0.05, 1.25, 0.95, 0.96, 1.05, 0.08, 31], [0.1, 1.2, 0.42, 0.98, 1.04, 0.02, 30]]),
  board: camPath([[-0.62, 1.5, -1.28, 0.14, 0.92, 1.3, 50], [-0.6, 1.48, -1.25, 0.08, 0.86, 0.6, 50]]),
  rideA: camPath([[2.2, 1.25, -1.1, 0.62, 0.9, -0.25, 32], [1.75, 0.98, -0.6, 0.69, 0.87, -0.17, 27]]),
  rideB: camPath([[1.75, 1.1, -0.6, 0.69, 1.0, -0.17, 27], [2.6, 1.85, -1.75, 0.2, 1.0, -0.5, 36]]),
  hallIn: camPath([[0.5, 1.02, 0.6, -0.2, 0.78, -2.0, 40], [0.42, 1.2, 1.6, -0.4, 0.8, -0.6, 38], [0.25, 1.35, 2.1, -0.6, 0.85, -0.05, 38]]),
  hallHold: camPath([[0.25, 1.35, 2.1, -0.6, 0.85, -0.05, 38], [0.13, 1.31, 1.82, -0.62, 0.85, -0.05, 37]]),
};

const departDist = (t) => {
  const a = 16.2, ramp = 1.2, v = 1.1;
  if (t <= a) return 0;
  if (t <= a + ramp) return v * (t - a) ** 2 / (2 * ramp);
  return v * ramp / 2 + v * (t - a - ramp);
};

function resetState() {
  st.bloomPass.strength = 0.6; st.floor.visible = true; st.renderer.toneMappingExposure = 1.0; glowClip.constant = 10;
  setXray(SET.wake, 10, 0); calloutsOff();
  r2.root.visible = true; r2.setPod(0.9); r2.setSlide(0); r2.pod.position.z = 0; r2.setEyes(1, 0);
  setBodyGlow(1); setEyeGlow(1); r2.setTray(0); if (r2.shutter) r2.shutter.visible = true;
  parcelItem.visible = true; parcelItem.position.set(0, 0.033, 0);
  trail.mesh.visible = false; ping.visible = false;
  // station
  scr.redraw('idle'); parcel.position.set(0, 0, 0); parcel.visible = true; winDoor.position.y = 1.78; beam.visible = false;
  if (haloMat) haloMat.emissiveIntensity = 4.0;
  // elevator
  elev.setDoors(0); setGlowK(elev.ringMat, 0); elev.lantern.redraw(false); elev.spill.intensity = 0; setGlowK(elev.ledMat, 1.5); elev.ledMat.userData.base.set('#ff3b3b'); setGlowK(elev.ledMat, 1.5);
  setGlowK(elev.btn11Mat, 0); elev.COP.tex.redraw('0|0'); elev.ind.redraw('L'); elev.rightWall.forEach((m) => { m.visible = true; });
  // hall
  hall.door1104.leaf.rotation.y = 0; hall.warm.intensity = 0; hall.warmSpot.intensity = 0; setGlowK(hall.glowWall.material, 0.9);
}

function film(t) {
  resetState();
  // ------------------------------------------------ 0 WAKE
  if (t < 6.0) {
    const o = SET.wake; showSets('wake');
    const lit = ease(seg(t, 1.6, 4.4));
    placeLights(o, { key: lerp(1.5, 26, lit), rim: lerp(6, 22, lit), fill: lerp(0.05, 0.35, lit), env: lerp(0.06, 0.32, lit) });
    st.renderer.toneMappingExposure = lerp(0.3, 1.0, lit);
    glowClip.constant = lerp(-0.02, 1.36, easeInOut(seg(t, 1.0, 2.7)));
    robot(o, 0, 0, 0);
    const open = ease(seg(t, 0.7, 1.25)) * (1 - 0.92 * bump(t, 2.15, 2.47));
    r2.setEyes(Math.max(0.08, open), 0);
    const c = cams.wake(easeInOut(seg(t, 1.5, 5.9)));
    setCam(o, c);
    const near = ease(seg(c.p.distanceTo(new THREE.Vector3(0, 1.1, 0.27)), 0.35, 1.6));
    setEyeGlow(ease(seg(t, 0.6, 1.3)) * lerp(0.45, 1, near) / lerp(0.3, 1.0, lit));
    setBodyGlow(lerp(0.6, 1, near) / lerp(0.3, 1.0, lit));
    st.bloomPass.strength = lerp(0.32, 0.6, near);
    return;
  }
  // ------------------------------------------------ 1 DROP + 2 DEPART (station)
  if (t < 22.0) {
    const o = SET.station; showSets('station'); placeLights(o, { keyPos: [-2.2, 5.4, 3.6], keyTgt: [0, 0.8, 0], rim: 16 });
    // screen state
    scr.redraw(t < 7.55 ? 'idle' : t < 8.5 ? 'read' : t < 9.35 ? 'found' : t < 10.9 ? 'confirm' : 'stored');
    // parcel: settles onto the window tray, the belt draws it in, then it is stored
    const drop = seg(t, 6.0, 6.55);
    const settle = drop < 1 ? (1 - easeOut(drop)) * 0.035 : 0;
    const draw = easeInOut(seg(t, 6.75, 7.5));
    parcel.position.set(0, settle, 0.17 * (1 - draw));
    parcel.visible = t < 11.2;
    if (t > 7.55 && t < 8.55) { beam.visible = true; const k = seg(t, 7.6, 8.45); beam.position.set(-0.07, 1.36, 0.2 - 0.42 * easeInOut(k)); beam.material.opacity = bump(t, 7.55, 8.55); }
    winDoor.position.y = lerp(1.78, 1.16, easeInOut(seg(t, 9.8, 10.75)));
    if (haloMat) haloMat.emissiveIntensity = 4.0 * (1 + 0.5 * bump(t, 8.45, 9.2));
    // robot: docked, then out along the path
    const d = departDist(t);
    if (d <= 0) {
      robot(o, 0.51, 0.006, 0);
      const look = t > 14.2 && t < 16.2 ? 0.7 * bump(t, 14.2, 16.2) : 0;
      r2.setEyes(1 - 0.92 * bump(t, 12.6, 12.9), look);
    } else {
      const u = Math.min(1, d / departLen);
      const p = departPath.getPointAt(u), tg = departPath.getTangentAt(u);
      robot(o, p.x, p.z, Math.atan2(tg.x, tg.z));
      // light trail behind it
      const n = Math.max(2, Math.round(u * 600));
      const start = Math.round((0.55 / departLen) * 600);
      if (n > start + 2) {
        trail.mesh.visible = true;
        const pts = departPts.slice(start, n + 1).map((v) => new THREE.Vector3(v.x + o.x, 0, v.z + o.z));
        const step = Math.max(1, Math.floor(pts.length / 250));
        trail.set(pts.filter((_, i) => i % step === 0 || i === pts.length - 1), 3.2, 2.6);
      }
    }
    if (t < 15.0) setCam(o, cams.drop(easeInOut(seg(t, 6.0, 15.0))));
    else {
      // settle low in front of the bay, then track alongside R2 as it glides out (trail streaming behind)
      const c = cams.depart(easeInOut(seg(t, 15.0, 17.0)));
      const rp = r2.root.position, rx = rp.x - o.x, rz = rp.z - o.z;
      const k = easeInOut(seg(t, 16.3, 18.6));
      c.p.set(lerp(c.p.x, rx + 0.75, k), lerp(c.p.y, 0.62, k), lerp(c.p.z, rz + 3.2, k));
      c.l.set(lerp(c.l.x, rx + 0.25, k), lerp(c.l.y, 0.5, k), lerp(c.l.z, rz, k));
      setCam(o, c);
    }
    return;
  }
  // ------------------------------------------------ 3 CALL (elevator lobby)
  if (t < 27.6) {
    const o = SET.elev; showSets('elev'); placeLights(o, { keyPos: [-1.0, 5.0, 3.4], keyTgt: [0.6, 0.6, 0.4], rimPos: [3.5, 2.4, 2.8], rimTgt: [1.1, 0.9, 0.3], rim: 7 });
    const z = lerp(2.75, 0.348, easeOut(seg(t, 22.0, 24.9)));
    robot(o, 1.15, z, Math.PI);
    r2.setPod(lerp(0.9, 1.076, easeInOut(seg(t, 24.4, 25.7))));
    r2.setSlide(-0.012 * bump(t, 25.1, 25.9));
    r2.pod.position.z = 0.0135 * (easeInOut(seg(t, 26.1, 26.4)) - easeInOut(seg(t, 26.65, 26.95)));
    const lit = ease(seg(t, 26.33, 26.5));
    setGlowK(elev.ringMat, 3.4 * lit);
    r2.setEyes(1, 0.9 * ease(seg(t, 24.2, 24.8)) * (1 - ease(seg(t, 27.0, 27.5))));
    setCam(o, cams.call(easeInOut(seg(t, 22.0, 27.6))));
    return;
  }
  // ------------------------------------------------ 3b BOARD (camera inside the car, doors open)
  if (t < 32.0) {
    const o = SET.elev; showSets('elev'); placeLights(o, { key: 5, keyPos: [-1.0, 5.0, 3.4], keyTgt: [0, 0.4, 1.2], rim: 5, rimPos: [2.5, 2.4, 3.0], rimTgt: [0, 0.8, 1.3] });
    st.bloomPass.strength = 0.4;
    setGlowK(elev.ringMat, 3.4 * (1 - ease(seg(t, 28.6, 29.0))));
    elev.lantern.redraw(t > 27.9);
    const open = easeInOut(seg(t, 28.0, 29.4)) * (1 - easeInOut(seg(t, 31.3, 32.0)));
    elev.setDoors(open);
    elev.spill.intensity = 3 * open;
    const z = lerp(1.48, -0.62, easeInOut(seg(t, 29.6, 31.95)));
    robot(o, 0.0, z, Math.PI);
    r2.setEyes(1 - 0.92 * bump(t, 29.0, 29.3), 0);
    setCam(o, cams.board(easeInOut(seg(t, 27.6, 32.0))));
    return;
  }
  // ------------------------------------------------ 4 RIDE (car cross-section)
  if (t < 40.0) {
    const o = SET.elev; showSets('elev'); placeLights(o, { key: 0, rim: 3, rimPos: [3.0, 2.4, -2.4], rimTgt: [0.5, 1.0, -0.5], fill: 0.4, env: 0.36 });
    elev.rightWall.forEach((m) => { m.visible = false; });
    robot(o, 0.515, -0.49, 0);
    // tap the fob, then press 11
    const down = easeInOut(seg(t, 32.8, 33.7)), up = easeInOut(seg(t, 34.9, 35.8));
    r2.setPod(lerp(lerp(0.9, 0.836, down), 1.106, up));
    r2.setSlide(lerp(lerp(0, -0.015, down), 0.035, up));
    const tap = easeInOut(seg(t, 33.75, 34.05)) - easeInOut(seg(t, 34.5, 34.8));
    const press = easeInOut(seg(t, 35.85, 36.15)) - easeInOut(seg(t, 36.25, 36.5));
    r2.pod.position.z = 0.012 * tap + 0.0335 * press;
    const green = t > 34.0;
    elev.ledMat.userData.base.set(green ? '#38ff8b' : '#ff3b3b'); setGlowK(elev.ledMat, green ? 2.6 : 1.5);
    const lit11 = t > 36.1;
    setGlowK(elev.btn11Mat, lit11 ? 3.2 : 0); elev.COP.tex.redraw(lit11 ? '11|1' : '0|0');
    const n = floorAt(t); elev.ind.redraw(n === 1 ? 'L' : String(n));
    r2.setEyes(1 - 0.92 * bump(t, 37.4, 37.7), t < 36.6 ? 0.8 : 0);
    if (t < 36.5) { const c = cams.rideA(easeInOut(seg(t, 32.0, 34.3))); const k = easeInOut(seg(t, 34.8, 35.9)); c.l.y += 0.2 * k; c.p.y += 0.12 * k; setCam(o, c); }
    else setCam(o, cams.rideB(easeInOut(seg(t, 36.5, 40.0))));
    return;
  }
  // ------------------------------------------------ 5 DELIVER (hallway)
  if (t < 50.0) {
    const o = SET.hall; showSets('hall');
    placeLights(o, { key: 7, keyPos: [0.7, 1.75, 2.9], keyTgt: [-0.4, 0.7, 0], rim: 0, fill: 0.26, env: 0.28, fog: 0.05 });
    st.bloomPass.strength = 0.48;
    robot(o, -0.37, lerp(-2.2, 0.02, 1 - (1 - seg(t, 40.0, 43.3)) ** 2), 0);
    // door + warm light
    const openA = easeInOut(seg(t, 43.4, 44.6));
    hall.door1104.leaf.rotation.y = -1.43 * openA;
    hall.warm.intensity = 9 * openA; hall.warmSpot.intensity = 19 * openA; setGlowK(hall.glowWall.material, 0.9 + 0.5 * openA);
    // tray out with the parcel, parcel taken inside, tray back in
    const out = easeInOut(seg(t, 44.7, 46.4)) * (1 - easeInOut(seg(t, 48.6, 49.5)));
    if (r2.shutter) r2.shutter.visible = out < 0.001;
    r2.setTray(out);
    const take = easeInOut(seg(t, 47.4, 48.5));
    parcelItem.visible = take < 0.999;
    parcelItem.position.set(-0.75 * take, 0.033 + 0.05 * bump(t, 47.4, 48.5) + 0.03 * take, 0);
    r2.setEyes(1 - 0.92 * bump(t, 45.0, 45.3), t > 44.2 && t < 49.3 ? -0.8 : 0);
    if (t < 44.0) setCam(o, cams.hallIn(easeInOut(seg(t, 40.0, 44.0))));
    else setCam(o, cams.hallHold(easeInOut(seg(t, 44.0, 50.0))));
    return;
  }
  // ------------------------------------------------ 6 INSIDE (CAD x-ray)
  if (t < 56.0) {
    const o = SET.wake; showSets('wake');
    placeLights(o, { key: 20, rim: 14, rimPos: [3.4, 3.2, -1.3], rimTgt: [0, 1.0, 0] });
    robot(o, 0, 0, 0);
    // scan line: down 51.0-52.4 (shell -> wireframe), back up 54.9-55.6
    const h = lerp(1.26, -0.03, easeInOut(seg(t, 51.0, 52.4))) + 1.29 * easeInOut(seg(t, 54.9, 55.6));
    setXray(o, h, Math.max(bump(t, 50.95, 52.45), bump(t, 54.85, 55.65)));
    const s = easeInOut(seg(t, 50.0, 56.0));
    const az = lerp(-0.98, -0.5, s), d = lerp(3.25, 2.8, s), y = lerp(1.32, 1.12, s);
    camera.position.set(o.x + Math.sin(az) * d, y, o.z + Math.cos(az) * d);
    const fwd = new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    camera.lookAt(o.x - right.x * 0.12, 0.6, o.z - right.z * 0.12);
    if (camera.fov !== 32) { camera.fov = 32; camera.updateProjectionMatrix(); }
    callouts(t, o);
    return;
  }
  // ------------------------------------------------ 7 EVERY FLOOR + END (tower)
  {
    const o = SET.tower; showSets('tower'); r2.root.visible = false;
    placeLights(o, { key: 0, rim: 0, fill: 0.2, env: 0.2, fog: 0.018 });
    st.floor.visible = false;
    tower.update(t);
    const s = easeInOut(seg(t, 56.0, 66.0));
    const a = -0.2 - 0.3 * s, r = lerp(12.5, 19.6, s), y = lerp(0.9, 3.4, s), ly = lerp(2.8, 6.3, s);
    camera.position.set(o.x + Math.sin(a) * r, y, o.z + Math.cos(a) * r);
    camera.lookAt(o.x, ly, o.z);
    if (camera.fov !== 36) { camera.fov = 36; camera.updateProjectionMatrix(); }
  }
}

// ------------------------------------------------------------------ hero loop (12 s, seamless)
function hero(t) {
  resetState();
  const o = SET.wake; showSets('wake'); placeLights(o, { rim: 15, rimPos: [3.4, 3.2, -1.3], rimTgt: [0, 1.0, 0] });
  robot(o, 0, 0, 0);
  const ph = (t % HERO_T) / HERO_T;
  const breathe = 1 + 0.07 * Math.sin(2 * Math.PI * ph * 2);
  setBodyGlow(breathe); setEyeGlow(1);
  r2.setEyes(1 - 0.92 * bump(t % HERO_T, 6.0, 6.32), 0.35 * Math.sin(2 * Math.PI * ph));
  ping.visible = true;
  const pp = (t % (HERO_T / 2)) / (HERO_T / 2);
  const rr = 0.45 + 2.8 * easeOut(pp);
  ping.scale.set(rr, rr, rr); ping.position.set(o.x, 0.006, o.z);
  ping.material.opacity = 0.4 * (1 - pp) ** 2 * ease(seg(pp, 0, 0.08));
  const az = -0.58 + 0.15 * Math.sin(2 * Math.PI * ph);
  const d = 3.55 + 0.12 * Math.sin(2 * Math.PI * ph + 1.2), y = 1.12 + 0.06 * Math.sin(2 * Math.PI * ph + 0.4);
  camera.position.set(o.x + Math.sin(az) * d, y, o.z + Math.cos(az) * d);
  // aim left of the robot so it sits right of centre, leaving room for the headline
  const fwd = new THREE.Vector3(o.x - camera.position.x, 0, o.z - camera.position.z).normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  camera.lookAt(o.x - right.x * 0.62, 0.66, o.z - right.z * 0.62);
  if (camera.fov !== 30) { camera.fov = 30; camera.updateProjectionMatrix(); }
}

// ------------------------------------------------------------------ stills
const STILLS = {
  'r2-hero': { t: 5.99, set: 'wake', cam: [-1.81, 1.10, 2.59, 0, 0.6, 0, 32] },
  'r2-front': { t: 5.99, set: 'wake', cam: [-0.39, 0.88, 3.67, 0, 0.62, 0, 30] },
  'r2-rack': { t: 5.99, set: 'wake', cam: [-2.88, 1.37, 1.16, -0.05, 0.6, 0, 32] },
  'finger-press': { t: 26.45, set: 'elev', cam: [0.1, 1.2, 0.42, 0.98, 1.04, 0.02, 30] },
  'fob-tap': { t: 34.25, set: 'elev', cam: [1.75, 0.98, -0.6, 0.69, 0.87, -0.17, 27] },
  handoff: { t: 47.05, set: 'hall', cam: [0.25, 1.35, 2.1, -0.6, 0.85, -0.05, 38] },
  station: { t: 9.0, set: 'station', cam: [-1.41, 1.63, 4.55, 0.0, 1.15, 0.2, 32] },
  tower: { t: 60.5, set: 'tower', cam: [-9.0, 2.6, 18.5, 0, 6.3, 0, 38] },
};
function still(name, camOverride) {
  const s = STILLS[name]; if (!s) throw new Error('unknown still ' + name);
  film(s.t);
  const c = camOverride || s.cam;
  if (c) setCam(SET[s.set], { p: V(c), l: V(c.slice(3, 6)), f: c[6] });
}

// ------------------------------------------------------------------ entry points
window.STILLS = Object.keys(STILLS);
window.FILM_CHAPTERS = [
  { t: 0, title: 'Wake' }, { t: 6, title: 'Drop-off' }, { t: 15, title: 'Depart' }, { t: 22, title: 'Call' },
  { t: 32, title: 'Ride' }, { t: 40, title: 'Deliver' }, { t: 50, title: 'Inside' }, { t: 56, title: 'Every floor' },
  { t: 63, title: 'Reserve your building' },
];
window.FILM_POSTER_T = 5.0;
// sound cues, derived from the same timings as the animation above (times snapped to the 30 fps frame grid)
{
  const fr = (t) => Math.round(t * 30) / 30;
  const cues = [
    [0.7, 'eyes_on', 'R2 eyes fade on (close-up, dark stage)'], [1.0, 'strips_on', 'light strips run up the body'], [2.15, 'blink', 'eyes blink'],
    [6.0, 'parcel_in', 'courier parcel lands in the station window'], [6.75, 'belt_in', 'window belt draws the parcel in'],
    [7.55, 'scan', 'label scan beam sweeps'], [8.5, 'station_ok', 'screen: 1104 · Apartment found'], [9.35, 'station_confirm', 'Confirm button goes bright'],
    [9.8, 'window_close', 'window door slides shut'], [10.9, 'station_ok', 'screen: Stored, R2 is taking it to 1104'],
    [16.2, 'robot_move', 'R2 pulls out of its bay; light trail starts'],
    [22.0, 'robot_move', 'cut: R2 rolling up to the elevator'], [24.4, 'pod_rise', 'finger pod rises to button height'], [24.9, 'robot_stop', 'R2 stops at the call button'],
    [26.1, 'finger_press', 'pod presses the call button'], [26.33, 'button_lit', 'call button ring lights'],
    [27.9, 'elevator_ding', 'hall lantern lights (car arriving)'], [28.0, 'doors_open', 'elevator doors open, light spills out'],
    [29.6, 'robot_move', 'R2 rolls into the car'], [31.3, 'doors_close', 'elevator doors close'], [31.95, 'robot_stop', 'R2 stops inside the car'],
    [32.8, 'pod_lower', 'pod lowers to the car reader'], [33.75, 'fob_tap', 'fob taps the reader'], [34.0, 'fob_ok', 'reader ring turns green'],
    [34.9, 'pod_rise', 'pod rises to the 11 button'], [35.85, 'finger_press', 'pod presses 11'], [36.1, 'button_lit', '11 lights up'],
    [36.8, 'ride_start', 'car starts up; floor counter runs'], [39.5, 'ride_end', 'car arrives at 11'], [39.5, 'elevator_ding', 'arrival ding'],
    [40.0, 'robot_move', 'R2 glides down the 11th-floor hallway'], [43.3, 'robot_stop', 'R2 stops at 1104'], [43.4, 'door_open', 'apartment door opens, warm light'],
    [44.7, 'tray_out', 'tray extends at counter height'], [46.7, 'phone_ping', 'Delivered · Apt 1104 notification'], [47.4, 'parcel_slide', 'parcel slides off the tray into the apartment'],
    [48.6, 'tray_in', 'tray retracts'],
    [51.0, 'xray_on', 'scan line sweeps down; shell turns to wireframe'], ...CALLOUTS.map((c) => [c.t, 'callout', c.text]), [54.9, 'xray_off', 'scan line sweeps up; shell turns solid again'],
    [56.0, 'tower_reveal', 'holographic tower fades in'], [63.4, 'endcard', `${BRAND} end card`],
    ...CAPS.map((c) => [c.t0, 'caption_in', c.title]),
  ];
  // one floor_tick per floor change on the counter
  let last = floorAt(36.0);
  for (let i = Math.round(36.0 * 30); i <= Math.round(40.0 * 30); i++) { const n = floorAt(i / 30); if (n !== last) { cues.push([i / 30, 'floor_tick', n === 1 ? 'L' : `floor ${n}`]); last = n; } }
  window.FILM_CUES = cues.map(([t, name, note]) => ({ t: +fr(t).toFixed(3), name, note })).sort((a, b) => a.t - b.t);
}
// clean clips for the site's "How it works" steps (no overlays); camera null = the film's own camera
const CLIPS = {
  station: { from: 6.0, to: 11.5, set: 'station', cam: camPath([[-1.05, 1.5, 3.0, -0.12, 1.08, 0.2, 32], [-0.72, 1.4, 2.55, -0.12, 1.06, 0.2, 32]]) },
  'r2-rack': { from: 15.6, to: 21.0 },
  'finger-press': { from: 23.0, to: 27.4 },
  'fob-tap': { from: 32.3, to: 36.45 },
  handoff: { from: 42.6, to: 47.4 },
  tower: { from: 56.5, to: 62.0 },
};
window.FILM_CLIPS = Object.fromEntries(Object.entries(CLIPS).map(([k, v]) => [k, { from: v.from, to: v.to }]));
function clip(name, t) {
  const c = CLIPS[name]; if (!c) throw new Error('unknown clip ' + name);
  film(t);
  if (c.cam) setCam(SET[c.set], c.cam(easeInOut(seg(t, c.from, c.to))));
}
window.__dbg = { st, r2, s2, elev, hall, tower, SET };
window.renderStill = (name, cam) => { still(name, cam); overlays(1e9); st.render(0); };
window.renderClipAt = (name, t) => { clip(name, +t); overlays(1e9); st.render(+t); };
window.renderAt = (t) => {
  t = +t;
  if (MODE === 'hero') hero(t);
  else if (MODE === 'clip') clip(q.get('clip') || 'station', t);
  else if (MODE === 'still') still(q.get('name') || 'r2-hero');
  else film(t);
  overlays(MODE === 'film' ? t : 1e9);
  st.render(t);
};
await document.fonts.ready;
window.renderAt(+q.get('t') || 0);
window.__ready = true;

// live preview when opened directly (not while recording)
if (!q.has('record') && !q.has('t') && MODE !== 'still') {
  const t0 = performance.now();
  const loop = () => { window.renderAt(((performance.now() - t0) / 1000) % window.FILM_DURATION); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
