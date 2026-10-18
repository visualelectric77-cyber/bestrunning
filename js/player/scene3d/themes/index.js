// BestRunning · registro de escenarios 3D (SPEC §15.2). Cada escenario es un plugin en ./<id>.js que exporta
//   export const meta = { id, name, description }            // textos en español
//   export function createTheme(ctx) → { update(frame), event(type, data), resize({ width, height, aspect }), dispose() }
// (createTheme puede ser async). La interfaz completa de ctx y frame está documentada en js/player/scene3d.js.
//
// DISEÑADORES: añadid UNA línea por escenario en THEMES (el orden es el de Ajustes → "Escenario"). La carga es
// perezosa (import dinámico): un escenario no pesa nada hasta que se elige. `hidden: true` = no se ofrece en Ajustes
// (sigue disponible por id, p. ej. en el laboratorio). Si un escenario falla al cargar o en marcha, el núcleo vuelve
// solo a 'blank'.

/** @typedef {{ id: string, name: string, description: string, hidden?: boolean, loader: () => Promise<any> }} ThemeEntry */

/** @type {ThemeEntry[]} */
export const THEMES = [
  { id: 'aurora', name: 'Aurora', description: 'Auroras sobre la noche y un río de luz que fluye a tu ritmo.', loader: () => import('./aurora.js') },
  { id: 'cordillera', name: 'Cordillera', description: 'Tu clase como una cordillera nocturna: cada intervalo, una cumbre.', loader: () => import('./cordillera.js') },
  { id: 'estadio', name: 'Estadio', description: 'Pista de atletismo de noche con luces de ritmo a tu velocidad.', loader: () => import('./estadio.js') },
  { id: 'blank', name: 'Grafito', description: 'Suelo de grafito y horizonte limpio. Sobrio y el más ligero.', loader: () => import('./blank.js') },
  { id: 'legacy', name: 'Hypertrack v1', description: 'Autopista de neón original (oculta).', hidden: true, loader: () => import('./legacy.js') },
];

/** Escenario por defecto (el jurado lo cambia aquí). */
export const DEFAULT_THEME = 'aurora';

/** Entrada del registro por id (o null). */
export function themeById(id) {
  for (const t of THEMES) if (t.id === id) return t;
  return null;
}

/** Escenarios visibles en Ajustes (sin los ocultos), solo metadatos. */
export function listThemes({ includeHidden = false } = {}) {
  return THEMES.filter((t) => includeHidden || !t.hidden).map(({ id, name, description, hidden = false }) => ({ id, name, description, hidden }));
}
