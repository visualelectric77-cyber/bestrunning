// BestRunning · música que sonó en una sesión (Resumen, Historial y Progreso).
// Solo DOM/HTML: lee session.music.tracks (ids o { id, title, artist, bpm, tier }) y completa los títulos
// desde la biblioteca integrada (audio/music/library.json) y, si existe, la base de canciones importadas
// (IndexedDB «br-music», solo lectura). Los estilos .whr-track* los aporta watch-hr.js (ensureWatchHrStyles).
import { icon } from '../ui/components.js';
import { esc, capitalize } from '../core/utils.js';

export const TIER_COLORS = { calm: '#64D2FF', jog: '#30D158', run: '#FFD60A', fast: '#FF9F0A', sprint: '#FF375F' };
const musicMeta = new Map();
let musicPromise = null;

/** Lista única de temas de una sesión (en orden de reproducción). */
export function sessionMusicItems(ses) {
  const raw = Array.isArray(ses?.music?.tracks) ? ses.music.tracks : Array.isArray(ses?.music) ? ses.music : [];
  const seen = new Set();
  const out = [];
  for (const x of raw) {
    const it = typeof x === 'string' ? { id: x }
      : x && typeof x === 'object' ? { id: x.id || x.trackId || '', title: x.title, artist: x.artist, bpm: x.bpm, tier: x.tier } : null;
    if (!it || (!it.id && !it.title)) continue;
    const key = it.id || it.title;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

const prettyId = (id) => capitalize(String(id || '').replace(/^u_/, '').replace(/[-_]+/g, ' ').trim()) || 'Canción';

/** Datos conocidos de un tema (lo guardado en la sesión manda sobre la biblioteca). */
export function trackInfo(it) {
  const m = { ...(musicMeta.get(it?.id) || {}), ...Object.fromEntries(Object.entries(it || {}).filter(([, v]) => v != null && v !== '')) };
  const user = String(it?.id || '').startsWith('u_');
  return { ...m, title: m.title || (user ? 'Canción importada' : prettyId(it?.id)) };
}

export function musicRowsHtml(items) {
  return items.map((it, i) => {
    const m = trackInfo(it);
    const sub = [m.artist, Number(m.bpm) > 0 ? `${Math.round(Number(m.bpm))} BPM` : ''].filter(Boolean).join(' · ');
    return `<div class="whr-track" style="--tc:${TIER_COLORS[m.tier] || 'var(--accent)'};--i:${i}">
      <span class="whr-track__n num">${i + 1}</span>
      <span class="whr-track__txt"><b>${esc(m.title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      <span class="whr-track__dot" aria-hidden="true"></span>
    </div>`;
  }).join('');
}

const countLabel = (n) => `${n} ${n === 1 ? 'tema' : 'temas'}`;

/**
 * Tarjeta «música de la sesión». variant 'summary' usa las clases del resumen (sm-card) y el título
 * «Sonó en tu sesión»; 'history' (por defecto) las del historial.
 */
export function sessionMusicHtml(ses, { variant = 'history', index = null } = {}) {
  const items = sessionMusicItems(ses);
  if (!items.length) return '';
  const style = index != null ? ` style="--i:${Number(index) || 0}"` : '';
  if (variant === 'summary') {
    return `<section class="card sm-card sm-music"${style}>
      <div class="sm-card__head"><span class="sm-card__title">Sonó en tu sesión</span><span class="sm-opt">${countLabel(items.length)}</span></div>
      <div class="whr-tracks" data-music>${musicRowsHtml(items)}</div>
    </section>`;
  }
  return `<section class="card hs-card"${style}>
    <div class="hs-card__head"><div class="eyebrow">Música</div><span class="hs-legend">${icon('music', 14)}${countLabel(items.length)}</span></div>
    <div class="whr-tracks" data-music>${musicRowsHtml(items)}</div>
  </section>`;
}

/** Completa títulos/artistas que falten y repinta la lista [data-music] dentro de root. */
export function hydrateSessionMusic(root, ses, isAlive = () => true) {
  const items = sessionMusicItems(ses);
  if (!items.length || !items.some((it) => it.id && !musicMeta.has(it.id) && !it.title)) return Promise.resolve(false);
  return loadMusicMeta(items.map((it) => it.id).filter(Boolean)).then(() => {
    const host = isAlive() ? root?.querySelector?.('[data-music]') : null;
    if (host) host.innerHTML = musicRowsHtml(items);
    return !!host;
  }).catch(() => false);
}

/** Títulos de la biblioteca integrada y, si existe, de las canciones importadas (IndexedDB br-music). */
export function loadMusicMeta(ids = []) {
  if (!musicPromise) {
    musicPromise = (async () => {
      try {
        const res = await fetch('./audio/music/library.json', { cache: 'force-cache' });
        const lib = res.ok ? await res.json() : null;
        for (const t of (Array.isArray(lib?.tracks) ? lib.tracks : [])) {
          if (t?.id) musicMeta.set(t.id, { title: t.title, artist: t.artist, bpm: t.bpm, tier: t.tier });
        }
      } catch { /* sin biblioteca */ }
    })();
  }
  return musicPromise.then(() => loadUserTrackMeta(ids.filter((x) => String(x).startsWith('u_') && !musicMeta.has(x))));
}

async function loadUserTrackMeta(ids) {
  if (!ids.length || typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return;
  try {
    // Solo se abre si ya existe: nunca crear ni actualizar la base de otro módulo
    const dbs = await indexedDB.databases();
    if (!dbs.some((d) => d && d.name === 'br-music')) return;
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('br-music');
      req.onupgradeneeded = () => { try { req.transaction.abort(); } catch { /* nada */ } };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
    db.onversionchange = () => db.close();
    try {
      if (!db.objectStoreNames.contains('tracks')) return;
      const store = db.transaction('tracks', 'readonly').objectStore('tracks');
      await Promise.all(ids.map((id) => new Promise((resolve) => {
        const r = store.get(id);
        r.onsuccess = () => {
          const t = r.result;
          if (t) musicMeta.set(id, { title: t.title, artist: t.artist, bpm: t.bpm, tier: t.tier });
          resolve();
        };
        r.onerror = () => resolve();
      })));
    } finally {
      db.close();
    }
  } catch { /* sin datos de canciones importadas */ }
}

/** Los temas que más han sonado en el historial: [{ id, n, ...info }] (máx. `limit`). */
export function topTracks(history, limit = 3) {
  const count = new Map();
  for (const s of Array.isArray(history) ? history : []) {
    for (const it of sessionMusicItems(s)) {
      const key = it.id || it.title;
      const cur = count.get(key) || { it, n: 0 };
      cur.n += 1;
      count.set(key, cur);
    }
  }
  return [...count.values()].sort((a, b) => b.n - a.n).slice(0, limit).map(({ it, n }) => ({ ...it, n }));
}
