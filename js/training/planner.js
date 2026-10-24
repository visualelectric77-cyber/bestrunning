// BestRunning · planificador de temporada (sin DOM).
// Temporada de 52 semanas desde plan.startDate: 13 mesociclos de 4 semanas (3 de carga progresiva + 1 de descarga
// al ~65 %), fases Base → Construcción → Específico → Picos y retos → Transición, un tema por mesociclo, test VAM
// cada 6 semanas y eventos por fecha (Navidad, Verano, Aniversario) que sustituyen a la «sorpresa» semanal.
// Cada semana se elige con una búsqueda pequeña sobre candidatos puntuados (tema, novedad, fase) con reglas duras:
// duración del horario, sin repetir plantilla en 21 días (entre semana) / 42 (jueves y finde), nunca la misma
// familia dos sesiones seguidas, sin días duros consecutivos, carga semanal ≤ +10 % (salvo tras descarga), descarga
// ≤ 70 % y 75-80 % del tiempo suave. Solo usa los campos de contrato de la plantilla (family, themes, intensity,
// category y duraciones). Es determinista por semana (semilla) y se adapta a sesiones perdidas y sensaciones.
// Con objetivo de carrera (state.plan.goal, js/training/goal.js), las últimas semanas antes de la carrera siguen su
// propio bloque: construcción con ritmo de carrera, puesta a punto, semana de carrera (día marcado) y recuperación.
import { clamp, todayKey, addDays, weekdayOf, mondayOf, daysBetween, weekDates, hashStr, makeRng, roundTo } from '../core/utils.js';
import { TEMPLATES, getTemplate, templatesFor } from './templates.js';
import { buildWorkout } from './generator.js';
import { DEFAULT_LEVELS } from './levels.js';
import {
  SEASON_WEEKS, MESO_WEEKS, isTestWeekIndex, phaseOfMeso, themeOfMeso, eventOn, templateMeta,
} from './season.js';
import { goalOf, goalSig, goalWeekInfo, goalLongMinutes, goalIntro, goalDistance, GOAL_STAGES } from './goal.js';

export const CYCLE_WEEKS = ['Arranque', 'Progresión', 'Pico', 'Descarga'];
const WEEK_LF = [0.97, 1.0, 1.04, 0.8];
const WEEK_LINES = ['Semana de arranque del bloque: entramos con buenas sensaciones.', 'Semana de progresión: un pelín más de carga.',
  'Semana pico: la más exigente del bloque.', 'Semana de descarga: menos volumen para asimilar el trabajo.'];
const TEST_ID = 'test-vam';
export const WINDOW_SHORT = 21;
export const WINDOW_LONG = 42;
const DELOAD_RATIO = 0.58;  // objetivo de carga de la descarga frente a la semana anterior
const DELOAD_MAX = 0.64;    // tope blando de la descarga
const DELOAD_HARD = 0.67;   // tope duro (el contrato pide ≤ 70 %; margen por niveles reales)
const GROWTH_MAX = 1.05;    // tope blando de crecimiento semanal
const GROWTH_HARD = 1.07;   // tope duro (el contrato pide ≤ +10 %)
const EASY_BAND = [0.75, 0.81];
const EASY_HARD_BAND = [0.71, 0.84];
const DELOAD_EASY_BAND = [0.8, 0.95];
const DELOAD_EASY_HARD_BAND = [0.71, 1.01];
const K_CANDS = 3;
const round2 = (v) => Math.round(v * 100) / 100;
const isKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
const RANK = { easy: 0, moderate: 1, hard: 2 };
const ROLE_INT = { E: 'easy', M: 'moderate', H: 'hard', T: 'hard' };
const ROLE_NAME = { E: 'easy', M: 'moderate', H: 'hard', T: 'test' };
const KEY_THU = ['resistencia', 'progresivo', 'tempo', 'umbral', 'series-largas'];
const KEY_WE = ['reto', 'piramide', 'escalera', 'fartlek', 'musica', 'cuestas', 'resistencia'];

// Papel de cada día (1-5 = lunes-viernes, we = día largo del finde) por semana del mesociclo
const PATTERNS = {
  1: { 1: 'M', 2: 'E', 3: 'E', 4: 'H', 5: 'E', we: 'M' },
  2: { 1: 'H', 2: 'E', 3: 'M', 4: 'M', 5: 'E', we: 'H' },
  3: { 1: 'H', 2: 'E', 3: 'M', 4: 'H', 5: 'E', we: 'M' },
  4: { 1: 'E', 2: 'M', 3: 'E', 4: 'M', 5: 'E', we: 'M' },
};

/* Reloj inyectable (solo tests/simulaciones): «hoy» para contar sesiones perdidas. */
let CLOCK = null;
export function setPlannerToday(key) {
  CLOCK = isKey(key) ? key : null;
}
const nowKey = () => CLOCK || todayKey();

const posInt = (v, d) => (Number(v) > 0 ? Math.round(Number(v)) : d);

function sched(state) {
  const s = state?.schedule || {};
  return {
    weekdayMinutes: posInt(s.weekdayMinutes, 20),
    thursdayMinutes: posInt(s.thursdayMinutes, 50),
    weekendDay: Number(s.weekendDay) === 7 ? 7 : 6,
    weekendMinutes: posInt(s.weekendMinutes, 50),
  };
}

const hasIncline = (state) => !!state?.treadmill?.hasIncline;
const startMonday = (state) => mondayOf(isKey(state?.plan?.startDate) ? state.plan.startDate : todayKey());

/* Objetivo con fecha de carrera (js/training/goal.js): semana del bloque específico o null. Sin objetivo, siempre null
   y el plan es exactamente el de siempre. */
const GOAL_LF = 1.03;                                       // factor de carga del bloque específico (como la fase Específico)
const GOAL_STAGE_LF = { taper: 0.85, race: 0.8, recovery: 0.8 };
function goalWeek(state, mondayKey) {
  const g = goalOf(state);
  return g ? goalWeekInfo(g, mondayKey, startMonday(state)) : null;
}

function allows(t, minutes) {
  if (!t) return false;
  return minutes >= Math.min(...t.durations) && minutes <= Math.max(...t.durations);
}

/** Recorta unos minutos al rango que admite la plantilla. */
function fitMinutes(t, minutes) {
  if (!t) return minutes;
  return clamp(minutes, Math.min(...t.durations), Math.max(...t.durations));
}

/* ───────────── Calendario de temporada ───────────── */

