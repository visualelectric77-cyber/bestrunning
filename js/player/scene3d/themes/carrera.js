// BestRunning · escenario CARRERA — el día de tu carrera (5K, 10K, 15K o media) corrida en la cinta, como un gran
// maratón urbano de noche retransmitido (§15.2-3). Corres por una avenida de ciudad A TU VELOCIDAD REAL en metros por
// segundo (km/h ÷ 3,6, con la misma rampa de la cinta que estadio): asfalto ancho y mojado con grano, juntas, parches,
// discontinuas y pasos de cebra, la LÍNEA AZUL de la carrera bajo tus pies, vallas con la lona de RITMUP a los dos
// lados, el público tras ellas (siluetas en penumbra que aplauden, algunas con el móvil en alto), farolas cada 31 m que
// pasan con su parallax de verdad, fachadas con ventanas encendidas y escaparates, y OTROS CORREDORES delante y a los
// lados, cada uno a su ritmo (les ganas y te ganan).
// La carrera (ctx.workout.race = { key, km, label, start, end }, tramo con race: true): durante el calentamiento estás
// detrás del arco hinchable de SALIDA (con «SALIDA · 5K» y un reloj que cuenta atrás) y lo cruzas en race.start exacto;
// después, un arco «KM n» en cada kilómetro real, «MITAD» a mitad de carrera y «ÚLTIMO KM» un km antes, cada uno en su
// metro y su segundo exactos; y la META en race.end exacto: pórtico con un reloj de cronometraje de siete segmentos que
// marca el tiempo de carrera en vivo (t − salida), alfombra de cronometraje en el suelo, focos que se ven llegar desde
// lejos (y su reflejo en el agua) y más público cuanto más cerca. Al cruzarla el reloj se queda con TU tiempo.
// Distancia: s(t) = ∫ v_real con la rampa de la cinta (tabla como estadio). La distancia de carrera es s(t) − s(salida);
// los arcos de km se escalan para que la META caiga en s(race.end) (desvío < 0,05 %): todo se cruza en su segundo.
// Sin ctx.workout.race: la misma avenida, sin arcos.
// Momentos (sin destellos, §15.2): exposición ±3–6 % al cruzar un arco; al cruzar la META, el público sube de energía
// unos segundos y la luz se calienta. Final (frame.finale): corte limpio a un plano elevado de la meta, quieta, con tu
// tiempo grande y sobrio pintado en el asfalto (ctx.textPlane), luz dorada, el público aplaudiendo y los que llegan
// detrás de ti cruzando la línea. Composición (§15.3, sin máscaras): el horizonte va justo bajo el número; arriba solo
// hay cielo de ciudad y fachadas en penumbra; las luminarias que caerían detrás del número se atenúan (composición, como
// los focos de estadio). Los corredores tienen tu altura de ojos: sus cabezas nunca suben del horizonte.
// Sensación de velocidad (ctx.speedFeel): contraste de las juntas, separación de las juntas (cue/density) y postes de
// las vallas. 9 llamadas de dibujo (+1 el rótulo del final), shaders baratos, cero asignaciones por fotograma.
import { sharedUniforms, CAM_X, EYE } from './carrera/common.js';
import { buildSky, buildGround, buildBuildings, buildFences, buildCrowd, buildLamps } from './carrera/city.js';
import { buildRunners } from './carrera/runners.js';
import { buildArches, SLOTS } from './carrera/arches.js';
import { fenceBannerTexture, makeArchAtlas } from './carrera/graphics.js';

export const meta = {
  id: 'carrera',
  name: 'Carrera',
  description: 'Gran carrera de ciudad de noche: salida, arcos de cada kilómetro y meta con tu tiempo.',
};

