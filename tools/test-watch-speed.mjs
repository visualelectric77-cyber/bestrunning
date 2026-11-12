// RITMUP · tests del ritmo que calcula el Apple Watch (js/training/watch-speed.js): saneado de lecturas, margen clase/reloj,
// aviso de desvío (20 s, 0,5 km/h), lo que se guarda en la sesión y la corrección personal que se aprende con las clases.
// Uso: node tools/test-watch-speed.mjs   (sale con código ≠ 0 si algo falla)
import {
  cleanSpeed, tolerance, speedStatus, calFactor, learnFactor, driftText, createSpeedTracker, createSpeedSim,
  DRIFT_KMH, DRIFT_SEC, SETTLE_SEC, FACTOR_MIN, FACTOR_MAX,
} from '../js/training/watch-speed.js';

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
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/**
 * Corre `sec` segundos de clase a `appKmh` con la cinta puesta a `beltKmh` y un reloj que mide `bias` veces lo real,
 * con el retraso de una estimación de verdad. Devuelve los avisos que salen. `S` lleva el reloj y las distancias.
 */
function run(tr, S, { sec, appKmh, beltKmh = appKmh, bias = 1, running = true, every = 3 }) {
  const alerts = [];
  for (let i = 0; i < sec; i++) {
    S.t += 1000;
    if (running) {
      S.appKm += appKmh / 3600;
      const target = beltKmh * bias;
      S.v = S.v == null ? target : S.v + (target - S.v) * (1 - Math.exp(-1 / 6));
      S.watchKm += S.v / 3600;
    }
    const ctx = { t: S.t, appKmh, appKm: S.appKm, running };
    tr.tick(ctx);
    if (running && i % every === every - 1) {
      tr.add(cleanSpeed({ kmh: S.v, km: S.watchKm, cadence: 165, at: S.t, source: 'watch' }), ctx);
      const d = tr.drift();
      if (d) alerts.push({ ...d, at: S.t });
    }
  }
  return alerts;
}
const fresh = () => ({ t: 1_762_927_200_000, appKm: 0, watchKm: 0, v: null });

section('Lecturas: saneado', () => {
  ok(JSON.stringify(cleanSpeed({ kmh: 10.34, km: 3.9421, cadence: 167.6, at: 1000.4, source: 'watch' }))
    === JSON.stringify({ kmh: 10.3, km: 3.942, cadence: 168, at: 1000, source: 'watch' }), 'redondeos: km/h a 1 decimal, km a 3, cadencia entera');
  ok(cleanSpeed({ km: 0.2, at: 5 }).kmh === null && cleanSpeed({ km: 0.2, at: 5 }).cadence === null, 'parado: sin km/h ni cadencia, pero vale');
  ok(cleanSpeed({ kmh: 72, km: 1, cadence: 400, at: 5 }).kmh === null && cleanSpeed({ kmh: 72, km: 1, cadence: 400, at: 5 }).cadence === null,
    'cifras imposibles (72 km/h, 400 pasos/min): fuera, queda la distancia');
  ok(cleanSpeed(null) === null && cleanSpeed({ kmh: 10, at: 5 }) === null && cleanSpeed({ km: -1, at: 5 }) === null
    && cleanSpeed({ km: 1 }) === null && cleanSpeed({ km: '1', at: 5 }) === null, 'sin km, km negativo o sin hora: no vale');
});

section('Margen clase / reloj', () => {
  ok(tolerance(10.9, true) === DRIFT_KMH && near(tolerance(10.9, false), 0.872) && tolerance(5, false) === 0.5,
    'con corrección aprendida 0,5; sin ella, 0,5 o el 8 % de la velocidad');
  ok(speedStatus(10.9, 10.3, true) === -1 && speedStatus(10.9, 10.3, false) === 0, '10,9 frente a 10,3: desviado solo con la corrección ya aprendida');
  ok(speedStatus(10, 10.4, true) === 0 && speedStatus(10, 10.6, true) === 1 && speedStatus(10, 9.4, true) === -1, 'por encima, por debajo, en su sitio');
  ok(driftText(10.9, 10.31) === 'La app marca 10,9 y el Watch calcula unos 10,3: ¿has cambiado la cinta?', `texto del aviso (${driftText(10.9, 10.31)})`);
});

