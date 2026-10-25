// CARRERA · los otros corredores: una figura low-poly articulada (tronco, cabeza, muslos, piernas, brazos) instanciada
// en una sola llamada; la zancada se anima en el VERTEX SHADER (cadera, rodilla, hombro y codo giran alrededor de sus
// pivotes con la fase de cada uno). Cada corredor va a una velocidad un poco distinta de la tuya (δ entre −9 % y +9 %):
// su distancia relativa es off + δ · (tus metros reales), envuelta en una ventana de 200 m (de 30 m detrás a 170 m
// delante; al envolver están detrás de ti o perdidos en la bruma), así que les ganas y te ganan de verdad, en función
// pura del reloj (capturas deterministas). Nunca van por tu trazada (|x − tú| ≥ 1,6 m): la línea azul queda libre y sus
// cabezas, a tu altura de ojos, no suben por encima del horizonte (el número del HUD va siempre en el cielo).
import { SHARED_DECL, BEND, LAMPS, CAM_X, DEFINES } from './common.js';

const WIN = 200;
const BACK = 30;

const RUN_VERT = /* glsl */ `
${SHARED_DECL}
${BEND}
${LAMPS}
attribute vec4 aJ;    // tipo (0 tronco · 1 pierna · 2 brazo), lado (±1), segmento (0 superior · 1 inferior), color (clase)
attribute vec4 aR;    // x lateral, desfase (m), δ, fase
attribute vec4 aR2;   // camiseta (0..1), escala, mallas (0/1), piel (0..1)
uniform float uDm, uStride, uAmp, uAdv, uMotionK;
uniform vec3 uShirt[9];
varying vec3 vCol;
varying float vFade;
varying float vDist;

vec3 rotX(vec3 v, float a) { float c = cos(a); float s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }

void main() {
  float d = aR.z;
  float rel = mod(aR.y + d * uDm + uAdv * (1.0 + d), ${WIN.toFixed(1)}) - ${BACK.toFixed(1)};
  float A = uAmp * (0.85 + 0.3 * fract(aR.w * 7.3));
  float ph = (uStride * (1.0 + 0.5 * d) + aR.w) * 6.28318;
  float side = aJ.y;
  float phs = ph + (side > 0.0 ? 3.14159 : 0.0);
  vec3 p = position;
  vec3 n = normal;
  if (aJ.x > 1.5) {
    // brazo: balanceo opuesto a la pierna del mismo lado, codo doblado ~80°
    vec3 sh = vec3(side * 0.215, 1.45, 0.0);
    vec3 el = vec3(side * 0.215, 1.17, 0.0);
    float aU = -0.62 * A * sin(phs) - 0.05;
    float aE = 1.25 + 0.3 * A * sin(phs);
    if (aJ.z > 0.5) { p = el + rotX(p - el, aE); n = rotX(n, aE); }
    p = sh + rotX(p - sh, aU); n = rotX(n, aU);
  } else if (aJ.x > 0.5) {
    // pierna: la cadera barre adelante y atrás; la rodilla se recoge tras el despegue
    vec3 hip = vec3(side * 0.09, 0.92, 0.0);
    vec3 kn = vec3(side * 0.09, 0.48, 0.0);
    float th = A * (0.1 + 0.6 * sin(phs));
    float fk = -A * (0.22 + 1.25 * pow(max(0.0, cos(phs + 0.35)), 1.3));
    if (aJ.z > 0.5) { p = kn + rotX(p - kn, fk); n = rotX(n, fk); }
    p = hip + rotX(p - hip, th); n = rotX(n, th);
  }
  // tronco y brazos inclinados hacia delante; dos rebotes por ciclo (fase de vuelo)
  if (aJ.x < 0.5 || aJ.x > 1.5) {
    vec3 pv = vec3(0.0, 0.92, 0.0);
    float lean = -0.11 * A - 0.02;
    p = pv + rotX(p - pv, lean); n = rotX(n, lean);
  }
  p.y += 0.035 * A * cos(2.0 * ph);
  p *= aR2.y;
  vec3 wp = vec3(aR.x, 0.0, -rel) + p;
  // color por clase: 0 camiseta · 1 pantalón · 2 piel · 3 pelo/gorra · 4 zapatillas · 5 pierna (piel o mallas)
  float cls = aJ.w;
  int si = int(floor(aR2.x * 8.99));
  vec3 shirt = uShirt[si];
  vec3 skin = mix(vec3(0.32, 0.2, 0.14), vec3(0.08, 0.05, 0.035), aR2.w);
  vec3 c = shirt;
  if (cls > 0.5) c = vec3(0.018, 0.018, 0.022);
  if (cls > 1.5) c = skin;
  if (cls > 2.5) c = vec3(0.02, 0.016, 0.014);
  if (cls > 3.5) c = vec3(0.42, 0.42, 0.44);
  if (cls > 4.5) c = mix(skin, vec3(0.015), aR2.z);
  float sP = uSLo + rel;
  float E = lampsAt(wp, normalize(n), sP) * uLight + metaLight(wp);
  // luz: farolas + cielo + un contraluz frío desde delante (los corredores se recortan contra la avenida iluminada)
  float back = max(-n.z, 0.0);
  vCol = c * (0.05 + 0.08 * max(n.y, 0.0) + E * uLampCol * 0.9) + c * back * 0.04;
  vCol = mix(vCol, vCol * vec3(1.2, 0.95, 0.65) * 1.3, uGold * 0.6);
  vec3 w = bendW(wp);
  vDist = length(w - cameraPosition);
  // fundido al envolver (lejos, dentro de la bruma)
  vFade = max(fogK(vDist), smoothstep(${(WIN - BACK - 40).toFixed(1)}, ${(WIN - BACK - 4).toFixed(1)}, rel));
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const RUN_FRAG = /* glsl */ `
${SHARED_DECL}
varying vec3 vCol;
varying float vFade;
varying float vDist;
void main() {
  gl_FragColor = vec4(mix(vCol, uFogCol, vFade), 1.0);
}`;

function box(P, N, J, cx, cy, cz, sx, sy, sz, j) {
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
  const idx = [];
  for (const [n, vs] of faces) {
    const b = P.length / 3;
    for (const v of vs) {
      // normales redondeadas (mitad cara, mitad esquina): las cajas se sombrean como volúmenes, sin facetas duras
      const ox = v[0] / hx; const oy = v[1] / hy; const oz = v[2] / hz;
      const ol = Math.hypot(ox, oy, oz) || 1;
      let nx = n[0] + 0.7 * ox / ol; let ny = n[1] + 0.7 * oy / ol; let nz = n[2] + 0.7 * oz / ol;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      P.push(cx + v[0], cy + v[1], cz + v[2]); N.push(nx, ny, nz); J.push(j[0], j[1], j[2], j[3]);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return idx;
}

export function buildRunners(THREE, shared, rand, count = 44) {
  const P = [];
  const Nn = [];
  const J = [];
  const idx = [];
  const add = (...a) => { for (const i of box(P, Nn, J, ...a)) idx.push(i); };
  // (corre hacia −z: le vemos la espalda)
  // tronco (camiseta): más ancho de hombros que de cintura
  {
    const v0 = P.length / 3;
    add(0, 1.2, 0, 0.36, 0.52, 0.2, [0, 0, 0, 0]);
    for (let v = v0; v < P.length / 3; v++) if (P[v * 3 + 1] < 1.2) P[v * 3] *= 0.8;
  }
  add(0, 0.9, 0, 0.32, 0.17, 0.2, [0, 0, 0, 1]);              // cadera (pantalón)
  add(0, 1.495, -0.01, 0.1, 0.07, 0.1, [0, 0, 0, 2]);         // cuello
  // cabeza: una esfera baja de polígonos (pelo o gorra)
  {
    const sg = new THREE.SphereGeometry(1, 8, 6);
    const sp = sg.attributes.position.array;
    const sn = sg.attributes.normal.array;
    const b = P.length / 3;
    for (let i = 0; i < sp.length; i += 3) {
      P.push(sp[i] * 0.095, 1.625 + sp[i + 1] * 0.115, -0.02 + sp[i + 2] * 0.105);
      Nn.push(sn[i], sn[i + 1], sn[i + 2]);
      J.push(0, 0, 0, 3);
    }
    for (const i of sg.index.array) idx.push(b + i);
    sg.dispose();
  }
  for (const s of [-1, 1]) {
    add(s * 0.09, 0.7, 0, 0.14, 0.44, 0.15, [1, s, 0, 1]);    // muslo (pantalón)
    add(s * 0.09, 0.27, 0, 0.11, 0.42, 0.12, [1, s, 1, 5]);   // pierna
    add(s * 0.09, 0.035, -0.05, 0.1, 0.07, 0.26, [1, s, 1, 4]); // zapatilla
    add(s * 0.215, 1.32, 0, 0.085, 0.27, 0.09, [2, s, 0, 2]); // brazo
    add(s * 0.215, 1.05, 0, 0.075, 0.25, 0.08, [2, s, 1, 2]); // antebrazo
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(Nn), 3));
  geo.setAttribute('aJ', new THREE.BufferAttribute(new Float32Array(J), 4));
  geo.setIndex(idx);
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
  geo.setAttribute('aR', new THREE.InstancedBufferAttribute(aR, 4));
  geo.setAttribute('aR2', new THREE.InstancedBufferAttribute(aR2, 4));
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
  return { mesh, u, count };
}

