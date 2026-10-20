// BestRunning · progresión automática de velocidades, test VAM y análisis del coach (sin DOM).
// applyFeedback NO muta el estado: devuelve niveles, cambios y progresión nuevos para que el llamador los guarde.
// Con pulso del Apple Watch (SPEC §12): a la misma velocidad, ≥ 4 ppm menos que la media de las 3 sesiones
// anteriores comparables cuenta como «muy fácil» para ese nivel; > 92 % de la FC máx. sostenido en tramos de
// correr bloquea las subidas de esa sesión.
import { clamp, todayKey, addDays, daysBetween, weekdayOf, hashStr, makeRng, fmt, parseKey, DAY_MS } from '../core/utils.js';
import {
  ZONES, LEVEL_KEYS, DEFAULT_LEVELS, enforceLevelOrder, levelsFromVam, vamFromLevels, estimateVo2max, vo2Category,
  hrMaxFromAge,
} from './levels.js';
import { cycleInfo, nextTestDate, seasonInfo } from './planner.js';
import { streakWeeks, weekProgress, totals, sessionDay, sessionCounts } from './stats.js';
import { hrAtLevels, hasHrSeries } from '../integrations/watch-hr.js';

export const FEELINGS = [
  { key: 'easy', label: 'Muy fácil', emoji: '😌', rpe: 3 },
  { key: 'ok', label: 'Cómodo', emoji: '🙂', rpe: 5 },
  { key: 'hard', label: 'Exigente', emoji: '😤', rpe: 7 },
  { key: 'max', label: 'Al límite', emoji: '🥵', rpe: 9 },
  { key: 'fail', label: 'No pude', emoji: '😵', rpe: 10 },
];

const STEP = 0.1;                 // subida/bajada estándar
const BUMP_GAP_DAYS = 6;          // máx. una subida por nivel cada 6 días
const CAP_WINDOW_DAYS = 28;       // ventana del tope de subida
const CAP_GAIN = 0.6;             // tope +0,6 km/h por nivel en 28 días
const OK_STREAK = 3;              // sesiones cómodas seguidas para subir
const LOAD_MIN = -0.15;
const LOAD_MAX = 0.15;
const TEST_STEP = 0.5;            // km/h por escalón del test
const TEST_MAX_DROP = 0.4;        // un mal día de test no hunde el plan
const TEST_MAX_RISE = 1.0;
const HR_DROP = 4;                // ppm menos a la misma velocidad ⇒ «muy fácil» para ese nivel
const HR_COMPARE_N = 3;           // sesiones anteriores comparables
const HR_SPEED_TOL = 0.15;        // km/h de margen para «misma velocidad»
const HR_LOOKBACK_DAYS = 60;      // las comparables, como mucho de hace 2 meses
const HR_MIN_LEVEL_SEC = 60;      // segundos con pulso en ese nivel para comparar
const HR_BLOCK_FRAC = 0.92;       // > 92 % de la FC máx. …
const HR_BLOCK_SEC = 60;          // … sostenido ≥ 60 s en tramos de correr ⇒ no subir
const HR_LONG_SEC = 35 * 60;      // sesiones largas y cortas no se comparan entre sí (deriva cardiaca)

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** Nombre de cada velocidad personal en las frases, con la misma etiqueta que la interfaz («Correr rápido»). */
const label = (k) => ZONES[k]?.name || k;
const noun = (k) => `velocidad «${label(k)}»`;

export function feelingToRpe(feeling) {
  const f = FEELINGS.find((x) => x.key === feeling);
  return f ? f.rpe : 5;
}

function normLevels(levels) {
  const out = {};
  for (const k of LEVEL_KEYS) {
    const v = Number(levels?.[k]);
    out[k] = Number.isFinite(v) && v > 0 ? r1(v) : DEFAULT_LEVELS[k];
  }
  return out;
}

function listJoin(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/**
 * Valor de referencia de un nivel al inicio de la ventana de 28 días: el último registro anterior a la ventana o,
 * si dentro de ella hubo un test o un cambio manual, el más reciente de esos (reinician la referencia).
 */
function capBaseline(levelHistory, k, windowStart, untilKey, fallback) {
  const hist = (Array.isArray(levelHistory) ? levelHistory : [])
    .filter((e) => e && typeof e.date === 'string' && Number.isFinite(Number(e.levels?.[k])))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!hist.length) return fallback;
  let base = null;
  for (const e of hist) if (e.date <= windowStart) base = Number(e.levels[k]);
  for (const e of hist) {
    if (e.date > windowStart && e.date <= untilKey && (e.reason === 'test' || e.reason === 'manual')) base = Number(e.levels[k]);
  }
  if (base == null) base = Number(hist.find((e) => e.date > windowStart)?.levels[k] ?? fallback);
  return base;
}

