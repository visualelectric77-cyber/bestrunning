// HYPERTRACK · utilidades numéricas (sin asignaciones por frame).

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
export const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Amortiguación exponencial independiente del framerate (lambda ≈ 1/τ). */
export const damp = (cur, target, lambda, dt) => target + (cur - target) * Math.exp(-lambda * dt);

/** PRNG mulberry32 local (no dependemos de otros módulos para la escena). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Muelle con amortiguación CRÍTICA (sin rebote), solución exacta para cualquier dt (estable a 30 y 60 fps).
 * st = Float64Array/array [valor, velocidad] (se modifica en sitio). `settle` = segundos hasta ~98 % del recorrido.
 */
export function springTo(st, i, target, settle, dt) {
  const w = 6 / Math.max(1e-3, settle);
  const x = st[i] - target;
  const v = st[i + 1];
  const e = Math.exp(-w * dt);
  const k = (v + w * x) * dt;
  st[i] = target + (x + k) * e;
  st[i + 1] = (v - w * k) * e;
  return st[i];
}

/** Orden de intensidad de las zonas (para saber si un cambio "sube" o "baja"). */
export const ZONE_RANK = { walk: 0, cooldown: 1, warmup: 1, jog: 2, run: 3, fast: 4, sprint: 5 };
