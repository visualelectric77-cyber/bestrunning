// NOCHE DE HALLOWEEN · calabazas talladas (jack-o'-lanterns) con vela a ambos lados del camino, a intervalos REALES
// (PUMP_D m por lado, al tresbolillo): la señal de velocidad cercana. Una sola malla instanciada (piel con gajos y
// rabo) + una de halos (la luz de la vela en la niebla). Cada instancia es una ranura j del marco del corredor; su
// aspecto (tamaño, giro, cara tallada, parpadeo) es función del índice entero de la ranura ⇒ al avanzar, la ranura
// que sale por detrás reaparece delante sin saltos. Las caras miran al camino y al corredor que llega.
// La cara (ojos, nariz y boca dentada; tres estilos) se talla en el shader sobre la piel: dentro, la luz de la vela
// con el color de la zona; en el canto, la pulpa iluminada. Sin destellos: el brillo solo cambia despacio
// (apagado previo al cambio de tramo, encendido en cadena, final).
import { COMMON_GLSL, PUMP_D } from './common.js';

const PUMP_VERT = /* glsl */ `
attribute vec2 aSlot;     // x ranura j, y lado (−1 / +1)
attribute float aPart;    // 0 piel, 1 rabo
uniform float uScale;
varying vec3 vL, vW, vN;
varying vec3 vCol;
varying float vBr, vSeed, vPart;
NOISE_CHUNK
COMMON_CHUNK
void main() {
  float srel; float lat; float size; float seed;
  pumpkinSlot(aSlot.x, aSlot.y, srel, lat, size, seed);
  float br; vec3 zc = candleAt(srel, br);
  vCol = candleTint(zc);
  vBr = br * flick(seed);
  vSeed = seed;
  vPart = aPart;
  vL = position;
  // cara hacia el camino y hacia el corredor que llega (+z), con algo de desorden
  float yaw = atan(-aSlot.y * 0.66, 0.75) + (seed - 0.5) * 0.55;
  float c = cos(yaw); float s = sin(yaw);
  float rad = size * 0.5 * uScale;
  float wide = 0.92 + 0.18 * hash11(seed * 91.7);
  vec3 q = vec3(position.x * wide, position.y, position.z * wide) * rad;
  vec3 w = vec3(q.x * c + q.z * s, q.y + rad * 0.74, -q.x * s + q.z * c);
  w.x += lat + bendX(srel);
  w.z -= srel;
  vec3 n = normalize(vec3(normal.x / wide, normal.y, normal.z / wide));
  vN = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
  vW = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const PUMP_FRAG = /* glsl */ `
uniform vec3 uSkin, uSkinDark, uStem, uFlesh;
uniform float uDetail;
varying vec3 vL, vW, vN;
varying vec3 vCol;
varying float vBr, vSeed, vPart;
NOISE_CHUNK
COMMON_CHUNK

// triángulo (vértice arriba si up > 0) de semialtura h y semibase b centrado en c: distancia aproximada (unidades uv)
float triD(vec2 p, vec2 c, float b, float h, float up) {
  vec2 q = p - c; q.y *= up;
  float t = clamp((q.y + h) / (2.0 * h), 0.0, 1.0);
  return max(abs(q.x) - b * (1.0 - t), abs(q.y) - h) * 0.85;
}
float boxD(vec2 p, vec2 c, vec2 h) { vec2 d = abs(p - c) - h; return max(d.x, d.y); }

// cara tallada en coordenadas (u = azimut desde el frente, v = altura): < 0 dentro de un hueco
float faceD(vec2 p, float style) {
  float ax = abs(p.x);
  float d;
  if (style < 0.34) {
    // clásica: ojos triangulares, nariz triangular, sonrisa con dos dientes
    d = triD(vec2(ax, p.y), vec2(0.4, 0.2), 0.17, 0.13, 1.0);
    d = min(d, triD(p, vec2(0.0, -0.02), 0.08, 0.07, 1.0));
  } else if (style < 0.67) {
    // ojos de media luna y nariz pequeña
    d = max(length((vec2(ax, p.y) - vec2(0.4, 0.17)) * vec2(1.0, 1.25)) - 0.16, -(length((vec2(ax, p.y) - vec2(0.4, 0.25)) * vec2(1.0, 1.25)) - 0.16));
    d = min(d, triD(p, vec2(0.0, 0.0), 0.06, 0.06, 1.0));
  } else {
    // ojos rasgados (inclinados hacia dentro) y nariz invertida
    vec2 e = vec2(ax, p.y) - vec2(0.39, 0.19);
    e = mat2(0.92, 0.39, -0.39, 0.92) * e;
    d = boxD(e, vec2(0.0), vec2(0.16, 0.07));
    d = min(d, triD(p, vec2(0.0, 0.0), 0.07, 0.07, -1.0));
  }
  // boca: media luna sonriente, dientes cuadrados (dos arriba, uno abajo)
  float mx = p.x / 0.62;
  float yc = -0.33 + 0.16 * mx * mx;
  float th = 0.12 * sqrt(max(1.0 - mx * mx, 0.0));
  float m = max(abs(p.y - yc) - th, abs(p.x) - 0.62);
  float teeth = min(boxD(vec2(ax, p.y), vec2(0.2, yc + th - 0.035), vec2(0.06, 0.05)), boxD(p, vec2(0.0, yc - th + 0.035), vec2(0.07, 0.05)));
  m = max(m, -teeth);
  return min(d, m);
}

