// BestRunning · escenario AURORA · río de partículas finas (y la estela paralela del fantasma).
// Miles de motas de luz MUY finas fijas en el mundo que vienen hacia ti EXACTAMENTE a tu velocidad (S del núcleo): todo
// se calcula en el vertex shader (cero trabajo de CPU por partícula). Cada mota es un quad instanciado que se alarga en
// pantalla lo que se mueve durante medio fotograma (obturador de 180°, desenfoque de movimiento normalizado en energía y
// limitado a unos pocos píxeles: nunca una estela de warp). Se funden con la profundidad (lejos: se disuelven en el
// horizonte; cerca: se apagan antes de d ≈ 8 u, donde a 13–18 km/h saltarían 17–34 px por fotograma y se verían a
// saltos o como purpurina). El color de cada mota es el del tramo al que pertenece ese punto del río: el tramo siguiente
// se ve llegar desde el horizonte y su frontera (una línea fina) te alcanza justo en el segundo del cambio.
// Fantasma: un hilo tenue paralelo con una cabeza de luz donde va tu mejor marca (solo si va por delante).
// Densidad por RANGO: la instancia i solo se enciende si i/N < densidad ⇒ bajar la calidad o la energía apaga motas
// al azar con un fundido (sin saltos) y el recorte de instanceCount coincide exactamente con lo ya apagado.
import { RIVER_GLSL, RIVER_LEN, RIVER_NEAR } from './common.js';

const GATES = 3;

