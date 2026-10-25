#!/usr/bin/env node
// BestRunning · tests del audio y del coach (Node 22): node tools/test-audio.mjs
// Construye entrenamientos sintéticos (sin depender del módulo de entrenamiento) y comprueba el programa de
// avisos en los tres niveles de charla, los números en palabras, speechText y la cobertura de clips del manifiesto.
// Fase 2: programa con el pack grabado (Eva) sobre clases reales del generador, con el pack completo y parcial,
// y el motor de audio (pack, pausas, cuenta atrás troceada, br:voice, sesión) sobre un WebAudio simulado.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  PHRASES, REQUIRED_CATEGORIES, PLACEHOLDERS, pick, fill, fragmentsOf, numberWords, integerWords, durationWords,
  clipIdsFor, manifestClips, textClipId, placeholdersOf, durationClipIds,
} from '../js/audio/phrases.js';
import { speechText, spanishVoices, defaultVoice, speak, cancelSpeech, onVoicesChanged, signalVoice, isVoiceActive } from '../js/audio/speech.js';
import { buildCueSchedule, createCoach, estimateCueSec, previewCoach } from '../js/audio/coach.js';
import {
  beep, hasClips, isUnlocked, loadPack, applyAudioSettings, unlockAudio, getAudioContext, setAudioSessionType,
  currentPackId, packInfo, playClips, playCountdown, clipDuration, clipSequenceSec, clipGapAfter, estimateClipSec,
  stopClips,
} from '../js/audio/audio-engine.js';
import { PACK_SCRIPT, PACK_SPEED_MIN, PACK_SPEED_MAX, speedClip, durationClip, clipsText } from '../js/audio/voice-pack.js';
import { TEMPLATES } from '../js/training/templates.js';
import { buildWorkout } from '../js/training/generator.js';
import { makeRng, hashStr } from '../js/core/utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let checks = 0;
const fail = (msg) => { failures++; if (failures <= 4000) process.stdout.write(`  ✗ ${msg}\n`); };
const ok = (cond, msg) => { checks++; if (!cond) fail(msg); return !!cond; };
const eq = (a, b, msg) => ok(a === b, `${msg}: esperado «${b}», obtenido «${a}»`);
const section = (t) => process.stdout.write(`\n▸ ${t}\n`);
const tick = () => new Promise((r) => setImmediate(r));
const spokenSpeed = (v) => { const r = Math.round(v * 10) / 10; return Number.isInteger(r) ? String(r) : String(r).replace('.', ','); };

/* ───────────── Entrenamientos sintéticos ───────────── */

const L = { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 };

function intervals20() {
  const s = [
    { zone: 'warmup', speed: 6.5, sec: 60 }, { zone: 'warmup', speed: 7.1, sec: 60 }, { zone: 'jog', speed: L.jog, sec: 60 },
  ];
  for (let i = 1; i <= 8; i++) {
    s.push({ zone: 'sprint', speed: L.sprint, sec: 30, rep: { i, n: 8 }, block: 'Series', cue: 'Brazos rápidos, mirada al frente.' });
    s.push({ zone: 'jog', speed: L.jog, sec: 60, rep: { i, n: 8 }, block: 'Series' });
  }
  s.push({ zone: 'run', speed: L.run, sec: 180 }, { zone: 'cooldown', speed: 6.5, sec: 120 });
  return { id: 'sprint-30-60~20~a~100', title: 'Sprints 30/60', category: 'intervals', segments: s, seed: 5,
    coachNotes: ['Los sprints se ganan con los brazos.', 'Recupera de verdad en los trotes.'] };
}

function endurance50() {
  const s = [
    { zone: 'warmup', speed: 6.5, sec: 180 }, { zone: 'warmup', speed: 7.1, sec: 180 }, { zone: 'jog', speed: L.jog, sec: 240 },
    { zone: 'run', speed: L.run, sec: 600, block: 'Bloque 1', cue: 'Ritmo de poder hablar a frases cortas.' },
    { zone: 'jog', speed: L.jog, sec: 120, block: 'Bloque 1' },
    { zone: 'run', speed: L.run, sec: 300, incline: 2, block: 'Bloque 2' },
    { zone: 'run', speed: L.run, sec: 300, incline: 4.5, block: 'Bloque 2' },
    { zone: 'jog', speed: L.jog, sec: 120, incline: 0, block: 'Bloque 2' },
    { zone: 'fast', speed: L.fast, sec: 240, block: 'Bloque 3' },
    { zone: 'jog', speed: L.jog, sec: 120, block: 'Bloque 3' },
    { zone: 'fast', speed: 11.8, sec: 240, block: 'Bloque 3' },
    { zone: 'cooldown', speed: 6.5, sec: 300 },
  ];
  return { id: 'long-blocks~50~b~108', title: 'Bloques de resistencia', category: 'endurance', segments: s, seed: 9 };
}

function hour60() {
  const s = [{ zone: 'warmup', speed: 6.5, sec: 240 }, { zone: 'warmup', speed: 7.1, sec: 240 }];
  let v = 8.3;
  for (let k = 0; k < 24; k++) { s.push({ zone: v < 9.5 ? 'jog' : v < 11 ? 'run' : 'fast', speed: Math.round(v * 10) / 10, sec: 120 }); v += 0.15; }
  s.push({ zone: 'cooldown', speed: 6.5, sec: 240 });
  return { id: 'the-hour~60~c~100', title: 'La hora', category: 'challenge', segments: s, seed: 2 };
}

function testVam() {
  const s = [{ zone: 'warmup', speed: 6.5, sec: 150 }, { zone: 'jog', speed: 7.8, sec: 150 }];
  let v = 8.0;
  for (let st = 1; v <= 16.0; st++, v = Math.round((v + 0.5) * 10) / 10) {
    s.push({ zone: v < 9 ? 'jog' : v < 10.8 ? 'run' : v < 12.2 ? 'fast' : 'sprint', speed: v, sec: 60, stage: st, label: `Escalón ${st}` });
  }
  s.push({ zone: 'cooldown', speed: 6.5, sec: 180 });
  return { id: 'test-vam~30~d~100', title: 'Test VAM escalonado', category: 'test', isTest: true, segments: s, seed: 4 };
}

function edgeCases() {
  // segmentos muy cortos, velocidades iguales seguidas, extremos de velocidad, inclinación decimal, datos raros
  const s = [
    { zone: 'warmup', speed: 3.5, sec: 15 },
    { zone: 'walk', speed: 5.5, sec: 5 },
    { zone: 'jog', speed: 8.3, sec: 30 },
    { zone: 'jog', speed: 8.3, sec: 30, rep: { i: 1, n: 2 } },
    { zone: 'run', speed: 8.3, sec: 30, rep: { i: 2, n: 2 } },
    { zone: 'sprint', speed: 20.0, sec: 30, incline: 1.5 },
    { zone: 'nada', speed: '12', sec: '45' },
    { zone: 'fast', speed: 11.5, sec: 0 },
    { zone: 'fast', speed: 11.5, sec: 10, incline: 1.5 },
    { zone: 'cooldown', speed: 5.0, sec: 20 },
  ];
  return { id: 'edge', title: '', segments: s };
}

const WORKOUTS = [
  { name: 'intervals20', w: intervals20(), strict: true },
  { name: 'endurance50', w: endurance50(), strict: true },
  { name: 'hour60', w: hour60(), strict: true },
  { name: 'testVam', w: testVam(), strict: true },
  { name: 'edge', w: edgeCases(), strict: false },
];
const MODES = ['minimal', 'normal', 'coach'];
const LEADS = [5, 10, 15];
const SEEDS = [1, 2, 3];
const SPOKEN_KINDS = new Set(['intro', 'pre', 'change', 'finish', 'segCue', 'halfSegment', 'last30', 'last10',
  'halfWorkout', 'lastBlock', 'hydration', 'tip', 'motivation', 'warmup']);

function realSegments(w) {
  return w.segments.map((s, idx) => ({ ...s, idx, sec: Math.round(Number(s.sec) || 0), speed: Math.round((Number(s.speed) || 0) * 10) / 10, incline: Math.round((Number(s.incline) || 0) * 10) / 10 }))
    .filter((s) => s.sec > 0);
}

/* ───────────── 1 · Banco de frases ───────────── */