/* ───────────── Pulso por nivel ───────────── */

function sesTime(s) {
  const t = Date.parse(s?.startedAt || '');
  if (Number.isFinite(t)) return t;
  return s?.dayKey ? parseKey(s.dayKey).getTime() + DAY_MS / 2 : 0;
}
const lenClass = (s) => ((num(s?.plannedSec) || num(s?.elapsedSec)) >= HR_LONG_SEC ? 'long' : 'short');
const levelsOf = (st, s) => (s?.levelsAtStart && typeof s.levelsAtStart === 'object' ? s.levelsAtStart : st?.levels) || DEFAULT_LEVELS;

/**
 * Pulso medio de cada nivel en esta sesión frente a la media de las (hasta) 3 sesiones anteriores comparables:
 * misma velocidad (±0,15 km/h), misma duración aproximada (corta/larga), sin tests y de los últimos 60 días.
 * → { jog?: { avg, max, sec, speed, n, prevN, prevAvg, delta }, … }
 */
export function hrLevelTrends(state, session) {
  const st = state || {};
  if (!session || !hasHrSeries(session)) return {};
  const cur = hrAtLevels(session, { levels: levelsOf(st, session) });
  const t0 = sesTime(session);
  const prev = (Array.isArray(st.history) ? st.history : [])
    .filter((s) => s && typeof s === 'object' && s !== session && s.id !== session.id && !s.isTest && hasHrSeries(s)
      && sesTime(s) < t0 && t0 - sesTime(s) <= HR_LOOKBACK_DAYS * DAY_MS && lenClass(s) === lenClass(session))
    .sort((a, b) => sesTime(b) - sesTime(a));
  const out = {};
  for (const k of LEVEL_KEYS) {
    const c = cur[k];
    if (!c) continue;
    const comps = [];
    if (c.sec >= HR_MIN_LEVEL_SEC) {
      for (const s of prev) {
        const pk = hrAtLevels(s, { levels: levelsOf(st, s) })[k];
        if (pk && pk.sec >= HR_MIN_LEVEL_SEC && Math.abs(pk.speed - c.speed) <= HR_SPEED_TOL + 1e-9) comps.push(pk);
        if (comps.length >= HR_COMPARE_N) break;
      }
    }
    const prevAvg = comps.length ? comps.reduce((a, x) => a + x.avg, 0) / comps.length : null;
    out[k] = { ...c, prevN: comps.length, prevAvg: prevAvg == null ? null : r1(prevAvg), delta: prevAvg == null ? null : r1(c.avg - prevAvg) };
  }
  return out;
}

/** Reglas de pulso para applyFeedback: niveles «fáciles» por pulso y bloqueo por pulso muy alto corriendo. */
function hrRules(st, session, used) {
  const res = { easy: [], drops: {}, block: null };
  if (!hasHrSeries(session) || session.isTest) return res;
  const trends = hrLevelTrends(st, session);
  for (const k of used) {
    const t = trends[k];
    if (t && t.prevN >= HR_COMPARE_N && t.sec >= HR_MIN_LEVEL_SEC && t.delta <= -HR_DROP + 1e-9) {
      res.easy.push(k);
      res.drops[k] = t;
    }
  }
  const hrMax = num(st.profile?.hrMax) || hrMaxFromAge(num(st.profile?.age) || 46);
  const limit = hrMax * HR_BLOCK_FRAC;
  const run = hrAtLevels(session, { levels: levelsOf(st, session), above: limit }).run;
  if (run && (run.aboveLongest >= HR_BLOCK_SEC || (run.aboveSec >= HR_BLOCK_SEC && run.aboveSec >= run.sec * 0.25))) {
    res.block = { sec: run.aboveSec, longest: run.aboveLongest, limit: Math.round(limit), hrMax };
  }
  return res;
}

