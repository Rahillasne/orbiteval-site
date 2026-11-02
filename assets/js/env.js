// Environment kit for the R2 film: minimal, dark "digital twin" sets that share the stage floor.
// Units are metres. Every builder returns { group, ...handles }; all animation is driven by the film.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const C = {
  cyan: new THREE.Color('#2EE6F0'),
  warm: new THREE.Color('#ffb36b'),
};

// Bright, unlit colours for things that should bloom (values > 1 survive into the HDR target).
export function glowMat(color = C.cyan, k = 3, opts = {}) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), ...opts });
  m.userData.base = new THREE.Color(color); m.userData.k = k;
  return m;
}
export function setGlowK(mat, k) { mat.color.copy(mat.userData.base).multiplyScalar(k); }

const mats = {
  wall: () => new THREE.MeshStandardMaterial({ color: '#0d1116', roughness: 0.78, metalness: 0.08 }),
  wallLight: () => new THREE.MeshStandardMaterial({ color: '#1a2027', roughness: 0.7, metalness: 0.05 }),
  steel: () => new THREE.MeshStandardMaterial({ color: '#8c959e', roughness: 0.3, metalness: 0.92 }),
  steelDark: () => new THREE.MeshStandardMaterial({ color: '#4b535b', roughness: 0.36, metalness: 0.9 }),
  door: () => new THREE.MeshStandardMaterial({ color: '#2a211b', roughness: 0.55, metalness: 0.05 }),
  frame: () => new THREE.MeshStandardMaterial({ color: '#161a1f', roughness: 0.5, metalness: 0.3 }),
  mat: () => new THREE.MeshStandardMaterial({ color: '#1c1f22', roughness: 0.95 }),
  black: () => new THREE.MeshStandardMaterial({ color: '#05070a', roughness: 0.4, metalness: 0.2 }),
};

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const api = { canvas: c, ctx, tex, key: null, redraw(key, fn = draw) { if (key === api.key) return; api.key = key; ctx.clearRect(0, 0, w, h); fn(ctx, w, h, key); tex.needsUpdate = true; } };
  return api;
}

function plateTex(text, { w = 256, h = 128, fg = '#e9eef2', bg = '#0f1317', font = '600 72px Inter, Arial, sans-serif' } = {}) {
  const t = canvasTex(w, h, (x) => {
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(46,230,240,0.55)'; x.lineWidth = 3; x.strokeRect(6, 6, w - 12, h - 12);
    x.fillStyle = fg; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, h / 2 + 3);
  });
  t.redraw('x');
  return t.tex;
}

