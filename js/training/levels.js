// BestRunning · zonas de velocidad, fisiología y estimaciones (sin DOM).
import { round1, clamp, pad2 } from '../core/utils.js';

/** Zonas de un segmento. El color se usa en gráficos, fondos del reproductor y chips. */
export const ZONES = {
  warmup:   { key: 'warmup',   name: 'Calentamiento',     short: 'Calentar', color: '#64D2FF', hrZone: 1, weight: 0.6 },
  walk:     { key: 'walk',     name: 'Caminar',           short: 'Caminar',  color: '#AEAEB2', hrZone: 1, weight: 0.4 },
  jog:      { key: 'jog',      name: 'Trotar',            short: 'Trotar',   color: '#30D158', hrZone: 2, weight: 1.0 },
  run:      { key: 'run',      name: 'Correr',            short: 'Correr',   color: '#FFD60A', hrZone: 3, weight: 2.0 },
  fast:     { key: 'fast',     name: 'Correr rápido',     short: 'Rápido',   color: '#FF9F0A', hrZone: 4, weight: 3.5 },
  sprint:   { key: 'sprint',   name: 'Sprint',            short: 'Sprint',   color: '#FF375F', hrZone: 5, weight: 5.0 },
  cooldown: { key: 'cooldown', name: 'Vuelta a la calma', short: 'Calma',    color: '#7D7AFF', hrZone: 1, weight: 0.5 },
};

/** Orden de menor a mayor intensidad (para leyendas y barras de tiempo en zonas). */
export const ZONE_ORDER = ['walk', 'warmup', 'cooldown', 'jog', 'run', 'fast', 'sprint'];

/** Las 4 velocidades personales que evolucionan. */
export const LEVEL_KEYS = ['jog', 'run', 'fast', 'sprint'];
export const DEFAULT_LEVELS = { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 };

/** Fracción de la VAM (velocidad aeróbica máxima) de cada nivel. Calibrado con 8,3/10,1/11,5/13 ⇒ VAM≈13. */
export const LEVEL_RATIOS = { jog: 0.64, run: 0.78, fast: 0.885, sprint: 1.0 };

/** Separación mínima entre niveles consecutivos (km/h). */
export const MIN_LEVEL_GAP = 0.8;

/** Velocidades por defecto de las zonas que no son niveles. */
export function speedForZone(zone, levels) {
  if (levels[zone] != null) return levels[zone];
  if (zone === 'warmup') return round1(Math.max(5.5, levels.jog - 1.2));
  if (zone === 'cooldown') return round1(Math.max(5.0, levels.jog - 1.8));
  if (zone === 'walk') return 5.5;
  return levels.jog;
}

/** Niveles a partir de una VAM medida en test. */
export function levelsFromVam(vam) {
  const out = {};
  for (const k of LEVEL_KEYS) out[k] = round1(vam * LEVEL_RATIOS[k]);
  return enforceLevelOrder(out);
}

/** VAM estimada a partir de los niveles actuales (media ponderada). */
export function vamFromLevels(levels) {
  const w = { jog: 0.1, run: 0.2, fast: 0.3, sprint: 0.4 };
  let v = 0;
  for (const k of LEVEL_KEYS) v += (levels[k] / LEVEL_RATIOS[k]) * w[k];
  return round1(v);
}

/** Garantiza jog < run < fast < sprint con separación mínima. */
export function enforceLevelOrder(levels) {
  const out = { ...levels };
  for (let i = 1; i < LEVEL_KEYS.length; i++) {
    const prev = LEVEL_KEYS[i - 1];
    const k = LEVEL_KEYS[i];
    if (out[k] < out[prev] + MIN_LEVEL_GAP) out[k] = round1(out[prev] + MIN_LEVEL_GAP);
  }
  return out;
}

