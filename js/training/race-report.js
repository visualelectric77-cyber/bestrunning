// RITMUP · informe de una carrera en la cinta (sin DOM): la carrera se cuenta APARTE del calentamiento y de la vuelta a
// la calma. De la sesión guardada salen el tiempo y el ritmo de la carrera, los parciales de cada kilómetro (tiempo real
// y pulso), cómo se repartió el esfuerzo, la recuperación al cruzar la meta y lo que duraron el calentamiento y la
// vuelta a la calma. Solo cálculos con lo medido: si falta un dato, no se inventa.
//
// Posición y tiempo: en el tramo de carrera la posición de la clase avanza por metros (js/player/engine.js), así que
// el km k cae siempre en inicio + k·3600/velocidad_del_plan y el tiempo real de un trozo es ∫ (plan / velocidad) dpos.
import { fmt } from '../core/utils.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = (x) => Math.round(x * 10) / 10;

/** Velocidad indicada en cada posición de la clase (escalones de speedTrace). */
function speedAtOf(trace) {
  const tr = (Array.isArray(trace) ? trace : []).filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number(p[1]) >= 0)
    .map((p) => [Number(p[0]), Number(p[1])]);
  return {
    ok: tr.length >= 2,
    /** Cortes (posiciones donde cambia la velocidad) dentro de (a, b). */
    cuts(a, b) { return [...new Set(tr.map((p) => p[0]).filter((t) => t > a && t < b))].sort((x, y) => x - y); },
    at(t) { let v = tr.length ? tr[0][1] : 0; for (const p of tr) { if (p[0] <= t) v = p[1]; else break; } return v; },
  };
}

/** Pulso de un trozo de la clase (posiciones [a, b)). → { avg, max, end, n } o null */
function hrIn(series, a, b) {
  const v = (Array.isArray(series) ? series : []).filter((p) => Array.isArray(p) && num(p[0]) >= a && num(p[0]) < b && num(p[1]) >= 40 && num(p[1]) <= 230)
    .map((p) => num(p[1]));
  if (v.length < 2) return null;
  return { avg: Math.round(v.reduce((x, y) => x + y, 0) / v.length), max: Math.round(Math.max(...v)), end: Math.round(v[v.length - 1]), n: v.length };
}

/**
 * Informe de la carrera, o null si la sesión no es una carrera terminada (o faltan los tramos).
 * @param {object} session  sesión guardada (race, speedTrace, hrSeries, elapsedSec, distanceKm)
 * @param {Array} segments  tramos de la clase (los de workoutFromId): el de carrera lleva race: true
 */
export function raceReport(session, segments) {
  const s = session;
  const race = s?.race;
  const segs = Array.isArray(segments) ? segments : [];
  const idx = segs.findIndex((g) => g?.race);
  if (!race || !(num(race.sec) > 0) || !(num(race.km) > 0) || idx < 0) return null;
  const km = num(race.km);
  const sec = Math.round(num(race.sec));
  const start = segs.slice(0, idx).reduce((a, g) => a + num(g.sec), 0);
  const end = start + num(segs[idx].sec);
  const total = segs.reduce((a, g) => a + num(g.sec), 0);
  const plan = num(segs[idx].speed);
  const sp = speedAtOf(s.speedTrace);
  /** Segundos reales y km entre dos posiciones; dentro de la carrera, la posición va a (velocidad / plan). */
  const span = (a, b, inRace) => {
    let t = 0;
    let d = 0;
    const pts = [a, ...sp.cuts(a, b), b];
    for (let i = 0; i < pts.length - 1; i++) {
      const dp = pts[i + 1] - pts[i];
      const v = sp.ok ? sp.at(pts[i]) : (inRace ? plan : 0);
      if (inRace) { if (v > 0 && plan > 0) { t += (dp * plan) / v; d += (dp * plan) / 3600; } } else { t += dp; d += (v * dp) / 3600; }
    }
    return { sec: t, km: d };
  };

  const kmPos = plan > 0 ? 3600 / plan : 0;
  const splits = [];
  if (kmPos > 0 && sp.ok) {
    const whole = Math.floor(km + 1e-9);
    // el tramo dura unos metros más que la distancia: los parciales se ajustan para que sumen el tiempo guardado
    const raw = [];
    for (let k = 1; k <= whole; k++) raw.push(span(start + (k - 1) * kmPos, Math.min(end, start + k * kmPos), true).sec);
    const rest = km - whole > 0.01 ? span(start + whole * kmPos, Math.min(end, start + km * kmPos), true).sec : 0;
    const sum = raw.reduce((a, b) => a + b, 0) + rest;
    const fix = sum > 0 ? sec / sum : 1;
    for (let k = 1; k <= whole; k++) {
      const t = raw[k - 1] * fix;
      const h = hrIn(s.hrSeries, start + (k - 1) * kmPos, start + k * kmPos);
      splits.push({ km: k, sec: Math.round(t), speed: t > 0 ? r1(3600 / t) : 0, hrAvg: h?.avg ?? null, hrMax: h?.max ?? null });
    }
  }

  const hr = hrIn(s.hrSeries, start, end);
  // Recuperación: lo que baja el pulso 1 y 2 min después de cruzar la meta (frente al del final de la carrera)
  let recovery = null;
  if (hr) {
    const at = (t) => {
      const p = (s.hrSeries || []).filter((q) => Array.isArray(q) && num(q[0]) >= t - 8 && num(q[0]) <= t + 8).map((q) => num(q[1]));
      return p.length ? Math.round(p.reduce((a, b) => a + b, 0) / p.length) : null;
    };
    const fin = at(end - 5) ?? hr.end;
    const m1 = at(end + 60);
    const m2 = at(end + 120);
    if (fin && m1) recovery = { end: fin, min1: fin - m1, min2: m2 ? fin - m2 : null };
  }

  // Reparto: segunda mitad frente a la primera (por kilómetros enteros)
  let pacing = null;
  if (splits.length >= 2) {
    const half = Math.floor(splits.length / 2);
    const a = splits.slice(0, half).reduce((x, y) => x + y.sec, 0) / half;
    const b = splits.slice(-half).reduce((x, y) => x + y.sec, 0) / half;
    const diff = Math.round(b - a);              // s/km de más (+) o de menos (−) en la segunda mitad
    const spread = Math.max(...splits.map((x) => x.sec)) - Math.min(...splits.map((x) => x.sec));
    pacing = { diff, spread, kind: Math.abs(diff) <= 4 ? 'even' : diff > 0 ? 'fade' : 'negative' };
  }

  const warm = span(0, start, false);
  const cool = span(end, total, false);
  return {
    key: String(race.key || ''), label: String(race.label || `${fmt.km(km)} km`), km, sec,
    paceSec: Math.round(sec / km), speed: r1((km / sec) * 3600),
    startSpeed: sp.ok ? sp.at(start) : plan, endSpeed: sp.ok ? sp.at(end - 1) : plan, planSpeed: plan,
    splits, hr: hr ? { avg: hr.avg, max: hr.max, end: hr.end } : null, recovery, pacing,
    warm: { sec: Math.round(warm.sec), km: Math.round(warm.km * 100) / 100 },
    cool: { sec: Math.round(cool.sec), km: Math.round(cool.km * 100) / 100 },
    total: { sec: Math.round(num(s.elapsedSec)), km: Math.round(num(s.distanceKm) * 100) / 100 },
  };
}

