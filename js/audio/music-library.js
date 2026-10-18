// BestRunning · biblioteca musical: pistas integradas (audio/music/library.json) + importadas por el usuario
// (IndexedDB a través de music-import.js, que puede no estar disponible). Descarga para usar sin conexión con
// Cache API ('br-music'). No toca window/document al importarse.
import { trackGrid } from './music-plan.js';

export const MUSIC_CACHE = 'br-music';
const LIBRARY_URL = new URL('../../audio/music/library.json', import.meta.url);
const ROOT_URL = new URL('../../', import.meta.url);

/** Tramos musicales (nombres en español y colores de zona). */
export const TIER_ORDER = ['calm', 'jog', 'run', 'fast', 'sprint'];
export const TIER_INFO = {
  calm: {
    key: 'calm', name: 'Calma', color: 'var(--z-cooldown)', hex: '#7D7AFF', bpm: [0, 118],
    zones: ['warmup', 'walk', 'cooldown'], description: 'Calentamiento y vuelta a la calma',
  },
  jog: {
    key: 'jog', name: 'Trote', color: 'var(--z-jog)', hex: '#30D158', bpm: [118, 126],
    zones: ['warmup', 'jog', 'run'], description: 'Rodaje suave y recuperaciones',
  },
  run: {
    key: 'run', name: 'Correr', color: 'var(--z-run)', hex: '#FFD60A', bpm: [126, 134],
    zones: ['run'], description: 'Ritmo de carrera y tempo',
  },
  fast: {
    key: 'fast', name: 'Rápido', color: 'var(--z-fast)', hex: '#FF9F0A', bpm: [134, 148],
    zones: ['fast'], description: 'Series rápidas y umbral',
  },
  sprint: {
    key: 'sprint', name: 'Sprint', color: 'var(--z-sprint)', hex: '#FF375F', bpm: [148, 999],
    zones: ['sprint'], description: 'Sprints a tope (drum & bass)',
  },
};

