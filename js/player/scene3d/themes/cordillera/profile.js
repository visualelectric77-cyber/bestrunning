// CORDILLERA · perfil de la cresta: la clase convertida en una cordillera (SPEC §15.2-1).
// Cada tramo tiene una cota objetivo E (más alta cuanto más intenso: velocidad del plan + rango de la zona); los
// intervalos intensos son cumbres (subida al empezar el tramo y una cúpula suave hasta su cima), las recuperaciones
// bajan al collado y el test VAM son terrazas que suben un peldaño por escalón. Todo se coloca en unidades visuales
// S(t) del núcleo ⇒ el pie de cada cumbre se cruza EXACTAMENTE en el segundo del cambio de tramo.
// La tabla (cota y zona cada DS u) se usa a la vez en JS (cámara, rótulos) y en GLSL (textura RG32F, texelFetch):
// ambos interpolan los mismos valores ⇒ la cámara va pegada al camino sin derivas.

export const DS = 4;             // resolución de la tabla (u)
export const S0 = -512;          // la tabla empieza antes de la salida (terreno detrás al arrancar)
export const AHEAD = 8600;       // terreno visible más allá del final de la clase (+ cola del núcleo)
export const TEX_W = 1024;       // ancho de la textura (filas de 1024 muestras)
export const BASE = 46;          // cota mínima de la cresta sobre el fondo de los valles laterales
const TOP = 98;                  // desnivel máximo de una cumbre sobre BASE

const RANK = { walk: 0, warmup: 1, cooldown: 1, jog: 2, run: 3, fast: 4, sprint: 5 };
export const ZONE_KEYS = ['warmup', 'walk', 'jog', 'run', 'fast', 'sprint', 'cooldown'];
const ZI = Object.fromEntries(ZONE_KEYS.map((k, i) => [k, i]));

/** Meandro suave del camino (u): mismo polinomio en JS y en GLSL (BEND_GLSL). */
const B1 = 64; const F1 = 0.00105; const P1 = 1.3;
const B2 = 22; const F2 = 0.0027; const P2 = 0.4;
export function bendAt(s) { return B1 * Math.sin(s * F1 + P1) + B2 * Math.sin(s * F2 + P2); }
export const BEND_GLSL = /* glsl */ `
float bendAt(float s) { return ${B1.toFixed(1)} * sin(s * ${F1} + ${P1}) + ${B2.toFixed(1)} * sin(s * ${F2} + ${P2}); }`;

const smoother = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * @param {object} ctx  contexto del escenario (usa ctx.tl en bruto, ctx.THREE)
 */
