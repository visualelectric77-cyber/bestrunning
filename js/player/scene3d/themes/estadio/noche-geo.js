// ESTADIO DE NOCHE (modo retransmisión) · geometría (sin DOM). Copia de tools/estadio-bake/stadium-piece.js, con la que se hornearon
// los mapas de luz de assets/world/estadio-noche/ (si cambia, hay que volver a hornear). Parte del Estadio de la app (mismo
// óvalo, mismo perfil de grada, mismo shader de gradas vía aInfo) con dos cambios que pidió Nacho el 26-11:
//  · la cubierta va a ALTURA CONSTANTE y la curva es lisa (96 tramos por curva): en la app sube y baja (silla de montar,
//    para el HUD) y en las curvas se veía quebrada — «se deforman en las curvas, eso no es real ni bonito»;
//  · los focos son PROYECTORES de verdad: una corona de ~220 luminarias (carcasa + lente) colgadas de una pasarela bajo
//    el canto de la cubierta, cada una apuntando a su punto del campo. Se encienden por baterías (4 sectores).
import { A, R0, WALL, ROOF_EDGE, ROOF_Y, outline } from './track.js';

/** Perfil de la grada de la app (stadium.js), cara a cara. */
export const PROFILE = [
  [[WALL, 0], [WALL, 1.1]],
  [[WALL, 1.1], [WALL + 1.1, 1.1]],
  [[WALL + 1.1, 1.1], [WALL + 1.1, 2.3]],
  [[WALL + 1.1, 2.3], [WALL + 24.5, 16.2]],
  [[WALL + 24.5, 16.2], [WALL + 25.1, 18.6]],
  [[WALL + 25.1, 18.6], [WALL + 46, 31.5]],
  [[WALL + 46, 31.5], [WALL + 46, 43.6]],
  [[WALL + 46, 43.6], [ROOF_EDGE, ROOF_Y + 1.2]],
  [[ROOF_EDGE, ROOF_Y + 1.2], [ROOF_EDGE, ROOF_Y + 3.4]],
  [[ROOF_EDGE, ROOF_Y + 3.4], [WALL + 46, 45.4]],
];
const BASE_Y = 2.3;
export const ROOF_H = 34;     // altura del intradós en el canto (m), igual en todo el anillo
const K = (ROOF_H - BASE_Y) / (ROOF_Y + 1.2 - BASE_Y);
export const yOf = (y) => (y <= BASE_Y ? y : BASE_Y + (y - BASE_Y) * K);
export const NB = 96;          // tramos por curva

