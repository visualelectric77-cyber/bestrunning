// BestRunning · puente con la app nativa «BestRunning» de iPhone + Apple Watch (protocolo v1).
// La app nativa es una WKWebView que carga esta misma web y expone window.webkit.messageHandlers.bestrunning:
// la página le cuenta la clase en directo (state, event…), recibe las órdenes del reloj (cmd) y su pulso (hr), y al
// final el resumen de Salud (workout.summary). El iPhone reenvía los mismos bytes al reloj.
// En Safari todo es inerte: isNative() es false, post() devuelve false y attachPlayer() da un adaptador vacío.
// Importar el módulo no tiene efectos: nada se engancha hasta initNativeBridge() (app.js, solo en la app nativa).
// Sin DOM ni UI: la fábrica createNativeBridge() se prueba en Node (tools/test-native-bridge.mjs).
import { clamp, round1, todayKey, addDays, mondayOf, weekdayOf, capitalize, fmt } from '../core/utils.js';
import { ZONES, LEVEL_KEYS, hrZones, hrMaxFromAge, hrTargetForZone } from '../training/levels.js';
import { hrFromSamples, hrFieldsFrom, hrAtLevels, hasHrSeries, HR_MIN, HR_MAX } from './watch-hr.js';
import { diagMark } from '../core/diag.js';

/* ═════════════════ Tipos del protocolo (mismos nombres que native/Shared/Wire.swift) ═════════════════ */

/**
 * @typedef {{ v: 1, type: string, seq: number, boot: string, at: number, id?: string, data: object }} Envelope
 * @typedef {{ sec: number, kmh: number, zone: string }} SegmentSpec
 * @typedef {{ z: number, min: number, max: number }} HRZoneSpec
 * @typedef {{ label: string, minutes?: number, title?: string }} NextClass
 * @typedef {{ proto: number, app: string, build?: string, caps?: string[] }} HelloData
 * @typedef {{ date: string, status: string, classId?: string|null, href?: string|null, title?: string|null,
 *   category?: string|null, categoryLabel?: string|null, categoryColor?: string|null, minutes?: number|null,
 *   estKm?: number|null, recordKm?: number|null, segments: SegmentSpec[], next?: NextClass|null, weekDone: number,
 *   weekPlanned: number, reminder?: string|null, hrZones: HRZoneSpec[] }} TodayData
 * @typedef {{ classId: string, title: string, category?: string, categoryLabel?: string, categoryColor?: string,
 *   minutes?: number, totalSec: number, firstKmh: number, firstZone: string, recordKm?: number }} ClassReadyData
 * @typedef {{ classId: string, title: string, totalSec: number }} ClassPrepareData
 * @typedef {{ bestKm: number }} RecordRef
 * @typedef {{ run: string, classId: string, title: string, category?: string, categoryLabel?: string,
 *   categoryColor?: string, isTest: boolean, totalSec: number, resumed: boolean, segments: SegmentSpec[],
 *   record?: RecordRef, hrZones: HRZoneSpec[] }} ClassStartData
 * @typedef {{ i: number, n: number, zone: string, label: string, short: string, kmh: number, incline?: number,
 *   sec: number, left: number, endAt?: number, adj: number, sub?: string }} SegState
 * @typedef {{ zone: string, label: string, kmh: number, sec: number, dir: string }} NextSeg
 * @typedef {{ lo: number, hi: number }} HRUsual
 * @typedef {{ d: number, side: number, bestKm: number, beaten: boolean }} RecordState
 * @typedef {{ on: boolean, app: boolean, title?: string, artist?: string, bpm?: number, volume: number,
 *   canSkip: boolean }} MusicState
 * @typedef {{ status: string, run?: string, classId?: string, title?: string, isTest?: boolean,
 *   inTestStage?: boolean, seg?: SegState, next?: NextSeg, elapsed?: number, remaining?: number, total?: number,
 *   km?: number, kcal?: number, avgKmh?: number, hrTarget?: HRZoneSpec, hrUsual?: HRUsual, record?: RecordState,
 *   voice?: boolean, music?: MusicState }} StateData
 * @typedef {{ name: string, phase?: string, n?: number, seg?: number, dir?: string, kmh?: number, goAt?: number,
 *   i?: number, prev?: number, reason?: string, zone?: string, delta?: number, total?: number, km?: number,
 *   pace?: string, d?: number, bestKm?: number, title?: string, artist?: string, bpm?: number, vam?: number }} EventData
 * @typedef {{ beaten: boolean, m: number }} RecordResult
 * @typedef {{ run: string, sessionId?: string, classId: string, startedAt: string, endedAt: string, saved: boolean,
 *   completed: boolean, finishedEarly: boolean, elapsedSec: number, pausedSec: number, km: number, kcal: number,
 *   avgKmh: number, maxKmh: number, record?: RecordResult }} ClassEndData
 * @typedef {{ run?: string, classId: string, reason: string }} ClassDiscardData
 * @typedef {{ ref: string, id: string, ok: boolean, reason?: string }} AckData
 * @typedef {{ name: string, from: string, dir?: number, delta?: number, value?: number, on?: boolean,
 *   save?: boolean, classId?: string }} CmdData
 * @typedef {{ run?: string, samples: number[][], replay?: boolean }} HRData
 * @typedef {{ run?: string, sessionId?: string, startedAt: number, endedAt: number, uuid?: string,
 *   kcalActive?: number, hrAvg?: number, hrMax?: number, hrMin?: number, samples: number[][],
 *   source: string }} WorkoutSummaryData
 * @typedef {{ state: string, run?: string, startedAt?: number, source?: string }} WatchWorkoutData
 * @typedef {{ page: string, fg: boolean, classActive: boolean }} PhoneStatusData
 * @typedef {{ paired: boolean, installed: boolean, reachable: boolean, link: string, workout: string,
 *   run?: string }} WatchInfo
 * @typedef {{ auth: string, hr?: string }} HealthInfo   auth: guardar entrenos · hr: guardar pulso (el pulso en directo del
 *   reloj lo necesita). unknown (falta la hoja de Salud) | granted | denied. `hr` no viene en las builds 1–3 del iPhone.
 * @typedef {{ savedAt: number, sessions: number, bytes: number }} BackupInfo
 * @typedef {{ proto?: number, app?: string, watch: WatchInfo, health: HealthInfo, backup?: BackupInfo }} NativeStatusData
 * @typedef {{ savedAt: number, sessions: number, json: string }} BackupData
 * @typedef {{ ref: string, savedAt: number, json: string }} BackupPayload
 * @typedef {{ type: string }} AudioSessionData
 * @typedef {{ reason: string }} AudioKickData   active | route | reset | interruption (iPhone → página)
 * @typedef {{ from?: string }} StoreShowData   RITMUP Pro (página → iPhone): abre la hoja de la suscripción. Solo si
 *   native.hello.caps trae 'store' (los productos han cargado de App Store). `from`: desde dónde, solo para el registro.
 * @typedef {{ pro: boolean, product?: string, expires?: number, trial: boolean, available: boolean }} StoreStatusData
 *   RITMUP Pro (iPhone → página, por on('store.status')): tras native.hello, en cada cambio y al cerrarse la hoja.
 *   product: com.nachogarcia.bestrunning.pro.mensual | .pro.anual · expires: ms · trial: en los 7 días gratis ·
 *   available: false → no enseñar nada de Pro. En la app nada se bloquea aunque pro sea false (ProGate.enforced).
 */

