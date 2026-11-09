// RITMUP · el plan reacciona: qué decide, cómo lo aplica y, sobre todo, cuándo NO debe tocar nada.
import { focusUpdate, focusView, setFocusDeclined } from '../js/training/focus.js';
import { seasonWeek, setPlannerToday, cycleInfo } from '../js/training/planner.js';
import { CAPACITIES } from '../js/training/focus-map.js';
import { templateMeta } from '../js/training/season.js';
import { addDays, mondayOf, daysBetween } from '../js/core/utils.js';

let fails = 0; let n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log(`  ✗ ${m}`); } };

const levels = { jog: 8, run: 10, fast: 11.5, sprint: 13 };
const START = '2026-07-06';
const MON = '2026-11-09';
const WED = '2026-11-11';
const at = (d) => new Date(`${d}T12:00:00`);
setPlannerToday(MON);
let id = 0;
const ses = (day, category, rpe, extra = {}) => ({
  id: `s${++id}`, templateId: 'nope', title: 'Clase', category, startedAt: `${day}T08:00:00`, dayKey: day, plannedSec: 1800, elapsedSec: 1800,
  completed: true, completionPct: 1, distanceKm: 5, avgSpeed: 10, kcal: 300, speedTrace: [], levelsAtStart: levels, feeling: 'ok', rpe, notes: '', isTest: false, ...extra,
});
const THREE = { 1: 30, 2: 0, 3: 30, 4: 0, 5: 45, 6: 0, 7: 0 };
const FIVE = { 1: 30, 2: 30, 3: 45, 4: 0, 5: 30, 6: 60, 7: 0 };
const state = (history = [], more = {}, days = THREE) => ({
  levels, profile: { age: 40, hrMax: 180 }, treadmill: { hasIncline: true }, progression: {},
  plan: { startDate: START, overrides: {}, ...(more.plan || {}) }, schedule: days ? { days } : { weekdayMinutes: 20, thursdayMinutes: 50, weekendDay: 6, weekendMinutes: 50 },
  history, ui: more.ui || {},
});
/** Clases repartidas hacia atrás desde el 2 de noviembre. */
const mix = (spec, end = '2026-11-06') => {
  const out = [];
  let d = end;
  for (const [category, count, rpe] of spec) for (let i = 0; i < count; i++) { out.push(ses(d, category, rpe)); d = addDays(d, -3); }
  return out.reverse();
};

/* ───── Qué decide ───── */
const lagging = mix([['endurance', 4, 4], ['tempo', 4, 9], ['intervals', 3, 8]]);
const s1 = state(lagging);
const p1 = focusUpdate(s1, at(MON));
ok(p1?.current?.capacity === 'ritmo', `elige lo que frena: ${p1?.current?.capacity}`);
ok(p1?.current?.keep === 'fondo', `mantiene lo que va bien: ${p1?.current?.keep}`);
ok(p1?.current?.from === MON && p1.current.to === addDays(MON, 28), 'un lunes empieza ese mismo día y dura 4 semanas');
ok(focusUpdate(state(lagging), at(WED))?.current?.from === '2026-11-16', 'a mitad de semana empieza el lunes siguiente: no cambia la semana en curso');
ok(focusUpdate(state([...lagging, ses(MON, 'tempo', 9)]), at(MON))?.current?.from === '2026-11-16', 'con la semana ya empezada (clase hecha el lunes) arranca el lunes siguiente');
const s1b = state(lagging, { plan: { focus: p1 } });
ok(focusUpdate(s1b, at(WED)) === null, 'no vuelve a decidir en la misma semana');

