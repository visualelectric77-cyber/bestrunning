// RITMUP · tests de la corrección diaria del plan (js/training/day-fix.js, 13 nov 2026): cómo llegas hoy frente a tu
// normal y qué se hace con la sesión fuerte (recortar, mover, recolocar la que te saltaste), con sus frenos y «Deshacer».
// Datos inventados (no son de nadie). Uso: node tools/test-day-fix.mjs   (sale con código ≠ 0 si algo falla)
import { defaultState } from '../js/core/store.js';
import { dayPick, planDay, setPlannerToday } from '../js/training/planner.js';
import { dayState, planFix, applyFix, undoFix, fixOn, runDayFix } from '../js/training/day-fix.js';
import { addDays, mondayOf, deepClone } from '../js/core/utils.js';

let failures = 0;
let passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; return true; } failures++; process.stderr.write(`  ✗ ${msg}\n`); return false; };
const eq = (a, b, msg) => ok(a === b, `${msg}: esperado «${b}», obtenido «${a}»`);
const section = (t) => process.stdout.write(`• ${t}\n`);

/** Salud inventada: 30 días normales (reposo 55, VFC 60, 7 h 30) y lo de hoy a medida. */
function metrics(today, { sleep = 450, rest = 55, hrv = 60, noToday = false } = {}) {
  const resting = []; const hrvL = []; const sl = [];
  for (let i = 30; i >= 1; i--) {
    const d = addDays(today, -i);
    resting.push([d, 55 + (i % 3) - 1]); hrvL.push([d, 60 + (i % 5) - 2]); sl.push({ day: d, asleep: 450 + ((i % 4) - 1) * 10 });
  }
  if (!noToday) {
    if (rest != null) resting.push([today, rest]);
    if (hrv != null) hrvL.push([today, hrv]);
    if (sleep != null) sl.push({ day: today, asleep: sleep });
  }
  return { resting, hrv: hrvL, sleep: sl };
}
function base(effort = null) {
  const st = defaultState();
  st.onboarded = true;
  st.plan.startDate = '2026-09-07';
  st.profile.effort = effort;
  return st;
}
const week = (st, monday) => Array.from({ length: 7 }, (_, i) => dayPick(st, addDays(monday, i)));
const noHardPairs = (st, monday) => { const w = week(st, monday); return w.every((p, i) => !(i && p.intensity === 'hard' && w[i - 1].intensity === 'hard')); };
const done = (st, date, extra = {}) => { const p = planDay(st, date); st.history.push({ id: `s_${date}`, dayKey: date, planDate: date, workoutId: p.workout?.id, templateId: p.templateId, elapsedSec: p.minutes * 60, plannedSec: p.minutes * 60, completionPct: 1, completed: true, ...extra }); };

