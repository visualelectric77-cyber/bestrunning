// RITMUP · análisis de cada clase y balance: cifras medidas, casos sin datos y nada que se rompa con un historial raro.
import { classAnalysis, executionOf, speedAdherence, hrRecovery, hrDrift, compareWithPast, sessionLoad } from '../js/training/class-analysis.js';
import { trainingReview } from '../js/training/training-review.js';
import { evolution, WEEK_TAGS } from '../js/training/evolution.js';
import { setPlannerToday, planDay } from '../js/training/planner.js';
import { addDays, mondayOf } from '../js/core/utils.js';

let fails = 0; let n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log(`  ✗ ${m}`); } };
const profile = { age: 40, hrMax: 180, hrRest: 55 };
const levels = { jog: 8, run: 10, fast: 11.5, sprint: 13 };
const SEGS = [
  { zone: 'warmup', sec: 300, speed: 6 }, { zone: 'jog', sec: 600, speed: 8 }, { zone: 'run', sec: 300, speed: 10 }, { zone: 'jog', sec: 300, speed: 8 },
  { zone: 'fast', sec: 120, speed: 11.5 }, { zone: 'jog', sec: 180, speed: 8 }, { zone: 'jog', sec: 600, speed: 8 }, { zone: 'cooldown', sec: 120, speed: 6 },
];
const trace = (shift = 0, segs = SEGS) => { let t = 0; return segs.map((g) => { const p = [t, Math.round((g.speed + shift) * 10) / 10]; t += g.sec; return p; }); };
function hrFor(base, drift = 0, segs = SEGS) {
  const out = []; let t = 0;
  for (const g of segs) {
    const target = ({ walk: 105, warmup: 110, cooldown: 115, jog: 138, run: 152, fast: 165, sprint: 172 }[g.zone] ?? 130) + base;
    for (let i = 0; i < g.sec; i += 10) out.push([t + i, target + (drift * (t + i)) / 2520]);
    t += g.sec;
  }
  return out;
}
const TOTAL = SEGS.reduce((a, g) => a + g.sec, 0);
let id = 0;
function ses(day, extra = {}) {
  id++;
  return {
    id: `s${id}`, templateId: 'tpl-a', workoutId: null, title: 'Clase A', category: 'tempo', startedAt: `${day}T08:00:00.000Z`, dayKey: day, plannedSec: TOTAL, elapsedSec: TOTAL,
    completed: true, completionPct: 1, distanceKm: 5.6, avgSpeed: 8.0, maxSpeed: 11.5, kcal: 400, timeInZone: { warmup: 300, jog: 1680, run: 300, fast: 120, cooldown: 120 },
    speedTrace: trace(), adjustments: {}, levelsAtStart: levels, feeling: 'ok', rpe: 5, hrAvg: null, hrMax: null, notes: '', isTest: false, test: null, levelChanges: [], ...extra,
  };
}
const withHr = (day, base, extra = {}) => ses(day, { hrSeries: hrFor(base), hrAvg: 140 + base, hrMax: 166 + base, ...extra });
const today = '2026-11-09';
const now = new Date(`${today}T20:00:00.000Z`);
setPlannerToday(today);
const baseState = (history, more = {}) => ({ levels, profile, treadmill: { hasIncline: false }, progression: {}, plan: { startDate: '2026-07-06', overrides: {} }, schedule: { days: { 1: 30, 2: 0, 3: 30, 4: 0, 5: 45, 6: 0, 7: 0 } }, history, ...more });

// Medidas sueltas
const a1 = withHr('2026-11-02', 0);
ok(speedAdherence(a1, SEGS)?.pct === 100, 'clase clavada: 100 % de velocidad');
const slow = ses('2026-11-02', { speedTrace: trace(-1) });
ok(speedAdherence(slow, SEGS)?.belowPct === 100, 'todo por debajo');
ok(speedAdherence(ses('2026-11-02', { speedTrace: trace(-0.4) }), SEGS)?.pct === 100, 'los retoques de la app no cuentan como desviarse');
ok(speedAdherence(ses('2026-11-02', { speedTrace: [] }), SEGS) === null, 'sin traza no hay medida');
const exH = executionOf(a1, SEGS, profile);
ok(exH.zone && exH.score >= 0 && exH.score <= 100, `nota con pulso: ${exH.score}`);
const exN = executionOf(ses('2026-11-02'), SEGS, profile);
ok(exN.zone === null && exN.score >= 90, `nota sin pulso: ${exN.score}`);
ok(executionOf(ses('2026-11-02', { speedTrace: [] }), SEGS, profile).score === null, 'sin pulso ni traza no hay nota');
ok(executionOf(ses('2026-11-02', { completionPct: 0.4 }), SEGS, profile).label === 'A medias', 'una clase a medias no sale «Clavada»');
const rec = hrRecovery(a1, SEGS);
ok(rec && rec.n >= 1 && rec.drop > 15, `recuperación medida: ${rec?.drop}`);
ok(hrDrift(ses('2026-11-02', { hrSeries: hrFor(0, 12) }), SEGS) >= 5, 'deriva detectada');
ok(Math.abs(hrDrift(a1, SEGS)) <= 2, 'sin deriva');
ok(hrDrift(ses('2026-11-02', { elapsedSec: 600, hrSeries: hrFor(0) }), SEGS) === null, 'clase corta: sin deriva');
ok(sessionLoad(a1) > 0 && sessionLoad({}) === 0, 'carga');