function calendar(state, dateKey, adj) {
  const key = isKey(dateKey) ? dateKey : todayKey();
  const weeks = Math.floor(daysBetween(startMonday(state), mondayOf(key)) / 7);
  const weekInCycle = (((weeks % MESO_WEEKS) + MESO_WEEKS) % MESO_WEEKS) + 1;
  const cycleIndex = Math.max(0, Math.floor(weeks / MESO_WEEKS));
  const seasonIndex = Math.floor(cycleIndex / 13);
  const mesoIndex = cycleIndex % 13;
  const phase = phaseOfMeso(mesoIndex);
  const theme = themeOfMeso(cycleIndex);
  const isTestWeek = isTestWeekIndex(weeks);
  const nominal = WEEK_LF[weekInCycle - 1] * phase.lf * (1 + Math.min(seasonIndex, 3) * 0.02);
  const out = {
    cycleIndex, weekInCycle, isDeload: weekInCycle === 4, weeksSinceStart: weeks,
    weekName: CYCLE_WEEKS[weekInCycle - 1] + (isTestWeek ? ' + Test' : ''),
    loadFactor: round2(clamp(nominal * (1 + adj), 0.5, 1.4)),
    nominalLoad: round2(nominal),
    seasonIndex, seasonWeek: (((weeks % SEASON_WEEKS) + SEASON_WEEKS) % SEASON_WEEKS) + 1,
    mesoIndex, mesoNumber: mesoIndex + 1,
    phase: { key: phase.key, name: phase.name }, theme: { key: theme.key, name: theme.name }, isTestWeek,
  };
  // Bloque específico del objetivo: su propio ciclo (pico justo antes de afinar), sin test al afinar ni en carrera
  const gw = goalWeek(state, mondayOf(key));
  if (!gw) {
    // Tras la semana de recuperación se vuelve a la temporada con una semana de arranque (ni pico ni otra descarga)
    const g = goalOf(state);
    if (g && weekInCycle !== 1 && daysBetween(mondayOf(g.date), mondayOf(key)) === 14 && mondayOf(key) > startMonday(state)) {
      const n = WEEK_LF[0] * phase.lf * (1 + Math.min(seasonIndex, 3) * 0.02);
      return { ...out, weekInCycle: 1, isDeload: false, weekName: CYCLE_WEEKS[0] + (isTestWeek ? ' + Test' : ''),
        loadFactor: round2(clamp(n * (1 + adj), 0.5, 1.4)), nominalLoad: round2(n) };
    }
    return out;
  }
  const wic = gw.weekInCycle;
  const test = gw.stage === 'build' && isTestWeek;
  const gNominal = gw.stage === 'build' ? WEEK_LF[wic - 1] * GOAL_LF * (1 + Math.min(seasonIndex, 3) * 0.02) : GOAL_STAGE_LF[gw.stage];
  return {
    ...out, weekInCycle: wic, isDeload: wic === 4, isTestWeek: test,
    weekName: (gw.stage === 'build' ? CYCLE_WEEKS[wic - 1] : GOAL_STAGES[gw.stage]) + (test ? ' + Test' : ''),
    loadFactor: round2(clamp(gNominal * (1 + adj), 0.5, 1.4)),
    nominalLoad: round2(gNominal),
    goal: gw,
  };
}

/** Semana del plan: ciclo de 4 semanas + temporada (fase, tema, test). Campos antiguos intactos. */
export function cycleInfo(state, dateKey = todayKey()) {
  const adj = clamp(Number(state?.progression?.loadAdjust) || 0, -0.15, 0.15);
  return calendar(state, dateKey, adj);
}

/** Resumen de temporada para pantallas: fase, tema, intro de Eva, test y evento de la semana de `dateKey`. */
export function seasonInfo(state, dateKey = todayKey()) {
  const key = isKey(dateKey) ? dateKey : todayKey();
  const info = cycleInfo(state, key);
  const week = info.weeksSinceStart >= 0 ? weekPicks(state, info.weeksSinceStart) : null;
  const phase = phaseOfMeso(info.mesoIndex);
  const theme = themeOfMeso(info.cycleIndex);
  const days = week ? Object.values(week.days) : [];
  const ev = days.find((d) => d.event);
  const test = days.find((d) => d.role === 'T');
  const seasonStart = addDays(startMonday(state), Math.max(0, info.seasonIndex) * SEASON_WEEKS * 7);
  const weeksToTest = (() => {
    for (let i = 0; i < 6; i++) {
      if (info.goal || goalOf(state) ? cycleInfo(state, addDays(mondayOf(key), i * 7)).isTestWeek : isTestWeekIndex(info.weeksSinceStart + i)) return i;
    }
    return null;
  })();
  return {
    ...info,
    seasonStart,
    seasonEnd: addDays(seasonStart, SEASON_WEEKS * 7 - 1),
    mesoStart: addDays(startMonday(state), info.cycleIndex * MESO_WEEKS * 7),
    themeIntro: theme.intro,
    phaseLine: phase.line,
    weekLine: WEEK_LINES[info.weekInCycle - 1],
    intro: `${theme.intro} ${WEEK_LINES[info.weekInCycle - 1]}`,
    adapt: week ? { mode: week.adapt.mode, missed: week.adapt.missed } : { mode: 'normal', missed: 0 },
    event: ev ? { key: ev.event.key, name: ev.event.name, date: ev.date } : null,
    surpriseDate: days.find((d) => d.surprise)?.date || null,
    testDate: test ? test.date : null,
    weeksToTest,
    plannedLoad: week ? Math.round(week.load) : null,
  };
}

/** Mesociclos de la temporada actual (para dibujar el calendario anual). */
export function seasonCalendar(state, dateKey = todayKey()) {
  const info = cycleInfo(state, dateKey);
  const first = Math.max(0, info.seasonIndex) * 13;
  return Array.from({ length: 13 }, (_, i) => {
    const c = first + i;
    const p = phaseOfMeso(c % 13);
    const t = themeOfMeso(c);
    const start = addDays(startMonday(state), c * MESO_WEEKS * 7);
    return { cycleIndex: c, mesoNumber: i + 1, start, end: addDays(start, MESO_WEEKS * 7 - 1), phase: { key: p.key, name: p.name },
      theme: { key: t.key, name: t.name }, current: c === info.cycleIndex };
  });
}

/* ───────────── Candidatos y carga estimada ───────────── */

const ELIG = new Map();
function eligible(minutes, incline) {
  const k = `${minutes}|${incline ? 1 : 0}|${TEMPLATES.length}`;
  let list = ELIG.get(k);
  if (!list) {
    list = TEMPLATES.filter((t) => t.category !== 'test' && templateMeta(t).family !== 'test' && allows(t, minutes) && (!t.requiresIncline || incline));
    if (ELIG.size > 64) ELIG.clear();
    ELIG.set(k, list);
  }
  return list;
}

