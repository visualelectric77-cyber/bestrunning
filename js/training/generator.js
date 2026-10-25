// BestRunning · generador de clases (sin DOM).
// Convierte una plantilla + contexto en un Workout completo, con id reversible
// 'plantilla~minutos~semilla(base36)~carga×100' para poder reconstruirlo desde la URL.
import { isRaceTemplate, buildRaceWorkout, RACE_PREFIX } from './race.js';
import { round1, roundTo, clamp, hashStr, makeRng, fmt } from '../core/utils.js';
import { ZONES, LEVEL_KEYS, DEFAULT_LEVELS, enforceLevelOrder, kcalPerMinute, clampSpeed } from './levels.js';
import { getTemplate } from './templates.js';

const DEFAULT_TREADMILL = { hasIncline: false, maxIncline: 12, minSpeed: 1.0, maxSpeed: 18.0, announceLead: 10 };
const ZONE_KEYS = Object.keys(ZONES);
const EASY = new Set(['jog', 'walk', 'warmup', 'cooldown']);
const round2 = (v) => Math.round(v * 100) / 100;

/** Niveles válidos y ordenados (rellena con los de serie si faltan). */
function normLevels(levels) {
  const out = {};
  for (const k of LEVEL_KEYS) {
    const v = Number(levels?.[k]);
    out[k] = Number.isFinite(v) && v > 0 ? round1(v) : DEFAULT_LEVELS[k];
  }
  return enforceLevelOrder(out);
}

/** Semilla entera sin signo de 32 bits (acepta números o texto). */
function normSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.floor(Math.abs(seed)) % 4294967296;
  if (typeof seed === 'string' && /^\d+$/.test(seed)) return Number(seed) % 4294967296;
  return hashStr(String(seed ?? 1));
}

function normalizeSegments(segs, tm, hasIncline) {
  const maxInc = Number(tm.maxIncline) || 12;
  return segs
    .filter((s) => s && Number(s.sec) > 0)
    .map((s) => {
      const zone = ZONES[s.zone] ? s.zone : 'jog';
      const out = {
        zone,
        speed: clampSpeed(Number(s.speed) || 0, tm),
        incline: hasIncline ? clamp(Math.round((Number(s.incline) || 0) * 2) / 2, 0, maxInc) : 0,
        sec: Math.max(5, roundTo(Number(s.sec), 5)),
        label: typeof s.label === 'string' && s.label ? s.label : ZONES[zone].name,
        cue: typeof s.cue === 'string' ? s.cue : '',
      };
      if (s.block) out.block = String(s.block);
      if (s.rep && s.rep.n > 0 && s.rep.i >= 1) out.rep = { i: Math.round(s.rep.i), n: Math.round(s.rep.n) };
      if (Number.isFinite(s.stage)) out.stage = s.stage;
      return out;
    });
}

/** Red de seguridad: garantiza totalSec === target tocando primero los tramos suaves. */
function fitToDuration(segs, target) {
  if (!segs.length) return segs;
  let diff = target - segs.reduce((a, s) => a + s.sec, 0);
  if (diff === 0) return segs;
  if (diff > 0) {
    // al tramo suave más largo del bloque central (ni el primero ni el último si se puede)
    const inner = segs.slice(1, -1).filter((s) => EASY.has(s.zone));
    const pool = inner.length ? inner : segs.filter((s) => EASY.has(s.zone));
    const t = (pool.length ? pool : segs).reduce((a, b) => (b.sec > a.sec ? b : a));
    t.sec += diff;
    return segs;
  }
  let need = -diff;
  const order = [...segs.filter((s) => EASY.has(s.zone)), ...segs.filter((s) => !EASY.has(s.zone))];
  for (const s of order.sort((a, b) => b.sec - a.sec)) {
    if (need <= 0) break;
    const take = Math.min(need, Math.max(0, s.sec - 30));
    s.sec -= take;
    need -= take;
  }
  if (need > 0) {
    // caso extremo (duración diminuta): escala proporcional y corrige el redondeo en el más largo
    const sumNow = segs.reduce((a, s) => a + s.sec, 0);
    for (const s of segs) s.sec = Math.max(5, roundTo((s.sec * target) / Math.max(1, sumNow), 5));
    const rest = target - segs.reduce((a, s) => a + s.sec, 0);
    segs.reduce((a, b) => (b.sec > a.sec ? b : a)).sec += rest;
  }
  return segs;
}

