// RITMUP · análisis de una clase terminada (sin DOM ni IA): reglas fijas sobre lo que se midió, nunca una cifra inventada.
// Responde a cuatro preguntas: ¿cómo te ha salido?, ¿qué tal frente a otras veces?, ¿qué ha pasado dentro de la clase?
// y ¿qué viene ahora? No guarda nada: se calcula con la sesión y las ANTERIORES a ella, así que sirve también para el
// historial que ya existe y una clase vieja no cambia cuando llegan clases nuevas.
import { ZONES, hrMaxFromAge } from './levels.js';
import { zoneCompliance } from './hr-shape.js';
import { isHills } from './hr-model.js';
import { skippedRanges } from './stats.js';
import { planDay, countsAsSession } from './planner.js';
import { workoutFromId } from './generator.js';
import { raceReport, raceDebrief } from './race-report.js';
import { fmt, addDays, daysBetween } from '../core/utils.js';

const NB = ' ';
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const cap = (x, top) => Math.max(0, Math.min(1, x / top));

export const CATEGORY_NAMES = {
  intervals: 'Intervalos', tempo: 'Tempo', endurance: 'Resistencia', fartlek: 'Fartlek',
  hills: 'Cuestas', recovery: 'Recuperación', challenge: 'Retos',
};
const EASY_CATS = new Set(['recovery', 'endurance']);
const HARD_CATS = new Set(['intervals', 'tempo', 'fartlek', 'hills', 'challenge']);
const PURPOSE = {
  intervals: 'Subir tu techo con tramos fuertes y recuperaciones.',
  tempo: 'Aguantar un ritmo firme sin pasarte.',
  endurance: 'Hacer base a un ritmo cómodo.',
  fartlek: 'Cambiar de ritmo una y otra vez.',
  hills: 'Ganar fuerza en las subidas.',
  recovery: 'Soltar las piernas y asimilar lo anterior.',
  challenge: 'Ponerte a prueba.',
};

const RANK = { walk: 0, warmup: 1, cooldown: 1, jog: 2, run: 3, fast: 4, sprint: 5 };
const WORK = new Set(['jog', 'run', 'fast', 'sprint']);
const SPEED_TOL = 0.5;       // km/h: la app retoca algunos tramos (deriva, recuperaciones) hasta −0,4; eso no es «desviarse»
const DRIFT_MIN_SEC = 25 * 60;
const DRIFT_SLOPE = 6;       // ppm por km/h: para comparar tramos a velocidades un poco distintas

export const sessionTime = (x) => {
  const t = Date.parse(x?.startedAt || '');
  if (Number.isFinite(t)) return t;
  const d = Date.parse(`${x?.dayKey || ''}T12:00:00`);
  return Number.isFinite(d) ? d : 0;
};

/* ───────── Segmentos de una clase (con caché: reconstruirla cuesta y el análisis la pide muchas veces) ───────── */

const segCache = new Map();

/** Tramos con los que se corrió una sesión, o null. */
export function segmentsOfSession(state, s) {
  if (!s?.workoutId) return null;
  const levels = s.levelsAtStart || state?.levels || null;
  const gen = Number(s.gen) || 1;   // la forma con la que se corrió (las de antes del 14 nov 2026 no la guardaban)
  const key = `${s.workoutId}|${levels ? [levels.jog, levels.run, levels.fast, levels.sprint].join() : ''}|${state?.treadmill?.hasIncline ? 1 : 0}|${gen}`;
  if (segCache.has(key)) return segCache.get(key);
  let segs = null;
  try { segs = workoutFromId(s.workoutId, { ...state, levels }, { gen })?.segments || null; } catch { segs = null; }
  if (segCache.size > 400) segCache.clear();
  segCache.set(key, segs);
  return segs;
}

/* ───────── Piezas de medida ───────── */

