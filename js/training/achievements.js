// BestRunning · logros (sin DOM). Cada logro tiene check(state) → bool; evaluateAchievements devuelve los nuevos.
import { mondayOf, daysBetween } from '../core/utils.js';
import { totals, streakWeeks, weekProgress, sessionDay, sessionCounts } from './stats.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const hist = (st) => (Array.isArray(st?.history) ? st.history.filter((s) => s && typeof s === 'object') : []);
const valid = (st) => hist(st).filter((s) => num(s.elapsedSec) >= 60);
const done = (st) => hist(st).filter(sessionCounts);
const finished = (st, id) => hist(st).some((s) => s.templateId === id && num(s.completionPct) >= 0.95);
const startHour = (s) => {
  const d = s?.startedAt ? new Date(s.startedAt) : null;
  return d && !Number.isNaN(d.getTime()) ? d.getHours() : null;
};
const tests = (st) => hist(st).filter((s) => s.isTest && num(s.test?.vam) > 0)
  .sort((a, b) => String(a.startedAt || a.dayKey).localeCompare(String(b.startedAt || b.dayKey)));
const maxLevel = (st, k) => Math.max(num(st?.levels?.[k]), ...(Array.isArray(st?.levelHistory) ? st.levelHistory.map((e) => num(e?.levels?.[k])) : [0]));

function sessionsInMonthMax(st) {
  const per = {};
  for (const s of done(st)) {
    const d = sessionDay(s);
    if (d) per[d.slice(0, 7)] = (per[d.slice(0, 7)] || 0) + 1;
  }
  return Math.max(0, ...Object.values(per));
}

function hadFullWeek(st) {
  const perWeek = {};
  for (const s of done(st)) {
    const d = sessionDay(s);
    if (d) perWeek[mondayOf(d)] = (perWeek[mondayOf(d)] || 0) + 1;
  }
  return Object.entries(perWeek).some(([monday, n]) => {
    if (n < 4) return false;
    try {
      const wp = weekProgress(st, monday);
      return wp.plannedSessions >= 4 && wp.doneSessions >= wp.plannedSessions;
    } catch { return false; }
  });
}

function hadLevelUp(st) {
  if (hist(st).some((s) => Array.isArray(s.levelChanges) && s.levelChanges.some((c) => num(c.to) > num(c.from) && c.reason !== 'test'))) return true;
  const lh = Array.isArray(st?.levelHistory) ? st.levelHistory : [];
  for (let i = 1; i < lh.length; i++) {
    if (lh[i]?.reason !== 'progression') continue;
    if (['jog', 'run', 'fast', 'sprint'].some((k) => num(lh[i].levels?.[k]) > num(lh[i - 1]?.levels?.[k]))) return true;
  }
  return false;
}

function hadComeback(st) {
  const days = [...new Set(done(st).map(sessionDay).filter(Boolean))].sort();
  for (let i = 1; i < days.length; i++) {
    if (daysBetween(days[i - 1], days[i]) >= 14) return true;
  }
  return false;
}

const A = (id, title, description, icon, tier, check) => ({ id, title, description, icon, tier, check });