/** Anillo de gradas (mismos atributos que buildStands de la app: position, aInfo, índice). */
export function standsGeometry(THREE) {
  const ref = outline(WALL, NB);
  const n = ref.length;
  const faces = PROFILE.length;
  const pos = new Float32Array(faces * n * 2 * 3);
  const info = new Float32Array(faces * n * 2 * 4);
  const idx = [];
  let vi = 0;
  for (let fI = 0; fI < faces; fI++) {
    const [[d0, y0], [d1, y1]] = PROFILE[fI];
    const len = Math.hypot(d1 - d0, y1 - y0);
    const o0 = outline(d0, NB);
    const o1 = outline(d1, NB);
    const start = vi;
    for (let j = 0; j < n; j++) {
      for (let side = 0; side < 2; side++) {
        const o = side ? o1[j] : o0[j];
        pos[vi * 3] = o.x; pos[vi * 3 + 1] = yOf(side ? y1 : y0); pos[vi * 3 + 2] = o.z;
        info[vi * 4] = fI; info[vi * 4 + 1] = side; info[vi * 4 + 2] = len; info[vi * 4 + 3] = ref[j].u;
        vi++;
      }
    }
    for (let j = 0; j < n - 1; j++) {
      const a = start + j * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  g.setIndex(idx);
  return { geometry: g, lap: ref[n - 1].u };
}

/** Sector de un punto del estadio: 0 recta de enfrente (z<0) · 1 curva 1 (x>A) · 2 curva 2 (x<−A) · 3 recta de meta. */
export function sectorOf(x, z) {
  if (x > A) return 1;
  if (x < -A) return 2;
  return z < 0 ? 0 : 3;
}

/**
 * Corona de proyectores bajo el canto de la cubierta, en BATERÍAS: grupos de 5 luminarias juntas (0,85 m) cada 9,6 m,
 * como en un estadio de verdad (de lejos se lee el ritmo de las baterías, no una guirnalda). Cada luminaria apunta a su
 * punto del campo (entre el centro y la calle 8), con algo de azar. Devuelve
 * [{ p:[x,y,z], n:[dx,dy,dz], sector, order (0..1 dentro del sector), u, bank (nº de batería), mid (es la central) }].
 */
export function fixtures(rand, step = 9.6, per = 5, gap = 0.85) {
  const d = ROOF_EDGE - 1.1;
  const y = ROOF_H - 1.25;
  const ol = outline(d, NB);
  const lapD = ol[ol.length - 1].u;
  const nBanks = Math.round(lapD / step);
  const st = lapD / nBanks;
  const at = (u) => {
    let i = 0;
    while (i < ol.length - 2 && ol[i + 1].u < u) i++;
    const a = ol[i]; const b = ol[i + 1];
    const t = (u - a.u) / (b.u - a.u);
    let nx = a.nx + (b.nx - a.nx) * t; let nz = a.nz + (b.nz - a.nz) * t;
    const nl = Math.hypot(nx, nz) || 1;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, nx: nx / nl, nz: nz / nl };
  };
  const out = [];
  for (let bI = 0; bI < nBanks; bI++) {
    const uc = (bI + 0.5) * st;
    for (let k = 0; k < per; k++) {
      const u = uc + (k - (per - 1) / 2) * gap;
      const { x, z, nx, nz } = at(u);
      const din = -(d) + (10 - 44 * rand());
      const tx = x + nx * din + (rand() - 0.5) * 14 * nz;
      const tz = z + nz * din - (rand() - 0.5) * 14 * nx;
      const dx = tx - x; const dy = 0 - y; const dz = tz - z;
      const dl = Math.hypot(dx, dy, dz);
      out.push({ p: [x, y, z], n: [dx / dl, dy / dl, dz / dl], u, sector: sectorOf(x, z), br: 0.85 + 0.3 * rand(), bank: bI, mid: k === (per - 1) / 2 });
    }
  }
  // orden de encendido dentro de cada sector: del centro del sector hacia los extremos, batería a batería
  for (let s = 0; s < 4; s++) {
    const f = out.filter((q) => q.sector === s);
    const us = f.map((q) => q.u);
    const mid = (Math.min(...us) + Math.max(...us)) / 2;
    const span = Math.max(1, (Math.max(...us) - Math.min(...us)) / 2);
    for (const q of f) q.order = Math.min(1, Math.abs(q.u - mid) / span);
  }
  out.forEach((q, i) => { q.k = i / out.length; });
  return out;
}

/** Pasarela de los proyectores: una viga de 1,2 × 0,5 m que da la vuelta bajo el canto (anillo extruido). */
export function catwalkGeometry(THREE) {
  const prof = [[ROOF_EDGE - 1.7, ROOF_H - 0.55], [ROOF_EDGE - 0.5, ROOF_H - 0.55], [ROOF_EDGE - 0.5, ROOF_H - 0.05], [ROOF_EDGE - 1.7, ROOF_H - 0.05]];
  const rings = prof.map(([d]) => outline(d, NB));
  const n = rings[0].length;
  const pos = [];
  const idx = [];
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    const base = pos.length / 3;
    for (let j = 0; j < n; j++) {
      pos.push(rings[k][j].x, prof[k][1], rings[k][j].z, rings[k2][j].x, prof[k2][1], rings[k2][j].z);
    }
    for (let j = 0; j < n - 1; j++) { const a = base + j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export { A, R0, WALL, ROOF_EDGE };

/* ── uv de los mapas de luz (tools/estadio-bake/lm-uv.js) ── */
export const GROUND_BOX = { x0: -96, x1: 96, z0: -54, z1: 54 };
export const GROUND_LM = { w: 2048, h: 1152 };
export const STANDS_LM = { w: 4096, h: 1024 };
const GUTTER = 8; // texels entre franjas (el sangrado del horneado no se cuela de una cara a otra)

/** Franjas en v de cada cara: [{ v0, v1 }] en 0..1, a partir de las longitudes de las caras (aInfo.z). */
export function standBands(lengths, H = STANDS_LM.h) {
  const usable = H - GUTTER * (lengths.length + 1);
  const total = lengths.reduce((a, b) => a + b, 0);
  const out = [];
  let px = GUTTER;
  for (const L of lengths) {
    const h = Math.max(6, Math.floor((usable * L) / total));
    out.push({ v0: px / H, v1: (px + h) / H });
    px += h + GUTTER;
  }
  return out;
}

/** uv de los vértices de la grada a partir de aInfo (cara, lado, longitud, arco). */
export function standUV(info, lap, bands) {
  const n = info.length / 4;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const f = info[i * 4];
    const b = bands[f];
    uv[i * 2] = 0.002 + 0.996 * (info[i * 4 + 3] / lap);
    uv[i * 2 + 1] = b.v0 + (b.v1 - b.v0) * info[i * 4 + 1];
  }
  return uv;
}

/** Longitudes de cada cara leídas de la geometría. */
export function faceLengths(info) {
  const L = [];
  for (let i = 0; i < info.length; i += 4) L[info[i]] = info[i + 2];
  return L;
}