// ------------------------------------------------------------------ elevator lobby + car
// Lobby wall front face at z = 0 (facing +z), doorway centred at x = 0. The car is behind (z < 0).
export function makeElevator() {
  const g = new THREE.Group(); g.name = 'elevator';
  const W = 7, H = 3.2, T = 0.12, DW = 1.06, DH = 2.13;
  const wall = mats.wall();
  // Lobby wall in three pieces around the doorway
  const side = (W - DW) / 2;
  g.add(box(side, H, T, wall, -(DW / 2 + side / 2), H / 2, -T / 2));
  g.add(box(side, H, T, wall, (DW / 2 + side / 2), H / 2, -T / 2));
  g.add(box(DW, H - DH, T, wall, 0, DH + (H - DH) / 2, -T / 2));
  // Steel portal frame with a cyan inner edge
  const frameMat = mats.steelDark();
  const fw = 0.07;
  g.add(box(fw, DH + fw, 0.04, frameMat, -(DW / 2 + fw / 2), (DH + fw) / 2, 0.01));
  g.add(box(fw, DH + fw, 0.04, frameMat, (DW / 2 + fw / 2), (DH + fw) / 2, 0.01));
  g.add(box(DW + 2 * fw, fw, 0.04, frameMat, 0, DH + fw / 2, 0.01));
  const edge = glowMat(C.cyan, 1.6);
  g.add(box(0.008, DH, 0.006, edge, -(DW / 2 + 0.004), DH / 2, 0.032));
  g.add(box(0.008, DH, 0.006, edge, (DW / 2 + 0.004), DH / 2, 0.032));
  g.add(box(DW + 0.016, 0.008, 0.006, edge, 0, DH + 0.004, 0.032));
  // Floor light line along the wall base
  const base = glowMat(C.cyan, 1.2);
  g.add(box(W, 0.01, 0.01, base, 0, 0.012, 0.006));
  // Door panels (centre-opening) sit in the wall thickness
  const steel = mats.steel();
  const left = box(DW / 2 + 0.01, DH, 0.03, steel, -DW / 4, DH / 2, -T / 2);
  const right = box(DW / 2 + 0.01, DH, 0.03, steel, DW / 4, DH / 2, -T / 2);
  g.add(left, right);
  // Hall lantern (up arrow) above the door
  const lantern = canvasTex(256, 96, (x, w, h, on) => {
    x.fillStyle = '#05080a'; x.fillRect(0, 0, w, h);
    x.fillStyle = on ? '#7ff6fb' : '#1d2a2e';
    x.beginPath(); x.moveTo(w / 2, 14); x.lineTo(w / 2 + 34, 70); x.lineTo(w / 2 - 34, 70); x.closePath(); x.fill();
  });
  lantern.redraw(false);
  const lanternMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.0825), new THREE.MeshBasicMaterial({ map: lantern.tex, toneMapped: true }));
  lanternMesh.position.set(0, DH + 0.22, 0.004); g.add(lanternMesh);

  // Call plate right of the doorway, button centre at 1.07 m (42 in)
  const CALL_X = DW / 2 + 0.42, CALL_Y = 1.07;
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.2, 0.012, 2, 0.006), new THREE.MeshStandardMaterial({ color: '#b9c2ca', roughness: 0.3, metalness: 0.7 }));
  plate.position.set(CALL_X, CALL_Y, 0.006); plate.castShadow = true; g.add(plate);
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.01, 40), new THREE.MeshStandardMaterial({ color: '#2a3036', roughness: 0.35, metalness: 0.6 }));
  btn.rotation.x = Math.PI / 2; btn.position.set(CALL_X, CALL_Y, 0.016); g.add(btn);
  const ringMat = glowMat(C.cyan, 0.0);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.0028, 12, 48), ringMat);
  ring.position.set(CALL_X, CALL_Y, 0.017); g.add(ring);
  const arrow = new THREE.Mesh(new THREE.CircleGeometry(0.008, 3), glowMat('#cfe9ee', 0.6));
  arrow.position.set(CALL_X, CALL_Y + 0.001, 0.0216); arrow.rotation.z = Math.PI / 2; g.add(arrow);

  // ---------------- car interior (behind the wall)
  const CW = 1.73, CD = 1.3, CH = 2.4, z0 = -T, zb = -T - CD;
  const carWall = mats.steelDark();
  g.add(box(0.04, CH, CD, carWall, -CW / 2 - 0.02, CH / 2, (z0 + zb) / 2));
  const rightWall = [box(0.04, CH, CD, carWall, CW / 2 + 0.02, CH / 2, (z0 + zb) / 2)];
  g.add(rightWall[0]);
  g.add(box(CW + 0.08, CH, 0.04, carWall, 0, CH / 2, zb - 0.02));
  // vertical panel seams on the car walls
  const seam = mats.black();
  for (const x of [-0.29, 0.29]) g.add(box(0.006, CH, 0.004, seam, x, CH / 2, zb + 0.001));
  for (const z of [z0 - 0.43, z0 - 0.87]) { g.add(box(0.004, CH, 0.006, seam, -CW / 2 + 0.001, CH / 2, z)); const r = box(0.004, CH, 0.006, seam, CW / 2 - 0.001, CH / 2, z); g.add(r); rightWall.push(r); }
  // handrail on the back wall
  g.add(box(1.2, 0.035, 0.035, mats.steel(), 0, 0.92, zb + 0.06));
  // car front wall (inside face) around the doorway
  const cside = (CW - DW) / 2;
  g.add(box(cside, CH, 0.02, carWall, -(DW / 2 + cside / 2), CH / 2, z0 - 0.01));
  g.add(box(cside, CH, 0.02, carWall, (DW / 2 + cside / 2), CH / 2, z0 - 0.01));
  g.add(box(DW, CH - DH, 0.02, carWall, 0, DH + (CH - DH) / 2, z0 - 0.01));
  // ceiling + light panel
  g.add(box(CW + 0.08, 0.04, CD + 0.04, mats.black(), 0, CH + 0.02, (z0 + zb) / 2));
  const ceilingLight = new THREE.Mesh(new THREE.PlaneGeometry(CW - 0.3, CD - 0.3), glowMat('#e8f6ff', 1.0));
  ceilingLight.rotation.x = Math.PI / 2; ceilingLight.position.set(0, CH - 0.005, (z0 + zb) / 2); g.add(ceilingLight);
  const carLight = new THREE.PointLight('#e9f4ff', 2.2, 6, 1.6); carLight.position.set(0, CH - 0.25, (z0 + zb) / 2); g.add(carLight);
  const spill = new THREE.SpotLight('#dff3ff', 0, 9, Math.PI / 4.2, 0.65, 1.3);
  spill.position.set(0, 2.0, zb + 0.15); spill.target.position.set(0, 0, 2.4); g.add(spill, spill.target);

  // Car operating panel (inside, right of the door when facing the doors from inside = +x)
  const COP_X = DW / 2 + 0.17;
  const copTex = canvasTex(256, 1024, (x, w, h, state) => drawCop(x, w, h, state));
  copTex.redraw('0|0');
  const cop = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.8), new THREE.MeshBasicMaterial({ map: copTex.tex }));
  cop.rotation.y = Math.PI; cop.position.set(COP_X, 1.13, z0 - 0.0215); g.add(cop);
  const copPlate = box(0.21, 0.81, 0.006, mats.steel(), COP_X, 1.13, z0 - 0.018); g.add(copPlate);
  // Reader below the buttons (centre 0.83 m): body + LED
  const reader = box(0.06, 0.08, 0.02, mats.black(), COP_X, 0.83, z0 - 0.033); g.add(reader);
  // light ring around the reader face (visible even side-on); red until a credential reads, then green
  const ledMat = glowMat('#ff3b3b', 1.5);
  const led = new THREE.Group();
  for (const [w, h, x, y] of [[0.066, 0.005, 0, 0.042], [0.066, 0.005, 0, -0.042], [0.005, 0.089, 0.0325, 0], [0.005, 0.089, -0.0325, 0]]) led.add(box(w, h, 0.012, ledMat, COP_X + x, 0.83 + y, z0 - 0.049));
  led.children.forEach((m) => { m.castShadow = false; });
  g.add(led);
  // the floor-11 button ring, raised a little so it reads from the side
  const b11 = COP_ROWS.find((b) => b.lab === '11');
  const btn11Mat = glowMat(C.cyan, 0.0);
  const btn11 = new THREE.Mesh(new THREE.TorusGeometry(0.0115, 0.0022, 10, 40), btn11Mat);
  btn11.position.set(COP_X + b11.x, b11.y, z0 - 0.0235); g.add(btn11);
  // Floor indicator inside above the doors
  const ind = canvasTex(256, 128, (x, w, h, n) => {
    x.fillStyle = '#020405'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#7ff6fb'; x.font = '600 84px "JetBrains Mono", Menlo, monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String(n), w / 2 + 14, h / 2 + 4);
    x.beginPath(); x.moveTo(34, 78); x.lineTo(58, 44); x.lineTo(82, 78); x.closePath(); x.fill();
  });
  ind.redraw('L');
  const indMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.12), new THREE.MeshBasicMaterial({ map: ind.tex }));
  indMesh.rotation.y = Math.PI; indMesh.position.set(0, DH + 0.16, z0 - 0.022); g.add(indMesh);

  return {
    group: g, doors: { left, right, DW }, ring, ringMat, lantern, spill, carLight, ceilingLight,
    CALL: { x: CALL_X, y: CALL_Y, z: 0.022 }, COP: { x: COP_X, z: z0 - 0.022, tex: copTex, b11 }, led, ledMat, btn11Mat, ind, rightWall,
    setDoors(open) { const s = open * (DW / 2 + 0.005); left.position.x = -DW / 4 - s; right.position.x = DW / 4 + s; },
  };
}

