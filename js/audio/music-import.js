// BestRunning · importar canciones desde el iPhone (app Archivos): lectura, decodificación, análisis "de DJ"
// en un Worker y guardado en IndexedDB ('br-music' · store 'tracks'). Archivos de uno en uno para no agotar
// la memoria del iPhone. Nada toca window/document al importarse (se puede importar desde Node para tests).
import {
  analyzePcmAsync, analyzeFeatures, retimeAnalysis, downmix, measureLoudnessAsync, tierForBpm, gainForLoudness,
  TIER_PRIOR, ANALYSIS_VERSION, MAX_GAIN_DB,
} from './music-analysis.js';

export const MUSIC_DB = 'br-music';
export const TRACKS_STORE = 'tracks';
const FEATURES_STORE = 'features';      // rasgos del análisis (para recalcular la rejilla con BPM manual)
const STORES = [TRACKS_STORE, FEATURES_STORE];

export const TIERS = ['calm', 'jog', 'run', 'fast', 'sprint'];
const TIER_LABEL = { calm: 'Calma', jog: 'Trote', run: 'Correr', fast: 'Rápido', sprint: 'Sprint' };

/** Valor recomendado para `<input type="file" accept>` (audio/* + extensiones para que Archivos no las atenúe). */
export const IMPORT_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.mp4,.wav,.aif,.aiff,.flac,.caf,.ogg,.opus';
export const IMPORT_LIMITS = { minSec: 60, maxSec: 20 * 60, maxBytes: 100 * 1024 * 1024 };

const BIG_DECODE_BYTES = 25 * 1024 * 1024; // por encima se decodifica directamente a 22 050 Hz (memoria)
const WORKER_READY_MS = 6000;

const EXT_MIME = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', adts: 'audio/aac',
  wav: 'audio/wav', wave: 'audio/wav', aif: 'audio/aiff', aiff: 'audio/aiff', aifc: 'audio/aiff', flac: 'audio/flac',
  caf: 'audio/x-caf', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm',
};
const DRM_EXT = new Set(['m4p', 'movpkg', 'aax', 'wma', 'drm']);

/** Error con código para la interfaz: format · drm · short · long · big · read · decode · analysis · storage · quota · duplicate · aborted · bpm · tier */
export class MusicImportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MusicImportError';
    this.code = code;
  }
}

const q = (name) => `«${String(name || 'archivo').slice(0, 80)}»`;
const round3 = (x) => Math.round(x * 1000) / 1000;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/* ───────────── Nombres y etiquetas ───────────── */

/** Nombre de archivo → título legible: sin extensión, número de pista ni coletillas tipo "(Official Video)". */
export function cleanTitle(fileName) {
  let s = String(fileName || '').replace(/\.[a-z0-9]{1,6}$/i, '');
  if (/%[0-9a-f]{2}/i.test(s)) {
    try { s = decodeURIComponent(s); } catch { /* nombre tal cual */ }
  }
  s = s.replace(/_+/g, ' ');
  s = s.replace(/\s*[([][^)\]]*\b(official|oficial|video|vídeo|videoclip|audio|lyrics?|letra|visuali[sz]er|hq|hd|4k|free download|descarga gratis|\d{2,3}\s?kbps)\b[^)\]]*[)\]]/gi, ' ');
  s = s.replace(/^(?:\d{1,2}[-.]\d{1,3}|\d{1,3}\s*[-.)]|0\d)\s+/, '');
  s = s.replace(/\s{2,}/g, ' ').replace(/^[\s\-–—.·]+|[\s\-–—.·]+$/g, '').trim();
  return s.slice(0, 120) || 'Canción sin título';
}

const ascii = (u8, p, n) => {
  let s = '';
  for (let i = 0; i < n && p + i < u8.length; i++) s += String.fromCharCode(u8[p + i]);
  return s;
};
const be32 = (u8, p) => ((u8[p] << 24) >>> 0) + (u8[p + 1] << 16) + (u8[p + 2] << 8) + u8[p + 3];
const le32 = (u8, p) => u8[p] + (u8[p + 1] << 8) + (u8[p + 2] << 16) + ((u8[p + 3] << 24) >>> 0);
const syncsafe = (u8, p) => ((u8[p] & 0x7f) << 21) | ((u8[p + 1] & 0x7f) << 14) | ((u8[p + 2] & 0x7f) << 7) | (u8[p + 3] & 0x7f);

function decodeText(bytes, label) {
  try { return new TextDecoder(label).decode(bytes); } catch { return ''; }
}

