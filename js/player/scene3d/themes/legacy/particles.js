// Escenario 'legacy' (Hypertrack v1, oculto) · partículas 100 % en GPU: polvo de luz con clima por zona y estelas de
// velocidad cortas. Retirado por §15: explosiones, confeti 3D, ondas expansivas y estelas de warp.
import { OUTPUT } from '../../shaders.js';
import { rng } from '../../util.js';

/* ───────────── Polvo de luz + clima por zona (§14.1-5) ───────────── */
// Las mismas partículas cambian de papel con uniforms: polvo (por defecto), lluvia de luz (sprint), nieve de luz
// (vuelta a la calma) y luciérnagas (recuperación). Cada partícula elige su papel por semilla ⇒ fundidos suaves.

const DUST_VERT = /* glsl */ `
attribute vec4 aP; // x, y, fase z, semilla
uniform float uScroll, uTime, uPx, uSize, uRange, uRain, uSnow, uFly, uCamY;
varying float vA;
varying float vSeed;
varying float vMode;
void main() {
  float seed = aP.w;
  float sel = fract(seed * 7.13 + aP.z * 3.1);
  float t1 = uRain;
  float t2 = t1 + uSnow;
  float t3 = t2 + uFly;
  vec3 p;
  float size = uSize * (0.5 + seed);
  float a = 1.0;
  float mode = 0.0;
  if (sel < t1) {
    // lluvia de luz: cae deprisa y la atraviesas
    mode = 1.0;
    float x = (fract(seed * 13.7) - 0.5) * 36.0;
    float y = mod(aP.y * 3.7 - uTime * (15.0 + seed * 9.0), 24.0);
    p = vec3(x, y + uCamY - 7.0, -mod(aP.z * 110.0 + uScroll * 0.9, 110.0) + 6.0);
    size = uSize * 1.5;
    a = smoothstep(0.0, 0.03, t1 - sel);
  } else if (sel < t2) {
    // nieve de luz: lenta, con vaivén
    mode = 2.0;
    float x = (fract(seed * 17.3) - 0.5) * 60.0 + sin(uTime * 0.6 + seed * 31.0) * 1.4;
    float y = mod(aP.y * 2.1 - uTime * (0.9 + seed * 0.8), 28.0);
    p = vec3(x, y + uCamY - 4.0, -mod(aP.z * 160.0 + uScroll * 0.6, 160.0) + 8.0);
    size = uSize * (0.9 + seed);
    a = smoothstep(0.0, 0.03, min(sel - t1, t2 - sel));
  } else if (sel < t3) {
    // luciérnagas a los lados de la pista, cerca del suelo
    mode = 3.0;
    float side = fract(seed * 5.7) < 0.5 ? -1.0 : 1.0;
    float x = side * (5.8 + fract(seed * 11.3) * 14.0) + sin(uTime * 0.37 + seed * 19.0) * 1.3;
    float y = 0.4 + fract(seed * 23.1) * 3.4 + sin(uTime * 0.53 + seed * 41.0) * 0.6;
    p = vec3(x, y, -mod(aP.z * 140.0 + uScroll, 140.0) + 8.0 + cos(uTime * 0.29 + seed * 7.0) * 1.5);
    size = uSize * 1.3;
    a = smoothstep(0.0, 0.03, min(sel - t2, t3 - sel));
  } else {
    float z = -mod(aP.z * uRange + uScroll, uRange) + 12.0;
    p = vec3(aP.x + sin(uTime * 0.31 + seed * 40.0) * 0.8, aP.y + sin(uTime * 0.23 + seed * 17.0) * 0.6, z);
    a = t3 > 0.001 ? smoothstep(0.0, 0.03, sel - t3) : 1.0;
  }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vA = a * smoothstep(0.5, 6.0, d) * (1.0 - smoothstep(uRange * 0.55, uRange, d));
  vSeed = seed;
  vMode = mode;
  gl_PointSize = clamp(size * uPx / max(d, 0.1), 0.0, 48.0);
  gl_Position = projectionMatrix * mv;
}`;

