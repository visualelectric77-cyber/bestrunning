// RITMUP · tests del ritmo que calcula el Apple Watch (js/training/watch-speed.js): saneado de lecturas, margen clase/reloj,
// aviso de desvío (20 s, 0,5 km/h), lo que se guarda en la sesión y la corrección personal que se aprende con las clases.
// Uso: node tools/test-watch-speed.mjs   (sale con código ≠ 0 si algo falla)
import {
  cleanSpeed, tolerance, speedStatus, calFactor, learnFactor, driftText, createSpeedTracker, createSpeedSim,
  isMoving, plausibleSpeed, bandKey, bandRange, bandLabel, calFactorAt, calAt, correctSpeed, learnCal, calReport, seriesCompare,
  seriesReal, watchCompare,
  DRIFT_KMH, DRIFT_SEC, SETTLE_SEC, FACTOR_MIN, FACTOR_MAX, SERIES_MAX, BAND_KEYS,
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

section('Se aprende de todas las clases desde la primera, con peso prudente (13 nov: «que lo haga de verdad»)', () => {
  // 10 min estables, reloj un 4 % por encima → clase/reloj ≈ 0,962
  const tr = createSpeedTracker();
  run(tr, fresh(), { sec: 660, appKmh: 10, bias: 1.04 });
  const r = tr.classRatio();
  ok(near(r, 1 / 1.04, 0.004), `clase/reloj en los tramos estables (${r})`);
  ok(tr.learned().sec > 550 && near(tr.learned().bands['10'].ratio, 1 / 1.04, 0.004), `con sus segundos estables y su franja (${JSON.stringify(tr.learned())})`);
  // Has tocado la velocidad a mano: también se aprende (los tramos estables no dependen de quién cambió la velocidad)
  const trT = createSpeedTracker();
  trT.touch();
  run(trT, fresh(), { sec: 660, appKmh: 10, bias: 1.04 });
  ok(near(trT.learned().ratio, 1 / 1.04, 0.004) && trT.summary().touched === true && near(trT.summary().learn.ratio, 1 / 1.04, 0.004), 'con la velocidad tocada: se aprende igual, y queda apuntado en la sesión');
  // Clase de cambios cada 40 s: solo cuentan los pocos segundos estables de cada tramo, así que pesa poco
  const trS = createSpeedTracker();
  const SS = fresh();
  for (let i = 0; i < 12; i++) run(trS, SS, { sec: 40, appKmh: i % 2 ? 12 : 9, bias: 1.04 });
  ok(trS.learned() && trS.learned().sec >= 60 && trS.learned().sec < 150, `cambios cada 40 s: aprende, pero con poco peso (${trS.learned()?.sec} s)`);
  const trW = createSpeedTracker();
  run(trW, fresh(), { sec: 900, appKmh: 5, bias: 1.1 });
  ok(trW.classRatio() === null && trW.learned() === null, 'andando (menos de 6 km/h): no se aprende');
  // La cinta iba a otra cosa toda la clase (un 30 % menos): eso no es sesgo del reloj
  const trX = createSpeedTracker();
  run(trX, fresh(), { sec: 900, appKmh: 10, beltKmh: 7 });
  ok(trX.classRatio() === null && trX.learned() === null, 'disparate (clase/reloj fuera de 0,8…1,25): no se aprende');
  const tr1m = createSpeedTracker();
  run(tr1m, fresh(), { sec: 70, appKmh: 10, bias: 1.04 });
  ok(tr1m.learned()?.ratio == null, 'menos de 1 min estable: no da para la corrección única');

  // learnFactor: cada clase pesa por sus segundos; se aplica desde la primera, encogida según lo que hay detrás
  let cal = learnFactor(null, 0.962, { now: Date.UTC(2026, 10, 12), sec: 600 });
  ok(cal.n === 1 && cal.ratios.join() === '0.962' && cal.secs.join() === '600' && cal.updatedAt === '2026-11-12T00:00:00.000Z', 'una clase: se guarda con sus segundos');
  ok(calFactor(cal) === 0.981 && cal.factor === 0.981, `…y ya corrige, a medias: 10 min son la mitad de lo medido (${calFactor(cal)})`);
  cal = learnFactor(cal, 0.962, { sec: 2000 });
  ok(cal.secs.join() === '600,900' && calFactor(cal) === 0.973, `otra clase: más peso (15 min como mucho por clase) → ${calFactor(cal)}`);
  const rara = learnFactor(cal, 1.2, { sec: 600 });
  ok(calFactor(rara) < 0.98 && calFactor(rara) > 0.96, `una clase rara no lo descoloca: mediana ponderada (${calFactor(rara)})`);
  let many = cal;
  for (let i = 0; i < 15; i++) many = learnFactor(many, 0.962, { sec: 900 });
  ok(many.ratios.length === 12 && many.secs.length === 12 && Math.abs(calFactor(many) - 0.962) < 0.004, `solo las 12 últimas, y con muchas clases se queda en lo medido (${calFactor(many)})`);
  ok(learnFactor(null, 0.962).secs.join() === '300', 'sin segundos: se le suponen 5 min');
  ok(learnFactor(cal, 2) === cal && learnFactor(cal, NaN) === cal && learnFactor(null, 0.5) === null, 'ratios disparatados: no se guardan');
  ok(FACTOR_MIN === 0.8 && FACTOR_MAX === 1.25 && calFactor({ factor: 0.79, n: 5 }) === null && calFactor({ factor: 1.26, n: 5 }) === null, 'la corrección cabe entre 0,8 y 1,25; fuera de ahí no se usa');
  ok(calFactor(null) === null && calFactor({ factor: 3, n: 5 }) === null && calFactor({ factor: 'x', n: 5 }) === null && calFactor({ ratios: [] }) === null, 'calibración rota o vacía: como si no hubiera');
  ok(calFactor({ factor: 1.03, n: 2 }) === 1.03, 'una corrección fija (sin historial: pruebas y reloj simulado) se usa tal cual');
  ok(createSpeedTracker({ factor: 3 }).factor() === null && createSpeedTracker({ factor: 0.96 }).calibrated() === true, 'el seguimiento solo acepta correcciones razonables');
  // El margen del aviso depende de cuánta calibración hay detrás
  ok(tolerance(12, 1) === 0.5 && near(tolerance(12, 0), 0.96) && near(tolerance(12, 0.5), 0.73) && tolerance(5, 0.2) === 0.5, 'margen: 0,5 con toda la confianza; más ancho con poca');
});

section('Parado no marca velocidad (12 nov: salió «≈4,2» sin moverse, con la clase a 9,2)', () => {
  ok(isMoving({ kmh: 9, cadence: 165 }) && isMoving({ kmh: 4.5, cadence: 105 }) && isMoving({ kmh: 9, cadence: null }), 'andar o correr: te mueves');
  ok(!isMoving({ kmh: 4.2, cadence: 38 }) && !isMoving({ kmh: 1.5, cadence: 100 }) && !isMoving({ kmh: null, cadence: null }) && !isMoving(null),
    'braceo sin pasos, casi parado o sin ritmo: no te mueves');
  ok(!isMoving({ kmh: 2.3, cadence: 96 }) && !isMoving({ kmh: 2.9, cadence: null }) && isMoving({ kmh: 3, cadence: 96 }),
    'mover las manos (2,3 km/h): por debajo de 3 no es andar en una cinta, aunque la cadencia engañe');
  ok(!isMoving({ kmh: 9, cadence: 165, moving: false }) && isMoving({ kmh: 9, cadence: 165, moving: true }), 'si el reloj dice que no te mueves (build 25), no te mueves');
  ok(cleanSpeed({ kmh: 9, km: 1, at: 5, moving: true }).moving === true && cleanSpeed({ kmh: 9, km: 1, at: 5, moving: false }).moving === false
    && !('moving' in cleanSpeed({ kmh: 9, km: 1, at: 5 })) && !('moving' in cleanSpeed({ kmh: 9, km: 1, at: 5, moving: 'sí' })), 'moving: solo si viene como booleano');
  ok(plausibleSpeed(9.2, 8.6) && !plausibleSpeed(9.2, 4.2) && !plausibleSpeed(9.2, 16) && plausibleSpeed(5, 4.2) && plausibleSpeed(10, 6),
    'frente a la clase: 4,2 con la clase a 9,2 no es la cinta a otra velocidad');
  // feed: lecturas cada 3 s con la clase corriendo a `app` km/h
  const feed = (tr, S, { n, kmh, cadence, app = 9.2, every = 3000 }) => {
    let alerts = 0;
    for (let i = 0; i < n; i++) {
      S.t += every;
      S.appKm += (app * every) / 3600000;
      S.watchKm += ((kmh || 0) * every) / 3600000;
      const ctx = { t: S.t, appKmh: app, appKm: S.appKm, running: true };
      tr.tick(ctx);
      tr.add(cleanSpeed({ kmh, km: S.watchKm, cadence, at: S.t, source: 'watch' }), ctx);
      if (tr.drift()) alerts++;
    }
    return alerts;
  };
  // 1) Quieto moviendo la mano: ritmo de 4,2 con cadencia de braceo, dos minutos seguidos
  const tr = createSpeedTracker({ factor: 1 });
  const S = fresh();
  const a1 = feed(tr, S, { n: 40, kmh: 4.2, cadence: 38 });
  ok(tr.view(S.t).kmh === null && tr.view(S.t).off === false && a1 === 0, `braceo sin pasos: ni cifra ni aviso (${JSON.stringify(tr.view(S.t))})`);
  // 2) Lecturas sueltas con cadencia de andar, en un tramo de andar (clase a 5): una sola no basta (build 24)
  const tr2 = createSpeedTracker({ factor: 1 });
  const S2 = fresh();
  feed(tr2, S2, { n: 10, kmh: null, cadence: null, app: 5 });
  feed(tr2, S2, { n: 1, kmh: 4.2, cadence: 100, app: 5 });
  ok(tr2.view(S2.t).kmh === null, 'una lectura suelta: aún no se enseña');
  feed(tr2, S2, { n: 1, kmh: null, cadence: null, app: 5 });
  feed(tr2, S2, { n: 1, kmh: 4.2, cadence: 100, app: 5 });
  ok(tr2.view(S2.t).kmh === null, 'la racha se corta al pararte: vuelve a empezar');
  // 2b) Mover las manos: 2,3 km/h, con la cadencia que sea y dure lo que dure, también en un tramo de andar
  const trH = createSpeedTracker({ factor: 1 });
  const SH = fresh();
  const aH = feed(trH, SH, { n: 60, kmh: 2.3, cadence: 96, app: 5 });
  ok(trH.view(SH.t).kmh === null && aH === 0, `mover las manos (2,3): ni cifra ni aviso (${JSON.stringify(trH.view(SH.t))})`);
  // 3) Aunque el reloj no dé cadencia y la lectura dure: con la clase a 9,2, un 4,2 no cuadra → sin cifra ni aviso
  const tr3 = createSpeedTracker({ factor: 1 });
  const S3 = fresh();
  const a3 = feed(tr3, S3, { n: 60, kmh: 4.2, cadence: null });
  ok(tr3.view(S3.t).kmh === null && a3 === 0, `4,2 sostenido con la clase a 9,2: no se enseña ni avisa (${a3})`);
  ok(tr3.classRatio() === null && tr3.summary().ratio === undefined, 'y de eso no se aprende nada');
  // 4) Andando de verdad en un tramo de andar (clase a 5): sí se enseña, a partir de la tercera lectura
  const tr4 = createSpeedTracker({ factor: 1 });
  const S4 = fresh();
  feed(tr4, S4, { n: 1, kmh: 4.8, cadence: 108, app: 5 });
  ok(tr4.view(S4.t).kmh === null, 'andando: la primera lectura aún no');
  feed(tr4, S4, { n: 1, kmh: 4.8, cadence: 108, app: 5 });
  ok(tr4.view(S4.t).kmh === 4.8, `andando: a la segunda, la cifra (${tr4.view(S4.t).kmh})`);
  // 5) Corriendo y te agarras a la barra (el reloj cae a 3): la cifra desaparece y no hay aviso; al soltar, vuelve
  const tr5 = createSpeedTracker({ factor: 1 });
  const S5 = fresh();
  feed(tr5, S5, { n: 20, kmh: 9.2, cadence: 166 });
  ok(tr5.view(S5.t).kmh === 9.2, 'corriendo: marca lo de la clase');
  const a5 = feed(tr5, S5, { n: 20, kmh: 3, cadence: 150 });
  ok(tr5.view(S5.t).kmh === null && a5 === 0, `agarrado a la barra un minuto: sin cifra y sin aviso (${a5})`);
  feed(tr5, S5, { n: 2, kmh: 9.1, cadence: 166 });
  ok(tr5.view(S5.t).kmh === 9.1, 'al soltar: vuelve la cifra');
  // 6) Un hueco de más de 10 s entre lecturas corta la racha
  const tr6 = createSpeedTracker({ factor: 1 });
  const S6 = fresh();
  feed(tr6, S6, { n: 1, kmh: 9, cadence: 165 });
  feed(tr6, S6, { n: 1, kmh: 9, cadence: 165, every: 12000 });
  ok(tr6.view(S6.t).kmh === null, 'hueco de 12 s: la racha empieza de nuevo');
});

section('Sincronía con el reloj (12 nov: «en el móvil tarda mucho en salir»)', () => {
  const ctxAt = (t, app = 9.2) => ({ t, appKmh: app, appKm: 1, running: true });
  // Build 25: el reloj ya ha comprobado que te mueves (moving: true) → la cifra sale con la primera lectura
  const tr = createSpeedTracker({ factor: 1 });
  let t = 1_762_927_200_000;
  tr.tick(ctxAt(t));
  t += 2500;
  tr.add(cleanSpeed({ kmh: 9.1, km: 0.01, cadence: 166, at: t, moving: true }), ctxAt(t));
  ok(tr.view(t).kmh === 9.1, `build 25: la primera lectura ya se enseña (${tr.view(t).kmh})`);
  // …y si el reloj dice que no te mueves, no hay cifra aunque traiga una
  t += 2500;
  tr.add(cleanSpeed({ kmh: 9.1, km: 0.02, cadence: 166, at: t, moving: false }), ctxAt(t));
  ok(tr.view(t).kmh === null, 'build 25 con moving:false: sin cifra');
  t += 2500;
  tr.add(cleanSpeed({ km: 0.02, at: t, moving: false }), ctxAt(t));
  t += 2500;
  tr.add(cleanSpeed({ kmh: 9.0, km: 0.03, cadence: 165, at: t, moving: true }), ctxAt(t));
  ok(tr.view(t).kmh === 9, 'build 25: al volver a moverte, la cifra vuelve con esa misma lectura');
  // Aun comprobado por el reloj, si no cuadra con la clase no se enseña
  t += 2500;
  tr.add(cleanSpeed({ kmh: 4, km: 0.04, cadence: 110, at: t, moving: true }), ctxAt(t));
  ok(tr.view(t).kmh === null, 'build 25: 4,0 con la clase a 9,2 sigue sin enseñarse');
  // Build 24 (sin moving, una lectura cada ~5 s): a la segunda lectura
  const tr24 = createSpeedTracker({ factor: 1 });
  let u = 1_762_927_200_000;
  tr24.tick(ctxAt(u));
  u += 5000;
  tr24.add(cleanSpeed({ kmh: 9.1, km: 0.01, cadence: 166, at: u }), ctxAt(u));
  ok(tr24.view(u).kmh === null, 'build 24: la primera lectura aún no');
  u += 5000;
  tr24.add(cleanSpeed({ kmh: 9.2, km: 0.02, cadence: 166, at: u }), ctxAt(u));
  ok(tr24.view(u).kmh === 9.2, 'build 24: a la segunda (~10 s), la cifra');
  // Si dejan de llegar lecturas (te paras), la cifra se va a los 9 s, no a los 15
  ok(tr24.view(u + 8000).kmh === 9.2 && tr24.view(u + 9500).kmh === null && tr24.view(u + 9500).fresh === true, 'sin lecturas: la cifra se va a los 9 s');
});

section('Corrección por franjas de velocidad (13 nov: −3,6 % de media, pero −10 % en el bloque rápido)', () => {
  ok(BAND_KEYS.join() === '0,6,8,10,12,14' && bandKey(5.9) === '0' && bandKey(6) === '6' && bandKey(9.3) === '8' && bandKey(13.9) === '12' && bandKey(20) === '14',
    'franjas fijas de 2 km/h');
  ok(bandLabel('0') === 'Menos de 6' && bandLabel('8') === '8–10' && bandLabel('14') === '14 o más' && bandRange('10').join() === '10,12' && bandRange('x') === null, 'nombres de las franjas');
  // Migración: el watchCal de antes (una clase, solo la corrección única, sin segundos) cuenta desde ya, con peso prudente
  const old = { factor: 1.028, n: 1, ratios: [1.028], updatedAt: '2026-11-13T07:00:00.000Z' };
  ok(calFactor(old) === 1.009 && calFactorAt(old, 9) === 1.009 && near(calAt(old, 9).conf, 1 / 3), `lo ya guardado se aplica desde ya, a un tercio (${calFactor(old)})`);
  const lesson = { ratio: 1.04, sec: 800, bands: { 6: { ratio: 1.0, sec: 400 }, 8: { ratio: 1.1, sec: 300 } } };
  let cal = learnCal(old, lesson, { now: Date.UTC(2026, 10, 14) });
  ok(cal.n === 2 && cal.ratios.join() === '1.028,1.04' && cal.secs.join() === '300,800' && cal.factor === 1.026, `lo aprendido antes no se pierde (${JSON.stringify(cal.ratios)}, ${cal.factor})`);
  ok(cal.bands['6'].factor === 1.01 && cal.bands['8'].factor === 1.067 && cal.bands['8'].secs.join() === '300', `cada franja, encogida hacia la única según sus minutos (${cal.bands['6'].factor}, ${cal.bands['8'].factor})`);
  // Cada velocidad, la suya; entre franjas, sin saltos; más allá de la última con datos, de vuelta a la única
  ok(calFactorAt(cal, 7) === 1.01 && calFactorAt(cal, 9) === 1.067 && calFactorAt(cal, 8) === 1.038, `en su franja y entre dos (${calFactorAt(cal, 7)}, ${calFactorAt(cal, 8)}, ${calFactorAt(cal, 9)})`);
  ok(calFactorAt(cal, 10) === 1.067 && calFactorAt(cal, 11) === 1.046 && calFactorAt(cal, 13) === 1.026 && calFactorAt(cal, 16) === 1.026,
    `más allá de la última franja con datos, vuelve a la única (${calFactorAt(cal, 11)}, ${calFactorAt(cal, 13)})`);
  ok(calFactorAt(cal, 6) === 1.01 && calFactorAt(cal, 5) === 1.018, `por debajo, igual (${calFactorAt(cal, 5)})`);
  ok(learnCal(cal, null) === cal && learnCal(null, null) === null && learnCal(cal, { ratio: null, bands: { 8: { ratio: 3, sec: 600 } } }) === cal, 'sin nada que aprender (o con disparates): queda igual');
  // Se admite también lo que enseñaba la versión anterior (ratios sueltos, sin segundos)
  const oldShape = learnCal(cal, { ratio: null, bands: { 8: 1.1 } });
  ok(oldShape.n === 2 && oldShape.bands['8'].n === 2 && oldShape.bands['8'].secs.join() === '300,120', 'forma de antes: se le suponen 2 min por franja');
  // Con más clases, cada franja se queda en lo que mide
  let more = cal;
  for (let i = 0; i < 4; i++) more = learnCal(more, { ratio: 1.05, sec: 900, bands: { 6: { ratio: 1.0, sec: 450 }, 8: { ratio: 1.1, sec: 450 } } });
  ok(calFactorAt(more, 9) > 1.085 && calFactorAt(more, 7) < 1.01, `con 5 clases: ${calFactorAt(more, 7)} a 7 km/h y ${calFactorAt(more, 9)} a 9`);
  const only = learnCal(null, { ratio: null, bands: { 8: { ratio: 1.1, sec: 600 } } });
  ok(calFactor(only) === null && calFactorAt(only, 9) === 1.071 && calFactorAt(only, 13) === 1.071, `solo una franja y sin corrección única: vale la de la franja (${calFactorAt(only, 9)})`);
  // Del reloj a la cinta: lo que marca el reloj en la franja rápida sube; en la lenta se queda
  const c = correctSpeed(more, 8.4);
  ok(c.kmh > 9.1 && c.kmh < 9.25 && c.calibrated && c.conf > 0.8, `8,4 del reloj → ${c.kmh.toFixed(2)} de cinta (confianza ${c.conf.toFixed(2)})`);
  ok(Math.abs(correctSpeed(more, 7).kmh - 7) < 0.08 && correctSpeed(null, 9).kmh === 9 && correctSpeed(null, 9).calibrated === false && correctSpeed(null, 9).conf === 0,
    'cada velocidad con su corrección; sin nada aprendido, tal cual');
  // Lo que cambia al aprender, para el diagnóstico
  const rep = calReport(old, cal, lesson);
  ok(rep.unico.min === 13.3 && rep.unico.antes === 1.009 && rep.unico.despues === 1.026 && rep.franjas.length === 2
    && rep.franjas[1].label === '8–10' && rep.franjas[1].min === 5 && rep.franjas[1].antes === 1.009 && rep.franjas[1].despues === 1.067,
    `informe de lo aprendido (${JSON.stringify(rep)})`);
  ok(calReport(cal, cal, null).franjas.length === 0 && calReport(cal, cal, null).unico === null, 'sin nada aprendido: informe vacío');

  // Una clase con el reloj clavado a 7 y un 10 % corto a 9,3: con una sola corrección avisaría en el bloque rápido
  const biasOf = (v) => (v >= 8 ? 1 / 1.1 : 1);
  const klass = (tr, S) => {
    let alerts = 0;
    for (let i = 0; i < 3; i++) {
      alerts += run(tr, S, { sec: 240, appKmh: 7.1, bias: biasOf(7.1) }).length;
      alerts += run(tr, S, { sec: 240, appKmh: 9.3, bias: biasOf(9.3) }).length;
    }
    return alerts;
  };
  const tr0 = createSpeedTracker({ cal: { factor: 1.03, n: 2 } });
  const S0 = fresh();
  ok(klass(tr0, S0) >= 1, 'con una sola corrección para todo: el bloque rápido dispara el aviso');
  const L = tr0.learned();
  ok(L && Math.abs(L.bands['6'].ratio - 1) < 0.01 && Math.abs(L.bands['8'].ratio - 1.1) < 0.012 && L.bands['8'].sec > 500 && L.ratio > 1.03 && L.ratio < 1.07 && L.sec > 1000,
    `la clase enseña cada franja, con sus segundos (${JSON.stringify(L)})`);
  const sum0 = tr0.summary();
  ok(sum0.bands['6'].sec > 500 && Math.abs(sum0.bands['8'].ratio - 1.1) < 0.012 && !sum0.bands['10'] && sum0.learn.bands['8'].sec === L.bands['8'].sec, `y lo deja en la sesión (${JSON.stringify(sum0.bands)})`);
  // Con esa ÚNICA clase aprendida, la misma clase ya no avisa: se aplica desde la primera
  const cal1 = learnCal(null, L);
  const tr1 = createSpeedTracker({ cal: cal1 });
  const S1 = fresh();
  ok(klass(tr1, S1) === 0, 'con una sola clase aprendida: la misma clase ya no avisa');
  const f9 = tr1.factorNow(S1.t);
  ok(Math.abs(tr1.view(S1.t).kmh - 9.3) <= 0.2 && f9 > 1.06 && f9 < 1.1, `el chip marca casi lo de la clase y al reloj le va la corrección de esa velocidad (${tr1.view(S1.t).kmh}, ${f9})`);
  // La velocidad real para quien quiera usarla: corregida, con su confianza, y «ok» solo con calibración y clase asentada
  const real = tr1.real(S1.t);
  ok(real && Math.abs(real.kmh - 9.3) <= 0.2 && real.conf >= 0.5 && real.ok === true && Math.abs(real.dev) <= 0.2 && real.cadence === 165 && real.raw < real.kmh,
    `real(): ${JSON.stringify(real)}`);
  ok(tr1.real(S1.t + 10000) === null, 'real(): sin lectura fresca, null');
  const trU = createSpeedTracker();
  const SU = fresh();
  run(trU, SU, { sec: 90, appKmh: 9.3 });
  ok(trU.real(SU.t).conf === 0 && trU.real(SU.t).ok === false && trU.real(SU.t).kmh === 9.3, 'real() sin nada aprendido: orienta, pero ok:false');
  run(trU, SU, { sec: 9, appKmh: 11 });
  ok(trU.real(SU.t)?.ok === false, 'real() justo tras un cambio de velocidad: ok:false');
  ok(createSpeedTracker().real(1) === null, 'real() sin lecturas: null');
  // …y un cambio de cinta de verdad se sigue viendo
  ok(run(tr1, S1, { sec: 120, appKmh: 9.3, beltKmh: 8.6, bias: biasOf(8.6) }).length === 1, 'cinta 0,7 por debajo: avisa');
  // Con poco rato en una franja se aprende, pero apenas mueve nada
  const trS = createSpeedTracker();
  const SS = fresh();
  run(trS, SS, { sec: 400, appKmh: 7.1 });
  run(trS, SS, { sec: 100, appKmh: 9.3, bias: 0.9 });
  const LS = trS.learned();
  const calS = learnCal(null, LS);
  ok(LS.bands['6'].sec > 300 && LS.bands['8'].sec < 90 && calFactorAt(calS, 9) < 1.04, `1 min en una franja: pesa poco (${LS.bands['8'].sec} s → ${calFactorAt(calS, 9)}, midiendo ${LS.bands['8'].ratio})`);
});

section('Serie de la sesión, cadencia y zancada', () => {
  // run() con el tiempo de clase: aquí hace falta ctx.elapsed
  const go = (tr, S, { sec, appKmh, bias = 1, cadence = 165 }) => {
    for (let i = 0; i < sec; i++) {
      S.t += 1000; S.el = (S.el || 0) + 1;
      S.appKm += appKmh / 3600;
      const target = appKmh * bias;
      S.v = S.v == null ? target : S.v + (target - S.v) * (1 - Math.exp(-1 / 6));
      S.watchKm += S.v / 3600;
      const ctx = { t: S.t, appKmh, appKm: S.appKm, running: true, elapsed: S.el };
      tr.tick(ctx);
      if (i % 3 === 2) tr.add(cleanSpeed({ kmh: S.v, km: S.watchKm, cadence, at: S.t, moving: true }), ctx);
    }
  };
  const tr = createSpeedTracker();
  const S = fresh();
  go(tr, S, { sec: 300, appKmh: 7.2, cadence: 160 });
  go(tr, S, { sec: 300, appKmh: 9.6, bias: 0.9, cadence: 170 });
  const ser = tr.series();
  ok(ser.length === 60 && ser[0][0] === 10 && ser[59][0] === 600, `un punto cada 10 s de clase (${ser.length})`);
  ok(ser[20].join() === '210,7.2,160,7.2' && ser[55][3] === 9.6 && Math.abs(ser[55][1] - 8.6) <= 0.1 && ser[55][2] === 170, `[s, reloj, cadencia, clase] (${ser[20].join()} · ${ser[55].join()})`);
  ok(JSON.stringify(ser).length < 1400, `compacta: ${JSON.stringify(ser).length} caracteres por 10 min`);
  ok(tr.series().length === 60, 'pedir la serie no la cierra: la clase puede seguir');
  const sum = tr.summary();
  ok(sum.cadence === 165 && Math.abs(sum.stride - (7.2 / 0.06 / 160 + 9.6 / 0.06 / 170) / 2) < 0.02, `cadencia media y zancada (${sum.cadence}, ${sum.stride} m)`);
  ok(sum.bands['6'].cadence === 160 && sum.bands['6'].stride === 0.75 && sum.bands['8'].cadence === 170 && sum.bands['8'].stride === 0.94, `por franja (${JSON.stringify(sum.bands)})`);
  // Comparación de la serie: reloj frente a clase por franjas
  const cmp = seriesCompare(ser);
  ok(cmp && cmp.bands.length === 2 && cmp.bands[0].key === '6' && cmp.bands[0].diffPct === 0 && cmp.bands[1].label === '8–10' && Math.abs(cmp.bands[1].diffPct + 10) <= 0.6,
    `por franjas: clavado a 7,2 y −10 % a 9,6 (${JSON.stringify(cmp?.bands.map((b) => b.diffPct))})`);
  ok(cmp.bands[1].cadence === 170 && cmp.bands[1].stride === 0.94 && cmp.bands[1].appKmh === 9.6 && cmp.diffPct < -3 && cmp.diffPct > -7, `con cadencia, zancada y total (${cmp.diffPct} %)`);
  ok(seriesCompare(null) === null && seriesCompare([]) === null && seriesCompare(ser.slice(0, 4)) === null && seriesCompare([[10, null, null, 8], [20, null, null, 8], [30, null, null, 8]]) === null,
    'sin serie, muy corta o sin lecturas del reloj: nada que comparar');
  // Lo que pinta la tarjeta del Resumen: total y franjas (de la serie; sin ella, de lo guardado; sin nada, el total)
  const full = watchCompare({ watchSpeed: sum, watchSeries: ser });
  ok(full && full.bands.length === 2 && full.bands[1].appKmh === 9.6 && full.cadence === 165 && full.sim === false && full.diffPct < -3,
    `sesión con serie: ${JSON.stringify(full && { d: full.diffPct, n: full.bands.length })}`);
  const noSeries = watchCompare({ watchSpeed: sum });
  ok(noSeries.bands.length === 2 && Math.abs(noSeries.bands[1].diffPct + 10) <= 1 && noSeries.bands[1].cadence === 170 && noSeries.bands[1].appKmh === 9.6,
    `sin serie: las franjas guardadas (${JSON.stringify(noSeries.bands.map((b) => b.diffPct))})`);
  // Una sesión de antes de las franjas (solo el total), con cifras de ejemplo
  const old = watchCompare({ watchSpeed: { source: 'watch', km: 2.4, avgKmh: 8.2, appKm: 2.5, sec: 1100, samples: 400, ratio: 1.04 } });
  ok(old && old.diffPct === -4 && old.bands.length === 0 && old.appKm === 2.5 && old.watchKm === 2.4 && old.cadence === undefined, `sesión antigua: solo el total (${JSON.stringify(old)})`);
  ok(watchCompare({ watchSpeed: { km: 0.145, pairKm: 0.14, appKm: 0.14 } }).diffPct === 0, 'el total compara el mismo rato (lo que el reloj llevaba antes de la primera lectura no cuenta)');
  ok(watchCompare({}) === null && watchCompare(null) === null && watchCompare({ watchSpeed: { km: 0, appKm: 2 } }) === null && watchCompare({ watchSpeed: { ...sum, sim: true } }).sim === true,
    'sin datos del reloj: sin tarjeta; lo simulado va marcado');
  // La serie con la corrección de ahora (para el análisis): solo cambia la columna del reloj
  const fixed = seriesReal(ser, { factor: 1.1, n: 2 });
  ok(fixed.length === ser.length && fixed[20].join() === '210,7.9,160,7.2' && seriesReal(ser, null)[20].join() === ser[20].join() && seriesReal(null, null).length === 0,
    `seriesReal: ${fixed[20].join()}`);
  ok(watchCompare({ watchSpeed: { ...sum, learn: { ratio: 1.03, sec: 500, bands: { 6: { ratio: 1, sec: 250 }, 8: { ratio: 1.1, sec: 250 } } } } }).learned.join() === '6–8,8–10'
    && watchCompare({ watchSpeed: { ...sum, learn: undefined } }).learned.length === 0, 'la tarjeta sabe qué franjas ha enseñado la clase');
  // Instantánea: al retomar la clase, la serie y las franjas siguen
  const tr2 = createSpeedTracker({ restore: JSON.parse(JSON.stringify(tr.snapshot())) });
  go(tr2, S, { sec: 120, appKmh: 9.6, bias: 0.9, cadence: 170 });
  ok(tr2.series().length === 72 && tr2.summary().bands['8'].sec > 350 && tr2.summary().cadence === 166, `tras retomar: ${tr2.series().length} puntos`);
  // Parado: el punto queda sin lectura del reloj (pero con lo que marcaba la clase)
  const tr3 = createSpeedTracker();
  let t = 1e12;
  for (let i = 1; i <= 12; i++) {
    t += 3000;
    tr3.add(cleanSpeed({ km: 0.01, at: t, moving: false }), { t, appKmh: 8, appKm: i * 0.006, running: true, elapsed: i * 3 });
  }
  ok(tr3.series().every((p) => p[1] === null && p[2] === null && p[3] === 8) && tr3.series().length === 4, 'parado: puntos sin velocidad del reloj');
  // Sin el tiempo de clase (o en pausa) no hay serie, y lo demás funciona igual
  const tr4 = createSpeedTracker();
  run(tr4, fresh(), { sec: 120, appKmh: 9 });
  ok(tr4.series().length === 0 && tr4.summary() !== null, 'sin tiempo de clase: sin serie');
  // Clase larguísima: la serie no pasa de 720 puntos (se juntan de dos en dos)
  const tr5 = createSpeedTracker();
  let u = 1e12;
  for (let i = 1; i <= 3000; i++) {
    u += 5000;
    tr5.add(cleanSpeed({ kmh: 9, km: i * 0.0125, cadence: 166, at: u, moving: true }), { t: u, appKmh: 9, appKm: i * 0.0125, running: true, elapsed: i * 5 });
  }
  const long = tr5.series();
  ok(long.length <= SERIES_MAX + 1 && long.length > 300 && long[long.length - 1][0] >= 14990 && long.every((p, i) => i === 0 || p[0] > long[i - 1][0]),
    `4 h de clase: ${long.length} puntos, en orden`);
  // Volver atrás en la clase (⏮): lo repetido se pisa, sin puntos duplicados ni desordenados
  const tr6 = createSpeedTracker();
  let w = 1e12;
  const feed = (el) => { w += 3000; tr6.add(cleanSpeed({ kmh: 9, km: (w - 1e12) / 3e6, cadence: 166, at: w, moving: true }), { t: w, appKmh: 9, appKm: 1, running: true, elapsed: el }); };
  for (let el = 3; el <= 90; el += 3) feed(el);
  for (let el = 33; el <= 60; el += 3) feed(el);
  const back = tr6.series();
  ok(back.every((p, i) => i === 0 || p[0] > back[i - 1][0]) && back[back.length - 1][0] === 60, `tras volver atrás: en orden hasta el 60 (${back.map((p) => p[0]).join()})`);
});

section('Reloj simulado (?debug=speed)', () => {
  const sim = createSpeedSim({ offset: -0.6 });
  const tr = createSpeedTracker({ cal: sim.cal });
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
  // (el simulado baila ±0,08 y la lectura viaja con un decimal: corregida, eso son hasta ±0,2)
  ok(alerts === 1 && Math.abs(tr.view(t).kmh - 10.3) <= 0.25, `con la cinta a −0,6: el chip marca ~10,3 y sale el aviso (${tr.view(t).kmh}, ${alerts})`);
  // El reloj simulado se queda corto cuanto más rápido (como en la clase real) y trae su corrección por franjas
  ok(sim.cal.bands['6'].factor === 1 && sim.cal.bands['8'].factor > 1.07 && sim.cal.bands['12'].factor > 1.2 && createSpeedSim({ bias: 1.04 }).cal.factor === 0.962,
    `corrección del simulado por franjas (${JSON.stringify(Object.values(sim.cal.bands).map((b) => b.factor))})`);
  const sim0 = createSpeedSim();
  ok(sim0.next({ t: 1, appKmh: 10, running: false }) === null && sim0.next({ t: 2, appKmh: 10, running: true }) === null, 'en pausa o recién arrancado: sin lectura');
});

process.stdout.write(`\n${passes} comprobaciones OK, ${failures} fallos\n`);
process.exit(failures ? 1 : 0);
