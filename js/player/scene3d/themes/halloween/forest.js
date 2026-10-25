// NOCHE DE HALLOWEEN · bosque y cementerio, instanciados en ranuras del marco del corredor (como las calabazas).
//  · Árboles desnudos y retorcidos: un solo árbol procedural (tronco que se tuerce y ramas en tres niveles, tubos de 3
//    a 5 lados, ~560 triángulos) instanciado con escala, giro, espejo e inclinación por ranura ⇒ un bosque variado en una
//    llamada. Dos hileras cercanas (3–9 m del camino) que pasan rápido a tu lado y dos lejanas (hasta 30 m) que se
//    pierden en la niebla. Los cercanos reciben la luz de la calabaza más próxima (por vértice), los lejanos solo la
//    luna rasante en el canto y el morado del ambiente. Un balanceo de ramas lentísimo (nulo con movimiento reducido).
//  · Cementerio en penumbra a la izquierda, a ~25 m: tramos de verja de hierro con lanzas y, detrás, lápidas (estela
//    de arco, cruz y obelisco) que se inclinan, cambian de altura o faltan según la ranura. Una llamada.
import { COMMON_GLSL, TREE_D, GRAVE_D } from './common.js';

/* ───────────── Árbol procedural ───────────── */

function tube(points, radii, sides, out) {
  const n = points.length;
  const base = out.pos.length / 3;
  let px = 1; let py = 0; let pz = 0; // vector perpendicular transportado
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0]; let ty = b[1] - a[1]; let tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    // perpendicular estable: proyecta la anterior sobre el plano normal a la tangente
    const d = px * tx + py * ty + pz * tz;
    px -= d * tx; py -= d * ty; pz -= d * tz;
    let pl = Math.hypot(px, py, pz);
    if (pl < 1e-4) { px = ty; py = -tx; pz = 0; pl = Math.hypot(px, py, pz) || 1; }
    px /= pl; py /= pl; pz /= pl;
    const qx = ty * pz - tz * py; const qy = tz * px - tx * pz; const qz = tx * py - ty * px;
    const p = points[i];
    for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * Math.PI * 2;
      const c = Math.cos(ang); const sn = Math.sin(ang);
      const nx = px * c + qx * sn; const ny = py * c + qy * sn; const nz = pz * c + qz * sn;
      out.pos.push(p[0] + nx * radii[i], p[1] + ny * radii[i], p[2] + nz * radii[i]);
      out.nrm.push(nx, ny, nz);
      out.h.push(p[1]);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const a = base + i * sides + s;
      const b = base + i * sides + ((s + 1) % sides);
      const c = a + sides;
      const d = b + sides;
      out.idx.push(a, c, b, b, c, d);
    }
  }
}

/** Rama: polilínea que se curva y se retuerce desde p0 en la dirección dir. */
function limb(rand, p0, dir, len, r0, r1, segs, curl) {
  const pts = [];
  const rad = [];
  let [x, y, z] = p0;
  let [dx, dy, dz] = dir;
  for (let i = 0; i <= segs; i++) {
    pts.push([x, y, z]);
    const t = i / segs;
    rad.push(r0 + (r1 - r0) * Math.pow(t, 0.8));
    // giro nudoso: cada tramo cambia algo de rumbo y la rama tiende a subir y a abrirse
    dx += (rand() - 0.5) * curl; dz += (rand() - 0.5) * curl; dy += (rand() - 0.42) * curl * 0.8;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    const step = len / segs;
    x += dx * step; y += dy * step; z += dz * step;
  }
  return { pts, rad };
}

