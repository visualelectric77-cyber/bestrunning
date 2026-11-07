#!/usr/bin/env node
// RITMUP · pruebas de las clases a tu pulso (js/training/hr-shape.js).  node tools/test-hr-shape.mjs
import { shapeForHr, readinessTarget, zoneCompliance, recoverySpeed } from '../js/training/hr-shape.js';
import { buildCueSchedule } from '../js/audio/coach.js';
import { PACK_SCRIPT } from '../js/audio/voice-pack.js';
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

// Recuperación según cómo llegas (Olas de tempo, 7 nov: 9,9 entre olas de 11,0 con el pulso a 160–165)
{
  const z3 = { min: 143, max: 154 };
  const z2 = { min: 132, max: 143 };
  ok(recoverySpeed({ cur: seg('fast', 11), next: seg('run', 9.9), hr: 162, nextTarget: z3, curSpeed: 11 }) === 9.6, 'llegas a 162 (zona 143–154): la ola suave baja a 9,6');
  ok(recoverySpeed({ cur: seg('fast', 11), next: seg('run', 9.9), hr: 185, nextTarget: z3, curSpeed: 11 }) === 9.1, 'muy pasado: tope −0,8');
  ok(recoverySpeed({ cur: seg('fast', 11), next: seg('run', 9.9), hr: 152, nextTarget: z3, curSpeed: 11 }) === null, 'en zona: no se toca');
  ok(recoverySpeed({ cur: seg('jog', 8.9), next: seg('run', 10.3), hr: 170, nextTarget: z3, curSpeed: 8.9 }) === null, 'si lo que viene es más duro, no es recuperación');
  ok(recoverySpeed({ cur: seg('run', 10.3), next: seg('jog', 9.9), hr: 140, nextTarget: z2, curSpeed: 10.1, coachLowered: true }) === 9.6, 'el modo pulso te bajó a 10,1: la recuperación va a 9,6 como mucho');
  ok(recoverySpeed({ cur: seg('run', 10.3), next: seg('jog', 8.9), hr: 140, nextTarget: z2, curSpeed: 10.1, coachLowered: true }) === null, 'si ya va bastante más lenta, se queda');
}
// Beber, nunca en un tramo duro (Olas de tempo: el aviso caía en una ola de 11,0)
{
  const lv = { jog: 8.9, run: 10.3, fast: 11.6, sprint: 13 };
  const all = PACK_SCRIPT.map((c) => c.id);
  let checked = 0;
  let wrong = 0;
  for (const id of ['tempo-waves', 'halloween-thirteen', 'pyramid', 'long-mixed', 'mountain-walk']) {
    const w = buildWorkout(id, { minutes: 45, levels: lv, seed: 3, hasIncline: true, treadmill: { hasIncline: true, maxIncline: 12 } });
    if (!w) continue;
    const starts = [];
    let t = 0;
    for (const x of w.segments) { starts.push(t); t += x.sec; }
    for (const pack of [null, { id: 'lucia', available: all }]) {
      for (const c of buildCueSchedule(w, { pack, seed: 5, chattiness: 'chatty' }).filter((x) => x.kind === 'hydration')) {
        checked++;
        const k = starts.findLastIndex((st) => st <= c.at);
        const sg = w.segments[k];
        if (!['walk', 'jog', 'warmup', 'cooldown'].includes(sg.zone) || (sg.incline || 0) >= 3) { wrong++; console.log(`  · ${id}: beber en ${sg.zone} ${sg.speed} @${c.at}`); }
      }
    }
  }
  ok(checked > 0 && wrong === 0, `beber solo en tramos suaves (${checked} avisos, ${wrong} mal)`);
}

console.log(bad ? `✗ ${n - bad} OK, ${bad} fallos` : `✓ clases a tu pulso: ${n} comprobaciones`);
process.exit(bad ? 1 : 0);
