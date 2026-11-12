// RITMUP · tests de la fase 2 de la auditoría del algoritmo (12 nov 2026): entreno exigente (Ajustes › Exigencia).
// Uso: node tools/test-fase2.mjs   (sale con código ≠ 0 si algo falla)
import { hrTargetForZone, hrZones, isHardEffort, DEFAULT_LEVELS } from '../js/training/levels.js';
import { applyFeedback } from '../js/training/progression.js';
import { liveSpeed, calibrateClass } from '../js/training/hr-control.js';
import { zoneCompliance } from '../js/training/hr-shape.js';
import { defaultState } from '../js/core/store.js';
import { deepClone } from '../js/core/utils.js';

let failures = 0;
let passes = 0;
function ok(cond, msg) {
  if (cond) { passes++; return; }
  failures++;
  process.stderr.write(`  ✗ ${msg}\n`);
}
function section(name, fn) {
  process.stdout.write(`• ${name}\n`);
  try { fn(); } catch (err) { failures++; process.stderr.write(`  ✗ excepción: ${err?.stack || err}\n`); }
}

const P = { age: 40, hrMax: 180, hrRest: 60 };            // perfil de ejemplo (no es de nadie)
const PH = { ...P, effort: 'hard' };
const Z = hrZones(180, 60);                                // Z3 144–156 · Z4 156–168 · Z5 168–180

section('Techos de pulso: lo duro, más duro; lo suave, igual', () => {
  ok(!isHardEffort(P) && isHardEffort(PH) && !isHardEffort(null) && !isHardEffort({ effort: 'x' }), 'el modo se lee del perfil');
  for (const z of ['warmup', 'walk', 'jog', 'cooldown', 'sprint']) {
    const a = hrTargetForZone(z, P);
    const b = hrTargetForZone(z, PH);
    ok(a.min === b.min && a.max === b.max && !b.pushed, `${z}: igual en los dos modos`);
  }
  const fast = hrTargetForZone('fast', P);
  const fastH = hrTargetForZone('fast', PH);
  ok(fast.max === Z[3].max && fastH.max === 175 && fastH.min === fast.min && fastH.pushed === true, `rápido: techo de ${fast.max} a ${fastH.max} (FC máx. − 5)`);
  ok(fastH.max > Z[4].min, 'rápido exigente deja entrar en Z5');
  const run = hrTargetForZone('run', P);
  const runH = hrTargetForZone('run', PH);
  ok(run.max === Z[2].max && runH.max === Math.round((Z[3].min + Z[3].max) / 2) && runH.min === run.min, `correr: techo de ${run.max} a ${runH.max} (mitad de Z4)`);
  ok(hrTargetForZone('fast', { ...PH, hrRest: null }).max === 175, 'sin FC en reposo, igual');
  ok(!('pushed' in fast) && !('pushed' in run), 'en modo normal nada va marcado');
});

const M = { b: 10, c: 4, d: 0.4, tauUp: 75, tauDown: 110, aTypical: 40, aSpread: 3 };

section('El control en directo usa el techo nuevo', () => {
  // un rápido largo con el pulso entrando en Z5: el modo normal baja; el exigente, no (aún bajo su techo)
  const seg = { zone: 'fast', speed: 12, sec: 240, incline: 0 };
  const args = { seg, hrNow: 166, remaining: 120, speed: 12, load: 22 };
  const normal = liveSpeed(M, 44, { ...args, target: hrTargetForZone('fast', P) });
  const hard = liveSpeed(M, 44, { ...args, target: hrTargetForZone('fast', PH) });
  ok(normal && normal.speed < 12, `modo normal: baja (${normal?.speed})`);
  ok(hard === null, 'modo exigente: te deja seguir');
  // pero si te pasas del techo exigente, baja igual: el pulso sigue mandando
  const over = liveSpeed(M, 54, { ...args, hrNow: 176, load: 40, target: hrTargetForZone('fast', PH) });
  ok(over && over.speed < 12, `pasado el techo exigente, baja (${over?.speed})`);
  // antes de la clase: en exigente los tramos duros no se rebajan de antemano tanto como en normal
  const segs = [
    { zone: 'warmup', speed: 7, sec: 300, incline: 0 },
    { zone: 'fast', speed: 12.2, sec: 240, incline: 0 },
    { zone: 'jog', speed: 9, sec: 180, incline: 0 },
    { zone: 'fast', speed: 12.2, sec: 240, incline: 0 },
    { zone: 'jog', speed: 9, sec: 180, incline: 0 },
    { zone: 'fast', speed: 12.2, sec: 240, incline: 0 },
  ];
  const cn = calibrateClass(M, 40, segs, (s) => hrTargetForZone(s.zone, P));
  const ch = calibrateClass(M, 40, segs, (s) => hrTargetForZone(s.zone, PH));
  const fastAvg = (r) => r.segments.filter((s) => s.zone === 'fast').reduce((a, s) => a + s.speed, 0) / 3;
  ok(fastAvg(ch) >= fastAvg(cn) + 0.1, `las series salen más rápidas en exigente (${fastAvg(ch).toFixed(2)} frente a ${fastAvg(cn).toFixed(2)})`);
  ok(ch.segments.filter((s) => s.zone === 'jog').every((s, i) => s.speed <= cn.segments.filter((x) => x.zone === 'jog')[i].speed + 1e-9), 'y los trotes no se suben');
});

