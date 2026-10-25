// NOCHE DE HALLOWEEN · piezas compartidas: el trazado del camino (en GLSL y en JS), las ranuras de las calabazas, la
// luz de sus velas (con el encendido en cadena) y la niebla (de distancia + la niebla baja que se arrastra).
// Marco del corredor: tú estás en el origen mirando a −z; srel = metros REALES por delante de ti a lo largo del camino.
// El camino serpentea con dos senos lentos; en el marco del corredor se le resta su recta tangente en la cámara (una
// cizalla), así delante de ti siempre va recto hacia −z y las curvas aparecen a lo lejos. Lo que está en el infinito
// (luna, colinas, la casa) gira con el rumbo del camino (uHeading en el cielo).
// Las ranuras de calabazas, árboles y lápidas son índices enteros k = base + j (base = floor(S/D)) ⇒ todo es función
// de k y del desplazamiento uOff = base·D − S (calculado en JS en doble precisión): sin saltos ni pérdida de precisión
// en clases de una hora. Las texturas del suelo son periódicas en 512 m (S mod 512).

export const TAU = Math.PI * 2;
export const CAM_H = 1.7;          // altura de ojos del corredor (m)
export const PUMP_D = 7;           // m entre calabazas del mismo lado (los dos lados al tresbolillo: una cada 3,5 m)
export const PUMP_LAT = 1.85;      // m del centro del camino a las calabazas
export const TREE_D = 4.6;         // m por ranura de árboles (4 árboles por ranura en calidad alta)
export const GRAVE_D = 3.2;        // m por tramo de verja del cementerio
export const TEX_PERIOD = 512;     // periodo (m) de las texturas del suelo
// meandro del camino: x(s) = A1·sin(K1·s + P1) + A2·sin(K2·s + P2) (pendiente máxima ≈ 0,075 ⇒ curvas suaves)
export const A1 = 3.4;
export const K1 = TAU / 460;
export const P1 = 0.9;
export const A2 = 0.9;
export const K2 = TAU / 190;
export const P2 = 2.3;

const f = (v) => Number(v).toFixed(6);

/** Uniformes compartidos por todos los materiales (los mismos objetos: se actualizan una vez por fotograma). */
export function createShared(THREE) {
  return {
    uBend: { value: new THREE.Vector4(0, 0, 0, 0) },       // x φ1, y φ2 (fases en la cámara), z pendiente, w x(S)
    uSlot: { value: new THREE.Vector4(0, 0, PUMP_D, 0) },  // calabazas: x base, y uOff (m), z D (m), w S mod 512
    uChain: { value: new THREE.Vector4(0, 0.45, 1, 0) },   // x frente (srel), y brillo sin encender, z brillo global, w activa
    uLamp: { value: new THREE.Vector4(0, 1, 0, 0) },       // x apagado previo al cambio (0..1), y parpadeo, z tiempo, w -
    uColOld: { value: new THREE.Color('#30D158') },
    uColNew: { value: new THREE.Color('#30D158') },
    uFogCol: { value: new THREE.Color().setRGB(0.03, 0.021, 0.048) },
    uFogP: { value: new THREE.Vector4(0.0068, 0.045, 0, 1) }, // x densidad, y niebla baja, z deriva (m), w detalle
    uMoonDir: { value: new THREE.Vector3(0.3, 0.08, -0.95).normalize() },
    uMoonCol: { value: new THREE.Color().setRGB(1.0, 0.42, 0.11) },
    uAmb: { value: new THREE.Color().setRGB(0.022, 0.016, 0.04) },
  };
}

/** Trazado en JS (mismas fórmulas que el GLSL). */
export function bendPhases(S, out) {
  const p1 = (K1 * S + P1) % TAU;
  const p2 = (K2 * S + P2) % TAU;
  out.x = p1;
  out.y = p2;
  out.z = A1 * K1 * Math.cos(p1) + A2 * K2 * Math.cos(p2);   // pendiente dx/ds en la cámara
  out.w = A1 * Math.sin(p1) + A2 * Math.sin(p2);
  return out;
}
export function bendX(srel, b) {
  return A1 * Math.sin(b.x + K1 * srel) + A2 * Math.sin(b.y + K2 * srel) - b.w - b.z * srel;
}

