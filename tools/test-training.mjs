// BestRunning · test del motor de entrenamiento (Node 22): node tools/test-training.mjs [--verbose]
// Comprueba plantillas, generador, planificador, progresión, test VAM, logros y estadísticas. Sale con código ≠ 0 si algo falla.
import { CATEGORIES, TEMPLATES, getTemplate, templatesFor } from '../js/training/templates.js';
import { buildWorkout, workoutId, parseWorkoutId, workoutFromId, summarizeSegments, groupSegments } from '../js/training/generator.js';
import {
  CYCLE_WEEKS, cycleInfo, planDay, planWeek, todayPlan, alternativesFor, swapDays, setDayOverride, clearDayOverride, nextTestDate,
} from '../js/training/planner.js';
import { applyFeedback, evaluateTest, feelingToRpe, FEELINGS, coachInsight } from '../js/training/progression.js';
import { ACHIEVEMENTS, evaluateAchievements } from '../js/training/achievements.js';
import { totals, weeklyBuckets, streakWeeks, dayValues, records, weekProgress } from '../js/training/stats.js';
import { ZONES, DEFAULT_LEVELS, levelsFromVam, vamFromLevels } from '../js/training/levels.js';
import { addDays, mondayOf, weekdayOf, fmt, deepClone, parseKey } from '../js/core/utils.js';

const VERBOSE = process.argv.includes('--verbose');
let checks = 0;
let fails = 0;
const failures = [];
const report = [];
function ok(cond, msg) {
  checks++;
  if (!cond) {
    fails++;
    if (failures.length < 80) failures.push(msg);
  }
  return !!cond;
}
const line = (s = '') => report.push(s);
const pct = (x) => `${Math.round(x * 100)} %`;

const ICONS = new Set(('home calendar grid chart person play pause stop skip-forward skip-back plus minus close check chevron-right '
  + 'chevron-left chevron-down flame bolt heart timer route trophy gear speaker speaker-off lock unlock refresh shuffle drag share '
  + 'download upload watch mountain star info trash edit sparkles leaf gauge target arrow-up arrow-down music bell moon sun medal crown '
  + 'repeat list clock').split(' '));
const TM = { hasIncline: false, maxIncline: 12, minSpeed: 1.0, maxSpeed: 18.0, announceLead: 10 };
const START = mondayOf('2026-09-07');

function makeState(over = {}) {
  const base = {
    version: 1, onboarded: true, createdAt: `${START}T08:00:00.000Z`,
    profile: { name: 'Nacho', age: 46, weightKg: 78, sex: 'm', hrMax: 176, hrRest: null },
    levels: { ...DEFAULT_LEVELS },
    levelHistory: [{ date: START, levels: { ...DEFAULT_LEVELS }, reason: 'init', note: '' }],
    progression: { lastBump: {}, okStreak: {}, hardStreak: 0, loadAdjust: 0, lastTest: null, bestVam: null },
    schedule: { weekdayMinutes: 20, thursdayMinutes: 50, weekendDay: 6, weekendMinutes: 50, reminderTime: '07:00' },
    plan: { startDate: START, overrides: {} },
    treadmill: { ...TM },
    audio: {}, integrations: {}, history: [], achievements: {}, ui: {},
  };
  const merge = (a, b) => {
    for (const [k, v] of Object.entries(b)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) merge(a[k], v);
      else a[k] = v;
    }
    return a;
  };
  return merge(base, deepClone(over));
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const HARD = new Set(['fast', 'sprint']);
const EASY = new Set(['warmup', 'walk', 'jog', 'cooldown']);
const range = (t) => [Math.min(...t.durations), Math.max(...t.durations)];
const minutesFor = (t) => {
  const [lo, hi] = range(t);
  const out = new Set(t.durations);
  for (let m = lo; m <= hi; m += 5) out.add(m);
  return [...out].sort((a, b) => a - b);
};
const structSig = (w) => w.segments.map((s) => `${s.zone}:${s.sec}:${s.speed}:${s.incline}`).join('|');

/* ═════════════ 1. Catálogo ═════════════ */

