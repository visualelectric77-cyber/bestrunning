// RITMUP · «Tu clase»: qué ha pasado hoy, con tus datos y sin IA (solo cálculos; nunca una cifra que no esté medida).
// Con pulso: cómo iba tu corazón frente a lo normal en ti, tiempo en zona, máximo y lo que la app te cambió.
// Sin pulso: la sensación y lo completado, para que quien no lleve reloj también reciba algo útil.
import { fmt } from '../core/utils.js';
import { classInputs, simulate } from './hr-dynamics.js';
import { zoneCompliance } from './hr-shape.js';

const WORK = new Set(['jog', 'run', 'fast', 'sprint']);
const HARD_FEEL = new Set(['hard', 'max', 'fail']);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const MIN_CHANGE = 0.3;     // km/h: por debajo no se considera que la app te haya cambiado el tramo

// Cuánto se apartó tu pulso de lo típico en ti, de media (sin los 2 primeros minutos). Para contarlo hace falta una
// diferencia clara: con pocas clases el modelo aún oscila unas pocas ppm y no se debe llamar «día alto» a eso.
const DAY_CLEAR = 8;
function dayBias(session, segments, model) {
  if (!model || model.starter || !Array.isArray(segments)) return null;
  const inp = classInputs(session, segments);
  const hr0 = inp?.hr.find((x) => x != null);
  if (hr0 == null) return null;
  const sim = simulate(model, model.aTypical, inp, hr0);
  let sum = 0;
  let n = 0;
  inp.hr.forEach((h, k) => { if (h != null && inp.t[k] >= 120) { sum += h - sim[k]; n++; } });
  if (n < 24) return null;
  const bias = sum / n;
  const clear = Math.max(DAY_CLEAR, 1.5 * (Number(model.aSpread) || 0));
  return { bias, high: bias >= clear, low: bias <= -clear };
}

/** Lo que se apartó tu velocidad real de la planeada, tramo a tramo. → { down, up } (km/h, el mayor de cada sentido) */
function speedChanges(session, segments) {
  const tr = (Array.isArray(session?.speedTrace) ? session.speedTrace : []).filter((p) => Array.isArray(p));
  if (tr.length < 2 || !Array.isArray(segments)) return { down: 0, up: 0 };
  const speedAt = (t) => { let v = tr[0][1]; for (const p of tr) { if (p[0] <= t) v = p[1]; else break; } return v; };
  const end = tr[tr.length - 1][0];
  let t0 = 0;
  let down = 0;
  let up = 0;
  for (const g of segments) {
    const sec = num(g?.sec);
    const a = t0;
    t0 += sec;
    if (!WORK.has(g?.zone) || sec < 30 || a + sec / 2 >= end) continue;
    const diff = speedAt(a + sec * 0.75) - num(g.speed);
    if (diff <= -MIN_CHANGE) down = Math.max(down, -diff);
    if (diff >= MIN_CHANGE) up = Math.max(up, diff);
  }
  return { down: Math.round(down * 10) / 10, up: Math.round(up * 10) / 10 };
}

/**
 * → null (tests: tienen su propia tarjeta) o { kind, headline, body, tip, hrN }.
 * kind: 'high' | 'low' | 'onpoint' | 'hard' | 'under' | 'usual' | 'nohr'.
 */
