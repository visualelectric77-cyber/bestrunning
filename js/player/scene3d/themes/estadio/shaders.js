// ESTADIO · shaders. Todo en lineal HDR (el núcleo hace tone mapping, viñeta y bloom pequeño en el pase final).
// Regla de la casa: líneas finas antialiasadas con anchura mínima de 1 px y energía conservada (sin parpadeo ni
// moiré al alejarse), emisivos solo en elementos pequeños (LED del bordillo, líneas de cambio, baterías de focos),
// nada de destellos. Pista con grano, desgaste de las calles interiores y reflejo satinado (focos y LED del bordillo);
// gradas escalonadas con el canto de cada fila iluminado, pasillos y público apenas sugerido; focos en baterías
// rectangulares con un halo suave.
import { A, LS, R0, RCP, LC, LANE_W, TRACK_W, WALL } from './track.js';

const f = (v) => Number(v).toFixed(5);

/** Constantes de la pista para los shaders. */
export const TRACK_DEFINES = {
  TA: f(A), TLS: f(LS), TR0: f(R0), TRCP: f(RCP), TLC: f(LC), TLW: f(LANE_W), TTW: f(TRACK_W), TWALL: f(WALL),
};

/** Utilidades comunes: σ de la pista, líneas AA. */
const TRACK_GLSL = /* glsl */ `
#define PI 3.14159265
// σ (longitud de arco en la trayectoria de la cámara) de un punto del plano; tangente y metros por unidad de σ
float sigmaOf(vec2 p, out vec2 tng, out float sScale) {
  if (abs(p.x) <= TA) {
    sScale = 1.0;
    if (p.y > 0.0) { tng = vec2(1.0, 0.0); return p.x + TA; }
    tng = vec2(-1.0, 0.0);
    return TLS + PI * TRCP + (TA - p.x);
  }
  if (p.x > TA) {
    vec2 d = vec2(p.x - TA, p.y);
    float rr = max(length(d), 1e-3);
    sScale = rr / TRCP;
    tng = vec2(d.y, -d.x) / rr;
    return TLS + atan(d.x, d.y) * TRCP;
  }
  vec2 d = vec2(-(p.x + TA), -p.y);
  float rr = max(length(d), 1e-3);
  sScale = rr / TRCP;
  tng = vec2(-d.y, d.x) / rr;
  return 2.0 * TLS + PI * TRCP + atan(d.x, d.y) * TRCP;
}
// σ relativa a la cámara envuelta a [−LC/2, LC/2)
float relSig(float s, float c) { return mod(s - c + 0.5 * TLC, TLC) - 0.5 * TLC; }
// cobertura de una línea de semiancho hw a distancia d (mismas unidades que fw = huella del píxel): mínimo 1 px,
// intensidad proporcional a la cobertura real (sin aliasing ni parpadeo al alejarse)
float lineAA(float d, float hw, float fw) {
  float w = max(hw, 0.5 * fw);
  return (1.0 - smoothstep(w - 0.5 * fw, w + 0.5 * fw, d)) * (hw / w);
}
float bandAA(float s, float a, float b, float fw) {
  return smoothstep(a - fw, a + fw, s) * (1.0 - smoothstep(b - fw, b + fw, s));
}
`;

/* ───────────────────────── Cielo (triángulo a pantalla completa en el plano lejano) ───────────────────────── */

