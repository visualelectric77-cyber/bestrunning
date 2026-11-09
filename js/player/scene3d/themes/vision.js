// RITMUP · escenario MODO VISIÓN. Tu clase entera dibujada como una escalera de luz: cada tramo es un escalón macizo
// del color de su zona, tan alto como su esfuerzo (velocidad + inclinación) y tan largo como los metros que corres en
// él; con cuesta, el escalón sube. Entre tramos, una rampa suave (nunca una pared) y al final de cada uno LA línea del
// final, de borde a borde, encima del escalón; solo la última lleva arco y cartel de META. La velocidad de cada tramo
// va pintada en el suelo (la tuya se apaga al pisarla). Bajo tus pies la cinta corre a tu velocidad real y un anillo
// late con tu pulso (del color de la zona si vas en ella). Lo ya corrido se funde con el suelo justo detrás de ti.
// Cámara propia (sin el director del núcleo): escorzo al entrar en un tramo (se ve el perfil de los escalones), primera
// persona en mitad de los tramos largos y aérea centrada el resto, alejándose en los últimos 30 s de la clase. Final:
// la cámara sube y enseña la escalera entera encendiéndose de principio a meta. Sin destellos (§15.2): los cambios son
// graduales y el brillo lo pone el bloom, dentro de sus límites.
// Materia y luz (9 nov 2026): los escalones son bloques oscuros con el filo encendido; la luz cae por sus paredes, se
// derrama en el suelo a los lados y se refleja en un suelo pulido (la misma malla del revés). El tramo nuevo se enciende
// con un frente que avanza desde su línea de salida. Cielo de noche con estrellas y bruma del color del tramo; cada
// latido suelta una onda. Plano final: corte al plano general y la escalera se levanta (×5) y se recoge hasta caber
// entera en pantalla, como el perfil de la clase en 3D, encendiéndose de la salida a la meta.
// Coste: las mismas llamadas de dibujo que antes (cuerpo, reflejo, luz del suelo, metas, cinta, suelo, cielo, horizonte,
// 4 cifras, marcador y onda), geometría fusionada con el índice del tramo por vértice. Medido en el Mac a calidad
// alta (880×1912): 1,0-1,1 ms por fotograma frente a 0,9 de la versión anterior (+2 llamadas).
// Movimiento: la escalera se levanta delante de ti al empezar (uIntroF), pulsos de luz recorren los filos de tu tramo,
// la línea del final late con la cuenta atrás 3-2-1, una onda se abre al cruzarla y en cada kilómetro, y llevas una
// estela corta. Con movimiento reducido no hay entrada, pulsos ni vaivén.

export const meta = {
  id: 'vision',
  name: 'Modo visión',
  description: 'Tu clase como una escalera de luz: cada tramo es un escalón a su velocidad, con su meta al final.',
};

const UNIT = 30;          // 1 u = 30 m: varios tramos a la vista
const W = 6;              // ancho del camino (u)
const RAMP = 0.9;         // media rampa entre tramos (u)
const INCL_X = 4;         // la cuesta se exagera ×4 (a escala real un 3 % apenas se vería)
const EFF_INCL = 0.45;    // 1 % de cuesta ≈ 0,45 km/h de esfuerzo (c ≈ 0,45·b del modelo de pulso)
const SLOTS = 4;          // cifras del suelo a la vista: tu tramo y los 3 siguientes
const BELT_FADE = 18;     // los listones de la cinta se apagan a esta distancia (sin centelleo)
const SLAT_M = 1;         // un listón por metro de cinta recorrido
const CUT_START = 0.4;    // detrás de ti, a esta distancia (u) la escalera empieza a fundirse con el suelo…
const CUT_END = 3.4;      // …y aquí ya no existe

const VERT = /* glsl */ `
attribute vec3 aCol;
attribute float aSeg;
attribute vec4 aFx;       // cara (0 arriba · 1 pared · 2 luz en el suelo), u, distancia desde la salida del tramo y hasta su final
varying vec3 vCol;
varying float vSeg;
varying float vDist;
varying float vZ;
varying float vY;
attribute float aBase;    // solo en las metas: la altura de su escalón
uniform float uRise, uGate, uSquash, uZEnd, uIntroF;
varying vec4 vFx;
void main() {
  vec3 p = position;
  // entrada: la escalera se levanta del suelo delante de ti, como una ola que se aleja (uIntroF = hasta dónde ha llegado)
  float grow = clamp((uIntroF + p.z) / 12.0, 0.0, 1.0);
  grow = grow * grow * (3.0 - 2.0 * grow);
  // plano final: la escalera se levanta y se recoge hacia la meta hasta caber entera en pantalla, como el perfil de la clase
  p.y = mix(p.y, aBase, uGate) * grow * uRise + (p.y - aBase) * uGate * grow;
  p.z = -uZEnd + (p.z + uZEnd) * uSquash;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vCol = aCol; vSeg = aSeg; vDist = length(w.xyz - cameraPosition); vZ = w.z; vY = w.y; vFx = aFx;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// estado de cada tramo (común a escalones y a su luz en el suelo): lo corrido se apaga, lo que viene espera a media luz
// y el tuyo se enciende desde su línea de salida hacia delante (un frente que avanza, nunca un destello)
const STATE = /* glsl */ `
  float segLen = vFx.z + vFx.w;
  float front = uIn * (segLen + 10.0) - 2.0;
  float lit = 1.0 - smoothstep(front - 6.0, front + 2.0, vFx.z);
  float isCur = step(uCur - 0.5, vSeg) * step(vSeg, uCur + 0.5);
  float k = vSeg < uCur - 1.5 ? 0.16 : (vSeg < uCur - 0.5 ? mix(1.0, 0.16, uIn) : (vSeg < uCur + 0.5 ? mix(0.55, 1.0, lit) : 0.55));
  if (uFront > -0.5) { k = mix(0.3, 1.0, clamp(uFront - vSeg, 0.0, 1.0)); isCur = 0.0; }
