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
  { id: 'vision', name: 'Modo visión', description: 'Tu clase como una escalera de luz: cada tramo es un escalón a su velocidad, con su meta al final.', loader: () => import('./vision.js') },
  { id: 'costa', name: 'Costa', description: 'Paseo marítimo al amanecer: el mar a tu lado, losas mojadas y farolas aún encendidas.', loader: () => import('./costa.js') },
  { id: 'neon', name: 'Neón', description: 'Avenida mojada entre rascacielos, rótulos de neón y la ciudad reflejada en el asfalto.', loader: () => import('./neon.js') },
  { id: 'desierto', name: 'Desierto', description: 'Una carretera recta bajo la Vía Láctea, con los captafaros del color de tu tramo.', loader: () => import('./desierto.js') },
  { id: 'tunel', name: 'Túnel', description: 'Un tubo de metal con anillos de luz del color de tu tramo. Para series.', loader: () => import('./tunel.js') },
  { id: 'bosque', name: 'Bosque', description: 'Un sendero entre abetos altos con niebla de la mañana y haces de luz.', loader: () => import('./bosque.js') },
  { id: 'aurora', name: 'Aurora', description: 'Auroras sobre la noche y un río de luz que fluye a tu ritmo.', loader: () => import('./aurora.js') },
  { id: 'cordillera', name: 'Cordillera', description: 'Tu clase como una cordillera nocturna: cada intervalo, una cumbre.', loader: () => import('./cordillera.js') },
  { id: 'estadio', name: 'Estadio', description: 'Pista de atletismo de noche con luces de ritmo a tu velocidad.', loader: () => import('./estadio.js') },
  { id: 'ciudad-berlin', name: 'Berlín · final del maratón', description: 'Los últimos 3,4 km del Maratón de Berlín por sus calles reales: Unter den Linden y la Puerta de Brandeburgo hasta la meta.', loader: () => import('./ciudad.js').then((m) => m.berlin) },
  { id: 'ciudad-berlin-10k', name: 'Berlín · últimos 10 km', description: 'Para clases largas: del km 32 a la meta del Maratón de Berlín por el Kurfürstendamm, el KaDeWe, Potsdamer Platz y la Puerta de Brandeburgo.', loader: () => import('./ciudad.js').then((m) => m.berlin10k) },
  { id: 'ciudad-madrid', name: 'Madrid · final del maratón', description: 'Los últimos 3,7 km del Maratón de Madrid por sus calles reales: Atocha, el Paseo del Prado, Cibeles y la meta en Recoletos.', loader: () => import('./ciudad.js').then((m) => m.madrid) },
  { id: 'blank', name: 'Grafito', description: 'Suelo de grafito y horizonte limpio. Sobrio y el más ligero.', loader: () => import('./blank.js') },
  { id: 'carrera', name: 'Carrera', description: 'Gran carrera de ciudad de noche: salida, arcos de cada kilómetro y meta con tu tiempo.', hidden: true, loader: () => import('./carrera.js') },
  { id: 'nieve', name: 'Navidad', description: 'Un camino nevado entre abetos con guirnaldas, farolillos y nieve cayendo.', hidden: true, loader: () => import('./nieve.js') },
  { id: 'halloween', name: 'Noche de Halloween', description: 'Un camino entre calabazas encendidas bajo la luna llena.', hidden: true, loader: () => import('./halloween.js') },
  { id: 'legacy', name: 'Hypertrack v1', description: 'Autopista de neón original (oculta).', hidden: true, loader: () => import('./legacy.js') },
];

/** Escenario por defecto (el jurado lo cambia aquí). */
export const DEFAULT_THEME = 'vision';

/** Entrada del registro por id (o null). */
export function themeById(id) {
  for (const t of THEMES) if (t.id === id) return t;
  return null;
}

/** Escenarios visibles en Ajustes (sin los ocultos), solo metadatos. */
export function listThemes({ includeHidden = false } = {}) {
  return THEMES.filter((t) => includeHidden || !t.hidden).map(({ id, name, description, hidden = false }) => ({ id, name, description, hidden }));
}
