// BestRunning · escena 3D del entrenamiento — NÚCLEO + escenarios enchufables (SPEC §14, §14.1, §15, §15.2, §15.3).
// El núcleo pone el renderer, la cámara cinematográfica, el reloj de la clase, los eventos, la calidad adaptativa, el
// espectro de la música, el fantasma y un postproceso sobrio; cada ESCENARIO (js/player/scene3d/themes/<id>.js) pone
// el mundo. Regla de oro (§14.1 + §15.3): la escena es el escenario, el HUD es la estrella — y la legibilidad sale de
// escenas oscuras y serenas por composición, NUNCA de máscaras (setHudRects solo informa de dónde está el HUD).
//
// ═════════════════════════════ API (reproductor) ═════════════════════════════
//   import { createScene3D, isWebGLAvailable, THEMES, DEFAULT_THEME, listThemes } from '../player/scene3d.js';
//   const scene = await createScene3D(canvas, {
//     workout: { ...workout, segments: engine.getSegments() }, levels,
//     quality: 'auto' | 'high' | 'med' | 'low' | 'eco' | 'off', reducedMotion, tvMode,
//     theme: 'blank',            // id de THEMES (si no existe o falla ⇒ DEFAULT_THEME ⇒ 'blank')
//     strideBob: true,           // balanceo de zancada (§14.1-3), muy sutil; nulo con reducedMotion
//     treadmill,                 // límites de la cinta (ajustes manuales idénticos al motor)
//     onError(err),              // la escena se rinde (errores repetidos / sin WebGL) ⇒ fondo 2D
//     onFinale(),                // el plano final llegó a su encuadre (tras 'finish')
//     onMoment(type, data),      // 'gate' {index, zone, up} · 'km' {km} · 'halfway' · 'drop' · 'record' {on, deltaM}
//   });
//   scene.setState(engine.getState())     // cada tick (4 Hz): status, totalElapsed, segIndex, segElapsed, segRemaining,
//                                         //   currentSpeed, distanceKm (la escena interpola su propio reloj)
//   scene.setBeat(phase0a1, bpm)          // motor DJ · scene.setAnalyser(analyserNode | null) (§14.1-2)
//   scene.event(type, data)               // 'segment' {index, reason} · 'countdown' {n} · 'km' {km} · 'halfway' · 'drop'
//                                         //   · 'finish' {durationMs} · 'pause' · 'resume' · 'testStage' {stage}
//                                         //   · 'testEnd' · 'adjust' {speed, delta}
//   scene.setGhost({ trace: [[tSec, kmh], ...], label } | null)   // §14.1-1 (deltaM lo calcula el núcleo; las luces de
//                                         //   tu récord, scene3d/pacelights, se cargan aquí la primera vez) → Promise
//   scene.setHudRects([{ x, y, w, h, kind }...])  // §15.3: SOLO composición (dónde no poner rótulos 3D); nunca máscara
//   scene.setTheme(id) → Promise<bool> · scene.getTheme() → id · scene.setQuality(q) · scene.setTvMode(bool)
//   scene.setStrideBob(bool) (alias setStride) · scene.resize() · scene.getInfo() · scene.destroy({ releaseContext })
//   scene.setRunning(bool)                // false: creada pero sin pintar (preparación); true: vuelve a pintar
//   Calidad 'auto': baja por cadencia Y coste de CPU por fotograma (un rAF a 30 fps del modo de bajo consumo con poco
//   coste no es sobrecarga ⇒ se mantienen DPR y bloom); ignora ~8 s tras arrancar/escenario/volver; sube con
//   histéresis (un nivel que falló espera 45 s, 90 s… hasta 8 min), también desde 'eco'.
//   Capturas deterministas (laboratorio): createScene3D(canvas, { …, snapshot: { width, height, dpr } }) ⇒ reloj
//   virtual, sin rAF ni listeners, tamaño fijo; luego scene.snapshot.sync() y scene.snapshot.step(1/60) N veces.
//
// ═════════════════════════ INTERFAZ DE ESCENARIO (diseñadores) ═════════════════════════
//   export const meta = { id, name, description }                       // es-ES
//   export function createTheme(ctx) → { update(frame), event(type, data), resize({ width, height, aspect, dpr }),
//                                         dispose() }                     // puede ser async; métodos opcionales
//   · Añade tus objetos SOLO a ctx.root (o ctx.cameraRoot si cuelgan de la cámara). scene.background/fog se pueden
//     usar: el núcleo los limpia al cambiar de escenario y libera (dispose) todo lo que quede en root/cameraRoot.
//   · Nada de Math.random ni performance.now: usa frame.time / frame.dt y ctx.rng(seed) ⇒ capturas deterministas.
//   · Cámara: escribe la pose OBJETIVO en ctx.rig.target { position, lookAt, fov, roll, shift } (el núcleo la sigue con
//     muelles críticos y le suma la zancada). ctx.rig.settle.{position|lookAt|fov|roll|shift} (s), ctx.rig.snap().
//     El DIRECTOR del núcleo (scene3d/director.js) suma a esa pose planos de retransmisión (traslaciones paralelas: el
//     horizonte compuesto para el HUD no se mueve), el golpe de entrada al sprint (frame.dt / frame.time / frame.S del
//     mundo se dilatan 0,6 s; el reloj de la clase no) y el arco del KM. Se apaga solo en intro, pausa, final y con
//     movimiento reducido. Pistas opcionales del escenario: inst.director = { enabled, scale (≈ altura de ojo en u),
//     maxDown, orbit, punch, shots: { sprint, recovery } } o inst.director = false.
//   · Post: ctx.post.set({ toneMapping:'aces'|'agx', exposure≤1, bloomStrength≤0,6, bloomThreshold≥0,85,
//     bloomRadius≤0,45, vignette≤0,45, saturation }) y ctx.post.pulse(±0,1) para momentos. Límites impuestos.
//   · PROHIBIDO (§15.2): destellos, ráfagas, rayos, chispas, explosiones, confeti, warp, aberración llamativa,
//     máscaras/desenfoques del HUD. Momentos = cambio gradual del acento, ritmo, una línea fina que pasa una vez,
//     tipografía sobria, exposición ±10 %.
//   ctx = {
//     THREE, scene, camera, renderer, root, cameraRoot,
//     quality ('eco'|'low'|'med'|'high', vivo), qualityLevel (0..3), reducedMotion (vivo), tvMode (vivo),
//     palette (ZONES de levels.js: { key, name, short, color }), zoneColor(zone) → THREE.Color lineal (no mutar),
//     zoneRank, workout, levels, segments (vista viva: [{ zone, speed, sec, start, end, stage, label }]),
//     timeline: { segCount, totalSec, segStart(i), segEnd(i), segDuration(i), segZone(i), segSpeed(i), segStage(i),
//                 segAt(t), zoneAt(t), speedAt(t), distanceAt(t) [km del plan], visualDistanceAt(t) [u], visualSpeed(kmh)
//                 [u/s], timeForKm(km) [s], version } — y los mismos helpers también directamente en ctx,
//     hud (composición viva: { rects, free, band, speed, portrait, width, height, version }), size { width, height,
//     aspect, dpr } (vivo), rig, post, spectrumTexture (DataTexture 64×1, R = nivel 0..1, log 30 Hz–16 kHz),
//     textTexture(text, opts) → CanvasTexture (versalitas/tracking de retransmisión), textPlane(text, opts) → Mesh,
//     util { clamp, clamp01, lerp, damp, smoothstep, springTo, easeInOutCubic, easeOutCubic, easeInOutSine,
//            easeOutQuart }, rng(seed) → () ⇒ [0,1), shaders { NOISE, FOG, OUTPUT }, fmtSpeed(v) '11,5', fmtClock(s) '1:30',
//     fonts { ui, rounded }, ghostLights (vivo: true ⇒ las luces de tu récord sustituyen tu marca del fantasma) }
//   frame (un único objeto reutilizado; no guardes referencias a sus hijos entre fotogramas) = {
//     t (s de clase, suavizado, continuo), dt (s, ≤ 0,1), time (s de animación, monótono, sigue en pausa),
//     totalElapsed (último del motor), segIndex, segElapsed, segRemaining, segDuration, segProgress (0..1),
//     speed (km/h del tramo), visualSpeed (u/s con rampa; 0 parado), S (u recorridas = visualDistanceAt(t)),
//     accel (u/s², suavizada), zone, prevZone, nextZone (null en el último), nextSpeed, timeToNext (s; Infinity),
//     approach (0..1 en los últimos 3 s antes del cambio), accent (THREE.Color: color de zona con transición
//     gradual ~1,5 s), nextAccent, beatPhase (0..1), bpm, beat (envolvente 0..1), musicBeat (bool), breath (0..1, 4 s/4 s),
//     spectrum { bass, mid, high, live }, ghost { active, deltaM (+ = vas por delante), km, speed, label },
//     record { on, amount }, status ('ready'|'running'|'paused'|'finished'), running, paused, timeScale (0..1),
//     finale (0..1 tras 'finish'), intro (0..1, primeros 2,6 s), progress (0..1 de la clase), distanceKm, kmNext,
//     stage (escalón del test o 0), isTest, stride { phase, cadence }, tvMode, aspect, portrait, width, height, dpr,
//     hudRects, quality, qualityLevel, reducedMotion, tlVersion }
//   Eventos para el escenario: los de la API ('segment', 'countdown', 'km', 'halfway', 'drop', 'finish', 'pause',
//   'resume', 'testStage', 'testEnd', 'adjust') + los del núcleo: 'gate' {index, zone, prevZone, speed, prevSpeed, up}
//   (justo en el segundo del cambio), 'seek' {from, to} (salto de reloj: corta), 'start', 'record' {on, deltaM},
//   'timeline' {version} (velocidades ajustadas), 'quality' {name, level}, 'tv' {on}.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
import * as THREE from '../vendor/three/build/three.module.min.js';
import { Timeline, visualSpeed } from './scene3d/timeline.js';
import { createSpectrum } from './scene3d/audio.js';
import { createPost, POST_LIMITS, POST_DEFAULTS, sanitizePost } from './scene3d/postfx.js';
import { createRig, createRigFacade, applyRigFacade } from './scene3d/rig.js';
import { createLayout } from './scene3d/layout.js';
import { createGhostTrace } from './scene3d/ghosttrace.js';
import { createDirector } from './scene3d/director.js';
import { makeTextTexture, makeTextPlane, FONT_UI, FONT_ROUNDED } from './scene3d/textures.js';
import { NOISE, FOG, OUTPUT } from './scene3d/shaders.js';
import { fmtSpeed, fmtClock } from './scene3d/text.js';
import {
  clamp, clamp01, lerp, damp, smoothstep, springTo, easeInOutCubic, easeOutCubic, easeInOutSine, easeOutQuart, rng,
  ZONE_RANK,
} from './scene3d/util.js';
import { THEMES, DEFAULT_THEME, themeById, listThemes } from './scene3d/themes/index.js';
import { ZONES } from '../training/levels.js';

