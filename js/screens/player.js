// BestRunning · reproductor (#/play/:id y #/play/resume). La joya de la app.
// El DOM "en marcha" se construye una vez; cada tick sólo toca nodos de texto y transformaciones.
// Música DJ (fase 2): los módulos de música se cargan en dinámico; si fallan, el entrenamiento sigue en silencio.
// Escena 3D (§14, §15): <canvas> a pantalla completa DETRÁS del HUD. Se carga en dinámico; sin WebGL, con calidad
// 'off', si se pierde el contexto o si falla, queda el fondo 2D oscuro con el MISMO HUD.
// HUD de retransmisión (§16): la escena es la imagen de televisión; el HUD son rótulos pequeños y nítidos sobre una
// rejilla estricta — barra superior fina, velocidad gigante sin rótulo, lower third único (cuenta atrás + barra de zona
// + siguiente + mini perfil), una línea de métricas y «Sonando», «bugs» de momento arriba a la derecha y controles
// que se ocultan mientras corres. Sin máscaras, sin desenfoques, sin destellos (§15, §15.3).
import { fmt, esc, clamp, hashStr, todayKey } from '../core/utils.js';
import { ZONES, hrTargetForZone, fmtPaceKmh, hrZones, hrMaxFromAge } from '../training/levels.js';
import { getState, setState, saveActiveSession, loadActiveSession } from '../core/store.js';
import { navigate, back } from '../core/router.js';
import { icon, profileChart, openSheet, toast, confirmDialog, actionSheet } from '../ui/components.js';
import { haptic } from '../core/haptics.js';
import { workoutFromId, parseWorkoutId } from '../training/generator.js';
import { createEngine, restoreEngine, buildSession } from '../player/engine.js';
import { requestWakeLock, releaseWakeLock, isWakeLockSupported } from '../player/wakelock.js';
import { setNowPlaying, bindMediaControls, clearNowPlaying, setPlaybackState, setPosition } from '../player/media-session.js';
import { logoDataUrl } from '../integrations/share-card.js';
import { attachPlayer, isNative, post as nativePost } from '../integrations/native-bridge.js';
import { hrZoneOf } from '../integrations/watch-hr.js';
import { resolveTheme, AUTO_THEME, SCENE_IDS, SCENE_NAMES } from '../player/scene-pick.js';

/** Hápticas que marca el reloj de la clase (cuenta atrás, cambio de tramo, final): en la app nativa las da el
 *  Apple Watch en la muñeca, así que el iPhone no vibra; en Safari se mantienen. */
const timerHaptic = (kind) => {
  if (!isNative()) haptic(kind);
};

