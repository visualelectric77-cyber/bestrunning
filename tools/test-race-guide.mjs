// RITMUP · tests de la guía de carrera por pulso (js/training/race-guide.js).
// Uso: node tools/test-race-guide.mjs   (sale con código ≠ 0 si algo falla)
import { createRaceGuide, finishHr, finishIn } from '../js/training/race-guide.js';

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

// Modelo de ejemplo (no es de nadie): 10 ppm por km/h, 0,4 ppm por km/h·min de carga, 75 s al subir y 110 al bajar
const M = { b: 10, c: 4, d: 0.4, tauUp: 75, tauDown: 110, aTypical: 40 };
const MAX = 180;
const base = (o = {}) => ({ nowMs: 600000, raceSec: 600, doneKm: 2, remKm: 3, speed: 11, hr: 160, model: M, a: 40, load: 20, minSpeed: 1, maxSpeed: 18, ...o });

section('Pulso previsto en la meta', () => {
  ok(finishHr(M, 40, { hrNow: 150, speed: 11, remKm: 0, load: 0 }) === 150, 'sin distancia por delante, el pulso de ahora');
  const a = finishHr(M, 40, { hrNow: 150, speed: 10, remKm: 3, load: 10 });
  const b = finishHr(M, 40, { hrNow: 150, speed: 11, remKm: 3, load: 10 });
  const c = finishHr(M, 40, { hrNow: 150, speed: 12, remKm: 3, load: 10 });
  ok(a < b && b < c, `más velocidad, más pulso en meta (${a.toFixed(1)} < ${b.toFixed(1)} < ${c.toFixed(1)})`);
  const far = finishHr(M, 40, { hrNow: 150, speed: 11, remKm: 4, load: 10 });
  ok(far > b, 'más distancia por delante, más pulso al llegar (la carga acumula)');
  const day = finishHr(M, 48, { hrNow: 150, speed: 11, remKm: 3, load: 10 });
  ok(Math.abs(day - b - 8) < 1.5, 'un día 8 ppm más alto llega unas 8 ppm más alto');
  ok(finishHr(null, 40, { hrNow: 150, speed: 11, remKm: 3 }) === null, 'sin modelo, null');
  ok(finishHr(M, 40, { hrNow: NaN, speed: 11, remKm: 3 }) === null && finishHr(M, 40, { hrNow: 150, speed: 0, remKm: 3 }) === null, 'entradas malas, null');
  ok(Math.abs(finishIn(2.5, 10) - 900) < 1e-9 && finishIn(1, 0) === null, 'segundos hasta la meta');
});

section('Sin datos no hace nada', () => {
  ok(createRaceGuide({ hrMax: MAX }).step(base({ model: null })) === null, 'sin modelo');
  ok(createRaceGuide({ hrMax: MAX }).step(base({ hr: null })) === null, 'sin pulso');
  ok(createRaceGuide({ hrMax: MAX }).step(base({ hr: NaN })) === null, 'pulso no numérico');
  ok(createRaceGuide({}).step(base()) === null, 'sin pulso máximo');
  ok(createRaceGuide({ hrMax: MAX }).step(base({ speed: 0 })) === null, 'parado');
  const g = createRaceGuide({ hrMax: MAX });
  g.step(base({ hr: null }));
  ok(g.predicted === null, 'sin pulso no hay meta prevista');
});

