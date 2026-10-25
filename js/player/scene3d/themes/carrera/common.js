// CARRERA · medidas de la avenida y trozos GLSL compartidos (sin three.js).
// Marco del corredor: tú vas en el origen mirando a −z; el mundo se dibuja RELATIVO a tu distancia real s (m). Para que
// la precisión de float32 no dependa de cuántos km llevas, los shaders reciben s partido en uSLo = s mod 1000 y
// uSHi = floor(s / 1000): todos los patrones del suelo, las vallas, el público, las farolas y los edificios tienen
// periodos que dividen 1000 m (10 m las discontinuas, 2,5 m los paneles de valla, 31,25 m las farolas, 250 m el
// público, 1000 m los edificios), así que nada salta al cruzar un kilómetro.
// Curva suave de la avenida: en el vértice x += uBend · z² (z < 0 delante). La luz y los patrones se calculan ANTES de
// curvar (coordenadas de la avenida recta), así que todo casa.

export const ROAD_HW = 7.5;          // semiancho de la calzada (5 carriles de 3 m)
export const CURB_W = 0.22;          // bordillo
export const FENCE_X = 7.85;         // vallas, al borde de la acera
export const FENCE_H = 1.1;
export const CROWD_X = [8.35, 8.95, 9.55]; // filas de público tras las vallas
export const LAMP_X = 12.6;          // fuste de las farolas (acera)
export const LAMP_HEAD_X = 8.7;      // cabeza de la farola (sobre las vallas)
export const LAMP_Y = 8.6;
export const LAMP_P = 31.25;         // separación real entre farolas de un mismo lado (m) — 1000 / 32
export const LAMP_OFF_R = 15.625;    // las de la derecha, al tresbolillo
export const BUILD_X = 15.5;         // primera línea de fachadas
export const BLUE_X = 0;             // línea azul de carrera
export const CAM_X = 0.32;           // vas pegado a la línea azul, un palmo a su derecha
export const EYE = 1.7;              // altura de ojos (m)

export const f5 = (v) => Number(v).toFixed(5);

/** Constantes para los shaders. */
export const DEFINES = {
  ROAD_HW: f5(ROAD_HW), CURB_W: f5(CURB_W), FENCE_X: f5(FENCE_X), FENCE_H: f5(FENCE_H), LAMP_HX: f5(LAMP_HEAD_X),
  LAMP_Y: f5(LAMP_Y), LAMP_P: f5(LAMP_P), LAMP_OFF_R: f5(LAMP_OFF_R), BUILD_X: f5(BUILD_X), BLUE_X: f5(BLUE_X),
};

/** Uniformes compartidos (los mismos objetos {value} en todos los materiales). */
export function sharedUniforms(THREE) {
  return {
    uSLo: { value: 0 },            // tu distancia real mod 1000 (m)
    uSHi: { value: 0 },            // km enteros recorridos
    uBend: { value: 0 },           // curvatura de la avenida (1/m)
    uFogCol: { value: new THREE.Color().setRGB(0.0082, 0.0086, 0.0108) },
    uFogD: { value: 0.0042 },
    uLampCol: { value: new THREE.Color().setRGB(1.0, 0.8, 0.58) },
    uLight: { value: 1 },          // nivel de las farolas
    uTime: { value: 0 },
    uMetaZ: { value: 1e5 },        // z (marco del corredor) de la meta; 1e5 = no hay
    uMetaK: { value: 0 },          // luz de la meta (focos encendidos 0..1)
    uStartZ: { value: 1e5 },
    uGold: { value: 0 },           // final: luz dorada 0..1
    uAccent: { value: new THREE.Color() },
    uAvoid: { value: new THREE.Vector4(2, 2, 2, 2) }, // NDC del número de velocidad (composición de las farolas)
  };
}

/** Declaraciones de los uniformes compartidos (GLSL). */
export const SHARED_DECL = /* glsl */ `
uniform float uSLo, uSHi, uBend, uFogD, uLight, uTime, uMetaZ, uMetaK, uStartZ, uGold;
uniform vec3 uFogCol, uLampCol, uAccent;
uniform vec4 uAvoid;
`;

/** Curva de la avenida (vértice) y niebla. */
export const BEND = /* glsl */ `
vec3 bendW(vec3 p) { p.x += uBend * p.z * p.z; return p; }
float fogK(float d) { float x = d * uFogD; return 1.0 - exp(-x * x); }
`;

/** Ruido de valor periódico en y (per = periodo del retículo, entero): sin costuras al envolver uSLo. */
export const PNOISE = /* glsl */ `
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float h11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float pnoise(vec2 p, float per) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float y0 = mod(i.y, per); float y1 = mod(i.y + 1.0, per);
  float a = h12(vec2(i.x, y0)); float b = h12(vec2(i.x + 1.0, y0));
  float c = h12(vec2(i.x, y1)); float d = h12(vec2(i.x + 1.0, y1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float lineAA(float d, float hw, float fw) {
  float w = max(hw, 0.5 * fw);
  return (1.0 - smoothstep(w - 0.5 * fw, w + 0.5 * fw, d)) * (hw / w);
}
`;

/**
 * Luz de las farolas en un punto de la avenida recta (x, y, sP = uSLo − z) con normal N: las dos más cercanas de cada
 * lado (cabezas sobre las vallas, al tresbolillo). Devuelve irradiancia relativa (≈ 1 bajo una cabeza a 1,7 m).
 */
export const LAMPS = /* glsl */ `
float lampOne(vec3 P, vec3 N, vec3 L) {
  vec3 v = L - P;
  float d2 = dot(v, v);
  float c = max(dot(N, v) * inversesqrt(d2), 0.0);
  // cono de la luminaria: luz hacia abajo, recortada suave por encima de la horizontal
  float down = clamp((L.y - P.y) * inversesqrt(d2) * 1.6, 0.0, 1.0);
  return c * down * 48.0 / (d2 + 9.0);
}
float lampsAt(vec3 P, vec3 N, float sP) {
  float e = 0.0;
  float kL = floor(sP / LAMP_P);
  for (int i = 0; i < 2; i++) {
    float sl = (kL + float(i)) * LAMP_P;
    e += lampOne(P, N, vec3(-LAMP_HX, LAMP_Y, -(sl - uSLo)));
  }
  float kR = floor((sP - LAMP_OFF_R) / LAMP_P);
  for (int i = 0; i < 2; i++) {
    float sr = (kR + float(i)) * LAMP_P + LAMP_OFF_R;
    e += lampOne(P, N, vec3(LAMP_HX, LAMP_Y, -(sr - uSLo)));
  }
  return e;
}
// luz de los focos de la meta (pórtico): una bolsa cálida de ~20 m alrededor de la línea
float metaLight(vec3 P) {
  if (uMetaK <= 0.0) return 0.0;
  vec3 v = vec3(0.0, 6.4, uMetaZ + 2.0) - P;
  float d2 = dot(v, v);
  return uMetaK * 170.0 / (d2 + 60.0);
}
`;
