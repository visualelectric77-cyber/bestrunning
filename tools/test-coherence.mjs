#!/usr/bin/env node
// RITMUP · que un mismo dato cuente igual en todas partes (auditoría del 8 nov). node tools/test-coherence.mjs
import { weekKeyOf, kcalOf, weekProgress } from '../js/training/stats.js';
import { loadBalance, sessionHrAt } from '../js/training/health-analysis.js';
import { buildHrModel, sessionHrOffset, isHills } from '../js/training/hr-model.js';
import { applyFeedback } from '../js/training/progression.js';
import { defaultState } from '../js/core/store.js';
import { readFileSync } from 'node:fs';
import { levelReference, levelReferenceLabel } from '../js/training/levels.js';
import { weeklyAverage, evolution } from '../js/training/evolution.js';
import { trainingReview } from '../js/training/training-review.js';
import { summaryAiInput } from '../js/training/class-debrief.js';

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

// «Tus velocidades»: el rótulo del periodo dice lo que se compara de verdad
{
  const A = { jog: 8, run: 9.6, fast: 11, sprint: 12.4 };
  const B = { ...A, jog: 8.2 };
  const C = { ...A, jog: 8.4 };
  ok(levelReference([], '2026-11-09') === null && levelReferenceLabel(null) === '', 'sin historial de velocidades: ni referencia ni rótulo');
  const young = levelReference([{ date: '2026-10-26', levels: A }, { date: '2026-11-04', levels: B }], '2026-11-09');
  ok(young.full === false && young.days === 14 && young.levels === A, 'historial de 2 semanas: la referencia es el primer registro y se sabe que tiene 14 días');
  ok(!/4 semanas/.test(levelReferenceLabel(young)) && levelReferenceLabel(young) === 'desde el 26 oct', `sin dato de hace 4 semanas no se dice «4 semanas» (${levelReferenceLabel(young)})`);
  const old = levelReference([{ date: '2026-09-01', levels: A }, { date: '2026-10-05', levels: B }, { date: '2026-11-04', levels: C }], '2026-11-09');
  ok(old.full && old.levels === B && levelReferenceLabel(old) === 'vs. hace 4 semanas', 'con dato de hace 4 semanas: las velocidades de entonces (no las primeras) y lo dice');
  ok(levelReferenceLabel(levelReference([{ date: '2026-11-09', levels: A }], '2026-11-09')) === 'desde hoy', 'primer registro de hoy: «desde hoy»');
}

// «km/semana»: media de semanas completas desde que empezaste; la semana en curso no entra
{
  const mk = (kms) => kms.map((km, i) => ({ monday: `w${String(i).padStart(2, '0')}`, km, sec: km * 360 }));
  const km = (b) => b.km;
  const two = weeklyAverage(mk([0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 8, 3]), null, km);
  ok(two.avg === 10 && two.weeks === 2 && two.prevAvg === null && two.current === 3, `2 semanas completas: media de esas 2, sin la que está en curso ni las de antes de empezar (${two.avg})`);
  const first = weeklyAverage(mk([0, 0, 0, 5]), null, km);
  ok(first.avg === null && first.weeks === 0 && first.current === 5, 'primera semana: no hay media, solo lo que llevas');
  const gap = weeklyAverage(mk([10, 0, 0, 10, 10, 0, 10, 10, 10, 10, 10, 2]), null, km);
  ok(gap.weeks === 4 && gap.avg === 10 && gap.prevWeeks === 4 && gap.prevAvg === 7.5, 'las semanas sin correr después de empezar sí cuentan como cero');
  const veteran = weeklyAverage(mk([0, 0, 8, 0, 4]), 'a-antes-de-la-ventana', km);
  ok(veteran.weeks === 4 && veteran.avg === 2, 'si empezaste antes de la ventana, sus semanas a cero también cuentan');
}

