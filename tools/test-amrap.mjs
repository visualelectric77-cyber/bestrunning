// RITMUP · AMRAP («tantas rondas como puedas»): plantillas, lo previsto, récords y el interruptor del plan.
// El motor (rondas, fases, + / −, pausa, saltos, restauración) se prueba en tools/test-engine.mjs.
// Uso: node tools/test-amrap.mjs   (sale con código ≠ 0 si algo falla)
import { TEMPLATES, getTemplate } from '../js/training/templates.js';
import { buildWorkout, workoutFromId } from '../js/training/generator.js';
import { amrapExpected, amrapResultText, amrapCompare, amrapScore, normAmrap } from '../js/training/amrap.js';
import { planWeek, setPlannerToday, amrapPlanFrom, amrapPlanValue } from '../js/training/planner.js';
import { bonusTemplates } from '../js/training/bonus.js';
import { defaultState } from '../js/core/store.js';
import { createCoach } from '../js/audio/coach.js';
import { PACK_SCRIPT } from '../js/audio/voice-pack.js';
import { addDays } from '../js/core/utils.js';

let failures = 0;
let passes = 0;
const ok = (c, msg) => { if (c) { passes++; return true; } failures++; process.stderr.write(`  ✗ ${msg}\n`); return false; };
const section = (t) => process.stdout.write(`• ${t}\n`);

const L = { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 };
const TM = { hasIncline: true, maxIncline: 12, minSpeed: 1, maxSpeed: 18 };
const AM = TEMPLATES.filter((t) => t.family === 'amrap');

section('Catálogo: formatos AMRAP');
{
  ok(AM.length >= 8, `al menos 8 formatos (hay ${AM.length})`);
  ok(AM.every((t) => t.planOnly === true && t.intensity === 'hard' && t.id.startsWith('amrap-')), 'planOnly, duras y con id amrap-*');
  const sigs = new Set();
  for (const t of AM) {
    for (const min of [20, 30, 45, 60]) {
      for (const inc of t.requiresIncline ? [true] : [false, true]) {
        const w = buildWorkout(t.id, { minutes: min, levels: L, seed: 3, hasIncline: inc, treadmill: { ...TM, hasIncline: inc } });
        const tag = `${t.id} ${min}′${inc ? ' inc' : ''}`;
        if (!ok(w && w.totalSec === min * 60, `${tag}: dura ${w?.totalSec}`)) continue;
        const am = w.segments.filter((s) => s.amrap);
        ok(am.length >= 1, `${tag}: tiene AMRAP`);
        for (const s of am) {
          ok(s.sec % 60 === 0 && s.sec >= 120, `${tag}: tope en minutos (${s.sec})`);
          ok(s.amrap.restSpeed < s.amrap.workSpeed, `${tag}: la recuperación va por debajo del trabajo`);
          ok(s.speed === s.amrap.workSpeed && s.amrap.workSpeed <= TM.maxSpeed, `${tag}: velocidad del tramo = la del trabajo`);
          ok(!!normAmrap(s.amrap, s), `${tag}: definición válida`);
          const e = amrapExpected(s);
          ok(e.rounds >= 1 && e.workSec > 0 && e.workSec + e.restSec <= s.sec + 1e-6, `${tag}: rondas previstas ${amrapResultText(e)}`);
        }
        if (min === 30 && !inc) sigs.add(JSON.stringify(am.map((s) => [s.sec, s.amrap.workM, s.amrap.restSec || 0, s.amrap.restM || 0, s.amrap.step])));
        // se reconstruye igual desde su id (historial, análisis, resumen)
        const re = workoutFromId(w.id, { levels: L, treadmill: { ...TM, hasIncline: inc } });
        ok(re && JSON.stringify(re.segments) === JSON.stringify(w.segments), `${tag}: workoutFromId reconstruye la AMRAP`);
      }
    }
  }
  ok(sigs.size >= 8, `formatos distintos de verdad (${sigs.size})`);
  ok(bonusTemplates(30, { hasIncline: true }).filter((t) => t.family === 'amrap').length >= 8, 'las AMRAP salen en el bonus');
  const hill = getTemplate('amrap-hill');
  ok(hill.requiresIncline && hill.category === 'hills', 'la AMRAP en cuesta pide inclinación');
  const w = buildWorkout('amrap-hill', { minutes: 30, levels: L, seed: 1, hasIncline: true, treadmill: TM });
  ok(w.segments.some((s) => s.amrap && s.incline >= 2), 'la cuesta va inclinada todo el bloque');
  const climb = buildWorkout('amrap-climb', { minutes: 30, levels: L, seed: 1, treadmill: TM });
  ok(climb.segments.find((s) => s.amrap).amrap.step === 0.2, 'la que se endurece sube 0,2 por ronda');
}