section('Banco de frases');
{
  const cats = Object.keys(PHRASES);
  const total = cats.reduce((n, c) => n + PHRASES[c].length, 0);
  ok(total >= 250, `≥ 250 frases (hay ${total})`);
  for (const c of REQUIRED_CATEGORIES) ok(Array.isArray(PHRASES[c]) && PHRASES[c].length >= 6, `categoría ${c} con ≥ 6 variantes (${PHRASES[c]?.length ?? 0})`);
  ok(PHRASES.tips?.form === PHRASES['tips.form'], 'alias anidado PHRASES.tips.form');
  const full = { speed: 11.5, incline: 2, vam: 13.4, km: 3, dur: 90, lead: 10, pace: '5:13', i: 3, n: 8, stage: 5, min: 20, zone: 'fast', title: 'Pirámide', name: 'Nacho' };
  for (const c of cats) {
    const seen = new Set();
    PHRASES[c].forEach((t, i) => {
      ok(!seen.has(t), `${c}.${i} duplicada`);
      seen.add(t);
      for (const k of placeholdersOf(t)) ok(PLACEHOLDERS.includes(k), `${c}.${i}: marcador desconocido {${k}}`);
      const txt = fill(t, full);
      ok(!/[{}]|undefined|NaN|\s{2}/.test(txt), `${c}.${i} rellena mal: «${txt}»`);
      ok(/^[¡¿A-ZÁÉÍÓÚÑ0-9]/.test(txt), `${c}.${i} empieza en mayúscula: «${txt}»`);
      ok(!/\d/.test(speechText(txt)), `${c}.${i} speechText sin cifras: «${speechText(txt)}»`);
    });
  }
  // pick: respeta marcadores disponibles y no repite las 3 últimas
  const mem = new Map();
  const rng = makeRng(42);
  const recent = [];
  for (let k = 0; k < 40; k++) {
    const p = pick('motivation.general', rng, {}, { memory: mem });
    ok(!placeholdersOf(p.template).includes('name'), 'pick sin {name} si no hay nombre');
    ok(!recent.slice(-3).includes(p.id), `pick repite una de las 3 últimas (${p.id})`);
    recent.push(p.id);
  }
  const req = pick('finish', rng, { km: 3.2, min: 20 }, { memory: mem, require: ['km', 'min'] });
  ok(/kilómetros/.test(req.text), `pick con require usa estadísticas: «${req.text}»`);
  eq(pick('noexiste', rng).id, '', 'categoría inexistente');
  eq(JSON.stringify(fragmentsOf('Sube a {speed} kilómetros por hora')), JSON.stringify(['Sube a', '{speed}', 'kilómetros por hora']), 'fragmentsOf');
  eq(fill('¡Ahora! {zone}, {speed}. {dur}.', { zone: 'fast', speed: 11.5, dur: 120 }), '¡Ahora! Correr rápido, 11,5. Dos minutos.', 'fill ejemplo de la SPEC');
  eq(fill('{speed}', { speed: 13.0 }), '13', 'velocidad ,0 como entero');
  eq(fill('{speed}', { speed: '11,6' }), '11,6', 'velocidad como texto es-ES');
  eq(fill('Has hecho {km} kilómetros en {min} minutos.', { km: '1,0', min: 1 }), 'Has hecho 1 kilómetro en 1 minuto.', 'singular de unidades');
  eq(fill('Ritmo {pace}.', { pace: 11.5 }), 'Ritmo 5:13.', 'ritmo desde km/h');
}

/* ───────────── 2 · Números en palabras ───────────── */

section('Números en palabras');
{
  const ints = [[0, 'cero'], [1, 'uno'], [11, 'once'], [13, 'trece'], [15, 'quince'], [16, 'dieciséis'], [20, 'veinte'],
    [21, 'veintiuno'], [22, 'veintidós'], [26, 'veintiséis'], [30, 'treinta'], [31, 'treinta y uno'], [45, 'cuarenta y cinco'],
    [99, 'noventa y nueve'], [100, 'cien'], [101, 'ciento uno'], [115, 'ciento quince'], [200, 'doscientos'],
    [500, 'quinientos'], [999, 'novecientos noventa y nueve'], [1000, 'mil'], [1500, 'mil quinientos'], [2021, 'dos mil veintiuno'],
    [21000, 'veintiún mil']];
  for (const [n, w] of ints) eq(integerWords(n), w, `integerWords(${n})`);
  eq(integerWords(21, 'm'), 'veintiún', 'veintiún (masculino)');
  eq(integerWords(1, 'f'), 'una', 'una (femenino)');
  eq(integerWords(21, 'f'), 'veintiuna', 'veintiuna');
  eq(integerWords(31, 'm'), 'treinta y un', 'treinta y un');
  eq(integerWords(200, 'f'), 'doscientas', 'doscientas');
  const decs = [[11.5, 'once coma cinco'], [13.0, 'trece'], [8.3, 'ocho coma tres'], [10.1, 'diez coma uno'], [0.5, 'cero coma cinco'],
    [20, 'veinte'], [14.04, 'catorce'], [21.5, 'veintiuno coma cinco']];
  for (const [n, w] of decs) eq(numberWords(n), w, `numberWords(${n})`);
  eq(numberWords(4.23, 2), 'cuatro coma veintitrés', 'numberWords 2 decimales');
  eq(numberWords(4.05, 2), 'cuatro coma cero cinco', 'numberWords con cero decimal');
  const durs = [[0, 'cero segundos'], [1, 'un segundo'], [10, 'diez segundos'], [30, 'treinta segundos'], [60, 'un minuto'],
    [90, 'un minuto y treinta segundos'], [120, 'dos minutos'], [150, 'dos minutos y treinta segundos'],
    [1260, 'veintiún minutos'], [1281, 'veintiún minutos y veintiún segundos'], [3600, 'una hora'],
    [3900, 'una hora y cinco minutos'], [7200, 'dos horas']];
  for (const [n, w] of durs) eq(durationWords(n), w, `durationWords(${n})`);
}

/* ───────────── 3 · speechText ───────────── */

section('speechText');
{
  const cases = [
    ['13,0', 'trece'], ['11,5', 'once coma cinco'], ['A 13,0 km/h', 'A trece kilómetros por hora'],
    ['0:30', 'treinta segundos'], ['1:30', 'un minuto y treinta segundos'], ['Ritmo 5:13 por kilómetro', 'Ritmo cinco minutos y trece segundos por kilómetro'],
    ['1 serie', 'una serie'], ['21 series', 'veintiuna series'], ['21 minutos', 'veintiún minutos'], ['1 km', 'un kilómetro'],
    ['4,2 km', 'cuatro coma dos kilómetros'], ['Serie 1 de 8', 'Serie uno de ocho'], ['Escalón 5: 10,5', 'Escalón cinco: diez coma cinco'],
    ['Umbral 3×4', 'Umbral tres por cuatro'], ['Sprints 30/60', 'Sprints treinta, sesenta'], ['2 %', 'dos por ciento'],
    ['Inclinación al 1,5 por ciento', 'Inclinación al uno coma cinco por ciento'], ['320 kcal', 'trescientas veinte kilocalorías'],
    ['', ''],
  ];
  for (const [a, b] of cases) eq(speechText(a), b, `speechText(«${a}»)`);
}

/* ───────────── 4 · Programa de avisos ───────────── */

