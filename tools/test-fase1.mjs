// RITMUP · tests de la fase 1 de la auditoría del algoritmo (12 nov 2026): control por pulso robusto, respeto a los
// cambios manuales, aprender de una carrera real y arreglos menores.
// Uso: node tools/test-fase1.mjs   (sale con código ≠ 0 si algo falla)
import { liveSpeed } from '../js/training/hr-control.js';
import { createTracker, equilibrium, hrAfter } from '../js/training/hr-dynamics.js';
import { applyFeedback } from '../js/training/progression.js';
import { vamFromRace, lastRace, predictRaces } from '../js/training/race-predict.js';
import { vamNow, vamSourceLabel, vamGapNote, vamFromLevels, DEFAULT_LEVELS } from '../js/training/levels.js';
import { raceSpeedFor } from '../js/training/race.js';
import { focusUpdate, focusView } from '../js/training/focus.js';
import { defaultState } from '../js/core/store.js';
import { deepClone, addDays } from '../js/core/utils.js';

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

// Modelo de ejemplo (no es de nadie)
const M = { b: 10, c: 4, d: 0.4, tauUp: 75, tauDown: 110, aTypical: 40, aSpread: 3 };
const T = { min: 150, max: 160 };                 // zona del tramo
const SEG = { zone: 'run', speed: 10.5, sec: 600, incline: 0 };

section('Control en directo: nunca al revés, tope por tramo y calma al final', () => {
  // previsión alta → baja; nunca devuelve una velocidad mayor
  const hi = liveSpeed(M, 52, { seg: SEG, hrNow: 165, remaining: 300, speed: 10.5, load: 20, target: T });
  ok(hi && hi.speed < 10.5 && hi.speed >= 10.0, `va alto: baja, y como mucho 0,5 (${hi?.speed})`);
  // caso real de la auditoría: yendo alto y con poco tramo por delante, el despeje pedía SUBIR
  const odd = liveSpeed(M, 40, { seg: { zone: 'jog', speed: 7.8, sec: 180, incline: 0 }, hrNow: 161, remaining: 39, speed: 7.8, load: 14, target: { min: 132, max: 143 } });
  ok(odd === null || odd.speed <= 7.8, `con el pulso alto nunca sube (${odd?.speed})`);
  // previsión baja → sube; nunca devuelve una menor
  const lo = liveSpeed(M, 40, { seg: SEG, hrNow: 138, remaining: 400, speed: 9.5, load: 0, target: T });
  ok(lo && lo.speed > 9.5 && lo.speed <= 10.0, `va bajo: sube, y como mucho 0,5 (${lo?.speed})`);
  // tope acumulado sobre la velocidad con la que empezó el tramo: −0,8 / +0,5
  const capDown = liveSpeed(M, 56, { seg: SEG, hrNow: 172, remaining: 300, speed: 10.0, load: 30, target: T, base: 10.5 });
  ok(capDown && Math.abs(capDown.speed - 9.7) < 1e-9, `no baja más de 0,8 en todo el tramo (${capDown?.speed})`);
  ok(liveSpeed(M, 56, { seg: SEG, hrNow: 172, remaining: 300, speed: 9.7, load: 30, target: T, base: 10.5 }) === null, 'agotado el tope de bajada, no toca más');
  const capUp = liveSpeed(M, 40, { seg: SEG, hrNow: 130, remaining: 400, speed: 10.9, load: 0, target: { min: 165, max: 175 }, base: 10.5 });
  ok(capUp === null || capUp.speed <= 11.0 + 1e-9, `no sube más de 0,5 en todo el tramo (${capUp?.speed})`);
  ok(liveSpeed(M, 40, { seg: SEG, hrNow: 130, remaining: 400, speed: 11.0, load: 0, target: { min: 165, max: 175 }, base: 10.5 }) === null, 'agotado el tope de subida, no toca más');
  // sin `base` (como antes): pasos de 0,5 sin tope acumulado
  ok(liveSpeed(M, 56, { seg: SEG, hrNow: 172, remaining: 300, speed: 9.7, load: 30, target: T })?.speed < 9.7, 'sin velocidad de partida no hay tope acumulado');
  // con menos de 90 s por delante, unas pocas pulsaciones no merecen un cambio
  let v = 10;
  let p = 0;
  for (; v < 13; v = Math.round((v + 0.1) * 10) / 10) { p = hrAfter(M, 40, 158, 60, v, 0, 10); if (p > T.max + 2.5 && p < T.max + 5.5) break; }
  ok(p > T.max + 2 && p < T.max + 6, `caso de prueba: a ${v} se pasa por poco (${p.toFixed(1)})`);
  ok(liveSpeed(M, 40, { seg: SEG, hrNow: 158, remaining: 60, speed: v, load: 10, target: T }) === null, 'a 60 s del final, pasarse por menos de 6 ppm no cambia nada');
  ok(liveSpeed(M, 40, { seg: SEG, hrNow: 170, remaining: 60, speed: 11.5, load: 30, target: T })?.speed < 11.5, 'a 60 s del final, pasarse de largo sí baja');
});

