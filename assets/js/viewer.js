// Interactive R2 on the dark stage: drag to turn, tap a light for what the part does,
// raise the finger, hand over a parcel. Renders only while on screen.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createStage, easeInOut, seg } from './stage.js';
import { loadR2, contactShadow } from './r2.js';
import { ROBOT } from './config.js';

const HOTSPOTS = [
  { id: 'visor', title: 'Visor', text: `Depth cameras behind black glass. The eyes show people where ${ROBOT} is about to go.`, p: [0, 1.103, 0.29], n: [0, 0, 1] },
  { id: 'finger', title: 'Finger', text: 'Presses elevator buttons and taps the building’s fob, anywhere from 38 cm to 1.45 m. It checks that every press worked.', p: [0.2, 0.9, 0.33], n: [0, 0, 1] },
  { id: 'meter', title: 'Load meter', text: 'A light strip that fills as the rack fills, readable from across the lobby.', p: [-0.185, 0.6, 0.29], n: [0, 0, 1] },
  { id: 'rack', title: 'Rack', text: 'One parcel per tray behind smoked glass. Trays are stacked by height, so a trip holds what fits.', p: [-0.3, 0.62, -0.02], n: [-1, 0, 0] },
  { id: 'lidar', title: 'Lidar', text: 'Lidars on two opposite corners give a full circle of view at shin height. A soft bumper runs all the way round.', p: [-0.262, 0.16, 0.272], n: [-0.7, 0, 0.7] },
  { id: 'estop', title: 'Emergency stop', text: 'A red stop button on top that anyone can reach.', p: [0, 1.24, -0.212], n: [0, 1, 0] },
];

export async function mountViewer(el) {
  const canvas = el.querySelector('.viewer__canvas');
  const hint = el.querySelector('[data-viewer-hint]');
  const layer = el.querySelector('[data-hotspots]');
  const card = el.querySelector('[data-hotspot-card]');
  const small = matchMedia('(max-width: 760px)').matches;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const size = () => { const r = el.getBoundingClientRect(); return [Math.max(2, Math.round(r.width)), Math.max(2, Math.round(r.height))]; };
  let [w, h] = size();
  const st = createStage({ canvas, width: w, height: h, pixelRatio: Math.min(devicePixelRatio || 1, small ? 1.5 : 1.75), reflect: !small, aa: !small });
  const { scene, camera } = st;
  camera.fov = 30;
  // phones: step back and aim lower so the robot clears the buttons along the bottom
  if (small) camera.position.set(-1.8, 1.25, 3.0); else camera.position.set(-1.55, 1.2, 2.55);
  camera.updateProjectionMatrix();

  const r2 = await loadR2('assets/models/robot_v2.glb');
  scene.add(r2.root, contactShadow(1.1, 1.1, 0.8));

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, small ? 0.48 : 0.6, 0);
  controls.enableZoom = false; controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.minPolarAngle = 0.95; controls.maxPolarAngle = 1.52;
  controls.autoRotate = !reduced; controls.autoRotateSpeed = -0.9;
  controls.update();

  // hotspots
  const spots = HOTSPOTS.map((s) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'hotspot'; b.setAttribute('aria-label', s.title); b.setAttribute('aria-expanded', 'false');
    layer.append(b);
    return { ...s, el: b, v: new THREE.Vector3(...s.p), n: new THREE.Vector3(...s.n).normalize() };
  });
  let open = null;
  const showCard = (s) => {
    open = s;
    spots.forEach((o) => o.el.setAttribute('aria-expanded', String(o === s)));
    if (!s) { card.hidden = true; return; }
    card.querySelector('[data-hotspot-title]').textContent = s.title;
    card.querySelector('[data-hotspot-text]').textContent = s.text;
    card.hidden = false;
  };
  spots.forEach((s) => s.el.addEventListener('click', (e) => { e.stopPropagation(); showCard(open === s ? null : s); controls.autoRotate = false; syncSpin(); }));
  canvas.addEventListener('pointerdown', () => showCard(null));

  // controls row
  const btnFinger = el.querySelector('[data-act="finger"]');
  const btnTray = el.querySelector('[data-act="tray"]');
  const btnSpin = el.querySelector('[data-act="spin"]');
  const syncSpin = () => btnSpin.setAttribute('aria-pressed', String(controls.autoRotate));
  btnSpin.addEventListener('click', () => { controls.autoRotate = !controls.autoRotate; syncSpin(); });
  syncSpin();
  let fingerT = -1; // seconds since start of the finger move, -1 = idle
  btnFinger.addEventListener('click', () => { fingerT = 0; btnFinger.setAttribute('aria-pressed', 'true'); });
  let trayGoal = 0, trayNow = 0;
  btnTray.addEventListener('click', () => {
    trayGoal = trayGoal ? 0 : 1;
    btnTray.setAttribute('aria-pressed', String(!!trayGoal));
    btnTray.textContent = trayGoal ? 'Put it back' : 'Hand over a parcel';
  });

  // pointer: the eyes glance toward the cursor
  let look = 0;
  el.addEventListener('pointermove', (e) => { const r = el.getBoundingClientRect(); look = ((e.clientX - r.left) / r.width - 0.5) * 2; });
  el.addEventListener('pointerleave', () => { look = 0; });

  // resize
  new ResizeObserver(() => { const [nw, nh] = size(); if (nw !== w || nh !== h) { w = nw; h = nh; st.resize(w, h); } }).observe(el);

  // loop (only while visible)
  let visible = true, raf = 0, last = performance.now(), clock = 0, lookNow = 0;
  const v = new THREE.Vector3(), toCam = new THREE.Vector3();
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
    controls.update();
    // finger: up to 1.45 m, down to 0.39 m, back to rest
    if (fingerT >= 0) {
      fingerT += dt;
      const t = fingerT;
      let hgt = 0.9;
      if (t < 1.3) hgt = 0.9 + (1.45 - 0.9) * easeInOut(seg(t, 0, 1.3));
      else if (t < 2.0) hgt = 1.45;
      else if (t < 3.6) hgt = 1.45 + (0.39 - 1.45) * easeInOut(seg(t, 2.0, 3.6));
      else if (t < 4.2) hgt = 0.39;
      else if (t < 5.4) hgt = 0.39 + (0.9 - 0.39) * easeInOut(seg(t, 4.2, 5.4));
      else { fingerT = -1; btnFinger.setAttribute('aria-pressed', 'false'); }
      r2.setPod(hgt);
    }
    // tray
    trayNow += (trayGoal - trayNow) * Math.min(1, dt * 2.2);
    r2.setTray(easeInOut(trayNow));
    // eyes: blink every ~5 s, glance at the cursor
    const b = clock % 5.2;
    const blink = b > 5.0 ? Math.abs(Math.cos(((b - 5.0) / 0.2) * Math.PI)) : 1;
    lookNow += (look - lookNow) * Math.min(1, dt * 4);
    r2.setEyes(blink, lookNow);
    st.render(clock);
    // hotspots
    for (const s of spots) {
      v.copy(s.v).project(camera);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      toCam.copy(camera.position).sub(s.v).normalize();
      const facing = toCam.dot(s.n) > 0.18;
      s.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      s.el.classList.toggle('is-hidden', !facing);
      if (!facing && open === s) showCard(null);
    }
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); }, { threshold: 0.01 }).observe(el);
  document.addEventListener('visibilitychange', kick);
  controls.addEventListener('start', () => { showCard(null); });

  el.classList.add('is-live');
  if (hint) hint.textContent = 'Drag to turn · tap a light';
  kick();
}
