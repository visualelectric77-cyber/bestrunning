// RITMUP · el modo pulso aprende de tu sensación (sin DOM, reglas fijas, sin IA).
//
// Por qué: la sensación al acabar y el pulso suelen coincidir en los días suaves y en los muy duros, pero hay quien
// marca «Cómodo» clases en las que el pulso pasa muchos minutos en zona alta, y ahí el modo pulso le recortaba los tramos
// de calidad aunque fuera bien. Dos causas:
//   1. Su techo de pulso real en los tramos de calidad está por encima del de la tabla: si las clases en las que el
//      pulso dice «duro» las marca «Cómodo», la app le deja más margen la próxima vez (effortTolerance).
//   2. En las clases largas el pulso sube solo con los minutos aunque el esfuerzo no cambie (deriva cardiaca): pasada
//      la media hora, el techo de los tramos de trabajo sube poco a poco (driftAllowance).
// Frenos: solo en los tramos de calidad (correr y rápido; en el trote solo la deriva y solo en rodajes de más de 3 min,
// nunca en las recuperaciones), nunca con el semáforo de recuperación en rojo (en ámbar sí: lo que tú sientes en clase
// pesa más que un aviso suave de Salud) y nunca por encima de tu FC máxima menos un margen. Si una clase la marcas
// «Al límite» o «No pude», el margen baja enseguida.

export const TOL_MAX = 8;        // ppm de margen como mucho
const TOL_STEP = 2;              // ppm por cada punto de diferencia entre lo que dice el pulso y lo que sentiste
const WINDOW_DAYS = 35;
const MAX_SESSIONS = 8;          // las últimas 8 clases «duras por pulso»
const HARD_SEC = 300;            // ≥ 5 min en Z4–Z5 = el pulso dice que fue dura
const SCORE = { easy: 2, ok: 1, hard: 0, max: -2, fail: -3 };
const DRIFT_FROM_MIN = 25;       // la deriva empieza a contar pasada la media hora larga
const DRIFT_PPM_MIN = 0.25;      // ppm por minuto (la deriva típica ronda 0,5 ppm/min: la mitad, por prudencia)
const DRIFT_MAX = 6;
const CEIL = { run: 8, fast: 2, jog: 20 };   // techo absoluto: tu FC máx. menos esto
const REC_MAX_SEC = 180;         // hasta 3 min, un trote es una recuperación: ahí no se da margen

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Cuánto margen de pulso merece tu sensación. history: las sesiones guardadas. Cuenta las clases de los últimos 35 días
 * (sin tests) en las que el pulso dijo «dura» (≥ 5 min en Z4–Z5) o el modo pulso te bajó la velocidad, y que tienen tu
 * sensación. → { ppm (0…8), n (clases contadas), score }
 */
export function effortTolerance(history, { now = Date.now() } = {}) {
  const since = num(now) - WINDOW_DAYS * 86400000;
  const list = (Array.isArray(history) ? history : []).filter((h) => {
    if (!h || h.isTest || !(h.feeling in SCORE)) return false;
    const t = Date.parse(h.startedAt || (h.dayKey ? `${h.dayKey}T12:00:00Z` : ''));
    if (!(t >= since)) return false;
    const z = h.hrZones && typeof h.hrZones === 'object' ? h.hrZones : {};
    const hiSec = num(z.z4) + num(z.z5);
    const cut = Object.values(h.hrCoachAdj && typeof h.hrCoachAdj === 'object' ? h.hrCoachAdj : {}).some((v) => num(v) < 0);
    return hiSec >= HARD_SEC || cut;
  }).sort((a, b) => String(a.startedAt || a.dayKey).localeCompare(String(b.startedAt || b.dayKey))).slice(-MAX_SESSIONS);
  if (!list.length) return { ppm: 0, n: 0, score: 0 };
  // Lo más reciente manda: si la última dura fue «Al límite» o «No pude», sin margen
  const last = list[list.length - 1].feeling;
  const score = list.reduce((a, h) => a + SCORE[h.feeling], 0);
  const ppm = last === 'max' || last === 'fail' ? 0 : clamp(score * TOL_STEP, 0, TOL_MAX);
  return { ppm, n: list.length, score };
}

/** Margen por deriva cardiaca a los `elapsedSec` segundos de clase. → ppm (0…6) */
export function driftAllowance(elapsedSec) {
  const min = num(elapsedSec) / 60;
  return Math.round(clamp((min - DRIFT_FROM_MIN) * DRIFT_PPM_MIN, 0, DRIFT_MAX));
}

/**
 * Zona objetivo de un tramo con el margen aprendido y la deriva. target: { min, max, … } (hrTargetForZone, ya con el
 * semáforo de recuperación); seg: { zone, sec }; tol: effortTolerance; elapsedSec: segundos de clase; hrMax.
 * baseMax: el techo de la zona ANTES del semáforo: en ámbar el margen puede deshacer el recorte pero no pasar de ahí.
 * hrMaxKnown: ¿la FC máxima es la del perfil (medida o puesta por la persona)? Si es la estimada por la edad (falla
 * ±10 ppm), el margen aprendido no se aplica: solo la deriva. pushy: «Entreno exigente» (margen completo, 8 ppm);
 * sin él, la mitad (4).
 * → el mismo objeto si no toca nada, o uno nuevo con max más alto y `learned` (ppm añadidos).
 */
export function withEffortMargin(target, seg, { tol = null, elapsedSec = 0, hrMax = 0, baseMax = null, hrMaxKnown = true, pushy = true } = {}) {
  if (!target || !(target.max > target.min) || target.capped === 'red' || !seg) return target;
  const zone = seg.zone;
  if (!(zone in CEIL)) return target;
  const rec = zone === 'jog';
  if (rec && !(num(seg.sec) > REC_MAX_SEC)) return target;
  const learned = rec || !hrMaxKnown ? 0 : Math.min(num(tol?.ppm), pushy ? TOL_MAX : TOL_MAX / 2);
  const add = learned + driftAllowance(elapsedSec);
  if (!(add > 0)) return target;
  let ceil = num(hrMax) > 100 ? num(hrMax) - CEIL[zone] : Infinity;
  if (target.capped === 'amber' && num(baseMax) > 0) ceil = Math.min(ceil, num(baseMax));
  const max = Math.min(target.max + add, Math.max(target.max, ceil));
  if (!(max > target.max)) return target;
  return { ...target, max: Math.round(max), learned: Math.round(max - target.max) };
}
