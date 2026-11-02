// RITMUP · kit de los escenarios REALISTAS · el MUNDO: texturas fotográficas PBR (CC0, Poly Haven), cielos de foto
// recortados (assets/world/<escenario>/sky.jpg + sky.json), iluminación de entorno (PMREM de un panorama pequeño), luces
// del color del tramo (materiales emisivos y halos que leen WAVE_GLSL) y charcos de luz de las farolas sobre los
// materiales PBR (luces analíticas periódicas inyectadas en MeshStandardMaterial: difusa + especular reales, sin
// cientos de PointLight). Los recursos pesan y se cargan solo al elegir el escenario (fuera del precache; el service
// worker los guarda en br-world al usarlos). Créditos y licencias: assets/world/CREDITS.md.
import { WAVE_GLSL } from './runner.js';

const ROOT = new URL('../../../../../assets/world/', import.meta.url).href;

/** URL absoluta de un recurso de assets/world/<escenario>/. */
export function worldUrl(theme, file) {
  return `${ROOT}${theme}/${file}`;
}

/** Carga una textura (sRGB para color, lineal para normales/ARM). */
export function loadTex(ctx, url, { srgb = false, repeat = null, aniso = 4, flipY = true } = {}) {
  const { THREE } = ctx;
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.flipY = flipY;
      if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
      t.anisotropy = Math.min(aniso, ctx.renderer.capabilities.getMaxAnisotropy());
      t.needsUpdate = true;
      resolve(t);
    }, undefined, () => reject(new Error(`No se pudo cargar ${url}`)));
  });
}

export async function loadJson(theme, file) {
  const r = await fetch(worldUrl(theme, file));
  if (!r.ok) throw new Error(`No se pudo cargar ${file}`);
  return r.json();
}

/**
 * Juego PBR <name>_diff.jpg, <name>_nor.jpg, <name>_arm.jpg (AO, rugosidad, metal). Las tres comparten el mismo
 * Vector2 de desplazamiento (offset): moverlo desplaza el material entero (el suelo que avanza hacia ti).
 */
export async function loadSet(ctx, theme, name, repeat = [1, 1], { arm = true, aniso = 8 } = {}) {
  const off = new ctx.THREE.Vector2();
  const [map, normalMap, armMap] = await Promise.all([
    loadTex(ctx, worldUrl(theme, `${name}_diff.jpg`), { srgb: true, repeat, aniso }),
    loadTex(ctx, worldUrl(theme, `${name}_nor.jpg`), { repeat, aniso }),
    arm ? loadTex(ctx, worldUrl(theme, `${name}_arm.jpg`), { repeat, aniso }) : Promise.resolve(null),
  ]);
  for (const t of [map, normalMap, armMap]) if (t) t.offset = off;
  return { map, normalMap, arm: armMap, offset: off };
}

/** MeshStandardMaterial con un juego PBR. */
export function pbr(ctx, set, o = {}) {
  const { THREE } = ctx;
  const m = new THREE.MeshStandardMaterial({
    map: set?.map || null,
    normalMap: set?.normalMap || null,
    aoMap: set?.arm || null,
    roughnessMap: set?.arm || null,
    metalnessMap: o.metal && set?.arm ? set.arm : null,
    roughness: o.roughness ?? 1,
    metalness: o.metalness ?? 0,
    color: o.color ?? 0xffffff,
    envMapIntensity: o.env ?? 1,
    aoMapIntensity: o.ao ?? 1,
  });
  if (o.normalScale != null && m.normalMap) m.normalScale.set(o.normalScale, o.normalScale);
  return m;
}

/* ─────────────────────────────── cielo de foto ─────────────────────────────── */

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */ `
uniform sampler2D uSky;
uniform vec4 uCrop;      // x azimut mín, y azimut máx, z elevación mín, w elevación máx (rad)
uniform vec3 uHorizon, uTint;
uniform float uGain, uBelow;
uniform float uBlack;    // punto negro (lineal): el velo del panorama fuera, las estrellas destacan
uniform vec2 uGrad;      // filtro degradado (ND): x oscurecimiento arriba (0..1), y elevación donde ya es pleno (rad)
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float az = atan(d.x, -d.z);
  float el = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2((az - uCrop.x) / (uCrop.y - uCrop.x), (el - uCrop.z) / (uCrop.w - uCrop.z));
  vec3 c = texture2D(uSky, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
  c = mix(c, uHorizon, smoothstep(0.0, -uBelow, el - uCrop.z));   // bajo el recorte: el color del horizonte
  c = max(c - uBlack, 0.0) / (1.0 - uBlack);
  c *= 1.0 - uGrad.x * smoothstep(0.0, uGrad.y, el);
  gl_FragColor = vec4(c * uTint * uGain, 1.0);
}`;