/* ───────────── 1 · Cómo llegas hoy ───────────── */
section('Cómo llegas hoy frente a tu normal');
{
  const T = '2026-11-05';
  eq(dayState(null, T), null, 'sin Salud: null');
  eq(dayState({ resting: [], hrv: [], sleep: [] }, T), null, 'sin datos: null');
  const g = dayState(metrics(T), T);
  ok(g && g.level === 'green' && g.points === 0 && g.sleep.min === 450 && g.rest.delta === 0, `día normal: verde (${JSON.stringify(g)})`);
  eq(dayState(metrics(T, { sleep: 370 }), T).level, 'green', 'noche algo corta para ti sola (1 punto): verde');
  eq(dayState(metrics(T, { sleep: 400 }), T).points, 0, '6 h 40 durmiendo 7 h 35 de normal: no cuenta');
  const a = dayState(metrics(T, { sleep: 320 }), T);
  ok(a.level === 'amber' && a.points === 2 && /has dormido 5 h 20 min, 2 h 15 min menos de lo tuyo/.test(a.signals[0].text), `2 h menos de lo tuyo: ámbar (${a.signals[0]?.text})`);
  eq(dayState(metrics(T, { sleep: 370, rest: 59 }), T).level, 'amber', 'noche corta para ti + reposo +4: ámbar');
  // quien duerme poco siempre llega como siempre: 5 h 10 de normal y 5 h 05 hoy no es ninguna señal
  const shortSleeper = metrics(T, { sleep: 305 });
  shortSleeper.sleep.forEach((n) => { if (n.day !== T) n.asleep = 310; });
  const ss = dayState(shortSleeper, T);
  ok(ss.level === 'green' && ss.points === 0, `duermes 5 h 10 siempre y hoy 5 h 05: verde (${JSON.stringify(ss.signals)})`);
  // sin noches de referencia no se juzga el sueño
  const nob = metrics(T, { sleep: 200 }); nob.sleep = nob.sleep.filter((n) => n.day === T);
  eq(dayState(nob, T).points, 0, 'sin tus noches de referencia, el sueño no cuenta');
  const r = dayState(metrics(T, { sleep: 320, rest: 60 }), T);
  ok(r.level === 'red' && r.points === 3, 'noche muy corta + reposo +5: rojo (3 puntos con una señal fuerte)');
  eq(dayState(metrics(T, { rest: 63, hrv: 42 }), T).level, 'red', 'reposo +8 y VFC −30 %: rojo');
  eq(dayState(metrics(T, { sleep: 370, rest: 59, hrv: 52 }), T).level, 'amber', 'tres señales flojas (3 puntos sin ninguna fuerte): ámbar');
  eq(dayState(metrics(T, { hrv: 52 }), T).points, 1, 'VFC −13 %: 1 punto');
  // sin datos de hoy: vale el reposo y la VFC de ayer; el sueño no
  const y = dayState(metrics(T, { noToday: true }), T);
  ok(y && y.level === 'green' && !y.sleep && y.rest, 'sin lo de hoy: usa el reposo y la VFC de ayer');
  // ayer al límite: solo suma si el cuerpo también lo dice
  const hist = [{ dayKey: addDays(T, -1), rpe: 10, feeling: 'max' }];
  eq(dayState(metrics(T), T, hist).points, 0, 'ayer al límite pero hoy todo normal: no cambia nada');
  const l = dayState(metrics(T, { sleep: 320 }), T, hist);
  ok(l.points === 3 && l.level === 'amber' && l.signals.some((s) => s.key === 'load'), 'noche muy corta y ayer al límite, con el pulso normal: ámbar (rojo solo si lo dice el pulso)');
  eq(dayState(metrics(T, { sleep: 200 }), T).level, 'amber', 'una noche malísima sola nunca es rojo');
  // umbrales a tu medida: con una VFC que te baila un 20 % de un día para otro, un −20 % es un día cualquiera
  const noisy = metrics(T, { hrv: 48 });
  noisy.hrv = noisy.hrv.map((p, i) => (p[0] === T ? p : [p[0], i % 2 ? 72 : 48]));
  const nz = dayState(noisy, T);
  ok(nz.hrv.pct <= -19 && nz.points === 0, `VFC muy irregular: −20 % no cuenta (${nz.hrv.pct} %, ${nz.points} puntos)`);
  eq(dayState(metrics(T, { hrv: 48 }), T).points, 1, '…pero con una VFC estable, −20 % sí es una señal');
  // lo mismo con el reposo: si te varía ±5 de un día a otro, +5 no es nada
  const nr = metrics(T, { rest: 60 });
  nr.resting = nr.resting.map((p, i) => (p[0] === T ? p : [p[0], i % 2 ? 60 : 50]));
  eq(dayState(nr, T).points, 0, 'reposo muy irregular: +5 no cuenta');
  // y con el sueño: quien duerme muy irregular necesita una noche realmente fuera de lo suyo
  const ns = metrics(T, { sleep: 330 });
  ns.sleep.forEach((n, i) => { if (n.day !== T) n.asleep = i % 2 ? 480 : 340; });
  eq(dayState(ns, T).points, 0, 'sueño muy irregular: 80 min menos de tu media no cuenta');
  // pocos días de base: esa señal no cuenta
  const few = { resting: [[addDays(T, -1), 50], [T, 70]], hrv: [], sleep: [{ day: T, asleep: 440 }] };
  eq(dayState(few, T).level, 'green', 'sin base de 7 días, el reposo no cuenta');
}

