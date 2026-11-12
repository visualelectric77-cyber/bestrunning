// RITMUP · sesión a RITMO OBJETIVO de carrera (sin DOM ni dependencias). Con el entreno exigente y una carrera en el
// plan, el día clave de cada semana de construcción es una sesión a la velocidad que da tu tiempo objetivo, y crece de
// una semana a otra: primero series cortas, al final casi la mitad de la carrera de un tirón.
//
// La clase es una plantilla normal (`goal-pace`, js/training/templates.js) para que la voz, el historial y el análisis
// la traten como cualquier otra. Lo propio de cada día (distancia, velocidad y semana del bloque) viaja en la «semilla»
// de la clase, igual que la carrera en la cinta lleva su ritmo en la suya: así la sesión que hiciste hace un mes sigue
// siendo la misma aunque después cambies de objetivo.

export const PACE_ID = 'goal-pace';
const DIST = { '5k': 1, '10k': 2, '15k': 3, '21k': 4 };
const KEY = { 1: '5k', 2: '10k', 3: '15k', 4: '21k' };
export const PACE_LABEL = { '5k': '5K', '10k': '10K', '15k': '15K', '21k': 'media' };

/**
 * Lo que toca en cada etapa: [series, segundos de cada una, segundos de trote entre series]. Cuatro etapas (0–3) que
 * suman cada vez más tiempo seguido a ritmo de carrera.
 */
export const PACE_PLANS = {
  '5k': [[5, 180, 120], [6, 180, 120], [5, 240, 120], [4, 300, 150]],
  '10k': [[3, 360, 120], [3, 480, 150], [2, 720, 180], [1, 1320, 0]],
  '15k': [[2, 600, 150], [2, 720, 180], [1, 1320, 0], [1, 1620, 0]],
  '21k': [[2, 600, 150], [2, 780, 180], [1, 1500, 0], [1, 1800, 0]],
};

/** Semilla de la clase: distancia (1–4) · décimas de km/h · etapa (0–3). P. ej. 10K a 10,5 en etapa 2 → 201052. */
export function paceSeed(distanceKey, speedKmh, stage) {
  const d = DIST[distanceKey];
  const tenths = Math.round(Number(speedKmh) * 10);
  if (!d || !(tenths >= 50 && tenths <= 220)) return null;
  return d * 100000 + tenths * 10 + Math.max(0, Math.min(3, Math.round(Number(stage) || 0)));
}

/** → { distance, speed, stage } o null si la semilla no es de una sesión a ritmo objetivo. */
export function parsePaceSeed(seed) {
  const n = Math.round(Number(seed));
  if (!Number.isFinite(n) || n < 100000 || n >= 500000) return null;
  const d = KEY[Math.floor(n / 100000)];
  const tenths = Math.floor((n % 100000) / 10);
  const stage = n % 10;
  if (!d || tenths < 50 || tenths > 220 || stage > 3) return null;
  return { distance: d, speed: tenths / 10, stage };
}

/** Etapa (0–3) según la semana de construcción: la primera es la 0 y la última, la 3. */
export function paceStage(buildIndex, buildWeeks) {
  const n = Math.max(1, Math.round(Number(buildWeeks) || 1));
  const i = Math.max(1, Math.min(n, Math.round(Number(buildIndex) || 1)));
  return n <= 1 ? 3 : Math.round(((i - 1) / (n - 1)) * 3);
}