section('Te pasas: baja lo justo', () => {
  const g = createRaceGuide({ hrMax: MAX });
  const o = base({ speed: 12.5, hr: 170 });
  const p = finishHr(M, 40, { hrNow: 170, speed: 12.5, remKm: 3, load: 20 });
  ok(p > MAX, `el caso de prueba se pasa (${p.toFixed(1)})`);
  const r = g.step(o);
  ok(r && r.dir === -1 && r.reason === 'over' && r.tenths >= 1 && r.tenths <= 3, `baja entre 0,1 y 0,3 (${r?.tenths})`);
  ok(r.predicted === Math.round(p) && g.predicted === Math.round(p) && r.hrMax === MAX, 'cuenta la meta prevista y tu máxima');
  ok(Math.abs(r.to - (12.5 - r.tenths / 10)) < 1e-9, 'velocidad nueva coherente');
  // lo justo: con una décima menos no llegaba a tu máxima, o es el tope de 0,3
  if (r.tenths > 1) ok(finishHr(M, 40, { hrNow: 170, speed: 12.5 - (r.tenths - 1) / 10, remKm: 3, load: 20 }) > MAX, 'no baja más de lo necesario');
  if (r.tenths < 3) ok(finishHr(M, 40, { hrNow: 170, speed: r.to, remKm: 3, load: 20 }) <= MAX, 'con lo que baja, llega a tope');
  // pasado por poco (hasta 3 ppm sobre tu máxima: lo que se equivoca el modelo) → no toca nada
  let v = 10;
  while (finishHr(M, 40, { hrNow: 165, speed: v, remKm: 3, load: 20 }) <= MAX + 0.6) v = Math.round((v + 0.1) * 10) / 10;
  const pv = finishHr(M, 40, { hrNow: 165, speed: v, remKm: 3, load: 20 });
  if (pv <= MAX + 3) ok(createRaceGuide({ hrMax: MAX }).step(base({ speed: v, hr: 165 })) === null, `pasado por poco (${pv.toFixed(1)} ppm a ${v}): no frena`);
  // pasado de largo (más de 3 ppm) → baja
  let w = v;
  while (finishHr(M, 40, { hrNow: 165, speed: w, remKm: 3, load: 20 }) <= MAX + 3.4) w = Math.round((w + 0.1) * 10) / 10;
  const g2 = createRaceGuide({ hrMax: MAX });
  const r2 = g2.step(base({ speed: w, hr: 165 }));
  ok(r2 && r2.dir === -1 && r2.tenths <= 3, `pasado más de 3 ppm a ${w}: baja ${r2?.tenths} décimas`);
  ok(g.count === 1 && g2.count === 1, 'cuenta los ajustes');
  // al principio (antes de 4 min o de 1 km) solo baja si se pasa de largo: más de 8 ppm
  const early = { raceSec: 120, nowMs: 120000, doneKm: 0.4, remKm: 4.6, load: 6, hr: 150 };
  let e = 10;
  while (finishHr(M, 40, { hrNow: 150, speed: e, remKm: 4.6, load: 6 }) <= MAX + 4) e = Math.round((e + 0.1) * 10) / 10;
  const pe = finishHr(M, 40, { hrNow: 150, speed: e, remKm: 4.6, load: 6 });
  if (pe <= MAX + 8) ok(createRaceGuide({ hrMax: MAX }).step(base({ ...early, speed: e })) === null, `al principio, ${pe.toFixed(1)} ppm previstos no bastan para frenar`);
  ok(createRaceGuide({ hrMax: MAX }).step(base({ ...early, speed: e, raceSec: 300, nowMs: 300000, doneKm: 1.1, remKm: 4.6 }))?.dir === -1, 'pasados 4 min y 1 km, esa misma previsión sí baja');
  let f = e;
  while (finishHr(M, 40, { hrNow: 150, speed: f, remKm: 4.6, load: 6 }) <= MAX + 8.4) f = Math.round((f + 0.1) * 10) / 10;
  ok(createRaceGuide({ hrMax: MAX }).step(base({ ...early, speed: f }))?.dir === -1, `al principio, pasarse de largo (a ${f}) sí baja`);
});

section('Calma: primer minuto, entre ajustes y tras un cambio tuyo', () => {
  const g = createRaceGuide({ hrMax: MAX });
  ok(g.step(base({ speed: 12.5, hr: 170, raceSec: 30, nowMs: 30000 })) === null, 'nada en el primer minuto');
  ok(g.predicted > MAX, 'pero ya calcula la meta prevista');
  const r = g.step(base({ speed: 12.5, hr: 170, raceSec: 61, nowMs: 61000 }));
  ok(r && r.dir === -1, 'al minuto, sí');
  ok(g.step(base({ speed: 12.5, hr: 170, raceSec: 120, nowMs: 61000 + 89000 })) === null, 'no repite antes de 90 s');
  ok(g.step(base({ speed: 12.5, hr: 170, raceSec: 152, nowMs: 61000 + 91000 }))?.dir === -1, 'a los 90 s, sí');
  const g2 = createRaceGuide({ hrMax: MAX });
  ok(g2.step(base({ speed: 12.5, hr: 170, manualAtMs: 600000 - 119000 })) === null, 'tras tu cambio espera 2 min');
  ok(g2.step(base({ speed: 12.5, hr: 170, manualAtMs: 600000 - 121000 }))?.dir === -1, 'pasados los 2 min, vuelve');
});

section('Tienes margen: sube sin pasarse', () => {
  const g = createRaceGuide({ hrMax: MAX });
  const o = base({ speed: 10, hr: 140, load: 5 });
  const p = finishHr(M, 40, { hrNow: 140, speed: 10, remKm: 3, load: 5 });
  ok(p < MAX - 8, `el caso de prueba va con margen (${p.toFixed(1)})`);
  ok(createRaceGuide({ hrMax: MAX }).step({ ...o, doneKm: 0.9 }) === null, 'no sube en el primer km');
  ok(createRaceGuide({ hrMax: MAX }).step({ ...o, raceSec: 200 }) === null, 'ni antes de 4 min');
  ok(createRaceGuide({ hrMax: MAX }).step({ ...o, starter: true }) === null, 'con el modelo inicial no sube');
  const r = g.step(o);
  ok(r && r.dir === 1 && r.reason === 'room' && r.tenths >= 1 && r.tenths <= 2, `sube 0,1 o 0,2 (${r?.tenths})`);
  ok(finishHr(M, 40, { hrNow: 140, speed: r.to, remKm: 3, load: 5 }) <= MAX - 4, 'después de subir sigue por debajo de (máxima − 4)');
  ok(g.step({ ...o, nowMs: o.nowMs + 119000 }) === null, 'tras subir espera 2 min');
  ok(g.step({ ...o, nowMs: o.nowMs + 121000 })?.dir === 1, 'y luego puede volver a subir');
  // cerca del límite: sin margen para una décima más → nada
  let v = 10;
  while (finishHr(M, 40, { hrNow: 150, speed: v + 0.1, remKm: 3, load: 10 }) <= MAX - 4) v = Math.round((v + 0.1) * 10) / 10;
  const pv = finishHr(M, 40, { hrNow: 150, speed: v, remKm: 3, load: 10 });
  const r3 = createRaceGuide({ hrMax: MAX }).step(base({ speed: v, hr: 150, load: 10 }));
  ok(r3 === null, `en la franja buena (${pv.toFixed(1)} ppm a ${v}) no toca nada`);
});

