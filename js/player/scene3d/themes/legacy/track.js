// Escenario 'legacy' (Hypertrack v1, oculto) · pista: suelo de rejilla por shader (carriles que laten con el beat),
// postes de luz laterales, túnel de anillos ("barra de jefe" de los tramos intensos: se enciende según avanza el tramo)
// y la escalera de luz del test VAM. Todo se desplaza en el shader con la distancia recorrida.
// Retirado por §15: destello de carriles, pulso de salida, halo de pisada, estallido del túnel, máscara del HUD.
import { NOISE, FOG, OUTPUT } from '../../shaders.js';
import { ZONES } from '../../../../training/levels.js';

export const TRACK_HALF = 5;
export const STEP_H = 1.5;          // altura de cada peldaño del test (el ojo, a 2,1 u, queda por encima del siguiente)
const PERIOD = 840;                 // múltiplo común de los espaciados del suelo
const PYLON_SPACING = 14;
const PYLON_PAIRS = 40;
const RING_SPACING = 11;
const RING_COUNT = 24;

/* ───────────── Suelo ───────────── */

const GROUND_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const GROUND_FRAG = /* glsl */ `
uniform vec3 uAccent, uAccent2, uFog, uGround, uSun, uLaunchCol;
uniform float uScroll, uTime, uBeat, uBeatPhase, uPulse, uFogDensity, uStairDim, uGlow, uHyper, uFlash, uStep, uStepLock,
  uRipple, uLaunch;
varying vec3 vW;
${NOISE}
${FOG}
float lineAA(float c, float spacing, float w) {
  float fw = fwidth(c);
  float d = abs(fract(c / spacing + 0.5) - 0.5) * spacing;
  float l = 1.0 - smoothstep(w, w + fw * 1.25, d);
  float fade = clamp(1.0 - fw / spacing * 2.0, 0.0, 1.0);
  return l * fade + (1.0 - fade) * (w * 2.0 / spacing) * 0.6;
}
float bandAA(float v, float center, float w) {
  float fw = fwidth(v);
  return 1.0 - smoothstep(w, w + fw * 1.3, abs(v - center));
}
void main() {
  float x = vW.x;
  float ax = abs(x);
  float s = uScroll - vW.z;
  vec3 toCam = vW - cameraPosition;
  float dist = length(toCam);
  float ahead = max(0.0, -toCam.z);
  float onTrack = 1.0 - smoothstep(TRACK_HALF - 0.08, TRACK_HALF + 0.08, ax);

  vec3 col = uGround;
  col += uAccent * 0.02 * onTrack;
  float refl = exp(-ax * 0.32) * smoothstep(4.0, 160.0, ahead) * onTrack;
  col += uSun * refl * 0.3;

  // onda del beat que avanza por los carriles
  float wavePos = uBeatPhase * 85.0;
  float wave = exp(-pow((ahead - wavePos) / 8.0, 2.0)) * (1.0 - uBeatPhase);
  float pulse = 1.0 + uPulse * (uBeat * 1.0 + wave * 2.0) + uStep * uStepLock * 0.9;

  float edge = bandAA(ax, TRACK_HALF, 0.09);
  float edge2 = bandAA(ax, TRACK_HALF + 0.42, 0.035);
  float divider = bandAA(ax, 1.67, 0.055) * step(0.42, fract(s / 7.0));
  float cross = lineAA(s, 12.0, 0.045) * onTrack;
  float dz = (fract(s / 3.0) - 0.5) * 3.0;
  float dotL = smoothstep(0.16, 0.0, length(vec2(dz, x * 1.6)) - 0.05);
  vec3 lane = uAccent * (edge * 1.5 + edge2 * 0.5 + divider * 0.85) * pulse * uGlow;
  lane += uAccent2 * cross * (0.35 + wave * uPulse * 1.8);
  lane += mix(uAccent, vec3(1.0), 0.35) * dotL * (0.22 + wave * 2.6 * uPulse + uHyper * 0.7 + uStep * uStepLock * 1.2);

  float outer = smoothstep(TRACK_HALF + 0.6, TRACK_HALF + 1.6, ax) * (1.0 - smoothstep(11.0, 19.0, ax));
  float g = max(lineAA(x, 4.0, 0.03), lineAA(s, 4.0, 0.03));
  float g2 = max(lineAA(x, 20.0, 0.06), lineAA(s, 20.0, 0.06));
  vec3 grid = mix(uAccent2, uAccent, 0.45) * (g * 0.4 + g2 * 0.75) * outer * (1.0 + uBeat * uPulse * 0.6);

  float far = smoothstep(16.0, 34.0, ax);
  float shimmer = vnoise(vec2(x * 0.05, s * 0.02 + uTime * 0.05));
  col += uFog * far * (0.1 + 0.08 * shimmer);

  col += lane + grid;
  col *= mix(1.0, 0.4, uStairDim);

  float f = fogAmount(dist, 0.0026 * uFogDensity);
  col = mix(col, uFog, f);
  float alpha = mix(1.0, 0.55, far * (1.0 - f));
  gl_FragColor = vec4(col, alpha);
  ${OUTPUT}
}`;

