// RITMUP · Salud y entrenos: cálculos fijos (sin IA) que cruzan tu pulso de cada clase con la velocidad y la carga.
// Todo es estadística sencilla y comprobable; si no hay datos suficientes, se dice y no se enseña nada.
//
//  · Tu forma: pulso a una velocidad fija en cada clase (recta pulso ~ velocidad con tus tramos estables), tendencia
//    robusta (pendiente de Theil–Sen) y prueba de Mann–Kendall: solo se afirma una mejora si es significativa (|z| ≥ 2,58, 99 %)
//    y de al menos 3 ppm.
//  · Carga: TRIMP de Banister por clase (minutos × reserva de pulso ponderada) o, sin pulso, minutos × intensidad media.
//    Carga aguda (7 días) / crónica (media semanal de 28 días): < 0,8 descansado · 0,8–1,3 equilibrado · > 1,3 cargado.

import { hrAtLevels } from '../integrations/watch-hr.js';
import { DEFAULT_LEVELS } from './levels.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const DAY = 86400000;
const keyToMs = (k) => {
  const [y, m, d] = String(k).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12).getTime();
};
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN;
};

/** Velocidad de referencia: tu nivel «correr» redondeado a 0,5 km/h (10 por defecto). */
export function referenceSpeed(levels) {
  const v = num(levels?.run) || DEFAULT_LEVELS.run;
  return Math.round(v * 2) / 2;
}

/**
 * Pulso de una clase a `ref` km/h: recta pulso ~ velocidad con la media de cada nivel (ponderada por segundos estables).
 * Necesita dos niveles con ≥ 0,8 km/h de diferencia que rodeen o casi (±1,5 km/h) la referencia. → ppm | null
 */
export function sessionHrAt(session, ref) {
  const lv = hrAtLevels(session);
  const pts = Object.values(lv).filter((p) => p && p.sec >= 45 && p.avg > 60 && p.speed > 3);
  if (pts.length < 2) return null;
  const speeds = pts.map((p) => p.speed);
  const lo = Math.min(...speeds), hi = Math.max(...speeds);
  if (hi - lo < 0.8 || ref < lo - 1.5 || ref > hi + 1.5) return null;
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { const w = p.sec; sw += w; sx += w * p.speed; sy += w * p.avg; sxx += w * p.speed * p.speed; sxy += w * p.speed * p.avg; }
  const den = sw * sxx - sx * sx;
  if (!(den > 0)) return null;
  const b = (sw * sxy - sx * sy) / den;
  const a = (sy - b * sx) / sw;
  // Pendiente fisiológica: el pulso sube con la velocidad (2–20 ppm por km/h); fuera de eso, la clase no vale
  if (!(b >= 2 && b <= 20)) return null;
  const hr = a + b * ref;
  return hr > 70 && hr < 220 ? Math.round(hr * 10) / 10 : null;
}

/** Pendiente de Theil–Sen (mediana de pendientes por pares). */
export function theilSen(xs, ys) {
  const sl = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) if (xs[j] !== xs[i]) sl.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
  const b = median(sl);
  const a = median(ys.map((y, i) => y - b * xs[i]));
  return { a, b };
}

/** Prueba de tendencia de Mann–Kendall → z (|z| ≥ 1,96 ≈ 95 %). */
export function mannKendallZ(xs, ys) {
  const idx = xs.map((_, i) => i).sort((p, q) => xs[p] - xs[q]);
  const y = idx.map((i) => ys[i]);
  const n = y.length;
  let s = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) s += Math.sign(y[j] - y[i]);
  const v = (n * (n - 1) * (2 * n + 5)) / 18;
  if (!(v > 0) || s === 0) return 0;
  return (s - Math.sign(s)) / Math.sqrt(v);
}

/**
 * Tu forma: pulso a la velocidad de referencia en las últimas `days` jornadas.
 * → { ok:false, need, have, ref } | { ok:true, ref, points:[{day, hr}], first, last, change, z, significant, verdict }
 *   verdict: 'better' | 'worse' | 'same'
 */
export function fitnessTrend(history, { today, levels, days = 70 } = {}) {
  const ref = referenceSpeed(levels);
  const end = keyToMs(today);
  const points = [];
  for (const s of Array.isArray(history) ? history : []) {
    if (!s?.dayKey || !Array.isArray(s.hrSeries) || s.hrSeries.length < 3) continue;
    const t = keyToMs(s.dayKey);
    if (!(t <= end && t > end - days * DAY)) continue;
    const hr = sessionHrAt(s, ref);
    if (hr != null) points.push({ day: s.dayKey, x: (t - end) / DAY, hr });
  }
  points.sort((a, b) => a.x - b.x);
  const span = points.length ? points[points.length - 1].x - points[0].x : 0;
  if (points.length < 6 || span < 14) return { ok: false, ref, need: 6, have: points.length, span: Math.round(span) };
  const xs = points.map((p) => p.x), ys = points.map((p) => p.hr);
  const { a, b } = theilSen(xs, ys);
  const first = a + b * xs[0], last = a + b * xs[xs.length - 1];
  const change = Math.round((last - first) * 10) / 10;
  const z = mannKendallZ(xs, ys);
  const significant = Math.abs(z) >= 2.58 && Math.abs(change) >= 3;
  const verdict = !significant ? 'same' : change < 0 ? 'better' : 'worse';
  return { ok: true, ref, points: points.map(({ day, hr }) => ({ day, hr })), first: Math.round(first), last: Math.round(last), change, z: Math.round(z * 100) / 100, significant, verdict, weeks: Math.max(1, Math.round(span / 7)) };
}