export { THEMES, DEFAULT_THEME, listThemes };

// Sin MSAA en ningún nivel: a DPR 2 el destino multimuestra en media precisión (y el compuesto del bloom resolviéndose
// sobre él) costaba ~85 % del fotograma en GPU (6,7 ms frente a 0,8 ms en un M3 Pro; ~13–18 ms en el iPhone) y dejaba
// 'auto' al borde del umbral de 50 fps. Los escenarios suavizan sus líneas con fwidth; a DPR 2 no hace falta más.
const QUALITY = [
  { name: 'eco', dpr: 1.0, bloom: false, bloomScale: 0.33, fps: 30, level: 0, msaa: 0 },
  { name: 'low', dpr: 1.25, bloom: true, bloomScale: 0.3, fps: 60, level: 1, msaa: 0 },
  { name: 'med', dpr: 1.6, bloom: true, bloomScale: 0.4, fps: 60, level: 2, msaa: 0 },
  { name: 'high', dpr: 2.0, bloom: true, bloomScale: 0.5, fps: 60, level: 3, msaa: 0 },
];
const QUALITY_INDEX = { eco: 0, low: 1, med: 2, high: 3, auto: 3 };
const INTERNAL_BPM = { warmup: 100, walk: 90, jog: 120, run: 140, fast: 156, sprint: 172, cooldown: 92 };
const ZONE_ENERGY = { walk: 0.15, warmup: 0.25, cooldown: 0.2, jog: 0.4, run: 0.6, fast: 0.8, sprint: 1 };
const CLEAR = 0x050608;
const THEME_MAX_ERRORS = 5;
const FALLBACK_THEME = 'blank';
const BEAT_MULTS = [1, 2, 0.5]; // zancada ↔ música: 1 paso por beat, 2 por beat o 1 cada 2

/** ¿Hay WebGL2 utilizable? (three.js r186 solo usa WebGL2). */
export function isWebGLAvailable() {
  try {
    if (typeof document === 'undefined') return false;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    const ok = !gl.isContextLost();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

function noopController() {
  const f = () => {};
  return {
    setState: f, setBeat: f, event: f, resize: f, setQuality: f, setTvMode: f, destroy: f, setHudRects: f, setGhost: f,
    setAnalyser: f, setStride: f, setStrideBob: f, setRunning: f, setTheme: async () => false, getTheme: () => null,
    getInfo: () => ({ fps: 0, quality: 'off', level: -1 }),
  };
}

function fallbackWorkout(levels) {
  return { segments: [{ zone: 'jog', speed: Number(levels?.jog) || 8.3, sec: 1200, label: 'Trotar' }], totalSec: 1200 };
}

/** Libera geometrías, materiales y texturas de un árbol (salvo las texturas compartidas del núcleo). */
function disposeTree(obj, keep) {
  const seen = new Set();
  const tex = (v) => { if (v?.isTexture && !keep.has(v) && !seen.has(v)) { seen.add(v); v.dispose(); } };
  obj.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      for (const k of Object.keys(m)) tex(m[k]);
      if (m.uniforms) for (const k of Object.keys(m.uniforms)) tex(m.uniforms[k]?.value);
      m.dispose?.();
    }
  });
}

/**
 * Crea la escena. Lanza si WebGL no está disponible (el reproductor debe usar su fondo 2D).
 * @param {HTMLCanvasElement} canvas
 */
