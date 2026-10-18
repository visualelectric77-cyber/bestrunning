// BestRunning · escenario AURORA · piezas compartidas (trazado del río en GLSL y en JS, constantes).
// El río de partículas, el resplandor del suelo y los rótulos 3D usan EXACTAMENTE el mismo trazado: una curva fija en
// el mundo (los meandros se acercan a tu velocidad y pasan) con una curva de composición cerca de la cámara (en
// horizontal el río barre hacia el hueco libre bajo el número). Periodos divisores de MEANDER_PERIOD ⇒ sin saltos al
// reducir la distancia recorrida módulo el periodo (precisión del flotante en clases de una hora).

export const TAU = Math.PI * 2;
export const MEANDER_PERIOD = 1200; // u (múltiplo de 300 y 120)
export const RIVER_LEN = 230;       // u de río visibles por delante
export const RIVER_NEAR = -4;       // u por detrás de la cámara donde nacen/mueren las partículas

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Trazado del río (GLSL). uBend = (desplazamiento cerca, d0, d1, amplitud de meandro) · uSm = S mod periodo. */
export const RIVER_GLSL = /* glsl */ `
uniform vec4 uBend;
uniform float uSm;
float riverX(float d) {
  float near = uBend.x * (1.0 - smoothstep(uBend.y, uBend.z, d));
  float m = sin(6.2831853 * (d + uSm) / 300.0 + 0.7) * 0.7 + sin(6.2831853 * (d + uSm) / 120.0 + 2.1) * 0.3;
  return near + uBend.w * smoothstep(12.0, 70.0, d) * m;
}`;

/** El mismo trazado en JS (rótulos 3D, fantasma). bend = THREE.Vector4 (mismos campos que uBend). */
export function riverX(d, bend, sm) {
  const near = bend.x * (1 - ss(bend.y, bend.z, d));
  const m = Math.sin((TAU * (d + sm)) / 300 + 0.7) * 0.7 + Math.sin((TAU * (d + sm)) / 120 + 2.1) * 0.3;
  return near + bend.w * ss(12, 70, d) * m;
}

/** Intensidad (0..1) de cada zona: gobierna tensión, ritmo de las cortinas y densidad del río. */
export const ENERGY = { walk: 0.1, warmup: 0.2, cooldown: 0.12, jog: 0.35, run: 0.56, fast: 0.78, sprint: 1 };

/** Índigo profundo de la noche (airglow, velo del cielo): paleta coherente en todas las zonas. */
export const INDIGO = '#2b2f8f';

/** Cuerpo de los rayos de las cortinas: índigo-grafito neutro (el color de la zona solo vive en el filo inferior). */
export const BODY = '#3a4272';
