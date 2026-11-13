// RITMUP · corrección diaria del plan según cómo llegas (sin IA, sin DOM). Cálculos fijos; no diagnostica nada.
//
// Cada mañana se mira «esta noche frente a tu normal» (lo que durmió, pulso en reposo y VFC de Salud, y si ayer
// acabaste al límite) y, si hoy tocaba la sesión fuerte, se corrige el día:
//   · rojo   → hoy suave y la sesión fuerte pasa al siguiente día suave que encaje (o se queda sin hacer si no hay hueco)
//   · ámbar  → la sesión fuerte se hace, más corta
//   · verde  → el plan tal cual
// Con «Entreno exigente» no hay frenos: ni se recorta ni se quita nada; solo se cambia de día la sesión fuerte cuando
// el pulso (reposo o VFC) dice claro que llegas cargado. El sueño se mide solo frente a lo que duermes tú.
// Además, si te saltaste la sesión fuerte de esta semana, se recoloca en el siguiente día suave que encaje.
// Frenos: nunca dos días fuertes seguidos, no se tocan test, carrera ni clase especial, ni un día que has cambiado tú;
// como mucho un cambio de día por semana y una recolocación por semana. Todo se puede deshacer (undoFix).
//
// El semáforo de Hoy (readiness.js) mira medias de 7 días: sirve para ver la tendencia, pero una mala noche apenas lo
// mueve. Aquí se mira el día.
import { addDays, mondayOf, weekdayOf, fmt } from '../core/utils.js';
import { dayPick, dayDone, easyPick } from './planner.js';
import { isHardEffort } from './levels.js';
import { sleepList } from './health-analysis.js';

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const sdev = (a) => { if (a.length < 2) return 0; const m = avg(a); return Math.sqrt(avg(a.map((x) => (x - m) ** 2))); };
// Cada umbral es el mayor entre uno fijo y tu propia variación de un día para otro (1,25 y 2 desviaciones): a quien
// le baila mucho la VFC o duerme muy irregular no se le avisa por lo que para él es un día cualquiera.
const K1 = 1.25;
const K2 = 2;
const r1 = (v) => Math.round(v * 10) / 10;

export const FIX_MAX_KEPT = 30;
// El sueño se mide SOLO frente a lo que duermes tú (tus 4 semanas): quien duerme poco siempre, llega como siempre.
const SLEEP_UNDER = 75;       // 75 min menos de lo tuyo: noche corta para ti
const SLEEP_FAR_UNDER = 120;  // 2 h menos de lo tuyo: noche muy corta para ti
const REST_HIGH = 7;          // pulso en reposo ≥ 7 ppm sobre tu normal
const REST_UP = 4;
const HRV_LOW = -25;          // VFC ≤ −25 % frente a tu normal (un solo día es ruidoso: umbrales más anchos que los de 7 días)
const HRV_DOWN = -12;
const TRIM_MIN = 10;          // recortar: al menos 10 min menos
const TRIM_FLOOR = 20;

/** Valores [[dayKey, v]] entre dos días (incluidos). */
function between(list, fromKey, toKey) {
  return (Array.isArray(list) ? list : [])
    .filter((p) => Array.isArray(p) && typeof p[0] === 'string' && p[0] >= fromKey && p[0] <= toKey && Number(p[1]) > 0)
    .map((p) => Number(p[1]));
}
const valueOn = (list, key) => {
  const p = (Array.isArray(list) ? list : []).find((x) => Array.isArray(x) && x[0] === key && Number(x[1]) > 0);
  return p ? Number(p[1]) : null;
};
const hm = (min) => `${Math.floor(min / 60)} h${min % 60 ? ` ${String(Math.round(min % 60)).padStart(2, '0')} min` : ''}`;

