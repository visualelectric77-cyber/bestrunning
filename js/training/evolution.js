// RITMUP · tu evolución semana a semana (sin DOM ni IA): pulso a una misma velocidad, velocidades, kilómetros y un
// veredicto por semana (fuerte, normal, flojo o sin correr). La app no diagnostica: ve que tu pulso fue anormalmente
// alto y lo dice; la causa (resfriado, cansancio…) sale de tus notas o la marcas tú.
import { buildHrModel, sessionHrOffset, steadyPoints, isHills } from './hr-model.js';
import { sessionDay, weekKeyOf } from './stats.js';
import { fmt, todayKey, addDays, mondayOf, daysBetween } from '../core/utils.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const MAX_WEEKS = 16;
const HARD_FEEL = new Set(['max', 'fail']);   // «Exigente» es una clase bien llevada (lo dice el Resumen y así lo trata el plan): solo cuentan como duras «Al límite» y «No pude»
const WEAK_HR = 5;           // ppm por encima de tus semanas anteriores para llamar «flojo» a una semana
const STRONG_HR = -4;

export const WEEK_TAGS = {
  cold: 'Resfriado', tired: 'Cansancio', sleep: 'Mal sueño', heat: 'Calor', pain: 'Molestias', other: 'Otra cosa',
};
const NOTE_TAGS = [
  [/resfri|constipa|catarro|gripe|fiebre|mocos|enferm/i, 'cold'],
  [/mal dorm|poco sue|sin dormir|insomni/i, 'sleep'],
  [/molest|dolor|lesi[oó]n/i, 'pain'],
  [/cansad|agotad|fatiga|reventad/i, 'tired'],
  [/calor|bochorn/i, 'heat'],
];
const SAID_WEAK = new Set(['cold', 'pain']); // si lo dices tú, la semana fue floja aunque el pulso no lo enseñe

const tagFromNotes = (list) => {
  for (const s of list) {
    const hit = NOTE_TAGS.find(([re]) => re.test(String(s.notes || '')));
    if (hit) return hit[1];
  }
  return null;
};

const shortDay = (key) => fmt.dateShort(key).split(' ').slice(1).join(' ');

function weekVerdict(w, base) {
  if (!w.sessions.length) return { state: 'off', reasons: [] };
  const reasons = [];
  let weak = false;
  let strong = false;
  if (w.hr != null && base != null) {
    const d = Math.round(w.hr - base);
    w.hrDelta = d;
    if (d >= WEAK_HR) { weak = true; reasons.push(`Pulso ${d} ppm más alto de lo normal en ti`); }
    else if (d <= STRONG_HR) { strong = true; reasons.push(`Pulso ${-d} ppm más bajo de lo normal en ti`); }
  }
  const rated = w.sessions.filter((s) => s.feeling);
  const hard = rated.filter((s) => HARD_FEEL.has(s.feeling)).length;
  if (rated.length >= 2 && hard / rated.length >= 0.6) {
    weak = weak || w.hr == null;
    reasons.push(`${hard} de ${rated.length} clases te costaron`);
  }
  const comp = mean(w.sessions.map((s) => num(s.completionPct)));
  if (w.sessions.length >= 2 && comp < 0.75) { weak = true; reasons.push(`Clases a medias: ${Math.round(comp * 100)} % de media`); }
  if (w.tag && SAID_WEAK.has(w.tag)) weak = true;
  if (!reasons.length && w.sessions.length >= 2 && w.scoreAvg != null && w.scoreAvg >= 85) { strong = true; reasons.push('Clases muy bien hechas'); }
  // Con una sola clase, la semana en curso aún no merece la palabra «fuerte»
  if (strong && w.inProgress && w.sessions.length < 2) strong = false;
  return { state: weak ? 'weak' : strong ? 'strong' : 'normal', reasons: reasons.slice(0, 2) };
}