function tidy(s) {
  const t = String(s || '').split('\u0000')[0].replace(/[\u0001-\u001f]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return t.includes('�') ? '' : t.slice(0, 120);
}

function id3Text(b) {
  if (!b.length) return '';
  const enc = b[0];
  const d = b.subarray(1);
  if (enc === 0) return tidy(decodeText(d, 'latin1'));
  if (enc === 3) return tidy(decodeText(d, 'utf-8'));
  if (enc === 2) return tidy(decodeText(d, 'utf-16be'));
  if (enc === 1) {
    if (d[0] === 0xfe && d[1] === 0xff) return tidy(decodeText(d.subarray(2), 'utf-16be'));
    if (d[0] === 0xff && d[1] === 0xfe) return tidy(decodeText(d.subarray(2), 'utf-16le'));
    return tidy(decodeText(d, 'utf-16le'));
  }
  return '';
}

function unsync(b) {
  const out = [];
  for (let i = 0; i < b.length; i++) {
    out.push(b[i]);
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return Uint8Array.from(out);
}

function id3v2(u8, at = 0) {
  if (u8.length < at + 10 || ascii(u8, at, 3) !== 'ID3') return null;
  const ver = u8[at + 3];
  const flags = u8[at + 5];
  const end = Math.min(u8.length, at + 10 + syncsafe(u8, at + 6));
  let p = at + 10;
  if (flags & 0x40 && ver >= 3) p += ver === 4 ? syncsafe(u8, p) : be32(u8, p) + 4;
  const tagUnsync = (flags & 0x80) && ver < 4;
  const out = { title: '', artist: '', albumArtist: '' };
  const hdr = ver === 2 ? 6 : 10;
  while (p + hdr <= end) {
    const id = ascii(u8, p, ver === 2 ? 3 : 4);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    const size = ver === 2 ? (u8[p + 3] << 16) | (u8[p + 4] << 8) | u8[p + 5] : ver === 4 ? syncsafe(u8, p + 4) : be32(u8, p + 4);
    if (size <= 0) break;
    let start = p + hdr;
    const stop = Math.min(end, start + size);
    const fmt = ver === 4 ? u8[p + 9] : 0;
    if (!(fmt & 0x08) && !(fmt & 0x04)) {
      if (fmt & 0x01) start += 4;
      let body = u8.subarray(start, stop);
      if (tagUnsync || fmt & 0x02) body = unsync(body);
      if (id === 'TIT2' || id === 'TT2') out.title = id3Text(body);
      else if (id === 'TPE1' || id === 'TP1') out.artist = id3Text(body);
      else if (id === 'TPE2' || id === 'TP2') out.albumArtist = id3Text(body);
    }
    p = stop;
  }
  return out.title || out.artist ? { title: out.title, artist: out.artist || out.albumArtist } : null;
}

function id3v1(u8) {
  const p = u8.length - 128;
  if (p < 0 || ascii(u8, p, 3) !== 'TAG') return null;
  const title = tidy(decodeText(u8.subarray(p + 3, p + 33), 'latin1'));
  const artist = tidy(decodeText(u8.subarray(p + 33, p + 63), 'latin1'));
  return title || artist ? { title, artist } : null;
}

function mp4Box(u8, start, end, type) {
  let p = start;
  while (p + 8 <= end) {
    let size = be32(u8, p);
    let hdr = 8;
    if (size === 1) {
      size = be32(u8, p + 8) * 4294967296 + be32(u8, p + 12);
      hdr = 16;
    } else if (size === 0) size = end - p;
    if (size < hdr) return null;
    if (ascii(u8, p + 4, 4) === type) return { start: p + hdr, end: Math.min(end, p + size) };
    p += size;
  }
  return null;
}

function mp4Tags(u8) {
  if (u8.length < 16 || ascii(u8, 4, 4) !== 'ftyp') return null;
  const moov = mp4Box(u8, 0, u8.length, 'moov');
  const udta = moov && mp4Box(u8, moov.start, moov.end, 'udta');
  const meta = udta && mp4Box(u8, udta.start, udta.end, 'meta');
  if (!meta) return null;
  const ms = ascii(u8, meta.start + 4, 4) === 'hdlr' ? meta.start : meta.start + 4; // 'meta' suele ser full box
  const ilst = mp4Box(u8, ms, meta.end, 'ilst');
  if (!ilst) return null;
  const item = (type) => {
    const box = mp4Box(u8, ilst.start, ilst.end, type);
    const data = box && mp4Box(u8, box.start, box.end, 'data');
    return data && data.end > data.start + 8 ? tidy(decodeText(u8.subarray(data.start + 8, data.end), 'utf-8')) : '';
  };
  const title = item('©nam');
  const artist = item('©ART') || item('aART');
  return title || artist ? { title, artist } : null;
}

function flacTags(u8) {
  if (ascii(u8, 0, 4) !== 'fLaC') return null;
  let p = 4;
  while (p + 4 <= u8.length) {
    const last = u8[p] & 0x80;
    const type = u8[p] & 0x7f;
    const len = (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3];
    const start = p + 4;
    if (type === 4) {
      let c = start + 4 + le32(u8, start);
      const n = le32(u8, c);
      c += 4;
      const out = { title: '', artist: '' };
      for (let i = 0; i < n && c + 4 <= start + len; i++) {
        const l = le32(u8, c);
        const kv = decodeText(u8.subarray(c + 4, c + 4 + l), 'utf-8');
        c += 4 + l;
        const eq = kv.indexOf('=');
        const k = kv.slice(0, eq).toUpperCase();
        if (k === 'TITLE' && !out.title) out.title = tidy(kv.slice(eq + 1));
        if (k === 'ARTIST' && !out.artist) out.artist = tidy(kv.slice(eq + 1));
      }
      return out.title || out.artist ? out : null;
    }
    if (last) break;
    p = start + len;
  }
  return null;
}

function chunkTags(u8) {
  const riff = ascii(u8, 0, 4) === 'RIFF' && ascii(u8, 8, 4) === 'WAVE';
  const aiff = ascii(u8, 0, 4) === 'FORM' && /^AIF[FC]$/.test(ascii(u8, 8, 4));
  if (!riff && !aiff) return null;
  const size = (p) => (riff ? le32(u8, p) : be32(u8, p));
  let p = 12;
  const out = { title: '', artist: '' };
  while (p + 8 <= u8.length) {
    const id = ascii(u8, p, 4);
    const len = size(p + 4);
    const start = p + 8;
    if (id === 'id3 ' || id === 'ID3 ') {
      const t = id3v2(u8, start);
      if (t) return t;
    } else if (riff && id === 'LIST' && ascii(u8, start, 4) === 'INFO') {
      let c = start + 4;
      while (c + 8 <= start + len) {
        const sid = ascii(u8, c, 4);
        const sl = le32(u8, c + 4);
        const txt = tidy(decodeText(u8.subarray(c + 8, c + 8 + sl), 'utf-8'));
        if (sid === 'INAM') out.title = txt;
        if (sid === 'IART') out.artist = txt;
        c += 8 + sl + (sl & 1);
      }
    } else if (aiff && id === 'NAME') out.title = tidy(decodeText(u8.subarray(start, start + len), 'latin1'));
    p = start + len + (len & 1);
  }
  return out.title || out.artist ? out : null;
}

/** Etiquetas del archivo (ID3v2/v1, MP4 ilst, FLAC Vorbis, WAV INFO, AIFF) → { title, artist } ('' si no hay). */
export function readTags(buffer) {
  try {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return id3v2(u8) || mp4Tags(u8) || flacTags(u8) || chunkTags(u8) || id3v1(u8) || { title: '', artist: '' };
  } catch {
    return { title: '', artist: '' };
  }
}

/* ───────────── IndexedDB ───────────── */

let dbPromise = null;

function openWith(factory, version) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = version ? factory.open(MUSIC_DB, version) : factory.open(MUSIC_DB);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb() {
  if (dbPromise) return dbPromise;
  const factory = globalThis.indexedDB;
  if (!factory) return Promise.reject(new MusicImportError('storage', 'Este navegador no permite guardar canciones.'));
  dbPromise = openWith(factory)
    .then((db) => {
      if (STORES.every((s) => db.objectStoreNames.contains(s))) return db;
      // La base existe sin alguno de los almacenes: se amplía con una versión nueva
      const v = db.version + 1;
      db.close();
      return openWith(factory, v);
    })
    .then((db) => {
      db.onversionchange = () => {
        try { db.close(); } catch { /* ya cerrada */ }
        dbPromise = null;
      };
      db.onclose = () => { dbPromise = null; };
      return db;
    })
    .catch((e) => {
      dbPromise = null;
      throw e;
    });
  return dbPromise;
}

/** Ejecuta fn(tx) en una transacción; resuelve con lo que fn deje en `out.value` al completarse. Reintenta 1 vez si la conexión se perdió. */
async function withTx(names, mode, fn, retry = true) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const out = { value: undefined };
      let tx;
      try {
        tx = db.transaction(names, mode);
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = () => resolve(out.value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transacción abortada'));
      try {
        fn(tx, out);
      } catch (e) {
        try { tx.abort(); } catch { /* ya terminada */ }
        reject(e);
      }
    });
  } catch (e) {
    const lost = e && (e.name === 'InvalidStateError' || e.name === 'UnknownError' || /connection|closing/i.test(e.message || ''));
    if (retry && lost) {
      dbPromise = null;
      return withTx(names, mode, fn, false);
    }
    throw e;
  }
}

