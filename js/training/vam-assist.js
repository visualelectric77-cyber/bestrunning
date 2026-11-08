// RITMUP · asistencia del test VAM con tu pulso (sin DOM). Las velocidades del test NO cambian (si se adaptaran al pulso
// dejaría de medir tu VAM): esto te dice cómo vas y, al acabar, si el resultado es fiable.
//
// IMPORTANTE: el reloj solo da la frecuencia del pulso. No ve arritmias ni problemas de riego: esto es una ayuda de
// entrenamiento, no una valoración médica, y nunca dice que sea seguro seguir. Con dolor en el pecho, mareo o
// palpitaciones raras se para, marque lo que marque.
//
// Criterios habituales en pruebas de esfuerzo incrementales: llegar a ≈ 10 ppm de tu FC máxima (≈ 94 %) o que el pulso
// deje de subir aunque suba la carga (meseta). Todavía no hay ningún test real con pulso para calibrarlos.

const NEAR = 0.95;
const VALID_PEAK = 0.94;
const PLATEAU_MIN = 0.9;
const PLATEAU_RISE = 2;     // ppm en el último minuto (fuera de la meseta, unos 5 por escalón)
const OVER_PPM = 5;
const OVER_SEC = 20;
const ODD_DROP = 12;
const ODD_MIN = 0.8;
const MIN_STAGES = 4;
const STAGE_SEC = 60;

export const VAM_TEXT = {
  wait: 'Esperando al reloj',
  margin: 'Con margen · sigue',
  near: 'Cerca de tu máximo',
  plateau: 'Tu pulso ya no sube · al límite',
  over: 'Sobre tu máximo · para si te notas mal',
  odd: 'Pulso raro · para si te notas mal',
};

const meanIn = (buf, a, b) => {
  const q = buf.filter((p) => p[0] > a && p[0] <= b);
  return q.length >= 2 ? q.reduce((s, p) => s + p[1], 0) / q.length : null;
};

/**
 * Seguimiento durante los escalones. step(t, bpm|null, stage) → { st, pct, cue }: st, una clave de VAM_TEXT; cue, el
 * aviso de voz que toca ahora ('margin' | 'near' | 'plateau' | 'over' | 'odd') o null; cada uno suena una sola vez.
 */
export function createVamAssist({ hrMax } = {}) {
  const max = Number(hrMax) > 0 ? Number(hrMax) : 176;
  const buf = [];
  const said = new Set();
  let overSince = null;
  let plateauSince = null;
  let plateau = false;
  return {
    get plateau() { return plateau; },
    step(t, bpm, stage = 0) {
      if (Number(bpm) >= 40) buf.push([t, Number(bpm)]);
      while (buf.length && t - buf[0][0] > 130) buf.shift();
      const now = meanIn(buf, t - 15, t);
      if (now == null) return { st: 'wait', pct: null, cue: null };
      const pct = now / max;
      if (!(stage > 0)) return { st: 'margin', pct, cue: null };

      overSince = now >= max + OVER_PPM ? overSince ?? t : null;
      const before = meanIn(buf, t - 40, t - 22);
      const minuteAgo = meanIn(buf, t - 75, t - 50);
      const rising = minuteAgo != null ? now - minuteAgo : null;
      if (stage >= 3 && pct >= PLATEAU_MIN && rising != null && rising <= PLATEAU_RISE) plateauSince = plateauSince ?? t;
      else plateauSince = null;
      if (plateauSince != null && t - plateauSince >= 10) plateau = true;

      let st = 'margin';
      if (overSince != null && t - overSince >= OVER_SEC) st = 'over';
      else if (before != null && before >= max * ODD_MIN && before - now >= ODD_DROP) st = 'odd';
      else if (plateau && pct >= PLATEAU_MIN) st = 'plateau';
      else if (pct >= NEAR) st = 'near';
      let cue = null;
      if (st !== 'margin' && !said.has(st)) cue = st;
      else if (st === 'margin' && stage >= 2 && pct < 0.85 && !said.has('margin')) cue = 'margin';
      if (cue) said.add(cue);
      return { st, pct, cue };
    },
  };
}

