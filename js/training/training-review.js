// RITMUP · balance de todos tus entrenos (sin DOM ni IA): cómo vas, por qué y qué harías ahora.
// Cinco claves medidas (forma, constancia, carga, sensaciones e intensidad), cómo te salen las clases por tipo y una
// lista corta de prioridades. Si aún no hay datos para decir algo, lo dice; nunca rellena con cifras que no existen.
import { buildHrModel, sessionHrOffset } from './hr-model.js';
import { vamFromLevels } from './levels.js';
import { weekShape } from './week-shape.js';
import { countsAsSession } from './planner.js';
import { sessionDay, weekKeyOf } from './stats.js';
import { executionOf, segmentsOfSession, sessionLoad, sessionTime, CATEGORY_NAMES } from './class-analysis.js';
import { evolution } from './evolution.js';
import { fmt, todayKey, addDays, mondayOf, daysBetween, parseKey } from '../core/utils.js';

const NB = ' ';
const DAY_MS = 86400000;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pctTxt = (v) => `${Math.round(v)}${NB}%`;
const clases = (n) => `${n} ${n === 1 ? 'clase' : 'clases'}`;
const WD_PLURAL = { 1: 'los lunes', 2: 'los martes', 3: 'los miércoles', 4: 'los jueves', 5: 'los viernes', 6: 'los sábados', 7: 'los domingos' };
const weekdayOf = (key) => { const d = parseKey(key).getDay(); return d === 0 ? 7 : d; };
const HARD_FEEL = new Set(['max', 'fail']);   // la misma regla que el plan y el Resumen: «Exigente» no es mala señal
const EASY_CATS = new Set(['recovery', 'endurance']);
const LEARNING = 'learning';

/* ───────── Las cinco claves ───────── */

function vamChange(state, today) {
  const hist = (Array.isArray(state?.levelHistory) ? state.levelHistory : [])
    .filter((e) => e?.levels && typeof e.date === 'string')
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!hist.length || !state?.levels) return null;
  const cut = addDays(today, -28);
  const before = hist.filter((e) => e.date <= cut);
  const ref = before.length ? before[before.length - 1] : hist[0];
  const days = before.length ? 28 : daysBetween(ref.date, today);
  if (days < 7) return null;
  const a = num(vamFromLevels(ref.levels));
  const b = num(vamFromLevels(state.levels));
  // days: de cuándo es la referencia (28 = un mes; menos si tu historial de velocidades es más corto), para decirlo
  return a > 0 && b > 0 ? { d: Math.round((b - a) * 10) / 10, days } : null;
}

