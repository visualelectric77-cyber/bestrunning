// RITMUP · escenario COSTA (realista). Paseo marítimo al amanecer: corres por un paseo de losas mojadas por el relente,
// con el mar a la izquierda (oleaje que refleja el cielo de foto, espuma en la orilla), una playa de arena húmeda bajo el
// muro, barandilla de metal pintado de blanco, balizas bajas cada 8 m y farolas cada 24 m que aún siguen encendidas y
// dejan su charco de luz cálido sobre las losas. Cielo real (panorama CC0 de Poly Haven) con nubes rosadas y la montaña
// al fondo de la bahía. Las luces llevan el color del tramo con el encendido en cadena del kit (runner.js).
// A VELOCIDAD REAL: las losas, la arena, el oleaje, los postes y las farolas pasan a km/h ÷ 3,6 m/s.
// Coste: ~14 llamadas de dibujo, PBR con 2 hileras de luces analíticas en las losas, sin pases de reflejo (el mar
// refleja el panorama, que es lo que de verdad se ve en él).
import { createRunner, scrollZ } from './kit/runner.js';
import { worldUrl, loadTex, loadJson, loadSet, pbr, skyDome, envFrom, glowMaterial, halos, addLamps, setInstances } from './kit/world.js';

export const meta = {
  id: 'costa',
  name: 'Costa',
  description: 'Paseo marítimo al amanecer: el mar a tu lado, losas mojadas y farolas aún encendidas.',
};

const T = 'costa';
const LAMP_D = 24;      // m entre farolas
const BOL_D = 8;        // m entre balizas
const POST_D = 2.4;     // m entre postes de la barandilla
const PAVE_TILE = 3.0;  // m por repetición de la textura de losas
const SEA_X = -7.5;       // borde del agua
const WALL_X = -2.8;    // muro del paseo (lado del mar)
const EDGE_X = 3.6;     // bordillo del lado de tierra
const AHEAD = 420;