// Car panel: 23 floors + L, P in three columns, numbers engraved, lit ring on the chosen floor.
// Canvas 256 x 1024 maps to 0.2 x 0.8 m, panel centre at 1.13 m (so y_px = (1.53 - y) / 0.8 * 1024).
export const COP_ROWS = (() => {
  const labels = [['P', 'L', '2'], ['3', '4', '5'], ['6', '7', '8'], ['9', '10', '11'], ['12', '13', '14'], ['15', '16', '17'], ['18', '19', '20'], ['21', '22', '23']];
  const out = [];
  labels.forEach((row, r) => row.forEach((lab, c) => out.push({ lab, x: -0.05 + c * 0.05, y: 0.92 + r * 0.06 })));
  return out;
})();
function drawCop(x, w, h, state) {
  const [lit] = String(state).split('|');
  const g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#79828b'); g.addColorStop(0.5, '#9aa3ab'); g.addColorStop(1, '#727b84');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 120; i++) { x.fillStyle = `rgba(255,255,255,${0.02 + (i % 5) * 0.006})`; x.fillRect(0, (i * 8.5) % h, w, 1); }
  const toPx = (bx, by) => [(-bx + 0.1) / 0.2 * w, (1.53 - by) / 0.8 * h];
  for (const b of COP_ROWS) {
    const [px, py] = toPx(b.x, b.y);
    const on = b.lab === lit;
    x.beginPath(); x.arc(px, py, 22, 0, Math.PI * 2); x.fillStyle = '#3a4148'; x.fill();
    x.lineWidth = on ? 6 : 3; x.strokeStyle = on ? '#8ff8ff' : '#2a3036'; x.stroke();
    if (on) { x.shadowColor = '#5ff3ff'; x.shadowBlur = 18; x.stroke(); x.shadowBlur = 0; }
    x.fillStyle = on ? '#dffcff' : '#cfd5da'; x.font = '600 20px Inter, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(b.lab, px, py + 1);
  }
}

