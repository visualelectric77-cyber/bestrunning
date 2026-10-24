// RITMUP · datos del informe semanal que escribe la IA del iPhone (tarea 'weeklyReport'). Puro: sin DOM ni red.
// La IA solo redacta: todos los números salen de aquí y `allowed` es la lista exacta que puede usar (la página
// descarta el texto si aparece otra cifra, con numbersAreGrounded).
import { weekProgress } from './stats.js';
import { buildHrModel, sessionHrOffset } from './hr-model.js';
import { mondayOf, addDays, todayKey } from '../core/utils.js';

const r1 = (x) => Math.round(Number(x) * 10) / 10;
const r2 = (x) => Math.round(Number(x) * 100) / 100;
const dayOf = (s) => String(s?.dayKey || s?.startedAt || '').slice(0, 10);

/** Sesiones (sin tests ni descartadas) entre dos dayKey incluidos. */
function sessionsBetween(history, from, to) {
  return (Array.isArray(history) ? history : []).filter((s) => s && !s.isTest && dayOf(s) >= from && dayOf(s) <= to);
}

/**
 * → null (nada que contar) o { week, sig, input, allowed }.
 *   week: lunes AAAA-MM-DD · sig: firma para saber si el informe guardado sigue valiendo.
 *   opts.readiness: nivel del semáforo ('green'|'amber'|'red') si se sabe · opts.goal: texto del objetivo, si hay.
 */
export function weekReportInput(state, now = new Date(), opts = {}) {
  const today = todayKey(now);
  const monday = mondayOf(today);
  const sunday = addDays(monday, 6);
  const history = state?.history || [];
  const ses = sessionsBetween(history, monday, sunday);
  if (!ses.length) return null;
  let wp = null;
  try { wp = weekProgress(state, monday, now); } catch { wp = null; }
  const minutes = Math.round(ses.reduce((a, s) => a + (Number(s.elapsedSec) || 0), 0) / 60);
  const km = r2(ses.reduce((a, s) => a + (Number(s.distanceKm) || 0), 0));
  const hours = minutes / 60;
  const input = {
    sessions: wp?.doneSessions || ses.length,
    planned: wp?.plannedSessions ?? 0,
    minutes,
    km,
    avgKmh: hours > 0 ? r1(km / hours) : 0,
    longestMin: Math.round(Math.max(...ses.map((s) => (Number(s.elapsedSec) || 0) / 60))),
  };

  // Pulso a la misma velocidad frente a lo normal (modelo de las 8 semanas anteriores a esta semana)
  try {
    const model = buildHrModel(history.filter((s) => dayOf(s) < monday), { now: now.getTime() });
    const offs = ses.map((s) => sessionHrOffset(s, model)).filter(Boolean);
    if (offs.length) {
      const d = Math.round(offs.reduce((a, o) => a + o.ppm, 0) / offs.length);
      if (Math.abs(d) >= 3) input.hrDelta = d;
    }
  } catch { /* sin pulso */ }

  if (opts.readiness) input.readiness = opts.readiness;
  if (opts.goal) input.goal = String(opts.goal).slice(0, 80);

  const prev = sessionsBetween(history, addDays(monday, -7), addDays(monday, -1));
  if (prev.length) {
    const pKm = r2(prev.reduce((a, s) => a + (Number(s.distanceKm) || 0), 0));
    const pMin = Math.round(prev.reduce((a, s) => a + (Number(s.elapsedSec) || 0), 0) / 60);
    // Solo lo que cambia (un «0 km menos» confunde al modelo y al corredor)
    const vs = { sessions: ses.length - prev.length, km: r2(km - pKm), minutes: minutes - pMin };
    for (const k of Object.keys(vs)) if (!vs[k]) delete vs[k];
    if (Object.keys(vs).length) input.vsPrev = vs;
  }

  const nums = [input.sessions, input.planned, input.minutes, input.km, input.avgKmh, input.longestMin,
    input.hrDelta, input.hrDelta != null ? Math.abs(input.hrDelta) : null,
    input.vsPrev?.sessions, input.vsPrev?.km, input.vsPrev?.minutes,
    input.vsPrev ? Math.abs(input.vsPrev.sessions) : null, input.vsPrev ? Math.abs(input.vsPrev.km) : null,
    input.vsPrev ? Math.abs(input.vsPrev.minutes) : null,
    input.planned - input.sessions > 0 ? input.planned - input.sessions : null];
  // Cifras del objetivo («10K», «15 de marzo») también valen tal cual
  const goalNums = String(input.goal || '').match(/\d+(?:[.,]\d+)?/g) || [];
  const allowed = [...nums.filter((v) => v != null && Number.isFinite(Number(v))), ...goalNums.map((g) => Number(g.replace(',', '.')))];
  const sig = `${monday}|${input.sessions}|${input.km}|${input.minutes}`;
  return { week: monday, sig, input, allowed };
}
