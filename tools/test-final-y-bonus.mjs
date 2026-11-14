// RITMUP · tests del 14 nov 2026: vuelta a la calma a tu velocidad de verdad, suelo del trote, final de clase más
// corto (forma 2 de las clases, sin tocar las ya guardadas) y bonus de la semana.
// Datos inventados (no son de nadie). Uso: node tools/test-final-y-bonus.mjs   (sale con código ≠ 0 si algo falla)
import { defaultState } from '../js/core/store.js';
import { calmCaps, jogFloor, CALM_ZONES, nextSpeed, liveSpeed } from '../js/training/hr-control.js';
import { buildWorkout, workoutFromId, GEN } from '../js/training/generator.js';
import { TEMPLATES, getTemplate } from '../js/training/templates.js';
import { segmentsOfSession } from '../js/training/class-analysis.js';
import { dayPick, planWeek, planDay, setPlannerToday } from '../js/training/planner.js';
import { buildSession } from '../js/player/engine.js';
import { BONUS_MINUTES, bonusTemplates, weekComplete, bonusOffer, bonusPick } from '../js/training/bonus.js';
import { addDays, mondayOf } from '../js/core/utils.js';

let failures = 0;
let passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; return true; } failures++; if (failures <= 60) process.stderr.write(`  ✗ ${msg}\n`); return false; };
const eq = (a, b, msg) => ok(a === b, `${msg}: esperado «${b}», obtenido «${a}»`);
const section = (t) => process.stdout.write(`• ${t}\n`);
const L = { jog: 8.5, run: 10, fast: 11.5, sprint: 13 };

/* ───────────── 1 · Vuelta a la calma a tu velocidad de verdad ───────────── */
section('Vuelta a la calma: nunca más rápida que lo que vienes corriendo');
{
  const segs = [
    { zone: 'run', speed: 10, sec: 600 }, { zone: 'jog', speed: 7.8, sec: 600 },
    { zone: 'cooldown', speed: 8.0, sec: 60 }, { zone: 'cooldown', speed: 7.4, sec: 60 }, { zone: 'cooldown', speed: 6.8, sec: 60 },
  ];
  // vienes a 7,3 (el pulso o tú habéis bajado el trote): el primer escalón no puede subir a 8,0
  const c = calmCaps(segs, 2, 7.3);
  eq(JSON.stringify(c), JSON.stringify([{ index: 2, speed: 7.3 }, { index: 3, speed: 7.3 }]), 'escalones rebajados a lo que vienes corriendo');
  ok(c.every((x, i, a) => !i || x.speed <= a[i - 1].speed), 'siempre de más a menos');
  eq(calmCaps(segs, 2, 8.5).length, 0, 'si vienes más rápido que la vuelta a la calma, no se toca');
  eq(calmCaps(segs, 2, 8.0).length, 0, 'a la misma velocidad, tampoco');
  eq(JSON.stringify(calmCaps(segs, 2, 6.5)), JSON.stringify([{ index: 2, speed: 6.5 }, { index: 3, speed: 6.5 }, { index: 4, speed: 6.5 }]), 'vienes muy lento: toda la vuelta a la calma a esa velocidad');
  eq(calmCaps(segs, 3, 7.3)[0]?.index, 3, 'también entre escalones');
  eq(calmCaps(segs, 1, 7.3).length, 0, 'lo que no es vuelta a la calma no se toca');
  eq(calmCaps(segs, 2, 0).length, 0, 'sin velocidad: nada');
  eq(calmCaps(null, 0, 8).length, 0, 'sin tramos: nada');
  ok(CALM_ZONES.has('cooldown') && CALM_ZONES.has('warmup') && CALM_ZONES.has('walk') && !CALM_ZONES.has('jog'), 'el pulso no ajusta calentar, vuelta a la calma ni caminar');
}