const allRaw = () => withTx([TRACKS_STORE], 'readonly', (tx, out) => {
  const r = tx.objectStore(TRACKS_STORE).getAll();
  r.onsuccess = () => { out.value = r.result || []; };
});

const getRaw = (store, id) => withTx([store], 'readonly', (tx, out) => {
  const r = tx.objectStore(store).get(id);
  r.onsuccess = () => { out.value = r.result || null; };
});

const isQuota = (e) => !!e && (e.name === 'QuotaExceededError' || /quota|space/i.test(e.message || ''));

async function putRecords(track, features) {
  const write = (rec) => withTx(STORES, 'readwrite', (tx) => {
    tx.objectStore(TRACKS_STORE).put(rec);
    if (features) tx.objectStore(FEATURES_STORE).put(features);
  });
  try {
    await write(track);
    return track;
  } catch (e) {
    if (isQuota(e)) throw e;
    // Algunos WebKit no guardan Blob en IndexedDB: se guarda el ArrayBuffer y se rehace el Blob al leer
    if (!track.blob) throw e;
    const alt = { ...track, blob: null, buf: await track.blob.arrayBuffer() };
    await write(alt);
    return alt;
  }
}

/* ───────────── URLs de objeto (cacheadas y revocables) ───────────── */

const blobs = new Map();   // id → Blob
const urls = new Map();    // id → blob: URL

