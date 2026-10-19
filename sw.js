// BestRunning · service worker: precache del shell (cache-first), audio en tiempo de ejecución y modo offline.
// VERSION, BUILD y ASSETS los reescribe tools/precache.mjs. El audio nunca va en el precache: música (br-music) y
// packs de voz (br-audio) se guardan al usarlos o con «Descargar música para usar sin conexión», y se sirven con
// soporte de rangos (206), que es lo que pide <audio> en Safari.
const VERSION = '1.4.5';
const BUILD = '40eee20e36';
const SHELL_CACHE = `br-shell-${VERSION}-${BUILD}`;
const AUDIO_CACHE = 'br-audio';
const MUSIC_CACHE = 'br-music';
const MEDIA_RE = /\.(m4a|mp4|aac|mp3|wav|ogg|oga|opus|flac|webm)$/i;
const JSON_TIMEOUT_MS = 4000;
const NAV_TIMEOUT_MS = 2500;    // navegaciones que no son el shell: con red lenta, a los 2,5 s la copia guardada
const META_CACHE = 'br-meta';   // última versión vista de index.json / library.json (para invalidar audio cambiado)

const ASSETS = /*ASSETS:START*/[
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/components.css',
  './css/motion.css',
  './css/music.css',
  './css/player.css',
  './css/screens-main.css',
  './css/screens-more.css',
  './css/tokens.css',
  './js/app.js',
  './js/audio/audio-engine.js',
  './js/audio/coach.js',
  './js/audio/music-analysis.js',
  './js/audio/music-buffers.js',
  './js/audio/music-import.js',
  './js/audio/music-library.js',
  './js/audio/music-plan.js',
  './js/audio/music-worker.js',
  './js/audio/music.js',
  './js/audio/phrases.js',
  './js/audio/speech.js',
  './js/audio/voice-pack.js',
  './js/core/haptics.js',
  './js/core/router.js',
  './js/core/store.js',
  './js/core/utils.js',
  './js/integrations/health.js',
  './js/integrations/ics.js',
  './js/integrations/native-bridge.js',
  './js/integrations/session-music.js',
  './js/integrations/share-card.js',
  './js/integrations/watch-hr.js',
  './js/player/engine.js',
  './js/player/media-session.js',
  './js/player/motion.js',
  './js/player/music-debug.js',
  './js/player/scene3d.js',
  './js/player/scene3d/audio.js',
  './js/player/scene3d/director.js',
  './js/player/scene3d/ghosttrace.js',
  './js/player/scene3d/layout.js',
  './js/player/scene3d/pacelights/index.js',
  './js/player/scene3d/pacelights/lights.js',
  './js/player/scene3d/pacelights/path.js',
  './js/player/scene3d/postfx.js',
  './js/player/scene3d/rig.js',
  './js/player/scene3d/shaders.js',
  './js/player/scene3d/text.js',
  './js/player/scene3d/textures.js',
  './js/player/scene3d/themes/aurora.js',
  './js/player/scene3d/themes/aurora/common.js',
  './js/player/scene3d/themes/aurora/ground.js',
  './js/player/scene3d/themes/aurora/ribbons.js',
  './js/player/scene3d/themes/aurora/river.js',
  './js/player/scene3d/themes/aurora/sky.js',
  './js/player/scene3d/themes/aurora/tags.js',
  './js/player/scene3d/themes/blank.js',
  './js/player/scene3d/themes/cordillera.js',
  './js/player/scene3d/themes/cordillera/glsl.js',
  './js/player/scene3d/themes/cordillera/profile.js',
  './js/player/scene3d/themes/cordillera/tags.js',
  './js/player/scene3d/themes/cordillera/terrain.js',
  './js/player/scene3d/themes/estadio.js',
  './js/player/scene3d/themes/estadio/graphics.js',
  './js/player/scene3d/themes/estadio/shaders.js',
  './js/player/scene3d/themes/estadio/stadium.js',
  './js/player/scene3d/themes/estadio/track.js',
  './js/player/scene3d/themes/index.js',
  './js/player/scene3d/themes/legacy.js',
  './js/player/scene3d/themes/legacy/gates.js',
  './js/player/scene3d/themes/legacy/ghost.js',
  './js/player/scene3d/themes/legacy/moods.js',
  './js/player/scene3d/themes/legacy/particles.js',
  './js/player/scene3d/themes/legacy/sky.js',
  './js/player/scene3d/themes/legacy/skyline.js',
  './js/player/scene3d/themes/legacy/track.js',
  './js/player/scene3d/timeline.js',
  './js/player/scene3d/util.js',
  './js/player/wakelock.js',
  './js/screens/history.js',
  './js/screens/library.js',
  './js/screens/onboarding.js',
  './js/screens/plan.js',
  './js/screens/player.js',
  './js/screens/progress.js',
  './js/screens/settings.js',
  './js/screens/summary.js',
  './js/screens/today.js',
  './js/screens/workout.js',
  './js/training/achievements.js',
  './js/training/generator.js',
  './js/training/levels.js',
  './js/training/planner.js',
  './js/training/progression.js',
  './js/training/season.js',
  './js/training/stats.js',
  './js/training/templates-extra.js',
  './js/training/templates.js',
  './js/ui/charts.js',
  './js/ui/components.js',
  './js/vendor/three/build/three.module.min.js',
  './js/vendor/three/examples/jsm/postprocessing/EffectComposer.js',
  './js/vendor/three/examples/jsm/postprocessing/MaskPass.js',
  './js/vendor/three/examples/jsm/postprocessing/OutputPass.js',
  './js/vendor/three/examples/jsm/postprocessing/Pass.js',
  './js/vendor/three/examples/jsm/postprocessing/RenderPass.js',
  './js/vendor/three/examples/jsm/postprocessing/ShaderPass.js',
  './js/vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js',
  './js/vendor/three/examples/jsm/shaders/CopyShader.js',
  './js/vendor/three/examples/jsm/shaders/LuminosityHighPassShader.js',
  './js/vendor/three/examples/jsm/shaders/OutputShader.js',
  './js/vendor/three/LICENSE',
  './js/version.js',
  './assets/icons/favicon-32.png',
  './assets/icons/icon-152.png',
  './assets/icons/icon-167.png',
  './assets/icons/icon-180.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512-maskable.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon.svg',
  './assets/scenes/aurora-poster.jpg',
  './assets/scenes/aurora.jpg',
  './assets/scenes/blank-poster.jpg',
  './assets/scenes/blank.jpg',
  './assets/scenes/cordillera-poster.jpg',
  './assets/scenes/cordillera.jpg',
  './assets/scenes/estadio-poster.jpg',
  './assets/scenes/estadio.jpg',
  './audio/manifest.json',
  './audio/music/library.json',
  './audio/packs/eva/index.json',
  './audio/packs/packs.json'
]/*ASSETS:END*/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Uno a uno: si falta algún archivo no se cae toda la instalación.
      Promise.all(
        ASSETS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => null),
        ),
      ),
    ),
  );
  // Sin skipWaiting aquí: la página lo pide con postMessage({ type: 'SKIP_WAITING' }).
});

