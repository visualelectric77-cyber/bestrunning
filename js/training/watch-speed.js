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
/** La corrección personal (cinta / reloj) nunca sale de aquí; fuera de esto no es sesgo, es otra cosa. */
export const FACTOR_MIN = 0.85;
export const FACTOR_MAX = 1.15;
/** Para aprender de una clase: tramos estables (s tras el cambio), a partir de esta velocidad y con este mínimo. */
const LEARN_SETTLE_SEC = 30;
const LEARN_MIN_KMH = 6;
const LEARN_MIN_SEC = 300;
const LEARN_MIN_KM = 0.3;
const LEARN_RATIO_MIN = 0.8;
const LEARN_RATIO_MAX = 1.25;
const LEARN_KEEP = 8;
/** Con cuántas clases ya se usa la corrección. */
export const FACTOR_MIN_CLASSES = 2;
const MAX_KMH = 30;
const MAX_STEP_KM = 0.5;      // entre dos lecturas no caben más metros: lectura rota
const MAX_PAIR_GAP_MS = 12000; // hueco entre lecturas a partir del cual ese trozo no sirve para aprender

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const r1 = (v) => Math.round(v * 10) / 10;
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
  };
}

/** Margen (km/h) entre lo que marca la clase y lo que calcula el reloj. */
export function tolerance(classKmh, calibrated) {
  return calibrated ? DRIFT_KMH : Math.max(DRIFT_KMH, UNCAL_SHARE * (Number(classKmh) || 0));
}

/** −1 vas por debajo de la clase · 0 coincide · +1 vas por encima. */
export function speedStatus(classKmh, watchKmh, calibrated) {
  const d = watchKmh - classKmh;
  const tol = tolerance(classKmh, calibrated);
  return d > tol + 1e-9 ? 1 : d < -tol - 1e-9 ? -1 : 0;
}

/** Tu corrección personal (cinta / reloj) si ya hay bastantes clases; si no, null. `cal` = state.watchCal. */
export function calFactor(cal) {
  const f = num(cal?.factor);
  return f >= FACTOR_MIN && f <= FACTOR_MAX && (Number(cal?.n) || 0) >= FACTOR_MIN_CLASSES ? f : null;
}

/**
 * Aprende de una clase: `ratio` = distancia de la clase / distancia del reloj en sus tramos estables (classRatio()).
 * Guarda las 8 últimas y usa la mediana (una clase rara no la mueve). → state.watchCal nuevo.
 */
export function learnFactor(cal, ratio, { now = Date.now() } = {}) {
  const prev = Array.isArray(cal?.ratios) ? cal.ratios.filter((x) => num(x) >= LEARN_RATIO_MIN && num(x) <= LEARN_RATIO_MAX) : [];
  if (!(num(ratio) >= LEARN_RATIO_MIN && num(ratio) <= LEARN_RATIO_MAX)) return cal || null;
  const ratios = [...prev, r3(ratio)].slice(-LEARN_KEEP);
  const sorted = [...ratios].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { factor: r3(clamp(median, FACTOR_MIN, FACTOR_MAX)), n: ratios.length, ratios, updatedAt: new Date(now).toISOString() };
}

/** Texto del aviso de desvío. */
export function driftText(appKmh, watchKmh) {
  const f = (v) => r1(v).toFixed(1).replace('.', ',');
  return `La app marca ${f(appKmh)} y el Watch calcula unos ${f(watchKmh)}: ¿has cambiado la cinta?`;
}

/**
 * Seguimiento de una clase.
 * opts: { factor (corrección ya aprendida o null), restore (snapshot() de antes, al retomar la clase) }
 * ctx (en add y tick): { t (ms de reloj), appKmh (velocidad que marca la clase), appKm (distancia de la clase),
 *   running (la clase corre, no en pausa) }
 */
