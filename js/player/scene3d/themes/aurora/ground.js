// BestRunning · escenario AURORA · suelo.
// Llanura helada azul-negra, mate, con un satinado leve (Fresnel) que recoge el horizonte. Para que el avance se LEA en
// 3D (no motas flotando en el vacío) la llanura tiene un relieve muy suave de ondulaciones de nieve/arena que viaja
// hacia ti exactamente a tu velocidad, iluminado solo donde hay luz: el resplandor del río y un velo tenue de la aurora
// hacia el horizonte. Su detalle se apaga con la distancia (sin moaré) y cerca de la cámara (sin parpadeo a 18 km/h).
// Sobre ella, el río deja su resplandor (mismo trazado y mismo color por tramo que las partículas). Cada cambio de tramo
// es UNA línea fina que cruza el río y te alcanza en el segundo exacto; cada kilómetro y la MITAD, otra más tenue y
// fría. Niebla al color del horizonte ⇒ unión perfecta con el cielo; un filete fino marca el horizonte.
import { RIVER_GLSL } from './common.js';

const GATES = 3;
export const RIPS = 4;

const VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
#define GATES ${GATES}
#define RIPS ${RIPS}
uniform vec3 uGround, uHorizon, uRiverCol, uKmCol, uGhostCol, uGold, uAmb;
uniform float uGlow, uWidth, uFogD, uRecord, uFade, uVpK, uSg, uRelief;
uniform vec3 uAccent;
uniform vec4 uGate[GATES];
uniform vec3 uGateCol[GATES];
uniform vec4 uKm;
uniform vec4 uMark;
uniform vec4 uGhost;
uniform vec3 uSun;       // hora real: resplandor del sol bajo (mismo término que el cielo, reflejado por el satinado)
uniform float uSunAz;
uniform vec4 uRip[RIPS]; // ondas del bombo: centro x, centro d (u por delante), radio (u), intensidad
varying vec3 vW;
RIVER_CHUNK
NOISE_CHUNK
float lineAA(float v, float c, float w) { float fw = fwidth(v); return 1.0 - smoothstep(w, w + fw * 1.5, abs(v - c)); }
// ruido de valor PERIÓDICO a lo largo de la pista (periodo py celdas) ⇒ el desplazamiento uSg = S mod 1200 no salta
float pnoise(vec2 p, float py) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float y0 = mod(i.y, py);
  float y1 = mod(i.y + 1.0, py);
  return mix(mix(hash12(vec2(i.x, y0)), hash12(vec2(i.x + 1.0, y0)), u.x),
             mix(hash12(vec2(i.x, y1)), hash12(vec2(i.x + 1.0, y1)), u.x), u.y);
}
void main() {
  vec3 toCam = vW - cameraPosition;
  float dist = length(toCam);
  float d = -vW.z;
  float dx = vW.x - riverX(d);
  float zw = d + uSg; // coordenada del suelo a lo largo de la pista (viaja hacia ti a tu velocidad)
  // relieve: ondulaciones alargadas de través (periodo 2,2 u) sobre un moteado ancho; el detalle fino se apaga lejos
  vec2 q1 = vec2(vW.x * 0.32, zw * 0.45);   // 1200 · 0,45 = 540 celdas
  vec2 q2 = vec2(vW.x * 0.07, zw * 0.05);   // 1200 · 0,05 = 60 celdas
  float lod = 1.0 - smoothstep(0.18, 0.55, fwidth(q1.y));
  float rip = mix(0.5, smoothstep(0.28, 0.78, pnoise(q1, 540.0)), lod);
  float mot = pnoise(q2, 60.0);
  float tex = clamp(0.15 + 1.1 * rip * (0.5 + 0.9 * mot), 0.0, 1.6);
  vec3 col = uGround * (0.75 + 0.5 * mot);
  // horizonte (mismo color y resplandor que el cielo a elevación 0): el satinado lo refleja y la niebla se funde en él
  vec3 dir = toCam / max(dist, 1e-3);
  float vp = exp(-abs(atan(dir.x, -dir.z)) * 7.0);
  vec3 hz = uHorizon + uAccent * (exp(-abs(dir.y) * 110.0) * (0.0015 + 0.022 * vp) + exp(-abs(dir.y) * 500.0) * 0.012 * vp) * uVpK;
  float sAz = abs(atan(dir.x, -dir.z) - uSunAz);
  hz += uSun * (exp(-abs(dir.y) * 34.0) * (0.3 + 0.7 * exp(-sAz * 2.4)));
  float cosT = clamp(abs(dir.y), 0.0, 1.0);
  float fr = 0.03 + 0.97 * pow(1.0 - cosT, 5.0);
  col = mix(col, hz, fr * 0.8);
  // luz de la aurora sobre la llanura: velo frío que revela el relieve, más presente hacia el horizonte
  float nearK = smoothstep(2.0, 14.0, d);
  col += uAmb * tex * uRelief * nearK * (0.35 + 0.65 * smoothstep(4.0, 60.0, d)) * (1.0 - fr * 0.6);
  // resplandor del río (del color de cada tramo de río), que también ilumina el relieve
  vec3 rc = uRiverCol;
  for (int k = 0; k < GATES; k++) if (uGate[k].y > 0.0) rc = mix(rc, uGateCol[k], smoothstep(uGate[k].x - 0.5, uGate[k].x + 0.5, d));
  rc = mix(rc, uGold, uRecord);
  float w2 = uWidth * uWidth;
  float pool = exp(-dx * dx / (w2 * 2.2));
  float core = exp(-dx * dx / (w2 * 0.12));
  float riverK = smoothstep(1.0, 16.0, d); // cerca de la cámara (tras el rótulo inferior) el lecho se calma
  col += rc * (pool * (0.12 + 0.7 * tex) + core * 0.3) * uGlow * riverK * uFade;
  // ondas del bombo: anillos concéntricos finos que viajan por la escarcha (la luz rasante del río sobre el relieve)
  for (int k = 0; k < RIPS; k++) {
    vec4 R = uRip[k];
    if (R.w > 0.001) {
      vec2 o = vec2(vW.x - R.x, d - R.y);
      float r = length(o);
      float wd = 0.28 + R.z * 0.05;
      float x = (r - R.z) / wd;
      float aa = 1.0 - smoothstep(0.6, 1.6, fwidth(r) / wd); // sin moaré cuando el anillo es subpíxel
      // confinadas al lecho del río (nunca cruzan por detrás del número ni de las tarjetas)
      float bed = exp(-dx * dx / (w2 * 3.0));
      col += rc * exp(-x * x) * R.w * aa * bed * (0.35 + 0.65 * tex) * 0.2 * riverK * uFade;
    }
  }
  // líneas finas: cambio de tramo (color del tramo que llega) · kilómetro y MITAD (blanco frío, más tenue)
  // la línea solo cruza el río y se desvanece hacia las orillas (nunca de lado a lado de la pantalla)
  float across = exp(-dx * dx / (w2 * 3.0));
  for (int k = 0; k < GATES; k++) {
    if (uGate[k].y > 0.0) col += uGateCol[k] * lineAA(d, uGate[k].x, 0.035) * uGate[k].y * across * uFade;
  }
  col += uKmCol * (lineAA(d, uKm.x, 0.025) * uKm.y + lineAA(d, uMark.x, 0.03) * uMark.y) * 0.5 * across * uFade;
  // hilo del fantasma sobre el suelo (muy tenue, solo por detrás de su cabeza)
  if (uGhost.z > 0.001) {
    float gx = dx - uGhost.x;
    float behind = uGhost.y - d;
    float tr = behind > 0.0 ? 0.25 + 0.75 * exp(-behind / 16.0) : 0.12;
    col += uGhostCol * exp(-gx * gx * 90.0) * tr * uGhost.z * 0.05 * smoothstep(6.0, 18.0, d);
  }
  // niebla al color del horizonte ⇒ horizonte sin costura
  float fx = dist * uFogD;
  col = mix(col, hz, 1.0 - exp(-fx * fx));
  gl_FragColor = vec4(col, 1.0);
}`;

export function createGround(ctx, shared) {
  const { THREE, root } = ctx;
  const u = {
    uGround: { value: new THREE.Color('#05070c') },
    uHorizon: { value: new THREE.Color('#0a0f1d') },
    uRiverCol: { value: new THREE.Color() },
    uKmCol: { value: new THREE.Color('#cfdcff') },
    uGhostCol: { value: new THREE.Color('#a9dcff') },
    uGold: { value: new THREE.Color('#ffcf5a') },
    uAmb: { value: new THREE.Color('#1b2140') },
    uGlow: { value: 0.05 }, uWidth: { value: 1.5 }, uFogD: { value: 0.0062 }, uRecord: { value: 0 }, uFade: { value: 1 },
    uVpK: { value: 1 }, uAccent: { value: new THREE.Color() }, uSg: { value: 0 }, uRelief: { value: 0.05 },
    uBend: shared.uBend, uSm: shared.uSm, uGate: shared.uGate, uGateCol: shared.uGateCol, uKm: shared.uKm,
    uMark: shared.uMark, uGhost: shared.uGhost,
    uSun: { value: new THREE.Color(0, 0, 0) }, uSunAz: { value: -0.3 },
    uRip: { value: Array.from({ length: RIPS }, () => new THREE.Vector4(0, -100, 0, 0)) },
  };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800), new THREE.ShaderMaterial({
    uniforms: u, vertexShader: VERT,
    fragmentShader: FRAG.replace('RIVER_CHUNK', RIVER_GLSL).replace('NOISE_CHUNK', ctx.shaders.NOISE),
  }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.z = -700;
  mesh.frustumCulled = false;
  root.add(mesh);
  return { u, mesh };
}