// Comparar solo con clases ANTERIORES
const past = withHr('2026-10-20', 6, { avgSpeed: 7.8, rpe: 7 });
const cur = withHr('2026-11-02', 0, { avgSpeed: 8.1, rpe: 5 });
const later = withHr('2026-11-08', 20, { avgSpeed: 7, rpe: 9 });
const cmp = compareWithPast(cur, [past, cur, later]);
ok(cmp?.mode === 'same' && cmp.rows.length === 3 && cmp.line.tone === 'good', 'más rápido y con menos pulso');
ok(cmp.rows[0].from === compareWithPast(cur, [past, cur]).rows[0].from, 'una clase posterior no cambia la comparación');
ok(compareWithPast(ses('2026-11-02', { completionPct: 0.5 }), [past]) === null, 'clase a medias: no se compara');
ok(compareWithPast(cur, []) === null, 'primera clase: sin comparación');
const sim = compareWithPast(ses('2026-11-02', { templateId: 'otra', avgSpeed: 8 }), [past]);
ok(sim?.mode === 'similar', 'misma categoría: parecidas');

// Clase completa, con y sin datos
const stNo = baseState([ses('2026-11-02')]);
for (const s of [stNo.history[0], ses(today, { completionPct: 0.3 }), ses(today, { timeInZone: null, speedTrace: null, adjustments: null, hrSeries: 'x', category: null })]) {
  const a = classAnalysis(s, { state: baseState([s]), segments: SEGS });
  ok(a && a.checks.length >= 1 && typeof a.headline === 'string', 'clase sin datos: no se rompe');
}
ok(classAnalysis({ ...ses(today), isTest: true }, { state: stNo }) === null, 'el test tiene su tarjeta');
ok(classAnalysis(null, {}) === null, 'sin sesión');
const easyHot = classAnalysis(withHr('2026-11-02', 24, { category: 'recovery' }), { state: baseState([]), segments: SEGS });
ok(easyHot.goal.met === false, 'día suave a pulso alto: objetivo no cumplido');

// Sin datos del dueño en ningún texto
const blob = (o) => JSON.stringify(o);

// Balance
ok(trainingReview(baseState([]), now) === null, 'sin clases no hay balance');
const one = trainingReview(baseState([ses('2026-11-06')]), now);
ok(one.verdict.tone === 'start' && one.actions.length === 0, 'una clase: arranque');
ok(one.pillars.find((p) => p.key === 'load').status === 'learning', 'carga aún aprendiendo');
const idle = trainingReview(baseState([ses('2026-09-01'), ses('2026-09-03'), ses('2026-09-05')]), now);
ok(idle.verdict.tone === 'back', 'parado: toca volver');