function cleanHr(session) {
  return (Array.isArray(session?.hrSeries) ? session.hrSeries : [])
    .filter((p) => Array.isArray(p) && Number(p[1]) >= 40 && Number(p[1]) <= 230)
    .map((p) => [Number(p[0]), Number(p[1])])
    .sort((a, b) => a[0] - b[0]);
}

function cleanTrace(session) {
  return (Array.isArray(session?.speedTrace) ? session.speedTrace : [])
    .filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])))
    .map((p) => [Number(p[0]), Number(p[1])])
    .sort((a, b) => a[0] - b[0]);
}

function segmentSpans(segments) {
  let t = 0;
  return (Array.isArray(segments) ? segments : []).map((g) => {
    const a = t;
    t += num(g?.sec);
    return { a, b: t, sec: num(g?.sec), zone: g?.zone, speed: num(g?.speed) };
  });
}

/** Carga de una clase: minutos en cada zona por el peso de esa zona. Siempre disponible, con o sin reloj. */
export function sessionLoad(s) {
  const tiz = s?.timeInZone && typeof s.timeInZone === 'object' ? s.timeInZone : {};
  return Object.entries(tiz).reduce((a, [z, sec]) => a + (num(sec) / 60) * (ZONES[z]?.weight ?? 1), 0);
}

/** Qué parte de los tramos de trabajo fuiste a la velocidad prevista. → null o { pct, belowPct, abovePct } */
export function speedAdherence(session, segments) {
  const tr = cleanTrace(session);
  const spans = segmentSpans(segments).filter((g) => WORK.has(g.zone) && g.sec >= 30);
  if (tr.length < 2 || !spans.length) return null;
  const end = tr[tr.length - 1][0];
  const skips = skippedRanges(session);
  let total = 0;
  let ok = 0;
  let below = 0;
  let above = 0;
  let i = 0;
  for (const g of spans) {
    for (let t = g.a + 15; t < g.b && t <= end; t += 5) {
      if (skips.some(([a, b]) => t >= a && t < b)) continue;
      while (i + 1 < tr.length && tr[i + 1][0] <= t) i++;
      const d = tr[i][1] - g.speed;
      total++;
      if (d < -SPEED_TOL) below++;
      else if (d > SPEED_TOL) above++;
      else ok++;
    }
  }
  if (total < 12) return null;
  return { pct: Math.round((ok / total) * 100), belowPct: Math.round((below / total) * 100), abovePct: Math.round((above / total) * 100) };
}

/**
 * Lo bien que ha salido la clase, de 0 a 100: lo completada que está y, sobre todo, lo cerca de lo que pedía (por pulso
 * si hay reloj; si no, por velocidad). Sin ninguna de las dos no hay nota: solo sabríamos que la terminaste.
 */
export function executionOf(session, segments, profile) {
  const completion = Math.max(0, Math.min(1, num(session?.completionPct)));
  // Una carrera terminada no lleva nota: no se trata de ir en una zona ni a la velocidad del plan, sino de la marca
  if (session?.race && num(session.race.sec) > 0) return { score: null, label: '', completion, zone: null, speed: null, race: true };
  let zone = null;
  try { zone = Array.isArray(session?.hrSeries) && session.hrSeries.length >= 30 ? zoneCompliance(segments, session.hrSeries, profile) : null; } catch { zone = null; }
  const speed = speedAdherence(session, segments);
  let score = null;
  if (zone) score = 0.4 * cap(completion, 0.95) + 0.6 * cap(zone.pct / 100, 0.85);
  else if (speed) score = 0.6 * cap(completion, 0.95) + 0.4 * cap(speed.pct / 100, 0.9);
  if (score != null) score = Math.round(score * 100);
  const label = score == null ? '' : completion < 0.6 ? 'A medias' : score >= 90 ? 'Excelente' : score >= 75 ? 'Muy bien' : score >= 55 ? 'Correcta' : 'Floja';
  return { score, label, completion, zone, speed };
}

