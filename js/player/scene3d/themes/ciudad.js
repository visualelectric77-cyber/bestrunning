// RITMUP · escenarios de CIUDAD REAL (en Ajustes desde la web 1.16.7). Corres por las calles de verdad del final de un maratón:
//   · Berlín: Leipziger Straße, Markgrafenstraße junto al Gendarmenmarkt, Unter den Linden, la Puerta de Brandeburgo y la
//     meta en la Straße des 17. Juni (3,4 km).
//   · Madrid: Pirámides, Paseo de las Acacias, Embajadores, Rondas de Valencia y Atocha, Paseo del Prado (Neptuno), Cibeles y la meta en el Paseo
//     de Recoletos (~3,7 km).
//   · Berlín, últimos 10 km (km 31,6 → meta): Kurfürstendamm, KaDeWe, Potsdamer Straße… en trozos de 2 km que se cargan y se sueltan.
// Los edificios (huella y altura), las calles, los parques, las fuentes, los árboles y las farolas salen de
// OpenStreetMap, horneados en assets/world/ciudad/<ruta>/ (route.json + trozos) por tools/ciudad/bake.mjs (sin claves ni API en
// marcha). Por el centro de la calzada, la línea del recorrido (en Berlín, la «línea azul» que se pinta de verdad) lleva
// el color del tramo con el encendido en cadena del kit; los pórticos de km y la meta dan el kilómetro REAL del maratón.
// A VELOCIDAD REAL: el recorrido avanza runner.S metros (km/h ÷ 3,6). Si la clase cabe en el tramo, empieza donde
// toca para que cruces la meta en el último segundo; si es más larga, das la vuelta al final y vuelves.
// La ciudad gira a tu alrededor en las esquinas (la cámara siempre mira a −z; el cielo de foto queda fijo, el sol es
// de la ciudad y cambia de lado al girar). Fachadas de obra (huecos con recercado, alféizar, cornisa, zócalo y
// escaparates) o muro cortina de vidrio en los altos; árboles con copa de hojas; vallas en los últimos km.
// Coste (Berlín): ~20 mallas; los edificios son una sola (≈ 4.200 huellas). ~270.000 triángulos en calidad alta.
// Datos © colaboradores de OpenStreetMap (ODbL): la escena lleva su atribución en una esquina.
// Cada ciudad es una entrada de CITIES (datos + aspecto); el registro carga `import('./ciudad.js').then((m) => m.madrid)`.
import { createRunner, kmhOfVis } from './kit/runner.js';
import { runnerParts, RUN_POSE, RUN_ALBEDO } from './carrera/runners.js';
import { worldUrl, loadTex, loadJson, loadSet, pbr, skyDome, envFrom, glowMaterial, setInstances } from './kit/world.js';

const AHEAD = 14;        // m por delante y por detrás para el rumbo (curvas suaves)
const BEHIND = 8;
const TURN = 14;         // m de la media vuelta al final del tramo

/**
 * Aspecto de cada ciudad. palette: fachadas sin color en OSM · sun: { az (° desde el norte, hacia el este), el (°) } a la
 * hora de la carrera · fenceFrom / fenceGap: marcas del recorrido donde empiezan las vallas y donde se abren ·
 * cloth: lona de las vallas · line: tinte de la línea del recorrido (se mezcla con el color del tramo) · treeTones:
 * hojas (de más oscuro a más claro).
 */
const CITIES = {
  berlin: {
    meta: { id: 'ciudad-berlin', name: 'Berlín · final del maratón', description: 'Los últimos 3,4 km del Maratón de Berlín por sus calles reales: Unter den Linden y la Puerta de Brandeburgo hasta la meta.' },
    data: 'berlin-final',
    palette: ['#d9cbb0', '#c9c6bf', '#e4dccb', '#cfb184', '#e8e6e0', '#a2a8ad', '#b8ab98', '#d4c3a3', '#8e9499', '#c7b9a6'],
    sun: { az: 140, el: 30 },            // finales de septiembre, media mañana
    fenceFrom: /Unter den Linden/, fenceGap: /Brandeburgo/,
    cloth: { bg: '#1f4fb8', text: '42,195' },
    line: '#2f7bff',
    treeTones: ['#3f5f24', '#4d7029', '#5c7f2e', '#6b8c35', '#7d9a3a', '#8f9f3e', '#a3a648'],   // tilo en septiembre
  },
  madrid: {
    meta: { id: 'ciudad-madrid', name: 'Madrid · final del maratón', description: 'Los últimos 3,7 km del Maratón de Madrid por sus calles reales: Atocha, el Paseo del Prado, Cibeles y la meta en Recoletos.' },
    data: 'madrid-final',
    // revocos claros, ocres, ladrillo visto, granito y algún rosa pálido
    palette: ['#eadfc6', '#e3cfa6', '#d9b77e', '#b56b4f', '#9e5a43', '#ece8df', '#e6c9b4', '#b9b3a8', '#d7c39b', '#f0e7d3'],
    sun: { az: 110, el: 38 },            // finales de abril, sobre las 10:30
    fenceFrom: /Paseo del Prado/, fenceGap: /^$/,
    cloth: { bg: '#c8202f', text: '42,195' },
    line: '#ff5a3c',
    treeTones: ['#365a1f', '#41692a', '#4f7a2f', '#5f8a36', '#73993d', '#86a546', '#9db35a'],   // plátanos de sombra en primavera
  },
};

// Berlín, los últimos 10 km (km 32 → meta) para clases de 50–60 min: mismo aspecto, datos en trozos de 2 km
CITIES.berlin10k = {
  ...CITIES.berlin,
  meta: { id: 'ciudad-berlin-10k', name: 'Berlín · últimos 10 km', description: 'Para clases largas: del km 32 a la meta del Maratón de Berlín por el Kurfürstendamm, el KaDeWe, Potsdamer Platz y la Puerta de Brandeburgo.' },
  data: 'berlin-10k',
};

function cityTheme(C) {
  return { meta: C.meta, createTheme: (ctx) => createCity(ctx, C) };
}
export const berlin = cityTheme(CITIES.berlin);
export const madrid = cityTheme(CITIES.madrid);
export const berlin10k = cityTheme(CITIES.berlin10k);
export const { meta, createTheme } = berlin;

