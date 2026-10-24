// RITMUP · plan hablado: convierte la intención que entiende la IA del iPhone (planIntent) en cambios CONCRETOS del
// plan, con las mismas herramientas que usa la pantalla Plan (setDayOverride, swapDays). La IA nunca toca el plan:
// propone { action, days, minutes } y aquí se decide qué cambia; el usuario confirma antes de aplicar nada.
// Lógica pura (sin DOM); planner se inyecta para poder probarla.

const WEEKDAY = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DURS = [20, 30, 45, 60];
const EASY = new Set(['recovery', 'endurance']);
const HARD = new Set(['intervals', 'tempo', 'fartlek', 'hills', 'challenge']);
export const PLAN_ACTIONS = ['lessTime', 'moreTime', 'easier', 'harder', 'skipDay', 'moveDay', 'restWeek', 'none'];

const isKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
const dayName = (key) => { const [y, m, d] = key.split('-').map(Number); return WEEKDAY[new Date(y, m - 1, d).getDay()]; };

/**
 * intent: { action, days: [dayKey], minutes } · today: dayKey · week: días de la semana (planWeek) desde hoy
 * deps: { alternativesFor(state, dateKey, n), getTemplate(id), setDayOverride(draft, key, o), swapDays(draft, a, b) }
 * → [{ date, text, apply(draft) }]  (vacío si no hay nada que cambiar)
 */
export function planChanges(state, intent, today, week, deps) {
  const action = PLAN_ACTIONS.includes(intent?.action) ? intent.action : 'none';
  if (action === 'none') return [];
  const days = (Array.isArray(week) ? week : []).filter((d) => d && isKey(d.date) && d.date >= today);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const asked = (Array.isArray(intent.days) ? intent.days : []).filter((k) => isKey(k) && byDate.has(k));
  const withClass = (d) => d && d.kind !== 'rest' && d.workout && d.status !== 'done';
  const targets = (asked.length ? asked.map((k) => byDate.get(k)) : days).filter(withClass);
  const minutesOf = (d) => Number(d.minutes) || Math.round((Number(d.workout?.totalSec) || 0) / 60) || 30;
  const title = (d) => d.workout?.title || 'Clase';
  const out = [];

  if (action === 'lessTime' || action === 'moreTime') {
    for (const d of targets) {
      const cur = minutesOf(d);
      let nv;
      if (action === 'lessTime') nv = intent.minutes > 0 ? Math.max(...DURS.filter((x) => x <= Math.max(20, intent.minutes)), 20) : [...DURS].reverse().find((x) => x < cur) || 20;
      else nv = intent.minutes > 0 ? Math.min(...DURS.filter((x) => x >= Math.min(60, intent.minutes)), 60) : DURS.find((x) => x > cur) || 60;
      if (action === 'lessTime' ? nv >= cur : nv <= cur) continue;
      out.push({ date: d.date, text: `${dayName(d.date)} · ${title(d)}: ${cur} → ${nv} min`, apply: (dr) => deps.setDayOverride(dr, d.date, { templateId: d.templateId, minutes: nv }) });
    }
  } else if (action === 'easier' || action === 'harder') {
    const want = action === 'easier' ? EASY : HARD;
    for (const d of targets) {
      const curCat = deps.getTemplate(d.templateId)?.category;
      if (want.has(curCat)) continue;
      const alt = (deps.alternativesFor(state, d.date, 8) || []).find((w) => want.has(deps.getTemplate(w.templateId)?.category));
      if (!alt) continue;
      const mins = Math.round((Number(alt.totalSec) || 0) / 60) || minutesOf(d);
      out.push({ date: d.date, text: `${dayName(d.date)} · ${title(d)} → ${alt.title}`, apply: (dr) => deps.setDayOverride(dr, d.date, { templateId: alt.templateId, minutes: mins }) });
    }
  } else if (action === 'skipDay' || action === 'restWeek') {
    const list = action === 'skipDay' ? (asked.length ? targets : targets.filter((d) => d.date === today).slice(0, 1)) : targets;
    for (const d of list) out.push({ date: d.date, text: `${dayName(d.date)} · ${title(d)} → descanso`, apply: (dr) => deps.setDayOverride(dr, d.date, { rest: true }) });
  } else if (action === 'moveDay') {
    const [a, b] = asked;
    if (a && b && a !== b) {
      const da = byDate.get(a);
      const db = byDate.get(b);
      const what = (d) => (d.kind === 'rest' ? 'descanso' : title(d));
      out.push({ date: a, text: `${dayName(a)} (${what(da)}) ⇄ ${dayName(b)} (${what(db)})`, apply: (dr) => deps.swapDays(dr, a, b) });
    }
  }
  return out;
}