const DTT = 0.25;          // resolución de la tabla de distancia real (s)
const VIS10 = Math.pow(10, 0.85) / 1.35;
/** Inversa exacta de visualSpeed() del núcleo: u/s visuales → km/h reales (conserva la forma de las rampas). */
const kmhOfVis = (v) => (v > 0 ? Math.pow(v * VIS10, 1 / 1.85) : 0);
const MOOD_KEYS = ['dh', 'fov', 'light', 'crowd', 'exp', 'led'];
// Ambiente por zona: altura de cámara (relativa), FOV extra, farolas, energía del público, exposición, LED de las vallas
const MOODS = {
  warmup: { dh: 0.02, fov: 0, light: 0.96, crowd: 0.4, exp: 0.92, led: 0.35 },
  walk: { dh: 0.04, fov: -0.5, light: 0.94, crowd: 0.3, exp: 0.91, led: 0.3 },
  jog: { dh: 0.01, fov: 0, light: 0.98, crowd: 0.5, exp: 0.92, led: 0.4 },
  run: { dh: 0, fov: 0.8, light: 1.0, crowd: 0.66, exp: 0.93, led: 0.48 },
  fast: { dh: -0.03, fov: 1.6, light: 1.0, crowd: 0.82, exp: 0.94, led: 0.56 },
  sprint: { dh: -0.06, fov: 2.8, light: 1.02, crowd: 1.0, exp: 0.95, led: 0.66 },
  cooldown: { dh: 0.06, fov: -0.5, light: 0.86, crowd: 0.36, exp: 0.9, led: 0.28 },
};
const GOLD_LAMP = [1.0, 0.66, 0.3];
const BASE_LAMP = [1.0, 0.8, 0.58];

