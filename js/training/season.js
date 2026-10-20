// BestRunning · temporada de 52 semanas (sin DOM): fases, mesociclos con tema, eventos por fecha y metadatos
// de plantilla (family / themes / intensity) con valores por defecto según la categoría.
// El calendario se deriva siempre de plan.startDate: 13 mesociclos de 4 semanas (3 de carga + 1 de descarga),
// test VAM cada 6 semanas y eventos (Navidad, Verano, Aniversario) que sustituyen a la «sorpresa» semanal.

export const SEASON_VERSION = 1;
export const SEASON_WEEKS = 52;
export const MESO_WEEKS = 4;
export const MESO_PER_SEASON = 13;
export const TEST_EVERY_WEEKS = 6;
/** Semana (0-based, global) con test VAM: la 6.ª, 12.ª, 18.ª… */
export const isTestWeekIndex = (W) => W >= 0 && W % TEST_EVERY_WEEKS === TEST_EVERY_WEEKS - 1;

export const FAMILIES = ['piramide', 'escalera', 'series-cortas', 'series-largas', 'tempo', 'progresivo', 'fartlek', 'cuestas',
  'umbral', 'resistencia', 'recuperacion', 'reto', 'test', 'musica', 'tecnica'];
export const INTENSITIES = ['easy', 'moderate', 'hard'];

/* ───────────── Fases ───────────── */

// lpm: carga objetivo por minuto en las semanas 1-3 del mesociclo · lf: factor de carga de la fase
export const PHASES = [
  { key: 'base', name: 'Base', lpm: [1.22, 1.27, 1.32], lf: 0.96, families: ['resistencia', 'tempo', 'progresivo', 'recuperacion'],
    line: 'Fase Base: construimos el motor aeróbico con mucho minuto suave y algo de ritmo.' },
  { key: 'construccion', name: 'Construcción', lpm: [1.25, 1.3, 1.36], lf: 1.0, families: ['cuestas', 'escalera', 'piramide', 'series-largas', 'umbral'],
    line: 'Fase de Construcción: más series y más fuerza, sin perder la base.' },
  { key: 'especifico', name: 'Específico', lpm: [1.28, 1.34, 1.4], lf: 1.03, families: ['series-cortas', 'umbral', 'tempo', 'series-largas'],
    line: 'Fase Específica: trabajo de calidad a tus ritmos de verdad.' },
  { key: 'picos', name: 'Picos y retos', lpm: [1.3, 1.36, 1.42], lf: 1.05, families: ['reto', 'series-cortas', 'piramide'],
    line: 'Fase de Picos y retos: toca medirse y batir marcas.' },
  { key: 'transicion', name: 'Transición', lpm: [1.18, 1.22, 1.26], lf: 0.92, families: ['fartlek', 'musica', 'recuperacion'],
    line: 'Fase de Transición: jugamos, soltamos piernas y cargamos ilusión para la próxima temporada.' },
];
const PHASE_OF_MESO = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4];
export const phaseOfMeso = (mesoIndex) => PHASES[PHASE_OF_MESO[((mesoIndex % 13) + 13) % 13]];

/* ───────────── Temas ───────────── */

