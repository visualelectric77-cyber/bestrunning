#!/usr/bin/env node
// RITMUP · pruebas de las clases a tu pulso (js/training/hr-shape.js).  node tools/test-hr-shape.mjs
import { shapeForHr, readinessTarget, zoneCompliance } from '../js/training/hr-shape.js';
import { buildWorkout } from '../js/training/generator.js';
import { TEMPLATES } from '../js/training/templates.js';

let n = 0;
let bad = 0;
const ok = (c, msg) => { n++; if (!c) { bad++; console.log(`  ✗ ${msg}`); } };
const seg = (zone, speed, sec) => ({ zone, speed, sec });

// Recuperaciones entre arreones: −0,4; el trote largo o sin arreón a los lados no se toca
{
  const s = shapeForHr([seg('jog', 8.8, 300), seg('fast', 11.6, 40), seg('jog', 8.8, 120), seg('sprint', 13, 40), seg('jog', 8.8, 120), seg('cooldown', 7, 120)]);
  ok(s[2].speed === 8.4 && s[2].hrShape === 'rec', `recuperación entre arreones → 8,4 (${s[2].speed})`);
  ok(s[0].speed === 8.8, 'el trote del principio no cambia');
  ok(s[4].speed === 8.8, 'el trote tras el último arreón (sin otro después) no cambia');
  ok(s[1].speed === 11.6 && s[3].speed === 13, 'los arreones no cambian');
  const long = shapeForHr([seg('fast', 11.6, 240), seg('jog', 8.8, 120), seg('fast', 11.6, 240)]);
  ok(long[1].speed === 8.8, 'tras series de 4 min no es «arreón»: no cambia');
}
// Deriva: solo en clases de ≥ 40 min, solo trote, desde el minuto 25, −0,1 cada 10 min, tope −0,3
{
  const segs = [seg('warmup', 7.6, 300), seg('jog', 9, 1200), seg('jog', 9, 600), seg('run', 10.2, 600), seg('jog', 9, 600), seg('jog', 9, 600)];
  const s = shapeForHr(segs);
  ok(s[1].speed === 9, 'trote antes del minuto 25: igual');
  ok(s[2].speed === 8.9, `trote que empieza en el 25: −0,1 (${s[2].speed})`);
  ok(s[3].speed === 10.2, 'correr no se toca');
  ok(s[4].speed === 8.7, `trote en el 45: −0,3 (${s[4].speed})`);
  ok(s[5].speed === 8.7, `trote en el 55: −0,3 (${s[5].speed})`);
  const short = shapeForHr([seg('jog', 9, 1500), seg('jog', 9, 600)]);
  ok(short[1].speed === 9, 'clase de 35 min: sin deriva');
  ok(shapeForHr(segs, { isTest: true })[5].speed === 9, 'en el test VAM nada');
  ok(segs[5].speed === 9, 'no muta los tramos de entrada');
  ok(shapeForHr([seg('fast', 11, 40), seg('jog', 1.2, 60), seg('fast', 11, 40)], { minSpeed: 1 })[1].speed === 1, 'nunca por debajo del mínimo de la cinta');
  const pre = shapeForHr([seg('fast', 11.6, 40), seg('jog', 8.4, 120), seg('fast', 11.6, 40)], { jog: 8.9 });
  ok(pre[1].speed === 8.4, `recuperación que la plantilla ya puso lenta (8,4 con trote 8,9): se queda (${pre[1].speed})`);
  const full = shapeForHr([seg('fast', 11.6, 40), seg('jog', 8.9, 120), seg('fast', 11.6, 40)], { jog: 8.9 });
  ok(full[1].speed === 8.5, `recuperación a tu trote: 8,9 → 8,5 (${full[1].speed})`);
}
// Todas las plantillas siguen construyéndose y con velocidades válidas
{
  const lv = { jog: 8.9, run: 10.3, fast: 11.6, sprint: 13 };
  let built = 0;
  let wrong = 0;
  for (const t of TEMPLATES) {
    for (const m of t.durations || [20]) {
      const w = buildWorkout(t.id, { minutes: m, levels: lv, seed: 7 });
      if (!w) continue;
      built++;
      if (w.segments.some((x) => !(x.speed > 0) || !(x.sec > 0))) wrong++;
      // lo que baja hr-shape nunca deja el trote más de 0,7 km/h por debajo de tu velocidad de trote
      if (w.segments.some((x) => x.hrShape && x.speed < lv.jog - 0.7 - 0.05)) wrong++;
    }
  }
  ok(built > 50 && wrong === 0, `plantillas: ${built} clases construidas, ${wrong} con velocidades raras`);
}
// Objetivo según la recuperación del día
{
  const t = { zone: 2, min: 132, max: 143 };
  ok(readinessTarget(t, 'green') === t && readinessTarget(t, null) === t, 'verde o sin datos: igual');
  ok(readinessTarget(t, 'amber').max === 140 && readinessTarget(t, 'amber').min === 132, 'ámbar: hasta el 70 % del rango');
  ok(readinessTarget(t, 'red').max === 138 && readinessTarget(t, 'red').capped === 'red', 'rojo: mitad baja');
}
// % en zona
{
  const prof = { age: 46, hrMax: 176, hrRest: 65 }; // Z2 132–143, Z3 143–154
  const segs = [seg('warmup', 7.6, 120), seg('jog', 9, 600), seg('run', 10.3, 600)];
  const series = [];
  for (let t = 0; t < 1320; t += 10) series.push([t, t < 120 ? 110 : t < 720 ? 138 : t < 1020 ? 150 : 160]);
  const c = zoneCompliance(segs, series, prof);
  // trote: 180–720 en zona (540 s); correr: 780–1020 en zona (240 s), 1020–1320 alto (300 s)
  ok(c && c.byZone.jog.pct === 100, `trote 100 % en zona (${c?.byZone.jog.pct})`);
  ok(c && c.byZone.run.pct === 44, `correr 44 % en zona (${c?.byZone.run.pct})`);
  ok(c && c.pct === 72 && c.highSec === 300 && c.lowSec === 0, `total 72 % (${c?.pct}), 300 s alto (${c?.highSec})`);
  ok(zoneCompliance(segs, [], prof) === null, 'sin pulso → null');
  ok(zoneCompliance([seg('warmup', 7, 600)], series, prof) === null, 'sin tramos de trabajo → null');
}

console.log(bad ? `✗ ${n - bad} OK, ${bad} fallos` : `✓ clases a tu pulso: ${n} comprobaciones`);
process.exit(bad ? 1 : 0);
