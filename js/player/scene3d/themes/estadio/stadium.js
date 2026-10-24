// ESTADIO · construcción del estadio: suelo (un único plano con shader), anillo de gradas + vallas + cubierta (una
// malla extruida a lo largo del contorno), baterías de focos bajo la cubierta (rectángulos de lámparas instanciados,
// con halo suave) y cielo. Todo en el espacio del estadio (ver track.js). Pocas llamadas de dibujo: cielo 1 · suelo 1 ·
// gradas 1 · focos 1.
import { A, R0, WALL, ROOF_EDGE, ROOF_Y, outline } from './track.js';
import {
  TRACK_DEFINES, SKY_VERT, SKY_FRAG, GROUND_VERT, GROUND_FRAG, STAND_VERT, STAND_FRAG, BANK_VERT, BANK_FRAG,
} from './shaders.js';

/**
 * Perfil de la grada (d desde el bordillo, y). Cada par consecutivo es una cara; el índice de la cara llega al shader.
 * 0 muro de vallas · 1 pasillo · 2 contrahuella · 3 graderío inferior · 4 frente del anfiteatro · 5 graderío superior ·
 * 6 muro trasero · 7 intradós de la cubierta · 8 canto de la cubierta · 9 cubierta (vista desde arriba en el final).
 */
const PROFILE = [
  [[WALL, 0], [WALL, 1.1]],
  [[WALL, 1.1], [WALL + 1.1, 1.1]],
  [[WALL + 1.1, 1.1], [WALL + 1.1, 2.3]],
  [[WALL + 1.1, 2.3], [WALL + 24.5, 16.2]],
  [[WALL + 24.5, 16.2], [WALL + 25.1, 18.6]],
  [[WALL + 25.1, 18.6], [WALL + 46, 31.5]],
  [[WALL + 46, 31.5], [WALL + 46, 43.6]],
  [[WALL + 46, 43.6], [ROOF_EDGE, ROOF_Y + 1.2]],
  [[ROOF_EDGE, ROOF_Y + 1.2], [ROOF_EDGE, ROOF_Y + 3.4]],
  [[ROOF_EDGE, ROOF_Y + 3.4], [WALL + 46, 45.4]],
];

/** Color en lineal (los literales de shader también son lineales). */
export const lin = (THREE, r, g, b) => new THREE.Color().setRGB(r, g, b);

export function buildSky(THREE, camera) {
  const u = {
    uProjInv: { value: camera.projectionMatrixInverse },
    uCamWorld: { value: camera.matrixWorld },
    uTop: { value: lin(THREE, 0.0006, 0.0008, 0.0014) },
    uHaze: { value: lin(THREE, 0.006, 0.0066, 0.0085) },
    uGlow: { value: lin(THREE, 0.046, 0.047, 0.056) },
    uHazeK: { value: 1 },
  };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: u, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, depthWrite: false }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000; // el último de los opacos: solo pinta lo que nada tapa
  return { mesh, u };
}

