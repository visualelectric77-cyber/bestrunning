// BestRunning · plan semanal y ciclos de 4 semanas (sin DOM).
// Estructura: L intervalos · M tempo · X suave (cuestas en semanas pares si hay inclinación) · J resistencia larga ·
// V fartlek/reto (test VAM en descarga) · finde: largo variado · otro día del finde: descanso.
// La rotación es determinista por (semana, día) y nunca repite plantilla en el mismo día de semanas consecutivas,
// ni dentro de la misma semana (así jueves y finde nunca coinciden).
import { clamp, todayKey, addDays, weekdayOf, mondayOf, daysBetween, weekDates, hashStr, makeRng } from '../core/utils.js';
import { TEMPLATES, getTemplate, templatesFor } from './templates.js';
import { buildWorkout } from './generator.js';

export const CYCLE_WEEKS = ['Base', 'Construcción', 'Pico', 'Descarga + Test'];
const WEEK_LOAD = [1.0, 1.08, 1.16, 0.72];
const TEST_ID = 'test-vam';
const round2 = (v) => Math.round(v * 100) / 100;
const isKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);

const POOLS = {
  intervals: ['pyramid', 'minute-on', 'sprint-30-60', 'ladder-up', 'over-under', 'golden-minutes', 'two-one', 'countdown', 'km-repeats'],
  tempo: ['cruise', 'sandwich', 'threshold-3x4', 'progressive', 'cruise-2x6', 'tempo-waves', 'fast-finish'],
  easy: ['easy-strides', 'recovery-jog', 'aerobic-base'],
  hills: ['hills-short', 'hill-long', 'rollercoaster', 'hill-sprints'],
  long: ['long-progressive', 'long-blocks', 'long-surges', 'negative-split', 'long-ladder', 'aerobic-base'],
  // semana pico: el finde trae un reto, así que el jueves es aeróbico y el viernes, juego suave
  longPeak: ['long-surges', 'aerobic-base', 'long-progressive', 'negative-split'],
  fartlekPeak: ['speed-play', 'fartlek-swedish', 'surprise'],
  fartlek: ['fartlek-swedish', 'speed-play', 'surprise', 'waves'],
  challenge: ['no-stop', 'sprint-finish', 'pyramid-xl'],
  weekendChallenge: ['challenge-10k', 'the-hour', 'pyramid-xl', 'sprint-finish', 'no-stop'],
  deloadMon: ['easy-strides', 'speed-play', 'minute-on', 'fartlek-swedish', 'waves'],
  deloadTue: ['cruise', 'aerobic-base', 'recovery-jog', 'tempo-waves'],
  deloadWed: ['recovery-jog', 'walk-jog', 'easy-strides'],
  deloadThu: ['aerobic-base', 'long-progressive', 'long-surges'],
  deloadWeekend: ['aerobic-base', 'long-surges', 'negative-split', 'waves', 'fartlek-swedish'],
  easyAny: ['recovery-jog', 'easy-strides', 'aerobic-base', 'walk-jog'],
};

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

function allows(t, minutes) {
  if (!t) return false;
  return minutes >= Math.min(...t.durations) && minutes <= Math.max(...t.durations);
}

/** Recorta unos minutos al rango que admite la plantilla. */
function fitMinutes(t, minutes) {
  if (!t) return minutes;
  return clamp(minutes, Math.min(...t.durations), Math.max(...t.durations));
}

export function cycleInfo(state, dateKey = todayKey()) {
  const key = isKey(dateKey) ? dateKey : todayKey();
  const weeks = Math.floor(daysBetween(startMonday(state), mondayOf(key)) / 7);
  const weekInCycle = (((weeks % 4) + 4) % 4) + 1;
  const cycleIndex = Math.max(0, Math.floor(weeks / 4));
  const adj = clamp(Number(state?.progression?.loadAdjust) || 0, -0.15, 0.15);
  const loadFactor = round2(WEEK_LOAD[weekInCycle - 1] * (1 + Math.min(cycleIndex, 6) * 0.03) + adj);
  return { cycleIndex, weekInCycle, weekName: CYCLE_WEEKS[weekInCycle - 1], isDeload: weekInCycle === 4, loadFactor, weeksSinceStart: weeks };
}

