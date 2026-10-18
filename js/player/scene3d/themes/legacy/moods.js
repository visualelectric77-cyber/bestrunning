// Escenario 'legacy' (Hypertrack v1, oculto) · "moods" por zona: paleta y parámetros que se interpolan suavemente.
// El color principal de cada zona sale SIEMPRE de ZONES (levels.js); el resto son complementos de ambiente.
import { ZONES } from '../../../../training/levels.js';

const COLOR_KEYS = ['top', 'mid', 'horizon', 'sunA', 'sunB', 'accent', 'accent2', 'fog', 'ground'];
const NUM_KEYS = ['sunSize', 'sunElev', 'aurora', 'stars', 'hyper', 'breathe', 'pulse', 'streaks', 'fov',
  'bloom', 'chroma', 'shake', 'dust', 'ridge', 'stripes', 'fogDensity', 'gridGlow'];

const BASE = {
  sunSize: 0.15, sunElev: 0.04, aurora: 0, stars: 0.15, hyper: 0, breathe: 0, pulse: 0.5, streaks: 0.2, fov: 0,
  bloom: 0.95, chroma: 0, shake: 0, dust: 0.5, ridge: 1, stripes: 1, fogDensity: 1, gridGlow: 1,
};

/** Definiciones (hex sRGB). `accent` = ZONES[zona].color. */
const DEFS = {
  warmup: { // amanecer suave
    top: '#030917', mid: '#0f2244', horizon: '#b8644f', sunA: '#fff0b3', sunB: '#ff6f91', accent2: '#ffb38a',
    fog: '#1a1930', ground: '#050812',
    sunSize: 0.17, sunElev: 0.05, stars: 0.35, streaks: 0.08, pulse: 0.35, bloom: 0.9, dust: 0.35,
  },
  walk: {
    top: '#04060b', mid: '#121722', horizon: '#56607a', sunA: '#f2f2f7', sunB: '#8e8e93', accent2: '#c7c7cc',
    fog: '#14171f', ground: '#06070a',
    sunSize: 0.13, sunElev: 0.03, stars: 0.3, streaks: 0.05, pulse: 0.3, bloom: 0.85, dust: 0.3,
  },
  jog: { // aurora azul-verde + sol que respira
    top: '#01070e', mid: '#02161b', horizon: '#06261f', sunA: '#9dffc9', sunB: '#13a35a', accent2: '#64d2ff',
    fog: '#04191a', ground: '#020a0a',
    sunSize: 0.15, sunElev: 0.045, aurora: 1, stars: 0.45, breathe: 1, streaks: 0.18, pulse: 0.45, bloom: 0.95, dust: 0.45,
  },
  run: { // ámbar
    top: '#080400', mid: '#1c0e00', horizon: '#6e3c06', sunA: '#fff6c2', sunB: '#ffb000', accent2: '#ff9f0a',
    fog: '#1c0e00', ground: '#090500',
    sunSize: 0.15, sunElev: 0.04, stars: 0.12, streaks: 0.42, pulse: 0.95, bloom: 1.0, dust: 0.6,
  },
  fast: { // naranja
    top: '#0a0200', mid: '#230800', horizon: '#80290a', sunA: '#ffd9a8', sunB: '#ff4f1f', accent2: '#ff375f',
    fog: '#1f0800', ground: '#0a0300',
    sunSize: 0.155, sunElev: 0.035, stars: 0.1, streaks: 0.72, fov: 5, pulse: 1, bloom: 1.12, dust: 0.75,
  },
  sprint: { // HYPERDRIVE: rojo sprint + ember + blanco sobre negro (el magenta sólo en las franjas cromáticas)
    top: '#06000a', mid: '#160008', horizon: '#9a1028', sunA: '#ffe0cc', sunB: '#ff375f', accent2: '#ff6a1a',
    fog: '#140005', ground: '#090003',
    sunSize: 0.17, sunElev: 0.035, stars: 0.55, hyper: 1, streaks: 1, fov: 14, pulse: 1, bloom: 1.55, chroma: 1,
    shake: 1, dust: 1, stripes: 1.6, fogDensity: 0.85,
  },
  cooldown: { // atardecer violeta
    top: '#030214', mid: '#140b38', horizon: '#9a4a72', sunA: '#ffd0e6', sunB: '#7d7aff', accent2: '#bf5af2',
    fog: '#130c2e', ground: '#040216',
    sunSize: 0.2, sunElev: -0.005, stars: 1, streaks: 0.05, pulse: 0.3, bloom: 0.92, dust: 0.3, ridge: 1.2,
  },
};

export class Mood {
  constructor(THREE) {
    for (const k of COLOR_KEYS) this[k] = new THREE.Color();
    for (const k of NUM_KEYS) this[k] = BASE[k];
  }

  copy(m) {
    for (const k of COLOR_KEYS) this[k].copy(m[k]);
    for (const k of NUM_KEYS) this[k] = m[k];
    return this;
  }

  /** Interpola hacia `m` con factor a (0..1). */
  approach(m, a) {
    for (const k of COLOR_KEYS) this[k].lerp(m[k], a);
    for (const k of NUM_KEYS) this[k] += (m[k] - this[k]) * a;
    return this;
  }
}

/** Crea los moods objetivo de todas las zonas (colores en espacio lineal de three). */
export function buildMoods(THREE) {
  const out = {};
  for (const zone of Object.keys(ZONES)) {
    const d = { ...BASE, ...(DEFS[zone] || DEFS.jog) };
    const m = new Mood(THREE);
    for (const k of COLOR_KEYS) {
      if (k === 'accent') m.accent.set(ZONES[zone].color);
      else m[k].set(d[k]);
    }
    for (const k of NUM_KEYS) m[k] = d[k];
    out[zone] = m;
  }
  return out;
}

/** Orden de intensidad para decidir si un cambio "sube" (carga) o "baja". */
export const ZONE_RANK = { walk: 0, cooldown: 1, warmup: 1, jog: 2, run: 3, fast: 4, sprint: 5 };
