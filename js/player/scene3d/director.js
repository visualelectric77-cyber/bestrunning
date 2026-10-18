// BestRunning · escena 3D · DIRECTOR DE CÁMARA de retransmisión (núcleo; todos los escenarios lo heredan).
// El escenario fija su pose base (ctx.rig.target) y el director le suma, en el marco de esa cámara, un PLANO de una
// pequeña biblioteca (persecución baja, general alto, travelling lateral, dolly-in lento, grúa) elegido por el tipo y
// la duración del tramo. Reglas (SPEC §15.1 / §16):
//   · Los planos son TRASLACIONES paralelas (posición y mirada se desplazan igual): el horizonte y el punto de fuga que
//     el escenario compuso para el HUD no se mueven ⇒ la zona del número de velocidad sigue serena.
//   · Nunca cortes secos: el paso de un plano a otro es un fundido de la trayectoria de cámara (1,2–2 s) + muelle crítico.
//   · Calendario determinista (función pura del reloj de la clase) ⇒ capturas del laboratorio reproducibles.
//   · Sprint: persecución baja y cerrada (el "golpe" de dilatación del mundo existe pero está APAGADO por defecto:
//     solo con pista explícita `punch: true`). Recuperación: general alto y calmado. Tramos largos: rotación
//     cada 25–45 s. KM: arco de 2 s alrededor del punto de carrera (yaw ≤ 8–13°) y vuelta suave.
//   · Movimiento reducido ⇒ un solo plano (el del escenario), sin golpe ni arco. Modo TV ⇒ planos algo más abiertos.
//   · Sin asignaciones por fotograma.
// Pistas opcionales del escenario: `inst.director = { enabled, scale, maxDown, orbit, punch, shots: { sprint, recovery } }`.
import { clamp, clamp01, lerp, springTo, easeInOutSine, easeInOutCubic, easeOutCubic, ZONE_RANK } from './util.js';

const DEG = Math.PI / 180;
// escala del mundo (≈ altura de ojo en unidades del escenario) por escenario conocido; los demás, prudente
const HINTS = {
  aurora: { scale: 1.2 },
  estadio: { scale: 1.45 },
  cordillera: { scale: 1.7, maxDown: 0.22 },
  blank: { scale: 1.2 },
  legacy: { enabled: false },
};
// punch: APAGADO en todos los escenarios (jurado 18-oct): ralentizar el mundo justo cuando el corredor acelera se
// lee como tirones/fotogramas perdidos en el móvil y choca con el cuerpo. La persecución baja del sprint ya cierra
// el encuadre (fov −2,2° con fundido de 1,2 s): ese es el acento, sin dilatar el tiempo.
const DEFAULT_HINT = { enabled: true, scale: 1.2, maxDown: 0.3, orbit: true, punch: false };

const XF = 1.6;          // s: fundido de trayectoria entre planos
const XF_SPRINT = 1.2;   // s: entrada al sprint (más decidida, sin corte)
const PUNCH_MS = 600;    // golpe de entrada al sprint
const PUNCH_MIN = 0.35;
const ORBIT_MS = 2000;   // arco del KM
// rotación de los tramos largos (sin 'low': la persecución baja es del sprint)
const ROT = ['base', 'side', 'dolly', 'high', 'crane', 'base', 'side', 'high'];

// Plano → desplazamiento en el marco de la cámara (x derecha, y arriba, z atrás) en unidades de `scale`, + fov (°).
// u = avance 0..1 dentro del plano; s = ±1 (lado del travelling).
function shotPose(id, u, s, o) {
  switch (id) {
    case 'low': o.x = 0.1 * s; o.y = -0.3; o.z = -0.15; o.fov = -2.2; break;                      // persecución baja
    case 'high': o.x = 0; o.y = 0.95; o.z = 0.55; o.fov = 2.5; break;                              // general alto
    case 'side': o.x = 0.62 * s; o.y = 0.12; o.z = 0.1; o.fov = -1; break;                         // travelling
    case 'dolly': { const e = easeInOutSine(u); o.x = 0.08 * s; o.y = 0.2 - 0.12 * e; o.z = 1.1 - 1.35 * e; o.fov = 2.5 - 4.5 * e; break; }
    case 'crane': { const e = easeInOutSine(u); o.x = -0.15 * s; o.y = -0.15 + 1.05 * e; o.z = 0.35 - 0.15 * e; o.fov = 1; break; }
    default: o.x = 0; o.y = 0; o.z = 0; o.fov = 0; break;                                         // base del escenario
  }
}