/** Tramo por BPM (mismos rangos que tools/music/analyze.py). */
export function tierForBpm(bpm) {
  const b = Number(bpm) || 0;
  for (const k of TIER_ORDER) {
    const [lo, hi] = TIER_INFO[k].bpm;
    if (b >= lo && b < hi) return k;
  }
  return 'sprint';
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const hasCaches = () => typeof globalThis.caches?.open === 'function';

function normCues(c) {
  const cues = c && typeof c === 'object' ? c : {};
  return {
    mixIn: num(cues.mixIn, 0),
    drops: Array.isArray(cues.drops) ? cues.drops.map(Number).filter(Number.isFinite) : [],
    outro: num(cues.outro, 0),
    hotBars: Array.isArray(cues.hotBars) ? cues.hotBars.map(Number).filter(Number.isInteger) : [],
  };
}

function normTrack(t, extra) {
  const bpm = num(t.bpm);
  const tier = TIER_INFO[t.tier] ? t.tier : tierForBpm(bpm);
  const track = {
    id: String(t.id),
    title: String(t.title || 'Sin título'),
    artist: String(t.artist || ''),
    bpm,
    confidence: num(t.confidence, 0),
    duration: num(t.duration),
    beatOffset: num(t.beatOffset),
    barOffset: num(t.barOffset, num(t.beatOffset)),
    bars: num(t.bars, Array.isArray(t.energy) ? t.energy.length : 0),
    energy: Array.isArray(t.energy) ? t.energy.map((x) => num(x)) : [],
    cues: normCues(t.cues),
    tier,
    curatedTier: TIER_INFO[t.curatedTier] ? t.curatedTier : tier,
    gainDb: num(t.gainDb, 0),
    sizeBytes: num(t.sizeBytes, 0),
    ...extra,
  };
  return track.bpm > 40 && track.duration > 30 ? track : null;
}

/* ───────────── Integradas ───────────── */

let builtIn = null; // Promise<track[]>

function builtInTracks() {
  if (!builtIn) {
    builtIn = fetch(LIBRARY_URL)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((json) => (Array.isArray(json?.tracks) ? json.tracks : [])
        .map((t) => normTrack(t, {
          url: new URL(String(t.file || `audio/music/${t.id}.m4a`), ROOT_URL).href,
          source: String(t.source || 'Pixabay'),
          page: String(t.page || ''),
          license: String(t.license || ''),
          user: false,
          enabled: true,
        }))
        .filter(Boolean))
      .catch((err) => { builtIn = null; throw err; });
  }
  return builtIn;
}

/* ───────────── Importadas (opcional) ───────────── */

const ownUrls = new Map(); // id → { key, url } (objectURL creados aquí)

async function userTracks() {
  // El módulo de importación (M2) es opcional: si no carga, solo hay música integrada
  const mod = await import('./music-import.js').catch(() => null);
  if (typeof mod?.listUserTracks !== 'function') return [];
  let recs = [];
  try { recs = (await mod.listUserTracks()) || []; } catch { return []; }
  const out = [];
  for (const r of Array.isArray(recs) ? recs : []) {
    if (!r || !r.id || r.enabled === false) continue;
    let url = null;
    try {
      if (typeof mod.userTrackUrl === 'function') url = await mod.userTrackUrl(r.id);
    } catch { url = null; }
    if (!url && r.blob && typeof URL.createObjectURL === 'function') {
      const key = `${r.id}|${r.addedAt || ''}|${r.blob.size || 0}`;
      const prev = ownUrls.get(r.id);
      if (prev && prev.key === key) url = prev.url;
      else {
        if (prev) { try { URL.revokeObjectURL(prev.url); } catch { /* nada */ } }
        url = URL.createObjectURL(r.blob);
        ownUrls.set(r.id, { key, url });
      }
    }
    if (!url) continue;
    const t = normTrack(r, {
      url, source: 'user', user: true, enabled: true, addedAt: r.addedAt || null, mime: r.mime || '',
      // el Blob (de IndexedDB) se lee directo con blob.arrayBuffer(): sin pasar por fetch(blob:)
      blob: r.blob || null, sizeBytes: num(r.size, num(r.blob?.size, 0)),
    });
    if (t) out.push(t);
  }
  return out.sort((a, b) => String(a.addedAt || '').localeCompare(String(b.addedAt || '')));
}

/**
 * Biblioteca activa: integradas + importadas (activas), sin las desactivadas, con `url` lista para descargar.
 * Nunca lanza: si algo falla devuelve lo que haya podido cargar.
 */
export async function loadLibrary({ useBuiltIn = true, useImported = true, disabled = [] } = {}) {
  const off = new Set(Array.isArray(disabled) ? disabled.map(String) : []);
  const [a, b] = await Promise.all([
    useBuiltIn !== false ? builtInTracks().catch(() => []) : [],
    useImported !== false ? userTracks().catch(() => []) : [],
  ]);
  const seen = new Set();
  const out = [];
  for (const t of [...a, ...b]) {
    if (off.has(t.id) || seen.has(t.id)) continue;
    seen.add(t.id);
    trackGrid(t);
    out.push(t);
  }
  return out;
}

/** Todas las integradas (activadas o no), para la pantalla de ajustes. */
export async function builtInLibrary() {
  try { return await builtInTracks(); } catch { return []; }
}

/** Map id → pista. */
export function libraryById(tracks) {
  return new Map((tracks || []).map((t) => [t.id, t]));
}

/** Pistas agrupadas por tramo, en orden de intensidad: [{ tier, info, tracks }]. */
export function groupByTier(tracks) {
  return TIER_ORDER.map((k) => ({
    tier: k,
    info: TIER_INFO[k],
    tracks: (tracks || []).filter((t) => (t.tier || tierForBpm(t.bpm)) === k).sort((x, y) => x.bpm - y.bpm),
  })).filter((g) => g.tracks.length);
}

/** Posición de inicio para escuchar 15 s de una pista (su primer drop o su mixIn). */
export function previewStart(track) {
  const g = trackGrid(track);
  if (!g) return 0;
  const p = g.drops[0] ?? g.alignPoints[0]?.t ?? g.mixIn;
  return Math.max(0, Math.min(p, g.duration - 16));
}

/* ───────────── Sin conexión ───────────── */

/**
 * Fuente para un <audio>: si la pista está descargada, objectURL del blob de la caché (sin red y sin pasar por el
 * service worker); si no, su URL. { src, revoke, cached }.
 */
export async function resolveTrackSource(track) {
  if (!track?.url) return null;
  if (track.user || /^(blob|data):/.test(track.url)) return { src: track.url, revoke: null, cached: true };
  try {
    if (hasCaches() && typeof URL.createObjectURL === 'function') {
      const cache = await caches.open(MUSIC_CACHE);
      const hit = await cache.match(track.url);
      if (hit) {
        const blob = await hit.blob();
        if (blob.size > 4096) {
          const typed = blob.type ? blob : new Blob([blob], { type: 'audio/mp4' });
          const src = URL.createObjectURL(typed);
          return { src, revoke: () => { try { URL.revokeObjectURL(src); } catch { /* nada */ } }, cached: true };
        }
      }
    }
  } catch { /* sin caché: red */ }
  return { src: track.url, revoke: null, cached: false };
}

/** Bytes de una importada: su Blob y, si iOS lo perdió (WebKitBlobResource tras ir a segundo plano), uno nuevo de IndexedDB. */
async function userTrackData(track, fetchImpl, signal) {
  if (typeof track.blob?.arrayBuffer === 'function') {
    try { return await track.blob.arrayBuffer(); } catch { /* Blob caducado: se pide otra vez */ }
  }
  if (signal?.aborted) throw new Error('abortada');
  const mod = await import('./music-import.js').catch(() => null);
  try {
    const rec = typeof mod?.getUserTrack === 'function' ? await mod.getUserTrack(track.id) : null;
    if (typeof rec?.blob?.arrayBuffer === 'function') {
      track.blob = rec.blob;
      return await rec.blob.arrayBuffer();
    }
  } catch { /* último recurso: su objectURL */ }
  if (typeof fetchImpl !== 'function') throw new Error('sin fetch');
  const res = await fetchImpl(track.url, signal ? { signal } : undefined);
  if (!res || !res.ok) throw new Error(`HTTP ${res?.status}`);
  return res.arrayBuffer();
}

/**
 * Bytes comprimidos de la pista (ArrayBuffer listo para decodeAudioData): de la caché sin conexión si está y, si no,
 * de la red (el service worker la guarda al pasar). Las importadas, de su Blob. `signal` aborta la descarga.
 * Lanza si no hay forma.
 */
export async function fetchTrackData(track, fetchImpl = globalThis.fetch, { signal = null } = {}) {
  if (!track?.url && !track?.blob) throw new Error('sin fuente');
  if (track.user) return userTrackData(track, fetchImpl, signal);
  if (!/^(blob|data):/.test(track.url) && hasCaches()) {
    try {
      const hit = await (await caches.open(MUSIC_CACHE)).match(track.url);
      if (hit) {
        const buf = await hit.arrayBuffer();
        if (buf.byteLength > 4096) return buf;
      }
    } catch { /* sin caché: red */ }
  }
  if (typeof fetchImpl !== 'function') throw new Error('sin fetch');
  const res = await fetchImpl(track.url, signal ? { signal } : undefined);
  if (!res || !res.ok) throw new Error(`HTTP ${res?.status}`);
  return res.arrayBuffer();
}

async function readWithProgress(res, onChunk) {
  const type = res.headers.get('content-type') || 'audio/mp4';
  const reader = res.body?.getReader?.();
  if (!reader) return res.blob();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onChunk(value.byteLength);
  }
  return new Blob(chunks, { type: /audio|mp4|octet/.test(type) ? type : 'audio/mp4' });
}