const EST = new Map();
const EASY_ZONES = ['jog', 'walk', 'warmup', 'cooldown'];
/** Carga y tiempo suave de una clase (niveles de serie: la carga ponderada por zona apenas depende de ellos). */
function estimate(id, minutes, seed, lf, incline) {
  const k = `${id}|${minutes}|${seed}|${lf}|${incline ? 1 : 0}`;
  let e = EST.get(k);
  if (!e) {
    const w = buildWorkout(id, { minutes, seed, loadFactor: lf, levels: DEFAULT_LEVELS, hasIncline: incline });
    e = w ? { load: w.load, easy: EASY_ZONES.reduce((a, z) => a + (w.timeInZone[z] || 0), 0), total: w.totalSec }
      : { load: minutes, easy: minutes * 60, total: minutes * 60 };
    if (EST.size > 30000) EST.clear();
    EST.set(k, e);
  }
  return e;
}

/* ───────────── Adaptación (historial anterior al lunes de la semana) ───────────── */

function historyIndex(state) {
  const done = new Set();
  const feel = [];
  let first = null;
  for (const s of Array.isArray(state?.history) ? state.history : []) {
    if (!s || typeof s !== 'object') continue;
    const d = isKey(s.planDate) ? s.planDate : isKey(s.dayKey) ? s.dayKey : null;
    if (!d) continue;
    if (countsAsSession(s)) {
      done.add(d);
      if (!first || d < first) first = d;
      if (s.feeling) feel.push({ d, f: s.feeling });
    }
  }
  feel.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const doneSorted = [...done].sort();
  return { done, feel, first, doneSorted };
}

function adaptFor(hx, prev, monday, today) {
  const none = { mode: 'normal', missed: 0, sig: 'n' };
  if (!prev || !hx.first || hx.first >= monday) return none;
  let missed = 0;
  for (const d of Object.values(prev.days)) {
    if (d.kind === 'rest' || !d.templateId) continue;
    if (d.date < today && d.date >= hx.first && !hx.done.has(d.date)) missed++;
  }
  const until = monday < today ? monday : today;
  let lastDone = null;
  for (const d of hx.doneSorted) { if (d < until) lastDone = d; else break; }
  const gap = lastDone ? daysBetween(lastDone, until) : 0;
  const recent = hx.feel.filter((x) => x.d < monday).slice(-3);
  const hardN = recent.filter((x) => x.f === 'max' || x.f === 'fail').length;
  const easyN = recent.filter((x) => x.f === 'easy').length;
  const mode = gap >= 10 || missed >= 4 ? 'return'
    : recent.length >= 2 && hardN >= 2 ? 'tired'
      : recent.length >= 2 && easyN >= 2 ? 'fresh' : 'normal';
  return { mode, missed, sig: `${mode}|${missed >= 2 ? 1 : 0}` };
}

/* ───────────── Una semana ───────────── */

const isHard = (r) => r === 'H' || r === 'T';

function rolesFor(info, sch, adapt, prevWeek, monday) {
  const gw = info.goal || null;
  const pat = { ...PATTERNS[info.weekInCycle] };
  // Con objetivo, el jueves es siempre la sesión de ritmo de carrera y el finde la tirada larga (sin intercambios)
  if (!gw && info.weekInCycle === 3 && info.cycleIndex % 2 === 1) [pat[4], pat.we] = [pat.we, pat[4]];
  if (!gw && info.phase.key === 'picos' && info.weekInCycle === 3) { pat.we = 'H'; pat[4] = 'M'; }
  // Semana pico antes de afinar: el finde es el ensayo de carrera (duro) y el jueves, ritmo controlado
  if (gw && gw.isLastBuild && info.weekInCycle === 3) { pat.we = 'H'; pat[4] = 'M'; }
  const roles = {};
  for (let w = 1; w <= 7; w++) {
    if (w === 4) roles[w] = pat[4];
    else if (w === sch.weekendDay) roles[w] = pat.we;
    else if (w <= 5) roles[w] = pat[w];
    else roles[w] = null;
  }
  const demoteAll = (info.phase.key === 'transicion' && !gw) || adapt.mode === 'return';
  for (let w = 1; w <= 7; w++) {
    if (roles[w] !== 'H') continue;
    if (demoteAll) roles[w] = 'M';
    else if (adapt.mode === 'tired' && w !== 4 && w !== sch.weekendDay) roles[w] = 'M';
  }
  if (adapt.mode === 'tired' && roles[4] === 'H' && roles[sch.weekendDay] === 'H') roles[sch.weekendDay] = 'M';
  // Semana de test: el test VAM es la sesión clave del jueves (piernas frescas: miércoles y viernes suaves)
  let testDay = null;
  if (info.isTestWeek) {
    testDay = 4;
    roles[4] = 'T';
    roles[3] = 'E';
    roles[5] = 'E';
    if (info.isDeload) for (const w of [1, 2]) roles[w] = 'E';
  }
  // Semana de carrera y de recuperación: todo suave, descanso la víspera y el día siguiente a la carrera; en la de
  // carrera, un único recordatorio de ritmo 3-5 días antes (el día de la carrera lo marca computeWeek)
  if (gw && (gw.stage === 'race' || gw.stage === 'recovery')) {
    const dd = (w) => daysBetween(gw.raceDate, addDays(monday, w - 1));
    for (let w = 1; w <= 7; w++) {
      if (!roles[w]) continue;
      roles[w] = dd(w) === 0 || dd(w) === -1 || dd(w) === 1 ? null : 'E';
    }
    if (gw.stage === 'race') {
      const q = [-3, -4, -5, -2].map((x) => [1, 2, 3, 4, 5, 6, 7].find((w) => dd(w) === x && roles[w])).find(Boolean);
      if (q) roles[q] = 'M';
    }
  }
  // Nunca dos días duros seguidos (también domingo → lunes)
  const prevLast = prevWeek ? prevWeek.days[7]?.role : null;
  for (let w = 1; w <= 7; w++) {
    const before = w === 1 ? prevLast : roles[w - 1];
    if (!isHard(roles[w]) || !isHard(before)) continue;
    const short = (d) => d !== 4 && d !== sch.weekendDay;
    if (roles[w] !== 'T' && short(w)) roles[w] = 'M';
    else if (w > 1 && roles[w - 1] !== 'T' && short(w - 1)) roles[w - 1] = 'M';
    else if (roles[w] !== 'T') roles[w] = 'M';
  }
  return { roles, testDay };
}

