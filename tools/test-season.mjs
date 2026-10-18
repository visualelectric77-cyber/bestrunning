// BestRunning · simulación de temporada (Node 22): node tools/test-season.mjs [--verbose]
// 52 semanas con el perfil del dueño (46 años, 78 kg, 8,3/10,1/11,5/13,0 km/h, inclinación 12 %, L-V 20′, J 50′, S 50′,
// D descanso) con sesiones perdidas y sensaciones aleatorias pero con semilla. Comprueba horario, ventanas sin repetir,
// variedad por mesociclo, carga semanal, descargas, tiempo suave, tests cada 6 semanas, eventos y adaptación.
import { TEMPLATES, getTemplate } from '../js/training/templates.js';
import {
  planWeek, cycleInfo, seasonInfo, seasonCalendar, seasonWeek, setPlannerToday, nextTestDate, WINDOW_SHORT, WINDOW_LONG,
} from '../js/training/planner.js';
import { templateMeta, EVENTS, eventOn, SEASON_WEEKS, isTestWeekIndex, THEMES } from '../js/training/season.js';
import { applyFeedback } from '../js/training/progression.js';
import { defaultState, migrateState } from '../js/core/store.js';
import { addDays, daysBetween, makeRng, hashStr, deepClone, weekdayOf } from '../js/core/utils.js';

const VERBOSE = process.argv.includes('--verbose');
let checks = 0;
let fails = 0;
const failures = [];
const ok = (cond, msg) => { checks++; if (!cond) { fails++; if (failures.length < 60) failures.push(msg); } return !!cond; };
const out = [];
const line = (s = '') => out.push(s);
const pct = (x) => `${Math.round(x * 100)} %`;
const EASY = ['jog', 'walk', 'warmup', 'cooldown'];
const BIG = TEMPLATES.length >= 100;

const START = '2026-10-12';
function ownerState(over = {}) {
  const st = defaultState();
  Object.assign(st, {
    onboarded: true,
    createdAt: `${START}T08:00:00.000Z`,
    profile: { name: 'Nacho', age: 46, weightKg: 78, sex: 'm', hrMax: 174, hrRest: 64 },
    levels: { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 },
    schedule: { weekdayMinutes: 20, thursdayMinutes: 50, weekendDay: 6, weekendMinutes: 50, reminderTime: '07:00' },
    plan: { startDate: START, overrides: {} },
    treadmill: { hasIncline: true, maxIncline: 12, minSpeed: 1.0, maxSpeed: 18.0, announceLead: 10 },
  });
  for (const [k, v] of Object.entries(over)) st[k] = { ...st[k], ...v };
  return st;
}

/* ───────────── Migración y objeto de temporada ───────────── */
{
  const legacy = ownerState();
  delete legacy.plan.season;
  const m = migrateState(deepClone(legacy), 2);
  ok(m.plan?.season && m.plan.season.startDate === START && m.plan.season.weeks === 52, 'migración: plan.season creado desde plan.startDate (2026-10-12)');
  ok(m.plan.startDate === START && m.plan.overrides && typeof m.plan.overrides === 'object', 'migración: startDate y overrides intactos');
  const again = migrateState(deepClone(m), 2);
  ok(JSON.stringify(again.plan) === JSON.stringify(m.plan), 'migración idempotente');
  const fresh = migrateState(defaultState(), 2);
  ok(fresh.plan.season && fresh.plan.season.startDate === null, 'estado nuevo: temporada sin fecha hasta el onboarding');
}

/* ───────────── Simulación de 52 semanas ───────────── */

const st = ownerState();
const rng = makeRng(hashStr(`season-sim|owner|${process.env.SEASON_SEED || 'v1'}`));
const FEELS = [['easy', 0.22], ['ok', 0.5], ['hard', 0.2], ['max', 0.06], ['fail', 0.02]];
const pickFeel = () => {
  let x = rng.next();
  for (const [f, p] of FEELS) { if ((x -= p) < 0) return f; }
  return 'ok';
};
const VACATION_W = 21;     // semana entera perdida → semana de vuelta
const HARD_W = 30;         // racha dura → semana más ligera
const EASY_W = [40, 41];   // racha fácil → permite subir niveles
const MISS_W = 9;          // semana con 3 sesiones perdidas → sin subir carga
const snapshots = [];
let levelBumps = 0;

