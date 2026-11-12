// RITMUP · tests de la fase 3 de la auditoría del algoritmo (12 nov 2026): el plan con el entreno exigente y la sesión
// a ritmo objetivo. Uso: node tools/test-fase3.mjs   (sale con código ≠ 0 si algo falla)
import { planWeek, setPlannerToday } from '../js/training/planner.js';
import { setGoal } from '../js/training/goal.js';
import { paceSeed, parsePaceSeed, paceStage, PACE_ID, PACE_PLANS } from '../js/training/goal-pace.js';
import { buildWorkout, workoutFromId, parseWorkoutId } from '../js/training/generator.js';
import { getTemplate } from '../js/training/templates.js';
import { wantsEasierNext } from '../js/training/class-debrief.js';
import { raceSpeedFor } from '../js/training/race.js';
import { defaultState } from '../js/core/store.js';
import { addDays, deepClone } from '../js/core/utils.js';

let failures = 0;
let passes = 0;
function ok(cond, msg) {
  if (cond) { passes++; return; }
  failures++;
  if (failures <= 25) process.stderr.write(`  ✗ ${msg}\n`);
}
function section(name, fn) {
  process.stdout.write(`• ${name}\n`);
  try { fn(); } catch (err) { failures++; process.stderr.write(`  ✗ excepción: ${err?.stack || err}\n`); }
}

const START = '2026-10-12';
const TODAY = '2026-10-14';
const NOW = new Date(`${TODAY}T07:00:00`);
setPlannerToday(TODAY);
function person({ effort = null, goal = null, schedule = null } = {}) {
  const st = deepClone(defaultState());
  Object.assign(st, {
    onboarded: true, createdAt: `${START}T08:00:00.000Z`,
    profile: { ...st.profile, name: 'Prueba', age: 40, weightKg: 70, sex: 'm', hrMax: 180, hrRest: 60, effort },
    levels: { jog: 9, run: 10.5, fast: 11.8, sprint: 13.2 },
    schedule: schedule || { weekdayMinutes: 20, thursdayMinutes: 50, weekendDay: 6, weekendMinutes: 50, reminderTime: '07:00' },
    plan: { ...st.plan, startDate: START, overrides: {}, goal: null },
    treadmill: { hasIncline: true, maxIncline: 12, minSpeed: 1.0, maxSpeed: 18.0, announceLead: 10 },
  });
  if (goal) setGoal(st, goal, TODAY);
  return st;
}
const weekOf = (st, W) => planWeek(st, addDays(START, W * 7), NOW);
const EASY = ['jog', 'walk', 'warmup', 'cooldown'];
function stats(days) {
  let fast = 0; let run = 0; let easy = 0; let total = 0; let load = 0; let hard = 0;
  for (const d of days) {
    const w = d.workout;
    if (!w || d.kind === 'rest') continue;
    const z = w.timeInZone || {};
    fast += (z.fast || 0) + (z.sprint || 0); run += z.run || 0; total += w.totalSec; load += w.load || 0;
    easy += EASY.reduce((a, k) => a + (z[k] || 0), 0);
    if (d.role === 'hard') hard++;
  }
  return { fast, run, easy, total, load, hard, share: total ? easy / total : 1 };
}
const sig = (days) => days.map((d) => `${d.kind}|${d.templateId}|${d.minutes}|${d.workout?.id || ''}`).join('#');

section('La semilla de la sesión a ritmo objetivo', () => {
  ok(paceSeed('10k', 10.5, 2) === 201052 && paceSeed('5k', 11.3, 0) === 101130 && paceSeed('21k', 9.8, 3) === 400983, 'distancia · décimas · etapa');
  const p = parsePaceSeed(201052);
  ok(p && p.distance === '10k' && p.speed === 10.5 && p.stage === 2, 'se lee de vuelta');
  ok(parsePaceSeed(12345) === null && parsePaceSeed(987654321) === null && parsePaceSeed(null) === null && parsePaceSeed(600000) === null, 'una semilla cualquiera no es de ritmo objetivo');
  ok(paceSeed('3k', 10, 1) === null && paceSeed('10k', 30, 1) === null && paceSeed('10k', 3, 1) === null, 'distancias o velocidades imposibles: null');
  ok(paceStage(1, 6) === 0 && paceStage(6, 6) === 3 && paceStage(3, 6) === 1 && paceStage(1, 1) === 3 && paceStage(4, 4) === 3, 'la etapa crece con el bloque');
  let prev = -1;
  for (let i = 1; i <= 8; i++) { const s = paceStage(i, 8); ok(s >= prev && s >= 0 && s <= 3, `etapa ${i}/8 no retrocede (${s})`); prev = s; }
});

