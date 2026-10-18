// BestRunning · tests del motor del reproductor con reloj falso.
// Uso: node tools/test-engine.mjs   (sale con código ≠ 0 si algo falla)
import { createEngine, restoreEngine, buildSession } from '../js/player/engine.js';
import { kcalPerMinute } from '../js/training/levels.js';

let failures = 0;
let passes = 0;
function ok(cond, msg) {
  if (cond) { passes++; return; }
  failures++;
  process.stderr.write(`  ✗ ${msg}\n`);
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
function section(name, fn) {
  process.stdout.write(`• ${name}\n`);
  try { fn(); } catch (err) { failures++; process.stderr.write(`  ✗ excepción: ${err?.stack || err}\n`); }
}

const TREADMILL = { minSpeed: 1, maxSpeed: 12, hasIncline: false };

function mkWorkout(segments, extra = {}) {
  const totalSec = segments.reduce((a, s) => a + s.sec, 0);
  return { id: 'test~20~1~100', templateId: 'test', title: 'Clase de prueba', category: 'intervals', totalSec, segments, isTest: false, ...extra };
}

const BASIC = mkWorkout([
  { zone: 'warmup', speed: 6.5, incline: 0, sec: 60, label: 'Calentamiento' },
  { zone: 'fast', speed: 11.5, incline: 0, sec: 30, label: 'Correr rápido' },
  { zone: 'jog', speed: 8.3, incline: 0, sec: 60, label: 'Trotar' },
  { zone: 'fast', speed: 11.5, incline: 0, sec: 30, label: 'Correr rápido' },
  { zone: 'cooldown', speed: 6.0, incline: 0, sec: 60, label: 'Vuelta a la calma' },
]);

function harness(workout, extra = {}) {
  const clock = { t: 1_000_000 };
  const events = [];
  const segCalls = [];
  let ticks = 0;
  const engine = createEngine(workout, {
    now: () => clock.t,
    autoTick: false,
    treadmill: TREADMILL,
    weightKg: 78,
    onEvent: (type, data) => events.push({ type, data }),
    onSegment: (state, info) => segCalls.push({ index: state.segIndex, info }),
    onTick: () => { ticks++; },
    ...extra,
  });
  const advance = (sec) => { clock.t += sec * 1000; engine.tick(); };
  return { clock, engine, events, segCalls, advance, ticks: () => ticks };
}

section('Estado inicial y arranque', () => {
  const h = harness(BASIC);
  const s0 = h.engine.getState();
  ok(s0.status === 'ready', 'status inicial ready');
  ok(s0.segIndex === 0 && s0.segment.zone === 'warmup', 'primer segmento');
  ok(s0.nextSegment.zone === 'fast', 'nextSegment');
  ok(s0.totalRemaining === 240 && s0.totalElapsed === 0, 'totales iniciales');
  ok(h.engine.start() === true, 'start devuelve true');
  ok(h.engine.start() === false, 'start dos veces no hace nada');
  ok(h.events.some((e) => e.type === 'start'), 'evento start');
  ok(h.segCalls.length === 1 && h.segCalls[0].info.reason === 'start', 'onSegment al arrancar');
  ok(typeof h.engine.getState().startedAt === 'string', 'startedAt ISO');
});

section('Transiciones de segmento', () => {
  const h = harness(BASIC);
  h.engine.start();
  h.advance(30);
  let s = h.engine.getState();
  ok(s.segIndex === 0 && near(s.segElapsed, 30), 'a los 30 s sigue en calentamiento');
  ok(near(s.segRemaining, 30), 'segRemaining 30');
  h.advance(31);
  s = h.engine.getState();
  ok(s.segIndex === 1 && near(s.segElapsed, 1), 'a los 61 s está en el 2º segmento con 1 s');
  ok(near(s.totalElapsed, 61), 'totalElapsed = posición 61');
  ok(s.currentSpeed === 11.5, 'velocidad actual 11,5');
  const segEv = h.events.filter((e) => e.type === 'segment');
  ok(segEv.length === 2 && segEv[1].data.silent === false && segEv[1].data.reason === 'auto', 'evento segment no silencioso');
  ok(near(s.progress, 61 / 240), 'progress');
});

section('Pausa y reanudación', () => {
  const h = harness(BASIC);
  h.engine.start();
  h.advance(20);
  ok(h.engine.pause() === true, 'pause');
  ok(h.engine.getState().status === 'paused', 'status paused');
  h.clock.t += 100_000;
  h.engine.tick();
  let s = h.engine.getState();
  ok(near(s.totalElapsed, 20) && near(s.activeSec, 20), 'en pausa no avanza el tiempo');
  ok(h.engine.resume() === true, 'resume');
  h.advance(10);
  s = h.engine.getState();
  ok(near(s.totalElapsed, 30) && near(s.activeSec, 30), 'tras reanudar sigue desde 20 s');
  ok(h.events.some((e) => e.type === 'pause') && h.events.some((e) => e.type === 'resume'), 'eventos pause/resume');
  h.engine.togglePause();
  ok(h.engine.getState().status === 'paused', 'togglePause pausa');
  h.engine.togglePause();
  ok(h.engine.getState().status === 'running', 'togglePause reanuda');
});

section('Saltos ±1', () => {
  const h = harness(BASIC);
  h.engine.start();
  h.advance(10);
  ok(h.engine.skip(1) === true, 'skip +1');
  let s = h.engine.getState();
  ok(s.segIndex === 1 && s.segElapsed === 0, 'salta al inicio del segmento 2');
  ok(near(s.totalElapsed, 60), 'posición = inicio del segmento 2');
  ok(near(s.skippedSec, 50), 'skippedSec 50');
  ok(near(s.activeSec, 10), 'el tiempo activo no salta');
  h.advance(2);
  h.engine.skip(-1);
  s = h.engine.getState();
  ok(s.segIndex === 0 && s.segElapsed === 0, 'skip −1 con < 3 s vuelve al segmento anterior');
  h.advance(5);
  h.engine.skip(-1);
  s = h.engine.getState();
  ok(s.segIndex === 0 && s.segElapsed === 0, 'skip −1 con > 3 s reinicia el segmento');
  const last = h.events.filter((e) => e.type === 'segment').pop();
  ok(last.data.reason === 'restart', 'motivo restart');
  // Saltar en pausa
  h.engine.pause();
  h.engine.skip(1);
  s = h.engine.getState();
  ok(s.segIndex === 1 && s.status === 'paused', 'skip en pausa mantiene la pausa');
  // Saltar el último segmento termina
  h.engine.resume();
  h.engine.skip(1); h.engine.skip(1); h.engine.skip(1);
  ok(h.engine.getState().segIndex === 4, 'en el último segmento');
  ok(h.events.some((e) => e.type === 'lastSegment'), 'evento lastSegment');
  h.engine.skip(1);
  s = h.engine.getState();
  ok(s.status === 'finished' && s.finishedEarly === true, 'skip en el último segmento termina');
  ok(h.events.filter((e) => e.type === 'finish').length === 1, 'un único evento finish');
});

section('Salto grande de tiempo (JS suspendido)', () => {
  const h = harness(BASIC);
  h.engine.start();
  h.advance(5);
  const segBefore = h.segCalls.length;
  h.advance(160); // cruza 3 límites: 60, 90, 150 → segmento 3 a 165 s
  const s = h.engine.getState();
  ok(s.segIndex === 3 && near(s.segElapsed, 15), 'procesa varios límites y cae en el segmento correcto');
  const segEv = h.events.filter((e) => e.type === 'segment' && e.data.reason === 'auto');
  ok(segEv.length === 3, 'tres eventos segment');
  ok(segEv[0].data.silent === true && segEv[1].data.silent === true && segEv[2].data.silent === false, 'silenciosos salvo el último');
  ok(h.segCalls.length === segBefore + 1, 'onSegment una sola vez');
  ok(near(s.timeInZone.warmup, 60) && near(s.timeInZone.fast, 45) && near(s.timeInZone.jog, 60), 'tiempo en zonas integrado por segmento');
  const expectKm = (6.5 * 60 + 11.5 * 30 + 8.3 * 60 + 11.5 * 15) / 3600;
  ok(near(s.distanceKm, expectKm, 1e-9), 'distancia integrada por segmento');
  ok(h.events.some((e) => e.type === 'halfway'), 'evento halfway (120 s)');
  // Salto que supera el final
  h.advance(10_000);
  const f = h.engine.getState();
  ok(f.status === 'finished' && f.finishedEarly === false, 'termina de forma natural');
  ok(near(f.activeSec, 240), 'tiempo activo exacto al terminar');
  ok(near(f.totalRemaining, 0) && f.progress === 1, 'progreso completo');
});

section('Distancia y kcal', () => {
  const h = harness(BASIC);
  h.engine.start();
  h.advance(60);
  const s = h.engine.getState();
  ok(near(s.distanceKm, 6.5 / 60, 1e-9), 'distancia 1 min a 6,5');
  ok(near(s.kcal, kcalPerMinute(6.5, 0, 78), 1e-9), 'kcal 1 min a 6,5');
  ok(near(s.avgSpeed, 6.5, 1e-9), 'velocidad media');
});

section('Evento km con ritmo', () => {
  const w = mkWorkout([{ zone: 'run', speed: 12, incline: 0, sec: 600 }]);
  const h = harness(w);
  h.engine.start();
  for (let i = 0; i < 40; i++) h.advance(10); // 400 s a 12 km/h = 1,333 km
  const km = h.events.filter((e) => e.type === 'km');
  ok(km.length === 1 && km[0].data.km === 1, 'un evento km');
  ok(km[0].data.pace === '5:00' && km[0].data.paceSec === 300, 'ritmo del km 5:00');
  h.advance(200);
  const km2 = h.events.filter((e) => e.type === 'km');
  ok(km2.length === 2 && km2[1].data.pace === '5:00', 'segundo km');
});

section('adjustSpeed con propagación y recorte', () => {
  const h = harness(BASIC);
  h.engine.start();
  h.advance(65); // segmento 1 (fast)
  ok(h.engine.adjustSpeed(0.1), 'ajuste +0,1');
  h.engine.adjustSpeed(0.1);
  let s = h.engine.getState();
  ok(s.currentSpeed === 11.7, 'velocidad actual 11,7');
  let segs = h.engine.getSegments();
  ok(segs[3].speed === 11.7, 'propaga al resto de segmentos de la misma zona');
  ok(segs[2].speed === 8.3 && segs[4].speed === 6.0, 'no toca otras zonas');
  ok(s.adjustments.fast === 0.2, 'acumula adjustments.fast');
  // Recorte a la cinta (máx 12)
  ok(h.engine.adjustSpeed(0.5), 'ajuste recortado');
  s = h.engine.getState();
  ok(s.currentSpeed === 12 && s.adjustments.fast === 0.5, 'recortado a 12,0 y suma lo aplicado');
  ok(h.engine.adjustSpeed(0.1) === false, 'en el máximo no ajusta');
  segs = h.engine.getSegments();
  ok(segs[3].speed === 12, 'futuro también recortado');
  ok(h.events.filter((e) => e.type === 'adjust').length === 3, 'eventos adjust');
  const trace = s.speedTrace;
  ok(trace.some((p) => p[1] === 12), 'speedTrace registra el cambio');
  // Distancia se integra con la velocidad efectiva
  const before = s.distanceKm;
  h.advance(10);
  ok(near(h.engine.getState().distanceKm - before, 12 * 10 / 3600, 1e-9), 'integra con la velocidad ajustada');
  // Ajuste negativo y vuelta a 0
  h.engine.adjustSpeed(-0.5);
  ok(h.engine.getState().adjustments.fast === undefined, 'ajuste neto 0 se elimina');
  // Ajuste en zona sin futuros
  h.advance(25); // → jog
  h.engine.adjustSpeed(-0.3);
  segs = h.engine.getSegments();
  ok(segs[2].speed === 8.0 && h.engine.getState().adjustments.jog === -0.3, 'ajuste en trote');
});

section('Test: endTest salta a la vuelta a la calma', () => {
  const w = mkWorkout([
    { zone: 'warmup', speed: 6.5, sec: 60 },
    { zone: 'jog', speed: 8.0, sec: 60, stage: 1 },
    { zone: 'jog', speed: 8.5, sec: 60, stage: 2 },
    { zone: 'run', speed: 9.0, sec: 60, stage: 3 },
    { zone: 'cooldown', speed: 6.0, sec: 60 },
    { zone: 'cooldown', speed: 5.5, sec: 60 },
  ], { isTest: true, category: 'test' });
  const h = harness(w);
  ok(h.engine.endTest() === false, 'endTest antes de empezar no hace nada');
  h.engine.start();
  h.advance(30);
  ok(h.engine.endTest() === false, 'endTest en calentamiento no hace nada');
  ok(h.engine.getState().inTestStage === false, 'inTestStage false en calentamiento');
  h.advance(30 + 60 + 30); // 30 s dentro del escalón 2
  let s = h.engine.getState();
  ok(s.segIndex === 2 && s.inTestStage === true, 'en el escalón 2');
  ok(h.engine.endTest() === true, 'endTest');
  s = h.engine.getState();
  ok(s.segIndex === 4 && s.segment.zone === 'cooldown', 'salta a la vuelta a la calma');
  ok(s.test && s.test.lastStageSpeed === 8.0 && s.test.secondsInLastStage === 30, 'resultado del test');
  ok(near(s.test.vam, 8.25), 'VAM Kuipers 8,25');
  ok(near(s.testSkippedSec, 30 + 60), 'testSkippedSec');
  ok(h.events.some((e) => e.type === 'testEnd'), 'evento testEnd');
  h.advance(200);
  s = h.engine.getState();
  ok(s.status === 'finished', 'termina');
  const ses = buildSession(w, s, { levels: { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13 }, planDate: '2026-10-17' });
  ok(ses.isTest === true && ses.test && near(ses.test.vam, 8.25), 'Session.test');
  ok(ses.completed === true && ses.completionPct === 1, 'test completado (sin contar escalones no corridos)');
  // Test completo sin endTest
  const h2 = harness(w);
  h2.engine.start();
  h2.advance(250);
  const s2 = h2.engine.getState();
  ok(s2.test && s2.test.lastStageSpeed === 9.0 && near(s2.test.vam, 9.0), 'test completado entero → VAM = último escalón');
});

section('finish y buildSession', () => {
  const h = harness(BASIC);
  h.engine.start();
  h.advance(100);
  h.engine.adjustSpeed(0.2);
  h.advance(20);
  ok(h.engine.finish() === true, 'finish');
  ok(h.engine.finish() === false, 'finish dos veces no hace nada');
  const s = h.engine.getState();
  ok(s.status === 'finished' && s.finishedEarly, 'terminado antes de tiempo');
  ok(s.currentSpeed === 0, 'velocidad 0 al terminar');
  const levels = { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13 };
  const ses = buildSession(BASIC, s, { levels, planDate: '2026-10-17', startedAt: '2026-10-17T07:00:00.000Z' });
  const keys = ['id', 'workoutId', 'templateId', 'title', 'category', 'startedAt', 'dayKey', 'planDate', 'plannedSec',
    'elapsedSec', 'completed', 'completionPct', 'distanceKm', 'avgSpeed', 'maxSpeed', 'kcal', 'timeInZone', 'speedTrace',
    'adjustments', 'levelsAtStart', 'feeling', 'rpe', 'hrAvg', 'hrMax', 'notes', 'isTest', 'test', 'levelChanges'];
  for (const k of keys) ok(k in ses, `Session.${k}`);
  ok(/^ses_/.test(ses.id), 'id ses_');
  ok(ses.plannedSec === 240 && ses.elapsedSec === 120, 'plannedSec y elapsedSec');
  ok(ses.completed === false && near(ses.completionPct, 0.5), 'completionPct 0,5');
  ok(ses.planDate === '2026-10-17' && /^\d{4}-\d{2}-\d{2}$/.test(ses.dayKey), 'fechas');
  ok(ses.adjustments.jog === 0.2, 'adjustments en la sesión');
  ok(ses.levelsAtStart.fast === 11.5 && ses.levelsAtStart !== levels, 'levelsAtStart copiado');
  const tz = Object.values(ses.timeInZone).reduce((a, b) => a + b, 0);
  ok(Math.abs(tz - 120) <= 2, 'timeInZone suma el tiempo activo');
  ok(Object.keys(ses.timeInZone).length === 7, 'timeInZone con las 7 zonas');
  ok(ses.maxSpeed === 11.5, 'maxSpeed');
  ok(ses.speedTrace.length >= 2 && ses.speedTrace[0][0] === 0, 'speedTrace desde 0');
  const tr = ses.speedTrace;
  ok(tr.every((p, i) => i === 0 || p[0] >= tr[i - 1][0]), 'speedTrace monótono');
  ok(ses.feeling === null && ses.notes === '' && Array.isArray(ses.levelChanges), 'campos de feedback vacíos');
  ok(JSON.parse(JSON.stringify(ses)).id === ses.id, 'serializable');
});

section('Sesión completa', () => {
  const h = harness(BASIC);
  h.engine.start();
  for (let i = 0; i < 1000; i++) h.advance(0.25);
  const s = h.engine.getState();
  ok(s.status === 'finished', 'terminada con ticks de 250 ms');
  ok(near(s.activeSec, 240, 1e-6), 'tiempo exacto con ticks pequeños');
  const ses = buildSession(BASIC, s, { levels: null });
  ok(ses.completed === true && ses.completionPct === 1, 'completada');
  const expectKm = (6.5 * 60 + 11.5 * 30 + 8.3 * 60 + 11.5 * 30 + 6 * 60) / 3600;
  ok(near(ses.distanceKm, Math.round(expectKm * 100) / 100), 'distancia redondeada');
});

section('snapshot / restore', () => {
  const h = harness(BASIC);
  h.engine.start();
  h.advance(70);
  h.engine.adjustSpeed(0.3);
  h.advance(5);
  const snap = JSON.parse(JSON.stringify(h.engine.snapshot()));
  ok(snap.workoutId === BASIC.id && typeof snap.savedAt === 'number', 'snapshot serializable con workoutId y savedAt');
  const a = h.engine.getState();
  const clock = { t: h.clock.t + 3_600_000 };
  const events = [];
  const r = restoreEngine(snap, BASIC, { now: () => clock.t, autoTick: false, treadmill: TREADMILL, onEvent: (t) => events.push(t) });
  const b = r.getState();
  ok(b.status === 'paused', 'restaura en pausa');
  for (const k of ['segIndex', 'segElapsed', 'totalElapsed', 'distanceKm', 'kcal', 'currentSpeed', 'activeSec', 'maxSpeed']) {
    ok(near(a[k], b[k], 1e-9), `restaura ${k}`);
  }
  ok(JSON.stringify(a.timeInZone) === JSON.stringify(b.timeInZone), 'restaura timeInZone');
  ok(JSON.stringify(a.adjustments) === JSON.stringify(b.adjustments), 'restaura adjustments');
  ok(JSON.stringify(a.speedTrace) === JSON.stringify(b.speedTrace), 'restaura speedTrace');
  ok(r.getSegments()[3].speed === 11.8, 'restaura velocidades ajustadas');
  ok(r.resume() === true, 'resume tras restaurar');
  clock.t += 10_000;
  r.tick();
  ok(near(r.getState().activeSec, a.activeSec + 10), 'continúa contando tras restaurar (sin contar la hora cerrada)');
  clock.t += 1_000_000;
  r.tick();
  ok(r.getState().status === 'finished', 'termina tras restaurar');
  ok(events.includes('finish'), 'evento finish tras restaurar');
  // Snapshot de ida y vuelta: snapshot(restore(snap)) ≈ snap
  const r2 = restoreEngine(snap, BASIC, { now: () => 0, autoTick: false });
  const snap2 = r2.snapshot();
  const strip = (o) => { const c = { ...o }; delete c.savedAt; delete c.status; return JSON.stringify(c); };
  ok(strip(snap) === strip(snap2), 'snapshot idempotente');
  // Snapshot corrupto no rompe
  const r3 = restoreEngine({ segIndex: 99, speeds: [1, 2] }, BASIC, { autoTick: false });
  ok(r3.getState().segIndex === 4, 'snapshot corrupto se recorta');
  const r4 = restoreEngine(null, BASIC, { autoTick: false });
  ok(r4.getState().status === 'ready', 'snapshot nulo → ready');
});

section('Robustez', () => {
  const empty = createEngine({ segments: [] }, { autoTick: false, now: () => 0 });
  empty.start();
  ok(empty.getState().status === 'finished', 'clase vacía termina al empezar');
  const h = harness(BASIC);
  h.engine.start();
  h.clock.t -= 50_000; // reloj hacia atrás
  h.engine.tick();
  ok(h.engine.getState().totalElapsed === 0, 'reloj hacia atrás no resta');
  h.engine.destroy();
  h.advance(30);
  ok(h.engine.getState().totalElapsed === 0, 'destroy detiene el motor');
  // Temporizador real
  const real = createEngine(BASIC, { tickMs: 10 });
  real.start();
  real.destroy();
  ok(true, 'temporizador real se limpia');
});

process.stdout.write(`\n${passes} comprobaciones OK, ${failures} fallos\n`);
process.exit(failures ? 1 : 0);
