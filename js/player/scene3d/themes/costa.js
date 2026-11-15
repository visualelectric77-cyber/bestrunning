// RITMUP · escenario COSTA (realista). Paseo marítimo al amanecer que SERPENTEA siguiendo la costa (curvas suaves que
// no se repiten: kit/bend.js): corres por un paseo de losas mojadas por el relente, con el mar a la izquierda (oleaje
// que refleja el cielo de foto, rompientes que entran a la playa, espuma en la orilla), una playa de arena húmeda bajo
// el murete, barandilla de acero, balizas bajas cada 8 m y farolas de cuello curvo cada 24 m que aún siguen encendidas.
// Cielo real (panorama CC0 de Poly Haven) con nubes rosadas y la montaña al fondo de la bahía.
// LA LUZ (15 nov 2026): el sol sale por el lado claro de la foto (a tu espalda, hacia el mar) y sube con la clase. Es una luz con dirección:
// la barandilla, los postes, las balizas y las farolas dejan sombras largas sobre las losas —nítidas junto al objeto y
// difuminadas lejos, calculadas a mano en el material del suelo, sin mapas de sombras—, hay oclusión de contacto en las
// bases y los bordillos, los charcos reflejan el mismo cielo que ves, y el aire lejano toma el color del cielo en esa
// dirección. Al tomar las curvas el cielo, el entorno y el sol giran contigo: las sombras cambian de lado.
// Las luces llevan el color del tramo con el encendido en cadena del kit (runner.js).
// A VELOCIDAD REAL: las losas, la arena, el oleaje, los postes y las farolas pasan a km/h ÷ 3,6 m/s.
// Coste: ~35 llamadas de dibujo y ~67 mil triángulos, sin pases extra (ni reflejos ni mapas de sombras): 2,2 ms por
// fotograma en el Mac a calidad alta (antes 1,75).
import { createRunner, scrollZ } from './kit/runner.js';
import { worldUrl, loadTex, loadJson, loadSet, pbr, skyDome, envFrom, glowMaterial, halos, addLamps, addStreaks, setInstances } from './kit/world.js';
import { createBend } from './kit/bend.js';
import { createRain, liveWeather, startLiveWeather } from './kit/weather.js';

export const meta = {
  id: 'costa',
  name: 'Costa',
  description: 'Paseo marítimo al amanecer: el mar a tu lado, losas mojadas y farolas aún encendidas.',
};

const T = 'costa';
const DEG = Math.PI / 180;
const LAMP_D = 24;      // m entre farolas
const BOL_D = 8;        // m entre balizas
const POST_D = 2.4;     // m entre postes de la barandilla
const PAVE_TILE = 3.0;  // m por repetición de la textura de losas
const SEA_X = -7.5;     // borde del agua
// perfil del paseo (m desde el eje por el que corres)
const KERB_SEA0 = -3.15;  // cara del murete que da al mar
const KERB_SEA1 = -2.62;  // borde interior del remate del murete
const KERB_H = 0.12;      // altura del remate sobre las losas
const RAIL_X = -2.885;    // barandilla (en el centro del remate)
const RAIL_TOP = 1.12;    // pasamanos
const RAIL_MID = [0.79, 0.46];
const BOL_X = -2.22;      // balizas
const KERB_LAND0 = 3.5;   // bordillo del lado de tierra
const KERB_LAND1 = 3.72;
const LAMP_X = 3.2;       // báculo de las farolas
const HEAD_DX = -1.32;    // la luminaria vuela 1,3 m sobre el paseo
const HEAD_Y = 5.36;
const POLE_H = 4.95;
const Z0 = 12;            // las tiras empiezan 12 m detrás de ti
const LEN = 1200;         // y llegan hasta donde la bruma ya lo tapa todo
const NSEG = 300;         // un corte cada 4 m: la curva se dibuja sin quiebros
const AHEAD_POST = 440;
const AHEAD_BOL = 620;
const AHEAD_LAMP = 720;
// el sol sale por el lado claro de la foto: a tu espalda y hacia el mar. Así la sombra de la barandilla cruza el paseo
const SUN_AZ = 205 * DEG;
const g = (v) => v.toFixed(4);

/* ─────────────────────────────── GLSL compartido ─────────────────────────────── */

// El cielo de foto EXACTAMENTE como lo pinta la cúpula (recorte, filtro degradado, tinte y ganancia), girado con el
// rumbo: lo que se refleja en el mar, la arena mojada y los charcos es lo que se ve arriba. costaHaze = el color del
// aire a lo lejos en esa dirección (la franja baja del cielo, difuminada).
const SKY_GLSL = /* glsl */ `
uniform sampler2D uSky;
uniform vec4 uSkyCrop;
uniform vec3 uSkyTint;
uniform vec2 uSkyGrad;
uniform float uSkyGain, uSkyRot;
vec3 costaSky(vec3 d) {
  float az = atan(d.x, -d.z) + uSkyRot;
  float el = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2((az - uSkyCrop.x) / (uSkyCrop.y - uSkyCrop.x), (max(el, uSkyCrop.z + 0.002) - uSkyCrop.z) / (uSkyCrop.w - uSkyCrop.z));
  vec3 c = texture2D(uSky, clamp(uv, vec2(0.002), vec2(0.998))).rgb;
  c *= 1.0 - uSkyGrad.x * smoothstep(0.0, uSkyGrad.y, el);
  return c * uSkyTint * uSkyGain;
}
vec3 costaHaze(vec3 d) {
  float az = atan(d.x, -d.z) + uSkyRot;
  vec2 uv = vec2((az - uSkyCrop.x) / (uSkyCrop.y - uSkyCrop.x), (0.05 - uSkyCrop.z) / (uSkyCrop.w - uSkyCrop.z));
  return texture2D(uSky, clamp(uv, vec2(0.03), vec2(0.97)), 5.0).rgb * uSkyTint * uSkyGain;
}
`;