section('Seguidor: lecturas imposibles y pausas', () => {
  const tr = createTracker(M);
  let t = 0;
  let hr = 120;
  const run = (sec, v, read) => { for (let k = 0; k < sec; k += 5) { t += 5; const x = equilibrium(M, 44, v, 0, 0); hr += (x - hr) * (1 - Math.exp(-5 / 75)); tr.step(t, v, 0, 0, read ? Math.round(hr) : null); } };
  ok(tr.plausible(80) && tr.plausible(175), 'antes de asentarse, cualquier lectura razonable vale');
  ok(!tr.plausible(30) && !tr.plausible(240), 'fuera de 40–230 nunca');
  run(300, 10, true);
  ok(tr.seen >= 12 && Math.abs(tr.bias - 4) < 2, `aprende el día (+4): ${tr.bias.toFixed(1)}`);
  ok(tr.plausible(Math.round(hr)) && tr.plausible(Math.round(hr) + 12) && tr.plausible(Math.round(hr) - 12), 'lecturas cercanas a lo esperado valen');
  ok(!tr.plausible(80), 'el reloj leyendo 80 corriendo a 10 km/h no es creíble');
  ok(!tr.plausible(Math.round(hr) + 35), 'ni una lectura enganchada a la cadencia (+35)');
  // pausa de 2 min: el pulso real cae; al volver, reengancharse no cambia lo aprendido del día
  const biasBefore = tr.bias;
  const hrBack = Math.round(hr) - 35;
  tr.resync(t, hrBack);
  ok(Math.abs(tr.bias - biasBefore) < 1e-9 && tr.hr === hrBack, 'reenganche: mismo sesgo del día, pulso de ahora');
  tr.step(t + 5, 10, 0, 0, hrBack + 3);
  ok(Math.abs(tr.bias - biasBefore) < 1.5, `tras la pausa no cree que «vas sobrado» (sesgo ${tr.bias.toFixed(1)} frente a ${biasBefore.toFixed(1)})`);
  // sin reenganche, el mismo caso arrastra el sesgo hacia abajo (lo que pasaba antes)
  const old = createTracker(M);
  let t2 = 0; let h2 = 120;
  for (let k = 0; k < 300; k += 5) { t2 += 5; const x = equilibrium(M, 44, 10, 0, 0); h2 += (x - h2) * (1 - Math.exp(-5 / 75)); old.step(t2, 10, 0, 0, Math.round(h2)); }
  const b0 = old.bias;
  for (let k = 0; k < 40; k += 5) { t2 += 5; old.step(t2, 10, 0, 0, Math.round(h2) - 35 + k / 4); }
  ok(old.bias < b0 - 4, `sin reenganche el sesgo se hunde (${old.bias.toFixed(1)}): por eso hace falta`);
});

const LV = { ...DEFAULT_LEVELS };
const baseState = (o = {}) => ({ ...deepClone(defaultState()), levels: { ...LV }, ...o });
let sesN = 0;
const ses = (o = {}) => ({
  id: `f${++sesN}`, dayKey: '2026-10-10', completed: true, completionPct: 1,
  timeInZone: { warmup: 180, walk: 0, jog: 400, run: 300, fast: 360, sprint: 0, cooldown: 120 },
  adjustments: {}, levelsAtStart: { ...LV }, isTest: false, test: null, ...o,
});