export function buildGround(THREE, noiseChunk) {
  const gateArr = [];
  const gateCol = [];
  for (let i = 0; i < 3; i++) { gateArr.push(new THREE.Vector4(0, 0, 0, 0)); gateCol.push(new THREE.Color()); }
  const banks = [];
  for (let i = 0; i < 6; i++) banks.push(new THREE.Vector4(0, 40, 0, 0));
  const u = {
    uTrack: { value: lin(THREE, 0.036, 0.037, 0.041) },
    uGrass: { value: lin(THREE, 0.012, 0.0175, 0.0128) },
    uApron: { value: lin(THREE, 0.026, 0.027, 0.03) },
    uPaint: { value: lin(THREE, 0.4, 0.41, 0.43) },
    uFog: { value: lin(THREE, 0.014, 0.0145, 0.016) },
    uCur: { value: new THREE.Color() },
    uSweepCol: { value: new THREE.Color() },
    uSweepFrom: { value: new THREE.Color() },
    uGold: { value: new THREE.Color('#ffd60a') },
    uSpecCol: { value: new THREE.Color('#fff4e6') },
    uEnv: { value: lin(THREE, 0.03, 0.03, 0.032) },
    uSigCam: { value: 0 }, uFogD: { value: 0.0042 }, uLight: { value: 1 }, uSpec: { value: 0.22 }, uMotion: { value: 0 },
    uRailBase: { value: 0.06 }, uApproach: { value: 0 }, uGoldK: { value: 0 }, uDetail: { value: 1 }, uPaintK: { value: 0.82 },
    uGate: { value: gateArr }, uGateCol: { value: gateCol },
    uPacer: { value: new THREE.Vector4(10, 6, 0, 0) },
    uGhost: { value: new THREE.Vector4(-100, 5, 0, 0) },
    uSweep: { value: new THREE.Vector4(0, 0, 8, 0) },
    uMarks: { value: new THREE.Vector4(1e5, 1e5, 1e5, 1e5) },
    uMarkK: { value: new THREE.Vector4(0, 0, 0, 0) },
    uMoment: { value: new THREE.Vector4(1e5, 0, 1e5, 0) },
    uBank: { value: banks },
    uLaneCam: { value: new THREE.Vector2(1.22, 2.44) },
    uFeel: { value: new THREE.Vector2(1, 2.5) },
  };
  // plano único en XZ (espacio del estadio): cubre el interior hasta bajo las gradas
  const geo = new THREE.PlaneGeometry(2 * (A + R0 + WALL + 60), 2 * (R0 + WALL + 60), 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG.replace('NOISE_CHUNK', noiseChunk), defines: TRACK_DEFINES,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, u };
}

/** Anillo de gradas: extrusión del perfil a lo largo del contorno del estadio. */
/** Cubierta en silla de montar: más baja en las rectas y más alta en los fondos (los focos quedan sobre el HUD). */
export const ROOF_SIDE = 30;
export const ROOF_END = 46;
const BASE_Y = 2.3;
export function saddleY(y, endness) {
  if (y <= BASE_Y) return y;
  const target = ROOF_SIDE + (ROOF_END - ROOF_SIDE) * endness;
  return BASE_Y + (y - BASE_Y) * ((target - BASE_Y) / (ROOF_Y - BASE_Y));
}