for (let W = 0; W < SEASON_WEEKS; W++) {
  const monday = addDays(START, W * 7);
  setPlannerToday(monday);
  const days = planWeek(st, monday, new Date(`${monday}T07:00:00`));
  snapshots.push(days.map((d) => d.templateId || null));
  let missedHere = 0;
  for (const d of days) {
    if (!d.workout) continue;
    let miss = rng.chance(0.08);
    if (W === VACATION_W) miss = true;
    if (W === MISS_W && missedHere < 3 && d.kind === 'short') miss = true;
    if (miss) { missedHere++; continue; }
    let feeling = pickFeel();
    if (W === HARD_W) feeling = rng.chance(0.5) ? 'max' : 'fail';
    if (EASY_W.includes(W)) feeling = 'easy';
    const w = d.workout;
    const session = {
      id: `sim-${d.date}`, dayKey: d.date, planDate: d.date, startedAt: `${d.date}T07:00:00.000Z`,
      templateId: w.templateId, workoutId: w.id, completed: true, completionPct: 1, elapsedSec: w.totalSec, plannedSec: w.totalSec,
      finishedEarly: false, timeInZone: { ...w.timeInZone }, isTest: w.isTest, feeling, levelsAtStart: { ...st.levels },
      test: w.isTest ? { vam: Math.round((13 + W * 0.01 + rng.next() * 0.4) * 10) / 10 } : null,
    };
    st.history.push(session);
    const res = applyFeedback(st, session, { feeling });
    if (res.changes.some((c) => c.to > c.from)) levelBumps++;
    st.levels = res.levels;
    st.progression = res.progression;
  }
}

// Plan final (todo el historial conocido): mismo plan que se vio cada lunes
setPlannerToday(addDays(START, SEASON_WEEKS * 7));
const weeks = [];
for (let W = 0; W < SEASON_WEEKS; W++) {
  const monday = addDays(START, W * 7);
  const days = planWeek(st, monday, new Date(2030, 0, 1));
  const info = cycleInfo(st, monday);
  const def = seasonWeek(st, W);
  const train = days.filter((d) => d.workout);
  const load = train.reduce((a, d) => a + d.workout.load, 0);
  const easy = train.reduce((a, d) => a + EASY.reduce((b, z) => b + (d.workout.timeInZone[z] || 0), 0), 0);
  const total = train.reduce((a, d) => a + d.workout.totalSec, 0);
  weeks.push({ W, monday, days, info, def, train, load, easyShare: easy / total, minutes: total / 60 });
}
const same = weeks.filter((w, i) => w.days.every((d, j) => (d.templateId || null) === snapshots[i][j])).length;
ok(same === SEASON_WEEKS, `estabilidad: el plan de cada semana es el que se vio su lunes (${same}/${SEASON_WEEKS})`);

/* 1 · Horario */
const sch = st.schedule;
for (const w of weeks) {
  const tag = `sem ${w.W + 1}`;
  ok(w.days.length === 7 && w.days.filter((d) => d.kind === 'rest').length === 1 && w.days[6].kind === 'rest', `${tag}: 6 sesiones y domingo de descanso`);
  for (const d of w.train) {
    const wd = weekdayOf(d.date);
    const max = wd === 4 ? sch.thursdayMinutes : wd === 6 ? sch.weekendMinutes : sch.weekdayMinutes;
    ok(d.minutes <= max && d.minutes >= 20, `${tag} ${d.date}: ${d.minutes}′ cabe en ${max}′`);
    if (!w.info.isDeload && d.kind !== 'test') ok(d.minutes === max, `${tag} ${d.date}: semana de carga = horario (${d.minutes}′/${max}′)`);
    if (d.kind !== 'test') ok(d.workout.totalSec === d.minutes * 60, `${tag} ${d.date}: duración exacta`);
    ok(!getTemplate(d.templateId).requiresIncline || st.treadmill.hasIncline, `${tag}: inclinación disponible`);
  }
  ok(['long', 'test'].includes(w.days[3].kind) && w.days[5].kind === 'long', `${tag}: jueves y sábado son las sesiones clave`);
}