/** Fusiona tramos contiguos idénticos (zona, velocidad, inclinación y etiqueta; sin series) para no anunciar cambios falsos. */
function mergeAdjacent(segs) {
  const out = [];
  for (const s of segs) {
    const p = out[out.length - 1];
    if (p && p.zone === s.zone && p.speed === s.speed && p.incline === s.incline && p.label === s.label && !p.rep && !s.rep && p.stage === s.stage) {
      p.sec += s.sec;
      if (!p.cue && s.cue) p.cue = s.cue;
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

/** Resumen de una lista de segmentos. */
export function summarizeSegments(segments, weightKg = 78) {
  const timeInZone = Object.fromEntries(ZONE_KEYS.map((z) => [z, 0]));
  let totalSec = 0;
  let km = 0;
  let kcal = 0;
  let maxSpeed = 0;
  let weighted = 0;
  for (const s of segments || []) {
    const sec = Number(s.sec) || 0;
    const zone = ZONES[s.zone] ? s.zone : 'jog';
    totalSec += sec;
    km += ((Number(s.speed) || 0) * sec) / 3600;
    kcal += (kcalPerMinute(Number(s.speed) || 0, Number(s.incline) || 0, weightKg || 78) * sec) / 60;
    if (s.speed > maxSpeed) maxSpeed = s.speed;
    timeInZone[zone] += sec;
    weighted += sec * ZONES[zone].weight;
  }
  const perSec = totalSec ? weighted / totalSec : 0;
  return {
    totalSec,
    estDistanceKm: round2(km),
    estKcal: Math.round(kcal),
    maxSpeed: round1(maxSpeed),
    timeInZone,
    load: Math.round(weighted / 60),
    intensity: perSec < 1.6 ? 1 : perSec < 2.3 ? 2 : 3,
  };
}

export function workoutId({ templateId, minutes, seed, loadFactor }) {
  const lf = Math.round((Number(loadFactor) || 1) * 100);
  return `${templateId}~${Math.round(Number(minutes) || 0)}~${normSeed(seed).toString(36)}~${lf}`;
}

export function parseWorkoutId(id) {
  if (typeof id !== 'string' || !id) return null;
  let s = id;
  try { s = decodeURIComponent(id); } catch { s = id; }
  const parts = s.split('~');
  if (parts.length !== 4) return null;
  const [templateId, m, sd, lf] = parts;
  if (!/^[a-z0-9-]+$/.test(templateId) || !/^\d+$/.test(m) || !/^[0-9a-z]+$/.test(sd) || !/^\d+$/.test(lf)) return null;
  const minutes = Number(m);
  const seed = parseInt(sd, 36);
  const load = Number(lf);
  if (minutes <= 0 || !Number.isFinite(seed) || load <= 0) return null;
  return { templateId, minutes, seed, loadFactor: load / 100 };
}

/** Construye la clase completa. Devuelve null si la plantilla no existe. */
export function buildWorkout(templateId, {
  minutes, levels, seed = 1, loadFactor = 1, hasIncline = false, treadmill, weightKg = 78, weekInCycle = 1, cycleIndex = 0,
} = {}) {
  const t = getTemplate(templateId);
  if (!t) return null;
  const tm = { ...DEFAULT_TREADMILL, ...(treadmill || {}) };
  const lv = normLevels(levels);
  const mins = clamp(Math.round(Number(minutes) || t.durations[0]), 10, 120);
  const sd = normSeed(seed);
  const load = round2(clamp(Number(loadFactor) || 1, 0.3, 2));
  const isTest = t.category === 'test';
  const ctx = {
    minutes: mins, levels: lv, load, rng: makeRng(hashStr(`${templateId}|${sd}|${mins}`)),
    hasIncline: !!hasIncline, treadmill: tm, weekInCycle, cycleIndex,
  };
  let segs = normalizeSegments(t.build(ctx) || [], tm, !!hasIncline);
  if (!segs.length) segs = [{ zone: 'jog', speed: clampSpeed(lv.jog, tm), incline: 0, sec: mins * 60, label: ZONES.jog.name, cue: '' }];
  if (!isTest) segs = fitToDuration(segs, mins * 60);
  segs = mergeAdjacent(segs);
  const sum = summarizeSegments(segs, weightKg);
  return {
    id: workoutId({ templateId, minutes: mins, seed: sd, loadFactor: load }),
    templateId,
    title: t.title,
    subtitle: t.subtitle,
    category: t.category,
    focus: t.focus,
    description: t.description,
    coachNotes: [...t.coachNotes],
    minutes: mins,
    totalSec: sum.totalSec,
    segments: segs,
    estDistanceKm: sum.estDistanceKm,
    estKcal: sum.estKcal,
    maxSpeed: sum.maxSpeed,
    timeInZone: sum.timeInZone,
    load: sum.load,
    intensity: sum.intensity,
    isTest,
    seed: sd,
    loadFactor: load,
    ...(t.event ? { event: t.event } : {}),
  };
}

export function workoutFromId(id, state) {
  const p = parseWorkoutId(id);
  // Carrera en la cinta (js/training/race.js): la «semilla» son las décimas de km/h del ritmo de carrera
  if (p && isRaceTemplate(p.templateId)) {
    return buildRaceWorkout(p.templateId.slice(RACE_PREFIX.length), {
      speed: p.seed / 10, levels: state?.levels, weightKg: Number(state?.profile?.weightKg) || 78,
    });
  }
  if (!p || !getTemplate(p.templateId)) return null;
  return buildWorkout(p.templateId, {
    minutes: p.minutes,
    seed: p.seed,
    loadFactor: p.loadFactor,
    levels: state?.levels,
    hasIncline: !!state?.treadmill?.hasIncline,
    treadmill: state?.treadmill,
    weightKg: Number(state?.profile?.weightKg) || 78,
  });
}

/* ───────────── Agrupación para mostrar la estructura ───────────── */

const sig = (s) => `${s.zone}|${s.speed}|${s.sec}|${s.incline || 0}`;
const part = (s, useLabel) => {
  const inc = s.incline ? ` · ${fmt.dec1(s.incline).replace(',0', '')} %` : '';
  return `${fmt.clock(s.sec)} ${useLabel ? s.label : ZONES[s.zone]?.short || s.label} ${fmt.speed(s.speed)}${inc}`;
};

/** Agrupa repeticiones consecutivas: "8 × (0:30 Sprint 13,0 · 1:00 Trotar 8,3)". */
export function groupSegments(segments) {
  const segs = segments || [];
  const out = [];
  let i = 0;
  while (i < segs.length) {
    let best = null;
    for (let len = 1; len <= 4 && i + len * 2 <= segs.length; len++) {
      const unit = segs.slice(i, i + len).map(sig).join('#');
      let times = 1;
      while (i + (times + 1) * len <= segs.length
        && segs.slice(i + times * len, i + (times + 1) * len).map(sig).join('#') === unit) times++;
      if (times >= 2 && (!best || times * len > best.times * best.len)) best = { len, times };
    }
    if (best) {
      const unitSegs = segs.slice(i, i + best.len);
      out.push({
        kind: 'repeat',
        times: best.times,
        segments: unitSegs,
        label: `${best.times} × (${unitSegs.map((s) => part(s, false)).join(' · ')})`,
      });
      i += best.len * best.times;
    } else {
      out.push({ kind: 'single', times: 1, segments: [segs[i]], label: part(segs[i], true) });
      i++;
    }
  }
  return out;
}