function buildWeeks(state, items, now, model, refSpeed) {
  const today = todayKey(now);
  const thisMon = mondayOf(today);
  const firstMon = mondayOf(sessionDay(items[0].s));
  const span = Math.floor(daysBetween(firstMon, thisMon) / 7) + 1;
  const count = Math.max(1, Math.min(MAX_WEEKS, span));
  const tags = state?.ui?.weekTags && typeof state.ui.weekTags === 'object' ? state.ui.weekTags : {};
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const monday = addDays(thisMon, -7 * i);
    const sunday = addDays(monday, 6);
    // una clase adelantada cuenta en la semana del día que cubría, como en «Esta semana»
    const list = items.filter((it) => { const d = weekKeyOf(it.s); return d >= monday && d <= sunday; });
    const sessions = list.map((it) => it.s);
    const km = sessions.reduce((a, s) => a + num(s.distanceKm), 0);
    const sec = sessions.reduce((a, s) => a + num(s.elapsedSec), 0);
    let hr = null;
    if (model) {
      const offs = sessions.map((s) => sessionHrOffset(s, model)).filter(Boolean);
      const pts = offs.reduce((a, o) => a + o.points, 0);
      if (pts) hr = Math.round(model.at(refSpeed) + offs.reduce((a, o) => a + o.ppm * o.points, 0) / pts);
    }
    const scores = list.map((it) => it.ex.score).filter((v) => v != null);
    const rpes = sessions.map((s) => num(s.rpe)).filter((v) => v > 0);
    const lv = sessions.map((s) => num(s.levelsAtStart?.run)).filter((v) => v > 0);
    const noted = tagFromNotes(sessions);
    const week = {
      monday, sunday, label: `${shortDay(monday)} – ${shortDay(sunday)}`, inProgress: i === 0, sessions, km: Math.round(km * 10) / 10,
      min: Math.round(sec / 60), avgSpeed: sec > 0 ? Math.round((km / (sec / 3600)) * 10) / 10 : 0, hr, hrDelta: null, runSpeed: lv.length ? lv[lv.length - 1] : null,
      rpe: rpes.length ? Math.round(mean(rpes) * 10) / 10 : null, scoreAvg: scores.length ? Math.round(mean(scores)) : null,
      tag: WEEK_TAGS[tags[monday]] ? tags[monday] : noted, tagManual: !!WEEK_TAGS[tags[monday]],
      classes: list.map(({ s, ex }) => ({ id: s.id, title: s.title || 'Clase', day: sessionDay(s), km: num(s.distanceKm), min: Math.round(num(s.elapsedSec) / 60), hrAvg: num(s.hrAvg) || null, avgSpeed: num(s.avgSpeed), score: ex.score, label: ex.label, feeling: s.feeling || null, note: String(s.notes || '').slice(0, 80) })),
    };
    out.push(week);
  }
  // La referencia de cada semana son las anteriores que no fueron flojas: un bache no debe volverse «lo normal»
  const clean = [];
  for (const w of out) {
    const base = clean.length ? mean(clean.slice(-3)) : (w.hr != null && model ? Math.round(model.at(refSpeed)) : null);
    const v = weekVerdict(w, base);
    w.state = v.state;
    w.reasons = v.reasons;
    if (w.hr != null && w.state !== 'weak') clean.push(w.hr);
  }
  return out;
}

function compareRow(label, unit, a, b, f, lowerBetter, tol, fitness = false) {
  if (!a.length || !b.length) return null;
  const from = mean(a);
  const to = mean(b);
  const d = to - from;
  const better = Math.abs(d) < tol ? null : (d < 0) === lowerBetter;
  const delta = Math.abs(d) < tol ? '=' : `${d > 0 ? '+' : '−'}${f(Math.abs(d))}`;
  return { label, unit, from: f(from), to: f(to), delta, better, fitness };
}

function compareEras(weeks, refSpeed) {
  const active = weeks.filter((w) => w.sessions.length && !w.inProgress); // la semana en curso aún no tiene sus kilómetros
  if (active.length < 4) return null;
  const size = Math.min(3, Math.floor(active.length / 2));
  const early = active.slice(0, size);
  const late = active.slice(-size);
  const col = (list, fn) => list.map(fn).filter((v) => v != null && v > 0);
  // Los kilómetros por semana cuentan todas las semanas del calendario, también las que no corriste: si no, no sería
  // una media por semana sino «por semana que salió»
  const closed = weeks.filter((w) => !w.inProgress);
  const since = closed.slice(Math.max(0, closed.indexOf(active[0])));
  const rows = [
    compareRow(`Pulso a ${fmt.speed(refSpeed || 0)} km/h`, 'ppm', col(early, (w) => w.hr), col(late, (w) => w.hr), (v) => fmt.int(Math.round(v)), true, 2, true),
    compareRow('Velocidad de Correr', 'km/h', col(early, (w) => w.runSpeed), col(late, (w) => w.runSpeed), (v) => fmt.speed(v), false, 0.1, true),
    compareRow('Kilómetros por semana', 'km', since.slice(0, size).map((w) => w.km), since.slice(-size).map((w) => w.km), (v) => fmt.dec1(v), false, 1),
    compareRow('Esfuerzo que te cuesta', '/10', col(early, (w) => w.rpe), col(late, (w) => w.rpe), (v) => fmt.dec1(v), true, 0.5),
  ].filter(Boolean);
  if (!rows.length) return null;
  // Mandan el pulso y las velocidades: que hagas menos kilómetros un mes no significa que estés peor
  const fit = rows.filter((r) => r.fitness);
  const score = (list) => list.filter((r) => r.better === true).length - list.filter((r) => r.better === false).length;
  const trend = fit.length ? score(fit) : score(rows);   // con pulso o velocidades medidos, un empate es un empate: no lo deciden los kilómetros
  const verdict = trend > 0 ? { tone: 'good', title: 'Estás mejor que al empezar' }
    : trend < 0 ? { tone: 'warn', title: 'Has perdido algo de lo ganado' }
      : { tone: 'neutral', title: 'Te mantienes como al empezar' };
  return { rows, ...verdict, since: shortDay(active[0].monday), eraWeeks: size };
}

