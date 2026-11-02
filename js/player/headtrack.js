// RITMUP · SEGUIMIENTO DE CABEZA (beta, apagado por defecto: Ajustes › Pantalla de entreno › «Sigue tu cabeza»).
// Da a la escena 3D la pose filtrada de tu cabeza (headpose.js) para la perspectiva acoplada: la pantalla es una ventana
// al escenario. Fuente: la app nativa con capacidad 'head' (ARKit con el sensor de Face ID). La web le pide
// 'head.start' / 'head.stop' y recibe mensajes 'head' { x, y, z, yaw, pitch } (metros y radianes en la convención de
// poseFromMatrix: x a tu derecha, y arriba, z distancia; yaw + girando a tu derecha; pitch + mirando arriba).
// AUDIO SAGRADO: la web NO abre ninguna cámara ni crea ningún <video> (tools/test-audio-youtube.mjs lo vigila): todo el
// trabajo de cámara lo hace la app nativa, que no toca la sesión de audio de WebKit. En Safari no está disponible.
import { createHeadFilter } from './headpose.js';
import { isNative, nativeStatus, post as nativePost, on as nativeOn } from '../integrations/native-bridge.js';

export const HEAD_KEY = 'ritmup.headtrack';
/** Signo de x y yaw que llega de la app (1 = tal cual). Si en un iPhone el efecto saliera al revés, se corrige aquí. */
export const HEAD_MIRROR = 1;

/** ¿Está activado en Ajustes? */
export function headTrackOn() {
  try { return globalThis.localStorage?.getItem(HEAD_KEY) === 'on'; } catch { return false; }
}
export function setHeadTrackOn(on) {
  try { globalThis.localStorage?.setItem(HEAD_KEY, on ? 'on' : 'off'); } catch { /* sin almacenamiento */ }
}

/** Qué fuente hay: 'native' (ARKit en la app con capacidad 'head') o null (no disponible aquí). */
export function headSource() {
  if (!isNative()) return null;
  const caps = nativeStatus()?.caps;
  return Array.isArray(caps) && caps.includes('head') ? 'native' : null;
}

/**
 * Crea el seguidor. onState(estado, detalle): 'starting' | 'on' | 'lost' | 'off' | 'error' (detalle: motivo).
 * tracker.pose(nowMs) → pose filtrada { x, y, z, yaw, pitch, w } para scene.setHead.
 */
export function createHeadTracker({ onState = () => {} } = {}) {
  const filter = createHeadFilter();
  let src = null;
  let stopped = true;
  let face = false;
  let stopAt = 0;
  const t = (ms) => ms / 1000;
  const now = () => (globalThis.performance?.now?.() ?? Date.now());

  function sample(raw) {
    // giro RELATIVO a la línea de visión de la pantalla: asomarte mirando al iPhone no es «mirar a un lado»
    if (raw && raw.z > 0.05) {
      raw.yaw += Math.atan2(raw.x, raw.z);
      raw.pitch += Math.atan2(raw.y, raw.z);
    }
    filter.push(t(now()), raw);
    const f = !!raw;
    if (f !== face) { face = f; onState(f ? 'on' : 'lost'); }
  }

  async function startNative() {
    const off = nativeOn('head', (d) => {
      if (stopped) return;
      const ok = d && Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z);
      sample(ok ? { x: HEAD_MIRROR * d.x, y: +d.y, z: +d.z, yaw: HEAD_MIRROR * (+d.yaw || 0), pitch: +d.pitch || 0 } : null);
    });
    nativePost('head.start', { hz: 30 });
    return { stop() { try { off?.(); } catch { /* nada */ } nativePost('head.stop', {}); } };
  }

  const api = {
    async start() {
      if (!stopped) return true;
      const kind = headSource();
      if (!kind) { onState('error', 'unsupported'); return false; }
      stopped = false;
      filter.reset();
      face = false;
      onState('starting', kind);
      try {
        src = await startNative();
        if (stopped) { src?.stop(); src = null; return false; }
        return true;
      } catch {
        stopped = true;
        src = null;
        onState('error', 'failed');
        return false;
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      stopAt = now();
      try { src?.stop(); } catch { /* nada */ }
      src = null;
      face = false;
      onState('off');
    },
    /** Pose filtrada para la escena (al parar, el efecto se desvanece solo). */
    pose(ms) {
      if (stopped) {
        filter.push(t(ms ?? now()), null);
        return now() - stopAt > 1500 ? null : filter.sample(t(ms ?? now()));
      }
      return filter.sample(t(ms ?? now()));
    },
    get active() { return !stopped; },
  };
  return api;
}


/**
 * Matriz de la cara respecto a la cámara frontal (4×4 por columnas, cm; cámara SIN espejo: x a la derecha de la imagen,
 * y arriba, la cara en z < 0 mirando a +z, como la de ARKit/MediaPipe) → pose en el marco del corredor (x a TU derecha,
 * que es la izquierda de la imagen; z distancia en m; yaw + girando a tu derecha; pitch + mirando arriba). La app nativa
 * hace la misma cuenta en Swift (HeadTracker.swift); esta es la referencia de los tests.
 */
export function poseFromMatrix(m) {
  const fx = m[8]; const fy = m[9]; const fz = m[10];   // hacia dónde mira la cara (columna z)
  return {
    x: -m[12] / 100,
    y: m[13] / 100,
    z: -m[14] / 100,
    yaw: -Math.atan2(fx, fz),
    pitch: Math.atan2(fy, Math.hypot(fx, fz)),
  };
}