function minutesFor(w, info, sch) {
  const long = w === 4 || w === sch.weekendDay;
  let base = w === 4 ? sch.thursdayMinutes : w === sch.weekendDay ? sch.weekendMinutes : sch.weekdayMinutes;
  const gw = info.goal;
  if (gw) {
    // Construcción: la tirada del finde crece hacia la distancia · Afinar: largos al 80 % (1.ª de dos) o 60 % ·
    // Carrera: largos a la mitad y cortos como siempre · Recuperación: como una descarga
    if (gw.stage === 'build' && w === sch.weekendDay) base = goalLongMinutes(gw, base);
    if (gw.stage === 'taper') {
      if (!long) return base;
      const f = gw.taperWeeks === 2 && gw.taperIndex === 0 ? 0.8 : 0.6;
      return Math.max(30, Math.min(base, roundTo(base * f, 5)));
    }
    if (gw.stage === 'race') return long ? Math.max(20, Math.min(base, roundTo(base * 0.5, 5))) : base;
  }
  if (!info.isDeload) return base;
  // descarga: largos al 60 % (al 50 % si además hay test: la semana más ligera del bloque)
  if (long) return info.isTestWeek ? Math.max(25, Math.min(base, roundTo(base * 0.5, 5))) : Math.max(30, Math.min(base, roundTo(base * 0.6, 5)));
  return base >= 30 ? Math.max(20, roundTo(base * 0.8, 5)) : base;
}