const WATER_VERT = /* glsl */ `
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FRAG = /* glsl */ `
uniform sampler2D uSky, uNor;
uniform vec4 uCrop;
uniform vec3 uHorizon, uDeep, uSun, uSunDir;
uniform float uS, uTime, uGain;
varying vec3 vW;
#include <common>
#include <fog_pars_fragment>
vec3 skyAt(vec3 d) {
  float az = atan(d.x, -d.z);
  float el = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2((az - uCrop.x) / (uCrop.y - uCrop.x), (max(el, uCrop.z + 0.002) - uCrop.z) / (uCrop.w - uCrop.z));
  return texture2D(uSky, clamp(uv, vec2(0.002), vec2(0.998))).rgb * uGain;
}
void main() {
  // oleaje: dos escalas del mapa de normales, ancladas al mundo que avanza (z − S) y con su propia deriva
  vec2 p = vec2(vW.x, vW.z - uS);
  vec3 n1 = texture2D(uNor, p * 0.031 + vec2(uTime * 0.011, uTime * 0.007)).rgb * 2.0 - 1.0;
  vec3 n2 = texture2D(uNor, p * 0.093 - vec2(uTime * 0.017, -uTime * 0.013)).rgb * 2.0 - 1.0;
  vec3 n3 = texture2D(uNor, p * 0.0071 + vec2(-uTime * 0.004, uTime * 0.003)).rgb * 2.0 - 1.0;
  vec3 tn = normalize(n1 + n2 * 0.7 + n3 * 1.2);
  vec3 toCam = cameraPosition - vW;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  // las olas se aplanan con la distancia (sin centelleo en el horizonte)
  float flat_ = 0.35 + 0.65 * exp(-dist * 0.004);
  vec3 N = normalize(vec3(tn.x * flat_ * 0.6, 1.0, tn.y * flat_ * 0.6));
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  vec3 refl = skyAt(R);
  vec3 col = mix(uDeep * (0.6 + 0.4 * clamp(dot(N, vec3(0.0, 1.0, 0.0)), 0.0, 1.0)), refl, clamp(fres, 0.0, 1.0));
  // brillo del sol bajo a la espalda en las crestas
  col += uSun * pow(max(dot(R, uSunDir), 0.0), 120.0) * 0.6;
  // espuma en la orilla (borde del agua junto a la arena) y en algunas crestas
  float shore = vW.x - (${SEA_X.toFixed(1)});
  float fn = texture2D(uNor, p * 0.21 + uTime * 0.02).b;
  float foam = smoothstep(-2.2, -0.2, shore) * smoothstep(0.35, 0.75, fn + 0.25 * sin((vW.z - uS) * 0.08 + uTime * 0.6));
  col = mix(col, uHorizon * 1.25 + vec3(0.06), foam * 0.55);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

/** Une varias BufferGeometry no indexadas (posición, normal, uv). */
function merge(THREE, geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

export async function createTheme(ctx) {
  const { THREE, root, camera, scene, renderer } = ctx;
  camera.near = 0.08;
  camera.far = 2400;
  renderer.setClearColor(0x0b0d14, 1);
  ctx.post.set({ toneMapping: 'aces', exposure: 0.92, bloomStrength: 0.4, bloomThreshold: 0.9, bloomRadius: 0.3, vignette: 0.3, saturation: 1.03 });

  // ── recursos (en paralelo) ──
  const [skyMeta, skyTex, envTex, paving, beach, dune, waterNor] = await Promise.all([
    loadJson(T, 'sky.json'),
    loadTex(ctx, worldUrl(T, 'sky.jpg'), { srgb: true, aniso: 1 }),
    loadTex(ctx, worldUrl(T, 'env.jpg'), { srgb: true, aniso: 1 }),
    loadSet(ctx, T, 'paving', [6.6 / PAVE_TILE, 600 / PAVE_TILE]),
    loadSet(ctx, T, 'beach', [6 / 4, 600 / 4]),
    loadSet(ctx, T, 'dune', [40 / 5, 600 / 5]),
    loadTex(ctx, worldUrl(T, 'water_nor.jpg'), { repeat: [1, 1], aniso: 4 }),
  ]);

  const runner = createRunner(ctx, {
    exposure: 0.92,
    finale: (p, portrait) => { p.y = portrait ? 7.5 : 6; p.z = portrait ? 6 : 5; p.lookY = 0.3; p.lookZ = -48; p.fov = portrait ? 58 : 56; },
  });

  // ── cielo, entorno, luz y niebla ──
  const sky = skyDome(ctx, skyTex, skyMeta, { gain: 0.8, grad: 0.62, gradEl: 0.3 });
  root.add(sky.mesh);
  scene.environment = envFrom(ctx, envTex);
  scene.environmentIntensity = 0.8;
  const hor = new THREE.Color().setRGB(...skyMeta.horizon);
  scene.fog = new THREE.FogExp2(hor.clone().multiplyScalar(0.85), 0.0021);
  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.72, 0.5), 1.6);
  sun.position.set(-0.35, 0.18, 1).multiplyScalar(100);
  root.add(sun, sun.target);
  root.add(new THREE.HemisphereLight(new THREE.Color(0.55, 0.6, 0.78), new THREE.Color(0.18, 0.15, 0.14), 0.45));

  // ── mar ──
  const waterU = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uSky: { value: skyTex }, uNor: { value: waterNor }, uCrop: { value: sky.u.uCrop.value },
    uHorizon: { value: hor }, uDeep: { value: new THREE.Color().setRGB(0.012, 0.03, 0.045) },
    uSun: { value: new THREE.Color(1.0, 0.62, 0.38) }, uSunDir: { value: new THREE.Vector3(-0.35, 0.18, 1).normalize() },
    uS: { value: 0 }, uTime: { value: 0 }, uGain: { value: sky.u.uGain.value },
  };
  const waterGeo = new THREE.PlaneGeometry(2400, 2420);
  waterGeo.rotateX(-Math.PI / 2);
  waterGeo.translate(SEA_X - 1200 + 2, -0.95, -1190);
  const water = new THREE.Mesh(waterGeo, new THREE.ShaderMaterial({ uniforms: waterU, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, fog: true }));
  water.frustumCulled = false;
  root.add(water);

  // ── suelos: playa (bajo el muro), losas del paseo, arena del lado de tierra ──
  const groundStrip = (x0, x1, y, mat) => {
    const g = new THREE.PlaneGeometry(x1 - x0, 600);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, y, -290);
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    root.add(m);
    return m;
  };
  const beachMat = pbr(ctx, beach, { roughness: 0.75, color: new THREE.Color(0.85, 0.8, 0.75) });
  groundStrip(SEA_X - 0.5, WALL_X, -0.9, beachMat);
  const paveMat = pbr(ctx, paving, { roughness: 0.62, color: new THREE.Color(0.92, 0.9, 0.88) });
  // la textura de losas se extiende 600 m: además del avance, las tiras de 600 m se suceden sin costura (offset)
  groundStrip(WALL_X, EDGE_X + 3, 0, paveMat);
  const duneMat = pbr(ctx, dune, { roughness: 1, color: new THREE.Color(0.9, 0.82, 0.72) });
  // dunas bajas: banda ondulada (desplazada en JS; periodo 600 m, igual que la tira)
  const dg = new THREE.PlaneGeometry(70, 600, 28, 120);
  dg.rotateX(-Math.PI / 2);
  {
    const p = dg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + 35;           // 0..70 desde el bordillo
      const z = p.getZ(i);
      const ph = (z / 600) * Math.PI * 2;
      const h = Math.min(1, x / 10) * (0.6 + 1.6 * (0.5 + 0.5 * Math.sin(ph * 7 + x * 0.15)) * (0.5 + 0.5 * Math.sin(ph * 3 + 1.3)));
      p.setY(i, h * Math.min(1, x / 4));
    }
    dg.computeVertexNormals();
  }
  dg.translate(EDGE_X + 3 + 35, 0.02, -290);
  const dunes = new THREE.Mesh(dg, duneMat);
  dunes.frustumCulled = false;
  const duneGroup = new THREE.Group();
  duneGroup.add(dunes);
  const dunes2 = dunes.clone();
  dunes2.position.z = -600;
  duneGroup.add(dunes2);
  root.add(duneGroup);

  // muro del paseo (frente al mar) y bordillo de tierra
  const wallMat = pbr(ctx, paving, { roughness: 0.85, color: new THREE.Color(0.55, 0.53, 0.5) });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.95, 1200), wallMat);
  wall.position.set(WALL_X - 0.2, -0.47, -560);
  root.add(wall);
  const curb = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.14, 1200), wallMat);
  curb.position.set(EDGE_X, 0.07, -560);
  root.add(curb);

  // ── barandilla: postes cada 2,4 m (se desplazan) y dos pasamanos continuos ──
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.86, 0.87, 0.88), roughness: 0.32, metalness: 0.35, envMapIntensity: 1.1 });
  const nPost = Math.ceil((AHEAD + 20) / POST_D) + 2;
  const postGeo = new THREE.CylinderGeometry(0.035, 0.04, 1.05, 8);
  postGeo.translate(0, 0.525, 0);
  const posts = new THREE.InstancedMesh(postGeo, metal, nPost);
  setInstances(ctx, posts, nPost, (i, t) => { t.p.set(WALL_X + 0.15, 0, 10 - i * POST_D); });
  posts.frustumCulled = false;
  const postGroup = new THREE.Group();
  postGroup.add(posts);
  root.add(postGroup);
  for (const y of [1.05, 0.55]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1200, 8), metal);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(WALL_X + 0.15, y, -560);
    root.add(rail);
  }

  // ── balizas bajas junto a la barandilla (cada 8 m): la señal cercana del color del tramo ──
  const nBol = Math.ceil((AHEAD + 20) / BOL_D) + 2;
  const bolGeo = new THREE.CylinderGeometry(0.09, 0.1, 0.55, 12);
  bolGeo.translate(0, 0.275, 0);
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.06, 0.065, 0.07), roughness: 0.4, metalness: 0.6 });
  const bol = new THREE.InstancedMesh(bolGeo, dark, nBol);
  const bolLensGeo = new THREE.CylinderGeometry(0.092, 0.092, 0.07, 12, 1, true);
  bolLensGeo.translate(0, 0.45, 0);
  const bolLens = new THREE.InstancedMesh(bolLensGeo, glowMaterial(ctx, runner, { tint: '#ffd9a8', mix: 0.85, power: 5 }), nBol);
  const bolHalo = halos(ctx, runner, nBol, { tint: '#ffd9a8', mix: 0.85, size: 0.3, grow: 0.006, power: 0.55, fogD: 0.003 });
  for (const m of [bol, bolLens]) setInstances(ctx, m, nBol, (i, t) => { t.p.set(WALL_X + 0.55, 0, 4 - i * BOL_D); });
  setInstances(ctx, bolHalo, nBol, (i, t) => { t.p.set(WALL_X + 0.55, 0.45, 4 - i * BOL_D); });
  const bolGroup = new THREE.Group();
  for (const m of [bol, bolLens, bolHalo]) { m.frustumCulled = false; bolGroup.add(m); }
  root.add(bolGroup);

  // ── farolas cada 24 m en el lado de tierra ──
  const nLamp = Math.ceil((AHEAD + 30) / LAMP_D) + 2;
  const LX = EDGE_X - 0.35;
  const poleGeo = merge(THREE, [
    new THREE.CylinderGeometry(0.06, 0.1, 5.2, 10).translate(0, 2.6, 0),
    new THREE.CylinderGeometry(0.035, 0.035, 1.1, 6).rotateZ(Math.PI / 2).translate(-0.5, 5.12, 0),
    new THREE.BoxGeometry(0.62, 0.11, 0.26).translate(-1.0, 5.1, 0),
  ]);
  const poleMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.12, 0.13, 0.14), roughness: 0.45, metalness: 0.7 });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, nLamp);
  const bulbGeo = new THREE.BoxGeometry(0.5, 0.02, 0.2).translate(-1.0, 5.035, 0);
  const bulbs = new THREE.InstancedMesh(bulbGeo, glowMaterial(ctx, runner, { tint: '#ffe2b8', mix: 0.35, power: 7 }), nLamp);
  const lampHalo = halos(ctx, runner, nLamp, { tint: '#ffe2b8', mix: 0.35, size: 0.9, grow: 0.008, power: 0.5, fogD: 0.0025 });
  for (const m of [poles, bulbs]) setInstances(ctx, m, nLamp, (i, t) => { t.p.set(LX, 0, 12 - i * LAMP_D); });
  setInstances(ctx, lampHalo, nLamp, (i, t) => { t.p.set(LX - 1.0, 4.95, 12 - i * LAMP_D); });
  const lampGroup = new THREE.Group();
  for (const m of [poles, bulbs, lampHalo]) { m.frustumCulled = false; lampGroup.add(m); }
  root.add(lampGroup);

  // charcos de luz en las losas (farolas y balizas), con el color del tramo
  const rowLamp = new THREE.Vector4(LX - 1.0, 4.9, LAMP_D, 0);
  const rowBol = new THREE.Vector4(WALL_X + 0.55, 0.45, BOL_D, 0);
  addLamps(paveMat, ctx, runner, [rowLamp, rowBol], { tint: '#ffd9a8', mix: 0.55, power: 9, range: 16 });

  const inst = {
    director: { scale: 0.9, maxDown: 0.15, orbit: true },
    resize(s) { runner.resize(s); },
    update(f) {
      const st = runner.update(f);
      const S = st.S;
      // suelos: la textura avanza (offset en repeticiones del tile)
      paving.offset.y = (S / PAVE_TILE) % 1;
      beach.offset.y = (S / 4) % 1;
      duneGroup.position.z = scrollZ(S, 600);
      dune.offset.y = 0;
      postGroup.position.z = scrollZ(S, POST_D);
      bolGroup.position.z = scrollZ(S, BOL_D);
      lampGroup.position.z = scrollZ(S, LAMP_D);
      rowLamp.w = lampGroup.position.z + 12;
      rowBol.w = bolGroup.position.z + 4;
      waterU.uS.value = S % 4096;
      waterU.uTime.value = st.rm ? 0 : f.time;
    },
    event(type, data) { runner.event(type, data); },
    get _debug() { return runner.debug(); },
    dispose() {},
  };
  return inst;
}
