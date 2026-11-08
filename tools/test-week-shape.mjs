// RITMUP · cada usuario monta su semana: cualquier combinación de días y minutos da un plan válido.
import { scheduleDays, weekShape, WEEKDAYS } from '../js/training/week-shape.js';
import { seasonWeek, planWeek, setPlannerToday, nextTestDate } from '../js/training/planner.js';
import { defaultState } from '../js/core/store.js';

let fails = 0; let n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log(`  ✗ ${m}`); } };
const base = (schedule, extra = {}) => ({ levels: { jog: 7, run: 9, fast: 10.2, sprint: 11.5 }, treadmill: { hasIncline: false }, history: [], progression: {}, plan: { startDate: '2026-01-05', overrides: {} }, schedule, ...extra });
const D = (a) => Object.fromEntries(a.map((m, i) => [i + 1, m]));
setPlannerToday('2026-01-05');

// La semana fija de antes se sigue leyendo igual
const old = weekShape({ weekdayMinutes: 25, thursdayMinutes: 55, weekendDay: 7, weekendMinutes: 60 });
ok(old.classic && old.days[1] === 25 && old.days[4] === 55 && old.days[7] === 60 && old.days[6] === 0, 'semana antigua');
ok(weekShape(null).classic && weekShape(null).days[4] === 50, 'sin semana: valores internos');
ok(weekShape({ days: D([20, 20, 20, 50, 20, 50, 0]) }).classic, 'la misma forma en formato nuevo sigue el plan clásico');
const a1 = seasonWeek(base({ weekdayMinutes: 20, thursdayMinutes: 50, weekendDay: 6, weekendMinutes: 50 }), 2);
const a2 = seasonWeek(base({ days: D([20, 20, 20, 50, 20, 50, 0]) }), 2);
ok(JSON.stringify(Object.values(a1.days).map((d) => d.templateId)) === JSON.stringify(Object.values(a2.days).map((d) => d.templateId)), 'mismo plan en los dos formatos');

// Lo que pidieron los testers y más
const SHAPES = {
  'todos 20': [20, 20, 20, 20, 20, 20, 20], 'sábado y domingo': [0, 0, 0, 0, 0, 60, 60], 'finde corto': [0, 0, 0, 0, 0, 30, 30],
  'tres días': [30, 0, 30, 0, 30, 0, 0], 'tres + largo': [30, 0, 30, 0, 30, 60, 0], 'laborables 45': [45, 45, 45, 45, 45, 0, 0],
  'solo domingo': [0, 0, 0, 0, 0, 0, 45], 'martes y jueves': [0, 30, 0, 45, 0, 0, 0], 'todos 60': [60, 60, 60, 60, 60, 60, 60],
  'mezcla': [30, 20, 45, 20, 30, 60, 60], 'un día 20': [0, 0, 20, 0, 0, 0, 0], 'sin jueves': [40, 0, 40, 0, 40, 40, 0],
};
for (const [name, a] of Object.entries(SHAPES)) {
  for (const incline of [false, true]) {
    const st = base({ days: D(a) }, { treadmill: { hasIncline: incline } });
    let prevLast = null;
    let tests = 0;
    for (let w = 0; w < 30; w++) {
      const x = seasonWeek(st, w);
      const ds = WEEKDAYS.map((d) => x.days[d]);
      ds.forEach((d, i) => {
        ok((a[i] > 0) === !!d.templateId, `${name}: w${w} día ${i + 1} entrena lo elegido`);
        if (a[i] > 0 && !x.info.isDeload && d.role !== 'T') ok(d.minutes === a[i], `${name}: w${w} día ${i + 1} ${d.minutes}′ ≠ ${a[i]}′`);
        if (a[i] > 0) ok(d.minutes <= a[i] && d.minutes >= 20, `${name}: w${w} día ${i + 1} ${d.minutes}′ fuera de tu tiempo`);
        const prev = i ? ds[i - 1].role : prevLast;
        ok(!(['H', 'T'].includes(d.role) && ['H', 'T'].includes(prev)), `${name}: w${w} dos días duros seguidos`);
        if (d.role === 'T') tests++;
      });
      prevLast = ds[6].role;
      const ids = ds.map((d) => d.templateId).filter(Boolean);
      ok(new Set(ids).size === ids.length, `${name}: w${w} repite clase`);
    }
    ok(tests >= 4, `${name}: hay tests VAM (${tests})`);
    const nt = nextTestDate(st, '2026-01-05');
    ok(a[(new Date(`${nt}T12:00:00`).getDay() + 6) % 7] > 0, `${name}: el próximo test cae en un día de entreno`);
  }
}

// Con objetivo: quien corre 20′ no pasa a tiradas largas; quien tiene día largo, sí crece
const goal = { distance: '10k', date: '2026-04-19' };
const g20 = base({ days: D([20, 20, 20, 20, 20, 20, 20]) }, { plan: { startDate: '2026-01-05', overrides: {}, goal } });
const gLong = base({ days: D([30, 0, 30, 0, 0, 45, 0]) }, { plan: { startDate: '2026-01-05', overrides: {}, goal } });
let max20 = 0; let maxLong = 0;
for (let w = 0; w < 15; w++) {
  max20 = Math.max(max20, ...Object.values(seasonWeek(g20, w).days).map((d) => d.minutes || 0));
  maxLong = Math.max(maxLong, seasonWeek(gLong, w).days[6].minutes || 0);
}
ok(max20 === 20, `con objetivo y 20′ al día, nunca más de 20′ (${max20})`);
ok(maxLong >= 45, 'con día largo, la tirada se mantiene o crece');

// Semana sin ningún día: no rompe
ok(planWeek(base({ days: D([0, 0, 0, 0, 0, 0, 0]) }), '2026-01-05').every((d) => d.kind === 'rest'), 'semana vacía sin errores');
ok(scheduleDays({ days: { 1: '30', 2: null } })[1] === 30, 'días con texto o vacíos');

// Un usuario nuevo no hereda datos personales
const p = defaultState().profile;
ok(p.age === null && p.weightKg === null && p.sex === null && p.hrMax === null, 'perfil nuevo vacío');

console.log(`${fails ? '✗' : '✓'} test-week-shape: ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
