#!/usr/bin/env node
// RITMUP · pruebas del modelo de tu pulso y sus decisiones (js/training/hr-dynamics.js, hr-control.js).
// node tools/test-hr-dynamics.mjs
import {
  classInputs, fitHrDynamics, simulate, equilibrium, createTracker, hrAfter, speedForHr, HR_DT,
} from '../js/training/hr-dynamics.js';
import { calibrateClass, nextSpeed, liveSpeed, pulseTrend, dynModelFrom } from '../js/training/hr-control.js';

let n = 0;
let bad = 0;
const ok = (c, msg) => { n++; if (!c) { bad++; console.log(`  ✗ ${msg}`); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// Un corredor de mentira con parámetros conocidos
const TRUE = { b: 9.5, c: 4, d: 0.35, tauUp: 75, tauDown: 90 };
let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
function fakeClass(id, a, plan) {
  // plan: [[seg, km/h, incl]] → sesión con speedTrace y hrSeries cada 10 s (ruido ±1,5)
  const speedTrace = [];
  let t = 0;
  const segs = [];
  for (const [sec, v, g] of plan) { speedTrace.push([t, v]); segs.push({ sec, speed: v, incline: g, zone: 'jog' }); t += sec; speedTrace.push([t, v]); }
  const sess = { id, speedTrace, elapsedSec: t, hrSeries: [] };
  const flat = [];
  for (let x = 0; x <= t; x += 10) flat.push([x, 95]);
  const inp = classInputs({ ...sess, hrSeries: flat }, segs);
  const sim = simulate(TRUE, a, inp, 95);
  for (let k = 0; k < inp.t.length; k += 2) sess.hrSeries.push([inp.t[k], Math.round(sim[k] + rnd() * 3)]);
  return { sess, segs };
}
const plans = [
  [[120, 7.5, 0], [600, 9, 0], [120, 11, 0], [120, 9.5, 0], [120, 11, 0], [300, 8.5, 0], [120, 7, 0]],
  [[180, 8, 0], [900, 9.2, 0], [300, 10.3, 0], [300, 8.8, 0]],
  [[120, 7.5, 0], [240, 6.3, 4], [120, 8.6, 1], [240, 6.3, 6], [240, 8.5, 0]],
  [[240, 8.3, 0], [1200, 9, 0], [600, 10, 0], [180, 7.5, 0]],
  [[120, 8, 0], [60, 12, 0], [90, 9, 0], [60, 12, 0], [90, 9, 0], [60, 12.5, 0], [90, 9, 0], [600, 9.4, 0]],
];
const days = [44, 47, 42, 50, 45];
const fakes = plans.map((p, i) => fakeClass(`c${i}`, days[i], p));
const cls = fakes.map((f) => ({ id: f.sess.id, inp: classInputs(f.sess, f.segs) }));

// 1 · El ajuste recupera los parámetros
const m = fitHrDynamics(cls);
ok(m && near(m.b, TRUE.b, 1.2), `pendiente ≈ 9,5 ppm por km/h (${m?.b?.toFixed(2)})`);
ok(m && near(m.d, TRUE.d, 0.2), `carga acumulada ≈ 0,35 (${m?.d?.toFixed(3)})`);
ok(m && near(m.tauUp, TRUE.tauUp, 30) && near(m.tauDown, TRUE.tauDown, 30), `tiempos de respuesta ≈ 75/90 s (${m?.tauUp}/${m?.tauDown})`);
ok(m && m.rmse < 3, `error de ajuste pequeño (${m?.rmse?.toFixed(2)} ppm)`);
ok(m && Object.keys(m.a).length === 5 && near(m.a.c3, 50, 4), `el a de cada día (${m?.a?.c3?.toFixed(1)} frente a 50)`);
ok(fitHrDynamics(cls.slice(0, 1)) === null, 'con una sola clase no hay modelo');

// 2 · Seguimiento: aprende el día (corredor a 52 cuando lo típico es 45)
{
  const model = { ...TRUE, aTypical: 45 };
  const { sess, segs } = fakeClass('hoy', 52, [[120, 7.5, 0], [900, 9, 0]]);
  const inp = classInputs(sess, segs);
  const tr = createTracker(model);
  for (let k = 0; k < inp.t.length; k++) tr.step(inp.t[k], inp.v[k], inp.g[k], inp.load[k], inp.hr[k]);
  ok(near(tr.a, 52, 2.5), `aprende tu día: a ≈ 52 (${tr.a.toFixed(1)})`);
}

// 3 · speedForHr deshace hrAfter
{
  const model = { ...TRUE, aTypical: 45 };
  const v = speedForHr(model, 45, 130, 240, 140, 0, 0);
  ok(near(hrAfter(model, 45, 130, 240, v, 0, 0), 140, 1.2), `la velocidad que pide deja el pulso donde dice (${v} km/h)`);
  ok(near(equilibrium(model, 45, 10, 2, 5), 45 + 95 + 8 + 1.75, 1e-9), 'equilibrio = a + b·v + c·incl + d·carga');
}

const model = { ...TRUE, aTypical: 45 };
const z2 = { min: 132, max: 143 };
const z3 = { min: 143, max: 154 };
const z4 = { min: 154, max: 165 };
const tgt = (s) => ({ jog: z2, run: z3, fast: z4 }[s.zone] || { min: 120, max: 131 });

// 4 · Antes de la clase: solo tramos largos de trabajo, −0,6 / +0,3 como mucho
{
  const segs = [
    { zone: 'warmup', speed: 7.5, sec: 240 }, { zone: 'jog', speed: 8, sec: 900 }, { zone: 'fast', speed: 11.5, sec: 120 },
    { zone: 'run', speed: 11.5, sec: 600 }, { zone: 'cooldown', speed: 7, sec: 180 },
  ];
  const r = calibrateClass(model, 45, segs, tgt);
  ok(r.segments[0].speed === 7.5 && r.segments[4].speed === 7 && r.segments[2].speed === 11.5, 'calentar, calma y arreones cortos no cambian');
  ok(r.segments[1].speed > 8 && r.segments[1].speed <= 8.3 + 1e-9, `trote lento para tu zona: sube, como mucho +0,3 (${r.segments[1].speed})`);
  ok(r.segments[3].speed < 11.5 && r.segments[3].speed >= 10.9 - 1e-9, `correr demasiado rápido para tu zona: baja, como mucho −0,6 (${r.segments[3].speed})`);
  ok(segs[1].speed === 8, 'no muta la clase de entrada');
}

// 5 · Antes de cada tramo
{
  const v = nextSpeed(model, 45, { cur: { zone: 'fast', speed: 11 }, next: { zone: 'run', speed: 10.5, sec: 120 }, hrEnd: 166, load: 40, target: z3 });
  ok(v != null && v < 10.5 && v >= 9.7 - 1e-9, `llegas a 166 a una recuperación en Z3: más suave, hasta −0,8 (${v})`);
  ok(nextSpeed(model, 45, { cur: { zone: 'fast', speed: 11 }, next: { zone: 'run', speed: 9.9, sec: 120 }, hrEnd: 148, load: 0, target: z3 }) === null, 'si la recuperación te deja en zona, no se toca');
  ok(nextSpeed(model, 45, { cur: { zone: 'jog', speed: 9 }, next: { zone: 'fast', speed: 11, sec: 90 }, hrEnd: 120, load: 0, target: z4 }) === null, 'un arreón corto nunca se sube por pulso');
  const up = nextSpeed(model, 45, { cur: { zone: 'warmup', speed: 8 }, next: { zone: 'jog', speed: 8.2, sec: 600 }, hrEnd: 115, load: 0, target: z2 });
  ok(up != null && up > 8.2 && up <= 8.7 + 1e-9, `tramo largo que te dejaría bajo: sube, como mucho +0,5 (${up})`);
}

// 6 · En el tramo
{
  const hot = liveSpeed(model, 45, { seg: { zone: 'jog', sec: 600 }, hrNow: 145, remaining: 300, speed: 10.5, load: 10, target: z2 });
  ok(hot && hot.speed < 10.5 && hot.speed >= 10 - 1e-9, `vas a acabar alto: baja, como mucho −0,5 (${hot?.speed}, pred ${hot?.predicted})`);
  ok(liveSpeed(model, 45, { seg: { zone: 'fast', sec: 120 }, hrNow: 140, remaining: 60, speed: 11, load: 0, target: z4 }) === null, 'arreón corto por debajo: no sube');
  ok(liveSpeed(model, 45, { seg: { zone: 'jog', sec: 600 }, hrNow: 136, remaining: 300, speed: 9.2, load: 0, target: z2 }) === null, 'en zona y quedándose: nada');
}

// 7 · Pantalla: por debajo pero llegando → «Subiendo»
{
  const t = pulseTrend(model, 45, { hrNow: 120, remaining: 240, speed: 9.5, load: 0, target: z2 });
  ok(t.st === 'rising' && t.predicted >= 132, `«Subiendo» si va a llegar (${t.st}, ~${t.predicted})`);
  ok(pulseTrend(model, 45, { hrNow: 120, remaining: 240, speed: 8, load: 0, target: z2 }).st === 'low', '«Bajo» si no va a llegar');
  ok(pulseTrend(null, 45, { hrNow: 120, remaining: 240, speed: 8, target: z2 }).st === 'low', 'sin modelo, como siempre');
}

// 8 · Modelo desde el historial (con caché)
{
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const hist = fakes.map((f, i) => ({ ...f.sess, startedAt: new Date(Date.now() - (5 - i) * 86400000).toISOString() }));
  const segsOf = new Map(fakes.map((f) => [f.sess.id, f.segs]));
  const m1 = dynModelFrom(hist, (h) => segsOf.get(h.id), { storage });
  ok(m1 && near(m1.b, TRUE.b, 1.2) && store.size === 1, 'modelo desde el historial y guardado en caché');
  const m2 = dynModelFrom(hist, () => { throw new Error('no debería recalcular'); }, { storage });
  ok(m2 && m2.b === m1.b, 'sin clases nuevas, sale de la caché');
  ok(dynModelFrom(hist.slice(0, 1), null, { storage: null }) === null, 'una clase: sin modelo');
}

// 9 · Día alto: se detecta a los 3 min, anticipa que el exceso crece y baja también las rampas cortas
{
  const m9 = { ...TRUE, aTypical: 45 };
  const feed = (excess, secs = 420) => {
    const tr = createTracker(m9);
    let hr = 110, load = 0;
    for (let t = 0; t <= secs; t += 5) {
      const v = 9, x = equilibrium(m9, 45 + excess, v, 0, load);
      hr += (x - hr) * (1 - Math.exp(-5 / (x > hr ? m9.tauUp : m9.tauDown)));
      tr.step(t, v, 0, load, hr);
    }
    return tr;
  };
  const normal = feed(3);
  ok(!normal.highDay && normal.forecastA === normal.a, 'un día normal (+3) no es día alto: se decide con el a de siempre');
  const early = feed(9, 120);
  ok(!early.highDay, 'antes de los 3 min nunca es día alto');
  const high = feed(9);
  ok(high.highDay, 'a +9 sostenido, día alto');
  ok(high.forecastA > high.a && high.forecastA <= 45 + 15 + 1e-9, `anticipa que crecerá, sin pasar de +15 (${high.forecastA.toFixed(1)})`);
  const a = 45 + 12;
  const hill = { zone: 'fast', speed: 9.5, sec: 60, incline: 5 };
  const run = { zone: 'run', speed: 9.5 };
  const hv = nextSpeed(m9, a, { cur: run, next: hill, hrEnd: 150, load: 0, target: z4, highDay: true });
  ok(hv != null && hv < 9.5 && hv >= 8.7 - 1e-9, `día alto: la rampa corta baja, como mucho −0,8 (${hv})`);
  ok(nextSpeed(m9, a, { cur: run, next: hill, hrEnd: 150, load: 0, target: z4 }) === null, 'sin día alto la rampa no se toca si no te pasas');
  ok(nextSpeed(m9, a, { cur: run, next: { ...hill, incline: 0 }, hrEnd: 120, load: 0, target: z4, highDay: true }) === null, 'un arreón llano se define por velocidad: no baja por día alto');
}

console.log(bad ? `✗ ${n - bad} OK, ${bad} fallos` : `✓ modelo de tu pulso: ${n} comprobaciones`);
process.exit(bad ? 1 : 0);
