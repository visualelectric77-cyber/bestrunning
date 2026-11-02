// RITMUP · FC en reposo del perfil a partir de Salud (métricas que manda el iPhone con health.metrics).
// Regla: el perfil guarda de dónde sale el valor en profile.hrRestSource.
//   'health'           → lo puso Salud: se actualiza solo cada vez que llegan métricas nuevas.
//   'manual'           → lo escribió el usuario en Ajustes: Salud no lo pisa (en Ajustes se ofrece «Usar el de Salud»).
//   null / sin definir → automático: Salud lo rellena (también el valor antiguo de la bienvenida, que se quedaba desfasado).
// Valor robusto: mediana de los últimos 7 días con dato (mínimo 3), solo si el último dato tiene menos de 21 días.

export const REST_DAYS = 7;
const MIN_DAYS = 3;
const MAX_AGE_DAYS = 21;
const MIN_BPM = 30;
const MAX_BPM = 110;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayNum = (k) => {
  const [y, m, d] = String(k).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

/**
 * resting: [[dayKey, bpm]] (medias diarias de Salud) · today: 'AAAA-MM-DD' (opcional, para descartar datos viejos)
 * → null (pocos datos o viejos) o { bpm, days, last } (mediana redondeada, días usados y último día con dato).
 */
export function restingFromHealth(resting, today = null) {
  const byDay = new Map();
  for (const e of Array.isArray(resting) ? resting : []) {
    const k = Array.isArray(e) ? String(e[0] || '') : '';
    const v = Array.isArray(e) ? Number(e[1]) : NaN;
    if (!DAY_RE.test(k) || !Number.isFinite(v) || v < MIN_BPM || v > MAX_BPM) continue;
    byDay.set(k, v); // un día repetido: vale el último que llega
  }
  const days = [...byDay.keys()].sort().reverse().slice(0, REST_DAYS);
  if (days.length < MIN_DAYS) return null;
  if (today && DAY_RE.test(today) && dayNum(today) - dayNum(days[0]) > MAX_AGE_DAYS) return null;
  const vals = days.map((k) => byDay.get(k)).sort((a, b) => a - b);
  const mid = vals.length >> 1;
  const med = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  return { bpm: Math.round(med), days: days.length, last: days[0] };
}

/** ¿Este perfil deja que Salud le ponga la FC en reposo? (todo lo que no sea 'manual') */
export const restIsAuto = (profile) => profile?.hrRestSource !== 'manual';

/**
 * Cambios para el perfil con las métricas de Salud, o null si no hay que tocar nada (manual, sin datos o ya al día).
 * → { hrRest, hrRestSource: 'health', hrRestDays, hrRestDay }
 */
export function healthRestPatch(profile, metrics, today = null) {
  const p = profile || {};
  if (!restIsAuto(p)) return null;
  const r = restingFromHealth(metrics?.resting, today);
  if (!r) return null;
  const patch = { hrRest: r.bpm, hrRestSource: 'health', hrRestDays: r.days, hrRestDay: r.last };
  const same = Object.keys(patch).every((k) => p[k] === patch[k]);
  return same ? null : patch;
}

/** Texto de Ajustes: de dónde sale la FC en reposo. */
export function restSourceLabel(profile) {
  const p = profile || {};
  if (p.hrRest && p.hrRestSource === 'health') return `De Salud · ${Math.min(REST_DAYS, Number(p.hrRestDays) || REST_DAYS)} días`;
  if (p.hrRest && p.hrRestSource === 'manual') return 'Escrita a mano';
  return '';
}