/**
 * Cómo llegas HOY frente a tu normal de las 4 semanas anteriores.
 * metrics: { resting: [[día, ppm]], hrv: [[día, ms]], sleep: [{ day, asleep }] } · history: sesiones guardadas.
 * → null (sin datos de esta noche ni de ayer) o
 *   { level: 'green'|'amber'|'red', points, signals: [{ key, pts, text }], sleep?, rest?, hrv? }
 * Puntos: noche 2 h más corta que las tuyas → 2; 75 min más corta → 1 (nunca por horas absolutas) · reposo ≥ +7 → 2;
 * ≥ +4 → 1 · VFC ≤ −25 % → 2; ≤ −12 % → 1 · ayer acabaste al límite → 1. Rojo: ≥ 4, o 3 con alguna señal de 2, y
 * siempre con el pulso (reposo o VFC) entre las señales. Ámbar: 2 o 3.
 */
export function dayState(metrics, today, history = []) {
  if (!metrics || !today) return null;
  const y = addDays(today, -1);
  const baseFrom = addDays(today, -29);
  const baseTo = addDays(today, -2);
  const signals = [];
  const out = { level: 'green', points: 0, signals };
  let seen = 0;

  // Sueño: la noche que acaba hoy
  const nights = sleepList(metrics);
  const last = nights.find((n) => n.day === today) || null;
  if (last) {
    seen++;
    const prev = nights.filter((n) => n.day >= baseFrom && n.day < today).map((n) => n.asleep);
    const base = prev.length >= 7 ? Math.round(avg(prev)) : null;
    out.sleep = { min: last.asleep, base };
    // sin tus noches de referencia no se juzga: no hay horas «buenas» para todos
    const sd = sdev(prev);
    if (base != null && last.asleep <= base - Math.max(SLEEP_UNDER, K1 * sd)) {
      signals.push({ key: 'sleep', pts: last.asleep <= base - Math.max(SLEEP_FAR_UNDER, K2 * sd) ? 2 : 1, text: `has dormido ${hm(last.asleep)}, ${hm(base - last.asleep)} menos de lo tuyo` });
    }
  }

  // Pulso en reposo: el de hoy si Salud ya lo tiene; si no, el de ayer (a primera hora el de hoy aún no existe)
  const restBase = between(metrics.resting, baseFrom, baseTo);
  const restNow = valueOn(metrics.resting, today) ?? valueOn(metrics.resting, y);
  if (restNow != null && restBase.length >= 7) {
    seen++;
    const delta = Math.round(restNow - avg(restBase));
    out.rest = { now: Math.round(restNow), base: Math.round(avg(restBase)), delta };
    const sd = sdev(restBase);
    const d = restNow - avg(restBase);
    if (delta >= REST_HIGH && d >= K2 * sd) signals.push({ key: 'rest', pts: 2, text: `tu pulso en reposo va ${delta} por encima` });
    else if (delta >= REST_UP && d >= K1 * sd) signals.push({ key: 'rest', pts: 1, text: `tu pulso en reposo va ${delta} por encima` });
  }

  // VFC: la de hoy (la noche) o la de ayer
  const hrvBase = between(metrics.hrv, baseFrom, baseTo);
  const hrvNow = valueOn(metrics.hrv, today) ?? valueOn(metrics.hrv, y);
  if (hrvNow != null && hrvBase.length >= 7) {
    seen++;
    const pct = Math.round((hrvNow / avg(hrvBase) - 1) * 100);
    out.hrv = { now: Math.round(hrvNow), base: Math.round(avg(hrvBase)), pct };
    const cv = (sdev(hrvBase) / avg(hrvBase)) * 100;       // tu variación de un día para otro, en %
    if (pct <= Math.min(HRV_LOW, -K2 * cv)) signals.push({ key: 'hrv', pts: 2, text: `tu variabilidad va un ${Math.abs(pct)} % baja` });
    else if (pct <= Math.min(HRV_DOWN, -K1 * cv)) signals.push({ key: 'hrv', pts: 1, text: `tu variabilidad va un ${Math.abs(pct)} % baja` });
  }

  if (!seen) return null;

  // Ayer acabaste al límite (solo suma si además hay alguna señal del cuerpo: por sí sola no cambia nada)
  const yest = (Array.isArray(history) ? history : []).filter((s) => s && s.dayKey === y);
  if (signals.length && yest.some((s) => Number(s.rpe) >= 9 || s.feeling === 'max' || s.feeling === 'fail')) {
    signals.push({ key: 'load', pts: 1, text: 'ayer acabaste al límite' });
  }

  out.points = signals.reduce((a, s) => a + s.pts, 0);
  const strong = signals.some((s) => s.pts >= 2);
  // Rojo solo si lo dice el pulso (reposo o VFC): una mala noche, por mala que sea, se queda en ámbar
  const pulse = signals.some((s) => s.key === 'rest' || s.key === 'hrv');
  out.level = pulse && (out.points >= 4 || (out.points >= 3 && strong)) ? 'red' : out.points >= 2 ? 'amber' : 'green';
  return out;
}

