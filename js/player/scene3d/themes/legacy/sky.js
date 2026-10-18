// Escenario 'legacy' (Hypertrack v1, oculto) · cielo por shader: degradado profundo por zona, sol retro con franjas
// (respira en trote, late con los graves), montañas de neón (alturas en una textura 512×1), aurora tenue, estrellas y
// nebulosa baja en sprint. Triángulo a pantalla completa al FINAL de los opacos en el plano lejano (early-Z).
// Retirado por §15 / §15.3: rayos radiales, destellos y la máscara del HUD.
import { NOISE, OUTPUT } from '../../shaders.js';
import { rng } from '../../util.js';

const VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform sampler2D uRidgeTex;
uniform vec3 uTop, uMid, uHorizon, uSunA, uSunB, uAccent, uAccent2, uFog, uGoldCol;
uniform float uTime, uSunSize, uSunElev, uAurora, uStars, uHyper, uBreath, uBeat, uPulse, uRidge, uStripes,
  uFinale, uGold, uBass, uSunGain;
varying vec2 vNdc;
${NOISE}
void main() {
  vec4 p = uProjInv * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize((uCamWorld * vec4(p.xyz / p.w, 0.0)).xyz);
  float el = asin(clamp(dir.y, -1.0, 1.0));
  float az = atan(dir.x, -dir.z);
  const float m = 0.0;

  // Degradado (casi negro arriba)
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.2, el));
  col = mix(col, uTop, smoothstep(0.14, 0.7, el));
  col += uHorizon * 0.45 * exp(-abs(el) * 26.0);

  // Estrellas
  float starsAmt = uStars + uFinale * 0.6;
  if (starsAmt > 0.01) {
    vec3 sd = dir * 230.0;
    vec3 cell = floor(sd);
    float h = hash13(cell);
    if (h > 0.972) {
      vec3 o = vec3(hash13(cell + 1.3), hash13(cell + 2.7), hash13(cell + 5.1)) - 0.5;
      float d = length(fract(sd) - 0.5 - o * 0.55);
      float tw = 0.55 + 0.45 * sin(uTime * (1.2 + h * 3.0) + h * 80.0);
      col += vec3(0.9, 0.92, 1.0) * smoothstep(0.16, 0.0, d) * tw * starsAmt * 1.4 * smoothstep(0.03, 0.25, el);
    }
  }

  // Aurora tenue (cortinas colgantes); se apaga bajo el HUD
  if (uAurora > 0.01) {
    float n = fbm3(vec2(az * 1.3 + uTime * 0.018, uTime * 0.045));
    float lower = 0.34 + 0.12 * sin(az * 2.3 + n * 4.0 + uTime * 0.11);
    float above = el - lower;
    float curtain = smoothstep(-0.02, 0.03, above) * exp(-max(above, 0.0) * 4.2);
    float rays = 0.45 + 0.55 * vnoise(vec2(az * 55.0 + n * 9.0, uTime * 0.35));
    float fold = 0.6 + 0.4 * sin(az * 7.0 + n * 7.0 - uTime * 0.2);
    vec3 ac = mix(uAccent * 1.2, uAccent2, smoothstep(0.0, 0.3, above));
    col += ac * curtain * rays * fold * uAurora * 0.3 * (1.0 - 0.85 * m);
  }

  // Sprint: nebulosa tenue solo baja (sobre el horizonte); sin rayos
  if (uHyper > 0.01) {
    float ang = atan(dir.y, dir.x);
    float low = smoothstep(0.01, 0.06, el) * (1.0 - smoothstep(0.12, 0.25, el));
    float neb = fbm3(vec2(ang * 1.5, el * 3.0 + uTime * 0.12));
    col = mix(col, mix(uAccent * 0.5, uAccent2 * 0.55, neb), uHyper * 0.08 * low);
  }

  // Sol retro (en el hueco libre: el punto de fuga se coloca ahí)
  float breath = 1.0 + 0.2 * uBreath;
  float sunR = uSunSize * breath * (1.0 + 0.05 * uBeat * uPulse + 0.06 * uBass);
  vec2 d = vec2(az, el - uSunElev);
  float r = length(d) / sunR;
  float yv = d.y / sunR;
  float disc = smoothstep(1.0, 0.975, r);
  float zone = smoothstep(0.3, -0.05, yv);
  float sp = fract(yv * 6.5 * uStripes + uTime * 0.22);
  float gap = clamp((0.3 - yv) * 0.42, 0.0, 0.62);
  float stripes = 1.0 - zone * step(sp, gap);
  float ring = mix(1.0, smoothstep(0.62, 0.9, r), uHyper * 0.9);
  vec3 sunCol = mix(uSunB, uSunA, smoothstep(-1.0, 0.95, yv));
  sunCol = mix(sunCol, uGoldCol, uGold * 0.75);
  float sunMask = disc * stripes * ring;
  col = mix(col, sunCol * (0.5 + 0.2 * uBreath + 0.18 * uBass) * uSunGain, sunMask);
  float rr = max(r - 1.0, 0.0);
  float glow = exp(-rr * 3.4) * 0.22 + exp(-rr * 0.8) * 0.05;
  col += mix(uSunB, uSunA, 0.25) * glow * (1.0 + 0.8 * uBreath) * (1.0 - sunMask) * uSunGain * (1.0 - 0.6 * m);

  // Montañas de neón (alturas en textura: sin fbm por píxel)
  if (uRidge > 0.01) {
    vec4 rt = texture2D(uRidgeTex, vec2(az / 6.2831853 + 0.5, 0.5));
    float hgt = rt.r * 0.15 * uRidge;
    float hgt2 = rt.g * 0.15 * uRidge;
    float m1 = smoothstep(hgt + 0.002, hgt - 0.002, el);
    float m2 = smoothstep(hgt2 + 0.002, hgt2 - 0.002, el);
    col = mix(col, uFog * 0.5, max(m1 * 0.92, m2));
    float rim = exp(-abs(el - hgt) * 420.0) * (1.0 - m2);
    float rim2 = exp(-abs(el - hgt2) * 520.0);
    col += (uAccent2 * rim * 0.75 + uAccent * rim2 * 0.65) * (1.0 - 0.5 * m);
    float contour = (1.0 - smoothstep(0.0, 0.0018, abs(fract(el * 90.0 + 0.5) - 0.5) / 90.0)) * m1 * (1.0 - m2);
    col += uAccent * contour * 0.12;
  }

  col = mix(col, uFog, smoothstep(0.0, -0.03, el));
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}`;

/** Alturas de las dos crestas por azimut (valle en el centro para dejar ver el sol). */
function ridgeTexture(THREE) {
  const N = 512;
  const R = rng(91);
  const lat = Array.from({ length: 64 }, () => R());
  const lat2 = Array.from({ length: 64 }, () => R());
  const vn = (arr, x) => {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    const a = arr[((i % 64) + 64) % 64];
    const b = arr[(((i + 1) % 64) + 64) % 64];
    return a + (b - a) * u;
  };
  const fbm = (arr, x) => 0.5 * vn(arr, x) + 0.25 * vn(arr, x * 2.03 + 17.1) + 0.125 * vn(arr, x * 4.1 + 5.3);
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const az = ((i + 0.5) / N - 0.5) * Math.PI * 2;
    const aa = Math.abs(az);
    // periodicidad: el ruido se muestrea sobre el círculo (64 celdas por vuelta)
    const x = ((az / (Math.PI * 2)) + 0.5) * 64;
    const h1 = 0.012 + 0.075 * fbm(lat, x * 0.6 + 11) * ss(0.06, 0.65, aa);
    const h2 = 0.006 + 0.04 * fbm(lat2, x * 1.0 + 3) * ss(0.02, 0.4, aa);
    data[i * 4] = Math.round(Math.min(1, h1 / 0.15) * 255);
    data[i * 4 + 1] = Math.round(Math.min(1, h2 / 0.15) * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createSky(THREE, camera) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const C = () => ({ value: new THREE.Color() });
  const ridgeTex = ridgeTexture(THREE);
  const uniforms = {
    uProjInv: { value: camera.projectionMatrixInverse },
    uCamWorld: { value: camera.matrixWorld },
    uRidgeTex: { value: ridgeTex },
    uTop: C(), uMid: C(), uHorizon: C(), uSunA: C(), uSunB: C(), uAccent: C(), uAccent2: C(), uFog: C(),
    uGoldCol: { value: new THREE.Color('#ffd60a') },
    uTime: { value: 0 }, uSunSize: { value: 0.15 }, uSunElev: { value: 0.04 }, uAurora: { value: 0 }, uStars: { value: 0 },
    uHyper: { value: 0 }, uBreath: { value: 0 }, uBeat: { value: 0 }, uPulse: { value: 0 }, uRidge: { value: 1 },
    uStripes: { value: 1 }, uFinale: { value: 0 }, uGold: { value: 0 }, uBass: { value: 0 }, uSunGain: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000; // último de los opacos: sólo pinta lo que queda libre

  return {
    object: mesh,
    update(F) {
      const m = F.mood;
      const u = uniforms;
      u.uTop.value.copy(m.top);
      u.uMid.value.copy(m.mid);
      u.uHorizon.value.copy(m.horizon);
      u.uSunA.value.copy(m.sunA);
      u.uSunB.value.copy(m.sunB);
      u.uAccent.value.copy(m.accent);
      u.uAccent2.value.copy(m.accent2);
      u.uFog.value.copy(m.fog);
      u.uTime.value = F.time;
      u.uSunSize.value = m.sunSize * (F.aspect < 0.85 ? 0.62 : 1);
      u.uSunElev.value = m.sunElev - F.stairRise * 0.004;
      u.uAurora.value = m.aurora;
      u.uStars.value = m.stars;
      u.uHyper.value = F.reduced ? m.hyper * 0.2 : m.hyper;
      u.uBreath.value = F.breath * m.breathe;
      u.uBeat.value = F.beat;
      u.uPulse.value = m.pulse;
      u.uRidge.value = m.ridge;
      u.uStripes.value = m.stripes;
      u.uFinale.value = F.finale;
      u.uGold.value = F.gold;
      u.uBass.value = F.bass;
      u.uSunGain.value = F.finale > 0 ? 1 + F.finale * 0.4 : 1;
    },
    dispose() { geo.dispose(); mat.dispose(); ridgeTex.dispose(); },
  };
}