section('La clase a ritmo objetivo', () => {
  const lv = { jog: 9, run: 10.5, fast: 11.8, sprint: 13.2 };
  for (const dist of ['5k', '10k', '15k', '21k']) {
    let prevLongest = 0;
    let prevWork = 0;
    for (let stage = 0; stage <= 3; stage++) {
      const w = buildWorkout(PACE_ID, { minutes: 50, levels: lv, seed: paceSeed(dist, 11, stage) });
      const work = w.segments.filter((s) => s.rep);
      const [n, sec] = PACE_PLANS[dist][stage];
      ok(w.totalSec === 3000 && work.length >= 1 && work.length <= n, `${dist} etapa ${stage}: 50 min y hasta ${n} bloques (${work.length})`);
      ok(work.every((s) => s.speed === 11), `${dist} etapa ${stage}: todos los bloques a la velocidad objetivo`);
      const longest = Math.max(...work.map((s) => s.sec));
      const total = work.reduce((a, s) => a + s.sec, 0);
      ok(longest >= prevLongest && longest <= sec + 60, `${dist} etapa ${stage}: el bloque más largo no encoge (${longest} s)`);
      ok(stage === 0 || total >= prevWork * 0.9, `${dist} etapa ${stage}: el tiempo a ritmo no cae (${total} s)`);
      prevLongest = longest; prevWork = total;
      ok(w.segments[0].zone === 'warmup' && ['cooldown', 'walk'].includes(w.segments[w.segments.length - 1].zone), `${dist} etapa ${stage}: calienta y vuelve a la calma`);
    }
  }
  // la velocidad se acota entre «correr» − 0,3 y «rápido» + 0,2
  const slow = buildWorkout(PACE_ID, { minutes: 50, levels: lv, seed: paceSeed('21k', 8, 1) }).segments.filter((s) => s.rep);
  const quick = buildWorkout(PACE_ID, { minutes: 50, levels: lv, seed: paceSeed('5k', 14, 1) }).segments.filter((s) => s.rep);
  ok(slow.every((s) => s.speed === 10.2) && quick.every((s) => s.speed === 12), `objetivos fuera de tus niveles se acotan (${slow[0].speed} · ${quick[0].speed})`);
  // 30 min: cabe con menos bloques; semilla cualquiera: versión genérica
  const short = buildWorkout(PACE_ID, { minutes: 30, levels: lv, seed: paceSeed('10k', 11, 1) });
  ok(short.totalSec === 1800 && short.segments.some((s) => s.rep), '30 min: se ajusta');
  const generic = buildWorkout(PACE_ID, { minutes: 45, levels: lv, seed: 777 });
  ok(generic && generic.segments.filter((s) => s.rep).every((s) => s.speed > lv.run && s.speed < lv.fast), 'semilla cualquiera: ritmo genérico entre correr y rápido');
  // mismo id → misma clase (la sesión de hace un mes no cambia aunque cambie el objetivo)
  const a = buildWorkout(PACE_ID, { minutes: 50, levels: lv, seed: paceSeed('10k', 10.5, 2) });
  const b = workoutFromId(a.id, { levels: lv });
  ok(b && JSON.stringify(a.segments) === JSON.stringify(b.segments), 'la clase se reconstruye igual desde su id');
  ok(getTemplate(PACE_ID)?.planOnly === true, 'va marcada para que el plan no la sortee: solo la coloca en su día');
});