export const PROTO = 1;
const HANDLER = 'bestrunning';
const CAPS = ['state', 'cmd', 'hr', 'summary', 'backup', 'audio'];
const STATE_RUN_MS = 1000;        // state a 1 Hz en cuenta atrás y corriendo
const STATE_IDLE_MS = 5000;       // y cada 5 s en pausa / preparación
const STATE_GAP_MS = 150;         // un cambio (tramo, pausa, voz…) sale ya, pero nunca a menos de 150 ms del anterior
const TODAY_DEBOUNCE_MS = 1000;
const BACKUP_DELAY_MS = 30000;    // copia 30 s después de un cambio…
const BACKUP_EVERY_MS = 5 * 60000; // …y como mucho una cada 5 min (salvo al guardar una clase)
const LIVE_HR_MS = 15000;         // pulso «en directo» si la última lectura llegó hace ≤ 15 s
const LIVE_HR_AGE_MS = 30000;     // y la lectura no es vieja (las repeticiones tras recargar no cuentan)
const SUMMARY_GIVEUP_MS = 15 * 60000;
const CMD_MEMORY = 64;
const MAX_SAMPLES = 20000;
const RUN_MEMORY = 4;             // pulso de las últimas clases en memoria (para fundirlo con el resumen de Salud)
const OVERTAKE_GAP_MS = 45000;    // mismo límite que el bug RÉCORD del HUD
const BACKUP_GET_MS = 15000;
const FRESH_SNAPSHOT_MS = 3 * 3600 * 1000;
const COMMANDS = ['start', 'toggle', 'pause', 'resume', 'skip', 'endTest', 'end', 'voice', 'nextSong', 'intensity', 'volume'];
// Empezar o reanudar la clase con la página oculta (iPhone bloqueado o BestRunning detrás) no se hace: iOS no deja arrancar
// el audio desde segundo plano y la clase saldría muda (y congelada). El reloj lo explica con este motivo.
const LOCKED = 'phone-locked';
// Una orden de empezar/reanudar que llega tan tarde (la página estaba dormida con el iPhone bloqueado y la ejecuta al
// desbloquearlo) ya la dio por perdida el reloj (5 s): no se ejecuta por sorpresa.
const STALE_CMD_MS = 10000;

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const num = (v, d = 0) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const int = (v) => Math.round(num(v));
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const dirOf = (from, to) => {
  const d = num(to) - num(from);
  return d >= 0.05 ? 'up' : d <= -0.05 ? 'down' : 'same';
};
const zoneLabel = (seg) => String(seg?.label || ZONES[seg?.zone]?.name || 'Correr');
const zoneShort = (zone, fallback) => String(ZONES[zone]?.short || fallback || 'Correr');

function randomBoot(prefix = 'j') {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = prefix;
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/* ═════════════════ Funciones puras (también para los tests) ═════════════════ */

/** Minutos del id de una clase ('plantilla~45~semilla~100' → 45; 0 si no se puede leer). */
function minutesOfId(id) {
  let s = String(id || '');
  try { s = decodeURIComponent(s); } catch { /* tal cual */ }
  const p = s.split('~');
  return p.length === 4 && /^\d+$/.test(p[1]) ? Number(p[1]) : 0;
}

/**
 * Tu mejor marca en esta clase: la misma selección que el fantasma del reproductor (misma plantilla y duración,
 * completada, con traza de velocidad, la de más distancia). → km o null.
 */
export function recordKmFor(history, workout) {
  if (!workout?.templateId) return null;
  const mins = num(workout.minutes) || minutesOfId(workout.id);
  let best = null;
  for (const h of Array.isArray(history) ? history : []) {
    if (!h || h.templateId !== workout.templateId || !h.completed) continue;
    const m = minutesOfId(h.workoutId) || Math.round(num(h.plannedSec) / 60);
    if (mins && m !== mins) continue;
    if (!Array.isArray(h.speedTrace) || h.speedTrace.length < 2 || !(num(h.distanceKm) > 0)) continue;
    if (best == null || num(h.distanceKm) > best) best = num(h.distanceKm);
  }
  return best;
}

/** Zonas de FC del perfil como las espera el reloj: [{ z, min, max }]. */
export function hrZonesSpec(profile) {
  const p = profile || {};
  try {
    return hrZones(num(p.hrMax) || hrMaxFromAge(num(p.age) || 46), num(p.hrRest) || null)
      .map((z) => ({ z: int(z.zone), min: int(z.min), max: int(z.max) }));
  } catch {
    return [];
  }
}

/** Distancia del fantasma en t (s de clase), con la misma fórmula que el chip «vs récord» del HUD. */
export function ghostKmAt(ghost, t) {
  const g = ghost;
  if (!g || !Array.isArray(g.times) || !g.times.length || !Array.isArray(g.cum)) return 0;
  const n = g.times.length;
  if (t >= g.times[n - 1]) return g.cum[n - 1];
  if (t < g.times[0]) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.times[mid] <= t) lo = mid; else hi = mid - 1;
  }
  return g.cum[lo] + (num(g.trace?.[lo]?.[1]) * (t - g.times[lo])) / 3600;
}

