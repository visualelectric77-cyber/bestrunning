// BestRunning · escenario automático según la clase (función pura, sin DOM: la usan Preparación, Ajustes y los tests).
// Cada tipo de entreno tiene su mundo: cuestas en la Cordillera, series y ritmos en el Estadio, rodajes largos bajo la
// Aurora y la recuperación en Grafito (el más sereno). Los ids son los de js/player/scene3d/themes/index.js.

/** Valor guardado en visuals.theme cuando el escenario lo elige la clase. */
export const AUTO_THEME = 'auto';
/** Escenarios que se ofrecen (mismo orden que Ajustes → Pantalla de entreno). */
export const SCENE_IDS = ['aurora', 'cordillera', 'estadio', 'blank'];
/** Respaldo cuando ni la clase ni el usuario deciden. */
export const BASE_THEME = 'aurora';

export const SCENE_NAMES = { aurora: 'Aurora', cordillera: 'Cordillera', estadio: 'Estadio', blank: 'Grafito' };

// categoría → [escenario, por qué] (el porqué se lee «Automático · Estadio — series en pista»)
const BY_CATEGORY = {
  hills: ['cordillera', 'cuestas en la montaña'],
  intervals: ['estadio', 'series en pista'],
  fartlek: ['estadio', 'cambios de ritmo en pista'],
  tempo: ['estadio', 'ritmo sostenido en pista'],
  test: ['estadio', 'test en pista'],
  challenge: ['estadio', 'reto en pista'],
  endurance: ['aurora', 'rodaje largo bajo la aurora'],
  recovery: ['blank', 'recuperación serena'],
};

const isScene = (id) => typeof id === 'string' && SCENE_IDS.includes(id);

/**
 * Escenario que corresponde a una clase.
 * @param {{ category?: string, isTest?: boolean, templateId?: string } | null} workout
 * @param {string} [fallback] escenario del usuario si la clase no tiene uno propio
 * @returns {{ id: string, reason: string, matched: boolean }}
 */
export function autoTheme(workout, fallback = BASE_THEME) {
  const fb = isScene(fallback) ? fallback : BASE_THEME;
  const w = workout && typeof workout === 'object' ? workout : null;
  let cat = typeof w?.category === 'string' ? w.category.toLowerCase() : '';
  if (w?.isTest) cat = 'test';
  // Clases sueltas sin categoría: la plantilla lo dice a veces (sprint-…, hill-…, long-…)
  if (!BY_CATEGORY[cat] && typeof w?.templateId === 'string') {
    const t = w.templateId.toLowerCase();
    if (/hill|cuesta/.test(t)) cat = 'hills';
    else if (/sprint|interval|vo2/.test(t)) cat = 'intervals';
    else if (/recover|easy/.test(t)) cat = 'recovery';
    else if (/long|endur/.test(t)) cat = 'endurance';
  }
  const hit = BY_CATEGORY[cat];
  if (!hit) return { id: fb, reason: 'tu escenario de siempre', matched: false };
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
  const choice = override === AUTO_THEME || isScene(override) ? override : (pref === AUTO_THEME || isScene(pref) ? pref : AUTO_THEME);
  if (choice !== AUTO_THEME) return { id: choice, auto: false, reason: '' };
  const a = autoTheme(workout, isScene(pref) ? pref : BASE_THEME);
  return { id: a.id, auto: true, reason: a.reason };
}
