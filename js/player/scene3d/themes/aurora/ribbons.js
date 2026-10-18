// BestRunning · escenario AURORA · cortinas de aurora.
// Cuatro cortinas verticales (una sola malla ⇒ 1 draw call) colgadas a cientos de metros: su trazado horizontal se
// pliega con ruido lento y donde el pliegue se pone de canto hacia la cámara la luz atraviesa más espesor y se
// enciende (como en una aurora real).
// Color = ACENTO, nunca lavado (§15.1): el color pleno de la zona vive SOLO en el borde inferior (un filo fino y su
// resplandor inmediato); los rayos se funden enseguida hacia un índigo-grafito neutro y su brillo está acotado. Así un
// sprint es un filo rojo bajo rayos índigo, no una franja roja que tiña el cuarto superior de la pantalla.
// La composición (dónde cuelga cada cortina, su altura y su techo) la decide aurora.js en ÁNGULOS respecto a la cámara
// (borde inferior siempre por encima del número de velocidad, rayos extinguidos antes de la barra superior) y aquí se
// traduce a metros.
//
// Coste por píxel (lo que manda a DPR 2): el ruido que solo depende de la posición a lo largo de la cortina (manchas y
// deformación del dominio de los rayos) se calcula por VÉRTICE; por fragmento queda 1 ruido (2 en calidad alta) y una
// salida temprana en las zonas sin luz (la mitad superior de cada cortina). En eco/baja se pintan 3 cortinas.

const NR = 4;

const VERT = /* glsl */ `
#define NR ${NR}
uniform vec4 uA[NR];   // azimut centro (rad), apertura (rad), distancia (u), alejamiento hacia la derecha
uniform vec4 uB[NR];   // altitud del borde inferior, altura, amplitud del pliegue (fracción), pliegues por cortina
uniform vec4 uC[NR];   // fase del pliegue, fase de los rayos, alfa, tensión
attribute vec3 aRib;   // u (a lo largo), v (0 abajo, 1 arriba), índice
varying vec3 vRib;
varying vec4 vK;       // pliegue (brillo), alfa, tensión, fase de rayos
varying vec2 vEnv;     // manchas (0..1) · deformación del dominio de los rayos
NOISE_CHUNK

vec2 pathAt(float u, vec4 A, vec4 B, float ph) {
  float az = A.x + (u - 0.5) * A.y;
  float rec = 1.0 + A.w * (u - 0.5);
  float f = B.w * 6.2831853;
  float fold = sin(u * f + ph) * 0.6 + sin(u * f * 2.31 - ph * 1.37 + 1.7) * 0.25 + sin(u * f * 0.43 + ph * 0.61 + 4.1) * 0.4;
  float r = A.z * rec * (1.0 + B.z * fold) / max(0.35, cos(az));
  return vec2(sin(az) * r, -cos(az) * r);
}

void main() {
  int i = int(aRib.z + 0.5);
  vec4 A = uA[i];
  vec4 B = uB[i];
  vec4 C = uC[i];
  float u = aRib.x;
  float ri = aRib.z;
  vec2 p0 = pathAt(u, A, B, C.x);
  vec2 p1 = pathAt(u + 0.003, A, B, C.x);
  vec2 T = normalize(p1 - p0 + 1e-5);
  vec2 N = vec2(-T.y, T.x);
  vec2 V = normalize(p0 - cameraPosition.xz);
  float c = abs(dot(N, V));
  float fold = clamp(1.0 / (0.3 + 0.7 * c), 1.0, 2.4);
  float alt = B.x * (1.0 + 0.04 * sin(u * 6.0 + C.x * 0.5));
  vec3 p = vec3(p0.x, alt + aRib.y * B.y, p0.y);
  // ruido de baja frecuencia a lo largo de la cortina (idéntico en toda la columna): por vértice
  float n3 = vnoise(vec2(u * 4.0 + ri * 3.1 + C.y * 0.04, ri * 7.0 + C.y * 0.1));
  vEnv = vec2(0.18 + 0.82 * smoothstep(0.22, 0.85, n3), vnoise(vec2(u * 9.0 + ri * 4.0, C.y * 0.07)) * 5.0);
  vRib = aRib;
  vK = vec4(fold, C.z, C.w, C.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uLow, uBody, uNext;
uniform float uNextFront, uGain, uBodyK, uWave, uWaveU, uSpecK, uQ, uCap;
uniform sampler2D uSpec;
varying vec3 vRib;
varying vec4 vK;
varying vec2 vEnv;
NOISE_CHUNK
void main() {
  float u = vRib.x;
  float v = vRib.y;
  float ri = vRib.z;
  float ten = vK.z;
  float ph = vK.w;
  float edge = mix(0.06, 0.04, ten);
  // envolvente barata primero: fuera de la luz (arriba de la cortina, extremos, manchas apagadas) no se calcula ruido
  float ends = smoothstep(0.0, 0.18, u) * (1.0 - smoothstep(0.82, 1.0, u));
  float env = smoothstep(0.0, edge, v) * (1.0 - smoothstep(0.55, 0.98, v)) * ends * vEnv.x * vK.x * vK.y * uGain;
  env *= 1.0 + uWave * exp(-(u - uWaveU) * (u - uWaveU) * 40.0);
  float hgt = mix(0.6, 0.44, ten);
  float reach = exp(-max(v - edge, 0.0) / hgt * 1.6);
  if (env * reach < 0.0005) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  // rayos con separación irregular (dominio deformado por vértice): nada de "valla" regular
  float x = u * mix(52.0, 88.0, ten) + vEnv.y;
  float n1 = vnoise(vec2(x, ri * 17.0 + ph));
  float n2 = uQ > 0.5 ? vnoise(vec2(x * 2.7 + 31.0, ri * 5.0 - ph * 1.6)) : n1;
  float rays = 0.12 + 0.88 * (n1 * 0.62 + n2 * 0.38);
  rays *= rays * 1.5;
  float spec = texture2D(uSpec, vec2(0.04 + 0.5 * fract(u * 0.85 + ri * 0.23), 0.5)).r;
  // cada rayo llega a una altura distinta (y algo más con la música): cortina, no bloque
  float decay = exp(-max(v - edge, 0.0) / (hgt * (0.45 + 0.75 * n1 + 0.25 * spec * uSpecK)) * 1.6);
  vec3 low = mix(uLow, uNext, 1.0 - smoothstep(uNextFront - 0.18, uNextFront, u));
  // franja inferior: color pleno de la zona, nítida por abajo y fundida hacia arriba en ~12 % de la altura
  float band = smoothstep(0.0, edge, v) * exp(-max(v - edge, 0.0) / 0.07) * (0.45 + 0.55 * min(rays, 1.3));
  // rayos: índigo-grafito neutro con brillo acotado (del color de la zona solo justo encima de la franja)
  // la franja de color pesa sobre todo en la cortina delantera: las de detrás son rayos neutros (sin "cables" de color
  // apilados)
  float a3 = vK.y * vK.y * vK.y;
  vec3 rayCol = mix(low * 0.55, uBody, max(smoothstep(edge, edge + 0.12, v), 1.0 - a3));
  float body = min(decay * rays, uCap);
  vec3 col = low * band * 0.34 * a3 * a3 + rayCol * body * uBodyK;
  gl_FragColor = vec4(col * env, 1.0);
}`;

