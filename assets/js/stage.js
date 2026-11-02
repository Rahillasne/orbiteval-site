// The dark "stage" every R2 shot lives on: polished black floor with a dim mirror,
// studio light from above, cyan rim, image-based fill, and bloom for the light strips.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.9 }, uGrain: { value: 0.035 }, uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVignette; uniform float uGrain; uniform float uTime; varying vec2 vUv;
    float h(vec2 p){ p += fract(uTime * vec2(0.1371, 0.2713)) * 517.0; vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.2, length(d * vec2(1.0, 1.15)) * uVignette);
      c.rgb *= mix(0.55, 1.0, v);
      c.rgb += (h(gl_FragCoord.xy) - 0.5) * uGrain;
      gl_FragColor = c; }`,
};

export function createStage({ canvas, width, height, pixelRatio = 1, reflect = true, floorSize = 60, bloom = { strength: 0.6, radius: 0.55, threshold: 1.15 }, background = '#030507', exposure = 1.0, aa = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  scene.fog = new THREE.FogExp2(background, 0.07);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.32;

  const camera = new THREE.PerspectiveCamera(32, width / height, 0.03, 200);
  camera.position.set(2.2, 1.3, 3.2);
  camera.lookAt(0, 0.6, 0);

  // Lights
  const key = new THREE.SpotLight('#ffffff', 26, 20, Math.PI / 6, 0.7, 1.4);
  key.position.set(-2.5, 5.2, 3.2); key.target.position.set(0, 0.5, 0);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0002; key.shadow.radius = 5; key.shadow.blurSamples = 16; key.shadow.camera.near = 1; key.shadow.camera.far = 14;
  scene.add(key, key.target);
  const rim = new THREE.SpotLight('#5ff3ff', 22, 16, Math.PI / 5, 0.8, 1.5);
  rim.position.set(2.6, 3.3, -3.4); rim.target.position.set(0, 1.0, 0); rim.angle = Math.PI / 9;
  scene.add(rim, rim.target);
  const fill = new THREE.HemisphereLight('#bcd7ff', '#05070a', 0.35);
  scene.add(fill);

  // Floor: a dim mirror under a dark glossy veil.
  const floor = new THREE.Group(); scene.add(floor);
  let mirror = null;
  if (reflect) {
    mirror = new Reflector(new THREE.PlaneGeometry(floorSize, floorSize), { textureWidth: Math.round(width * pixelRatio * 0.6), textureHeight: Math.round(height * pixelRatio * 0.6), color: '#5d6a73', clipBias: 0.003 });
    mirror.rotation.x = -Math.PI / 2; floor.add(mirror);
  }
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(floorSize, floorSize), new THREE.MeshStandardMaterial({ color: '#05080b', roughness: 0.5, metalness: 0.3, transparent: reflect, opacity: reflect ? 0.86 : 1 }));
  veil.rotation.x = -Math.PI / 2; veil.position.y = 0.0015; veil.receiveShadow = true; floor.add(veil);

  // Post
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), bloom.strength, bloom.radius, bloom.threshold);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader); composer.addPass(grade);
  if (aa) composer.addPass(new SMAAPass(width * pixelRatio, height * pixelRatio));

  function resize(w, h) {
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    bloomPass.setSize(w, h);
  }

  return {
    THREE, renderer, scene, camera, composer, key, rim, fill, floor, veil, mirror, bloomPass, grade, resize,
    render(t = 0) { grade.uniforms.uTime.value = t; composer.render(); },
  };
}

// Smooth helpers for timelines
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
export const easeInOut = (x) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
export const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
export const lerp = (a, b, k) => a + (b - a) * k;
export const seg = (t, a, b) => clamp01((t - a) / (b - a));