ok(focusUpdate(state(mix([['endurance', 4, 5.5], ['tempo', 4, 7], ['intervals', 3, 8]])), at(MON))?.current == null, 'equilibrado: no cambia nada');
ok(focusUpdate(state(mix([['endurance', 3, 4], ['tempo', 2, 9]])), at(MON))?.current == null, 'con pocas clases no se atreve');
const miss = focusUpdate(state(mix([['endurance', 5, 5], ['tempo', 4, 7]])), at(MON));
ok(miss?.current?.capacity === 'velocidad' && miss.current.why === 'missing', `detecta lo que no se hace: ${miss?.current?.capacity}`);
ok(focusUpdate(state([]), at(MON))?.current == null, 'sin historial no pasa nada');
// Quien valora todo igual no tiene nada que le frene (antes le salía siempre Fondo)
for (const rpe of [3, 5, 7]) {
  const flat = focusUpdate(state(mix([['endurance', 5, rpe], ['tempo', 5, rpe], ['intervals', 4, rpe]])), at(MON));
  ok(flat?.current == null, `todo valorado igual (${rpe}/10): sin enfoque`);
}
// Una decisión de la regla anterior que no iba por debajo de lo normal se retira; una que sí, se conserva
const viejaMala = { current: { capacity: 'fondo', keep: 'velocidad', why: 'struggle', from: MON, to: addDays(MON, 28), baseline: { score: 100, rpe: 5, n: 5 }, holds: [], declined: false }, past: [] };
const fixed = focusUpdate(state(mix([['endurance', 5, 5], ['tempo', 5, 5], ['intervals', 4, 5]]), { plan: { focus: viejaMala } }), at(MON));
ok(fixed && fixed.current == null && fixed.past.length === 0, 'enfoque mal elegido por la regla anterior: se retira');
const viejaBuena = { current: { capacity: 'ritmo', keep: 'fondo', why: 'struggle', from: MON, to: addDays(MON, 28), baseline: { score: null, rpe: 9, n: 4 }, holds: [], declined: false }, past: [] };
ok(focusUpdate(state(lagging, { plan: { focus: viejaBuena } }), at(MON))?.current?.capacity === 'ritmo', 'enfoque bien elegido: se conserva');
const goalPlan = { goal: { distance: '10k', date: '2027-01-17', targetSec: null } };
ok(focusUpdate(state(lagging, { plan: goalPlan }), at(MON)) === null || focusView(state(lagging, { plan: goalPlan }), at(MON))?.state !== 'active', 'con carrera no decide');

// Sin bandazos: dos bloques como mucho y, si no funcionó, otro camino
const entry = (capacity, result) => ({ capacity, keep: 'fondo', why: 'struggle', from: '2026-09-07', to: '2026-10-05', baseline: { score: 60, rpe: 9, n: 4 }, holds: [], declined: false, result });
const rotate2 = focusUpdate(state(lagging, { plan: { focus: { current: null, past: [entry('ritmo', { before: 60, after: 70, delta: 10 }), entry('ritmo', { before: 50, after: 60, delta: 10 })] } } }), at(MON));
ok(rotate2?.current?.capacity !== 'ritmo', `no repite un tercer bloque: ${rotate2?.current?.capacity}`);
const failed = focusUpdate(state(lagging, { plan: { focus: { current: null, past: [entry('ritmo', { before: 60, after: 61, delta: 1 })] } } }), at(MON));
ok(failed?.current?.capacity !== 'ritmo', `si no mejoró, cambia: ${failed?.current?.capacity}`);
const repeat = focusUpdate(state(lagging, { plan: { focus: { current: null, past: [entry('ritmo', { before: 60, after: 70, delta: 10 })] } } }), at(MON));
ok(repeat?.current?.capacity === 'ritmo', 'si funciona y sigue siendo lo que frena, otro bloque');
const ended = focusUpdate(state(lagging, { plan: { focus: { current: entry('ritmo', null), past: [] } } }), at(MON));
ok(ended?.past?.[0]?.capacity === 'ritmo' && ended.current?.from === MON, 'el bloque terminado se archiva');