// Sombras del sol sobre el suelo, a mano: desde el píxel se lanza un rayo hacia el sol y se mira, en el plano de cada
// hilera (barandilla, balizas, farolas), a qué altura y a qué distancia del poste más cercano pasa. La penumbra crece
// con la distancia al objeto: nítida al pie, difusa lejos; los elementos finos se desvanecen (no hay umbra).
const SUN_GLSL = /* glsl */ `
uniform vec4 uSunL;    // xyz hacia el sol (en tu marco), w tangente de la penumbra
uniform vec4 uRowZ;    // z de una pieza de cada hilera: x postes, y balizas, z farolas
float thinShadow(float d, float r, float w) {
  return min(1.0, r / w) * (1.0 - smoothstep(max(r - w, 0.0), r + w, d));
}
float rowDz(float z, float z0, float D) { return abs(mod(z - z0 + 0.5 * D, D) - 0.5 * D); }
vec3 sunLocal(float z) {
  // el sol visto desde ese punto del camino (que ha girado respecto a ti)
  float tn = bendTurn(z);
  float c = cos(tn), s = sin(tn);
  return vec3(uSunL.x * c + uSunL.z * s, uSunL.y, -uSunL.x * s + uSunL.z * c);
}
float costaSunVis(vec3 P) {
  vec3 L = sunLocal(P.z);
  float lx = abs(L.x) < 0.003 ? 0.003 : L.x;
  float kz = abs(lx) / length(vec2(lx, L.z));   // distancia al eje de un poste por metro de z
  float ky = abs(lx) / length(vec2(lx, L.y));   // distancia al eje de un pasamanos por metro de altura
  float sh = 0.0;
  // barandilla y remate del murete (lado del mar)
  float t = (${g(RAIL_X)} - P.x) / lx;
  if (t > 0.0) {
    float y = P.y + t * L.y, zh = P.z + t * L.z, w = 0.005 + t * uSunL.w;
    sh = max(sh, thinShadow(rowDz(zh, uRowZ.x, ${g(POST_D)}) * kz, 0.022, w) * (1.0 - smoothstep(${g(RAIL_TOP)} - w, ${g(RAIL_TOP)} + w, y)));
    sh = max(sh, thinShadow(abs(y - ${g(RAIL_TOP)}) * ky, 0.027, w));
    sh = max(sh, thinShadow(abs(y - ${g(RAIL_MID[0])}) * ky, 0.014, w));
    sh = max(sh, thinShadow(abs(y - ${g(RAIL_MID[1])}) * ky, 0.014, w));
  }
  t = (${g(KERB_SEA1)} - P.x) / lx;
  if (t > 0.0) { float w = 0.004 + t * uSunL.w; sh = max(sh, 1.0 - smoothstep(${g(KERB_H)} - w, ${g(KERB_H)} + w, P.y + t * L.y)); }
  // balizas
  t = (${g(BOL_X)} - P.x) / lx;
  if (t > 0.0) {
    float y = P.y + t * L.y, zh = P.z + t * L.z, w = 0.005 + t * uSunL.w;
    sh = max(sh, thinShadow(rowDz(zh, uRowZ.y, ${g(BOL_D)}) * kz, 0.085, w) * (1.0 - smoothstep(0.55 - w, 0.55 + w, y)));
  }
  // farolas: báculo y luminaria; bordillo de tierra
  t = (${g(LAMP_X)} - P.x) / lx;
  if (t > 0.0) {
    float y = P.y + t * L.y, zh = P.z + t * L.z, w = 0.006 + t * uSunL.w;
    sh = max(sh, thinShadow(rowDz(zh, uRowZ.z, ${g(LAMP_D)}) * kz, 0.065, w) * (1.0 - smoothstep(${g(POLE_H)} - w, ${g(POLE_H)} + w, y)));
  }
  t = (${g(LAMP_X + HEAD_DX)} - P.x) / lx;
  if (t > 0.0) {
    float y = P.y + t * L.y, zh = P.z + t * L.z, w = 0.006 + t * uSunL.w;
    float dh = length(vec2((y - ${g(HEAD_Y)}) * ky / 0.07, rowDz(zh, uRowZ.z, ${g(LAMP_D)}) * kz / 0.17));
    sh = max(sh, min(1.0, 0.12 / w) * (1.0 - smoothstep(1.0 - min(w / 0.12, 0.9), 1.0 + w / 0.12, dh)));
  }
  t = (${g(KERB_LAND0)} - P.x) / lx;
  if (t > 0.0) { float w = 0.004 + t * uSunL.w; sh = max(sh, 1.0 - smoothstep(0.1 - w, 0.1 + w, P.y + t * L.y)); }
  return 1.0 - sh;
}
`;

// Losas: relente (zonas húmedas más oscuras y satinadas, charcos lisos que reflejan el cielo), oclusión de contacto
// y la visibilidad del sol.
const GROUND_PARS = /* glsl */ `
uniform sampler2D uWetNoise;
uniform vec4 uWet;     // x avance (m), y umbral de charco (menos = más agua), z -, w -
float gPud; float gDamp; float gSunVis; float gAO;
`;
const GROUND_MAP = /* glsl */ `
  {
    vec2 wp = vec2(vPathW.x, vPathW.z - uWet.x);
    // dónde se queda el agua: manchas grandes con el borde irregular (cuatro escalas de ruido, de 24 m a 0,9 m)
    float wn = texture2D(uWetNoise, wp * 0.0416667).r * 0.5 + texture2D(uWetNoise, wp * 0.125 + 0.37).g * 0.3
      + texture2D(uWetNoise, wp * 0.375 + 0.11).r * 0.14 + texture2D(uWetNoise, wp * 1.125 + 0.53).g * 0.06;
    gDamp = smoothstep(uWet.y - 0.15, uWet.y + 0.02, wn);
    gPud = smoothstep(uWet.y, uWet.y + 0.02, wn);
    diffuseColor.rgb *= 1.0 - 0.42 * gDamp;
    float ao = 1.0 - 0.55 * exp(-max(vPathW.x - ${g(KERB_SEA1)}, 0.0) / 0.1);
    ao *= 1.0 - 0.55 * exp(-max(${g(KERB_LAND0)} - vPathW.x, 0.0) / 0.1);
    ao *= 1.0 - 0.65 * exp(-max(length(vec2(vPathW.x - ${g(BOL_X)}, rowDz(vPathW.z, uRowZ.y, ${g(BOL_D)}))) - 0.09, 0.0) / 0.07);
    ao *= 1.0 - 0.65 * exp(-max(length(vec2(vPathW.x - ${g(LAMP_X)}, rowDz(vPathW.z, uRowZ.z, ${g(LAMP_D)}))) - 0.13, 0.0) / 0.09);
    gAO = ao;
    gSunVis = costaSunVis(vec3(vPathW.x, 0.0, vPathW.z));
  }`;
const GROUND_REFL = /* glsl */ `
  {
    vec3 gv = normalize(vViewPosition);
    vec3 gr = inverseTransformDirection(reflect(-gv, normal), viewMatrix);
    gr.y = abs(gr.y);
    float gf = 0.02 + 0.98 * pow(1.0 - clamp(dot(normal, gv), 0.0, 1.0), 5.0);
    totalEmissiveRadiance += costaSky(gr) * (gf * gPud * 0.9);
  }`;

