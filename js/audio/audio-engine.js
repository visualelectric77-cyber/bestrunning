// BestRunning · motor de audio: AudioContext único (compartido con la música), pitidos sintetizados y packs de
// voz (mp3 → AudioBuffer). iOS: el audio solo arranca dentro de un gesto; unlockAudio() debe llamarse en el
// manejador del toque. No toca window/document al importarse.
import { primeSpeech, signalVoice } from './speech.js';
import { PACK_ID, PACK_SCRIPT } from './voice-pack.js';

const cfg = { beeps: true, volume: 1, duckMusic: true };
const BEEP_LEVEL = 0.55;
const CLIP_GAP = 0.04;          // pausa base entre clips (s): las portadoras ya traen ~160 ms de cola en suspenso
const SENTENCE_PAUSE = 0.14;    // respiro extra tras un clip que cierra frase (. ! ?)
const VOICE_PREROLL = 0.08;     // margen para que la música empiece a agacharse antes de la voz
const COUNTDOWN_PREROLL = 0.02; // en la cuenta atrás manda la puntualidad
const CHAR_SEC = 0.075;         // duración estimada por carácter de un clip aún sin decodificar
const MAX_BUFFERS = 160;        // LRU de clips decodificados
const LOAD_TIMEOUT_MS = 2500;   // si los clips no llegan a tiempo, el aviso falla (el coach usa la voz del sistema)
const IDLE_SUSPEND_MS = 2500;   // en modo 'transient' se suspende el contexto en reposo para no dejar la música bajada
const SESSION_TYPES = ['playback', 'transient', 'ambient', 'auto'];

const SCRIPT = new Map(PACK_SCRIPT.map((c) => [c.id, c]));

let ctx = null;
let master = null;
let unlocked = false;
let listening = false;
let idleTimer = null;
let sessionOverride = null;     // null = 'auto' (según duckMusic)
let shared = false;             // alguien más (la música) ha pedido el AudioContext
let pack = null;                // { id, name, voice, base: URL, ids: Set, buffers: Map<id, Promise>, durations: Map, parts: Map }
let loading = null;             // { id, promise } carga en curso de index.json
let playback = null;            // { sources, gain, finish }
let reqGen = 0;                 // peticiones de voz: stopClips() o una petición nueva anulan las que aún cargan
const liveBeeps = new Set();    // { oscs, env, end }

const AC = () => globalThis.AudioContext || globalThis.webkitAudioContext || null;
const nowMs = () => (globalThis.performance?.now ? performance.now() : Date.now());

/* ───────────── Sesión de audio (navigator.audioSession, Safari 17+) ───────────── */

let postedSession = null;       // último tipo avisado a la app nativa (audio.session)

function setSessionType(type) {
  try {
    const s = globalThis.navigator?.audioSession;
    if (s && s.type !== type) s.type = type;
  } catch { /* API no disponible */ }
  // App nativa (native-bridge.js): la misma petición se traslada a AVAudioSession para que el modo silencio no
  // calle la clase. En Safari BRNative no existe y no pasa nada.
  if (type !== postedSession) {
    try { if (globalThis.BRNative?.post?.('audio.session', { type })) postedSession = type; } catch { /* sin puente */ }
  }
}

const autoType = () => (cfg.duckMusic ? 'transient' : 'ambient');
const effectiveType = () => sessionOverride || autoType();
// Con el contexto compartido (música de la app) nunca se suspende salvo que se pida 'transient' expresamente
const idleAllowed = () => effectiveType() === 'transient' && (!shared || sessionOverride === 'transient');

/**
 * Tipo de sesión de audio de iOS: 'playback' (la app es la fuente de música; Spotify se pausa),
 * 'transient' (baja la música ajena mientras habla el coach), 'ambient' (solo mezcla) o 'auto' (según duckMusic).
 * Devuelve el tipo efectivo.
 */
