// Escenario 'legacy' (Hypertrack v1, oculto) · skyline de la clase: el perfil completo del entrenamiento extruido como columnas de luz a ambos
// lados (InstancedMesh, un draw call por capa). Eje Z = tiempo comprimido (toda la clase cabe en ~1,5 km), altura =
// velocidad. Estados en el shader: pasadas apagadas, actual brillando al ritmo, futuras en su color.
// Incluye reflejo en el "agua" del suelo y la ola de luz del final. Las franjas LED son un vúmetro: cada torre lee una
// banda de frecuencias medias del espectro real de la música (o simulado a partir del beat) (§14.1-2).
import { FOG, OUTPUT } from '../../shaders.js';
import { ZONES } from '../../../../training/levels.js';

const INNER = 30;          // distancia lateral de la primera fila (40 en horizontal: deja libre la columna del HUD)
const PILLAR_LEN = 15;     // largo objetivo de cada columna (u)

const VERT = /* glsl */ `
attribute vec4 aTime;   // t0, t1, índice de tramo, lado (±1)
attribute vec4 aShape;  // altura, grosor X, desplazamiento X, semilla
attribute vec3 aColor;
uniform float uSkyT, uK, uGrow, uMirror, uT, uSeg, uBeat, uPulse, uFinale, uWaveT, uWaveW, uTotal, uRow, uInner;
uniform sampler2D uSpec;
varying vec3 vL;
varying float vVu;
varying vec3 vN;
varying vec3 vColor;
varying vec3 vSize;
varying float vInt;
varying float vDist;
varying float vWy;
varying float vCur;
void main() {
  float t0 = aTime.x, t1 = aTime.y;
  float zc = -(((t0 + t1) * 0.5) - uSkyT) * uK;
  float len = max(0.5, (t1 - t0) * uK * 0.72);
  // crecimiento escalonado al aparecer
  float ahead = clamp((t0 - uT) / max(uTotal, 1.0), 0.0, 1.0);
  float grow = clamp(uGrow * 1.8 - ahead * 0.8, 0.0, 1.0);
  grow = grow * grow * (3.0 - 2.0 * grow);
  float h = aShape.x * max(grow, 0.001);

  float past = step(t1, uT + 0.01);
  float cur = 1.0 - step(0.5, abs(aTime.z - uSeg));
  float inten = mix(0.62, 0.1, past);
  inten = mix(inten, 0.95 + uBeat * uPulse * 0.45, cur);
  // final: la ola reenciende toda la clase
  float relit = step(t0, uWaveT);
  inten = mix(inten, 1.35, uFinale * relit);
  inten += uFinale * 2.2 * exp(-abs(t0 - uWaveT) / max(uWaveW, 1.0));
  // salto del beat en el tramo actual
  h *= 1.0 + cur * uBeat * uPulse * 0.04;

  vec3 p = position; // caja [-0.5,0.5], base en y=0 tras el desplazamiento
  vL = p;
  vN = normal;
  vSize = vec3(aShape.y, h, len);
  vec3 w;
  w.x = aTime.w * (uInner + aShape.z + aShape.y * 0.5) + p.x * aShape.y;
  // vúmetro: banda de medios (bins 5..40 de 64) según la semilla de la torre
  float bin = (5.0 + floor(aShape.w * 35.0) + 0.5) / 64.0;
  vVu = texture2D(uSpec, vec2(bin, 0.5)).r;
  w.y = (p.y + 0.5) * h;
  w.z = zc + p.z * len;
  vWy = w.y;
  if (uMirror > 0.5) w.y = -w.y;
  vColor = aColor;
  vInt = inten;
  vCur = cur;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uFogDensity, uMirror, uTime, uBeat, uRowDim, uVuOn;
uniform vec3 uFog;
varying float vVu;
varying vec3 vL;
varying vec3 vN;
varying vec3 vColor;
varying vec3 vSize;
varying float vInt;
varying float vDist;
varying float vWy;
varying float vCur;
${FOG}
void main() {
  // distancia a las aristas de la cara visible (en unidades del mundo)
  vec2 q;
  vec2 sz;
  if (abs(vN.x) > 0.5) { q = vL.zy; sz = vSize.zy; }
  else if (abs(vN.z) > 0.5) { q = vL.xy; sz = vSize.xy; }
  else { q = vL.xz; sz = vSize.xz; }
  vec2 e = (0.5 - abs(q)) * sz;
  float ed = max(min(e.x, e.y), 0.0); // con MSAA las varyings se extrapolan fuera de la cara
  float edge = exp(-ed * 3.2);
  float yN = clamp(vWy / max(vSize.y, 0.001), 0.0, 1.0);
  // franjas LED horizontales finas (como las barras de un ecualizador) + aristas y remate
  float band = fract(vWy / 2.2);
  float led = smoothstep(0.0, 0.08, band) * (1.0 - smoothstep(0.32, 0.4, band));
  float side = abs(vN.y) < 0.5 ? 1.0 : 0.0;
  // vúmetro: las franjas por debajo del nivel se encienden; por encima quedan tenues
  float vu = smoothstep(vVu * 1.08 + 0.02, vVu * 1.08 - 0.02, yN);
  float fill = led * side * mix(0.18 + 0.7 * yN * yN, 0.1 + 1.1 * vu * (0.4 + 0.6 * yN), uVuOn);
  float top = vN.y > 0.5 ? 1.0 : 0.0;
  vec3 c = vColor;
  vec3 body = c * 0.018 + uFog * 0.05;
  vec3 emis = c * (fill * 0.8 + edge * 1.3 + top * 0.8) + mix(c, vec3(1.0), 0.4) * exp(-(1.0 - yN) * vSize.y * 1.4) * 0.6 * side;
  emis += mix(c, vec3(1.0), 0.5) * vCur * exp(-abs(fract(uTime * 0.5) - yN) * 18.0) * 0.7;
  vec3 col = body + emis * vInt * uRowDim;
  float f = fogAmount(vDist, 0.0021 * uFogDensity);
  col = mix(col, uFog, f);
  if (uMirror > 0.5) {
    col = emis * vInt * uRowDim * 0.55 * exp(-max(vWy, 0.0) * 0.045) * (1.0 - f);
  }
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}`;