function formPillar(state, sessions, now, today) {
  const cut = now.getTime() - 28 * DAY_MS;
  let ppm = null;
  let n = 0;
  try {
    const model = buildHrModel(sessions.filter((s) => sessionTime(s) < cut), { now: cut });
    const offs = sessions.filter((s) => sessionTime(s) >= cut).map((s) => sessionHrOffset(s, model)).filter(Boolean);
    n = offs.length;
    if (n >= 3) ppm = Math.round(mean(offs.map((o) => o.ppm)));
  } catch { ppm = null; }
  const change = vamChange(state, today);
  const vam = change ? change.d : null;
  // El periodo que se dice es el que se mide: «en un mes» solo si hay velocidades de hace un mes
  const recent = !!change && change.days < 28;
  const span = !recent ? 'en un mes' : change.days < 14 ? `en ${change.days} días` : `en ${Math.round(change.days / 7)} semanas`;
  const pieces = [];
  if (vam != null && Math.abs(vam) >= 0.1) pieces.push(vam > 0 ? `Tus velocidades han subido ${fmt.speed(vam)} km/h ${span}.` : `Tus velocidades han bajado ${fmt.speed(-vam)} km/h ${span}.`);
  if (ppm != null && Math.abs(ppm) >= 3) pieces.push(ppm < 0 ? `A la misma velocidad, tu pulso va ${-ppm} ppm más bajo que hace un mes.` : `A la misma velocidad, tu pulso va ${ppm} ppm más alto que hace un mes.`);
  if (ppm == null && vam == null) {
    return { key: 'form', label: 'Forma', icon: 'heart', status: LEARNING, value: 'Sin datos aún', short: '', body: 'Con el pulso de tres clases más y un mes de historia te diré si tu corazón trabaja más cómodo.' };
  }
  const good = (ppm != null && ppm <= -3) || (vam != null && vam >= 0.2);
  const bad = !good && ((ppm != null && ppm >= 4) || (vam != null && vam <= -0.2));
  const value = ppm != null && Math.abs(ppm) >= 3 ? `${ppm > 0 ? '+' : '−'}${Math.abs(ppm)} ppm` : vam != null && Math.abs(vam) >= 0.1 ? `${vam > 0 ? '+' : '−'}${fmt.speed(Math.abs(vam))} km/h` : 'Estable';
  if (!pieces.length) pieces.push(recent && ppm == null ? `Tus velocidades no han cambiado ${span}.` : 'Tu pulso y tus velocidades se mantienen como hace un mes.');
  return { key: 'form', label: 'Forma', icon: 'heart', status: good ? 'good' : bad ? 'warn' : 'neutral', value, ppm, vam, sinceDays: recent && ppm == null ? change.days : 28, short: pieces[0], body: pieces.join(' ') };
}

function consistencyPillar(state, sessions, today) {
  const shape = weekShape(state?.schedule);
  const perWeek = shape.trainDays.length;
  const first = sessions.length ? sessionDay(sessions[0]) : null;
  if (!first || !perWeek) return { key: 'constancy', label: 'Constancia', icon: 'calendar', status: LEARNING, value: 'Sin datos aún', short: '', body: '' };
  // Solo semanas ya cerradas y desde que empezaste: la que está en curso aún no se puede dar por perdida
  const thisMonday = mondayOf(today);
  const firstMonday = mondayOf(first);
  const mondays = [];
  for (let i = 4; i >= 1; i--) { const m = addDays(thisMonday, -7 * i); if (m >= firstMonday) mondays.push(m); }
  if (!mondays.length) {
    return { key: 'constancy', label: 'Constancia', icon: 'calendar', status: LEARNING, value: 'Primera semana', short: '', body: `Tu semana tiene ${perWeek} ${perWeek === 1 ? 'día' : 'días'}. Cuando cierres la primera te digo qué tal la has cumplido.` };
  }
  const byWeek = new Map(mondays.map((m) => [m, new Set()]));
  for (const s of sessions) {
    const k = weekKeyOf(s);
    const set = k && byWeek.get(mondayOf(k));
    if (set) set.add(k);
  }
  // Cada semana cuenta solo los días desde tu primera clase: si empezaste un sábado, los días de antes no están «perdidos»
  const due = (m) => shape.trainDays.filter((w) => addDays(m, w - 1) >= first).length;
  const planned = mondays.reduce((a, m) => a + due(m), 0);
  const done = mondays.reduce((a, m) => a + Math.min(due(m), byWeek.get(m).size), 0);
  const pct = planned ? (done / planned) * 100 : 0;
  // El día que más se te cae: solo si se cae de verdad y no es que falles todos por igual
  let weakDay = null;
  if (mondays.length >= 3 && perWeek >= 2) {
    const miss = shape.trainDays.map((w) => ({ w, n: mondays.filter((m) => !byWeek.get(m).has(addDays(m, w - 1))).length }));
    const worst = miss.reduce((a, b) => (b.n > a.n ? b : a));
    if (worst.n >= 2 && miss.filter((x) => x.n === worst.n).length === 1) weakDay = { day: worst.w, missed: worst.n, of: mondays.length };
  }
  // Con una sola semana cerrada aún no se juzga: puede ser solo un mal arranque
  const status = pct >= 85 ? 'good' : pct >= 60 || mondays.length < 2 ? 'neutral' : 'warn';
  const short = `Has hecho ${done} de ${planned} ${planned === 1 ? 'clase' : 'clases'} de ${mondays.length === 1 ? 'tu última semana' : `tus últimas ${mondays.length} semanas`}.`;
  const extra = weakDay ? ` Lo que más se te cae son ${WD_PLURAL[weakDay.day]}: ${weakDay.missed} de ${weakDay.of}.` : '';
  return { key: 'constancy', label: 'Constancia', icon: 'calendar', status, value: `${done} de ${planned}`, pct, weakDay, short, body: short + extra };
}