function rememberBlob(rec) {
  let blob = rec.blob || null;
  if (!blob && rec.buf) blob = new Blob([rec.buf], { type: rec.mime || 'audio/mp4' });
  if (blob) blobs.set(rec.id, blob);
  return blob;
}

function makeUrl(id) {
  const blob = blobs.get(id);
  if (!blob || typeof URL?.createObjectURL !== 'function') return null;
  const u = URL.createObjectURL(blob);
  urls.set(id, u);
  return u;
}

/**
 * URL reproducible de una pista importada. Devuelve la URL (string) al momento si la pista ya está en memoria
 * —siempre tras listUserTracks() o importFiles()—; si no, una Promise<string|null> (funciona con `await`).
 */
export function userTrackUrl(id) {
  if (urls.has(id)) return urls.get(id);
  if (blobs.has(id)) return makeUrl(id);
  return getRaw(TRACKS_STORE, id)
    .then((rec) => {
      if (!rec) return null;
      rememberBlob(rec);
      return urls.get(id) || makeUrl(id);
    })
    .catch(() => null);
}

export function revokeUserTrackUrl(id) {
  const u = urls.get(id);
  if (u) {
    try { URL.revokeObjectURL(u); } catch { /* sin efecto */ }
    urls.delete(id);
  }
}

export function revokeAllUserTrackUrls() {
  for (const id of [...urls.keys()]) revokeUserTrackUrl(id);
}

function publicTrack(rec) {
  const blob = rememberBlob(rec);
  const out = { ...rec, blob, url: blob ? userTrackUrl(rec.id) : null, user: true };
  delete out.buf;
  return out;
}

function notifyChange(reason, id = null) {
  try {
    if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      globalThis.dispatchEvent(new CustomEvent('br:music-library', { detail: { reason, id } }));
    }
  } catch { /* sin oyentes */ }
}

/* ───────────── Decodificación ───────────── */

function decodeWith(ctx, buf) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ok = (b) => { if (!settled) { settled = true; resolve(b); } };
    const ko = (e) => { if (!settled) { settled = true; reject(e || new Error('decode')); } };
    try {
      const p = ctx.decodeAudioData(buf, ok, ko);
      if (p && typeof p.then === 'function') p.then(ok, ko);
    } catch (e) {
      ko(e);
    }
  });
}

/** Decodifica con un OfflineAudioContext (sin hardware ni sesión de audio); respaldo: AudioContext temporal. */
async function decodeAudio(buf, rate) {
  const Off = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  let ctx = null;
  if (Off) {
    for (const r of [rate, 44100, 48000]) {
      try {
        ctx = new Off(1, 1, r);
        break;
      } catch { /* frecuencia no admitida */ }
    }
  }
  if (ctx) return decodeWith(ctx, buf);
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) throw new MusicImportError('decode', 'Este navegador no puede decodificar audio.');
  const tmp = new AC();
  try {
    return await decodeWith(tmp, buf);
  } finally {
    try { tmp.close(); } catch { /* ya cerrado */ }
  }
}

