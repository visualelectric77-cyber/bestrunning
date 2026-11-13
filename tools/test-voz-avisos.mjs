// RITMUP · tests de la voz de avisos y correcciones (13 nov 2026) y del control de series por pulso.
// Lo que antes solo salía escrito (día cargado, tramo siguiente cambiado por el pulso, consejos en «solo aviso»,
// guía de carrera, desvío del reloj, pulso perdido) ahora también lo dice Lucía, con clips grabados.
// Uso: node tools/test-voz-avisos.mjs   (sale con código ≠ 0 si algo falla)
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCoach } from '../js/audio/coach.js';
import { PACK_SCRIPT, clipsText } from '../js/audio/voice-pack.js';
import { seriesSpeed, nextSpeed, effectiveSpeed, REAL_HOLD_DEV } from '../js/training/hr-control.js';
import { createSpeedTracker } from '../js/training/watch-speed.js';
import { equilibrium, hrAfter } from '../js/training/hr-dynamics.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; return true; } failures++; process.stderr.write(`  ✗ ${msg}\n`); return false; };
const eq = (a, b, msg) => ok(a === b, `${msg}: esperado «${b}», obtenido «${a}»`);
const section = (t) => process.stdout.write(`• ${t}\n`);
const tick = () => new Promise((r) => setImmediate(r));

const NEW_GROUPS = {
  hrday: 1, hrnextdown: 2, hrnextup: 1, hrrec: 1, hrsugdown: 1, hrsugup: 1, hrlost: 1,
  wslow: 2, wfast: 2, wok: 1, racehigh: 1, racelow: 1, racesugdown: 1, racesugup: 1, raceok: 2,
};
const CARRIERS = ['hrsugdown', 'hrsugup', 'wslow', 'wfast', 'racehigh', 'racelow', 'racesugdown', 'racesugup'];
const NEW_IDS = Object.entries(NEW_GROUPS).flatMap(([g, n]) => Array.from({ length: n }, (_, i) => `${g}_${i + 1}`));

/* ───────────── 1 · El pack trae los clips ───────────── */
section('Guion y pack: las frases nuevas están grabadas');
{
  const byId = new Map(PACK_SCRIPT.map((c) => [c.id, c]));
  eq(NEW_IDS.length, 19, 'frases nuevas');
  for (const id of NEW_IDS) ok(byId.has(id), `${id} está en el guion del pack`);
  for (const g of CARRIERS) {
    for (let i = 1; i <= NEW_GROUPS[g]; i++) {
      const c = byId.get(`${g}_${i}`);
      ok(c?.kind === 'carrier' && /a…$/.test(c.text), `${g}_${i} es portadora y acaba en «a…» (${c?.text})`);
    }
  }
  for (const id of NEW_IDS.filter((x) => !CARRIERS.includes(x.replace(/_\d+$/, '')))) {
    ok(byId.get(id)?.kind === 'phrase' && /[.!]$/.test(byId.get(id).text), `${id} es frase cerrada`);
  }
  const index = JSON.parse(await readFile(path.join(ROOT, 'audio/packs/lucia/index.json'), 'utf8'));
  const inIndex = new Set(index.clips);
  eq(new Set(index.clips).size, index.clips.length, 'índice sin repetidos');
  for (const id of NEW_IDS) {
    ok(inIndex.has(id), `${id} está en el índice del pack`);
    let size = 0;
    try { size = (await stat(path.join(ROOT, 'audio/packs/lucia', `${id}.mp3`))).size; } catch { size = 0; }
    ok(size > 8000 && size < 90000, `${id}.mp3 existe y pesa lo normal (${size} bytes)`);
  }
  // nada del guion se queda sin grabar (un clip que falta haría callar ese aviso)
  for (const c of PACK_SCRIPT) if (!inIndex.has(c.id)) ok(false, `${c.id} está en el guion pero no en el pack`);
  ok(true, 'guion ⊆ pack');
}

