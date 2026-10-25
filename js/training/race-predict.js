// RITMUP · marcas estimadas (5K, 10K, 15K, media) y FC máxima medida. Lógica pura, sin DOM.
//
// Marcas: a partir de la VAM (velocidad aeróbica máxima, km/h) con la fracción de VAM que un corredor popular
// sostiene en cada distancia (tablas clásicas de Léger/Mercier y Billat): 5K 88–95 %, 10K 83–90 %, 15K 79–86 %, 21,1K 76–83 %.
// Se da como RANGO (el extremo rápido es con buen día y buen entrenamiento específico) y nunca como promesa.
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
