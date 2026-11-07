// RITMUP · clases hechas a tu pulso (sin DOM). Reglas fijas sacadas de las clases reales del usuario (nov 2026):
// · Deriva: en clases largas el pulso sube ~0,5 ppm/min a la misma velocidad. En las de ≥ 40 min, los tramos de trote
//   que empiezan pasado el minuto 25 van 0,1 km/h más lentos por cada 10 min (como mucho −0,3), antes de que te pases.
// · Recuperaciones: el trote corto (≤ 3 min) entre dos arreones (rápido o sprint de ≤ 2 min) va a tu trote − 0,4 km/h
//   (si la plantilla ya lo puso más lento, se queda),
//   para que el pulso baje antes del siguiente (en «Trece sustos» se acumulaba de 134 a 156 a 8,8 km/h).
// · Tu recuperación del día (semáforo de Salud): en ámbar el objetivo de pulso se queda en la parte baja de la zona
//   (hasta el 70 % del rango) y en rojo, en la mitad baja.
// · «% en zona»: qué parte de los tramos de trote, correr y rápido fuiste en tu zona (sin el primer minuto de cada
//   tramo, que es lo que tarda el pulso en llegar).
import { hrTargetForZone } from './levels.js';

const r1 = (v) => Math.round(v * 10) / 10;
const DRIFT_MIN_SEC = 40 * 60;
const DRIFT_FROM_SEC = 25 * 60;
const DRIFT_STEP_SEC = 10 * 60;
const DRIFT_MAX = 0.3;
const REC_MAX_SEC = 180;
const SURGE_MAX_SEC = 120;
const REC_DROP = 0.4;
const SURGES = new Set(['fast', 'sprint']);
const LAG_SEC = 60;
export const WORK_ZONES = ['jog', 'run', 'fast'];

/** Aplica deriva y recuperaciones a los tramos de una clase. No toca tests ni tramos que no sean de trote. */
export function shapeForHr(segments, { isTest = false, minSpeed = 1, jog = null } = {}) {
  const segs = Array.isArray(segments) ? segments.map((s) => ({ ...s })) : [];
  if (isTest || !segs.length) return segs;
  const total = segs.reduce((a, s) => a + (Number(s.sec) || 0), 0);
  let t = 0;
  segs.forEach((s, i) => {
    const start = t;
    t += Number(s.sec) || 0;
    if (s.zone !== 'jog') return;
    const sp0 = Number(s.speed) || 0;
    // tu velocidad de trote (si no llega, la del propio tramo): lo que la plantilla ya puso más lento no se vuelve a bajar
    const base = Number(jog) > 0 ? Number(jog) : sp0;
    let target = sp0;
    const prev = segs[i - 1];
    const next = segs[i + 1];
    const isRec = (Number(s.sec) || 0) <= REC_MAX_SEC
      && prev && SURGES.has(prev.zone) && (Number(prev.sec) || 0) <= SURGE_MAX_SEC
      && next && SURGES.has(next.zone) && (Number(next.sec) || 0) <= SURGE_MAX_SEC;
    if (isRec) target = Math.min(target, base - REC_DROP);
    if (total >= DRIFT_MIN_SEC && start >= DRIFT_FROM_SEC && sp0 >= base - 0.3 - 1e-9) {
      target -= Math.min(DRIFT_MAX, 0.1 * (Math.floor((start - DRIFT_FROM_SEC) / DRIFT_STEP_SEC) + 1));
    }
    if (target < sp0 - 1e-9) {
      s.speed = r1(Math.max(minSpeed, target));
      s.hrShape = isRec ? 'rec' : 'drift';
    }
  });
  return segs;
}

/** Objetivo de pulso de un tramo según tu semáforo de recuperación ('green' | 'amber' | 'red' | null). */
export function readinessTarget(target, level) {
  if (!target || !(target.max > target.min)) return target;
  const f = level === 'red' ? 0.5 : level === 'amber' ? 0.7 : 1;
  if (f >= 1) return target;
  return { ...target, max: Math.round(target.min + (target.max - target.min) * f), capped: level };
}