section('«En tu zona» se mide con los mismos techos', () => {
  const segs = [{ zone: 'warmup', speed: 7, sec: 120 }, { zone: 'fast', speed: 12, sec: 600 }];
  const series = [];
  for (let t = 0; t < 720; t += 5) series.push([t, t < 120 ? 110 : 172]);
  const n = zoneCompliance(segs, series, P);
  const h = zoneCompliance(segs, series, PH);
  ok(n && h && h.pct > n.pct + 30, `172 ppm en un rápido: «por encima» en normal (${n?.pct} %), en zona en exigente (${h?.pct} %)`);
});

const LV = { ...DEFAULT_LEVELS };
const st0 = (profile) => ({ ...deepClone(defaultState()), levels: { ...LV }, profile: { ...deepClone(defaultState()).profile, ...profile } });
let n = 0;
const ses = (o = {}) => ({
  id: `g${++n}`, dayKey: '2026-10-10', completed: true, completionPct: 1,
  timeInZone: { warmup: 180, walk: 0, jog: 400, run: 0, fast: 360, sprint: 0, cooldown: 120 },
  adjustments: {}, levelsAtStart: { ...LV }, isTest: false, test: null, ...o,
});
const days = ['2026-10-10', '2026-10-12', '2026-10-14', '2026-10-16', '2026-10-18', '2026-10-20', '2026-10-22', '2026-10-24'];
function runHard(profile, o = () => ({})) {
  let st = st0(profile);
  const log = [];
  days.forEach((d, i) => {
    const r = applyFeedback(st, ses({ dayKey: d, levelsAtStart: { ...st.levels }, ...o(i) }), { feeling: 'hard' });
    st = { ...st, levels: r.levels, progression: r.progression };
    log.push(r.levels.fast);
  });
  return { st, log };
}

section('Niveles: con «Exigente» también se progresa, con pruebas', () => {
  const normal = runHard(P);
  ok(normal.st.levels.fast === LV.fast && normal.st.levels.jog === LV.jog, 'modo normal: 8 clases «exigentes» no suben nada (como siempre)');
  const hard = runHard(PH);
  ok(hard.log[2] === LV.fast && Math.abs(hard.log[3] - (LV.fast + 0.1)) < 1e-9, `modo exigente: a la 4.ª clase exigente seguida, +0,1 (${hard.log.join(' ')})`);
  ok(Math.abs(hard.st.levels.fast - (LV.fast + 0.2)) < 1e-9 && Math.abs(hard.st.levels.jog - (LV.jog + 0.2)) < 1e-9, `en 8 clases, +0,2 en los niveles usados (${hard.st.levels.fast})`);
  ok(hard.st.levels.sprint === LV.sprint, 'un nivel que no se usó no sube');
  // si el modo pulso tuvo que bajarte ese nivel, esa clase rompe la racha
  const braked = runHard(PH, (i) => (i === 2 ? { hrCoachAdj: { fast: -0.3 }, adjustments: { fast: -0.3 } } : {}));
  ok(braked.log[3] === LV.fast && Math.abs(braked.log[6] - (LV.fast + 0.1)) < 1e-9, `una clase frenada por pulso reinicia la cuenta de ese nivel (${braked.log.join(' ')})`);
  // una clase a medias no cuenta
  const partial = runHard(PH, (i) => (i === 1 ? { completed: false, completionPct: 0.6, finishedEarly: true } : {}));
  ok(partial.log[3] <= LV.fast, `una clase a medias no suma a la racha (${partial.log.join(' ')})`);
  // «al límite» nunca sube
  let st = st0(PH);
  for (const d of days) { const r = applyFeedback(st, ses({ dayKey: d }), { feeling: 'max' }); st = { ...st, levels: r.levels, progression: r.progression }; }
  ok(st.levels.fast <= LV.fast, '«al límite» no sube en ningún modo');
  // mensaje
  let s2 = st0(PH);
  let msg = '';
  days.slice(0, 4).forEach((d) => { const r = applyFeedback(s2, ses({ dayKey: d, levelsAtStart: { ...s2.levels } }), { feeling: 'hard' }); s2 = { ...s2, levels: r.levels, progression: r.progression }; msg = r.message; });
  ok(/exigentes seguidas/.test(msg), `el mensaje explica por qué sube: «${msg}»`);
});

process.stdout.write(`\n${passes} comprobaciones OK, ${failures} fallos\n`);
process.exit(failures ? 1 : 0);
