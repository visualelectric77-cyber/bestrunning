// RITMUP · Laboratorio «Clase con vídeo de YouTube» (beta): enlaces y «últimos usados». Puro (sin DOM): lo prueba
// tools/test-youtube.mjs. Solo lo carga el reproductor con localStorage 'ritmup.lab.youtube' === 'on'.
//
// Acepta: youtube.com/watch?v=… · youtu.be/… · /shorts/… · /live/… · /embed/… · m.youtube.com · music.youtube.com
// y listas: /playlist?list=… · watch?v=X&list=…(&index=N) · music.youtube.com/playlist?list=…

export const LAB_KEY = 'ritmup.lab.youtube';
export const RECENT_KEY = 'ritmup.yt.recent';
export const MAX_RECENT = 5;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
// PL… (34), UU…/OL…/RD…: 10–64 caracteres. Quedan fuera WL/LL (Ver más tarde, Me gusta: privadas, no se incrustan).
const LIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
const HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'youtu.be']);
const VIDEO_PATHS = new Set(['shorts', 'live', 'embed', 'v', 'e']);
// el primer enlace de YouTube dentro de un texto compartido («Mira esto: https://youtu.be/…»)
// (empieza en «http(s)://» o en un borde de palabra: ni «notyoutube.com», ni «ftp://…», ni «javascript:…//youtube.com»)
const LINK_RE = /(?:(?<![\w.+-])https?:\/\/|(?<![\w.\/:@+=?&%-]))(?:[a-z0-9-]+\.)*(?:youtube(?:-nocookie)?\.com|youtu\.be)(?:\/[^\s<>"']*)?/i;

/** ¿Está activo el interruptor del laboratorio? (Perfil › Pantalla de entreno › Laboratorio) */
export function isLabOn(store = defaultStore()) {
  try { return store?.getItem(LAB_KEY) === 'on'; } catch { return false; }
}

/** «1h2m3s» · «90s» · «90» → segundos (0 si no se entiende). */
export function parseStart(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return 0;
  if (/^\d+s?$/.test(s)) return Math.min(86400, parseInt(s, 10));
  const m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || !(m[1] || m[2] || m[3])) return 0;
  return Math.min(86400, (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0));
}

/**
 * Lee un enlace de YouTube. Devuelve null si no es un vídeo ni una lista que se pueda incrustar, o:
 * { kind: 'video' | 'playlist', videoId: string|null, list: string|null, index: number (0 = primero; la URL cuenta
 *   desde 1), start: s (solo vídeos sueltos), music: bool (music.youtube.com) }
 */
export function parseYouTubeUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw || raw.length > 2048) return null;
  const found = raw.match(LINK_RE);
  if (!found) return null;
  let s = found[0];
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!HOSTS.has(host)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  let videoId = null;
  let isListPage = false;
  if (host === 'youtu.be') {
    videoId = parts[0] || null;
  } else if (parts[0] === 'watch') {
    videoId = u.searchParams.get('v');
  } else if (VIDEO_PATHS.has(parts[0])) {
    videoId = parts[1] || null;
  } else if (parts[0] === 'playlist') {
    isListPage = true;
  } else {
    return null; // canales, búsquedas, la portada…
  }
  if (videoId === 'videoseries' || (videoId != null && !VIDEO_ID.test(videoId))) videoId = null; // /embed/videoseries?list=…
  const listRaw = u.searchParams.get('list');
  const list = listRaw && LIST_ID.test(listRaw) ? listRaw : null;
  if (isListPage && !list) return null;
  if (!videoId && !list) return null;
  const n = Number(u.searchParams.get('index'));
  const index = list && Number.isInteger(n) && n >= 1 && n <= 5000 ? n - 1 : 0;
  const start = list ? 0 : parseStart(u.searchParams.get('t') || u.searchParams.get('start'));
  return { kind: list ? 'playlist' : 'video', videoId, list, index, start, music: host === 'music.youtube.com' };
}

