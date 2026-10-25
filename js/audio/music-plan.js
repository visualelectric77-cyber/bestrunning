// BestRunning · plan musical "de DJ" (SIN DOM: importable desde Node para tests).
// buildMusicPlan convierte una clase + biblioteca analizada en una lista de cues: qué pista suena en cada tramo,
// a qué tempo (estiramiento con preservesPitch), desde qué posición y con qué transición.
//
// Ampliaciones compatibles con SPEC §11.3 (campos extra de cada cue):
//   kind 'segment' | 'intra'        → cue de inicio de tramo o mezcla extra dentro de un tramo largo
//   change 'track' | 'tempo' | 'none' → cambia la pista, solo rampa de tempo (misma pista) o nada
//   entry 'start'|'drop'|'hot'|'mixIn'|'phrase'|'resume'|'continue' → a qué se alinea offsetSec
//   entryAt / entryPos              → instante (s de clase) y posición (s de pista) en que la entrante empieza a sonar
//   mixRate                         → playbackRate durante la mezcla (tempo de la saliente en beatmix; en 'tempo', el de partida)
//   tailSec / rampSec / mixBars     → cola de la mezcla tras atSec, rampa de tempo posterior y compases de mezcla
//   bpm (efectivo final), fromTrackId
// Modelo de posición (lo comparten plan, motor y tests): ver cuePosition().
import { clamp, hashStr, makeRng } from '../core/utils.js';

export const PLAN_VERSION = 1;
export const RATE_MIN = 0.94;
export const RATE_MAX = 1.06;
/** Margen del tempo de mezcla (solo mientras dura un beatmix). */
export const MIX_RATE_MIN = 0.92;
export const MIX_RATE_MAX = 1.08;
/** Una pista es candidata si su BPM estirado cae a ±2 % del objetivo. */
export const MATCH_TOL = 0.02;
/** Beatmix si la diferencia de BPM es ≤ 6 %. */
export const BEATMIX_MAX_DELTA = 0.06;
/** Sprint: se acepta el BPM nativo en este rango. */
export const SPRINT_NATIVE = [148, 190];
export const END_FADE_SEC = 8;
/** Variedad entre sesiones: se evitan las pistas que sonaron en las últimas N sesiones (si hay otras en el tramo). */
export const RECENT_SESSIONS = 8;
/** Penalización por sesión de una pista reciente cuando no queda otra: la de la última sesión pesa más y gana la más antigua. */
const RECENT_STEP = 2;
const RESUME_MIN_SEC = 30;
const PHRASE_BARS = 16;
const MIX_BARS = 8;
const RAMP_BARS = 8;
const EPS = 1e-6;

/** Intensidad relativa de cada zona (para decidir subida/bajada). */
export const ZONE_RANK = { walk: 0, cooldown: 0, warmup: 1, jog: 2, run: 3, fast: 4, sprint: 5 };

/** Pools de tramos musicales preferidos por zona (SPEC §11.2). */
export const ZONE_POOLS = {
  warmup: ['calm', 'jog'], walk: ['calm'], cooldown: ['calm'],
  jog: ['jog'], run: ['jog', 'run'], fast: ['fast'], sprint: ['sprint'],
};

/** BPM objetivo [bajo, alto] por zona. Calentamiento sube por escalones; vuelta a la calma baja. */
const BPM_RANGES = {
  warmup: [110, 120], walk: [106, 108], cooldown: [112, 100],
  jog: [124, 126], run: [128, 130], fast: [136, 140], sprint: [172, 174],
};

const INTENSE = new Set(['fast', 'sprint']);
const round4 = (v) => Math.round(v * 10000) / 10000;
const roundHalf = (v) => Math.round(v * 2) / 2;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/* ───────────── Rejilla de la pista ───────────── */

const GRIDS = new WeakMap();

/**
 * Datos derivados de una pista (memorizados): tiempo, compás, rejilla, cues saneados y puntos de alineación.
 * La energía/hotBars de algunas pistas (DnB doblado tras el análisis) van por compases de 8 tiempos: se detecta
 * comparando la duración con el número de compases.
 */
