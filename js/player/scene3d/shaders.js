// Escena 3D · trozos GLSL compartidos (ctx.shaders). Sin máscaras del HUD (§15.3).

/** Ruido barato (hash + value noise + fbm de 3 octavas). */
export const NOISE = /* glsl */ `
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm3(vec2 p){ float a = 0.5; float s = 0.0; for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

/** Niebla exponencial cuadrática. */
export const FOG = /* glsl */ `
float fogAmount(float d, float density){ float x = d * density; return 1.0 - exp(-x * x); }
`;

/** Salida estándar: tone mapping y espacio de color sólo cuando se pinta directo a pantalla (modo ahorro). */
export const OUTPUT = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;
