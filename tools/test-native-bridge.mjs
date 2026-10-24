#!/usr/bin/env node
// BestRunning · pruebas del puente con la app nativa (iPhone + Apple Watch, protocolo v1): js/integrations/native-bridge.js.
// Ventana falsa con window.webkit.messageHandlers.bestrunning, reloj y temporizadores falsos, estado en memoria y el
// motor real (createEngine con autoTick:false). Cubre cada tipo de mensaje y cada orden del reloj.
// Uso: TZ=Europe/Madrid node tools/test-native-bridge.mjs [--write-fixtures]
//   --write-fixtures  regenera tools/native-fixtures/*.json con la salida real del puente (y los ejemplos de la
//                     especificación para los mensajes que no salen de la página).
// Sale con código ≠ 0 si algo falla.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.TZ) process.env.TZ = 'Europe/Madrid';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIX_DIR = join(ROOT, 'tools', 'native-fixtures');
const NATIVE_FIX_DIR = join(ROOT, 'native', 'Fixtures');
const WRITE = process.argv.includes('--write-fixtures');

if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, o = {}) { super(type); this.detail = o.detail; }
  };
}
// Sin ventana al importar: el módulo no debe tocar nada al cargarse
delete globalThis.window;

const NB = await import('../js/integrations/native-bridge.js');
const { createEngine, buildSession } = await import('../js/player/engine.js');
const { defaultState } = await import('../js/core/store.js');
const { hrTargetForZone, hrZones } = await import('../js/training/levels.js');
const W = await import('../js/integrations/watch-hr.js');
const PL = await import('../js/training/planner.js');
const { todayKey, addDays } = await import('../js/core/utils.js');

let pass = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) pass++;
  else fails.push(msg);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;
function section(name, fn) {
  return Promise.resolve().then(fn).catch((err) => { fails.push(`${name}: excepción ${err?.stack || err}`); });
}

/* ═════════════════ Esquema de Wire.swift (§3.6): tipos, obligatorios y enteros ═════════════════ */

const opt = (t) => ({ opt: true, t });
const arr = (t) => ({ arr: t });
const SEG = { sec: 'int', kmh: 'num', zone: 'str' };
const HRZ = { z: 'int', min: 'int', max: 'int' };
const SCHEMA = {
  hello: { proto: 'int', app: 'str', build: opt('str'), caps: opt(arr('str')) },
  today: {
    date: 'str', status: 'str', classId: opt('str'), href: opt('str'), title: opt('str'), category: opt('str'),
    categoryLabel: opt('str'), categoryColor: opt('str'), minutes: opt('int'), estKm: opt('num'), recordKm: opt('num'),
    segments: arr(SEG), next: opt({ label: 'str', minutes: opt('int'), title: opt('str') }), weekDone: 'int', weekPlanned: 'int',
    reminder: opt('str'), hrZones: arr(HRZ),
  },
  'class.ready': {
    classId: 'str', title: 'str', category: opt('str'), categoryLabel: opt('str'), categoryColor: opt('str'), minutes: opt('int'),
    totalSec: 'int', firstKmh: 'num', firstZone: 'str', recordKm: opt('num'),
  },
  'class.prepare': { classId: 'str', title: 'str', totalSec: 'int' },
  'class.start': {
    run: 'str', classId: 'str', title: 'str', category: opt('str'), categoryLabel: opt('str'), categoryColor: opt('str'),
    isTest: 'bool', totalSec: 'int', resumed: 'bool', segments: arr(SEG), record: opt({ bestKm: 'num' }), hrZones: arr(HRZ),
  },
  state: {
    status: 'str', run: opt('str'), classId: opt('str'), title: opt('str'), isTest: opt('bool'), inTestStage: opt('bool'),
    seg: opt({
      i: 'int', n: 'int', zone: 'str', label: 'str', short: 'str', kmh: 'num', incline: opt('num'), sec: 'int', left: 'num',
      endAt: opt('int'), adj: 'num', sub: opt('str'),
    }),
    next: opt({ zone: 'str', label: 'str', kmh: 'num', sec: 'int', dir: 'str' }),
    elapsed: opt('num'), remaining: opt('num'), total: opt('int'), km: opt('num'), kcal: opt('int'), avgKmh: opt('num'),
    hrTarget: opt(HRZ), hrUsual: opt({ lo: 'int', hi: 'int' }), record: opt({ d: 'int', side: 'int', bestKm: 'num', beaten: 'bool' }),
    voice: opt('bool'),
    music: opt({ on: 'bool', app: 'bool', title: opt('str'), artist: opt('str'), bpm: opt('num'), volume: 'num', canSkip: 'bool' }),
  },
  event: {
    name: 'str', phase: opt('str'), n: opt('int'), seg: opt('int'), dir: opt('str'), kmh: opt('num'), goAt: opt('int'), i: opt('int'),
    prev: opt('int'), reason: opt('str'), zone: opt('str'), delta: opt('num'), total: opt('num'), km: opt('num'), pace: opt('str'),
    d: opt('int'), bestKm: opt('num'), title: opt('str'), artist: opt('str'), bpm: opt('num'), vam: opt('num'),
  },
  'class.end': {
    run: 'str', sessionId: opt('str'), classId: 'str', startedAt: 'str', endedAt: 'str', saved: 'bool', completed: 'bool',
    finishedEarly: 'bool', elapsedSec: 'int', pausedSec: 'int', km: 'num', kcal: 'int', avgKmh: 'num', maxKmh: 'num',
    record: opt({ beaten: 'bool', m: 'int' }),
  },
  'class.discard': { run: opt('str'), classId: 'str', reason: 'str' },
  ack: { ref: 'str', id: 'str', ok: 'bool', reason: opt('str') },
  cmd: { name: 'str', from: 'str', dir: opt('int'), delta: opt('num'), value: opt('num'), on: opt('bool'), save: opt('bool'), classId: opt('str') },
  hr: { run: opt('str'), samples: arr(arr('num')), replay: opt('bool') },
  'workout.summary': {
    run: opt('str'), sessionId: opt('str'), startedAt: 'num', endedAt: 'num', uuid: opt('str'), kcalActive: opt('int'), hrAvg: opt('int'),
    hrMax: opt('int'), hrMin: opt('int'), samples: arr(arr('num')), source: 'str',
  },
  'watch.workout': { state: 'str', run: opt('str'), startedAt: opt('num'), source: opt('str') },
  'phone.status': { page: 'str', fg: 'bool', classActive: 'bool' },
  sync: {},
  'native.hello': {
    proto: opt('int'), app: opt('str'),
    watch: { paired: 'bool', installed: 'bool', reachable: 'bool', link: 'str', workout: 'str', run: opt('str') },
    health: { auth: 'str', hr: opt('str') }, backup: opt({ savedAt: 'num', sessions: 'int', bytes: 'int' }),
    caps: opt(arr('str')), // build 6: lo que sabe hacer la app (solo en native.hello)
    aiReason: opt('str'), // build 9: por qué no hay IA del iPhone (sin 'ai' en caps)
  },
  backup: { savedAt: 'num', sessions: 'int', json: 'str' },
  'backup.get': {},
  'backup.data': { ref: 'str', savedAt: 'num', json: 'str' },
  'health.authorize': {},
  'audio.session': { type: 'str' },
  'audio.kick': { reason: 'str' },
  haptic: { style: opt('str') }, // build 6: vibración de iOS (js/core/haptics.js → BRNative.post)
  // build 9: Salud para el semáforo de fatiga, IA del iPhone y avisos de la mañana (js/integrations/ai.js)
  'health.metrics.get': { days: opt('int') },
  'health.metrics': { resting: arr('any'), hrv: arr('any'), wristTemp: opt(arr('any')), wristTempAbsolute: opt('bool'), respiratory: opt(arr('any')), at: 'num' },
  'ai.request': { id: 'str', task: 'str', input: 'obj' },
  'ai.result': { id: 'str', task: opt('str'), ok: 'bool', output: opt('obj'), error: opt('str'), message: opt('str') },
  'notify.config': { enabled: 'bool', weekdayTime: 'str', weekendTime: 'str', preRun: 'bool', preRunTime: 'str', thursdayPreRunTime: opt('str') },
  'notify.status': { authorized: 'bool', enabled: 'bool' },
  'plan.days': { days: arr({ dayKey: 'str', title: 'str', minutes: 'int', category: 'str', rest: 'bool', segments: opt(arr('any')) }) },
  // RITMUP Pro (StoreKit 2): la página abre la hoja de la suscripción; el iPhone manda el estado (solo con 'store' en caps)
  'store.show': { from: opt('str') },
  'store.status': { pro: 'bool', product: opt('str'), expires: opt('int'), trial: 'bool', available: 'bool' },
};
SCHEMA['native.status'] = SCHEMA['native.hello'];
const PAGE_TYPES = ['hello', 'today', 'class.ready', 'class.prepare', 'class.start', 'state', 'event', 'class.end', 'class.discard', 'ack',
  'backup', 'backup.get', 'health.authorize', 'audio.session', 'haptic', 'health.metrics.get', 'ai.request', 'notify.config', 'plan.days',
  'store.show'];
const PRO_PRODUCTS = ['com.nachogarcia.bestrunning.pro.mensual', 'com.nachogarcia.bestrunning.pro.anual'];
const HAPTIC_STYLES = ['light', 'medium', 'heavy', 'soft', 'rigid', 'selection', 'success', 'warning', 'error'];
const ID_REQUIRED = new Set(['cmd', 'workout.summary', 'backup.get']);
// Decimales máximos (§3.1): km/h 1 · km 3 · left/elapsed/remaining 1 · volumen 2
const DECIMALS = {
  today: { 'segments[].kmh': 1, estKm: 3, recordKm: 3 },
  'class.ready': { firstKmh: 1, recordKm: 3 },
  'class.start': { 'segments[].kmh': 1, 'record.bestKm': 3 },
  state: { 'seg.kmh': 1, 'seg.left': 1, 'seg.adj': 1, 'next.kmh': 1, elapsed: 1, remaining: 1, km: 3, avgKmh: 1, 'record.bestKm': 3, 'music.volume': 2 },
  event: { kmh: 1, delta: 1, total: 1, bestKm: 3, km: 3 },
  'class.end': { km: 3, avgKmh: 1, maxKmh: 1 },
};

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
function checkVal(spec, v, p, errs) {
  if (spec === 'int') { if (!Number.isInteger(v)) errs.push(`${p}: debe ser entero (${v})`); return; }
  if (spec === 'num') { if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(`${p}: debe ser número (${v})`); return; }
  if (spec === 'str') { if (typeof v !== 'string') errs.push(`${p}: debe ser texto`); return; }
  if (spec === 'bool') { if (typeof v !== 'boolean') errs.push(`${p}: debe ser booleano`); return; }
  if (spec === 'obj') { if (!isObj(v)) errs.push(`${p}: debe ser objeto`); return; } // contenido libre (entrada y salida de la IA)
  if (spec === 'any') return; // [dayKey, número] y tramos [zona, s]: listas mixtas
  if (spec && spec.arr) {
    if (!Array.isArray(v)) { errs.push(`${p}: debe ser lista`); return; }
    v.forEach((x, i) => checkVal(spec.arr, x, `${p}[${i}]`, errs));
    return;
  }
  validateObj(spec, v, p, errs);
}
function validateObj(schema, data, path, errs) {
  if (!isObj(data)) { errs.push(`${path}: debe ser objeto`); return; }
  for (const k of Object.keys(data)) if (!(k in schema)) errs.push(`${path}.${k}: no existe en Wire.swift`);
  for (const [k, s0] of Object.entries(schema)) {
    const optional = !!s0?.opt;
    const spec = optional ? s0.t : s0;
    const v = data[k];
    if (v == null) { if (!optional) errs.push(`${path}.${k}: obligatorio`); continue; }
    checkVal(spec, v, `${path}.${k}`, errs);
  }
}
function pick(obj, path) {
  const parts = path.split('.');
  let cur = [obj];
  for (const part of parts) {
    const isArr = part.endsWith('[]');
    const key = isArr ? part.slice(0, -2) : part;
    cur = cur.flatMap((o) => {
      const v = o?.[key];
      if (v == null) return [];
      return isArr ? (Array.isArray(v) ? v : []) : [v];
    });
  }
  return cur;
}
const decOk = (v, d) => Math.abs(v * 10 ** d - Math.round(v * 10 ** d)) < 1e-6;
/** Errores de un sobre completo (cabecera + datos según su tipo). */
function envErrors(env) {
  const errs = [];
  if (env.v !== 1) errs.push('v ≠ 1');
  if (typeof env.type !== 'string') errs.push('type');
  if (!Number.isInteger(env.seq) || env.seq < 1) errs.push(`seq ${env.seq}`);
  if (typeof env.boot !== 'string' || !/^[jpw][a-z0-9]{5,6}$/.test(env.boot)) errs.push(`boot ${env.boot}`);
  if (!Number.isInteger(env.at)) errs.push(`at ${env.at}`);
  if (ID_REQUIRED.has(env.type) && !env.id) errs.push('id obligatorio');
  const schema = SCHEMA[env.type];
  if (!schema) errs.push(`tipo desconocido ${env.type}`);
  else validateObj(schema, env.data, env.type, errs);
  for (const [path, d] of Object.entries(DECIMALS[env.type] || {})) {
    for (const v of pick(env.data, path)) if (typeof v === 'number' && !decOk(v, d)) errs.push(`${env.type}.${path}: más de ${d} decimales (${v})`);
  }
  return errs;
}