section('Aviso de desvío: 20 s o más, 0,5 km/h o más, con la velocidad ya estable', () => {
  // Cinta 0,6 por debajo, corrección aprendida: avisa una vez, pasados el asentamiento (20 s) y 20 s desviado
  const tr = createSpeedTracker({ factor: 1 });
  const S = fresh();
  const a = run(tr, S, { sec: 180, appKmh: 10.9, beltKmh: 10.3 });
  ok(a.length === 1, `un solo aviso en el mismo tramo (${a.length})`);
  const after = (a[0]?.at - fresh().t) / 1000;
  ok(after >= SETTLE_SEC + DRIFT_SEC && after <= SETTLE_SEC + DRIFT_SEC + 8, `sale a los ~40 s del cambio, no antes (${after} s)`);
  ok(a[0]?.app === 10.9 && a[0]?.watch === 10.3 && a[0]?.text === driftText(10.9, 10.3), `dice las dos cifras (${JSON.stringify(a[0])})`);
  ok(tr.view(S.t).off === true && tr.view(S.t).dev === -0.6, 'el chip queda marcado como desviado (−0,6)');
  // Otro tramo, también desviado: vuelve a avisar, pero no antes de 2 min del anterior
  const b = run(tr, S, { sec: 200, appKmh: 12, beltKmh: 11.2 });
  ok(b.length === 1 && b[0].app === 12, `tramo nuevo desviado: otro aviso (${b.length})`);
  // Vuelve a su sitio: el chip deja de estar desviado
  run(tr, S, { sec: 90, appKmh: 10, beltKmh: 10 });
  ok(tr.view(S.t).off === false && tr.view(S.t).kmh === 10, `en su sitio: sin marca (${JSON.stringify(tr.view(S.t))})`);
});

section('Sin falsas alarmas', () => {
  // Clase de intervalos bien seguida: 60 s a 13, 60 s a 8, seis veces. El reloj va con retraso en cada cambio.
  const tr = createSpeedTracker({ factor: 1 });
  const S = fresh();
  let alerts = 0;
  for (let i = 0; i < 6; i++) {
    alerts += run(tr, S, { sec: 60, appKmh: 13 }).length;
    alerts += run(tr, S, { sec: 60, appKmh: 8 }).length;
  }
  ok(alerts === 0, `intervalos bien seguidos: ningún aviso (${alerts})`);
  // Desvío de 0,4: por debajo del umbral
  const tr2 = createSpeedTracker({ factor: 1 });
  ok(run(tr2, fresh(), { sec: 300, appKmh: 10, beltKmh: 9.6 }).length === 0, 'desvío de 0,4 km/h: no es noticia');
  // Sin corrección aprendida, el sesgo de serie del reloj (4 %) no dispara nada a 12 km/h…
  const tr3 = createSpeedTracker();
  ok(run(tr3, fresh(), { sec: 300, appKmh: 12, bias: 1.04 }).length === 0, 'sin corrección: el 4 % de serie no avisa');
  // …pero un cambio de verdad (1,5 km/h) sí
  const tr4 = createSpeedTracker();
  ok(run(tr4, fresh(), { sec: 120, appKmh: 12, beltKmh: 10.5, bias: 1.04 }).length === 1, 'sin corrección: 1,5 km/h de diferencia sí avisa');
  // Con la corrección aprendida (1/1,04), el mismo reloj sesgado queda clavado y 0,6 de desvío se ve
  const tr5 = createSpeedTracker({ factor: 1 / 1.04 });
  const S5 = fresh();
  ok(run(tr5, S5, { sec: 120, appKmh: 12, bias: 1.04 }).length === 0 && tr5.view(S5.t).kmh === 12, 'con corrección: el reloj sesgado marca lo de la clase');
  ok(run(tr5, S5, { sec: 120, appKmh: 10.9, beltKmh: 10.3, bias: 1.04 }).length === 1, 'con corrección: 0,6 de desvío avisa');
  // En pausa no se cuenta nada y, al reanudar, el asentamiento empieza de cero
  const tr6 = createSpeedTracker({ factor: 1 });
  const S6 = fresh();
  run(tr6, S6, { sec: 30, appKmh: 10, beltKmh: 9.4 });
  ok(run(tr6, S6, { sec: 60, appKmh: 10, beltKmh: 9.4, running: false }).length === 0, 'en pausa: sin avisos');
  ok(tr6.view(S6.t).kmh === null && tr6.view(S6.t).fresh === false, 'sin lecturas en 15 s: el chip se queda sin cifra');
  // Lecturas sin ritmo (parado en los laterales): tampoco
  const tr7 = createSpeedTracker({ factor: 1 });
  let t = 1000;
  let n = 0;
  for (let i = 0; i < 40; i++) {
    t += 3000;
    tr7.add(cleanSpeed({ km: 0.5, at: t }), { t, appKmh: 10, appKm: 0.5 + i * 0.008, running: true });
    if (tr7.drift()) n++;
  }
  ok(n === 0 && tr7.view(t).kmh === null, 'parado (lecturas sin km/h): ni aviso ni cifra');
});