export function createProfile(ctx) {
  const { THREE } = ctx;
  const tl = ctx.tl;
  const n = Math.max(1, tl.n);

  // Cota objetivo por tramo: se fija UNA vez con el plan (un ajuste manual de velocidad no mueve la montaña bajo los pies)
  const E = new Float64Array(n);
  const dome = new Float64Array(n);
  const isStage = new Uint8Array(n);
  let vLo = Infinity;
  let vHi = 0;
  for (let i = 0; i < tl.n; i++) { const v = tl.speeds[i]; if (v > 0) { vLo = Math.min(vLo, v); vHi = Math.max(vHi, v); } }
  if (!Number.isFinite(vLo)) { vLo = 6; vHi = 12; }
  const maxStage = Math.max(1, tl.maxStage || 0);
  for (let i = 0; i < tl.n; i++) {
    const z = tl.zones[i];
    const st = tl.stage[i] || 0;
    const sp = vHi - vLo > 0.2 ? clamp01((tl.speeds[i] - vLo) / (vHi - vLo)) : 0.5;
    const rk = (RANK[z] ?? 2) / 5;
    if (st > 0) {
      isStage[i] = 1;
      E[i] = 18 + 150 * (st / maxStage); // terrazas: un peldaño bien visible por escalón
    } else {
      E[i] = TOP * Math.pow(0.62 * sp + 0.38 * rk, 1.12);
    }
    dome[i] = !st && (RANK[z] ?? 0) >= 3 ? 4 + 0.09 * E[i] : 0;
  }

  // Longitudes planificadas (u) y transiciones (fijas desde la creación: forma estable)
  const lenP = new Float64Array(n);
  const trans = new Float64Array(n);
  for (let i = 0; i < tl.n; i++) {
    lenP[i] = Math.max(20, tl.S(tl.ends[i]) - tl.S(tl.starts[i]));
    const stageStep = isStage[i] && i > 0 && isStage[i - 1];
    trans[i] = stageStep ? 30 : Math.min(560, Math.max(60, 0.72 * lenP[i]));
  }

  const sb = new Float64Array(n + 1);   // S de inicio de cada tramo (y final de la clase en sb[n]) — vivo
  const fromV = new Float64Array(n);    // cota (sin ondulación) con la que llega cada tramo: continuidad garantizada
  const peakS = new Float64Array(n);    // S de la cima de cada tramo
  const peakR = new Float64Array(n);
  let count = 0;
  let data = null;      // Float32Array RG (cota, índice de zona)
  let tex = null;
  let rows = 0;
  let version = 0;

  function segAtS(s, hint) {
    let i = hint >= 0 && hint < n ? hint : 0;
    while (i + 1 < tl.n && sb[i + 1] <= s) i++;
    while (i > 0 && sb[i] > s) i--;
    return i;
  }

  /** Cota del tramo i a u unidades de su inicio (sin ondulación). */
  function segShape(i, u) {
    const from = fromV[i];
    let r = from + (E[i] - from) * smoother(u / trans[i]);
    if (dome[i] > 0) r += dome[i] * Math.sin(Math.PI * clamp01(u / lenP[i]));
    return r;
  }

  /** Cota exacta de la cresta en s (sin tabla). */
  function ridgeExact(s, i) {
    if (!tl.n) return BASE + 40;
    const r = segShape(i, s - sb[i]);
    // ondulación suave de la cresta (cruza curvas de nivel aunque el tramo sea llano); casi nula en las terrazas
    // ondulación larga de la cresta (hombros, falsas cimas suaves): solo longitudes de onda largas, para que las
    // curvas de nivel crucen el camino de vez en cuando sin dibujar "anillos" alrededor de él
    const und = (0.6 * Math.sin(s * 0.0093 + 1.3) + 0.4 * Math.sin(s * 0.0047 + 0.2)) * (2.2 + 0.05 * r);
    return BASE + r + und * (isStage[i] ? 0.08 : 1);
  }

  function build() {
    for (let i = 0; i < tl.n; i++) sb[i] = tl.S(tl.starts[i]);
    sb[tl.n] = tl.S(tl.totalSec);
    fromV[0] = E[0];
    for (let i = 1; i < tl.n; i++) fromV[i] = segShape(i - 1, sb[i] - sb[i - 1]);
    const sMax = tl.S(tl.totalSec + 110) + AHEAD;
    const need = Math.ceil((sMax - S0) / DS) + 2;
    const cap = Math.ceil((need * 1.25) / TEX_W) * TEX_W; // margen: un ajuste de velocidad no obliga a realojar
    if (!data || need > (data.length >> 1)) {
      rows = cap / TEX_W;
      data = new Float32Array(cap * 2);
      if (tex) tex.dispose();
      tex = new THREE.DataTexture(data, TEX_W, rows, THREE.RGFormat, THREE.FloatType);
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.NoColorSpace;
      tex.flipY = false;
    }
    count = need;
    peakR.fill(-1);
    let seg = 0;
    for (let k = 0; k < count; k++) {
      const s = S0 + k * DS;
      seg = segAtS(s, seg);
      const r = ridgeExact(s, seg);
      data[k * 2] = r;
      data[k * 2 + 1] = ZI[tl.zones[seg]] ?? 2;
      if (s >= sb[seg] && s <= sb[seg + 1] && r > peakR[seg]) { peakR[seg] = r; peakS[seg] = s; }
    }
    // relleno del resto (por si el shader lee más allá)
    for (let k = count; k < data.length >> 1; k++) { data[k * 2] = data[(count - 1) * 2]; data[k * 2 + 1] = data[(count - 1) * 2 + 1]; }
    tex.needsUpdate = true;
    version++;
  }
  build();

  /** Cota de la cresta en s, interpolando la MISMA tabla que el shader. */
  function R(s) {
    let u = (s - S0) / DS;
    if (u < 0) u = 0;
    if (u > count - 1.001) u = count - 1.001;
    const i = Math.floor(u);
    const f = u - i;
    return data[i * 2] + (data[i * 2 + 2] - data[i * 2]) * f;
  }

  return {
    get tex() { return tex; },
    get count() { return count; },
    get version() { return version; },
    get length() { return sb[tl.n]; },
    E, sb, peakS, peakR, isStage,
    R,
    segAtS,
    rebuild: build,
    dispose() { tex?.dispose(); tex = null; data = null; },
  };
}