function loadPillar(sessions, today) {
  const first = sessions.length ? sessionDay(sessions[0]) : null;
  const age = first ? daysBetween(first, today) : 0;
  if (age < 21) {
    const left = Math.max(1, 21 - age);
    return { key: 'load', label: 'Carga', icon: 'flame', status: LEARNING, value: 'Sin datos aún', short: '', body: `Necesito tres semanas para saber qué es normal en ti: me ${left === 1 ? 'falta 1 día' : `faltan ${left} días`}.` };
  }
  const inLast = (d) => sessions.filter((s) => { const k = sessionDay(s); return k && k > addDays(today, -d) && k <= today; });
  const acute = inLast(7).reduce((a, s) => a + sessionLoad(s), 0);
  const chronic = inLast(28).reduce((a, s) => a + sessionLoad(s), 0) / 4;
  if (!(chronic > 0)) return { key: 'load', label: 'Carga', icon: 'flame', status: 'neutral', value: 'Parada', short: '', body: 'No hay clases en las últimas cuatro semanas.' };
  const ratio = acute / chronic;
  const change = Math.round((ratio - 1) * 100);
  if (ratio > 1.4) return { key: 'load', label: 'Carga', icon: 'flame', status: 'warn', value: `+${change}${NB}%`, ratio, short: `Esta semana llevas un ${change}${NB}% más de carga que tu media del mes.`, body: `Esta semana llevas un ${change}${NB}% más de carga que tu media del mes. Es una subida brusca y las lesiones suelen venir de ahí.` };
  if (ratio < 0.6) return { key: 'load', label: 'Carga', icon: 'flame', status: 'neutral', value: `−${-change}${NB}%`, ratio, short: `Esta semana llevas un ${-change}${NB}% menos de carga que tu media del mes.`, body: `Esta semana llevas un ${-change}${NB}% menos de carga que tu media del mes. Bien si es descanso buscado.` };
  return { key: 'load', label: 'Carga', icon: 'flame', status: 'good', value: 'En su punto', ratio, short: 'Tu carga sube y baja sin saltos bruscos.', body: `Tu carga de esta semana está ${change === 0 ? 'justo en' : change > 0 ? `un ${change}${NB}% por encima de` : `un ${-change}${NB}% por debajo de`} tu media del mes: sin saltos bruscos.` };
}

function feelPillar(sessions) {
  const rated = sessions.filter((s) => s.feeling).slice(-10);
  if (rated.length < 3) {
    return { key: 'feel', label: 'Sensaciones', icon: 'gauge', status: LEARNING, value: 'Sin datos aún', short: '', body: 'Valora tres clases y te cuento si el plan te aprieta o te sobra.' };
  }
  const hard = rated.filter((s) => HARD_FEEL.has(s.feeling)).length;
  const easy = rated.filter((s) => s.feeling === 'easy').length;
  const share = hard / rated.length;
  const dist = { easy, ok: rated.filter((s) => s.feeling === 'ok').length, hard };
  const value = `${hard} de ${rated.length} duras`;
  const lead = `De tus últimas ${clases(rated.length)}, ${hard === 1 ? 'una te ha costado' : `${hard} te han costado`}.`;
  if (share >= 0.6) return { key: 'feel', label: 'Sensaciones', icon: 'gauge', status: 'warn', value, share, dist, short: lead, body: `${lead} Si sigue así, conviene aflojar para asimilar.` };
  if (easy / rated.length >= 0.7) return { key: 'feel', label: 'Sensaciones', icon: 'gauge', status: 'neutral', value: `${easy} de ${rated.length} fáciles`, share, dist, short: 'Casi todas se te hacen fáciles.', body: 'Casi todas se te hacen fáciles: hay margen para apretar. El plan irá subiendo.' };
  return { key: 'feel', label: 'Sensaciones', icon: 'gauge', status: 'good', value, share, dist, short: lead, body: `${lead} Un buen equilibrio entre apretar y disfrutar.` };
}

