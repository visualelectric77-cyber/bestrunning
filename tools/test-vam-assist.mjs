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