function treeGeometry(THREE, rand) {
  const out = { pos: [], nrm: [], h: [], idx: [] };
  // tronco: se inclina y se retuerce; base ensanchada
  const trunk = limb(rand, [0, -0.2, 0], [0.12, 1, 0.05], 5.6, 0.3, 0.07, 8, 0.32);
  trunk.rad[0] = 0.42;
  tube(trunk.pts, trunk.rad, 5, out);
  const tp = trunk.pts;
  // ramas principales desde la mitad superior
  const nMain = 6;
  for (let b = 0; b < nMain; b++) {
    const k = 3 + Math.floor((b / nMain) * (tp.length - 3.5));
    const p = tp[Math.min(tp.length - 1, k)];
    const ang = (b / nMain) * Math.PI * 2 + rand() * 0.8;
    const up = 0.35 + rand() * 0.6;
    const dir = [Math.cos(ang), up, Math.sin(ang)];
    const L = 1.8 + rand() * 1.7;
    const r0 = 0.11 - b * 0.008;
    const br = limb(rand, p, dir, L, r0, 0.025, 5, 0.75);
    tube(br.pts, br.rad, 4, out);
    // ramillas retorcidas
    const nTw = 2 + (b % 2);
    for (let t = 0; t < nTw; t++) {
      const q = br.pts[2 + Math.floor(rand() * 3)];
      const a2 = ang + (rand() - 0.5) * 2.4;
      const tw = limb(rand, q, [Math.cos(a2), 0.3 + rand() * 0.9, Math.sin(a2)], 0.7 + rand() * 1.0, 0.035, 0.008, 3, 1.1);
      tube(tw.pts, tw.rad, 3, out);
    }
  }
  // copa: dos ramas que siguen al tronco hacia arriba
  for (let b = 0; b < 2; b++) {
    const p = tp[tp.length - 1];
    const ang = rand() * Math.PI * 2;
    const br = limb(rand, p, [Math.cos(ang) * 0.6, 1, Math.sin(ang) * 0.6], 1.4 + rand(), 0.06, 0.012, 4, 0.9);
    tube(br.pts, br.rad, 3, out);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out.pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(out.nrm), 3));
  g.setAttribute('aH', new THREE.BufferAttribute(new Float32Array(out.h), 1));
  g.setIndex(out.idx);
  return g;
}