export function setAudioSessionType(type = 'auto') {
  const t = SESSION_TYPES.includes(type) ? type : 'auto';
  sessionOverride = t === 'auto' ? null : t;
  setSessionType(effectiveType());
  if (idleAllowed() && unlocked) scheduleIdle();
  else clearTimeout(idleTimer);
  // la música de la app necesita el contexto en marcha (pudo quedar suspendido en reposo)
  if (effectiveType() === 'playback' && unlocked && ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  return effectiveType();
}

/* ───────────── Contexto ───────────── */

function buildGraph() {
  try {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(comp);
    comp.connect(ctx.destination);
  } catch {
    master = ctx.destination;
  }
}

/**
 * latencyHint del contexto: 'interactive' (búferes pequeños: cuenta atrás y pitidos al instante). Para probar en el
 * iPhone si hay chasquidos con la escena 3D a tope: ?latency=playback|balanced (solo desplaza toda la salida por igual).
 */
function latencyHint() {
  try {
    const m = /[?&]latency=(playback|balanced|interactive)(?:&|$)/.exec(globalThis.location?.search || '');
    if (m) return m[1];
  } catch { /* sin location */ }
  return 'interactive';
}

function createContext() {
  const C = AC();
  if (!C || ctx) return ctx;
  try { ctx = new C({ latencyHint: latencyHint() }); } catch {
    try { ctx = new C(); } catch { ctx = null; }
  }
  if (ctx) {
    buildGraph();
    // Si el contexto llega a sonar (aunque el primer resume() tardara más de lo esperado), queda desbloqueado:
    // así funcionan el «revive» al volver a la app y la reanudación en modo 'playback'.
    try {
      ctx.addEventListener?.('statechange', () => {
        if (ctx?.state === 'running' && !unlocked) { unlocked = true; scheduleIdle(); }
      });
    } catch { /* sin eventos */ }
  }
  return ctx;
}

/** Datos del contexto para el panel de depuración (sin crearlo): null si aún no existe. */
export function audioContextInfo() {
  if (!ctx) return null;
  // clips de voz en memoria (promesas de AudioBuffer): nº y MB aproximados por su duración (mono float32)
  let clips = 0;
  let clipBytes = 0;
  try {
    for (const id of pack?.buffers?.keys?.() || []) {
      clips++;
      clipBytes += (pack.durations.get(id) || 1.5) * ctx.sampleRate * 4;
    }
  } catch { /* sin pack */ }
  return {
    state: ctx.state, sampleRate: ctx.sampleRate, baseLatency: Number(ctx.baseLatency) || 0,
    outputLatency: Number(ctx.outputLatency) || 0, latencyHint: latencyHint(), session: effectiveType(), clips, clipBytes,
  };
}

/** AudioContext compartido (lo crea si hace falta; NO lo reanuda: eso solo vale dentro de un gesto). */
export function getAudioContext() {
  const c = createContext();
  if (c) { shared = true; clearTimeout(idleTimer); listen(); }
  return c;
}

/**
 * La música de la app ya no usa el contexto (fin del entreno): vuelve el reposo automático para que iOS no siga
 * procesando silencio en Resumen/Hoy. No lo cierra (la voz y los pitidos lo siguen usando) ni corta lo que suena:
 * scheduleIdle espera a que termine la frase final.
 */
export function releaseAudioContext() {
  shared = false;
  // el tipo de sesión no se toca aquí: lo decide el reproductor (mantiene 'playback' mientras suena la frase final)
  if (unlocked) scheduleIdle();
}

function listen() {
  if (listening) return;
  listening = true;
  const doc = globalThis.document;
  const revive = () => {
    if (doc?.visibilityState === 'hidden' || !ctx || !unlocked) return;
    if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
  };
  try {
    doc?.addEventListener?.('visibilitychange', revive);
    globalThis.addEventListener?.('pageshow', revive);
  } catch { /* sin DOM */ }
}

const isBusy = () => !!playback || [...liveBeeps].some((b) => b.end > (ctx?.currentTime ?? 0));

function scheduleIdle() {
  clearTimeout(idleTimer);
  if (!ctx || !idleAllowed()) return;
  idleTimer = setTimeout(() => {
    if (!ctx || ctx.state !== 'running' || !idleAllowed()) return;
    if (isBusy()) { scheduleIdle(); return; }
    ctx.suspend().catch(() => {});
  }, IDLE_SUSPEND_MS);
}

/** Reanuda el contexto si estaba suspendido (ya desbloqueado antes por un gesto). */
export async function ensureAudioRunning() {
  if (!ctx || ctx.state === 'closed') return false;
  clearTimeout(idleTimer);
  if (ctx.state !== 'running') {
    try { await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 800))]); } catch { /* sin permiso */ }
  }
  return ctx.state === 'running';
}

