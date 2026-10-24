// RITMUP · datos del briefing antes de la clase (pantalla de Preparación) que escribe la IA del iPhone (tarea
// 'classBriefing'). Puro: sin DOM ni red. La IA solo redacta; todos los números salen de aquí y `allowed` es la lista
// exacta que puede usar (la página descarta el texto si aparece otra cifra, con numbersAreGrounded).
import { ZONES } from './levels.js';
import { FEELINGS } from './progression.js';
import { readiness } from './readiness.js';
import { buildHrModel, sessionHrOffset } from './hr-model.js';
import { goalStatus } from './goal.js';
import { daysBetween } from '../core/utils.js';

const r1 = (x) => Math.round(Number(x) * 10) / 10;
const dayOf = (s) => String(s?.dayKey || s?.startedAt || '').slice(0, 10);
const numsOf = (v) => (String(v ?? '').match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')));

/**
 * → null (sin clase) o { key, input, allowed }.
 *   key: para guardar el briefing del día (misma clase, mismo día y mismo semáforo = mismo texto).
 *   opts.today 'AAAA-MM-DD' · opts.metrics: métricas de Salud (cachedHealthMetrics) o null · opts.now (ms).
 */
export function briefingInput(state, workout, { today, metrics = null, now = Date.now() } = {}) {
  const segs = Array.isArray(workout?.segments) ? workout.segments.filter((s) => Number(s?.sec) > 0) : [];
  if (!segs.length || !today) return null;
  const minutes = Math.round((Number(workout.totalSec) || segs.reduce((a, s) => a + Number(s.sec), 0)) / 60);

  // Las zonas que mandan en la clase (las que más tiempo ocupan, sin calentar ni enfriar), con su velocidad
  const byZone = new Map();
  for (const s of segs) {
    if (s.zone === 'warmup' || s.zone === 'cooldown' || s.zone === 'walk') continue;
    const z = byZone.get(s.zone) || { sec: 0, kmh: 0 };
    z.sec += Number(s.sec);
    z.kmh = Math.max(z.kmh, Number(s.speed) || 0);
    byZone.set(s.zone, z);
  }
  const zones = [...byZone.entries()]
    .sort((a, b) => b[1].sec - a[1].sec)
    .slice(0, 3)
    .map(([k, z]) => ({ zone: ZONES[k]?.name || k, minutes: Math.round(z.sec / 60), kmh: r1(z.kmh) }));

  const input = {
    title: String(workout.title || 'Entrenamiento').slice(0, 60),
    minutes,
    km: r1(workout.estDistanceKm || 0),
    maxKmh: r1(workout.maxSpeed || Math.max(...segs.map((s) => Number(s.speed) || 0))),
    zones,
  };
  if (workout.isTest) input.isTest = true;

  // Cómo llega (semáforo de fatiga de Salud)
  let level = null;
  try {
    const r = readiness(metrics, today);
    if (r) {
      level = r.level;
      input.readiness = { level: r.level };
      if (r.resting && Math.abs(r.resting.delta) >= 3) input.readiness.restingDelta = r.resting.delta;
      if (r.hrv && Math.abs(r.hrv.pct) >= 10) input.readiness.hrvPct = r.hrv.pct;
    }
  } catch { /* sin métricas */ }

  // Sus dos últimas sesiones (sin tests): hace cuántos días, cuánto y cómo se sintió; pulso frente a lo normal
  const history = (Array.isArray(state?.history) ? state.history : []).filter((s) => s && !s.isTest && dayOf(s) <= today);
  const last = history.slice(-2).reverse();
  let model = null;
  try { model = buildHrModel(history, { now }); } catch { model = null; }
  if (last.length) {
    input.last = last.map((s) => {
      const o = {
        daysAgo: Math.max(0, daysBetween(dayOf(s), today)),
        minutes: Math.round((Number(s.elapsedSec) || 0) / 60),
        km: r1(s.distanceKm || 0),
      };
      const f = FEELINGS.find((x) => x.key === s.feeling);
      if (f) o.feel = f.label;
      try {
        const off = model ? sessionHrOffset(s, buildHrModel(history, { now, exceptId: s.id }) || model) : null;
        if (off && Math.abs(off.ppm) >= 5) o.hrVsUsual = off.ppm;
      } catch { /* sin pulso */ }
      return o;
    });
  }

  // Objetivo de carrera, si lo hay
  try {
    const gs = goalStatus(state, today);
    if (gs && gs.daysLeft >= 0) input.goal = `${gs.countdown} para tu ${gs.title}`;
  } catch { /* sin objetivo */ }

  const allowed = [
    input.minutes, input.km, input.maxKmh,
    ...zones.flatMap((z) => [z.minutes, z.kmh]),
    input.readiness?.restingDelta, input.readiness?.restingDelta != null ? Math.abs(input.readiness.restingDelta) : null,
    input.readiness?.hrvPct, input.readiness?.hrvPct != null ? Math.abs(input.readiness.hrvPct) : null,
    ...(input.last || []).flatMap((l) => [l.daysAgo, l.minutes, l.km, l.hrVsUsual, l.hrVsUsual != null ? Math.abs(l.hrVsUsual) : null]),
    ...numsOf(input.goal), ...numsOf(input.title),
  ].filter((v) => v != null && Number.isFinite(Number(v)));

  const key = `${today}|${workout.id || input.title}|${minutes}|${level || '-'}`;
  return { key, input, allowed };
}
