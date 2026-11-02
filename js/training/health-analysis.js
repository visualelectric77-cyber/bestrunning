// RITMUP · Salud y entrenos: cálculos fijos (sin IA) que cruzan tu pulso de cada clase con la velocidad y la carga.
// Todo es estadística sencilla y comprobable; si no hay datos suficientes, se dice y no se enseña nada.
//
//  · Tu forma: pulso a una velocidad fija en cada clase (recta pulso ~ velocidad con tus tramos estables), tendencia
//    robusta (pendiente de Theil–Sen) y prueba de Mann–Kendall: solo se afirma una mejora si es significativa (|z| ≥ 2,58, 99 %)
//    y de al menos 3 ppm.
//  · Carga: TRIMP de Banister por clase (minutos × reserva de pulso ponderada) o, sin pulso, minutos × intensidad media.
//    Carga aguda (7 días) / crónica (media semanal de 28 días): < 0,8 descansado · 0,8–1,3 equilibrado · > 1,3 cargado.

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

/** Pulso medio de la serie entre a y b (s de clase), con las lecturas que caen dentro. → { avg, n } | null */
function hrBetween(series, a, b) {
  let sum = 0, n = 0;
  for (const [t, v] of series) { if (t >= a && t < b) { sum += v; n++; } }
  return n >= 3 ? { avg: sum / n, n } : null;
}

const isHills = (s) => s?.category === 'hills' || /colina|cuesta|hill/i.test(String(s?.templateId || s?.workoutId || ''));

/**
 * Pulso de una clase a `ref` km/h. Cada tramo a velocidad constante (de speedTrace, sea cual sea: también los ajustados
 * con + y −) de al menos 60 s da un punto (velocidad, pulso medio sin los primeros segundos, que el corazón tarda en
 * subir); con ellos, recta pulso ~ velocidad ponderada por duración. Hace falta ≥ 0,8 km/h entre el tramo más lento y
 * el más rápido y que la referencia quede cerca (±1,5 km/h). Las clases de cuestas no cuentan (la pendiente sube el
 * pulso sin cambiar la velocidad). → ppm | null
 */
export function sessionHrAt(session, ref) {
  if (!session || isHills(session)) return null;
  const series = (Array.isArray(session.hrSeries) ? session.hrSeries : [])
    .filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number(p[1]) >= 40 && Number(p[1]) <= 230)
    .map((p) => [Number(p[0]), Number(p[1])]).sort((a, b) => a[0] - b[0]);
  const trace = (Array.isArray(session.speedTrace) ? session.speedTrace : [])
    .filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number(p[1]) > 0)
    .map((p) => [Number(p[0]), Number(p[1])]).sort((a, b) => a[0] - b[0]);
  if (series.length < 10 || !trace.length) return null;
  const end = Math.max(trace[trace.length - 1][0], num(session.elapsedSec), series[series.length - 1][0]);
  // Tramos de velocidad constante (se unen los contiguos a la misma velocidad)
  const wins = [];
  trace.forEach(([t, v], k) => {
    const b = k + 1 < trace.length ? trace[k + 1][0] : end;
    if (!(b > t)) return;
    const last = wins[wins.length - 1];
    if (last && Math.abs(last.v - v) < 0.05 && Math.abs(last.b - t) < 1e-6) last.b = b;
    else wins.push({ a: t, b, v });
  });
  const pts = [];
  for (const w of wins) {
    const dur = w.b - w.a;
    if (dur < 60 || w.v < 5) continue;
    const lag = Math.min(60, Math.max(30, dur * 0.35));
    const h = hrBetween(series, w.a + lag, w.b);
    if (h && h.avg > 70) pts.push({ speed: w.v, avg: h.avg, sec: dur - lag });
  }
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
  // Pendiente fisiológica: el pulso sube con la velocidad (1,5–20 ppm por km/h); fuera de eso, la clase no vale
  if (!(b >= 1.5 && b <= 20)) return null;
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
  let withHr = 0;
  for (const s of Array.isArray(history) ? history : []) {
    if (!s?.dayKey || !Array.isArray(s.hrSeries) || s.hrSeries.length < 3) continue;
    const t = keyToMs(s.dayKey);
    if (!(t <= end && t > end - days * DAY)) continue;
    withHr++;
    const hr = sessionHrAt(s, ref);
    if (hr != null) points.push({ day: s.dayKey, x: (t - end) / DAY, hr });
  }
  points.sort((a, b) => a.x - b.x);
  const span = points.length ? points[points.length - 1].x - points[0].x : 0;
  if (points.length < 6 || span < 14) return { ok: false, ref, need: 6, have: points.length, withHr, span: Math.round(span) };
  const xs = points.map((p) => p.x), ys = points.map((p) => p.hr);
  const { a, b } = theilSen(xs, ys);
  const first = a + b * xs[0], last = a + b * xs[xs.length - 1];
  const change = Math.round((last - first) * 10) / 10;
  const z = mannKendallZ(xs, ys);
  const significant = Math.abs(z) >= 2.58 && Math.abs(change) >= 3;
  const verdict = !significant ? 'same' : change < 0 ? 'better' : 'worse';
  return { ok: true, ref, withHr, points: points.map(({ day, hr }) => ({ day, hr })), first: Math.round(first), last: Math.round(last), change, z: Math.round(z * 100) / 100, significant, verdict, weeks: Math.max(1, Math.round(span / 7)) };
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
  if (in28.length < 4 || (end - oldest) / DAY < 20) return { ok: false, need: 4, have: in28.length, days: Math.round((end - oldest) / DAY) };
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

