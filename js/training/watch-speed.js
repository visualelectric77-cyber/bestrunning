// RITMUP · lo que el Apple Watch calcula que corres de verdad en la cinta (app nativa, build 24).
//
// La app no sabe a qué velocidad va la cinta: enseña la que toca y tú la pones a mano. El reloj la estima por el braceo
// (podómetro del sistema) y manda cada ~3 s un `speed { kmh, km, cadence, at, source: 'watch' }`. Es ORIENTATIVO (en
// sus datos midió un 4 % más de distancia que la clase): aquí NUNCA se cambia la velocidad de la clase con él. Sirve
// para tres cosas, todas con cuentas fijas:
//   1. Enseñarlo junto a la velocidad de la clase («≈ 10,3» con el icono del reloj).
//   2. Avisar si lleva 20 s o más desviado 0,5 km/h o más de lo que marca la clase («¿has cambiado la cinta?»).
//   3. Guardar en la sesión su distancia y su ritmo medio, y aprender con las clases tu corrección personal
//      (reloj → cinta) cuando no has tocado la velocidad.
// Desde el 13 nov (primera clase real: el reloj midió un 3,6 % menos de media, pero un 10 % menos en el bloque rápido):
//   4. La corrección va POR FRANJAS de velocidad (el error del reloj no es el mismo andando que rápido), con vuelta a
//      la corrección única donde una franja aún no tiene datos.
//   5. La sesión guarda una serie compacta del reloj (velocidad, cadencia y lo que marcaba la clase, cada 10 s) y la
//      cadencia y la zancada medias, para comparar tramo a tramo (seriesCompare) y para las clases de técnica.
// Módulo puro (sin DOM ni almacenamiento): lo usan js/screens/player.js y tools/test-watch-speed.mjs.
// Las mismas cuentas de tolerancia están en native/BestRunningWatch/Model/PaceMath.swift (pantalla Ritmo del reloj).

/** Una lectura vale como «en directo» si llegó hace ≤ 15 s. */
export const SPEED_FRESH_MS = 15000;
/** Desvío que es noticia (km/h) con tu corrección ya aprendida, y cuánto tiene que durar (s). */
export const DRIFT_KMH = 0.5;
export const DRIFT_SEC = 20;
/** Tras un cambio de velocidad de la clase, la cinta y la estimación del reloj tardan: estos segundos no cuentan. */
export const SETTLE_SEC = 20;
/** Entre dos avisos, como poco (s). Además, solo uno por tramo estable. */
export const DRIFT_REPEAT_SEC = 120;
/** Sin corrección aprendida el reloj puede ir desviado de serie: el margen es 0,5 o este tanto de la velocidad. */
export const UNCAL_SHARE = 0.08;
/** La corrección personal (cinta / reloj) nunca sale de aquí; fuera de esto no es sesgo, es otra cosa. Hasta el 12 nov
 *  era 0,85…1,15; la primera clase real dio ya 1,107 en el bloque rápido, así que se abre a lo mismo que se aprende. */
export const FACTOR_MIN = 0.8;
export const FACTOR_MAX = 1.25;
/**
 * Se aprende de TODAS las clases, desde la primera (13 nov), también de las que llevan cambios de velocidad a mano: la
 * app sabe qué velocidad marca la clase en cada momento, así que lo que cuenta son los tramos estables (pasados 30 s
 * de cualquier cambio de velocidad, tuyo o de la clase), a partir de 6 km/h y con lecturas que cuadren con la clase.
 * Lo prudente no es esperar, es el PESO: lo que enseña cada clase pesa según sus segundos estables (como mucho 15 min
 * por clase) y la corrección se encoge hacia «sin corregir» mientras haya poco: con W segundos acumulados se aplica
 * W / (W + W0) de lo medido. W0 = 10 min para la corrección única y 4 min para cada franja (que se encoge hacia la
 * única). Así una primera clase de 20 min ya corrige más de la mitad, y una rara no lo descoloca todo: se guarda la
 * mediana (ponderada) de las 12 últimas.
 */
const LEARN_SETTLE_SEC = 30;
const LEARN_MIN_KMH = 6;
const LEARN_MIN_SEC = 60;
const LEARN_MIN_KM = 0.1;
const LEARN_RATIO_MIN = 0.8;
const LEARN_RATIO_MAX = 1.25;
const LEARN_KEEP = 12;
const CLASS_CAP_SEC = 900;
export const GLOBAL_W0_SEC = 600;
export const BAND_W0_SEC = 240;
/** Lo guardado antes del 13 nov no trae los segundos de cada clase: se les supone esto. */
const OLD_GLOBAL_SEC = 300;
const OLD_BAND_SEC = 120;
/** (Compatibilidad) nº de clases de una corrección fija, sin historial: las de las pruebas y el reloj simulado. */
export const FACTOR_MIN_CLASSES = 2;
/**
 * Franjas de velocidad de la clase (km/h) para la corrección: menos de 6, 6–8, 8–10, 10–12, 12–14 y 14 o más. Son
 * tramos fijos de 2 km/h, iguales para todo el mundo (no salen de los niveles de nadie). La clave de cada franja es su
 * borde de abajo ('0', '6', '8'…).
 */
export const BAND_EDGES = [6, 8, 10, 12, 14];
export const BAND_KEYS = ['0', ...BAND_EDGES.map(String)];
/** Para que una clase enseñe algo de una franja: este rato estable en ella (s) y esta distancia (km). */
const BAND_MIN_SEC = 30;
const BAND_MIN_KM = 0.05;
/** Serie de la sesión: un punto cada 10 s de clase; como mucho 720 (si se llena, se juntan de dos en dos). */
export const SERIES_STEP = 10;
export const SERIES_MAX = 720;
/**
 * Parado no hay velocidad que enseñar. El podómetro del reloj cuenta también el braceo de estar quieto (mover la mano,
 * coger el móvil): en el iPhone del usuario salió «≈4,2» sin moverse, y «2,3» solo moviendo las manos. Una lectura
 * solo vale como «te estás moviendo» si trae ritmo (≥ 3 km/h: por debajo nadie anda en una cinta) y, cuando el reloj
 * da la cadencia, esta es de andar o correr (≥ 70 pasos/min).
 * Quién lo comprueba: desde la build 25 lo hace el reloj (lecturas cada ~2,5 s, tres seguidas) y lo dice en
 * `speed.moving`; entonces aquí la cifra se enseña en cuanto llega, sin más esperas. Con la build 24 (sin `moving`,
 * y con una lectura cada ~5 s) se comprueba aquí: 2 lecturas seguidas, sin huecos de más de 10 s.
 */