/** Trozo GLSL común (requiere el NOISE del núcleo antes). */
export const COMMON_GLSL = /* glsl */ `
#define PI 3.14159265
#define HA1 ${f(A1)}
#define HK1 ${f(K1)}
#define HA2 ${f(A2)}
#define HK2 ${f(K2)}
#define PUMP_LAT ${f(PUMP_LAT)}
uniform vec4 uBend, uSlot, uChain, uLamp, uFogP;
uniform vec3 uColOld, uColNew, uFogCol, uMoonDir, uMoonCol, uAmb;
const vec3 CANDLE = vec3(1.0, 0.43, 0.08);

// desplazamiento lateral del eje del camino a srel metros por delante (marco del corredor)
float bendX(float s) {
  return HA1 * sin(uBend.x + HK1 * s) + HA2 * sin(uBend.y + HK2 * s) - uBend.w - uBend.z * s;
}
// ruido de valor periódico en x (per = celdas por periodo): texturas del suelo sin costura al envolver S mod 512
float vnoiseP(vec2 p, float per) {
  vec2 i = floor(p); vec2 fr = fract(p);
  vec2 u = fr * fr * (3.0 - 2.0 * fr);
  float x0 = mod(i.x, per); float x1 = mod(i.x + 1.0, per);
  return mix(mix(hash12(vec2(x0, i.y)), hash12(vec2(x1, i.y)), u.x),
             mix(hash12(vec2(x0, i.y + 1.0)), hash12(vec2(x1, i.y + 1.0)), u.x), u.y);
}
// ranura j (relativa a la base) del lado side (−1 izquierda, +1 derecha): srel, lateral, diámetro, semilla
void pumpkinSlot(float j, float side, out float srel, out float lat, out float size, out float seed) {
  float k = uSlot.x + j;
  float sk = k * 2.0 + step(0.0, side);
  seed = hash11(sk * 1.6180339 + 3.7);
  srel = j * uSlot.z + uSlot.y + (side > 0.0 ? 0.5 * uSlot.z : 0.0);
  lat = side * (PUMP_LAT + 0.32 * hash11(sk * 3.17 + 1.3));
  size = 0.36 + 0.17 * hash11(sk * 5.71 + 2.9);
}
// color de zona y brillo de la vela en srel: apagado gradual antes del cambio y encendido en cadena hacia delante
vec3 candleAt(float srel, out float br) {
  float on = 1.0;
  float ign = 0.0;
  if (uChain.w > 0.5) {
    on = 1.0 - smoothstep(uChain.x - 3.0, uChain.x + 3.0, srel);
    ign = exp(-pow((srel - uChain.x) / 7.0, 2.0)) * 0.28;
  }
  float pre = 1.0 - uLamp.x * smoothstep(-2.0, 8.0, srel);   // últimos segundos del tramo: las velas de delante bajan
  br = uChain.z * (mix(uChain.y, pre, on) + ign);
  return mix(uColOld, uColNew, on);
}
// luz de la vela: naranja de calabaza teñido por el color de la zona
vec3 candleTint(vec3 zc) { return mix(CANDLE, zc, 0.6); }
float flick(float seed) {
  float t = uLamp.z;
  return 1.0 - uLamp.y * (0.06 + 0.06 * sin(t * 7.3 + seed * 40.0) * sin(t * 3.1 + seed * 17.0));
}
// niebla: distancia (cuadrática) + capa baja (< 1,1 m) que se arrastra; el aire se aclara hacia la luna
vec3 applyFog(vec3 col, vec3 wp, vec3 V, float dist, float srel, float r) {
  float fx = dist * uFogP.x;
  float fog = 1.0 - exp(-fx * fx);
  float camY = max(cameraPosition.y, 0.3);
  float lowLen = dist * clamp((1.1 - wp.y) / max(camY - wp.y, 0.05), 0.0, 1.0);
  float pat = 0.45 + 1.1 * vnoiseP(vec2((srel + uSlot.w + uFogP.z) * 0.125, r * 0.11 + uFogP.z * 0.05), 64.0);
  float low = 1.0 - exp(-lowLen * uFogP.y * mix(1.0, pat, uFogP.w));
  float k = 1.0 - (1.0 - fog) * (1.0 - low);
  float mz = max(dot(-V, uMoonDir), 0.0);
  vec3 fc = uFogCol + uMoonCol * (0.014 * pow(mz, 6.0) + 0.03 * pow(mz, 40.0));
  return mix(col, fc, k);
}
`;
