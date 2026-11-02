// RITMUP · escenario TÚNEL (realista). Un tubo de metal cepillado, de paneles con sus juntas, con anillos de luz cada
// 14 m del color del tramo que iluminan de verdad las paredes y el suelo pulido (luces analíticas con la BRDF física:
// cada anillo deja su brillo especular en el suelo), dos líneas de luz blanca a lo largo del techo y marcas en el suelo
// cada 7 m. Al fondo, la salida: un resplandor suave del color del tramo. Pensado para series y pirámides: sin efecto
// warp ni destellos (§15.2); la velocidad se lee en los anillos y las juntas que pasan.
// A VELOCIDAD REAL: juntas, anillos y marcas avanzan a km/h ÷ 3,6 m/s.
import { createRunner, scrollZ } from './kit/runner.js';
import { worldUrl, loadTex, envFrom, glowMaterial, halos, addLamps, setInstances } from './kit/world.js';

export const meta = {
  id: 'tunel',
  name: 'Túnel',
  description: 'Un tubo de metal con anillos de luz del color de tu tramo. Para series.',
};

const T = 'tunel';
const R = 4.3;          // radio del tubo
const CY = 2.7;         // altura del eje
const RING_D = 14;      // m entre anillos
const MARK_D = 7;       // m entre marcas del suelo
const SEAM_D = 3.5;     // m entre juntas transversales
const LEN = 900;

