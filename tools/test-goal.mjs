#!/usr/bin/env node
// RITMUP · pruebas del objetivo con fecha de carrera (js/training/goal.js + planificador + store).
// Uso: node tools/test-goal.mjs [--verbose]
import {
  normalizeGoal, goalWeekInfo, goalBlock, goalStatus, goalLongMinutes, parseGoalTime, fmtGoalTime, goalVerdict, countdownText,
  makeGoal, setGoal, clearGoal, goalSig, GOAL_DISTANCES,
} from '../js/training/goal.js';
import { planWeek, cycleInfo, seasonInfo, seasonWeek, setPlannerToday, nextTestDate } from '../js/training/planner.js';
import { defaultState, migrateState, exportState, importState, getState } from '../js/core/store.js';
import { addDays, mondayOf, daysBetween, deepClone, weekdayOf } from '../js/core/utils.js';
import { getTemplate } from '../js/training/templates.js';
import { templateMeta } from '../js/training/season.js';

const VERBOSE = process.argv.includes('--verbose');
let n = 0;
let bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log(`  ✗ ${m}`); } else if (VERBOSE) console.log(`  ✓ ${m}`); return !!c; };

const START = '2026-10-12';
const TODAY = '2026-10-24'; // sábado
function owner(goal) {
  const st = defaultState();
  Object.assign(st, {
    onboarded: true, createdAt: `${START}T08:00:00.000Z`,
    profile: { name: 'Nacho', age: 46, weightKg: 78, sex: 'm', hrMax: 174, hrRest: 64 },
    levels: { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 },
    schedule: { weekdayMinutes: 20, thursdayMinutes: 50, weekendDay: 6, weekendMinutes: 50, reminderTime: '07:00' },
    plan: { startDate: START, overrides: {}, goal: goal === undefined ? null : goal },
    treadmill: { hasIncline: true, maxIncline: 12, minSpeed: 1.0, maxSpeed: 18.0, announceLead: 10 },
  });
  if (goal === undefined) delete st.plan.goal;
  return st;
}
const NOW = new Date(`${TODAY}T07:00:00`);
setPlannerToday(TODAY);
const sig = (days) => days.map((d) => `${d.kind}|${d.slot}|${d.templateId}|${d.minutes}|${d.workout?.id || ''}|${d.intro}|${d.race ? 'R' : ''}`).join('#');
const weekOf = (st, W) => planWeek(st, addDays(START, W * 7), NOW);

/* ───────────── 1 · Saneado, migración e import/export ───────────── */
{
  ok(normalizeGoal(null) === null && normalizeGoal({}) === null && normalizeGoal('10k') === null, 'sin objetivo o basura: null');
  ok(normalizeGoal({ distance: 'maraton', date: '2027-01-01' }) === null, 'distancia desconocida: null');
  ok(normalizeGoal({ distance: '10k', date: '2027-02-30x' }) === null, 'fecha inválida: null');
  const g = normalizeGoal({ distance: '10K', date: '2027-03-14', targetSec: '3000', setOn: '2026-10-24', extra: 1 });
  ok(g && g.distance === '10k' && g.targetSec === 3000 && g.setOn === '2026-10-24' && !('extra' in g), 'normaliza distancia, tiempo y campos');
  ok(normalizeGoal({ distance: '5k', date: '2027-03-14', targetSec: 120 }).targetSec === null, 'tiempo imposible: se descarta solo el tiempo');

  const legacy = owner(undefined);
  ok(!('goal' in legacy.plan), 'estado antiguo sin plan.goal');
  const m = migrateState(deepClone(legacy), 2);
  ok(m.plan.goal === null && m.plan.startDate === START, 'migración: estado antiguo → goal null, plan intacto');
  const corrupt = owner({ distance: 42, date: [] });
  ok(migrateState(deepClone(corrupt), 2).plan.goal === null, 'migración: objetivo corrupto → null');
  const again = migrateState(deepClone(m), 2);
  ok(JSON.stringify(again.plan) === JSON.stringify(m.plan), 'migración idempotente');
  ok(defaultState().plan.goal === null, 'estado por defecto: sin objetivo');

  // import/export (en Node el store vive en memoria)
  const withGoal = owner({ distance: '21k', date: '2027-04-18', targetSec: 6600, setOn: TODAY });
  ok(importState(JSON.stringify({ app: 'RITMUP', ...withGoal })), 'importa una copia con objetivo');
  ok(getState().plan.goal?.distance === '21k' && getState().plan.goal?.targetSec === 6600, 'el objetivo llega al estado importado');
  const exported = JSON.parse(exportState());
  ok(exported.plan?.goal?.date === '2027-04-18' && exported.plan.goal.setOn === TODAY, 'exportState lleva el objetivo');
  ok(importState(JSON.stringify({ app: 'BestRunning', ...owner(undefined) })) && getState().plan.goal === null, 'copia antigua (sin objetivo) importa con goal null');
}