/** Tiempo de carrera: m:ss o h:mm:ss. */
export function fmtRace(sec) {
  const t = Math.max(0, Math.floor(sec + 1e-3));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Lee y valida ctx.workout.race (null si no hay carrera o no cuadra con la clase). */
function readRace(wk, totalSec) {
  const r = wk?.race;
  if (!r || typeof r !== 'object') return null;
  const km = Number(r.km);
  const start = Number(r.start);
  const end = Number(r.end);
  if (!(km > 0) || !Number.isFinite(start) || !Number.isFinite(end) || !(end > start + 30)) return null;
  const s0 = Math.max(0, Math.min(start, totalSec));
  const e0 = Math.max(s0 + 1, Math.min(end, totalSec));
  const label = String(r.label || `${String(km).replace('.', ',')}K`);
  return { key: String(r.key || ''), km, label, start: s0, end: e0 };
}

const fmtKm = (km) => (Math.round(km * 100) / 100).toString().replace('.', ',');

export function createTheme(ctx) {
  const { THREE, root, camera, rig, post, timeline: tl, util } = ctx;
  const { clamp, clamp01, damp, smoothstep, easeInOutSine, easeOutCubic } = util;
  const aniso = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy?.() || 1);
  const rand = ctx.rng(5150);
  const tlRaw = ctx.tl;
  const race = readRace(ctx.workout, tl.totalSec);

  camera.near = 0.1;
  camera.far = 2400;
  ctx.renderer.setClearColor(0x030304, 1);
  post.set({ toneMapping: 'aces', exposure: 0.92, bloomStrength: 0.42, bloomThreshold: 1.0, bloomRadius: 0.3, vignette: 0.3, saturation: 1.02 });
  const postOpts = { exposure: 0.92 };

  // ── piezas ──
  const SH = sharedUniforms(THREE);
  const sky = buildSky(THREE, camera, ctx.shaders.NOISE);
  root.add(sky.mesh);
  const ground = buildGround(THREE, SH);
  root.add(ground.mesh);
  const builds = buildBuildings(THREE, SH, rand);
  root.add(builds.mesh);
  const fenceTex = fenceBannerTexture(THREE, aniso, race ? race.label : '');
  const fences = buildFences(THREE, SH, fenceTex);
  root.add(fences.mesh);
  const crowd = buildCrowd(THREE, SH, rand);
  root.add(crowd.mesh);
  const lamps = buildLamps(THREE, SH);
  root.add(lamps.mesh, lamps.halo);
  const runners = buildRunners(THREE, SH, rand, 44);
  root.add(runners.mesh);
  const atlas = makeArchAtlas(THREE, aniso, SLOTS + 1);
  const arches = buildArches(THREE, SH, atlas);
  root.add(arches.mesh);
  const G = ground.u;
  const RU = runners.u;
  const CU = crowd.u;

  // ── rótulo del final: tu tiempo pintado en el asfalto antes de la línea (ctx.textPlane) ──
  const finTime = ctx.textPlane('0:00', { size: 180, weight: 800, font: ctx.fonts.rounded, tracking: 0.02, height: 1, intensity: 0.88, pad: 0.2 });
  const finSub = ctx.textPlane(' ', { size: 64, weight: 700, tracking: 0.2, height: 1, intensity: 0.8, pad: 0.3 });
  for (const m of [finTime, finSub]) {
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    m.renderOrder = 4;
    m.material.opacity = 0;
    m.material.polygonOffset = true;
    m.material.polygonOffsetFactor = -2;
    m.material.polygonOffsetUnits = -4;
    m.frustumCulled = false;
    root.add(m);
  }

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

  // ── arcos de la carrera (en metros reales de la avenida) ──
  const ARCHS = [];      // { s, kind (0 hinchable · 1 pórtico), title, sub, style, clock (0 ninguno · 1 salida · 2 meta) }
  let sStart = 0;
  let sEnd = 0;
  function buildArchList() {
    ARCHS.length = 0;
    if (!race) return;
    sStart = sigAt(race.start);
    sEnd = sigAt(race.end);
    const scale = (sEnd - sStart) / (race.km * 1000);
    const add = (dKm, kind, title, sub, style, clock) => ARCHS.push({ s: sStart + dKm * 1000 * scale, kind, title, sub, style, clock });
    add(0, 0, 'Salida', race.label, 'dark', 1);
    const half = race.km / 2;
    const last = race.km - 1;
    const near = (a, b) => Math.abs(a - b) < 0.03;
    for (let k = 1; k < race.km - 0.03; k++) {
      if (near(k, last) && last >= 1) add(k, 0, 'Último km', `KM ${k}`, 'orange', 0);
      else if (near(k, half)) add(k, 0, 'Mitad', `KM ${k}`, 'orange', 0);
      else add(k, 0, `KM ${k}`, '', 'dark', 0);
    }
    if (half >= 0.9 && Math.abs(half - Math.round(half)) >= 0.03) add(half, 0, 'Mitad', `${fmtKm(half)} km`, 'orange', 0);
    if (last >= 0.9 && Math.abs(last - Math.round(last)) >= 0.03) add(last, 0, 'Último km', '', 'orange', 0);
    add(race.km, 1, 'Meta', '', 'meta', 2);
    ARCHS.sort((a, b) => a.s - b.s);
  }
  buildArchList();
  const slotArch = new Int32Array(SLOTS).fill(-1);
  const slotPrevRel = new Float64Array(SLOTS).fill(1e9);
  const metaIdx = () => { for (let i = ARCHS.length - 1; i >= 0; i--) if (ARCHS[i].kind === 1) return i; return -1; };
  let iMeta = metaIdx();
  let iStart = race ? 0 : -1;

  // ── estado ──
  const mood = { ...MOODS.jog };
  const base = { lat: CAM_X, h: EYE, fov: 60, sx: 0, sy: 0.05 };
  let portrait = true;
  let hudVersion = -1;
  let driftErr = 0;
  let firstFrame = true;
  let introOn = null;
  let pauseK = 0;
  let finaleOn = false;
  let finaleInit = false;
  let finS = 0;
  let finT0 = 0;
  let finAng = 0;
  let finA = 0;
  let lastSCam = 0;
  let strideAcc = 0;
  let adv = 0;
  let cheerAt = -1e9;
  let crossedMeta = false;
  let seekGuard = 0;
  let feelD = -1;
  let bend = 0;
  let bendInit = false;
  const lampCol = SH.uLampCol.value;
  const rectOf = (kind) => { for (const r of ctx.hud.rects) if (r.kind === kind) return r; return null; };
  const clock = { t: 0 };

  /** Encaje por composición (sin máscaras): horizonte y punto de fuga según el HUD. */
  function frameCamera() {
    const W = Math.max(1, ctx.hud.width);
    const H = Math.max(1, ctx.hud.height);
    const sp = rectOf('speed');
    if (portrait) {
      const top = sp ? (sp.y + sp.h) / H : 0.45;
      const fy = clamp(top + 0.045, 0.4, 0.62);
      base.lat = CAM_X; base.h = EYE; base.fov = 60; base.sx = 0; base.sy = 1 - 2 * fy;
    } else {
      // horizontal: el punto de fuga en el hueco entre el número y la columna de datos; la avenida baja por él
      const seg = rectOf('segment');
      const gapL = sp ? (sp.x + sp.w) / W : 0.46;
      const gapR = seg ? seg.x / W : 0.55;
      const fx = clamp((gapL + gapR) / 2, 0.45, 0.75);
      const fy = sp ? clamp((sp.y + sp.h) / H + 0.02, 0.5, 0.8) : 0.72;
      base.lat = CAM_X + 0.9; base.h = EYE; base.fov = 58; base.sx = 2 * fx - 1; base.sy = 1 - 2 * fy;
    }
  }

  /** Rectángulo NDC del número de velocidad (las luminarias que caerían detrás se atenúan). */
  function avoidRect() {
    const sp = rectOf('speed');
    const W = Math.max(1, ctx.hud.width);
    const H = Math.max(1, ctx.hud.height);
    if (!sp || finaleOn) { SH.uAvoid.value.set(2, 2, 2, 2); return; }
    const m = 14;
    const mt = 26;
    SH.uAvoid.value.set(((sp.x - m) / W) * 2 - 1, 1 - ((sp.y + sp.h + m) / H) * 2, ((sp.x + sp.w + m) / W) * 2 - 1, 1 - ((sp.y - mt) / H) * 2);
  }

  function applyQuality() {
    const lvl = ctx.qualityLevel;
    const eco = ctx.quality === 'eco';
    G.uSpec.value = eco ? 0 : 1;
    G.uDetail.value = lvl >= 2 ? 1 : lvl === 1 ? 0.6 : 0;
    builds.mesh.geometry.instanceCount = builds.count;
    crowd.mesh.geometry.instanceCount = Math.round(crowd.count * (lvl >= 2 ? 1 : lvl === 1 ? 0.7 : 0.45));
    runners.mesh.geometry.instanceCount = lvl >= 2 ? runners.count : lvl === 1 ? 32 : 22;
    lamps.halo.visible = !eco;
  }
  applyQuality();
  frameCamera();
  avoidRect();

  /** Coloca los arcos visibles en sus huecos (estables) y compone su pancarta en el atlas al asignarlos. */
  function placeArches(sCam, t, f) {
    // suelta los que quedaron atrás o fuera de alcance
    for (let k = 0; k < SLOTS; k++) {
      const i = slotArch[k];
      if (i < 0) continue;
      const rel = ARCHS[i] ? ARCHS[i].s - sCam : -1e9;
      if (rel < -60 || rel > 1400) { slotArch[k] = -1; slotPrevRel[k] = 1e9; }
    }
    for (let i = 0; i < ARCHS.length; i++) {
      const rel = ARCHS[i].s - sCam;
      if (rel < -60) continue;
      if (rel > 1400) break;
      let have = false;
      for (let k = 0; k < SLOTS; k++) if (slotArch[k] === i) have = true;
      if (have) continue;
      let free = -1;
      for (let k = 0; k < SLOTS; k++) if (slotArch[k] < 0) { free = k; break; }
      if (free < 0) break;
      slotArch[free] = i;
      slotPrevRel[free] = rel;
      const a = ARCHS[i];
      atlas.set(free, a.title, a.sub, a.style);
    }
    let km1 = 1e5;
    let km2 = 1e5;
    for (let k = 0; k < SLOTS; k++) {
      const i = slotArch[k];
      const A = arches.arch[k];
      const B = arches.archB[k];
      if (i < 0 || !ARCHS[i]) { A.set(1e5, 0, k, 0); continue; }
      const a = ARCHS[i];
      const rel = a.s - sCam;
      A.set(-rel, a.kind, k, a.clock ? 1 : 0);
      // reloj: cuenta atrás hasta la salida; luego tiempo de carrera; tras la meta, TU tiempo
      let secs = 0;
      if (race) {
        if (a.clock === 1) secs = t < race.start ? race.start - t : Math.min(t, race.end) - race.start;
        else if (a.clock === 2) secs = clamp(t - race.start, 0, race.end - race.start);
      }
      B.set(secs, a.kind === 1 ? 0.52 : a.style === 'orange' ? 0.3 : 0.34, 0, 0);
      // líneas finas en el asfalto bajo los dos próximos arcos de km
      if (a.kind === 0 && a.clock === 0 && rel > -30) {
        if (rel < km1) { km2 = km1; km1 = rel; } else if (rel < km2) km2 = rel;
      }
      // momento: cruzar un arco (exposición +3–6 %, una vez)
      if (seekGuard <= 0 && slotPrevRel[k] > 0 && rel <= 0 && f && !f.finale) {
        if (a.kind === 1) { post.pulse(0.06, 2.4); cheerAt = clock.t; crossedMeta = true; } else post.pulse(0.035, 1.4);
      }
      slotPrevRel[k] = rel;
    }
    G.uMats.value.z = km1 < 1e4 ? -km1 : 1e5;
    G.uMats.value.w = km2 < 1e4 ? -km2 : 1e5;
  }

  return {
    director: { scale: 1.5, maxDown: 0.12 },

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
      if (seekGuard > 0) seekGuard--;
      if (ctx.hud.version !== hudVersion) { hudVersion = ctx.hud.version; frameCamera(); avoidRect(); }
      if (tl.version !== sigT.ver) {
        // ajuste manual de velocidades: la tabla se rehace; la cámara no salta y se realinea despacio
        const before = sigAt(f.t);
        buildSig();
        driftErr += sigAt(f.t) - before;
        buildArchList();
        iMeta = metaIdx();
        slotArch.fill(-1);
      }
      const vNow = kmhOfVis(Math.max(0, f.visualSpeed)) / 3.6;   // m/s reales (con la rampa de la cinta)
      if (driftErr !== 0 && !f.finale) {
        const step = (0.06 * vNow + 0.12) * dt;
        driftErr = Math.abs(driftErr) <= step ? 0 : driftErr - Math.sign(driftErr) * step;
      }

      // ── ambiente por zona (todo gradual) ──
      const target = MOODS[f.zone] || MOODS.jog;
      const kM = firstFrame ? 1 : 1 - Math.exp(-dt * (rm ? 0.6 : 1.1));
      firstFrame = false;
      for (let i = 0; i < MOOD_KEYS.length; i++) { const key = MOOD_KEYS[i]; mood[key] += (target[key] - mood[key]) * kM; }
      pauseK = damp(pauseK, f.paused ? 1 : 0, 1.6, dt);
      const fe = f.finale ? easeInOutSine(clamp01(f.finale)) : 0;

      // ── tu distancia real en la avenida (en el final, la cámara se va a la meta y el mundo queda quieto) ──
      if (f.finale > 0 && !finaleInit) startFinale(f);
      if (!(f.finale > 0) && finaleOn) endFinale();
      const sCam = finaleOn ? finS : sigAt(f.t) - driftErr;
      if (!finaleOn) lastSCam = sCam;
      const sLo = sCam - 1000 * Math.floor(sCam / 1000);
      SH.uSLo.value = sLo;
      SH.uSHi.value = Math.floor(sCam / 1000);
      SH.uTime.value = f.time;

      // ── carrera: arcos, meta, salida ──
      const tRace = finaleOn && race ? race.end : f.t;
      placeArches(sCam, tRace, f);
      const zMeta = iMeta >= 0 ? -(ARCHS[iMeta].s - sCam) : 1e5;
      const zStart = iStart >= 0 && ARCHS[iStart] ? -(ARCHS[iStart].s - sCam) : 1e5;
      SH.uMetaZ.value = zMeta;
      SH.uStartZ.value = zStart;
      SH.uMetaK.value = iMeta >= 0 && zMeta > -400 ? 1 : 0;
      G.uMats.value.x = zStart;
      G.uMats.value.y = zMeta;

      // ── curva suave de la avenida (recta en la salida y en los últimos 700 m: la meta se ve llegar) ──
      let straight = 1;
      if (race) {
        straight *= smoothstep(150, 500, Math.abs(sCam - sStart));
        straight *= smoothstep(150, 700, Math.max(0, sEnd - sCam)) + smoothstep(120, 400, sCam - sEnd);
        straight = clamp01(straight);
      }
      const bendT = finaleOn ? 0 : 2.1e-4 * Math.sin((2 * Math.PI * sCam) / 2600 + 1.3) * straight;
      bend = bendInit ? damp(bend, bendT, 0.5, dt) : bendT;
      bendInit = true;
      SH.uBend.value = bend;

      // ── luz: farolas por zona; en el final, dorada; al cruzar la meta, el público se viene arriba ──
      const cheer = Math.exp(-Math.max(0, f.time - cheerAt) / 9) * (crossedMeta ? 1 : 0);
      const gold = Math.max(fe, 0.55 * cheer);
      SH.uGold.value = gold * (finaleOn ? 1 : 0.5);
      lampCol.setRGB(
        BASE_LAMP[0] + (GOLD_LAMP[0] - BASE_LAMP[0]) * gold,
        BASE_LAMP[1] + (GOLD_LAMP[1] - BASE_LAMP[1]) * gold,
        BASE_LAMP[2] + (GOLD_LAMP[2] - BASE_LAMP[2]) * gold,
      );
      SH.uLight.value = mood.light * (1 - 0.1 * pauseK) * (1 + 0.3 * fe);
      SH.uAccent.value.copy(f.accent);
      sky.u.uGoldK.value = 0.6 * fe;
      fences.u.uLed.value = mood.led * (1 - 0.5 * pauseK) * (1 - 0.6 * fe);
      CU.uEnergy.value = clamp01(Math.max(mood.crowd, 0.85 * cheer, fe) * (1 - 0.6 * pauseK));
      CU.uMotionK.value = rm ? 0.3 : 1;
      CU.uDens.value = finaleOn ? 0.8 : 0.64;

      // ── sensación de velocidad: contraste y separación de las juntas (periodo que divide 1000 m: sin costura) ──
      const feel = ctx.speedFeel;
      const fd = feel ? feel.density : 1;
      if (fd !== feelD) { feelD = fd; G.uFeel.value.y = 1000 / Math.round(200 * fd); }
      G.uFeel.value.x = feel ? feel.cue : 1;
      fences.u.uCue.value = feel ? feel.cue : 1;

      // ── corredores: tus metros reales, su zancada y, en el final, siguen llegando a la meta ──
      const kmh = finaleOn ? 11 : Math.max(0, kmhOfVis(Math.max(0, f.visualSpeed)));
      const cad = clamp(150 + 2.3 * kmh, 150, 185) / 120;       // ciclos de zancada por segundo
      const running = finaleOn ? 1 : clamp01(kmh / 4);
      strideAcc += dt * cad * running;
      if (finaleOn) adv += dt * 3.1;
      RU.uDm.value = finaleOn ? finS : sCam;
      RU.uStride.value = strideAcc;
      RU.uAdv.value = adv;
      RU.uAmp.value = finaleOn ? 0.9 : clamp((kmh - 3) / 8, 0.12, 1) * running;
      G.uCamH.value = camera.position.y > 0.3 ? camera.position.y : EYE;

      // ── cámara: ojos de corredor; intro: baja de la grúa; pausa: un palmo más alta ──
      if (introOn === null) introOn = f.t < 1 && !rm;
      const T = rig.target;
      const intro = introOn ? (1 - easeOutCubic(clamp01(f.intro))) : 0;
      if (introOn && f.intro >= 1) introOn = false;
      if (finaleOn) finaleCamera(f, fe, dt);
      else {
        const h = base.h + mood.dh + 0.2 * pauseK + 5.5 * intro;
        T.position.set(base.lat, h, 0);
        T.lookAt.set(base.lat, h - 0.02, -100);
        T.fov = base.fov + mood.fov;
        T.shift.set(base.sx, base.sy);
        T.roll = 0;
        if (introOn && f.intro < 0.02) rig.snap();
      }
      rig.bobScale = rm || finaleOn ? 0 : 1;

      postOpts.exposure = mood.exp * (finaleOn ? 1 + 0.05 * fe : 1);
      post.set(postOpts);
    },

    event(type, data = {}) {
      switch (type) {
        case 'gate': post.pulse(0.03, 1.2); break;
        case 'seek':
          driftErr = 0;
          bendInit = false;
          seekGuard = 3;
          for (let k = 0; k < SLOTS; k++) slotPrevRel[k] = 1e9;
          if (race && Number(data?.to) < race.end) crossedMeta = false;
          break;
        case 'halfway': if (!race) post.pulse(0.03, 1.6); break;
        case 'km': if (!race) post.pulse(0.025, 1.4); break;
        case 'finish': post.pulse(0.05, 2.5); break;
        case 'quality': applyQuality(); break;
        default: break;
      }
    },

    /** Solo laboratorio. */
    get _debug() { return { race, arches: ARCHS.map((a) => ({ s: +a.s.toFixed(1), t: a.title, sub: a.sub })), sStart, sEnd, slots: Array.from(slotArch), bend }; },

    dispose() {
      // (geometrías, materiales y texturas de root/cameraRoot los libera el núcleo)
    },
  };

  /* ───────────── Plano final: corte limpio a un plano elevado de la meta, con tu tiempo ───────────── */

  function startFinale(f) {
    finaleInit = true;
    finaleOn = true;
    avoidRect();
    finT0 = f.time;
    finAng = 0;
    finA = 0;
    adv = 0;
    const im = iMeta;
    // la cámara se planta 34 m antes de la meta (sin carrera: donde estabas)
    finS = im >= 0 ? ARCHS[im].s - 34 : lastSCam;
    const secs = race ? race.end - race.start : tl.totalSec;
    finTime.userData.setText(fmtRace(secs));
    finSub.userData.setText(race ? `Tu tiempo · ${race.label}` : 'Tu tiempo');
    for (let k = 0; k < SLOTS; k++) { slotArch[k] = -1; slotPrevRel[k] = 1e9; }
    rig.snap();
  }

  function endFinale() {
    finaleOn = false;
    finaleInit = false;
    finTime.visible = false;
    finSub.visible = false;
    avoidRect();
    for (let k = 0; k < SLOTS; k++) { slotArch[k] = -1; slotPrevRel[k] = 1e9; }
    rig.settle.position = 1.1; rig.settle.lookAt = 1.1; rig.settle.shift = 1.2; rig.settle.fov = 1.4;
    rig.snap();
  }

  /**
   * Plano elevado de la meta (vertical y horizontal): grúa a 8–9 m, 34 m antes de la línea, mirando al pórtico; deriva
   * lentísima (≤ 1°/s). Tu tiempo, pintado en el asfalto a 12 m de la línea; el reloj del pórtico marca lo mismo.
   */
  function finaleCamera(f, fe, dt) {
    const T = rig.target;
    finAng += (f.reducedMotion ? 0 : 0.01) * (dt || 0);
    const sw = Math.sin(finAng);
    const lat = portrait ? 1.2 + 6 * sw : 2.5 + 7 * sw;
    const h = portrait ? 8.2 : 7.2;
    T.position.set(lat, h, 0);
    T.lookAt.set(0, portrait ? 2.6 : 3.4, -34);
    T.fov = portrait ? 56 : 50;
    T.shift.set(0, portrait ? 0.06 : 0.02);
    T.roll = 0;
    rig.settle.position = 1.4; rig.settle.lookAt = 1.4; rig.settle.shift = 1.2; rig.settle.fov = 1.2;
    finA = damp(finA, smoothstep(0.2, 0.7, f.finale), 2.2, dt || 0.016);
    // rótulo: el tiempo grande y la etiqueta, tendidos en el asfalto y estirados en profundidad (se leen desde la grúa)
    const zT = -21;
    const tw = portrait ? 8.6 : 9.6;
    const asp = finTime.material.map.userData.aspect || 3;
    const stretch = 2.4;
    finTime.visible = true;
    finTime.position.set(0, 0.03, zT);
    finTime.scale.set(tw, (tw / asp) * stretch, 1);
    finTime.material.opacity = finA * 0.95;
    const sa = finSub.material.map.userData.aspect || 6;
    const sw2 = tw * 0.62;
    finSub.visible = true;
    finSub.position.set(0, 0.03, zT - (tw / asp) * stretch * 0.5 - 1.6);
    finSub.scale.set(sw2, (sw2 / sa) * stretch, 1);
    finSub.material.opacity = finA * 0.85;
  }
}

