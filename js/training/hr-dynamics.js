// RITMUP · modelo dinámico de tu pulso (sin DOM, sin IA: un modelo físico sencillo ajustado a tus clases).
//
// El pulso no salta a su valor al cambiar de velocidad: se acerca poco a poco (primer orden, constante de tiempo τ,
// distinta al subir y al bajar) a un pulso «de equilibrio» que depende de la velocidad, la inclinación y lo que llevas
// de clase (deriva / carga acumulada):
//     equilibrio(t) = a + b·km/h + c·%inclinación + d·carga(t)
//     pulso(t + Δ) = pulso(t) + (equilibrio − pulso) · (1 − e^(−Δ/τ))
// a cambia cada día (forma, sueño, calor…): se estima en directo con tus primeros minutos y se corrige sin parar.
// b, c, d, τ↑ y τ↓ son tuyos: salen de todas tus clases con pulso (mínimos cuadrados + búsqueda de τ).
//
// Con el modelo la app sabe, para cada tramo, a qué pulso llegarás y qué velocidad necesitas para ir en tu zona, en
// vez de reaccionar tarde con ±0,2 cuando ya te has pasado.

const DT = 5;                 // s por paso
const TAUS = [30, 40, 50, 60, 75, 90, 110, 135, 160];
const REF_JOG = 8.5;          // km/h: la carga acumulada cuenta lo que corres por encima de un trote
const r1 = (v) => Math.round(v * 10) / 10;

/** Velocidad en cada instante a partir de speedTrace [[t, km/h]] (escalones). */
function stepAt(trace) {
  const tr = (Array.isArray(trace) ? trace : []).filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number(p[1]) >= 0)
    .map((p) => [Number(p[0]), Number(p[1])]).sort((a, b) => a[0] - b[0]);
  return (t) => {
    let v = tr.length ? tr[0][1] : 0;
    for (const [x, s] of tr) { if (x <= t) v = s; else break; }
    return v;
  };
}

/** Inclinación en cada instante a partir de los tramos de la clase (posición en segundos). */
function inclineAt(segments) {
  const segs = Array.isArray(segments) ? segments : [];
  return (t) => {
    let acc = 0;
    for (const s of segs) { acc += Number(s.sec) || 0; if (t < acc) return Number(s.incline) || 0; }
    return 0;
  };
}

/**
 * Entradas de una clase cada 5 s: { t, v, g, load, hr } (hr null en huecos). load = km/h·min por encima de un trote.
 * session: { hrSeries, speedTrace, elapsedSec } · segments: los de la clase (para la inclinación), opcional.
 */
export function classInputs(session, segments = null) {
  const hrs = (Array.isArray(session?.hrSeries) ? session.hrSeries : [])
    .filter((p) => Array.isArray(p) && Number(p[1]) >= 40 && Number(p[1]) <= 230).map((p) => [Number(p[0]), Number(p[1])])
    .sort((a, b) => a[0] - b[0]);
  if (hrs.length < 12) return null;
  const vAt = stepAt(session.speedTrace);
  const gAt = inclineAt(segments);
  const end = Math.max(hrs[hrs.length - 1][0], Number(session.elapsedSec) || 0);
  const out = { t: [], v: [], g: [], load: [], hr: [] };
  let load = 0;
  let j = 0;
  for (let t = 0; t <= end; t += DT) {
    const v = vAt(t);
    while (j + 1 < hrs.length && hrs[j + 1][0] <= t) j++;
    const a = hrs[j];
    const b = hrs[j + 1];
    let hr = null;
    if (a && a[0] <= t && b && b[0] - a[0] <= 30) hr = a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
    else if (a && Math.abs(a[0] - t) <= 5) hr = a[1];
    out.t.push(t); out.v.push(v); out.g.push(gAt(t)); out.load.push(load); out.hr.push(hr);
    load += (Math.max(0, v - REF_JOG) * DT) / 60;
  }
  return out;
}

