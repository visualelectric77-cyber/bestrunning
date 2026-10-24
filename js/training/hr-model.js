// RITMUP · modelo personal pulso–velocidad. Aprende de tus sesiones con pulso del reloj qué pulso sueles llevar a cada
// velocidad (ya estabilizado) y sirve para ver un día «cargado»: mismo ritmo, bastante más pulso de lo normal
// (cansancio, mal sueño, calor o estar incubando algo). Orientativo: nunca diagnostica nada.
//
// Datos: session.hrSeries [[t s de clase, ppm]] cada 10 s y session.speedTrace [[t, km/h]] (cambios de velocidad).
// Solo cuentan puntos con ≥ 150 s a la misma velocidad (el pulso ya ha subido) y entre 6 y 18 km/h.
// Ajuste lineal ppm = a + b·km/h por mínimos cuadrados.

const STEADY_SEC = 150;
const MIN_SESSIONS = 2;
const MIN_POINTS = 20;
const WINDOW_DAYS = 56;

/** Puntos [km/h, ppm] estables de una sesión. */
export function steadyPoints(session) {
  const hr = (Array.isArray(session?.hrSeries) ? session.hrSeries : [])
    .filter((p) => Array.isArray(p) && Number(p[1]) >= 60 && Number(p[1]) <= 220).map((p) => [Number(p[0]), Number(p[1])]);
  const tr = (Array.isArray(session?.speedTrace) ? session.speedTrace : [])
    .filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number(p[1]) > 0).map((p) => [Number(p[0]), Number(p[1])])
    .sort((a, b) => a[0] - b[0]);
  if (hr.length < 6 || !tr.length) return [];
  const out = [];
  for (const [t, bpm] of hr) {
    let i = -1;
    for (let k = 0; k < tr.length && tr[k][0] <= t; k++) i = k;
    if (i < 0) continue;
    const speed = tr[i][1];
    if (t - tr[i][0] < STEADY_SEC || speed < 6 || speed > 18) continue;
    out.push([speed, bpm]);
  }
  return out;
}

/**
 * Modelo con las sesiones de las últimas 8 semanas (menos `exceptId`). → null o { a, b, n, sessions, at(kmh) }.
 */
export function buildHrModel(history, { now = Date.now(), exceptId = null } = {}) {
  const since = now - WINDOW_DAYS * 86400000;
  let pts = [];
  let sessions = 0;
  for (const h of Array.isArray(history) ? history : []) {
    if (!h || h.id === exceptId || h.isTest) continue;
    const t = Date.parse(h.startedAt || '');
    if (Number.isFinite(t) && t < since) continue;
    const p = steadyPoints(h);
    if (p.length >= 5) { pts = pts.concat(p); sessions++; }
  }
  if (sessions < MIN_SESSIONS || pts.length < MIN_POINTS) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  const sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  const sxy = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  // Con todas las velocidades casi iguales la pendiente no se sabe: se usa una típica (≈ 6 ppm por km/h)
  const b = sxx > 4 ? Math.max(2, Math.min(14, sxy / sxx)) : 6;
  const a = my - b * mx;
  return { a, b, n, sessions, at: (kmh) => a + b * kmh };
}

/** Diferencia media (ppm) entre el pulso de una sesión y lo normal a sus velocidades. null sin datos. */
export function sessionHrOffset(session, model) {
  if (!model) return null;
  const p = steadyPoints(session);
  if (p.length < 6) return null;
  const d = p.map(([v, bpm]) => bpm - model.at(v));
  const mean = d.reduce((s, x) => s + x, 0) / d.length;
  const speed = p.reduce((s, x) => s + x[0], 0) / p.length;
  return { ppm: Math.round(mean), speed: Math.round(speed * 10) / 10, points: p.length };
}
