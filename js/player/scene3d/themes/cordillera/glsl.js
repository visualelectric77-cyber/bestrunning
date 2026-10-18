// CORDILLERA · shaders. Terreno mate oscuro leído como un render topográfico / de telemetría: luz de luna baja por
// delante (filo de luz en las crestas a contraluz), relleno frío del cielo, perspectiva aérea (cada sierra más lejana
// más clara y azulada, hasta fundirse con el resplandor del horizonte), jerarquía de curvas de nivel (finas cada 2 u,
// maestras cada 10 u, directoras cada 50 u, todas antialias), camino de luz fino en la cresta, línea de cambio de tramo
// tendida sobre el relieve y bruma de valle. Cielo nocturno con estrellas reales (dos magnitudes), Vía Láctea muy tenue
// y una aurora sobria: cuerpo neutro y borde inferior del color de la zona.
// Nada de destellos ni máscaras (§15.2, §15.3): todo son líneas finas, acentos pequeños y oscuridad bien graduada.
// La malla BACK es la maqueta en relieve de la clase entera para el plano final (comprimida a lo largo de la ruta, sin
// detalle de alta frecuencia: nada de facetas).
import { BEND_GLSL, TEX_W } from './profile.js';

export const NB = 8; // bandas de detalle de la malla (ver terrain.js)

/* ───────────── Terreno ───────────── */

const PROFILE_GLSL = /* glsl */ `
uniform sampler2D uProf;
uniform vec3 uProfInfo;            // s0, ds, nº de muestras
vec2 profAt(float sAbs) {
  float u = clamp((sAbs - uProfInfo.x) / uProfInfo.y, 0.0, uProfInfo.z - 1.001);
  float fi = floor(u);
  int i = int(fi);
  int j = i + 1;
  vec2 a = texelFetch(uProf, ivec2(i % ${TEX_W}, i / ${TEX_W}), 0).rg;
  vec2 b = texelFetch(uProf, ivec2(j % ${TEX_W}, j / ${TEX_W}), 0).rg;
  return vec2(mix(a.x, b.x, u - fi), a.y);
}`;