/** Pulso de equilibrio con el modelo. */
export function equilibrium(m, a, v, g = 0, load = 0) {
  return a + m.b * v + m.c * g + m.d * load;
}

/** Simula el pulso desde hr0 con las entradas (v, g, load por paso). → array */
export function simulate(m, a, inp, hr0) {
  const up = 1 - Math.exp(-DT / m.tauUp);
  const dn = 1 - Math.exp(-DT / m.tauDown);
  const out = new Array(inp.v.length);
  let y = hr0;
  for (let k = 0; k < inp.v.length; k++) {
    out[k] = y;
    const x = equilibrium(m, a, inp.v[k], inp.g[k], inp.load[k]);
    y += (x - y) * (x > y ? up : dn);
  }
  return out;
}

/* Mínimos cuadrados pequeños (ecuaciones normales con un poco de ridge). */
function solve(A, y, ridge = 1e-6) {
  const n = A[0].length;
  const M = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let r = 0; r < A.length; r++) {
    const row = A[r];
    for (let i = 0; i < n; i++) {
      if (!row[i]) continue;
      for (let k = 0; k < n; k++) M[i][k] += row[i] * row[k];
      M[i][n] += row[i] * y[r];
    }
  }
  for (let i = 0; i < n; i++) M[i][i] += ridge;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    const d = M[i][i] || 1e-12;
    for (let k = i; k <= n; k++) M[i][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === i || !M[r][i]) continue;
      const f = M[r][i];
      for (let k = i; k <= n; k++) M[r][k] -= f * M[i][k];
    }
  }
  return M.map((row) => row[n]);
}

/**
 * Ajuste con tus clases. classes: [{ id, inp }] (classInputs). Parámetros comunes b, c, d, τ↑, τ↓ y un a por clase.
 * → null (pocos datos) o { b, c, d, tauUp, tauDown, a: {id: a}, aTypical, rmse, n }
 */