/** Cuánto baja el pulso en el primer minuto suave tras apretar. → null o { drop, n } */
export function hrRecovery(session, segments) {
  const pts = cleanHr(session);
  if (pts.length < 30) return null;
  const spans = segmentSpans(segments);
  const drops = [];
  spans.forEach((g, i) => {
    const next = spans[i + 1];
    if (!next || (RANK[g.zone] ?? 0) < 3 || g.sec < 30 || (RANK[next.zone] ?? 9) > 2 || next.sec < 70) return;
    const around = pts.filter((p) => p[0] >= g.b - 15 && p[0] <= g.b + 15).map((p) => p[1]);
    const after = pts.filter((p) => p[0] >= g.b + 50 && p[0] <= g.b + 70).map((p) => p[1]);
    if (around.length && after.length) drops.push(Math.max(...around) - mean(after));
  });
  if (!drops.length) return null;
  return { drop: Math.round(mean(drops)), n: drops.length };
}

/** Cuánto subió el pulso de la 1.ª a la 2.ª mitad a igual ritmo (ppm). null si la clase no permite compararlo. */
export function hrDrift(session, segments) {
  if (isHills(session) || num(session?.elapsedSec) < DRIFT_MIN_SEC) return null;
  const pts = cleanHr(session);
  if (pts.length < 60) return null;
  const spans = segmentSpans(segments);
  const tr = cleanTrace(session);
  const mid = pts[pts.length - 1][0] / 2;
  const bins = {};
  let k = 0;
  for (const [t, bpm] of pts) {
    const g = spans.find((x) => t >= x.a && t < x.b);
    if (!g || (g.zone !== 'jog' && g.zone !== 'run') || t - g.a < 120) continue;
    while (k + 1 < tr.length && tr[k + 1][0] <= t) k++;
    const v = tr.length ? tr[k][1] : g.speed;
    const b = bins[g.zone] || (bins[g.zone] = { ref: g.speed, half: [[], []] });
    b.half[t < mid ? 0 : 1].push(bpm - DRIFT_SLOPE * (v - b.ref));
  }
  let sum = 0;
  let weight = 0;
  for (const b of Object.values(bins)) {
    const w = Math.min(b.half[0].length, b.half[1].length);
    if (w < 6) continue;
    sum += (mean(b.half[1]) - mean(b.half[0])) * w;
    weight += w;
  }
  return weight ? Math.round(sum / weight) : null;
}

/* ───────── Frente a otras veces ───────── */

function pastLike(session, history) {
  if (num(session?.completionPct) < 0.85 || !(num(session?.avgSpeed) > 0)) return null;
  const t0 = sessionTime(session);
  const plan = num(session.plannedSec);
  const prior = (Array.isArray(history) ? history : [])
    .filter((x) => x && x.id !== session.id && !x.isTest && sessionTime(x) < t0 && num(x.completionPct) >= 0.85 && num(x.avgSpeed) > 0)
    .sort((a, b) => sessionTime(b) - sessionTime(a));
  const near = (x, d) => Math.abs(num(x.plannedSec) - plan) <= d;
  const same = session.templateId ? prior.find((x) => x.templateId === session.templateId && near(x, 300)) : null;
  if (same) return { mode: 'same', refs: [same] };
  const similar = session.category ? prior.filter((x) => x.category === session.category && near(x, 600)).slice(0, 3) : [];
  return similar.length ? { mode: 'similar', refs: similar } : null;
}

