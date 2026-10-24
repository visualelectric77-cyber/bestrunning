#!/usr/bin/env node
// RITMUP · pruebas del plan hablado (js/training/plan-intent.js).
import { planChanges } from '../js/training/plan-intent.js';
let n = 0; let bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log(`  ✗ ${m}`); } };
const T = { 'ladder': 'intervals', 'easy-run': 'recovery', 'long': 'endurance', 'tempo3': 'tempo' };
const deps = {
  getTemplate: (id) => (T[id] ? { category: T[id] } : null),
  alternativesFor: () => [{ templateId: 'easy-run', title: 'Rodaje suave', totalSec: 1800 }, { templateId: 'tempo3', title: 'Tempo', totalSec: 1800 }],
  setDayOverride: (dr, k, o) => { dr.push(['set', k, o]); },
  swapDays: (dr, a, b) => { dr.push(['swap', a, b]); },
};
const today = '2026-10-26'; // lunes
const week = [
  { date: '2026-10-26', kind: 'class', status: 'today', templateId: 'ladder', minutes: 45, workout: { title: 'Escalera', totalSec: 2700 } },
  { date: '2026-10-27', kind: 'rest', status: 'rest', workout: null },
  { date: '2026-10-28', kind: 'class', status: 'upcoming', templateId: 'long', minutes: 60, workout: { title: 'Fondo', totalSec: 3600 } },
  { date: '2026-10-29', kind: 'class', status: 'upcoming', templateId: 'tempo3', minutes: 30, workout: { title: 'Tempo', totalSec: 1800 } },
];
const apply = (ch) => { const dr = []; ch.forEach((c) => c.apply(dr)); return dr; };
ok(planChanges({}, { action: 'none' }, today, week, deps).length === 0, 'none: nada');
ok(planChanges({}, { action: 'bogus' }, today, week, deps).length === 0, 'acción desconocida: nada');
const less = planChanges({}, { action: 'lessTime', days: [], minutes: 0 }, today, week, deps);
ok(less.length === 3 && apply(less).every((x) => x[0] === 'set' && x[2].minutes < 60), `menos tiempo en las 3 clases (${less.map((c) => c.text).join(' | ')})`);
ok(planChanges({}, { action: 'lessTime', days: [], minutes: 30 }, today, week, deps).every((c) => / 30 min$/.test(c.text) || / 20 min$/.test(c.text)), 'menos tiempo con minutos pedidos');
const easy = planChanges({}, { action: 'easier', days: ['2026-10-26'], minutes: 0 }, today, week, deps);
ok(easy.length === 1 && apply(easy)[0][2].templateId === 'easy-run', 'más fácil: cambia la escalera por un rodaje');
ok(planChanges({}, { action: 'easier', days: ['2026-10-28'] }, today, week, deps).length === 0, 'ya es suave: no cambia');
const skip = planChanges({}, { action: 'skipDay', days: [] }, today, week, deps);
ok(skip.length === 1 && skip[0].date === today && apply(skip)[0][2].rest === true, 'saltar sin día: hoy');
const mv = planChanges({}, { action: 'moveDay', days: ['2026-10-26', '2026-10-27'] }, today, week, deps);
ok(mv.length === 1 && apply(mv)[0][0] === 'swap', 'mover: intercambia los dos días');
ok(planChanges({}, { action: 'moveDay', days: ['2026-10-26'] }, today, week, deps).length === 0, 'mover con un solo día: nada');
ok(planChanges({}, { action: 'restWeek' }, today, week, deps).length === 3, 'semana de descanso: las 3 clases');
ok(planChanges({}, { action: 'lessTime', days: ['2025-01-01'] }, today, week, deps).length === 3, 'días inválidos: se ignoran');
console.log(bad ? `✗ ${n - bad} OK, ${bad} fallos` : `✓ plan hablado: ${n} comprobaciones`);
process.exitCode = bad ? 1 : 0;
