// RITMUP · AMRAP en la cinta («tantas rondas como puedas»), sin DOM: lo usan el motor, el generador, las plantillas,
// el reproductor y el resumen.
//
// Un tramo AMRAP es UN segmento de la clase cuya duración es el TOPE (`sec = cap`): la posición en la clase, el tiempo
// que queda, la música, el coach y la escena 3D siguen la misma línea de tiempo de siempre. Dentro, el motor lleva las
// rondas: una parte de TRABAJO que acaba por METROS y una RECUPERACIÓN por tiempo o por metros. La app no sabe a qué
// velocidad vas de verdad (la del reloj no es fiable): los metros son velocidad de la clase × tiempo, así que si subes la
// cinta tienes que subirla también en la app con + / −; entonces cada parte se acaba antes y caben más rondas.
//
//   segment.amrap = { workM, workSpeed, workZone, restSec | restM, restSpeed, restZone, step }
//   (step: km/h que sube el trabajo en cada ronda nueva; 0 = siempre igual)
import { round1 } from '../core/utils.js';
import { ZONES } from './levels.js';

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Copia limpia de la definición AMRAP de un tramo (o null si no es válida). */
export function normAmrap(a, seg = {}) {
  if (!a || typeof a !== 'object') return null;
  const workM = Math.round(num(a.workM));
  if (!(workM >= 50)) return null;
  const restSec = Math.max(0, Math.round(num(a.restSec)));
  const restM = restSec > 0 ? 0 : Math.max(0, Math.round(num(a.restM)));
  const workSpeed = round1(num(a.workSpeed, num(seg.speed)));
  const restSpeed = round1(num(a.restSpeed, workSpeed));
  if (!(workSpeed > 0) || !(restSpeed > 0)) return null;
  return {
    workM,
    workSpeed,
    workZone: ZONES[a.workZone] ? a.workZone : 'fast',
    ...(restSec > 0 ? { restSec } : restM > 0 ? { restM } : {}),
    restSpeed,
    restZone: ZONES[a.restZone] ? a.restZone : 'jog',
    step: Math.max(0, Math.min(1, round1(num(a.step)))),
  };
}

/** Segundos que se tardan `m` metros a `kmh`. */
export const secForM = (m, kmh) => (kmh > 0 ? (m * 3.6) / kmh : Infinity);

/**
 * Lo que sale si corres la AMRAP tal como viene (sin tocar la velocidad): rondas, metros de la última sin acabar y el
 * tiempo que pasas trabajando y recuperando. → { rounds, extraM, workSec, restSec, km, topSpeed }
 */
export function amrapExpected(seg) {
  const a = seg?.amrap;
  const cap = num(seg?.sec);
  const out = { rounds: 0, extraM: 0, workSec: 0, restSec: 0, km: 0, topSpeed: 0 };
  if (!a || !(cap > 0)) return out;
  let t = 0;
  let v = a.workSpeed;
  for (let guard = 0; t < cap - 1e-6 && guard < 500; guard++) {
    const w = secForM(a.workM, v);
    out.topSpeed = Math.max(out.topSpeed, v);
    if (t + w > cap) {
      const d = cap - t;
      out.workSec += d; out.km += (v * d) / 3600; out.extraM = Math.floor((v * d) / 3.6);
      t = cap;
      break;
    }
    t += w; out.workSec += w; out.km += a.workM / 1000; out.rounds++;
    const r = a.restSec > 0 ? a.restSec : a.restM > 0 ? secForM(a.restM, a.restSpeed) : 0;
    const d = Math.min(r, cap - t);
    t += d; out.restSec += d; out.km += (a.restSpeed * d) / 3600;
    v = round1(v + (a.step || 0));
  }
  return out;
}

/** «400 m a 11,5 + 60 s de trote» (texto corto de una ronda). */
export function amrapRoundText(a, fmtSpeed = (v) => String(v).replace('.', ',')) {
  if (!a) return '';
  const rest = a.restSec > 0 ? `${a.restSec} s` : a.restM > 0 ? `${a.restM} m` : '';
  const zone = (z) => (ZONES[z]?.short || ZONES[z]?.name || '').toLowerCase();
  return `${a.workM} m ${zone(a.workZone)} ${fmtSpeed(a.workSpeed)}${rest ? ` + ${rest} ${zone(a.restZone)}` : ''}`;
}

/** «7 rondas + 120 m» · «1 ronda» · «0 rondas + 250 m». */
export function amrapResultText(r) {
  const n = Math.max(0, Math.round(num(r?.rounds)));
  const m = Math.max(0, Math.round(num(r?.extraM)));
  return `${n} ${n === 1 ? 'ronda' : 'rondas'}${m > 0 ? ` + ${m} m` : ''}`;
}

/** Puntuación comparable de un resultado: rondas enteras más la fracción de la siguiente. */
export function amrapScore(r) {
  const w = Math.max(1, num(r?.workM, 1));
  return Math.max(0, num(r?.rounds)) + Math.min(0.999, Math.max(0, num(r?.extraM)) / w);
}

/** Firma de un bloque para compararlo con la última vez: misma plantilla, tope, metros y recuperación. */
export function amrapSig(templateId, r) {
  return `${templateId || ''}|${Math.round(num(r?.cap))}|${Math.round(num(r?.workM))}|${Math.round(num(r?.restSec))}|${Math.round(num(r?.restM))}|${num(r?.index, 0)}`;
}

/**
 * Récord y última vez de cada bloque de una sesión con AMRAP frente al historial (sesiones anteriores, sin la propia).
 * → [{ ...resultado, best: resultado | null, last: resultado | null, isRecord }]
 */
export function amrapCompare(session, history = []) {
  const blocks = Array.isArray(session?.amrap) ? session.amrap : [];
  if (!blocks.length) return [];
  const prev = (Array.isArray(history) ? history : [])
    .filter((h) => h && h !== session && h.id !== session.id && Array.isArray(h.amrap) && h.amrap.length
      && h.templateId === session.templateId && String(h.startedAt || '') < String(session.startedAt || '￿'))
    .sort((a, b) => (String(a.startedAt) < String(b.startedAt) ? -1 : 1));
  return blocks.map((r) => {
    const sig = amrapSig(session.templateId, r);
    let best = null;
    let last = null;
    for (const h of prev) {
      for (const x of h.amrap) {
        if (amrapSig(h.templateId, x) !== sig || x.skipped) continue;
        last = x;
        if (!best || amrapScore(x) > amrapScore(best)) best = x;
      }
    }
    return { ...r, best, last, isRecord: !r.skipped && !!best && amrapScore(r) > amrapScore(best) + 1e-9 };
  });
}