/**
 * EN UN GESTO: crea/reanuda el AudioContext, fija navigator.audioSession.type ('transient' baja la música
 * mientras suena el coach; 'ambient' solo mezcla; 'playback' si la música es de la app), reproduce un buffer
 * silencioso y calienta speechSynthesis.
 */
export async function unlockAudio() {
  setSessionType(effectiveType());
  let resuming = null;
  const c = createContext();
  if (c) {
    try {
      const buf = c.createBuffer(1, 1, c.sampleRate || 44100);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start(0);
    } catch { /* nada */ }
    // resume() se invoca de forma síncrona dentro del gesto; luego se espera
    if (c.state !== 'running') { try { resuming = c.resume(); } catch { resuming = null; } }
  }
  primeSpeech();
  listen();
  if (resuming) { try { await Promise.race([resuming, new Promise((r) => setTimeout(r, 1200))]); } catch { /* nada */ } }
  unlocked = !!ctx && ctx.state === 'running';
  if (unlocked) {
    scheduleIdle();
    if (pack?.voice) preloadClips(['countdown_1']);
  }
  return unlocked;
}

export function isUnlocked() {
  return unlocked && !!ctx && ctx.state !== 'closed';
}

/** Aplica state.audio (beeps, volume, duckMusic…). Se puede llamar en cualquier momento. */
export function applyAudioSettings(audioSettings = {}) {
  const a = audioSettings || {};
  if (a.beeps != null) cfg.beeps = a.beeps !== false;
  if (a.volume != null && Number.isFinite(Number(a.volume))) cfg.volume = Math.min(1, Math.max(0, Number(a.volume)));
  if (a.duckMusic != null) cfg.duckMusic = a.duckMusic !== false;
  if (unlocked) setSessionType(effectiveType());
  if (!idleAllowed()) clearTimeout(idleTimer);
  if (playback?.gain) { try { playback.gain.gain.value = cfg.volume; } catch { /* nada */ } }
}

/* ───────────── Pitidos ───────────── */

const TONES = {
  tick: [{ f: 880, t: 0, d: 0.12, g: 0.8, h: 0.12 }],
  go: [{ f: 1320, t: 0, d: 0.38, g: 1, h: 0.1, hold: 0.5 }],
  up: [{ f: 660, t: 0, d: 0.14, g: 0.8 }, { f: 990, t: 0.17, d: 0.22, g: 0.9 }],
  down: [{ f: 990, t: 0, d: 0.14, g: 0.8 }, { f: 660, t: 0.17, d: 0.22, g: 0.8 }],
  done: [
    { f: 523.25, t: 0, d: 0.95, g: 0.5 }, { f: 659.25, t: 0.07, d: 0.9, g: 0.45 },
    { f: 783.99, t: 0.14, d: 0.85, g: 0.42 }, { f: 1046.5, t: 0.21, d: 0.95, g: 0.32 },
  ],
};

function tone(at, { f, d, g, h = 0, hold = 0 }) {
  const peak = Math.max(0.0002, g * BEEP_LEVEL * cfg.volume);
  const env = ctx.createGain();
  const attack = 0.006;
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(peak, at + attack);
  if (hold > 0) env.gain.setValueAtTime(peak, at + d * hold);
  env.gain.exponentialRampToValueAtTime(0.0001, at + d);
  env.connect(master);
  const oscs = [];
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f, at);
  osc.connect(env);
  oscs.push(osc);
  if (h > 0) {
    // armónico suave para que el pitido se oiga sobre la música sin ser estridente
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(f * 2, at);
    g2.gain.value = h;
    o2.connect(g2);
    g2.connect(env);
    oscs.push(o2);
  }
  const end = at + d + 0.03;
  const node = { oscs, env, end };
  for (const o of oscs) { o.start(at); o.stop(end); }
  oscs[0].onended = () => { liveBeeps.delete(node); try { env.disconnect(); } catch { /* nada */ } };
  liveBeeps.add(node);
}

