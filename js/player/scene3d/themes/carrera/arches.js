// CARRERA · arcos de la carrera en UNA llamada de dibujo: tres huecos instanciados (los tres próximos arcos) con dos
// geometrías en la misma malla — el HINCHABLE (SALIDA, KM n, MITAD, ÚLTIMO KM: tubo negro de vinilo con un filete
// naranja #FF5A1F, pancarta del atlas y, en la SALIDA, reloj) y el PÓRTICO de la META (pilares de celosía, viga con
// «META», reloj de cronometraje y una fila de focos). Cada hueco elige su geometría con su tipo; el resto se colapsa.
// El reloj es de siete segmentos en el shader (rojo LED; cero texturas por segundo): cuenta atrás hasta la salida y
// después el tiempo de carrera (t − salida) en m:ss o h:mm:ss; al cruzar la meta se queda con TU tiempo.
import { SHARED_DECL, BEND, LAMPS, DEFINES } from './common.js';

export const SLOTS = 3;

// medidas (m)
const IW = 8.15;      // semiancho del hinchable a sus pies
const IH = 6.0;       // altura del eje del tubo en la clave
const TR = 0.62;      // radio del tubo
const BAN_I = { y: 6.05, w: 9.0, h: 1.7, z: 0.72, d: 0.26 };
const CLK_I = { y: 7.55, w: 3.3, h: 0.98, z: 0.5, d: 0.5 };
const GX = 8.45;      // pilares del pórtico
const BEAM = { y: 7.9, w: 18.3, h: 2.5, d: 0.9 };
const CLK_G = { y: 9.95, w: 5.4, h: 1.32, d: 0.62 };
export const ASPECT = { inflable: CLK_I.w / CLK_I.h, portico: CLK_G.w / CLK_G.h };

const ARCH_VERT = /* glsl */ `
${SHARED_DECL}
${BEND}
${LAMPS}
attribute vec4 aA;      // parte, tipo de arco (0 hinchable · 1 pórtico), u, v
uniform vec4 uArch[${SLOTS}];   // z, tipo, fila del atlas, reloj (0/1)
uniform vec4 uArchB[${SLOTS}];  // segundos del reloj, luz propia de la pancarta, -, -
varying vec4 vA;
varying vec3 vN;
varying vec3 vW;
varying vec3 vP;
varying float vE;
varying float vRow;
varying float vSecs;
varying float vBan;
varying float vAv;
void main() {
  vec4 A = uArch[gl_InstanceID];
  vec4 B = uArchB[gl_InstanceID];
  bool on = abs(aA.y - A.y) < 0.5 && A.x < 1e4;
  if (aA.x > 2.5 && aA.x < 3.5 && A.w < 0.5) on = false;      // sin reloj
  if (aA.x > 3.5 && aA.x < 4.5 && aA.y < 0.5 && A.w < 0.5) on = false;  // caja del reloj del hinchable
  vec3 p = position + vec3(0.0, 0.0, A.x);
  vA = aA;
  vN = normal;
  vP = p;
  vRow = A.z;
  vSecs = B.x;
  vBan = B.y;
  float sP = uSLo - p.z;
  vE = lampsAt(p, normal, sP) * uLight + metaLight(p) * 0.6;
  vec3 w = bendW(p);
  vW = w;
  vec4 cl = projectionMatrix * viewMatrix * vec4(w, 1.0);
  // composición: los focos del pórtico, atenuados mientras pasan justo detrás del número de velocidad
  vec2 nd = cl.xy / max(cl.w, 1e-3);
  float inside = smoothstep(uAvoid.x - 0.08, uAvoid.x + 0.04, nd.x) * (1.0 - smoothstep(uAvoid.z - 0.04, uAvoid.z + 0.08, nd.x))
    * smoothstep(uAvoid.y - 0.1, uAvoid.y + 0.04, nd.y) * (1.0 - smoothstep(uAvoid.w - 0.04, uAvoid.w + 0.1, nd.y));
  vAv = 1.0 - 0.6 * inside;
  gl_Position = on ? cl : vec4(2.0, 2.0, 2.0, 1.0);
}`;