section('Programa de avisos');
const manifestIds = new Set(manifestClips().map((c) => c.id));
const stats = {};
for (const { name, w, strict } of WORKOUTS) {
  const segs = realSegments(w);
  const starts = [];
  let acc = 0;
  for (const s of segs) { starts.push(acc); acc += s.sec; }
  const total = acc;
  const validIdx = new Set(segs.map((s) => s.idx));
  const allowedDyn = new Set([textClipId(w.title || ''), textClipId('Nacho')]);
  for (const mode of MODES) {
    for (const lead of LEADS) {
      for (const seed of SEEDS) {
        const tag = `${name}/${mode}/lead ${lead}/seed ${seed}`;
        const opts = { chattiness: mode, announceLead: lead, name: seed === 2 ? 'Nacho' : '', seed };
        const cues = buildCueSchedule(w, opts);
        ok(Array.isArray(cues) && cues.length > 0, `${tag}: hay avisos`);
        ok(JSON.stringify(cues) === JSON.stringify(buildCueSchedule(w, opts)), `${tag}: determinista`);
        const spoken = cues.filter((c) => c.text);
        let prev = -Infinity;
        for (const c of cues) {
          ok(Number.isFinite(c.at) && c.at >= prev, `${tag}: orden por tiempo (${c.at})`);
          prev = c.at;
          ok(c.at >= 0 && c.at <= total, `${tag}: aviso fuera de [0, ${total}] (${c.kind} @ ${c.at})`);
          ok([1, 2, 3].includes(c.priority), `${tag}: prioridad inválida ${c.priority}`);
          ok(c.beep === null || c.beep === 'tick' || c.beep === 'go', `${tag}: beep inválido ${c.beep}`);
          ok(validIdx.has(c.segIndex), `${tag}: segIndex inválido ${c.segIndex}`);
          ok(typeof c.text === 'string', `${tag}: text no es string`);
          if (c.kind === 'tick') ok(c.text === '' && c.beep === 'tick', `${tag}: tick sin voz`);
          else ok(c.text.length > 0 && SPOKEN_KINDS.has(c.kind), `${tag}: aviso hablado vacío o de tipo raro (${c.kind})`);
          if (c.text) {
            ok(!/[{}]|undefined|NaN|null/.test(c.text), `${tag}: texto roto «${c.text}»`);
            ok(!/\d/.test(speechText(c.text)), `${tag}: cifras sin convertir «${speechText(c.text)}»`);
          }
          ok(c.clips === null || (Array.isArray(c.clips) && c.clips.length > 0), `${tag}: clips debe ser null o lista`);
          if (c.clips) for (const id of c.clips) ok(manifestIds.has(id) || allowedDyn.has(id), `${tag}: clip ${id} no está en el manifiesto («${c.text}»)`);
        }
        // sin solapes entre frases (estimación) y espaciado de las de prioridad 1
        if (strict) {
          for (let k = 1; k < spoken.length; k++) {
            const a = spoken[k - 1];
            const b = spoken[k];
            ok(a.at + estimateCueSec(a.text) <= b.at + 0.05, `${tag}: solape ${a.kind}@${a.at} (${estimateCueSec(a.text).toFixed(1)} s) → ${b.kind}@${b.at}`);
          }
          for (const c of spoken.filter((x) => x.priority === 1)) {
            ok(spoken.every((o) => o === c || Math.abs(o.at - c.at) >= 6), `${tag}: prioridad 1 a < 6 s de otra (${c.at})`);
          }
        }
        // inicio y final
        ok(cues[0].at === 0 && cues.some((c) => c.kind === 'intro' && c.at === 0), `${tag}: aviso de inicio en 0`);
        ok(cues.some((c) => c.kind === 'finish' && c.at === total && c.priority === 3), `${tag}: felicitación final`);
        ok(cues.find((c) => c.kind === 'intro')?.text.includes(spokenSpeed(segs[0].speed)), `${tag}: el inicio dice la primera velocidad`);
        // cambios de velocidad: pre-aviso, pitidos y "¡Ahora!"
        for (let k = 1; k < segs.length; k++) {
          const p = segs[k - 1];
          const n = segs[k];
          const T = starts[k];
          const speedCh = Math.abs(n.speed - p.speed) >= 0.05;
          const inclCh = Math.abs(n.incline - p.incline) >= 0.25;
          if (!speedCh && !inclCh) {
            ok(!cues.some((c) => c.at === T && c.beep === 'go'), `${tag}: pitido sin cambio en ${T}`);
            continue;
          }
          const ch = cues.find((c) => c.kind === 'change' && c.at === T);
          if (ok(ch && ch.priority === 3 && ch.beep === 'go', `${tag}: cambio en ${T}`) && speedCh) {
            ok(ch.text.includes(spokenSpeed(n.speed)), `${tag}: el cambio en ${T} dice ${spokenSpeed(n.speed)}: «${ch.text}»`);
            if (n.stage && w.isTest) ok(/scalón/.test(ch.text) && new RegExp(`\\b${n.stage}\\b`).test(ch.text), `${tag}: escalón ${n.stage} anunciado: «${ch.text}»`);
          }
          for (const d of [1, 2, 3]) ok(cues.some((c) => c.kind === 'tick' && c.at === T - d), `${tag}: tick en ${T - d}`);
          const pre = cues.find((c) => c.kind === 'pre' && c.at === T - lead);
          if (p.sec >= lead + 8) {
            if (ok(pre && pre.priority === 3, `${tag}: pre-aviso en ${T - lead}`) && speedCh) {
              ok(pre.text.includes(spokenSpeed(n.speed)), `${tag}: pre-aviso dice ${spokenSpeed(n.speed)}: «${pre.text}»`);
            }
          } else {
            ok(!pre, `${tag}: pre-aviso con segmento previo corto en ${T}`);
          }
        }
        ok(cues.filter((c) => c.kind === 'pre').every((c) => c.segIndex > 0), `${tag}: pre-avisos referidos al segmento siguiente`);
        // nivel de charla
        const kinds = new Set(cues.map((c) => c.kind));
        if (mode === 'minimal') {
          ok([...kinds].every((k) => ['intro', 'pre', 'tick', 'change', 'finish'].includes(k)), `${tag}: mínimo solo avisa de cambios (${[...kinds]})`);
          ok(!cues.some((c) => c.priority === 1), `${tag}: mínimo sin consejos`);
        }
        const tips = cues.filter((c) => c.kind === 'tip' || c.kind === 'motivation').length;
        stats[`${name}/${mode}`] = Math.max(stats[`${name}/${mode}`] ?? 0, tips);
        const hyd = cues.filter((c) => c.kind === 'hydration').length;
        if (total >= 45 * 60 && mode !== 'minimal') ok(hyd >= 2, `${tag}: hidratación en sesión larga (${hyd})`);
        if (total < 40 * 60) ok(hyd === 0, `${tag}: sin hidratación en sesión corta`);
        if (mode !== 'minimal' && strict) {
          // últimos 30 s y 10 s
          segs.forEach((s, k) => {
            const end = starts[k] + s.sec;
            if (k === segs.length - 1) return;
            if (s.zone === 'sprint' && s.sec >= 30 && Math.abs(lead - 10) > 3) {
              ok(cues.some((c) => c.kind === 'last10' && Math.abs(c.at - (end - 10)) <= 1.1), `${tag}: «¡Diez segundos!» en ${end - 10}`);
            }
            if (!w.isTest && ((s.zone === 'fast' || s.zone === 'sprint') && s.sec >= 60)) {
              const l30 = cues.find((c) => c.kind === 'last30' && c.segIndex === s.idx);
              ok(!l30 || Math.abs(l30.at - (end - 30)) <= 2, `${tag}: últimos 30 s mal colocados`);
            }
          });
          if (!w.isTest) {
            const hw = cues.find((c) => c.kind === 'halfWorkout');
            ok(hw && Math.abs(hw.at - total / 2) <= 30, `${tag}: mitad del entrenamiento`);
          }
        }
      }
    }
  }
}
for (const { name } of WORKOUTS) {
  ok((stats[`${name}/minimal`] ?? 0) === 0, `${name}: mínimo sin consejos`);
  ok((stats[`${name}/coach`] ?? 0) >= (stats[`${name}/normal`] ?? 0), `${name}: coach habla al menos tanto como normal`);
}
ok(stats['endurance50/normal'] >= 4, `endurance50: consejos en modo normal (${stats['endurance50/normal']})`);
ok(stats['hour60/coach'] > stats['hour60/normal'], `hour60: coach más consejos que normal (${stats['hour60/coach']} vs ${stats['hour60/normal']})`);
{
  const a = buildCueSchedule(intervals20(), { seed: 1 }).map((c) => c.text).join('|');
  const b = buildCueSchedule(intervals20(), { seed: 2 }).map((c) => c.text).join('|');
  ok(a !== b, 'seeds distintos ⇒ frases distintas');
  const noBeeps = buildCueSchedule(intervals20(), { beeps: false });
  ok(noBeeps.every((c) => c.beep === null && c.kind !== 'tick'), 'beeps:false ⇒ sin pitidos');
  const coachCues = buildCueSchedule(intervals20(), { chattiness: 'coach', seed: 3 });
  ok(coachCues.some((c) => c.kind === 'segCue'), 'modo coach incluye segment.cue');
  ok(coachCues.filter((c) => c.kind === 'change').some((c) => /última/i.test(c.text)), 'última serie anunciada');
  ok(buildCueSchedule(intervals20(), { seed: 3 }).filter((c) => c.kind === 'change').some((c) => /\b8\b/.test(c.text)), 'información de serie');
  const ends = buildCueSchedule(endurance50(), { seed: 3, chattiness: 'normal' });
  ok(ends.some((c) => c.kind === 'lastBlock'), 'último bloque en sesión por bloques');
  ok(ends.some((c) => c.kind === 'pre' && /inclinaci/i.test(c.text)), 'pre-aviso de inclinación');
  eq(buildCueSchedule(null).length, 0, 'workout nulo');
  eq(buildCueSchedule({ segments: [] }).length, 0, 'workout vacío');
  eq(buildCueSchedule({ segments: [{ zone: 'run', speed: 10, sec: 0 }] }).length, 0, 'solo segmentos de 0 s');
  const one = buildCueSchedule({ segments: [{ zone: 'run', speed: 10, sec: 300 }] }, { chattiness: 'minimal' });
  ok(one.length === 2 && one[0].kind === 'intro' && one[1].kind === 'finish', 'un único segmento: inicio y final');
}

/* ───────────── 5 · Clips y manifiesto ───────────── */

section('Clips y manifiesto');
{
  for (let k = 40; k <= 200; k++) {
    const ids = clipIdsFor('x', '{speed}', { speed: k / 10 });
    ok(ids && ids.every((id) => manifestIds.has(id)), `clip de velocidad ${k / 10}`);
  }
  for (let s = 5; s <= 3600; s += 5) {
    const ids = durationClipIds(s);
    ok(ids && ids.every((id) => manifestIds.has(id)), `clips de duración ${s}`);
  }
  for (let n = 0; n <= 200; n++) ok(manifestIds.has(`n_${n}`), `número ${n}`);
  for (const [cat, list] of Object.entries(PHRASES)) {
    list.forEach((t, i) => {
      const vars = { speed: 9.4, incline: 3, vam: 13.4, km: 3, dur: 75, lead: 10, pace: '5:40', i: 2, n: 6, stage: 4, min: 45, zone: 'run', title: 'Pirámide', name: 'Nacho' };
      const ids = clipIdsFor(`${cat}.${i}`, t, vars);
      if (!ok(Array.isArray(ids), `${cat}.${i}: clipIdsFor devuelve lista`)) return;
      const dyn = new Set([textClipId('Pirámide'), textClipId('Nacho')]);
      for (const id of ids) ok(manifestIds.has(id) || dyn.has(id), `${cat}.${i}: clip ${id} fuera del manifiesto`);
    });
  }
  eq(clipIdsFor('x', 'Has hecho {km} kilómetros', { km: 1 }), null, 'km = 1 con plural ⇒ sin clips (TTS)');
  eq(JSON.stringify(clipIdsFor('x', '{min} minutos', { min: 21 })), JSON.stringify(['nm_21', textClipId('minutos')]), 'veintiún minutos con clip masculino');
  try {
    const file = JSON.parse(await readFile(path.join(ROOT, 'audio', 'manifest.json'), 'utf8'));
    const fileIds = new Set((file.clips || []).map((c) => c.id));
    const missing = [...manifestIds].filter((id) => !fileIds.has(id));
    ok(missing.length === 0, `audio/manifest.json al día (faltan ${missing.length}: ejecuta node tools/build-audio-manifest.mjs)`);
    ok(typeof file.version === 'string' && file.count === file.clips.length, 'manifest.json: version y count');
    ok(file.clips.every((c) => typeof c.id === 'string' && typeof c.text === 'string' && c.text.trim()), 'manifest.json: clips { id, text }');
  } catch (err) {
    fail(`no se puede leer audio/manifest.json (${err.message})`);
  }
  try {
    const packs = JSON.parse(await readFile(path.join(ROOT, 'audio', 'packs', 'packs.json'), 'utf8'));
    ok(Array.isArray(packs), 'audio/packs/packs.json es una lista');
  } catch (err) {
    fail(`no se puede leer audio/packs/packs.json (${err.message})`);
  }
}