const DUST_FRAG = /* glsl */ `
uniform vec3 uColor, uColor2;
uniform float uAmt, uTime, uHigh;
varying float vA;
varying float vSeed;
varying float vMode;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  vec3 col;
  if (vMode > 0.5 && vMode < 1.5) {
    // gota: trazo vertical fino
    float a = smoothstep(0.07, 0.0, abs(c.x)) * (1.0 - smoothstep(0.1, 0.5, abs(c.y)));
    col = mix(uColor, vec3(1.0), 0.45) * a * 0.9;
  } else if (vMode > 2.5) {
    float blink = pow(0.5 + 0.5 * sin(uTime * (1.3 + vSeed * 2.0) + vSeed * 60.0), 3.0);
    float a = smoothstep(0.5, 0.0, r);
    col = vec3(0.85, 1.0, 0.42) * (a * a * 1.2 + smoothstep(0.12, 0.0, r)) * blink * 1.3;
  } else {
    float a = smoothstep(0.5, 0.0, r);
    a *= a;
    float tw = (0.6 + 0.4 * sin(uTime * (1.0 + vSeed * 3.0) + vSeed * 50.0)) * (0.75 + uHigh * 0.9);
    col = (vMode > 1.5 ? mix(vec3(0.92, 0.93, 1.0), uColor2, 0.25) : mix(uColor, uColor2, vSeed)) * a * tw * 1.4;
  }
  gl_FragColor = vec4(col * vA * uAmt, 1.0);
  ${OUTPUT}
}`;

/* ───────────── Estelas ───────────── */

const STREAK_VERT = /* glsl */ `
attribute vec2 aCorner;  // x: 0 cabeza → 1 cola · y: −1..1 ancho
attribute vec4 aP;       // ángulo, radio, fase, multiplicador
uniform float uScroll, uLen, uWidth, uRange, uHyper, uCenterY;
varying float vAlong;
varying float vAcross;
varying float vFade;
varying float vSeed;
void main() {
  float z = -mod(aP.z * uRange + uScroll * aP.w, uRange) + 14.0;
  float r = aP.y * mix(1.0, 0.8, uHyper);
  vec3 base = vec3(cos(aP.x) * r, sin(aP.x) * r * 0.75 + uCenterY, z);
  float len = uLen * (0.55 + 0.9 * fract(aP.w * 7.31));
  vec3 p0 = base;
  vec3 p1 = base + vec3(0.0, 0.0, -len);
  vec4 v0 = viewMatrix * vec4(p0, 1.0);
  vec4 v1 = viewMatrix * vec4(p1, 1.0);
  vec3 pv = mix(v0.xyz, v1.xyz, aCorner.x);
  vec3 dir = normalize(v1.xyz - v0.xyz + 1e-5);
  vec3 side = normalize(cross(dir, normalize(pv)));
  float w = uWidth * (0.6 + 0.8 * fract(aP.w * 3.7));
  pv += side * aCorner.y * w;
  vAlong = aCorner.x;
  vAcross = aCorner.y;
  float d = -pv.z;
  vFade = smoothstep(1.0, 10.0, d) * (1.0 - smoothstep(uRange * 0.6, uRange, d));
  vSeed = fract(aP.w * 13.7);
  gl_Position = projectionMatrix * vec4(pv, 1.0);
}`;

const STREAK_FRAG = /* glsl */ `
uniform vec3 uColor, uColor2;
uniform float uAmt, uHyper;
varying float vAlong;
varying float vAcross;
varying float vFade;
varying float vSeed;
void main() {
  float a = (1.0 - vAlong) * (1.0 - vAlong) * (1.0 - abs(vAcross));
  vec3 c = mix(uColor, uColor2, step(0.5, vSeed));
  c = mix(c, vec3(1.0), 0.35 + uHyper * 0.3);
  vec3 col = c * a * vFade * uAmt * 1.6;
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}`;