void main() {
  vec3 N = normalize(vN);
  vec3 toCam = vW - cameraPosition;
  float dist = length(toCam);
  vec3 V = -toCam / max(dist, 1e-3);
  float srel = -vW.z;
  float r = vW.x - bendX(srel);
  if (vPart > 0.5) {
    vec3 col = uStem * (uAmb * 10.0 + vCol * vBr * 0.25);
    gl_FragColor = vec4(applyFog(col, vW, V, dist, srel, r), 1.0);
    return;
  }
  // gajos: los surcos se oscurecen
  float phi = atan(vL.z, vL.x);
  float groove = pow(abs(sin(phi * 4.0)), 0.5);
  vec3 skin = mix(uSkinDark, uSkin, 0.45 + 0.55 * groove);
  skin *= 0.9 + 0.2 * vnoise(vL.xy * 6.0 + vSeed * 30.0);
  // cara tallada en la mitad frontal
  vec2 fp = vec2(atan(vL.x, vL.z), vL.y);
  float d = vL.z > 0.0 ? faceD(fp, fract(vSeed * 7.13)) : 1.0;
  float fw = max(fwidth(d), 1e-4);
  float hole = 1.0 - smoothstep(-fw, fw, d);
  float rim = (1.0 - smoothstep(0.0, 0.045 + fw, d)) * (1.0 - hole);
  // luz: ambiente, luna rasante, la vela que se escapa por la piel fina junto a los huecos y el resplandor del suelo
  float moon = max(dot(N, uMoonDir), 0.0);
  vec3 lit = skin * (uAmb * 9.0 + uMoonCol * 0.1 * moon);
  lit += skin * vCol * vBr * (0.5 * exp(-max(d, 0.0) / 0.1) * step(0.0, vL.z) + 0.22 * clamp(-N.y, 0.0, 1.0) + 0.06);
  lit += uFlesh * vCol * vBr * rim * 1.2;
  // dentro del hueco: la vela (núcleo cálido abajo, el color de la zona alrededor)
  float core = exp(-pow((fp.y + 0.12) / 0.32, 2.0)) * exp(-pow(fp.x / 0.5, 2.0));
  vec3 inner = mix(vCol * 1.8, vec3(1.0, 0.72, 0.4) * 2.4, 0.45 * core) * vBr;
  vec3 col = applyFog(lit, vW, V, dist, srel, r);
  // la luz de la vela atraviesa mejor la bruma que la piel
  float fx = dist * uFogP.x;
  col += inner * hole * exp(-fx * fx * 0.6);
  gl_FragColor = vec4(col, 1.0);
}`;

const GLOW_VERT = /* glsl */ `
attribute vec2 aSlot;
attribute vec2 aCorner;
uniform float uScale;
varying vec2 vUv;
varying vec3 vCol;
varying float vK;
NOISE_CHUNK
COMMON_CHUNK
void main() {
  float srel; float lat; float size; float seed;
  pumpkinSlot(aSlot.x, aSlot.y, srel, lat, size, seed);
  float br; vec3 zc = candleAt(srel, br);
  vCol = candleTint(zc) * br * flick(seed);
  vec3 c = vec3(lat + bendX(srel) - aSlot.y * 0.12, size * 0.62 * uScale, -srel);
  float dist = length(c - cameraPosition);
  // halo: más ancho de lejos (la hilera de velas se sigue leyendo en la niebla), nunca enorme de cerca
  float rad = max(0.75, dist * 0.007) * (0.7 + size);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = c + (right * aCorner.x + up * aCorner.y) * rad;
  float fx = dist * uFogP.x;
  vK = smoothstep(3.0, 14.0, dist) * exp(-fx * fx * 0.45) * (0.55 + 0.45 * smoothstep(20.0, 120.0, dist));
  vUv = aCorner;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const GLOW_FRAG = /* glsl */ `
uniform float uGlow;
varying vec2 vUv;
varying vec3 vCol;
varying float vK;
void main() {
  // por debajo del centro el halo cae antes (no se ve el corte con el suelo)
  vec2 q = vec2(vUv.x, vUv.y < 0.0 ? vUv.y * 2.2 : vUv.y);
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float g = exp(-r2 * 5.0) * (1.0 - r2) + 0.35 * exp(-r2 * 22.0);
  gl_FragColor = vec4(vCol * g * vK * uGlow, 1.0);
}`;

/** Calabaza unidad: esfera achatada con 8 gajos y hoyuelos arriba y abajo (radio 1, centro en el origen) + rabo. */
function pumpkinGeometry(THREE) {
  const sph = new THREE.SphereGeometry(1, 24, 11);
  const p = sph.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
    const phi = Math.atan2(z, x);
    const rib = 1 - 0.085 * (1 - Math.pow(Math.abs(Math.sin(phi * 4)), 0.55));
    const rr = Math.hypot(x, z);
    const dimple = 0.2 * Math.exp(-(rr * rr) / 0.06);
    p.setXYZ(i, x * rib, (y * 0.74 - Math.sign(y) * dimple * 0.74), z * rib);
  }
  sph.computeVertexNormals();
  const skin = sph.toNonIndexed();
  sph.dispose();
  // rabo: cilindro torcido, algo inclinado
  const stem = new THREE.CylinderGeometry(0.07, 0.11, 0.34, 6, 3, true);
  const sp = stem.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const y = sp.getY(i) + 0.17;
    sp.setXYZ(i, sp.getX(i) + 0.12 * y * y * 4, y + 0.56, sp.getZ(i));
  }
  stem.computeVertexNormals();
  const stemN = stem.toNonIndexed();
  stem.dispose();
  const n0 = skin.attributes.position.count;
  const n1 = stemN.attributes.position.count;
  const pos = new Float32Array((n0 + n1) * 3);
  const nrm = new Float32Array((n0 + n1) * 3);
  const part = new Float32Array(n0 + n1);
  pos.set(skin.attributes.position.array, 0);
  pos.set(stemN.attributes.position.array, n0 * 3);
  nrm.set(skin.attributes.normal.array, 0);
  nrm.set(stemN.attributes.normal.array, n0 * 3);
  part.fill(1, n0);
  skin.dispose();
  stemN.dispose();
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  return g;
}

