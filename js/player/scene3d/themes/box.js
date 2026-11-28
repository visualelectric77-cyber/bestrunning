// RITMUP · escenario BOX (js/player/scene3d/themes/box.js; su laboratorio y el horneado, en tools/box-bake/). El mundo de las clases AMRAP:
// una nave industrial convertida en box, sin fin, que recorres por una pista de tartán a tu velocidad REAL.
//  · La nave son módulos de 24 m (dos variantes, también en espejo) con la luz HORNEADA en Blender (tools/box-bake/):
//    tres grupos que aquí se mezclan en vivo — tungsteno (campanas), neón (del color de tu zona) y amanecer (lucernarios)
//    — por vértice en la estructura y el material, y en mapa de luz en el suelo y los muros.
//  · Reflejos del metal con un panorama del interior horneado (un grupo por canal) y reflejos analíticos de las campanas
//    y del neón en el suelo. Sin luces de three ni mapas de sombras.
//  · La AMRAP (box/amrap.js): pórtico con reloj LED al final de la ronda, metros pintados, pizarra y campana al final.
// El escenario espera del reproductor los eventos 'amrap' (estado de cada tick), 'amrapPhase' y 'amrapEnd' (ver LEEME).
import { createRunner } from './kit/runner.js';
import { worldUrl } from './kit/world.js';
import { createAmrap } from './box/amrap.js';

export const meta = {
  id: 'box',
  name: 'Box',
  description: 'Una nave de CrossFit al amanecer: pista de tartán, tungsteno y neón del color de tu tramo. Para las AMRAP.',
};

const DEF_BASE = worldUrl('box', '');
const base = () => (globalThis.__BOX_ASSETS || DEF_BASE);
const texBase = () => (globalThis.__BOX_TEX || worldUrl('box', 'tex/'));

const MOD = 24;
const PERIOD = 96;        // A B A' B' (los dos últimos en espejo)
const FAR = 250;          // hasta dónde se pinta la nave (m)

export const COMMON = /* glsl */ `
uniform vec3 uLT0, uLN0, uLD0, uLT1, uLN1, uLD1;   // radiancia de cada grupo: 0 = lo de antes, 1 = lo nuevo
uniform float uFront;                              // el cambio de luz avanza por la nave: m por delante ya cambiados
uniform vec3 uAmb, uFogCol;
uniform float uFogD, uLmK, uEnvK, uS, uTime;
uniform sampler2D uEnv, uLm;
void lights(float srel, out vec3 LT, out vec3 LN, out vec3 LD) {
  float w = smoothstep(uFront - 9.0, uFront + 9.0, srel);
  LT = mix(uLT1, uLT0, w); LN = mix(uLN1, uLN0, w); LD = mix(uLD1, uLD0, w);
}
vec3 envRad(vec3 d, float lod, vec3 LT, vec3 LN, vec3 LD) {
  vec2 uv = vec2(0.5 + atan(d.x, -d.z) / 6.2831853, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.14159265);
  vec3 e = uEnvK * pow(textureLod(uEnv, uv, lod).rgb, vec3(2.2));
  return e.r * LT + e.g * LN + e.b * LD;
}
vec3 fogged(vec3 col, float dist) {
  float f = 1.0 - exp(-dist * uFogD);
  return mix(col, uFogCol, f);
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float paneK(vec2 cell) { float h = hash12(cell); return h < 0.11 ? 0.1 : 0.45 + 0.55 * fract(h * 7.31); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
// mapa de luz del suelo en un punto (x, metros de nave): el módulo, su variante y si va en espejo salen de la posición
vec3 lmFloor(vec2 p) {
  float k = floor(p.y / 24.0);
  float ly = p.y - 24.0 * k;
  float var = mod(k, 2.0);
  float x = mod(floor(k * 0.5), 2.0) > 0.5 ? -p.x : p.x;
  vec2 uv = vec2((var + clamp((x + 12.0) / 24.0, 0.002, 0.998)) * 0.5, clamp(ly / 24.0, 0.002, 0.998) * 0.5);
  return uLmK * pow(texture2D(uLm, uv).rgb, vec3(2.2));
}
vec3 lmWall(float side, float yw, float h) {
  float k = floor(yw / 24.0);
  float ly = yw - 24.0 * k;
  float var = mod(k, 2.0);
  float s = mod(floor(k * 0.5), 2.0) > 0.5 ? -side : side;
  vec2 uv = vec2((var + clamp(ly / 24.0, 0.002, 0.998)) * 0.5, 0.5 + (s > 0.0 ? 0.25 : 0.0) + clamp(h / 11.0, 0.004, 0.996) * 0.25);
  return uLmK * pow(texture2D(uLm, uv).rgb, vec3(2.2));
}
`;

const MOD_VERT = /* glsl */ `
attribute vec4 aAlb, aLit;
uniform float uLmKv;
varying vec3 vW, vN, vAlb, vLit, vL;
varying vec3 vMat;   // rugosidad, metal, emisor
varying float vWood;
void main() {
  #ifdef USE_INSTANCING
  mat4 M = modelMatrix * instanceMatrix;
  #else
  mat4 M = modelMatrix;
  #endif
  vec4 w = M * vec4(position, 1.0);
  vW = w.xyz;
  vN = mat3(M) * normal;
  vAlb = pow(aAlb.rgb, vec3(2.2));
  vLit = uLmKv * pow(aLit.rgb, vec3(2.2));
  float code = floor(aLit.a * 255.0 + 0.5);
  float metal = mod(code, 2.0);
  vMat = vec3(aAlb.a, metal, mod(floor(code * 0.5), 4.0));
  vWood = floor(code / 8.0);
  vL = position;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const MOD_FRAG = /* glsl */ `