/**
 * Descarga todas las pistas integradas a la caché 'br-music'.
 * onProgress({ done, total, cached, failed, bytes, totalBytes, fraction, trackId, title }).
 * Devuelve { ok, cached, failed, total, bytes }.
 */
export async function cacheAllForOffline(onProgress = null, { signal = null } = {}) {
  let tracks = [];
  try { tracks = await builtInTracks(); } catch { tracks = []; }
  const total = tracks.length;
  const totalBytes = tracks.reduce((a, t) => a + (t.sizeBytes || 0), 0);
  if (!hasCaches()) return { ok: false, cached: 0, failed: total, total, bytes: 0, error: 'Este navegador no permite guardar la música' };
  try { globalThis.navigator?.storage?.persist?.()?.catch?.(() => {}); } catch { /* opcional */ }
  let cache;
  try { cache = await caches.open(MUSIC_CACHE); } catch { return { ok: false, cached: 0, failed: total, total, bytes: 0, error: 'Sin espacio para guardar la música' }; }
  let cached = 0;
  let failed = 0;
  let bytes = 0;
  const emit = (t, partial = 0) => {
    if (typeof onProgress !== 'function') return;
    const b = bytes + partial;
    try {
      onProgress({
        done: cached + failed, total, cached, failed, bytes: b, totalBytes,
        fraction: totalBytes ? Math.min(1, b / totalBytes) : (cached + failed) / Math.max(1, total),
        trackId: t?.id || null, title: t?.title || '',
      });
    } catch { /* el callback no rompe la descarga */ }
  };
  emit(null);
  for (const t of tracks) {
    if (signal?.aborted) break;
    try {
      const hit = await cache.match(t.url);
      if (hit) {
        cached++;
        bytes += Number(hit.headers.get('content-length')) || t.sizeBytes || 0;
        emit(t);
        continue;
      }
      const res = await fetch(t.url, { signal: signal || undefined });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let partial = 0;
      const blob = await readWithProgress(res, (n) => { partial += n; emit(t, partial); });
      if (blob.size < 4096) throw new Error('archivo vacío');
      await cache.put(t.url, new Response(blob, {
        headers: { 'Content-Type': blob.type || 'audio/mp4', 'Content-Length': String(blob.size) },
      }));
      cached++;
      bytes += blob.size;
    } catch {
      if (signal?.aborted) break;
      failed++;
    }
    emit(t);
  }
  return { ok: failed === 0 && cached === total, cached, failed, total, bytes };
}

/** Estado de la descarga sin conexión: { cached, total, bytes, totalBytes, complete, supported }. */
export async function offlineStatus() {
  let tracks = [];
  try { tracks = await builtInTracks(); } catch { tracks = []; }
  const total = tracks.length;
  const totalBytes = tracks.reduce((a, t) => a + (t.sizeBytes || 0), 0);
  if (!hasCaches()) return { cached: 0, total, bytes: 0, totalBytes, complete: false, supported: false };
  let cached = 0;
  let bytes = 0;
  try {
    const cache = await caches.open(MUSIC_CACHE);
    for (const t of tracks) {
      const hit = await cache.match(t.url);
      if (!hit) continue;
      cached++;
      bytes += Number(hit.headers.get('content-length')) || t.sizeBytes || 0;
    }
  } catch { /* caché inaccesible */ }
  return { cached, total, bytes, totalBytes, complete: total > 0 && cached === total, supported: true };
}

/** Borra la música descargada. */
export async function clearOfflineMusic() {
  try { return hasCaches() ? await caches.delete(MUSIC_CACHE) : false; } catch { return false; }
}