/**
 * «Tu carrera» en palabras, para la tarjeta de la clase (misma forma que classDebrief): { kind: 'race', headline, body, tip }.
 * `hrMax`: tu pulso máximo del perfil (para decir cuánto te acercaste), opcional.
 */
export function raceDebrief(report, { hrMax = null, feeling = '' } = {}) {
  const r = report;
  if (!r) return null;
  const parts = [`${r.label} en ${fmt.clock(r.sec)}, a ${fmt.clock(r.paceSec)} /km (${fmt.speed(r.speed)} km/h de media).`];
  if (r.pacing && r.splits.length >= 2) {
    const fast = Math.min(...r.splits.map((x) => x.sec));
    const slow = Math.max(...r.splits.map((x) => x.sec));
    parts.push(r.pacing.kind === 'even'
      ? `Muy regular: todos los kilómetros entre ${fmt.clock(fast)} y ${fmt.clock(slow)}.`
      : r.pacing.kind === 'fade'
        ? `Acabaste ${r.pacing.diff} s por kilómetro más lento que empezaste (de ${fmt.clock(fast)} a ${fmt.clock(slow)}).`
        : `De menos a más: la segunda mitad, ${Math.abs(r.pacing.diff)} s por kilómetro más rápida.`);
  }
  if (r.hr) {
    const max = num(hrMax);
    parts.push(max > 0 && r.hr.max >= max - 3
      ? `Llegaste a ${r.hr.max} ppm, prácticamente tu máxima (${max}).`
      : max > 0 ? `Llegaste a ${r.hr.max} ppm; tu máxima es ${max}.` : `Llegaste a ${r.hr.max} ppm.`);
  }
  let tip = 'Una carrera es un esfuerzo grande: los próximos días, suave.';
  const max = num(hrMax);
  const notAllOut = feeling === 'easy' || feeling === 'ok' || feeling === 'hard';
  if (r.hr && max > 0 && r.hr.max >= max - 2 && notAllOut) tip = 'Llegaste a tu máxima sin ir al límite: puede que tu pulso máximo real sea más alto. El Test VAM lo afinará.';
  else if (r.pacing?.kind === 'fade' && r.pacing.diff >= 8) tip = 'La próxima, sal un punto más suave: lo que guardes al principio lo ganas al final.';
  else if (r.recovery && r.recovery.min1 >= 20) tip = `Tu pulso bajó ${r.recovery.min1} ppm en el primer minuto tras la meta: buena recuperación.`;
  return { kind: 'race', headline: `Tu ${r.label}: ${fmt.clock(r.sec)}`, body: parts.join(' '), tip };
}