section('Lo previsto: más rondas si vas más rápido');
{
  const seg = { sec: 600, amrap: { workM: 400, workSpeed: 12, restSec: 60, restSpeed: 8, step: 0 } };
  const e = amrapExpected(seg);
  ok(e.rounds === 3 && e.extraM === 200, `600 s de 400 m a 12 + 60 s → 3 rondas + 200 m (${amrapResultText(e)})`);
  const f = amrapExpected({ ...seg, amrap: { ...seg.amrap, workSpeed: 14 } });
  ok(amrapScore(f) > amrapScore(e), 'a 14 km/h, más');
  ok(amrapResultText({ rounds: 7, extraM: 120 }) === '7 rondas + 120 m' && amrapResultText({ rounds: 1 }) === '1 ronda', 'texto del resultado');
}

section('Récord: la misma AMRAP, la vez anterior');
{
  const blk = (rounds, extraM, extra = {}) => ({ index: 4, cap: 900, rounds, extraM, workM: 400, restSec: 60, ...extra });
  const hist = [
    { id: 'a', templateId: 'amrap-400', startedAt: '2026-11-01T07:00:00Z', amrap: [blk(8, 0)] },
    { id: 'b', templateId: 'amrap-400', startedAt: '2026-11-10T07:00:00Z', amrap: [blk(6, 300)] },
    { id: 'c', templateId: 'amrap-400', startedAt: '2026-11-12T07:00:00Z', amrap: [blk(9, 0, { cap: 1200 })] }, // otro tope: no cuenta
    { id: 'd', templateId: 'amrap-200-100', startedAt: '2026-11-13T07:00:00Z', amrap: [blk(12, 0)] },        // otra AMRAP
  ];
  const ses = { id: 'x', templateId: 'amrap-400', startedAt: '2026-11-20T07:00:00Z', amrap: [blk(7, 120)] };
  const [c] = amrapCompare(ses, hist);
  ok(c.best?.rounds === 8 && c.last?.rounds === 6 && c.isRecord === false, 'récord 8 rondas, la última 6 + 300 m');
  const [c2] = amrapCompare({ ...ses, amrap: [blk(8, 50)] }, hist);
  ok(c2.isRecord === true, '8 + 50 m bate 8');
  ok(amrapCompare({ ...ses, templateId: 'amrap-float' }, hist)[0].best === null, 'primera vez: sin récord');
  ok(amrapCompare({ id: 'y', templateId: 'pyramid' }, hist).length === 0, 'sin AMRAP: nada');
}

