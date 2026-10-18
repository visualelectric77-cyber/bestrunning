#!/usr/bin/env node
// BestRunning · pruebas de la integración de la fase 2 (M5): estado/migración (store.js), service worker
// (audio con rangos, caché de música) y carga en Node de las pantallas que integran música/voz/Watch.
// Uso: node tools/test-music-integration.mjs   · sale con código ≠ 0 si algo falla.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
let passed = 0;
const ok = (cond, msg) => {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${msg}`); }
};
const section = (t) => console.log(`\n· ${t}`);

/* ───────────── localStorage simulado (antes de importar store.js) ───────────── */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  clear: () => mem.clear(),
};

// Estado guardado por un usuario de la fase 1 (sin música, sin pack, sesiones sin campos de pulso)
const v1 = {
  version: 1,
  onboarded: true,
  profile: { name: 'Nacho', age: 46, weightKg: 78, sex: 'm', hrMax: 176, hrRest: null },
  levels: { jog: 8.4, run: 10.2, fast: 11.6, sprint: 13.1 },
  audio: { voiceEnabled: true, voiceURI: 'com.apple.voice.premium.es-ES.Monica', rate: 1.05, pitch: 1, volume: 1, beeps: true, chattiness: 'coach', duckMusic: true, packId: null },
  integrations: { watchReminder: false, healthShortcut: 'Mi Salud' },
  history: [{ id: 'ses_1', title: 'Pirámide', startedAt: '2026-10-10T07:00:00.000Z', elapsedSec: 1200, hrAvg: 140, hrMax: 168 }],
};
mem.set('br.state.v1', JSON.stringify(v1));

const store = await import(pathToFileURL(join(ROOT, 'js/core/store.js')).href);

section('store.js · valores por defecto (§11.6, §13)');
{
  const d = store.defaultState();
  ok(d.version === 2 && store.STATE_VERSION === 2, 'version 2');
  ok(d.audio.packId === 'eva', 'audio.packId = eva');
  const m = d.music;
  ok(m && m.enabled === true && m.mode === 'app' && m.volume === 0.8 && m.effects === true && m.energy === 'normal'
    && m.useBuiltIn === true && m.useImported === true && Array.isArray(m.disabled) && m.disabled.length === 0, 'music por defecto según §11.6');
  ok(d.integrations.hrShortcut === 'BestRunning FC', 'integrations.hrShortcut = BestRunning FC');
  ok(d.integrations.healthShortcut === '', 'healthShortcut sigue vacío (Guardar en Salud opcional)');
  ok(store.defaultState() !== d && store.defaultState().music !== d.music, 'defaultState devuelve objetos nuevos');
}

section('store.js · migración de un usuario v1');
{
  const s = store.getState();
  ok(s.version === 2, 'versión migrada a 2');
  ok(s.audio.packId === 'eva', 'packId null → eva');
  ok(s.audio.voiceURI === v1.audio.voiceURI && s.audio.chattiness === 'coach' && s.audio.rate === 1.05, 'ajustes de voz del usuario intactos');
  ok(s.music && s.music.mode === 'app' && s.music.volume === 0.8 && Array.isArray(s.music.disabled), 'aparece state.music para usuarios antiguos');
  ok(s.integrations.watchReminder === false && s.integrations.healthShortcut === 'Mi Salud', 'integraciones del usuario intactas');
  ok(s.integrations.hrShortcut === 'BestRunning FC', 'hrShortcut por defecto añadido');
  ok(s.levels.fast === 11.6 && s.profile.name === 'Nacho', 'niveles y perfil intactos');
  const h = s.history[0];
  ok(h.hrAvg === 140 && h.hrMax === 168, 'pulso existente conservado');
  ok(h.hrMin === null && h.hrSeries === null && h.hrZones === null && h.music === null, 'sesión antigua con hrMin/hrSeries/hrZones/music = null');
}

section('store.js · un v2 guardado no se re-migra');
{
  const next = store.setState((d) => { d.audio.packId = null; d.music.volume = 0.35; d.music.disabled = ['a', 'a', 'b']; });
  ok(next.audio.packId === null, 'el usuario puede elegir voz del sistema');
  const saved = JSON.parse(mem.get('br.state.v1'));
  ok(saved.version === 2 && saved.music.volume === 0.35, 'se persiste con version 2');
  const re = store.migrateState(JSON.parse(JSON.stringify(saved)), saved.version);
  ok(re.audio.packId === null, 'packId null en v2 se respeta (no vuelve a eva)');
  ok(re.music.volume === 0.35, 'volumen guardado se respeta');
  ok(re.music.disabled.length === 2, 'disabled sin duplicados');
}

section('store.js · saneado de music');
{
  const bad = store.defaultState();
  bad.music = { enabled: 'sí', mode: 'spotify', volume: 7, effects: null, energy: 'turbo', useBuiltIn: 1, useImported: false, disabled: 'x' };
  const m = store.migrateState(bad, 2).music;
  ok(m.mode === 'app' && m.energy === 'normal', 'modo/energía inválidos → por defecto');
  ok(m.volume === 1, 'volumen recortado a 0..1');
  ok(m.enabled === true && m.effects === true && m.useBuiltIn === true && m.useImported === false, 'booleanos inválidos → por defecto (válidos se conservan)');
  ok(Array.isArray(m.disabled) && m.disabled.length === 0, 'disabled no array → []');
  const noMusic = store.defaultState();
  delete noMusic.music;
  ok(store.migrateState(noMusic, 2).music.mode === 'app', 'sin music → por defecto');
  const clash = store.defaultState();
  clash.integrations.healthShortcut = 'BestRunning FC';
  ok(store.migrateState(clash, 2).integrations.healthShortcut === '', 'el Atajo de pulso nunca se usa como «Guardar en Salud»');
  const custom = store.defaultState();
  custom.integrations = { watchReminder: true, healthShortcut: 'Salud BR', hrShortcut: '' };
  const ci = store.migrateState(custom, 2).integrations;
  ok(ci.healthShortcut === 'Salud BR' && ci.hrShortcut === 'BestRunning FC', 'hrShortcut vacío → por defecto, healthShortcut propio intacto');
  ok(store.normalizeSession({ id: 'x', music: { foo: 1 } }).music.tracks.length === 0, 'session.music sin tracks → tracks []');
  ok(store.normalizeSession({ id: 'x', music: { tracks: ['t1'] } }).music.tracks[0] === 't1', 'session.music.tracks se conserva');
}

section('store.js · importState de una copia v1');
{
  const backup = JSON.stringify({ app: 'BestRunning', exportedAt: '2026-10-01', ...v1, audio: { ...v1.audio, packId: null } });
  ok(store.importState(backup) === true, 'importa la copia');
  const s = store.getState();
  ok(s.audio.packId === 'eva' && s.music?.mode === 'app' && s.version === 2, 'la copia v1 se migra');
  ok(!('app' in s) && !('exportedAt' in s), 'sin metadatos de la copia');
  ok(store.importState('{"version":"x"}') === false, 'rechaza copias inválidas');
}

section('store.js · escena 3D (visuals, §14)');
{
  const d = store.defaultState();
  const v = d.visuals;
  ok(v && v.quality === 'auto' && v.tvMode === false && v.strideBob === true && v.ghost === true, 'visuals por defecto: auto · TV no · balanceo sí · fantasma sí');
  const old = store.defaultState();
  delete old.visuals;
  const mv = store.migrateState(old, 2).visuals;
  ok(mv && mv.quality === 'auto' && mv.ghost === true, 'usuario anterior sin visuals → valores por defecto');
  const bad = store.defaultState();
  bad.visuals = { quality: 'ultra', tvMode: 'sí', strideBob: 0, ghost: false };
  const sv = store.migrateState(bad, 2).visuals;
  ok(sv.quality === 'auto' && sv.tvMode === false && sv.strideBob === true && sv.ghost === false, 'visuals inválidos saneados (válidos se conservan)');
  const keep = store.defaultState();
  keep.visuals = { quality: 'eco', tvMode: true, strideBob: false, ghost: true };
  const kv = store.migrateState(keep, 2).visuals;
  ok(kv.quality === 'eco' && kv.tvMode === true && kv.strideBob === false, 'elecciones del usuario intactas');
  ok(['auto', 'high', 'eco', 'off'].every((q) => { const x = store.defaultState(); x.visuals.quality = q; return store.migrateState(x, 2).visuals.quality === q; }), 'las cuatro calidades son válidas');
}

section('music.js · getAnalyser() tras musicGain');
{
  // Web Audio y <audio> mínimos: solo lo que el grafo necesita para montarse
  class N { constructor() { this.outs = new Set(); } connect(n) { this.outs.add(n); return n; } disconnect() { this.outs.clear(); } }
  const P = (v) => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {}, exponentialRampToValueAtTime() {} });
  const analysers = [];
  const gains = [];
  const ctx = {
    state: 'running', currentTime: 1, sampleRate: 44100, destination: new N(), outputLatency: 0.01,
    resume: () => Promise.resolve(),
    createGain() { const n = new N(); n.gain = P(1); gains.push(n); return n; },
    createBiquadFilter() { const n = new N(); n.frequency = P(350); n.Q = P(1); n.gain = P(0); return n; },
    createDelay() { const n = new N(); n.delayTime = P(0); return n; },
    createDynamicsCompressor() { const n = new N(); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = P(0); return n; },
    createMediaElementSource() { return new N(); },
    createAnalyser() { const n = new N(); n.fftSize = 2048; n.smoothingTimeConstant = 0; analysers.push(n); return n; },
  };
  const fakeEl = () => ({
    preload: '', muted: false, paused: true, readyState: 4, currentTime: 0, playbackRate: 1, src: '',
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, removeEventListener() {}, load() {},
    play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; },
  });
  const hadDoc = 'document' in globalThis;
  const prevDoc = globalThis.document;
  globalThis.document = { createElement: () => fakeEl() };
  try {
    const { createMusicEngine } = await import(pathToFileURL(join(ROOT, 'js/audio/music.js')).href);
    const eng = createMusicEngine({ getAudioContext: () => ctx });
    ok(typeof eng.getAnalyser === 'function', 'el motor expone getAnalyser()');
    ok(eng.getAnalyser() === null, 'sin plan ni grafo → null');
    const track = { id: 't1', url: 'data:audio/mp4;base64,AAAA', bpm: 124, duration: 240, beatOffset: 0, barOffset: 0, bars: 120, energy: [], cues: { mixIn: 0, drops: [], outro: 200, hotBars: [] } };
    const plan = { cues: [{ segIndex: 0, atSec: 0, zone: 'jog', targetBpm: 124, trackId: 't1', offsetSec: 0, rate: 1, transition: 'start', leadSec: 0 }], totalSec: 600 };
    eng.load(plan, new Map([['t1', track]]))?.catch?.(() => {});
    const a = eng.getAnalyser();
    ok(a && a.fftSize === 1024 && a.smoothingTimeConstant === 0.8, 'AnalyserNode fftSize 1024 · suavizado 0,8');
    ok(eng.getAnalyser() === a && analysers.length === 1, 'siempre el mismo nodo (no se crean más)');
    // está enganchado en derivación: algún GainNode (musicGain) lo tiene entre sus salidas y el analizador no tiene salidas
    ok(a.outs.size === 0, 'el analizador no tiene salidas (no altera el sonido)');
    ok(gains.some((g) => g.outs.has(a) && g.outs.has(ctx.destination)), 'enganchado a musicGain (el volumen, lo último antes del destino)');
    ok(a.minDecibels === -97 && a.maxDecibels === -27, 'ventana de dB desplazada +3 dB (la salida sube ≈ 3 dB: la escena reacciona igual)');
    eng.setEnabled(false);
    ok(eng.getAnalyser() === null, 'música apagada → null');
    eng.setEnabled(true);
    ok(eng.getAnalyser() === a, 'al volver a encenderla, el mismo analizador');
    eng.destroy();
    ok(eng.getAnalyser() === null, 'tras destroy → null');
  } catch (err) {
    ok(false, `getAnalyser lanzó: ${err?.message || err}`);
  } finally {
    if (hadDoc) globalThis.document = prevDoc; else delete globalThis.document;
  }
}

/* ───────────── Service worker en una VM ───────────── */
section('sw.js · rutas de audio, rangos y caché');
{
  const caches = new Map(); // nombre → Map(url → { body: Buffer, headers })
  const net = { calls: [], fail: false };
  const FILE = Buffer.alloc(1000, 7);
  for (let i = 0; i < FILE.length; i++) FILE[i] = i % 256;
  const makeCache = (name) => {
    if (!caches.has(name)) caches.set(name, new Map());
    const m = caches.get(name);
    const keyOf = (r, ignoreSearch) => {
      const u = new URL(typeof r === 'string' ? r : r.url);
      u.hash = '';
      if (ignoreSearch) u.search = '';
      return u.href;
    };
    return {
      async match(r, opts = {}) {
        const k = keyOf(r, opts.ignoreSearch);
        for (const [url, v] of m) if ((opts.ignoreSearch ? keyOf(url, true) : url) === k) return new Response(v.body, { headers: v.headers });
        return undefined;
      },
      async put(r, res) {
        if (res.status !== 200) throw new TypeError('solo 200');
        const body = Buffer.from(await res.arrayBuffer());
        m.set(keyOf(r), { body, headers: Object.fromEntries(res.headers) });
      },
      async add() {},
      async keys() { return [...m.keys()]; },
    };
  };
  const cachesApi = {
    open: async (n) => makeCache(n),
    keys: async () => [...caches.keys()],
    delete: async (n) => caches.delete(n),
    match: async (r, o) => {
      for (const n of caches.keys()) { const hit = await makeCache(n).match(r, o); if (hit) return hit; }
      return undefined;
    },
  };
  const listeners = {};
  const ctx = {
    self: null,
    caches: cachesApi,
    Response, Request, Headers, Blob, URL, Promise, setTimeout, clearTimeout, Map, Set, Number, String, Math, Error, TypeError,
    fetch: async (req) => {
      const url = typeof req === 'string' ? req : req.url;
      net.calls.push({ url, range: typeof req === 'string' ? null : req.headers?.get?.('range') || null });
      if (net.fail) throw new TypeError('offline');
      return new Response(FILE, { status: 200, headers: { 'Content-Type': 'audio/mp4' } });
    },
  };
  ctx.self = {
    addEventListener: (t, fn) => { listeners[t] = fn; },
    registration: { scope: 'https://x.github.io/app/', navigationPreload: null },
    location: { origin: 'https://x.github.io' },
    clients: { claim: async () => {} },
    skipWaiting: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(ROOT, 'sw.js'), 'utf8'), ctx, { filename: 'sw.js' });
  ok(typeof listeners.fetch === 'function', 'registra el manejador fetch');

  const dispatch = async (path, headers = {}) => {
    const req = new Request(`https://x.github.io/app/${path}`, { headers });
    let responded = null;
    const waits = [];
    const ev = {
      request: req,
      respondWith: (p) => { responded = p; },
      waitUntil: (p) => { waits.push(p); },
      preloadResponse: Promise.resolve(null),
    };
    Object.defineProperty(req, 'mode', { value: 'cors' });
    listeners.fetch(ev);
    const res = responded ? await responded : null;
    return { res, waits };
  };

  // 1) Primera escucha con rango: red en streaming + copia completa en segundo plano
  let r = await dispatch('audio/music/song.m4a', { range: 'bytes=0-1' });
  ok(r.res && net.calls.some((c) => c.range === 'bytes=0-1'), 'rango sin caché → red');
  await Promise.all(r.waits);
  ok(caches.get('br-music')?.size === 1, 'la pista completa queda en br-music');
  ok(net.calls.some((c) => c.url.endsWith('song.m4a') && !c.range), 'descarga completa aparte');

  // 2) Ya en caché: rangos servidos sin red (206)
  net.calls.length = 0;
  net.fail = true;
  r = await dispatch('audio/music/song.m4a', { range: 'bytes=100-199' });
  ok(r.res.status === 206, 'rango desde caché → 206');
  ok(r.res.headers.get('Content-Range') === 'bytes 100-199/1000', 'Content-Range correcto');
  ok(r.res.headers.get('Content-Length') === '100', 'Content-Length del trozo');
  ok(r.res.headers.get('Accept-Ranges') === 'bytes', 'Accept-Ranges');
  ok(/audio\/mp4/.test(r.res.headers.get('Content-Type') || ''), 'Content-Type audio/mp4');
  const part = Buffer.from(await r.res.arrayBuffer());
  ok(part.length === 100 && part[0] === 100 && part[99] === 199, 'bytes exactos del rango');
  ok(net.calls.length === 0, 'sin red');

  r = await dispatch('audio/music/song.m4a', { range: 'bytes=900-' });
  ok(r.res.status === 206 && r.res.headers.get('Content-Range') === 'bytes 900-999/1000', 'rango abierto');
  r = await dispatch('audio/music/song.m4a', { range: 'bytes=-10' });
  ok(r.res.status === 206 && r.res.headers.get('Content-Range') === 'bytes 990-999/1000', 'rango sufijo');
  r = await dispatch('audio/music/song.m4a', { range: 'bytes=5000-' });
  ok(r.res.status === 416, 'rango imposible → 416');
  r = await dispatch('audio/music/song.m4a', { range: 'bytes=0-1, 5-9' });
  ok(r.res.status === 206 && r.res.headers.get('Content-Range') === 'bytes 0-1/1000', 'multirrango → primer tramo');
  r = await dispatch('audio/music/song.m4a');
  ok(r.res.status === 200 && Buffer.from(await r.res.arrayBuffer()).length === 1000, 'sin rango → copia completa');
  r = await dispatch('audio/music/song.m4a?v=2', { range: 'bytes=0-9' });
  ok(r.res.status === 206, 'ignora la query al buscar en caché');

  // 3) Packs de voz: mp3 a br-audio (sin rango), no a br-music
  net.fail = false;
  r = await dispatch('audio/packs/eva/up_1.mp3');
  await Promise.all(r.waits);
  ok(r.res.status === 200 && caches.get('br-audio')?.size === 1, 'clip de voz cacheado en br-audio');
  ok(caches.get('br-music').size === 1, 'br-music sin clips de voz');

  // 4) library.json: red primero y copia de respaldo
  net.calls.length = 0;
  r = await dispatch('audio/music/library.json');
  ok(r.res && net.calls.length === 1, 'library.json va a la red primero');

  // 5) Precache: nada de audio pesado
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const assets = sw.slice(sw.indexOf('/*ASSETS:START*/'), sw.indexOf('/*ASSETS:END*/'));
  ok(!/\.(m4a|mp3)'/.test(assets), 'ASSETS no precachea audio');
  ok(/MUSIC_CACHE = 'br-music'/.test(sw) && /AUDIO_CACHE = 'br-audio'/.test(sw), 'cachés br-music y br-audio');
}