/** Lecturas [[ms, bpm]] válidas (40–220 ppm), ordenadas y sin dos en el mismo segundo. */
function cleanSamples(list) {
  const seen = new Set();
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    const ms = Array.isArray(p) ? Number(p[0]) : Number(p?.ms);
    const bpm = Array.isArray(p) ? Number(p[1]) : Number(p?.bpm);
    if (!Number.isFinite(ms) || !Number.isFinite(bpm) || bpm < HR_MIN || bpm > HR_MAX || ms <= 0) continue;
    const k = Math.round(ms / 1000);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([Math.round(ms), Math.round(bpm)]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/* ═════════════════ Adaptador vacío (Safari y reproductor sin app nativa) ═════════════════ */

const noop = () => {};
const NOOP_ADAPTER = Object.freeze({
  ready: noop, prepare: noop, resumed: noop, started: noop, countdown: noop, tick: noop, segment: noop, event: noop,
  record: noop, hrFields: () => ({}), finish: noop, discard: noop, samples: () => [], restore: noop, liveHr: () => null,
  watchManaged: () => false, healthMissing: () => null, detach: noop,
});

/**
 * ¿Falta permiso de Salud para el pulso en directo del reloj? (estado de native.status)
 * → null (todo bien o no se sabe), 'prompt' (aún sale la hoja de Salud) o 'denied' (hay que activarlo en Ajustes).
 */
export function healthMissingOf(st) {
  const h = st?.health;
  if (!h) return null;
  const vals = [h.auth, h.hr].filter((v) => v != null);
  if (vals.includes('unknown')) return 'prompt';
  if (vals.includes('denied')) return 'denied';
  return null;
}

/* ═════════════════ Fábrica ═════════════════ */

const defaultDispatch = (name, detail) => {
  try {
    const w = globalThis.window;
    if (!w || typeof w.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
    w.dispatchEvent(new globalThis.CustomEvent(name, { detail }));
  } catch { /* sin DOM */ }
};
const defaultVisible = () => {
  try { return globalThis.document?.visibilityState !== 'hidden'; } catch { return true; }
};
const defaultTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (t) => clearInterval(t),
};
const defaultLibs = () => Promise.all([import('../training/planner.js'), import('../training/templates.js'), import('../training/goal.js')])
  .then(([planner, templates, goal]) => ({ planner, templates, goal }));

/**
 * Puente (fábrica pura para los tests; la app usa la instancia por defecto).
 * opts: { handler: () => messageHandler | messageHandler, now, store: { getState, setState, subscribe, importState,
 *   exportState, loadActiveSession?, activeSessionSavedAt? }, navigate, dispatch(name, detail), timers, libs, app,
 *   expose (window.BRNative al iniciar; por defecto true), visible (() => ¿página a la vista?; por defecto document) }
 */
export function createNativeBridge(opts = {}) {
  const {
    handler = () => globalThis.window?.webkit?.messageHandlers?.[HANDLER],
    now = () => Date.now(),
    dispatch = defaultDispatch,
    timers = defaultTimers,
    libs: loadLibsFn = defaultLibs,
    expose = true,
    visible = defaultVisible,
  } = opts;
  let store = opts.store || null;
  let navigate = typeof opts.navigate === 'function' ? opts.navigate : null;
  let app = String(opts.app || 'web');

  const boot = randomBoot('j');
  let seq = 0;
  let inited = false;
  let helloSent = false;
  const preHello = [];          // lo que se publica antes del hello sale justo después, en orden
  let status = null;            // último native.hello / native.status
  let adapter = null;           // reproductor enganchado
  const recentCmds = new Map(); // id → ack (deduplicación de órdenes)
  const runSamples = new Map(); // run → [[ms, bpm]] de clases ya cerradas (para fundir con el resumen)
  const listeners = new Map();
  const pendingGets = new Map();
  let todayHash = '';
  let lastToday = null;
  let todayDate = '';
  let todayT = null;
  let todayP = null;
  let backupT = null;
  let lastBackupAt = -Infinity;
  let unsub = null;
  let onVis = null;
  let libs = null;
  let libsP = null;

  const getHandler = () => {
    try {
      const h = typeof handler === 'function' ? handler() : handler;
      return h && typeof h.postMessage === 'function' ? h : null;
    } catch {
      return null;
    }
  };
  const native = () => !!getHandler();
  const st0 = () => {
    try { return store?.getState?.() || null; } catch { return null; }
  };

  function loadLibs() {
    if (libs) return Promise.resolve(libs);
    if (!libsP) {
      libsP = Promise.resolve()
        .then(() => loadLibsFn())
        .then((l) => { libs = l || {}; return libs; })
        .catch(() => { libs = {}; return libs; });
    }
    return libsP;
  }

  function catInfo(cat) {
    const c = cat ? libs?.templates?.CATEGORIES?.[cat] : null;
    const out = {};
    if (cat) out.category = String(cat);
    if (c?.name) out.categoryLabel = String(c.name);
    if (c?.color) out.categoryColor = String(c.color);
    return out;
  }

  /* ───────── Envío ───────── */

  function send(type, data, id, at) {
    const h = getHandler();
    if (!h) return false;
    const env = { v: PROTO, type, seq: ++seq, boot, at: Math.round(num(at, now())) };
    if (id) env.id = String(id);
    env.data = isObj(data) ? data : {};
    try {
      h.postMessage(JSON.stringify(env));
      return true;
    } catch {
      return false;
    }
  }

  /** Publica un mensaje. false en Safari (o si la app no lo acepta). Antes del hello, se encola. */
  function post(type, data = {}, id = undefined, at = undefined) {
    if (typeof type !== 'string' || !type || !native()) return false;
    if (!helloSent && type !== 'hello') {
      preHello.push([type, data, id, at ?? now()]);
      if (preHello.length > 200) {
        const i = preHello.findIndex((e) => e[0] === 'state');
        preHello.splice(i >= 0 ? i : 0, 1);
      }
      return true;
    }
    return send(type, data, id, at);
  }

  function sendHello() {
    if (helloSent) return;
    helloSent = true;
    send('hello', { proto: PROTO, app, caps: CAPS.slice() });
    for (const [type, data, id, at] of preHello.splice(0)) send(type, data, id, at);
  }

  const nextId = () => `${boot}-${seq + 1}`;

  /* ───────── Recepción ───────── */

  function emit(type, data, env) {
    const set = listeners.get(type);
    if (!set) return;
    for (const cb of [...set]) {
      try { cb(data, env); } catch { /* un oyente roto no rompe el puente */ }
    }
  }

  /** Mensaje del iPhone (texto JSON u objeto). Nunca lanza; devuelve qué lo ha atendido (o false si se descarta). */
  function receive(m) {
    let env = m;
    if (typeof m === 'string') {
      try { env = JSON.parse(m); } catch { return false; }
    }
    if (!isObj(env) || env.v !== PROTO || typeof env.type !== 'string') return false;
    const data = isObj(env.data) ? env.data : {};
    let handled = 'ignored';
    try {
      handled = route(env.type, data, env) || 'ignored';
    } catch {
      handled = 'error';
    }
    emit(env.type, data, env);
    emit('*', data, env);
    return handled;
  }

  function route(type, data, env) {
    switch (type) {
      case 'native.hello':
      case 'native.status': {
        // native.status solo trae lo que cambia (reloj, Salud, copia): lo del saludo (versión, capacidades y el motivo
        // de que no haya IA) se conserva. Antes se perdían caps y aiReason con el primer native.status y la IA, las
        // métricas de Salud y los avisos de la mañana dejaban de ofrecerse sin decir nada.
        const keep = status && type === 'native.status'
          ? { proto: status.proto, app: status.app, ...(status.caps ? { caps: status.caps } : {}), ...(status.aiReason ? { aiReason: status.aiReason } : {}) }
          : {};
        status = { ...keep, ...data };
        dispatch('br:native-status', status);
        return 'status';
      }
      case 'hr':
        onHr(data);
        return 'hr';
      case 'audio.kick':
        // El iPhone avisa de algo que pudo dejar mudo el audio (audio-engine.js lo comprueba y lo despierta)
        dispatch('br:audio-kick', { reason: String(data.reason || '') });
        return 'audio';
      case 'cmd':
        onCmd(env, data);
        return 'cmd';
      case 'workout.summary':
        onSummary(env, data);
        return 'summary';
      case 'backup.data': {
        const p = pendingGets.get(String(data.ref || ''));
        if (p) {
          pendingGets.delete(String(data.ref));
          timers.clearTimeout(p.t);
          p.resolve({ savedAt: num(data.savedAt), json: String(data.json || '') });
        }
        return 'backup';
      }
      case 'ack': {
        // El iPhone no tiene copia (reason 'no-backup'): la petición falla ya, sin esperar los 15 s.
        if (data.ref !== 'backup.get') return 'ignored';
        const key = String(data.id || '');
        const p = pendingGets.get(key);
        if (p && !data.ok) {
          pendingGets.delete(key);
          timers.clearTimeout(p.t);
          p.reject(new Error(String(data.reason || 'no-backup')));
        }
        return 'ack';
      }
      default:
        return 'ignored';
    }
  }

  /* ───────── Pulso en directo ───────── */

  function keepRun(run, samples) {
    if (!samples?.length) return;
    const k = run || '_';
    runSamples.delete(k);
    runSamples.set(k, samples);
    while (runSamples.size > RUN_MEMORY) runSamples.delete(runSamples.keys().next().value);
  }

  function onHr(data) {
    const list = Array.isArray(data.samples) ? data.samples : [];
    if (adapter && adapter.acceptsRun(data.run)) { adapter.addSamples(list); return; }
    const k = data.run || '_';
    keepRun(k, cleanSamples([...(runSamples.get(k) || []), ...list]).slice(-MAX_SAMPLES));
  }

  /* ───────── Órdenes del reloj ───────── */

  function remember(id, ack) {
    recentCmds.set(id, ack);
    while (recentCmds.size > CMD_MEMORY) recentCmds.delete(recentCmds.keys().next().value);
  }

  function onCmd(env, data) {
    const id = String(env.id || '');
    if (!id) return; // sin id no se puede responder (el reloj ya dará «unreachable»)
    const target = adapter;
    // El estado fresco es el del reproductor que haya AHORA. «Empezar» aceptado sin reproductor: no se manda
    // `idle` (el reloj abandonaría el entreno que acaba de empezar); el reproductor nuevo manda el suyo al montarse.
    const fresh = (started) => {
      const a = adapter;
      if (a && !a.detached()) a.pushState(true);
      else if (!started) post('state', { status: 'idle' });
    };
    const startedHere = (ack) => !target && !!ack?.ok && String(data?.name || '') === 'start';
    if (recentCmds.has(id)) {
      const ack = recentCmds.get(id);
      post('ack', ack);
      fresh(startedHere(ack));
      return;
    }
    // Empezar o reanudar: solo con la página a la vista (o, al reanudar, con el audio aún vivo) y si la orden es reciente
    const age = num(now()) - num(env.at, num(now()));
    const gate = (kind, audioLive = true) => {
      if (age > STALE_CMD_MS) return 'timeout';
      let shown = true;
      try { shown = visible() !== false; } catch { shown = true; }
      if (!shown && (kind === 'begin' || !audioLive)) return LOCKED;
      return null;
    };
    let res;
    try {
      res = target ? target.command(data, gate) : commandWithoutPlayer(data, gate);
    } catch {
      res = { ok: false, reason: 'busy' };
    }
    const reply = (r) => {
      const ack = { ref: 'cmd', id, ok: !!r?.ok };
      if (!ack.ok) ack.reason = String(r?.reason || 'busy');
      remember(id, ack);
      post('ack', ack);
      fresh(startedHere(ack));
    };
    if (res && typeof res.then === 'function') res.then(reply, () => reply({ ok: false, reason: 'busy' }));
    else reply(res);
  }

  /** Orden sin el reproductor abierto: solo «Empezar» tiene sentido (las demás: no-class / unknown). */
  function commandWithoutPlayer(d, gate = () => null) {
    const name = String(d?.name || '');
    if (name !== 'start') return { ok: false, reason: COMMANDS.includes(name) ? 'no-class' : 'unknown' };
    const no = gate('begin');
    if (no) return { ok: false, reason: no };
    return startWithoutPlayer();
  }

  /** «Empezar» desde el reloj sin el reproductor: la clase a medias (si es reciente) o la de hoy, con autoarranque. */
  async function startWithoutPlayer() {
    if (!navigate) return { ok: false, reason: 'busy' };
    try {
      const snap = store?.loadActiveSession?.();
      const at = num(store?.activeSessionSavedAt?.());
      if (snap?.workoutId && at > 0 && now() - at < FRESH_SNAPSHOT_MS) {
        navigate('#/play/resume?autostart=1');
        return { ok: true };
      }
    } catch { /* sin almacenamiento */ }
    const t = lastToday || (await buildToday().catch(() => null));
    // 'done': «Otra clase» del reloj (build 7) repite la clase de hoy ya hecha
    if (!t || (t.status !== 'today' && t.status !== 'done') || !t.href) return { ok: false, reason: 'no-class-today' };
    navigate(`${t.href}${t.href.includes('?') ? '&' : '?'}autostart=1`);
    return { ok: true };
  }

  /* ───────── Resumen de Salud (workout.summary) ───────── */

  function onSummary(env, data) {
    diagMark('reloj.resumen', { muestras: Array.isArray(data?.samples) ? data.samples.length : 0, origen: data?.source || '-' });
    const id = String(env.id || '');
    if (!id || !store?.getState) return;
    const st = st0() || {};
    const hist = Array.isArray(st.history) ? st.history : [];
    const startMs = num(data.startedAt, NaN);
    let ses = data.sessionId ? hist.find((h) => h && h.id === data.sessionId) : null;
    if (!ses && data.run) ses = hist.find((h) => h && h.startedAt === data.run);
    if (!ses && Number.isFinite(startMs)) {
      ses = hist.find((h) => h && Math.abs(Date.parse(h.startedAt || '') - startMs) <= 120000) || null;
    }
    if (!ses) {
      // Sin sesión: si el entreno terminó hace mucho no va a aparecer (se responde para que el iPhone lo olvide);
      // si es reciente, sin respuesta: el iPhone lo reintenta (hello y cada 30 s)
      if (now() - num(data.endedAt, now()) > SUMMARY_GIVEUP_MS) post('ack', { ref: 'workout.summary', id, ok: false, reason: 'no-session' });
      return;
    }
    const live = [
      ...(adapter && adapter.acceptsRun(data.run || ses.startedAt) ? adapter.samples() : []),
      ...(runSamples.get(data.run || ses.startedAt) || []),
    ];
    const merged = cleanSamples([...(Array.isArray(data.samples) ? data.samples : []), ...live]);
    const res = merged.length >= 3 ? hrFromSamples(merged, ses) : null;
    const cur = num(ses.hrSamples) || (hasHrSeries(ses) ? ses.hrSeries.length : 0);
    const uuid = typeof data.uuid === 'string' && data.uuid ? data.uuid : null;
    const hrSource = data.source === 'phone-query' ? 'watch-live' : 'healthkit';
    const better = !!res && res.samples >= cur;
    const sameHr = better && ses.hrSamples === res.samples && ses.hrAvg === res.hrAvg && ses.hrMax === res.hrMax;
    const sameHealth = !uuid || ses.health?.uuid === uuid;
    if ((better && !sameHr) || !sameHealth) {
      try {
        store.setState((d) => {
          const h = (d.history || []).find((x) => x && x.id === ses.id);
          if (!h) return;
          if (better && !sameHr) Object.assign(h, hrFieldsFrom(res, d.profile || {}), { hrSource, hrSamples: res.samples });
          if (uuid && !sameHealth) {
            h.health = { uuid, kcal: data.kcalActive != null ? int(data.kcalActive) : null, savedAt: Math.round(now()) };
          }
        });
      } catch { /* sin almacenamiento: el iPhone lo reintentará */ return; }
    }
    dispatch('br:native-hr', { sessionId: ses.id });
    post('ack', { ref: 'workout.summary', id, ok: true });
  }

  /* ───────── Hoy (today) ───────── */

  async function buildToday() {
    const L = await loadLibs();
    const st = st0();
    const P = L?.planner;
    if (!st || typeof P?.todayPlan !== 'function') return null;
    const at = new Date(now());
    const day = P.todayPlan(st, at);
    if (!day) return null;
    const w = day.status !== 'rest' ? day.workout : null;
    const t = {
      date: String(day.date || todayKey(at)),
      status: String(day.status || 'today'),
      classId: null, href: null, title: null, category: null, categoryLabel: null, categoryColor: null,
      minutes: null, estKm: null, recordKm: null, segments: [],
    };
    if (w) {
      const c = catInfo(w.category);
      Object.assign(t, {
        classId: String(w.id),
        href: `#/play/${encodeURIComponent(w.id)}?date=${t.date}`,
        title: String(w.title || 'Entrenamiento'),
        category: c.category ?? null,
        categoryLabel: c.categoryLabel ?? null,
        categoryColor: c.categoryColor ?? null,
        minutes: int(w.minutes || num(w.totalSec) / 60),
        estKm: w.estDistanceKm != null ? r2(num(w.estDistanceKm)) : null,
        recordKm: recordKmFor(st.history, w),
        segments: (Array.isArray(w.segments) ? w.segments : [])
          .filter((s) => num(s?.sec) > 0)
          .map((s) => ({ sec: int(s.sec), kmh: round1(num(s.speed)), zone: String(s.zone || 'jog') })),
      });
      if (t.recordKm != null) t.recordKm = r3(t.recordKm);
    }
    let next = null;
    for (let k = 1; k <= 7 && !next; k++) {
      const d = P.planDay(st, addDays(t.date, k), at);
      if (!d || d.kind === 'rest' || !d.workout) continue;
      next = {
        label: k === 1 ? 'Mañana' : capitalize(fmt.weekdayName(d.weekday || weekdayOf(d.date))),
        minutes: int(d.workout.minutes || num(d.workout.totalSec) / 60),
        title: String(d.workout.title || 'Entrenamiento'),
      };
    }
    const week = typeof P.planWeek === 'function' ? P.planWeek(st, t.date, at) : [];
    t.next = next;
    t.weekDone = week.filter((d) => d?.status === 'done').length;
    t.weekPlanned = week.filter((d) => d?.workout && d.kind !== 'rest').length;
    t.reminder = st.schedule?.reminderTime ? String(st.schedule.reminderTime) : null;
    t.hrZones = hrZonesSpec(st.profile);
    // Esferas del reloj: km y minutos corridos desde el lunes, y la carrera objetivo (cuenta atrás)
    const monday = mondayOf(t.date);
    let wKm = 0, wSec = 0;
    for (const h of Array.isArray(st.history) ? st.history : []) {
      const k = String(h?.dayKey || '');
      if (k < monday || k > t.date) continue;
      wKm += num(h.distanceKm); wSec += num(h.elapsedSec);
    }
    t.weekKm = r3(wKm);
    t.weekMinutes = int(wSec / 60);
    t.goal = null;
    try {
      const g = L.goal?.goalOf?.(st);
      if (g && g.date >= t.date) {
        const wi = L.goal.goalWeekInfo?.(g, t.date);
        t.goal = {
          distance: g.distance, label: L.goal.goalDistance?.(g.distance)?.label || g.distance.toUpperCase(), date: g.date,
          targetSec: g.targetSec ?? null, where: g.where, week: wi?.weekOfBlock ?? null, weeks: wi?.blockWeeks ?? null,
        };
      }
    } catch { t.goal = null; /* sin cuenta atrás, pero «hoy» llega igual */ }
    return t;
  }

  /** Recalcula «hoy» y lo envía si cambió (o siempre con force). */
  function sendToday(force = false) {
    if (!native()) return Promise.resolve(false);
    const p = buildToday().catch(() => null).then((t) => {
      if (!t) return false;
      lastToday = t;
      todayDate = t.date;
      const hash = JSON.stringify(t);
      if (!force && hash === todayHash) return false;
      todayHash = hash;
      return post('today', t);
    });
    todayP = p;
    return p;
  }

  function scheduleToday() {
    if (todayT) timers.clearTimeout(todayT);
    todayT = timers.setTimeout(() => { todayT = null; sendToday(false); }, TODAY_DEBOUNCE_MS);
  }

  /* ───────── Copia de seguridad en el iPhone ───────── */

  function sendBackup() {
    if (backupT) { timers.clearTimeout(backupT); backupT = null; }
    const st = st0();
    // Nada que guardar (o datos recién borrados): no se pisan las copias buenas del iPhone
    if (!st?.onboarded || !Array.isArray(st.history) || !st.history.length) return false;
    let json = '';
    try { json = String(store.exportState?.() || ''); } catch { json = ''; }
    if (!json) return false;
    lastBackupAt = now();
    diagMark('copia.enviada', { kb: json.length / 1024 });
    return post('backup', { savedAt: Math.round(lastBackupAt), sessions: st.history.length, json });
  }

  function scheduleBackup() {
    if (backupT || !native()) return;
    const wait = Math.max(BACKUP_DELAY_MS, lastBackupAt + BACKUP_EVERY_MS - now());
    backupT = timers.setTimeout(() => { backupT = null; sendBackup(); }, wait);
  }

  /** Pide al iPhone su última copia. → Promise<{ savedAt, json }> (rechaza a los 15 s). */
  function requestBackup() {
    if (!native()) return Promise.reject(new Error('no-native'));
    return new Promise((resolve, reject) => {
      const id = nextId();
      const t = timers.setTimeout(() => { pendingGets.delete(id); reject(new Error('timeout')); }, BACKUP_GET_MS);
      pendingGets.set(id, { resolve, reject, t });
      if (!post('backup.get', {}, id)) {
        pendingGets.delete(id);
        timers.clearTimeout(t);
        reject(new Error('no-native'));
      }
    });
  }

  /* ───────── Arranque ───────── */

  function init(o = {}) {
    if (inited) return true;
    if (!native()) return false;
    inited = true;
    if (typeof o.navigate === 'function') navigate = o.navigate;
    if (o.app) app = String(o.app);
    if (o.store) store = o.store;
    if (expose) {
      try {
        const w = globalThis.window;
        if (w && !w.BRNative) w.BRNative = Object.freeze({ receive, post });
      } catch { /* sin ventana */ }
    }
    sendHello();
    sendToday(true);
    try {
      unsub = store?.subscribe?.(() => { scheduleToday(); scheduleBackup(); }) || null;
    } catch { unsub = null; }
    const doc = globalThis.document;
    if (doc && typeof doc.addEventListener === 'function') {
      onVis = () => {
        if (doc.visibilityState === 'visible' && todayKey(new Date(now())) !== todayDate) sendToday(false);
      };
      doc.addEventListener('visibilitychange', onVis);
    }
    return true;
  }

  function destroy() {
    try { unsub?.(); } catch { /* nada */ }
    unsub = null;
    if (onVis) { try { globalThis.document?.removeEventListener?.('visibilitychange', onVis); } catch { /* nada */ } }
    if (todayT) timers.clearTimeout(todayT);
    if (backupT) timers.clearTimeout(backupT);
    todayT = backupT = null;
    adapter?.api.detach();
    for (const p of pendingGets.values()) timers.clearTimeout(p.t);
    pendingGets.clear();
  }

  function on(type, cb) {
    if (typeof cb !== 'function') return noop;
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(cb);
    return () => listeners.get(type)?.delete(cb);
  }

  /* ═════════════════ Adaptador del reproductor ═════════════════ */

  function attachPlayer(o) {
    if (!o || !o.workout || !native()) return NOOP_ADAPTER;
    if (adapter) adapter.api.detach();
    adapter = makeAdapter(o);
    return adapter.api;
  }

  function makeAdapter(o) {
    const workout = o.workout;
    const getEngine = typeof o.getEngine === 'function' ? o.getEngine : () => null;
    const extrasFn = typeof o.extras === 'function' ? o.extras : () => ({});
    const cmds = isObj(o.commands) ? o.commands : {};
    const getSt = () => {
      try { return (typeof o.getState === 'function' ? o.getState() : st0()) || {}; } catch { return {}; }
    };
    const classId = String(workout.id || '');
    const title = String(workout.title || 'Entrenamiento');

    let detached = false;
    let samples = [];             // [[ms, bpm]] de esta clase
    let secs = new Set();
    let last = null;              // { bpm, at (ms de la lectura), rx (ms de llegada) }
    let run = null;               // startedAt del motor: identifica la clase en todas partes
    let lastStateAt = -Infinity;
    let lastKey = '';
    let deferT = null;
    let hb = null;
    let finished = false;
    let cdSeg = -1;               // cuenta atrás de fin de tramo (derivada del tick)
    let cdLast = 4;
    let cdGoAt = null;            // instante del «¡Ya!» de la cuenta 3-2-1 de salida/reanudación
    let lastKmh = null;
    let overtakeAt = -Infinity;
    let beatenSent = false;
    let usual = { key: '', val: null };
    let lastTrack = '';
    let gated = !libs;            // categorías (templates.js) aún cargando: los envíos esperan, en orden
    const gateQ = [];

    const out = (fn) => {
      if (detached) return;
      if (!gated) { try { fn(); } catch { /* nada */ } return; }
      gateQ.push(fn);
    };
    if (gated) {
      loadLibs().then(() => {
        gated = false;
        for (const fn of gateQ.splice(0)) { if (!detached) { try { fn(); } catch { /* nada */ } } }
      });
    }

    const eng = () => {
      try { return getEngine() || null; } catch { return null; }
    };
    const es = () => {
      try { return eng()?.getState?.() || null; } catch { return null; }
    };
    const xs = () => {
      try { return extrasFn() || {}; } catch { return {}; }
    };
    const noteRun = (s) => {
      if (!s?.startedAt || run) return;
      run = String(s.startedAt);
      // Pulso de esta clase que llegó antes de engancharse (recarga a mitad de clase: el iPhone lo repite al hello)
      const pre = runSamples.get(run);
      if (pre?.length) { runSamples.delete(run); addSamples(pre); }
    };

    function statusOf(s, x) {
      if (detached) return 'idle';
      if (finished || x.finished || s?.status === 'finished') return 'finished';
      if (x.countingDown) return 'countdown';
      if (!s) return 'ready';
      return s.status === 'running' || s.status === 'paused' ? s.status : 'ready';
    }

    function usualFor(zone, segIndex, st) {
      const key = `${segIndex}|${zone}`;
      if (usual.key === key) return usual.val;
      let val = null;
      if (LEVEL_KEYS.includes(zone)) {
        try {
          const hrs = (Array.isArray(st.history) ? st.history : [])
            .filter((h) => h && hasHrSeries(h))
            .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))
            .slice(0, 3);
          const avgs = hrs.map((h) => num(hrAtLevels(h)?.[zone]?.avg, NaN)).filter(Number.isFinite);
          if (avgs.length) val = { lo: Math.round(Math.min(...avgs)), hi: Math.round(Math.max(...avgs)) };
        } catch { val = null; }
      }
      usual = { key, val };
      return val;
    }

    function musicState(x, st) {
      const appM = !!x.appMusic;
      const on = appM && !!x.musicOn;
      const np = on && isObj(x.np) ? x.np : null;
      const vol = clamp(num(x.vol, num(st.music?.volume, 0.8)), 0, 1);
      const m = { on, app: appM, volume: r2(vol), canSkip: !!(on && np && x.canSkip) };
      if (np?.title) {
        m.title = String(np.title);
        if (np.artist) m.artist = String(np.artist);
        if (num(np.bpm) > 0) m.bpm = Math.round(num(np.bpm));
      }
      return m;
    }

    function buildState(at) {
      const s = es();
      const x = xs();
      const st = getSt();
      noteRun(s);
      const status = statusOf(s, x);
      if (status === 'idle') return { status: 'idle' };
      const d = { status };
      if (run) d.run = run;
      d.classId = classId;
      d.title = title;
      d.isTest = !!workout.isTest;
      if (!s) {
        d.total = int(workout.totalSec);
        d.voice = !x.muted;
        d.music = musicState(x, st);
        return d;
      }
      d.inTestStage = !!s.inTestStage;
      const seg = s.segment;
      if (seg) {
        const left = Math.max(0, num(s.segRemaining));
        d.seg = {
          i: int(s.segIndex), n: int(s.segCount), zone: String(seg.zone), label: zoneLabel(seg), short: zoneShort(seg.zone, seg.label),
          kmh: status === 'finished' ? 0 : round1(num(s.currentSpeed, num(seg.speed))), incline: round1(num(seg.incline)),
          sec: int(seg.sec), left: round1(left), adj: round1(num(s.adjustments?.[seg.zone])),
        };
        if (status === 'running') d.seg.endAt = Math.round(at + left * 1000);
        if (x.sub) d.seg.sub = String(x.sub);
        const nx = s.nextSegment;
        if (nx) d.next = { zone: String(nx.zone), label: zoneLabel(nx), kmh: round1(num(nx.speed)), sec: int(nx.sec), dir: dirOf(seg.speed, nx.speed) };
        try {
          const t = hrTargetForZone(seg.zone, st.profile || {});
          d.hrTarget = { z: int(t.zone), min: int(t.min), max: int(t.max) };
        } catch { /* sin perfil */ }
        const u = usualFor(seg.zone, s.segIndex, st);
        if (u) d.hrUsual = u;
      }
      d.elapsed = round1(num(s.totalElapsed));
      d.remaining = round1(num(s.totalRemaining));
      d.total = int(s.totalSec);
      d.km = r3(num(s.distanceKm));
      d.kcal = int(s.kcal);
      d.avgKmh = round1(num(s.avgSpeed));
      const g = x.ghost;
      if (g && num(g.km) > 0) {
        d.record = {
          d: Math.round((num(s.distanceKm) - ghostKmAt(g, num(s.totalElapsed))) * 1000),
          side: int(x.ghostSide), bestKm: r3(num(g.km)), beaten: num(s.distanceKm) > num(g.km),
        };
      }
      d.voice = !x.muted;
      d.music = musicState(x, st);
      return d;
    }

    const keyOf = (d) => [d.status, d.seg?.i ?? -1, d.seg?.adj ?? 0, d.voice, d.music?.title || '', d.music?.on, d.music?.volume,
      d.record?.side ?? 0, d.inTestStage].join('|');

    /** Envía `state` si toca: ya si cambió algo (≥ 150 ms del anterior), 1 Hz corriendo, cada 5 s en reposo. */
    function pushState(force = false) {
      if (detached) return false;
      const t = num(now());
      const d = buildState(t);
      const key = keyOf(d);
      if (!force) {
        if (key !== lastKey) {
          if (t - lastStateAt < STATE_GAP_MS) {
            if (!deferT) deferT = timers.setTimeout(() => { deferT = null; pushState(false); }, Math.max(1, lastStateAt + STATE_GAP_MS - t));
            return false;
          }
        } else {
          const every = d.status === 'running' || d.status === 'countdown' ? STATE_RUN_MS : STATE_IDLE_MS;
          if (t - lastStateAt < every) return false;
        }
      }
      if (deferT) { timers.clearTimeout(deferT); deferT = null; }
      lastStateAt = t;
      lastKey = key;
      out(() => post('state', d, undefined, t));
      return true;
    }

    const event = (data) => out(() => post('event', data));

    function classReady() {
      const segs = Array.isArray(workout.segments) ? workout.segments.filter((s) => num(s?.sec) > 0) : [];
      const first = segs[0] || {};
      const rec = recordKmFor(getSt().history, workout);
      const d = {
        classId, title, ...catInfo(workout.category),
        minutes: int(workout.minutes || num(workout.totalSec) / 60),
        totalSec: int(workout.totalSec || segs.reduce((a, s) => a + num(s.sec), 0)),
        firstKmh: round1(num(first.speed)), firstZone: String(first.zone || 'jog'),
      };
      if (rec != null) d.recordKm = r3(rec);
      return d;
    }

    function classStart(resumed) {
      const e = eng();
      const s = es();
      noteRun(s);
      const x = xs();
      const segs = (() => {
        try { return e?.getSegments?.() || workout.segments || []; } catch { return workout.segments || []; }
      })();
      const d = {
        run: run || new Date(num(now())).toISOString(),
        classId, title, ...catInfo(workout.category),
        isTest: !!workout.isTest,
        totalSec: int(s?.totalSec || workout.totalSec),
        resumed: !!resumed,
        segments: segs.filter((g) => num(g?.sec) > 0).map((g) => ({ sec: int(g.sec), kmh: round1(num(g.speed)), zone: String(g.zone || 'jog') })),
        hrZones: hrZonesSpec(getSt().profile),
      };
      const best = x.ghost && num(x.ghost.km) > 0 ? num(x.ghost.km) : null;
      if (best != null) d.record = { bestKm: r3(best) };
      if (!run) run = d.run;
      return d;
    }

    function addSamples(list) {
      const t = num(now());
      let fresh = null;
      let added = false;
      for (const [ms, bpm] of cleanSamples(list)) {
        const k = Math.round(ms / 1000);
        if (secs.has(k)) continue;
        secs.add(k);
        samples.push([ms, bpm]);
        added = true;
        if (t - ms <= LIVE_HR_AGE_MS && (!fresh || ms > fresh.at)) fresh = { bpm, at: ms, rx: t };
      }
      if (added) {
        samples.sort((a, b) => a[0] - b[0]);
        if (samples.length > MAX_SAMPLES) {
          samples = samples.slice(-MAX_SAMPLES);
          secs = new Set(samples.map((p) => Math.round(p[0] / 1000)));
        }
      }
      if (fresh && (!last || fresh.at >= last.at)) {
        last = fresh;
        try { o.onHr?.(last); } catch { /* nada */ }
      }
    }

    /* ───────── Órdenes ───────── */

    const call = (fn, ...args) => {
      const f = cmds[fn];
      if (typeof f !== 'function') return undefined;
      return f(...args);
    };

    /**
     * gate(kind, audioLive) → motivo para no empezar ('begin': la cuenta 3-2-1 de salida) ni reanudar ('resume') o null.
     * Pausar, saltar, voz, volumen… nunca pasan por aquí: con el iPhone bloqueado y la clase en marcha siguen funcionando.
     */
    function command(d, gate = () => null) {
      const name = String(d?.name || '');
      const s = es();
      const x = xs();
      const stt = s?.status || null;
      const live = stt === 'running' || stt === 'paused';
      const busy = !!x.countingDown || !!x.finale;
      const done = finished || !!x.finished || stt === 'finished';
      const NO = (reason) => ({ ok: false, reason });
      const OK = { ok: true };
      // Reanudar con la página oculta solo vale si el audio sigue vivo (pausa normal: el AudioContext sigue en marcha);
      // tras recuperar la clase con la página recargada, no: no podría arrancar hasta desbloquear el iPhone.
      const audioLive = x.audioLive !== false;
      const kindOf = () => (!s || stt === 'ready' ? 'begin' : 'resume');
      switch (name) {
        case 'start': {
          if (busy) return NO('busy');
          if (done) return NO('busy');
          if (stt === 'running') return OK;
          const no = gate(kindOf(), audioLive);
          if (no) return NO(no);
          if (!s) { call('start'); return OK; }
          call('toggle');
          return OK;
        }
        case 'toggle':
        case 'pause':
        case 'resume': {
          if (busy) return NO('busy');
          if (done) return NO('no-class');
          if (!s && name !== 'toggle') return NO('no-class');
          if (name === 'pause' && stt !== 'running') return OK;
          if (name === 'resume' && stt === 'running') return OK;
          if (stt !== 'running') {
            const no = gate(kindOf(), audioLive);
            if (no) return NO(no);
          }
          if (!s) { call('start'); return OK; }
          call('toggle');
          return OK;
        }
        case 'skip': {
          const dir = Number(d.dir);
          if (dir !== 1 && dir !== -1) return NO('bad-args');
          if (busy) return NO('busy');
          if (!live || done) return NO('no-class');
          if (s.inTestStage) return NO('test-stage');
          if (dir > 0 && s.segIndex >= s.segCount - 1) return NO('last');
          const r = call('skip', dir);
          return r === false ? NO('busy') : OK;
        }
        case 'endTest':
          if (!live || done) return NO('no-class');
          if (!workout.isTest || !s.inTestStage) return NO('unsupported');
          return call('endTest') === false ? NO('unsupported') : OK;
        case 'end':
          if (done || !s) return NO('no-class');
          if (busy) return NO('busy');
          if (d.save === false) call('discard');
          else call('finish');
          return OK;
        case 'voice': {
          if (!s || done) return NO('no-class');
          const want = typeof d.on === 'boolean' ? d.on : !!x.muted;
          if (want === !x.muted) return OK;
          call('voice');
          return OK;
        }
        case 'nextSong':
          if (!x.appMusic) return NO('own-music');
          if (!x.musicOn || !x.np) return NO('music-off');
          if (!x.canSkip) return NO('unsupported');
          return call('nextSong') === false ? NO('music-off') : OK;
        case 'intensity': {
          const delta = Number(d.delta);
          if (!Number.isFinite(delta) || Math.abs(Math.abs(delta) - 0.1) > 1e-6) return NO('bad-args');
          if (busy) return NO('busy');
          if (!live || done) return NO('no-class');
          if (s.inTestStage) return NO('test-stage');
          return call('adjust', delta > 0 ? 1 : -1) ? OK : NO('limit');
        }
        case 'volume': {
          const v = d.value;
          if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) return NO('bad-args');
          if (!x.appMusic) return NO('own-music');
          if (!x.musicOn) return NO('music-off');
          call('volume', r2(v));
          return OK;
        }
        default:
          return NO('unknown');
      }
    }

    /* ───────── API para player.js ───────── */

    const api = {
      /** Preparación en pantalla. */
      ready() {
        out(() => post('class.ready', classReady()));
        pushState(true);
      },
      /** «Empezar» (arranca la cuenta 3-2-1). */
      prepare() {
        out(() => post('class.prepare', { classId, title, totalSec: int(es()?.totalSec || workout.totalSec) }));
      },
      /** Clase restaurada (#/play/resume): class.start con resumed:true. */
      resumed(st) {
        noteRun(st || es());
        out(() => post('class.start', classStart(true)));
        pushState(true);
      },
      /** El motor arrancó (evento 'start'). */
      started() {
        noteRun(es());
        out(() => post('class.start', classStart(false)));
        pushState(true);
      },
      /** Cada cifra de la cuenta 3-2-1 de salida o de reanudación (n = 3, 2, 1, 0 = «¡Ya!»). */
      countdown(n, phase = 'start', goAt = null) {
        if (detached) return;
        const s = es();
        if (Number.isFinite(Number(goAt)) && Number(goAt) > 0) cdGoAt = Math.round(Number(goAt));
        if (cdGoAt == null) cdGoAt = Math.round(num(now()) + Math.max(0, num(n)) * 1000);
        const ph = phase === 'resume' ? 'resume' : 'start';
        const seg = s?.segment || workout.segments?.[0] || null;
        event({ name: 'countdown', phase: ph, n: int(n), seg: int(s?.segIndex), dir: ph === 'start' ? 'up' : 'same', kmh: round1(num(seg?.speed)), goAt: cdGoAt });
        if (int(n) <= 0) cdGoAt = null;
        pushState(false);
      },
      /** Tick del motor (4 Hz): cuenta atrás de fin de tramo, pista nueva y `state`. */
      tick(s) {
        if (detached || !s) return;
        noteRun(s);
        if (s.status === 'running') {
          const next = s.nextSegment;
          if (s.segIndex !== cdSeg) { cdSeg = s.segIndex; cdLast = 4; }
          const left = num(s.segRemaining);
          const k = Math.ceil(left - 1e-6);
          if (next && k >= 1 && k <= 3 && k < cdLast) {
            cdLast = k;
            event({
              name: 'countdown', phase: 'segment', n: k, seg: int(s.segIndex) + 1, dir: dirOf(s.currentSpeed, next.speed),
              kmh: round1(num(next.speed)), goAt: Math.round(num(now()) + left * 1000),
            });
          }
          lastKmh = num(s.currentSpeed);
        }
        const x = xs();
        const np = x.appMusic && x.musicOn && isObj(x.np) ? x.np : null;
        const tk = np ? String(np.trackId || np.title || '') : '';
        if (tk && tk !== lastTrack) {
          const ev = { name: 'track', title: String(np.title || '') };
          if (np.artist) ev.artist = String(np.artist);
          if (num(np.bpm) > 0) ev.bpm = Math.round(num(np.bpm));
          if (lastTrack || s.status === 'running') event(ev);
        }
        lastTrack = tk;
        pushState(false);
      },
      /** Cambio de tramo del motor (no se avisa si es silencioso: saltos encadenados). */
      segment(s, info = {}) {
        if (detached || !s) return;
        noteRun(s);
        if (!info?.silent && s.segment) {
          const kmh = num(s.currentSpeed, num(s.segment.speed));
          const reason = ['start', 'auto', 'skip', 'restart', 'test'].includes(info?.reason) ? info.reason : 'auto';
          event({
            name: 'segment', i: int(s.segIndex), prev: int(info?.prevIndex ?? -1), reason, zone: String(s.segment.zone),
            kmh: round1(kmh), dir: reason === 'start' ? 'up' : dirOf(lastKmh ?? kmh, kmh),
          });
          lastKmh = kmh;
        }
        cdSeg = s.segIndex;
        cdLast = 4;
        pushState(false);
      },
      /** Eventos del motor: start, pause, resume, halfway, km, adjust, testEnd (segment/finish van aparte). */
      event(type, data = {}) {
        if (detached) return;
        const dd = isObj(data) ? data : {};
        if (type === 'start') { api.started(); return; }
        if (type === 'pause' || type === 'resume' || type === 'halfway') event({ name: type });
        else if (type === 'km' && !dd.silent) {
          const ev = { name: 'km', km: num(dd.km) };
          if (dd.pace) ev.pace = String(dd.pace);
          event(ev);
        } else if (type === 'adjust') {
          event({ name: 'adjust', i: int(dd.index ?? es()?.segIndex), zone: String(dd.zone || ''), kmh: round1(num(dd.speed)), delta: round1(num(dd.delta)), total: round1(num(dd.total)) });
        } else if (type === 'testEnd') {
          const ev = { name: 'testEnd' };
          if (num(dd.test?.vam) > 0) ev.vam = r2(num(dd.test.vam));
          event(ev);
        } else return;
        pushState(false);
      },
      /** Récord: 'overtake' (pasas a ir delante; máx. 1 cada 45 s) o 'beaten' (superas su distancia; 1 vez). */
      record(kind, d) {
        if (detached) return;
        const t = num(now());
        if (kind === 'overtake') {
          if (t - overtakeAt < OVERTAKE_GAP_MS) return;
          overtakeAt = t;
          event({ name: 'record.overtake', d: int(d) });
        } else if (kind === 'beaten') {
          if (beatenSent) return;
          beatenSent = true;
          const g = xs().ghost;
          const ev = { name: 'record.beaten' };
          if (g && num(g.km) > 0) ev.bestKm = r3(num(g.km));
          const s = es();
          if (s) ev.km = r3(num(s.distanceKm));
          event(ev);
        } else return;
        pushState(false);
      },
      /** Campos de pulso para la sesión (antes de guardarla). Con < 3 lecturas, ninguno. */
      hrFields(session, profile) {
        if (samples.length < 3) return {};
        const res = hrFromSamples(samples, session);
        if (!res) return {};
        return { ...hrFieldsFrom(res, profile || {}), hrSource: 'watch-live', hrSamples: res.samples };
      },
      /** Clase terminada (guardada o no). */
      finish(session, { saved = true } = {}) {
        if (detached || !session) return;
        finished = true;
        const g = xs().ghost;
        const km = num(session.distanceKm);
        const d = {
          run: run || String(session.startedAt || new Date(num(now())).toISOString()),
          classId, startedAt: String(session.startedAt || ''), endedAt: String(session.endedAt || new Date(num(now())).toISOString()),
          saved: !!saved, completed: !!session.completed, finishedEarly: !!session.finishedEarly,
          elapsedSec: int(session.elapsedSec), pausedSec: int(session.pausedSec), km: r3(km), kcal: int(session.kcal),
          avgKmh: round1(num(session.avgSpeed)), maxKmh: round1(num(session.maxSpeed)),
        };
        if (session.id) d.sessionId = String(session.id);
        if (g && num(g.km) > 0) d.record = { beaten: km > num(g.km), m: Math.round((km - num(g.km)) * 1000) };
        out(() => post('class.end', d));
        pushState(true);
        if (saved) out(() => sendBackup());
      },
      /** Clase descartada: 'user' (Descartar) o 'short' (demasiado corta para guardarla). */
      discard(reason = 'user') {
        if (detached) return;
        finished = true;
        const d = { classId, reason: reason === 'short' ? 'short' : 'user' };
        if (run) d.run = run;
        out(() => post('class.discard', d));
      },
      /** Lecturas de pulso de esta clase ([[ms, bpm]]), para la instantánea (hrLive). */
      samples() {
        return samples.map((p) => [p[0], p[1]]);
      },
      /** Recupera las lecturas de la instantánea al retomar la clase. */
      restore(list) {
        if (!Array.isArray(list) || !list.length) return;
        const t = last;
        addSamples(list);
        last = t; // lo restaurado no es pulso «en directo»
      },
      /** Última lectura si llegó hace ≤ 15 s: { bpm, at }; si no, null. */
      liveHr() {
        if (!last || num(now()) - last.rx > LIVE_HR_MS) return null;
        return { bpm: last.bpm, at: last.at };
      },
      /** ¿El reloj lo lleva la app nativa? (emparejado y con BestRunning instalada) */
      watchManaged() {
        const w = status?.watch;
        return !!(w && w.paired && w.installed);
      },
      /** Con el reloj en la app: ¿falta permiso de Salud para su pulso? null | 'prompt' | 'denied' */
      healthMissing() {
        return api.watchManaged() ? healthMissingOf(status) : null;
      },
      /** El reproductor se desmonta: state idle y fuera. */
      detach() {
        if (detached) return;
        gateQ.length = 0;
        post('state', { status: 'idle' });
        detached = true;
        if (deferT) timers.clearTimeout(deferT);
        if (hb) timers.clearInterval(hb);
        deferT = hb = null;
        // El pulso de una clase que llegó a arrancar se guarda (para fundirlo con el resumen de Salud)
        if (run) keepRun(run, samples);
        if (adapter && adapter.api === api) adapter = null;
      },
    };

    hb = timers.setInterval(() => pushState(false), STATE_RUN_MS);
    restoreRunSamples();

    function restoreRunSamples() {
      // Pulso que llegó sin reproductor (p. ej. la página se recargó a mitad de clase y el iPhone lo repitió)
      const pre = runSamples.get('_');
      if (pre?.length) { runSamples.delete('_'); addSamples(pre); }
    }

    return {
      api,
      command,
      pushState,
      addSamples,
      samples: () => api.samples(),
      detached: () => detached,
      acceptsRun: (r) => {
        if (detached) return false;
        if (!r) return true;
        noteRun(es());
        return !run || r === run;
      },
    };
  }

  return {
    init,
    destroy,
    receive,
    post,
    on,
    attachPlayer,
    requestBackup,
    sendToday,
    nativeStatus: () => (status ? { ...status } : null),
    isNative: native,
    /** Para tests: espera a que carguen planner/templates y al último «today». */
    ready: () => loadLibs().then(() => todayP),
    get boot() { return boot; },
    get seq() { return seq; },
  };
}