/** Clave estable de un vídeo o una lista (para no repetirlos en «últimos usados»). */
export function ytKey(item) {
  return `${item?.list || ''}:${item?.videoId || ''}`;
}

export function defaultTitle(item) {
  return item?.kind === 'playlist' ? 'Lista de YouTube' : 'Vídeo de YouTube';
}

/** Enlace normal de YouTube del elemento (para enseñarlo o volver a leerlo). */
export function watchUrl(item) {
  if (!item) return '';
  if (item.list && !item.videoId) return `https://www.youtube.com/playlist?list=${item.list}${item.index > 0 ? `&index=${item.index + 1}` : ''}`;
  const q = [`v=${item.videoId}`];
  if (item.list) q.push(`list=${item.list}`);
  if (item.list && item.index > 0) q.push(`index=${item.index + 1}`);
  if (!item.list && item.start > 0) q.push(`t=${item.start}s`);
  return `https://www.youtube.com/watch?${q.join('&')}`;
}

/** Miniatura del vídeo (ytimg.com; solo una imagen, sin vídeo). null para una lista sin vídeo concreto. */
export function thumbUrl(item) {
  return item?.videoId ? `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg` : null;
}

function clean(x) {
  if (!x || typeof x !== 'object') return null;
  const p = parseYouTubeUrl(watchUrl({
    videoId: VIDEO_ID.test(x.videoId || '') ? x.videoId : null,
    list: LIST_ID.test(x.list || '') ? x.list : null,
    index: Number.isInteger(x.index) ? x.index : 0,
    start: Number(x.start) || 0,
  }));
  if (!p) return null;
  p.music = !!x.music;
  const t = typeof x.title === 'string' ? x.title.trim().slice(0, 160) : '';
  p.title = t || defaultTitle(p);
  p.at = Number(x.at) || 0;
  return p;
}

/** Los 5 últimos vídeos o listas usados en una clase (más reciente primero). Nunca lanza. */
export function loadRecent(store = defaultStore()) {
  try {
    const arr = JSON.parse(store?.getItem(RECENT_KEY) || '[]');
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    const out = [];
    for (const x of arr) {
      const c = clean(x);
      if (!c || seen.has(ytKey(c))) continue;
      seen.add(ytKey(c));
      out.push(c);
      if (out.length >= MAX_RECENT) break;
    }
    return out;
  } catch { return []; }
}

function saveList(list, store) {
  try {
    store?.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT).map((x) => ({
      kind: x.kind, videoId: x.videoId, list: x.list, index: x.index, start: x.start, music: !!x.music, title: x.title, at: x.at,
    }))));
    return true;
  } catch { return false; }
}

/** Lo pone el primero de «últimos usados» (sin duplicados, máximo 5). Conserva el título conocido si no llega otro. */
export function rememberRecent(item, { title = '', now = Date.now() } = {}, store = defaultStore()) {
  const c = clean({ ...item, title });
  if (!c) return loadRecent(store);
  const prev = loadRecent(store);
  const old = prev.find((x) => ytKey(x) === ytKey(c));
  if (!String(title || '').trim() && old) c.title = old.title;
  c.at = now;
  const list = [c, ...prev.filter((x) => ytKey(x) !== ytKey(c))].slice(0, MAX_RECENT);
  saveList(list, store);
  return list;
}

/** Título que da el reproductor (vídeo) para un elemento ya guardado. Una lista conserva «Lista de YouTube». */
export function setRecentTitle(item, title, store = defaultStore()) {
  const t = String(title || '').trim().slice(0, 160);
  if (!t || item?.kind === 'playlist') return false;
  const list = loadRecent(store);
  const hit = list.find((x) => ytKey(x) === ytKey(item));
  if (!hit || hit.title === t) return false;
  hit.title = t;
  return saveList(list, store);
}

function defaultStore() {
  try { return globalThis.localStorage || null; } catch { return null; }
}
