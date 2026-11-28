// RITMUP · pruebas del margen de pulso aprendido de tu sensación (js/training/effort-learn.js).
// Uso: node tools/test-effort-learn.mjs   (sale con código ≠ 0 si algo falla)
import { effortTolerance, driftAllowance, withEffortMargin, TOL_MAX } from '../js/training/effort-learn.js';
import { hrTargetForZone } from '../js/training/levels.js';
import { readinessTarget } from '../js/training/hr-shape.js';
import { liveSpeed } from '../js/training/hr-control.js';

let n = 0;
let bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error(`  ✗ ${m}`); } };

const NOW = Date.parse('2026-03-14T07:00:00Z');
const day = (d) => new Date(NOW - d * 864e5).toISOString();
/** Una clase: feeling, minutos en Z4–Z5, días atrás, recortes del modo pulso. */
const ses = (feeling, z4min, ago, extra = {}) => ({
  id: `s${ago}`, startedAt: day(ago), feeling, hrZones: { z1: 300, z2: 600, z3: 900, z4: z4min * 60, z5: 0 }, ...extra,
});

// 1 · Cuánto margen
{
  ok(effortTolerance([]).ppm === 0 && effortTolerance(null).ppm === 0 && effortTolerance('x').ppm === 0, 'sin historial: sin margen');
  const soft = [ses('ok', 9, 2), ses('ok', 11, 9)];
  ok(effortTolerance(soft, { now: NOW }).ppm === 4, 'dos clases duras por pulso marcadas «Cómodo»: +4 ppm');
  ok(effortTolerance([ses('easy', 9, 2), ses('easy', 8, 5), ses('easy', 10, 9)], { now: NOW }).ppm === TOL_MAX, 'muchas «Muy fácil» con pulso alto: tope de 8');
  ok(effortTolerance([ses('hard', 9, 2), ses('hard', 11, 9)], { now: NOW }).ppm === 0, 'las duras que marcas «Exigente»: coinciden, sin margen');
  ok(effortTolerance([ses('ok', 9, 9), ses('ok', 9, 7), ses('max', 9, 2)], { now: NOW }).ppm === 0, 'la última dura «Al límite»: sin margen aunque antes fueran cómodas');
  ok(effortTolerance([ses('ok', 9, 9), ses('ok', 9, 7), ses('fail', 9, 2)], { now: NOW }).ppm === 0, '«No pude»: sin margen');
  ok(effortTolerance([ses('ok', 9, 9), ses('max', 9, 7), ses('ok', 9, 2)], { now: NOW }).ppm === 0, 'un «Al límite» reciente pesa: 1 − 2 + 1 = 0');
  ok(effortTolerance([ses('ok', 2, 2), ses('easy', 0, 5)], { now: NOW }).n === 0, 'las clases suaves por pulso no cuentan');
  ok(effortTolerance([ses('ok', 2, 2, { hrCoachAdj: { run: -0.5 } })], { now: NOW }).ppm === 2, 'una clase en la que el modo pulso te recortó también cuenta');
  ok(effortTolerance([ses('ok', 9, 40), ses('ok', 9, 60)], { now: NOW }).n === 0, 'más de 35 días: no cuenta');
  ok(effortTolerance([ses('ok', 9, 2, { isTest: true })], { now: NOW }).n === 0, 'los tests no cuentan');
  ok(effortTolerance([ses(null, 9, 2), ses(undefined, 9, 3)], { now: NOW }).n === 0, 'sin sensación: no cuenta');
  const many = Array.from({ length: 12 }, (_, i) => ses(i < 4 ? 'hard' : 'ok', 9, i + 1));
  ok(effortTolerance(many, { now: NOW }).n === 8, 'solo las 8 más recientes');
  // Historial mezclado: la mitad de las duras por pulso, «Cómodo»; la otra mitad, «Exigente»
  const mixed = [ses('ok', 9, 21), ses('hard', 10, 20), ses('hard', 20, 16), ses('hard', 7, 14), ses('hard', 10, 13), ses('hard', 6, 9), ses('ok', 9, 7), ses('ok', 11, 0.1)];
  const t = effortTolerance(mixed, { now: NOW });
  ok(t.ppm > 0 && t.ppm <= TOL_MAX, `historial mezclado: algo de margen (${t.ppm} ppm)`);
}

// 2 · Deriva
ok(driftAllowance(0) === 0 && driftAllowance(25 * 60) === 0, 'deriva: nada en la primera media hora');
ok(driftAllowance(35 * 60) > 0 && driftAllowance(35 * 60) <= 3, 'deriva: poco a poco pasada la media hora');
ok(driftAllowance(90 * 60) === 6, 'deriva: como mucho 6 ppm');
ok(driftAllowance(NaN) === 0 && driftAllowance(-100) === 0, 'deriva: tiempo raro, nada');