function compareLine(dSpeed, dHr, dRpe) {
  const faster = dSpeed >= 0.1;
  const slower = dSpeed <= -0.1;
  if (dHr != null) {
    if (faster && dHr <= -2) return { tone: 'good', text: 'Más rápido y con menos pulso: esto es forma de verdad.' };
    if (faster && dHr < 4) return { tone: 'good', text: 'Más rápido con el mismo corazón: estás ganando velocidad.' };
    if (faster) return { tone: 'neutral', text: 'Has ido más rápido, y tu corazón lo ha notado.' };
    if (!slower && dHr <= -3) return { tone: 'good', text: 'Mismo ritmo y menos pulso: tu corazón trabaja más cómodo.' };
    if (!slower && dHr >= 4) return { tone: 'warn', text: 'Mismo ritmo y más pulso: hoy te ha costado más que otras veces.' };
    if (slower && dHr >= 2) return { tone: 'warn', text: 'Más lento y con más pulso: un día de menos fuerza. Uno solo no significa nada.' };
    if (slower && dHr <= -3) return { tone: 'neutral', text: 'Has levantado el pie y tu corazón ha ido más tranquilo.' };
  }
  if (dRpe != null) {
    if (faster && dRpe <= 0) return { tone: 'good', text: 'Más rápido y sin que te cueste más.' };
    if (!slower && !faster && dRpe <= -2) return { tone: 'good', text: 'Lo mismo, y te ha costado bastante menos.' };
    if (dRpe >= 2) return { tone: 'warn', text: 'Hoy te ha costado más que otras veces.' };
  }
  if (faster) return { tone: 'good', text: 'Has ido más rápido que otras veces.' };
  if (slower) return { tone: 'neutral', text: 'Algo más lento que otras veces.' };
  return { tone: 'neutral', text: 'Muy parecida a otras veces: constancia.' };
}

const signed = (d, f) => (d ? `${d > 0 ? '+' : '−'}${f(Math.abs(d))}` : '=');

/** → null o { mode, title, rows: [{ label, unit, from, to, delta, better }], line: { tone, text } } */
export function compareWithPast(session, history) {
  const found = pastLike(session, history);
  if (!found) return null;
  const { mode, refs } = found;
  const avg = (fn) => {
    const v = refs.map(fn).filter((x) => x > 0);
    return v.length === refs.length ? mean(v) : null;
  };
  const speed0 = avg((x) => num(x.avgSpeed));
  const speed1 = num(session.avgSpeed);
  const dSpeed = r1(speed1 - speed0);
  const rows = [{ label: 'Velocidad media', unit: 'km/h', from: fmt.speed(speed0), to: fmt.speed(speed1), delta: signed(dSpeed, fmt.speed), better: dSpeed >= 0.1 ? true : dSpeed <= -0.1 ? false : null }];
  let dHr = null;
  const hr0 = avg((x) => num(x.hrAvg));
  if (hr0 && num(session.hrAvg) > 0) {
    dHr = Math.round(num(session.hrAvg) - hr0);
    rows.push({ label: 'Pulso medio', unit: 'ppm', from: fmt.int(Math.round(hr0)), to: fmt.int(session.hrAvg), delta: signed(dHr, fmt.int), better: dHr <= -2 ? true : dHr >= 2 ? false : null });
  }
  let dRpe = null;
  const rpe0 = avg((x) => num(x.rpe));
  if (rpe0 && num(session.rpe) > 0) {
    dRpe = Math.round(num(session.rpe) - rpe0);
    rows.push({ label: 'Esfuerzo', unit: '/10', from: fmt.int(Math.round(rpe0)), to: fmt.int(session.rpe), delta: signed(dRpe, fmt.int), better: dRpe <= -1 ? true : dRpe >= 1 ? false : null });
  }
  const ref = refs[0];
  const when = mode === 'same' && ref?.dayKey ? fmt.dateShort(ref.dayKey).split(' ').slice(1).join(' ') : '';
  const title = mode === 'same' ? 'Frente a la última vez' : `Frente a ${refs.length === 1 ? 'tu última clase' : `tus últimas ${refs.length}`} de ${CATEGORY_NAMES[session.category] || 'este tipo'}`;
  return { mode, title, when, rows, line: compareLine(dSpeed, dHr, dRpe) };
}

/* ───────── Dentro de la clase ───────── */

function clockMin(t) { return `Min${NB}${Math.max(1, Math.round(t / 60))}`; }