/* ───────────── Rotación ───────────── */

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** Plantilla para un índice de rotación: recorre todo el grupo antes de repetir (paso coprimo con su tamaño). */
function rotatePick(pool, rot, salt, blocked, soft = () => false) {
  const n = pool.length;
  if (!n) return null;
  const h = hashStr(salt);
  const steps = [];
  for (let s = 1; s < n; s++) if (gcd(s, n) === 1) steps.push(s);
  const step = steps.length ? steps[h % steps.length] : 0;
  const r = ((rot % n) + n) % n;
  const start = ((h >>> 8) % n + r * step) % n;
  // primero evita también lo "blando" (lo de hace dos semanas); si no hay forma, solo lo obligatorio
  for (const avoidSoft of [true, false]) {
    for (let i = 0; i < n; i++) {
      const id = pool[(start + i) % n];
      if (!blocked(id) && !(avoidSoft && soft(id))) return id;
    }
  }
  return pool[start];
}

/** Grupo filtrado por minutos e inclinación (con alternativas si queda vacío). */
function poolFor(name, minutes, incline) {
  const ok = (id) => {
    const t = getTemplate(id);
    return t && allows(t, minutes) && (!t.requiresIncline || incline);
  };
  let ids = (POOLS[name] || []).filter(ok);
  if (!ids.length) ids = templatesFor({ minutes, hasIncline: incline }).filter((t) => t.category !== 'test').map((t) => t.id);
  if (!ids.length) ids = ['aerobic-base'];
  return ids;
}

/** Hueco por defecto de un día de la semana. */
function slotOf(w, info, sch, incline) {
  const W = info.weeksSinceStart;
  const c = info.cycleIndex;
  const wk = info.weekInCycle;
  const short = (slot, pool, rot) => ({ slot, kind: 'short', minutes: sch.weekdayMinutes, pool, rot });
  if (w === 1) return info.isDeload ? short('easy', 'deloadMon', c) : short('intervals', 'intervals', W);
  if (w === 2) return info.isDeload ? short('easy', 'deloadTue', c) : short('tempo', 'tempo', W);
  if (w === 3) {
    if (info.isDeload) return short('easy', 'deloadWed', c);
    const hillsWeek = incline && ((W % 2) + 2) % 2 === 1; // semanas pares del plan (2.ª, 4.ª…)
    return hillsWeek ? short('hills', 'hills', Math.floor(W / 2)) : short('easy', 'easy', Math.floor(W / 2));
  }
  if (w === 4) {
    const pool = info.isDeload ? 'deloadThu' : wk === 3 ? 'longPeak' : 'long';
    return { slot: 'endurance', kind: 'long', minutes: sch.thursdayMinutes, pool, rot: info.isDeload ? c : W };
  }
  if (w === 5) {
    if (info.isDeload) return { slot: 'test', kind: 'test', minutes: sch.weekdayMinutes, fixed: TEST_ID };
    return wk === 2 ? short('challenge', 'challenge', c) : wk === 3 ? short('fartlek', 'fartlekPeak', c) : short('fartlek', 'fartlek', c);
  }
  if (w === sch.weekendDay) {
    const pool = ['long', 'fartlek', 'weekendChallenge', 'deloadWeekend'][wk - 1];
    return { slot: 'weekend', kind: 'long', minutes: sch.weekendMinutes, pool, rot: c };
  }
  return { slot: 'rest', kind: 'rest', minutes: 0 };
}

/* Memo de semanas calculadas (la cadena empieza en la semana 0 del plan para que la rotación sea estable). */
const MEMO = new Map();

function settingsKey(state) {
  const s = sched(state);
  return [startMonday(state), s.weekdayMinutes, s.thursdayMinutes, s.weekendDay, s.weekendMinutes, hasIncline(state) ? 1 : 0].join('|');
}

