// RITMUP · decisiones con el modelo de tu pulso (hr-dynamics.js), sin DOM. Tres usos:
// 1. Antes de la clase: ajusta la velocidad de los tramos largos de trabajo para que, con tu pulso, caigan en su zona
//    (simulando la clase entera: lo que corres en un tramo se arrastra al siguiente).
// 2. En la clase, antes de cada tramo: con el pulso con el que vas a llegar, la velocidad del que viene (sobre todo
//    recuperaciones: si no te va a dejar bajar a su zona, más suave).
// 3. En la pantalla: si vas por debajo pero vas a llegar a la zona antes de acabar el tramo, «Subiendo», no «Bajo».
// Siempre con límites: antes de la clase −0,6 / +0,3 km/h sobre lo planeado; en directo, pasos de ±0,5 y como mucho
// −0,8 / +0,5 en todo el tramo sobre la velocidad con la que empezó; los arreones cortos (rápido o sprint de < 3 min)
// se definen por velocidad y nunca se suben por pulso.
// 4. Con «Entreno exigente», las series cortas (correr o rápido de 45 s a 3 min): si a esa velocidad ni manteniéndola
//    llegarías al centro de la zona con tu pulso de hoy, la siguiente serie sube hasta +0,3 (seriesSpeed).
// 5. La cuenta de tu pulso se lleva con la velocidad a la que corres de verdad cuando el reloj la sabe con garantías
//    (effectiveSpeed); y si no vas a la velocidad de la clase (≥ 1,0 km/h), el modo pulso no cambia nada: primero la cinta.
// 6. Calentar, vuelta a la calma y caminar no se ajustan por pulso; la vuelta a la calma nunca va más rápida que lo
//    que vienes corriendo (calmCaps), y el trote nunca baja más de 1,0 (0,6 con exigente) de tu velocidad de trote.
import { equilibrium, simulate, hrAfter, speedForHr, classInputs, fitHrDynamics, starterModel, HR_DT } from './hr-dynamics.js';

const WORK = new Set(['jog', 'run', 'fast']);
const RANK = { walk: 0, warmup: 1, cooldown: 1, jog: 2, run: 3, fast: 4, sprint: 5 };
const LONG_SEC = 180;
const HILL_GRADE = 3;        // % desde el que un tramo corto se define por la cuesta, no por la velocidad
const PRE_MAX = 0.6;        // antes de la clase: bajar hasta −0,6…
const PRE_MAX_UP = 0.3;     // …pero subir como mucho +0,3 (pasarse de optimista sale peor que quedarse corto)
const LIVE_MAX_DOWN = 0.8;
const LIVE_MAX_UP = 0.5;
const LATE_SEC = 90;        // con menos de 90 s de tramo por delante…
const LATE_PPM = 6;         // …solo se toca si lo previsto se sale de la zona 6 ppm o más
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
        const m2 = mean(sim.slice(Math.floor(sim.length / 2)));
        // Zona normal: al centro. Techo ampliado (entreno exigente, tgt.pushed): vale toda la franja hasta 3 ppm bajo
        // el techo, así que un tramo duro no se rebaja de antemano por ir «por encima del centro».
        const off = tgt.pushed ? (m2 < tgt.min ? tgt.min - m2 : m2 > tgt.max - 3 ? m2 - (tgt.max - 3) : 0) : Math.abs(m2 - mid);
        const err = off + Math.abs(d) * 0.8; // pequeño coste por moverse
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
 * `base`: la velocidad con la que empezó el tramo (si se da, el tramo entero no se aparta de ella más de −0,8 / +0,5).
 * Nunca mueve la velocidad al revés de lo que pide el pulso (con poco tramo por delante el despeje podía pedir subir
 * yendo alto) y, con menos de 90 s por delante, no toca nada por unas pocas pulsaciones.
 */
// (14 nov 2026: en la primera clase larga el reloj acertó ±0,3 en unas franjas y falló ±1 en otras. Aun con `ok`, que
//  ya exige un error esperable ≤ 0,35, menos de 0,6 de diferencia es ruido y menos de 1,0 no justifica parar el control.)
const REAL_MIN_DEV = 0.6;    // por debajo de esto, el reloj y la clase dicen lo mismo: manda la clase
const REAL_MAX_DEV = 0.15;   // el reloj nunca mueve la cuenta más de un 15 % de la velocidad de la clase
export const REAL_HOLD_DEV = 1.0; // desde aquí no vas a la velocidad de la clase: el modo pulso no toca nada (te avisa el reloj)