export function createParticles(THREE, { quality = 3, seed = 7 } = {}) {
  const group = new THREE.Group();
  const R = rng(seed);
  const C = () => ({ value: new THREE.Color() });
  const scale = quality >= 3 ? 1 : quality === 2 ? 0.75 : quality === 1 ? 0.5 : 0.35;

  // Polvo
  const DUST_MAX = 900;
  const dustGeo = new THREE.BufferGeometry();
  const dustP = new Float32Array(DUST_MAX * 4);
  for (let i = 0; i < DUST_MAX; i++) {
    const side = R() < 0.5 ? -1 : 1;
    dustP[i * 4] = side * (1.5 + Math.pow(R(), 0.7) * 60);
    dustP[i * 4 + 1] = 0.3 + Math.pow(R(), 1.6) * 34;
    dustP[i * 4 + 2] = R();
    dustP[i * 4 + 3] = R();
  }
  dustGeo.setAttribute('aP', new THREE.BufferAttribute(dustP, 4));
  dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST_MAX * 3), 3));
  dustGeo.setDrawRange(0, Math.floor(DUST_MAX * scale));
  const dustU = {
    uScroll: { value: 0 }, uTime: { value: 0 }, uPx: { value: 600 }, uSize: { value: 0.22 }, uRange: { value: 240 },
    uColor: C(), uColor2: C(), uAmt: { value: 1 }, uRain: { value: 0 }, uSnow: { value: 0 }, uFly: { value: 0 },
    uCamY: { value: 2 }, uHigh: { value: 0 },
  };
  const dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
    uniforms: dustU, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  dust.frustumCulled = false;
  group.add(dust);

  // Estelas
  const STREAK_MAX = 630;
  const streakGeo = new THREE.InstancedBufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  streakGeo.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
  streakGeo.setIndex([0, 2, 1, 1, 2, 3]);
  const sP = new Float32Array(STREAK_MAX * 4);
  for (let i = 0; i < STREAK_MAX; i++) {
    // evita el centro (pista y número del HUD): más estelas a los lados y arriba
    let a = R() * Math.PI * 2;
    if (Math.abs(Math.sin(a)) < 0.25 && R() < 0.5) a += 0.6;
    sP[i * 4] = a;
    sP[i * 4 + 1] = 6 + Math.pow(R(), 0.8) * 34;
    sP[i * 4 + 2] = R();
    sP[i * 4 + 3] = 0.7 + R() * 0.9;
  }
  streakGeo.setAttribute('aP', new THREE.InstancedBufferAttribute(sP, 4));
  streakGeo.instanceCount = Math.floor(STREAK_MAX * scale);
  const streakU = {
    uScroll: { value: 0 }, uLen: { value: 6 }, uWidth: { value: 0.05 }, uRange: { value: 320 }, uHyper: { value: 0 },
    uCenterY: { value: 3 }, uColor: C(), uColor2: C(), uAmt: { value: 0 },
  };
  const streaks = new THREE.Mesh(streakGeo, new THREE.ShaderMaterial({
    uniforms: streakU, vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  streaks.frustumCulled = false;
  group.add(streaks);

  return {
    object: group,
    setQuality(q) {
      const s = q >= 3 ? 1 : q === 2 ? 0.75 : q === 1 ? 0.5 : 0.35;
      dustGeo.setDrawRange(0, Math.floor(DUST_MAX * s));
      streakGeo.instanceCount = Math.floor(STREAK_MAX * s);
    },

    update(F) {
      const m = F.mood;
      dustU.uScroll.value = (F.camS * 0.92) % 240;
      dustU.uTime.value = F.time;
      dustU.uPx.value = F.pxScale;
      dustU.uColor.value.copy(m.accent);
      dustU.uColor2.value.copy(m.accent2).lerp(m.sunA, 0.4);
      dustU.uAmt.value = 0.35 + m.dust * 0.65;
      dustU.uRain.value = F.weather.rain;
      dustU.uSnow.value = F.weather.snow;
      dustU.uFly.value = F.weather.fly;
      dustU.uCamY.value = F.camPos.y;
      dustU.uHigh.value = F.high;

      const speedN = F.speedN; // 0..1
      const hyper = F.reduced ? 0 : m.hyper;
      streakU.uScroll.value = (F.camS * 1.15) % 3200;
      streakU.uLen.value = (F.reduced ? 1.5 : 2.5) + speedN * speedN * 14;
      streakU.uWidth.value = 0.03;
      streakU.uHyper.value = hyper * 0.3;
      streakU.uCenterY.value = F.camPos.y + 1;
      streakU.uColor.value.copy(m.accent);
      streakU.uColor2.value.copy(m.accent2);
      const sAmt = m.streaks * (0.2 + speedN * 0.5) * (F.reduced ? 0.35 : 0.7) * F.motion;
      streakU.uAmt.value = sAmt;
      streaks.visible = sAmt > 0.01;
    },

    dispose() {
      dustGeo.dispose(); dust.material.dispose();
      streakGeo.dispose(); streaks.material.dispose();
    },
  };
}