function intensityPillar(state, sessions, now) {
  const since = now.getTime() - 28 * DAY_MS;
  const recent = sessions.filter((s) => sessionTime(s) >= since);
  let easySec = 0;
  let hardSec = 0;
  for (const s of recent) {
    const t = s.timeInZone || {};
    easySec += num(t.walk) + num(t.warmup) + num(t.cooldown) + num(t.jog);
    hardSec += num(t.run) + num(t.fast) + num(t.sprint);
  }
  const total = easySec + hardSec;
  if (recent.length < 3 || !total) {
    return { key: 'intensity', label: 'Intensidad', icon: 'bolt', status: LEARNING, value: 'Sin datos aún', short: '', body: 'Con tres clases este mes te digo si repartes bien lo suave y lo duro.' };
  }
  const zonePcts = [];
  let easyHigh = [];
  for (const s of recent) {
    const ex = executionOf(s, segmentsOfSession(state, s), state?.profile || {});
    if (!ex.zone) continue;
    zonePcts.push(ex.zone.pct);
    if (EASY_CATS.has(s.category)) easyHigh.push((ex.zone.highSec / ex.zone.sec) * 100);
  }
  const hardPct = (hardSec / total) * 100;
  const zonePct = zonePcts.length >= 3 ? Math.round(mean(zonePcts)) : null;
  const tooHardEasy = easyHigh.length >= 2 && mean(easyHigh) >= 25;
  const spread = `El ${pctTxt(100 - hardPct)} de tu tiempo es suave y el ${pctTxt(hardPct)} a ritmo de Correr o más.`;
  const parts = [];
  if (zonePct != null) parts.push(`De media vas el ${pctTxt(zonePct)} del trabajo en tu zona de pulso.`);
  if (tooHardEasy) parts.push(`En tus días suaves te pasas de pulso el ${pctTxt(mean(easyHigh))} del tiempo.`);
  parts.push(spread);
  const warn = tooHardEasy || hardPct > 45 || (zonePct != null && zonePct < 45);
  const good = !warn && (zonePct == null || zonePct >= 60);
  return { key: 'intensity', label: 'Intensidad', icon: 'bolt', status: warn ? 'warn' : good ? 'good' : 'neutral', value: zonePct != null ? `${pctTxt(zonePct)} en zona` : `${pctTxt(100 - hardPct)} suave`, hardPct, zonePct, tooHardEasy, short: parts[0], body: parts.join(' ') };
}

/* ───────── Clases ───────── */

function scored(state, sessions) {
  return sessions.map((s) => ({ s, ex: executionOf(s, segmentsOfSession(state, s), state?.profile || {}) }));
}