const hash = (a, b = 0) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function createDirector() {
  let hint = { ...DEFAULT_HINT };
  let W = 0;                       // peso global del director (0 = pose pura del escenario)
  const sp = new Float64Array(8);  // muelles x, y, z, fov (valor/velocidad)
  let snapNext = true;
  let punchAt = -1e9;
  let orbitAt = -1e9;
  let orbitSign = 1;
  let kmCount = 0;
  let lastShot = 'base';
  const A = { x: 0, y: 0, z: 0, fov: 0 };
  const B = { x: 0, y: 0, z: 0, fov: 0 };
  const plan = { id: 'base', start: 0, len: 1, s: 1, xf: XF };
  const prevPlan = { id: 'base', start: 0, len: 1, s: 1, xf: XF };

  const isRecovery = (tl, i) => {
    const z = tl.zones[i];
    const r = ZONE_RANK[z] ?? 2;
    if (z === 'walk' || z === 'cooldown') return true;
    if (i > 0 && r <= 2 && (ZONE_RANK[tl.zones[i - 1]] ?? 2) >= 4) return true; // trote tras un tramo duro
    return false;
  };

  /** Plano del tramo i a e s de su inicio (función pura). */
  function planAt(tl, i, e, out) {
    const d = Math.max(1, tl.secs[i] || 1);
    const z = tl.zones[i];
    out.s = hash(i, 7) < 0.5 ? -1 : 1;
    out.xf = XF;
    if (z === 'sprint') { out.id = hint.shots?.sprint || 'low'; out.start = 0; out.len = d; out.xf = XF_SPRINT; return out; }
    if (isRecovery(tl, i)) { out.id = hint.shots?.recovery || 'high'; out.start = 0; out.len = d; return out; }
    if (z === 'fast') { out.id = d >= 50 && e >= d * 0.5 ? 'low' : 'side'; out.start = d >= 50 && e >= d * 0.5 ? d * 0.5 : 0; out.len = d >= 50 ? d * 0.5 : d; return out; }
    if (d < 50) { out.id = z === 'warmup' ? 'crane' : z === 'run' ? 'side' : 'base'; out.start = 0; out.len = d; return out; }
    // tramo largo y estable: rotación cada 25–45 s (el último hueco absorbe el resto si es corto)
    const L = 25 + 20 * hash(i, 3);
    let k = Math.floor(e / L);
    const nSlots = Math.max(1, Math.floor(d / L));
    if (k >= nSlots) k = nSlots - 1;
    out.id = ROT[(k + Math.floor(hash(i, 11) * ROT.length)) % ROT.length];
    out.start = k * L;
    out.len = k === nSlots - 1 ? d - k * L : L;
    out.s = hash(i, 17 + k) < 0.5 ? -1 : 1;
    return out;
  }

  const dir = {
    /** Nuevo escenario: pistas por defecto + las suyas (si las expone). */
    setTheme(id, inst) {
      hint = { ...DEFAULT_HINT, ...(HINTS[id] || {}) };
      const h = inst && typeof inst.director === 'object' && inst.director ? inst.director : null;
      if (h) hint = { ...hint, ...h };
      if (inst && inst.director === false) hint.enabled = false;
      hint.scale = clamp(Number(hint.scale) || 1.2, 0.2, 20);
      hint.maxDown = clamp(Number(hint.maxDown) || 0.3, 0, 0.6);
      W = 0;
      snapNext = true;
    },
    snap() { snapNext = true; },
    /** Golpe de entrada al sprint (en el segundo exacto del cruce). */
    gate(zone, up, now, reduced) {
      if (reduced || !hint.enabled || hint.punch !== true) return;
      if (zone === 'sprint' && up) punchAt = now;
    },
    km(now, reduced) {
      if (reduced || !hint.enabled || hint.orbit === false) return;
      kmCount++;
      orbitSign = kmCount % 2 ? 1 : -1;
      orbitAt = now;
    },
    /** Factor de tiempo del MUNDO (1 = normal). Solo escena: el HUD y los relojes no lo ven. */
    dilation(now) {
      const p = (now - punchAt) / PUNCH_MS;
      if (!(p >= 0 && p < 1)) return 1;
      if (p < 0.12) return lerp(1, PUNCH_MIN, easeOutCubic(p / 0.12));
      if (p < 0.3) return PUNCH_MIN;
      return lerp(PUNCH_MIN, 1, easeInOutSine((p - 0.3) / 0.7));
    },
    /** Aplica el plano a la pose objetivo del rig (ya volcada por el escenario este fotograma). */
    apply(F, T, tl, dt, now) {
      const on = hint.enabled && !F.reducedMotion && F.running && !F.paused && !(F.finale > 0) && F.intro >= 1 && tl.n > 0;
      W += ((on ? 1 : 0) - W) * (1 - Math.exp(-dt * (on ? 0.9 : 1.6)));
      if (snapNext) W = on ? 1 : 0;
      if (W < 1e-3 && !on) { W = 0; for (let i = 0; i < 8; i++) sp[i] = 0; snapNext = false; lastShot = 'base'; return; }

      // plano actual + fundido desde el anterior (mismo tramo u otro)
      const i = clamp(F.segIndex | 0, 0, tl.n - 1);
      const e = Math.max(0, F.t - tl.starts[i]);
      planAt(tl, i, e, plan);
      const ue = e - plan.start;
      shotPose(plan.id, clamp01(ue / Math.max(1, plan.len)), plan.s, B);
      let w = 1;
      if (ue < plan.xf) {
        w = easeInOutCubic(clamp01(ue / plan.xf));
        if (plan.start > 0) planAt(tl, i, plan.start - 0.01, prevPlan);
        else if (i > 0) planAt(tl, i - 1, Math.max(0, (tl.secs[i - 1] || 1) - 0.01), prevPlan);
        else { prevPlan.id = 'base'; prevPlan.start = 0; prevPlan.len = 1; prevPlan.s = 1; }
        const pe = plan.start > 0 ? plan.start - 0.01 : i > 0 ? (tl.secs[i - 1] || 1) - 0.01 : 0;
        shotPose(prevPlan.id, clamp01((pe - prevPlan.start) / Math.max(1, prevPlan.len)), prevPlan.s, A);
      } else { A.x = B.x; A.y = B.y; A.z = B.z; A.fov = B.fov; }
      lastShot = plan.id;
      const tvK = F.tvMode ? 1 : 0;
      const tx = lerp(A.x, B.x, w);
      const ty = Math.max(-hint.maxDown, lerp(A.y, B.y, w)) + 0.1 * tvK;
      const tz = lerp(A.z, B.z, w) + 0.25 * tvK;
      const tf = lerp(A.fov, B.fov, w) + 4 * tvK;
      if (snapNext || !(dt > 0)) {
        sp[0] = tx; sp[2] = ty; sp[4] = tz; sp[6] = tf; sp[1] = sp[3] = sp[5] = sp[7] = 0;
        snapNext = false;
      } else {
        const d = Math.min(dt, 0.1);
        springTo(sp, 0, tx, 1.3, d); springTo(sp, 2, ty, 1.3, d); springTo(sp, 4, tz, 1.3, d); springTo(sp, 6, tf, 1.5, d);
      }

      // marco de la cámara del escenario (horizontal): delante, derecha
      let fx = T.lookAt.x - T.position.x;
      let fz = T.lookAt.z - T.position.z;
      const fl = Math.hypot(fx, fz);
      if (fl < 1e-6) { fx = 0; fz = -1; } else { fx /= fl; fz /= fl; }
      const rx = -fz;
      const rz = fx;
      const k = W * hint.scale;
      const ox = (rx * sp[0] - fx * sp[4]) * k;
      const oy = sp[2] * k;
      const oz = (rz * sp[0] - fz * sp[4]) * k;
      T.position.x += ox; T.position.y += oy; T.position.z += oz;
      T.lookAt.x += ox; T.lookAt.y += oy; T.lookAt.z += oz;
      T.fov = clamp(T.fov + sp[6] * W, 20, 90);

      // arco del KM: giro rígido de la pose alrededor del punto de carrera (delante, a ~7 alturas de ojo)
      const p = (now - orbitAt) / ORBIT_MS;
      if (p >= 0 && p < 1 && W > 0.01) {
        const env = Math.pow(Math.sin(Math.PI * easeInOutSine(p)), 2);
        const amp = (F.portrait ? 8 : 13) * DEG;
        const th = orbitSign * amp * env * W;
        const R = 7 * hint.scale;
        const px = T.position.x + fx * R;
        const pz = T.position.z + fz * R;
        const c = Math.cos(th);
        const s = Math.sin(th);
        let dx = T.position.x - px;
        let dz = T.position.z - pz;
        T.position.x = px + dx * c - dz * s;
        T.position.z = pz + dx * s + dz * c;
        T.position.y += 0.25 * hint.scale * env * W;
        dx = T.lookAt.x - px;
        dz = T.lookAt.z - pz;
        T.lookAt.x = px + dx * c - dz * s;
        T.lookAt.z = pz + dx * s + dz * c;
        T.lookAt.y += 0.25 * hint.scale * env * W;
      }
    },
    info() {
      return { on: hint.enabled, shot: lastShot, w: +W.toFixed(2), scale: hint.scale };
    },
  };
  return dir;
}