/**
 * La velocidad a la que corres de verdad, para llevar la cuenta de tu pulso: la que estima el reloj si se puede decidir
 * con ella (`real.ok`: calibrada y con la clase asentada, js/training/watch-speed.js) y se aparta de la clase ≥ 0,6;
 * si no, la de la clase. Así un día con la cinta más lenta de lo que dice la clase no se apunta como «día de pulso
 * bajo» (ni al revés). → { v, real (¿sale del reloj?), dev (v − clase) }
 */
export function effectiveSpeed(classSpeed, real = null) {
  const v = Number(classSpeed) || 0;
  if (!(v > 0) || !real || real.ok !== true || !(Number(real.kmh) > 0)) return { v, real: false, dev: 0 };
  const kmh = r1(clamp(Number(real.kmh), v * (1 - REAL_MAX_DEV), v * (1 + REAL_MAX_DEV)));
  const dev = r1(kmh - v);
  if (Math.abs(dev) < REAL_MIN_DEV - 1e-9) return { v, real: false, dev: 0 };
  return { v: kmh, real: true, dev };
}

/** Zonas que el modo pulso no toca: calentar, vuelta a la calma y caminar siguen el plan (solo se les pone tope). */
export const CALM_ZONES = new Set(['warmup', 'cooldown', 'walk']);
const JOG_FLOOR = 1.0;        // lo más que el pulso puede dejar el trote por debajo de TU velocidad de trote
const JOG_FLOOR_PUSHY = 0.6;  // …con «Entreno exigente»

/**
 * Suelo del trote. Las bajadas por pulso se encadenaban (la clase ya trae el trote final más suave, el tramo
 * siguiente lo bajaba otra vez y el control en directo otra más): un rodaje de 12 min acabó 1,6 km/h por debajo del
 * trote del corredor. El tope se mide contra tu velocidad de trote, no contra lo ya rebajado.
 */
export function jogFloor(levels, { pushy = false, minSpeed = 1 } = {}) {
  const j = Number(levels?.jog);
  return j > 0 ? r1(Math.max(Number(minSpeed) || 1, j - (pushy ? JOG_FLOOR_PUSHY : JOG_FLOOR))) : Number(minSpeed) || 1;
}

/**
 * Vuelta a la calma: nunca empieza más rápida que lo que vienes corriendo y va siempre de más a menos. Si el pulso (o
 * tú) habéis bajado el último tramo por debajo del primer escalón de la vuelta a la calma, la clase no puede «subir»
 * para enfriar. → [{ index, speed }] con los escalones que hay que rebajar (vacío si ninguno).
 */
export function calmCaps(segments, fromIndex, curSpeed) {
  const out = [];
  let prev = Number(curSpeed);
  const list = Array.isArray(segments) ? segments : [];
  if (!(prev > 0)) return out;
  for (let i = Math.max(0, Math.floor(fromIndex)); i < list.length && list[i]?.zone === 'cooldown'; i++) {
    const sp = Number(list[i].speed) || 0;
    const v = r1(Math.min(sp, prev));
    if (v < sp - 0.05) out.push({ index: i, speed: v });
    prev = v;
  }
  return out;
}

const SERIES_MIN_SEC = 45;   // series de 45 s a 3 min: más cortas son arreones (los define la velocidad)
const SERIES_MAX_UP = 0.3;   // lo más que se sube una serie sobre lo planeado
const SERIES_PEAK_ROOM = 5;  // si en la serie anterior de esa zona acabaste a menos de 5 ppm del techo, no se sube

/**
 * Series cortas con «Entreno exigente» (correr o rápido de 45 s a 3 min, sin cuesta). En una serie corta el pulso no
 * llega a asentarse, así que mirar el pulso al acabarla no dice si la velocidad es la tuya: se mira el pulso que
 * tendrías si la mantuvieras (el de equilibrio de tu modelo, con tu pulso de hoy y lo que llevas corrido). Si ni así
 * llegarías al centro de la zona, la serie se te queda corta hoy y la siguiente sube, como mucho +0,3 km/h.
 * Nunca con el modelo inicial, ni si en la serie anterior ya rozaste el techo, ni si con la velocidad nueva
 * acabarías la serie por encima de la zona. Bajar lo sigue decidiendo nextSpeed.
 * → velocidad nueva o null
 */
