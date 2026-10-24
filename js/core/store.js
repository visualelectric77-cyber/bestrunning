// BestRunning · estado global persistente (localStorage) con suscripción.
import { deepClone } from './utils.js';
import { normalizeGoal } from '../training/goal.js';

const STATE_KEY = 'br.state.v1';
const ACTIVE_KEY = 'br.active.v1';
const ACTIVE_TS_KEY = 'br.active.v1.ts';

/** Versión del esquema persistido (2 = fase 2: música DJ, voz grabada y pulso del Watch). */
export const STATE_VERSION = 2;
const DEFAULT_PACK = 'lucia';
const DEFAULT_HR_SHORTCUT = 'BestRunning FC';
const VISUAL_QUALITIES = ['auto', 'high', 'eco', 'off'];
// Escenarios 3D que se ofrecen en Ajustes (§15.2; el 'legacy' oculto nunca se guarda). Por defecto 'auto': cada
// clase en su mundo (js/player/scene-pick.js). El antiguo valor por defecto ('aurora') se migra una vez a 'auto';
// un escenario elegido a mano se respeta.
const VISUAL_THEMES = ['auto', 'aurora', 'cordillera', 'estadio', 'blank'];
const DEFAULT_VISUAL_THEME = 'auto';
const OLD_DEFAULT_THEME = 'aurora';
const THEME_REV = 3; // 3: «Automático» para todos una vez (también quien tenía un mundo elegido a mano)

const hasLS = (() => {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
})();