export function trackGrid(track) {
  if (!track || typeof track !== 'object') return null;
  const hit = GRIDS.get(track);
  if (hit) return hit;
  const bpm = num(track.bpm) > 0 ? num(track.bpm) : 120;
  const spb = 60 / bpm;
  const barSec = 4 * spb;
  const duration = Math.max(0, num(track.duration));
  const barOffset = Number.isFinite(Number(track.barOffset)) ? num(track.barOffset) : num(track.beatOffset);
  const firstBar = ((barOffset % barSec) + barSec) % barSec;
  const energy = Array.isArray(track.energy) ? track.energy.map((x) => clamp(num(x), 0, 1)) : [];
  const bars = num(track.bars) > 0 ? num(track.bars) : energy.length;
  const beatsPerEnergyBar = bars > 0 && duration > barOffset ? (duration - barOffset) / bars / spb : 4;
  const ebSec = (beatsPerEnergyBar >= 6 ? 8 : 4) * spb;
  const cues = track.cues && typeof track.cues === 'object' ? track.cues : {};
  const lastGood = duration - 8 * barSec;
  let outro = num(cues.outro, NaN);
  if (!Number.isFinite(outro) || outro <= firstBar + 8 * barSec || outro > duration) outro = Math.max(firstBar + barSec, lastGood);
  outro = Math.min(outro, duration);
  let mixIn = num(cues.mixIn, NaN);
  if (!Number.isFinite(mixIn) || mixIn < 0 || mixIn >= outro - 8 * barSec) mixIn = firstBar;
  const drops = (Array.isArray(cues.drops) ? cues.drops : [])
    .map(Number).filter((t) => Number.isFinite(t) && t >= 0 && t < outro - 8 * barSec).sort((a, b) => a - b);
  const hotIdx = (Array.isArray(cues.hotBars) ? cues.hotBars : []).map(Number).filter((i) => Number.isInteger(i) && i >= 0);
  const hot = new Set(hotIdx);
  const hotTimes = hotIdx.map((i) => barOffset + i * ebSec).filter((t) => t >= 0 && t < outro);
  const hotStarts = hotIdx.filter((i) => !hot.has(i - 1)).map((i) => barOffset + i * ebSec)
    .filter((t) => t >= 0 && t < outro - 8 * barSec);
  const points = [];
  for (const t of drops) points.push({ t, kind: 'drop' });
  for (const t of hotStarts) if (!drops.some((d) => Math.abs(d - t) < 0.1)) points.push({ t, kind: 'hot' });
  points.sort((a, b) => a.t - b.t);
  const meanEnergy = energy.length ? energy.reduce((a, b) => a + b, 0) / energy.length : 0.6;
  const g = {
    bpm, spb, barSec, barOffset, firstBar, duration, outro, mixIn, drops, hotTimes, alignPoints: points,
    meanEnergy, hasDrops: drops.length > 0, ebSec,
  };
  GRIDS.set(track, g);
  return g;
}

/** Índice (fraccionario) de compás en una posición de la pista. */
export function barIndexAt(track, pos) {
  const g = trackGrid(track);
  return (pos - g.barOffset) / g.barSec;
}

/** Posición (s de pista) del compás `index` (entero, puede ser negativo antes del primer downbeat). */
export function barPos(track, index) {
  const g = trackGrid(track);
  return g.barOffset + index * g.barSec;
}

/** Ajusta una posición a la rejilla de compases: 'nearest' | 'next' | 'prev'. Nunca devuelve < 0. */
export function snapToBar(track, pos, mode = 'nearest') {
  const g = trackGrid(track);
  const i = (pos - g.barOffset) / g.barSec;
  const k = mode === 'next' ? Math.ceil(i - 1e-6) : mode === 'prev' ? Math.floor(i + 1e-6) : Math.round(i);
  let p = g.barOffset + k * g.barSec;
  while (p < -1e-6) p += g.barSec;
  return Math.max(0, p);
}

/** ¿Está `pos` sobre una línea de compás (±tol s)? */
export function onBarGrid(track, pos, tol = 1e-3) {
  const g = trackGrid(track);
  const i = (pos - g.barOffset) / g.barSec;
  return Math.abs(i - Math.round(i)) * g.barSec <= tol;
}

/** Siguiente línea de compás (s de pista) en o después de `pos`. */
export function nextBarPos(track, pos) {
  return snapToBar(track, pos, 'next');
}

/**
 * Segundos reales que faltan para la siguiente línea de compás si la pista está en `positionSec` y suena a `rate`.
 * 0 si ya está encima (±0,1 ms).
 */
export function nextBarTime(track, rate, positionSec) {
  const r = rate > 0 ? rate : 1;
  return Math.max(0, (nextBarPos(track, positionSec - 1e-4) - positionSec) / r);
}

/** Fase dentro del tiempo (0..1) en una posición de la pista. */
export function beatPhaseAt(track, pos) {
  const g = trackGrid(track);
  const b = (pos - g.barOffset) / g.spb;
  return ((b % 1) + 1) % 1;
}

/** Fase dentro del compás (0..1). */
export function barPhaseAt(track, pos) {
  const g = trackGrid(track);
  const b = (pos - g.barOffset) / g.barSec;
  return ((b % 1) + 1) % 1;
}

/** Duración real (s) de un compás de la pista a `rate`. */
export function barSeconds(track, rate = 1) {
  return trackGrid(track).barSec / (rate > 0 ? rate : 1);
}

export const effectiveBpm = (track, rate = 1) => trackGrid(track).bpm * rate;

/** playbackRate para acercar la pista al objetivo, recortado a [0,94, 1,06]. */
export function rateFor(track, targetBpm) {
  return clamp(targetBpm / trackGrid(track).bpm, RATE_MIN, RATE_MAX);
}

const nativeSprint = (g) => g.bpm >= SPRINT_NATIVE[0] - EPS && g.bpm <= SPRINT_NATIVE[1] + EPS;
const stretchFits = (g, target) => Math.abs((g.bpm * clamp(target / g.bpm, RATE_MIN, RATE_MAX)) / target - 1) <= MATCH_TOL + EPS;

/** ¿Es candidata para el objetivo? (sprint acepta además el nativo 148–190). */
export function isCandidate(track, targetBpm, zone = null) {
  const g = trackGrid(track);
  if (!g) return false;
  if (stretchFits(g, targetBpm)) return true;
  return zone === 'sprint' && nativeSprint(g);
}