`;

// escalones y rampas: bloques oscuros con el filo encendido. Arriba, un carril algo más claro que se calienta al
// acercarse a la línea del final y bajo tus pies; en las paredes, la luz del filo cae y se apaga hacia el suelo.
// uRefl = 1: la misma malla del revés, como reflejo en el suelo pulido (se apaga con la profundidad).
const BODY_FRAG = /* glsl */ `
uniform float uCur, uIn, uFront, uFogD, uCutZ, uRefl, uYouZ, uRise, uFlow, uFlowAll, uBeat, uTick;
uniform vec3 uFogCol, uGroundCol;
varying vec3 vCol;
varying float vSeg;
varying float vDist;
varying float vZ;
varying float vY;
varying vec4 vFx;
FOG_CHUNK
void main() {
  // lo que ya has corrido se funde con el suelo justo detrás de ti: al cambiar de tramo no te queda el bloque anterior debajo
  float behind = vZ - uCutZ;
  if (behind > ${CUT_END.toFixed(1)}) discard;
  ${STATE}
  float y = abs(vY);
  float shade = 0.0;
  float emis = 0.0;
  // pulsos de luz que recorren los filos hacia la línea del final (cabeza brillante y cola corta) y un latido leve con la música
  float comet = pow(fract((vFx.z - uFlow) / 5.0), 6.0);
  float live = 1.0 + (0.85 * comet + 0.13 * uBeat) * max(isCur, uFlowAll * 0.6);
  if (vFx.x < 0.5) {
    float ax = abs(vFx.y);
    float fw = fwidth(vFx.y) + 1e-4;
    float edge = smoothstep(0.962 - fw, 0.962 + fw, ax);
    float spot = exp(-pow((-vZ - uYouZ) / 4.5, 2.0)) * isCur;
    // los últimos metros se calientan hacia la línea; en la cuenta atrás 3-2-1 laten con cada número
    shade = 0.038 + 0.026 * (1.0 - ax * ax) + 0.060 * exp(-vFx.w * 0.30) * (1.0 + 2.4 * uTick * isCur) + 0.045 * spot;
    emis = edge * (0.95 + 0.75 * isCur) * live + exp(-(1.0 - ax) * 11.0) * 0.10;
  } else {
    float dTop = max(0.0, vFx.y * uRise - y);
    float fwy = fwidth(dTop) + 1e-4;
    // al levantarse en el final, la caída de luz se alarga con la pared (sin llegar a iluminarla entera)
    shade = 0.012 + 0.085 * exp(-dTop * 1.7 / (1.0 + 0.35 * (uRise - 1.0)));
    emis = (1.0 - smoothstep(0.04, 0.04 + fwy * 1.5, dTop)) * (0.95 + 0.75 * isCur) * live;
  }
  vec3 c = vCol * (shade + emis) * k;
  if (uRefl > 0.5) c *= 0.9 * exp(-y * 0.45 / uRise);
  c = mix(c, uFogCol, fogAmount(vDist, uFogD));
  c = mix(c, uGroundCol, smoothstep(${CUT_START.toFixed(1)}, ${CUT_END.toFixed(1)}, behind));
  if (c.r != c.r || c.g != c.g || c.b != c.b) c = uGroundCol;
  gl_FragColor = vec4(c, 1.0);
}`;

// la luz de cada escalón derramada en el suelo, a sus dos lados (aditiva)
const SPILL_FRAG = /* glsl */ `
uniform float uCur, uIn, uFront, uFogD, uCutZ, uLast, uRise;
varying vec3 vCol;
varying float vSeg;
varying float vDist;
varying float vZ;
varying vec4 vFx;
FOG_CHUNK
void main() {
  float behind = vZ - uCutZ;
  if (behind > ${CUT_END.toFixed(1)}) discard;
  ${STATE}
  float u = clamp(vFx.y, 0.0, 1.0);
  float g = exp(-u * 4.2) * (1.0 - u);
  g *= mix(1.0, smoothstep(0.0, 4.0, vFx.z), step(vSeg, 0.5)) * mix(1.0, smoothstep(0.0, 4.0, vFx.w), step(uLast - 0.5, vSeg));
  vec3 c = vCol * g * 0.11 * k * (1.0 + 0.6 * isCur + 0.3 * (uRise - 1.0)) * (1.0 - fogAmount(vDist, uFogD));
  c *= 1.0 - smoothstep(${CUT_START.toFixed(1)}, ${CUT_END.toFixed(1)}, behind);
  if (c.r != c.r || c.g != c.g || c.b != c.b) c = vec3(0.0);
  gl_FragColor = vec4(c, 1.0);
}`;

// motas de luz que pasan a tu lado en primera persona (en la vista aérea no existen): dan velocidad sin ruido
const MOTE_VERT = /* glsl */ `
attribute float aRnd;
uniform float uScroll, uSize, uBaseY, uCamZ;
varying float vA;
void main() {
  float L = 46.0;
  float z = mod(position.z + uScroll * (0.6 + 0.8 * aRnd), L);
  vec4 mv = viewMatrix * vec4(position.x, uBaseY + position.y, uCamZ - z + 1.5, 1.0);
  gl_Position = projectionMatrix * mv;
  vA = smoothstep(0.0, 5.0, z) * (1.0 - smoothstep(L * 0.55, L, z)) * (0.35 + 0.65 * aRnd);
  gl_PointSize = clamp(uSize * (0.5 + aRnd) / max(1.0, -mv.z), 1.0, 9.0);
}`;
const MOTE_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uOp;
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.1, 0.5, r)) * vA * uOp;
  gl_FragColor = vec4(uCol * a, 1.0);
}`;

// cielo: noche limpia con estrellas quietas y una bruma en el horizonte que toma el color de tu tramo
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uTint;
uniform float uTime, uHaze;
varying vec3 vDir;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
// perfil de una sierra lejana alrededor de todo el horizonte (el ruido se muestrea en círculo: no tiene costura)
float ridgeAt(vec2 dir) {
  float r = 0.0;
  r += 0.030 * (1.0 - abs(2.0 * vnoise(dir * 2.3 + 7.1) - 1.0));
  r += 0.016 * (1.0 - abs(2.0 * vnoise(dir * 6.1 + 3.7) - 1.0));
  r += 0.007 * (1.0 - abs(2.0 * vnoise(dir * 15.0 + 1.3) - 1.0));
  r += 0.003 * vnoise(dir * 41.0);
  return 0.008 + r * r * 24.0 + r * 0.42;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c = mix(vec3(0.003, 0.008, 0.017), vec3(0.002, 0.0035, 0.007), smoothstep(0.0, 0.4, h));
  // la bruma se agarra al horizonte: desde la vista aérea solo se ve esa franja y tiene que caer a negro, no ser una banda lisa
  float hh = max(h, 0.0);
  c += ((uTint * 0.005 + vec3(0.003, 0.010, 0.022)) * exp(-hh * 42.0) + vec3(0.001, 0.004, 0.009) * exp(-hh * 9.0)) * uHaze;
  float sf = smoothstep(0.03, 0.22, h);
  if (sf > 0.0) {
    vec2 uv = vec2(atan(d.z, d.x) * 95.0, h * 110.0);
    vec2 cell = floor(uv);
    vec2 f = fract(uv) - 0.5;
    float r = hash21(cell);
    float r2 = hash21(cell + 17.3);
    vec2 off = (vec2(r2, fract(r2 * 7.31)) - 0.5) * 0.6;
    float star = step(0.90, r) * smoothstep(0.17, 0.04, length(f - off));
    float tw = 0.78 + 0.22 * sin(uTime * (0.8 + r2 * 1.7) + r * 40.0);
    float mag = fract(r * 13.7);
    c += vec3(0.75, 0.85, 1.0) * star * (0.08 + 0.92 * mag * mag * mag) * tw * sf * 0.6;
  }
  // sierra en silueta contra las estrellas, con el filo apenas encendido del color de tu tramo
  float ridge = ridgeAt(normalize(d.xz + vec2(1e-5)));
  float fwh = fwidth(h) + 1e-5;
  float mtn = (1.0 - smoothstep(ridge - fwh, ridge + fwh, h)) * step(0.0, h);
  vec3 rock = vec3(0.0016, 0.0032, 0.0062) + (uTint * 0.004 + vec3(0.002, 0.007, 0.015)) * exp(-hh * 30.0) * uHaze;
  c = mix(c, rock, mtn);
  c += (uTint * 0.03 + vec3(0.008, 0.026, 0.05)) * exp(-abs(h - ridge) * 520.0) * step(0.0, h) * uHaze * 0.55;
  c = mix(c, vec3(0.0025, 0.004, 0.007), smoothstep(0.0, -0.06, h));
  if (c.r != c.r || c.g != c.g || c.b != c.b) c = vec3(0.004);
  gl_FragColor = vec4(c, 1.0);
}`;

// metas (aditivas, color HDR: el bloom las enciende sin quemarlas)
const GATE_FRAG = /* glsl */ `
uniform float uCur, uCurK, uPrevK, uFront, uFogD, uCutZ;
varying vec3 vCol;
varying float vSeg;
varying float vDist;
varying float vZ;
FOG_CHUNK
void main() {
  float k = vSeg < uCur - 1.5 ? 0.04 : (vSeg < uCur - 0.5 ? uPrevK : (vSeg < uCur + 0.5 ? uCurK : 0.32));
  if (uFront > -0.5) k = vSeg < uFront ? 0.9 : 0.06;
  k *= 1.0 - smoothstep(${CUT_START.toFixed(1)}, ${CUT_END.toFixed(1)}, vZ - uCutZ);
  gl_FragColor = vec4(vCol * k * (1.0 - fogAmount(vDist, uFogD)), 1.0);
}`;

const PLANE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// la cinta de tu tramo: listones que corren a tu velocidad real, luces de borde que pasan igual y una franja tenue con
// lo que te queda (todo en un solo plano aditivo, suavizado con fwidth)
const BELT_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uLen, uBelt, uSlat, uCue, uOn, uPov;
varying vec2 vUv;
float lineAA(float ph, float w) {
  float fw = fwidth(ph) + 1e-4;
  float f = fract(ph);
  float l = 1.0 - smoothstep(w, w + fw * 1.5, f);
  return l * clamp(1.0 - fw * 2.5, 0.0, 1.0);
}
void main() {
  float s = vUv.y * uLen;                 // u desde tus pies hacia el final del tramo
  float x = (vUv.x - 0.5) * ${W.toFixed(1)};
  float ax = abs(x);
  float near = 1.0 - smoothstep(${(BELT_FADE * 0.6).toFixed(1)}, ${BELT_FADE.toFixed(1)}, s);
  float slat = lineAA(s / uSlat + uBelt, 0.09) * near * (1.0 - smoothstep(${(W / 2 - 0.3).toFixed(2)}, ${(W / 2 - 0.15).toFixed(2)}, ax));
  float fwx = fwidth(x) + 1e-4;
  float railX = 1.0 - smoothstep(0.045, 0.045 + fwx * 1.5, abs(ax - ${(W / 2 - 0.12).toFixed(2)}));
  float dph = s / (uSlat * 2.4) + uBelt / 2.4;
  float dash = (1.0 - smoothstep(0.34, 0.34 + fwidth(dph) * 1.5 + 1e-4, fract(dph))) * near;
  float strip = 1.0 - smoothstep(${(W * 0.21).toFixed(2)}, ${(W * 0.21).toFixed(2)} + fwx * 1.5, ax);
  // en primera persona los listones bajan y por el carril central corren flechas hacia el horizonte
  float cph = (s - ax * 0.55) / (uSlat * 9.0) + uBelt / 9.0;
  float chev = lineAA(cph, 0.2) * strip * near * uPov;
  vec3 c = clamp(uCol * (slat * 0.22 * uCue * (1.0 - 0.55 * uPov) + railX * dash * 0.7 + strip * 0.09 + chev * 0.2) * uOn * smoothstep(0.0, 1.6, s), 0.0, 2.0);
  if (c.r != c.r || c.g != c.g || c.b != c.b) c = vec3(0.0);
  gl_FragColor = vec4(c, 1.0);
}`;