// Playa: la lámina de agua que sube y se retira, la arena mojada que refleja el cielo, y la sombra del murete.
const BEACH_PARS = /* glsl */ `
uniform vec3 uShore;
uniform sampler2D uShoreNor;
float gFilm; float gWet; float gFoam; float gSunVis;
`;
const BEACH_MAP = /* glsl */ `
  {
    float zz = vPathW.z - uShore.x;
    vec2 sp = vec2(vPathW.x, zz);
    float n1 = 0.5 + 0.5 * sin(zz * 0.6898893 + 1.3 * sin(zz * 0.2098584));
    float fn = clamp(0.5 + (texture2D(uShoreNor, sp * 0.21 + uShore.y * 0.02).r - 0.5) * 2.6, 0.0, 1.0);
    float sw = 0.5 + 0.5 * sin(uShore.y * 0.5 - zz * 0.0452389 + 1.5 * sin(zz * 0.0131947));
    float xf = -8.1 + 1.9 * sw * sw * (3.0 - 2.0 * sw) + 0.45 * n1 + 0.5 * (fn - 0.5);   // frente de la lámina de agua
    float xw = -5.6 + 0.5 * n1;                                                          // marca de la última ola
    float back = xf - vPathW.x;                                                          // m por detrás del frente
    gFilm = smoothstep(-0.04, 0.4, back);
    // espuma: el reborde del frente y, detrás, encaje que se deshace
    gFoam = (1.0 - smoothstep(0.0, 0.16, abs(back - 0.06))) * smoothstep(0.25, 0.6, fn + 0.3)
      + gFilm * exp(-back / 0.9) * smoothstep(0.52, 0.72, fn) * 0.8;
    gFoam = clamp(gFoam, 0.0, 1.0);
    gWet = 1.0 - smoothstep(xw - 0.5, xw + 0.5, vPathW.x);
    diffuseColor.rgb *= mix(vec3(2.1, 1.95, 1.75), vec3(0.5), gWet);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.05, 0.06), gFilm * 0.45);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.82, 0.84), gFoam);
    // la sombra del murete cae sobre la arena cuando el sol queda del lado de tierra
    vec3 L = sunLocal(vPathW.z);
    float lx = abs(L.x) < 0.003 ? 0.003 : L.x;
    float t = (${g(KERB_SEA0)} - vPathW.x) / lx;
    float w = 0.01 + abs(t) * uSunL.w;
    gSunVis = t > 0.0 ? smoothstep(${g(KERB_H)} - w, ${g(KERB_H)} + w, vPathW.y + t * L.y) : 1.0;
  }`;
const BEACH_REFL = /* glsl */ `
  {
    // lo mojado refleja el mismo cielo de foto que el mar (lámina: espejo con una onda mínima; arena mojada: satinada)
    vec2 sp2 = vec2(vPathW.x, vPathW.z - uShore.x);
    vec3 sNr = texture2D(uShoreNor, sp2 * 0.093 + uShore.y * vec2(0.017, 0.013)).rgb * 2.0 - 1.0;
    // hacia el mar la lámina se riza como él: el borde recto entre la playa y el plano del mar deja de leerse
    float rip = 0.05 + 0.1 * gFilm + 0.4 * smoothstep(-6.9, -8.0, vPathW.x);
    vec3 sN = normalize(vec3(sNr.x * rip, 1.0, sNr.y * rip));
    vec3 sV = inverseTransformDirection(normalize(vViewPosition), viewMatrix);
    vec3 sR = reflect(-sV, sN);
    sR.y = abs(sR.y);
    float sF = 0.02 + 0.98 * pow(1.0 - clamp(dot(sN, sV), 0.0, 1.0), 5.0);
    totalEmissiveRadiance += costaSky(sR) * (sF * max(gFilm, 0.7 * gWet) * (1.0 - gFoam));
  }`;

const FOG_HAZE = /* glsl */ `
#ifdef USE_FOG
  {
    float hf = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, costaHaze(inverseTransformDirection(-normalize(vViewPosition), viewMatrix)), hf);
  }
#endif`;

const waterVert = (bend) => /* glsl */ `
varying vec3 vW;
varying float vBx;
varying float vFogDepth;
${bend.glsl}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vBx = bendX(w.z);
  w.x += vBx;
  vec4 mvPosition = viewMatrix * w;
  vFogDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}`;
const WATER_FRAG = /* glsl */ `
uniform sampler2D uNor, uWetNoise;
uniform vec3 uHorizon, uDeep, uSunCol;
uniform vec4 uSunL;
uniform float uS, uTime, fogDensity;
varying vec3 vW;
varying float vBx;
varying float vFogDepth;
#include <common>
${SKY_GLSL}
void main() {
  // oleaje: tres escalas del mapa de normales, ancladas al mundo que avanza (z − S) y con su propia deriva
  vec2 p = vec2(vW.x, vW.z - uS);
  vec3 n1 = texture2D(uNor, p * 0.031 + vec2(uTime * 0.011, uTime * 0.007)).rgb * 2.0 - 1.0;
  vec3 n2 = texture2D(uNor, p * 0.093 - vec2(uTime * 0.017, -uTime * 0.013)).rgb * 2.0 - 1.0;
  vec3 n3 = texture2D(uNor, p * 0.0071 + vec2(-uTime * 0.004, uTime * 0.003)).rgb * 2.0 - 1.0;
  vec3 tn = normalize(n1 + n2 * 0.7 + n3 * 1.2);
  vec3 toCam = cameraPosition - vec3(vW.x + vBx, vW.y, vW.z);
  float dist = length(toCam);
  vec3 V = toCam / dist;
  // ROMPIENTES: trenes de olas que entran hacia la playa. Cada cresta levanta el agua (cambia la normal: la cara que
  // mira a tierra se oscurece, el lomo coge cielo) y rompe en espuma que se deshace por detrás.
  float off = ${g(SEA_X)} - vW.x;                         // m mar adentro desde la orilla
  float fn = texture2D(uNor, p * 0.21 + uTime * 0.02).b;
  float fl = texture2D(uNor, p * 0.057 + vec2(0.0, uTime * 0.008)).r;
  float wob = 3.0 * sin(p.y * 0.0452389 + 1.3 * sin(p.y * 0.0131947)) + 5.0 * (fl - 0.5);
  float ph = (off + wob) / 19.0 + uTime * 0.06;
  float saw = fract(ph);
  // cada rompiente es un tramo, no una raya de punta a punta: a trozos de la costa entra más ola que a otros
  float seg = texture2D(uWetNoise, vec2(floor(ph) * 0.37, p.y * 0.0062)).r;
  float zone = smoothstep(1.0, 6.0, off) * (1.0 - smoothstep(28.0, 60.0, off)) * smoothstep(0.44, 0.58, seg + 0.3 * (fl - 0.5));
  float swell = sin(saw * 6.2831853);
  // las olas se aplanan con la distancia (sin centelleo en el horizonte)
  float flat_ = 0.35 + 0.65 * exp(-dist * 0.004);
  vec3 N = normalize(vec3(tn.x * flat_ * 0.6 + 0.22 * zone * swell * exp(-dist * 0.012), 1.0, tn.y * flat_ * 0.6));
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  vec3 refl = costaSky(R);
  // el cuerpo del agua: azul verdoso, más claro y arenoso donde cubre poco; toma la luz del cielo y algo del sol
  vec3 amb = uSkyTint * uSkyGain;
  float shallow = exp(-max(off, 0.0) / 14.0);
  vec3 body = mix(uDeep, vec3(0.09, 0.15, 0.14), shallow * 0.7) * (amb * 1.25 + uSunCol * 0.2);
  body *= 0.6 + 0.4 * clamp(N.y, 0.0, 1.0);
  vec3 col = mix(body, refl, clamp(fres, 0.0, 1.0));
  // el sol en las crestas (solo se ve cuando una curva te lo pone a un lado)
  col += uSunCol * pow(max(dot(R, uSunL.xyz), 0.0), 260.0) * 1.4;
  // espuma: la de las rompientes, la de la orilla y algo de encaje suelto
  float crest = smoothstep(0.0, 0.05, saw) * (1.0 - smoothstep(0.05, 0.34, saw));
  float lace = smoothstep(0.34, 0.7, fn + 0.42 * crest);
  float foamB = zone * crest * lace;
  float shore = -off;
  float foamS = smoothstep(-2.2, -0.2, shore) * smoothstep(0.35, 0.75, fn + 0.25 * sin(p.y * 0.0797965 + uTime * 0.6));
  float foam = clamp(max(foamB, foamS * 0.6), 0.0, 1.0);
  vec3 foamCol = (uHorizon * 1.5 + vec3(0.07)) * amb / 0.8 + uSunCol * 0.22;
  col = mix(col, foamCol, foam * 0.8);
  gl_FragColor = vec4(col, 1.0);
  float hf = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, costaHaze(-V), hf);
}`;

