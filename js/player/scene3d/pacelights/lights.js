// BestRunning · escena 3D · LUCES DE TU RÉCORD («Wavelight») · geometría y shaders (sin estado de la clase).
//
// Dos piezas, dos draw calls como máximo:
//   1. EMISORES: un InstancedBufferGeometry de un quad. Cada instancia es un LED físico (cápsula pequeña y nítida) o
//      su reflejo en el suelo pulido. Posición, tangente, tamaño, halo e intensidad por instancia (CPU, arrays
//      reutilizados y compactados: solo se suben los LED que se ven). El quad se orienta en pantalla según la tangente
//      del camino y se alarga con la velocidad del suelo (obturador de 180° al tiempo real del fotograma). Por debajo
//      de `uPxMin` px no se encoge: se atenúa (conserva energía ⇒ lejos no hay manchas). Lejos, la CPU deja solo uno de
//      cada 2, 4, 8… LED (octavas fijas al suelo): cada LED sigue siendo un punto suelto hasta el horizonte.
//   2. CINTA: una tira fina (cámara o suelo) que sigue el camino detrás de la ventana: la estela fina (aurora) o la
//      luz que el LED deja en la pista (estadio, Grafito).
// Color HDR lineal: el núcleo de la ventana pasa el umbral del bloom del escenario (≥ 0,85) ⇒ un brillo corto y
// limpio, sin destellos. El oro (`uGold`, el del propio escenario) solo aparece al superar tu récord.
import { OUTPUT } from '../shaders.js';

const EMIT_VERT = /* glsl */ `
attribute vec4 iP;   // xyz mundo · intensidad (HDR)
attribute vec4 iT;   // tangente (mundo) · largo COMPLETO del LED (u, con la estela de movimiento)
attribute vec4 iS;   // halo (0..1, nunca puentea un hueco) · tipo (0 LED, 1 reflejo) · mezcla hacia la estela · reposo
attribute float iW;  // mezcla hacia el oro (sin factor de energía)
uniform vec2 uRes;
uniform float uPxMin, uFlat, uReflStretch, uEPow, uPitch, uAcross;
varying vec2 vUv;
varying float vI, vMix, vKind, vBase, vGold, vHaloK;
void main() {
  vec3 wp = iP.xyz;
  vec3 T = normalize(iT.xyz);
  float across = uAcross;
  float along = iT.w;
  vKind = iS.y;
  vec2 c = position.xy;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float z0 = max(0.05, -mv.z);
  float ppw = projectionMatrix[1][1] * uRes.y * 0.5 / z0;
  // dirección del camino EN PANTALLA: proyectar dos puntos (con la división de perspectiva). Una línea que se aleja
  // apunta al punto de fuga; mat3(viewMatrix)·T a secas daría una orientación falsa (escalera de LED).
  float stp = max(0.05, uPitch * 0.5);
  vec4 m1 = viewMatrix * vec4(wp + T * stp, 1.0);
  float z1 = max(0.05, -m1.z);
  vec2 td = (m1.xy / z1 - mv.xy / z0) * z0 / stp;   // u de vista (a la profundidad del LED) por u del mundo
  float tl = length(td);
  td = tl > 1e-4 ? td / tl : vec2(1.0, 0.0);
  float lW = along * tl * 0.5;                 // semilargo proyectado (escorzo); nunca se estira hasta el vecino
  float lPx = lW * ppw;
  float kA = max(1.0, uPxMin / max(across * ppw, 1e-4));
  float energy;
  if (uFlat > 0.5 && iS.y < 0.5 && lPx > 1.5) {
    // LED embebido en el suelo (Grafito), solo cerca: el quad yace en el plano del suelo. Lejos (< 3 px de largo) un
    // quad tumbado parpadea al desplazarse: pasa al LED de cara a la cámara de abajo, que nunca baja de uPxMin
    vec3 R = normalize(cross(T, vec3(0.0, 1.0, 0.0)));
    energy = pow(1.0 / kA, uEPow);
    mv = viewMatrix * vec4(wp + R * c.x * across * kA * 1.6 + T * c.y * along * 0.625, 1.0);
  } else {
    vec2 nd = vec2(-td.y, td.x);
    float kL = max(1.0, uPxMin / max(lPx, 1e-4));
    energy = pow(1.0 / (kA * sqrt(kL)), uEPow);
    float a = across * kA * 1.6;
    float l = max(lW, uPxMin / ppw) * 1.25;
    // reflejo: mismo ancho que el LED, alargado en VERTICAL de pantalla (así cae la luz en un suelo pulido; a lo largo
    // del camino, en una curva, se leía como una segunda hilera borrosa al lado de la real)
    if (iS.y > 0.5) { l = l + across * uReflStretch * 1.2; td = vec2(0.0, 1.0); nd = vec2(-1.0, 0.0); }
    mv.xy += td * c.y * l + nd * c.x * a;
  }
  vUv = c;
  vI = iP.w * energy;
  vMix = iS.z;
  vBase = iS.w * energy;
  vGold = iW;
  vHaloK = iS.x;
  gl_Position = projectionMatrix * mv;
}`;

