// RITMUP · pruebas de «¿Cómo vas?» en clase (js/training/checkin.js) y de la escala del 1 al 10 (js/training/rpe.js).
// Uso: node tools/test-checkin.mjs   (sale con código ≠ 0 si algo falla)
import { shouldAsk, checkEffect, CHECK_MAX } from '../js/training/checkin.js';
import { RPE_SCALE, rpeToFeeling, FEELING_RPE, rpeLabel, sessionRpe } from '../js/training/rpe.js';
import { effortTolerance } from '../js/training/effort-learn.js';

let n = 0;
let bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error(`  ✗ ${m}`); } };

const st = (seg, o = {}) => ({ status: 'running', segment: seg, segIndex: 5, segElapsed: 62, totalElapsed: 1200, totalRemaining: 900, ...o });
const tempo = { zone: 'run', sec: 420 };

// 1 · Cuándo pregunta: al empezar el trote que sigue a un tramo de calidad, si quedan más de esa zona
const SEGS = [
  { zone: 'warmup', sec: 300 }, { zone: 'run', sec: 300 }, { zone: 'jog', sec: 90 }, { zone: 'run', sec: 300 },
  { zone: 'jog', sec: 90 }, { zone: 'fast', sec: 60 }, { zone: 'jog', sec: 60 }, { zone: 'fast', sec: 60 }, { zone: 'jog', sec: 30 },
  { zone: 'fast', sec: 60 }, { zone: 'cooldown', sec: 180 },
];
const at = (i, o = {}) => ({ status: 'running', segment: SEGS[i], segIndex: i, segElapsed: 6, totalElapsed: 600 + i * 60, totalRemaining: 900, ...o });
ok(JSON.stringify(shouldAsk(at(2), SEGS)) === JSON.stringify({ zone: 'run' }), 'trote tras un tempo, con más tempo después: pregunta por el tempo');
ok(JSON.stringify(shouldAsk(at(6), SEGS)) === JSON.stringify({ zone: 'fast' }), 'recuperación tras un rápido: pregunta por los rápidos');
ok(shouldAsk(at(4), SEGS) === null, 'tras el último tempo (no queda más tempo): no');
ok(shouldAsk(at(1), SEGS) === null && shouldAsk(at(3), SEGS) === null && shouldAsk(at(5), SEGS) === null, 'corriendo (tempo o rápido): nunca');
ok(shouldAsk(at(8), SEGS) === null, 'trote de 30 s: no');
ok(shouldAsk(at(2, { segElapsed: 1 }), SEGS) === null && shouldAsk(at(2, { segElapsed: 20 }), SEGS) === null, 'fuera de los primeros segundos del trote: no');
ok(shouldAsk(at(2), SEGS, [], { isTest: true }) === null && shouldAsk(at(2), SEGS, [], { race: true }) === null, 'test o carrera: no');
ok(shouldAsk(at(2), SEGS, [], { locked: true }) === null, 'pantalla bloqueada: no');
ok(shouldAsk(at(2, { status: 'paused' }), SEGS) === null, 'en pausa: no');
ok(shouldAsk(at(2, { totalRemaining: 150 }), SEGS) === null, 'últimos 3 min: no');
ok(shouldAsk(at(6), SEGS, [{ t: 900, seg: 2 }]) === null, 'hace menos de 4 min de la anterior: no');
ok(shouldAsk(at(6), SEGS, [{ t: 600, seg: 2 }]) !== null, 'hace 4 min o más: sí');
ok(shouldAsk(at(2), SEGS, [{ t: 0, seg: 2 }]) === null, 'en este trote ya preguntó: no');
ok(shouldAsk(at(6, { totalElapsed: 5000 }), SEGS, Array.from({ length: CHECK_MAX }, (_, k) => ({ t: k * 300, seg: 90 + k }))) === null, `como mucho ${CHECK_MAX} por clase`);
const am = SEGS.map((g, k) => (k === 1 ? { ...g, amrap: { workM: 400 } } : g));
ok(shouldAsk(at(2), am) === null, 'tras una AMRAP: no');
ok(shouldAsk(null) === null && shouldAsk({}) === null && shouldAsk(at(2), null) === null, 'sin datos: no');

