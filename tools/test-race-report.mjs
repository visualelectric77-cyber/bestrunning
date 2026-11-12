// RITMUP · tests del informe de carrera (js/training/race-report.js) y de la voz en carrera (js/audio/coach.js).
// Uso: node tools/test-race-report.mjs   (sale con código ≠ 0 si algo falla)
import { raceReport, raceDebrief } from '../js/training/race-report.js';
import { buildRaceWorkout } from '../js/training/race.js';
import { createEngine, buildSession } from '../js/player/engine.js';
import { buildCueSchedule } from '../js/audio/coach.js';
import { classDebrief } from '../js/training/class-debrief.js';
import { classAnalysis, executionOf } from '../js/training/class-analysis.js';

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
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const LEVELS = { jog: 9, run: 10.5, fast: 11.5, sprint: 13 };

/** Corre la carrera con el motor de verdad; `plan`: [[segundo real de carrera, velocidad nueva]…]. → sesión guardada */
function runRace({ speed = 12, plan = [], hr = true } = {}) {
  const w = buildRaceWorkout('5k', { speed, levels: LEVELS, weightKg: 70 });
  const clock = { t: 1_000_000 };
  const e = createEngine(w, { now: () => clock.t, autoTick: false, treadmill: { minSpeed: 1, maxSpeed: 18 }, weightKg: 70 });
  e.start();
  const hrSeries = [];
  const todo = plan.slice();
  let raceReal = 0;
  let guard = 0;
  while (e.getState().status === 'running' && guard++ < 20000) {
    clock.t += 1000;
    e.tick();
    const s = e.getState();
    if (s.segment?.race) {
      raceReal = s.segRealSec;
      while (todo.length && raceReal >= todo[0][0]) {
        const [, v] = todo.shift();
        const steps = Math.round((v - s.currentSpeed) * 10);
        for (let i = 0; i < Math.abs(steps); i++) e.adjustSpeed(steps > 0 ? 0.1 : -0.1);
      }
    }
    // pulso inventado: sube con la velocidad y con el tiempo de carrera, y baja tras la meta
    if (hr && Math.round(s.activeSec) % 5 === 0) {
      const inRace = !!s.segment?.race;
      const after = s.segIndex > w.segments.findIndex((g) => g.race);
      hrSeries.push([Math.round(s.totalElapsed * 10) / 10, Math.round(inRace ? 130 + s.segRealSec / 40 + (s.currentSpeed - 11) * 4 : after ? 170 - Math.min(40, s.segRealSec / 3) : 110)]);
    }
  }
  const fin = e.getState();
  const ses = buildSession(w, fin, { levels: LEVELS });
  ses.hrSeries = hr ? hrSeries : null;
  // el reproductor guarda la marca al cruzar la meta: aquí, lo que duró de verdad el tramo de carrera
  return { w, ses, raceReal };
}

section('Carrera a ritmo fijo', () => {
  const { w, ses } = runRace({ speed: 12 });
  ses.race = { key: '5k', km: 5, label: '5K', sec: 1500 };
  const r = raceReport(ses, w.segments);
  ok(r && r.sec === 1500 && r.km === 5 && r.paceSec === 300 && r.speed === 12, 'marca, ritmo y velocidad de la carrera');
  ok(r.splits.length === 5 && r.splits.every((x) => x.sec === 300 && x.speed === 12), 'cinco kilómetros de 5:00');
  ok(r.splits.reduce((a, x) => a + x.sec, 0) === 1500, 'los parciales suman la marca');
  ok(r.pacing.kind === 'even' && r.pacing.diff === 0, 'reparto regular');
  ok(r.warm.sec === 480 && r.cool.sec === 360, 'calentamiento (8 min) y vuelta a la calma (6 min), aparte');
  ok(near(r.warm.km + r.km + r.cool.km, r.total.km, 0.03), `calentamiento + carrera + calma = toda la sesión (${r.warm.km} + 5 + ${r.cool.km} ≈ ${r.total.km})`);
  ok(r.total.sec === 480 + 1500 + 360, 'tiempo de la sesión entera');
  ok(r.hr && r.hr.max >= r.hr.avg && r.splits.every((x) => x.hrAvg > 0), 'pulso de la carrera y de cada km');
  ok(r.splits[4].hrAvg > r.splits[0].hrAvg, 'el pulso del último km es mayor que el del primero');
  ok(r.recovery && r.recovery.min1 > 0 && r.recovery.min2 >= r.recovery.min1, 'recuperación 1 y 2 min tras la meta');
});