/* 2 · Variedad: ventanas, familias, distintas por mesociclo */
const seq = weeks.flatMap((w) => w.train.map((d) => ({ date: d.date, id: d.templateId, long: d.kind === 'long', family: templateMeta(getTemplate(d.templateId)).family, role: d.role })));
const lastAt = new Map();
let repeats = 0;
const repeatList = [];
const gaps = [];
for (const s of seq) {
  if (s.id === 'test-vam') continue;
  const prev = lastAt.get(s.id);
  if (prev) {
    const g = daysBetween(prev, s.date);
    gaps.push(g);
    if (g < (s.long ? WINDOW_LONG : WINDOW_SHORT)) { repeats++; repeatList.push(`${s.id} ${prev}→${s.date} (${g} d)`); }
  }
  lastAt.set(s.id, s.date);
}
let famRow = 0;
for (let i = 1; i < seq.length; i++) if (seq[i].family === seq[i - 1].family) famRow++;
let hardRow = 0;
const hardDays = new Set(seq.filter((s) => s.role === 'hard' || s.role === 'test').map((s) => s.date));
for (const d of hardDays) if (hardDays.has(addDays(d, -1))) hardRow++;
const repeatMax = BIG ? 0 : 6;
ok(repeats <= repeatMax, `sin repetir plantilla en ${WINDOW_SHORT} d (entre semana) / ${WINDOW_LONG} d (J/S): ${repeats} repeticiones (máx ${repeatMax}${BIG ? '' : ', catálogo pequeño'})`);
ok(famRow <= (BIG ? 0 : 3), `nunca la misma familia dos sesiones seguidas: ${famRow}`);
ok(hardRow === 0, `nunca dos días duros seguidos: ${hardRow}`);
const minDistinct = BIG ? 14 : Math.min(14, Math.floor(TEMPLATES.length * 0.45));
const perMeso = [];
for (let m = 0; m < 13; m++) {
  const ids = new Set(weeks.slice(m * 4, m * 4 + 4).flatMap((w) => w.train.map((d) => d.templateId)));
  perMeso.push(ids.size);
  ok(ids.size >= minDistinct, `mesociclo ${m + 1}: ${ids.size} plantillas distintas (≥ ${minDistinct})`);
}
const themes = seasonCalendar(st, START).map((c) => c.theme.key);
ok(new Set(themes).size === 13, `13 temas distintos en la temporada (${themes.join(', ')})`);
ok(seasonCalendar(st, START).map((c) => c.phase.key).join(',') === 'base,base,base,construccion,construccion,construccion,especifico,especifico,especifico,picos,picos,picos,transicion', 'fases Base 1-3 · Construcción 4-6 · Específico 7-9 · Picos 10-12 · Transición 13');
const surpriseWeeks = weeks.filter((w) => w.days.some((d) => d.surprise)).length;
const eventWeeks = weeks.filter((w) => w.days.some((d) => d.event)).length;
ok(weeks.every((w) => w.days.filter((d) => d.surprise || d.event).length === 1), 'cada semana: una sorpresa o un evento (nunca ambos)');