// Doce semanas mejorando, con un bache de resfriado
const mon0 = mondayOf(today);
// Una clase real del plan: la nota se calcula con los tramos que reconstruye la app a partir de workoutId
let real = null;
for (let i = 0; i < 90 && !real; i++) {
  const w = planDay(baseState([]), addDays('2026-11-09', i))?.workout;
  if (w && w.totalSec >= 2400 && w.segments.some((g) => g.zone === 'jog' && g.sec >= 400)) real = w;
}
ok(!!real, 'hay una clase real con la que probar');
const realSec = real.segments.reduce((a, g) => a + g.sec, 0);
const realTiz = {}; for (const g of real.segments) realTiz[g.zone] = (realTiz[g.zone] || 0) + g.sec;
const hist = [];
for (let w = 11; w >= 0; w--) {
  const m = addDays(mon0, -7 * w);
  const bad = w === 4;
  for (const d of (w === 0 ? [0] : [0, 2, 4])) {
    const base = (w * 1.2) + (bad ? 12 : 0);
    hist.push(withHr(addDays(m, d), base, { workoutId: real.id, templateId: real.templateId, title: real.title, category: real.category, plannedSec: realSec, elapsedSec: realSec, timeInZone: realTiz, speedTrace: trace(0, real.segments), hrSeries: hrFor(base, 0, real.segments), feeling: bad ? 'hard' : 'ok', rpe: bad ? 7 : 5, notes: bad && d === 2 ? 'Con resfriado, fatal' : '', levelsAtStart: levels, runMark: 0 }));
  }
}
const st = baseState(hist, { levelHistory: [{ date: addDays(mon0, -77), levels: { ...levels, run: 9.6, jog: 7.7, fast: 11.1, sprint: 12.6 } }, { date: addDays(mon0, -7), levels }] });
const r = trainingReview(st, now);
ok(r.pillars.length === 5 && r.actions.length >= 1 && r.actions.length <= 3, 'cinco claves y hasta tres prioridades');
ok(r.pillars[0].status === 'good' && r.pillars[0].ppm < 0, `forma mejorando (${r.pillars[0].ppm} ppm)`);
ok(r.pillars[1].status === 'good', 'constancia cumplida con la semana del usuario');
ok(r.verdict.tone === 'good', `veredicto: ${r.verdict.title}`);
ok(r.trend.points.length === 12, 'nota de las últimas clases');
const e = r.evolution;
ok(e.hasHr && e.refSpeed > 0, 'hay referencia de velocidad');
ok(e.weeks.length === 12 && e.weeks.every((w) => w.state), 'una fila por semana');
const slumpW = e.weeks[e.weeks.length - 5];
ok(slumpW.state === 'weak' && slumpW.tag === 'cold', 'semana floja y causa leída de las notas');
ok(e.slump?.monday === slumpW.monday && e.slump.back, 'último bache, ya recuperado');
ok(e.weeks[e.weeks.length - 4].state !== 'weak', 'tras el bache, el bache no se convierte en lo normal');
ok(e.compare?.tone === 'good', 'mejor que al empezar');
ok(e.best && e.weeks.some((w) => w.monday === e.best.monday), 'mejor momento');

// Lo marca el usuario
const tagged = evolution({ ...st, ui: { weekTags: { [e.weeks[3].monday]: 'tired' } } }, e.weeks.flatMap((w) => w.classes.map((c) => ({ s: hist.find((h) => h.id === c.id), ex: { score: c.score } }))), now);
ok(tagged.weeks[3].tag === 'tired' && tagged.weeks[3].tagManual, 'causa marcada a mano');
ok(Object.keys(WEEK_TAGS).length === 6, 'causas disponibles');

// Semana sin correr en medio y semana en curso
const gap = hist.filter((s) => s.dayKey < addDays(mon0, -21) || s.dayKey >= addDays(mon0, -14));
const eg = trainingReview(baseState(gap), now).evolution;
ok(eg.weeks.some((w) => w.state === 'off'), 'semana sin correr');
ok(eg.weeks[eg.weeks.length - 1].inProgress, 'la última está en curso');

// Tests y clases basura no cuentan
const noise = [...hist, { id: 'x', isTest: true, test: { vam: 12 }, elapsedSec: 700, dayKey: today, startedAt: `${today}T07:00:00.000Z` }, { id: 'y', elapsedSec: 20, dayKey: today, startedAt: `${today}T07:30:00.000Z`, completionPct: 0.01 }, null, 'basura'];
ok(trainingReview(baseState(noise), now).count === hist.length, 'tests y arranques cortos fuera');

// Semanas de tres, siete y un día: la constancia se mide contra la semana de cada uno
for (const days of [{ 1: 30, 3: 30, 5: 30 }, { 1: 20, 2: 20, 3: 20, 4: 20, 5: 20, 6: 20, 7: 20 }, { 7: 45 }]) {
  const rr = trainingReview({ ...st, schedule: { days } }, now);
  const c = rr.pillars[1];
  ok(c.pct > 0 && c.pct <= 100 && blob(rr).indexOf('undefined') < 0 && blob(rr).indexOf('NaN') < 0, `semana ${Object.keys(days).length} días`);
}

// Quien empieza un sábado no ha «perdido» los días de antes, y una sola semana no se juzga
const fresh = trainingReview(baseState([ses('2026-11-07')], { schedule: { days: { 1: 30, 3: 30, 5: 45, 6: 60 } } }), now).pillars[1];
ok(fresh.value === '1 de 1' && fresh.status === 'good', `primer sábado: ${fresh.value}`);
ok(/tu última semana/.test(fresh.body), 'texto en singular');
const miss = trainingReview(baseState([ses('2026-11-02')], { schedule: { days: { 1: 30, 3: 30, 5: 45, 6: 60 } } }), now).pillars[1];
ok(miss.status === 'neutral', 'una sola semana floja aún no es un aviso');

console.log(fails ? `✗ test-analysis: ${fails} de ${n} fallan` : `✓ test-analysis: ${n} comprobaciones`);
process.exit(fails ? 1 : 0);