/* ───── Frenos ───── */
const running = { ...entry('ritmo', null), from: MON, to: addDays(MON, 28) };
const cold = focusUpdate(state(lagging, { plan: { focus: { current: running, past: [] } }, ui: { weekTags: { '2026-11-02': 'cold' } } }), at(MON));
ok(cold?.current?.holds?.includes(MON), 'resfriado la semana pasada: esta en pausa');
ok(focusView(state(lagging, { plan: { focus: cold } }), at(MON))?.state === 'hold', 'la pantalla lo dice');
const fine = focusUpdate(state(lagging, { plan: { focus: { current: running, past: [] } } }), at(MON));
ok(!fine?.current?.holds?.includes(MON), 'sin nada raro no se pausa');

/* ───── Cómo reacciona el plan ───── */
const WEEKS = (from, count) => Array.from({ length: count }, (_, i) => Math.round(daysBetween(START, from) / 7) + i);
const baseFocus = (capacity, keep) => ({ current: { capacity, keep, why: 'struggle', from: '2026-11-16', to: '2026-12-14', baseline: { score: 60, rpe: 9, n: 4 }, holds: [], declined: false }, past: [] });
for (const [label, days] of [['3 días', THREE], ['5 días', FIVE], ['clásica', null]]) {
  const plain = state([], {}, days);
  for (const [capacity, keep] of [['ritmo', 'fondo'], ['fondo', 'velocidad'], ['velocidad', 'fondo']]) {
    const st = state([], { plan: { focus: baseFocus(capacity, keep) } }, days);
    const before = WEEKS('2026-10-19', 4).map((W) => seasonWeek(st, W));
    const beforeP = WEEKS('2026-10-19', 4).map((W) => seasonWeek(plain, W));
    ok(before.every((w, i) => JSON.stringify(w.days) === JSON.stringify(beforeP[i].days)), `${label}/${capacity}: las semanas anteriores no cambian`);
    let hits = 0;
    let active = 0;
    for (const W of WEEKS('2026-11-16', 4)) {
      const w = seasonWeek(st, W);
      const p = seasonWeek(plain, W);
      const free = !w.info.isDeload && !w.info.isTestWeek && w.info.phase.key !== 'transicion';
      const marked = Object.values(w.days).filter((d) => d.focus);
      ok(marked.length <= 1, `${label}/${capacity}: como mucho una sesión de enfoque`);
      if (!free) ok(!marked.length && JSON.stringify(w.days) === JSON.stringify(p.days) || !marked.length, `${label}/${capacity}: descarga y test no se tocan`);
      if (free) active++;
      for (const d of marked) {
        hits++;
        ok(CAPACITIES[capacity].families.includes(d.family), `${label}/${capacity}: el día marcado es de esa capacidad`);
        ok(d.role === 'H' || d.role === 'M', `${label}/${capacity}: solo en una sesión clave`);
      }
      // Nada de días nuevos, ni más duros, ni más carga de la que permite el tope
      for (let i = 1; i <= 7; i++) {
        ok(w.days[i].role === p.days[i].role && w.days[i].minutes === p.days[i].minutes, `${label}/${capacity}: mismo papel y minutos (${i})`);
        if (w.days[i].focus) {
          const rank = { easy: 0, moderate: 1, hard: 2 };
          const want = w.days[i].role === 'H' ? 2 : 1;
          const meta = templateMeta(tplOf(w.days[i].templateId));
          ok(rank[meta.intensity] <= want, `${label}/${capacity}: no sube la intensidad`);
        }
      }
      ok(!w.cap || w.load <= Math.max(w.cap * 1.05, p.load * 1.03), `${label}/${capacity}: respeta el tope de carga (${Math.round(w.load)} vs ${Math.round(p.load)})`);
      const noRepeat = Object.values(w.days).filter((d) => d.templateId).map((d) => d.templateId);
      ok(new Set(noRepeat).size === noRepeat.length, `${label}/${capacity}: sin clases repetidas en la semana`);
    }
    ok(active === 0 || hits >= 1, `${label}/${capacity}: el plan reacciona de verdad (${hits}/${active})`);
    // Rechazado, igual que sin enfoque
    const off = baseFocus(capacity, keep);
    off.current.declined = true;
    const st2 = state([], { plan: { focus: off } }, days);
    ok(WEEKS('2026-11-16', 4).every((W) => JSON.stringify(seasonWeek(st2, W).days) === JSON.stringify(seasonWeek(plain, W).days)), `${label}/${capacity}: rechazado, el plan vuelve a ser el de antes`);
    // En pausa, esa semana no cambia
    const held = baseFocus(capacity, keep);
    const W0 = WEEKS('2026-11-16', 1)[0];
    held.current.holds = ['2026-11-16'];
    const st3 = state([], { plan: { focus: held } }, days);
    ok(!Object.values(seasonWeek(st3, W0).days).some((d) => d.focus), `${label}/${capacity}: la semana en pausa no aprieta`);
  }
}