/* 3 · Carga y tiempo suave */
const growthBad = [];
const deloadBad = [];
for (let i = 1; i < weeks.length; i++) {
  const a = weeks[i - 1];
  const b = weeks[i];
  const r = b.load / a.load;
  if (b.info.isDeload) {
    // la descarga se mide frente a la última semana de carga normal si la anterior ya fue aligerada (vuelta/fatiga)
    let ref = a.load;
    if (['return', 'tired'].includes(a.def.adapt.mode)) {
      const n = weeks.slice(Math.max(0, i - 4), i - 1).reverse().find((x) => !x.info.isDeload && !['return', 'tired'].includes(x.def.adapt.mode));
      if (n) ref = Math.max(ref, n.load);
    }
    if (b.load / ref > 0.7) deloadBad.push(`sem ${i + 1}: ${pct(b.load / ref)}`);
  } else if (!a.info.isDeload && r > 1.1) growthBad.push(`sem ${i + 1}: +${pct(r - 1)}`);
}
ok(!growthBad.length, `carga semanal ≤ +10 % salvo tras descarga (${growthBad.join(', ') || 'ok'})`);
ok(!deloadBad.length, `descargas ≤ 70 % de la semana anterior (${deloadBad.join(', ') || 'ok'})`);
for (const w of weeks) {
  // semanas de carga: 70-85 %; la descarga (≈65 % de carga) puede ser casi toda suave (cuenta en la media del mesociclo)
  if (w.info.isDeload) ok(w.easyShare >= 0.7, `sem ${w.W + 1}: tiempo suave ${pct(w.easyShare)} ≥ 70 % (descarga)`);
  else if (['return', 'tired'].includes(w.def.adapt.mode)) ok(w.easyShare >= 0.7 && w.easyShare <= 0.92, `sem ${w.W + 1}: tiempo suave ${pct(w.easyShare)} en 70-92 % (semana aligerada)`);
  else ok(w.easyShare >= 0.7 && w.easyShare <= 0.85, `sem ${w.W + 1}: tiempo suave ${pct(w.easyShare)} en 70-85 %`);
}
const mesoEasy = [];
for (let m = 0; m < 13; m++) {
  const ws = weeks.slice(m * 4, m * 4 + 4);
  const e = ws.reduce((a, w) => a + w.easyShare * w.minutes, 0) / ws.reduce((a, w) => a + w.minutes, 0);
  mesoEasy.push(e);
  ok(e >= 0.7 && e <= 0.85, `mesociclo ${m + 1}: tiempo suave ${pct(e)} en 70-85 %`);
}
const seasonEasy = weeks.reduce((a, w) => a + w.easyShare * w.minutes, 0) / weeks.reduce((a, w) => a + w.minutes, 0);
ok(seasonEasy >= 0.73 && seasonEasy <= 0.82, `temporada: tiempo suave ${pct(seasonEasy)} (objetivo 75-80 %)`);

/* 4 · Tests cada 6 semanas */
const testDates = seq.filter((s) => s.id === 'test-vam').map((s) => s.date);
ok(weeks.every((w) => w.train.filter((d) => d.templateId === 'test-vam').length === (isTestWeekIndex(w.W) ? 1 : 0)), 'test VAM solo (y siempre) en las semanas 6, 12, 18…');
ok(testDates.length === 8 && testDates.every((d, i) => !i || daysBetween(testDates[i - 1], d) === 42), `tests cada 6 semanas: ${testDates.join(' ')}`);
{
  const doneTests = new Set(st.history.filter((x) => x.isTest).map((x) => x.planDate));
  const pending = testDates.find((d) => d >= addDays(START, 7) && !doneTests.has(d)) || addDays(testDates.at(-1), 42);
  ok(nextTestDate(ownerState(), START) === testDates[0] && nextTestDate(st, addDays(START, 7)) === pending, `nextTestDate → ${nextTestDate(ownerState(), START)} · próximo sin hacer ${nextTestDate(st, addDays(START, 7))}`);
}
for (const d of testDates) {
  ok(hardDays.has(d) && !hardDays.has(addDays(d, -1)) && !hardDays.has(addDays(d, 1)), `test ${d}: día anterior y siguiente sin carga dura`);
}