section('Niveles: deshacer una bajada del modo pulso no es «subir»', () => {
  const st = baseState();
  // el modo pulso bajó 0,5 en «correr» y tú lo deshiciste: acabaste a la velocidad del plan
  const undo = applyFeedback(st, ses({ adjustments: {}, hrCoachAdj: { run: -0.5 } }), { feeling: 'hard' });
  ok(undo.levels.run === LV.run, `deshacer la bajada no sube el nivel (${undo.levels.run})`);
  // bajó 0,5 y tú subiste 0,7: solo cuentan los 0,2 por encima del plan
  const above = applyFeedback(st, ses({ adjustments: { run: 0.2 }, hrCoachAdj: { run: -0.5 } }), { feeling: 'hard' });
  ok(Math.abs(above.levels.run - (LV.run + 0.1)) < 1e-9, `por encima del plan sí cuenta, y solo eso (${above.levels.run})`);
  // lo que subió el modo pulso sigue sin contar
  const coachUp = applyFeedback(st, ses({ adjustments: { run: 0.3 }, hrCoachAdj: { run: 0.3 } }), { feeling: 'hard' });
  ok(coachUp.levels.run === LV.run, 'lo que sube el modo pulso no cuenta como tuyo');
  // subir tú 0,4 sin modo pulso: como siempre
  const mine = applyFeedback(st, ses({ adjustments: { run: 0.4 } }), { feeling: 'hard' });
  ok(Math.abs(mine.levels.run - (LV.run + 0.2)) < 1e-9, `subir tú 0,4 adopta la mitad (${mine.levels.run})`);
});

section('Niveles: «exigente» corta la racha al límite y una carrera no es fatiga', () => {
  let st = baseState();
  const step = (state, o, feeling) => { const r = applyFeedback(state, ses(o), { feeling }); return { ...state, levels: r.levels, progression: r.progression }; };
  st = step(st, { dayKey: '2026-10-10' }, 'max');
  ok(st.progression.hardStreak === 1, 'una al límite: racha 1');
  st = step(st, { dayKey: '2026-10-12' }, 'hard');
  ok(st.progression.hardStreak === 0, '«exigente» pone la racha a cero');
  const fastBefore = st.levels.fast;
  st = step(st, { dayKey: '2026-10-20' }, 'max');
  ok(st.progression.hardStreak === 1 && st.levels.fast === fastBefore, 'otra al límite, separada por una exigente: no baja nada');
  // dos al límite seguidas de verdad: sí baja (regla de siempre)
  let s2 = baseState();
  s2 = step(s2, { dayKey: '2026-10-10' }, 'max');
  const f0 = s2.levels.fast;
  s2 = step(s2, { dayKey: '2026-10-12' }, 'max');
  ok(s2.levels.fast < f0, 'dos al límite seguidas siguen bajando la velocidad más alta');
  // una carrera a tope no cuenta
  let s3 = baseState();
  s3 = step(s3, { dayKey: '2026-10-10' }, 'max');
  const f1 = s3.levels.fast;
  s3 = step(s3, { dayKey: '2026-10-12', category: 'race', race: { key: '5k', km: 5, label: '5K', sec: 1500 } }, 'max');
  ok(s3.levels.fast === f1 && s3.progression.hardStreak === 1, 'una carrera al límite no suma racha ni baja velocidades');
});

