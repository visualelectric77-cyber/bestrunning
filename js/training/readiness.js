// RITMUP · semáforo de fatiga: pulso en reposo y VFC (variabilidad de la frecuencia cardiaca) de Salud. Sin IA.
// Compara la media de los últimos 7 días con la de los 28 anteriores (tu línea base). Reposo más alto o VFC más baja
// de lo normal = el cuerpo aún no se ha recuperado del todo. Es orientativo: nunca diagnostica nada.
//   verde   «Listo para entrenar»
//   ámbar   «Hoy, con cabeza»  (reposo +3–5 ppm o VFC −10–20 %)
//   rojo    «Mejor suave hoy»   (reposo ≥ +6 ppm o VFC ≤ −20 %, o las dos en ámbar)

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

/** Valores de [[dayKey, v]] entre dos días (incluidos), ordenados. */
function between(list, fromKey, toKey) {
  return (Array.isArray(list) ? list : [])
    .filter((p) => Array.isArray(p) && typeof p[0] === 'string' && p[0] >= fromKey && p[0] <= toKey && Number(p[1]) > 0)
    .map((p) => Number(p[1]));
}

function keyMinus(todayKey, days) {
  const [y, m, d] = String(todayKey).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() - days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/**
 * metrics: { resting: [[dayKey, bpm]], hrv: [[dayKey, ms]] } · today: 'AAAA-MM-DD'
 * → null (pocos datos) o { level: 'green'|'amber'|'red', title, text, resting: {now, base, delta}, hrv: {now, base, pct} }
 */
export function readiness(metrics, today) {
  if (!metrics || !today) return null;
  const recentFrom = keyMinus(today, 6);
  const baseFrom = keyMinus(today, 34);
  const baseTo = keyMinus(today, 7);
  const rNow = between(metrics.resting, recentFrom, today);
  const rBase = between(metrics.resting, baseFrom, baseTo);
  const vNow = between(metrics.hrv, recentFrom, today);
  const vBase = between(metrics.hrv, baseFrom, baseTo);
  const hasR = rNow.length >= 3 && rBase.length >= 7;
  const hasV = vNow.length >= 3 && vBase.length >= 7;
  // Temperatura de muñeca durmiendo (Apple Watch): las 2 últimas noches frente a la línea base. Salud da desviaciones
  // (°C sobre tu normal); si llegan absolutas, se restan a la media de la base.
  const night2 = keyMinus(today, 1);
  const tNow = between(metrics.wristTemp, night2, today);
  const tBase = between(metrics.wristTemp, baseFrom, baseTo).length ? between(metrics.wristTemp, baseFrom, baseTo) : [];
  const tAll = (Array.isArray(metrics.wristTemp) ? metrics.wristTemp : []).filter((p) => Array.isArray(p) && p[0] >= night2 && p[0] <= today).map((p) => Number(p[1])).filter(Number.isFinite);
  let temp = null;
  if (metrics.wristTempAbsolute) {
    if (tNow.length >= 1 && tBase.length >= 7) temp = Math.round((avg(tNow) - avg(tBase)) * 10) / 10;
  } else if (tAll.length >= 1) temp = Math.round(avg(tAll) * 10) / 10;
  const pNow = between(metrics.respiratory, keyMinus(today, 2), today);
  const pBase = between(metrics.respiratory, baseFrom, baseTo);
  const resp = pNow.length >= 2 && pBase.length >= 7 ? Math.round((avg(pNow) - avg(pBase)) * 10) / 10 : null;
  if (!hasR && !hasV && temp == null) return null;

  const resting = hasR ? { now: Math.round(avg(rNow)), base: Math.round(avg(rBase)) } : null;
  if (resting) resting.delta = resting.now - resting.base;
  const hrv = hasV ? { now: Math.round(avg(vNow)), base: Math.round(avg(vBase)) } : null;
  if (hrv) hrv.pct = Math.round(((hrv.now - hrv.base) / hrv.base) * 100);

  const rLevel = !resting ? 0 : resting.delta >= 6 ? 2 : resting.delta >= 3 ? 1 : 0;
  const vLevel = !hrv ? 0 : hrv.pct <= -20 ? 2 : hrv.pct <= -10 ? 1 : 0;
  const tLevel = temp == null ? 0 : temp >= 0.7 ? 2 : temp >= 0.4 ? 1 : 0;
  const pLevel = resp == null ? 0 : resp >= 3 ? 2 : resp >= 1.5 ? 1 : 0;
  const ones = [rLevel, vLevel, tLevel, pLevel].filter((x) => x === 1).length;
  const score = Math.max(rLevel, vLevel, tLevel, pLevel) + (ones >= 2 ? 1 : 0);
  const level = score >= 2 ? 'red' : score === 1 ? 'amber' : 'green';
  // Temperatura alta (con o sin lo demás): el mensaje más claro es «puede que estés incubando algo»
  const sick = tLevel >= 1 && (level === 'red' || rLevel >= 1 || pLevel >= 1);
  const TEXT = {
    green: ['Listo para entrenar', 'Tu pulso en reposo y tu VFC están en tu línea. Dale con ganas.'],
    amber: ['Hoy, con cabeza', 'Tu cuerpo va algo cargado. Haz la clase, pero sin apretar de más en los tramos duros.'],
    red: ['Mejor suave hoy', 'Tu pulso en reposo y tu VFC dicen que aún te estás recuperando. Mejor una clase suave o descanso.'],
  };
  if (sick) {
    return { level: 'red', title: 'Puede que estés incubando algo', text: 'Tu temperatura de muñeca por la noche y tu pulso en reposo están por encima de lo normal. Descansa o haz algo muy suave; con fiebre, mejor no entrenar.', resting, hrv, temp, resp };
  }
  return { level, title: TEXT[level][0], text: TEXT[level][1], resting, hrv, temp, resp };
}