const fixesOf = (state) => (Array.isArray(state?.plan?.fixes) ? state.plan.fixes : []);
const active = (state) => fixesOf(state).filter((f) => f && !f.undone);
const inWeek = (f, monday) => f.date >= monday && f.date <= addDays(monday, 6);
const why = (ds) => (ds?.signals?.length ? ds.signals.map((s) => s.text).join(' y ') : '');
const dayName = (key, today) => (key === today ? 'hoy' : key === addDays(today, 1) ? 'mañana' : `el ${fmt.weekdayName(weekdayOf(key)).toLowerCase()}`);

/** ¿Se puede poner una sesión fuerte en `d`? Día suave por hacer, sin tocar por ti, y sin otra fuerte pegada. */
function fitsHard(state, d, { swapWith = null, today = d } = {}) {
  const p = dayPick(state, d);
  if (p.kind === 'rest' || !p.templateId || p.intensity !== 'easy') return false;
  if (p.test || p.race || p.event || p.isOverride || dayDone(state, d)) return false;
  for (const n of [addDays(d, -1), addDays(d, 1)]) {
    if (n === swapWith) continue;                       // ese día se queda con la suave
    const q = dayPick(state, n);
    const hard = q.intensity === 'hard' || q.test || q.race;
    // un día ya pasado solo cuenta como fuerte si de verdad lo corriste
    if (hard && (n >= today || dayDone(state, n))) return false;
  }
  return true;
}

/** Días candidatos de esta semana para llevar la sesión fuerte, por orden de preferencia. */
function targets(state, today, { from, swapWith }) {
  const sunday = addDays(mondayOf(today), 6);
  const out = [];
  for (let d = from; d <= sunday; d = addDays(d, 1)) if (d !== swapWith && fitsHard(state, d, { swapWith, today })) out.push(d);
  // mejor con un día suave por medio que pegada a hoy
  if (swapWith === today) out.sort((a, b) => (a === addDays(today, 1)) - (b === addDays(today, 1)) || (a < b ? -1 : 1));
  return out;
}

const ovOf = (p, extra) => (p.kind === 'rest' || !p.templateId ? { rest: true } : { templateId: p.templateId, minutes: p.minutes, seed: p.seed, auto: true, ...extra });

/**
 * La corrección de hoy, si toca alguna. No cambia nada: devuelve lo que habría que aplicar.
 * → null | { id, date, kind: 'move'|'trim'|'soft'|'relocate', level, from, to, text, toText, set: { [día]: override } }
 * `ds` es dayState(...) (null = sin datos: solo se mira la recolocación).
 */