section('Aprender de una carrera real', () => {
  ok(vamFromRace({ km: 5, sec: 1500, feeling: 'max' }) === Math.round((12 / 0.915) * 10) / 10, '5K a 12,0 al límite → VAM 13,1');
  ok(vamFromRace({ km: 5, sec: 1500, feeling: 'hard' }) > vamFromRace({ km: 5, sec: 1500, feeling: 'max' }), 'si te quedaba margen, tu VAM es mayor');
  ok(vamFromRace({ km: 5, sec: 1500 }) === Math.round((12 / 0.88) * 10) / 10, 'sin valorar: extremo bajo del rango');
  ok(vamFromRace({ km: 10, sec: 3600, feeling: 'max' }) === Math.round((10 / 0.865) * 10) / 10, '10K con su fracción propia');
  ok(vamFromRace({ km: 3, sec: 900 }) === null && vamFromRace({ km: 5, sec: 0 }) === null && vamFromRace({ km: 5, sec: 100 }) === null, 'distancias raras o marcas imposibles: null');
  // la marca queda dentro del rango que luego predice la app con esa VAM
  for (const feeling of ['max', 'hard', 'ok']) {
    const vam = vamFromRace({ km: 5, sec: 1663, feeling });
    const p = predictRaces(vam).find((r) => r.key === '5k');
    ok(p.fastSec <= 1663 + 8 && p.slowSec >= 1663 - 8, `${feeling}: 27:43 cae en el rango previsto (${p.fastSec}–${p.slowSec})`);
  }
  const now = Date.parse('2026-11-13T08:00:00Z');
  const race = (dayKey, sec, feeling = 'hard') => ({ id: `r${dayKey}`, dayKey, startedAt: `${dayKey}T06:00:00.000Z`, category: 'race', feeling, race: { key: '5k', km: 5, label: '5K', sec } });
  const hist = [race('2026-10-01', 1700), { id: 'x', dayKey: '2026-11-05', startedAt: '2026-11-05T06:00:00.000Z' }, race('2026-11-12', 1663)];
  const lr = lastRace(hist, { now });
  ok(lr && lr.date === '2026-11-12' && lr.sec === 1663 && lr.key === '5k' && lr.vam === vamFromRace({ km: 5, sec: 1663, feeling: 'hard' }), 'la última carrera, con su VAM');
  ok(lastRace([race('2026-06-01', 1600)], { now }) === null, 'una carrera de hace más de 120 días ya no manda');
  ok(lastRace([], { now }) === null && lastRace(null, { now }) === null, 'sin carreras: null');

  // vamNow: sin test, la carrera manda sobre las velocidades
  const st = baseState({ history: hist });
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const v = vamNow(st);
    ok(v.source === 'race' && v.vam === lr.vam && v.race?.sec === 1663, `sin test, VAM de la carrera (${v.vam}) y no la de las velocidades (${v.levelsVam})`);
    ok(/5K/.test(vamSourceLabel(v)) && /12 nov/.test(vamSourceLabel(v)), `se dice de dónde sale: «${vamSourceLabel(v)}»`);
    ok(v.levelsVam > v.vam ? /carrera real/.test(vamGapNote(v)) : vamGapNote(v) === '', 'y se explica la diferencia con las velocidades');
    // test MÁS reciente que la carrera: manda el test
    const withTest = baseState({ history: hist, progression: { lastTest: { vam: 13.0, date: '2026-11-13' } } });
    ok(vamNow(withTest).source !== 'race' && vamNow(withTest).race === null, 'un test posterior a la carrera manda');
    // test ANTERIOR a la carrera: manda la carrera
    const oldTest = baseState({ history: hist, progression: { lastTest: { vam: 13.0, date: '2026-11-01' } } });
    ok(vamNow(oldTest).source === 'race', 'una carrera posterior al test manda');
    // sin carrera: como siempre
    const plain = vamNow(baseState());
    ok(plain.source === 'levels' && plain.vam === vamFromLevels(LV) && plain.race === null, 'sin carrera ni test: la de las velocidades');
    // ritmo de carrera por defecto: con la VAM de la carrera, no con la de las velocidades
    const def = raceSpeedFor('5k', { levels: LV });
    const fromRace = raceSpeedFor('5k', { levels: LV, vam: v.vam });
    ok(fromRace < def && Math.abs(fromRace - 5 / 1663 * 3600) < 0.5, `ritmo por defecto cerca de lo que corriste (${fromRace} frente a ${def})`);
    ok(raceSpeedFor('5k', { levels: LV, vam: v.vam, targetSec: 1500 }) === 12, 'con tiempo objetivo, manda el objetivo');
  } finally { Date.now = realNow; }
});

section('Enfoque: un objetivo ya pasado no lo bloquea', () => {
  const today = '2026-11-23';
  const now = new Date(`${today}T08:00:00`);
  const goal = (date) => ({ v: 1, distance: '5k', date, targetSec: 1620, setOn: '2026-10-25', where: 'cinta' });
  const live = baseState({ plan: { ...defaultState().plan, goal: goal(addDays(today, 10)) } });
  ok(focusUpdate(live, now) === null && focusView(live, now)?.state === 'goal', 'con carrera por delante, manda la carrera');
  const recent = baseState({ plan: { ...defaultState().plan, goal: goal(addDays(today, -3)) } });
  ok(focusView(recent, now)?.state === 'goal', 'la semana siguiente a la carrera, todavía');
  const past = baseState({ plan: { ...defaultState().plan, goal: goal(addDays(today, -11)) } });
  ok(focusView(past, now)?.state !== 'goal', `pasada una semana, el enfoque vuelve (${focusView(past, now)?.state})`);
});

process.stdout.write(`\n${passes} comprobaciones OK, ${failures} fallos\n`);
process.exit(failures ? 1 : 0);