section('Carrera con cambios de velocidad: parciales reales', () => {
  // sale a 12,0; al minuto baja a 11,0; a los 15 min baja a 10,0
  const { w, ses, raceReal } = runRace({ speed: 12, plan: [[60, 11], [900, 10]] });
  const km1 = 60 + (1 - 0.2) / 11 * 3600;                      // 0,2 km a 12 + 0,8 km a 11
  const total = 60 + (4.8 / 11) * 3600;                        // si no bajase más
  ok(raceReal > 1500, 'tarda más que el plan');
  ses.race = { key: '5k', km: 5, label: '5K', sec: Math.round(raceReal) };
  const r = raceReport(ses, w.segments);
  ok(r.splits.length === 5 && near(r.splits[0].sec, km1, 2), `km 1 con su tiempo real (${r.splits[0].sec} ≈ ${Math.round(km1)})`);
  ok(near(r.splits[1].sec, 3600 / 11, 2) && near(r.splits[4].sec, 360, 2), `km 2 a 11,0 (${r.splits[1].sec}) y km 5 a 10,0 (${r.splits[4].sec})`);
  ok(near(r.splits.reduce((a, x) => a + x.sec, 0), r.sec, 2), 'los parciales suman la marca');
  ok(r.sec > total - 5 && r.pacing.kind === 'fade' && r.pacing.diff > 20, `acaba más lento que empieza (${r.pacing.diff} s/km)`);
  ok(r.startSpeed === 12 && r.endSpeed === 10 && r.planSpeed === 12, 'velocidad de salida, de llegada y del plan');
  ok(r.warm.sec === 480 && r.cool.sec === 360, 'calentamiento y calma no cambian');
  ok(near(r.warm.km + r.km + r.cool.km, r.total.km, 0.05), 'las distancias cuadran con la sesión');
  ok(near(r.total.sec, 480 + raceReal + 360, 2), 'la sesión entera dura lo corrido de verdad');
  // más rápido al final: de menos a más
  const up = runRace({ speed: 11, plan: [[800, 12]] });
  up.ses.race = { key: '5k', km: 5, label: '5K', sec: Math.round(up.raceReal) };
  const ru = raceReport(up.ses, up.w.segments);
  ok(ru.pacing.kind === 'negative' && ru.splits[4].sec < ru.splits[0].sec, 'de menos a más');
});

section('Sin datos no inventa', () => {
  const { w, ses } = runRace({ speed: 12, hr: false });
  ok(raceReport(ses, w.segments) === null, 'sin marca guardada (se saltó la carrera): no hay informe');
  ses.race = { key: '5k', km: 5, label: '5K', sec: 1500 };
  const r = raceReport(ses, w.segments);
  ok(r && r.hr === null && r.recovery === null && r.splits.every((x) => x.hrAvg === null), 'sin pulso: sin cifras de pulso');
  ok(raceReport(ses, null) === null && raceReport(ses, [{ zone: 'run', speed: 10, sec: 600 }]) === null, 'sin los tramos de la carrera: null');
  ok(raceReport({ ...ses, speedTrace: null }, w.segments).splits.length === 0, 'sin trazado de velocidad: sin parciales');
  ok(raceReport(null, w.segments) === null, 'sin sesión: null');
});