const TERRAIN_GLSL = /* glsl */ `
float smaxK(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0); return mix(b, a, h) + k * h * (1.0 - h); }
float ridgedN(vec2 p) { float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0); return n * n; }
float rangeH(vec2 p) {
  // dominio deformado: cordales alargados y valles sinuosos en vez de conos
  p += vec2(vnoise(p * 0.55 + 1.7), vnoise(p * 0.55 + 8.3)) * 1.35 - 0.67;
  float s = 0.0;
  float a = 0.6;
  for (int i = 0; i < 4; i++) {
    s += a * ridgedN(p);
    p = mat2(1.62, 1.18, -1.18, 1.62) * p + vec2(3.7, 1.3);
    a *= 0.47;
  }
  return s;
}
// x: distancia lateral al camino (u) · sAbs: distancia visual absoluta · R: cota de la cresta en sAbs
float terrainH(float x, float sAbs, float R, float detail) {
  float ax = abs(x);
  // la cresta cambia de anchura y de lado a lo largo del camino: curvas de nivel onduladas, nunca "raíles" rectos
  float n1 = vnoise(vec2(sAbs * 0.011, 3.1)) - 0.5;
  float n2 = vnoise(vec2(sAbs * 0.043, 7.7)) - 0.5;
  float n3 = vnoise(vec2(sAbs * 0.0075, 1.7)) - 0.5;
  float w = (46.0 + 0.62 * R) * (1.0 + 0.9 * n1 + 0.45 * n2) * (1.0 + 0.7 * sign(x) * n3);
  float t = max(ax - 1.5, 0.0) / max(w, 12.0);
  float h = R * exp(-pow(t, 1.12));
  // pequeños espolones junto al camino
  h += (vnoise(vec2(x * 0.09, sAbs * 0.07)) - 0.5) * 3.4 * smoothstep(2.0, 9.0, ax);
  float flankN = smoothstep(9.0, 30.0, ax);
  float fade = 1.0 - smoothstep(260.0, 1100.0, ax);
  float k = clamp(R / 110.0, 0.4, 1.0);
  // espolones y barrancos que bajan por las laderas (dan a las curvas de nivel su forma de "V" topográfica)
  vec2 wq = vec2(x * 0.006, sAbs * 0.008);
  float wf = smoothstep(8.0, 120.0, ax);
  float xw = x + (vnoise(wq) - 0.5) * 110.0 * wf;
  float sw = sAbs + (vnoise(wq + 5.2) - 0.5) * 150.0 * wf;
  float g1 = ridgedN(vec2(xw * 0.016, sw * 0.026)) - 0.45;
  float g2 = vnoise(vec2(xw * 0.005, sw * 0.011)) - 0.5;
  float g3 = (1.0 - abs(vnoise(vec2(xw * 0.0062 + 4.0, sw * 0.012)) * 2.0 - 1.0)) - 0.55;
  h += (g1 * 17.0 + g2 * 38.0) * flankN * k * fade + g3 * 64.0 * k * k * smoothstep(14.0, 170.0, ax) * fade;
  // sierras laterales: más altas cuanto más lejos (el fondo de la postal)
  float amp = 46.0 * smoothstep(40.0, 420.0, ax) + 380.0 * smoothstep(320.0, 2800.0, ax);
  float side = rangeH(vec2(x, sAbs) * 0.0011 + vec2(5.2, 9.1)) * amp;
  h = smaxK(max(h, 0.0), side, 1e-3 + 46.0 * clamp(amp / 46.0, 0.0, 1.0));
  // detalle fino cerca del camino (roca)
  h += ((vnoise(vec2(x, sAbs) * 0.075) - 0.5) * 3.2 + (vnoise(vec2(x, sAbs) * 0.028 + 9.0) - 0.5) * 5.0) * smoothstep(1.8, 22.0, ax) * detail;
  return h;
}
// Maqueta del plano final: la misma cresta (perfil de la clase) con laderas y sierras SOLO de baja frecuencia, en
// coordenadas comprimidas (q = s · c) para que el relieve sea isótropo. Sin espolones ni roca: ni una faceta.
float reliefH(float x, float q, float R) {
  float ax = abs(x);
  float n1 = vnoise(vec2(q * 0.004, 3.1)) - 0.5;
  float w = (40.0 + 0.55 * R) * (1.0 + 0.6 * n1);
  float t = max(ax - 1.0, 0.0) / max(w, 12.0);
  float h = R * exp(-pow(t, 1.25));
  float g = vnoise(vec2(x * 0.0045, q * 0.0045) + 2.3) - 0.5;
  h += g * 34.0 * smoothstep(20.0, 160.0, ax) * (1.0 - smoothstep(300.0, 900.0, ax));
  float amp = 30.0 * smoothstep(60.0, 360.0, ax) + 150.0 * smoothstep(360.0, 1700.0, ax);
  float side = rangeH(vec2(x, q) * 0.0016 + vec2(5.2, 9.1)) * amp;
  return smaxK(max(h, 0.0), side, 1e-3 + 36.0 * clamp(amp / 36.0, 0.0, 1.0));
}`;

