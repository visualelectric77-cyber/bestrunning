// RITMUP · escenario DESIERTO (realista). Una carretera recta que cruza el desierto de noche bajo la Vía Láctea real
// (panorama CC0 de Poly Haven sin luna). Asfalto con sus marcas, arena con su rizado a los lados, mesetas lejanas en
// silueta y piedras sueltas. La luz la ponen los captafaros de los hitos (cada 25 m a cada lado) y los ojos de gato
// de la línea central (cada 12 m), del color del tramo con el encendido en cadena, que dejan su reflejo en el asfalto
// y la arena. El más sereno y oscuro: el número del HUD queda sobre el cielo estrellado.
// A VELOCIDAD REAL: asfalto, arena, hitos, piedras y mesetas avanzan a km/h ÷ 3,6 m/s.
import { createRunner, scrollZ } from './kit/runner.js';
import { worldUrl, loadTex, loadJson, loadSet, pbr, skyDome, envFrom, glowMaterial, halos, addLamps, setInstances } from './kit/world.js';
import { createRain, liveWeather, startLiveWeather } from './kit/weather.js';

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
const DEG = Math.PI / 180;

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
    // PLANO FINAL: corte a ras de la carretera mirando al cielo: la Vía Láctea ocupa dos tercios de la pantalla y los
    // captafaros se pierden hacia el horizonte. La cámara levanta la vista muy despacio. Con movimiento reducido, fijo.
    finaleShot: (T, { clock, portrait, still }) => {
      const e = still ? 0.5 : 1 - Math.exp(-Math.min(clock, 90) / 14);
      const az = (portrait ? 10 : 6) * DEG;
      const el = ((portrait ? 13 : 7) + (portrait ? 5 : 3) * e) * DEG;
      T.position.set(0.9, 0.5 + 0.25 * e, 2 - 1.5 * e);
      T.lookAt.set(T.position.x + 100 * Math.sin(az) * Math.cos(el), T.position.y + 100 * Math.sin(el), T.position.z - 100 * Math.cos(az) * Math.cos(el));
      T.fov = portrait ? 70 : 50;
    },
  });

  // ── cielo, entorno, luz de las estrellas ──
  const sky = skyDome(ctx, skyTex, skyMeta, { gain: 0.75, grad: 0.1, gradEl: 0.6, black: 0.12, tint: new THREE.Color(0.92, 0.95, 1.08), meteor: true });
  {
    // La foto trae una cúpula de contaminación lumínica (mostaza, con grano) hasta ~30° de altura: justo la banda donde
    // cae el número del HUD en vertical, que quedaba sobre un velo gris-verdoso (luminancia 0,15) en vez de sobre las
    // estrellas. Se baja el panorama 18°: esa cúpula queda bajo el suelo salvo un resto de bruma en el horizonte, y el
    // campo de estrellas y la Vía Láctea bajan hasta el número (0,10). El tope de la foto pasa de 76° a 58° de altura,
    // por encima de lo que encuadra la cámara.
    const tilt = (18 * Math.PI) / 180;
    sky.u.uCrop.value.z -= tilt;
    sky.u.uCrop.value.w -= tilt;
  }
  root.add(sky.mesh);
  scene.environment = envFrom(ctx, envTex);
  scene.environmentIntensity = 0.55;
  // niebla más oscura que el cielo del horizonte: las mesetas y la llanura lejana quedan en silueta (con 0,3 salían
  // más claras que el cielo, como cartón iluminado)
  const hor = new THREE.Color().setRGB(...skyMeta.horizon).multiplyScalar(0.2);
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
  // una sola lista para las dos copias del patrón (si no, las piedras saltaban al enlazar cada 240 m)
  const rockList = [];
  for (let k = 0; k < nRock; k++) {
    const r1 = rand(); const r2 = rand(); const r3 = rand();
    const side = r1 < 0.5 ? -1 : 1;
    const x = side * (ROAD_W + 2.2 + Math.pow(r2, 1.6) * 70);
    const sz = 0.12 + Math.pow(r3, 3) * 1.4 + (Math.abs(x) > 20 ? 0.6 * r3 : 0);
    rockList.push({ x, z: -((k / nRock) * ROCK_P + rand() * 3), sx: sz * (0.8 + 0.5 * rand()), sy: sz, sz: sz * (0.8 + 0.5 * rand()), r: rand() * 6.28 });
  }
  setInstances(ctx, rocks, nRock * 2, (i, t) => {
    const r = rockList[i % nRock];
    t.p.set(r.x, -0.04, r.z - (i >= nRock ? ROCK_P : 0));
    t.s.set(r.sx, r.sy, r.sz);
    t.e.set(0, r.r, 0);
  });
  rocks.frustumCulled = false;
  const rockGroup = new THREE.Group();
  rockGroup.add(rocks);
  root.add(rockGroup);

  // ── mesetas lejanas (siluetas de techo plano a 1–3 km; patrón de 6 km) ──
  // Perfil de meseta de verdad (misma malla instanciada, una llamada): talud de derrubios hasta el 40 % de la altura,
  // pared casi vertical con cárcavas encima y cima en dos niveles con el borde roto. Antes era un cilindro liso.
  const mesaGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 6);
  {
    const p = mesaGeo.attributes.position;
    const sm = (v) => { const c = Math.min(1, Math.max(0, v)); return c * c * (3 - 2 * c); };
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i); const z = p.getZ(i); const y = p.getY(i);
      const rad = Math.hypot(x, z);
      const a = Math.atan2(z, x);
      const h = y + 0.5;
      let r = 1 + 0.18 * Math.sin(a * 3 + 0.5) + 0.1 * Math.sin(a * 7 + 2.1) + 0.05 * Math.sin(a * 13 + 4.0);
      if (h < 0.4) r += Math.pow(1 - h / 0.4, 1.25) * 0.75;
      else r += 0.03 * Math.sin(a * 23 + 1.3) - 0.06 * (h - 0.4);
      let yy = y;
      if (h > 0.99) yy = rad > 0.5 ? y - 0.17 * sm((Math.sin(a * 2 + 0.7) - 0.1) / 0.5) - 0.03 * (0.5 + 0.5 * Math.sin(a * 5 + 1.0)) : y - 0.05;
      p.setXYZ(i, x * r, yy, z * r);
    }
    mesaGeo.computeVertexNormals();
  }
  const mesaMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.1, 0.08, 0.07), roughness: 1 });
  const nMesa = 26;
  const mesas = new THREE.InstancedMesh(mesaGeo, mesaMat, nMesa * 2);
  // Las dos copias del patrón son la MISMA lista (si no, al enlazar cada 6 km saltaban mesetas). Cada meseta queda
  // lejos de la carretera contando su radio de verdad (base 1,25 × escala, más el bulto de 0,28): antes una meseta
  // ancha cruzaba la carretera y la cámara la atravesaba («muro negro»).
  const mr = ctx.rng(31);
  const mesaList = [];
  for (let k = 0; k < nMesa; k++) {
    const side = k % 2 ? 1 : -1;
    // una de cada seis es un cerro testigo: estrecho y alto (rompe la línea de mesetas anchas)
    const butte = k % 6 === 3;
    const w = butte ? 45 + mr() * 40 : 100 + mr() * 300;
    const d = w * (0.6 + mr() * 0.8);
    const h = butte ? 110 + mr() * 70 : 40 + mr() * 110;
    // radio de verdad: planta (hasta 1,33) + talud (0,75)
    const reach = Math.max(w, d) * 2.1;
    mesaList.push({ x: side * (reach + 120 + mr() * 900), h, w, d, rot: mr() * 6.28, z: -(k / nMesa) * MESA_P - mr() * 200 });
  }
  setInstances(ctx, mesas, nMesa * 2, (i, t) => {
    const m = mesaList[i % nMesa];
    t.p.set(m.x, m.h / 2 - 2, m.z - (i >= nMesa ? MESA_P : 0));
    t.s.set(m.w, m.h, m.d);
    t.e.set(0, m.rot, 0);
  });
  mesas.frustumCulled = false;
  const mesaGroup = new THREE.Group();
  mesaGroup.add(mesas);
  root.add(mesaGroup);

  // ── tiempo real (web 1.16): las nubes tapan las estrellas, al atardecer/amanecer el horizonte se calienta y, si
  //    llueve en el sitio elegido, llueve en la carretera ──
  startLiveWeather();   // «Tiempo real» (Ajustes): la hora y el tiempo del sitio elegido
  const rain = createRain(ctx, { count: ctx.qualityLevel >= 2 ? 1400 : 800, color: [0.26, 0.26, 0.3] });
  root.add(rain.mesh);
  const gain0 = sky.u.uGain.value;
  const fog0 = scene.fog.density;
  const fogC0 = scene.fog.color.clone();
  const warm = new THREE.Color(0.55, 0.36, 0.26);

  // ── el cielo, protagonista ──
  // La Vía Láctea entra en escena a lo largo de la clase: el panorama gira 9° en acimut, tan despacio que no se ve
  // moverse (empieza fuera de cuadro a la derecha y acaba junto al número). Y, muy de vez en cuando, una estrella
  // fugaz: un trazo fino de ~0,9 s en la franja libre entre la barra superior y la etiqueta del tramo, como mucho una
  // cada minuto y medio, sin bloom (brillo < umbral) y nunca con movimiento reducido. Todo sale del reloj de la clase.
  const crop0 = sky.u.uCrop.value.clone();
  const totalSec = Math.max(60, ctx.timeline.totalSec);
  const hash = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const dirOf = (out, az, el) => out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  const METEOR_SLOT = 97; const METEOR_SEC = 0.9;
  function meteor(f) {
    const K = sky.u.uMetK.value;
    K.y = 0;
    if (f.reducedMotion || liveWeather()?.cloud > 0.5) return;
    let p = -1; let seed = 0; let az0 = 0; let el0 = 0;
    if (f.finale > 0) {
      // uno solo, con el plano final ya asentado, en el cielo que encuadra ese plano
      p = (runner.finClock - 4.2) / 1.1; seed = 7.3; az0 = 7 * DEG; el0 = 34 * DEG;
    } else if (f.running) {
      const k = Math.floor(f.t / METEOR_SLOT);
      if (hash(k) < 0.65) {
        p = (f.t - k * METEOR_SLOT - (18 + 55 * hash(k + 0.31))) / METEOR_SEC;
        seed = k; az0 = (hash(k + 0.57) * 24 - 12) * DEG; el0 = (21 + 3 * hash(k + 0.73)) * DEG;
      }
    }
    if (!(p > 0 && p < 1)) return;
    const fin = f.finale > 0;
    const dir = fin || hash(seed + 0.11) < 0.5 ? -1 : 1;   // en el final, hacia la parte oscura del cielo
    const scale = fin ? 1.6 : 1;
    dirOf(sky.u.uMetA.value, az0, el0);
    dirOf(sky.u.uMetB.value, az0 + dir * (5 + 3 * hash(seed + 0.23)) * DEG * scale, el0 - (1.5 + 1.8 * hash(seed + 0.41)) * DEG * scale);
    K.x = p * 1.4;                                   // la cabeza recorre el trazo y la cola termina de salir
    K.y = (fin ? 1.5 : 0.85) * Math.pow(Math.sin(Math.PI * p), 0.6);
    K.z = fin ? 0.0022 : 0.0017;
  }

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
      const w = liveWeather();
      sky.u.uGain.value = gain0 * (w ? (1 - 0.94 * w.cloud) * (1 + 0.4 * w.day) : 1);
      scene.fog.density = fog0 * (w ? 1 + 2 * w.cloud + 4 * w.mist : 1);
      scene.fog.color.copy(fogC0).lerp(warm, w ? 0.5 * w.golden + 0.25 * w.day : 0);
      rain.update(f, S, w ? w.rain : 0);
      const turn = (1 - Math.min(1, Math.max(0, f.t / totalSec))) * 9 * DEG;
      sky.u.uCrop.value.x = crop0.x + turn;
      sky.u.uCrop.value.y = crop0.y + turn;
      meteor(f);
    },
    event(type, data) { runner.event(type, data); },
    get _debug() { return runner.debug(); },
    dispose() {},
  };
  return inst;
}
