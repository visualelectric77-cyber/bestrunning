// RITMUP · escenario NAVIDAD (especial de temporada, realista). Noche de invierno con la luna entre nubes (panorama
// real CC0): un camino de nieve pisada entre abetos nevados (ramas fotográficas reales con nieve encima), algunos con
// guirnaldas de bombillas cálidas, farolillos cada 8 m al tresbolillo que tiñen su luz con el color del tramo
// (encendido en cadena del kit), cabañas con las ventanas encendidas y nieve cayendo despacio. Clase con
// workout.event === 'navidad': rótulo sobrio «NAVIDAD» al principio.
// A VELOCIDAD REAL: nieve del suelo, árboles, farolillos y cabañas avanzan a km/h ÷ 3,6 m/s.
import { createRunner, scrollZ } from './kit/runner.js';
import { worldUrl, loadTex, loadJson, loadSet, pbr, skyDome, envFrom, glowMaterial, halos, addLamps, setInstances } from './kit/world.js';
import { createFirs } from './kit/firs.js';
import { liveWeather, startLiveWeather } from './kit/weather.js';

export const meta = {
  id: 'nieve',
  name: 'Navidad',
  description: 'Un camino nevado entre abetos con guirnaldas, farolillos y nieve cayendo.',
};

const T = 'nieve';
const TREE_P = 240;
const LANT_D = 8;
const SNOW_TILE = 3.5;
const PATH_W = 1.5;
const WARM = '#ffc27a';
// Pasillo libre de ramas: la rama más baja de un abeto del kit llega a 0,36 × su escala radial y cuelga hasta la
// altura de los ojos. Dos de los 110 abetos (13–14 m, a 4 m del eje) metían ramas hasta 0,8–1,0 m del eje, y el
// director mueve la cámara ±0,55 m: pasaban rozándola. Los pocos abetos cuya copa entraría a menos de CLEAR m del eje
// la llevan más estrecha (y su guirnalda con ella); el resto no cambia.
const CLEAR = 1.5;
const REACH = 0.36;