export function createRibbons(ctx) {
  const { THREE, root } = ctx;
  const SEG = ctx.qualityLevel >= 1 ? 160 : 112;
  const cols = SEG + 1;
  const vCount = NR * cols * 2;
  const rib = new Float32Array(vCount * 3);
  const idx = [];
  for (let r = 0; r < NR; r++) {
    for (let i = 0; i <= SEG; i++) {
      const k = (r * cols + i) * 2;
      rib.set([i / SEG, 0, r], k * 3);
      rib.set([i / SEG, 1, r], (k + 1) * 3);
      if (i < SEG) idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const perRibbon = SEG * 6;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vCount * 3), 3));
  geo.setAttribute('aRib', new THREE.BufferAttribute(rib, 3));
  geo.setIndex(idx);

  const A = [];
  const B = [];
  const Cc = [];
  for (let r = 0; r < NR; r++) { A.push(new THREE.Vector4()); B.push(new THREE.Vector4()); Cc.push(new THREE.Vector4()); }
  const u = {
    uA: { value: A }, uB: { value: B }, uC: { value: Cc },
    uLow: { value: new THREE.Color() }, uBody: { value: new THREE.Color() }, uNext: { value: new THREE.Color() },
    uNextFront: { value: 0 }, uGain: { value: 0.3 }, uBodyK: { value: 3 }, uWave: { value: 0 }, uWaveU: { value: -1 },
    uSpecK: { value: 1 }, uQ: { value: ctx.qualityLevel >= 3 ? 1 : 0 }, uCap: { value: 0.9 },
    uSpec: { value: ctx.spectrumTexture },
  };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: VERT.replace('NOISE_CHUNK', ctx.shaders.NOISE),
    fragmentShader: FRAG.replace('NOISE_CHUNK', ctx.shaders.NOISE),
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  root.add(mesh);

  /** Calidad: 2 ruidos por píxel solo en alta; en eco/baja se pinta sin la cortina más lejana (la más tenue). */
  function setQuality(level) {
    u.uQ.value = level >= 3 ? 1 : 0;
    geo.setDrawRange(0, (level >= 2 ? NR : NR - 1) * perRibbon);
  }
  setQuality(ctx.qualityLevel);

  return {
    NR,
    u,
    mesh,
    setQuality,
    /**
     * Cortina i en ángulos: { az, span, dist, recede, elev (borde inferior, rad), top (techo, rad), heightK (0..1 de la
     * banda hasta el techo), foldAmp, foldFreq, phase, rayPhase, alpha, tension }. El borde inferior queda en `elev`
     * incluso en la parte más lejana del pliegue y lo alto de la cortina no pasa del techo ni en la más cercana.
     */
    set(i, p) {
      const fa = 1.25 * p.foldAmp; // desplazamiento radial máximo del pliegue (suma de amplitudes del trazado)
      const alt = p.dist * (1 + fa) * Math.tan(p.elev);
      const topAlt = p.dist * Math.max(0.3, 1 - fa) * Math.tan(Math.min(1.35, p.top));
      A[i].set(p.az, p.span, p.dist, p.recede);
      B[i].set(alt, Math.max(1, (topAlt - alt) * p.heightK), p.foldAmp, p.foldFreq);
      Cc[i].set(p.phase, p.rayPhase, p.alpha, p.tension);
    },
  };
}
