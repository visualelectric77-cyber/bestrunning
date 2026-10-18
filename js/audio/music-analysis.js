// BestRunning · análisis musical "de DJ" en el propio dispositivo (sin DOM: Node, Worker o hilo principal).
// Puerto fiel de tools/music/analyze.py (mismas fórmulas, rejillas y umbrales) para que las pistas importadas
// tengan los mismos metadatos que la biblioteca integrada: BPM a 0,01, fase de tiempo y compás, energía por
// compás, drops, mixIn, outro y hotBars. Añade sonoridad integrada BS.1770 (ponderación K, puertas −70/−10)
// → gainDb hacia −14 LUFS, remuestreo a 22 050 Hz, mezcla a mono y tap tempo.
// Convención heredada del analizador Python: los tiempos de beat salen ~80 ms adelantados respecto al golpe
// real (ventanas STFT de 2048 sin centrar: el flujo espectral salta cuando el golpe entra en la ventana).
// Se conserva a propósito para que cuadren las mezclas entre pistas integradas e importadas; quien necesite
// el instante audible (animaciones a ritmo) suma BEAT_LEAD_SEC.

export const ANALYSIS_SR = 22050;
export const ANALYSIS_HOP = 256;
export const ANALYSIS_VERSION = 1;
export const TARGET_LUFS = -14;
export const MAX_GAIN_DB = 12;
/** Adelanto medido de beatOffset/barOffset respecto al golpe audible (s), en library.json y en este análisis. */
export const BEAT_LEAD_SEC = 0.08;

const N_FFT = 2048;
const N_BINS = N_FFT / 2 + 1;
const FR = ANALYSIS_SR / ANALYSIS_HOP; // fotogramas por segundo de la envolvente
const PEAK_CEIL_DB = -1;               // techo de pico tras aplicar gainDb (como el −1 dBTP de la biblioteca)

/** Prior por tramo y rangos de BPM → tramo (idénticos a analyze.py). */
export const TIER_PRIOR = { calm: 110, jog: 123, run: 128, fast: 138, sprint: 165 };
export const TIER_RANGES = [
  { tier: 'calm', min: 0, max: 118 },
  { tier: 'jog', min: 118, max: 126 },
  { tier: 'run', min: 126, max: 134 },
  { tier: 'fast', min: 134, max: 148 },
  { tier: 'sprint', min: 148, max: 999 },
];

export function tierForBpm(bpm) {
  for (const r of TIER_RANGES) if (bpm >= r.min && bpm < r.max) return r.tier;
  return 'sprint';
}

const round2 = (x) => Math.round(x * 100) / 100;
const round3 = (x) => Math.round(x * 1000) / 1000;
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
const nowMs = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

/* ───────────── Ejecución por pasos (generadores) ─────────────
   Cada cálculo largo es un generador que cede { p, stage }; se puede drenar de golpe (Worker, Node) o en
   rodajas de pocos ms cediendo al bucle de eventos (hilo principal sin Worker: la interfaz no se congela). */

function drain(gen, onProgress) {
  for (;;) {
    const { value, done } = gen.next();
    if (done) return value;
    if (onProgress) onProgress(value.p, value.stage);
  }
}

async function drainAsync(gen, onProgress, sliceMs = 14) {
  let t0 = nowMs();
  for (;;) {
    const { value, done } = gen.next();
    if (done) return value;
    if (onProgress) onProgress(value.p, value.stage);
    if (nowMs() - t0 > sliceMs) {
      await new Promise((r) => setTimeout(r, 0));
      t0 = nowMs();
    }
  }
}

/* ───────────── FFT real radix-2 (N = 2048 vía FFT compleja de N/2) ───────────── */

