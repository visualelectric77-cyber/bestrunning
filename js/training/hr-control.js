// RITMUP · decisiones con el modelo de tu pulso (hr-dynamics.js), sin DOM. Tres usos:
// 1. Antes de la clase: ajusta la velocidad de los tramos largos de trabajo para que, con tu pulso, caigan en su zona
//    (simulando la clase entera: lo que corres en un tramo se arrastra al siguiente).
// 2. En la clase, antes de cada tramo: con el pulso con el que vas a llegar, la velocidad del que viene (sobre todo
//    recuperaciones: si no te va a dejar bajar a su zona, más suave).
// 3. En la pantalla: si vas por debajo pero vas a llegar a la zona antes de acabar el tramo, «Subiendo», no «Bajo».
// Siempre con límites: antes de la clase −0,6 / +0,3 km/h sobre lo planeado, en directo hasta −0,8; los arreones
// cortos (rápido o sprint de < 3 min) se definen por velocidad y nunca se suben por pulso.
import { equilibrium, simulate, hrAfter, speedForHr, classInputs, fitHrDynamics, HR_DT } from './hr-dynamics.js';

const WORK = new Set(['jog', 'run', 'fast']);
const RANK = { walk: 0, warmup: 1, cooldown: 1, jog: 2, run: 3, fast: 4, sprint: 5 };
const LONG_SEC = 180;
const HILL_GRADE = 3;        // % desde el que un tramo corto se define por la cuesta, no por la velocidad
const PRE_MAX = 0.6;        // antes de la clase: bajar hasta −0,6…
const PRE_MAX_UP = 0.3;     // …pero subir como mucho +0,3 (pasarse de optimista sale peor que quedarse corto)
const LIVE_MAX_DOWN = 0.8;
const LIVE_MAX_UP = 0.5;
const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const REF_JOG = 8.5;