export const MOVING_MIN_KMH = 3;
export const MOVING_MIN_CADENCE = 70;
export const MOVING_STREAK = 2;
const MOVING_GAP_MS = 10000;
/**
 * Con la clase en marcha (≥ 3 km/h), una estimación por debajo del 60 % de lo que marca (o por encima del 160 %) no es
 * «la cinta va a otra velocidad»: es que no estás en ella (parado, en los laterales, agarrado a la barra). No se
 * enseña ni cuenta para nada.
 */
export const RUN_MIN_KMH = 3;
/** En el chip, una lectura deja de valer a los 9 s: si te paras, la cifra se va pronto (el reloj hace lo mismo). */
export const SHOW_FRESH_MS = 9000;
export const PLAUSIBLE_MIN = 0.6;
export const PLAUSIBLE_MAX = 1.6;
/** Para aprender, además, la lectura (sin corregir) tiene que parecerse a la clase: entre el 70 % y el 140 %. */
const LEARN_PAIR_MIN = 0.7;
const LEARN_PAIR_MAX = 1.4;
const MAX_KMH = 30;
const MAX_STEP_KM = 0.5;      // entre dos lecturas no caben más metros: lectura rota
const MAX_PAIR_GAP_MS = 12000; // hueco entre lecturas a partir del cual ese trozo no sirve para aprender

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Lectura del reloj saneada → { kmh | null, km, cadence | null, at, source } o null si no vale.
 * kmh 0…30 (null: parado o aún sin dato), km ≥ 0, cadencia 0…260 pasos/min.
 */
export function cleanSpeed(d) {
  if (!d || typeof d !== 'object') return null;
  const km = num(d.km);
  const at = num(d.at);
  if (!(km >= 0) || !(at > 0)) return null;
  const kmh = num(d.kmh);
  const cad = num(d.cadence);
  return {
    kmh: kmh >= 0 && kmh <= MAX_KMH ? r1(kmh) : null,
    km: r3(km),
    cadence: cad >= 0 && cad <= 260 ? Math.round(cad) : null,
    at: Math.round(at),
    source: typeof d.source === 'string' && d.source ? d.source : 'watch',
    // build 25: el reloj ya dice si te mueves de verdad (sin el campo, se comprueba aquí)
    ...(typeof d.moving === 'boolean' ? { moving: d.moving } : {}),
  };
}

/**
 * Margen (km/h) entre lo que marca la clase y lo que calcula el reloj. `calibrated`: true / false, o la confianza en la
 * corrección (0…1): con toda, 0,5; sin ninguna, 0,5 o el 8 % de la velocidad; a medias, entre los dos.
 */
export function tolerance(classKmh, calibrated) {
  const c = calibrated === true ? 1 : typeof calibrated === 'number' && Number.isFinite(calibrated) ? clamp(calibrated, 0, 1) : 0;
  return DRIFT_KMH + Math.max(0, UNCAL_SHARE * (Number(classKmh) || 0) - DRIFT_KMH) * (1 - c);
}

/** −1 vas por debajo de la clase · 0 coincide · +1 vas por encima. */
export function speedStatus(classKmh, watchKmh, calibrated) {
  const d = watchKmh - classKmh;
  const tol = tolerance(classKmh, calibrated);
  return d > tol + 1e-9 ? 1 : d < -tol - 1e-9 ? -1 : 0;
}

/** ¿Esta lectura es de alguien andando o corriendo? (no de estar quieto moviendo el brazo) */
export function isMoving(sample) {
  if (!sample || sample.moving === false || sample.kmh == null || !(sample.kmh >= MOVING_MIN_KMH)) return false;
  return sample.cadence == null || sample.cadence >= MOVING_MIN_CADENCE;
}

/** ¿Lo que calcula el reloj puede ser la cinta a otra velocidad? (false: no estás corriendo en ella) */
export function plausibleSpeed(classKmh, watchKmh) {
  if (!(classKmh >= RUN_MIN_KMH)) return true;
  const r = watchKmh / classKmh;
  return r >= PLAUSIBLE_MIN && r <= PLAUSIBLE_MAX;
}

/** Franja de una velocidad de la clase → su clave ('0', '6', '8', '10', '12', '14'). */
export function bandKey(kmh) {
  let key = '0';
  for (const e of BAND_EDGES) if (kmh >= e) key = String(e);
  return key;
}

/** [desde, hasta) de una franja en km/h (hasta = null en la última). */
export function bandRange(key) {
  const i = BAND_KEYS.indexOf(String(key));
  if (i < 0) return null;
  return [i === 0 ? 0 : BAND_EDGES[i - 1], i < BAND_EDGES.length ? BAND_EDGES[i] : null];
}

/** «Menos de 6», «8–10», «14 o más» (km/h). */
export function bandLabel(key) {
  const r = bandRange(key);
  if (!r) return '';
  if (r[0] === 0) return `Menos de ${r[1]}`;
  return r[1] == null ? `${r[0]} o más` : `${r[0]}–${r[1]}`;
}

const bandCenter = (key) => {
  const [lo, hi] = bandRange(key);
  return lo === 0 ? hi - 1 : lo + 1;
};
const okRatio = (x) => num(x) >= LEARN_RATIO_MIN && num(x) <= LEARN_RATIO_MAX;

/** Lo aprendido en una corrección (única o de una franja) → [{ r, w }]: clase / reloj de cada clase y sus segundos. */
function entriesOf(c, oldSec) {
  if (!Array.isArray(c?.ratios)) return [];
  const out = [];
  c.ratios.forEach((r, i) => {
    if (!okRatio(r)) return;
    const w = num(c.secs?.[i]);
    out.push({ r, w: Math.min(CLASS_CAP_SEC, w > 0 ? w : oldSec) });
  });
  return out;
}

