// RITMUP · bonus de la semana (sin DOM). Si ya has hecho todas las sesiones de tu semana y te apetece entrenar en un
// día de descanso, no tiene sentido adelantar la clase del lunes para repetirla el lunes: se ofrece un entreno
// sorpresa de la duración que elijas, con formatos que el plan nunca pone (plantillas `bonus` de templates.js).
// Es un extra: no sustituye a ninguna clase del plan ni cambia la semana siguiente.
import { TEMPLATES } from './templates.js';
import { buildWorkout } from './generator.js';
import { planWeek, planDay, countsAsSession } from './planner.js';
import { mondayOf, hashStr } from '../core/utils.js';

export const BONUS_MINUTES = [20, 30, 45, 60];
const allows = (t, minutes) => minutes >= Math.min(...t.durations) && minutes <= Math.max(...t.durations);

/** Formatos de bonus disponibles para esa duración. */
export function bonusTemplates(minutes = null, { hasIncline = false } = {}) {
  return TEMPLATES.filter((t) => t.bonus && (minutes == null || allows(t, minutes)) && (!t.requiresIncline || hasIncline));
}

/** ¿Están hechas todas las sesiones previstas de esa semana (lunes a domingo)? Sin sesiones previstas, no. */
export function weekComplete(state, dateKey, now = new Date()) {
  let days = [];
  try { days = planWeek(state, mondayOf(dateKey), now) || []; } catch { days = []; }
  const train = days.filter((d) => d && d.kind !== 'rest' && !d.race);
  return train.length > 0 && train.every((d) => d.status === 'done');
}

/** ¿Se ofrece el bonus ese día? Es descanso, la semana está completa y ese día aún no has entrenado. */
export function bonusOffer(state, dateKey, now = new Date()) {
  let day = null;
  try { day = planDay(state, dateKey, now); } catch { day = null; }
  if (!day || day.kind !== 'rest') return false;
  if ((Array.isArray(state?.history) ? state.history : []).some((s) => s && s.dayKey === dateKey && countsAsSession(s))) return false;
  return weekComplete(state, dateKey, now);
}

/**
 * El bonus de ese día con la duración elegida. El formato es el mismo elijas el tiempo que elijas (cambia cada semana
 * y nunca repite ninguno de los dos últimos que hiciste); la semilla es del día. → clase construida o null
 */
export function bonusPick(state, dateKey, minutes) {
  const min = BONUS_MINUTES.includes(Number(minutes)) ? Number(minutes) : 30;
  const hasIncline = !!state?.treadmill?.hasIncline;
  const all = bonusTemplates(min, { hasIncline });
  if (!all.length) return null;
  const recent = (Array.isArray(state?.history) ? state.history : [])
    .filter((s) => s && typeof s.templateId === 'string' && s.templateId.startsWith('bonus-'))
    .sort((a, b) => (String(a.startedAt) < String(b.startedAt) ? 1 : -1))
    .slice(0, 2).map((s) => s.templateId);
  const fresh = all.filter((t) => !recent.includes(t.id));
  const pool = fresh.length ? fresh : all;
  const t = pool[hashStr(`bonus|${mondayOf(dateKey)}`) % pool.length];
  return buildWorkout(t.id, {
    minutes: min, levels: state?.levels, seed: hashStr(`bonus|${dateKey}`), loadFactor: 1, hasIncline,
    treadmill: state?.treadmill, weightKg: Number(state?.profile?.weightKg) || 78,
  });
}
