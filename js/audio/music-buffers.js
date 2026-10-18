// BestRunning · almacén de pistas decodificadas (AudioBuffer) del motor DJ. Sin DOM: importable desde Node.
// Descarga cada pista entera y la decodifica en un OfflineAudioContext propio a 32 kHz estéreo (≈ 15 MB/min en
// lugar de ≈ 23 MB/min a 48 kHz; decodeAudioData trabaja fuera del hilo principal). Como mucho MAX_DECODED pistas
// en memoria (la que suena, la siguiente y la aparcada en la "memoria de discos") y UNA decodificación a la vez.
// Al llenarse se expulsa la que más tarde se va a necesitar (el motor conoce el plan: `score`).
import { fetchTrackData } from './music-library.js';

export const DECODE_RATE = 32000;
export const MAX_DECODED = 3;
const DECODE_TIMEOUT_MS = 60000;

function decodeWith(c, data) {
  return new Promise((resolve, reject) => {
    try {
      const p = c.decodeAudioData(data, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (err) { reject(err); }
  });
}

function withTimeout(p, ms) {
  let timer = null;
  const t = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/**
 * opts: { getContext() → AudioContext de reserva, rate, max, loadData(track) → ArrayBuffer, timeoutMs }.
 * request(track, needIn, score) → 'ready' | 'loading' | 'busy' | 'full' | 'failed'
 *   needIn: s hasta que hará falta; score(id) → s hasta el próximo uso de una pista ya cargada (Infinity si no
 *   vuelve; < 0 = en uso, intocable). Solo se expulsa una pista que se necesite después que la pedida.
 */
export function createBufferStore({
  getContext = null, rate = DECODE_RATE, max = MAX_DECODED, loadData = null, timeoutMs = null,
} = {}) {
  const limitMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : DECODE_TIMEOUT_MS;
  const ready = new Map();   // id → { buf, used }
  const failed = new Set();
  let busy = null;           // { id, promise }
  let decoder = null;
  let decoderOff = false;
  let gen = 0;
  let tick = 0;
  let peak = 0;
  const load = typeof loadData === 'function' ? loadData : (t) => fetchTrackData(t);

  function offlineDecoder() {
    if (decoder || decoderOff) return decoder;
    const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (typeof OAC === 'function') {
      try { decoder = new OAC(2, 1, rate); } catch {
        try { decoder = new OAC(2, rate, rate); } catch { decoder = null; }
      }
    }
    if (!decoder) decoderOff = true;
    return decoder;
  }

  async function decodeTrack(track) {
    const dec = offlineDecoder();
    if (dec) {
      try { return await decodeWith(dec, await load(track)); } catch {
        // el decodificador a 32 kHz no pudo con esta pista: segundo intento con el contexto compartido
      }
    }
    const shared = typeof getContext === 'function' ? getContext() : null;
    if (!shared || typeof shared.decodeAudioData !== 'function') throw new Error('sin decodificador');
    return decodeWith(shared, await load(track));
  }

  function evictOne(needIn, score) {
    let victim = null;
    let vs = -1;
    let vu = Infinity;
    for (const [id, e] of ready) {
      let s = Infinity;
      try { s = typeof score === 'function' ? Number(score(id)) : Infinity; } catch { s = Infinity; }
      if (!(s >= 0) || !(s > needIn)) continue;
      // Empate (p. ej. ninguna vuelve): la usada hace más tiempo
      if (s > vs || (s === vs && e.used < vu)) { victim = id; vs = s; vu = e.used; }
    }
    if (victim == null) return false;
    ready.delete(victim);
    return true;
  }

  function start(track) {
    const id = track.id;
    const my = gen;
    const promise = withTimeout(decodeTrack(track), limitMs)
      .then((buf) => {
        if (my !== gen) return false;
        if (!buf || !(buf.duration > 1)) throw new Error('vacía');
        ready.set(id, { buf, used: ++tick });
        peak = Math.max(peak, ready.size);
        return true;
      })
      .catch(() => {
        if (my === gen) failed.add(id);
        return false;
      })
      .finally(() => { if (busy?.promise === promise) busy = null; });
    busy = { id, promise };
  }

  function request(track, needIn = 0, score = null) {
    const id = track?.id;
    if (!id) return 'failed';
    if (ready.has(id)) return 'ready';
    if (failed.has(id)) return 'failed';
    if (busy) return busy.id === id ? 'loading' : 'busy';
    if (ready.size >= max && !evictOne(Math.max(0, Number(needIn) || 0), score)) return 'full';
    start(track);
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
    has: (id) => ready.has(id),
    isFailed: (id) => failed.has(id),
    loadingId: () => busy?.id ?? null,
    /** Espera a que termine la decodificación en curso (true si dejó lista `id`). */
    settle(id) {
      if (!busy) return Promise.resolve(ready.has(id));
      return busy.promise.then(() => ready.has(id), () => ready.has(id));
    },
    release(id) { ready.delete(id); },
    stats: () => ({ decoded: ready.size, peak, loading: busy?.id ?? null, failed: failed.size, ids: [...ready.keys()] }),
    clear() {
      gen++;
      ready.clear();
      failed.clear();
      busy = null;
    },
  };
}