// «Kilómetros por semana» de «Al empezar y ahora»: semanas de calendario, no solo las que corriste
{
  const now = new Date('2026-11-09T12:00:00');
  const items = [];
  [[56, 10], [35, 10], [28, 10], [21, 10], [14, 10], [7, 10]].forEach(([ago, kmW], i) => {
    const d = new Date(now); d.setDate(d.getDate() - ago);
    const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    items.push({ s: { id: `e${i}`, dayKey, startedAt: `${dayKey}T08:00:00`, elapsedSec: 3600, distanceKm: kmW, avgSpeed: 10, completionPct: 1, completed: true }, ex: { score: 80 } });
  });
  const row = evolution(defaultState(), items, now)?.compare?.rows.find((r) => r.label === 'Kilómetros por semana');
  ok(row && row.from === '3,3' && row.to === '10,0', `al empezar: 1 semana corrida de 3 → 3,3 km/semana, no 10 (${row?.from} → ${row?.to})`);
}

// Clave «Forma»: «en un mes» solo con velocidades de hace un mes
{
  const st = defaultState();
  const now = new Date('2026-11-09T12:00:00');
  st.levels = { jog: 8.4, run: 10.3, fast: 11.7, sprint: 13.2 };
  st.plan = { ...st.plan, startDate: '2026-10-26' };
  st.history = ['2026-10-27', '2026-10-30', '2026-11-03', '2026-11-06'].map((dayKey, i) => ({ id: `f${i}`, dayKey, startedAt: `${dayKey}T08:00:00`, elapsedSec: 1500, distanceKm: 3.6, avgSpeed: 8.6, completionPct: 1, completed: true, feeling: 'ok', rpe: 5 }));
  const from = { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13 };
  const form = (levelHistory) => trainingReview({ ...st, levelHistory }, now)?.pillars[0];
  const young = form([{ date: '2026-10-26', levels: from }]);
  ok(young && /en 2 semanas/.test(young.body) && !/un mes/.test(young.body), `velocidades de hace 2 semanas: lo dice así (${young?.body})`);
  const old = form([{ date: '2026-10-05', levels: from }]);
  ok(old && /en un mes/.test(old.body), `velocidades de hace un mes o más: «en un mes» (${old?.body})`);
}

// Resumen con IA (sin pulso): los datos y el consejo dependen de la clase
{
  const base = { title: 'Pirámide', category: 'intervals', elapsedSec: 1200, plannedSec: 1200, distanceKm: 3.1, avgSpeed: 9.3, maxSpeed: 12.4, completionPct: 1, completed: true, feeling: 'ok', rpe: 5 };
  const cases = {
    plan: summaryAiInput(base, { feel: 'Cómodo' }),
    suave: summaryAiInput({ ...base, category: 'recovery', title: 'Rodaje suave' }, { feel: 'Cómodo' }),
    facil: summaryAiInput({ ...base, feeling: 'easy', rpe: 3 }, { feel: 'Muy fácil' }),
    subio: summaryAiInput({ ...base, adjustments: { run: 0.3 } }, { feel: 'Cómodo' }),
    bajo: summaryAiInput({ ...base, feeling: 'hard', rpe: 7, adjustments: { fast: -0.4 } }, { feel: 'Exigente' }),
    medias: summaryAiInput({ ...base, completionPct: 0.6, completed: false, finishedEarly: true, elapsedSec: 720, feeling: 'fail', rpe: 10 }, { feel: 'No pude' }),
  };
  const tips = Object.values(cases).map((c) => c.input.tipAbout);
  ok(new Set(tips).size === tips.length, 'cada clase distinta pide un consejo distinto');
  ok(tips.every((t) => t && !/\d/.test(t)), 'la pista del consejo no trae cifras que la IA pueda copiar');
  ok(cases.plan.input.type && cases.plan.input.type !== cases.suave.input.type && cases.plan.input.speedAsPlanned === true, 'lleva el tipo de clase y que no tocó la velocidad');
  ok(cases.subio.input.raisedKmh === 0.3 && cases.bajo.input.loweredKmh === 0.4 && !cases.subio.input.speedAsPlanned, 'lleva los ajustes de velocidad');
  ok(cases.medias.input.finished === false && cases.medias.input.completedPct === 60 && cases.medias.input.plannedMinutes === 20 && cases.plan.input.finished === true, 'lleva cómo se completó');
  ok(cases.bajo.input.feel === 'Exigente' && cases.bajo.input.effort === 7, 'lleva la sensación y el esfuerzo');
  const numbers = (v) => (typeof v === 'number' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(numbers) : []);
  ok(Object.values(cases).every((c) => numbers(c.input).every((v) => c.allowed.includes(v))), 'toda cifra que se le pasa está entre las permitidas');
}

