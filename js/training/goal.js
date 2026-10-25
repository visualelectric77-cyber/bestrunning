// RITMUP · objetivo con fecha de carrera (sin DOM). Lógica pura que comparten el planificador, Hoy y Mi plan.
//
// El objetivo vive en state.plan.goal = { v, distance: '5k'|'10k'|'15k'|'21k', date: 'YYYY-MM-DD', targetSec|null, setOn,
//   where: 'calle'|'cinta' } (where: la carrera se corre en la calle o EN LA CINTA; en la cinta, el día de la carrera es una clase: js/training/race.js).
// Con objetivo, las últimas semanas antes de la carrera forman un BLOQUE ESPECÍFICO que sustituye al ciclo normal:
//   · Construcción: ciclos de 3 semanas de carga + 1 de descarga contados HACIA ATRÁS desde la puesta a punto (la
//     semana pico cae justo antes de afinar), clases de ritmo de carrera el jueves y la tirada del finde que crece
//     hasta lo que admite el catálogo (60′) en 10K y 21K.
//   · Puesta a punto (taper): 1 semana (2 en la media maratón) con menos volumen y algo de ritmo de carrera.
//   · Semana de carrera: sesiones cortas y suaves, descanso la víspera y el día de la carrera marcado.
//   · Recuperación: la semana siguiente, todo suave. Después, la temporada sigue como siempre.
// El bloque nunca empieza antes de la semana en que se fijó el objetivo (no reescribe semanas ya pasadas) ni antes
// del inicio del plan. Sin objetivo, nada de esto se aplica y el plan queda exactamente igual.
import { addDays, mondayOf, daysBetween, weekdayOf, fmt } from '../core/utils.js';
import { predictRaces } from './race-predict.js';
import { vamFromLevels } from './levels.js';

export const GOAL_VERSION = 1;

/**
 * Distancias: maxWeeks = duración máxima del bloque específico (semana de carrera incluida) · taper = semanas de
 * puesta a punto · longMax = minutos de la tirada larga del finde al final de la construcción (tope del catálogo: 60) ·
 * thu / long = familias que se priorizan el jueves (ritmo de carrera) y en la tirada larga · sim = ensayo de carrera.
 */
export const GOAL_DISTANCES = [
  { key: '5k', label: '5K', name: '5K', km: 5, maxWeeks: 8, taper: 1, longMax: 0, minSec: 12 * 60, maxSec: 60 * 60,
    thu: ['series-largas', 'series-cortas', 'piramide', 'escalera'], long: ['progresivo', 'resistencia', 'reto'], sim: ['reto-5k', 'ghost-time-trial', 'last-km'] },
  { key: '10k', label: '10K', name: '10K', km: 10, maxWeeks: 10, taper: 1, longMax: 60, minSec: 26 * 60, maxSec: 2 * 3600,
    thu: ['umbral', 'series-largas', 'tempo'], long: ['resistencia', 'progresivo'], sim: ['challenge-10k', 'ghost-time-trial', 'last-km'] },
  { key: '15k', label: '15K', name: '15K', km: 15, maxWeeks: 10, taper: 1, longMax: 60, minSec: 40 * 60, maxSec: 3 * 3600,
    thu: ['umbral', 'tempo', 'series-largas'], long: ['resistencia', 'progresivo'], sim: ['challenge-10k', 'long-cruise', 'ghost-time-trial'] },
  { key: '21k', label: '21K', name: 'media maratón', km: 21.0975, maxWeeks: 12, taper: 2, longMax: 60, minSec: 58 * 60, maxSec: 4 * 3600,
    thu: ['tempo', 'umbral', 'progresivo'], long: ['resistencia', 'progresivo'], sim: ['the-hour', 'long-cruise', 'steady-state'] },
];
const BY_KEY = new Map(GOAL_DISTANCES.map((d) => [d.key, d]));
export const goalDistance = (key) => BY_KEY.get(key) || null;

/** Etapas del bloque y su nombre visible (semana del plan). */
export const GOAL_STAGES = { build: 'Construcción', taper: 'Puesta a punto', race: 'Semana de carrera', recovery: 'Recuperación' };

const isKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(new Date(`${k}T12:00:00`).getTime());
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const maxKey = (...keys) => keys.filter(Boolean).reduce((a, b) => (b > a ? b : a));

/** Objetivo saneado o null (estado antiguo, corrupto o sin objetivo). */
export function normalizeGoal(g) {
  if (!isPlainObject(g)) return null;
  const d = goalDistance(String(g.distance || '').toLowerCase());
  if (!d || !isKey(g.date)) return null;
  const t = Math.round(Number(g.targetSec));
  return {
    v: GOAL_VERSION,
    distance: d.key,
    date: g.date,
    targetSec: Number.isFinite(t) && t >= d.minSec && t <= d.maxSec ? t : null,
    setOn: isKey(g.setOn) ? g.setOn : null,
    where: g.where === 'cinta' ? 'cinta' : 'calle',
  };
}

/** Objetivo del estado (o null). */
export const goalOf = (state) => normalizeGoal(state?.plan?.goal);

/** Firma estable del objetivo para la memoria del planificador ('' sin objetivo). */
export function goalSig(goal) {
  const g = normalizeGoal(goal);
  return g ? `${g.distance}@${g.date}@${g.setOn || ''}` : '';
}

/** Lunes de inicio del bloque específico y número de semanas (semana de carrera incluida). */
export function goalBlock(goal, planStartMonday = null) {
  const g = normalizeGoal(goal);
  if (!g) return null;
  const d = goalDistance(g.distance);
  const raceMonday = mondayOf(g.date);
  let start = maxKey(addDays(raceMonday, -(d.maxWeeks - 1) * 7), g.setOn ? mondayOf(g.setOn) : null, planStartMonday);
  if (start > raceMonday) start = raceMonday;
  const weeks = Math.round(daysBetween(start, raceMonday) / 7) + 1;
  const taper = weeks >= 4 ? d.taper : weeks >= 2 ? 1 : 0;
  return { start, raceMonday, weeks, taper, build: Math.max(0, weeks - 1 - taper) };
}

/**
 * Semana del bloque para el lunes `mondayKey` (o null fuera del bloque):
 * { stage, k (semanas hasta la de carrera: 0 = esa, -1 = la siguiente), weekInCycle, weekOfBlock, blockWeeks, buildIndex,
 *   buildWeeks, isLastBuild, taperWeeks, distance, label, raceDate, raceWeekday, longMinutes(base) }
 */
export function goalWeekInfo(goal, mondayKey, planStartMonday = null) {
  const g = normalizeGoal(goal);
  if (!g || !isKey(mondayKey)) return null;
  const blk = goalBlock(g, planStartMonday);
  const monday = mondayOf(mondayKey);
  const k = Math.round(daysBetween(monday, blk.raceMonday) / 7);
  if (k < -1 || monday < blk.start) return null;
  const d = goalDistance(g.distance);
  const stage = k === -1 ? 'recovery' : k === 0 ? 'race' : k <= blk.taper ? 'taper' : 'build';
  let weekInCycle = 4;
  let buildIndex = null;
  if (stage === 'build') {
    const b = k - blk.taper; // 1 = última semana de construcción (pico)
    weekInCycle = [3, 2, 1, 4][(b - 1) % 4];
    if (b === blk.build && weekInCycle === 4) weekInCycle = 1; // el bloque nunca empieza descargando
    buildIndex = blk.build - b;
  }
  return {
    stage, k, weekInCycle, buildIndex, buildWeeks: blk.build, isLastBuild: stage === 'build' && k - blk.taper === 1,
    taperWeeks: blk.taper, taperIndex: stage === 'taper' ? blk.taper - k : null,
    weekOfBlock: stage === 'recovery' ? blk.weeks + 1 : blk.weeks - k, blockWeeks: blk.weeks, blockStart: blk.start,
    distance: d.key, label: d.label, raceDate: g.date, raceWeekday: weekdayOf(g.date), targetSec: g.targetSec, where: g.where,
  };
}