const VERT = /* glsl */ `
#define GATES ${GATES}
attribute vec2 aCorner;   // x: -1 | 1 (través), y: 0 | 1 (a lo largo)
attribute vec4 aSeed;     // fase, lateral (-1..1), altura, azar
attribute vec2 aKind;     // x: 0 río · 1 hilo del fantasma · 2 cabeza del fantasma · y: rango (0..1) para la densidad
uniform float uS, uL, uNear, uWidth, uVel, uShutter, uMaxLen, uSize, uDensity, uGain, uTwinkle, uTime, uRecord, uFade;
uniform float uNearFade;  // distancia (u) por debajo de la cual las motas se apagan
uniform vec2 uViewport;
uniform vec3 uCol, uWhite, uGold, uGhostCol;
uniform vec4 uGate[GATES];
uniform vec3 uGateCol[GATES];
uniform vec4 uKm;         // distancia, intensidad
uniform vec4 uMark;       // marca de MITAD: distancia, intensidad
uniform vec4 uGhost;      // desplazamiento lateral, distancia de la cabeza, alfa, -
uniform vec4 uDuel;       // duelo con el fantasma: mezcla 0..1, separación de los dos ríos (u), brillo fantasma, brillo tuyo
uniform vec3 uSilver;     // río del fantasma (blanco plata)
uniform vec2 uHat;        // charles: envolvente 0..1, semilla del golpe (qué motas destellan levemente)
varying vec3 vCol;
varying vec4 vQ;
RIVER_CHUNK

void main() {
  float L = uL;
  float kind = aKind.x;
  float d = mod(aSeed.x * L - uS, L) + uNear;
  // casi todas a ras de suelo (el río se lee como una superficie de polvo de luz), unas pocas flotan algo más
  float h = 0.015 + aSeed.z * aSeed.z * 0.08 + step(0.95, aSeed.z) * (aSeed.z - 0.95) * 4.0;
  float lat = aSeed.y * uWidth;
  float I = 0.3 + 0.7 * aSeed.w * aSeed.w;
  vec3 col = uCol;
  float sz = uSize * (0.7 + 0.6 * fract(aSeed.w * 13.7));
  float vel = uVel;
  float nearK = smoothstep(uNearFade * 0.62, uNearFade, d);
  // duelo: el río se parte en dos corrientes paralelas (la tuya a la izquierda, la del fantasma a la derecha) que se
  // juntan o se separan con la distancia real entre los dos
  float gs = step(0.5, fract(aSeed.w * 7.31 + aSeed.z * 3.7));
  if (kind < 0.5 && uDuel.x > 0.001) {
    float side = gs * 2.0 - 1.0;
    lat = mix(lat, aSeed.y * uWidth * 0.5 + side * uDuel.y * 0.5, uDuel.x);
  }
  if (kind > 0.5) {
    lat = uGhost.x + aSeed.y * 0.08;
    h = 0.05 + aSeed.z * 0.08;
    col = uGhostCol;
    sz = uSize * 0.8;
    if (kind > 1.5) {
      d = uGhost.y;
      h = 0.14;
      sz = uSize * 3.6 + d * 0.0007; // cabeza: punto de luz de tamaño casi constante en pantalla
      I = 1.5;
      vel = 0.0;
      nearK = 1.0;
    } else {
      float behind = uGhost.y - d;
      I = behind > 0.0 ? 0.08 + 0.9 * exp(-behind / 12.0) : 0.04;
      nearK = smoothstep(8.0, 18.0, d); // el hilo no invade el borde de la pantalla cerca de la cámara
      I *= 1.0 - 0.85 * uDuel.x;        // en duelo, el río plateado sustituye al hilo
    }
    I *= uGhost.z;
  } else {
    // color del tramo al que pertenece este punto del río + la línea fina de cada frontera
    for (int k = 0; k < GATES; k++) {
      vec4 g = uGate[k];
      if (g.y > 0.0) {
        col = mix(col, uGateCol[k], smoothstep(g.x - 0.5, g.x + 0.5, d));
        I += exp(-(d - g.x) * (d - g.x) * 1.4) * g.y * 1.8;
      }
    }
    float kb = exp(-(d - uKm.x) * (d - uKm.x) * 1.2) * uKm.y + exp(-(d - uMark.x) * (d - uMark.x) * 1.2) * uMark.y;
    I += kb * 0.9;
    col = mix(col, uWhite, clamp(kb, 0.0, 1.0) * 0.6);
    col = mix(col, uGold, uRecord);
    // polvo de luz teñido (no purpurina): leve mezcla con blanco frío, sin motas "de diamante"
    col = mix(col, uWhite, 0.22);
    if (uDuel.x > 0.001) {
      col = mix(col, uSilver, gs * uDuel.x);
      I *= mix(1.0, mix(uDuel.w, uDuel.z, gs), uDuel.x);
    }
    // charles: un 12 % de las motas (distintas en cada golpe) se encienden un instante, muy poco (brillo, no chispa)
    I *= 1.0 + uHat.x * 0.9 * smoothstep(0.88, 1.0, fract(aSeed.w * 91.7 + aSeed.x * 37.3 + uHat.y));
    // densidad por rango, con fundido (bajar calidad o energía apaga motas al azar sin saltos)
    I *= 1.0 - smoothstep(uDensity - 0.035, uDensity, aKind.y);
    I *= 1.0 + uTwinkle * sin(uTime * (1.3 + aSeed.w * 2.0) + aSeed.x * 50.0);
  }
  // se disuelve con la profundidad (perspectiva atmosférica) y desaparece lejos con suavidad
  I *= (1.0 - smoothstep(L + uNear - 60.0, L + uNear, d)) * exp(-max(d, 0.0) * 0.011) * nearK * uFade;
  // parte de las motas se encienden a mitad de camino (nacen en el río): más densidad cerca, el fondo sigue fino
  if (kind < 0.5) {
    float rb = fract(aSeed.w * 3.17 + aSeed.y * 1.31 + aSeed.z * 0.71);
    float birth = mix(22.0, L + uNear, rb * rb);
    I *= 1.0 - smoothstep(birth - 16.0, birth, d);
  }
  float x = riverX(d) + lat;
  vec3 p = vec3(x, h, -d);
  float dp = d + vel * uShutter;
  vec3 pp = vec3(riverX(dp) + lat, h, -dp);
  vec4 c0 = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vec4 c1 = projectionMatrix * viewMatrix * vec4(pp, 1.0);
  if (c0.w < 0.25 || I < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); vQ = vec4(0.0); return; }
  vec2 s0 = c0.xy / c0.w * 0.5 * uViewport;
  vec2 s1 = c1.w > 0.25 ? c1.xy / c1.w * 0.5 * uViewport : s0;
  float rad = sz * projectionMatrix[1][1] * 0.5 * uViewport.y / c0.w;
  float ak = 1.0;
  // por debajo de ~0,8 px de radio la mota no encoge más: pierde energía (sin parpadeo de subpíxel)
  if (rad < 0.8) { ak = rad * rad / 0.64; rad = 0.8; }
  rad = min(rad, 3.0);
  vec2 dv = s1 - s0;
  float len = length(dv);
  vec2 dir = len > 0.001 ? dv / len : vec2(0.0, 1.0);
  // desenfoque más largo SOLO para las motas cercanas (las que más px recorren por fotograma), siempre corto
  len = min(len, uMaxLen * (3.0 - 2.0 * smoothstep(8.0, 30.0, d)));
  vec2 perp = vec2(dir.y, -dir.x); // base (perp, dir) sin reflejo: el quad no queda de espaldas
  float R = rad * 1.6 + 1.0;
  float along = aCorner.y * (len + 2.0 * R) - R;
  vec2 sp = s0 + dir * along + perp * aCorner.x * R;
  vQ = vec4(aCorner.x * R, along, len, rad);
  // energía repartida a lo largo del desenfoque ⇒ una mota en movimiento no brilla más que una quieta
  vCol = col * I * ak * uGain * rad / (rad + len * 0.6);
  gl_Position = vec4(sp / (0.5 * uViewport) * c0.w, c0.z, c0.w);
}`;