function moments(session, segments, profile, pastDrops) {
  const out = [];
  const pts = cleanHr(session);
  const spans = segmentSpans(segments);
  if (pts.length >= 30) {
    const usable = pts.filter((p) => p[0] >= 60);
    if (usable.length) {
      const [t, bpm] = usable.reduce((a, b) => (b[1] > a[1] ? b : a));
      const g = spans.find((x) => t >= x.a && t < x.b);
      const known = num(profile?.hrMax) || (num(profile?.age) ? hrMaxFromAge(num(profile.age)) : 0);
      const where = [clockMin(t), g ? ZONES[g.zone]?.short : ''].filter(Boolean).join(' · ');
      out.push({ key: 'peak', icon: 'heart', label: 'Tu pico', value: fmt.int(bpm), unit: 'ppm', note: known ? `${where} · ${Math.round((bpm / known) * 100)}${NB}% de tu máximo` : where });
    }
    const rec = hrRecovery(session, segments);
    if (rec) {
      const usual = pastDrops.length >= 2 ? Math.round(mean(pastDrops)) : null;
      const d = usual == null ? 0 : rec.drop - usual;
      out.push({
        key: 'recovery', icon: 'refresh', label: 'Recuperas', value: `−${fmt.int(Math.max(0, rec.drop))}`, unit: 'ppm/min',
        note: usual == null ? 'Lo que baja tu pulso en el primer minuto suave' : d >= 3 ? `${d} mejor que tu media` : d <= -3 ? `${-d} menos que tu media` : 'En tu media',
        tone: usual == null ? null : d >= 3 ? 'good' : d <= -3 ? 'warn' : null,
      });
    }
    const drift = hrDrift(session, segments);
    if (drift != null) {
      out.push({
        key: 'drift', icon: 'timer', label: 'Aguante', value: drift > 0 ? `+${drift}` : drift < 0 ? `−${-drift}` : '0', unit: 'ppm',
        note: drift <= 3 ? 'Pulso estable de principio a fin' : drift < 10 ? 'Subida normal en la segunda mitad' : 'Se te disparó al final: calor, cansancio o poca agua',
        tone: drift <= 3 ? 'good' : drift < 10 ? null : 'warn',
      });
    }
  }
  if (out.length < 3) {
    const hardSec = num(session?.timeInZone?.fast) + num(session?.timeInZone?.sprint);
    if (hardSec >= 30) out.push({ key: 'intense', icon: 'flame', label: 'A tope', value: fmt.clock(hardSec), unit: 'min', note: 'Entre Rápido y Sprint' });
  }
  if (out.length < 3 && num(session?.maxSpeed) > 0) {
    const tr = cleanTrace(session);
    const first = tr.find((p) => p[1] >= num(session.maxSpeed) - 1e-6);
    out.push({ key: 'top', icon: 'bolt', label: 'Velocidad punta', value: fmt.speed(session.maxSpeed), unit: 'km/h', note: first ? clockMin(first[0]) : '' });
  }
  if (out.length < 3) {
    const adj = Object.entries(session?.adjustments || {}).filter(([, v]) => Math.abs(num(v)) >= 0.2).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
    if (adj) out.push({ key: 'manual', icon: 'gauge', label: 'A tu mano', value: `${adj[1] > 0 ? '+' : '−'}${fmt.speed(Math.abs(adj[1]))}`, unit: 'km/h', note: `Lo retocaste en ${ZONES[adj[0]]?.short || adj[0]}` });
  }
  return out.slice(0, 3);
}

/* ───────── Lo que viene ───────── */

function loadVersusUsual(session, history) {
  const t0 = sessionTime(session);
  const prior = (Array.isArray(history) ? history : [])
    .filter((x) => x && x.id !== session.id && !x.isTest && sessionTime(x) < t0 && countsAsSession(x))
    .sort((a, b) => sessionTime(b) - sessionTime(a))
    .slice(0, 8);
  if (prior.length < 3) return null;
  const usual = mean(prior.map(sessionLoad));
  if (!(usual > 0)) return null;
  const pct = Math.round((sessionLoad(session) / usual - 1) * 100);
  return {
    pct,
    text: pct >= 25 ? `Un ${pct}${NB}% más de carga que tu clase típica.` : pct <= -25 ? `Un ${-pct}${NB}% menos de carga que tu clase típica.` : 'Una carga en tu línea de siempre.',
    level: pct >= 25 ? 'high' : pct <= -25 ? 'low' : 'usual',
  };
}