section('Plan normal: nada cambia', () => {
  const a = person();
  const b = person({ effort: 'hard' });
  const before = [0, 1, 2, 3, 4, 5].map((W) => sig(weekOf(a, W)));
  [0, 1, 2, 3].forEach((W) => weekOf(b, W));   // calcular el exigente por medio no contamina el normal
  const after = [0, 1, 2, 3, 4, 5].map((W) => sig(weekOf(person(), W)));
  ok(JSON.stringify(before) === JSON.stringify(after), 'el plan normal es el mismo antes y después de usar el exigente');
  let pace = 0;
  for (let W = 0; W < 16; W++) for (const d of weekOf(person({ goal: { distance: '10k', date: addDays(START, 10 * 7 + 6), targetSec: 3300, where: 'cinta' } }), W)) if (d.templateId === PACE_ID) pace++;
  ok(pace === 0, 'sin el entreno exigente no hay sesiones a ritmo objetivo');
});

section('Plan exigente: más calidad, con los mismos frenos', () => {
  const normal = person();
  const hard = person({ effort: 'hard' });
  let nFast = 0; let hFast = 0; let nLoad = 0; let hLoad = 0; let weeks = 0; let prevLoads = [];
  for (let W = 0; W < 26; W++) {
    const dn = weekOf(normal, W);
    const dh = weekOf(hard, W);
    const sn = stats(dn);
    const sh = stats(dh);
    const info = dh.find((d) => d.season)?.season || {};
    const deload = info.weekInMeso === 4;
    const test = !!info.isTestWeek;
    // nunca dos días duros seguidos (ni con el domingo anterior)
    for (let i = 1; i < dh.length; i++) ok(!(dh[i].role === 'hard' && dh[i - 1].role === 'hard') && !(dh[i].role === 'test' && dh[i - 1].role === 'hard'), `sem ${W}: sin dos duras seguidas (${dh[i - 1].date})`);
    ok(dh.every((d, i) => d.kind === dn[i].kind || d.kind === 'rest' === (dn[i].kind === 'rest')), `sem ${W}: mismos días de entreno y descanso`);
    ok(dh.reduce((a, d) => a + (d.minutes || 0), 0) === dn.reduce((a, d) => a + (d.minutes || 0), 0) || deload, `sem ${W}: los mismos minutos que su horario`);
    if (!deload && !test) {
      ok(sh.hard >= 2 && sh.hard <= 3, `sem ${W}: 2–3 sesiones duras (${sh.hard})`);
      ok(sh.share >= 0.58 && sh.share <= 0.83, `sem ${W}: tiempo suave en su franja (${(sh.share * 100).toFixed(0)} %)`);
      nFast += sn.fast + sn.run; hFast += sh.fast + sh.run; nLoad += sn.load; hLoad += sh.load; weeks++;
      const top = Math.max(0, ...prevLoads.slice(-3));
      if (top) ok(sh.load <= top * 1.13, `sem ${W}: la carga no salta más de un 13 % sobre la mejor reciente (${Math.round(sh.load)} frente a ${Math.round(top)})`);
      prevLoads.push(sh.load);
    } else if (deload) {
      const top = Math.max(0, ...prevLoads.slice(-3));
      if (top) ok(sh.load <= top * 0.75, `sem ${W}: la descarga sigue siendo descarga (${Math.round(sh.load)} frente a ${Math.round(top)})`);
      ok(sh.hard === 0, `sem ${W}: en descarga no hay sesiones duras`);
    }
    // la sesión dura corta es densa: al menos 5 min a ritmo de correr o más
    for (const d of dh) {
      if (d.role !== 'hard' || d.minutes > 25 || !d.workout) continue;
      const z = d.workout.timeInZone || {};
      ok((z.run || 0) + (z.fast || 0) + (z.sprint || 0) >= 300, `sem ${W}: la dura corta es densa (${d.workout.title}: ${Math.round(((z.run || 0) + (z.fast || 0) + (z.sprint || 0)) / 60)} min)`);
    }
  }
  ok(hFast / weeks >= (nFast / weeks) * 1.2, `más minutos a ritmo de correr o más: ${Math.round(hFast / weeks / 60)} frente a ${Math.round(nFast / weeks / 60)} por semana`);
  ok(hLoad / weeks >= (nLoad / weeks) * 1.04 && hLoad / weeks <= (nLoad / weeks) * 1.25, `más carga, sin disparate: ${Math.round(hLoad / weeks)} frente a ${Math.round(nLoad / weeks)}`);
  ok(sig(weekOf(hard, 5)) === sig(weekOf(person({ effort: 'hard' }), 5)), 'el plan exigente es determinista');
});