export const TERRAIN_VERT = /* glsl */ `
// position.x = x lateral (u), position.y = fila (banda·256 + fila de la banda; o fila de la maqueta)
uniform vec3 uBand[${NB}];          // inicio (rel. al ancla), fin (rel.), paso
uniform vec4 uBack;                 // maqueta: s inicial (abs), paso por fila (abs), s final de la clase (abs), compresión
uniform vec4 uBack2;                // maqueta: exageración vertical, cota de referencia, longitud de la ruta (u), -
uniform float uAnchor, uFrac, uRcam, uBendCam, uYOff, uExag;
varying vec3 vW;
varying vec3 vN;
varying float vH;
varying float vX;
varying float vS;
varying float vZone;
NOISE_CHUNK
${BEND_GLSL}
${PROFILE_GLSL}
${TERRAIN_GLSL}
void main() {
  float aX = position.x;
  float aRow = position.y;
#ifdef BACK
  float sAbs = uBack.x + aRow * uBack.y;
  float c = uBack.w;
  float q = (sAbs - uBack.z) * c;                 // ≤ 0: la meta en el origen, la salida hacia +z
  vec2 pr = profAt(sAbs);
  float h = reliefH(aX, q, pr.x);
  float e = 6.0;
  float hx = reliefH(aX + e, q, pr.x);
  float hs = reliefH(aX, q + e, profAt(sAbs + e / c).x);
  float ex = uBack2.x;
  vN = normalize(vec3(-(hx - h) / e * ex, 1.0, (hs - h) / e * ex));
  vec3 w = vec3(aX + bendAt(sAbs) * 0.75, (h - uBack2.y) * ex, -q);
  vS = sAbs - uAnchor;
#else
  int band = int(floor(aRow / 256.0 + 0.001));
  float row = aRow - float(band) * 256.0;
  vec3 B = uBand[band];
  float sRel = min(B.x + row * B.z, B.y);
  float sAbs = uAnchor + sRel;
  float d = sRel - uFrac;                          // distancia por delante de la cámara (u)
  vec2 pr = profAt(sAbs);
  float detail = 1.0 - smoothstep(160.0, 420.0, abs(d));
  float h = terrainH(aX, sAbs, pr.x, detail);
  // normal por diferencias finitas (paso continuo con la distancia: sin costuras entre bandas)
  float e = clamp(abs(d) * 0.008, 0.4, 24.0);
  float hx = terrainH(aX + e, sAbs, pr.x, detail);
  float hs = terrainH(aX, sAbs + e, profAt(sAbs + e).x, detail);
  float ex = uExag;
  vN = normalize(vec3(-(hx - h) / e * ex, 1.0, (hs - h) / e * ex));
  vec3 w = vec3(aX + bendAt(sAbs) - uBendCam, (h - uRcam) * ex + uYOff, -d);
  vS = sRel;
#endif
  vW = w;
  vH = h;
  vX = aX;
  vZone = pr.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

export const TERRAIN_FRAG = /* glsl */ `
uniform vec3 uAlb, uAmb, uMoonCol, uMoonDir, uHaze, uHazeLow, uLineCol, uRimCol;
uniform vec3 uAccent, uPathCur, uNext, uNeutral, uGhostCol, uGateCol, uGate2Col, uSweepCol, uMarkCol;
uniform vec3 uZoneCols[7];
uniform vec4 uGate;     // s rel. próxima línea, alfa, s rel. línea recién cruzada, alfa
uniform vec4 uPath;     // fin del tramo actual (rel.), fin del siguiente (rel.), intensidad del siguiente, intensidad
uniform vec4 uSweep;    // cota de la curva que barre, alfa
uniform vec4 uMark;     // s rel. del hito (km / mitad / meta), alfa
uniform vec4 uGhost;    // s rel. del fantasma, alfa
uniform vec4 uFog;      // densidad base, densidad de la bruma de valle, techo de la bruma, aclarado (final)
uniform vec4 uMisc;     // final 0..1, oro 0..1, pulso de ritmo, calidad (0 = ahorro)
uniform vec4 uBack2;    // (frag) z: longitud de la maqueta
uniform vec4 uLines;    // separación de curvas, radio del acento cercano, intensidad del acento, intensidad gris
uniform vec2 uRoute;    // maqueta final: tramo de la ruta dibujado (s rel. al ancla: salida, meta)
uniform float uAnchor, uFrac;
varying vec3 vW;
varying vec3 vN;
varying float vH;
varying float vX;
varying float vS;
varying float vZone;
NOISE_CHUNK
// isolínea periódica (curvas de nivel) de ~px píxeles, antialias y atenuada cuando se apelmaza
float iso(float v, float sp, float px) {
  float fw = max(fwidth(v), 1e-6);
  float d = abs(fract(v / sp + 0.5) - 0.5) * sp;
  float hw = px * 0.5 * fw;
  return (1.0 - smoothstep(hw, hw + fw, d)) * (1.0 - smoothstep(0.1, 0.32, fw / sp));
}
// línea fina de semiancho hw (mundo) con conservación de energía: a lo lejos se apaga en vez de parpadear
float thin(float d, float hw, float fw) {
  fw = max(fw, 1e-6);
  float ew = max(hw, fw * 0.65);
  return (1.0 - smoothstep(ew, ew + fw, d)) * (hw / ew);
}
void main() {
  vec3 V = vW - cameraPosition;
  float dist = length(V);
  vec3 Vd = -V / max(dist, 1e-3);                  // hacia la cámara
  vec3 n = normalize(vN);
  float finale = uMisc.x;
  float ax = abs(vX);
  float sAbs = uAnchor + vS;
  // material: roca mate con variación muy suave
  float m1 = vnoise(vec2(vX * 0.42, sAbs * 0.42));
  float m2 = vnoise(vec2(vX * 0.045, sAbs * 0.045));
  vec3 col = uAlb * (0.8 + 0.2 * m1 + 0.28 * m2);
  // luz: luna baja (envolvente suave), relleno del cielo por arriba
  float ndl = dot(n, uMoonDir);
  float dif = max(ndl, 0.0) * 0.8 + max((ndl + 0.3) / 1.3, 0.0) * 0.2;
  col *= uAmb * (0.45 + 0.55 * n.y) + uMoonCol * dif;
  // filo de luz: las aristas casi de canto recogen el resplandor del cielo (más mirando hacia la luna) ⇒ siluetas
  // de cresta legibles contra la sierra de detrás, sin brillo
  float ndv = clamp(dot(n, Vd), 0.0, 1.0);
  float rim = pow(1.0 - ndv, 4.0) * smoothstep(0.05, 0.55, n.y);
  float toward = smoothstep(-0.35, 0.85, dot(-Vd, uMoonDir));
  col += uRimCol * rim * (0.3 + 0.7 * toward) * (1.0 - 0.6 * finale);

  // curvas de nivel en jerarquía (finas, maestras, directoras): gris plata; acento de la zona cerca de ti
  float offPath = smoothstep(0.03, 0.14, ax) + finale;
  float sp = uLines.x;
  float down = clamp(-V.y / max(dist, 1e-3), 0.0, 1.0);
  // de canto (mirando la ladera casi horizontal) las isolíneas se vuelven rayas: se atenúan
  float edgeK = mix(0.25, 1.0, smoothstep(0.01, 0.12, down + 0.6 * finale));
  float minor = uMisc.w > 0.5 ? iso(vH, sp, 0.9) * (1.0 - smoothstep(160.0, 460.0, dist)) * (1.0 - finale) : 0.0;
  float major = iso(vH, sp * 5.0, 1.2) * (1.0 - smoothstep(1500.0, 3800.0, dist * (1.0 - 0.7 * finale)));
  float index = iso(vH, sp * 25.0, 1.6);
  float nearK = exp(-dist / uLines.y) * (1.0 - finale);
  vec3 grey = uLineCol * uLines.w;
  vec3 lineCol = mix(grey, uAccent * uLines.z * (1.0 + 0.12 * uMisc.z), nearK);
  float lines = minor * 0.34 + major * mix(0.8, 0.42, finale) + index * mix(1.15, 0.95, finale);
  col += lineCol * lines * edgeK * min(offPath, 1.0);

  // camino de luz en la cresta: acento del tramo actual, el siguiente tras la línea de cambio, neutro más allá
  float fwX = fwidth(vX);
  float core = thin(ax, 0.02, fwX);
  core = mix(core, 1.0 - smoothstep(fwX * 0.9, fwX * 2.0, ax), finale);
  float halo = exp(-ax / mix(0.18, 9.0, finale)) * mix(0.03, 0.06, finale);
  vec3 hist = uZoneCols[int(vZone + 0.5)];
  vec3 hue = vS < uPath.x ? uPathCur : (vS < uPath.y ? uNext : uNeutral);
  float pk = vS < uPath.x ? 1.0 : (vS < uPath.y ? uPath.z : 0.3);
  float behind = step(vS, uFrac - 2.0);
  hue = mix(hue, hist, max(behind, finale));
  pk = mix(mix(pk, 0.5, behind), 1.0, finale);
  // brillo percibido igual para todas las zonas y bajo el umbral del bloom (sin "cuentas" de aliasing)
  float pl = max(dot(hue, vec3(0.2126, 0.7152, 0.0722)), 0.05);
  float coreK = min(0.84 / pl, 3.4);
  // en la maqueta final, la ruta empieza en la salida y acaba en la meta (fuera de ella, la cresta sin luz)
  float route = mix(1.0, step(uRoute.x, vS) * step(vS, uRoute.y), finale);
  vec3 pathC = hue * (core * coreK + halo) * pk * uPath.w * route;
  // marcas de distancia cada 4 u a ambos lados del camino (pasan a tu velocidad real)
  float fwS = fwidth(vS);
  float tick = thin(abs(fract(vS * 0.25 + 0.5) - 0.5) * 4.0, 0.03, fwS);
  tick *= smoothstep(0.16, 0.22, ax) * (1.0 - smoothstep(0.52, 0.6, ax));
  col += uNeutral * tick * 0.03 * (1.0 - finale);

  // cambio de tramo: UNA línea fina tendida sobre el relieve (se cruza justo en el segundo del cambio)
  float latG = exp(-ax / 460.0) * (1.0 - min(core, 1.0)) * smoothstep(0.02, 0.12, ax);
  col += uGateCol * thin(abs(vS - uGate.x), 0.05, fwS) * uGate.y * latG * 1.4;
  col += uGate2Col * thin(abs(vS - uGate.z), 0.05, fwS) * uGate.w * latG * 1.4;
  // y una curva de nivel del acento nuevo que baja por las laderas desde tu cota
  if (uSweep.y > 0.002) {
    float fwH = max(fwidth(vH), 1e-5);
    col += uSweepCol * (1.0 - smoothstep(fwH * 0.8, fwH * 1.9, abs(vH - uSweep.x))) * uSweep.y * exp(-dist / 600.0) * 1.5 * min(offPath, 1.0);
  }
  // hito (KM n · MITAD · META): filete corto a través de la cresta
  col += uMarkCol * thin(abs(vS - uMark.x), 0.035, fwS) * (1.0 - smoothstep(1.4, 3.4, ax)) * uMark.y;
  // fantasma: charco de luz en el camino y estela corta hacia ti
  if (uGhost.y > 0.002) {
    float gd = vS - uGhost.x;
    float pool = exp(-(gd * gd * 1.2 + vX * vX * 12.0));
    float trail = exp(min(gd, 0.0) * 0.22) * step(gd, 0.0) * exp(-vX * vX * 260.0);
    col += uGhostCol * (pool * 0.55 + trail * 0.22) * uGhost.y;
  }

  // perspectiva aérea: cada sierra más lejana se aclara hacia el resplandor del horizonte (profundidad legible);
  // la bruma baja de los valles despega las crestas. En la maqueta final el aire se aclara.
  float mist = uFog.y * exp(-max(vH - uFog.z, 0.0) / 60.0);
  float fa = 1.0 - exp(-dist * (uFog.x * (1.0 - uFog.w) + mist * (1.0 - 0.8 * uFog.w)));
  // la maqueta se disuelve en la bruma lejos de la ruta: su borde nunca se ve
  float zc = abs(vW.z - 0.5 * uBack2.z) - 0.5 * uBack2.z;
  fa = max(fa, finale * max(smoothstep(2600.0, 5200.0, ax), smoothstep(500.0, 1300.0, zc)));
  vec3 hz = mix(uHaze, uHazeLow, clamp(mist / max(uFog.y, 1e-6), 0.0, 1.0) * 0.5);
  col = mix(col, hz, fa);
  // el camino atraviesa la bruma mejor que la roca (es emisivo): se lee de principio a fin
  col += pathC * mix(1.0 - 0.85 * fa, 1.0, finale);
  gl_FragColor = vec4(col, 1.0);
}`;

/* ───────────── Cielo ───────────── */

export const SKY_VERT = /* glsl */ `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

