// BestRunning · estadísticas del historial (sin DOM).
import { todayKey, addDays, mondayOf, weekDates } from '../core/utils.js';
import { planWeek, countsAsSession } from './planner.js';
import { weekShape } from './week-shape.js';

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const list = (h) => (Array.isArray(h) ? h.filter((s) => s && typeof s === 'object') : []);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Día de una sesión ('YYYY-MM-DD'). */
export function sessionDay(s) {
  if (s?.dayKey) return s.dayKey;
  const d = s?.startedAt ? new Date(s.startedAt) : null;
  return d && !Number.isNaN(d.getTime()) ? todayKey(d) : null;
}

/** Sesión que cuenta para rachas, semanas y logros (regla única: planner.countsAsSession). */
export function sessionCounts(s) {
  return countsAsSession(s);
}

/**
 * Clase «completada» (el ✓ del resumen, del historial y de la tarjeta): la marca del motor al acabar (≥ 90 %) o, en
 * sesiones sin esa marca, el mismo 90 %. Es más exigente que «cuenta como sesión» y se rotula distinto.
 */
export function sessionCompleted(s) {
  return !!s && typeof s === 'object' && (s.completed === true || num(s.completionPct) >= 0.9);
}

/**
 * Recuento único del historial: `sessions`, las que cuentan (sessionCounts), y `started`, las clases empezadas que
 * no llegan a contar. Todo lo que la app rotule «sesiones» sale de aquí; km, minutos y kcal suman también las empezadas.
 */
export function sessionTally(history) {
  const h = list(history);
  const sessions = h.filter(sessionCounts).length;
  return { sessions, started: h.length - sessions };
}

/** «17 sesiones · 1 empezada»: el mismo texto en Hoy, Progreso, Historial y Ajustes. */
export function sessionsText(history) {
  const t = sessionTally(history);
  const bits = [];
  if (t.sessions || !t.started) bits.push(`${t.sessions} ${t.sessions === 1 ? 'sesión' : 'sesiones'}`);
  if (t.started) bits.push(`${t.started} ${t.started === 1 ? 'empezada' : 'empezadas'}`);
  return bits.join(' · ');
}

export function totals(history) {
  const h = list(history);
  return {
    sessions: sessionTally(h).sessions,
    km: round2(h.reduce((a, s) => a + num(s.distanceKm), 0)),
    sec: Math.round(h.reduce((a, s) => a + num(s.elapsedSec), 0)),
    kcal: Math.round(h.reduce((a, s) => a + num(s.kcal), 0)),
  };
}

/** Cubos semanales (lunes a domingo), del más antiguo al de `endKey`. */
export function weeklyBuckets(history, weeks = 12, endKey = todayKey()) {
  const endMon = mondayOf(endKey);
  const buckets = [];
  const byMon = new Map();
  for (let i = Math.max(1, weeks) - 1; i >= 0; i--) {
    const b = { monday: addDays(endMon, -7 * i), km: 0, sec: 0, sessions: 0 };
    buckets.push(b);
    byMon.set(b.monday, b);
  }
  for (const s of list(history)) {
    const d = sessionDay(s);
    const b = d && byMon.get(mondayOf(d));
    if (!b) continue;
    b.km += num(s.distanceKm);
    b.sec += num(s.elapsedSec);
    if (sessionCounts(s)) b.sessions += 1;
  }
  for (const b of buckets) {
    b.km = round2(b.km);
    b.sec = Math.round(b.sec);
  }
  return buckets;
}

/** Clases que pide la racha cada semana: las de tu semana y, si entrenas más de 4 días, con 4 basta. */
export function streakGoal(state) {
  return Math.max(1, Math.min(4, weekShape(state?.schedule).trainDays.length));
}

/** Semanas seguidas cumpliendo streakGoal. La semana en curso suma si ya llega; si no, no rompe la racha. */
export function streakWeeks(state, now = new Date()) {
  const goal = streakGoal(state);
  const per = new Map();
  for (const s of list(state?.history)) {
    if (!sessionCounts(s)) continue;
    const d = weekKeyOf(s); // una clase adelantada cuenta en su semana del plan, como en el resto de pantallas
    if (!d) continue;
    const m = mondayOf(d);
    per.set(m, (per.get(m) || 0) + 1);
  }
  let mon = mondayOf(todayKey(now));
  let streak = (per.get(mon) || 0) >= goal ? 1 : 0;
  mon = addDays(mon, -7);
  while ((per.get(mon) || 0) >= goal) {
    streak++;
    mon = addDays(mon, -7);
  }
  return streak;
}

