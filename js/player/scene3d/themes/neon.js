// RITMUP · escenario NEÓN (realista). Una gran avenida de noche tras la lluvia: asfalto mojado con charcos que reflejan
// la ciudad (iluminación de entorno con un panorama nocturno real, CC0 de Poly Haven) y las farolas, rascacielos de
// hormigón con ventanas de cristal (unas encendidas, otras reflejando), escaparates en la planta baja y rótulos de
// neón en bandera. Al fondo de la avenida, el skyline real. El bordillo lleva una tira LED del color del tramo y las
// farolas mezclan su luz blanca con ese color, con el encendido en cadena del kit.
// A VELOCIDAD REAL: asfalto, aceras, edificios, rótulos y farolas avanzan a km/h ÷ 3,6 m/s.
// Coste: ~20 llamadas de dibujo, edificios instanciados con un solo material PBR parcheado (ventanas procedurales).
import { createRunner, scrollZ } from './kit/runner.js';
import { worldUrl, loadTex, loadJson, loadSet, pbr, skyDome, envFrom, glowMaterial, halos, addLamps, setInstances } from './kit/world.js';
import { createRain, weatherWave } from './kit/weather.js';

export const meta = {
  id: 'neon',
  name: 'Neón',
  description: 'Avenida mojada entre rascacielos, rótulos de neón y la ciudad reflejada en el asfalto.',
};

const T = 'neon';
const ROAD = 7;          // semiancho de la calzada
const WALK = 11.5;       // línea de fachadas
const LAMP_D = 30;
const BLD_P = 360;       // periodo del patrón de edificios (m)
const ROAD_TILE = 5;
const WALK_TILE = 3;
const SIGNS = ['HOTEL', 'BAR', 'CINE', 'RAMEN', '24H', 'KARAOKE', 'CAFÉ', 'CLUB'];
const SIGN_COLORS = ['#ff2d78', '#29d8ff', '#ffb02e', '#a35bff', '#ff4b3a', '#3dffb5', '#ff7ad9', '#5b8cff'];

