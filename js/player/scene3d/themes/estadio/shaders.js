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
uniform vec3 uTop, uHaze, uGlow, uSkyFx;
uniform float uHazeK, uStars;
uniform sampler2D uSkyT;      // cielo de foto (noche con nubes, CC0); sin red, el degradado de siempre
uniform vec4 uSkyK;           // x mezcla de la foto (0/1), y giro con el estadio (rad), z ganancia, w -
varying vec2 vNdc;
#define PI_SKY 3.14159265
float skyHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec4 p = uProjInv * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize((uCamWorld * vec4(p.xyz / p.w, 0.0)).xyz);
  float el = dir.y;
  // noche profunda arriba; aire iluminado por los focos justo sobre la cubierta (sin rayos: un degradado liso)
  vec3 col = mix(uHaze, uTop, smoothstep(0.02, 0.9, el));
  // cúpula de aire iluminado sobre la cubierta: degradado muy suave que da profundidad a la noche
  col += uGlow * exp(-max(el - 0.32, 0.0) * 3.2) * smoothstep(0.08, 0.32, el) * uHazeK;
  if (uSkyK.x > 0.5) {
    // la foto cubre 140° de azimut: se repite en espejo (sin costuras) y gira con el estadio; en altura se usa solo
    // la franja de nubes (por encima de la ciudad de la foto), de la cubierta al cenit
    float az = atan(dir.x, -dir.z) + uSkyK.y;
    float tri = abs(fract(az / PI_SKY) * 2.0 - 1.0);              // periodo π: sin costura al dar la vuelta
    vec2 suv = vec2(0.1 + 0.8 * tri, 0.30 + 0.66 * pow(clamp(el, 0.0, 1.0), 0.8));
    vec3 ph = texture2D(uSkyT, suv).rgb;
    // las nubes bajas recogen la luz del estadio (más claras y cálidas junto a la cubierta)
    float low = exp(-max(el, 0.0) * 3.0);
    col = ph * uSkyK.z * (0.75 + 0.9 * low * uHazeK) + uGlow * 0.5 * low * uHazeK;
  }
  // estrellas: pocas y finas, solo en lo alto (los focos se comen las del horizonte); punto de ~1 px, sin centelleo
  if (uStars > 0.0 && el > 0.16 && uSkyK.x < 0.5) {
    vec2 sp = vec2(atan(dir.z, dir.x), asin(clamp(el, -1.0, 1.0))) * 70.0;
    vec2 ci = floor(sp);
    float hs = skyHash(ci);
    if (hs > 0.88) {
      vec2 o = vec2(skyHash(ci + 3.1), skyHash(ci + 7.7)) * 0.6 + 0.2;
      float px = max(fwidth(sp.y), 1e-4);
      float d = length(fract(sp) - o);
      float core = 1.0 - smoothstep(0.6 * px, 1.6 * px, d);
      col += mix(vec3(1.0, 0.9, 0.78), vec3(0.74, 0.84, 1.0), skyHash(ci + 1.7)) * core * (hs - 0.88) * 2.4 * uStars * smoothstep(0.16, 0.5, el);
    }
  }
  // el cielo recoge la luz de los fuegos (test VAM): un velo del color del estallido, más denso cerca de la cubierta
  col += uSkyFx * (0.25 + 0.75 * exp(-max(el, 0.0) * 2.4));
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
uniform vec3 uTrack, uGrass, uApron, uPaint, uFog, uCur, uSweepCol, uSweepFrom, uGold, uSpecCol, uEnv, uTint;
uniform float uSigCam, uFogD, uLight, uSpec, uMotion, uRailBase, uApproach, uGoldK, uDetail, uPaintK, uDArea, uHdr;
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
uniform vec2 uFeel;           // sensación de velocidad: x contraste de las señales cercanas, y separación de las marcas (σ)
uniform vec4 uRing;           // plano final · vuelta de honor del bordillo: x σ de salida, y metros encendidos, z brillo de la cabeza, w nivel sin encender
uniform sampler2D uTartanT, uTartanN, uGrassT;   // web 1.14: tartán y césped de foto (CC0)
uniform float uPhoto;
uniform float uNor;           // 1 si hay mapa de normales del caucho
uniform float uWet;           // pista mojada por el relente (0..1): más oscura, más saturada y con brillo
// test VAM (efectos): todo a cero fuera del test ⇒ la pista de siempre
uniform vec4 uWave;           // onda del escalón: x frente σrel, y intensidad, z cola (m), w semiancho de la línea de cambio (m)
uniform vec3 uWaveCol;
uniform vec4 uLaneLed;        // x líneas de calle encendidas, y extra en TU calle, z resplandor de las vallas LED en el arcén, w -
uniform vec3 uFxCol;          // color de los efectos (la zona; oro por encima de tu VAM)
uniform vec4 uVamLine;        // línea de TU VAM: x σrel, y intensidad
uniform vec3 uEnvFx;          // luz de los fuegos reflejada en la pista
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
  // (el grano cercano es el flujo óptico más fino: la sensación de velocidad lo sube un poco donde hay píxeles)
  float grainK = 0.14 + 0.1 * clamp(uFeel.x, 0.0, 1.5) * near * uDetail;
  float stripe = 0.5 + 0.5 * cos(p.x * (PI / 6.0));
  float sw = 1.0 - smoothstep(0.5, 3.0, fwidth(p.x) * 2.0);
  // realismo (igual que el paseo de la Costa): el tartán es el de la foto, con su color ladrillo y su grano de caucho,
  // a dos escalas para que no se vea la repetición; el arcén, el mismo caucho en gris azulado; césped segado a franjas
  vec3 tx1 = texture2D(uTartanT, p / 1.3).rgb;
  vec3 tx2 = texture2D(uTartanT, p / 7.1 + 0.37).rgb;
  float tA = dot(tx1, vec3(0.3, 0.59, 0.11));
  float tB = dot(tx2, vec3(0.3, 0.59, 0.11));
  vec3 rubber = mix(uTrack * (0.84 + 0.16 * n1 + grainK * (grain - 0.5)), mix(tx1, tx2, 0.45) * uTint, uPhoto);
  vec3 apronC = uApron * mix(0.84 + 0.16 * n1, tA * 3.4 + tB * 1.6, uPhoto);
  vec3 synth = mix(rubber, apronC, apronM);
  // TEXTURA DE PISTA (nov-26): el tartán es un granulado de caucho. De cerca se ven los granos (la foto con el
  // contraste subido + granos sueltos más claros y más oscuros, de 5 mm); a media distancia, lo que hace que una pista
  // parezca una pista: manchas amplias de desgaste y de humedad, vetas a lo largo de la calle (el extendido y las
  // zancadas), las juntas de trabajo cada 24 m y el centro de las calles interiores más pulido y más claro
  float fine = 1.0 - smoothstep(0.003, 0.014, fwR);
  // (a velocidad, el grano suelto se funde: es lo que haría el desenfoque de movimiento)
  float grit = (tA / 0.085 - 1.0) * 2.4 * uPhoto + (hash12(floor(p / 0.005)) - 0.5) * 0.5 * fine * (1.0 - 0.7 * uMotion);
  // (se reutilizan los ruidos que ya había — n1, mott, streak — y uno amplio, que también reparte la humedad)
  float big = vnoise(p * 0.11 + 2.0);
  float blot = (n1 - 0.5) * 0.24 + (mott - 0.5) * 0.14 + (big - 0.5) * 0.26;
  float vein = (streak - 0.5) * 0.18;
  float jointD = abs(fract(sig / 24.3 + 0.5) - 0.5) * 24.3 * sScale;
  float joint = lineAA(jointD, 0.011, fwM) * (1.0 - smoothstep(0.03, 0.22, fwM)) * step(-0.6, r);
  synth *= (1.0 + grit) * (1.0 + blot + vein) * (1.0 + 0.16 * wear) * (1.0 - 0.22 * joint);
  // mojado, a rodales: más oscuro y más saturado donde el agua llena el poro del caucho
  float damp = clamp(uWet * (0.5 + 1.1 * big), 0.0, 1.0);
  synth = mix(synth, pow(max(synth, vec3(0.0)), vec3(1.12)) * 0.82, damp);
  vec3 gT = texture2D(uGrassT, p / 2.4).rgb * 0.6 + texture2D(uGrassT, p / 9.0 + 0.21).rgb * 0.4;
  float gL = mix(0.34, dot(gT, vec3(0.3, 0.59, 0.11)), uPhoto);
  // (la foto es hierba seca: se queda con su relieve y el color lo pone un verde de campo regado)
  vec3 grass = uGrass * (gL * 2.9) * (0.86 + 0.26 * mix(0.5, stripe, sw) + 0.1 * (n1 - 0.5));
  grass = mix(grass, grass * (0.7 + 0.6 * gT / max(gL, 0.05)), 0.35 * uPhoto);
  // áreas de concursos en los fondos (dentro de las curvas): sintético algo más oscuro, sin borde marcado con el césped
  float dArea = step(TA, ax) * (1.0 - trackM);
  synth *= 1.0 - uDArea * dArea;
  vec3 base = mix(synth, grass, grassM);
  // el carril del LED del fantasma: una regleta oscura de 6 cm junto al bordillo
  base *= 1.0 - 0.45 * lineAA(abs(r + 0.13), 0.03, fwR);

  // ── pintura: líneas de calle, bordillo, marcas de vallas, línea de meta y salida de 200 m ──
  float onTrack = step(0.4, r) * step(r, TTW + 0.12);
  float k = floor(r / TLW + 0.5);
  float lane = lineAA(abs(r - k * TLW), 0.025, fwR) * step(0.5, k) * step(k, 8.5);
  lane = mix(lane, 0.025 / TLW * 2.0 * onTrack, smoothstep(0.22, 0.55, fwR / TLW));
  float curb = lineAA(abs(r + 0.03), 0.03, fwR);
  // la pintura de las líneas no es perfecta: algo comida donde más se pisa
  lane *= 0.72 + 0.28 * mott;
  // marcas de vallas, como en una pista de verdad: trazos cortos de color (azul, amarillo, verde) pegados a las líneas
  float s10 = abs(fract(sig / 10.0 + 0.5) - 0.5) * 10.0 * sScale;
  float hurdle = lineAA(s10, 0.035, fwM) * lineAA(abs(abs(r - k * TLW) - 0.09), 0.045, fwR) * step(0.5, k) * step(k, 8.5) * near;
  float hIdx = mod(floor(sig / 10.0 + 0.5), 3.0);
  vec3 hurdleC = hIdx < 0.5 ? vec3(0.06, 0.2, 0.62) : hIdx < 1.5 ? vec3(0.72, 0.56, 0.05) : vec3(0.08, 0.42, 0.14);
  // salidas escalonadas (compensación de las curvas): 400 m en la primera curva y 200 m en la segunda, una línea
  // blanca por calle cada vez más adelantada; y, en amarillo, las zonas de relevos
  float starts = 0.0;
  float relay = 0.0;
  if (ax > TA && r > 0.0 && r < TTW) {                        // solo en las curvas y dentro de las calles
    float lf = clamp(floor(r / TLW), 0.0, 7.0);
    float inLaneX = bandAA(r, lf * TLW + 0.05, (lf + 1.0) * TLW - 0.05, fwR);
    float stg = lf < 0.5 ? 0.0 : 7.04 + 7.67 * (lf - 1.0);
    // metros por tu calle desde el inicio de la curva (la 1 lleva las salidas de 400 m; la 2, las de 200 m)
    float first = step(0.0, p.x);
    float bm = (sig - mix(2.0 * TLS + PI * TRCP, TLS, first)) * sScale - stg * mix(0.5, 1.0, first);
    starts = lineAA(abs(bm), 0.025, fwM) * inLaneX * mix(1.0, step(0.5, lf), first);
    relay = (lineAA(abs(bm - 80.0), 0.025, fwM) + lineAA(abs(bm - 110.0), 0.025, fwM)) * inLaneX;
  }
  float across = smoothstep(-0.05, 0.02, r) * (1.0 - smoothstep(TTW, TTW + 0.05, r));
  float fin = lineAA(abs(relSig(TLS, uSigCam) - srel) * sScale, 0.025, fwM);
  // (al salir de la curva 1, la línea de calle libre de los 800 m: verde)
  float brk = lineAA(abs(relSig(TLS + PI * TRCP, uSigCam) - srel) * sScale, 0.025, fwM) * step(TLW, r);
  // marcas de ritmo: pequeñas marcas claras sobre las dos líneas de TU calle cada ~2,5 m (como las de vallas, más
  // seguidas): el flujo cercano que da la sensación de velocidad a metros reales. Solo de cerca (sin moaré)
  float sR = abs(fract(sig / uFeel.y + 0.5) - 0.5) * uFeel.y * sScale;
  float camLine = max(lineAA(abs(r - uLaneCam.x), 0.07, fwR), lineAA(abs(r - uLaneCam.y), 0.07, fwR));
  float rhythm = lineAA(sR, 0.05, fwM) * camLine * near * clamp(0.15 + 0.5 * uFeel.x, 0.0, 1.0);
  float paint = max(max(max(lane, fin * across), rhythm), starts);
  // rotulación de los fondos (zonas D), como en un estadio real: pasillo de jabalina (4 m) con su línea de lanzamiento
  // y una línea paralela al bordillo. Solo se lee en el plano final; de cerca nunca entra en cuadro
  float fwP = edge - 0.02 + 1e-5;
  float dIn = ax - TA;
  float dMark = lineAA(abs(abs(p.y) - 2.0), 0.03, fwP) * step(0.0, dIn) * step(dIn, 27.0);
  dMark = max(dMark, lineAA(abs(dIn - 27.0), 0.035, fwP) * step(abs(p.y), 2.0));
  dMark = max(dMark, lineAA(abs(r + 5.5), 0.03, fwR));
  paint = max(paint, dMark * dArea * 0.6);
  // pintura blanca gastada: deja ver el grano del caucho
  vec3 col = mix(base, uPaint * uPaintK * (0.9 + 0.6 * grit * fine), paint * (1.0 - 0.25 * joint));
  // marcas de color (por debajo de las blancas): vallas, relevos y calle libre
  float lit0 = max(uPaint.r, 0.01) * uPaintK;
  col = mix(col, hurdleC * lit0 * 1.5, hurdle * 0.85 * (1.0 - paint));
  col = mix(col, vec3(0.78, 0.6, 0.06) * lit0, min(relay, 1.0) * 0.9 * (1.0 - paint));
  col = mix(col, vec3(0.1, 0.5, 0.18) * lit0, brk * across * 0.9 * (1.0 - paint));
  col = mix(col, vec3(0.42, 0.43, 0.45) * uPaintK, curb);       // bordillo de aluminio
  // oclusión de contacto: el pie del muro de vallas y el escalón del bordillo, más oscuros
  col *= 1.0 - 0.45 * exp(-max(TWALL - r, 0.0) / 0.9) * step(r, TWALL);
  col *= 1.0 - 0.3 * exp(-max(-r - 0.06, 0.0) / 0.25) * step(r, -0.06) * step(-1.2, r);
  // la luz de los focos no cae igual en todas partes: manchas amplias, apenas visibles
  col *= 0.88 + 0.24 * big;

  // ── luz: focos uniformes + reflejo satinado y suave de las baterías de focos (el grano lo rompe un poco) ──
  col *= uLight;
  vec3 V = -toCam / max(dist, 1e-3);
  float spec = 0.0;
  float rough = 160.0 * (0.7 + 0.6 * mott) * mix(1.0, 0.55 + 0.9 * tA, uPhoto);
  // relieve del caucho (mapa de normales de la foto): rompe el brillo de los focos en grano, como el suelo mojado
  vec3 Ng = vec3(0.0, 1.0, 0.0);
  if (uNor > 0.5 && uDetail > 0.5) {
    vec3 nt = texture2D(uTartanN, p / 1.3).xyz * 2.0 - 1.0;
    Ng = normalize(vec3(nt.x * 0.55, 1.0, nt.y * 0.55) * vec3(near, 1.0, near) + vec3(0.0, 1e-3, 0.0));
  }
  for (int i = 0; i < 6; i++) {
    vec3 L = normalize(uBank[i].xyz - vW);
    vec3 H = normalize(L + V);
    spec += pow(max(dot(H, Ng), 0.0), rough) * uBank[i].w;
  }
  float fres = 0.04 + 0.96 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
  float gloss = mix(1.0, 0.1, grassM) * (1.0 - 0.7 * dArea) * (1.0 + 0.45 * wear) * (0.45 + 1.1 * damp) * (1.0 - 0.5 * paint);
  col += uSpecCol * spec * fres * uSpec * gloss;
  // satinado: en ángulos rasantes la pista refleja el estadio iluminado (profundidad sin focos de más)
  col += uEnv * fres * gloss * uLight;
  col += uEnvFx * (0.25 + fres) * gloss;

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
  // plano final: el bordillo se enciende desde la meta y da la vuelta entera (uRing.y ≥ vuelta ⇒ todo encendido)
  float ringD = mod(sig - uRing.x, TLC);
  float ringLit = 1.0 - smoothstep(uRing.y - 1.5, uRing.y, ringD);
  float ringK = mix(uRing.w, 1.0, ringLit) + uRing.z * ringLit * exp(-max(uRing.y - ringD, 0.0) / 7.0);
  float baseK = uRailBase * mix(0.55, 1.0, ledMod) * ringK;
  vec3 rail = baseCol * baseK;
  // pacer (Wavelight): bloque de luz a tu velocidad objetivo, más intenso hacia la cabeza
  float ph = uPacer.x; float pl = uPacer.y;
  float tt = clamp((srel - (ph - pl)) / pl, 0.0, 1.0);
  float blk = bandAA(srel, ph - pl, ph, fwS + 0.04);
  float pac = blk * (0.3 + 0.7 * tt * tt) * uPacer.z;
  pac += bandAA(srel, ph - 2.2, ph, fwS + 0.05) * 0.8 * uPacer.z;
  vec3 pcol = mix(zoneColAt(srel, fwS), uGold, uGoldK);
  rail += pcol * pac * uHdr * ledMod;
  // charco de luz del pacer sobre la pista junto al bordillo (los LED iluminan el suelo): se lee de lejos
  float poolS = smoothstep(ph - pl - 3.0, ph - pl + 3.0, srel) * (1.0 - smoothstep(ph - 2.5, ph + 3.5, srel)) * smoothstep(3.0, 11.0, srel);
  float pool = exp(-abs(r + 0.03) / 0.2) * (1.0 - ledA) * poolS;
  // la luz que el bloque deja en el suelo (charco y reflejo en la calle 1) no puede tener los cantos a cuchillo del
  // propio LED: su perfil a lo largo de la pista se funde en ~3 m y el color cambia en ~1,2 m en la línea de cambio
  vec3 pcolR = mix(zoneColAt(srel, fwS + 1.2), uGold, uGoldK);
  float pacR = (smoothstep(ph - pl - 1.5, ph - pl + 1.5, srel) * (0.3 + 0.7 * tt * tt) + 0.8 * smoothstep(ph - 3.7, ph - 0.7, srel))
    * (1.0 - smoothstep(ph - 1.0, ph + 2.0, srel)) * uPacer.z;
  vec3 baseR = baseCol;
  if (uSweep.w > 0.5) baseR = mix(uSweepFrom, uSweepCol, 1.0 - smoothstep(uSweep.x - fwS - 1.2, uSweep.x + fwS + 1.2, srel));
  em += pcolR * uPacer.z * 0.26 * pool;
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
  em += (baseR * uRailBase * ringK * 0.55 + pcolR * pacR * 0.12) * exp(-max(r - 0.02, 0.0) / 0.42) * step(0.02, r) * trackM * gloss;
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
    if (gi > 0.001) {
      float dg = abs(srel - uGate[i].x) * sScale;
      // (en el test la línea del escalón es una barra de luz con su resplandor en el tartán: uWave.w > 0,035)
      em += uGateCol[i] * gi * across * (lineAA(dg, uWave.w, fwM) * 2.2 + step(0.05, uWave.w) * exp(-dg / 1.1) * 0.2);
    }
  }
  // ── test VAM ──
  // líneas de calle encendidas en el color del escalón (más las de TU calle): la pista entera sube de tono con el test
  if (uLaneLed.x + uLaneLed.y > 0.001) {
    float mine = max(lineAA(abs(r - uLaneCam.x), 0.03, fwR), lineAA(abs(r - uLaneCam.y), 0.03, fwR));
    em += uFxCol * (lane * uLaneLed.x + mine * uLaneLed.y);
  }
  // resplandor de las vallas LED en el arcén (el muro ilumina el suelo a sus pies)
  if (uLaneLed.z > 0.001) em += uFxCol * uLaneLed.z * exp(-max(TWALL - r, 0.0) / 1.7) * step(r, TWALL) * step(TTW, r) * (0.6 + 0.8 * tA);
  // onda del escalón: una lámina de luz sale de tus pies y recorre la pista por delante (frente nítido, cola que se apaga)
  if (uWave.y > 0.001) {
    float dw = (uWave.x - srel) * sScale;
    float head = lineAA(abs(dw), 0.16, fwM);
    float tail = step(0.0, dw) * exp(-dw / uWave.z);
    em += uWaveCol * uWave.y * across * (head * 2.6 + tail * (0.16 + 0.22 * tA + 1.4 * lane));
  }
  // la línea de TU VAM: dorada, ancha, con su resplandor (viene por la pista como las del récord en televisión)
  if (uVamLine.y > 0.001) {
    float dv = abs(srel - uVamLine.x) * sScale;
    em += uGold * uVamLine.y * across * (lineAA(dv, 0.12, fwM) * 2.8 + lineAA(abs(dv - 0.42), 0.03, fwM) * 1.4 + exp(-dv / 1.6) * 0.2);
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
uniform vec3 uFog, uBoardCol, uAccent, uFascia, uRim, uConc, uSeat;
uniform float uFogD, uLight, uEq, uBoardK, uDetail;
uniform vec4 uSweepB;       // x frente (u, m), y intensidad, z ancho, w vuelta (m)
uniform vec3 uSweepBCol;    // color del barrido de las vallas (blanco en el drop, el del tramo nuevo en un cambio)
uniform vec4 uCrowd;        // luces del público: x densidad base (0..1), y frente de la ola (u, m), z fuerza de la ola, w reloj
uniform vec2 uCrowdK;       // x brillo, y píxeles de dispositivo por px CSS (tamaño del punto)
uniform vec4 uShow;         // x público en la grada (0 vacía .. 1 llena), y flashes de cámara (0..1), z vallas LED encendidas, w anillo LED del anfiteatro
uniform vec4 uShowT;        // x avance del dibujo de las vallas (m), y fase de los paquetes del anillo (0..1), z -, w -
uniform vec3 uFxCol;        // color de los efectos (la zona; oro por encima de tu VAM)
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
  vec2 gU = vec2(dFdx(u), dFdy(u));            // (derivadas fuera de las ramas: las usan las luces del público)
  vec2 gA = vec2(dFdx(along), dFdy(along));
  vec3 col;
  vec3 em = vec3(0.0);
  vec3 crowd = vec3(0.0);
  float dist = length(vW - cameraPosition);
  float dsw = abs(u - uSweepB.x);
  dsw = min(dsw, uSweepB.w - dsw);
  float sweepK = exp(-dsw / max(uSweepB.z, 0.1)) * uSweepB.y;
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
    float sweep = sweepK * inB;
    em += uBoardCol * 0.012 * inB * (1.0 - gap);
    em += uAccent * (meter * 0.2 + top * uBoardK) * (1.0 - gap);
    em += uSweepBCol * sweep * 0.9 * (1.0 - gap);
    // vallas LED encendidas (test): el color del escalón con puntas de flecha que corren en tu sentido; de lejos, liso
    if (uShow.z > 0.001) {
      float cz = fract((u - uShowT.x) / 3.2 - abs(bv - 0.5) * 0.55);
      float chev = mix(smoothstep(0.0, 0.08, cz) * (1.0 - smoothstep(0.5, 0.62, cz)), 0.5, smoothstep(0.1, 0.4, fwU / 3.2));
      // de cerca se ve la matriz de diodos (paso de 4 cm)
      vec2 dq = vec2(u, along) / 0.04;
      float diode = mix(1.0, 0.55 + 0.9 * smoothstep(0.5, 0.15, length(fract(dq) - 0.5)), 1.0 - smoothstep(0.012, 0.03, max(fwU, fwA)));
      em += uFxCol * uShow.z * inB * (1.0 - gap) * step(0.16, bv) * step(bv, 0.9) * (0.22 + 0.78 * chev) * diode;
    }
    col += vec3(0.05) * lineAA(abs(along - 1.09), 0.012, fwA);   // canto superior del muro
  } else if (face < 2.5) {
    col = uConc * (face < 1.5 ? 0.9 : 0.55) * (0.85 + 0.3 * vnoise(vec2(u * 0.7, along * 3.0)));  // pasillo y contrahuella (hormigón)
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
    // público sentado: cada asiento (0,5 m) lleva o no a alguien según lo llena que esté la grada (uShow.x); la ropa,
    // de colores apagados, recoge la luz de los focos. De lejos, la media (misma energía: sin hormigueo)
    if (uShow.x > 0.001) {
      vec2 sq = vec2(u / 0.5, along / rowH);
      float sh = hash12(floor(sq) + upper * 13.0 + 0.5);
      float fillL = clamp(uShow.x * (0.3 + 0.9 * occ), 0.0, 1.0);
      float seated = step(sh, fillL);
      // ropa: casi toda oscura y apagada, alguna camiseta clara (como se ve una grada de noche)
      vec3 cloth = 0.5 + 0.5 * cos(6.2831 * (sh * 9.0 + vec3(0.0, 0.33, 0.67)));
      float lv = fract(sh * 17.0);
      cloth = mix(vec3(dot(cloth, vec3(0.333))), cloth, 0.3) * (0.3 + 1.5 * lv * lv * lv);
      vec2 sf = fract(sq) - vec2(0.5, 0.42);
      float body = 1.0 - smoothstep(0.16, 0.44, length(sf * vec2(1.0, 0.8)));
      float head = 1.0 - smoothstep(0.05, 0.13, length(sf - vec2(0.0, 0.3)));
      vec3 near1 = mix(vec3(1.0), mix(vec3(0.55), cloth * 2.6, body) + vec3(1.5, 1.15, 0.95) * head, seated);
      vec3 far1 = mix(vec3(1.0), vec3(1.45, 1.4, 1.35), fillL);
      tint *= mix(far1, near1, res * uDetail);
    }
    float soft = 0.8 + 0.4 * vnoise(vec2(u * 0.08, along * 0.12));
    float aisleD = abs(fract(u / 18.0 + 0.5) - 0.5) * 18.0;
    float aisle = 1.0 - smoothstep(0.55 - fwU, 0.55 + fwU, aisleD);
    float spill = mix(1.35, 0.5, v) * mix(1.0, 0.6, upper);
    col = uSeat * spill * soft * mix(person * tread * tint, uConc / max(uSeat, vec3(1e-3)) * 0.8, aisle);
    float vom = (1.0 - upper) * step(abs(fract(u / 36.0 + 0.5) - 0.5) * 36.0, 1.4) * step(5.6, along) * step(along, 8.0);
    col *= 1.0 - 0.6 * vom;
    // canto de cada fila (y de cada peldaño del pasillo): luz rasante de los focos
    float nose = lineAA(min(rv, 1.0 - rv) * rowH, 0.016, fwA);
    float stepN = aisle * lineAA(abs(fract(along / (rowH * 0.5) + 0.5) - 0.5) * rowH * 0.5, 0.012, fwA);
    // de lejos (detrás del número, al fondo) los cantos se funden en una textura serena
    float farL = 1.0 - 0.55 * smoothstep(60.0, 160.0, dist);
    em += uRim * (nose * (0.55 + 0.45 * (1.0 - v)) * mix(1.0, 0.7, upper) + stepN * 0.35) * (1.0 - vom) * spill * farL;
    // luces del público: móviles encendidos en la grada. Una celda de 1,4 m × 2 filas puede llevar un punto, redondo
    // en pantalla a cualquier distancia (~1 px CSS) y con energía conservada cuando la celda ya no tiene píxeles (sin
    // centelleo al moverse la cámara). La densidad sube poco a poco (sprint, final) y una ola la recorre en km y mitad:
    // cada luz entra fundiéndose, nunca de golpe. Sin bloom (por debajo del umbral) y sin depender de uLight.
    if (uCrowd.x + uCrowd.z + uShow.y > 0.002) {
      vec2 cq = vec2(u / 1.4, along / (rowH * 2.0));
      vec2 ci = floor(cq);
      float hs = hash12(ci + upper * 57.0 + 0.5);
      float dw = abs(u - uCrowd.y);
      dw = min(dw, uSweepB.w - dw);
      float pr = (uCrowd.x + uCrowd.z * exp(-dw * dw / 2600.0)) * (0.25 + 0.75 * occ) * (1.0 - aisle) * (1.0 - vom);
      // flashes de cámara (test): cada novena de segundo, unas pocas celdas al azar dan un destello que se apaga solo
      float ft = uCrowd.w * 9.0;
      float fh = hash12(ci * 1.37 + floor(ft) * vec2(0.731, 0.413) + upper * 11.0);
      float flash = step(1.0 - uShow.y * 0.0075, fh) * (1.0 - aisle) * (1.0 - vom) * (1.0 - fract(ft)) * (1.0 - fract(ft));
      if (hs < pr || flash > 0.001) {
        float h2 = hash12(ci + 7.1);
        vec2 dc = fract(cq) - (vec2(h2, hash12(ci + 3.7)) * 0.5 + 0.25);
        // de celda a píxeles con el jacobiano (la grada se ve en escorzo y sesgada: sin él, el punto sale estirado)
        vec2 gx = gU / 1.4;
        vec2 gy = gA / (rowH * 2.0);
        float det = gx.x * gy.y - gx.y * gy.x;
        float adet = max(abs(det), 1e-9);
        float ngx = length(gx);
        float ngy = length(gy);
        vec2 sp = vec2(gy.y * dc.x - gx.y * dc.y, gx.x * dc.y - gy.x * dc.x) / (det < 0.0 ? -adet : adet);
        float rad = max(0.95, 0.62 * uCrowdK.y);
        float r2 = rad * rad;
        // donde una dirección de la celda ya no tiene píxeles (de canto o muy lejos), su media en esa dirección: nunca
        // un rectángulo del tamaño de la celda, y sin parpadeo al moverse la cámara
        vec2 lod = 1.0 - smoothstep(vec2(0.1), vec2(0.24), vec2(ngx, ngy) * rad);
        vec2 cov = min(1.77 * rad * vec2(ngx, ngy), vec2(1.0));
        float ex = dc.x * ngy / adet;
        float ey = dc.y * ngx / adet;
        float pt = mix(mix(cov.x * cov.y, exp(-ex * ex / r2) * cov.y, lod.x), mix(exp(-ey * ey / r2) * cov.x, exp(-dot(sp, sp) / r2), lod.x), lod.y);
        float tw = 0.8 + 0.2 * sin(uCrowd.w * (0.7 + 2.2 * h2) + hs * 61.0);
        crowd = mix(vec3(1.0, 0.92, 0.8), vec3(0.8, 0.89, 1.0), h2) * (pt * tw * smoothstep(0.0, 0.06, pr - hs) * (0.3 + 0.7 * h2 * h2) * uCrowdK.x);
        crowd += vec3(0.94, 0.97, 1.0) * (pt * flash * 3.2);
      }
    }
  } else if (face < 4.5) {
    col = uConc * 0.6 * (0.85 + 0.3 * v);                                      // frente del anfiteatro superior
    em += uRim * 1.4 * lineAA(abs(v - 0.96), 0.03, fwidth(v) + 1e-4);          // su borde superior, iluminado
    // anillo LED del anfiteatro (test): una cinta del color del escalón da la vuelta al estadio, con paquetes de luz
    // que la recorren; el barrido del escalón también pasa por aquí
    if (uShow.w + sweepK > 0.001) {
      float inR = smoothstep(0.3, 0.36, v) * (1.0 - smoothstep(0.64, 0.7, v));   // una cinta de ~0,9 m en el centro del frente
      float cellR = 1.0 - lineAA(abs(fract(u / 4.0 + 0.5) - 0.5) * 4.0, 0.05, fwU);
      float pk = fract(u / 64.0 - uShowT.y);
      float packet = smoothstep(0.0, 0.04, pk) * exp(-pk * 7.0);
      em += (uFxCol * uShow.w * (0.3 + 1.5 * packet) + uSweepBCol * sweepK * 0.7) * inR * cellR;
    }
  } else if (face < 6.5) {
    col = uConc * 0.28 * (0.6 + 0.6 * v);                        // muro del fondo, en sombra bajo la cubierta
  } else if (face < 7.5) {
    // intradós de la cubierta: chapa clara sobre cerchas de acero cada 8 m y correas cada 3 m; la luz que rebota del
    // campo la baña desde abajo, más cuanto más cerca del borde
    // (cerchas: viga de 0,5 m con su sombra a un lado; entre ellas, paños de chapa grecada de tono algo distinto
    // cada uno; pasarela técnica cerca del canto. La luz rebotada del campo entra por el borde y se pierde al fondo)
    float bay = u / 8.0;
    float ribD = abs(fract(bay + 0.5) - 0.5) * 8.0;
    float rib = lineAA(ribD, 0.25, fwU);
    float ribSh = exp(-max(ribD - 0.25, 0.0) / 0.7) * 0.35;
    float purl = lineAA(abs(fract(along / 2.4 + 0.5) - 0.5) * 2.4, 0.06, fwA) * (1.0 - smoothstep(0.08, 0.4, fwA));
    float groove = 1.0 - 0.1 * (0.5 + 0.5 * sin(u * 21.0)) * (1.0 - smoothstep(0.03, 0.12, fwU));
    float tone = 0.88 + 0.24 * hash12(vec2(floor(bay), floor(along / 7.2)) + 3.0);
    float walk = lineAA(abs(v - 0.88), 0.012, fwidth(v) + 1e-4);
    float bounce = 0.16 + 0.95 * pow(v, 1.8);
    col = uConc * vec3(1.0, 1.03, 1.1) * bounce * tone * groove * (1.0 - ribSh) * (1.0 - 0.3 * purl);
    col = mix(col, uConc * 0.16, max(rib, walk));
    em += vec3(0.05, 0.048, 0.045) * smoothstep(0.7, 1.0, v);   // la luz de los focos baña el borde de la cubierta
  } else if (face < 8.5) {
    col = uFascia * (0.85 + 0.3 * v);                            // canto frontal de la cubierta
    em += vec3(1.0, 0.95, 0.88) * 0.11 * lineAA(abs(v - 0.1), 0.05, fwidth(v) + 1e-4);
  } else {
    col = uConc * 0.35;
  }
  col *= uLight;
  float fx = dist * uFogD;
  float fogK = 1.0 - exp(-fx * fx);
  col = mix(col, uFog, fogK);
  col += (em * uLight + crowd) * exp(-dist * 0.0022);
  gl_FragColor = vec4(col, 1.0);
}`;

/* ───────────────────────── Baterías de focos: lámparas redondas + resplandor (una llamada de dibujo) ─────────────────────────
   Cada batería son 16 lámparas LED (2 filas de 8 bajo el canto de la cubierta) y un resplandor. TODO son discos que
   miran a la cámara: una lámpara se ve redonda desde cualquier sitio y la fila sigue la curva de la cubierta, así que
   no hay rectángulos que se tuerzan al tomar las curvas (antes: un panel plano con su halo en el mismo plano). De lejos
   las 16 se funden en una barra de luz; de cerca se cuentan una a una. */

export const BANK_VERT = /* glsl */ `
attribute vec3 aPos;     // centro de la lámpara o del resplandor (estadio)
attribute vec3 aNrm;     // hacia dónde mira la batería (al campo, inclinada hacia abajo)
attribute vec4 aRnd;     // x radio (m; ≥ 1 ⇒ es el resplandor de la batería), y brillo, z temperatura, w batería
uniform vec4 uDim;       // x, y atenuación por grupo (vuelta a la calma): pares/impares · z encendido del estadio (0..1) · w golpe de luz
uniform vec4 uAvoid;     // rectángulo NDC del número de velocidad: los focos no se colocan detrás (composición)
uniform vec4 uAvoid2;    // ídem para la barra superior
uniform vec3 uGlow;      // x radio del resplandor (m) cerca, y su crecimiento por metro, z radio mínimo de una lámpara (rad)
varying vec2 vL;
varying float vI;
varying float vT;
varying float vK;        // 0 lámpara · 1 resplandor
void main() {
  vec4 w = modelMatrix * vec4(aPos, 1.0);
  vec4 mv = viewMatrix * w;
  float dist = max(-mv.z, 0.0);
  vK = step(1.0, aRnd.x);
  float R = mix(max(aRnd.x, dist * uGlow.z), uGlow.x * (1.0 + dist * uGlow.y), vK);
  mv.xy += position.xy * R;                    // en el plano de la imagen: redondo desde cualquier sitio
  vec4 c = projectionMatrix * mv;
  vL = position.xy;
  vT = aRnd.z;
  float g = mod(aRnd.w, 2.0);
  vec3 nW = normalize(mat3(modelMatrix) * aNrm);
  vec3 toCam = normalize(cameraPosition - w.xyz);
  float facing = smoothstep(-0.2, 0.55, dot(nW, toCam));
  vI = aRnd.y * mix(uDim.x, uDim.y, g) * facing;
  // (una lámpara por debajo de 1 px conserva su energía: se atenúa lo que se agranda)
  float grow = max(aRnd.x, dist * uGlow.z) / max(aRnd.x, 1e-3);
  vI *= mix(1.0 / (grow * grow), 1.0, vK);
  vec4 cc = projectionMatrix * viewMatrix * w;
  if (cc.w > 0.5) {
    vec2 n = cc.xy / cc.w;
    float inside = min(min(n.x - uAvoid.x, uAvoid.z - n.x), min(n.y - uAvoid.y, uAvoid.w - n.y));
    vI *= 1.0 - smoothstep(-0.08, 0.02, inside);
    float inside2 = min(min(n.x - uAvoid2.x, uAvoid2.z - n.x), min(n.y - uAvoid2.y, uAvoid2.w - n.y));
    vI *= 1.0 - smoothstep(-0.05, 0.02, inside2);
  }
  // encendido del estadio (cuenta atrás, test VAM): las baterías entran una a una, cada una con su rampa
  vI *= mix(0.04, 1.0, smoothstep(0.0, 0.3, uDim.z * 1.3 - fract(aRnd.w * 0.6180339)));
  // golpe de luz (test VAM: cada escalón, tu VAM batida, el final): todas suben a la vez y vuelven
  vI *= 1.0 + uDim.w;
  gl_Position = c;
}`;

export const BANK_FRAG = /* glsl */ `
uniform vec2 uAir;       // velo de aire iluminado del resplandor: x anchura (0..1 del disco), y intensidad
uniform vec3 uWarm, uCool;
varying vec2 vL;
varying float vI;
varying float vT;
varying float vK;
void main() {
  float r2 = dot(vL, vL);
  if (r2 > 1.0 || vI < 0.002) discard;
  float a;
  if (vK < 0.5) {
    // lámpara: lente con borde suave y punto caliente en el centro
    a = (1.0 - smoothstep(0.55, 1.0, r2)) * (0.75 + 2.4 * exp(-r2 * 5.0)) * 1.5;
  } else {
    // resplandor: corona + velo de aire (bruma de estadio) + estela horizontal de la lente, muy tenue
    float edge = 1.0 - smoothstep(0.5, 1.0, r2);
    a = (exp(-r2 * 26.0) * 0.5 + exp(-r2 * 7.0) * 0.16 + exp(-r2 / max(uAir.x * uAir.x, 1e-3)) * uAir.y
      + exp(-abs(vL.y) * 44.0) * exp(-vL.x * vL.x * 3.0) * 0.22) * edge;
  }
  a *= vI;
  if (a < 0.0015) discard;
  gl_FragColor = vec4(mix(uWarm, uCool, vT) * a, 1.0);
}`;

/* ───────────────────────── Texto pintado / gráficos virtuales ───────────────────────── */

export const DECAL_VERT = /* glsl */ `
uniform float uKey;      // gráfico anamórfico (plano final): el borde lejano es (1 + uKey) veces más ancho que el cercano
uniform float uKeyPos;   // 1: el shader ensancha la malla · 0: la malla ya viene ensanchada (bandas del test) y solo se corrige el uv
varying vec3 vUvq;       // uv proyectivo (uv·q, q): sin el pliegue en la diagonal de un trapecio de dos triángulos
varying vec3 vW;
void main() {
  // (bandas del test: uv.y va lineal en PANTALLA, no en metros ⇒ q = distancia relativa = 1 / (1 − v·key/(1+key)))
  float q = uKeyPos > 0.5 ? 1.0 + uKey * uv.y : 1.0 / (1.0 - uv.y * uKey / (1.0 + uKey));
  vUvq = vec3(uv * q, q);
  vec4 w = modelMatrix * vec4(position.x * mix(1.0, q, uKeyPos), position.y, position.z, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const DECAL_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity, uFogD;
uniform vec2 uNear;           // distancia (m) a la que la rotulación pintada empieza / acaba de aparecer
uniform vec3 uFog;
varying vec3 vUvq;
varying vec3 vW;
void main() {
  vec4 t = texture2D(uMap, vUvq.xy / vUvq.z);
  float dist0 = length(vW - cameraPosition);
  float a = t.a * uOpacity * smoothstep(uNear.x, uNear.y, dist0);
  if (a < 0.003) discard;
  float dist = length(vW - cameraPosition);
  float fx = dist * uFogD;
  vec3 c = mix(t.rgb * uColor, uFog, 1.0 - exp(-fx * fx));
  gl_FragColor = vec4(c, a);
}`;

/* ───────────────────────── Fuegos artificiales (test VAM): puntos aditivos, un estallido por ranura ───────────────────────── */

export const FW_VERT = /* glsl */ `
attribute vec4 aSeed;     // x ranura del estallido, y z dirección (azar), w azar
uniform vec4 uB[NB];      // xyz origen (estadio), w reloj de salida
uniform vec4 uBC[NB];     // rgb color, w velocidad inicial (m/s)
uniform float uTime, uPx;
uniform vec4 uAvoid;      // rectángulo NDC del número de velocidad: los fuegos se apagan detrás (composición)
varying vec3 vC;
varying float vA;
void main() {
  int bi = int(aSeed.x + 0.5);
  vec4 b = uB[bi];
  float age = uTime - b.w;
  float life = 2.1 + 1.1 * aSeed.w;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; vC = vec3(0.0); return; }
  float ph = aSeed.y * 6.2831853;
  float ct = aSeed.z * 2.0 - 1.0;
  float st = sqrt(max(1.0 - ct * ct, 0.0));
  vec3 d = vec3(st * cos(ph), ct, st * sin(ph));
  float sp = uBC[bi].w * (0.72 + 0.28 * fract(aSeed.w * 7.3));
  // frenado por el aire + caída: la palmera se abre rápido, se queda colgada y cae despacio
  vec3 p = b.xyz + d * sp * (1.0 - exp(-age * 1.7)) / 1.7 - vec3(0.0, 2.4 * age * age, 0.0);
  vec4 c = projectionMatrix * viewMatrix * (modelMatrix * vec4(p, 1.0));
  float u = age / life;
  float tw = 0.7 + 0.3 * sin(age * 34.0 + aSeed.w * 90.0);
  vA = (1.0 - u * u) * smoothstep(0.0, 0.06, age) * mix(1.0, tw, smoothstep(0.35, 1.0, u));
  vC = mix(vec3(1.0, 0.96, 0.88), uBC[bi].rgb, smoothstep(0.03, 0.28, u));
  vec2 n = c.xy / max(c.w, 1e-3);
  float inside = min(min(n.x - uAvoid.x, uAvoid.z - n.x), min(n.y - uAvoid.y, uAvoid.w - n.y));
  vA *= 1.0 - 0.82 * smoothstep(-0.06, 0.02, inside);
  gl_Position = c;
  gl_PointSize = uPx * (1.5 + 1.7 * fract(aSeed.w * 3.7)) * (1.0 - 0.45 * u);
}`;

export const FW_FRAG = /* glsl */ `
varying vec3 vC;
varying float vA;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = exp(-dot(q, q) * 15.0) * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vC * a * 2.6, 1.0);
}`;