// suelo infinito con una rejilla fina que se pierde a lo lejos
const GROUND_FRAG = /* glsl */ `
uniform vec3 uCol, uLine, uFogCol;
uniform float uFogD, uGloss;
varying vec3 vW;
FOG_CHUNK
void main() {
  vec2 p = vW.xz / 5.0;
  vec2 fw = fwidth(p);
  float d = length(vW.xz - cameraPosition.xz);
  float l = 0.0;
  // a ras de horizonte las derivadas se disparan (y un NaN aquí apagaba el bloom de toda la pantalla): la rejilla
  // solo de cerca y con las derivadas saneadas
  if (d < 440.0 && fw.x == fw.x && fw.y == fw.y && fw.x < 1e3 && fw.y < 1e3) {
    vec2 g = abs(fract(p - 0.5) - 0.5) / max(fw, vec2(1e-4));
    l = 1.0 - min(min(g.x, g.y), 1.0);
  }
  float f = (1.0 - smoothstep(40.0, 420.0, d)) * 0.42;
  vec3 c = mix(uCol, uLine, l * f);
  c = clamp(mix(c, uFogCol, fogAmount(d, uFogD) * 0.85), 0.0, 1.0);
  if (c.r != c.r || c.g != c.g || c.b != c.b) c = uFogCol;
  // suelo pulido: de cerca deja ver el reflejo de la escalera (más en el plano final)
  gl_FragColor = vec4(c, mix(mix(0.6, 0.42, uGloss), 1.0, smoothstep(20.0 + 40.0 * uGloss, 150.0 + 150.0 * uGloss, d)));
}`;