/* ═════════════════ Entorno falso: reloj, temporizadores, estado en memoria ═════════════════ */

const clock = { t: Date.UTC(2026, 9, 19, 5, 2, 11, 123) }; // lunes 19 oct 2026, 7:02:11 en Madrid
const now = () => clock.t;
PL.setPlannerToday(todayKey(new Date(clock.t)));

function makeTimers() {
  let seq = 0;
  const q = new Map();
  return {
    setTimeout(fn, ms) { const k = ++seq; q.set(k, { at: clock.t + Math.max(0, ms), fn }); return k; },
    clearTimeout(k) { q.delete(k); },
    setInterval(fn, ms) { const k = ++seq; q.set(k, { at: clock.t + ms, fn, every: Math.max(1, ms) }); return k; },
    clearInterval(k) { q.delete(k); },
    run() {
      for (let guard = 0; guard < 10000; guard++) {
        let best = null;
        for (const [k, v] of q) if (v.at <= clock.t && (!best || v.at < best[1].at)) best = [k, v];
        if (!best) return;
        const [k, v] = best;
        if (v.every) v.at += v.every; else q.delete(k);
        v.fn();
      }
    },
    size: () => q.size,
  };
}

function makeStore(initial) {
  let state = structuredClone(initial);
  const subs = new Set();
  let sets = 0;
  return {
    getState: () => state,
    setState(fn) {
      const d = structuredClone(state);
      fn(d);
      state = d;
      sets++;
      for (const s of [...subs]) s(state);
      return state;
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    importState(json) {
      try { const { app, exportedAt, ...rest } = JSON.parse(json); state = rest; for (const s of [...subs]) s(state); return true; } catch { return false; }
    },
    exportState: () => JSON.stringify({ app: 'BestRunning', exportedAt: new Date(clock.t).toISOString(), ...state }),
    loadActiveSession: () => null,
    activeSessionSavedAt: () => null,
    sets: () => sets,
  };
}

/* Clase sintética y sesiones previas con pulso (para hrUsual y el récord) */
const LEVELS = { jog: 8.3, run: 12.0, fast: 13.0, sprint: 14.0 };
function mkWorkout(segments, extra = {}) {
  const totalSec = segments.reduce((a, s) => a + s.sec, 0);
  return {
    id: `test-tpl~${Math.round(totalSec / 60)}~1~100`, templateId: 'test-tpl', title: 'Clase de prueba', category: 'endurance',
    minutes: Math.round(totalSec / 60), totalSec, segments, isTest: false, ...extra,
  };
}
const W1 = mkWorkout([
  { zone: 'warmup', speed: 6.5, incline: 0, sec: 60, label: 'Calentamiento' },
  { zone: 'run', speed: 12.0, incline: 0, sec: 300, label: 'Correr' },
  { zone: 'fast', speed: 13.0, incline: 0, sec: 30, label: 'Correr rápido' },
  { zone: 'jog', speed: 8.3, incline: 0, sec: 60, label: 'Trotar' },
  { zone: 'fast', speed: 13.0, incline: 0, sec: 30, label: 'Correr rápido' },
  { zone: 'cooldown', speed: 6.0, incline: 0, sec: 60, label: 'Vuelta a la calma' },
]);
const W_TEST = mkWorkout([
  { zone: 'warmup', speed: 6.5, incline: 0, sec: 60, label: 'Calentamiento' },
  { zone: 'jog', speed: 8.0, incline: 0, sec: 60, label: 'Escalón 1', stage: 1 },
  { zone: 'run', speed: 8.5, incline: 0, sec: 60, label: 'Escalón 2', stage: 2 },
  { zone: 'run', speed: 9.0, incline: 0, sec: 60, label: 'Escalón 3', stage: 3 },
  { zone: 'cooldown', speed: 6.0, incline: 0, sec: 60, label: 'Vuelta a la calma' },
], { id: 'test-vam~5~1~100', templateId: 'test-vam', title: 'Test VAM', category: 'test', isTest: true });

const GHOST_TRACE = [[0, 6.0], [540, 6.0]];
function ghostOf(trace, km) {
  const times = [];
  const cum = [];
  let acc = 0;
  trace.forEach((p, i) => {
    if (i > 0) acc += (trace[i - 1][1] * Math.max(0, p[0] - trace[i - 1][0])) / 3600;
    times.push(p[0]);
    cum.push(acc);
  });
  return { trace, base: trace, label: 'Tu mejor marca', km, times, cum };
}
const GHOST = ghostOf(GHOST_TRACE, 0.9);

function pastSession(i, base) {
  const start = base - (i + 1) * 86400e3;
  const trace = [[0, 6.5], [60, 6.5], [60, 12.0], [360, 12.0], [360, 6.0], [540, 6.0]];
  const hrSeries = [];
  for (let t = 0; t <= 540; t += 10) hrSeries.push([t, t < 60 ? 110 : t < 360 ? 150 + i * 2 : 120]);
  return {
    id: `ses_old${i}`, workoutId: W1.id, templateId: W1.templateId, title: W1.title, category: 'endurance',
    startedAt: new Date(start).toISOString(), dayKey: todayKey(new Date(start)), plannedSec: 540, elapsedSec: 540, completed: true,
    completionPct: 1, distanceKm: 0.9, avgSpeed: 6, maxSpeed: 12, kcal: 90, speedTrace: trace, hrSeries, hrAvg: 140, hrMax: 160,
    levelsAtStart: { ...LEVELS },
  };
}
function baseState() {
  const st = defaultState();
  return {
    ...st, onboarded: true, createdAt: '2026-10-01T08:00:00.000Z', plan: { startDate: '2026-09-28', overrides: {} },
    levels: { ...LEVELS }, history: [pastSession(0, clock.t), pastSession(1, clock.t), pastSession(2, clock.t)],
  };
}

function makeHandler(posted) {
  return { postMessage: (s) => { if (typeof s !== 'string') throw new Error('postMessage sin texto'); posted.push(s); } };
}
function installWindow(handler, { events = false } = {}) {
  const et = events ? new EventTarget() : null;
  globalThis.window = {
    webkit: { messageHandlers: { bestrunning: handler } },
    addEventListener: et ? et.addEventListener.bind(et) : () => {},
    removeEventListener: et ? et.removeEventListener.bind(et) : () => {},
    dispatchEvent: et ? et.dispatchEvent.bind(et) : () => true,
  };
}

/** Entorno completo: puente de fábrica con su manejador, estado, reloj y temporizadores falsos. */
function newEnv({ state = baseState(), init = true, visible = undefined } = {}) {
  const posted = [];
  const handler = makeHandler(posted);
  installWindow(handler);
  const timers = makeTimers();
  const store = makeStore(state);
  const events = [];
  const navs = [];
  const B = NB.createNativeBridge({
    handler: () => handler, now, store, timers, expose: false,
    navigate: (h) => navs.push(h),
    dispatch: (name, detail) => events.push({ name, detail }),
    app: '1.4.0-test',
    ...(visible ? { visible } : {}),
  });
  if (init) B.init({ app: '1.4.0-test' });
  const all = () => posted.map((s) => JSON.parse(s));
  return {
    posted, handler, timers, store, events, navs, B, all,
    since: (i) => posted.slice(i).map((s) => JSON.parse(s)),
    ofType: (t, from = 0) => posted.slice(from).map((s) => JSON.parse(s)).filter((m) => m.type === t),
    mark: () => posted.length,
  };
}

/** Reproductor mínimo: lo mismo que hace player.js con el adaptador (callbacks del motor, extras y órdenes). */
function harness(env, workout, { ghost = null, treadmill = { minSpeed: 1, maxSpeed: 13 }, appMusic = true } = {}) {
  const P = {
    engine: null, muted: false, musicOn: true, appMusic, countingDown: false, finale: false, finished: false,
    np: appMusic ? { trackId: 't1', title: 'Better Machine', artist: 'Conathor', bpm: 128 } : null, vol: undefined,
    ghost, ghostSide: 0, canSkip: true, calls: [], session: null, discarded: null, audioLive: undefined,
  };
  const cb = {
    onTick: (s) => P.nb.tick(s),
    onSegment: (s, info) => P.nb.segment(s, info),
    onEvent: (type, data) => { P.nb.event(type, data); if (type === 'finish') finish(data); },
    autoTick: false, now, treadmill, weightKg: 78,
  };
  function finish(s) {
    P.finished = true;
    const session = buildSession(workout, s, { startedAt: s.startedAt });
    session.endedAt = new Date(now()).toISOString();
    session.pausedSec = Math.max(0, Math.round((now() - Date.parse(session.startedAt)) / 1000 - session.elapsedSec));
    session.timeline = P.timeline;
    session.finishedEarly = !!s.finishedEarly;
    Object.assign(session, P.nb.hrFields(session, env.store.getState().profile));
    env.store.setState((d) => { d.history.push(session); });
    P.session = session;
    P.nb.finish(session, { saved: true });
  }
  P.timeline = [];
  P.step = (ms = 250) => {
    clock.t += ms;
    try { P.engine?.tick(); } catch { /* nada */ }
    env.timers.run();
  };
  P.run = (ms, step = 250) => { for (let t = 0; t < ms; t += step) P.step(Math.min(step, ms - t)); };
  P.start = () => {
    P.engine = createEngine(workout, cb);
    P.nb.prepare();
    P.countingDown = true;
    const goAt = now() + 3000;
    for (let n = 3; n >= 0; n--) {
      P.nb.countdown(n, 'start', n === 3 ? goAt : null);
      if (n > 0) { clock.t += 1000; env.timers.run(); }
    }
    P.countingDown = false;
    P.engine.start();
    P.timeline.push([now(), 0, 1]);
  };
  P.nb = env.B.attachPlayer({
    workout, planDate: null, getState: env.store.getState, getEngine: () => P.engine,
    extras: () => ({
      muted: P.muted, musicOn: P.musicOn, appMusic: P.appMusic, countingDown: P.countingDown, finale: P.finale, finished: P.finished,
      np: P.np, vol: P.vol, sub: P.engine ? `Tramo ${P.engine.getState().segIndex + 1}/${P.engine.getState().segCount}` : '',
      ghost: P.ghost, ghostSide: P.ghostSide, canSkip: P.canSkip, audioLive: P.audioLive,
    }),
    commands: {
      start: () => { P.calls.push('start'); P.start(); },
      toggle: () => {
        P.calls.push('toggle');
        const s = P.engine.getState();
        if (s.status === 'running') P.engine.pause();
        else if (s.status === 'paused') P.engine.resume();
        else P.engine.start();
      },
      skip: (dir) => { P.calls.push(`skip:${dir}`); return P.engine.skip(dir); },
      endTest: () => { P.calls.push('endTest'); return P.engine.endTest(); },
      finish: () => { P.calls.push('finish'); P.engine.finish(); },
      discard: () => { P.calls.push('discard'); P.discarded = 'user'; P.nb.discard('user'); },
      voice: () => { P.calls.push('voice'); P.muted = !P.muted; },
      nextSong: () => { P.calls.push('nextSong'); P.np = { trackId: 't2', title: 'Night Drive', artist: 'Lumen', bpm: 126 }; return true; },
      adjust: (dir) => { P.calls.push(`adjust:${dir}`); return P.engine.adjustSpeed(dir * 0.1); },
      volume: (v) => { P.calls.push(`volume:${v}`); P.vol = v; },
    },
  });
  return P;
}

/** Avanza el reloj (sin ticks) hasta que el último state tenga ≥ ms: así un cambio sale al momento. */
function quiet(env, ms = 200) {
  const last = env.ofType('state').pop()?.at ?? 0;
  while (now() - last < ms) clock.t += 10;
}

let cmdSeq = 100;
const cmdEnv = (data, id = `w3f9a0-${++cmdSeq}`) => ({ v: 1, type: 'cmd', seq: cmdSeq, boot: 'w3f9a0', at: now(), id, data: { from: 'watch', ...data } });
const REAL = {};       // salida real del puente para regenerar los fixtures
const keepReal = (name, env) => { if (env && !REAL[name]) REAL[name] = env; };
const VALIDATED = [];  // todos los mensajes que ha publicado la página

/* ═════════════════ 1 · Safari: inerte ═════════════════ */

await section('Safari', async () => {
  ok(typeof globalThis.window === 'undefined', 'Safari: importar el módulo no crea ventana');
  ok(NB.isNative() === false, 'Safari: isNative() es false sin ventana');
  globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
  ok(NB.isNative() === false, 'Safari: isNative() es false sin webkit');
  ok(NB.post('state', { status: 'idle' }) === false, 'Safari: post() devuelve false');
  ok(NB.nativeStatus() === null, 'Safari: nativeStatus() es null');
  ok(typeof NB.on('cmd', () => {}) === 'function', 'Safari: on() devuelve una función');
  ok((await NB.initNativeBridge({ navigate: () => {} })) === false, 'Safari: initNativeBridge no arranca');
  ok(globalThis.window.BRNative === undefined, 'Safari: window.BRNative no existe');
  const a = NB.attachPlayer({ workout: W1, getEngine: () => null });
  const methods = ['ready', 'prepare', 'resumed', 'started', 'countdown', 'tick', 'segment', 'event', 'record', 'hrFields', 'finish', 'discard',
    'samples', 'restore', 'liveHr', 'watchManaged', 'detach'];
  ok(methods.every((m) => typeof a[m] === 'function'), 'Safari: el adaptador vacío tiene todos los métodos');
  let threw = false;
  try {
    a.ready(); a.prepare(); a.resumed({}); a.started(); a.countdown(3, 'start', 1); a.tick({}); a.segment({}, {}); a.event('km', {});
    a.record('overtake', 5); a.finish({}, { saved: true }); a.discard('user'); a.restore([[1, 100]]); a.detach();
  } catch { threw = true; }
  ok(!threw, 'Safari: el adaptador vacío no lanza');
  ok(a.liveHr() === null && a.watchManaged() === false && eq(a.samples(), []) && eq(a.hrFields({}, {}), {}), 'Safari: valores neutros del adaptador vacío');
  ok(NB.attachPlayer(null) === a, 'Safari: attachPlayer(null) da el mismo adaptador vacío');
  const B = NB.createNativeBridge({ handler: () => null, timers: makeTimers(), now, store: makeStore(baseState()) });
  ok(B.post('state', {}) === false && B.init() === false, 'Safari: una fábrica sin manejador no publica ni arranca');
  // isNative() se mira en cada llamada
  installWindow(makeHandler([]));
  ok(NB.isNative() === true, 'isNative() se recalcula en cada llamada');
  delete globalThis.window;
});

/* ═════════════════ 2 · Sobre: hello primero, boot, seq, at, tamaños y enteros ═════════════════ */

await section('Sobre', async () => {
  const env = newEnv({ init: false });
  ok(env.B.post('audio.session', { type: 'playback' }) === true, 'post antes de hello: aceptado (en cola)');
  ok(env.posted.length === 0, 'post antes de hello: no sale aún');
  env.B.init({ app: '1.4.0-test' });
  await env.B.ready();
  const all = env.all();
  ok(all[0]?.type === 'hello', 'hello es el primer mensaje');
  ok(eq(all[0]?.data, { proto: 1, app: '1.4.0-test', caps: ['state', 'cmd', 'hr', 'summary', 'backup', 'audio'] }), 'hello: proto, app y caps');
  ok(all[1]?.type === 'audio.session' && all[1].data.type === 'playback', 'lo encolado sale justo después de hello, en orden');
  ok(all.some((m) => m.type === 'today'), 'today después de hello');
  keepReal('hello', all[0]);
  keepReal('audio.session', all[1]);
  // Una clase entera: muchos tipos de mensaje
  const P = harness(env, W1, { ghost: GHOST });
  P.nb.ready();
  P.start();
  P.run(20000);
  P.engine.pause();
  P.run(6000);
  P.engine.resume();
  P.run(10000);
  const msgs = env.all();
  const boot = msgs[0].boot;
  ok(/^j[a-z0-9]{6}$/.test(boot), `boot de la página: «j» + 6 caracteres (${boot})`);
  ok(msgs.every((m) => m.boot === boot), 'mismo boot en todos los mensajes');
  ok(msgs.every((m, i) => m.seq === i + 1), 'seq empieza en 1 y sube de 1 en 1');
  ok(msgs.every((m) => m.v === 1 && Number.isInteger(m.at) && m.at > 1.7e12), 'v = 1 y at en ms enteros');
  const states = msgs.filter((m) => m.type === 'state');
  ok(states.length > 10, 'hay mensajes state');
  const sizes = env.posted.filter((s) => s.includes('"type":"state"')).map((s) => s.length);
  ok(Math.max(...sizes) < 2048, `state < 2 KB (máx. ${Math.max(...sizes)} B)`);
  for (const m of msgs) {
    VALIDATED.push(m);
    const errs = envErrors(m);
    ok(!errs.length, `sobre ${m.type} #${m.seq}: ${errs.join(' · ')}`);
  }
  P.nb.detach();
});

/* ═════════════════ 3 · Instantánea: campos de state frente a engine.getState() ═════════════════ */

await section('Instantánea', async () => {
  const env = newEnv();
  await env.B.ready();
  const P = harness(env, W1, { ghost: GHOST });
  P.nb.ready();
  const readyState = env.ofType('state').pop();
  ok(readyState?.data.status === 'ready' && readyState.data.classId === W1.id && readyState.data.total === W1.totalSec, 'state ready en la preparación');
  keepReal('class.ready', env.ofType('class.ready')[0]);
  P.start();
  keepReal('class.prepare', env.ofType('class.prepare')[0]);
  keepReal('class.start', env.ofType('class.start')[0]);
  P.run(70000); // ya en el tramo «run» (12 km/h)
  P.ghostSide = 1;
  // Siguiente state publicado en un tick y el estado del motor en ese mismo instante
  let got = null;
  for (let k = 0; k < 20 && !got; k++) {
    const m0 = env.mark();
    P.step(250);
    const st = env.since(m0).filter((m) => m.type === 'state').pop();
    if (st) got = { msg: st, s: P.engine.getState() };
  }
  ok(!!got, 'hay un state en el siguiente segundo');
  if (got) {
    const { msg, s } = got;
    const d = msg.data;
    keepReal('state-running', msg);
    ok(d.status === 'running' && d.run === s.startedAt && d.classId === W1.id && d.title === W1.title, 'state: status, run, classId y título');
    ok(d.isTest === false && d.inTestStage === false, 'state: isTest e inTestStage');
    ok(d.seg.i === s.segIndex && d.seg.n === s.segCount && d.seg.zone === s.segment.zone, 'state.seg: i, n y zona');
    ok(d.seg.label === 'Correr' && d.seg.short === 'Correr', 'state.seg: label y short');
    ok(d.seg.kmh === r1(s.currentSpeed) && d.seg.sec === Math.round(s.segment.sec), 'state.seg: kmh y sec');
    ok(d.seg.left === r1(s.segRemaining), 'state.seg.left (1 decimal)');
    ok(d.seg.endAt === Math.round(msg.at + s.segRemaining * 1000), `state.seg.endAt = at + left·1000 (${d.seg.endAt} vs ${Math.round(msg.at + s.segRemaining * 1000)})`);
    ok(d.seg.adj === 0 && d.seg.sub === `Tramo ${s.segIndex + 1}/${s.segCount}`, 'state.seg: adj y sub');
    ok(d.next.zone === s.nextSegment.zone && d.next.kmh === s.nextSegment.speed && d.next.sec === s.nextSegment.sec && d.next.dir === 'up', 'state.next');
    ok(d.elapsed === r1(s.totalElapsed) && d.remaining === r1(s.totalRemaining) && d.total === s.totalSec, 'state: elapsed, remaining, total');
    ok(d.km === r3(s.distanceKm) && d.kcal === Math.round(s.kcal) && d.avgKmh === r1(s.avgSpeed), 'state: km, kcal, avgKmh');
    const t = hrTargetForZone('run', env.store.getState().profile);
    ok(eq(d.hrTarget, { z: t.zone, min: t.min, max: t.max }), 'state.hrTarget = hrTargetForZone');
    ok(d.hrUsual && d.hrUsual.lo === 150 && d.hrUsual.hi === 154, `state.hrUsual de las 3 últimas sesiones con pulso (${JSON.stringify(d.hrUsual)})`);
    const dm = Math.round((s.distanceKm - NB.ghostKmAt(GHOST, s.totalElapsed)) * 1000);
    ok(eq(d.record, { d: dm, side: 1, bestKm: 0.9, beaten: false }), `state.record (${JSON.stringify(d.record)})`);
    ok(d.voice === true, 'state.voice');
    ok(eq(d.music, { on: true, app: true, volume: 0.8, canSkip: true, title: 'Better Machine', artist: 'Conathor', bpm: 128 }), `state.music (${JSON.stringify(d.music)})`);
  }
  // En pausa: sin endAt; cada 5 s
  P.engine.pause();
  const m1 = env.mark();
  P.run(11000, 500);
  const paused = env.since(m1).filter((m) => m.type === 'state');
  ok(paused.length >= 2 && paused.length <= 4, `en pausa, un state cada 5 s (${paused.length} en 11 s)`);
  ok(paused.every((m) => m.data.status === 'paused' && m.data.seg.endAt === undefined), 'en pausa: status paused y sin endAt');
  P.nb.detach();
  const idle = env.ofType('state').pop();
  ok(eq(idle.data, { status: 'idle' }), 'detach → state { status: "idle" }');
  keepReal('state-idle', idle);
  const m2 = env.mark();
  P.run(6000);
  ok(env.since(m2).length === 0, 'tras detach no sale nada más');
});

/* ═════════════════ 4 · Ritmo: 1 Hz corriendo, cambios inmediatos ═════════════════ */

await section('Ritmo', async () => {
  const env = newEnv();
  await env.B.ready();
  const P = harness(env, W1, { treadmill: { minSpeed: 1, maxSpeed: 20 } });
  P.start();
  P.run(100000); // tramo «run», lejos de un cambio
  // Pausa y reanudación desde el reloj; luego 10 ticks en 1 s
  env.B.receive(cmdEnv({ name: 'pause' })); // ya corriendo: pause → pausa (no es no-op)
  env.B.receive(cmdEnv({ name: 'resume' }));
  P.run(1500);
  let m0 = env.mark();
  P.run(1000, 100);
  const states = env.since(m0).filter((m) => m.type === 'state');
  ok(states.length === 1, `10 ticks en 1 s → un solo state (${states.length})`);
  quiet(env);
  // ⏭: state inmediato + evento segment { reason: 'skip' }
  m0 = env.mark();
  const ackId = 'w3f9a0-skip1';
  env.B.receive(cmdEnv({ name: 'skip', dir: 1, from: 'action' }, ackId));
  const after = env.since(m0);
  const iSeg = after.findIndex((m) => m.type === 'event' && m.data.name === 'segment');
  const iState = after.findIndex((m, i) => i > iSeg && m.type === 'state');
  const iAck = after.findIndex((m) => m.type === 'ack' && m.data.id === ackId);
  ok(iSeg >= 0 && after[iSeg].data.reason === 'skip' && after[iSeg].data.i === 2 && after[iSeg].data.prev === 1, 'skip → event segment { reason: "skip", i, prev }');
  ok(iState > iSeg && iState < iAck, 'skip → state inmediato (antes del ack)');
  ok(iAck > 0 && after[iAck].data.ok === true, 'skip → ack ok');
  ok(after.slice(iAck + 1).some((m) => m.type === 'state' && m.data.seg.i === 2), 'tras el ack, un state fresco');
  keepReal('event-segment', after[iSeg]);
  // Cambio dentro de los 150 ms: espera al hueco
  P.run(1000);
  quiet(env);
  m0 = env.mark();
  P.engine.adjustSpeed(0.1);
  P.step(50);
  P.engine.adjustSpeed(0.1);
  const quick = env.since(m0).filter((m) => m.type === 'state');
  P.step(200);
  const later = env.since(m0).filter((m) => m.type === 'state');
  ok(quick.length === 1 && later.length === 2 && later[1].data.seg.adj === 0.2, `dos cambios seguidos: el segundo sale a los 150 ms (${quick.length}/${later.length})`);
  const adj = env.since(m0).find((m) => m.type === 'event' && m.data.name === 'adjust');
  ok(eq(adj?.data, { name: 'adjust', i: 2, zone: 'fast', kmh: 13.1, delta: 0.1, total: 0.1 }), `event adjust (${JSON.stringify(adj?.data)})`);
  P.nb.detach();
});

/* ═════════════════ 5 · Cuenta atrás 3-2-1 ═════════════════ */

await section('Cuenta atrás', async () => {
  const env = newEnv();
  await env.B.ready();
  const P = harness(env, W1);
  const t0 = now();
  P.start();
  const startCd = env.ofType('event').filter((m) => m.data.name === 'countdown' && m.data.phase === 'start');
  ok(eq(startCd.map((m) => m.data.n), [3, 2, 1, 0]), 'salida: countdown 3, 2, 1, 0');
  ok(startCd.every((m) => m.data.goAt === t0 + 3000 && m.data.dir === 'up' && m.data.seg === 0 && m.data.kmh === 6.5), 'salida: mismo goAt (el «¡Ya!»), dir up, seg 0 y su velocidad');
  const cdState = env.ofType('state').find((m) => m.data.status === 'countdown');
  ok(!!cdState && cdState.data.seg.endAt === undefined, 'state countdown durante el 3-2-1 (sin endAt)');
  // Fin del calentamiento (60 s): 3, 2, 1 del tramo 1, una vez cada uno
  const m0 = env.mark();
  const boundary = now() + 60000;
  P.run(57500);
  P.engine.pause(); // una pausa en la ventana de la cuenta no repite cifras
  P.run(2000);
  P.engine.resume();
  P.run(4000);
  const cd = env.since(m0).filter((m) => m.type === 'event' && m.data.name === 'countdown');
  ok(eq(cd.map((m) => m.data.n), [3, 2, 1]), `fin de tramo: 3, 2, 1 una vez cada uno (${cd.map((m) => m.data.n).join(',')})`);
  ok(cd.every((m) => m.data.phase === 'segment' && m.data.seg === 1 && m.data.dir === 'up' && m.data.kmh === 12), 'fin de tramo: phase segment, seg siguiente, dir up y velocidad nueva');
  // El 3 sale antes de la pausa (cambio a la hora prevista); el 2 y el 1, después (2 s de pausa más tarde)
  ok(cd.length === 3 && Math.abs(cd[0].data.goAt - boundary) <= 1 && Math.abs(cd[1].data.goAt - (boundary + 2000)) <= 1
    && Math.abs(cd[2].data.goAt - (boundary + 2000)) <= 1, `goAt = instante del cambio (${cd.map((m) => m.data.goAt - boundary).join(',')})`);
  keepReal('event-countdown', cd[0]);
  // Bajada: run (12) → … fast (13) → jog (8,3): dir down
  P.run(300000 + 30000 - 4000 - 2000);
  const m1 = env.mark();
  P.run(8000);
  const cdDown = env.since(m1).filter((m) => m.type === 'event' && m.data.name === 'countdown');
  ok(cdDown.length === 3 && cdDown.every((m) => m.data.dir === 'down' && m.data.kmh === 8.3), `fast → jog: dir down (${cdDown.map((m) => `${m.data.n}${m.data.dir}`).join(',')})`);
  // Reanudar con cuenta: phase resume, dir same
  P.engine.pause();
  const m2 = env.mark();
  P.countingDown = true;
  for (let n = 3; n >= 0; n--) { P.nb.countdown(n, 'resume', n === 3 ? now() + 3000 : null); if (n) { clock.t += 1000; env.timers.run(); } }
  P.countingDown = false;
  P.engine.resume();
  const cdRes = env.since(m2).filter((m) => m.type === 'event' && m.data.name === 'countdown');
  ok(cdRes.length === 4 && cdRes.every((m) => m.data.phase === 'resume' && m.data.dir === 'same'), 'reanudación: phase resume, dir same');
  P.nb.detach();
});

/* ═════════════════ 6 · Récord ═════════════════ */

await section('Récord', async () => {
  const env = newEnv();
  await env.B.ready();
  const P = harness(env, W1, { ghost: GHOST });
  P.start();
  P.run(30000);
  const m0 = env.mark();
  P.nb.record('overtake', 6);
  P.run(10000);
  P.nb.record('overtake', 7);
  let ov = env.since(m0).filter((m) => m.type === 'event' && m.data.name === 'record.overtake');
  ok(ov.length === 1 && ov[0].data.d === 6, 'record.overtake: una vez en 45 s');
  keepReal('event-record.overtake', ov[0]);
  P.run(36000);
  P.nb.record('overtake', 9);
  ov = env.since(m0).filter((m) => m.type === 'event' && m.data.name === 'record.overtake');
  ok(ov.length === 2, 'record.overtake: otra pasados 45 s');
  P.run(300000);
  const s = P.engine.getState();
  ok(s.distanceKm > GHOST.km, 'el corredor ya supera la distancia del récord');
  P.nb.record('beaten', 10);
  P.nb.record('beaten', 12);
  const bt = env.since(m0).filter((m) => m.type === 'event' && m.data.name === 'record.beaten');
  ok(bt.length === 1 && bt[0].data.bestKm === 0.9 && bt[0].data.km === r3(s.distanceKm), 'record.beaten: una sola vez, con bestKm y km');
  keepReal('event-record.beaten', bt[0]);
  const last = env.ofType('state').pop();
  ok(last.data.record.beaten === true, 'state.record.beaten = true');
  P.nb.detach();
});

/* ═════════════════ 7 · Órdenes del reloj ═════════════════ */

await section('Órdenes', async () => {
  const env = newEnv();
  await env.B.ready();
  const acks = () => env.ofType('ack').filter((m) => m.data.ref === 'cmd');
  const ackOf = (id) => acks().filter((m) => m.data.id === id).pop()?.data;
  const send = (data, id) => {
    const e = cmdEnv(data, id);
    const m0 = env.mark();
    let threw = false;
    try { env.B.receive(JSON.stringify(e)); } catch { threw = true; }
    ok(!threw, `cmd ${data.name}: receive no lanza`);
    const after = env.since(m0);
    const iA = after.findIndex((m) => m.type === 'ack' && m.data.id === e.id);
    ok(iA >= 0, `cmd ${data.name}: tiene ack`);
    ok(after.slice(iA + 1).some((m) => m.type === 'state'), `cmd ${data.name}: state fresco tras el ack`);
    return after[iA]?.data;
  };
  // Sin reproductor
  let a = send({ name: 'toggle' });
  ok(a?.ok === false && a.reason === 'no-class', 'sin clase: toggle → no-class');
  a = send({ name: 'dance' });
  ok(a?.ok === false && a.reason === 'unknown', 'orden desconocida → unknown');
  a = await (async () => {
    const m0 = env.mark();
    const e = cmdEnv({ name: 'start', from: 'action' });
    env.B.receive(e);
    await new Promise((r) => setTimeout(r, 5));
    ok(!env.since(m0).some((m) => m.type === 'state' && m.data.status === 'idle'),
      'sin reproductor: start aceptado → sin state idle (el reloj no abandona el entreno que acaba de empezar)');
    env.B.receive(e);
    await new Promise((r) => setTimeout(r, 5));
    ok(!env.since(m0).some((m) => m.type === 'state' && m.data.status === 'idle'), 'start repetido (ya aceptado) → tampoco idle');
    return ackOf(e.id);
  })();
  ok(a?.ok === true && env.navs.pop() === `#/play/${encodeURIComponent(PL.todayPlan(env.store.getState(), new Date(now())).workout.id)}?date=${todayKey(new Date(now()))}&autostart=1`,
    'sin reproductor: start → navega a la clase de hoy con autostart=1');
  // Con reproductor (preparación)
  const P = harness(env, W1, { treadmill: { minSpeed: 1, maxSpeed: 13 } });
  P.nb.ready();
  a = send({ name: 'pause' });
  ok(a?.ok === false && a.reason === 'no-class', 'preparación: pause → no-class');
  a = send({ name: 'start', from: 'action' });
  ok(a?.ok === true && P.calls.includes('start') && P.engine.getState().status === 'running', 'preparación: start → onStartTap (cuenta y arranque)');
  P.run(3000);
  a = send({ name: 'start' });
  ok(a?.ok === true && P.calls.filter((c) => c === 'start').length === 1, 'corriendo: start → ok sin hacer nada');
  a = send({ name: 'resume' });
  ok(a?.ok === true && !P.calls.includes('toggle'), 'corriendo: resume → ok sin hacer nada');
  a = send({ name: 'toggle', from: 'doubletap' });
  ok(a?.ok === true && P.engine.getState().status === 'paused', 'toggle → pausa');
  a = send({ name: 'pause' });
  ok(a?.ok === true && P.calls.filter((c) => c === 'toggle').length === 1, 'en pausa: pause → ok sin hacer nada');
  a = send({ name: 'start' });
  ok(a?.ok === true && P.engine.getState().status === 'running', 'en pausa: start → reanuda');
  a = send({ name: 'pause', from: 'intent' });
  a = send({ name: 'resume', from: 'intent' });
  ok(a?.ok === true && P.engine.getState().status === 'running', 'resume → corriendo');
  P.countingDown = true;
  a = send({ name: 'skip', dir: 1 });
  ok(a?.ok === false && a.reason === 'busy', 'durante la cuenta 3-2-1: skip → busy');
  P.countingDown = false;
  a = send({ name: 'skip', dir: 2 });
  ok(a?.ok === false && a.reason === 'bad-args', 'skip dir 2 → bad-args');
  a = send({ name: 'skip', dir: -1 });
  ok(a?.ok === true && P.calls.includes('skip:-1'), 'skip dir -1 → ok');
  a = send({ name: 'endTest' });
  ok(a?.ok === false && a.reason === 'unsupported', 'endTest en una clase normal → unsupported');
  a = send({ name: 'voice', on: false });
  ok(a?.ok === true && P.muted === true, 'voice { on:false } → coach en silencio');
  a = send({ name: 'voice', on: false });
  ok(a?.ok === true && P.calls.filter((c) => c === 'voice').length === 1, 'voice { on:false } otra vez → ok sin cambiar');
  a = send({ name: 'voice' });
  ok(a?.ok === true && P.muted === false, 'voice sin on → alterna');
  a = send({ name: 'nextSong' });
  ok(a?.ok === true && P.calls.includes('nextSong'), 'nextSong → ok');
  P.run(1000);
  const tr = env.ofType('event').filter((m) => m.data.name === 'track').pop();
  ok(tr?.data.title === 'Night Drive' && tr.data.artist === 'Lumen' && tr.data.bpm === 126, 'pista nueva → event track');
  keepReal('event-track', tr);
  P.canSkip = false;
  a = send({ name: 'nextSong' });
  ok(a?.ok === false && a.reason === 'unsupported', 'nextSong sin skipTrack → unsupported');
  P.canSkip = true;
  P.musicOn = false;
  a = send({ name: 'nextSong' });
  ok(a?.ok === false && a.reason === 'music-off', 'nextSong con la música apagada → music-off');
  a = send({ name: 'volume', value: 0.5 });
  ok(a?.ok === false && a.reason === 'music-off', 'volume con la música apagada → music-off');
  P.musicOn = true;
  a = send({ name: 'volume', value: 0.65, from: 'crown' });
  ok(a?.ok === true && P.vol === 0.65, 'volume 0,65 → ok');
  ok(env.ofType('state').pop().data.music.volume === 0.65, 'state.music.volume refleja el volumen nuevo');
  a = send({ name: 'volume', value: 2 });
  ok(a?.ok === false && a.reason === 'bad-args', 'volume 2 → bad-args');
  a = send({ name: 'volume', value: '0.4' });
  ok(a?.ok === false && a.reason === 'bad-args', 'volume en texto → bad-args');
  a = send({ name: 'intensity', delta: 0.5 });
  ok(a?.ok === false && a.reason === 'bad-args', 'intensity 0,5 → bad-args');
  a = send({ name: 'intensity', delta: -0.1 });
  ok(a?.ok === true && P.engine.getState().adjustments.warmup === -0.1, 'intensity −0,1 → ok (ajusta la zona)');
  // Al tope de la cinta (13 km/h) en «fast»
  P.run(61000 + 300000 - 4000);
  while (P.engine.getState().segment.zone !== 'fast') P.step(1000);
  a = send({ name: 'intensity', delta: 0.1 });
  ok(a?.ok === false && a.reason === 'limit', 'intensity al tope de la cinta → limit');
  P.appMusic = false;
  a = send({ name: 'nextSong' });
  ok(a?.ok === false && a.reason === 'own-music', 'nextSong con «Mi música» → own-music');
  a = send({ name: 'volume', value: 0.3 });
  ok(a?.ok === false && a.reason === 'own-music', 'volume con «Mi música» → own-music');
  P.appMusic = true;
  // Deduplicación por id: se responde otra vez sin repetir la orden
  const dupId = 'w3f9a0-dup';
  send({ name: 'toggle' }, dupId);
  const before = P.calls.filter((c) => c === 'toggle').length;
  const m0 = env.mark();
  env.B.receive(cmdEnv({ name: 'toggle' }, dupId));
  ok(P.calls.filter((c) => c === 'toggle').length === before, 'cmd repetido (mismo id): no se ejecuta dos veces');
  ok(env.since(m0).some((m) => m.type === 'ack' && m.data.id === dupId), 'cmd repetido: se vuelve a responder');
  send({ name: 'toggle' });
  // Último tramo: skip → last (sin diálogo)
  while (P.engine.getState().segIndex < P.engine.getState().segCount - 1) P.engine.skip(1);
  a = send({ name: 'skip', dir: 1, from: 'action' });
  ok(a?.ok === false && a.reason === 'last' && P.engine.getState().status !== 'finished', 'skip en el último tramo → last (sin terminar)');
  keepReal('ack', env.ofType('ack').filter((m) => m.data.reason === 'last').pop());
  // end { save:false } → descartar
  a = send({ name: 'end', save: false });
  ok(a?.ok === true && P.calls.includes('discard') && P.discarded === 'user', 'end { save:false } → descarta');
  const disc = env.ofType('class.discard').pop();
  ok(disc?.data.reason === 'user' && disc.data.run === P.engine.getState().startedAt && disc.data.classId === W1.id, 'class.discard { reason: "user", run, classId }');
  keepReal('class.discard', disc);
  P.nb.detach();
  // end { save:true } → terminar (class.end) en otra clase
  const P2 = harness(env, W1, { ghost: GHOST });
  P2.start();
  P2.run(120000);
  a = send({ name: 'end', save: true });
  ok(a?.ok === true && P2.calls.includes('finish'), 'end { save:true } → termina y guarda');
  const end = env.ofType('class.end').pop();
  ok(end?.data.saved === true && end.data.run === P2.session.startedAt && end.data.sessionId === P2.session.id, 'class.end: saved, run y sessionId');
  ok(end?.data.finishedEarly === true && end.data.km === r3(P2.session.distanceKm) && end.data.elapsedSec === P2.session.elapsedSec, 'class.end: finishedEarly, km y tiempo');
  ok(eq(end?.data.record, { beaten: P2.session.distanceKm > 0.9, m: Math.round((P2.session.distanceKm - 0.9) * 1000) }), 'class.end.record');
  keepReal('class.end', end);
  const fin = env.ofType('state').pop();
  ok(fin.data.status === 'finished', 'tras end: state finished');
  const bk = env.ofType('backup').pop();
  ok(bk && bk.data.sessions === env.store.getState().history.length && JSON.parse(bk.data.json).history.length === bk.data.sessions, 'clase guardada → backup al momento');
  a = send({ name: 'end', save: true });
  ok(a?.ok === false && a.reason === 'no-class', 'end con la clase ya terminada → no-class');
  P2.nb.detach();
  // Test VAM: endTest, skip e intensity en un escalón
  const P3 = harness(env, W_TEST);
  P3.start();
  P3.run(65000);
  ok(P3.engine.getState().inTestStage, 'test: ya en un escalón');
  a = send({ name: 'skip', dir: 1 });
  ok(a?.ok === false && a.reason === 'test-stage', 'test: skip en un escalón → test-stage');
  a = send({ name: 'intensity', delta: 0.1 });
  ok(a?.ok === false && a.reason === 'test-stage', 'test: intensity en un escalón → test-stage');
  ok(env.ofType('state').pop().data.inTestStage === true, 'state.inTestStage = true');
  a = send({ name: 'endTest', from: 'action' });
  ok(a?.ok === true && P3.calls.includes('endTest') && P3.engine.getState().segment.zone === 'cooldown', 'test: endTest → vuelta a la calma');
  const te = env.ofType('event').filter((m) => m.data.name === 'testEnd').pop();
  ok(te && te.data.vam > 0, 'event testEnd con vam');
  keepReal('event-testEnd', te);
  P3.nb.detach();
  // Mensajes rotos: nunca lanzan
  let threw = false;
  const bad = ['{no es json', '', 'null', '42', '[]', '{"v":2,"type":"cmd","seq":1,"boot":"w","at":1,"id":"x","data":{"name":"toggle"}}',
    '{"v":1,"type":"cmd","seq":1,"boot":"w","at":1,"data":{"name":"toggle"}}', '{"v":1,"type":"cmd","seq":1,"boot":"w","at":1,"id":"z","data":"x"}',
    '{"v":1,"type":"hr","seq":1,"boot":"w","at":1,"data":{"samples":"nope"}}', '{"v":1,"type":"workout.summary","seq":1,"boot":"w","at":1,"data":{}}',
    '{"v":1,"type":"native.status","seq":1,"boot":"p","at":1,"data":null}', '{"v":1,"type":"backup.data","seq":1,"boot":"p","at":1,"data":{"ref":5}}'];
  const results = [];
  for (const b of bad) {
    try { results.push(env.B.receive(b)); } catch { threw = true; }
  }
  for (const b of [null, undefined, 42, {}, { v: 1 }, { v: 1, type: 5 }]) {
    try { results.push(env.B.receive(b)); } catch { threw = true; }
  }
  ok(!threw, 'mensajes mal formados: receive nunca lanza');
  ok(results.slice(0, 6).every((r) => r === false), 'JSON roto o versión distinta: se descarta');
});

/* ═════════════════ 7b · iPhone bloqueado (o BestRunning detrás) ═════════════════ */

await section('iPhone bloqueado', async () => {
  const vis = { v: false };
  const env = newEnv({ visible: () => vis.v });
  await env.B.ready();
  const ackOf = (id) => env.ofType('ack').filter((m) => m.data.ref === 'cmd' && m.data.id === id).pop()?.data;
  const send = async (data, extra = {}) => {
    const e = { ...cmdEnv(data), ...extra };
    env.B.receive(JSON.stringify(e));
    await new Promise((r) => setTimeout(r, 5));
    return ackOf(e.id);
  };
  // Hoy (sin reproductor) con el iPhone bloqueado: «Empezar» del reloj no navega ni arranca la clase muda en segundo plano
  let a = await send({ name: 'start', from: 'watch' });
  ok(a?.ok === false && a.reason === 'phone-locked' && env.navs.length === 0, `bloqueado, sin reproductor: start → phone-locked sin navegar (${JSON.stringify(a)})`);
  a = await send({ name: 'start', from: 'action' });
  ok(a?.ok === false && a.reason === 'phone-locked', 'bloqueado: botón Acción → phone-locked');
  a = await send({ name: 'pause' });
  ok(a?.ok === false && a.reason === 'no-class', 'bloqueado sin clase: pause → no-class (como siempre)');
  vis.v = true;
  a = await send({ name: 'start', from: 'watch' });
  ok(a?.ok === true && env.navs.length === 1 && /autostart=1/.test(env.navs[0]), 'a la vista: start → navega a la clase con autostart');
  // Orden vieja: la página dormida (iPhone bloqueado) la ejecutaría al desbloquearlo, cuando el reloj ya la dio por perdida
  a = await send({ name: 'start' }, { at: now() - 30000 });
  ok(a?.ok === false && a.reason === 'timeout' && env.navs.length === 1, 'start con 30 s de retraso → timeout, sin navegar');
  a = await send({ name: 'start' }, { at: now() - 4000 });
  ok(a?.ok === true && env.navs.length === 2, 'start con 4 s de retraso (enlace lento) → se hace');
  // Preparación (reproductor sin motor) bloqueada: ni start ni toggle (Doble toque) arrancan la cuenta 3-2-1
  vis.v = false;
  const P = harness(env, W1);
  P.nb.ready();
  a = await send({ name: 'start' });
  ok(a?.ok === false && a.reason === 'phone-locked' && !P.calls.includes('start') && !P.engine, 'Preparación bloqueada: start → phone-locked, sin cuenta atrás');
  a = await send({ name: 'toggle', from: 'doubletap' });
  ok(a?.ok === false && a.reason === 'phone-locked' && !P.engine, 'Preparación bloqueada: toggle → phone-locked');
  ok(env.ofType('state').pop()?.data.status === 'ready', 'tras el rechazo, state fresco: ready');
  vis.v = true;
  a = await send({ name: 'start', from: 'doubletap' });
  ok(a?.ok === true && P.engine?.getState().status === 'running', 'desbloqueado: start → empieza');
  P.run(3000);
  // Clase en marcha con el iPhone bloqueado: el reloj sigue mandando (pausa, reanudar, saltar, voz, volumen, intensidad)
  vis.v = false;
  a = await send({ name: 'pause', from: 'intent' });
  ok(a?.ok === true && P.engine.getState().status === 'paused', 'bloqueado en clase: pause → en pausa');
  a = await send({ name: 'resume', from: 'intent' });
  ok(a?.ok === true && P.engine.getState().status === 'running', 'bloqueado en clase: resume → corriendo (el audio sigue vivo)');
  a = await send({ name: 'toggle', from: 'doubletap' });
  ok(a?.ok === true && P.engine.getState().status === 'paused', 'bloqueado en clase: toggle → pausa');
  a = await send({ name: 'start', from: 'action' });
  ok(a?.ok === true && P.engine.getState().status === 'running', 'bloqueado en clase: start en pausa → reanuda');
  a = await send({ name: 'skip', dir: 1, from: 'action' });
  ok(a?.ok === true && P.calls.includes('skip:1'), 'bloqueado en clase: skip → ok');
  a = await send({ name: 'voice', on: false });
  ok(a?.ok === true && P.muted === true, 'bloqueado en clase: voice → ok');
  a = await send({ name: 'volume', value: 0.5, from: 'crown' });
  ok(a?.ok === true && P.vol === 0.5, 'bloqueado en clase: volume → ok');
  a = await send({ name: 'intensity', delta: 0.1 });
  ok(a?.ok === true, `bloqueado en clase: intensity → ok (${JSON.stringify(a)})`);
  a = await send({ name: 'pause' }, { at: now() - 30000 });
  ok(a?.ok === true && P.engine.getState().status === 'paused', 'pause con retraso: se hace igual (nunca empieza nada)');
  // Clase recuperada tras recargar la página (su audio aún no ha sonado): con el iPhone bloqueado no se reanuda
  P.audioLive = false;
  a = await send({ name: 'resume', from: 'intent' });
  ok(a?.ok === false && a.reason === 'phone-locked' && P.engine.getState().status === 'paused', 'audio sin arrancar y bloqueado: resume → phone-locked');
  a = await send({ name: 'start', from: 'watch' });
  ok(a?.ok === false && a.reason === 'phone-locked' && P.engine.getState().status === 'paused', 'audio sin arrancar y bloqueado: start → phone-locked');
  a = await send({ name: 'skip', dir: 1 });
  ok(a?.ok === true, 'audio sin arrancar y bloqueado: skip sigue funcionando');
  vis.v = true;
  a = await send({ name: 'resume' }, { at: now() - 30000 });
  ok(a?.ok === false && a.reason === 'timeout' && P.engine.getState().status === 'paused', 'resume con 30 s de retraso → timeout');
  a = await send({ name: 'resume' });
  ok(a?.ok === true && P.engine.getState().status === 'running', 'a la vista: resume → corriendo');
  // La visibilidad que falla al leerse no bloquea nada
  P.nb.detach();
  const env2 = newEnv({ visible: () => { throw new Error('sin documento'); } });
  await env2.B.ready();
  const e2 = cmdEnv({ name: 'start' });
  env2.B.receive(e2);
  await new Promise((r) => setTimeout(r, 5));
  ok(env2.ofType('ack').some((m) => m.data.id === e2.id && m.data.ok === true), 'visible() que lanza: se trata como a la vista');
});

/* ═════════════════ 8 · Pulso en directo ═════════════════ */

await section('Pulso en directo', async () => {
  const env = newEnv();
  await env.B.ready();
  const P = harness(env, W1);
  P.start();
  P.run(5000);
  const run = P.engine.getState().startedAt;
  const t = Math.floor(now() / 1000) * 1000;
  const hrMsg = { v: 1, type: 'hr', seq: 1, boot: 'w3f9a0', at: now(), data: { run, samples: [[t - 4000, 30], [t - 3000, 250], [t - 2600, 'x'], [t - 2000, 141], [t - 1800, 142], [t - 1000, 143], [t - 500, null]] } };
  env.B.receive(JSON.stringify(hrMsg));
  ok(eq(P.nb.samples(), [[t - 2000, 141], [t - 1000, 143]]), `filtro de pulso: fuera de 40–220, basura y dos en el mismo segundo (${JSON.stringify(P.nb.samples())})`);
  ok(eq(P.nb.liveHr(), { bpm: 143, at: t - 1000 }), 'liveHr() = última lectura');
  env.B.receive({ ...hrMsg, data: { run: 'otra-clase', samples: [[t, 99]] } });
  ok(P.nb.samples().length === 2, 'pulso de otra clase (run distinto): no se mezcla');
  env.B.receive({ ...hrMsg, data: { samples: [[t + 1000, 150]], replay: true } });
  ok(P.nb.samples().length === 3 && P.nb.liveHr().bpm === 150, 'pulso sin run: se acepta');
  P.run(14000);
  ok(P.nb.liveHr() !== null, 'liveHr() sigue a los 14 s');
  P.run(2000);
  ok(P.nb.liveHr() === null, 'liveHr() = null pasados 15 s sin lecturas');
  env.B.receive({ ...hrMsg, data: { run, samples: [[now() - 120000, 130]], replay: true } });
  ok(P.nb.liveHr() === null && P.nb.samples().length === 4, 'repetición de lecturas viejas: se guardan, pero no son «en directo»');
  P.nb.detach();
});

/* ═════════════════ 9 · Equivalencia con el Atajo ═════════════════ */

await section('Equivalencia', async () => {
  const env = newEnv();
  await env.B.ready();
  const START = Date.UTC(2026, 9, 17, 5, 30, 0); // sábado 17 oct, 7:30 en Madrid
  const DUR = 1200;
  const PAUSE_AT = 600;
  const PAUSE = 120;
  const endMs = START + (DUR + PAUSE) * 1000;
  const ses = {
    id: 'ses_eq', startedAt: new Date(START).toISOString(), endedAt: new Date(endMs).toISOString(), elapsedSec: DUR, plannedSec: DUR, pausedSec: PAUSE,
    timeline: [[START, 0, 1], [START + PAUSE_AT * 1000, PAUSE_AT, 0], [START + (PAUSE_AT + PAUSE) * 1000, PAUSE_AT, 1], [endMs, DUR, 0]],
    speedTrace: [[0, 8.3], [DUR, 8.3]],
  };
  const samples = [];
  for (let s = -50; s <= DUR + PAUSE + 50; s += 5) samples.push([START + s * 1000, 95 + ((s * 7) % 80)]);
  const json = JSON.stringify({
    v: 1, id: ses.id, avg: 130, max: 174, min: 95, n: samples.length,
    t: samples.map((p) => W.isoLocal(p[0])).join('\n'), bpm: samples.map((p) => String(p[1])).join('\n'),
  });
  const res = W.parseWatchHr(json, ses);
  ok(res.ok, `el Atajo v2.2 parsea (${res.error || ''})`);
  const profile = env.store.getState().profile;
  const f1 = W.hrFieldsFrom(res, profile);
  const P = harness(env, W1);
  P.nb.restore(samples);
  const f2 = P.nb.hrFields(ses, profile);
  ok(f2.hrAvg === f1.hrAvg && f2.hrMax === f1.hrMax && f2.hrMin === f1.hrMin, `misma media/máx/mín (${f1.hrAvg}/${f1.hrMax}/${f1.hrMin} vs ${f2.hrAvg}/${f2.hrMax}/${f2.hrMin})`);
  ok(eq(f2.hrSeries, f1.hrSeries) && eq(f2.hrZones, f1.hrZones), 'misma serie de 10 s y mismas zonas (con la pausa fuera)');
  ok(f2.hrSource === 'watch-live' && f2.hrSamples === res.samples, 'hrSource watch-live y número de lecturas');
  ok(f1.hrSeries.every((p) => p[0] <= DUR + 10), 'la pausa no desplaza la serie (tiempo de clase)');
  const direct = W.hrFromSamples(samples.map(([ms, bpm]) => ({ ms, bpm })), ses);
  ok(eq(direct.hrSeries, res.hrSeries) && direct.samples === res.samples, 'hrFromSamples({ms,bpm}) = parseWatchHr');
  const few = harness(env, W1);
  few.nb.restore(samples.slice(20, 22));
  ok(eq(few.nb.hrFields(ses, profile), {}), 'con menos de 3 lecturas no se escribe nada');
  few.nb.detach();
  P.nb.detach();
});

/* ═════════════════ 10 · Resumen de Salud (workout.summary) ═════════════════ */

await section('Resumen', async () => {
  const env = newEnv();
  await env.B.ready();
  const RUN = new Date(now() - 3600e3).toISOString();
  const START = Date.parse(RUN);
  const ses = {
    id: 'ses_sum', workoutId: W1.id, templateId: W1.templateId, title: W1.title, startedAt: RUN, endedAt: new Date(START + 540e3).toISOString(),
    elapsedSec: 540, plannedSec: 540, pausedSec: 0, completed: true, distanceKm: 1.5, speedTrace: [[0, 6.5], [540, 6.5]], hrAvg: null, hrMax: null,
  };
  env.store.setState((d) => { d.history.push(ses); });
  const mk = (n, step = 2) => Array.from({ length: n }, (_, i) => [START + i * step * 1000, 100 + (i % 50)]);
  const sumEnv = (data, id = `sum-${RUN}`) => ({ v: 1, type: 'workout.summary', seq: 7, boot: 'w3f9a0', at: now(), id, data });
  const full = { run: RUN, sessionId: 'ses_sum', startedAt: START, endedAt: START + 540e3, uuid: '6F1C-UUID', kcalActive: 88, hrAvg: 124, hrMax: 149, hrMin: 100, samples: mk(200), source: 'watch' };
  let m0 = env.mark();
  env.B.receive(sumEnv(full));
  let h = env.store.getState().history.find((x) => x.id === 'ses_sum');
  ok(h.hrSamples === 200 && W.hasHrSeries(h) && h.hrAvg > 0 && h.hrSource === 'healthkit', 'resumen: pulso guardado (hrSource healthkit)');
  ok(eq(h.health && { uuid: h.health.uuid, kcal: h.health.kcal }, { uuid: '6F1C-UUID', kcal: 88 }), 'resumen: session.health { uuid, kcal }');
  ok(env.events.some((e) => e.name === 'br:native-hr' && e.detail.sessionId === 'ses_sum'), 'resumen: evento br:native-hr');
  let ack = env.since(m0).find((m) => m.type === 'ack');
  ok(eq(ack?.data, { ref: 'workout.summary', id: `sum-${RUN}`, ok: true }), 'resumen: ack ok');
  keepReal('ack-summary', ack);
  // Idempotente
  const sets = env.store.sets();
  m0 = env.mark();
  env.B.receive(sumEnv(full));
  ok(env.store.sets() === sets, 'resumen repetido: no vuelve a escribir');
  ok(env.since(m0).some((m) => m.type === 'ack' && m.data.ok), 'resumen repetido: se vuelve a confirmar');
  // Un resumen más pobre no pisa el pulso
  env.B.receive(sumEnv({ ...full, samples: mk(50, 9), uuid: '6F1C-UUID' }, 'sum-poor'));
  h = env.store.getState().history.find((x) => x.id === 'ses_sum');
  ok(h.hrSamples === 200, 'un resumen con menos lecturas no pisa el pulso');
  // Por run (sin sessionId) y por hora de inicio (±120 s)
  const ses2 = { ...ses, id: 'ses_run', startedAt: new Date(START - 7200e3).toISOString(), endedAt: new Date(START - 7200e3 + 540e3).toISOString() };
  const ses3 = { ...ses, id: 'ses_time', startedAt: new Date(START - 14400e3).toISOString(), endedAt: new Date(START - 14400e3 + 540e3).toISOString() };
  env.store.setState((d) => { d.history.push(ses2, ses3); });
  const S2 = Date.parse(ses2.startedAt);
  env.B.receive(sumEnv({ run: ses2.startedAt, startedAt: S2 + 30000, endedAt: S2 + 540e3, samples: mk(100).map(([ms, b]) => [ms - 7200e3, b]), source: 'phone-query' }, 'sum-phone-x'));
  h = env.store.getState().history.find((x) => x.id === 'ses_run');
  ok(h.hrSamples === 100 && h.hrSource === 'watch-live' && !h.health, 'resumen por run; phone-query sin uuid: sin health y hrSource watch-live');
  const S3 = Date.parse(ses3.startedAt);
  env.B.receive(sumEnv({ startedAt: S3 + 90000, endedAt: S3 + 540e3, samples: mk(100).map(([ms, b]) => [ms - 14400e3 + 90000, b]), source: 'watch', uuid: 'U3' }, 'sum-time'));
  h = env.store.getState().history.find((x) => x.id === 'ses_time');
  ok(h.hrSamples > 0 && h.health?.uuid === 'U3', 'resumen por hora de inicio (±120 s)');
  // Sin sesión: viejo → no-session; reciente → sin respuesta (el iPhone reintenta)
  m0 = env.mark();
  env.B.receive(sumEnv({ startedAt: now() - 86400e3 * 10, endedAt: now() - 86400e3 * 10 + 600e3, samples: mk(10), source: 'watch' }, 'sum-old'));
  ack = env.since(m0).find((m) => m.type === 'ack');
  ok(eq(ack?.data, { ref: 'workout.summary', id: 'sum-old', ok: false, reason: 'no-session' }), 'resumen sin sesión y viejo → no-session');
  m0 = env.mark();
  env.B.receive(sumEnv({ startedAt: now() - 600e3, endedAt: now() - 60e3, samples: mk(10), source: 'watch' }, 'sum-new'));
  ok(!env.since(m0).some((m) => m.type === 'ack'), 'resumen sin sesión y reciente → sin ack');
  m0 = env.mark();
  env.B.receive({ ...sumEnv(full), id: undefined });
  ok(!env.since(m0).length, 'resumen sin id: se ignora');
  // Se funde con el pulso en directo de la clase
  const P = harness(env, W1);
  P.start();
  P.run(40000);
  const runL = P.engine.getState().startedAt;
  const liveS = Array.from({ length: 30 }, (_, i) => [Date.parse(runL) + 1000 + i * 1000, 120 + i]);
  env.B.receive({ v: 1, type: 'hr', seq: 3, boot: 'w3f9a0', at: now(), data: { run: runL, samples: liveS } });
  P.engine.finish();
  P.nb.detach();
  const sesL = env.store.getState().history.find((x) => x.startedAt === runL);
  ok(sesL && sesL.hrSamples === 30 && sesL.hrSource === 'watch-live', 'clase terminada con el pulso en directo');
  const extra = Array.from({ length: 10 }, (_, i) => [Date.parse(runL) + 31000 + i * 1000, 140]);
  env.B.receive(sumEnv({ run: runL, sessionId: sesL.id, startedAt: Date.parse(runL), endedAt: now(), samples: extra, source: 'watch', uuid: 'UL', kcalActive: 9 }, `sum-${runL}`));
  const sesL2 = env.store.getState().history.find((x) => x.id === sesL.id);
  ok(sesL2.hrSamples === 40 && sesL2.hrSource === 'healthkit' && sesL2.health.uuid === 'UL', `resumen + pulso en directo fundidos sin duplicar segundos (${sesL2.hrSamples})`);
});

/* ═════════════════ 11 · samples() / restore() ═════════════════ */

await section('Instantánea de pulso', async () => {
  const env = newEnv();
  await env.B.ready();
  const P = harness(env, W1);
  P.start();
  P.run(3000);
  const run = P.engine.getState().startedAt;
  const s0 = Array.from({ length: 12 }, (_, i) => [now() - 11000 + i * 1000, 130 + i]);
  env.B.receive({ v: 1, type: 'hr', seq: 1, boot: 'w3f9a0', at: now(), data: { run, samples: s0 } });
  const snap = JSON.parse(JSON.stringify({ hrLive: P.nb.samples() }));
  ok(eq(snap.hrLive, s0), 'samples() devuelve [[ms, bpm]] serializables');
  P.nb.detach();
  const Q = harness(env, W1);
  Q.nb.restore(snap.hrLive);
  ok(eq(Q.nb.samples(), s0), 'restore(samples()) recupera lo mismo');
  ok(Q.nb.liveHr() === null, 'lo restaurado no cuenta como pulso en directo');
  Q.nb.restore([[0, 120], ['x', 1], null, [now(), 300]]);
  ok(Q.nb.samples().length === s0.length, 'restore descarta basura');
  Q.nb.restore(snap.hrLive);
  ok(Q.nb.samples().length === s0.length, 'restore dos veces: sin duplicados');
  // Clase restaurada: class.start con resumed:true
  const m0 = env.mark();
  Q.engine = createEngine(W1, { autoTick: false, now });
  Q.engine.start();
  Q.engine.pause();
  Q.nb.resumed(Q.engine.getState());
  const cs = env.since(m0).find((m) => m.type === 'class.start');
  ok(cs?.data.resumed === true && cs.data.run === Q.engine.getState().startedAt, 'resumed → class.start { resumed: true }');
  ok(env.since(m0).some((m) => m.type === 'state' && m.data.status === 'paused'), 'resumed → state paused');
  Q.nb.detach();
});

/* ═════════════════ 12 · today ═════════════════ */

await section('Hoy', async () => {
  const env = newEnv();
  await env.B.ready();
  const t = env.ofType('today').pop();
  ok(!!t, 'today al arrancar');
  const st = env.store.getState();
  const day = PL.todayPlan(st, new Date(now()));
  const w = day.workout;
  const d = t?.data || {};
  keepReal('today', t);
  ok(d.date === todayKey(new Date(now())) && d.status === 'today', 'today: fecha y status');
  ok(d.classId === w.id && d.href === `#/play/${encodeURIComponent(w.id)}?date=${d.date}` && d.title === w.title, 'today: classId, href y título');
  ok(d.category === w.category && d.categoryLabel === 'Resistencia' && d.categoryColor === '#30D158', 'today: categoría, nombre y color');
  ok(d.minutes === w.minutes && d.estKm === Math.round(w.estDistanceKm * 100) / 100, 'today: minutos y km estimados');
  ok(eq(d.segments, w.segments.map((s) => ({ sec: Math.round(s.sec), kmh: s.speed, zone: s.zone }))), 'today: segmentos { sec, kmh, zone }');
  ok(d.recordKm === null, 'today: sin récord en esta clase');
  ok(eq(d.next, { label: 'Mañana', minutes: 20, title: PL.planDay(st, addDays(d.date, 1), new Date(now())).workout.title }), `today.next (${JSON.stringify(d.next)})`);
  const week = PL.planWeek(st, d.date, new Date(now()));
  ok(d.weekDone === week.filter((x) => x.status === 'done').length && d.weekPlanned === week.filter((x) => x.workout && x.kind !== 'rest').length, 'today: semana hecha / planificada');
  ok(d.reminder === '07:00', 'today: hora del recordatorio');
  const zs = hrZones(176, null).map((z) => ({ z: z.zone, min: z.min, max: z.max }));
  ok(eq(d.hrZones, zs), 'today: zonas de FC del perfil');
  ok(!envErrors(t).length, `today cumple Wire.swift: ${envErrors(t).join(' · ')}`);
  // Sin cambios: no se repite
  let m0 = env.mark();
  await env.B.sendToday(false);
  ok(!env.since(m0).length, 'today sin cambios: no se reenvía');
  // Cambio del estado → hoy a 1 s (si cambió)
  env.store.setState((x) => { x.schedule.reminderTime = '18:30'; });
  clock.t += 1100;
  env.timers.run();
  await env.B.ready();
  await new Promise((r) => setTimeout(r, 5));
  const t2 = env.since(m0).find((m) => m.type === 'today');
  ok(t2?.data.reminder === '18:30', 'cambio del estado → today otra vez a 1 s');
  // Copia: 30 s después del cambio
  m0 = env.mark();
  clock.t += 30000;
  env.timers.run();
  const bk = env.since(m0).find((m) => m.type === 'backup');
  ok(bk && bk.data.sessions === 3 && typeof bk.data.json === 'string' && JSON.parse(bk.data.json).schedule.reminderTime === '18:30', 'backup 30 s después de un cambio');
  keepReal('backup', bk);
  m0 = env.mark();
  env.store.setState((x) => { x.schedule.reminderTime = '19:00'; });
  clock.t += 60000;
  env.timers.run();
  ok(!env.since(m0).some((m) => m.type === 'backup'), 'otra copia antes de 5 min: no');
  clock.t += 4 * 60000;
  env.timers.run();
  ok(env.since(m0).some((m) => m.type === 'backup'), 'la siguiente copia, a los 5 min de la anterior');
  // Día de descanso
  const saved = clock.t;
  clock.t = Date.UTC(2026, 9, 25, 7, 0, 0); // domingo 25 oct
  PL.setPlannerToday('2026-10-25');
  m0 = env.mark();
  await env.B.sendToday(true);
  const rest = env.since(m0).find((m) => m.type === 'today');
  ok(rest?.data.status === 'rest' && rest.data.classId === null && rest.data.href === null && rest.data.title === null && eq(rest.data.segments, []), 'today en descanso: sin clase y segments []');
  ok(rest?.data.next?.label === 'Mañana' && Number.isInteger(rest.data.next.minutes), 'today en descanso: next');
  ok(!envErrors(rest).length, `today en descanso cumple Wire.swift: ${envErrors(rest).join(' · ')}`);
  keepReal('today-rest', rest);
  // «Empezar» en descanso sin reproductor → no-class-today
  const e = cmdEnv({ name: 'start', from: 'action' });
  env.B.receive(e);
  await new Promise((r) => setTimeout(r, 5));
  ok(env.ofType('ack').some((m) => m.data.id === e.id && m.data.reason === 'no-class-today'), 'start en día de descanso → no-class-today');
  clock.t = saved;
  PL.setPlannerToday(todayKey(new Date(clock.t)));
  // Copia: health.authorize / backup.get / backup.data y native.status
  const pr = env.B.requestBackup();
  const get = env.ofType('backup.get').pop();
  ok(get && get.id === `${get.boot}-${get.seq}`, 'backup.get con id "<boot>-<seq>"');
  keepReal('backup.get', get);
  env.B.receive({ v: 1, type: 'backup.data', seq: 9, boot: 'p4k8m2', at: now(), data: { ref: get.id, savedAt: 1760850000000, json: '{"version":2}' } });
  const got = await pr;
  ok(got.json === '{"version":2}' && got.savedAt === 1760850000000, 'backup.data resuelve la petición');
  // Sin copia en el iPhone: ack {ref:'backup.get', ok:false, reason:'no-backup'} rechaza ya (sin esperar 15 s)
  const pr2 = env.B.requestBackup();
  const get2 = env.ofType('backup.get').pop();
  ok(env.B.receive({ v: 1, type: 'ack', seq: 10, boot: 'p4k8m2', at: now(), data: { ref: 'backup.get', id: get2.id, ok: false, reason: 'no-backup' } }) === 'ack',
    'ack de backup.get llega a su manejador');
  let noBackup = null;
  await pr2.catch((err) => { noBackup = err; });
  ok(noBackup?.message === 'no-backup', 'ack no-backup rechaza requestBackup() enseguida');
  ok(env.B.post('health.authorize', {}) === true, 'health.authorize');
  keepReal('health.authorize', env.ofType('health.authorize').pop());
  env.B.receive({ v: 1, type: 'native.hello', seq: 1, boot: 'p4k8m2', at: now(), data: { proto: 1, app: '1.0 (1)', watch: { paired: true, installed: true, reachable: true, link: 'mirror', workout: 'idle' }, health: { auth: 'granted' } } });
  env.B.receive({ v: 1, type: 'native.status', seq: 2, boot: 'p4k8m2', at: now(), data: { watch: { paired: true, installed: false, reachable: false, link: 'none', workout: 'idle' }, health: { auth: 'denied' } } });
  const ns = env.B.nativeStatus();
  ok(ns.proto === 1 && ns.app === '1.0 (1)' && ns.watch.installed === false && ns.health.auth === 'denied', 'native.status actualiza el estado (y conserva proto/app)');
  ok(env.events.filter((x) => x.name === 'br:native-status').length === 2, 'evento br:native-status en cada cambio');
  const P = harness(env, W1);
  ok(P.nb.watchManaged() === false, 'watchManaged() = false sin la app del reloj');
  env.B.receive({ v: 1, type: 'native.status', seq: 3, boot: 'p4k8m2', at: now(), data: { watch: { paired: true, installed: true, reachable: true, link: 'wc', workout: 'idle' }, health: { auth: 'granted' } } });
  ok(P.nb.watchManaged() === true, 'watchManaged() = true con el reloj emparejado y la app instalada');
  // Permiso de Salud para el pulso del reloj (health.hr, desde la build 4 del iPhone)
  ok(P.nb.healthMissing() === null, 'healthMissing() = null con Salud concedida (iPhone sin health.hr)');
  env.B.receive({ v: 1, type: 'native.status', seq: 4, boot: 'p4k8m2', at: now(), data: { watch: { paired: true, installed: true, reachable: true, link: 'wc', workout: 'idle' }, health: { auth: 'granted', hr: 'denied' } } });
  ok(P.nb.healthMissing() === 'denied', 'healthMissing() = denied sin permiso de pulso');
  env.B.receive({ v: 1, type: 'native.status', seq: 5, boot: 'p4k8m2', at: now(), data: { watch: { paired: true, installed: true, reachable: true, link: 'wc', workout: 'idle' }, health: { auth: 'unknown', hr: 'unknown' } } });
  ok(P.nb.healthMissing() === 'prompt', 'healthMissing() = prompt si aún falta la hoja de Salud');
  env.B.receive({ v: 1, type: 'native.status', seq: 6, boot: 'p4k8m2', at: now(), data: { watch: { paired: true, installed: true, reachable: true, link: 'wc', workout: 'idle' }, health: { auth: 'granted', hr: 'granted' } } });
  ok(P.nb.healthMissing() === null, 'healthMissing() = null con entreno y pulso concedidos');
  ok(NB.healthMissingOf({ health: { auth: 'denied' } }) === 'denied' && NB.healthMissingOf(null) === null, 'healthMissingOf()');
  // audio.kick (iPhone → página): llega a su manejador y se avisa a audio-engine.js con br:audio-kick
  ok(env.B.receive({ v: 1, type: 'audio.kick', seq: 7, boot: 'p4k8m2', at: now(), data: { reason: 'route' } }) === 'audio', 'audio.kick llega a su manejador');
  ok(env.events.some((x) => x.name === 'br:audio-kick' && x.detail?.reason === 'route'), 'audio.kick → evento br:audio-kick { reason }');
  P.nb.detach();
});

/* ═════════════════ 13 · Fixtures ═════════════════ */

await section('Fixtures', async () => {
  // Eventos que faltan por recoger: pausa, reanudación, mitad, km y ajuste
  const env = newEnv();
  await env.B.ready();
  const P = harness(env, W1);
  P.start();
  P.run(80000);
  P.engine.pause();
  P.engine.resume();
  P.engine.adjustSpeed(0.1);
  P.run(300000);
  const ev = (n) => env.ofType('event').find((m) => m.data.name === n);
  for (const n of ['pause', 'resume', 'halfway', 'km', 'adjust']) {
    ok(!!ev(n), `event ${n}`);
    keepReal(`event-${n}`, ev(n));
  }
  ok(ev('km')?.data.km === 1 && /^\d+:\d{2}$/.test(ev('km')?.data.pace || ''), 'event km { km: 1, pace }');
  ok(eq(ev('adjust')?.data, { name: 'adjust', i: 1, zone: 'run', kmh: 12.1, delta: 0.1, total: 0.1 }), `event adjust (${JSON.stringify(ev('adjust')?.data)})`);
  for (const m of env.all()) VALIDATED.push(m);
  P.nb.detach();
  for (const [name, m] of Object.entries(REAL)) {
    const errs = envErrors(m);
    ok(!errs.length, `fixture real ${name}: ${errs.join(' · ')}`);
  }
  for (const m of VALIDATED) {
    if (!PAGE_TYPES.includes(m.type)) fails.push(`la página publica un tipo que no es suyo: ${m.type}`);
  }
  // Ejemplos de la especificación (C0) frente a la salida real: mismos campos
  const files = existsSync(FIX_DIR) ? readdirSync(FIX_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('._')) : [];
  ok(files.length >= 40, `tools/native-fixtures tiene los ${files.length} ejemplos`);
  for (const f of files) {
    let e = null;
    try { e = JSON.parse(readFileSync(join(FIX_DIR, f), 'utf8')); } catch { e = null; }
    ok(!!e, `fixture ${f}: JSON válido`);
    if (!e) continue;
    const errs = envErrors(e);
    ok(!errs.length, `fixture ${f} cumple Wire.swift: ${errs.join(' · ')}`);
    const name = f.replace(/\.json$/, '');
    const real = REAL[name];
    if (real && !WRITE) {
      const keys = (o) => Object.keys(o || {}).sort();
      const missing = keys(e.data).filter((k) => !(k in real.data));
      ok(!missing.length, `fixture ${f}: la salida real tiene los campos del ejemplo (faltan ${missing.join(', ')})`);
    }
  }
  // Fixtures de Swift (native/Fixtures): pasan por receive() y llegan a su manejador
  const HANDLED = { 'native.hello': 'status', 'native.status': 'status', hr: 'hr', cmd: 'cmd', 'workout.summary': 'summary', 'backup.data': 'backup', 'audio.kick': 'audio' };
  const dirs = [FIX_DIR, ...(existsSync(NATIVE_FIX_DIR) ? [NATIVE_FIX_DIR] : [])];
  const env2 = newEnv();
  await env2.B.ready();
  const P2 = harness(env2, W1);
  P2.start();
  const seen = [];
  env2.B.on('*', (data, e) => seen.push(e.type));
  let nFiles = 0;
  for (const dir of dirs) {
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.name.startsWith('.') ? [] : x.isDirectory() ? walk(join(d, x.name)) : x.name.endsWith('.json') ? [join(d, x.name)] : []));
    for (const file of walk(dir)) {
      nFiles++;
      const text = readFileSync(file, 'utf8');
      let r;
      let threw = false;
      try { r = env2.B.receive(text); } catch { threw = true; }
      const e = JSON.parse(text);
      ok(!threw && r !== false, `${file.slice(ROOT.length + 1)}: receive() sin errores (${r})`);
      if (HANDLED[e.type]) ok(r === HANDLED[e.type], `${file.slice(ROOT.length + 1)}: llega a su manejador (${r})`);
      ok(seen[seen.length - 1] === e.type, `${file.slice(ROOT.length + 1)}: se notifica a on('${e.type}')`);
    }
  }
  ok(nFiles >= files.length, `${nFiles} fixtures pasados por receive()`);
  if (existsSync(NATIVE_FIX_DIR)) {
    const nat = readdirSync(NATIVE_FIX_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('._'));
    for (const f of nat) {
      const e = JSON.parse(readFileSync(join(NATIVE_FIX_DIR, f), 'utf8'));
      const errs = envErrors(e);
      ok(!errs.length, `native/Fixtures/${f} cumple el esquema de la página: ${errs.join(' · ')}`);
      if (e.type === 'store.status') {
        ok(!e.data.product || PRO_PRODUCTS.includes(e.data.product), `native/Fixtures/${f}: producto de RITMUP Pro conocido (${e.data.product})`);
        ok(e.data.pro || (!e.data.product && !e.data.expires && !e.data.trial), `native/Fixtures/${f}: sin Pro no hay producto, caducidad ni prueba`);
      }
    }
  }
  P2.nb.detach();
});