/** Rate que usará el plan para esa pista en esa zona (sprint fuera de ±2 % ⇒ nativo). */
export function rateForZone(track, targetBpm, zone) {
  const g = trackGrid(track);
  if (zone === 'sprint' && !stretchFits(g, targetBpm) && nativeSprint(g)) return 1;
  return rateFor(track, targetBpm);
}

/* ───────────── BPM objetivo ───────────── */

/**
 * BPM objetivo de una zona. ctx: { step, steps } (escalones de calentamiento/vuelta a la calma),
 * { speed, minSpeed, maxSpeed } (dentro de la zona, más rápido ⇒ algo más de BPM), energy 'normal'|'max'.
 */
export function targetBpmFor(zone, ctx = {}) {
  const { step = 0, steps = 1, speed = null, minSpeed = null, maxSpeed = null, energy = 'normal' } = ctx || {};
  const [a, b] = BPM_RANGES[zone] || BPM_RANGES.jog;
  let f = 0;
  if (zone === 'warmup' || zone === 'cooldown') {
    f = steps > 1 ? clamp(step / (steps - 1), 0, 1) : 0.5;
  } else if (zone === 'sprint') {
    f = energy === 'max' ? 1 : 0;
    return roundHalf(a + (b - a) * f);
  } else if (Number.isFinite(speed) && Number.isFinite(minSpeed) && Number.isFinite(maxSpeed) && maxSpeed - minSpeed > 0.05) {
    f = clamp((speed - minSpeed) / Math.max(0.6, maxSpeed - minSpeed), 0, 1);
  }
  if (energy === 'max' && zone !== 'warmup' && zone !== 'cooldown') f = 0.5 + 0.5 * f;
  return roundHalf(a + (b - a) * f);
}

/** BPM objetivo de cada segmento de la clase (escalones y velocidad relativa dentro de la zona). */
export function segmentTargets(segments, energy = 'normal') {
  const segs = segments || [];
  const range = {};
  for (const s of segs) {
    const r = range[s.zone] || (range[s.zone] = { lo: Infinity, hi: -Infinity });
    r.lo = Math.min(r.lo, s.speed);
    r.hi = Math.max(r.hi, s.speed);
  }
  const out = new Array(segs.length);
  let i = 0;
  while (i < segs.length) {
    const z = segs[i].zone;
    if (z === 'warmup' || z === 'cooldown') {
      let j = i;
      while (j < segs.length && segs[j].zone === z) j++;
      for (let k = i; k < j; k++) out[k] = targetBpmFor(z, { step: k - i, steps: j - i, energy });
      i = j;
      continue;
    }
    const r = range[z];
    out[i] = targetBpmFor(z, { speed: segs[i].speed, minSpeed: r.lo, maxSpeed: r.hi, energy });
    i++;
  }
  return out;
}

/* ───────────── Modelo de posición ───────────── */

/**
 * Posición (s de pista) del cue en el instante T (s de clase):
 * desde entryAt suena a mixRate; tras atSec + tailSec rampa lineal hasta `rate` durante rampSec; después, `rate`.
 * Para T < entryAt extrapola (pre-roll).
 */
export function cuePosition(cue, T) {
  const r0 = num(cue.mixRate, cue.rate);
  const r1 = num(cue.rate, 1);
  const t0 = num(cue.entryAt, cue.atSec);
  const p0 = num(cue.entryPos, cue.offsetSec);
  const tr = num(cue.atSec) + num(cue.tailSec);
  const rs = Math.max(0, num(cue.rampSec));
  if (T <= tr) return p0 + (T - t0) * r0;
  let p = p0 + (tr - t0) * r0;
  const d = Math.min(T - tr, rs);
  if (rs > 0) p += r0 * d + (0.5 * (r1 - r0) * d * d) / rs;
  if (T > tr + rs) p += (T - tr - rs) * r1;
  return p;
}

/** playbackRate nominal del cue en el instante T. */
export function cueRate(cue, T) {
  const r0 = num(cue.mixRate, cue.rate);
  const r1 = num(cue.rate, 1);
  const tr = num(cue.atSec) + num(cue.tailSec);
  const rs = Math.max(0, num(cue.rampSec));
  if (T <= tr) return r0;
  if (rs <= 0 || T >= tr + rs) return r1;
  return r0 + ((r1 - r0) * (T - tr)) / rs;
}

/** Instante T en que el cue alcanza la posición `pos` (búsqueda binaria; el modelo es monótono). */
export function cueTimeAt(cue, pos, Tmax = 1e6) {
  let lo = num(cue.entryAt, cue.atSec) - 600;
  let hi = Math.max(lo + 1, Tmax);
  if (cuePosition(cue, hi) < pos) return hi;
  for (let k = 0; k < 64; k++) {
    const mid = (lo + hi) / 2;
    if (cuePosition(cue, mid) < pos) lo = mid; else hi = mid;
  }
  return hi;
}

/** Índice del cue que manda en T (último con atSec ≤ T), o -1. */
export function cueIndexAt(plan, T) {
  const cues = plan?.cues || [];
  let lo = 0;
  let hi = cues.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].atSec <= T + EPS) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/** Lo que debería sonar en T según el plan: { index, cue, trackId, pos, rate } o null. */
