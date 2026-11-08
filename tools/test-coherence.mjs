#!/usr/bin/env node
// RITMUP · que un mismo dato cuente igual en todas partes (auditoría del 8 nov). node tools/test-coherence.mjs
import { weekKeyOf, kcalOf, weekProgress } from '../js/training/stats.js';
import { loadBalance, sessionHrAt } from '../js/training/health-analysis.js';
import { buildHrModel, sessionHrOffset, isHills } from '../js/training/hr-model.js';
import { applyFeedback } from '../js/training/progression.js';
import { defaultState } from '../js/core/store.js';

let n = 0;
let bad = 0;
const ok = (c, msg) => { n++; if (!c) { bad++; console.log(`  ✗ ${msg}`); } };

// Semana: una clase adelantada cuenta entera en el día que cubría
ok(weekKeyOf({ dayKey: '2026-11-08', planDate: '2026-11-09' }) === '2026-11-09', 'clase adelantada: cuenta en el día del plan');
ok(weekKeyOf({ dayKey: '2026-11-08' }) === '2026-11-08', 'sin plan: el día en que se corrió');
{
  const st = defaultState();
  st.plan = { ...st.plan, startDate: '2026-11-02', overrides: {} };
  st.history = [{ id: 'a', dayKey: '2026-11-08', planDate: '2026-11-09', elapsedSec: 1200, distanceKm: 2.8, completionPct: 1, completed: true }];
  const now = new Date('2026-11-09T12:00:00');
  const next = weekProgress(st, '2026-11-09', now);
  const prev = weekProgress(st, '2026-11-02', now);
  ok(next.minutes === 20 && next.km === 2.8, 'los minutos y km van con la sesión a su semana');
  ok(prev.minutes === 0 && prev.km === 0, 'y no se cuentan también en la anterior');
  ok(prev.doneSessions <= prev.plannedSessions, 'nunca más sesiones hechas que planificadas');
}

// Kcal: la del Watch si es suya
ok(kcalOf({ kcal: 286, health: { kcal: 235 } }).value === 235 && kcalOf({ kcal: 286, health: { kcal: 235 } }).label === 'Kcal · Watch', 'kcal del Watch');
ok(kcalOf({ kcal: 610, health: { kcal: 610 } }).label === 'Kcal est.', 'si Salud solo repite nuestra estimación, sigue siendo estimación');
ok(kcalOf({ kcal: 300 }).label === 'Kcal est.' && kcalOf({ kcal: 300, health: { kcal: null } }).value === 300, 'sin Watch, estimación');

// Carga: la media semanal con las semanas que hay de verdad (también con cambio de hora)
{
  const s = (dayKey) => ({ dayKey, elapsedSec: 1800, distanceKm: 4, avgSpeed: 9, hrAvg: 140 });
  const history = ['2026-10-20', '2026-10-27', '2026-11-03', '2026-11-05'].map(s);
  const l = loadBalance(history, { today: '2026-11-09', profile: { hrMax: 176, hrRest: 65 } });
  const total = l.weeks.reduce((a, w) => a + w.load, 0);
  ok(l.ok && Math.abs(l.chronicWeek - total / 3) <= 1, `3 semanas de datos: divide entre 3 (${l.chronicWeek})`);
  ok(l.trainedToday === false, 'sabe si hoy has entrenado');
}

// Cuestas: no valen para comparar pulso y velocidad
ok(isHills({ category: 'hills' }) && isHills({ templateId: 'hill-long' }) && !isHills({ category: 'tempo' }), 'reconoce las cuestas');
{
  const hills = { id: 'h', category: 'hills', startedAt: new Date().toISOString(), speedTrace: [[0, 9], [900, 9]], hrSeries: Array.from({ length: 80 }, (_, i) => [i * 10, 150]) };
  ok(sessionHrAt(hills, 9) === null, 'pulso a una velocidad: sin cuestas');
  ok(sessionHrOffset(hills, { at: () => 130 }) === null, 'aviso de cansancio: sin cuestas');
  ok(buildHrModel([hills, { ...hills, id: 'h2' }, { ...hills, id: 'h3' }]) === null, 'el modelo pulso–velocidad no aprende de cuestas');
}

// Niveles: cuenta lo corrido, no el tramo planificado
{
  const st = defaultState();
  st.levels = { jog: 8.9, run: 10.3, fast: 11.6, sprint: 13 };
  st.progression = { ...st.progression, lastBump: {}, okStreak: {} };
  const base = { id: 'x', dayKey: '2026-11-08', completionPct: 1, completed: true, elapsedSec: 1200, timeInZone: { jog: 300, run: 480, fast: 240 }, levelsAtStart: st.levels };
  const lowered = applyFeedback(st, { ...base, speedTrace: [[0, 8.9], [720, 8.9], [720, 9.5], [1200, 9.5]] }, { feeling: 'easy', rpe: 3 });
  const asPlanned = applyFeedback(st, { ...base, speedTrace: [[0, 8.9], [300, 8.9], [300, 10.3], [780, 10.3], [780, 11.6], [1020, 11.6]] }, { feeling: 'easy', rpe: 3 });
  const noTrace = applyFeedback(st, base, { feeling: 'easy', rpe: 3 });
  ok(!lowered.changes.some((c) => c.level === 'fast'), 'si no corriste a esa velocidad, ese nivel no sube');
  ok(asPlanned.changes.some((c) => c.level === 'fast'), 'si la corriste, sí');
  ok(noTrace.changes.some((c) => c.level === 'fast'), 'sesiones antiguas sin trazado: como siempre');
}

console.log(bad ? `✗ ${n - bad} OK, ${bad} fallos` : `✓ coherencia: ${n} comprobaciones`);
process.exit(bad ? 1 : 0);