/* ───────────── 2 · Día rojo con sesión fuerte: se mueve ───────────── */
section('Rojo: hoy suave y la sesión fuerte pasa a un día suave que encaje');
{
  setPlannerToday('2026-11-05');
  const st = base();
  const T = '2026-11-05';                                  // jueves con sesión fuerte de 50 min
  const hard = dayPick(st, T);
  ok(hard.intensity === 'hard' && hard.minutes === 50, `el jueves de la semana de prueba es fuerte (${hard.templateId})`);
  const ds = dayState(metrics(T, { sleep: 310, rest: 62 }), T);
  eq(ds.level, 'red', 'llega en rojo');
  const fix = planFix(st, T, ds);
  ok(fix && fix.kind === 'move' && fix.from === T && fix.to > T, `se propone mover (${fix?.kind} → ${fix?.to})`);
  const easy = dayPick(st, fix.to);
  eq(easy.intensity, 'easy', 'el día destino era suave');
  ok(/Hoy llegas cargado: has dormido 5 h 10 min, 2 h 25 min menos de lo tuyo y tu pulso en reposo va 7 por encima\./.test(fix.text), `explica por qué (${fix.text})`);
  ok(/pasa a (mañana|el \w+)/.test(fix.text), 'dice a qué día pasa');
  const before = deepClone(st.plan.overrides);
  ok(applyFix(st, fix), 'se aplica');
  const t2 = dayPick(st, T); const d2 = dayPick(st, fix.to);
  ok(t2.templateId === easy.templateId && t2.minutes === easy.minutes && t2.seed === easy.seed && t2.intensity === 'easy', 'hoy queda la suave, intacta');
  ok(d2.templateId === hard.templateId && d2.minutes === hard.minutes && d2.seed === hard.seed, 'la fuerte viaja intacta (misma clase, minutos y semilla)');
  ok(t2.auto && d2.auto, 'los dos días quedan marcados como cambio automático');
  ok(noHardPairs(st, mondayOf(T)), 'no quedan dos días fuertes seguidos');
  ok(/cargado/.test(planDay(st, T).intro) && /movida/.test(planDay(st, fix.to).intro), 'cada día trae su frase');
  const f1 = fixOn(st, T, T); const f2 = fixOn(st, fix.to, T);
  ok(f1 && f1.kind === 'move' && f1.canUndo && f1.text === fix.text, 'Hoy lo explica y deja deshacer');
  ok(f2 && /movimos desde el jueves/.test(f2.text), `el día destino también lo explica (${f2?.text})`);
  eq(planFix(st, T, ds), null, 'no se decide dos veces el mismo día');
  // deshacer
  ok(undoFix(st, fix.id), 'se deshace');
  eq(JSON.stringify(st.plan.overrides), JSON.stringify(before), 'el plan vuelve a como estaba');
  eq(dayPick(st, T).templateId, hard.templateId, 'hoy vuelve a tocar la fuerte');
  eq(fixOn(st, T, T), null, 'ya no se anuncia');
  eq(planFix(st, T, ds), null, 'y no se vuelve a aplicar hoy (lo has deshecho tú)');
  eq(undoFix(st, fix.id), false, 'deshacer dos veces no hace nada');
}
{
  // Mejor con un día por medio que pegada a hoy; y nunca junto a otra fuerte
  setPlannerToday('2026-11-09');
  const st = base();
  const T = '2026-11-09';                                  // lunes fuerte; martes suave, viernes suave pero junto al sábado fuerte
  ok(dayPick(st, T).intensity === 'hard', 'lunes fuerte');
  const fix = planFix(st, T, dayState(metrics(T, { rest: 64, hrv: 40 }), T));
  ok(fix?.kind === 'move', 'se mueve');
  applyFix(st, fix);
  ok(noHardPairs(st, mondayOf(T)), `destino ${fix.to}: sin fuertes seguidas`);
  // el día destino no puede deshacerse cuando ya has corrido uno de los dos
  done(st, T);
  eq(fixOn(st, fix.to, fix.to)?.canUndo, false, 'con el día ya corrido no se ofrece deshacer');
}