export function defaultState() {
  return {
    version: STATE_VERSION,
    onboarded: false,
    createdAt: null,
    profile: { name: '', age: 46, weightKg: 78, sex: 'm', hrMax: 176, hrRest: null },
    levels: { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 },
    levelHistory: [],
    progression: {
      lastBump: {},
      okStreak: {},
      hardStreak: 0,
      loadAdjust: 0,
      lastTest: null,
      bestVam: null,
    },
    schedule: { weekdayMinutes: 20, thursdayMinutes: 50, weekendDay: 6, weekendMinutes: 50, reminderTime: '07:00' },
    // goal: objetivo con fecha de carrera (js/training/goal.js) o null
    plan: { startDate: null, overrides: {}, goal: null },
    treadmill: { hasIncline: false, maxIncline: 12, minSpeed: 1.0, maxSpeed: 18.0, announceLead: 10 },
    audio: {
      voiceEnabled: true, voiceURI: null, rate: 1.0, pitch: 1.0, volume: 1.0, beeps: true,
      chattiness: 'normal', duckMusic: true, packId: DEFAULT_PACK,
    },
    // healthShortcut: Atajo «Guardar en Salud» (fase 1, opcional) · hrShortcut: Atajo de pulso del Watch (§12)
    integrations: { watchReminder: true, healthShortcut: '', hrShortcut: DEFAULT_HR_SHORTCUT },
    music: {
      enabled: true, mode: 'app', volume: 0.8, effects: true, energy: 'normal',
      useBuiltIn: true, useImported: true, disabled: [],
    },
    // Escena 3D del reproductor (§14–§15): calidad 'auto'|'high'|'eco'|'off', escenario (§15.2), modo TV por
    // defecto, balanceo de cámara a tu zancada y fantasma de tu mejor marca (§14.1)
    visuals: { quality: 'auto', theme: DEFAULT_VISUAL_THEME, themeRev: THEME_REV, tvMode: false, strideBob: true, ghost: true, captions: true },
    history: [],
    achievements: {},
    ui: { libraryDuration: 20, libraryCategory: 'all', progressMetric: 'km' },
  };
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Fusión profunda: parte de `base` (por defecto) y aplica lo guardado. Arrays y primitivos guardados sustituyen. */
function mergeDeep(base, saved) {
  if (!isPlainObject(saved)) return base;
  const out = { ...base };
  for (const k of Object.keys(saved)) {
    const sv = saved[k];
    const bv = base[k];
    if (isPlainObject(bv) && isPlainObject(sv)) out[k] = mergeDeep(bv, sv);
    else if (isPlainObject(bv) && !isPlainObject(sv)) out[k] = bv; // tipo corrupto: conserva el valor por defecto
    else if (Array.isArray(bv) && !Array.isArray(sv)) out[k] = bv;
    else if (sv !== undefined) out[k] = sv;
  }
  return out;
}

function readJSON(key) {
  if (!hasLS) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Campos de Session añadidos en la fase 2 (§12, §13): se rellenan en sesiones antiguas. */
export function normalizeSession(session) {
  if (!isPlainObject(session)) return session;
  const out = { ...session };
  for (const k of ['hrAvg', 'hrMax', 'hrMin', 'hrSeries', 'hrZones']) if (out[k] === undefined) out[k] = null;
  if (out.music === undefined) out.music = null;
  else if (isPlainObject(out.music) && !Array.isArray(out.music.tracks)) out.music = { ...out.music, tracks: [] };
  return out;
}

const clamp01 = (v, d) => (Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : d);

/**
 * Migra un estado ya fusionado con los valores por defecto. `savedVersion` es la versión con la que se guardó.
 * v1 → v2: el pack de voz grabado («eva») pasa a ser el predeterminado (en la v1 nadie pudo elegir otro: no existían).
 */
export function migrateState(st, savedVersion = STATE_VERSION) {
  if (!isPlainObject(st)) return defaultState();
  const v = Number(savedVersion) || 1;
  if (v < 2) {
    if (isPlainObject(st.audio) && (st.audio.packId == null || st.audio.packId === '')) st.audio.packId = DEFAULT_PACK;
  }
  // 1.5.5: la voz grabada pasa de Eva (ElevenLabs, plan gratuito: sin uso comercial) a Lucía (generada con licencia
  // comercial en Magnific). Quien tenía Eva pasa a Lucía; quien eligió la voz del sistema (packId null) sigue igual.
  if (isPlainObject(st.audio) && st.audio.packId === 'eva') st.audio.packId = DEFAULT_PACK;
  if (isPlainObject(st.integrations)) {
    const ig = st.integrations;
    if (!String(ig.hrShortcut || '').trim()) ig.hrShortcut = DEFAULT_HR_SHORTCUT;
    // El Atajo de pulso nunca debe recibir los datos de «Guardar en Salud»
    if (String(ig.healthShortcut || '').trim() === String(ig.hrShortcut).trim()) ig.healthShortcut = '';
  }
  // Saneado de música (tipos corruptos o valores fuera de rango)
  const def = defaultState().music;
  const m = isPlainObject(st.music) ? st.music : { ...def };
  m.mode = m.mode === 'own' ? 'own' : 'app';
  m.energy = m.energy === 'max' ? 'max' : 'normal';
  m.volume = clamp01(m.volume, def.volume);
  for (const k of ['enabled', 'effects', 'useBuiltIn', 'useImported']) m[k] = typeof m[k] === 'boolean' ? m[k] : def[k];
  m.disabled = Array.isArray(m.disabled) ? [...new Set(m.disabled.filter((x) => typeof x === 'string' && x))] : [];
  st.music = m;
  // Saneado de la escena 3D (usuarios anteriores la reciben con los valores por defecto)
  const dv = defaultState().visuals;
  const vz = isPlainObject(st.visuals) ? st.visuals : { ...dv };
  vz.quality = VISUAL_QUALITIES.includes(vz.quality) ? vz.quality : dv.quality;
  vz.theme = VISUAL_THEMES.includes(vz.theme) ? vz.theme : dv.theme;
  // Escenario automático. rev 2: quien seguía con el antiguo por defecto pasaba a 'auto'. rev 3 (una sola vez): todos
  // pasan a 'auto', también un mundo elegido a mano antes (p. ej. 'estadio'); después se respeta cualquier elección nueva.
  if (vz.themeRev !== THEME_REV) {
    if (vz.theme === OLD_DEFAULT_THEME || (Number(vz.themeRev) || 0) < 3) vz.theme = DEFAULT_VISUAL_THEME;
    vz.themeRev = THEME_REV;
  }
  for (const k of ['tvMode', 'strideBob', 'ghost', 'captions']) vz[k] = typeof vz[k] === 'boolean' ? vz[k] : dv[k];
  st.visuals = vz;
  if (Array.isArray(st.history)) st.history = st.history.map(normalizeSession);
  // [temporada] Objeto de temporada de 52 semanas en plan.season (js/training/season.js). Solo metadatos: el calendario
  // de fases se deriva siempre de plan.startDate, así que los usuarios existentes conservan su plan y su fecha.
  if (isPlainObject(st.plan)) {
    const sz = isPlainObject(st.plan.season) ? st.plan.season : {};
    st.plan.season = { v: 1, weeks: 52, mesoWeeks: 4, testEvery: 6, ...sz, startDate: st.plan.startDate || null };
    // [objetivo] Objetivo con fecha de carrera: los estados antiguos no lo tienen (null = plan de siempre); uno corrupto
    // o incompleto se descarta en vez de romper el plan.
    st.plan.goal = normalizeGoal(st.plan.goal);
  }
  st.version = STATE_VERSION;
  return st;
}

function hydrate(saved) {
  if (!isPlainObject(saved)) return defaultState();
  const merged = mergeDeep(defaultState(), saved);
  // La marca del escenario automático solo cuenta si venía guardada (los valores por defecto no deben saltarse la migración)
  if (isPlainObject(merged.visuals) && !(isPlainObject(saved.visuals) && saved.visuals.themeRev === THEME_REV)) delete merged.visuals.themeRev;
  return migrateState(merged, saved.version);
}

function loadInitial() {
  return hydrate(readJSON(STATE_KEY));
}

let state = loadInitial();
const listeners = new Set();

function emitStorageError(error) {
  try {
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('br:storage-error', { detail: { error } }));
    }
  } catch {
    /* sin DOM */
  }
}

