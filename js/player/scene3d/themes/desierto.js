// RITMUP · escenario DESIERTO (realista). Una carretera recta que cruza el desierto de noche bajo la Vía Láctea real
// (panorama CC0 de Poly Haven sin luna). Asfalto con sus marcas, arena con su rizado a los lados, mesetas lejanas en
// silueta y piedras sueltas. La luz la ponen los captafaros de los hitos (cada 25 m a cada lado) y los ojos de gato
// de la línea central (cada 12 m), del color del tramo con el encendido en cadena, que dejan su reflejo en el asfalto
// y la arena. El más sereno y oscuro: el número del HUD queda sobre el cielo estrellado.
// A VELOCIDAD REAL: asfalto, arena, hitos, piedras y mesetas avanzan a km/h ÷ 3,6 m/s.
import { createRunner, scrollZ } from './kit/runner.js';
import { worldUrl, loadTex, loadJson, loadSet, pbr, skyDome, envFrom, glowMaterial, halos, addLamps, setInstances } from './kit/world.js';

export const meta = {
  id: 'desierto',
  name: 'Desierto',
  description: 'Una carretera recta bajo la Vía Láctea, con los captafaros del color de tu tramo.',
};

const T = 'desierto';
const POST_D = 25;      // m entre hitos (por lado; al tresbolillo)
const EYE_D = 12;       // m entre ojos de gato
const ROAD_W = 3.6;     // semiancho del asfalto
const ROAD_TILE = 4;    // m por repetición del asfalto
const SAND_TILE = 9;
const AHEAD = 520;
const ROCK_P = 240;     // periodo del patrón de piedras (m)
const MESA_P = 6000;    // periodo de las mesetas (m)