/* ───────────── 6 · Módulos de navegador en Node (sin DOM) ───────────── */

section('Sin DOM');
{
  ok(Array.isArray(spanishVoices()) && spanishVoices().length === 0, 'spanishVoices() vacío sin speechSynthesis');
  eq(defaultVoice(), null, 'defaultVoice() nulo sin voces');
  const unsub = onVoicesChanged(() => {});
  ok(typeof unsub === 'function', 'onVoicesChanged devuelve desuscripción');
  unsub();
  await speak('Hola');
  cancelSpeech();
  beep('tick');
  applyAudioSettings({ beeps: false, volume: 0.5, duckMusic: false });
  applyAudioSettings({ beeps: true, volume: 1, duckMusic: true });
  eq(isUnlocked(), false, 'isUnlocked() sin AudioContext');
  eq(hasClips(['n_1']), false, 'hasClips sin pack');
  const lp = await loadPack(null);
  ok(lp && lp.ok === false && lp.count === 0, 'loadPack(null)');
}

/* ───────────── 7 · Coach en tiempo real (simulado) ───────────── */

section('Coach en tiempo real');
{
  const w = intervals20();
  const said = [];
  const coach = createCoach(w, { chattiness: 'normal', name: 'Nacho', announceLead: 10, seed: 7, onCue: (c) => said.push(c) });
  const cues = coach.cues;
  const total = realSegments(w).reduce((n, s) => n + s.sec, 0);
  // reproducción normal hasta 300 s, en pasos de 250 ms
  for (let t = 0; t <= 300; t += 0.25) { coach.update(t); if (t % 2 === 0) await tick(); }
  await tick();
  const expect = cues.filter((c) => c.text && c.at <= 300);
  ok(said.length >= expect.filter((c) => c.priority >= 2).length, `dice los avisos importantes (${said.length}/${expect.length})`);
  const changes = said.filter((c) => c.kind === 'change').length;
  eq(changes, expect.filter((c) => c.kind === 'change').length, 'todos los cambios hasta 300 s');
  // salto grande (pantalla bloqueada 4 min): sin ráfaga, como mucho un cambio y nada de baja prioridad
  const before = said.length;
  coach.update(540.2);
  await tick(); await tick();
  const burst = said.slice(before);
  ok(burst.length <= 1, `tras un salto, como mucho un aviso (${burst.map((c) => c.kind)})`);
  ok(burst.every((c) => c.kind === 'change'), 'tras un salto solo vale el cambio vigente');
  // retroceso ⇒ seek silencioso
  const b2 = said.length;
  coach.update(100);
  await tick();
  eq(said.length, b2, 'retroceder no habla');
  coach.seek(700);
  await tick();
  eq(said.length, b2, 'seek no habla');
  // avisos dinámicos con los formatos que usa el reproductor
  const dyn = async (kind, vars) => { const n = said.length; await coach.say(kind, vars); await tick(); return said.slice(n).map((c) => c.text).join(' '); };
  ok(/3 kilómetros|Kilómetro 3|van 3/.test(await dyn('km', { km: 3, pace: '5:13' })), 'say km');
  ok(/11,6/.test(await dyn('adjust', { speed: '11,6' })), 'say adjust con texto es-ES');
  ok((await dyn('pause', {})).length > 0, 'say pause');
  ok((await dyn('resume', {})).length > 0, 'say resume');
  ok((await dyn('testEnd', { vam: '13,5' })).length > 0, 'say testEnd');
  ok((await dyn('motivation.hard', {})).length > 0, 'say con categoría del banco');
  eq(await dyn('desconocido', {}), '', 'say desconocido no habla');
  const fin = await dyn('finish', { km: '3,21', min: 20 });
  ok(/3,2 kilómetros/.test(fin) && /20 minutos/.test(fin), `say finish con cifras: «${fin}»`);
  const fin2 = await dyn('finish', { km: '3,21', min: 20 });
  ok(/3,2/.test(fin2), 'segundo finish: solo cifras');
  coach.update(total);
  await tick();
  ok(!said.slice(-1)[0] || said.slice(-1)[0].kind !== 'finish', 'el final programado no se repite tras say(finish)');
  // silencio
  coach.setMuted(true);
  const b3 = said.length;
  coach.seek(0);
  for (let t = 0; t <= 120; t += 0.5) coach.update(t);
  await tick();
  ok(said.slice(b3).length >= 0, 'en silencio no rompe');
  coach.setMuted(false);
  // cuenta atrás (voz del 2 al 0 en ~2 s)
  const t0 = Date.now();
  await coach.say('countdown', { n: 2, speed: '8,3' });
  ok(Date.now() - t0 >= 1900, 'countdown dura n segundos');
  coach.destroy();
  coach.update(10);
  await coach.say('km', { km: 1 });
  ok(true, 'destroy idempotente');

  // coach con voz desactivada: no habla pero tampoco falla
  const quiet = [];
  const c2 = createCoach(endurance50(), { voiceEnabled: false, beeps: false, chattiness: 'coach', onCue: (c) => quiet.push(c) });
  for (let t = 0; t <= 900; t += 1) c2.update(t);
  await tick();
  ok(quiet.length > 0, 'voiceEnabled:false sigue notificando subtítulos');
  c2.destroy();
  const c3 = createCoach(null, {});
  c3.update(5); c3.seek(2); await c3.say('km', { km: 1 }); c3.destroy();
  ok(true, 'coach sin workout');
}

/* ───────────── 8 · Pack grabado: programa de avisos ───────────── */

section('Pack grabado (Eva): programa de avisos');
const ALL_IDS = new Set(PACK_SCRIPT.map((c) => c.id));
// pack a medio generar: falta ~30 % de los clips (determinista)
const PARTIAL_IDS = new Set([...ALL_IDS].filter((id) => hashStr(`p|${id}`) % 10 >= 3));
// duraciones "reales" algo distintas de la estimación (como tras decodificar)
const fakeClipSec = (id) => estimateClipSec(id) * (0.72 + (hashStr(id) % 31) / 100);
const PACK_KINDS = new Set([...SPOKEN_KINDS, 'testPrompt', 'music']);
const TTS_KINDS = new Set(['intro', 'pre', 'change']);
const TIP_GROUPS_T = new Set(['form', 'breath', 'mind', 'hard', 'good', 'recover', 'music']);
const groupOfT = (id) => id.replace(/_\d+$/, '');
const inPackRange = (v) => v >= PACK_SPEED_MIN - 1e-9 && v <= PACK_SPEED_MAX + 1e-9;
const expectRep = (rep) => (rep.i >= rep.n ? 'rep_last' : `rep_${rep.i}`);

function realWorkouts() {
  const levels = { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 };
  const out = [];
  for (const t of TEMPLATES) {
    for (const minutes of t.durations) {
      for (const seed of [3, 11]) {
        const hasIncline = !!t.requiresIncline || (seed === 11 && minutes >= 45);
        const tm = { hasIncline, maxIncline: 12, minSpeed: 1.0, maxSpeed: 18.0, announceLead: 10 };
        const w = buildWorkout(t.id, { minutes, levels, seed, loadFactor: seed === 3 ? 1 : 1.16, hasIncline, treadmill: tm });
        if (w && w.segments?.length) out.push({ name: `${t.id}/${minutes}/s${seed}`, w });
      }
    }
  }
  return out;
}

