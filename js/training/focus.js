// RITMUP · el plan reacciona a ti (sin DOM ni IA). Cada 4 semanas mira cómo te han salido los tres tipos de trabajo,
// cada uno comparado con lo que es normal en él, y elige qué necesita más atención: lo que mejor te va se mantiene y el
// esfuerzo de mejora va a lo que te frena. La decisión se guarda en state.plan.focus y arranca siempre un lunes.
// El plan la aplica cambiando el TIPO de la sesión clave que ya tocaba (planner.js): nunca añade dureza ni carga.
import { executionOf, segmentsOfSession, sessionTime } from './class-analysis.js';
import { evolution } from './evolution.js';
import { countsAsSession, planWeek } from './planner.js';
import { CAPACITIES, FOCUS_WEEKS } from './focus-map.js';
import { goalOf } from './goal.js';
import { getTemplate } from './templates.js';
import { templateMeta } from './season.js';
import { sessionDay } from './stats.js';
import { todayKey, addDays, mondayOf, parseKey, fmt } from '../core/utils.js';

const WINDOW_DAYS = 56;
const MIN_SESSIONS = 6;       // en la ventana, para atreverse a decidir algo
const MIN_PER_KIND = 3;       // para medir un tipo
const MISSING_FROM = 8;       // con estas clases, un tipo casi ausente también es lo que falta
const MIN_GAP = 0.6;          // diferencia mínima entre el mejor y el peor tipo: si no, no hay nada que corregir
const BELOW = -0.15;          // y además lo peor tiene que ir por debajo de lo normal en su tipo: «lo que menos destaca» no es «lo que te frena»
const RULES = 2;              // versión de la regla: las decisiones tomadas con la anterior se revisan una vez
const MAX_REPEAT = 2;         // bloques seguidos como mucho en lo mismo
const IMPROVED = 3;           // puntos de mejora para dar por bueno un bloque
const KEEP_PAST = 6;
const BRAKE_TAGS = new Set(['cold', 'pain', 'tired', 'sleep']);

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const clases = (n) => `${n} ${n === 1 ? 'clase' : 'clases'}`;
const nextMonday = (key) => addDays(mondayOf(key), 7);
/** ¿Hay una carrera que manda? Solo hasta una semana después de correrla: un objetivo ya pasado no bloquea el enfoque. */
const goalRules = (state, today) => { const g = goalOf(state); return !!g && g.date >= addDays(today, -7); };
const emptyFocus = () => ({ current: null, past: [], checked: null });

const validEntry = (e) => !!(e && CAPACITIES[e.capacity] && typeof e.from === 'string' && typeof e.to === 'string');

function focusState(state) {
  const f = state?.plan?.focus;
  if (!f || typeof f !== 'object') return emptyFocus();
  const current = validEntry(f.current) ? { holds: [], ...f.current, baseline: f.current.baseline || {} } : null;
  return { current, past: Array.isArray(f.past) ? f.past.filter(validEntry) : [], checked: f.checked || null, checkedCount: f.checkedCount ?? null };
}

/** A qué capacidad pertenece una clase: por su familia (lo mismo que cambia el plan) y, si no se conoce, por su categoría. */
function capacityOf(s) {
  const t = s?.templateId ? getTemplate(s.templateId) : null;
  const family = t ? templateMeta(t).family : null;
  const keys = Object.keys(CAPACITIES);
  return keys.find((k) => CAPACITIES[k].families.includes(family)) || keys.find((k) => CAPACITIES[k].cats.includes(s?.category)) || null;
}

/** Sesiones que cuentan, anteriores a `cutoff` y dentro de la ventana, con su ejecución. */
function itemsBefore(state, cutoff) {
  const to = parseKey(cutoff).getTime();
  const from = to - WINDOW_DAYS * 86400000;
  return (Array.isArray(state?.history) ? state.history : [])
    .filter((s) => s && typeof s === 'object' && !s.isTest && countsAsSession(s))
    .filter((s) => { const t = sessionTime(s); return t >= from && t < to; })
    .sort((a, b) => sessionTime(a) - sessionTime(b))
    .map((s) => ({ s, ex: executionOf(s, segmentsOfSession(state, s), state?.profile || {}) }));
}