/** Siguiente clase del plan después de `fromKey`. → null o { date, title, minutes, category, days } */
export function nextPlanned(state, fromKey, now = new Date()) {
  for (let i = 1; i <= 8; i++) {
    const date = addDays(fromKey, i);
    let d = null;
    try { d = planDay(state, date, now); } catch { d = null; }
    if (d && d.kind !== 'rest' && d.workout && d.status !== 'done') {
      return { date, title: d.workout.title || 'Clase', minutes: Math.round(num(d.workout.totalSec) / 60), category: d.workout.category || null, days: daysBetween(fromKey, date), isTest: d.kind === 'test' };
    }
  }
  return null;
}

function nextHint(next, load, session) {
  if (!next) return '';
  const hard = HARD_CATS.has(next.category) || next.isTest;
  const easyToday = EASY_CATS.has(session?.category);
  if (next.isTest) return next.days >= 2 ? 'Es test: llega con ganas y sin apretar antes.' : 'Es test: cena bien y duerme, que vamos a medir lo que has mejorado.';
  if (load?.level === 'high' && next.days <= 1) return hard ? 'Hoy has cargado más de lo normal: duerme bien, mañana también aprieta.' : 'Hoy has cargado más de lo normal y mañana toca suave: justo lo que necesitas.';
  if (easyToday && hard) return 'Hoy has guardado piernas para esto.';
  if (next.days >= 3) return `Tienes ${next.days} días para asimilar lo de hoy.`;
  return '';
}

/* ───────── Todo junto ───────── */

function goalLine(session, ex) {
  const cat = session?.category;
  const purpose = PURPOSE[cat] || '';
  const zone = ex.zone;
  const high = zone?.sec ? (zone.highSec / zone.sec) * 100 : 0;
  const low = zone?.sec ? (zone.lowSec / zone.sec) * 100 : 0;
  if (ex.completion < 0.6) return { purpose, met: false, text: 'Se ha quedado a medias, pero cada minuto suma.' };
  if (EASY_CATS.has(cat) && high >= 30) return { purpose, met: false, text: 'Hoy tocaba suave y tu pulso ha ido alto. Ir más lento estos días es lo que luego te hace ir más rápido.' };
  if (HARD_CATS.has(cat) && low >= 40) return { purpose, met: false, text: 'Tenías margen: tu pulso no ha llegado a donde pedía la clase.' };
  if (HARD_CATS.has(cat) && high >= 40) return { purpose, met: true, text: 'Le has dado por encima de lo que pedía: suma, pero cuesta más asimilarlo.' };
  if (zone ? zone.pct >= 60 : (ex.speed?.pct ?? 0) >= 80) return { purpose, met: true, text: EASY_CATS.has(cat) ? 'Justo lo que tocaba: suave de verdad.' : 'Objetivo cumplido.' };
  return { purpose, met: null, text: '' };
}