/* ───────────── 2 · Sin objetivo el plan es exactamente el de siempre ───────────── */
{
  const a = owner(undefined);
  const b = owner(null);
  const c = owner({ distance: 'maraton', date: 'nunca' });
  let same = 0;
  for (let W = 0; W < 30; W++) {
    const sa = sig(weekOf(a, W));
    if (sa === sig(weekOf(b, W)) && sa === sig(weekOf(c, W))) same++;
  }
  ok(same === 30, `sin objetivo / goal null / objetivo inválido: mismas 30 semanas (${same}/30)`);
  ok(JSON.stringify(cycleInfo(a, '2026-11-20')) === JSON.stringify(cycleInfo(b, '2026-11-20')), 'cycleInfo idéntico sin objetivo');
  ok(!('goal' in cycleInfo(b, '2026-11-20')), 'sin objetivo, cycleInfo no añade campos');
  ok(goalSig(null) === '' && goalSig(undefined) === '', 'firma vacía sin objetivo');
}

/* ───────────── 3 · 10K en 8 semanas (domingo 13 dic, fijado hoy) ───────────── */
const G10 = { distance: '10k', date: '2026-12-13', targetSec: 3000, setOn: TODAY };
{
  const st = owner(G10);
  const base = owner(null);
  const blk = goalBlock(G10, mondayOf(START));
  ok(blk.start === '2026-10-19' && blk.weeks === 8 && blk.taper === 1 && blk.build === 6, `bloque: 8 semanas desde el lunes 19 oct (6 + 1 + carrera) → ${JSON.stringify(blk)}`);
  ok(sig(weekOf(st, 0)) === sig(weekOf(base, 0)), 'la semana anterior al objetivo no cambia');

  const stages = [];
  const weeks = [];
  for (let W = 1; W <= 10; W++) {
    const m = addDays(START, W * 7);
    const ci = cycleInfo(st, m);
    stages.push(ci.goal ? ci.goal.stage : 'normal');
    weeks.push({ W, m, ci, days: weekOf(st, W), load: seasonWeek(st, W).load });
  }
  ok(stages.join(',') === 'build,build,build,build,build,build,taper,race,recovery,normal', `etapas: ${stages.join(',')}`);
  const build = weeks.filter((w) => w.ci.goal?.stage === 'build');
  ok(build[build.length - 1].ci.weekName.startsWith('Pico'), 'la última semana de construcción es la semana pico');
  ok(build.filter((w) => w.ci.isDeload).length === 1, 'una descarga dentro de la construcción');
  ok(!build[0].ci.isDeload, 'el bloque no empieza descargando');

  // Rutina: L-V 20′ tras pesas, jueves 50′ (largo), sábado largo, domingo descanso (salvo la carrera)
  let routine = true;
  for (const w of build) {
    for (const d of w.days) {
      const wd = weekdayOf(d.date);
      if (wd === 7) { if (d.workout) routine = false; continue; }
      if (!d.workout) { routine = false; continue; }
      const mins = d.minutes;
      if ([1, 2, 3, 5].includes(wd) && mins !== 20) routine = false;
      if (wd === 4 && !d.workout.isTest && !w.ci.isDeload && mins !== 50) routine = false;
      if (wd === 6 && (mins < (w.ci.isDeload ? 30 : 50) || mins > 60)) routine = false;
    }
  }
  ok(routine, 'construcción: respeta L-V 20′, jueves 50′, sábado largo (≤ 60′) y domingo libre');
  const longs = build.filter((w) => !w.ci.isDeload).map((w) => w.days[5].minutes);
  ok(longs.every((x, i) => i === 0 || x >= longs[i - 1]) && longs[longs.length - 1] === 60, `tirada del sábado crece hasta 60′: ${longs.join(' → ')}`);

  // Ritmo de carrera el jueves (familias del 10K) en la mayoría de semanas de carga
  const thuFam = GOAL_DISTANCES.find((d) => d.key === '10k').thu;
  const keyThu = build.filter((w) => !w.ci.isDeload && !w.ci.isTestWeek);
  const hits = keyThu.filter((w) => thuFam.includes(templateMeta(getTemplate(w.days[3].templateId)).family)).length;
  ok(hits >= Math.ceil(keyThu.length / 2), `jueves de ritmo de carrera: ${hits}/${keyThu.length}`);
  const sim = GOAL_DISTANCES.find((d) => d.key === '10k').sim;
  const peakSat = build[build.length - 1].days[5];
  ok(templateMeta(getTemplate(peakSat.templateId)).family === 'reto' || sim.includes(peakSat.templateId), `ensayo de carrera el sábado de la semana pico (${peakSat.templateId})`);

  // Puesta a punto, semana de carrera y recuperación
  const taper = weeks.find((w) => w.ci.goal?.stage === 'taper');
  const race = weeks.find((w) => w.ci.goal?.stage === 'race');
  const rec = weeks.find((w) => w.ci.goal?.stage === 'recovery');
  const peakLoad = build[build.length - 1].load;
  ok(taper.load < peakLoad * 0.8, `puesta a punto: carga ${Math.round(taper.load)} < 80 % del pico (${Math.round(peakLoad)})`);
  ok(race.load < taper.load, `semana de carrera más suave que la puesta a punto (${Math.round(race.load)} < ${Math.round(taper.load)})`);
  ok(!taper.ci.isTestWeek && !race.ci.isTestWeek, 'sin test VAM al afinar ni en la semana de carrera');
  const raceDay = race.days.find((d) => d.date === G10.date);
  ok(raceDay && raceDay.race && raceDay.race.distance === '10k' && raceDay.race.targetSec === 3000 && !raceDay.workout && raceDay.slot === 'race', 'el día de la carrera está marcado (sin clase)');
  ok(race.days.filter((d) => d.race).length === 1, 'un único día de carrera');
  const eve = race.days.find((d) => d.date === addDays(G10.date, -1));
  ok(eve.kind === 'rest' && !eve.workout, 'la víspera, descanso');
  const raceTrain = race.days.filter((d) => d.workout);
  ok(raceTrain.every((d) => d.minutes <= 25), `semana de carrera: sesiones cortas (${raceTrain.map((d) => d.minutes).join(', ')} min)`);
  ok(raceTrain.filter((d) => d.role !== 'easy').length === 1, 'semana de carrera: un único recordatorio de ritmo, el resto suave');
  ok(rec.days[0].kind === 'rest', 'el lunes tras la carrera del domingo, descanso');
  ok(rec.days.filter((d) => d.workout).every((d) => d.role === 'easy'), 'semana de recuperación: todo suave');
  ok(weeks[9].ci.weekName.startsWith('Arranque'), `vuelta a la temporada con una semana de arranque (${weeks[9].ci.weekName})`);

  // Sin días duros seguidos en el bloque
  let hard2 = false;
  const all = weeks.flatMap((w) => w.days);
  for (let i = 1; i < all.length; i++) if (['hard', 'test'].includes(all[i].role) && ['hard', 'test'].includes(all[i - 1].role)) hard2 = true;
  ok(!hard2, 'nunca dos días duros seguidos');

  const nt = nextTestDate(st, TODAY);
  const ntInfo = cycleInfo(st, nt);
  ok(!ntInfo.goal || ntInfo.goal.stage === 'build', `próximo test fuera de afinar/carrera (${nt})`);
  ok(seasonInfo(st, '2026-12-07').goal?.stage === 'race', 'seasonInfo lleva la semana del objetivo');
  ok(sig(weekOf(st, 5)) === sig(weekOf(deepClone(st), 5)), 'determinista');

  // Quitar el objetivo devuelve exactamente el plan de siempre
  const cleared = deepClone(st);
  clearGoal(cleared);
  let back = 0;
  for (let W = 0; W < 14; W++) if (sig(weekOf(cleared, W)) === sig(weekOf(base, W))) back++;
  ok(back === 14, `sin el objetivo vuelve el plan de siempre (${back}/14)`);
}