export function planFix(state, today, ds) {
  if (!state || !today) return null;
  const monday = mondayOf(today);
  const done = active(state).filter((f) => inWeek(f, monday));
  if (fixesOf(state).some((f) => f && f.date === today)) return null;   // hoy ya se decidió (o lo deshiciste)
  const level = ds?.level || 'green';
  const t = dayPick(state, today);
  const todayFree = !dayDone(state, today) && !t.isOverride && !t.test && !t.race && !t.event && t.kind !== 'rest' && !!t.templateId;
  const id = `fix_${today}`;
  const reason = why(ds);
  // Entreno exigente: sin frenos. Nunca se recorta ni se cambia la sesión por una suave; lo único que se hace es
  // cambiarla de día cuando el pulso dice claro que llegas cargado (la sesión se hace igual, entera, otro día).
  const pushy = isHardEffort(state.profile);

  // 1 · Hoy tocaba fuerte (o media) y llegas mal
  if (todayFree && ds && level !== 'green') {
    if (level === 'red' && t.intensity === 'hard') {
      const moved = done.some((f) => f.kind === 'move');
      const to = moved ? null : targets(state, today, { from: addDays(today, 1), swapWith: today })[0] || null;
      if (to) {
        const other = dayPick(state, to);
        return {
          id, date: today, kind: 'move', level, from: today, to,
          text: `Hoy llegas cargado: ${reason}. La sesión fuerte pasa a ${dayName(to, today)}; hoy, ${other.title || 'suave'}.`,
          toText: `Aquí va la sesión fuerte que movimos desde el ${fmt.weekdayName(weekdayOf(today)).toLowerCase()}, cuando llegaste cargado.`,
          set: {
            [today]: ovOf(other, { intro: 'Hoy llegas cargado: suave y a recuperar. La sesión fuerte te espera otro día.' }),
            [to]: ovOf(t, { intro: 'La sesión fuerte de esta semana, movida a este día para que la hagas descansado.' }),
          },
        };
      }
      const soft = pushy ? null : softFor(state, today, t);
      if (soft) {
        return {
          id, date: today, kind: 'soft', level, from: today, to: null,
          text: `Hoy llegas cargado: ${reason}. Hoy toca suave (${soft.title}); esta semana no queda hueco para mover la sesión fuerte.`,
          set: { [today]: { templateId: soft.templateId, minutes: t.minutes, auto: true, intro: 'Hoy llegas cargado: suave y a recuperar.' } },
        };
      }
      return null;
    }
    if (level === 'red' && t.intensity === 'moderate' && !pushy) {
      const soft = softFor(state, today, t);
      if (!soft) return null;
      return {
        id, date: today, kind: 'soft', level, from: today, to: null,
        text: `Hoy llegas cargado: ${reason}. Cambiamos la sesión de hoy por una suave (${soft.title}).`,
        set: { [today]: { templateId: soft.templateId, minutes: t.minutes, auto: true, intro: 'Hoy llegas cargado: suave y a recuperar.' } },
      };
    }
    if (level === 'amber' && t.intensity === 'hard' && !t.pace && !pushy) {
      const min = trimmed(t);
      if (min != null) {
        return {
          id, date: today, kind: 'trim', level, from: today, to: null,
          text: `Hoy llegas algo justo: ${reason}. La sesión fuerte se hace, más corta: ${min} min en vez de ${t.minutes}.`,
          set: { [today]: { templateId: t.templateId, minutes: min, seed: t.seed, auto: true, intro: 'Hoy llegas algo justo: la misma sesión, más corta. Calidad antes que cantidad.' } },
        };
      }
    }
    return null;
  }

  // 2 · Te saltaste la sesión fuerte de esta semana: al siguiente día suave que encaje (hoy solo si llegas bien)
  if (done.some((f) => f.kind === 'relocate' || f.kind === 'move')) return null;
  for (let d = monday; d < today; d = addDays(d, 1)) {
    const p = dayPick(state, d);
    if (p.intensity !== 'hard' || p.test || p.race || p.event || p.kind === 'rest' || dayDone(state, d)) continue;
    if (fixesOf(state).some((f) => f && (f.from === d || f.to === d))) continue;   // ya se movió (o lo deshiciste)
    const from = level === 'green' && ds ? today : addDays(today, 1);
    const to = targets(state, today, { from, swapWith: d })[0] || null;
    if (!to) return null;
    const other = dayPick(state, to);
    const wd = fmt.weekdayName(weekdayOf(d)).toLowerCase();
    return {
      id, date: today, kind: 'relocate', level, from: d, to,
      text: `Te saltaste la sesión fuerte del ${wd}: pasa a ${dayName(to, today)}, que era día suave.`,
      toText: `Aquí va la sesión fuerte del ${wd}, que no pudiste hacer.`,
      set: {
        [d]: ovOf(other, {}),
        [to]: ovOf(p, { intro: `La sesión fuerte del ${wd}, que te saltaste. Hoy es su día.` }),
      },
    };
  }
  return null;
}