/** Aplica la sensación de una sesión a las velocidades. */
export function applyFeedback(state, session, { feeling, rpe } = {}) {
  const st = state || {};
  const levels0 = normLevels(st.levels);
  const prog0 = st.progression && typeof st.progression === 'object' ? st.progression : {};
  const p = {
    ...prog0,
    lastBump: { ...(prog0.lastBump || {}) },
    okStreak: { ...(prog0.okStreak || {}) },
    hardStreak: num(prog0.hardStreak),
    loadAdjust: clamp(num(prog0.loadAdjust), LOAD_MIN, LOAD_MAX),
    lastTest: prog0.lastTest ?? null,
    bestVam: prog0.bestVam ?? null,
  };
  if (!session || typeof session !== 'object') return { levels: levels0, changes: [], progression: p, message: '' };

  const date = sessionDay(session) || todayKey();
  const rng = makeRng(hashStr(`${session.id || date}|${feeling || ''}`));
  const fb = FEELINGS.some((f) => f.key === feeling) ? feeling : session.feeling;
  void rpe; // la RPE se guarda en la sesión; la regla se basa en la sensación

  /* ── Test VAM: recalcula los cuatro niveles ── */
  if (session.isTest) {
    const res = evaluateTest(session, st);
    if (!(res.vam > 0) || !res.levels) {
      return { levels: levels0, changes: [], progression: p, message: 'No hemos podido calcular tu VAM en este test. Repítelo cuando estés descansado.' };
    }
    const changes = LEVEL_KEYS.filter((k) => res.levels[k] !== levels0[k])
      .map((k) => ({ level: k, from: levels0[k], to: res.levels[k], reason: 'test' }));
    p.lastTest = { date, vam: res.vam };
    p.bestVam = Math.max(num(p.bestVam), res.vam);
    p.okStreak = {};
    p.hardStreak = 0;
    const delta = res.deltaVam ? ` (${res.deltaVam > 0 ? '+' : ''}${fmt.speed(res.deltaVam)} respecto a la referencia)` : '';
    return {
      levels: res.levels,
      changes,
      progression: p,
      message: `Tu VAM es ${fmt.speed(res.vam)} km/h${delta}. Hemos recalculado tus cuatro velocidades.`,
    };
  }

  /* ── Sesión normal ── */
  const used = LEVEL_KEYS.filter((k) => num(session.timeInZone?.[k]) >= 60);
  const top = used.length ? used[used.length - 1] : null;
  const pct = Number(session.completionPct);
  const incomplete = Number.isFinite(pct) && pct < 0.85;
  // «Incompleta» por saltar tramos (la clase llegó al final) ≠ terminar antes de tiempo.
  const reachedEnd = incomplete && sessionReachedEnd(session);
  const tough = fb === 'hard' || fb === 'max' || fb === 'fail';
  // Incompleta + «muy fácil»/«cómodo»: ni sube ni baja (neutral). Incompleta + dura: cuenta como no superada.
  const eff = !incomplete ? fb : reachedEnd ? fb === 'fail' ? 'fail' : tough ? fb : 'neutral' : tough ? 'fail' : 'neutral';
  const target = { ...levels0 };
  const reasons = {};
  const hr = hrRules(st, session, used);
  const held = [];                // niveles que el pulso no deja subir hoy
  const canBump = (k) => !p.lastBump[k] || daysBetween(p.lastBump[k], date) >= BUMP_GAP_DAYS;
  const raise = (k, amount, reason) => {
    if (hr.block) { if (!held.includes(k)) held.push(k); return; }
    if (r1(levels0[k] + amount) > target[k]) { target[k] = r1(levels0[k] + amount); reasons[k] = reason; }
  };
  const drop = (k, reason) => { target[k] = r1(levels0[k] - STEP); reasons[k] = reason; };
  const blocked = [];
  let streakInfo = null;

  if (eff === 'easy') {
    for (const k of used) {
      if (canBump(k)) raise(k, STEP, 'easy');
      else blocked.push(k);
      p.okStreak[k] = 0;
    }
    p.hardStreak = 0;
    if (!hr.block) p.loadAdjust += 0.02;
  } else if (eff === 'ok') {
    for (const k of used) {
      // Pulso muy alto corriendo: ni racha ni subida. Pulso más bajo a la misma velocidad: como «muy fácil».
      if (hr.block) { if (!held.includes(k)) held.push(k); continue; }
      if (hr.easy.includes(k)) {
        if (canBump(k)) raise(k, STEP, 'hr');
        else blocked.push(k);
        p.okStreak[k] = 0;
        continue;
      }
      p.okStreak[k] = num(p.okStreak[k]) + 1;
      if (p.okStreak[k] >= OK_STREAK) {
        if (canBump(k)) { raise(k, STEP, 'streak'); p.okStreak[k] = 0; } else blocked.push(k);
      }
    }
    const pending = used.filter((k) => p.okStreak[k] > 0 && p.okStreak[k] < OK_STREAK);
    if (pending.length) {
      const k = pending.reduce((a, b) => (p.okStreak[b] > p.okStreak[a] ? b : a));
      streakInfo = { k, n: p.okStreak[k] };
    }
    p.hardStreak = 0;
    // la carga vuelve hacia 0 con sesiones cómodas
    p.loadAdjust = p.loadAdjust > 0 ? Math.max(0, p.loadAdjust - 0.02) : Math.min(0, p.loadAdjust + 0.02);
  } else if (eff === 'hard') {
    for (const k of used) p.okStreak[k] = 0;
  } else if (eff === 'max') {
    for (const k of used) p.okStreak[k] = 0;
    p.hardStreak += 1;
    if (p.hardStreak >= 2 && top) { drop(top, 'fatigue'); p.loadAdjust -= 0.05; }
  } else if (eff === 'fail') {
    for (const k of used) p.okStreak[k] = 0;
    p.hardStreak += 1;
    if (top) drop(top, 'fail');
    p.loadAdjust -= 0.05;
  } else if (eff === 'neutral') {
    // Sesión a medias que no costó: mantenemos velocidades; si se cortó antes, aligeramos solo la carga
    for (const k of used) p.okStreak[k] = 0;
    if (!reachedEnd) p.loadAdjust -= 0.03;
  }

  // Ajustes manuales: si completó y subió ≥ 0,2 en un nivel, adoptamos la mitad
  if (session.completed && eff !== 'fail' && eff !== 'max') {
    for (const k of LEVEL_KEYS) {
      const adj = num(session.adjustments?.[k]);
      if (adj >= 0.2 - 1e-9) raise(k, Math.max(STEP, r1(adj / 2)), 'adjust');
    }
  }

  // Tope de +0,6 km/h por nivel en 28 días
  const windowStart = addDays(date, -CAP_WINDOW_DAYS);
  const capped = [];
  for (const k of LEVEL_KEYS) {
    if (target[k] <= levels0[k]) continue;
    const base = capBaseline(st.levelHistory, k, windowStart, date, num(session.levelsAtStart?.[k]) || levels0[k]);
    const maxAllowed = r1(base + CAP_GAIN);
    if (target[k] > maxAllowed) {
      target[k] = Math.max(levels0[k], maxAllowed);
      if (target[k] === levels0[k]) { delete reasons[k]; capped.push(k); }
    }
  }

  // Orden y límites de la cinta
  const maxSpeed = num(st.treadmill?.maxSpeed) || 20;
  let out = enforceLevelOrder(target);
  for (const k of LEVEL_KEYS) out[k] = r1(clamp(out[k], 3, maxSpeed));
  out = enforceLevelOrder(out);

  for (const k of LEVEL_KEYS) if (out[k] > levels0[k] && reasons[k]) p.lastBump[k] = date;
  p.loadAdjust = r2(clamp(p.loadAdjust, LOAD_MIN, LOAD_MAX));

  const changes = LEVEL_KEYS.filter((k) => out[k] !== levels0[k])
    .map((k) => ({ level: k, from: levels0[k], to: out[k], reason: reasons[k] || 'order' }));

  return {
    levels: out,
    changes,
    progression: p,
    message: feedbackMessage({ changes, eff, fb, incomplete, reachedEnd, blocked, capped, streakInfo, rng, hr, held }),
    hr: { easy: hr.easy.slice(), blocked: !!hr.block },
  };
}