export function createSpeedTracker(opts = {}) {
  const factor = num(opts.factor) >= FACTOR_MIN && num(opts.factor) <= FACTOR_MAX ? opts.factor : null;
  const calibrated = factor != null;
  const k = factor ?? 1;

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
    factor: () => factor,
    calibrated: () => calibrated,
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
      const steady = settledFor(t, LEARN_SETTLE_SEC) && appKmh >= LEARN_MIN_KMH;
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
          if (steady && prev.steady && dT <= MAX_PAIR_GAP_MS) { sW += dW; sA += dA; sMs += dT; }
        }
      }
      prev = { km: sample.km, appKm: Number.isFinite(appNow) ? appNow : prev?.appKm ?? 0, t, steady };
      last = { ...sample, rx: t };

      // Desvío: solo con velocidad estable, lectura con ritmo y siempre hacia el mismo lado
      if (sample.kmh == null || appKmh == null || !settledFor(t, SETTLE_SEC)) { offSince = null; return true; }
      const w = sample.kmh * k;
      const st = speedStatus(appKmh, w, calibrated);
      // «0,5 o más»: el borde también cuenta
      const far = st !== 0 || Math.abs(w - appKmh) >= tolerance(appKmh, calibrated) - 1e-9;
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
     * { kmh (ya corregida; null si no hay lectura fresca o estás parado), raw, km, cadence, calibrated,
     *   off (lleva ≥ 20 s desviado), dev (km/h frente a la clase), fresh }
     */
    view(t) {
      if (!last) return null;
      const fresh = t - last.rx <= SPEED_FRESH_MS;
      const kmh = fresh && last.kmh != null && last.kmh >= 2 ? r1(last.kmh * k) : null;
      const off = kmh != null && offSince != null && t - offSince >= DRIFT_SEC * 1000;
      return {
        kmh, raw: fresh ? last.kmh : null, km: r3((firstKm + wKm) * k), cadence: fresh ? last.cadence : null,
        calibrated, off, dev: kmh != null && appKmh != null ? r1(kmh - appKmh) : null, fresh, source: last.source,
      };
    },
    /** Para guardar en la sesión (session.watchSpeed); null con menos de 5 lecturas. */
    summary() {
      if (n < 5 || !(pairMs > 0)) return null;
      const out = {
        source: last?.source || 'watch',
        km: r3(firstKm + wKm),                              // lo que el reloj dice que has corrido (sin corregir)
        avgKmh: r1(wKm / (pairMs / 3600000)),               // su media mientras hubo lecturas
        appKm: r3(aKm),                                     // lo que marcó la clase en ese mismo rato
        sec: Math.round(pairMs / 1000),
        samples: n,
      };
      if (factor != null) out.factor = factor;
      const ratio = this.classRatio({ force: true });
      if (ratio != null) out.ratio = ratio;
      if (touched) out.touched = true;
      return out;
    },
    /**
     * Clase / reloj en los tramos estables de esta clase, para aprender la corrección. null si has tocado la velocidad,
     * si hay menos de 5 min estables o si sale un disparate (eso no es sesgo del reloj: la cinta iba a otra cosa).
     */
    classRatio({ force = false } = {}) {
      if (touched && !force) return null;
      if (sMs < LEARN_MIN_SEC * 1000 || sW < LEARN_MIN_KM) return null;
      const ratio = sA / sW;
      return ratio >= LEARN_RATIO_MIN && ratio <= LEARN_RATIO_MAX ? r3(ratio) : null;
    },
    /** Para la instantánea de la clase a medias. */
    snapshot() {
      if (!n) return null;
      return { n, firstKm, wKm: r3(wKm), aKm: r3(aKm), pairMs: Math.round(pairMs), sW: r3(sW), sA: r3(sA), sMs: Math.round(sMs), touched };
    },
  };
}

/**
 * Reloj simulado para verlo sin correr (?debug=speed en el reproductor): sigue la velocidad de la clase con el
 * retraso de una estimación de verdad, un 4 % por encima (el sesgo medido) y, si se pide, con la cinta puesta a otra
 * velocidad (`offset` km/h frente a la clase). next(ctx) → lectura cada 3 s, o null si aún no toca.
 */
export function createSpeedSim({ offset = 0, bias = 1.04, every = 3000 } = {}) {
  let v = null;
  let km = 0;
  let lastAt = null;
  return {
    bias,
    next({ t, appKmh, running }) {
      if (!running) { lastAt = null; return null; }
      if (lastAt == null) { lastAt = t; return null; }
      const dt = t - lastAt;
      if (dt < every) return null;
      lastAt = t;
      const target = Math.max(0, (Number(appKmh) || 0) + offset) * bias;
      v = v == null ? target : v + (target - v) * (1 - Math.exp(-dt / 6000));
      const wob = 0.08 * Math.sin(t / 7000);
      km += (v * dt) / 3600000;
      return cleanSpeed({ kmh: v + wob, km, cadence: v > 2 ? 150 + v * 1.8 : 0, at: t, source: 'watch' });
    },
  };
}