/** TRIMP de Banister de una clase (con pulso) o minutos × intensidad (sin pulso). */
export function sessionLoad(s, profile = {}) {
  const hrMax = num(profile.hrMax) || 176;
  const hrRest = num(profile.hrRest) || 60;
  const male = profile.sex !== 'f';
  const series = Array.isArray(s?.hrSeries) ? s.hrSeries.filter((p) => Array.isArray(p) && num(p[1]) > 30).map((p) => [num(p[0]), num(p[1])]).sort((p, q) => p[0] - q[0]) : [];
  if (series.length >= 3) {
    let tr = 0;
    for (let i = 0; i < series.length - 1; i++) {
      const dt = Math.min(60, series[i + 1][0] - series[i][0]);
      if (!(dt > 0)) continue;
      const r = Math.max(0, Math.min(1, (series[i][1] - hrRest) / (hrMax - hrRest)));
      tr += (dt / 60) * r * (male ? 0.64 * Math.exp(1.92 * r) : 0.86 * Math.exp(1.67 * r));
    }
    return Math.round(tr);
  }
  // Sin pulso: minutos × factor medio (≈ TRIMP de una clase moderada, 1,1 por minuto)
  const min = num(s?.elapsedSec) / 60;
  return Math.round(min * 1.1);
}

/**
 * Carga y descanso. → { ok:false, need } | { ok:true, acute, chronicWeek, ratio, status, weeks:[{from, load}], sessions7, minutes7, restDays }
 *   status: 'rested' | 'balanced' | 'loaded'
 */
export function loadBalance(history, { today, profile } = {}) {
  const end = keyToMs(today);
  const list = (Array.isArray(history) ? history : []).filter((s) => s?.dayKey && keyToMs(s.dayKey) <= end && keyToMs(s.dayKey) > end - 56 * DAY);
  const in28 = list.filter((s) => keyToMs(s.dayKey) > end - 28 * DAY);
  const oldest = list.reduce((m, s) => Math.min(m, keyToMs(s.dayKey)), end);
  if (in28.length < 4 || (end - oldest) / DAY < 20) return { ok: false, need: 4, have: in28.length };
  const loadOf = (s) => sessionLoad(s, profile);
  const sum = (from, to) => list.filter((s) => { const t = keyToMs(s.dayKey); return t > end - from * DAY && t <= end - to * DAY; }).reduce((a, s) => a + loadOf(s), 0);
  const acute = sum(7, 0);
  const chronicWeek = sum(28, 0) / 4;
  const ratio = chronicWeek > 0 ? Math.round((acute / chronicWeek) * 100) / 100 : 0;
  const status = ratio < 0.8 ? 'rested' : ratio > 1.3 ? 'loaded' : 'balanced';
  const weeks = [];
  for (let w = 7; w >= 0; w--) weeks.push({ from: w, load: sum((w + 1) * 7, w * 7) });
  const last7 = list.filter((s) => keyToMs(s.dayKey) > end - 7 * DAY);
  // Días seguidos entrenando hasta hoy
  const daysSet = new Set(list.map((s) => s.dayKey));
  let streak = 0;
  for (let d = 0; d < 14; d++) {
    const k = new Date(end - d * DAY);
    const key = `${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, '0')}-${String(k.getDate()).padStart(2, '0')}`;
    if (daysSet.has(key)) streak++; else if (d > 0) break;
  }
  return {
    ok: true, acute: Math.round(acute), chronicWeek: Math.round(chronicWeek), ratio, status, weeks,
    sessions7: last7.length, minutes7: Math.round(last7.reduce((a, s) => a + num(s.elapsedSec), 0) / 60), streak,
  };
}

/** Frases fijas (sin IA) para cada resultado. */
export function fitnessText(f) {
  if (!f?.ok) return null;
  const v = `${String(f.ref).replace('.', ',')} km/h`;
  if (f.verdict === 'better') return { title: `A ${v} tu pulso ha bajado ${Math.abs(Math.round(f.change))} ppm`, text: `En ${f.weeks} semanas: mismo ritmo, menos esfuerzo. Estás en mejor forma.` };
  if (f.verdict === 'worse') return { title: `A ${v} tu pulso ha subido ${Math.round(f.change)} ppm`, text: 'Puede ser cansancio, poco sueño o calor en el gimnasio. Si sigue, toca una semana más suave.' };
  return { title: `A ${v} tu pulso se mantiene`, text: `Sin cambios claros en ${f.weeks} semanas: aún no se nota mejora ni empeoramiento.` };
}

export function loadText(l) {
  if (!l?.ok) return null;
  if (l.status === 'loaded') return { title: 'Cargado', text: 'Esta semana llevas bastante más que tu media del último mes. Mete un día de descanso o una clase suave.' };
  if (l.status === 'rested') return { title: 'Descansado', text: 'Esta semana llevas menos que tu media: hay margen para una clase más larga o más intensa.' };
  return { title: 'Equilibrado', text: 'Entrenas lo que tu cuerpo recupera. Buen punto para seguir subiendo poco a poco.' };
}
