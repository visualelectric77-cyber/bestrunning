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