/**
 * Cúpula con el cielo de foto recortado. meta = sky.json { az: [mín, máx] (°), el: [mín, máx] (°), horizon: [r,g,b] (lineal) }.
 * El azimut 0 es «al frente» (−z) y crece hacia la derecha.
 */
export function skyDome(ctx, tex, meta, { gain = 1, tint = null, grad = 0, gradEl = 0.35, black = 0 } = {}) {
  const { THREE } = ctx;
  const r = (v) => (v * Math.PI) / 180;
  const u = {
    uSky: { value: tex },
    uCrop: { value: new THREE.Vector4(r(meta.az[0]), r(meta.az[1]), r(meta.el[0]), r(meta.el[1])) },
    uHorizon: { value: new THREE.Color().setRGB(...meta.horizon) },
    uTint: { value: tint ? new THREE.Color(tint) : new THREE.Color(1, 1, 1) },
    uGain: { value: gain },
    uBelow: { value: 0.03 },
    uGrad: { value: new THREE.Vector2(grad, gradEl) },
    uBlack: { value: black },
  };
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, depthWrite: false, side: THREE.BackSide });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  mesh.name = 'sky';
  return { mesh, u };
}

/** Iluminación de entorno (PMREM) a partir de un panorama equirrectangular pequeño (frente en la columna de 90°). */
export function envFrom(ctx, tex) {
  const { THREE } = ctx;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(ctx.renderer);
  const rt = pm.fromEquirectangular(tex);
  pm.dispose();
  tex.dispose();
  return rt.texture;
}

/* ─────────────────────────────── luces del color del tramo ─────────────────────────────── */