export const SKY_VERT = /* glsl */ `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

export const SKY_FRAG = /* glsl */ `
uniform mat4 uProjInv, uCamWorld;
uniform vec3 uTop, uHaze, uGlow;
uniform float uHazeK;
varying vec2 vNdc;
void main() {
  vec4 p = uProjInv * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize((uCamWorld * vec4(p.xyz / p.w, 0.0)).xyz);
  float el = dir.y;
  // noche profunda arriba; aire iluminado por los focos justo sobre la cubierta (sin rayos: un degradado liso)
  vec3 col = mix(uHaze, uTop, smoothstep(0.02, 0.9, el));
  // cúpula de aire iluminado sobre la cubierta: degradado muy suave que da profundidad a la noche
  col += uGlow * exp(-max(el - 0.32, 0.0) * 3.2) * smoothstep(0.08, 0.32, el) * uHazeK;
  gl_FragColor = vec4(col, 1.0);
}`;

/* ───────────────────────── Suelo: pista, césped, bordillo con LED, líneas ───────────────────────── */

export const GROUND_VERT = /* glsl */ `
varying vec3 vW;
varying vec2 vP;
void main() {
  vP = position.xz;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const GROUND_FRAG = /* glsl */ `
uniform vec3 uTrack, uGrass, uApron, uPaint, uFog, uCur, uSweepCol, uSweepFrom, uGold, uSpecCol, uEnv;
uniform float uSigCam, uFogD, uLight, uSpec, uMotion, uRailBase, uApproach, uGoldK, uDetail, uPaintK;
uniform vec4 uGate[3];        // x σrel, y intensidad de la línea, z activa (color del bordillo), w -
uniform vec3 uGateCol[3];
uniform vec4 uPacer;          // x cabeza σrel, y longitud, z intensidad, w respiración (pausa)
uniform vec4 uGhost;          // x cabeza σrel, y longitud, z intensidad, w línea virtual
uniform vec4 uSweep;          // x frente σrel, y intensidad, z cola (m), w activo
uniform vec4 uMarks;          // σrel de las 4 próximas marcas de 100 m (1e5 = ninguna)
uniform vec4 uMarkK;          // 1 = kilómetro
uniform vec4 uMoment;         // x σrel MITAD, y intensidad, z σrel META de la clase, w intensidad
uniform vec4 uBank[6];        // focos (mundo) + intensidad (reflejo satinado)
uniform vec2 uLaneCam;        // calle de la cámara [r0, r1]
varying vec3 vW;
varying vec2 vP;
NOISE_CHUNK
TRACK_CHUNK

vec3 zoneColAt(float s, float fwS) {
  vec3 c = uCur;
  for (int i = 0; i < 3; i++) {
    if (uGate[i].z > 0.5) c = mix(c, uGateCol[i], smoothstep(uGate[i].x - fwS, uGate[i].x + fwS, s));
  }
  return c;
}

void main() {
  vec2 p = vP;
  vec2 q = vec2(p.x - clamp(p.x, -TA, TA), p.y);
  float r = length(q) - TR0;                 // distancia al bordillo (+ hacia fuera)
  vec2 tng; float sScale;
  float sig = sigmaOf(p, tng, sScale);
  float srel = relSig(sig, uSigCam);
  float fwR = max(fwidth(r), 1e-5);
  vec2 dpx = dFdx(p); vec2 dpy = dFdy(p);
  float fwM = abs(dot(dpx, tng)) + abs(dot(dpy, tng)) + 1e-5;   // huella del píxel a lo largo de la pista (m)
  float fwS = fwM / sScale;                                     // ídem en unidades de σ
  vec3 toCam = vW - cameraPosition;
  float dist = length(toCam);
  float ax = abs(p.x);
  float near = 1.0 - smoothstep(0.02, 0.09, fwR);               // detalle fino solo donde hay píxeles

  // ── material base: sintético con grano, moteado y desgaste de las calles interiores (zancadas en la dirección de carrera) ──
  float trackM = smoothstep(-0.65, -0.6, r);                       // pista (incluye 0,6 m dentro del bordillo)
  float apronM = smoothstep(TTW + 0.25, TTW + 0.4, r);
  float edge = max(fwidth(p.x), fwidth(p.y)) + 0.02;
  float grassM = (1.0 - smoothstep(TA - edge, TA + edge, ax)) * (1.0 - smoothstep(TR0 - 1.0 - edge, TR0 - 1.0 + edge, abs(p.y)));
  grassM *= 1.0 - trackM;
  float n1 = vnoise(p * 0.35);
  float mott = vnoise(p * 1.7 + 3.1);
  float grain = mix(0.5, vnoise(p * 9.0), near * uDetail);
  float onLanes = step(0.0, r) * step(r, TTW);
  float li = clamp(floor(r / TLW), 0.0, 7.0);
  float lr = fract(r / TLW);
  float streak = vnoise(vec2(sig * 0.32, r * 7.0));
  float wear = exp(-pow((lr - 0.5) / 0.24, 2.0)) * mix(1.0, 0.2, li / 7.0) * onLanes * (0.55 + 0.45 * streak);
  vec3 synth = mix(uTrack, uApron, apronM) * (0.84 + 0.16 * n1 + 0.1 * (mott - 0.5) + 0.14 * (grain - 0.5)) * (1.0 + 0.16 * wear);
  float stripe = 0.5 + 0.5 * cos(p.x * (PI / 6.0));
  float sw = 1.0 - smoothstep(0.5, 3.0, fwidth(p.x) * 2.0);
  vec3 grass = uGrass * (0.8 + 0.32 * mix(0.5, stripe, sw) + 0.12 * (n1 - 0.5));
  // áreas de concursos en los fondos (dentro de las curvas): sintético algo más oscuro, sin borde marcado con el césped
  float dArea = step(TA, ax) * (1.0 - trackM);
  synth *= 1.0 - 0.35 * dArea;
  vec3 base = mix(synth, grass, grassM);
  // el carril del LED del fantasma: una regleta oscura de 6 cm junto al bordillo
  base *= 1.0 - 0.45 * lineAA(abs(r + 0.13), 0.03, fwR);

  // ── pintura: líneas de calle, bordillo, marcas de vallas, línea de meta y salida de 200 m ──
  float onTrack = step(0.4, r) * step(r, TTW + 0.12);
  float k = floor(r / TLW + 0.5);
  float lane = lineAA(abs(r - k * TLW), 0.025, fwR) * step(0.5, k) * step(k, 8.5);
  lane = mix(lane, 0.025 / TLW * 2.0 * onTrack, smoothstep(0.22, 0.55, fwR / TLW));
  float curb = lineAA(abs(r + 0.03), 0.03, fwR);
  float s10 = abs(fract(sig / 10.0 + 0.5) - 0.5) * 10.0 * sScale;
  float hurdle = lineAA(s10, 0.05, fwM) * lineAA(abs(r - k * TLW), 0.06, fwR) * step(0.5, k) * step(k, 8.5) * near * 0.6;
  float across = smoothstep(-0.05, 0.02, r) * (1.0 - smoothstep(TTW, TTW + 0.05, r));
  float fin = lineAA(abs(relSig(TLS, uSigCam) - srel) * sScale, 0.025, fwM);
  fin += lineAA(abs(relSig(TLS + PI * TRCP, uSigCam) - srel) * sScale, 0.025, fwM);
  float paint = max(max(lane, hurdle * 0.55), fin * across);
  vec3 col = mix(base, uPaint * uPaintK, paint);
  col = mix(col, vec3(0.42, 0.43, 0.45) * uPaintK, curb);       // bordillo de aluminio

  // ── luz: focos uniformes + reflejo satinado y suave de las baterías de focos (el grano lo rompe un poco) ──
  col *= uLight;
  vec3 V = -toCam / max(dist, 1e-3);
  float spec = 0.0;
  float rough = 160.0 * (0.7 + 0.6 * mott);
  for (int i = 0; i < 6; i++) {
    vec3 L = normalize(uBank[i].xyz - vW);
    vec3 H = normalize(L + V);
    spec += pow(max(H.y, 0.0), rough) * uBank[i].w;
  }
  float fres = 0.04 + 0.96 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
  float gloss = mix(1.0, 0.1, grassM) * (1.0 - 0.7 * dArea) * (1.0 - 0.35 * wear);
  col += uSpecCol * spec * fres * uSpec * gloss;
  // satinado: en ángulos rasantes la pista refleja el estadio iluminado (profundidad sin focos de más)
  col += uEnv * fres * gloss * uLight;

  // niebla de estadio (aire con un punto de luz de los focos)
  float fx = dist * uFogD;
  float fog = 1.0 - exp(-fx * fx);
  col = mix(col, uFog, fog);

  // ── emisivos (atraviesan mejor la bruma) ──
  vec3 em = vec3(0.0);
  float fade = exp(-dist * 0.0035);
  float ledA = lineAA(abs(r + 0.03), 0.016, fwR);
  float ledB = lineAA(abs(r + 0.13), 0.011, fwR);
  // LED: puntos individuales de cerca, línea continua de lejos o a velocidad (sin estroboscopio)
  float dots = smoothstep(0.15, 0.85, 0.5 + 0.5 * cos(srel * (2.0 * PI / 0.1)));
  float dm = clamp(fwS * 14.0 + uMotion, 0.0, 1.0);
  float ledMod = mix(0.25 + 1.5 * dots, 1.0, dm);

  // base del carril: LED en reposo del color de la zona (tras un barrido, el nuevo color por detrás del frente)
  vec3 baseCol = uCur;
  if (uSweep.w > 0.5) baseCol = mix(uSweepFrom, uSweepCol, 1.0 - smoothstep(uSweep.x - fwS, uSweep.x + fwS, srel));
  float baseK = uRailBase * mix(0.55, 1.0, ledMod);
  vec3 rail = baseCol * baseK;
  // pacer (Wavelight): bloque de luz a tu velocidad objetivo, más intenso hacia la cabeza
  float ph = uPacer.x; float pl = uPacer.y;
  float tt = clamp((srel - (ph - pl)) / pl, 0.0, 1.0);
  float blk = bandAA(srel, ph - pl, ph, fwS + 0.04);
  float pac = blk * (0.3 + 0.7 * tt * tt) * uPacer.z;
  pac += bandAA(srel, ph - 2.2, ph, fwS + 0.05) * 0.8 * uPacer.z;
  vec3 pcol = mix(zoneColAt(srel, fwS), uGold, uGoldK);
  rail += pcol * pac * 2.6 * ledMod;
  // charco de luz del pacer sobre la pista junto al bordillo (los LED iluminan el suelo): se lee de lejos
  float poolS = smoothstep(ph - pl - 3.0, ph - pl + 3.0, srel) * (1.0 - smoothstep(ph - 2.5, ph + 3.5, srel)) * smoothstep(3.0, 11.0, srel);
  float pool = exp(-abs(r + 0.03) / 0.2) * (1.0 - ledA) * poolS;
  em += pcol * uPacer.z * 0.26 * pool;
  // últimos 3 s: el tramo de carril hasta la línea de cambio se enciende tenue con el color siguiente
  if (uGate[0].z > 0.5) rail += uGateCol[0] * uApproach * 0.55 * bandAA(srel, 0.0, uGate[0].x, fwS + 0.05) * ledMod;
  // barrido de color a lo largo del bordillo en el cambio de tramo (una sola pasada)
  if (uSweep.w > 0.5) {
    float ds = uSweep.x - srel;
    float swp = smoothstep(-0.35 - fwS, 0.0, ds) * exp(-max(ds, 0.0) / uSweep.z);
    rail += mix(uSweepCol, vec3(1.0), 0.25) * swp * uSweep.y * 5.0;
  }
  em += rail * ledA;
  // reflejo suave de la hilera de LED sobre la calle 1 (satinado): el color de la zona tiñe el borde de la pista
  em += (baseCol * uRailBase * 0.55 + pcol * pac * 0.12) * exp(-max(r - 0.02, 0.0) / 0.42) * step(0.02, r) * trackM * gloss;
  // fila blanca del fantasma (tu mejor marca) + marcas de 100 m en la misma regleta
  float gh = uGhost.x; float gl = uGhost.y;
  float gt = clamp((srel - (gh - gl)) / gl, 0.0, 1.0);
  float gb = bandAA(srel, gh - gl, gh, fwS + 0.04) * (0.15 + 0.85 * gt * gt) * uGhost.z;
  vec3 white = vec3(0.86, 0.9, 1.0);
  float ticks = 0.0;
  float laneLine = 0.0;
  float inLane = bandAA(r, uLaneCam.x + 0.06, uLaneCam.y - 0.06, fwR);
  for (int i = 0; i < 4; i++) {
    float m = uMarks[i];
    float km = uMarkK[i];
    ticks += bandAA(srel, m - 0.3, m + 0.3, fwS + 0.02) * (0.9 + 0.6 * km);
    ticks += km * bandAA(srel, m - 1.3, m - 0.7, fwS + 0.02) * 1.2;
    laneLine += lineAA(abs(srel - m) * sScale, 0.025, fwM) * (0.5 + 0.3 * km);
  }
  laneLine *= inLane;
  em += white * (gb * 3.6 * ledMod + 0.05 * uRailBase * ledMod + ticks * 1.1) * ledB;
  float gpS = bandAA(srel, gh - gl - 1.5, gh + 1.5, 1.5) * smoothstep(3.0, 9.0, srel);
  em += white * uGhost.z * 0.16 * exp(-abs(r + 0.13) / 0.16) * (1.0 - ledB) * gpS;
  // línea virtual del fantasma a lo ancho de la pista (como la línea del récord en las retransmisiones)
  em += white * uGhost.w * lineAA(abs(srel - gh) * sScale, 0.02, fwM) * across * 0.9;
  // línea fina de cambio de tramo: viene por la pista y se cruza en el segundo exacto
  for (int i = 0; i < 3; i++) {
    float gi = uGate[i].y;
    if (gi > 0.001) em += uGateCol[i] * gi * lineAA(abs(srel - uGate[i].x) * sScale, 0.035, fwM) * across * 2.2;
  }
  // MITAD (doble línea blanca) y META de la clase (doble línea blanca más marcada)
  if (uMoment.y > 0.001) {
    float d0 = abs(srel - uMoment.x) * sScale;
    em += white * uMoment.y * across * 1.4 * lineAA(abs(d0 - 0.16), 0.022, fwM);
  }
  if (uMoment.w > 0.001) {
    float d1 = abs(srel - uMoment.z) * sScale;
    em += white * uMoment.w * across * 1.6 * (lineAA(abs(d1 - 0.12), 0.03, fwM));
  }
  em += white * laneLine * 0.9;
  col += em * fade;
  gl_FragColor = vec4(col, 1.0);
}`.replace('TRACK_CHUNK', TRACK_GLSL);

/* ───────────────────────── Gradas, vallas publicitarias y cubierta ───────────────────────── */

export const STAND_VERT = /* glsl */ `
attribute vec4 aInfo;   // x cara, y v (0..1 a lo largo de la cara), z longitud de la cara (m), w u (arco del contorno, m)
varying vec4 vInfo;
varying vec3 vW;
void main() {
  vInfo = aInfo;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const STAND_FRAG = /* glsl */ `
uniform vec3 uFog, uBoardCol, uAccent, uFascia, uRim;
uniform float uFogD, uLight, uEq, uBoardK, uDetail;
uniform vec4 uSweepB;       // x frente (u, m), y intensidad, z ancho, w vuelta (m)
uniform sampler2D uSpecTex;
varying vec4 vInfo;
varying vec3 vW;
NOISE_CHUNK
float lineAA(float d, float hw, float fw) {
  float w = max(hw, 0.5 * fw);
  return (1.0 - smoothstep(w - 0.5 * fw, w + 0.5 * fw, d)) * (hw / w);
}
void main() {
  float face = vInfo.x;
  float v = vInfo.y;
  float along = v * vInfo.z;
  float u = vInfo.w;
  float fwU = fwidth(u) + 1e-4;
  float fwA = fwidth(along) + 1e-4;
  vec3 col;
  vec3 em = vec3(0.0);
  float dist = length(vW - cameraPosition);
  if (face < 0.5) {
    // muro de vallas LED sobrias, SIN texto: panel oscuro, filete fino del acento arriba, medidor de música y barrido del drop
    float bv = (along - 0.14) / 0.82;
    float inB = step(0.0, bv) * step(bv, 1.0);
    float pu = 1.0 - fract(u / 6.0);   // vista desde dentro del estadio: u crece de derecha a izquierda
    float gap = lineAA(min(pu, 1.0 - pu) * 6.0, 0.03, fwU);
    col = vec3(0.010, 0.011, 0.013);
    float band = floor(u / 6.0);
    float lvl = texture2D(uSpecTex, vec2(fract(band * 0.0625 + 0.03), 0.5)).r;
    float meter = step(pu, 0.04 + 0.92 * lvl) * step(0.06, bv) * step(bv, 0.12) * inB * uEq;
    float top = lineAA(abs(bv - 0.93), 0.012, fwA / 0.82) * inB;
    float ds = abs(u - uSweepB.x);
    ds = min(ds, uSweepB.w - ds);
    float sweep = exp(-ds / max(uSweepB.z, 0.1)) * uSweepB.y * inB;
    em += uBoardCol * 0.012 * inB * (1.0 - gap);
    em += uAccent * (meter * 0.2 + top * uBoardK) * (1.0 - gap);
    em += vec3(0.9, 0.93, 1.0) * sweep * 0.9 * (1.0 - gap);
    col += vec3(0.05) * lineAA(abs(along - 1.09), 0.012, fwA);   // canto superior del muro
  } else if (face < 2.5) {
    col = vec3(0.010, 0.011, 0.013) * (face < 1.5 ? 1.6 : 0.9);  // pasillo y contrahuella
    if (face > 1.5) col += uRim * 0.5 * lineAA(abs(along - vInfo.z + 0.02), 0.02, fwA);
  } else if (face < 3.5 || (face > 4.5 && face < 5.5)) {
    // graderío escalonado: cada fila tiene su canto iluminado por los focos (líneas finas que dibujan las gradas),
    // pasillos de escaleras cada 18 m, vomitorios en la grada baja y público apenas sugerido (oscuro, sin celdas)
    float upper = step(4.5, face);
    float rowH = 0.82;
    float rv = fract(along / rowH);
    float res = 1.0 - smoothstep(0.05, 0.22, max(fwA, fwU * 0.6));      // ¿hay píxeles para ver asientos?
    float tread = mix(0.82, mix(0.6, 1.0, smoothstep(0.3, 0.45, rv)), res);
    float h1 = vnoise(vec2(u / 0.48, along / 0.7 + upper * 31.0));
    float h2 = vnoise(vec2(u / 0.9 + 7.0, along / 0.8));
    float occ = smoothstep(0.35, 0.6, vnoise(vec2(u * 0.05 + upper * 9.0, along * 0.09)));   // zonas llenas / vacías
    float person = mix(1.0, 0.65 + 0.7 * h1 * occ, res * uDetail);
    vec3 tint = mix(vec3(1.0), vec3(0.8 + 0.4 * h2, 0.86 + 0.2 * h1, 1.0), 0.4 * res * occ);
    float soft = 0.8 + 0.4 * vnoise(vec2(u * 0.08, along * 0.12));
    float aisleD = abs(fract(u / 18.0 + 0.5) - 0.5) * 18.0;
    float aisle = 1.0 - smoothstep(0.55 - fwU, 0.55 + fwU, aisleD);
    float spill = mix(1.35, 0.5, v) * mix(1.0, 0.6, upper);
    col = vec3(0.014, 0.0146, 0.0164) * spill * soft * mix(person * tread * tint, vec3(1.18), aisle);
    float vom = (1.0 - upper) * step(abs(fract(u / 36.0 + 0.5) - 0.5) * 36.0, 1.4) * step(5.6, along) * step(along, 8.0);
    col *= 1.0 - 0.6 * vom;
    // canto de cada fila (y de cada peldaño del pasillo): luz rasante de los focos
    float nose = lineAA(min(rv, 1.0 - rv) * rowH, 0.016, fwA);
    float stepN = aisle * lineAA(abs(fract(along / (rowH * 0.5) + 0.5) - 0.5) * rowH * 0.5, 0.012, fwA);
    // de lejos (detrás del número, al fondo) los cantos se funden en una textura serena
    float farL = 1.0 - 0.55 * smoothstep(60.0, 160.0, dist);
    em += uRim * (nose * (0.55 + 0.45 * (1.0 - v)) * mix(1.0, 0.7, upper) + stepN * 0.35) * (1.0 - vom) * spill * farL;
  } else if (face < 4.5) {
    col = vec3(0.0085, 0.009, 0.0102) * (0.85 + 0.3 * v);                     // frente del anfiteatro superior
    em += uRim * 1.4 * lineAA(abs(v - 0.96), 0.03, fwidth(v) + 1e-4);          // su borde superior, iluminado
  } else if (face < 6.5) {
    col = vec3(0.005, 0.0055, 0.0065);
  } else if (face < 7.5) {
    // intradós de la cubierta: cerchas cada 16 m apenas visibles
    float rib = lineAA(abs(fract(u / 16.0 + 0.5) - 0.5) * 16.0, 0.12, fwU);
    col = vec3(0.006, 0.0065, 0.0075) * (0.7 + 0.6 * v) * (1.0 + 1.6 * rib);
    em += vec3(0.05, 0.048, 0.045) * smoothstep(0.7, 1.0, v);   // la luz de los focos baña el borde de la cubierta
  } else if (face < 8.5) {
    col = uFascia * (0.85 + 0.3 * v);                            // canto frontal de la cubierta
    em += vec3(1.0, 0.95, 0.88) * 0.11 * lineAA(abs(v - 0.1), 0.05, fwidth(v) + 1e-4);
  } else {
    col = vec3(0.012, 0.013, 0.015);
  }
  col *= uLight;
  float fx = dist * uFogD;
  float fogK = 1.0 - exp(-fx * fx);
  col = mix(col, uFog, fogK);
  col += em * uLight * exp(-dist * 0.0022);
  gl_FragColor = vec4(col, 1.0);
}`;

/* ───────────────────────── Baterías de focos (instanciadas): rectángulos de lámparas con halo suave ───────────────────────── */

export const BANK_VERT = /* glsl */ `
attribute vec3 aPos;     // centro de la batería (estadio)
attribute vec3 aTan;     // eje largo (horizontal, a lo largo de la cubierta)
attribute vec3 aNrm;     // hacia dónde mira (al campo, inclinada hacia abajo)
attribute vec4 aRnd;     // x -, y brillo, z temperatura, w grupo (batería)
uniform vec2 uSize;      // semiancho, semialto (m)
uniform float uMargin;   // margen del halo (m)
uniform vec4 uDim;       // atenuación por grupo (vuelta a la calma): grupos pares/impares
uniform vec4 uAvoid;     // rectángulo NDC del número de velocidad: los focos no se colocan detrás (composición)
varying vec2 vL;
varying float vI;
varying float vT;
void main() {
  vec3 up = normalize(cross(aNrm, aTan));
  vec2 l = position.xy * (uSize + uMargin);
  vec3 wp = aPos + aTan * l.x + up * l.y;
  vec4 w = modelMatrix * vec4(wp, 1.0);
  vec4 c = projectionMatrix * viewMatrix * w;
  vL = l;
  vT = aRnd.z;
  float g = mod(aRnd.w, 2.0);
  vec3 nW = normalize(mat3(modelMatrix) * aNrm);
  vec3 toCam = normalize(cameraPosition - w.xyz);
  float facing = smoothstep(-0.3, 0.7, dot(nW, toCam));
  vI = aRnd.y * mix(uDim.x, uDim.y, g) * (0.18 + 0.82 * facing);
  vec4 cc = projectionMatrix * viewMatrix * (modelMatrix * vec4(aPos, 1.0));
  if (cc.w > 0.5) {
    vec2 n = cc.xy / cc.w;
    float inside = min(min(n.x - uAvoid.x, uAvoid.z - n.x), min(n.y - uAvoid.y, uAvoid.w - n.y));
    vI *= 1.0 - smoothstep(-0.08, 0.02, inside);
  }
  gl_Position = c;
}`;

export const BANK_FRAG = /* glsl */ `
uniform vec2 uSize;
uniform float uMargin, uCell, uHalo;
uniform vec3 uWarm, uCool;
varying vec2 vL;
varying float vI;
varying float vT;
void main() {
  vec2 d = abs(vL) - uSize;
  float outside = length(max(d, 0.0));
  float inside = 1.0 - step(0.0, max(d.x, d.y));
  // rejilla de lámparas (cuadradas, con junta oscura); de lejos se funde en un rectángulo uniforme
  vec2 g = (vL + uSize) / uCell;
  vec2 f = fract(g) - 0.5;
  float fw = max(fwidth(g.x), fwidth(g.y));
  float m = max(abs(f.x), abs(f.y));
  float lamp = 1.0 - smoothstep(0.31 - fw, 0.31 + fw, m);
  lamp = mix(lamp, 0.4, smoothstep(0.18, 0.55, fw));
  float frame = inside * 0.05;
  float halo = exp(-(outside * outside) / (uHalo * uHalo)) * (1.0 - inside) * 0.05 + inside * 0.04;
  vec3 c = mix(uWarm, uCool, vT);
  float a = (inside * lamp * 2.1 + frame + halo) * vI;
  if (a < 0.0005) discard;
  gl_FragColor = vec4(c * a, 1.0);
}`;

/* ───────────────────────── Texto pintado / gráficos virtuales ───────────────────────── */

export const DECAL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const DECAL_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity, uFogD;
uniform vec2 uNear;           // distancia (m) a la que la rotulación pintada empieza / acaba de aparecer
uniform vec3 uFog;
varying vec2 vUv;
varying vec3 vW;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float dist0 = length(vW - cameraPosition);
  float a = t.a * uOpacity * smoothstep(uNear.x, uNear.y, dist0);
  if (a < 0.003) discard;
  float dist = length(vW - cameraPosition);
  float fx = dist * uFogD;
  vec3 c = mix(t.rgb * uColor, uFog, 1.0 - exp(-fx * fx));
  gl_FragColor = vec4(c, a);
}`;