const ARCH_FRAG = /* glsl */ `
${SHARED_DECL}
${BEND}
uniform sampler2D uAtlas;
uniform float uRows;
uniform vec3 uOrange, uLed;
uniform vec2 uAspect;   // hinchable, pórtico
varying vec4 vA;
varying vec3 vN;
varying vec3 vW;
varying vec3 vP;
varying float vE;
varying float vRow;
varying float vSecs;
varying float vBan;
varying float vAv;

// ── reloj de siete segmentos ──
float segBox(vec2 p, vec2 c, vec2 h, float fw) {
  vec2 q = abs(p - c) - h;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.035;
  return 1.0 - smoothstep(-fw, fw, d);
}
// p en la caja del dígito [0,1]², devuelve (encendido, apagado)
vec2 digit(vec2 p, int dg, float fw) {
  p.x -= (p.y - 0.5) * 0.12;                         // cursiva de marcador
  int m = dg == 0 ? 63 : dg == 1 ? 6 : dg == 2 ? 91 : dg == 3 ? 79 : dg == 4 ? 102 : dg == 5 ? 109 : dg == 6 ? 125 : dg == 7 ? 7 : dg == 8 ? 127 : 111;
  float on = 0.0; float off = 0.0;
  vec2 H = vec2(0.3, 0.05); vec2 V = vec2(0.05, 0.17);
  float s[7];
  s[0] = segBox(p, vec2(0.5, 0.93), H, fw);
  s[1] = segBox(p, vec2(0.86, 0.715), V, fw);
  s[2] = segBox(p, vec2(0.86, 0.285), V, fw);
  s[3] = segBox(p, vec2(0.5, 0.07), H, fw);
  s[4] = segBox(p, vec2(0.14, 0.285), V, fw);
  s[5] = segBox(p, vec2(0.14, 0.715), V, fw);
  s[6] = segBox(p, vec2(0.5, 0.5), H, fw);
  for (int i = 0; i < 7; i++) {
    if (((m >> i) & 1) == 1) on = max(on, s[i]); else off = max(off, s[i]);
  }
  return vec2(on, off);
}
vec2 clockFace(vec2 uv, float aspect, float secs) {
  float t = floor(max(secs, 0.0) + 0.001);
  int hh = int(floor(t / 3600.0));
  int mm = int(floor(mod(t, 3600.0) / 60.0));
  int ss = int(mod(t, 60.0));
  // glifos: dígitos (ancho 0,56) y dos puntos (0,24), en unidades del alto del glifo
  int g[7]; int n = 0;
  if (hh > 0) { g[0] = hh % 10; g[1] = -1; g[2] = mm / 10; g[3] = mm % 10; g[4] = -1; g[5] = ss / 10; g[6] = ss % 10; n = 7; }
  else if (mm >= 10) { g[0] = mm / 10; g[1] = mm % 10; g[2] = -1; g[3] = ss / 10; g[4] = ss % 10; n = 5; }
  else { g[0] = mm; g[1] = -1; g[2] = ss / 10; g[3] = ss % 10; n = 4; }
  float gh = 0.74;
  float dw = 0.56 * gh; float cw = 0.26 * gh; float gap = 0.1 * gh;
  float total = 0.0;
  for (int i = 0; i < 7; i++) { if (i < n) total += (g[i] < 0 ? cw : dw) + (i > 0 ? gap : 0.0); }
  vec2 q = vec2(uv.x * aspect, uv.y);
  float x0 = aspect * 0.5 - total * 0.5;
  float y0 = 0.5 - gh * 0.5;
  float fw = max(fwidth(q.y) / gh, 1e-4);
  vec2 r = vec2(0.0);
  float x = x0;
  for (int i = 0; i < 7; i++) {
    if (i >= n) break;
    if (i > 0) x += gap;
    float w = g[i] < 0 ? cw : dw;
    vec2 p = vec2((q.x - x) / w, (q.y - y0) / gh);
    if (p.x > -0.2 && p.x < 1.2) {
      if (g[i] < 0) {
        float d1 = length((p - vec2(0.5, 0.3)) * vec2(w / gh, 1.0)) - 0.065;
        float d2 = length((p - vec2(0.5, 0.7)) * vec2(w / gh, 1.0)) - 0.065;
        r.x = max(r.x, 1.0 - smoothstep(-fw, fw, min(d1, d2)));
      } else {
        vec2 pp = vec2(p.x, p.y);
        vec2 dd = digit(vec2(pp.x, pp.y), g[i], fw * 1.2);
        r = max(r, dd);
      }
    }
    x += w;
  }
  return r;
}

void main() {
  float part = vA.x;
  float kind = vA.y;
  vec3 N = normalize(vN);
  float dist = length(vW - cameraPosition);
  vec3 col;
  float E = vE;
  if (part < 0.5) {
    // hinchable: vinilo negro satinado con un filete naranja en la cara que mira a los corredores
    float stripe = smoothstep(0.972, 0.985, N.z);
    vec3 base = mix(vec3(0.01, 0.01, 0.012), uOrange * 0.5, stripe);
    float gloss = pow(max(dot(N, normalize(vec3(0.0, 0.8, 0.6))), 0.0), 18.0);
    col = base * (0.18 + E * uLampCol * 0.9) + uLampCol * gloss * (0.03 + 0.05 * E);
  } else if (part < 1.5) {
    // pancarta (atlas): iluminada por sus propios focos, sin llegar al umbral del bloom
    vec2 uv = vec2(vA.z, 1.0 - (vRow + 1.0 - vA.w) / uRows);
    vec3 tex = texture2D(uAtlas, uv).rgb;
    col = tex * (vBan + 0.25 * min(E, 1.5) * uLampCol);
  } else if (part < 2.5) {
    col = vec3(0.01, 0.01, 0.012) * (0.3 + E * uLampCol);
  } else if (part < 3.5) {
    // reloj de cronometraje
    float asp = kind < 0.5 ? uAspect.x : uAspect.y;
    vec2 r = clockFace(vA.zw, asp, vSecs);
    col = vec3(0.004, 0.003, 0.003) + uLed * (r.x * 3.2 * exp(-dist * 0.0016) + r.y * 0.012);
    gl_FragColor = vec4(mix(col, uFogCol, fogK(dist) * 0.6), 1.0);
    return;
  } else if (part < 4.5) {
    col = vec3(0.012, 0.012, 0.014) * (0.3 + E * uLampCol);
  } else if (part < 5.5) {
    // celosía de aluminio de los pilares del pórtico
    float a = vA.z * 6.0; float b = vA.w * 14.0;
    float lat = max(1.0 - smoothstep(0.0, 0.12, abs(fract(b + a) - 0.5) - 0.38), 1.0 - smoothstep(0.0, 0.12, abs(fract(b - a) - 0.5) - 0.38));
    float edge = max(step(abs(vA.z - 0.5), 0.5) * (1.0 - smoothstep(0.03, 0.08, min(vA.z, 1.0 - vA.z))), 0.0);
    float m = max(lat, edge);
    col = mix(vec3(0.004), vec3(0.2, 0.2, 0.21) * (0.25 + E * uLampCol + 0.8 * uMetaK), m);
  } else {
    // focos del pórtico (emisivos)
    col = vec3(1.0, 0.93, 0.82) * 3.4 * uMetaK * exp(-dist * 0.0012) * vAv;
    gl_FragColor = vec4(col, 1.0);
    return;
  }
  col = mix(col, col * vec3(1.2, 0.95, 0.62) * 1.3, uGold * 0.6);
  col = mix(col, uFogCol, fogK(dist));
  gl_FragColor = vec4(col, 1.0);
}`;

