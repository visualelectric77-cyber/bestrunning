// RITMUP · marcas estimadas (5K, 10K, 15K, media) y FC máxima medida. Lógica pura, sin DOM.
//
// Marcas: a partir de la VAM (velocidad aeróbica máxima, km/h) con la fracción de VAM que un corredor popular
// sostiene en cada distancia (tablas clásicas de Léger/Mercier y Billat): 5K 88–95 %, 10K 83–90 %, 15K 79–86 %, 21,1K 76–83 %.
// Se da como RANGO (el extremo rápido es con buen día y buen entrenamiento específico) y nunca como promesa.
// Una carrera real manda sobre la estimación: de su marca sale la VAM (vamFromRace) hasta que haya un test más reciente.
//
// FC máxima medida: si el reloj registra un pulso sostenido (≥ 2 lecturas de 10 s) por encima de la FC máxima con la
// que calculamos las zonas, esa FC máxima se quedaba corta: se sube a la medida. Solo sube, nunca baja.

export const RACES = [
  { key: '5k', label: '5K', km: 5, lo: 0.88, hi: 0.95 },
  { key: '10k', label: '10K', km: 10, lo: 0.83, hi: 0.9 },
  { key: '15k', label: '15K', km: 15, lo: 0.79, hi: 0.86 },
  { key: '21k', label: 'Media maratón', km: 21.0975, lo: 0.76, hi: 0.83 },
];

/** [{ key, label, km, fastSec, slowSec, paceSec }] o [] sin una VAM razonable (8–26 km/h). */
export function predictRaces(vam) {
  const v = Number(vam);
  if (!(v >= 8 && v <= 26)) return [];
  return RACES.map((r) => {
    const fastSec = Math.round((r.km / (v * r.hi)) * 3600);
    const slowSec = Math.round((r.km / (v * r.lo)) * 3600);
    const paceSec = Math.round(((fastSec + slowSec) / 2) / r.km);
    return { key: r.key, label: r.label, km: r.km, fastSec, slowSec, paceSec };
  });
}

/**
 * VAM que implica una carrera REAL (la app la usa como medida mientras no haya un test más reciente). Es la velocidad
 * media dividida por la fracción de VAM que se sostiene en esa distancia; como una carrera hecha «a tope» apura más que
 * una «exigente», la fracción depende de la sensación:
 *   · al límite / no pude → mitad del rango (5K: 91,5 %)
 *   · exigente            → un cuarto del rango (5K: 89,75 %)
 *   · cómodo, muy fácil o sin valorar → extremo bajo (5K: 88 %): te quedaba margen, así que tu VAM es al menos esa.
 * → km/h con un decimal, o null si la marca no es plausible.
 */
export function vamFromRace({ km, sec, feeling = '' } = {}) {
  const d = Number(km);
  const t = Number(sec);
  if (!(d > 0) || !(t > 0)) return null;
  const r = RACES.reduce((best, x) => (Math.abs(x.km - d) < Math.abs(best.km - d) ? x : best), RACES[0]);
  if (Math.abs(r.km - d) > 0.6) return null;
  const speed = (d / t) * 3600;
  const part = feeling === 'max' || feeling === 'fail' ? 0.5 : feeling === 'hard' ? 0.25 : 0;
  const vam = speed / (r.lo + (r.hi - r.lo) * part);
  return vam >= 8 && vam <= 26 ? Math.round(vam * 10) / 10 : null;
}

/**
 * Tu última carrera en la cinta terminada (sesión con race.sec) de los últimos `maxDays` días.
 * → { key, km, label, sec, date ('YYYY-MM-DD'), feeling, vam } o null.
 */
export function lastRace(history, { now = Date.now(), maxDays = 120 } = {}) {
  const since = Number(now) - maxDays * 86400000;
  let best = null;
  for (const h of Array.isArray(history) ? history : []) {
    const r = h?.race;
    if (!r || !(Number(r.sec) > 0) || !(Number(r.km) > 0)) continue;
    const t = Date.parse(h.startedAt || '') || Date.parse(`${h.dayKey || ''}T12:00:00`);
    if (!Number.isFinite(t) || t < since || (best && t <= best.t)) continue;
    const vam = vamFromRace({ km: r.km, sec: r.sec, feeling: h.feeling });
    if (!vam) continue;
    best = { t, key: String(r.key || ''), km: Number(r.km), label: String(r.label || ''), sec: Math.round(Number(r.sec)),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(h.dayKey || '')) ? h.dayKey : new Date(t).toISOString().slice(0, 10), feeling: h.feeling || '', vam };
  }
  if (!best) return null;
  const { t, ...out } = best;
  return out;
}

/** «22:41» o «1:42:05». */
export function fmtRaceTime(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * FC máxima medida en una sesión: el 2.º valor más alto de la serie de 10 s (un pico suelto no cuenta), si es
 * plausible (150–215). null si no hay serie.
 */
export function measuredHrMax(session) {
  const ser = Array.isArray(session?.hrSeries) ? session.hrSeries : [];
  const vals = ser.map((p) => Number(Array.isArray(p) ? p[1] : p?.bpm)).filter((b) => Number.isFinite(b) && b > 0).sort((a, b) => b - a);
  if (vals.length < 6) return null;
  const v = Math.round(vals[1]);
  return v >= 150 && v <= 215 ? v : null;
}

/** Nueva FC máxima si la medida supera la actual (sube, nunca baja); null si no cambia. */
export function raisedHrMax(currentMax, session) {
  const m = measuredHrMax(session);
  const cur = Number(currentMax) || 0;
  return m && m > cur ? m : null;
}