export function expectedAt(plan, T) {
  const i = Math.max(0, cueIndexAt(plan, T));
  const cue = plan?.cues?.[i];
  if (!cue) return null;
  return { index: i, cue, trackId: cue.trackId, pos: cuePosition(cue, T), rate: cueRate(cue, T) };
}

/* ───────────── Plan ───────────── */

function normSegments(workout) {
  return (Array.isArray(workout?.segments) ? workout.segments : [])
    .filter((s) => s && Number(s.sec) > 0)
    .map((s) => ({ zone: ZONE_RANK[s.zone] != null ? s.zone : 'jog', sec: Number(s.sec), speed: num(s.speed) }));
}

/** Duración de la rampa de tempo: 8 compases, o lo que quepa terminando ≥ 10 s antes del final del tramo (mín. 2). */
function rampLength(g, rate, from, avail) {
  const bar = g.barSec / ((rate + from) / 2);
  return clamp(avail - 10, 2 * bar, RAMP_BARS * bar);
}

const validTrack = (t) => t && typeof t === 'object' && t.id && num(t.bpm) > 40 && num(t.duration) > 30;
/** ¿La pista pertenece a un tramo musical preferido para la zona? (tramo medido o curado). */
export const preferred = (t, zone) => (ZONE_POOLS[zone] || []).some((p) => p === t.tier || p === t.curatedTier);