/* ───────────── 3 · Frenos ───────────── */
section('Frenos: lo que no se toca');
{
  setPlannerToday('2026-11-05');
  const T = '2026-11-05';
  const red = dayState(metrics(T, { sleep: 300, rest: 63 }), T);
  const st = base();
  eq(planFix(st, T, dayState(metrics(T), T)), null, 'día verde: el plan tal cual');
  eq(planFix(st, T, null), null, 'sin datos y nada saltado: nada');
  // un día que has cambiado tú no se toca
  const mine = base(); mine.plan.overrides[T] = { templateId: dayPick(mine, T).templateId, minutes: 45 };
  eq(planFix(mine, T, red), null, 'día cambiado por ti: no se toca');
  // sesión ya hecha
  const dn = base(); done(dn, T);
  eq(planFix(dn, T, red), null, 'sesión de hoy ya hecha: nada');
  // día suave en rojo: no hay nada que corregir
  const E = '2026-11-06';
  setPlannerToday(E);
  ok(dayPick(st, E).intensity === 'easy', 'viernes suave');
  eq(planFix(st, E, dayState(metrics(E, { sleep: 300, rest: 63 }), E)), null, 'día suave en rojo: se queda igual');
  // día medio en rojo: pasa a suave, misma duración
  const M = '2026-11-07';
  setPlannerToday(M);
  const md = dayPick(st, M);
  ok(md.intensity === 'moderate', 'sábado de intensidad media');
  const sf = planFix(st, M, dayState(metrics(M, { sleep: 300, rest: 63 }), M));
  ok(sf?.kind === 'soft', 'día medio en rojo: suave');
  const st2 = base(); applyFix(st2, sf);
  ok(dayPick(st2, M).intensity === 'easy' && dayPick(st2, M).minutes === md.minutes, 'trote suave de la misma duración');
  // segunda vez en la semana: ya no se mueve otra clase; hoy suave
  setPlannerToday('2026-11-09');
  const w = base();
  const T1 = '2026-11-09'; const T2 = '2026-11-14';         // lunes y sábado fuertes de la misma semana
  ok(dayPick(w, T1).intensity === 'hard' && dayPick(w, T2).intensity === 'hard', 'dos días fuertes en la semana');
  applyFix(w, planFix(w, T1, dayState(metrics(T1, { rest: 64, hrv: 40 }), T1)));
  setPlannerToday(T2);
  const again = dayPick(w, T2).intensity === 'hard' ? planFix(w, T2, dayState(metrics(T2, { rest: 64, hrv: 40 }), T2)) : null;
  ok(again == null || again.kind === 'soft', `segundo rojo de la semana: no se mueve otra vez (${again?.kind})`);
  // test VAM y carrera nunca se tocan
  const tt = base(); const TD = '2026-11-12';
  tt.plan.overrides[TD] = { templateId: 'test-vam' };
  setPlannerToday(TD);
  eq(planFix(tt, TD, dayState(metrics(TD, { sleep: 300, rest: 63 }), TD)), null, 'test VAM: no se toca');
}

/* ───────────── 4 · Ámbar: más corta ───────────── */
section('Ámbar: la sesión fuerte se hace, más corta');
{
  setPlannerToday('2026-11-05');
  const st = base();
  const T = '2026-11-05';
  const hard = dayPick(st, T);
  const ds = dayState(metrics(T, { sleep: 320 }), T);
  eq(ds.level, 'amber', 'llega en ámbar');
  const fix = planFix(st, T, ds);
  ok(fix?.kind === 'trim', `se recorta (${fix?.kind})`);
  applyFix(st, fix);
  const t2 = dayPick(st, T);
  ok(t2.templateId === hard.templateId && t2.minutes <= hard.minutes - 10 && t2.minutes >= 20, `misma clase, ${t2.minutes} min en vez de ${hard.minutes}`);
  ok(planDay(st, T).workout && Math.abs(planDay(st, T).workout.totalSec / 60 - t2.minutes) <= 2, 'la clase recortada se construye con esa duración');
  ok(new RegExp(`${t2.minutes} min en vez de ${hard.minutes}`).test(fix.text), 'lo dice con cifras');
  undoFix(st, fix.id);
  eq(dayPick(st, T).minutes, hard.minutes, 'deshacer devuelve la duración');
  // sesión fuerte de 20 min: no hay de dónde recortar
  setPlannerToday('2026-11-09');
  const s2 = base(); const S = '2026-11-09';
  ok(dayPick(s2, S).intensity === 'hard' && dayPick(s2, S).minutes === 20, 'lunes fuerte de 20 min');
  eq(planFix(s2, S, dayState(metrics(S, { sleep: 320 }), S)), null, 'con 20 min no se recorta: se hace entera');
}