function scheduleBeep(kind, delaySec) {
  const spec = TONES[kind] || TONES.tick;
  const t0 = ctx.currentTime + Math.max(0, delaySec) + 0.01;
  for (const p of spec) tone(t0 + p.t, p);
  scheduleIdle();
}

/**
 * Pitido sintetizado (sin clics: envolvente de ganancia). kind: 'tick' | 'go' | 'up' | 'down' | 'done'.
 * opts.when: retraso en segundos (programación precisa con el reloj del AudioContext).
 */
export function beep(kind = 'tick', { when = 0 } = {}) {
  if (!cfg.beeps || !ctx || ctx.state === 'closed') return;
  try {
    if (ctx.state === 'running') { scheduleBeep(kind, when); return; }
    const asked = nowMs();
    ensureAudioRunning().then((ok) => {
      if (!ok) return;
      const spent = (nowMs() - asked) / 1000;
      if (when - spent > -0.3) scheduleBeep(kind, when - spent);
    }).catch(() => {});
  } catch { /* nunca rompe el reproductor */ }
}

/** Silencia los pitidos ya programados (pausa, salto de segmento). */
export function cancelBeeps() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const b of [...liveBeeps]) {
    try {
      b.env.gain.cancelScheduledValues(t);
      b.env.gain.setTargetAtTime(0, t, 0.01);
      for (const o of b.oscs) o.stop(t + 0.06);
    } catch { /* ya parado */ }
    liveBeeps.delete(b);
  }
}

/* ───────────── Packs de voz ───────────── */

function packBase(packId) {
  return new URL(`../../audio/packs/${encodeURIComponent(packId)}/`, import.meta.url);
}

const packResult = (p) => ({ ok: !!p && p.ids.size > 0, count: p ? p.ids.size : 0, name: p ? p.name : '', id: p ? p.id : null, voice: !!p?.voice });

/**
 * Carga audio/packs/<packId>/index.json. Los mp3 se descargan y decodifican bajo demanda.
 * Llamadas simultáneas al mismo pack comparten la misma carga. Nunca rechaza.
 */
export function loadPack(packId) {
  if (!packId) { pack = null; loading = null; return Promise.resolve(packResult(null)); }
  if (pack && pack.id === packId) { loading = null; return Promise.resolve(packResult(pack)); }
  if (loading && loading.id === packId) return loading.promise;
  const promise = (async () => {
    let next = null;
    try {
      const base = packBase(packId);
      const res = await fetch(new URL('index.json', base));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const idx = await res.json();
      const ids = new Set(Array.isArray(idx?.clips) ? idx.clips.filter((x) => typeof x === 'string') : []);
      const known = [...ids].filter((id) => SCRIPT.has(id)).length;
      // Pack grabado (guion de voice-pack.js) o pack antiguo de fragmentos del manifiesto
      const voice = packId === PACK_ID || idx?.id === PACK_ID || (ids.size > 0 && known / ids.size >= 0.8);
      const durations = new Map();
      if (idx?.durations && typeof idx.durations === 'object') {
        for (const [id, d] of Object.entries(idx.durations)) if (Number(d) > 0) durations.set(id, Number(d));
      }
      next = { id: packId, name: String(idx?.name || packId), voice, base, ids, buffers: new Map(), durations, parts: new Map() };
    } catch {
      next = null;
    }
    // solo gana la última petición
    if (loading?.promise === promise) {
      pack = next;
      if (pack?.voice && ctx) preloadClips(['countdown_1']);
    }
    return packResult(next);
  })();
  loading = { id: packId, promise };
  promise.finally(() => { if (loading?.promise === promise) loading = null; });
  return promise;
}

/** Id del pack cargado ahora mismo (o null). */
export function currentPackId() {
  return pack?.id ?? null;
}

/** Pack cargado: { id, name, voice (guion grabado), count, clips: Set } o null. */
export function packInfo() {
  if (!pack) return null;
  return { id: pack.id, name: pack.name, voice: !!pack.voice, count: pack.ids.size, clips: new Set(pack.ids) };
}