const sessionTrackIds = (ses) => {
  const raw = Array.isArray(ses?.music?.tracks) ? ses.music.tracks : Array.isArray(ses?.music) ? ses.music : [];
  const ids = [];
  for (const x of raw) {
    const id = typeof x === 'string' ? x : x && typeof x === 'object' && x.id != null ? String(x.id) : '';
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
};
const sessionTime = (ses) => {
  for (const k of ['startedAt', 'endedAt', 'date']) {
    const ms = Date.parse(ses?.[k] || '');
    if (Number.isFinite(ms)) return ms;
  }
  return NaN;
};

/**
 * Pistas de las últimas `n` sesiones con música de la app (session.music.tracks: ids o { id }), para la variedad
 * entre sesiones. Devuelve un Map id → antigüedad (0 = la última sesión, n−1 = la más antigua que se recuerda).
 * El historial se ordena por fecha (startedAt/endedAt/date) y, sin fecha, por su orden (se añade al final).
 */
export function recentTracksFromHistory(history, n = RECENT_SESSIONS) {
  const ages = new Map();
  const list = (Array.isArray(history) ? history : [])
    .map((s, i) => ({ s, i, t: sessionTime(s), ids: sessionTrackIds(s) }))
    .filter((x) => x.ids.length);
  list.sort((a, b) => (Number.isFinite(a.t) && Number.isFinite(b.t) && a.t !== b.t ? b.t - a.t : b.i - a.i));
  const keep = Math.max(0, Math.floor(num(n, RECENT_SESSIONS)));
  list.slice(0, keep).forEach((x, age) => { for (const id of x.ids) if (!ages.has(id)) ages.set(id, age); });
  return ages;
}

/**
 * Normaliza la memoria de sesiones anteriores: Map/objeto id → antigüedad, lista de sesiones (la más reciente
 * primero; cada una, lista de ids) o lista plana de ids (antigüedad 0). Sin ella, el campo `recentAge` de cada pista
 * (lo pone loadLibrary() a partir del historial).
 */
function recentAges(recent, lib) {
  const ages = new Map();
  const put = (id, age) => {
    const a = Math.max(0, num(age, 0));
    if (id == null || id === '') return;
    const k = String(id);
    if (!ages.has(k) || ages.get(k) > a) ages.set(k, a);
  };
  if (recent instanceof Map) for (const [id, a] of recent) put(id, a);
  else if (Array.isArray(recent)) recent.forEach((x, i) => { if (Array.isArray(x)) x.forEach((id) => put(id, i)); else put(x, 0); });
  else if (recent && typeof recent === 'object') for (const [id, a] of Object.entries(recent)) put(id, a);
  else if (recent == null) for (const t of lib) if (t.recentAge != null && Number.isFinite(Number(t.recentAge))) put(t.id, t.recentAge);
  return ages;
}

/**
 * Plan musical de la clase. tracks: [{ id, bpm, duration, barOffset, energy, cues, tier, … }].
 * opts: { seed, announceLead = 10, prefs: { energy: 'normal'|'max' }, recent }.
 * recent: pistas de las últimas sesiones (ver recentAges); se evitan mientras el tramo tenga otras sin estrenar.
 * `false` desactiva la memoria (y también la que traigan las pistas en `recentAge`).
 */
export function buildMusicPlan(workout, tracks, { seed, announceLead = 10, prefs = {}, recent } = {}) {
  const segs = normSegments(workout);
  const lib = (Array.isArray(tracks) ? tracks : []).filter(validTrack);
  const energy = prefs?.energy === 'max' ? 'max' : 'normal';
  const sd = seed ?? workout?.seed ?? 1;
  const totalSec = segs.reduce((a, s) => a + s.sec, 0);
  const plan = { version: PLAN_VERSION, seed: sd, energy, totalSec, endFadeSec: END_FADE_SEC, cues: [], trackIds: [] };
  if (!segs.length || !lib.length) return plan;
  const ages = recent === false ? new Map() : recentAges(recent, lib);
  const isRecent = (t) => ages.has(t.id);
  const span = Math.max(RECENT_SESSIONS, ...ages.values(), 0) + 1;

  const lead = clamp(num(announceLead, 10), 3, 20);
  const rng = makeRng(hashStr(`dj|${workout?.templateId || workout?.id || ''}|${sd}|${energy}`));
  // Azar estable por pista para esta sesión (variedad sin depender del orden de consulta)
  const jitter = new Map(lib.map((t) => [t.id, rng.next()]));
  const byId = new Map(lib.map((t) => [t.id, t]));
  const targets = segmentTargets(segs, energy);
  // Halloween: el DJ busca primero lo oscuro (dark/melodic techno, minimal, psytrance) sin romper el tempo del tramo
  const darkBias = workout?.event === 'halloween' ? 2.5 : 0;
  const isDark = (t) => /dark|techno|mystic|midnight|minimal|psytrance|trance|veiled|night/i.test(`${t.id} ${t.title || ''} ${t.genre || ''}`);
  const starts = [];
  let acc = 0;
  for (const s of segs) { starts.push(acc); acc += s.sec; }

  const cues = plan.cues;
  const lastUse = new Map();          // trackId → orden de último uso
  let useCounter = 0;
  const memory = {};                  // zona → { trackId, pos }
  let active = null;                  // { track, zone, cue }
  let prevEnd = -Infinity;            // fin de la última transición (atSec + tailSec)

  const markUsed = (id) => { lastUse.set(id, ++useCounter); };
  const runLength = (i) => {
    let s = 0;
    for (let j = i; j < segs.length && segs[j].zone === segs[i].zone; j++) s += segs[j].sec;
    return s;
  };
  const posAt = (T) => cuePosition(active.cue, T);
  const rateAt = (T) => cueRate(active.cue, T);

  /**
   * Elige una pista nueva para la zona: sin repetir dentro de la sesión mientras haya alternativas y, dentro del
   * tramo preferido, sin repetir las de las últimas sesiones (si todas son recientes, la que sonó hace más tiempo).
   */
  function chooseTrack(zone, target, needSec, exclude) {
    const cand = lib.filter((t) => !exclude.has(t.id));
    const pool = cand.length ? cand : lib.filter((t) => t.id !== active?.track?.id);
    const fits = pool.filter((t) => isCandidate(t, target, zone));
    const fresh = fits.filter((t) => !lastUse.has(t.id));
    const groups = [
      fresh.filter((t) => preferred(t, zone) && !isRecent(t)),
      fresh.filter((t) => preferred(t, zone)),
      fresh.filter((t) => !isRecent(t)),
      fresh,
      fits,
      pool,
      lib,
    ];
    const list = groups.find((g) => g.length) || lib;
    const reuse = list.some((t) => lastUse.has(t.id));
    let best = null;
    let bestScore = -Infinity;
    for (const t of list) {
      const g = trackGrid(t);
      const rate = rateForZone(t, target, zone);
      const eff = g.bpm * rate;
      let s = -Math.abs(eff / target - 1) * 40 - Math.abs(rate - 1) * 8;
      if (preferred(t, zone)) s += 1;
      if (darkBias && isDark(t)) s += darkBias;
      if (INTENSE.has(zone)) {
        s += g.hasDrops ? (energy === 'max' ? 1.4 : 0.5) : 0;
        s += g.meanEnergy * 0.6;
        if (zone === 'sprint') s -= (Math.abs(eff - 172) / 172) * 4;
      } else if (zone === 'cooldown' || zone === 'walk') {
        s -= g.meanEnergy * 0.3;
      }
      const usable = (g.outro - g.mixIn) / rate;
      s += Math.min(1, usable / Math.max(60, Math.min(needSec, 300))) * 0.6;
      s += (jitter.get(t.id) || 0) * 0.9;
      // Sonó en una sesión reciente (solo cuenta si no quedaba otra): cuanto más reciente, peor
      if (isRecent(t)) s -= RECENT_STEP * (span - ages.get(t.id));
      // Ya usadas: la menos reciente primero (y nunca la que suena)
      if (reuse && lastUse.has(t.id)) s -= (lastUse.get(t.id) / Math.max(1, useCounter)) * 3;
      if (t.id === active?.track?.id) s -= 100;
      if (s > bestScore) { bestScore = s; best = t; }
    }
    return best;
  }

  /** Punto de entrada de una pista nueva: drop/hotBar en tramos intensos; mixIn (frase) en el resto. */
  function freshEntry(track, zone, needSec, rate) {
    const g = trackGrid(track);
    if (INTENSE.has(zone) && g.alignPoints.length) {
      const need = Math.max(RESUME_MIN_SEC, Math.min(needSec, 90)) * rate;
      const roomy = g.alignPoints.filter((p) => g.outro - p.t >= need);
      const drops = roomy.filter((p) => p.kind === 'drop');
      const pickFrom = drops.length ? drops : roomy;
      if (pickFrom.length) return { offset: pickFrom[0].t, entry: pickFrom[0].kind };
      const most = g.alignPoints.reduce((a, b) => (g.outro - b.t > g.outro - a.t ? b : a));
      return { offset: most.t, entry: most.kind };
    }
    return { offset: snapToBar(track, g.mixIn, 'nearest'), entry: 'mixIn' };
  }

  /** Compases de rejilla disponibles antes de `offset` (como mucho `bars`), para entrar mezclando. */
  function roomBefore(track, offset, bars) {
    const g = trackGrid(track);
    return Math.min(bars, Math.max(0, Math.floor((offset - g.firstBar) / g.barSec + 1e-6)));
  }

  function chooseTransition(outZone, inZone, outEff, inEff) {
    const delta = Math.abs(inEff / outEff - 1);
    const rise = ZONE_RANK[inZone] - ZONE_RANK[outZone];
    if (rise > 0 && INTENSE.has(inZone) && energy === 'max') return 'riser-drop';
    if (delta <= BEATMIX_MAX_DELTA + EPS) return 'beatmix';
    if (rise > 0) return ZONE_RANK[inZone] >= ZONE_RANK.run ? 'riser-drop' : 'filter-fade';
    if (rise < 0) return 'echo-out';
    return 'filter-fade';
  }

  /**
   * Construye el cue de un cambio de pista en atSec (inicio del tramo o mezcla intra-zona).
   * resumePos: posición recordada (memoria de discos) o null.
   */
  function trackChange({ i, atSec, zone, target, track, resumePos, kind, maxTail, wanted, mixBars = MIX_BARS }) {
    const g = trackGrid(track);
    const rate = rateForZone(track, target, zone);
    const barEff = g.barSec / rate;
    let offset;
    let entry;
    if (resumePos != null) {
      offset = Math.max(g.firstBar, snapToBar(track, resumePos, 'nearest'));
      entry = 'resume';
    } else {
      const fe = freshEntry(track, zone, kind === 'intra' ? segs[i].sec - (atSec - starts[i]) : runLength(i), rate);
      offset = fe.offset;
      entry = fe.entry;
    }
    const out = active;
    const outG = out ? trackGrid(out.track) : null;
    const segEnd = starts[i] + segs[i].sec;
    const room = Math.max(0, atSec - Math.max(prevEnd, out ? out.cue.atSec : 0) - 1);
    // Tempo de la saliente al empezar la mezcla (estimado y refinado con el instante real de entrada)
    // (con los compases de entrada de ESTA mezcla: una intra-zona corta entra más tarde, quizá con la saliente aún en rampa)
    const leadEst = Math.ceil(mixBars / 2);
    let outRate = out ? rateAt(atSec - Math.min(room, leadEst * barEff)) : 1;
    if (out) {
      const est = Math.min(leadEst, Math.floor(room / (g.barSec / ((outG.bpm * outRate) / g.bpm)) + EPS));
      outRate = rateAt(atSec - est * (g.barSec / ((outG.bpm * outRate) / g.bpm)));
    }
    const outEff = out ? outG.bpm * outRate : g.bpm * rate;
    // La cola nunca lleva a la saliente más allá de su final físico
    if (out) maxTail = Math.min(maxTail, Math.max(0, (outG.duration - 2 * outG.barSec - posAt(atSec)) / Math.max(RATE_MIN, outRate)));
    const fits = out && Math.abs((g.bpm * rate) / outEff - 1) <= BEATMIX_MAX_DELTA + EPS;
    let transition = !out ? 'start' : wanted && fits ? wanted : chooseTransition(out.zone, zone, outEff, g.bpm * rate);
    const cue = {
      segIndex: i, atSec, zone, targetBpm: target, trackId: track.id, offsetSec: offset, rate, transition,
      leadSec: 0, kind, change: 'track', entry, entryAt: atSec, entryPos: offset, mixRate: rate,
      tailSec: 0, rampSec: 0, mixBars: 0, bpm: g.bpm * rate, fromTrackId: out ? out.track.id : null,
    };

    if (transition === 'beatmix') {
      const mixRate = outEff / g.bpm;
      const mixBar = g.barSec / mixRate;
      let leadBars = Math.min(Math.ceil(mixBars / 2), Math.floor(room / mixBar + EPS));
      let entryPos;
      if (entry === 'resume') {
        // Retoma: la entrante arranca justo donde se quedó y llega a atSec unos compases después
        entryPos = offset;
        leadBars = Math.min(leadBars, Math.max(0, Math.floor((g.outro - offset) / g.barSec) - 8));
        offset = entryPos + leadBars * g.barSec;
      } else {
        // Pista nueva sin compases delante: se entra una frase más tarde (salvo drop, que manda)
        if (entry === 'mixIn' || entry === 'phrase') {
          let tries = 0;
          while (roomBefore(track, offset, leadBars) < leadBars && tries++ < 8 && offset + 4 * g.barSec < g.outro - PHRASE_BARS * g.barSec) {
            offset += 4 * g.barSec;
            entry = 'phrase';
          }
        }
        leadBars = Math.min(leadBars, roomBefore(track, offset, leadBars));
        entryPos = offset - leadBars * g.barSec;
      }
      const tailBars = Math.min(Math.max(1, Math.floor(mixBars / 2)), Math.floor(maxTail / mixBar + EPS));
      if (mixRate >= MIX_RATE_MIN && mixRate <= MIX_RATE_MAX && leadBars >= 1 && tailBars >= 1) {
        const leadSec = leadBars * mixBar;
        const tailSec = tailBars * mixBar;
        Object.assign(cue, {
          offsetSec: offset, entry, mixRate, leadSec, tailSec, mixBars: leadBars + tailBars,
          entryAt: atSec - leadSec, entryPos,
          rampSec: Math.abs(rate - mixRate) > 0.002 ? rampLength(g, rate, mixRate, segEnd - (atSec + tailSec)) : 0,
        });
        return cue;
      }
      if (entry === 'resume') offset = entryPos;
      // No cabe un beatmix: subida ⇒ riser, bajada ⇒ eco, si no fundido con filtro
      const rise = ZONE_RANK[zone] - ZONE_RANK[out.zone];
      transition = rise > 0 && ZONE_RANK[zone] >= ZONE_RANK.run ? 'riser-drop' : rise < 0 ? 'echo-out' : 'filter-fade';
      cue.transition = transition;
      cue.offsetSec = offset;
      cue.entryPos = offset;
      cue.entry = entry;
    }

    if (transition === 'riser-drop') {
      let leadBars = clamp(Math.round(lead / barEff), 2, 8);
      leadBars = Math.max(1, Math.min(leadBars, Math.floor(room / barEff + EPS)));
      const buildBars = entry === 'resume' ? 0 : roomBefore(track, offset, leadBars);
      Object.assign(cue, {
        leadSec: leadBars * barEff, entryAt: atSec - buildBars * barEff, entryPos: offset - buildBars * g.barSec,
        mixBars: leadBars,
      });
    } else if (transition === 'echo-out') {
      const outBar = out ? outG.barSec / outRate : barEff;
      Object.assign(cue, {
        leadSec: Math.min(outBar, room), tailSec: Math.min(2 * barEff, maxTail), mixBars: 1,
      });
    } else if (transition === 'filter-fade') {
      const outBar = out ? outG.barSec / outRate : barEff;
      Object.assign(cue, {
        leadSec: Math.min(2 * outBar, room), tailSec: Math.min(2 * barEff, maxTail), mixBars: 2,
      });
    } else if (transition === 'start') {
      Object.assign(cue, { tailSec: Math.min(4 * barEff, maxTail), mixBars: 4 });
    }
    return cue;
  }

  function pushCue(cue) {
    for (const k of ['atSec', 'offsetSec', 'rate', 'leadSec', 'entryAt', 'entryPos', 'mixRate', 'tailSec', 'rampSec', 'bpm']) cue[k] = round4(cue[k]);
    cues.push(cue);
    if (!plan.trackIds.includes(cue.trackId)) plan.trackIds.push(cue.trackId);
    if (cue.change === 'track') prevEnd = cue.atSec + cue.tailSec;
  }

  function enter(cue, track, zone) {
    markUsed(track.id);
    active = { track, zone, cue };
  }

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const T0 = starts[i];
    const T1 = T0 + seg.sec;
    const target = targets[i];
    const next = segs[i + 1] || null;

    if (!active) {
      const t = chooseTrack(seg.zone, target, runLength(i), new Set());
      const cue = trackChange({ i, atSec: T0, zone: seg.zone, target, track: t, resumePos: null, kind: 'segment', maxTail: seg.sec * 0.4 });
      if (!INTENSE.has(seg.zone)) { cue.offsetSec = 0; cue.entryPos = 0; cue.entry = 'start'; }
      pushCue(cue);
      enter(cue, t, seg.zone);
    } else if (active.zone === seg.zone) {
      // Mismo tipo de tramo: la pista sigue (rampa de tempo si cambia el objetivo)
      const t = active.track;
      const g = trackGrid(t);
      const pos = posAt(T0);
      const end = seg.zone === 'cooldown' ? g.duration - 2 * g.barSec : g.outro;
      const left = (end - pos) / Math.max(RATE_MIN, rateAt(T0));
      const keep = (isCandidate(t, target, seg.zone) || Math.abs(target - active.cue.targetBpm) < 0.25) && left >= Math.min(seg.sec, 30);
      if (keep) {
        const rate = rateForZone(t, target, seg.zone);
        const from = rateAt(T0);
        const changes = Math.abs(rate - from) > 0.0005;
        const cue = {
          segIndex: i, atSec: T0, zone: seg.zone, targetBpm: target, trackId: t.id, offsetSec: pos, rate,
          transition: 'beatmix', leadSec: 0, kind: 'segment', change: changes ? 'tempo' : 'none', entry: 'continue',
          entryAt: T0, entryPos: pos, mixRate: from, tailSec: 0,
          rampSec: changes ? rampLength(g, rate, from, T1 - T0) : 0, mixBars: 0, bpm: g.bpm * rate, fromTrackId: t.id,
        };
        pushCue(cue);
        active = { ...active, cue };
      } else {
        const exclude = new Set([t.id, ...Object.values(memory).map((m) => m.trackId)]);
        const nt = chooseTrack(seg.zone, target, runLength(i), exclude);
        const cue = trackChange({ i, atSec: T0, zone: seg.zone, target, track: nt, resumePos: null, kind: 'segment', maxTail: seg.sec * 0.4, wanted: 'beatmix' });
        pushCue(cue);
        enter(cue, nt, seg.zone);
      }
    } else {
      // Cambio de zona: memoria de discos (retoma la pista de esa zona donde se quedó) o pista nueva
      const out = active;
      const mem = memory[seg.zone];
      let track = null;
      let resumePos = null;
      if (mem && mem.trackId !== out.track.id) {
        const mt = byId.get(mem.trackId);
        if (mt && isCandidate(mt, target, seg.zone)) {
          const mg = trackGrid(mt);
          const rp = Math.max(mg.firstBar, snapToBar(mt, mem.pos, 'nearest'));
          const remain = (mg.outro - rp) / rateForZone(mt, target, seg.zone);
          if (remain >= clamp(seg.sec, RESUME_MIN_SEC, 90) - EPS) { track = mt; resumePos = mem.pos; }
        }
      }
      if (!track) {
        const exclude = new Set([out.track.id, ...Object.entries(memory).filter(([z]) => z !== seg.zone).map(([, m]) => m.trackId)]);
        track = chooseTrack(seg.zone, target, runLength(i), exclude);
      }
      delete memory[seg.zone];
      const cue = trackChange({ i, atSec: T0, zone: seg.zone, target, track, resumePos, kind: 'segment', maxTail: seg.sec * 0.4 });
      const leaveT = cue.transition === 'beatmix' ? T0 + cue.tailSec : T0;
      memory[out.zone] = { trackId: out.track.id, pos: posAt(leaveT) };
      pushCue(cue);
      enter(cue, track, seg.zone);
    }

    // Tramos largos: mezcla intra-zona a una frontera de frase (16 compases antes del outro)
    for (let guard = 0; guard < 40; guard++) {
      const t = active.track;
      const g = trackGrid(t);
      const endPos = posAt(T1);
      const hardEnd = g.duration - 2 * g.barSec;
      // En la vuelta a la calma el outro suave encaja: solo se mezcla si la pista se acabaría
      const softEnd = seg.zone === 'cooldown' ? hardEnd : g.outro;
      if (endPos <= softEnd + EPS) break;
      const zoneChange = !next || next.zone !== seg.zone;
      const limit = !next ? T1 - END_FADE_SEC - 2 : zoneChange ? T1 - (lead + 3) : T1 - 1;
      const minStartT = Math.max(prevEnd + 1, active.cue.atSec + 4, active.cue.atSec + active.cue.tailSec + active.cue.rampSec);
      const minPos = posAt(Math.min(minStartT, cueTimeAt(active.cue, hardEnd - 2 * g.barSec, T1 + 600)));
      const mixAt = (p, bars = MIX_BARS) => {
        const tP = cueTimeAt(active.cue, p, T1 + 600);
        const bar = g.barSec / rateAt(tP);
        return { p, bars, tP, at: tP + Math.ceil(bars / 2) * bar, end: tP + bars * bar };
      };
      let m = mixAt(snapToBar(t, g.outro - PHRASE_BARS * g.barSec, 'nearest'));
      while (m.end > limit && m.p - 8 * g.barSec >= minPos) m = mixAt(m.p - 8 * g.barSec);
      if (m.p < minPos - EPS) m = mixAt(snapToBar(t, minPos, 'next'));
      if (m.end > limit + EPS) {
        // No cabe la frase antes del siguiente cambio: si la pista aguanta, se deja sonar un poco de outro
        if (endPos <= Math.min(hardEnd, g.outro + 8 * g.barSec) || m.tP >= limit - 2) {
          if (endPos <= hardEnd) break;
          // Se acabaría antes del cambio: mezcla obligatoria lo más tarde posible antes de su final
          let p = snapToBar(t, Math.min(m.p, hardEnd - MIX_BARS * g.barSec), 'prev');
          if (p < minPos) p = snapToBar(t, minPos, 'next');
          m = mixAt(p);
        }
      }
      // Nunca más allá del final físico: si no caben 8 compases, mezcla más corta (mín. 1)
      if (m.p + m.bars * g.barSec > hardEnd + EPS) {
        const fit = Math.floor((hardEnd - m.p) / g.barSec + EPS);
        m = mixAt(m.p, Math.max(1, fit >= 2 ? fit - (fit % 2) : fit));
      }
      const rest = T1 - m.at;
      if (rest < 6 && (endPos <= hardEnd || rest < 2)) break;
      const exclude = new Set([t.id, ...Object.values(memory).map((x) => x.trackId)]);
      const nt = chooseTrack(seg.zone, target, rest, exclude);
      const maxTail = Math.max(0, Math.min(limit, T1 - 1) - m.at);
      const cue = trackChange({ i, atSec: m.at, zone: seg.zone, target, track: nt, resumePos: null, kind: 'intra', maxTail, wanted: 'beatmix', mixBars: m.bars });
      pushCue(cue);
      enter(cue, nt, seg.zone);
    }
  }
  cues.sort((a, b) => a.atSec - b.atSec);
  return plan;
}

/** Resumen legible del plan (para depurar o mostrar). */
export function describePlan(plan, tracksById = null) {
  const get = (id) => (tracksById instanceof Map ? tracksById.get(id) : tracksById?.[id]) || null;
  return (plan?.cues || []).map((c) => {
    const t = get(c.trackId);
    const name = t ? `${t.title}` : c.trackId;
    return `${String(Math.round(c.atSec)).padStart(5)} s  ${c.zone.padEnd(8)} ${c.transition.padEnd(11)} ${c.change.padEnd(5)} ${c.bpm.toFixed(1).padStart(6)} BPM  ${name} @${c.offsetSec.toFixed(1)}`;
  });
}
