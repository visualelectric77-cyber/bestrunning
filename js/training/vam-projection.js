// RITMUP · proyección en directo del test VAM (sin DOM): «a este paso, tu VAM saldrá entre 13,0 y 14,0».
//
// Es ORIENTATIVA y no cambia nada del test: ni velocidades, ni avisos, ni el resultado. Solo mira cómo sube tu pulso de
// un escalón a otro y calcula en qué escalón llegaría a tu pulso máximo, que es más o menos donde se acaba un test así.
//
// Cómo se calcula (reglas fijas, sin IA):
//   1. De cada escalón terminado se guarda tu pulso de los últimos 20 s.
//   2. Se alarga esa serie hacia los escalones que faltan:
//        · con tu modelo de pulso (js/training/hr-dynamics.js, aprendido de tus clases): la forma de la subida sale del
//          modelo (incluye que el pulso va con retraso y que se va cargando) y se coloca a la altura de tu pulso de hoy;
//          lo que de verdad sube hoy tu pulso por escalón la corrige cada vez más según avanzas;
//        · sin modelo: una recta por tus últimos escalones (pendiente robusta, mediana de pendientes); hacen falta 5.
//   3. El rango va del escalón donde llegarías al 95 % de tu pulso máximo al escalón donde llegarías al 100 %.
//   4. Frenos de realismo: nunca por debajo de lo que ya llevas hecho, nunca por encima del último escalón del test,
//      como mucho 2 km/h de ancho, y si falta demasiado (más de 5 km/h) o tu pulso no encaja, no dice nada.
// Lo que no sabe: si hoy te paran antes las piernas o la cabeza que el corazón. Por eso es un rango y no una promesa.
import { simulate, HR_DT } from './hr-dynamics.js';

const END_WINDOW = 20;        // s del final de cada escalón que cuentan
const MIN_SAMPLES = 2;        // lecturas mínimas en esa ventana
const MIN_POINTS_MODEL = 4;   // escalones con pulso para hablar (con tu modelo)
const MIN_POINTS_LIVE = 5;    // … y sin modelo
const LO_PCT = 0.95;
const MAX_WIDTH = 2;          // km/h
const MIN_WIDTH = 0.5;
const MAX_AHEAD = 5;          // km/h por encima de lo ya hecho: más lejos no se dice nada
const LIVE_POINTS = 4;        // sin modelo, la pendiente sale de los últimos escalones (el pulso sube cada vez más)
const SLOPE_MIN = 1.5;        // ppm por escalón (sin modelo): fuera de aquí el pulso no encaja
const SLOPE_MAX = 12;
const RATIO_MIN = 0.6;        // lo que tu pulso de hoy puede corregir la pendiente del modelo
const RATIO_MAX = 1.6;
const MAX_MISS = 6;           // ppm que los últimos escalones pueden apartarse de la forma del modelo
const MAX_MISS_LIVE = 3;      // … y de la recta, sin modelo
const REF_JOG = 8.5;          // km/h: igual que el reproductor al acumular la carga

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const half = (v) => Math.round(v * 2) / 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const median = (arr) => {
  const q = arr.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!q.length) return NaN;
  const m = q.length >> 1;
  return q.length % 2 ? q[m] : (q[m - 1] + q[m]) / 2;
};
/** Pendiente robusta (Theil–Sen): mediana de las pendientes entre todas las parejas de puntos [x, y]. */
function slopeOf(pts) {
  const s = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const dx = pts[j][0] - pts[i][0];
    if (dx > 0) s.push((pts[j][1] - pts[i][1]) / dx);
  }
  return median(s);
}

/** Texto del rango para la pantalla: «13,0–14,0». */
export function vamProjectionText(p) {
  if (!p || !(p.lo > 0) || !(p.hi > p.lo)) return '';
  const f = (v) => v.toFixed(1).replace('.', ',');
  return `${f(p.lo)}–${f(p.hi)}`;
}

/**
 * opts: hrMax · segments (los tramos de la clase del test, con stage > 0 en los escalones) · model (hr-dynamics o null).
 * → { add(t, ppm), at(t), log() }. `t` son segundos de clase. Nunca lanza: ante cualquier dato raro devuelve null.
 * at(t) → null o { lo, hi, stage, basis: 'model' | 'live' } con lo y hi en km/h, redondeados a 0,5.
 */