const FLAKE_VERT = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime, uS, uSize, uFall, uDrift, uDens;
uniform vec4 uRowL, uRowR;     // hileras de farolillos (x, y, separación, zOff): las mismas que alumbran la nieve
varying float vA;
varying float vL;
float lampGlow(vec3 p, vec4 R) {
  float zk = R.w - floor((R.w - p.z) / R.z + 0.5) * R.z;
  vec3 dv = p - vec3(R.x, R.y, zk);
  return 1.0 / (1.0 + dot(dv, dv) * 0.5);
}
void main() {
  // copos en una caja de 24 × 10 × 60 m delante de la cámara; caen, derivan con el viento y avanzan con el mundo.
  // uFall y uDrift son fases ACUMULADAS (en JS): la nevada puede acelerar sin que los copos salten
  vec3 b = vec3(24.0, 10.0, 60.0);
  vec3 p = aSeed * b;
  p.y = b.y - mod(aSeed.y * b.y + uFall * (0.55 + 0.4 * aSeed.x), b.y);
  p.x += sin(uTime * 0.5 + aSeed.z * 30.0) * 0.4 + mod(uDrift * (0.7 + 0.6 * aSeed.y) + aSeed.x * b.x, b.x) - aSeed.x * b.x;
  p.z = -mod(aSeed.z * b.z - uS, b.z) + 2.0;
  p.x -= b.x * 0.5;
  vL = lampGlow(p, uRowL) + lampGlow(p, uRowR);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vA = smoothstep(0.5, 2.0, d) * (1.0 - smoothstep(30.0, 58.0, d)) * step(fract(aSeed.x * 5.17 + aSeed.y * 2.31), uDens);
  gl_PointSize = uSize * (0.6 + 0.8 * aSeed.x) / max(d, 0.5);
  gl_Position = projectionMatrix * mv;
}`;
const FLAKE_FRAG = /* glsl */ `
uniform vec3 uLampCol;
varying float vA;
varying float vL;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(q)) * vA;
  gl_FragColor = vec4((vec3(0.75, 0.8, 0.9) * 0.6 + uLampCol * vL) * a, 1.0);
}`;

/** Une geometrías sueltas en una sola (sin índices): el farol entero sigue siendo UNA malla por material. */
function mergeGeo(THREE, list) {
  const pos = []; const nor = []; const uv = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}

export async function createTheme(ctx) {
  const { THREE, root, camera, scene, renderer } = ctx;
  camera.near = 0.08;
  camera.far = 1600;
  renderer.setClearColor(0x05070d, 1);
  ctx.post.set({ toneMapping: 'aces', exposure: 0.95, bloomStrength: 0.48, bloomThreshold: 0.88, bloomRadius: 0.34, vignette: 0.34, saturation: 1.02 });

  const [skyMeta, skyTex, envTex, snowSet, branchTex, barkTex] = await Promise.all([
    loadJson(T, 'sky.json'),
    loadTex(ctx, worldUrl(T, 'sky.jpg'), { srgb: true, aniso: 1 }),
    loadTex(ctx, worldUrl(T, 'env.jpg'), { srgb: true, aniso: 1 }),
    loadSet(ctx, T, 'snow', [140 / SNOW_TILE, 600 / SNOW_TILE]),
    loadTex(ctx, worldUrl(T, 'branch.webp'), { srgb: true, aniso: 4 }),
    loadTex(ctx, worldUrl(T, 'bark.jpg'), { srgb: true, aniso: 4 }),
  ]);

  const runner = createRunner(ctx, {
    exposure: 0.95,
    title: ctx.workout?.event === 'navidad' ? 'Navidad' : null,
    titleColor: '#fff1dc',
  });   // el plano final lo compone este escenario (abajo, en update)

  // ── noche de luna entre nubes (azul frío), entorno y niebla ──
  const sky = skyDome(ctx, skyTex, skyMeta, { gain: 0.22, grad: 0.35, gradEl: 0.5, tint: new THREE.Color(0.62, 0.74, 1.15) });
  root.add(sky.mesh);
  scene.environment = envFrom(ctx, envTex);
  scene.environmentIntensity = 0.2;
  const fogCol = new THREE.Color(0.035, 0.045, 0.075);
  sky.u.uHorizon.value.copy(fogCol);
  scene.fog = new THREE.FogExp2(fogCol, 0.016);
  const moon = new THREE.DirectionalLight(new THREE.Color(0.6, 0.7, 1.0), 0.35);
  moon.position.set(0.3, 0.8, -1).multiplyScalar(100);
  root.add(moon, moon.target);
  root.add(new THREE.HemisphereLight(new THREE.Color(0.35, 0.45, 0.7), new THREE.Color(0.08, 0.09, 0.12), 0.35));

  // ── nieve del suelo con el camino pisado ──
  const snowMat = pbr(ctx, snowSet, { roughness: 0.85, color: new THREE.Color(0.85, 0.9, 1.0), env: 0.8 });
  snowMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vPX;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPX = position.x;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vPX;')
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    float e = ${PATH_W.toFixed(2)} + 0.15 * sin(vMapUv.y * 2.1);
    float path = 1.0 - smoothstep(e - 0.3, e + 0.3, abs(vPX));
    float rut = exp(-pow((abs(vPX) - 0.5) / 0.22, 2.0));
    diffuseColor.rgb *= 1.0 - path * (0.22 + 0.2 * rut);
  }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.45, 1.0 - smoothstep(1.0, 1.8, abs(vPX)));');
  };
  const sg = new THREE.PlaneGeometry(140, 600).rotateX(-Math.PI / 2).translate(0, 0, -290);
  const ground = new THREE.Mesh(sg, snowMat);
  ground.frustumCulled = false;
  root.add(ground);

  // ── abetos nevados ──
  const rnd = ctx.rng(17);
  const trees = [];
  for (let i = 0; i < 110; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (PATH_W + 2.4 + Math.pow(rnd(), 1.4) * 45);
    const tr = { x, z: -rnd() * TREE_P, h: 6 + rnd() * 9, r: rnd() * 6.28, lights: Math.abs(x) < 12 && rnd() < 0.5, w: 0 };
    tr.w = Math.min(tr.h * 0.8, (Math.abs(x) - CLEAR) / REACH);   // escala radial de la copa (y de su guirnalda)
    trees.push(tr);
  }
  trees.sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
  const nT = trees.length;
  const firs = createFirs(ctx, {
    branchTex, barkTex, count: nT * 2, snow: 1, seed: 9,
    place: (i, t) => { const tr = trees[i >> 1]; t.p.set(tr.x, 0, tr.z - (i & 1 ? TREE_P : 0) + 8); t.s.set(tr.w, tr.h, tr.w); t.e.set(0, tr.r, 0); },
    tint: new THREE.Color(0.55, 0.65, 0.62),
  });
  const treeGroup = firs.group;
  root.add(treeGroup);

  // guirnaldas: bombillas cálidas en espiral sobre los abetos cercanos
  const bulbs = [];
  trees.forEach((tr) => {
    if (!tr.lights) return;
    const n = 26;
    for (let k = 0; k < n; k++) {
      const u = k / n;
      const y = 0.18 + 0.75 * u;
      const r = (0.03 + 0.25 * Math.pow(1 - u, 0.95)) * 0.92;
      const a = u * Math.PI * 2 * 4.5 + tr.r;
      bulbs.push([tr.x + Math.cos(a) * r * tr.w, y * tr.h, tr.z + 8 + Math.sin(a) * r * tr.w]);
    }
  });
  const nBulb = bulbs.length;
  const bulbMat = glowMaterial(ctx, runner, { tint: WARM, mix: 0.25, power: 6, fogK: 0.15 });
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 6, 4), bulbMat, nBulb * 2);
  const bulbHalo = halos(ctx, runner, nBulb * 2, { tint: WARM, mix: 0.25, size: 0.16, grow: 0.004, power: 0.4, fogD: 0.01 });
  for (const m of [bulbMesh, bulbHalo]) setInstances(ctx, m, nBulb * 2, (i, t) => { const b = bulbs[i % nBulb]; t.p.set(b[0], b[1], b[2] - (i >= nBulb ? TREE_P : 0)); });
  for (const m of [bulbMesh, bulbHalo]) { m.frustumCulled = false; treeGroup.add(m); }

  // ── cabañas con ventanas encendidas (patrón del bosque) ──
  const cabins = [];
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    cabins.push({ x: side * (16 + rnd() * 18), z: -((i + rnd() * 0.5) / 6) * TREE_P + 8, w: 6 + rnd() * 3, d: 5 + rnd() * 2, r: (rnd() - 0.5) * 0.6 });
  }
  const wood = new THREE.MeshStandardMaterial({ map: barkTex, color: new THREE.Color(0.42, 0.3, 0.22), roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.8, 0.85, 0.95), roughness: 0.7 });
  const nC = cabins.length;
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), wood, nC * 2);
  // tejado a dos aguas: prisma triangular a lo largo de la profundidad, con la cumbrera arriba
  const roofGeo = new THREE.CylinderGeometry(0.75, 0.75, 1.08, 3, 1).rotateX(Math.PI / 2).rotateZ(Math.PI).translate(0, 1.375, 0);
  const roof = new THREE.InstancedMesh(roofGeo, roofMat, nC * 2);
  const win = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 0.22).translate(0, 0.45, 0.502), glowMaterial(ctx, runner, { tint: WARM, mix: 0, power: 3.5, fogK: 0.12 }), nC * 4);
  const cabPos = (c, copy, t) => { t.p.set(c.x, 0, c.z - copy * TREE_P); t.e.set(0, c.r + (c.x > 0 ? -Math.PI / 2 : Math.PI / 2), 0); t.s.set(c.w, 3.2, c.d); };
  setInstances(ctx, body, nC * 2, (i, t) => cabPos(cabins[i % nC], i >= nC ? 1 : 0, t));
  setInstances(ctx, roof, nC * 2, (i, t) => { cabPos(cabins[i % nC], i >= nC ? 1 : 0, t); t.s.set(cabins[i % nC].w * 1.15, 3.2, cabins[i % nC].d * 1.2); });
  setInstances(ctx, win, nC * 4, (i, t) => {
    const c = cabins[(i >> 1) % nC]; const copy = (i >> 1) >= nC ? 1 : 0;
    cabPos(c, copy, t);
    t.p.x += 0; // ventanas en la fachada que mira al camino (+z local tras el giro)
    const off = (i % 2 ? 0.22 : -0.22);
    const ca = Math.cos(t.e.y); const sa = Math.sin(t.e.y);
    t.p.x += ca * off * c.w; t.p.z -= sa * off * c.w;
  });
  const cabGroup = new THREE.Group();
  for (const m of [body, roof, win]) { m.frustumCulled = false; cabGroup.add(m); }
  treeGroup.add(cabGroup);

  // ── farolillos cada 8 m al tresbolillo ──
  const nL = (Math.ceil(300 / LANT_D) + 2) * 2;
  const LX = PATH_W + 0.5;
  const ironMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.05, 0.05, 0.06), roughness: 0.5, metalness: 0.7 });
  // FAROL de verdad (antes: un poste con un cubo luminoso): pie, poste, bandeja, cuatro montantes de hierro por fuera
  // del cristal (se recortan a contraluz), tapa, tejadillo nevado y remate. Todo el hierro va unido en UNA geometría
  // (misma malla y mismo material que el poste: ni una llamada de dibujo más); el cristal baja de potencia para que
  // se vea cálido y con el color del tramo en vez de un bloque quemado a blanco.
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const ironGeo = mergeGeo(THREE, [
    new THREE.CylinderGeometry(0.028, 0.04, 1.16, 8).translate(0, 0.6, 0),          // poste
    new THREE.CylinderGeometry(0.06, 0.085, 0.05, 8).translate(0, 0.025, 0),        // pie
    new THREE.CylinderGeometry(0.075, 0.03, 0.05, 8).translate(0, 1.185, 0),        // cuello
    box(0.25, 0.018, 0.25, 0, 1.215, 0),                                            // bandeja
    box(0.26, 0.02, 0.26, 0, 1.515, 0),                                             // tapa
    ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, c]) => box(0.02, 0.29, 0.02, a * 0.108, 1.365, c * 0.108)),   // montantes
    new THREE.CylinderGeometry(0.008, 0.012, 0.09, 6).translate(0, 1.7, 0),         // remate
  ]);
  const post = new THREE.InstancedMesh(ironGeo, ironMat, nL);
  const cageMat = glowMaterial(ctx, runner, { tint: WARM, mix: 0.5, power: 2.5, fogK: 0.12 });
  const cage = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.28, 0.2).translate(0, 1.365, 0), cageMat, nL);
  const cap = new THREE.InstancedMesh(new THREE.ConeGeometry(0.21, 0.14, 4).rotateY(Math.PI / 4).translate(0, 1.595, 0), roofMat, nL);
  const lHalo = halos(ctx, runner, nL, { tint: WARM, mix: 0.5, size: 0.42, grow: 0.008, power: 0.55, fogD: 0.01 });
  const lPos = (i, t) => { const side = i % 2 ? 1 : -1; const k = Math.floor(i / 2); t.p.set(side * LX, 0, 6 - k * LANT_D - (side > 0 ? LANT_D / 2 : 0)); };
  for (const m of [post, cage, cap]) setInstances(ctx, m, nL, lPos);
  setInstances(ctx, lHalo, nL, (i, t) => { lPos(i, t); t.p.y = 1.365; });
  const lGroup = new THREE.Group();
  for (const m of [post, cage, cap, lHalo]) { m.frustumCulled = false; lGroup.add(m); }
  root.add(lGroup);
  const rowL = new THREE.Vector4(-LX, 1.36, LANT_D, 0);
  const rowR = new THREE.Vector4(LX, 1.36, LANT_D, 0);
  addLamps(snowMat, ctx, runner, [rowL, rowR], { tint: WARM, mix: 0.5, power: 3.2, range: 9 });
  snowMat.customProgramCacheKey = () => 'nieve-suelo';

  // ── nieve que cae ──
  const nF = ctx.qualityLevel >= 2 ? 2200 : 1100;
  const fr = ctx.rng(23);
  const seeds = new Float32Array(nF * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = fr();
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nF * 3), 3));
  fg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  startLiveWeather();   // «Tiempo real» (Ajustes): la hora y el tiempo del sitio elegido
  const flakeU = {
    uTime: { value: 0 }, uS: { value: 0 }, uSize: { value: 40 }, uFall: { value: 0 }, uDrift: { value: 0 }, uDens: { value: 0.5 },
    uRowL: { value: rowL }, uRowR: { value: rowR }, uLampCol: { value: new THREE.Color() },
  };
  const warmCol = new THREE.Color(WARM);
  // escenario vivo (web 1.15): la nevada sigue la intensidad del tramo (suave al trote, ventisca ligera en los sprints)
  const SNOW_E = { walk: 0.35, warmup: 0.4, cooldown: 0.35, jog: 0.5, run: 0.65, fast: 0.85, sprint: 1 };
  let snowE = -1;
  const flakes = new THREE.Points(fg, new THREE.ShaderMaterial({
    uniforms: flakeU, vertexShader: FLAKE_VERT, fragmentShader: FLAKE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  flakes.frustumCulled = false;
  flakes.renderOrder = 40;
  root.add(flakes);

  // calidad baja: menos árboles (los de las dos copias del patrón a la vez; los más cercanos al sendero se quedan)
  function applyQuality() {
    const k = ctx.qualityLevel >= 2 ? 1 : ctx.qualityLevel === 1 ? 0.7 : 0.5;
    firs.foliage.count = firs.trunk.count = Math.max(2, Math.floor(nT * k) * 2);
  }
  applyQuality();

  const { smoothstep } = ctx.util;
  let finClock = 0;
  let wasFinale = false;

  const inst = {
    director: { scale: 0.85, maxDown: 0.12, orbit: true },
    resize(s) {
      runner.resize(s);
      flakeU.uSize.value = 40 * (ctx.size.dpr || 1) * (ctx.size.height / 900);
    },
    update(f) {
      const st = runner.update(f);
      const S = st.S;
      // plano final: corte bajo entre los farolillos y grúa lenta hasta ver el camino de luces, las guirnaldas y la luna
      const finale = f.finale > 0;
      if (finale) {
        finClock = wasFinale ? finClock + f.dt : 0;
        const p = st.rm ? 1 : smoothstep(0, 10, finClock);
        const sway = st.rm ? 0 : smoothstep(9, 13, finClock);
        const Tg = ctx.rig.target;
        Tg.position.set(sway * 0.6 * Math.sin((finClock - 9) * 0.2), 1.05 + (st.portrait ? 6.6 : 4.6) * p + sway * 0.3 * Math.sin((finClock - 9) * 0.15), 2.5 + 3.5 * p);
        Tg.lookAt.set(0, 2.2 - 0.9 * p, -40);
        Tg.fov = st.portrait ? 70 - 10 * p : 56 - 2 * p;
        Tg.shift.set(0, 0);
        ctx.rig.settle.position = 1.4; ctx.rig.settle.lookAt = 1.4; ctx.rig.settle.fov = 2;
        if (!wasFinale) ctx.rig.snap();
      }
      wasFinale = finale;
      // las guirnaldas laten con la música (envolvente del compás: ±20 %, sin destellos); quietas con movimiento reducido
      const beat = st.rm ? 0.4 : f.beat;
      bulbMat.uniforms.uPower.value = 6 * (0.8 + 0.4 * beat);
      bulbHalo.material.uniforms.uPower.value = 0.4 * (0.7 + 0.75 * beat);
      flakeU.uLampCol.value.copy(warmCol).lerp(runner.u.uColNew.value, 0.5).multiplyScalar(1.8 * runner.u.uWave.value.z);
      snowSet.offset.y = (S / SNOW_TILE) % 1;
      treeGroup.position.z = scrollZ(S, TREE_P);
      lGroup.position.z = scrollZ(S, LANT_D);
      rowL.w = lGroup.position.z + 6;
      rowR.w = lGroup.position.z + 6 - LANT_D / 2;
      flakeU.uTime.value = st.rm ? 0 : f.time;
      // con «Tiempo real»: si nieva de verdad en el sitio elegido, nieva más; si está despejado, apenas unos copos
      const lw = liveWeather();
      const eT = lw ? Math.min(1, 0.2 + 0.8 * lw.snow + 0.25 * lw.cloud) : (SNOW_E[f.zone] ?? 0.5);
      snowE = snowE < 0 ? eT : snowE + (eT - snowE) * (1 - Math.exp(-f.dt * 0.35));
      flakeU.uDens.value = 0.35 + 0.65 * snowE;
      flakeU.uFall.value += f.dt * (0.7 + 1.5 * snowE * snowE);
      flakeU.uDrift.value += f.dt * 1.6 * Math.max(0, snowE - 0.55);
      flakeU.uS.value = S % 60;
      flakes.visible = !st.rm;
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