/* ═════════════════ Instancia por defecto (la de la app) ═════════════════ */

await section('Instancia por defecto', async () => {
  const posted = [];
  installWindow(makeHandler(posted), { events: true });
  // haptics.js escucha br:native-status desde que se carga (como en la app: lo importa router.js antes del puente)
  const HP = await import('../js/core/haptics.js');
  ok(NB.post('state', { status: 'idle' }) === true, 'app nativa: post() antes de iniciar se acepta');
  const okInit = await NB.initNativeBridge({ navigate: () => {}, app: '9.9.9' });
  ok(okInit === true, 'initNativeBridge arranca en la app nativa');
  const first = JSON.parse(posted[0] || '{}');
  ok(first.type === 'hello' && first.data.app === '9.9.9', 'la instancia por defecto empieza por hello');
  ok(JSON.parse(posted[1] || '{}').type === 'state', 'lo publicado antes de iniciar sale después de hello');
  const BR = globalThis.window.BRNative;
  ok(BR && Object.isFrozen(BR) && typeof BR.receive === 'function' && typeof BR.post === 'function', 'window.BRNative = { receive, post } congelado');
  BR.receive(JSON.stringify({ v: 1, type: 'native.hello', seq: 1, boot: 'p4k8m2', at: now(), data: { proto: 1, app: '1.0 (1)', watch: { paired: false, installed: false, reachable: false, link: 'none', workout: 'idle' }, health: { auth: 'unknown' } } }));
  ok(NB.nativeStatus()?.app === '1.0 (1)', 'nativeStatus() tras native.hello');

  // Vibración (build 6): solo por el puente si native.hello trae caps: ['haptic']; si no, como en Safari
  const pause = () => new Promise((r) => setTimeout(r, 45));
  const haptics = () => posted.map((x) => JSON.parse(x)).filter((m) => m.type === 'haptic');
  HP.haptic('success');
  ok(haptics().length === 0, 'haptic: app sin caps (builds 1–5) → no se manda por el puente');
  const helloCaps = { proto: 1, app: '1.0 (6)', caps: ['haptic'], watch: { paired: false, installed: false, reachable: false, link: 'none', workout: 'idle' }, health: { auth: 'unknown' } };
  BR.receive(JSON.stringify({ v: 1, type: 'native.hello', seq: 2, boot: 'p4k8m2', at: now(), data: helloCaps }));
  await pause();
  HP.haptic('success');
  HP.haptic('light'); // < 35 ms: se descarta (ráfaga)
  let hs = haptics();
  ok(hs.length === 1 && hs[0].data.style === 'success', `haptic: con caps → BRNative.post('haptic', { style }) (${JSON.stringify(hs.map((m) => m.data))})`);
  ok(hs.length === 1 && !envErrors(hs[0]).length, `haptic cumple Wire.swift: ${hs[0] ? envErrors(hs[0]).join(' · ') : 'sin mensaje'}`);
  BR.receive(JSON.stringify({ v: 1, type: 'native.status', seq: 3, boot: 'p4k8m2', at: now(), data: { watch: helloCaps.watch, health: { auth: 'granted' } } }));
  for (const [kind, style] of [['countdown', 'rigid'], ['select', 'selection'], ['segment', 'medium'], ['record', 'success'], ['heavy', 'heavy'], ['nada', 'light']]) {
    await pause();
    const n = haptics().length;
    HP.haptic(kind);
    hs = haptics();
    ok(hs.length === n + 1 && hs[n].data.style === style, `haptic('${kind}') → ${style} (también tras native.status sin caps): ${JSON.stringify(hs[n]?.data)}`);
  }
  ok(hs.every((m) => HAPTIC_STYLES.includes(m.data.style)), 'haptic: solo estilos de Wire.hapticStyles');
  ok(['light', 'selection', 'medium', 'heavy', 'soft', 'rigid', 'success', 'warning', 'error', 'tap', 'toggle', 'sheet', 'go', 'sprint', 'done', 'destructive', 'fail']
    .every((k) => HAPTIC_STYLES.includes(HP.hapticStyle(k))), 'hapticStyle(): todos los nombres dan un estilo de iOS');
  ok((await NB.initNativeBridge({})) === true, 'initNativeBridge dos veces: sin efecto');
  ok(posted.filter((s) => s.includes('"type":"hello"')).length === 1, 'un solo hello por carga');

  // RITMUP Pro (StoreKit 2): store.show sale por el puente con el esquema de Wire.swift y store.status llega a on()
  const n0 = posted.length;
  ok(NB.post('store.show', { from: 'settings' }) === true && NB.post('store.show') === true, 'store.show: post() aceptado');
  const shows = posted.slice(n0).map((x) => JSON.parse(x)).filter((m) => m.type === 'store.show');
  ok(shows.length === 2 && shows.every((m) => !envErrors(m).length), `store.show cumple Wire.swift: ${shows.map((m) => envErrors(m).join(' · ')).join(' | ')}`);
  const got = [];
  const off = NB.on('store.status', (d) => got.push(d));
  const st = { pro: true, product: PRO_PRODUCTS[1], expires: now() + 7 * 86400000, trial: true, available: true };
  const stEnv = { v: 1, type: 'store.status', seq: 4, boot: 'p4k8m2', at: now(), data: st };
  ok(!envErrors(stEnv).length, `store.status de ejemplo cumple el esquema: ${envErrors(stEnv).join(' · ')}`);
  BR.receive(JSON.stringify(stEnv));
  ok(got.length === 1 && eq(got[0], st), `store.status llega a on('store.status') (${JSON.stringify(got)})`);
  if (typeof off === 'function') off();
  delete globalThis.window;
});

/* ═════════════════ Regenerar los fixtures ═════════════════ */

if (WRITE) {
  mkdirSync(FIX_DIR, { recursive: true });
  let n = 0;
  for (const [name, env] of Object.entries(REAL)) {
    writeFileSync(join(FIX_DIR, `${name}.json`), `${JSON.stringify(env, null, 2)}\n`);
    n++;
  }
  console.log(`fixtures: ${n} regenerados con la salida real en tools/native-fixtures (los de iPhone/reloj se quedan como ejemplos de la especificación)`);
}

/* ═════════════════ Resultado ═════════════════ */

if (fails.length) {
  console.error(`\n✗ test-native-bridge: ${fails.length} fallo(s):`);
  for (const f of fails) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ test-native-bridge: ${pass} comprobaciones correctas · TZ=${process.env.TZ}`);
process.exit(0);