/**
 * Voz grabada sin conexión desde el primer día: al abrir la app, descarga en segundo plano los clips del pack
 * (≈ 3 MB) que aún no estén en br-audio. Si falla (sin red, iOS corta el trabajo), se cachean al usarlos.
 * Se lanza desde un fetch (waitUntil) y no desde 'activate', que retendría las peticiones hasta acabar.
 */
let warming = null;
function warmOnce() {
  if (!warming) warming = warmVoicePacks().catch(() => { warming = null; });
  return warming;
}

async function warmVoicePacks() {
  const shell = await caches.open(SHELL_CACHE);
  const audio = await caches.open(AUDIO_CACHE);
  const packs = ASSETS.filter((u) => /^\.\/audio\/packs\/[^/]+\/index\.json$/.test(u));
  for (const idxUrl of packs) {
    const res = (await shell.match(idxUrl)) || (await caches.match(idxUrl));
    if (!res) continue;
    let ids = [];
    try { ids = (await res.clone().json())?.clips || []; } catch { ids = []; }
    const base = new URL(idxUrl, self.registration.scope);
    const urls = ids.filter((id) => typeof id === 'string' && /^[\w-]+$/.test(id)).map((id) => new URL(`${id}.mp3`, base).href);
    let next = 0;
    const worker = async () => {
      while (next < urls.length) {
        const url = urls[next++];
        try {
          if (await audio.match(url, { ignoreVary: true })) continue;
          const r = await fetch(url);
          if (r && r.ok && r.status === 200 && r.type !== 'opaque') await audio.put(url, r);
        } catch { /* sin red: se cacheará al usarlo */ }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('br-shell-') && k !== SHELL_CACHE)
          .map((k) => caches.delete(k)),
      );
      // El shell se sirve desde la caché (abre al instante con mala cobertura): la precarga de navegación sobra
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.disable();
        } catch {
          /* no soportado */
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

const scopePath = new URL(self.registration.scope).pathname;

function relPath(url) {
  const p = url.pathname;
  return p.startsWith(scopePath) ? p.slice(scopePath.length) : p.replace(/^\//, '');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navegaciones: el shell (index.html) desde la caché versionada; el resto, red con tiempo límite.
  if (req.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    event.waitUntil(new Promise((r) => setTimeout(r, 4000)).then(warmOnce));
    return;
  }

  const path = relPath(url);

  // Música DJ: library.json red primero (puede regenerarse); pistas cache-first con rangos.
  if (path.startsWith('audio/music/')) {
    if (path.endsWith('.json')) {
      event.respondWith(networkFirst(req, SHELL_CACHE, event));
      return;
    }
    if (MEDIA_RE.test(path)) {
      respondMedia(event, MUSIC_CACHE);
      return;
    }
  }

  // Packs de voz: index/packs.json red primero; mp3 cache-first (también con rangos).
  if (path.startsWith('audio/packs/')) {
    if (path.endsWith('.json')) event.respondWith(networkFirst(req, AUDIO_CACHE, event));
    else respondMedia(event, AUDIO_CACHE);
    return;
  }

  // Shell y demás recursos propios: cache-first (se renuevan al cambiar de versión).
  event.respondWith(cacheFirst(req, SHELL_CACHE));
});

const OFFLINE_HTML = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>BestRunning</title><body style="background:#08080a;color:#f5f5f7;font-family:-apple-system,system-ui;display:grid;place-items:center;height:100vh;margin:0;padding:24px;box-sizing:border-box;text-align:center"><p>Sin conexión. Abre BestRunning cuando tengas red una vez para usarla offline.</p></body>';

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function cachedShell() {
  const cache = await caches.open(SHELL_CACHE);
  return (await cache.match('./index.html')) || (await cache.match('./')) || (await caches.match('./index.html')) || null;
}

async function handleNavigation(event) {
  const path = relPath(new URL(event.request.url));
  // El shell va versionado con BUILD (y reg.update() busca versiones nuevas al volver a la app): cache-first,
  // así arranca al instante aunque en el gimnasio no haya cobertura y nunca muestra una página de error de Pages.
  if (path === '' || path === 'index.html') {
    const hit = await cachedShell();
    if (hit) return hit;
  }
  try {
    const res = await Promise.race([fetch(event.request), timeout(NAV_TIMEOUT_MS)]);
    if (res && res.ok) return res;
    throw new Error('respuesta no válida');
  } catch {
    return (await cachedShell()) || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type !== 'opaque') cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const any = await caches.match(req, { ignoreVary: true });
    if (any) return any;
    throw err;
  }
}

async function networkFirst(req, cacheName, event = null) {
  const cache = await caches.open(cacheName);
  try {
    // Con red lenta no se bloquea el arranque: tras unos segundos, la copia guardada
    const res = await Promise.race([
      fetch(req, { cache: 'no-cache' }),
      timeout(JSON_TIMEOUT_MS),
    ]);
    if (res && res.ok) {
      cache.put(req, res.clone()).catch(() => {});
      // índices de audio: si cambian, se renuevan los clips/pistas afectados (mismo nombre, contenido nuevo)
      const work = invalidateMedia(req.url, res.clone()).catch(() => {});
      if (event) event.waitUntil(work);
    }
    return res;
  } catch (err) {
    const hit = (await cache.match(req)) || (await caches.match(req, { ignoreVary: true }));
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch {
      throw err;
    }
  }
}

/* ───── Audio: renovación cuando cambian index.json / library.json ───── */

// Campos de una pista que delatan un archivo de audio distinto (BPM, ganancia… no obligan a volver a descargarla)
const TRACK_AUDIO_FIELDS = ['file', 'sizeBytes', 'duration', 'hash', 'sha256', 'version'];
const sameAudio = (a, b) => TRACK_AUDIO_FIELDS.every((k) => JSON.stringify(a?.[k] ?? null) === JSON.stringify(b?.[k] ?? null));

/**
 * Compara el índice recién descargado con la última versión vista (br-meta). Packs de voz: si el índice cambia,
 * los clips guardados se vuelven a descargar (≈ 3 MB; se sustituyen al llegar, así nunca se queda sin voz).
 * Música: solo las pistas cuyo audio cambió (archivo, tamaño o duración distintos en library.json).
 */
async function invalidateMedia(url, res) {
  const path = relPath(new URL(url));
  const isPack = /^audio\/packs\/[^/]+\/index\.json$/.test(path);
  const isLib = path === 'audio/music/library.json';
  if (!isPack && !isLib) return;
  const text = await res.text();
  const meta = await caches.open(META_CACHE);
  const key = new URL(path, self.registration.scope).href;
  const prev = await meta.match(key);
  const prevText = prev ? await prev.text() : null;
  if (prevText === text) return;
  await meta.put(key, new Response(text, { headers: { 'Content-Type': 'application/json' } }));
  if (prevText == null) return; // primera vez: nada que comparar
  let next = null;
  let old = null;
  try { next = JSON.parse(text); old = JSON.parse(prevText); } catch { return; }
  const stale = [];
  const base = new URL(path, self.registration.scope);
  if (isPack) {
    const ids = Array.isArray(next?.clips) ? next.clips : [];
    for (const id of ids) if (typeof id === 'string' && /^[\w-]+$/.test(id)) stale.push(new URL(`${id}.mp3`, base).href);
  } else {
    const byId = new Map((Array.isArray(old?.tracks) ? old.tracks : []).map((t) => [t?.id, t]));
    for (const t of Array.isArray(next?.tracks) ? next.tracks : []) {
      const o = byId.get(t?.id);
      if (!o || sameAudio(o, t)) continue;
      const file = String(o.file || `audio/music/${o.id}.m4a`);
      stale.push(new URL(file, self.registration.scope).href);
    }
  }
  if (!stale.length) return;
  const cache = await caches.open(isPack ? AUDIO_CACHE : MUSIC_CACHE);
  let next_ = 0;
  const worker = async () => {
    while (next_ < stale.length) {
      const u = stale[next_++];
      try {
        const had = await cache.match(u, { ignoreSearch: true, ignoreVary: true });
        if (!had) continue; // nunca se guardó: se descargará al usarlo
        const r = await fetch(u, { cache: 'no-cache' });
        if (r && r.ok && r.status === 200 && r.type !== 'opaque') {
          await cache.delete(u, { ignoreSearch: true, ignoreVary: true });
          await cache.put(u, r);
        }
      } catch { /* sin red: se queda la copia anterior hasta la próxima vez */ }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

/* ───── Audio: cache-first con respuestas parciales (Range → 206) ───── */

const inflight = new Map();

function mediaType(path, res) {
  const t = res?.headers?.get('Content-Type');
  if (t && !/octet-stream/i.test(t)) return t;
  if (/\.(m4a|mp4|aac)$/i.test(path)) return 'audio/mp4';
  if (/\.mp3$/i.test(path)) return 'audio/mpeg';
  if (/\.wav$/i.test(path)) return 'audio/wav';
  return t || 'application/octet-stream';
}

function respondMedia(event, cacheName) {
  // waitUntil síncrono: la descarga completa en segundo plano puede seguir tras responder
  let release = () => {};
  event.waitUntil(new Promise((resolve) => { release = resolve; }));
  event.respondWith(mediaResponse(event.request, cacheName, release).catch((err) => {
    release();
    throw err;
  }));
}

async function mediaResponse(req, cacheName, release) {
  const key = req.url.split('#')[0];
  const path = relPath(new URL(key));
  const range = req.headers.get('range');
  const cache = await caches.open(cacheName);
  // Coincidencia exacta (con su ?v= si lo hubiera); sin la query solo como respaldo sin conexión, más abajo
  const hit = await cache.match(key, { ignoreVary: true });
  if (hit) {
    release();
    return range ? rangeResponse(hit, range, path) : hit;
  }
  if (range) {
    // Primera escucha: se sirve en streaming desde la red y se guarda la pista entera aparte
    cacheWhole(key, cache).catch(() => {}).finally(release);
    try {
      return await fetch(req);
    } catch (err) {
      const any = await caches.match(key, { ignoreSearch: true, ignoreVary: true });
      if (any) return rangeResponse(any, range, path);
      throw err;
    }
  }
  try {
    const res = await fetch(req);
    if (res && res.ok && res.status === 200 && res.type !== 'opaque') await cache.put(key, res.clone()).catch(() => {});
    release();
    return res;
  } catch (err) {
    release();
    const any = await caches.match(key, { ignoreSearch: true, ignoreVary: true });
    if (any) return any;
    throw err;
  }
}

function cacheWhole(url, cache) {
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    if (await cache.match(url, { ignoreVary: true })) return;
    const res = await fetch(url);
    if (res && res.ok && res.status === 200 && res.type !== 'opaque') await cache.put(url, res);
  })().finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

/** Construye una respuesta 206 a partir de la copia completa guardada (primer rango de la cabecera). */
async function rangeResponse(res, header, path) {
  const type = mediaType(path, res);
  const blob = await res.blob();
  const size = blob.size;
  const first = String(header || '').split(',')[0].trim();
  const m = /^bytes=(\d*)-(\d*)$/i.exec(first);
  if (!m || (m[1] === '' && m[2] === '')) {
    return new Response(blob, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
  }
  let start;
  let end;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!(start >= 0) || start >= size || end < start) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1, type), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  });
}
