// BestRunning · almacén de pistas decodificadas (AudioBuffer) del motor DJ. Sin DOM: importable desde Node.
// Cada pista se descarga entera y se decodifica en un OfflineAudioContext propio a la frecuencia del contexto
// compartido (48 kHz en el iPhone: a velocidad 1 no hay remuestreo al sonar). La memoria se limita en BYTES:
// lo residente + 2× la decodificación en curso (WebKit decodifica a un bus y lo copia al AudioBuffer) + el archivo
// ≤ BUDGET_BYTES. Si no cabe se expulsa la que más tarde se va a necesitar (el motor conoce el plan: `score`) y, si
// aun así no cabe, esa pista se decodifica a menos frecuencia (pistas largas o importadas). Tras decodificar solo se
// guarda la ventana de la pista que usa el plan (`windowFor`), copiada a trozos. Una descarga/decodificación a la
// vez; la descarga se aborta a los 15 s y los fallos se reintentan (20 s, 60 s, o antes si vuelve la red).
import { fetchTrackData } from './music-library.js';

// Pico de memoria (residente + decodificación en curso): ≈ el que ya tenía el motor con 3 pistas enteras a 32 kHz,
// pero ahora acotado también para pistas importadas largas; casi todas las integradas caben a 48 kHz
export const BUDGET_BYTES = 320 * 2 ** 20;
export const MAX_DECODED = 3;
export const RATE_LADDER = [32000, 24000, 16000];   // si no cabe a la del contexto (de mejor a peor)
export const DEFAULT_RATE = 48000;
const FETCH_TIMEOUT_MS = 15000;
const DECODE_TIMEOUT_MS = 60000;
const RETRY_MS = [20000, 60000];
const PREEMPT_NEED = 20;          // s: una petición con esta urgencia aborta una descarga que hace falta más tarde…
const PREEMPT_GAP = 45;           // … al menos 45 s más tarde, y nunca una que ya era urgente (sin abortos en cadena)
const TRIM_KEEP = 0.85;           // ventana ≥ 85 % de la pista: se guarda entera
const COPY_CHUNK_SEC = 8;
const FILE_GUESS = 8 * 2 ** 20;   // tamaño del archivo si no se conoce
const LENIENT = 1.25;             // a la frecuencia más baja se tolera un 25 % más antes de rendirse

const perfSec = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) / 1000;
const yieldTask = () => new Promise((r) => { if (typeof setTimeout === 'function') setTimeout(r, 0); else r(); });