// Con carrera, el enfoque no toca nada
const withGoal = state([], { plan: { goal: { distance: '10k', date: '2026-12-20', targetSec: null }, focus: baseFocus('velocidad', 'fondo') } });
ok(!WEEKS('2026-11-16', 3).some((W) => Object.values(seasonWeek(withGoal, W).days).some((d) => d.focus) && seasonWeek(withGoal, W).info.goal), 'con carrera manda la carrera');
ok(cycleInfo(withGoal, '2026-11-16') != null, 'calendario intacto');

/* ───── Pantalla y datos raros ───── */
const views = [
  focusView(state(lagging, { plan: { focus: p1 } }), at(MON)), focusView(state(lagging, { plan: { focus: baseFocus('ritmo', 'fondo') } }), at(MON)),
  focusView(state(mix([['endurance', 2, 4]])), at(MON)), focusView(state(mix([['endurance', 4, 5.5], ['tempo', 4, 7], ['intervals', 3, 8]])), at(MON)),
];
ok(['active', 'idle'].includes(views[0].state) && views[1].state === 'next' && views[2].state === 'learning' && views[3].state === 'balanced', `estados: ${views.map((v) => v?.state)}`);
ok(!/7 dic/.test(JSON.stringify(views[0])) , 'el bloque acaba el domingo, no el lunes');
ok(views.every((v) => !/undefined|null|NaN/.test(JSON.stringify(v).replace(/"[a-zA-Z]+":null/g, ''))), 'sin «undefined» en los textos');
ok(/Ritmo/.test(views[0].title) && /fondo/.test(views[0].keepText), 'explica qué y qué mantiene');
ok(focusView(state([]), at(MON)) === null, 'sin clases, nada que enseñar');
const draft = state(lagging, { plan: { focus: p1 } });
setFocusDeclined(draft, true);
ok(draft.plan.focus.current.declined && focusView(draft, at(MON)).state === 'declined', 'se puede rechazar');
setFocusDeclined(draft, false);
ok(!draft.plan.focus.current.declined, 'y recuperar');
for (const bad of [null, 7, 'x', {}, { current: { capacity: 'nada', from: MON, to: MON } }, { current: {}, past: 'x' }]) {
  let threw = false;
  try { seasonWeek(state([], { plan: { focus: bad } }), WEEKS('2026-11-16', 1)[0]); focusView(state(lagging, { plan: { focus: bad } }), at(MON)); focusUpdate(state(lagging, { plan: { focus: bad } }), at(MON)); } catch (e) { threw = e; }
  ok(!threw, `enfoque corrupto no rompe nada: ${JSON.stringify(bad)} ${threw || ''}`);
}

function tplOf(id2) { return TEMPLATES.find((t) => t.id === id2); }
import { TEMPLATES } from '../js/training/templates.js';

console.log(`Enfoque: ${n - fails}/${n}`);
if (fails) process.exit(1);
void mondayOf;