/** Cuánto se aparta una capacidad de lo normal en ella (> 0 mejor, < 0 peor), con su nota y su esfuerzo medios. */
function deltaOf(key, score, rpe) {
  const exp = CAPACITIES[key]?.expected;
  if (!exp) return null;
  const parts = [];
  if (score != null) parts.push((score - exp.score) / 10);
  if (rpe != null) parts.push((exp.rpe - rpe) / 1.2);
  return parts.length ? mean(parts) : null;
}

/** Cómo va cada capacidad: `delta` > 0, mejor de lo normal en ese tipo de clase; < 0, peor. */
function measure(items) {
  const out = {};
  for (const key of Object.keys(CAPACITIES)) {
    const cap = CAPACITIES[key];
    const list = items.filter((it) => capacityOf(it.s) === key);
    const scores = list.map((it) => it.ex.score).filter((v) => v != null);
    const rpes = list.map((it) => num(it.s.rpe)).filter((v) => v > 0);
    const score = mean(scores);
    const rpe = mean(rpes);
    const delta = deltaOf(key, score, rpe);
    out[key] = {
      key, n: list.length, measured: list.length >= MIN_PER_KIND && delta != null,
      score: score == null ? null : Math.round(score), rpe: rpe == null ? null : Math.round(rpe * 10) / 10,
      delta,
    };
  }
  return out;
}

/** Bloques seguidos que acaban de dedicarse a `key` y si el último funcionó. */
function history(past, key) {
  let streak = 0;
  for (const e of past) {
    if (e.capacity !== key || e.declined) break;
    streak++;
  }
  return { streak, failed: streak > 0 && past[0]?.result != null && past[0].result.delta < IMPROVED };
}

function allowed(past, key) {
  const h = history(past, key);
  return h.streak < MAX_REPEAT && !h.failed;
}

function chooseCapacity(m, total, past, flat = false) {
  const all = Object.values(m);
  const measured = all.filter((c) => c.measured).sort((a, b) => a.delta - b.delta);
  const best = measured[measured.length - 1] || null;
  // Lo que casi no se hace: no se puede saber si va bien, y es justo lo que el plan puede dar
  if (total >= MISSING_FROM) {
    const missing = all.filter((c) => c.n <= 1 && allowed(past, c.key)).sort((a, b) => a.n - b.n)[0];
    if (missing) return { capacity: missing.key, keep: best?.key || null, why: 'missing', stats: missing };
  }
  if (measured.length < 2 || flat) return null;
  for (const c of measured) {
    if (best.key === c.key || best.delta - c.delta < MIN_GAP) return null;
    if (!(c.delta < BELOW)) return null;
    if (allowed(past, c.key)) return { capacity: c.key, keep: best.key, why: 'struggle', stats: c };
  }
  return null;
}

function lastClosedWeekWeak(state, items, monday, now) {
  try {
    const ev = evolution(state, items, now);
    const w = ev?.weeks?.find((x) => x.monday === addDays(monday, -7));
    return w ? w.state === 'weak' : false;
  } catch {
    return false;
  }
}

/** Semana recién cerrada mala (pulso alto, clases a medias, resfriado, cansancio…): esta semana no se aprieta. */
function shouldHold(state, monday, now) {
  const tag = state?.ui?.weekTags?.[addDays(monday, -7)];
  if (BRAKE_TAGS.has(tag)) return true;
  return lastClosedWeekWeak(state, itemsBefore(state, monday), monday, now);
}