export const ACHIEVEMENTS = [
  // Sesiones
  A('first-run', 'Primera zancada', 'Completa tu primera sesión en BestRunning.', 'play', 'bronze', (s) => done(s).length >= 1),
  A('sessions-5', 'Cogiendo carrerilla', 'Completa 5 sesiones.', 'repeat', 'bronze', (s) => done(s).length >= 5),
  A('sessions-10', 'Diez de diez', 'Completa 10 sesiones.', 'medal', 'bronze', (s) => done(s).length >= 10),
  A('sessions-25', 'Hábito en marcha', 'Completa 25 sesiones: esto ya es rutina.', 'star', 'silver', (s) => done(s).length >= 25),
  A('sessions-50', 'Medio centenar', 'Completa 50 sesiones.', 'medal', 'silver', (s) => done(s).length >= 50),
  A('sessions-100', 'Centurión', 'Completa 100 sesiones. Respeto.', 'crown', 'gold', (s) => done(s).length >= 100),
  A('sessions-250', 'Leyenda de la cinta', 'Completa 250 sesiones.', 'trophy', 'gold', (s) => done(s).length >= 250),
  // Distancia acumulada
  A('km-10', 'Primeros 10 km', 'Acumula 10 km corriendo.', 'route', 'bronze', (s) => totals(hist(s)).km >= 10),
  A('km-50', '50 km en las piernas', 'Acumula 50 km.', 'route', 'bronze', (s) => totals(hist(s)).km >= 50),
  A('km-100', 'Club de los 100', 'Acumula 100 km.', 'route', 'silver', (s) => totals(hist(s)).km >= 100),
  A('km-250', 'Seis maratones', 'Acumula 250 km: más de seis maratones.', 'route', 'silver', (s) => totals(hist(s)).km >= 250),
  A('km-500', 'Medio millar', 'Acumula 500 km.', 'trophy', 'gold', (s) => totals(hist(s)).km >= 500),
  A('km-1000', 'Mil kilómetros', 'Acumula 1000 km. Eres de otra pasta.', 'crown', 'gold', (s) => totals(hist(s)).km >= 1000),
  // Tiempo y energía
  A('hours-10', 'Diez horas', 'Acumula 10 horas de entrenamiento.', 'timer', 'silver', (s) => totals(hist(s)).sec >= 36000),
  A('hours-50', 'Cincuenta horas', 'Acumula 50 horas de entrenamiento.', 'timer', 'gold', (s) => totals(hist(s)).sec >= 180000),
  A('kcal-10000', 'Horno a tope', 'Quema 10.000 kcal en total.', 'flame', 'silver', (s) => totals(hist(s)).kcal >= 10000),
  // Constancia
  A('full-week', 'Semana perfecta', 'Completa todas las sesiones de una semana del plan.', 'calendar', 'silver', hadFullWeek),
  A('streak-2', 'Dos semanas seguidas', 'Cumple 2 semanas seguidas con al menos 4 sesiones.', 'flame', 'bronze', (s) => streakWeeks(s, new Date()) >= 2),
  A('streak-4', 'Un mes imparable', 'Cumple 4 semanas seguidas con al menos 4 sesiones.', 'flame', 'silver', (s) => streakWeeks(s, new Date()) >= 4),
  A('streak-8', 'Dos meses de fuego', 'Cumple 8 semanas seguidas con al menos 4 sesiones.', 'flame', 'gold', (s) => streakWeeks(s, new Date()) >= 8),
  A('streak-12', 'Trimestre de hierro', 'Cumple 12 semanas seguidas con al menos 4 sesiones.', 'crown', 'gold', (s) => streakWeeks(s, new Date()) >= 12),
  A('month-20', 'Mes de récord', 'Completa 20 sesiones en un mismo mes.', 'calendar', 'gold', (s) => sessionsInMonthMax(s) >= 20),
  A('comeback', 'Vuelta a la carga', 'Vuelve a entrenar tras dos semanas o más de parón.', 'refresh', 'bronze', hadComeback),
  // Sesiones especiales
  A('hour-session', 'Una hora de cinta', 'Completa tu primera sesión de 60 minutos.', 'clock', 'bronze', (s) => hist(s).some((x) => num(x.elapsedSec) >= 3540 && num(x.completionPct) >= 0.9)),
  A('ten-k', 'Diez kilómetros', 'Corre 10 km en una sola sesión.', 'target', 'silver', (s) => hist(s).some((x) => num(x.distanceKm) >= 10)),
  A('early-bird', 'Madrugador', 'Entrena antes de las 7:00.', 'sun', 'bronze', (s) => done(s).some((x) => { const h = startHour(x); return h != null && h < 7; })),
  A('night-owl', 'Búho nocturno', 'Entrena a partir de las 22:00.', 'moon', 'bronze', (s) => done(s).some((x) => { const h = startHour(x); return h != null && h >= 22; })),
  A('challenge-10k', 'Reto 10K superado', 'Completa el Reto 10K.', 'trophy', 'gold', (s) => finished(s, 'challenge-10k')),
  A('the-hour', 'La hora completa', 'Completa La hora de principio a fin.', 'clock', 'gold', (s) => finished(s, 'the-hour')),
  A('hills-5', 'Escalador', 'Completa 5 sesiones de cuestas.', 'mountain', 'silver', (s) => done(s).filter((x) => x.category === 'hills').length >= 5),
  A('explorer', 'Explorador', 'Completa clases de 6 categorías distintas.', 'sparkles', 'silver', (s) => new Set(done(s).map((x) => x.category).filter(Boolean)).size >= 6),
  A('collector', 'Coleccionista', 'Completa 15 clases diferentes.', 'grid', 'silver', (s) => new Set(done(s).map((x) => x.templateId).filter(Boolean)).size >= 15),
  // Velocidad y progreso
  A('level-up', 'Primera subida', 'Sube por primera vez una de tus velocidades.', 'arrow-up', 'bronze', hadLevelUp),
  A('run-11', 'Crucero a 11', 'Lleva tu ritmo de correr a 11 km/h.', 'gauge', 'silver', (s) => maxLevel(s, 'run') >= 11),
  A('fast-12-5', 'Rápido de verdad', 'Lleva tu ritmo rápido a 12,5 km/h.', 'gauge', 'silver', (s) => maxLevel(s, 'fast') >= 12.5),
  A('sprint-14', 'Sprint de 14', 'Alcanza un sprint de 14 km/h.', 'bolt', 'silver', (s) => maxLevel(s, 'sprint') >= 14 || hist(s).some((x) => num(x.maxSpeed) >= 14 && num(x.timeInZone?.sprint) >= 30)),
  A('sprint-15', 'Velocidad de élite', 'Alcanza un sprint de 15 km/h.', 'bolt', 'gold', (s) => maxLevel(s, 'sprint') >= 15 || hist(s).some((x) => num(x.maxSpeed) >= 15 && num(x.timeInZone?.sprint) >= 30)),
  A('sprint-5min', 'Cinco minutos de sprint', 'Acumula 5 minutos a sprint en una sola sesión.', 'flame', 'silver', (s) => hist(s).some((x) => num(x.timeInZone?.sprint) >= 300)),
  A('sprint-60min', 'Una hora de sprints', 'Acumula 60 minutos a sprint entre todas tus sesiones.', 'bolt', 'gold', (s) => hist(s).reduce((a, x) => a + num(x.timeInZone?.sprint), 0) >= 3600),
  A('first-test', 'Primer test', 'Completa tu primer test VAM.', 'gauge', 'bronze', (s) => tests(s).length >= 1),
  A('vam-record', 'Récord de VAM', 'Supera tu VAM en un nuevo test.', 'trophy', 'silver', (s) => {
    const t = tests(s);
    let best = 0;
    for (let i = 0; i < t.length; i++) {
      const v = num(t[i].test.vam);
      if (i > 0 && v > best) return true;
      best = Math.max(best, v);
    }
    return false;
  }),
  // Hábitos
  A('feedback-10', 'Escucha tu cuerpo', 'Anota cómo te has sentido en 10 sesiones.', 'heart', 'bronze', (s) => hist(s).filter((x) => x.feeling).length >= 10),
  A('watch-hr', 'Corazón conectado', 'Anota por primera vez el pulso de tu Apple Watch.', 'watch', 'bronze', (s) => hist(s).some((x) => num(x.hrAvg) > 0 || num(x.hrMax) > 0)),
];

/** Logros que ya se cumplen y aún no están desbloqueados (sin la función check). */
export function evaluateAchievements(state) {
  const have = state?.achievements && typeof state.achievements === 'object' ? state.achievements : {};
  const out = [];
  for (const a of ACHIEVEMENTS) {
    if (have[a.id]) continue;
    let ok = false;
    try { ok = !!a.check(state || {}); } catch { ok = false; }
    if (ok) {
      const { check, ...rest } = a;
      out.push(rest);
    }
  }
  return out;
}