/**
 * ¿La clase llegó a su final (aunque se saltaran tramos)? Usa session.finishedEarly si existe;
 * si no, el trazado de velocidad (en tiempo de clase) que llega al final planificado.
 */
export function sessionReachedEnd(session) {
  if (!session || typeof session !== 'object') return false;
  if (typeof session.finishedEarly === 'boolean') return !session.finishedEarly;
  const planned = num(session.plannedSec);
  const tr = Array.isArray(session.speedTrace) ? session.speedTrace : [];
  const last = tr.length ? num(tr[tr.length - 1]?.[0]) : 0;
  return planned > 0 && last >= planned - 15;
}

function feedbackMessage({ changes, eff, fb, incomplete, reachedEnd = false, blocked, capped, streakInfo, rng, hr = null, held = [] }) {
  const ups = changes.filter((c) => c.to > c.from && c.reason !== 'order');
  const downs = changes.filter((c) => c.to < c.from);
  const hrUp = ups.find((c) => c.reason === 'hr' && hr?.drops?.[c.level]);
  if (hrUp) {
    const t = hr.drops[hrUp.level];
    const others = ups.filter((c) => c !== hrUp);
    const more = others.length ? ` (y ${listJoin(others.map((c) => `tu ${noun(c.level)} a ${fmt.speed(c.to)}`))})` : '';
    return `¡A ${fmt.speed(t.speed)} km/h tu pulso ha bajado ${Math.round(-t.delta)} ppm respecto a tus últimas sesiones! Subimos tu ${noun(hrUp.level)} a ${fmt.speed(hrUp.to)} km/h${more}: tu corazón está listo.`;
  }
  if (ups.length) {
    const tail = ups.some((c) => c.reason === 'adjust')
      ? 'Tu ajuste en la cinta nos ha dado la pista.'
      : rng.pick(['Te lo has ganado.', 'Tu cuerpo está listo para más.', 'Así se progresa: poco a poco y sin parar.']);
    if (ups.length === 1) return `¡Subimos tu ${noun(ups[0].level)} a ${fmt.speed(ups[0].to)} km/h! ${tail}`;
    return `¡Suben tus velocidades ${listJoin(ups.map((c) => `«${label(c.level)}»`))}: ${ups.map((c) => fmt.speed(c.to)).join(' · ')} km/h! ${tail}`;
  }
  if (downs.length) {
    const c = downs[0];
    const why = incomplete && fb !== 'fail'
      ? reachedEnd ? 'Saltaste parte de la sesión y te costó, así que' : 'Terminaste antes de tiempo y te costó, así que'
      : eff === 'max' ? 'Dos sesiones seguidas al límite:' : 'Hoy ha costado:';
    return `${why} bajamos tu ${noun(c.level)} a ${fmt.speed(c.to)} km/h y aligeramos un poco la carga. Recuperar también es entrenar.`;
  }
  if (hr?.block && held.length) {
    const b = hr.block;
    const span = b.longest >= HR_BLOCK_SEC ? `${fmt.clock(b.longest)} seguidos` : `${fmt.clock(b.sec)} en total`;
    return `Tu pulso pasó del 92 % de tu FC máx. (${b.limit} ppm) durante ${span} en los tramos de correr. Mantenemos las velocidades hasta que el corazón se adapte.`;
  }
  if (capped.length) return 'Vas lanzado: este mes ya has subido mucho, así que consolidamos unos días antes de seguir.';
  if (blocked.length && (eff === 'easy' || eff === 'ok')) {
    return `¡Genial! Subiste tu ${noun(blocked[0])} hace muy poco: dejamos que el cuerpo lo asimile y seguimos en unos días.`;
  }
  switch (eff) {
    case 'neutral':
      return reachedEnd
        ? 'Saltaste parte de la sesión, así que hoy mantenemos tus velocidades. Completa la próxima entera y seguimos subiendo.'
        : 'Terminaste antes de tiempo: mantenemos tus velocidades y aligeramos un poco la próxima. ¡Sin prisa!';
    case 'easy': return 'Muy fácil, ¡estupendo! Hoy no había velocidades personales que subir, pero tomamos nota.';
    case 'ok':
      if (streakInfo) {
        const left = OK_STREAK - streakInfo.n;
        return `Sesión cómoda: ${left === 1 ? 'una más' : `${left} más`} así y subimos tu ${noun(streakInfo.k)}.`;
      }
      return 'Sesión cómoda y bien hecha. Seguimos sumando.';
    case 'hard': return rng.pick([
      'Exigente pero bien llevada. Mantenemos tus velocidades: así es como se progresa.',
      'Ha costado y lo has sacado. Mantenemos las velocidades para que lo consolides.',
    ]);
    case 'max': return 'Has llegado al límite. Mantenemos las velocidades; si se repite, aflojaremos un poco.';
    case 'fail': return 'Hoy no ha salido, y no pasa nada. Ajustamos la carga para que la próxima vaya mejor.';
    default: return '';
  }
}