export const THEMES = [
  { key: 'ritmo', name: 'Ritmo constante', families: ['tempo', 'resistencia', 'umbral'],
    intro: 'Este bloque va de encontrar tu ritmo y sostenerlo: respiración regular y zancada que no cambia.' },
  { key: 'tecnica', name: 'Técnica y cadencia', families: ['tecnica', 'recuperacion', 'musica'],
    intro: 'Bloque de técnica y cadencia: pasos cortos, apoyos silenciosos y brazos sueltos.' },
  { key: 'resistencia', name: 'Resistencia larga', families: ['resistencia', 'progresivo'],
    intro: 'Bloque de resistencia larga: minutos y más minutos para un motor que no se apaga.' },
  { key: 'cuestas', name: 'Cuestas', families: ['cuestas', 'progresivo', 'umbral'],
    intro: 'Bloque de cuestas: fuerza en las piernas y potencia sin castigar las articulaciones.' },
  { key: 'escaleras', name: 'Escaleras y pirámides', families: ['piramide', 'escalera'],
    intro: 'Bloque de escaleras y pirámides: subimos y bajamos peldaños de velocidad.' },
  { key: 'fartlek', name: 'Fartlek', families: ['fartlek', 'musica'],
    intro: 'Bloque de fartlek: juego de velocidades para que la cinta nunca sea monótona.' },
  { key: 'velocidad', name: 'Velocidad', families: ['series-cortas', 'series-largas', 'piramide'],
    intro: 'Bloque de velocidad: series para subir tu techo y tu VO₂máx.' },
  { key: 'musica', name: 'Música y ritmo (BPM)', families: ['musica', 'fartlek'],
    intro: 'Bloque de música y ritmo: cada cambio va al compás de los BPM.' },
  { key: 'explosividad', name: 'Explosividad', families: ['series-cortas', 'cuestas', 'reto'],
    intro: 'Bloque de explosividad: arrancadas cortas y potentes, con recuperaciones generosas.' },
  { key: 'fantasma', name: 'Desafío fantasma', families: ['reto', 'progresivo', 'tempo'],
    intro: 'Bloque del desafío fantasma: tu mejor versión corre a tu lado. ¿La alcanzas?' },
  { key: 'records', name: 'Récords', families: ['reto', 'series-largas', 'progresivo'],
    intro: 'Bloque de récords: llegas en forma y toca batir marcas.' },
  { key: 'mixto', name: 'Mixto', families: [],
    intro: 'Bloque mixto: un poco de todo lo aprendido, cada día distinto.' },
  { key: 'juego', name: 'Juego libre', families: ['fartlek', 'musica', 'recuperacion'],
    intro: 'Bloque de juego libre: sin presión, a disfrutar de correr y a cargar ilusión.' },
];
const THEME_BY_KEY = new Map(THEMES.map((t) => [t.key, t]));
// Orden de los 13 mesociclos de la 1.ª temporada (grupos por fase; las siguientes temporadas rotan dentro de cada fase)
const THEME_ORDER = [['ritmo', 'tecnica', 'resistencia'], ['cuestas', 'escaleras', 'fartlek'], ['velocidad', 'musica', 'explosividad'],
  ['fantasma', 'records', 'mixto'], ['juego']];

/** Tema de un mesociclo global (cycleIndex): 13 temas sin repetir en la temporada; cada temporada rota dentro de su fase. */
export function themeOfMeso(cycleIndex) {
  const c = Math.max(0, Math.floor(cycleIndex));
  const season = Math.floor(c / MESO_PER_SEASON);
  const m = c % MESO_PER_SEASON;
  const p = PHASE_OF_MESO[m];
  const group = THEME_ORDER[p];
  const first = PHASE_OF_MESO.indexOf(p);
  const pos = m - first;
  return THEME_BY_KEY.get(group[(pos + season) % group.length]);
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)/g, '').trim();
const THEME_ALIASES = new Map();
for (const t of THEMES) {
  for (const a of [t.key, t.name, norm(t.name), norm(t.name).split(' ')[0]]) THEME_ALIASES.set(norm(a), t.key);
}
THEME_ALIASES.set('bpm', 'musica');
THEME_ALIASES.set('piramides', 'escaleras');
THEME_ALIASES.set('escaleras', 'escaleras');
/** Clave de tema para un texto de plantilla («Música y ritmo (BPM)», «musica», «records»…). */
export const themeKeyOf = (s) => THEME_ALIASES.get(norm(s)) || null;

/* ───────────── Eventos por fecha ───────────── */

export const EVENTS = [
  { key: 'navidad', name: 'Navidad', from: '12-15', to: '01-06', families: ['musica', 'fartlek', 'reto'], themes: ['musica', 'mixto', 'juego'],
    intro: 'Especial de Navidad: corre con espíritu navideño y quema el turrón con una sonrisa.' },
  { key: 'verano', name: 'Verano', from: '07-01', to: '08-31', families: ['fartlek', 'series-cortas', 'musica'], themes: ['fartlek', 'musica', 'juego'],
    intro: 'Especial de Verano: sesión con chispa. Ventilador, agua a mano y a disfrutar.' },
  { key: 'aniversario', name: 'Aniversario RITMUP', from: '10-18', to: '10-18', single: true, families: ['reto', 'piramide'], themes: ['records', 'fantasma'],
    intro: '¡Aniversario de RITMUP! Hoy celebramos con un reto especial: un año más corriendo juntos.' },
];
const inMd = (md, from, to) => (from <= to ? md >= from && md <= to : md >= from || md <= to);
/** Evento activo en una fecha (o null). */
export function eventOn(dateKey) {
  if (typeof dateKey !== 'string' || dateKey.length < 10) return null;
  const md = dateKey.slice(5, 10);
  return EVENTS.find((e) => inMd(md, e.from, e.to)) || null;
}

