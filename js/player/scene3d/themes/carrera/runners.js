// CARRERA · los otros corredores: un maniquí atlético de volúmenes lisos (tronco, caderas, cabeza, muslos, piernas,
// zapatillas, brazos y manos en cápsulas con normales suaves) instanciado en una sola llamada. La zancada se anima en el
// VERTEX SHADER: cadera, rodilla, hombro y codo giran alrededor de sus pivotes con la fase de cada uno, el tronco se
// inclina y gira al contrario que la cadera y hay dos rebotes por ciclo. La luz es de la avenida (farolas y focos de
// meta) más un contraluz en el canto que los recorta contra el fondo; por detrás llevan su dorsal con número.
// Una segunda llamada los apoya en el suelo: sombra de contacto y el reflejo de su camiseta en el asfalto mojado.
// Cada corredor va a una velocidad un poco distinta de la tuya (δ entre −9 % y +9 %): su distancia relativa es
// off + δ · (tus metros reales), envuelta en una ventana de 200 m (de 30 m detrás a 170 m delante; al envolver están
// detrás de ti o perdidos en la bruma), así que les ganas y te ganan de verdad, en función pura del reloj (capturas
// deterministas). Nunca van por tu trazada (|x − tú| ≥ 1,6 m): la línea azul queda libre y sus cabezas, a tu altura de
// ojos, no suben por encima del horizonte (el número del HUD va siempre en el cielo).
import { SHARED_DECL, BEND, LAMPS, CAM_X, DEFINES } from './common.js';

const WIN = 200;
const BACK = 30;

// distancia relativa y fundido al envolver: lo comparten el cuerpo y su apoyo en el suelo
const PLACE = /* glsl */ `
attribute vec4 aR;    // x lateral, desfase (m), δ, fase
attribute vec4 aR2;   // camiseta (0..1), escala, mallas (0/1), piel (0..1)
uniform float uDm, uStride, uAmp, uAdv, uMotionK;
float relOf() { return mod(aR.y + aR.z * uDm + uAdv * (1.0 + aR.z), ${WIN.toFixed(1)}) - ${BACK.toFixed(1)}; }
float wrapFade(float rel) { return smoothstep(${(WIN - BACK - 40).toFixed(1)}, ${(WIN - BACK - 4).toFixed(1)}, rel); }
`;

/** La zancada: gira cada pieza alrededor de su articulación (J = aJ; A = amplitud; ph = fase en radianes). */
export const RUN_POSE = /* glsl */ `
vec3 rotX(vec3 v, float a) { float c = cos(a); float s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
vec3 rotY(vec3 v, float a) { float c = cos(a); float s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
void runnerPose(inout vec3 p, inout vec3 n, vec4 J, float A, float ph) {
  vec3 p0 = p;
  float side = J.y;
  float phs = ph + (side > 0.0 ? 3.14159 : 0.0);
  if (J.x > 1.5 && J.x < 2.5) {
    // brazo: balanceo opuesto a la pierna del mismo lado, codo doblado ~85° y algo cerrado hacia el pecho
    vec3 sh = vec3(side * 0.205, 1.44, 0.0);
    vec3 el = vec3(side * 0.205, 1.17, 0.0);
    float aU = -0.78 * A * sin(phs) - 0.1;
    float aE = 1.3 + 0.32 * A * sin(phs);
    if (J.z > 0.5) { p = el + rotX(p - el, aE); n = rotX(n, aE); p.x -= side * 0.03 * (el.y - p0.y) / 0.25; }
    p = sh + rotX(p - sh, aU); n = rotX(n, aU);
  } else if (J.x > 0.5 && J.x < 1.5) {
    // pierna: la cadera barre adelante y atrás; la rodilla se recoge tras el despegue
    vec3 hip = vec3(side * 0.088, 0.92, 0.0);
    vec3 kn = vec3(side * 0.088, 0.48, 0.0);
    float th = A * (0.12 + 0.62 * sin(phs));
    float fk = -A * (0.24 + 1.3 * pow(max(0.0, cos(phs + 0.35)), 1.3));
    if (J.z > 0.5) { p = kn + rotX(p - kn, fk); n = rotX(n, fk); }
    p = hip + rotX(p - hip, th); n = rotX(n, th);
  }
  // tronco, brazos y cabeza: inclinados hacia delante y girando al contrario que la cadera (más arriba, más giro)
  if (J.x < 0.5 || J.x > 1.5) {
    float up = clamp((p0.y - 0.95) / 0.5, 0.0, 1.0);
    float tw = 0.2 * A * sin(ph) * up * (J.x > 2.5 ? 0.25 : 1.0);
    p = rotY(p, tw); n = rotY(n, tw);
    vec3 pv = vec3(0.0, 0.92, 0.0);
    float lean = -0.13 * A - 0.03;
    p = pv + rotX(p - pv, lean); n = rotX(n, lean);
  }
  p.y += 0.04 * A * cos(2.0 * ph);
  p.x += 0.012 * A * sin(ph);
}
`;

