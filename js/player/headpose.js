// RITMUP · SEGUIMIENTO DE CABEZA · filtro de la pose (función pura, sin DOM: se prueba en Node con
// tools/test-headpose.mjs). Recibe la pose bruta de la cabeza (de ARKit en la app nativa o de la cámara web en Safari)
// y da el desplazamiento INTENCIONADO respecto a tu postura habitual, listo para la cámara 3D (perspectiva acoplada a
// la cabeza: la pantalla es una ventana al escenario).
// En la cinta la cabeza rebota a cada zancada (≈ 2,5–3 Hz): un filtro de paso bajo crítico (≈ 0,8 Hz) la deja fuera y
// solo pasan los gestos lentos (asomarte a un lado, levantar o bajar la cabeza, acercarte). La postura neutra se
// calibra al empezar (1,5 s) y luego sigue tu postura muy despacio (τ ≈ 12 s): si te quedas descolocado, la escena
// vuelve sola al centro. Zona muerta de 1 cm y topes para que el número del HUD siempre quede sobre el cielo.
// Si se pierde la cara, el efecto se desvanece en ~0,8 s (nunca un salto).
//
//   const f = createHeadFilter();
//   f.push(t, { x, y, z, yaw, pitch })   // t en s; x, y, z en metros (x a TU derecha, y arriba, z distancia a la
//                                        // pantalla); yaw (+ = giras a tu derecha) y pitch (+ = miras arriba) en rad
//   f.push(t, null)                      // sin cara en esta muestra
//   f.sample(t) → { x, y, z, yaw, pitch, w }   // desplazamientos (m, rad) y peso 0..1 del efecto

const SETTLE = 0.42;     // s: muelle crítico de la pose (~0,8 Hz)
const CALIB = 1.5;       // s de calibración inicial
const TAU_NEUTRAL = 12;  // s: la postura neutra sigue la tuya muy despacio
const LOST = 0.6;        // s sin cara ⇒ se desvanece
const FADE = 0.8;        // s del desvanecimiento
const DEAD = { x: 0.01, y: 0.01, z: 0.015, yaw: 0.035, pitch: 0.035 };
const LIM = { x: 0.12, y: 0.09, z: 0.15, yaw: 0.45, pitch: 0.3 };
const KEYS = ['x', 'y', 'z', 'yaw', 'pitch'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Zona muerta suave: 0 dentro, continua y sin escalón fuera. */
export function deadzone(v, d) {
  const a = Math.abs(v);
  if (a <= d) return 0;
  return Math.sign(v) * (a - d);
}

/** Muelle crítico (mismo que util.springTo) sobre un par valor/velocidad. */
function spring(s, target, settle, dt) {
  const w = 4.6 / Math.max(1e-3, settle);
  const x = s.v - target;
  const e = Math.exp(-w * dt);
  const v0 = s.dv;
  s.v = target + (x + (v0 + w * x) * dt) * e;
  s.dv = (v0 - (v0 + w * x) * w * dt) * e;
}

export function createHeadFilter(opts = {}) {
  const settle = opts.settle ?? SETTLE;
  const st = {};
  const neutral = {};
  for (const k of KEYS) { st[k] = { v: 0, dv: 0 }; neutral[k] = 0; }
  let t0 = null;        // primera muestra con cara
  let calibN = 0;
  const calibSum = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  let lastT = null;
  let lastSeen = -1e9;
  let w = 0;
  let ready = false;
  const out = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, w: 0 };

  function step(t) {
    const dt = lastT == null ? 0 : clamp(t - lastT, 0, 0.25);
    lastT = t;
    const seen = t - lastSeen < LOST;
    const target = seen && ready ? 1 : 0;
    if (dt > 0 && target !== w) w = target > w ? Math.min(target, w + dt / 0.6) : Math.max(target, w - dt / FADE);
    return dt;
  }

  return {
    push(t, raw) {
      const dt = step(t);
      if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !Number.isFinite(raw.z)) return;
      lastSeen = t;
      if (t0 == null) {
        t0 = t;
        for (const k of KEYS) { st[k].v = Number(raw[k]) || 0; st[k].dv = 0; }
      }
      if (!ready) {
        for (const k of KEYS) calibSum[k] += Number(raw[k]) || 0;
        calibN++;
        if (t - t0 >= CALIB && calibN >= 5) {
          for (const k of KEYS) neutral[k] = calibSum[k] / calibN;
          ready = true;
        }
      }
      for (const k of KEYS) spring(st[k], Number(raw[k]) || 0, settle, dt > 0 ? dt : 1 / 30);
      if (ready && dt > 0) {
        const a = 1 - Math.exp(-dt / TAU_NEUTRAL);
        for (const k of KEYS) neutral[k] += (st[k].v - neutral[k]) * a;
      }
    },
    sample(t) {
      step(t);
      for (const k of KEYS) out[k] = ready ? clamp(deadzone(st[k].v - neutral[k], DEAD[k]), -LIM[k], LIM[k]) : 0;
      out.w = w;
      return out;
    },
    reset() {
      t0 = null; calibN = 0; ready = false; lastT = null; lastSeen = -1e9; w = 0;
      for (const k of KEYS) { st[k].v = 0; st[k].dv = 0; neutral[k] = 0; calibSum[k] = 0; }
    },
    get ready() { return ready; },
  };
}

/**
 * Pose de la cabeza → desplazamiento de la cámara 3D (perspectiva acoplada a la cabeza).
 * La pantalla es una ventana a `win` metros del ojo virtual: la cámara se mueve con tu cabeza (ganancia `gain`) y la
 * lente se descentra para que lo que está a `win` m quede quieto; lo lejano se mueve con tu cabeza (ves «detrás» del
 * borde), lo cercano al revés. Girar la cabeza gira la mirada un poco (`turn`). Devuelve out (reutilizado).
 */
export function headCamera(p, out, { gain = 2.0, win = 3.0, turn = 0.35, lean = 0.6 } = {}) {
  const k = p.w;
  out.dx = p.x * gain * k;
  out.dy = p.y * gain * k;
  out.dz = -p.z * lean * k;          // te acercas a la pantalla ⇒ la cámara avanza un poco
  out.win = win;
  out.yaw = -p.yaw * turn * k;       // giras a tu derecha ⇒ la mirada va a la derecha (yaw de cámara negativo)
  out.pitch = p.pitch * turn * 0.7 * k;
  return out;
}