function checkPackSchedule(tag, w, cues, { avail, clipSec, mode, lead, watch, strict }) {
  const segs = realSegments(w);
  const starts = [];
  let acc = 0;
  for (const s of segs) { starts.push(acc); acc += s.sec; }
  const total = acc;
  const validIdx = new Set(segs.map((s) => s.idx));
  const durOf = (c) => (c.clips ? clipSequenceSec(c.clips, clipSec) : estimateCueSec(c.text));
  const spoken = cues.filter((c) => c.text);
  let prev = -Infinity;
  for (const c of cues) {
    ok(Number.isFinite(c.at) && c.at >= prev && c.at >= 0 && c.at <= total, `${tag}: orden/rango (${c.kind} @ ${c.at})`);
    prev = c.at;
    ok(validIdx.has(c.segIndex), `${tag}: segIndex inválido ${c.segIndex}`);
    if (c.kind === 'tick') { ok(c.text === '' && c.beep === 'tick' && c.clips === null, `${tag}: tick sin voz`); continue; }
    ok(PACK_KINDS.has(c.kind), `${tag}: tipo raro ${c.kind}`);
    if (c.voice === 'pack') {
      ok(Array.isArray(c.clips) && c.clips.length > 0 && c.clips.every((id) => avail.has(id)), `${tag}: ${c.kind}@${c.at} con clips fuera del pack (${c.clips})`);
      ok(c.text && c.text.toLowerCase() === clipsText(c.clips).toLowerCase(), `${tag}: subtítulo del pack «${c.text}»`);
    } else {
      // voz del sistema: aviso entero, sin un solo clip, y solo para cambios de tramo
      ok(c.voice === 'tts' && c.clips === null, `${tag}: ${c.kind}@${c.at} mezcla clips y voz del sistema`);
      ok(TTS_KINDS.has(c.kind), `${tag}: ${c.kind}@${c.at} con voz del sistema (debería omitirse)`);
      ok(!/\d/.test(speechText(c.text)), `${tag}: TTS con cifras «${c.text}»`);
    }
  }
  // espaciado con las duraciones de los clips
  if (strict) {
    for (let k = 1; k < spoken.length; k++) {
      const a = spoken[k - 1];
      const b = spoken[k];
      ok(a.at + durOf(a) <= b.at + 0.05, `${tag}: solape ${a.kind}@${a.at} (${durOf(a).toFixed(2)} s) → ${b.kind}@${b.at}`);
    }
    for (const c of spoken.filter((x) => x.priority === 1)) {
      ok(spoken.every((o) => o === c || Math.abs(o.at - c.at) >= 6), `${tag}: prioridad 1 a < 6 s de otra (${c.at})`);
    }
  }
  // inicio
  const intro = cues.find((c) => c.kind === 'intro');
  ok(intro && intro.at === 0 && cues[0].at === 0, `${tag}: aviso de inicio en 0`);
  if (intro && avail === ALL_IDS && inPackRange(segs[0].speed)) {
    if (ok(intro.voice === 'pack', `${tag}: inicio con el pack`)) {
      ok(intro.clips.slice(-2).join() === `set_1,${speedClip(segs[0].speed)}`, `${tag}: inicio "Pon la cinta a…" + 1ª velocidad (${intro.clips})`);
      const room = (starts.find((s, k) => k > 0 && (Math.abs(segs[k].speed - segs[k - 1].speed) >= 0.05)) ?? total) - lead;
      if (room > 16) {
        ok(intro.clips.includes('watch_1') === !!watch, `${tag}: recordatorio del Watch ${watch ? 'presente' : 'ausente'} (${intro.clips})`);
        if (mode !== 'minimal') ok(intro.clips.some((id) => id.startsWith('intro_')), `${tag}: inicio con la categoría (${intro.clips})`);
      }
      if (mode === 'minimal') ok(!intro.clips.some((id) => id.startsWith('intro_')), `${tag}: mínimo sin presentación`);
    }
  } else if (intro && !inPackRange(segs[0].speed)) {
    ok(intro.voice === 'tts', `${tag}: inicio a ${segs[0].speed} con voz del sistema`);
  }
  // cambios de tramo
  for (let k = 1; k < segs.length; k++) {
    const p = segs[k - 1];
    const n = segs[k];
    const T = starts[k];
    const speedCh = Math.abs(n.speed - p.speed) >= 0.05;
    const inclCh = Math.abs(n.incline - p.incline) >= 0.25;
    const repStart = !!n.rep && n.rep.n > 1 && (!p.rep || p.rep.i !== n.rep.i || p.rep.n !== n.rep.n);
    const pre = cues.find((c) => c.kind === 'pre' && c.at === T - lead);
    const ch = cues.find((c) => c.kind === 'change' && c.segIndex === n.idx);
    const sc = speedClip(n.speed);
    const canPack = inPackRange(n.speed) && !inclCh;
    if (speedCh || inclCh) {
      ok(ch && ch.at === T && ch.priority === 3 && ch.beep === 'go', `${tag}: cambio en ${T}`);
      for (const d of [1, 2, 3]) if (T - d > starts[k - 1]) ok(cues.some((c) => c.kind === 'tick' && c.at === T - d), `${tag}: tick en ${T - d}`);
      if (p.sec >= lead + 8) ok(pre && pre.priority === 3 && pre.segIndex === n.idx, `${tag}: pre-aviso en ${T - lead}`);
      else ok(!pre, `${tag}: pre-aviso con segmento previo corto en ${T}`);
    }
    for (const c of [pre, ch]) {
      if (!c) continue;
      if (!canPack) ok(c.voice === 'tts', `${tag}: ${c.kind}@${c.at} a ${n.speed}${inclCh ? ' con inclinación' : ''} debe ir con voz del sistema`);
      else if (avail === ALL_IDS) ok(c.voice === 'pack', `${tag}: ${c.kind}@${c.at} a ${n.speed} no se compuso con el pack («${c.text}»)`);
      if (c.voice === 'pack') {
        ok(c.clips.includes(sc), `${tag}: ${c.kind}@${c.at} dice ${n.speed} (${c.clips})`);
        if (c.kind === 'pre') ok(c.clips[c.clips.length - 1] === sc, `${tag}: el pre-aviso acaba en la velocidad (${c.clips})`);
        if (c.kind === 'change' && w.isTest && n.stage > 0) ok(c.clips[0] === `stage_${n.stage}` || (!avail.has(`stage_${n.stage}`) && /^up_\d$/.test(c.clips[0])), `${tag}: escalón ${n.stage} compuesto (${c.clips})`);
      }
    }
    if (w.isTest && n.stage > 0 && n.stage <= 16 && inPackRange(n.speed) && avail === ALL_IDS && ch) {
      ok(ch.voice === 'pack' && ch.clips.join() === `stage_${n.stage},${sc}`, `${tag}: escalón ${n.stage} = [stage, velocidad] (${ch.clips})`);
    }
    // información de serie: en el pre-aviso o, si no cabe allí, en el cambio; nunca en las dos ni fuera de sitio
    const reps = [pre, ch].filter((c) => c?.voice === 'pack').flatMap((c) => c.clips.filter((id) => id.startsWith('rep_')));
    if (!repStart) ok(reps.length === 0, `${tag}: serie anunciada sin empezar serie en ${T} (${reps})`);
    else {
      ok(reps.length <= 1, `${tag}: serie anunciada dos veces en ${T} (${reps})`);
      if (reps.length) ok(reps[0] === expectRep(n.rep), `${tag}: serie ${n.rep.i}/${n.rep.n} → ${reps[0]}`);
      const packPre = pre?.voice === 'pack';
      const want = expectRep(n.rep);
      if (avail === ALL_IDS && ALL_IDS.has(want) && packPre && ch?.voice === 'pack' && lead >= 10) {
        ok(reps.length === 1, `${tag}: serie ${n.rep.i}/${n.rep.n} anunciada en ${T}`);
      }
    }
  }
  // nivel de charla
  const kinds = new Set(cues.map((c) => c.kind));
  if (mode === 'minimal') {
    ok([...kinds].every((k) => ['intro', 'pre', 'tick', 'change', 'finish'].includes(k)), `${tag}: mínimo solo avisa de cambios (${[...kinds]})`);
    ok(!cues.some((c) => c.priority === 1), `${tag}: mínimo sin consejos`);
  }
  if (w.isTest && mode !== 'minimal' && avail === ALL_IDS) ok(kinds.has('testPrompt'), `${tag}: el test explica cómo terminar`);
  // variantes: consejos ≤ 2 usos y nunca la misma variante dos veces seguidas en un grupo
  const uses = new Map();
  const lastIn = new Map();
  for (const c of spoken.filter((x) => x.voice === 'pack')) {
    for (const id of c.clips) {
      const g = groupOfT(id);
      if (!TIP_GROUPS_T.has(g)) continue;
      uses.set(id, (uses.get(id) || 0) + 1);
      ok(lastIn.get(g) !== id, `${tag}: ${id} repetido seguido`);
      lastIn.set(g, id);
    }
  }
  for (const [id, n] of uses) ok(n <= 2, `${tag}: ${id} usado ${n} veces`);
  return { pack: spoken.filter((c) => c.voice === 'pack').length, tts: spoken.filter((c) => c.voice === 'tts').length };
}