/** El color de cada pieza (camiseta con dorsal y número, pantalón, piel, pelo o gorra, zapatillas, mallas). */
export const RUN_ALBEDO = /* glsl */ `
float hash1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
// un dígito de siete segmentos en la celda uv (0..1)
float digit(vec2 uv, float n) {
  const int M[10] = int[10](119, 36, 93, 109, 46, 107, 123, 37, 127, 111);
  int m = M[int(clamp(floor(n), 0.0, 9.0))];
  float t = 0.17;
  float s = 0.0;
  float inX = step(0.12, uv.x) * step(uv.x, 0.88);
  if ((m & 1) != 0) s = max(s, step(1.0 - t, uv.y) * inX);
  if ((m & 8) != 0) s = max(s, step(abs(uv.y - 0.5), t * 0.5) * inX);
  if ((m & 64) != 0) s = max(s, step(uv.y, t) * inX);
  if ((m & 2) != 0) s = max(s, step(uv.x, t + 0.06) * step(0.5, uv.y));
  if ((m & 4) != 0) s = max(s, step(1.0 - t - 0.06, uv.x) * step(0.5, uv.y));
  if ((m & 16) != 0) s = max(s, step(uv.x, t + 0.06) * step(uv.y, 0.5));
  if ((m & 32) != 0) s = max(s, step(1.0 - t - 0.06, uv.x) * step(uv.y, 0.5));
  return s * step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
}
// cls: 0 camiseta · 1 pantalón · 2 piel · 3 pelo o gorra · 4 zapatillas · 5 pierna (piel o mallas). P = posición en reposo.
vec3 runnerAlbedo(float cls, vec3 P, vec3 shirt, vec3 shoeAlt, vec3 skin, float tights, vec2 rnd) {
  vec3 c = shirt;
  if (cls < 0.5) {
    // dorsal (dos de cada tres lo llevan a la vista), por delante y por detrás: papel claro con su número
    float fw = fwidth(P.x) + 1e-4;
    float bx = 1.0 - smoothstep(0.086 - fw, 0.086 + fw, abs(P.x));
    float by = smoothstep(1.125 - fw, 1.125 + fw, P.y) * (1.0 - smoothstep(1.275 - fw, 1.275 + fw, P.y));
    float bib = bx * by * step(0.03, abs(P.z)) * step(rnd.y, 0.66);
    float sx = P.z > 0.0 ? P.x : -P.x;       // el número se lee derecho por los dos lados
    vec2 q = vec2((sx + 0.07) / 0.14, (P.y - 1.15) / 0.1);
    float cell = floor(q.x * 3.0);
    float ink = digit(vec2(fract(q.x * 3.0) * 1.25 - 0.125, q.y), floor(hash1(rnd.x * 37.0 + cell * 5.3) * 10.0)) * step(0.0, q.x) * step(q.x, 1.0);
    c = mix(c, mix(vec3(0.62, 0.61, 0.58), vec3(0.03), ink), bib);
    // costuras laterales algo más oscuras: la camiseta deja de ser un color plano
    c *= 0.86 + 0.14 * smoothstep(0.06, 0.13, abs(P.x) + 0.02);
  } else if (cls < 1.5) {
    c = mix(vec3(0.018, 0.018, 0.022), shirt * 0.22, step(0.8, rnd.y));
  } else if (cls < 2.5) {
    c = skin;
  } else if (cls < 3.5) {
    // pelo (del negro al castaño claro) o gorra del color de la camiseta
    vec3 hair = mix(vec3(0.016, 0.012, 0.01), vec3(0.16, 0.1, 0.045), smoothstep(0.55, 1.0, rnd.x));
    c = mix(hair, mix(vec3(0.5), shirt, 0.6), step(0.72, rnd.y));
  } else if (cls < 4.5) {
    // zapatillas claras, a veces de color vivo; suela oscura
    c = mix(vec3(0.03), mix(vec3(0.42, 0.42, 0.44), shoeAlt, step(0.5, rnd.x)), smoothstep(0.012, 0.03, P.y));
  } else {
    c = mix(skin, vec3(0.015), tights);
  }
  return c;
}
`;