// ------------------------------------------------------------------ hallway
// Corridor along z, centred on x = 0, 1.8 m wide. Door 1104 on the left wall (x = -0.9) at z = 0.
export function makeHallway() {
  const g = new THREE.Group(); g.name = 'hallway';
  const HW = 0.9, L = 18, H = 2.7, T = 0.12, DW = 0.91, DH = 2.03;
  const wall = mats.wallLight();
  // right wall (continuous) and left wall with an opening at z in [-DW/2, DW/2]
  g.add(box(T, H, L, wall, HW + T / 2, H / 2, 0));
  const seg = (L - DW) / 2;
  g.add(box(T, H, seg, wall, -HW - T / 2, H / 2, -(DW / 2 + seg / 2)));
  g.add(box(T, H, seg, wall, -HW - T / 2, H / 2, (DW / 2 + seg / 2)));
  g.add(box(T, H - DH, DW, wall, -HW - T / 2, DH + (H - DH) / 2, 0));
  // ceiling with a light line
  g.add(box(2 * HW + 2 * T, 0.05, L, mats.black(), 0, H + 0.025, 0));
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.05, L), glowMat('#e9f6ff', 1.7));
  strip.rotation.x = Math.PI / 2; strip.position.set(0, H - 0.002, 0); g.add(strip);
  // base lines
  const base = glowMat(C.cyan, 0.9);
  g.add(box(0.01, 0.01, L, base, HW - 0.004, 0.012, 0));
  g.add(box(0.01, 0.01, L, base, -HW + 0.004, 0.012, 0));
  // door frames and leaves for several units; 1104 is the one that opens
  const doors = {};
  const addDoor = (side, z, num, real) => {
    const xw = side * (HW + 0.001);
    const fr = mats.frame();
    const fx = xw - side * 0.0; // frame flush on the corridor face
    g.add(box(0.04, DH + 0.05, 0.05, fr, fx, (DH + 0.05) / 2, z - DW / 2 - 0.025));
    g.add(box(0.04, DH + 0.05, 0.05, fr, fx, (DH + 0.05) / 2, z + DW / 2 + 0.025));
    g.add(box(0.04, 0.05, DW + 0.1, fr, fx, DH + 0.025, z));
    const leafMat = mats.door();
    const leaf = new THREE.Group();
    const slab = box(0.045, DH, DW - 0.01, leafMat, 0, DH / 2, (DW - 0.01) / 2);
    const handle = box(0.03, 0.02, 0.13, mats.steel(), side * -0.04, 1.0, DW - 0.12);
    leaf.add(slab, handle);
    if (real) {
      // hinge at the -z jamb, recessed in the wall; swings into the apartment
      leaf.position.set(side * (HW + 0.06), 0, z - DW / 2 + 0.005);
    } else {
      // closed doors sit 8 mm proud of the wall face
      leaf.position.set(0, 0, z - DW / 2 + 0.005);
      slab.position.x = side * (HW + 0.0145);
      handle.position.x = side * (HW - 0.012);
    }
    g.add(leaf);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), new THREE.MeshBasicMaterial({ map: plateTex(num) }));
    plate.position.set(xw - side * 0.004, 1.52, z + DW / 2 + 0.2);
    plate.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(plate);
    // a warm sconce beside each door
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.32), glowMat(C.warm, 1.6));
    sc.position.set(xw - side * 0.006, 1.75, z - DW / 2 - 0.35); sc.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; g.add(sc);
    doors[num] = { leaf, slab };
  };
  addDoor(-1, 0, '1104', true);
  addDoor(-1, -4.2, '1102', false);
  addDoor(-1, 4.2, '1106', false);
  addDoor(1, -2.1, '1103', false);
  addDoor(1, 2.6, '1105', false);
  addDoor(1, -6.4, '1101', false);
  addDoor(-1, -8.0, '1100', false);
  // the closed doors must not leave holes: walls behind them are solid except at 1104
  // apartment interior behind 1104 (warm)
  const room = new THREE.Group(); g.add(room);
  const rw = mats.wallLight(); rw.color.set('#3b3129');
  room.add(box(0.05, H, 3.4, rw, -HW - T - 2.6, H / 2, 0));
  room.add(box(2.6, H, 0.05, rw, -HW - T - 1.3, H / 2, -1.7));
  room.add(box(2.6, H, 0.05, rw, -HW - T - 1.3, H / 2, 1.7));
  room.add(box(2.6, 0.05, 3.4, rw, -HW - T - 1.3, H, 0));
  const glowWall = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.4), glowMat(C.warm, 0.9));
  glowWall.rotation.y = Math.PI / 2; glowWall.position.set(-HW - T - 2.57, 1.25, 0); room.add(glowWall);
  const warm = new THREE.PointLight('#ffb36b', 0, 6, 1.5); warm.position.set(-HW - T - 0.8, 1.6, 0.2); room.add(warm);
  const warmSpot = new THREE.SpotLight('#ffbf80', 0, 7, Math.PI / 4, 0.7, 1.4); warmSpot.position.set(-HW - T - 1.4, 1.9, 0); warmSpot.target.position.set(0.6, 0, 0.3); room.add(warmSpot, warmSpot.target);
  // doormat
  const mat = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.012, 0.75, 2, 0.006), mats.mat());
  mat.position.set(-HW + 0.23, 0.006, 0); mat.receiveShadow = true; g.add(mat);
  // corridor fill lights
  const fills = [];
  for (const z of [-6, -2, 2, 6]) { const p = new THREE.PointLight('#dbe9ff', 0.55, 5, 1.6); p.position.set(0, H - 0.3, z); g.add(p); fills.push(p); }
  return { group: g, door1104: doors['1104'], warm, warmSpot, glowWall, HW, DW };
}