const packStats = { pack: 0, tts: 0, schedules: 0, fullPack: 0, fullTts: 0 };
{
  const real = realWorkouts();
  ok(real.length >= 100, `clases reales para probar (${real.length})`);
  const t0 = Date.now();
  real.forEach(({ name, w }, wi) => {
    const leads = wi % 5 === 0 ? [5, 10, 15] : [10];
    for (const mode of MODES) {
      for (const lead of leads) {
        const sets = wi % 2 === 0 ? [ALL_IDS, PARTIAL_IDS] : [ALL_IDS];
        for (const avail of sets) {
          const clipSec = wi % 3 === 0 ? null : fakeClipSec;
          const watch = wi % 4 !== 1;
          const music = wi % 3 === 1;
          const opts = { chattiness: mode, announceLead: lead, seed: wi + 1, name: wi % 3 === 0 ? 'Nacho' : '', pack: { available: avail, clipSec }, watch, music };
          const cues = buildCueSchedule(w, opts);
          const tag = `${name}/${mode}/lead ${lead}/${avail === ALL_IDS ? 'completo' : 'parcial'}`;
          if (wi % 7 === 0) ok(JSON.stringify(cues) === JSON.stringify(buildCueSchedule(w, opts)), `${tag}: determinista`);
          const r = checkPackSchedule(tag, w, cues, { avail, clipSec, mode, lead, watch, strict: true });
          packStats.pack += r.pack;
          packStats.tts += r.tts;
          packStats.schedules++;
          if (avail === ALL_IDS) { packStats.fullPack += r.pack; packStats.fullTts += r.tts; }
          if (!music) ok(!cues.some((c) => c.kind === 'music'), `${tag}: sin música de la app no hay comentarios de música`);
        }
      }
    }
  });
  process.stdout.write(`  ${packStats.schedules} programas · ${packStats.pack} avisos con el pack · ${packStats.tts} con voz del sistema · ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
  ok(packStats.fullTts < (packStats.fullPack + packStats.fullTts) * 0.1, `con el pack completo, < 10 % con voz del sistema (${packStats.fullTts}/${packStats.fullPack + packStats.fullTts})`);

  // entrenamientos sintéticos de las secciones anteriores (incluidos los raros)
  for (const { name, w, strict } of WORKOUTS) {
    for (const mode of MODES) {
      for (const lead of LEADS) {
        for (const avail of [ALL_IDS, PARTIAL_IDS]) {
          const opts = { chattiness: mode, announceLead: lead, seed: 2, pack: { available: avail, clipSec: fakeClipSec }, watch: true };
          checkPackSchedule(`${name}/${mode}/lead ${lead}/${avail === ALL_IDS ? 'completo' : 'parcial'}`, w, buildCueSchedule(w, opts), { avail, clipSec: fakeClipSec, mode, lead, watch: true, strict });
        }
      }
    }
  }

  // velocidades fuera de 6,0–15,5 ⇒ voz del sistema; los extremos del rango, con el pack
  const range = {
    title: 'Rango', category: 'intervals',
    segments: [
      { zone: 'warmup', speed: 5.5, sec: 120 }, { zone: 'warmup', speed: 6.0, sec: 120 }, { zone: 'run', speed: 10, sec: 120 },
      { zone: 'sprint', speed: 15.5, sec: 60 }, { zone: 'jog', speed: 8.3, sec: 90 }, { zone: 'sprint', speed: 16.0, sec: 60 },
      { zone: 'jog', speed: 8.3, sec: 90 }, { zone: 'sprint', speed: 18.0, sec: 60 }, { zone: 'jog', speed: 8.3, sec: 90 },
      { zone: 'cooldown', speed: 5.9, sec: 120 },
    ],
  };
  const rc = buildCueSchedule(range, { chattiness: 'normal', seed: 4, pack: { available: ALL_IDS }, watch: false });
  const at = (kind, T) => rc.find((c) => c.kind === kind && c.at === T);
  eq(rc.find((c) => c.kind === 'intro')?.voice, 'tts', 'inicio a 5,5 con voz del sistema');
  eq(at('change', 120)?.voice, 'pack', 'cambio a 6,0 con el pack');
  ok(at('change', 120)?.clips.includes('s_60'), 'clip s_60');
  eq(at('change', 360)?.voice, 'pack', 'cambio a 15,5 con el pack');
  eq(at('pre', 350)?.clips.slice(-2).join(), 'sprintpre_1,s_155', 'pre-aviso de sprint a 15,5');
  eq(at('change', 510)?.voice, 'tts', 'cambio a 16 con voz del sistema');
  eq(at('pre', 500)?.voice, 'tts', 'pre-aviso a 16 con voz del sistema');
  ok(/16/.test(at('change', 510)?.text || ''), `el aviso de 16 lo dice entero: «${at('change', 510)?.text}»`);
  eq(at('change', 660)?.voice, 'tts', 'cambio a 18 con voz del sistema');
  eq(at('change', 810)?.voice, 'tts', 'vuelta a la calma a 5,9 con voz del sistema');
  eq(at('change', 570)?.voice, 'pack', 'recuperación tras sprint fuera de rango, con el pack');
  ok(at('change', 570)?.clips[0] === 'now_jog_1', `"Trote. Recupera." tras un sprint (${at('change', 570)?.clips})`);
  const warmJog = buildCueSchedule({ segments: [{ zone: 'warmup', speed: 7.1, sec: 120 }, { zone: 'jog', speed: 8.3, sec: 120 }] }, { pack: { available: ALL_IDS } });
  ok(warmJog.find((c) => c.kind === 'change')?.clips[0] === 'now_jog_2', '"Ahora, trote suave." tras calentar');

  // vuelta a la calma: la primera dice "¡Buen trabajo! Empezamos la vuelta a la calma."
  const cool = buildCueSchedule(intervals20(), { seed: 1, pack: { available: ALL_IDS } });
  const coolCh = cool.find((c) => c.kind === 'change' && c.segIndex === intervals20().segments.length - 1);
  ok(coolCh?.voice === 'pack' && coolCh.clips[0] === 'cooldownstart_1' && coolCh.clips.includes('s_65'), `inicio de la vuelta a la calma (${coolCh?.clips})`);
  // 'now' con duración solo cuando coincide con una grabada
  const nowDur = buildCueSchedule({ segments: [{ zone: 'run', speed: 10, sec: 120 }, { zone: 'fast', speed: 11.5, sec: 120 }, { zone: 'jog', speed: 8.3, sec: 205 }, { zone: 'run', speed: 10, sec: 60 }] }, { pack: { available: ALL_IDS } });
  eq(nowDur.find((c) => c.kind === 'change' && c.at === 120)?.clips.slice(-2).join(), 's_115,dur_120', '"Dos minutos." cuando coincide');
  ok(!nowDur.find((c) => c.kind === 'change' && c.at === 240)?.clips.some((id) => id.startsWith('dur_')), 'sin duración si no coincide (205 s)');
  eq(durationClip(205), null, 'durationClip(205)');
  // sin pack o con un pack sin clips del guion ⇒ programa de voz del sistema idéntico al de siempre
  const plain = JSON.stringify(buildCueSchedule(intervals20(), { seed: 5 }));
  eq(JSON.stringify(buildCueSchedule(intervals20(), { seed: 5, pack: null })), plain, 'pack null ⇒ programa de siempre');
  eq(JSON.stringify(buildCueSchedule(intervals20(), { seed: 5, pack: { available: ['n_1', 't_xx'] } })), plain, 'pack sin clips del guion ⇒ programa de siempre');
  ok(!buildCueSchedule(intervals20(), { seed: 5 }).some((c) => 'voice' in c), 'el programa de voz del sistema no cambia de forma');
  // pack casi vacío: solo velocidades y portadoras ⇒ cambios con voz del sistema, sin consejos
  const tiny = new Set([...ALL_IDS].filter((id) => /^s_|^(up|down|sprintpre|recoverpre|set)_/.test(id)));
  const tc = buildCueSchedule(endurance50(), { chattiness: 'coach', seed: 1, pack: { available: tiny } });
  ok(tc.some((c) => c.kind === 'pre' && c.voice === 'pack'), 'pre-avisos con el pack mínimo');
  ok(tc.filter((c) => c.kind === 'change').every((c) => c.voice === 'tts'), 'sin clips de "¡Ahora!" ⇒ cambios con voz del sistema');
  // «Trote. Recupera.» (now_jog_1) nunca en un trote que no viene de un tramo duro (pack de Eva: sin now_jog_2)
  const evaLike = new Set([...ALL_IDS].filter((id) => id !== 'now_jog_2'));
  const wj = { segments: [{ zone: 'warmup', speed: 6.5, sec: 120 }, { zone: 'jog', speed: 8.3, sec: 120 }, { zone: 'fast', speed: 11.5, sec: 120 }, { zone: 'jog', speed: 8.3, sec: 120 }, { zone: 'run', speed: 10, sec: 60 }] };
  for (const seed of [1, 2, 3, 4, 5]) {
    const cj = buildCueSchedule(wj, { chattiness: 'coach', seed, pack: { available: evaLike } });
    const first = cj.find((c) => c.kind === 'change' && c.at === 120);
    ok(first && !first.clips?.includes('now_jog_1'), `seed ${seed}: el primer trote no dice «Trote. Recupera.»`);
    const after = cj.find((c) => c.kind === 'change' && c.at === 360);
    ok(!!after?.clips?.includes('now_jog_1'), `seed ${seed}: el trote tras un tramo duro sí dice «Trote. Recupera.»`);
  }
  ok(tc.every((c) => !c.text || TTS_KINDS.has(c.kind) || c.voice === 'pack'), 'lo que no se compone se omite');
  ok(!tc.some((c) => c.kind === 'tip' || c.kind === 'motivation'), 'sin consejos grabados ⇒ sin consejos');
  ok(tc.find((c) => c.kind === 'intro')?.voice === 'pack', `inicio con "Pon la cinta a…" (${tc.find((c) => c.kind === 'intro')?.clips})`);
}

/* ───────────── 9 · Coach en tiempo real con el pack (simulado) ───────────── */

section('Pack grabado: coach en tiempo real');
{
  const said = [];
  const w = intervals20();
  const coach = createCoach(w, { voiceEnabled: false, chattiness: 'normal', seed: 3, pack: { available: ALL_IDS }, onCue: (c) => said.push(c) });
  eq(coach.voice, 'pack', 'coach con pack inyectado');
  for (let t = 0; t <= 400; t += 0.25) coach.update(t);
  await tick();
  ok(said.length > 5 && said.every((c) => c.voice === 'pack' || (c.voice === 'tts' && !c.clips)), `avisos notificados con el pack (${said.length})`);
  const dyn = async (kind, vars) => { const n = said.length; await coach.say(kind, vars); await tick(); return said.slice(n); };
  eq((await dyn('km', { km: 3, pace: '5:13' }))[0]?.clips?.join(), 'km_3', 'say km con el pack');
  eq((await dyn('km', { km: 22 })).length, 0, 'km fuera del pack ⇒ se omite');
  eq((await dyn('adjust', { speed: '11,6' }))[0]?.clips?.join(), 's_116', 'say adjust ⇒ "Once coma seis."');
  const res = (await dyn('resume', { speed: '8,3' }))[0];
  ok(res && /^resume_\d$/.test(res.clips[0]) && res.clips[1] === 's_83', `say resume + velocidad (${res?.clips})`);
  eq((await dyn('pause', {}))[0]?.clips?.join(), 'pause_1', 'say pause');
  eq((await dyn('testEnd', { vam: '13,5' }))[0]?.clips?.join(), 'testend_1', 'say testEnd');
  eq((await dyn('testStage', { stage: 4, speed: '9,5' }))[0]?.clips?.join(), 'stage_4,s_95', 'say testStage');
  const ts = (await dyn('testStage', { stage: 19, speed: '17' }))[0];
  ok(ts && ts.voice === 'tts' && ts.clips === null && /17/.test(ts.text), 'testStage fuera del pack ⇒ voz del sistema entera');
  ok(/^hard_\d$/.test((await dyn('motivation.hard', {}))[0]?.clips?.[0] || ''), 'say motivation.hard');
  eq((await dyn('desconocido', {})).length, 0, 'say desconocido no habla');
  const fin = await dyn('finish', { km: '3,21', min: 20 });
  ok(fin.length === 1 && /^finish_\d$/.test(fin[0].clips[0]), 'say finish con el pack');
  eq((await dyn('finish', { km: '3,21', min: 20 })).length, 0, 'segundo finish no se repite');
  coach.destroy();

  // con voz: en Node no hay WebAudio ⇒ el pack falla, los cambios caen enteros a la voz del sistema y,
  // tras dos fallos, toda la sesión pasa a la voz del sistema sin romper nada
  const heard = [];
  const c2 = createCoach(w, { chattiness: 'coach', seed: 3, pack: { available: ALL_IDS }, onCue: (c) => heard.push(c) });
  for (let t = 0; t <= 200; t += 0.25) { c2.update(t); if (t % 1 === 0) await tick(); }
  await tick(); await tick();
  eq(c2.voice, 'tts', 'tras fallar el pack, voz del sistema');
  ok(c2.cues.every((c) => !('voice' in c)), 'programa rehecho con la voz del sistema');
  ok(heard.some((c) => c.kind === 'change'), 'los cambios siguen avisándose');
  c2.destroy();
  // countdown con pack inyectado y voz desactivada: dura n segundos
  const c3 = createCoach(w, { voiceEnabled: false, pack: { available: ALL_IDS } });
  const t0 = Date.now();
  await c3.say('countdown', { n: 1 });
  ok(Date.now() - t0 >= 900, 'countdown sin voz dura n segundos');
  c3.destroy();

  // App nativa de iPhone: la clase NUNCA usa la voz del sistema (speechSynthesis suena en el proceso de la app y su
  // sesión de audio podía interrumpir el audio de la página: clase en pausa o muda). Solo clips; si faltan, se calla.
  const spoken = [];
  globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  globalThis.speechSynthesis = {
    getVoices: () => [], speak: (u) => { spoken.push(u.text); setTimeout(() => u.onend?.(), 1); },
    cancel() { spoken.push('·cancel'); }, resume() {}, paused: false, addEventListener() {}, removeEventListener() {},
  };
  const run = async (c, to) => { for (let t = 0; t <= to; t += 0.25) { c.update(t); if (t % 1 === 0) await tick(); } await tick(); await tick(); };
  // con el pack, aunque fallen los clips (en Node no hay WebAudio): ni se da por roto ni cae a la voz del sistema
  const nat = [];
  const c4 = createCoach(w, { chattiness: 'coach', seed: 3, systemVoice: false, pack: { available: ALL_IDS }, onCue: (c) => nat.push(c) });
  await run(c4, 200);
  eq(c4.voice, 'pack', 'app nativa: aunque fallen los clips, el pack no se da por roto');
  ok(nat.some((c) => c.kind === 'change'), 'app nativa: los cambios siguen en los subtítulos');
  await c4.say('pause', {});
  await c4.say('km', { km: 2 });
  await c4.say('countdown', { n: 1 });
  c4.destroy();
  eq(spoken.join(' | '), '', 'app nativa con pack: nunca speechSynthesis (ni speak ni cancel)');
  // sin pack (en Safari sería la voz del sistema): avisos, cuenta atrás y pausa se callan; los subtítulos siguen
  const nat2 = [];
  const c5 = createCoach(w, { chattiness: 'normal', seed: 3, systemVoice: false, onCue: (c) => nat2.push(c) });
  eq(c5.voice, 'tts', 'app nativa sin pack: programa de la voz del sistema…');
  await run(c5, 200);
  await c5.say('km', { km: 3 });
  await c5.say('pause', {});
  await c5.say('countdown', { n: 1 });
  c5.setMuted(true);
  c5.destroy();
  ok(nat2.length > 3, '…con sus subtítulos');
  eq(spoken.join(' | '), '', '…pero sin hablar con ella');
  // detección automática: con window.webkit.messageHandlers.bestrunning (la app nativa) no hay voz del sistema
  globalThis.webkit = { messageHandlers: { bestrunning: { postMessage() {} } } };
  const c6 = createCoach(w, { chattiness: 'normal', seed: 3 });
  await run(c6, 120);
  await c6.say('km', { km: 1 });
  c6.destroy();
  delete globalThis.webkit;
  eq(spoken.join(' | '), '', 'app nativa detectada sola: sin voz del sistema');
  // Safari: igual que siempre (sin pack, habla la voz del sistema)
  const c7 = createCoach(w, { chattiness: 'normal', seed: 3 });
  await run(c7, 120);
  await c7.say('km', { km: 1 });
  c7.destroy();
  ok(spoken.some((x) => x !== '·cancel'), `Safari: la voz del sistema sigue hablando sin pack (${spoken.length})`);
  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
}

/* ───────────── 10 · Motor de audio sobre WebAudio simulado ───────────── */

section('Motor de audio (WebAudio simulado)');
{
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const SR = 8000;
  const SCRIPT = new Map(PACK_SCRIPT.map((c) => [c.id, c]));
  // "mp3" simulado: silencio 50 ms · voz (0,06 s por carácter) · 300 ms de silencio
  const VOICED = (id) => (SCRIPT.get(id)?.text.length || 10) * 0.06;
  class Param { constructor(v) { this.value = v; } setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {} cancelScheduledValues() {} setTargetAtTime() {} }
  class Node { connect() {} disconnect() {} }
  class Buf {
    constructor(ch, len, sr) { this.numberOfChannels = ch; this.length = len; this.sampleRate = sr; this.duration = len / sr; this.d = Array.from({ length: ch }, () => new Float32Array(len)); }
    getChannelData(c) { return this.d[c]; }
    copyToChannel(src, c) { this.d[c].set(src.subarray(0, this.length)); }
  }
  const started = [];
  class Ctx {
    constructor() { this.state = 'suspended'; this.sampleRate = SR; this.t0 = performance.now(); this.destination = new Node(); }
    get currentTime() { return (performance.now() - this.t0) / 1000; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    createGain() { const n = new Node(); n.gain = new Param(1); return n; }
    createDynamicsCompressor() { const n = new Node(); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0); return n; }
    createBuffer(ch, len, sr) { return new Buf(ch, len, sr); }
    createOscillator() { const n = new Node(); n.frequency = new Param(0); n.start = () => {}; n.stop = () => { setTimeout(() => n.onended?.(), 1); }; return n; }
    createBufferSource() {
      const s = new Node();
      s.start = (at) => { started.push({ at, buffer: s.buffer }); setTimeout(() => s.onended?.(), 3); };
      s.stop = () => {};
      return s;
    }
    decodeAudioData(arr, okCb, errCb) {
      const id = dec.decode(arr);
      if (!SCRIPT.has(id)) { const e = new Error('mp3'); errCb?.(e); return Promise.reject(e); }
      const pieces = id === 'countdown_1'
        ? [[0.05, 0], [0.3, 1], [0.2, 0], [0.28, 1], [0.18, 0], [0.32, 1], [0.38, 0], [0.45, 1], [0.3, 0]]
        : [[0.05, 0], [VOICED(id), 1], [0.3, 0]];
      const len = Math.round(pieces.reduce((a, [d]) => a + d, 0) * SR);
      const b = new Buf(1, len, SR);
      const data = b.getChannelData(0);
      let i = 0;
      for (const [d, v] of pieces) { const n = Math.round(d * SR); for (let k = 0; k < n && i < len; k++, i++) data[i] = v ? 0.5 * Math.sin(k * 0.3) : 0; }
      okCb?.(b);
      return Promise.resolve(b);
    }
  }
  let indexFetches = 0;
  globalThis.AudioContext = Ctx;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/eva/index.json')) { indexFetches++; return { ok: true, json: async () => ({ id: 'eva', name: 'Eva Dorado', clips: [...ALL_IDS] }) }; }
    const m = /\/eva\/([\w]+)\.mp3$/.exec(u);
    if (m && m[1] === 'hard_3') await new Promise((r) => setTimeout(r, 40)); // descarga lenta
    if (m && ALL_IDS.has(m[1])) return { ok: true, arrayBuffer: async () => enc.encode(m[1]).buffer };
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const session = { type: 'auto' };
  try { globalThis.navigator.audioSession = session; } catch { /* navegador sin extensión */ }
  const voiceEvents = [];
  globalThis.window = new EventTarget();
  globalThis.window.addEventListener('br:voice', (e) => voiceEvents.push(e.detail.speaking));

  // br:voice con varias voces solapadas: un único false al final
  signalVoice(true); signalVoice(true); signalVoice(false);
  ok(isVoiceActive(), 'voz activa mientras quede alguna');
  signalVoice(false);
  eq(voiceEvents.join(), 'true,true,false', 'br:voice: true por inicio, false solo al callar todas');
  signalVoice(false);
  eq(voiceEvents.length, 3, 'false sobrante no emite');
  voiceEvents.length = 0;

  // speak() emite br:voice alrededor de la frase
  class Utt { constructor(t) { this.text = t; } }
  globalThis.SpeechSynthesisUtterance = Utt;
  globalThis.speechSynthesis = { getVoices: () => [], speak: (u) => setTimeout(() => u.onend?.(), 5), cancel() {}, resume() {}, paused: false, addEventListener() {}, removeEventListener() {} };
  await speak('Hola');
  eq(voiceEvents.join(), 'true,false', 'speak() emite br:voice true/false');
  voiceEvents.length = 0;

  // pack: carga compartida, formato grabado, sesión
  const [r1, r2] = await Promise.all([loadPack('eva'), loadPack('eva')]);
  eq(indexFetches, 1, 'cargas simultáneas comparten index.json');
  ok(r1.ok && r2.ok && r1.voice && r1.count === ALL_IDS.size, 'loadPack(eva) ok, pack grabado');
  eq(currentPackId(), 'eva', 'currentPackId');
  ok(packInfo()?.voice && packInfo().clips.size === ALL_IDS.size, 'packInfo');
  const unlocked = await unlockAudio();
  ok(unlocked && isUnlocked(), 'unlockAudio con WebAudio simulado');
  eq(session.type, 'transient', 'sesión transient con duckMusic');
  const ctx = getAudioContext();
  ok(ctx instanceof Ctx && getAudioContext() === ctx, 'getAudioContext devuelve el contexto compartido');
  eq(setAudioSessionType('playback'), 'playback', 'setAudioSessionType(playback)');
  eq(session.type, 'playback', 'navigator.audioSession.type = playback');
  eq(setAudioSessionType('auto'), 'transient', "setAudioSessionType('auto') vuelve a duckMusic");
  eq(setAudioSessionType('raro'), 'transient', 'tipo desconocido ⇒ auto');

  // encadenado: portadora → número con ~40 ms (la portadora trae su cola); fin de frase → respiro
  started.length = 0;
  await playClips(['up_1', 's_115', 'dur_120']);
  eq(voiceEvents.join(), 'true,false', 'playClips emite br:voice');
  voiceEvents.length = 0;
  eq(started.length, 3, 'tres clips programados');
  const g1 = started[1].at - (started[0].at + started[0].buffer.duration);
  const g2 = started[2].at - (started[1].at + started[1].buffer.duration);
  ok(Math.abs(g1 - clipGapAfter('up_1')) < 0.002 && clipGapAfter('up_1') <= 0.05, `pausa portadora→número ${g1.toFixed(3)} s`);
  ok(Math.abs(g2 - clipGapAfter('s_115')) < 0.002 && g2 > 0.12, `pausa tras fin de frase ${g2.toFixed(3)} s`);
  // recorte: cabeza ~12 ms, cola 170 ms en portadoras y 60 ms en el resto
  const dUp = clipDuration('up_1');
  const dNum = clipDuration('s_115');
  ok(Math.abs(dUp - (VOICED('up_1') + 0.012 + 0.17)) < 0.01, `portadora conserva su suspenso (${dUp?.toFixed(3)} s)`);
  ok(Math.abs(dNum - (VOICED('s_115') + 0.012 + 0.06)) < 0.01, `número recortado (${dNum?.toFixed(3)} s)`);
  const seq = clipSequenceSec(['up_1', 's_115', 'dur_120']);
  const real = started[2].at + started[2].buffer.duration - started[0].at + 0.08;
  ok(Math.abs(seq - real) < 0.01, `clipSequenceSec = duración real (${seq.toFixed(3)} vs ${real.toFixed(3)})`);
  ok(clipDuration('hard_1') === null && clipSequenceSec(['hard_1']) > 0.4, 'sin decodificar ⇒ estimación');
  await playClips(['nope']).then(() => fail('playClips con clip inexistente debería rechazar'), () => ok(true, 'playClips rechaza clips que faltan'));
  // interrumpir mientras aún descarga: no debe sonar después
  started.length = 0;
  const slow = playClips(['hard_3']);
  stopClips();
  await slow;
  eq(started.length, 0, 'stopClips() anula un aviso que aún se descargaba');
  const slow2 = playClips(['hard_3']);
  const fast = playClips(['good_1']);
  await Promise.all([slow2, fast]);
  ok(started.length === 1 && Math.abs(started[0].buffer.duration - clipDuration('good_1')) < 1e-6, 'la petición más reciente gana');

  // cuenta atrás troceada: cada número en su segundo y "¡vamos!" en el arranque
  started.length = 0;
  const cdStart = performance.now();
  const cdCtx = ctx.currentTime;
  await playCountdown('countdown_1', 3, { startedAt: cdStart });
  eq(started.length, 4, 'cuenta atrás en 4 trozos');
  const onsets = started.map((s) => {
    const d = s.buffer.getChannelData(0);
    let i = 0;
    while (i < d.length && Math.abs(d[i]) < 0.02) i++;
    return s.at + i / SR;
  });
  ok(onsets.every((o, k) => Math.abs(o - cdCtx - k) < 0.05), `cada número en su segundo (${onsets.map((o) => (o - cdCtx).toFixed(3)).join(' · ')})`);
  // llegando tarde (1,5 s): solo "uno" y "¡vamos!", en su sitio
  started.length = 0;
  await playCountdown('countdown_1', 3, { startedAt: performance.now() - 1500 });
  eq(started.length, 2, 'cuenta atrás tardía: se omiten los números pasados');
  stopClips();

  // coach con el pack real (simulado): voz grabada de principio a fin, ducking alrededor
  voiceEvents.length = 0;
  const heard = [];
  const coach = createCoach(intervals20(), { packId: 'eva', chattiness: 'normal', seed: 2, watchReminder: true, onCue: (c) => heard.push(c) });
  eq(coach.voice, 'pack', 'createCoach con el pack cargado ⇒ voz grabada');
  ok(coach.cues.find((c) => c.kind === 'intro')?.clips?.[0] === 'watch_1', 'inicio con el recordatorio del Watch');
  for (let t = 0; t <= 130; t += 0.25) { coach.update(t); if (t % 1 === 0) await new Promise((r) => setTimeout(r, 4)); }
  await new Promise((r) => setTimeout(r, 60));
  ok(heard.length >= 4 && heard.every((c) => c.voice === 'pack'), `todo con el pack (${heard.map((c) => c.kind)})`);
  ok(voiceEvents.filter((x) => x).length >= heard.length && voiceEvents[voiceEvents.length - 1] === false, 'br:voice alrededor de cada aviso');
  eq(coach.voice, 'pack', 'sin fallos sigue con el pack');
  coach.destroy();
  // coach creado antes de que cargue el pack: se rehace al cargar (sin repetir lo ya dicho)
  await loadPack('otro');
  eq(currentPackId(), null, 'pack inexistente ⇒ sin pack');
  const early = createCoach(intervals20(), { packId: 'eva', chattiness: 'minimal', seed: 2, watchReminder: false });
  eq(early.voice, 'tts', 'antes de cargar: voz del sistema');
  await new Promise((r) => setTimeout(r, 20));
  eq(early.voice, 'pack', 'al cargar el pack: programa rehecho con la voz grabada');
  const ei = early.cues.find((c) => c.kind === 'intro');
  ok(ei?.voice === 'pack' && !ei.clips.includes('watch_1'), 'watchReminder:false ⇒ sin recordatorio');
  early.destroy();
  // cuenta atrás del coach con el pack: un aviso troceado en 4
  started.length = 0;
  const cdc = createCoach(intervals20(), { packId: 'eva', seed: 2 });
  const tcd = Date.now();
  await cdc.say('countdown', { n: 3 });
  ok(Date.now() - tcd >= 2900, 'countdown del coach dura n segundos');
  eq(started.length, 4, 'countdown del coach con la cuenta atrás grabada');
  cdc.destroy();
  // previewCoach con el pack
  started.length = 0;
  await previewCoach({ packId: 'eva' }, { speed: 12 });
  ok(started.length >= 4 && started.some((s) => Math.abs(s.buffer.duration - clipDuration('s_120')) < 1e-6), 'previewCoach usa el pack');
  // idle: con el contexto compartido (música) y sesión 'auto' nunca se suspende
  await new Promise((r) => setTimeout(r, 2800));
  eq(ctx.state, 'running', 'contexto compartido no se suspende en reposo (la música seguiría sonando)');
  setAudioSessionType('transient');
  await new Promise((r) => setTimeout(r, 2800));
  eq(ctx.state, 'suspended', "con 'transient' explícito se suspende en reposo (no deja la música ajena bajada)");
  setAudioSessionType('auto');
  delete globalThis.window;
}

process.stdout.write(`\n${failures ? '✗' : '✓'} ${checks} comprobaciones, ${failures} fallos\n`);
process.exit(failures ? 1 : 0);