/** Juntas de paneles que avanzan con el mundo (parche de MeshStandardMaterial). */
function panelPatch(mat, uS, { floor = false } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uS = uS;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vPW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vPW;
uniform float uS;
float ph(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gSeam; float gPanel;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    float zz = vPW.z - uS;
    float fw = fwidth(zz) + 1e-4;
    float tz = abs(fract(zz / ${SEAM_D.toFixed(1)}) - 0.5) * ${SEAM_D.toFixed(1)};
    ${floor
    ? `float lat = vPW.x / 1.1;
    float tl = abs(fract(lat) - 0.5) * 1.1;
    vec2 pid = vec2(floor(zz / ${SEAM_D.toFixed(1)}), floor(lat));`
    : `float ang = atan(vPW.y - ${CY.toFixed(1)}, vPW.x) / (3.14159265 / 10.0);
    float tl = abs(fract(ang) - 0.5) * (3.14159265 / 10.0) * ${R.toFixed(1)};
    vec2 pid = vec2(floor(zz / ${SEAM_D.toFixed(1)}), floor(ang));`}
    gSeam = 1.0 - smoothstep(0.012, 0.02 + fw, min(${(SEAM_D / 2).toFixed(2)} - tz, tl));
    gPanel = ph(pid + 3.0);
    diffuseColor.rgb *= (0.82 + 0.3 * gPanel) * (1.0 - 0.85 * gSeam);
  }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = clamp(roughnessFactor * (0.75 + 0.5 * gPanel) + 0.5 * gSeam, 0.04, 1.0);`);
  };
  mat.customProgramCacheKey = () => (floor ? 'tunel-floor' : 'tunel-wall');
}

export async function createTheme(ctx) {
  const { THREE, root, camera, scene, renderer } = ctx;
  camera.near = 0.08;
  camera.far = 1200;
  renderer.setClearColor(0x020203, 1);
  ctx.post.set({ toneMapping: 'aces', exposure: 0.9, bloomStrength: 0.5, bloomThreshold: 0.88, bloomRadius: 0.32, vignette: 0.34, saturation: 1.05 });

  const envTex = await loadTex(ctx, worldUrl(T, 'env.jpg'), { srgb: true, aniso: 1 });
  const runner = createRunner(ctx, {
    exposure: 0.9,
    horizonP: 0.05,
    finale: (p, portrait) => { p.y = 4.6; p.z = 9; p.lookY = 2.2; p.lookZ = -40; p.fov = portrait ? 64 : 58; },
  });

  scene.environment = envFrom(ctx, envTex);
  scene.environmentIntensity = 0.22;
  scene.fog = new THREE.FogExp2(new THREE.Color(0.004, 0.004, 0.006), 0.011);
  root.add(new THREE.HemisphereLight(new THREE.Color(0.2, 0.22, 0.28), new THREE.Color(0.02, 0.02, 0.03), 0.08));
  const uS = { value: 0 };

  // ── tubo y suelo ──
  const tubeGeo = new THREE.CylinderGeometry(R, R, LEN, 96, 1, true);
  tubeGeo.rotateX(Math.PI / 2);
  tubeGeo.translate(0, CY, -LEN / 2 + 20);
  const wallMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.22, 0.23, 0.25), metalness: 0.85, roughness: 0.32, side: THREE.BackSide, envMapIntensity: 1 });
  panelPatch(wallMat, uS);
  const tube = new THREE.Mesh(tubeGeo, wallMat);
  tube.frustumCulled = false;
  root.add(tube);
  const halfW = Math.sqrt(R * R - CY * CY);
  const floorGeo = new THREE.PlaneGeometry(2 * halfW, LEN).rotateX(-Math.PI / 2).translate(0, 0, -LEN / 2 + 20);
  const floorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.05, 0.052, 0.058), metalness: 0.3, roughness: 0.16, envMapIntensity: 1 });
  panelPatch(floorMat, uS, { floor: true });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.frustumCulled = false;
  root.add(floor);

  // ── anillos de luz del color del tramo (cada 14 m) ──
  const nRing = Math.ceil(LEN * 0.7 / RING_D) + 2;
  const ringGeo = new THREE.TorusGeometry(R - 0.06, 0.05, 6, 96, Math.PI * 2);
  const ringMat = glowMaterial(ctx, runner, { tint: '#ffffff', mix: 1, power: 3.2, fogK: 0.3 });
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, nRing);
  setInstances(ctx, rings, nRing, (i, t) => { t.p.set(0, CY, 6 - i * RING_D); });
  // marcas del suelo (barras del color del tramo, cada 7 m)
  const nMark = Math.ceil(LEN * 0.7 / MARK_D) + 2;
  const marks = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.01, 0.08), glowMaterial(ctx, runner, { tint: '#ffffff', mix: 1, power: 2.5, fogK: 0.18 }), nMark);
  setInstances(ctx, marks, nMark, (i, t) => { t.p.set(0, 0.006, 6 - i * MARK_D); });
  const ringGroup = new THREE.Group();
  for (const m of [rings]) { m.frustumCulled = false; ringGroup.add(m); }
  const markGroup = new THREE.Group();
  marks.frustumCulled = false;
  markGroup.add(marks);
  root.add(ringGroup, markGroup);

  // ── líneas de luz blanca continuas a lo largo del techo y guías del suelo ──
  const strip = glowMaterial(ctx, runner, { tint: '#dfe8ff', mix: 0.12, power: 1.1, fogK: 0.3 });
  // zócalos de luz a ras de suelo (convergen bajo el número, nunca lo cruzan)
  for (const a of [-0.5, Math.PI + 0.5]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, LEN), strip);
    m.position.set(Math.cos(a) * (R - 0.04), CY + Math.sin(a) * (R - 0.04), -LEN / 2 + 20);
    m.rotation.z = a;
    root.add(m);
  }
  const guide = glowMaterial(ctx, runner, { tint: '#dfe8ff', mix: 0.0, power: 0.9, fogK: 0.2 });
  for (const x of [-1.25, 1.25]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, LEN), guide);
    m.position.set(x, 0.004, -LEN / 2 + 20);
    root.add(m);
  }
  // la salida: un resplandor lejano del color del tramo
  const exitHalo = halos(ctx, runner, 1, { tint: '#ffffff', mix: 1, size: 7, grow: 0.0, power: 0.35, fogD: 0.0006 });
  setInstances(ctx, exitHalo, 1, (i, t) => { t.p.set(0, CY, -640); });
  exitHalo.frustumCulled = false;
  root.add(exitHalo);

  // luz de los anillos sobre paredes y suelo: 4 hileras (techo, dos laterales, zócalos)
  const rowTop = new THREE.Vector4(0, CY + R - 0.15, RING_D, 0);
  const rowL = new THREE.Vector4(-R + 0.3, CY + 0.6, RING_D, 0);
  const rowR = new THREE.Vector4(R - 0.3, CY + 0.6, RING_D, 0);
  const rowLow = new THREE.Vector4(0, 0.4, RING_D, 0);
  const lampOpts = { tint: '#ffffff', mix: 1, power: 3.2, range: 14 };
  addLamps(wallMat, ctx, runner, [rowTop, rowL, rowR], lampOpts);
  addLamps(floorMat, ctx, runner, [rowTop, rowL, rowR, rowLow], { ...lampOpts, power: 2.6 });

  const inst = {
    director: { scale: 0.7, maxDown: 0.12, orbit: false },
    resize(s) { runner.resize(s); },
    update(f) {
      const st = runner.update(f);
      const S = st.S;
      uS.value = S % 840;
      ringGroup.position.z = scrollZ(S, RING_D);
      markGroup.position.z = scrollZ(S, MARK_D);
      const z0 = ringGroup.position.z + 6;
      rowTop.w = z0; rowL.w = z0; rowR.w = z0; rowLow.w = z0;
    },
    event(type, data) { runner.event(type, data); },
    get _debug() { return runner.debug(); },
    dispose() {},
  };
  return inst;
}