// 2 · Qué hace cada respuesta
ok(JSON.stringify(checkEffect('up', 4)) === JSON.stringify({ dir: 1, steps: 3, tolPpm: 6 }), 'Sobrado: +0,3 y +2 de margen');
ok(checkEffect('up', 7).tolPpm === 8, 'Sobrado: el margen no pasa de 8');
ok(JSON.stringify(checkEffect('down', 6)) === JSON.stringify({ dir: -1, steps: 3, tolPpm: 0 }), 'Voy mal: −0,3 y sin margen');
ok(JSON.stringify(checkEffect('ok', 6)) === JSON.stringify({ dir: 0, steps: 0, tolPpm: null }), 'Bien: nada');
ok(checkEffect('x').dir === 0 && checkEffect(undefined).tolPpm === null, 'respuesta rara: nada');

// 3 · Escala del 1 al 10
ok(RPE_SCALE.length === 10 && RPE_SCALE.every((x, i) => x.n === i + 1 && x.label), 'diez números con su palabra');
ok([1, 2, 3].every((v) => rpeToFeeling(v) === 'easy') && [4, 5].every((v) => rpeToFeeling(v) === 'ok'), '1–3 Muy fácil, 4–5 Cómodo');
ok([6, 7, 8].every((v) => rpeToFeeling(v) === 'hard') && [9, 10].every((v) => rpeToFeeling(v) === 'max'), '6–8 Exigente, 9–10 Al límite');
ok(rpeToFeeling(0) === null && rpeToFeeling(11) === null && rpeToFeeling('x') === null && rpeToFeeling(null) === null, 'fuera de la escala: nada');
ok(Object.entries(FEELING_RPE).every(([k, v]) => k === 'fail' || rpeToFeeling(v) === k), 'las sesiones antiguas caen en su misma sensación');
ok(rpeLabel(7) === 'Muy duro' && rpeLabel(12) === '', 'palabra de cada número');
ok(sessionRpe({ rpe: 6 }) === 6 && sessionRpe({ feeling: 'ok' }) === 5 && sessionRpe({}) === null, 'esfuerzo de una sesión');

// 4 · El margen aprendido usa el número exacto
{
  const NOW = Date.parse('2026-03-14T07:00:00Z');
  const s = (rpe, feeling, ago) => ({ startedAt: new Date(NOW - ago * 864e5).toISOString(), feeling, rpe, rpeScale: 10, hrZones: { z4: 600 } });
  ok(effortTolerance([s(4, 'ok', 2), s(4, 'ok', 5)], { now: NOW }).ppm === 4, 'dos «4» con pulso alto: +4');
  ok(effortTolerance([s(8, 'hard', 2), s(4, 'ok', 5)], { now: NOW }).ppm === 0, 'un «8» resta: 1 − 1 = 0');
  ok(effortTolerance([s(5, 'ok', 5), s(7, 'hard', 2)], { now: NOW }).ppm === 2, 'un «7» es neutro');
  ok(effortTolerance([s(3, 'easy', 5), s(5, 'ok', 2)], { now: NOW }).ppm === 6, 'escala: un 3 y un 5 → +6');
  const old = (rpe, feeling, ago) => ({ startedAt: new Date(NOW - ago * 864e5).toISOString(), feeling, rpe, hrZones: { z4: 600 } });
  ok(effortTolerance([old(5, 'ok', 2), old(5, 'ok', 5)], { now: NOW }).ppm === 4 && effortTolerance([old(7, 'ok', 2)], { now: NOW }).ppm === 2, 'sesiones de antes (sin rpeScale): manda su cara, no el número');
  ok(effortTolerance([{ ...s(7, 'hard', 2), checkins: [[600, 'fast', 'up', 160], [900, 'run', 'up', 158]] }], { now: NOW }).ppm === 4, 'un «7» con dos «Sobrado» en clase: +4');
  ok(effortTolerance([{ ...s(4, 'ok', 2), checkins: [[600, 'fast', 'down', 172]] }], { now: NOW }).ppm === 0, 'un «Al límite» en clase quita el margen de ese día');
  ok(effortTolerance([{ ...s(5, 'ok', 2), checkins: [[1, 'run', 'up'], [2, 'run', 'up'], [3, 'run', 'up'], [4, 'run', 'up']] }], { now: NOW }).ppm === 6, 'los «Sobrado» de una clase cuentan como mucho +2');
}

console.log(bad ? `✗ ${n - bad} OK, ${bad} fallos` : `✓ «¿Cómo vas?» y escala 1–10: ${n} comprobaciones`);
process.exit(bad ? 1 : 0);
