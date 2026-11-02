// RITMUP · escenario BOSQUE (realista). Un sendero de tierra y pinaza entre abetos altos (ramas fotográficas reales),
// con niebla de la mañana que se espesa a lo lejos y haces de luz que cruzan entre los troncos. Balizas bajas de madera
// cada 10 m a cada lado del sendero, con la luz del color del tramo y su charco de luz en el suelo (encendido en cadena
// del kit). El cielo es un panorama real de mañana con niebla (CC0, Poly Haven).
// A VELOCIDAD REAL: suelo, árboles, balizas y haces avanzan a km/h ÷ 3,6 m/s.
import { createRunner, scrollZ } from './kit/runner.js';
import { worldUrl, loadTex, loadJson, loadSet, pbr, skyDome, envFrom, glowMaterial, halos, addLamps, setInstances } from './kit/world.js';
import { createFirs } from './kit/firs.js';

export const meta = {
  id: 'bosque',
  name: 'Bosque',
  description: 'Un sendero entre abetos altos con niebla de la mañana y haces de luz.',
};

const T = 'bosque';
const TREE_P = 220;     // periodo del patrón de árboles (m)
const BOL_D = 10;
const FLOOR_TILE = 3;
const PATH_W = 1.35;

const RAY_VERT = /* glsl */ `
varying vec2 vUv;
varying float vK;
uniform float uFogD;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  float d = length(w.xyz - cameraPosition);
  vK = smoothstep(4.0, 18.0, d) * exp(-d * uFogD);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const RAY_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uPower;
varying vec2 vUv;
varying float vK;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.2, 1.0, x)) * smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
  gl_FragColor = vec4(uCol * a * vK * uPower, 1.0);
}`;