/* ───────────── Test VAM ───────────── */

/** VAM a partir del trazado de velocidad (si la sesión no trae el campo test). */
function vamFromTrace(session) {
  const tr = Array.isArray(session?.speedTrace) ? session.speedTrace.filter((p) => Array.isArray(p) && p.length >= 2) : [];
  if (!tr.length) return 0;
  let iMax = 0;
  tr.forEach((p, i) => { if (Number(p[1]) > Number(tr[iMax][1])) iMax = i; });
  const top = Number(tr[iMax][1]);
  const t0 = Number(tr[iMax][0]);
  const t1 = iMax + 1 < tr.length ? Number(tr[iMax + 1][0]) : num(session.elapsedSec);
  const secs = clamp(t1 - t0, 0, 60);
  return secs >= 59 ? top : top - TEST_STEP + TEST_STEP * (secs / 60);
}

/**
 * Kuipers: VAM = velocidad del último escalón completo + 0,5 × (segundos en el escalón incompleto / 60).
 * session.test = { lastStageSpeed (último escalón COMPLETO), secondsInLastStage (en el siguiente), vam }.
 */
export function evaluateTest(session, state = null) {
  const t = session?.test || {};
  const last = num(t.lastStageSpeed);
  let vam = 0;
  if (last > 0) vam = last + TEST_STEP * (clamp(num(t.secondsInLastStage), 0, 60) / 60);
  else if (num(t.vam) > 0) vam = num(t.vam);
  else vam = vamFromTrace(session);
  vam = r1(vam);
  if (!(vam > 0)) return { vam: 0, levels: null, vo2max: null, deltaVam: null };

  const start = normLevels(session?.levelsAtStart || state?.levels);
  const raw = levelsFromVam(vam);
  const levels = {};
  for (const k of LEVEL_KEYS) levels[k] = r1(clamp(raw[k], start[k] - TEST_MAX_DROP, start[k] + TEST_MAX_RISE));
  const prev = num(state?.progression?.lastTest?.vam) || vamFromLevels(start);
  return { vam, levels: enforceLevelOrder(levels), vo2max: estimateVo2max(vam), deltaVam: r1(vam - prev) };
}

