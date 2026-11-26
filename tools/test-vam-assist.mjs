#!/usr/bin/env node
// RITMUP · pruebas del test VAM asistido (js/training/vam-assist.js). node tools/test-vam-assist.mjs
import { createVamAssist, vamPreCheck, vamValidity, vamHoldsLevels, VAM_TEXT } from '../js/training/vam-assist.js';
import { applyFeedback } from '../js/training/progression.js';
import { defaultState } from '../js/core/store.js';

let n = 0;
let bad = 0;
const ok = (c, msg) => { n++; if (!c) { bad++; console.log(`  ✗ ${msg}`); } };

// pulso(t) durante los escalones, una lectura cada 5 s → última salida y avisos
function run(hrOf, secs = 480, hrMax = 176) {
  const a = createVamAssist({ hrMax });
  const cues = [];
  const sts = new Set();
  let last = null;
  for (let t = 0; t <= secs; t += 1) {
    const stage = Math.floor(t / 60) + 1;
    last = a.step(t, t % 5 === 0 ? hrOf(t) : null, stage);
    sts.add(last.st);
    if (last.cue) cues.push(last.cue);
  }
  return { last, cues, sts, a };
}

// 1 · Sube sano, sin llegar al tope: «con margen»
{
  const r = run((t) => 120 + t * 0.05, 300);
  ok(r.last.st === 'margin' && r.cues.filter((c) => c === 'margin').length === 1, 'con margen: lo dice una sola vez');
  ok(!r.sts.has('over') && !r.sts.has('odd') && !r.sts.has('plateau'), 'sin falsas alarmas');
}
// 2 · Cerca del máximo, subiendo
{
  const r = run((t) => 150 + t * 0.06, 340);
  ok(r.sts.has('near') && r.cues.includes('near'), 'cerca de tu máximo');
  ok(!r.a.plateau, 'mientras sube no hay meseta');
}
// 3 · Meseta: el pulso se para aunque suba la velocidad
{
  const r = run((t) => Math.min(170, 130 + t * 0.2), 420);
  ok(r.a.plateau && r.last.st === 'plateau' && r.cues.includes('plateau'), 'meseta: «ya no sube»');
}
ok((() => { const r = run((t) => Math.min(140, 110 + t * 0.3), 420); return !r.a.plateau; })(), 'estable lejos del máximo no es meseta');
// 4 · Por encima de tu máximo, sostenido
{
  const r = run((t) => (t > 200 ? 184 : 160), 300);
  ok(r.sts.has('over') && r.cues.includes('over'), 'por encima del máximo +5 sostenido avisa');
  const blip = run((t) => (t > 200 && t < 212 ? 184 : 160), 300);
  ok(!blip.sts.has('over'), 'un pico de 10 s no avisa');
}
// 5 · Caída brusca a pulso alto
{
  const r = run((t) => (t > 240 ? 140 : 165), 300);
  ok(r.sts.has('odd') && r.cues.includes('odd'), 'caída de golpe avisa');
  const slow = run((t) => 120 - (t > 240 ? 20 : 0), 300);
  ok(!slow.sts.has('odd'), 'a pulso bajo, una caída no avisa');
}
// 6 · Sin lecturas
{
  const a = createVamAssist({ hrMax: 176 });
  ok(a.step(10, null, 1).st === 'wait', 'sin reloj: esperando');
  ok(Object.keys(VAM_TEXT).length === 6, 'cada estado tiene su texto');
}
// 7 · Antes del test
ok(vamPreCheck([{ dayKey: '2026-11-25', elapsedSec: 2700, feeling: 'ok' }], '2026-11-26').hardYesterday, 'clase larga ayer: aviso');
ok(vamPreCheck([{ dayKey: '2026-11-25', elapsedSec: 1200, feeling: 'hard' }], '2026-11-26').hardYesterday, 'clase dura ayer: aviso');
ok(!vamPreCheck([{ dayKey: '2026-11-25', elapsedSec: 1200, feeling: 'ok' }], '2026-11-26').hardYesterday, 'clase suave ayer: sin aviso');
ok(!vamPreCheck([{ dayKey: '2026-11-24', elapsedSec: 2700, feeling: 'hard' }], '2026-11-26').hardYesterday, 'anteayer no cuenta');

// 8 · Validez
const session = (peak, { stage = 8, secs = 30, assist = {}, flat = false, timeline = [] } = {}) => {
  const stageStart = 300;
  const hrSeries = [];
  const end = stageStart + (stage - 1) * 60 + secs;
  for (let t = 0; t <= end + 60; t += 5) {
    const r = Math.min(1, (t - stageStart + 200) / (end - stageStart + 200));
    hrSeries.push([t, Math.round(flat ? Math.min(peak, 110 + t * 0.2) : t <= end ? 100 + (peak - 100) * Math.max(0, r) : peak - 8)]);
  }
  return { isTest: true, hrSeries, timeline, test: { stage, secondsInLastStage: secs, lastStageSpeed: 12, vam: 12.3 }, vamAssist: { stageStart, ...assist } };
};
ok(vamValidity(session(170), { hrMax: 176 }).verdict === 'valid', 'llega al 96 %: válido');
ok(vamValidity(session(150), { hrMax: 176 }).verdict === 'doubtful', 'se queda en el 85 %: dudoso');
ok(vamValidity(session(160, { flat: true }), { hrMax: 176 }).verdict === 'valid', '91 % con meseta: válido');
ok(vamValidity(session(170, { stage: 3 }), { hrMax: 176 }).reasons.some((r) => r.includes('escalones')), 'menos de 4 escalones: dudoso');
ok(vamValidity(session(170, { timeline: [[1, 500, 0], [2, 500, 1]] }), { hrMax: 176 }).reasons.some((r) => r.includes('pausa')), 'pausa en los escalones: dudoso');
ok(vamValidity(session(170, { assist: { dayHigh: true } }), { hrMax: 176, prevDelta: -0.4 }).verdict === 'doubtful', 'día alto y baja: dudoso');
ok(vamValidity(session(170, { assist: { dayHigh: true } }), { hrMax: 176, prevDelta: 0.3 }).verdict === 'valid', 'día alto pero mejora: válido');
ok(vamValidity({ isTest: true, test: { stage: 8 } }, { hrMax: 176 }).verdict === 'unknown', 'test antiguo: no se juzga');
ok(vamValidity({ ...session(170), hrSeries: [] }, { hrMax: 176 }).verdict === 'unknown', 'sin pulso: no se juzga');
{
  const s = session(165, { flat: true });
  const v = vamValidity(s, { hrMax: 176 });
  ok(v.verdict === 'valid' && v.plateau && v.suggestHrMax === v.peak, `meseta válida bajo tu máximo: propone FC máx ${v.suggestHrMax}`);
  const spike = session(170);
  spike.hrSeries[spike.hrSeries.length - 20][1] = 215;
  ok(vamValidity(spike, { hrMax: 176 }).peak < 200, 'un pico suelto del sensor no cuenta');
}

