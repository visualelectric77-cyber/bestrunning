// BestRunning · Media Session: información en pantalla de bloqueo / Centro de control y mandos (auriculares).

const ms = () => (typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null);
const ACTIONS = ['play', 'pause', 'nexttrack', 'previoustrack', 'stop', 'seekbackward', 'seekforward', 'seekto'];

function setHandler(action, fn) {
  try { ms()?.setActionHandler(action, fn); } catch { /* acción no soportada */ }
}

/** artwork opcional: [{ src, sizes, type }] (p. ej. un data URL del logo dibujado en canvas). */
export function setNowPlaying({ title = 'BestRunning', subtitle = '', artwork = null } = {}) {
  const m = ms();
  if (!m || typeof MediaMetadata === 'undefined') return;
  try {
    m.metadata = new MediaMetadata({
      title: String(title || 'BestRunning'),
      artist: String(subtitle || ''),
      album: 'BestRunning',
      artwork: Array.isArray(artwork) ? artwork : [],
    });
  } catch { /* metadatos no soportados */ }
}

/** Devuelve una función que desvincula los mandos. */
export function bindMediaControls({ onPlay = null, onPause = null, onNext = null, onPrev = null } = {}) {
  if (!ms()) return () => {};
  setHandler('play', onPlay ? () => onPlay() : null);
  setHandler('pause', onPause ? () => onPause() : null);
  setHandler('nexttrack', onNext ? () => onNext() : null);
  setHandler('previoustrack', onPrev ? () => onPrev() : null);
  return () => { for (const a of ['play', 'pause', 'nexttrack', 'previoustrack']) setHandler(a, null); };
}

export function setPlaybackState(state /* 'playing'|'paused'|'none' */) {
  const m = ms();
  if (!m) return;
  try { m.playbackState = state; } catch { /* sin soporte */ }
}

/** Barra de progreso del Centro de control (segundos). rate 0 = en pausa (la barra se detiene); 1 = avanza. */
export function setPosition(positionSec, durationSec, rate = 1) {
  const m = ms();
  if (!m?.setPositionState || !(durationSec > 0)) return;
  const playbackRate = rate === 0 ? 0 : 1;
  const position = Math.min(Math.max(0, Number(positionSec) || 0), durationSec);
  try {
    m.setPositionState({ duration: durationSec, position, playbackRate });
  } catch {
    // algún motor antiguo rechaza playbackRate 0: al menos la posición queda bien
    try { m.setPositionState({ duration: durationSec, position, playbackRate: 1 }); } catch { /* valores no válidos */ }
  }
}

export function clearNowPlaying() {
  const m = ms();
  if (!m) return;
  for (const a of ACTIONS) setHandler(a, null);
  try { m.metadata = null; } catch { /* nada */ }
  try { m.playbackState = 'none'; } catch { /* nada */ }
  try { m.setPositionState?.(); } catch { /* nada */ }
}