function createRealFft(n) {
  const m = n >> 1;
  const bits = Math.round(Math.log2(m));
  const rev = new Uint32Array(m);
  for (let i = 0; i < m; i++) {
    let r = 0;
    for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
    rev[i] = r;
  }
  const cosT = new Float64Array(m >> 1);
  const sinT = new Float64Array(m >> 1);
  for (let i = 0; i < m >> 1; i++) {
    cosT[i] = Math.cos((2 * Math.PI * i) / m);
    sinT[i] = Math.sin((2 * Math.PI * i) / m);
  }
  const wc = new Float64Array(m + 1);
  const ws = new Float64Array(m + 1);
  for (let k = 0; k <= m; k++) {
    wc[k] = Math.cos((2 * Math.PI * k) / n);
    ws[k] = Math.sin((2 * Math.PI * k) / n);
  }
  const re = new Float64Array(m);
  const im = new Float64Array(m);

  /** |rfft(x[off..off+n) · win)| → out[0..m] (m + 1 bins). Muestras fuera de rango cuentan como 0. */
  return function magnitudes(x, off, win, out) {
    const len = x.length;
    for (let i = 0; i < m; i++) {
      const a = off + 2 * i;
      const j = rev[i];
      re[j] = a < len ? x[a] * win[2 * i] : 0;
      im[j] = a + 1 < len ? x[a + 1] * win[2 * i + 1] : 0;
    }
    for (let size = 2; size <= m; size <<= 1) {
      const half = size >> 1;
      const step = m / size;
      for (let start = 0; start < m; start += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const wr = cosT[t];
          const wi = -sinT[t];
          const a = start + k;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
    // Desempaquetado: X[k] = E[k] + W^k·O[k]
    out[0] = Math.abs(re[0] + im[0]);
    out[m] = Math.abs(re[0] - im[0]);
    for (let k = 1; k < m; k++) {
      const zr = re[k];
      const zi = im[k];
      const cr = re[m - k];
      const ci = -im[m - k];
      const er = 0.5 * (zr + cr);
      const ei = 0.5 * (zi + ci);
      const or = 0.5 * (zi - ci);
      const oi = -0.5 * (zr - cr);
      const c = wc[k];
      const s = -ws[k];
      const xr = er + (c * or - s * oi);
      const xi = ei + (c * oi + s * or);
      out[k] = Math.sqrt(xr * xr + xi * xi);
    }
    return out;
  };
}

let fftCache = null;
function realFft() {
  if (!fftCache) fftCache = createRealFft(N_FFT);
  return fftCache;
}

/** Ventana de Hann simétrica (np.hanning). */
function hanning(n, gain = 1) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = gain * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

/** Magnitud del espectro de un fotograma (para tests y depuración). */
export function spectrumMagnitudes(frame) {
  const out = new Float64Array(N_BINS);
  const ones = new Float64Array(N_FFT).fill(1);
  return realFft()(frame, 0, ones, out);
}

/* ───────────── Mezcla a mono y remuestreo ───────────── */

/** Mezcla a mono con el mismo criterio que `ffmpeg -ac 1` (Σ canales / √N): el análisis ve el mismo nivel que en Python. */
export function downmix(channels) {
  const chs = Array.isArray(channels) ? channels : [channels];
  if (!chs.length) return new Float32Array(0);
  const n = chs[0].length;
  const out = new Float32Array(n);
  if (chs.length === 1) {
    out.set(chs[0]);
    return out;
  }
  const g = 1 / Math.sqrt(chs.length);
  if (chs.length === 2) {
    const a = chs[0];
    const b = chs[1];
    for (let i = 0; i < n; i++) out[i] = (a[i] + b[i]) * g;
    return out;
  }
  for (const c of chs) for (let i = 0; i < n; i++) out[i] += c[i] * g;
  return out;
}

function besselI0(x) {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 50; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

const kaiser = (u, beta, i0b) => (Math.abs(u) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - u * u)) / i0b);

/** Diezmado ×2 con filtro de media banda (Kaiser): ruta rápida 44 100 → 22 050. */
function* halfbandGen(x, p0, p1) {
  const HW = 31; // taps impares ±1…±31 (los pares son cero)
  const beta = 7;
  const i0b = besselI0(beta);
  const taps = [];
  for (let k = 1; k <= HW; k += 2) {
    const s = Math.sin((Math.PI * k) / 2) / ((Math.PI * k) / 2);
    taps.push(0.5 * s * kaiser(k / (HW + 1), beta, i0b));
  }
  const center = 0.5;
  const sumAll = center + 2 * taps.reduce((a, b) => a + b, 0);
  const h = Float64Array.from(taps, (t) => t / sumAll);
  const hc = center / sumAll;
  const nT = h.length;
  const n = x.length;
  const outLen = Math.ceil(n / 2);
  const y = new Float32Array(outLen);
  const CH = 1 << 16;
  for (let j0 = 0; j0 < outLen; j0 += CH) {
    const j1 = Math.min(outLen, j0 + CH);
    for (let j = j0; j < j1; j++) {
      const c = 2 * j;
      let acc = hc * x[c];
      if (c - HW >= 0 && c + HW < n) {
        for (let t = 0; t < nT; t++) {
          const d = 2 * t + 1;
          acc += h[t] * (x[c - d] + x[c + d]);
        }
      } else {
        for (let t = 0; t < nT; t++) {
          const d = 2 * t + 1;
          const l = c - d >= 0 ? x[c - d] : 0;
          const r = c + d < n ? x[c + d] : 0;
          acc += h[t] * (l + r);
        }
      }
      y[j] = acc;
    }
    yield { p: p0 + ((p1 - p0) * j1) / outLen, stage: 'resample' };
  }
  return y;
}

/** Remuestreo genérico con sinc enventanada (Kaiser) y tabla de fases. */
function* sincResampleGen(x, inRate, outRate, p0, p1) {
  const ratio = inRate / outRate;
  const fc = 0.475 * Math.min(1, 1 / ratio);       // corte en ciclos por muestra de entrada
  const W = Math.ceil(16 * Math.max(1, ratio));    // semiancho en muestras de entrada
  const PH = 512;                                  // fases por muestra
  const beta = 6;
  const i0b = besselI0(beta);
  const taps = 2 * W;
  const table = new Float64Array((PH + 1) * taps);
  for (let p = 0; p <= PH; p++) {
    const frac = p / PH;
    for (let k = 0; k < taps; k++) {
      const d = k - W + 1 - frac; // distancia de la muestra (i0 − W + 1 + k) al punto t
      const sx = 2 * fc * d;
      const sinc = Math.abs(sx) < 1e-12 ? 1 : Math.sin(Math.PI * sx) / (Math.PI * sx);
      table[p * taps + k] = 2 * fc * sinc * kaiser(d / W, beta, i0b);
    }
  }
  const n = x.length;
  const outLen = Math.max(0, Math.floor((n * outRate) / inRate));
  const y = new Float32Array(outLen);
  const CH = 1 << 15;
  for (let j0 = 0; j0 < outLen; j0 += CH) {
    const j1 = Math.min(outLen, j0 + CH);
    for (let j = j0; j < j1; j++) {
      const t = j * ratio;
      const i0 = Math.floor(t);
      const base = Math.round((t - i0) * PH) * taps;
      const s0 = i0 - W + 1;
      let acc = 0;
      if (s0 >= 0 && s0 + taps <= n) {
        for (let k = 0; k < taps; k++) acc += x[s0 + k] * table[base + k];
      } else {
        for (let k = 0; k < taps; k++) {
          const s = s0 + k;
          if (s >= 0 && s < n) acc += x[s] * table[base + k];
        }
      }
      y[j] = acc;
    }
    yield { p: p0 + ((p1 - p0) * j1) / outLen, stage: 'resample' };
  }
  return y;
}

function* resampleGen(x, inRate, p0 = 0, p1 = 1) {
  if (!(inRate > 0)) throw new Error('Frecuencia de muestreo no válida');
  if (Math.abs(inRate - ANALYSIS_SR) < 1e-6) return x;
  if (Math.abs(inRate - 2 * ANALYSIS_SR) < 1e-6) return yield* halfbandGen(x, p0, p1);
  return yield* sincResampleGen(x, inRate, ANALYSIS_SR, p0, p1);
}

/** Float32Array mono a cualquier frecuencia → 22 050 Hz (devuelve la misma matriz si ya lo está). */
export function resampleTo22050(input, inRate) {
  return drain(resampleGen(input, inRate));
}

/* ───────────── Sonoridad integrada (ITU-R BS.1770-4) ───────────── */

/** Coeficientes de la ponderación K para cualquier frecuencia (derivación de libebur128). */
export function kWeighting(fs) {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const highpass = { b: [1, -2, 1], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return { shelf, highpass };
}

function* loudnessGen(channels, sampleRate, { weight = null, p0 = 0, p1 = 1 } = {}) {
  const chs = (Array.isArray(channels) ? channels : [channels]).filter((c) => c && c.length);
  if (!chs.length) return { lufs: -70, peakDb: -120 };
  // Un único canal se reproduce por los dos altavoces (mono dual) ⇒ cuenta doble salvo que se indique otra cosa
  const G = weight ?? (chs.length === 1 ? 2 : 1);
  const n = chs[0].length;
  const step = Math.max(1, Math.round(sampleRate * 0.1)); // sub-bloques de 100 ms
  const nSub = Math.floor(n / step);
  const sub = new Float64Array(nSub);
  const { shelf, highpass } = kWeighting(sampleRate);
  const [sb0, sb1, sb2] = shelf.b;
  const sa1 = shelf.a[1];
  const sa2 = shelf.a[2];
  const ha1 = highpass.a[1];
  const ha2 = highpass.a[2];
  let peak = 0;
  const total = chs.length * n;
  let doneSamples = 0;
  for (const x of chs) {
    let z1 = 0;
    let z2 = 0;
    let w1 = 0;
    let w2 = 0;
    const CH = step * 40; // 4 s por rodaja
    for (let i0 = 0; i0 < n; i0 += CH) {
      const i1 = Math.min(n, i0 + CH);
      for (let i = i0; i < i1; i++) {
        const v = x[i];
        const av = v < 0 ? -v : v;
        if (av > peak) peak = av;
        // Etapa 1 (shelving) y 2 (paso alto) en forma directa II transpuesta
        const y1 = sb0 * v + z1;
        z1 = sb1 * v - sa1 * y1 + z2;
        z2 = sb2 * v - sa2 * y1;
        const y2 = y1 + w1;
        w1 = -2 * y1 - ha1 * y2 + w2;
        w2 = y1 - ha2 * y2;
        const s = (i / step) | 0;
        if (s < nSub) sub[s] += y2 * y2;
      }
      doneSamples += i1 - i0;
      yield { p: p0 + ((p1 - p0) * doneSamples) / total, stage: 'loudness' };
    }
  }
  // Bloques de 400 ms con solape del 75 %
  const nBlocks = nSub - 3;
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -120;
  if (nBlocks < 1) return { lufs: -70, peakDb: round2(peakDb) };
  const z = new Float64Array(nBlocks);
  for (let j = 0; j < nBlocks; j++) z[j] = (G * (sub[j] + sub[j + 1] + sub[j + 2] + sub[j + 3])) / (4 * step);
  const lk = (p) => -0.691 + 10 * Math.log10(p);
  let s1 = 0;
  let c1 = 0;
  for (let j = 0; j < nBlocks; j++) if (z[j] > 0 && lk(z[j]) > -70) { s1 += z[j]; c1++; }
  if (!c1) return { lufs: -70, peakDb: round2(peakDb) };
  const rel = lk(s1 / c1) - 10;
  let s2 = 0;
  let c2 = 0;
  for (let j = 0; j < nBlocks; j++) {
    if (z[j] <= 0) continue;
    const l = lk(z[j]);
    if (l > -70 && l > rel) { s2 += z[j]; c2++; }
  }
  const lufs = c2 ? lk(s2 / c2) : -70;
  return { lufs: round2(lufs), peakDb: round2(peakDb) };
}

/** Sonoridad integrada de los canales (Float32Array[]) → { lufs, peakDb }. Un solo canal se trata como mono dual. */
export function measureLoudness(channels, sampleRate) {
  return drain(loudnessGen(channels, sampleRate));
}

/** Igual que measureLoudness pero cediendo al bucle de eventos (para el hilo principal). */
export function measureLoudnessAsync(channels, sampleRate, onProgress = null) {
  return drainAsync(loudnessGen(channels, sampleRate), onProgress);
}

/** Ganancia de reproducción hacia −14 LUFS, limitada a ±12 dB y sin empujar el pico por encima de −1 dBFS. */
export function gainForLoudness(lufs, peakDb = null) {
  let g = clampN(TARGET_LUFS - lufs, -MAX_GAIN_DB, MAX_GAIN_DB);
  if (g > 0 && Number.isFinite(peakDb)) g = Math.max(0, Math.min(g, PEAK_CEIL_DB - peakDb));
  return Math.round(g * 10) / 10 + 0; // + 0 evita −0
}

/* ───────────── Rasgos: envolvente de onsets y energía por bandas ───────────── */

function bandRange(lo, hi) {
  const val = 1 / (N_FFT * (1 / ANALYSIS_SR)); // np.fft.rfftfreq
  let a = -1;
  let b = -1;
  for (let k = 0; k < N_BINS; k++) {
    const f = k * val;
    if (f >= lo && f < hi) {
      if (a < 0) a = k;
      b = k;
    }
  }
  return [a, b + 1];
}

function* featuresGen(y, { gain = 1, p0 = 0, p1 = 1 } = {}) {
  const n = y.length;
  const nFrames = n >= N_FFT ? 1 + Math.floor((n - N_FFT) / ANALYSIS_HOP) : 0;
  if (nFrames < 64) throw new Error('Audio demasiado corto para analizar');
  const fft = realFft();
  const win = hanning(N_FFT, gain);
  const mag = new Float64Array(N_BINS);
  let prev = new Float64Array(N_BINS);
  let cur = new Float64Array(N_BINS);
  const flux = new Float64Array(nFrames);
  const bands = [new Float32Array(nFrames), new Float32Array(nFrames), new Float32Array(nFrames)];
  const ranges = [bandRange(30, 150), bandRange(150, 2000), bandRange(2000, 11000)];
  const CH = 384;
  for (let t0 = 0; t0 < nFrames; t0 += CH) {
    const t1 = Math.min(nFrames, t0 + CH);
    for (let t = t0; t < t1; t++) {
      fft(y, t * ANALYSIS_HOP, win, mag);
      let f = 0;
      for (let k = 0; k < N_BINS; k++) {
        const l = Math.log1p(100 * mag[k]);
        cur[k] = l;
        const d = l - prev[k];
        if (d > 0) f += d;
      }
      flux[t] = t === 0 ? 0 : f;
      for (let bI = 0; bI < 3; bI++) {
        const [a, b] = ranges[bI];
        let s = 0;
        for (let k = a; k < b; k++) s += mag[k];
        bands[bI][t] = s;
      }
      const tmp = prev;
      prev = cur;
      cur = tmp;
    }
    yield { p: p0 + ((p1 - p0) * t1) / nFrames, stage: 'spectrum' };
  }
  // Quitar tendencia lenta (media móvil de ~1 s, alineada como np.convolve mode='same') y normalizar
  const k = Math.trunc(FR);
  const left = k >> 1;
  const right = k - left - 1;
  const pre = new Float64Array(nFrames + 1);
  for (let i = 0; i < nFrames; i++) pre[i + 1] = pre[i] + flux[i];
  const env = new Float32Array(nFrames);
  let mx = 0;
  for (let i = 0; i < nFrames; i++) {
    const trend = (pre[Math.min(nFrames, i + right + 1)] - pre[Math.max(0, i - left)]) / k;
    const v = flux[i] - trend;
    const e = v > 0 ? v : 0;
    env[i] = e;
    if (e > mx) mx = e;
  }
  const norm = 1 / (mx + 1e-9);
  for (let i = 0; i < nFrames; i++) env[i] *= norm;
  return { version: ANALYSIS_VERSION, frameRate: FR, nFrames, duration: n / ANALYSIS_SR, env, bands };
}

/** PCM mono a 22 050 Hz → rasgos reutilizables (envolvente de onsets + energía en 3 bandas por fotograma). */
export function computeFeatures(pcm22050, { gain = 1 } = {}) {
  return drain(featuresGen(pcm22050, { gain }));
}

/* ───────────── Tempo: peine de pulsos ───────────── */

function combScore(env, bpm, phaseStep = 0.5) {
  const n = env.length;
  const period = (60 * FR) / bpm;
  const nbeats = Math.trunc((n - 1) / period) - 1;
  if (nbeats < 8) return [0, 0];
  const nph = Math.ceil(period / phaseStep);
  let best = -Infinity;
  let bestPh = 0;
  for (let p = 0; p < nph; p++) {
    const ph = p * phaseStep;
    let s = 0;
    for (let b = 0; b < nbeats; b++) {
      const pos = ph + b * period;
      const i0 = Math.floor(pos);
      const fr = pos - i0;
      const i1 = i0 + 1 < n ? i0 + 1 : n - 1;
      s += env[i0] * (1 - fr) + env[i1] * fr;
    }
    const score = s / nbeats;
    if (score > best) {
      best = score;
      bestPh = ph;
    }
  }
  return [best, bestPh];
}

function arange(start, stop, step) {
  const len = Math.max(0, Math.ceil((stop - start) / step));
  const out = new Float64Array(len);
  for (let i = 0; i < len; i++) out[i] = start + i * step;
  return out;
}

function coarseScores(env) {
  const grid = arange(80, 190, 0.25);
  const sc = new Float64Array(grid.length);
  for (let i = 0; i < grid.length; i++) sc[i] = combScore(env, grid[i])[0];
  return { grid, sc };
}

const meanOf = (a) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return a.length ? s / a.length : 0;
};

/** Afinado ±0,6 BPM a 0,01 alrededor de `c` + redondeo a .0/.5 si está muy cerca (la electrónica suele ir a BPM entero). */
function refineTempo(env, c) {
  const fine = arange(c - 0.6, c + 0.6, 0.01);
  let bestS = -Infinity;
  let bpm = c;
  for (let i = 0; i < fine.length; i++) {
    const s = combScore(env, fine[i])[0];
    if (s > bestS || (s === bestS && fine[i] > bpm)) {
      bestS = s;
      bpm = fine[i];
    }
  }
  for (const target of [Math.round(bpm), Math.round(bpm * 2) / 2]) {
    if (Math.abs(bpm - target) < 0.06) {
      bpm = target;
      break;
    }
  }
  return bpm;
}

function estimateTempo(env, priorBpm, coarse) {
  const { grid, sc } = coarse;
  let ci = 0;
  let cBest = -Infinity;
  for (let i = 0; i < grid.length; i++) {
    const l = Math.log2(grid[i] / priorBpm) / 0.35;
    const w = sc[i] * (0.6 + 0.4 * Math.exp(-0.5 * l * l));
    if (w > cBest) {
      cBest = w;
      ci = i;
    }
  }
  return tempoAt(env, refineTempo(env, grid[ci]), meanOf(sc));
}

function tempoAt(env, bpm, combMean) {
  const [score, phase] = combScore(env, bpm, 0.25);
  return { bpm: round2(bpm), firstBeat: phase / FR, confidence: score / (combMean + 1e-9), score, phase };
}

/**
 * Doble tempo probable (solo importación, sin tramo conocido): drum & bass, hard techno o psy detectados a la
 * mitad (< 100 BPM) tienen golpes fuertes a contratiempo (cajas) y espectro brillante; un tema lento de verdad
 * (synthwave a 90) tiene contratiempos débiles y es oscuro. Heurística conservadora: ante la duda, no dobla.
 */
function looksDoubleTime(features, tempo) {
  if (tempo.bpm >= 100 || tempo.bpm * 2 > 200) return false;
  const env = features.env;
  const period = (60 * FR) / tempo.bpm;
  const off = combAtPhase(env, tempo.bpm, (tempo.phase + period / 2) % period);
  const offOn = tempo.score > 0 ? off / tempo.score : 0;
  let hi = 0;
  let all = 0;
  const [b0, b1, b2] = features.bands;
  for (let i = 0; i < features.nFrames; i++) {
    hi += b2[i];
    all += b0[i] + b1[i] + b2[i];
  }
  const treble = all > 0 ? hi / all : 0;
  return offOn >= 0.7 || (offOn >= 0.55 && treble >= 0.4);
}

function combAtPhase(env, bpm, ph) {
  const n = env.length;
  const period = (60 * FR) / bpm;
  const nbeats = Math.trunc((n - 1) / period) - 1;
  if (nbeats < 8) return 0;
  let s = 0;
  for (let b = 0; b < nbeats; b++) {
    const pos = ph + b * period;
    const i0 = Math.floor(pos);
    const fr = pos - i0;
    s += env[i0] * (1 - fr) + env[Math.min(i0 + 1, n - 1)] * fr;
  }
  return s / nbeats;
}

/* ───────────── Estructura: downbeat, energía por compás y cues ───────────── */

function percentile(values, q) {
  const s = Float64Array.from(values).sort();
  if (!s.length) return 0;
  const idx = (q / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

function structure(features, bpm, firstBeat) {
  const { bands, nFrames, duration: dur } = features;
  const spb = 60 / bpm;
  const nbt = Math.max(0, Math.ceil((dur - firstBeat) / spb));
  const fidx = new Int32Array(nbt);
  for (let i = 0; i < nbt; i++) fidx[i] = Math.trunc((firstBeat + i * spb) * FR);
  const nb = Math.max(0, nbt - 1);
  const feats = [new Float64Array(nb), new Float64Array(nb), new Float64Array(nb)];
  for (let i = 0; i < nb; i++) {
    const a = fidx[i];
    const b = Math.min(Math.max(fidx[i + 1], a + 1), nFrames);
    for (let c = 0; c < 3; c++) {
      const x = bands[c];
      let s = 0;
      for (let j = a; j < b; j++) s += x[j];
      feats[c][i] = b > a ? s / (b - a) : 0;
    }
  }
  // Downbeat: los inicios de compás concentran más novedad tímbrica entre tiempos (+ graves)
  const logf = feats.map((f) => Float64Array.from(f, (v) => Math.log1p(v)));
  const nov = new Float64Array(nb);
  for (let i = 1; i < nb; i++) {
    nov[i] = Math.abs(logf[0][i] - logf[0][i - 1]) + Math.abs(logf[1][i] - logf[1][i - 1]) + Math.abs(logf[2][i] - logf[2][i - 1]);
  }
  const bass = logf[0];
  const bassMean = meanOf(bass);
  let bestR = 0;
  let bestV = -1;
  for (let r = 0; r < 4; r++) {
    let sn = 0;
    let sb = 0;
    let cnt = 0;
    for (let i = r; i < nb; i += 4) { sn += nov[i]; sb += bass[i]; cnt++; }
    if (!cnt) continue;
    const v = sn / cnt + 0.35 * (sb / cnt - bassMean);
    if (v > bestV) { bestR = r; bestV = v; }
  }
  const barOffset = firstBeat + bestR * spb;
  // Energía por compás (4 tiempos)
  let bars = [];
  for (let i = bestR; i < nb - 3; i += 4) {
    let s = 0;
    for (let j = i; j < i + 4; j++) s += feats[0][j] + feats[1][j] + feats[2][j];
    bars.push(s / 4);
  }
  if (!bars.length) bars = [1];
  const p95 = percentile(bars, 95) + 1e-9;
  const e = bars.map((v) => clampN(v / p95, 0, 1));
  const spbar = 4 * spb;
  const barTime = (i) => round3(barOffset + i * spbar);
  // mixIn: primer compás (alineado a 8) con energía ≥ 0,6
  let mixInBar = e.findIndex((v) => v >= 0.6);
  if (mixInBar < 0) mixInBar = 0;
  if (mixInBar >= 8) mixInBar = Math.floor(mixInBar / 8) * 8;
  // drops: subida brusca de energía tras una sección más baja
  const drops = [];
  for (let i = 4; i < e.length; i++) {
    const prev = (e[i - 4] + e[i - 3] + e[i - 2] + e[i - 1]) / 4;
    if (e[i] >= 0.8 && prev < 0.62 && (!drops.length || i - drops[drops.length - 1] >= 16)) drops.push(i);
  }
  // outro: último compás con energía alta antes del final
  let lastHi = -1;
  for (let i = 0; i < e.length; i++) if (e[i] >= 0.7) lastHi = i;
  const outroBar = lastHi >= 0 ? lastHi + 1 : e.length - 8;
  const hotBars = [];
  for (let i = 0; i < e.length; i++) if (e[i] >= 0.8) hotBars.push(i);
  return {
    beatOffset: round3(firstBeat),
    barOffset: round3(barOffset),
    bars: e.length,
    energy: e.map(round2),
    cues: {
      mixIn: barTime(mixInBar),
      drops: drops.map(barTime),
      outro: barTime(Math.max(outroBar, mixInBar + 8)),
      hotBars,
    },
  };
}

/**
 * Rasgos → análisis rítmico. `bpm` fuerza el tempo (BPM manual / tap tempo): se recalculan fase, downbeat,
 * energía y cues con ese tempo exacto. `priorBpm` resuelve dobles/mitades como en analyze.py.
 */
export function analyzeFeatures(features, { priorBpm = 125, bpm = null, autoOctave = false, minBpm = null } = {}) {
  const env = features.env;
  let tempo;
  let bpmDetected = null;
  if (Number.isFinite(bpm) && bpm > 0) {
    if (!Number.isFinite(features.combMean)) features.combMean = meanOf(coarseScores(env).sc);
    tempo = tempoAt(env, round2(clampN(bpm, 40, 250)), features.combMean);
  } else {
    const coarse = coarseScores(env);
    features.combMean = meanOf(coarse.sc);
    tempo = estimateTempo(env, priorBpm || 125, coarse);
    // minBpm: regla de analyze.py para tramos sprint (< 100 ⇒ doble), aquí con la rejilla recalculada al doble
    if ((Number.isFinite(minBpm) && tempo.bpm < minBpm) || (autoOctave && looksDoubleTime(features, tempo))) {
      bpmDetected = tempo.bpm;
      tempo = tempoAt(env, refineTempo(env, tempo.bpm * 2), features.combMean);
    }
  }
  const st = structure(features, tempo.bpm, tempo.firstBeat);
  const out = {
    duration: round3(features.duration),
    bpm: tempo.bpm,
    confidence: round2(tempo.confidence),
    ...st,
  };
  if (bpmDetected != null) out.bpmDetected = bpmDetected;
  return out;
}

/* ───────────── API principal ───────────── */

function* analysisGen(pcm, sampleRate, opts) {
  const { priorBpm = 125, loudness = null, normalize = true, keepFeatures = false, autoOctave = false, minBpm = null } = opts;
  if (!pcm || !pcm.length) throw new Error('Audio vacío');
  const y = yield* resampleGen(pcm, sampleRate, 0, sampleRate === ANALYSIS_SR ? 0 : 0.1);
  const pL = sampleRate === ANALYSIS_SR ? 0 : 0.1;
  // Sonoridad: la medida estéreo real (si la da el llamador) o la del propio mono (≈ estéreo correlado)
  let loud = loudness && Number.isFinite(loudness.lufs) ? loudness : null;
  if (!loud) loud = yield* loudnessGen([y], ANALYSIS_SR, { weight: 1, p0: pL, p1: pL + 0.08 });
  const peakDb = Number.isFinite(loud.peakDb) ? loud.peakDb : null;
  // El análisis ve la pista ya normalizada a −14 LUFS, igual que la biblioteca integrada
  const gA = normalize ? 10 ** (clampN(TARGET_LUFS - loud.lufs, -30, 30) / 20) : 1;
  const features = yield* featuresGen(y, { gain: gA, p0: pL + 0.08, p1: 0.88 });
  yield { p: 0.9, stage: 'tempo' };
  const a = analyzeFeatures(features, { priorBpm, autoOctave, minBpm });
  yield { p: 1, stage: 'done' };
  const out = {
    ...a,
    loudnessDb: round2(loud.lufs),
    peakDb,
    gainDb: gainForLoudness(loud.lufs, peakDb),
    analysisVersion: ANALYSIS_VERSION,
  };
  if (keepFeatures) out.features = features;
  return out;
}

/**
 * Analiza una canción. `float32Mono` a cualquier `sampleRate` (se remuestrea a 22 050 Hz).
 * Opciones: priorBpm (125), loudness ({ lufs, peakDb } medidos en estéreo; si falta se mide sobre el mono),
 * keepFeatures (devuelve `features` para re-analizar con BPM manual), autoOctave (corrige DnB a medio tempo;
 * solo para importaciones sin tramo conocido), normalize (el análisis ve la pista a −14 LUFS), onProgress(p, stage).
 * → { duration, bpm, confidence, beatOffset, barOffset, bars, energy, cues, loudnessDb, peakDb, gainDb, analysisVersion }
 */
export function analyzePcm(float32Mono, sampleRate, { onProgress = null, ...opts } = {}) {
  return drain(analysisGen(float32Mono, sampleRate, opts), onProgress);
}

/** Igual que analyzePcm, troceado para el hilo principal (respuesta de la interfaz sin Worker). */
export function analyzePcmAsync(float32Mono, sampleRate, { onProgress = null, ...opts } = {}) {
  return drainAsync(analysisGen(float32Mono, sampleRate, opts), onProgress);
}

/**
 * Reajusta un análisis a otro BPM sin rasgos guardados (respaldo): conserva fases y cues en segundos y
 * re-muestrea la energía por compás en el tiempo.
 */
export function retimeAnalysis(track, bpm) {
  const newBpm = round2(clampN(bpm, 40, 250));
  const oldSpbar = (4 * 60) / track.bpm;
  const spbar = (4 * 60) / newBpm;
  const barOffset = track.barOffset ?? track.beatOffset ?? 0;
  const dur = track.duration || 0;
  // Mismo recuento que analyze.py: solo compases completos de 4 tiempos
  const beatsFromBar = Math.ceil((dur - barOffset) / (60 / newBpm)) - 1;
  const n = Math.max(1, Math.floor(beatsFromBar / 4));
  const old = Array.isArray(track.energy) && track.energy.length ? track.energy : [1];
  const energy = [];
  for (let i = 0; i < n; i++) {
    const a = (i * spbar) / oldSpbar;
    const b = ((i + 1) * spbar) / oldSpbar;
    let s = 0;
    let w = 0;
    for (let j = Math.floor(a); j < Math.ceil(b); j++) {
      const ov = Math.min(b, j + 1) - Math.max(a, j);
      if (ov <= 0) continue;
      s += (old[Math.min(old.length - 1, Math.max(0, j))] ?? 0) * ov;
      w += ov;
    }
    energy.push(round2(w ? s / w : 0));
  }
  const hotBars = [];
  for (let i = 0; i < energy.length; i++) if (energy[i] >= 0.8) hotBars.push(i);
  return {
    bpm: newBpm,
    beatOffset: track.beatOffset,
    barOffset,
    bars: energy.length,
    energy,
    cues: { ...(track.cues || {}), hotBars },
  };
}

/* ───────────── Tap tempo ───────────── */

/**
 * Marcas de tiempo de toques (ms, o s si son pequeñas) → BPM con 1 decimal, o null si no hay base suficiente.
 * Usa la última racha continua (pausa > 2 s reinicia), tolera un toque perdido (intervalo doble) y se queda con
 * el tramo coherente más largo; el tempo sale de una regresión lineal índice-de-tiempo → instante.
 */
export function tapTempo(timestamps, { maxGapMs = 2000, maxTaps = 24 } = {}) {
  if (!timestamps || timestamps.length < 4) return null;
  let t = Array.from(timestamps, Number).filter(Number.isFinite);
  if (t.length < 4) return null;
  const raw = [];
  for (let i = 1; i < t.length; i++) raw.push(Math.abs(t[i] - t[i - 1]));
  const med0 = percentile(raw, 50);
  if (med0 > 0 && med0 < 10) t = t.map((x) => x * 1000); // venían en segundos
  let start = t.length - 1;
  while (start > 0 && t[start] - t[start - 1] > 0 && t[start] - t[start - 1] <= maxGapMs) start--;
  t = t.slice(start).slice(-maxTaps);
  if (t.length < 4) return null;
  const d = [];
  for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
  const med = percentile(d, 50);
  if (!(med > 0)) return null;
  // Tramos de intervalos coherentes (≈ 1 o 2 tiempos); un intervalo raro corta el tramo
  let best = null;
  let cur = null;
  for (let i = 0; i < d.length; i++) {
    const r = d[i] / med;
    const k = Math.round(r);
    if (k >= 1 && k <= 2 && Math.abs(r - k) <= 0.3) {
      if (!cur) cur = { xs: [0], ys: [t[i]] };
      cur.xs.push(cur.xs[cur.xs.length - 1] + k);
      cur.ys.push(t[i + 1]);
    } else cur = null;
    if (cur && (!best || cur.xs.length >= best.xs.length)) best = cur;
  }
  if (!best || best.xs.length < 4) return null;
  const { xs, ys } = best;
  const mx = meanOf(xs);
  const my = meanOf(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (!(den > 0)) return null;
  const bpm = 60000 / (num / den);
  if (!(bpm >= 40 && bpm <= 250)) return null;
  return Math.round(bpm * 10) / 10;
}