/* ───────────── index.html ───────────── */
section('index.html');
{
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const order = ['tokens', 'base', 'components', 'screens-main', 'screens-more', 'player', 'music'].map((n) => html.indexOf(`./css/${n}.css`));
  ok(order.every((i) => i > 0) && order.every((v, i) => i === 0 || v > order[i - 1]), 'CSS en orden, music.css tras player.css');
  ok((html.match(/<script type="module"/g) || []).length === 1, 'un único script de módulo');
}

/* ───────────── Pantallas: se importan sin DOM y respetan contratos ───────────── */
section('pantallas · carga en Node');
{
  const player = await import(pathToFileURL(join(ROOT, 'js/screens/player.js')).href);
  const settings = await import(pathToFileURL(join(ROOT, 'js/screens/settings.js')).href);
  ok(typeof player.mount === 'function' && Object.keys(player).length === 1, 'player.js exporta solo mount');
  ok(typeof settings.mount === 'function' && Object.keys(settings).length === 1, 'settings.js exporta solo mount');
  const src = readFileSync(join(ROOT, 'js/screens/settings.js'), 'utf8');
  ok(/music:\s*\{\s*title:\s*'Música',\s*icon:\s*'music'/.test(src), 'sección Música con icono music');
  ok(src.includes("items: ['audio', 'music', 'watch']"), 'Música en la lista principal');
  ok(src.includes('accept="audio/*" multiple'), 'importar canciones: input audio/* múltiple');
  const psrc = readFileSync(join(ROOT, 'js/screens/player.js'), 'utf8');
  for (const fn of ['unlock', 'start', 'pause', 'resume', 'seek', 'update', 'stop', 'nowPlaying', 'beatPhase', 'setEnabled', 'setVolume', 'setEffects']) {
    ok(new RegExp(`mcall\\('${fn}'`).test(psrc), `el reproductor usa music.${fn}()`);
  }
  ok(/buildMusicPlan\(/.test(psrc) && /loadLibrary\(/.test(psrc), 'plan y biblioteca');
  ok(/session\.music = \{ tracks:/.test(psrc), 'session.music.tracks');
  // HYPERTRACK (§14, §14.1): escena opcional, API comprobada método a método, eventos y modo TV
  ok(/import\('\.\.\/player\/scene3d\.js'\)/.test(psrc), 'la escena 3D se carga en dinámico');
  ok(/isWebGLAvailable/.test(psrc) && /createScene3D\(/.test(psrc), 'comprueba WebGL y crea la escena');
  ok(/typeof scene\[fn\] !== 'function'/.test(psrc), 'métodos opcionales de la escena protegidos con typeof');
  for (const fn of ['setState', 'setBeat', 'setGhost', 'setAnalyser', 'setHudRects', 'setTvMode', 'resize']) {
    ok(new RegExp(`scall\\('${fn}'`).test(psrc), `el reproductor usa scene.${fn}()`);
  }
  for (const ev of ['segment', 'countdown', 'km', 'halfway', 'drop', 'pause', 'testStage', 'testEnd', 'adjust', 'finish']) {
    ok(psrc.includes(`'${ev}'`), `evento de escena '${ev}'`);
  }
  ok(/mcall\('getAnalyser'\)/.test(psrc), 'analizador del motor DJ → escena');
  ok(/visuals\.quality === 'off'/.test(psrc), "calidad 'off' ⇒ sin escena (fondo 2D)");
  ok(/webglcontextlost/.test(psrc), 'pérdida de contexto ⇒ fondo 2D');
  ok(src.includes("'display'") && src.includes("title: 'Pantalla de entreno'"), 'Ajustes: sección Pantalla de entreno');
  ok(src.includes("items: ['profile', 'speeds', 'week', 'treadmill', 'display']"), 'Pantalla de entreno en el grupo Entrenamiento');
  for (const id of ['st-vq', 'st-ghost', 'st-bob', 'st-tvmode']) ok(src.includes(`'${id}'`), `ajuste ${id}`);
  const msrc = readFileSync(join(ROOT, 'js/audio/music.js'), 'utf8');
  ok(/nowPlaying, beatPhase, getAnalyser,/.test(msrc), 'music.js devuelve getAnalyser en su API');
  // Hoja «Sonido» (mantener ♪): volumen de música y voz en vivo, guardado en los mismos ajustes que Perfil
  ok(/const SND_HOLD_MS = 450;/.test(psrc) && /function bindSoundHold\(/.test(psrc), 'mantener ♪ 450 ms abre «Sonido»');
  ok(/openSheet\(\{[\s\S]{0,80}cls: 'mu-snd'/.test(psrc), "la hoja usa openSheet({ cls: 'mu-snd' })");
  ok(/mcall\('setVolume', v\)/.test(psrc) && /coachCall\('updateSettings', \{ volume: v \}\)/.test(psrc), 'aplica al instante: music.setVolume y coach.updateSettings({ volume })');
  ok(/d\.music\.volume = /.test(psrc) && /d\.audio\.volume = /.test(psrc), 'guarda state.music.volume y state.audio.volume');
  ok(/act === 'music' && performance\.now\(\) - sndHeldAt < 1200/.test(psrc), 'soltar tras la pulsación larga no apaga la música');
  ok(/'touchend'[\s\S]{0,80}preventDefault/.test(psrc), 'iOS: sin clic sintético sobre el fondo de la hoja recién abierta');
  ok(/SND_HINT_KEY = 'br:snd-hint'/.test(psrc) && /SND_HINT_CLASSES = 2/.test(psrc) && /later\(maybeSoundHint, /.test(psrc), 'aviso de descubrimiento en las 2 primeras clases');
  ok(/\|\| snd\) return false;/.test(psrc), 'con la hoja abierta los controles se recogen');
  const csrc = readFileSync(join(ROOT, 'js/ui/components.js'), 'utf8');
  ok(/onClose = null, cls = '' \} = \{\}\)/.test(csrc), 'openSheet acepta cls');
  const musicCss = readFileSync(join(ROOT, 'css/music.css'), 'utf8');
  const sndCss = musicCss.slice(musicCss.indexOf('.sheet-backdrop.mu-snd'), musicCss.indexOf('/* Importar */'));
  ok(sndCss.length > 200 && /\.sheet\.mu-snd \{[^}]*backdrop-filter: none/.test(sndCss) && /\.sheet-backdrop\.mu-snd \{[^}]*backdrop-filter: none/.test(sndCss), '«Sonido» sin backdrop-filter (§15.3)');
  ok(/\.mu-snd__step \{[^}]*width: 52px;[^}]*height: 52px/.test(sndCss) && /\.mu-snd__bar \{[^}]*height: 52px/.test(sndCss), '«Sonido»: objetivos táctiles de 52 px');
  ok(/@media \(orientation: landscape\) and \(max-height: 620px\) \{\s*(\/\*[\s\S]*?\*\/\s*)?\.sheet\.mu-snd \{[^}]*right: max\(var\(--gutter\), var\(--safe-r\)\);[^}]*\* 0\.44/.test(sndCss),
    '«Sonido» en horizontal: la columna derecha del HUD (44 % del ancho útil, márgenes de zona segura): no tapa la cifra');
  const ssrc = readFileSync(join(ROOT, 'js/screens/settings.js'), 'utf8');
  ok(/mantén pulsado ♪/.test(ssrc), 'Perfil → Música explica el ajuste en plena clase');
  for (const f of ['js/screens/player.js', 'js/screens/settings.js', 'js/core/store.js', 'sw.js']) {
    const t = readFileSync(join(ROOT, f), 'utf8');
    ok(!/console\.log\(|\balert\(|\bconfirm\(/.test(t), `${f}: sin console.log/alert/confirm`);
    ok(!/export default/.test(t), `${f}: sin export default`);
  }
}

console.log(`\n${failed ? '✗' : '✓'} ${passed} comprobaciones OK${failed ? `, ${failed} fallos` : ''}`);
process.exit(failed ? 1 : 0);