export async function createTheme(ctx) {
  const { THREE, root, rig, post, camera, scene, util } = ctx;
  const { clamp, clamp01 } = util;
  const tl = ctx.timeline;
  const C = (hex) => new THREE.Color(hex);
  const lin = (k) => Math.pow(k, 2.2);      // un factor de brillo pensado en sRGB, en lineal
  const WHITE = C('#ffffff');

  camera.near = 0.3;
  camera.far = 2600;
  camera.updateProjectionMatrix();
  post.set({ toneMapping: 'agx', exposure: 1, bloomStrength: 0.5, bloomThreshold: 0.88, bloomRadius: 0.35, vignette: 0.3, saturation: 1.05 });

  // cielo: cúpula que sigue a la cámara (estrellas y bruma del color del tramo); el fondo liso queda de respaldo
  scene.background = C('#03060a');
  const skyU = { uTint: { value: new THREE.Color(0.1, 0.3, 0.5) }, uTime: { value: 0 }, uHaze: { value: 1 } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), new THREE.ShaderMaterial({
    uniforms: skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
  }));
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  root.add(sky);
  const FOG_COL = C('#0a1724');
  const FOG_D = 0.0022;
  scene.fog = new THREE.FogExp2(FOG_COL.clone(), FOG_D);
  const FOG = ctx.shaders.FOG;
  const shader = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({
    uniforms, vertexShader: extra.vert || VERT, fragmentShader: frag.replace('FOG_CHUNK', FOG), ...extra.opts,
  });

  const bodyU = { uCur: { value: 0 }, uIn: { value: 1 }, uFront: { value: -1 }, uFogD: { value: FOG_D }, uFogCol: { value: FOG_COL }, uCutZ: { value: 1e6 }, uGroundCol: { value: C('#05090f') }, uRefl: { value: 0 }, uYouZ: { value: 0 }, uRise: { value: 1 }, uGate: { value: 0 }, uLast: { value: 0 }, uSquash: { value: 1 }, uZEnd: { value: 1 }, uIntroF: { value: 1e6 }, uFlow: { value: 0 }, uFlowAll: { value: 0 }, uBeat: { value: 0 }, uTick: { value: 0 } };
  const bodyMat = shader(BODY_FRAG, bodyU, { opts: { side: THREE.DoubleSide } });
  const reflMat = shader(BODY_FRAG, { ...bodyU, uRefl: { value: 1 } }, { opts: { side: THREE.DoubleSide } });
  const spillMat = shader(SPILL_FRAG, bodyU, { opts: { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } });
  const gateU = { uCur: bodyU.uCur, uFront: bodyU.uFront, uCurK: { value: 1 }, uPrevK: { value: 0.1 }, uFogD: bodyU.uFogD, uCutZ: bodyU.uCutZ, uRise: bodyU.uRise, uGate: { value: 1 }, uSquash: bodyU.uSquash, uZEnd: bodyU.uZEnd, uIntroF: bodyU.uIntroF };
  const gateMat = shader(GATE_FRAG, gateU, { opts: { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } });

  // suelo y horizonte
  const groundU = { uCol: { value: C('#05090f') }, uLine: { value: C('#1a2a38') }, uFogCol: { value: FOG_COL }, uFogD: { value: FOG_D }, uGloss: { value: 0 } };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), shader(GROUND_FRAG, groundU, { vert: PLANE_VERT, opts: { transparent: true } }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  ground.renderOrder = -5;
  ground.frustumCulled = false;
  root.add(ground);
  const hzMat = new THREE.MeshBasicMaterial({ color: C('#5fa8d8'), transparent: true, opacity: 0.55, fog: false, blending: THREE.AdditiveBlending, depthWrite: false });
  const hzLine = new THREE.Mesh(new THREE.PlaneGeometry(9000, 1.8), hzMat);
  hzLine.frustumCulled = false;
  root.add(hzLine);
  // la cinta de tu tramo
  const beltU = { uCol: { value: new THREE.Color() }, uLen: { value: 1 }, uBelt: { value: 0 }, uSlat: { value: 0.42 }, uCue: { value: 1 }, uOn: { value: 1 }, uPov: { value: 0 } };
  const beltMat = shader(BELT_FRAG, beltU, { vert: PLANE_VERT, opts: { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 } });
  const beltGeo = new THREE.PlaneGeometry(1, 1);
  beltGeo.translate(0, 0.5, 0);           // y local 0 = tus pies, 1 = final del tramo
  const belt = new THREE.Mesh(beltGeo, beltMat);
  belt.renderOrder = 11;
  belt.frustumCulled = false;
  root.add(belt);

  // tú: un chevrón de luz y el anillo de tu latido
  const chev = new THREE.Shape();
  chev.moveTo(0, 0.6); chev.lineTo(0.45, -0.3); chev.lineTo(0, -0.05); chev.lineTo(-0.45, -0.3); chev.lineTo(0, 0.6);
  const youMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 1.0, 1.0), transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, depthTest: false, fog: false });   // nunca queda tapado por una rampa
  const you = new THREE.Mesh(new THREE.ShapeGeometry(chev), youMat);
  you.rotation.x = -Math.PI / 2;
  you.renderOrder = 30;
  root.add(you);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false });
  const ring =new THREE.Mesh(new THREE.RingGeometry(0.62, 0.7, 64), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 30;
  root.add(ring);
  // motas en primera persona: una sola llamada, colocadas y envueltas en el shader
  const moteU = { uScroll: { value: 0 }, uSize: { value: 60 }, uBaseY: { value: 0 }, uCamZ: { value: 0 }, uCol: { value: new THREE.Color() }, uOp: { value: 0 } };
  const moteGeo = new THREE.BufferGeometry();
  {
    const MP = [], MR = [];
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < 110; k++) {
      const side = rnd() < 0.5 ? -1 : 1;
      MP.push(side * (3.6 + rnd() * 9), 0.2 + rnd() * rnd() * 7, rnd() * 46);   // fuera del camino, más densas cerca del suelo
      MR.push(rnd());
    }
    moteGeo.setAttribute('position', new THREE.Float32BufferAttribute(MP, 3));
    moteGeo.setAttribute('aRnd', new THREE.Float32BufferAttribute(MR, 1));
  }
  const motes = new THREE.Points(moteGeo, new THREE.ShaderMaterial({ uniforms: moteU, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  motes.frustumCulled = false;
  motes.renderOrder = 20;
  motes.visible = false;
  root.add(motes);
  // tu estela: una cola corta de luz que se pierde justo donde lo corrido se funde con el suelo
  const trailTex = (() => {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 64;
    const g = c.getContext('2d');
    const img = g.createImageData(32, 64);
    for (let yy = 0; yy < 64; yy++) for (let xx = 0; xx < 32; xx++) {
      const u = Math.abs((xx + 0.5) / 32 - 0.5) * 2, v = (yy + 0.5) / 64;   // v = 0 pegado a ti
      const a = Math.pow(1 - v, 1.8) * Math.pow(Math.max(0, 1 - u * (1 + v * 1.4)), 1.5);
      const o = (yy * 32 + xx) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = Math.round(255 * a);
    }
    g.putImageData(img, 0, 0);
    const tx = new THREE.CanvasTexture(c);
    tx.flipY = false;
    return tx;
  })();
  const trailMat = new THREE.MeshBasicMaterial({ map: trailTex, color: new THREE.Color(), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false });
  const trailGeo = new THREE.PlaneGeometry(0.85, 1.7);
  trailGeo.translate(0, -0.85, 0);            // y local 0 = tus pies; se extiende hacia atrás
  const trail = new THREE.Mesh(trailGeo, trailMat);
  trail.rotation.x = -Math.PI / 2;
  trail.renderOrder = 28;
  root.add(trail);
  // al cruzar una línea (y en cada kilómetro) una onda de luz se abre por el suelo y se apaga: gradual, sin destello
  const pulseMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false });
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.955, 1, 96), pulseMat);
  pulse.rotation.x = -Math.PI / 2;
  pulse.renderOrder = 27;
  pulse.visible = false;
  root.add(pulse);
  // cada latido suelta una onda que se abre y se apaga
  const waveMat = ringMat.clone();
  const wave = new THREE.Mesh(new THREE.RingGeometry(0.66, 0.7, 64), waveMat);
  wave.rotation.x = -Math.PI / 2;
  wave.renderOrder = 29;
  root.add(wave);

  // cifras del suelo (tu tramo y los tres siguientes)
  const slots = [];
  for (let k = 0; k < SLOTS; k++) {
    const p = ctx.textPlane(' ', { size: 150, weight: 700, caps: false, tracking: -0.02, height: 1.5, intensity: 1, pad: 0.15 });
    p.material.polygonOffset = true; p.material.polygonOffsetFactor = -2; p.material.polygonOffsetUnits = -4;
    p.renderOrder = 12;
    p.visible = false;
    p.userData.seg = -1;
    root.add(p);
    slots.push(p);
  }
  // META sobre la última meta
  const metaPlane = ctx.textPlane('META', { size: 110, weight: 700, tracking: 0.14, height: 0.95, intensity: 1.6, pad: 0.3, plate: { color: 'rgba(255,255,255,0.06)', radius: 0.15, border: 'rgba(255,255,255,0.2)' } });
  metaPlane.renderOrder = 60;
  root.add(metaPlane);
  const checkTex = (() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 16;
    const g = c.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.1)';
      g.fillRect(i * 8, j * 8, 8, 8);
    }
    return new THREE.CanvasTexture(c);
  })();
  const checkMat = new THREE.MeshBasicMaterial({ map: checkTex, color: new THREE.Color(), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const check = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.55), checkMat);
  check.rotation.x = -Math.PI / 2;
  check.renderOrder = 14;
  root.add(check);

  // ── el mundo de la clase (se reconstruye si cambian las velocidades) ──
  let segs = [];
  let lastI = 0;
  let zEnd = 1;
  let topMax = 1;
  const built = [];       // mallas fusionadas (se liberan al reconstruir)
  let reflMesh = null;

  function readSegs() {
    const n = tl.segCount;
    const src = Array.isArray(ctx.workout?.segments) ? ctx.workout.segments : [];
    const out = [];
    let z = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0.5, tl.segSpeed(i));
      const sec = tl.segDuration(i);
      const incl = clamp(Number(src[i]?.incline) || 0, 0, 15);
      const len = (v * sec / 3.6) / UNIT;
      out.push({ i, zone: tl.segZone(i), v, sec, incl, len, z0: z, z1: z + len, t0: tl.segStart(i), t1: tl.segEnd(i) });
      z += len;
    }
    return out;
  }

  function build() {
    for (const m of built) { m.geometry.dispose(); root.remove(m); }
    built.length = 0;
    if (reflMesh) { root.remove(reflMesh); reflMesh = null; }
    segs = readSegs();
    lastI = segs.length - 1;
    bodyU.uLast.value = lastI;
    if (!segs.length) return;
    const eff = (s) => s.v + s.incl * EFF_INCL;
    const effMin = Math.min(...segs.map(eff));
    const effMax = Math.max(...segs.map(eff));
    // 1 u por km/h, pero la escalera entera nunca pasa de ~4 u (un sprint no puede ser un muro delante de la cámara)
    const hk = Math.min(1, 4 / Math.max(1e-6, effMax - effMin));
    for (const s of segs) {
      s.h = 0.6 + (eff(s) - effMin) * hk;
      s.zA = s.i > 0 ? s.z0 + 2 * RAMP : s.z0;
      s.zB = s.z1;
      const rise = Math.max(0, s.zB - s.zA) * (s.incl / 100) * INCL_X;
      s.h0 = s.h - rise / 2;
      s.h1 = s.h + rise / 2;
      s.col = ctx.zoneColor(s.zone).clone();
    }
    zEnd = segs[lastI].z1;
    bodyU.uZEnd.value = zEnd;
    topMax = Math.max(...segs.map((s) => s.h1));

    // cuerpo: escalones (cara de arriba en cuesta, paredes) y rampas curvas entre ellos. Cada vértice lleva su tipo de
    // cara y sus distancias dentro del tramo: con eso el shader pinta el filo, la caída de luz y el frente que lo enciende.
    const P = [], CO = [], SG = [], FX = [], IX = [];
    const SP = [], SC = [], SS = [], SF = [], SI = [];       // luz en el suelo, a los lados
    const SPILL = 5.5;
    const push = (PP, CC, GG, FF, II, pts, col, seg, face, us) => {
      const o = PP.length / 3;
      const g = segs[seg];
      for (let k = 0; k < 4; k++) {
        const q = pts[k];
        PP.push(q[0], q[1], q[2]);
        CC.push(col.r, col.g, col.b);
        GG.push(seg);
        FF.push(face, us[k], -q[2] - g.z0, g.z1 + q[2]);
      }
      II.push(o, o + 1, o + 2, o, o + 2, o + 3);
    };
    const top = (y0, z0, y1, z1, col, seg) => push(P, CO, SG, FX, IX, [[-W / 2, y0, z0], [W / 2, y0, z0], [W / 2, y1, z1], [-W / 2, y1, z1]], col, seg, 0, [-1, 1, 1, -1]);
    const walls = (y0, z0, y1, z1, col, seg) => {
      push(P, CO, SG, FX, IX, [[-W / 2, 0, z0], [-W / 2, y0, z0], [-W / 2, y1, z1], [-W / 2, 0, z1]], col, seg, 1, [y0, y0, y1, y1]);
      push(P, CO, SG, FX, IX, [[W / 2, 0, z1], [W / 2, y1, z1], [W / 2, y0, z0], [W / 2, 0, z0]], col, seg, 1, [y1, y1, y0, y0]);
      for (const sx of [-1, 1]) {
        const a = sx * W / 2, b = sx * (W / 2 + SPILL);
        push(SP, SC, SS, SF, SI, [[a, 0.004, z0], [b, 0.004, z0], [b, 0.004, z1], [a, 0.004, z1]], col, seg, 2, [0, 1, 1, 0]);
      }
    };
    const cap = (y, z, col, seg) => push(P, CO, SG, FX, IX, [[-W / 2, 0, z], [W / 2, 0, z], [W / 2, y, z], [-W / 2, y, z]], col, seg, 1, [y, y, y, y]);
    for (const s of segs) {
      top(s.h0, -s.zA, s.h1, -s.zB, s.col, s.i);
      walls(s.h0, -s.zA, s.h1, -s.zB, s.col, s.i);
      if (s.i === 0) cap(s.h0, -s.zA, s.col, s.i);
      if (s.i === lastI) cap(s.h1, -s.zB, s.col, s.i);
    }
    const N = 14;
    const smooth = (x) => x * x * (3 - 2 * x);
    const ca = new THREE.Color(), cc = new THREE.Color();
    for (let k = 0; k < lastI; k++) {
      const a = segs[k], b = segs[k + 1];
      const zS = a.zB, zE = b.zA;
      const yAt = (u) => a.h1 + (b.h0 - a.h1) * smooth(u);
      for (let j = 0; j < N; j++) {
        const u0 = j / N, u1 = (j + 1) / N;
        const z0 = -(zS + (zE - zS) * u0), z1 = -(zS + (zE - zS) * u1);
        ca.copy(a.col).lerp(b.col, (u0 + u1) / 2);
        top(yAt(u0), z0, yAt(u1), z1, ca, b.i);
        walls(yAt(u0), z0, yAt(u1), z1, ca, b.i);
      }
    }
    const geoOf = (PP, CC, GG, FF, II) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(PP, 3));
      g.setAttribute('aCol', new THREE.Float32BufferAttribute(CC, 3));
      g.setAttribute('aSeg', new THREE.Float32BufferAttribute(GG, 1));
      g.setAttribute('aFx', new THREE.Float32BufferAttribute(FF, 4));
      g.setIndex(II);
      return g;
    };
    const bodyGeo = geoOf(P, CO, SG, FX, IX);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.frustumCulled = false;
    root.add(body);
    built.push(body);
    // el reflejo: la misma malla del revés bajo el suelo pulido (comparte geometría: solo se libera una vez)
    const refl = new THREE.Mesh(bodyGeo, reflMat);
    refl.scale.y = -1;
    refl.position.y = -0.06;
    refl.frustumCulled = false;
    root.add(refl);
    reflMesh = refl;
    const spill = new THREE.Mesh(geoOf(SP, SC, SS, SF, SI), spillMat);
    spill.frustumCulled = false;
    spill.renderOrder = -3;
    root.add(spill);
    built.push(spill);

    // metas: postes, travesaño por encima del más alto de los dos tramos y la línea del final encima del escalón
    const GP = [], GC = [], GS = [], GI = [], GB = [];
    const box = (cx, cy, cz, sx, sy, sz, col, seg) => {
      const o = GP.length / 3;
      const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
      const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      for (const p of v) { GP.push(...p); GC.push(col.r, col.g, col.b); GS.push(seg); GB.push(segs[seg].h1); }
      const f = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
      for (const [a, b, c, d] of f) GI.push(o + a, o + b, o + c, o + a, o + c, o + d);
    };
    for (const s of segs) {
      const nx = segs[s.i + 1];
      const baseY = s.h1;
      const topY = Math.max(s.h1, nx ? nx.h0 : s.h1) + (s.i === lastI ? 2.6 : 1.4);
      const GH = topY - baseY;
      const ze = -s.z1;
      const glow = cc.copy(s.col).multiplyScalar(1.5);
      // solo la última lleva arco: una meta en cada tramo eran recuadros unos dentro de otros detrás de la velocidad
      if (s.i === lastI) {
        box(-W / 2, baseY + GH / 2, ze, 0.2, GH, 0.2, glow, s.i);
        box(W / 2, baseY + GH / 2, ze, 0.2, GH, 0.2, glow, s.i);
        box(0, topY, ze, W + 0.2, 0.22, 0.22, glow, s.i);
        // velo de luz bajo el travesaño, que se apaga antes de llegar al suelo
        const o = GP.length / 3;
        const veil = [[-W / 2, topY, 0.11], [W / 2, topY, 0.11], [W / 2, baseY + GH * 0.25, 0], [-W / 2, baseY + GH * 0.25, 0]];
        for (const [x, y, kk] of veil) { GP.push(x, y, ze); GC.push(s.col.r * kk, s.col.g * kk, s.col.b * kk); GS.push(s.i); GB.push(s.h1); }
        GI.push(o, o + 1, o + 2, o, o + 2, o + 3, o, o + 2, o + 1, o, o + 3, o + 2);
      }
      const endC = ca.copy(s.col).lerp(WHITE, 0.2).multiplyScalar(1.15);
      box(0, s.h1 + 0.03, ze + 0.15, W - 0.02, 0.05, 0.26, endC, s.i);
      s.gateTop = topY;
    }
    const gateGeo = new THREE.BufferGeometry();
    gateGeo.setAttribute('position', new THREE.Float32BufferAttribute(GP, 3));
    gateGeo.setAttribute('aCol', new THREE.Float32BufferAttribute(GC, 3));
    gateGeo.setAttribute('aSeg', new THREE.Float32BufferAttribute(GS, 1));
    gateGeo.setAttribute('aBase', new THREE.Float32BufferAttribute(GB, 1));
    gateGeo.setIndex(GI);
    const gates = new THREE.Mesh(gateGeo, gateMat);
    gates.frustumCulled = false;
    gates.renderOrder = 40;
    root.add(gates);
    built.push(gates);

    // META y cuadros en la última
    const L = segs[lastI];
    metaPlane.position.set(0, L.gateTop - 0.75, -L.z1 + 0.02);
    metaPlane.material.color.copy(L.col).lerp(WHITE, 0.5).multiplyScalar(1.6);
    check.position.set(0, L.h1 + 0.025, -L.z1 + 0.75);
    checkMat.color.copy(L.col).lerp(WHITE, 0.3).multiplyScalar(1.4);

    // horizonte más allá del final de la clase
    const HZ = -Math.max(1400, zEnd + 500);
    hzLine.position.set(0, 0.9, HZ);
    camera.far = -HZ + 800;
    camera.updateProjectionMatrix();
    for (const p of slots) p.userData.seg = -1;
  }
  build();

  const segAt = (t) => {
    for (const s of segs) if (t < s.t1) return s;
    return segs[lastI];
  };
  const distAt = (t) => {
    const s = segAt(t);
    return s.z0 + (clamp(t, s.t0, s.t1) - s.t0) * (s.v / 3.6) / UNIT;
  };
  const smooth = (x) => x * x * (3 - 2 * x);
  function groundAt(z) {
    let k = 0;
    while (k < lastI && z >= segs[k].z1) k++;
    const g = segs[k];
    if (k > 0 && z < g.z0 + 2 * RAMP) {
      const u = smooth(clamp01((z - g.z0) / (2 * RAMP)));
      return segs[k - 1].h1 + (g.h0 - segs[k - 1].h1) * u;
    }
    return g.h0 + (g.h1 - g.h0) * clamp01((z - g.zA) / Math.max(1e-6, g.zB - g.zA));
  }
  const topAt = (s, z) => s.h0 + (s.h1 - s.h0) * clamp01((z - s.zA) / Math.max(1e-6, s.zB - s.zA));
  const fmtSp = (s) => `${ctx.fmtSpeed(s.v)}${s.incl ? ` · ${String(s.incl).replace('.', ',')} %` : ''}`;

  function placeSlot(p, s, op) {
    if (!s) { p.visible = false; return; }
    if (p.userData.seg !== s.i) {
      p.userData.seg = s.i;
      p.userData.setText(fmtSp(s));
      const h = s.incl ? 1.15 : 1.5;
      p.scale.multiplyScalar(h / p.scale.y);
      p.material.color.copy(s.col).lerp(WHITE, 0.6);
      const zN = Math.min(s.zA + 1.6 + h / 2, (s.zA + s.zB) / 2);
      p.userData.zN = zN;
      p.rotation.set(-Math.PI / 2 + Math.atan2(s.h1 - s.h0, Math.max(1e-6, s.zB - s.zA)), 0, 0);
      p.position.set(0, topAt(s, zN) + 0.02, -zN);
    }
    p.material.opacity = op;
    p.visible = op > 0.01;
  }

  // ── estado ──
  let camMix = 0, sideMix = 0, endMix = 0;
  let camSpan = null;
  let beltPos = 0;
  let beat = 0;
  let hr = null;            // { bpm, min, max, st } desde el reproductor
  let rebuildAt = -1;
  let portrait = true;
  let curIdx = -1;
  let wasFinale = false;
  let flow = 0, tick = 0, pulseT = -1, finClock = 0, moteScroll = 0;
  const pulseCol = new THREE.Color();
  const skyTint = new THREE.Color(0.1, 0.3, 0.5);
  const ringCol = new THREE.Color();
  const tmpC = new THREE.Color();
  const hzBase = C('#5fa8d8');
  const anchor = new THREE.Vector3();
  const dbg = {};
  const rectOf = (kind) => { for (const r of ctx.hud.rects || []) if (r.kind === kind) return r; return null; };

  const inst = {
    director: false,
    get _debug() { return { ...dbg, cur: curIdx, segs: segs.length, zEnd }; },
    resize({ aspect }) { portrait = aspect < 0.9; },

    update(f) {
      if (!segs.length) return;
      if (rebuildAt >= 0 && f.time >= rebuildAt) { rebuildAt = -1; build(); }
      const dt = clamp(f.dt, 0, 0.1);
      const t = clamp(f.t, 0, tl.totalSec);
      const s = segAt(Math.min(t, tl.totalSec - 1e-3));
      const d = distAt(t);
      const leftT = Math.max(0, s.t1 - t);
      const inBlock = t - s.t0;
      const classLeft = Math.max(0, tl.totalSec - t);
      const finale = f.finale > 0;
      bodyU.uIn.value += (1 - bodyU.uIn.value) * Math.min(1, dt * 1.6);
      if (s.i !== curIdx) {
        bodyU.uIn.value = curIdx < 0 || s.i !== curIdx + 1 ? 1 : 0;   // al arrancar o al saltar en el tiempo, sin relevo
        curIdx = s.i;
        bodyU.uCur.value = s.i;
        hzMat.color.copy(hzBase).lerp(s.col, 0.5);
        skyTint.copy(s.col);
      }
      // el cielo acompaña: sigue a la cámara y su bruma toma, poco a poco, el color de tu tramo
      sky.position.copy(rig.current.position);
      skyU.uTint.value.lerp(skyTint, Math.min(1, dt * 0.8));
      skyU.uTime.value = f.reducedMotion ? 0 : f.time % 3600;
      bodyU.uYouZ.value = d;
      // entrada (primeros 2,6 s): la escalera se levanta delante de ti; con movimiento reducido ya está en pie
      const intro = f.reducedMotion || !(f.intro < 1) ? 1 : clamp01(f.intro);
      bodyU.uIntroF.value = intro >= 1 ? 1e6 : d + 14 + 190 * Math.pow(intro, 1.6);
      const introK = smooth(clamp01((intro - 0.35) / 0.5));
      if ((f.running || f.finale > 0) && !f.reducedMotion) flow += dt * (1.5 + 0.07 * s.v);
      bodyU.uFlow.value = flow % 1000;
      bodyU.uBeat.value = f.reducedMotion ? 0 : clamp01(Number(f.beat) || 0);
      tick = Math.max(0, tick - dt * 2.6);
      bodyU.uTick.value = smooth(tick);

      // ── cámara ──
      const remU = Math.max(0, s.z1 - d);
      const span = Math.min(remU, 60);
      camSpan = camSpan == null ? span : camSpan + (span - camSpan) * Math.min(1, dt * 1.5);
      endMix = clamp01(endMix + ((classLeft <= 30 ? 1 : 0) - endMix) * Math.min(1, dt * 0.8));
      const em = smooth(endMix);
      const back = 8 + camSpan * 0.1 + 10 * em;
      const gYou = groundAt(d);
      // por encima de lo que pisas y del escalón que viene (siempre se ve por encima de él); lo de atrás ya no existe
      const nxs = segs[s.i + 1];
      const upNext = nxs ? Math.max(0, nxs.h0 - gYou) * (1 - smooth(clamp01((remU - 4) / 30))) : 0;
      const camY = Math.max(gYou, groundAt(Math.max(0, d - CUT_START))) + 5.2 + camSpan * 0.14 + 6 * em + upNext * 1.2;
      const still = f.reducedMotion;
      const wantPov = !still && !em && s.sec >= 180 && inBlock > 25 && leftT > 30;
      const wantSide = !still && inBlock <= 6 + (s.sec < 90 ? 14 : 0) && leftT > 20;
      camMix = clamp01(camMix + ((wantPov ? 1 : 0) - camMix) * Math.min(1, dt * 1.1));
      sideMix = clamp01(sideMix + ((wantSide ? 1 : 0) - sideMix) * Math.min(1, dt * 0.9));
      const m = smooth(camMix), sm = smooth(sideMix);
      const T = rig.target;
      // en el final la escalera se levanta como un perfil de la clase (×5) para que se lea de un vistazo
      const fp = finale ? (still ? 1 : clamp01(f.finale)) : 0;
      const grow = smooth(clamp01((fp - 0.04) / 0.5));
      const rise = 1 + 4 * grow;
      const Ls = Math.min(zEnd, 70);            // largo de la escalera ya recogida
      bodyU.uRise.value = rise;
      bodyU.uSquash.value = 1 + (Ls / zEnd - 1) * grow;
      groundU.uGloss.value = grow;
      skyU.uHaze.value = 0.25 + 0.75 * Math.max(m, grow);   // desde la vista aérea la bruma era una banda lisa arriba: allí, casi nada
      bodyU.uFlowAll.value = finale ? smooth(clamp01((fp - 0.75) / 0.25)) : 0;
      if (finale) {
        // corte al plano general: desde detrás de la meta y a un lado, con la clase entera delante (la meta cerca, la
        // salida al fondo). Se enciende de la salida hacia ti mientras la cámara se acerca despacio.
        const p = smooth(fp);
        const k = (Ls / 70) * (portrait ? 1 : 0.8);
        rig.settle.position = 0.6; rig.settle.lookAt = 0.6;
        T.position.set((-36 + 3 * p) * k, topMax * 5 * 0.5 + 9 - 1.5 * p, -zEnd - (30 - 3.5 * p) * k);
        T.lookAt.set(0, topMax * 5 * (portrait ? 0.3 : 0.12), -zEnd + Ls * (portrait ? 0.31 : 0.4));
        T.fov = portrait ? 74 : 50;
        // con el plano ya asentado, un vaivén muy lento: la pantalla de «clase terminada» no se queda en una foto fija
        finClock = wasFinale ? finClock + dt : 0;
        if (!still) {
          const sway = smooth(clamp01((finClock - 3.2) / 3));
          // solo hacia fuera (más de perfil): hacia dentro la meta se salía del encuadre
          T.position.x -= sway * 2.6 * k * (1 - Math.cos((finClock - 3.2) * 0.24)) / 2;
          T.position.y += sway * 0.9 * Math.sin((finClock - 3.2) * 0.16);
        }
        if (!wasFinale) rig.snap();
      } else {
        rig.settle.position = 0.5; rig.settle.lookAt = 0.5;
        const ax = -4.5 * sm, ay = camY + 1.5 * sm, az = -d + back, tx = 1.2 * sm, ty = gYou - 1.5, tz = -d - 70 + 30 * sm;
        const px = 0, py = gYou + 0.85, pz = -d + 0.5, qx = 0, qy = gYou + 0.38, qz = -d - 12;
        const mix = (a, b) => a + (b - a) * m;
        T.position.set(mix(ax, px), mix(ay, py), mix(az, pz));
        T.lookAt.set(mix(tx, qx), mix(ty, qy), mix(tz, qz));
        T.fov = portrait ? 66 : 50;
      }
      // encuadre por composición: tu marcador (o el suelo justo delante, en primera persona) cae al fondo del hueco libre
      // entre la velocidad y el panel de abajo; el desplazamiento de lente lo coloca sin girar la cámara
      wasFinale = finale;
      if (finale) T.shift.set(0, 0);
      else {
        const hud = ctx.hud;
        let yFrac = portrait ? 0.64 : 0.72;
        const H = Math.max(1, hud.height || 1);
        if (hud.band && hud.band.h > 40) yFrac = (hud.band.y + hud.band.h * 0.78) / H;
        else {
          const lt = rectOf('segment');
          if (lt) yFrac = lt.y / H - 0.04;
        }
        yFrac = clamp(yFrac, 0.45, 0.86);
        dbg.yFrac = yFrac; dbg.band = hud.band;
        anchor.set(0, gYou + 0.05, -d - 5 * m).project(camera);
        if (Number.isFinite(anchor.y) && anchor.z < 1) {
          const ndc0 = anchor.y - rig.current.shift.y;
          const ndcX0 = anchor.x - rig.current.shift.x;   // en escorzo, tu marcador sigue centrado
          T.shift.set(clamp(-ndcX0 * sm, -0.6, 0.6), clamp(1 - 2 * yFrac - ndc0, -0.3, 0.9));
          dbg.ndc = anchor.y; dbg.shift = T.shift.y;
        }
      }

      // ── tu marcador y tu latido ──
      you.position.set(0, gYou + 0.05, -d);
      // el marcador se inclina con la rampa: plano, su punta se metía dentro de la cuesta
      const slopeA = Math.atan2(groundAt(d + 0.35) - groundAt(Math.max(0, d - 0.35)), 0.7);
      you.rotation.x = -Math.PI / 2 + slopeA;
      ring.rotation.x = -Math.PI / 2 + slopeA;
      youMat.opacity = 0.95 * (1 - m) * (finale ? 0 : 1);
      ring.position.set(0, gYou + 0.04, -d - 0.05);
      const inZone = hr && hr.bpm > 0 && hr.min > 0 ? hr.bpm >= hr.min && hr.bpm <= hr.max : true;
      if (hr && hr.bpm > 0 && f.running) beat += (dt * hr.bpm) / 60;
      const env = hr && hr.bpm > 0 && !still ? Math.exp(-((beat % 1) * 6)) : 0;
      ring.scale.setScalar(1 + 0.12 * (1 - env));
      tmpC.copy(inZone ? s.col : WHITE);
      ringCol.lerp(tmpC, Math.min(1, dt * 3));
      ringMat.color.copy(ringCol).multiplyScalar(0.9);
      ringMat.opacity = (0.35 + 0.2 * env) * (1 - m) * (finale ? 0 : 1);
      // motas: solo en primera persona y en marcha; a la velocidad con la que pasa el suelo
      if (f.running && !still) moteScroll += dt * (0.25 + 0.045 * s.v);
      moteU.uScroll.value = moteScroll % 4600;
      moteU.uBaseY.value = gYou;
      moteU.uCamZ.value = -d;
      moteU.uSize.value = 46 * (f.dpr || 1);
      moteU.uCol.value.copy(s.col).lerp(WHITE, 0.55);
      moteU.uOp.value = 0.5 * m * (finale ? 0 : 1) * (still ? 0 : 1);
      motes.visible = moteU.uOp.value > 0.01;
      trail.position.set(0, gYou + 0.045, -d + 0.25);
      trail.rotation.x = -Math.PI / 2 + slopeA;
      trailMat.color.copy(s.col).lerp(WHITE, 0.35);
      trailMat.opacity = 0.3 * (1 - m) * (finale ? 0 : 1) * introK * (f.running ? 1 : 0.5);
      trail.visible = trailMat.opacity > 0.01;
      if (pulseT >= 0) {
        pulseT += dt / 1.7;
        const e = 1 - Math.pow(1 - Math.min(1, pulseT), 3);
        pulse.position.set(0, gYou + 0.035, -d);
        pulse.rotation.x = -Math.PI / 2 + slopeA;
        pulse.scale.setScalar(1 + 11 * e);
        pulseMat.color.copy(pulseCol);
        pulseMat.opacity = 0.55 * Math.pow(1 - Math.min(1, pulseT), 1.8) * (1 - m) * (finale ? 0 : 1);
        if (pulseT >= 1) pulseT = -1;
      }
      pulse.visible = pulseT >= 0 && pulseMat.opacity > 0.01;
      const ph = hr && hr.bpm > 0 && !still ? beat % 1 : 1;
      wave.position.copy(ring.position);
      wave.rotation.x = ring.rotation.x;
      wave.scale.setScalar(1 + 1.9 * (1 - Math.pow(1 - ph, 2.2)));
      waveMat.color.copy(ringMat.color);
      waveMat.opacity = 0.34 * Math.pow(1 - ph, 1.6) * (1 - m) * (finale ? 0 : 1);
      wave.visible = waveMat.opacity > 0.01;

      // ── cinta ──
      if (f.running) beltPos += (s.v / 3.6) * dt / SLAT_M;
      const bStart = Math.max(s.zA, d - 1.6);
      const bLen = Math.max(0.01, s.zB - bStart);
      const ang = Math.atan2(s.h1 - s.h0, Math.max(1e-6, s.zB - s.zA));
      belt.visible = d < s.zB - 0.05 && !finale;
      belt.position.set(0, topAt(s, bStart) + 0.016, -bStart);
      belt.rotation.set(-Math.PI / 2 + ang, 0, 0);
      belt.scale.set(W * 0.96, bLen / Math.cos(ang), 1);
      beltU.uLen.value = bLen;
      beltU.uBelt.value = beltPos % 1000;
      beltU.uSlat.value = 0.42 + (0.13 - 0.42) * m;
      beltU.uPov.value = m;
      beltU.uCue.value = ctx.speedFeel ? ctx.speedFeel.cue : 1;
      beltU.uCol.value.copy(s.col).lerp(WHITE, 0.3);
      beltU.uOn.value = bodyU.uIn.value * introK;      // la cinta del tramo nuevo entra fundida, no de golpe

      // ── cifras del suelo: la tuya se apaga al llegar a ella; las dos siguientes claras; la tercera, apenas ──
      const speedRect = rectOf('speed');
      for (let k = 0; k < SLOTS; k++) {
        const g = segs[s.i + k];
        const op = (finale ? 0 : k === 0 ? 0.6 : k <= 2 ? 0.65 : 0.25) * introK;
        placeSlot(slots[k], g, op);
        if (k === 0 && g && !finale) slots[0].material.opacity = 0.6 * introK * clamp01((slots[0].userData.zN - d - 2) / 4);
        // una cifra que cae detrás de la velocidad o del pulso del marcador se apaga: dos números encima se leen mal
        if (g && !finale && speedRect && slots[k].visible) {
          anchor.copy(slots[k].position).project(camera);
          const py = ((1 - anchor.y) / 2) * Math.max(1, ctx.hud.height || 1);
          const out = Math.max(speedRect.y - py, py - (speedRect.y + speedRect.h));
          slots[k].material.opacity *= clamp01((out - 6) / 34);
          slots[k].visible = slots[k].material.opacity > 0.01;
        }
      }

      // en el final la escalera entera vuelve a aparecer, de tus pies hacia la salida
      bodyU.uCutZ.value = -d + (finale ? (zEnd + 20) * smooth(clamp01(f.finale * 3)) : 0);

      // ── metas: la tuya se enciende al acercarte y desaparece al cruzarla con la cámara ──
      if (finale) {
        bodyU.uFront.value = fp * 1.5 * segs.length;
      } else {
        bodyU.uFront.value = -1;
        const camZ = rig.current.position.z;
        const near = 1 - Math.min(1, leftT / 60);
        gateU.uCurK.value = (0.8 + 0.2 * near) * (1 + 0.7 * bodyU.uTick.value) * clamp01((Math.abs(camZ + s.z1) - 0.4) / 2.2);
        const pg = segs[s.i - 1];
        // la línea que acabas de cruzar baja poco a poco (al ritmo del relevo), no de golpe
        gateU.uPrevK.value = pg ? (0.1 + 0.9 * (1 - bodyU.uIn.value)) * clamp01((Math.abs(camZ + pg.z1) - 0.4) / 2.2) : 0;
      }
      checkMat.opacity = s.i === lastI || finale ? 0.9 : 0.45;
      const Lm = segs[lastI];
      metaPlane.rotation.y = finale ? Math.PI : 0;
      metaPlane.position.set(0, Lm.h1 * rise + (Lm.gateTop - Lm.h1) - 0.75, -zEnd + (finale ? -0.02 : 0.02));
      check.position.y = Lm.h1 * rise + 0.025;
    },

    event(type, data) {
      if (type === 'timeline') rebuildAt = 0;            // en el siguiente fotograma (las velocidades ya cambiaron)
      else if (type === 'adjust') rebuildAt = 0;
      else if (type === 'seek' || type === 'start') { camSpan = null; rig.snap(); pulseT = -1; tick = 0; }
      else if (type === 'countdown') tick = 1;             // 3-2-1: la línea del final late con cada número
      else if (type === 'gate' && segs.length) { pulseCol.copy(segs[clamp(Number(data?.index) || 0, 0, lastI)].col).lerp(WHITE, 0.25); pulseT = 0; }
      else if (type === 'km' || type === 'halfway') { pulseCol.copy(WHITE); pulseT = 0; }
      else if (type === 'hr') hr = data && Number(data.bpm) > 0 ? { bpm: Number(data.bpm), min: Number(data.min) || 0, max: Number(data.max) || 0 } : null;
    },

    dispose() {
      for (const p of slots) p.userData.dispose?.();
      sky.geometry.dispose(); sky.material.dispose(); waveMat.dispose();
      moteGeo.dispose(); motes.material.dispose();
      trailGeo.dispose(); trailMat.dispose(); trailTex.dispose(); pulse.geometry.dispose(); pulseMat.dispose();
      metaPlane.userData.dispose?.();
    },
  };
  return inst;
}
