// BestRunning · escenario NOCHE DE HALLOWEEN (§15.2-3). Corres de noche por un camino de tierra húmeda que cruza un
// bosque de árboles desnudos y retorcidos, con niebla baja que se arrastra y una luna llena enorme y anaranjada saliendo
// tras las colinas. A ambos lados del camino, calabazas talladas con vela cada 7 m REALES por lado (al tresbolillo: una
// cada 3,5 m): la señal de velocidad cercana, como las juntas y balizas de los otros escenarios. A lo lejos, la verja y
// las lápidas de un cementerio en penumbra, la casa encantada en silueta con una ventana encendida al final del camino
// y, de vez en cuando, una bandada lejana de murciélagos que cruza despacio por delante de la luna. Da un poco de miedo
// y está oscuro, pero sin sustos: es una clase de entrenamiento.
// A VELOCIDAD REAL: el suelo, las calabazas, los árboles y las lápidas se mueven a km/h ÷ 3,6 m/s con la distancia real
// del plan (tabla con la misma rampa de la cinta que estadio.js), nunca con la distancia visual. Cámara a 1,7 m (altura
// de ojos) con el balanceo de zancada del núcleo; el director solo se permite planos cercanos a esa altura.
// Paleta: negro y morado profundo; el naranja de calabaza como acento cálido. El color de la zona tiñe la luz de las
// velas (y sus charcos de luz en el suelo mojado).
// Momentos (sin destellos, §15.2): en los últimos segundos del tramo las velas de delante bajan despacio; al cambiar de
// tramo se van encendiendo EN CADENA hacia delante con el color nuevo, una sola vez. Al empezar la clase, la primera
// cadena enciende el camino. Final: grúa lenta a un plano alto del camino con todas las calabazas encendidas en el
// color final (oro si acabaste por delante de tu marca). Clase con workout.event === 'halloween': rótulo sobrio
// «NOCHE DE HALLOWEEN» al principio, en el hueco libre del HUD.
// Composición (§15.3, sin máscaras): vertical — horizonte justo bajo el número; la casa al final del camino y la luna
// medio salida a la derecha, ambas en la franja entre el número y el horizonte; el cielo tras el número, casi negro.
// Horizontal — horizonte bajo, el camino nace en el hueco entre el número y la columna de datos; la luna arriba a la
// derecha, sobre la columna. Coste: 6 llamadas de dibujo (cielo, suelo, árboles, cementerio, calabazas, halos) + el
// rótulo al principio; shaders baratos; cero asignaciones por fotograma.
import { createShared, bendPhases, CAM_H, PUMP_D, TREE_D, GRAVE_D, TEX_PERIOD } from './halloween/common.js';
import { createSky } from './halloween/sky.js';
import { createGround } from './halloween/ground.js';
import { createPumpkins } from './halloween/pumpkins.js';
import { createTrees, createGraves } from './halloween/forest.js';

export const meta = {
  id: 'halloween',
  name: 'Noche de Halloween',
  description: 'Un camino entre calabazas encendidas bajo la luna llena.',
};

const DEG = Math.PI / 180;
const DTT = 0.25;          // resolución de la tabla de distancia real (s)
const GOLD = '#ffd60a';
const BAT_OFF = 52;        // s: la primera bandada cruza ~35 s después de entrar en el escenario, luego cada 85 s
const CHAIN_SEC = 2.6;     // duración del encendido en cadena (s)
const CHAIN_FAR = 270;     // hasta dónde llega la cadena (m)
const PRE_DIM = 0.55;      // cuánto bajan las velas de delante antes del cambio
const VIS10 = Math.pow(10, 0.85) / 1.35;
/** Inversa exacta de visualSpeed() del núcleo: u/s visuales → km/h reales (conserva la forma de las rampas). */
const kmhOfVis = (v) => (v > 0 ? Math.pow(v * VIS10, 1 / 1.85) : 0);