const ids = TEMPLATES.map((t) => t.id);
ok(TEMPLATES.length >= 30, `≥ 30 plantillas (hay ${TEMPLATES.length})`);
ok(new Set(ids).size === ids.length, 'ids de plantilla únicos');
for (const c of Object.keys(CATEGORIES)) ok(TEMPLATES.some((t) => t.category === c), `categoría ${c} con plantillas`);
for (const [k, c] of Object.entries(CATEGORIES)) ok(c.key === k && c.name && /^#[0-9A-F]{6}$/i.test(c.color) && ICONS.has(c.icon), `categoría ${k} bien formada`);
const SPEC_IDS = ['pyramid', 'minute-on', 'sprint-30-60', 'ladder-up', 'over-under', 'golden-minutes', 'two-one', 'countdown', 'cruise', 'sandwich',
  'threshold-3x4', 'progressive', 'cruise-2x6', 'long-progressive', 'long-blocks', 'long-surges', 'negative-split', 'long-ladder', 'aerobic-base',
  'fartlek-swedish', 'speed-play', 'surprise', 'hills-short', 'hill-long', 'rollercoaster', 'easy-strides', 'recovery-jog', 'no-stop',
  'sprint-finish', 'challenge-10k', 'the-hour', 'pyramid-xl', 'test-vam'];
for (const id of SPEC_IDS) ok(!!getTemplate(id), `plantilla del catálogo mínimo: ${id}`);
for (const t of TEMPLATES) {
  ok(t.title && t.subtitle && t.focus && t.description && CATEGORIES[t.category], `${t.id}: textos y categoría`);
  ok(Array.isArray(t.coachNotes) && t.coachNotes.length >= 2 && t.coachNotes.length <= 4, `${t.id}: 2–4 coachNotes`);
  ok(t.durations.length && t.durations.every((m) => Number.isInteger(m) && m >= 15), `${t.id}: duraciones`);
  ok(typeof t.build === 'function', `${t.id}: build()`);
  ok(t.requiresIncline === (t.category === 'hills'), `${t.id}: requiresIncline solo en cuestas`);
}
ok(['endurance', 'challenge'].every(() => true) && range(getTemplate('challenge-10k'))[0] === 60 && range(getTemplate('the-hour'))[0] === 60, '10K y La hora son de 60′');
ok(templatesFor({ category: 'hills', hasIncline: false }).length === 0, 'templatesFor oculta cuestas sin inclinación');
ok(templatesFor({ category: 'hills', hasIncline: true }).length >= 3, 'templatesFor muestra cuestas con inclinación');
ok(templatesFor({ minutes: 50 }).some((t) => t.category === 'endurance'), 'templatesFor acepta minutos intermedios (50′)');
ok(templatesFor({ minutes: 20 }).every((t) => range(t)[0] <= 20), 'templatesFor filtra por minutos');
line(`Catálogo: ${TEMPLATES.length} plantillas · ${Object.keys(CATEGORIES).map((c) => `${CATEGORIES[c].name} ${TEMPLATES.filter((t) => t.category === c).length}`).join(' · ')}`);

/* ═════════════ 2. Construcción: todas × duraciones × semillas × cargas × inclinación ═════════════ */

const SEEDS = [1, 7, 42, 1234, 99991, 2026101, 3735928559];
const LOADS = [0.72, 0.86, 1.0, 1.16, 1.3, 1.45];
const LEVEL_SETS = [DEFAULT_LEVELS, { jog: 9.1, run: 11.0, fast: 12.6, sprint: 14.4 }, { jog: 7.4, run: 8.6, fast: 9.6, sprint: 10.8 }];
let built = 0;
let maxFastRun = 0;
let maxFastTag = '';
let maxSprintShare = 0;
const variety = {};
const loadEffect = {};

function checkWorkout(w, t, minutes, opts, tag) {
  const tm = opts.treadmill;
  const test = t.category === 'test';
  ok(w && Array.isArray(w.segments) && w.segments.length >= 3, `${tag}: segmentos`);
  if (!w) return;
  const total = w.segments.reduce((a, s) => a + s.sec, 0);
  ok(total === w.totalSec, `${tag}: totalSec coherente`);
  if (!test) ok(total === minutes * 60, `${tag}: total ${total} ≠ ${minutes * 60}`);
  let fastRun = 0;
  for (const [i, s] of w.segments.entries()) {
    const where = `${tag} seg ${i} (${s.zone} ${s.sec}s)`;
    ok(ZONES[s.zone], `${where}: zona válida`);
    ok(s.sec % 5 === 0 && s.sec >= 30, `${where}: múltiplo de 5 y ≥ 30 s`);
    ok(s.speed >= tm.minSpeed && s.speed <= tm.maxSpeed && Math.abs(s.speed * 10 - Math.round(s.speed * 10)) < 1e-9, `${where}: velocidad ${s.speed} fuera de cinta o sin redondear`);
    ok(typeof s.label === 'string' && s.label && !/undefined|NaN/.test(s.label + s.cue), `${where}: etiqueta/consejo`);
    ok(s.incline >= 0 && (opts.hasIncline ? s.incline <= Math.min(8, tm.maxIncline) : s.incline === 0), `${where}: inclinación ${s.incline}`);
    if (t.category !== 'hills') ok(s.incline === 0, `${where}: inclinación solo en cuestas`);
    if (!test && s.zone === 'sprint') ok(s.sec <= 60, `${where}: sprint > 60 s`);
    if (s.rep) ok(s.rep.i >= 1 && s.rep.i <= s.rep.n, `${where}: rep ${s.rep.i}/${s.rep.n}`);
    if (test) ok(Number.isInteger(s.stage), `${where}: stage en test`);
    fastRun = s.zone === 'fast' ? fastRun + s.sec : 0;
    if (!test && fastRun > maxFastRun) { maxFastRun = fastRun; maxFastTag = tag; }
  }
  ok(w.segments[0].zone === 'warmup', `${tag}: empieza calentando`);
  ok(w.segments[w.segments.length - 1].zone === 'cooldown', `${tag}: termina con vuelta a la calma`);
  if (!test) {
    const warmSec = w.segments.filter((s) => s.zone === 'warmup').reduce((a, s) => a + s.sec, 0);
    const coolSec = w.segments.filter((s) => s.zone === 'cooldown').reduce((a, s) => a + s.sec, 0);
    const expCool = minutes <= 22 ? [120] : minutes <= 37 ? [180] : [240, 300];
    ok(expCool.includes(coolSec), `${tag}: vuelta a la calma ${coolSec}s`);
    ok(warmSec >= 120 && warmSec <= 240, `${tag}: calentamiento progresivo ${warmSec}s`);
    const main = total - coolSec - warmSec - 60;
    const sprint = w.timeInZone.sprint;
    ok(sprint <= 0.25 * main + 30, `${tag}: sprint ${sprint}s > 25 % del bloque principal`);
    maxSprintShare = Math.max(maxSprintShare, sprint / Math.max(1, main));
    if (t.requiresIncline && opts.hasIncline) ok(w.segments.some((s) => s.incline >= 1), `${tag}: cuestas con inclinación`);
  } else {
    const stages = w.segments.filter((s) => s.stage > 0);
    ok(stages.length >= 10 && stages.every((s) => s.sec === 60), `${tag}: escalones de 60 s`);
    ok(Math.abs(stages[0].speed - Math.max(tm.minSpeed, opts.levels.jog - 0.3)) < 0.051, `${tag}: primer escalón en trote − 0,3`);
    ok(stages.every((s, i) => i === 0 || Math.abs(s.speed - stages[i - 1].speed - 0.5) < 0.051), `${tag}: +0,5 km/h por escalón`);
    const topExp = Math.min(tm.maxSpeed, Math.max(opts.levels.fast + 1, vamFromLevels(opts.levels) + (minutes >= 30 ? 3 : 2)));
    ok(stages[stages.length - 1].speed <= topExp + 1e-9 && stages[stages.length - 1].speed > topExp - 0.5 - 1e-9, `${tag}: llega al techo (VAM + 2, o la cinta) ${stages[stages.length - 1].speed}/${topExp}`);
    const preJog = w.segments[w.segments.indexOf(stages[0]) - 1];
    ok(preJog && preJog.speed < stages[0].speed, `${tag}: el calentamiento queda por debajo del primer escalón`);
    ok(Math.abs(total / 60 - minutes) <= minutes * 0.45, `${tag}: duración real cercana a la anunciada (${Math.round(total / 60)}′)`);
    ok(w.isTest === true, `${tag}: isTest`);
  }
  ok([1, 2, 3].includes(w.intensity), `${tag}: intensidad 1–3`);
  ok(w.estDistanceKm > 0 && w.estKcal > 0 && w.load > 0, `${tag}: estimaciones`);
  ok(Object.values(w.timeInZone).reduce((a, x) => a + x, 0) === w.totalSec, `${tag}: timeInZone suma total`);
  ok(w.maxSpeed === Math.max(...w.segments.map((s) => s.speed)), `${tag}: maxSpeed`);
  const p = parseWorkoutId(w.id);
  ok(p && p.templateId === t.id && p.minutes === w.minutes && p.seed === w.seed && Math.abs(p.loadFactor - w.loadFactor) < 1e-9, `${tag}: id reversible ${w.id}`);
  ok(workoutId(p || {}) === w.id, `${tag}: workoutId(parse(id)) === id`);
  const groups = groupSegments(w.segments);
  const gsum = groups.reduce((a, g) => a + g.times * g.segments.reduce((b, s) => b + s.sec, 0), 0);
  ok(gsum === w.totalSec && groups.every((g) => g.label && !/undefined|NaN/.test(g.label)), `${tag}: groupSegments`);
}

for (const t of TEMPLATES) {
  variety[t.id] = new Set();
  loadEffect[t.id] = { lo: 0, hi: 0 };
  const inclineOpts = t.requiresIncline ? [true, false] : [false, true];
  for (const minutes of minutesFor(t)) {
    for (const [li, levels] of LEVEL_SETS.entries()) {
      for (const seed of SEEDS) {
        for (const loadFactor of LOADS) {
          for (const hasIncline of inclineOpts) {
            if (li > 0 && (loadFactor !== 1 || seed > 1234)) continue; // niveles extremos: muestra reducida
            const opts = { minutes, levels, seed, loadFactor, hasIncline, treadmill: { ...TM, hasIncline }, weightKg: 78 };
            const w = buildWorkout(t.id, opts);
            built++;
            const tag = `${t.id} ${minutes}′ s${seed} c${loadFactor}${hasIncline ? ' inc' : ''}${li ? ` niv${li}` : ''}`;
            checkWorkout(w, t, minutes, opts, tag);
            if (!w) continue;
            if (li === 0 && loadFactor === 1 && hasIncline === inclineOpts[0]) variety[t.id].add(structSig(w));
            if (li === 0 && hasIncline === inclineOpts[0] && loadFactor === 0.72) loadEffect[t.id].lo += w.load;
            if (li === 0 && hasIncline === inclineOpts[0] && loadFactor === 1.3) loadEffect[t.id].hi += w.load;
            if (seed === 7 && loadFactor === 1 && li === 0) {
              const again = buildWorkout(t.id, opts);
              ok(JSON.stringify(again) === JSON.stringify(w), `${tag}: determinista`);
              const st = makeState({ levels, treadmill: { hasIncline } });
              const re = workoutFromId(w.id, st);
              ok(re && JSON.stringify(re.segments) === JSON.stringify(w.segments), `${tag}: workoutFromId reconstruye la misma clase`);
            }
          }
        }
      }
    }
  }
}
// Duraciones fuera de rango (overrides de duración): nunca rompe y el total sigue siendo exacto
for (const t of TEMPLATES) {
  for (const minutes of [10, 15, 25, 35, 40, 75, 90, 120]) {
    for (const seed of [2, 77]) {
      let w = null;
      try { w = buildWorkout(t.id, { minutes, levels: DEFAULT_LEVELS, seed, loadFactor: 1.1, hasIncline: true, treadmill: { ...TM, hasIncline: true } }); } catch (e) { w = null; ok(false, `${t.id} ${minutes}′ lanza ${e.message}`); }
      if (!w) continue;
      ok(t.category === 'test' || w.totalSec === minutes * 60, `${t.id} ${minutes}′ (fuera de rango): total exacto`);
      ok(w.segments.every((x) => x.sec > 0 && x.sec % 5 === 0 && (minutes < 15 || x.sec >= 30)), `${t.id} ${minutes}′ (fuera de rango): duraciones válidas`);
    }
  }
}
ok(buildWorkout('no-existe', { minutes: 20 }) === null, 'plantilla inexistente → null');
ok(parseWorkoutId('basura') === null && parseWorkoutId('a~b~c~d') === null && workoutFromId('x~20~1~100', makeState()) === null, 'ids inválidos → null');
ok(buildWorkout('aerobic-base', { minutes: 20, levels: { jog: 'x' } })?.totalSec === 1200, 'niveles corruptos → por defecto');
ok(buildWorkout('pyramid', { minutes: 25, levels: DEFAULT_LEVELS, seed: 3, loadFactor: 1, treadmill: { maxSpeed: 12 } }).segments.every((s) => s.speed <= 12), 'recorta a la velocidad máxima de la cinta');
const s20 = summarizeSegments([{ zone: 'jog', speed: 8.3, sec: 600 }, { zone: 'fast', speed: 11.5, sec: 600 }], 78);
ok(s20.totalSec === 1200 && s20.intensity === 2 && s20.timeInZone.fast === 600 && Math.abs(s20.estDistanceKm - 3.3) < 0.01, 'summarizeSegments');
ok(groupSegments([{ zone: 'sprint', speed: 13, sec: 30, incline: 0, label: 'Sprint' }, { zone: 'jog', speed: 8.3, sec: 60, incline: 0, label: 'Trote' },
  { zone: 'sprint', speed: 13, sec: 30, incline: 0, label: 'Sprint' }, { zone: 'jog', speed: 8.3, sec: 60, incline: 0, label: 'Trote' }])[0].label
  === '2 × (0:30 Sprint 13,0 · 1:00 Trotar 8,3)', 'groupSegments con el formato del contrato (etiqueta corta de zona)');

const lowVariety = Object.entries(variety).filter(([id, s]) => id !== 'test-vam' && s.size < 2).map(([id]) => id);
ok(lowVariety.length === 0, `variedad con la semilla en todas las plantillas (sin variación: ${lowVariety.join(', ')})`);
const loadBad = Object.entries(loadEffect).filter(([id, e]) => id !== 'test-vam' && e.hi < e.lo * 0.98).map(([id, e]) => `${id} ${e.lo}→${e.hi}`);
ok(loadBad.length === 0, `más carga ⇒ más trabajo (fallan: ${loadBad.join(', ')})`);
ok(maxFastRun <= 480, `tramos continuos a ritmo rápido ≤ 8′ (máx ${maxFastRun}s en ${maxFastTag})`);
line(`Construcción: ${built} clases · máx. rápido continuo ${fmt.clock(maxFastRun)} (${maxFastTag}) · máx. sprint/bloque ${pct(maxSprintShare)}`);
line(`Variedad (estructuras distintas con 7 semillas): ${Object.entries(variety).map(([id, s]) => `${id} ${s.size}`).join(' · ')}`);
line(`Carga 0,72→1,3 (puntos de carga): ${Object.entries(loadEffect).filter(([id]) => id !== 'test-vam').map(([id, e]) => `${id} ${pct(e.hi / Math.max(1, e.lo))}`).join(' · ')}`);

/* ═════════════ 3. Planificador: 12 semanas ═════════════ */

const NOW_FAR = new Date(2030, 0, 1, 12);
const configs = [
  { name: 'base', over: {} },
  { name: 'cuestas + domingo', over: { treadmill: { hasIncline: true }, schedule: { weekendDay: 7, thursdayMinutes: 60, weekendMinutes: 45 } } },
  { name: '30′ + 55′', over: { schedule: { weekdayMinutes: 30, thursdayMinutes: 55, weekendMinutes: 60 } } },
  { name: 'carga alta', over: { progression: { loadAdjust: 0.15 }, treadmill: { hasIncline: true } } },
];
for (const cfg of configs) {
  const st = makeState(cfg.over);
  const sch = st.schedule;
  let prev = null;
  let prev2 = null;
  let repeats2 = 0;
  const used = new Set();
  const easyShare = [];
  for (let wk = 0; wk < 12; wk++) {
    const monday = addDays(START, wk * 7);
    const days = planWeek(st, monday, NOW_FAR);
    const tag = `plan ${cfg.name} sem ${wk + 1}`;
    ok(days.length === 7 && days.every((d, i) => d.date === addDays(monday, i) && d.weekday === i + 1), `${tag}: 7 días consecutivos`);
    const info = cycleInfo(st, monday);
    const expLf = Math.round(([1.0, 1.08, 1.16, 0.72][info.weekInCycle - 1] * (1 + Math.min(info.cycleIndex, 6) * 0.03) + (st.progression.loadAdjust || 0)) * 100) / 100;
    ok(info.weekInCycle === (wk % 4) + 1 && info.cycleIndex === Math.floor(wk / 4) && info.weekName === CYCLE_WEEKS[wk % 4] && info.loadFactor === expLf, `${tag}: cycleInfo`);
    const rest = days.filter((d) => d.kind === 'rest');
    ok(rest.length === 1 && rest[0].weekday === (sch.weekendDay === 6 ? 7 : 6), `${tag}: un único descanso en el otro día del finde`);
    ok(days.filter((d) => d.kind !== 'rest').every((d) => d.workout && d.templateId === d.workout.templateId && d.status === 'missed'), `${tag}: días con clase (y 'missed' en el pasado)`);
    ok(days[3].kind === 'long' && days[3].minutes === sch.thursdayMinutes && days[3].workout.totalSec === sch.thursdayMinutes * 60, `${tag}: jueves largo`);
    const we = days[sch.weekendDay - 1];
    ok(we.kind === 'long' && we.minutes === sch.weekendMinutes && we.workout.totalSec === sch.weekendMinutes * 60, `${tag}: finde largo`);
    for (const d of days) if (d.kind === 'short') ok(d.minutes === sch.weekdayMinutes && d.workout.totalSec === sch.weekdayMinutes * 60, `${tag} ${d.date}: entre semana ${sch.weekdayMinutes}′`);
    if (info.isDeload) ok(days[4].templateId === 'test-vam' && days[4].kind === 'test', `${tag}: viernes de descarga = test VAM`);
    else ok(days.every((d) => d.templateId !== 'test-vam'), `${tag}: sin test fuera de la descarga`);
    if (!st.treadmill.hasIncline) ok(days.every((d) => d.workout?.category !== 'hills'), `${tag}: sin cuestas sin inclinación`);
    else if (wk % 2 === 1 && !info.isDeload) ok(days[2].workout.category === 'hills', `${tag}: miércoles de cuestas en semana par`);
    ok(days[0].workout.category === (info.isDeload ? days[0].workout.category : 'intervals') && (info.isDeload || days[1].workout.category === 'tempo'), `${tag}: L intervalos · M tempo`);
    ok(days[3].workout.category === 'endurance', `${tag}: jueves de resistencia`);
    ok(days[3].templateId !== we.templateId, `${tag}: jueves ≠ finde`);
    const tids = days.filter((d) => d.templateId).map((d) => d.templateId);
    ok(new Set(tids).size === tids.length, `${tag}: sin plantillas repetidas en la semana`);
    if (prev) {
      for (const i of [0, 1, 2, 3, 4]) ok(days[i].templateId !== prev[i].templateId, `${tag}: ${fmt.weekdayName(i + 1)} repite ${days[i].templateId}`);
      ok(we.templateId !== prev[sch.weekendDay - 1].templateId, `${tag}: finde repite plantilla`);
    }
    if (prev2) {
      const same2 = [0, 1, 2, 3, 4].filter((i) => days[i].templateId === prev2[i].templateId && days[i].kind !== 'test').length;
      repeats2 += same2;
    }
    prev2 = prev;
    tids.forEach((x) => used.add(x));
    const tot = days.reduce((a, d) => a + (d.workout?.totalSec || 0), 0);
    const easy = days.reduce((a, d) => a + (d.workout ? Object.entries(d.workout.timeInZone).filter(([z]) => EASY.has(z)).reduce((b, [, v]) => b + v, 0) : 0), 0);
    easyShare.push(easy / tot);
    prev = days;
  }
  ok(used.size >= 20, `plan ${cfg.name}: variedad en 12 semanas (${used.size} plantillas)`);
  const minEasy = Math.min(...easyShare);
  const avgEasy = easyShare.reduce((a, x) => a + x, 0) / easyShare.length;
  ok(minEasy >= 0.55 && avgEasy >= 0.68, `plan ${cfg.name}: polarizado (suave medio ${pct(avgEasy)} ≥ 68 %, mín ${pct(minEasy)} ≥ 55 % en semana de reto)`);
  ok(repeats2 <= 3, `plan ${cfg.name}: casi nunca repite el mismo día con dos semanas de diferencia (${repeats2})`);
  line(`Plan «${cfg.name}»: ${used.size} plantillas distintas en 12 semanas · repeticiones a 2 semanas: ${repeats2} · tiempo suave medio ${pct(avgEasy)} (mín ${pct(minEasy)})`);
}

// Overrides, intercambios, estados y alternativas
{
  const st = makeState();
  const mon = addDays(START, 7);
  const [dMon, dTue, dWed, dThu, , dSat, dSun] = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const before = planWeek(st, mon, NOW_FAR);
  swapDays(st, dMon, dWed);
  const afterSwap = planWeek(st, mon, NOW_FAR);
  ok(JSON.stringify(afterSwap[0].workout.segments) === JSON.stringify(before[2].workout.segments)
    && JSON.stringify(afterSwap[2].workout.segments) === JSON.stringify(before[0].workout.segments), 'swapDays mueve la clase intacta');
  ok(afterSwap[0].isOverride && afterSwap[2].isOverride, 'swapDays marca override');
  swapDays(st, dMon, dWed);
  ok(Object.keys(st.plan.overrides).length === 0, 'intercambiar dos veces deja el plan limpio');
  swapDays(st, dSat, dSun);
  const ws = planWeek(st, mon, NOW_FAR);
  ok(ws[5].kind === 'rest' && ws[6].kind === 'long' && ws[6].workout.totalSec === 50 * 60, 'swap sábado ↔ domingo');
  clearDayOverride(st, dSat);
  clearDayOverride(st, dSun);
  setDayOverride(st, dTue, { rest: true });
  ok(planDay(st, dTue, NOW_FAR).kind === 'rest' && planDay(st, dTue, NOW_FAR).status === 'rest', 'override descanso');
  setDayOverride(st, dTue, { rest: false });
  ok(!st.plan.overrides[dTue] && planDay(st, dTue, NOW_FAR).templateId === before[1].templateId, 'quitar descanso vuelve al plan');
  setDayOverride(st, dSun, { rest: false });
  const sun = planDay(st, dSun, NOW_FAR);
  ok(sun.kind === 'short' && sun.workout && sun.workout.category === 'recovery' || sun.workout?.templateId === 'aerobic-base', `entrenar en día de descanso → sesión suave (${sun.templateId})`);
  clearDayOverride(st, dSun);
  const alts = alternativesFor(st, dMon, 6);
  ok(alts.length === 6 && new Set(alts.map((w) => w.templateId)).size === 6 && alts.every((w) => w.templateId !== before[0].templateId && w.totalSec === 1200), 'alternativesFor: 6 distintas, misma duración');
  ok(alts.filter((w) => w.category === 'intervals').length >= 1 && new Set(alts.map((w) => w.category)).size >= 3, 'alternativas: misma categoría + variedad');
  setDayOverride(st, dMon, { templateId: alts[3].templateId, minutes: alts[3].minutes });
  ok(JSON.stringify(planDay(st, dMon, NOW_FAR).workout.segments) === JSON.stringify(alts[3].segments), 'la alternativa elegida es la que aparece en el plan');
  const restAlts = alternativesFor(st, dSun, 6);
  ok(restAlts.length === 6 && restAlts[0].category === 'recovery', 'alternativas en descanso: suaves primero');
  setDayOverride(st, dThu, { minutes: 30 });
  const thu = planDay(st, dThu, NOW_FAR);
  ok(thu.minutes === 30 && thu.workout.totalSec === 1800 && thu.kind === 'short', `cambiar duración del jueves a 30′ (${thu.templateId})`);
  setDayOverride(st, dThu, { templateId: thu.templateId, minutes: 30 });
  ok(planDay(st, dThu, NOW_FAR).workout.totalSec === 1800, 'override duración + plantilla');
  clearDayOverride(st, dThu);
  ok(!st.plan.overrides[dThu], 'clearDayOverride');
  // Estados con un "ahora" fijo (miércoles)
  const now = new Date(parseKey(dWed).getTime() + 10 * 3600e3);
  st.history = [
    { id: 's1', dayKey: dMon, planDate: dMon, completionPct: 0.95, elapsedSec: 1140, distanceKm: 3.1 },
    { id: 's2', dayKey: dTue, planDate: dTue, completionPct: 0.3, elapsedSec: 360, distanceKm: 0.9 },
  ];
  const wk = planWeek(st, mon, now);
  ok(wk[0].status === 'done' && wk[0].session?.id === 's1', 'estado done');
  ok(wk[1].status === 'missed' && wk[1].session?.id === 's2', 'estado missed con sesión incompleta');
  ok(wk[2].status === 'today' && wk[3].status === 'upcoming' && wk[6].status === 'rest', 'estados today/upcoming/rest');
  ok(todayPlan(st, now).date === dWed, 'todayPlan');
  const t1 = nextTestDate(st, START);
  ok(t1 === addDays(START, 25) && weekdayOf(t1) === 5, `nextTestDate → viernes de la semana 4 (${t1})`);
  st.history.push({ id: 'st', dayKey: t1, planDate: t1, isTest: true, test: { lastStageSpeed: 13, secondsInLastStage: 20, vam: 13.17 }, completionPct: 0.5, elapsedSec: 1100 });
  ok(nextTestDate(st, t1) === addDays(t1, 28), 'tras hacer el test, el siguiente es 4 semanas después');
  ok(planDay(st, t1, NOW_FAR).status === 'done', 'test con resultado cuenta como hecho');
  const noStart = makeState({ plan: { startDate: null } });
  ok(planWeek(noStart, mondayOf('2026-10-14')).length === 7 && cycleInfo(noStart).weeksSinceStart === 0, 'sin startDate usa el lunes actual');
  ok(planDay(makeState({ levels: null, treadmill: null, schedule: null }), START, NOW_FAR).workout, 'estado incompleto no rompe planDay');
}

/* ═════════════ 4. Progresión ═════════════ */

const TIZ = (o) => ({ warmup: 180, walk: 0, jog: 0, run: 0, fast: 0, sprint: 0, cooldown: 120, ...o });
let sesN = 0;
const ses = (o = {}) => ({
  id: `p${++sesN}`, dayKey: '2026-10-10', completed: true, completionPct: 1, timeInZone: TIZ({ jog: 400, fast: 360, run: 30 }),
  adjustments: {}, levelsAtStart: { ...DEFAULT_LEVELS }, isTest: false, test: null, ...o,
});
const progState = (o = {}) => deepFreeze(makeState(o));
{
  const st = progState();
  const r = applyFeedback(st, deepFreeze(ses()), { feeling: 'easy', rpe: 3 });
  ok(r.levels.jog === 8.4 && r.levels.fast === 11.6 && r.levels.run === 10.1 && r.levels.sprint === 13.0, 'easy: +0,1 a los niveles usados (≥ 60 s)');
  ok(r.changes.length === 2 && r.changes.every((c) => c.reason === 'easy') && r.progression.lastBump.jog === '2026-10-10', 'easy: cambios y lastBump');
  ok(/^¡Sub(imos|en) tu/.test(r.message) && /8,4/.test(r.message), `mensaje de subida: ${r.message}`);
  const st2 = progState({ levels: r.levels, progression: r.progression });
  const r2 = applyFeedback(st2, ses({ dayKey: '2026-10-13' }), { feeling: 'easy' });
  ok(r2.changes.length === 0 && /hace muy poco/.test(r2.message), 'easy: máx. una subida por nivel cada 6 días');
  const r3 = applyFeedback(st2, ses({ dayKey: '2026-10-16' }), { feeling: 'easy' });
  ok(r3.levels.jog === 8.5 && r3.levels.fast === 11.7, 'easy: a los 6 días vuelve a subir');
  // ok ×3
  let s = makeState();
  const msgs = [];
  for (let i = 0; i < 3; i++) {
    const x = applyFeedback(deepFreeze(s), ses({ dayKey: addDays('2026-10-01', i * 2) }), { feeling: 'ok' });
    msgs.push(x.message);
    s = makeState({ levels: x.levels, progression: x.progression });
    if (i < 2) ok(x.changes.length === 0 && x.progression.okStreak.fast === i + 1, `ok: racha ${i + 1}`);
    else ok(x.levels.fast === 11.6 && x.levels.jog === 8.4 && x.progression.okStreak.fast === 0 && x.changes[0].reason === 'streak', 'ok: +0,1 al llegar a 3');
  }
  ok(/una más/.test(msgs[1]), `ok: mensaje de racha (${msgs[1]})`);
  // hard
  const rh = applyFeedback(progState({ progression: { okStreak: { fast: 2 } } }), ses(), { feeling: 'hard' });
  ok(rh.changes.length === 0 && rh.progression.okStreak.fast === 0, 'hard: mantiene y corta la racha cómoda');
  // max
  const rm1 = applyFeedback(progState(), ses(), { feeling: 'max' });
  ok(rm1.changes.length === 0 && rm1.progression.hardStreak === 1, 'max: mantiene la primera vez');
  const rm2 = applyFeedback(progState({ progression: { hardStreak: 1 } }), ses(), { feeling: 'max' });
  ok(rm2.levels.fast === 11.4 && rm2.levels.jog === 8.3 && rm2.progression.loadAdjust === -0.05 && rm2.changes[0].reason === 'fatigue', 'max ×2: −0,1 al nivel más alto usado y carga −0,05');
  // fail y sesión incompleta
  const rf = applyFeedback(progState(), ses({ timeInZone: TIZ({ jog: 300, run: 400, sprint: 120 }) }), { feeling: 'fail' });
  ok(rf.levels.sprint === 12.9 && rf.levels.run === 10.1 && rf.progression.loadAdjust === -0.05 && rf.progression.hardStreak === 1, 'fail: −0,1 al nivel más alto usado');
  // Incompleta: «muy fácil»/«cómodo» no bajan niveles; terminar antes aligera solo la carga
  const ri = applyFeedback(progState(), ses({ completionPct: 0.8, completed: false }), { feeling: 'easy' });
  ok(ri.changes.length === 0 && ri.levels.fast === 11.5 && ri.progression.loadAdjust < 0 && /antes de tiempo/.test(ri.message), `incompleta + fácil: mantiene niveles (${ri.message})`);
  const rio = applyFeedback(progState(), ses({ completionPct: 0.03, completed: false }), { feeling: 'ok' });
  ok(rio.changes.length === 0 && /mantenemos/.test(rio.message), 'incompleta + cómodo: mantiene niveles');
  const rih = applyFeedback(progState(), ses({ completionPct: 0.5, completed: false }), { feeling: 'hard' });
  ok(rih.levels.fast === 11.4 && /antes de tiempo/.test(rih.message), 'incompleta + exigente: baja un nivel');
  // Saltó tramos pero la clase llegó al final: neutral, sin tocar la carga
  const rs = applyFeedback(progState(), ses({ completionPct: 0.51, completed: false, plannedSec: 1200, speedTrace: [[0, 7], [600, 11.5], [1200, 6.5]] }), { feeling: 'easy' });
  ok(rs.changes.length === 0 && rs.progression.loadAdjust === 0 && /Saltaste/.test(rs.message), `saltar tramos + fácil: neutral (${rs.message})`);
  const rsf = applyFeedback(progState(), ses({ completionPct: 0.51, completed: false, finishedEarly: false }), { feeling: 'fail' });
  ok(rsf.levels.fast === 11.4, 'saltar tramos + no pude: baja');
  ok(!/ritmo rápido/.test(r.message) && /«Correr rápido»|«Trotar»/.test(r.message), `mensajes con los nombres de la interfaz (${r.message})`);
  // ajuste manual
  const ra = applyFeedback(progState(), ses({ adjustments: { fast: 0.4, jog: 0.1 } }), { feeling: 'ok' });
  ok(ra.levels.fast === 11.7 && ra.levels.jog === 8.3 && ra.changes.find((c) => c.level === 'fast').reason === 'adjust', 'ajuste manual ≥ +0,2 → adopta la mitad');
  const ra2 = applyFeedback(progState(), ses({ adjustments: { fast: 0.6 }, completed: false, completionPct: 0.9 }), { feeling: 'ok' });
  ok(ra2.levels.fast === 11.5, 'ajuste manual sin completar no se adopta');
  // tope de 28 días
  const capSt = progState({
    levels: { jog: 8.3, run: 10.1, fast: 12.1, sprint: 13.0 },
    levelHistory: [{ date: '2026-09-01', levels: { ...DEFAULT_LEVELS }, reason: 'init' }, { date: '2026-09-25', levels: { ...DEFAULT_LEVELS, fast: 12.1 }, reason: 'progression' }],
  });
  const rc = applyFeedback(capSt, ses({ timeInZone: TIZ({ fast: 600 }) }), { feeling: 'easy' });
  ok(rc.levels.fast === 12.1 && rc.changes.length === 0 && /consolidamos/.test(rc.message), 'tope +0,6 km/h en 28 días');
  const rc2 = applyFeedback(capSt, ses({ dayKey: '2026-11-20', timeInZone: TIZ({ fast: 600 }) }), { feeling: 'easy' });
  ok(rc2.levels.fast === 12.2, 'fuera de la ventana de 28 días vuelve a subir');
  // orden de niveles
  const close = { jog: 9.3, run: 10.1, fast: 11.5, sprint: 13.0 };
  const ro = applyFeedback(progState({ levels: close, levelHistory: [{ date: START, levels: close, reason: 'init' }] }), ses({ timeInZone: TIZ({ jog: 900 }) }), { feeling: 'easy' });
  ok(ro.levels.jog === 9.4 && ro.levels.run === 10.2 && ro.changes.find((c) => c.level === 'run').reason === 'order', 'enforceLevelOrder empuja el nivel superior');
  // límites de carga y deriva
  ok(applyFeedback(progState({ progression: { loadAdjust: -0.14 } }), ses(), { feeling: 'fail' }).progression.loadAdjust === -0.15, 'loadAdjust ≥ −0,15');
  ok(applyFeedback(progState({ progression: { loadAdjust: 0.14 } }), ses(), { feeling: 'easy' }).progression.loadAdjust === 0.15, 'loadAdjust ≤ +0,15');
  ok(applyFeedback(progState({ progression: { loadAdjust: -0.1 } }), ses(), { feeling: 'ok' }).progression.loadAdjust === -0.08, 'loadAdjust vuelve hacia 0 con ok');
  ok(applyFeedback(progState({ progression: { loadAdjust: 0.01 } }), ses(), { feeling: 'ok' }).progression.loadAdjust === 0, 'deriva sin pasarse de 0');
  ok(applyFeedback(progState(), null, {}).changes.length === 0, 'sesión nula no rompe');
  // test VAM
  const ts = deepFreeze(ses({ isTest: true, test: { lastStageSpeed: 13.0, secondsInLastStage: 30, vam: 13.25 }, completionPct: 0.6 }));
  const et = evaluateTest(ts);
  ok(et.vam === 13.3 && et.vo2max === 46.6 && JSON.stringify(et.levels) === JSON.stringify(levelsFromVam(13.3)), `evaluateTest Kuipers (${et.vam})`);
  ok(evaluateTest({ test: { lastStageSpeed: 12.5, secondsInLastStage: 0 } }).vam === 12.5, 'Kuipers con escalón completo');
  ok(evaluateTest({ test: null, speedTrace: [[0, 7.1], [300, 8.0], [360, 8.5], [420, 9.0], [450, 6.5]], elapsedSec: 600, levelsAtStart: DEFAULT_LEVELS }).vam === 8.8, 'evaluateTest desde speedTrace');
  ok(evaluateTest({}).vam === 0 && evaluateTest({}).levels === null, 'test sin datos → vam 0');
  const lowT = evaluateTest({ test: { lastStageSpeed: 10.5, secondsInLastStage: 0 }, levelsAtStart: DEFAULT_LEVELS });
  ok(lowT.levels.fast === 11.1 && lowT.levels.jog === 7.9, 'un mal test no hunde los niveles (máx. −0,4)');
  ok(evaluateTest(ts, makeState({ progression: { lastTest: { date: '2026-09-01', vam: 12.8 } } })).deltaVam === 0.5, 'deltaVam frente al último test');
  const rt = applyFeedback(progState(), ts, { feeling: 'max' });
  ok(rt.levels.fast === levelsFromVam(13.3).fast && rt.progression.lastTest.vam === 13.3 && rt.progression.bestVam === 13.3 && rt.changes.every((c) => c.reason === 'test'), 'applyFeedback en test recalcula con la VAM');
  ok(FEELINGS.length === 5 && feelingToRpe('hard') === 7 && feelingToRpe('zzz') === 5, 'FEELINGS y feelingToRpe');
  line('Progresión: easy · ok×3 · hard · max×2 · fail · incompleta · ajuste manual · tope 28 días · orden · carga · test VAM ✓');
}

/* ═════════════ 5. Logros y estadísticas sobre un historial sintético ═════════════ */

function sessionFromWorkout(w, dayKey, i, extra = {}) {
  const hour = i % 9 === 0 ? 6 : i % 23 === 0 ? 22 : 19;
  const d = parseKey(dayKey);
  d.setHours(hour, 30, 0, 0);
  return {
    id: `ses_${i}`, workoutId: w.id, templateId: w.templateId, title: w.title, category: w.category,
    startedAt: d.toISOString(), dayKey, planDate: dayKey, plannedSec: w.totalSec, elapsedSec: w.totalSec,
    completed: true, completionPct: 1, distanceKm: w.estDistanceKm, avgSpeed: Math.round((w.estDistanceKm / (w.totalSec / 3600)) * 10) / 10,
    maxSpeed: w.maxSpeed, kcal: w.estKcal, timeInZone: { ...w.timeInZone }, speedTrace: [], adjustments: {},
    levelsAtStart: { ...DEFAULT_LEVELS }, feeling: ['ok', 'easy', 'hard', 'ok'][i % 4], rpe: null,
    hrAvg: i % 5 === 0 ? 142 : null, hrMax: null, notes: '', isTest: w.isTest, test: null, levelChanges: [], ...extra,
  };
}

const realToday = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const synthStart = addDays(mondayOf(realToday), -26 * 7);
const synth = makeState({ plan: { startDate: synthStart }, schedule: { thursdayMinutes: 60, weekendMinutes: 60 }, treadmill: { hasIncline: true } });
{
  let i = 0;
  let testN = 0;
  for (let d = synthStart; d <= realToday; d = addDays(d, 1)) {
    const day = planDay(synth, d);
    if (!day.workout || (i % 13 === 7)) { i++; continue; }
    const extra = {};
    if (day.workout.isTest) {
      testN++;
      extra.test = { lastStageSpeed: 12.5 + 0.5 * Math.min(testN, 3), secondsInLastStage: 20, vam: 12.67 + 0.5 * Math.min(testN, 3) };
      extra.elapsedSec = 1080;
      extra.completionPct = 0.62;
      extra.maxSpeed = extra.test.lastStageSpeed + 0.5;
      extra.timeInZone = { warmup: 210, walk: 0, jog: 150, run: 180, fast: 180, sprint: 180, cooldown: 180 };
    }
    if (i === 30) extra.levelChanges = [{ level: 'fast', from: 11.5, to: 11.6, reason: 'easy' }];
    synth.history.push(sessionFromWorkout(day.workout, d, i, extra));
    i++;
  }
}
{
  const h = synth.history;
  ok(ACHIEVEMENTS.length >= 24, `≥ 24 logros (${ACHIEVEMENTS.length})`);
  ok(new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length, 'ids de logros únicos');
  ok(ACHIEVEMENTS.every((a) => a.title && a.description && ICONS.has(a.icon) && ['bronze', 'silver', 'gold'].includes(a.tier) && typeof a.check === 'function'), 'logros bien formados (icono de la lista)');
  ok(evaluateAchievements(makeState()).length === 0, 'sin historial no hay logros');
  const got = evaluateAchievements(synth);
  const gotIds = new Set(got.map((a) => a.id));
  ok(got.every((a) => !('check' in a)), 'evaluateAchievements devuelve objetos sin check');
  const tot = totals(h);
  for (const n of [5, 10, 25, 50, 100, 250]) ok(gotIds.has(`sessions-${n}`) === (h.length >= n), `logro sessions-${n} coherente`);
  for (const n of [10, 50, 100, 250, 500, 1000]) ok(gotIds.has(`km-${n}`) === (tot.km >= n), `logro km-${n} coherente`);
  for (const id of ['first-run', 'streak-2', 'streak-12', 'early-bird', 'night-owl', 'level-up', 'first-test', 'vam-record', 'month-20', 'hour-session',
    'explorer', 'collector', 'feedback-10', 'watch-hr', 'full-week', 'hills-5']) ok(gotIds.has(id), `logro esperado: ${id}`);
  ok(!gotIds.has('sprint-15') && !gotIds.has('comeback'), 'logros no merecidos siguen bloqueados');
  const all = makeState({ ...synth, achievements: Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, '2026-01-01T00:00:00Z'])) });
  ok(evaluateAchievements(all).length === 0, 'logros ya desbloqueados no se repiten');
  line(`Logros: ${ACHIEVEMENTS.length} definidos · ${got.length} desbloqueados con ${h.length} sesiones sintéticas (${fmt.km(tot.km)} km)`);
  if (VERBOSE) line(`  desbloqueados: ${[...gotIds].join(', ')}`);

  // Estadísticas
  ok(tot.sessions === h.length && Math.abs(tot.km - h.reduce((a, s) => a + s.distanceKm, 0)) < 0.01 && tot.sec === h.reduce((a, s) => a + s.elapsedSec, 0), 'totals');
  const wb = weeklyBuckets(h, 12, realToday);
  ok(wb.length === 12 && wb[11].monday === mondayOf(realToday) && wb[0].monday === addDays(mondayOf(realToday), -77), 'weeklyBuckets: 12 semanas ordenadas');
  ok(wb.slice(0, 11).every((b) => b.sessions >= 4 && b.km > 0), 'weeklyBuckets con datos');
  const sw = streakWeeks(synth, new Date());
  ok(sw >= 20, `streakWeeks (${sw})`);
  const dv = dayValues(h);
  ok(Object.keys(dv).length === new Set(h.map((s) => s.dayKey)).size && Object.values(dv).every((m) => m > 0), 'dayValues');
  const rec = records(h);
  const longest = h.reduce((a, s) => (s.elapsedSec > a.elapsedSec ? s : a));
  ok(rec.longestSec.value === longest.elapsedSec && h.find((s) => s.id === rec.longestSec.sessionId)?.elapsedSec === longest.elapsedSec, 'records.longestSec con sessionId');
  ok(rec.bestVam && rec.bestVam.value === Math.max(...h.filter((s) => s.isTest).map((s) => s.test.vam)), 'records.bestVam');
  ok(records([]).longestSec === null, 'records vacío → null');
  const wp = weekProgress(synth, addDays(mondayOf(realToday), -7));
  ok(wp.plannedSessions === 6 && wp.doneSessions >= 5 && wp.minutes > 0 && wp.plannedMinutes >= 150 && wp.km > 0, `weekProgress (${JSON.stringify(wp)})`);
  line(`Stats: racha ${sw} semanas · última semana ${wp.doneSessions}/${wp.plannedSessions} sesiones, ${wp.minutes}′ de ${wp.plannedMinutes}′, ${fmt.km(wp.km)} km`);
}