/** true si hay pack cargado y contiene TODOS los clips pedidos. */
export function hasClips(ids) {
  return !!pack && Array.isArray(ids) && ids.length > 0 && ids.every((id) => pack.ids.has(id));
}

/** Duración real (s) de un clip ya decodificado (o declarada en index.json); null si aún no se sabe. */
export function clipDuration(id) {
  const d = pack?.durations.get(id);
  return Number.isFinite(d) ? d : null;
}

/** Duración estimada (s) de un clip del guion sin decodificar (≈ 0,075 s por carácter + su cola). */
export function estimateClipSec(id) {
  const c = SCRIPT.get(id);
  const len = c ? c.text.length : 12;
  return Math.max(0.35, len * CHAR_SEC) + (c?.kind === 'carrier' ? 0.16 : 0.05);
}

/** Pausa tras un clip: mínima tras una portadora (ya trae su cola), un respiro tras un final de frase. */
export function clipGapAfter(id) {
  const t = SCRIPT.get(id)?.text || '';
  return CLIP_GAP + (/[.!?]$/.test(t) && !t.endsWith('…') ? SENTENCE_PAUSE : 0);
}

/** Duración (s) de una secuencia tal y como la reproduce playClips (preroll + clips + pausas). */
export function clipSequenceSec(ids, durOf = clipDuration) {
  if (!Array.isArray(ids) || !ids.length) return 0;
  let t = VOICE_PREROLL;
  ids.forEach((id, k) => {
    const d = Number(durOf ? durOf(id) : NaN);
    t += Number.isFinite(d) && d > 0 ? d : estimateClipSec(id);
    if (k < ids.length - 1) t += clipGapAfter(id);
  });
  return t;
}

function decode(arr) {
  return new Promise((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(arr, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (e) { reject(e); }
  });
}

/**
 * Recorta el silencio inicial/final del mp3 (relleno del codificador) conservando `head` s delante y hasta
 * `tail` s detrás: en el pack grabado las portadoras guardan su suspenso (~160 ms) antes del número.
 */
function trimSilence(buf, head = 0.02, tail = 0.06) {
  try {
    const data = buf.getChannelData(0);
    const thr = 0.008;
    let a = 0;
    let b = data.length - 1;
    while (a < b && Math.abs(data[a]) < thr) a++;
    while (b > a && Math.abs(data[b]) < thr) b--;
    const sr = buf.sampleRate;
    a = Math.max(0, a - Math.round(sr * head));
    b = Math.min(data.length - 1, b + Math.round(sr * tail));
    const len = b - a + 1;
    if (len <= 0 || len >= data.length - sr * 0.01) return buf;
    const out = ctx.createBuffer(buf.numberOfChannels, len, sr);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) out.copyToChannel(buf.getChannelData(ch).subarray(a, b + 1), ch);
    return out;
  } catch {
    return buf;
  }
}

function getBuffer(id) {
  const p0 = pack;
  const map = p0.buffers;
  if (map.has(id)) {
    const p = map.get(id);
    map.delete(id);
    map.set(id, p); // LRU: lo más reciente al final
    return p;
  }
  const carrier = p0.voice && SCRIPT.get(id)?.kind === 'carrier';
  const url = new URL(`${id}.mp3`, p0.base);
  const p = fetch(url)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
    .then((arr) => decode(arr))
    .then((buf) => {
      const out = p0.voice ? trimSilence(buf, 0.012, carrier ? 0.17 : 0.06) : trimSilence(buf);
      p0.durations.set(id, out.duration);
      return out;
    });
  p.catch(() => map.delete(id));
  map.set(id, p);
  while (map.size > MAX_BUFFERS) map.delete(map.keys().next().value);
  return p;
}

/** Descarga y decodifica por adelantado (sin sonar). Ignora errores. */
export function preloadClips(ids) {
  if (!pack || !ctx || !Array.isArray(ids)) return;
  for (const id of new Set(ids)) if (pack.ids.has(id)) getBuffer(id).catch(() => {});
}

function stopCurrent() {
  const p = playback;
  if (!p) return;
  playback = null;
  try { for (const s of p.sources) s.stop(); } catch { /* ya parado */ }
  p.finish();
}

