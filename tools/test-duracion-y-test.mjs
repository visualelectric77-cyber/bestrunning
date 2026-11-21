// RITMUP · pruebas de dos cosas del 21 nov 2026:
//   1) Duración a mano: cualquier clase del plan se puede pedir de 5 en 5 min (js/training/duration-choices.js).
//   2) Test VAM sin techo: los escalones siguen hasta el tope de la cinta; ya no se acaba solo en «VAM esperada + 2».
// Uso: node tools/test-duracion-y-test.mjs   (sale con código ≠ 0 si algo falla)
import { durationChoices, setDayMinutes, LONG_FLOOR } from '../js/training/duration-choices.js';
import { TEMPLATES, getTemplate } from '../js/training/templates.js';
import { buildWorkout, summarizeSegments } from '../js/training/generator.js';
import { planDay, planWeek } from '../js/training/planner.js';
import { vamFromLevels } from '../js/training/levels.js';
import { createEngine, buildSession } from '../js/player/engine.js';
import { evaluateTest } from '../js/training/progression.js';
import { hashStr } from '../js/core/utils.js';

let failures = 0;
let passes = 0;
function ok(cond, msg) {
  if (cond) { passes++; return; }
  failures++;
  process.stderr.write(`  ✗ ${msg}\n`);
}
function section(name, fn) {
  process.stdout.write(`• ${name}\n`);
  try { fn(); } catch (err) { failures++; process.stderr.write(`  ✗ excepción: ${err?.stack || err}\n`); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const LEVELS = { jog: 8.5, run: 10, fast: 11.5, sprint: 13 };
const HARD = new Set(['run', 'fast', 'sprint']);

/* ───────────── 1) Duración a mano ───────────── */

section('Qué duraciones se ofrecen', () => {
  ok(same(durationChoices('long-mixed', 50), [30, 35, 40, 45, 50, 55, 60]), 'clase larga (45 y 60): de 30 a 60 de 5 en 5');
  ok(same(durationChoices('pyramid-xl', 45), [30, 35, 40, 45, 50, 55, 60]), 'pirámide XL: igual');
  ok(same(durationChoices('goal-pace', 50), [30, 35, 40, 45, 50, 55, 60]), 'ritmo de carrera: de 30 a 60');
  ok(same(durationChoices('minute-on', 20), [20, 25, 30, 35, 40, 45]), 'clase corta (20, 30 y 45): de 20 a 45');
  ok(same(durationChoices('light-legs', 20), [20, 25, 30]), 'clase de 20 y 30: 20, 25 y 30');
  ok(same(durationChoices('long-cruise', 52), [30, 35, 40, 45, 50, 52, 55, 60]), 'la duración actual siempre está');
  ok(durationChoices('test-vam', 20).length === 0, 'el test VAM no se toca');
  ok(durationChoices('the-hour', 60).length === 0 && durationChoices('challenge-10k', 60).length === 0, 'las de duración única, tampoco');
  ok(durationChoices('no-existe', 30).length === 0 && durationChoices(null).length === 0, 'plantilla desconocida: nada');
  ok(LONG_FLOOR === 30, 'una clase larga baja hasta 30 min');
  for (const t of TEMPLATES) {
    const ch = durationChoices(t.id, 0);
    if (!ch.length) continue;
    ok(t.durations.every((m) => ch.includes(m)), `${t.id}: están todas las suyas`);
    ok(ch.every((m, i) => i === 0 || m > ch[i - 1]) && Math.max(...ch) === Math.max(...t.durations), `${t.id}: ordenadas y sin pasar de su máximo`);
  }
});

section('Todas las clases salen bien con cualquier duración ofrecida', () => {
  let n = 0;
  for (const t of TEMPLATES) {
    for (const m of durationChoices(t.id, 0)) {
      for (const seed of [1, 7, 23]) {
        const w = buildWorkout(t.id, { minutes: m, levels: LEVELS, seed, hasIncline: true, treadmill: { hasIncline: true, maxSpeed: 18 } });
        n++;
        const tag = `${t.id} ${m}′ (semilla ${seed})`;
        if (!w) { ok(false, `${tag}: no se construye`); continue; }
        const tot = w.segments.reduce((a, s) => a + s.sec, 0);
        ok(tot === m * 60 && w.totalSec === m * 60, `${tag}: dura ${tot / 60} min`);
        ok(w.minutes === m, `${tag}: minutos`);
        ok(w.segments[0].zone === 'warmup', `${tag}: empieza calentando`);
        ok(['cooldown', 'walk'].includes(w.segments[w.segments.length - 1].zone), `${tag}: acaba en la vuelta a la calma`);
        ok(Math.min(...w.segments.map((s) => s.sec)) >= 15, `${tag}: sin tramos de menos de 15 s`);
      }
    }
  }
  ok(n > 2000, `se han construido ${n} clases`);
  // Acortar una larga no la deja sin trabajo: sigue teniendo su parte fuerte
  for (const id of ['long-mixed', 'long-cruise', 'long-fartlek', 'goal-pace', 'pyramid-xl', 'combo-double']) {
    const hard = (m) => buildWorkout(id, { minutes: m, levels: LEVELS, seed: 5 }).segments.filter((s) => HARD.has(s.zone)).reduce((a, s) => a + s.sec, 0);
    ok(hard(30) >= 300, `${id} a 30′: al menos 5 min de trabajo (${Math.round(hard(30) / 60)})`);
    ok(hard(30) <= 18 * 60, `${id} a 30′: el trabajo cabe con su calentamiento y su vuelta a la calma (${Math.round(hard(30) / 60)} min)`);
  }
});

/** Estado mínimo con jueves y sábado largos (como la semana de quien la inspiró, sin sus datos). */
function mkState(extra = {}) {
  return {
    version: 1, onboarded: true, createdAt: '2026-09-01T08:00:00.000Z',
    profile: { name: 'Prueba', weightKg: 75, effort: 'normal' },
    levels: { ...LEVELS }, levelHistory: [], progression: {},
    schedule: { weekdayMinutes: 20, thursdayMinutes: 50, weekendDay: 6, weekendMinutes: 50 },
    plan: { startDate: '2026-09-07', overrides: {} },
    treadmill: { hasIncline: false, maxIncline: 12, minSpeed: 1, maxSpeed: 18, announceLead: 10 },
    history: [], ...extra,
  };
}

section('Cambiar a mano los minutos de un día del plan', () => {
  const st = mkState();
  // un jueves largo que no sea de test
  let thu = null;
  for (let i = 0; i < 12 && !thu; i++) {
    const key = new Date(Date.UTC(2026, 9, 1 + i * 7)).toISOString().slice(0, 10); // jueves desde el 1 oct 2026
    const d = planDay(st, key);
    if (d.workout && !d.workout.isTest && d.minutes >= 45) thu = d;
  }
  ok(!!thu, 'hay un jueves largo en el plan');
  if (!thu) return;
  const before = planWeek(st, thu.date);
  for (const m of [30, 35, 40, 45, 55, 60]) {
    if (m === thu.minutes) continue;
    const draft = structuredClone(st);
    ok(setDayMinutes(draft, thu, m) === true, `${m}′: se aplica`);
    const d = planDay(draft, thu.date);
    ok(d.templateId === thu.templateId, `${m}′: sigue siendo la misma clase (${d.templateId})`);
    ok(d.minutes === m && d.workout.totalSec === m * 60, `${m}′: el plan da ${d.workout.totalSec / 60} min`);
    const [, , seedA, loadA] = thu.workout.id.split('~');
    ok(d.workout.id === `${thu.templateId}~${m}~${seedA}~${loadA}`, `${m}′: misma semilla y misma carga (${d.workout.id})`);
    ok(d.isOverride === true, `${m}′: el día queda como editado`);
  }
  // Volver a la duración del plan quita el cambio
  const draft = structuredClone(st);
  setDayMinutes(draft, thu, 35);
  setDayMinutes(draft, planDay(draft, thu.date), thu.minutes);
  ok(!draft.plan.overrides[thu.date], 'volver a la duración del plan deja el día como estaba');
  ok(same(planWeek(draft, thu.date).days?.map?.((d) => d.workout?.id) ?? null, before.days?.map?.((d) => d.workout?.id) ?? null), 'y la semana, igual que antes');
  // Entradas raras
  const d2 = structuredClone(st);
  ok(setDayMinutes(d2, thu, 0) === false && setDayMinutes(d2, null, 30) === false && setDayMinutes(d2, { date: thu.date }, 30) === false, 'sin minutos, sin día o sin clase: no hace nada');
  ok(!d2.plan.overrides[thu.date], 'y no deja rastro');
});

section('«Ritmo de carrera» conserva su velocidad objetivo al cambiar la duración', () => {
  // La velocidad objetivo va en la semilla del día: si el cambio no la llevase, saldría la versión genérica
  const st = mkState();
  const date = '2026-10-08';
  const paceSeed = parseInt('4b50', 36);
  const lf = planDay(st, date).workout.loadFactor;
  // lo que da planDay ese día: la clase con su semilla en el id
  const day = { date, templateId: 'goal-pace', minutes: 50, workout: buildWorkout('goal-pace', { minutes: 50, levels: st.levels, seed: paceSeed, loadFactor: lf }) };
  ok(day.workout.id.split('~')[2] === '4b50', 'la clase del día lleva la semilla de ritmo en su id');
  const draft = structuredClone(st);
  setDayMinutes(draft, day, 40);
  const ov = draft.plan.overrides[date];
  ok(ov && ov.templateId === 'goal-pace' && ov.minutes === 40 && ov.seed === paceSeed, 'el cambio guarda clase, minutos y semilla');
  const d = planDay(draft, date);
  ok(d.templateId === 'goal-pace' && d.minutes === 40 && d.workout.id.split('~')[2] === '4b50', 'el plan la resuelve con su semilla');
  const ref = buildWorkout('goal-pace', { minutes: 40, levels: st.levels, seed: paceSeed, loadFactor: lf, treadmill: st.treadmill, weightKg: 75 });
  ok(d.workout.id === ref.id, `misma clase que la construida con la semilla (${d.workout.id})`);
  const generic = buildWorkout('goal-pace', { minutes: 40, levels: st.levels, seed: hashStr(date), loadFactor: lf, treadmill: st.treadmill, weightKg: 75 });
  const workSpeed = (w) => Math.max(...w.segments.filter((s) => s.block === 'Ritmo de carrera').map((s) => s.speed));
  ok(workSpeed(d.workout) === workSpeed(ref), 'la velocidad de los bloques es la de la semilla');
  ok(d.workout.id !== generic.id, 'y no es la versión genérica');
});

/* ───────────── 2) Test VAM sin techo ───────────── */

const stagesOf = (w) => w.segments.filter((s) => Number(s.stage) > 0);

section('Test VAM: los escalones llegan al tope de la cinta', () => {
  for (const maxSpeed of [14, 16, 18, 20, 22]) {
    for (const minutes of [20, 30]) {
      const w = buildWorkout('test-vam', { minutes, levels: LEVELS, treadmill: { maxSpeed } });
      const st = stagesOf(w);
      const tag = `cinta ${maxSpeed}, ${minutes}′`;
      ok(w.isTest === true, `${tag}: es un test`);
      ok(st.every((s) => s.sec === 60), `${tag}: escalones de 1 min`);
      ok(st.every((s, i) => i === 0 || Math.abs(s.speed - st[i - 1].speed - 0.5) < 1e-9), `${tag}: suben 0,5 km/h`);
      ok(st.every((s, i) => s.stage === i + 1), `${tag}: numerados seguidos`);
      const last = st[st.length - 1].speed;
      ok(last <= maxSpeed + 1e-9 && last > maxSpeed - 0.5 - 1e-9, `${tag}: el último (${last}) es el más alto que admite la cinta`);
      ok(last > vamFromLevels(LEVELS) + 2 || maxSpeed <= vamFromLevels(LEVELS) + 2.5, `${tag}: pasa del techo antiguo (VAM esperada + 2)`);
      const i = w.segments.indexOf(st[st.length - 1]);
      ok(w.segments.slice(i + 1).every((s) => s.zone === 'cooldown') && w.segments.length - i - 1 === 2, `${tag}: después, la vuelta a la calma`);
      ok(w.segments.slice(0, w.segments.indexOf(st[0])).every((s) => s.speed < st[0].speed), `${tag}: el calentamiento va por debajo del primer escalón`);
    }
  }
  const a = buildWorkout('test-vam', { minutes: 20, levels: LEVELS, treadmill: { maxSpeed: 18 } });
  const b = buildWorkout('test-vam', { minutes: 30, levels: LEVELS, treadmill: { maxSpeed: 18 } });
  ok(same(stagesOf(a).map((s) => s.speed), stagesOf(b).map((s) => s.speed)), 'la versión de 20′ y la de 30′ tienen los mismos escalones: ninguna se corta antes');
});

section('Test VAM: lo previsto no se infla', () => {
  const w = buildWorkout('test-vam', { minutes: 20, levels: LEVELS, treadmill: { maxSpeed: 18 }, weightKg: 75 });
  const real = w.segments.reduce((a, s) => a + s.sec, 0);
  ok(w.maxSec === real, `maxSec es el máximo teórico (${real / 60} min)`);
  ok(w.minutes === 20, 'los minutos nominales siguen siendo 20');
  const top = Math.max(LEVELS.fast + 1, vamFromLevels(LEVELS) + 2);
  const expected = summarizeSegments(w.segments.filter((s) => !(s.stage > 0 && s.speed > top + 1e-9)), 75);
  ok(w.totalSec === expected.totalSec && w.totalSec < w.maxSec, `la duración prevista es hasta VAM + 2 (${w.totalSec / 60} min)`);
  ok(Object.values(w.timeInZone).reduce((a, b) => a + b, 0) === w.totalSec, 'el tiempo por zonas cuadra con la duración prevista');
  ok(w.estDistanceKm === expected.estDistanceKm && w.estKcal === expected.estKcal, `distancia y energía previstas hasta VAM + 2 (${w.estDistanceKm} km)`);
  ok(buildWorkout('long-mixed', { minutes: 50, levels: LEVELS }).maxSec === undefined, 'las clases normales no llevan maxSec');
  ok(w.load === expected.load && w.maxSpeed === expected.maxSpeed, 'carga y velocidad máxima previstas, también');
  const all = summarizeSegments(w.segments, 75);
  ok(w.estDistanceKm < all.estDistanceKm && w.maxSpeed < all.maxSpeed, 'y son menores que si se contasen todos los escalones');
});

function harness(workout) {
  const clock = { t: 1_000_000 };
  const events = [];
  const engine = createEngine(workout, {
    now: () => clock.t, autoTick: false, treadmill: { minSpeed: 1, maxSpeed: 18, hasIncline: false }, weightKg: 75,
    onEvent: (type, data) => events.push({ type, data }),
  });
  const advance = (sec) => { for (let left = sec; left > 0; left -= 5) { clock.t += Math.min(5, left) * 1000; engine.tick(); } };
  return { engine, events, advance };
}

section('Test VAM: quien aguanta más de lo previsto sigue subiendo', () => {
  const w = buildWorkout('test-vam', { minutes: 20, levels: LEVELS, treadmill: { maxSpeed: 18 } });
  const st = stagesOf(w);
  const startOf = (seg) => w.segments.slice(0, w.segments.indexOf(seg)).reduce((a, s) => a + s.sec, 0);
  const oldTop = Math.max(LEVELS.fast + 1, vamFromLevels(LEVELS) + 2);
  const oldLast = st.filter((s) => s.speed <= oldTop + 1e-9).pop();
  const next = st[st.indexOf(oldLast) + 1];
  ok(!!next, 'hay escalón después del que antes era el último');
  // Acaba entero el que antes era el último: el test sigue (antes pasaba solo a la vuelta a la calma)
  const h = harness(w);
  h.engine.start();
  h.advance(startOf(oldLast) + 60 + 20);
  let s = h.engine.getState();
  ok(s.inTestStage === true && s.segment.stage === next.stage && s.segment.speed === next.speed, `tras el escalón ${oldLast.stage} viene el ${next.stage} a ${next.speed}`);
  ok(!s.test && !h.events.some((e) => e.type === 'testEnd'), 'el test no se ha dado por terminado');
  // «No puedo más» a los 20 s de ese escalón
  ok(h.engine.endTest() === true, '«No puedo más» funciona en los escalones nuevos');
  s = h.engine.getState();
  ok(s.segment.zone === 'cooldown', 'salta a la vuelta a la calma');
  ok(s.test.lastStageSpeed === oldLast.speed && s.test.secondsInLastStage === 20, 'último escalón completo y segundos en el siguiente');
  ok(Math.abs(s.test.vam - (oldLast.speed + 0.5 * 20 / 60)) < 0.006, `VAM por encima del techo antiguo (${s.test.vam})`);
  h.advance(400);
  s = h.engine.getState();
  ok(s.status === 'finished', 'la clase termina tras la vuelta a la calma');
  const ses = buildSession(w, s, { levels: LEVELS, planDate: '2026-11-26' });
  ok(ses.isTest && ses.completed === true && ses.completionPct === 1, 'cuenta como test completado');
  const res = evaluateTest(ses, { levels: LEVELS, progression: {} });
  ok(Math.abs(res.vam - s.test.vam) <= 0.05 + 1e-9 && res.vam > oldLast.speed, `el resultado es esa VAM (${res.vam})`);

  // Y pasados los 20 minutos de clase sigue habiendo escalones
  const h2 = harness(w);
  h2.engine.start();
  h2.advance(21 * 60);
  s = h2.engine.getState();
  ok(s.inTestStage === true && s.status === 'running', `en el minuto 21 sigue en un escalón (el ${s.segment.stage}, a ${s.segment.speed})`);

  // Quien aguanta todos: acaba al terminar el último, con la VAM de ese escalón
  const h3 = harness(w);
  h3.engine.start();
  h3.advance(w.maxSec + 10);
  s = h3.engine.getState();
  ok(s.status === 'finished' && s.test && s.test.vam === st[st.length - 1].speed, 'aguantando todos, la VAM es la del último escalón');
});

process.stdout.write(`\n${passes} comprobaciones OK, ${failures} fallos\n`);
process.exit(failures ? 1 : 0);