/* ───────────── Postes laterales ───────────── */

const PYLON_VERT = /* glsl */ `
uniform float uScroll, uBeat, uPulse, uTime;
varying float vY;
varying float vDist;
void main() {
  float id = float(gl_InstanceID);
  float side = mod(id, 2.0) * 2.0 - 1.0;
  float k = floor(id * 0.5);
  float total = ${PYLON_SPACING.toFixed(1)} * ${PYLON_PAIRS.toFixed(1)};
  float local = mod(k * ${PYLON_SPACING.toFixed(1)} - uScroll, total);
  float z = -local + 10.0;
  vec3 p = position;
  float h = 1.0 + uBeat * uPulse * 0.25;
  vY = p.y + 0.5;
  p.y = (p.y + 0.5) * 2.7 * h;
  p.x += side * ${(TRACK_HALF + 0.75).toFixed(2)};
  p.z += z;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const PYLON_FRAG = /* glsl */ `
uniform vec3 uAccent, uAccent2, uFog;
uniform float uFogDensity, uBeat, uPulse, uIntensity;
varying float vY;
varying float vDist;
${FOG}
void main() {
  float top = smoothstep(0.75, 1.0, vY);
  vec3 col = mix(uAccent, vec3(1.0), top * 0.6) * (0.8 + top * 1.9 + uBeat * uPulse * 0.7);
  col *= smoothstep(0.0, 0.15, vY);
  float f = fogAmount(vDist, 0.0034 * uFogDensity);
  col *= (1.0 - f) * uIntensity * smoothstep(1.5, 6.0, vDist);
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}`;

/* ───────────── Túnel de anillos: HYPERDRIVE + barra de jefe ───────────── */

const RING_VERT = /* glsl */ `
uniform float uScroll, uHyper, uBoss, uTime, uBeat, uProg, uBurst, uLift;
varying float vDist;
varying float vAlt;
varying float vLit;
varying float vFront;
varying float vFade;
varying vec2 vUv;
void main() {
  float id = float(gl_InstanceID);
  float total = ${(RING_SPACING * RING_COUNT).toFixed(1)};
  float local = mod(id * ${RING_SPACING.toFixed(1)} - uScroll, total);
  float z = -local + 6.0;
  float along = max(0.0, local - 6.0);
  // progreso del tramo = frente de luz que se aleja por el túnel
  float frontD = uProg * (total - 10.0);
  vLit = step(along, frontD);
  vFront = exp(-abs(along - frontD) / 3.5) * step(0.001, uProg) * (1.0 - step(0.999, uProg));
  // estallido en dominó (de cerca a lejos) al completar el tramo
  float bt = 0.0;
  vFade = 1.0;
  if (uBurst >= 0.0) {
    bt = clamp((uBurst - along / total * 0.6) / 0.38, 0.0, 1.0);
    vFade = (1.0 - bt) * (1.0 + 2.5 * exp(-bt * 7.0) * step(0.001, bt));
  }
  float vis = max(uHyper, uBoss);
  float a = id * 0.18 + uTime * 0.25 * uHyper;
  float c = cos(a), s = sin(a);
  vec3 p = position * (0.62 + 0.38 * vis) * (1.0 + uBeat * 0.03 * uHyper) * (1.0 + bt * 0.9);
  p.xy = mat2(c, -s, s, c) * p.xy;
  p.y += 3.2 + uLift;
  p.z += z;
  vAlt = mod(id, 2.0);
  vUv = uv;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const RING_FRAG = /* glsl */ `
uniform vec3 uAccent, uAccent2;
uniform float uHyper, uBoss, uFogDensity, uTime, uHot, uProgOn;
varying float vDist;
varying float vAlt;
varying float vLit;
varying float vFront;
varying float vFade;
varying vec2 vUv;
${FOG}
void main() {
  vec3 base = mix(uAccent, uAccent2, vAlt * 0.6);
  float on = mix(1.0, mix(0.16, 1.0, vLit), uProgOn);
  vec3 col = base * 1.9 * on;
  col = mix(col, vec3(1.0, 0.93, 0.85) * 1.6, uHot * vLit * uProgOn * 0.25);
  col += mix(base, vec3(1.0), 0.4) * vFront * 1.2 * uProgOn;
  float chase = pow(fract(vUv.x * 2.0 - uTime * 1.5), 6.0);
  col += vec3(1.0) * chase * 0.15 * on;
  float near = smoothstep(2.0, 14.0, vDist);
  float f = fogAmount(vDist, 0.0042 * uFogDensity);
  col *= max(uHyper, uBoss) * near * (1.0 - f) * vFade;
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}`;

/* ───────────── Escalera del test VAM ───────────── */

const STAIR_VERT = /* glsl */ `
attribute vec4 aS;       // t0, t1, nivel, nº de escalón
attribute vec3 aColor;
uniform float uSNow, uAmt, uSink, uK;
varying vec3 vL;
varying vec3 vN;
varying vec3 vColor;
varying float vDist;
varying vec3 vSize;
varying float vStage;
varying float vZ0;
void main() {
  float z0 = -(aS.x - uSNow) * uK;
  float z1 = -(aS.y - uSNow) * uK;
  float len = z0 - z1;
  float top = aS.z * ${STEP_H.toFixed(2)} - uSink;
  float th = ${STEP_H.toFixed(2)};
  vec3 p = position;
  vL = p;
  vN = normal;
  vSize = vec3(${(TRACK_HALF * 2 + 0.8).toFixed(2)}, th, len);
  vZ0 = z0;
  vec3 w;
  w.x = p.x * vSize.x;
  w.y = top - th * 0.5 + p.y * th;
  w.z = (z0 + z1) * 0.5 + p.z * len;
  vColor = aColor;
  vStage = aS.w;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const STAIR_FRAG = /* glsl */ `
uniform float uAmt, uFogDensity, uBeat, uScrollS;
uniform vec3 uFog;
uniform sampler2D uNums;
varying float vZ0;
varying vec3 vL;
varying vec3 vN;
varying vec3 vColor;
varying float vDist;
varying vec3 vSize;
varying float vStage;
${FOG}
float stageNum(vec2 e) {
  // número del escalón centrado en la contrahuella (atlas 8×3 celdas)
  float bh = 1.12;
  float bw = bh * 0.75;
  vec2 q = vec2(e.x / bw + 0.5, (e.y - ${(STEP_H / 2).toFixed(2)}) / bh + 0.5);
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return 0.0;
  float cellI = clamp(vStage - 1.0, 0.0, 23.0);
  vec2 cell = vec2(mod(cellI, 8.0), floor(cellI / 8.0));
  vec2 uv = (cell + q) / vec2(8.0, 3.0);
  uv.y = 1.0 - ((cell.y + (1.0 - q.y)) / 3.0);
  return texture2D(uNums, uv).r;
}
void main() {
  if (vN.y < -0.5 || vN.z < -0.5) discard;
  vec3 c = vColor;
  vec3 col = c * 0.03 + uFog * 0.15;
  if (vN.y > 0.5) {
    float ex = (0.5 - abs(vL.x)) * vSize.x;
    float edge = exp(-max(ex, 0.0) * 4.0);
    float zw = vZ0 - (0.5 - vL.z) * vSize.z;
    float sl = uScrollS - zw;
    float lines = 1.0 - smoothstep(0.04, 0.1, abs(fract(sl / 6.0) - 0.5) * 6.0);
    float front = exp(-max(0.5 - vL.z, 0.0) * vSize.z * 0.8);
    col += c * (edge * 1.2 + front * 1.25 + lines * 0.25 + uBeat * 0.05);
  } else if (vN.z > 0.5) {
    vec2 e = (0.5 - abs(vL.xy)) * vSize.xy;
    float frame = exp(-max(min(e.x, e.y), 0.0) * 5.0);
    float band = smoothstep(0.25, 0.5, vL.y);
    float num = stageNum(vec2(vL.x * vSize.x, (vL.y + 0.5) * vSize.y));
    if (frame < 0.12 && band < 0.05 && num < 0.05) discard;
    col += c * 0.2 * band + mix(c, vec3(1.0), 0.35) * frame * (1.0 + uBeat * 0.35) + mix(c, vec3(1.0), 0.65) * num * 1.5;
  } else if (abs(vN.x) > 0.5) {
    vec2 e = (0.5 - abs(vL.zy)) * vSize.zy;
    col += c * exp(-max(min(e.x, e.y), 0.0) * 4.0) * 0.85;
  }
  float f = fogAmount(vDist, 0.0026 * uFogDensity);
  col = mix(col, uFog, f);
  gl_FragColor = vec4(col, uAmt);
  ${OUTPUT}
}`;

function numbersAtlas(THREE) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f00';
  ctx.font = '900 132px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
  const cw = c.width / 8;
  const ch = c.height / 3;
  for (let i = 0; i < 24; i++) {
    const cx = (i % 8) * cw + cw / 2;
    const cy = Math.floor(i / 8) * ch + ch / 2 + 6;
    ctx.fillText(String(i + 1), cx, cy, cw * 0.94);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function createTrack(THREE) {
  const group = new THREE.Group();
  const C = () => ({ value: new THREE.Color() });
  const defines = { TRACK_HALF: TRACK_HALF.toFixed(2) };

  // Suelo
  const groundGeo = new THREE.PlaneGeometry(1, 1);
  const groundU = {
    uAccent: C(), uAccent2: C(), uFog: C(), uGround: C(), uSun: C(), uLaunchCol: C(),
    uScroll: { value: 0 }, uTime: { value: 0 }, uBeat: { value: 0 }, uBeatPhase: { value: 0 }, uPulse: { value: 0 },
    uFogDensity: { value: 1 }, uStairDim: { value: 0 }, uGlow: { value: 1 }, uHyper: { value: 0 }, uFlash: { value: 0 },
    uStep: { value: 0 }, uStepLock: { value: 0 }, uRipple: { value: 1 }, uLaunch: { value: -1 },
  };
  const groundMat = new THREE.ShaderMaterial({
    uniforms: groundU, vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, defines,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.scale.set(9000, 9000, 1);
  ground.frustumCulled = false;
  ground.renderOrder = -900;
  group.add(ground);

  // Postes
  const pylonBase = new THREE.BoxGeometry(0.13, 1, 0.13);
  const pylonGeo = new THREE.InstancedBufferGeometry().copy(pylonBase);
  pylonBase.dispose();
  pylonGeo.instanceCount = PYLON_PAIRS * 2;
  const pylonU = {
    uAccent: C(), uAccent2: C(), uFog: C(), uScroll: { value: 0 }, uBeat: { value: 0 }, uPulse: { value: 0 },
    uTime: { value: 0 }, uFogDensity: { value: 1 }, uIntensity: { value: 1 },
  };
  const pylonMat = new THREE.ShaderMaterial({
    uniforms: pylonU, vertexShader: PYLON_VERT, fragmentShader: PYLON_FRAG,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const pylons = new THREE.Mesh(pylonGeo, pylonMat);
  pylons.frustumCulled = false;
  group.add(pylons);

  // Túnel
  const ringBase = new THREE.TorusGeometry(9.5, 0.075, 3, 6);
  const ringGeo = new THREE.InstancedBufferGeometry().copy(ringBase);
  ringBase.dispose();
  ringGeo.instanceCount = RING_COUNT;
  const ringU = {
    uAccent: C(), uAccent2: C(), uScroll: { value: 0 }, uHyper: { value: 0 }, uBoss: { value: 0 }, uTime: { value: 0 },
    uBeat: { value: 0 }, uFogDensity: { value: 1 }, uProg: { value: 0 }, uProgOn: { value: 0 }, uHot: { value: 0 },
    uBurst: { value: -1 }, uLift: { value: 0 },
  };
  const ringMat = new THREE.ShaderMaterial({
    uniforms: ringU, vertexShader: RING_VERT, fragmentShader: RING_FRAG,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const rings = new THREE.Mesh(ringGeo, ringMat);
  rings.frustumCulled = false;
  rings.visible = false;
  group.add(rings);

  // Escalera (se crea bajo demanda en tests)
  let stairs = null;
  let stairU = null;
  let stairData = null;
  let numsTex = null;
  let frozen = null;

  function buildStairs(tl) {
    const idx = [];
    for (let i = 0; i < tl.n; i++) if (tl.stage[i] > 0) idx.push(i);
    if (!idx.length) return;
    const base = new THREE.BoxGeometry(1, 1, 1);
    const geo = new THREE.InstancedBufferGeometry().copy(base);
    base.dispose();
    const aS = new Float32Array(idx.length * 4);
    const aColor = new Float32Array(idx.length * 3);
    const col = new THREE.Color();
    const white = new THREE.Color(1, 1, 1);
    const maxStage = Math.max(1, tl.maxStage);
    idx.forEach((i, k) => {
      // del color de la zona al blanco incandescente según se sube
      col.set(ZONES[tl.zones[i]]?.color || '#ffffff').lerp(white, Math.pow(tl.stage[i] / maxStage, 1.6) * 0.62);
      aColor[k * 3] = col.r; aColor[k * 3 + 1] = col.g; aColor[k * 3 + 2] = col.b;
    });
    geo.setAttribute('aS', new THREE.InstancedBufferAttribute(aS, 4));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3));
    geo.instanceCount = idx.length;
    numsTex = numbersAtlas(THREE);
    stairU = {
      uSNow: { value: 0 }, uAmt: { value: 0 }, uSink: { value: 0 }, uFogDensity: { value: 1 }, uBeat: { value: 0 }, uK: { value: 0.22 },
      uScrollS: { value: 0 }, uFog: C(), uNums: { value: numsTex },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: stairU, vertexShader: STAIR_VERT, fragmentShader: STAIR_FRAG, transparent: true, depthWrite: true,
    });
    stairs = new THREE.Mesh(geo, mat);
    stairs.frustumCulled = false;
    group.add(stairs);
    stairData = { idx, aS, version: -1, tl };
  }

  function syncStairs() {
    const { idx, aS, tl } = stairData;
    if (stairData.version === tl.version) return;
    idx.forEach((i, k) => {
      aS[k * 4] = tl.starts[i];
      aS[k * 4 + 1] = tl.ends[i];
      aS[k * 4 + 2] = tl.stage[i];
      aS[k * 4 + 3] = tl.stage[i];
    });
    stairs.geometry.attributes.aS.needsUpdate = true;
    stairData.version = tl.version;
  }

  return {
    object: group,
    /** Pendiente visual de la escalera (u por segundo de clase): más tendida en vertical para que suba dentro del hueco. */
    stairK(aspect) { return aspect < 0.85 ? 0.35 : 0.22; },
    initTimeline(tl) { if (tl.maxStage > 0) buildStairs(tl); },
    /** Congela la escalera (al pulsar "No puedo más"): sigue alejándose despacio mientras se hunde y bajas flotando. */
    freezeStairs(tNow, time) { frozen = { tNow, time }; },
    update(F) {
      const m = F.mood;
      const u = groundU;
      u.uAccent.value.copy(m.accent);
      u.uAccent2.value.copy(m.accent2);
      u.uFog.value.copy(m.fog);
      u.uGround.value.copy(m.ground);
      u.uSun.value.copy(m.sunB).lerp(m.sunA, 0.4);
      u.uScroll.value = F.camS % PERIOD;
      u.uTime.value = F.time;
      u.uBeat.value = F.beat;
      u.uBeatPhase.value = F.beatPhase;
      u.uPulse.value = m.pulse;
      u.uFogDensity.value = m.fogDensity * F.fogMul;
      u.uStairDim.value = F.stairAmt;
      u.uGlow.value = m.gridGlow;
      u.uHyper.value = m.hyper;
      u.uFlash.value = F.flash;
      u.uStep.value = F.stepEnv;
      u.uStepLock.value = F.stepLock;
      u.uRipple.value = F.ripple;
      u.uLaunch.value = F.launch;
      u.uLaunchCol.value.copy(m.accent).lerp(F.white, 0.25);
      ground.position.set(F.camPos.x, 0, F.camPos.z);

      pylonU.uAccent.value.copy(m.accent);
      pylonU.uAccent2.value.copy(m.accent2);
      pylonU.uScroll.value = F.camS % (PYLON_SPACING * PYLON_PAIRS);
      pylonU.uBeat.value = F.beat;
      pylonU.uPulse.value = m.pulse;
      pylonU.uFogDensity.value = m.fogDensity * F.fogMul;
      pylonU.uIntensity.value = 1 - F.stairAmt * 0.6;

      const hyper = F.reduced ? m.hyper * 0.35 : m.hyper;
      const boss = F.boss;
      const vis = Math.max(hyper, boss.amt);
      rings.visible = vis > 0.02 && (F.quality >= 1 || boss.amt > 0.02);
      if (rings.visible) {
        ringU.uAccent.value.copy(m.accent);
        ringU.uAccent2.value.copy(m.accent2);
        ringU.uScroll.value = F.camS % (RING_SPACING * RING_COUNT);
        ringU.uHyper.value = hyper;
        ringU.uBoss.value = boss.amt;
        ringU.uProg.value = boss.prog;
        ringU.uProgOn.value = boss.amt > 0.02 ? 1 : 0;
        ringU.uHot.value = boss.hot;
        ringU.uBurst.value = boss.burst;
        ringU.uTime.value = F.time;
        ringU.uBeat.value = F.beat;
        ringU.uLift.value = F.stairRise;
        ringU.uFogDensity.value = m.fogDensity * F.fogMul;
      }

      if (stairs) {
        stairs.visible = F.stairAmt > 0.003;
        if (stairs.visible) {
          syncStairs();
          stairU.uK.value = F.stairK;
          stairU.uSNow.value = frozen ? frozen.tNow + (F.time - frozen.time) * 1.5 : F.skyT;
          stairU.uScrollS.value = F.camS % 600;
          stairU.uAmt.value = F.stairAmt;
          stairU.uSink.value = F.stairSink;
          stairU.uFogDensity.value = m.fogDensity * F.fogMul;
          stairU.uBeat.value = F.beat;
          stairU.uFog.value.copy(m.fog);
        }
      }
    },
    dispose() {
      groundGeo.dispose(); groundMat.dispose();
      pylonGeo.dispose(); pylonMat.dispose();
      ringGeo.dispose(); ringMat.dispose();
      if (stairs) { stairs.geometry.dispose(); stairs.material.dispose(); }
      numsTex?.dispose();
    },
  };
}