// ------------------------------------------------------------------ tower
// A holographic tower: 23 floors, an elevator shaft, robot glyphs and two inbound flows of delivery dots.
export function makeTower({ floors = 23, w = 6.4, d = 4.0, fh = 0.52 } = {}) {
  const g = new THREE.Group(); g.name = 'tower';
  const H = floors * fh;
  const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(C.cyan).multiplyScalar(1.6), transparent: true, opacity: 0.9 });
  const faintMat = new THREE.LineBasicMaterial({ color: new THREE.Color(C.cyan).multiplyScalar(0.7), transparent: true, opacity: 0.6 });
  const plateMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#0d4e55'), transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const plates = [];
  for (let i = 0; i <= floors; i++) {
    const y = i * fh;
    const pg = new THREE.PlaneGeometry(w, d); pg.rotateX(-Math.PI / 2);
    const p = new THREE.Mesh(pg, plateMat); p.position.y = y; g.add(p); plates.push(p);
    const eg = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.0001, d));
    const e = new THREE.LineSegments(eg, i === 0 ? lineMat : faintMat); e.position.y = y; g.add(e);
    // corridor line down the middle of each floor
    const cg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-w / 2 + 0.3, y + 0.01, 0), new THREE.Vector3(w / 2 - 0.3, y + 0.01, 0)]);
    g.add(new THREE.Line(cg, faintMat));
  }
  // corner posts
  for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
    const pg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0, z), new THREE.Vector3(x, H, z)]);
    g.add(new THREE.Line(pg, lineMat));
  }
  // shaft
  const sh = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.5, H, 0.5)), lineMat);
  sh.position.set(-0.6, H / 2, -0.9); g.add(sh);
  const shaftFill = new THREE.Mesh(new THREE.BoxGeometry(0.5, H, 0.5), new THREE.MeshBasicMaterial({ color: '#0a3a40', transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
  shaftFill.position.copy(sh.position); g.add(shaftFill);
  // robot glyphs
  const glyphGeo = new RoundedBoxGeometry(0.12, 0.18, 0.12, 2, 0.025);
  const glyphMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#dff6fa').multiplyScalar(0.85) });
  const capMat = glowMat(C.cyan, 1.9);
  const glyphs = [];
  for (let i = 0; i < 9; i++) {
    const r = new THREE.Group();
    const b = new THREE.Mesh(glyphGeo, glyphMat); b.position.y = 0.09; r.add(b);
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.026, 0.125), capMat); c.position.y = 0.15; r.add(c);
    g.add(r); glyphs.push(r);
  }
  // dots: deliveries flowing in
  const N = 220;
  const mkPts = (color, size) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
    const m = new THREE.PointsMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), size, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const p = new THREE.Points(geo, m); g.add(p); return p;
  };
  // two inbound delivery flows (front lobby and back entrance), both ending at floor doors
  const inPts = mkPts('#ffb36b', 0.09), outPts = mkPts('#ffe2b8', 0.075);
  const base = new THREE.Mesh(new THREE.CircleGeometry(Math.max(w, d) * 0.9, 64), new THREE.MeshBasicMaterial({ color: '#0b2e33', transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
  base.rotation.x = -Math.PI / 2; base.position.y = 0.004; g.add(base);

  const shaft = new THREE.Vector3(-0.6, 0, -0.9);
  function update(t) {
    // glyphs: 2 in the shaft, the rest along corridors on different floors
    glyphs.forEach((r, i) => {
      if (i < 2) {
        const ph = (t * 0.11 + i * 0.5) % 1; const up = ph < 0.5 ? ph * 2 : 2 - ph * 2;
        r.position.set(shaft.x, 0.02 + up * (H - fh), shaft.z);
      } else {
        const fl = [3, 7, 11, 14, 18, 21, 9][i - 2];
        const ph = (t * (0.07 + 0.013 * i) + i * 0.37) % 1; const s = ph < 0.5 ? ph * 2 : 2 - ph * 2;
        r.position.set(-w / 2 + 0.4 + s * (w - 0.8), fl * fh + 0.01, 0);
      }
    });
    const ip = inPts.geometry.attributes.position, op = outPts.geometry.attributes.position;
    for (let k = 0; k < N; k++) {
      const h1 = (Math.sin(k * 12.9898) * 43758.5453) % 1, h2 = (Math.sin(k * 78.233) * 12345.678) % 1;
      const a = Math.abs(h1), b = Math.abs(h2);
      // in: from outside (+z, far) to the lobby, up the shaft, along a floor
      let ph = (t * 0.09 + a) % 1;
      const fl = 1 + Math.floor(b * (floors - 1));
      let x, y, z;
      if (ph < 0.3) { const s = ph / 0.3; x = shaft.x + (1 - s) * 2.5; y = 0.06; z = 6 - s * (6 - shaft.z); }
      else if (ph < 0.7) { const s = (ph - 0.3) / 0.4; x = shaft.x; y = s * fl * fh; z = shaft.z; }
      else { const s = (ph - 0.7) / 0.3; x = shaft.x + s * ((b * 2 - 1) * (w / 2 - 0.4) - shaft.x); y = fl * fh + 0.05; z = shaft.z + s * (0 - shaft.z); }
      ip.setXYZ(k, x, y, z);
      // second flow, reversed path: in from the back (-z), up the shaft, along a floor to a door
      ph = 1 - ((t * 0.08 + b) % 1);
      const fl2 = 1 + Math.floor(a * (floors - 1));
      if (ph < 0.3) { const s = ph / 0.3; x = (a * 2 - 1) * (w / 2 - 0.4) * (1 - s) + shaft.x * s; y = fl2 * fh + 0.05; z = 0.3 * (1 - s) + (shaft.z + 0.18) * s; }
      else if (ph < 0.7) { const s = (ph - 0.3) / 0.4; x = shaft.x + 0.12; y = (1 - s) * fl2 * fh; z = shaft.z + 0.18; }
      else { const s = (ph - 0.7) / 0.3; x = shaft.x + 0.12 - s * 2.4; y = 0.06; z = shaft.z + 0.18 - s * 5.5; }
      op.setXYZ(k, x, y, z);
    }
    ip.needsUpdate = true; op.needsUpdate = true;
  }
  update(0);
  return { group: g, update, H, plateMat, lineMat, faintMat, glyphMat, capMat, inPts, outPts };
}

// ------------------------------------------------------------------ light trail ribbon
// A fading ribbon on the floor along a list of points (newest last).
export function makeTrail(maxPts = 240, width = 0.34) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(maxPts * 2 * 3), col = new Float32Array(maxPts * 2 * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const idx = [];
  for (let i = 0; i < maxPts - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 2;
  const cyan = new THREE.Color(C.cyan);
  function set(points, fadeLen = 2.5, k = 1.6) {
    const n = Math.min(points.length, maxPts);
    const P = points.slice(points.length - n);
    let acc = 0; const dist = new Array(n).fill(0);
    for (let i = n - 2; i >= 0; i--) { acc += P[i].distanceTo(P[i + 1]); dist[i] = acc; }
    for (let i = 0; i < maxPts; i++) {
      const j = Math.min(i, n - 1);
      const p = P[Math.max(0, j)] || new THREE.Vector3();
      const q = P[Math.min(n - 1, j + 1)] || p, o = P[Math.max(0, j - 1)] || p;
      const dir = new THREE.Vector3().subVectors(q, o); dir.y = 0; if (dir.lengthSq() < 1e-9) dir.set(1, 0, 0); dir.normalize();
      const nx = -dir.z, nz = dir.x;
      const f = i < n ? Math.max(0, 1 - dist[j] / fadeLen) : 0;
      const head = i < n ? Math.min(1, (j + 1) / 6) : 0;
      const w = width * (0.35 + 0.65 * f) * 0.5;
      pos.set([p.x + nx * w, 0.004, p.z + nz * w, p.x - nx * w, 0.004, p.z - nz * w], i * 6);
      const c = k * f * f * head;
      col.set([cyan.r * c, cyan.g * c, cyan.b * c, cyan.r * c, cyan.g * c, cyan.b * c], i * 6);
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
  }
  return { mesh, set };
}
