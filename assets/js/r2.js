// Shared 3D kit for R2 and the S2 station: loads the v2 CAD models (GLB, metres, Y up,
// robot front = +Z, service side = -X), upgrades the flat CAD materials to studio materials,
// and splits out the parts we animate (eyes, finger pod) from the material-merged meshes.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const CYAN = new THREE.Color('#2EE6F0');
export const CYAN_SOFT = new THREE.Color('#9FF6FA');

const loader = new GLTFLoader();
const cache = new Map();
function loadGLB(url) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  return cache.get(url).then((g) => g.scene.clone(true));
}

// ---------------------------------------------------------------- materials
const M = {
  pearl: () => new THREE.MeshPhysicalMaterial({ color: '#eef1f4', roughness: 0.3, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.22, sheen: 0.15, sheenColor: '#ffffff' }),
  graphite: () => new THREE.MeshStandardMaterial({ color: '#0d1115', roughness: 0.55, metalness: 0.15 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: '#07090b', roughness: 0.92, metalness: 0 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: '#020405', roughness: 0.06, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.04, reflectivity: 0.6 }),
  alu: () => new THREE.MeshStandardMaterial({ color: '#9aa4ad', roughness: 0.32, metalness: 0.85 }),
  glow: () => new THREE.MeshStandardMaterial({ color: '#0b2a2c', emissive: CYAN, emissiveIntensity: 4.0, roughness: 0.4 }),
  backlight: () => new THREE.MeshStandardMaterial({ color: '#0a1416', emissive: CYAN_SOFT, emissiveIntensity: 0.9, roughness: 0.5 }),
  cardboard: () => new THREE.MeshStandardMaterial({ color: '#b98a5a', roughness: 0.88, metalness: 0 }),
  tape: () => new THREE.MeshStandardMaterial({ color: '#d8c39a', roughness: 0.45, metalness: 0 }),
  label: () => new THREE.MeshStandardMaterial({ color: '#f4f4f2', roughness: 0.7 }),
  smoke: () => new THREE.MeshPhysicalMaterial({ color: '#0b1216', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.42, clearcoat: 1, depthWrite: false }),
  red: () => new THREE.MeshStandardMaterial({ color: '#d0101c', roughness: 0.35, emissive: '#3a0005', emissiveIntensity: 0.4 }),
  yellow: () => new THREE.MeshStandardMaterial({ color: '#f0b400', roughness: 0.45 }),
  copper: () => new THREE.MeshStandardMaterial({ color: '#b8652a', roughness: 0.35, metalness: 0.9 }),
  mailerBlue: () => new THREE.MeshStandardMaterial({ color: '#59697a', roughness: 0.38 }),
  mailerWhite: () => new THREE.MeshStandardMaterial({ color: '#dfe4e8', roughness: 0.4 }),
  screen: () => new THREE.MeshStandardMaterial({ color: '#020405', roughness: 0.18, metalness: 0.2 }),
  fob: () => new THREE.MeshStandardMaterial({ color: '#1f4fa8', roughness: 0.35 }),
};

// Material by node-name keyword (robot_v2.glb and station_v2.glb names).
function pickMaterial(name, orig) {
  const n = name.toLowerCase();
  if (n.includes('glow') || n.includes('halo') || n.includes('station_window_halo')) return M.glow();
  if (n.includes('backlight')) return M.backlight();
  if (n.includes('estop_collar')) return M.yellow();
  if (n.includes('estop')) return M.red();
  if (n.includes('shutter') || n.includes('glass_a')) return M.smoke();
  if (n.includes('visor') || n.includes('lidars') || n.includes('cam_windows') || n.includes('station_camera') || n.includes('window_sensors')) return M.glass();
  if (n.includes('head_screen') || n === 'station_screen') return M.screen();
  if (n.includes('box_tape')) return M.tape();
  if (n.includes('label')) return M.label();
  if (n.includes('_box') || n.includes('pizza')) return M.cardboard();
  if (n.includes('food_seal')) return M.label();
  if (n.includes('mailer')) {
    const c = orig?.color;
    if (c && c.r > 0.7) return M.mailerWhite();
    if (c && c.r > 0.45 && c.g < 0.35) return M.cardboard();
    return M.mailerBlue();
  }
  if (n.includes('hub') && !n.includes('base_hubs')) return M.copper();
  if (n.includes('fob')) return M.fob();
  if (n.includes('bumper') || n.includes('wheels') || n.includes('belt') || n.includes('finger_tip')) return M.rubber();
  if (n.includes('ledges') || n.includes('rod') || n.includes('rails') || n.includes('base_hubs') || n.includes('frame') || n.includes('guides') && n.includes('lift')) return M.alu();
  if (n.includes('shell') || n.includes('cap') || n.includes('station_end') || n.includes('station_back') || n.includes('canopy') || n.includes('spine') || n.includes('meter_dim')) return M.pearl();
  return M.graphite();
}

