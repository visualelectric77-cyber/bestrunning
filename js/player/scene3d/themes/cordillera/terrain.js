// CORDILLERA · malla del terreno. Una rejilla que va con la cámara pero cuyos vértices están FIJOS en el mundo:
// NB bandas en profundidad con paso que se duplica de una a otra (0,5 u cerca … 64 u a 8 km); cada banda se ajusta a la
// red de su propio paso (las filas sobrantes se pliegan sobre el borde), así el relieve no "nada" al avanzar y las curvas
// de nivel no tiemblan. Columnas laterales densas junto al camino (senh) y anchas en las sierras lejanas.
// Las triangulaciones van de cerca a lejos (early-Z: casi sin sobredibujo). Un único atributo (position: x lateral y
// fila) ⇒ poca memoria y ancho de banda. Una segunda malla (BACK) es la maqueta en relieve de la clase entera para el
// plano final: se crea al cargar el escenario (oculta) para que el núcleo la compile por adelantado.
import { NB } from './glsl.js';

const D0 = -6; // la primera banda empieza 6 u por detrás de la cámara

/**
 * Niveles de detalle por calidad: filas por banda (mismas distancias en todos) y semicolumnas.
 * Triángulos ≈ NB · (rows + 2) · 4·nc: alta 211 k · media 141 k · baja 83 k · ahorro 61 k.
 */
export const LODS = {
  high: { rows: 64, nc: 100 },
  med: { rows: 48, nc: 88 },
  low: { rows: 32, nc: 76 },
  eco: { rows: 32, nc: 56 },
};
export const X_MAX = 7200;
const SINH_A = 6.0;

export function columnsX(nc, xMax = X_MAX, a = SINH_A) {
  const xs = new Float32Array(nc * 2 + 1);
  const sa = Math.sinh(a);
  for (let j = 0; j <= nc * 2; j++) {
    const u = j / nc - 1;
    xs[j] = (xMax * Math.sinh(a * u)) / sa;
  }
  xs[nc] = 0;
  return xs;
}

/** Bandas: pasos y distancias nominales (iguales en todos los niveles: 64 filas de 0,5 u ≡ 32 de 1 u). */
export function bandsFor(lod) {
  const k0 = 0.5 * (64 / lod.rows);
  const out = [];
  let d = D0;
  for (let b = 0; b < NB; b++) {
    const step = k0 * 2 ** b;
    out.push({ step, d0: d, d1: d + lod.rows * step });
    d += lod.rows * step;
  }
  return out;
}

function grid(THREE, xs, rowsPerBlock, blocks, rowAttr) {
  const cols = xs.length;
  const nVert = cols * rowsPerBlock * blocks;
  const pos = new Float32Array(nVert * 3); // x = lateral, y = fila, z = 0
  let v = 0;
  for (let b = 0; b < blocks; b++) {
    for (let r = 0; r < rowsPerBlock; r++) {
      const row = rowAttr(b, r);
      for (let c = 0; c < cols; c++) {
        pos[v * 3] = xs[c];
        pos[v * 3 + 1] = row;
        v++;
      }
    }
  }
  const quads = blocks * (rowsPerBlock - 1) * (cols - 1);
  const idx = nVert > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  let k = 0;
  for (let b = 0; b < blocks; b++) {
    const base = b * rowsPerBlock * cols;
    for (let r = 0; r < rowsPerBlock - 1; r++) {
      const r0 = base + r * cols;
      const r1 = r0 + cols;
      for (let c = 0; c < cols - 1; c++) {
        const a = r0 + c; const bq = r0 + c + 1; const cq = r1 + c; const dq = r1 + c + 1;
        // fila cercana (r0) → lejana (r1); caras hacia arriba (+y): se ven desde la cámara, el resto se descarta
        idx[k++] = a; idx[k++] = bq; idx[k++] = cq;
        idx[k++] = bq; idx[k++] = dq; idx[k++] = cq;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

/** Malla principal (hacia delante): filas = rows + 3 por banda (holgura para el ajuste a la red). */
export function forwardGeometry(THREE, lod) {
  const xs = columnsX(lod.nc);
  return grid(THREE, xs, lod.rows + 3, NB, (b, r) => b * 256 + r);
}

/** Maqueta del plano final (toda la clase, comprimida): filas uniformes, laterales hasta ±2,6 km. */
export function backGeometry(THREE, { rows = 420, nc = 72 } = {}) {
  const xs = columnsX(nc, 6000, 5.0);
  const g = grid(THREE, xs, rows + 1, 1, (b, r) => r);
  g.userData.rows = rows;
  return g;
}

/**
 * Rellena los uniformes de bandas para la posición S (absoluta, doble precisión en JS). Devuelve { anchor, frac, b0 }
 * (objeto reutilizado: sin asignaciones por fotograma).
 * uBand[k] = (inicio, fin, paso) relativos al ancla (múltiplo del paso mayor) ⇒ números pequeños y exactos en float32.
 */
const BANDS_OUT = { anchor: 0, frac: 0, b0: 0 };
export function updateBands(bands, uBand, S, out = BANDS_OUT) {
  const big = bands[NB - 1].step * 2;
  const anchor = Math.floor(S / big) * big;
  let prevEnd = null;
  for (let k = 0; k < NB; k++) {
    const { step, d0 } = bands[k];
    const start = prevEnd != null ? prevEnd : Math.floor((S + d0) / step) * step;
    const nextStep = k + 1 < NB ? bands[k + 1].step : step * 2;
    const end = Math.floor((S + bands[k].d1) / nextStep) * nextStep;
    uBand[k].set(start - anchor, Math.max(start, end) - anchor, step);
    prevEnd = Math.max(start, end);
  }
  out.anchor = anchor;
  out.frac = S - anchor;
  out.b0 = uBand[0].x + anchor;
  return out;
}