/* ───────────── 5 · La sesión fuerte que te saltaste ───────────── */
section('Recolocar la sesión fuerte que te saltaste');
{
  // semana normal del 9 nov: lunes fuerte (20), martes suave, miércoles medio, jueves medio, viernes suave, sábado fuerte
  const st = base();
  const MISS = '2026-11-09'; const T = '2026-11-10';
  setPlannerToday(T);
  const hard = dayPick(st, MISS);
  const green = dayState(metrics(T), T);
  const fix = planFix(st, T, green);
  ok(fix && fix.kind === 'relocate' && fix.from === MISS, `se recoloca la del lunes (${fix?.kind} → ${fix?.to})`);
  eq(fix.to, T, 'llegas bien: pasa a hoy');
  ok(/Te saltaste la sesión fuerte del lunes: pasa a hoy/.test(fix.text), `lo explica (${fix.text})`);
  applyFix(st, fix);
  ok(dayPick(st, T).templateId === hard.templateId && dayPick(st, T).seed === hard.seed, 'hoy toca la fuerte del lunes, intacta');
  ok(/te saltaste/.test(planDay(st, T).intro), 'con su frase');
  eq(planFix(st, T, green), null, 'una vez');
  setPlannerToday(addDays(T, 1));
  eq(planFix(st, addDays(T, 1), dayState(metrics(addDays(T, 1)), addDays(T, 1))), null, 'al día siguiente no se vuelve a mover');
  // sin datos de Salud (o en ámbar): no se te pone hoy, sino a partir de mañana
  const s2 = base(); setPlannerToday(T);
  const f2 = planFix(s2, T, null);
  ok(f2 == null || (f2.kind === 'relocate' && f2.to > T), `sin datos de hoy, nunca hoy mismo (${f2?.to || 'sin hueco'})`);
  const f3 = planFix(base(), T, dayState(metrics(T, { sleep: 320 }), T));
  ok(f3 == null || f3.to > T, 'en ámbar tampoco hoy');
  // si la hiciste, no hay nada que recolocar
  const s4 = base(); done(s4, MISS);
  eq(planFix(s4, T, green), null, 'la hiciste: nada');
  // si ya se movió ese día por un rojo, no se «recoloca» además
  const s5 = base(); setPlannerToday(MISS);
  const mv = planFix(s5, MISS, dayState(metrics(MISS, { rest: 64, hrv: 40 }), MISS));
  applyFix(s5, mv);
  setPlannerToday(addDays(MISS, 3));
  const later = planFix(s5, addDays(MISS, 3), dayState(metrics(addDays(MISS, 3)), addDays(MISS, 3)));
  ok(later == null, `con un cambio ya hecho esta semana no se encadena otro (${later?.kind})`);
}

/* ───────────── 6 · De un tirón, como lo usa la pantalla ───────────── */
section('Entreno exigente: sin frenos (solo cambia de día, nunca quita ni recorta)');
{
  const T = '2026-11-12';                                  // con exigente, jueves fuerte de 50 min y viernes suave
  setPlannerToday(T);
  const st = base('hard');
  const hard = dayPick(st, T);
  ok(hard.intensity === 'hard' && hard.minutes === 50, 'jueves fuerte con exigente');
  eq(planFix(st, T, dayState(metrics(T, { sleep: 320 }), T)), null, 'ámbar: no se recorta, se hace entera');
  eq(planFix(st, T, dayState(metrics(T, { sleep: 200 }), T)), null, 'una noche malísima: no se toca');
  eq(planFix(st, T, dayState(metrics(T, { sleep: 370, rest: 59 }), T)), null, 'ámbar con pulso algo alto: no se toca');
  const r = runDayFix(st, T, metrics(T, { rest: 63, hrv: 42 }));
  ok(r && r.kind === 'move' && r.state.level === 'red', `rojo de pulso y variabilidad: cambia de día (${r?.kind})`);
  const d2 = dayPick(st, r.to);
  ok(d2.templateId === hard.templateId && d2.minutes === hard.minutes && d2.seed === hard.seed, 'la sesión se hace igual, entera, otro día');
  ok(noHardPairs(st, mondayOf(T)), 'sin fuertes seguidas');
  ok(Array.isArray(st.plan.fixes) && st.plan.fixes.length === 1 && st.plan.fixes[0].prev, 'queda apuntado con lo que había, para deshacer');
  eq(runDayFix(st, T, metrics(T, { rest: 63, hrv: 42 })), null, 'segunda llamada el mismo día: nada');
  // sin hueco para moverla: con exigente se queda como estaba (sin exigente pasaría a suave)
  const N = '2026-11-03';
  setPlannerToday(N);
  ok(dayPick(base('hard'), N).intensity === 'hard', 'martes fuerte con exigente, sin hueco en la semana');
  eq(planFix(base('hard'), N, dayState(metrics(N, { rest: 63, hrv: 42 }), N)), null, 'rojo sin hueco: no se quita la sesión');
  // día medio en rojo: tampoco
  const M = '2026-11-07';
  setPlannerToday(M);
  ok(dayPick(base('hard'), M).intensity === 'moderate', 'sábado medio con exigente');
  eq(planFix(base('hard'), M, dayState(metrics(M, { rest: 63, hrv: 42 }), M)), null, 'día medio en rojo: se queda igual');
  eq(runDayFix(base(), N, null), null, 'sin Salud y sin nada saltado: nada');
}
setPlannerToday(null);

process.stdout.write(`\n${failures ? `✗ ${failures} fallos` : '✓ todo bien'} · ${passes} comprobaciones\n`);
process.exit(failures ? 1 : 0);