function computeWeek(state, W, cache, adapt) {
  const sch = sched(state);
  const incline = hasIncline(state);
  const monday = addDays(startMonday(state), W * 7);
  const info = calendar(state, monday, 0);
  const phase = phaseOfMeso(info.mesoIndex);
  const theme = themeOfMeso(info.cycleIndex);
  const prev = W > 0 ? cache[W - 1] : null;
  const gw = info.goal || null;
  const { roles, testDay } = rolesFor(info, sch, adapt, prev, monday);
  const lf = info.nominalLoad;
  const rng = makeRng(hashStr(`season|${monday}|${adapt.sig}`));

  // Historial de uso planificado (ventanas, novedad y familias)
  const lastUse = new Map();
  const famLast = new Map();
  let prevFamily = null;
  for (let i = Math.max(0, W - 30); i < W; i++) {
    const wk = cache[i];
    if (!wk) continue;
    for (let d = 1; d <= 7; d++) {
      const x = wk.days[d];
      if (!x.templateId) continue;
      lastUse.set(x.templateId, x.date);
      famLast.set(x.family, x.date);
      prevFamily = x.family;
    }
  }

  // Días de la semana, sorpresa y eventos
  const days = {};
  const train = [];
  for (let w = 1; w <= 7; w++) {
    const date = addDays(monday, w - 1);
    const role = roles[w];
    if (gw && gw.stage === 'race' && date === gw.raceDate) {
      days[w] = { date, slot: 'race', kind: 'rest', role: null, minutes: 0, templateId: null, family: null, surprise: false, event: null, race: true };
      continue;
    }
    if (!role) {
      days[w] = { date, slot: 'rest', kind: 'rest', role: null, minutes: 0, templateId: null, family: null, surprise: false, event: null };
      continue;
    }
    const minutes = role === 'T' ? Math.min(sch.weekdayMinutes, 30) : minutesFor(w, info, sch);
    const long = role !== 'T' && (w === 4 || w === sch.weekendDay);
    days[w] = { date, w, role, minutes, long, kind: role === 'T' ? 'test' : long ? 'long' : 'short', surprise: false, event: null };
    train.push(days[w]);
  }
  const surpriseDay = gw && gw.stage !== 'build' ? null
    : [3, 5, 2, 1].map((w) => days[w]).find((d) => d && d.role && d.role !== 'T' && d.role !== 'H') || null;
  let eventDay = null;
  for (let w = 1; w <= 7 && !eventDay; w++) {
    const ev = eventOn(addDays(monday, w - 1));
    if (!ev || !ev.single) continue;
    // en su día; si ese día es descanso o test, el día de entreno más cercano (la víspera primero)
    const near = [w, w - 1, w + 1, w - 2, w + 2].map((x) => days[x]).find((d) => d && d.role && d.role !== 'T');
    eventDay = near || surpriseDay;
    if (eventDay) eventDay.event = ev;
  }
  if (!eventDay && surpriseDay) {
    const ev = eventOn(surpriseDay.date);
    if (ev && !ev.single) { surpriseDay.event = ev; eventDay = surpriseDay; }
  }
  if (!eventDay && surpriseDay) surpriseDay.surprise = true;

  // Objetivo de carga
  const totalMin = train.reduce((a, d) => a + d.minutes, 0);
  const prevLoad = prev ? prev.load : null;
  const growth = 1 + Math.min(info.seasonIndex, 3) * 0.02;
  // La 1.ª de dos semanas de puesta a punto recorta menos (≈ 75 %); el resto de descargas, como siempre
  const firstTaper = gw && gw.stage === 'taper' && gw.taperWeeks === 2 && gw.taperIndex === 0;
  const dRatio = firstTaper ? 0.75 : DELOAD_RATIO;
  const [dMax, dHard] = firstTaper ? [0.81, 0.84] : [DELOAD_MAX, DELOAD_HARD];
  let target = info.isDeload
    ? (prevLoad ? prevLoad * dRatio : totalMin * 0.92)
    : totalMin * phase.lpm[info.weekInCycle - 1] * growth;
  if (adapt.mode === 'tired') target *= 0.88;
  else if (adapt.mode === 'return') target *= 0.82;
  else if (adapt.mode === 'fresh') target *= 1.04;
  // Topes: blando (margen interno) y duro (el contrato: +10 % / 70 %). La descarga (y una vuelta o fatiga encadenadas)
  // se mide frente a la última semana de carga normal si la anterior ya fue aligerada: no se recorta dos veces.
  let cap = null;
  let capHard = null;
  let ref = prevLoad;
  if (prev && (info.isDeload || adapt.mode === 'return' || adapt.mode === 'tired') && (prev.adapt.mode === 'return' || prev.adapt.mode === 'tired')) {
    for (let i = W - 2; i >= Math.max(0, W - 4); i--) {
      const x = cache[i];
      if (x && !x.info.isDeload && x.adapt.mode !== 'return' && x.adapt.mode !== 'tired') { ref = Math.max(ref, x.load); break; }
    }
  }
  if (prev && !prev.info.isDeload) {
    // vuelta tras parón: por debajo de lo que se perdió · fatiga: sin subir · sesiones perdidas: no se acumulan
    const [soft, hard] = info.isDeload ? [dMax, dHard]
      : adapt.mode === 'return' ? [0.92, 0.98]
        : adapt.mode === 'tired' ? [0.95, 1.0]
          : adapt.missed >= 2 ? [1.0, 1.03] : [GROWTH_MAX, GROWTH_HARD];
    cap = ref * soft;
    capHard = ref * hard;
    if (!info.isDeload) { cap = Math.min(cap, prevLoad * GROWTH_MAX); capHard = Math.min(capHard, prevLoad * GROWTH_HARD); }
    if (info.isDeload) target = Math.min(target, ref * dRatio);
  }
  if (cap && !info.isDeload) target = Math.min(target, cap * 0.98);

  const solve = () => {
    // Reparto del objetivo por día según su papel (para puntuar candidatos por carga y tiempo suave)
    const LPM = { E: 0.92, M: 1.25, H: 1.6, T: 2.2 };
    const SHARE = { E: 0.95, M: 0.78, H: 0.62, T: 0.5 };
    const kTarget = target / Math.max(1, train.reduce((a, d) => a + LPM[d.role] * d.minutes, 0));
    // Objetivo: ritmo de carrera en las sesiones de calidad, tirada larga de fondo y ensayo de carrera en la semana pico
    const gd = gw && gw.stage !== 'recovery' ? goalDistance(gw.distance) : null;
    const simDay = gd && gw.isLastBuild && !info.isDeload ? sch.weekendDay : null;
    const recovering = gw && gw.stage === 'recovery';

    // Candidatos por día
    const pools = [];
    const cands = train.map((d, di) => {
      const seed = hashStr(d.date);
      pools[di] = [];
      if (d.role === 'T') {
        const e = estimate(TEST_ID, d.minutes, seed, lf, incline);
        return [{ id: TEST_ID, family: 'test', score: 0, ...e }];
      }
      const want = ROLE_INT[d.role];
      const win = d.long ? WINDOW_LONG : WINDOW_SHORT;
      const scored = [];
      for (const t of eligible(d.minutes, incline)) {
        // Clases de evento (campo opcional `event`): solo en su evento, y allí con prioridad
        if (t.event && t.event !== d.event?.key) continue;
        const m = templateMeta(t);
        const lu = lastUse.get(t.id);
        const since = lu ? daysBetween(lu, d.date) : null;
        let s = since == null ? 7 : Math.min(since, 140) / 20;
        if (since != null && since < win) s -= 24 + (win - since) * 0.3;
        const dI = Math.abs(RANK[m.intensity] - RANK[want]);
        s -= dI === 1 ? 3.5 : dI === 2 ? 9 : 0;
        const themeHit = m.themes.includes(theme.key);
        const famHit = theme.families.includes(m.family);
        const fl = famLast.get(m.family);
        const famFresh = !fl || daysBetween(fl, d.date) > 14;
        if (d.event) {
          if (t.event === d.event.key) s += 14;
          else if (d.event.families.includes(m.family) || m.themes.some((x) => d.event.themes.includes(x))) s += 4;
        } else if (d.surprise) {
          s += themeHit || famHit ? -3 : 1.5;
          if (famFresh) s += 2.5;
        } else {
          if (themeHit) s += 3;
          if (famHit) s += 2;
          if (theme.key === 'mixto' && famFresh) s += 1.5;
        }
        if (phase.families.includes(m.family)) s += 1;
        if (d.w === 4 && KEY_THU.includes(m.family)) s += 2;
        if (d.w === sch.weekendDay && KEY_WE.includes(m.family)) s += 1;
        if (d.w === sch.weekendDay && phase.key === 'picos' && d.role === 'H' && m.family === 'reto') s += 3;
        if (gd) {
          if (d.role !== 'E' && (d.w === 4 || gw.stage !== 'build') && gd.thu.includes(m.family)) s += gw.stage === 'build' ? 3 : 5;
          if (d.long && d.w === sch.weekendDay && gw.stage === 'build' && gd.long.includes(m.family)) s += 2.5;
          if (d.w === simDay && gd.sim.includes(t.id)) s += 9;
        }
        if (recovering && m.intensity === 'easy') s += 2;
        const cn = estimate(t.id, d.minutes, 1, 1, incline);
        const dayTarget = kTarget * LPM[d.role] * d.minutes;
        s -= 6 * Math.min(1.5, Math.abs(cn.load - dayTarget) / dayTarget);
        s -= 10 * Math.abs(cn.easy / Math.max(1, cn.total) - SHARE[d.role]);
      // las clases más ligeras (caminar, técnica) se guardan para las descargas
      if (cn.load / d.minutes < 0.85) s += info.isDeload ? 1.5 : -3;
        s += rng.next() * 0.8;
        const winOk = since == null || since >= win;
      scored.push({ t, m, s, cn, winOk, ok: winOk && dI <= 1 });
      }
      scored.sort((a, b) => b.s - a.s);
      pools[di] = scored;
      const out = [];
      const perFam = new Map();
      const add = (x) => out.push({ id: x.t.id, family: x.m.family, score: x.s, win: x.winOk, ...estimate(x.t.id, d.minutes, seed, lf, incline) });
      for (const x of scored) {
        if (out.length >= K_CANDS) break;
        const n = perFam.get(x.m.family) || 0;
        if (n >= 2) continue;
        perFam.set(x.m.family, n + 1);
        add(x);
      }
      // Reservas ligeras (para poder cumplir los topes de carga y de tiempo suave sin romper las ventanas)
      const valid = scored.filter((x) => x.ok && !out.some((o) => o.id === x.t.id));
      const light = valid.slice().sort((a, b) => a.cn.load - b.cn.load)[0];
      if (light) add(light);
      const soft = valid.filter((x) => x !== light).sort((a, b) => b.cn.easy / b.cn.total - a.cn.easy / a.cn.total)[0];
      if (soft) add(soft);
      // Último recurso si el catálogo es pequeño: la más ligera aunque repita dentro de la ventana (la seguridad manda)
      const lightest = scored.filter((x) => !out.some((o) => o.id === x.t.id)).sort((a, b) => a.cn.load - b.cn.load)[0];
      if (lightest && (!light || lightest.cn.load < light.cn.load * 0.9)) add(lightest);
      if (!out.length) out.push({ id: 'aerobic-base', family: 'resistencia', score: -50, ...estimate('aerobic-base', d.minutes, seed, lf, incline) });
      return out;
    });

    // Búsqueda de la mejor combinación de la semana
    const band = info.isDeload ? DELOAD_EASY_BAND : EASY_BAND;
    const hardBand = info.isDeload ? DELOAD_EASY_HARD_BAND : EASY_HARD_BAND;
    let best = null;
    const chosen = [];
    const rec = (i, score, load, easy, total) => {
      if (i === train.length) {
        let obj = score - 25 * (Math.abs(load - target) / Math.max(1, target));
        if (capHard && load > capHard) obj -= 200 + 800 * (load / capHard - 1);
        else if (cap && load > cap) obj -= 6 + 250 * (load / cap - 1);
        const share = total ? easy / total : 1;
        if (share < band[0]) obj -= 120 * (band[0] - share);
        else if (share > band[1]) obj -= 120 * (share - band[1]);
        if (share < hardBand[0] || share > hardBand[1]) obj -= 30 + 300 * Math.max(hardBand[0] - share, share - hardBand[1]);
        if (!best || obj > best.obj) best = { obj, picks: chosen.slice(), load };
        return;
      }
      const before = i ? chosen[i - 1].family : prevFamily;
      for (const c of cands[i]) {
        if (chosen.some((p) => p.id === c.id)) continue;
        let s = c.score;
        if (c.family === before) s -= 20;
        for (const p of chosen) if (p.family === c.family) s -= 2.5;
        chosen.push(c);
        rec(i + 1, score + s, load + c.load, easy + c.easy, total + c.total);
        chosen.pop();
      }
    };
    rec(0, 0, 0, 0, 0);
    if (!best) best = { picks: cands.map((c) => c[0]), load: cands.reduce((a, c) => a + c[0].load, 0) };

    // Reparación: si el catálogo no da para cumplir el tope de carga, cambia la sesión que más baja por menos puntos
    const picks = best.picks.slice();
    const sumLoad = () => picks.reduce((a, p) => a + p.load, 0);
    const sumEasy = () => picks.reduce((a, p) => a + p.easy, 0);
    const sumTotal = () => picks.reduce((a, p) => a + p.total, 0);
    for (let it = 0; it < 12 && cap && sumLoad() > cap; it++) {
      const strict = sumLoad() <= capHard; // entre el tope blando y el duro: solo cambios que respetan ventanas
      let swap = null;
      train.forEach((d, i) => {
        if (d.role === 'T') return;
        const cur = picks[i];
        const seed = hashStr(d.date);
        for (const x of pools[i]) {
          if (x.cn.load >= cur.load * 0.97 || picks.some((p) => p.id === x.t.id) || (strict && !x.ok)) continue;
          const fb = i ? picks[i - 1].family : prevFamily;
          const fa = picks[i + 1]?.family;
          const famPen = x.m.family === fb || x.m.family === fa ? 20 : 0;
          if (strict && famPen) continue;
          const e = estimate(x.t.id, d.minutes, seed, lf, incline);
          const gain = cur.load - e.load;
          if (gain <= 0) continue;
          const share = (sumEasy() - cur.easy + e.easy) / Math.max(1, sumTotal() - cur.total + e.total);
          const cost = (cur.score - x.s + famPen + (share > hardBand[1] ? 20 : 0)) / gain;
          if (!swap || cost < swap.cost) swap = { i, cost, pick: { id: x.t.id, family: x.m.family, score: x.s, win: x.winOk, ...e } };
        }
      });
      if (!swap) break;
      picks[swap.i] = swap.pick;
    }
    best.picks = picks;
    best.viol = picks.filter((p) => p.win === false).length;
    return best;
  };
  // Descarga sin hueco en el catálogo: antes que repetir plantilla, acorta un poco los largos (mín. 20′)
  let best = solve();
  for (let k = 0; k < 3 && info.isDeload && best.viol > 0; k++) {
    const longs = train.filter((d) => d.long && d.minutes > 20);
    if (!longs.length) break;
    for (const d of longs) d.minutes -= 5;
    const b2 = solve();
    if (b2.viol < best.viol) best = b2;
    else { for (const d of longs) d.minutes += 5; break; }
  }

  let load = 0;
  let easy = 0;
  let total = 0;
  train.forEach((d, i) => {
    const p = best.picks[i];
    d.templateId = p.id;
    d.family = p.family;
    d.estLoad = p.load;
    d.slot = d.role === 'T' ? 'test' : d.event ? 'event' : d.surprise ? 'surprise' : d.long ? 'key' : d.role === 'E' ? 'easy' : 'quality';
    load += p.load;
    easy += p.easy;
    total += p.total;
  });
  return { W, monday, info, days, load, easy, total, target, cap, adapt, sig: adapt.sig, testDay };
}