/* ───────────── Análisis: Worker con respaldo en el hilo principal ───────────── */

async function analyzeHere(pcm, sampleRate, opts, onProgress) {
  const { features = null, ...analysis } = await analyzePcmAsync(pcm, sampleRate, { ...opts, onProgress });
  return { analysis, features };
}

function createAnalyzer() {
  let worker = null;
  let broken = false;
  let ready = null;
  let seq = 0;
  const pending = new Map();

  const kill = () => {
    try { worker?.terminate(); } catch { /* ya terminado */ }
    worker = null;
    ready = null;
  };
  const crash = (msg) => {
    broken = true;
    for (const p of pending.values()) p.reject(Object.assign(new Error(msg || 'Worker caído'), { workerCrash: true }));
    pending.clear();
    kill();
  };

  function start() {
    if (broken || typeof Worker !== 'function') return Promise.resolve(false);
    if (ready) return ready;
    ready = new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!ok) {
          broken = true;
          kill();
        }
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), WORKER_READY_MS);
      try {
        worker = new Worker(new URL('./music-worker.js', import.meta.url), { type: 'module', name: 'br-music-analysis' });
      } catch {
        finish(false);
        return;
      }
      worker.onmessage = (ev) => {
        const m = ev.data || {};
        if (m.type === 'ready') { finish(true); return; }
        const p = pending.get(m.id);
        if (!p) return;
        if (m.type === 'progress') p.onProgress?.(m.progress, m.stage);
        else if (m.type === 'result') { pending.delete(m.id); p.resolve({ analysis: m.analysis, features: m.features || null }); }
        else if (m.type === 'error') { pending.delete(m.id); p.reject(new Error(m.message)); }
      };
      worker.onerror = (ev) => {
        try { ev.preventDefault(); } catch { /* sin efecto */ }
        if (!done) finish(false);
        else crash(ev?.message);
      };
      worker.onmessageerror = () => crash('messageerror');
    });
    return ready;
  }

  async function run(pcm, sampleRate, opts, onProgress) {
    // El PCM solo se transfiere cuando el Worker ya respondió: si no arranca, el análisis sigue aquí con los datos intactos
    if (!(await start()) || !worker) return analyzeHere(pcm, sampleRate, opts, onProgress);
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject, onProgress });
      try {
        worker.postMessage({ type: 'analyze', id, pcm, sampleRate, ...opts }, [pcm.buffer]);
      } catch (e) {
        pending.delete(id);
        if (pcm.length) analyzeHere(pcm, sampleRate, opts, onProgress).then(resolve, reject);
        else reject(e);
      }
    });
  }

  return { run, dispose: kill };
}

/* ───────────── Importación ───────────── */

const extOf = (name) => {
  const m = /\.([a-z0-9]{1,6})$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
};

function mimeFor(file, ext) {
  const t = String(file.type || '').toLowerCase();
  if (t.startsWith('audio/') && t !== 'audio/x-m4p') return t;
  return EXT_MIME[ext] || (t === 'video/mp4' ? 'audio/mp4' : t || 'audio/mp4');
}

const sourceKeyOf = (file) => `${String(file.name || '').toLowerCase()}|${file.size || 0}`;

function newId() {
  const rnd = Math.floor(Math.random() * 46656).toString(36).padStart(3, '0');
  return `u_${Date.now().toString(36)}${rnd}`;
}

function toFiles(list) {
  if (!list) return [];
  if (typeof list.length === 'number' && typeof list !== 'string') return Array.from(list).filter(Boolean);
  return [list];
}

function decodeError(name, ext) {
  if (['m4a', 'mp4', 'aac', 'm4b'].includes(ext)) {
    return new MusicImportError('drm', `No se puede leer ${q(name)}. Si viene de Apple Music está protegida (DRM) y no se puede importar; usa archivos MP3 o M4A sin protección.`);
  }
  return new MusicImportError('decode', `No se ha podido leer ${q(name)}. Puede que el archivo esté dañado o no sea de audio.`);
}

function asImportError(e, name) {
  if (e instanceof MusicImportError) return e;
  if (e && e.name === 'AbortError') return new MusicImportError('aborted', 'Importación cancelada.');
  if (isQuota(e)) return new MusicImportError('quota', `No queda espacio en el iPhone para guardar ${q(name)}.`);
  if (e && (e.name === 'NotReadableError' || e.name === 'NotFoundError')) {
    return new MusicImportError('read', `No se ha podido abrir ${q(name)}. Si está en iCloud, descárgalo primero en Archivos.`);
  }
  return new MusicImportError('analysis', `No se ha podido importar ${q(name)}.`);
}