export const SKY_FRAG = /* glsl */ `
uniform mat4 uProjInv, uCamWorld;
uniform vec3 uZenith, uHaze, uGlow, uAurBody, uAurHem, uMoonDir;
uniform vec4 uAur;      // intensidad, cota de la base (rad), tiempo de la aurora, calidad
uniform vec4 uStars;    // estrellas, Vía Láctea, centro y anchura (rad) de la ventana de acimut de la aurora
varying vec2 vNdc;
NOISE_CHUNK
// una capa de estrellas en el plano estereográfico q: celdas con probabilidad p, brillo b0..b1, disco de ~1 px
float starLayer(vec2 q, float p, float b0, float b1, float seed) {
  vec2 c = floor(q);
  float h = hash12(c + seed);
  if (h > p) return 0.0;
  vec2 o = vec2(hash12(c + seed + 7.1), hash12(c + seed + 3.7)) * 0.7 + 0.15;
  vec2 d = fract(q) - o;
  float fw = max(fwidth(q.x), 1e-4);
  float r = fw * 0.7;                                // ~1,4 px de diámetro a cualquier escala
  float s = exp(-dot(d, d) / (r * r));
  return s * mix(b0, b1, pow(hash12(c + seed + 1.3), 3.0));
}
void main() {
  vec4 p = uProjInv * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize((uCamWorld * vec4(p.xyz / p.w, 0.0)).xyz);
  float el = dir.y;
  float e = max(el, 0.0);
  // degradado nocturno: horizonte con aire iluminado por la luna, cénit casi negro
  vec3 col = mix(uHaze, uZenith, pow(smoothstep(-0.02, 0.6, e), 0.5));
  vec2 hz = normalize(dir.xz + 1e-5);
  vec2 mz = normalize(uMoonDir.xz + 1e-5);
  float toward = max(dot(hz, mz), 0.0);
  col += uGlow * (0.35 + 0.65 * toward * toward) * exp(-e * 9.0);
  if (el > 0.0) {
    vec2 q = dir.xz / (1.0 + el);                    // proyección estereográfica del hemisferio superior
    float ext = smoothstep(0.02, 0.28, el);          // extinción cerca del horizonte
    // Vía Láctea: banda tenue con nubes de polvo (gran círculo inclinado), solo en calidad > ahorro
    float mw = 0.0;
    if (uStars.y > 0.0005) {
      vec3 N = normalize(vec3(0.62, 0.38, -0.69));
      float b = dot(dir, N);
      float band = exp(-b * b * 22.0);
      float dust = vnoise(dir.xz * 7.0 + dir.y * 3.0) * 0.6 + vnoise(dir.xz * 19.0 - dir.y * 5.0) * 0.4;
      mw = band * smoothstep(0.25, 0.85, dust);
      col += vec3(0.78, 0.82, 0.95) * mw * uStars.y * ext;
    }
    if (uStars.x > 0.001) {
      float s = starLayer(q * 380.0, 0.012 + 0.05 * mw, 0.04, 0.12, 0.0);  // campo débil (más denso en la Vía Láctea)
      s += starLayer(q * 150.0, 0.03, 0.14, 0.55, 31.0);                    // estrellas brillantes, pocas
      vec3 tint = mix(vec3(1.0, 0.9, 0.8), vec3(0.8, 0.88, 1.0), hash12(floor(q * 150.0) + 11.0));
      col += tint * s * uStars.x * ext;
    }
  }
  // aurora sobria y alta: cortina de cuerpo neutro con rayos verticales finos; el borde inferior toma el color de la
  // zona (lo ata a la escena: nada de verde fijo). Muy tenue, siempre en la banda alta del encuadre.
  if (uAur.x > 0.0005) {
    float az = atan(dir.x, -dir.z);
    float T = uAur.z;
    float base = uAur.y + 0.05 * sin(az * 1.3 + T * 0.03) + 0.025 * sin(az * 3.4 - T * 0.05 + 1.0);
    float hh = el - base;
    float body = smoothstep(-0.006, 0.014, hh) * exp(-max(hh, 0.0) * 5.0);
    float edge = exp(-abs(hh - 0.004) * 110.0);
    float rays = 0.5;
    if (uAur.w > 0.5) {
      float warp = vnoise(vec2(az * 5.0 + T * 0.05, T * 0.03)) * 9.0 + vnoise(vec2(az * 13.0 - T * 0.08, 2.0)) * 3.0;
      float r1 = 0.5 + 0.5 * sin(az * 95.0 + warp + hh * 6.0);
      float r2 = 0.5 + 0.5 * sin(az * 37.0 - warp * 0.7 + T * 0.2);
      rays = 0.25 + 0.75 * (r1 * r1 * 0.55 + r2 * 0.45);
    }
    float fold = 0.4 + 0.6 * smoothstep(0.2, 0.8, vnoise(vec2(az * 1.6 + T * 0.02, 0.5 + T * 0.015)));
    float a = (body * (0.25 + 0.75 * rays) + edge * 0.7 * rays) * fold;
    // ventana de acimut (composición): en horizontal la aurora se abre sobre el hueco libre de la derecha
    float aw = (az - uStars.z) / max(uStars.w, 0.05);
    a *= mix(0.12, 1.0, exp(-aw * aw)) * (0.55 + 0.45 * smoothstep(-0.3, 0.6, sin(az * 1.0 + 0.6)));
    vec3 c = mix(uAurHem, uAurBody, smoothstep(0.0, 0.07, hh));
    col += c * a * uAur.x;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/* ───────────── Luz del fantasma (billboard aditivo) ───────────── */

export const DOT_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export const DOT_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uA;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float core = 1.0 - smoothstep(0.12, 0.3, r);
  float glow = exp(-r * r * 9.0) * 0.35;
  gl_FragColor = vec4(uCol * (core * 2.2 + glow) * uA, 1.0);
}`;