/* Memo de semanas calculadas: la cadena empieza en la semana 0 del plan (novedad, ventanas y carga dependen de las
   semanas anteriores). Una semana se recalcula solo si cambia su adaptación (historial antes de su lunes). */
const MEMO = new Map();

function settingsKey(state) {
  const s = sched(state);
  const g = goalSig(state?.plan?.goal);
  return [startMonday(state), s.weekdayMinutes, s.thursdayMinutes, s.weekendDay, s.weekendMinutes, hasIncline(state) ? 1 : 0, TEMPLATES.length].join('|') + (g ? `|${g}` : '');
}

function weekPicks(state, W) {
  if (W < 0) return computeWeek(state, W, [], { mode: 'normal', missed: 0, sig: 'n' });
  const key = settingsKey(state);
  let cache = MEMO.get(key);
  if (!cache) {
    if (MEMO.size > 12) MEMO.clear();
    cache = [];
    MEMO.set(key, cache);
  }
  const hx = historyIndex(state);
  const today = nowKey();
  const start = startMonday(state);
  for (let w = 0; w <= W; w++) {
    const adapt = adaptFor(hx, w ? cache[w - 1] : null, addDays(start, w * 7), today);
    if (cache[w] && cache[w].sig === adapt.sig) continue;
    cache.length = w;
    cache[w] = computeWeek(state, w, cache, adapt);
  }
  return cache[W];
}

/** Semanas planificadas por defecto (sin overrides) para tests e informes. */
export function seasonWeek(state, W) {
  return weekPicks(state, W);
}

function introFor(info, day, adapt) {
  if (!day || day.kind === 'rest') return '';
  const theme = themeOfMeso(info.cycleIndex);
  const phase = phaseOfMeso(info.mesoIndex);
  if (day.event) return day.event.intro;
  if (day.role === 'T') return `Semana ${info.seasonWeek} de la temporada: test VAM. Medimos tu forma para recalcular tus cuatro velocidades.`;
  const parts = [];
  if (info.goal) {
    parts.push(day.surprise ? 'Sorpresa de la semana: hoy salimos un poco del guion, sin perder de vista tu carrera.'
      : goalIntro(info.goal, info.goal.stage === 'build' ? WEEK_LINES[info.weekInCycle - 1] : ''));
    if (adapt?.mode === 'tired') parts.push('Vienes de sesiones muy duras: esta semana aflojamos un poco.');
    else if (adapt?.mode === 'return') parts.push('Volvemos con calma: nada de recuperar lo perdido de golpe.');
    return parts.join(' ');
  }
  if (day.surprise) parts.push(`Sorpresa de la semana: hoy salimos del guion del bloque «${theme.name}».`);
  else if (day.w === 1 || (info.isTestWeek && day.w === 2)) parts.push(`${phase.line} ${theme.intro}`);
  else parts.push(`Bloque «${theme.name}» · ${phase.name}.`);
  parts.push(WEEK_LINES[info.weekInCycle - 1]);
  if (adapt?.mode === 'tired') parts.push('Vienes de sesiones muy duras: esta semana aflojamos un poco.');
  else if (adapt?.mode === 'return') parts.push('Volvemos con calma: nada de recuperar lo perdido de golpe.');
  else if (adapt?.missed >= 2) parts.push('Lo que se quedó sin hacer la semana pasada no se acumula: seguimos sin subir carga.');
  return parts.join(' ');
}