export async function createTheme(ctx) {
  const { THREE, root, camera, scene, renderer } = ctx;
  camera.near = 0.08;
  camera.far = 1500;
  renderer.setClearColor(0x6a7076, 1);
  ctx.post.set({ toneMapping: 'aces', exposure: 0.9, bloomStrength: 0.36, bloomThreshold: 0.9, bloomRadius: 0.3, vignette: 0.32, saturation: 0.98 });

  const [skyMeta, skyTex, envTex, floorSet, branchTex, barkTex] = await Promise.all([
    loadJson(T, 'sky.json'),
    loadTex(ctx, worldUrl(T, 'sky.jpg'), { srgb: true, aniso: 1 }),
    loadTex(ctx, worldUrl(T, 'env.jpg'), { srgb: true, aniso: 1 }),
    loadSet(ctx, T, 'floor', [120 / FLOOR_TILE, 600 / FLOOR_TILE]),
    loadTex(ctx, worldUrl(T, 'branch.webp'), { srgb: true, aniso: 4 }),
    loadTex(ctx, worldUrl(T, 'bark.jpg'), { srgb: true, aniso: 4 }),
  ]);

  const runner = createRunner(ctx, {
    exposure: 0.9,
    finale: (p, portrait) => { p.y = portrait ? 6 : 5; p.z = 5; p.lookY = 0.6; p.lookZ = -40; p.fov = portrait ? 58 : 56; },
  });

  // ── cielo de niebla, entorno, luz suave de la mañana ──
  const sky = skyDome(ctx, skyTex, skyMeta, { gain: 0.42, grad: 0.4, gradEl: 0.5, tint: new THREE.Color(0.9, 0.97, 1.05) });
  root.add(sky.mesh);
  scene.environment = envFrom(ctx, envTex);
  scene.environmentIntensity = 0.45;
  const fogCol = new THREE.Color().setRGB(...skyMeta.horizon).multiplyScalar(0.42);
  fogCol.b *= 1.04;
  scene.fog = new THREE.FogExp2(fogCol, 0.021);
  sky.u.uHorizon.value.copy(fogCol);
  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.85, 0.65), 1.1);
  sun.position.set(0.4, 0.7, -1).multiplyScalar(100);
  root.add(sun, sun.target);
  root.add(new THREE.HemisphereLight(new THREE.Color(0.55, 0.62, 0.7), new THREE.Color(0.12, 0.11, 0.08), 0.5));

  // ── suelo del bosque y sendero ──
  const floorMat = pbr(ctx, floorSet, { roughness: 1, color: new THREE.Color(0.8, 0.78, 0.72) });
  floorMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vPX;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPX = position.x;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vPX;')
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    float e = ${PATH_W.toFixed(2)} + 0.25 * sin(vMapUv.y * 1.7) + 0.12 * sin(vMapUv.y * 5.3 + 1.0);
    float path = 1.0 - smoothstep(e - 0.25, e + 0.45, abs(vPX));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.26, 0.19) * (0.75 + 0.5 * diffuseColor.g), path * 0.75);
  }`);
  };
  const fg = new THREE.PlaneGeometry(120, 600).rotateX(-Math.PI / 2).translate(0, 0, -290);
  const floor = new THREE.Mesh(fg, floorMat);
  floor.frustumCulled = false;
  root.add(floor);

  // ── abetos (patrón de 220 m, dos copias) ──
  const rnd = ctx.rng(5);
  const trees = [];
  for (let i = 0; i < 90; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (PATH_W + 2.2 + Math.pow(rnd(), 1.5) * 40);
    trees.push({ x, z: -rnd() * TREE_P, h: 14 + rnd() * 16, r: rnd() * 6.28 });
  }
  trees.sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
  const nT = trees.length;
  const firs = createFirs(ctx, {
    branchTex, barkTex, count: nT * 2,
    place: (i, t) => { const tr = trees[i >> 1]; t.p.set(tr.x, 0, tr.z - (i & 1 ? TREE_P : 0) + 8); t.s.set(tr.h, tr.h, tr.h); t.e.set(0, tr.r, 0); },
    tint: new THREE.Color(0.78, 0.86, 0.8),
  });
  const treeGroup = firs.group;
  root.add(treeGroup);

  // ── haces de luz entre los troncos (planos aditivos inclinados hacia el sol) ──
  const rayGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const nRay = 14;
  const rayMat = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(1.0, 0.86, 0.66) }, uPower: { value: 0.32 }, uFogD: { value: 0.01 } },
    vertexShader: RAY_VERT, fragmentShader: RAY_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const rays = new THREE.InstancedMesh(rayGeo, rayMat, nRay * 2);
  // una sola lista para las dos copias del patrón (sin saltos al enlazar)
  const rayList = [];
  for (let k = 0; k < nRay; k++) {
    const side = k % 2 ? 1 : -1;
    rayList.push({ side, x: side * (3 + rnd() * 14), z: -((k + rnd() * 0.6) / nRay) * TREE_P, w: 2.5 + rnd() * 4, tilt: -0.42 + rnd() * 0.1 });
  }
  setInstances(ctx, rays, nRay * 2, (i, t) => {
    const r = rayList[i % nRay];
    t.p.set(r.x, 0, r.z - (i >= nRay ? TREE_P : 0));
    t.s.set(r.w, 26, 1);
    t.e.set(0.35, 0.2 * r.side, r.tilt, 'YXZ');
  });
  rays.frustumCulled = false;
  rays.renderOrder = 25;
  treeGroup.add(rays);

  // ── balizas de madera cada 10 m a cada lado (luz del color del tramo) ──
  const nBol = (Math.ceil(300 / BOL_D) + 2) * 2;
  const BX = PATH_W + 0.55;
  const woodMat = new THREE.MeshStandardMaterial({ map: barkTex, color: new THREE.Color(0.55, 0.45, 0.36), roughness: 0.9 });
  const bol = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.62, 0.12).translate(0, 0.31, 0), woodMat, nBol);
  const lens = new THREE.InstancedMesh(new THREE.BoxGeometry(0.125, 0.06, 0.125).translate(0, 0.5, 0), glowMaterial(ctx, runner, { tint: '#ffd6a0', mix: 0.9, power: 4.5, fogK: 0.12 }), nBol);
  const bHalo = halos(ctx, runner, nBol, { tint: '#ffd6a0', mix: 0.9, size: 0.28, grow: 0.01, power: 0.5, fogD: 0.012 });
  const bolPos = (i, t) => { const side = i % 2 ? 1 : -1; const k = Math.floor(i / 2); t.p.set(side * BX, 0, 6 - k * BOL_D - (side > 0 ? BOL_D / 2 : 0)); };
  setInstances(ctx, bol, nBol, bolPos);
  setInstances(ctx, lens, nBol, bolPos);
  setInstances(ctx, bHalo, nBol, (i, t) => { bolPos(i, t); t.p.y = 0.5; });
  const bolGroup = new THREE.Group();
  for (const m of [bol, lens, bHalo]) { m.frustumCulled = false; bolGroup.add(m); }
  root.add(bolGroup);
  const rowL = new THREE.Vector4(-BX, 0.5, BOL_D, 0);
  const rowR = new THREE.Vector4(BX, 0.5, BOL_D, 0);
  addLamps(floorMat, ctx, runner, [rowL, rowR], { tint: '#ffd6a0', mix: 0.9, power: 2.2, range: 6 });

  // calidad baja: menos árboles (los de las dos copias del patrón a la vez; los más cercanos al sendero se quedan)
  function applyQuality() {
    const k = ctx.qualityLevel >= 2 ? 1 : ctx.qualityLevel === 1 ? 0.7 : 0.5;
    firs.foliage.count = firs.trunk.count = Math.max(2, Math.floor(nT * k) * 2);
  }
  applyQuality();

  const inst = {
    director: { scale: 0.85, maxDown: 0.12, orbit: true },
    resize(s) { runner.resize(s); },
    update(f) {
      const st = runner.update(f);
      const S = st.S;
      floorSet.offset.y = (S / FLOOR_TILE) % 1;
      treeGroup.position.z = scrollZ(S, TREE_P);
      bolGroup.position.z = scrollZ(S, BOL_D);
      rowL.w = bolGroup.position.z + 6;
      rowR.w = bolGroup.position.z + 6 - BOL_D / 2;
    },
    event(type, data) {
      runner.event(type, data);
      if (type === 'quality') applyQuality();
    },
    get _debug() { return { ...runner.debug(), tris: firs.tris }; },
    dispose() {},
  };
  return inst;
}