/* ───────────── Análisis del coach ───────────── */

/** Valor de un nivel hace `days` días según levelHistory (o null). */
function levelAt(levelHistory, k, key) {
  let v = null;
  for (const e of (Array.isArray(levelHistory) ? levelHistory : []).slice().sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (e?.date <= key && Number.isFinite(Number(e.levels?.[k]))) v = Number(e.levels[k]);
  }
  return v;
}

/**
 * Frase de análisis para Hoy/Progreso, basada en los datos (cambia cada día entre las más relevantes).
 * `skipWeek`: Progreso ya muestra «X de Y sesiones» en su tarjeta de semana justo encima; ahí no repetimos esa frase.
 */
export function coachInsight(state, now = new Date(), { skipWeek = false } = {}) {
  const st = state || {};
  const today = todayKey(now);
  const history = (Array.isArray(st.history) ? st.history : []).filter((s) => s && typeof s === 'object');
  const name = (st.profile?.name || '').trim().split(/\s+/)[0] || '';
  const hey = name ? `${name}, ` : '';
  const cand = [];
  const add = (prio, text) => cand.push({ prio, text });

  const info = cycleInfo(st, today);
  let testDay = null;
  try { testDay = nextTestDate(st, today); } catch { testDay = null; }
  const daysToTest = testDay ? daysBetween(today, testDay) : null;

  if (!history.length) {
    add(9, `${hey}tu primera clase te espera. Empieza suave: el plan se adapta a ti desde el primer día.`);
    const nativeApp = typeof window !== 'undefined' && !!window.webkit?.messageHandlers?.bestrunning;
    add(9, nativeApp
      ? 'Con RITMUP en tu Apple Watch, el reloj se conecta solo y te manda el pulso en directo.'
      : 'Antes de empezar, inicia «Cinta de correr» en tu Apple Watch: así tendrás el pulso de cada sesión.');
  }

  // Test y descarga
  if (daysToTest === 0) add(10, 'Hoy toca test VAM. Calienta bien, no te agarres a la barra y aguanta cada escalón hasta que no puedas más.');
  else if (daysToTest != null && daysToTest <= 6) {
    add(daysToTest <= 2 ? 8 : 7, `Test VAM el ${fmt.weekdayName(weekdayOf(testDay))}${daysToTest === 1 ? ' (mañana)' : ''}: llega descansado y con ganas, que vamos a medir lo que has mejorado.`);
  }
  // Temporada: mesociclo con tema, eventos y adaptación de la semana
  let season = null;
  try { season = seasonInfo(st, today); } catch { season = null; }
  const theme = season?.theme?.name || info.theme?.name || '';
  if (info.isDeload) {
    add(6, `Semana de descarga${info.isTestWeek ? ' con test VAM' : ''}: bajamos el volumen para que tu cuerpo asimile tres semanas de trabajo. Es aquí donde de verdad mejoras.`);
  } else if (info.weekInCycle === 3) {
    add(4, `Semana pico del bloque${theme ? ` «${theme}»` : ''}: la más exigente. Duerme bien y cuida la hidratación, que la semana que viene toca descargar.`);
  } else if (info.weekInCycle === 1 && season) {
    add(info.cycleIndex > 0 ? 5 : 4, `Empieza el mesociclo ${season.mesoNumber} de 13 (${season.phase.name}): «${theme}». ${season.themeIntro}`);
  }
  if (season?.event) add(6, `Esta semana hay especial de ${season.event.name}: una clase temática para celebrarlo corriendo.`);
  if (season?.adapt?.mode === 'return') add(8, 'Volvemos con calma: esta semana no hay sesiones duras ni intentamos recuperar lo perdido de golpe.');
  else if (season?.adapt?.mode === 'tired') add(7, 'Vienes de sesiones muy duras: esta semana el plan afloja un poco para que llegues fresco al bloque siguiente.');
  else if (season?.adapt?.missed >= 2) add(5, 'Lo que se quedó sin hacer la semana pasada no se acumula: esta semana mantenemos la carga, sin subirla.');
  if (season?.surpriseDate === today) add(6, `Hoy toca la sorpresa de la semana: una clase fuera del guion del bloque${theme ? ` «${theme}»` : ''}.`);

  // Constancia
  const counted = history.filter(sessionCounts);
  const lastDay = counted.map(sessionDay).filter(Boolean).sort().pop();
  if (lastDay) {
    const gap = daysBetween(lastDay, today);
    if (gap >= 7) add(9, `${hey}llevas ${gap} días sin correr. Vuelve con una sesión suave: lo importante hoy es retomar el hábito.`);
    else if (gap >= 3) add(8, `Hace ${gap} días de tu última sesión. Hoy es un gran día para volver: aunque sean 20 minutos, suman.`);
  }
  const streak = streakWeeks(st, now);
  if (streak >= 2) add(6, `Llevas ${streak} semanas seguidas cumpliendo. La constancia es tu superpoder: ${streak >= 4 ? 'esto ya es un hábito de atleta.' : 'sigue así.'}`);

  const wp = skipWeek ? null : (() => { try { return weekProgress(st, today, now); } catch { return null; } })();
  if (wp && wp.plannedSessions) {
    const missing = wp.plannedSessions - wp.doneSessions;
    const left = Number.isFinite(wp.remainingSessions) ? Math.min(missing, wp.remainingSessions) : missing;
    if (missing <= 0) add(7, '¡Semana completada! Todo lo planificado, hecho. Disfruta del descanso, te lo has ganado.');
    else if (wp.doneSessions > 0 && left > 0) {
      add(3, `Esta semana llevas ${wp.doneSessions} de ${wp.plannedSessions} sesiones y ${wp.minutes} minutos. ${left === 1 ? 'Queda 1: ¡a por ella!' : `Quedan ${left}: ¡a por ellas!`}`);
    } else if (wp.doneSessions > 0) {
      add(3, `Semana cerrada con ${wp.doneSessions} de ${wp.plannedSessions} sesiones. La próxima, ¡a por todas!`);
    }
  }

  // Progreso de velocidades frente a hace 4 semanas
  const ago = addDays(today, -28);
  let bestGain = null;
  for (const k of LEVEL_KEYS) {
    const before = levelAt(st.levelHistory, k, ago);
    const nowV = num(st.levels?.[k]);
    if (before != null && nowV - before >= 0.2 - 1e-9 && (!bestGain || nowV - before > bestGain.d)) bestGain = { k, before, nowV, d: nowV - before };
  }
  if (bestGain) {
    add(6, `En cuatro semanas tu ${noun(bestGain.k)} ha pasado de ${fmt.speed(bestGain.before)} a ${fmt.speed(bestGain.nowV)} km/h. ¡Eso es progreso de verdad!`);
  }

  // Sensaciones recientes y rachas cómodas
  const recent = history.filter((s) => s.feeling).slice(-3);
  const hardN = recent.filter((s) => s.feeling === 'max' || s.feeling === 'fail').length;
  const easyN = recent.filter((s) => s.feeling === 'easy').length;
  if (recent.length >= 2 && hardN >= 2) add(8, 'Tus últimas sesiones han sido muy duras. Hemos ajustado la carga; prioriza dormir bien y no te saltes los calentamientos.');
  else if (recent.length >= 2 && easyN >= 2) add(5, 'Últimamente todo te parece fácil: buena señal. Tus velocidades irán subiendo en los próximos días.');
  const ok = st.progression?.okStreak || {};
  const okK = LEVEL_KEYS.filter((k) => num(ok[k]) === OK_STREAK - 1);
  if (okK.length) add(5, `Una sesión cómoda más y subimos tu ${noun(okK[okK.length - 1])}.`);

  // Pulso del Apple Watch
  const hrT = hrTrendInsight(st, history, today);
  if (hrT) add(hrT.prio, hrT.text);
  const withHr = history.filter(hasHrSeries);
  const lastS = history.slice().sort((a, b) => sesTime(a) - sesTime(b)).pop();
  if (lastS && hasHrSeries(lastS) && lastS.hrZones && daysBetween(sessionDay(lastS) || today, today) <= 2) {
    const hi = num(lastS.hrZones.z4) + num(lastS.hrZones.z5);
    if (hi >= 300) add(3, `En tu última sesión acumulaste ${Math.round(hi / 60)} minutos de pulso en Z4–Z5: trabajo de calidad. Recupera bien para que la próxima salga igual de fuerte.`);
  }
  if (!withHr.length && history.length >= 3) {
    add(2, 'Importa el pulso del Apple Watch desde el resumen de cada sesión: verás tu corazón sobre el perfil y el plan sabrá cuándo subir de verdad.');
  }

  // Hitos de distancia
  const tot = totals(history);
  const milestone = [10, 50, 100, 250, 500, 1000].find((m) => tot.km < m);
  if (milestone && tot.km > 0 && milestone - tot.km <= Math.max(3, milestone * 0.1)) {
    add(5, `Te faltan ${fmt.dec1(milestone - tot.km)} km para los ${milestone} km totales. ¡Ese logro está al caer!`);
  }

  // VAM y forma física
  const vam = num(st.progression?.bestVam) || num(st.progression?.lastTest?.vam);
  if (vam > 0) {
    const vo2 = estimateVo2max(vam);
    const cat = vo2Category(vo2, num(st.profile?.age) || 46, st.profile?.sex || 'm');
    add(2, `Tu VAM es ${fmt.speed(vam)} km/h, un VO₂máx estimado de ${fmt.dec1(vo2)}: nivel «${cat.label.toLowerCase()}» para tu edad.`);
  }

  // Consejos de fondo
  add(1, 'La mayoría de tus minutos son suaves a propósito: así se construye un motor que aguanta los días duros.');
  add(1, `Los cambios de velocidad se anuncian con ${num(st.treadmill?.announceLead) || 10} segundos: pulsa el botón de la cinta justo al oír «¡Ahora!».`);
  add(1, 'Calentar bien no es perder el tiempo: es lo que hace que las series salgan rápidas y sin molestias.');
  add(1, 'Bebe agua antes de empezar y ten la botella a mano en las sesiones de más de 45 minutos.');

  cand.sort((a, b) => b.prio - a.prio);
  const topPrio = cand[0].prio;
  const pool = cand.filter((c) => c.prio >= topPrio - 1);
  return pool[hashStr(today) % pool.length].text;
}