/* Plantilla de reserva para una duración distinta (override de minutos o «quitar descanso»). */
function fallbackPick(state, dateKey, minutes, { family = null, intensity = 'easy', exclude = null } = {}) {
  const incline = hasIncline(state);
  const list = eligible(minutes, incline).filter((t) => t.id !== exclude && !t.event);
  if (!list.length) return 'aerobic-base';
  const h = hashStr(`fit|${dateKey}`);
  const score = (t) => {
    const m = templateMeta(t);
    return (family && m.family === family ? 4 : 0) + (m.intensity === intensity ? 2 : 0) - Math.abs(RANK[m.intensity] - RANK[intensity]);
  };
  return list.map((t, i) => ({ t, s: score(t), k: (h + i * 2654435761) % 1000 })).sort((a, b) => b.s - a.s || a.k - b.k)[0].t.id;
}

/* ───────────── Resolución de un día ───────────── */

/** Lo que toca un día sin construir la clase: plan por defecto + override. */
function resolveDay(state, dateKey, { ignoreOverride = false } = {}) {
  const info = cycleInfo(state, dateKey);
  const w = weekdayOf(dateKey);
  const sch = sched(state);
  const week = weekPicks(state, info.weeksSinceStart);
  const def = week.days[w];
  let { slot, kind, minutes, templateId } = def;
  let seed = hashStr(dateKey);
  let isOverride = false;
  const ov = ignoreOverride ? null : state?.plan?.overrides?.[dateKey];
  if (ov && typeof ov === 'object' && Object.keys(ov).length) {
    isOverride = true;
    const t = ov.templateId ? getTemplate(ov.templateId) : null;
    if (ov.rest === true) {
      slot = 'rest'; kind = 'rest'; minutes = 0; templateId = null;
    } else {
      if (t) { templateId = t.id; slot = 'custom'; }
      if (def.kind === 'rest' && !t) {
        // "Quitar descanso" sin clase concreta: una sesión suave
        minutes = sch.weekdayMinutes;
        templateId = fallbackPick(state, dateKey, minutes, { intensity: 'easy' });
        slot = 'easy';
      }
      if (Number(ov.minutes) > 0) minutes = Math.round(Number(ov.minutes));
      else if (def.kind === 'rest') minutes = fitMinutes(getTemplate(templateId), sch.weekdayMinutes);
      if (Number.isFinite(Number(ov.seed)) && ov.seed !== null && ov.seed !== '') seed = Math.floor(Math.abs(Number(ov.seed))) % 4294967296;
      const recalc = Number(ov.minutes) > 0 || def.kind === 'rest' || def.kind === 'test';
      kind = templateId === TEST_ID ? 'test' : recalc ? (minutes >= 40 ? 'long' : 'short') : def.kind;
    }
  }
  // Si cambió la duración del día y la plantilla por defecto no la admite, busca otra parecida
  if (templateId && templateId !== TEST_ID && !ov?.templateId && !allows(getTemplate(templateId), minutes)) {
    const m = templateMeta(getTemplate(templateId));
    templateId = fallbackPick(state, dateKey, minutes, { family: m.family, intensity: m.intensity });
  }
  const g = def.race && !isOverride ? goalOf(state) : null;
  const race = g ? { distance: g.distance, label: goalDistance(g.distance).label, km: goalDistance(g.distance).km, date: g.date, targetSec: g.targetSec } : null;
  return {
    date: dateKey, weekday: w, kind, slot, templateId, minutes, seed, isOverride, info, race,
    role: kind === 'rest' ? null : def.role ? ROLE_NAME[def.role] : 'easy',
    surprise: !isOverride && !!def.surprise,
    event: !isOverride && def.event ? { key: def.event.key, name: def.event.name } : null,
    intro: kind === 'rest' ? '' : isOverride && !def.role ? '' : introFor(info, def, week.adapt),
  };
}

/**
 * Regla única de «cuenta como sesión» (logros, rachas, semana, día hecho y textos de fin):
 * ≥ 60 % completada; o ≥ 10 min y ≥ 40 %; o la clase llegó a su final con ≥ 5 min corridos.
 * Un test cuenta si dio resultado y duró ≥ 5 min.
 */
export function countsAsSession(s) {
  if (!s || typeof s !== 'object') return false;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const pct = n(s.completionPct);
  const sec = n(s.elapsedSec);
  if (s.isTest) return n(s.test?.vam) > 0 && sec >= 300;
  if (pct >= 0.6) return true;
  if (sec >= 600 && pct >= 0.4) return true;
  if (sec >= 300) {
    if (typeof s.finishedEarly === 'boolean') return !s.finishedEarly;
    const tr = Array.isArray(s.speedTrace) ? s.speedTrace : [];
    const last = tr.length ? n(tr[tr.length - 1]?.[0]) : 0;
    const planned = n(s.plannedSec);
    return planned > 0 && last >= planned - 15;
  }
  return false;
}

const isDone = countsAsSession;

/** Sesión del historial que cumple ese día (planDate, o dayKey si no estaba asignada a otro día). */
function sessionFor(history, dateKey) {
  const list = Array.isArray(history) ? history : [];
  let c = list.filter((s) => s && s.planDate === dateKey);
  if (!c.length) c = list.filter((s) => s && s.dayKey === dateKey && (!s.planDate || s.planDate === dateKey));
  if (!c.length) return null;
  return c.reduce((best, s) => {
    const a = (isDone(best) ? 2 : 0) + (Number(best.completionPct) || 0);
    const b = (isDone(s) ? 2 : 0) + (Number(s.completionPct) || 0);
    return b >= a ? s : best;
  });
}

function buildFor(state, r) {
  if (!r.templateId) return null;
  return buildWorkout(r.templateId, {
    minutes: r.minutes,
    levels: state?.levels,
    seed: r.seed,
    loadFactor: r.info.loadFactor,
    hasIncline: hasIncline(state),
    treadmill: state?.treadmill,
    weightKg: Number(state?.profile?.weightKg) || 78,
    weekInCycle: r.info.weekInCycle,
    cycleIndex: r.info.cycleIndex,
  });
}

export function planDay(state, dateKey, now = new Date()) {
  const key = isKey(dateKey) ? dateKey : todayKey(now);
  const r = resolveDay(state, key);
  const workout = buildFor(state, r);
  if (workout && r.intro) workout.intro = r.intro;
  const session = sessionFor(state?.history, key);
  const today = todayKey(now);
  const status = isDone(session) ? 'done'
    : r.kind === 'rest' ? 'rest'
      : key === today ? 'today'
        : key < today ? 'missed' : 'upcoming';
  return {
    date: key,
    weekday: r.weekday,
    kind: r.kind,
    slot: r.slot,
    templateId: r.templateId,
    minutes: r.minutes,
    workout,
    status,
    session: session || null,
    isOverride: r.isOverride,
    role: r.role,
    surprise: r.surprise,
    event: r.event,
    intro: r.intro,
    ...(r.race ? { race: r.race } : {}),
    season: {
      phase: r.info.phase, theme: r.info.theme, mesoNumber: r.info.mesoNumber, weekInMeso: r.info.weekInCycle,
      seasonWeek: r.info.seasonWeek, isTestWeek: r.info.isTestWeek,
    },
  };
}