/** ¿Conviene hacer hoy el test? Clase larga o dura ayer → aviso antes de empezar. → { hardYesterday } */
export function vamPreCheck(history, today) {
  const y = new Date(`${today}T12:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  const key = y.toISOString().slice(0, 10);
  const hardYesterday = (Array.isArray(history) ? history : []).some((h) => h && h.dayKey === key && !h.isTest
    && ((Number(h.elapsedSec) || 0) >= 2400 || ['hard', 'max', 'fail'].includes(h.feeling)));
  return { hardYesterday };
}

/**
 * ¿Es fiable el resultado? session: con hrSeries [[s, ppm]…], test { stage, secondsInLastStage }, timeline y vamAssist
 * { stageStart, dayHigh }. prevDelta: VAM de hoy menos la referencia.
 * → { verdict: 'valid' | 'doubtful' | 'unknown', reasons: [], peak, peakPct, plateau, stages, suggestHrMax }
 * Sin vamAssist (tests antiguos) o sin pulso: 'unknown' (no se puede juzgar; el resultado se aplica como siempre).
 */
export function vamValidity(session, { hrMax, prevDelta = 0 } = {}) {
  const base = { verdict: 'unknown', reasons: [], peak: null, peakPct: null, plateau: false, stages: 0, suggestHrMax: null };
  const va = session?.vamAssist;
  const stageStart = Number(va?.stageStart);
  if (!va || !Number.isFinite(stageStart)) return base;
  const stage = Number(session?.test?.stage) || 0;
  const secs = Number(session?.test?.secondsInLastStage) || STAGE_SEC;
  const stageEnd = stageStart + Math.max(0, stage - 1) * STAGE_SEC + secs;
  const max = Number(hrMax) > 0 ? Number(hrMax) : 176;
  const stages = secs >= STAGE_SEC - 1 ? stage : Math.max(0, stage - 1);
  const raw = (Array.isArray(session?.hrSeries) ? session.hrSeries : [])
    .filter((p) => Array.isArray(p) && p[0] >= stageStart && p[0] <= stageEnd + 30 && Number(p[1]) >= 40);
  if (raw.length < 6) return { ...base, stages, reasons: ['Sin pulso del reloj no podemos comprobar el resultado.'] };

  // mediana de 3: un pico suelto del sensor óptico no cuenta como tu máximo
  const smooth = raw.map((p, i) => {
    const q = [raw[i - 1]?.[1] ?? p[1], p[1], raw[i + 1]?.[1] ?? p[1]].sort((a, b) => a - b);
    return [p[0], q[1]];
  });
  const peak = Math.max(...smooth.map((p) => p[1]));
  const peakPct = peak / max;
  const avg = (a, b) => {
    const q = smooth.filter((p) => p[0] >= a && p[0] < b);
    return q.length ? q.reduce((s, p) => s + p[1], 0) / q.length : null;
  };
  const last = avg(stageEnd - 20, stageEnd + 1);
  const prev = avg(stageEnd - 80, stageEnd - 55);
  const plateau = stages >= 3 && peakPct >= PLATEAU_MIN && last != null && prev != null && last - prev <= PLATEAU_RISE;

  const reasons = [];
  if (stages < MIN_STAGES) reasons.push(`Solo completaste ${stages} ${stages === 1 ? 'escalón' : 'escalones'}: hacen falta al menos ${MIN_STAGES}.`);
  if (!(peakPct >= VALID_PEAK || plateau)) reasons.push(`Tu pulso llegó a ${Math.round(peak)} ppm (${Math.round(peakPct * 100)} % de tu máximo): puede que aún tuvieras margen.`);
  const paused = (Array.isArray(session?.timeline) ? session.timeline : []).some((e) => e?.[2] === 0 && e[1] > stageStart + 1 && e[1] < stageEnd - 1);
  if (paused) reasons.push('Hubo una pausa durante los escalones.');
  if (va.dayHigh && prevDelta < 0) reasons.push('Hoy tu pulso iba más alto de lo normal y el resultado baja: mejor repetirlo otro día.');
  const verdict = reasons.length ? 'doubtful' : 'valid';
  const m = Math.round(peak);
  return { verdict, reasons, peak: m, peakPct, plateau, stages, suggestHrMax: verdict === 'valid' && plateau && m <= max - 3 ? m : null };
}