async function createCity(ctx, C) {
  const PALETTE = C.palette;
  const { THREE, root, camera, scene, renderer, util } = ctx;
  const { clamp, smoothstep } = util;
  camera.near = 0.1;
  camera.far = 2500;
  renderer.setClearColor(0x9aa3ab, 1);
  ctx.post.set({ toneMapping: 'aces', exposure: 0.95, bloomStrength: 0.22, bloomThreshold: 0.92, bloomRadius: 0.3, vignette: 0.28, saturation: 1.02 });

  const [city, skyMeta, skyTex, envTex, road, walk, facade, grass] = await Promise.all([
    loadJson('ciudad', `${C.data}/route.json`),
    loadJson('costa', 'sky.json'),
    loadTex(ctx, worldUrl('costa', 'sky.jpg'), { srgb: true, aniso: 1 }),
    loadTex(ctx, worldUrl('costa', 'env.jpg'), { srgb: true, aniso: 1 }),
    loadSet(ctx, 'neon', 'road', [1, 1]),
    loadSet(ctx, 'neon', 'walk', [1, 1]),
    loadSet(ctx, 'neon', 'facade', [1, 1]),
    loadSet(ctx, 'bosque', 'floor', [1, 1], { arm: false }),
  ]);

  // todos los trozos se descargan al elegir el escenario (≈ 0,3–3 MB; luego quedan en br-world), pero se CONSTRUYEN solo
  // los cercanos a ti
  const chunkData = await Promise.all(city.chunks.map((c) => loadJson('ciudad', `${C.data}/${c.f}`)));

  const runner = createRunner(ctx, {
    exposure: 0.95,
    // PLANO FINAL DE HÉROE (la app oculta el HUD: pantalla completa). Si acabas EN la meta: CONTRAPLANO — corte al otro
    // lado del pórtico, a ras de calle, mirando hacia atrás: «META · FINISH» de frente, las vallas y el público a los dos
    // lados de la recta por la que has llegado y, al fondo, la ciudad en la bruma (en Berlín, la Puerta de Brandeburgo).
    // Después un travelling lento (10 s) se acerca e inclina la cámara, y se queda con un vaivén lentísimo. Si acabas a
    // media calle (clase más larga que el tramo), la grúa corta de siempre (no se mete en las esquinas).
    finale: (p, portrait) => {
      if (atMeta) {
        const k = heroK;
        const mx = (a, b) => a + (b - a) * k;
        p.y = mx(1.5, 1.8) + heroSway; p.z = mx(portrait ? 31 : 22, portrait ? 21 : 13);
        // (lookZ fijo a −60: la inclinación sale de lookY. Vertical: +9° → +13°, el horizonte baja al 70 % de la pantalla
        // y el letrero queda en el centro, con cielo arriba y poca calzada; horizontal: +4° → +8°)
        p.lookY = p.y + (p.z + 60) * (portrait ? mx(0.16, 0.235) : mx(0.07, 0.14)); p.lookZ = -60; p.fov = portrait ? 54 : 46;
      } else { p.y = portrait ? 14 : 10; p.z = 10; p.lookY = 4; p.lookZ = -60; p.fov = portrait ? 58 : 56; }
    },
  });
  let reverse = false;
  let heroK = 0; let heroSway = 0; let heroT0 = -1;   // avance de la grúa del final (0..1), vaivén y su arranque
  let atMeta = false;   // la clase acaba en la meta (lo fija locate)

  // ── cielo de mañana despejada, entorno, sol bajo y bruma que esconde el borde de los datos (~420 m) ──
  const sky = skyDome(ctx, skyTex, skyMeta, { gain: 0.95, grad: 0.25, gradEl: 0.5, tint: new THREE.Color(0.92, 0.97, 1.06) });
  root.add(sky.mesh);
  scene.environment = envFrom(ctx, envTex);
  scene.environmentIntensity = 0.85;
  const hazeCol = new THREE.Color().setRGB(...skyMeta.horizon).lerp(new THREE.Color(0.42, 0.46, 0.52), 0.6);
  scene.fog = new THREE.FogExp2(hazeCol, 0.0034);
  sky.u.uHorizon.value.copy(hazeCol);
  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.9, 0.78), 2.0);
  // el sol es de la CIUDAD (cuelga de cityG), a la hora de la carrera. Al girar en las esquinas cambia de lado: en
  // Berlín, en Leipziger Straße (hacia el este) lo tienes de cara y en Unter den Linden (hacia el oeste) a la espalda
  { const az = (C.sun.az * Math.PI) / 180; const el = (C.sun.el * Math.PI) / 180;
    sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(100); }
  root.add(new THREE.HemisphereLight(new THREE.Color(0.62, 0.7, 0.82), new THREE.Color(0.2, 0.18, 0.15), 1.1));

  // ── el recorrido: polilínea cada 2 m (x este, z sur) ──
  const R = city.route;
  const rp = Float32Array.from(R.p);
  const nR = rp.length / 2;
  const L = R.length;
  const STEP = R.step;
  function posAt(s, out) {
    const k = clamp(s, 0, L) / STEP;
    const i = Math.min(nR - 2, Math.floor(k));
    const f = Math.min(1, k - i);
    out[0] = rp[2 * i] + (rp[2 * i + 2] - rp[2 * i]) * f;
    out[1] = rp[2 * i + 1] + (rp[2 * i + 3] - rp[2 * i + 1]) * f;
    return out;
  }
  const qa = [0, 0]; const qb = [0, 0];
  /** Rumbo (rad) en s: 0 = hacia −z (norte), positivo hacia +x (este). */
  function headingAt(s) {
    posAt(s + AHEAD, qa); posAt(s - BEHIND, qb);
    if (s + AHEAD > L) { posAt(L, qa); posAt(L - AHEAD - BEHIND, qb); }
    if (s - BEHIND < 0) { posAt(AHEAD + BEHIND, qa); posAt(0, qb); }
    return Math.atan2(qa[0] - qb[0], -(qa[1] - qb[1]));
  }
  // dónde empieza la clase en el recorrido: si cabe, de modo que la meta llegue con el último segundo
  let offset = 0;
  const planOffset = () => { offset = Math.max(0, L - runner.sigAt(ctx.timeline.totalSec)); };
  planOffset();
  const where = { s: 0, phi: 0, back: false };
  function locate(S) {
    // dónde ACABA la clase sobre el recorrido: si es en la meta (lo normal: la clase cabe en el tramo), no hay media
    // vuelta — antes la cámara giraba 90° en los últimos 14 m y cruzabas la meta mirando a un lateral (un poste, una
    // fachada o las copas de los árboles en el plano final)
    const endQ = offset + runner.sigAt(ctx.timeline.totalSec);
    let q = S + offset;
    atMeta = endQ <= L + 1 && endQ > L - 1;
    if (endQ <= L + 1) q = Math.min(q, L - 0.01);
    const leg = Math.floor(q / L);
    const r = q - leg * L;
    const back = leg % 2 === 1;
    const s = back ? L - r : r;
    let phi = headingAt(s) + (back ? Math.PI : 0);
    // media vuelta suave al final de cada ida o vuelta (solo si después sigues corriendo)
    if (L - r < TURN && endQ > (leg + 1) * L + 1) phi += (Math.PI / 2) * smoothstep(0, 1, 1 - (L - r) / TURN);
    if (leg > 0 && r < TURN) phi -= (Math.PI / 2) * smoothstep(0, 1, 1 - r / TURN);
    where.s = s; where.phi = phi; where.back = back;
    return where;
  }

  // ── la ciudad entera cuelga de un grupo que se mueve y gira para que tu punto del recorrido quede en el origen ──
  const cityG = new THREE.Group();
  root.add(cityG);
  cityG.add(sun, sun.target);
  const tri = (pts) => {
    const v = []; for (let i = 0; i < pts.length; i += 2) v.push(new THREE.Vector2(pts[i], pts[i + 1]));
    return v;
  };

  // ── materiales compartidos por todos los trozos ──
  for (const t of [walk.map, walk.normalMap, walk.arm]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  const walkMat = pbr(ctx, walk, { roughness: 0.85, color: new THREE.Color(0.62, 0.61, 0.6), env: 0.8 });
  for (const t of [grass.map, grass.normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  const greenMat = new THREE.MeshStandardMaterial({ map: grass.map, normalMap: grass.normalMap, color: new THREE.Color(0.42, 0.62, 0.3), roughness: 1, envMapIntensity: 0.5 });
  for (const t of [road.map, road.normalMap, road.arm]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  const roadMat = pbr(ctx, road, { roughness: 0.9, color: new THREE.Color(0.5, 0.5, 0.52), env: 0.7, normalScale: 0.8 });
  roadMat.polygonOffset = true; roadMat.polygonOffsetFactor = -1; roadMat.polygonOffsetUnits = -2;
  for (const t of [facade.map, facade.normalMap, facade.arm]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  const bMat = pbr(ctx, facade, { roughness: 1, env: 0.9, normalScale: 0.6 });
  bMat.vertexColors = true;
  bMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aInfo;\nvarying vec4 vInfo;\nvarying vec2 vFac;\nvarying float vRoof;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vInfo = aInfo; vFac = uv; vRoof = step(0.5, normal.y);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vInfo;
varying vec2 vFac;
varying float vRoof;
float bh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gWin; float gGlass;`)
      .replace('#include <map_fragment>', `
  float wall = 1.0 - vRoof;
  float sd = vInfo.x;
  float glass = wall * step(1.5, vInfo.y);
  float mason = wall * (1.0 - step(0.5, vInfo.y));
  float wallLen = max(vInfo.z, 0.5);   // tejados: 0 (sin el mínimo, NaN → la niebla y el bloom lo vuelven todo negro)
  float top = vInfo.w;
  vec4 tex = texture2D(map, vFac / 6.0);
  diffuseColor.rgb *= mix(vec3(1.0), tex.rgb * 1.6, (0.55 - 0.3 * (1.0 - mason - glass)) * wall * (1.0 - glass));   // monumento: arenisca más lisa
  diffuseColor.rgb *= mix(1.0, 0.8 + 0.4 * tex.g, vRoof);
  // ── obra: planta baja alta, pisos de ~3,3 m, huecos con recercado claro, alféizar, cornisa y zócalo ──
  float GF = 4.4;
  float fh = 3.1 + 0.6 * sd;
  float pitch = 1.9 + 1.4 * fract(sd * 7.3);
  float nW = max(1.0, floor(wallLen / pitch));
  float cx = vFac.x / (wallLen / nW);
  vec2 cell = vec2(cx, (vFac.y - GF) / fh);
  vec2 f = fract(cell);
  vec2 wid = floor(cell);
  float ww = 0.32 + 0.22 * fract(sd * 3.1);
  float upper = step(GF, vFac.y) * step(vFac.y, top - 1.1);
  float inX = step(0.5 - ww * 0.5, f.x) * step(f.x, 0.5 + ww * 0.5);
  float inY = step(0.22, f.y) * step(f.y, 0.8);
  float frX = step(0.5 - ww * 0.5 - 0.05, f.x) * step(f.x, 0.5 + ww * 0.5 + 0.05);
  float frY = step(0.17, f.y) * step(f.y, 0.85);
  float win = upper * inX * inY;
  float frame = upper * frX * frY * (1.0 - inX * inY);
  float sill = upper * frX * step(0.15, f.y) * step(f.y, 0.2);
  float shopOn = step(0.4, bh(vec2(floor(cx), sd * 91.0)));
  float shop = step(0.6, vFac.y) * step(vFac.y, 3.6) * step(0.1, fract(cx)) * step(fract(cx), 0.9) * shopOn;
  float ledge = step(GF - 0.35, vFac.y) * step(vFac.y, GF);
  float cornice = step(top - 0.75, vFac.y);
  float underC = step(top - 1.05, vFac.y) * (1.0 - cornice);
  float plinth = step(vFac.y, 0.55);
  float hasWin = mason * step(1.5, wallLen);
  vec3 trim = diffuseColor.rgb * 1.25 + 0.03;
  diffuseColor.rgb = mix(diffuseColor.rgb, trim, hasWin * max(frame, max(sill, ledge)) * 0.85);
  diffuseColor.rgb = mix(diffuseColor.rgb, trim * 1.05, mason * cornice);
  diffuseColor.rgb *= 1.0 - 0.45 * mason * underC - 0.3 * mason * plinth;
  // cristal de las ventanas: oscuro, con cortinas o luz interior en algunas
  float curtain = step(0.68, bh(wid + sd * 17.0));
  vec3 inside = mix(vec3(0.03, 0.035, 0.04), vec3(0.2, 0.19, 0.17), curtain * smoothstep(0.35, 0.75, f.y));
  float gW = hasWin * max(win, (1.0 - upper) * shop * step(vFac.y, GF));
  // ── muro cortina: montantes cada 1,5 m, antepechos opacos en cada forjado ──
  float gx = fract(vFac.x / 1.5);
  float gy = fract(vFac.y / 3.6);
  float pane = step(0.035, gx) * step(gx, 0.965) * step(0.04, gy) * step(gy, 0.76);
  gGlass = glass * pane;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55, glass * (1.0 - pane));
  gWin = min(1.0, gW + gGlass);
  diffuseColor.rgb = mix(diffuseColor.rgb, inside, gW);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.065, 0.08) * (0.8 + 0.4 * bh(floor(vec2(vFac.x / 1.5, vFac.y / 3.6)) + sd)), gGlass);
  // oclusión falsa del cañón de la calle (sin sombras ni pasadas): la base de cada edificio se oscurece hacia la acera
  // —el suelo le tapa el cielo— y la fachada se aclara hacia la cornisa. Es lo que quita el aire de maqueta: los
  // edificios «pesan» sobre el suelo. Solo muros (vFac.y = altura en m); las piezas elevadas no se tocan.
  float aoBase = mix(0.55, 1.0, smoothstep(0.0, 5.0, vFac.y));
  float aoSky = 0.84 + 0.16 * smoothstep(3.0, 24.0, vFac.y);
  diffuseColor.rgb *= mix(1.0, aoBase * aoSky, wall);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  // ≥ 0,1: con menos, el brillo del sol en el cristal pasa de 65.504 (máximo del búfer de media precisión del post) →
  // infinito → el bloom lo extiende y la imagen entera se queda NEGRA mientras ese reflejo está a la vista
  roughnessFactor = max(mix(roughnessFactor, mix(0.13, 0.1, gGlass), gWin), 0.1 * gWin);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  normal = mix(normal, normalize(vNormal), gWin);`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n  reflectedLight.indirectSpecular *= 1.0 + 1.5 * gWin;');
  };
  bMat.customProgramCacheKey = () => 'ciudad-bld';

  // árboles: tronco, un núcleo de copa oscuro y encima tarjetas de hojas (textura dibujada aquí, recorte alfa) con
  // normales esféricas: la copa se ilumina como un volumen
  const texts = [];   // texturas de lienzo propias (se liberan en dispose)
  const trunkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.2, 0.17, 0.14), roughness: 0.95 });
  const crownGeo = new THREE.SphereGeometry(1, 8, 6);   // núcleo bajo las hojas (indexada: normales suaves tras abollarla)
  { // copa abollada (lóbulos de follaje), determinista
    const p = crownGeo.attributes.position; const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const k = 1 + 0.12 * Math.sin(v.x * 5.1 + v.y * 3.7) * Math.cos(v.z * 4.3 - v.y * 2.1) + 0.06 * Math.sin(v.x * 11 + v.z * 9);
      v.multiplyScalar(k); p.setXYZ(i, v.x, v.y, v.z);
    }
    crownGeo.computeVertexNormals();
  }
  const crownMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.045, 0.075, 0.03), roughness: 1, envMapIntensity: 0.15 });   // el interior en sombra
  crownMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLP = position * 3.0 + instanceMatrix[3].xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vLP;
float th(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float tn(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(th(i), th(i + vec3(1,0,0)), f.x), mix(th(i + vec3(0,1,0)), th(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(th(i + vec3(0,0,1)), th(i + vec3(1,0,1)), f.x), mix(th(i + vec3(0,1,1)), th(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  float leaf = tn(vLP * 2.2) * 0.6 + tn(vLP * 6.0) * 0.4;
  diffuseColor.rgb *= 0.55 + 0.9 * leaf;`);
  };
  const leafTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const r = ctx.rng(42);
    const greens = C.treeTones;
    for (let k = 0; k < 520; k++) {
      const a = r() * Math.PI * 2; const d = Math.sqrt(r()) * 118;
      const x = 128 + Math.cos(a) * d; const y = 128 + Math.sin(a) * d * 0.92;
      const sz = 5 + r() * 6;
      g.save(); g.translate(x, y); g.rotate(r() * Math.PI * 2);
      g.fillStyle = greens[Math.floor(Math.pow(r(), 1.4) * greens.length)];
      g.globalAlpha = 1;
      g.beginPath(); g.ellipse(0, 0, sz, sz * 0.72, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.ellipse(sz * 0.2, sz * 0.15, sz * 0.7, sz * 0.4, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  })();
  texts.push(leafTex);
  const cardGeo = (() => {
    const r = ctx.rng(7);
    const pos = []; const nor = []; const uv = []; const idx = [];
    const q = new THREE.Quaternion(); const e = new THREE.Euler(); const v = new THREE.Vector3(); const c = new THREE.Vector3();
    for (let k = 0; k < 22; k++) {
      // centro en una esfera de radio ~0,55 (copa unidad), tarjeta de 1,15 orientada al azar
      c.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize().multiplyScalar(0.2 + r() * 0.42);
      q.setFromEuler(e.set(r() * Math.PI, r() * Math.PI, r() * Math.PI));
      const base = pos.length / 3;
      for (const [x, y, u, w] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
        v.set(x * 0.5, y * 0.5, 0).applyQuaternion(q).add(c);
        pos.push(v.x, v.y, v.z);
        const n = v.clone().normalize();
        nor.push(n.x, n.y, n.z);
        uv.push(u, w);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    gg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    gg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    gg.setIndex(idx);
    return gg;
  })();
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, envMapIntensity: 0.5 });
  // volumen sin geometría nueva: la mitad baja de la copa queda en sombra propia y la alta coge el sol (degradado por
  // la altura LOCAL de cada tarjeta): la copa deja de ser un recorte plano de un solo tono
  leafMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vLeafY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLeafY = position.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vLeafY;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb *= mix(0.42, 1.14, smoothstep(-0.62, 0.7, vLeafY));');
  };
  leafMat.customProgramCacheKey = () => 'ciudad-leaf';
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1, 6).translate(0, 0.5, 0);
  // farolas reales: mástil oscuro y una luz baja del color del tramo (es de día: discreta)
  const poleMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.06, 0.07, 0.07), roughness: 0.5, metalness: 0.6 });
  const poleGeo = new THREE.CylinderGeometry(0.06, 0.1, 5.5, 8).translate(0, 2.75, 0);
  const headGeo = new THREE.CylinderGeometry(0.28, 0.18, 0.4, 10).translate(0, 5.6, 0);
  const headMat = glowMaterial(ctx, runner, { tint: '#fff2dc', mix: 0.35, power: 1.4, fogK: 0.5 });
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const col = new THREE.Color();
  const treeShare = () => (ctx.qualityLevel >= 2 ? 1 : ctx.qualityLevel === 1 ? 0.5 : 0.33);   // calidad media/baja: menos árboles

  /**
   * Construye un TROZO de ciudad (D: buildings, roads, areas, trees, lamps de cX.json). Es un generador: cede el paso
   * cada 120 edificios para repartir el trabajo entre fotogramas (sin tirones mientras corres).
   */
  function* buildChunk(D) {
    const g = new THREE.Group();
    const geos = [];
    const mesh = (geo, mat, ro = 0) => { geos.push(geo); const m = new THREE.Mesh(geo, mat); m.renderOrder = ro; g.add(m); return m; };

    // suelo: adoquín/acera gris bajo el tramo de recorrido del trozo y 650 m alrededor (UV en coordenadas de mundo)
    {
      let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
      for (let k = Math.floor(D.s0 / STEP); k <= Math.min(nR - 1, Math.ceil(D.s1 / STEP)); k++) {
        x0 = Math.min(x0, rp[2 * k]); x1 = Math.max(x1, rp[2 * k]); z0 = Math.min(z0, rp[2 * k + 1]); z1 = Math.max(z1, rp[2 * k + 1]);
      }
      const M = 650;
      const geo = new THREE.PlaneGeometry(x1 - x0 + 2 * M, z1 - z0 + 2 * M).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, -0.02, (z0 + z1) / 2);
      const uv = geo.attributes.uv; const p = geo.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 3, -p.getZ(i) / 3);
      mesh(geo, walkMat);
    }

    // parques y césped (polígonos triangulados)
    {
      const gPos = []; const gIdx = [];
      for (const a of D.areas) {
        const ring = tri(a.p);
        if (ring.length < 3) continue;
        const faces = THREE.ShapeUtils.triangulateShape(ring, []);
        const base = gPos.length / 3;
        for (const v of ring) gPos.push(v.x, a.k === 'grass' ? 0.012 : 0.008, v.y);
        for (const f of faces) gIdx.push(base + f[0], base + f[2], base + f[1]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(gPos.flatMap((_, i) => (i % 3 === 1 ? [] : [gPos[i] / 4])), 2));
      geo.setIndex(gIdx);
      geo.computeVertexNormals();
      mesh(geo, greenMat);
    }
    yield;

    // calles: cintas de asfalto con su ancho (coordenadas de mundo en las UV: los cruces no dejan costuras)
    {
      const rPos = []; const rIdx = [];
      for (const r of D.roads) {
        if (r.k !== 'road') continue;
        const p = r.p; const hw = r.w / 2;
        for (let i = 0; i + 3 < p.length; i += 2) {
          const ax = p[i]; const az = p[i + 1]; const bx = p[i + 2]; const bz = p[i + 3];
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 0.01) continue;
          const dx = (bx - ax) / len; const dz = (bz - az) / len;
          const nx = -dz * hw; const nz = dx * hw;
          const ex = dx * hw * 0.9; const ez = dz * hw * 0.9;   // se alarga en las juntas para tapar el hueco del ángulo
          const base = rPos.length / 3;
          rPos.push(ax - ex + nx, 0.03, az - ez + nz, ax - ex - nx, 0.03, az - ez - nz, bx + ex - nx, 0.03, bz + ez - nz, bx + ex + nx, 0.03, bz + ez + nz);
          rIdx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(rPos.flatMap((_, i) => (i % 3 === 1 ? [] : [rPos[i] / 5])), 2));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(rPos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      geo.setIndex(rIdx);
      mesh(geo, roadMat, 1);
    }
    yield;

    // edificios: una sola malla por trozo (muros + tejados planos), color de OSM o de la paleta de la ciudad
    const bPos = []; const bNor = []; const bUv = []; const bCol = []; const bInfo = []; const bIdx = [];
    for (let bi = 0; bi < D.buildings.length; bi++) {
      if (bi % 120 === 119) yield;
      const b = D.buildings[bi];
      const seed = hash((b.p[0] * 7.31 + b.p[1] * 3.17) % 9973 + bi * 0.001);
      col.set(b.c || (b.lm ? '#efe3c6' : PALETTE[Math.floor(seed * PALETTE.length)])).convertSRGBToLinear();   // monumentos: su color (horneado)
      const roofC = new THREE.Color(b.rc || '#4a4846').convertSRGBToLinear();
      const y0 = b.mh || 0; const y1 = b.h;
      // estilo de fachada: 0 = obra (Altbau/revoco: huecos, cornisa, zócalo, escaparates), 1 = sin ventanas (monumento,
      // piezas pequeñas), 2 = muro cortina de vidrio (los altos y modernos: Potsdamer Platz, Leipziger Platz)
      const style = b.lm || y1 - y0 < 3.5 ? 1 : (y1 >= 32 && seed < 0.75) || (y1 >= 24 && seed < 0.22) ? 2 : 0;
      if (style === 2 && !b.c) col.set(seed < 0.4 ? '#8d99a3' : seed < 0.55 ? '#a7a196' : '#6f7b84').convertSRGBToLinear();
      const rings = [b.p, ...(b.in || [])];
      rings.forEach((p, ri) => {
        const n = p.length / 2;
        // sentido del anillo: los muros miran hacia fuera (los patios interiores, hacia dentro del hueco)
        let area = 0;
        for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; }
        const flip = (area > 0) !== (ri > 0);
        let u = 0;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          let ax = p[2 * i]; let az = p[2 * i + 1]; let bx = p[2 * j]; let bz = p[2 * j + 1];
          if (flip) { [ax, bx] = [bx, ax]; [az, bz] = [bz, az]; }
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 0.05) continue;
          const nx = -(bz - az) / len; const nz = (bx - ax) / len;
          const base = bPos.length / 3;
          bPos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
          for (let k = 0; k < 4; k++) { bNor.push(nx, 0, nz); bCol.push(col.r, col.g, col.b); bInfo.push(seed, style, len, y1); }
          bUv.push(u, y0, u + len, y0, u + len, y1, u, y1);
          bIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          u += len;
        }
      });
      // tejado
      const outer = tri(b.p);
      const holes = (b.in || []).map(tri);
      let faces;
      try { faces = THREE.ShapeUtils.triangulateShape(outer, holes); } catch { faces = []; }
      const all = outer.concat(...holes);
      const base = bPos.length / 3;
      for (const v of all) { bPos.push(v.x, y1, v.y); bNor.push(0, 1, 0); bCol.push(roofC.r, roofC.g, roofC.b); bInfo.push(seed, 1, 0, y1); bUv.push(v.x, v.y); }
      for (const f of faces) bIdx.push(base + f[0], base + f[2], base + f[1]);
    }
    {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(bNor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(bUv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(bCol, 3));
      geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(bInfo, 4));
      geo.setIndex(bIdx);
      mesh(geo, bMat);
    }
    yield;

    // árboles (reales y sembrados) y farolas del trozo
    const tr = D.trees; const nTree = tr.length / 4;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, nTree);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, nTree);
    const leaves = new THREE.InstancedMesh(cardGeo, leafMat, nTree);
    setInstances(ctx, trunks, nTree, (i, t) => { const h = tr[4 * i + 2]; t.p.set(tr[4 * i], 0, tr[4 * i + 1]); t.s.set(1 + h / 30, h * 0.55, 1 + h / 30); });
    setInstances(ctx, crowns, nTree, (i, t) => {
      const h = tr[4 * i + 2]; const cr = tr[4 * i + 3] / 2;
      t.p.set(tr[4 * i], h * 0.62, tr[4 * i + 1]); t.s.set(cr * 0.72, h * 0.27, cr * 0.72); t.e.set(0, i * 2.3, 0);
    });
    setInstances(ctx, leaves, nTree, (i, t) => {
      const h = tr[4 * i + 2]; const cr = tr[4 * i + 3] / 2;
      t.p.set(tr[4 * i], h * 0.62, tr[4 * i + 1]); t.s.set(cr * 1.1, h * 0.4, cr * 1.1); t.e.set(0, i * 2.3, 0);
    });
    const lp = D.lamps; const nLamp = lp.length / 2;
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, nLamp);
    const heads = new THREE.InstancedMesh(headGeo, headMat, nLamp);
    for (const m of [poles, heads]) setInstances(ctx, m, nLamp, (i, t) => { t.p.set(lp[2 * i], 0, lp[2 * i + 1]); });
    const inst = [trunks, crowns, leaves, poles, heads];
    for (const m of inst) { m.frustumCulled = false; g.add(m); }
    const treeMeshes = [trunks, crowns, leaves];
    const setQuality = () => { for (const m of treeMeshes) m.count = Math.floor(nTree * treeShare()); };
    setQuality();
    return { g, geos, inst, setQuality, tris: bIdx.length / 3 };
  }

  // ── trozos: se construyen poco a poco cuando quedan a menos de 1,3 km por delante (o 0,5 km por detrás: la vuelta),
  //    se terminan de golpe si ya los tienes encima (capturas, saltos de reloj) y se sueltan a 0,7 km por detrás ──
  const chunks = city.chunks.map((c, k) => ({ ...c, data: chunkData[k], gen: null, built: null }));
  const near = (c, s, back, ahead) => c.s1 > s - back && c.s0 < s + ahead;
  function finishChunk(c, res) { c.built = res; c.gen = null; cityG.add(res.g); }
  function dropChunk(c) {
    if (c.built) { cityG.remove(c.built.g); for (const geo of c.built.geos) geo.dispose(); for (const m of c.built.inst) m.dispose(); }
    c.built = null; c.gen = null;
  }
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function pumpChunks(s, budgetMs = 4) {
    for (const c of chunks) if (!near(c, s, 700, 1700) && (c.built || c.gen)) dropChunk(c);
    for (const c of chunks) {
      if (c.built || !near(c, s, 500, 650)) continue;
      if (!c.gen) c.gen = buildChunk(c.data);
      let r; while (!(r = c.gen.next()).done);
      finishChunk(c, r.value);
    }
    const t0 = nowMs();
    for (const c of chunks) {
      if (c.built || !near(c, s, 500, 1300)) continue;
      if (!c.gen) c.gen = buildChunk(c.data);
      while (nowMs() - t0 < budgetMs) { const r = c.gen.next(); if (r.done) { finishChunk(c, r.value); break; } }
    }
  }

  // ── la línea del maratón por el centro de la calzada, con el color del tramo y su encendido en cadena ──
  const lPos = []; const lIdx = [];
  const LW = 0.06;
  for (let i = 0; i < nR - 1; i++) {
    const ax = rp[2 * i]; const az = rp[2 * i + 1]; const bx = rp[2 * i + 2]; const bz = rp[2 * i + 3];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = (-(bz - az) / len) * LW; const nz = ((bx - ax) / len) * LW;
    const base = lPos.length / 3;
    lPos.push(ax + nx, 0.045, az + nz, ax - nx, 0.045, az - nz, bx - nx, 0.045, bz - nz, bx + nx, 0.045, bz + nz);
    lIdx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lPos, 3));
  lineGeo.setIndex(lIdx);
  // mix 0,9: la línea lleva el color del TRAMO (el mismo de la etiqueta del HUD). Con 0,6 el tinte de la ciudad lo
  // ensuciaba: «rápido» (naranja) salía rosa en Berlín y «trotar» (verde) salía amarillo en Madrid
  const lineMat = glowMaterial(ctx, runner, { tint: C.line, mix: 0.9, power: 1.15, fogK: 0.6 });
  lineMat.polygonOffset = true; lineMat.polygonOffsetFactor = -2; lineMat.polygonOffsetUnits = -4;
  const line = new THREE.Mesh(lineGeo, lineMat);
  line.renderOrder = 2;
  line.frustumCulled = false;
  cityG.add(line);

  // ── pórticos: cada kilómetro real del maratón y la META (perpendiculares al recorrido) ──
  const gantryMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.85, 0.86, 0.88), roughness: 0.4, metalness: 0.5 });
  // el travesaño, en antracita: cuando el letrero se funde al pasar por detrás de tu número, lo que queda detrás de la
  // cifra blanca es oscuro (antes, una viga gris clara: el número perdía contraste justo al cruzar cada km y la meta)
  const beamMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.035, 0.045, 0.07), roughness: 0.55, metalness: 0.3 });
  let finishSign = null;   // letrero de la META (en el contraplano del final se pasa a la otra cara del travesaño)
  const gantries = [];   // { g, y, mats, a }: el letrero se funde cuando pasa por detrás del número de velocidad del HUD
  const pa = [0, 0];
  function gantry(s, label, finish) {
    const g = new THREE.Group();
    posAt(s, pa);
    g.position.set(pa[0], 0, pa[1]);
    g.rotation.y = -headingAt(s);
    const half = finish ? 7.5 : 6;
    const H = finish ? 6.2 : 5.2;
    const postGeo = new THREE.BoxGeometry(0.35, H, 0.35).translate(0, H / 2, 0);
    for (const x of [-half, half]) { const m = new THREE.Mesh(postGeo, gantryMat); m.position.x = x; g.add(m); }
    const beamH = finish ? 1.6 : 1.0;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.35, beamH, 0.3), beamMat);
    beam.position.y = H - beamH / 2;
    g.add(beam);
    const tex = ctx.textTexture(label, { size: 96, weight: 700, tracking: 0.2, color: '#ffffff', pad: 0.25 });
    texts.push(tex);
    const panelMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: true, color: new THREE.Color(finish ? 1 : 0.95, finish ? 1 : 0.95, 1) });
    const hT = beamH * 0.62;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(hT * tex.userData.aspect, hT), panelMat);
    panel.position.set(0, H - beamH / 2, 0.16);
    const backMat = new THREE.MeshStandardMaterial({ color: finish ? 0x123a8a : 0x1d2f55, roughness: 0.6, transparent: true });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, beamH * 0.92), backMat);
    back.position.set(0, H - beamH / 2, 0.155);
    g.add(back, panel);
    if (finish) finishSign = { panel, back };
    if (finish) {   // la línea de meta en el suelo: franja blanca de lado a lado
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 0.5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }));
      fl.position.y = 0.05;
      g.add(fl);
    }
    cityG.add(g);
    gantries.push({ g, y: H - beamH / 2, half, mats: [panelMat, backMat], a: 1 });
  }
  for (const m of R.marks) if (m.km) gantry(m.s, `KM ${m.km}`, false);
  gantry(L - 0.5, 'META · FINISH', true);

  // ── vallas del maratón en los últimos km (Berlín: desde Unter den Linden; Madrid: desde el Paseo del Prado): a ±5,5 m
  //    de tu línea, cada 2,5 m, con la lona de la carrera y su franja blanca; se abren donde haga falta (en Berlín, los
  //    pasos entre las columnas de la Puerta) ──
  const FENCE_X = 5.5; const FENCE_D = 2.5;
  const gateS = (R.marks.find((m) => C.fenceGap.test(m.label || '')) || { s: -1e9 }).s;
  const fenceStart = Math.max(0, (R.marks.find((m) => C.fenceFrom.test(m.label || '')) || { s: L - 2200 }).s - 40);
  const fences = [];
  for (let s = fenceStart; s < L - 9; s += FENCE_D) {
    if (Math.abs(s - gateS) < 26) continue;
    // en las curvas cerradas (glorietas: Neptuno, Cibeles) la valla a 5,5 m cruzaría la calzada: ahí no se pone
    const turn = Math.abs(Math.atan2(Math.sin(headingAt(s + 10) - headingAt(s - 10)), Math.cos(headingAt(s + 10) - headingAt(s - 10))));
    if (turn > 0.3) continue;
    for (const side of [-1, 1]) fences.push({ s: s + FENCE_D / 2, side });
  }
  const nF = fences.length;
  const clothTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = C.cloth.bg; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#ffffff'; g.fillRect(0, 40, 256, 7);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = '600 22px -apple-system, "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(C.cloth.text, 128, 20);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  })();
  texts.push(clothTex);
  const cloth = new THREE.InstancedMesh(new THREE.BoxGeometry(FENCE_D - 0.08, 0.78, 0.02).translate(0, 0.62, 0),
    new THREE.MeshStandardMaterial({ map: clothTex, roughness: 0.85 }), nF);
  const rail = new THREE.InstancedMesh(new THREE.BoxGeometry(FENCE_D, 0.04, 0.04).translate(0, 1.04, 0), gantryMat, nF);
  const feet = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 1.06, 0.5).translate(-FENCE_D / 2 + 0.03, 0.53, 0), gantryMat, nF);
  const fp = [0, 0];
  const fencePos = (i, t) => {
    const fe = fences[i];
    const phi = headingAt(fe.s);
    posAt(fe.s, fp);
    // a la derecha del rumbo (x+ local) o a la izquierda
    t.p.set(fp[0] + Math.cos(phi) * FENCE_X * fe.side, 0, fp[1] + Math.sin(phi) * FENCE_X * fe.side);
    t.e.set(0, Math.PI / 2 - phi, 0);   // el lado largo de la valla, a lo largo del recorrido
  };
  for (const m of [cloth, rail, feet]) { setInstances(ctx, m, nF, fencePos); m.frustumCulled = false; cityG.add(m); }

  // ── público detrás de las vallas: figuras recortadas (dibujadas aquí: 8 personas × 2 posturas) que miran siempre a
  //    la cámara (giran solo en vertical), cada vez más densas hacia la meta. Algunas alzan los brazos a su ritmo ──
  const PEOPLE = 8;
  const crowdTex = (() => {
    const cw = 64; const ch = 160;
    const c = document.createElement('canvas'); c.width = cw * PEOPLE * 2; c.height = ch;
    const g = c.getContext('2d');
    const r = ctx.rng(31);
    const shirts = ['#d93a3a', '#2f6fd6', '#f2c230', '#2fa86b', '#f2f2f2', '#1d1d24', '#e8743b', '#7a4fc9', '#3bb3d6', '#c9c9c9'];
    const skins = ['#f1c9a5', '#e0ac85', '#c68a62', '#8d5a3b', '#5c3a26'];
    const hairs = ['#2a1d14', '#4a3222', '#b98a4e', '#d9c08a', '#8a8a8a', '#111111'];
    const trousers = ['#23262e', '#3a4a6a', '#5a4a3a', '#2e3b2e', '#6a6a72'];
    for (let p = 0; p < PEOPLE; p++) {
      const shirt = shirts[Math.floor(r() * shirts.length)]; const skin = skins[Math.floor(r() * skins.length)];
      const hair = hairs[Math.floor(r() * hairs.length)]; const pants = trousers[Math.floor(r() * trousers.length)];
      const wide = 0.9 + r() * 0.25;
      for (let fr = 0; fr < 2; fr++) {
        const x0 = (p * 2 + fr) * cw; const mx = x0 + cw / 2;
        const sw = 15 * wide;
        g.fillStyle = pants; g.fillRect(mx - sw + 2, 92, sw * 2 - 4, 66);                     // piernas
        g.fillStyle = shirt; g.beginPath(); g.roundRect(mx - sw, 44, sw * 2, 56, 7); g.fill(); // torso
        g.strokeStyle = shirt; g.lineCap = 'round'; g.lineWidth = 8;
        if (fr === 0) {                                                                       // brazos abajo
          g.beginPath(); g.moveTo(mx - sw + 2, 50); g.lineTo(mx - sw - 2, 92); g.moveTo(mx + sw - 2, 50); g.lineTo(mx + sw + 2, 92); g.stroke();
          g.fillStyle = skin; g.beginPath(); g.arc(mx - sw - 2, 95, 4, 0, 7); g.arc(mx + sw + 2, 95, 4, 0, 7); g.fill();
        } else {                                                                              // brazos arriba (¡ánimo!)
          g.beginPath(); g.moveTo(mx - sw + 3, 50); g.lineTo(mx - sw - 9, 12); g.moveTo(mx + sw - 3, 50); g.lineTo(mx + sw + 9, 12); g.stroke();
          g.fillStyle = skin; g.beginPath(); g.arc(mx - sw - 10, 9, 4.5, 0, 7); g.arc(mx + sw + 10, 9, 4.5, 0, 7); g.fill();
        }
        g.fillStyle = skin; g.beginPath(); g.ellipse(mx, 30, 10, 12, 0, 0, 7); g.fill();       // cabeza
        g.fillStyle = hair; g.beginPath(); g.ellipse(mx, 23, 10.5, 7, 0, Math.PI, 0); g.fill();
      }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  })();
  texts.push(crowdTex);
  const crowdList = [];
  {
    const r = ctx.rng(77);
    for (const fe of fences) {
      const k = clamp((fe.s - fenceStart) / Math.max(1, L - fenceStart), 0, 1);
      const rows = [[FENCE_X + 0.75, 0.55 + 0.4 * k], [FENCE_X + 1.55, 0.15 + 0.55 * k], [FENCE_X + 2.35, 0.35 * k]];
      for (const [x, p] of rows) {
        for (let j = 0; j < 3; j++) {
          if (r() > p) continue;
          crowdList.push({ s: fe.s - FENCE_D / 2 + (j + r() * 0.8) * (FENCE_D / 3), side: fe.side, x: x + (r() - 0.5) * 0.3, h: 1.55 + r() * 0.3, who: Math.floor(r() * PEOPLE), cheer: r() < 0.45 ? 0.6 + r() * 1.4 : 0, ph: r() * 6.28 });
        }
      }
    }
  }
  const nC = crowdList.length;
  const crowdGeo = new THREE.PlaneGeometry(0.62, 1.55).translate(0, 0.775, 0);
  const aWho = new Float32Array(nC * 4);
  crowdList.forEach((c, i) => aWho.set([c.who, c.cheer, c.ph, c.h / 1.55], i * 4));
  crowdGeo.setAttribute('aWho', new THREE.InstancedBufferAttribute(aWho, 4));
  const crowdMat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTex: { value: crowdTex }, uTime: { value: 0 }, uLight: { value: 1 } },
    vertexShader: `
attribute vec4 aWho;
uniform float uTime;
varying vec2 vUv;
varying vec3 vSh;
#include <fog_pars_vertex>
void main() {
  float up = step(0.5, aWho.y) * step(0.35, sin(uTime * aWho.y * 3.0 + aWho.z));
  vUv = vec2((uv.x + aWho.x * 2.0 + up) / ${(PEOPLE * 2).toFixed(1)}, uv.y);
  vSh = vec3(uv, 0.8 + 0.28 * fract(aWho.z * 3.7));
  vec4 o = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 toCam = cameraPosition - o.xyz; toCam.y = 0.0;
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + 1e-5);
  float bob = 0.03 * sin(uTime * (2.0 + aWho.y) + aWho.z) * step(0.01, aWho.y);
  vec3 w = o.xyz + right * position.x * aWho.w + vec3(0.0, position.y * aWho.w + bob, 0.0);
  vec4 mvPosition = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `
uniform sampler2D uTex;
uniform float uLight;
varying vec2 vUv;
varying vec3 vSh;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec4 c = texture2D(uTex, vUv);
  if (c.a < 0.5) discard;
  // volumen sin geometría: luz cenital (cabeza y hombros claros, piernas en la sombra de la valla y de los demás),
  // costados que se oscurecen como un cilindro y un tono distinto por persona (la multitud deja de ser una pegatina)
  float top = mix(0.5, 1.08, smoothstep(0.05, 0.8, vSh.y));
  float round = 0.74 + 0.26 * cos((vSh.x - 0.5) * 3.1416);
  gl_FragColor = vec4(c.rgb * uLight * top * round * vSh.z, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
    fog: true, side: THREE.DoubleSide,
  });
  // el lienzo está en sRGB: a lineal para que el tono final cuadre con el resto (salida en linealToOutput del post)
  crowdTex.colorSpace = THREE.SRGBColorSpace;
  const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, nC);
  const cp = [0, 0];
  setInstances(ctx, crowd, nC, (i, t) => {
    const c = crowdList[i];
    const phi = headingAt(c.s);
    posAt(c.s, cp);
    t.p.set(cp[0] + Math.cos(phi) * c.x * c.side, 0, cp[1] + Math.sin(phi) * c.x * c.side);
  });
  crowd.frustumCulled = false;
  cityG.add(crowd);

  // ── los otros corredores del maratón: el mismo maniquí articulado de «Carrera», aquí a la luz del día. Van por el
  //    recorrido real (giran en las esquinas contigo), cada uno un poco más rápido o más lento que tú: les ganas y te
  //    ganan de verdad, en función pura de tus metros (capturas deterministas). Nunca por tu trazada. Sombra alargada
  //    hacia donde la echa el sol de la ciudad. En el contraplano del final siguen llegando a la meta hacia la cámara. ──
  const NRUN = 40; const RUN_WIN = 150; const RUN_BACK = 25;
  const runParts = runnerParts(THREE);
  const runGeo = new THREE.BufferGeometry();
  runGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(runParts.P), 3));
  runGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(runParts.N), 3));
  runGeo.setAttribute('aJ', new THREE.BufferAttribute(new Float32Array(runParts.J), 4));
  runGeo.setIndex(runParts.I);
  const runList = [];
  {
    const r = ctx.rng(913);
    const aV = new Float32Array(NRUN * 4); const aV2 = new Float32Array(NRUN * 4);
    for (let i = 0; i < NRUN; i++) {
      let x; do { x = (r() * 2 - 1) * 2.7; } while (Math.abs(x) < 1.2);   // dentro de la calzada también en las calles estrechas
      const d = (r() - 0.5) * 0.16 + (r() < 0.12 ? 0.05 : 0);
      runList.push({ x, off: (i + 0.5 * r()) * (RUN_WIN / NRUN), d, sc: 0.93 + 0.14 * r() });
      aV.set([r(), r(), r() < 0.3 ? 1 : 0, r()], i * 4);     // fase, camiseta, mallas, piel
      aV2.set([r(), d, 0, 0], i * 4);
    }
    runGeo.setAttribute('aV', new THREE.InstancedBufferAttribute(aV, 4));
    runGeo.setAttribute('aV2', new THREE.InstancedBufferAttribute(aV2, 4));
  }
  const lin3 = (r, g, b) => new THREE.Color().setRGB(r, g, b);
  const runU = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uStride: { value: 0 }, uAmp: { value: 1 }, uSun: { value: new THREE.Vector3(0, 1, 0) },
    uShirt: { value: [lin3(0.72, 0.72, 0.7), lin3(0.58, 0.05, 0.04), lin3(0.05, 0.2, 0.58), lin3(0.78, 0.58, 0.05), lin3(0.1, 0.48, 0.15),
      lin3(0.78, 0.24, 0.03), lin3(0.03, 0.03, 0.035), lin3(0.68, 0.14, 0.34), lin3(0.55, 0.62, 0.1)] },
  };
  const runMat = new THREE.ShaderMaterial({
    uniforms: runU,
    vertexShader: `
attribute vec4 aJ;
attribute vec4 aV;
attribute vec4 aV2;
uniform float uStride, uAmp;
uniform vec3 uSun;
varying vec3 vLight;
varying vec3 vP;
varying vec4 vInfo;
varying vec2 vRnd;
#include <fog_pars_vertex>
${RUN_POSE}
void main() {
  float A = uAmp * (0.85 + 0.3 * fract(aV.x * 7.3));
  float ph = (uStride * (1.0 + 0.5 * aV2.y) + aV.x) * 6.28318;
  vec3 p = position;
  vec3 n = normal;
  vP = position;
  runnerPose(p, n, aJ, A, ph);
  mat4 M = modelMatrix * instanceMatrix;
  vec4 wp = M * vec4(p, 1.0);
  vec3 N = normalize(mat3(M) * n);
  // luz de día: cielo arriba, rebote del asfalto abajo, sol bajo y un filo claro que los separa del fondo
  float occ = 0.72 + 0.28 * smoothstep(0.0, 0.16, abs(position.x));
  vec3 amb = mix(vec3(0.075, 0.068, 0.058), vec3(0.24, 0.27, 0.32), N.y * 0.5 + 0.5) * 1.5;
  vec3 V = normalize(cameraPosition - wp.xyz);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.1;
  vLight = amb * occ + vec3(1.0, 0.9, 0.78) * 0.66 * max(dot(N, uSun), 0.0) + rim;
  vInfo = vec4(aJ.w, aV.y, aV.z, aV.w);
  vRnd = vec2(aV.x, aV2.x);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `
uniform vec3 uShirt[9];
varying vec3 vLight;
varying vec3 vP;
varying vec4 vInfo;
varying vec2 vRnd;
#include <common>
#include <fog_pars_fragment>
${RUN_ALBEDO}
void main() {
  int si = int(floor(clamp(vInfo.y, 0.0, 0.999) * 9.0));
  vec3 skin = mix(vec3(0.5, 0.33, 0.24), vec3(0.13, 0.08, 0.055), vInfo.w);
  vec3 c = runnerAlbedo(vInfo.x, vP, uShirt[si], uShirt[int(floor(vRnd.y * 8.99))] * 1.15 + 0.04, skin, vInfo.z, vRnd);
  gl_FragColor = vec4(c * vLight, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
    fog: true,
  });
  const runMesh = new THREE.InstancedMesh(runGeo, runMat, NRUN);
  runMesh.frustumCulled = false;
  cityG.add(runMesh);
  // sombra de cada uno: una mancha blanda que nace en sus pies y se alarga al lado contrario del sol
  const runShTex = (() => {
    const c = document.createElement('canvas'); c.width = 32; c.height = 96;
    const g = c.getContext('2d');
    const img = g.createImageData(32, 96);
    for (let yy = 0; yy < 96; yy++) for (let xx = 0; xx < 32; xx++) {
      const u = Math.abs((xx + 0.5) / 32 - 0.5) * 2; const v = (yy + 0.5) / 96;       // v = 0 en los pies
      const a = Math.max(0, 1 - u * u * (1.2 + 1.6 * v)) * Math.pow(Math.max(0, 1 - v), 0.8) * Math.min(1, v * 14);
      const o = (yy * 32 + xx) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 0; img.data[o + 3] = Math.round(255 * 0.5 * a);
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.flipY = false;
    return t;
  })();
  texts.push(runShTex);
  const runShGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
  { const uvA = runShGeo.attributes.uv; const pA = runShGeo.attributes.position; for (let i = 0; i < uvA.count; i++) uvA.setXY(i, pA.getX(i) + 0.5, pA.getZ(i)); }
  const runShMesh = new THREE.InstancedMesh(runShGeo, new THREE.MeshBasicMaterial({
    map: runShTex, color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  }), NRUN);
  runShMesh.frustumCulled = false;
  runShMesh.renderOrder = 3;
  cityG.add(runShMesh);
  const sunL = sun.position.clone().normalize();                              // hacia el sol, en el marco de la ciudad
  const shRot = Math.atan2(-sunL.x, -sunL.z);
  const shLen = clamp(1.7 / Math.max(0.2, Math.tan(Math.asin(clamp(sunL.y, 0.05, 1)))), 1.2, 4.2);
  const rq = [0, 0];
  const rM = new THREE.Matrix4(); const rP = new THREE.Vector3(); const rQ = new THREE.Quaternion(); const rS = new THREE.Vector3();
  const rE = new THREE.Euler(); const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  let runStride = 0; let runAdv = 0;
  function updateRunners(f, st, w, phiC, finaleNow) {
    const dt = clamp(f.dt, 0, 0.1);
    const kmh = finaleNow ? 11 : Math.max(0, kmhOfVis(Math.max(0, f.visualSpeed)));
    const running = finaleNow ? 1 : clamp(kmh / 4, 0, 1);
    runStride += dt * (clamp(150 + 2.3 * kmh, 150, 185) / 120) * running;
    runAdv = finaleNow ? runAdv + dt * 3.1 : 0;
    runU.uStride.value = runStride;
    runU.uAmp.value = finaleNow ? 0.9 : clamp((kmh - 3) / 8, 0.12, 1) * running;
    const cs = Math.cos(phiC); const sn = Math.sin(phiC);
    runU.uSun.value.set(sunL.x * cs + sunL.z * sn, sunL.y, -sunL.x * sn + sunL.z * cs);
    const n = st.lvl >= 2 ? NRUN : st.lvl === 1 ? 28 : 18;
    // en el plano final la ventana se echa atrás: llegan desde lejos (120 m) y cruzan la meta hacia la cámara
    const back = finaleNow ? 120 : RUN_BACK;
    const dir = w.back ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const r = runList[i];
      const rel = ((((r.off + r.d * st.S + runAdv * (1 + r.d)) % RUN_WIN) + RUN_WIN) % RUN_WIN) - back;
      const si = w.s + dir * rel;
      if (si < 1 || si > L - 0.4) { runMesh.setMatrixAt(i, ZERO); runShMesh.setMatrixAt(i, ZERO); continue; }
      const phi = headingAt(si);
      posAt(si, rq);
      rP.set(rq[0] + Math.cos(phi) * r.x, 0, rq[1] + Math.sin(phi) * r.x);
      rQ.setFromEuler(rE.set(0, -(phi + (w.back ? Math.PI : 0)), 0));
      rM.compose(rP, rQ, rS.set(r.sc, r.sc, r.sc));
      runMesh.setMatrixAt(i, rM);
      rP.y = 0.02;
      rQ.setFromEuler(rE.set(0, shRot, 0));
      rM.compose(rP, rQ, rS.set(0.78 * r.sc, 1, shLen * r.sc));
      runShMesh.setMatrixAt(i, rM);
    }
    runMesh.count = n; runShMesh.count = n;
    runMesh.instanceMatrix.needsUpdate = true; runShMesh.instanceMatrix.needsUpdate = true;
  }

  // ── atribución de OpenStreetMap (obligatoria por la ODbL): esquina inferior, pequeña y fija ──
  const credTex = ctx.textTexture('© OpenStreetMap', { size: 40, weight: 500, tracking: 0.05, color: '#ffffff', pad: 0.2 });
  const cred = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: credTex, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false }));
  cred.frustumCulled = false;
  cred.renderOrder = 960;
  ctx.cameraRoot.add(cred);
  function placeCredit() {
    const W = Math.max(1, ctx.size.width); const H = Math.max(1, ctx.size.height);
    const h = 11; const w = h * credTex.userData.aspect;
    const x = W - w - 10; const y = H - h - 6;
    const e = camera.projectionMatrix.elements;
    const ndcX = ((x + w / 2) / W) * 2 - 1; const ndcY = 1 - ((y + h / 2) / H) * 2;
    cred.position.set((ndcX + e[8]) / e[0], (ndcY + e[9]) / e[5], -1);
    cred.scale.set(((w / W) * 2) / e[0], ((h / H) * 2) / e[5], 1);
  }

  // letreros de los pórticos: si al acercarte pasan por detrás del número de velocidad (vertical: el horizonte va justo
  // bajo él), se funden a un 15 % mientras dura el cruce; nunca tapan tu número
  const gv = new THREE.Vector3();
  function fadeGantries(dt) {
    let sp = null; for (const r of ctx.hud.rects) if (r.kind === 'speed') sp = r;
    const W = Math.max(1, ctx.size.width); const H = Math.max(1, ctx.size.height);
    cityG.updateMatrixWorld();
    for (const gt of gantries) {
      let over = 0;
      if (sp) {
        gv.set(0, gt.y, 0); gt.g.localToWorld(gv);
        if (gv.z < -2 && gv.z > -400) {
          gv.project(camera);
          const y = (1 - gv.y) * 0.5 * H; const x = (gv.x + 1) * 0.5 * W;
          const halfW = (gt.half / Math.max(1, -gt.g.position.z)) * W;   // ancho aproximado, de sobra
          if (y > sp.y - 10 && y < sp.y + sp.h + 10 && x + halfW > sp.x && x - halfW < sp.x + sp.w) over = 1;
        }
      }
      if (reverse) over = 0;   // plano final: sin HUD, el letrero entero
      gt.a += ((over ? 0.15 : 1) - gt.a) * (1 - Math.exp(-dt * 6));
      for (const m of gt.mats) m.opacity = gt.a;
    }
  }

  function applyQuality() { for (const c of chunks) if (c.built) c.built.setQuality(); }
  pumpChunks(locate(0).s, 1e9);

  const inst = {
    director: { scale: 1, maxDown: 0.15, orbit: true },
    resize(s) { runner.resize(s); },
    update(f) {
      // final: avance de la grúa (10 s) y, al arrancar, CORTE de cámara (sin viajar desde tus ojos hasta 44 m atrás)
      if (f.finale > 0) {
        const first = heroT0 < 0;
        if (first) heroT0 = f.time;
        const u = f.reducedMotion ? 1 : clamp((f.time - heroT0) / 10, 0, 1);
        heroK = u * u * (3 - 2 * u);
        heroSway = f.reducedMotion ? 0 : 0.18 * heroK * Math.sin((f.time - heroT0) * 0.19);
        if (first && atMeta) ctx.rig.snap();
      } else heroT0 = -1;
      const st = runner.update(f);
      if (f.status === 'ready' || f.t < 0.5) planOffset();
      const w = locate(st.S);
      pumpChunks(w.s);
      crowdMat.uniforms.uTime.value = st.rm ? 0 : f.time;
      posAt(w.s, pa);
      // contraplano del final: la ciudad gira 180° alrededor de tu punto (la cámara del kit siempre mira a −z), el letrero
      // de la meta pasa a la cara que ahora ve la cámara y la bruma se aclara un poco (la recta se lee hasta el fondo)
      const rev = f.finale > 0 && atMeta;
      if (rev !== reverse) {
        reverse = rev;
        if (finishSign) {
          finishSign.panel.rotation.y = rev ? Math.PI : 0; finishSign.panel.position.z = rev ? -0.16 : 0.16;
          finishSign.back.rotation.y = rev ? Math.PI : 0; finishSign.back.position.z = rev ? -0.155 : 0.155;
        }
      }
      scene.fog.density = 0.0034 - (rev ? 0.0011 * heroK : 0);
      const phiC = w.phi + (rev ? Math.PI : 0);
      const c = Math.cos(phiC); const s = Math.sin(phiC);
      cityG.rotation.y = phiC;
      cityG.position.set(-(pa[0] * c + pa[1] * s), 0, -(-pa[0] * s + pa[1] * c));
      updateRunners(f, st, w, phiC, f.finale > 0);
      placeCredit();
      fadeGantries(f.dt);
    },
    event(type, data) {
      runner.event(type, data);
      if (type === 'quality') applyQuality();
      if (type === 'timeline' && runner.S < 1) planOffset();
    },
    get _debug() {
      return { ...runner.debug(), sigAt: runner.sigAt, route: { s: where.s, offset, L, back: where.back, km: R.kmAtEnd - (L - where.s) / 1000 },
        chunks: chunks.map((c) => (c.built ? 'listo' : c.gen ? 'construyendo' : '—')).join(' '), tris: chunks.reduce((a, c) => a + (c.built ? c.built.tris : 0), 0) };
    },
    dispose() { for (const t of texts) t.dispose(); credTex.dispose(); runGeo.dispose(); runMat.dispose(); runShGeo.dispose(); runShMesh.material.dispose(); },
  };
  return inst;
}