async function importOne(file, { analyzer, step, priorBpm, tier, signal }) {
  const name = file.name || 'archivo';
  const ext = extOf(name);
  const abort = () => {
    if (signal?.aborted) throw new MusicImportError('aborted', 'Importación cancelada.');
  };
  const type = String(file.type || '').toLowerCase();
  if (DRM_EXT.has(ext) || type === 'audio/x-m4p') {
    throw new MusicImportError('drm', `${q(name)} está protegida con DRM (Apple Music o compras antiguas de iTunes) y no se puede importar.`);
  }
  if (!type.startsWith('audio/') && !EXT_MIME[ext] && type !== 'video/mp4') {
    throw new MusicImportError('format', `${q(name)} no es un formato de audio compatible. Usa MP3, M4A/AAC, WAV, AIFF o FLAC.`);
  }
  if (file.size > IMPORT_LIMITS.maxBytes) throw new MusicImportError('big', `${q(name)} pesa demasiado (máximo 100 MB).`);
  if (file.size < 8 * 1024) throw new MusicImportError('short', `${q(name)} es demasiado corta para mezclarla (mínimo 1 minuto).`);

  step('read', 0.01, 'Leyendo el archivo…');
  let raw = await file.arrayBuffer();
  const mime = mimeFor(file, ext);
  const blob = new Blob([raw], { type: mime }); // copia en memoria: independiente del archivo de origen
  const tags = readTags(raw);
  abort();

  step('decode', 0.05, 'Decodificando el audio…');
  let audio;
  try {
    audio = await decodeAudio(raw, file.size > BIG_DECODE_BYTES ? 22050 : 44100);
  } catch (e) {
    if (e instanceof MusicImportError) throw e;
    throw decodeError(name, ext);
  }
  raw = null;
  const duration = audio?.duration || 0;
  if (!(duration > 0) || !audio.numberOfChannels) throw decodeError(name, ext);
  if (duration < IMPORT_LIMITS.minSec) throw new MusicImportError('short', `${q(name)} dura menos de 1 minuto: es demasiado corta para mezclarla.`);
  if (duration > IMPORT_LIMITS.maxSec) throw new MusicImportError('long', `${q(name)} dura más de 20 minutos. Importa canciones sueltas, no sesiones completas.`);
  abort();

  const sr = audio.sampleRate;
  let channels = [];
  for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c));
  step('loudness', 0.2, 'Midiendo el volumen…');
  const loudness = await measureLoudnessAsync(channels, sr, (p) => step('loudness', 0.2 + 0.08 * p));
  let mono = downmix(channels);
  channels = null;
  audio = null;
  abort();

  step('analyze', 0.3, 'Analizando ritmo y energía…');
  const hint = TIERS.includes(tier) ? tier : null;
  const opts = {
    priorBpm: Number.isFinite(priorBpm) ? priorBpm : hint ? TIER_PRIOR[hint] : 125,
    loudness,
    keepFeatures: true,
    autoOctave: !hint && !Number.isFinite(priorBpm),
    minBpm: hint === 'sprint' ? 100 : null,
  };
  let res;
  try {
    res = await analyzer.run(mono, sr, opts, (p) => step('analyze', 0.3 + 0.62 * p));
  } catch (e) {
    if (e?.workerCrash) throw e;
    throw new MusicImportError('analysis', `No se ha podido analizar el ritmo de ${q(name)}.`);
  }
  const { analysis: a, features } = res;
  mono = null;
  abort();

  step('save', 0.94, 'Guardando en tu música…');
  const id = newId();
  const rec = {
    id,
    title: tags.title || cleanTitle(name),
    artist: tags.artist || '',
    blob,
    mime,
    size: blob.size,
    fileName: name,
    sourceKey: sourceKeyOf(file),
    duration: round3(duration),
    bpm: a.bpm,
    confidence: a.confidence,
    beatOffset: a.beatOffset,
    barOffset: a.barOffset,
    bars: a.bars,
    energy: a.energy,
    cues: a.cues,
    gainDb: a.gainDb,
    loudnessDb: a.loudnessDb,
    peakDb: a.peakDb,
    tier: hint || tierForBpm(a.bpm),
    tierManual: !!hint,
    bpmSource: 'auto',
    ...(a.bpmDetected != null ? { bpmDetected: a.bpmDetected } : {}),
    analysisVersion: a.analysisVersion ?? ANALYSIS_VERSION,
    addedAt: new Date().toISOString(),
    enabled: true,
  };
  const feat = features ? { id, ...features } : null;
  let saved;
  try {
    saved = await putRecords(rec, feat);
  } catch (e) {
    if (e instanceof MusicImportError) throw e;
    if (isQuota(e)) throw new MusicImportError('quota', `No queda espacio en el iPhone para guardar ${q(name)}.`);
    throw new MusicImportError('storage', `No se ha podido guardar ${q(name)} en tu música.`);
  }
  return publicTrack(saved);
}

