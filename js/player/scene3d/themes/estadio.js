// BestRunning · escenario ESTADIO — atletismo de élite de noche, como una retransmisión de la Diamond League (§15.2-3).
// Corres por un estadio real de 400 m (rectas de 84,39 m, curvas de 36,5 m, 8 calles) A TU VELOCIDAD REAL en metros
// por segundo (nada de un óvalo que gira a 3×): pista de grafito con grano, desgaste en las calles interiores y reflejo
// satinado de los focos; líneas blancas nítidas; bordillo de aluminio con LUCES DE RITMO tipo Wavelight que corren a tu
// velocidad objetivo en el color de la zona (y una fila blanca para tu fantasma); gradas escalonadas en penumbra con el
// canto de cada fila iluminado, pasillos y público apenas sugerido; baterías de focos rectangulares bajo la cubierta.
// Todo lo que pertenece al plan se cruza en su segundo exacto — la línea de cambio de tramo, las marcas de 100 m
// (distancia real), MITAD y la META de la clase, que coincide con la recta de meta del estadio.
// Momentos (sin destellos, §15.2): el color del tramo barre el bordillo una vez y una línea fina pasa bajo tus pies;
// rótulo de retransmisión sobrio en el hueco libre («EN 120 M · SPRINT 13,0»; tras el test VAM, «TU VAM 13,2 KM/H» en
// grande); el bloque de LED se adelanta cuando sube la velocidad y se queda atrás cuando baja; final: corte limpio a un
// plano cenital del óvalo entero con el bordillo encendido en el color final y la distancia total pintada en el césped.
// Composición (§15.3, sin máscaras): vertical — cámara de raíl algo elevada en la calle 2, punto de fuga justo bajo el
// número, focos y gradas en la banda superior, la pista lejana en la ventana; horizontal — cámara exterior (calle 8): las
// calles y el bordillo convergen en el hueco entre el número y la columna de datos y detrás de la columna solo hay gradas
// oscuras y el arcén liso. Movimiento reducido: la cámara solo recorre rectas (cortes limpios en las curvas).
// Sensación de velocidad (ctx.speedFeel, en el shader de la pista): marcas de ritmo cada ~2,5 m sobre las líneas de
// tu calle y grano cercano algo más presente; cámara de raíl a 1,85 m (antes 2,3). Los metros siguen siendo reales.
// 6–8 llamadas de dibujo, shaders baratos, cero asignaciones por fotograma.
// REALISMO (nov-26, «igual de realista que el paseo de la Costa»): el tartán es el de la foto (rojo ladrillo, con su
// relieve de caucho rompiendo el brillo de los focos, mojado por el relente), césped regado y segado a franjas, arcén
// de caucho gris azulado, oclusión de contacto al pie del muro, gradas de hormigón con asientos y público sentado que
// recoge la luz, cubierta con sus cerchas, focos con resplandor y cielo de foto de noche con nubes (gira con el estadio).
// TEST VAM (nov-26) — el estadio sube contigo. «Calor» 0 en el primer escalón → 1 al llegar a TU VAM (workout.vamRef o
// la de tus velocidades); por encima, zona de oro. Con el calor: se encienden más baterías de focos, la grada se llena,
// suben las luces de móvil y los flashes, las vallas LED y el anillo del anfiteatro se encienden en el color del
// escalón y las líneas de calle se iluminan. En cada escalón: golpe de luz de los focos, una lámina de luz que sale de
// tus pies y recorre la pista, barrido por las vallas, ola en la grada, y el número del escalón proyectado en la pista
// (viaja contigo y, cuando llega su línea, se queda clavado y lo pisas). La línea dorada de TU VAM viene por la pista
// con su rótulo («Tu VAM 13,2 · supérala»); al cruzarla, todo se pone de oro y hay fuegos. «No puedo más»: resultado
// proyectado en la pista («Nueva VAM 13,7 · +0,5 km/h»), fuegos y el estadio entero encendido; plano final con tu VAM en
// el césped y fuegos sobre la cubierta. Aguanta cualquier número de escalones (el calor va por velocidad, no por
// número). Movimiento reducido: sin ondas, flashes ni fuegos; solo los niveles. Coste: +1–3 llamadas de dibujo.
import { RC, LANE_W, LS, LC, BEND, wrapS, pathPoint, easeCubicIntegral, A as HALF_STRAIGHT, R0, WALL } from './estadio/track.js';
import { buildSky, buildGround, buildStands, buildLights } from './estadio/stadium.js';
import { DECAL_VERT, DECAL_FRAG } from './estadio/shaders.js';
import { laneNumbersTexture, makePaint, makeBug, makeFinalGraphic, makeFloor } from './estadio/graphics.js';
import { buildFireworks } from './estadio/show.js';
import { nightOn, createNight } from './estadio/noche.js';
import { worldUrl, loadTex } from './kit/world.js';
import { vamFromLevels } from '../../../training/levels.js';

export const meta = {
  id: 'estadio',
  name: 'Estadio',
  description: 'Pista de atletismo de noche con luces de ritmo a tu velocidad.',
};

const LOOK = 14;          // anticipación de la cámara en las curvas (m)
const SIG_END = 8;        // la clase termina 8 m después del inicio de la recta de meta
const PACER_HEAD = 15;    // cabeza del bloque de LED por delante de ti a ritmo (m)
const RAMP = 4;           // = timeline.js (rampa de la cinta tras un cambio)
const START_RAMP = 3.5;
const RELAX = 7;          // s: el pacer vuelve a su sitio tras la rampa
const DTT = 0.25;         // resolución de la tabla de distancia real (s)
const GOLD = '#ffd60a';
const MOOD_KEYS = ['dh', 'fov', 'light', 'rail', 'plen', 'pint', 'exp'];
const VIS10 = Math.pow(10, 0.85) / 1.35;
// Luces del público (móviles encendidos en la grada): densidad por zona — el estadio se anima cuando aprietas
const CROWD = { warmup: 0.05, walk: 0.04, jog: 0.06, run: 0.09, fast: 0.14, sprint: 0.22, cooldown: 0.07 };
const CROWD_READY = 0.42;  // antes de empezar, a oscuras: un mar de luces esperando
const CROWD_FINAL = 0.5;   // plano final: el estadio entero encendido
const WAVE_T = 4.4;        // una ola de luces da la vuelta al estadio en este tiempo (s)
// Test VAM · el estadio sube contigo: «calor» 0 en el primer escalón → 1 al llegar a TU VAM; por encima, zona de oro
const FLOOR_ROWS = 8;
const FLOOR_T = 9.4;       // s antes de su línea en que aparece el gráfico de pista (ya con la tira «Siguiente» del HUD puesta)
const CELEB = 14;          // s de celebración tras «No puedo más» (después, el estadio se serena para la vuelta a la calma)
/** Inversa exacta de visualSpeed() del núcleo: u/s visuales → km/h reales (conserva la forma de las rampas). */
const kmhOfVis = (v) => (v > 0 ? Math.pow(v * VIS10, 1 / 1.85) : 0);

// Ambiente por zona: altura de cámara (relativa), FOV extra, luz del estadio, LED en reposo, bloque del pacer, exposición
const MOODS = {
  warmup: { dh: 0.1, fov: 0, light: 1.0, rail: 0.075, plen: 10, pint: 0.9, exp: 0.93 },
  walk: { dh: 0.15, fov: -1, light: 0.95, rail: 0.06, plen: 8, pint: 0.75, exp: 0.92 },
  jog: { dh: 0.04, fov: 0, light: 1.0, rail: 0.065, plen: 10, pint: 0.95, exp: 0.93 },
  run: { dh: 0, fov: 1, light: 1.0, rail: 0.07, plen: 11, pint: 1.0, exp: 0.94 },
  fast: { dh: -0.06, fov: 2, light: 1.0, rail: 0.075, plen: 12.5, pint: 1.1, exp: 0.95 },
  sprint: { dh: -0.12, fov: 3.5, light: 1.0, rail: 0.085, plen: 14, pint: 1.22, exp: 0.95 },
  cooldown: { dh: 0.2, fov: -1, light: 0.84, rail: 0.05, plen: 9, pint: 0.75, exp: 0.9 },
};

