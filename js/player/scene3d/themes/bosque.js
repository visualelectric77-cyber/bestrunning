// RITMUP · escenario BOSQUE (realista). Un sendero de tierra y pinaza entre abetos altos (ramas fotográficas reales),
// con niebla de la mañana que se espesa a lo lejos y haces de luz que cruzan entre los troncos. Balizas bajas de madera
// cada 10 m a cada lado del sendero, con la luz del color del tramo y su charco de luz en el suelo (encendido en cadena
// del kit). El cielo es un panorama real de mañana con niebla (CC0, Poly Haven).
// A VELOCIDAD REAL: suelo, árboles, balizas y haces avanzan a km/h ÷ 3,6 m/s.
import { createRunner, scrollZ } from './kit/runner.js';
import { worldUrl, loadTex, loadJson, loadSet, pbr, skyDome, envFrom, glowMaterial, halos, addLamps, setInstances } from './kit/world.js';
import { createFirs } from './kit/firs.js';
import { weatherWave, createRain, liveWeather, startLiveWeather } from './kit/weather.js';

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
// Pasillo libre de ramas: la rama más baja de un abeto del kit llega a 0,36 × su altura y cuelga hasta la altura de
// los ojos. Con abetos de 14–30 m a 3,5 m del eje, 16 de los 90 metían ramas a menos de 0,6 m del eje (14 cruzaban el
// sendero entero): ramas negras atravesando la cámara y tapando la cifra (y el plano final, a 6 m, dentro de una
// copa). Como en un bosque cerrado de verdad, los abetos cuya copa entraría a menos de CLEAR m del eje (el director
// mueve la cámara ±0,55 m) tienen el tronco limpio hasta LIFT m y la copa arriba; los de más lejos conservan las
// ramas bajas. Mismos árboles, mismas llamadas de dibujo y mismos triángulos.
const CLEAR = 1.5;
const REACH = 0.36;
const LIFT = 7.5;

// Haces: se ven entre los troncos, no sobre el sendero abierto (vX: se apagan a menos de ~6 m del eje, que es donde
// quedan justo detrás de la cifra) y se pierden en la niebla como los árboles (uFogD).
const RAY_VERT = /* glsl */ `
varying vec2 vUv;
varying float vK;
varying float vX;
uniform float uFogD;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vX = w.x;
  float d = length(w.xyz - cameraPosition);
  vK = smoothstep(4.0, 18.0, d) * exp(-d * uFogD);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const RAY_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uPower;
varying vec2 vUv;
varying float vK;
varying float vX;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.2, 1.0, x)) * smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
  a *= 0.25 + 0.75 * smoothstep(1.5, 6.5, abs(vX));
  gl_FragColor = vec4(uCol * a * vK * uPower, 1.0);
}`;