export function classDebrief(session, { segments = null, model = null, profile = null } = {}) {
  const s = session;
  if (!s || s.isTest) return null;
  const series = Array.isArray(s.hrSeries) ? s.hrSeries : [];
  const hrN = series.length;
  const levelDown = (Array.isArray(s.levelChanges) ? s.levelChanges : []).some((c) => num(c.to) < num(c.from));
  const levelUp = (Array.isArray(s.levelChanges) ? s.levelChanges : []).some((c) => num(c.to) > num(c.from));

  if (hrN < 30) {
    const hard = HARD_FEEL.has(s.feeling);
    const min = Math.round(num(s.elapsedSec) / 60);
    const pct = Math.round(num(s.completionPct) * 100);
    return {
      kind: 'nohr', hrN,
      headline: pct < 85 ? 'Clase a medias, y cuenta' : hard ? 'Una clase dura' : 'Clase hecha',
      body: `${min} min y ${fmt.km(num(s.distanceKm))} km a ${fmt.speed(num(s.avgSpeed))} km/h de media.`,
      tip: levelUp ? 'Has subido de nivel: tus próximas clases irán un poco más rápido.' : hard ? 'Descansa bien antes de la siguiente.' : 'Con el pulso del reloj podríamos decirte mucho más.',
    };
  }

  const bpm = series.map((p) => num(p[1])).filter((v) => v >= 40 && v <= 230);
  const peak = Math.round(Math.max(num(s.hrMax), ...bpm));
  let zone = null;
  try { zone = Array.isArray(segments) ? zoneCompliance(segments, series, profile) : null; } catch { zone = null; }
  const pct = (x) => (zone?.sec > 0 ? Math.round((num(x) / zone.sec) * 100) : null);
  const inPct = zone ? pct(zone.inSec) : null;
  const highPct = zone ? pct(zone.highSec) : null;
  const lowPct = zone ? pct(zone.lowSec) : null;
  let day = null;
  try { day = dayBias(s, segments, model); } catch { day = null; }
  const by = day ? Math.abs(Math.round(day.bias)) : 0;
  const ch = speedChanges(s, segments);

  let kind = 'usual';
  if (day?.high) kind = 'high';
  else if (day?.low) kind = 'low';
  else if (inPct != null && inPct >= 70) kind = 'onpoint';
  else if (highPct != null && highPct >= 35 && highPct > lowPct) kind = 'hard';
  else if (lowPct != null && lowPct >= 35) kind = 'under';

  const parts = [];
  if (kind === 'high') parts.push(`A igual esfuerzo, tu pulso iba unas ${by} ppm por encima de lo normal en ti.`);
  if (kind === 'low') parts.push(`A igual esfuerzo, tu pulso iba unas ${by} ppm por debajo de lo normal en ti.`);
  parts.push(inPct != null ? `Estuviste el ${inPct} % del trabajo en tu zona y llegaste a ${peak} ppm.` : `Llegaste a ${peak} ppm.`);
  if (ch.down) parts.push(`La velocidad llegó a estar ${fmt.speed(ch.down)} km/h por debajo de lo previsto.`);
  else if (ch.up) parts.push(`La velocidad llegó a estar ${fmt.speed(ch.up)} km/h por encima de lo previsto.`);

  const headline = {
    high: 'Hoy tu pulso iba alto', low: 'Hoy ibas con margen', onpoint: 'Clase clavada a tu zona',
    hard: 'Tu pulso fue por encima de tu zona', under: 'Tu pulso se quedó bajo', usual: 'Clase en tu línea',
  }[kind];
  let tip = {
    high: 'Un día así no dice nada de tu forma: tus velocidades no cambian.',
    low: 'Buen día: tu corazón ha trabajado con menos esfuerzo que otras veces.',
    onpoint: 'Justo la intensidad que buscaba esta clase.',
    hard: 'Llega descansado a la siguiente: contará más.',
    under: 'Si te notabas bien, no pasa nada: hay días en que el pulso va más tranquilo.',
    usual: 'Sigue así: la constancia es lo que te hace mejorar.',
  }[kind];
  if (levelDown) tip = 'Hemos suavizado tus velocidades para las próximas clases.';
  else if (levelUp) tip = 'Has subido de nivel: tus próximas clases irán un poco más rápido.';
  return { kind, hrN, headline, body: parts.join(' '), tip };
}

/** ¿Conviene aligerar lo que viene? Solo tras un día alto o una clase que notaste dura. */
export function wantsEasierNext(debrief, session) {
  return !!debrief && !session?.isTest && (debrief.kind === 'high' || HARD_FEEL.has(session?.feeling));
}

/* ───────── Resumen con IA cuando no hay pulso (tarea 'sessionSummary' del iPhone) ───────── */

const KIND = {
  intervals: 'intervalos (tramos rápidos con recuperaciones)', tempo: 'tempo (ritmo firme sostenido)',
  endurance: 'resistencia (ritmo cómodo)', fartlek: 'fartlek (cambios de ritmo)', hills: 'cuestas',
  recovery: 'recuperación (clase suave)', challenge: 'reto', race: 'carrera en la cinta',
};
// De qué va el consejo cuando la clase salió sin nada que contar: lo propio de ese tipo de clase
const KIND_TIP = {
  intervals: 'cómo recuperar entre los tramos rápidos para que el último salga como el primero',
  tempo: 'cómo sostener el ritmo firme sin salir demasiado fuerte',
  endurance: 'llevar un ritmo cómodo, al que podría hablar, para hacer base',
  fartlek: 'cómo repartir las fuerzas entre los cambios de ritmo',
  hills: 'cómo subir las cuestas: zancada corta y sin agarrarse a la barra',
  recovery: 'no subir la velocidad en las clases suaves, aunque apetezca',
  challenge: 'repartir las fuerzas en un reto: de menos a más',
  race: 'repartir el ritmo de carrera: de menos a más',
};

