// RITMUP · la semana de cada usuario (sin DOM): minutos por día, 0 = descanso.
// state.schedule.days = { 1: 30, 2: 0, … 7: 45 } (1 = lunes). Las copias antiguas, sin `days`, traen la forma fija de
// antes (L-M-X-V cortos, jueves largo, un día de finde) y se leen tal cual para que su plan no cambie.

export const DAY_MIN = 20;   // las clases van de 20 a 60 minutos
export const DAY_MAX = 60;
export const DAY_STEP = 5;
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const LONG_FROM = 40;

const posInt = (v, d) => (Number(v) > 0 ? Math.round(Number(v)) : d);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Minutos de cada día de la semana, venga la semana en el formato nuevo o en el antiguo. */
export function scheduleDays(schedule) {
  const s = isObj(schedule) ? schedule : {};
  const out = {};
  if (isObj(s.days)) {
    for (const w of WEEKDAYS) out[w] = Number(s.days[w]) > 0 ? Math.round(Number(s.days[w])) : 0;
    return out;
  }
  const short = posInt(s.weekdayMinutes, 20);
  const we = Number(s.weekendDay) === 7 ? 7 : 6;
  for (const w of WEEKDAYS) out[w] = w <= 5 ? short : 0;
  out[4] = posInt(s.thursdayMinutes, 50);
  out[we] = posInt(s.weekendMinutes, 50);
  return out;
}

/** ¿Es exactamente la semana fija de antes? Entonces el plan sigue saliendo idéntico, clase a clase. */
function isClassic(days) {
  const short = days[1];
  const we = (days[6] > 0) !== (days[7] > 0) ? (days[6] > 0 ? 6 : 7) : 0;
  return !!we && short > 0 && short < LONG_FROM && days[2] === short && days[3] === short && days[5] === short
    && days[4] >= LONG_FROM && days[we] >= LONG_FROM;
}

/**
 * Forma de la semana para el planificador y las pantallas.
 * longs: días largos (como mucho dos) · longRun: el más largo · keyDay: la otra sesión clave · shortMinutes: la
 * duración de un día normal (para «entrenar igualmente» en un descanso).
 */
export function weekShape(schedule) {
  const days = scheduleDays(schedule);
  const trainDays = WEEKDAYS.filter((w) => days[w] > 0);
  const classic = !isObj(schedule?.days) || isClassic(days);
  const totalMinutes = trainDays.reduce((a, w) => a + days[w], 0);
  if (classic) {
    const weekendDay = days[7] > 0 ? 7 : 6;
    return {
      days, trainDays, classic: true, totalMinutes, longs: [4, weekendDay], longRun: weekendDay, keyDay: 4,
      shortMinutes: days[1], longMinutes: days[weekendDay],
    };
  }
  const least = trainDays.length ? Math.min(...trainDays.map((w) => days[w])) : 0;
  const longs = trainDays
    .filter((w) => days[w] >= LONG_FROM && days[w] > least)
    .sort((a, b) => days[b] - days[a] || b - a)
    .slice(0, 2);
  const longRun = longs[0] ?? null;
  const keyDay = longs[1] ?? (days[4] > 0 ? 4 : null);
  const shorts = trainDays.filter((w) => !longs.includes(w)).map((w) => days[w]);
  const shortMinutes = Math.min(30, Math.max(DAY_MIN, shorts.length ? Math.min(...shorts) : least || 30));
  return { days, trainDays, classic: false, totalMinutes, longs, longRun, keyDay, shortMinutes, longMinutes: longRun ? days[longRun] : 0 };
}

/** Días de la semana sin nada entre ellos, contando el salto de domingo a lunes. */
const adjacent = (a, b) => Math.abs(a - b) === 1 || Math.abs(a - b) === 6;

/** Días libres antes (dir −1) o después (dir +1) de un día de entreno, dando la vuelta a la semana. */
function restAround(w, dir, trainDays) {
  if (trainDays.length < 2) return 6;
  for (let i = 1; i <= 6; i++) {
    const x = ((w - 1 + dir * i + 70) % 7) + 1;
    if (trainDays.includes(x)) return i - 1;
  }
  return 6;
}

/** Cuántas sesiones exigentes y medias caben por semana del bloque (1-4) según los días que entrena. */
function qualityCounts(n, week) {
  if (n <= 0) return { hard: 0, mod: 0 };
  if (n === 1) return week === 4 ? { hard: 0, mod: 0 } : week === 3 ? { hard: 1, mod: 0 } : { hard: 0, mod: 1 };
  if (n === 2) return [{ hard: 0, mod: 1 }, { hard: 1, mod: 0 }, { hard: 1, mod: 1 }, { hard: 0, mod: 1 }][week - 1];
  const H = [1, 2, 2, 0][week - 1];
  const M = [2, 2, 2, 3][week - 1];
  const hard = H ? Math.max(1, Math.round((H * n) / 6)) : 0;
  const room = week === 4 ? Math.floor(n / 2) : Math.max(1, n - 2 - hard);
  return { hard, mod: Math.min(room, Math.round((M * n) / 6)) };
}

/**
 * Papeles de la semana para una semana libre: H/M/E/null por día. Lo exigente va a los días más largos y con más
 * descanso alrededor, nunca dos días duros seguidos (tampoco de domingo a lunes).
 */
export function freeWeekRoles(shape, week) {
  const { days, trainDays } = shape;
  const roles = {};
  for (const w of WEEKDAYS) roles[w] = days[w] > 0 ? 'E' : null;
  const { hard, mod } = qualityCounts(trainDays.length, week);
  const score = (w) => days[w] / 60 + 0.5 * Math.min(3, restAround(w, -1, trainDays)) + 0.25 * Math.min(3, restAround(w, 1, trainDays))
    + (w === 4 ? 0.1 : 0) - w * 0.001;
  const order = trainDays.slice().sort((a, b) => score(b) - score(a));
  const picked = [];
  for (const w of order) {
    if (picked.length >= hard) break;
    if (picked.some((p) => adjacent(p, w))) continue;
    picked.push(w);
    roles[w] = 'H';
  }
  // Lo que no cupo como duro pasa a sesión media; primero lejos de otra sesión de calidad
  const wantMod = mod + (hard - picked.length);
  let placed = 0;
  for (const strict of [true, false]) {
    for (const w of order) {
      if (placed >= wantMod) break;
      if (roles[w] !== 'E') continue;
      if (strict && WEEKDAYS.some((x) => adjacent(x, w) && (roles[x] === 'H' || roles[x] === 'M'))) continue;
      roles[w] = 'M';
      placed++;
    }
  }
  return roles;
}

/** Día del test VAM en una semana libre: jueves si se entrena; si no, el de más descanso antes, mejor a mitad de semana. */
export function freeTestDay(shape) {
  const { trainDays } = shape;
  if (!trainDays.length) return null;
  if (trainDays.includes(4)) return 4;
  const score = (w) => Math.min(3, restAround(w, -1, trainDays)) - Math.abs(w - 4) * 0.1;
  return trainDays.slice().sort((a, b) => score(b) - score(a))[0];
}
