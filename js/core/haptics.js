// BestRunning · vibración háptica. Nunca lanza excepciones.
// · App nativa de iPhone (build 6+, su native.hello trae caps: ['haptic']): los generadores de iOS de verdad
//   (UIImpactFeedbackGenerator, UISelectionFeedbackGenerator, UINotificationFeedbackGenerator) por el puente:
//   BRNative.post('haptic', { style }). Ver native/BestRunning/Feedback/Haptics.swift.
// · Safari en iOS 18+ (y builds nativas anteriores): un <input type="checkbox" switch> oculto dentro de un <label>
//   produce el "tic" del sistema al hacer label.click().
// · Otros navegadores: navigator.vibrate.

// Tipos (los estilos de iOS). native = estilo que entiende la app (Wire.hapticStyles en native/Shared/Wire.swift);
// taps/gap = nº de tics del interruptor en Safari iOS y separación en ms; vibrate = patrón de navigator.vibrate.
const PATTERNS = {
  light: { native: 'light', taps: 1, gap: 0, vibrate: 10 },
  selection: { native: 'selection', taps: 1, gap: 0, vibrate: 6 },
  medium: { native: 'medium', taps: 1, gap: 0, vibrate: 18 },
  heavy: { native: 'heavy', taps: 2, gap: 45, vibrate: 30 },
  soft: { native: 'soft', taps: 1, gap: 0, vibrate: 8 },
  rigid: { native: 'rigid', taps: 1, gap: 0, vibrate: 14 },
  success: { native: 'success', taps: 2, gap: 110, vibrate: [14, 70, 20] },
  warning: { native: 'warning', taps: 2, gap: 160, vibrate: [22, 90, 22] },
  error: { native: 'error', taps: 3, gap: 90, vibrate: [25, 60, 25, 60, 25] },
};

// Nombres con intención → tipo. Para pantallas nuevas: dicen qué pasa y aquí se decide cómo se siente.
const SEMANTIC = {
  tap: 'light', //          pulsar un botón, una fila, una tarjeta
  select: 'selection', //   cambiar un valor: segmentado, stepper, pestaña, rueda, chip
  toggle: 'light', //       interruptor
  sheet: 'soft', //         una hoja que se abre o se encaja
  countdown: 'rigid', //    cada cifra del 3-2-1
  go: 'heavy', //           «¡Ya!»: empieza la clase
  segment: 'medium', //     cambio de tramo
  sprint: 'heavy', //       cambio a sprint o subida fuerte
  record: 'success', //     récord batido, objetivo cumplido
  done: 'success', //       guardado, completado
  destructive: 'warning', // confirmar borrar o descartar
  fail: 'error', //         algo no se pudo hacer
};

const MIN_GAP_MS = 35; // evita ráfagas (la app nativa, además, como mucho 25 por segundo)

let label = null;
let lastAt = 0;
let nativeHaptics = false;
const timers = new Set();

/** Tipo de PATTERNS para un nombre (tipo o intención); desconocido → light. */
function kindOf(name) {
  const k = String(name || '');
  if (PATTERNS[k]) return k;
  if (SEMANTIC[k]) return SEMANTIC[k];
  return 'light';
}

/** Estilo de iOS que se manda a la app nativa para un nombre (tipo o intención). */
export function hapticStyle(name = 'light') {
  return PATTERNS[kindOf(name)].native;
}

// La app nativa dice lo que sabe hacer en native.hello (native-bridge.js lo reenvía como br:native-status).
// Solo native.hello trae caps: los native.status posteriores no lo cambian.
(function listenNative() {
  try {
    const w = globalThis.window;
    if (!w || typeof w.addEventListener !== 'function') return;
    w.addEventListener('br:native-status', (e) => {
      const caps = e?.detail?.caps;
      if (Array.isArray(caps)) nativeHaptics = caps.includes('haptic');
    });
  } catch {
    /* sin ventana */
  }
})();

function postNative(style) {
  try {
    const br = globalThis.window?.BRNative;
    return !!br && typeof br.post === 'function' && br.post('haptic', { style }) === true;
  } catch {
    return false;
  }
}

function isIOS() {
  try {
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  } catch {
    return false;
  }
}

function ensureSwitch() {
  if (label && label.isConnected) return label;
  if (typeof document === 'undefined' || !document.body) return null;
  label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.className = 'haptic-switch';
  label.style.cssText =
    'position:fixed;left:-200px;top:0;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none;';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  label.appendChild(input);
  // Que el clic sintético no llegue a la delegación global de la app.
  const stop = (e) => e.stopPropagation();
  label.addEventListener('click', stop);
  input.addEventListener('change', stop);
  input.addEventListener('input', stop);
  document.body.appendChild(label);
  return label;
}

function tapSwitch() {
  const el = ensureSwitch();
  if (el) el.click();
}

/**
 * Vibra. kind: un tipo (light, selection, medium, heavy, soft, rigid, success, warning, error) o una intención
 * (tap, select, toggle, sheet, countdown, go, segment, sprint, record, done, destructive, fail).
 */
export function haptic(kind = 'light') {
  try {
    const p = PATTERNS[kindOf(kind)];
    const now = Date.now();
    if (now - lastAt < MIN_GAP_MS) return;
    lastAt = now;

    // App nativa con vibración propia: el Taptic Engine de verdad (si el puente no lo acepta, como en Safari).
    if (nativeHaptics && postNative(p.native)) return;

    if (isIOS()) {
      tapSwitch();
      for (let i = 1; i < p.taps; i++) {
        const t = setTimeout(() => {
          timers.delete(t);
          try { tapSwitch(); } catch { /* nada */ }
        }, p.gap * i);
        timers.add(t);
      }
      return;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      // Chrome bloquea (y avisa) si aún no ha habido interacción del usuario
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
      navigator.vibrate(p.vibrate);
    }
  } catch {
    /* nunca lanza */
  }
}