/** Para la secuencia de clips en curso y anula la que aún se esté descargando. */
export function stopClips() {
  reqGen++;
  stopCurrent();
}

/** Buffers de los clips, con tiempo máximo de espera. */
function loadBuffers(ids) {
  let timer = null;
  const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('clips tarde')), LOAD_TIMEOUT_MS); });
  return Promise.race([Promise.all(ids.map((id) => getBuffer(id))), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Programa trozos de audio con el reloj del AudioContext: items [{ buffer, at }] (at: s desde el arranque).
 * Emite br:voice al empezar y al terminar. Resuelve al acabar o al interrumpirse.
 */
function startPlayback(items, preroll = VOICE_PREROLL) {
  signalVoice(true, 'clips'); // antes de parar la anterior: el ducking no parpadea entre avisos
  let gain = null;
  try {
    stopCurrent();
    gain = ctx.createGain();
    gain.gain.value = cfg.volume;
    gain.connect(master);
    const t0 = ctx.currentTime + preroll;
    let end = t0;
    let last = null;
    const sources = items.map((it) => {
      const s = ctx.createBufferSource();
      s.buffer = it.buffer;
      s.connect(gain);
      const at = t0 + Math.max(0, it.at);
      s.start(at);
      if (at + it.buffer.duration >= end) { end = at + it.buffer.duration; last = s; }
      return s;
    });
    const totalMs = (end - ctx.currentTime) * 1000;
    return new Promise((resolve) => {
      let done = false;
      const g = gain;
      const me = {
        sources,
        gain: g,
        finish: () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (playback === me) playback = null;
          signalVoice(false, 'clips');
          setTimeout(() => { try { g.disconnect(); } catch { /* nada */ } }, 200);
          scheduleIdle();
          resolve();
        },
      };
      const timer = setTimeout(me.finish, totalMs + 600);
      if (last) last.onended = me.finish;
      playback = me;
    });
  } catch (e) {
    signalVoice(false, 'clips');
    try { gain?.disconnect(); } catch { /* nada */ }
    throw e;
  }
}

/**
 * Reproduce una secuencia de clips encadenados con pausas naturales (AudioBuffer). Rechaza si falta alguno o
 * no llegan a tiempo; si mientras carga se pide otra voz o stopClips(), resuelve sin sonar.
 */
export async function playClips(ids) {
  if (!pack || !ctx || !hasClips(ids)) throw new Error('clips no disponibles');
  const g = ++reqGen;
  const running = await ensureAudioRunning();
  if (!running) throw new Error('audio bloqueado');
  const buffers = await loadBuffers(ids);
  if (g !== reqGen) return undefined;
  let at = 0;
  const items = buffers.map((buffer, k) => {
    const it = { buffer, at };
    at += buffer.duration + clipGapAfter(ids[k]);
    return it;
  });
  return startPlayback(items);
}

/* ───────────── Cuenta atrás grabada ("Tres, dos, uno… ¡vamos!") ───────────── */

/** Copia [a, b) de un buffer con micro-fundidos (sin clics). */
function slice(buf, a, b) {
  const len = Math.max(1, b - a);
  const out = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
  const fade = Math.min(Math.round(buf.sampleRate * 0.006), len >> 2);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch).subarray(a, a + len);
    const dst = new Float32Array(src);
    for (let i = 0; i < fade; i++) { const g = i / fade; dst[i] *= g; dst[len - 1 - i] *= g; }
    out.copyToChannel(dst, ch);
  }
  return out;
}

/**
 * Trocea una frase por sus pausas (envolvente RMS de 10 ms) en hasta `maxParts` trozos.
 * Devuelve [{ buffer, onset }] (onset: s hasta que empieza la voz); un único trozo si no encuentra pausas claras.
 */