export function fitHrDynamics(classes, { taus = TAUS } = {}) {
  const cls = (classes || []).filter((c) => c?.inp && c.inp.hr.filter((x) => x != null).length >= 30);
  if (cls.length < 2) return null;
  const hasIncline = cls.some((c) => c.inp.g.some((g) => g > 0));
  let best = null;
  for (const tauUp of taus) {
    for (const tauDown of taus) {
      // dos pasadas: la primera supone subida siempre que el equilibrio esté por encima del pulso simulado
      let m = { b: 7, c: hasIncline ? 2 : 0, d: 0.1, tauUp, tauDown };
      let a = cls.map((c) => (c.inp.hr.find((x) => x != null) || 120) - 0);
      let fit = null;
      for (let pass = 0; pass < 3; pass++) {
        const rows = [];
        const ys = [];
        const nA = cls.length;
        const nP = 3; // b, c, d
        cls.forEach((c, ci) => {
          const { inp } = c;
          const hr0 = inp.hr.find((x) => x != null);
          const sim = simulate(m, a[ci], inp, hr0);
          // respuestas filtradas de cada regresor con el patrón subida/bajada de la simulación
          const up = 1 - Math.exp(-DT / tauUp);
          const dn = 1 - Math.exp(-DT / tauDown);
          const f = new Array(nA + nP).fill(0);
          let hom = hr0;
          for (let k = 0; k < inp.v.length; k++) {
            if (inp.hr[k] != null && k > 0) {
              const row = new Array(nA + nP).fill(0);
              row[ci] = f[ci];
              row[nA] = f[nA]; row[nA + 1] = hasIncline ? f[nA + 1] : 0; row[nA + 2] = f[nA + 2];
              rows.push(row);
              ys.push(inp.hr[k] - hom);
            }
            const x = equilibrium(m, a[ci], inp.v[k], inp.g[k], inp.load[k]);
            const al = x > sim[k] ? up : dn;
            f[ci] += (1 - f[ci]) * al;
            f[nA] += (inp.v[k] - f[nA]) * al;
            f[nA + 1] += (inp.g[k] - f[nA + 1]) * al;
            f[nA + 2] += (inp.load[k] - f[nA + 2]) * al;
            hom *= 1 - al;
          }
        });
        const th = solve(rows, ys);
        a = th.slice(0, cls.length);
        m = { b: th[cls.length], c: hasIncline ? th[cls.length + 1] : 0, d: th[cls.length + 2], tauUp, tauDown };
        // error
        let se = 0;
        let n = 0;
        cls.forEach((c, ci) => {
          const hr0 = c.inp.hr.find((x) => x != null);
          const sim = simulate(m, a[ci], c.inp, hr0);
          c.inp.hr.forEach((h, k) => { if (h != null) { se += (h - sim[k]) ** 2; n++; } });
        });
        fit = { m, a, rmse: Math.sqrt(se / Math.max(1, n)), n };
      }
      if (!best || fit.rmse < best.rmse) best = fit;
    }
  }
  if (!best || !(best.m.b > 0)) return null;
  // con poca cuesta en tus clases, el efecto de la inclinación no se puede medir: se usa el típico (≈ 1 % de cuesta
  // pesa como 0,45 km/h más)
  const inclineMin = cls.reduce((s, c) => s + c.inp.g.filter((x) => x > 0).length, 0) * DT / 60;
  if (inclineMin < 30 || !(best.m.c > 0)) best.m.c = 0.45 * best.m.b;
  // tu a típico: la mediana de las 5 últimas clases (tu forma de ahora, no la de hace dos meses)
  const recent = best.a.slice(-5).sort((x, y) => x - y);
  const aTypical = recent[Math.floor(recent.length / 2)];
  const aMap = {};
  cls.forEach((c, i) => { aMap[c.id] = best.a[i]; });
  // cuánto varía tu pulso de un día a otro (mediana de las desviaciones, robusta a los días raros): marca qué es «día alto»
  let aSpread = 0;
  if (best.a.length >= 5) {
    const sorted = [...best.a].sort((x, y) => x - y);
    const med = sorted[sorted.length >> 1];
    const dev = sorted.map((x) => Math.abs(x - med)).sort((x, y) => x - y);
    aSpread = dev[dev.length >> 1] * 1.4826;
  }
  return { ...best.m, a: aMap, aTypical, aSpread, rmse: best.rmse, n: best.n, classes: cls.length };
}

/**
 * Modelo inicial tras tu PRIMERA clase con pulso: la respuesta típica (escalada a tu reserva de pulso) y tu a medido en
 * la segunda mitad de esa clase. Probado con clases reales: predice el pulso a 60 s casi igual que el modelo completo
 * (2,8 ppm de error frente a 2,8; sin modelo, 5,4) y da igual si la pendiente típica se desvía entre 8 y 12.
 * `starter`: sirve para seguir tu pulso y bajar si hace falta; no ajusta la clase de antemano ni detecta días altos.
 */
export function starterModel(inp, profile = {}) {
  const hrMax = Number(profile?.hrMax) > 0 ? Number(profile.hrMax) : 220 - (Number(profile?.age) || 46);
  const rest = Number(profile?.hrRest) > 0 ? Number(profile.hrRest) : 65;
  const b = 9.9 * Math.max(0.6, Math.min(1.4, (hrMax - rest) / 111));
  const m = { b, c: 0.45 * b, d: 0.37, tauUp: 90, tauDown: 110 };
  let sum = 0;
  let n = 0;
  for (let i = Math.floor(inp.t.length / 2); i < inp.t.length; i++) {
    if (inp.hr[i] == null) continue;
    sum += inp.hr[i] - m.b * inp.v[i] - m.c * inp.g[i] - m.d * inp.load[i];
    n++;
  }
  return n >= 12 ? { ...m, aTypical: sum / n, aSpread: 0, starter: true, classes: 1 } : null;
}