/** Tendencia de pulso a una misma velocidad en las últimas 6 semanas («A 10,1 km/h tu pulso ha bajado 6 ppm en un mes»). */
function hrTrendInsight(st, history, today) {
  const t1 = parseKey(today).getTime() + DAY_MS;
  const hist = history
    .filter((s) => !s.isTest && hasHrSeries(s) && t1 - sesTime(s) <= 42 * DAY_MS && sesTime(s) < t1)
    .sort((a, b) => sesTime(a) - sesTime(b));
  if (hist.length < 3) return null;
  let best = null;
  for (const k of LEVEL_KEYS) {
    const groups = new Map();
    for (const s of hist) {
      const e = hrAtLevels(s, { levels: levelsOf(st, s) })[k];
      if (!e || e.sec < HR_MIN_LEVEL_SEC) continue;
      const key = r1(e.speed);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ day: sessionDay(s), avg: e.avg });
    }
    for (const [speed, arr] of groups) {
      if (arr.length < 3 || !arr[0].day || !arr[arr.length - 1].day) continue;
      const span = daysBetween(arr[0].day, arr[arr.length - 1].day);
      if (span < 10) continue;
      const h = Math.min(3, Math.floor(arr.length / 2));
      const mean = (xs) => xs.reduce((a, x) => a + x.avg, 0) / xs.length;
      const d = Math.round(mean(arr.slice(-h)) - mean(arr.slice(0, h)));
      if (d > -3 && d < 5) continue;
      const score = Math.abs(d) + (k === 'run' ? 0.5 : 0);
      if (!best || score > best.score) best = { k, speed, d, span, score };
    }
  }
  if (!best) return null;
  const period = best.span <= 12 ? `en ${best.span} días` : best.span <= 17 ? 'en dos semanas' : best.span <= 24 ? 'en tres semanas' : 'en un mes';
  if (best.d < 0) {
    return { prio: 7, text: `A ${fmt.speed(best.speed)} km/h tu pulso ha bajado ${-best.d} ppm ${period}. Tu corazón trabaja menos al mismo ritmo: eso es estar más en forma.` };
  }
  return { prio: 7, text: `A ${fmt.speed(best.speed)} km/h tu pulso ha subido ${best.d} ppm ${period}. Puede ser cansancio acumulado: duerme bien y respeta los días suaves.` };
}
