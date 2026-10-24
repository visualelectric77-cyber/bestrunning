// RITMUP · escena 3D · SENSACIÓN DE VELOCIDAD (sin DOM ni three.js). Preferencia `localStorage 'ritmup.speedfeel'`:
//   'real'    — señales cercanas tenues, sin FOV extra, balanceo de zancada mínimo (lo de antes, algo más legible)
//   'viva'    — por defecto: juntas y balizas del suelo legibles, balanceo marcado, +3° de FOV en el sprint
//   'intensa' — juntas más juntas (×1,5), más contraste, balanceo amplio, +4° de FOV en el sprint
// SOLO escala la percepción (contraste y densidad de las señales cercanas, balanceo y FOV extra): la distancia visual
// S(t) y la colocación de puertas, MITAD, META y carteles de km no dependen de ella (se cruzan en su segundo exacto).
// La fila de Ajustes la añade js/screens/settings.js; aquí solo se lee la clave (al crear la escena y al cargar cada
// escenario) y el reproductor puede forzarla con scene.setSpeedFeel(id).

export const SPEEDFEEL_KEY = 'ritmup.speedfeel';
export const SPEEDFEEL_DEFAULT = 'viva';

/**
 * cue:     contraste de las señales cercanas (juntas, balizas, marcas de distancia) · 1 = viva
 * density: juntas por unidad de longitud (1 = la separación de diseño de cada escenario). Tope 1,5: una rejilla
 *          regular más densa que ~2,5 desplazamientos por fotograma se ve ir hacia atrás (efecto rueda de carro)
 * bob:     multiplicador del balanceo de zancada del núcleo (1 = ~1,2 cm de rebote, el de siempre)
 * fov:     grados de FOV extra a velocidad alta (rampa con la velocidad visual: 0 al paso, máximo en el sprint)
 */
export const SPEEDFEEL = Object.freeze({
  real: Object.freeze({ id: 'real', cue: 0.5, density: 1, bob: 1, fov: 0 }),
  viva: Object.freeze({ id: 'viva', cue: 1, density: 1, bob: 1.8, fov: 3 }),
  intensa: Object.freeze({ id: 'intensa', cue: 1.45, density: 1.5, bob: 2.5, fov: 4 }),
});

/** Normaliza un id ('real' | 'viva' | 'intensa'); cualquier otra cosa ⇒ 'viva'. */
export function normalizeSpeedFeel(v) {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SPEEDFEEL, v) ? v : SPEEDFEEL_DEFAULT;
}

/** Lee la preferencia guardada (sin almacenamiento, modo privado o valor raro ⇒ 'viva'). */
export function readSpeedFeel() {
  try {
    return normalizeSpeedFeel(globalThis.localStorage?.getItem?.(SPEEDFEEL_KEY));
  } catch {
    return SPEEDFEEL_DEFAULT;
  }
}

/** Perfil de una preferencia (objeto congelado: compártelo, no lo mutes). */
export function speedFeelProfile(id) {
  return SPEEDFEEL[normalizeSpeedFeel(id)];
}

/** km/h reales a partir de la velocidad visual (inversa de visualSpeed() de timeline.js). */
export function kmhOfVisual(v) {
  return v > 0 ? 10 * Math.pow(v / 13.5, 1 / 1.85) : 0;
}

/**
 * FOV extra (°) para una velocidad real: nada al paso o al trote suave, la mitad hacia los 11 km/h y el máximo del
 * perfil en el sprint (≥ 15 km/h). Suave en ambos extremos: acompaña la rampa de la cinta sin escalones.
 */
export function speedFeelFov(profile, kmh) {
  if (!profile || !(profile.fov > 0) || !(kmh > 7)) return 0;
  const u = Math.min(1, (kmh - 7) / 8);
  return profile.fov * u * u * (3 - 2 * u);
}
