// ESTADIO DE NOCHE · capa del MODO RETRANSMISIÓN (beta, Perfil › Pantalla de entreno › Laboratorio). Sobre el Estadio de
// siempre (misma lógica de clase, test VAM, rótulos, plano final): madrugada con lluvia como en la pieza «Última
// vuelta» (tools/estadio-bake/). Lo que cambia:
//  · cubierta a altura constante y curva lisa; 275 proyectores 3D (carcasa + lente + resplandor) en 55 baterías que se
//    encienden por sectores con la cuenta atrás (el «encendido» del tema), con un haz estrecho cada uno;
//  · luz HORNEADA en Blender por batería (assets/world/estadio-noche/), así cada batería ilumina su zona al encenderse;
//  · pista y arcén mojados con reflejo del estadio (pase espejo a 1/3), charcos y anillos de gotas; lluvia; niebla baja
//    que se oscurece sin luz; nubes iluminadas desde abajo; arco de meta con pantalla LED (logo oficial y crono).
// Calidad baja / eco: sin reflejo ni haces y menos lluvia. Movimiento reducido: sin lluvia ni anillos. Sin red: no se
// aplica (el Estadio de siempre). Nada de audio ni de <video>.
import { BANK_VERT, BANK_FRAG } from './shaders.js';
import { GROUND_BOX, standBands, standUV, faceLengths, standsGeometry, catwalkGeometry } from './noche-geo.js';
import { createArch } from './noche-arco.js';
import { worldUrl } from '../kit/world.js';

const RL = 5;   // capa del pase de reflejo
export const NIGHT_KEY = 'ritmup.retransmision';
/** ¿Modo retransmisión activado? (mismo interruptor que el marcador de televisión del reproductor). */
export function nightOn() {
  try { return localStorage.getItem(NIGHT_KEY) === 'on'; } catch { return false; }
}

const FX_GLSL = /* glsl */ `
uniform vec4 uSecT;   // segundos desde que arrancó cada batería (negativo: apagada)
uniform float uPunch; // golpe de luz (los del tema: escalón, tu VAM, final)
float fxOn(vec3 fx) {
  float T = fx.x < 0.5 ? uSecT.x : fx.x < 1.5 ? uSecT.y : fx.x < 2.5 ? uSecT.z : uSecT.w;
  float d = T - (fx.y * 1.1 + fx.z * 0.16);
  if (d < 0.0) return 0.0;
  float k = smoothstep(0.0, 0.045, d) * (1.0 + 1.1 * exp(-d * 5.0));
  if (fx.z > 0.9 && d < 0.65) k *= step(0.4, fract(sin(floor(d * 22.0) * 91.7 + fx.z * 311.0) * 43758.5));
  return k * (1.0 + uPunch);
}`;
const BASIS = /* glsl */ `
mat3 basisOf(vec3 d) {
  vec3 z = normalize(d);
  vec3 c = cross(vec3(0.0, 1.0, 0.0), z);
  vec3 x = c / max(length(c), 1e-5);
  vec3 y = cross(z, x);
  return mat3(x, y, z);
}`;
const FOGX = 'float fx = dist * uFogD * (uFogBase + (uFogMul - 1.0) * exp(-max(0.5 * (cameraPosition.y + vW.y), 0.0) / 28.0));';
const secPow = (T) => (T <= 0 ? 0 : Math.min(1, T / 1.2) * (1 + 0.5 * Math.exp(-T * 3)));

function loadTex(THREE, url, mips) {
  return new Promise((res, rej) => new THREE.TextureLoader().load(url, (t) => {
    t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = mips;
    t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4; t.needsUpdate = true; res(t);
  }, undefined, rej));
}

/**
 * Aplica la noche al Estadio ya construido. parts: { world, ground, stands, lights, sky } (los de estadio.js).
 * Devuelve { update(f, info) } o lanza si faltan los recursos (entonces el tema sigue como siempre).
 */