/* ───────────── 2 · El coach los dice ───────────── */
section('Coach: avisos sueltos, consejos con cifra y carrera');
const ALL = new Set(PACK_SCRIPT.map((c) => c.id));
const W = { segments: [{ zone: 'warmup', speed: 6.5, sec: 120 }, { zone: 'run', speed: 10, sec: 300 }, { zone: 'jog', speed: 8.5, sec: 120 }, { zone: 'fast', speed: 11.5, sec: 90 }, { zone: 'cooldown', speed: 6, sec: 120 }] };
function mk(avail = ALL) {
  const said = [];
  const coach = createCoach(W, { voiceEnabled: false, chattiness: 'normal', seed: 5, pack: { available: avail }, onCue: (c) => said.push(c) });
  const dyn = async (kind, vars) => { const n = said.length; await coach.say(kind, vars); await tick(); return said.slice(n); };
  return { coach, dyn, said };
}
{
  const { coach, dyn } = mk();
  eq(coach.voice, 'pack', 'coach con el pack');
  const one = async (cue) => (await dyn('hrNote', { cue }))[0]?.clips?.join() || '';
  eq(await one('day'), 'hrday_1', 'día cargado');
  eq(await one('rec'), 'hrrec_1', 'recuperación más suave');
  eq(await one('nextdown'), 'hrnextdown_1', 'siguiente tramo más suave');
  eq(await one('nextdownday'), 'hrnextdown_2', 'siguiente tramo más suave (día alto)');
  eq(await one('nextup'), 'hrnextup_1', 'siguiente tramo más rápido');
  eq(await one('lost'), 'hrlost_1', 'pulso perdido');
  eq(await one('watchok'), 'wok_1', 'vas a la velocidad de la clase');
  ok(/^raceok_[12]$/.test(await one('raceok')), 'vas bien para tu meta');
  eq((await dyn('hrNote', { cue: 'inventado' })).length, 0, 'aviso desconocido: no dice nada');
  eq((await dyn('hrNote', {})).length, 0, 'aviso sin cue: no dice nada');

  const adv = async (cue, speed) => (await dyn('advise', { cue, speed }))[0]?.clips?.join() || '';
  eq(await adv('hrdown', '9,8'), 'hrsugdown_1,s_98', 'solo aviso: te conviene bajar a 9,8');
  eq(await adv('hrup', '10,4'), 'hrsugup_1,s_104', 'solo aviso: puedes subir a 10,4');
  eq(await adv('racedown', '10,6'), 'racesugdown_1,s_106', 'carrera, solo aviso: bajar');
  eq(await adv('raceup', 11), 'racesugup_1,s_110', 'carrera, solo aviso: subir');
  ok(/^wslow_[12],s_93$/.test(await adv('wslow', '9,3')), 'reloj por debajo: pon la cinta a 9,3');
  ok(/^wfast_[12],s_93$/.test(await adv('wfast', 9.3)), 'reloj por encima: pon la cinta a 9,3');
  eq((await dyn('advise', { cue: 'hrdown', speed: 22 })).length, 0, 'consejo con velocidad fuera del pack: calla (portadora sola no)');
  eq((await dyn('advise', { cue: 'hrdown' })).length, 0, 'consejo sin velocidad: calla');
  eq((await dyn('advise', { cue: 'otra', speed: 10 })).length, 0, 'consejo desconocido: calla');

  // contrato con la sesión del reloj: say('watchDrift', { dir, speed })
  ok(/^wslow_[12],s_93$/.test((await dyn('watchDrift', { dir: -1, speed: '9,3' }))[0]?.clips?.join() || ''), 'watchDrift dir −1 ⇒ vas más lento');
  eq((await dyn('watchDrift', { dir: 1, speed: 10.5 })).length, 0, 'segundo desvío antes de 4 min: la voz calla (el rótulo sigue)');
  eq((await dyn('watchDrift', { dir: -1 })).length, 0, 'watchDrift sin velocidad: calla');
  {
    // con el reloj adelantado: vuelve a hablar pasados 4 min, y como mucho 4 veces por hora
    const real = Date.now;
    let t = real() + 5 * 60000;
    Date.now = () => t;
    try {
      ok(/^wfast_[12],s_105$/.test((await dyn('watchDrift', { dir: 1, speed: 10.5 }))[0]?.clips?.join() || ''), 'pasados 4 min: watchDrift dir +1 ⇒ vas más rápido');
      t += 5 * 60000; eq((await dyn('watchDrift', { dir: -1, speed: 9 })).length, 1, 'tercero de la hora');
      t += 5 * 60000; eq((await dyn('watchDrift', { dir: -1, speed: 9 })).length, 1, 'cuarto de la hora');
      t += 5 * 60000; eq((await dyn('watchDrift', { dir: -1, speed: 9 })).length, 0, 'quinto en la misma hora: calla');
      t += 60 * 60000; eq((await dyn('watchDrift', { dir: -1, speed: 9 })).length, 1, 'una hora después: vuelve a hablar');
    } finally { Date.now = real; }
  }

  // ajuste aplicado: en clase, las de pulso; en carrera, las de la meta
  ok(/^hrhigh_[12],s_100$/.test((await dyn('hrAdjust', { dir: -1, speed: '10' }))[0]?.clips?.join() || ''), 'clase: «Vas alto de pulso. Bajamos a…»');
  ok(/^hrlow_[12],s_106$/.test((await dyn('hrAdjust', { dir: 1, speed: '10,6' }))[0]?.clips?.join() || ''), 'clase: «Vas sobrado. Sube a…»');
  eq((await dyn('hrAdjust', { dir: -1, speed: '10,9', race: true }))[0]?.clips?.join(), 'racehigh_1,s_109', 'carrera: «…pasado de pulso. Bajamos a…»');
  eq((await dyn('hrAdjust', { dir: 1, speed: '11,3', race: true }))[0]?.clips?.join(), 'racelow_1,s_113', 'carrera: «Vas con margen para la meta. Subimos a…»');
  eq((await dyn('hrAdjust', { dir: -1, speed: '10,9', race: true, alarm: true }))[0]?.clips?.[0], 'hralarm_1', 'carrera con alarma: «Pulso muy alto»');
  const t = clipsText(['racehigh_1', 's_109']);
  ok(/Bajamos a/.test(t) && /coma nueve/i.test(t), `subtítulo legible (${t})`);
  coach.destroy();
}
{
  // Pack antiguo (sin las frases nuevas): nada se rompe; en carrera cae a las de pulso de siempre
  const old = new Set([...ALL].filter((id) => !NEW_IDS.includes(id)));
  const { coach, dyn } = mk(old);
  eq((await dyn('hrNote', { cue: 'day' })).length, 0, 'pack antiguo: aviso suelto calla');
  eq((await dyn('advise', { cue: 'hrdown', speed: 10 })).length, 0, 'pack antiguo: consejo calla');
  eq((await dyn('watchDrift', { dir: -1, speed: 10 })).length, 0, 'pack antiguo: desvío del reloj calla');
  ok(/^hrhigh_[12],s_109$/.test((await dyn('hrAdjust', { dir: -1, speed: '10,9', race: true }))[0]?.clips?.join() || ''), 'pack antiguo, carrera: frase de pulso de siempre');
  coach.destroy();
}
{
  // Sin pack (voz del sistema): estos avisos no existen en esa voz; no hablan ni rompen
  const said = [];
  const c = createCoach(W, { voiceEnabled: false, chattiness: 'normal', seed: 5, onCue: (x) => said.push(x) });
  const n = said.length;
  await c.say('hrNote', { cue: 'day' }); await c.say('advise', { cue: 'hrup', speed: 10 }); await c.say('watchDrift', { dir: 1, speed: 10 });
  await tick();
  eq(said.length, n, 'sin pack: callan');
  c.destroy();
}