const CAT_NAMES = {
  intervals: 'Intervalos', tempo: 'Tempo', endurance: 'Resistencia', fartlek: 'Fartlek',
  hills: 'Cuestas', recovery: 'Recuperación', challenge: 'Retos', test: 'Test',
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_SAVE_SEC = 60;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const zoneColor = (z) => ZONES[z]?.color || '#ff6a1a';
const zoneName = (z) => ZONES[z]?.name || 'Correr';
const VISUAL_DEFAULTS = { quality: 'auto', tvMode: false, strideBob: true, ghost: true, theme: AUTO_THEME };
const FINISH_MS = 3200;       // plano final sobrio de la escena antes del resumen (un toque lo salta)
const FINISH_2D_MS = 2800;
const CTL_MS = 4000;          // un toque muestra los controles 4 s mientras corres
const BUG_MS = 3000;          // «bugs» de retransmisión (KM, MITAD, SERIE, RÉCORD): 3 s y salen
const GOLD = '#FFD60A';
// Bloques del HUD cuyo rectángulo recibe la escena: solo información de composición (§15.3: nunca máscaras)
const HUD_SEL = '.hud-top, .hud-speed__core, .hud-lt, .hud-info, .hud-test, .hud-bug.is-on, .hud-note.is-on, .hud-lockbar, .mo-deck.is-on, .mo-cap.is-on';
// Subtítulos del coach: solo frases (motivación, mitad, km, final); nunca avisos de tramo ni cifras deletreadas
const CAP_SKIP = new Set(['pre', 'change', 'tick', 'countdown', 'intro', 'adjust', 'resume', 'testStage', 'finishStats']);
const CAP_NUM = /\b(coma|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci\w+|veinte|veinti\w+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|segundos?|minutos?)\b/i;
const CTL_SEL = '.hud-ctl, .hud-tools';
/** Icono de tele (modo TV / AirPlay); propio para no tocar el set de iconos compartido. */
const tvIcon = (size = 20) => `<svg class="icon icon--tv" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="2.8" y="4.5" width="18.4" height="12.4" rx="2.6"/><path d="M8.2 20.2h7.6M12 17v3.2"/></svg>`;
const visuals0Quality = () => {
  try { return getState().visuals?.quality || 'auto'; } catch { return 'auto'; }
};
const NP_TEXT = {
  loading: 'Preparando la mezcla…',
  ready: 'Mezcla lista · arranca con el «¡ya!»',
  off: 'Música apagada',
  none: 'Música no disponible ahora',
};
const WAKE_WARN_KEY = 'br:wake-warned';
const WAKE_WARN_EVERY_MS = 30 * 86400e3; // el aviso del bloqueo automático: una vez (y un recordatorio al mes)
const SESSION_HOLD_MS = 7000;            // 'playback' se mantiene hasta que acaba la frase final del coach
const STORAGE_RETRY_MS = 60000;          // almacenamiento lleno: la instantánea se reintenta cada minuto, no cada 5 s
const SND_HOLD_MS = 450;                 // mantener ♪ abre la hoja «Sonido» (música y voz del coach, en vivo)
const SND_IDLE_MS = 8000;                // corriendo, la hoja se recoge sola tras 8 s sin tocarla (vuelven los datos)
const SND_SAVE_MS = 350;                 // mientras arrastras se guarda con retardo (aplicar es inmediato)
const SND_STEP = 5;                      // − / +: 5 puntos por toque
const SND_HINT_KEY = 'br:snd-hint';      // aviso «Mantén pulsado ♪…»: en las 2 primeras clases (o hasta usar la hoja)
const SND_HINT_CLASSES = 2;
let sessionGen = 0;                      // montajes del reproductor (un reajuste diferido de la sesión no pisa al siguiente)
/** Volumen guardado (0..1) → % entero de la hoja «Sonido», recortado a [min, 100]. */
const sndPct = (v, d, min) => clamp(Math.round((Number.isFinite(Number(v)) ? Number(v) : d) * 100), min, 100);

/** Ejecuta fn y devuelve false si el store avisó de un fallo de almacenamiento (persist() se lo traga y emite
 *  'br:storage-error' de forma síncrona) o si fn lanzó. */
function storageOk(fn) {
  let failed = false;
  const onErr = () => { failed = true; };
  try { window.addEventListener('br:storage-error', onErr); } catch { /* sin DOM */ }
  try { fn(); } catch { failed = true; }
  try { window.removeEventListener('br:storage-error', onErr); } catch { /* sin DOM */ }
  return !failed;
}

/** Quita el número de bloque cuando la clase solo tiene uno con ese nombre («Pirámide 1» → «Pirámide»). */
function blockLabeler(segments) {
  const bases = new Map();
  for (const s of Array.isArray(segments) ? segments : []) {
    const b = typeof s?.block === 'string' ? s.block : '';
    const m = /^(.*\S)\s+\d+$/.exec(b);
    if (!m) continue;
    if (!bases.has(m[1])) bases.set(m[1], new Set());
    bases.get(m[1]).add(b);
  }
  return (block) => {
    const b = typeof block === 'string' ? block : '';
    const m = /^(.*\S)\s+\d+$/.exec(b);
    return m && (bases.get(m[1])?.size || 0) <= 1 ? m[1] : b;
  };
}
const sameText = (a, b) => String(a || '').trim().localeCompare(String(b || '').trim(), 'es', { sensitivity: 'base' }) === 0;

/** Fija navigator.audioSession.type sin depender de audio-engine (respaldo si aún no exporta setAudioSessionType). */
function setSessionFallback(type) {
  try {
    const s = globalThis.navigator?.audioSession;
    if (s && s.type !== type) s.type = type;
  } catch { /* API no disponible */ }
}

/** Índice de pistas que vale como Map y como objeto ({ id: track }), para no depender de la forma que espere el motor. */
function tracksIndex(tracks) {
  const m = new Map();
  for (const t of tracks) {
    if (!t || !t.id) continue;
    m.set(t.id, t);
    m[t.id] = t;
  }
  return m;
}

/**
 * Mini perfil de la clase para el lower third (tira de ~34 px): barras planas del color de su zona (sin brillo), las
 * futuras apagadas, las ya corridas a media luz (clip que crece con el tiempo) y el tramo en curso, el más brillante.
 * viewBox 1000×H estirado al ancho del rótulo.
 */
function stripSvg(segments, uid) {
  const all = Array.isArray(segments) ? segments : [];
  const segs = all.filter((s) => s && Number(s.sec) > 0);
  const W = 1000;
  const H = 36;
  const total = segs.reduce((a, s) => a + Number(s.sec), 0) || 1;
  const speeds = segs.map((s) => Number(s.speed) || 0).filter((v) => v > 0);
  const maxS = Math.max(1, ...speeds);
  const minS = speeds.length ? Math.min(...speeds) : 0;
  const base = Math.max(0, minS * 0.62);
  let t = 0;
  let bars = '';
  let now = '';
  all.forEach((s, i) => {
    if (!s || !(Number(s.sec) > 0)) return;
    const x0 = (t / total) * W;
    const w0 = (Number(s.sec) / total) * W;
    t += Number(s.sec);
    const gap = Math.min(3, w0 * 0.3);
    const n = clamp(((Number(s.speed) || 0) - base) / Math.max(0.1, maxS - base), 0.12, 1);
    const h = 4 + (H - 4) * n;
    const rect = `x="${(x0 + gap / 2).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${Math.max(0.6, w0 - gap).toFixed(1)}" height="${h.toFixed(1)}" fill="${zoneColor(s.zone)}"`;
    bars += `<rect ${rect}/>`;
    now += `<rect data-strip-i="${i}" ${rect} opacity="0"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
<g class="hud-strip__future" opacity="0.9">${bars}</g>
<clipPath id="${uid}"><rect data-strip-clip x="0" y="0" width="0" height="${H}"/></clipPath>
<g class="hud-strip__past" clip-path="url(#${uid})">${bars}</g>
<g class="hud-strip__now">${now}</g>
</svg><i class="hud-strip__cur" data-strip-cur></i>`;
}

export function mount(el, { params = {}, query = {} } = {}) {
  el.classList.add('screen--fullscreen', 'pl-screen');

  const disposers = [];
  const timers = new Set();
  let disposed = false;
  let audioMod = null;
  let coachMod = null;
  const modsReady = Promise.all([
    import('../audio/audio-engine.js').then((m) => { audioMod = m; }).catch(() => {}),
    import('../audio/coach.js').then((m) => { coachMod = m; }).catch(() => {}),
  ]);
  // Música: módulos y biblioteca se piden ya, para que el plan esté listo al pulsar Empezar
  const musicPrefs0 = getState().music || {};
  const appMusic = musicPrefs0.mode !== 'own';
  let musicMods = null;
  const musicModsP = appMusic
    ? Promise.all([
      import('../audio/music.js').catch(() => null),
      import('../audio/music-plan.js').catch(() => null),
      import('../audio/music-library.js').catch(() => null),
    ]).then(([engineMod, planMod, libMod]) => { musicMods = { engineMod, planMod, libMod }; return musicMods; })
    : Promise.resolve(null);
  // Con ?debug=music (o localStorage 'br.debug.music' = '1' dentro de la app nativa, donde no hay barra de direcciones):
  // panel con el estado del motor DJ y del audio de iOS (para capturas en el móvil). Apagado por defecto.
  const nativeMusicDebug = (() => {
    try { return globalThis.localStorage?.getItem('br.debug.music') === '1'; } catch { return false; }
  })();
  if (/[?&]debug=music(?:&|$)/.test(globalThis.location?.search || '') || nativeMusicDebug) {
    import('../player/music-debug.js')
      .then((m) => { if (!disposed) disposers.push(m.mountMusicDebug(globalThis.document?.body, { getMusic: () => music })); })
      .catch(() => {});
  }
  // Escena 3D: el módulo (three.js) se descarga ya en la preparación para que esté listo al empezar
  const scene3dModP = visuals0Quality() !== 'off'
    ? import('../player/scene3d.js').catch(() => null)
    : Promise.resolve(null);
  // Motion graphics del HUD (js/player/motion.js): opcional; sin el módulo el HUD funciona igual
  let motionMod = null;
  let motion = null;
  import('../player/motion.js').then((m) => {
    motionMod = m;
    // Al restaurar (#/play/resume) el HUD puede montarse antes de que llegue el módulo: se engancha ahora
    try {
      if (!motion && !disposed && liveMounted() && workout) {
        motion = m.createMotion?.(root, refs, { captions: visuals.captions !== false, isTest: !!workout.isTest, onLayout: () => scheduleHudRects() }) || null;
      }
    } catch { motion = null; }
  }).catch(() => {});
  /** Llama a motion[fn] aislado; devuelve su resultado (undefined si no hay módulo o si falla). */
  const mo = (fn, ...args) => {
    try { return motion?.[fn]?.(...args); } catch { return undefined; }
  };
  const libP = musicModsP
    .then((m) => (m?.libMod?.loadLibrary ? m.libMod.loadLibrary(getState().music || {}) : []))
    .then((list) => (Array.isArray(list) ? list.filter((t) => t && t.id) : []))
    .catch(() => []);

  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms);
    timers.add(id);
    return id;
  };
  const cancel = (id) => {
    if (id == null) return;
    clearTimeout(id);
    timers.delete(id);
  };
  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    disposers.push(() => target.removeEventListener(type, fn, opts));
  };

  /* ───────── Estado del reproductor (declarado antes de cualquier return) ───────── */
  const state = getState();
  let workout = null;
  let snap = null;
  let planDate = DATE_RE.test(query?.date || '') ? query.date : null;
  let engine = null;
  let coach = null;
  let root = null;
  let refs = {};
  const cache = {};
  let muted = false;
  let locked = false;
  let finishedHandled = false;
  let discarded = false;
  let lastCoachPos = null;
  let suppressCoach = false;
  let quietPause = false;
  let needsCountdown = false;
  let countingDown = false;
  let lastUiTick = 0;
  let adjustTimer = null;
  let snapTimer = null;
  let unbindMedia = () => {};
  /** Diagnóstico: quién pausa o reanuda la clase (lo enseña el panel de la música). */
  const notePause = (src, st) => {
    try {
      const log = (globalThis.__brPauses = globalThis.__brPauses || []);
      log.push(`${src} ${st?.status || '-'} ${Math.round(Number(st?.totalElapsed) || 0)} s`);
      if (log.length > 6) log.shift();
    } catch { /* nada */ }
  };
  let wakeWarned = false;
  let artwork = null;
  let leaving = false;
  let confirmOpen = false;    // «¿Terminar ya?» abierto (⏭ en el último tramo)
  let strip = null;           // { clip, cur, total } del mini perfil del lower third
  let stripSeq = 0;
  // Controles: ocultos mientras corres, un toque los muestra CTL_MS; siempre visibles en pausa
  let ctlUntil = 0;
  let ctlT = null;
  // Bugs de retransmisión
  const bugQ = [];
  let bugBusy = false;
  let bugCur = null;          // { kind, end } el bug en pantalla (un bug nuevo del mismo tipo lo despide ya)
  let blockLabel = (b) => b;  // «Pirámide 1» → «Pirámide» si es el único bloque con ese nombre
  // Sesión de audio y almacenamiento
  const myGen = ++sessionGen;
  let sessionHoldUntil = 0;   // performance.now() hasta el que se mantiene 'playback' tras terminar
  let sessionCheckAt = 0;
  let storageBadAt = -1e9;    // último fallo al guardar la instantánea (reintento espaciado)
  let tvHintPending = false;  // aviso del modo TV: se enseña cuando los controles se recogen
  let preT = null;            // la escena creada en la preparación se para tras calentar sus shaders
  let tickErr = false;        // primer fallo del tick ya registrado en consola
  // Para el resumen y el pulso del Watch: tramos saltados [[desde, hasta]] y línea de tiempo
  // [[wallMs, classSec, corriendo 1|0], …] (inicio, pausas, reanudaciones, saltos, restauración y final)
  const skips = [];
  const timeline = [];
  let ghostSide = 0;          // -1 detrás · 0 desconocido · +1 delante (histéresis ±5 m) → bug RÉCORD
  let lastRecordBug = -1e9;
  let ghostBeaten = false;    // ya has superado la distancia de tu mejor marca (aviso único al reloj)
  // App nativa (iPhone + Apple Watch, js/integrations/native-bridge.js): en Safari, un adaptador vacío
  let nb = attachPlayer(null);
  let autoStarted = false;    // ?autostart=1 (orden «Empezar» del reloj): solo una vez
  // Música DJ
  let music = null;           // motor (js/audio/music.js)
  let musicUnlocked = false;
  let musicPlan = null;
  let musicPrepP = null;
  let musicStarted = false;
  let musicPending = false;   // arrancar en cuanto el plan esté listo
  let musicOn = musicPrefs0.enabled !== false;
  let musicFailed = false;    // sin módulos, sin pistas o sin plan: se entrena sin música
  let lastMusicPos = null;
  let lastKeepAlive = 0;
  let npKey = '';
  let npT = null;
  let beatRaf = 0;
  let lastPulse = -1;
  const musicTracks = [];     // ids que han sonado (→ session.music.tracks)
  let npBpm = 0;              // BPM efectivo de lo que suena (setBeat de la escena)
  // Hoja «Sonido» (mantener ♪): volumen de la música y de la voz del coach sin salir de la clase
  let snd = null;             // { el, close } abierta
  let sndPend = null;         // { music?, voice? } aplicado pero aún sin guardar en Perfil
  let sndSaveT = null;
  let sndIdleT = null;
  let sndHeldAt = -1e9;       // la pulsación larga acaba de abrirla: el clic al soltar no apaga la música
  let sndHintOff = null;      // retira el aviso «Mantén pulsado ♪…» si la abres mientras se ve
  // Escena 3D
  const visuals = { ...VISUAL_DEFAULTS, ...(state.visuals || {}) };
  let sessionTheme = null;    // escenario elegido en Preparación SOLO para esta clase ('auto' o un id; null = el de Perfil)
  let sceneThemeId = null;    // escenario con el que se creó (o al que se cambió) la escena
  let scene = null;           // controlador de createScene3D (null = fondo 2D)
  let sceneP = null;          // creación en curso
  let sceneCanvas = null;
  let sceneOn = false;        // primer fotograma pintado y lienzo visible
  let sceneAttached = false;  // la escena ya está en el HUD en marcha (setupScene hecho)
  let sceneDead = false;      // falló: no se reintenta en esta sesión
  let sceneRaf = 0;
  let sceneFeed = null;       // { s, at } último estado del motor enviado (para interpolar en cada fotograma)
  let sceneLite = false;
  let sceneInfoAt = 0;
  let lastAnalyser;           // undefined = aún no enviado
  let analyserAt = 0;
  const cdFired = new Set();  // cuentas atrás 3-2-1 ya enviadas ("segIndex:n")
  let dropTimes = [];         // instantes (s de clase) en que la música cae en un drop al empezar un tramo
  let dropIdx = -1;
  let lastPred = -1;
  let hudRO = null;
  let hudRaf = 0;
  let ghost = null;           // { trace, label, km, times, cum } mejor marca en esta clase (§14.1-1)
  let tvOn = visuals.tvMode === true;
  let tvHintT = null;
  let finale = false;         // plano final en curso
  let vpTimer = null;
  let testEndAt = -1e9;       // «No puedo más»: el salto a la calma no celebra la MITAD
  let tint = 0;               // capa activa del tinte 2D (fundido cruzado entre dos capas)
  const treadmill = state.treadmill || {};
  const weightKg = Number(state.profile?.weightKg) || 78;
  const mqLand = typeof matchMedia === 'function' ? matchMedia('(orientation: landscape)') : null;
  const callbacks = {
    onTick: (s) => onTick(s),
    onSegment: (s, info) => onSegment(s, info),
    onEvent: (type, data) => onEvent(type, data),
    treadmill,
    weightKg,
  };

  /* ───────── Carga de la clase ───────── */
  let rawId = String(params.id || '');
  try { rawId = decodeURIComponent(rawId); } catch { /* id tal cual */ }

  if (rawId === 'resume') {
    snap = loadActiveSession();
    if (!snap || !snap.workoutId) {
      renderError('No hay ningún entrenamiento a medias', 'Parece que ya lo terminaste o lo descartaste. ¡Vamos a por el de hoy!');
      return cleanup;
    }
    try { workout = workoutFromId(snap.workoutId, state); } catch { workout = null; }
    planDate = DATE_RE.test(snap.planDate || '') ? snap.planDate : null;
    if (!workout) {
      saveActiveSession(null);
      renderError('No pudimos recuperar la sesión', 'La clase guardada ya no existe. Empieza una nueva desde Hoy.');
      return cleanup;
    }
  } else {
    try { workout = workoutFromId(rawId, state); } catch { workout = null; }
    if (!workout || !Array.isArray(workout.segments) || !workout.segments.length) {
      renderError('No encontramos esta clase', 'Puede que el enlace esté incompleto. Elige otra en la biblioteca.');
      return cleanup;
    }
  }

  // Reloj: estado de la clase en directo, sus órdenes (cmd) y su pulso. Inerte fuera de la app nativa.
  nb = attachPlayer({
    workout,
    planDate,
    getState,
    getEngine: () => engine,
    extras: () => ({
      muted, musicOn, appMusic, countingDown, finale, finished: finishedHandled,
      np: musicStarted ? mcall('nowPlaying') : null, vol: sndPend?.music, sub: refs.sub?.textContent || '',
      ghost, ghostSide, canSkip: typeof music?.skipTrack === 'function',
      // ¿Sonó ya el audio en esta página? Con el iPhone bloqueado solo se reanuda así (tras una recarga, no arrancaría)
      audioLive: !!audioMod?.isUnlocked?.(),
    }),
    commands: {
      start: () => onStartTap(),
      toggle: () => { notePause('reloj', engine?.getState()); onToggle(); },
      skip: (dir) => doSkip(dir, true),
      endTest: () => doEndTest(),
      finish: () => { engine?.finish(); },
      discard: () => discard(),
      voice: () => toggleMute(null),
      nextSong: () => mcall('skipTrack'),
      adjust: (dir) => doAdjust(dir),
      // Corona del reloj: solo para esta clase (no se guarda) y nunca por debajo del 15 % (un roce de la muñeca
      // dejaba la música muda para siempre; para quitarla está «Música» en el iPhone).
      volume: (v) => { mcall('setVolume', Math.max(0.15, clamp(Number(v) || 0, 0, 1))); },
    },
    onHr: () => { if (liveMounted()) renderHr(); },
  });
  disposers.push(() => nb.detach());
  let healthListening = false;
  // audio-engine.js no consigue despertar el audio (3 intentos): que se sepa, y el siguiente toque lo reintenta
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    listen(window, 'br:audio-stuck', () => {
      if (!disposed && engine) notify('Sin sonido: toca la pantalla para recuperarlo', { icon: 'speaker', duration: 6000 });
    });
  }

  if (snap) {
    if (Array.isArray(snap.musicTracks)) musicTracks.push(...snap.musicTracks.filter((x) => typeof x === 'string'));
    if (Array.isArray(snap.skips)) skips.push(...snap.skips.filter((g) => Array.isArray(g) && g.length >= 2));
    if (Array.isArray(snap.timeline)) timeline.push(...snap.timeline.filter((e) => Array.isArray(e) && e.length >= 2));
    if (typeof snap.sceneTheme === 'string') sessionTheme = snap.sceneTheme;
    engine = restoreEngine(snap, workout, callbacks);
    nb.restore(snap.hrLive);
    const st = engine.getState();
    // Desde la última instantánea hasta que se reanude, nada corre (el pulso de ese hueco no cuenta)
    if (st.status !== 'finished') mark(false, st.totalElapsed, Number(snap.savedAt) || Date.now());
    if (st.status === 'finished') {
      // Terminada pero sin guardar (cierre justo al final): la guardamos ahora
      renderLive();
      onFinished(st);
      return cleanup;
    }
    needsCountdown = true;
    renderLive();
    applySegment(st, { reason: 'restore', silent: true });
    update(st);
    nb.resumed(st);
    notify('Retomamos donde lo dejaste · pulsa ▶ cuando estés listo', { icon: 'refresh', duration: 3600 });
    // «Empezar» desde el reloj con la clase a medias: se reanuda sola (con su cuenta 3-2-1)
    if (query?.autostart === '1' && isNative() && !autoStarted) {
      autoStarted = true;
      dropAutostart();
      later(() => { if (canAutostart()) onToggle(); }, 600);
    }
  } else {
    renderReady();
  }

  listen(document, 'visibilitychange', onVisibility);
  listen(window, 'pagehide', () => persist(true));
  if (mqLand) listen(mqLand, 'change', onViewport);
  listen(window, 'resize', onViewport);
  listen(window, 'orientationchange', onViewport);
  // Si los módulos de música llegan tarde (tras el gesto), se intenta igualmente (iOS puede negarlo: sin música)
  Promise.all([musicModsP, modsReady]).then(([m]) => {
    if (appMusic && typeof m?.engineMod?.createMusicEngine !== 'function') {
      musicFailed = true;
      if (!disposed && !musicStarted) refreshNowPlaying();
      return;
    }
    if (disposed || !engine || music || !musicOn) return;
    if (engine.getState().status !== 'finished') initMusic(false);
  });

  return cleanup;

  /* ═════════════════ Render: error ═════════════════ */
  function renderError(title, text) {
    el.innerHTML = `
      <div class="pl pl--error">
        <div class="pl-bg" aria-hidden="true"></div>
        <div class="pl-error fade-in">
          <div class="pl-error__icon">${icon('info', 44)}</div>
          <h1 class="pl-error__title">${esc(title)}</h1>
          <p class="pl-error__text">${esc(text)}</p>
          <button class="btn btn--primary btn--lg btn--block" data-href="#/today">Volver a Hoy</button>
          <button class="btn btn--ghost btn--block" data-href="#/library">Ver clases</button>
        </div>
      </div>`;
  }

  /* ═════════════════ Render: preparación ═════════════════ */
  function renderReady() {
    const st = getState();
    const segs = workout.segments;
    const first = segs[0];
    const firstSpeed = fmt.speed(first?.speed || 0);
    const cat = workout.category || 'intervals';
    const minutes = workout.minutes || Math.round((workout.totalSec || 0) / 60);
    const lead = Number(st.treadmill?.announceLead) || 10;
    // App nativa con el reloj instalado: el entreno del Watch lo abre la propia app al empezar
    const watchAuto = nb.watchManaged();
    const checks = [
      { ic: 'gauge', html: `Sube a la cinta y ponla a <b class="num">${firstSpeed}&nbsp;km/h</b>` },
      watchAuto
        ? { ic: 'watch', html: 'El reloj se abre solo al empezar y te manda el pulso en directo' }
        : isNative()
          ? { ic: 'watch', html: 'BestRunning en tu Apple Watch se conecta solo y manda tu pulso en directo' }
          : st.integrations?.watchReminder !== false
            ? { ic: 'watch', html: 'Inicia <b>Cinta de correr</b> en tu Apple Watch' } : null,
      // Con «Mi música» la sesión de audio debe mezclarse con Spotify (Ambient en iOS): la voz obedece al modo
      // silencio, también en la app nativa (WebKit lleva la sesión de la página; la app no la toca)
      appMusic
        ? { ic: 'speaker', html: `Sube el volumen: te aviso <b>${lead} s</b> antes de cada cambio` }
        : { ic: 'speaker', html: `Sube el volumen y <b>quita el modo silencio</b>: con tu música, la voz del coach lo respeta` },
      workout.isTest
        ? { ic: 'target', html: 'Aguanta cada escalón y pulsa <b>No puedo más</b> cuando llegues al límite' } : null,
    ].filter(Boolean);

    el.innerHTML = `
      <div class="pl pl--ready" style="--zc:${zoneColor(first?.zone)}">
        <div class="pl-bg" aria-hidden="true"></div>
        <div class="pl-world" data-pre-world aria-hidden="true"></div>
        <header class="pl-top">
          <button class="pl-iconbtn" data-act="close" aria-label="Cerrar">${icon('close', 17)}</button>
          <div class="pl-top__center"><div class="pl-top__title">Preparación</div></div>
          <span class="pl-top__spacer"></span>
        </header>
        <div class="pl-ready">
          <div class="pl-ready__body">
            <div class="pl-ready__col pl-ready__col--a stagger">
            <header class="pl-ready__head" style="--i:0">
              <div class="pl-ready__eyebrow">${esc(CAT_NAMES[cat] || 'Entrenamiento')} · ${minutes} min</div>
              <h1 class="pl-ready__title">${esc(workout.title || 'Entrenamiento')}</h1>
              ${workout.subtitle ? `<p class="pl-ready__sub">${esc(workout.subtitle)}</p>` : ''}
            </header>
            <div class="pl-ready__chart" style="--i:1">
              ${profileChart(segs, { height: 150, showLevels: true, levels: st.levels })}
            </div>
            </div>
            <div class="pl-ready__col pl-ready__col--b stagger">
            <div class="pl-ready__stats" style="--i:2">
              ${readyStat('Duración', String(minutes), 'min')}
              ${readyStat('Distancia', fmt.dec1(workout.estDistanceKm || 0), 'km')}
              ${readyStat('Kcal', fmt.int(workout.estKcal || 0), '')}
              ${readyStat('Vel. máx.', fmt.speed(workout.maxSpeed || 0), 'km/h')}
            </div>
            ${readySceneHtml()}
            <section class="pl-ready__group" style="--i:3">
              <h2 class="list-header">Antes de empezar</h2>
              <ul class="pl-check">
                ${checks.map((c) => `
                  <li><button class="pl-check__item" data-act="check" aria-pressed="false">
                    <span class="pl-check__ic">${icon(c.ic, 22)}</span>
                    <span class="pl-check__txt">${c.html}</span>
                    <span class="pl-check__box">${icon('check', 14)}</span>
                  </button></li>`).join('')}
              </ul>
            </section>
            <section class="pl-ready__group" style="--i:4">
              <h2 class="list-header">Sonido</h2>
              ${readyMusicHtml()}
            </section>
            ${readyHealthHtml()}
            </div>
          </div>
          <div class="pl-ready__cta">
            <button class="btn btn--primary btn--lg btn--block pl-start" data-act="start">
              ${icon('play', 20)}<span>Empezar</span>
            </button>
          </div>
        </div>
      </div>`;

    root = el.querySelector('.pl');
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'close') { haptic('light'); back('#/today'); }
      else if (act === 'check') {
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(on));
        haptic(on ? 'selection' : 'light');
      } else if (act === 'start') onStartTap();
      else if (act === 'health') {
        // La hoja de Salud si aún sale; si ya se dijo que no, el iPhone abre Ajustes (lo decide la app nativa)
        haptic('medium');
        if (!nativePost('health.authorize', {})) toast('No se ha podido abrir el permiso de Salud', { kind: 'error' });
      } else if (act === 'scene') {
        const id = b.dataset.scene;
        if (!id || b.getAttribute('aria-checked') === 'true') return;
        sessionTheme = id;
        haptic('selection');
        const slot = root.querySelector('[data-slot="scene"]');
        if (slot) slot.outerHTML = readySceneHtml();
        applySceneTheme();
      } else if (act === 'music-ready') {
        // Solo para este entreno (Perfil → Música guarda la preferencia): nunca se apaga «para siempre» sin avisar
        musicOn = !musicOn;
        haptic('selection');
        b.outerHTML = readyMusicHtml();
      }
    });
    // Borde de desplazamiento iOS (separador bajo «Preparación» en cuanto el contenido sube)
    const rbody = root.querySelector('.pl-ready__body');
    if (rbody) {
      const onScroll = () => root.classList.toggle('is-scrolled', rbody.scrollTop > 2);
      rbody.addEventListener('scroll', onScroll, { passive: true });
    }
    // La escena 3D (renderer, escenario, shaders) se crea YA, oculta, mientras lees la preparación: así el trabajo
    // pesado del hilo principal no cae en la cuenta 3-2-1 ni en los primeros segundos de carrera
    later(initScene, 450);
    nb.ready();
    if (!healthListening && isNative()) {
      // El permiso de Salud cambia (hoja respondida, vuelta de Ajustes): se repinta solo ese aviso
      healthListening = true;
      listen(window, 'br:native-status', () => {
        const slot = root?.querySelector?.('[data-slot="health"]');
        if (slot && !engine && !disposed) slot.outerHTML = readyHealthHtml();
      });
    }
    // «Empezar» desde el reloj (app nativa): la clase arranca sola, una vez
    if (query?.autostart === '1' && isNative() && !autoStarted) {
      autoStarted = true;
      dropAutostart();
      later(() => { if (canAutostart()) onStartTap(); }, 600);
    }
  }

  /**
   * El autoarranque del reloj solo con la página a la vista: con el iPhone bloqueado (o BestRunning detrás) iOS no deja
   * arrancar el audio y la clase saldría muda. El puente ya rechaza «Empezar» así; esto cubre bloquearlo justo después.
   */
  function canAutostart() {
    return !disposed && document.visibilityState !== 'hidden';
  }

  /** Quita ?autostart=1 de la URL (una recarga no debe volver a arrancar la clase). */
  function dropAutostart() {
    try {
      const h = String(location.hash || '');
      const clean = h.replace(/([?&])autostart=1(&|$)/, (m, a, b) => (b ? a : '')).replace(/[?&]$/, '');
      if (clean !== h) history.replaceState(history.state, '', clean || '#/today');
    } catch { /* sin historial */ }
  }

  /** App nativa con el reloj: si falta el permiso de Salud, el pulso del reloj no llegará; aquí se dice y se arregla. */
  function readyHealthHtml() {
    const miss = nb.healthMissing?.();
    if (!miss) return '<div data-slot="health" hidden></div>';
    const small = miss === 'prompt'
      ? 'Toca para dar permiso: sin él, el reloj no lee tu pulso'
      : 'Toca para abrir Ajustes y luego: Apps › Salud › Acceso a datos y dispositivos › BestRunning › Activar todo';
    return `<div data-slot="health"><button type="button" class="mu-ready mu-ready--health" data-act="health" style="--i:7">
        <span class="mu-ready__ic">${icon('heart', 22)}</span>
        <span class="mu-ready__txt"><b>Permite el pulso en Salud</b><small>${esc(small)}</small></span>
        <span class="mu-ready__chev" aria-hidden="true">${icon('chevron-right', 14)}</span>
      </button></div>`;
  }

  /**
   * Escenario de esta clase: «Automático» (el mundo que toca por el tipo de clase) y los cuatro mundos, en miniatura.
   * Lo elegido aquí vale solo para esta clase; el predeterminado está en Perfil › Pantalla de entreno.
   */
  function readySceneHtml() {
    if (visuals.quality === 'off') return '<div data-slot="scene" hidden></div>';
    const pick = themePick();
    const auto = resolveTheme(AUTO_THEME, workout);
    const name = (id) => SCENE_NAMES[id] || id;
    const thumb = (id) => `<img src="./assets/scenes/${encodeURIComponent(id)}.jpg" width="240" height="428" alt="" decoding="async">`;
    const opt = (id, label, inner, on) => `<button type="button" class="pl-scn__opt${id === AUTO_THEME ? ' pl-scn__opt--auto' : ''}" role="radio" aria-checked="${on}" data-act="scene" data-scene="${id}">
        <span class="pl-scn__thumb">${inner}</span>
        <span class="pl-scn__name">${esc(label)}</span>
      </button>`;
    const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
    const other = auto.id !== pick.id ? ` Con Automático, hoy tocaría ${esc(name(auto.id))}.` : '';
    const note = pick.auto
      ? `<b>${esc(name(pick.id))}</b> · ${esc(cap(pick.reason))}`
      : sessionTheme
        ? `<b>${esc(name(pick.id))}</b> solo en esta clase.${other}`
        : `<b>${esc(name(pick.id))}</b> · el de tu perfil.${other}`;
    return `<section class="pl-ready__group pl-scn" data-slot="scene" style="--i:3">
        <h2 class="list-header">Escenario</h2>
        <div class="pl-scn__row" role="radiogroup" aria-label="Escenario de esta clase">
          ${opt(AUTO_THEME, 'Auto', `${thumb(auto.id)}<span class="pl-scn__auto" aria-hidden="true">Auto</span>`, pick.auto)}
          ${SCENE_IDS.map((id) => opt(id, name(id), thumb(id), !pick.auto && pick.id === id)).join('')}
        </div>
        <p class="pl-scn__note" aria-live="polite">${note}</p>
      </section>`;
  }

  function readyMusicHtml() {
    if (!appMusic) {
      return `<div class="mu-ready mu-ready--own" style="--i:6">
        <span class="mu-ready__ic">${icon('music', 22)}</span>
        <span class="mu-ready__txt"><b>Mi música</b><small>Pon tu Spotify o Apple Music: el coach hablará por encima</small></span>
      </div>`;
    }
    return `<button type="button" class="mu-ready${musicOn ? ' is-on' : ''}" data-act="music-ready" aria-pressed="${musicOn}" style="--i:6">
      <span class="mu-ready__ic">${icon('music', 22)}</span>
      <span class="mu-ready__txt"><b>Música DJ BestRunning</b><small>${musicOn ? 'Electrónica a tu ritmo, mezclada en cada cambio' : 'Apagada en este entreno · toca para activarla'}</small></span>
      <span class="mu-switch" aria-hidden="true"><span></span></span>
    </button>`;
  }

  function readyStat(label, value, unit) {
    return `<div class="pl-rstat">
      <span class="pl-rstat__lbl">${esc(label)}</span>
      <span class="pl-rstat__val num">${esc(value)}${unit ? `<small>${esc(unit)}</small>` : ''}</span>
    </div>`;
  }

  /* ═════════════════ Render: en marcha (HUD de retransmisión §16) ═════════════════ */
  function renderLive() {
    const first = engine ? engine.getState().segment : workout.segments[0];
    const zc = zoneColor(first?.zone);
    const musicLbl = !appMusic ? 'Modo Mi música' : musicOn ? 'Apagar música' : 'Encender música';
    el.innerHTML = `
      <div class="pl pl--live${appMusic ? '' : ' is-own-music'}${appMusic && !musicOn ? ' is-music-off' : ''}${tvOn ? ' is-tv' : ''}" data-status="ready" data-zone="${esc(first?.zone || 'jog')}" style="--zc:${zc};--nc:${zc}">
        <div class="pl-bg pl-bg--live" aria-hidden="true">
          <i class="pl-bg__tint is-on" data-ref="tint0" style="--tc:${zc}"></i>
          <i class="pl-bg__tint" data-ref="tint1" style="--tc:${zc}"></i>
          <i class="pl-bg__floor"></i>
          <i class="pl-bg__vignette"></i>
        </div>
        <div class="pl-world" data-ref="world" aria-hidden="true"></div>
        <div class="hud" data-ref="hud">
          <header class="hud-top hud-plate">
            <div class="hud-top__l">
              <span class="hud-top__title">${esc(workout.title || 'Entrenamiento')}</span>
              <span class="hud-top__sub num" data-ref="sub"></span>
            </div>
            <div class="hud-top__r num">
              <span class="hud-top__el" data-ref="elapsed" aria-label="Transcurrido">0:00</span>
              <i class="hud-top__div" aria-hidden="true"></i>
              <span class="hud-top__rem" data-ref="remaining" aria-label="Restante">−0:00</span>
            </div>
            <span class="hud-top__bar" aria-hidden="true"><i data-ref="topFill"></i></span>
          </header>
          <div class="hud-tools">
            <button class="hud-btn" data-act="exit" aria-label="Terminar entrenamiento">${icon('close', 18)}</button>
            <span class="hud-tools__sp"></span>
            <button class="hud-btn hud-tvbtn" data-act="tv" aria-pressed="${tvOn}" aria-label="${tvOn ? 'Salir del modo TV' : 'Modo TV (AirPlay)'}">${tvIcon(18)}</button>
            <button class="hud-btn" data-act="list" aria-label="Ver estructura de la clase">${icon('list', 18)}</button>
          </div>
          <div class="hud-bugs">
            <div class="hud-bugs__slot" data-ref="bugs" aria-live="polite"></div>
            <div class="hud-notes" data-ref="notes" role="status" aria-live="polite"></div>
          </div>
          <section class="hud-speed" data-ref="hero">
            <div class="hud-speed__core">
              <div class="hud-state">${icon('pause', 11)}<span>En pausa</span></div>
              <div class="hud-zone" data-ref="zoneBox"><i class="hud-zone__dot"></i><span data-ref="zoneName"></span></div>
              <div class="hud-speed__row">
                <button class="hud-adj hud-adj--minus" data-adj="-1" aria-label="Bajar 0,1 km/h">${icon('minus', 22, { stroke: 2.6 })}</button>
                <span class="hud-speed__fig">
                  <span class="hud-speed__glow num" data-ref="speedGlow" aria-hidden="true">0,0</span>
                  <span class="hud-speed__num num" data-ref="speed">0,0</span>
                </span>
                <button class="hud-adj hud-adj--plus" data-adj="1" aria-label="Subir 0,1 km/h">${icon('plus', 22, { stroke: 2.6 })}</button>
              </div>
              <div class="hud-pace">
                <span class="hud-u">km/h</span><i class="hud-dot" aria-hidden="true"></i>
                <span class="num" data-ref="pace">–:––</span><span class="hud-u">min/km</span>
                <span class="hud-pace__inc num" data-ref="incline"></span>
                <span class="hud-adjbadge num" data-ref="adjBadge"></span>
              </div>
              <div class="hud-ghost num" data-ref="ghost" hidden></div>
            </div>
          </section>
          <div class="hud-ctl" data-ref="ctl">
            <button class="hud-btn" data-act="lock" aria-label="Bloquear pantalla">${icon('lock', 20)}</button>
            <button class="hud-btn" data-act="prev" aria-label="Tramo anterior">${icon('skip-back', 22)}</button>
            <button class="hud-play" data-act="toggle" aria-label="Empezar" data-ref="toggle">
              <span class="hud-play__ic hud-play__ic--play">${icon('play', 28)}</span>
              <span class="hud-play__ic hud-play__ic--pause">${icon('pause', 28)}</span>
            </button>
            <button class="hud-btn" data-act="next" aria-label="Tramo siguiente">${icon('skip-forward', 22)}</button>
            <div class="mu-duo hud-duo" role="group" aria-label="Sonido">
              <button class="mu-duo__btn" data-act="mute" aria-label="Silenciar coach" aria-pressed="false">
                <span class="pl-ctl__on">${icon('speaker', 20)}</span><span class="pl-ctl__off">${icon('speaker-off', 20)}</span>
              </button>
              <button class="mu-duo__btn mu-duo__btn--music" data-act="music" data-ref="musicBtn" aria-label="${musicLbl}" aria-pressed="${appMusic && musicOn}" aria-describedby="pl-snd-desc">
                ${icon('music', 19)}<span class="mu-duo__slash" aria-hidden="true"></span><i class="mu-duo__hold" aria-hidden="true"></i>
              </button>
              <span class="sr-only" id="pl-snd-desc">Mantén pulsado para ajustar el volumen de la música y de la voz</span>
            </div>
          </div>
          <div class="hud-lockbar">
            <button class="pl-lock__btn" data-ref="unlockBtn" aria-label="Mantén pulsado para desbloquear">
              <svg class="pl-lock__ring" viewBox="0 0 88 88" aria-hidden="true">
                <circle class="pl-lock__track" cx="44" cy="44" r="40"></circle>
                <circle class="pl-lock__prog" cx="44" cy="44" r="40" pathLength="100"></circle>
              </svg>
              <span class="pl-lock__ic">${icon('unlock', 24)}</span>
            </button>
            <div class="hud-lockbar__hint hud-plate" data-ref="lockHint"><b>${icon('lock', 13)}Pantalla bloqueada</b><span>Mantén pulsado el candado</span></div>
          </div>
          <button class="hud-test" data-act="endtest" hidden>${icon('flame', 20)}<span>No puedo más</span></button>
          <section class="hud-lt hud-plate" data-ref="lt">
            <i class="hud-lt__sweep" data-ref="sweep" aria-hidden="true"></i>
            <div class="hud-lt__head">
              <div class="hud-lt__cd">
                <span class="hud-lbl">Queda</span>
                <span class="hud-lt__time num" data-ref="segLeft">0:00</span>
              </div>
              <div class="hud-lt__next" data-ref="next">
                <span class="hud-lbl" data-ref="nextLbl">Siguiente</span>
                <span class="hud-lt__nv"><span class="hud-lt__arrow" data-ref="nextArrow"></span><span class="hud-lt__nt num" data-ref="nextTxt"></span></span>
              </div>
            </div>
            <div class="hud-lt__go" aria-live="assertive">
              <div class="hud-lt__cd">
                <span class="hud-lbl" data-ref="goLbl">Empezamos</span>
                <span class="hud-lt__time num" data-ref="goNum">3</span>
              </div>
              <div class="hud-lt__next">
                <span class="hud-lbl" data-ref="goHint">Pon la cinta a</span>
                <span class="hud-lt__nv"><span class="hud-lt__nt num" data-ref="goSpeed"></span></span>
              </div>
            </div>
            <div class="hud-lt__bar" aria-hidden="true"><i data-ref="segFill"></i></div>
            <div class="hud-strip" data-ref="profile" aria-hidden="true"></div>
          </section>
          <section class="hud-info hud-plate">
            <div class="hud-metrics">
              <span class="hud-m"><span class="hud-lbl">Dist.</span><b class="num" data-ref="km">0,00</b><small>km</small></span>
              <i class="hud-vsep" aria-hidden="true"></i>
              <span class="hud-m"><span class="hud-lbl">Kcal</span><b class="num" data-ref="kcal">0</b></span>
              <i class="hud-vsep" aria-hidden="true"></i>
              <span class="hud-m hud-m--hr"><span class="hud-lbl">FC</span><b class="hud-hrz" data-ref="hrZone"></b><b class="num" data-ref="hr">–</b></span>
            </div>
            ${appMusic ? `<div class="hud-np is-dim" data-ref="np">
              <span class="mu-np__eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
              <span class="hud-np__txt" data-ref="npTxt"></span>
            </div>` : ''}
          </section>
          <div class="hud-done" data-ref="done" hidden></div>
        </div>
        <div class="hud-tvhint" data-ref="tvHint">Toca la pantalla para ver los controles</div>
        <div class="pl-lock" data-ref="lock" hidden></div>
      </div>`;

    root = el.querySelector('.pl');
    refs = {};
    root.querySelectorAll('[data-ref]').forEach((n) => { refs[n.dataset.ref] = n; });
    for (const k of Object.keys(cache)) delete cache[k];
    npKey = '';
    lastPulse = -1;
    tint = 0;
    bugQ.length = 0;
    bugCur = null;
    bugBusy = false;
    blockLabel = blockLabeler(engine ? engine.getSegments() : workout.segments);
    mo('destroy');
    try {
      motion = motionMod?.createMotion?.(root, refs, { captions: visuals.captions !== false, isTest: !!workout.isTest, onLayout: () => scheduleHudRects() }) || null;
    } catch { motion = null; }
    renderProfile();
    if (appMusic) refreshNowPlaying();
    ghost = visuals.ghost !== false ? findGhost() : null;
    applyTv();
    observeHud();
    initScene();
    syncCtl();

    root.addEventListener('click', onLiveClick);
    // Cualquier toque sirve de gesto para desbloquear la música si no se pudo al empezar
    root.addEventListener('click', () => { if (engine && !musicUnlocked && musicOn) initMusic(); }, { capture: true });
    // VoiceOver/teclado: llevar el foco a un control lo muestra
    root.addEventListener('focusin', (e) => {
      if (e.target.closest?.('.hud-ctl, .hud-tools, .hud-adj') && cache.status === 'running') showCtl();
    });
    root.querySelectorAll('.hud-adj').forEach((b) => bindHold(b, () => doAdjust(Number(b.dataset.adj))));
    bindUnlock();
    bindSoundHold();
    // Evita el menú contextual / lupa en pulsaciones largas
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    artwork = artwork || (() => { const src = logoDataUrl(512); return src ? [{ src, sizes: '512x512', type: 'image/png' }] : null; })();
    unbindMedia = bindMediaControls({
      // Tras retomar (#/play/resume) el coach aún no existe si se reanuda desde los auriculares o el Centro de control
      onPlay: () => { if (engine?.getState().status === 'paused' && !countingDown) { ensureCoach(); engine.resume(); } },
      // Al arrancar, iOS puede mandar un «pausa» de sistema (interrupción del audio, el reloj tomando el
      // «Ahora suena»…) que dejaba la clase pausada nada más empezar en la app nativa: los 10 primeros
      // segundos se ignora. Queda anotado para el diagnóstico (globalThis.__brPauses).
      onPause: () => {
        const st = engine?.getState();
        if (st?.status !== 'running') return;
        const early = Number(st.totalElapsed) < 10;
        notePause(early ? 'sistema (ignorada)' : 'sistema', st);
        if (!early) engine.pause();
      },
      onNext: () => doSkip(1),
      onPrev: () => doSkip(-1),
    });
    disposers.push(() => unbindMedia());

    if (!snapTimer) {
      snapTimer = setInterval(persist, 5000);
      disposers.push(() => clearInterval(snapTimer));
    }
  }

  /** Pinta el mini perfil una sola vez (y tras ajustar velocidades); cada tick sólo mueve el clip y el cursor. */
  function renderProfile() {
    if (!refs.profile || !engine) return;
    const s = engine.getState();
    refs.profile.innerHTML = stripSvg(engine.getSegments(), `hud-strip-${++stripSeq}`);
    strip = {
      clip: refs.profile.querySelector('[data-strip-clip]'),
      cur: refs.profile.querySelector('[data-strip-cur]'),
      total: s.totalSec || 1,
      idx: -1,
    };
    delete cache.stripPx;
    updateProfile(s);
    scheduleHudRects();
  }

  function updateProfile(s) {
    if (!strip?.clip) return;
    // El tramo en curso, a plena luz (el resto, en su color apagado)
    const si = Number.isFinite(s.segIndex) ? s.segIndex : -1;
    if (si !== strip.idx) {
      refs.profile.querySelector(`[data-strip-i="${strip.idx}"]`)?.setAttribute('opacity', '0');
      refs.profile.querySelector(`[data-strip-i="${si}"]`)?.setAttribute('opacity', '1');
      strip.idx = si;
    }
    const f = clamp(s.totalElapsed / strip.total, 0, 1);
    const px = Math.round(f * 10000) / 10; // 0..1000 (viewBox) con 0,1 de resolución
    if (cache.stripPx === px) return;
    cache.stripPx = px;
    strip.clip.setAttribute('width', String(px));
    if (strip.cur) strip.cur.style.left = `${(px / 10).toFixed(2)}%`;
  }

  /* ═════════════════ Arranque ═════════════════ */
  function unlockAudioNow() {
    // Debe ocurrir dentro del gesto del usuario (iOS). La sesión se fija ANTES de crear/reanudar el AudioContext:
    // así nace ya en la categoría buena (con 'playback' el modo silencio no calla al coach)
    try { audioMod?.applyAudioSettings?.(getState().audio); } catch { /* sin audio */ }
    syncSession();
    try { audioMod?.unlockAudio?.()?.catch?.(() => {}); } catch { /* idem */ }
    syncSession();
  }

  /* ═════════════════ Música DJ ═════════════════ */
  // Sesión de audio de iOS (WebKit): 'transient', 'ambient' y 'auto' (con Web Audio) acaban en la categoría Ambient,
  // que OBEDECE al modo silencio y al bloqueo ⇒ el coach enmudecería. En modo «música de la app» la app es la fuente:
  // 'playback' durante TODO el entreno, con la música sonando, apagada o aún cargando, y hasta que acaba la frase
  // final. Con «Mi música» hay que mezclarse con Spotify/Apple Music (solo Ambient lo permite): la preparación pide
  // quitar el modo silencio.
  function desiredSession() {
    if (appMusic) return 'playback';
    return getState().audio?.duckMusic === false ? 'ambient' : 'transient';
  }

  function syncSession(type = desiredSession()) {
    try {
      if (typeof audioMod?.setAudioSessionType === 'function') audioMod.setAudioSessionType(type);
      else setSessionFallback(type === 'auto' ? 'auto' : type);
    } catch { /* sin API */ }
  }

  /** ¿Debe seguir la sesión en 'playback'? (entreno en marcha o frase final aún sonando, y sin otro reproductor). */
  function holdPlayback() {
    if (!appMusic || myGen !== sessionGen) return false;
    if (!disposed && engine && !finishedHandled) return true;
    return performance.now() < sessionHoldUntil;
  }

  /** El motor DJ devuelve la sesión a 'auto' al parar/apagarse/acabar su plan: aquí se reafirma (barato, 1 Hz). */
  function guardSession(force = false) {
    if (!holdPlayback()) return;
    const now = performance.now();
    if (!force && now - sessionCheckAt < 1000) return;
    sessionCheckAt = now;
    const as = globalThis.navigator?.audioSession;
    if (force || (as && as.type !== 'playback')) syncSession('playback');
  }

  /** Al salir: 'auto' — pero si la frase final del coach aún suena (modo música de la app), cuando acabe. */
  function releaseSession() {
    const wait = appMusic && finishedHandled ? sessionHoldUntil - performance.now() : 0;
    if (wait <= 0) { syncSession('auto'); return; }
    setTimeout(() => { if (myGen === sessionGen) syncSession('auto'); }, wait);
  }

  function mcall(fn, ...args) {
    if (!music || typeof music[fn] !== 'function') return undefined;
    try {
      const r = music[fn](...args);
      if (r && typeof r.catch === 'function') r.catch(() => {});
      return r;
    } catch {
      return undefined;
    }
  }

  /**
   * Crea el motor DJ y, si se llama DENTRO de un gesto, desbloquea sus <audio> (iOS). Fuera de un gesto solo prepara
   * el motor y el plan: el desbloqueo queda para el siguiente toque. Nunca lanza.
   */
  function initMusic(inGesture = true) {
    if (!appMusic || !musicOn || disposed) return;
    if (!music) {
      const mod = musicMods?.engineMod;
      if (typeof mod?.createMusicEngine !== 'function') return; // aún cargando: se reintenta en el próximo toque
      try {
        const getAudioContext = typeof audioMod?.getAudioContext === 'function' ? audioMod.getAudioContext : undefined;
        music = mod.createMusicEngine({ getAudioContext, keepSession: true }) || null;
      } catch {
        music = null;
      }
      if (!music) { musicFailed = true; return; }
      const m = getState().music || {};
      let vol = clamp(Number(m.volume ?? 0.8), 0, 1);
      // Música a 0 % guardada (un giro sin querer de la Corona del reloj la dejaba muda en todas las clases):
      // se recupera el 80 % y se avisa. Para no oír música está el interruptor «Música», no el volumen.
      if (!(vol >= 0.1)) {
        vol = 0.8;
        storageOk(() => setState((d) => {
          if (!d.music || typeof d.music !== 'object') d.music = {};
          d.music.volume = vol;
        }));
        later(() => toast('La música estaba a 0 %: la he subido al 80 %', { icon: 'music', duration: 4500 }), 1200);
      }
      mcall('setVolume', vol);
      mcall('setEffects', m.effects !== false);
      mcall('setEnabled', true);
    }
    // 'playback' antes de desbloquear: los <audio> toman ya la sesión de la app
    syncSession();
    if (!musicUnlocked && inGesture) {
      musicUnlocked = true;
      mcall('unlock');
    }
    prepareMusic();
  }

  function musicSeed() {
    return hashStr(`${workout.id || workout.templateId || 'br'}|${planDate || todayKey()}`);
  }

  /** Construye el plan musical y pre-carga la primera pista. Devuelve una promesa que nunca rechaza. */
  function prepareMusic() {
    if (musicPrepP || !music) return musicPrepP;
    musicPrepP = (async () => {
      const tracks = await libP;
      const planMod = musicMods?.planMod;
      if (!tracks.length || typeof planMod?.buildMusicPlan !== 'function' || disposed) return null;
      const st = getState();
      const segs = engine ? engine.getSegments() : workout.segments;
      const plan = planMod.buildMusicPlan({ ...workout, segments: segs }, tracks, {
        seed: musicSeed(),
        announceLead: Number(st.treadmill?.announceLead) || 10,
        prefs: st.music || {},
      });
      if (!plan || !Array.isArray(plan.cues) || !plan.cues.length) return null;
      await music.load(plan, tracksIndex(tracks));
      return plan;
    })()
      .catch(() => null)
      .then((plan) => {
        if (disposed) return null;
        musicPlan = plan;
        computeDrops();
        if (!plan) {
          musicFailed = true;
          setNp('none');
          return null;
        }
        if (!musicStarted) setNp(musicOn ? 'ready' : 'off');
        if (musicPending) startMusicNow();
        return plan;
      });
    return musicPrepP;
  }

  /** Arranca la música en la posición actual de la clase (o la deja pendiente si el plan aún no está). */
  function startMusic() {
    if (!appMusic || !musicOn || musicStarted || disposed) return;
    if (!music) { initMusic(false); if (!music) return; }
    if (!musicPlan) {
      musicPending = true;
      prepareMusic();
      return;
    }
    startMusicNow();
  }

  function startMusicNow() {
    musicPending = false;
    if (!music || musicStarted || !musicPlan || !musicOn || disposed || !engine) return;
    const s = engine.getState();
    if (s.status !== 'running') {
      musicPending = s.status === 'paused' || s.status === 'ready';
      return;
    }
    musicStarted = true;
    mcall('start', s.totalElapsed);
    lastMusicPos = s.totalElapsed;
    syncSession();
    refreshNowPlaying();
    startBeat();
  }

  function stopMusic(fadeSec = 2) {
    stopBeat();
    musicPending = false;
    npBpm = 0;
    if (!music) return;
    const m = music;
    const p = mcall('stop', { fadeSec });
    music = null;
    // music.js vuelve a 'auto' al acabar el fundido: con la frase final sonando se reafirma 'playback'
    Promise.resolve(p).then(() => guardSession(true), () => guardSession(true));
    // Deja terminar el fundido antes de liberar los <audio>
    setTimeout(() => { try { m.destroy?.(); } catch { /* nada */ } }, Math.max(300, fadeSec * 1000 + 400));
  }

  function musicTick(s) {
    if (!music || !musicStarted) return;
    const pos = s.totalElapsed;
    // Salto grande hacia delante = el JS estuvo dormido: reubica la mezcla en lugar de "ponerse al día"
    if (lastMusicPos != null && pos - lastMusicPos > 4) mcall('seek', pos);
    else mcall('update', pos, s);
    lastMusicPos = pos;
    if (musicOn && Date.now() - lastKeepAlive > 1000) {
      // Mantiene vivo el AudioContext compartido (en modo 'transient' audio-engine lo suspende en reposo)
      lastKeepAlive = Date.now();
      try { audioMod?.ensureAudioRunning?.()?.catch?.(() => {}); } catch { /* nada */ }
    }
    refreshNowPlaying();
  }

  function musicSeek(s) {
    if (!music || !musicStarted) return;
    mcall('seek', s.totalElapsed);
    lastMusicPos = s.totalElapsed;
  }

  function noteTrack(id) {
    if (id && typeof id === 'string' && !musicTracks.includes(id)) musicTracks.push(id);
  }

  /** Pistas que han sonado: lo registrado en directo o, si el motor no da ids, lo que dice el plan hasta ahora. */
  function playedTracks(upToSec) {
    if (!musicTracks.length && musicStarted && musicPlan?.cues) {
      for (const c of musicPlan.cues) if ((Number(c.atSec) || 0) <= upToSec + 0.5) noteTrack(c.trackId);
    }
    return musicTracks.slice();
  }

  /* ───────── «Sonando»: UNA sola línea; al cambiar de pista sale el texto y después entra el nuevo (§15.3) ───────── */
  function setNp(kind) {
    root?.classList.toggle('is-music-na', kind === 'none');
    showNp(`#${kind}`, NP_TEXT[kind] || '', true);
  }

  function showNp(key, text, dim = false) {
    const box = refs.np;
    const txt = refs.npTxt;
    if (!box || !txt) return;
    box.classList.toggle('is-dim', dim);
    if (key === npKey) {
      // Misma pista: actualiza el texto en sitio (p. ej. el BPM) salvo que esté a mitad de un relevo
      if (!npT && txt.textContent !== text) txt.textContent = text;
      return;
    }
    npKey = key;
    cancel(npT);
    npT = null;
    if (reducedMotion() || !txt.textContent) {
      txt.classList.remove('is-out');
      txt.textContent = text;
      return;
    }
    // Relevo limpio: nunca hay dos títulos a la vez (fuera 180 ms → cambio → dentro)
    txt.classList.add('is-out');
    npT = later(() => {
      npT = null;
      txt.textContent = text;
      txt.classList.remove('is-out');
    }, 200);
  }

  function refreshNowPlaying() {
    if (!refs.np) return;
    if (!musicOn) { setNp('off'); return; }
    if (!musicStarted) { setNp(musicPlan ? 'ready' : musicFailed ? 'none' : 'loading'); return; }
    const np = mcall('nowPlaying');
    if (!np || !np.title) return;
    root?.classList.remove('is-music-na');
    noteTrack(np.trackId);
    npBpm = Number(np.bpm) || 0;
    const bpm = Math.round(npBpm);
    const text = `${np.title}${np.artist ? ` · ${np.artist}` : ''}${bpm ? ` · ${bpm} BPM` : ''}`;
    showNp(np.trackId || np.title, text);
  }

  /* ───────── Pulso a ritmo: el halo de la cifra respira con beatPhase (la cifra en sí nunca se escala: nítida) ───────── */
  function startBeat() {
    if (beatRaf || reducedMotion() || !musicOn || !musicStarted || !music || !root) return;
    root.classList.add('mu-beat');
    const frame = () => {
      beatRaf = 0;
      if (disposed || !music || !musicOn || !musicStarted) { stopBeat(); return; }
      let p = 0;
      if (cache.status === 'running' && document.visibilityState !== 'hidden') {
        const ph = Number(mcall('beatPhase'));
        // Envolvente de "golpe": máximo en el tiempo y caída rápida (0 exacto = el motor no tiene ritmo ahora)
        if (Number.isFinite(ph) && ph > 0) p = Math.exp(-clamp(ph, 0, 1) * 5.5);
      }
      const q = Math.round(p * 40) / 40;
      if (q !== lastPulse) {
        lastPulse = q;
        if (refs.speedGlow) refs.speedGlow.style.opacity = (0.26 + q * 0.3).toFixed(3);
        refs.np?.style.setProperty('--mu-pulse', String(q));
      }
      beatRaf = requestAnimationFrame(frame);
    };
    beatRaf = requestAnimationFrame(frame);
  }

  function stopBeat() {
    if (beatRaf) cancelAnimationFrame(beatRaf);
    beatRaf = 0;
    lastPulse = -1;
    root?.classList.remove('mu-beat');
    if (refs.speedGlow) refs.speedGlow.style.opacity = '';
    refs.np?.style.setProperty('--mu-pulse', '0');
  }

  /* ═════════════════ Escena 3D (§14, §14.1, §15) ═════════════════ */
  // Todo es opcional y está blindado: la API se comprueba método a método (typeof) para funcionar con la escena
  // actual y con versiones nuevas (setTheme, setGhost, setAnalyser…). Si algo falla, se vuelve al fondo 2D.
  function scall(fn, ...args) {
    if (!scene || typeof scene[fn] !== 'function') return undefined;
    try { return scene[fn](...args); } catch { return undefined; }
  }

  function sceneEvent(type, data = {}) {
    if (scene) scall('event', type, data || {});
  }

  function liveMounted() { return !!root && root.classList.contains('pl--live') && !!refs.world; }

  /**
   * Crea la escena en segundo plano; mientras carga (o si no puede) se ve el fondo 2D. Nunca lanza.
   * Desde la preparación se crea oculta (lienzo en un hueco invisible); al empezar, el lienzo se pasa al HUD.
   */
  function initScene() {
    if (scene) { attachScene(); return; }
    if (sceneP || sceneDead || disposed || visuals.quality === 'off') return;
    const host0 = liveMounted() ? refs.world : root?.querySelector('[data-pre-world]');
    if (!host0) return;
    sceneP = scene3dModP
      .then((mod) => {
        if (disposed || typeof mod?.createScene3D !== 'function') return null;
        if (typeof mod.isWebGLAvailable === 'function' && !mod.isWebGLAvailable()) return null;
        const canvas = document.createElement('canvas');
        canvas.className = 'pl-3d';
        canvas.setAttribute('aria-hidden', 'true');
        // Si mientras se descargaba three.js ya se pulsó Empezar, va directo al HUD
        const host = liveMounted() ? refs.world : host0;
        host.replaceChildren(canvas);
        sceneCanvas = canvas;
        canvas.addEventListener('webglcontextlost', onContextLost);
        canvas.addEventListener('webglcontextrestored', onContextRestored);
        const segs = engine ? engine.getSegments() : workout.segments;
        return mod.createScene3D(canvas, {
          workout: { ...workout, segments: segs },
          levels: getState().levels,
          quality: visuals.quality,
          reducedMotion: reducedMotion(),
          tvMode: tvOn,
          theme: (sceneThemeId = themePick().id),
          strideBob: visuals.strideBob !== false,
          treadmill: getState().treadmill || null,
          onError: () => sceneFail(),
          onMoment: (type, data) => onSceneMoment(type, data),
        });
      })
      .then((ctl) => {
        sceneP = null;
        if (!ctl || typeof ctl !== 'object') { sceneDead = true; dropCanvas(); return; }
        if (disposed || sceneDead) {
          try { ctl.destroy?.({ releaseContext: true }); } catch { /* nada */ }
          return;
        }
        scene = ctl;
        debugScene();
        // Se eligió otro escenario en Preparación mientras se creaba la escena: se cambia ya, aún oculta
        applySceneTheme();
        attachScene();
      })
      .catch(() => { sceneP = null; sceneFail(); });
  }

  /** Escena lista: en la preparación pinta ~1 s oculta (calienta el postproceso) y se para; en marcha, al HUD. */
  function attachScene() {
    if (!scene || disposed) return;
    cancel(preT);
    preT = null;
    if (!liveMounted()) {
      preT = later(() => { preT = null; if (!liveMounted()) scall('setRunning', false); }, 1200);
      return;
    }
    if (sceneCanvas && sceneCanvas.parentNode !== refs.world) refs.world.replaceChildren(sceneCanvas);
    if (sceneAttached) return;
    sceneAttached = true;
    scall('setRunning', true);
    scall('setTvMode', tvOn);
    scall('resize');
    setupScene();
  }

  /** Solo con ?debug3d=1: registra las llamadas a la escena en window.__brScene (verificación en el navegador). */
  function debugScene() {
    try {
      if (!/[?&]debug3d=1(?:&|$)/.test(globalThis.location?.search || '')) return;
      const log = { calls: [], counts: {}, scene, hudRects: () => collectHudRects() };
      for (const fn of ['setState', 'setBeat', 'event', 'setGhost', 'setAnalyser', 'setHudRects', 'setTvMode', 'setStrideBob', 'setTheme', 'setLayout', 'setRunning', 'resize', 'destroy']) {
        const orig = scene[fn];
        if (typeof orig !== 'function') continue;
        scene[fn] = (...args) => {
          log.counts[fn] = (log.counts[fn] || 0) + 1;
          if (fn !== 'setState' && fn !== 'setBeat') {
            log.calls.push({ fn, args: fn === 'setHudRects' ? [`${args[0]?.length} rects`] : args, t: Math.round(performance.now()), pos: sceneFeed?.s?.totalElapsed });
            if (log.calls.length > 300) log.calls.shift();
          }
          return orig.apply(scene, args);
        };
      }
      globalThis.__brScene = log;
    } catch { /* depuración opcional */ }
  }

  function setupScene() {
    // (el escenario ya llega en createScene3D({ theme }); si falló y el núcleo cayó a 'blank', no se reintenta aquí)
    // §15.3: nada de máscaras que recorten el fondo — los rectángulos del HUD son solo información de composición
    scall('setLayout', { dim: 0 });
    scall('setStrideBob', visuals.strideBob !== false);
    if (ghost) scall('setGhost', { trace: ghost.trace, label: ghost.label });
    if (engine) feedScene(engine.getState());
    lastAnalyser = undefined;
    syncAnalyser();
    computeDrops();
    pushHudRects();
    startSceneLoop();
    // Fundido de entrada cuando la escena ya pinta (dos fotogramas): el 2D queda debajo como respaldo
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!scene || disposed || !root) return;
      sceneOn = true;
      if (!sceneCanvas?.dataset.lost) root.classList.add('has-3d');
      scheduleHudRects();
    }));
  }

  /** Escenario de esta clase: elección de Preparación › preferencia de Perfil ('auto' = según el tipo de clase). */
  function themePick() {
    return resolveTheme(visuals.theme, workout, sessionTheme);
  }

  /** Lleva la escena (si existe) al escenario elegido; la API setTheme es asíncrona y nunca lanza aquí. */
  function applySceneTheme() {
    const id = themePick().id;
    if (!scene || id === sceneThemeId) return;
    sceneThemeId = id;
    try { Promise.resolve(scall('setTheme', id)).catch(() => {}); } catch { /* escena sin setTheme */ }
  }

  function sceneFail() {
    sceneDead = true;
    destroyScene();
  }

  /** Momentos de la escena: solo el aura de RÉCORD (halo dorado de la cifra). Nada de "golpes" ni destellos (§15). */
  function onSceneMoment(type, data) {
    if (disposed || !root) return;
    if (type === 'record') root.classList.toggle('is-record', !!data?.on);
  }

  function destroyScene() {
    stopSceneLoop();
    if (hudRaf) cancelAnimationFrame(hudRaf);
    hudRaf = 0;
    sceneOn = false;
    sceneAttached = false;
    root?.classList.remove('has-3d', 'is-lite');
    const s = scene;
    scene = null;
    if (s) { try { s.destroy({ releaseContext: true }); } catch { /* nada */ } }
    dropCanvas();
  }

  function dropCanvas() {
    const c = sceneCanvas;
    sceneCanvas = null;
    if (!c) return;
    c.removeEventListener('webglcontextlost', onContextLost);
    c.removeEventListener('webglcontextrestored', onContextRestored);
    c.remove();
  }

  // Contexto WebGL perdido (iOS lo hace con poca memoria): fondo 2D al instante; vuelve si se restaura
  function onContextLost() {
    if (sceneCanvas) sceneCanvas.dataset.lost = '1';
    root?.classList.remove('has-3d');
  }

  function onContextRestored() {
    if (sceneCanvas) delete sceneCanvas.dataset.lost;
    if (!scene || !sceneOn || !root) return;
    requestAnimationFrame(() => { if (scene && root && !disposed) root.classList.add('has-3d'); });
    scheduleHudRects();
  }

  /** Estado del motor → escena (cada tick, 4 Hz); se guarda también para interpolar en cada fotograma. */
  function feedScene(s) {
    sceneFeed = { s, at: performance.now() };
    if (!scene) return;
    scall('setState', {
      status: s.status,
      totalElapsed: s.totalElapsed,
      segIndex: s.segIndex,
      segElapsed: s.segElapsed,
      segRemaining: s.segRemaining,
      currentSpeed: s.currentSpeed,
      distanceKm: s.distanceKm,
    });
  }

  function startSceneLoop() {
    if (sceneRaf || !scene || disposed) return;
    sceneRaf = requestAnimationFrame(sceneLoop);
  }

  function stopSceneLoop() {
    if (sceneRaf) cancelAnimationFrame(sceneRaf);
    sceneRaf = 0;
  }

  /** Bucle por fotograma: beat de la música, cuentas atrás 3-2-1, drops, analizador y calidad. */
  function sceneLoop() {
    sceneRaf = 0;
    if (disposed || !scene) return;
    const t = performance.now();
    const f = sceneFeed;
    const running = f?.s?.status === 'running' && !countingDown && !finale;
    if (running) {
      const dt = Math.max(0, (t - f.at) / 1000);
      if (dt < 1.5) { // con datos viejos (JS suspendido) no se dispara nada
        momentCountdown(f.s, dt);
        checkDrops(f.s.totalElapsed + dt);
      }
      if (musicStarted && musicOn && music && npBpm > 0) {
        const ph = Number(mcall('beatPhase'));
        if (Number.isFinite(ph) && ph > 0) scall('setBeat', ph, npBpm);
      }
    }
    if (t - analyserAt > 1000) { analyserAt = t; syncAnalyser(); }
    if (t - sceneInfoAt > 2500) { sceneInfoAt = t; checkLite(); }
    sceneRaf = requestAnimationFrame(sceneLoop);
  }

  /** 'countdown' {n} a 3, 2 y 1 s de cada cambio de tramo (una vez por tramo y número). */
  function momentCountdown(s, dt) {
    if (!s.nextSegment) return;
    const n = Math.ceil(s.segRemaining - dt - 1e-3);
    if (n < 1 || n > 3) return;
    const k = `${s.segIndex}:${n}`;
    if (cdFired.has(k)) return;
    cdFired.add(k);
    sceneEvent('countdown', { n });
  }

  /** Instantes en que la mezcla cae en un drop justo al empezar un tramo (riser-drop o entrada en drop). */
  function computeDrops() {
    const out = [];
    for (const c of musicPlan?.cues || []) {
      if (!c || c.kind === 'intra' || c.change === 'none' || c.change === 'tempo') continue;
      if (c.transition !== 'riser-drop' && c.entry !== 'drop') continue;
      const at = Number(c.atSec);
      if (Number.isFinite(at) && at > 0.5) out.push(at);
    }
    dropTimes = [...new Set(out)].sort((a, b) => a - b);
    dropIdx = -1;
  }

  function checkDrops(pos) {
    if (!dropTimes.length || !musicStarted || !musicOn) { lastPred = pos; return; }
    // Tras un salto (⏭, reanudar tras suspensión) se reubica sin disparar el drop del punto de llegada
    if (dropIdx < 0 || Math.abs(pos - lastPred) > 2) {
      const i = dropTimes.findIndex((x) => x > pos + 0.05);
      dropIdx = i < 0 ? dropTimes.length : i;
    }
    while (dropIdx < dropTimes.length && pos >= dropTimes[dropIdx]) {
      if (pos - dropTimes[dropIdx] < 0.6) sceneEvent('drop');
      dropIdx++;
    }
    lastPred = pos;
  }

  /** Espectro real de la mezcla (§14.1-2): el AnalyserNode del motor DJ, o null sin música. */
  function syncAnalyser() {
    if (!scene || typeof scene.setAnalyser !== 'function') return;
    const a = musicOn && musicStarted && music ? mcall('getAnalyser') || null : null;
    if (a === lastAnalyser) return;
    lastAnalyser = a;
    scall('setAnalyser', a);
  }

  /** Calidad Ahorro (elegida o bajada automática): marca informativa para el CSS. */
  function checkLite() {
    const info = scall('getInfo');
    const lite = visuals.quality === 'eco' || info?.quality === 'eco';
    if (lite === sceneLite) return;
    sceneLite = lite;
    root?.classList.toggle('is-lite', lite);
  }

  /* ───────── Fantasma de tu mejor marca (§14.1-1) ───────── */
  /** Sesión completada de la misma plantilla y duración con más distancia y con speedTrace. */
  function findGhost() {
    try {
      const st = getState();
      if (st.visuals?.ghost === false || !workout?.templateId) return null;
      const mins = Number(workout.minutes) || parseWorkoutId(String(workout.id || ''))?.minutes || 0;
      let best = null;
      for (const h of Array.isArray(st.history) ? st.history : []) {
        if (!h || h.templateId !== workout.templateId || !h.completed) continue;
        const m = parseWorkoutId(String(h.workoutId || ''))?.minutes || Math.round((Number(h.plannedSec) || 0) / 60);
        if (mins && m !== mins) continue;
        if (!Array.isArray(h.speedTrace) || h.speedTrace.length < 2 || !(Number(h.distanceKm) > 0)) continue;
        if (!best || Number(h.distanceKm) > Number(best.distanceKm)) best = h;
      }
      if (!best) return null;
      const trace = [];
      for (const p of best.speedTrace) {
        const t = Number(p?.[0]);
        const v = Number(p?.[1]);
        if (Number.isFinite(t) && Number.isFinite(v) && t >= 0 && v >= 0) trace.push([t, v]);
      }
      if (trace.length < 2) return null;
      return {
        trace, base: trace, label: `Tu mejor marca · ${fmt.km(Number(best.distanceKm))} km`, km: Number(best.distanceKm), ...ghostCurve(trace),
      };
    } catch {
      return null;
    }
  }

  /** Distancia acumulada del fantasma en cada punto (velocidad constante hasta el siguiente cambio). */
  function ghostCurve(trace) {
    const times = [];
    const cum = [];
    let acc = 0;
    for (let i = 0; i < trace.length; i++) {
      if (i > 0) acc += (trace[i - 1][1] * Math.max(0, trace[i][0] - trace[i - 1][0])) / 3600;
      times.push(trace[i][0]);
      cum.push(acc);
    }
    return { times, cum };
  }

  /**
   * Tras saltar tramos (⏮/⏭, «No puedo más») el fantasma solo cuenta lo que tú corres de verdad: su distancia se
   * congela durante el salto. Se rehace su trace (hasta el punto de llegada a velocidad constante con la distancia que
   * llevaba, y desde ahí el suyo original) para que el chip del HUD y el holograma de la escena sigan siendo justos.
   */
  function rebaseGhost(pos0, pos1) {
    if (!ghost || !Number.isFinite(pos0) || !Number.isFinite(pos1) || Math.abs(pos1 - pos0) < 0.5) return;
    const ref = ghostKmAt(pos0);
    const base = ghost.base;
    let vAt = base[0][1];
    for (const p of base) { if (p[0] <= pos1) vAt = p[1]; else break; }
    const trace = pos1 > 0.5 ? [[0, (ref * 3600) / pos1], [pos1, vAt]] : [[0, vAt]];
    for (const p of base) if (p[0] > pos1) trace.push(p);
    if (trace.length < 2) trace.push([pos1 + 1, vAt]);
    ghost = { ...ghost, trace, ...ghostCurve(trace) };
    delete cache.ghostTxt;
    scall('setGhost', { trace, label: ghost.label });
  }

  function ghostKmAt(t) {
    const g = ghost;
    if (!g) return 0;
    const n = g.times.length;
    if (t >= g.times[n - 1]) return g.cum[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) { // último punto con time <= t
      const mid = (lo + hi + 1) >> 1;
      if (g.times[mid] <= t) lo = mid; else hi = mid - 1;
    }
    if (t < g.times[0]) return 0;
    return g.cum[lo] + (g.trace[lo][1] * (t - g.times[lo])) / 3600;
  }

  /** Chip «Récord ±m» bajo el ritmo; al pasar de ir detrás a ir delante, bug «RÉCORD +m» (máx. 1 cada 45 s). */
  function updateGhost(s) {
    const node = refs.ghost;
    if (!node) return;
    const show = !!ghost && (s.status === 'running' || s.status === 'paused') && s.totalElapsed >= 3;
    if (!show) {
      if (!node.hidden) { node.hidden = true; cache.ghostTxt = ''; scheduleHudRects(); }
      return;
    }
    const d = Math.round((s.distanceKm - ghostKmAt(s.totalElapsed)) * 1000);
    // «= tu récord» cuando vais a la par (nada de «RÉCORD +0 m», que parece un récord de 0 m)
    const even = Math.abs(d) < 3;
    const txt = even ? '=' : `${d > 0 ? '+' : '−'}${Math.abs(d)} m`;
    if (node.hidden) { node.hidden = false; scheduleHudRects(); }
    if (s.status === 'running') {
      if (d <= -5) ghostSide = -1;
      else if (d >= 5) {
        if (ghostSide === -1 && performance.now() - lastRecordBug > 45000) {
          lastRecordBug = performance.now();
          showBug({ lbl: 'Récord', val: `+${d} m`, color: GOLD, kind: 'record' });
          nb.record('overtake', d);
        }
        ghostSide = 1;
      }
      // Superas la distancia total de tu mejor marca (una vez): el reloj enseña «¡Récord!»
      if (!ghostBeaten && s.distanceKm > ghost.km) {
        ghostBeaten = true;
        nb.record('beaten', d);
      }
    }
    if (cache.ghostTxt === txt) return;
    cache.ghostTxt = txt;
    node.innerHTML = even
      ? `${icon('trophy', 12)}<b>=</b> <span class="hud-ghost__lbl">tu récord</span>`
      : `${icon('trophy', 12)}<b>${esc(txt)}</b> <span class="hud-ghost__lbl">vs récord</span>`;
    node.classList.toggle('is-ahead', d >= 3);
    node.classList.toggle('is-even', even);
  }

  /* ───────── Rectángulos del HUD para la escena (composición, §15.3) ───────── */
  function hudKind(n) {
    if (n.matches('.hud-bug, .hud-note, .mo-deck, .mo-cap')) return 'transient'; // aparecen y se van: no mueven la escena
    if (n.matches('.hud-speed__core')) return 'speed';
    if (n.matches('.hud-lt')) return 'segment';
    if (n.matches('.hud-ctl, .hud-tools, .hud-lockbar')) return 'controls';
    if (n.matches('.hud-top')) return 'top';
    return 'panel';
  }

  /** Rectángulos (px CSS, relativos al lienzo) de cada bloque visible del HUD: { x, y, w, h, r (radio), kind }
   *  (+ alias left/top/width/height/right/bottom). kind: 'top' | 'speed' | 'segment' | 'controls' | 'transient' | 'panel'. */
  function collectHudRects() {
    if (!root) return [];
    const base = (sceneCanvas || root).getBoundingClientRect();
    const sel = finale ? '.hud-done' : root.classList.contains('is-ctl') ? `${HUD_SEL}, ${CTL_SEL}` : HUD_SEL;
    const out = [];
    for (const n of root.querySelectorAll(sel)) {
      if (n.hidden || n.closest('[hidden]')) continue;
      const r = n.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const x = Math.round(r.left - base.left);
      const y = Math.round(r.top - base.top);
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      let rad = 0;
      try { rad = Math.min(w / 2, h / 2, parseFloat(getComputedStyle(n).borderTopLeftRadius) || 0); } catch { /* sin estilos */ }
      out.push({ x, y, w, h, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, r: Math.round(rad), kind: hudKind(n) });
    }
    return out;
  }

  function pushHudRects() {
    hudRaf = 0;
    if (!scene || disposed || typeof scene.setHudRects !== 'function') return;
    scall('setHudRects', collectHudRects());
  }

  function scheduleHudRects() {
    if (hudRaf || !scene || disposed) return;
    hudRaf = requestAnimationFrame(pushHudRects);
  }

  function observeHud() {
    if (typeof ResizeObserver !== 'function' || !root) return;
    try { hudRO?.disconnect(); } catch { /* nada */ }
    hudRO = new ResizeObserver(() => scheduleHudRects());
    for (const n of root.querySelectorAll(`.hud, ${HUD_SEL}, ${CTL_SEL}, .hud-speed`)) hudRO.observe(n);
    disposers.push(() => { try { hudRO?.disconnect(); } catch { /* nada */ } hudRO = null; });
  }

  function onViewport() {
    scall('resize');
    scheduleHudRects();
    // iOS asienta la rotación unos cientos de ms después: segunda medida
    cancel(vpTimer);
    vpTimer = later(() => { vpTimer = null; scall('resize'); scheduleHudRects(); }, 450);
  }

  /* ───────── Controles: ocultos mientras corres; un toque los muestra 4 s; siempre visibles en pausa (§16) ───────── */
  function ctlWanted() {
    // Con la hoja «Sonido» abierta los controles se recogen (no asoman cortados por encima de la hoja)
    if (!root || countingDown || finale || locked || cache.cdShow || snd) return false;
    if (cache.status !== 'running') return true;
    return Date.now() < ctlUntil;
  }

  function syncCtl() {
    if (!root) return;
    const on = ctlWanted();
    if (cache.ctl === on) return;
    const was = cache.ctl;
    cache.ctl = on;
    root.classList.toggle('is-ctl', on);
    // Modo TV recién activado: el aviso «toca para ver los controles» llega cuando se recogen (no encima de ellos)
    if (!on && was && tvHintPending && tvOn && cache.status === 'running') {
      tvHintPending = false;
      flashTvHint();
    }
    scheduleHudRects();
  }

  function showCtl(ms = CTL_MS) {
    ctlUntil = Date.now() + ms;
    syncCtl();
    cancel(ctlT);
    ctlT = later(() => { ctlT = null; syncCtl(); }, ms + 30);
  }

  function hideCtl() {
    ctlUntil = 0;
    cancel(ctlT);
    ctlT = null;
    syncCtl();
  }

  /* ───────── Bugs de retransmisión: entran deslizando arriba a la derecha 3 s y salen (§16) ───────── */
  // kind: 'rep' | 'stage' | 'km' | 'halfway' | 'record' | 'vam'. Un bug nuevo de un tipo sustituye a los de ese
  // tipo que esperaban y despide ya el que está en pantalla (tras ⏭ rápidos no se ven series que ya pasaron).
  function showBug({ lbl, val, sub = '', color = '', kind = '' }) {
    if (!refs.bugs || finale) return;
    if (kind) for (let i = bugQ.length - 1; i >= 0; i--) if (bugQ[i].kind === kind) bugQ.splice(i, 1);
    if (bugQ.length >= 3) bugQ.shift();
    bugQ.push({ lbl, val, sub, color, kind });
    if (!bugBusy) nextBug();
    else if (kind && bugCur?.kind === kind) bugCur.end();
  }

  /** Tras un salto: fuera los bugs (en cola o en pantalla) que hablan de un tramo que ya no es el actual. */
  function dropBugs(kinds) {
    for (let i = bugQ.length - 1; i >= 0; i--) if (kinds.includes(bugQ[i].kind)) bugQ.splice(i, 1);
    if (bugCur && kinds.includes(bugCur.kind)) bugCur.end();
  }

  function nextBug() {
    const b = bugQ.shift();
    bugCur = null;
    if (!b || !refs.bugs || disposed) { bugBusy = false; return; }
    bugBusy = true;
    const node = document.createElement('div');
    node.className = 'hud-bug';
    if (b.color) node.style.setProperty('--bc', b.color);
    // espacios entre los trozos: VoiceOver lee «Pirámide 1/7», no «Pirámide1/7» (en flex no se ven)
    node.innerHTML = `<i class="hud-bug__bar" aria-hidden="true"></i><span class="hud-bug__lbl">${esc(b.lbl)}</span> <b class="hud-bug__val num">${esc(String(b.val))}</b>${b.sub ? ` <span class="hud-bug__sub num">${esc(b.sub)}</span>` : ''}`;
    refs.bugs.replaceChildren(node);
    void node.offsetWidth;
    node.classList.add('is-on');
    scheduleHudRects();
    let ended = false;
    let holdT = null;
    const cur = {
      kind: b.kind,
      end() {
        if (ended) return;
        ended = true;
        cancel(holdT);
        if (bugCur === cur) bugCur = null;
        node.classList.remove('is-on');
        node.classList.add('is-off');
        later(() => {
          node.remove();
          scheduleHudRects();
          nextBug();
        }, reducedMotion() ? 0 : 380);
      },
    };
    bugCur = cur;
    holdT = later(() => cur.end(), BUG_MS);
  }

  /**
   * Avisos del reproductor en marcha: rótulo pequeño bajo los bugs (arriba a la derecha), sin desenfoque y sin tapar
   * nunca la barra superior ni la cifra (§15.3, §16). Fuera del HUD en marcha, el toast de siempre.
   * Devuelve una función que lo retira antes de tiempo.
   */
  function notify(message, { icon: ic = 'info', duration = 2600 } = {}) {
    const host = refs.notes;
    if (!host || !liveMounted() || finale || disposed) {
      const t = toast(message, { icon: ic, duration });
      return () => { try { t?.close?.(); } catch { /* nada */ } };
    }
    const node = document.createElement('div');
    node.className = 'hud-note';
    node.innerHTML = `<span class="hud-note__ic" aria-hidden="true">${icon(ic, 15, { stroke: 2.3 })}</span><span class="hud-note__msg">${esc(message)}</span>`;
    while (host.children.length >= 2) host.firstElementChild.remove();
    host.appendChild(node);
    void node.offsetWidth;
    node.classList.add('is-on');
    scheduleHudRects();
    let gone = false;
    const dismiss = () => {
      if (gone) return;
      gone = true;
      node.classList.remove('is-on');
      node.classList.add('is-off');
      later(() => { node.remove(); scheduleHudRects(); }, reducedMotion() ? 0 : 320);
    };
    later(dismiss, duration);
    return dismiss;
  }

  /** Línea fina que barre el lower third una vez (cambio de tramo): sustituye a cualquier destello (§15). */
  function sweep() {
    const n = refs.sweep;
    if (!n || reducedMotion()) return;
    n.classList.remove('is-on');
    void n.offsetWidth;
    n.classList.add('is-on');
  }

  /** Fondo 2D: fundido cruzado del tinte de zona entre dos capas (sin transiciones de propiedades personalizadas). */
  function setTint(color) {
    const a = refs[`tint${tint}`];
    if (!a || a.style.getPropertyValue('--tc') === color) return;
    const b = refs[`tint${1 - tint}`];
    if (!b) return;
    b.style.setProperty('--tc', color);
    b.classList.add('is-on');
    a.classList.remove('is-on');
    tint = 1 - tint;
  }

  /* ───────── Modo TV (§14, §16): aún más mínimo — velocidad, zona, cuenta atrás y siguiente ───────── */
  function applyTv() {
    if (!root) return;
    root.classList.toggle('is-tv', tvOn);
    for (const b of root.querySelectorAll('[data-act="tv"]')) {
      b.setAttribute('aria-pressed', String(tvOn));
      b.setAttribute('aria-label', tvOn ? 'Salir del modo TV' : 'Modo TV (AirPlay)');
    }
    scall('setTvMode', tvOn);
    scheduleHudRects();
  }

  // Solo para esta sesión: «Modo TV por defecto» de Ajustes no se toca desde el entreno
  function toggleTv() {
    tvOn = !tvOn;
    haptic('selection');
    applyTv();
    if (tvOn) {
      tvHintPending = true;
      if (!cache.ctl && cache.status === 'running') { tvHintPending = false; flashTvHint(); }
    } else {
      tvHintPending = false;
      hideTvHint();
      notify('Modo TV desactivado', { icon: 'info', duration: 1500 });
    }
  }

  function flashTvHint() {
    const h = refs.tvHint;
    if (!h) return;
    h.classList.add('is-on');
    cancel(tvHintT);
    tvHintT = later(() => { tvHintT = null; h.classList.remove('is-on'); }, 3600);
  }

  function hideTvHint() {
    cancel(tvHintT);
    tvHintT = null;
    refs.tvHint?.classList.remove('is-on');
  }

  function applyMusicButton() {
    const b = refs.musicBtn;
    root?.classList.toggle('is-music-off', appMusic && !musicOn);
    if (!b) return;
    b.setAttribute('aria-pressed', String(appMusic && musicOn));
    b.setAttribute('aria-label', !appMusic ? 'Modo Mi música' : musicOn ? 'Apagar música' : 'Encender música');
  }

  function toggleMusic() {
    haptic('selection');
    if (!appMusic) {
      notify('Modo «Mi música»: suena tu Spotify o Apple Music y el coach habla encima. Cámbialo en Perfil → Música', { icon: 'music', duration: 4200 });
      return;
    }
    musicOn = !musicOn; // solo este entreno (la preferencia vive en Perfil → Música)
    if (musicOn) {
      initMusic();
      try { audioMod?.ensureAudioRunning?.()?.catch?.(() => {}); } catch { /* sin audio */ }
      mcall('setEnabled', true);
      const st = engine?.getState().status;
      if (musicStarted) startBeat();
      else if (st === 'running') startMusic();
    } else {
      mcall('setEnabled', false);
      stopBeat();
    }
    applyMusicButton();
    coachCall('updateSettings', { music: musicOn });
    // con la música de la app apagada la sesión SIGUE en 'playback' (si no, el modo silencio callaría al coach)
    syncSession();
    refreshNowPlaying();
    notify(musicOn ? 'Música DJ activada' : 'Música apagada', { icon: 'music', duration: 1500 });
  }

  function keepAwake() {
    requestWakeLock().then((ok) => {
      // Reanudar desde la pantalla de bloqueo (página oculta) siempre falla: lo pedirá wakelock.js al volver a verse
      // En la app nativa la pantalla la mantiene encendida el iPhone (sin aviso)
      if (ok || wakeWarned || disposed || isNative() || document.visibilityState === 'hidden') return;
      wakeWarned = true;
      // Sin la API (p. ej. abierta por http en la red local, sin HTTPS): en CADA clase, porque con la pantalla
      // bloqueada iOS congela la app y la música se queda repitiendo frase o se corta
      const unsupported = !isWakeLockSupported();
      if (!unsupported) {
        // Con la API pero denegado: una vez por instalación (y un recordatorio al mes)
        let last = 0;
        try { last = Number(localStorage.getItem(WAKE_WARN_KEY)) || 0; } catch { /* sin almacenamiento */ }
        if (Date.now() - last < WAKE_WARN_EVERY_MS) return;
        try { localStorage.setItem(WAKE_WARN_KEY, String(Date.now())); } catch { /* idem */ }
      }
      const msg = unsupported
        ? 'Sin HTTPS la pantalla puede apagarse y cortar la música: abre BestRunning desde su web o pon el bloqueo automático en «Nunca»'
        : 'Tu iPhone podría apagar la pantalla: pon el bloqueo automático en «Nunca» mientras entrenas';
      later(() => notify(msg, { icon: 'info', duration: unsupported ? 6500 : 5200 }), countingDown ? 3600 : 0);
    }).catch(() => {});
  }

  function onStartTap() {
    if (engine) return;
    unlockAudioNow();
    const packId = getState().audio?.packId;
    if (packId) { try { audioMod?.loadPack?.(packId)?.catch?.(() => {}); } catch { /* sin pack */ } }
    keepAwake();
    haptic('medium');
    // La cuenta se marca ANTES de montar el HUD: así los controles nunca asoman (y se desvanecen) en el «3»
    countingDown = true;
    try {
      engine = createEngine(workout, callbacks);
      nb.prepare();
      initMusic();
      renderLive();
      cache.cdShow = true;
      applySegment(engine.getState(), { reason: 'ready', silent: true });
      update(engine.getState());
      ensureCoach();
      runCountdown(() => engine.start());
      // Cabecera de apertura durante el 3-2-1 (un toque la salta); el lower third con la cuenta sigue visible
      mo('intro', {
        title: workout.title || 'Entrenamiento',
        kicker: CAT_NAMES[workout.category] || 'Clase',
        meta: `${engine.getState().segCount} tramos · ${fmt.clock(engine.getState().totalSec || workout.totalSec || 0)}`,
        segments: engine.getSegments(),
      });
    } catch {
      // Nunca un «Empezar» muerto: se deshace el arranque y se vuelve a la preparación
      countingDown = false;
      try { engine?.destroy(); } catch { /* nada */ }
      engine = null;
      try { stopMusic(0); } catch { /* nada */ }
      musicPrepP = null;
      musicPlan = null;
      musicUnlocked = false;
      destroyScene();
      sceneDead = false;
      renderReady();
      toast('No se pudo empezar: vuelve a pulsar «Empezar»', { icon: 'warning', kind: 'warning' });
    }
  }

  function ensureCoach() {
    if (coach || !engine) return;
    const make = () => {
      if (coach || disposed || !engine) return;
      coach = makeCoach();
      // createCoach aplica los ajustes de audio y puede reescribir la sesión de audio: se restaura
      syncSession();
      const s = engine.getState();
      if (!coach) return;
      if (s.status === 'ready') lastCoachPos = 0;
      else { coachCall('seek', s.totalElapsed); lastCoachPos = s.totalElapsed; }
    };
    if (coachMod) make();
    else modsReady.then(make);
  }

  function makeCoach() {
    if (!coachMod?.createCoach || !engine) return null;
    try {
      const st = getState();
      const w = { ...workout, segments: engine.getSegments() };
      const c = coachMod.createCoach(w, {
        ...(st.audio || {}),
        name: st.profile?.name || '',
        announceLead: Number(st.treadmill?.announceLead) || 10,
        watchReminder: st.integrations?.watchReminder !== false && !nb.watchManaged(),
        // Comentarios de música (flow/energía) solo mientras suena la mezcla de la app
        music: appMusic && musicOn,
        // Subtítulos de retransmisión (motion.js): la frase que dice el coach, en una línea sobre el lower third
        onCue: (cue) => { if (cue?.text && !CAP_SKIP.has(cue.kind) && !CAP_NUM.test(cue.text)) mo('caption', cue.text); },
      });
      try { c?.setMuted?.(muted); } catch { /* idem */ }
      return c || null;
    } catch {
      return null;
    }
  }

  function coachCall(fn, ...args) {
    try { return coach?.[fn]?.(...args); } catch { return undefined; }
  }

  function doBeep(kind) {
    if (muted || getState().audio?.beeps === false) return;
    try { audioMod?.beep?.(kind); } catch { /* sin audio */ }
  }

  /** Cuenta de salida 3-2-1-¡Ya! DENTRO del lower third: cifras con corte limpio, sin capas a pantalla completa (§16). */
  function runCountdown(onDone, from = 3) {
    if (!refs.goNum || !root) { countingDown = false; onDone(); return; }
    countingDown = true;
    cache.cdShow = true;
    const s = engine.getState();
    const speed = fmt.speed(s.segment?.speed || 0);
    const phase = s.status === 'ready' ? 'start' : 'resume';
    refs.goLbl.textContent = s.status === 'ready' ? 'Empezamos' : 'Seguimos';
    refs.goHint.textContent = s.status === 'ready' ? 'Pon la cinta a' : 'Vuelve a poner la cinta a';
    refs.goSpeed.textContent = `${speed} km/h`;
    root.classList.add('is-cd');
    hideTvHint();
    syncCtl();
    // Un solo origen t0 (el mismo instante en que el coach programa su «3, 2, 1» en el reloj de audio): cada cifra y
    // su pitido caen en t0 + k s aunque una tarea larga retrase un temporizador (sin deriva acumulada)
    const t0 = performance.now();
    coachCall('say', 'countdown', { n: from, speed });
    let n = from;
    let k = 0;
    const step = () => {
      if (disposed || !root) return;
      const go = refs.goNum;
      go.textContent = n > 0 ? String(n) : '¡Ya!';
      go.classList.toggle('is-go', n <= 0);
      // Reloj: 3-2-1 con el instante del «¡Ya!» (el primero lo fija)
      try { nb.countdown(n, phase, k === 0 ? Date.now() + n * 1000 : null); } catch { /* sin puente */ }
      if (n > 0) {
        sceneEvent('countdown', { n });
        doBeep('tick');
        timerHaptic('light');
        n--;
        k++;
        later(step, Math.max(0, t0 + k * 1000 - performance.now()));
      } else {
        doBeep('go');
        timerHaptic('heavy');
        countingDown = false;
        onDone();
        later(() => {
          cache.cdShow = false;
          root?.classList.remove('is-cd');
          syncCtl();
          scheduleHudRects();
        }, reducedMotion() ? 300 : 800);
      }
    };
    step();
  }

  /** Línea de tiempo reloj → clase (watch-hr.js la usa para alinear el pulso y descartar las pausas). */
  function mark(running, classSec, at = Date.now()) {
    const pos = Number.isFinite(classSec) ? classSec : engine ? engine.getState().totalElapsed : 0;
    timeline.push([Math.round(at), Math.round(pos * 10) / 10, running ? 1 : 0]);
    if (timeline.length > 800) timeline.splice(1, timeline.length - 800);
  }

  /** Tramo saltado hacia delante (⏭, «No puedo más») en tiempo de clase. */
  function noteSkip(from, to) {
    if (!(to - from >= 1)) return;
    skips.push([Math.round(from * 10) / 10, Math.round(to * 10) / 10]);
    if (skips.length > 200) skips.shift();
  }

  /* ═════════════════ Callbacks del motor ═════════════════ */
  function onTick(s) {
    if (disposed) return;
    lastUiTick = Date.now();
    // Un fallo de la UI nunca deja mudos al coach ni al DJ (cada parte va aislada)
    try { update(s); } catch (err) { reportOnce(err); }
    if (s.status === 'running' && !suppressCoach) {
      try { coachTick(s); } catch (err) { reportOnce(err); }
      // Durante un salto (skip / «No puedo más») la música se reubica después con musicSeek
      try { musicTick(s); } catch (err) { reportOnce(err); }
      guardSession();
    }
    try { nb.tick(s); } catch (err) { reportOnce(err); }
  }

  function reportOnce(err) {
    if (tickErr) return;
    tickErr = true;
    try { console.error('[player] tick', err); } catch { /* nada */ }
  }

  function coachTick(s) {
    if (!coach) return;
    const pos = s.totalElapsed;
    const d = lastCoachPos == null ? 0 : pos - lastCoachPos;
    if (d < -0.75) {
      coachCall('seek', pos);
    } else {
      // update() del coach tolera saltos grandes (JS suspendido): sólo dice el último cambio si sigue vigente
      coachCall('update', pos);
      if (d > 6 && s.segment) {
        notify(`Ahora: ${zoneName(s.segment.zone)} · ${fmt.speed(s.currentSpeed)} km/h`, { icon: 'bolt' });
      }
    }
    lastCoachPos = pos;
  }

  function onSegment(s, info) {
    if (disposed) return;
    const prevRep = cache.repKey;
    const relay = !info?.silent && info?.reason !== 'adjust';
    if (relay) mo('beforeSegment');
    applySegment(s, info);
    if (relay) mo('afterSegment', info || {});
    if (!info?.silent) {
      sweep();
      const prev = cache.segSpeed;
      const up = prev != null && s.currentSpeed > prev;
      timerHaptic(s.segment?.zone === 'sprint' || (up && s.currentSpeed - prev >= 1.5) ? 'heavy' : 'medium');
      // Bug «SERIE 3/8» al empezar cada repetición (no en el arranque ni al restaurar)
      const rep = s.segment?.rep;
      if (rep?.n > 1 && info?.reason !== 'restart' && cache.repKey !== prevRep && !(workout.isTest && s.inTestStage)) {
        const b = blockLabel(s.segment.block);
        showBug({ lbl: b && b !== 'Serie' ? b : 'Serie', val: `${rep.i}/${rep.n}`, kind: 'rep' });
      }
    }
    cache.segSpeed = s.currentSpeed;
    try { nb.segment(s, info || {}); } catch (err) { reportOnce(err); }
    persist();
  }

  function onEvent(type, data) {
    if (disposed) return;
    forwardToScene(type, data);
    try { nb.event(type, data || {}); } catch (err) { reportOnce(err); }
    if (type === 'km' && !data?.silent) {
      coachCall('say', 'km', { km: data.km, pace: data.pace });
      showBug({ lbl: 'KM', val: data.km, sub: data.pace ? `${data.pace} /km` : '', kind: 'km' });
    } else if (type === 'halfway') {
      if (performance.now() - testEndAt > 2500) {
        // la mitad de la clase (no la posición de llegada tras un ⏭) y la distancia que llevas de verdad
        const s = engine?.getState();
        const half = Math.round((s?.totalSec || workout.totalSec || 0) / 2);
        showBug({ lbl: 'Mitad', val: fmt.clock(half), sub: s ? `${fmt.km(s.distanceKm)} km` : '', color: '#ffffff', kind: 'halfway' });
      }
    } else if (type === 'pause') {
      mark(false);
      setPlaybackState('paused');
      syncPosition();
      if (!quietPause) coachCall('say', 'pause', {});
      if (musicStarted) { mcall('pause'); stopBeat(); }
      if (snd) armSoundIdle(); // en pausa la hoja «Sonido» no se recoge sola
      persist();
    } else if (type === 'resume') {
      mark(true);
      setPlaybackState('playing');
      syncPosition();
      const s = engine.getState();
      if (coach) {
        coachCall('seek', s.totalElapsed);
        lastCoachPos = s.totalElapsed;
        if (!quietPause) coachCall('say', 'resume', { speed: fmt.speed(s.currentSpeed) });
      }
      if (musicStarted) {
        mcall('resume');
        lastMusicPos = s.totalElapsed;
        startBeat();
      } else startMusic();
      if (snd) armSoundIdle();
      keepAwake();
    } else if (type === 'start') {
      mark(true);
      setPlaybackState('playing');
      syncPosition();
      startMusic();
      later(maybeSoundHint, 2600);
    } else if (type === 'finish') {
      onFinished(data && data.status ? data : engine.getState());
    }
  }

  /** Eventos del motor → momentos de la escena 3D (tramos, KM, MITAD, test, pausa…). */
  function forwardToScene(type, data) {
    const d = data || {};
    if (type === 'segment') {
      const idx = Number(d.index);
      for (let n = 1; n <= 3; n++) cdFired.delete(`${idx}:${n}`);
      if (d.silent) return;
      const stage = Number(d.segment?.stage);
      const testStage = workout.isTest && stage > 0 && d.reason !== 'restart';
      if (testStage) showBug({ lbl: 'Escalón', val: stage, kind: 'stage' });
      if (!scene) return;
      sceneEvent('segment', { index: idx, reason: d.reason || 'auto' });
      if (testStage) sceneEvent('testStage', { stage });
    } else if (type === 'km') {
      if (!d.silent) sceneEvent('km', { km: d.km });
    } else if (type === 'halfway') {
      if (performance.now() - testEndAt > 2500) sceneEvent('halfway');
    } else if (type === 'pause' || type === 'resume') {
      sceneEvent(type);
    } else if (type === 'testEnd') {
      testEndAt = performance.now();
      sceneEvent('testEnd', { test: d.test || null });
    } else if (type === 'adjust') {
      sceneEvent('adjust', { speed: d.speed, delta: d.delta });
    }
  }

  /* ═════════════════ Actualización de la UI ═════════════════ */
  function setText(key, value) {
    if (cache[key] === value || !refs[key]) return;
    cache[key] = value;
    refs[key].textContent = value;
  }

  function setHtml(key, value) {
    if (cache[`h:${key}`] === value || !refs[key]) return;
    cache[`h:${key}`] = value;
    refs[key].innerHTML = value;
  }

  function setVar(name, value) {
    if (cache[name] === value || !root) return;
    cache[name] = value;
    root.style.setProperty(name, value);
  }

  /** Barras (scaleX) con caché: solo se escriben cuando cambian (compositor, sin layout). */
  function setScale(key, v) {
    const n = refs[key];
    const q = Math.round(clamp(v, 0, 1) * 1000) / 1000;
    if (!n || cache[`s:${key}`] === q) return;
    cache[`s:${key}`] = q;
    n.style.transform = `scaleX(${q})`;
  }

  function applySegment(s, info = {}) {
    if (!root || !s.segment) return;
    const seg = s.segment;
    const next = s.nextSegment;
    const zc = zoneColor(seg.zone);
    root.dataset.zone = seg.zone;
    setVar('--zc', zc);
    setVar('--nc', zoneColor(next?.zone || seg.zone));
    // §15.3: la etiqueta de zona lleva SIEMPRE el color exacto de su zona (también escrito en el propio nodo)
    if (refs.zoneBox && cache.zoneColor !== zc) { cache.zoneColor = zc; refs.zoneBox.style.color = zc; }
    setTint(zc);

    // Reinicia la barra del tramo sin animarla hacia atrás
    const fill = refs.segFill;
    if (fill && info.reason !== 'adjust') {
      fill.classList.add('is-reset');
      cache['s:segFill'] = -1;
      setScale('segFill', s.segment.sec ? clamp(s.segElapsed / s.segment.sec, 0, 1) : 0);
      void fill.offsetWidth;
      requestAnimationFrame(() => fill.classList.remove('is-reset'));
    }

    setText('zoneName', (seg.label || zoneName(seg.zone)).toUpperCase());
    const pos = `${s.segIndex + 1}/${s.segCount}`;
    // «Tramo 6/18» · «Serie 3/8 · 6/18» · «Escalera 2 · 9/18» (el paso dentro del bloque lo cuenta su bug) · test.
    // El bloque no repite el título de la clase («PIRÁMIDE · Pirámide 1» → «PIRÁMIDE · Serie 1/7 · 4/18»).
    let sub = `Tramo ${pos}`;
    const blk = blockLabel(seg.block);
    if (seg.stage && workout.isTest) sub = `Escalón ${seg.stage} · ${pos}`;
    else if (seg.rep?.n) {
      sub = blk && blk !== 'Serie' && !sameText(blk, workout.title)
        ? `${blk} · ${pos}`
        : `Serie ${seg.rep.i}/${seg.rep.n} · ${pos}`;
    }
    setText('sub', sub);
    cache.repKey = seg.rep?.n ? `${seg.block || ''}:${seg.rep.i}/${seg.rep.n}` : '';
    setText('incline', seg.incline > 0 ? `${fmt.dec1(seg.incline)} %` : '');

    renderHr(seg);

    renderNext(s);

    const inStage = !!s.inTestStage;
    root.classList.toggle('is-test-stage', inStage);
    const tb = root.querySelector('.hud-test');
    if (tb && tb.hidden !== !inStage) { tb.hidden = !inStage; scheduleHudRects(); }

    syncNowPlaying(seg);
    syncPosition();
  }

  /** Pantalla de bloqueo / Centro de control / «Ahora suena» del Watch: zona y velocidad del tramo en curso. */
  function syncNowPlaying(seg) {
    if (!seg) return;
    setNowPlaying({
      title: workout.title || 'BestRunning',
      subtitle: `${zoneName(seg.zone)} · ${fmt.speed(seg.speed)} km/h`,
      artwork,
    });
  }

  /**
   * FC del HUD: con la app nativa y el reloj, tu pulso en directo (lectura de hace ≤ 15 s) y su zona de FC; si no,
   * el rango objetivo del tramo (lo de siempre en Safari).
   */
  function renderHr(seg = engine?.getState().segment) {
    if (!root || !refs.hr) return;
    const live = nb.liveHr();
    if (live) {
      const p = getState().profile || {};
      let z = 0;
      try { z = hrZoneOf(live.bpm, p); } catch { z = 0; }
      setText('hrZone', z ? `Z${z}` : '');
      setText('hr', String(Math.round(live.bpm)));
      let color = '';
      try { color = hrZones(p.hrMax || hrMaxFromAge(p.age || 46), p.hrRest)[z - 1]?.color || ''; } catch { color = ''; }
      if (cache.hrColor !== color) { cache.hrColor = color; refs.hrZone?.style.setProperty('--hz', color); }
      cache.hrZoneKey = '';
    } else if (seg && (cache.hrLive || cache.hrZoneKey !== seg.zone)) {
      try {
        const hr = hrTargetForZone(seg.zone, getState().profile || {});
        setText('hrZone', `Z${hr.zone}`);
        setText('hr', `${hr.min}–${hr.max}`);
      } catch { setText('hrZone', ''); setText('hr', '–'); }
      cache.hrZoneKey = seg.zone;
    }
    const on = !!live;
    if (cache.hrLive !== on) {
      cache.hrLive = on;
      refs.hr.closest('.hud-m--hr')?.classList.toggle('is-live', on);
    }
  }

  /** «Siguiente» del lower third (también tras un ajuste de velocidad, que puede cambiar el tramo siguiente). */
  function renderNext(s) {
    if (!refs.next || !s.segment) return;
    const seg = s.segment;
    const next = s.nextSegment;
    let arrowHtml;
    let lbl;
    let txt;
    let diff = 0;
    if (next) {
      diff = next.speed - seg.speed;
      const arrow = diff > 0.05 ? 'arrow-up' : diff < -0.05 ? 'arrow-down' : null;
      arrowHtml = arrow ? icon(arrow, 14, { stroke: 2.8 }) : '<span class="hud-lt__eq">=</span>';
      lbl = `Siguiente · ${fmt.clock(next.sec)}`;
      // nombre y velocidad por separado: si no cabe, se recorta el nombre, nunca la cifra que pones en la cinta
      // Test VAM: el siguiente escalón se nombra como tal («Escalón 5 · 9,5»), no por su zona
      const nm = workout.isTest && Number(next.stage) > 0 ? `Escalón ${next.stage}` : ZONES[next.zone]?.short || zoneName(next.zone);
      txt = `<span class="hud-lt__nn">${esc(nm)}</span> <b class="hud-lt__ns">${esc(fmt.speed(next.speed))}</b>`;
    } else {
      arrowHtml = icon('flag', 13, { stroke: 2.4 });
      lbl = 'Último tramo';
      txt = '<span class="hud-lt__nn">¡A por el final!</span>';
    }
    setHtml('nextArrow', arrowHtml);
    setText('nextLbl', lbl);
    setHtml('nextTxt', txt);
    refs.next.classList.toggle('is-up', diff > 0.05);
    refs.next.classList.toggle('is-down', diff < -0.05);
    refs.next.classList.toggle('is-last', !next);
  }

  function update(s) {
    if (!root) return;
    if (cache.status !== s.status) {
      cache.status = s.status;
      root.dataset.status = s.status;
      const label = s.status === 'running' ? 'Pausar' : s.status === 'paused' ? 'Reanudar' : 'Empezar';
      refs.toggle?.setAttribute('aria-label', label);
      // Al arrancar o reanudar, los controles se recogen; en pausa se quedan
      if (s.status === 'running') ctlUntil = 0;
      // En pausa el aviso «Mantén pulsado ♪…» (solo tiene sentido corriendo) taparía el rótulo «En pausa»
      if (s.status === 'paused' && sndHintOff) { sndHintOff(); sndHintOff = null; }
      syncCtl();
    }
    feedScene(s);
    // «Transcurrido» = lo que has corrido de verdad (activeSec): ⏭ y «No puedo más» no lo inflan. «Restante» = lo que
    // queda de clase desde aquí. La posición en la clase sigue en la línea de progreso y en el cursor del perfil.
    const ran = Number.isFinite(s.activeSec) ? s.activeSec : s.totalElapsed;
    setText('elapsed', fmt.clock(Math.floor(ran + 1e-6)));
    setText('remaining', `−${fmt.clock(Math.ceil(s.totalRemaining - 1e-6))}`);
    setScale('topFill', s.progress);
    const seg = s.segment;
    if (seg) {
      setScale('segFill', seg.sec ? s.segElapsed / seg.sec : 0);
      const left = Math.ceil(s.segRemaining - 1e-6);
      setRoll('segLeft', fmt.clock(left));
      const final = s.status === 'running' && left <= 3 && !!s.nextSegment;
      const soon = s.status === 'running' && left <= 10 && !!s.nextSegment;
      if (cache.final !== final) {
        cache.final = final;
        refs.segLeft?.classList.toggle('is-final', final);
      }
      if (cache.soon !== soon) {
        cache.soon = soon;
        refs.next?.classList.toggle('is-soon', soon);
      }
      const sp = fmt.speed(s.currentSpeed);
      if (cache.speed !== sp) {
        setRoll('speed', sp);
        if (refs.speedGlow) refs.speedGlow.textContent = sp;
      }
      setText('pace', fmtPaceKmh(s.currentSpeed || seg.speed));
      const a = s.adjustments?.[seg.zone];
      setText('adjBadge', a ? `${a > 0 ? '+' : '−'}${fmt.speed(Math.abs(a))}` : '');
    }
    setText('km', fmt.km(s.distanceKm));
    setText('kcal', fmt.int(s.kcal));
    if (seg) renderHr(seg);
    updateGhost(s);
    updateProfile(s);
    mo('tick', s);
  }

  /** Como setText, pero con cifras rodantes (motion.js) si el módulo está; el texto del nodo es siempre el valor. */
  function setRoll(key, value) {
    if (cache[key] === value || !refs[key]) return;
    cache[key] = value;
    if (mo('roll', refs[key], value) !== true) refs[key].textContent = value;
  }

  /** Pantalla de bloqueo / Centro de control: en pausa la barra se detiene (playbackRate 0). */
  function syncPosition() {
    if (!engine) return;
    const s = engine.getState();
    setPosition(s.totalElapsed, s.totalSec, s.status === 'running' ? 1 : 0);
  }

  /* ═════════════════ Interacción ═════════════════ */
  function onLiveClick(e) {
    if (locked || countingDown || finale) return;
    const b = e.target.closest('[data-act]');
    if (!b) {
      // Toque en cualquier hueco: muestra/oculta los controles mientras corres
      if (cache.status === 'running' && !e.target.closest('button, a, input, .pl-lock, .hud-done')) {
        if (cache.ctl) hideCtl();
        else { showCtl(); haptic('light'); }
      }
      return;
    }
    const act = b.dataset.act;
    // Soltar el dedo tras la pulsación larga de ♪ (que ya abrió «Sonido») no apaga la música
    if (act === 'music' && performance.now() - sndHeldAt < 1200) { sndHeldAt = -1e9; return; }
    if (cache.status === 'running' && act !== 'toggle') showCtl();
    if (act === 'toggle') onToggle();
    else if (act === 'tv') toggleTv();
    else if (act === 'prev') doSkip(-1);
    else if (act === 'next') doSkip(1);
    else if (act === 'exit') onExit();
    else if (act === 'lock') setLocked(true);
    else if (act === 'mute') toggleMute(b);
    else if (act === 'music') toggleMusic();
    else if (act === 'list') openStructure();
    else if (act === 'endtest') doEndTest();
  }

  function onToggle() {
    if (!engine) return;
    const s = engine.getState();
    if (s.status === 'running') {
      engine.pause();
      haptic('medium');
      return;
    }
    if (s.status === 'finished') return;
    unlockAudioNow();
    initMusic();
    keepAwake();
    ensureCoach();
    haptic('medium');
    if (s.status === 'ready') {
      runCountdown(() => engine.start());
    } else if (needsCountdown) {
      needsCountdown = false;
      runCountdown(() => engine.resume());
    } else {
      engine.resume();
    }
  }

  /** ⏮ / ⏭. fromCmd (orden del reloj): sin diálogos ni avisos; devuelve false si no se pudo saltar. */
  function doSkip(dir, fromCmd = false) {
    if (!engine || countingDown) return false;
    const s0 = engine.getState();
    if (s0.status !== 'running' && s0.status !== 'paused') return false;
    if (s0.inTestStage) {
      if (!fromCmd) notify('Durante el test, aguanta o pulsa «No puedo más»', { icon: 'gauge' });
      return false;
    }
    if (dir > 0 && s0.segIndex >= s0.segCount - 1) {
      if (fromCmd) return false; // el reloj pregunta él («¿Terminar ya?») y manda end
      if (confirmOpen) return false; // un solo diálogo aunque se pulse ⏭ varias veces
      confirmOpen = true;
      confirmDialog({
        title: '¿Terminar ya?',
        message: 'Es el último tramo. Guardaremos lo que llevas hecho.',
        confirmText: 'Terminar',
        cancelText: 'Seguir',
      }).then((yes) => { confirmOpen = false; if (yes && engine && !disposed) engine.finish(); }, () => { confirmOpen = false; });
      return false;
    }
    // Los bugs de la serie que dejas atrás ya no son actuales (el del tramo nuevo, si lo hay, llega con el salto)
    dropBugs(['rep', 'stage']);
    suppressCoach = true;
    const done = engine.skip(dir);
    suppressCoach = false;
    if (!done) return false;
    const s = engine.getState();
    if (s.status === 'finished') return true;
    if (dir > 0) noteSkip(s0.totalElapsed, s.totalElapsed);
    mark(s.status === 'running', s.totalElapsed);
    rebaseGhost(s0.totalElapsed, s.totalElapsed);
    // Reposiciona y anuncia el tramo nuevo ("¡Ahora! Correr rápido, 11,5…")
    coachCall('seek', s.totalElapsed, { announce: s.status === 'running' });
    lastCoachPos = s.totalElapsed;
    musicSeek(s);
    doBeep('go');
    haptic('light');
    return true;
  }

  function doEndTest() {
    if (!engine) return false;
    const pos0 = engine.getState().totalElapsed;
    suppressCoach = true;
    const done = engine.endTest();
    suppressCoach = false;
    if (!done) return false;
    const s = engine.getState();
    noteSkip(pos0, s.totalElapsed);
    mark(s.status === 'running', s.totalElapsed);
    rebaseGhost(pos0, s.totalElapsed);
    coachCall('seek', s.totalElapsed);
    lastCoachPos = s.totalElapsed;
    musicSeek(s);
    const vam = s.test?.vam;
    coachCall('say', 'testEnd', { vam: vam ? fmt.speed(vam) : '', speed: s.test?.lastStageSpeed ?? '', stage: s.test?.stage ?? '' });
    timerHaptic('heavy');
    doBeep('done');
    dropBugs(['stage']);
    if (vam) showBug({ lbl: 'VAM', val: fmt.speed(vam), sub: 'km/h', color: '#7D7AFF', kind: 'vam' });
    notify('¡Test terminado! Ahora, vuelta a la calma', { icon: 'gauge', duration: 4200 });
    return true;
  }

  function doAdjust(dir) {
    if (!engine || countingDown) return false;
    const s0 = engine.getState();
    if (s0.inTestStage || (s0.status !== 'running' && s0.status !== 'paused')) return false;
    if (s0.status === 'running') showCtl();
    const changed = engine.adjustSpeed(dir * 0.1);
    if (!changed) {
      haptic('warning');
      const n = refs.speed;
      if (n && !reducedMotion()) { n.classList.remove('is-shake'); void n.offsetWidth; n.classList.add('is-shake'); }
      return false;
    }
    haptic('selection');
    renderProfile();
    renderNext(engine.getState());
    syncNowPlaying(engine.getState().segment);
    cancel(adjustTimer);
    adjustTimer = later(() => {
      // Reconstruye el coach con las velocidades nuevas para que los pre-avisos digan la cifra correcta
      const s = engine.getState();
      if (coach) {
        coachCall('destroy');
        coach = makeCoach();
        coachCall('seek', s.totalElapsed);
        lastCoachPos = s.totalElapsed;
      }
      coachCall('say', 'adjust', { speed: fmt.speed(s.currentSpeed) });
      persist();
    }, 1300);
    return true;
  }

  function bindHold(btn, fn) {
    let delayT = null;
    let repeatT = null;
    let pressed = false;
    const stop = () => {
      pressed = false;
      clearTimeout(delayT);
      clearInterval(repeatT);
      delayT = repeatT = null;
      btn.classList.remove('is-pressed');
    };
    btn.addEventListener('pointerdown', (e) => {
      if (locked || countingDown || e.button > 0) return;
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
      pressed = true;
      btn.classList.add('is-pressed');
      if (!fn()) return;
      delayT = setTimeout(() => {
        let count = 0;
        repeatT = setInterval(() => {
          if (!pressed || !fn()) { stop(); return; }
          count++;
          // Acelera tras unos cuantos pasos
          if (count === 6) { clearInterval(repeatT); repeatT = setInterval(() => { if (!pressed || !fn()) stop(); }, 80); }
        }, 150);
      }, 420);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, stop);
    // Teclado / VoiceOver (click sin puntero)
    btn.addEventListener('click', (e) => { if (e.detail === 0) fn(); });
    disposers.push(stop);
  }

  /** Coach en silencio / activo. b = el botón (null desde el reloj: se busca el del HUD). */
  function toggleMute(b) {
    muted = !muted;
    coachCall('setMuted', muted);
    // En la app nativa la clase nunca usa la voz del sistema (coach.js): ni se toca, que suena en el proceso de la app
    if (muted && !isNative()) { try { window.speechSynthesis?.cancel?.(); } catch { /* nada */ } }
    root?.classList.toggle('is-muted', muted);
    const btn = b || root?.querySelector('[data-act="mute"]');
    btn?.setAttribute('aria-pressed', String(muted));
    btn?.setAttribute('aria-label', muted ? 'Activar coach' : 'Silenciar coach');
    haptic('selection');
    notify(muted ? 'Coach en silencio' : 'Coach activado', { icon: muted ? 'speaker-off' : 'speaker', duration: 1600 });
  }

  /* ───────── Hoja «Sonido»: mantener ♪ → música y voz del coach en vivo (se guarda en Perfil) ───────── */
  // Un toque en ♪ sigue encendiendo/apagando la música; mantenerlo SND_HOLD_MS (anillo que se llena + tic) abre una
  // hoja compacta y opaca (sin desenfoque, §15.3) con dos barras grandes. Se aplica al instante (music.setVolume y el
  // volumen de la voz/pitidos) y se guarda en los mismos ajustes que Perfil → Música y Perfil → Voz y audio.
  function bindSoundHold() {
    const btn = refs.musicBtn;
    if (!btn) return;
    let holdT = null;
    let pid = null;
    let x0 = 0;
    let y0 = 0;
    let fired = false;
    const stop = () => {
      clearTimeout(holdT);
      holdT = null;
      pid = null;
      btn.classList.remove('is-holding');
    };
    btn.addEventListener('pointerdown', (e) => {
      if (locked || countingDown || finale || e.button > 0 || e.isPrimary === false) return;
      stop();
      fired = false;
      pid = e.pointerId;
      x0 = e.clientX;
      y0 = e.clientY;
      btn.classList.add('is-holding');
      holdT = setTimeout(() => {
        holdT = null;
        btn.classList.remove('is-holding');
        if (locked || countingDown || finale || disposed) return;
        fired = true;
        sndHeldAt = performance.now();
        haptic('medium');
        openSound();
      }, SND_HOLD_MS);
    });
    btn.addEventListener('pointermove', (e) => {
      if (holdT && e.pointerId === pid && Math.hypot(e.clientX - x0, e.clientY - y0) > 12) stop();
    });
    for (const ev of ['pointerup', 'pointercancel']) {
      btn.addEventListener(ev, (e) => {
        if (e.pointerId !== pid) return;
        // la ventana que ignora el clic de soltar cuenta desde que levantas el dedo (aunque mantengas varios segundos)
        if (fired) sndHeldAt = performance.now();
        stop();
      });
    }
    // iOS: el clic sintético al levantar el dedo caería en el fondo de la hoja recién abierta (y la cerraría)
    btn.addEventListener('touchend', (e) => { if (fired) { fired = false; if (e.cancelable) e.preventDefault(); } }, { passive: false });
    // Ratón y teclado: botón derecho o tecla de menú contextual → la misma hoja
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!locked && !countingDown && !finale) openSound();
    });
    disposers.push(stop);
  }

  function soundRowHtml(kind, label, ic, pct, min, tag) {
    const id = `pl-snd-${kind}`;
    const low = label.toLowerCase();
    return `<div class="mu-snd__row" data-snd="${kind}">
      <div class="mu-snd__head">
        <span class="mu-snd__lbl" id="${id}-l">${icon(ic, 17)}<span>${esc(label)}</span>${tag ? `<em class="mu-snd__tag">${esc(tag)}</em>` : ''}</span>
        <b class="mu-snd__val num" data-snd-val aria-hidden="true">${pct} %</b>
      </div>
      <div class="mu-snd__ctl no-drag">
        <button type="button" class="mu-snd__step" data-snd-step="-1" aria-label="Bajar ${esc(low)}">${icon('minus', 20, { stroke: 2.6 })}</button>
        <input class="mu-snd__bar" id="${id}" type="range" min="${min}" max="100" step="1" value="${pct}" style="--f:${((pct - min) / (100 - min)).toFixed(3)}" aria-labelledby="${id}-l" aria-valuetext="${pct} %">
        <button type="button" class="mu-snd__step" data-snd-step="1" aria-label="Subir ${esc(low)}">${icon('plus', 20, { stroke: 2.6 })}</button>
      </div>
    </div>`;
  }

  function openSound() {
    if (snd || disposed || finale || !root) return;
    soundHintDone();
    if (sndHintOff) { sndHintOff(); sndHintOff = null; }
    refs.musicBtn?.classList.remove('is-hint');
    const st = getState();
    const a = st.audio || {};
    const rows = [];
    if (appMusic) rows.push(soundRowHtml('music', 'Música', 'music', sndPct(st.music?.volume, 0.8, 0), 0, musicOn ? '' : 'Apagada'));
    rows.push(soundRowHtml('voice', 'Voz del coach', 'speaker', sndPct(a.volume, 1, 10), 10,
      muted ? 'En silencio' : a.voiceEnabled === false ? 'Solo pitidos' : ''));
    const note = appMusic ? 'Se guarda para tus próximas clases' : 'Con «Mi música», su volumen va con los botones del iPhone';
    snd = openSheet({
      title: 'Sonido',
      cls: 'mu-snd',
      html: `<div class="mu-snd__rows">${rows.join('')}</div><p class="mu-snd__note">${esc(note)}</p>`,
      onMount: (el) => {
        el.querySelectorAll('.mu-snd__row').forEach((row) => bindSoundRow(row));
        // Cualquier toque o tecla en la hoja aplaza su cierre automático
        el.addEventListener('pointerdown', () => armSoundIdle(), true);
        el.addEventListener('keydown', () => armSoundIdle(), true);
      },
      onClose: () => {
        snd = null;
        cancel(sndIdleT);
        sndIdleT = null;
        flushSound();
        syncCtl();
      },
    });
    if (!snd?.el) { snd = null; return; }
    syncCtl();
    armSoundIdle();
  }

  function closeSound() {
    const s = snd;
    if (!s) return;
    try { s.close(); } catch { snd = null; }
  }

  /** Corriendo, la hoja se recoge sola tras SND_IDLE_MS sin tocarla (vuelven los datos); en pausa se queda. */
  function armSoundIdle() {
    cancel(sndIdleT);
    sndIdleT = null;
    if (!snd || engine?.getState().status !== 'running') return;
    sndIdleT = later(() => {
      sndIdleT = null;
      if (snd?.el?.querySelector('.mu-snd__row.is-active, .mu-snd__step.is-pressed')) armSoundIdle();
      else closeSound();
    }, SND_IDLE_MS);
  }

  function bindSoundRow(row) {
    const kind = row.dataset.snd;
    const bar = row.querySelector('.mu-snd__bar');
    const val = row.querySelector('[data-snd-val]');
    if (!bar || (kind !== 'music' && kind !== 'voice')) return;
    const min = Number(bar.min) || 0;
    const max = Number(bar.max) || 100;
    let cur = clamp(Number(bar.value) || 0, min, max);
    const paint = () => {
      bar.value = String(cur);
      bar.style.setProperty('--f', ((cur - min) / (max - min)).toFixed(3));
      bar.setAttribute('aria-valuetext', `${cur} %`);
      if (val) val.textContent = `${cur} %`;
      row.classList.toggle('is-min', cur <= min);
      row.classList.toggle('is-max', cur >= max);
    };
    /** Fija el valor (0..100), lo aplica ya y lo guarda (con retardo mientras arrastras). Devuelve si cambió. */
    const set = (v, commit = false) => {
      const n = clamp(Math.round(Number(v) || 0), min, max);
      const changed = n !== cur;
      if (changed) {
        // tic al cruzar cada 10 % y al tocar un extremo
        if (Math.floor(n / 10) !== Math.floor(cur / 10) || n === min || n === max) haptic('selection');
        cur = n;
        paint();
        applySound(kind, n);
        armSoundIdle(); // también con VoiceOver (deslizar arriba/abajo no pasa por pointerdown ni keydown)
      }
      if (commit) flushSound();
      else if (changed) scheduleSoundSave();
      return changed;
    };
    paint();
    // Arrastre RELATIVO en toda la barra (como el Centro de control): tocar no salta de valor, deslizar sube o baja.
    // Sin arrastre nativo (iOS solo deja coger el pulgar) ni desplazamiento ni cierre de la hoja.
    let pid = null;
    let x0 = 0;
    let v0 = 0;
    let w = 1;
    let moved = false;
    bar.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    bar.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || pid != null) return;
      e.preventDefault();
      pid = e.pointerId;
      x0 = e.clientX;
      v0 = cur;
      moved = false;
      w = Math.max(1, bar.getBoundingClientRect().width);
      try { bar.setPointerCapture(pid); } catch { /* sin captura */ }
      row.classList.add('is-active');
    });
    bar.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      const dx = e.clientX - x0;
      if (!moved && Math.abs(dx) < 4) return;
      moved = true;
      set(v0 + (dx / w) * (max - min));
    });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      row.classList.remove('is-active');
      flushSound();
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) bar.addEventListener(ev, end);
    // Teclado y VoiceOver (deslizar arriba/abajo): el control nativo cambia el valor
    bar.addEventListener('input', () => set(bar.value));
    bar.addEventListener('change', () => set(bar.value, true));
    // − / +: de 5 en 5 (al múltiplo de 5 más cercano), con repetición al mantener
    row.querySelectorAll('[data-snd-step]').forEach((b) => {
      const dir = Number(b.dataset.sndStep) > 0 ? 1 : -1;
      bindHold(b, () => {
        const next = dir > 0 ? Math.floor(cur / SND_STEP) * SND_STEP + SND_STEP : Math.ceil(cur / SND_STEP) * SND_STEP - SND_STEP;
        return set(next);
      });
      b.addEventListener('pointerup', () => flushSound());
    });
  }

  /** Aplica al momento: la música por el motor DJ (curva de volGain, §11.4); la voz y los pitidos por el coach. */
  function applySound(kind, pct) {
    sndPend = sndPend || {};
    if (kind === 'music') {
      const v = clamp(pct, 0, 100) / 100;
      sndPend.music = v;
      mcall('setVolume', v);
    } else {
      const v = clamp(pct, 10, 100) / 100;
      sndPend.voice = v;
      if (coach) coachCall('updateSettings', { volume: v });
      else { try { audioMod?.applyAudioSettings?.({ volume: v }); } catch { /* sin audio */ } }
    }
  }

  function scheduleSoundSave() {
    cancel(sndSaveT);
    sndSaveT = later(() => { sndSaveT = null; flushSound(); }, SND_SAVE_MS);
  }

  /** Guarda en Perfil (state.music.volume y state.audio.volume) lo aplicado desde la hoja. */
  function flushSound() {
    cancel(sndSaveT);
    sndSaveT = null;
    const p = sndPend;
    sndPend = null;
    if (!p) return;
    storageOk(() => setState((d) => {
      if (p.music != null) {
        if (!d.music || typeof d.music !== 'object') d.music = {};
        d.music.volume = Math.round(p.music * 100) / 100;
      }
      if (p.voice != null) {
        if (!d.audio || typeof d.audio !== 'object') d.audio = {};
        d.audio.volume = Math.round(p.voice * 100) / 100;
      }
    }));
  }

  /* Descubrimiento: en las SND_HINT_CLASSES primeras clases, al arrancar, un aviso señala ♪ (controles a la vista y
     ♪ que late); deja de salir en cuanto se usa la hoja. */
  function soundHintDone() {
    try { localStorage.setItem(SND_HINT_KEY, String(SND_HINT_CLASSES)); } catch { /* sin almacenamiento */ }
  }

  function maybeSoundHint() {
    if (!appMusic || !musicOn || musicFailed || locked || finale || snd || !liveMounted()) return;
    if (engine?.getState().status !== 'running') return;
    let n = 0;
    try { n = Number(localStorage.getItem(SND_HINT_KEY)) || 0; } catch { return; }
    if (n >= SND_HINT_CLASSES) return;
    try { localStorage.setItem(SND_HINT_KEY, String(n + 1)); } catch { return; }
    const ms = 5200;
    showCtl(ms);
    const b = refs.musicBtn;
    if (b && !reducedMotion()) {
      b.classList.remove('is-hint');
      void b.offsetWidth;
      b.classList.add('is-hint');
      later(() => b.classList.remove('is-hint'), ms);
    }
    // En horizontal el aviso caería sobre la fila ⏮ ⏯ ⏭: basta con el ♪ que late
    const land = typeof matchMedia === 'function' && matchMedia('(orientation: landscape) and (max-height: 620px)').matches;
    if (!land) sndHintOff = notify('Mantén pulsado ♪ para subir la música', { icon: 'music', duration: ms });
  }

  /* ───────── Bloqueo de pantalla: el candado ocupa el sitio de los controles; el resto del HUD sigue visible ───────── */
  function setLocked(on) {
    locked = on;
    if (on) closeSound();
    const ov = refs.lock;
    if (!ov || !root) return;
    ov.hidden = !on;
    root.classList.toggle('is-locked', on);
    if (!on && cache.status === 'running') showCtl(1600);
    else syncCtl();
    scheduleHudRects();
    haptic(on ? 'medium' : 'success');
  }

  function bindUnlock() {
    const ov = refs.lock;
    const btn = refs.unlockBtn;
    if (!ov || !btn) return;
    let holdT = null;
    const stopHold = () => {
      clearTimeout(holdT);
      holdT = null;
      btn.classList.remove('is-holding');
    };
    btn.addEventListener('pointerdown', (e) => {
      if (!locked) return;
      e.preventDefault();
      e.stopPropagation();
      try { btn.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
      btn.classList.add('is-holding');
      haptic('light');
      holdT = setTimeout(() => { stopHold(); setLocked(false); }, 1000);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, stopHold);
    btn.addEventListener('click', (e) => { e.stopPropagation(); if (e.detail === 0 && locked) setLocked(false); });
    // Cualquier otro toque mientras está bloqueado: aviso suave
    ov.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const h = refs.lockHint;
      if (h && !reducedMotion()) { h.classList.remove('is-nudge'); void h.offsetWidth; h.classList.add('is-nudge'); }
      haptic('light');
    });
    disposers.push(stopHold);
  }

  /* ───────── Estructura ───────── */
  function openStructure() {
    const segs = engine ? engine.getSegments() : workout.segments;
    const cur = engine ? engine.getState().segIndex : 0;
    let t = 0;
    const rows = segs.map((sg, i) => {
      const start = t;
      t += sg.sec;
      const cls = i === cur ? 'is-current' : i < cur ? 'is-done' : '';
      const rep = sg.rep?.n > 1 ? ` <small>${sg.rep.i}/${sg.rep.n}</small>` : '';
      return `<li class="pl-struct__row ${cls}" style="--zc:${zoneColor(sg.zone)}">
        <span class="pl-struct__bar"></span>
        <span class="pl-struct__time num">${fmt.clock(start)}</span>
        <span class="pl-struct__lbl">${esc(sg.label || zoneName(sg.zone))}${rep}</span>
        <span class="pl-struct__speed num">${fmt.speed(sg.speed)}</span>
        <span class="pl-struct__dur num">${fmt.clock(sg.sec)}</span>
      </li>`;
    }).join('');
    openSheet({
      title: 'Estructura de la clase',
      large: true,
      html: `<ol class="pl-struct">${rows}</ol>`,
      onMount: (sheetEl) => {
        try { sheetEl.querySelector('.pl-struct__row.is-current')?.scrollIntoView({ block: 'center' }); } catch { /* nada */ }
      },
    });
  }

  /* ───────── Salir ───────── */
  async function onExit() {
    if (!engine) { back('#/today'); return; }
    const s = engine.getState();
    if (s.status === 'ready') {
      engine.destroy();
      engine = null;
      back('#/today');
      return;
    }
    if (s.status === 'finished') return;
    const wasRunning = s.status === 'running';
    quietPause = true;
    if (wasRunning) engine.pause();
    quietPause = false;
    haptic('light');
    let choice = null;
    try {
      choice = await actionSheet({
        title: '¿Terminar entrenamiento?',
        options: [
          { label: 'Guardar y salir', value: 'save', icon: 'check' },
          { label: 'Descartar', value: 'discard', icon: 'trash', destructive: true },
          { label: 'Seguir entrenando', value: 'continue', icon: 'play' },
        ],
      });
    } catch { choice = 'continue'; }
    if (disposed || !engine) return;
    if (choice === 'save') {
      engine.finish();
      return;
    }
    if (choice === 'discard') {
      let sure = false;
      try {
        sure = await confirmDialog({
          title: '¿Descartar la sesión?',
          message: 'No se guardará nada de este entrenamiento.',
          confirmText: 'Descartar',
          cancelText: 'Cancelar',
          destructive: true,
        });
      } catch { sure = false; }
      if (disposed || !engine) return;
      if (sure) { discard(); return; }
    }
    if (wasRunning && engine.getState().status === 'paused') {
      quietPause = true;
      engine.resume();
      quietPause = false;
    }
  }

  function discard() {
    discarded = true;
    nb.discard('user');
    saveActiveSession(null);
    teardownRuntime();
    haptic('warning');
    navigate('#/today', { replace: true });
  }

  /* ───────── Final ───────── */
  function onFinished(s) {
    if (finishedHandled) return;
    finishedHandled = true;
    closeSound();
    clearInterval(snapTimer);
    const st = getState();
    if ((s.activeSec || 0) < MIN_SAVE_SEC) {
      nb.discard('short');
      saveActiveSession(null);
      stopMusic(1);
      teardownRuntime();
      toast('Sesión demasiado corta: esta vez no la guardamos', { icon: 'info' });
      navigate('#/today', { replace: true });
      return;
    }
    const session = buildSession(workout, s, { levels: st.levels, planDate, startedAt: s.startedAt });
    // Campos de la fase 2 (§12, §13): el pulso lo añade luego el resumen con el Atajo del Watch
    for (const k of ['hrMin', 'hrSeries', 'hrZones']) if (session[k] === undefined) session[k] = null;
    session.music = { tracks: playedTracks(s.totalElapsed) };
    // Fin anticipado, tiempo saltado, rangos saltados y línea de tiempo (progresión, perfil «Real» y pulso del Watch)
    mark(false, s.totalElapsed);
    session.finishedEarly = !!s.finishedEarly;
    session.skippedSec = Math.round(Number(s.skippedSec) || 0);
    session.skips = skips.map((g) => [g[0], g[1]]);
    session.timeline = timeline.map((e) => [e[0], e[1], e[2]]);
    // Fin real y tiempo en pausa: el Atajo del Watch busca el pulso en esa ventana (watch-hr.js)
    const endMs = Date.now();
    const startMs = Date.parse(session.startedAt || '');
    session.endedAt = new Date(endMs).toISOString();
    session.pausedSec = Number.isFinite(startMs)
      ? Math.max(0, Math.round((endMs - startMs) / 1000 - (Number(session.elapsedSec) || 0)))
      : 0;
    // App nativa: el pulso que el reloj ha mandado en directo (mismo cálculo que el Atajo); en Safari, nada
    try { Object.assign(session, nb.hrFields(session, st.profile || {})); } catch { /* sin pulso */ }
    // 'playback' hasta que acabe la frase final (el fundido de la música devolvería la sesión a 'auto')
    sessionHoldUntil = performance.now() + SESSION_HOLD_MS;
    stopMusic(3);
    // Una sesión ya guardada (reapertura tras un fallo de almacenamiento que luego se recuperó) no se duplica
    const dup = (Array.isArray(st.history) ? st.history : [])
      .some((h) => h && h.workoutId === session.workoutId && h.startedAt === session.startedAt);
    const saved = dup || storageOk(() => setState((d) => {
      if (!Array.isArray(d.history)) d.history = [];
      d.history.push(session);
    }));
    if (saved) saveActiveSession(null);
    else {
      // Sin espacio: la instantánea (ya terminada) se conserva para guardarla al volver a abrir la app
      try {
        saveActiveSession({
          ...engine?.snapshot?.(), workoutId: workout.id, planDate, musicTracks: musicTracks.slice(),
          skips: skips.slice(), timeline: timeline.slice(), hrLive: nb.samples(),
          title: workout.title || '', savedAt: Date.now(), updatedAt: new Date().toISOString(),
        });
      } catch { /* queda la última instantánea */ }
      toast('No hay espacio para guardar este entreno. Lo guardaremos al volver a abrir la app: libera espacio en el iPhone', { icon: 'warning', kind: 'warning', duration: 9000 });
    }
    nb.finish(session, { saved });
    coachCall('say', 'finish', { km: fmt.km(session.distanceKm), min: Math.round(session.elapsedSec / 60), completed: !!session.completed });
    doBeep('done');
    timerHaptic('success');
    releaseWakeLock();
    clearNowPlaying();
    // Plano final sobrio de la escena (~3 s) mientras el rótulo final resume la sesión
    sceneEvent('finish', { durationMs: FINISH_MS });
    showDone(session);
  }

  /** Rótulo final (mismo lenguaje que el lower third); un toque en cualquier sitio salta al resumen. */
  function showDone(session) {
    const ov = refs.done;
    const go = () => {
      if (disposed || leaving) return;
      leaving = true;
      teardownRuntime({ keepCoach: true });
      navigate(`#/summary/${encodeURIComponent(session.id)}`, { replace: true });
    };
    if (!ov || !root) { go(); return; }
    root.dataset.status = 'finished';
    cache.status = 'finished';
    finale = true;
    bugQ.length = 0;
    root.classList.add('is-finale');
    syncCtl();
    const scenic = !!scene && sceneOn && root.classList.contains('has-3d');
    const title = session.completed ? '¡Entrenamiento completado!' : '¡Buen trabajo!';
    ov.innerHTML = `
      <div class="hud-done__ring" aria-hidden="true">
        <svg class="hud-done__circ" viewBox="0 0 48 48"><circle class="hud-done__track" cx="24" cy="24" r="21"></circle><circle class="hud-done__prog" cx="24" cy="24" r="21" pathLength="100"></circle></svg>
        ${icon('check', 22, { stroke: 3 })}
      </div>
      <div class="hud-done__txt">
        <span class="hud-lbl">${esc(workout.title || 'Entrenamiento')}</span>
        <b class="hud-done__title">${esc(title)}</b>
        <span class="hud-done__stats num">${fmt.km(session.distanceKm)} km · ${fmt.clock(session.elapsedSec)} · ${fmt.int(session.kcal)} kcal</span>
        ${recordHtml(session)}
      </div>
      <button class="hud-done__btn" data-done-go>Ver resumen</button>
      <span class="hud-done__skip">Toca la pantalla para saltar</span>`;
    ov.hidden = false;
    // Cierre (motion.js): recuento de distancia/tiempo/kcal y el perfil que se llena en los colores de zona
    mo('outro', ov, {
      km: session.distanceKm, sec: session.elapsedSec, kcal: session.kcal,
      final: { km: fmt.km(session.distanceKm), sec: fmt.clock(session.elapsedSec), kcal: fmt.int(session.kcal) },
      segments: engine?.getSegments?.() || workout.segments || [],
    });
    scheduleHudRects();
    // El listener llega tarde a propósito: el toque que terminó la sesión no lo salta
    later(() => root?.addEventListener('click', go, { once: true }), 300);
    ov.querySelector('[data-done-go]')?.addEventListener('click', go, { once: true });
    later(go, scenic ? FINISH_MS : FINISH_2D_MS);
  }

  /** «¡Nuevo récord en esta clase!» si superas la distancia de tu mejor marca (el fantasma). */
  function recordHtml(session) {
    if (!ghost || !(Number(session?.distanceKm) > ghost.km)) return '';
    const m = Math.round((Number(session.distanceKm) - ghost.km) * 1000);
    if (m < 1) return '';
    return `<span class="hud-done__rec">${icon('trophy', 13)}<span>Nuevo récord en esta clase · <b class="num">+${m} m</b></span></span>`;
  }

  /* ───────── Persistencia y ciclo de vida ───────── */
  /** Instantánea para retomar. force (pagehide / segundo plano): se intenta aunque el almacenamiento fallara hace poco. */
  function persist(force = false) {
    if (!engine || discarded || finishedHandled || disposed) return;
    const s = engine.getState();
    if (s.status !== 'running' && s.status !== 'paused') return;
    // Almacenamiento lleno: se reintenta cada minuto (no un aviso cada 5 s durante todo el entreno)
    if (force !== true && Date.now() - storageBadAt < STORAGE_RETRY_MS) return;
    const ok = storageOk(() => saveActiveSession({
      ...engine.snapshot(),
      workoutId: workout.id,
      planDate,
      musicTracks: musicTracks.slice(),
      skips: skips.slice(),
      timeline: timeline.slice(),
      sceneTheme: sessionTheme,
      hrLive: nb.samples(),
      title: workout.title || '',
      savedAt: Date.now(),
      updatedAt: new Date().toISOString(),
    }));
    storageBadAt = ok ? -1e9 : Date.now();
  }

  function onVisibility() {
    if (!engine) return;
    if (document.visibilityState === 'hidden') {
      persist(true);
    } else if (engine.getState().status === 'running') {
      // Al volver, el motor recupera el tiempo perdido y procesa los cambios cruzados
      engine.tick();
      if (Date.now() - lastUiTick > 1500) update(engine.getState());
    }
  }

  function teardownRuntime({ keepCoach = false } = {}) {
    clearInterval(snapTimer);
    cancel(adjustTimer);
    stopMusic(1);
    releaseSession();
    try { engine?.destroy(); } catch { /* nada */ }
    if (!keepCoach) { coachCall('destroy'); coach = null; }
    releaseWakeLock();
    clearNowPlaying();
    try { unbindMedia(); } catch { /* nada */ }
  }

  function cleanup() {
    if (disposed) return;
    persist();
    closeSound();
    flushSound();
    disposed = true;
    destroyScene();
    mo('destroy');
    motion = null;
    for (const id of timers) clearTimeout(id);
    timers.clear();
    clearInterval(snapTimer);
    for (const d of disposers.splice(0)) { try { d(); } catch { /* nada */ } }
    try { engine?.destroy(); } catch { /* nada */ }
    if (beatRaf) cancelAnimationFrame(beatRaf);
    beatRaf = 0;
    stopMusic(0.6);
    releaseSession();
    // Deja terminar la frase final del coach antes de destruirlo
    const c = coach;
    coach = null;
    if (c) {
      if (finishedHandled) setTimeout(() => { try { c.destroy?.(); } catch { /* nada */ } }, 6000);
      else { try { c.destroy?.(); } catch { /* nada */ } }
    }
    releaseWakeLock();
    clearNowPlaying();
  }
}