export async function createNight(ctx, parts) {
  const { THREE, renderer, camera } = ctx;
  const { world, ground, stands, lights, sky } = parts;
  const q = ctx.qualityLevel ?? 2;
  const hi = q >= 2 && ctx.quality !== 'eco';
  const url = (f) => worldUrl('estadio-noche', f);
  const [meta, fxs, gA, gB, sA, sB] = await Promise.all([
    fetch(url('meta.json')).then((r) => r.json()), fetch(url('focos.json')).then((r) => r.json()),
    loadTex(THREE, url('suelo-a.png'), true), loadTex(THREE, url('suelo-b.png'), true),
    loadTex(THREE, url('gradas-a.png'), false), loadTex(THREE, url('gradas-b.png'), false),
  ]);

  const U = {
    uSecT: { value: new THREE.Vector4(-1, -1, -1, -1) },
    uSecPow: { value: new THREE.Vector4(0, 0, 0, 0) },
    uAmb: { value: 0.045 },
    uTime: { value: 0 },
    uLightAll: { value: 0 },
    uFogMul: { value: 1.9 },
    uFogBase: { value: 1 },
    uFlash: { value: 0 },
    uPunch: { value: 0 },
    uWetK: { value: 1 },
    uRefl: { value: null }, uReflMat: { value: new THREE.Matrix4() },
  };
  const LM_GLSL = /* glsl */ `
uniform sampler2D uLmA, uLmB;
uniform float uLmK, uAmb;
uniform vec4 uSecPow;
float lmLight(vec2 uv) {
  vec3 a = texture2D(uLmA, uv).rgb;
  vec3 b = texture2D(uLmB, uv).rgb;
  vec4 L = uLmK * pow(vec4(a, b.r), vec4(2.2));
  return (dot(L, uSecPow) + uAmb) * mix(1.0, b.g, 0.5);
}`;

  // ── suelo: luz horneada, agua, niebla baja ──
  const gm = ground.mesh.material;
  const GU = gm.uniforms;
  Object.assign(GU, U, { uLmA: { value: gA }, uLmB: { value: gB }, uLmK: { value: meta.K } });
  GU.uLmBox = { value: new THREE.Vector4(GROUND_BOX.x0, GROUND_BOX.z0, GROUND_BOX.x1 - GROUND_BOX.x0, GROUND_BOX.z1 - GROUND_BOX.z0) };
  let fs = gm.fragmentShader;
  const rep = (s, a, b) => { if (!s.includes(a)) throw new Error(`noche: no encuentro «${a.slice(0, 40)}»`); return s.replace(a, b); };
  fs = rep(fs, 'varying vec3 vW;', `varying vec3 vW;\nuniform vec4 uLmBox;\nuniform sampler2D uRefl;\nuniform mat4 uReflMat;\nuniform float uWetK, uFogMul, uFogBase, uTime, uLightAll;\n${LM_GLSL}`);
  fs = rep(fs, 'vec3 base = mix(synth, grass, grassM);', 'vec3 base = mix(synth, grass * mix(1.0, 0.5, uWetK), grassM);');
  fs = rep(fs, 'col *= uLight;\n  vec3 V', `
  float lmL = lmLight(clamp((p - uLmBox.xy) / uLmBox.zw, 0.0, 1.0));
  col *= lmL * uLight;
  vec3 V`);
  fs = rep(fs, 'col += uSpecCol * spec * fres * uSpec * gloss;', 'col += uSpecCol * spec * fres * uSpec * gloss * clamp(lmL, 0.0, 1.6) * uLightAll;');
  fs = rep(fs, 'col += uEnv * fres * gloss * uLight;', 'col += uEnv * fres * gloss * uLightAll;');
  fs = rep(fs, 'col += uEnvFx * (0.25 + fres) * gloss;', `col += uEnvFx * (0.25 + fres) * gloss;
  if (uWetK > 0.001) {
    float puddle = smoothstep(0.48, 0.64, big + 0.3 * (n1 - 0.5)) * (1.0 - grassM) * (1.0 - 0.6 * dArea);
    float wetR = uWetK * (1.0 - grassM) * mix(0.45, 1.0, puddle);
    vec3 Nw = normalize(mix(Ng, vec3(0.0, 1.0, 0.0), 0.35 + 0.6 * puddle));
    if (near > 0.01) {
      vec2 rp = p / 0.4;
      vec2 ci = floor(rp);
      vec2 rf = fract(rp) - 0.5;
      float hh = hash12(ci);
      float ph = fract(uTime * (0.7 + 0.8 * hh) + hh * 7.0);
      vec2 cc = (vec2(hash12(ci + 1.3), hash12(ci + 2.7)) - 0.5) * 0.5;
      vec2 dv = rf - cc;
      float dd = length(dv);
      float ring = exp(-pow((dd - ph * 0.42) / 0.02, 2.0)) * (1.0 - ph) * (1.0 - ph);
      Nw = normalize(Nw + vec3(dv.x, 0.0, dv.y) / max(dd, 1e-3) * ring * 0.32 * near * (0.15 + 0.85 * puddle));
    }
    vec4 rc = uReflMat * vec4(vW, 1.0);
    vec2 ruv = clamp(rc.xy / max(rc.w, 1e-3) + Nw.xz * mix(0.05, 0.01, puddle), 0.001, 0.999);
    float horizonK = smoothstep(1e-3, 0.02, rc.w);
    float rgh = mix(1.0, 0.25, puddle) * mix(1.6, 0.6, smoothstep(4.0, 40.0, dist));
    float st = 0.03 * rgh;
    float lb = 1.4 + 2.4 * rgh;
    vec3 refl = vec3(0.0);
    for (int i = 0; i < 6; i++) refl += texture2D(uRefl, ruv + vec2(0.0, (float(i) - 2.5) * st), lb).rgb * (1.0 - abs(float(i) - 2.5) * 0.22);
    refl /= 4.35;
    refl = (refl.r == refl.r && refl.g == refl.g && refl.b == refl.b) ? min(refl, vec3(30.0)) : vec3(0.0);
    float fw = 0.02 + 0.98 * pow(1.0 - clamp(dot(V, Nw), 0.0, 1.0), 5.0);
    col *= 1.0 - 0.35 * wetR * puddle;
    col += refl * fw * wetR * mix(0.55, 1.0, puddle) * horizonK;
  }`);
  fs = rep(fs, 'float fx = dist * uFogD;', FOGX);
  fs = rep(fs, 'col += em * fade;\n  gl_FragColor = vec4(col, 1.0);', 'col += em * fade;\n  col = (col.r == col.r && col.g == col.g && col.b == col.b) ? clamp(col, 0.0, 60.0) : vec3(0.0);\n  gl_FragColor = vec4(col, 1.0);');
  gm.fragmentShader = fs;
  gm.needsUpdate = true;

  // ── gradas: cubierta lisa + luz horneada ──
  const sg = standsGeometry(THREE).geometry;
  const info = sg.attributes.aInfo.array;
  let lap = 0;
  for (let i = 3; i < info.length; i += 4) lap = Math.max(lap, info[i]);
  sg.setAttribute('uv', new THREE.BufferAttribute(standUV(info, lap, standBands(faceLengths(info))), 2));
  stands.mesh.geometry = sg;
  const sm = stands.mesh.material;
  const SU = sm.uniforms;
  Object.assign(SU, U, { uLmA: { value: sA }, uLmB: { value: sB }, uLmK: { value: meta.K } });
  sm.vertexShader = rep(rep(sm.vertexShader, 'varying vec3 vW;', 'varying vec3 vW;\nvarying vec2 vLm;'), 'vInfo = aInfo;', 'vInfo = aInfo; vLm = uv;');
  let sfs = sm.fragmentShader;
  sfs = rep(sfs, 'varying vec3 vW;', `varying vec3 vW;\nvarying vec2 vLm;\nuniform float uFogMul, uFogBase, uLightAll;\n${LM_GLSL}`);
  sfs = rep(sfs, 'col *= uLight;\n  float fx = dist * uFogD;', `float lmS = mix(lmLight(vLm), uLightAll + uAmb, 0.45);\n  col *= uLight * clamp(lmS, 0.0, 3.0);\n  ${FOGX}`);
  sfs = rep(sfs, 'col += (em * uLight + crowd)', 'col += (em * uLight * clamp(lmS, 0.0, 1.5) + crowd)');
  sm.fragmentShader = sfs;
  sm.needsUpdate = true;

  // ── niebla y cielo cubierto ──
  const fogBase = new THREE.Color().setRGB(0.05, 0.047, 0.043);
  const ku = sky.mesh.material.uniforms;
  ku.uSkyK.value.x = 0; ku.uStars.value = 0;
  Object.assign(ku, { uTime: U.uTime, uLightAll: U.uLightAll, uFlash: U.uFlash, uFogC: { value: fogBase.clone() } });
  sky.mesh.material.fragmentShader = rep(rep(sky.mesh.material.fragmentShader, 'varying vec2 vNdc;', `varying vec2 vNdc;\nuniform float uTime, uLightAll, uFlash;\nuniform vec3 uFogC;
float cHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float cNoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), f.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), f.x), f.y); }
float cFbm(vec2 p){ float a = 0.5; float s = 0.0; for (int i = 0; i < 5; i++) { s += a * cNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }`),
  'gl_FragColor = vec4(col, 1.0);\n}', `
  {
    float elc = max(dir.y, 0.02);
    vec2 cp = dir.xz / elc * 0.9 + vec2(uTime * 0.035, uTime * 0.012);
    float cl = cFbm(cp * 0.55);
    float dense = smoothstep(0.3, 0.85, cl);
    float under = exp(-max(el, 0.0) * 2.6);
    vec3 lit = uFogC * (0.35 + 1.6 * uLightAll) * (0.5 + 1.2 * under);
    vec3 cityGlow = vec3(0.012, 0.010, 0.008) * under;
    col = mix(uFogC * 0.18 + cityGlow, lit, dense) * (0.65 + 0.35 * under) + cityGlow;
    col = mix(col, uFogC * (0.5 + 1.1 * uLightAll), exp(-max(el, 0.0) * 9.0));
  }
  gl_FragColor = vec4(col, 1.0);
}`);
  sky.mesh.material.needsUpdate = true;

  // ── proyectores: lámpara + resplandor por batería (shader de las baterías con el encendido por sectores) ──
  lights.mesh.visible = false;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const NI = fxs.length * 2;
  const aPos = new Float32Array(NI * 3); const aNrm = new Float32Array(NI * 3); const aRnd = new Float32Array(NI * 4); const aFx = new Float32Array(NI * 3);
  const seeds = fxs.map(() => rnd());
  const secN = [0, 0, 0, 0];
  fxs.forEach((f, i) => {
    secN[f.s]++;
    for (let k = 0; k < 2; k++) {
      const j = i * 2 + k;
      aPos[j * 3] = f.p[0] + f.n[0] * 0.25; aPos[j * 3 + 1] = f.p[1] + f.n[1] * 0.25; aPos[j * 3 + 2] = f.p[2] + f.n[2] * 0.25;
      aNrm.set(f.n, j * 3);
      aRnd[j * 4] = k ? 1.6 : 0.22; aRnd[j * 4 + 1] = k ? (f.m ? f.b * 1.7 : 0) : f.b; aRnd[j * 4 + 2] = 0.3 + 0.4 * seeds[i]; aRnd[j * 4 + 3] = i;
      aFx[j * 3] = f.s; aFx[j * 3 + 1] = f.o; aFx[j * 3 + 2] = seeds[i];
    }
  });
  const lg = new THREE.InstancedBufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  lg.setIndex([0, 1, 2, 0, 2, 3]);
  lg.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
  lg.setAttribute('aNrm', new THREE.InstancedBufferAttribute(aNrm, 3));
  lg.setAttribute('aRnd', new THREE.InstancedBufferAttribute(aRnd, 4));
  lg.setAttribute('aFx', new THREE.InstancedBufferAttribute(aFx, 3));
  lg.instanceCount = NI;
  const LU = {
    uGlow: { value: new THREE.Vector3(1.8, 0.01, 0.0011) }, uDim: { value: new THREE.Vector4(1, 1, 1, 0) },
    uAvoid: { value: new THREE.Vector4(9, 9, 9, 9) }, uAvoid2: { value: new THREE.Vector4(9, 9, 9, 9) },
    uAir: { value: new THREE.Vector2(0.75, 0.05) }, uWarm: { value: new THREE.Color(1.0, 0.92, 0.8) }, uCool: { value: new THREE.Color(0.9, 0.95, 1.0) },
    uSecT: U.uSecT, uPunch: U.uPunch, uReflPass: { value: 0 },
  };
  const lampVert = BANK_VERT.replace('uniform vec4 uDim;', `attribute vec3 aFx;\n${FX_GLSL}\nuniform vec4 uDim;`)
    .replace(/vI \*= mix\(0\.04, 1\.0, smoothstep\(0\.0, 0\.3, uDim\.z \* 1\.3 - fract\(aRnd\.w \* 0\.6180339\)\)\);/, 'vI *= fxOn(aFx);');
  if (!lampVert.includes('fxOn(aFx)')) throw new Error('noche: no pude parchear el encendido de las baterías');
  const lmat = new THREE.ShaderMaterial({
    uniforms: LU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: lampVert,
    fragmentShader: rep(rep(rep(BANK_FRAG, 'uniform vec3 uWarm, uCool;', 'uniform vec3 uWarm, uCool;\nuniform float uReflPass;'),
      'if (r2 > 1.0 || vI < 0.002) discard;', 'if (r2 > 1.0 || vI < 0.002 || (uReflPass > 0.5 && vK < 0.5)) discard;'),
    'a *= vI;', 'a *= vI * (1.0 + 1.5 * uReflPass);'),
  });
  const lamps = new THREE.Mesh(lg, lmat);
  lamps.frustumCulled = false; lamps.renderOrder = 20; lamps.layers.enable(RL);
  world.add(lamps);

  // ── carcasas y pasarela ──
  const box = new THREE.BoxGeometry(0.66, 0.5, 0.42);
  const hg = new THREE.InstancedBufferGeometry();
  hg.index = box.index;
  hg.setAttribute('position', box.attributes.position);
  hg.setAttribute('normal', box.attributes.normal);
  const hPos = new Float32Array(fxs.length * 3); const hNrm = new Float32Array(fxs.length * 3); const hFx = new Float32Array(fxs.length * 3);
  fxs.forEach((f, i) => { hPos.set(f.p, i * 3); hNrm.set(f.n, i * 3); hFx[i * 3] = f.s; hFx[i * 3 + 1] = f.o; hFx[i * 3 + 2] = seeds[i]; });
  hg.setAttribute('aPos', new THREE.InstancedBufferAttribute(hPos, 3));
  hg.setAttribute('aDir', new THREE.InstancedBufferAttribute(hNrm, 3));
  hg.setAttribute('aFx', new THREE.InstancedBufferAttribute(hFx, 3));
  hg.instanceCount = fxs.length;
  const housing = new THREE.Mesh(hg, new THREE.ShaderMaterial({
    uniforms: { uSecT: U.uSecT, uPunch: U.uPunch, uFog: SU.uFog, uFogD: SU.uFogD, uFogMul: U.uFogMul, uFogBase: U.uFogBase, uLightAll: U.uLightAll },
    vertexShader: /* glsl */ `
attribute vec3 aPos, aDir, aFx;
${FX_GLSL}
${BASIS}
varying vec3 vN; varying vec3 vL; varying vec3 vW; varying float vOn;
void main() {
  mat3 B = basisOf(aDir);
  vec4 w = modelMatrix * vec4(aPos + B * position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * (B * normal)); vL = position; vOn = fxOn(aFx);
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uFog; uniform float uFogD, uFogMul, uFogBase, uLightAll;
varying vec3 vN; varying vec3 vL; varying vec3 vW; varying float vOn;
void main() {
  float dist = length(vW - cameraPosition);
  vec3 col = vec3(0.016, 0.017, 0.019) * (0.4 + 1.6 * uLightAll * (0.5 + 0.5 * max(-vN.y, 0.0)));
  float lens = step(0.2, vL.z) * (1.0 - smoothstep(0.26, 0.31, abs(vL.x))) * (1.0 - smoothstep(0.19, 0.24, abs(vL.y)));
  col += vec3(1.0, 0.94, 0.84) * lens * vOn * 6.0;
  col += vec3(0.02) * step(0.2, vL.z) * (1.0 - lens);
  ${FOGX}
  col = mix(col, uFog, (1.0 - exp(-fx * fx)) * (1.0 - lens * vOn));
  gl_FragColor = vec4(col, 1.0);
}`,
  }));
  housing.frustumCulled = false;
  world.add(housing);
  const walk = new THREE.Mesh(catwalkGeometry(THREE), new THREE.ShaderMaterial({
    uniforms: { uFog: SU.uFog, uFogD: SU.uFogD, uFogMul: U.uFogMul, uFogBase: U.uFogBase, uLightAll: U.uLightAll },
    vertexShader: 'varying vec3 vW; varying vec3 vN; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 uFog; uniform float uFogD, uFogMul, uFogBase, uLightAll; varying vec3 vW; varying vec3 vN;
void main(){ float dist = length(vW - cameraPosition); vec3 col = vec3(0.012) * (0.5 + 2.0 * uLightAll * max(-vN.y, 0.2)); ${FOGX} col = mix(col, uFog, 1.0 - exp(-fx*fx)); gl_FragColor = vec4(col,1.0); }`,
    side: THREE.DoubleSide,
  }));
  walk.frustumCulled = false;
  world.add(walk);

  // ── haces (solo calidad alta) ──
  let beamsMesh = null;
  if (hi) {
    const cone = new THREE.CylinderGeometry(1, 1, 1, 10, 6, true);
    cone.translate(0, -0.5, 0);
    const bg = new THREE.InstancedBufferGeometry();
    bg.index = cone.index;
    bg.setAttribute('position', cone.attributes.position);
    bg.setAttribute('normal', cone.attributes.normal);
    bg.setAttribute('aPos', new THREE.InstancedBufferAttribute(hPos, 3));
    bg.setAttribute('aDir', new THREE.InstancedBufferAttribute(hNrm, 3));
    bg.setAttribute('aFx', new THREE.InstancedBufferAttribute(hFx, 3));
    bg.instanceCount = fxs.length;
    const beams = new THREE.Mesh(bg, new THREE.ShaderMaterial({
      uniforms: { uSecT: U.uSecT, uPunch: U.uPunch, uTime: U.uTime, uBeam: { value: new THREE.Vector2(0.011, 0.16) } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
attribute vec3 aPos, aDir, aFx;
uniform vec2 uBeam;
${FX_GLSL}
${BASIS}
varying float vT; varying float vI; varying vec3 vN; varying vec3 vWp;
void main() {
  mat3 B = basisOf(aDir);
  float len = (aPos.y - 1.0) / max(-normalize(aDir).y, 0.2);
  float t = -position.y;
  float rad = 0.35 + t * len * uBeam.y;
  vec4 w = modelMatrix * vec4(aPos + B * vec3(position.x * rad, position.z * rad, t * len), 1.0);
  vWp = w.xyz; vN = normalize(mat3(modelMatrix) * (B * vec3(normal.x, normal.z, 0.0))); vT = t; vI = min(fxOn(aFx), 1.6);
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
      fragmentShader: /* glsl */ `
uniform vec2 uBeam; uniform float uTime;
varying float vT; varying float vI; varying vec3 vN; varying vec3 vWp;
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn3(vec3 x) { vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
void main() {
  if (vI < 0.01) discard;
  vec3 Vd = normalize(cameraPosition - vWp);
  float thick = pow(abs(dot(normalize(vN), Vd)), 2.5);
  float vt = clamp(vT, 0.0, 1.0);
  float along = smoothstep(0.0, 0.04, vt) * pow(1.0 - vt, 1.2) * (1.0 - smoothstep(0.5, 0.92, vt)) * smoothstep(2.0, 9.0, vWp.y);
  float mist = 0.45 + 1.1 * vn3(vWp * 0.09 + vec3(uTime * 0.6, -uTime * 0.25, uTime * 0.3));
  float near = smoothstep(3.0, 18.0, length(cameraPosition - vWp));
  float a = thick * along * mist * near * vI * uBeam.x;
  if (!(a > 1e-5)) discard;
  gl_FragColor = vec4(vec3(1.0, 0.95, 0.86) * min(a, 4.0), 1.0);
}`,
    }));
    beams.frustumCulled = false; beams.renderOrder = 19; beams.layers.enable(RL);
    world.add(beams);
    beamsMesh = beams;
  }

  // ── lluvia (movimiento reducido: sin lluvia) ──
  const RU = {
    uTime: U.uTime, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(34, 26, 34) },
    uVel: { value: new THREE.Vector3(1.2, -8.5, 0.6) }, uRain: { value: 1 }, uLightAll: U.uLightAll, uAmbR: { value: 0.12 },
  };
  let rain = null;
  if (!ctx.reducedMotion) {
    const ND = hi ? 8000 : 3500;
    const rq = new THREE.InstancedBufferGeometry();
    rq.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
    rq.setIndex([0, 1, 2, 0, 2, 3]);
    const rs = new Float32Array(ND * 4);
    for (let i = 0; i < ND * 4; i++) rs[i] = rnd();
    rq.setAttribute('aSeed', new THREE.InstancedBufferAttribute(rs, 4));
    rq.instanceCount = ND;
    rain = new THREE.Mesh(rq, new THREE.ShaderMaterial({
      uniforms: RU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uRain, uLightAll, uAmbR;
uniform vec3 uCam, uBox, uVel;
varying float vA; varying float vX; varying float vY;
void main() {
  vec3 v = uVel * (0.85 + 0.3 * aSeed.w);
  vec3 p = aSeed.xyz * uBox + v * uTime;
  p = uCam + mod(p - uCam + 0.5 * uBox, uBox) - 0.5 * uBox;
  if (p.y < 0.0) p.y += uBox.y;
  vec3 a = (viewMatrix * modelMatrix * vec4(p, 1.0)).xyz;
  vec3 b = (viewMatrix * modelMatrix * vec4(p - v * (0.018 + 0.03 * aSeed.w), 1.0)).xyz;
  if (a.z > -0.35 || b.z > -0.35) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; vX = 0.0; vY = 0.0; return; }
  vec3 cr = cross(b - a, a);
  vec3 side = cr / max(length(cr), 1e-6) * max(0.0018, 0.0009 * length(a));
  gl_Position = projectionMatrix * vec4(mix(a, b, position.y) + side * position.x * 2.0, 1.0);
  float d = length(a);
  vX = position.x * 2.0; vY = position.y;
  vec3 vd = normalize(a);
  float back = smoothstep(-0.1, 0.6, (inverse(mat3(viewMatrix)) * vd).y);
  vA = uRain * smoothstep(1.2, 3.5, d) * (1.0 - smoothstep(8.0, 22.0, d)) * (uAmbR + uLightAll * (0.45 + 1.2 * back)) * (0.4 + 0.6 * aSeed.w);
}`,
      fragmentShader: /* glsl */ `
varying float vA; varying float vX; varying float vY;
void main() {
  float a = min(vA * (1.0 - vX * vX) * sin(3.14159 * vY) * 0.13, 2.0);
  if (!(a > 1e-4)) discard;
  gl_FragColor = vec4(vec3(0.85, 0.88, 0.92) * a, 1.0);
}`,
    }));
    rain.frustumCulled = false; rain.renderOrder = 30;
    world.add(rain);
  }

  // ── arco de meta en la línea de meta (pantalla: logo oficial y el tiempo de la clase) ──
  let arch = null;
  try { arch = await createArch(THREE, world, U, { uFog: SU.uFog, uFogD: SU.uFogD }, RL); } catch { arch = null; }

  // ── reflejo (solo calidad alta) ──
  for (const m of [stands.mesh, sky.mesh]) m.layers.enable(RL);
  let rt = null;
  if (hi) {
    const vcam = new THREE.PerspectiveCamera();
    vcam.layers.set(RL);
    rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    U.uRefl.value = rt.texture;
    const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    const rot = new THREE.Matrix4(); const cp = new THREE.Vector3(); const lk = new THREE.Vector3(); const sz = new THREE.Vector2();
    const keepW = new THREE.Matrix4(); const keepI = new THREE.Matrix4();
    let busy = false;
    ground.mesh.onBeforeRender = (r, sc2, cam) => {
      if (busy || cam === vcam || !U.uWetK.value || (ctx.qualityLevel ?? 2) < 2) return;   // (si la app baja la calidad, sin espejo)
      busy = true;
      try {
        const prev = r.getRenderTarget();
        if (prev) sz.set(prev.width, prev.height); else r.getDrawingBufferSize(sz);
        const rw = Math.max(64, Math.round(sz.x * 0.34)); const rh = Math.max(64, Math.round(sz.y * 0.34));
        if (rt.width !== rw || rt.height !== rh) rt.setSize(rw, rh);
        cp.setFromMatrixPosition(cam.matrixWorld);
        rot.extractRotation(cam.matrixWorld);
        lk.set(0, 0, -1).applyMatrix4(rot).add(cp);
        vcam.position.set(cp.x, -cp.y, cp.z);
        vcam.up.set(0, 1, 0).applyMatrix4(rot); vcam.up.y = -vcam.up.y;
        vcam.lookAt(lk.x, -lk.y, lk.z);
        vcam.near = cam.near; vcam.far = cam.far;
        vcam.updateMatrixWorld();
        vcam.projectionMatrix.copy(cam.projectionMatrix); vcam.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
        U.uReflMat.value.copy(bias).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);
        const skyCam = ku.uCamWorld.value;
        ku.uCamWorld.value = vcam.matrixWorld;
        LU.uReflPass.value = 1;
        keepW.copy(cam.matrixWorld); keepI.copy(cam.matrixWorldInverse);
        const ac = r.autoClear;
        r.autoClear = true; r.setRenderTarget(rt); r.clear(); r.render(sc2, vcam); r.setRenderTarget(prev); r.autoClear = ac;
        cam.matrixWorld.copy(keepW); cam.matrixWorldInverse.copy(keepI);
        ku.uCamWorld.value = skyCam; LU.uReflPass.value = 0;
      } finally { busy = false; }
    };
  } else {
    U.uWetK.value = 0.35;   // sin reflejo: la pista sigue mojada (brillo), sin el espejo
  }

  // ── por fotograma: encendido por sectores atado al encendido del tema ──
  const TH = [0.04, 0.14, 0.24, 0.36];   // umbrales del «encendido» del tema: tres baterías en la cuenta atrás, la cuarta al arrancar
  const ORDER = [0, 1, 2, 3];
  const secStart = [null, null, null, null];
  const camW = new THREE.Vector3();
  let first = true;
  return {
    get fogBase() { return fogBase; },
    update(f, { power = 1, punch = 0, clock = '' } = {}) {
      const t = f.time;
      U.uTime.value = t;
      // la app baja la calidad sola si el teléfono va justo: sin espejo ni haces (la pista sigue mojada)
      const full = (ctx.qualityLevel ?? 2) >= 2 && ctx.quality !== 'eco';
      U.uWetK.value = rt ? (full ? 1 : 0) : 0.35;   // (con el espejo parado, nada de reflejo congelado)
      if (beamsMesh) beamsMesh.visible = full;
      for (let k = 0; k < 4; k++) {
        const s = ORDER[k];
        if (power >= TH[k]) { if (secStart[s] == null) secStart[s] = first ? t - 10 : t; } else if (power < TH[k] - 0.08) secStart[s] = null;
      }
      first = false;
      const st = secStart.map((v) => (v == null ? -1 : t - v));
      U.uSecT.value.set(st[0], st[1], st[2], st[3]);
      U.uPunch.value = Math.min(1.5, punch * 0.6);
      const pk = 1 + 0.4 * U.uPunch.value;
      U.uSecPow.value.set(secPow(st[0]) * pk, secPow(st[1]) * pk, secPow(st[2]) * pk, secPow(st[3]) * pk);
      U.uLightAll.value = Math.min(1, (secPow(st[0]) * secN[0] + secPow(st[1]) * secN[1] + secPow(st[2]) * secN[2] + secPow(st[3]) * secN[3]) / fxs.length);
      // final: el aire se abre un poco (el óvalo se lee desde arriba)
      U.uFogBase.value = 1 - 0.45 * (f.finale ? Math.min(1, f.finale) : 0);
      const fk = 0.1 + 0.9 * U.uLightAll.value;
      GU.uFog.value.copy(fogBase).multiplyScalar(fk); SU.uFog.value.copy(fogBase).multiplyScalar(fk); ku.uFogC.value.copy(fogBase);
      // la lluvia acompaña a la cámara (espacio del estadio)
      if (rain) { camera.getWorldPosition(camW); world.worldToLocal(camW); RU.uCam.value.copy(camW); }
      if (arch) arch.update(t, 1e9, 0, clock);
    },
    dispose() { rt?.dispose(); },
  };
}