const softFor = (state, date, t) => easyPick(state, date, t.minutes, t.templateId);

/** Duración recortada de una sesión: un 20 % menos (al menos 10 min), dentro de lo que admite la plantilla y ≥ 20. → min | null */
function trimmed(t) {
  const lo = Math.min(...(t.durations.length ? t.durations : [t.minutes]));
  const cut = Math.max(TRIM_MIN, Math.round((t.minutes * 0.2) / 5) * 5);
  const m = t.minutes - cut;
  return m >= Math.max(TRIM_FLOOR, lo) ? m : null;
}

function plan(draft) {
  if (!draft.plan || typeof draft.plan !== 'object') draft.plan = { startDate: null, overrides: {} };
  if (!draft.plan.overrides || typeof draft.plan.overrides !== 'object') draft.plan.overrides = {};
  if (!Array.isArray(draft.plan.fixes)) draft.plan.fixes = [];
  return draft.plan;
}

/** Aplica la corrección al estado (guarda lo que había en cada día para poder deshacerla). */
export function applyFix(draft, fix) {
  if (!draft || !fix || !fix.set) return false;
  const p = plan(draft);
  if (p.fixes.some((f) => f && f.id === fix.id)) return false;
  const prev = {};
  for (const [d, ov] of Object.entries(fix.set)) {
    prev[d] = p.overrides[d] ? { ...p.overrides[d] } : null;
    p.overrides[d] = { ...ov };
  }
  p.fixes.push({ id: fix.id, date: fix.date, kind: fix.kind, level: fix.level, from: fix.from, to: fix.to || null, text: fix.text, toText: fix.toText || '', prev, at: new Date().toISOString() });
  while (p.fixes.length > FIX_MAX_KEPT) p.fixes.shift();
  return true;
}

/** Deshace una corrección: cada día vuelve a lo que tenía (si no lo has cambiado tú después). No se vuelve a aplicar ese día. */
export function undoFix(draft, id) {
  if (!draft) return false;
  const p = plan(draft);
  const f = p.fixes.find((x) => x && x.id === id && !x.undone);
  if (!f) return false;
  for (const [d, was] of Object.entries(f.prev || {})) {
    if (p.overrides[d]?.auto !== true && p.overrides[d]) continue;   // lo cambiaste tú después: se respeta
    if (was) p.overrides[d] = was; else delete p.overrides[d];
  }
  f.undone = true;
  return true;
}

/** La corrección vigente que afecta a ese día (para explicarla en Hoy). → null | { id, kind, text, canUndo } */
export function fixOn(state, date, today = date) {
  const list = active(state);
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i];
    if (f.date === date) return { id: f.id, kind: f.kind, level: f.level, text: f.text, canUndo: date >= today && !undoneLate(state, f) };
    if (f.to === date && date !== f.date) return { id: f.id, kind: f.kind, level: f.level, text: f.toText || f.text, canUndo: date >= today && !undoneLate(state, f) };
  }
  return null;
}
// Si ya has hecho alguno de los días que tocó, deshacer dejaría el plan incoherente: se quita el botón
function undoneLate(state, f) {
  return Object.keys(f.prev || {}).some((d) => dayDone(state, d));
}

/** Un día de trabajo: decide y aplica. → la corrección aplicada o null. `metrics` puede ser null (sin Salud). */
export function runDayFix(draft, today, metrics) {
  let ds = null;
  try { ds = dayState(metrics, today, draft?.history); } catch { ds = null; }
  const fix = planFix(draft, today, ds);
  if (!fix) return null;
  return applyFix(draft, fix) ? { ...fix, state: ds } : null;
}

export const _test = { trimmed, r1 };