function checksOf(ex) {
  const out = [{ key: 'done', label: 'Completada', value: `${Math.round(ex.completion * 100)}${NB}%`, state: ex.completion >= 0.9 ? 'ok' : 'warn', sub: '' }];
  if (ex.speed) {
    const { pct, belowPct, abovePct } = ex.speed;
    out.push({
      key: 'speed', label: 'A la velocidad prevista', value: `${pct}${NB}%`, state: pct >= 80 ? 'ok' : 'warn',
      sub: belowPct >= 10 && belowPct >= abovePct ? `Por debajo el ${belowPct}${NB}% del trabajo` : abovePct >= 10 ? `Por encima el ${abovePct}${NB}% del trabajo` : '',
    });
  }
  if (ex.zone) {
    const hi = Math.round((ex.zone.highSec / ex.zone.sec) * 100);
    const lo = Math.round((ex.zone.lowSec / ex.zone.sec) * 100);
    out.push({
      key: 'zone', label: 'En tu zona de pulso', value: `${ex.zone.pct}${NB}%`, state: ex.zone.pct >= 60 ? 'ok' : 'warn',
      sub: hi >= 15 && hi >= lo ? `Por encima el ${hi}${NB}%` : lo >= 15 ? `Por debajo el ${lo}${NB}%` : '',
    });
  }
  return out;
}

/** Bajadas de pulso típicas de las últimas clases con reloj (para comparar la recuperación de hoy). */
function pastRecoveries(session, history, segmentsOf) {
  const t0 = sessionTime(session);
  const out = [];
  const prior = (Array.isArray(history) ? history : [])
    .filter((x) => x && x.id !== session.id && !x.isTest && sessionTime(x) < t0 && Array.isArray(x.hrSeries) && x.hrSeries.length >= 30)
    .sort((a, b) => sessionTime(b) - sessionTime(a));
  for (const x of prior) {
    if (out.length >= 8) break;
    const r = hrRecovery(x, segmentsOf(x));
    if (r) out.push(r.drop);
  }
  return out;
}

/**
 * → null (tests: tienen su propia tarjeta) o
 * { execution, checks, goal, lead, headline, tip, compare, moments, load, next, nextHint }.
 * debrief: el de class-debrief.js (titular y día alto o bajo) · showNext: solo tiene sentido en la clase de hoy.
 */
export function classAnalysis(session, { state = null, debrief = null, segments = null, showNext = false, now = new Date() } = {}) {
  if (!session || session.isTest) return null;
  const history = Array.isArray(state?.history) ? state.history : [];
  const segs = segments || segmentsOfSession(state, session);
  const profile = state?.profile || {};
  // Carrera en la cinta: la carrera se cuenta aparte del calentamiento y de la vuelta a la calma (race-report.js)
  let race = null;
  try { race = session.race ? raceReport(session, segs) : null; } catch { race = null; }
  if (race) {
    const d = raceDebrief(race, { hrMax: profile.hrMax || null, feeling: session.feeling });
    const load = loadVersusUsual(session, history);
    const next = showNext && session.dayKey ? nextPlanned(state, session.dayKey, now) : null;
    return {
      race, execution: executionOf(session, segs, profile), checks: [], goal: { text: '', purpose: '' },
      headline: d.headline, lead: d.body, tip: d.tip, compare: null, moments: [], load, next, nextHint: nextHint(next, load, session),
    };
  }
  const execution = executionOf(session, segs, profile);
  const goal = goalLine(session, execution);
  const compare = compareWithPast(session, history);
  const load = loadVersusUsual(session, history);
  const next = showNext && session.dayKey ? nextPlanned(state, session.dayKey, now) : null;
  const daySentence = debrief && (debrief.kind === 'high' || debrief.kind === 'low') ? String(debrief.body || '').split('. ')[0].replace(/\.?$/, '.') : '';
  const lead = [daySentence, goal.text].filter(Boolean).join(' ');
  let list = [];
  try { list = moments(session, segs, profile, pastRecoveries(session, history, (x) => segmentsOfSession(state, x))); } catch { list = []; }
  return {
    execution,
    checks: checksOf(execution),
    goal,
    headline: debrief?.headline || (execution.completion >= 0.9 ? 'Clase hecha' : 'Clase a medias, y cuenta'),
    lead,
    tip: debrief?.kind === 'onpoint' && !(session.levelChanges || []).length ? '' : debrief?.tip || '', // «clavada» ya lo dice el titular
    compare,
    moments: list,
    load,
    next,
    nextHint: nextHint(next, load, session),
  };
}