/* ─────────────────────────────── geometría ─────────────────────────────── */

/** Une varias BufferGeometry (posición, normal, uv) en una no indexada. */
function merge(THREE, geos) {
  const parts = geos.map((x) => (x.index ? x.toNonIndexed() : x));
  let n = 0;
  for (const x of parts) n += x.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  let o = 0;
  for (const x of parts) {
    pos.set(x.attributes.position.array, o * 3);
    nor.set(x.attributes.normal.array, o * 3);
    if (x.attributes.uv) uv.set(x.attributes.uv.array, o * 2);
    o += x.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

// Trozos de perfil (en el plano x-y) para barrer a lo largo del paseo. Se recorren en el sentido de las agujas del
// reloj: la normal queda a la izquierda del avance (hacia fuera). Las esquinas van en arco: nada de cantos vivos.
const line = (x0, y0, x1, y1) => {
  const dx = x1 - x0; const dy = y1 - y0; const l = Math.hypot(dx, dy);
  return [{ x: x0, y: y0, nx: -dy / l, ny: dx / l }, { x: x1, y: y1, nx: -dy / l, ny: dx / l }];
};
const arc = (cx, cy, r, a0, a1, n = 5) => Array.from({ length: n + 1 }, (_, i) => {
  const a = a0 + ((a1 - a0) * i) / n;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) };
});
/** Bordillo de esquinas redondeadas: cara x0 (de y0 a h), lomo, cara x1 (hasta y1). */
const kerbProfile = (x0, x1, h, r, y0, y1) => [
  line(x0, y0, x0, h - r), arc(x0 + r, h - r, r, Math.PI, Math.PI / 2, 3), line(x0 + r, h, x1 - r, h),
  arc(x1 - r, h - r, r, Math.PI / 2, 0, 3), line(x1, h - r, x1, y1),
];