const GLOW_VERT = /* glsl */ `
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  p = instanceMatrix * p;
  #endif
  vec4 w = modelMatrix * p;
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const GLOW_FRAG = /* glsl */ `
uniform vec3 uTint;
uniform float uMix, uPower, uFogK;
varying vec3 vW;
${WAVE_GLSL}
#include <common>
#include <fog_pars_fragment>
void main() {
  float br; vec3 zc = waveColor(-vW.z, br);
  vec3 c = mix(uTint, zc, uMix) * br * uPower;
  gl_FragColor = vec4(c, 1.0);
  #if defined(USE_FOG) && defined(FOG_EXP2)
  float fogDepth2 = vFogDepth;
  float ff = 1.0 - exp(-fogDensity * fogDensity * fogDepth2 * fogDepth2 * uFogK);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, ff);
  #endif
}`;

/** Material emisivo (bombillas, captafaros, tiras LED, anillos): color del tramo con la cadena. */
export function glowMaterial(ctx, runner, { tint = '#ffffff', mix = 1, power = 4, fogK = 0.35 } = {}) {
  const { THREE } = ctx;
  return withWave(new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTint: { value: new THREE.Color(tint) }, uMix: { value: mix }, uPower: { value: power }, uFogK: { value: fogK } },
    vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, fog: true,
  }), runner);
}

function withWave(mat, runner) {
  Object.assign(mat.uniforms, runner.u);
  return mat;
}

const HALO_VERT = /* glsl */ `
attribute vec2 aCorner;
uniform float uSize, uGrow;
varying vec2 vUv;
varying vec3 vCol;
varying float vK;
uniform vec3 uTint;
uniform float uMix, uFogD;
${WAVE_GLSL}
void main() {
  vec4 c = vec4(0.0, 0.0, 0.0, 1.0);
  #ifdef USE_INSTANCING
  c = instanceMatrix * c;
  #endif
  vec3 wc = (modelMatrix * c).xyz;
  float br; vec3 zc = waveColor(-wc.z, br);
  vCol = mix(uTint, zc, uMix) * br;
  float dist = length(wc - cameraPosition);
  float rad = uSize * (1.0 + dist * uGrow);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = wc + (right * aCorner.x + up * aCorner.y) * rad;
  float fx = dist * uFogD;
  vK = smoothstep(1.5, 6.0, dist) * exp(-fx * fx);
  vUv = aCorner;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const HALO_FRAG = /* glsl */ `
uniform float uPower;
varying vec2 vUv;
varying vec3 vCol;
varying float vK;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float g = exp(-r2 * 6.0) * (1.0 - r2) + 0.4 * exp(-r2 * 40.0);
  gl_FragColor = vec4(vCol * g * vK * uPower, 1.0);
}`;

/**
 * Halos aditivos (la luz en el aire húmedo) para n puntos: InstancedMesh cuyas matrices dan el centro de cada luz.
 * size (m de radio cerca), grow (crecimiento con la distancia: la hilera se sigue leyendo a lo lejos).
 */
export function halos(ctx, runner, n, { tint = '#ffffff', mix = 1, size = 0.5, grow = 0.01, power = 1, fogD = 0.004 } = {}) {
  const { THREE } = ctx;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const mat = withWave(new THREE.ShaderMaterial({
    uniforms: {
      uTint: { value: new THREE.Color(tint) }, uMix: { value: mix }, uSize: { value: size }, uGrow: { value: grow },
      uPower: { value: power }, uFogD: { value: fogD },
    },
    vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), runner);
  const mesh = new THREE.InstancedMesh(g, mat, n);
  mesh.frustumCulled = false;
  mesh.renderOrder = 30;
  return mesh;
}

/* ─────────────────────── charcos de luz de las farolas sobre PBR ─────────────────────── */

/**
 * Inyecta en un MeshStandardMaterial hasta 4 HILERAS de luces puntuales periódicas (farolas, balizas): cada hilera es
 * vec4(x, y, D separación, zOff) con luces en z = zOff − k·D. Se evalúan las 2 más cercanas de cada hilera con la BRDF
 * física de three.js (difusa + especular: lo mojado brilla de verdad). Color = mezcla de tint y del color del tramo
 * con la cadena. rows: THREE.Vector4[] (el escenario actualiza zOff cada fotograma).
 */
export function addLamps(mat, ctx, runner, rows, { tint = '#ffd9a8', mix = 0.6, power = 6, range = 14 } = {}) {
  const { THREE } = ctx;
  const n = rows.length;
  const uni = {
    uLampRows: { value: rows },
    uLampTint: { value: new THREE.Color(tint) },
    uLampMix: { value: mix },
    uLampPower: { value: power },
    uLampRange: { value: range },
  };
  mat.userData.lamps = uni;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, uni, runner.u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLampW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec4 lw = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
    lw = instanceMatrix * lw;
    #endif
    vLampW = (modelMatrix * lw).xyz;
  }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLampW;
uniform vec4 uLampRows[${n}];
uniform vec3 uLampTint;
uniform float uLampMix, uLampPower, uLampRange;
${WAVE_GLSL}`)
      .replace('#include <lights_fragment_end>', `
  for (int r = 0; r < ${n}; r++) {
    vec4 R = uLampRows[r];
    float kf = floor((R.w - vLampW.z) / R.z);
    for (int j = 0; j < 2; j++) {
      float zk = R.w - (kf + float(j)) * R.z;
      vec3 lp = (viewMatrix * vec4(R.x, R.y, zk, 1.0)).xyz;
      vec3 lv = lp - geometryPosition;
      float ld = length(lv);
      float lbr; vec3 lzc = waveColor(-zk, lbr);
      IncidentLight il;
      il.direction = lv / max(ld, 1e-3);
      il.color = mix(uLampTint, lzc, uLampMix) * lbr * uLampPower * getDistanceAttenuation(ld, uLampRange, 2.0);
      il.visible = true;
      RE_Direct(il, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    }
  }
#include <lights_fragment_end>`);
  };
  mat.customProgramCacheKey = () => `lamps${n}`;
  mat.needsUpdate = true;
  return uni;
}

/* ─────────────────────── utilidades de geometría ─────────────────────── */

/** Matrices de instancias: fn(i, m: Matrix4, tmp) para cada i. */
export function setInstances(ctx, mesh, n, fn) {
  const { THREE } = ctx;
  const m = new THREE.Matrix4();
  const tmp = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1), e: new THREE.Euler() };
  for (let i = 0; i < n; i++) {
    tmp.p.set(0, 0, 0); tmp.q.identity(); tmp.s.set(1, 1, 1); tmp.e.set(0, 0, 0);
    fn(i, tmp);
    tmp.q.setFromEuler(tmp.e);
    m.compose(tmp.p, tmp.q, tmp.s);
    mesh.setMatrixAt(i, m);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere?.();
}