/* ═════════════════ Instancia por defecto (la de la app) ═════════════════ */

let bridge = null;
let storeMod = null;
const lazyStore = {
  getState: () => storeMod?.getState?.() ?? null,
  setState: (fn) => storeMod?.setState?.(fn),
  subscribe: (fn) => storeMod?.subscribe?.(fn) ?? null,
  importState: (json) => storeMod?.importState?.(json) ?? false,
  exportState: () => storeMod?.exportState?.() ?? '',
  loadActiveSession: () => storeMod?.loadActiveSession?.() ?? null,
  activeSessionSavedAt: () => storeMod?.activeSessionSavedAt?.() ?? null,
};
const defaultBridge = () => (bridge ||= createNativeBridge({ store: lazyStore }));

/** ¿Estamos dentro de la app nativa? Se mira en cada llamada (sin caché). */
export function isNative() {
  try {
    return !!globalThis.window?.webkit?.messageHandlers?.[HANDLER];
  } catch {
    return false;
  }
}

/**
 * Arranca el puente (app.js, solo en la app nativa): window.BRNative, hello, today y suscripción al estado.
 * opts: { navigate, app (versión de la web) } · → Promise<boolean>
 */
export function initNativeBridge(opts = {}) {
  if (!isNative()) return Promise.resolve(false);
  return import('../core/store.js')
    .then((m) => { storeMod = m; })
    .catch(() => {})
    .then(() => defaultBridge().init(opts));
}

/** Engancha el reproductor. En Safari (o sin opts) devuelve un adaptador vacío. */
export function attachPlayer(opts) {
  if (!opts || !isNative()) return NOOP_ADAPTER;
  return defaultBridge().attachPlayer(opts);
}

/** Escucha un tipo de mensaje del iPhone ('*' = todos). → función para dejar de escuchar. */
export function on(type, cb) {
  if (!isNative()) return noop;
  return defaultBridge().on(type, cb);
}

/** Último estado de la app nativa (reloj, Salud, copia) o null. */
export function nativeStatus() {
  if (!isNative() || !bridge) return null;
  return bridge.nativeStatus();
}

/** Publica un mensaje para la app nativa. false en Safari. */
export function post(type, data = {}, id = undefined) {
  if (!isNative()) return false;
  return defaultBridge().post(type, data, id);
}

/** Pide al iPhone la última copia de los datos. → Promise<{ savedAt, json }>. */
export function requestNativeBackup() {
  if (!isNative()) return Promise.reject(new Error('no-native'));
  return defaultBridge().requestBackup();
}