export function createSkyline(THREE, tl, shared) {
  const group = new THREE.Group();
  const total = Math.max(60, tl.totalSec);
  const L = Math.min(3200, Math.max(1300, total * 1.25));
  const K = L / total; // u por segundo de clase
  const vmin = tl.minSpeed;
  const vmax = Math.max(vmin + 0.5, tl.maxSpeed);
  const hFor = (v) => 6 + Math.pow((v - vmin) / (vmax - vmin), 1.2) * 50;

  const rows = 2; // la 2.ª fila y los reflejos se ocultan según la calidad del momento
  const items = [];
  for (let i = 0; i < tl.n; i++) {
    const sec = tl.secs[i];
    const m = Math.max(1, Math.round((sec * K) / PILLAR_LEN));
    for (let j = 0; j < m; j++) {
      const t0 = tl.starts[i] + (sec * j) / m;
      const t1 = tl.starts[i] + (sec * (j + 1)) / m;
      for (const side of [-1, 1]) items.push({ i, t0, t1, side, j });
    }
  }

  const color = new THREE.Color();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const layers = [];

  for (let row = 0; row < rows; row++) {
    const n = items.length;
    const aTime = new Float32Array(n * 4);
    const aShape = new Float32Array(n * 4);
    const aColor = new Float32Array(n * 3);
    items.forEach((it, k) => {
      const seed = ((it.i * 73.13 + it.j * 19.7 + (it.side > 0 ? 5.3 : 0) + row * 11.1) % 1 + 1) % 1;
      aTime[k * 4] = it.t0;
      aTime[k * 4 + 1] = it.t1;
      aTime[k * 4 + 2] = it.i;
      aTime[k * 4 + 3] = it.side;
      const h = hFor(tl.speeds[it.i]) * (row ? 1.35 : 1);
      aShape[k * 4] = h;
      aShape[k * 4 + 1] = row ? 14 : 6.5 + (it.j % 2) * 2.5;
      aShape[k * 4 + 2] = row ? 20 + seed * 8 : (it.j % 3) * 1.4;
      aShape[k * 4 + 3] = seed;
      color.set(ZONES[tl.zones[it.i]]?.color || '#ffffff');
      aColor[k * 3] = color.r; aColor[k * 3 + 1] = color.g; aColor[k * 3 + 2] = color.b;
    });
    const geo = new THREE.InstancedBufferGeometry().copy(box);
    geo.setAttribute('aTime', new THREE.InstancedBufferAttribute(aTime, 4));
    geo.setAttribute('aShape', new THREE.InstancedBufferAttribute(aShape, 4));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3));
    geo.instanceCount = n;

    for (const mirror of [0, 1]) {
      const uniforms = {
        uSkyT: { value: 0 }, uK: { value: K }, uGrow: { value: 0 }, uMirror: { value: mirror }, uT: { value: 0 },
        uSeg: { value: 0 }, uBeat: { value: 0 }, uPulse: { value: 0 }, uFinale: { value: 0 }, uWaveT: { value: -1e4 },
        uWaveW: { value: total * 0.03 }, uTotal: { value: total }, uRow: { value: row }, uFogDensity: { value: 1 },
        uTime: { value: 0 }, uRowDim: { value: row ? 0.45 : 1 }, uFog: { value: new THREE.Color() },
        uInner: { value: INNER }, uSpec: shared.uSpec, uVuOn: { value: 1 },
      };
      // Torres opacas (sin acumulación aditiva). El reflejo se pinta antes del suelo, que es "agua" translúcida lejos de la pista.
      const mat = mirror
        ? new THREE.ShaderMaterial({
          uniforms, vertexShader: VERT, fragmentShader: FRAG,
          blending: THREE.AdditiveBlending, transparent: false, depthWrite: false, depthTest: false, side: THREE.BackSide,
        })
        : new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = mirror ? -950 : 0;
      group.add(mesh);
      layers.push({ mesh, uniforms, geo, row, mirror });
    }
  }
  box.dispose();

  return {
    object: group,
    K,
    length: L,
    update(F) {
      const m = F.mood;
      for (const l of layers) {
        l.mesh.visible = (l.row === 0 || F.quality >= 2) && (!l.mirror || F.quality >= 1);
        if (!l.mesh.visible) continue;
        const u = l.uniforms;
        u.uSkyT.value = F.skyT;
        u.uGrow.value = F.intro;
        u.uT.value = F.localT;
        u.uSeg.value = F.segIndex;
        u.uBeat.value = F.beat;
        u.uPulse.value = m.pulse;
        u.uFinale.value = F.finale;
        u.uWaveT.value = F.waveT;
        u.uFogDensity.value = m.fogDensity * F.fogMul;
        u.uTime.value = F.time;
        u.uFog.value.copy(m.fog);
        u.uInner.value = F.aspect > 1.25 ? INNER + 10 : INNER;
        u.uVuOn.value = F.reduced ? 0.5 : 1;
      }
    },
    dispose() {
      const seen = new Set();
      for (const l of layers) {
        if (!seen.has(l.geo)) { seen.add(l.geo); l.geo.dispose(); }
        l.mesh.material.dispose();
      }
    },
  };
}