${COMMON}
uniform vec3 uEm;        // brillo de cada emisor (bombilla, neón, cristal)
uniform float uSpecK;
varying vec3 vW, vN, vAlb, vLit, vL;
varying vec3 vMat;
varying float vWood;
void main() {
  vec3 LT, LN, LD; lights(-vW.z, LT, LN, LD);
  vec3 col;
  if (vMat.z > 0.5) {
    if (vMat.z < 1.5) col = LT * uEm.x;
    else if (vMat.z < 2.5) col = LN * uEm.y;
    else {
      vec2 pane = floor(vec2(vW.x / 1.5 + 8.0, vW.y / 1.5));
      float g = mix(1.0, paneK(pane + floor((uS - vW.z) / 12.0 + 0.5) * 7.0), 0.32);
      float grime = 0.72 + 0.28 * vnoise(vec2(vW.x * 0.8, vW.y * 1.3));                 // suciedad en nubes
      float streak = 0.86 + 0.14 * vnoise(vec2(vW.x * 9.0, vW.y * 0.5));               // chorretones
      float wire = 0.94 + 0.06 * step(0.5, fract(vW.x * 20.0)) * step(0.5, fract(vW.y * 20.0));   // cristal armado
      col = LD * uEm.z * g * grime * streak * wire * (0.72 + 0.28 * smoothstep(8.0, 11.0, vW.y));
    }
  } else {
    vec3 N = normalize(vN);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vW);
    vec3 irr = vLit.r * LT + vLit.g * LN + vLit.b * LD + uAmb;
    float rough = vMat.x, metal = vMat.y;
    vec3 alb = vAlb;
    if (vWood > 0.5) {     // veta del contrachapado, a lo largo de la cara
      vec3 an = abs(N);
      vec2 q = an.y > an.x && an.y > an.z ? vL.xz : (an.x > an.z ? vL.zy : vL.xy);
      float gr = vnoise(vec2(q.x * 2.6, q.y * 44.0)) * 0.6 + vnoise(vec2(q.x * 8.0 + 4.0, q.y * 150.0)) * 0.4;
      alb *= 0.72 + 0.52 * gr;
      rough = clamp(rough + 0.2 * (gr - 0.5), 0.2, 1.0);
    }
    float nv = clamp(dot(N, V), 0.0, 1.0);
    vec3 R = reflect(-V, N);
    vec3 env = envRad(R, 1.0 + rough * 6.0, LT, LN, LD);
    float fr = pow(1.0 - nv, 5.0);
    vec3 F0 = mix(vec3(0.04), alb, metal);
    vec3 F = F0 + (max(vec3(1.0 - rough), F0) - F0) * fr;
    // el reflejo se apaga donde no llega luz (rincones): la luz horneada del punto hace de oclusión
    float occ = clamp(dot(vLit, vec3(0.45)) * 1.6 + 0.08, 0.0, 1.0);
    col = alb * irr * (1.0 - metal) + env * F * occ * uSpecK * mix(1.0, 0.75, rough);
  }
  col = fogged(col, length(cameraPosition - vW));
  gl_FragColor = vec4(col, 1.0);
}`;

const FLAT_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FLOOR_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D uRub, uRubN, uTrk, uTrkN;
uniform vec3 uTrkTint;
uniform vec3 uLamp;      // radiancia de la boca de una campana (× nivel de tungsteno ya en LT)
uniform vec2 uNeonK;     // brillo del reflejo del neón (pilares, muros)
uniform float uHi;       // 1 = calidad alta (reflejos analíticos del neón)
varying vec3 vW;
void main() {
  float srel = -vW.z;
  vec2 p = vec2(vW.x, uS + srel);
  vec3 LT, LN, LD; lights(srel, LT, LN, LD);
  float dist = length(cameraPosition - vW);
  float ax = abs(p.x);
  float aa = max(fwidth(p.x), 1e-4);
  float lane = 1.0 - smoothstep(1.56 - aa, 1.56 + aa, ax);
  // ── albedo: caucho de gimnasio a los lados, pista de tartán en el centro ──
  vec3 rub = texture2D(uRub, p * 0.5).rgb;
  float speck = step(0.93, hash12(floor(p * 260.0)));                     // granulado claro del caucho
  vec3 alb = rub * 0.85 + vec3(0.05) * speck * smoothstep(14.0, 2.0, dist);
  float dust = smoothstep(0.52, 0.8, vnoise(p * 0.9) * 0.6 + vnoise(p * 3.1) * 0.4) * smoothstep(1.6, 2.4, ax);
  alb = mix(alb, vec3(0.2, 0.2, 0.19), dust * 0.22);                       // magnesio pisado
  vec3 trk = texture2D(uTrk, p * 0.5).rgb;
  float tl = dot(trk, vec3(0.33));
  vec3 tartan = uTrkTint * (0.78 + 0.7 * tl) * (0.94 + 0.12 * vnoise(p * vec2(0.5, 0.13)));
  alb = mix(alb, tartan, lane);
  // líneas de la pista: bordes, tres calles, marcas cada 5 y cada 10 m
  float ay = max(fwidth(p.y), 1e-4);
  float ln = (1.0 - smoothstep(0.04 - aa, 0.04 + aa, abs(ax - 1.5))) + (1.0 - smoothstep(0.025 - aa, 0.025 + aa, abs(ax - 0.5)));
  float y5 = abs(fract(p.y / 5.0 + 0.5) - 0.5) * 5.0;
  float y10 = abs(fract(p.y / 10.0 + 0.5) - 0.5) * 10.0;
  float tick = (1.0 - smoothstep(0.03 - ay, 0.03 + ay, y5)) * smoothstep(1.16 - aa, 1.18 + aa, ax) * lane;
  float bar = (1.0 - smoothstep(0.035 - ay, 0.035 + ay, y10)) * lane * 0.55;
  float paint = clamp(ln + tick + bar, 0.0, 1.0) * (0.72 + 0.28 * vnoise(p * 9.0)) * mix(1.0, 0.0, clamp(ay * 6.0 - 0.6, 0.0, 1.0) * (1.0 - clamp(ln, 0.0, 1.0)));
  alb = mix(alb, vec3(0.62, 0.62, 0.6), paint * 0.92);
  // ── luz horneada ──
  vec3 lm = lmFloor(p);
  vec3 irr = lm.r * LT + lm.g * LN + lm.b * LD + uAmb;
  vec3 col = alb * irr;
  // ── brillo: relieve de la textura + reflejo del interior + reflejos analíticos de campanas y neón ──
  vec3 nt = mix(texture2D(uRubN, p * 0.5).xyz, texture2D(uTrkN, p * 0.5).xyz, lane) * 2.0 - 1.0;
  float nk = mix(0.55, 0.9, lane) * smoothstep(60.0, 6.0, dist);
  vec3 N = normalize(vec3(nt.x * nk, 1.0, -nt.y * nk));
  vec3 V = normalize(cameraPosition - vW);
  float rough = mix(0.27 + 0.22 * dust, 0.6, lane) * mix(1.0, 1.25, paint);
  float nv = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.04 + (1.0 - rough) * 0.96 * pow(1.0 - nv, 5.0);
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.02);
  float occ = clamp(dot(lm, vec3(0.5)) * 1.4 + 0.25, 0.0, 1.0);
  vec3 spec = envRad(R, 2.5 + rough * 5.0, LT, LN, LD) * 0.8;
  // campanas: retícula (±2,9 ; 4,36 m ; cada 12 m desde 6) y (±8,3 ; 5,36 m ; cada 12 m)
  vec3 Rn = vec3(R.x, R.y, -R.z);   // en metros de nave: z → avance
  for (int i = 0; i < 2; i++) {
    float h = i == 0 ? 4.36 : 5.36;
    float lx = i == 0 ? 2.9 : 8.3;
    float off = i == 0 ? 6.0 : 0.0;
    float t = h / Rn.y;
    vec2 hit = p + Rn.xz * t;
    float ly = off + 12.0 * floor((hit.y - off) / 12.0 + 0.5);
    vec2 d = vec2(abs(hit.x) - lx, hit.y - ly);
    float sig = 0.3 + rough * t * 0.2;
    spec += uLamp * LT * exp(-dot(d, d) / (2.0 * sig * sig)) * (0.09 / (sig * sig)) * (i == 0 ? 1.0 : 0.7);
  }
  if (uHi > 0.5) {
    // tubo corrido de los muros (x = ±11,9 ; 4,3 m)
    float sx = Rn.x > 0.0 ? 1.0 : -1.0;
    float tw = (sx * 11.9 - p.x) / (Rn.x + sx * 1e-4);
    float dh = Rn.y * tw - 4.3;
    float sgw = 0.05 + rough * tw * 0.12;
    spec += LN * uNeonK.y * exp(-dh * dh / (2.0 * sgw * sgw)) * (0.045 / sgw);
    // barras de los pilares (x = ±4,51 ; de 2,2 a 5 m ; cada 12 m)
    float j0 = floor(p.y / 12.0) + 1.0;
    for (int j = 0; j < 4; j++) {
      float yc = (j0 + float(j)) * 12.0;
      float tc = (yc - p.y) / max(Rn.z, 1e-3);
      float hx = p.x + Rn.x * tc;
      float hy = Rn.y * tc;
      float sg = 0.035 + rough * tc * 0.08;
      float dx = abs(hx) - 4.51;
      spec += LN * uNeonK.x * exp(-dx * dx / (2.0 * sg * sg)) * (0.03 / sg) * smoothstep(1.9, 2.4, hy) * (1.0 - smoothstep(4.9, 5.6, hy));
    }
  }
  col += spec * fres * occ;
  col = fogged(col, dist);
  gl_FragColor = vec4(col, 1.0);
}`;
const WALL_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D uBrick, uBrickN;
uniform float uSide;
varying vec3 vW;
void main() {
  float srel = -vW.z;
  float yw = uS + srel;
  vec3 LT, LN, LD; lights(srel, LT, LN, LD);
  float dist = length(cameraPosition - vW);
  vec2 uv = vec2(yw, vW.y);
  vec3 alb = texture2D(uBrick, uv).rgb * (0.8 + 0.35 * vnoise(uv * 0.21)) * (0.9 + 0.2 * vnoise(uv * 0.043 + 3.0));
  vec3 nt = texture2D(uBrickN, uv).xyz * 2.0 - 1.0;
  float paint = 1.0 - smoothstep(2.28, 2.31, vW.y + 0.012 * sin(yw * 9.0));
  alb = mix(alb, vec3(0.022, 0.022, 0.024) * (0.8 + 0.4 * dot(alb, vec3(1.2))), paint);
  alb *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.5, vW.y)) * vnoise(vec2(yw * 0.8, 2.0));   // roce junto al suelo
  vec3 lm = lmWall(uSide, yw, vW.y);
  vec3 irr = lm.r * LT + lm.g * LN + lm.b * LD + uAmb;
  // relieve de las juntas: la luz baja de las campanas y del tubo (desde arriba y de frente)
  float relief = 0.72 + 0.5 * clamp(dot(normalize(nt), normalize(vec3(0.0, 0.75, 0.66))), 0.0, 1.0);
  vec3 col = alb * irr * mix(relief, 1.0, smoothstep(10.0, 70.0, dist));
  // pintura satinada del zócalo: un poco de reflejo
  vec3 V = normalize(cameraPosition - vW);
  vec3 N = normalize(vec3(-uSide, 0.0, 0.0) + vec3(0.0, nt.y, -nt.x) * 0.25);
  float fr = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  col += envRad(reflect(-V, N), 4.5, LT, LN, LD) * (0.03 + 0.5 * fr) * paint * clamp(dot(lm, vec3(0.6)) + 0.2, 0.0, 1.0);
  col = fogged(col, dist);
  gl_FragColor = vec4(col, 1.0);
}`;

// halos de las campanas y del neón de los pilares: discos y barras que miran a cámara (uno por módulo, instanciado)
const GLOW_VERT = /* glsl */ `
attribute vec3 aCenter;
attribute vec3 aInfo;    // esquina x, esquina y, tipo (0 campana, 1 barra de neón)
attribute vec2 aSize;
varying vec2 vUv; varying float vKind; varying float vSrel; varying float vDist;
void main() {
  vec4 c = modelMatrix * instanceMatrix * vec4(aCenter, 1.0);
  vec3 toCam = cameraPosition - c.xyz;
  vDist = length(toCam);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 up = aInfo.z > 0.5 ? vec3(0.0, 1.0, 0.0) : normalize(cross(toCam, right));
  float grow = aInfo.z > 0.5 ? 1.0 : 1.0 + vDist * 0.012;
  vec3 w = c.xyz + right * aInfo.x * aSize.x * grow + up * aInfo.y * aSize.y * grow;
  vUv = aInfo.xy; vKind = aInfo.z; vSrel = -c.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const GLOW_FRAG = /* glsl */ `
${COMMON}
uniform vec2 uGlowK;
varying vec2 vUv; varying float vKind; varying float vSrel; varying float vDist;
void main() {
  vec3 LT, LN, LD; lights(vSrel, LT, LN, LD);
  float a;
  vec3 c;
  if (vKind < 0.5) {
    float r = length(vUv);
    a = exp(-r * r * 9.0) * 0.55 + exp(-r * r * 60.0) * 0.9;
    a *= 1.0 - smoothstep(0.75, 1.0, r);
    c = LT * uGlowK.x;
  } else {
    float dx = abs(vUv.x);
    a = exp(-dx * dx * 14.0) * (1.0 - smoothstep(0.78, 1.0, abs(vUv.y))) * (1.0 - smoothstep(0.8, 1.0, dx));
    c = LN * uGlowK.y;
  }
  float tr = exp(-vDist * uFogD);
  gl_FragColor = vec4(c * a * tr * (1.0 - smoothstep(60.0, 150.0, vDist)), 1.0);
}`;
// conos de luz bajo las campanas (el polvo de magnesio en el aire)
const CONE_VERT = /* glsl */ `
attribute float aH;
varying vec3 vW, vN; varying float vH;
void main() {
  mat4 M = modelMatrix * instanceMatrix;
  vec4 w = M * vec4(position, 1.0);
  vW = w.xyz; vN = mat3(M) * normal; vH = aH;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const CONE_FRAG = /* glsl */ `
${COMMON}
uniform float uConeK;
varying vec3 vW, vN; varying float vH;
void main() {
  vec3 LT, LN, LD; lights(-vW.z, LT, LN, LD);
  vec3 V = normalize(cameraPosition - vW);
  float nv = abs(dot(normalize(vN), V));
  float body = pow(nv, 1.6);
  float fall = 1.0 / (1.0 + vH * vH * 1.4) * (1.0 - smoothstep(0.82, 1.0, vH)) * smoothstep(0.0, 0.05, vH);
  float dist = length(cameraPosition - vW);
  float dustN = 0.75 + 0.25 * vnoise(vec2(vW.x * 1.3 + uTime * 0.05, vW.y * 1.1 - uTime * 0.03 + vW.z * 0.4));
  gl_FragColor = vec4(LT * uConeK * body * fall * dustN * exp(-dist * uFogD * 0.7) * smoothstep(1.5, 5.0, dist), 1.0);
}`;

// haces del amanecer: por cada lucernario, la losa de aire que ilumina (analítica: longitud del rayo dentro de la losa,
// con las sombras de la carpintería y el brillo de cada cristal). Se pinta el volumen que la contiene, sin test de fondo.
const SHAFT_VERT = /* glsl */ `
attribute float aZg;
varying vec3 vW; varying float vZg;
void main() {
  mat4 M = modelMatrix * instanceMatrix;
  vec4 w = M * vec4(position, 1.0);
  vW = w.xyz; vZg = M[3].z + aZg;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const SHAFT_FRAG = /* glsl */ `
${COMMON}
uniform vec3 uSun; uniform float uShaftK;
varying vec3 vW; varying float vZg;
void main() {
  vec3 C = cameraPosition;
  vec3 v = normalize(vW - C);
  vec3 n1 = normalize(vec3(0.0, -uSun.z, uSun.y));
  float s0 = dot(n1, C - vec3(0.0, 8.0, vZg));
  float sv = dot(n1, v);
  float thick = 3.0 * n1.y;
  float ta = (thick - s0) / sv, tb = -s0 / sv;
  float t0 = max(min(ta, tb), 0.0), t1 = max(ta, tb);
  float tz = (vZg - C.z) / (abs(v.z) > 1e-4 ? v.z : -1e-4);
  if (v.z < 0.0) t1 = min(t1, tz); else t0 = max(t0, tz);
  if (v.y < -1e-4) t1 = min(t1, -C.y / v.y);
  if (abs(v.x) > 1e-4) t1 = min(t1, ((v.x > 0.0 ? 11.9 : -11.9) - C.x) / v.x);
  float L = t1 - t0;
  if (L <= 0.0) discard;
  vec3 LT, LN, LD; lights(-vZg, LT, LN, LD);
  float acc = 0.0;
  float jit = hash12(gl_FragCoord.xy);
  for (int i = 0; i < 5; i++) {
    vec3 p = C + v * (t0 + L * (float(i) + jit) / 5.0);
    float tp = (p.z - vZg) / uSun.z;
    vec2 g = vec2(p.x - uSun.x * tp, p.y - uSun.y * tp);        // por qué punto del lucernario entró
    vec2 q = vec2(g.x / 1.5 + 8.0, g.y / 1.5);
    vec2 f = abs(fract(q) - 0.5);
    float frame = smoothstep(0.5, 0.44, f.x) * smoothstep(0.5, 0.45, abs(fract((g.y - 8.0) / 1.5) - 0.5));
    float pane = paneK(floor(q) + floor((uS - vZg) / 12.0 + 0.5) * 7.0);
    float dustN = 0.7 + 0.3 * vnoise(vec2(p.x * 0.9 + uTime * 0.04, p.y * 1.3 + p.z * 0.5 - uTime * 0.02));
    acc += frame * pane * dustN * exp(-length(p - C) * uFogD);
  }
  float ph = 0.35 + 1.5 * pow(max(dot(v, -uSun), 0.0), 3.0);
  float nearK = smoothstep(0.0, 1.5, t0 + L);
  gl_FragColor = vec4(LD * uShaftK * acc * 0.2 * L * ph * nearK, 1.0);
}`;

async function loadTexture(ctx, url, { srgb = false, repeat = true, mips = true } = {}) {
  const { THREE } = ctx;
  return new Promise((res, rej) => new THREE.TextureLoader().load(url, (t) => {
    t.flipY = false;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.generateMipmaps = mips;
    t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = mips ? Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy()) : 1;
    t.needsUpdate = true;
    res(t);
  }, undefined, () => rej(new Error(`box: no se pudo cargar ${url}`))));
}

async function loadModule(THREE, url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  const hl = dv.getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
  const off = 4 + hl;
  const n = head.count;
  const st = head.stride;
  const pos = new Float32Array(n * 3), nor = new Int8Array(n * 3), alb = new Uint8Array(n * 4), lit = new Uint8Array(n * 4);
  const u8 = new Uint8Array(buf, off, n * st);
  const d = new DataView(buf, off, n * st);
  for (let i = 0; i < n; i++) {
    const o = i * st;
    pos[i * 3] = d.getFloat32(o, true); pos[i * 3 + 1] = d.getFloat32(o + 4, true); pos[i * 3 + 2] = d.getFloat32(o + 8, true);
    nor[i * 3] = d.getInt8(o + 12); nor[i * 3 + 1] = d.getInt8(o + 13); nor[i * 3 + 2] = d.getInt8(o + 14);
    alb.set(u8.subarray(o + 16, o + 20), i * 4);
    lit.set(u8.subarray(o + 20, o + 24), i * 4);
  }
  const idx = new Uint32Array(buf.slice(off + n * st, off + n * st + head.index * 4));
  const attrs = {
    position: new THREE.BufferAttribute(pos, 3), normal: new THREE.BufferAttribute(nor, 3, true),
    aAlb: new THREE.BufferAttribute(alb, 4, true), aLit: new THREE.BufferAttribute(lit, 4, true),
  };
  const index = new THREE.BufferAttribute(idx, 1);
  const mk = (count) => {
    const g = new THREE.BufferGeometry();
    for (const k in attrs) g.setAttribute(k, attrs[k]);
    g.setIndex(index);
    g.setDrawRange(0, count);
    return g;
  };
  return { full: mk(head.index), struct: mk(head.struct), tris: head.index / 3, structTris: head.struct / 3 };
}

/** Geometría suelta con los mismos atributos que los módulos (para el pórtico, la pizarra, la campana…). */
export function propGeometry(THREE, parts) {
  const P = [], N = [], A = [], L = [], I = [];
  let base = 0;
  for (const part of parts) {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    if (part.matrix) g.applyMatrix4(part.matrix);
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    const c = part.color, rough = part.rough ?? 0.5, code = (part.metal ? 1 : 0) + 2 * (part.emis || 0) + (part.wood ? 8 : 0);
    const lit = part.lit ?? 0.5;
    for (let i = 0; i < p.length; i += 3) {
      P.push(p[i], p[i + 1], p[i + 2]); N.push(n[i], n[i + 1], n[i + 2]);
      A.push(Math.pow(c[0], 1 / 2.2), Math.pow(c[1], 1 / 2.2), Math.pow(c[2], 1 / 2.2), rough);
      const k = Math.pow(lit * (0.55 + 0.45 * Math.max(0, n[i + 1])), 1 / 2.2);
      L.push(k, k, k, code / 255);
      I.push(base++);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aAlb', new THREE.Float32BufferAttribute(A, 4));
  g.setAttribute('aLit', new THREE.Float32BufferAttribute(L, 4));
  return g;
}

export async function createTheme(ctx) {
  const { THREE, root, util } = ctx;
  const { clamp, clamp01, damp } = util;
  const B = base(), TB = texBase();
  const info0 = await fetch(B + 'meta.json').then((r) => r.json());
  const [info, modA, modB, cinta, lm, env, rub, rubN, trk, trkN, brick, brickN] = await Promise.all([
    info0,
    loadModule(THREE, B + 'mod-a.bin'), loadModule(THREE, B + 'mod-b.bin'), loadModule(THREE, B + 'cinta.bin').catch(() => null),
    loadTexture(ctx, B + (info0.lmFile || 'lm.png'), { repeat: false, mips: false }),
    loadTexture(ctx, B + 'env.png', { repeat: false }),
    loadTexture(ctx, TB + 'caucho.jpg', { srgb: true }), loadTexture(ctx, TB + 'caucho-n.jpg'),
    loadTexture(ctx, TB + 'pista.jpg', { srgb: true }), loadTexture(ctx, TB + 'pista-n.jpg'),
    loadTexture(ctx, TB + 'ladrillo.jpg', { srgb: true }), loadTexture(ctx, TB + 'ladrillo-n.jpg'),
  ]);
  env.wrapS = THREE.RepeatWrapping;

  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const U = {
    uLT0: { value: V3() }, uLN0: { value: V3() }, uLD0: { value: V3() },
    uLT1: { value: V3() }, uLN1: { value: V3() }, uLD1: { value: V3() },
    uFront: { value: 1e5 },
    uAmb: { value: V3(0.004, 0.005, 0.008) }, uFogCol: { value: V3() }, uFogD: { value: 0.0075 },
    uLmK: { value: info.K }, uLmKv: { value: info.K }, uEnvK: { value: info.K_ENV },
    uS: { value: 0 }, uTime: { value: 0 },
    uEnv: { value: env }, uLm: { value: lm },
  };
  const hi = () => (ctx.qualityLevel ?? 2) >= 2;

  // ── módulos de la nave ──
  const modMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uEm: { value: V3(7, 7.5, 0.95) }, uSpecK: { value: 1 } },
    vertexShader: MOD_VERT, fragmentShader: MOD_FRAG, side: THREE.DoubleSide,
  });
  const NI = 6;
  const classes = [];   // [variante][espejo] → { full, far }
  for (let v = 0; v < 2; v++) for (let m = 0; m < 2; m++) {
    const src = v ? modB : modA;
    const mk = (geo) => {
      const im = new THREE.InstancedMesh(geo, modMat, NI);
      im.frustumCulled = false; im.scale.x = m ? -1 : 1; im.count = 0; im.matrixAutoUpdate = true;
      root.add(im); return im;
    };
    classes.push({ full: mk(src.full), far: mk(src.struct) });
  }

  // ── suelo y muros (un plano cada uno; la posición en la nave sale de uS) ──
  const floorMat = new THREE.ShaderMaterial({
    uniforms: {
      ...U, uRub: { value: rub }, uRubN: { value: rubN }, uTrk: { value: trk }, uTrkN: { value: trkN },
      uTrkTint: { value: V3(0.21, 0.036, 0.028) }, uLamp: { value: V3(1, 1, 1) }, uNeonK: { value: new THREE.Vector2(5.0, 4.0) }, uHi: { value: 1 },
    },
    vertexShader: FLAT_VERT, fragmentShader: FLOOR_FRAG,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, FAR + 40), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -(FAR - 40) / 2); floor.frustumCulled = false;
  root.add(floor);
  const wallMats = [];
  for (const s of [-1, 1]) {
    const m = new THREE.ShaderMaterial({
      uniforms: { ...U, uBrick: { value: brick }, uBrickN: { value: brickN }, uSide: { value: s } },
      vertexShader: FLAT_VERT, fragmentShader: WALL_FRAG,
    });
    const w = new THREE.Mesh(new THREE.PlaneGeometry(FAR + 40, 11), m);
    w.rotation.y = -s * Math.PI / 2; w.position.set(s * 12, 5.5, -(FAR - 40) / 2); w.frustumCulled = false;
    root.add(w); wallMats.push(m);
  }

  // ── halos y conos (un módulo de luces, instanciado; la estructura es igual en las dos variantes) ──
  const lampsNear = [], lampsFar = [];
  for (const y0 of [0, 12]) for (const s of [-1, 1]) { lampsNear.push([s * 2.9, 4.36, -(y0 + 6)]); lampsFar.push([s * 8.3, 5.36, -y0]); }
  const bars = [];
  for (const y0 of [0, 12]) for (const s of [-1, 1]) bars.push([s * 4.51, 3.6, -y0]);
  {
    const C = [], Iv = [], Sz = [], Ix = [];
    const quad = (c, sx, sy, kind) => {
      const b = C.length / 3;
      for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { C.push(...c); Iv.push(x, y, kind); Sz.push(sx, sy); }
      Ix.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    for (const l of lampsNear) quad(l, 0.7, 0.7, 0);
    for (const l of lampsFar) quad(l, 0.6, 0.6, 0);
    for (const l of bars) quad(l, 0.3, 1.65, 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(C, 3));
    g.setAttribute('aCenter', new THREE.Float32BufferAttribute(C, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(Iv, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(Sz, 2));
    g.setIndex(Ix);
    var glowMat = new THREE.ShaderMaterial({
      uniforms: { ...U, uGlowK: { value: new THREE.Vector2(0.42, 0.62) } }, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    var glows = new THREE.InstancedMesh(g, glowMat, 12);
    glows.frustumCulled = false; glows.count = 0; glows.renderOrder = 20; root.add(glows);
  }
  {
    const P = [], Nn = [], H = [], Ix = [];
    const SEG = 20;
    const cone = (c, r, h) => {
      const b = P.length / 3;
      for (let k = 0; k <= 1; k++) for (let i = 0; i < SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        const rr = 0.28 + (r - 0.28) * k;
        P.push(c[0] + Math.cos(a) * rr, c[1] - h * k, c[2] + Math.sin(a) * rr);
        const sl = (r - 0.28) / h;
        const nl = Math.hypot(1, sl);
        Nn.push(Math.cos(a) / nl, sl / nl, Math.sin(a) / nl); H.push(k);
      }
      for (let i = 0; i < SEG; i++) { const i2 = (i + 1) % SEG; Ix.push(b + i, b + i2, b + SEG + i2, b + i, b + SEG + i2, b + SEG + i); }
    };
    for (const l of lampsNear) cone(l, 2.5, 4.3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    g.setAttribute('aH', new THREE.Float32BufferAttribute(H, 1));
    g.setIndex(Ix);
    var coneMat = new THREE.ShaderMaterial({
      uniforms: { ...U, uConeK: { value: 0.14 } }, vertexShader: CONE_VERT, fragmentShader: CONE_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    var cones = new THREE.InstancedMesh(g, coneMat, 6);
    cones.frustumCulled = false; cones.count = 0; cones.renderOrder = 15; root.add(cones);
  }

  {
    const P = [], Z = [], Ix = [];
    for (const zg of [-12, -24]) {
      const b = P.length / 3;
      for (const x of [-12, 12]) for (const y of [0.03, 11]) for (const z of [zg, zg + 14.8]) { P.push(x, y, z); Z.push(zg); }
      const f = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
      for (const i of f) Ix.push(b + i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('aZg', new THREE.Float32BufferAttribute(Z, 1));
    g.setIndex(Ix);
    var shaftMat = new THREE.ShaderMaterial({
      uniforms: { ...U, uSun: { value: V3(info.sunDir[0], info.sunDir[1], info.sunDir[2]) }, uShaftK: { value: 0.019 } },
      vertexShader: SHAFT_VERT, fragmentShader: SHAFT_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.BackSide,
    });
    var shafts = new THREE.InstancedMesh(g, shaftMat, 5);
    shafts.frustumCulled = false; shafts.count = 0; shafts.renderOrder = 18; root.add(shafts);
  }

  // ── luz: tres grupos con su color y su ganancia; el neón toma el color de la zona ──
  const COL_T = new THREE.Color(1.0, 0.56, 0.25);
  const COL_D = new THREE.Color(0.36, 0.58, 1.0);
  const GAIN = { T: 1.35, N: 0.62, D: 1.25 };
  const HAZE = { T: 0.03, N: 0.022, D: 0.024 };
  const look = { T: 0.3, N: 0.6, D: 0.6, col: new THREE.Color(), key: '' };
  const now = { T: 0.3, N: 0.6, D: 0.6, col: new THREE.Color('#30D158') };
  let wave = null;      // { front } mientras el cambio avanza por la nave
  const fog = V3();
  const tmpC = new THREE.Color();
  const red = new THREE.Color(1, 0.04, 0.03);
  const gold = new THREE.Color(1, 0.72, 0.2);

  function setLights(dt, time, first) {
    const kT = first ? 1 : 1 - Math.exp(-dt * (look.T > now.T ? 5.5 : 2.2));
    const kO = first ? 1 : 1 - Math.exp(-dt * 2.6);
    now.T += (look.T - now.T) * kT; now.N += (look.N - now.N) * kO; now.D += (look.D - now.D) * kO;
    now.col.lerp(look.col, kO);
    U.uLT1.value.set(COL_T.r, COL_T.g, COL_T.b).multiplyScalar(now.T * GAIN.T);
    U.uLN1.value.set(now.col.r, now.col.g, now.col.b).multiplyScalar(now.N * GAIN.N);
    U.uLD1.value.set(COL_D.r, COL_D.g, COL_D.b).multiplyScalar(now.D * GAIN.D);
    if (wave) {
      wave.front += dt * 95;
      U.uFront.value = wave.front;
      if (wave.front > FAR + 20) wave = null;
    }
    if (!wave) {
      U.uFront.value = 1e5;
      U.uLT0.value.copy(U.uLT1.value); U.uLN0.value.copy(U.uLN1.value); U.uLD0.value.copy(U.uLD1.value);
    }
    fog.set(0, 0, 0).addScaledVector(U.uLT1.value, HAZE.T).addScaledVector(U.uLN1.value, HAZE.N).addScaledVector(U.uLD1.value, HAZE.D);
    if (first) U.uFogCol.value.copy(fog); else U.uFogCol.value.lerp(fog, 1 - Math.exp(-dt * 1.8));
    U.uFogCol.value.x += 0.0015; U.uFogCol.value.y += 0.002; U.uFogCol.value.z += 0.0035;
    bg.setRGB(U.uFogCol.value.x, U.uFogCol.value.y, U.uFogCol.value.z);
  }
  /** Cambia el ambiente; con `chain` el cambio recorre la nave desde ti hacia el fondo. */
  function setLook(T, N, D, col, key, chain) {
    if (key !== look.key && chain && !ctx.reducedMotion) {
      U.uLT0.value.copy(U.uLT1.value); U.uLN0.value.copy(U.uLN1.value); U.uLD0.value.copy(U.uLD1.value);
      wave = { front: -12 };
      now.T = T; now.N = N; now.D = D; now.col.copy(col);
    }
    look.T = T; look.N = N; look.D = D; look.col.copy(col); look.key = key;
  }

  const bg = new THREE.Color(0, 0, 0);
  ctx.scene.background = bg;

  // ── la AMRAP: pórtico, reloj, metros, pizarra ──
  const amrap = createAmrap(ctx, { U, COMMON, MOD_VERT, MOD_FRAG, propGeometry, cinta: cinta ? cinta.full : null });

  // ── corredor (cámara y composición del kit); la distancia la llevo yo: en una AMRAP manda la velocidad de la fase ──
  const runner = createRunner(ctx, {
    camH: 1.62, fovP: 60, fovL: 44, exposure: 1.0, horizonP: 0.06,
    finaleShot: (T, s) => amrap.finaleShot(T, s),
  });
  ctx.post.set({ toneMapping: 'aces', bloomStrength: 0.5, bloomThreshold: 0.92, bloomRadius: 0.4, vignette: 0.3, saturation: 1.04 });

  let S = 0, vel = 0, first = true;
  let am = null;         // último estado de la AMRAP (evento 'amrap') o null
  const mat4 = new THREE.Matrix4();
  const WORKY = { run: 1, fast: 1, sprint: 1 };

  function place(Sw) {
    const k0 = Math.floor(Sw / MOD);
    for (const c of classes) { c.full.count = 0; c.far.count = 0; }
    glows.count = 0; cones.count = 0; shafts.count = 0;
    const nearM = hi() ? 60 : 30;
    const far = hi() ? FAR : 150;
    for (let k = k0 - 1; k * MOD - Sw < far; k++) {
      const srel0 = k * MOD - Sw;
      if (srel0 + MOD < 0.5) continue;     // el módulo que queda detrás no se ve nunca
      const v = ((k % 2) + 2) % 2;
      const m = ((Math.floor(k / 2) % 2) + 2) % 2;
      const c = classes[v * 2 + m];
      const im = srel0 < nearM ? c.full : c.far;
      if (im.count < NI) { mat4.makeTranslation(0, 0, -srel0); im.setMatrixAt(im.count++, mat4); im.instanceMatrix.needsUpdate = true; }
      if (glows.count < 12) { mat4.makeTranslation(0, 0, -srel0); glows.setMatrixAt(glows.count++, mat4); glows.instanceMatrix.needsUpdate = true; }
      if (hi() && srel0 < 80 && srel0 > -30 && shafts.count < 5) { mat4.makeTranslation(0, 0, -srel0); shafts.setMatrixAt(shafts.count++, mat4); shafts.instanceMatrix.needsUpdate = true; }
      if (hi() && srel0 < 84 && cones.count < 6) { mat4.makeTranslation(0, 0, -srel0); cones.setMatrixAt(cones.count++, mat4); cones.instanceMatrix.needsUpdate = true; }
    }
  }

  return {
    director: { enabled: true, scale: 1.62, maxDown: 0.2, orbit: 0.5, punch: true },
    update(f) {
      runner.update(f);
      const dt = f.dt;
      // velocidad real: la de la fase de la AMRAP si hay bloque; si no, la del tramo
      const kmh = f.running && !f.finale ? (am && am.speed > 0 ? am.speed : f.speed) : 0;
      vel = first || f.finale > 0 ? kmh / 3.6 : damp(vel, kmh / 3.6, kmh / 3.6 > vel ? 0.9 : 1.6, dt);
      if (!f.paused) S += vel * dt * (f.timeScale ?? 1);
      const Sw = ((S % PERIOD) + PERIOD) % PERIOD;
      U.uS.value = Sw; U.uTime.value = f.time;
      place(Sw);

      // ── ambiente según la fase ──
      const zone = am ? am.zone : f.zone;
      const zc = ctx.zoneColor(zone);
      if (f.finale > 0) {
        const rec = amrap.isRecord() && amrap.finaleClock() > 2.6;
        if (rec) setLook(1.05, 1.1, 0.5, gold, 'record', true);
        else setLook(0.035, 0.16, 0.34, tmpC.copy(zc), 'fin', true);
      } else if (f.status === 'ready') {
        setLook(0.22, 0.55, 0.7, zc, 'ready', false);
      } else if (am) {
        const last = am.capLeft <= 60 && am.capLeft > 0;
        if (am.phase === 'work') {
          if (last) {
            const beat = f.reducedMotion ? 1 : 0.9 + 0.1 * Math.pow(1 - (am.capLeft % 1), 2);
            setLook(0.82 * beat, 1.15 * beat, 0.1, red, 'w' + am.round, true);
            look.key = 'w' + am.round;
          } else setLook(1.0, 1.0, 0.14, zc, 'w' + am.round, true);
        } else if (last) setLook(0.2, 0.75, 0.6, red, 'r' + am.round, true);
        else setLook(0.1, 0.34, 1.0, zc, 'r' + am.round, true);
      } else {
        const work = WORKY[zone] ? 1 : 0;
        setLook(work ? 0.9 : 0.24, work ? 0.9 : 0.5, work ? 0.2 : 0.85, zc, 'z' + f.segIndex, true);
      }
      setLights(dt, f.time, first);
      floorMat.uniforms.uHi.value = hi() ? 1 : 0;
      floorMat.uniforms.uLamp.value.setScalar(9.0);
      cones.visible = hi(); shafts.visible = hi() && now.D > 0.2;

      amrap.update(f, { S, am, vel, now, look });
      first = false;
    },
    event(type, data) {
      if (type === 'amrap') { am = data && data.phase ? data : null; return; }
      runner.event(type, data);
      amrap.event(type, data);
    },
    resize(sz) { runner.resize(sz); },
    dispose() { amrap.dispose(); ctx.scene.background = null; },
    _debug: { get S() { return S; }, U, GAIN, HAZE, look, now, modMat, floorMat, wallMats, glowMat, coneMat, shaftMat, tris: { a: modA.tris, b: modB.tris, struct: modA.structTris } },
  };
}