/**
 * Qué parte de los tramos de trabajo fuiste en tu zona. segments: los de la clase (con sec y zone), en orden; hrSeries:
 * [[segundo de clase, ppm]]. → null (sin datos) o { pct, sec, inSec, highSec, lowSec, byZone: { jog?: {pct, sec} … } }
 */
export function zoneCompliance(segments, hrSeries, profile) {
  const segs = Array.isArray(segments) ? segments : [];
  const pts = (Array.isArray(hrSeries) ? hrSeries : []).filter((p) => Array.isArray(p) && Number(p[1]) >= 40 && Number(p[1]) <= 230)
    .map((p) => [Number(p[0]), Number(p[1])]).sort((a, b) => a[0] - b[0]);
  if (!segs.length || pts.length < 6) return null;
  const spans = [];
  let t = 0;
  for (const s of segs) {
    const a = t;
    t += Number(s.sec) || 0;
    if (!WORK_ZONES.includes(s.zone) || t - a <= LAG_SEC) continue;
    let target;
    try { target = hrTargetForZone(s.zone, profile || {}); } catch { continue; }
    spans.push({ a: a + LAG_SEC, b: t, zone: s.zone, min: target.min, max: target.max });
  }
  if (!spans.length) return null;
  const out = { sec: 0, inSec: 0, highSec: 0, lowSec: 0, byZone: {} };
  pts.forEach(([tt, bpm], i) => {
    const gap = i + 1 < pts.length ? pts[i + 1][0] - tt : 10;
    const dt = gap > 0 && gap <= 30 ? gap : 10;
    const sp = spans.find((x) => tt >= x.a && tt < x.b);
    if (!sp) return;
    const z = out.byZone[sp.zone] || (out.byZone[sp.zone] = { sec: 0, inSec: 0 });
    out.sec += dt;
    z.sec += dt;
    if (bpm > sp.max) out.highSec += dt;
    else if (bpm < sp.min) out.lowSec += dt;
    else { out.inSec += dt; z.inSec += dt; }
  });
  if (out.sec < 60) return null;
  out.pct = Math.round((out.inSec / out.sec) * 100);
  for (const z of Object.values(out.byZone)) z.pct = z.sec ? Math.round((z.inSec / z.sec) * 100) : 0;
  return out;
}

/* ───────── Recuperación que mira tu pulso ───────── */

const ZONE_RANK = { walk: 0, warmup: 1, cooldown: 1, jog: 2, run: 3, fast: 4, sprint: 5 };
const REC_OVER = 3;        // ppm por encima del máximo de la zona de la recuperación para tocarla
const REC_STEP_PPM = 3;    // −0,1 km/h por cada 3 ppm de más
const REC_MAX_DROP = 0.8;
const REC_GAP = 0.5;       // si el modo pulso ya te bajó, la recuperación va al menos 0,5 por debajo de lo que corrías

/**
 * Velocidad de la recuperación que viene, según cómo llegas (en «Olas de tempo» la ola suave iba a 9,9 con el pulso a
 * 160–165 y no bajaba). Solo si el tramo siguiente es más suave que el actual. Nunca la sube, nunca más de −0,8.
 * { cur: {zone, speed}, next: {zone, speed}, hr, nextTarget: {min, max}, curSpeed, coachLowered } → velocidad nueva o null
 */
export function recoverySpeed({ cur, next, hr, nextTarget, curSpeed, coachLowered = false } = {}) {
  if (!cur || !next || !(Number(next.speed) > 0)) return null;
  const easier = (ZONE_RANK[next.zone] ?? 9) < (ZONE_RANK[cur.zone] ?? -1);
  if (!easier) return null;
  const planned = Number(next.speed);
  let v = planned;
  const over = Number(hr) - Number(nextTarget?.max);
  if (Number.isFinite(over) && over > REC_OVER) v = Math.min(v, planned - Math.min(REC_MAX_DROP, 0.1 * Math.ceil(over / REC_STEP_PPM)));
  const cs = Number(curSpeed);
  if (coachLowered && cs > 0) v = Math.min(v, cs - REC_GAP);
  v = r1(Math.max(planned - REC_MAX_DROP, v));
  return v <= planned - 0.1 + 1e-9 ? v : null;
}