section('Último kilómetro, últimos 300 m y alarma', () => {
  const over = { speed: 12.5, hr: 172, remKm: 0.9, doneKm: 4.1, load: 60 };
  ok(finishHr(M, 40, { hrNow: 172, speed: 12.5, remKm: 0.9, load: 60 }) > MAX, 'caso: se pasa en el último km');
  ok(createRaceGuide({ hrMax: MAX }).step(base(over)) === null, 'en el último km no baja');
  const up = createRaceGuide({ hrMax: MAX }).step(base({ speed: 10, hr: 140, load: 5, remKm: 0.8, doneKm: 4.2 }));
  ok(up && up.dir === 1, 'en el último km sí puede subir');
  ok(createRaceGuide({ hrMax: MAX }).step(base({ speed: 10, hr: 140, load: 5, remKm: 0.25, doneKm: 4.75 })) === null, 'en los últimos 300 m, nada');
  const g = createRaceGuide({ hrMax: MAX });
  const al = g.step(base({ ...over, hr: MAX + 4 }));
  ok(al && al.reason === 'alarm' && al.dir === -1 && al.tenths === 3, 'alarma: pulso real sobre tu máxima → baja 0,3 también en el último km');
  ok(g.step(base({ ...over, hr: MAX + 6, nowMs: 600000 + 59000 })) === null, 'la alarma no se repite antes de 60 s');
  ok(g.step(base({ ...over, hr: MAX + 6, nowMs: 600000 + 61000 }))?.reason === 'alarm', 'a los 60 s, sí');
  ok(createRaceGuide({ hrMax: MAX }).step(base({ ...over, hr: MAX + 3 })) === null, 'a máxima + 3 todavía no');
});

section('Límites', () => {
  const g = createRaceGuide({ hrMax: MAX });
  let n = 0;
  for (let i = 0; i < 30; i++) if (g.step(base({ speed: 13, hr: 172, nowMs: 600000 + i * 100000 }))) n++;
  ok(n === 10 && g.count === 10, `10 ajustes como mucho (${n})`);
  const r = createRaceGuide({ hrMax: MAX }).step(base({ speed: 12.5, hr: 170, minSpeed: 12.4 }));
  ok(r && r.tenths === 1 && Math.abs(r.to - 12.4) < 1e-9, 'respeta la velocidad mínima de la cinta');
  ok(createRaceGuide({ hrMax: MAX }).step(base({ speed: 12.5, hr: 170, minSpeed: 12.5 })) === null, 'sin margen en la cinta, nada (y no gasta un ajuste)');
  const up = createRaceGuide({ hrMax: MAX }).step(base({ speed: 10, hr: 140, load: 5, maxSpeed: 10.1 }));
  ok(up && up.tenths === 1 && Math.abs(up.to - 10.1) < 1e-9, 'respeta la velocidad máxima');
});

section('Carrera entera simulada: converge sin pasarse', () => {
  // La realidad sigue el mismo modelo; sale 1,2 km/h por encima de lo que aguanta
  const g = createRaceGuide({ hrMax: MAX });
  let hr = 120;
  let load = 3;
  let speed = 13;
  let km = 0;
  let sec = 0;
  let peak = 0;
  const actions = [];
  while (km < 5 && sec < 3600) {
    const x = M.aTypical + M.b * speed + M.d * load;
    hr = x + (hr - x) * Math.exp(-1 / (x > hr ? M.tauUp : M.tauDown));
    load += Math.max(0, speed - 8.5) / 60;
    km += speed / 3600;
    sec++;
    peak = Math.max(peak, hr);
    const r = g.step({ nowMs: sec * 1000, raceSec: sec, doneKm: km, remKm: Math.max(0, 5 - km), speed, hr, model: M, a: M.aTypical, load, minSpeed: 1, maxSpeed: 18 });
    if (r) { actions.push(r); speed = r.to; }
  }
  ok(actions.length >= 2 && actions.length <= 10 && actions.every((a) => a.dir === -1), `baja varias veces y no más de 10 (${actions.length})`);
  ok(peak <= MAX + 4, `no se pasa de tu máxima más que el margen del modelo (pico ${peak.toFixed(1)})`);
  ok(hr >= MAX - 9, `y llega apurando, no paseando (${hr.toFixed(1)} en meta)`);
  ok(km >= 5 && sec < 1800, `acaba los 5 km (${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')})`);
});

process.stdout.write(`\n${passes} comprobaciones OK, ${failures} fallos\n`);
process.exit(failures ? 1 : 0);