function splitPhrase(buf, maxParts) {
  try {
    const data = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const hop = Math.max(1, Math.round(sr * 0.01));
    const frames = Math.floor(data.length / hop);
    const rms = new Float32Array(frames);
    let peak = 0;
    for (let f = 0; f < frames; f++) {
      let acc = 0;
      for (let i = f * hop, e = i + hop; i < e; i++) acc += data[i] * data[i];
      rms[f] = Math.sqrt(acc / hop);
      if (rms[f] > peak) peak = rms[f];
    }
    const whole = [{ buffer: buf, onset: 0 }];
    if (!peak || maxParts < 2) return whole;
    const thr = peak * 0.06;
    let first = 0;
    while (first < frames && rms[first] < thr) first++;
    let last = frames - 1;
    while (last > first && rms[last] < thr) last--;
    const gaps = [];
    for (let k = first; k <= last;) {
      if (rms[k] >= thr) { k++; continue; }
      let j = k;
      while (j <= last && rms[j] < thr) j++;
      if (j - k >= 4) gaps.push({ a: k, b: j, len: j - k });
      k = j;
    }
    if (!gaps.length) return whole;
    const chosen = gaps.sort((x, y) => y.len - x.len).slice(0, maxParts - 1).sort((x, y) => x.a - y.a);
    const cuts = chosen.map((g) => {
      let m = g.a;
      for (let f = g.a; f < g.b; f++) if (rms[f] < rms[m]) m = f;
      return Math.round((m + 0.5) * hop);
    });
    const bounds = [0, ...cuts, data.length];
    const parts = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const a = bounds[i];
      const b = bounds[i + 1];
      let on = Math.floor(a / hop);
      while (on < frames && on * hop < b && rms[on] < thr) on++;
      let voiced = 0;
      for (let f = Math.floor(a / hop); f < Math.min(frames, Math.ceil(b / hop)); f++) if (rms[f] >= thr) voiced++;
      if (voiced < 8) return whole; // trozo sin voz real: mejor no trocear
      parts.push({ buffer: slice(buf, a, b), onset: Math.max(0, (on * hop - a) / sr) });
    }
    return parts;
  } catch {
    return [{ buffer: buf, onset: 0 }];
  }
}

/**
 * Cuenta atrás con el clip grabado: cada número cae en su segundo (alineado con los pitidos del reproductor)
 * y el "¡vamos!" en el instante del arranque. startedAt: performance.now() del momento "n".
 * Los trozos que ya llegan tarde se omiten. Rechaza si el clip no está disponible.
 */
export async function playCountdown(id, n = 3, { startedAt = nowMs(), step = 1 } = {}) {
  if (!pack || !ctx || !hasClips([id])) throw new Error('clips no disponibles');
  const g = ++reqGen;
  const running = await ensureAudioRunning();
  if (!running) throw new Error('audio bloqueado');
  const [buf] = await loadBuffers([id]);
  if (g !== reqGen) return undefined;
  const key = `${id}|${n}`;
  if (!pack.parts.has(key)) pack.parts.set(key, splitPhrase(buf, n + 1));
  const parts = pack.parts.get(key);
  const elapsed = (nowMs() - startedAt) / 1000 + COUNTDOWN_PREROLL;
  const items = [];
  const push = (part, target) => {
    // un trozo que llega como mucho 0,25 s tarde suena ya; si llega más tarde se omite
    const at = target - elapsed - part.onset;
    if (at >= -0.25) items.push({ buffer: part.buffer, at: Math.max(0, at) });
  };
  if (parts.length >= 2) {
    // Alineado por el final: el último trozo ("¡vamos!") cae en el arranque y cada anterior un paso antes.
    // Con n + 1 trozos suena todo ("tres, dos, uno, ¡vamos!"); si la grabación trae menos palabras (la de Eva
    // dice "Dos, uno… ¡vamos!") los números que haya siguen cayendo en su segundo, nunca un tiempo tarde.
    const shift = n + 1 - parts.length;
    let prevEnd = -Infinity;
    parts.forEach((part, k) => {
      const target = Math.max((shift + k) * step, prevEnd + 0.05 + part.onset);
      push(part, target);
      prevEnd = target - part.onset + part.buffer.duration;
    });
  } else {
    // sin trocear: que termine justo después del arranque
    push({ buffer: buf, onset: 0 }, n * step + 0.45 - buf.duration);
  }
  if (!items.length) return undefined;
  return startPlayback(items, COUNTDOWN_PREROLL);
}