// Alcance (m por delante) de cada pieza según la calidad: eco, low, med, high
const RANGE = {
  pumpkins: [120, 170, 220, 262],
  trees: [100, 140, 175, 205],
  graves: [100, 140, 180, 215],
};
const BACK = { pumpkins: 12, trees: 16, graves: 10 };

// Ambiente por zona: altura de ojos (relativa), FOV extra, exposición
const MOOD_KEYS = ['dh', 'fov', 'exp'];
const MOODS = {
  warmup: { dh: 0.02, fov: 0, exp: 0.95 },
  walk: { dh: 0.03, fov: -1, exp: 0.94 },
  jog: { dh: 0, fov: 0, exp: 0.95 },
  run: { dh: -0.01, fov: 0.5, exp: 0.96 },
  fast: { dh: -0.03, fov: 1, exp: 0.96 },
  sprint: { dh: -0.05, fov: 2, exp: 0.97 },
  cooldown: { dh: 0.04, fov: -1, exp: 0.93 },
};

export function createTheme(ctx) {
  const { THREE, root, camera, rig, post, timeline: tl, util } = ctx;
  const { clamp, clamp01, damp, easeInOutSine, easeOutCubic } = util;
  const tlRaw = ctx.tl;

  camera.near = 0.08;
  camera.far = 2600;
  ctx.renderer.setClearColor(0x030206, 1);
  post.set({ toneMapping: 'aces', exposure: 0.95, bloomStrength: 0.46, bloomThreshold: 0.9, bloomRadius: 0.32, vignette: 0.34, saturation: 1.04 });
  const postOpts = { exposure: 0.95 }; // reutilizado cada fotograma

  // ── piezas ──
  const shared = createShared(THREE);
  const sky = createSky(ctx, shared);
  const ground = createGround(ctx, shared);
  const maxPump = Math.ceil((BACK.pumpkins + 40 + RANGE.pumpkins[3]) / (PUMP_D / 1.5)) + 2;
  const pumpkins = createPumpkins(ctx, shared, maxPump);
  const trees = createTrees(ctx, shared, Math.ceil((BACK.trees + 20 + RANGE.trees[3]) / TREE_D) + 2, 4);
  const graves = createGraves(ctx, shared, Math.ceil((BACK.graves + 20 + RANGE.graves[3]) / GRAVE_D) + 2);
  root.add(ground.mesh, trees.mesh, graves.mesh, pumpkins.mesh, pumpkins.glow, sky.mesh);
  const S_ = shared;

  // ── rótulo «NOCHE DE HALLOWEEN» (cuelga de la cámara, en el hueco libre del HUD) ──
  const isEvent = ctx.workout?.event === 'halloween';
  let title = null;
  if (isEvent) {
    const tex = ctx.textTexture('Noche de Halloween', { size: 72, weight: 600, tracking: 0.34, color: '#ffe6cc', pad: 0.3 });
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, color: new THREE.Color(0.95, 0.9, 0.86),
    });
    title = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    title.frustumCulled = false;
    title.renderOrder = 950;
    title.visible = false;
    title.userData.aspect = tex.userData.aspect;
    ctx.cameraRoot.add(title);
  }
  const titlePos = { x: 0, y: 0, w: 0, h: 0, ok: false };

  // ── colores ──
  const gold = new THREE.Color(GOLD);
  const cur = new THREE.Color();
  const finalCol = new THREE.Color();

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

  // ── estado ──
  const mood = { ...MOODS.jog };
  const base = { h: CAM_H, fov: 60, sx: 0, sy: 0.05 };
  const comp = { moonAz: 0.2, moonEl: 0.02, moonR: 0.06, houseScale: 0.012 };
  const bend = { x: 0, y: 0, z: 0, w: 0 };
  const tmpV = new THREE.Vector3();
  let portrait = true;
  let hudVersion = -1;
  let driftErr = 0;
  let lastS = 0;
  let firstFrame = true;
  let introOn = null;
  let chain = null;          // { t0, dur }
  let chainNew = 'jog';
  let lastRecord = false;
  let finaleInit = false;
  let finaleOn = false;
  let readyDim = 1;
  let pauseK = 0;
  let titleA = 0;
  let lastFeel = -1;
  const clock = { t: 0 };
  const rectOf = (kind) => { for (const r of ctx.hud.rects) if (r.kind === kind) return r; return null; };

  /** Píxel CSS → ángulos (azimut, elevación) con la cámara nivelada del encuadre base. */
  function pxToAngles(px, py, fovDeg, sx, sy, out) {
    const W = Math.max(1, ctx.hud.width);
    const H = Math.max(1, ctx.hud.height);
    const tanV = Math.tan((fovDeg / 2) * DEG);
    const x = ((2 * px) / W - 1 - sx) * tanV * (W / H);
    const y = (1 - (2 * py) / H - sy) * tanV;
    out.az = Math.atan(x);
    out.el = Math.atan2(y, Math.sqrt(1 + x * x));
    out.rad = (2 * tanV) / H; // rad por píxel en el centro
    return out;
  }
  const ang = { az: 0, el: 0, rad: 0 };

  /** Encaje por composición (sin máscaras): horizonte, luna, casa y rótulo según el HUD. */
  function frameCamera() {
    const W = Math.max(1, ctx.hud.width);
    const H = Math.max(1, ctx.hud.height);
    const sp = rectOf('speed');
    const seg = rectOf('segment');
    const top = rectOf('top');
    const spB = sp ? sp.y + sp.h : H * 0.4;
    if (portrait) {
      // horizonte justo bajo el número; la ventana del camino entre el número y el bloque inferior
      const fy = clamp(spB / H + 0.07, 0.42, 0.66);
      base.fov = 60; base.sx = 0; base.sy = 1 - 2 * fy;
      // luna medio salida tras las colinas, a la derecha, con su borde superior bajo el número
      const Rpx = clamp(W * 0.105, 34, 58);
      const cx = Math.min(W - Rpx * 0.6, W * 0.79);
      const cy = spB + 12 + Rpx;
      pxToAngles(cx, cy, base.fov, base.sx, base.sy, ang);
      comp.moonAz = ang.az; comp.moonEl = ang.el; comp.moonR = Rpx * ang.rad;
      comp.houseScale = Math.min(0.0125, Math.max(0.006, ((fy * H - spB - 14) / 4.1) * ang.rad));
      // rótulo: centrado entre la barra superior y el número
      if (title) {
        const h = clamp(W * 0.043, 15, 24);
        const w = h * title.userData.aspect;
        const y0 = top ? top.y + top.h : H * 0.1;
        const y1 = sp ? sp.y : H * 0.24;
        titlePos.w = w; titlePos.h = h; titlePos.x = (W - w) / 2; titlePos.y = (y0 + y1) / 2 - h / 2;
        titlePos.ok = y1 - y0 > h + 16 && w < W - 24;
      }
    } else {
      // horizonte bajo (el número queda delante del cielo oscuro); el camino nace en el hueco número | columna
      const gapL = sp ? (sp.x + sp.w) / W : 0.46;
      const gapR = seg ? seg.x / W : 0.55;
      const fx = clamp((gapL + gapR) / 2, 0.42, 0.62);
      const fy = clamp(spB / H - 0.03, 0.55, 0.8);
      base.fov = 44; base.sx = 2 * fx - 1; base.sy = 1 - 2 * fy;
      const Rpx = clamp(H * 0.1, 28, 54);
      const colX = seg ? seg.x + seg.w * 0.68 : W * 0.8;
      const yTop = (top ? top.y + top.h : H * 0.08) + 14 + Rpx;
      const titleH = title ? clamp(H * 0.05, 15, 24) + 22 : 0;
      const yBot = (seg ? seg.y : H * 0.5) - 12 - titleH - Rpx;
      const cy = Math.max(yTop, Math.min(yBot, H * 0.3));
      pxToAngles(Math.min(W - Rpx - 8, colX), cy, base.fov, base.sx, base.sy, ang);
      comp.moonAz = ang.az; comp.moonEl = ang.el; comp.moonR = Rpx * ang.rad;
      comp.houseScale = 0.016;
      if (title) {
        const h = clamp(H * 0.05, 15, 24);
        const w = h * title.userData.aspect;
        titlePos.w = w; titlePos.h = h;
        titlePos.x = seg ? seg.x : W * 0.55;
        titlePos.y = (seg ? seg.y : H * 0.5) - 14 - h;
        titlePos.ok = titlePos.x + w < W - 8;
      }
    }
    const SU = sky.u;
    SU.uMoon.value.set(comp.moonAz, comp.moonEl, comp.moonR, 1);
    SU.uHouse.value.set(0, 0.021, comp.houseScale, 1);
  }

  function applyQuality() {
    const lvl = ctx.qualityLevel;
    const detail = lvl >= 2 ? 1 : lvl === 1 ? 0.6 : 0;
    ground.u.uDetail.value = detail;
    sky.u.uDetail.value = lvl >= 1 ? 1 : 0;
    S_.uFogP.value.w = lvl >= 1 ? 1 : 0;
    pumpkins.glow.visible = true;
  }
  applyQuality();

  /** Ranuras: base entera y desplazamiento en m (doble precisión en JS). */
  function slots(S, D, back, ahead, setter) {
    const b = Math.floor((S - back) / D);
    setter(Math.ceil((back + ahead) / D) + 1);
    return b;
  }

  frameCamera();

  const inst = {
    // director: solo planos cercanos a la altura de ojos (traslaciones < 0,8 m), sin bajar la cámara del sprint
    director: { scale: 0.8, maxDown: 0.12, orbit: true },

    resize({ aspect }) {
      const p = aspect < 0.9;
      hudVersion = ctx.hud.version;
      if (p !== portrait) { portrait = p; frameCamera(); rig.snap(); } else frameCamera();
    },

    update(f) {
      const dt = f.dt;
      clock.t = f.time;
      const rm = f.reducedMotion;
      const lvl = f.qualityLevel;
      if (ctx.hud.version !== hudVersion) { hudVersion = ctx.hud.version; frameCamera(); }
      if (tl.version !== sigT.ver) {
        // ajuste manual de velocidades: la tabla se rehace; el mundo no salta y se realinea despacio
        const before = sigAt(f.t);
        buildSig();
        driftErr += before - sigAt(f.t);
      }
      if (driftErr !== 0 && !f.finale) {
        const step = 0.4 * dt;
        driftErr = Math.abs(driftErr) <= step ? 0 : driftErr - Math.sign(driftErr) * step;
      }

      // ── ambiente por zona (gradual) ──
      const target = MOODS[f.zone] || MOODS.jog;
      const kM = firstFrame ? 1 : 1 - Math.exp(-dt * (rm ? 0.6 : 1.1));
      for (let i = 0; i < MOOD_KEYS.length; i++) { const key = MOOD_KEYS[i]; mood[key] += (target[key] - mood[key]) * kM; }
      pauseK = damp(pauseK, f.paused ? 1 : 0, 1.6, dt);
      if (!f.finale) lastRecord = f.record.on;
      if (firstFrame) {
        // primera imagen: preparada ⇒ velas bajas (la cadena las enciende al empezar); ya en marcha ⇒ encendidas
        readyDim = f.status === 'ready' ? 0.32 : 1;
        cur.copy(ctx.zoneColor(f.zone));
        S_.uColOld.value.copy(cur);
        S_.uColNew.value.copy(cur);
        chainNew = f.zone;
      }
      firstFrame = false;

      // ── distancia real y ranuras (calabazas, árboles, lápidas) ──
      const S = f.finale > 0 ? lastS : sigAt(f.t) + driftErr;
      lastS = S;
      const fe = f.finale ? easeInOutSine(clamp01(f.finale)) : 0;
      const feel = ctx.speedFeel;
      const density = feel ? clamp(feel.density, 0.5, 1.5) : 1;
      const D = PUMP_D / density;
      if (density !== lastFeel) { lastFeel = density; S_.uSlot.value.z = D; }
      const qi = clamp(lvl | 0, 0, 3);
      const backP = BACK.pumpkins + 40 * fe;
      const bP = slots(S, D, backP, RANGE.pumpkins[qi], pumpkins.setSlots);
      S_.uSlot.value.x = bP;
      S_.uSlot.value.y = bP * D - S;
      S_.uSlot.value.w = ((S % TEX_PERIOD) + TEX_PERIOD) % TEX_PERIOD;
      const backT = BACK.trees + 20 * fe;
      const bT = slots(S, TREE_D, backT, RANGE.trees[qi], trees.setSlots);
      trees.u.uTSlot.value.set(bT, bT * TREE_D - S, TREE_D, rm ? 0 : 1);
      const backG = BACK.graves + 20 * fe;
      const bG = slots(S, GRAVE_D, backG, RANGE.graves[qi], graves.setSlots);
      graves.u.uGSlot.value.x = bG;
      graves.u.uGSlot.value.y = bG * GRAVE_D - S;
      bendPhases(S, bend);
      S_.uBend.value.set(bend.x, bend.y, bend.z, bend.w);
      const heading = Math.atan(bend.z);
      sky.u.uHeading.value = heading;
      ground.u.uFeel.value.x = feel ? feel.cue : 1;

      // ── luna: dirección (marco del corredor) para la luz y el reflejo; algo más alta para iluminar ──
      const mAz = comp.moonAz - heading;
      const mEl = Math.max(comp.moonEl, 0) * 0.5 + 0.12;
      S_.uMoonDir.value.set(Math.sin(mAz) * Math.cos(mEl), Math.sin(mEl), -Math.cos(mAz) * Math.cos(mEl));
      // disco de la luna en pantalla (redondo con cualquier óptica): se proyecta su dirección con la cámara vigente
      const MV = sky.u.uMoonV.value;
      MV.set(Math.sin(mAz) * Math.cos(comp.moonEl), Math.sin(comp.moonEl), -Math.cos(mAz) * Math.cos(comp.moonEl));
      tmpV.copy(MV).multiplyScalar(1000).add(camera.position).applyMatrix4(camera.matrixWorldInverse);
      const MS = sky.u.uMoonS.value;
      if (tmpV.z < -1) {
        tmpV.applyMatrix4(camera.projectionMatrix);
        MS.set(tmpV.x, tmpV.y, comp.moonR * camera.projectionMatrix.elements[5], Math.max(0.1, ctx.size.aspect || 1));
      } else MS.set(10, 10, 0.0001, 1);

      // ── velas: apagado previo al cambio, encendido en cadena, preparada, pausa, final ──
      const C = S_.uChain.value;
      readyDim = damp(readyDim, f.status === 'ready' ? 0.32 : 1, f.status === 'ready' ? 1.5 : 0.6, dt);
      if (chain) {
        const u = (f.time - chain.t0) / chain.dur;
        if (u >= 1) {
          chain = null;
          C.w = 0;
          S_.uColOld.value.copy(S_.uColNew.value);
        } else {
          C.x = -4 + (CHAIN_FAR + 4) * easeInOutSine(clamp01(u));
          C.w = 1;
        }
      } else C.w = 0;
      if (!chain && !f.finale && chainNew !== f.zone) {
        // (por si el tramo cambió sin 'gate', p. ej. tras un salto): color nuevo sin cadena
        chainNew = f.zone;
        S_.uColOld.value.copy(ctx.zoneColor(f.zone));
        S_.uColNew.value.copy(S_.uColOld.value);
      }
      const pre = f.finale || chain || f.segIndex + 1 >= tl.segCount ? 0 : f.approach;
      S_.uLamp.value.x = PRE_DIM * easeInOutSine(clamp01(pre)) * (rm ? 0.6 : 1);
      S_.uLamp.value.y = rm ? 0 : 1;
      S_.uLamp.value.z = f.time;
      const fb = 1 + 0.3 * fe;
      pumpkins.gu.uGlow.value = 0.5 + 0.45 * fe;
      C.z = (f.status === 'ready' && !chain ? readyDim : 1) * (1 - 0.22 * pauseK) * fb;
      S_.uFogP.value.z = rm ? 0 : f.time * 0.35;
      // final: el aire se aclara un poco (el camino entero se lee desde arriba)
      S_.uFogP.value.x = 0.0068 * (1 - 0.35 * fe);
      S_.uFogP.value.y = 0.03 * (1 - 0.3 * fe);

      // ── cielo: tiempo, murciélagos (cruzan cada ~85 s durante ~30 s; nunca con movimiento reducido) ──
      const SU = sky.u;
      SU.uTime.value = f.time;
      const bp = (f.time + BAT_OFF) / 85;
      const bu = (bp - Math.floor(bp)) / 0.36;
      if (!rm && bu < 1 && !f.finale && lvl >= 1) {
        SU.uBats.value.set(bu, Math.sin(Math.PI * bu) * 0.95, 1, 0);
      } else SU.uBats.value.y = 0;
      SU.uHouse.value.w = 1 - 0.3 * pauseK;

      // ── rótulo «NOCHE DE HALLOWEEN» los primeros segundos (solo en la clase de Halloween) ──
      if (title) {
        const want = titlePos.ok && !f.finale && (f.status === 'ready' || f.t < 8.5) ? 1 : 0;
        titleA = damp(titleA, want, want ? 1.6 : 2.4, dt);
        if (titleA < 0.004 && !want) titleA = 0;
        title.visible = titleA > 0;
        if (title.visible) {
          placeScreen(title, titlePos.x, titlePos.y, titlePos.w, titlePos.h);
          title.material.opacity = easeOutCubic(clamp01(titleA)) * 0.92;
        }
      }

      // ── cámara: altura de ojos de corredor; intro: baja despacio desde algo más arriba ──
      if (introOn === null) introOn = f.t < 1 && !rm;
      const T = rig.target;
      const intro = introOn ? 1 - easeOutCubic(clamp01(f.intro)) : 0;
      if (introOn && f.intro >= 1) introOn = false;
      const h = base.h + mood.dh + 0.12 * pauseK + 2.6 * intro;
      if (f.finale > 0) {
        if (!finaleInit) startFinale(f);
        finaleCamera(f, fe);
      } else {
        if (finaleOn) {
          finaleOn = false;
          finaleInit = false;
          rig.settle.position = 1.1; rig.settle.lookAt = 1.1; rig.settle.shift = 1.2; rig.settle.fov = 1.4;
          rig.snap();
        }
        T.position.set(0, h, 0);
        T.lookAt.set(0, h, -100);
        T.fov = base.fov + mood.fov;
        T.roll = 0;
        T.shift.set(base.sx, base.sy);
        if (introOn && f.intro < 0.02) rig.snap();
      }
      rig.bobScale = rm || f.finale ? 0 : 1;

      // ── post: exposición por zona, sin destellos ──
      postOpts.exposure = mood.exp * (1 + 0.03 * fe);
      post.set(postOpts);
    },

    event(type, data = {}) {
      const now = clock.t;
      switch (type) {
        case 'gate': {
          // color viejo por delante del frente (con las velas bajas), el nuevo enciende el camino hacia delante
          S_.uColOld.value.copy(ctx.zoneColor(data.prevZone || chainNew));
          S_.uColNew.value.copy(ctx.zoneColor(data.zone || 'jog'));
          S_.uChain.value.y = 1 - PRE_DIM;
          chainNew = data.zone || 'jog';
          chain = { t0: now, dur: ctx.reducedMotion ? CHAIN_SEC * 1.4 : CHAIN_SEC };
          post.pulse(0.03, 1.4);
          break;
        }
        case 'start': {
          // la primera cadena enciende el camino
          const z = ctx.segments[0]?.zone || 'jog';
          S_.uColNew.value.copy(ctx.zoneColor(z));
          S_.uColOld.value.copy(S_.uColNew.value);
          S_.uChain.value.y = readyDim;
          chainNew = z;
          chain = { t0: now, dur: CHAIN_SEC * 1.3 };
          readyDim = 1;
          break;
        }
        case 'seek':
          driftErr = 0;
          chain = null;
          S_.uChain.value.w = 0;
          break;
        case 'km': post.pulse(0.03, 1.4); break;
        case 'halfway': post.pulse(0.04, 1.6); break;
        case 'drop': post.pulse(0.04, 1.6); break;
        case 'finish': post.pulse(0.04, 2.5); break;
        case 'quality': applyQuality(); break;
        default: break;
      }
    },

    /** Solo laboratorio. */
    get _debug() { return { S: lastS, chain: !!chain, drift: driftErr, moon: { ...comp }, treeTris: trees.tris, pumpkinTris: pumpkins.tris }; },

    dispose() {
      // (geometrías, materiales y texturas de root/cameraRoot los libera el núcleo)
    },
  };
  return inst;

  /** Coloca un plano hijo de la cámara en px CSS (esquina superior izquierda x, y; tamaño w × h) a 1 u delante. */
  function placeScreen(mesh, x, y, w, h) {
    const W = Math.max(1, ctx.size.width);
    const H = Math.max(1, ctx.size.height);
    const e = camera.projectionMatrix.elements;
    const ndcX = ((x + w / 2) / W) * 2 - 1;
    const ndcY = 1 - ((y + h / 2) / H) * 2;
    mesh.position.set((ndcX + e[8]) / e[0], (ndcY + e[9]) / e[5], -1);
    mesh.scale.set(((w / W) * 2) / e[0], ((h / H) * 2) / e[5], 1);
    mesh.rotation.set(0, 0, 0);
  }

  /* ───────────── Final: grúa lenta a un plano alto del camino, todas las calabazas en el color final ───────────── */

  function startFinale(f) {
    finaleInit = true;
    finaleOn = true;
    finalCol.copy(lastRecord ? gold : ctx.zoneColor(f.zone));
    // una última cadena: todo el camino se enciende en el color final
    S_.uColOld.value.copy(S_.uColNew.value);
    S_.uColNew.value.copy(finalCol);
    S_.uChain.value.y = 1;
    chain = { t0: clock.t, dur: CHAIN_SEC * 1.2 };
    chainNew = f.zone;
    if (title) title.visible = false;
  }

  function finaleCamera(f, fe) {
    const T = rig.target;
    // detrás y arriba, mirando el camino que se aleja serpenteando entre las calabazas
    // (en horizontal la luna está alta, sobre la columna de datos: óptica más abierta para que siga entera en el plano)
    const py = portrait ? 6.8 : 5.4;
    const pz = portrait ? 5 : 4;
    const look = portrait ? 42 : 45;
    T.position.set(0, py, pz);
    T.lookAt.set(0, portrait ? 0.4 : 0.8, -look);
    T.fov = portrait ? 56 : 58;
    T.shift.set(portrait ? 0 : base.sx * 0.5, portrait ? 0.1 : -0.12);
    T.roll = 0;
    rig.settle.position = 2.4; rig.settle.lookAt = 2.2; rig.settle.shift = 2; rig.settle.fov = 2.2;
    void fe;
  }
}
