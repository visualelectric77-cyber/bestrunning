// Escenario 'legacy' (Hypertrack v1, oculto) · fantasma de tu mejor marca (§14.1-1): corredor holográfico low-poly
// (10 piezas, 120 triángulos) con zancada en el vertex shader y 6 imágenes residuales instanciadas (1 draw call). Corre
// en el carril de al lado a la distancia relativa real que calcula el núcleo (frame.ghost.deltaM). La distancia visual
// se comprime (siempre visible si va por delante); el dato exacto lo da el HUD.
import { OUTPUT, FOG } from '../../shaders.js';
import { clamp, damp } from '../../util.js';

const LANE_X = 2.7;
const SCALE = 1.35;
const TRAILS = 6;

const VERT = /* glsl */ `
attribute float aPart;
attribute vec3 aJ1;
attribute vec3 aJ2;
uniform float uPhase, uSpacing;
varying vec2 vUv;
varying float vK;
varying float vDist;
vec3 rotX(vec3 p, vec3 pv, float a) {
  p -= pv;
  float c = cos(a), s = sin(a);
  p.yz = vec2(c * p.y - s * p.z, s * p.y + c * p.z);
  return p + pv;
}
void main() {
  float k = float(gl_InstanceID);
  float ph = (uPhase - k * 0.06) * 6.2831853;
  vec3 p = position;
  float part = aPart;
  bool left = (part > 1.5 && part < 3.5) || (part > 5.5 && part < 7.5);
  float lp = ph + (left ? 0.0 : 3.14159265);
  if (part > 1.5 && part < 5.5) {
    // piernas: cadera adelante/atrás, rodilla que se dobla hacia atrás en el vuelo
    float hip = 0.62 * sin(lp);
    float knee = 0.2 + 1.1 * max(0.0, sin(lp - 1.3));
    if (part == 3.0 || part == 5.0) p = rotX(p, aJ2, -knee);
    p = rotX(p, aJ1, hip);
  } else if (part > 5.5) {
    // brazos opuestos a la pierna del mismo lado, codo a ~80°
    float sh = -0.55 * sin(lp);
    if (part == 7.0 || part == 9.0) p = rotX(p, aJ2, 1.35);
    p = rotX(p, aJ1, sh);
  }
  if (part < 1.5 || part > 5.5) p = rotX(p, vec3(0.0, 0.95, 0.0), -0.2); // inclinación del tronco
  p.y += 0.05 * abs(sin(ph));
  p *= ${SCALE.toFixed(2)};
  p.z += k * uSpacing;
  vUv = uv;
  vK = k;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uTime, uFogDensity;
varying vec2 vUv;
varying float vK;
varying float vDist;
${FOG}
void main() {
  vec2 e = abs(vUv * 2.0 - 1.0);
  float edge = smoothstep(0.72, 0.98, max(e.x, e.y));
  float scan = 0.75 + 0.25 * sin(gl_FragCoord.y * 0.9 - uTime * 9.0);
  float trail = vK < 0.5 ? 1.0 : (1.0 - vK / ${(TRAILS + 1).toFixed(1)}) * 0.38;
  vec3 col = mix(uColor, vec3(1.0), edge * 0.45) * (0.1 + edge * 1.25) * scan * trail;
  float f = fogAmount(vDist, 0.0016 * uFogDensity);
  col *= uOpacity * (1.0 - f) * smoothstep(1.5, 5.0, vDist);
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}`;

function buildRunner(THREE) {
  // [w, h, d, cx, cy, cz, part, j1, j2]
  const P = [];
  const hipY = 0.95;
  const kneeY = 0.5;
  const shY = 1.42;
  const elY = 1.13;
  P.push([0.34, 0.52, 0.2, 0, 1.2, 0, 0, [0, hipY, 0], [0, hipY, 0]]);            // tronco
  P.push([0.21, 0.24, 0.22, 0, 1.62, -0.02, 1, [0, hipY, 0], [0, hipY, 0]]);      // cabeza
  for (const [side, a, b] of [[1, 2, 3], [-1, 4, 5]]) {
    const x = side * 0.1;
    P.push([0.14, 0.46, 0.15, x, hipY - 0.23, 0, a, [x, hipY, 0], [x, kneeY, 0]]);
    P.push([0.11, 0.46, 0.12, x, kneeY - 0.23, 0, b, [x, hipY, 0], [x, kneeY, 0]]);
  }
  for (const [side, a, b] of [[1, 6, 7], [-1, 8, 9]]) {
    const x = side * 0.24;
    P.push([0.1, 0.3, 0.1, x, shY - 0.15, 0, a, [x, shY, 0], [x, elY, 0]]);
    P.push([0.09, 0.27, 0.09, x, elY - 0.135, 0, b, [x, shY, 0], [x, elY, 0]]);
  }
  const pos = [];
  const uv = [];
  const part = [];
  const j1 = [];
  const j2 = [];
  const idx = [];
  let base = 0;
  for (const [w, h, d, cx, cy, cz, pid, a, b] of P) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(cx, cy, cz);
    const gp = g.attributes.position;
    const gu = g.attributes.uv;
    for (let i = 0; i < gp.count; i++) {
      pos.push(gp.getX(i), gp.getY(i), gp.getZ(i));
      uv.push(gu.getX(i), gu.getY(i));
      part.push(pid);
      j1.push(...a);
      j2.push(...b);
    }
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx.push(gi[i] + base);
    base += gp.count;
    g.dispose();
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  geo.setAttribute('aJ1', new THREE.Float32BufferAttribute(j1, 3));
  geo.setAttribute('aJ2', new THREE.Float32BufferAttribute(j2, 3));
  geo.setIndex(idx);
  geo.instanceCount = TRAILS + 1;
  return geo;
}

export function createGhost(THREE) {
  const geo = buildRunner(THREE);
  const uniforms = {
    uColor: { value: new THREE.Color('#7fdcff') }, uOpacity: { value: 0 }, uTime: { value: 0 }, uPhase: { value: 0 },
    uSpacing: { value: 0.5 }, uFogDensity: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;

  let phase = 0;
  let zDisp = -40;
  let amt = 0;

  return {
    object: mesh,
    /** deltaM = tus metros − los suyos (núcleo) · speed = su km/h · show = visible · stageY = altura del escalón. */
    update(F, deltaM, speed, show, stageY) {
      const gapM = -deltaM; // > 0 ⇒ el fantasma va por delante
      const cad = clamp(150 + 2.3 * (speed || 8), 160, 185);
      phase = (phase + F.dt * (cad / 120) * F.timeScale) % 1000;
      const target = gapM > 0 ? -(6 + 160 * (1 - Math.exp(-gapM / 35))) : -6 - gapM * 1.6;
      zDisp = damp(zDisp, target, 2.2, F.dt);
      amt = damp(amt, show ? 1 : 0, 2, F.dt);
      mesh.visible = amt > 0.01 && zDisp < 1.5;
      if (mesh.visible) {
        mesh.position.set(LANE_X, stageY, zDisp);
        uniforms.uPhase.value = phase;
        uniforms.uTime.value = F.time;
        uniforms.uSpacing.value = 0.35 + F.speedN * 1.6;
        uniforms.uOpacity.value = amt * (F.reduced ? 0.7 : 1);
        uniforms.uFogDensity.value = F.mood.fogDensity * F.fogMul;
      }
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