function upgrade(root) {
  const glow = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mat = pickMaterial(o.name, o.material);
    o.material = mat;
    o.castShadow = !mat.transparent;
    o.receiveShadow = true;
    if (mat.emissive && mat.emissiveIntensity > 1) glow.push(mat);
  });
  return glow;
}

// Move the triangles of `mesh` whose centroid passes `test(x,y,z)` into a new mesh.
export function splitMesh(mesh, test, material) {
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = g.attributes.position, nor = g.attributes.normal;
  const keepP = [], keepN = [], outP = [], outN = [];
  for (let i = 0; i < pos.count; i += 3) {
    let cx = 0, cy = 0, cz = 0, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let k = 0; k < 3; k++) {
      const v = [pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)];
      cx += v[0]; cy += v[1]; cz += v[2];
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], v[a]); hi[a] = Math.max(hi[a], v[a]); }
    }
    const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    const hit = test(cx / 3, cy / 3, cz / 3, size);
    const P = hit ? outP : keepP, N = hit ? outN : keepN;
    for (let k = 0; k < 3; k++) {
      P.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      N.push(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k));
    }
  }
  const mk = (P, N) => {
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    ng.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    return ng;
  };
  mesh.geometry = mk(keepP, keepN);
  if (!outP.length) return null;
  const m = new THREE.Mesh(mk(outP, outN), material || mesh.material);
  m.castShadow = mesh.castShadow; m.receiveShadow = true; m.name = mesh.name + '_split';
  return m;
}

// ---------------------------------------------------------------- tray (procedural)
// The belt tray: 460 x 436 x 30 mm, lips 420 mm apart. Built along +X (it slides out of
// the service side toward -X, so we flip it when attaching).
export function makeTray({ box = 'parcel', label = '1104' } = {}) {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.03, 0.436, 2, 0.006), M.mailerWhite());
  frame.material.color.set('#cfd5db'); frame.material.metalness = 0.2; frame.material.roughness = 0.4;
  frame.position.y = 0.015; g.add(frame);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.004, 0.40), M.rubber());
  belt.position.y = 0.031; g.add(belt);
  for (const s of [-1, 1]) {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.014, 0.008), M.alu());
    lip.position.set(0, 0.037, s * 0.214); g.add(lip);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 16), M.copper());
  hub.rotation.x = Math.PI / 2; hub.position.set(0.2, 0.015, 0.222); g.add(hub);
  let item;
  if (box === 'parcel') {
    item = new THREE.Group();
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.30, 0.20, 0.24, 2, 0.008), M.cardboard());
    b.position.y = 0.1; item.add(b);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.003, 0.242), M.tape());
    tape.position.set(-0.03, 0.2015, 0); item.add(tape);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.07), labelMaterial(label));
    lab.rotation.x = -Math.PI / 2; lab.position.set(0.07, 0.2025, 0.03); item.add(lab);
    item.position.set(0, 0.033, 0);
  } else if (box === 'return') {
    item = new THREE.Group();
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.14, 0.22, 2, 0.008), M.mailerWhite());
    b.position.y = 0.07; item.add(b);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.06), labelMaterial('RETURN', '#0b0f12', '#ffd400'));
    lab.rotation.x = -Math.PI / 2; lab.position.set(0.05, 0.1415, 0); item.add(lab);
    item.position.set(0, 0.033, 0);
  }
  if (item) { item.name = 'item'; g.add(item); }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function labelMaterial(text, fg = '#111', bg = '#f6f6f3') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 176;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 256, 176);
  x.fillStyle = fg; x.font = '700 64px Inter, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 128, 70);
  for (let i = 0; i < 26; i++) { x.fillRect(30 + i * 7.5, 118, (i % 3) + 1.5, 40); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 });
}