const TREE_VERT = /* glsl */ `
attribute vec2 aSlot;     // x ranura j, y fila (0 izq. cerca, 1 der. cerca, 2 izq. lejos, 3 der. lejos)
attribute float aH;       // altura del punto del esqueleto (m, sin escalar)
uniform vec4 uTSlot;      // x base, y uOff (m), z separación (m), w balanceo
varying vec3 vW, vN, vPL;
varying float vH, vNear;
NOISE_CHUNK
COMMON_CHUNK
void main() {
  float k = uTSlot.x + aSlot.x;
  float row = aSlot.y;
  float sk = k * 4.0 + row;
  float h1 = hash11(sk * 1.31 + 0.7);
  float h2 = hash11(sk * 2.17 + 4.1);
  float h3 = hash11(sk * 3.73 + 9.3);
  float h4 = hash11(sk * 5.19 + 2.2);
  float side = mod(row, 2.0) < 0.5 ? -1.0 : 1.0;
  float near = row < 1.5 ? 1.0 : 0.0;
  // a la izquierda, el bosque lejano se queda antes del cementerio
  float latMax = side < 0.0 ? 14.0 : 30.0;
  float lat = side * (near > 0.5 ? 3.3 + 5.5 * h1 : 9.5 + (latMax - 9.5) * h1);
  float srel = aSlot.x * uTSlot.z + uTSlot.y + h2 * uTSlot.z;
  float sc = mix(0.72, 1.3, h3) * (near > 0.5 ? 1.0 : 1.18);
  float yaw = h4 * 6.2831;
  float mir = hash11(sk * 7.7) < 0.5 ? -1.0 : 1.0;
  vec3 p = position;
  p.x *= mir;
  // balanceo lentísimo de las ramas (crece con la altura)
  float sway = uTSlot.w * 0.0035 * aH * aH * sin(uLamp.z * 0.45 + h1 * 30.0 + aH * 0.3);
  p.x += sway;
  vec3 nn = vec3(normal.x * mir, normal.y, normal.z);
  float c = cos(yaw); float s = sin(yaw);
  vec3 q = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) * sc;
  // inclinación de cada árbol (troncos que no son rectos)
  float lean = (hash11(sk * 9.1) - 0.5) * 0.16;
  q.x += lean * q.y;
  vec3 w = q + vec3(lat + bendX(srel), 0.0, -srel);
  // claros en el bosque: algunas ranuras se quedan sin árbol
  if (hash11(sk * 11.3 + 0.5) < (near > 0.5 ? 0.3 : 0.15)) w = vec3(0.0, -80.0, 0.0);
  vN = vec3(nn.x * c + nn.z * s, nn.y, -nn.x * s + nn.z * c);
  vW = w;
  vH = aH * sc;
  vNear = near;
  // luz de la calabaza más cercana de su lado (por vértice; solo hileras cercanas)
  vPL = vec3(0.0);
  if (near > 0.5) {
    float off = side > 0.0 ? 0.5 * uSlot.z : 0.0;
    float j = floor((srel - uSlot.y - off) / uSlot.z + 0.5);
    float ps; float pl; float pz; float pseed;
    pumpkinSlot(j, side, ps, pl, pz, pseed);
    float br; vec3 zc = candleAt(ps, br);
    vec3 P = vec3(pl + bendX(ps), 0.3, -ps);
    vec3 L = P - w;
    float d2 = dot(L, L);
    float nd = max(dot(normalize(vN), L / sqrt(d2)), 0.0);
    vPL = candleTint(zc) * br * (0.3 + 0.7 * nd) / (1.0 + d2 * 0.9) * (1.0 - smoothstep(3.0, 7.0, sqrt(d2)));
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const TREE_FRAG = /* glsl */ `
uniform vec3 uBark;
uniform float uLight;
varying vec3 vW, vN, vPL;
varying float vH, vNear;
NOISE_CHUNK
COMMON_CHUNK
void main() {
  vec3 N = normalize(vN);
  vec3 toCam = vW - cameraPosition;
  float dist = length(toCam);
  vec3 V = -toCam / max(dist, 1e-3);
  float srel = -vW.z;
  float r = vW.x - bendX(srel);
  float moon = max(dot(N, uMoonDir), 0.0);
  // canto iluminado por la luna (contraluz): perfila las siluetas sin aclarar el bosque
  float rim = pow(1.0 - abs(dot(N, V)), 3.0) * (0.35 + 0.65 * max(dot(-V, uMoonDir), 0.0));
  vec3 col = uBark * (uAmb * 8.0 * uLight + uMoonCol * (0.16 * moon + 0.1 * rim));
  col += uBark * vPL * 6.0;
  col = applyFog(col, vW, V, dist, srel, r);
  gl_FragColor = vec4(col, 1.0);
}`;

export function createTrees(ctx, shared, maxSlots, rows = 4) {
  const { THREE } = ctx;
  const rand = ctx.rng(1031);
  const geo = treeGeometry(THREE, rand);
  const n = maxSlots * rows;
  const slot = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { slot[i * 2] = Math.floor(i / rows); slot[i * 2 + 1] = i % rows; }
  geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slot, 2));
  geo.instanceCount = n;
  const chunk = (s) => s.replace('NOISE_CHUNK', ctx.shaders.NOISE).replace('COMMON_CHUNK', COMMON_GLSL);
  const u = {
    ...shared,
    uTSlot: { value: new THREE.Vector4(0, 0, TREE_D, 1) },
    uBark: { value: new THREE.Color().setRGB(0.05, 0.04, 0.045) },
    uLight: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: chunk(TREE_VERT), fragmentShader: chunk(TREE_FRAG), side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'halloween-trees';
  return {
    mesh, u, maxSlots, rows,
    tris: geo.index.count / 3,
    setSlots(k) { geo.instanceCount = Math.max(1, Math.min(maxSlots, k | 0)) * rows; },
  };
}

/* ───────────── Cementerio ───────────── */

/** Caja (centro, semitamaños) → triángulos con normales planas. */
function pushBox(out, cx, cy, cz, hx, hy, hz, part, pivot) {
  const F = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]],
    [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
  ];
  for (const [n, q] of F) {
    const v = q.map(([a, b, c]) => [cx + a * hx, cy + b * hy, cz + c * hz]);
    for (const i of [0, 1, 2, 0, 2, 3]) {
      out.pos.push(...v[i]); out.nrm.push(...n); out.part.push(part); out.piv.push(...pivot);
    }
  }
}

/** Contorno 2D (x, y) extruido en z ∈ [z0, z1] (polígono convexo en abanico). */
function pushPrism(out, poly, z0, z1, part, pivot, ox, oz, oy = 0) {
  const n = poly.length;
  const tri = (a, b, c, nn) => { for (const v of [a, b, c]) { out.pos.push(v[0] + ox, v[1] + oy, v[2] + oz); out.nrm.push(...nn); out.part.push(part); out.piv.push(...pivot); } };
  for (let i = 1; i < n - 1; i++) {
    tri([poly[0][0], poly[0][1], z1], [poly[i][0], poly[i][1], z1], [poly[i + 1][0], poly[i + 1][1], z1], [0, 0, 1]);
    tri([poly[0][0], poly[0][1], z0], [poly[i + 1][0], poly[i + 1][1], z0], [poly[i][0], poly[i][1], z0], [0, 0, -1]);
  }
  for (let i = 0; i < n; i++) {
    const a = poly[i]; const b = poly[(i + 1) % n];
    const ex = b[0] - a[0]; const ey = b[1] - a[1];
    const l = Math.hypot(ex, ey) || 1;
    const nn = [ey / l, -ex / l, 0];
    tri([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], nn);
    tri([a[0], a[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], nn);
  }
}

/**
 * Celda del cementerio (GRAVE_D m de verja): espacio local x = a lo largo del camino (0..D), y = arriba, z = hacia
 * fuera (0 = verja). part 0 = verja; 1..3 = lápidas (pivot = centro de su base, para inclinarlas en el shader).
 */
function graveCell(THREE) {
  const out = { pos: [], nrm: [], part: [], piv: [] };
  const D = GRAVE_D;
  const P0 = [0, 0, 0];
  // poste con remate y dos travesaños
  pushBox(out, 0.06, 0.95, 0, 0.06, 0.95, 0.06, 0, P0);
  pushBox(out, 0.06, 1.98, 0, 0.09, 0.08, 0.09, 0, P0);
  pushBox(out, D / 2, 0.35, 0, D / 2, 0.025, 0.02, 0, P0);
  pushBox(out, D / 2, 1.45, 0, D / 2, 0.025, 0.02, 0, P0);
  // barrotes con punta de lanza
  const nb = 9;
  for (let i = 1; i <= nb; i++) {
    const x = (i / (nb + 1)) * D + 0.06;
    pushBox(out, x, 0.8, 0, 0.012, 0.8, 0.012, 0, P0);
    pushPrism(out, [[-0.04, 0], [0.04, 0], [0, 0.14]], -0.015, 0.015, 0, P0, x, 0, 1.6);
  }
  // lápidas: estela con arco, cruz y obelisco, a distintas distancias tras la verja
  const arch = [];
  arch.push([-0.3, 0], [0.3, 0], [0.3, 0.62]);
  for (let i = 1; i < 8; i++) { const a = (i / 8) * Math.PI; arch.push([0.3 * Math.cos(a), 0.62 + 0.3 * Math.sin(a)]); }
  arch.push([-0.3, 0.62]);
  const s1 = [0.8, 0, 3.2];
  pushPrism(out, arch, -0.07, 0.07, 1, s1, s1[0], s1[2]);
  const s2 = [2.1, 0, 6.5];
  pushBox(out, s2[0], 0.55, s2[2], 0.055, 0.55, 0.055, 2, s2);
  pushBox(out, s2[0], 0.78, s2[2], 0.26, 0.055, 0.055, 2, s2);
  const s3 = [1.4, 0, 10.5];
  pushPrism(out, [[-0.17, 0], [0.17, 0], [0.12, 1.15], [0, 1.4], [-0.12, 1.15]], -0.12, 0.12, 3, s3, s3[0], s3[2]);
  pushBox(out, s3[0], 0.08, s3[2], 0.24, 0.08, 0.2, 3, s3);
  return out;
}

const GRAVE_VERT = /* glsl */ `
attribute vec2 aSlot;     // x ranura j
attribute float aPart;
attribute vec3 aPivot;
uniform vec4 uGSlot;      // x base, y uOff (m), z separación (m), w distancia de la verja al camino (m)
varying vec3 vW, vN;
varying float vPart, vHide;
NOISE_CHUNK
COMMON_CHUNK
void main() {
  float k = uGSlot.x + aSlot.x;
  vec3 p = position;
  vec3 n = normal;
  vHide = 0.0;
  if (aPart > 0.5) {
    float sk = k * 3.0 + aPart;
    float h1 = hash11(sk * 1.7 + 0.3);
    float h2 = hash11(sk * 4.3 + 1.9);
    float h3 = hash11(sk * 2.9 + 7.1);
    vec3 q = p - aPivot;
    q.y *= 1.0 + 0.6 * h1;
    float tx = (h2 - 0.5) * 0.28;            // inclinación hacia delante/atrás
    float tz = (h3 - 0.5) * 0.22;            // y de lado
    q = vec3(q.x, q.y * cos(tx) - q.z * sin(tx), q.y * sin(tx) + q.z * cos(tx));
    q = vec3(q.x * cos(tz) - q.y * sin(tz), q.x * sin(tz) + q.y * cos(tz), q.z);
    p = aPivot + q + vec3((h1 - 0.5) * 0.8, 0.0, (h2 - 0.5) * 2.0);
    if (hash11(sk * 6.1) < 0.22) { p = vec3(0.0, -50.0, 0.0); vHide = 1.0; }
  }
  // espacio local → marco del corredor (cementerio a la izquierda: z local hacia fuera = −x)
  float srel = aSlot.x * uGSlot.z + uGSlot.y + p.x;
  vec3 w = vec3(-(uGSlot.w + p.z) + bendX(srel), p.y, -srel);
  vN = vec3(-n.z, n.y, -n.x);
  vW = w;
  vPart = aPart;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const GRAVE_FRAG = /* glsl */ `
uniform vec3 uStone, uIron;
uniform float uLight;
varying vec3 vW, vN;
varying float vPart, vHide;
NOISE_CHUNK
COMMON_CHUNK
void main() {
  vec3 N = normalize(vN);
  vec3 toCam = vW - cameraPosition;
  float dist = length(toCam);
  vec3 V = -toCam / max(dist, 1e-3);
  float srel = -vW.z;
  float r = vW.x - bendX(srel);
  float moon = max(dot(N, uMoonDir), 0.0);
  vec3 alb = vPart > 0.5 ? uStone * (0.75 + 0.4 * vnoise(vW.xy * 3.0 + vW.zy)) : uIron;
  vec3 col = alb * (uAmb * 10.0 * uLight + uMoonCol * 0.4 * moon + uMoonCol * 0.1 * max(N.y, 0.0) + uMoonCol * 0.05);
  if (vPart < 0.5) col += uMoonCol * 0.02 * pow(max(dot(reflect(-V, N), uMoonDir), 0.0), 30.0);
  col = applyFog(col, vW, V, dist, srel, r);
  gl_FragColor = vec4(col, 1.0);
}`;

export function createGraves(ctx, shared, maxSlots) {
  const { THREE } = ctx;
  const cell = graveCell(THREE);
  const pos = new Float32Array(cell.pos);
  const part = new Float32Array(cell.part);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(cell.nrm), 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  g.setAttribute('aPivot', new THREE.BufferAttribute(new Float32Array(cell.piv), 3));
  const slot = new Float32Array(maxSlots * 2);
  for (let i = 0; i < maxSlots; i++) slot[i * 2] = i;
  g.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slot, 2));
  g.instanceCount = maxSlots;
  const chunk = (s) => s.replace('NOISE_CHUNK', ctx.shaders.NOISE).replace('COMMON_CHUNK', COMMON_GLSL);
  const u = {
    ...shared,
    uGSlot: { value: new THREE.Vector4(0, 0, GRAVE_D, 17) },
    uStone: { value: new THREE.Color().setRGB(0.13, 0.12, 0.14) },
    uIron: { value: new THREE.Color().setRGB(0.01, 0.009, 0.012) },
    uLight: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: chunk(GRAVE_VERT), fragmentShader: chunk(GRAVE_FRAG), side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.name = 'halloween-graves';
  return {
    mesh, u, maxSlots,
    setSlots(k) { g.instanceCount = Math.max(1, Math.min(maxSlots, k | 0)); },
  };
}