/* ───────── Build 17 del iPhone: sueño, VO2 máx y recuperación (datos de Salud) ───────── */

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const keyMinus = (today, n) => {
  const d = new Date(keyToMs(today) - n * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Minutos desde las 12:00 (hora local) de un instante: así la media de horas de acostarse no salta a medianoche. */
const fromNoon = (ms) => { const d = new Date(ms); return (d.getHours() * 60 + d.getMinutes() + 720) % 1440; };
const hm = (minFromNoon) => { const m = (Math.round(minFromNoon) + 720) % 1440; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

/** Noches de Salud limpias (de 2 a 16 h dormido), de más antigua a más nueva. */
export function sleepList(metrics) {
  const out = [];
  const seen = new Set();
  for (const n of Array.isArray(metrics?.sleep) ? metrics.sleep : []) {
    if (!n || typeof n.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(n.day) || seen.has(n.day)) continue;
    const asleep = num(n.asleep);
    if (asleep < 120 || asleep > 960) continue;
    seen.add(n.day);
    out.push({ day: n.day, start: num(n.start), end: num(n.end), asleep, deep: num(n.deep), core: num(n.core), rem: num(n.rem), awake: num(n.awake), stages: !!n.stages });
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : 1));
}

/**
 * Tus últimas `nights` noches. → { ok:false, have } | { ok:true, nights, avg (min), bed, wake ('H:MM'), base (min | null),
 * delta (min | null), last (noche de hoy | null), stages }
 */
export function sleepSummary(metrics, today, nights = 7) {
  const all = sleepList(metrics);
  const from = keyMinus(today, nights - 1);
  const list = all.filter((n) => n.day >= from && n.day <= today);
  if (list.length < 3) return { ok: false, have: list.length, need: 3 };
  const prev = all.filter((n) => n.day >= keyMinus(today, nights + 27) && n.day < from);
  const avg = Math.round(mean(list.map((n) => n.asleep)));
  const base = prev.length >= 7 ? Math.round(mean(prev.map((n) => n.asleep))) : null;
  const timed = list.filter((n) => n.start > 0 && n.end > n.start);
  return {
    ok: true, nights: list, avg, base, delta: base == null ? null : avg - base,
    bed: timed.length ? hm(mean(timed.map((n) => fromNoon(n.start)))) : null,
    wake: timed.length ? hm(mean(timed.map((n) => fromNoon(n.end)))) : null,
    last: list.find((n) => n.day === today) || null,
    stages: list.some((n) => n.stages),
  };
}

// t de Student al 99 % (dos colas) por grados de libertad: se usa el del gl inmediatamente inferior (más exigente).
const T99 = [[1, 63.66], [2, 9.92], [3, 5.84], [4, 4.6], [5, 4.03], [6, 3.71], [7, 3.5], [8, 3.36], [9, 3.25], [10, 3.17], [12, 3.05], [15, 2.95], [20, 2.85], [25, 2.79], [30, 2.75], [60, 2.66], [120, 2.62]];
const tCrit99 = (df) => { let c = T99[0][1]; for (const [d, v] of T99) if (df >= d) c = v; return df > 1000 ? 2.58 : c; };

/** Noche corta y larga (minutos dormido). */
export const SHORT_NIGHT = 390, LONG_NIGHT = 420;

/**
 * ¿Te sube el pulso en clase cuando duermes poco? Cada clase (pulso a la velocidad de referencia, como en «Tu forma») se
 * empareja con la noche de ese día. Se quita la tendencia de forma (Theil–Sen) para que mejorar con el tiempo no se
 * confunda con dormir más, y se comparan las clases tras noches cortas (< 6 h 30) y largas (≥ 7 h) con la t de Welch:
 * solo se afirma una diferencia si es significativa al 99 % y de al menos 3 ppm. Hacen falta 4 clases en cada grupo.
 * → { ok:false, short, long, need, paired, ref } | { ok:true, ref, short, long, hrShort, hrLong, diff, t, significant }
 */
export function sleepVsHr(history, metrics, { today, levels, days = 90 } = {}) {
  const ref = referenceSpeed(levels);
  const end = keyToMs(today);
  const nights = new Map(sleepList(metrics).map((n) => [n.day, n]));
  const pts = [];
  for (const s of Array.isArray(history) ? history : []) {
    if (!s?.dayKey || !nights.has(s.dayKey) || !Array.isArray(s.hrSeries) || s.hrSeries.length < 3) continue;
    const t = keyToMs(s.dayKey);
    if (!(t <= end && t > end - days * DAY)) continue;
    const hr = sessionHrAt(s, ref);
    if (hr != null) pts.push({ x: (t - end) / DAY, hr, sleep: nights.get(s.dayKey).asleep });
  }
  let resid = pts.map((p) => p.hr - median(pts.map((q) => q.hr)));
  if (pts.length >= 6) {
    const { a, b } = theilSen(pts.map((p) => p.x), pts.map((p) => p.hr));
    resid = pts.map((p) => p.hr - (a + b * p.x));
  }
  const S = pts.map((p, i) => ({ ...p, r: resid[i] }));
  const short = S.filter((p) => p.sleep < SHORT_NIGHT), long = S.filter((p) => p.sleep >= LONG_NIGHT);
  if (short.length < 4 || long.length < 4) return { ok: false, ref, short: short.length, long: long.length, need: 4, paired: pts.length };
  const ms = mean(short.map((p) => p.r)), ml = mean(long.map((p) => p.r));
  const varOf = (a, m) => a.reduce((s, p) => s + (p.r - m) ** 2, 0) / (a.length - 1);
  const vs = varOf(short, ms) / short.length, vl = varOf(long, ml) / long.length;
  const diff = Math.round((ms - ml) * 10) / 10;
  const se = Math.sqrt(vs + vl);
  const t = se > 0 ? (ms - ml) / se : 0;
  const df = se > 0 ? (vs + vl) ** 2 / ((vs ** 2) / (short.length - 1) + (vl ** 2) / (long.length - 1)) : 1;
  const significant = Math.abs(t) >= tCrit99(df) && Math.abs(diff) >= 3;
  const hrLong = Math.round(mean(long.map((p) => p.hr)));
  return { ok: true, ref, short: short.length, long: long.length, paired: pts.length, hrLong, hrShort: Math.round(hrLong + diff), diff, t: Math.round(t * 100) / 100, significant };
}

/** Frase fija del cruce sueño ↔ pulso. */
export function sleepHrText(c) {
  if (!c?.ok) return null;
  const v = `${String(c.ref).replace('.', ',')} km/h`;
  const d = Math.abs(Math.round(c.diff));
  if (c.significant && c.diff > 0) return { title: `Dormir poco te cuesta ${d} ppm`, text: `Tras las noches de menos de 6 h 30, tu pulso a ${v} sube ${d} ppm a la misma velocidad. Las noches de 7 h o más se notan en clase.` };
  if (c.significant) return { title: 'Dormir menos no te sube el pulso', text: `Tras las noches cortas tu pulso a ${v} incluso baja ${d} ppm. El sueño no es lo que más te frena ahora.` };
  return { title: 'Tu sueño no cambia tu pulso en clase', text: `Entre noches cortas y largas hay ${d} ppm de diferencia a ${v}: dentro de lo que varía de un día a otro.` };
}

/** Serie [[dayKey, v]] de Salud entre dos días, ordenada. */
function seriesBetween(list, from, to) {
  return (Array.isArray(list) ? list : [])
    .filter((p) => Array.isArray(p) && typeof p[0] === 'string' && p[0] >= from && p[0] <= to && Number(p[1]) > 0)
    .map((p) => ({ day: p[0], v: Number(p[1]) })).sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** VO2 máx que estima el Apple Watch (al caminar o correr al aire libre). → null | { last, change (null si < 3 semanas), weeks, points } */
export function vo2Trend(metrics, today, days = 70) {
  const pts = seriesBetween(metrics?.vo2, keyMinus(today, days - 1), today);
  if (!pts.length) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const span = (keyToMs(last.day) - keyToMs(first.day)) / DAY;
  return { last: Math.round(last.v * 10) / 10, lastDay: last.day, change: span >= 21 ? Math.round((last.v - first.v) * 10) / 10 : null, weeks: Math.round(span / 7), points: pts };
}

/** Pulsaciones que bajas en el primer minuto tras un entreno (Apple Watch). → null | { now, before (null si pocos), points } */
export function recoveryTrend(metrics, today, days = 70) {
  const pts = seriesBetween(metrics?.hrRecovery, keyMinus(today, days - 1), today);
  if (pts.length < 2) return null;
  const k = Math.min(3, Math.floor(pts.length / 2));
  const now = Math.round(mean(pts.slice(-k).map((p) => p.v)));
  const span = (keyToMs(pts[pts.length - 1].day) - keyToMs(pts[0].day)) / DAY;
  const before = pts.length >= 6 && span >= 14 ? Math.round(mean(pts.slice(0, k).map((p) => p.v))) : null;
  return { now, before, points: pts };
}

/** Medias semanales de una serie de Salud alineadas con las semanas de `loadBalance` (from = semanas atrás). */
export function weeklyAverages(list, today, weeks = 8) {
  const out = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const vals = seriesBetween(list, keyMinus(today, (w + 1) * 7 - 1), keyMinus(today, w * 7)).map((p) => p.v);
    out.push({ from: w, avg: vals.length >= 2 ? Math.round(mean(vals) * 10) / 10 : null });
  }
  return out;
}

/** «7:24» (horas:minutos) a partir de minutos. */
export function fmtSleep(min) {
  const m = Math.round(num(min));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