/** Cierra un bloque terminado: ¿mejoró lo que se trabajó? */
function closeEntry(state, entry) {
  if (entry.declined || entry.baseline?.score == null) return { ...entry, result: null };
  const m = measure(itemsBefore(state, entry.to).filter((it) => sessionDay(it.s) >= entry.from));
  const after = m[entry.capacity];
  if (after?.score == null || after.n < 2) return { ...entry, result: null };
  return { ...entry, result: { before: entry.baseline.score, after: after.score, delta: after.score - entry.baseline.score } };
}

/**
 * Lo que hay que guardar en state.plan.focus, o null si no cambia nada. Se llama al abrir Hoy y Análisis y al terminar
 * una clase: comprueba una vez por semana y no toca la decisión de un bloque en marcha.
 */
export function focusUpdate(state, now = new Date()) {
  const today = todayKey(now);
  const monday = mondayOf(today);
  const f = focusState(state);
  if (goalRules(state, today)) return null;                         // con carrera manda la carrera
  let { current, past } = f;
  let changed = false;
  // La primera regla elegía «lo que menos destaca» aunque fuese bien (a quien valoraba todo igual le salía siempre Fondo):
  // una decisión tomada así, si no va de verdad por debajo de lo normal, se retira sin archivarla
  if (current && current.v !== RULES) {
    const d = current.why === 'struggle' ? deltaOf(current.capacity, current.baseline?.score ?? null, current.baseline?.rpe ?? null) : null;
    current = current.why === 'struggle' && !(d < BELOW) ? null : { ...current, v: RULES };
    changed = true;
  }
  if (current && current.to <= monday) {
    past = [closeEntry(state, current), ...past].slice(0, KEEP_PAST);
    current = null;
    changed = true;
  }
  if (f.checked === monday && !changed && (current || f.checkedCount === (state?.history || []).length)) return null;
  if (!current) {
    const started = (Array.isArray(state?.history) ? state.history : []).some((s) => s && sessionDay(s) >= monday);
    const from = today === monday && !started ? monday : nextMonday(today);
    const items = itemsBefore(state, from);
    if (items.length >= MIN_SESSIONS) {
      // Si valoras todas las clases igual y las cumples igual, no hay con qué distinguir un tipo de otro: no se inventa nada
      const rp = items.map((it) => num(it.s.rpe)).filter((v) => v > 0);
      const sc = items.map((it) => it.ex.score).filter((v) => v != null);
      const spread = (a) => (a.length ? Math.max(...a) - Math.min(...a) : 0);
      const flat = spread(rp) < 1 && spread(sc) < 8;
      const pick = chooseCapacity(measure(items), items.length, past, flat);
      if (pick) {
        current = {
          capacity: pick.capacity, keep: pick.keep, why: pick.why, from, to: addDays(from, FOCUS_WEEKS * 7),
          baseline: { score: pick.stats.score, rpe: pick.stats.rpe, n: pick.stats.n }, holds: [], declined: false, v: RULES,
        };
        changed = true;
      }
    }
  }
  if (current && current.from <= monday && !current.declined && !current.holds.includes(monday) && shouldHold(state, monday, now)) {
    current = { ...current, holds: [...current.holds, monday] };
    changed = true;
  }
  return { current, past, checked: monday, checkedCount: (state?.history || []).length };
}

function dayMonth(key) {
  return fmt.dateShort(key).split(' ').slice(1).join(' ');
}

function whyText(e) {
  const cap = CAPACITIES[e.capacity];
  if (e.why === 'missing') return `Apenas has trabajado ${cap.noun} estas semanas: ${e.baseline.n ? `solo ${clases(e.baseline.n)}` : 'ninguna clase'}. Es donde más puedes ganar.`;
  const score = e.baseline.score != null ? `cumples un ${e.baseline.score} de 100` : '';
  const rpe = e.baseline.rpe != null ? `te cuesta ${fmt.dec1(e.baseline.rpe)} de 10` : '';
  return `Comparado con lo normal en cada tipo de clase, es lo que más te frena: ${[score, rpe].filter(Boolean).join(' y ')}.`;
}