/* ───────────── 4 · Media maratón (2 semanas de afinar) y 5K en miércoles ───────────── */
{
  const st = owner({ distance: '21k', date: '2027-01-17', targetSec: 6600, setOn: TODAY });
  const blk = goalBlock(st.plan.goal, mondayOf(START));
  ok(blk.weeks === 12 && blk.taper === 2 && blk.start === '2026-10-26', `21K: 12 semanas con 2 de puesta a punto, empieza el lunes 26 oct (${blk.start})`);
  ok(sig(weekOf(st, 1)) === sig(weekOf(owner(null), 1)), '21K lejos: la semana actual sigue siendo la de la temporada');
  const tapers = [];
  for (let W = 0; W < 16; W++) { const ci = cycleInfo(st, addDays(START, W * 7)); if (ci.goal?.stage === 'taper') tapers.push(seasonWeek(st, W).load); }
  ok(tapers.length === 2 && tapers[1] < tapers[0], `21K: dos semanas de afinar decrecientes (${tapers.map(Math.round).join(' → ')})`);
  const peak = cycleInfo(st, '2026-12-21');
  ok(peak.goal?.isLastBuild && goalLongMinutes(peak.goal, 50) === 60, '21K: tirada larga a 60′ en la semana pico');

  const five = owner({ distance: '5k', date: '2026-11-04', targetSec: 1380, setOn: TODAY });
  const wk = planWeek(five, '2026-11-02', NOW);
  ok(wk[2].race && wk[1].kind === 'rest' && wk[3].kind === 'rest', '5K en miércoles: martes y jueves de descanso, miércoles carrera');
  ok(wk[4].workout && wk[4].role === 'easy', '5K: el viernes ya hay rodaje suave');
  ok(goalLongMinutes({ distance: '5k', stage: 'build', buildWeeks: 6, buildIndex: 5 }, 50) === 50, '5K: la tirada del finde no se alarga');
}