section('Voz: avisos de fase con las frases de siempre y las nuevas de la AMRAP');
{
  const tick = () => new Promise((r) => setImmediate(r));
  const W = { segments: [{ zone: 'warmup', speed: 6.5, sec: 120 }, { zone: 'fast', speed: 11.5, sec: 600, amrap: { workM: 400, workSpeed: 11.5, restSec: 60, restSpeed: 8.1 } }, { zone: 'cooldown', speed: 6, sec: 120 }] };
  const mk = (avail) => {
    const said = [];
    const coach = createCoach(W, { voiceEnabled: false, chattiness: 'normal', seed: 5, ...(avail ? { pack: { available: avail } } : {}), onCue: (c) => said.push(c) });
    const dyn = async (kind, vars) => { const n = said.length; await coach.say(kind, vars); await tick(); return said.slice(n); };
    return { coach, dyn };
  };
  const all = new Set(PACK_SCRIPT.map((c) => c.id));
  const { dyn } = mk(all);
  const pre = (await dyn('amrapPre', { dir: 'down', speed: 8.1, zone: 'jog', fromHard: true, lead: 10 }))[0];
  ok(pre && /^(down|recoverpre)_\d$/.test(pre.clips?.[0]) && pre.clips?.[1] === 's_81', `pre-aviso «bajamos a… ocho coma uno» (${pre?.clips})`);
  const now = (await dyn('amrapNow', { zone: 'fast', speed: 11.5, dir: 'up', fromHard: false }))[0];
  ok(now && /^now_fast_\d$/.test(now.clips?.[0]) && now.clips?.includes('s_115'), `cambio «¡Ahora! Correr rápido. Once coma cinco.» (${now?.clips})`);
  const go = (await dyn('amrapGo', {}))[0];
  ok(go && go.clips?.[0] === 'amrapgo_1', 'al empezar: «pon la velocidad que aguantes y márcala en la pantalla»');
  ok(PACK_SCRIPT.some((c) => c.id === 'amrapgo_1') && PACK_SCRIPT.some((c) => c.id === 'amrapend_1') && PACK_SCRIPT.some((c) => c.id === 'amrapapp_1') && PACK_SCRIPT.some((c) => c.id === 'amraprecord_1'), 'frases nuevas en el guion');
  // sin grabar las nuevas: calla (la pantalla lo dice igual), nunca mezcla con la voz del sistema
  const old = new Set([...all].filter((id) => !id.startsWith('amrap')));
  const m2 = mk(old);
  ok((await m2.dyn('amrapGo', {})).length === 0 && (await m2.dyn('amrapEnd', {})).length === 0, 'sin la grabación: no dice nada');
  // voz del sistema (sin pack)
  const m3 = mk(null);
  const t = (await m3.dyn('amrapPre', { dir: 'up', speed: 11.5, zone: 'fast', lead: 8 }))[0];
  ok(t && /11,5/.test(t.text), `voz del sistema con la velocidad (${t?.text})`);
  const e = (await m3.dyn('amrapEnd', { result: '7 rondas y 120 metros' }))[0];
  ok(e && /7 rondas y 120 metros/.test(e.text), 'voz del sistema: el resultado');
}

section('Plan: interruptor de Perfil');
{
  const START = '2026-09-07';
  const base = (effort = null) => {
    const st = defaultState();
    st.onboarded = true;
    st.plan.startDate = START;
    st.profile.effort = effort;
    st.levels = { ...L };
    return st;
  };
  setPlannerToday('2026-11-28');
  for (const effort of [null, 'hard']) {
    const off = base(effort);
    const on = base(effort);
    on.plan.amrap = amrapPlanValue(true, '2026-11-30');
    ok(amrapPlanFrom(off) === null && amrapPlanFrom(on) === '2026-11-30', 'valor guardado del interruptor');
    let same = true;
    let weeksWith = 0;
    let weeksHard = 0;
    for (let w = 0; w < 30; w++) {
      const mon = addDays(START, 7 * w);
      const a = planWeek(off, mon);
      const b = planWeek(on, mon);
      const am = b.filter((d) => d.templateId && getTemplate(d.templateId)?.family === 'amrap');
      // apagado: ninguna AMRAP en el plan
      ok(!a.some((d) => d.templateId && getTemplate(d.templateId)?.family === 'amrap'), `apagado: sin AMRAP (${mon})`);
      if (mon < '2026-11-30') {
        if (JSON.stringify(a.map((d) => [d.templateId, d.minutes])) !== JSON.stringify(b.map((d) => [d.templateId, d.minutes]))) same = false;
        ok(am.length === 0, `antes de encenderlo, nada cambia (${mon})`);
        continue;
      }
      ok(am.length <= 1, `encendido: como mucho una AMRAP por semana (${mon}: ${am.length})`);
      for (const d of am) {
        ok(d.role === 'hard' && d.weekday >= 1 && d.weekday <= 5, `encendido: la AMRAP va en un día duro entre semana (${d.date} ${d.role} ${d.weekday})`);
        ok(d.minutes >= 20 && getTemplate(d.templateId).durations.some(() => true), `encendido: con la duración del día (${d.minutes}′)`);
      }
      if (b.some((d) => d.role === 'hard' && d.weekday <= 5 && d.kind !== 'test')) weeksHard++;
      if (am.length) weeksWith++;
    }
    ok(same, `semanas anteriores a encenderlo: idénticas (${effort || 'normal'})`);
    ok(weeksWith >= 3, `encendido: salen AMRAP entre semana (${weeksWith} de ${weeksHard} semanas con día duro, ${effort || 'normal'})`);
    process.stdout.write(`  ${effort || 'normal'}: AMRAP en ${weeksWith} de ${weeksHard} semanas con día duro entre semana\n`);
  }
  setPlannerToday(null);
}

process.stdout.write(`\n${failures ? `✗ ${failures} fallos` : '✓ todo bien'} · ${passes + failures} comprobaciones\n`);
process.exit(failures ? 1 : 0);
