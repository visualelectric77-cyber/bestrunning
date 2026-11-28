// RITMUP · «¿Cómo vas?» durante la clase (sin DOM, reglas fijas). El pulso dice cómo va el corazón; esto pregunta cómo
// va la cabeza y las piernas. Lo pregunta Lucía en voz alta (corriendo no da tiempo a leer) y se contesta con tres
// botones enormes: «Sobrado», «Bien», «Voy mal».
//   · Sobrado: +0,3 km/h en los SIGUIENTES tramos de calidad de esa misma zona y más margen de pulso (+2, como mucho 8)
//     para el resto de la clase. Nunca pasa de los techos de effort-learn.js ni toca recuperaciones, trotes ni la
//     vuelta a la calma (calmCaps, jogFloor siguen igual).
//   · Bien: nada (queda anotado).
//   · Voy mal: −0,3 km/h en esos mismos tramos, enseguida, y fuera el margen de pulso aprendido.
//   · Sin respuesta en 15 s: no cambia nada.
// Cuándo pregunta: NUNCA mientras corres rápido o esprintas (vas en una cinta). Solo al empezar una recuperación o un
// trote de 45 s o más que viene justo después de un tramo de calidad (correr o rápido), y solo si después quedan más
// tramos de esa zona (si no, no serviría de nada). Como mucho 3 veces por clase, con 4 min entre una y otra; nunca en
// el calentamiento, la vuelta a la calma, un test, una carrera, una AMRAP ni en los últimos 3 min.

export const CHECK_ANSWERS = ['up', 'ok', 'down'];
export const CHECK_MAX = 3;
const GAP_SEC = 240;
const MIN_SEC = 45;              // recuperación o trote de al menos 45 s
const ASK_FROM = 4;              // se pregunta entre el segundo 4…
const ASK_TO = 14;               // …y el 14 del trote (sin pisar el aviso de voz del cambio)
const TAIL_SEC = 180;
export const CHECK_TIMEOUT_SEC = 15;
export const CHECK_STEP = 0.3;   // km/h
export const CHECK_TOL_UP = 2;   // ppm de margen extra al contestar «Sobrado»
const QUALITY = new Set(['run', 'fast']);

/**
 * ¿Toca preguntar ahora? s: estado del motor ({ segment, segIndex, segElapsed, totalElapsed, totalRemaining,
 * inTestStage, status }); segs: los tramos de la clase (para saber de dónde vienes y qué queda); log: preguntas ya
 * hechas en esta clase ([{ t, seg }]); opts: { isTest, race, locked }.
 * → null o { zone }: la zona de calidad de la que vienes (la que cambiará tu respuesta)
 */
export function shouldAsk(s, segs = [], log = [], { isTest = false, race = false, locked = false } = {}) {
  const seg = s?.segment;
  if (!seg || s.status !== 'running' || isTest || race || locked || s.inTestStage || seg.race || seg.amrap) return null;
  if (seg.zone !== 'jog' && seg.zone !== 'walk') return null;
  if (!((Number(seg.sec) || 0) >= MIN_SEC)) return null;
  const el = Number(s.segElapsed) || 0;
  if (!(el >= ASK_FROM && el < ASK_TO)) return null;
  const list = Array.isArray(log) ? log : [];
  if (list.length >= CHECK_MAX || list.some((x) => x.seg === s.segIndex)) return null;
  const last = list[list.length - 1];
  if (last && Number(s.totalElapsed) - Number(last.t) < GAP_SEC) return null;
  if (!(Number(s.totalRemaining) > TAIL_SEC)) return null;
  const arr = Array.isArray(segs) ? segs : [];
  const i = Number(s.segIndex);
  const prev = arr[i - 1];
  if (!prev || !QUALITY.has(prev.zone) || prev.race || prev.amrap) return null;
  const more = arr.slice(i + 1).some((g) => g && g.zone === prev.zone && !g.race && !g.amrap);
  return more ? { zone: prev.zone } : null;
}

/**
 * Lo que hace cada respuesta. → { dir (−1 · 0 · +1), steps (décimas de km/h), tolPpm (margen nuevo o null = igual) }
 * tolPpm parte del margen que traía la clase (effort-learn.js): «Sobrado» suma 2 (tope 8), «Voy mal» lo deja a 0.
 */
export function checkEffect(answer, tolNow = 0) {
  const t = Number(tolNow) || 0;
  if (answer === 'up') return { dir: 1, steps: Math.round(CHECK_STEP * 10), tolPpm: Math.min(8, t + CHECK_TOL_UP) };
  if (answer === 'down') return { dir: -1, steps: Math.round(CHECK_STEP * 10), tolPpm: 0 };
  return { dir: 0, steps: 0, tolPpm: null };
}