/* ───────────── 5 · Textos, ritmo, previsión y edición ───────────── */
{
  const st = owner(G10);
  const gs = goalStatus(st, TODAY);
  ok(gs.countdown === 'Faltan 7 semanas' && gs.title === '10K del 13 de diciembre', `cuenta atrás: «${gs.countdown} · ${gs.title}»`);
  ok(gs.paceSec === 300 && gs.speedKmh === 12, 'ritmo necesario 5:00 /km · 12,0 km/h');
  ok(gs.predicted && gs.predicted.fastSec < gs.predicted.slowSec, 'previsión con race-predict');
  ok(gs.week?.stage === 'build' && gs.week.weekOfBlock === 1, 'semana 1 del bloque');
  ok(countdownText('2026-12-12', '2026-12-13') === 'Mañana es tu carrera' && countdownText('2026-12-13', '2026-12-13') === 'Hoy es tu carrera'
    && countdownText('2026-12-04', '2026-12-13') === 'Faltan 9 días' && countdownText('2026-12-14', '2026-12-13') === null, 'textos de cuenta atrás');
  ok(goalStatus(st, '2026-12-25') === null, 'una semana y pico después de la carrera, la tarjeta desaparece');
  ok(goalStatus(owner(null), TODAY) === null, 'sin objetivo, nada que pintar');

  const p = { fastSec: 3000, slowSec: 3300 };
  ok(goalVerdict(3400, p).level === 'ok' && goalVerdict(3100, p).level === 'ok' && goalVerdict(2950, p).level === 'warn' && goalVerdict(null, p) === null, 'veredicto frente a la previsión');
  ok(parseGoalTime('50:00', '10k') === 3000 && parseGoalTime('50', '10k') === 3000 && parseGoalTime('1:45', '21k') === 6300
    && parseGoalTime('1:45:30', '21k') === 6330 && parseGoalTime('1h45', '21k') === 6300 && parseGoalTime('22:30', '5k') === 1350, 'lectura del tiempo objetivo');
  ok(parseGoalTime('5:00', '10k') === null && parseGoalTime('abc', '5k') === null && parseGoalTime('50:75', '10k') === null, 'tiempos imposibles: null');
  ok(fmtGoalTime(3000) === '50:00' && fmtGoalTime(6330) === '1:45:30', 'formato del tiempo');

  ok(makeGoal({ distance: '10k', date: TODAY }, TODAY) === null && makeGoal({ distance: '10k', date: '2028-01-01' }, TODAY) === null, 'fecha fuera de rango (hoy o > 1 año): no vale');
  const d = owner(null);
  ok(setGoal(d, { distance: '10k', date: '2026-12-13', targetSec: null }, '2026-10-20') && d.plan.goal.setOn === '2026-10-20', 'setGoal guarda el día en que se fija');
  setGoal(d, { distance: '10k', date: '2026-12-13', targetSec: 2900 }, TODAY);
  ok(d.plan.goal.setOn === '2026-10-20' && d.plan.goal.targetSec === 2900, 'cambiar solo el tiempo no mueve el bloque');
  setGoal(d, { distance: '21k', date: '2027-01-17' }, TODAY);
  ok(d.plan.goal.setOn === TODAY, 'cambiar distancia o fecha cuenta desde hoy');
  clearGoal(d);
  ok(d.plan.goal === null, 'clearGoal');
  ok(goalWeekInfo(G10, '2026-10-12', mondayOf(START)) === null, 'antes de fijarlo, ninguna semana es del bloque');
}

setPlannerToday(null);
console.log(bad ? `✗ objetivo de carrera: ${n - bad} OK, ${bad} fallos` : `✓ objetivo de carrera: ${n} comprobaciones`);
process.exitCode = bad ? 1 : 0;
