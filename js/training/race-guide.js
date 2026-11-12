// RITMUP · guía de carrera por pulso (sin DOM ni audio). En el tramo de CARRERA de una carrera en la cinta
// (js/training/race.js) el modo pulso de las clases no vale: allí el objetivo es ir en la zona del tramo; aquí es
// llegar a la meta lo antes posible SIN reventar. Con el modelo de tu pulso (hr-dynamics.js) se calcula con qué
// pulso cruzarías la meta si mantienes esta velocidad, y de ahí sale si puedes apretar o si tienes que aflojar:
//
// · «te pasas»: cruzarías la meta claramente por encima de tu pulso máximo (más de 3 ppm: el modelo se equivoca en
//   eso) → baja lo justo (0,1–0,3 km/h) para llegar a tope. En los primeros 4 min o el primer kilómetro el pulso
//   aún no dice lo que cuesta el ritmo: ahí solo baja si la previsión se pasa de largo (más de 8 ppm);
// · «tienes margen»: llegarías lejos de tu máximo → sube 0,1–0,2 km/h (nunca en el primer kilómetro);
// · último kilómetro: ya no te baja (solo la alarma); si tienes margen, te lo dice;
// · alarma: pulso real por encima de tu máximo → baja 0,3 sin esperar.
//
// Prudente a propósito: nada en el primer minuto (el pulso llega tarde), 90 s de calma entre ajustes, 2 min sin
// tocar nada después de que cambies tú la velocidad (mandas tú) y 10 ajustes como mucho. Sin pulso o sin modelo no
// hace nada. No es un dispositivo médico: es un cálculo con tus clases anteriores.
import { equilibrium } from './hr-dynamics.js';

const STEP_SEC = 5;           // paso de la simulación hasta la meta
const REF_JOG = 8.5;          // como hr-dynamics: la carga cuenta por encima de un trote
const START_QUIET_SEC = 60;   // nada en el primer minuto de carrera
const RAISE_AFTER_KM = 1;     // ni subir en el primer kilómetro («sal contenido»)
const RAISE_AFTER_SEC = 240;  // ni antes de 4 min: el pulso aún no dice lo que cuesta este ritmo
const GAP_AFTER_DOWN = 90;    // s de calma tras bajar
const GAP_AFTER_UP = 120;     // y tras subir
const GAP_AFTER_MANUAL = 120; // después de un cambio tuyo, la guía espera
const GAP_ALARM = 60;
const MAX_ACTIONS = 10;
const OVER = 3;               // «te pasas»: meta prevista más de 3 ppm por encima de tu máxima (el error del modelo)
const EARLY_OVER = 8;         // al principio (antes de 4 min o de 1 km) hace falta pasarse de largo para bajar
const EARLY_SEC = 240;
const EARLY_KM = 1;
const FINISH_AT = 0;          // al bajar, se apunta a llegar a tu máxima, no por debajo
const ROOM = 8;               // «tienes margen»: meta prevista por debajo de (máxima − 8)
const ROOM_TO = 4;            // al subir, sin pasar de (máxima − 4)
const ALARM_OVER = 4;         // pulso real ≥ máxima + 4
const LAST_KM = 1;            // en el último km no se baja (salvo alarma)
const END_KM = 0.3;           // y en los últimos 300 m, nada
const MAX_DOWN = 0.3;
const MAX_UP = 0.2;
const r1 = (x) => Math.round(x * 10) / 10;

/**
 * Pulso con el que cruzarías la meta manteniendo `speed` los `remKm` que quedan.
 * @returns {number|null}
 */
export function finishHr(model, a, { hrNow, speed, remKm, load = 0 } = {}) {
  if (!model || !(speed > 0) || !(remKm >= 0) || !Number.isFinite(hrNow)) return null;
  let left = (remKm / speed) * 3600;
  let hr = hrNow;
  let ld = Number(load) || 0;
  let guard = 0;
  while (left > 1e-6 && guard++ < 5000) {
    const dt = Math.min(STEP_SEC, left);
    const x = equilibrium(model, a, speed, 0, ld);
    hr = x + (hr - x) * Math.exp(-dt / (x > hr ? model.tauUp : model.tauDown));
    ld += (Math.max(0, speed - REF_JOG) * dt) / 60;
    left -= dt;
  }
  return hr;
}