/** Mediana ponderada (por segundos) de lo que han enseñado las clases. */
function weightedMedian(list) {
  const sorted = [...list].sort((a, b) => a.r - b.r);
  const half = sorted.reduce((a, e) => a + e.w, 0) / 2;
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i].w;
    if (acc > half + 1e-9) return sorted[i].r;
    if (Math.abs(acc - half) <= 1e-9) return i + 1 < sorted.length ? (sorted[i].r + sorted[i + 1].r) / 2 : sorted[i].r;
  }
  return sorted[sorted.length - 1].r;
}

/**
 * Una corrección lista para usar → { f, conf } o null. Con historial (ratios): la mediana ponderada, encogida hacia
 * `base` según los segundos que hay detrás (conf = W / (W + w0)). Sin historial pero con un factor fijo (pruebas y
 * reloj simulado): ese factor, con toda la confianza.
 */
function estimate(c, w0, base, oldSec) {
  if (!c || typeof c !== 'object') return null;
  const list = entriesOf(c, oldSec);
  if (list.length) {
    const W = list.reduce((a, e) => a + e.w, 0);
    const conf = W / (W + w0);
    return { f: clamp(base + (weightedMedian(list) - base) * conf, FACTOR_MIN, FACTOR_MAX), conf };
  }
  if (Array.isArray(c.ratios)) return null;
  const f = num(c.factor);
  return f >= FACTOR_MIN && f <= FACTOR_MAX && (Number(c.n) || 0) >= 1 ? { f, conf: 1 } : null;
}
const globalOf = (cal) => estimate(cal, GLOBAL_W0_SEC, 1, OLD_GLOBAL_SEC);
const usable = (c) => estimate(c, GLOBAL_W0_SEC, 1, OLD_GLOBAL_SEC)?.f ?? null;

/** Tu corrección personal única (cinta / reloj), ya con su peso; null si aún no hay nada aprendido. `cal` = state.watchCal. */
export function calFactor(cal) {
  const g = globalOf(cal);
  return g ? r3(g.f) : null;
}

/**
 * Tu corrección a una velocidad dada (km/h de cinta) y cuánta calibración hay detrás → { f, conf (0…1) } o null si aún
 * no hay nada aprendido. La de su franja (encogida hacia la única según sus segundos); entre dos franjas con datos, la
 * recta que las une (sin saltos en los bordes); más allá de la última franja con datos, vuelve poco a poco (en 2 km/h)
 * a la corrección única; y sin ninguna franja, la única.
 */