section('Lo que se guarda en la sesión', () => {
  const tr = createSpeedTracker();
  const S = fresh();
  run(tr, S, { sec: 600, appKmh: 10, bias: 1.04 });
  const sum = tr.summary();
  ok(sum && sum.source === 'watch' && near(sum.appKm, 1.667, 0.01) && near(sum.km, 1.667 * 1.04, 0.02), `distancias de la clase y del reloj (${JSON.stringify(sum)})`);
  ok(near(sum.avgKmh, 10.4, 0.1) && near(sum.sec, 597, 3) && sum.samples === 200, 'ritmo medio del reloj, segundos y lecturas');
  ok(near(sum.ratio, 1 / 1.04, 0.004) && sum.factor === undefined && sum.touched === undefined, `clase/reloj de la clase (${sum.ratio})`);
  ok(createSpeedTracker().summary() === null, 'sin lecturas: nada que guardar');
  // Instantánea: al retomar la clase, las cuentas siguen
  const snap = tr.snapshot();
  const tr2 = createSpeedTracker({ restore: JSON.parse(JSON.stringify(snap)) });
  S.t += 60000;
  run(tr2, S, { sec: 300, appKmh: 10, bias: 1.04 });
  const sum2 = tr2.summary();
  ok(sum2.samples === 300 && near(sum2.appKm, 2.5, 0.02) && near(sum2.km, 2.5 * 1.04, 0.03), `tras retomar: se suma a lo de antes (${JSON.stringify(sum2)})`);
  ok(createSpeedTracker().snapshot() === null, 'sin lecturas: sin instantánea');
  // El contador del reloj vuelve a empezar (su app se reinició): lo anterior no se pierde ni se resta
  const tr3 = createSpeedTracker();
  let t = 5000;
  const feed = (km, appKm) => { t += 3000; tr3.add(cleanSpeed({ kmh: 10, km, at: t }), { t, appKmh: 10, appKm, running: true }); };
  for (let i = 1; i <= 10; i++) feed(i * 0.008, i * 0.008);
  for (let i = 1; i <= 10; i++) feed(i * 0.008, 0.08 + i * 0.008);
  ok(near(tr3.summary().km, 0.152, 0.002) && near(tr3.summary().appKm, 0.144, 0.002), `reinicio del contador: ${JSON.stringify(tr3.summary())}`);
  // Un salto imposible entre dos lecturas no cuenta
  feed(5, 0.2);
  ok(tr3.summary().km < 0.2, 'salto de kilómetros entre dos lecturas: se descarta');
});

