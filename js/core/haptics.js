// BestRunning · vibración háptica.
// iOS 18+: un <input type="checkbox" switch> oculto dentro de un <label> produce el "tic" del sistema al
// hacer label.click(). En otros navegadores se usa navigator.vibrate. Nunca lanza excepciones.

const PATTERNS = {
  // [nº de toques en iOS, separación ms] · patrón para navigator.vibrate
  light: { taps: 1, gap: 0, vibrate: 10 },
  selection: { taps: 1, gap: 0, vibrate: 6 },
  medium: { taps: 1, gap: 0, vibrate: 18 },
  heavy: { taps: 2, gap: 45, vibrate: 30 },
  success: { taps: 2, gap: 110, vibrate: [14, 70, 20] },
  warning: { taps: 2, gap: 160, vibrate: [22, 90, 22] },
  error: { taps: 3, gap: 90, vibrate: [25, 60, 25, 60, 25] },
};

let label = null;
let lastAt = 0;
const timers = new Set();

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

export function haptic(kind = 'light') {
  try {
    const p = PATTERNS[kind] || PATTERNS.light;
    const now = Date.now();
    if (now - lastAt < 35) return; // evita ráfagas
    lastAt = now;

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
