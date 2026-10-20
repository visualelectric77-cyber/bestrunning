// RITMUP · modo pulso: con el pulso en directo del reloj, propone subir o bajar la velocidad para ir en la zona del
// tramo. Lógica pura (sin DOM ni audio): el reproductor le pasa el estado cada segundo y aplica lo que devuelve con el
// mismo ajuste que los botones − / + (que ya confirma la velocidad nueva con la voz).
// Prudente a propósito: solo en tramos largos y constantes, con el pulso medio de los últimos 25 s, tras ≥ 45 s fuera
// de zona, ±0,2 km/h por ajuste, 90 s de calma entre ajustes y como mucho 8 por clase. Sin pulso no hace nada.

export const HR_COACH_ZONES = new Set(['jog', 'run', 'fast']);
const MIN_SEG_SEC = 180;      // solo tramos de ≥ 3 min (en series cortas el pulso llega tarde)
const SETTLE_SEC = 60;        // el pulso tarda en subir: nada en el primer minuto del tramo
const TAIL_SEC = 45;          // ni en los últimos 45 s
const AVG_SEC = 25;           // pulso medio de los últimos 25 s
const OUT_HIGH_SEC = 45;      // por encima de zona ≥ 45 s → bajar
const OUT_LOW_SEC = 60;       // por debajo ≥ 60 s → subir
const MARGIN_HIGH = 3;        // ppm de tolerancia sobre el máximo de la zona
const MARGIN_LOW = 5;         // ppm de tolerancia bajo el mínimo
const ALARM_OVER = 15;        // > máximo + 15 ppm: bajar 0,3 sin esperar tanto
const COOLDOWN_SEC = 90;
const MAX_PER_CLASS = 8;
const STALE_MS = 15000;       // lecturas de hace > 15 s no cuentan

/**
 * Crea el estado del modo pulso de una clase.
 * step({ nowMs, running, segIndex, zone, segSec, segElapsed, segRemaining, hr: {bpm, atMs}|null, target: {min,max} })
 * → null o { dir: -1|1, tenths: 2|3, reason: 'high'|'low'|'alarm', avg }
 */
export function createHrCoach() {
  let buf = [];               // [ms, bpm]
  let outSince = 0;           // ms en que empezó a ir fuera de zona (0 = dentro)
  let outDir = 0;
  let lastAdjustAt = -Infinity;
  let count = 0;
  let seg = -1;

  return {
    get count() { return count; },
    step(o) {
      const now = Number(o?.nowMs) || 0;
      if (!o?.running) { outSince = 0; outDir = 0; return null; }
      if (o.segIndex !== seg) { seg = o.segIndex; outSince = 0; outDir = 0; buf = []; }
      const hr = o.hr;
      if (hr && Number.isFinite(hr.bpm) && hr.bpm >= 40 && hr.bpm <= 230 && now - (Number(hr.atMs) || now) <= STALE_MS) {
        if (!buf.length || buf[buf.length - 1][0] !== hr.atMs) buf.push([Number(hr.atMs) || now, hr.bpm]);
      }
      buf = buf.filter((p) => now - p[0] <= AVG_SEC * 1000);
      const eligible = HR_COACH_ZONES.has(o.zone) && o.segSec >= MIN_SEG_SEC && o.segElapsed >= SETTLE_SEC
        && o.segRemaining >= TAIL_SEC && count < MAX_PER_CLASS && o.target && o.target.max > o.target.min;
      if (!eligible || buf.length < 3) { outSince = 0; outDir = 0; return null; } // el reloj manda pulso cada ~5 s
      const avg = buf.reduce((a, p) => a + p[1], 0) / buf.length;
      const dir = avg > o.target.max + MARGIN_HIGH ? -1 : avg < o.target.min - MARGIN_LOW ? 1 : 0;
      if (!dir) { outSince = 0; outDir = 0; return null; }
      if (dir !== outDir) { outDir = dir; outSince = now; }
      if (now - lastAdjustAt < COOLDOWN_SEC * 1000) return null;
      const alarm = dir < 0 && avg > o.target.max + ALARM_OVER;
      const need = alarm ? 20 : dir < 0 ? OUT_HIGH_SEC : OUT_LOW_SEC;
      if (now - outSince < need * 1000) return null;
      lastAdjustAt = now;
      outSince = now;
      count++;
      return { dir, tenths: alarm ? 3 : 2, reason: alarm ? 'alarm' : dir < 0 ? 'high' : 'low', avg: Math.round(avg) };
    },
  };
}