section('Lo que se cuenta de la carrera', () => {
  const { w, ses } = runRace({ speed: 12 });
  ses.race = { key: '5k', km: 5, label: '5K', sec: 1500 };
  ses.feeling = 'max';
  const r = raceReport(ses, w.segments);
  const d = raceDebrief(r, { hrMax: 190, feeling: 'max' });
  ok(d.kind === 'race' && d.headline === 'Tu 5K: 25:00' && /5K en 25:00/.test(d.body) && /5:00 \/km/.test(d.body), 'titular y cuerpo con la marca');
  ok(/Muy regular/.test(d.body), 'cuenta el reparto');
  ok(!/zona/.test(d.headline + d.body + d.tip), 'no habla de «tu zona»');
  const top = raceDebrief(r, { hrMax: r.hr.max + 1, feeling: 'hard' });
  ok(/pulso máximo real/.test(top.tip), 'llegar a la máxima sin ir al límite: avisa de que quizá sea más alta');
  ok(raceDebrief(null) === null, 'sin informe: null');
  const cd = classDebrief(ses, { segments: w.segments, profile: { hrMax: 190 } });
  ok(cd && cd.kind === 'race' && cd.headline === 'Tu 5K: 25:00', 'el titular de la clase es el de la carrera');
  const ex = executionOf(ses, w.segments, { hrMax: 190, hrRest: 60 });
  ok(ex.score === null && ex.race === true, 'la carrera no lleva nota de cumplimiento');
  const a = classAnalysis(ses, { state: { history: [ses], profile: { hrMax: 190, hrRest: 60 }, levels: LEVELS }, segments: w.segments });
  ok(a && a.race && a.checks.length === 0 && a.headline === 'Tu 5K: 25:00' && a.race.warm.sec === 480, 'el análisis de la clase lleva el informe de carrera y no las comprobaciones de zona');
  // una clase normal sigue igual
  const normal = { ...ses, race: undefined };
  const an = classAnalysis(normal, { state: { history: [normal], profile: { hrMax: 190, hrRest: 60 }, levels: LEVELS }, segments: w.segments });
  ok(an && !an.race, 'sin marca de carrera, análisis normal');
});

section('La voz en una carrera', () => {
  const w = buildRaceWorkout('5k', { speed: 11.2, levels: LEVELS, weightKg: 70 });
  for (const mode of ['minimal', 'normal', 'coach']) {
    const cues = buildCueSchedule(w, { chattiness: mode, announceLead: 10, seed: 7 });
    const list = Array.isArray(cues) ? cues : cues.cues;
    const start = w.race.start;
    const end = w.race.end;
    ok(!list.some((c) => c.kind === 'lastBlock'), `${mode}: nunca «último bloque» (caía en la vuelta a la calma, con la meta cruzada)`);
    ok(!list.some((c) => c.kind === 'halfWorkout'), `${mode}: nunca «mitad del entrenamiento» (la carrera dice «mitad de carrera» por distancia)`);
    ok(!list.some((c) => c.kind === 'halfSegment' && c.at > start && c.at < end), `${mode}: sin «mitad del tramo» dentro de la carrera`);
    ok(!list.some((c) => c.at >= end && /dalo todo|recta final|último bloque|no aflojes/i.test(c.text || '')), `${mode}: tras la meta nadie pide apretar`);
  }
  // una clase normal con paseo final: «último bloque» no cae en la vuelta a la calma
  const normal = { id: 'x~20~1~100', category: 'tempo', segments: [
    { zone: 'warmup', speed: 7, sec: 180, block: 'Calentamiento' },
    { zone: 'run', speed: 10.5, sec: 300, block: 'Bloque 1' },
    { zone: 'jog', speed: 9, sec: 120, block: 'Bloque 1' },
    { zone: 'run', speed: 10.5, sec: 300, block: 'Bloque 2' },
    { zone: 'jog', speed: 9, sec: 120, block: 'Bloque 2' },
    { zone: 'cooldown', speed: 7, sec: 180, block: 'Vuelta a la calma' },
    { zone: 'walk', speed: 4.5, sec: 120, block: 'Vuelta a la calma' },
  ] };
  const cues = buildCueSchedule(normal, { chattiness: 'normal', announceLead: 10, seed: 3 });
  const list = Array.isArray(cues) ? cues : cues.cues;
  const lb = list.find((c) => c.kind === 'lastBlock');
  ok(lb && lb.at >= 600 && lb.at < 1020, `clase normal: «último bloque» en el último bloque de trabajo (${lb?.at})`);
});

process.stdout.write(`\n${passes} comprobaciones OK, ${failures} fallos\n`);
process.exit(failures ? 1 : 0);