/** Minutos entrenados por día (para el mapa de calor). */
export function dayValues(history) {
  const out = {};
  for (const s of list(history)) {
    const d = sessionDay(s);
    if (!d) continue;
    out[d] = (out[d] || 0) + num(s.elapsedSec) / 60;
  }
  for (const k of Object.keys(out)) out[k] = round1(out[k]);
  return out;
}

/** Récords personales: cada uno { value, sessionId, dayKey } o null si aún no hay datos. */
export function records(history) {
  const h = list(history);
  const best = (fn, minSec = 0) => {
    let value = 0;
    let ses = null;
    for (const s of h) {
      if (num(s.elapsedSec) < minSec) continue;
      const v = num(fn(s));
      if (v > value) { value = v; ses = s; }
    }
    return ses ? { value, sessionId: ses.id ?? null, dayKey: sessionDay(ses) } : null;
  };
  return {
    longestSec: best((s) => s.elapsedSec),
    maxDistanceKm: best((s) => s.distanceKm),
    maxAvgSpeed: best((s) => s.avgSpeed, 600),
    maxSpeed: best((s) => s.maxSpeed),
    bestVam: best((s) => (s.isTest ? s.test?.vam : 0)),
    mostSprintSec: best((s) => s.timeInZone?.sprint),
  };
}

/** Día que cuenta para la semana: el que la clase cubría en el plan o, si no, el día en que se corrió. */
export function weekKeyOf(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s?.planDate || '')) ? s.planDate : sessionDay(s);
}

/** Calorías que enseñar: las del Apple Watch si existen y son suyas; si no, la estimación de la app. */
export function kcalOf(s) {
  const w = Number(s?.health?.kcal);
  const est = Number(s?.kcal) || 0;
  return w > 0 && Math.round(w) !== Math.round(est) ? { value: Math.round(w), label: 'Kcal · Watch', watch: true } : { value: Math.round(est), label: 'Kcal est.', watch: false };
}

/** Progreso de una semana del plan. */
export function weekProgress(state, mondayKey, now = new Date()) {
  const monday = mondayOf(mondayKey || todayKey(now));
  const today = todayKey(now);
  const days = planWeek(state, monday, now);
  const train = days.filter((d) => d.kind !== 'rest' && d.workout);
  const dates = new Set(weekDates(monday));
  // Una clase adelantada cuenta en la semana del día que cubría (sesiones, minutos y km con la misma regla)
  const ses = list(state?.history).filter((s) => dates.has(weekKeyOf(s)));
  return {
    // Solo días con clase planificada: una sesión extra en un descanso suma minutos y km, no «7 de 6»
    doneSessions: train.filter((d) => d.status === 'done').length,
    plannedSessions: train.length,
    // Solo los días que aún pueden hacerse (hoy o después y sin hacer): el domingo no «quedan 5»
    remainingSessions: train.filter((d) => d.date >= today && d.status !== 'done').length,
    minutes: Math.round(ses.reduce((a, s) => a + num(s.elapsedSec), 0) / 60),
    plannedMinutes: Math.round(train.reduce((a, d) => a + (d.kind === 'test' ? d.minutes * 60 : d.workout.totalSec), 0) / 60),
    km: round2(ses.reduce((a, s) => a + num(s.distanceKm), 0)),
  };
}

/**
 * Cursor del perfil de una sesión, en TIEMPO DE CLASE (el eje del perfil y de la traza), o null:
 * sin cursor si se completó o si la clase llegó a su final (aunque se saltaran tramos).
 */
export function traceCursorSec(s) {
  if (!s || s.completed) return null;
  const tr = Array.isArray(s.speedTrace) ? s.speedTrace.filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0]))) : [];
  if (!tr.length) return null;
  const t = Math.max(...tr.map((p) => Number(p[0]) || 0));
  if (s.finishedEarly === false) return null;
  const planned = num(s.plannedSec);
  if (planned > 0 && t >= planned - 15) return null;
  return t > 0 ? t : null;
}

/** Tramos saltados [[desde, hasta]] en tiempo de clase (session.skips, si el motor los anotó). */
export function skippedRanges(s) {
  const raw = Array.isArray(s?.skips) ? s.skips : [];
  return raw
    .map((g) => (Array.isArray(g) ? [num(g[0]), num(g[1])] : [num(g?.from), num(g?.to)]))
    .filter(([a, b]) => b - a >= 1)
    .sort((a, b) => a[0] - b[0]);
}