export async function createTheme(ctx) {
  const { THREE, root, camera, scene, renderer } = ctx;
  camera.near = 0.08;
  camera.far = 5000;
  renderer.setClearColor(0x020306, 1);
  ctx.post.set({ toneMapping: 'aces', exposure: 1, bloomStrength: 0.48, bloomThreshold: 0.88, bloomRadius: 0.34, vignette: 0.32, saturation: 1.02 });

  const [skyMeta, skyTex, envTex, road, sand] = await Promise.all([
    loadJson(T, 'sky.json'),
    loadTex(ctx, worldUrl(T, 'sky.jpg'), { srgb: true, aniso: 1 }),
    loadTex(ctx, worldUrl(T, 'env.jpg'), { srgb: true, aniso: 1 }),
    loadSet(ctx, T, 'road', [2 * ROAD_W / ROAD_TILE, 900 / ROAD_TILE]),
    loadSet(ctx, T, 'sand', [200 / SAND_TILE, 900 / SAND_TILE]),
  ]);

  const runner = createRunner(ctx, {
    exposure: 1,
    finale: (p, portrait) => { p.y = portrait ? 9 : 7; p.z = portrait ? 7 : 6; p.lookY = 0; p.lookZ = -60; p.fov = portrait ? 60 : 56; },
  });

  // ── cielo, entorno, luz de las estrellas ──
  const sky = skyDome(ctx, skyTex, skyMeta, { gain: 0.7, grad: 0.1, gradEl: 0.6, black: 0.09, tint: new THREE.Color(0.92, 0.95, 1.08) });
  root.add(sky.mesh);
  scene.environment = envFrom(ctx, envTex);
  scene.environmentIntensity = 0.55;
  const hor = new THREE.Color().setRGB(...skyMeta.horizon).multiplyScalar(0.3);
  scene.fog = new THREE.FogExp2(hor, 0.0011);
  const moon = new THREE.DirectionalLight(new THREE.Color(0.55, 0.62, 0.85), 0.22);
  moon.position.set(0.5, 0.6, -1).multiplyScalar(100);
  root.add(moon, moon.target);
  root.add(new THREE.HemisphereLight(new THREE.Color(0.2, 0.22, 0.32), new THREE.Color(0.05, 0.04, 0.035), 0.35));

  // ── suelo: arena y asfalto (las texturas avanzan con el offset) ──
  const sandMat = pbr(ctx, sand, { roughness: 1, color: new THREE.Color(0.95, 0.85, 0.72) });
  const sg = new THREE.PlaneGeometry(200, 900);
  sg.rotateX(-Math.PI / 2);
  sg.translate(0, -0.03, -440);
  const sandMesh = new THREE.Mesh(sg, sandMat);
  sandMesh.frustumCulled = false;
  root.add(sandMesh);
  // más allá, una llanura que se funde con la niebla (sin textura: no se ve el patrón)
  const far = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2).translate(0, -0.06, -4000),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0.16, 0.13, 0.1), roughness: 1 }));
  far.frustumCulled = false;
  root.add(far);
  const roadMat = pbr(ctx, road, { roughness: 0.9, color: new THREE.Color(0.7, 0.7, 0.72) });
  const rg = new THREE.PlaneGeometry(2 * ROAD_W, 900);
  rg.rotateX(-Math.PI / 2);
  rg.translate(0, 0, -440);
  const roadMesh = new THREE.Mesh(rg, roadMat);
  roadMesh.frustumCulled = false;
  root.add(roadMesh);

  // marcas viales: líneas de borde continuas y discontinua central (pintura con algo de brillo)
  const paint = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.42, 0.4, 0.35), roughness: 0.55, envMapIntensity: 0.8 });
  for (const x of [-ROAD_W + 0.25, ROAD_W - 0.25]) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 900).rotateX(-Math.PI / 2), paint);
    l.position.set(x, 0.006, -440);
    l.frustumCulled = false;
    root.add(l);
  }
  const DASH_D = 12;
  const nDash = Math.ceil((AHEAD + 20) / DASH_D) + 2;
  const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.13, 4).rotateX(-Math.PI / 2), paint, nDash);
  setInstances(ctx, dashes, nDash, (i, t) => { t.p.set(0, 0.007, 8 - i * DASH_D); });
  dashes.frustumCulled = false;
  const dashGroup = new THREE.Group();
  dashGroup.add(dashes);
  root.add(dashGroup);

  // ojos de gato junto a la discontinua (pequeños prismas con el color del tramo)
  const nEye = nDash;
  const eyeGeo = new THREE.BoxGeometry(0.1, 0.025, 0.06);
  const eyes = new THREE.InstancedMesh(eyeGeo, glowMaterial(ctx, runner, { tint: '#ffffff', mix: 0.9, power: 6, fogK: 0.2 }), nEye);
  const eyeHalo = halos(ctx, runner, nEye, { tint: '#ffffff', mix: 0.9, size: 0.12, grow: 0.0045, power: 0.6, fogD: 0.0012 });
  setInstances(ctx, eyes, nEye, (i, t) => { t.p.set(0, 0.015, 8 - i * EYE_D - 4); });
  setInstances(ctx, eyeHalo, nEye, (i, t) => { t.p.set(0, 0.05, 8 - i * EYE_D - 4); });
  const eyeGroup = new THREE.Group();
  for (const m of [eyes, eyeHalo]) { m.frustumCulled = false; eyeGroup.add(m); }
  root.add(eyeGroup);

  // ── hitos con captafaro (cada 25 m por lado, al tresbolillo) ──
  const nPost = (Math.ceil((AHEAD + 30) / POST_D) + 2) * 2;
  const PX = ROAD_W + 1.1;
  const postGeo = new THREE.BoxGeometry(0.12, 1.05, 0.06);
  postGeo.translate(0, 0.525, 0);
  const postMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.72, 0.72, 0.7), roughness: 0.6 });
  const posts = new THREE.InstancedMesh(postGeo, postMat, nPost);
  const capGeo = new THREE.BoxGeometry(0.1, 0.16, 0.065).translate(0, 0.88, 0);
  const caps = new THREE.InstancedMesh(capGeo, glowMaterial(ctx, runner, { tint: '#ffb35c', mix: 0.92, power: 5, fogK: 0.18 }), nPost);
  const capHalo = halos(ctx, runner, nPost, { tint: '#ffb35c', mix: 0.92, size: 0.32, grow: 0.006, power: 0.65, fogD: 0.001 });
  const postPos = (i, t) => { const side = i % 2 ? 1 : -1; const k = Math.floor(i / 2); t.p.set(side * PX, 0, 10 - k * POST_D - (side > 0 ? POST_D / 2 : 0)); };
  setInstances(ctx, posts, nPost, postPos);
  setInstances(ctx, caps, nPost, postPos);
  setInstances(ctx, capHalo, nPost, (i, t) => { postPos(i, t); t.p.y = 0.88; t.p.z += 0.04; });
  const postGroup = new THREE.Group();
  for (const m of [posts, caps, capHalo]) { m.frustumCulled = false; postGroup.add(m); }
  root.add(postGroup);

  // reflejo de los captafaros y ojos de gato en el asfalto y la arena (luces analíticas periódicas)
  const rowL = new THREE.Vector4(-PX, 0.9, POST_D, 0);
  const rowR = new THREE.Vector4(PX, 0.9, POST_D, 0);
  const rowE = new THREE.Vector4(0, 0.08, EYE_D, 0);
  const lampOpts = { tint: '#ffb35c', mix: 0.92, power: 2.2, range: 9 };
  addLamps(roadMat, ctx, runner, [rowL, rowR, rowE], lampOpts);
  addLamps(sandMat, ctx, runner, [rowL, rowR], lampOpts);

  // ── piedras sueltas (rocas deformadas, patrón de 240 m) ──
  const rand = ctx.rng(7);
  const rockGeo = new THREE.IcosahedronGeometry(1, 2);
  {
    const p = rockGeo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = 0.75 + 0.35 * Math.sin(v.x * 3.1 + 1.7) * Math.cos(v.y * 2.3) + 0.15 * Math.sin(v.z * 7.0);
      v.multiplyScalar(n);
      v.y = Math.max(v.y, -0.2) * 0.62;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    rockGeo.computeVertexNormals();
  }
  const rockMat = pbr(ctx, sand, { roughness: 1, color: new THREE.Color(0.55, 0.45, 0.38), normalScale: 1.5 });
  const nRock = 140;
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, nRock * 2);
  setInstances(ctx, rocks, nRock * 2, (i, t) => {
    const k = i % nRock;
    const r1 = rand(); const r2 = rand(); const r3 = rand();
    const side = r1 < 0.5 ? -1 : 1;
    const x = side * (ROAD_W + 2.2 + Math.pow(r2, 1.6) * 70);
    const s = 0.12 + Math.pow(r3, 3) * 1.4 + (Math.abs(x) > 20 ? 0.6 * r3 : 0);
    t.p.set(x, -0.04, -((k / nRock) * ROCK_P + rand() * 3) - (i >= nRock ? ROCK_P : 0));
    t.s.set(s * (0.8 + 0.5 * rand()), s, s * (0.8 + 0.5 * rand()));
    t.e.set(0, rand() * 6.28, 0);
  });
  rocks.frustumCulled = false;
  const rockGroup = new THREE.Group();
  rockGroup.add(rocks);
  root.add(rockGroup);

  // ── mesetas lejanas (siluetas de techo plano a 1–3 km; patrón de 6 km) ──
  const mesaGeo = new THREE.CylinderGeometry(1, 1.25, 1, 18, 3);
  {
    const p = mesaGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i); const z = p.getZ(i); const y = p.getY(i);
      const a = Math.atan2(z, x);
      const r = 1 + 0.18 * Math.sin(a * 3 + 0.5) + 0.1 * Math.sin(a * 7 + 2.1);
      p.setXYZ(i, x * r, y, z * r);
    }
    mesaGeo.computeVertexNormals();
  }
  const mesaMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.1, 0.08, 0.07), roughness: 1 });
  const nMesa = 22;
  const mesas = new THREE.InstancedMesh(mesaGeo, mesaMat, nMesa * 2);
  const mr = ctx.rng(31);
  setInstances(ctx, mesas, nMesa * 2, (i, t) => {
    const k = i % nMesa;
    const side = k % 2 ? 1 : -1;
    const dist = 900 + mr() * 2200;
    const w = 120 + mr() * 380;
    const h = 40 + mr() * 110;
    t.p.set(side * (250 + mr() * 1400), h / 2 - 2, -(k / nMesa) * MESA_P - dist * 0.3 - (i >= nMesa ? MESA_P : 0));
    t.s.set(w, h, w * (0.6 + mr() * 0.8));
  });
  mesas.frustumCulled = false;
  const mesaGroup = new THREE.Group();
  mesaGroup.add(mesas);
  root.add(mesaGroup);

  const inst = {
    director: { scale: 1.0, maxDown: 0.15, orbit: true },
    resize(s) { runner.resize(s); },
    update(f) {
      const st = runner.update(f);
      const S = st.S;
      road.offset.y = (S / ROAD_TILE) % 1;
      sand.offset.y = (S / SAND_TILE) % 1;
      dashGroup.position.z = scrollZ(S, DASH_D);
      eyeGroup.position.z = scrollZ(S, EYE_D);
      postGroup.position.z = scrollZ(S, POST_D);
      rockGroup.position.z = scrollZ(S, ROCK_P);
      mesaGroup.position.z = scrollZ(S, MESA_P);
      rowL.w = postGroup.position.z + 10;
      rowR.w = postGroup.position.z + 10 - POST_D / 2;
      rowE.w = eyeGroup.position.z + 4;
    },
    event(type, data) { runner.event(type, data); },
    get _debug() { return runner.debug(); },
    dispose() {},
  };
  return inst;
}