function pushBox(G, cx, cy, cz, sx, sy, sz, kind, partOf) {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const faces = [
    [[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]],
    [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]],
    [[0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]]],
    [[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]],
    [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
    [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]],
  ];
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const [n, vs] of faces) {
    const b = G.P.length / 3;
    const part = partOf(n);
    vs.forEach((v, i) => {
      G.P.push(cx + v[0], cy + v[1], cz + v[2]);
      G.N.push(n[0], n[1], n[2]);
      // celosía: u a lo ancho de la cara, v a lo alto (en metros/escala del pilar)
      const uu = uvs[i][0];
      const vv = part === 5 ? (cy + v[1]) / 9 : uvs[i][1];
      G.A.push(part, kind, uu, vv);
    });
    G.I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
}

/** Tubo hinchable: semielipse de (−IW, 0) a (IW, 0) con clave a IH; radio TR. */
function pushTube(G) {
  const NA = 44;
  const NR = 14;
  const base = G.P.length / 3;
  for (let i = 0; i <= NA; i++) {
    const a = Math.PI * (i / NA);
    const cx = -IW * Math.cos(a);
    const cy = Math.max(0, IH * Math.sin(a));
    // tangente y normal de la curva en el plano xy
    let tx = IW * Math.sin(a);
    let ty = IH * Math.cos(a);
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const nx = -ty;
    const ny = tx;
    for (let j = 0; j <= NR; j++) {
      const b = (2 * Math.PI * j) / NR;
      const ox = Math.cos(b) * nx;
      const oy = Math.cos(b) * ny;
      const oz = Math.sin(b);
      // el tubo se aplasta un poco hacia los pies (como los hinchables reales, más gruesos en la base)
      const r = TR * (1 + 0.12 * (1 - Math.sin(a)));
      G.P.push(cx + ox * r, Math.max(-0.05, cy + oy * r), oz * r);
      G.N.push(ox, oy, oz);
      G.A.push(0, 0, i / NA, j / NR);
    }
  }
  for (let i = 0; i < NA; i++) {
    for (let j = 0; j < NR; j++) {
      const a = base + i * (NR + 1) + j;
      const b = a + NR + 1;
      G.I.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
}

export function buildArches(THREE, shared, atlas) {
  const G = { P: [], N: [], A: [], I: [] };
  // ── hinchable ──
  pushTube(G);
  pushBox(G, 0, BAN_I.y, BAN_I.z, BAN_I.w, BAN_I.h, BAN_I.d, 0, (n) => (n[2] > 0.5 ? 1 : 2));
  pushBox(G, 0, CLK_I.y, CLK_I.z, CLK_I.w, CLK_I.h, CLK_I.d, 0, (n) => (n[2] > 0.5 ? 3 : 4));
  for (const s of [-1, 1]) pushBox(G, s * IW, 0.22, 0, 1.5, 0.44, 1.5, 0, () => 2);
  // ── pórtico de la META ──
  for (const s of [-1, 1]) pushBox(G, s * GX, 4.5, 0, 0.72, 9.0, 0.72, 1, () => 5);
  pushBox(G, 0, BEAM.y, 0, BEAM.w, BEAM.h, BEAM.d, 1, (n) => (n[2] > 0.5 ? 1 : 2));
  pushBox(G, 0, CLK_G.y, 0.1, CLK_G.w, CLK_G.h, CLK_G.d, 1, (n) => (n[2] > 0.5 ? 3 : 4));
  // patas del reloj sobre la viga
  for (const s of [-1, 1]) pushBox(G, s * 1.8, (BEAM.y + BEAM.h / 2 + CLK_G.y - CLK_G.h / 2) / 2, 0.1, 0.16, CLK_G.y - CLK_G.h / 2 - BEAM.y - BEAM.h / 2 + 0.05, 0.16, 1, () => 2);
  // fila de focos bajo la viga, mirando a la línea
  for (let i = 0; i < 8; i++) {
    const x = -7.0 + 2.0 * i;
    pushBox(G, x, BEAM.y - BEAM.h / 2 - 0.2, 0.32, 0.55, 0.3, 0.36, 1, (n) => (n[1] < -0.5 || n[2] > 0.5 ? 6 : 2));
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(G.P), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(G.N), 3));
  geo.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(G.A), 4));
  geo.setIndex(G.I);
  geo.instanceCount = SLOTS;
  const arch = [];
  const archB = [];
  for (let i = 0; i < SLOTS; i++) { arch.push(new THREE.Vector4(1e5, 0, i, 0)); archB.push(new THREE.Vector4(0, 0.4, 0, 0)); }
  const u = {
    ...shared,
    uArch: { value: arch }, uArchB: { value: archB },
    uAtlas: { value: atlas.texture }, uRows: { value: atlas.rows },
    uOrange: { value: new THREE.Color('#FF5A1F') },
    uLed: { value: new THREE.Color().setRGB(1.0, 0.13, 0.04) },
    uAspect: { value: new THREE.Vector2(ASPECT.inflable, ASPECT.portico) },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: ARCH_VERT, fragmentShader: ARCH_FRAG, defines: DEFINES, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, u, arch, archB };
}