const EMIT_FRAG = /* glsl */ `
uniform vec3 uCol, uCol2, uBase, uGold;
uniform float uAlpha, uRefl, uHalo;
varying vec2 vUv;
varying float vI, vMix, vKind, vBase, vGold, vHaloK;
void main() {
  vec2 q = abs(vUv);
  // oro que el ACES no lava: el escenario da un ámbar y, poco encendido, tira a cobre (nunca a oliva)
  vec3 G = uGold * mix(vec3(1.0, 0.62, 0.28), vec3(1.0), smoothstep(0.4, 1.6, vI));
  vec3 tint = mix(mix(uCol, uCol2, vMix), G, vGold);
  vec3 col;
  if (vKind > 0.5) {
    // reflejo en el suelo: mancha alargada y blanda, sin núcleo
    float shape = exp(-q.x * q.x * 3.2) * exp(-q.y * q.y * 2.6) * (1.0 - smoothstep(0.55, 1.0, q.x)) * (1.0 - smoothstep(0.55, 1.0, q.y));
    col = tint * vI * shape * uRefl;
  } else {
    // lámpara: borde nítido (1/1,6 del quad) con el centro caliente (casi blanco, como un LED real en cámara) y halo
    // corto dentro del quad (apagado si el LED vecino está cerca)
    float cx = 1.0 - smoothstep(0.42, 0.66, q.x);
    float cy = 1.0 - smoothstep(0.6, 0.82, q.y);
    float hot = exp(-(q.x * q.x * 6.0 + q.y * q.y * 3.0));
    float core = cx * cy * (0.5 + 0.5 * hot);
    float halo = exp(-(q.x * q.x * 5.0 + q.y * q.y * 3.5));
    vec3 lit = mix(tint, vec3(1.0), 0.35 * hot) * vI;
    col = lit * core + mix(uCol2, G, vGold) * vI * halo * uHalo * vHaloK + mix(uBase, G * 0.05, vGold) * vBase * cx * cy;
  }
  gl_FragColor = vec4(col * uAlpha, 1.0);
  ${OUTPUT}
}`;

