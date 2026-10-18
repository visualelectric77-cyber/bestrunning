// BestRunning · motor DJ (SPEC §11.4) sobre AudioBuffers. Cada trozo que suena es un AudioBufferSourceNode
// arrancado con start(cuándo, desde) en el reloj del AudioContext (exacto a la muestra) y a velocidad CONSTANTE:
// nada de playbackRate/currentTime cambiando en directo (en iOS los <audio> así daban silencios en los cambios de
// tramo y tirones). Mezclas, filtros, riser/eco y ducking: automatizaciones de AudioParam programadas por delante.
// No toca window/document al importarse.
//
// Voz:     fuente → trim (gainDb) → hp → lp → lowShelf 200 Hz (graves) → gain (mezcla) → kill (cortes/pausa)
//          → dry → bus;   kill → send → eco.
// Maestro: bus → hp → lp → duck (voz) → fade (pausa/fin) → music (volumen) → limitador → destino (+ analizador).
// Eco:     DelayNode (3/4 de tiempo) ⟲ lowpass/highpass · feedback 0,45 → duck.  FX (riser, impact) → fx → duck.
// Tiempo:  c (reloj del contexto) = base + T (s de clase); update(T) re-ancla base poco a poco.
// Tempo:   cada voz suena a un rate fijo (±3 % como mucho; en beatmix el que iguala a la saliente). Sin rampas.
// Memoria: cada buffer guarda solo la ventana de la pista que usa el plan (music-buffers.js): las posiciones son
//          SIEMPRE s de pista y la voz resta el inicio de su ventana (w0) al arrancar la fuente.
// Nunca silencio: si la entrante no está decodificada a tiempo sigue la actual (con un bucle de frase si se acaba).
//
// API (compatible con el SPEC): unlock() y load() → Promise<boolean>; stop() → Promise; setDucking(bool);
// status() para depurar; getAnalyser() → AnalyserNode (fftSize 1024) tras musicGain, o null sin música (§14.1).
// Pruebas: createMusicEngine({ context, now }) acepta un contexto inyectado (p. ej. OfflineAudioContext) y un reloj.
import * as audioEngine from './audio-engine.js';
import { trackGrid, cueIndexAt, cuePosition, snapToBar, beatPhaseAt, END_FADE_SEC, ZONE_POOLS } from './music-plan.js';
import { createBufferStore } from './music-buffers.js';

export const RATE_TOL = 0.03;      // velocidad fija de cada voz: 1 ± 3 % como mucho
const MAX_DRIFT_BEATS = 0.03;      // deriva tolerada en los bordes de un beatmix con tempo casi igual
const SCHEDULE_AHEAD = 3;          // s: las transiciones se programan con esta antelación
const MIN_LEAD = 0.1;              // s: margen entre programar y sonar
const SOON_MIN = 0.025;            // s: lo "inmediato" va como mínimo así de adelantado (iOS renderiza a lotes)
const KILL_MIN = 0.08;             // s: fundido de corte mínimo
const PREFETCH_AHEAD = 100;        // s: horizonte de decodificación (siempre ≥ 45 s antes de hacer falta)
const LOOP_PREP = 10;              // s: antelación del bucle de frase cuando una pista se acaba
const LOOP_JUMP_BARS = 16;
const SAFETY_LOOP_BARS = 16;       // red de seguridad sin JS: la fuente repite su última frase
const WIN_PRE_BARS = 2;            // ventana de cada pista: desde su primera entrada en el plan − 2 compases
const WIN_POST_BARS = 6;           // … hasta su última salida prevista + 6 compases
const WIN_DRIFT = 0.06;            // … + 6 % del tiempo que suena (el rate fijo del motor no es el del plan)
const MAX_VOICES = 6;
const STALL_SEC = 1;               // reloj del contexto quieto con estado 'running' durante más de esto: atascado
const LOOP_MS = 200;
const XF_STEPS = 16;
const HALF_PI = Math.PI / 2;
const DUCK_GAIN = 10 ** (-9 / 20);
const DUCK_MIX = 10 ** (-6 / 20);  // con una transición filtrada en curso la música ya va más baja
const DUCK_ATTACK = 0.12;
const DUCK_RELEASE = 0.45;
const FILTER_MIXES = new Set(['riser-drop', 'echo-out', 'filter-fade', 'start']);
const VOICE_STUCK = 20;
const BASS_CUT_DB = -26;
const LP_OPEN = 20000;
const HP_OPEN = 20;
const RISER_HP = 600;              // highpass de la saliente en el riser (con efectos; 400 Hz sin ellos)
const CUT_LEVEL = 0.25;            // la saliente en el tiempo de corte, bajo el riser
const ECHO_LP = 1500;              // lowpass inicial de la entrante tras el eco (se abre en 1 compás)
const ECHO_FEEDBACK = 0.45;
const FX_LEVEL = 0.75;
const LIFT_MAX_DB = 6;             // intro floja: la entrante sube hasta +6 dB hasta su drop
const LIFT_MIN_DB = 1.5;
const PAUSE_FADE = 0.3;
const RESUME_FADE = 0.6;
const SEEK_FADE = 1;
const LATE_FADE = 1.5;
const START_FADE = 2.5;
const RESYNC = 1.5;
// La rejilla de library.json (y del análisis en el iPhone) marca el tiempo ~80 ms antes del golpe audible
// (BEAT_LEAD_SEC de music-analysis.js): las animaciones a ritmo lo compensan para latir con el bombo.
const AUDIBLE_LEAD = 0.08;

const perfNow = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dbToGain = (db) => 10 ** ((Number(db) || 0) / 20);
const volGain = (v) => clamp(Number(v) || 0, 0, 1) ** 2;
const fitRate = (r) => clamp(Number(r) || 1, 1 - RATE_TOL, 1 + RATE_TOL);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Rate fijo para una pista que entra sola (sin tempo que igualar): el del plan, recortado a ±3 %. */
function soloRate(cue) {
  const r = fitRate(cue.rate);
  return Math.abs(r - 1) < 0.004 ? 1 : Math.round(r * 10000) / 10000;
}

/** Instante (s de clase) de la primera acción de un cambio de pista, con margen para cuadrar a compás. */
const firstActionT = (cue) => num(cue.atSec) - Math.max(num(cue.leadSec), num(cue.atSec) - num(cue.entryAt, cue.atSec)) - 2;

