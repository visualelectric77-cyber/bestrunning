// RITMUP · IA del iPhone (Apple Foundation Models, en el dispositivo) y métricas de Salud, por el puente nativo.
// Solo en la app nativa y solo si el iPhone lo anuncia en native.hello (caps: 'ai' / 'health-metrics'). En Safari, o
// sin Apple Intelligence, todo devuelve null y la app sigue igual que siempre (sin IA).
//
// Protocolo (native/Shared/Wire.swift):
//   página → iPhone  ai.request {id, task: 'sessionSummary'|'planIntent'|'weeklyReport'|'classBriefing', input}
//   iPhone → página  ai.result {id, ok, output | error}
//   página → iPhone  health.metrics.get {days}
//   iPhone → página  health.metrics {resting: [[dayKey, bpm]], hrv: [[dayKey, ms]], at}

import { isNative, nativeStatus, post, on } from './native-bridge.js';

const AI_TIMEOUT_MS = 25000;
const METRICS_KEY = 'ritmup.health.metrics';

const caps = () => {
  const c = nativeStatus()?.caps;
  return Array.isArray(c) ? c : [];
};

/** ¿Hay IA del iPhone disponible ahora? */
export function aiAvailable() {
  return isNative() && caps().includes('ai');
}

/** Build de la app nativa («1.0 (12)» → 12), 0 si no se sabe. */
export function nativeBuild() {
  const m = /\((\d+)\)/.exec(String(nativeStatus()?.app || ''));
  return m ? Number(m[1]) : 0;
}

// Tareas que llegaron después de la build 9: una app más vieja contesta «unknown-task» y la tarjeta saldría «cargando»
// para luego irse. Solo se ofrecen si la app ya las sabe hacer.
const TASK_MIN_BUILD = { weeklyReport: 11, classBriefing: 12 };

/** ¿Esta app del iPhone sabe hacer esta tarea de IA (y hay IA ahora)? */
export function aiTaskAvailable(task) {
  return aiAvailable() && nativeBuild() >= (TASK_MIN_BUILD[task] || 0);
}

let seq = 0;
/**
 * Pide una tarea a la IA del iPhone. → Promise<output | null> (null si no hay IA, falla o tarda > 25 s).
 * Nunca lanza.
 */
export function aiRequest(task, input) {
  if (!aiAvailable()) return Promise.resolve(null);
  const id = `ai-${Date.now().toString(36)}-${(++seq).toString(36)}`;
  return new Promise((resolve) => {
    let done = false;
    let off = () => {};
    const finish = (v) => { if (done) return; done = true; clearTimeout(t); off(); resolve(v); };
    const t = setTimeout(() => finish(null), AI_TIMEOUT_MS);
    off = on('ai.result', (data) => {
      if (String(data?.id || '') !== id) return;
      finish(data?.ok && data.output && typeof data.output === 'object' ? data.output : null);
    });
    try { if (post('ai.request', { id, task, input }) !== true) finish(null); } catch { finish(null); }
  });
}

/** Últimas métricas guardadas (para pintar al instante), o null. */
export function cachedHealthMetrics() {
  try {
    const m = JSON.parse(localStorage.getItem(METRICS_KEY) || 'null');
    return m && Array.isArray(m.resting) && Array.isArray(m.hrv) ? m : null;
  } catch { return null; }
}

/** Pide al iPhone el pulso en reposo y la VFC de los últimos `days` días. → Promise<métricas | null>. Nunca lanza. */
export function fetchHealthMetrics(days = 35) {
  if (!isNative() || !caps().includes('health-metrics')) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    let off = () => {};
    const finish = (v) => { if (done) return; done = true; clearTimeout(t); off(); resolve(v); };
    const t = setTimeout(() => finish(null), 10000);
    off = on('health.metrics', (data) => {
      const m = {
        resting: Array.isArray(data?.resting) ? data.resting : [],
        hrv: Array.isArray(data?.hrv) ? data.hrv : [],
        wristTemp: Array.isArray(data?.wristTemp) ? data.wristTemp : [],
        wristTempAbsolute: !!data?.wristTempAbsolute,
        respiratory: Array.isArray(data?.respiratory) ? data.respiratory : [],
        at: Number(data?.at) || Date.now(),
      };
      try { localStorage.setItem(METRICS_KEY, JSON.stringify(m)); } catch { /* sin almacenamiento */ }
      finish(m);
    });
    try { if (post('health.metrics.get', { days }) !== true) finish(null); } catch { finish(null); }
  });
}