export function calAt(cal, kmh) {
  const g = globalOf(cal);
  const pts = [];
  for (const key of BAND_KEYS) {
    const e = estimate(cal?.bands?.[key], BAND_W0_SEC, g ? g.f : 1, OLD_BAND_SEC);
    if (e) pts.push([bandCenter(key), e.f, e.conf]);
  }
  if (!pts.length || !(kmh > 0)) return g ? { f: r3(g.f), conf: g.conf } : null;
  const mix = (a, b, u) => a + (b - a) * u;
  const out = (edge, d) => {
    const u = g == null || d <= 1 ? 0 : Math.min(1, (d - 1) / 2);
    return { f: r3(mix(edge[1], g ? g.f : edge[1], u)), conf: mix(edge[2], g ? g.conf : edge[2], u) };
  };
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (kmh <= first[0]) return out(first, first[0] - kmh);
  if (kmh >= last[0]) return out(last, kmh - last[0]);
  for (let i = 1; i < pts.length; i++) {
    if (kmh <= pts[i][0]) {
      const u = (kmh - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      return { f: r3(mix(pts[i - 1][1], pts[i][1], u)), conf: mix(pts[i - 1][2], pts[i][2], u) };
    }
  }
  return g ? { f: r3(g.f), conf: g.conf } : null;
}

/** Solo el factor de calAt (o null). */
export function calFactorAt(cal, kmh) {
  return calAt(cal, kmh)?.f ?? null;
}

/**
 * Lo que calcula el reloj (km/h sin corregir) → velocidad de cinta más probable. La corrección depende de la velocidad
 * de verdad, que es justo lo que se busca: se parte de la corrección única y se afina cuatro veces con la de su franja
 * (cada vuelta deja el error en un tercio: con cuatro queda por debajo de 0,01 km/h).
 * → { kmh, k (factor aplicado), calibrated (hay algo aprendido), conf (0…1: cuánto hay detrás de esa corrección) }
 */
export function correctSpeed(cal, raw) {
  const g = globalOf(cal);
  let k = g ? g.f : 1;
  let conf = g ? g.conf : 0;
  let calibrated = !!g;
  for (let i = 0; i < 4; i++) {
    const c = calAt(cal, raw * k);
    if (!c) break;
    k = c.f;
    conf = c.conf;
    calibrated = true;
  }
  return { kmh: raw * k, k, calibrated, conf };
}

/**
 * Aprende de una clase una corrección (la única, o la de una franja): `ratio` = distancia de la clase / distancia del
 * reloj en sus tramos estables, `sec` = cuántos segundos estables hay detrás (su peso). Guarda las 12 últimas clases.
 * `base`: hacia dónde se encoge (1 para la única; la única para una franja). → corrección nueva (o la misma si el
 * ratio es un disparate).
 */
export function learnFactor(cal, ratio, { now = Date.now(), sec = OLD_GLOBAL_SEC, base = 1, w0 = GLOBAL_W0_SEC, oldSec = OLD_GLOBAL_SEC } = {}) {
  if (!okRatio(ratio)) return cal || null;
  const prev = entriesOf(cal, oldSec);
  const all = [...prev, { r: r3(ratio), w: Math.max(1, Math.round(Math.min(CLASS_CAP_SEC, num(sec) > 0 ? sec : oldSec))) }].slice(-LEARN_KEEP);
  const next = { ratios: all.map((e) => e.r), secs: all.map((e) => Math.round(e.w)) };
  const e = estimate(next, w0, base, oldSec);
  return {
    ...(cal?.bands ? { bands: cal.bands } : {}),
    factor: r3(e.f), n: all.length, ...next, updatedAt: new Date(now).toISOString(),
  };
}

/**
 * Aprende de una clase la corrección única y la de cada franja. `learned` = lo que da learned() del seguimiento:
 * { ratio, sec, bands: { clave: { ratio, sec } } } (se admite también la forma de antes, con los ratios sueltos).
 * Lo ya guardado se conserva: un watchCal de antes (solo con la corrección única, sin segundos) sigue valiendo y las
 * franjas se van añadiendo. → state.watchCal nuevo (o el mismo si no hay nada que aprender).
 */
export function learnCal(cal, learned, { now = Date.now() } = {}) {
  if (!learned) return cal || null;
  let out = learned.ratio != null ? learnFactor(cal, learned.ratio, { now, sec: learned.sec }) : cal || null;
  const base = globalOf(out)?.f ?? 1;
  const bands = { ...(out?.bands || {}) };
  let any = false;
  for (const key of BAND_KEYS) {
    const raw = learned.bands?.[key];
    const r = raw && typeof raw === 'object' ? raw.ratio : raw;
    if (r == null) continue;
    const sec = raw && typeof raw === 'object' ? raw.sec : OLD_BAND_SEC;
    const b = learnFactor(bands[key] || null, r, { now, sec, base, w0: BAND_W0_SEC, oldSec: OLD_BAND_SEC });
    if (!b || b === bands[key]) continue;
    bands[key] = { factor: b.factor, n: b.n, ratios: b.ratios, secs: b.secs };
    any = true;
  }
  if (any) out = { ...(out || {}), bands, updatedAt: new Date(now).toISOString() };
  return out;
}

/**
 * Qué ha cambiado al aprender de una clase, para el diagnóstico y para comprobarlo: la corrección única y la de cada
 * franja que la clase ha tocado, antes y después, con los minutos estables que ha aportado.
 * → { unico: { min, antes, despues } | null, franjas: [{ key, label, min, antes, despues }] }
 */
export function calReport(before, after, learned) {
  const f = (cal, kmh) => (kmh == null ? calFactor(cal) : calFactorAt(cal, kmh)) ?? 1;
  const min = (sec) => r1((num(sec) || 0) / 60);
  const out = { unico: null, franjas: [] };
  if (!learned) return out;
  if (learned.ratio != null) out.unico = { min: min(learned.sec), antes: f(before), despues: f(after) };
  for (const key of BAND_KEYS) {
    const b = learned.bands?.[key];
    if (b == null) continue;
    const c = bandCenter(key);
    out.franjas.push({ key, label: bandLabel(key), min: min(typeof b === 'object' ? b.sec : OLD_BAND_SEC), antes: f(before, c), despues: f(after, c) });
  }
  return out;
}

/** Texto del aviso de desvío. */
export function driftText(appKmh, watchKmh) {
  const f = (v) => r1(v).toFixed(1).replace('.', ',');
  return `La app marca ${f(appKmh)} y el Watch calcula unos ${f(watchKmh)}: ¿has cambiado la cinta?`;
}

/**
 * Seguimiento de una clase.
 * opts: { cal (state.watchCal: corrección única y por franjas ya aprendidas) o factor (solo la única; para pruebas),
 *   restore (snapshot() de antes, al retomar la clase) }
 * ctx (en add y tick): { t (ms de reloj), appKmh (velocidad que marca la clase), appKm (distancia de la clase),
 *   running (la clase corre, no en pausa), elapsed (s de clase, para la serie; opcional) }
 */
export function createSpeedTracker(opts = {}) {
  const cal = opts.cal && typeof opts.cal === 'object'
    ? opts.cal
    : num(opts.factor) >= FACTOR_MIN && num(opts.factor) <= FACTOR_MAX ? { factor: opts.factor, n: FACTOR_MIN_CLASSES } : null;
  const factor = calFactor(cal);                       // la corrección única (para las distancias y el resumen)
  const k = factor ?? 1;
  const fix = (raw) => correctSpeed(cal, raw);         // lectura del reloj → km/h de cinta, con la de su franja
  const anyCal = factor != null || BAND_KEYS.some((key) => usable(cal?.bands?.[key]) != null);
  let stableOff = false;      // (para real()) la última lectura fiable llegó con la clase ya asentada

  let last = null;            // última lectura: { kmh, km, cadence, at, source, rx }
  let prev = null;            // para emparejar: { km, appKm, t, steady }
  let n = 0;                  // lecturas de esta clase
  let firstKm = null;         // lo que ya llevaba el reloj en la primera lectura
  let wKm = 0;                // km del reloj entre lecturas (emparejados con los de la clase)
  let aKm = 0;                // km de la clase en esos mismos trozos
  let pairMs = 0;
  let sW = 0;                 // lo mismo, solo en tramos estables (para aprender)
  let sA = 0;
  let sMs = 0;
  let touched = false;        // has tocado la velocidad a mano: de esta clase no se aprende
  const bands = {};           // por franja de la clase, en tramos estables: { w, a, ms, cad, cms }
  // cadencia (pasos/min) y zancada (m), con peso por tiempo; la zancada solo en tramos estables
  let cadSum = 0;
  let cadMs = 0;
  let strSum = 0;
  let strMs = 0;
  // serie de la sesión: [[s de clase, km/h del reloj sin corregir | null, cadencia | null, km/h de la clase], …]
  let series = [];
  let step = SERIES_STEP;
  let bucket = null;          // { i, w, wn, c, cn, a, an }
  // ¿te estás moviendo de verdad? (lecturas seguidas de andar o correr, y creíbles frente a la clase)
  let streak = 0;
  let lastMoveT = null;
  let trust = false;          // la última lectura se puede enseñar, comparar y usar para aprender
  // desvío
  let appKmh = null;
  let running = false;
  let changeAt = null;        // último cambio de velocidad de la clase (o arranque / reanudación)
  let stretch = 0;            // nº de tramo estable (sube con cada cambio)
  let offSince = null;
  let offSign = 0;
  let alertAt = null;
  let alertStretch = -1;
  let pending = null;

  const s0 = opts.restore;
  if (s0 && typeof s0 === 'object') {
    n = Math.max(0, Math.round(num(s0.n) || 0));
    firstKm = num(s0.firstKm) >= 0 ? s0.firstKm : null;
    wKm = Math.max(0, num(s0.wKm) || 0);
    aKm = Math.max(0, num(s0.aKm) || 0);
    pairMs = Math.max(0, num(s0.pairMs) || 0);
    sW = Math.max(0, num(s0.sW) || 0);
    sA = Math.max(0, num(s0.sA) || 0);
    sMs = Math.max(0, num(s0.sMs) || 0);
    touched = !!s0.touched;
    if (s0.bands && typeof s0.bands === 'object') {
      for (const key of BAND_KEYS) {
        const b = s0.bands[key];
        if (!b || typeof b !== 'object') continue;
        bands[key] = { w: Math.max(0, num(b.w) || 0), a: Math.max(0, num(b.a) || 0), ms: Math.max(0, num(b.ms) || 0),
          cad: Math.max(0, num(b.cad) || 0), cms: Math.max(0, num(b.cms) || 0) };
      }
    }
    cadSum = Math.max(0, num(s0.cadSum) || 0);
    cadMs = Math.max(0, num(s0.cadMs) || 0);
    strSum = Math.max(0, num(s0.strSum) || 0);
    strMs = Math.max(0, num(s0.strMs) || 0);
    if (Array.isArray(s0.series)) series = s0.series.filter((x) => Array.isArray(x) && x.length >= 4).map((x) => x.slice(0, 4));
    if (num(s0.step) >= SERIES_STEP) step = s0.step;
  }

  const pointOf = (b) => [(b.i + 1) * step, b.wn ? r1(b.w / b.wn) : null, b.cn ? Math.round(b.c / b.cn) : null, r1(b.a / b.an)];

  /** Cierra el cubo en curso de la serie (un punto) y, si la serie se llena, junta los puntos de dos en dos. */
  function flush() {
    const b = bucket;
    bucket = null;
    if (!b || !b.an) return;
    series.push(pointOf(b));
    if (series.length <= SERIES_MAX) return;
    const mean = (x, y) => (x == null ? y : y == null ? x : (x + y) / 2);
    const half = [];
    for (let i = 0; i + 1 < series.length; i += 2) {
      const p = series[i];
      const q = series[i + 1];
      const w = mean(p[1], q[1]);
      const c = mean(p[2], q[2]);
      half.push([q[0], w == null ? null : r1(w), c == null ? null : Math.round(c), r1((p[3] + q[3]) / 2)]);
    }
    if (series.length % 2) half.push(series[series.length - 1]);
    series = half;
    step *= 2;
  }

  /** Apunta una lectura en la serie (cubos de `step` s de clase). */
  function toSeries(elapsed, raw, cadence) {
    if (!Number.isFinite(elapsed) || elapsed < 0 || !(appKmh > 0)) return;
    const i = Math.max(0, Math.ceil(elapsed / step) - 1);   // el segundo 600 cierra el cubo 590–600, no abre otro
    if (bucket && bucket.i !== i) flush();
    if (!bucket) {
      // has vuelto atrás en la clase (⏮): lo de aquí en adelante se repite, se quita
      while (series.length && series[series.length - 1][0] >= (i + 1) * step) series.pop();
      bucket = { i, w: 0, wn: 0, c: 0, cn: 0, a: 0, an: 0 };
    }
    bucket.a += appKmh;
    bucket.an++;
    if (raw != null) { bucket.w += raw; bucket.wn++; }
    if (cadence != null) { bucket.c += cadence; bucket.cn++; }
  }

  function note(ctx) {
    const t = num(ctx?.t);
    if (!Number.isFinite(t)) return;
    const v = num(ctx.appKmh);
    const run = !!ctx.running;
    if (changeAt == null || run !== running || (Number.isFinite(v) && (appKmh == null || Math.abs(v - appKmh) >= 0.05))) {
      changeAt = t;
      stretch++;
      offSince = null;
    }
    running = run;
    if (Number.isFinite(v)) appKmh = v;
  }
  const settledFor = (t, sec) => running && changeAt != null && t - changeAt >= sec * 1000;

  return {
    /** La corrección única ya aprendida (o null). */
    factor: () => factor,
    calibrated: () => anyCal,
    /**
     * La corrección que toca AHORA (la de la velocidad que llevas, o la de lo que marca la clase si no hay lectura),
     * para mandársela al reloj: así su pantalla enseña lo mismo que el móvil. null si aún no hay nada aprendido.
     */
    factorNow(t) {
      if (last && trust && last.kmh != null && t - last.rx <= SHOW_FRESH_MS) {
        const c = fix(last.kmh);
        if (c.calibrated) return r3(c.k);
      }
      return appKmh > 0 ? calFactorAt(cal, appKmh) : factor;
    },
    /** Has tocado la velocidad a mano (− / +, o la intensidad del reloj). */
    touch() { touched = true; },
    /** Cada tick del motor: sigue los cambios de velocidad de la clase aunque no lleguen lecturas. */
    tick(ctx) {
      note(ctx);
      const t = num(ctx?.t);
      // Sin lecturas frescas no hay desvío que contar
      if (last && Number.isFinite(t) && t - last.rx > SPEED_FRESH_MS) offSince = null;
    },
    /** Lectura nueva del reloj (ya saneada con cleanSpeed). */
    add(sample, ctx) {
      if (!sample) return false;
      note(ctx);
      const t = num(ctx?.t);
      if (!Number.isFinite(t)) return false;
      if (last && sample.at <= last.at) return false; // repetida o vieja
      const appNow = num(ctx.appKm);
      n++;
      if (firstKm == null) firstKm = sample.km;
      // ¿Andando o corriendo de verdad? Tres lecturas seguidas así, y que cuadren con lo que pide la clase
      if (isMoving(sample)) {
        streak = lastMoveT != null && t - lastMoveT <= MOVING_GAP_MS ? streak + 1 : 1;
        lastMoveT = t;
      } else {
        streak = 0;
        lastMoveT = null;
      }
      // Lo que el reloj ya ha comprobado (build 25, `moving: true`) vale al momento; si no, 2 lecturas seguidas
      const need = sample.moving === true ? 1 : MOVING_STREAK;
      trust = streak >= need && (!running || appKmh == null || plausibleSpeed(appKmh, fix(sample.kmh).kmh));
      const like = trust && appKmh > 0 && sample.kmh / appKmh >= LEARN_PAIR_MIN && sample.kmh / appKmh <= LEARN_PAIR_MAX;
      const steady = like && settledFor(t, LEARN_SETTLE_SEC) && appKmh >= LEARN_MIN_KMH;
      if (prev && Number.isFinite(appNow)) {
        const dW = sample.km - prev.km;
        const dA = appNow - prev.appKm;
        const dT = t - prev.t;
        if (dW < -0.005) {
          // el contador del reloj volvió a empezar (su app se reinició): lo anterior ya está sumado
        } else if (dW >= 0 && dW <= MAX_STEP_KM && dA >= 0 && dA <= MAX_STEP_KM && dT > 0) {
          wKm += dW;
          aKm += dA;
          pairMs += dT;
          if (steady && prev.steady && dT <= MAX_PAIR_GAP_MS) {
            sW += dW; sA += dA; sMs += dT;
            // lo mismo, en la franja de lo que marca la clase
            const b = (bands[bandKey(appKmh)] ||= { w: 0, a: 0, ms: 0, cad: 0, cms: 0 });
            b.w += dW; b.a += dA; b.ms += dT;
            if (sample.cadence != null) { b.cad += sample.cadence * dT; b.cms += dT; }
          }
        }
        // Cadencia y zancada (velocidad de la clase ÷ cadencia), solo moviéndote de verdad y sin huecos
        if (trust && sample.cadence != null && sample.cadence >= MOVING_MIN_CADENCE && dT > 0 && dT <= MAX_PAIR_GAP_MS) {
          cadSum += sample.cadence * dT;
          cadMs += dT;
          if (steady && prev.steady) { strSum += (appKmh / 0.06 / sample.cadence) * dT; strMs += dT; }
        }
      }
      prev = { km: sample.km, appKm: Number.isFinite(appNow) ? appNow : prev?.appKm ?? 0, t, steady };
      last = { ...sample, rx: t };
      if (running) toSeries(num(ctx.elapsed), trust ? sample.kmh : null, trust ? sample.cadence : null);

      stableOff = trust && appKmh != null && settledFor(t, SETTLE_SEC);
      // Desvío: solo con velocidad estable, moviéndote de verdad y siempre hacia el mismo lado
      if (!stableOff) { offSince = null; return true; }
      const c = fix(sample.kmh);
      const w = c.kmh;
      // el margen depende de cuánta calibración hay detrás: con poca, más ancho (el reloj aún puede ir desviado)
      const st = speedStatus(appKmh, w, c.conf);
      // «0,5 o más»: el borde también cuenta
      const far = st !== 0 || Math.abs(w - appKmh) >= tolerance(appKmh, c.conf) - 1e-9;
      const sign = w >= appKmh ? 1 : -1;
      if (!far) { offSince = null; return true; }
      if (offSince == null || sign !== offSign) { offSince = t; offSign = sign; }
      if (t - offSince >= DRIFT_SEC * 1000 && alertStretch !== stretch && (alertAt == null || t - alertAt >= DRIFT_REPEAT_SEC * 1000)) {
        alertAt = t;
        alertStretch = stretch;
        pending = { app: r1(appKmh), watch: r1(w), text: driftText(appKmh, w) };
      }
      return true;
    },
    /** Aviso pendiente (una vez): { app, watch, text } o null. */
    drift() {
      const p = pending;
      pending = null;
      return p;
    },
    /**
     * Lo que se enseña ahora: null si el reloj no ha mandado nada en esta clase.
     * { kmh (ya corregida; null si no hay lectura fresca, estás parado o no cuadra con la clase), raw, km, cadence,
     *   calibrated, off (lleva ≥ 20 s desviado), dev (km/h frente a la clase), fresh }
     */
    view(t) {
      if (!last) return null;
      const fresh = t - last.rx <= SPEED_FRESH_MS;
      const c = trust && last.kmh != null && t - last.rx <= SHOW_FRESH_MS ? fix(last.kmh) : null;
      const kmh = c ? r1(c.kmh) : null;
      const off = kmh != null && offSince != null && t - offSince >= DRIFT_SEC * 1000;
      return {
        kmh, raw: fresh ? last.kmh : null, km: r3((firstKm + wKm) * k), cadence: fresh ? last.cadence : null,
        calibrated: c ? c.calibrated : anyCal, off, dev: kmh != null && appKmh != null ? r1(kmh - appKmh) : null, fresh, source: last.source,
      };
    },
    /**
     * La velocidad REAL más probable ahora mismo (para quien quiera usarla: control por pulso, análisis). null si no hay
     * lectura fresca y fiable (parado, braceo, sin reloj, lectura de hace más de 9 s o que no cuadra con la clase).
     * → { kmh (de cinta, ya corregidos), raw (lo que marca el reloj), cadence | null, conf (0…1: cuánta calibración
     *     hay detrás de esa corrección), ok (conf ≥ 0,5 y la clase lleva ≥ 20 s a la misma velocidad: se puede decidir
     *     con ella; si no, solo orienta), dev (kmh − lo que marca la clase) }
     */
    real(t) {
      if (!last || !trust || last.kmh == null || !(t - last.rx <= SHOW_FRESH_MS)) return null;
      const c = fix(last.kmh);
      const kmh = r1(c.kmh);
      return {
        kmh, raw: last.kmh, cadence: last.cadence, conf: r2(c.conf),
        ok: c.conf >= 0.5 && stableOff && settledFor(t, SETTLE_SEC),
        dev: appKmh != null ? r1(kmh - appKmh) : null,
      };
    },
    /** Para guardar en la sesión (session.watchSpeed); null con menos de 5 lecturas. */
    summary() {
      if (n < 5 || !(pairMs > 0)) return null;
      const out = {
        source: last?.source || 'watch',
        km: r3(firstKm + wKm),                              // lo que el reloj dice que has corrido (sin corregir)
        pairKm: r3(wKm),                                    // …y lo que midió en el mismo rato que `appKm` (para comparar)
        avgKmh: r1(wKm / (pairMs / 3600000)),               // su media mientras hubo lecturas
        appKm: r3(aKm),                                     // lo que marcó la clase en ese mismo rato
        sec: Math.round(pairMs / 1000),
        samples: n,
      };
      if (factor != null) out.factor = factor;
      const ratio = this.classRatio();
      if (ratio != null) out.ratio = ratio;
      if (touched) out.touched = true;
      // Cadencia media (pasos/min) y zancada media (m: velocidad de la clase ÷ cadencia, en tramos estables)
      if (cadMs >= 30000) out.cadence = Math.round(cadSum / cadMs);
      if (strMs >= 30000) out.stride = r2(strSum / strMs);
      // Por franja de velocidad de la clase (tramos estables de al menos 30 s): clase / reloj, cadencia y zancada
      const byBand = {};
      for (const key of BAND_KEYS) {
        const b = bands[key];
        if (!b || b.ms < 30000 || !(b.w > 0)) continue;
        const e = { sec: Math.round(b.ms / 1000), appKm: r3(b.a), km: r3(b.w), ratio: r3(b.a / b.w) };
        if (b.cms >= 30000) {
          e.cadence = Math.round(b.cad / b.cms);
          e.stride = r2((b.a / (b.ms / 3600000)) / 0.06 / e.cadence);
        }
        byBand[key] = e;
      }
      if (Object.keys(byBand).length) out.bands = byBand;
      // Lo que esta clase enseña a tu corrección (para poder comprobarlo después, sesión a sesión)
      const learn = this.learned();
      if (learn) out.learn = learn;
      return out;
    },
    /** La serie de la clase para la sesión (session.watchSeries): [[s, km/h reloj | null, cadencia | null, km/h clase], …]. */
    series() {
      const out = series.map((x) => x.slice());
      if (bucket && bucket.an) out.push(pointOf(bucket)); // el cubo en curso, sin cerrarlo: la clase puede seguir
      return out;
    },
    /**
     * Lo que esta clase enseña de tu corrección, haya o no cambios de velocidad a mano (solo cuentan los tramos
     * estables): { ratio (clase / reloj en todos ellos, o null), sec (segundos estables), bands: { franja: { ratio,
     * sec } } }. null si no hay bastante de nada (menos de 1 min estable en total y de 30 s en cada franja).
     */
    learned() {
      const out = { ratio: this.classRatio(), sec: Math.round(sMs / 1000), bands: {} };
      for (const key of BAND_KEYS) {
        const b = bands[key];
        if (!b || b.ms < BAND_MIN_SEC * 1000 || b.w < BAND_MIN_KM) continue;
        const r = b.a / b.w;
        if (r >= LEARN_RATIO_MIN && r <= LEARN_RATIO_MAX) out.bands[key] = { ratio: r3(r), sec: Math.round(b.ms / 1000) };
      }
      return out.ratio == null && !Object.keys(out.bands).length ? null : out;
    },
    /**
     * Clase / reloj en los tramos estables de esta clase. null con menos de 1 min estable o si sale un disparate (eso
     * no es sesgo del reloj: la cinta iba a otra cosa).
     */
    classRatio() {
      if (sMs < LEARN_MIN_SEC * 1000 || sW < LEARN_MIN_KM) return null;
      const ratio = sA / sW;
      return ratio >= LEARN_RATIO_MIN && ratio <= LEARN_RATIO_MAX ? r3(ratio) : null;
    },
    /** Para la instantánea de la clase a medias. */
    snapshot() {
      if (!n) return null;
      const bb = {};
      for (const key of BAND_KEYS) {
        const b = bands[key];
        if (b) bb[key] = { w: r3(b.w), a: r3(b.a), ms: Math.round(b.ms), cad: Math.round(b.cad), cms: Math.round(b.cms) };
      }
      return {
        n, firstKm, wKm: r3(wKm), aKm: r3(aKm), pairMs: Math.round(pairMs), sW: r3(sW), sA: r3(sA), sMs: Math.round(sMs), touched,
        bands: bb, cadSum: Math.round(cadSum), cadMs: Math.round(cadMs), strSum: r2(strSum), strMs: Math.round(strMs),
        series: this.series(), step,
      };
    },
  };
}

/**
 * La serie de una sesión, comparada: reloj frente a clase por franjas de velocidad, con cadencia y zancada. Solo cuentan
 * los puntos con lectura del reloj y la clase a la misma velocidad desde hace 2 puntos (tramo estable: la cinta y la
 * estimación ya han llegado). → { sec, diffPct, bands: [{ key, label, sec, appKmh, watchKmh, diffPct, cadence, stride }] }
 * o null si no hay con qué. diffPct = cuánto marca el reloj de más (+) o de menos (−) que la clase, en %.
 */
export function seriesCompare(seriesIn, { minSec = 60 } = {}) {
  const pts = Array.isArray(seriesIn) ? seriesIn.filter((p) => Array.isArray(p) && p.length >= 4 && num(p[3]) > 0) : [];
  if (pts.length < 3) return null;
  const acc = {};
  const all = { sec: 0, a: 0, w: 0 };
  for (let i = 2; i < pts.length; i++) {
    const [t, w, c, a] = pts[i];
    const dt = t - pts[i - 1][0];
    if (w == null || !(dt > 0) || dt > 120) continue;
    if (Math.abs(pts[i - 1][3] - a) >= 0.05 || Math.abs(pts[i - 2][3] - a) >= 0.05) continue;
    const b = (acc[bandKey(a)] ||= { sec: 0, a: 0, w: 0, c: 0, cs: 0, st: 0 });
    b.sec += dt; b.a += a * dt; b.w += w * dt;
    all.sec += dt; all.a += a * dt; all.w += w * dt;
    if (c != null && c >= MOVING_MIN_CADENCE) { b.c += c * dt; b.cs += dt; b.st += (a / 0.06 / c) * dt; }
  }
  const bandsOut = [];
  for (const key of BAND_KEYS) {
    const b = acc[key];
    if (!b || b.sec < minSec) continue;
    const e = {
      key, label: bandLabel(key), sec: Math.round(b.sec), appKmh: r1(b.a / b.sec), watchKmh: r1(b.w / b.sec),
      diffPct: r1((b.w / b.a - 1) * 100),
    };
    if (b.cs >= 30) { e.cadence = Math.round(b.c / b.cs); e.stride = r2(b.st / b.cs); }
    bandsOut.push(e);
  }
  if (!bandsOut.length) return null;
  return { sec: Math.round(all.sec), diffPct: r1((all.w / all.a - 1) * 100), bands: bandsOut };
}

/**
 * La serie de una sesión con la velocidad del reloj ya corregida con la calibración de ahora (`cal` = state.watchCal).
 * → [[s de clase, km/h de cinta | null, cadencia | null, km/h de la clase], …]
 */
export function seriesReal(seriesIn, cal) {
  return (Array.isArray(seriesIn) ? seriesIn : [])
    .filter((p) => Array.isArray(p) && p.length >= 4)
    .map(([t, w, c, a]) => [t, w == null ? null : r1(correctSpeed(cal, w).kmh), c ?? null, a]);
}

/**
 * Reloj frente a clase de una sesión guardada, listo para pintar (tarjeta del Resumen). Usa la serie si la hay
 * (session.watchSeries); si no, las franjas guardadas en session.watchSpeed; y si tampoco, solo el total.
 * → { appKm, watchKm, diffPct, cadence?, stride?, sim, learned: ['6–8', …] (franjas que esta clase ha enseñado), bands: [{ key, label, sec, appKmh?, watchKmh?, diffPct,
 *     cadence?, stride? }] } o null si la sesión no tiene datos del reloj.
 */
export function watchCompare(session) {
  const ws = session?.watchSpeed;
  if (!ws || typeof ws !== 'object' || !(num(ws.appKm) > 0) || !(num(ws.km) > 0)) return null;
  // Se comparan las distancias del mismo rato (pairKm); las sesiones de antes solo tienen el total del reloj (km)
  const wKm = num(ws.pairKm) > 0 ? ws.pairKm : ws.km;
  const out = {
    appKm: r2(ws.appKm), watchKm: r2(wKm), diffPct: r1((wKm / ws.appKm - 1) * 100), sim: !!ws.sim, bands: [],
  };
  if (num(ws.cadence) > 0) out.cadence = Math.round(ws.cadence);
  if (num(ws.stride) > 0) out.stride = r2(ws.stride);
  out.learned = ws.learn && typeof ws.learn === 'object' && !ws.sim
    ? BAND_KEYS.filter((key) => ws.learn.bands?.[key] != null).map(bandLabel)
    : [];
  const cmp = seriesCompare(session.watchSeries);
  if (cmp) {
    out.bands = cmp.bands;
  } else if (ws.bands && typeof ws.bands === 'object') {
    for (const key of BAND_KEYS) {
      const b = ws.bands[key];
      if (!b || !(num(b.ratio) > 0) || !(num(b.sec) >= 60)) continue;
      const e = { key, label: bandLabel(key), sec: Math.round(b.sec), diffPct: r1((1 / b.ratio - 1) * 100) };
      if (num(b.appKm) > 0) { e.appKmh = r1(b.appKm / (b.sec / 3600)); e.watchKmh = r1(num(b.km) / (b.sec / 3600)); }
      if (num(b.cadence) > 0) e.cadence = Math.round(b.cadence);
      if (num(b.stride) > 0) e.stride = r2(b.stride);
      out.bands.push(e);
    }
  }
  return out;
}

/**
 * Reloj simulado para verlo sin correr (?debug=speed en el reproductor): sigue la velocidad de la clase con el
 * retraso de una estimación de verdad, un 4 % por encima (el sesgo medido) y, si se pide, con la cinta puesta a otra
 * velocidad (`offset` km/h frente a la clase). Con `still`, hace de alguien quieto moviendo la mano: lecturas de 4,2
 * km/h con cadencia de braceo (lo que salió en el iPhone el 12 nov), que no deben enseñar ninguna cifra.
 * Sin `bias`, el reloj simulado se queda corto cuanto más rápido vas (como en la primera clase real): clava a 7 km/h
 * y marca un 3,5 % menos por cada km/h de más; `cal` es la corrección por franjas que le corresponde, para que la
 * demostración enseñe ya el chip corregido. Con `bias` (un número), el sesgo es fijo.
 * next(ctx) → lectura cada 3 s, o null si aún no toca.
 */
export function createSpeedSim({ offset = 0, bias = null, every = 3000, still = false } = {}) {
  let v = null;
  let km = 0;
  let lastAt = null;
  const biasAt = (kmh) => (bias != null ? bias : clamp(1 - 0.035 * (kmh - 7), 0.8, 1.05));
  const cal = bias != null
    ? { factor: r3(1 / bias), n: FACTOR_MIN_CLASSES }
    : {
      factor: r3(1 / biasAt(9)), n: FACTOR_MIN_CLASSES,
      bands: Object.fromEntries(BAND_KEYS.map((key) => {
        const [lo, hi] = bandRange(key);
        return [key, { factor: r3(1 / biasAt(lo === 0 ? hi - 1 : lo + 1)), n: FACTOR_MIN_CLASSES }];
      })),
    };
  return {
    bias: bias ?? biasAt(9),
    cal,
    next({ t, appKmh, running }) {
      if (!running) { lastAt = null; return null; }
      if (lastAt == null) { lastAt = t; return null; }
      const dt = t - lastAt;
      if (dt < every) return null;
      lastAt = t;
      if (still) {
        km += (4.2 * dt) / 3600000;
        return cleanSpeed({ kmh: 4.2 + 0.2 * Math.sin(t / 5000), km, cadence: 38, at: t, source: 'watch' });
      }
      const belt = Math.max(0, (Number(appKmh) || 0) + offset);
      const target = belt * biasAt(belt);
      v = v == null ? target : v + (target - v) * (1 - Math.exp(-dt / 6000));
      const wob = 0.08 * Math.sin(t / 7000);
      km += (v * dt) / 3600000;
      return cleanSpeed({ kmh: v + wob, km, cadence: v > 2 ? 150 + v * 1.8 : 0, at: t, source: 'watch' });
    },
  };
}
