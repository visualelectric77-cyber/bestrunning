// BestRunning · escenario automático según la clase (función pura, sin DOM: la usan Preparación, Ajustes y los tests).
// Desde la web 1.21: Modo visión es el escenario principal de todas las clases; tests y retos, en el Estadio; carrera y
// eventos, en su mundo especial. Los ids son los de js/player/scene3d/themes/index.js.

/** Valor guardado en visuals.theme cuando el escenario lo elige la clase. */
export const AUTO_THEME = 'auto';
/** Escenarios que se ofrecen (mismo orden que Ajustes → Pantalla de entreno). */
export const SCENE_IDS = ['vision', 'costa', 'neon', 'desierto', 'tunel', 'bosque', 'aurora', 'cordillera', 'estadio', 'ciudad-berlin', 'ciudad-berlin-10k', 'ciudad-madrid', 'blank'];
/** Respaldo cuando ni la clase ni el usuario deciden. */
export const BASE_THEME = 'vision';

export const SCENE_NAMES = {
  vision: 'Modo visión',
  costa: 'Costa', neon: 'Neón', desierto: 'Desierto', tunel: 'Túnel', bosque: 'Bosque',
  aurora: 'Aurora', cordillera: 'Cordillera', estadio: 'Estadio', blank: 'Grafito',
  'ciudad-berlin': 'Berlín · final del maratón', 'ciudad-berlin-10k': 'Berlín · últimos 10 km', 'ciudad-madrid': 'Madrid · final del maratón',
};

// Escenario principal: Modo visión (la clase entera como una escalera de luz) para todas las clases; los tests y retos
// siguen en el Estadio (sus escalones de test tienen su propia lectura). Los demás mundos se eligen a mano.
const PRINCIPAL = ['vision', 'tu clase tramo a tramo'];
const BY_CATEGORY = {
  test: ['estadio', 'test en pista'],
  challenge: ['estadio', 'reto en pista'],
};

const isScene = (id) => typeof id === 'string' && SCENE_IDS.includes(id);

/** Mundos especiales (ocultos en Ajustes): la carrera del objetivo y los eventos de temporada con escenario propio. */
export const SPECIAL_SCENES = { carrera: 'Carrera', halloween: 'Noche de Halloween', nieve: 'Navidad' };
const EVENT_SCENE = { halloween: 'halloween', navidad: 'nieve' };
const isSpecial = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(SPECIAL_SCENES, id);

/**
 * Mundo especial de una clase o null: la carrera (workout.race o categoría 'race') va siempre en la Carrera y las clases
 * de evento con escenario propio, en el suyo (Halloween, Navidad). Mandan sobre el escenario de siempre; solo la elección hecha
 * en Preparación para esa clase los cambia.
 */
export function specialTheme(workout) {
  const w = workout && typeof workout === 'object' ? workout : null;
  if (!w) return null;
  if (w.race || w.category === 'race') return { id: 'carrera', reason: 'tu día de carrera' };
  const ev = typeof w.event === 'string' ? EVENT_SCENE[w.event] : null;
  return ev ? { id: ev, reason: ev === 'nieve' ? 'especial de Navidad' : 'especial de Halloween' } : null;
}

/**
 * Escenario que corresponde a una clase: Modo visión, salvo tests y retos (Estadio).
 * @param {{ category?: string, isTest?: boolean } | null} workout
 * @returns {{ id: string, reason: string, matched: boolean }}
 */
export function autoTheme(workout) {
  const w = workout && typeof workout === 'object' ? workout : null;
  let cat = typeof w?.category === 'string' ? w.category.toLowerCase() : '';
  if (w?.isTest) cat = 'test';
  const hit = BY_CATEGORY[cat] || PRINCIPAL;
  return { id: hit[0], reason: hit[1], matched: true };
}

/**
 * Escenario final de una clase.
 * @param {string|null|undefined} pref preferencia guardada (visuals.theme): 'auto' o un id
 * @param {object|null} workout la clase
 * @param {string|null} [override] elección hecha en Preparación solo para esta clase ('auto' o un id)
 * @returns {{ id: string, auto: boolean, reason: string }}
 */
export function resolveTheme(pref, workout, override = null) {
  if (isSpecial(override)) return { id: override, auto: false, reason: '' };
  const sp = specialTheme(workout);
  if (sp && !isScene(override) && override !== AUTO_THEME) return { id: sp.id, auto: true, reason: sp.reason };
  if (sp && override === AUTO_THEME) return { id: sp.id, auto: true, reason: sp.reason };
  const choice = override === AUTO_THEME || isScene(override) ? override : (pref === AUTO_THEME || isScene(pref) ? pref : AUTO_THEME);
  if (choice !== AUTO_THEME) return { id: choice, auto: false, reason: '' };
  const a = autoTheme(workout);
  return { id: a.id, auto: true, reason: a.reason };
}