function byCategory(items, now) {
  const since = now.getTime() - 56 * DAY_MS;
  const map = new Map();
  for (const it of items) {
    if (sessionTime(it.s) < since || !it.s.category || !CATEGORY_NAMES[it.s.category]) continue;
    const g = map.get(it.s.category) || { cat: it.s.category, name: CATEGORY_NAMES[it.s.category], n: 0, scores: [], rpes: [], km: 0 };
    g.n++;
    g.km += num(it.s.distanceKm);
    if (it.ex.score != null) g.scores.push(it.ex.score);
    if (num(it.s.rpe) > 0) g.rpes.push(num(it.s.rpe));
    map.set(it.s.category, g);
  }
  const rows = [...map.values()].map((g) => ({
    cat: g.cat, name: g.name, n: g.n, km: Math.round(g.km * 10) / 10,
    score: g.scores.length ? Math.round(mean(g.scores)) : null,
    rpe: g.rpes.length ? Math.round(mean(g.rpes) * 10) / 10 : null,
  })).sort((a, b) => b.n - a.n);
  const withScore = rows.filter((r) => r.n >= 2 && r.score != null);
  const withRpe = rows.filter((r) => r.n >= 2 && r.rpe != null);
  let best = null;
  let hardest = null;
  if (withScore.length >= 2) best = withScore.reduce((a, b) => (b.score > a.score ? b : a));
  if (withRpe.length >= 2) hardest = withRpe.reduce((a, b) => (b.rpe > a.rpe ? b : a));
  if (best && hardest && best.cat === hardest.cat) hardest = null;
  return { rows, best, hardest };
}

function scoreTrend(items) {
  const list = items.filter((it) => it.ex.score != null).slice(-12);
  if (list.length < 3) return null;
  const half = Math.floor(list.length / 2);
  const older = mean(list.slice(0, half).map((it) => it.ex.score));
  const newer = mean(list.slice(-half).map((it) => it.ex.score));
  return {
    avg: Math.round(mean(list.map((it) => it.ex.score))),
    delta: list.length >= 6 ? Math.round(newer - older) : null,
    half, // el delta compara tus últimas `half` clases con las `half` primeras de la lista
    points: list.map((it) => ({ id: it.s.id, day: sessionDay(it.s), score: it.ex.score, title: it.s.title || 'Clase' })),
  };
}

/* ───────── Veredicto y prioridades ───────── */

function verdictOf(p, n, idle) {
  if (n < 3) return { tone: 'start', title: n === 1 ? 'Primera clase hecha' : 'Buen arranque', body: `Llevas ${clases(n)}. A partir de 3 empiezo a darte un balance de verdad.` };
  if (idle >= 14) return { tone: 'back', title: 'Toca volver', body: `Llevas ${idle} días sin correr. Vuelve con calma: el plan se adapta a ti y no intenta recuperar lo perdido.` };
  const join = (...a) => a.filter(Boolean).join(' ');
  if (p.load.status === 'warn') return { tone: 'warn', title: 'Has subido muy rápido', body: join(p.load.short, p.feel.status === 'warn' ? p.feel.short : '') };
  if (p.feel.status === 'warn' && p.form.status !== 'good') return { tone: 'warn', title: 'Te está costando asimilar', body: join(p.feel.short, p.form.status === 'warn' ? p.form.short : '') };
  if (p.constancy.status === 'warn') return { tone: 'warn', title: 'La constancia es tu freno', body: join(p.constancy.short, p.form.status === 'good' ? `Y aun así: ${p.form.short.charAt(0).toLowerCase()}${p.form.short.slice(1)}` : 'Con tu plan cumplido, la mejora viene sola.') };
  if (p.form.status === 'good') return { tone: 'good', title: 'Vas a mejor', body: join(p.form.short, p.constancy.status !== LEARNING ? p.constancy.short : '') };
  if (p.form.status === 'warn') return { tone: 'warn', title: p.form.sinceDays < 28 ? 'Algo más cargado que al empezar' : 'Algo más cargado que hace un mes', body: join(p.form.short, 'Revisa sueño y descanso antes de sumar más.') };
  if (p.constancy.status === 'good') return { tone: 'good', title: 'Constante y sin altibajos', body: join(p.constancy.short, p.form.status === LEARNING ? 'Con el pulso del reloj podré decirte además si estás mejorando por dentro.' : p.form.short) };
  return { tone: 'neutral', title: 'En tu línea', body: join(p.constancy.short, p.feel.short) };
}

