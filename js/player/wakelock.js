// BestRunning · mantener la pantalla encendida durante el entrenamiento (Screen Wake Lock API).
// iOS suspende el JS con la pantalla apagada: sin wake lock el coach dejaría de hablar.

let sentinel = null;
let wanted = false;
let listening = false;
let pending = null;

export function isWakeLockSupported() {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator && typeof navigator.wakeLock?.request === 'function';
}

/** Un sentinel liberado por el sistema (pantalla oculta, batería) ya no vale aunque su 'release' llegue tarde. */
const held = () => !!sentinel && !sentinel.released;

async function acquire() {
  if (!isWakeLockSupported()) return false;
  if (held()) return true;
  if (pending) return pending;
  sentinel = null;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
  pending = navigator.wakeLock.request('screen')
    .then((s) => {
      sentinel = s;
      s.addEventListener?.('release', () => { if (sentinel === s) sentinel = null; });
      // Si nos pidieron soltarlo mientras se adquiría
      if (!wanted) { s.release?.().catch(() => {}); sentinel = null; }
      return true;
    })
    .catch(() => false)
    .finally(() => { pending = null; });
  return pending;
}

let recheckT = 0;
function onVisibility() {
  if (!wanted || document.visibilityState !== 'visible') return;
  if (!held()) acquire();
  // El orden de 'visibilitychange'/'pageshow' y del 'release' del sistema no está garantizado: se comprueba otra vez
  clearTimeout(recheckT);
  recheckT = setTimeout(() => {
    if (wanted && document.visibilityState === 'visible' && !held()) acquire();
  }, 500);
}

/** Pide el wake lock (llamar en un gesto del usuario la primera vez). Devuelve true si se obtuvo. */
export async function requestWakeLock() {
  wanted = true;
  if (!listening && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener?.('pageshow', onVisibility);
    listening = true;
  }
  try {
    return await acquire();
  } catch {
    return false;
  }
}

export async function releaseWakeLock() {
  wanted = false;
  if (listening && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener?.('pageshow', onVisibility);
    listening = false;
  }
  clearTimeout(recheckT);
  const s = sentinel;
  sentinel = null;
  try { if (s && !s.released) await s.release?.(); } catch { /* ya liberado */ }
}

/** true si ahora mismo hay un wake lock activo. */
export function hasWakeLock() {
  return held();
}