/* ───────────── 2 · Suelo del trote ───────────── */
section('El trote no se hunde: tope contra tu velocidad de trote');
{
  eq(jogFloor(L), 7.5, 'sin exigente: como mucho 1,0 por debajo de tu trote');
  eq(jogFloor(L, { pushy: true }), 7.9, 'con exigente: 0,6');
  eq(jogFloor(L, { pushy: true, minSpeed: 8.2 }), 8.2, 'nunca por debajo del mínimo de la cinta');
  eq(jogFloor(null, { minSpeed: 3 }), 3, 'sin niveles: el mínimo de la cinta');
  // con el suelo, una recuperación que ya viene rebajada no se baja otra vez hasta casi andar
  const M = { b: 10, c: 4, d: 0.4, tauUp: 75, tauDown: 110, aTypical: 40, aSpread: 3 };
  const T = { min: 120, max: 132 };
  const next = { zone: 'jog', speed: 8.0, sec: 600, incline: 0 };
  const free = nextSpeed(M, 46, { cur: { zone: 'run', speed: 10, sec: 600 }, next, hrEnd: 160, load: 20, target: T });
  ok(free != null && free <= 7.4, `sin suelo, el pulso lo bajaba a ${free}`);
  const floor = jogFloor(L, { pushy: true });
  const capped = nextSpeed(M, 46, { cur: { zone: 'run', speed: 10, sec: 600 }, next, hrEnd: 160, load: 20, target: T, minSpeed: Math.min(floor, next.speed) });
  eq(capped, null, 'con exigente y el trote ya a 0,5 de lo tuyo: no se baja más (0,1 no merece un cambio)');
  const normal = nextSpeed(M, 46, { cur: { zone: 'run', speed: 10, sec: 600 }, next, hrEnd: 160, load: 20, target: T, minSpeed: Math.min(jogFloor(L), next.speed) });
  eq(normal, 7.5, 'sin exigente: hasta 1,0 por debajo de tu trote y ni una décima más');
  // el suelo nunca sirve para SUBIR un trote que la clase ya traía más lento
  const slow = { zone: 'jog', speed: 7.2, sec: 120, incline: 0 };
  const up = nextSpeed(M, 40, { cur: { zone: 'fast', speed: 11.5, sec: 60 }, next: slow, hrEnd: 150, load: 5, target: T, minSpeed: Math.min(floor, slow.speed) });
  ok(up == null || up <= slow.speed, `una recuperación planeada a 7,2 no sube al suelo (${up})`);
  // en directo igual
  const live = liveSpeed(M, 46, { seg: { zone: 'jog', speed: 8.0, sec: 600 }, hrNow: 158, remaining: 400, speed: 8.0, load: 20, target: T, minSpeed: Math.min(floor, 8.0) });
  ok(live == null || live.speed >= floor - 1e-9, `en directo tampoco pasa del suelo (${live?.speed})`);
}

