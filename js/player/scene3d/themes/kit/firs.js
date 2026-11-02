// RITMUP · kit de los escenarios REALISTAS · ABETOS. Árbol de unidad (altura 1) hecho de tarjetas de rama con
// ramitas fotográficas reales (atlas branch.webp recortado del abeto CC0 de Poly Haven) en verticilos que se acortan
// hacia la copa y caen un poco, con tronco de corteza. Dos InstancedMesh (follaje con recorte alfa + tronco) que
// comparten las matrices de instancia. Variante nevada: la cara de arriba de cada rama se cubre de nieve.

/** Geometría de un abeto de altura 1 (follaje y tronco). */
export function firGeometry(THREE, seed = 1) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pos = []; const nor = []; const uv = [];
  const v = new THREE.Vector3(); const n = new THREE.Vector3();
  const axis = new THREE.Vector3(); const side = new THREE.Vector3(); const up = new THREE.Vector3(0, 1, 0);
  const quad = (o, dir, wv, L, W, cell) => {
    // tarjeta: de o (en el tronco) a o + dir·L, ancho W a lo largo de wv
    const cu = (cell % 2) * 0.5; const cv = cell < 2 ? 0.5 : 0;
    const p = [
      [0, -0.5], [1, -0.5], [1, 0.5], [0, 0.5],
    ].map(([a, b]) => v.copy(o).addScaledVector(dir, a * L).addScaledVector(wv, b * W).toArray());
    const uvq = [[cu + 0.004, cv + 0.02], [cu + 0.49, cv + 0.02], [cu + 0.49, cv + 0.48], [cu + 0.004, cv + 0.48]];
    // normal suave: hacia fuera del tronco y hacia arriba (luz de copa, no de tarjeta plana)
    n.copy(dir).setY(0).normalize().multiplyScalar(0.8).add(up).normalize();
    for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...p[k]); nor.push(n.x, n.y, n.z); uv.push(...uvq[k]); }
  };
  const whorls = 15 + Math.floor(rnd() * 5);
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1);
    const y = 0.16 + 0.82 * Math.pow(t, 0.92);
    const L = 0.03 + 0.25 * Math.pow(1 - t, 0.95);
    const nb = 5 + Math.floor(rnd() * 3);
    const a0 = rnd() * Math.PI * 2;
    for (let b = 0; b < nb; b++) {
      const az = a0 + (b / nb) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
      const droop = -0.15 - 0.35 * rnd() * (1 - t * 0.5);
      axis.set(Math.cos(az), droop, Math.sin(az)).normalize();
      side.set(-Math.sin(az), 0, Math.cos(az));
      const o = new THREE.Vector3(0, y + (rnd() - 0.5) * 0.02, 0);
      const ll = L * (0.8 + 0.4 * rnd());
      const cell = Math.floor(rnd() * 4);
      // tarjeta casi horizontal + otra cruzada (volumen visto de lado)
      const roll = (rnd() - 0.5) * 0.6;
      const w1 = side.clone().applyAxisAngle(axis, roll);
      quad(o, axis, w1, ll, ll * 0.95, cell);
      const w2 = side.clone().applyAxisAngle(axis, roll + Math.PI / 2).multiplyScalar(0.7);
      quad(o, axis, w2, ll * 0.9, ll * 0.7, (cell + 1) % 4);
    }
  }
  // copa: un par de tarjetas verticales en la punta
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI / 2;
    const o = new THREE.Vector3(0, 0.9, 0);
    quad(o, new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), 0.12, 0.08, k);
  }
  const fol = new THREE.BufferGeometry();
  fol.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fol.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  fol.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const trunk = new THREE.CylinderGeometry(0.004, 0.02, 1, 7, 1, true).translate(0, 0.5, 0);
  // la corteza se repite a lo largo del tronco
  const tuv = trunk.attributes.uv;
  for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) * 2, tuv.getY(i) * 12);
  return { foliage: fol, trunk };
}

/**
 * Bosque instanciado. place(i, t) coloca cada árbol (t.p, t.s = altura en x/y/z, t.e). Devuelve { foliage, trunk,
 * group } (group = los dos InstancedMesh). snow: 0..1 nieve sobre las ramas.
 */
export function createFirs(ctx, { branchTex, barkTex, count, place, snow = 0, tint = null, seed = 3 }) {
  const { THREE } = ctx;
  const g = firGeometry(THREE, seed);
  branchTex.colorSpace = THREE.SRGBColorSpace;
  const fMat = new THREE.MeshStandardMaterial({
    map: branchTex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.88, metalness: 0,
    color: tint || new THREE.Color(0.85, 0.9, 0.85), envMapIntensity: 0.7,
  });
  if (snow > 0) {
    fMat.onBeforeCompile = (sh) => {
      sh.uniforms.uSnow = { value: snow };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vUp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vUp = normal.y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vUp;\nuniform float uSnow;')
        .replace('#include <map_fragment>', `#include <map_fragment>
  {
    float n = fract(sin(dot(floor(vMapUv * 64.0), vec2(12.9898, 78.233))) * 43758.5453);
    float k = uSnow * smoothstep(0.55, 0.95, vUp + 0.25 * n) * (gl_FrontFacing ? 1.0 : 0.35);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.86, 0.95), k);
  }`);
    };
    fMat.customProgramCacheKey = () => 'fir-snow';
  }
  barkTex.wrapS = THREE.RepeatWrapping; barkTex.wrapT = THREE.RepeatWrapping;
  barkTex.colorSpace = THREE.SRGBColorSpace;
  const tMat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.95, color: new THREE.Color(0.75, 0.7, 0.66) });
  const foliage = new THREE.InstancedMesh(g.foliage, fMat, count);
  const trunk = new THREE.InstancedMesh(g.trunk, tMat, count);
  const m = new THREE.Matrix4();
  const t = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), e: new THREE.Euler() };
  for (let i = 0; i < count; i++) {
    t.p.set(0, 0, 0); t.s.set(1, 1, 1); t.e.set(0, 0, 0);
    place(i, t);
    t.q.setFromEuler(t.e);
    m.compose(t.p, t.q, t.s);
    foliage.setMatrixAt(i, m);
    trunk.setMatrixAt(i, m);
  }
  foliage.frustumCulled = false;
  trunk.frustumCulled = false;
  const group = new THREE.Group();
  group.add(trunk, foliage);
  return { foliage, trunk, group, tris: (g.foliage.attributes.position.count / 3) * count };
}