/** Barre un perfil a lo largo de z (de Z0 a Z0 − LEN, NSEG tramos). uv: u = metros de perfil / uDiv, v = 0..1. */
function sweep(THREE, pieces, uDiv) {
  let nv = 0;
  for (const p of pieces) nv += p.length;
  const rings = NSEG + 1;
  const pos = new Float32Array(nv * rings * 3);
  const nor = new Float32Array(nv * rings * 3);
  const uv = new Float32Array(nv * rings * 2);
  const idx = [];
  let base = 0;
  let ulen = 0;
  for (const p of pieces) {
    for (let j = 0; j < p.length; j++) {
      if (j > 0) ulen += Math.hypot(p[j].x - p[j - 1].x, p[j].y - p[j - 1].y);
      for (let i = 0; i < rings; i++) {
        const k = (base + j) * rings + i;
        pos[k * 3] = p[j].x; pos[k * 3 + 1] = p[j].y; pos[k * 3 + 2] = Z0 - (i / NSEG) * LEN;
        nor[k * 3] = p[j].nx; nor[k * 3 + 1] = p[j].ny;
        uv[k * 2] = ulen / uDiv; uv[k * 2 + 1] = i / NSEG;
      }
    }
    for (let j = 0; j < p.length - 1; j++) {
      for (let i = 0; i < NSEG; i++) {
        const a = (base + j) * rings + i;
        const c = a + rings;
        idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
    base += p.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/** Ruido suave que se repite (dos canales distintos): dónde se queda el agua en las losas. */
function wetNoise(ctx, n = 128) {
  const { THREE } = ctx;
  const r = ctx.rng(9137);
  const layer = (cells) => {
    const v = new Float32Array(cells * cells);
    for (let i = 0; i < v.length; i++) v[i] = r();
    return (x, y) => {
      const fx = x * cells; const fy = y * cells;
      const x0 = Math.floor(fx); const y0 = Math.floor(fy);
      const tx = fx - x0; const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx); const sy = ty * ty * (3 - 2 * ty);
      const at = (i, j) => v[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    };
  };
  const chan = () => { const a = layer(4); const b = layer(8); const c = layer(16); return (x, y) => a(x, y) * 0.55 + b(x, y) * 0.3 + c(x, y) * 0.15; };
  const R = chan(); const G = chan();
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = (y * n + x) * 4;
      data[k] = Math.round(255 * R(x / n, y / n));
      data[k + 1] = Math.round(255 * G(x / n, y / n));
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export async function createTheme(ctx) {
  const { THREE, root, camera, scene, renderer } = ctx;
  camera.near = 0.08;
  camera.far = 2400;
  renderer.setClearColor(0x0b0d14, 1);
  ctx.post.set({ toneMapping: 'aces', exposure: 0.95, bloomStrength: 0.38, bloomThreshold: 1.0, bloomRadius: 0.3, vignette: 0.28, saturation: 1.04 });

  const PAVE_W = 6.3;   // ancho de la tira de losas (de debajo de un bordillo al otro)
  const BEACH_W = 4.95;

  // ── recursos (en paralelo) ──
  const [skyMeta, skyTex, envTex, paving, beach, dune, waterNor] = await Promise.all([
    loadJson(T, 'sky.json'),
    loadTex(ctx, worldUrl(T, 'sky.jpg'), { srgb: true, aniso: 1 }),
    loadTex(ctx, worldUrl(T, 'env.jpg'), { srgb: true, aniso: 1 }),
    loadSet(ctx, T, 'paving', [PAVE_W / PAVE_TILE, LEN / PAVE_TILE]),
    loadSet(ctx, T, 'beach', [BEACH_W / 4, LEN / 4]),
    loadSet(ctx, T, 'dune', [40 / 5, 600 / 5]),
    loadTex(ctx, worldUrl(T, 'water_nor.jpg'), { repeat: [1, 1], aniso: 4 }),
  ]);

  const runner = createRunner(ctx, {
    exposure: 0.95,
    finale: (p, portrait) => { p.y = portrait ? 7.5 : 6; p.z = portrait ? 6 : 5; p.lookY = 0.3; p.lookZ = -48; p.fov = portrait ? 58 : 56; },
    // PLANO FINAL: corte a la orilla, a la altura de quien se sienta en la arena: el mar entrando a la izquierda, la
    // arena mojada reflejando el amanecer, la montaña de la bahía al fondo y el paseo con sus balizas perdiéndose a la
    // derecha. La cámara avanza y sube muy despacio. Con movimiento reducido, plano fijo.
    finaleShot: (P, { clock, portrait, still }) => {
      const e = still ? 0.4 : 1 - Math.exp(-Math.min(clock, 90) / 12);
      const az = -(portrait ? 6 : 12) * Math.PI / 180;
      P.position.set(-5.2 - 0.3 * e, 0.35 + 0.5 * e, 4 - 5 * e);
      P.lookAt.set(P.position.x + 100 * Math.sin(az), P.position.y + 3 - 1.5 * e, P.position.z - 100 * Math.cos(az));
      P.fov = portrait ? 72 : 48;
    },
  });
  const bend = createBend(ctx);

  // ── cielo, entorno, luz y bruma ──
  const sky = skyDome(ctx, skyTex, skyMeta, { gain: 0.8, grad: 0.62, gradEl: 0.3 });
  root.add(sky.mesh);
  scene.environment = envFrom(ctx, envTex);
  scene.environmentIntensity = 0.8;
  const hor = new THREE.Color().setRGB(...skyMeta.horizon);
  scene.fog = new THREE.FogExp2(hor.clone().multiplyScalar(0.85), 0.0021);
  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.72, 0.5), 3);
  root.add(sun, sun.target);
  const skyU = {
    uSky: { value: skyTex }, uSkyCrop: sky.u.uCrop, uSkyTint: sky.u.uTint, uSkyGrad: sky.u.uGrad, uSkyGain: sky.u.uGain,
    uSkyRot: { value: 0 },
  };
  const sunU = { uSunL: { value: new THREE.Vector4(0, 0.15, 1, 0.012) }, uRowZ: { value: new THREE.Vector4(0, 0, 0, 0) } };
  const wetU = { uWetNoise: { value: wetNoise(ctx) }, uWet: { value: new THREE.Vector4(0, 0.6, 0, 0) } };
  const shoreU = { uShore: { value: new THREE.Vector3(0, 0, 0) }, uShoreNor: { value: waterNor } };   // x avance (m), y tiempo (s)

  // El sol solo llega donde no hay sombra: en el trozo de luces de three.js se multiplica la luz direccional por la
  // visibilidad calculada a mano. Si una versión futura cambia ese trozo, se queda sin sombras (no se rompe).
  const SUN_KEY = 'getDirectionalLightInfo( directionalLight, directLight );';
  const sunChunk = THREE.ShaderChunk?.lights_fragment_begin?.includes(SUN_KEY)
    ? THREE.ShaderChunk.lights_fragment_begin.replace(SUN_KEY, `${SUN_KEY}\n\t\tdirectLight.color *= gSunVis;`)
    : null;

  /**
   * Materiales del paseo: bruma del color del cielo, camino curvado y, según el tipo, lo propio de las losas
   * ('ground') o de la playa ('beach'). Llamar después de addLamps / addStreaks.
   */
  function costaMat(mat, kind = '') {
    const prev = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = (sh, r) => {
      prev?.call(mat, sh, r);
      Object.assign(sh.uniforms, skyU);
      let pars = SKY_GLSL;
      let fs = sh.fragmentShader;
      if (kind) {
        Object.assign(sh.uniforms, sunU, kind === 'ground' ? wetU : shoreU);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vPathW;')
          .replace('#include <project_vertex>', '#include <project_vertex>\n  vPathW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        pars = `varying vec3 vPathW;\n${SKY_GLSL}${SUN_GLSL}${kind === 'ground' ? GROUND_PARS : BEACH_PARS}`;
        fs = fs
          .replace('#include <map_fragment>', `#include <map_fragment>${kind === 'ground' ? GROUND_MAP : BEACH_MAP}`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>${kind === 'ground' ? GROUND_REFL : BEACH_REFL}`);
        if (kind === 'ground') {
          fs = fs
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor * (1.0 - 0.5 * gDamp), 0.05, gPud);')
            .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = normalize(mix(normal, nonPerturbedNormal, 0.95 * gPud));')
            .replace('#include <lights_fragment_end>', '  radiance *= 1.0 - gPud;\n#include <lights_fragment_end>')
            .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n  reflectedLight.indirectDiffuse *= gAO;\n  reflectedLight.indirectSpecular *= mix(1.0, gAO, 0.6);');
        }
        if (sunChunk) fs = fs.replace('#include <lights_fragment_begin>', sunChunk);
      }
      sh.fragmentShader = fs
        .replace('#include <common>', `#include <common>\n${pars}`)
        .replace('#include <fog_fragment>', FOG_HAZE);
    };
    mat.customProgramCacheKey = () => `${prevKey ? prevKey.call(mat) : ''}|costa-${kind || 'aire'}`;
    return bend.apply(mat);
  }

  // ── mar ──
  const waterU = {
    ...skyU, uNor: { value: waterNor }, uWetNoise: wetU.uWetNoise, uBend: bend.u.uBend, uSunL: sunU.uSunL,
    uHorizon: { value: hor }, uDeep: { value: new THREE.Color().setRGB(0.014, 0.036, 0.05) },
    uSunCol: { value: new THREE.Color(1.0, 0.62, 0.38) },
    uS: { value: 0 }, uTime: { value: 0 }, fogDensity: { value: 0.0021 },
  };
  const waterGeo = new THREE.PlaneGeometry(2400, 2420, 1, 150);
  waterGeo.rotateX(-Math.PI / 2);
  waterGeo.translate(SEA_X - 1200 + 2, -0.95, -1190);
  const water = new THREE.Mesh(waterGeo, new THREE.ShaderMaterial({ uniforms: waterU, vertexShader: waterVert(bend), fragmentShader: WATER_FRAG }));
  water.frustumCulled = false;
  root.add(water);

  // ── suelos: playa (bajo el murete), losas del paseo, dunas del lado de tierra ──
  const addMesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; root.add(m); return m; };
  // Hileras de piezas iguales: las `near` primeras (las cercanas) con todo el detalle y el resto con una versión
  // sencilla de la misma silueta. Cada pieza conserva su distancia (el grupo avanza un hueco y vuelve), así que el
  // cambio de una a otra cae siempre lejos, donde ocupa unos pocos píxeles.
  const lod = (group, geoNear, geoFar, mat, n, near, place) => {
    const a = new THREE.InstancedMesh(geoNear, mat, near);
    setInstances(ctx, a, near, place);
    const b = new THREE.InstancedMesh(geoFar, mat, n - near);
    setInstances(ctx, b, n - near, (i, t) => place(i + near, t));
    for (const m of [a, b]) { m.frustumCulled = false; group.add(m); }
  };
  const strip = (x0, x1, y) => {
    const s = new THREE.PlaneGeometry(x1 - x0, LEN, 1, NSEG);
    s.rotateX(-Math.PI / 2);
    s.translate((x0 + x1) / 2, y, Z0 - LEN / 2);
    return s;
  };
  // ARENA MOJADA: el mar sube y se retira por la playa (una lámina fina con su borde de espuma, a su ritmo en cada
  // tramo de orilla), deja la arena oscura y pulida —refleja el cielo— hasta la marca de la última ola, y arriba queda
  // la arena seca, más clara. Todo en el material de la playa: sin geometría ni llamadas nuevas.
  const beachMat = costaMat(pbr(ctx, beach, { roughness: 0.75, color: new THREE.Color(0.85, 0.8, 0.75) }), 'beach');
  addMesh(strip(SEA_X - 0.5, SEA_X - 0.5 + BEACH_W, -0.9), beachMat);
  const paveMat = pbr(ctx, paving, { roughness: 0.7, color: new THREE.Color(0.92, 0.9, 0.88), normalScale: 1.5 });
  addMesh(strip(KERB_SEA1 - 0.05, KERB_SEA1 - 0.05 + PAVE_W, 0), paveMat);
  const duneMat = costaMat(pbr(ctx, dune, { roughness: 1, color: new THREE.Color(0.9, 0.82, 0.72), normalScale: 1.5 }));
  // dunas bajas: banda ondulada (desplazada en JS; periodo 600 m, igual que la tira)
  const dg = new THREE.PlaneGeometry(70, 600, 28, 120);
  dg.rotateX(-Math.PI / 2);
  {
    const p = dg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + 35;           // 0..70 desde el bordillo
      const z = p.getZ(i);
      const ph = (z / 600) * Math.PI * 2;
      const h = Math.min(1, x / 10) * (0.6 + 1.6 * (0.5 + 0.5 * Math.sin(ph * 7 + x * 0.15)) * (0.5 + 0.5 * Math.sin(ph * 3 + 1.3)));
      p.setY(i, h * Math.min(1, x / 4));
    }
    dg.computeVertexNormals();
  }
  // la duna arranca bajo el bordillo y 2 cm por debajo de las losas: sin ranura por la que se vea el cielo
  dg.translate(KERB_LAND0 + 0.08 + 35, -0.02, -290);
  const dunes = new THREE.Mesh(dg, duneMat);
  dunes.frustumCulled = false;
  const duneGroup = new THREE.Group();
  duneGroup.add(dunes);
  const dunes2 = dunes.clone();
  dunes2.position.z = -600;
  duneGroup.add(dunes2);
  root.add(duneGroup);

  // murete del paseo con su remate redondeado (frente al mar) y bordillo de tierra: perfiles barridos, sin cantos vivos
  const stoneMat = costaMat(pbr(ctx, paving, { roughness: 0.9, color: new THREE.Color(0.7, 0.68, 0.65) }));
  addMesh(sweep(THREE, kerbProfile(KERB_SEA0, KERB_SEA1, KERB_H, 0.035, -0.97, -0.03), PAVE_W), stoneMat);
  addMesh(sweep(THREE, kerbProfile(KERB_LAND0, KERB_LAND1, 0.1, 0.03, -0.03, -0.06), PAVE_W), stoneMat);

  // ── barandilla de acero: postes cada 2,4 m (se desplazan), pasamanos y dos travesaños continuos ──
  const metal = costaMat(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.44, 0.45, 0.46), roughness: 0.5, metalness: 0.8, envMapIntensity: 1.25 }));
  const nPost = Math.ceil((AHEAD_POST + 20) / POST_D) + 2;
  const postGeo = merge(THREE, [
    new THREE.CylinderGeometry(0.022, 0.022, RAIL_TOP - KERB_H, 10).translate(0, (RAIL_TOP + KERB_H) / 2, 0),
    new THREE.CylinderGeometry(0.036, 0.04, 0.014, 12).translate(0, KERB_H + 0.007, 0),   // la pletina de anclaje
  ]);
  const postFar = new THREE.CylinderGeometry(0.022, 0.022, RAIL_TOP - KERB_H, 5, 1, true).translate(0, (RAIL_TOP + KERB_H) / 2, 0);
  const postGroup = new THREE.Group();
  lod(postGroup, postGeo, postFar, metal, nPost, 36, (i, t) => { t.p.set(RAIL_X, 0, 10 - i * POST_D); });
  root.add(postGroup);
  const railGeo = (y, r, sides) => new THREE.CylinderGeometry(r, r, LEN, sides, NSEG, true).rotateX(Math.PI / 2).translate(RAIL_X, y, Z0 - LEN / 2);
  addMesh(railGeo(RAIL_TOP, 0.027, 6), metal);
  for (const y of RAIL_MID) addMesh(railGeo(y, 0.014, 5), metal);

  // ── balizas bajas junto a la barandilla (cada 8 m): la señal cercana del color del tramo ──
  const nBol = Math.ceil((AHEAD_BOL + 20) / BOL_D) + 2;
  const V2 = (x, y) => new THREE.Vector2(x, y);
  // cuerpo torneado con la cabeza en casquete y una ranura donde va la lente
  const bolGeo = new THREE.LatheGeometry([
    V2(0.1, 0.0), V2(0.098, 0.012), V2(0.085, 0.03), V2(0.085, 0.382), V2(0.07, 0.388), V2(0.07, 0.462), V2(0.085, 0.468),
    V2(0.085, 0.49), V2(0.078, 0.522), V2(0.058, 0.548), V2(0.03, 0.562), V2(0.0, 0.565),
  ], 20);
  const dark = costaMat(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.07, 0.075, 0.08), roughness: 0.38, metalness: 0.75 }));
  const bolFar = new THREE.LatheGeometry([V2(0.1, 0.0), V2(0.085, 0.03), V2(0.085, 0.49), V2(0.058, 0.548), V2(0.0, 0.565)], 8);
  const bolLensGeo = new THREE.CylinderGeometry(0.076, 0.076, 0.074, 12, 1, true);
  bolLensGeo.translate(0, 0.425, 0);
  const bolLens = new THREE.InstancedMesh(bolLensGeo, glowMaterial(ctx, runner, { tint: '#ffd9a8', mix: 0.85, power: 5, bend }), nBol);
  const bolHalo = halos(ctx, runner, nBol, { tint: '#ffd9a8', mix: 0.85, size: 0.3, grow: 0.006, power: 0.55, fogD: 0.003, bend });
  setInstances(ctx, bolLens, nBol, (i, t) => { t.p.set(BOL_X, 0, 4 - i * BOL_D); });
  setInstances(ctx, bolHalo, nBol, (i, t) => { t.p.set(BOL_X, 0.425, 4 - i * BOL_D); });
  const bolGroup = new THREE.Group();
  lod(bolGroup, bolGeo, bolFar, dark, nBol, 14, (i, t) => { t.p.set(BOL_X, 0, 4 - i * BOL_D); });
  for (const m of [bolLens, bolHalo]) { m.frustumCulled = false; bolGroup.add(m); }
  root.add(bolGroup);

  // ── farolas cada 24 m en el lado de tierra: báculo cónico, cuello curvo y luminaria ovalada ──
  const nLamp = Math.ceil((AHEAD_LAMP + 30) / LAMP_D) + 2;
  const neck = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, POLE_H - 0.05, 0), new THREE.Vector3(-0.05, HEAD_Y + 0.22, 0), new THREE.Vector3(HEAD_DX + 0.3, HEAD_Y + 0.03, 0),
  );
  const poleGeo = merge(THREE, [
    new THREE.CylinderGeometry(0.048, 0.085, POLE_H, 12, 1, true).translate(0, POLE_H / 2, 0),
    new THREE.LatheGeometry([V2(0.145, 0.0), V2(0.14, 0.02), V2(0.115, 0.06), V2(0.105, 0.36), V2(0.085, 0.42)], 14),   // la base
    new THREE.TubeGeometry(neck, 16, 0.036, 8, false),
    new THREE.SphereGeometry(1, 18, 10).scale(0.4, 0.075, 0.16).translate(HEAD_DX, HEAD_Y, 0),
  ]);
  const poleFar = merge(THREE, [
    new THREE.CylinderGeometry(0.048, 0.085, POLE_H, 6, 1, true).translate(0, POLE_H / 2, 0),
    new THREE.TubeGeometry(neck, 6, 0.036, 5, false),
    new THREE.SphereGeometry(1, 8, 5).scale(0.4, 0.075, 0.16).translate(HEAD_DX, HEAD_Y, 0),
  ]);
  const poleMat = costaMat(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.13, 0.14, 0.15), roughness: 0.42, metalness: 0.7 }));
  // el difusor: media elipse que asoma por debajo de la luminaria
  const bulbGeo = new THREE.SphereGeometry(1, 12, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.3, 0.05, 0.115).translate(HEAD_DX - 0.02, HEAD_Y - 0.03, 0);
  const bulbs = new THREE.InstancedMesh(bulbGeo, glowMaterial(ctx, runner, { tint: '#ffe2b8', mix: 0.35, power: 7, bend }), nLamp);
  const lampHalo = halos(ctx, runner, nLamp, { tint: '#ffe2b8', mix: 0.35, size: 0.9, grow: 0.008, power: 0.5, fogD: 0.0025, bend });
  setInstances(ctx, bulbs, nLamp, (i, t) => { t.p.set(LAMP_X, 0, 12 - i * LAMP_D); });
  setInstances(ctx, lampHalo, nLamp, (i, t) => { t.p.set(LAMP_X + HEAD_DX, HEAD_Y - 0.12, 12 - i * LAMP_D); });
  const lampGroup = new THREE.Group();
  lod(lampGroup, poleGeo, poleFar, poleMat, nLamp, 8, (i, t) => { t.p.set(LAMP_X, 0, 12 - i * LAMP_D); });
  for (const m of [bulbs, lampHalo]) { m.frustumCulled = false; lampGroup.add(m); }
  root.add(lampGroup);

  // charcos de luz en las losas (farolas y balizas), con el color del tramo
  const rowLamp = new THREE.Vector4(LAMP_X + HEAD_DX, HEAD_Y - 0.15, LAMP_D, 0);
  const rowBol = new THREE.Vector4(BOL_X, 0.425, BOL_D, 0);
  const lampU = addLamps(paveMat, ctx, runner, [rowLamp, rowBol], { tint: '#ffd9a8', mix: 0.55, power: 9, range: 16, bend });
  // losas mojadas por el relente: cada baliza deja su estela del color del tramo, alargada hacia ti (calidad media o
  // alta). Las farolas no: probado, sus reflejos caían como dos barras pálidas en mitad del paseo y no mejoraba.
  const streakU = ctx.qualityLevel >= 2
    ? addStreaks(paveMat, ctx, runner, [rowBol], { tint: '#ffd9a8', mix: 0.85, power: 2.2, width: 0.1, blur: 0.003, near: 1.2, far: 0.25, jitter: 0.1, dry: 0.7, reach: 120, bend })
    : null;
  costaMat(paveMat, 'ground');

  // ── escenario vivo (web 1.15): el amanecer avanza con la clase. Empiezas en la hora azul con las farolas encendidas y
  //    acabas con el día hecho: el sol asoma a tu espalda y sube, las sombras nacen larguísimas y se van recogiendo, el
  //    cielo se aclara y las farolas se apagan (las balizas del color del tramo siguen: son la señal de velocidad) ──
  const fogBase = scene.fog.color.clone();
  const blue = new THREE.Color(0.5, 0.64, 1.05);
  const white = new THREE.Color(1, 1, 1);
  // pleno día (solo con «Tiempo real» a mediodía): la foto es de amanecer; se enfría hacia azul cielo, se quita el
  // degradado oscuro de arriba y el sol pasa de naranja a blanco
  const noonTint = new THREE.Color(0.86, 1.0, 1.22);
  const sunLow = new THREE.Color(1.0, 0.5, 0.24);
  const sunWarm = new THREE.Color(1.0, 0.74, 0.5);
  const sunNoon = new THREE.Color(1.0, 0.95, 0.88);
  const grad0 = sky.u.uGrad.value.x;
  const P0 = { bulb: bulbs.material.uniforms.uPower.value, halo: lampHalo.material.uniforms.uPower.value, lamp: lampU.uLampPower.value };
  const totalSec = Math.max(60, ctx.timeline.totalSec);
  const grey = new THREE.Color(0.7, 0.74, 0.8);
  const fogD0 = scene.fog.density;
  const sunDir = new THREE.Vector3();
  const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  startLiveWeather();   // «Tiempo real» (Ajustes): la hora y el tiempo del sitio elegido
  const rain = createRain(ctx, { count: ctx.qualityLevel >= 2 ? 1600 : 900, color: [0.4, 0.42, 0.48] });
  root.add(rain.mesh);
  function dawn(f, S) {
    // con «Tiempo real» manda la hora del sitio elegido; si no, el amanecer avanza con la clase
    const w = liveWeather();
    const p = Math.min(1, Math.max(0, f.t / (totalSec * 0.92)));
    const d = w ? w.day : p * p * (3 - 2 * p);
    const cloud = w ? w.cloud : 0;
    // mediodía: solo el tiempo real llega aquí (sol alto); el amanecer de la clase se queda en la luz dorada
    const noon = w ? Math.min(1, Math.max(0, (w.sunEl - 12) / 22)) * (1 - 0.6 * cloud) : 0;
    const gain = (0.42 + 0.46 * d + 0.32 * noon) * (1 - 0.4 * cloud) * (w && d < 0.05 ? 0.6 : 1);
    sky.u.uGain.value = gain;
    sky.u.uGrad.value.x = grad0 * (1 - 0.7 * noon);
    sky.u.uTint.value.copy(blue).lerp(white, d).lerp(noonTint, noon).lerp(grey, 0.75 * cloud);
    scene.fog.density = fogD0 * (1 + 1.4 * cloud + (w ? 3 * w.mist : 0));
    waterU.fogDensity.value = scene.fog.density;
    rain.update(f, S, w ? w.rain : 0);
    // EL SOL. Altura: la real con «Tiempo real»; si no, de −3° a 14° con la clase (asoma hacia el primer cuarto)
    const el = w ? Math.min(62, Math.max(-8, w.sunEl)) : -3 + 17 * d;
    const up = sst(-0.8, 5.5, el) * (1 - 0.75 * cloud);
    const elR = Math.max(el, 1.6) * DEG;       // la dirección no baja de 1,6°: las sombras no se hacen infinitas
    const azR = SUN_AZ - bend.heading;         // en tu marco: el mundo gira al tomar las curvas
    sunDir.set(Math.sin(azR) * Math.cos(elR), Math.sin(elR), -Math.cos(azR) * Math.cos(elR));
    sun.position.copy(sunDir).multiplyScalar(100);
    sun.color.copy(sunLow).lerp(sunWarm, sst(0, 9, el)).lerp(sunNoon, noon);
    // sol bajo: mucha luz en lo que mira al sol y poca en el suelo. Al subir (solo con «Tiempo real») se contiene para
    // que el suelo no se queme: lo que llega a las losas no pasa de lo que llega al final del amanecer
    sun.intensity = Math.min(7.5, 1.9 / Math.max(0.05, Math.sin(elR))) * (1 - 0.15 * noon) * up;
    // penumbra: el sol recién salido, entre la bruma, es una luz ancha; arriba, casi un punto
    sunU.uSunL.value.set(sunDir.x, sunDir.y, sunDir.z, 0.016 - 0.009 * sst(2, 12, el) + 0.03 * cloud);
    waterU.uSunCol.value.copy(sun.color).multiplyScalar(up);
    scene.environmentIntensity = 0.4 + 0.3 * d + 0.3 * noon;
    scene.fog.color.copy(fogBase).multiplyScalar(0.55 + 0.45 * d).multiply(sky.u.uTint.value);
    // más charcos si llueve; con el sol alto el relente se va secando
    wetU.uWet.value.y = 0.6 - 0.14 * (w ? w.rain : 0) + 0.05 * noon;
    const on = 1 - Math.min(1, Math.max(0, (d - 0.62) / 0.3));
    bulbs.material.uniforms.uPower.value = P0.bulb * (0.12 + 0.88 * on);
    lampHalo.material.uniforms.uPower.value = P0.halo * on;
    lampU.uLampPower.value = P0.lamp * (0.3 + 0.7 * on);
    if (streakU) {
      // la estela de las balizas (color del tramo) se queda toda la clase, más discreta a pleno sol
      streakU.uStreakRowK.value[0] = 1 - 0.55 * d;
    }
  }

  const inst = {
    director: { scale: 0.9, maxDown: 0.15, orbit: true },
    resize(s) { runner.resize(s); },
    update(f) {
      const st = runner.update(f);
      const S = st.S;
      // el camino: rumbo en tu posición ⇒ el cielo, el entorno y (en dawn) el sol giran contigo
      const head = bend.update(S);
      sky.mesh.rotation.y = head;
      skyU.uSkyRot.value = head;
      scene.environmentRotation.y = head;
      // miras un poco hacia donde va la curva, como al correr
      if (!(f.finale > 0)) ctx.rig.target.lookAt.x = bend.xAt(-55) * (100 / 55) * 0.4;
      // suelos: la textura avanza (offset en repeticiones del tile)
      paving.offset.y = (S / PAVE_TILE) % 1;
      beach.offset.y = (S / 4) % 1;
      duneGroup.position.z = scrollZ(S, 600);
      dune.offset.y = 0;
      postGroup.position.z = scrollZ(S, POST_D);
      bolGroup.position.z = scrollZ(S, BOL_D);
      lampGroup.position.z = scrollZ(S, LAMP_D);
      rowLamp.w = lampGroup.position.z + 12;
      rowBol.w = bolGroup.position.z + 4;
      sunU.uRowZ.value.set(postGroup.position.z + 10, rowBol.w, rowLamp.w, 0);
      dawn(f, S);
      // periodo de 10 km: múltiplo exacto de las repeticiones de las escalas del oleaje (0,031 · 0,093 · 0,0071 ·
      // 0,21 · 0,057), así al dar la vuelta no hay salto
      waterU.uS.value = S % 10000;
      waterU.uTime.value = st.rm ? 0 : f.time;
      shoreU.uShore.value.set(waterU.uS.value, waterU.uTime.value % 3600, 0);
      wetU.uWet.value.x = S % 480;   // 480 m: múltiplo de las dos escalas del ruido de los charcos (24 m y 8 m)
    },
    event(type, data) { runner.event(type, data); },
    get _debug() { return { ...runner.debug(), heading: bend.heading }; },
    dispose() { scene.environmentRotation.set(0, 0, 0); },
  };
  return inst;
}