let persistOk = true;

/** Guarda el estado. Devuelve false (y emite 'br:storage-error') si el almacenamiento falló (p. ej. lleno). */
function persist() {
  if (!hasLS) return (persistOk = true);
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    persistOk = true;
  } catch (error) {
    persistOk = false;
    emitStorageError(error);
  }
  return persistOk;
}

/** ¿Se guardó en disco el último setState()? (false ⇒ el cambio solo vive en memoria hasta el próximo guardado bueno). */
export function lastPersistOk() {
  return persistOk;
}

function notify() {
  for (const fn of [...listeners]) {
    try {
      fn(state);
    } catch (err) {
      // Un listener roto no debe romper al resto; se reporta al manejador global.
      if (typeof reportError === 'function') reportError(err);
      else setTimeout(() => { throw err; });
    }
  }
}

export function getState() {
  return state;
}

export function setState(mutator) {
  const draft = deepClone(state);
  if (typeof mutator === 'function') mutator(draft);
  state = draft;
  persist();
  notify();
  return state;
}

export function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetState() {
  if (hasLS) {
    try {
      localStorage.removeItem(STATE_KEY);
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(ACTIVE_TS_KEY);
    } catch {
      /* nada */
    }
  }
  state = defaultState();
  persist();
  notify();
  return state;
}

export function exportState() {
  const payload = { app: 'RITMUP', exportedAt: new Date().toISOString(), ...state };
  return JSON.stringify(payload, null, 2);
}

export function importState(json) {
  try {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (!isPlainObject(data)) return false;
    if (typeof data.version !== 'number') return false;
    // Se aceptan las copias de antes del cambio de nombre (app: 'BestRunning') y las nuevas (app: 'RITMUP')
    if (data.app != null && data.app !== 'RITMUP' && data.app !== 'BestRunning') return false;
    if (!isPlainObject(data.profile) && !isPlainObject(data.levels)) return false;
    if (data.history != null && !Array.isArray(data.history)) return false;
    if (isPlainObject(data.levels)) {
      for (const k of ['jog', 'run', 'fast', 'sprint']) {
        if (data.levels[k] != null && !(typeof data.levels[k] === 'number' && data.levels[k] > 0 && data.levels[k] < 40)) return false;
      }
    }
    const { app, exportedAt, ...rest } = data; // metadatos de la copia
    state = hydrate(rest);
    persist();
    notify();
    return true;
  } catch {
    return false;
  }
}

/** `savedAt` (ms epoch, opcional): conserva la hora del guardado original (p. ej. al deshacer un «Descartar»). */
export function saveActiveSession(snap, { savedAt = null } = {}) {
  if (!hasLS) return;
  try {
    if (snap == null) {
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(ACTIVE_TS_KEY);
    } else {
      localStorage.setItem(ACTIVE_KEY, JSON.stringify(snap));
      localStorage.setItem(ACTIVE_TS_KEY, String(Number(savedAt) > 0 ? Number(savedAt) : Date.now()));
    }
  } catch (error) {
    emitStorageError(error);
  }
}

export function loadActiveSession() {
  return readJSON(ACTIVE_KEY);
}

/** Extra (no contractual): ms epoch del último guardado de la sesión activa, o null. */
export function activeSessionSavedAt() {
  if (!hasLS) return null;
  try {
    const ts = Number(localStorage.getItem(ACTIVE_TS_KEY));
    if (ts > 0) return ts;
  } catch {
    /* nada */
  }
  const snap = loadActiveSession();
  const t = snap && (snap.savedAt ?? snap.updatedAt ?? snap.startedAt);
  const n = typeof t === 'string' ? Date.parse(t) : Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ───── Efectos de arranque (solo en navegador) ───── */

if (typeof window !== 'undefined') {
  // Almacenamiento persistente (iOS puede purgar datos de webs poco usadas).
  try {
    const st = typeof navigator !== 'undefined' ? navigator.storage : null;
    if (st?.persisted && st?.persist) {
      st.persisted().then((ok) => (ok ? null : st.persist())).catch(() => {});
    } else {
      st?.persist?.()?.catch?.(() => {});
    }
  } catch {
    /* nada */
  }

  // Sincroniza si otra pestaña cambia el estado.
  window.addEventListener('storage', (e) => {
    if (e.key !== STATE_KEY) return;
    state = hydrate(readJSON(STATE_KEY));
    notify();
  });
}