/* ───────────── 3 · Forma 2 de las clases: final más corto ───────────── */
section('Final de clase más corto, sin tocar las clases ya guardadas');
{
  eq(GEN, 2, 'forma actual');
  const tail = (w) => { const s = w.segments; let i = s.length - 1; let cool = 0; while (i >= 0 && s[i].zone === 'cooldown') { cool += s[i].sec; i--; } let soft = 0; while (i >= 0 && s[i].zone === 'jog') { soft += s[i].sec; i--; } return { cool, soft }; };
  const a = buildWorkout('long-cruise', { minutes: 50, levels: L, seed: 12345, gen: 1 });
  const b = buildWorkout('long-cruise', { minutes: 50, levels: L, seed: 12345 });
  eq(a.gen, 1, 'forma 1 pedida'); eq(b.gen, 2, 'por defecto, la 2');
  eq(a.id, b.id, 'mismo identificador de clase');
  ok(tail(a).soft >= 600 && tail(a).cool >= 240, `forma 1: ${tail(a).soft}s de rodaje de vuelta + ${tail(a).cool}s de vuelta a la calma`);
  ok(tail(b).soft <= 180 && tail(b).cool <= 240, `forma 2: ${tail(b).soft}s + ${tail(b).cool}s`);
  eq(b.totalSec, 3000, 'dura lo mismo');
  const work = (w) => w.segments.filter((s) => s.zone === 'run').reduce((x, s) => x + s.sec, 0);
  ok(work(b) >= work(a), 'el crucero no se recorta');
  const head = (w) => w.segments.filter((s, i) => s.zone === 'jog' && i < w.segments.findIndex((x) => x.zone === 'run')).reduce((x, s) => x + s.sec, 0);
  ok(head(b) > head(a), 'el tiempo va delante del trabajo, no detrás');
  // todo el catálogo: duración exacta, tope del trote final y vuelta a la calma
  let n = 0;
  for (const t of TEMPLATES) {
    if (t.category === 'test') continue;
    for (const min of t.durations) for (const seed of [1, 7, 23]) {
      const w = buildWorkout(t.id, { minutes: min, levels: L, seed });
      n++;
      ok(w && w.totalSec === min * 60, `${t.id} ${min}′ s${seed}: dura ${w?.totalSec}`);
      const c = tail(w).cool;
      ok(min <= 22 ? c === 120 : min <= 37 ? c === 180 : c === 180 || c === 240, `${t.id} ${min}′ s${seed}: vuelta a la calma ${c}s`);
      const old = buildWorkout(t.id, { minutes: min, levels: L, seed, gen: 1 });
      const co = tail(old).cool;
      ok(min <= 37 ? co === c : co === 240 || co === 300, `${t.id} ${min}′ s${seed}: la forma 1 conserva su vuelta a la calma (${co}s)`);
    }
  }
  ok(n > 400, `catálogo revisado (${n} clases)`);
  // una sesión guardada se reconstruye con la forma con la que se corrió
  const st = defaultState(); st.levels = { ...L };
  const oldSes = { id: 's1', workoutId: a.id, levelsAtStart: { ...L } };               // de antes: sin `gen`
  const newSes = { id: 's2', workoutId: b.id, levelsAtStart: { ...L }, gen: 2 };
  const so = segmentsOfSession(st, oldSes); const sn = segmentsOfSession(st, newSes);
  eq(JSON.stringify(so.map((s) => [s.zone, s.sec])), JSON.stringify(a.segments.map((s) => [s.zone, s.sec])), 'la sesión antigua se analiza con la forma 1');
  eq(JSON.stringify(sn.map((s) => [s.zone, s.sec])), JSON.stringify(b.segments.map((s) => [s.zone, s.sec])), 'la nueva, con la 2');
  eq(buildSession(b, { totalSec: 3000, activeSec: 3000, totalElapsed: 3000 }).gen, 2, 'la sesión que se guarda lleva su forma');
  eq(workoutFromId(a.id, st).gen, 2, 'una clase abierta hoy por su id usa la forma actual');
  eq(workoutFromId(a.id, st, { gen: 1 }).gen, 1, '…salvo que se pida la antigua');
  // y el plan elige exactamente las mismas clases que antes (la carga se estima con la forma 1)
  setPlannerToday('2026-11-05');
  const p = defaultState(); p.onboarded = true; p.plan.startDate = '2026-09-07';
  eq(dayPick(p, '2026-11-05').templateId, 'power-then-steady', 'el plan de una semana conocida no cambia');
  eq(dayPick(p, '2026-11-09').templateId, 'sprint-clusters', '…ni el de la siguiente');
  setPlannerToday(null);
}