section('Bloque de carrera exigente: el día clave, a ritmo objetivo', () => {
  const goal = { distance: '10k', date: addDays(START, 10 * 7 + 6), targetSec: 3300, where: 'cinta' };
  const st = person({ effort: 'hard', goal });
  const v = raceSpeedFor('10k', { targetSec: 3300, levels: st.levels });
  const stages = [];
  let lightLong = 0;
  for (let W = 0; W < 12; W++) {
    const days = weekOf(st, W);
    for (const d of days) {
      if (d.templateId === PACE_ID) {
        const p = parsePaceSeed(parseWorkoutId(d.workout.id)?.seed);
        ok(d.weekday === 4 && d.role === 'hard' && d.minutes >= 30, `sem ${W}: cae en el día clave (jueves), duro`);
        ok(p && p.distance === '10k' && Math.abs(p.speed - v) < 1e-9, `sem ${W}: a la velocidad del objetivo (${p?.speed} = ${v})`);
        ok(/ritmo de 10K/.test(d.intro || '') && d.workout.segments.filter((s) => s.rep).every((s) => s.speed === Math.min(Math.max(v, st.levels.run - 0.3), st.levels.fast + 0.2)), `sem ${W}: bloques a ritmo objetivo y con su aviso`);
        stages.push(p.stage);
      }
      if (d.minutes >= 40 && d.workout && d.kind !== 'rest' && d.season?.weekInMeso !== 4 && d.workout.load / d.minutes < 0.85) lightLong++;
    }
  }
  ok(stages.length >= 3, `hay sesiones a ritmo objetivo en el bloque (${stages.length})`);
  ok(stages.every((s, i) => i === 0 || s >= stages[i - 1]) && stages[stages.length - 1] > stages[0], `y crecen de una semana a otra (${stages.join(' ')})`);
  ok(lightLong === 0, `ningún día largo de semana de carga es una clase ligera (${lightLong})`);
  // 5K
  const st5 = person({ effort: 'hard', goal: { distance: '5k', date: addDays(START, 7 * 7 + 6), targetSec: 1560, where: 'cinta' } });
  let n5 = 0;
  for (let W = 0; W < 9; W++) for (const d of weekOf(st5, W)) if (d.templateId === PACE_ID) { n5++; ok(parsePaceSeed(parseWorkoutId(d.workout.id)?.seed)?.distance === '5k', `5K sem ${W}: su propia sesión`); }
  ok(n5 >= 2, `también en el bloque de 5K (${n5})`);
});

section('Tras una clase exigente no se propone suavizar la siguiente', () => {
  const db = { kind: 'usual' };
  ok(wantsEasierNext(db, { feeling: 'hard' }) === true, 'modo normal: «exigente» sí lo propone (como siempre)');
  ok(wantsEasierNext(db, { feeling: 'hard' }, { pushy: true }) === false, 'entreno exigente: «exigente» es lo normal');
  ok(wantsEasierNext(db, { feeling: 'max' }, { pushy: true }) && wantsEasierNext(db, { feeling: 'fail' }, { pushy: true }), 'al límite o no pude: sí');
  ok(wantsEasierNext({ kind: 'high' }, { feeling: 'ok' }, { pushy: true }), 'día de pulso alto: sí');
  ok(!wantsEasierNext(null, { feeling: 'max' }) && !wantsEasierNext(db, { feeling: 'max', isTest: true }), 'sin resumen o en un test: no');
});

process.stdout.write(`\n${passes} comprobaciones OK, ${failures} fallos\n`);
process.exit(failures ? 1 : 0);