function computeWeek(state, W, prev, prev2 = null) {
  const sch = sched(state);
  const incline = hasIncline(state);
  const monday = addDays(startMonday(state), W * 7);
  const info = cycleInfo(state, monday);
  const used = new Set();
  const days = {};
  for (let w = 1; w <= 7; w++) {
    const slot = slotOf(w, info, sch, incline);
    const pos = w >= 6 ? 'we' : String(w);
    let templateId = null;
    if (slot.kind === 'test') templateId = slot.fixed;
    else if (slot.kind !== 'rest') {
      const pool = poolFor(slot.pool, slot.minutes, incline);
      templateId = rotatePick(pool, slot.rot, `${slot.pool}|${w >= 6 ? 'we' : w}`,
        (id) => used.has(id) || prev?.days?.[prev.posOf[pos]]?.templateId === id,
        (id) => prev2?.days?.[prev2.posOf[pos]]?.templateId === id);
    }
    if (templateId) used.add(templateId);
    days[w] = { slot: slot.slot, kind: slot.kind, minutes: slot.minutes, templateId, pool: slot.pool || null };
  }
  const posOf = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, we: sch.weekendDay };
  return { W, days, posOf };
}

function weekPicks(state, W) {
  if (W < 0) return computeWeek(state, W, null);
  const key = settingsKey(state);
  let cache = MEMO.get(key);
  if (!cache) {
    if (MEMO.size > 12) MEMO.clear();
    cache = [];
    MEMO.set(key, cache);
  }
  for (let w = cache.length; w <= W; w++) cache[w] = computeWeek(state, w, w ? cache[w - 1] : null, w > 1 ? cache[w - 2] : null);
  return cache[W];
}

/* ───────────── Resolución de un día ───────────── */

/** Lo que toca un día sin construir la clase: plan por defecto + override. */
function resolveDay(state, dateKey, { ignoreOverride = false } = {}) {
  const info = cycleInfo(state, dateKey);
  const w = weekdayOf(dateKey);
  const sch = sched(state);
  const incline = hasIncline(state);
  const def = weekPicks(state, info.weeksSinceStart).days[w];
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
        templateId = rotatePick(poolFor('easyAny', minutes, incline), daysBetween(startMonday(state), dateKey), 'unrest', () => false);
        slot = 'easy';
      }
      if (Number(ov.minutes) > 0) minutes = Math.round(Number(ov.minutes));
      else if (def.kind === 'rest') minutes = fitMinutes(getTemplate(templateId), sch.weekdayMinutes);
      if (Number.isFinite(Number(ov.seed)) && ov.seed !== null && ov.seed !== '') seed = Math.floor(Math.abs(Number(ov.seed))) % 4294967296;
      const recalc = Number(ov.minutes) > 0 || def.kind === 'rest' || def.kind === 'test';
      kind = templateId === TEST_ID ? 'test' : recalc ? (minutes >= 40 ? 'long' : 'short') : def.kind;
    }
  }
  // Si cambió la duración del día y la plantilla por defecto no la admite, busca otra del mismo grupo
  if (templateId && templateId !== TEST_ID && !ov?.templateId && !allows(getTemplate(templateId), minutes)) {
    const pool = poolFor(def.pool || 'easyAny', minutes, incline);
    templateId = rotatePick(pool, info.weeksSinceStart, `${def.pool}|fit`, () => false);
  }
  return { date: dateKey, weekday: w, kind, slot, templateId, minutes, seed, isOverride, info };
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
  let cands = templatesFor({ minutes, hasIncline: incline }).filter((t) => t.id !== r.templateId && t.category !== 'test');
  if (!cands.length) cands = TEMPLATES.filter((t) => t.category !== 'test' && t.id !== r.templateId && (!t.requiresIncline || incline));
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
  for (let i = 0; i < 84; i++) {
    const d = addDays(from, i);
    if (resolveDay(state, d).templateId !== TEST_ID) continue;
    if (!isDone(sessionFor(state?.history, d))) return d;
  }
  // Sin test en el horizonte (overrides): viernes de la próxima semana de descarga
  const info = cycleInfo(state, from);
  const weeks = info.isDeload ? 4 : 4 - info.weekInCycle;
  return addDays(mondayOf(from), weeks * 7 + 4);
}