/** Segundos que faltan hasta la meta a esta velocidad. */
export const finishIn = (remKm, speed) => (speed > 0 && remKm >= 0 ? (remKm / speed) * 3600 : null);

/**
 * Guía de una carrera.
 * step({ nowMs, raceSec, doneKm, remKm, speed, hr, model, a, load, starter?, minSpeed?, maxSpeed?, manualAtMs? })
 *   hr: pulso suavizado de ahora (null si no llega) · a: el «a» de hoy del seguidor (tracker.forecastA)
 * → null o { dir: -1|1, tenths, reason: 'over'|'room'|'alarm', predicted, hr, hrMax, to }
 */
export function createRaceGuide({ hrMax } = {}) {
  const max = Number(hrMax) > 100 ? Number(hrMax) : 0;
  let count = 0;
  let lastAt = -Infinity;
  let lastDir = 0;
  let predicted = null;
  return {
    get count() { return count; },
    /** Última meta prevista (ppm) con la velocidad de entonces; null si aún no hay. */
    get predicted() { return predicted; },
    step(o) {
      const now = Number(o?.nowMs) || 0;
      const model = o?.model;
      const hr = Number(o?.hr);
      const speed = Number(o?.speed);
      const remKm = Number(o?.remKm);
      if (!max || !model || !Number.isFinite(hr) || hr < 40 || !(speed > 0) || !(remKm >= 0)) { predicted = null; return null; }
      const a = Number.isFinite(Number(o.a)) ? Number(o.a) : model.aTypical;
      const load = Number(o.load) || 0;
      const lo = Number(o.minSpeed) > 0 ? Number(o.minSpeed) : 1;
      const hi = Number(o.maxSpeed) > lo ? Number(o.maxSpeed) : 20;
      const at = (v) => finishHr(model, a, { hrNow: hr, speed: v, remKm, load });
      predicted = Math.round(at(speed));
      if (count >= MAX_ACTIONS || remKm < END_KM || (Number(o.raceSec) || 0) < START_QUIET_SEC) return null;
      const act = (dir, tenths, reason) => {
        const to = r1(Math.min(hi, Math.max(lo, speed + (dir * tenths) / 10)));
        const real = Math.round(Math.abs(to - speed) * 10);
        if (!real) return null;
        count++;
        lastAt = now;
        lastDir = dir;
        return { dir, tenths: real, reason, predicted, hr: Math.round(hr), hrMax: max, to };
      };
      // Alarma: pulso real por encima de tu máximo (también en el último km)
      if (hr >= max + ALARM_OVER) return now - lastAt >= GAP_ALARM * 1000 ? act(-1, 3, 'alarm') : null;
      const since = now - lastAt;
      if (since < (lastDir > 0 ? GAP_AFTER_UP : GAP_AFTER_DOWN) * 1000) return null;
      if (Number.isFinite(Number(o.manualAtMs)) && now - Number(o.manualAtMs) < GAP_AFTER_MANUAL * 1000) return null;
      // Te pasas: lo justo para llegar a tope (nunca en el último km: ahí decides tú)
      const early = (Number(o.raceSec) || 0) < EARLY_SEC || (Number(o.doneKm) || 0) < EARLY_KM;
      if (predicted > max + (early ? EARLY_OVER : OVER) && remKm > LAST_KM) {
        let tenths = Math.round(MAX_DOWN * 10);
        for (let k = 1; k <= Math.round(MAX_DOWN * 10); k++) {
          if (at(speed - k / 10) <= max - FINISH_AT) { tenths = k; break; }
        }
        return act(-1, tenths, 'over');
      }
      // Tienes margen: sube, sin pasarte
      if (!o.starter && predicted < max - ROOM && (Number(o.doneKm) || 0) >= RAISE_AFTER_KM && (Number(o.raceSec) || 0) >= RAISE_AFTER_SEC) {
        let tenths = 0;
        for (let k = Math.round(MAX_UP * 10); k >= 1; k--) {
          if (at(speed + k / 10) <= max - ROOM_TO) { tenths = k; break; }
        }
        return tenths ? act(1, tenths, 'room') : null;
      }
      return null;
    },
  };
}
