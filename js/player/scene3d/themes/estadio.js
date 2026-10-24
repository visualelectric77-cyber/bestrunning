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
import { RC, LANE_W, LS, LC, BEND, wrapS, pathPoint, easeCubicIntegral, A as HALF_STRAIGHT, R0, WALL } from './estadio/track.js';
import { buildSky, buildGround, buildStands, buildLights } from './estadio/stadium.js';
import { DECAL_VERT, DECAL_FRAG } from './estadio/shaders.js';
import { laneNumbersTexture, makePaint, makeBug, makeFinalGraphic } from './estadio/graphics.js';

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

export function createTheme(ctx) {
  const { THREE, root, camera, rig, post, timeline: tl, util } = ctx;
  const { clamp, clamp01, damp, smoothstep, easeInOutSine, easeOutCubic, easeInOutCubic } = util;
  const C = (hex) => new THREE.Color(hex);
  const aniso = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy?.() || 1);
  const rand = ctx.rng(4242);
  const tlRaw = ctx.tl;

  camera.near = 0.1;
  camera.far = 2400;
  post.set({ toneMapping: 'aces', exposure: 0.93, bloomStrength: 0.4, bloomThreshold: 1.0, bloomRadius: 0.26, vignette: 0.28, saturation: 1 });
  const postOpts = { exposure: 0.93 }; // reutilizado cada fotograma (sin asignaciones)

  // ── mundo (espacio del estadio): se transforma cada fotograma para que tu posición quede en el origen mirando a −z ──
  const world = new THREE.Group();
  world.name = 'estadio-world';
  root.add(world);

  const sky = buildSky(THREE, camera);
  root.add(sky.mesh);
  const ground = buildGround(THREE, ctx.shaders.NOISE);
  world.add(ground.mesh);
  const stands = buildStands(THREE, ctx.shaders.NOISE, ctx.spectrumTexture);
  world.add(stands.mesh);
  const lights = buildLights(THREE, rand);
  world.add(lights.mesh);
  const G = ground.u;
  const SU = stands.u;

  // ── decals (shader propio: niebla del estadio y fundido al acercarse: nada enorme bajo el rótulo inferior) ──
  function decalMat(map, color, opacity = 1, near = [0, 0], extra = {}) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: map }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity },
        uFogD: { value: G.uFogD.value }, uFog: { value: G.uFog.value }, uNear: { value: new THREE.Vector2(near[0], near[1]) },
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
  let countAt = -1e9;
  let testSign = null;       // { at, vam }
  let recAt = -1e9;          // reloj del último 'record' {on: true} (con las luces de tu récord, el rótulo no lo pisa)
  let testRamp = null;       // «No puedo más»: la cinta baja desde TU escalón, no desde el último del test
  let lastKmh = 0;
  let lastRecord = false;
  let finaleOn = false;
  let finaleInit = false;
  let finAng = 0;
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
  const isTest = !!tlRaw?.isTest;
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
    if (!sp || finaleOn) { lights.u.uAvoid.value.set(2, 2, 2, 2); return; }
    // con margen: la etiqueta de zona y la fila del fantasma pueden asomar por encima / debajo del bloque
    const m = 14;
    const mt = 26;
    lights.u.uAvoid.value.set(((sp.x - m) / W) * 2 - 1, 1 - ((sp.y + sp.h + m) / H) * 2, ((sp.x + sp.w + m) / W) * 2 - 1, 1 - ((sp.y - mt) / H) * 2);
  }

  function applyQuality() {
    const eco = ctx.quality === 'eco';
    const lvl = ctx.qualityLevel;
    lights.mesh.geometry.instanceCount = lights.count;
    G.uSpec.value = eco ? 0 : 0.22;
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
      dimK = damp(dimK, f.zone === 'cooldown' && !f.finale ? 1 : 0, 0.5, dt);
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
      if (isTest && f.segIndex + 1 < tl.segCount) {
        const nI = f.segIndex + 1;
        const st = tl.segStage(nI);
        if (st > 0) {
          const ss = sigAt(tl.segStart(nI)) - S;
          if (ss > 3 && ss < 70 && ss < mSrel) { mKey = 100 + st; mSrel = ss; }
        }
      }
      if (mKey && !f.finale) {
        if (mKey !== momentKey) {
          momentKey = mKey;
          if (mKey === 1) paintB.set('MITAD');
          else if (mKey === 2) paintB.set('META');
          else paintB.set(String(mKey - 100), 'Escalón');
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
        SU.uSweepB.value.y = Math.sin(Math.PI * clamp01(de / 3.4)) * (rm ? 0.4 : 1);
      } else SU.uSweepB.value.y = 0;

      // ── luz del estadio y focos (en la vuelta a la calma se apaga una de cada dos baterías) ──
      const fe = f.finale ? easeInOutSine(clamp01(f.finale)) : 0;
      const light = mood.light * (1 - 0.08 * pauseK);
      G.uLight.value = light * (1 + 1.1 * fe);
      SU.uLight.value = light * (1 + 2.2 * fe);   // final: gradas legibles
      G.uFogD.value = 0.0042 * (1 - 0.65 * fe);   // final: el aire se aclara (el óvalo entero se lee)
      SU.uFogD.value = G.uFogD.value;
      lights.u.uDim.value.set(1, 1 - 0.62 * dimK * (1 - fe), 0, 0);
      sky.u.uHazeK.value = 1 - 0.35 * dimK;
      for (let i = 0; i < 6; i++) {
        const b = lights.specBanks[i];
        toWorld(b.x, b.y, b.z, out3);
        G.uBank.value[i].set(out3.x, out3.y, out3.z, (i % 2 ? 1 - 0.62 * dimK : 1) * 0.9);
      }

      // ── rótulo de retransmisión en pantalla: resultado del test VAM (grande) o el próximo cambio a N metros ──
      let want = 0;
      if (!f.finale) {
        if (testSign && f.time - testSign.at > 9) testSign = null;
        if (testSign) {
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

      // ── post: exposición por zona, sin destellos (objeto reutilizado) ──
      postOpts.exposure = mood.exp * (f.finale ? 1 + 0.04 * fe : 1);
      post.set(postOpts);
    },

    event(type, data = {}) {
      const now = clock.t;
      switch (type) {
        case 'gate': {
          sweepFrom.copy(ctx.zoneColor(data.prevZone || 'jog'));
          sweepTo.copy(ctx.zoneColor(data.zone || 'jog'));
          sweep = { t0: now };
          post.pulse(0.04, 1.2);
          break;
        }
        case 'seek':
          driftErr = 0;
          sweep = null;
          if (testRamp && testRamp.t0 < 0 && now - testRamp.armedAt < 4) testRamp.t0 = now;
          break;
        case 'countdown': countAt = now; break;
        case 'record': if (data?.on) recAt = now; break;
        case 'km': post.pulse(0.03, 1.4); break;
        case 'halfway': post.pulse(0.04, 1.6); break;
        case 'drop': dropAt = now; dropU = wallU(lastSig); post.pulse(0.05, 1.8); break;
        case 'testEnd': {
          const vam = Number(data?.test?.vam ?? data?.vam);
          if (Number.isFinite(vam) && vam > 0) testSign = { at: now, vam };
          testRamp = { from: Math.max(0, lastKmh) / 3.6, armedAt: now, t0: -1 };
          post.pulse(0.05, 2);
          break;
        }
        case 'finish': post.pulse(0.05, 2.5); break;
        case 'quality': applyQuality(); break;
        default: break;
      }
    },

    /** Solo laboratorio. */
    get _debug() { return { bug: bugA, sig: lastSig, drift: driftErr, testRamp: !!testRamp }; },

    dispose() {
      // (geometrías, materiales y texturas de root/cameraRoot los libera el núcleo)
    },
  };

  /* ───────────── Plano final: corte limpio a un plano cenital del óvalo entero ───────────── */

  function startFinale(f) {
    finaleInit = true;
    finaleOn = true;
    avoidRect();
    finalCol.copy(lastRecord ? gold : ctx.zoneColor(f.zone));
    fin.set(`${fmtKm(f.distanceKm)} KM`, 'Distancia total');
    // distancia total pintada en el centro del césped, legible desde la cámara del plano final
    toWorld(0, 0.03, 0, finPos);
    finAng = 0;
    finMark.position.copy(finPos);
    finMark.visible = true;
    finA = 0;
    finaleCamera(f, 0, 0);
    rig.snap();
  }

  /**
   * Cámara del plano final (en el espacio del estadio, convertida al marco del corredor, que queda quieto): vertical,
   * desde detrás de una curva a lo largo del eje largo (el óvalo llena el alto); horizontal, desde un lateral. Deriva
   * en órbita lentísima (≤ 1°/s). El bordillo se enciende entero en el color final; las gradas, legibles.
   */
  function finaleCamera(f, fe, dt) {
    const T = rig.target;
    finAng += (f.reducedMotion ? 0 : 0.012) * (dt || 0);
    const ca = Math.cos(finAng);
    const sa = Math.sin(finAng);
    let px; let py; let pz; let lx; let lz;
    // dentro de la abertura de la cubierta (nada la tapa), alta: el óvalo entero, gradas alrededor
    if (portrait) { px = -(HALF_STRAIGHT + 50); py = 175; pz = 6; lx = 14; lz = 0; }
    else { px = -6; py = 150; pz = 70; lx = 0; lz = -4; }
    toWorld(px * ca - pz * sa, py, px * sa + pz * ca, finCam);
    toWorld(lx, 0, lz, finLook);
    T.position.copy(finCam);
    T.lookAt.copy(finLook);
    T.fov = portrait ? 58 : 54;
    T.shift.set(portrait ? 0 : -0.14, portrait ? 0.12 : 0.15);
    T.roll = 0;
    rig.settle.position = 1.2; rig.settle.lookAt = 1.2; rig.settle.shift = 1.2; rig.settle.fov = 1.2;
    // el gráfico mira a la cámara final (su «arriba» se aleja de ella)
    const fx = finPos.x - finCam.x;
    const fz = finPos.z - finCam.z;
    const gw = portrait ? 30 : 34;
    finMark.rotation.set(0, Math.atan2(-fx, -fz), 0);
    finMark.userData.mesh.scale.set(gw, gw * 0.5 * 2.3, 1);
    finA = damp(finA, smoothstep(0.25, 0.75, f.finale), 2.5, dt || 0.016);
    finMark.userData.mesh.material.uniforms.uOpacity.value = finA * 0.95;
    // el óvalo entero dibujado por el bordillo, en el color final (oro si acabaste por delante de tu marca)
    G.uCur.value.copy(finalCol);
    G.uRailBase.value = mood.rail + 1.25 * Math.max(fe, 0.35);
    G.uGoldK.value = 0;
    bugMesh.visible = false;
    bugA = 0;
    markA.visible = false;
    markB.visible = false;
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
