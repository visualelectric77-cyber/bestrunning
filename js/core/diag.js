// BestRunning · registro de diagnóstico del final de clase (para encontrar el «cuelgue al guardar» en el iPhone).
// Apunta, solo en este dispositivo, hitos con hora (fin de clase, resumen, resumen del reloj, guardar…) y cada vez que
// la página se queda parada más de 0,5 s en los 10 min siguientes al fin de una clase. No toca audio ni la clase.
// Se ve y se copia en Perfil → Acerca de → Diagnóstico. Nunca lanza excepciones.

const KEY = 'br.diag.v1';
const MAX = 160;
const WATCH_MS = 10 * 60000; // vigilar huecos hasta 10 min tras el fin de clase
const GAP_MS = 500;

let raf = 0;
let until = 0;
let last = 0;
let hiddenAt = 0;

function read() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}

function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch { /* sin almacenamiento */ }
}

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Apunta un hito: diagMark('save.tap', { ms: 12 }). */
export function diagMark(event, data) {
  try {
    const list = read();
    let extra = '';
    if (data && typeof data === 'object') {
      extra = Object.entries(data).map(([k, v]) => `${k}=${typeof v === 'number' ? Math.round(v) : String(v).slice(0, 60)}`).join(' ');
    }
    list.push(`${stamp()} ${event}${extra ? ` ${extra}` : ''} @${(globalThis.location?.hash || '').split('?')[0]}`);
    write(list);
  } catch { /* nada */ }
}

/** Empieza a vigilar huecos de la página (fin de clase). */
export function diagWatch(reason = 'fin') {
  try {
    if (typeof requestAnimationFrame !== 'function') return;
    until = performance.now() + WATCH_MS;
    diagMark('vigilar', { por: reason });
    if (raf) return;
    last = performance.now();
    const tick = (t) => {
      const gap = t - last;
      // con la app detrás, rAF no corre: eso no es un cuelgue
      if (gap > GAP_MS && document.visibilityState === 'visible' && !(hiddenAt && hiddenAt > last)) diagMark('PARADA', { ms: gap });
      last = t;
      if (t < until) raf = requestAnimationFrame(tick);
      else { raf = 0; diagMark('fin vigilancia'); }
    };
    raf = requestAnimationFrame(tick);
  } catch { /* nada */ }
}

/** Texto para copiar (las últimas entradas, más recientes al final). */
export function diagText() {
  const list = read();
  return list.length ? list.join('\n') : 'Sin registros todavía: aparecen al terminar una clase.';
}

export function diagClear() {
  try { localStorage.removeItem(KEY); } catch { /* nada */ }
}

try {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = performance.now();
    if (until && performance.now() < until) diagMark(document.visibilityState === 'hidden' ? 'app detrás' : 'app delante');
  });
} catch { /* sin documento */ }