const RUN_VERT = /* glsl */ `
${SHARED_DECL}
${BEND}
${LAMPS}
${PLACE}
attribute vec4 aJ;    // tipo (0 tronco · 1 pierna · 2 brazo · 3 cabeza), lado (±1), segmento (0 superior · 1 inferior), clase de color
varying vec3 vLight;
varying vec3 vRim;
varying vec3 vP;
varying vec4 vInfo;   // clase, camiseta, mallas, piel
varying vec2 vRnd;
varying float vFade;

${RUN_POSE}
void main() {
  float d = aR.z;
  float rel = relOf();
  float A = uAmp * (0.85 + 0.3 * fract(aR.w * 7.3));
  float ph = (uStride * (1.0 + 0.5 * d) + aR.w) * 6.28318;
  vec3 p = position;
  vec3 n = normal;
  vP = position;
  runnerPose(p, n, aJ, A, ph);
  p *= aR2.y;
  vec3 wp = vec3(aR.x, 0.0, -rel) + p;
  vec3 N = normalize(n);
  float sP = uSLo + rel;
  float E = lampsAt(wp, N, sP) * uLight + metaLight(wp);
  // luz: farolas + cielo + un contraluz frío desde delante (los corredores se recortan contra la avenida iluminada)
  float back = max(-N.z, 0.0);
  // oclusión barata: entre las piernas y bajo los brazos llega menos luz
  float occ = 0.72 + 0.28 * smoothstep(0.0, 0.16, abs(position.x));
  vLight = (vec3(0.05 + 0.08 * max(N.y, 0.0) + back * 0.04) + E * uLampCol * 0.9) * occ;
  vLight = mix(vLight, vLight * vec3(1.2, 0.95, 0.65) * 1.3, uGold * 0.6);
  vec3 w = bendW(wp);
  vec3 V = normalize(cameraPosition - w);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6) * (0.4 + 0.6 * max(N.y * 0.5 + 0.5, 0.0));
  vRim = mix(uLampCol, vec3(1.0, 0.86, 0.6), uGold) * rim * (0.07 + 0.05 * min(E, 2.0)) * uLight;
  float dist = length(w - cameraPosition);
  vFade = max(fogK(dist), wrapFade(rel));
  vInfo = vec4(aJ.w, aR2.x, aR2.z, aR2.w);
  vRnd = vec2(aR.w, fract(aR.w * 91.7 + aR2.x * 13.1));
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const RUN_FRAG = /* glsl */ `
${SHARED_DECL}
uniform vec3 uShirt[9];
varying vec3 vLight;
varying vec3 vRim;
varying vec3 vP;
varying vec4 vInfo;
varying vec2 vRnd;
varying float vFade;