/**
 * Seguimiento en directo. Simula la clase con tu a típico y compara con lo que marca el reloj: la diferencia media
 * (que va sobre todo del día: forma, sueño, calor) se convierte en tu a de hoy. El pulso de ahora es la lectura real
 * suavizada; desde él se predice.
 *
 * DÍA ALTO: si a los 3 min sigues ≥ 6 ppm por encima de lo típico, ese exceso no se queda ahí: en las clases reales
 * (1 y 8 nov: +7 al principio, +15 al final; en las otras 15 clases el seguidor no pasó de +4 a los 5 min) casi se
 * duplica. `forecastA` es el a con el que conviene decidir los tramos que vienen; en un día normal es igual que `a`.
 */
const HIGH_ON = 6;          // ppm; quien varía mucho de un día a otro necesita más para que sea «alto» (1,5 × su dispersión)
const HIGH_ON_MAX = 10;
const HIGH_FROM = 180;      // s desde la primera lectura
const FORECAST_K = 1.8;
const FORECAST_MAX = 15;

export function createTracker(model, { a0 = model?.aTypical, fastGain = 0.15, gain = 0.04, fastReadings = 36 } = {}) {
  let core = null;    // pulso simulado con a0
  let obs = null;     // lectura suavizada
  let bias = 0;       // tu día frente a lo típico (ppm)
  let lastT = null;
  let firstT = null;
  let high = false;
  let seen = 0;
  const highOn = Math.min(HIGH_ON_MAX, Math.max(HIGH_ON, 1.5 * (Number(model?.aSpread) || 0)));
  return {
    get a() { return a0 + bias; },
    get hr() { return obs; },
    get bias() { return bias; },
    get highDay() { return high; },
    get forecastA() { return a0 + (high ? Math.max(bias, Math.min(FORECAST_MAX, bias * FORECAST_K)) : bias); },
    /** Avanza al instante t (s de clase) con la velocidad, inclinación y carga actuales; hr: lectura real o null. */
    step(t, v, g, load, hr) {
      if (core == null) { if (hr == null) return; core = hr; obs = hr; lastT = t; firstT = t; return; }
      const dt = Math.max(0, t - lastT);
      if (dt > 0) {
        const x = equilibrium(model, a0, v, g, load);
        core += (x - core) * (1 - Math.exp(-dt / (x > core ? model.tauUp : model.tauDown)));
        lastT = t;
      }
      if (hr != null) {
        obs += (hr - obs) * 0.5;
        // al principio el pulso aún viene de la fase de arranque: la diferencia cuenta más cuando ya ha pasado un rato
        const w = seen < fastReadings ? fastGain : gain;
        bias += w * ((hr - core) - bias);
        seen++;
        if (!model?.starter && t - firstT >= HIGH_FROM) {
          if (!high && bias >= highOn) high = true;
          else if (high && bias < highOn / 2) high = false;
        }
      }
    },
  };
}

/** Pulso al cabo de `sec` segundos a velocidad v desde el pulso actual (con el a del día). */
export function hrAfter(model, a, hrNow, sec, v, g = 0, load = 0) {
  const x = equilibrium(model, a, v, g, load);
  const tau = x > hrNow ? model.tauUp : model.tauDown;
  return x + (hrNow - x) * Math.exp(-sec / tau);
}

/**
 * Velocidad para que, al final de `sec` segundos, el pulso quede en `target` (despejando el modelo).
 * Si el tramo es corto y no da tiempo, devuelve la del equilibrio (lo más que tiene sentido pedir).
 */
export function speedForHr(model, a, hrNow, sec, target, g = 0, load = 0) {
  const tau = target > hrNow ? model.tauUp : model.tauDown;
  const w = 1 - Math.exp(-sec / tau);
  const x = w > 0.35 ? (target - hrNow * (1 - w)) / w : target;
  return r1((x - a - model.c * g - model.d * load) / model.b);
}

export const HR_DT = DT;