/**
 * Importa canciones (FileList | File[] | File) de una en una.
 * onProgress({ index, total, name, phase, fileProgress, progress, message, track?, error?, imported?, failed? })
 *   phase: 'read' | 'decode' | 'loudness' | 'analyze' | 'save' | 'done' | 'skip' | 'error' | 'finished';
 *   progress es el avance global 0..1.
 * Opciones: tier (zona a la que va destinada: prior de tempo y zona fija), priorBpm, signal (AbortSignal).
 * → Promise<track[]> con las importadas; `.errors` = [{ name, code, message }] de las que no se pudieron importar.
 */
export async function importFiles(fileList, onProgress = null, { tier = null, priorBpm = null, signal = null } = {}) {
  const files = toFiles(fileList);
  const total = files.length;
  const results = [];
  const errors = [];
  results.errors = errors;
  const emit = (info) => {
    if (typeof onProgress !== 'function') return;
    try { onProgress(info); } catch { /* el progreso nunca rompe la importación */ }
  };
  if (!total) return results;
  try { globalThis.navigator?.storage?.persist?.(); } catch { /* opcional */ }
  let known = new Set();
  try {
    known = new Set((await allRaw()).map((t) => t.sourceKey).filter(Boolean));
  } catch { /* la base se revisa de nuevo al guardar */ }
  const analyzer = createAnalyzer();
  try {
    for (let i = 0; i < total; i++) {
      const file = files[i];
      const name = file?.name || `Archivo ${i + 1}`;
      const base = { index: i, total, name };
      let lastPhase = '';
      let lastFp = -1;
      let lastMsg = '';
      const step = (phase, fp, message = null) => {
        if (message) lastMsg = message;
        if (phase === lastPhase && fp - lastFp < 0.01) return;
        lastPhase = phase;
        lastFp = fp;
        emit({ ...base, phase, fileProgress: clamp01(fp), progress: (i + clamp01(fp)) / total, message: lastMsg });
      };
      try {
        if (signal?.aborted) throw new MusicImportError('aborted', 'Importación cancelada.');
        if (!file || typeof file.arrayBuffer !== 'function') {
          throw new MusicImportError('format', `${q(name)} no es un archivo válido.`);
        }
        const key = sourceKeyOf(file);
        if (known.has(key)) throw new MusicImportError('duplicate', `${q(name)} ya está en tu música.`);
        const ctx = { analyzer, step, priorBpm, tier, signal };
        let track;
        try {
          track = await importOne(file, ctx);
        } catch (e) {
          if (!e?.workerCrash) throw e;
          track = await importOne(file, ctx); // el Worker cayó a mitad: se repite en el hilo principal
        }
        known.add(key);
        results.push(track);
        const label = TIER_LABEL[track.tier] || track.tier;
        emit({ ...base, phase: 'done', fileProgress: 1, progress: (i + 1) / total, track,
          message: `${String(track.bpm).replace('.', ',')} BPM · ${label}` });
      } catch (e) {
        const err = asImportError(e, name);
        errors.push({ name, code: err.code, message: err.message });
        emit({ ...base, phase: err.code === 'duplicate' ? 'skip' : 'error', fileProgress: 1, progress: (i + 1) / total,
          message: err.message, error: err });
        if (err.code === 'aborted') break;
      }
    }
  } finally {
    analyzer.dispose();
  }
  if (results.length) notifyChange('import');
  const n = results.length;
  emit({
    index: total - 1, total, name: '', phase: 'finished', fileProgress: 1, progress: 1, imported: n, failed: errors.length,
    message: n ? `${n === 1 ? 'Importada 1 canción' : `Importadas ${n} canciones`}` : 'No se ha importado ninguna canción',
  });
  return results;
}

/* ───────────── Biblioteca del usuario ───────────── */

/** Pistas importadas (más antiguas primero), cada una con `blob` y `url`. Nunca lanza: si falla, []. */
export async function listUserTracks({ enabledOnly = false } = {}) {
  let rows = [];
  try {
    rows = await allRaw();
  } catch {
    return [];
  }
  return rows
    .map(publicTrack)
    .filter((t) => !enabledOnly || t.enabled !== false)
    .sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
}