/** Nivel más cercano a una velocidad ('walk' si está claramente por debajo del trote). */
export function zoneForSpeed(speed, levels) {
  if (speed < levels.jog - 1.0) return 'walk';
  let best = 'jog';
  let bestD = Infinity;
  for (const k of LEVEL_KEYS) {
    const d = Math.abs(levels[k] - speed);
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

/* ───────────── Fisiología ───────────── */

/** FC máxima estimada (Tanaka): 208 − 0,7 × edad. 46 años ⇒ 176. */
export const hrMaxFromAge = (age) => Math.round(208 - 0.7 * age);

const HR_ZONE_DEFS = [
  { zone: 1, name: 'Z1 · Recuperación', lo: 0.50, hi: 0.60, color: '#64D2FF' },
  { zone: 2, name: 'Z2 · Aeróbico',     lo: 0.60, hi: 0.70, color: '#30D158' },
  { zone: 3, name: 'Z3 · Tempo',        lo: 0.70, hi: 0.80, color: '#FFD60A' },
  { zone: 4, name: 'Z4 · Umbral',       lo: 0.80, hi: 0.90, color: '#FF9F0A' },
  { zone: 5, name: 'Z5 · VO₂máx',       lo: 0.90, hi: 1.00, color: '#FF375F' },
];

/** Zonas de FC. Con FC de reposo usa Karvonen; si no, % de FC máx. */
export function hrZones(hrMax, hrRest = null) {
  return HR_ZONE_DEFS.map((z) => {
    const f = (p) => Math.round(hrRest ? hrRest + p * (hrMax - hrRest) : p * hrMax);
    return { ...z, min: f(z.lo), max: f(z.hi) };
  });
}

/** Rango de FC objetivo de una zona de segmento, p. ej. { zone: 4, min: 141, max: 158 }. */
export function hrTargetForZone(zoneKey, profile) {
  const hrMax = profile.hrMax || hrMaxFromAge(profile.age || 46);
  const z = hrZones(hrMax, profile.hrRest)[(ZONES[zoneKey]?.hrZone || 1) - 1];
  return { zone: z.zone, min: z.min, max: z.max, name: z.name };
}

/** Segundos por km a una velocidad. */
export const paceSeconds = (kmh) => (kmh > 0 ? 3600 / kmh : 0);
export const fmtPaceKmh = (kmh) => {
  const s = Math.round(paceSeconds(kmh));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
};

/**
 * kcal por minuto (ecuaciones ACSM). Correr si ≥ 7 km/h, caminar si no.
 * VO₂ (ml/kg/min) = 0,2·v + 0,9·v·pendiente + 3,5 (correr) · 0,1·v + 1,8·v·pendiente + 3,5 (caminar), v en m/min.
 */
export function kcalPerMinute(kmh, inclinePct = 0, weightKg = 75) {
  const v = (kmh * 1000) / 60;
  const g = (inclinePct || 0) / 100;
  const vo2 = kmh >= 7 ? 0.2 * v + 0.9 * v * g + 3.5 : 0.1 * v + 1.8 * v * g + 3.5;
  return (vo2 * weightKg) / 1000 * 5;
}

/** VO₂máx estimado a partir de la VAM (Léger): 3,5 × VAM. */
export const estimateVo2max = (vam) => round1(3.5 * vam);

/** Categoría orientativa de VO₂máx por edad y sexo (normas tipo ACSM/Cooper, simplificadas). */
export function vo2Category(vo2, age = 46, sex = 'm') {
  // Umbrales [regular, bueno, excelente, superior] para hombres; mujeres ≈ −6.
  const base = age < 30 ? [38, 43, 48, 53] : age < 40 ? [36, 41, 46, 51] : age < 50 ? [34, 39, 44, 49] : age < 60 ? [31, 36, 41, 46] : [28, 33, 38, 43];
  const t = sex === 'f' ? base.map((x) => x - 6) : base;
  const labels = ['Mejorable', 'Regular', 'Bueno', 'Excelente', 'Superior'];
  let tier = 0;
  while (tier < 4 && vo2 >= t[tier]) tier++;
  return { tier, label: labels[tier], thresholds: t };
}

/** Recorta una velocidad a los límites de la cinta. */
export const clampSpeed = (v, treadmill) => round1(clamp(v, treadmill?.minSpeed ?? 1, treadmill?.maxSpeed ?? 20));