/**
 * Para pantallas → null o { state, title, eyebrow, text, keepText, resultText, actionable, declined }.
 * state: 'goal' · 'learning' · 'balanced' · 'next' (empieza el lunes) · 'active' · 'idle' (esta semana no toca) · 'hold' · 'declined'.
 */
export function focusView(state, now = new Date()) {
  const f = focusState(state);
  const monday = mondayOf(todayKey(now));
  const last = f.past.find((e) => e.result && !e.declined);
  const resultText = last ? (last.result.delta >= IMPROVED
    ? `Tu bloque de ${CAPACITIES[last.capacity].name.toLowerCase()} funcionó: de ${last.result.before} a ${last.result.after}.`
    : `Tu bloque de ${CAPACITIES[last.capacity].name.toLowerCase()} no movió la aguja (${last.result.before} → ${last.result.after}): probamos otro camino.`) : '';
  if (goalRules(state, todayKey(now))) return { state: 'goal', eyebrow: 'Tu enfoque', title: 'Manda tu carrera', text: 'Mientras tengas una carrera, el plan se organiza alrededor de lo que pide esa distancia.', resultText };
  const e = f.current;
  if (!e) {
    const n = itemsBefore(state, addDays(monday, 7)).length;
    if (n < MIN_SESSIONS) {
      if (!n) return null;
      const left = MIN_SESSIONS - n;
      return { state: 'learning', eyebrow: 'Tu enfoque', title: 'Conociéndote', text: `Con ${clases(left)} más podré decirte qué te conviene trabajar y el plan empezará a adaptarse a ti.`, resultText };
    }
    return { state: 'balanced', eyebrow: 'Tu enfoque', title: 'Vas equilibrado', text: 'Ningún tipo de trabajo se te queda atrás. El plan sigue repartido; volveré a mirarlo cada semana.', resultText };
  }
  const cap = CAPACITIES[e.capacity];
  const keep = e.keep ? `Lo que mejor llevas, ${CAPACITIES[e.keep].noun}, se queda con una sesión a la semana para no perderlo.` : '';
  const base = { title: cap.name, keepText: keep, resultText, actionable: true };
  const last7 = dayMonth(addDays(e.to, -1));      // el bloque acaba el domingo, no el lunes siguiente
  if (e.declined) return { ...base, state: 'declined', eyebrow: 'Enfoque desactivado', text: `Te propuse trabajar ${cap.noun}. El plan sigue como estaba hasta el ${last7}.`, keepText: '' };
  if (e.from > monday) return { ...base, state: 'next', eyebrow: `Tu enfoque · desde el ${dayMonth(e.from)}`, text: whyText(e) };
  if (e.holds?.includes(monday)) return { ...base, state: 'hold', eyebrow: 'Tu enfoque · en pausa esta semana', text: `La semana pasada no fue buena, así que esta no aprieto. Sigo con ${cap.noun} cuando vuelvas a estar bien.`, keepText: '' };
  // Hay semanas en las que el plan no puede darle su sesión (descarga, test, clases ya fijadas o topes de carga): se dice
  let hasDay = true;
  try { hasDay = planWeek(state, monday, now).some((d) => d.focus); } catch { hasDay = true; }
  if (!hasDay) return { ...base, state: 'idle', eyebrow: 'Tu enfoque · esta semana no toca', text: `Esta semana tu plan no lleva sesión de ${cap.name.toLowerCase()}: es de descarga, de test o ya va justa de carga. Vuelve la próxima.`, keepText: '' };
  return { ...base, state: 'active', eyebrow: `Tu enfoque · hasta el ${last7}`, text: whyText(e) };
}

/** Rechazar o recuperar la propuesta (para usar dentro de setState). */
export function setFocusDeclined(draft, declined) {
  if (draft?.plan?.focus?.current) draft.plan.focus.current.declined = !!declined;
}
