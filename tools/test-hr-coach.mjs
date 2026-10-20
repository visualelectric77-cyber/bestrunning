#!/usr/bin/env node
// RITMUP · pruebas del modo pulso (js/player/hr-coach.js).  node tools/test-hr-coach.mjs
import { createHrCoach } from '../js/player/hr-coach.js';

let n = 0;
let bad = 0;
const ok = (c, msg) => { n++; if (!c) { bad++; console.log(`  ✗ ${msg}`); } };

const target = { min: 140, max: 155 };
/** Simula `sec` segundos de un tramo con pulso constante; devuelve los ajustes. */
function run({ bpm, zone = 'run', segSec = 600, from = 0, sec = 300, hr = true, coach = createHrCoach(), seg = 0 }) {
  const out = [];
  for (let t = from; t < from + sec; t++) {
    const ms = 1_000_000 + seg * 10_000_000 + t * 1000;
    const r = coach.step({
      nowMs: ms, running: true, segIndex: seg, zone, segSec, segElapsed: t, segRemaining: segSec - t,
      hr: hr ? { bpm: typeof bpm === 'function' ? bpm(t) : bpm, atMs: ms } : null, target,
    });
    if (r) out.push({ t, ...r });
  }
  return out;
}

// Sin pulso o en zona: nada
ok(run({ bpm: 150, hr: false }).length === 0, 'sin pulso no hace nada');
ok(run({ bpm: 150 }).length === 0, 'en zona no hace nada');
ok(run({ bpm: 157 }).length === 0, 'dentro del margen (+3) no hace nada');

// Pulso alto: baja 0,2, nunca antes del primer minuto del tramo ni antes de 45 s fuera
const hi = run({ bpm: 165 });
ok(hi.length >= 1 && hi[0].dir === -1 && hi[0].tenths === 2 && hi[0].reason === 'high', 'pulso alto → baja 0,2');
ok(hi[0].t >= 60 + 45 - 1, `espera al minuto del tramo y a 45 s fuera (t=${hi[0]?.t})`);
ok(hi.every((r, i) => i === 0 || r.t - hi[i - 1].t >= 90), '90 s de calma entre ajustes');

// Alarma: muy por encima → baja 0,3 antes
const al = run({ bpm: 175 });
ok(al[0]?.reason === 'alarm' && al[0].tenths === 3 && al[0].t < hi[0].t, 'pulso muy alto → 0,3 y antes');

// Pulso bajo: sube 0,2 tras 60 s fuera
const lo = run({ bpm: 128 });
ok(lo[0]?.dir === 1 && lo[0].tenths === 2 && lo[0].t >= 60 + 60 - 1, 'pulso bajo → sube 0,2 tras 60 s fuera');

// Tramos que no cuentan
ok(run({ bpm: 175, zone: 'sprint' }).length === 0, 'nunca en sprint');
ok(run({ bpm: 175, zone: 'warmup' }).length === 0, 'nunca en calentamiento');
ok(run({ bpm: 175, zone: 'cooldown' }).length === 0, 'nunca en vuelta a la calma');
ok(run({ bpm: 175, segSec: 120, sec: 120 }).length === 0, 'nunca en tramos de < 3 min');
ok(run({ bpm: 175, segSec: 200, sec: 200 }).every((r) => 200 - r.t >= 45), 'nunca en los últimos 45 s');

// Lecturas viejas no cuentan
{
  const c = createHrCoach();
  let any = 0;
  for (let t = 0; t < 300; t++) {
    const ms = 1_000_000 + t * 1000;
    if (c.step({ nowMs: ms, running: true, segIndex: 0, zone: 'run', segSec: 600, segElapsed: t, segRemaining: 600 - t, hr: { bpm: 175, atMs: 1_000_000 }, target })) any++;
  }
  ok(any === 0, 'una lectura congelada (sin pulso nuevo) no provoca ajustes');
}

// Como mucho 8 por clase
{
  const c = createHrCoach();
  let total = 0;
  for (let seg = 0; seg < 10; seg++) total += run({ bpm: 175, seg, coach: c, sec: 600 }).length;
  ok(total === 8 && c.count === 8, `como mucho 8 ajustes por clase (${total})`);
}

// Pausa: reinicia la cuenta de «fuera de zona»
{
  const c = createHrCoach();
  run({ bpm: 165, coach: c, sec: 90 });
  c.step({ nowMs: 1_000_000 + 90_000, running: false });
  // (misma base de tiempo: seg 0)
  const after = run({ bpm: 165, coach: c, from: 91, sec: 20 });
  ok(after.length === 0, 'tras una pausa vuelve a esperar 45 s');
}

// Pulso cada 5 s (como llega del reloj): también actúa
{
  const c = createHrCoach();
  const out = [];
  for (let t = 0; t < 300; t++) {
    const ms = 5_000_000 + t * 1000;
    const at = 5_000_000 + Math.floor(t / 5) * 5000;
    const r = c.step({ nowMs: ms, running: true, segIndex: 0, zone: 'run', segSec: 600, segElapsed: t, segRemaining: 600 - t, hr: { bpm: 166, atMs: at }, target });
    if (r) out.push(r);
  }
  ok(out.length >= 1 && out[0].dir === -1, 'con una lectura cada 5 s también baja');
}

console.log(bad ? `✗ ${n - bad} OK, ${bad} fallos` : `✓ modo pulso: ${n} comprobaciones`);
process.exitCode = bad ? 1 : 0;