export function createVamProjection(opts) {
  const { hrMax, segments, model = null } = opts && typeof opts === 'object' ? opts : {};
  const max = num(hrMax) > 100 ? num(hrMax) : 0;
  // Escalones con su principio y su final en segundos de clase
  const stages = [];
  let acc = 0;
  for (const g of Array.isArray(segments) ? segments : []) {
    const sec = num(g?.sec);
    if (num(g?.stage) > 0 && sec > 0 && num(g.speed) > 0) stages.push({ speed: num(g.speed), start: acc, end: acc + sec });
    acc += sec;
  }
  const ok = max > 0 && stages.length >= 3;
  const top = ok ? stages[stages.length - 1].speed : 0;

  // Con tu modelo: pulso simulado al final de cada escalón (lo que importa es cuánto sube de uno a otro)
  let shape = null;
  try {
    if (ok && model && model.b > 0 && model.tauUp > 0 && model.tauDown > 0 && Number.isFinite(num(model.aTypical))) {
      const v = [];
      const g = [];
      const load = [];
      let L = 0;
      for (const s of segments) {
        for (let t = 0; t < num(s.sec); t += HR_DT) {
          v.push(num(s.speed));
          g.push(num(s.incline));
          L += (Math.max(0, num(s.speed) - REF_JOG) * HR_DT) / 60;
          load.push(L);
        }
      }
      const m = { b: num(model.b), c: num(model.c), d: num(model.d), tauUp: num(model.tauUp), tauDown: num(model.tauDown) };
      const sim = simulate(m, num(model.aTypical), { v, g, load }, num(model.aTypical) + m.b * num(segments[0]?.speed));
      const ends = stages.map((st) => sim[clamp(Math.round(st.end / HR_DT) - 1, 0, sim.length - 1)]);
      if (ends.every((x) => Number.isFinite(x)) && ends.every((x, i) => i === 0 || x > ends[i - 1])) shape = ends;
    }
  } catch { shape = null; }

  const buf = [];              // [t, ppm] de los últimos ~3 min
  const ends = [];             // pulso al final de cada escalón terminado (o null si no hubo lecturas)
  const history = [];          // [escalón, lo, hi] cada vez que cambia
  let cache = null;            // { n, raw } proyección calculada con n escalones terminados

  function closeStages(t) {
    while (ends.length < stages.length && stages[ends.length].end <= t) {
      const st = stages[ends.length];
      const q = buf.filter((p) => p[0] > st.end - END_WINDOW && p[0] <= st.end + 0.5);
      ends.push(q.length >= MIN_SAMPLES ? q.reduce((a, p) => a + p[1], 0) / q.length : null);
    }
  }

  /** Lo que ya llevas hecho (Kuipers): último escalón terminado + la parte del que estás corriendo. */
  function doneAt(t) {
    let done = 0;
    for (let i = 0; i < stages.length; i++) {
      const st = stages[i];
      if (t >= st.end) { done = st.speed; continue; }
      if (t > st.start && i > 0) done = stages[i - 1].speed + (st.speed - stages[i - 1].speed) * ((t - st.start) / (st.end - st.start));
      break;
    }
    return done;
  }

  /** Pulso previsto al final de cada escalón (los terminados, ajustados; los que faltan, alargados). → array o null */
  function predicted() {
    const n = ends.length;
    const pts = [];
    for (let i = 0; i < n; i++) if (ends[i] != null) pts.push([i, ends[i]]);
    // el último dato tiene que ser reciente: de uno de los dos últimos escalones
    if (!pts.length || pts[pts.length - 1][0] < n - 2) return null;
    const out = new Array(stages.length);
    if (shape) {
      if (pts.length < MIN_POINTS_MODEL) return null;
      const off = median(pts.slice(-3).map(([i, h]) => h - shape[i]));
      const live = slopeOf(pts);
      const ref = slopeOf(pts.map(([i]) => [i, shape[i]]));
      let ratio = 1;
      if (Number.isFinite(live) && ref > 0) {
        const w = clamp((pts.length - 3) / 5, 0, 0.7);
        ratio = 1 + w * (clamp(live / ref, RATIO_MIN, RATIO_MAX) - 1);
      }
      if (!Number.isFinite(off)) return null;
      // Tu pulso tiene que parecerse a una subida: si no sube con los escalones o los últimos se apartan mucho de
      // la forma esperada (sensor que baila, reloj suelto), no se dice nada
      if (!(live >= SLOPE_MIN)) return null;
      const miss = median(pts.slice(-4).map(([i, h]) => Math.abs(h - shape[i] - off)));
      if (!(miss <= MAX_MISS)) return null;
      const k = n - 1;
      for (let i = 0; i <= k; i++) out[i] = shape[i] + off;
      for (let i = k + 1; i < stages.length; i++) out[i] = out[i - 1] + (shape[i] - shape[i - 1]) * ratio;
      return { p: out, basis: 'model' };
    }
    if (pts.length < MIN_POINTS_LIVE) return null;
    const recent = pts.slice(-LIVE_POINTS);
    const slope = slopeOf(recent);
    if (!(slope >= SLOPE_MIN && slope <= SLOPE_MAX)) return null;
    const icpt = median(recent.map(([i, h]) => h - slope * i));
    if (!Number.isFinite(icpt)) return null;
    // … y tiene que ser una subida limpia: si los escalones se apartan de la recta, el pulso no encaja
    const missLive = median(recent.map(([i, h]) => Math.abs(h - icpt - slope * i)));
    if (!(missLive <= MAX_MISS_LIVE) || !(slopeOf(pts) >= SLOPE_MIN)) return null;
    for (let i = 0; i < stages.length; i++) out[i] = icpt + slope * i;
    return { p: out, basis: 'live' };
  }

  /** Velocidad (VAM) a la que el pulso previsto llega a `target`. */
  function crossing(p, target) {
    for (let i = 0; i < stages.length; i++) {
      if (!(p[i] >= target)) continue;
      if (i === 0) return stages[0].speed;
      const f = clamp((target - p[i - 1]) / Math.max(1e-6, p[i] - p[i - 1]), 0, 1);
      return stages[i - 1].speed + (stages[i].speed - stages[i - 1].speed) * f;
    }
    return top;
  }

  function compute(t) {
    if (!ok) return null;
    closeStages(t);
    const n = ends.length;
    if (!cache || cache.n !== n) {
      let raw = null;
      const pr = n >= 1 && n < stages.length ? predicted() : null;
      if (pr) {
        const lo = crossing(pr.p, max * LO_PCT);
        const hi = crossing(pr.p, max);
        if (Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo) raw = { lo, hi, basis: pr.basis };
      }
      // Ya has pasado del 95 % de tu máximo con el pulso de un escalón reciente: estás en la franja, falte o no la
      // recta (cerca del máximo el pulso deja de subir y ya no hay pendiente que alargar)
      if (n >= 1 && n < stages.length) {
        const hit = ends.findIndex((h) => h != null && h >= max * LO_PCT);
        const fresh = ends[n - 1] != null || (n >= 2 && ends[n - 2] != null);
        if (hit >= 0 && fresh) {
          const lo = stages[hit].speed;
          raw = { lo: raw ? Math.min(raw.lo, lo) : lo, hi: raw ? Math.max(raw.hi, lo) : lo, basis: raw?.basis || 'live' };
        }
      }
      cache = { n, raw };
    }
    if (!cache.raw) return null;
    const done = doneAt(t);
    let lo = Math.max(cache.raw.lo, done);
    let hi = Math.max(cache.raw.hi, lo);
    if (lo - done > MAX_AHEAD) return null;
    hi = Math.min(hi, lo + MAX_WIDTH);
    lo = half(Math.min(lo, top));
    hi = half(Math.min(hi, top));
    if (hi < lo + MIN_WIDTH) hi = lo + MIN_WIDTH;
    if (hi > top) { hi = top; lo = Math.min(lo, hi - MIN_WIDTH); } // el último escalón puede no caer en 0,5
    if (!(lo > 0) || !(hi > lo)) return null;
    return { lo: r1(lo), hi: r1(hi), stage: n, basis: cache.raw.basis };
  }

  return {
    /** Una lectura de pulso (segundos de clase, ppm). Las repetidas, raras o hacia atrás no cuentan. */
    add(t, bpm) {
      try {
        const x = Number(t);
        const y = Number(bpm);
        if (!Number.isFinite(x) || !(y >= 40 && y <= 240)) return;
        if (buf.length && x <= buf[buf.length - 1][0]) return;
        closeStages(x - 0.5);
        buf.push([x, y]);
        while (buf.length && x - buf[0][0] > 200) buf.shift();
      } catch { /* nunca rompe el test */ }
    },
    at(t) {
      try {
        const x = Number(t);
        if (!Number.isFinite(x)) return null;
        const p = compute(x);
        if (p) {
          const last = history[history.length - 1];
          if (!last || last[1] !== p.lo || last[2] !== p.hi) history.push([p.stage, p.lo, p.hi]);
          if (history.length > 60) history.shift();
        }
        return p;
      } catch { return null; }
    },
    /** Para guardar con la sesión y contrastar luego con el resultado: [[escalones terminados, lo, hi], …]. */
    log() { return history.map((h) => h.slice()); },
  };
}