/* ───────────── 4 · Bonus de la semana ───────────── */
section('Bonus: semana completa y día de descanso');
{
  const list = bonusTemplates();
  ok(list.length >= 5, `hay ${list.length} formatos de bonus`);
  for (const t of list) {
    ok(t.planOnly === true && t.bonus === true && t.category === 'challenge', `${t.id}: es de bonus y el plan no la sortea`);
    ok(t.title && t.subtitle && t.description && Array.isArray(t.coachNotes) && t.coachNotes.length >= 2 && Array.isArray(t.themes) && t.themes.length, `${t.id}: tiene sus textos`);
    for (const min of BONUS_MINUTES) for (const seed of [1, 5, 99]) {
      const w = buildWorkout(t.id, { minutes: min, levels: L, seed });
      ok(w && w.totalSec === min * 60, `${t.id} ${min}′: dura ${w?.totalSec}`);
      ok(w.segments[0].zone === 'warmup' && w.segments.at(-1).zone === 'cooldown', `${t.id} ${min}′: calienta y enfría`);
      ok(w.segments.every((s) => s.sec >= 20 && s.speed >= 5 && s.speed <= L.sprint + 0.01), `${t.id} ${min}′: tramos de ≥ 20 s y velocidades dentro de tus niveles`);
      const hard = w.segments.filter((s) => s.zone === 'fast' || s.zone === 'sprint').reduce((a, s) => a + s.sec, 0);
      ok(hard >= 0.1 * w.totalSec && hard <= 0.45 * w.totalSec, `${t.id} ${min}′: ${Math.round((100 * hard) / w.totalSec)} % de trabajo duro`);
      const sprint = w.segments.filter((s) => s.zone === 'sprint').reduce((a, s) => a + s.sec, 0);
      ok(sprint <= 0.25 * w.totalSec, `${t.id} ${min}′: sprint con tope`);
      eq(JSON.stringify(workoutFromId(w.id, { levels: L }).segments.map((s) => [s.speed, s.sec])), JSON.stringify(w.segments.map((s) => [s.speed, s.sec])), `${t.id} ${min}′: se reabre igual por su id`);
    }
  }
  // el plan nunca pone un bonus
  const st = defaultState(); st.onboarded = true; st.plan.startDate = '2026-09-07';
  setPlannerToday('2026-11-09');
  let inPlan = 0;
  for (const eff of [null, 'hard']) { st.profile.effort = eff; for (let w = 0; w < 26; w++) for (const d of planWeek(st, addDays('2026-09-07', 7 * w))) if (d.templateId && getTemplate(d.templateId)?.bonus) inPlan++; }
  eq(inPlan, 0, 'ningún bonus en 26 semanas de plan');
  st.profile.effort = null;

  // semana del 9 nov: domingo 15 descanso
  const SUN = '2026-11-15'; const now = new Date(2026, 10, 15, 9, 0, 0);
  setPlannerToday(SUN);
  const days = planWeek(st, mondayOf(SUN), now);
  eq(days[6].kind, 'rest', 'el domingo de la semana de prueba es descanso');
  ok(!weekComplete(st, SUN, now) && !bonusOffer(st, SUN, now), 'sin hacer la semana: no hay bonus');
  const done = (d) => st.history.push({ id: `s_${d.date}`, dayKey: d.date, planDate: d.date, workoutId: d.workout.id, templateId: d.templateId, elapsedSec: d.minutes * 60, plannedSec: d.minutes * 60, completionPct: 1, completed: true, startedAt: `${d.date}T06:00:00.000Z` });
  const train = days.filter((d) => d.kind !== 'rest');
  train.slice(0, -1).forEach(done);
  ok(!bonusOffer(st, SUN, now), 'falta una sesión: no hay bonus');
  done(train.at(-1));
  ok(weekComplete(st, SUN, now) && bonusOffer(st, SUN, now), 'semana completa y domingo de descanso: bonus');
  ok(!bonusOffer(st, '2026-11-14', now), 'un día de entreno no ofrece bonus');
  // elegir el tiempo
  const picks = BONUS_MINUTES.map((m) => bonusPick(st, SUN, m));
  ok(picks.every((w, i) => w && w.minutes === BONUS_MINUTES[i] && getTemplate(w.templateId).bonus), 'una clase de bonus para cada duración');
  eq(new Set(picks.map((w) => w.templateId)).size, 1, 'el formato del día es el mismo elijas el tiempo que elijas');
  eq(bonusPick(st, SUN, 30).id, picks[1].id, 'y siempre sale el mismo ese día');
  eq(bonusPick(st, SUN, 37).minutes, 30, 'duración rara: 30');
  // no es la clase de mañana ni cambia el plan del lunes
  const mon = planDay(st, '2026-11-16', now);
  ok(picks[2].templateId !== mon.templateId, 'no es la clase del lunes');
  const before = JSON.stringify(planDay(st, '2026-11-16', now).workout.segments);
  st.history.push({ id: 'bonus1', dayKey: SUN, planDate: null, workoutId: picks[1].id, templateId: picks[1].templateId, elapsedSec: 1800, plannedSec: 1800, completionPct: 1, completed: true, startedAt: `${SUN}T08:00:00.000Z` });
  eq(JSON.stringify(planDay(st, '2026-11-16', now).workout.segments), before, 'hacer el bonus no cambia la clase del lunes');
  eq(planDay(st, '2026-11-16', now).status, 'upcoming', 'el lunes sigue pendiente');
  ok(!bonusOffer(st, SUN, now), 'ya has entrenado hoy: no se vuelve a ofrecer');
  // la semana siguiente no repite los dos últimos formatos hechos
  const used = picks[1].templateId;
  const next = bonusPick(st, '2026-11-22', 30);
  ok(next.templateId !== used, `a la semana siguiente toca otro formato (${used} → ${next.templateId})`);
  st.history.push({ id: 'bonus2', dayKey: '2026-11-22', planDate: null, templateId: next.templateId, workoutId: next.id, elapsedSec: 1800, completionPct: 1, startedAt: '2026-11-22T08:00:00.000Z' });
  const third = bonusPick(st, '2026-11-29', 30);
  ok(third.templateId !== used && third.templateId !== next.templateId, 'y a la tercera, uno que no sea ninguno de los dos');
  setPlannerToday(null);
}

process.stdout.write(`\n${failures ? `✗ ${failures} fallos` : '✓ todo bien'} · ${passes} comprobaciones\n`);
process.exit(failures ? 1 : 0);
