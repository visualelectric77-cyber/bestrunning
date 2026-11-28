// RITMUP · escala de esfuerzo del 1 al 10 (sin DOM). Al acabar la clase eliges un número, no una cara: «Cómodo» iba de
// lo que apenas cuesta a lo que ya pide concentrarse, y la app no distinguía un 4 de un 6.
// La sensación de siempre (easy · ok · hard · max · fail) se deduce del número, así que la progresión, el plan y el
// historial siguen funcionando igual; lo nuevo es que `session.rpe` guarda el número exacto. «No pude terminarla» es
// aparte: no es un grado de esfuerzo, es que la clase pudo contigo.

/** La escala, con una palabra para cada número (lo que se lee bajo los botones). */
export const RPE_SCALE = [
  { n: 1, label: 'Reposo activo' },
  { n: 2, label: 'Muy fácil' },
  { n: 3, label: 'Fácil' },
  { n: 4, label: 'Cómodo' },
  { n: 5, label: 'Algo duro' },
  { n: 6, label: 'Duro' },
  { n: 7, label: 'Muy duro' },
  { n: 8, label: 'Durísimo' },
  { n: 9, label: 'Casi al máximo' },
  { n: 10, label: 'Al máximo' },
];

const clampRpe = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
};

/** Número → sensación de siempre. 1–3 «Muy fácil», 4–5 «Cómodo», 6–8 «Exigente», 9–10 «Al límite». */
export function rpeToFeeling(rpe) {
  const n = clampRpe(rpe);
  if (n == null) return null;
  return n <= 3 ? 'easy' : n <= 5 ? 'ok' : n <= 8 ? 'hard' : 'max';
}

/** Sensación de siempre → número por defecto (el de las sesiones guardadas antes de la escala). */
export const FEELING_RPE = { easy: 3, ok: 5, hard: 7, max: 9, fail: 10 };

/** Palabra de un número de la escala ('' si no lo es). */
export const rpeLabel = (rpe) => RPE_SCALE.find((x) => x.n === clampRpe(rpe))?.label || '';

/** El esfuerzo de una sesión como número 1–10: el que eligió o, si es de antes de la escala, el de su sensación. */
export function sessionRpe(s) {
  const n = clampRpe(s?.rpe);
  if (n != null) return n;
  return FEELING_RPE[s?.feeling] ?? null;
}