function highlights(weeks, refSpeed) {
  const withHr = weeks.filter((w) => w.hr != null && !w.inProgress);
  const done = weeks.filter((w) => w.sessions.length && !w.inProgress);
  let best = null;
  if (withHr.length >= 3) {
    const b = withHr.reduce((a, w) => (w.hr < a.hr ? w : a));
    best = { monday: b.monday, title: `Semana del ${shortDay(b.monday)}`, text: `${b.hr} ppm a ${fmt.speed(refSpeed)} km/h, el pulso más bajo que has tenido.` };
  } else if (done.length >= 3) {
    const b = done.reduce((a, w) => (w.km > a.km ? w : a));
    best = { monday: b.monday, title: `Semana del ${shortDay(b.monday)}`, text: `${fmt.dec1(b.km)} km, tu semana con más kilómetros.` };
  }
  let slump = null;
  const weakIdx = weeks.map((w, i) => (w.state === 'weak' ? i : -1)).filter((i) => i >= 0);
  if (weakIdx.length) {
    const i = weakIdx[weakIdx.length - 1];
    const w = weeks[i];
    const later = weeks.slice(i + 1).filter((x) => x.sessions.length);
    const back = later.some((x) => x.state !== 'weak');
    const cause = w.tag ? `${WEEK_TAGS[w.tag]}. ` : '';
    slump = { monday: w.monday, title: `Semana del ${shortDay(w.monday)}`, text: `${cause}${w.reasons[0] || 'Una semana floja'}. ${back ? 'Ya lo has recuperado.' : later.length ? 'Sigues sin recuperar del todo.' : 'Es la última: vigílalo.'}`, back };
  }
  return { best, slump };
}

/**
 * Media por semana de verdad, para lo que se rotula «km/semana» o «min/semana»: solo semanas completas (la que está en
 * curso aún no ha acabado) y solo desde la primera en la que corriste (las de antes no son semanas de cero).
 * buckets: [{ monday, km, sec }] de la más antigua a la actual · value: (cubo) → número · firstDay: tu primera clase.
 * → { avg (null sin semanas completas), weeks, prevAvg (null si no hay con qué comparar), prevWeeks, current }
 */
export function weeklyAverage(buckets, firstDay, value, span = 4) {
  const list = Array.isArray(buckets) ? buckets : [];
  const val = (b) => num(value(b));
  const closed = list.slice(0, -1);
  let from = closed.findIndex((b) => num(b.km) > 0 || num(b.sec) > 0);
  if (firstDay && list.length && firstDay < list[0].monday) from = 0; // llevas más tiempo del que cabe en la ventana
  const mine = from < 0 ? [] : closed.slice(from);
  const last = mine.slice(-span);
  const prev = mine.slice(-2 * span, -span);
  return {
    avg: last.length ? mean(last.map(val)) : null,
    weeks: last.length,
    prevAvg: prev.length ? mean(prev.map(val)) : null,
    prevWeeks: prev.length,
    current: list.length ? val(list[list.length - 1]) : 0,
  };
}

/** → { refSpeed, weeks (de más antigua a más nueva), compare, best, slump, counts } */
export function evolution(state, items, now = new Date()) {
  if (!Array.isArray(items) || !items.length) return null;
  const sessions = items.map((it) => it.s);
  let model = null;
  try { model = buildHrModel(sessions, { now: now.getTime(), windowDays: (MAX_WEEKS + 1) * 7 }); } catch { model = null; }
  let refSpeed = 0;
  if (model) {
    const speeds = sessions.filter((s) => !isHills(s)).flatMap((s) => steadyPoints(s).map((p) => p[0]));
    refSpeed = Math.round(mean(speeds) * 2) / 2;
    if (!(refSpeed > 0)) model = null;
  }
  const weeks = buildWeeks(state, items, now, model, refSpeed);
  const counts = { strong: 0, normal: 0, weak: 0, off: 0 };
  for (const w of weeks) if (!(w.inProgress && w.state === 'off')) counts[w.state]++;
  return { refSpeed, hasHr: !!model, weeks, compare: compareEras(weeks, refSpeed), ...highlights(weeks, refSpeed), counts };
}