/** De qué debe ir el consejo de ESTA clase (frase para la IA, sin cifras): manda lo que pasó, y si no pasó nada, el tipo. */
function tipAbout({ unfinished, feeling, raised, lowered, levelUp, levelDown, category }) {
  const beat = feeling === 'max' || feeling === 'fail';
  if (unfinished) return beat
    ? 'La dejó antes de acabar y le costó mucho. Sin reproches: que la próxima la empiece más suave y baje con el botón menos en cuanto lo note.'
    : 'La dejó antes de acabar. Sin reproches: que la próxima la empiece un punto más suave o elija una más corta.';
  if (beat) return lowered
    ? 'Le costó mucho aunque bajó la velocidad: que llegue descansado a la próxima y la empiece con calma.'
    : 'Le costó mucho: que en la próxima baje un punto con el botón menos en los tramos duros si lo necesita.';
  if (levelDown) return 'Sus velocidades bajan un poco para las próximas clases: es un ajuste para que las termine bien, no un paso atrás.';
  if (lowered) return 'Bajó la velocidad durante la clase: está bien ajustar; que la próxima intente aguantar un tramo más a la velocidad prevista.';
  if (levelUp) return 'Sube de nivel: la próxima clase irá un poco más rápida; que la empiece con calma.';
  if (raised) return feeling === 'hard'
    ? 'Subió la velocidad y le resultó exigente: que la próxima la haga a la velocidad prevista.'
    : 'Subió la velocidad y la llevó bien: que mantenga esa subida en la próxima.';
  if (feeling === 'easy') return 'Le resultó muy fácil: que en la próxima suba un punto con el botón más en los tramos fuertes.';
  return `La hizo como estaba prevista. El consejo trata de ${KIND_TIP[category] || 'cómo llegar con ganas a la próxima clase de su plan'}.`;
}

/**
 * Datos del resumen que escribe la IA del iPhone (solo se usa cuando no hay pulso). La IA solo redacta: aquí va lo que
 * hace distinta ESTA clase (tipo, cómo se completó, sensación, ajustes de velocidad) y de qué debe ir el consejo
 * (`tipAbout`), para que no salga siempre el mismo. Puro: sin DOM ni red.
 * opts: segments (tramos de la clase) · feel (texto de la sensación) · record · hrOffset ({ ppm, speed } o null).
 * → { input, allowed } · allowed: las únicas cifras que el texto puede traer (ai.numbersAreGrounded).
 */
export function summaryAiInput(session, { segments = null, feel = '', record = false, hrOffset = null } = {}) {
  const s = session || {};
  const r1 = (x) => Math.round(num(x) * 10) / 10;
  const input = {
    title: s.title || '',
    minutes: Math.round(num(s.elapsedSec) / 60),
    km: Math.round(num(s.distanceKm) * 100) / 100,
    avgKmh: r1(s.avgSpeed),
    maxKmh: r1(s.maxSpeed),
    feel: feel || '',
    record: !!record,
  };
  if (KIND[s.category]) input.type = KIND[s.category];
  if (num(s.rpe) > 0) input.effort = Math.round(num(s.rpe));

  // Cómo se completó
  const pct = Math.round(num(s.completionPct) * 100);
  const unfinished = !!s.finishedEarly || (pct > 0 && pct < 85) || (s.completed === false && pct < 100);
  input.finished = !unfinished;
  if (unfinished) {
    if (pct > 0 && pct < 100) input.completedPct = pct;
    if (num(s.plannedSec) > 0) input.plannedMinutes = Math.round(num(s.plannedSec) / 60);
  }

  // Ajustes de velocidad: lo que subiste o bajaste con los botones (por zona) o, si no consta, lo que se apartó el trazado
  const adj = Object.values(s.adjustments && typeof s.adjustments === 'object' ? s.adjustments : {}).map(num).filter(Boolean);
  let raised = adj.length ? Math.max(0, ...adj) : 0;
  let lowered = adj.length ? Math.max(0, ...adj.map((v) => -v)) : 0;
  if (!adj.length) {
    const ch = speedChanges(s, segments);
    raised = ch.up;
    lowered = ch.down;
  }
  raised = r1(raised);
  lowered = r1(lowered);
  if (raised) input.raisedKmh = raised;
  if (lowered) input.loweredKmh = lowered;
  if (!raised && !lowered) input.speedAsPlanned = true;

  if (num(s.hrAvg) > 0) input.hrAvg = s.hrAvg;
  if (num(s.hrMax) > 0) input.hrMax = s.hrMax;
  if (hrOffset && Math.abs(num(hrOffset.ppm)) >= 5) input.vsPrev = { hrVsUsual: hrOffset.ppm, atKmh: hrOffset.speed };
  const lc = (Array.isArray(s.levelChanges) ? s.levelChanges : []).map((c) => ({ level: c.level, from: c.from, to: c.to }));
  if (lc.length) input.levelChanges = lc;

  input.tipAbout = tipAbout({
    unfinished, feeling: s.feeling, raised: raised > 0, lowered: lowered > 0, category: s.category,
    levelUp: lc.some((c) => num(c.to) > num(c.from)), levelDown: lc.some((c) => num(c.to) < num(c.from)),
  });

  const allowed = [input.minutes, input.km, input.avgKmh, input.maxKmh, input.hrAvg, input.hrMax, input.effort,
    input.effort ? 10 : null, input.completedPct, input.plannedMinutes, input.raisedKmh, input.loweredKmh,
    hrOffset ? hrOffset.ppm : null, hrOffset ? Math.abs(num(hrOffset.ppm)) : null, hrOffset ? hrOffset.speed : null,
    ...lc.flatMap((c) => [c.from, c.to])].filter((v) => v != null);
  return { input, allowed };
}