/* ───────────── Metadatos de plantilla (contrato) ───────────── */

const CAT_DEFAULTS = {
  intervals: { family: 'series-cortas', intensity: 'hard', themes: ['velocidad', 'explosividad'] },
  tempo: { family: 'tempo', intensity: 'moderate', themes: ['ritmo'] },
  endurance: { family: 'resistencia', intensity: 'moderate', themes: ['resistencia'] },
  fartlek: { family: 'fartlek', intensity: 'moderate', themes: ['fartlek', 'mixto'] },
  hills: { family: 'cuestas', intensity: 'hard', themes: ['cuestas'] },
  recovery: { family: 'recuperacion', intensity: 'easy', themes: ['tecnica'] },
  challenge: { family: 'reto', intensity: 'hard', themes: ['records', 'fantasma'] },
  test: { family: 'test', intensity: 'hard', themes: [] },
};
// Pistas para el catálogo original mientras no traiga sus propios campos
const ID_HINTS = {
  pyramid: { family: 'piramide', themes: ['escaleras', 'velocidad'] },
  'pyramid-xl': { family: 'piramide', themes: ['escaleras', 'records'] },
  'ladder-up': { family: 'escalera', themes: ['escaleras'] },
  'long-ladder': { family: 'escalera', themes: ['escaleras', 'resistencia'] },
  countdown: { family: 'escalera', themes: ['escaleras'] },
  'km-repeats': { family: 'series-largas', themes: ['velocidad', 'records'] },
  'over-under': { family: 'umbral', themes: ['ritmo'] },
  'threshold-3x4': { family: 'umbral', intensity: 'hard', themes: ['ritmo'] },
  'cruise-2x6': { family: 'umbral', themes: ['ritmo'] },
  progressive: { family: 'progresivo', themes: ['fantasma'] },
  'fast-finish': { family: 'progresivo', themes: ['fantasma'] },
  'long-progressive': { family: 'progresivo', themes: ['resistencia'] },
  'negative-split': { family: 'progresivo', intensity: 'easy', themes: ['resistencia', 'fantasma'] },
  'long-surges': { intensity: 'easy' },
  'aerobic-base': { intensity: 'easy', themes: ['resistencia', 'ritmo'] },
  'minute-on': { intensity: 'moderate' },
  'sprint-30-60': { intensity: 'moderate', themes: ['explosividad'] },
  'hill-sprints': { themes: ['cuestas', 'explosividad'] },
  'hill-long': { intensity: 'moderate' },
  rollercoaster: { intensity: 'moderate' },
  'easy-strides': { themes: ['tecnica', 'explosividad'] },
  'speed-play': { themes: ['fartlek', 'musica'] },
  waves: { themes: ['fartlek', 'musica'] },
  surprise: { themes: ['mixto', 'juego'] },
  'sprint-finish': { intensity: 'moderate', themes: ['fantasma', 'records'] },
};

const META = new WeakMap();
/** { family, themes (claves), intensity } de una plantilla: sus campos si existen, si no pistas y valores de su categoría. */
export function templateMeta(t) {
  if (!t) return { family: 'resistencia', themes: [], intensity: 'moderate' };
  let m = META.get(t);
  if (m) return m;
  const def = CAT_DEFAULTS[t.category] || CAT_DEFAULTS.endurance;
  const hint = ID_HINTS[t.id] || {};
  const family = typeof t.family === 'string' && t.family ? t.family : hint.family || def.family;
  const intensity = INTENSITIES.includes(t.intensity) ? t.intensity : hint.intensity || def.intensity;
  const raw = Array.isArray(t.themes) && t.themes.length ? t.themes : hint.themes || def.themes;
  const themes = [...new Set(raw.map((x) => themeKeyOf(x) || x).filter(Boolean))];
  m = { family: t.category === 'test' ? 'test' : family, themes, intensity };
  META.set(t, m);
  return m;
}

/* ───────────── Objeto de temporada guardado en state.plan ───────────── */

/** Objeto de temporada (state.plan.season): metadatos; el calendario se deriva de plan.startDate. */
export function makeSeason(startDate) {
  return { v: SEASON_VERSION, startDate: startDate || null, weeks: SEASON_WEEKS, mesoWeeks: MESO_WEEKS, testEvery: TEST_EVERY_WEEKS };
}