function decodeWith(c, data) {
  return new Promise((resolve, reject) => {
    try {
      const p = c.decodeAudioData(data, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (err) { reject(err); }
  });
}

function withTimeout(p, ms, onTimeout = null) {
  let timer = null;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => { try { onTimeout?.(); } catch { /* nada */ } reject(new Error('timeout')); }, ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/** Bytes de PCM float32 estéreo de `sec` segundos a `rate`. */
export const pcmBytes = (sec, rate, channels = 2) => Math.max(0, Number(sec) || 0) * rate * channels * 4;

/**
 * opts: { getContext() → AudioContext compartido, rate (preferida; por defecto la del contexto), budgetBytes, max,
 *         loadData(track, { signal }) → ArrayBuffer, timeoutMs (decodificación), fetchTimeoutMs,
 *         windowFor(track, durSec) → [desde, hasta] s de pista | null, now() → s }.
 * request(track, needIn, score) → 'ready' | 'loading' | 'busy' | 'full' | 'failed'
 *   needIn: s hasta que hará falta; score(id) → s hasta el próximo uso de una pista ya cargada (Infinity si no
 *   vuelve; < 0 = en uso, intocable). Solo se expulsa una pista que se necesite después que la pedida.
 */
export function createBufferStore({
  getContext = null, rate = null, budgetBytes = BUDGET_BYTES, max = MAX_DECODED, loadData = null, timeoutMs = null,
  fetchTimeoutMs = null, windowFor = null, now = null,
} = {}) {
  const limitMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : DECODE_TIMEOUT_MS;
  const fetchMs = Number(fetchTimeoutMs) > 0 ? Number(fetchTimeoutMs) : FETCH_TIMEOUT_MS;
  const budget = Number(budgetBytes) > 0 ? Number(budgetBytes) : BUDGET_BYTES;
  const clock = typeof now === 'function' ? now : perfSec;
  const ready = new Map();      // id → { buf, used, bytes, rate, w0, w1 }
  const offsets = new WeakMap(); // AudioBuffer → s de pista de su primera muestra
  const failed = new Map();     // id → { tries, retryAt, permanent, reason }
  const info = new Map();       // id → { rate, mb, fetchMs, decodeMs, w0, w1, sec } (para depurar)
  const decoders = new Map();   // rate → OfflineAudioContext
  let busy = null;              // { id, promise, phase: 'fetch'|'decode'|'copy', ctrl, cancelled }
  let gen = 0;
  let tick = 0;
  let peak = 0;
  let peakBytes = 0;
  let aborted = 0;
  const load = typeof loadData === 'function' ? loadData : (t, o) => fetchTrackData(t, globalThis.fetch, o);

  const sharedRate = () => {
    try { return Number(getContext?.()?.sampleRate) || 0; } catch { return 0; }
  };
  const preferred = () => {
    const r = Number(rate) || sharedRate() || DEFAULT_RATE;
    return Math.max(8000, Math.min(96000, Math.round(r)));
  };
  const ladder = () => {
    const top = preferred();
    return [top, ...RATE_LADDER.filter((r) => r < top)];
  };
  const resident = () => { let b = 0; for (const e of ready.values()) b += e.bytes; return b; };
  const fileBytes = (t) => (Number(t?.sizeBytes) > 0 ? Number(t.sizeBytes) : FILE_GUESS);
  const transient = (t, r) => 2 * pcmBytes(t?.duration, r) + fileBytes(t);

  function offlineDecoder(r) {
    if (decoders.has(r)) return decoders.get(r);
    let d = null;
    const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (typeof OAC === 'function') {
      try { d = new OAC(2, 1, r); } catch {
        try { d = new OAC(2, r, r); } catch { d = null; }
      }
    }
    decoders.set(r, d);
    return d;
  }

  function scoreOf(score, id) {
    try { return typeof score === 'function' ? Number(score(id)) : Infinity; } catch { return Infinity; }
  }

  /** Frecuencia y pistas a expulsar para que quepa `t`; { wait } si hay que esperar; { tooBig } si nunca cabrá. */
  function fit(t, needIn, score) {
    const evictable = [];
    let untouchable = 0;
    let bigUntouchable = 0;
    for (const [id, e] of ready) {
      const s = scoreOf(score, id);
      if (s >= 0 && s > needIn) evictable.push({ id, e, s });
      else { untouchable += 1; bigUntouchable = Math.max(bigUntouchable, e.bytes); }
    }
    // Belady: primero la que más tarde se usa (empate: la usada hace más tiempo)
    evictable.sort((a, b) => b.s - a.s || a.e.used - b.e.used);
    const res = resident();
    const rates = ladder();
    for (const r of rates) {
      const need = transient(t, r);
      let bytes = res;
      let cnt = ready.size;
      let k = 0;
      while ((bytes + need > budget || cnt >= max) && k < evictable.length) { bytes -= evictable[k].e.bytes; cnt--; k++; }
      if (bytes + need <= budget && cnt < max) return { rate: r, victims: evictable.slice(0, k).map((x) => x.id) };
    }
    const low = rates[rates.length - 1];
    const minRes = res - evictable.reduce((a, x) => a + x.e.bytes, 0);
    if (untouchable < max && minRes + transient(t, low) <= budget * LENIENT) {
      return { rate: low, victims: evictable.map((x) => x.id) };
    }
    // Solo la que suena seguirá en memoria: si así cabría, toca esperar a que se libere el resto
    if (untouchable >= max || bigUntouchable + transient(t, low) <= budget * LENIENT) return { wait: true };
    return { tooBig: true };
  }

  function markFailed(id, reason, permanent = false) {
    const f = failed.get(id) || { tries: 0, retryAt: 0, permanent: false, reason: '' };
    f.tries++;
    f.reason = String(reason || 'error').slice(0, 60);
    f.permanent = permanent || f.tries > RETRY_MS.length;
    f.retryAt = f.permanent ? Infinity : clock() + RETRY_MS[f.tries - 1] / 1000;
    failed.set(id, f);
  }

  function isFailed(id) {
    const f = failed.get(id);
    if (!f) return false;
    return f.permanent || clock() < f.retryAt;
  }

  async function decodeAt(t, r, data) {
    const dec = offlineDecoder(r);
    if (dec) {
      try { return await decodeWith(dec, data); } catch {
        // este decodificador no pudo con la pista: segundo intento con el contexto compartido
      }
    }
    const shared = typeof getContext === 'function' ? getContext() : null;
    if (!shared || typeof shared.decodeAudioData !== 'function') throw new Error('sin decodificador');
    return decodeWith(shared, await load(t, {}));
  }

  function makeBuffer(full, len) {
    const nc = full.numberOfChannels || 1;
    const sr = full.sampleRate;
    const dec = offlineDecoder(sr) || (typeof getContext === 'function' ? getContext() : null);
    if (dec && typeof dec.createBuffer === 'function') return dec.createBuffer(nc, len, sr);
    if (typeof globalThis.AudioBuffer === 'function') return new globalThis.AudioBuffer({ length: len, numberOfChannels: nc, sampleRate: sr });
    return null;
  }

  /** Copia [a, b) s de `full` a un AudioBuffer nuevo, a trozos (sin bloquear el hilo principal). */
  async function trim(full, a, b, job) {
    const sr = full.sampleRate;
    const i0 = Math.max(0, Math.floor(a * sr));
    const i1 = Math.min(full.length, Math.ceil(b * sr));
    if (!(i1 - i0 > sr)) return null;
    const out = makeBuffer(full, i1 - i0);
    if (!out) return null;
    const step = Math.max(sr, Math.round(COPY_CHUNK_SEC * sr));
    for (let c = 0; c < (full.numberOfChannels || 1); c++) {
      for (let k = i0; k < i1; k += step) {
        if (job.cancelled) return null;
        const src = full.getChannelData(c).subarray(k, Math.min(i1, k + step));
        if (typeof out.copyToChannel === 'function') out.copyToChannel(src, c, k - i0);
        else out.getChannelData(c).set(src, k - i0);
        await yieldTask();
      }
    }
    return { buf: out, w0: i0 / sr };
  }

  function start(t, r, urgent = false) {
    const id = t.id;
    const my = gen;
    const Ctrl = globalThis.AbortController;
    const job = { id, phase: 'fetch', ctrl: typeof Ctrl === 'function' ? new Ctrl() : null, cancelled: false, promise: null, urgent };
    const t0 = clock();
    job.promise = (async () => {
      const data = await withTimeout(load(t, { signal: job.ctrl?.signal }), fetchMs, () => job.ctrl?.abort());
      if (job.cancelled) return false;
      job.phase = 'decode';
      job.ctrl = null;
      const t1 = clock();
      const full = await withTimeout(decodeAt(t, r, data), limitMs);
      if (job.cancelled || my !== gen) return false;
      if (!full || !(full.duration > 1)) throw new Error('vacía');
      const t2 = clock();
      job.phase = 'copy';
      let buf = full;
      let w0 = 0;
      let win = null;
      try { win = typeof windowFor === 'function' ? windowFor(t, full.duration) : null; } catch { win = null; }
      if (win && Number.isFinite(win[0]) && Number.isFinite(win[1]) && (win[1] - win[0]) < TRIM_KEEP * full.duration) {
        const cut = await trim(full, Math.max(0, win[0]), Math.min(full.duration, win[1]), job);
        if (job.cancelled || my !== gen) return false;
        if (cut) { buf = cut.buf; w0 = cut.w0; }
      }
      const bytes = buf.length * (buf.numberOfChannels || 1) * 4;
      offsets.set(buf, w0);
      ready.set(id, { buf, used: ++tick, bytes, rate: buf.sampleRate, w0, w1: w0 + buf.duration });
      failed.delete(id);
      peak = Math.max(peak, ready.size);
      peakBytes = Math.max(peakBytes, resident());
      info.delete(id);
      info.set(id, {
        rate: buf.sampleRate, mb: Math.round(bytes / 1e5) / 10, sec: Math.round(full.duration),
        w0: Math.round(w0 * 10) / 10, w1: Math.round((w0 + buf.duration) * 10) / 10,
        fetchMs: Math.round((t1 - t0) * 1000), decodeMs: Math.round((t2 - t1) * 1000),
      });
      while (info.size > 24) info.delete(info.keys().next().value);
      return true;
    })()
      .catch((err) => {
        if (!job.cancelled && my === gen) markFailed(id, err?.name === 'AbortError' ? 'timeout' : err?.message);
        return false;
      })
      .finally(() => { if (busy === job) busy = null; });
    busy = job;
  }

  function request(track, needIn = 0, score = null) {
    const id = track?.id;
    if (!id) return 'failed';
    if (ready.has(id)) return 'ready';
    if (isFailed(id)) return 'failed';
    const need = Math.max(0, Number(needIn) || 0);
    if (busy) {
      if (busy.id === id) return 'loading';
      // Una descarga que hace falta mucho más tarde (o nunca) no bloquea a la que ya urge. No se aborta una
      // decodificación ni una descarga urgente: con la red muy lenta, abortar en cadena no dejaría llegar a ninguna
      if (!(need < PREEMPT_NEED && busy.phase === 'fetch' && !busy.urgent && scoreOf(score, busy.id) > need + PREEMPT_GAP)) return 'busy';
      busy.cancelled = true;
      try { busy.ctrl?.abort(); } catch { /* nada */ }
      busy = null;
      aborted++;
    }
    const f = fit(track, need, score);
    if (f.tooBig) { markFailed(id, 'memoria', true); return 'failed'; }
    if (f.wait) return 'full';
    for (const v of f.victims) ready.delete(v);
    start(track, f.rate, need < PREEMPT_NEED);
    return 'loading';
  }

  return {
    request,
    get(id) {
      const e = ready.get(id);
      if (!e) return null;
      e.used = ++tick;
      return e.buf;
    },
    /** s de pista de la primera muestra del buffer (0 si es la pista entera). */
    offsetOf: (buf) => (buf && offsets.get(buf)) || 0,
    has: (id) => ready.has(id),
    isFailed,
    loadingId: () => busy?.id ?? null,
    /** Espera a que termine la decodificación en curso (true si dejó lista `id`). */
    settle(id) {
      if (!busy) return Promise.resolve(ready.has(id));
      return busy.promise.then(() => ready.has(id), () => ready.has(id));
    },
    /** Reintento inmediato de las que fallaron (volvió la red o la app). */
    retryNow() {
      for (const f of failed.values()) if (!f.permanent) f.retryAt = 0;
    },
    release(id) { ready.delete(id); },
    releaseAll() { ready.clear(); },
    stats: () => {
      const failedNow = [...failed].filter(([id]) => isFailed(id));
      return {
        decoded: ready.size, peak, loading: busy?.id ?? null, phase: busy?.phase ?? null, failed: failedNow.length,
        ids: [...ready.keys()], bytes: resident(), peakBytes, budget, aborted,
        rates: Object.fromEntries([...ready].map(([id, e]) => [id, e.rate])),
        windows: Object.fromEntries([...ready].map(([id, e]) => [id, [e.w0, e.w1]])),
        info: Object.fromEntries(info),
        errors: Object.fromEntries([...failed].map(([id, f]) => [id, { tries: f.tries, reason: f.reason, permanent: f.permanent }])),
      };
    },
    clear() {
      gen++;
      if (busy) { busy.cancelled = true; try { busy.ctrl?.abort(); } catch { /* nada */ } }
      ready.clear();
      failed.clear();
      busy = null;
    },
  };
}