section('Corrección personal: se aprende solo de clases sin tocar la velocidad', () => {
  // 10 min estables, reloj un 4 % por encima → clase/reloj ≈ 0,962
  const tr = createSpeedTracker();
  run(tr, fresh(), { sec: 660, appKmh: 10, bias: 1.04 });
  const r = tr.classRatio();
  ok(near(r, 1 / 1.04, 0.004), `clase/reloj en los tramos estables (${r})`);
  // Has tocado la velocidad: no se aprende (pero el dato queda en la sesión)
  const trT = createSpeedTracker();
  trT.touch();
  run(trT, fresh(), { sec: 660, appKmh: 10, bias: 1.04 });
  ok(trT.classRatio() === null && trT.summary().touched === true && near(trT.summary().ratio, 1 / 1.04, 0.004), 'con la velocidad tocada: no se aprende');
  // Poco rato estable (clase de cambios cada 40 s) o andando: no se aprende
  const trS = createSpeedTracker();
  const SS = fresh();
  for (let i = 0; i < 12; i++) run(trS, SS, { sec: 40, appKmh: i % 2 ? 12 : 9, bias: 1.04 });
  ok(trS.classRatio() === null, 'cambios cada 40 s: no hay bastante tramo estable');
  const trW = createSpeedTracker();
  run(trW, fresh(), { sec: 900, appKmh: 5, bias: 1.1 });
  ok(trW.classRatio() === null, 'andando (menos de 6 km/h): no se aprende');
  // La cinta iba a otra cosa toda la clase (un 30 % menos): eso no es sesgo del reloj
  const trX = createSpeedTracker();
  run(trX, fresh(), { sec: 900, appKmh: 10, beltKmh: 7 });
  ok(trX.classRatio() === null, 'disparate (clase/reloj fuera de 0,8…1,25): no se aprende');

  // learnFactor: hacen falta 2 clases; mediana de las 8 últimas; siempre entre 0,85 y 1,15
  let cal = learnFactor(null, 0.962, { now: Date.UTC(2026, 10, 12) });
  ok(cal.n === 1 && cal.factor === 0.962 && calFactor(cal) === null && cal.updatedAt === '2026-11-12T00:00:00.000Z', 'una clase: se guarda, aún no se usa');
  cal = learnFactor(cal, 0.97);
  ok(cal.n === 2 && calFactor(cal) === 0.966, `dos clases: ya se usa (${calFactor(cal)})`);
  cal = learnFactor(cal, 1.2);
  ok(calFactor(cal) === 0.97, `una clase rara no la mueve: mediana (${calFactor(cal)})`);
  for (let i = 0; i < 10; i++) cal = learnFactor(cal, 0.95);
  ok(cal.ratios.length === 8 && calFactor(cal) === 0.95, 'solo las 8 últimas');
  ok(learnFactor(cal, 2) === cal && learnFactor(cal, NaN) === cal && learnFactor(null, 0.5) === null, 'ratios disparatados: no se guardan');
  let low = null;
  for (let i = 0; i < 3; i++) low = learnFactor(low, 0.81);
  ok(calFactor(low) === FACTOR_MIN, `nunca por debajo de ${FACTOR_MIN}`);
  let high = null;
  for (let i = 0; i < 3; i++) high = learnFactor(high, 1.24);
  ok(calFactor(high) === FACTOR_MAX, `nunca por encima de ${FACTOR_MAX}`);
  ok(calFactor(null) === null && calFactor({ factor: 3, n: 5 }) === null && calFactor({ factor: 'x', n: 5 }) === null, 'calibración rota: como si no hubiera');
  ok(createSpeedTracker({ factor: 3 }).factor() === null && createSpeedTracker({ factor: 0.96 }).calibrated() === true, 'el seguimiento solo acepta correcciones razonables');
});

section('Reloj simulado (?debug=speed)', () => {
  const sim = createSpeedSim({ offset: -0.6 });
  const tr = createSpeedTracker({ factor: 1 / sim.bias });
  let t = 1_762_927_200_000;
  let appKm = 0;
  let alerts = 0;
  let nSamples = 0;
  for (let i = 0; i < 4 * 120; i++) {
    t += 250;
    appKm += 10.9 / 3600 / 4;
    const ctx = { t, appKmh: 10.9, appKm, running: true };
    tr.tick(ctx);
    const smp = sim.next(ctx);
    if (smp) { nSamples++; tr.add(smp, ctx); if (tr.drift()) alerts++; }
  }
  ok(nSamples >= 38 && nSamples <= 40, `una lectura cada 3 s (${nSamples} en 2 min)`);
  ok(alerts === 1 && Math.abs(tr.view(t).kmh - 10.3) <= 0.15, `con la cinta a −0,6: el chip marca ~10,3 y sale el aviso (${tr.view(t).kmh}, ${alerts})`);
  const sim0 = createSpeedSim();
  ok(sim0.next({ t: 1, appKmh: 10, running: false }) === null && sim0.next({ t: 2, appKmh: 10, running: true }) === null, 'en pausa o recién arrancado: sin lectura');
});

process.stdout.write(`\n${passes} comprobaciones OK, ${failures} fallos\n`);
process.exit(failures ? 1 : 0);