export async function createScene3D(canvas, {
  workout, levels, quality = 'auto', reducedMotion = false, tvMode = false, strideBob = true, treadmill = null,
  theme: themeOpt = DEFAULT_THEME, onError = null, onFinale = null, onMoment = null, snapshot = null,
} = {}) {
  if (!canvas) throw new Error('Escena 3D: falta el canvas');
  if (quality === 'off') return noopController();
  const wk = workout?.segments?.length ? workout : fallbackWorkout(levels);
  const snap = snapshot && typeof snapshot === 'object'
    ? { width: Math.max(16, Math.round(Number(snapshot.width) || 440)), height: Math.max(16, Math.round(Number(snapshot.height) || 956)), dpr: clamp(Number(snapshot.dpr) || 2, 0.5, 3) }
    : null;

  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance',
    preserveDrawingBuffer: !!snap,
  });
  if (!renderer.getContext() || renderer.getContext().isContextLost()) {
    renderer.dispose();
    throw new Error('Escena 3D: WebGL no disponible');
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(CLEAR, 1);
  renderer.info.autoReset = false;
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 1);

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 600))]).catch(() => {});
  }

  // Reloj: real (performance.now) o virtual (capturas deterministas)
  let virtMs = 0;
  const nowMs = snap ? () => virtMs : () => performance.now();
  const t0 = nowMs();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 6000);
  scene.add(camera); // ctx.cameraRoot cuelga de la cámara
  const tl = new Timeline(wk, treadmill);
  const spectrum = createSpectrum(THREE);
  const post = createPost(THREE, renderer, scene, camera);
  const rig = createRig(THREE, camera);
  const layout = createLayout();
  const ghost = createGhostTrace();
  const director = createDirector(); // planos de retransmisión + golpe de sprint + arco del KM (scene3d/director.js)
  let worldLag = 0;  // s de animación que el mundo lleva de retraso por el golpe de sprint (permanente, monótono)
  let scrollLag = 0; // s de clase de retraso del recorrido visual (se recupera despacio)
  const keepTex = new Set([spectrum.tex]);
  const zoneCol = {};
  for (const z of Object.keys(ZONES)) zoneCol[z] = new THREE.Color(ZONES[z].color);

  // Calidad
  let qMode = QUALITY_INDEX[quality] !== undefined ? quality : 'auto';
  let qIndex = QUALITY_INDEX[qMode];
  let Q = QUALITY[qIndex];
  let reduced = !!reducedMotion;
  const mql = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (mql?.matches) reduced = true;
  let tv = !!tvMode;
  let strideOn = strideBob !== false;

  // Estado del motor (`rate`: solo laboratorio, avance 5×/20×; 0 = congelado)
  const st = { status: 'ready', totalElapsed: 0, segIndex: 0, segElapsed: 0, segRemaining: 0, currentSpeed: 0, distanceKm: 0, rate: 1 };
  let recvAt = nowMs();
  let distOffset = 0;
  let pausedEvt = false;

  // Reloj de la clase
  let localT = 0;
  let prevLocalT = 0;
  let timeScale = 0;
  let jumped = false;
  let lastCross = 0;
  let lastCrossAt = -1e9;
  let pendingSeg = null;
  let tlVersion = tl.version;
  let vPrev = 0;
  let accel = 0;

  // Beat y zancada
  let beatPhase0 = 0;
  let beatBpm = 0;
  let beatAt = -1e9;
  let internalPhase = 0;
  let stepPhase = 0;

  // Récord, final, pausa
  let goldOn = false;
  let gold = 0;
  let finale = null;
  let desat = 0;

  // Tamaño
  let width = 1;
  let height = 1;
  let dprNow = 1;
  let aspect = 1;
  const size = { width: 1, height: 1, aspect: 1, dpr: 1 };

  // Bucle
  let raf = 0;
  let running = false;
  let destroyed = false;
  let lost = false;
  let lastMs = 0;
  let lastFrameMs = 0;
  let needsResize = true;
  let errCount = 0;
  let fpsFrames = 0;
  let fpsTime = 0;
  let fps = 60;
  let lastQChange = nowMs();
  let hiddenTimer = 0;
  let parked = false;          // setRunning(false): el reproductor la tiene creada pero parada (preparación)
  // Calidad adaptativa: cadencia de fotogramas Y coste de CPU por fotograma (un rAF limitado a 30 fps por el modo de
  // bajo consumo no es sobrecarga de GPU); arranque, cambio de escenario y vuelta del segundo plano no cuentan
  let warmUntil = 0;
  let costSum = 0;
  let cadence33 = 0;
  let costAvg = 0;
  let throttled = false;
  const blockedUntil = [0, 0, 0, 0]; // histéresis: un nivel que no aguantó no se reintenta hasta pasado un tiempo
  const blockMs = [0, 0, 0, 0];      // …que se dobla en cada fallo (45 s → 90 s → … → 8 min)

  // Temporales sin asignación por frame
  const tmpColor = new THREE.Color();
  const accent = new THREE.Color().copy(zoneCol[tl.zones[0]] || zoneCol.jog);
  const nextAccent = new THREE.Color().copy(accent);

  /* ───────────── Timeline (vista para los escenarios) ───────────── */

  const ci = (i) => (i < 0 ? 0 : i >= tl.n ? tl.n - 1 : i | 0);
  const timeline = {
    get segCount() { return tl.n; },
    get totalSec() { return tl.totalSec; },
    get version() { return tl.version; },
    segStart: (i) => tl.starts[ci(i)],
    segEnd: (i) => tl.ends[ci(i)],
    segDuration: (i) => tl.secs[ci(i)],
    segZone: (i) => tl.zones[ci(i)],
    segSpeed: (i) => tl.speeds[ci(i)],
    segStage: (i) => tl.stage[ci(i)],
    segAt: (t) => tl.segAt(t),
    zoneAt: (t) => tl.zones[Math.max(0, tl.segAt(t))],
    speedAt: (t) => tl.speeds[Math.max(0, tl.segAt(t))],
    distanceAt: (t) => tl.D(t),
    visualDistanceAt: (t) => tl.S(t),
    visualSpeed,
    timeForKm: (km) => tl.timeForKm(km, distOffset),
  };
  const segments = [];
  function syncSegments() {
    segments.length = tl.n;
    for (let i = 0; i < tl.n; i++) {
      const s = segments[i] || (segments[i] = {});
      s.index = i; s.zone = tl.zones[i]; s.speed = tl.speeds[i]; s.sec = tl.secs[i]; s.start = tl.starts[i];
      s.end = tl.ends[i]; s.stage = tl.stage[i]; s.label = tl.labels[i];
    }
  }
  syncSegments();

  /* ───────────── Frame (reutilizado) ───────────── */

  const F = {
    t: 0, dt: 0, time: 0, totalElapsed: 0, segIndex: 0, segElapsed: 0, segRemaining: 0, segDuration: 0, segProgress: 0,
    speed: 0, visualSpeed: 0, S: 0, accel: 0, zone: tl.zones[0] || 'jog', prevZone: null, nextZone: null, nextSpeed: 0,
    timeToNext: Infinity, approach: 0, accent, nextAccent, beatPhase: 0, bpm: 120, beat: 0, musicBeat: false, breath: 0,
    spectrum: spectrum.out, ghost: { active: false, deltaM: 0, km: 0, speed: 0, label: '' }, record: { on: false, amount: 0 },
    status: 'ready', running: false, paused: false, timeScale: 0, finale: 0, intro: 0, progress: 0, distanceKm: 0,
    kmNext: 1, stage: 0, isTest: tl.isTest, stride: { phase: 0, cadence: 170 }, tvMode: tv, aspect: 1, portrait: true,
    width: 1, height: 1, dpr: 1, hudRects: layout.out.rects, quality: Q.name, qualityLevel: Q.level, reducedMotion: reduced,
    tlVersion: tl.version,
  };

  /* ───────────── Escenarios ───────────── */

  let theme = null;        // { id, inst, ctx }
  let themeErr = 0;
  let themeReq = 0;
  // Luces de tu récord (scene3d/pacelights): se cargan solo si hay fantasma; sus fallos nunca tocan errCount/themeFault
  let pace = null;
  let paceOn = false;
  let paceErr = 0;
  let paceLoad = null;

  function makeCtx() {
    const root = new THREE.Group();
    root.name = 'theme-root';
    const cameraRoot = new THREE.Group();
    cameraRoot.name = 'theme-camera-root';
    const rigF = createRigFacade(THREE, rig);
    const postS = { ...POST_DEFAULTS };
    let ctxRef = null;
    const postF = {
      set: (o) => sanitizePost(postS, o),
      pulse: (a, d) => { if (theme?.ctx === ctxRef) post.pulse(a, d); },
      get settings() { return postS; },
      LIMITS: POST_LIMITS,
    };
    ctxRef = {
      THREE, scene, camera, renderer, root, cameraRoot,
      get quality() { return Q.name; },
      get qualityLevel() { return Q.level; },
      get reducedMotion() { return reduced; },
      get tvMode() { return tv; },
      palette: ZONES,
      zoneColor: (z) => zoneCol[z] || zoneCol.jog,
      zoneRank: ZONE_RANK,
      workout: wk,
      levels: levels || null,
      tl, // Timeline en bruto (avanzado, solo lectura: starts/ends/secs/zones/speeds/stage, S(t), D(t), vAt(t))
      segments,
      timeline,
      ...timeline,
      get segCount() { return tl.n; },
      get totalSec() { return tl.totalSec; },
      hud: layout.out,
      size,
      rig: rigF,
      post: postF,
      spectrumTexture: spectrum.tex,
      textTexture: (text, o = {}) => makeTextTexture(THREE, text, { maxAnisotropy: maxAniso, ...o }),
      textPlane: (text, o = {}) => makeTextPlane(THREE, text, { maxAnisotropy: maxAniso, ...o }),
      util: { clamp, clamp01, lerp, damp, smoothstep, springTo, easeInOutCubic, easeOutCubic, easeInOutSine, easeOutQuart },
      rng: (seed = 1) => rng(seed),
      shaders: { NOISE, FOG, OUTPUT },
      fmtSpeed,
      fmtClock,
      fonts: { ui: FONT_UI, rounded: FONT_ROUNDED },
      /** true mientras las luces de tu récord sustituyen la marca propia del fantasma de ESTE escenario. */
      get ghostLights() { return paceOn && theme?.ctx === ctxRef; },
      _postSettings: postS,
    };
    return ctxRef;
  }

  function callTheme(fn, a, b) {
    const inst = theme?.inst;
    if (!inst || typeof inst[fn] !== 'function') return;
    try {
      inst[fn](a, b);
    } catch (err) {
      themeFault(err);
    }
  }

  function themeFault() {
    themeErr++;
    if (themeErr >= THEME_MAX_ERRORS && theme && theme.id !== FALLBACK_THEME) {
      themeErr = 0;
      loadTheme(FALLBACK_THEME).catch(() => {});
    }
  }

  function retireTheme(old) {
    if (!old) return;
    try { old.inst?.dispose?.(); } catch { /* sigue liberando */ }
    try {
      scene.remove(old.ctx.root);
      camera.remove(old.ctx.cameraRoot);
      disposeTree(old.ctx.root, keepTex);
      disposeTree(old.ctx.cameraRoot, keepTex);
    } catch { /* idem */ }
  }

  /** Engancha las luces de tu récord al escenario activo (false si no lo admite: legacy conserva su fantasma). */
  function bindPace() {
    paceOn = false;
    paceErr = 0;
    if (pace && theme) { try { paceOn = !!pace.bind(theme); } catch { paceOn = false; } }
  }

  /** Carga y activa un escenario; si falla, el de respaldo. Devuelve el id activo. */
  async function loadTheme(id) {
    const req = ++themeReq;
    const entry = themeById(id) || themeById(DEFAULT_THEME) || themeById(FALLBACK_THEME);
    let mod = null;
    let inst = null;
    let ctx = null;
    // estado global que un escenario puede fijar al crearse (fondo, niebla, entorno, planos de corte, color de borrado)
    const pre = { bg: scene.background, fog: scene.fog, env: scene.environment, near: camera.near, far: camera.far, clear: renderer.getClearColor(tmpColor).getHex() };
    const restorePre = () => {
      scene.background = pre.bg; scene.fog = pre.fog; scene.environment = pre.env;
      camera.near = pre.near; camera.far = pre.far; renderer.setClearColor(pre.clear, 1);
    };
    try {
      mod = await (entry.loader || entry.load)();
      if (typeof mod?.createTheme !== 'function') throw new Error('escenario sin createTheme');
      ctx = makeCtx();
      inst = await mod.createTheme(ctx);
      if (!inst || typeof inst !== 'object') throw new Error('createTheme no devolvió nada');
    } catch (err) {
      restorePre();
      if (ctx) { try { disposeTree(ctx.root, keepTex); disposeTree(ctx.cameraRoot, keepTex); } catch { /* nada */ } }
      if (entry.id !== FALLBACK_THEME && req === themeReq) return loadTheme(FALLBACK_THEME);
      throw err;
    }
    const chosen = {
      bg: scene.background !== pre.bg ? scene.background : null,
      fog: scene.fog !== pre.fog ? scene.fog : null,
      env: scene.environment !== pre.env ? scene.environment : null,
      near: camera.near !== pre.near ? camera.near : 0.1,
      far: camera.far !== pre.far ? camera.far : 6000,
      clear: renderer.getClearColor(tmpColor).getHex() !== pre.clear ? renderer.getClearColor(tmpColor).getHex() : CLEAR,
    };
    restorePre(); // el escenario anterior sigue viéndose igual mientras se compila el nuevo
    if (destroyed || req !== themeReq) {
      try { inst.dispose?.(); disposeTree(ctx.root, keepTex); disposeTree(ctx.cameraRoot, keepTex); } catch { /* nada */ }
      return theme?.id ?? null;
    }
    // Compilación anticipada fuera del escenario (sin tirón al aparecer); en capturas se compila al pintar
    // (el árbol aún no está en la escena: no se pinta junto al escenario anterior). Contra el destino HDR del
    // composer: el programa de three depende del destino (tone mapping, espacio de color) y fuera del fotograma el
    // destino es la pantalla, una variante que la escena nunca pinta. compileAsync fija los parámetros al llamarse
    if (!snap && renderer.compileAsync) {
      const compileFor = (root) => {
        const prev = renderer.getRenderTarget();
        let pr = null;
        try {
          renderer.setRenderTarget(post.target || null);
          pr = renderer.compileAsync(root, camera, scene);
        } finally { renderer.setRenderTarget(prev); }
        return pr;
      };
      try {
        await compileFor(ctx.root);
        if (ctx.cameraRoot.children.length) await compileFor(ctx.cameraRoot);
      } catch { /* opcional */ }
      if (destroyed || req !== themeReq) {
        try { inst.dispose?.(); disposeTree(ctx.root, keepTex); disposeTree(ctx.cameraRoot, keepTex); } catch { /* nada */ }
        return theme?.id ?? null;
      }
    }
    const old = theme;
    theme = null;
    // las luces leen los uniformes del escenario saliente: se sueltan SIEMPRE antes de liberarlo
    try { pace?.unbind(); } catch { /* nada */ }
    paceOn = false;
    retireTheme(old);
    for (const v of [scene.background, scene.environment]) {
      if (v?.isTexture && v !== chosen.bg && v !== chosen.env && !keepTex.has(v)) { try { v.dispose(); } catch { /* nada */ } }
    }
    scene.background = chosen.bg;
    scene.fog = chosen.fog;
    scene.environment = chosen.env;
    camera.near = chosen.near;
    camera.far = chosen.far;
    renderer.setClearColor(chosen.clear, 1);
    post.reset();
    scene.add(ctx.root);
    camera.add(ctx.cameraRoot);
    theme = { id: entry.id, inst, ctx, meta: mod.meta || { id: entry.id, name: entry.name, description: entry.description } };
    themeErr = 0;
    bindPace();
    try { director.setTheme(entry.id, inst); } catch { /* el director es opcional */ }
    callTheme('resize', { width, height, aspect, dpr: dprNow });
    ctx.rig.snap();
    warmQuality(6000); // los primeros fotogramas del escenario nuevo (geometría y texturas a la GPU) no cuentan
    return entry.id;
  }

  /* ───────────── Tamaño y calidad ───────────── */

  function resize(force = false) {
    const w = snap ? snap.width : Math.max(1, Math.round(canvas.clientWidth || canvas.width || 1));
    const h = snap ? snap.height : Math.max(1, Math.round(canvas.clientHeight || canvas.height || 1));
    const devDpr = snap ? snap.dpr : typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const dpr = Math.min(devDpr, snap ? 2 : Q.dpr, 2);
    if (!force && w === width && h === height && dpr === dprNow) return;
    width = w;
    height = h;
    dprNow = dpr;
    aspect = w / h;
    size.width = w; size.height = h; size.aspect = aspect; size.dpr = dpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    post.setSize(w, h, dpr);
    layout.setSize(w, h, tv);
    layout.update();
    callTheme('resize', { width: w, height: h, aspect, dpr });
  }

  function applyQuality(index) {
    qIndex = clamp(index, 0, 3);
    Q = QUALITY[qIndex];
    post.configure(Q.bloom, Q.bloomScale, Q.msaa);
    resize(true);
    lastQChange = nowMs();
    resetQualityWindow();
    callTheme('event', 'quality', { name: Q.name, level: Q.level });
  }

  function resetQualityWindow() {
    fpsFrames = 0;
    fpsTime = 0;
    costSum = 0;
    cadence33 = 0;
  }

  /** Los próximos ms no cuentan para la calidad (compilación de shaders, construcción del escenario, reanudación). */
  function warmQuality(ms = 8000) {
    warmUntil = Math.max(warmUntil, nowMs() + ms);
    resetQualityWindow();
  }

  /* ───────────── Reloj y momentos ───────────── */

  function predicted(now) {
    return st.status === 'running' && !pausedEvt ? st.totalElapsed + ((now - recvAt) / 1000) * st.rate : st.totalElapsed;
  }

  function jumpTo(target) {
    const from = localT;
    localT = target;
    prevLocalT = target;
    jumped = true;
    rig.snap();
    director.snap();
    scrollLag = 0;
    try { pace?.event('seek'); } catch { /* nada */ }
    callTheme('event', 'seek', { from, to: target });
  }

  function emit(type, data) {
    try { onMoment?.(type, data || {}); } catch { /* el reproductor nunca debe tumbar la escena */ }
  }

  function crossGate(i) {
    if (i <= 0 || i >= tl.n) return;
    const now = nowMs();
    if (lastCross === i && now - lastCrossAt < 4000) return;
    lastCross = i;
    lastCrossAt = now;
    const zone = tl.zones[i];
    const prevZone = tl.zones[i - 1];
    const up = (ZONE_RANK[zone] ?? 2) > (ZONE_RANK[prevZone] ?? 2) || tl.speeds[i] > tl.speeds[i - 1] + 0.05;
    callTheme('event', 'gate', { index: i, zone, prevZone, speed: tl.speeds[i], prevSpeed: tl.speeds[i - 1], up });
    try { director.gate(zone, up, now, reduced); } catch { /* idem */ }
    emit('gate', { index: i, zone, up });
  }

  /* ───────────── Fotograma ───────────── */

  function step(dtRaw, now) {
    const dt = Math.min(Math.max(dtRaw, 0), 0.1);
    const time = (now - t0) / 1000;
    const isRunning = st.status === 'running' && !pausedEvt && st.rate > 0;
    const lay = layout.update();

    // Reloj suavizado (PLL): sigue al motor sin tirones; los saltos grandes cortan limpio
    const target = isRunning ? 1 : 0;
    timeScale = damp(timeScale, target, target > timeScale ? 2.8 : 1.5, dt);
    if (Math.abs(timeScale - target) < 0.002) timeScale = target;
    prevLocalT = localT;
    jumped = false;
    const pred = predicted(now);
    const adv = dt * timeScale * st.rate;           // avance nominal de este fotograma
    const err = pred - (localT + adv);              // error DESPUÉS del avance (sin adelantarse un fotograma)
    const r = Math.max(1, st.rate);
    if (Math.abs(err) > 2.5 * r && st.status !== 'finished') jumpTo(pred);
    else {
      const corr = isRunning ? clamp(err * 1.5, -0.6 * r, 0.6 * r) : 0;
      localT += Math.max(0, adv + dt * corr);
    }
    if (tl.version !== tlVersion) {
      tlVersion = tl.version;
      syncSegments();
      callTheme('event', 'timeline', { version: tlVersion });
    }

    const seg = Math.max(0, tl.segAt(localT));
    const zone = tl.zones[seg] || 'jog';
    const next = seg + 1 < tl.n ? seg + 1 : -1;
    const vNow = tl.vAt(localT) * timeScale;
    if (dt > 0 && !jumped) accel = damp(accel, clamp((vNow - vPrev) / dt, -20, 20), 4, dt);
    vPrev = vNow;

    // Cruces de tramo exactos al segundo (sincronizados con el "¡Ahora!" del coach)
    if (!jumped && localT > prevLocalT) {
      for (let i = Math.max(1, seg - 2); i <= seg; i++) {
        const T = tl.starts[i];
        if (prevLocalT < T && localT >= T && localT - T < 1.5) crossGate(i);
      }
    }
    if (pendingSeg && now - pendingSeg.at > 450) {
      if (lastCross !== pendingSeg.index && pendingSeg.index > 0 && Math.abs(tl.starts[pendingSeg.index] - localT) < 3) crossGate(pendingSeg.index);
      pendingSeg = null;
    }

    // Beat: música si llega; si no, uno interno por zona
    const musicBeat = now - beatAt < 4000 && beatBpm > 0;
    let phase;
    let bpm;
    if (musicBeat) {
      bpm = beatBpm;
      phase = beatPhase0 + ((now - beatAt) / 1000) * (beatBpm / 60);
    } else {
      bpm = INTERNAL_BPM[zone] || 120;
      internalPhase += dt * (bpm / 60) * (0.15 + 0.85 * timeScale);
      phase = internalPhase;
    }
    phase -= Math.floor(phase);
    const beat = Math.pow(1 - phase, 3) * (0.25 + 0.75 * timeScale);
    const spec = spectrum.update(dt, time, beat, (ZONE_ENERGY[zone] ?? 0.4) * (0.3 + 0.7 * timeScale));

    // Zancada (§14.1-3): cadencia ≈ 150 + 2,3·km/h (160–185 pasos/min); se cuadra con la música si coincide
    const kmh = Math.max(0, tl.speeds[seg] || 0);
    const cadence = clamp(150 + 2.3 * kmh, 160, 185);
    stepPhase += dt * (cadence / 60) * timeScale;
    if (musicBeat && isRunning) {
      for (const mult of BEAT_MULTS) {
        if (Math.abs(cadence - beatBpm * mult) <= 8) {
          let e = ((phase * mult) % 1) - (stepPhase - Math.floor(stepPhase));
          if (e > 0.5) e -= 1; else if (e < -0.5) e += 1;
          stepPhase += e * Math.min(1, dt * 3);
          break;
        }
      }
    }
    const sp = stepPhase - Math.floor(stepPhase);
    let bobX = 0;
    let bobY = 0;
    if (strideOn && !reduced && timeScale > 0) {
      const k = timeScale * rig.bobScale;
      bobY = (0.5 - 0.5 * Math.cos(sp * Math.PI * 2)) * 0.012 * k;
      bobX = Math.sin(stepPhase * Math.PI) * 0.005 * k;
    }

    // Distancia, fantasma (deltaM por frame) y récord (§14.1-1, -4)
    const youKm = Math.max(0, st.distanceKm + (isRunning ? tl.D(localT) - tl.D(st.totalElapsed) : 0));
    const G = F.ghost;
    G.active = ghost.active && (st.status === 'running' || st.status === 'paused');
    if (ghost.active) {
      G.km = ghost.kmAt(Math.max(0, localT));
      G.speed = ghost.speedAt(Math.max(0, localT));
      G.deltaM = (youKm - G.km) * 1000;
      G.label = ghost.label;
    } else { G.km = 0; G.speed = 0; G.deltaM = 0; G.label = ''; }
    if (G.active && localT > 20 && !finale) {
      if (!goldOn && G.deltaM > 3) {
        goldOn = true;
        callTheme('event', 'record', { on: true, deltaM: G.deltaM });
        emit('record', { on: true, gapM: G.deltaM, deltaM: G.deltaM });
      } else if (goldOn && G.deltaM < -1) {
        goldOn = false;
        callTheme('event', 'record', { on: false, deltaM: G.deltaM });
        emit('record', { on: false, gapM: G.deltaM, deltaM: G.deltaM });
      }
    } else if (goldOn && (!G.active || finale)) {
      goldOn = false;
      callTheme('event', 'record', { on: false, deltaM: G.deltaM });
      emit('record', { on: false, gapM: G.deltaM, deltaM: G.deltaM });
    }
    gold = damp(gold, goldOn ? 1 : 0, 0.8, dt);

    // Final
    if (st.status === 'finished' && !finale) finale = { start: now, dur: 3200, done: false };
    let finP = 0;
    if (finale) {
      finP = clamp01((now - finale.start) / (reduced ? finale.dur * 1.4 : finale.dur));
      if (!finale.done && finP >= 1) {
        finale.done = true;
        try { onFinale?.(); } catch { /* idem */ }
      }
    }

    // Acento con transición gradual (§15.2): nada de cambios bruscos
    const zc = zoneCol[zone] || zoneCol.jog;
    accent.lerp(zc, 1 - Math.exp(-dt * (reduced ? 1.2 : 1.8)));
    if (next >= 0) nextAccent.copy(zoneCol[tl.zones[next]] || zc); else nextAccent.copy(zc);
    const paused = st.status === 'paused' || pausedEvt;
    desat = damp(desat, paused ? 1 : 0, 2.2, dt);

    // Golpe de entrada al sprint (director; APAGADO por defecto: solo con pista `punch: true`, dil = 1 siempre): SOLO el tiempo del mundo se dilata (~35 % → 100 % en 0,6 s); el reloj de
    // la clase, el HUD y la cámara siguen en tiempo real. El recorrido visual recupera su retraso despacio (≤ +10 %).
    let dil = 1;
    try { dil = isRunning && !reduced ? director.dilation(now) : 1; } catch { dil = 1; }
    if (dil < 1) {
      worldLag += (1 - dil) * dt;
      scrollLag += (1 - dil) * dt * timeScale;
    } else if (scrollLag > 0) {
      scrollLag = Math.max(0, scrollLag - Math.min(scrollLag, dt * (0.02 + 0.6 * scrollLag)));
    }

    // Rellenar el frame
    const timeToNext = next >= 0 ? tl.starts[next] - localT : Infinity;
    F.t = localT;
    F.dt = dt * dil;
    F.time = time - worldLag;
    F.totalElapsed = st.totalElapsed;
    F.segIndex = seg;
    F.segElapsed = Math.max(0, localT - tl.starts[seg]);
    F.segRemaining = Math.max(0, tl.ends[seg] - localT);
    F.segDuration = tl.secs[seg];
    F.segProgress = clamp01(F.segElapsed / Math.max(1e-3, tl.secs[seg]));
    F.speed = kmh;
    F.visualSpeed = vNow;
    F.S = tl.S(scrollLag > 0 ? Math.max(0, localT - scrollLag) : localT);
    F.accel = accel;
    F.zone = zone;
    F.prevZone = seg > 0 ? tl.zones[seg - 1] : null;
    F.nextZone = next >= 0 ? tl.zones[next] : null;
    F.nextSpeed = next >= 0 ? tl.speeds[next] : 0;
    F.timeToNext = timeToNext;
    F.approach = next >= 0 && timeToNext < 3 ? clamp01(1 - timeToNext / 3) : 0;
    F.beatPhase = phase;
    F.bpm = bpm;
    F.beat = beat;
    F.musicBeat = musicBeat;
    F.breath = 0.5 - 0.5 * Math.cos((time / 8) * Math.PI * 2);
    F.spectrum = spec;
    F.record.on = goldOn;
    F.record.amount = gold;
    F.status = st.status;
    F.running = isRunning;
    F.paused = paused;
    F.timeScale = timeScale;
    F.finale = finP;
    F.intro = Math.min(1, time / 2.6);
    F.progress = clamp01(localT / Math.max(1, tl.totalSec));
    F.distanceKm = youKm;
    F.kmNext = Math.floor(youKm + 1e-6) + 1;
    F.stage = tl.stage[seg] || 0;
    F.stride.phase = sp;
    F.stride.cadence = cadence;
    F.tvMode = tv;
    F.aspect = aspect;
    F.portrait = aspect < 0.9;
    F.width = width;
    F.height = height;
    F.dpr = dprNow;
    F.hudRects = lay.rects;
    F.quality = Q.name;
    F.qualityLevel = Q.level;
    F.reducedMotion = reduced;
    F.tlVersion = tl.version;

    if (theme?.inst?.update) {
      try {
        theme.inst.update(F);
        themeErr = 0;
      } catch (e) {
        themeFault(e);
      }
    }
    if (theme) {
      applyRigFacade(rig, theme.ctx.rig);
      post.set(theme.ctx._postSettings);
      try { director.apply(F, rig.target, tl, dt, now); } catch { director.snap(); }
    }
    rig.update(dt, aspect, bobX, bobY);
    // luces de tu récord: con la cámara final (desplazamiento de lente incluido). Tres fallos seguidos ⇒ se apagan y
    // cada escenario recupera su propia marca del fantasma (ctx.ghostLights); la escena sigue en 3D
    if (paceOn) {
      try { pace.update(F); paceErr = 0; } catch {
        if (++paceErr >= 3) { paceOn = false; try { pace.unbind(); } catch { /* nada */ } }
      }
    }
  }

  function adaptQuality(now, frameDt, cost) {
    if (now < warmUntil) return;
    fpsFrames++;
    fpsTime += frameDt;
    costSum += cost;
    if (frameDt > 0.0295 && frameDt < 0.0375) cadence33++;
    if (fpsTime < 2) return;
    fps = fpsFrames / fpsTime;
    costAvg = costSum / fpsFrames;
    // rAF limitado a 30 fps por el sistema (modo de bajo consumo / térmico leve) con holgura: cadencia regular de
    // ~33 ms y poco coste por fotograma ⇒ NO es sobrecarga: se mantienen DPR y bloom (bajar no daría ni un fps más)
    throttled = Q.fps > 30 && fps > 26 && fps < 34.5 && cadence33 >= fpsFrames * 0.75 && costAvg < 9;
    resetQualityWindow();
    if (qMode !== 'auto' || snap || throttled) return;
    const since = (now - lastQChange) / 1000;
    const fail = () => {
      blockMs[qIndex] = Math.min(480000, blockMs[qIndex] ? blockMs[qIndex] * 2 : 45000);
      blockedUntil[qIndex] = now + blockMs[qIndex];
    };
    if (fps < 50 && qIndex > 1 && since > 3) { fail(); applyQuality(qIndex - 1); }
    else if (fps < 38 && qIndex === 1 && since > 4) { fail(); applyQuality(0); }
    else if (qIndex === 0 && fps >= 28.5 && costAvg < 6 && since > 20 && now >= blockedUntil[1]) applyQuality(1);
    else if (qIndex > 0 && qIndex < 3 && fps > 58.5 && since > 12 && now >= blockedUntil[qIndex + 1]) applyQuality(qIndex + 1);
  }

  function renderFrame(dt, now) {
    if (needsResize) { needsResize = false; resize(); }
    renderer.info.reset();
    step(dt, now);
    post.render(dt, desat, 1 - 0.06 * desat);
  }

  function frame(ms) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    // En pausa, con la escena ya frenada del todo, bastan 30 fps (media GPU y batería mientras bebes agua); esos
    // fotogramas no cuentan para la calidad adaptativa (si no, bajaría la calidad creyendo que no llega a 60)
    const idle = (st.status === 'paused' || pausedEvt) && timeScale === 0;
    const minInterval = 1000 / (idle ? Math.min(Q.fps, 30) : Q.fps);
    if (lastFrameMs && ms - lastFrameMs < minInterval - 1.5) return;
    const dt = lastMs ? (ms - lastMs) / 1000 : 1 / 60;
    lastMs = ms;
    lastFrameMs = ms;
    try {
      const c0 = nowMs();
      renderFrame(dt, c0);
      errCount = 0;
      const c1 = nowMs();
      if (idle) resetQualityWindow();
      else adaptQuality(c1, Math.min(dt, 0.5), c1 - c0);
    } catch (err) {
      errCount++;
      if (errCount === 4 && theme && theme.id !== FALLBACK_THEME) loadTheme(FALLBACK_THEME).catch(() => {});
      if (errCount > 8) {
        stop();
        try { onError?.(err); } catch { /* nunca tumbar al reproductor */ }
      }
    }
  }

  function start() {
    if (snap || running || destroyed || lost || parked) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!post.built) applyQuality(qIndex); // tras liberar los render targets
    running = true;
    lastMs = 0;
    lastFrameMs = 0;
    warmQuality(8000);
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /* ───────────── Eventos del sistema ───────────── */

  const onVisibility = () => {
    if (document.hidden) {
      stop();
      clearTimeout(hiddenTimer);
      // en segundo plano y en pausa más de 60 s: suelta los render targets (iOS reclama memoria)
      hiddenTimer = setTimeout(() => {
        if (!destroyed && document.hidden && st.status !== 'running') { try { post.release(); } catch { /* nada */ } }
      }, 60000);
    } else {
      clearTimeout(hiddenTimer);
      start();
    }
  };
  const onLost = (e) => { e.preventDefault(); lost = true; stop(); };
  const onRestored = () => {
    lost = false;
    post.forget(); // los render targets eran del contexto perdido: no se liberan, se olvidan
    applyQuality(qIndex);
    rig.snap();
    start();
  };
  const onResize = () => { needsResize = true; };
  const onMotion = (e) => { reduced = !!reducedMotion || e.matches; };
  let ro = null;
  function teardownListeners() {
    canvas.removeEventListener('webglcontextlost', onLost, false);
    canvas.removeEventListener('webglcontextrestored', onRestored, false);
    if (!snap) {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      mql?.removeEventListener?.('change', onMotion);
      ro?.disconnect();
    }
  }
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);
  if (!snap) {
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    mql?.addEventListener?.('change', onMotion);
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(onResize);
      ro.observe(canvas);
    }
  }

  // Arranque: calidad, escenario (con respaldo), primer fotograma y bucle
  if (snap) { qMode = QUALITY_INDEX[quality] !== undefined && quality !== 'auto' ? quality : 'high'; qIndex = QUALITY_INDEX[qMode]; }
  applyQuality(qIndex);
  try {
    await loadTheme(typeof themeOpt === 'string' ? themeOpt : DEFAULT_THEME);
  } catch (err) {
    // ni el escenario pedido ni el de respaldo: liberar la GPU y que el reproductor use su fondo 2D
    destroyed = true;
    teardownListeners();
    try { post.dispose(); spectrum.dispose(); renderer.dispose(); renderer.forceContextLoss(); } catch { /* nada */ }
    throw err;
  }
  if (destroyed) return noopController();
  start();

  /* ───────────── API ───────────── */

  const api = {
    setState(s) {
      if (destroyed || !s) return;
      try {
        const now = nowMs();
        const prevStatus = st.status;
        const prevElapsed = st.totalElapsed;
        if (typeof s.status === 'string') st.status = s.status;
        if (Number.isFinite(s.totalElapsed)) st.totalElapsed = Math.max(0, s.totalElapsed);
        if (Number.isFinite(s.segIndex)) st.segIndex = s.segIndex;
        if (Number.isFinite(s.segElapsed)) st.segElapsed = s.segElapsed;
        if (Number.isFinite(s.segRemaining)) st.segRemaining = s.segRemaining;
        if (Number.isFinite(s.distanceKm)) st.distanceKm = Math.max(0, s.distanceKm);
        if (Number.isFinite(s.currentSpeed)) st.currentSpeed = s.currentSpeed;
        st.rate = Number.isFinite(s.rate) ? Math.max(0, s.rate) : 1;
        recvAt = now;
        distOffset = st.distanceKm - tl.D(st.totalElapsed);
        if (st.status === 'running' && prevStatus !== 'running') pausedEvt = false;
        if (st.status === 'paused') pausedEvt = true;
        if (prevStatus === 'ready' && st.status === 'running') callTheme('event', 'start', {});
        if (st.status !== 'finished' && finale && st.totalElapsed < prevElapsed - 1) finale = null; // laboratorio: rebobinar
        const si = st.segIndex;
        if (st.status === 'running' && si >= 0 && si < tl.n && st.currentSpeed > 0 && Math.abs(st.currentSpeed - tl.speeds[si]) >= 0.05) {
          tl.adjust(st.totalElapsed, si, st.currentSpeed);
        }
      } catch { /* datos raros: se ignoran */ }
    },

    setBeat(phase, bpm) {
      if (destroyed) return;
      const p = Number(phase);
      const b = Number(bpm);
      if (!Number.isFinite(p)) return;
      beatPhase0 = p - Math.floor(p);
      beatBpm = Number.isFinite(b) && b > 30 && b < 260 ? b : beatBpm || 120;
      beatAt = nowMs();
    },

    event(type, data = {}) {
      if (destroyed || typeof type !== 'string') return;
      const d = data && typeof data === 'object' ? data : {};
      try {
        const now = nowMs();
        switch (type) {
          case 'segment': {
            const idx = Number(d.index);
            if (Number.isFinite(idx) && idx > 0 && d.reason !== 'restart' && d.reason !== 'skip') pendingSeg = { index: idx, at: now };
            break;
          }
          case 'km':
            if (Number.isFinite(Number(d.km))) emit('km', { km: Number(d.km) });
            if (st.status === 'running' && !pausedEvt) { try { director.km(now, reduced); } catch { /* idem */ } }
            break;
          case 'halfway': emit('halfway', {}); break;
          case 'drop': emit('drop', {}); break;
          case 'finish':
            st.status = 'finished';
            if (!finale) {
              const ms = Number(d.durationMs);
              finale = { start: now, dur: Number.isFinite(ms) && ms > 0 ? clamp(ms * 0.7, 2400, 4200) : 3200, done: false };
            }
            break;
          case 'pause': pausedEvt = true; break;
          case 'resume': pausedEvt = false; recvAt = now; break;
          case 'adjust': {
            const sp = Number(d.speed);
            const si = Math.max(0, tl.segAt(localT));
            if (Number.isFinite(sp)) tl.adjust(localT, si, sp);
            break;
          }
          default: break;
        }
      } catch { /* idem */ }
      callTheme('event', type, d);
    },

    resize() { if (!destroyed) needsResize = true; },

    setQuality(q) {
      if (destroyed) return;
      if (q === 'off') { stop(); return; }
      qMode = QUALITY_INDEX[q] !== undefined ? q : 'auto';
      blockedUntil.fill(0);
      blockMs.fill(0);
      applyQuality(QUALITY_INDEX[qMode]);
      start();
    },

    /** false: la escena se queda creada pero sin pintar (p. ej. oculta en la preparación); true: vuelve a pintar. */
    setRunning(on) {
      if (destroyed) return;
      parked = on === false;
      if (parked) stop();
      else start();
    },

    setTvMode(on) {
      if (destroyed) return;
      tv = !!on;
      layout.setSize(width, height, tv);
      callTheme('event', 'tv', { on: tv });
    },

    /** §15.3: rectángulos (px CSS relativos al lienzo) del HUD — SOLO para composición, jamás máscaras. */
    setHudRects(rects) {
      if (destroyed) return;
      try { layout.setRects(rects); } catch { /* idem */ }
    },

    /** §14.1-1: { trace:[[t, km/h]...], label } o null. Devuelve una promesa (las luces se cargan la primera vez). */
    setGhost(g) {
      if (destroyed) return Promise.resolve();
      try { ghost.set(g || null); } catch { /* idem */ }
      // luces de tu récord: módulo perezoso (la primera sesión de una clase no tiene fantasma y no lo carga)
      if (g?.trace && !pace && !paceLoad) {
        paceLoad = import('./scene3d/pacelights/index.js')
          .then((m) => {
            if (destroyed) return;
            pace = m.createPaceLights({
              THREE, scene, camera, renderer, hud: layout.out, pulse: (a, d) => post.pulse(a, d), snap: !!snap, target: () => post.target,
            });
            bindPace();
          })
          .catch(() => { pace = null; paceOn = false; });
      }
      try { pace?.event('ghost'); } catch { /* nada */ }
      return paceLoad || Promise.resolve();
    },

    /** §14.1-2: AnalyserNode del motor DJ o null (simulación suave a partir del beat). */
    setAnalyser(node) {
      if (destroyed) return;
      try { spectrum.set(node || null); } catch { /* idem */ }
    },

    setStride(on) { strideOn = on !== false; },
    setStrideBob(on) { strideOn = on !== false; },

    /** Cambia de escenario en caliente (el anterior sigue hasta que el nuevo está listo). */
    async setTheme(id) {
      if (destroyed) return false;
      if (theme?.id === id) return true;
      if (!themeById(id)) return false; // id desconocido: se queda el escenario actual
      try { return (await loadTheme(id)) === id; } catch { return false; }
    },
    getTheme() { return theme?.id ?? null; },

    getInfo() {
      return {
        fps: Math.round(fps), quality: Q.name, mode: qMode, level: qIndex, dpr: dprNow, theme: theme?.id ?? null,
        cost: +costAvg.toFixed(2), throttled, running, parked,
        t: +localT.toFixed(2), reduced, tv, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        ghost: F.ghost.active ? Math.round(F.ghost.deltaM) : null, golden: goldOn, audio: spectrum.out.live,
        stride: strideOn && !reduced, post: { ...post.settings }, director: director.info(),
      };
    },

    /** Capturas deterministas (solo con la opción `snapshot`): reloj virtual y fotogramas a mano. */
    snapshot: {
      get enabled() { return !!snap; },
      canvas,
      /** Ajusta el reloj de la clase al estado recibido (sin rampas) y corta la cámara a su pose. */
      sync() {
        if (!snap) return;
        localT = predicted(nowMs());
        prevLocalT = localT;
        timeScale = st.status === 'running' && !pausedEvt ? 1 : 0;
        rig.snap();
        director.snap();
        scrollLag = 0;
      },
      /** Avanza el reloj virtual dt segundos y pinta un fotograma (síncrono). */
      step(dt = 1 / 60) {
        if (!snap || destroyed) return;
        virtMs += dt * 1000;
        renderFrame(dt, virtMs);
      },
      get now() { return virtMs; },
    },

    /** Solo laboratorio: acceso a internos. */
    get _debug() { return { renderer, scene, camera, post, rig, tl, layout: layout.out, frame: F, theme, pace, paceOn }; },

    destroy({ releaseContext = true } = {}) {
      if (destroyed) return;
      destroyed = true;
      stop();
      clearTimeout(hiddenTimer);
      teardownListeners();
      try {
        try { pace?.dispose(); } catch { /* nada */ }
        pace = null;
        paceOn = false;
        retireTheme(theme);
        theme = null;
        post.dispose();
        spectrum.dispose();
        renderer.renderLists.dispose();
        renderer.dispose();
        if (releaseContext) {
          renderer.forceContextLoss();
          canvas.width = 1;
          canvas.height = 1;
        }
      } catch { /* liberar lo que se pueda */ }
    },
  };
  return api;
}