/** maxSlots ranuras por lado ⇒ 2·maxSlots instancias (i par = izquierda, impar = derecha). */
export function createPumpkins(ctx, shared, maxSlots) {
  const { THREE } = ctx;
  const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b);
  const n = maxSlots * 2;
  const slot = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { slot[i * 2] = Math.floor(i / 2); slot[i * 2 + 1] = i % 2 ? 1 : -1; }
  const chunk = (s) => s.replace('NOISE_CHUNK', ctx.shaders.NOISE).replace('COMMON_CHUNK', COMMON_GLSL);

  const geo = pumpkinGeometry(THREE);
  geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slot, 2));
  geo.instanceCount = n;
  const u = {
    ...shared,
    uSkin: { value: lin(0.42, 0.11, 0.012) },
    uSkinDark: { value: lin(0.16, 0.035, 0.006) },
    uStem: { value: lin(0.03, 0.028, 0.012) },
    uFlesh: { value: lin(0.9, 0.55, 0.2) },
    uScale: { value: 1 },
    uDetail: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: chunk(PUMP_VERT), fragmentShader: chunk(PUMP_FRAG) });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'halloween-pumpkins';

  // halos (aditivos, sin escribir profundidad: los tapan los troncos)
  const gg = new THREE.InstancedBufferGeometry();
  gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  gg.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  gg.setIndex([0, 1, 2, 0, 2, 3]);
  gg.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slot, 2));
  gg.instanceCount = n;
  const gu = { ...shared, uScale: u.uScale, uGlow: { value: 0.5 } };
  const gmat = new THREE.ShaderMaterial({
    uniforms: gu, vertexShader: chunk(GLOW_VERT), fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Mesh(gg, gmat);
  glow.frustumCulled = false;
  glow.renderOrder = 20;
  glow.name = 'halloween-glows';

  return {
    mesh, glow, u, gu, maxSlots,
    tris: geo.attributes.position.count / 3,
    /** Ranuras visibles por lado (calidad / rango). */
    setSlots(k) { const c = Math.max(1, Math.min(maxSlots, k | 0)) * 2; geo.instanceCount = c; gg.instanceCount = c; },
    spacing: PUMP_D,
  };
}