const FRAG = /* glsl */ `
varying vec3 vCol;
varying vec4 vQ;
void main() {
  float t = clamp(vQ.y, 0.0, vQ.z);
  vec2 q = vec2(vQ.x, vQ.y - t) / max(vQ.w, 0.5);
  float k = exp(-dot(q, q) * 1.8);
  gl_FragColor = vec4(vCol * k, 1.0);
}`;

const COUNT = [6000, 9000, 13000, 18000]; // eco, low, med, high
const GHOST_N = 360;

/** shared = { uBend, uSm, uGate, uGateCol, uKm, uMark, uGhost } (objetos de uniform compartidos con el suelo). */
export function createRiver(ctx, shared) {
  const { THREE, root } = ctx;
  const maxN = COUNT[3];
  const G0 = GHOST_N + 1; // las instancias del fantasma van PRIMERO (siempre se pintan; sin fantasma se descartan en el VS)
  const total = G0 + maxN;
  const R = ctx.rng(4242);
  const seed = new Float32Array(total * 4);
  const kind = new Float32Array(total * 2);
  for (let i = 0; i < total; i++) {
    // lateral: suma de tres uniformes (campana) ⇒ río con el centro más denso y orillas difusas
    const g = (R() + R() + R() - 1.5) / 1.5;
    seed.set([R(), g, R(), R()], i * 4);
  }
  for (let i = 0; i < GHOST_N; i++) kind[i * 2] = 1;
  kind[GHOST_N * 2] = 2;
  for (let i = 0; i < maxN; i++) kind[(G0 + i) * 2 + 1] = (i + 0.5) / maxN; // rango de densidad

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([-1, 0, 1, 0, -1, 1, 1, 1]), 2));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 2));

  const u = {
    uS: { value: 0 }, uL: { value: RIVER_LEN }, uNear: { value: RIVER_NEAR }, uWidth: { value: 1.5 }, uVel: { value: 0 },
    uShutter: { value: 1 / 120 }, uMaxLen: { value: 8 }, uSize: { value: 0.0046 }, uDensity: { value: 1 }, uGain: { value: 1 },
    uTwinkle: { value: 0 }, uTime: { value: 0 }, uRecord: { value: 0 }, uFade: { value: 1 }, uNearFade: { value: 8 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uCol: { value: new THREE.Color() }, uWhite: { value: new THREE.Color('#dfe8ff') }, uGold: { value: new THREE.Color('#ffcf5a') },
    uGhostCol: { value: new THREE.Color('#a9dcff') },
    uDuel: { value: new THREE.Vector4(0, 0, 1, 1) }, uSilver: { value: new THREE.Color('#e6ecf7') },
    uHat: { value: new THREE.Vector2(0, 0) },
    uBend: shared.uBend, uSm: shared.uSm, uGate: shared.uGate, uGateCol: shared.uGateCol, uKm: shared.uKm,
    uMark: shared.uMark, uGhost: shared.uGhost,
  };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: u, vertexShader: VERT.replace('RIVER_CHUNK', RIVER_GLSL), fragmentShader: FRAG,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  root.add(mesh);

  // Tope de densidad por calidad (fracción de maxN), suavizado: al bajar de calidad las motas sobrantes se funden en
  // ~1,5 s y solo entonces se recortan las instancias.
  let capTarget = COUNT[Math.max(0, Math.min(3, ctx.qualityLevel | 0))] / maxN;
  let cap = capTarget;
  const syncCount = (c) => { geo.instanceCount = G0 + Math.min(maxN, Math.ceil(c * maxN) + 64); };
  syncCount(cap);

  return {
    u,
    mesh,
    get count() { return Math.round(cap * maxN); },
    setQuality(level) { capTarget = COUNT[Math.max(0, Math.min(3, level | 0))] / maxN; syncCount(Math.max(cap, capTarget)); },
    /** Densidad 0..1 deseada (energía de la zona) ⇒ uniforme ya limitado por la calidad. Llamar cada fotograma. */
    setDensity(want, dt, snap) {
      cap = snap ? capTarget : cap + (capTarget - cap) * (1 - Math.exp(-dt * 2.5));
      if (Math.abs(cap - capTarget) < 0.002) cap = capTarget;
      syncCount(cap);
      u.uDensity.value = Math.max(0, Math.min(1, want)) * cap;
    },
  };
}