/* ───────────── 3 · Control de series (entreno exigente) ───────────── */
section('Series cortas: suben si se te quedan cortas para tu pulso de hoy');
{
  // Modelo de ejemplo (no es de nadie)
  const M = { b: 10, c: 4, d: 0.4, tauUp: 75, tauDown: 110, aTypical: 40, aSpread: 3 };
  const T = { min: 154, max: 170 };                       // zona «rápido» con el techo de exigente → centro 162
  const rep = (speed = 11.5, sec = 90, extra = {}) => ({ zone: 'fast', speed, sec, incline: 0, ...extra });
  const base = { hrEnd: 135, load: 4, target: T };
  // equilibrio a 11,5 con a=40 y carga 4 → 40+115+1,6 = 156,6 < 160 ⇒ sube
  const v = seriesSpeed(M, 40, { next: rep(), ...base });
  ok(v != null && v > 11.5 && v <= 11.8 + 1e-9, `serie corta por debajo del centro: sube (${v})`);
  eq(v, 11.8, 'sube como mucho +0,3');
  ok(equilibrium(M, 40, v, 0, 4) <= 162 + 1e-9, 'no pasa del centro de la zona en equilibrio');
  ok(hrAfter(M, 40, 135, 90, v, 0, 4) <= T.max - 2, 'y al acabar la serie sigues bajo el techo');
  // si falta poco para el centro, sube lo justo (o nada si es menos de 0,2)
  eq(seriesSpeed(M, 44.5, { next: rep(), ...base }), null, 'a 1 ppm del centro: no se toca');
  const v2 = seriesSpeed(M, 43, { next: rep(), ...base });
  ok(v2 === 11.7, `a medio camino: sube lo justo (${v2})`);
  // día alto (tu pulso de hoy va por encima): no sube
  eq(seriesSpeed(M, 50, { next: rep(), ...base }), null, 'día de pulso alto: no sube');
  // mucha carga acumulada (final de la sesión): el equilibrio ya está en la zona
  eq(seriesSpeed(M, 40, { next: rep(), ...base, load: 25 }), null, 'con la fatiga acumulada ya llegas: no sube');
  // en la serie anterior ya rozaste el techo
  eq(seriesSpeed(M, 40, { next: rep(), ...base, lastPeak: 166 }), null, 'serie anterior a 4 ppm del techo: no sube');
  ok(seriesSpeed(M, 40, { next: rep(), ...base, lastPeak: 158 }) != null, 'serie anterior con margen: sube');
  // lo que no es una serie corta de trabajo
  eq(seriesSpeed(M, 40, { next: rep(11.5, 30), ...base }), null, 'arreón de 30 s: lo define la velocidad');
  eq(seriesSpeed(M, 40, { next: rep(11.5, 180), ...base }), null, 'tramo largo: eso lo lleva nextSpeed');
  eq(seriesSpeed(M, 40, { next: rep(11.5, 90, { incline: 4 }), ...base }), null, 'cuesta: no');
  eq(seriesSpeed(M, 40, { next: { zone: 'jog', speed: 8.5, sec: 90 }, ...base, target: { min: 130, max: 142 } }), null, 'trote: no');
  eq(seriesSpeed(M, 40, { next: { zone: 'sprint', speed: 13, sec: 60 }, ...base }), null, 'sprint: no');
  ok(seriesSpeed(M, 40, { next: { zone: 'run', speed: 10, sec: 120 }, hrEnd: 130, load: 4, target: { min: 143, max: 160 } }) != null, 'correr 2 min por debajo: sube');
  // modelo inicial o datos que faltan
  eq(seriesSpeed({ ...M, starter: true }, 40, { next: rep(), ...base }), null, 'modelo inicial: nunca pide más');
  eq(seriesSpeed(null, 40, { next: rep(), ...base }), null, 'sin modelo');
  eq(seriesSpeed(M, 40, { next: rep(), ...base, target: null }), null, 'sin zona');
  eq(seriesSpeed(M, 40, { next: rep(), ...base, hrEnd: NaN }), null, 'sin pulso');
  // límites de la cinta
  eq(seriesSpeed(M, 40, { next: rep(), ...base, maxSpeed: 11.6 }), null, 'la cinta no da más: sin cambio útil');
  // llegas muy alto de la recuperación: con la velocidad nueva acabarías por encima ⇒ se recorta o no sube
  const hot = seriesSpeed(M, 40, { next: rep(11.5, 170), hrEnd: 166, load: 4, target: { min: 154, max: 160 } });
  ok(hot == null || hrAfter(M, 40, 166, 170, hot, 0, 4) <= 158, `nunca te deja acabar la serie sobre el techo (${hot})`);
  // nextSpeed sigue igual: en series cortas no sube (eso solo lo hace seriesSpeed, y solo con exigente)
  eq(nextSpeed(M, 40, { cur: { zone: 'jog', speed: 8.5, sec: 60 }, next: rep(), hrEnd: 135, load: 4, target: T }), null, 'nextSpeed no sube series cortas');
}