/** Atlas de rótulos verticales: letras apiladas con trazo de tubo (blanco: el color lo pone el shader). */
function signAtlas(THREE) {
  const cw = 128; const ch = 768;
  const c = document.createElement('canvas');
  c.width = cw * SIGNS.length; c.height = ch;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  SIGNS.forEach((word, i) => {
    const x0 = i * cw;
    const letters = [...word];
    const step = Math.min(118, (ch - 60) / letters.length);
    g.save();
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.shadowColor = '#fff'; g.shadowBlur = 10;
    g.strokeRect(x0 + 10, 10, cw - 20, ch - 20);
    g.font = `800 ${Math.round(step * 0.82)}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const y0 = ch / 2 - (step * (letters.length - 1)) / 2;
    letters.forEach((L, k) => {
      g.lineWidth = 6; g.strokeText(L, x0 + cw / 2, y0 + k * step);
      g.shadowBlur = 18; g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillText(L, x0 + cw / 2, y0 + k * step);
    });
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const SIGN_VERT = /* glsl */ `
attribute vec4 aSign;   // x índice del rótulo, y,z,w color
varying vec2 vUv;
varying vec3 vCol;
#include <fog_pars_vertex>
void main() {
  vUv = vec2((uv.x + aSign.x) / ${SIGNS.length.toFixed(1)}, uv.y);
  vCol = aSign.yzw;
  vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const SIGN_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uPower, uTime;
varying vec2 vUv;
varying vec3 vCol;
#include <common>
#include <fog_pars_fragment>
void main() {
  float a = texture2D(uAtlas, vUv).r;
  vec3 col = vec3(0.012, 0.012, 0.016) + vCol * a * uPower;
  gl_FragColor = vec4(col, 1.0);
  #ifdef USE_FOG
  float ff = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth * 0.4);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, ff);
  #endif
}`;

export async function createTheme(ctx) {
  const { THREE, root, camera, scene, renderer } = ctx;
  camera.near = 0.1;
  camera.far = 3000;
  renderer.setClearColor(0x05040a, 1);
  ctx.post.set({ toneMapping: 'aces', exposure: 0.95, bloomStrength: 0.5, bloomThreshold: 0.88, bloomRadius: 0.36, vignette: 0.32, saturation: 1.08 });

  const [skyMeta, skyTex, envTex, road, facade, walk] = await Promise.all([
    loadJson(T, 'sky.json'),
    loadTex(ctx, worldUrl(T, 'sky.jpg'), { srgb: true, aniso: 1 }),
    loadTex(ctx, worldUrl(T, 'env.jpg'), { srgb: true, aniso: 1 }),
    loadSet(ctx, T, 'road', [2 * ROAD / ROAD_TILE, 800 / ROAD_TILE]),
    loadSet(ctx, T, 'facade', [1, 1]),
    loadSet(ctx, T, 'walk', [(WALK - ROAD) / WALK_TILE, 800 / WALK_TILE]),
  ]);

  const runner = createRunner(ctx, {
    exposure: 0.95,
    finale: (p, portrait) => { p.y = portrait ? 12 : 9; p.z = portrait ? 8 : 6; p.lookY = 2; p.lookZ = -60; p.fov = portrait ? 58 : 56; },
  });

  // ── cielo (skyline real al fondo), entorno y niebla ──
  const sky = skyDome(ctx, skyTex, skyMeta, { gain: 0.6, grad: 0.6, gradEl: 0.4, black: 0.02 });
  root.add(sky.mesh);
  scene.environment = envFrom(ctx, envTex);
  scene.environmentIntensity = 0.28;
  const hor = new THREE.Color().setRGB(...skyMeta.horizon);
  scene.fog = new THREE.FogExp2(hor.clone().multiplyScalar(0.16), 0.0045);
  root.add(new THREE.HemisphereLight(new THREE.Color(0.25, 0.22, 0.4), new THREE.Color(0.04, 0.03, 0.05), 0.12));

  // ── calzada mojada: charcos casi espejo y el resto satinado ──
  const roadMat = pbr(ctx, road, { roughness: 0.55, color: new THREE.Color(0.5, 0.5, 0.55), env: 1.6, normalScale: 0.7 });
  roadMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  {
    float pm = texture2D(roughnessMap, vRoughnessMapUv * 0.11 + 0.37).g * 0.6 + texture2D(roughnessMap, vRoughnessMapUv * 0.031).g * 0.6;
    float puddle = smoothstep(0.62, 0.7, pm);
    roughnessFactor = mix(roughnessFactor * 0.55, 0.035, puddle);
  }`).replace('#include <map_fragment>', `#include <map_fragment>
  {
    float pm2 = texture2D(roughnessMap, vRoughnessMapUv * 0.11 + 0.37).g * 0.6 + texture2D(roughnessMap, vRoughnessMapUv * 0.031).g * 0.6;
    diffuseColor.rgb *= mix(1.0, 0.35, smoothstep(0.6, 0.7, pm2));
  }`);
  };
  const strip = (x0, x1, y, mat) => {
    const g = new THREE.PlaneGeometry(x1 - x0, 800);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, y, -390);
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    root.add(m);
    return m;
  };
  strip(-ROAD, ROAD, 0, roadMat);
  const walkMat = pbr(ctx, walk, { roughness: 0.5, color: new THREE.Color(0.55, 0.55, 0.6), env: 1.2 });
  strip(-WALK - 2, -ROAD - 0.25, 0.15, walkMat);
  strip(ROAD + 0.25, WALK + 2, 0.15, walkMat);
  // bordillos y tira LED del color del tramo
  const curbMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.22, 0.22, 0.24), roughness: 0.6 });
  const led = glowMaterial(ctx, runner, { tint: '#ffffff', mix: 1, power: 5, fogK: 0.25 });
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.15, 900), curbMat);
    c.position.set(s * (ROAD + 0.125), 0.075, -440);
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 900), led);
    l.position.set(s * (ROAD + 0.02), 0.12, -440);
    root.add(c, l);
  }

  // marcas viales
  const paint = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.55, 0.55, 0.55), roughness: 0.35, env: 1 });
  for (const x of [-ROAD + 0.4, ROAD - 0.4]) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 800).rotateX(-Math.PI / 2), paint);
    l.position.set(x, 0.005, -390);
    l.frustumCulled = false;
    root.add(l);
  }
  const DASH_D = 10;
  const nDash = Math.ceil(520 / DASH_D) + 2;
  const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.14, 3.5).rotateX(-Math.PI / 2), paint, nDash * 2);
  setInstances(ctx, dashes, nDash * 2, (i, t) => { t.p.set(i % 2 ? 2.35 : -2.35, 0.006, 8 - Math.floor(i / 2) * DASH_D); });
  dashes.frustumCulled = false;
  const dashGroup = new THREE.Group();
  dashGroup.add(dashes);
  root.add(dashGroup);

  // ── edificios: cajas instanciadas, fachada PBR + ventanas procedurales (cristal que refleja, algunas encendidas) ──
  const rnd = ctx.rng(11);
  const blds = [];
  for (const side of [-1, 1]) {
    let z = 6;
    while (z > -BLD_P + 6) {
      const w = 12 + rnd() * 18;
      const gap = rnd() < 0.25 ? 3 + rnd() * 5 : 0.6;
      const h = 14 + Math.pow(rnd(), 1.8) * 90;
      const set = rnd() < 0.3 ? 2 + rnd() * 4 : 0;
      blds.push({ x: side * (WALK + set + 12), z: z - w / 2, w, h, d: 24 });
      z -= w + gap;
    }
  }
  const nB = blds.length;
  const bMat = pbr(ctx, facade, { roughness: 1, color: new THREE.Color(0.22, 0.22, 0.25), env: 1.0 });
  bMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFac;\nvarying vec3 vFacN;\nvarying float vSeed;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vFac = (instanceMatrix * vec4(position, 1.0)).xyz;
  vFacN = normal;
  vSeed = float(gl_InstanceID);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFac;
