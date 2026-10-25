// RITMUP · carrera EN LA CINTA (sin DOM). El día de la carrera del objetivo (o cuando se quiera, como reto) la clase es
// la carrera de verdad: calentamiento, unos progresivos, la línea de salida, la carrera medida en KILÓMETROS a tu ritmo
// objetivo (termina justo al pasar la distancia, no por tiempo) y la vuelta a la calma. El escenario 3D «carrera» lee
// workout.race = { key, km, label, start, end } (segundos de clase) para poner la salida, los arcos de cada km y la meta.
//
// Id estable (como el resto de clases, para el reproductor, la sesión a medias y el historial):
//   race-<5k|10k|15k|21k>~<minutos>~<décimas de km/h en base 36>~100   p. ej. race-5k~34~36~100 = 5K a 11,4 km/h
import { round1, clamp } from '../core/utils.js';
import { speedForZone, zoneForSpeed, vamFromLevels } from './levels.js';
import { predictRaces } from './race-predict.js';
import { goalDistance } from './goal.js';
import { summarizeSegments } from './generator.js';

export const RACE_PREFIX = 'race-';
const RACE_KEYS = ['5k', '10k', '15k', '21k'];
const RACE_RE = /^race-(5k|10k|15k|21k)$/;

/** ¿Es una plantilla de carrera? ('race-5k'…) */
export const isRaceTemplate = (templateId) => typeof templateId === 'string' && RACE_RE.test(templateId);

/** Velocidad de carrera (km/h, 1 decimal): la del tiempo objetivo o, sin objetivo, la marca prevista por tu VAM. */
export function raceSpeedFor(distanceKey, { targetSec = null, levels = null } = {}) {
  const d = goalDistance(distanceKey);
  if (!d) return null;
  if (Number(targetSec) > 0) return round1(clamp((d.km / Number(targetSec)) * 3600, 5, 22));
  const lv = levels || {};
  const vam = Number(lv.jog) > 0 ? vamFromLevels(lv) : 0;
  const p = predictRaces(vam).find((r) => r.key === d.key);
  if (p) return round1(clamp(3600 / p.paceSec, 5, 22));
  return round1(Number(lv.run) || 10);
}

/** Id de la clase de carrera para una distancia y una velocidad. */
export function raceWorkoutId(distanceKey, speedKmh) {
  const d = goalDistance(distanceKey);
  if (!d || !(Number(speedKmh) > 0)) return null;
  const tenths = Math.round(Number(speedKmh) * 10);
  const raceSec = raceSeconds(d.km, tenths / 10);
  const minutes = Math.max(1, Math.round((WARM_SEC + raceSec + COOL_SEC) / 60));
  return `${RACE_PREFIX}${d.key}~${minutes}~${tenths.toString(36)}~100`;
}

const WARM_SEC = 2 * 60 + 3 * 60 + 2 * 60 + 60; // calentamiento + trote + 2 progresivos + línea de salida
const COOL_SEC = 4 * 60 + 2 * 60;
/** Segundos de carrera (múltiplo de 5 por arriba: la meta nunca llega antes de la distancia). */
const raceSeconds = (km, kmh) => Math.ceil(((km / kmh) * 3600) / 5) * 5;

/**
 * Clase de carrera completa (o null).
 * @param {string} distanceKey '5k' | '10k' | '15k' | '21k'
 * @param {{ speed: number, levels: object, weightKg?: number }} opts
 */