// SOL ENTRE LOS TRONCOS sin pasada de sombras: las sombras de los 90 abetos (tronco + copa, en la dirección del sol
// del escenario) se dibujan UNA vez en un lienzo de 256 × 1024 (64 m de ancho × el periodo de 220 m del bosque) y el
// suelo lo lee con una sola muestra: franjas largas de sombra y claros de sol que cruzan el sendero hacia ti, pegadas
// al pie de cada tronco. Las motas de polvo leen el mismo mapa (en el vértice): solo brillan dentro de un haz de sol.
const SH_W = 64;                    // m de ancho que cubre el mapa (centrado en el sendero)
const SUN_X = -1.1;                 // m de sombra por m de altura (x, z): sol a 37°, a la derecha y algo de frente,
const SUN_Z = 0.7;                  // para que las sombras CRUCEN el sendero en diagonal (el mismo sol que la luz)
function shadowTexture(ctx, trees) {
  const { THREE } = ctx;
  const W = 256; const H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  const X = (x) => (x / SH_W + 0.5) * W;
  const Z = (z) => (z / TREE_P) * H;
  const OFF = 4 * W;                 // la figura se dibuja fuera del lienzo: solo queda su sombra difuminada
  g.fillStyle = '#000';
  g.shadowOffsetX = OFF;
  const poly = (pts, off) => {
    g.beginPath();
    pts.forEach(([x, z], i) => { const a = X(x) - OFF; const b = Z(z) + off; if (i) g.lineTo(a, b); else g.moveTo(a, b); });
    g.closePath();
    g.fill();
  };
  const nx = 0.537; const nz = 0.844;   // perpendicular a la sombra
  const rnd = ctx.rng(77);
  // manchas de cada copa (porosa: varias manchas sueltas a lo largo de su sombra, con claros de sol entre ellas)
  const blobs = trees.map((tr) => {
    const hc = tr.h - tr.lift; const out = [];
    for (let k = 0; k < 9; k++) {
      const u = (k + rnd() * 0.8) / 9;
      out.push([tr.lift + (0.1 + 0.88 * u) * hc, (rnd() - 0.5) * 0.36 * hc * (1 - u), (0.25 * (1 - u) + 0.04) * hc * (0.7 + 0.6 * rnd())]);
    }
    return out;
  });
  for (const off of [0, H]) {
    trees.forEach((tr, i) => {
      const sx = (y) => tr.x + SUN_X * y; const sz = (y) => tr.z + 8 + SUN_Z * y;
      g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 4;
      for (const [y, lat, r] of blobs[i]) {
        g.beginPath();
        g.ellipse(X(sx(y) + nx * lat) - OFF, Z(sz(y) + nz * lat) + off, (r / SH_W) * W, (r / TREE_P) * H, 0, 0, 6.2832);
        g.fill();
      }
      // tronco: una franja nítida desde el pie hasta que se pierde en la sombra de la copa
      const w0 = Math.max(0.28, 0.02 * tr.h); const yt = Math.max(tr.lift + 0.2 * (tr.h - tr.lift), tr.h * 0.35); const w1 = w0 * 0.6;
      g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = 1.5;
      poly([[sx(0) - nx * w0, sz(0) - nz * w0], [sx(0) + nx * w0, sz(0) + nz * w0], [sx(yt) + nx * w1, sz(yt) + nz * w1], [sx(yt) - nx * w1, sz(yt) - nz * w1]], off);
    });
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false;
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = Math.min(4, ctx.renderer.capabilities.getMaxAnisotropy());
  return tex;
}

const MOTE_VERT = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime, uS, uSize, uShZ, uShK;
uniform sampler2D uShadow;
varying float vA;
void main() {
  vec3 b = vec3(22.0, 6.5, 36.0);
  vec3 p = aSeed * b;
  p.x += 0.6 * sin(uTime * 0.21 + aSeed.z * 40.0) - b.x * 0.5;
  p.y = 0.25 + mod(p.y + 0.35 * sin(uTime * 0.17 + aSeed.x * 31.0) + uTime * 0.03 * (aSeed.z - 0.3), b.y);
  p.z = -mod(aSeed.z * b.z - uS, b.z) + 1.5;
  vec2 gp = p.xz + vec2(${SUN_X}, ${SUN_Z}) * p.y;
  float lit = texture2D(uShadow, vec2(gp.x / ${SH_W.toFixed(1)} + 0.5, (gp.y - uShZ) / ${TREE_P.toFixed(1)})).r;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  float tw = 0.6 + 0.4 * sin(uTime * (0.8 + aSeed.y) + aSeed.x * 50.0);
  vA = smoothstep(0.8, 2.5, d) * (1.0 - smoothstep(14.0, 26.0, d)) * (0.1 + 0.9 * lit * uShK) * tw;
  gl_PointSize = uSize * (0.5 + aSeed.y) / max(d, 0.8);
  gl_Position = projectionMatrix * mv;
}`;
const MOTE_FRAG = /* glsl */ `
varying float vA;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.05, length(q)) * vA;
  gl_FragColor = vec4(vec3(1.0, 0.86, 0.62) * a * 0.75, 1.0);
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
  });   // el plano final lo compone este escenario (abajo, en update)

  // ── cielo de niebla, entorno, luz suave de la mañana ──
  const sky = skyDome(ctx, skyTex, skyMeta, { gain: 0.35, grad: 0.4, gradEl: 0.5, tint: new THREE.Color(0.9, 0.97, 1.05) });
  root.add(sky.mesh);
  scene.environment = envFrom(ctx, envTex);
  scene.environmentIntensity = 0.45;
  const fogCol = new THREE.Color().setRGB(...skyMeta.horizon).multiplyScalar(0.35);
  fogCol.b *= 1.04;
  scene.fog = new THREE.FogExp2(fogCol, 0.021);
  sky.u.uHorizon.value.copy(fogCol);
  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.85, 0.65), 1.1);
  sun.position.set(-SUN_X, 1, -SUN_Z).multiplyScalar(100);   // el mismo sol que dibuja las sombras del suelo
  root.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(new THREE.Color(0.55, 0.62, 0.7), new THREE.Color(0.12, 0.11, 0.08), 0.5);
  root.add(hemi);

  // ── suelo del bosque y sendero ──
  const shadowU = { uShadow: { value: null }, uShZ: { value: 0 }, uShK: { value: 1 } };
  const floorMat = pbr(ctx, floorSet, { roughness: 1, color: new THREE.Color(0.8, 0.78, 0.72) });
  floorMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shadowU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vPX;\nvarying float vPZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPX = position.x;\n  vPZ = position.z;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vPX;\nvarying float vPZ;\nuniform sampler2D uShadow;\nuniform float uShZ, uShK;')
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    float e = ${PATH_W.toFixed(2)} + 0.25 * sin(vMapUv.y * 1.7) + 0.12 * sin(vMapUv.y * 5.3 + 1.0);
    float path = 1.0 - smoothstep(e - 0.25, e + 0.45, abs(vPX));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.26, 0.19) * (0.75 + 0.5 * diffuseColor.g), path * 0.75);
    float lit = texture2D(uShadow, vec2(vPX / ${SH_W.toFixed(1)} + 0.5, (vPZ - uShZ) / ${TREE_P.toFixed(1)})).r;
    lit = mix(lit, 0.4, smoothstep(24.0, 31.0, abs(vPX)));
    diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.46, 0.52, 0.66), vec3(1.5, 1.24, 0.9), lit), uShK);
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
    const tr = { x, z: -rnd() * TREE_P, h: 14 + rnd() * 16, r: rnd() * 6.28, lift: 0 };
    if (REACH * tr.h > Math.abs(x) - CLEAR) tr.lift = LIFT + tr.r * 0.3;   // 7,5–9,4 m de tronco limpio
    trees.push(tr);
  }
  trees.sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
  shadowU.uShadow.value = shadowTexture(ctx, trees);
  const nT = trees.length;
  const firs = createFirs(ctx, {
    branchTex, barkTex, count: nT * 2,
    place: (i, t) => { const tr = trees[i >> 1]; t.p.set(tr.x, 0, tr.z - (i & 1 ? TREE_P : 0) + 8); t.s.setScalar(tr.h); t.e.set(0, tr.r, 0); },
    tint: new THREE.Color(0.78, 0.86, 0.8),
  });
  // la copa de los abetos del pasillo, arriba (el tronco sigue entero): mismas posiciones, más pequeña y elevada
  setInstances(ctx, firs.foliage, nT * 2, (i, t) => { const tr = trees[i >> 1]; t.p.set(tr.x, tr.lift, tr.z - (i & 1 ? TREE_P : 0) + 8); t.s.setScalar(tr.h - tr.lift); t.e.set(0, tr.r, 0); });
  const treeGroup = firs.group;
  root.add(treeGroup);

  // ── haces de luz entre los troncos (planos aditivos inclinados hacia el sol) ──
  const rayGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const nRay = 14;
  const rayMat = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(1.0, 0.86, 0.66) }, uPower: { value: 0.28 }, uFogD: { value: 0.018 } },
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
  floorMat.customProgramCacheKey = () => 'bosque-suelo-sombras';

  // calidad baja: menos árboles (los de las dos copias del patrón a la vez; los más cercanos al sendero se quedan)
  function applyQuality() {
    const k = ctx.qualityLevel >= 2 ? 1 : ctx.qualityLevel === 1 ? 0.7 : 0.5;
    firs.foliage.count = firs.trunk.count = Math.max(2, Math.floor(nT * k) * 2);
  }
  applyQuality();

  // ── escenario vivo (web 1.15): la niebla entra y sale despacio (~4 min); cuando se espesa, los haces de luz entre
  //    los troncos se marcan más (luz en el aire húmedo) ──
  const fog0 = scene.fog.density;
  const ray0 = rayMat.uniforms.uPower.value;
  const gain0 = sky.u.uGain.value;
  const fogC0 = scene.fog.color.clone();
  const env0 = scene.environmentIntensity;
  const sun0 = sun.intensity;
  startLiveWeather();   // «Tiempo real» (Ajustes): la hora y el tiempo del sitio elegido
  const rain = createRain(ctx, { count: ctx.qualityLevel >= 2 ? 1400 : 800, color: [0.3, 0.33, 0.36] });
  root.add(rain.mesh);

  // ── motas de polvo y polen en los haces de sol (una llamada de dibujo; solo brillan donde da el sol) ──
  const nMote = ctx.qualityLevel >= 2 ? 700 : 350;
  const mr = ctx.rng(31);
  const mSeed = new Float32Array(nMote * 3);
  for (let i = 0; i < mSeed.length; i++) mSeed[i] = mr();
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nMote * 3), 3));
  mg.setAttribute('aSeed', new THREE.BufferAttribute(mSeed, 3));
  const moteU = { uTime: { value: 0 }, uS: { value: 0 }, uSize: { value: 17 }, ...shadowU };
  const motes = new THREE.Points(mg, new THREE.ShaderMaterial({
    uniforms: moteU, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  motes.frustumCulled = false;
  motes.renderOrder = 35;
  root.add(motes);

  // ── plano final: corte a ras de suelo mirando hacia las copas y grúa lenta hasta ver el sendero entero ──
  const { smoothstep } = ctx.util;
  let finClock = 0;
  let wasFinale = false;

  const inst = {
    director: { scale: 0.85, maxDown: 0.12, orbit: true },
    resize(s) {
      runner.resize(s);
      moteU.uSize.value = 17 * (ctx.size.dpr || 1) * (ctx.size.height / 900);
    },
    update(f) {
      const st = runner.update(f);
      const S = st.S;
      const finale = f.finale > 0;
      if (finale) {
        finClock = wasFinale ? finClock + f.dt : 0;
        const p = st.rm ? 1 : smoothstep(0, 10, finClock);
        const sway = st.rm ? 0 : smoothstep(9, 13, finClock);
        const Tg = ctx.rig.target;
        Tg.position.set(sway * 0.5 * Math.sin((finClock - 9) * 0.2), 0.9 + (st.portrait ? 5.2 : 4.0) * p + sway * 0.25 * Math.sin((finClock - 9) * 0.15), 3 - 4 * p);
        Tg.lookAt.set(0, 3.4 - 2.9 * p, -40);
        Tg.fov = st.portrait ? 72 - 12 * p : 58 - 4 * p;
        Tg.shift.set(0, 0);
        ctx.rig.settle.position = 1.4; ctx.rig.settle.lookAt = 1.4; ctx.rig.settle.fov = 2;
        if (!wasFinale) ctx.rig.snap();
      }
      wasFinale = finale;
      floorSet.offset.y = (S / FLOOR_TILE) % 1;
      treeGroup.position.z = scrollZ(S, TREE_P);
      shadowU.uShZ.value = treeGroup.position.z;
      moteU.uS.value = S % 36;
      moteU.uTime.value = st.rm ? 0 : f.time;
      // con «Tiempo real»: la hora y el tiempo del sitio elegido (de noche el bosque se apaga, con nubes no hay haces)
      const w = liveWeather();
      const mist = w ? Math.min(1, 0.35 + 0.5 * w.cloud + w.mist) : st.rm ? 0.5 : weatherWave(f.t, 250, 0.6, 1.4);
      const day = w ? 0.12 + 0.88 * w.day : 1;
      scene.fog.density = fog0 * (0.72 + 0.6 * mist);
      rayMat.uniforms.uPower.value = ray0 * (0.6 + 0.9 * mist) * (w ? day * (1 - 0.8 * w.cloud) : 1);
      sky.u.uGain.value = gain0 * day * (w ? 1 - 0.3 * w.cloud : 1);
      sun.intensity = sun0 * day * (w ? 1 - 0.7 * w.cloud : 1);
      shadowU.uShK.value = (w ? day * (1 - 0.85 * w.cloud) : 1) * (1.15 - 0.3 * mist);   // con nubes o de noche no hay sol que dé sombra
      // de noche la niebla también se apaga (si no, el bosque brilla gris en la oscuridad)
      scene.fog.color.copy(fogC0).multiplyScalar(w ? 0.08 + 0.92 * day : 1);
      sky.u.uHorizon.value.copy(scene.fog.color);
      hemi.intensity = 0.5 * (w ? 0.15 + 0.85 * day : 1);
      scene.environmentIntensity = env0 * (w ? 0.1 + 0.9 * day : 1);
      rain.update(f, S, w ? w.rain : 0);
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
  inst.resize({ aspect: ctx.size.aspect });
  return inst;
}