// Rótulos que decían una cosa y medían otra: que no vuelvan
{
  const src = (f) => readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
  ok(!/Recuperación · hoy/.test(src('screens/health.js')), 'Salud: la recuperación es de los últimos 7 días, no «hoy»');
  ok(!/vs\. hace 4 semanas/.test(src('screens/today.js')) && !/vs\. hace 4 semanas/.test(src('screens/progress.js')), 'el periodo de «Tus velocidades» no va escrito a mano');
  ok(!/[Vv]elocidad real<|Plan vs real|>Real\$/.test(src('screens/summary.js') + src('screens/history.js')), 'la velocidad que indicó la app no se llama «real»');
}

// «Sesiones»: una sola regla (planner.countsAsSession) en totales, semanas, logros, informe y textos
{
  const { countsAsSession } = await import('../js/training/planner.js');
  const S = await import('../js/training/stats.js');
  const { evaluateAchievements } = await import('../js/training/achievements.js');
  const { weekReportInput } = await import('../js/training/week-report.js');
  const read = (f) => readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
  const ses = (id, dayKey, min, pct, extra = {}) => ({ id, dayKey, startedAt: `${dayKey}T18:00:00`, elapsedSec: min * 60, distanceKm: Math.round(min * 1.6) / 10, kcal: min * 10, completionPct: pct, completed: pct >= 0.9, plannedSec: 1800, finishedEarly: pct < 0.99, templateId: 'aerobic-base', category: 'aerobic', ...extra });
  const history = [
    ses('ok1', '2026-11-02', 30, 1),
    ses('ok2', '2026-11-03', 20, 0.65),                              // ≥ 60 %
    ses('ok3', '2026-11-04', 12, 0.45),                              // ≥ 10 min y ≥ 40 %
    ses('ok4', '2026-11-05', 6, 0.3, { finishedEarly: false }),      // llegó a su final con ≥ 5 min
    ses('ok5', '2026-11-06', 14, 1, { isTest: true, test: { vam: 13.2 } }),
    ses('no1', '2026-11-04', 3, 0.1),                                // empezada: antes contaba en Progreso (≥ 60 s) y no en los logros
    ses('no2', '2026-11-05', 0.5, 0.02),
    ses('no3', '2026-11-07', 4, 0.3, { isTest: true, test: { vam: 0 } }),
  ];
  const expected = history.filter(countsAsSession).length;
  const tally = S.sessionTally(history);
  const tot = S.totals(history);
  const buckets = S.weeklyBuckets(history, 4, '2026-11-08');
  ok(expected === 5, `la historia de prueba tiene 5 sesiones que cuentan (dio ${expected})`);
  ok(history.filter(S.sessionCounts).length === expected, 'stats.sessionCounts es la regla del planificador');
  ok(tally.sessions === expected && tally.started === history.length - expected, 'sessionTally: sesiones y empezadas');
  ok(tot.sessions === expected, `totals().sessions cuenta lo mismo (dio ${tot.sessions})`);
  ok(buckets.reduce((a, b) => a + b.sessions, 0) === expected, 'weeklyBuckets cuenta lo mismo');
  ok(S.sessionsText(history) === '5 sesiones · 3 empezadas' && S.sessionsText(history.slice(0, 1)) === '1 sesión' && S.sessionsText([]) === '0 sesiones' && S.sessionsText([history[5]]) === '1 empezada', 'el texto de sesiones dice también las empezadas');
  // Km, minutos y kcal suman todo lo corrido, cuente o no la clase
  ok(Math.abs(tot.km - history.reduce((a, s) => a + s.distanceKm, 0)) < 0.011 && tot.sec === history.reduce((a, s) => a + s.elapsedSec, 0) && tot.kcal === history.reduce((a, s) => a + s.kcal, 0), 'km, tiempo y kcal suman también las empezadas');
  // Logros: el de 5 sesiones sale con esta historia y deja de salir si una de las que cuentan se queda en «empezada»
  const st = { ...defaultState(), history };
  const ids = (state) => new Set(evaluateAchievements(state).map((a) => a.id));
  ok(ids(st).has('sessions-5') === (tot.sessions >= 5) && ids(st).has('first-run'), 'logros: mismas sesiones que Progreso');
  const fewer = { ...st, history: history.map((s) => (s.id === 'ok2' ? { ...s, completionPct: 0.2, elapsedSec: 240 } : s)) };
  ok(S.totals(fewer.history).sessions === 4 && !ids(fewer).has('sessions-5'), 'una sesión menos: baja en los dos sitios a la vez');
  // Informe semanal: nunca más sesiones que las que cuentan; una clase apenas empezada no hace informe
  const wr = weekReportInput(st, new Date('2026-11-08T12:00:00'));
  ok(wr && wr.input.sessions <= expected && wr.input.sessions >= 1, `informe semanal: sesiones que cuentan (dio ${wr?.input.sessions})`);
  ok(weekReportInput({ ...st, history: [history[5]] }, new Date('2026-11-08T12:00:00')) === null, 'informe semanal: solo una empezada, sin informe');
  // «Completada» (el ✓): una sola definición, más exigente que «cuenta»
  ok(S.sessionCompleted(history[0]) && !S.sessionCompleted(history[1]) && S.sessionCompleted({ completionPct: 0.92 }) && !S.sessionCompleted(null), 'completada: la marca del motor o ≥ 90 %');
  // Nadie vuelve a contar «sesiones» por su cuenta
  const logic = read('training/stats.js') + read('training/achievements.js') + read('training/week-report.js');
  ok(!/elapsedSec\)?\s*>=\s*60\b/.test(logic), 'ningún recuento con «≥ 60 s»');
  const screens = ['progress', 'history', 'settings', 'today', 'summary', 'onboarding'].map((f) => read(`screens/${f}.js`)).join('\n');
  ok(!/\.length\s*===\s*1\s*\?\s*'[Ss]esión'/.test(screens) && !/sessions\s*\|\|\s*history\.length/.test(screens), 'ninguna pantalla rotula «sesiones» el tamaño del historial');
}