export function buildRaceWorkout(distanceKey, { speed, levels, weightKg = 78 } = {}) {
  const d = goalDistance(distanceKey);
  if (!d || !RACE_KEYS.includes(d.key)) return null;
  const lv = levels && Number(levels.jog) > 0 ? levels : { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13 };
  const v = round1(clamp(Number(speed) || raceSpeedFor(d.key, { levels: lv }), 5, 22));
  const warm = speedForZone('warmup', lv);
  const jog = round1(Math.min(lv.jog, v - 0.5));
  const cool = speedForZone('cooldown', lv);
  const raceSec = raceSeconds(d.km, v);
  const label = d.key === '21k' ? 'Media maratón' : d.label;
  const segs = [
    { zone: 'warmup', speed: warm, incline: 0, sec: 120, label: 'Calentamiento', block: 'Calentamiento',
      cue: 'Día de carrera: calienta muy suave, hoy no se gana nada aquí' },
    { zone: 'jog', speed: jog, incline: 0, sec: 180, label: 'Trote de calentamiento', block: 'Calentamiento', cue: '' },
    { zone: zoneForSpeed(v, lv), speed: v, incline: 0, sec: 20, label: 'Progresivo', block: 'Activación',
      cue: 'Un progresivo a ritmo de carrera, para que las piernas lo conozcan' },
    { zone: 'jog', speed: jog, incline: 0, sec: 40, label: 'Trote', block: 'Activación', cue: '' },
    { zone: 'run', speed: round1(Math.max(v, lv.run)), incline: 0, sec: 20, label: 'Progresivo', block: 'Activación', cue: '' },
    { zone: 'jog', speed: jog, incline: 0, sec: 40, label: 'Trote', block: 'Activación', cue: '' },
    { zone: 'walk', speed: 5.0, incline: 0, sec: 60, label: 'A la línea de salida', block: 'Salida',
      cue: 'A la línea de salida: respira hondo, sal contenido el primer kilómetro' },
    { zone: zoneForSpeed(v, lv), speed: v, incline: 0, sec: raceSec, label: `Tu ${label}`, block: 'Carrera', race: true,
      cue: `¡Salida! ${label} a ${v.toFixed(1).replace('.', ',')}: tu ritmo, tu carrera` },
    { zone: 'cooldown', speed: cool, incline: 0, sec: 240, label: 'Vuelta a la calma', block: 'Vuelta a la calma',
      cue: '¡Lo has conseguido! Ahora suelta piernas muy suave' },
    { zone: 'walk', speed: 4.5, incline: 0, sec: 120, label: 'Paseo final', block: 'Vuelta a la calma', cue: '' },
  ];
  const start = segs.slice(0, 7).reduce((a, s) => a + s.sec, 0);
  const sum = summarizeSegments(segs, weightKg);
  const tenths = Math.round(v * 10);
  const minutes = Math.max(1, Math.round(sum.totalSec / 60));
  return {
    id: `${RACE_PREFIX}${d.key}~${minutes}~${tenths.toString(36)}~100`,
    templateId: `${RACE_PREFIX}${d.key}`,
    title: `Carrera ${label}`,
    subtitle: `${d.km === 21.0975 ? '21,1' : d.km} km a ${v.toFixed(1).replace('.', ',')} km/h · salida, arcos de cada km y meta`,
    category: 'race',
    focus: 'Día de carrera',
    description: `Tu ${label} en la cinta, como una carrera de verdad: calentamiento, línea de salida, un arco en cada kilómetro y la meta con tu tiempo. La clase termina justo al pasar los ${d.km === 21.0975 ? '21,1' : d.km} km.`,
    coachNotes: ['Sal contenido: el primer kilómetro siempre parece fácil.', 'A mitad de carrera, aguanta el ritmo sin mirar el reloj.', 'El último kilómetro es tuyo: si te queda algo, sube una décima.'],
    minutes,
    totalSec: sum.totalSec,
    segments: segs,
    estDistanceKm: sum.estDistanceKm,
    estKcal: sum.estKcal,
    maxSpeed: sum.maxSpeed,
    timeInZone: sum.timeInZone,
    load: sum.load,
    intensity: 3,
    isTest: false,
    seed: tenths,
    loadFactor: 1,
    race: { key: d.key, km: d.km, label, start, end: start + raceSec, speed: v },
  };
}