// 3 · El techo de cada tramo
{
  const prof = { hrMax: 180, hrRest: 60, effort: 'hard' };
  const tol = { ppm: 6 };
  const run = hrTargetForZone('run', prof);
  const fast = hrTargetForZone('fast', prof);
  const jog = hrTargetForZone('jog', prof);
  const r1 = withEffortMargin(run, { zone: 'run', sec: 440 }, { tol, elapsedSec: 46 * 60, hrMax: 180 });
  ok(r1.max > run.max && r1.min === run.min && r1.learned === r1.max - run.max, `tempo a los 46′: techo ${run.max} → ${r1.max}, suelo igual`);
  ok(r1.max <= 180 - 8, 'tempo: nunca por encima de FC máx. − 8');
  const f1 = withEffortMargin(fast, { zone: 'fast', sec: 60 }, { tol: { ppm: 8 }, elapsedSec: 60 * 60, hrMax: 180 });
  ok(f1.max <= 180 - 2, `rápido: nunca por encima de FC máx. − 2 (${f1.max})`);
  ok(withEffortMargin(jog, { zone: 'jog', sec: 60 }, { tol, elapsedSec: 60 * 60, hrMax: 180 }) === jog, 'recuperación de 1 min: ni margen ni deriva');
  const rod = withEffortMargin(jog, { zone: 'jog', sec: 600 }, { tol, elapsedSec: 45 * 60, hrMax: 180 });
  ok(rod.max === jog.max + driftAllowance(45 * 60), 'rodaje largo: solo la deriva, no el margen de sensación');
  ok(withEffortMargin(run, { zone: 'run', sec: 440 }, { tol: { ppm: 0 }, elapsedSec: 10 * 60, hrMax: 180 }) === run, 'sin margen ni deriva: no cambia nada');
  const amber = readinessTarget(run, 'amber');
  const amberM = withEffortMargin(amber, { zone: 'run', sec: 440 }, { tol, elapsedSec: 46 * 60, hrMax: 180, baseMax: run.max });
  ok(amberM.max > amber.max && amberM.max <= run.max, `semáforo ámbar: el margen deshace el recorte (${amber.max} → ${amberM.max}) sin pasar del techo de un día verde (${run.max})`);
  // FC máxima estimada por la edad (sin hrMax en el perfil): solo la deriva, no el margen aprendido
  const est = withEffortMargin(run, { zone: 'run', sec: 440 }, { tol: { ppm: 8 }, elapsedSec: 10 * 60, hrMax: 180, hrMaxKnown: false });
  ok(est === run, 'FC máx. estimada, sin deriva: el margen aprendido no se aplica');
  const estD = withEffortMargin(run, { zone: 'run', sec: 440 }, { tol: { ppm: 8 }, elapsedSec: 50 * 60, hrMax: 180, hrMaxKnown: false });
  ok(estD.max === run.max + driftAllowance(50 * 60), 'FC máx. estimada, clase larga: solo la deriva');
  // Sin «Entreno exigente», la mitad del margen
  const soft = withEffortMargin(run, { zone: 'run', sec: 440 }, { tol: { ppm: 8 }, elapsedSec: 10 * 60, hrMax: 180, pushy: false });
  ok(soft.max === run.max + 4, `sin entreno exigente: +4 como mucho (${soft.max - run.max})`);
  const red = readinessTarget(run, 'red');
  ok(withEffortMargin(red, { zone: 'run', sec: 440 }, { tol, elapsedSec: 46 * 60, hrMax: 180 }) === red, 'semáforo rojo: sin margen');
  for (const z of ['warmup', 'cooldown', 'walk', 'sprint']) {
    const t = hrTargetForZone(z, prof);
    ok(withEffortMargin(t, { zone: z, sec: 300 }, { tol, elapsedSec: 50 * 60, hrMax: 180 }) === t, `${z}: no se toca`);
  }
  ok(withEffortMargin(null, { zone: 'run' }, { tol }) === null && withEffortMargin(run, null, { tol }) === run, 'entradas vacías: no rompe');
}

// 4 · Un tempo largo a los 46′ de clase, con el pulso en 157 y subiendo despacio. Antes recortaba; con el margen, no.
{
  const prof = { hrMax: 180, hrRest: 60, effort: 'hard' };
  const model = { b: 9, c: 2, d: 0.4, tauUp: 70, tauDown: 70, aTypical: 50 };
  const seg = { zone: 'run', sec: 440, speed: 10.8 };
  const run = hrTargetForZone('run', prof);
  // Semáforo en ámbar (antes, solo por la temperatura de muñeca): techo del tempo más bajo
  const amberRun = readinessTarget(run, 'amber');
  const o = { seg, hrNow: 157, remaining: 280, speed: 10.3, load: 60, minSpeed: 1, maxSpeed: 18, base: 10.3 };
  const aDay = 50;                                   // con este «a», el modelo prevé ~165 en 4 min a 10,3
  const before = liveSpeed(model, aDay, { ...o, target: amberRun });
  const t2 = withEffortMargin(run, seg, { tol: { ppm: 6 }, elapsedSec: 46 * 60, hrMax: 180 });
  const after = liveSpeed(model, aDay, { ...o, target: t2 });
  ok(before && before.speed < 10.3, `antes (ámbar, sin margen): a los 46′ recortaba (${before?.speed})`);
  ok(after === null, `ahora (verde + margen, techo ${t2.max}): sigue a su velocidad`);
  // Y si el pulso va camino de su máximo de verdad, sigue bajando
  const hot = liveSpeed(model, 60, { ...o, hrNow: 168, target: t2 });
  ok(hot && hot.speed < 10.3, `si va camino de su máximo (prevé ${hot?.predicted}), baja igual`);
}

console.log(bad ? `✗ ${n - bad} OK, ${bad} fallos` : `✓ margen de pulso aprendido: ${n} comprobaciones`);
process.exit(bad ? 1 : 0);