export function createMusicEngine(opts = {}) {
  const { getAudioContext = null, keepSession = false, context = null, now = null } = opts || {};
  const injected = context && typeof context === 'object' ? context : null;
  const offline = !!injected && typeof injected.startRendering === 'function';
  const getCtx = injected ? () => injected : typeof getAudioContext === 'function' ? getAudioContext : audioEngine.getAudioContext;
  const manualClock = typeof now === 'function';
  const clock = manualClock ? now : perfNow;
  const autoTick = opts.autoTick ?? !manualClock;
  const store = createBufferStore({
    getContext: () => ctx, loadData: opts.loadData || null, timeoutMs: opts.decodeTimeoutMs, budgetBytes: opts.budgetBytes,
    windowFor: (t) => windowFor(t), now: clock,
  });

  let ctx = null;
  let graph = null;
  let graphFailed = false;
  let plan = null;
  let tracks = new Map();
  let cursor = 0;             // siguiente cue del plan por programar
  let fastDur = 0;            // > 0: el cue del cursor entra con un fundido simple (arranque, salto, rescate)
  let fastFilter = false;
  let state = 'idle';         // idle | ready | playing | paused | stopped
  let enabled = true;
  let effects = true;
  let ducking = true;
  let volume = 0.8;
  let base = 0;
  let frozenT = 0;
  let timer = null;
  let destroyed = false;
  let speaking = false;
  let voiceTok = 0;
  let endFading = false;
  let pendingSync = false;
  let sessionOn = false;
  let listening = false;
  let noiseBuf = null;
  let lastResume = -Infinity;
  let cur = null;             // voz principal
  let mix = null;             // transición programada
  let held = null;            // pausa: { track, buf, rate, pos }
  const voices = [];
  const liveFx = [];
  const timers = [];
  const deckMem = new Map();  // trackId → posición al dejarla (memoria de discos real, con nuestros rates)
  const subst = new Map();    // trackId que no carga → sustituta del mismo tramo
  const cueCache = new Map();
  // Reloj del contexto atascado ('running' sin avanzar) y registro para el panel de depuración
  let lastCtxT = -1;
  let lastMoveW = 0;
  let quietChecks = 0;
  let stalled = false;
  let stalls = 0;
  let kickArmed = false;
  const ctxLog = [];          // últimos cambios de estado: { at (s de reloj), state, t (contexto) }
  let latAt = -Infinity;
  let latVal = 0;
  let latSrc = 'none';
  let seeks = 0;

  const live = (v) => (v && !v.dead ? v : null);
  const ctxRunning = () => !!ctx && (offline || (ctx.state === 'running' && !stalled));
  const nowT = () => (state === 'playing' && ctx ? ctx.currentTime - base : frozenT);
  /** Instante del contexto para automatizaciones "inmediatas": nunca en un lote de audio ya en curso. */
  const soon = () => ctx.currentTime + Math.max(SOON_MIN, (Number(ctx.baseLatency) || 0) + 256 / (ctx.sampleRate || 48000));
  const logCtx = (what) => {
    ctxLog.push({ at: Math.round(clock() * 10) / 10, state: what, t: ctx ? Math.round(ctx.currentTime * 100) / 100 : null });
    if (ctxLog.length > 10) ctxLog.shift();
  };

  /* ───────────── Reloj interno (temporizadores reales o del reloj inyectado) ───────────── */

  function defer(sec, fn) {
    if (!manualClock && typeof setTimeout === 'function') { setTimeout(fn, Math.max(0, sec) * 1000); return; }
    timers.push({ at: clock() + sec, fn });
  }

  function runTimers() {
    if (!timers.length) return;
    const t = clock();
    for (let i = 0; i < timers.length;) {
      if (timers[i].at <= t) {
        const x = timers.splice(i, 1)[0];
        try { x.fn(); } catch { /* nada */ }
      } else i++;
    }
  }

  /* ───────────── Contexto y grafo ───────────── */

  function ensureCtx() {
    if (ctx) return ctx;
    try { ctx = getCtx?.() || null; } catch { ctx = null; }
    if (ctx && !offline) {
      try { ctx.addEventListener?.('statechange', onCtxState); } catch { /* sin eventos */ }
      logCtx(ctx.state);
    }
    return ctx;
  }

  function gainNode(v) {
    const n = ctx.createGain();
    n.gain.value = v;
    return n;
  }

  function biquad(type, f, q = 0.707) {
    const n = ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    return n;
  }

  function ensureGraph() {
    if (graph) return true;
    if (graphFailed || !ensureCtx()) return false;
    try {
      const g = {};
      g.limiter = ctx.createDynamicsCompressor();
      g.limiter.threshold.value = -1.5;
      g.limiter.knee.value = 0;
      g.limiter.ratio.value = 20;
      g.limiter.attack.value = 0.002;
      g.limiter.release.value = 0.12;
      g.music = gainNode(volGain(volume));
      g.fade = gainNode(0);
      g.duck = gainNode(speaking && ducking ? DUCK_GAIN : 1);
      g.hp = biquad('highpass', HP_OPEN);
      g.lp = biquad('lowpass', LP_OPEN);
      g.bus = gainNode(1);
      g.fx = gainNode(FX_LEVEL);
      g.echoIn = gainNode(1);
      g.delay = ctx.createDelay(2);
      g.delay.delayTime.value = 0.35;
      g.fbLp = biquad('lowpass', 2600);
      g.fbHp = biquad('highpass', 120);
      g.fb = gainNode(ECHO_FEEDBACK);
      g.ret = gainNode(0.8);
      g.bus.connect(g.hp);
      g.hp.connect(g.lp);
      g.lp.connect(g.duck);
      g.duck.connect(g.fade);
      g.fade.connect(g.music);
      g.music.connect(g.limiter);
      g.limiter.connect(ctx.destination);
      g.fx.connect(g.duck);
      g.echoIn.connect(g.delay);
      g.delay.connect(g.fbLp);
      g.fbLp.connect(g.fbHp);
      g.fbHp.connect(g.fb);
      g.fb.connect(g.delay);
      g.fbHp.connect(g.ret);
      g.ret.connect(g.duck);
      graph = g;
      return true;
    } catch {
      graphFailed = true;
      graph = null;
      return false;
    }
  }

  function resumeCtx(force = false) {
    if (!ctx || offline) return;
    const t = clock();
    if (!force && t - lastResume < 0.8) return;
    lastResume = t;
    try { if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume?.()?.catch?.(() => {}); } catch { /* sin permiso */ }
  }

  // iOS: el contexto pasa a 'interrupted' (llamada, Siri, otra app) o 'suspended'; se reanuda en cuanto se puede
  function onCtxState() {
    if (ctx) logCtx(ctx.state);
    if (destroyed || state !== 'playing' || !enabled || !ctx) return;
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') defer(0.3, () => resumeCtx(true));
  }

  /** Reloj del contexto: si dice 'running' pero no avanza (salida atascada tras un cambio de ruta), no se programa nada. */
  function clockCheck() {
    if (offline || !ctx) return;
    const c = ctx.currentTime;
    const w = clock();
    if (c !== lastCtxT) {
      lastCtxT = c;
      lastMoveW = w;
      quietChecks = 0;
      if (stalled) { stalled = false; logCtx('reloj en marcha'); }
      return;
    }
    quietChecks++;
    // 3 comprobaciones seguidas y > 1 s: un JS que vuelve de dormir no lo confunde con un atasco
    if (!stalled && ctx.state === 'running' && quietChecks >= 3 && w - lastMoveW > STALL_SEC) {
      stalled = true;
      stalls++;
      kickArmed = true;
      logCtx('reloj parado');
    }
  }

  /** En un toque: el contexto atascado se suspende y se reanuda (despierta la salida de audio). */
  function kick() {
    if (!kickArmed || !ctx || offline) return;
    kickArmed = false;
    logCtx('reinicio');
    try { ctx.suspend?.()?.then?.(() => ctx.resume?.())?.catch?.(() => {}); } catch { /* nada */ }
  }

  function onWake(e) {
    if (destroyed) return;
    if (e?.type === 'visibilitychange' && globalThis.document?.visibilityState === 'visible') store.retryNow();
    if (state !== 'playing' || !enabled || !ctx) return;
    if (stalled && e?.type !== 'visibilitychange' && e?.type !== 'pageshow') { kick(); return; }
    if (ctx.state === 'running') return;
    if (globalThis.document?.visibilityState === 'hidden') return;
    resumeCtx(true);
  }

  function onOnline() {
    if (!destroyed) store.retryNow();
  }

  function setSession(on) {
    if (on === sessionOn || offline) return;
    sessionOn = on;
    // keepSession: el reproductor es dueño de la sesión durante el entreno ('playback' hasta la frase final) y la
    // devuelve él a 'auto'; el motor solo la sube, nunca la baja (antes, parar/apagar la música callaba al coach)
    if (!on && keepSession) return;
    try {
      const fn = audioEngine.setAudioSessionType;
      if (typeof fn === 'function') { fn(on ? 'playback' : 'auto'); return; }
    } catch { /* sigue con la API directa */ }
    try { const s = globalThis.navigator?.audioSession; if (s) s.type = on ? 'playback' : 'auto'; } catch { /* no disponible */ }
  }

  function listen() {
    if (listening) return;
    listening = true;
    try { globalThis.addEventListener?.('br:voice', onVoice); } catch { /* sin DOM */ }
    if (offline) return;
    const doc = globalThis.document;
    try {
      doc?.addEventListener?.('visibilitychange', onWake);
      globalThis.addEventListener?.('pageshow', onWake);
      globalThis.addEventListener?.('online', onOnline);
      doc?.addEventListener?.('touchend', onWake, { capture: true, passive: true });
      doc?.addEventListener?.('pointerdown', onWake, { capture: true, passive: true });
    } catch { /* sin DOM */ }
  }

  function unlisten() {
    try { globalThis.removeEventListener?.('br:voice', onVoice); } catch { /* nada */ }
    const doc = globalThis.document;
    try {
      doc?.removeEventListener?.('visibilitychange', onWake);
      globalThis.removeEventListener?.('pageshow', onWake);
      globalThis.removeEventListener?.('online', onOnline);
      doc?.removeEventListener?.('touchend', onWake, { capture: true });
      doc?.removeEventListener?.('pointerdown', onWake, { capture: true });
      ctx?.removeEventListener?.('statechange', onCtxState);
    } catch { /* nada */ }
    listening = false;
  }

  /* ───────────── Automatización ───────────── */

  function setAt(p, v, t) { try { p.setValueAtTime(v, t); } catch { /* nada */ } }
  function rampAt(p, v, t) { try { p.linearRampToValueAtTime(v, t); } catch { /* nada */ } }
  function expAt(p, v, t) { try { p.exponentialRampToValueAtTime(Math.max(1e-4, v), t); } catch { /* nada */ } }

  /** Congela la automatización en t (cancelAndHoldAtTime si existe; si no, el valor actual). */
  function holdAt(p, t) {
    try {
      if (typeof p.cancelAndHoldAtTime === 'function') { p.cancelAndHoldAtTime(t); return; }
      const v = p.value;
      p.cancelScheduledValues(t);
      p.setValueAtTime(v, t);
    } catch { /* nada */ }
  }

  /** Fundido de potencia constante (seno/coseno) en tramos lineales. */
  function xfade(p, t0, t1, up, peak = 1) {
    const d = Math.max(0.005, t1 - t0);
    setAt(p, up ? 0 : peak, t0);
    for (let k = 1; k <= XF_STEPS; k++) {
      const x = k / XF_STEPS;
      rampAt(p, peak * (up ? Math.sin(x * HALF_PI) : Math.cos(x * HALF_PI)), t0 + d * x);
    }
  }

  function sweep(p, from, to, t0, t1) {
    setAt(p, Math.max(1, from), t0);
    expAt(p, Math.max(1, to), Math.max(t0 + 0.01, t1));
  }

  function fadeMaster(c, to, sec) {
    if (!graph) return;
    holdAt(graph.fade.gain, c);
    rampAt(graph.fade.gain, to, c + Math.max(0.01, sec));
  }

  function openMaster(c, sec) {
    if (!graph) return;
    holdAt(graph.hp.frequency, c);
    holdAt(graph.lp.frequency, c);
    expAt(graph.hp.frequency, HP_OPEN, c + Math.max(0.01, sec));
    expAt(graph.lp.frequency, LP_OPEN, c + Math.max(0.01, sec));
  }

  /* ───────────── Voces ───────────── */

  /** Ventana (s de pista) que cubre un buffer: { w0, wEnd } (la pista entera si no se recortó). */
  function winOf(track, buf) {
    const w0 = buf ? store.offsetOf(buf) : 0;
    const dur = trackGrid(track)?.duration || 0;
    return { w0, wEnd: buf ? Math.min(dur || w0 + buf.duration, w0 + buf.duration) : dur };
  }

  /** Lleva una posición dentro de la ventana del buffer, a saltos de frase (16 compases): no pierde el compás. */
  function fitPos(track, win, p) {
    const g = trackGrid(track);
    const ph = 16 * g.barSec;
    const lo = win.w0;
    const hi = win.wEnd - 8 * g.barSec;
    if (hi <= lo) return clamp(p, win.w0, Math.max(win.w0, win.wEnd - 2 * g.barSec));
    let q = p;
    for (let k = 0; q > hi && k < 64; k++) q -= ph;
    for (let k = 0; q < lo && k < 64; k++) q += ph;
    if (q > hi || q < lo) q = Math.max(lo, snapToBar(track, clamp(q, lo, hi), 'prev'));
    return q;
  }

  /** Nueva voz: `buf` desde `pos` (s de pista) en el instante `startC` del contexto, a `rate` fijo. Entra en silencio. */
  function makeVoice(track, buf, rate, startC, pos) {
    if (!track || !buf || !graph) return null;
    const g = trackGrid(track);
    const { w0, wEnd: dur } = winOf(track, buf);
    const p0 = clamp(pos, w0, Math.max(w0, dur - 1));
    const v = {
      track, buf, rate, c0: startC, p0, startC, stopC: Infinity, dead: false, loop: false, ls: 0, le: 0, safeC: Infinity,
      w0, wEnd: dur, ride: null,
      src: null, trim: null, hp: null, lp: null, shelf: null, gain: null, kill: null, dry: null, send: null,
    };
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const le = snapToBar(track, dur - 0.5 * g.barSec, 'prev');
      const ls = le - SAFETY_LOOP_BARS * g.barSec;
      if (ls >= Math.max(g.firstBar, w0) - 1e-6 && le <= dur && p0 < le - 0.05) {
        src.loop = true;
        src.loopStart = ls - w0;
        src.loopEnd = le - w0;
        v.loop = true;
        v.ls = ls;
        v.le = le;
      }
      v.src = src;
      v.trim = gainNode(dbToGain(track.gainDb));
      v.hp = biquad('highpass', HP_OPEN);
      v.lp = biquad('lowpass', LP_OPEN);
      v.shelf = ctx.createBiquadFilter();
      v.shelf.type = 'lowshelf';
      v.shelf.frequency.value = 200;
      v.shelf.gain.value = 0;
      v.gain = gainNode(0);
      v.kill = gainNode(1);
      v.dry = gainNode(1);
      v.send = gainNode(0);
      src.connect(v.trim);
      v.trim.connect(v.hp);
      v.hp.connect(v.lp);
      v.lp.connect(v.shelf);
      v.shelf.connect(v.gain);
      v.gain.connect(v.kill);
      v.kill.connect(v.dry);
      v.dry.connect(graph.bus);
      v.kill.connect(v.send);
      v.send.connect(graph.echoIn);
      setAt(v.gain.gain, 0, Math.max(0, startC - 0.01));
      v.safeC = startC + (dur - 2 * g.barSec - p0) / rate;
      src.onended = () => dispose(v);
      // Si el instante ya pasó (hilo principal ocupado), arranca ya pero en la posición que le toca: el modelo no cambia
      const late = Math.max(0, ctx.currentTime - startC);
      src.start(Math.max(0, startC) + late, p0 - w0 + late * rate);
    } catch {
      dispose(v);
      return null;
    }
    voices.push(v);
    if (voices.length > MAX_VOICES) capVoices(v);
    return v;
  }

  /** Nunca más de MAX_VOICES (p. ej. saltos en bucle con el reloj atascado): fuera las más antiguas que no mandan. */
  function capVoices(keep) {
    for (let i = 0; voices.length > MAX_VOICES && i < voices.length;) {
      const v = voices[i];
      if (v === keep || v === cur || v === mix?.inV || v === mix?.outV) { i++; continue; }
      try { v.src?.stop(); } catch { /* ya parada */ }
      dispose(v);
    }
  }

  function stopVoice(v, at) {
    if (!v || v.dead || v.stopC < Infinity) return;
    v.stopC = at;
    try { v.src.stop(Math.max(at, v.startC + 0.001)); } catch { /* ya parada */ }
  }

  /** Fundido de salida por el nodo kill (no toca la automatización de mezcla) y parada. */
  function killFade(v, t, dur) {
    if (!v || v.dead || v.stopC < Infinity) return;
    const d = Math.max(KILL_MIN, dur);
    xfade(v.kill.gain, t, t + d, false);
    stopVoice(v, t + d + 0.02);
  }

  /** Lleva una voz a su estado neutro (tras abortar una mezcla a medias): sin filtros, sin envío, a pleno. */
  function restoreVoice(v, t, sec = 0.25) {
    if (!live(v)) return;
    for (const [p, to, exp] of [[v.gain.gain, 1, false], [v.dry.gain, 1, false], [v.send.gain, 0, false],
      [v.shelf.gain, 0, false], [v.hp.frequency, HP_OPEN, true], [v.lp.frequency, LP_OPEN, true]]) {
      holdAt(p, t);
      if (exp) expAt(p, to, t + sec); else rampAt(p, to, t + sec);
    }
  }

  function dispose(v) {
    if (v.dead) return;
    v.dead = true;
    for (const n of [v.src, v.trim, v.hp, v.lp, v.shelf, v.gain, v.kill, v.dry, v.send]) { try { n?.disconnect(); } catch { /* nada */ } }
    v.src = null;
    v.buf = null;
    const i = voices.indexOf(v);
    if (i >= 0) voices.splice(i, 1);
    if (v === cur) cur = null;
  }

  /** Posición (s de pista) de la voz en el instante c del contexto (con su bucle de seguridad). */
  function vPos(v, c) {
    let p = v.p0 + (c - v.c0) * v.rate;
    if (v.loop && p >= v.le) p = v.ls + ((p - v.ls) % (v.le - v.ls));
    return p;
  }

  /** Instante del contexto del compás de la voz más cercano a c ('nearest' | 'next' | 'prev'). */
  function vDownbeat(v, c, mode = 'nearest') {
    const g = trackGrid(v.track);
    const i = (v.p0 + (c - v.c0) * v.rate - g.barOffset) / g.barSec;
    const k = mode === 'next' ? Math.ceil(i - 1e-6) : mode === 'prev' ? Math.floor(i + 1e-6) : Math.round(i);
    return v.c0 + (g.barOffset + k * g.barSec - v.p0) / v.rate;
  }

  function gc(c) {
    for (let i = voices.length - 1; i >= 0; i--) {
      const v = voices[i];
      if (v.stopC + 0.25 < c) dispose(v);
    }
    for (let i = liveFx.length - 1; i >= 0; i--) {
      const e = liveFx[i];
      if (e.end + 0.25 < c) {
        for (const n of e.nodes) { try { n.disconnect(); } catch { /* nada */ } }
        liveFx.splice(i, 1);
      }
    }
  }

  /* ───────────── Efectos (riser e impact) ───────────── */

  function noise() {
    if (noiseBuf) return noiseBuf;
    const len = Math.floor(ctx.sampleRate * 2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    let s = 0x2545f491;
    for (let i = 0; i < len; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; ch[i] = ((s >>> 0) / 4294967296) * 2 - 1; }
    return noiseBuf;
  }

  function fxEntry(end) {
    const out = gainNode(1);
    out.connect(graph.fx);
    const e = { out, srcs: [], nodes: [out], end };
    liveFx.push(e);
    return e;
  }

  function stopFx(c) {
    for (const e of liveFx) {
      if (e.end < c) continue;
      holdAt(e.out.gain, c);
      rampAt(e.out.gain, 0, c + 0.04);
      for (const s of e.srcs) { try { s.stop(c + 0.05); } catch { /* ya parada */ } }
      e.end = Math.min(e.end, c + 0.05);
    }
  }

  /** Riser: ruido blanco + sierra por un bandpass que sube de 350 Hz a 7,5 kHz. */
  function riser(t0, t1) {
    try {
      const e = fxEntry(t1 + 0.12);
      const src = ctx.createBufferSource();
      src.buffer = noise();
      src.loop = true;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, t0);
      osc.frequency.exponentialRampToValueAtTime(440, t1);
      const og = gainNode(0.22);
      const bp = biquad('bandpass', 350, 1.4);
      sweep(bp.frequency, 350, 7500, t0, t1);
      const g = gainNode(0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.045, t0 + (t1 - t0) * 0.55);
      g.gain.exponentialRampToValueAtTime(0.3, Math.max(t0 + 0.02, t1 - 0.02));
      g.gain.linearRampToValueAtTime(0, t1 + 0.06);
      src.connect(bp);
      osc.connect(og);
      og.connect(bp);
      bp.connect(g);
      g.connect(e.out);
      src.start(t0);
      osc.start(t0);
      src.stop(t1 + 0.12);
      osc.stop(t1 + 0.12);
      e.srcs.push(src, osc);
      e.nodes.push(src, osc, og, bp, g);
    } catch { /* sin efectos */ }
  }

  /** Impact: bombo sub con caída de tono + golpe de ruido filtrado. */
  function impact(t) {
    try {
      const e = fxEntry(t + 1.4);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(115, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.38);
      const g = gainNode(0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.8, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
      g.gain.linearRampToValueAtTime(0, t + 1.36);
      osc.connect(g);
      g.connect(e.out);
      osc.start(t);
      osc.stop(t + 1.4);
      const n = ctx.createBufferSource();
      n.buffer = noise();
      const lp = biquad('lowpass', 2600);
      sweep(lp.frequency, 2600, 280, t, t + 0.4);
      const ng = gainNode(0);
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.linearRampToValueAtTime(0.26, t + 0.005);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      ng.gain.linearRampToValueAtTime(0, t + 0.48);
      n.connect(lp);
      lp.connect(ng);
      ng.connect(e.out);
      n.start(t);
      n.stop(t + 0.5);
      e.srcs.push(osc, n);
      e.nodes.push(osc, g, n, lp, ng);
    } catch { /* sin efectos */ }
  }

  /* ───────────── Plan: cues efectivos, sustitutas y posiciones ───────────── */

  function trackIdxAt(T) {
    const cues = plan.cues;
    let i = Math.max(0, cueIndexAt(plan, T));
    while (i > 0 && cues[i].change !== 'track') i--;
    return i;
  }

  function nextTrackIdx(from) {
    const cues = plan.cues;
    for (let k = Math.max(0, from); k < cues.length; k++) if (cues[k].change === 'track') return k;
    return -1;
  }

  /** Otra pista del mismo tramo (y BPM parecido) para una que no se pudo descargar/decodificar. */
  function pickAlt(id, zone) {
    const t = tracks.get(id);
    const tier = t?.tier || null;
    const bpm = t ? trackGrid(t).bpm : 125;
    const pool = ZONE_POOLS[zone] || [];
    let best = null;
    let bestS = -Infinity;
    for (const x of tracks.values()) {
      if (!x || x.id === id || store.isFailed(x.id) || !(Number(x.bpm) > 40) || !(Number(x.duration) > 30)) continue;
      let s = -Math.abs(Math.log(trackGrid(x).bpm / bpm)) * 20;
      if (tier && (x.tier === tier || x.curatedTier === tier)) s += 10;
      if (pool.includes(x.tier) || pool.includes(x.curatedTier)) s += 3;
      if (store.has(x.id)) s += 4;
      if (cur && x.id === cur.track.id) s -= 6;
      if (s > bestS) { bestS = s; best = x; }
    }
    return best ? best.id : null;
  }

  function resolveId(id, zone) {
    for (let guard = 0; guard < 8 && store.isFailed(id); guard++) {
      let alt = subst.get(id);
      if (!alt || store.isFailed(alt)) {
        alt = pickAlt(id, zone);
        if (!alt) return id;
        subst.set(id, alt);
      }
      id = alt;
    }
    return id;
  }

  /** Cue del plan con la sustituta aplicada (si su pista falló): entra por su mixIn (o su drop en tramos intensos). */
  function cueAt(i) {
    const c = plan.cues[i];
    if (!c) return null;
    const id = resolveId(c.trackId, c.zone);
    if (id === c.trackId) return c;
    const hit = cueCache.get(i);
    if (hit && hit.trackId === id) return hit;
    const t = tracks.get(id);
    if (!t) return c;
    const g = trackGrid(t);
    let off = snapToBar(t, g.mixIn, 'nearest');
    let entry = 'mixIn';
    if ((c.zone === 'fast' || c.zone === 'sprint') && g.alignPoints.length) {
      const p = g.alignPoints.find((a) => g.outro - a.t > 40) || g.alignPoints[0];
      off = p.t;
      entry = p.kind;
    }
    const lead = Math.max(0, Math.min(4, Math.floor((off - g.firstBar) / g.barSec + 1e-6)));
    const s = {
      ...c, trackId: id, offsetSec: off, entryPos: off - lead * g.barSec, entry, rate: fitRate(num(c.targetBpm, g.bpm) / g.bpm),
      mixRate: fitRate(num(c.targetBpm, g.bpm) / g.bpm), substFor: c.trackId,
    };
    cueCache.set(i, s);
    return s;
  }

  /**
   * Posición de la entrante en el cambio: la del plan, o donde se dejó de verdad si retoma (memoria de discos).
   * mixLead: en un beatmix que retoma, la entrante arranca donde se dejó y llega al cambio unos compases después.
   */
  function anchorPos(cue, t, mixLead = false, win = null) {
    if (cue.entry === 'resume') {
      const g = trackGrid(t);
      const lead = mixLead ? Math.max(0, num(cue.offsetSec) - num(cue.entryPos, cue.offsetSec)) : 0;
      if (deckMem.has(t.id)) {
        const m = Math.max(g.firstBar, snapToBar(t, deckMem.get(t.id), 'nearest'));
        const top = Math.min(g.outro, win ? win.wEnd : g.duration) - 8 * g.barSec;
        if (m < top && (!win || m >= win.w0)) return m + lead;
      }
      return num(cue.entryPos, cue.offsetSec) + lead;
    }
    return num(cue.offsetSec);
  }

  /**
   * Ventana [desde, hasta] (s de pista) que el plan usa de una pista: lo único que se guarda decodificado. Desde su
   * primera entrada (−2 compases) hasta su última salida prevista (+6 compases y un 6 % del tiempo que suena, porque
   * el motor la toca a un rate fijo que no es exactamente el del plan). null = entera.
   */
  function windowFor(t) {
    if (!plan || !t) return null;
    const g = trackGrid(t);
    const cues = plan.cues;
    let lo = Infinity;
    let hi = -Infinity;
    let play = 0;
    for (let k = 0; k < cues.length; k++) {
      const raw = cues[k];
      if (raw.change !== 'track' || resolveId(raw.trackId, raw.zone) !== t.id) continue;
      const s = cueAt(k);
      const j = nextTrackIdx(k + 1);
      const end = j >= 0 ? j : cues.length;
      const exitT = j >= 0 ? num(cues[j].atSec) + num(cues[j].tailSec) : num(plan.totalSec, num(raw.atSec) + 600);
      lo = Math.min(lo, num(s.entryPos, s.offsetSec), num(s.offsetSec));
      let pEnd;
      if (s.substFor) pEnd = num(s.offsetSec) + (exitT - num(s.atSec)) * Math.max(1, num(s.rate, 1));
      else {
        // el cue más reciente de la misma pista antes del relevo (rampas de tempo incluidas)
        let last = s;
        for (let q = k + 1; q < end; q++) if (cues[q].trackId === raw.trackId) last = cues[q];
        try { pEnd = cuePosition(last, exitT); } catch { pEnd = g.duration; }
        if (!Number.isFinite(pEnd)) pEnd = g.duration;
      }
      // Sale con un beatmix hacia una intro floja: puede quedarse hasta 16 compases más (ver scheduleBeatmix)
      if (j >= 0 && cues[j].transition === 'beatmix') {
        const tin = tracks.get(resolveId(cues[j].trackId, cues[j].zone));
        const eIn = tin ? energyAt(tin, num(cueAt(j)?.offsetSec), 8) : -1;
        const eOut = energyAt(t, pEnd - num(cues[j].tailSec) - 8 * g.barSec, 8);
        if (eIn >= 0 && eOut > 0.2 && eIn < 0.6 * eOut) pEnd += 16 * g.barSec;
      }
      hi = Math.max(hi, pEnd);
      play += Math.max(0, exitT - num(s.entryAt, s.atSec));
    }
    if (deckMem.has(t.id)) { lo = Math.min(lo, deckMem.get(t.id)); hi = Math.max(hi, deckMem.get(t.id)); }
    if (!(hi > lo)) return null;
    lo = Math.max(0, lo - WIN_PRE_BARS * g.barSec);
    hi = Math.min(g.duration, hi + WIN_POST_BARS * g.barSec + WIN_DRIFT * play);
    // sitio para el bucle de seguridad (16 compases) y para volver frases atrás
    const minLen = (SAFETY_LOOP_BARS + 8) * g.barSec;
    if (hi - lo < minLen) { hi = Math.min(g.duration, lo + minLen); lo = Math.max(0, hi - minLen); }
    return [lo, hi];
  }

  const bodyCache = new WeakMap();
  /** Energía típica del cuerpo de la pista (mediana entre mixIn y outro). */
  function bodyEnergy(t) {
    if (bodyCache.has(t)) return bodyCache.get(t);
    const g = trackGrid(t);
    const e = Array.isArray(t.energy) ? t.energy : [];
    const a = Math.max(0, Math.floor((g.mixIn - g.barOffset) / g.ebSec));
    const b = Math.min(e.length, Math.ceil((g.outro - g.barOffset) / g.ebSec));
    const xs = [];
    for (let k = a; k < b; k++) xs.push(clamp(num(e[k]), 0, 1));
    xs.sort((x, y) => x - y);
    const m = xs.length >= 8 ? xs[xs.length >> 1] : 0;
    bodyCache.set(t, m);
    return m;
  }

  /** Energía media (0..1, la del análisis por compás) de `bars` compases desde `pos`; −1 si la pista no la trae. */
  function energyAt(t, pos, bars = 8) {
    const e = t?.energy;
    if (!Array.isArray(e) || e.length < 8) return -1;
    const g = trackGrid(t);
    const k0 = Math.max(0, Math.floor((pos - g.barOffset) / g.ebSec));
    const nb = Math.max(1, Math.round((bars * g.barSec) / g.ebSec));
    let s = 0;
    let n = 0;
    for (let k = k0; k < Math.min(e.length, k0 + nb); k++) { s += clamp(num(e[k]), 0, 1); n++; }
    return n ? s / n : -1;
  }

  /**
   * Intro floja (la entrante cambia por su mixIn): su trim sube lo que le falta para sonar como el cuerpo de la pista
   * (≤ +6 dB, por la energía de cada compás) y vuelve a 0 dB en los 4 compases antes de su primer drop (con 8, un
   * drop cercano se comía la subida justo después del cambio).
   */
  function rideIntro(v) {
    try {
      const t = v.track;
      const e = t.energy;
      if (!Array.isArray(e) || e.length < 16) return;
      const g = trackGrid(t);
      const body = bodyEnergy(t);
      if (!(body > 0.2)) return;
      const k0 = Math.max(0, Math.floor((v.p0 - g.barOffset) / g.ebSec));
      const eIn = energyAt(t, v.p0, 8);
      if (!(eIn >= 0)) return;
      const lift = Math.min(LIFT_MAX_DB, 20 * Math.log10(body / Math.max(0.05, eIn)));
      if (!(lift >= LIFT_MIN_DB)) return;
      let target = g.drops.find((d) => d > v.p0 + 2 * g.barSec);
      if (target == null) {
        for (let k = k0 + 1; k < e.length; k++) if (num(e[k]) >= 0.9 * body) { target = g.barOffset + k * g.ebSec; break; }
      }
      if (target == null || target - v.p0 > 64 * g.barSec) target = v.p0 + 32 * g.barSec;
      const r0 = Math.max(v.p0, target - 4 * g.barSec);
      const toC = (p) => v.c0 + (p - v.p0) / v.rate;
      const g0 = dbToGain(t.gainDb);
      const up = g0 * dbToGain(lift);
      setAt(v.trim.gain, up, v.startC);
      setAt(v.trim.gain, up, Math.max(v.startC, toC(r0)));
      rampAt(v.trim.gain, g0, Math.max(v.startC + 0.05, toC(target)));
      v.ride = { db: Math.round(lift * 10) / 10, from: v.startC, to: Math.max(v.startC + 0.05, toC(target)) };
    } catch { /* sin ajuste */ }
  }

  /** Belady: s hasta el próximo uso de una pista ya decodificada (−1 = sonando o en pausa: intocable). */
  function keepScore(id) {
    if (held && held.track.id === id) return -1;
    for (let i = 0; i < voices.length; i++) if (!voices[i].dead && voices[i].track.id === id) return -1;
    if (!plan) return Infinity;
    const T = nowT();
    const cues = plan.cues;
    for (let k = cursor; k < cues.length; k++) {
      const c = cues[k];
      if (c.change === 'track' && resolveId(c.trackId, c.zone) === id) return Math.max(0, firstActionT(c) - T);
    }
    return Infinity;
  }

  /** Decodifica por adelantado, en orden de necesidad, lo que viene en los próximos PREFETCH_AHEAD s. */
  function prefetch(T) {
    const cues = plan.cues;
    for (let k = cursor, n = 0; k < cues.length && n < 6; k++) {
      const c = cues[k];
      if (c.change !== 'track') continue;
      const need = firstActionT(c) - T;
      if (need > PREFETCH_AHEAD) return;
      n++;
      const t = tracks.get(resolveId(c.trackId, c.zone));
      if (!t) continue;
      const r = store.request(t, need, keepScore);
      if (r !== 'ready' && r !== 'failed') return;
    }
  }

  /* ───────────── Transiciones ───────────── */

  function newMix(kind, idx, inV, outV, first, swap, end, outEnd) {
    return { kind, idx, inV, outV, first, swap, end, outEnd: outEnd ?? end };
  }

  /**
   * Fundido simple a la posición que toca (arranque, salto, rescate o llegada tarde). Si suena otra pista, el centro
   * del fundido cae en su siguiente compás y la entrante llega ahí con SU compás (sin dos bombos desfasados).
   */
  function scheduleFast(i, cue, t, buf, c, dur, filterIn) {
    const O = live(cur);
    const rate = soloRate(cue);
    const win = winOf(t, buf);
    const at = num(cue.atSec);
    let t0 = Math.max(c + MIN_LEAD, soon());
    let pos = fitPos(t, win, anchorPos(cue, t, false, win) + (t0 - base - at) * rate);
    let swap = t0 + dur / 2;
    if (O && O.track.id !== t.id) {
      const half = dur / 2;
      const cO = vDownbeat(O, t0 + half, 'next');
      const p = fitPos(t, win, snapToBar(t, anchorPos(cue, t, false, win) + (cO - base - at) * rate, 'nearest'));
      if (cO + half + 0.05 < O.safeC && p - half * rate >= win.w0) {
        t0 = cO - half;
        pos = p - half * rate;
        swap = cO;
      }
    }
    const inV = makeVoice(t, buf, rate, t0, pos);
    if (!inV) return false;
    xfade(inV.gain.gain, t0, t0 + dur, true);
    if (O) { killFade(O, t0, dur); rideIntro(inV); }
    if (filterIn) {
      holdAt(graph.lp.frequency, t0);
      sweep(graph.lp.frequency, 300, LP_OPEN, t0, t0 + Math.max(dur, (4 * trackGrid(t).barSec) / rate));
    }
    mix = newMix(filterIn && dur >= START_FADE ? 'start' : 'fast', i, inV, O, t0, swap, t0 + dur + 0.03);
    return true;
  }

  /** Beatmix: misma velocidad que la saliente (rate fijo ±3 %), compases cuadrados, potencia constante, graves cambiados. */
  function scheduleBeatmix(i, cue, t, buf, c, O) {
    const g = trackGrid(t);
    const go = trackGrid(O.track);
    const outEff = go.bpm * O.rate;
    const want = outEff / g.bpm;
    if (Math.abs(want - 1) > RATE_TOL + 0.01) return scheduleFilterFade(i, cue, t, buf, c, O);
    const rIn = Math.round(fitRate(want) * 100000) / 100000;
    const mism = Math.abs((g.bpm * rIn) / outEff - 1);
    const barO = go.barSec / O.rate;
    const win = winOf(t, buf);
    const anchor = anchorPos(cue, t, true, win);
    if (anchor < win.w0 || anchor > win.wEnd - 8 * g.barSec) return 'fast';
    const lead0 = Math.max(1, Math.round((num(cue.offsetSec) - num(cue.entryPos, cue.offsetSec)) / g.barSec));
    // Retoma (memoria de discos): arranca justo donde se dejó aunque la mezcla se acorte
    const resumePos = cue.entry === 'resume' ? anchor - lead0 * g.barSec : null;
    let lead = lead0;
    let tail = Math.max(1, Math.round(num(cue.tailSec) / (g.barSec / num(cue.mixRate, rIn))));
    // Tempo no idéntico (rate recortado): mezcla más corta para que la deriva no se oiga
    while (lead + tail > 2 && (lead + tail) * 2 * mism > MAX_DRIFT_BEATS) { if (lead >= tail) lead--; else tail--; }
    if ((lead + tail) * 2 * mism > MAX_DRIFT_BEATS * 2.5) return scheduleFilterFade(i, cue, t, buf, c, O);
    // Cuadra el cambio de graves con el compás real de la saliente (como mucho medio compás)
    let swap = vDownbeat(O, base + num(cue.atSec), 'nearest');
    while (lead > 1 && swap - lead * barO < c + MIN_LEAD) lead--;
    if (swap - lead * barO < c + MIN_LEAD) swap = vDownbeat(O, c + MIN_LEAD + lead * barO, 'next');
    while (tail > 1 && swap + tail * barO > O.safeC) tail--;
    if (swap + tail * barO > O.safeC) return 'loop';
    while (resumePos == null && lead > 1 && anchor - lead * g.barSec < win.w0) lead--;
    const startPos = resumePos ?? anchor - lead * g.barSec;
    if (startPos < win.w0 - 1e-6) return 'fast';
    const startC = swap - (lead * g.barSec) / rIn;
    let end = swap + tail * barO;
    // Intro floja: en el cambio la entrante aún no "pega" (energía < 0,6 × la de la saliente). Como un DJ, la saliente
    // sigue a −3 dB con sus graves unos compases más (4–16) hasta que la entrante llega a su cuerpo o a su drop
    const posSwap = startPos + (swap - startC) * rIn;
    const eIn = energyAt(t, posSwap, 8);
    const eOut = energyAt(O.track, vPos(O, swap) - 8 * go.barSec, 8);
    let hold = 0;
    if (eIn >= 0 && eOut > 0.2 && eIn < 0.6 * eOut) {
      let p = g.drops.find((d) => d > posSwap + g.barSec);
      const e = t.energy;
      for (let k = Math.max(0, Math.floor((posSwap - g.barOffset) / g.ebSec)); k < e.length; k++) {
        if (num(e[k]) >= 0.8 * eOut) { const q = g.barOffset + k * g.ebSec; if (p == null || q < p) p = q; break; }
      }
      hold = clamp(Math.round(((p ?? posSwap + 16 * g.barSec) - posSwap) / g.barSec), 4, 16);
      const nx = nextTrackIdx(i + 1);
      const limit = nx >= 0 ? base + firstActionT(cueAt(nx)) - SCHEDULE_AHEAD - 0.5 : Infinity;
      const fits = (h) => swap + (tail + h) * barO < Math.min(O.safeC - barO, limit) && (lead + tail + h) * 2 * mism <= MAX_DRIFT_BEATS;
      while (hold > 0 && !fits(hold)) hold -= 2;
      if (hold < 2) hold = 0;
    }
    const inV = makeVoice(t, buf, rIn, startC, startPos);
    if (!inV) return 'fast';
    const beat = g.spb / rIn;
    const s0 = Math.max(startC, swap - beat / 2);
    setAt(inV.shelf.gain, BASS_CUT_DB, startC);
    setAt(inV.shelf.gain, BASS_CUT_DB, s0);
    rampAt(inV.shelf.gain, 0, swap + beat / 2);
    if (hold) {
      end = swap + (tail + hold) * barO;
      const fadeFrom = end - tail * barO;
      xfade(inV.gain.gain, startC, swap, true);
      setAt(O.gain.gain, 1, startC);
      setAt(O.gain.gain, 1, s0);
      rampAt(O.gain.gain, Math.SQRT1_2, swap + beat / 2);
      setAt(O.gain.gain, Math.SQRT1_2, fadeFrom);
      xfade(O.gain.gain, fadeFrom, end, false, Math.SQRT1_2);
      // los graves de la saliente se van en la primera mitad de la espera (dos líneas de bajo, poco rato)
      setAt(O.shelf.gain, 0, swap);
      rampAt(O.shelf.gain, BASS_CUT_DB, swap + (hold / 2) * barO);
    } else {
      xfade(inV.gain.gain, startC, end, true);
      xfade(O.gain.gain, startC, end, false);
      setAt(O.shelf.gain, 0, s0);
      rampAt(O.shelf.gain, BASS_CUT_DB, swap + beat / 2);
    }
    rideIntro(inV);
    mix = newMix('beatmix', i, inV, O, startC, swap, end + 0.03, end);
    mix.hold = hold;
    return 'done';
  }

  /** Riser-drop: la saliente se filtra (highpass) mientras crece el riser; último tiempo en corte; drop en atSec. */
  function scheduleRiser(i, cue, t, buf, c, O) {
    const g = trackGrid(t);
    const rIn = soloRate(cue);
    const drop = base + num(cue.atSec);
    const beatIn = g.spb / rIn;
    const fx = effects;
    const tf = Math.max(c + MIN_LEAD, drop - num(cue.leadSec));
    if (drop - tf < 1.5 * beatIn) return 'fast';
    const tcut = fx ? Math.max(tf + 0.05, drop - beatIn) : drop - Math.min(beatIn / 2, (drop - tf) / 2);
    // la saliente suena (a CUT_LEVEL) hasta el mismo drop
    if (O.safeC < drop + 0.05) return 'loop';
    const win = winOf(t, buf);
    const anchor = anchorPos(cue, t, false, win);
    if (anchor < win.w0 || anchor > win.wEnd - 4 * g.barSec) return 'fast';
    const buildPos = cue.entry === 'resume' ? anchor : clamp(num(cue.entryPos, anchor), win.w0, anchor);
    let startC = Math.max(c + MIN_LEAD, drop - (anchor - buildPos) / rIn);
    const build = startC < tcut - 0.1;
    if (!build) startC = fx ? drop - 0.03 : Math.min(tcut, drop - 0.03);
    const inV = makeVoice(t, buf, rIn, startC, Math.max(win.w0, anchor - (drop - startC) * rIn));
    if (!inV) return 'fast';
    // Saliente: highpass (sin pasarse de 600 Hz) a pleno volumen; el pre-aviso del coach cae aquí y la música tiene
    // que seguir oyéndose. En el tiempo de corte queda a CUT_LEVEL bajo el riser: sin agujero antes del drop
    sweep(O.hp.frequency, HP_OPEN, fx ? RISER_HP : 400, tf, tcut);
    setAt(O.shelf.gain, 0, tf);
    rampAt(O.shelf.gain, -10, tcut);
    setAt(O.gain.gain, 1, tf);
    if (fx) {
      setAt(O.gain.gain, 1, tcut);
      rampAt(O.gain.gain, CUT_LEVEL, tcut + 0.03);
      setAt(O.gain.gain, CUT_LEVEL, drop - 0.006);
      rampAt(O.gain.gain, 0, drop + 0.006);
    } else xfade(O.gain.gain, tcut, drop + 0.01, false, 1);
    // Entrante: build-up fino por debajo; el drop entra a pleno
    if (build) {
      setAt(inV.hp.frequency, 380, startC);
      setAt(inV.gain.gain, 0, startC);
      rampAt(inV.gain.gain, 0.5, tcut);
      if (fx) {
        rampAt(inV.gain.gain, 0, tcut + 0.03);
        setAt(inV.hp.frequency, HP_OPEN, tcut + 0.05);
        setAt(inV.gain.gain, 0, drop - 0.006);
      } else {
        setAt(inV.hp.frequency, 380, tcut);
        expAt(inV.hp.frequency, HP_OPEN, drop);
      }
      rampAt(inV.gain.gain, 1, drop + 0.006);
    } else if (fx) {
      setAt(inV.gain.gain, 0, drop - 0.006);
      rampAt(inV.gain.gain, 1, drop + 0.006);
    } else xfade(inV.gain.gain, startC, drop + 0.006, true);
    if (fx) { riser(tf, drop); impact(drop); }
    mix = newMix('riser-drop', i, inV, O, Math.min(tf, startC), drop, drop + 0.3, drop + 0.01);
    return 'done';
  }

  /** Echo-out: la saliente se despide con eco a compás; la entrante entra filtrada (lowpass que se abre). */
  function scheduleEcho(i, cue, t, buf, c, O) {
    const g = trackGrid(t);
    const go = trackGrid(O.track);
    const rIn = soloRate(cue);
    const barO = go.barSec / O.rate;
    const inBar = g.barSec / rIn;
    let ta = vDownbeat(O, base + num(cue.atSec), 'nearest');
    if (ta < c + MIN_LEAD + 0.1) ta = vDownbeat(O, c + MIN_LEAD + 0.1, 'next');
    if (ta + 0.05 > O.safeC) return 'loop';
    const tf = Math.max(c + MIN_LEAD, ta - Math.max(barO / 2, Math.min(num(cue.leadSec), barO)));
    // el lowpass de la entrante se abre en un compás (cerrado más tiempo, en el altavoz del móvil "no se oye")
    const tz = ta + inBar;
    const win = winOf(t, buf);
    const anchor = anchorPos(cue, t, false, win);
    if (anchor < win.w0 || anchor > win.wEnd - 4 * g.barSec) return 'fast';
    // La entrante asoma 1/4 de compás antes del corte (su compás sigue cayendo en ta) y llega a ≥ 0,8 en ta
    const pre = Math.max(0, Math.min(inBar / 4, (anchor - win.w0) / rIn, ta - c - MIN_LEAD));
    const inV = makeVoice(t, buf, rIn, ta - pre, anchor - pre * rIn);
    if (!inV) return 'fast';
    const fadeIn = inBar / 8;
    xfade(inV.gain.gain, ta - pre, ta + fadeIn, true);
    setAt(inV.lp.frequency, ECHO_LP, ta - pre);
    expAt(inV.lp.frequency, LP_OPEN, Math.max(ta + 0.2, tz));
    rideIntro(inV);
    let outEnd = ta + 0.025;
    if (effects) {
      const dryOut = Math.max(0.025, barO / 16);
      setAt(graph.delay.delayTime, clamp((0.75 * go.spb) / O.rate, 0.05, 1.9), tf);
      setAt(O.send.gain, 0, tf);
      rampAt(O.send.gain, 0.85, ta);
      setAt(O.send.gain, 0.85, ta + dryOut);
      rampAt(O.send.gain, 0, ta + dryOut + 0.06);
      setAt(O.dry.gain, 1, ta);
      rampAt(O.dry.gain, 0, ta + dryOut);
      outEnd = ta + dryOut + 0.07;
    } else {
      xfade(O.gain.gain, tf, ta + fadeIn, false);
      outEnd = ta + fadeIn;
    }
    mix = newMix('echo-out', i, inV, O, tf, ta, Math.max(ta + 0.12, tz), outEnd);
    return 'done';
  }

  /**
   * Filter-fade (tempos que no casan): la saliente se cierra (lowpass hasta 1 kHz) y cruzan con potencia constante
   * centrada en el compás `ta` (las dos a 0,71 ahí, nada de dos filtros a 700 Hz y la entrante a 0,38: "no se oía");
   * graves de uno en uno; el lowpass de la entrante (desde 1,5 kHz) se abre en un compás.
   */
  function scheduleFilterFade(i, cue, t, buf, c, O) {
    const g = trackGrid(t);
    const go = trackGrid(O.track);
    const rIn = soloRate(cue);
    const barO = go.barSec / O.rate;
    const inBar = g.barSec / rIn;
    let ta = vDownbeat(O, base + num(cue.atSec), 'nearest');
    if (ta - inBar / 3 < c + MIN_LEAD) ta = vDownbeat(O, c + MIN_LEAD + inBar / 3 + 0.01, 'next');
    const outEnd = ta + barO / 3;
    if (outEnd > O.safeC) return 'loop';
    const tf = Math.max(c + MIN_LEAD, ta - Math.max(barO / 2, Math.min(num(cue.leadSec), 4 * barO)));
    const tz = ta + inBar;
    const win = winOf(t, buf);
    const anchor = anchorPos(cue, t, false, win);
    if (anchor < win.w0 || anchor > win.wEnd - 4 * g.barSec) return 'fast';
    const pre = Math.min(inBar / 3, (anchor - win.w0) / rIn);
    const startC = ta - pre;
    const inV = makeVoice(t, buf, rIn, startC, anchor - pre * rIn);
    if (!inV) return 'fast';
    rideIntro(inV);
    const beat = g.spb / rIn;
    sweep(O.lp.frequency, LP_OPEN, 1000, tf, ta);
    xfade(O.gain.gain, Math.max(tf, ta - barO / 3), outEnd, false);
    setAt(O.shelf.gain, 0, Math.max(tf, ta - beat / 2));
    rampAt(O.shelf.gain, BASS_CUT_DB, ta + beat / 4);
    const inEnd = ta + inBar / 3;
    xfade(inV.gain.gain, startC, inEnd, true);
    setAt(inV.lp.frequency, ECHO_LP, startC);
    expAt(inV.lp.frequency, LP_OPEN, tz);
    setAt(inV.shelf.gain, BASS_CUT_DB, startC);
    setAt(inV.shelf.gain, BASS_CUT_DB, Math.max(startC, ta - beat / 4));
    rampAt(inV.shelf.gain, 0, ta + beat / 2);
    mix = newMix('filter-fade', i, inV, O, Math.min(tf, startC), ta, Math.max(outEnd, inEnd, tz) + 0.02, outEnd);
    return 'done';
  }

  /** La pista que suena se acaba antes de su relevo: vuelve 16 compases atrás cruzando consigo misma a compás. */
  function scheduleLoop(c) {
    const O = live(cur);
    if (!O || mix) return false;
    const g = trackGrid(O.track);
    const bar = g.barSec / O.rate;
    let pC = vDownbeat(O, O.safeC - bar, 'prev');
    if (pC - bar / 2 < c + MIN_LEAD) pC = vDownbeat(O, c + MIN_LEAD + bar / 2, 'next');
    const pAt = O.p0 + (pC - O.c0) * O.rate;
    let J = LOOP_JUMP_BARS;
    const floor = Math.max(g.firstBar, O.w0);
    while (J > 2 && pAt - (J + 1) * g.barSec < floor) J -= J > 8 ? 4 : 2;
    const startPos = pAt - J * g.barSec - g.barSec / 2;
    if (startPos < O.w0 - 1e-6) return false;
    const startC = pC - bar / 2;
    const inV = makeVoice(O.track, O.buf, O.rate, startC, startPos);
    if (!inV) return false;
    // Material casi idéntico (la misma pista a compás): fundido lineal, sin bache ni subida
    setAt(inV.gain.gain, 0, startC);
    rampAt(inV.gain.gain, 1, pC + bar / 2);
    setAt(O.gain.gain, 1, startC);
    rampAt(O.gain.gain, 0, pC + bar / 2);
    mix = newMix('loop', -1, inV, O, startC, pC, pC + bar / 2 + 0.03, pC + bar / 2);
    return true;
  }

  /** Programa el cue i (o un fundido simple si ya no hay margen). 'done' | 'wait' | 'loop' | 'failed'. */
  function planCue(i, cue, t, c) {
    const buf = store.get(t.id);
    if (!buf) return store.request(t, 0, keepScore) === 'failed' ? 'failed' : 'wait';
    const O = live(cur);
    if (fastDur > 0 || !O) return scheduleFast(i, cue, t, buf, c, fastDur || LATE_FADE, fastFilter || !O) ? 'done' : 'wait';
    // Llegamos tarde (decodificación lenta, pausa a mitad o JS dormido): fundido simple a lo que toca
    if (c > base + num(cue.atSec) - 0.25) return scheduleFast(i, cue, t, buf, c, LATE_FADE, false) ? 'done' : 'wait';
    let r = 'fast';
    if (cue.transition === 'beatmix') r = scheduleBeatmix(i, cue, t, buf, c, O);
    else if (cue.transition === 'riser-drop') r = scheduleRiser(i, cue, t, buf, c, O);
    else if (cue.transition === 'echo-out') r = scheduleEcho(i, cue, t, buf, c, O);
    else if (cue.transition === 'filter-fade') r = scheduleFilterFade(i, cue, t, buf, c, O);
    if (r === 'fast') return scheduleFast(i, cue, t, buf, c, LATE_FADE, false) ? 'done' : 'wait';
    return r;
  }

  function advance(c, T) {
    const cues = plan.cues;
    for (let guard = 0; guard < 64 && !mix && cursor < cues.length; guard++) {
      const raw = cues[cursor];
      if (raw.change !== 'track') {
        if (raw.atSec <= T + SCHEDULE_AHEAD) { cursor++; continue; }
        return;
      }
      // Varios cambios ya vencidos (JS dormido, salto): directo al último
      const nx = nextTrackIdx(cursor + 1);
      if (nx >= 0 && cues[nx].atSec <= T + 0.05) { cursor = nx; continue; }
      const cue = cueAt(cursor);
      const t = tracks.get(cue.trackId);
      if (!t) { cursor++; continue; }
      const O = live(cur);
      if (O && O.track.id === t.id) {
        // Misma pista (continuación o sustituta que ya suena): nada que mezclar
        if (fastDur || raw.atSec <= T + SCHEDULE_AHEAD) { cursor++; fastDur = 0; continue; }
        return;
      }
      if (!fastDur && O && c < base + firstActionT(cue) - SCHEDULE_AHEAD) return;
      const r = planCue(cursor, cue, t, c);
      if (r === 'done') { cursor++; fastDur = 0; fastFilter = false; if (speaking) applyDuck(); return; }
      if (r === 'loop') { scheduleLoop(c); return; }
      if (r !== 'failed') return;
    }
  }

  function finishMix(c) {
    const m = mix;
    mix = null;
    const O = m.outV;
    if (O && O !== m.inV && !O.dead) {
      if (m.kind !== 'loop') deckMem.set(O.track.id, vPos(O, Math.min(c, m.outEnd)));
      stopVoice(O, c + 0.02);
    }
    if (live(m.inV)) cur = m.inV;
  }

  /** Interrumpe la transición en curso dejando una sola voz (pausa, salto, apagar). smooth: la deja a pleno. */
  function abortMix(c, smooth = true) {
    const m = mix;
    if (!m) return;
    mix = null;
    const a = Math.max(c, soon());
    stopFx(a);
    const after = c >= m.swap;
    const keep = live(after ? m.inV : m.outV);
    const drop = live(after ? m.outV : m.inV);
    if (m.idx >= 0 && !after) cursor = Math.min(cursor, m.idx);
    if (drop && drop !== keep) {
      if (after && m.kind !== 'loop') deckMem.set(drop.track.id, vPos(drop, c));
      killFade(drop, a, smooth ? 0.25 : KILL_MIN);
    }
    cur = keep;
    if (keep && smooth) restoreVoice(keep, a);
    if (smooth && !endFading) openMaster(a, 0.1);
    if (speaking) applyDuck();
  }

  /** La voz principal se acaba antes de que llegue su relevo: bucle de frase a tiempo. */
  function guardEnd(c) {
    const O = live(cur);
    if (!O || mix || O.safeC - c > LOOP_PREP) return;
    const nx = nextTrackIdx(cursor);
    const barO = trackGrid(O.track).barSec / O.rate;
    if (nx >= 0) {
      const cue = cueAt(nx);
      if (store.has(cue.trackId) && cue.trackId !== O.track.id && base + num(cue.atSec) + 2 * barO < O.safeC) return;
    } else if (base + plan.totalSec + 2 < O.safeC) return;
    scheduleLoop(c);
  }

  function endFade(c, T) {
    if (endFading) return;
    const left = plan.totalSec - T;
    const fadeSec = plan.endFadeSec || END_FADE_SEC;
    if (left > fadeSec || left < -2) return;
    endFading = true;
    const a = Math.max(c, soon());
    const t1 = a + Math.max(0.5, left);
    holdAt(graph.fade.gain, a);
    for (let k = 1; k <= XF_STEPS; k++) rampAt(graph.fade.gain, Math.cos((k / XF_STEPS) * HALF_PI), a + (t1 - a) * (k / XF_STEPS));
    holdAt(graph.lp.frequency, a);
    expAt(graph.lp.frequency, 450, t1);
  }

  function finishSession(c) {
    stopLoop();
    abortMix(c, false);
    const a = Math.max(c, soon());
    for (let i = voices.length - 1; i >= 0; i--) killFade(voices[i], a, KILL_MIN);
    cur = null;
    state = 'stopped';
    setSession(false);
  }

  function pump() {
    if (destroyed) return;
    runTimers();
    clockCheck();
    if (state !== 'playing' || !plan || !enabled || !graph) return;
    if (!ctxRunning()) { resumeCtx(); return; }
    const c = ctx.currentTime;
    const T = c - base;
    if (T > plan.totalSec + 2) { finishSession(c); return; }
    gc(c);
    if (mix && c >= mix.end) finishMix(c);
    if (!mix && !live(cur) && !fastDur) {
      // Nada sonando (rescate): a lo que toca
      cursor = trackIdxAt(T);
      fastDur = LATE_FADE;
      fastFilter = true;
    }
    if (!mix) advance(c, T);
    if (!mix) guardEnd(c);
    endFade(c, T);
    prefetch(T);
  }

  function tick() {
    try { pump(); } catch { /* el motor de música nunca rompe el entrenamiento */ }
  }

  function startLoop() {
    if (autoTick && timer == null && typeof setInterval === 'function') timer = setInterval(tick, LOOP_MS);
  }

  function stopLoop() {
    if (timer != null) { clearInterval(timer); timer = null; }
  }

  /* ───────────── Voz del coach (ducking) ───────────── */

  function onVoice(e) {
    speaking = !!e?.detail?.speaking;
    const tok = ++voiceTok;
    if (speaking) defer(VOICE_STUCK, () => { if (tok === voiceTok && speaking) { speaking = false; applyDuck(); } });
    applyDuck();
  }

  /** −9 dB mientras habla el coach; −6 dB si coincide con una transición filtrada (la música ya va más baja). */
  function applyDuck() {
    if (!graph || !ctx) return;
    const on = ducking && speaking;
    try {
      const p = graph.duck.gain;
      const t = soon();
      holdAt(p, t);
      if (!on) { p.setTargetAtTime(1, t, DUCK_RELEASE / 3); return; }
      const m = mix && FILTER_MIXES.has(mix.kind) && mix.end > t ? mix : null;
      const inMix = !!m && t >= m.first;
      p.setTargetAtTime(inMix ? DUCK_MIX : DUCK_GAIN, t, DUCK_ATTACK / 3);
      if (m && !inMix) p.setTargetAtTime(DUCK_MIX, m.first, DUCK_ATTACK / 3);
      if (m) p.setTargetAtTime(DUCK_GAIN, m.end, DUCK_RELEASE / 3);
    } catch { /* nada */ }
  }

  /* ───────────── API ───────────── */

  /** EN EL GESTO de Empezar: reanuda el AudioContext y suena un buffer de 1 muestra (desbloqueo de iOS). */
  function unlock() {
    try {
      if (destroyed || !ensureCtx()) return Promise.resolve(false);
      let p = null;
      if (!offline && ctx.state !== 'running') { try { p = ctx.resume(); } catch { p = null; } lastResume = clock(); }
      try {
        const b = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start(0);
      } catch { /* nada */ }
      ensureGraph();
      listen();
      if (offline || !p) return Promise.resolve(offline || ctx.state === 'running');
      const wait = new Promise((r) => defer(1.2, r));
      return Promise.race([Promise.resolve(p).catch(() => {}), wait]).then(() => ctx.state === 'running', () => false);
    } catch { return Promise.resolve(false); }
  }

  /** Prepara el plan y decodifica la primera pista. tracksById: Map | objeto | array. */
  function load(p, tracksById) {
    try {
      if (destroyed) return Promise.resolve(false);
      const prev = plan;
      plan = p && Array.isArray(p.cues) && p.cues.length ? p : null;
      // las ventanas decodificadas dependen del plan: con otro plan se decodifica de nuevo
      if (prev && plan && prev !== plan) store.clear();
      if (tracksById instanceof Map) tracks = tracksById;
      else if (Array.isArray(tracksById)) tracks = new Map(tracksById.map((t) => [t.id, t]));
      else tracks = new Map(Object.entries(tracksById || {}));
      cueCache.clear();
      listen();
      if (!ensureGraph() || !plan) return Promise.resolve(false);
      if (state === 'playing') { seek(nowT()); return Promise.resolve(true); }
      if (state === 'paused') { abortMix(ctx.currentTime, false); held = null; pendingSync = true; return Promise.resolve(true); }
      cursor = 0;
      mix = null;
      endFading = false;
      deckMem.clear();
      if (state === 'idle' || state === 'stopped') state = 'ready';
      return firstReady().catch(() => false);
    } catch { return Promise.resolve(false); }
  }

  async function firstReady() {
    for (let k = 0; k < 6 && plan && !destroyed; k++) {
      const cue = cueAt(0);
      const t = tracks.get(cue?.trackId);
      if (!t) return false;
      const r = store.request(t, 0, keepScore);
      if (r === 'ready') return true;
      if (r === 'failed') { if (resolveId(t.id, cue.zone) === t.id) return false; continue; }
      await store.settle(t.id);
      if (store.has(t.id)) return true;
    }
    return false;
  }

  function start(atSec = 0) {
    try {
      if (destroyed || !plan || !ensureGraph()) return false;
      listen();
      resumeCtx(true);
      const T = Math.max(0, Number(atSec) || 0);
      const c = ctx.currentTime;
      const a = soon();
      abortMix(c, false);
      for (let i = voices.length - 1; i >= 0; i--) killFade(voices[i], a, KILL_MIN);
      cur = null;
      held = null;
      state = 'playing';
      base = c - T;
      endFading = false;
      pendingSync = false;
      if (!enabled) { startLoop(); return true; }
      setSession(true);
      fadeMaster(a, 1, 0.05);
      openMaster(a, 0.02);
      const idx = trackIdxAt(T);
      cursor = idx;
      fastDur = T < 0.75 && plan.cues[idx].transition === 'start' ? START_FADE : LATE_FADE;
      fastFilter = true;
      startLoop();
      pump();
      return true;
    } catch { return false; }
  }

  function pause() {
    try {
      if (state !== 'playing') return;
      frozenT = nowT();
      state = 'paused';
      stopLoop();
      if (!graph) return;
      const c = ctx.currentTime;
      const a = soon();
      abortMix(c, false);
      const v = live(cur);
      // Lo que manda queda apuntado para retomarlo justo ahí (la memoria de la pausa)
      held = v ? { track: v.track, buf: v.buf, rate: v.rate, pos: vPos(v, a), ride: !!v.ride && a < v.ride.to } : null;
      stopFx(a);
      for (let i = voices.length - 1; i >= 0; i--) killFade(voices[i], a, PAUSE_FADE);
      fadeMaster(a, 0, PAUSE_FADE);
      cur = null;
    } catch { /* nada */ }
  }

  function resume() {
    try {
      if (state !== 'paused' || destroyed) return;
      state = 'playing';
      resumeCtx(true);
      if (!graph) { startLoop(); return; }
      const c = ctx.currentTime;
      const a = soon();
      base = c - frozenT;
      if (!enabled) { held = null; startLoop(); return; }
      setSession(true);
      endFading = false;
      const h = held;
      held = null;
      if (pendingSync || !h) {
        pendingSync = false;
        fadeMaster(a, 1, 0.05);
        openMaster(a, 0.05);
        seek(frozenT);
      } else {
        const t0 = Math.max(c + MIN_LEAD, a);
        const v = makeVoice(h.track, h.buf, h.rate, t0, h.pos);
        if (v) { setAt(v.gain.gain, 1, t0); cur = v; if (h.ride) rideIntro(v); }
        holdAt(graph.fade.gain, a);
        rampAt(graph.fade.gain, 0, t0);
        rampAt(graph.fade.gain, 1, t0 + RESUME_FADE);
        openMaster(a, 0.05);
      }
      startLoop();
      pump();
    } catch { /* nada */ }
  }

  /** Tras saltar de segmento (o cualquier salto de tiempo): transición rápida (1 s) a lo que toca. */
  function seek(totalSec) {
    try {
      if (!plan || destroyed) return;
      const T = Math.max(0, Number(totalSec) || 0);
      if (state !== 'playing') { frozenT = T; held = null; pendingSync = true; return; }
      if (!graph) return;
      const c = ctx.currentTime;
      base = c - T;
      seeks++;
      if (endFading && T < plan.totalSec - (plan.endFadeSec || END_FADE_SEC)) {
        endFading = false;
        fadeMaster(soon(), 1, 0.3);
        openMaster(soon(), 0.3);
      }
      abortMix(c, true);
      if (!enabled) { pendingSync = true; return; }
      const gi = trackIdxAt(T);
      const cue = cueAt(gi);
      const O = live(cur);
      if (O && cue && O.track.id === cue.trackId) {
        // Misma pista: continuidad antes que exactitud (sin saltos audibles)
        cursor = gi + 1;
        fastDur = 0;
        pump();
        return;
      }
      cursor = gi;
      fastDur = SEEK_FADE;
      fastFilter = !O;
      pump();
    } catch { /* nada */ }
  }

  function update(totalSec, engineState = null) {
    try {
      if (destroyed) return;
      runTimers();
      clockCheck();
      if (!plan) return;
      const st = engineState?.status;
      if (st === 'paused' && state === 'playing') pause();
      else if (st === 'running' && state === 'paused') resume();
      else if (st === 'finished' && state === 'playing') { stop({ fadeSec: 1.5 }); return; }
      const T = Number(totalSec);
      if (Number.isFinite(T) && ctx) {
        if (state === 'playing') {
          if (ctxRunning()) {
            const diff = T - (ctx.currentTime - base);
            if (Math.abs(diff) > RESYNC) seek(T);
            else if (Math.abs(diff) > 0.02) base -= diff * 0.1;
          } else resumeCtx();
        } else if (state === 'paused' && Math.abs(T - frozenT) > 0.5) {
          frozenT = T;
          pendingSync = true;
        }
      }
      pump();
    } catch { /* nada */ }
  }

  function setVolume(v) {
    volume = clamp(Number(v) || 0, 0, 1);
    try {
      if (graph) { const a = soon(); holdAt(graph.music.gain, a); graph.music.gain.setTargetAtTime(volGain(volume), a, 0.05); }
    } catch { /* nada */ }
  }

  function setEnabled(on) {
    try {
      const v = !!on;
      if (v === enabled) return;
      enabled = v;
      if (!graph) return;
      const c = ctx.currentTime;
      const a = soon();
      if (!v) {
        abortMix(c, false);
        stopFx(a);
        for (let i = voices.length - 1; i >= 0; i--) killFade(voices[i], a, 0.6);
        fadeMaster(a, 0, 0.6);
        cur = null;
        held = null;
        // sin música no se guarda nada decodificado (las voces que se apagan conservan su buffer hasta el final)
        store.releaseAll();
        if (state === 'paused') pendingSync = true;
        setSession(false);
      } else if (state === 'playing') {
        setSession(true);
        fadeMaster(a, 1, 0.05);
        openMaster(a, 0.05);
        seek(nowT());
      } else if (state === 'paused') pendingSync = true;
    } catch { /* nada */ }
  }

  function setEffects(on) {
    effects = !!on;
    if (!effects && graph) stopFx(soon());
  }

  function setDucking(on) {
    ducking = !!on;
    applyDuck();
  }

  function stop({ fadeSec = 2 } = {}) {
    try {
      if (state === 'idle' || state === 'stopped' || destroyed) return Promise.resolve();
      const wasPlaying = state === 'playing';
      state = 'stopped';
      stopLoop();
      const sec = wasPlaying && graph ? Math.max(0, Number(fadeSec) || 0) : 0;
      if (graph) {
        const c = ctx.currentTime;
        const a = soon();
        abortMix(c, false);
        stopFx(a + sec);
        for (let i = voices.length - 1; i >= 0; i--) killFade(voices[i], a, Math.max(KILL_MIN, sec));
        fadeMaster(a, 0, Math.max(KILL_MIN, sec));
      }
      cur = null;
      held = null;
      const wait = sec > 0 ? sec + 0.06 : 0.06;
      return new Promise((resolve) => {
        defer(wait, () => { setSession(false); resolve(); });
      });
    } catch { return Promise.resolve(); }
  }

  /** La voz que se oye: la entrante en cuanto pasa el cambio de la mezcla en curso. */
  function audible() {
    if (mix && ctx && ctx.currentTime >= mix.swap && live(mix.inV)) return mix.inV;
    return live(cur);
  }

  function nowPlaying() {
    if (!enabled || (state !== 'playing' && state !== 'paused')) return null;
    const v = state === 'paused' ? held : audible();
    const t = v?.track;
    if (!t) return null;
    return {
      trackId: t.id, title: t.title, artist: t.artist || '',
      bpm: Math.round(trackGrid(t).bpm * (v.rate || 1) * 10) / 10,
      tier: t.tier || null, user: !!t.user,
    };
  }

  /**
   * AnalyserNode del espectro real de la mezcla (escena 3D audio-reactiva, §14.1-2). Se engancha en derivación tras
   * musicGain (no altera el sonido: el analizador no tiene salidas). null si la música está apagada o sin Web Audio.
   */
  function getAnalyser() {
    try {
      if (destroyed || !enabled || !graph || !ctx || state === 'idle' || state === 'stopped') return null;
      if (!graph.analyser) {
        const a = ctx.createAnalyser();
        a.fftSize = 1024;
        a.smoothingTimeConstant = 0.8;
        graph.music.connect(a);
        graph.analyser = a;
      }
      return graph.analyser;
    } catch { return null; }
  }

  /** Fase dentro del tiempo actual (0..1) de la pista que suena, para animaciones a ritmo. Sin asignaciones. */
  /**
   * s entre lo que el contexto renderiza y lo que se oye (con AirPods ≈ 0,15–0,25 s). getOutputTimestamp si lo hay
   * (Safari no siempre da outputLatency); si no, outputLatency + baseLatency. Se recalcula cada 0,5 s (sin asignar
   * un objeto por fotograma).
   */
  function outLatency() {
    const w = clock();
    if (w - latAt < 0.5) return latVal;
    latAt = w;
    let L = (Number(ctx.outputLatency) || 0) + (Number(ctx.baseLatency) || 0);
    let src = 'latency';
    try {
      if (!offline && typeof ctx.getOutputTimestamp === 'function') {
        const ts = ctx.getOutputTimestamp();
        const pn = globalThis.performance?.now?.();
        if (ts && ts.contextTime > 0 && ts.performanceTime > 0 && pn > 0) {
          const l2 = ctx.currentTime - (ts.contextTime + (pn - ts.performanceTime) / 1000);
          if (l2 > -0.01 && l2 < 0.6) { L = Math.max(0, l2); src = 'timestamp'; }
        }
      }
    } catch { /* sin marca de tiempo */ }
    latVal = clamp(L, 0, 0.6);
    latSrc = src;
    return latVal;
  }

  function beatPhase() {
    try {
      if (state !== 'playing' || !enabled || !ctx) return 0;
      const v = audible();
      if (!v) return 0;
      const c = ctx.currentTime - outLatency();
      if (c < v.startC) return 0;
      return beatPhaseAt(v.track, vPos(v, c) - AUDIBLE_LEAD);
    } catch { return 0; }
  }

  function status() {
    const c = ctx ? ctx.currentTime : 0;
    const v = audible();
    return {
      state, enabled, effects, graph: !!graph, cursor, cues: plan?.cues?.length || 0, t: nowT(),
      ctxState: ctx?.state || null,
      ctx: ctx ? {
        sampleRate: ctx.sampleRate, baseLatency: Number(ctx.baseLatency) || 0, outputLatency: Number(ctx.outputLatency) || 0,
        latency: ctx && !offline ? outLatency() : 0, latencySource: latSrc, time: c,
      } : null,
      stalled, stalls, seeks, ctxLog: ctxLog.slice(),
      job: mix ? { kind: mix.kind, idx: mix.idx, first: mix.first, swap: mix.swap, end: mix.end, hold: mix.hold || 0 } : null,
      trackId: v?.track?.id || null, rate: v?.rate || 1, pos: v ? vPos(v, c) : 0,
      voices: voices.map((x) => ({
        trackId: x.track.id, rate: x.rate, pos: vPos(x, c), startC: x.startC, stopC: x.stopC, c0: x.c0, p0: x.p0,
        loop: x.loop, ls: x.ls, le: x.le, safeC: x.safeC, main: x === cur, w0: x.w0, wEnd: x.wEnd,
        sr: x.buf?.sampleRate || 0, ride: x.ride ? { ...x.ride } : null,
      })),
      buffers: store.stats(), deckMem: Object.fromEntries(deckMem), subst: Object.fromEntries(subst),
    };
  }

  function destroy() {
    if (destroyed) return;
    try { stop({ fadeSec: 0 }); } catch { /* nada */ }
    destroyed = true;
    stopLoop();
    for (let i = voices.length - 1; i >= 0; i--) {
      const v = voices[i];
      try { v.src?.stop(); } catch { /* nada */ }
      dispose(v);
    }
    for (const e of liveFx) for (const n of e.nodes) { try { n.disconnect(); } catch { /* nada */ } }
    liveFx.length = 0;
    timers.length = 0;
    unlisten();
    store.clear();
    if (graph) for (const n of Object.values(graph)) { try { n.disconnect(); } catch { /* nada */ } }
    graph = null;
    setSession(false);
    // el contexto compartido vuelve a poder suspenderse en reposo (sin música no hay nada que mantener vivo)
    try { if (!injected && getCtx === audioEngine.getAudioContext) audioEngine.releaseAudioContext?.(); } catch { /* nada */ }
    plan = null;
    held = null;
    cur = null;
    mix = null;
  }

  return {
    unlock, load, start, pause, resume, seek, update, setVolume, setEnabled, setEffects, setDucking, stop,
    nowPlaying, beatPhase, getAnalyser, status, destroy,
  };
}