/* 5 · Eventos */
const evDays = weeks.flatMap((w) => w.days.filter((d) => d.event).map((d) => ({ ...d, W: w.W })));
for (const d of evDays) {
  const e = EVENTS.find((x) => x.key === d.event.key);
  if (e.single) {
    const target = `${d.date.slice(0, 4)}-${e.from}`;
    ok(Math.abs(daysBetween(target, d.date)) <= 6 && weeks[d.W].days.some((x) => x.date === target), `${e.name}: en su semana (${d.date})`);
    if (weekdayOf(target) !== 7 && weeks[d.W].days.find((x) => x.date === target)?.workout) ok(d.date === target, `${e.name}: el mismo día (${target})`);
  } else ok(eventOn(d.date)?.key === e.key, `${e.name}: ${d.date} dentro de sus fechas`);
}
for (const w of weeks) {
  const sd = w.days.find((d) => d.surprise || d.event);
  const ev = sd && eventOn(sd.date);
  if (ev && !ev.single) ok(sd.event?.key === ev.key, `sem ${w.W + 1}: la sorpresa del ${sd.date} es «${ev.name}»`);
  const single = w.days.map((d) => eventOn(d.date)).find((e) => e?.single);
  if (single) ok(w.days.some((d) => d.event?.key === single.key), `sem ${w.W + 1}: ${single.name}`);
}
const evCount = (k) => new Set(evDays.filter((d) => d.event.key === k).map((d) => d.W)).size;
ok(evCount('navidad') >= 3 && evCount('verano') >= 8 && evCount('aniversario') === 1, `eventos: Navidad ${evCount('navidad')} sem · Verano ${evCount('verano')} sem · Aniversario ${evCount('aniversario')}`);

/* 6 · Adaptación */
const vac = weeks[VACATION_W + 1];
ok(vac.def.adapt.mode === 'return' && vac.load <= weeks[VACATION_W].load * 1.0001 && !vac.train.some((d) => d.role === 'hard'), `tras una semana perdida: vuelta suave (${vac.def.adapt.mode}, ${Math.round(vac.load)} ≤ ${Math.round(weeks[VACATION_W].load)})`);
const tired = weeks[HARD_W + 1];
ok(tired.def.adapt.mode === 'tired' && tired.train.filter((d) => d.role === 'hard').length <= 1 && (tired.info.isDeload || tired.load <= weeks[HARD_W].load * 1.0001),
  `tras una racha dura: semana más ligera (${tired.def.adapt.mode}, ${tired.train.filter((d) => d.role === 'hard').length} dura)`);
const missW = weeks[MISS_W + 1];
ok(missW.def.adapt.missed >= 2 && (missW.info.isDeload || weeks[MISS_W].info.isDeload || missW.load <= weeks[MISS_W].load * 1.0001), `sesiones perdidas no se acumulan: sin subir carga (${missW.def.adapt.missed} perdidas)`);
ok(levelBumps >= 3, `las rachas fáciles y los tests suben niveles (${levelBumps} subidas)`);

/* 7 · Determinismo, import/export y textos */
const copy = JSON.parse(JSON.stringify(st));
ok(planWeek(copy, addDays(START, 7 * 33)).map((d) => d.workout?.id || '-').join() === planWeek(st, addDays(START, 7 * 33)).map((d) => d.workout?.id || '-').join(), 'export/import (JSON) da el mismo plan');
const si = seasonInfo(st, '2026-10-18');
ok(si.seasonWeek === 1 && si.phase.key === 'base' && si.theme.name && si.intro.length > 20 && si.event?.key === 'aniversario', `seasonInfo hoy: ${si.phase.name} · ${si.theme.name} · ${si.event?.name}`);
ok(weeks.every((w) => w.train.every((d) => typeof d.intro === 'string' && d.intro.length > 10)), 'cada sesión trae su intro de Eva');
ok(weeks.every((w) => w.train.every((d) => d.season?.theme?.key === w.info.theme.key)), 'el tema del día coincide con el del mesociclo');