/**
 * Comprueba que un texto de la IA no se inventa cifras: cada número que aparece tiene que estar entre los permitidos
 * (con una tolerancia de redondeo). → true si es fiable.
 */
export function numbersAreGrounded(text, allowed) {
  const nums = String(text || '').match(/\d+(?:[.,]\d+)?/g) || [];
  const ok = (allowed || []).map(Number).filter(Number.isFinite);
  return nums.every((raw) => {
    const v = Number(raw.replace(',', '.'));
    // exacta (con margen de redondeo a la cifra que se escribe): «6,58» vale para 6,58; «7» NO vale para 6,58
    return ok.some((a) => Math.abs(a - v) <= 0.051);
  });
}

/* ───────── Avisos de la mañana (los programa el iPhone, con la fatiga calculada allí) ─────────
   página → iPhone  notify.config {enabled, weekdayTime, weekendTime, preRun, preRunTime}
   página → iPhone  plan.days {days: [{dayKey, title, minutes, category, rest}]}   (próximos 8 días)
   iPhone → página  notify.status {authorized, enabled} */

const NOTIFY_KEY = 'ritmup.notify';
export const NOTIFY_DEFAULTS = { enabled: false, weekdayTime: '05:45', weekendTime: '09:00', preRun: true, preRunTime: '06:20', thursdayPreRunTime: '05:55' };

/** ¿El iPhone sabe programar avisos? */
export function notifyAvailable() {
  return isNative() && caps().includes('notify');
}

export function notifyConfig() {
  try { return { ...NOTIFY_DEFAULTS, ...(JSON.parse(localStorage.getItem(NOTIFY_KEY) || '{}') || {}) }; } catch { return { ...NOTIFY_DEFAULTS }; }
}

/** Guarda la configuración y se la manda al iPhone. */
export function setNotifyConfig(patch) {
  const cfg = { ...notifyConfig(), ...(patch || {}) };
  try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(cfg)); } catch { /* sin almacenamiento */ }
  if (notifyAvailable()) { try { post('notify.config', cfg); } catch { /* nada */ } }
  return cfg;
}

let lastDays = '';
/** Manda al iPhone los próximos 8 días del plan (solo si han cambiado). `days`: salida de planDay/planWeek. */
export function syncPlanDays(days) {
  if (!notifyAvailable() || !Array.isArray(days)) return;
  const list = days.slice(0, 8).map((d) => ({
    dayKey: d.date,
    title: d.workout?.title || (d.kind === 'rest' ? 'Descanso' : ''),
    minutes: Number(d.minutes) || Math.round((Number(d.workout?.totalSec) || 0) / 60) || 0,
    category: d.workout?.category || '',
    rest: d.kind === 'rest' || !d.workout,
    // Tramos para dibujar el perfil en el aviso (tarjeta del iPhone y vista del reloj)
    segments: (Array.isArray(d.workout?.segments) ? d.workout.segments : []).slice(0, 40).map((x) => [String(x.zone || 'jog'), Math.round(Number(x.sec) || 0)]),
  }));
  const sig = JSON.stringify(list);
  if (sig === lastDays) return;
  lastDays = sig;
  try { post('plan.days', { days: list }); } catch { /* nada */ }
  // Al arrancar, también la configuración (el iPhone la guarda; así se reprograma con el plan nuevo)
  const cfg = notifyConfig();
  if (cfg.enabled) { try { post('notify.config', cfg); } catch { /* nada */ } }
}
