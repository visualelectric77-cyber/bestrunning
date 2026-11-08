#!/usr/bin/env node
// RITMUP · «Tu clase» (class-debrief.js) y la propuesta de aligerar lo que viene. node tools/test-class-debrief.mjs
import { classDebrief, wantsEasierNext } from '../js/training/class-debrief.js';
import { easierNext, setDayOverride, planDay } from '../js/training/planner.js';
import { defaultState } from '../js/core/store.js';
import { addDays } from '../js/core/utils.js';

let n = 0;
let bad = 0;
const ok = (c, msg) => { n++; if (!c) { bad++; console.log(`  ✗ ${msg}`); } };

const profile = { hrMax: 176, hrRest: 65 };
const segments = [{ zone: 'warmup', speed: 8, sec: 120 }, { zone: 'run', speed: 10, sec: 900 }, { zone: 'cooldown', speed: 7, sec: 180 }];
const trace = (v = 10) => [[0, 8], [120, 8], [120, v], [1020, v], [1020, 7], [1200, 7]];
const model = { b: 9.9, c: 4, d: 0, tauUp: 90, tauDown: 110, aTypical: 47 };
function session(excess, { v = 10, feeling = 'ok', extra = {} } = {}) {
  const hrSeries = [];
  let hr = 100;
  for (let t = 0; t < 1200; t += 10) {
    const sp = t < 120 ? 8 : t < 1020 ? v : 7;
    const x = 47 + excess + 9.9 * sp;
    hr += (x - hr) * (1 - Math.exp(-10 / (x > hr ? 90 : 110)));
    hrSeries.push([t, Math.round(hr)]);
  }
  return { id: 's', dayKey: '2026-11-08', elapsedSec: 1200, completionPct: 1, distanceKm: 3, avgSpeed: 9.5, feeling, speedTrace: trace(v), hrSeries, hrMax: Math.max(...hrSeries.map((p) => p[1])), levelChanges: [], ...extra };
}
const run = (s, m = model) => classDebrief(s, { segments, model: m, profile });

const high = run(session(12, { v: 9.5 }));
ok(high.kind === 'high' && /por encima de lo normal/.test(high.body), `día alto: ${high.headline}`);
ok(/no cambian/.test(high.tip), 'día alto: tus velocidades no cambian');
ok(/0,5 km\/h por debajo de lo previsto/.test(high.body), `cuenta cuánto bajó la velocidad: ${high.body}`);
ok(!/undefined|NaN/.test(`${high.headline}${high.body}${high.tip}`), 'sin valores vacíos');

const low = run(session(-10));
ok(low.kind === 'low' && /por debajo de lo normal/.test(low.body), 'día con margen');
const normal = run(session(0));
ok(normal.kind !== 'high' && normal.kind !== 'low', `día normal: ${normal.kind}`);
ok(/% del trabajo en tu zona/.test(normal.body), 'dice el tiempo en zona');

const down = run(session(12, { extra: { levelChanges: [{ level: 'run', from: 10, to: 9.8 }] } }));
ok(!/no cambian/.test(down.tip) && /suavizado/.test(down.tip), 'nunca dice «no cambian» si han bajado');
ok(/subido/.test(run(session(0, { extra: { levelChanges: [{ level: 'run', from: 10, to: 10.2 }] } })).tip), 'si has subido, lo dice');

const noModel = run(session(12), null);
ok(noModel.kind !== 'high' && !/lo normal en ti/.test(noModel.body), 'sin modelo no afirma nada de tu día');
const noHr = classDebrief({ ...session(0, { feeling: 'hard' }), hrSeries: null }, { segments, profile });
ok(noHr.kind === 'nohr' && /km/.test(noHr.body), 'sin reloj también hay resumen');
ok(classDebrief({ isTest: true }, {}) === null, 'el test VAM tiene su propia tarjeta');

ok(wantsEasierNext(high, session(12)), 'tras un día alto, propone');
ok(wantsEasierNext(normal, session(0, { feeling: 'hard' })), 'tras una clase dura, propone');
ok(!wantsEasierNext(normal, session(0)), 'tras una clase normal, no propone');

// La propuesta sobre el plan real
const st = defaultState();
st.onboarded = true;
st.plan = { ...st.plan, startDate: '2026-11-02', overrides: {} };
st.levels = { jog: 8.9, run: 10.3, fast: 11.6, sprint: 13 };
let found = 0;
let date0 = '2026-11-02';
for (let i = 0; i < 60; i++) {
  const d = addDays(date0, i);
  const g = easierNext(st, d);
  if (!g) continue;
  found++;
  const dr = JSON.parse(JSON.stringify(st));
  setDayOverride(dr, g.date, { templateId: g.to, minutes: g.minutes });
  const p = planDay(dr, g.date);
  ok(p?.templateId === g.to && p.minutes === g.minutes, `al aceptar, ${g.date} pasa a ${g.toTitle}`);
  ok(g.to !== g.from, 'la alternativa es otra clase');
}
ok(found > 5, `propone en días con clase exigente cerca (${found})`);
const blocked = JSON.parse(JSON.stringify(st));
const d1 = addDays(date0, 1);
setDayOverride(blocked, d1, { rest: true });
ok(easierNext(blocked, date0) === null, 'si mañana descansas, no propone');
setDayOverride(blocked, d1, { templateId: 'test-vam', minutes: 20, rest: false });
ok(easierNext(blocked, date0) === null, 'un test VAM no se cambia');

console.log(bad ? `✗ ${n - bad} OK, ${bad} fallos` : `✓ tu clase: ${n} comprobaciones`);
process.exit(bad ? 1 : 0);