// VAM y VO₂máx: una sola cifra con su origen (levels.vamNow), también cuando el test topa las velocidades
{
  const L = await import('../js/training/levels.js');
  const { evaluateTest, testLevelsText } = await import('../js/training/progression.js');
  const { predictedFor, goalStatus } = await import('../js/training/goal.js');
  const { predictRaces } = await import('../js/training/race-predict.js');
  const read = (f) => readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
  const base = () => {
    const st = defaultState();
    st.levels = { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13 };
    st.progression = { ...st.progression, lastBump: {}, okStreak: {}, lastTest: null, bestVam: null };
    return st;
  };
  const testOf = (stage, st) => ({ id: `t${stage}`, isTest: true, dayKey: '2026-11-08', elapsedSec: 900, completionPct: 1, completed: true, levelsAtStart: { ...st.levels }, test: { lastStageSpeed: stage, secondsInLastStage: 0 } });
  const after = (st, fb) => ({ ...st, levels: fb.levels, progression: fb.progression });

  // Sin test: la de tus velocidades, y se dice
  const st0 = base();
  const v0 = L.vamNow(st0);
  ok(v0.source === 'levels' && v0.vam === L.vamFromLevels(st0.levels) && v0.testVam === 0 && L.vamSourceLabel(v0) === 'Estimada por tus velocidades' && L.vamGapNote(v0) === '', 'sin test: VAM estimada por tus velocidades');

  // Test sin tope: VAM del test y velocidades a la par
  const fbA = applyFeedback(st0, testOf(13.5, st0), { feeling: 'hard', rpe: 8 });
  const vA = L.vamNow(after(st0, fbA));
  ok(evaluateTest(testOf(13.5, st0), st0).capped === null && vA.source === 'test' && vA.vam === 13.5 && vA.behind === 0 && L.vamGapNote(vA) === '', `test sin tope: una VAM, la del test (dio ${vA.vam}, ${vA.source})`);
  ok(/Hemos recalculado/.test(fbA.message), 'test sin tope: «hemos recalculado»');

  // Test con tope de subida: las velocidades se quedan por debajo, pero la VAM y el VO₂ son los del test en todas partes
  const tB = testOf(15, st0);
  const resB = evaluateTest(tB, st0);
  const fbB = applyFeedback(st0, tB, { feeling: 'hard', rpe: 8 });
  const stB = after(st0, fbB);
  const vB = L.vamNow(stB);
  ok(resB.capped === 'rise' && L.vamFromLevels(fbB.levels) < 15 - L.VAM_TOL, 'el test topa la subida de las velocidades');
  ok(vB.source === 'test' && vB.vam === resB.vam && vB.vam === 15 && vB.vo2 === resB.vo2max && vB.vo2 === L.estimateVo2max(15), `con tope: VAM y VO₂ del test, los mismos del resumen (dio ${vB.vam} / ${vB.vo2})`);
  ok(vB.behind > 0 && vB.levelsVam === L.vamFromLevels(stB.levels) && L.vamSourceLabel(vB) === 'Medida en tu test del 8 nov' && /por debajo/.test(L.vamGapNote(vB)), 'con tope: el origen y la diferencia se dicen con palabras');
  ok(!/Hemos recalculado/.test(fbB.message) && /como mucho/.test(fbB.message) && /como mucho/.test(testLevelsText(resB)) && /^Al guardar/.test(testLevelsText(resB)), 'con tope: el mensaje no dice que las velocidades ya son las del test');
  ok(fbB.progression.lastTest.vam === 15, 'lo que queda guardado es lo que midió el test');
  // Marcas y objetivo: con la misma VAM que enseña Progreso
  stB.plan = { ...stB.plan, goal: { distance: '10k', date: '2026-12-20', targetSec: null, setOn: '2026-11-08', where: 'calle' } };
  const gs = goalStatus(stB, '2026-11-09');
  const ten = predictRaces(vB.vam).find((r) => r.key === '10k');
  ok(gs?.predicted?.vam === vB.vam && gs.predicted.fastSec === ten.fastSec && predictedFor('10k', stB.levels, vB.vam).slowSec === ten.slowSec, 'previsión del objetivo = marcas estimadas de Progreso');
  // El siguiente test se compara con el anterior, y se dice con qué
  ok(evaluateTest(testOf(15.5, stB), stB).deltaFrom === 'test' && evaluateTest(tB, st0).deltaFrom === 'levels', 'la diferencia del test dice con qué se compara');

  // Cuando tus velocidades superan lo que midió el test, mandan ellas (y se dice)
  const stC = { ...stB, levels: { jog: 10.2, run: 12.4, fast: 14.1, sprint: 16 } };
  const vC = L.vamNow(stC);
  ok(vC.source === 'levels' && vC.vam === L.vamFromLevels(stC.levels) && vC.vam > 15 && L.vamSourceLabel(vC) === 'Según tus velocidades actuales' && /15,0 km\/h/.test(L.vamGapNote(vC)), 'velocidades por encima del test: mandan ellas y se nombra el test');

  // Test con tope de bajada: las velocidades bajan poco y siguen por encima de lo medido
  const tD = testOf(11, st0);
  const fbD = applyFeedback(st0, tD, { feeling: 'hard', rpe: 8 });
  const vD = L.vamNow(after(st0, fbD));
  ok(evaluateTest(tD, st0).capped === 'drop' && vD.source === 'levels' && vD.vam === L.vamFromLevels(fbD.levels) && /11,0 km\/h/.test(L.vamGapNote(vD)) && /como mucho/.test(fbD.message), 'tope de bajada: una VAM (la de tus velocidades) y el test, nombrado');

  // Cada cifra de VAM de las pantallas sale de vamNow: nadie recalcula el VO₂ ni el coach tira de otra VAM
  const coach = read('training/progression.js');
  const insight = coach.slice(coach.indexOf('export function coachInsight'), coach.indexOf('function hrTrendInsight'));
  ok(insight.length > 500 && /vamNow\(/.test(insight) && !/bestVam/.test(insight), 'el coach habla de la misma VAM que las pantallas');
  ok(/vamNow\(/.test(read('screens/progress.js')) && /vamNow\(/.test(read('screens/settings.js')) && /vamNow\(/.test(read('screens/plan.js')) && /vamNow\(/.test(read('training/goal.js')), 'Progreso, Perfil, Plan y objetivo usan vamNow');
  ok(!/VAM actual|VAM estimada<|último test \$\{/.test(read('screens/progress.js') + read('screens/settings.js')), 'sin rótulos de VAM con dos orígenes mezclados');
}

console.log(bad ? `✗ ${n - bad} OK, ${bad} fallos` : `✓ coherencia: ${n} comprobaciones`);
process.exit(bad ? 1 : 0);