/** Minutos de la tirada larga del finde en una semana de construcción (nunca menos que lo que ya corres). */
export function goalLongMinutes(gw, baseMinutes) {
  const d = goalDistance(gw?.distance);
  const base = Number(baseMinutes) || 50;
  if (!d || gw.stage !== 'build' || !d.longMax || base >= d.longMax) return base;
  const span = Math.max(1, gw.buildWeeks - 1);
  const p = gw.buildWeeks <= 1 ? 1 : Math.min(1, gw.buildIndex / span);
  return Math.min(d.longMax, base + Math.round(((d.longMax - base) * p) / 5) * 5);
}

/* ───────────── Textos ───────────── */

/** «15 de marzo» */
export function raceDateText(key) {
  if (!isKey(key)) return '';
  const d = new Date(`${key}T12:00:00`);
  return `${d.getDate()} de ${fmt.monthName(d.getMonth())}`;
}

/** «Faltan 6 semanas» · «Faltan 9 días» · «Mañana es tu carrera» · «Hoy es tu carrera» · null si ya pasó. */
export function countdownText(today, raceDate) {
  const n = daysBetween(today, raceDate);
  if (n < 0) return null;
  if (n === 0) return 'Hoy es tu carrera';
  if (n === 1) return 'Mañana es tu carrera';
  if (n < 14) return `Faltan ${n} días`;
  const w = Math.floor(n / 7);
  return `Faltan ${w} semanas`;
}

/** Intro del coach para un día de entreno en una semana del bloque. */
export function goalIntro(gw, weekLine = '') {
  if (!gw) return '';
  const race = `${gw.label} del ${raceDateText(gw.raceDate)}`;
  if (gw.stage === 'build') {
    const left = gw.k === 1 ? 'queda una semana' : `quedan ${gw.k} semanas`;
    const lead = gw.isLastBuild ? `Semana clave camino a tu ${race}: la última de carga antes de afinar.` : `Camino a tu ${race}: ${left}.`;
    return `${lead} ${weekLine}`.trim();
  }
  if (gw.stage === 'taper') return `Menos volumen y algo de ritmo de carrera para llegar con las piernas frescas a tu ${race}.`;
  if (gw.stage === 'race') return `Sesiones cortas y suaves, con algún cambio de ritmo para despertar las piernas. La víspera, descanso: llegas fresco a tu ${gw.label}.`;
  return 'Rodajes suaves para asimilar el esfuerzo de la carrera. Disfruta de lo conseguido: la semana que viene retomamos tu temporada.';
}

/* ───────────── Ritmo, previsión y estado para pantallas ───────────── */