${RUN_ALBEDO}
void main() {
  int si = int(floor(clamp(vInfo.y, 0.0, 0.999) * 9.0));
  vec3 skin = mix(vec3(0.32, 0.2, 0.14), vec3(0.08, 0.05, 0.035), vInfo.w);
  vec3 c = runnerAlbedo(vInfo.x, vP, uShirt[si], uShirt[int(floor(vRnd.y * 8.99))] * 1.6 + 0.06, skin, vInfo.z, vRnd);
  vec3 col = c * vLight + vRim;
  col = mix(col, uFogCol, vFade);
  if (col.r != col.r || col.g != col.g || col.b != col.b) col = uFogCol;
  gl_FragColor = vec4(col, 1.0);
}`;

// apoyo en el suelo: sombra de contacto bajo los pies y el reflejo de la camiseta estirado hacia la cámara (asfalto mojado)
const GND_VERT = /* glsl */ `
${SHARED_DECL}
${BEND}
${PLACE}
varying vec2 vUv;
varying float vFade;
varying float vShirt;
void main() {
  float rel = relOf();
  vUv = uv;
  vec3 wp = vec3(aR.x + position.x * aR2.y, 0.016, -rel + position.z * aR2.y);
  vec3 w = bendW(wp);
  vFade = max(fogK(length(w - cameraPosition)), wrapFade(rel));
  vShirt = aR2.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const GND_FRAG = /* glsl */ `
${SHARED_DECL}
uniform vec3 uShirt[9];
varying vec2 vUv;
varying float vFade;
varying float vShirt;
void main() {
  float x = (vUv.x - 0.5) * 2.0;
  float y = vUv.y;                                   // 0 por delante de los pies → 1 hacia la cámara
  float dz = (y - 0.16) / 0.11;
  float shadow = 0.8 * exp(-(x * x * 2.4 + dz * dz));
  float streak = exp(-x * x * 5.0) * smoothstep(0.14, 0.26, y) * pow(max(1.0 - y, 0.0), 1.6);
  vec3 shirt = uShirt[int(floor(clamp(vShirt, 0.0, 0.999) * 9.0))];
  vec3 refl = (shirt * 0.5 + 0.012) * streak * 0.16 * uLight;
  float k = 1.0 - vFade;
  vec3 rgb = refl * k;
  if (rgb.r != rgb.r || rgb.g != rgb.g || rgb.b != rgb.b) rgb = vec3(0.0);
  gl_FragColor = vec4(rgb, shadow * k);            // premultiplicado: suma el reflejo y oscurece el suelo con la sombra
}`;

/** Volumen de revolución con secciones elípticas a lo largo de Y, tapas incluidas y normales suaves. */
function lathe(THREE, out, sections, N, j) {
  const pos = [];
  const idx = [];
  for (const s of sections) {
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      pos.push((s.cx || 0) + s.rx * Math.cos(a), s.y, (s.cz || 0) + s.rz * Math.sin(a));
    }
  }
  const R = sections.length;
  for (let i = 0; i < R - 1; i++) {
    for (let k = 0; k < N; k++) {
      const a = i * N + k, b = i * N + ((k + 1) % N), c = (i + 1) * N + k, d = (i + 1) * N + ((k + 1) % N);
      // las secciones van de arriba abajo: caras hacia fuera
      idx.push(a, b, c, b, d, c);
    }
  }
  const top = sections[0], bot = sections[R - 1];
  const t = pos.length / 3;
  pos.push(top.cx || 0, top.y + (top.cap ?? 0), top.cz || 0);
  const b0 = pos.length / 3;
  pos.push(bot.cx || 0, bot.y - (bot.cap ?? 0), bot.cz || 0);
  for (let k = 0; k < N; k++) {
    idx.push(t, (k + 1) % N, k);
    idx.push(b0, (R - 1) * N + k, (R - 1) * N + ((k + 1) % N));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nrm = g.attributes.normal.array;
  const base = out.P.length / 3;
  for (let i = 0; i < pos.length / 3; i++) {
    out.P.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    out.N.push(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
    const jj = typeof j === 'function' ? j(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) : j;
    out.J.push(jj[0], jj[1], jj[2], jj[3]);
  }
  for (const i of idx) out.I.push(base + i);
  g.dispose();
}

/** Cápsula vertical que se afina: de (yTop, rTop) a (yBot, rBot), con los extremos redondeados. */
function limb(THREE, out, cx, yTop, yBot, rTop, rBot, N, j, { cz = 0, flat = 0.92, mid = null } = {}) {
  const s = [
    { y: yTop + rTop * 0.5, rx: rTop * 0.62, rz: rTop * 0.62 * flat, cx, cz, cap: rTop * 0.22 },
    { y: yTop, rx: rTop, rz: rTop * flat, cx, cz },
  ];
  if (mid) s.push({ y: mid.y, rx: mid.r, rz: mid.r * flat, cx, cz: cz + (mid.dz || 0) });
  s.push({ y: yBot, rx: rBot, rz: rBot * flat, cx, cz });
  s.push({ y: yBot - rBot * 0.5, rx: rBot * 0.62, rz: rBot * 0.62 * flat, cx, cz, cap: rBot * 0.22 });
  lathe(THREE, out, s, N, j);
}

/** El maniquí en reposo (mira a −z): posiciones, normales, aJ (tipo, lado, segmento, clase de color) e índices. */
export function runnerParts(THREE) {
  const out = { P: [], N: [], J: [], I: [] };
  // (corre hacia −z: le vemos la espalda)
  // tronco (camiseta): hombros anchos, cintura estrecha, algo más plano de espalda a pecho
  lathe(THREE, out, [
    { y: 1.5, rx: 0.07, rz: 0.06, cap: 0.012 },
    { y: 1.475, rx: 0.12, rz: 0.08 },
    { y: 1.43, rx: 0.17, rz: 0.098 },
    { y: 1.33, rx: 0.174, rz: 0.112 },
    { y: 1.2, rx: 0.156, rz: 0.104 },
    { y: 1.07, rx: 0.13, rz: 0.091 },
    { y: 0.98, rx: 0.134, rz: 0.093, cap: 0.01 },
  ], 10, [0, 0, 0, 0]);
  // caderas (pantalón)
  lathe(THREE, out, [
    { y: 1.0, rx: 0.136, rz: 0.095, cap: 0.0 },
    { y: 0.92, rx: 0.142, rz: 0.102 },
    { y: 0.84, rx: 0.124, rz: 0.096, cap: 0.03 },
  ], 10, [0, 0, 0, 1]);
  // cuello y cabeza (por detrás, pelo o gorra; cara y nuca, piel)
  limb(THREE, out, 0, 1.57, 1.49, 0.046, 0.05, 6, [3, 0, 0, 2], { cz: -0.008, flat: 1 });
  {
    const sg = new THREE.SphereGeometry(1, 10, 8);
    const sp = sg.attributes.position.array;
    const sn = sg.attributes.normal.array;
    const b = out.P.length / 3;
    for (let i = 0; i < sp.length; i += 3) {
      const x = sp[i] * 0.092, y = 1.665 + sp[i + 1] * 0.114, z = -0.015 + sp[i + 2] * 0.103;
      out.P.push(x, y, z);
      out.N.push(sn[i], sn[i + 1], sn[i + 2]);
      out.J.push(3, 0, 0, z < -0.045 && y < 1.71 ? 2 : y < 1.6 ? 2 : 3);
    }
    for (const i of sg.index.array) out.I.push(b + i);
    sg.dispose();
  }
  for (const s of [-1, 1]) {
    const hx = s * 0.088;
    limb(THREE, out, hx, 0.93, 0.7, 0.079, 0.07, 7, [1, s, 0, 1]);                                      // muslo (pantalón corto)
    limb(THREE, out, hx, 0.72, 0.48, 0.067, 0.053, 7, [1, s, 0, 5]);                                    // muslo
    limb(THREE, out, hx, 0.5, 0.1, 0.052, 0.035, 7, [1, s, 1, 5], { mid: { y: 0.36, r: 0.057, dz: 0.012 } }); // pierna, con gemelo
    lathe(THREE, out, [                                                                               // zapatilla
      { y: 0.1, rx: 0.036, rz: 0.06, cx: hx, cz: 0.012, cap: 0.004 },
      { y: 0.07, rx: 0.046, rz: 0.118, cx: hx, cz: -0.045 },
      { y: 0.035, rx: 0.05, rz: 0.14, cx: hx, cz: -0.055 },
      { y: 0.006, rx: 0.044, rz: 0.13, cx: hx, cz: -0.055, cap: 0.0 },
    ], 8, [1, s, 1, 4]);
    const ax = s * 0.205;
    limb(THREE, out, ax, 1.435, 1.32, 0.043, 0.042, 6, [2, s, 0, 0]);                                   // manga
    limb(THREE, out, ax, 1.35, 1.17, 0.042, 0.037, 6, [2, s, 0, 2]);                                    // brazo
    limb(THREE, out, ax, 1.18, 0.95, 0.036, 0.028, 6, [2, s, 1, 2]);                                    // antebrazo
    limb(THREE, out, ax, 0.945, 0.885, 0.032, 0.03, 6, [2, s, 1, 2], { flat: 0.7 });                    // mano
  }
  return out;
}

export function buildRunners(THREE, shared, rand, count = 44) {
  const out = runnerParts(THREE);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out.P), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(out.N), 3));
  geo.setAttribute('aJ', new THREE.BufferAttribute(new Float32Array(out.J), 4));
  geo.setIndex(out.I);
  const aR = new Float32Array(count * 4);
  const aR2 = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    // por los dos lados de tu trazada, nunca encima de ella
    let x;
    do { x = -6.7 + 13.4 * rand(); } while (Math.abs(x - CAM_X) < 1.6);
    const off = (i + 0.5 * rand()) * (WIN / count);
    const d = (rand() - 0.5) * 0.18 + (rand() < 0.12 ? 0.05 : 0);
    aR.set([x, off, d, rand()], i * 4);
    aR2.set([rand(), 0.93 + 0.14 * rand(), rand() < 0.3 ? 1 : 0, rand()], i * 4);
  }
  const iR = new THREE.InstancedBufferAttribute(aR, 4);
  const iR2 = new THREE.InstancedBufferAttribute(aR2, 4);
  geo.setAttribute('aR', iR);
  geo.setAttribute('aR2', iR2);
  geo.instanceCount = count;
  const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b);
  const u = {
    ...shared,
    uDm: { value: 0 }, uStride: { value: 0 }, uAmp: { value: 1 }, uAdv: { value: 0 }, uMotionK: { value: 1 },
    uShirt: {
      value: [
        lin(0.02, 0.02, 0.024), lin(0.5, 0.5, 0.5), lin(0.025, 0.04, 0.11), lin(0.32, 0.035, 0.03), lin(0.62, 0.11, 0.025),
        lin(0.13, 0.13, 0.14), lin(0.22, 0.42, 0.04), lin(0.06, 0.2, 0.45), lin(0.45, 0.09, 0.22),
      ],
    },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: RUN_VERT, fragmentShader: RUN_FRAG, defines: DEFINES });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;

  // apoyo en el suelo (hija de la malla: se añade y se quita con ella, y sigue su número de corredores)
  const gGeo = new THREE.InstancedBufferGeometry();
  const GW = 0.36, G0 = -0.42, G1 = 2.2;       // de un palmo por delante de los pies a 2,2 m hacia la cámara
  gGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-GW, 0, G0, GW, 0, G0, GW, 0, G1, -GW, 0, G1]), 3));
  gGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  gGeo.setIndex([0, 2, 1, 0, 3, 2]);
  gGeo.setAttribute('aR', iR);
  gGeo.setAttribute('aR2', iR2);
  gGeo.instanceCount = count;
  const gMat = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: GND_VERT, fragmentShader: GND_FRAG, defines: DEFINES, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide,
  });
  const ground = new THREE.Mesh(gGeo, gMat);
  ground.frustumCulled = false;
  ground.renderOrder = 2;
  ground.onBeforeRender = () => { gGeo.instanceCount = geo.instanceCount; };
  mesh.add(ground);
  return { mesh, u, count };
}