export function seriesSpeed(model, a, { next, hrEnd, load = 0, target, lastPeak = null, minSpeed = 1, maxSpeed = 20 } = {}) {
  if (!model || model.starter || !next || !target || !(next.speed > 0) || !(target.max > target.min) || !Number.isFinite(hrEnd)) return null;
  if (next.zone !== 'run' && next.zone !== 'fast') return null;
  const sec = Number(next.sec) || 0;
  const g = Number(next.incline) || 0;
  if (sec < SERIES_MIN_SEC || sec >= LONG_SEC || g >= HILL_GRADE) return null;
  if (lastPeak != null && lastPeak > target.max - SERIES_PEAK_ROOM) return null;
  const planned = next.speed;
  const mid = (target.min + target.max) / 2;
  if (equilibrium(model, a, planned, g, load) >= mid - 2) return null;
  let v = Math.min(planned + SERIES_MAX_UP, (mid - a - model.c * g - model.d * load) / model.b);
  v = Math.floor(v * 10 + 1e-9) / 10;
  while (v > planned && hrAfter(model, a, hrEnd, sec, v, g, load) > target.max - 2) v = r1(v - 0.1);
  v = r1(clamp(v, minSpeed, maxSpeed));
  return v - planned >= 0.2 - 1e-9 ? v : null;
}

export function liveSpeed(model, a, { seg, hrNow, remaining, speed, load = 0, target, minSpeed = 1, maxSpeed = 20, base = null } = {}) {
  if (!model || !seg || !target || hrNow == null || !(target.max > target.min) || !WORK.has(seg.zone)) return null;
  const horizon = clamp(remaining, 45, 240);
  const g = Number(seg.incline) || 0;
  const p = hrAfter(model, a, hrNow, horizon, speed, g, load);
  const short = seg.sec < LONG_SEC;
  let want = null;
  let dir = 0;
  if (p > target.max + 2) { want = speedForHr(model, a, hrNow, horizon, target.max - 3, g, load); dir = -1; }
  else if (!short && p < target.min - 3) { want = speedForHr(model, a, hrNow, horizon, (target.min + target.max) / 2, g, load); dir = 1; }
  if (want == null) return null;
  if (remaining < LATE_SEC && (dir < 0 ? p - target.max : target.min - p) < LATE_PPM) return null;
  let v = clamp(want, speed - 0.5, speed + 0.5);
  v = dir < 0 ? Math.min(v, speed) : Math.max(v, speed);
  if (Number.isFinite(Number(base)) && base != null) v = clamp(v, Number(base) - LIVE_MAX_DOWN, Number(base) + LIVE_MAX_UP);
  v = r1(clamp(v, minSpeed, maxSpeed));
  if ((dir < 0 && v > speed) || (dir > 0 && v < speed)) return null;
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
 * nuevas. → modelo o null (hacen falta 2 clases con pulso; con `profile`, basta 1: modelo inicial, ver starterModel).
 */
const CACHE_KEY = 'ritmup.hrdyn.v1';
export function dynModelFrom(history, segmentsFor, { now = Date.now(), storage = globalThis.localStorage, profile = null } = {}) {
  const since = now - 60 * 86400000;
  const list = (Array.isArray(history) ? history : [])
    .filter((h) => h && !h.isTest && Array.isArray(h.hrSeries) && h.hrSeries.length >= 30 && !(Number(h.skippedSec) > 600)
      && !(Date.parse(h.startedAt || '') < since))
    .slice(-20);
  if (list.length === 1 && profile) {
    let segs = null;
    try { segs = segmentsFor ? segmentsFor(list[0]) : null; } catch { segs = null; }
    const inp = classInputs(list[0], segs);
    return inp ? starterModel(inp, profile) : null;
  }
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
  const slim = { b: model.b, c: model.c, d: model.d, tauUp: model.tauUp, tauDown: model.tauDown, aTypical: model.aTypical, aSpread: model.aSpread, rmse: model.rmse, classes: model.classes };
  try { storage?.setItem(CACHE_KEY, JSON.stringify({ key, model: slim })); } catch { /* lleno */ }
  return slim;
}