// 8b · Sesiones guardadas sin el escalón (todas las de antes del 26 nov 2026): se deduce del trazado de velocidad.
// Caso real del 26 nov: 10 escalones completos (hasta 13,3) y «No puedo más» 1 s después de empezar el de 13,8; el
// resumen decía «Sin pulso del reloj» aunque había 105 lecturas.
{
  const traceFor = (stages, secs) => {
    const tr = [[0, 7.9], [300, 8.8]];
    for (let k = 1; k < stages; k++) tr.push([300 + k * 60, 8.8 + 0.5 * k]);
    const end = 300 + (stages - 1) * 60 + secs;
    tr.push([end + 540, 8.8 + 0.5 * (stages - 1)], [end + 540, 8.3]);
    return tr;
  };
  const real = session(174, { stage: 11, secs: 1 });
  const { stage: _drop, ...noStage } = real.test;
  const old = { ...real, test: noStage, speedTrace: traceFor(11, 1) };
  const vOld = vamValidity(old, { hrMax: 178 });
  const vNew = vamValidity(real, { hrMax: 178 });
  ok(vOld.verdict === 'valid', `sin escalón guardado, con pulso: válido (era «sin pulso»): ${vOld.verdict}`);
  ok(vOld.stages === 10 && vOld.stages === vNew.stages, `10 escalones completos, como con el escalón guardado (${vOld.stages})`);
  ok(vOld.peak === vNew.peak, 'mismo pico que con el escalón guardado');
  for (const [stages, secs] of [[5, 30], [8, 59], [12, 10], [4, 45]]) {
    const r = session(170, { stage: stages, secs });
    const { stage: _s, ...ns } = r.test;
    const a1 = vamValidity({ ...r, test: ns, speedTrace: traceFor(stages, secs) }, { hrMax: 176 });
    const a2 = vamValidity(r, { hrMax: 176 });
    ok(a1.verdict === a2.verdict && a1.stages === a2.stages && a1.peak === a2.peak, `escalón ${stages} (+${secs} s): igual con y sin escalón guardado`);
  }
  ok(vamValidity({ ...old, speedTrace: [] }, { hrMax: 178 }).verdict === 'unknown', 'sin escalón ni trazado: no se juzga');
  ok(vamValidity({ ...old, speedTrace: 'x' }, { hrMax: 178 }).verdict === 'unknown', 'trazado roto: no se juzga');
}

// 9 · Las velocidades
{
  const st = defaultState();
  st.profile = { ...st.profile, hrMax: 176, age: 46 };
  st.levels = { jog: 8.9, run: 10.3, fast: 11.6, sprint: 13 };
  const s = { ...session(150), id: 't1', dayKey: '2026-11-26', levelsAtStart: st.levels };
  const f0 = applyFeedback(st, s, { feeling: 'hard', rpe: 8 });
  ok(f0.changes.length === 0 && f0.levels.run === 10.3 && f0.message.includes('dudoso'), 'test dudoso: tus velocidades no cambian');
  const f1 = applyFeedback(st, { ...s, vamAssist: { ...s.vamAssist, applyAnyway: true } }, { feeling: 'hard', rpe: 8 });
  ok(f1.changes.length > 0 && f1.progression.lastTest?.vam > 0, 'si lo pides, se actualizan igualmente');
  const f2 = applyFeedback(st, { ...session(170), id: 't2', dayKey: '2026-11-26', levelsAtStart: st.levels }, { feeling: 'hard', rpe: 8 });
  ok(f2.progression.lastTest?.vam > 0, 'test válido: se aplica');
  const { vamAssist: _omit, ...old } = s;
  ok(applyFeedback(st, old, { feeling: 'hard', rpe: 8 }).progression.lastTest?.vam > 0, 'test sin asistencia: como siempre');
}

ok(vamHoldsLevels({ verdict: 'doubtful' }, {}) && !vamHoldsLevels({ verdict: 'doubtful' }, { vamAssist: { applyAnyway: true } }) && !vamHoldsLevels({ verdict: 'valid' }, {}) && !vamHoldsLevels({ verdict: 'unknown' }, {}), 'solo un dudoso sin permiso se queda sin aplicar');

console.log(bad ? `✗ ${n - bad} OK, ${bad} fallos` : `✓ test VAM asistido: ${n} comprobaciones`);
process.exit(bad ? 1 : 0);