export function planWeek(state, mondayKey, now = new Date()) {
  const monday = mondayOf(isKey(mondayKey) ? mondayKey : todayKey(now));
  return weekDates(monday).map((d) => planDay(state, d, now));
}

export function todayPlan(state, now = new Date()) {
  return planDay(state, todayKey(now), now);
}

/** Otras clases para ese día (misma duración), con la misma semilla y carga que usará el plan al elegirlas. */
export function alternativesFor(state, dateKey, n = 6) {
  const r = resolveDay(state, dateKey);
  const sch = sched(state);
  const incline = hasIncline(state);
  const minutes = r.kind === 'rest' || !r.minutes ? sch.weekdayMinutes : r.minutes;
  // Las clases de evento (Navidad, Verano, Aniversario) solo se ofrecen en sus fechas
  const ev = eventOn(dateKey)?.key || null;
  const inSeason = (t) => !t.event || t.event === ev;
  let cands = templatesFor({ minutes, hasIncline: incline }).filter((t) => t.id !== r.templateId && t.category !== 'test' && inSeason(t));
  if (!cands.length) cands = TEMPLATES.filter((t) => t.category !== 'test' && t.id !== r.templateId && (!t.requiresIncline || incline) && inSeason(t));
  const rng = makeRng(hashStr(`alt|${dateKey}`));
  const byCat = new Map();
  for (const t of rng.shuffle(cands)) {
    if (!byCat.has(t.category)) byCat.set(t.category, []);
    byCat.get(t.category).push(t);
  }
  const cur = getTemplate(r.templateId)?.category;
  const pref = r.kind === 'rest' ? ['recovery', 'endurance', 'fartlek'] : [cur];
  const picked = [];
  for (const c of pref) {
    const list = byCat.get(c) || [];
    while (list.length && picked.length < (r.kind === 'rest' ? 3 : 2)) picked.push(list.shift());
  }
  const cats = rng.shuffle([...byCat.keys()]);
  while (picked.length < n && cats.some((c) => byCat.get(c).length)) {
    for (const c of cats) {
      const list = byCat.get(c);
      if (list.length && picked.length < n) picked.push(list.shift());
    }
  }
  const seed = hashStr(dateKey);
  return picked.slice(0, n)
    .map((t) => buildFor(state, { ...r, templateId: t.id, minutes: fitMinutes(t, minutes), seed }))
    .filter(Boolean);
}

/* ───────────── Mutadores (sobre el borrador de setState) ───────────── */

function overridesOf(draft) {
  if (!draft.plan || typeof draft.plan !== 'object') draft.plan = { startDate: null, overrides: {} };
  if (!draft.plan.overrides || typeof draft.plan.overrides !== 'object') draft.plan.overrides = {};
  return draft.plan.overrides;
}

/** Quita el override si deja el día exactamente como el plan por defecto. */
function tidy(draft, dateKey) {
  const ovs = overridesOf(draft);
  if (!ovs[dateKey]) return;
  const a = resolveDay(draft, dateKey);
  const b = resolveDay(draft, dateKey, { ignoreOverride: true });
  if (a.kind === b.kind && a.templateId === b.templateId && a.minutes === b.minutes && (a.kind === 'rest' || a.seed === b.seed)) delete ovs[dateKey];
}

/** Intercambia lo que toca en dos días (la clase viaja intacta, con su semilla). */
export function swapDays(draft, dateA, dateB) {
  if (!isKey(dateA) || !isKey(dateB) || dateA === dateB) return;
  const a = resolveDay(draft, dateA);
  const b = resolveDay(draft, dateB);
  const as = (r) => (r.kind === 'rest' || !r.templateId ? { rest: true } : { templateId: r.templateId, minutes: r.minutes, seed: r.seed });
  const ovs = overridesOf(draft);
  ovs[dateA] = as(b);
  ovs[dateB] = as(a);
  tidy(draft, dateA);
  tidy(draft, dateB);
}

export function setDayOverride(draft, dateKey, { templateId, minutes, rest } = {}) {
  if (!isKey(dateKey)) return;
  const ovs = overridesOf(draft);
  if (rest === true) {
    ovs[dateKey] = { rest: true };
    return;
  }
  const cur = { ...(ovs[dateKey] || {}) };
  if (rest === false) {
    delete cur.rest;
    if (resolveDay(draft, dateKey, { ignoreOverride: true }).kind === 'rest' && !templateId && !cur.templateId) cur.rest = false;
  }
  if (templateId !== undefined) {
    if (templateId && getTemplate(templateId)) {
      if (cur.templateId !== templateId) delete cur.seed;
      cur.templateId = templateId;
    } else {
      delete cur.templateId;
      delete cur.seed;
    }
    if (cur.rest === true) delete cur.rest;
  }
  if (minutes !== undefined) {
    if (Number(minutes) > 0) cur.minutes = Math.round(Number(minutes));
    else delete cur.minutes;
  }
  if (Object.keys(cur).length) {
    ovs[dateKey] = cur;
    tidy(draft, dateKey);
  } else delete ovs[dateKey];
}

export function clearDayOverride(draft, dateKey) {
  const ovs = overridesOf(draft);
  delete ovs[dateKey];
}

/** Próximo día con test VAM (desde `fromKey` incluido) que aún no se ha hecho. */
export function nextTestDate(state, fromKey = todayKey()) {
  const from = isKey(fromKey) ? fromKey : todayKey();
  for (let i = 0; i < 98; i++) {
    const d = addDays(from, i);
    if (resolveDay(state, d).templateId !== TEST_ID) continue;
    if (!isDone(sessionFor(state?.history, d))) return d;
  }
  // Más allá del horizonte (o con overrides): el jueves de la siguiente semana de test sin hacer
  const info = cycleInfo(state, from);
  for (let w = Math.max(0, info.weeksSinceStart); w < Math.max(0, info.weeksSinceStart) + 260; w++) {
    if (!isTestWeekIndex(w)) continue;
    const gwk = goalOf(state) ? goalWeek(state, addDays(startMonday(state), w * 7)) : null;
    if (gwk && gwk.stage !== 'build') continue; // al afinar, en la semana de carrera y al recuperar no hay test
    const d = addDays(startMonday(state), w * 7 + 3);
    if (d >= from && !isDone(sessionFor(state?.history, d))) return d;
  }
  return addDays(from, 42);
}