/** «4:58» */
export const paceText = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, '0')}`;

/** «50:00» / «1:45:00» → segundos (o null). Acepta «50», «50:30», «1:45», «1:45:00» y «1h45». */
export function parseGoalTime(text, distanceKey = '10k') {
  const s = String(text ?? '').trim().replace(/\s+/g, '').replace(/[hH]/, ':').replace(/[′'´]/g, ':').replace(/[″"]/g, '').replace(/[.,]/g, ':');
  if (!s) return null;
  if (!/^\d{1,3}(:\d{1,2}){0,2}:?$/.test(s)) return null;
  const parts = s.replace(/:$/, '').split(':').map(Number);
  const d = goalDistance(distanceKey) || goalDistance('10k');
  let sec;
  if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) {
    // «1:45» en la media y en el 15K es h:mm; en 5K/10K, mm:ss
    sec = (d.key === '21k' || d.key === '15k') && parts[0] <= 4 ? parts[0] * 3600 + parts[1] * 60 : parts[0] * 60 + parts[1];
  } else sec = (d.key === '21k' || d.key === '15k') && parts[0] <= 4 ? parts[0] * 3600 : parts[0] * 60;
  if (parts.slice(1).some((p) => p > 59)) return null;
  return sec >= d.minSec && sec <= d.maxSec ? sec : null;
}

/** «50:00» · «1:45:00» */
export function fmtGoalTime(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Marca prevista hoy para la distancia ({ fastSec, slowSec, paceSec } o null), con js/training/race-predict.js. */
export function predictedFor(distanceKey, levels) {
  const vam = Number(vamFromLevels(levels || {})) || 0;
  const r = predictRaces(vam).find((x) => x.key === distanceKey);
  return r ? { fastSec: r.fastSec, slowSec: r.slowSec, paceSec: r.paceSec, vam } : null;
}

/** Comparación del objetivo con la previsión: { level: 'ok'|'warn', text } o null sin tiempo objetivo. */
export function goalVerdict(targetSec, predicted) {
  if (!targetSec || !predicted) return null;
  if (targetSec >= predicted.slowSec) return { level: 'ok', text: 'Tu previsión ya cumple el objetivo' };
  if (targetSec >= predicted.fastSec) return { level: 'ok', text: 'Objetivo realista: dentro de tu previsión' };
  const gap = predicted.fastSec - targetSec;
  const gapText = gap < 60 ? `${gap} s` : paceText(gap);
  return gap / targetSec <= 0.04
    ? { level: 'warn', text: `Ambicioso: tu mejor previsión está a ${gapText}` }
    : { level: 'warn', text: `Muy exigente: tu mejor previsión está a ${gapText}` };
}

/**
 * Todo lo que pintan Hoy y Mi plan. null sin objetivo o si la carrera pasó hace más de `keepDays` días.
 * { goal, dist, raceDate, dateText, daysLeft, countdown, title, targetSec, paceSec, speedKmh, predicted, verdict, week, block }
 */
export function goalStatus(state, today, { keepDays = 6 } = {}) {
  const g = goalOf(state);
  if (!g || !isKey(today)) return null;
  const dist = goalDistance(g.distance);
  const daysLeft = daysBetween(today, g.date);
  if (daysLeft < -keepDays) return null;
  const planStart = isKey(state?.plan?.startDate) ? mondayOf(state.plan.startDate) : null;
  const paceSec = g.targetSec ? Math.round(g.targetSec / dist.km) : null;
  const predicted = predictedFor(g.distance, state?.levels);
  return {
    goal: g,
    dist,
    raceDate: g.date,
    dateText: raceDateText(g.date),
    daysLeft,
    countdown: countdownText(today, g.date),
    title: `${dist.label} del ${raceDateText(g.date)}`,
    targetSec: g.targetSec,
    paceSec,
    speedKmh: paceSec ? Math.round((3600 / paceSec) * 10) / 10 : null,
    predicted,
    verdict: goalVerdict(g.targetSec, predicted),
    week: goalWeekInfo(g, mondayOf(today), planStart),
    block: goalBlock(g, planStart),
  };
}

/** Rango de fechas válido para el selector: de mañana a 52 semanas. */
export function goalDateRange(today) {
  return { min: addDays(today, 1), max: addDays(today, 364) };
}

/** Objetivo nuevo listo para guardar (o null si los datos no valen). */
export function makeGoal({ distance, date, targetSec = null, where = 'calle' }, today) {
  const g = normalizeGoal({ distance, date, targetSec, setOn: today, where });
  if (!g || !isKey(today)) return null;
  const { min, max } = goalDateRange(today);
  return g.date >= min && g.date <= max ? g : null;
}

/* ───────────── Mutadores (sobre el borrador de setState) ───────────── */

/**
 * Guarda el objetivo. Si solo cambia el tiempo objetivo se conserva `setOn` (el bloque no se mueve); si cambia la
 * distancia o la fecha, el bloque vuelve a contar desde hoy (nunca reescribe semanas pasadas).
 */
export function setGoal(draft, { distance, date, targetSec = null, where = 'calle' }, today) {
  if (!draft.plan || typeof draft.plan !== 'object') draft.plan = { startDate: null, overrides: {} };
  const prev = normalizeGoal(draft.plan.goal);
  const next = makeGoal({ distance, date, targetSec, where }, today);
  if (!next) return false;
  if (prev && prev.distance === next.distance && prev.date === next.date && prev.setOn) next.setOn = prev.setOn;
  draft.plan.goal = next;
  return true;
}

export function clearGoal(draft) {
  if (draft.plan && typeof draft.plan === 'object') draft.plan.goal = null;
}