varying vec3 vFacN;
varying float vSeed;
float bh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gWin; float gLit; vec3 gWinCol; float gShop;`)
      .replace('#include <map_fragment>', `
  float side = step(0.5, abs(vFacN.x));
  float roof = step(0.5, vFacN.y);
  vec2 fuv = vec2(mix(vFac.x, vFac.z, side), vFac.y);
  vec4 tex = texture2D(map, fuv / 7.0);
  diffuseColor *= tex;
  float sd = bh(vec2(vSeed, 3.7));
  vec2 cell = vec2(fuv.x / (1.5 + 0.6 * sd), (fuv.y - 4.6) / (3.1 + 0.3 * sd));
  vec2 id = floor(cell); vec2 f = fract(cell);
  gWin = step(0.12, f.x) * step(f.x, 0.88) * step(0.28, f.y) * step(f.y, 0.86) * step(4.6, fuv.y) * (1.0 - roof);
  gLit = step(0.8 - 0.18 * sd, bh(id + vSeed * 17.0));
  gWinCol = mix(vec3(1.0, 0.7, 0.42), vec3(0.65, 0.82, 1.0), step(0.55, bh(id * 1.3 + vSeed)));
  gShop = step(fuv.y, 4.2) * step(0.4, fuv.y) * (1.0 - roof) * step(0.08, fract(fuv.x / 9.0)) * step(fract(fuv.x / 9.0), 0.92);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.022, 0.03), max(gWin, gShop));
  diffuseColor.rgb *= 1.0 - 0.8 * roof;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.06, max(gWin, gShop));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  normal = mix(normal, normalize(vNormal), max(gWin, gShop));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  float inner = (0.55 + 0.45 * smoothstep(0.86, 0.3, f.y)) * (0.7 + 0.3 * smoothstep(0.12, 0.5, min(f.x, 1.0 - f.x)));
  float blind = step(0.6, bh(id + 4.2)) * smoothstep(0.55, 0.6, f.y) * 0.75;
  totalEmissiveRadiance += gWinCol * gWin * gLit * (0.25 + 0.9 * pow(bh(id + 9.1), 2.0)) * inner * (1.0 - blind) * 0.28;
  float mull = step(0.06, fract(fuv.x / 1.5)) * step(fuv.y, 3.2);
  float shopOn = step(0.3, bh(floor(vec2(fuv.x / 9.0, vSeed))));
  vec3 shopCol = mix(vec3(1.0, 0.76, 0.5), vec3(0.75, 0.88, 1.0), step(0.6, bh(floor(vec2(fuv.x / 9.0, vSeed + 3.0)))));
  totalEmissiveRadiance += shopCol * gShop * mull * shopOn * (0.25 + 0.35 * smoothstep(3.2, 0.4, fuv.y)) * 0.6;`);
  };
  bMat.customProgramCacheKey = () => 'neon-bld';
  const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const bld = new THREE.InstancedMesh(boxGeo, bMat, nB * 2);
  setInstances(ctx, bld, nB * 2, (i, t) => {
    const b = blds[i % nB];
    t.p.set(b.x, 0, b.z - (i >= nB ? BLD_P : 0));
    t.s.set(b.d, b.h, b.w);
  });
  bld.frustumCulled = false;

  // ── rótulos de neón en bandera (sobresalen de la fachada, miran a la avenida) ──
  const atlas = signAtlas(THREE);
  const signGeo = new THREE.PlaneGeometry(1, 6).translate(0, 3, 0);
  const signs = [];
  blds.forEach((b, i) => {
    if (rnd() < 0.45) return;
    const side = Math.sign(b.x);
    const k = Math.floor(rnd() * SIGNS.length);
    signs.push({ x: side * (WALK - 0.95), z: b.z + b.w / 2 - 1.5, y: 5 + rnd() * Math.min(10, b.h - 12), k, c: new THREE.Color(SIGN_COLORS[(k + i) % SIGN_COLORS.length]) });
  });
  const nS = signs.length;
  const aSign = new Float32Array(nS * 2 * 4);
  const signMat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uAtlas: { value: atlas }, uPower: { value: 5 }, uTime: { value: 0 } },
    vertexShader: SIGN_VERT, fragmentShader: SIGN_FRAG, fog: true, side: THREE.DoubleSide,
  });
  const signMesh = new THREE.InstancedMesh(signGeo, signMat, nS * 2);
  setInstances(ctx, signMesh, nS * 2, (i, t) => {
    const s = signs[i % nS];
    t.p.set(s.x, s.y, s.z - (i >= nS ? BLD_P : 0));
    t.s.set(1.6, 1, 1);
    const c = s.c;
    aSign.set([s.k, c.r, c.g, c.b], i * 4);
  });
  signGeo.setAttribute('aSign', new THREE.InstancedBufferAttribute(aSign, 4));
  signMesh.frustumCulled = false;
  const bldGroup = new THREE.Group();
  bldGroup.add(bld, signMesh);
  root.add(bldGroup);

  // ── farolas (cada 30 m a cada lado, al tresbolillo): brazo sobre la calzada, LED blanco con el color del tramo ──
  const nLamp = (Math.ceil(560 / LAMP_D) + 2) * 2;
  const poleMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.08, 0.08, 0.09), roughness: 0.4, metalness: 0.8 });
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.13, 8, 10).translate(0, 4, 0);
  const armGeo = new THREE.BoxGeometry(2.6, 0.12, 0.18).translate(-1.3, 7.9, 0);
  const headGeo = new THREE.BoxGeometry(0.9, 0.04, 0.32).translate(-2.4, 7.82, 0);
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, nLamp);
  const arms = new THREE.InstancedMesh(armGeo, poleMat, nLamp);
  const heads = new THREE.InstancedMesh(headGeo, glowMaterial(ctx, runner, { tint: '#e8f0ff', mix: 0.45, power: 8 }), nLamp);
  const lampHalo = halos(ctx, runner, nLamp, { tint: '#e8f0ff', mix: 0.45, size: 1.0, grow: 0.007, power: 0.45, fogD: 0.003 });
  const LX = ROAD + 0.6;
  const lampPos = (i, t) => {
    const side = i % 2 ? 1 : -1; const k = Math.floor(i / 2);
    t.p.set(side * LX, 0, 10 - k * LAMP_D - (side > 0 ? LAMP_D / 2 : 0));
    t.e.set(0, side > 0 ? 0 : Math.PI, 0);
  };
  for (const m of [poles, arms, heads]) setInstances(ctx, m, nLamp, lampPos);
  setInstances(ctx, lampHalo, nLamp, (i, t) => { lampPos(i, t); const side = i % 2 ? 1 : -1; t.p.x -= side * 2.4; t.p.y = 7.75; t.e.set(0, 0, 0); });
  const lampGroup = new THREE.Group();
  for (const m of [poles, arms, heads, lampHalo]) { m.frustumCulled = false; lampGroup.add(m); }
  root.add(lampGroup);
  const rowL = new THREE.Vector4(-LX + 2.4, 7.7, LAMP_D, 0);
  const rowR = new THREE.Vector4(LX - 2.4, 7.7, LAMP_D, 0);
  const lampOpts = { tint: '#e8f0ff', mix: 0.45, power: 70, range: 30 };
  addLamps(roadMat, ctx, runner, [rowL, rowR], lampOpts);
  addLamps(walkMat, ctx, runner, [rowL, rowR], lampOpts);

  // ── escenario vivo (web 1.15): lluvia fina que va y viene (ratos secos y chaparrones de ~5 min); con lluvia el aire
  //    se carga un poco y las aceras brillan más ──
  const rain = createRain(ctx, { count: ctx.qualityLevel >= 2 ? 2000 : 1100 });
  root.add(rain.mesh);
  const fog0 = scene.fog.density;
  let rainK = -1;

  const inst = {
    director: { scale: 1.2, maxDown: 0.2, orbit: true },
    resize(s) { runner.resize(s); },
    update(f) {
      const st = runner.update(f);
      const S = st.S;
      road.offset.y = (S / ROAD_TILE) % 1;
      walk.offset.y = (S / WALK_TILE) % 1;
      dashGroup.position.z = scrollZ(S, DASH_D);
      bldGroup.position.z = scrollZ(S, BLD_P);
      lampGroup.position.z = scrollZ(S, LAMP_D);
      rowL.w = lampGroup.position.z + 10;
      rowR.w = lampGroup.position.z + 10 - LAMP_D / 2;
      signMat.uniforms.uTime.value = f.time;
      // lluvia: onda lenta del reloj de la clase (determinista); arranca ya lloviznando
      const want = 0.15 + 0.85 * weatherWave(f.t, 620, 1.1, 2.2);
      rainK = rainK < 0 ? want : rainK + (want - rainK) * (1 - Math.exp(-f.dt * 0.25));
      rain.update(f, S, rainK);
      scene.fog.density = fog0 * (1 + 0.35 * rainK);
      walkMat.roughness = 0.5 - 0.25 * rainK;
    },
    event(type, data) { runner.event(type, data); },
    get _debug() { return runner.debug(); },
    dispose() { atlas.dispose(); },
  };
  return inst;
}