/* ───────────── 4 · Velocidad real del reloj en la cuenta del pulso ───────────── */
section('Velocidad real: se usa solo si el reloj la sabe con garantías');
{
  const e = (cls, real) => effectiveSpeed(cls, real);
  eq(JSON.stringify(e(10, null)), JSON.stringify({ v: 10, real: false, dev: 0 }), 'sin reloj: la de la clase');
  eq(e(10, { kmh: 9.2, ok: false }).v, 10, 'lectura que solo orienta (ok=false): la de la clase');
  eq(e(10, { kmh: 9.8, ok: true }).real, false, 'a 0,2 de la clase: dicen lo mismo, manda la clase');
  const d = e(10, { kmh: 9.4, ok: true });
  ok(d.real && d.v === 9.4 && d.dev === -0.6, `0,6 por debajo y fiable: se usa la real (${JSON.stringify(d)})`);
  const u = e(10, { kmh: 10.5, ok: true });
  ok(u.real && u.v === 10.5 && u.dev === 0.5, 'por encima también');
  eq(e(10, { kmh: 6, ok: true }).v, 8.5, 'un disparate del reloj no mueve la cuenta más de un 15 %');
  eq(e(10, { kmh: 14, ok: true }).v, 11.5, '…tampoco hacia arriba');
  eq(e(0, { kmh: 9, ok: true }).real, false, 'sin velocidad de clase: nada');
  eq(e(10, { kmh: NaN, ok: true }).real, false, 'lectura rota: nada');
  ok(REAL_HOLD_DEV === 0.5 && Math.abs(d.dev) >= REAL_HOLD_DEV, 'desde 0,5 de desvío el modo pulso espera a la cinta');
  // el contrato con watch-speed.js existe y devuelve lo que se espera (o null sin lecturas)
  const trk = createSpeedTracker();
  ok(typeof trk.real === 'function', 'el seguidor del reloj expone real(t)');
  eq(trk.real(Date.now()), null, 'sin lecturas: null');
}

process.stdout.write(`\n${failures ? `✗ ${failures} fallos` : '✓ todo bien'} · ${passes} comprobaciones\n`);
process.exit(failures ? 1 : 0);
