// RITMUP · duraciones que puedes elegir a mano para una clase del plan (sin DOM).
// Las plantillas declaran pocas duraciones (las largas, 45 y 60), pero todas se construyen bien con cualquier número
// de minutos: aquí sale la lista que se ofrece, de 5 en 5, para el día que no sabes si tendrás 45, 50, 60 o menos.
// No cambia qué clases elige el plan (eso sigue saliendo de `durations`): solo lo que TÚ puedes pedir.
import { getTemplate } from './templates.js';
import { setDayOverride } from './planner.js';
import { parseWorkoutId } from './generator.js';

export const DURATION_STEP = 5;
/** Una clase larga (de 45 min en adelante) se puede acortar hasta aquí. */
export const LONG_FLOOR = 30;

/**
 * Minutos que se pueden elegir para una clase: de 5 en 5 entre la más corta y la más larga de su plantilla (las
 * largas bajan hasta 30), más las suyas y la actual. → [] si la clase no admite cambio (test VAM, carrera, duración
 * única).
 */
export function durationChoices(templateId, current = 0) {
  let t = null;
  try { t = getTemplate(templateId); } catch { t = null; }
  const ds = (Array.isArray(t?.durations) ? t.durations : []).map(Number).filter((m) => m > 0);
  if (!t || t.category === 'test' || ds.length < 2) return [];
  const hi = Math.max(...ds);
  const lo = Math.min(Math.min(...ds), LONG_FLOOR);
  const out = new Set(ds);
  for (let m = Math.ceil(lo / DURATION_STEP) * DURATION_STEP; m <= hi; m += DURATION_STEP) out.add(m);
  const cur = Math.round(Number(current) || 0);
  if (cur > 0) out.add(cur);
  return [...out].sort((a, b) => a - b);
}

/**
 * Cambia a mano los minutos de un día del plan sin cambiar de clase. `day` es lo que da planDay (date, templateId,
 * workout). La semilla de la clase (va en su id) viaja con el cambio: sin ella, una clase «Ritmo de carrera»
 * perdería su velocidad objetivo (va en la semilla) y saldría la versión genérica.
 */
export function setDayMinutes(draft, day, minutes) {
  const m = Math.round(Number(minutes) || 0);
  if (!day?.date || !day.templateId || !(m > 0)) return false;
  setDayOverride(draft, day.date, { templateId: day.templateId, minutes: m });
  const ov = draft?.plan?.overrides?.[day.date];
  let seed = Number(day.seed);
  if (!Number.isFinite(seed)) {
    let p = null;
    try { p = parseWorkoutId(day.workout?.id); } catch { p = null; }
    seed = p && p.templateId === day.templateId ? Number(p.seed) : NaN;
  }
  if (ov && ov.templateId === day.templateId && Number.isFinite(seed) && (ov.seed == null || ov.seed === '')) ov.seed = seed;
  return true;
}