export async function getUserTrack(id) {
  try {
    const rec = await getRaw(TRACKS_STORE, id);
    return rec ? publicTrack(rec) : null;
  } catch {
    return null;
  }
}

/**
 * Cambia una pista importada: { title, artist, enabled, bpm, bpmSource:'manual'|'tap', tier ('auto' = por BPM), gainDb }.
 * Con BPM nuevo se recalcula la rejilla (fase, compás, energía, cues) a partir de los rasgos guardados.
 */
export async function updateUserTrack(id, patch = {}) {
  const rec = await getRaw(TRACKS_STORE, id);
  if (!rec) return null;
  const next = { ...rec };
  if (typeof patch.title === 'string') next.title = patch.title.trim().slice(0, 120) || rec.title;
  if (typeof patch.artist === 'string') next.artist = patch.artist.trim().slice(0, 120);
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (patch.gainDb != null && Number.isFinite(Number(patch.gainDb))) {
    next.gainDb = Math.round(Math.min(MAX_GAIN_DB, Math.max(-MAX_GAIN_DB, Number(patch.gainDb))) * 10) / 10;
  }
  if (patch.resetGain && Number.isFinite(rec.loudnessDb)) next.gainDb = gainForLoudness(rec.loudnessDb, rec.peakDb);
  let bpmChanged = false;
  if (patch.bpm != null) {
    const b = Number(String(patch.bpm).replace(',', '.'));
    if (!Number.isFinite(b) || b < 60 || b > 220) throw new MusicImportError('bpm', 'El BPM tiene que estar entre 60 y 220.');
    if (Math.abs(b - rec.bpm) >= 0.005) {
      let grid = null;
      try {
        const f = await getRaw(FEATURES_STORE, id);
        if (f?.env && f?.bands) grid = analyzeFeatures(f, { bpm: b });
      } catch { /* sin rasgos: respaldo */ }
      if (grid) {
        delete grid.duration; // la duración real es la del archivo, no la de la señal de análisis
        delete grid.bpmDetected;
        Object.assign(next, grid);
      } else Object.assign(next, retimeAnalysis(rec, b));
      delete next.bpmDetected;
      next.bpmSource = patch.bpmSource === 'tap' ? 'tap' : 'manual';
      bpmChanged = true;
    }
  }
  if ('tier' in patch) {
    if (patch.tier == null || patch.tier === 'auto') {
      next.tierManual = false;
      next.tier = tierForBpm(next.bpm);
    } else if (TIERS.includes(patch.tier)) {
      next.tier = patch.tier;
      next.tierManual = true;
    } else throw new MusicImportError('tier', 'Zona no válida.');
  } else if (bpmChanged && !next.tierManual) next.tier = tierForBpm(next.bpm);
  next.updatedAt = new Date().toISOString();
  try {
    await withTx([TRACKS_STORE], 'readwrite', (tx) => { tx.objectStore(TRACKS_STORE).put(next); });
  } catch (e) {
    throw isQuota(e) ? new MusicImportError('quota', 'No queda espacio para guardar el cambio.') : new MusicImportError('storage', 'No se ha podido guardar el cambio.');
  }
  notifyChange('update', id);
  return publicTrack(next);
}

/** Borra una pista importada (y sus rasgos); revoca su URL. */
export async function deleteUserTrack(id) {
  try {
    await withTx(STORES, 'readwrite', (tx) => {
      tx.objectStore(TRACKS_STORE).delete(id);
      tx.objectStore(FEATURES_STORE).delete(id);
    });
  } catch {
    return false;
  }
  revokeUserTrackUrl(id);
  blobs.delete(id);
  notifyChange('delete', id);
  return true;
}

/** Espacio: { usage, quota, available, tracksBytes, count, persisted } (null donde el navegador no informa). */
export async function storageEstimate() {
  const out = { usage: null, quota: null, available: null, tracksBytes: 0, count: 0, persisted: null };
  const st = globalThis.navigator?.storage;
  try {
    const e = await st?.estimate?.();
    if (e) {
      out.usage = Number.isFinite(e.usage) ? e.usage : null;
      out.quota = Number.isFinite(e.quota) ? e.quota : null;
      if (out.usage != null && out.quota != null) out.available = Math.max(0, out.quota - out.usage);
    }
  } catch { /* no disponible */ }
  try { out.persisted = (await st?.persisted?.()) ?? null; } catch { /* no disponible */ }
  try {
    const rows = await allRaw();
    out.count = rows.length;
    for (const r of rows) out.tracksBytes += r.size || r.blob?.size || r.buf?.byteLength || 0;
  } catch { /* sin base */ }
  return out;
}