/** Entradas de simulación de unos tramos, desde una carga inicial. */
function segInputs(segs, load0 = 0) {
  const inp = { v: [], g: [], load: [] };
  let load = load0;
  for (const s of segs) {
    for (let t = 0; t < s.sec; t += HR_DT) {
      inp.v.push(s.speed); inp.g.push(Number(s.incline) || 0); inp.load.push(load);
      load += (Math.max(0, s.speed - REF_JOG) * HR_DT) / 60;
    }
  }
  return { inp, load };
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

/**
 * 1 · Antes de la clase. segments con { zone, speed, sec, incline }; targetOf(seg) → {min, max}; a: tu a del día
 * (el típico si no se sabe); hr0: pulso al empezar. Ajusta solo los tramos de trabajo de ≥ 3 min para que la segunda
 * mitad del tramo quede en el centro de su zona. → { segments, changes: [{ i, from, to }] }
 */
export function calibrateClass(model, a, segments, targetOf, { hr0 = null, minSpeed = 1, maxSpeed = 20 } = {}) {
  const segs = (segments || []).map((s) => ({ ...s }));
  if (!model || !segs.length) return { segments: segs, changes: [] };
  let hr = hr0 ?? equilibrium(model, a, segs[0].speed * 0.6, 0, 0);
  let load = 0;
  const changes = [];
  segs.forEach((s, i) => {
    let tgt = null;
    if (WORK.has(s.zone) && s.sec >= LONG_SEC) { try { tgt = targetOf(s); } catch { tgt = null; } }
    if (tgt && tgt.max > tgt.min) {
      const mid = (tgt.min + tgt.max) / 2;
      const planned = s.speed;
      // búsqueda sencilla: la velocidad (a décimas) cuya segunda mitad simulada queda más cerca del centro
      let best = planned;
      let bestErr = Infinity;
      for (let d = -PRE_MAX; d <= PRE_MAX_UP + 1e-9; d += 0.1) {
        const v = r1(clamp(planned + d, minSpeed, maxSpeed));
        const { inp } = segInputs([{ ...s, speed: v }], load);
        const sim = simulate(model, a, { ...inp }, hr);
        const err = Math.abs(mean(sim.slice(Math.floor(sim.length / 2))) - mid) + Math.abs(d) * 0.8; // pequeño coste por moverse
        if (err < bestErr) { bestErr = err; best = v; }
      }
      if (Math.abs(best - planned) >= 0.1 - 1e-9) { changes.push({ i, from: planned, to: best }); s.speed = best; }
    }
    const { inp, load: l2 } = segInputs([s], load);
    const sim = simulate(model, a, inp, hr);
    const last = sim[sim.length - 1];
    hr = last + (equilibrium(model, a, inp.v.at(-1), inp.g.at(-1), inp.load.at(-1)) - last) * (1 - Math.exp(-HR_DT / model.tauUp));
    load = l2;
  });
  // el orden de dificultad no se rompe: un tramo de trabajo nunca por debajo de una recuperación pegada más suave
  return { segments: segs, changes };
}

/**
 * 2 · Antes de cada tramo (unos segundos antes del pre-aviso de la voz). hrEnd: pulso con el que vas a acabar el
 * actual; load: carga acumulada. Recuperaciones (tramo más suave que el actual): si no te deja bajar a su zona, más
 * suave (hasta −0,8). Tramos largos de trabajo: a su zona en ambos sentidos (±0,5). Arreones cortos: solo hacia abajo
 * si te vas a pasar mucho. Día alto (highDay): las rampas cortas también bajan, en proporción a lo alto que va tu pulso:
 * si no, todo el ajuste cae en las recuperaciones y acabas cambiando 2 km/h cada minuto. → velocidad nueva o null.
 */
export function nextSpeed(model, a, { cur, next, hrEnd, load = 0, target, highDay = false, minSpeed = 1, maxSpeed = 20 } = {}) {
  if (!model || !next || !target || !(next.speed > 0) || !(target.max > target.min)) return null;
  const sec = Math.min(Number(next.sec) || 0, 300);
  if (sec < 30) return null;
  const g = Number(next.incline) || 0;
  const planned = next.speed;
  const pEnd = hrAfter(model, a, hrEnd, sec, planned, g, load);
  const recovery = cur && (RANK[next.zone] ?? 9) < (RANK[cur.zone] ?? -1);
  const shortHard = !recovery && next.sec < LONG_SEC && (next.zone === 'fast' || next.zone === 'sprint');
  let v = null;
  if (pEnd > target.max + 2) {
    const want = speedForHr(model, a, hrEnd, sec, target.max - 2, g, load);
    v = clamp(want, planned - LIVE_MAX_DOWN, planned);
  } else if (!recovery && !shortHard && WORK.has(next.zone) && next.sec >= LONG_SEC && pEnd < target.min - 3) {
    const want = speedForHr(model, a, hrEnd, sec, (target.min + target.max) / 2, g, load);
    v = clamp(want, planned, planned + LIVE_MAX_UP);
  }
  if (highDay && shortHard && g >= HILL_GRADE) {
    const vDay = planned - Math.min(LIVE_MAX_DOWN, Math.max(0, a - (model.aTypical ?? a)) / model.b);
    v = v == null ? vDay : Math.min(v, vDay);
  }
  if (v == null) return null;
  v = r1(clamp(v, minSpeed, maxSpeed));
  return Math.abs(v - planned) >= 0.2 - 1e-9 ? v : null;
}

/**
 * Durante un tramo largo de trabajo: ¿la velocidad actual te deja en la zona al final (o en 4 min)? Si no, la que sí.
 * → { speed, predicted } o null. Pasos de ±0,5 como mucho; los arreones cortos nunca suben.
 */
export function liveSpeed(model, a, { seg, hrNow, remaining, speed, load = 0, target, minSpeed = 1, maxSpeed = 20 } = {}) {
  if (!model || !seg || !target || hrNow == null || !(target.max > target.min) || !WORK.has(seg.zone)) return null;
  const horizon = clamp(remaining, 45, 240);
  const g = Number(seg.incline) || 0;
  const p = hrAfter(model, a, hrNow, horizon, speed, g, load);
  const short = seg.sec < LONG_SEC;
  let want = null;
  if (p > target.max + 2) want = speedForHr(model, a, hrNow, horizon, target.max - 3, g, load);
  else if (!short && p < target.min - 3) want = speedForHr(model, a, hrNow, horizon, (target.min + target.max) / 2, g, load);
  if (want == null) return null;
  const v = r1(clamp(clamp(want, speed - 0.5, speed + 0.5), minSpeed, maxSpeed));
  return Math.abs(v - speed) >= 0.2 - 1e-9 ? { speed: v, predicted: Math.round(p) } : null;
}

/**
 * 3 · Estado para la pantalla: 'in' | 'high' | 'low' | 'rising' (va por debajo pero llegará a la zona antes de acabar
 * el tramo) | 'falling' (por encima pero ya bajando a la zona). → { st, predicted }
 */
export function pulseTrend(model, a, { hrNow, remaining, speed, incline = 0, load = 0, target } = {}) {
  if (!target || hrNow == null) return { st: 'in', predicted: null };
  const p = model ? Math.round(hrAfter(model, a, hrNow, clamp(remaining, 20, 180), speed, incline, load)) : null;
  if (hrNow > target.max) return { st: p != null && p <= target.max ? 'falling' : 'high', predicted: p };
  if (hrNow < target.min) return { st: p != null && p >= target.min ? 'rising' : 'low', predicted: p };
  return { st: 'in', predicted: p };
}

/**
 * Modelo de tu pulso a partir del historial (las 20 últimas clases con pulso de los últimos 60 días; sin tests).
 * segmentsFor(session) → tramos de esa clase (para la inclinación) o null. Se guarda en caché mientras no haya clases
 * nuevas. → modelo o null (hacen falta 2 clases con pulso).
 */
const CACHE_KEY = 'ritmup.hrdyn.v1';
export function dynModelFrom(history, segmentsFor, { now = Date.now(), storage = globalThis.localStorage } = {}) {
  const since = now - 60 * 86400000;
  const list = (Array.isArray(history) ? history : [])
    .filter((h) => h && !h.isTest && Array.isArray(h.hrSeries) && h.hrSeries.length >= 30 && !(Number(h.skippedSec) > 600)
      && !(Date.parse(h.startedAt || '') < since))
    .slice(-20);
  if (list.length < 2) return null;
  const key = `${list.length}|${list[list.length - 1].id}|${list[0].id}`;
  try {
    const c = JSON.parse(storage?.getItem(CACHE_KEY) || 'null');
    if (c && c.key === key && c.model?.b > 0) return c.model;
  } catch { /* sin caché */ }
  const cls = [];
  for (const h of list) {
    let segs = null;
    try { segs = segmentsFor ? segmentsFor(h) : null; } catch { segs = null; }
    const inp = classInputs(h, segs);
    if (inp) cls.push({ id: h.id, inp });
  }
  const model = fitHrDynamics(cls);
  if (!model) return null;
  const slim = { b: model.b, c: model.c, d: model.d, tauUp: model.tauUp, tauDown: model.tauDown, aTypical: model.aTypical, rmse: model.rmse, classes: model.classes };
  try { storage?.setItem(CACHE_KEY, JSON.stringify({ key, model: slim })); } catch { /* lleno */ }
  return slim;
}