/* ───────────── Configuración alternativa (sin inclinación, domingo largo, 30′) ───────────── */
{
  const alt = ownerState({ treadmill: { hasIncline: false }, schedule: { weekdayMinutes: 30, thursdayMinutes: 55, weekendDay: 7, weekendMinutes: 60 } });
  alt.plan.startDate = '2027-03-01';
  alt.history = [];
  let prevLoad = null;
  let prevDeload = false;
  let bad = 0;
  let hardRowAlt = 0;
  let lastHard = null;
  for (let W = 0; W < SEASON_WEEKS; W++) {
    const days = planWeek(alt, addDays('2027-03-01', W * 7), new Date(2030, 0, 1));
    const info = cycleInfo(alt, days[0].date);
    const tr = days.filter((d) => d.workout);
    const load = tr.reduce((a, d) => a + d.workout.load, 0);
    if (days[5].kind !== 'rest' || tr.some((d) => d.workout.category === 'hills')) bad++;
    if (prevLoad && (info.isDeload ? load / prevLoad > 0.7 : !prevDeload && load / prevLoad > 1.1)) bad++;
    for (const d of days) {
      const hard = d.role === 'hard' || d.role === 'test';
      if (hard && lastHard === addDays(d.date, -1)) hardRowAlt++;
      if (hard) lastHard = d.date;
    }
    prevLoad = load;
    prevDeload = info.isDeload;
  }
  ok(bad === 0 && hardRowAlt === 0, `config. alternativa (sin cuestas, 30′/55′/domingo 60′): ${bad} fallos de horario/carga, ${hardRowAlt} duros seguidos`);
}
setPlannerToday(null);

/* ───────────── Informe ───────────── */
const spark = (vals) => { const lo = Math.min(...vals); const hi = Math.max(...vals); const c = '▁▂▃▄▅▆▇█'; return vals.map((v) => c[Math.round(((v - lo) / Math.max(1, hi - lo)) * 7)]).join(''); };
line(`Catálogo: ${TEMPLATES.length} plantillas${BIG ? '' : ' (umbrales reducidos < 100)'} · temas: ${THEMES.length} · eventos: ${EVENTS.map((e) => e.name).join(', ')}`);
line(`Temporada ${START} → ${addDays(START, SEASON_WEEKS * 7 - 1)} · ${seasonCalendar(st, START).map((c) => `${c.mesoNumber}:${c.theme.name}`).join(' · ')}`);
const months = new Map();
for (const s of seq) { const k = s.date.slice(0, 7); if (!months.has(k)) months.set(k, new Set()); months.get(k).add(s.id); }
line(`Distintas por mes: ${[...months].map(([k, v]) => `${k.slice(2)} ${v.size}`).join(' · ')}`);
line(`Distintas por mesociclo: ${perMeso.join(' ')} · total usadas ${new Set(seq.map((s) => s.id)).size}`);
gaps.sort((a, b) => a - b);
line(`Repeticiones en ventana: ${repeats}${repeatList.length ? ` (${repeatList.slice(0, 4).join('; ')})` : ''} · hueco mínimo ${gaps[0]} d · mediana ${gaps[Math.floor(gaps.length / 2)]} d · familia seguida ${famRow}`);
line(`Carga semanal: ${spark(weeks.map((w) => w.load))}  (${Math.round(Math.min(...weeks.map((w) => w.load)))}–${Math.round(Math.max(...weeks.map((w) => w.load)))})`);
line(`Tiempo suave:  ${spark(weeks.map((w) => w.easyShare))}  (temporada ${pct(seasonEasy)}, mesociclos ${mesoEasy.map((e) => Math.round(e * 100)).join(' ')})`);
line(`Error de estimación de carga: máx ${pct(Math.max(...weeks.map((w) => Math.abs(w.load / w.def.load - 1))))}`);
line(`Tests: ${testDates.join(' ')} · sorpresas ${surpriseWeeks} · semanas con evento ${eventWeeks} · subidas de nivel ${levelBumps} · niveles finales ${Object.values(st.levels).join('/')}`);
if (VERBOSE) {
  for (const w of weeks) {
    line(`  S${String(w.W + 1).padStart(2)} ${w.monday} ${w.info.phase.name.slice(0, 6).padEnd(6)} ${w.info.theme.name.slice(0, 12).padEnd(12)} ${w.info.weekName.padEnd(16)} carga ${String(Math.round(w.load)).padStart(3)} suave ${pct(w.easyShare).padStart(5)} ${w.def.adapt.mode.padEnd(6)} ${w.train.map((d) => `${d.role[0].toUpperCase()}:${d.templateId}${d.surprise ? '*' : ''}${d.event ? `!${d.event.key}` : ''}`).join(' ')}`);
  }
}

console.log(out.join('\n'));
console.log(`\n${checks - fails}/${checks} comprobaciones OK`);
if (fails) {
  console.log(`\n${fails} FALLOS:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