function actionsOf(p, hasHr) {
  const out = [];
  if (p.load.status === 'warn') out.push({ icon: 'flame', title: 'No sumes más esta semana', text: 'Haz solo lo planeado: el cuerpo necesita ponerse al día con la subida.', href: '#/plan' });
  if (p.feel.status === 'warn') out.push({ icon: 'moon', title: 'Date una clase suave', text: 'Si llevas varias duras seguidas, cambia la próxima por algo suave desde el Plan.', href: '#/plan' });
  if (p.intensity.tooHardEasy) out.push({ icon: 'gauge', title: 'Tus días suaves, más suaves', text: 'Baja la velocidad cuando tu pulso se pase. Así llegas con fuerza a los días que aprietan.' });
  if (p.constancy.status === 'warn') {
    out.push(p.constancy.weakDay
      ? { icon: 'calendar', title: `Replantea ${p.constancy.weakDay.day === 6 || p.constancy.weakDay.day === 7 ? 'el fin de semana' : WD_PLURAL[p.constancy.weakDay.day]}`, text: 'Mejor un día que cumples que uno que siempre se cae. Ajústalo en Mi semana.', href: '#/settings/week' }
      : { icon: 'calendar', title: 'Ajusta tu semana a tu vida real', text: 'Menos días, pero que se cumplan, te harán mejorar más.', href: '#/settings/week' });
  } else if (p.constancy.weakDay) {
    out.push({ icon: 'calendar', title: `Vigila ${WD_PLURAL[p.constancy.weakDay.day]}`, text: 'Es el día que más se te cae. Si no te encaja, muévelo en Mi semana.', href: '#/settings/week' });
  }
  if (!hasHr) out.push({ icon: 'watch', title: 'Corre con el reloj', text: 'Con el pulso veré cómo se adapta tu corazón, y este balance será mucho más preciso.', href: '#/settings/watch' });
  if (p.feel.status === 'neutral') out.push({ icon: 'bolt', title: 'Tienes margen', text: 'Valora con sinceridad: si sigue fácil, tus velocidades irán subiendo solas.' });
  if (!out.length) out.push({ icon: 'check', title: 'Sigue con el plan', text: 'Vas bien. No cambies nada: la constancia es lo que está funcionando.' });
  return out.slice(0, 3);
}

/**
 * → null (sin clases) o { verdict, pillars, trend, types, evolution, actions, count }.
 * Tests aparte: miden, no entrenan, y sus cifras ya salen en su propia tarjeta.
 */
export function trainingReview(state, now = new Date()) {
  const history = (Array.isArray(state?.history) ? state.history : []).filter((s) => s && typeof s === 'object');
  const sessions = history.filter((s) => !s.isTest && countsAsSession(s)).sort((a, b) => sessionTime(a) - sessionTime(b));
  if (!sessions.length) return null;
  const today = todayKey(now);
  const items = scored(state, sessions);
  const p = {
    form: formPillar(state, sessions, now, today),
    constancy: consistencyPillar(state, sessions, today),
    load: loadPillar(sessions, today),
    feel: feelPillar(sessions),
    intensity: intensityPillar(state, sessions, now),
  };
  const last = sessionDay(sessions[sessions.length - 1]);
  const idle = last ? Math.max(0, daysBetween(last, today)) : 0;
  const hasHr = sessions.some((s) => Array.isArray(s.hrSeries) && s.hrSeries.length >= 30);
  return {
    count: sessions.length,
    verdict: verdictOf(p, sessions.length, idle),
    pillars: [p.form, p.constancy, p.load, p.feel, p.intensity],
    trend: scoreTrend(items),
    types: byCategory(items, now),
    evolution: evolution(state, items, now),
    actions: sessions.length >= 3 ? actionsOf(p, hasHr) : [],
  };
}
