// HYPERTRACK · matemática del tiempo de la clase (sin DOM ni three.js).
// La pista se recorre en "unidades visuales": S(t) = ∫ v(τ) dτ con v = velocidad visual del tramo (suavizada en cada
// cambio, como la cinta). Todo lo que pertenece al plan (puertas, arco MITAD, META, escalera del test, carteles de km)
// se coloca en S(T) ⇒ se atraviesa EXACTAMENTE en el segundo T, pase lo que pase con la velocidad.
import { ZONES } from '../../training/levels.js';
import { easeInOutCubic } from './util.js';

export const DT = 0.25;        // resolución de la tabla (s)
export const RAMP = 4;         // aceleración del mundo tras un cambio (s)
export const START_RAMP = 3.5; // arranque desde parado
const END_EXTRA = 120;         // tabla más allá del final (dron, inercias)

/** Velocidad visual (u/s) para una velocidad real (km/h). No lineal: el sprint se siente mucho más rápido. */
export function visualSpeed(kmh) {
  if (!(kmh > 0)) return 0;
  return 1.35 * kmh * Math.pow(kmh / 10, 0.85);
}

const round1 = (v) => Math.round(v * 10) / 10;

export class Timeline {
  /** @param {object} workout  @param {{minSpeed?:number,maxSpeed?:number}} [treadmill] límites (como clampSpeed del motor) */
  constructor(workout, treadmill = null) {
    this.vMin = Number(treadmill?.minSpeed) > 0 ? Number(treadmill.minSpeed) : 1;
    this.vMax = Number(treadmill?.maxSpeed) > this.vMin ? Number(treadmill.maxSpeed) : 20;
    const segs = Array.isArray(workout?.segments) ? workout.segments : [];
    const n = segs.length;
    this.n = n;
    this.isTest = !!workout?.isTest;
    this.zones = segs.map((s) => (ZONES[s.zone] ? s.zone : 'jog'));
    this.labels = segs.map((s) => String(s.label || ZONES[s.zone]?.name || ''));
    this.speeds = Float64Array.from(segs, (s) => Math.max(0, Number(s.speed) || 0));
    this.secs = Float64Array.from(segs, (s) => Math.max(1, Number(s.sec) || 0));
    this.stage = Int16Array.from(segs, (s) => (Number.isFinite(Number(s.stage)) ? Number(s.stage) : 0));
    this.starts = new Float64Array(n);
    this.ends = new Float64Array(n);
    let t = 0;
    for (let i = 0; i < n; i++) { this.starts[i] = t; t += this.secs[i]; this.ends[i] = t; }
    this.totalSec = t;
    this.vis = new Float64Array(n);
    this.rampStart = new Float64Array(n).fill(NaN);
    this.rampFrom = new Float64Array(n).fill(NaN);
    this.prevVis = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) this.vis[i] = visualSpeed(this.speeds[i]);
    this.minSpeed = n ? Math.min(...this.speeds) : 0;
    this.maxSpeed = n ? Math.max(...this.speeds) : 0;
    this.maxStage = n ? Math.max(0, ...this.stage) : 0;
    this.len = Math.ceil((t + END_EXTRA) / DT) + 2;
    this.S_ = new Float64Array(this.len);
    this.D_ = new Float64Array(this.len);
    this.version = 0;
    this._build(0);
  }

  /** Índice del tramo en t (búsqueda binaria). */
  segAt(t) {
    const n = this.n;
    if (!n) return -1;
    if (t <= 0) return 0;
    if (t >= this.totalSec) return n - 1;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  /** Velocidad visual en t con la rampa de aceleración. */
  vAt(t) {
    if (!this.n || t < 0) return 0;
    const i = this.segAt(t);
    let target = this.vis[i];
    // antes del instante de un ajuste manual vale la velocidad anterior (la tabla ya pasada no se recalcula)
    if (!Number.isNaN(this.rampStart[i]) && t < this.rampStart[i] && !Number.isNaN(this.prevVis[i])) target = this.prevVis[i];
    let rs = this.starts[i];
    let from = i === 0 ? 0 : this.vis[i - 1];
    let dur = i === 0 ? START_RAMP : RAMP;
    if (!Number.isNaN(this.rampStart[i]) && t >= this.rampStart[i]) {
      rs = this.rampStart[i];
      from = this.rampFrom[i];
      dur = RAMP * 0.75;
    }
    const u = (t - rs) / dur;
    if (u >= 1) return target;
    if (u <= 0) return from;
    return from + (target - from) * easeInOutCubic(u);
  }

  _build(k0) {
    const S = this.S_;
    const D = this.D_;
    const len = this.len;
    let k = Math.max(1, k0 | 0);
    if (k0 <= 0) { S[0] = 0; D[0] = 0; k = 1; }
    let vPrev = this.vAt((k - 1) * DT);
    for (; k < len; k++) {
      const tk = k * DT;
      const v = this.vAt(tk);
      S[k] = S[k - 1] + (vPrev + v) * 0.5 * DT;
      const si = this.segAt(tk - DT * 0.5);
      D[k] = D[k - 1] + ((si >= 0 ? this.speeds[si] : 0) * DT) / 3600;
      vPrev = v;
    }
    this.version++;
  }

  _sample(arr, t, tailV) {
    if (t <= 0) return arr[0];
    const k = t / DT;
    const i = Math.floor(k);
    if (i >= this.len - 1) return arr[this.len - 1] + (t - (this.len - 1) * DT) * (tailV || 0);
    const f = k - i;
    return arr[i] + (arr[i + 1] - arr[i]) * f;
  }

  /** Distancia visual recorrida en t (unidades del mundo). */
  S(t) { return this._sample(this.S_, t, this.n ? this.vis[this.n - 1] : 0); }

  /** Distancia real (km) según el plan en t. */
  D(t) { return this._sample(this.D_, t, this.n ? this.speeds[this.n - 1] / 3600 : 0); }

  /** Instante del plan en el que se alcanza `km` reales (con desplazamiento `offset` = km medidos − km del plan). */
  timeForKm(km, offset = 0) {
    const target = km - offset;
    const D = this.D_;
    if (target <= D[0]) return 0;
    if (target > D[this.len - 1]) return Infinity;
    let lo = 0;
    let hi = this.len - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (D[mid] < target) lo = mid; else hi = mid;
    }
    const d0 = D[lo];
    const d1 = D[hi];
    const f = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
    return (lo + f) * DT;
  }

  /** Ajuste manual de velocidad (como el motor: tramo actual + restantes de la misma zona). */
  adjust(tNow, segIdx, newSpeed) {
    const i = segIdx;
    if (i < 0 || i >= this.n || !(newSpeed > 0)) return false;
    const delta = round1(newSpeed - this.speeds[i]);
    if (Math.abs(delta) < 0.05) return false;
    // la rampa empieza en la siguiente muestra de la tabla ⇒ S(t) es continua en el instante del ajuste
    const k1 = Math.ceil(Math.max(0, tNow) / DT);
    const tR = k1 * DT;
    const vR = this.vAt(tR);
    const zone = this.zones[i];
    this.prevVis[i] = this.vis[i];
    this.speeds[i] = newSpeed;
    this.vis[i] = visualSpeed(newSpeed);
    for (let j = i + 1; j < this.n; j++) {
      if (this.zones[j] === zone) {
        // igual que el motor: clampSpeed(velocidad + delta, cinta) redondeado a 0,1
        this.speeds[j] = round1(Math.min(this.vMax, Math.max(this.vMin, this.speeds[j] + delta)));
        this.vis[j] = visualSpeed(this.speeds[j]);
      }
    }
    this.rampStart[i] = Math.max(this.starts[i], tR);
    this.rampFrom[i] = vR;
    this.maxSpeed = Math.max(...this.speeds);
    this._build(k1 + 1);
    return true;
  }
}