export async function createTheme(ctx) {
  const { THREE, root, camera, rig, post, timeline: tl, util } = ctx;
  const { clamp, clamp01, damp, smoothstep, easeInOutSine, easeOutCubic, easeInOutCubic } = util;
  const C = (hex) => new THREE.Color(hex);
  const aniso = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy?.() || 1);
  const rand = ctx.rng(4242);
  const tlRaw = ctx.tl;

  camera.near = 0.1;
  camera.far = 2400;
  post.set({ toneMapping: 'aces', exposure: 0.93, bloomStrength: 0.5, bloomThreshold: 0.95, bloomRadius: 0.3, vignette: 0.28, saturation: 1 });
  const postOpts = { exposure: 0.93 }; // reutilizado cada fotograma (sin asignaciones)

  // ── mundo (espacio del estadio): se transforma cada fotograma para que tu posición quede en el origen mirando a −z ──
  const world = new THREE.Group();
  world.name = 'estadio-world';
  root.add(world);

  const sky = buildSky(THREE, camera);
  root.add(sky.mesh);
  const ground = buildGround(THREE, ctx.shaders.NOISE);
  // realismo (web 1.14): tartán y césped de foto (CC0). Sin red, la pista de siempre
  try {
    const [tartan, grassT] = await Promise.all([
      loadTex(ctx, worldUrl('estadio', 'tartan_diff.jpg'), { srgb: true, repeat: [1, 1], aniso: 8 }),
      loadTex(ctx, worldUrl('estadio', 'grass_diff.jpg'), { srgb: true, repeat: [1, 1], aniso: 8 }),
    ]);
    ground.u.uTartanT.value = tartan; ground.u.uGrassT.value = grassT; ground.u.uPhoto.value = 1;
  } catch { /* sin red */ }
  // realismo (nov-26): relieve del caucho y cielo de foto de noche con nubes (el del escenario Neón, CC0). Cada uno
  // es opcional: sin él, brillo liso y el degradado de siempre
  try {
    const nor = await loadTex(ctx, worldUrl('estadio', 'tartan_nor.jpg'), { repeat: [1, 1], aniso: 4 });
    ground.u.uTartanN.value = nor; ground.u.uNor.value = 1;
  } catch { /* sin red */ }
  try {
    const skyT = await loadTex(ctx, worldUrl('neon', 'sky.jpg'), { srgb: true });
    sky.u.uSkyT.value = skyT; sky.u.uSkyK.value.x = 1;
  } catch { /* sin red */ }
  world.add(ground.mesh);
  const stands = buildStands(THREE, ctx.shaders.NOISE, ctx.spectrumTexture);
  world.add(stands.mesh);
  const lights = buildLights(THREE, rand);
  world.add(lights.mesh);
  const G = ground.u;
  const SU = stands.u;
  // MODO RETRANSMISIÓN (beta, Perfil › Laboratorio): estadio de noche con lluvia, luz horneada por baterías, agua y arco
  // de meta (estadio/noche.js). Sin el interruptor, o si faltan sus recursos, el Estadio de siempre.
  let night = null;
  if (nightOn()) {
    try { night = await createNight(ctx, { world, ground, stands, lights, sky }); } catch (err) { night = null; console.warn('estadio noche:', err); }
  }

  // ── decals (shader propio: niebla del estadio y fundido al acercarse: nada enorme bajo el rótulo inferior) ──
  function decalMat(map, color, opacity = 1, near = [0, 0], extra = {}) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: map }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity },
        uFogD: { value: G.uFogD.value }, uFog: { value: G.uFog.value }, uNear: { value: new THREE.Vector2(near[0], near[1]) },
        uKey: { value: 0 }, uKeyPos: { value: 1 },
      },
      vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, ...extra,
    });
  }
  const tmpP = { x: 0, z: 0, tx: 1, tz: 0 };
  const tmpQ = { x: 0, z: 0, tx: 1, tz: 0 };

  /** Coloca un grupo tendido sobre la pista en σ con desplazamiento lateral r (desde el bordillo). */
  function placeFlat(obj, s, r) {
    pathPoint(s, r, tmpQ);
    obj.position.set(tmpQ.x, 0.012, tmpQ.z);
    obj.rotation.set(0, Math.atan2(-tmpQ.tx, -tmpQ.tz), 0);
  }
  function flatDecal(texture, w, l, color, opacity, near) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), decalMat(texture, color, opacity, near));
    m.rotation.x = -Math.PI / 2;
    m.scale.set(w, l, 1);
    m.renderOrder = 2;
    m.frustumCulled = false;
    g.add(m);
    g.userData.mesh = m;
    return g;
  }

  // números de calle antes de la línea de meta y de la salida de 200 m (una sola malla, 2 quads), grises y discretos
  {
    const numTex = laneNumbersTexture(THREE, aniso);
    const geos = [];
    for (const s of [LS - 2.6, LS + BEND - 2.6]) {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      g.scale(LANE_W * 8, 1, 4.2);
      const o = new THREE.Object3D();
      pathPoint(s, LANE_W * 4, tmpQ); // centro de las 8 calles: r = 4,88 desde el bordillo
      o.position.set(tmpQ.x, 0.01, tmpQ.z);
      o.rotation.set(0, Math.atan2(-tmpQ.tx, -tmpQ.tz), 0);
      o.updateMatrix();
      g.applyMatrix4(o.matrix);
      geos.push(g);
    }
    const merged = mergeQuads(THREE, geos);
    const mesh = new THREE.Mesh(merged, decalMat(numTex, '#4a4c51', 0.75, [11, 28]));
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    world.add(mesh);
  }

  // rotulación pintada dinámica: la próxima marca de 100 m / km, y MITAD · ESCALÓN · META
  const paintA = makePaint(THREE, aniso);
  const paintB = makePaint(THREE, aniso);
  const markA = flatDecal(paintA.texture, 0.98, 2.7, '#c9cbd0', 0, [10, 22]);
  const markB = flatDecal(paintB.texture, 1.05, 2.9, '#d3d5da', 0, [10, 22]);
  world.add(markA, markB);

  // test VAM: gráficos de luz proyectados en la pista (el número del escalón que llega; tu VAM, en oro) y fuegos
  const isTest = !!tlRaw?.isTest;
  const floorS = isTest ? makeFloor(THREE, aniso) : null;
  const floorV = isTest ? makeFloor(THREE, aniso) : null;
  function floorBand(texture, color) {
    const n = (FLOOR_ROWS + 1) * 2;
    const uv = new Float32Array(n * 2);
    const idx = [];
    for (let i = 0; i <= FLOOR_ROWS; i++) {
      uv[i * 4] = 0; uv[i * 4 + 1] = i / FLOOR_ROWS; uv[i * 4 + 2] = 1; uv[i * 4 + 3] = i / FLOOR_ROWS;
      if (i < FLOOR_ROWS) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, decalMat(texture, color, 0, [3, 6.5], { side: THREE.DoubleSide }));
    m.material.uniforms.uKeyPos.value = 0;
    m.renderOrder = 3;
    m.frustumCulled = false;
    m.visible = false;
    return m;
  }
  /**
   * Tiende la banda en el suelo, recta por delante de la cámara (marco del corredor: tú en el origen mirando a −z):
   * borde cercano a `d` m, `len` m de largo, `width` m de ancho cerca y (1 + key) veces más lejos, centrada en `x`.
   * La textura va lineal en PANTALLA (v ∝ 1/distancia): desde la cámara es un rectángulo recto que se lee igual en
   * recta que en curva (un gráfico virtual de retransmisión), y aun así está en el suelo: cuando su línea llega, se
   * viene hacia ti y pasa bajo tus pies.
   */
  function layFloor(m, d, len, x, width, key, slope = 0) {
    const pos = m.geometry.attributes.position;
    const uv = m.geometry.attributes.uv;
    for (let i = 0; i <= FLOOR_ROWS; i++) {
      const k = i / FLOOR_ROWS;
      const half = (width / 2) * (1 + key * k);
      const v = key > 1e-3 ? (1 - 1 / (1 + key * k)) / (1 - 1 / (1 + key)) : k;
      // (slope: desvío lateral proporcional a la distancia ⇒ en pantalla el rectángulo queda centrado en su hueco
      // aunque el punto de fuga no esté en el centro: apaisado, con la columna de datos a la derecha)
      const cx = x + slope * (fb.near + len * k);
      pos.setXYZ(i * 2, cx - half, 0.014, -(d + len * k));
      pos.setXYZ(i * 2 + 1, cx + half, 0.014, -(d + len * k));
      uv.setY(i * 2, v); uv.setY(i * 2 + 1, v);
    }
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    m.material.uniforms.uKey.value = key;
    m.material.depthTest = !fb.over;     // (sin sitio antes del muro: por encima de las vallas, entero)
  }
  /**
   * Dónde cabe el gráfico: el hueco libre de pantalla bajo el horizonte, hasta el primer bloque del HUD que haya debajo
   * (la tira «Siguiente», el botón «No puedo más», la tarjeta del tramo…), pasado a metros de pista. Con el HUD del test
   * con pulso el hueco es una franja baja y lejana; sin pulso, media pantalla. fb.ok = false ⇒ no cabe: no se pinta.
   */
  const fb = { ok: false, near: 9, len: 11, wn: 4, key: 1, aspect: 1.6, slope: 0, init: false, over: false };
  function floorDims(dt) {
    const H = Math.max(1, ctx.size.height);
    const W = Math.max(1, ctx.size.width);
    const fpx = (H / 2) / Math.tan((camera.fov * Math.PI) / 360);
    const yH = (H * (1 - base.sy)) / 2;
    const xc = (W * (1 + base.sx)) / 2;
    let yBot = H * 0.94;
    for (const r of ctx.hud.rects) if (r.y > yH + 6 && r.y < yBot && r.x < xc + 20 && r.x + r.w > xc - 20) yBot = r.y;
    const band = yBot - yH;
    fb.ok = band >= 30;
    if (!fb.ok) return fb;
    // altura REAL de la cámara (la del fotograma anterior): el director del núcleo la sube en sus planos de recuperación
    const hw = camera.matrixWorld.elements[13];
    const hc = Math.max(1, hw > 0.5 ? hw : rig.target.position.y);
    const y1 = band - 6;
    const y0 = Math.min(y1 - 16, Math.max(9, band * 0.12, (hc * fpx) / 75));
    const near = (hc * fpx) / y1;
    let far = (hc * fpx) / y0;
    // a lo ancho: lo que dejan libre los bloques que caen a un lado del punto de fuga (apaisado: la columna de datos)
    let xL = 8;
    let xR = W - 8;
    for (const r of ctx.hud.rects) {
      if (r.y + r.h < yH + y0 || r.y > yH + y1) continue;
      if (r.x >= xc + 20) xR = Math.min(xR, r.x - 10);
      else if (r.x + r.w <= xc - 20) xL = Math.max(xL, r.x + r.w + 10);
    }
    const wpx = Math.max(60, (xR - xL) * 0.9);
    // Siempre la misma forma: una franja apaisada (3,4 : 1 como poco) pegada al borde de abajo del hueco, con el texto
    // en una línea. Así el rótulo no cambia de tres líneas a una al pasar de la recta a la curva (ni de un HUD a otro).
    const y0s = Math.max(y0, y1 - wpx / 3.4);
    far = (hc * fpx) / y0s;
    // La pista no sigue recta para siempre: en las curvas, «todo recto» acaba en el muro de vallas, y lo que quedase
    // más allá lo taparían las vallas (el rótulo salía cortado por arriba). Se busca hasta dónde hay suelo a la vista
    // —por el centro y por los dos bordes del rótulo— y el rótulo termina ahí. Si entonces ya no cabe (hueco bajo del
    // HUD con pulso, en plena curva), se pinta entero por encima, como un gráfico de retransmisión.
    const slopeT = ((xL + xR) / 2 - xc) / fpx;
    let reach = 80;
    for (let d = Math.max(6, near); d <= 80; d += 2) {
      const half = ((wpx / 2) * d) / fpx;
      let hit = false;
      for (let e = -1; e <= 1; e++) {
        const xr = camera.matrixWorld.elements[12] + slopeT * d + e * half * 0.95;
        const x = px0 + xr * cosA + d * sinA;
        const z = pz0 + xr * sinA - d * cosA;
        const qx = x - clamp(x, -HALF_STRAIGHT, HALF_STRAIGHT);
        if (Math.hypot(qx, z) - R0 > WALL - 0.8) { hit = true; break; }
      }
      if (hit) { reach = d - 2; break; }
    }
    const y0w = (hc * fpx) / Math.max(reach, near + 1);
    fb.over = !(reach >= far || y1 - y0w >= 34);
    if (!fb.over && reach < far) { far = Math.max(near + 4, reach); }
    const y0e = (hc * fpx) / far;
    const k = fb.init ? 1 - Math.exp(-(dt || 0.016) * 7) : 1;      // sin saltos cuando el HUD cambia de sitio
    fb.init = true;
    fb.near += (near - fb.near) * k;
    fb.len += (far - near - fb.len) * k;
    fb.wn += ((wpx * near) / fpx - fb.wn) * k;
    fb.key += (far / near - 1 - fb.key) * k;
    fb.slope += (slopeT - fb.slope) * k;
    fb.aspect = wpx / Math.max(12, y1 - y0e);
    return fb;
  }
  const stageMark = isTest ? floorBand(floorS.texture, '#ffffff') : null;
  const vamMark = isTest ? floorBand(floorV.texture, GOLD) : null;
  if (isTest) root.add(stageMark, vamMark);   // marco del corredor (no del estadio): siempre recto delante de ti
  const fw = buildFireworks(THREE, ctx.rng(977));
  world.add(fw.mesh);
  const fwRand = ctx.rng(31337);

  // rótulo de retransmisión en pantalla (cuelga de la cámara): próximo cambio / resultado del test VAM
  const bug = makeBug(THREE);
  const bugMat = new THREE.MeshBasicMaterial({
    map: bug.texture, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: true,
    color: new THREE.Color(0.93, 0.93, 0.93), // < umbral del bloom: el texto no "brilla"
  });
  const bugMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bugMat);
  bugMesh.frustumCulled = false;
  bugMesh.renderOrder = 950;
  bugMesh.visible = false;
  ctx.cameraRoot.add(bugMesh);

  // gráfico final: distancia total pintada en el césped
  const fin = makeFinalGraphic(THREE, aniso);
  const finMark = flatDecal(fin.texture, 22, 25, '#ffffff', 0, [0, 0]);
  finMark.visible = false;
  root.add(finMark); // marco del corredor: el mundo queda quieto tras la meta
  const finPos = new THREE.Vector3();
  const finCam = new THREE.Vector3();
  const finLook = new THREE.Vector3();

  // ── colores ──
  const gold = C(GOLD);
  const WHITE = C('#ffffff');
  const cur = new THREE.Color();
  const sweepFrom = new THREE.Color();
  const sweepTo = new THREE.Color();
  const finalCol = new THREE.Color();
  G.uGold.value.copy(gold);

  // ── distancia REAL recorrida en función del reloj de la clase (m): misma rampa que la cinta, en m/s reales ──
  const sigT = { arr: new Float64Array(0), len: 0, ver: -1, vEnd: 0 };
  function buildSig() {
    const n = Math.ceil((tl.totalSec + 130) / DTT) + 2;
    if (sigT.arr.length < n) sigT.arr = new Float64Array(n);
    const Ar = sigT.arr;
    Ar[0] = 0;
    let prev = kmhOfVis(tlRaw.vAt(0)) / 3.6;
    for (let k = 1; k < n; k++) {
      const v = kmhOfVis(tlRaw.vAt(k * DTT)) / 3.6;
      Ar[k] = Ar[k - 1] + (prev + v) * 0.5 * DTT;
      prev = v;
    }
    sigT.len = n;
    sigT.ver = tl.version;
    sigT.vEnd = prev;
  }
  function sigAt(t) {
    if (!(t > 0)) return 0;
    const k = t / DTT;
    const i = Math.floor(k);
    const Ar = sigT.arr;
    if (i >= sigT.len - 1) return Ar[sigT.len - 1] + (t - (sigT.len - 1) * DTT) * sigT.vEnd;
    return Ar[i] + (Ar[i + 1] - Ar[i]) * (k - i);
  }
  buildSig();
  let sEndM = sigAt(tl.totalSec);

  // ── estado ──
  const mood = { ...MOODS.jog };
  const base = { lat: 0, h: 2.3, fov: 60, sx: 0, sy: 0.05 };
  let portrait = true;
  let hudVersion = -1;
  let driftErr = 0;
  let sweep = null;          // { t0 }
  let dropAt = -1e9;
  let dropU = 0;
  let dropK = 1;             // intensidad del barrido de las vallas (1 drop · 0,55 cambio de tramo)
  let power = -1;            // encendido del estadio (0..1); −1 = sin inicializar
  let countN = 0;            // último número de la cuenta atrás (3, 2, 1)
  let crowdK = -1;           // densidad suavizada de las luces del público
  let waveAt = -1e9;         // ola de luces del público: inicio, origen (u del muro) y fuerza
  let waveU = 0;
  let waveAmp = 0;
  let finClock = 0;          // reloj del plano final (vaivén una vez asentado)
  let countAt = -1e9;
  let testSign = null;       // { at, vam }
  let recAt = -1e9;          // reloj del último 'record' {on: true} (con las luces de tu récord, el rótulo no lo pisa)
  let testRamp = null;       // «No puedo más»: la cinta baja desde TU escalón, no desde el último del test
  let lastKmh = 0;
  let lastRecord = false;
  let finaleOn = false;
  let finaleInit = false;
  let introOn = null;
  let bugA = 0;
  const bugKey = { kind: 0, a: -1, b: -1, c: -1 };   // qué hay compuesto en el rótulo (sin cadenas por fotograma)
  let markAk = -1;
  let ghostA = 0;
  let pacerHead = PACER_HEAD;
  let pauseK = 0;
  let dimK = 0;
  let finA = 0;
  let firstFrame = true;
  let feelD = -1;            // densidad de las marcas de ritmo compuesta en el uniforme
  let momentKey = -1;        // qué hay pintado en markB (1 MITAD · 2 META · 100+n escalón n)
  let lastSig = 0;
  const halfT = tl.totalSec / 2;
  // ── test VAM: estado de los efectos ──
  const fxCol = new THREE.Color();
  const tmpCol = new THREE.Color();
  const fwCols = [gold, C('#fff1d6'), ctx.zoneColor('sprint'), ctx.zoneColor('cooldown'), ctx.zoneColor('warmup')];
  const TI = { first: -1, last: -1, v0: 0, vamRef: 0, tRef: -1, ver: -1 };   // lo que se sabe del test por la línea de tiempo
  const tx = {
    init: false, seen: false, heat: 0, over: 0, goldK: 0, hit: 0, stageAt: -1e9, waveAt: -1e9, beaten: false, beatAt: -1e9,
    ended: null,               // { at, vam, record, stage } tras «No puedo más» (o al acabarse los escalones)
    flKey: 0, flN: 0, flS: 0, flAt: 0, flCol: new THREE.Color(), vmKey: 0, vmAt: 0, vmS: 0,   // gráficos de pista: cuál, dónde y desde cuándo
    resS: 0, chev: 0, pack: 0, finFw: 0, show: -1, fwEnd: 0, punch: 0, projTxt: '', projKey: 0,
  };
  let beatSign = null;       // { at } rótulo «por encima de tu VAM»
  function scanTest() {
    TI.ver = tl.version; TI.first = -1; TI.last = -1; TI.tRef = -1;
    for (let i = 0; i < tl.segCount; i++) if (tl.segStage(i) > 0) { if (TI.first < 0) TI.first = i; TI.last = i; }
    const lv = ctx.levels;
    const fromLevels = lv && ['jog', 'run', 'fast', 'sprint'].every((k) => Number(lv[k]) > 0) ? vamFromLevels(lv) : 0;
    const ref = Number(ctx.workout?.vamRef);
    TI.vamRef = ref > 0 ? ref : fromLevels;
    if (TI.first < 0) return;
    TI.v0 = tl.segSpeed(TI.first) - 0.5;                          // la VAM de Kuipers al empezar el primer escalón
    if (!(TI.vamRef > TI.v0 + 0.5)) return;                        // sin referencia útil: no hay línea de tu VAM
    // el segundo en que la VAM provisional (último escalón completo + fracción del actual) iguala la tuya
    for (let i = TI.first; i <= TI.last; i++) {
      const v = tl.segSpeed(i);
      const vp = i > TI.first ? tl.segSpeed(i - 1) : TI.v0;
      if (TI.vamRef < v - 1e-6) { TI.tRef = tl.segStart(i) + clamp01((TI.vamRef - vp) / Math.max(0.05, v - vp)) * tl.segDuration(i); break; }
    }
  }
  if (isTest) scanTest();
  const rectOf = (kind) => { for (const r of ctx.hud.rects) if (r.kind === kind) return r; return null; };

  /** Encaje por composición (sin máscaras): dónde va el punto de fuga según el HUD. */
  function frameCamera() {
    const W = Math.max(1, ctx.hud.width);
    const H = Math.max(1, ctx.hud.height);
    const sp = rectOf('speed');
    if (portrait) {
      const top = sp ? (sp.y + sp.h) / H : 0.45;
      const fy = clamp(top + 0.05, 0.4, 0.62);
      // cámara de raíl a 1,85 m (2,3 hasta oct-26): a metros reales el flujo del suelo ∝ velocidad / altura de ojo
      base.lat = 0; base.h = 1.85; base.fov = 60; base.sx = 0; base.sy = 1 - 2 * fy;
      G.uLaneCam.value.set(LANE_W, 2 * LANE_W);
    } else {
      // cámara exterior (calle 8): todas las calles a la izquierda bajan por el hueco libre de abajo a la izquierda; a la
      // derecha, el arcén liso y las gradas oscuras quedan detrás de la columna de datos
      const seg = rectOf('segment');
      const gapL = sp ? (sp.x + sp.w) / W : 0.46;
      const gapR = seg ? seg.x / W : 0.55;
      const fx = clamp((gapL + gapR) / 2, 0.45, 0.75);
      const fy = sp ? clamp((sp.y + sp.h) / H + 0.02, 0.5, 0.8) : 0.72;
      base.lat = 7.5 * LANE_W - RC; base.h = 1.6; base.fov = 62; base.sx = 2 * fx - 1; base.sy = 1 - 2 * fy;
      G.uLaneCam.value.set(7 * LANE_W, 8 * LANE_W);
    }
  }

  /** Rectángulo NDC del número de velocidad (composición: los focos no se colocan detrás). */
  function avoidRect() {
    const sp = rectOf('speed');
    const W = Math.max(1, ctx.hud.width);
    const H = Math.max(1, ctx.hud.height);
    const tp = rectOf('top');
    if (tp && !finaleOn) lights.u.uAvoid2.value.set((tp.x / W) * 2 - 1, 1 - ((tp.y + tp.h + 4) / H) * 2, ((tp.x + tp.w) / W) * 2 - 1, 1 - ((tp.y - 4) / H) * 2);
    else lights.u.uAvoid2.value.set(2, 2, 2, 2);
    if (!sp || finaleOn) { lights.u.uAvoid.value.set(2, 2, 2, 2); return; }
    // con margen: la etiqueta de zona y la fila del fantasma pueden asomar por encima / debajo del bloque
    const m = 14;
    const mt = 26;
    lights.u.uAvoid.value.set(((sp.x - m) / W) * 2 - 1, 1 - ((sp.y + sp.h + m) / H) * 2, ((sp.x + sp.w + m) / W) * 2 - 1, 1 - ((sp.y - mt) / H) * 2);
  }

  function applyQuality() {
    const eco = ctx.quality === 'eco';
    const lvl = ctx.qualityLevel;
    lights.geometry.instanceCount = lights.count;
    G.uSpec.value = eco ? 0 : 0.32;
    G.uDetail.value = lvl >= 2 ? 1 : lvl === 1 ? 0.6 : 0;
    SU.uDetail.value = lvl >= 1 ? 1 : 0;
  }
  applyQuality();

  /** σ de la cámara: la clase acaba en SIG_END; el mundo avanza en metros reales. Movimiento reducido: solo rectas. */
  function camSigma(t, rmStraights) {
    const dEnd = sEndM - sigAt(t) - driftErr; // metros hasta el final de la clase
    const s = SIG_END - dEnd;
    if (!rmStraights) return s;
    // recorrido "solo rectas": recta de meta y recta opuesta seguidas, con un corte limpio en cada curva
    const L2 = 2 * LS;
    const x = ((s % L2) + L2) % L2;
    return x < LS ? x : x + BEND;
  }

  /** Pone el mundo para que la trayectoria en σ quede en el origen mirando a −z (anticipando las curvas). */
  let cosA = 1;
  let sinA = 0;
  let px0 = 0;
  let pz0 = 0;
  function placeWorld(sig, look) {
    pathPoint(sig, RC, tmpP);
    if (look > 0.05) {
      pathPoint(sig + look, RC, tmpQ);
    } else {
      tmpQ.x = tmpP.x + tmpP.tx; tmpQ.z = tmpP.z + tmpP.tz;
    }
    let dx = tmpQ.x - tmpP.x;
    let dz = tmpQ.z - tmpP.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const a = Math.atan2(dx, -dz);
    cosA = Math.cos(a); sinA = Math.sin(a);
    px0 = tmpP.x; pz0 = tmpP.z;
    world.rotation.set(0, a, 0);
    sky.u.uSkyK.value.y = -a;   // el cielo de foto gira con el estadio
    world.position.set(-(px0 * cosA + pz0 * sinA), 0, -(-px0 * sinA + pz0 * cosA));
  }
  /** Estadio → mundo (marco del corredor). */
  function toWorld(x, y, z, out) {
    const dx = x - px0;
    const dz = z - pz0;
    out.x = dx * cosA + dz * sinA;
    out.y = y;
    out.z = -dx * sinA + dz * cosA;
    return out;
  }

  /** σ → coordenada u del anillo de vallas (para el barrido del drop). */
  function wallU(s) {
    const u = wrapS(s);
    const RW = R0 + WALL;
    const RCPv = R0 + RC;
    if (u < LS) return u;
    if (u < LS + BEND) return LS + ((u - LS) / RCPv) * RW;
    if (u < 2 * LS + BEND) return LS + Math.PI * RW + (u - LS - BEND);
    return 2 * LS + Math.PI * RW + ((u - 2 * LS - BEND) / RCPv) * RW;
  }

  /** ¿El rectángulo de pantalla (px CSS) toca algún bloque del HUD? (solo composición, §15.3) */
  function hitsHud(x0, y0, x1, y1) {
    for (const r of ctx.hud.rects) {
      if (x1 > r.x - 8 && x0 < r.x + r.w + 8 && y1 > r.y - 8 && y0 < r.y + r.h + 8) return true;
    }
    return false;
  }

  function segLabel(i) {
    const s = ctx.segments[i];
    if (!s) return '';
    const z = ctx.palette[s.zone];
    let lbl = String(s.label || z?.short || '');
    if (lbl.length > 13) lbl = z?.short || lbl.slice(0, 12);
    return lbl;
  }

  /**
   * Hueco libre para el rótulo en pantalla (px CSS, esquina superior izquierda en bugPos). Vertical: abajo de la ventana
   * entre el número y el rótulo inferior, alineado con la rejilla del HUD; horizontal: sobre la columna de datos.
   * Si toca algo del HUD (p. ej. un rótulo de momento del reproductor), prueba el otro hueco o no se muestra.
   */
  const bugPos = { x: 0, y: 0, ok: false };
  function tryBug(x, y, w, h) {
    const W = ctx.size.width;
    const H = ctx.size.height;
    if (x < 8 || y < 8 || x + w > W - 8 || y + h > H - 8) return false;
    if (hitsHud(x, y, x + w, y + h)) return false;
    bugPos.x = x; bugPos.y = y; bugPos.ok = true;
    return true;
  }
  function bugSlot(w, h) {
    const W = ctx.size.width;
    const seg = rectOf('segment');
    const sp = rectOf('speed');
    bugPos.ok = false;
    // con las luces de tu récord (ctx.ghostLights) el rótulo va al borde DERECHO del bloque: la hilera de la calle 1
    // entra por la izquierda justo donde se apoyaba y el adelantamiento ocurría debajo del rótulo
    const right = !!ctx.ghostLights;
    if (portrait) {
      const x0 = seg ? (right ? seg.x + seg.w - w : seg.x) : 16;
      if (seg && tryBug(x0, seg.y - 12 - h, w, h)) return bugPos;
      if (sp) tryBug(x0, sp.y + sp.h + 12, w, h);
    } else {
      const x0 = seg ? (right ? seg.x + seg.w - w : seg.x) : W * 0.55;
      if (seg && tryBug(x0, seg.y - 12 - h, w, h)) return bugPos;
      if (sp) tryBug((sp.x + sp.w + (seg ? seg.x : W * 0.55)) / 2 - w / 2, sp.y + sp.h + 14, w, h);
    }
    return bugPos;
  }

  /** Coloca el rótulo (hijo de la cámara) en px CSS con el tamaño exacto: a 1 u delante, con la proyección vigente. */
  function placeBug(x, y, w, h, k) {
    const W = Math.max(1, ctx.size.width);
    const H = Math.max(1, ctx.size.height);
    const e = camera.projectionMatrix.elements;
    const hk = Math.max(0.001, h * k);
    const ndcX = ((x + w / 2) / W) * 2 - 1;
    const ndcY = 1 - ((y + h - hk / 2) / H) * 2;     // se despliega desde abajo
    bugMesh.position.set((ndcX + e[8]) / e[0], (ndcY + e[9]) / e[5], -1);
    bugMesh.scale.set(((w / W) * 2) / e[0], ((hk / H) * 2) / e[5], 1);
    bugMesh.rotation.set(0, 0, 0);
  }

  frameCamera();
  avoidRect();

  const out3 = new THREE.Vector3();
  const clock = { t: 0 }; // reloj de animación del último fotograma (los eventos no reciben el frame)

  return {
    resize({ aspect }) {
      const p = aspect < 0.9;
      hudVersion = ctx.hud.version;
      if (p !== portrait) { portrait = p; frameCamera(); rig.snap(); } else frameCamera();
      avoidRect();
    },

    update(f) {
      const dt = f.dt;
      clock.t = f.time;
      const rm = f.reducedMotion;
      if (ctx.hud.version !== hudVersion) { hudVersion = ctx.hud.version; frameCamera(); avoidRect(); }
      if (tl.version !== sigT.ver) {
        // ajuste manual de velocidades: la tabla se rehace; la cámara no salta y se realinea despacio
        const before = sEndM - sigAt(f.t);
        buildSig();
        sEndM = sigAt(tl.totalSec);
        driftErr += (sEndM - sigAt(f.t)) - before;
      }
      const vTab = kmhOfVis(Math.max(0, f.visualSpeed)) / 3.6;     // m/s reales (con la rampa de la cinta)
      if (f.running) lastKmh = f.speed;
      // «No puedo más»: la cinta baja desde la velocidad a la que te paraste (no desde el último escalón del test)
      if (testRamp && testRamp.t0 >= 0 && !f.finale) {
        const u = (f.time - testRamp.t0) / RAMP;
        if (u >= 1) testRamp = null;
        else {
          const vOv = testRamp.from + (f.speed / 3.6 - testRamp.from) * easeInOutCubic(clamp01(u));
          driftErr += (vOv * f.timeScale - vTab) * dt;
        }
      } else if (testRamp && f.time - testRamp.armedAt > 4) testRamp = null;
      const vNow = vTab;
      if (driftErr !== 0 && !testRamp && !f.finale) {
        const step = (0.06 * vNow + 0.12) * dt;
        driftErr = Math.abs(driftErr) <= step ? 0 : driftErr - Math.sign(driftErr) * step;
      }

      // ── ambiente por zona (todo gradual) ──
      const target = MOODS[f.zone] || MOODS.jog;
      const kM = firstFrame ? 1 : 1 - Math.exp(-dt * (rm ? 0.6 : 1.1));
      firstFrame = false;
      for (let i = 0; i < MOOD_KEYS.length; i++) { const key = MOOD_KEYS[i]; mood[key] += (target[key] - mood[key]) * kM; }
      pauseK = damp(pauseK, f.paused ? 1 : 0, 1.6, dt);
      const celebrating = !!tx.ended && f.time - tx.ended.at < CELEB;
      dimK = damp(dimK, f.zone === 'cooldown' && !f.finale && !celebrating ? 1 : 0, 0.5, dt);
      if (!f.finale) lastRecord = f.record.on;

      // ── σ de la cámara y mundo (a tu velocidad real; en movimiento reducido, solo rectas) ──
      const S = sigAt(f.t);
      const sig = f.finale ? lastSig : camSigma(f.t, rm);
      lastSig = sig;
      placeWorld(sig, rm ? 0 : LOOK);
      G.uSigCam.value = wrapS(sig);
      // sensación de velocidad: contraste y separación de las marcas de ritmo (un número entero por vuelta: sin costura)
      const feel = ctx.speedFeel;
      const fd = feel ? feel.density : 1;
      if (fd !== feelD) { feelD = fd; G.uFeel.value.y = LC / Math.round(LC / (2.5 / fd)); }
      G.uFeel.value.x = feel ? feel.cue : 1;
      G.uMotion.value = clamp((vNow * Math.max(dt, 1 / 60)) / 0.06 - 0.4, 0, 1);

      // ── color de zona exacto en el bordillo (el acento gradual del núcleo, en lo demás) ──
      cur.copy(ctx.zoneColor(f.zone));
      G.uCur.value.copy(cur);
      SU.uAccent.value.copy(f.accent);

      // ── líneas de cambio de tramo: las 3 próximas (+ la recién cruzada mientras se aleja) ──
      let k = 0;
      for (let i = Math.max(1, f.segIndex); i < tl.segCount && k < 3; i++) {
        const T = tl.segStart(i);
        const dtT = T - f.t;
        if (dtT < -1.2) continue;
        const srel = sigAt(T) - S;
        if (srel > 200) break;
        const far = smoothstep(190, 110, srel);
        const after = dtT < 0 ? clamp01(1 + dtT / 1.2) : 1;
        const pre = dtT > 0 && dtT < 3 ? 1 + 0.5 * (1 - dtT / 3) : 1;
        G.uGate.value[k].set(srel, far * after * pre * (f.finale ? 0 : 1), srel > -0.01 ? 1 : 0, 0);
        G.uGateCol.value[k].copy(ctx.zoneColor(tl.segZone(i)));
        k++;
      }
      for (; k < 3; k++) G.uGate.value[k].set(1e5, 0, 0, 0);
      G.uApproach.value = rm ? f.approach * 0.6 : f.approach;

      // ── pacer Wavelight: a tu ritmo objetivo; se adelanta en las subidas (la cinta tarda 4 s) y vuelve a su sitio ──
      const si = f.segIndex;
      const vi = tl.segSpeed(si) / 3.6;
      const vp = si > 0 ? tl.segSpeed(si - 1) / 3.6 : 0;
      const R = si > 0 ? RAMP : START_RAMP;
      const e = f.segElapsed;
      const u = clamp01(e / R);
      const deficit = (vi - vp) * R * (u - easeCubicIntegral(u));
      const relax = Math.exp(-Math.max(0, e - R) / RELAX);
      let headT = PACER_HEAD + clamp(deficit * relax * 2.2, -12, 20);
      if (rm) headT = PACER_HEAD + clamp(deficit * relax * 2.2, -12, 20) * 0.5;
      pacerHead = f.status === 'running' || f.paused ? headT : PACER_HEAD;
      const countFlash = Math.exp(-(f.time - countAt) * 3.2);
      let pint = mood.pint;
      if (f.status === 'ready') pint = 0.45 + 0.5 * countFlash;
      if (f.paused) pint *= 0.35 + 0.3 * (rm ? 0.5 : f.breath);
      G.uPacer.value.set(pacerHead, mood.plen, f.finale ? pint * (1 - f.finale) : pint, 0);
      G.uRailBase.value = mood.rail * (1 + (f.spectrum?.bass || 0) * (rm ? 0 : 0.35)) + Math.exp(-(f.time - dropAt) * 1.5) * 0.08;

      // ── fantasma: fila blanca a su distancia real (comprimida) + línea virtual cuando va por delante ──
      const g = f.ghost;
      let gHead = -100;
      if (g.active && f.speed > 0) {
        const w = -g.deltaM;
        gHead = Math.sign(w) * 22 * (1 - Math.exp(-Math.abs(w) / 20)) + 1.2; // comprimido: a la vista si te saca ventaja
      }
      // con las luces de tu récord (ctx.ghostLights) la fila blanca, su charco y la línea virtual se funden; uGhost.x sigue
      ghostA = damp(ghostA, g.active && !f.finale && !ctx.ghostLights ? 1 : 0, 2, dt);
      G.uGhost.value.set(gHead, 5, ghostA, ghostA * smoothstep(3, 8, gHead) * 0.55);
      G.uGoldK.value = f.record.amount * 0.85;

      // ── marcas de 100 m (distancia REAL): pequeñas marcas blancas en la regleta + rótulo pintado en tu calle ──
      const n0 = Math.floor(f.distanceKm * 10 + 1e-6) + 1;
      let nearMark = -1;
      let nearSrel = 1e5;
      for (let j = 0; j < 4; j++) {
        const n = n0 + j;
        const T = tl.timeForKm(n / 10);
        let srel = 1e5;
        if (Number.isFinite(T)) srel = sigAt(T) - S;
        if (srel > 260 || f.finale) srel = 1e5;
        G.uMarks.value.setComponent(j, srel);
        G.uMarkK.value.setComponent(j, n % 10 === 0 ? 1 : 0);
        if (srel > 2 && srel < nearSrel) { nearSrel = srel; nearMark = n; }
      }
      const laneMid = (G.uLaneCam.value.x + G.uLaneCam.value.y) / 2;
      if (nearMark > 0 && nearSrel < 70) {
        if (nearMark !== markAk) {
          markAk = nearMark;
          if (nearMark % 10 === 0) paintA.set(`${nearMark / 10} KM`);
          else paintA.set(String((nearMark % 10) * 100));
        }
        placeFlat(markA, sig + nearSrel + 1.35, laneMid);
        markA.userData.mesh.material.uniforms.uOpacity.value = smoothstep(70, 45, nearSrel) * 0.85;
        markA.visible = true;
      } else markA.visible = false;

      // ── momentos en la pista: MITAD · ESCALÓN n (test) · META de la clase ──
      let mKey = 0;
      let mSrel = 1e5;
      const hs = sigAt(halfT) - S;
      G.uMoment.value.x = hs;
      G.uMoment.value.y = !isTest && hs > -1.5 && hs < 180 && !f.finale ? smoothstep(180, 110, hs) * clamp01(1 + hs / 1.5) : 0;
      if (!isTest && hs > 3 && hs < 70) { mKey = 1; mSrel = hs; }
      const es = (sEndM - S) - driftErr;
      G.uMoment.value.z = es;
      G.uMoment.value.w = es > -2 && es < 180 && !f.finale ? smoothstep(180, 110, es) * clamp01(1 + es / 2) : 0;
      if (es > 3 && es < 70 && es < mSrel) { mKey = 2; mSrel = es; }
      // (el número del escalón que llega ya no se pinta aquí: es el gráfico de luz del test, más abajo)
      if (mKey && !f.finale) {
        if (mKey !== momentKey) {
          momentKey = mKey;
          if (mKey === 1) paintB.set('MITAD');
          else paintB.set('META');
        }
        placeFlat(markB, sig + mSrel + 2.2, laneMid);
        markB.userData.mesh.material.uniforms.uOpacity.value = smoothstep(70, 45, mSrel) * 0.9;
        markB.visible = true;
        if (markA.visible && Math.abs(nearSrel - mSrel) < 4.5) markA.visible = false;
      } else markB.visible = false;

      // ── barrido de color por el bordillo en el cambio de tramo (una pasada, ~1,6 s) ──
      if (sweep) {
        const se = f.time - sweep.t0;
        if (se > 1.9) { sweep = null; G.uSweep.value.w = 0; } else {
          const front = 1.5 + 34 * se + 38 * se * se;
          G.uSweep.value.set(front, Math.pow(1 - se / 1.9, 1.6) * (rm ? 0 : 1), 9, 1);
          G.uSweepFrom.value.copy(sweepFrom);
          G.uSweepCol.value.copy(sweepTo);
        }
      } else G.uSweep.value.w = 0;

      // ── vallas: medidor de música y barrido del drop alrededor del estadio ──
      SU.uEq.value = f.running && !rm ? 1 : 0.0;
      const de = f.time - dropAt;
      if (de >= 0 && de < 3.4) {
        SU.uSweepB.value.x = (dropU + 30 + de * 190) % SU.uSweepB.value.w;
        SU.uSweepB.value.y = Math.sin(Math.PI * clamp01(de / 3.4)) * (rm ? 0.4 : 1) * dropK;
      } else SU.uSweepB.value.y = 0;

      // ── encendido del estadio: a oscuras antes de empezar; con el 3-2-1 entran las baterías de focos por tercios
      // (cada una con su rampa) y al arrancar ya está todo encendido. Sin cuenta atrás (reanudar, capturas), encendido.
      let powT = rm || f.status !== 'ready' ? 1 : countN >= 3 ? 0.36 : countN === 2 ? 0.68 : countN === 1 ? 0.94 : 0;
      // test VAM: el estadio arranca a media luz y cada escalón enciende más baterías; a tu VAM, todas
      if (isTest) { updateTest(f, S, sig, dt, rm); powT = f.status === 'ready' ? powT * 0.42 : f.finale ? 1 : 0.42 + 0.58 * tx.heat; }
      else {
        // (fuera del test: la grada con su público y, en el plano final, flashes)
        SU.uShow.value.set(0.55 + 0.45 * (f.finale || 0), rm || ctx.quality === 'eco' ? 0 : 0.5 * (f.finale || 0), 0, 0);
      }
      power = power < 0 ? powT : damp(power, powT, isTest ? 1.3 : 2.4, dt);
      const powK = 0.3 + 0.7 * power;

      // ── luces del público: densidad por zona (gradual) y ola que da la vuelta en cada km, en la mitad y al atacar ──
      const crowdT = f.finale ? CROWD_FINAL : f.status === 'ready' ? CROWD_READY * (1 - 0.6 * power) + 0.05
        : isTest ? (celebrating ? CROWD_FINAL : 0.04 + 0.24 * tx.heat + 0.2 * tx.over) * (1 - 0.3 * pauseK)
          : (CROWD[f.zone] ?? 0.06) * (1 - 0.3 * pauseK);
      crowdK = crowdK < 0 ? crowdT : damp(crowdK, crowdT, f.finale ? 1.6 : 0.7, dt);
      const we = f.time - waveAt;
      let wAmp = 0;
      if (we >= 0 && we < WAVE_T && !rm) {
        SU.uCrowd.value.y = (waveU + (we / WAVE_T) * SU.uSweepB.value.w) % SU.uSweepB.value.w;
        wAmp = Math.sin(Math.PI * we / WAVE_T) * waveAmp;
      }
      SU.uCrowd.value.x = crowdK;
      SU.uCrowd.value.z = wAmp;
      SU.uCrowd.value.w = rm ? 0 : f.time % 600;
      SU.uCrowdK.value.set(0.6, f.dpr || 1);

      // ── luz del estadio y focos (en la vuelta a la calma se apaga una de cada dos baterías) ──
      const fe = f.finale ? easeInOutSine(clamp01(f.finale)) : 0;
      const light = mood.light * (1 - 0.08 * pauseK) * powK;
      // (la pista nunca se queda a oscuras: con el estadio a media luz — test, cuenta atrás — baja menos que la grada)
      G.uLight.value = mood.light * (1 - 0.08 * pauseK) * (0.72 + 0.28 * power) * (1 + 2.0 * fe);   // final: a plena luz
      SU.uLight.value = light * (1 + 2.6 * fe) * (1 + 0.8 * tx.heat * (1 - fe));  // final: gradas legibles · test: la grada sale de la penumbra
      G.uFogD.value = 0.0042 * (1 - 0.65 * fe);   // final: el aire se aclara (el óvalo entero se lee)
      SU.uFogD.value = G.uFogD.value;
      lights.u.uDim.value.set(1, 1 - 0.62 * dimK * (1 - fe), power, tx.punch || 0);
      lights.u.uAir.value.y = 0.012 * (1 + 1.1 * tx.heat + (tx.punch || 0));
      sky.u.uHazeK.value = (1 - 0.35 * dimK * (1 - fe)) * powK;
      for (let i = 0; i < 6; i++) {
        const b = lights.specBanks[i];
        toWorld(b.x, b.y, b.z, out3);
        G.uBank.value[i].set(out3.x, out3.y, out3.z, (i % 2 ? 1 - 0.62 * dimK * (1 - fe) : 1) * 0.9 * power);
      }

      // ── rótulo de retransmisión en pantalla: resultado del test VAM (grande) o el próximo cambio a N metros ──
      let want = 0;
      if (!f.finale) {
        if (testSign && f.time - testSign.at > 9) testSign = null;
        if (beatSign && f.time - beatSign.at > 6.5) beatSign = null;
        // el resultado va proyectado en la pista, en grande; la placa queda solo de reserva, si ahí no cabe (y nunca en
        // el primer segundo y medio, mientras el estadio se recoloca tras el salto a la vuelta a la calma)
        const plateWait = !!testSign && isTest && f.time - testSign.at < 1.5;
        if (testSign && !plateWait && fb.ok) testSign = null;
        if (beatSign) {
          if (bugKey.kind !== 3 || bugKey.a !== TI.vamRef) {
            bugKey.kind = 3; bugKey.a = TI.vamRef;
            bug.set('Por encima de tu VAM', ctx.fmtSpeed(TI.vamRef), 'KM/H', GOLD, true);
          }
          want = 1;
        } else if (testSign && !plateWait) {
          if (bugKey.kind !== 2 || bugKey.a !== testSign.vam) {
            bugKey.kind = 2; bugKey.a = testSign.vam;
            bug.set('Test terminado · tu VAM', ctx.fmtSpeed(testSign.vam), 'KM/H', GOLD, true);
          }
          want = 1;
        } else if (f.segIndex + 1 < tl.segCount && f.timeToNext > 10.8 && f.timeToNext < 18 && f.running
          && !(ctx.ghostLights && f.record.on && f.time - recAt < 6)) {
          // (con las luces de tu récord, los 6 s de la celebración del adelantamiento son suyos; el cambio lo siguen
          // anunciando el coach y la tira «Siguiente» del HUD)
          // 18→11 s: el rótulo 3D «En N m»; de 10 s a 0 lo releva la tira «Siguiente» del HUD (motion.js), sin solaparse
          const nI = f.segIndex + 1;
          const dm = Math.max(0, sigAt(tl.segStart(nI)) - S);
          const m10 = Math.max(10, Math.round(dm / 10) * 10);
          const spd = tl.segSpeed(nI);
          if (bugKey.kind !== 1 || bugKey.a !== nI || bugKey.b !== m10 || bugKey.c !== spd) {
            bugKey.kind = 1; bugKey.a = nI; bugKey.b = m10; bugKey.c = spd;
            bug.set(`En ${m10} m`, `${segLabel(nI)} ${ctx.fmtSpeed(spd)}`, '', ctx.palette[tl.segZone(nI)]?.color || '#ffffff');
          }
          want = 1;
        }
      }
      let slotOk = false;
      if (want > 0 || bugA > 0.01) {
        const s = bugSlot(bug.cssW, bug.cssH);
        slotOk = s.ok;
      }
      const tgt = want > 0 && slotOk ? 1 : 0;
      bugA = damp(bugA, tgt, tgt > bugA ? 7 : 10, dt);
      if (bugA < 0.004 && tgt === 0) bugA = 0;
      bugMesh.visible = bugA > 0 && slotOk;
      if (bugMesh.visible) {
        const kk = rm ? 1 : easeOutCubic(clamp01(bugA * 1.15));
        placeBug(bugPos.x, bugPos.y, bug.cssW, bug.cssH, kk);
        bugMat.opacity = clamp01(bugA * 1.4);
      }

      // ── cámara: raíl elevado; en sprint algo más baja y abierta; en pausa sube un palmo; intro: baja de la grúa ──
      if (introOn === null) introOn = f.t < 1 && !rm;
      const T = rig.target;
      const intro = introOn ? (1 - easeOutCubic(clamp01(f.intro))) : 0;
      if (introOn && f.intro >= 1) introOn = false;
      const h = base.h + mood.dh + 0.22 * pauseK + 5.5 * intro;
      if (f.finale > 0) {
        if (!finaleInit) startFinale(f);
        finaleCamera(f, fe, dt);
      } else {
        if (finaleOn) {
          finaleOn = false;
          finaleInit = false;
          avoidRect();
          finMark.visible = false;
          finA = 0;
          G.uRing.value.set(0, 1e6, 0, 1);
          G.uDArea.value = 0.35;
          rig.settle.position = 1.1; rig.settle.lookAt = 1.1; rig.settle.shift = 1.2; rig.settle.fov = 1.4;
          rig.snap();
        }
        T.position.set(base.lat, h, 0);
        T.lookAt.set(base.lat, h, -100);
        T.fov = base.fov + mood.fov;
        T.shift.set(base.sx, base.sy);
        if (introOn && f.intro < 0.02) rig.snap();
      }
      rig.bobScale = f.reducedMotion || f.finale ? 0 : 1;

      // ── fuegos: salen los programados; su luz tiñe un instante el cielo y el satinado de la pista ──
      const glow = fw.update(f.time, (f.dpr || 1) * 1.15 * clamp((f.height || 900) / 900, 0.8, 1.6), ctx.qualityLevel >= 2 ? 0 : (fw.per * fw.bursts) / 2);
      fw.u.uAvoid.value.copy(lights.u.uAvoid.value);
      G.uEnvFx.value.copy(glow).multiplyScalar(0.05);
      sky.u.uSkyFx.value.copy(glow).multiplyScalar(0.01);

      // ── post: exposición por zona, sin destellos (objeto reutilizado) ──
      postOpts.exposure = mood.exp * (f.finale ? 1 + 0.04 * fe : 1);
      post.set(postOpts);
      if (night) {
        const ct = Math.max(0, f.t || 0);
        night.update(f, { power, punch: tx.punch || 0, clock: `${Math.floor(ct / 60)}:${String(Math.floor(ct % 60)).padStart(2, '0')}` });
      }
    },

    event(type, data = {}) {
      const now = clock.t;
      switch (type) {
        case 'gate': {
          sweepFrom.copy(ctx.zoneColor(data.prevZone || 'jog'));
          sweepTo.copy(ctx.zoneColor(data.zone || 'jog'));
          sweep = { t0: now };
          post.pulse(0.04, 1.2);
          // el color del tramo nuevo da la vuelta al estadio por las vallas (una pasada, tenue) y, si atacas (rápido o
          // sprint), una ola de luces recorre la grada
          SU.uSweepBCol.value.copy(sweepTo).lerp(WHITE, 0.2);
          dropAt = now; dropU = wallU(lastSig); dropK = 0.55;
          if ((ctx.zoneRank?.[data.zone] ?? 0) >= 4 && now - waveAt > WAVE_T) { waveAt = now; waveU = wallU(lastSig); waveAmp = 0.3; }
          if (isTest && Number.isFinite(Number(data.index)) && tl.segStage(Number(data.index)) > 0) stageHit(tl.segStage(Number(data.index)), now);
          break;
        }
        case 'seek':
          driftErr = 0;
          sweep = null;
          if (testRamp && testRamp.t0 < 0 && now - testRamp.armedAt < 4) testRamp.t0 = now;
          tx.waveAt = -1e9;
          break;
        case 'testStage': if (isTest) stageHit(Number(data?.stage) || 0, now); break;
        case 'testProjection': {
          // proyección en directo del reproductor (js/training/vam-projection.js): «VAM ≈ 13,0–14,0» bajo el número
          const lo = Number(data?.lo);
          const hi = Number(data?.hi);
          if (isTest && lo > 0 && hi >= lo) {
            tx.projTxt = hi - lo < 0.05 ? `VAM ≈ ${ctx.fmtSpeed(lo)}` : `VAM ≈ ${ctx.fmtSpeed(lo)}–${ctx.fmtSpeed(hi)}`;
            tx.projKey = (Math.round(lo * 10) * 1000 + Math.round(hi * 10)) / 1e7;
          }
          break;
        }
        case 'countdown': countAt = now; { const n = Number(data?.n); if (Number.isFinite(n)) countN = n; } break;
        case 'record': if (data?.on) recAt = now; break;
        case 'km': post.pulse(0.03, 1.4); waveAt = now; waveU = wallU(lastSig); waveAmp = 0.42; break;
        case 'halfway': post.pulse(0.04, 1.6); waveAt = now; waveU = wallU(lastSig); waveAmp = 0.6; break;
        case 'drop': SU.uSweepBCol.value.setRGB(0.9, 0.93, 1.0); dropAt = now; dropU = wallU(lastSig); dropK = 1; post.pulse(0.05, 1.8); break;
        case 'testEnd': {
          const vam = Number(data?.test?.vam ?? data?.vam);
          if (Number.isFinite(vam) && vam > 0) testSign = { at: now, vam };
          testRamp = { from: Math.max(0, lastKmh) / 3.6, armedAt: now, t0: -1 };
          post.pulse(0.05, 2);
          if (isTest) endTest(Number.isFinite(vam) ? vam : 0, Number(data?.test?.stage) || tx.hit, now);
          break;
        }
        case 'finish': post.pulse(0.05, 2.5); break;
        case 'quality': applyQuality(); break;
        default: break;
      }
    },

    /** Solo laboratorio. */
    get _debug() {
      return { bug: bugA, sig: lastSig, drift: driftErr, testRamp: !!testRamp, test: isTest ? { ...TI, heat: tx.heat, over: tx.over, beaten: tx.beaten, ended: tx.ended, power } : null };
    },

    dispose() {
      // (geometrías, materiales y texturas de root/cameraRoot los libera el núcleo)
    },
  };

  /* ───────────── Plano final: corte limpio al plano de héroe del estadio ───────────── */

  function startFinale(f) {
    finaleInit = true;
    finaleOn = true;
    finClock = 0;
    avoidRect();
    finalCol.copy(lastRecord ? gold : ctx.zoneColor(f.zone));
    const res = tx.ended && tx.ended.vam > 0 ? tx.ended : null;
    if (res) {
      // test VAM: el resultado, en grande, en el césped; en oro si superaste tu VAM
      if (res.record) finalCol.copy(gold);
      const up = res.vam - TI.vamRef;
      fin.set(`${ctx.fmtSpeed(res.vam)} KM/H`, 'Tu VAM',
        res.record ? `Nueva marca · +${ctx.fmtSpeed(Math.round(up * 10) / 10)} km/h` : `Escalón ${res.stage} · ${fmtKm(f.distanceKm)} km`,
        res.record ? GOLD : '#ffffff');
    } else fin.set(`${fmtKm(f.distanceKm)} KM`, 'Distancia total');
    tx.finFw = 0.5;
    // distancia total pintada en el césped como un gráfico virtual de retransmisión: anamórfico (trapecio que se abre
    // con la distancia) para la cámara ya asentada ⇒ en pantalla se lee recto, sin la fuga de un rótulo tumbado; queda
    // fijo en el mundo (el avance y el vaivén de la cámara lo deforman apenas: está pintado, no flota)
    {
      const D = portrait ? HALF_STRAIGHT + R0 + WALL + 35 : R0 + WALL + 29;   // distancia en planta cámara → centro del campo
      const dn = portrait ? D - 31 : D - 29;
      const df = portrait ? D + 33 : D + 29;
      const key = 0.86 * (df / dn - 1);
      const wn = portrait ? 31 : 27;
      const c = (dn + df) / 2 - D;                                          // el centro del gráfico, algo más allá del centro
      // (apaisado y con el resultado del test: algo a la izquierda, fuera de la tarjeta final de abajo a la derecha)
      const lx = res && !portrait ? -15 : 0;
      if (portrait) toWorld(c, 0.03, 0, finPos); else toWorld(lx, 0.03, -c, finPos);
      const m = finMark.userData.mesh;
      m.scale.set(wn, df - dn, 1);
      m.material.uniforms.uKey.value = key;
      // «arriba» del gráfico = alejándose de la cámara (eje largo en vertical, eje corto en horizontal)
      if (portrait) toWorld(c + 10, 0.03, 0, finLook); else toWorld(lx, 0.03, -c - 10, finLook);
      finMark.rotation.set(0, Math.atan2(-(finLook.x - finPos.x), -(finLook.z - finPos.z)), 0);
    }
    finMark.position.copy(finPos);
    finMark.visible = true;
    finA = 0;
    finaleCamera(f, 0, 0);
    rig.snap();
  }

  /**
   * Plano de héroe (el HUD se retira: pantalla completa). Corte limpio a la cámara de cabecera de una retransmisión,
   * DENTRO del estadio, entre el anfiteatro y la cubierta (en el espacio del estadio, convertida al marco del corredor,
   * que queda quieto). Vertical: desde lo alto del fondo, a lo largo del eje largo — las dos rectas fugan hacia la curva
   * del fondo, la grada y la corona de focos al fondo, la noche encima. Horizontal: la cámara principal de la tribuna.
   * Secuencia (gradual, sin destellos): el bordillo se enciende desde la meta y da la vuelta entera («vuelta de honor»
   * en el color final; oro si acabaste por delante de tu marca) con una ola de luces del público que lo acompaña por
   * la grada; todas las baterías de focos vuelven; la distancia total aparece pintada en el césped. La cámara avanza
   * despacio mientras tanto y después se queda en un vaivén lentísimo. Movimiento reducido: plano fijo, todo encendido.
   */
  function finaleCamera(f, fe, dt) {
    const T = rig.target;
    const rm = f.reducedMotion;
    finClock += dt || 0;
    const sway = rm ? 0 : smoothstep(3.4, 6.5, finClock);
    const sx = sway * Math.sin((finClock - 3.4) * 0.19);
    const sy = sway * Math.sin((finClock - 3.4) * 0.13);
    const push = rm ? 1 : fe;
    if (portrait) {
      const back = HALF_STRAIGHT + R0 + WALL + 43 - 8 * push;        // en lo alto del anfiteatro del fondo, bajo la cubierta
      toWorld(-back, 39.5 - 3 * push + 0.7 * sy, 2.6 * sx, finCam);
      toWorld(40, 0, 0, finLook);
      T.fov = 50;
      T.shift.set(0, isTest && !rm ? 0.04 : 0.25);   // test: más cielo en cuadro (los fuegos estallan sobre la cubierta)
    } else {
      const side = R0 + WALL + 34 - 5 * push;                        // tribuna de la recta de meta
      toWorld(3.5 * sx, 24.5 - 1.5 * push + 0.5 * sy, side, finCam);
      toWorld(0, 0, -14, finLook);
      T.fov = 50;
      T.shift.set(0, 0.1);
    }
    T.position.copy(finCam);
    T.lookAt.copy(finLook);
    T.roll = 0;
    rig.settle.position = 1.2; rig.settle.lookAt = 1.2; rig.settle.shift = 1.2; rig.settle.fov = 1.2;
    finA = damp(finA, smoothstep(0.55, 0.95, f.finale), 2.2, dt || 0.016);
    finMark.userData.mesh.material.uniforms.uOpacity.value = finA * 0.95;
    // vuelta de honor: el bordillo se enciende desde donde acabaste y da la vuelta entera en el color final
    const lap = rm ? 1 : smoothstep(0.06, 0.98, f.finale);
    G.uCur.value.copy(finalCol);
    G.uRailBase.value = mood.rail + 1.25;
    G.uRing.value.set(wrapS(lastSig), lap >= 1 ? 1e6 : lap * LC, 1.6 * (1 - lap), 0.06);
    G.uGoldK.value = 0;
    G.uDArea.value = -0.9;                                           // los fondos, a plena luz (no un hueco negro)
    // la ola de luces del público acompaña al frente de la vuelta
    if (lap < 1) {
      SU.uCrowd.value.y = wallU(lastSig + lap * LC) % SU.uSweepB.value.w;
      SU.uCrowd.value.z = 0.5 * Math.sin(Math.PI * lap);
    }
    bugMesh.visible = false;
    bugA = 0;
    markA.visible = false;
    markB.visible = false;
    // test VAM (o clase acabada por delante de tu marca): fuegos sobre la cubierta, seguidos al principio y luego sueltos
    if ((isTest || lastRecord) && !rm && finClock < 45) {
      while (tx.finFw <= finClock) {
        const col = fwCols[Math.floor(fwRand() * fwCols.length) % fwCols.length];
        if (portrait) fw.launch(clock.t, 150 + 75 * fwRand(), 64 + 50 * fwRand(), (fwRand() - 0.5) * 130, col, 44 + 18 * fwRand());
        else fw.launch(clock.t, (fwRand() - 0.5) * 300, 56 + 44 * fwRand(), -(112 + 60 * fwRand()), col, 40 + 16 * fwRand());
        tx.finFw += finClock < 11 ? 0.34 + 0.2 * fwRand() : 1.1 + 0.8 * fwRand();
      }
    }
  }

  /* ───────────── Test VAM: el estadio sube contigo ───────────── */

  /** Un escalón nuevo: golpe de luz de los focos, onda por la pista, barrido por las vallas, ola y flashes en la grada. */
  function stageHit(stage, now) {
    if (!(stage > 0) || stage === tx.hit || tx.ended) return;
    tx.hit = stage;
    tx.stageAt = now;
    tx.waveAt = now;
    let idx = -1;
    for (let i = TI.first; i <= TI.last && i >= 0; i++) if (tl.segStage(i) === stage) { idx = i; break; }
    G.uWaveCol.value.copy(ctx.zoneColor(idx >= 0 ? tl.segZone(idx) : 'sprint')).lerp(WHITE, 0.12);
    waveAt = now; waveU = wallU(lastSig); waveAmp = 0.35 + 0.45 * tx.heat;
    dropK = 1;
    post.pulse(0.06 + 0.04 * tx.heat, 1.5);
  }

  /** Fuegos delante de ti, dentro del estadio y sobre la pista, a la altura del hueco libre entre la barra y el número. */
  function fwAhead(at, n, colorOf) {
    for (let k = 0; k < n; k++) {
      let D = 62 + 46 * fwRand();
      const el = (portrait ? 17 + 7 * fwRand() : 9 + 12 * fwRand()) * Math.PI / 180;
      const lat = (fwRand() - 0.5) * (portrait ? 0.42 : 1.2);
      let x = 0;
      let z = 0;
      // (si cae sobre la grada, se acerca hasta quedar sobre la pista o el césped)
      for (let it = 0; it < 4; it++) {
        const xr = lat * D;
        const zr = -D;
        x = px0 + xr * cosA - zr * sinA;
        z = pz0 + xr * sinA + zr * cosA;
        const qx = x - clamp(x, -HALF_STRAIGHT, HALF_STRAIGHT);
        if (Math.hypot(qx, z) - R0 < WALL - 3) break;
        D *= 0.74;
      }
      fw.launch(at + k * (0.28 + 0.3 * fwRand()), x, 1.85 + D * Math.tan(el), z, colorOf(k), D * 0.1 * 1.7 * (0.8 + 0.4 * fwRand()));
    }
  }

  /** Has superado tu VAM: el estadio se pone de oro. */
  function beatVam(now, rm) {
    tx.beatAt = now;
    beatSign = { at: now };
    SU.uSweepBCol.value.copy(gold);
    dropAt = now; dropU = wallU(lastSig); dropK = 1.5;
    waveAt = now; waveU = wallU(lastSig); waveAmp = 1;
    G.uWaveCol.value.copy(gold);
    tx.waveAt = now;
    post.pulse(0.1, 2.6);
    if (!rm) fwAhead(now + 0.15, 5, () => gold);
  }

  /** «No puedo más» (o se acabaron los escalones): el resultado y la celebración. */
  function endTest(vam, stage, now) {
    if (tx.ended) return;
    const record = vam > 0 && TI.vamRef > 0 && vam > TI.vamRef + 0.049;
    tx.ended = { at: now, vam, record, stage };
    tx.flKey = 0;
    beatSign = null;
    SU.uSweepBCol.value.copy(record ? gold : WHITE);
    dropAt = now; dropU = wallU(lastSig); dropK = 1.5;
    waveAt = now; waveU = wallU(lastSig); waveAmp = 1;
    G.uWaveCol.value.copy(record ? gold : WHITE);
    tx.waveAt = now;
    post.pulse(0.1, 3);
    // (los fuegos salen medio segundo después: el reproductor salta a la vuelta a la calma y el estadio cambia de sitio)
    tx.fwEnd = ctx.reducedMotion ? 0 : record ? 10 : 7;
  }

  /** Cada fotograma del test: calor, oro, vallas, anillo, público, flashes, onda, línea de tu VAM y gráficos de pista. */
  function updateTest(f, S, sig, dt, rm) {
    if (tl.version !== TI.ver) scanTest();
    const now = f.time;
    const inStage = f.stage > 0 && !f.finale && TI.first >= 0;
    // VAM provisional (Kuipers): último escalón completo + la fracción del que corres
    let prov = 0;
    if (inStage) {
      const v = tl.segSpeed(f.segIndex);
      const vp = f.segIndex > TI.first ? tl.segSpeed(f.segIndex - 1) : TI.v0;
      prov = vp + (v - vp) * clamp01(f.segElapsed / Math.max(1, f.segDuration));
    }
    if (!tx.init) {
      // (escena creada a mitad del test — reanudar, capturas —: se entra en el estado que toca, sin celebrar nada)
      tx.init = true;
      if (inStage && TI.tRef >= 0 && f.t >= TI.tRef) tx.beaten = true;
      if (!inStage && TI.last >= 0 && f.segIndex > TI.last) tx.ended = { at: -1e9, vam: 0, record: false, stage: 0 };
      if (inStage) tx.hit = f.stage;
    }
    if (inStage) tx.seen = true;
    else if (tx.seen && !tx.ended && f.running && f.segIndex > TI.last) endTest(tl.segSpeed(TI.last), tl.segStage(TI.last), now);
    if (inStage && !tx.ended && !tx.beaten && TI.tRef >= 0 && f.t >= TI.tRef) { tx.beaten = true; beatVam(now, rm); }

    const sinceEnd = tx.ended ? now - tx.ended.at : 1e9;
    if (tx.fwEnd > 0 && sinceEnd > 0.5) {
      const rec = tx.ended.record;
      fwAhead(now, tx.fwEnd, (k) => (rec ? (k % 3 === 1 ? fwCols[1] : gold) : fwCols[k % fwCols.length]));
      tx.fwEnd = 0;
    }
    const celeb = sinceEnd < CELEB;
    const span = Math.max(0.5, TI.vamRef - TI.v0);
    const heatT = f.finale ? 1 : inStage ? clamp01((prov - TI.v0) / span) : celeb ? 1 : tx.ended ? 0.4 : 0;
    const overT = f.finale ? (tx.ended?.record ? 1 : 0) : inStage ? clamp01((prov - TI.vamRef) / 1.5) : celeb && tx.ended.record ? 1 : 0;
    const first = tx.show < 0;
    tx.heat = first ? heatT : damp(tx.heat, heatT, 0.9, dt);
    tx.over = first ? overT : damp(tx.over, overT, 0.9, dt);
    const goldT = f.finale ? (tx.ended?.record || lastRecord ? 1 : 0) : (inStage && tx.beaten) || (celeb && tx.ended.record) ? 1 : 0;
    tx.goldK = first ? goldT : damp(tx.goldK, goldT, 0.7, dt);
    tx.show = 1;
    const heat = tx.heat;
    const over = tx.over;
    const finK = f.finale ? easeInOutSine(clamp01(f.finale)) : 0;

    // color de los efectos: el del escalón; oro por encima de tu VAM; en el plano final, el del final
    fxCol.copy(f.finale ? finalCol : f.accent).lerp(gold, f.finale ? 0 : tx.goldK);
    G.uFxCol.value.copy(fxCol);
    SU.uFxCol.value.copy(fxCol);
    G.uGoldK.value = Math.max(G.uGoldK.value, tx.goldK * 0.85);

    // golpes de luz (decaen solos)
    const eStage = Math.exp(-Math.max(0, now - tx.stageAt) * 2.0);
    const eBeat = Math.exp(-Math.max(0, now - tx.beatAt) * 0.9);
    const eEnd = Math.exp(-Math.max(0, sinceEnd) * 0.55);
    tx.punch = (rm ? 0.3 : 1) * (0.8 * eStage * (0.45 + 0.55 * heat) + 1.4 * eBeat + 1.8 * eEnd);
    const beatK = rm ? 0 : (f.beat || 0) * smoothstep(0.55, 1, heat);    // cerca de tu VAM, la pista late con la música

    // pista: líneas de calle encendidas + resplandor de las vallas en el arcén + línea del escalón como barra de luz
    const idle = f.status === 'ready' ? 0.4 : 1;
    const boards = (0.1 + 0.34 * heat + 0.22 * over + 0.5 * eStage + 0.5 * eEnd) * idle * (1 - 0.5 * dimK) * (1 + 0.6 * finK);
    G.uLaneLed.value.set(
      (0.05 + 0.24 * heat + 0.2 * over + 0.4 * eBeat + 0.3 * eEnd) * (1 + 0.3 * beatK) * idle * (1 - 0.6 * dimK),
      (0.1 + 0.24 * heat) * (1 + 0.3 * beatK) * idle * (1 - 0.6 * dimK) * (1 - finK),
      boards * 0.5, 0);
    G.uWave.value.w = 0.11;
    // onda del escalón
    const we = now - tx.waveAt;
    if (we >= 0 && we < 2.6 && !rm) G.uWave.value.set(-3 + 52 * we + 22 * we * we, Math.pow(1 - we / 2.6, 1.5) * (0.75 + 0.5 * heat), 12 + 26 * we, 0.11);
    else G.uWave.value.y = 0;

    // gradas: público, flashes, vallas LED (las flechas corren en tu sentido) y anillo del anfiteatro
    tx.chev = (tx.chev + dt * (rm ? 0 : 5 + 3.2 * (f.speed || 0) / 3.6)) % 320;
    tx.pack = (tx.pack + dt * (rm ? 0 : 0.05 + 0.1 * heat + 0.06 * over)) % 1;
    const flashes = rm || ctx.quality === 'eco' ? 0
      : Math.min(2.6, 0.03 + 0.22 * heat * heat + 0.5 * over + 1.3 * eStage * (0.3 + 0.7 * heat) + 2.2 * eBeat + 2.6 * eEnd + 1.1 * finK);
    SU.uShow.value.set(
      f.status === 'ready' ? 0.3 : Math.max(0.3 + 0.7 * heat, finK, celeb ? 1 : 0),
      flashes, boards, (0.06 + 0.3 * heat + 0.26 * over + 0.4 * eEnd) * idle * (1 - 0.5 * dimK) * (1 + 0.5 * finK));
    SU.uShowT.value.set(tx.chev, tx.pack, 0, 0);

    // línea de TU VAM y su rótulo en la pista (antes de la línea: lo pisas y luego la cruzas)
    let vSrel = 1e5;
    if (TI.tRef >= 0 && !tx.ended && !tx.beaten && !f.finale) vSrel = sigAt(TI.tRef) - S;
    G.uVamLine.value.set(vSrel, vSrel > -3 && vSrel < 220 ? smoothstep(220, 140, vSrel) : 0, 0, 0);
    // tras cruzarla sigue encendida un momento mientras se aleja por detrás
    if (tx.beaten && now - tx.beatAt < 1.2 && TI.tRef >= 0) G.uVamLine.value.set(sigAt(TI.tRef) - S, 1 - (now - tx.beatAt) / 1.2, 0, 0);

    // Gráficos de luz proyectados en la pista. Cada uno VIAJA contigo en el hueco libre de la pantalla (floorDims) y,
    // cuando su línea llega, se queda clavado en la pista y lo pisas. Solo uno a la vez: el de la línea más cercana.
    // bajo la cámara de VERDAD (la del fotograma anterior): el director del núcleo la desplaza de lado en sus planos de
    // recuperación y, centrado en la cámara teórica, el rótulo salía inclinado
    const camX = camera.matrixWorld.elements[12];
    const laneC = Number.isFinite(camX) && Math.abs(camX - base.lat) < 6 ? camX : base.lat;
    const fadeM = Math.max(2.5, (f.speed || 8) / 3.6);  // metros en los que un gráfico se funde al dejarlo atrás (≈ 1 s)
    let stageD = 1e5;                                  // metros hasta la línea del próximo escalón
    let stageT = 1e5;                                  // y segundos
    if (!tx.ended && !f.finale && f.status !== 'ready') {
      const nI = f.segIndex + 1;
      if (nI < tl.segCount && tl.segStage(nI) > 0) {
        stageD = sigAt(tl.segStart(nI)) - S;
        stageT = tl.segStart(nI) - f.t;
        const key = tl.segStage(nI) * 1000 + Math.round(tl.segSpeed(nI) * 10) + tx.projKey;
        if (stageT < FLOOR_T) {
          if (Math.floor(key) !== Math.floor(tx.flKey)) {
            tx.flAt = now;
            tx.flCol.copy(ctx.zoneColor(tl.segZone(nI))).lerp(WHITE, 0.4).multiplyScalar(1.15);
          }
          tx.flKey = key; tx.flN = tl.segStage(nI);
          tx.flS = S + stageD;
        }
      }
    } else tx.flKey = 0;
    const vT = TI.tRef >= 0 ? TI.tRef - f.t : 1e5;
    const vamFirst = vSrel < stageD;                   // la línea de tu VAM llega antes que la del escalón
    const wantStage = tx.flKey && !vamFirst && tx.vmKey !== 1;
    // (el rótulo de tu VAM empieza en su línea dorada, como el del escalón: la cruzas y lo pisas)
    if (vamFirst && vSrel > -1 && vT < FLOOR_T && !tx.ended) { if (tx.vmKey !== 1) { tx.vmKey = 1; tx.vmAt = now; } tx.vmS = S + vSrel; }
    if (tx.ended && tx.vmKey === 1) tx.vmKey = 0;
    // (el resultado sale un segundo después de «No puedo más»: el reproductor salta a la vuelta a la calma y el
    // estadio cambia de sitio; antes saldría colocado para la recta o la curva en la que ya no estás)
    const wantVam = tx.vmKey === 1 || (tx.ended && tx.ended.vam > 0 && !f.finale && sinceEnd > 1.1 && sinceEnd < 60);
    // (un rótulo que acaba de aparecer toma su sitio de golpe: nada de llegar deslizándose desde el hueco del anterior)
    const fresh = (wantStage && now - tx.flAt < 0.05) || (tx.vmKey === 1 && now - tx.vmAt < 0.05) || (tx.ended && wantVam && tx.vmKey !== 2);
    if (fresh) fb.init = false;
    const dims = wantStage || wantVam ? floorDims(dt) : fb;
    let showStage = false;
    if (wantStage && dims.ok) {
      const d = Math.min(dims.near, tx.flS - S + 0.9);   // borde cercano: viaja contigo hasta que llega la línea
      // (al pisar su línea se funde en un segundo: el gráfico es largo y, si no, seguiría pasando bajo el HUD medio minuto)
      const gone = clamp01(1 + (tx.flS - S) / fadeM);
      if (gone > 0.002) {
        showStage = true;
        // (la velocidad ya la da la tira «Siguiente» del HUD; al lado, si el reproductor la manda, la proyección en
        // directo: entre qué velocidades saldrá tu VAM a este paso)
        floorS.set('Escalón', String(tx.flN), tx.projTxt, dims.aspect);
        layFloor(stageMark, d, dims.len, laneC, dims.wn, dims.key, dims.slope);
        const m = stageMark.material.uniforms;
        m.uOpacity.value = (rm ? 1 : clamp01((now - tx.flAt) / 0.7)) * 0.95 * gone;
        m.uColor.value.copy(tx.flCol);
      } else tx.flKey = 0;
    }
    stageMark.visible = showStage;
    if (showStage && markA.visible) markA.visible = false;

    // tu VAM (antes de cruzarla: «supérala») o el resultado (al acabar: va contigo 7 s y luego se queda en la pista)
    let showVam = false;
    const vm = vamMark.material.uniforms;
    if (wantVam && dims.ok && !tx.ended) {
      const d = Math.min(dims.near, tx.vmS - S + 0.9);
      const gone = clamp01(1 + (tx.vmS - S) / (fadeM * 2));
      if (gone > 0.002) {
        floorV.set('Tu VAM', ctx.fmtSpeed(TI.vamRef), tx.beaten ? 'superada' : 'supérala', dims.aspect);
        showVam = true;
        layFloor(vamMark, d, dims.len, laneC, dims.wn, dims.key, dims.slope);
        vm.uOpacity.value = (rm ? 1 : clamp01((now - tx.vmAt) / 0.7)) * 0.95 * gone;
        vm.uColor.value.copy(gold).multiplyScalar(1.05);
      } else tx.vmKey = 0;
    } else if (wantVam && dims.ok) {
      tx.vmKey = 2;
      const e = tx.ended;
      const up = Math.round((e.vam - TI.vamRef) * 10) / 10;
      floorV.set(e.record ? 'Nueva VAM' : 'Tu VAM', ctx.fmtSpeed(e.vam), e.record ? `+${ctx.fmtSpeed(up)} km/h` : 'km/h', dims.aspect);
      if (sinceEnd < 8) tx.resS = S + dims.near;
      const d = tx.resS - S;
      const gone = clamp01(1 + (d - dims.near) / (fadeM * 1.2));   // tras sus 7 s contigo, se queda atrás y se funde
      if (gone > 0.002) {
        showVam = true;
        layFloor(vamMark, d, dims.len, laneC, dims.wn, dims.key, dims.slope);
        vm.uOpacity.value = clamp01((sinceEnd - 1.1) / 0.5) * 0.98 * gone;
        vm.uColor.value.copy(e.record ? gold : tmpCol.copy(WHITE).lerp(gold, 0.25)).multiplyScalar(e.record ? 1.1 : 0.8);
      }
    }
    vamMark.visible = showVam;
    if (showVam && markA.visible) markA.visible = false;
  }
}

function fmtKm(km) {
  const v = Math.max(0, Number(km) || 0);
  return v.toFixed(2).replace('.', ',');
}

/** Une varias PlaneGeometry (ya transformadas) en una sola (mismos atributos). */
function mergeQuads(THREE, geos) {
  let nv = 0;
  let ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const idx = [];
  let ov = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, ov * 3);
    uv.set(g.attributes.uv.array, ov * 2);
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.array[i] + ov);
    ov += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}