const RIB_VERT = /* glsl */ `
attribute vec2 aV;   // x: −1..1 a lo ancho · y: intensidad de la sección
varying vec2 vV;
void main() {
  vV = aV;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;
const RIB_FRAG = /* glsl */ `
uniform vec3 uCol, uCol2;
uniform float uAlpha, uSharp, uTint;
varying vec2 vV;
void main() {
  float a = exp(-vV.x * vV.x * uSharp);
  vec3 c = mix(uCol2, uCol, clamp(vV.y, 0.0, 1.0) * uTint + (1.0 - uTint));
  gl_FragColor = vec4(c * a * vV.y * uAlpha, 1.0);
  ${OUTPUT}
}`;

/** Emisores instanciados: hasta `cap` instancias (LED y reflejos, compactados). */
export function createEmitters(THREE, cap) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const mk = (k) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * k), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
  const iP = mk(4); const iT = mk(4); const iS = mk(4); const iW = mk(1);
  geo.setAttribute('iP', iP); geo.setAttribute('iT', iT); geo.setAttribute('iS', iS); geo.setAttribute('iW', iW);
  geo.instanceCount = 0;
  const u = {
    uRes: { value: new THREE.Vector2(440, 956) }, uPxMin: { value: 2.2 }, uFlat: { value: 0 }, uReflStretch: { value: 3.0 }, uEPow: { value: 1.0 },
    uPitch: { value: 1.0 }, uAcross: { value: 0.04 },
    uCol: { value: new THREE.Color(1, 1, 1) }, uCol2: { value: new THREE.Color(0.5, 0.7, 1) }, uBase: { value: new THREE.Color(0.05, 0.055, 0.06) },
    uGold: { value: new THREE.Color(1.0, 0.8, 0.3) }, uAlpha: { value: 0 }, uRefl: { value: 0.3 }, uHalo: { value: 0.34 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: EMIT_VERT, fragmentShader: EMIT_FRAG, transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 600;
  mesh.name = 'pacelights-emitters';
  return { mesh, geo, mat, u, iP, iT, iS, iW, cap };
}

/** Cinta de m secciones (2 vértices por sección). */
export function createRibbon(THREE, m) {
  const geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array((m + 1) * 2 * 3), 3);
  const av = new THREE.BufferAttribute(new Float32Array((m + 1) * 2 * 2), 2);
  pos.setUsage(THREE.DynamicDrawUsage);
  av.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pos);
  geo.setAttribute('aV', av);
  const idx = [];
  for (let j = 0; j < m; j++) { const a = j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  geo.setIndex(idx);
  const u = {
    uCol: { value: new THREE.Color(1, 1, 1) }, uCol2: { value: new THREE.Color(0.4, 0.6, 1) }, uAlpha: { value: 0 },
    uSharp: { value: 3.0 }, uTint: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: RIB_VERT, fragmentShader: RIB_FRAG, transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 599;
  mesh.name = 'pacelights-ribbon';
  return { mesh, geo, mat, u, pos, av, m };
}

/**
 * Ajustes por escenario (unidades del escenario: m en el estadio, u en los mundos visuales).
 *  pitch: paso entre LED · n: LED de la hilera · back: cuánto detrás de la cabeza empieza · near: [inicio, fin] del
 *  fundido junto a la cámara · led: [largo completo, ancho] · y: altura sobre el suelo · lat: 'line' | 'ghost' | número ·
 *  pair: lámparas a ±pair del camino (cordillera; 0 = una sola hilera) · I: intensidad HDR · head: realce de la
 *  cabeza · win/winK/winMax: largo de la ventana (mín., proporción de la distancia, máx.) · trail: caída de la estela ·
 *  A/s: cabeza = paso + A·(1 − e^(−(ventaja + 3)/s)) · dFar: alcance del buscador de hueco · passFallback: línea de
 *  paso si el HUD no deja hueco · gapPx: píxeles mínimos entre LED antes de pasar a la octava siguiente ·
 *  rib: cinta { len, w, flat, latOff, y, I, sharp, minPx } o null · refl: reflejo { I, stretch } o null ·
 *  col/col2: ventana / estela (sRGB) · gold: oro (sRGB, más ámbar que el del HUD: el ACES lo aclara hasta el oro del
 *  chip; el #ffd60a salía crema) · base: luz de reposo de los LED apagados · restSpan: caída del reposo dorado pasada
 *  la línea de paso · depth: prueba de profundidad (la montaña los tapa) · ePow: conservación de energía bajo pxMin ·
 *  close: [d0, d1, k] exposición de los LED muy cercanos (el bloom los hincharía) · ro: renderOrder (por defecto 600).
 */
export const LOOKS = {
  estadio: {
    pitch: 0.5, n: 120, back: 36, near: [1.0, 4.0], led: [0.16, 0.04], y: 0.045, lat: 'line', latOff: -0.16, pair: 0,
    I: 2.05, head: 1.2, halo: 0.22, win: 6, winK: 0.5, winMax: 16, trail: 5.0, A: 14, s: 15, dFar: 70, passFallback: 15, gapPx: 1,
    rib: { len: 30, w: 0.8, flat: true, latOff: -0.05, y: 0.004, I: 0.2, sharp: 2.6 }, refl: { I: 0.3, stretch: 2.6 },
    col: '#e4efff', col2: '#4f9cff', gold: '#ffb21f', base: 0.9, baseSpan: 30, restSpan: 12, depth: false, pxMin: 1.8, ePow: 0.8, close: [3, 12, 0.55],
  },
  aurora: {
    pitch: 2.4, n: 110, back: 90, near: [2.5, 9], led: [0.5, 0.03], y: 0.12, lat: 'ghost', latOff: 0, pair: 0,
    I: 2.8, head: 0.6, halo: 0.22, win: 18, winK: 0, winMax: 18, trail: 18, A: 105, s: 45, dFar: 260, passFallback: 6, gapPx: 1,
    rib: { len: 70, w: 0.05, flat: false, latOff: 0, y: 0.12, I: 1.0, sharp: 2.4, minPx: 1.6 }, refl: null,
    col: '#eafff8', col2: '#36dcb4', gold: '#ffb347', base: 0.0, baseSpan: 0, restSpan: 30, depth: false, pxMin: 1.6, ePow: 0.85, close: [8, 40, 0.45],
    ro: 15,
  },
  cordillera: {
    pitch: 1.2, n: 120, back: 110, near: [4, 12], led: [0.28, 0.1], y: 0.32, lat: 0, latOff: 0, pair: 0.7,
    I: 3.2, head: 1.3, halo: 0.24, win: 16, winK: 0.32, winMax: 48, trail: 20, A: 110, s: 25, dFar: 220, passFallback: 18, gapPx: 0.75,
    rib: null, refl: null,
    col: '#f2f8ff', col2: '#7fb8ff', gold: '#ffb54d', base: 0.35, baseSpan: 40, restSpan: 20, depth: true, pxMin: 2.0, ePow: 0.8, close: [14, 45, 0.5],
  },
  blank: {
    pitch: 1.25, n: 120, back: 50, near: [3, 9], led: [0.42, 0.04], y: 0.012, lat: 0, latOff: 0, pair: 0,
    I: 3.6, head: 1.8, halo: 0.22, win: 12, winK: 0, winMax: 12, trail: 7, A: 110, s: 45, dFar: 160, passFallback: 5, gapPx: 1,
    rib: { len: 34, w: 0.3, flat: true, latOff: 0, y: 0.006, I: 0.16, sharp: 2.8 }, refl: null,
    col: '#eef9ff', col2: '#4fb6ff', gold: '#ffb347', base: 0.5, baseSpan: 40, restSpan: 20, depth: false, pxMin: 1.8, ePow: 0.4, flat: true, close: [6, 40, 0.2],
  },
};
/** Píxeles CSS mínimos entre LED por calidad (× gapPx del escenario). */
export const GAP_PX = { high: 6, med: 7, low: 8, eco: 6 };