export function buildStands(THREE, noiseChunk, specTex) {
  const NB = 30;
  const ref = outline(WALL, NB);
  const n = ref.length;
  const faces = PROFILE.length;
  const pos = new Float32Array(faces * n * 2 * 3);
  const info = new Float32Array(faces * n * 2 * 4);
  const idx = [];
  let vi = 0;
  for (let fI = 0; fI < faces; fI++) {
    const [[d0, y0], [d1, y1]] = PROFILE[fI];
    const len = Math.hypot(d1 - d0, y1 - y0);
    const o0 = outline(d0, NB);
    const o1 = outline(d1, NB);
    const start = vi;
    for (let j = 0; j < n; j++) {
      const uArc = ref[j].u; // arco del muro: el patrón (asientos, vallas) no se deforma con la profundidad
      for (let side = 0; side < 2; side++) {
        const o = side ? o1[j] : o0[j];
        pos[vi * 3] = o.x; pos[vi * 3 + 1] = saddleY(side ? y1 : y0, Math.pow(Math.abs(o.nx), 1.5)); pos[vi * 3 + 2] = o.z;
        info[vi * 4] = fI; info[vi * 4 + 1] = side; info[vi * 4 + 2] = len; info[vi * 4 + 3] = uArc;
        vi++;
      }
    }
    for (let j = 0; j < n - 1; j++) {
      const a = start + j * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  geo.setIndex(idx);
  const u = {
    uFog: { value: lin(THREE, 0.014, 0.0145, 0.016) },
    uBoardCol: { value: new THREE.Color('#e8ecf5') },
    uAccent: { value: new THREE.Color() },
    uFascia: { value: lin(THREE, 0.03, 0.031, 0.034) },
    uRim: { value: lin(THREE, 0.058, 0.058, 0.064) },
    uFogD: { value: 0.0042 }, uLight: { value: 1 }, uEq: { value: 1 }, uBoardK: { value: 0.35 }, uDetail: { value: 1 },
    uSweepB: { value: new THREE.Vector4(0, 0, 10, ref[n - 1].u) },
    uSpecTex: { value: specTex },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: STAND_VERT, fragmentShader: STAND_FRAG.replace('NOISE_CHUNK', noiseChunk), side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, u, lap: ref[n - 1].u };
}

/**
 * Baterías de focos bajo el canto de la cubierta, como en los estadios modernos: rectángulos de 4,8 × 1,2 m con una
 * rejilla de lámparas (6 × 2), inclinadas 32° hacia el campo, cada 16 m; la altura sigue la cubierta en silla de
 * montar. Una sola llamada de dibujo (instanciadas). Devuelve también 6 baterías para el reflejo de la pista.
 */
export function buildLights(THREE, rand) {
  const d = ROOF_EDGE - 0.8;
  const ol = outline(d, 60);
  const banks = [];
  const STEP = 16;
  let next = 5;
  for (let i = 0; i < ol.length - 1; i++) {
    const a = ol[i];
    const b = ol[i + 1];
    const L = b.u - a.u;
    while (next < b.u) {
      const t = (next - a.u) / L;
      const nx = a.nx + (b.nx - a.nx) * t;
      const nz = a.nz + (b.nz - a.nz) * t;
      const nl = Math.hypot(nx, nz) || 1;
      banks.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, nx: nx / nl, nz: nz / nl, tx: nz / nl, tz: -nx / nl, en: Math.pow(Math.abs(nx / nl), 1.5), u: next });
      next += STEP;
    }
  }
  for (const b of banks) b.y = saddleY(ROOF_Y, b.en) - 0.6;
  const count = banks.length;
  const aPos = new Float32Array(count * 3);
  const aTan = new Float32Array(count * 3);
  const aNrm = new Float32Array(count * 3);
  const aRnd = new Float32Array(count * 4);
  const tilt = (32 * Math.PI) / 180;
  banks.forEach((b, i) => {
    aPos[i * 3] = b.x; aPos[i * 3 + 1] = b.y; aPos[i * 3 + 2] = b.z;
    aTan[i * 3] = b.tx; aTan[i * 3 + 1] = 0; aTan[i * 3 + 2] = b.tz;
    // mira hacia el campo (−normal del contorno) e inclinada hacia abajo
    aNrm[i * 3] = -b.nx * Math.cos(tilt); aNrm[i * 3 + 1] = -Math.sin(tilt); aNrm[i * 3 + 2] = -b.nz * Math.cos(tilt);
    aRnd[i * 4] = 1;
    aRnd[i * 4 + 1] = 0.9 + 0.2 * rand();
    aRnd[i * 4 + 2] = 0.35 + 0.4 * rand();
    aRnd[i * 4 + 3] = i;
  });
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
  geo.setAttribute('aTan', new THREE.InstancedBufferAttribute(aTan, 3));
  geo.setAttribute('aNrm', new THREE.InstancedBufferAttribute(aNrm, 3));
  geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(aRnd, 4));
  geo.instanceCount = count;
  const u = {
    uSize: { value: new THREE.Vector2(2.4, 0.6) },
    uMargin: { value: 2.2 },
    uCell: { value: 0.8 },
    uHalo: { value: 1.3 },
    uDim: { value: new THREE.Vector4(1, 1, 0, 0) },
    uAvoid: { value: new THREE.Vector4(2, 2, 2, 2) },
    uWarm: { value: new THREE.Color(1.0, 0.9, 0.78) },
    uCool: { value: new THREE.Color(0.86, 0.92, 1.0) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: BANK_VERT, fragmentShader: BANK_FRAG, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  // 6 baterías representativas (rectas y fondos) para el reflejo satinado de la pista
  const pick = (u0) => banks.reduce((best, b) => (Math.abs(b.u - u0) < Math.abs(best.u - u0) ? b : best), banks[0]);
  const lap = ol[ol.length - 1].u;
  const specBanks = [0.12, 0.25, 0.37, 0.62, 0.75, 0.87].map((f) => pick(f * lap));
  return { mesh, u, count, specBanks };
}