// ---------------------------------------------------------------- robot
// Returns { root, body, pod, eyes:[l,r], arms, tray, glow, setPod(h), setEyes(open), setTray(out, height) }
export async function loadR2(url = 'assets/models/robot_v2.glb') {
  const scene = await loadGLB(url);
  const root = new THREE.Group(); root.name = 'R2';
  const body = new THREE.Group(); root.add(body);
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) body.add(m);
  const glow = upgrade(body);
  const byName = (n) => meshes.find((m) => m.name === n);

  // Eyes: two pills (62 x 22 mm, x = +-50 mm, 1103 mm high) merged into the glow mesh.
  const glowMesh = byName('body_seam_glow');
  const eyeMat = M.glow(); eyeMat.emissiveIntensity = 5.0; glow.push(eyeMat);
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = splitMesh(glowMesh, (x, y, z) => y > 1.085 && y < 1.122 && z > 0.255 && Math.sign(x) === s && Math.abs(x) > 0.012 && Math.abs(x) < 0.09, eyeMat);
    if (e) {
      const pivot = new THREE.Group(); pivot.position.set(s * 0.05, 1.103, 0.27);
      e.position.set(-s * 0.05, -1.103, -0.27); pivot.add(e); body.add(pivot); eyes.push(pivot);
    }
  }

  // Finger pod: everything in the pod's box at the front-right corner (pod centre 900 mm).
  const pod = new THREE.Group(); pod.name = 'pod'; body.add(pod);
  const POD_Y = 0.9;
  const inPod = (x, y, z, size) => size < 0.09 && x > 0.135 && x < 0.27 && y > 0.858 && y < 0.945 && z > 0.268;
  const podMeshes = ['head_cap', 'base_cam_windows', 'finger_rod', 'finger_slide', 'finger_fob', 'finger_tip'];
  for (const m of meshes) {
    if (!podMeshes.includes(m.name)) continue;
    const part = splitMesh(m, inPod);
    if (part) pod.add(part);
  }
  // Mast (shown only when the pod rises above the head).
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 20), M.alu());
  mast.position.set(0.2, 0, 0.277); mast.visible = false; body.add(mast);

  // Service-side arms + hand-off tray (hidden until used).
  const arms = new THREE.Group(); arms.name = 'arms'; body.add(arms);
  for (const s of [-1, 1]) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.014), M.alu());
    a.position.set(-0.2, 0, s * 0.205); a.castShadow = true; arms.add(a);
  }
  arms.position.set(-0.28, 0.757, -0.02); arms.visible = false;
  const tray = makeTray({ box: 'parcel' });
  tray.position.set(-0.23, 0.01, 0); arms.add(tray);

  const shutter = byName('body_shutter');
  const api = {
    root, body, pod, eyes, arms, tray, glow, mast, shutter, eyeMat,
    // pod centre height in metres (0.386 .. 1.45)
    setPod(h) {
      pod.position.y = h - POD_Y;
      const top = 1.16;
      mast.visible = h > top - 0.02;
      if (mast.visible) { const len = h - top + 0.05; mast.scale.y = len; mast.position.y = top - 0.03 + len / 2; }
    },
    // side slide of the plunger (-0.035 .. 0.035)
    setSlide(dx) { pod.position.x = dx; },
    setEyes(open = 1, look = 0) {
      for (const e of eyes) { e.scale.y = Math.max(0.08, open); e.position.x = Math.sign(e.position.x) * 0.05 + look * 0.012; }
    },
    setGlow(k = 1) { for (const m of glow) m.emissiveIntensity = (m === eyeMat ? 5.0 : 4.0) * k; },
    // out: 0 (stowed) .. 1 (fully out 400 mm); lift: tray height offset; tilt: radians
    setTray(out = 0, { lift = 0, tilt = 0, show = true } = {}) {
      arms.visible = show && out > 0.001;
      arms.position.x = -0.28 - 0.0 * out;
      arms.scale.x = 1;
      tray.position.x = 0.252 + (-0.24 - 0.252) * out;
      arms.position.y = 0.757 + lift;
      arms.rotation.z = tilt;
      for (const a of arms.children) if (a !== tray) { a.scale.x = Math.max(0.01, out); a.position.x = -0.2 * out; }
    },
  };
  api.setPod(POD_Y);
  return api;
}

// ---------------------------------------------------------------- station
export async function loadStation(url = 'assets/models/station_v2.glb') {
  const scene = await loadGLB(url);
  const root = new THREE.Group(); root.name = 'S2';
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) root.add(m);
  const glow = upgrade(root);
  const byName = (n) => meshes.find((m) => m.name === n);
  return { root, glow, byName, meshes };
}

// ---------------------------------------------------------------- helpers
export function softShadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.45, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); return t;
}

export function contactShadow(w = 1.1, d = 1.1, opacity = 0.75) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: softShadowTexture(), transparent: true, opacity, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.002; m.renderOrder = 1;
  return m;
}

export { THREE };