/* ═════════════ 6. Análisis del coach ═════════════ */
{
  const samples = [];
  const insight = (label, st, now) => {
    const t = coachInsight(st, now);
    ok(typeof t === 'string' && t.length > 20 && !/undefined|NaN|null|\[object/.test(t), `coachInsight (${label}): ${t}`);
    samples.push(`  · ${label}: ${t}`);
  };
  insight('sin historial', makeState(), new Date(2026, 8, 8, 9));
  insight('historial real', synth, new Date());
  const testDay = nextTestDate(synth, realToday);
  insight('día de test', synth, new Date(parseKey(testDay).getTime() + 9 * 3600e3));
  insight('semana de descarga', synth, new Date(parseKey(addDays(testDay, -4)).getTime() + 9 * 3600e3));
  const gap = makeState({ ...synth, history: synth.history.filter((s) => s.dayKey <= addDays(realToday, -5)) });
  insight('5 días sin correr', gap, new Date());
  const tough = makeState({ ...synth, history: synth.history.map((s, i, arr) => (i >= arr.length - 3 ? { ...s, feeling: 'max' } : s)) });
  insight('sesiones al límite', tough, new Date());
  const gains = makeState({ ...synth, levels: { jog: 8.6, run: 10.4, fast: 11.9, sprint: 13.2 } });
  insight('progreso 4 semanas', gains, new Date());
  const texts = new Set();
  for (let d = 0; d < 14; d++) texts.add(coachInsight(synth, new Date(Date.now() + d * 86400e3)));
  ok(texts.size >= 3, `coachInsight varía con los días (${texts.size} frases distintas en 14 días)`);
  line('Coach (muestras):');
  samples.forEach((s) => line(s));
}

/* ═════════════ 7. Muestras para revisión de entrenador ═════════════ */
{
  const lv = DEFAULT_LEVELS;
  const show = (id, minutes, { seed = 11, load = 1, inc = false } = {}) => {
    const w = buildWorkout(id, { minutes, levels: lv, seed, loadFactor: load, hasIncline: inc, treadmill: { ...TM, hasIncline: inc } });
    const easy = Object.entries(w.timeInZone).filter(([z]) => EASY.has(z)).reduce((a, [, v]) => a + v, 0);
    line(`▸ ${w.title} · ${w.minutes}′ · carga ${String(load).replace('.', ',')} · ${fmt.km(w.estDistanceKm)} km · ${w.estKcal} kcal · intensidad ${'●'.repeat(w.intensity)}${'○'.repeat(3 - w.intensity)} · suave ${pct(easy / w.totalSec)} · sprint ${fmt.clock(w.timeInZone.sprint)} · rápido ${fmt.clock(w.timeInZone.fast)}`);
    for (const g of groupSegments(w.segments)) {
      const cue = g.segments.find((s) => s.cue)?.cue;
      const rep = g.segments[0].rep ? ` [${g.segments[0].rep.i}/${g.segments[0].rep.n}]` : '';
      line(`    ${g.label}${rep}${cue ? `  «${cue}»` : ''}`);
    }
  };
  line('Muestras:');
  show('pyramid', 20);
  show('threshold-3x4', 20, { load: 1.16 });
  show('sprint-30-60', 30, { load: 0.72 });
  show('long-progressive', 50);
  show('long-blocks', 50, { load: 1.16 });
  show('hills-short', 20, { inc: true });
  show('surprise', 45);
  show('challenge-10k', 60);
  show('easy-strides', 20);
  show('test-vam', 20);
  line('Semana tipo (plan base, 4 semanas):');
  const st = makeState();
  for (let wk = 0; wk < 4; wk++) {
    const days = planWeek(st, addDays(START, wk * 7), NOW_FAR);
    const info = cycleInfo(st, addDays(START, wk * 7));
    line(`  S${wk + 1} ${info.weekName.padEnd(15)} ${days.map((d) => `${fmt.weekdayShort(d.weekday)} ${d.workout ? `${d.workout.title} ${d.minutes}′` : 'descanso'}`).join(' · ')}`);
  }
}

/* ═════════════ Resultado ═════════════ */
console.log(report.join('\n'));
console.log('');
if (fails) {
  console.log(`✗ ${fails} de ${checks} comprobaciones fallan:`);
  for (const f of failures) console.log(`  - ${f}`);
  if (fails > failures.length) console.log(`  … y ${fails - failures.length} más`);
  process.exit(1);
}
console.log(`✓ ${checks} comprobaciones correctas`);
