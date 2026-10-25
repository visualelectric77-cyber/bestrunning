// BestRunning · tests del plan musical DJ (js/audio/music-plan.js) con la biblioteca real.
// Uso: node tools/test-music.mjs [--verbose]   (sale con código ≠ 0 si algo falla)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES } from '../js/training/templates.js';
import { buildWorkout } from '../js/training/generator.js';
import {
  buildMusicPlan, targetBpmFor, segmentTargets, trackGrid, snapToBar, nextBarTime, nextBarPos, beatPhaseAt, barPhaseAt,
  barIndexAt, barPos, onBarGrid, rateFor, rateForZone, isCandidate, cuePosition, cueRate, cueTimeAt, cueIndexAt,
  expectedAt, describePlan, ZONE_RANK, RATE_MIN, RATE_MAX, MIX_RATE_MIN, MIX_RATE_MAX, MATCH_TOL, BEATMIX_MAX_DELTA,
  recentTracksFromHistory, RECENT_SESSIONS, preferred,
} from '../js/audio/music-plan.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');
const BUDGET_MB = Number(process.env.BR_BUDGET_MB) || 0;   // solo para experimentar con el presupuesto de memoria
const LIB = JSON.parse(readFileSync(join(ROOT, 'audio/music/library.json'), 'utf8'));
const TRACKS = LIB.tracks;
const BY_ID = new Map(TRACKS.map((t) => [t.id, t]));

let checks = 0;
const failures = [];
const TRACE = (process.argv.find((x) => x.startsWith('--trace=')) || '').slice(8);   // --trace=texto: muestra esas comprobaciones
function ok(cond, msg) {
  checks++;
  if (!cond) failures.push(msg);
  if (TRACE && String(msg).includes(TRACE)) process.stdout.write(`    ${cond ? '·' : '✗'} ${msg}\n`);
  return !!cond;
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const report = [];
const line = (s = '') => report.push(s);
function section(name, fn) {
  const before = failures.length;
  try { fn(); } catch (err) { failures.push(`${name}: excepción ${err?.stack || err}`); }
  line(`${failures.length === before ? '✓' : '✗'} ${name}`);
}

/* ═════════════ 1. Matemática de compases ═════════════ */

section('Rejilla de compases y fase', () => {
  const t = { id: 'x', bpm: 120, duration: 200, barOffset: 0.5, beatOffset: 0.5, bars: 99, energy: [], cues: {} };
  const g = trackGrid(t);
  ok(near(g.barSec, 2) && near(g.spb, 0.5), 'barSec/spb a 120 BPM');
  ok(near(barIndexAt(t, 4.5), 2), 'barIndexAt');
  ok(near(barPos(t, 3), 6.5) && near(barPos(t, -1), -1.5), 'barPos');
  ok(near(snapToBar(t, 6.9), 6.5) && near(snapToBar(t, 6.9, 'next'), 8.5) && near(snapToBar(t, 8.4, 'prev'), 6.5), 'snapToBar nearest/next/prev');
  ok(near(snapToBar(t, 0), 0.5), 'snapToBar nunca negativo');
  ok(near(snapToBar(t, 6.5, 'next'), 6.5) && near(snapToBar(t, 6.5, 'prev'), 6.5), 'snapToBar sobre la línea');
  ok(near(nextBarTime(t, 1, 1.0), 1.5), 'nextBarTime a rate 1');
  ok(near(nextBarTime(t, 2, 1.0), 0.75), 'nextBarTime a rate 2');
  ok(near(nextBarTime(t, 1, 2.5), 0), 'nextBarTime encima de la línea');
  ok(near(nextBarTime(t, 0.94, 2.4), 0.1 / 0.94), 'nextBarTime con estiramiento');
  ok(near(nextBarPos(t, 2.51), 4.5), 'nextBarPos');
  ok(near(beatPhaseAt(t, 0.75), 0.5) && near(beatPhaseAt(t, 0.5), 0) && near(beatPhaseAt(t, 0.25), 0.5), 'beatPhaseAt (también antes del primer downbeat)');
  ok(near(barPhaseAt(t, 1.5), 0.5), 'barPhaseAt');
  ok(onBarGrid(t, 10.5) && !onBarGrid(t, 10.6), 'onBarGrid');
  // barOffset mayor que un compás (105 BPM, 2,24 s): primer downbeat ≥ 0 bien calculado
  const s = BY_ID.get('stylish-deep-electronic-nveravetyanmusic');
  const gs = trackGrid(s);
  ok(near(gs.firstBar, 2.24 % (240 / 105), 1e-9) && gs.firstBar >= 0, 'firstBar con barOffset > compás');
  ok(near(snapToBar(s, 0), gs.firstBar - gs.barSec >= 0 ? gs.firstBar - gs.barSec : gs.firstBar), 'snap al primer downbeat válido');
  // the-portal: analyze.py ya rehace la rejilla al doblar el tempo ⇒ compases de 4 tiempos
  const p = BY_ID.get('the-portal-rizzlas');
  ok(near(trackGrid(p).ebSec, 4 * 60 / 190, 1e-9), 'the-portal: energía en compases de 4 tiempos (rejilla rehecha)');
  // Compatibilidad: una pista con rejilla antigua de 8 tiempos se sigue detectando
  const legacy = { ...p, bars: Math.round(p.bars / 2) };
  ok(near(trackGrid(legacy).ebSec, 8 * 60 / 190, 1e-9), 'rejilla antigua de 8 tiempos detectada');
  ok(near(trackGrid(BY_ID.get('drum-bass-watermello')).ebSec, 4 * 60 / 174, 1e-9), 'watermello: energía en compases de 4 tiempos');
  // Todos los cues de la biblioteca caen en la rejilla de 4 tiempos
  let offGrid = 0;
  for (const tr of TRACKS) {
    const gg = trackGrid(tr);
    for (const d of gg.drops) if (!onBarGrid(tr, d, 0.003)) offGrid++;
    if (!onBarGrid(tr, gg.outro, 0.003)) offGrid++;
    if (!onBarGrid(tr, gg.mixIn, 0.003)) offGrid++;
    for (const h of gg.hotTimes) if (!onBarGrid(tr, h, 0.003)) offGrid++;
  }
  ok(offGrid === 0, `drops/outro/mixIn/hotBars en la rejilla (${offGrid} fuera)`);
});

section('Tempo: rate, candidatas y BPM objetivo', () => {
  const t124 = BY_ID.get('deep-house-paulyudin');
  ok(near(rateFor(t124, 128), 128 / 124), 'rate dentro del margen');
  ok(near(rateFor(t124, 172), RATE_MAX) && near(rateFor(t124, 100), RATE_MIN), 'rate recortado a [0,94, 1,06]');
  ok(isCandidate(t124, 128) && isCandidate(t124, 124) && !isCandidate(t124, 140), 'candidata ±2 % tras estirar');
  const syn = BY_ID.get('synthwave-retro-80s-arpmedia');
  ok(isCandidate(syn, 120) && !isCandidate(syn, 124), '112,25 vale para 120 (119 a −0,8 %) y no para 124');
  ok(!isCandidate(BY_ID.get('midnight-synthwave-the-mountain'), 110), '90 BPM no llega a 110');
  const psy = BY_ID.get('bhairav-psytrance-buzzpsy');
  ok(isCandidate(psy, 172, 'sprint') && !isCandidate(psy, 172, 'fast'), 'sprint acepta BPM nativo 148–190');
  ok(rateForZone(psy, 172, 'sprint') === 1, 'sprint nativo ⇒ rate 1');
  ok(near(rateForZone(BY_ID.get('drum-bass-watermello'), 172, 'sprint'), 172 / 174), 'DnB a 172 exactos');
  ok(targetBpmFor('warmup', { step: 0, steps: 2 }) === 110 && targetBpmFor('warmup', { step: 1, steps: 2 }) === 120, 'calentamiento 110 → 120');
  ok(targetBpmFor('cooldown', { step: 0, steps: 3 }) === 112 && targetBpmFor('cooldown', { step: 1, steps: 3 }) === 106
    && targetBpmFor('cooldown', { step: 2, steps: 3 }) === 100, 'vuelta a la calma 112 → 100');
  ok(targetBpmFor('jog') === 124, 'trote 124');
  const run = [targetBpmFor('run', { speed: 10.1, minSpeed: 10.1, maxSpeed: 10.1 }), targetBpmFor('run', { speed: 10.8, minSpeed: 9.3, maxSpeed: 10.8 })];
  ok(run[0] === 128 && run[1] === 130, 'correr 128–130 según velocidad');
  ok(targetBpmFor('fast') === 136 && targetBpmFor('fast', { speed: 12, minSpeed: 11, maxSpeed: 12 }) === 140, 'rápido 136–140');
  ok(targetBpmFor('sprint') === 172 && targetBpmFor('sprint', { energy: 'max' }) === 174, 'sprint 172 (174 con energía máx.)');
  ok(targetBpmFor('run', { energy: 'max' }) > targetBpmFor('run'), 'energía máx. ⇒ más BPM');
  const segs = [{ zone: 'warmup', speed: 7 }, { zone: 'warmup', speed: 7.6 }, { zone: 'jog', speed: 8.3 }, { zone: 'cooldown', speed: 7 }, { zone: 'cooldown', speed: 6 }];
  const tg = segmentTargets(segs);
  ok(tg[0] === 110 && tg[1] === 120 && tg[2] === 124 && tg[3] === 112 && tg[4] === 100, `segmentTargets ${tg.join(',')}`);
});

section('Modelo de posición de un cue', () => {
  const cue = { atSec: 100, entryAt: 92, entryPos: 40, mixRate: 0.96, rate: 1.02, tailSec: 8, rampSec: 16, offsetSec: 40 + 8 * 0.96 };
  ok(near(cuePosition(cue, 100), cue.offsetSec), 'offsetSec = posición en atSec');
  ok(near(cuePosition(cue, 92), 40) && near(cuePosition(cue, 90), 40 - 2 * 0.96), 'entrada y pre-roll');
  const pEnd = cuePosition(cue, 124);
  ok(near(pEnd, 40 + 16 * 0.96 + 16 * (0.96 + 1.02) / 2, 1e-9), 'rampa lineal integrada');
  ok(near(cuePosition(cue, 130) - pEnd, 6 * 1.02, 1e-9), 'tras la rampa, rate final');
  ok(near(cueRate(cue, 95), 0.96) && near(cueRate(cue, 116), 0.99) && near(cueRate(cue, 200), 1.02), 'cueRate');
  ok(near(cueTimeAt(cue, cuePosition(cue, 117.3)), 117.3, 1e-6), 'cueTimeAt inverso');
});

/* ═════════════ 2. Planes de todas las clases ═════════════ */

const LEVELS = { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 };
const TREADMILL = { hasIncline: true, maxIncline: 12, minSpeed: 1, maxSpeed: 18, announceLead: 10 };
const SEEDS = [1, 7, 42, 2026];
const MINUTES = [20, 30, 45, 60];

const stats = {
  workouts: 0, cues: 0, track: 0, changes: { track: 0, tempo: 0, none: 0 }, intra: 0, resume: 0, dropAligned: 0, phraseIntra: 0,
  transitions: {}, tracksPerSession: [], fallbackBpm: 0, reuse: 0, maxSec: 0, outroSoft: 0,
};
const firstFail = new Map();
function fail(key, msg) {
  if (!firstFail.has(key)) firstFail.set(key, msg);
  return false;
}

const candidateUnused = (used, target, zone) => TRACKS.some((t) => !used.has(t.id) && isCandidate(t, target, zone));

function checkPlan(w, plan, label) {
  const segs = w.segments;
  const starts = [];
  let acc = 0;
  for (const s of segs) { starts.push(acc); acc += s.sec; }
  const cues = plan.cues;
  let good = true;
  const must = (cond, key, msg) => { if (!cond) good = fail(key, `${label}: ${msg}`); };

  must(cues.length >= segs.length, 'count', `menos cues (${cues.length}) que segmentos (${segs.length})`);
  must(near(plan.totalSec, w.totalSec), 'total', 'totalSec del plan');
  // Cobertura: un cue de tramo por segmento, en su inicio exacto
  for (let i = 0; i < segs.length; i++) {
    const own = cues.filter((c) => c.kind === 'segment' && c.segIndex === i);
    must(own.length === 1, 'cover', `segmento ${i} con ${own.length} cues de tramo`);
    if (own[0]) must(near(own[0].atSec, starts[i], 1e-3), 'start', `cue del segmento ${i} en ${own[0].atSec} ≠ ${starts[i]}`);
  }
  for (let k = 1; k < cues.length; k++) must(cues[k].atSec >= cues[k - 1].atSec - 1e-6, 'order', 'cues desordenados');
  must(cues[0]?.transition === 'start' && cues[0]?.atSec === 0, 'first', 'el primer cue debe ser start en 0');

  const used = new Set();
  const memory = {};
  let active = null;
  let prevEnd = -Infinity;
  for (let k = 0; k < cues.length; k++) {
    const c = cues[k];
    const t = BY_ID.get(c.trackId);
    must(!!t, 'track', `pista desconocida ${c.trackId}`);
    if (!t) continue;
    const g = trackGrid(t);
    stats.cues++;
    stats.changes[c.change]++;
    stats.transitions[c.transition] = (stats.transitions[c.transition] || 0) + 1;
    if (c.kind === 'intra') {
      stats.intra++;
      const s0 = starts[c.segIndex];
      must(c.atSec > s0 && c.atSec < s0 + segs[c.segIndex].sec, 'intraIn', `cue intra fuera de su tramo (${c.atSec})`);
    }
    // Rates
    must(c.rate >= RATE_MIN - 1e-9 && c.rate <= RATE_MAX + 1e-9, 'rate', `rate ${c.rate} fuera de [0,94, 1,06]`);
    must(c.mixRate >= MIX_RATE_MIN - 1e-9 && c.mixRate <= MIX_RATE_MAX + 1e-9, 'mixRate', `mixRate ${c.mixRate}`);
    must(near(c.bpm, g.bpm * c.rate, 0.01), 'bpm', 'bpm efectivo = bpm × rate');
    must(near(cuePosition(c, c.atSec), c.offsetSec, 2e-3), 'model', `offsetSec incoherente con el modelo (${label} #${k})`);
    // BPM: ±2 % del objetivo, o sprint nativo, o no había candidata
    const err = Math.abs(c.bpm / c.targetBpm - 1);
    const native = c.zone === 'sprint' && c.rate === 1 && g.bpm >= 148 && g.bpm <= 190;
    if (err > MATCH_TOL + 1e-6 && !native) {
      stats.fallbackBpm++;
      if (c.change === 'track') must(!TRACKS.some((x) => isCandidate(x, c.targetBpm, c.zone) && !used.has(x.id)), 'bpmFit', `${c.trackId} a ${c.bpm.toFixed(1)} para ${c.targetBpm} habiendo candidatas libres`);
    }
    must(c.entryAt <= c.atSec + 1e-6 && c.leadSec >= 0 && c.tailSec >= 0, 'times', 'tiempos de transición negativos');
    if (c.kind === 'segment') {
      const segEnd = starts[c.segIndex] + segs[c.segIndex].sec;
      must(c.atSec + c.tailSec <= segEnd + 1e-3, 'tail', `cola de la mezcla más allá del tramo (${label} #${k})`);
    }

    if (c.change !== 'track') {
      must(active && c.trackId === active.trackId, 'continue', 'continuación con otra pista');
      if (active) must(near(c.offsetSec, cuePosition(active, c.atSec), 2e-3), 'contPos', 'continuación sin continuidad de posición');
      active = c;
      continue;
    }

    // Cambio de pista
    stats.track++;
    if (active) {
      const outT = BY_ID.get(active.trackId);
      const outG = trackGrid(outT);
      must(c.trackId !== active.trackId, 'self', 'mezcla de una pista consigo misma');
      // Transiciones no solapadas y saliente sin quedarse sin música
      must(c.atSec - c.leadSec >= prevEnd - 1e-3 && c.entryAt >= prevEnd - 1e-3, 'overlap', `transiciones solapadas (${label} #${k})`);
      const endT = c.transition === 'beatmix' ? c.atSec + c.tailSec : c.atSec;
      const outPos = cuePosition(active, endT);
      must(outPos <= outG.duration - 0.25, 'silence', `${active.trackId} se acaba antes de la mezcla (${outPos.toFixed(1)} > ${outG.duration})`);
      if (active.zone !== 'cooldown' && outPos > outG.outro + 8 * outG.barSec + 0.01) stats.outroSoft++;
      // Tipo de transición coherente con BPM/intensidad
      const outEff = outG.bpm * cueRate(active, c.entryAt);
      const rise = ZONE_RANK[c.zone] - ZONE_RANK[active.zone];
      if (c.transition === 'beatmix') {
        must(Math.abs(c.bpm / outEff - 1) <= BEATMIX_MAX_DELTA + 0.01, 'bmDelta', `beatmix con ΔBPM ${(100 * (c.bpm / outEff - 1)).toFixed(1)} %`);
        must(Math.abs((c.mixRate * g.bpm) / outEff - 1) <= 0.012, 'bmTempo', `beatmix sin tempo igualado (${(c.mixRate * g.bpm).toFixed(1)} vs ${outEff.toFixed(1)})`);
        must(onBarGrid(t, c.entryPos, 0.003), 'bmGrid', 'beatmix: la entrante no entra en compás');
        must(c.mixBars >= 2, 'bmBars', 'beatmix demasiado corto');
      }
      if (c.transition === 'riser-drop') must(rise > 0, 'riser', 'riser-drop sin subida de intensidad');
      if (c.transition === 'echo-out') must(rise < 0, 'echo', 'echo-out sin bajada de intensidad');
      // Memoria de discos
      if (active.zone !== c.zone) {
        const mem = memory[c.zone];
        if (mem && mem.trackId !== active.trackId) {
          const mt = BY_ID.get(mem.trackId);
          const mg = trackGrid(mt);
          const need = Math.min(90, Math.max(30, segs[c.segIndex].sec));
          // La posición del plan va redondeada (cues a 4 decimales): si quedó justo entre dos compases, el compás más
          // cercano puede ser uno u otro. Solo se exige (o se prohíbe) retomar cuando las dos lecturas coinciden.
          const fitsAt = (p) => (mg.outro - Math.max(mg.firstBar, snapToBar(mt, p))) / rateForZone(mt, c.targetBpm, c.zone) >= need - 1e-6;
          const cand = isCandidate(mt, c.targetBpm, c.zone);
          const fitsA = cand && fitsAt(mem.pos - 0.01);
          const fitsB = cand && fitsAt(mem.pos + 0.01);
          if (fitsA && fitsB) must(c.entry === 'resume' && c.trackId === mem.trackId, 'mustResume', `no retoma ${mem.trackId} en ${c.zone} (${label} #${k})`);
          else if (!fitsA && !fitsB) must(c.entry !== 'resume', 'noResume', 'retoma una pista agotada');
        }
        memory[active.zone] = { trackId: active.trackId, pos: cuePosition(active, endT) };
        delete memory[c.zone];
      }
    }
    if (c.entry === 'resume') {
      stats.resume++;
      const last = lastLeave.get(c.trackId);
      must(!!last, 'resumeSrc', 'retoma una pista que no había sonado');
      if (last) {
        must(last.zone === c.zone, 'resumeZone', 'retoma la pista de otra zona');
        must(Math.abs(c.entryPos - last.pos) <= g.barSec / 2 + 2e-3, 'resumePos', `retoma en ${c.entryPos.toFixed(2)} y se quedó en ${last.pos.toFixed(2)} (${label} #${k})`);
        must(onBarGrid(t, c.entryPos, 0.003), 'resumeGrid', 'retoma fuera de compás');
        // (rate y posición del cue van redondeados a 4 decimales: hasta ~2 ms de diferencia con el cálculo del plan)
        must((g.outro - c.entryPos) / c.rate >= 30 - 2e-3, 'resume30', 'retoma con < 30 s antes del outro');
      }
    } else if (used.has(c.trackId)) {
      stats.reuse++;
      must(!candidateUnused(used, c.targetBpm, c.zone), 'repeat', `repite ${c.trackId} habiendo alternativas (${label} #${k})`);
    }
    // Drops en tramos intensos: la primera vez que entra una pista, el drop cae en atSec
    if ((c.zone === 'fast' || c.zone === 'sprint') && c.entry !== 'resume') {
      if (g.alignPoints.length) {
        const pts = [...g.drops, ...g.hotTimes];
        const hit = pts.some((p) => Math.abs(p - c.offsetSec) <= 0.05);
        must(hit && (c.entry === 'drop' || c.entry === 'hot'), 'drop', `${c.trackId} no entra en drop/hotBar (offset ${c.offsetSec}) (${label} #${k})`);
        if (hit) stats.dropAligned++;
      }
    }
    if (['drop', 'hot', 'mixIn', 'phrase', 'resume'].includes(c.entry)) must(onBarGrid(t, c.entryPos, 0.003), 'entryGrid', `entrada fuera de compás (${c.entry})`);
    if (c.kind === 'intra' && active) {
      const outT = BY_ID.get(active.trackId);
      const og = trackGrid(outT);
      const p = cuePosition(active, c.atSec + c.tailSec);
      if (p <= og.outro + 0.01) stats.phraseIntra++;
    }
    if (active) lastLeave.set(active.trackId, { zone: active.zone, pos: cuePosition(active, c.transition === 'beatmix' ? c.atSec + c.tailSec : c.atSec) });
    used.add(c.trackId);
    prevEnd = c.atSec + c.tailSec;
    active = c;
  }
  // Fin de la clase: la última pista no se acaba
  if (active) {
    const g = trackGrid(BY_ID.get(active.trackId));
    must(cuePosition(active, plan.totalSec) <= g.duration + 0.5, 'endSilence', `la última pista se acaba antes del final (${label})`);
  }
  // cueIndexAt / expectedAt coherentes
  const mid = plan.totalSec / 2;
  const ex = expectedAt(plan, mid);
  must(ex && ex.index === cueIndexAt(plan, mid) && cues[ex.index].atSec <= mid, 'expected', 'expectedAt');
  stats.tracksPerSession.push(plan.trackIds.length);
  return good;
}
const lastLeave = new Map();

section('Planes de todas las plantillas (20/30/45/60′ × 4 semillas)', () => {
  let different = 0;
  let pairs = 0;
  for (const tpl of TEMPLATES) {
    for (const minutes of MINUTES) {
      for (const seed of SEEDS) {
        const w = buildWorkout(tpl.id, { minutes, levels: LEVELS, seed, hasIncline: !!tpl.requiresIncline, treadmill: TREADMILL });
        if (!w) { ok(false, `no se construye ${tpl.id} ${minutes}`); continue; }
        stats.workouts++;
        stats.maxSec = Math.max(stats.maxSec, w.totalSec);
        for (const energy of seed === 7 ? ['normal', 'max'] : ['normal']) {
          lastLeave.clear();
          const plan = buildMusicPlan(w, TRACKS, { seed, announceLead: 10, prefs: { energy } });
          ok(checkPlan(w, plan, `${tpl.id}·${minutes}′·s${seed}·${energy}`), `${tpl.id} ${minutes}′ s${seed} ${energy}`);
          if (energy === 'normal') {
            const again = buildMusicPlan(w, TRACKS, { seed, announceLead: 10, prefs: { energy } });
            ok(JSON.stringify(again) === JSON.stringify(plan), `determinista ${tpl.id} ${minutes} s${seed}`);
          }
        }
        if (seed === 1) {
          const a = buildMusicPlan(w, TRACKS, { seed: 1 });
          const b = buildMusicPlan(w, TRACKS, { seed: 99 });
          pairs++;
          if (JSON.stringify(a.cues.map((c) => c.trackId)) !== JSON.stringify(b.cues.map((c) => c.trackId))) different++;
        }
      }
    }
  }
  ok(different / Math.max(1, pairs) >= 0.6, `otra semilla ⇒ otra mezcla (${different}/${pairs})`);
  ok(stats.resume > 50, `memoria de discos en series (${stats.resume} retomas)`);
  ok(stats.intra > 50, `mezclas intra-zona en tramos largos (${stats.intra})`);
  ok(stats.dropAligned > 100, `drops alineados (${stats.dropAligned})`);
  ok(stats.phraseIntra / Math.max(1, stats.intra) >= 0.9, `mezclas intra antes del outro (${stats.phraseIntra}/${stats.intra})`);
  ok(stats.outroSoft / Math.max(1, stats.track) <= 0.02, `salidas tardías en outro (${stats.outroSoft}/${stats.track})`);
});

section('Energía máxima: más drops y más BPM', () => {
  const w = buildWorkout('pyramid', { minutes: 30, levels: LEVELS, seed: 3 });
  const n = buildMusicPlan(w, TRACKS, { seed: 3 });
  const m = buildMusicPlan(w, TRACKS, { seed: 3, prefs: { energy: 'max' } });
  const avg = (p, z) => { const c = p.cues.filter((x) => x.zone === z); return c.reduce((a, x) => a + x.targetBpm, 0) / Math.max(1, c.length); };
  ok(avg(m, 'jog') > avg(n, 'jog') && avg(m, 'fast') > avg(n, 'fast'), 'objetivos más altos');
  const risers = (p) => p.cues.filter((c) => c.transition === 'riser-drop').length;
  ok(risers(m) >= risers(n), 'al menos los mismos riser-drop');
});

section('Robustez y casos límite', () => {
  const w = buildWorkout('minute-on', { minutes: 20, levels: LEVELS, seed: 5 });
  ok(buildMusicPlan(w, []).cues.length === 0, 'sin pistas ⇒ plan vacío');
  ok(buildMusicPlan({ segments: [] }, TRACKS).cues.length === 0, 'sin segmentos ⇒ plan vacío');
  ok(buildMusicPlan(null, TRACKS).cues.length === 0, 'workout nulo');
  // Una sola pista: se repite, pero cubre todo sin romperse
  const one = buildMusicPlan(w, [TRACKS[5]]);
  ok(one.cues.filter((c) => c.kind === 'segment').length === w.segments.length, 'una sola pista: cubre todos los tramos');
  // Sin pistas de sprint ni rápidas: toma las más cercanas
  const slow = TRACKS.filter((t) => t.bpm < 130);
  const ws = buildWorkout('sprint-30-60', { minutes: 20, levels: LEVELS, seed: 2 });
  const ps = buildMusicPlan(ws, slow);
  ok(ps.cues.every((c) => c.rate >= RATE_MIN && c.rate <= RATE_MAX), 'sin sprint: rates en margen');
  ok(ps.cues.filter((c) => c.kind === 'segment').length === ws.segments.length, 'sin sprint: cobertura');
  // Pistas importadas con datos incompletos
  const user = { id: 'u_1', title: 'Mía', artist: 'Yo', bpm: 128, duration: 210, barOffset: 0.3, energy: [], cues: {}, gainDb: -2.5, tier: 'run' };
  const pu = buildMusicPlan(buildWorkout('cruise', { minutes: 30, levels: LEVELS, seed: 1 }), [...TRACKS, user, { id: 'u_bad', bpm: 0 }]);
  ok(!pu.trackIds.includes('u_bad'), 'descarta pistas sin BPM');
  ok(trackGrid(user).outro > 0 && trackGrid(user).mixIn >= 0, 'pista sin cues: outro y mixIn por defecto');
  // Workout muy corto
  const tiny = { segments: [{ zone: 'jog', speed: 8, sec: 30 }, { zone: 'sprint', speed: 13, sec: 30 }], totalSec: 60 };
  const pt = buildMusicPlan(tiny, TRACKS);
  ok(pt.cues.filter((c) => c.kind === 'segment').length === 2 && pt.cues[1].zone === 'sprint', 'clase de 1 minuto');
  ok(Array.isArray(describePlan(pt, BY_ID)), 'describePlan');
});

section('Variedad entre sesiones (pistas de las últimas sesiones)', () => {
  // Historial: sesiones con ids u objetos, una sin música, fechas desordenadas y más de RECENT_SESSIONS
  const day = (d) => `2026-10-${String(d).padStart(2, '0')}T07:00:00.000Z`;
  const hist = [
    { startedAt: day(3), music: { tracks: ['a', 'b'] } },
    { startedAt: day(9), music: { tracks: [{ id: 'f' }, 'g'] } },
    { startedAt: day(4), music: { tracks: ['c'] } },
    { startedAt: day(10), music: { tracks: [] } },
    { startedAt: day(5), music: null },
    { startedAt: day(6), music: { tracks: ['d', 'a'] } },
    { startedAt: day(7), music: { tracks: ['e'] } },
    { startedAt: day(8), music: { tracks: ['h', 'h'] } },
  ];
  const ages = recentTracksFromHistory(hist, 5);
  ok(RECENT_SESSIONS === 8, 'se recuerdan 8 sesiones');
  ok(ages.get('f') === 0 && ages.get('g') === 0 && ages.get('h') === 1 && ages.get('e') === 2 && ages.get('d') === 3 && ages.get('a') === 3 && ages.get('c') === 4,
    `antigüedad por fecha (${[...ages].map(([k, v]) => `${k}${v}`).join(' ')})`);
  ok(!ages.has('b'), 'con n = 5, la sexta sesión con música ya no cuenta');
  ok(recentTracksFromHistory([{ music: { tracks: ['x'] } }, { music: { tracks: ['y'] } }]).get('y') === 0, 'sin fecha: la última del historial es la más reciente');
  ok(recentTracksFromHistory(null).size === 0 && recentTracksFromHistory([{ music: 'nada' }]).size === 0, 'historial vacío o corrupto');

  // Biblioteca sintética: 4 pistas de trote iguales salvo el id; una clase de 2′ usa solo una
  const mk = (id, extra = {}) => ({
    id, title: id, artist: 'x', bpm: 124, duration: 240, beatOffset: 0.5, barOffset: 0.5, bars: 120,
    energy: new Array(120).fill(0.8), cues: { mixIn: 8.24, drops: [], outro: 220, hotBars: [] }, tier: 'jog', curatedTier: 'jog', ...extra,
  });
  const four = ['j1', 'j2', 'j3', 'j4'].map((id) => mk(id));
  const w1 = { id: 'v', segments: [{ zone: 'jog', speed: 8.3, sec: 120 }], totalSec: 120 };
  const pick = (opts) => buildMusicPlan(w1, four, { seed: 3, ...opts }).cues[0].trackId;
  const first = pick({});
  ok(pick({ recent: [] }) === first && pick({ recent: false }) === first, 'sin memoria: misma elección');
  const second = pick({ recent: [[first]] });
  ok(second !== first, `evita la de la última sesión (${first} → ${second})`);
  const rest = four.map((t) => t.id).filter((id) => id !== first);
  ok(pick({ recent: [[first], rest.slice(0, 2)] }) === rest[2], 'con una sola libre, elige esa');
  const all = [['j3'], ['j1'], ['j4'], ['j2']];
  ok(pick({ recent: all }) === 'j2', 'todas recientes: la que sonó hace más sesiones');
  ok(pick({ recent: new Map([['j1', 0], ['j2', 0], ['j3', 0], ['j4', 4]]) }) === 'j4', 'recent como Map id → antigüedad');
  ok(pick({ recent: { j1: 0, j2: 1, j3: 2, j4: 3 } }) === 'j4', 'recent como objeto id → antigüedad');
  // Lo que pone loadLibrary(): recentAge en cada pista; recent:false lo ignora
  const tagged = four.map((t) => ({ ...t, recentAge: t.id === first ? 0 : null }));
  ok(buildMusicPlan(w1, tagged, { seed: 3 }).cues[0].trackId !== first, 'recentAge de la pista (loadLibrary) se respeta');
  ok(buildMusicPlan(w1, tagged, { seed: 3, recent: false }).cues[0].trackId === first, 'recent: false desactiva la memoria');
  // Solo dentro del tramo preferido: una pista de otro tramo que encaja no desplaza a una reciente del tramo
  const other = mk('r1', { tier: 'run', curatedTier: 'run' });
  ok(pick({ recent: [rest, [first]] }) === first && buildMusicPlan(w1, [...four, other], { seed: 3, recent: [rest, [first]] }).cues[0].trackId === first,
    'todas las del tramo recientes ⇒ la más antigua del tramo antes que otra de otro tramo');

  // Biblioteca real: 8 sesiones seguidas por plantilla; cada una recuerda las 5 anteriores
  const TPLS = ['pyramid', 'minute-on', 'sprint-30-60', 'cruise', 'fartlek-swedish', 'progressive', 'long-progressive', 'speed-play'];
  let repeatsWith = 0;
  let repeatsWithout = 0;
  let lastWith = 0;
  let lastWithout = 0;
  let forced = 0;
  let picks = 0;
  for (const id of TPLS) {
    const tpl = TEMPLATES.find((t) => t.id === id);
    if (!tpl) { ok(false, `plantilla ${id}`); continue; }
    const minutes = (tpl.durations || [30]).includes(30) ? 30 : tpl.durations[0];
    const past = [];
    const pastBase = [];
    for (let k = 1; k <= 8; k++) {
      const w = buildWorkout(id, { minutes, levels: LEVELS, seed: 100 + k, hasIncline: !!tpl.requiresIncline, treadmill: TREADMILL });
      const recent = past.slice(-RECENT_SESSIONS).reverse();
      const plan = buildMusicPlan(w, TRACKS, { seed: 100 + k, recent });
      const base = buildMusicPlan(w, TRACKS, { seed: 100 + k });
      lastLeave.clear();
      ok(checkPlan(w, plan, `${id}·variedad·s${k}`), `${id} sesión ${k} con memoria: plan válido`);
      ok(JSON.stringify(buildMusicPlan(w, TRACKS, { seed: 100 + k, recent })) === JSON.stringify(plan), `${id} sesión ${k}: determinista con memoria`);
      const recentSet = new Set(recent.flat());
      const baseSet = new Set(pastBase.slice(-RECENT_SESSIONS).flat());
      repeatsWith += plan.trackIds.filter((t) => recentSet.has(t)).length;
      repeatsWithout += base.trackIds.filter((t) => baseSet.has(t)).length;
      // Repeticiones de la sesión inmediatamente anterior (lo que más se nota)
      const prevWith = new Set(past[past.length - 1] || []);
      const prevWithout = new Set(pastBase[pastBase.length - 1] || []);
      lastWith += plan.trackIds.filter((t) => prevWith.has(t)).length;
      lastWithout += base.trackIds.filter((t) => prevWithout.has(t)).length;
      // Cada pista nueva que repite de una sesión reciente: no había otra libre del tramo que encajara
      const usedBefore = new Set();
      for (const c of plan.cues) {
        if (c.change === 'track' && c.entry !== 'resume' && !usedBefore.has(c.trackId)) {
          picks++;
          if (recentSet.has(c.trackId)) {
            forced++;
            const alt = TRACKS.find((t) => !usedBefore.has(t.id) && !recentSet.has(t.id) && t.id !== c.trackId
              && preferred(t, c.zone) && isCandidate(t, c.targetBpm, c.zone));
            ok(!alt, `${id} s${k}: repite ${c.trackId} (${c.zone}) habiendo ${alt?.id} sin sonar en ${RECENT_SESSIONS} sesiones`);
          }
        }
        usedBefore.add(c.trackId);
      }
      past.push(plan.trackIds);
      pastBase.push(base.trackIds);
    }
  }
  line(`  variedad: pistas repetidas de la sesión anterior ${lastWith} con memoria · ${lastWithout} sin ella; de las 5 anteriores ${repeatsWith} · ${repeatsWithout}; ${forced}/${picks} elecciones sin alternativa libre en el tramo`);
  ok(lastWith < lastWithout * 0.5, `la memoria reduce las repeticiones de la sesión anterior (${lastWith} vs ${lastWithout})`);
  ok(repeatsWith <= repeatsWithout, `y no aumenta las de las 5 anteriores (${repeatsWith} vs ${repeatsWithout})`);
});

/* ═════════════ 3. Motor DJ con navegador simulado ═════════════
   AudioContext falso con evaluador de automatizaciones (AudioParam), AudioBufferSourceNode con start(cuándo, desde)
   y velocidad vigilada (no puede cambiar tras arrancar), decodificación asíncrona con latencia en un
   OfflineAudioContext a la frecuencia del contexto (48 kHz), ventanas recortadas, fetch simulado y
   reloj/temporizadores controlados. Sin <audio>. */

async function asection(name, fn) {
  const before = failures.length;
  try { await fn(); } catch (err) { failures.push(`${name}: excepción ${err?.stack || err}`); }
  line(`${failures.length === before ? '✓' : '✗'} ${name}`);
}

const idOfUrl = (url) => String(url).split('/').pop().replace(/\.m4a$/, '');

function makeSim({ decodeMs = (id) => 300 + (id.length % 7) * 60, broken = new Set() } = {}) {
  const clock = { ms: 0 };
  const timers = [];
  let seq = 0;
  const real = {
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    perf: Object.getOwnPropertyDescriptor(globalThis, 'performance'), document: globalThis.document,
    add: globalThis.addEventListener, remove: globalThis.removeEventListener, dispatch: globalThis.dispatchEvent,
    fetch: globalThis.fetch, OAC: globalThis.OfflineAudioContext,
  };
  const later = (fn, ms, every = 0) => { const id = ++seq; timers.push({ id, at: clock.ms + Math.max(0, ms || 0), fn, every }); return id; };
  const cancel = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
  globalThis.setTimeout = (fn, ms) => later(fn, ms);
  globalThis.clearTimeout = cancel;
  globalThis.setInterval = (fn, ms) => later(fn, ms, Math.max(1, ms || 1));
  globalThis.clearInterval = cancel;
  Object.defineProperty(globalThis, 'performance', { value: { now: () => clock.ms + 1000 }, configurable: true, writable: true });
  const bus = new EventTarget();
  globalThis.addEventListener = bus.addEventListener.bind(bus);
  globalThis.removeEventListener = bus.removeEventListener.bind(bus);
  globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
  const counters = { audioEls: 0, mediaSources: 0, rateChanges: 0, decodes: 0, fetches: 0, offlineCtx: 0, liveBuffers: 0, maxLiveBuffers: 0, trims: 0, rates: new Set() };
  globalThis.document = { createElement: () => { counters.audioEls++; return {}; }, addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
  globalThis.fetch = async (url) => {
    counters.fetches++;
    const id = idOfUrl(url);
    if (!BY_ID.has(id) || broken.has(id)) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(id).buffer };
  };

  class Param {
    constructor(ctx, v) { this.ctx = ctx; this.base = v; this.ev = []; }
    get value() { return this.at(this.ctx.currentTime); }
    set value(v) { this.base = v; this.ev = []; }
    add(e) {
      if (!Number.isFinite(e.t) || !Number.isFinite(e.v)) throw new TypeError('valor no finito');
      let i = this.ev.length;
      while (i > 0 && this.ev[i - 1].t > e.t) i--;
      this.ev.splice(i, 0, e);
      return this;
    }
    setValueAtTime(v, t) { return this.add({ k: 'set', v, t }); }
    linearRampToValueAtTime(v, t) { return this.add({ k: 'lin', v, t }); }
    exponentialRampToValueAtTime(v, t) { if (!(v > 0)) throw new RangeError('rampa exponencial a ≤ 0'); return this.add({ k: 'exp', v, t }); }
    setTargetAtTime(v, t, tc) { if (!(tc > 0)) throw new RangeError('constante de tiempo'); return this.add({ k: 'tgt', v, t, tc }); }
    cancelScheduledValues(t) { this.ev = this.ev.filter((e) => e.t < t); return this; }
    cancelAndHoldAtTime(t) { const v = this.at(t); this.cancelScheduledValues(t); return this.add({ k: 'set', v, t }); }
    at(t) {
      let v = this.base;
      let tp = 0;
      let tgt = null;
      const tv = (g, x) => g.v + (g.v0 - g.v) * Math.exp(-(x - g.t0) / g.tc);
      for (const e of this.ev) {
        if (e.t > t) {
          if (e.k === 'lin') return v + (e.v - v) * ((t - tp) / Math.max(1e-9, e.t - tp));
          if (e.k === 'exp') return v > 0 ? v * (e.v / v) ** ((t - tp) / Math.max(1e-9, e.t - tp)) : v;
          return tgt ? tv(tgt, t) : v;
        }
        if (e.k === 'tgt') { if (tgt) v = tv(tgt, e.t); tgt = { v: e.v, t0: e.t, tc: e.tc, v0: v }; } else { tgt = null; v = e.v; }
        tp = e.t;
      }
      return tgt ? tv(tgt, t) : v;
    }
  }
  // playbackRate: cualquier cambio después de start() es un fallo (en iOS daba tirones)
  class RateParam extends Param {
    constructor(ctx, node) { super(ctx, 1); this.node = node; }
    set value(v) { if (this.node.when != null) counters.rateChanges++; this.base = v; this.ev = []; }
    get value() { return this.base; }
    add(e) { counters.rateChanges++; return super.add(e); }
  }
  class Node {
    constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outs = new Set(); ctx.nodes.push(this); }
    connect(n) { this.outs.add(n); return n; }
    disconnect() { this.outs.clear(); }
  }
  class Src extends Node {
    constructor(ctx) {
      super(ctx, 'src');
      this.buffer = null; this.playbackRate = new RateParam(ctx, this); this.loop = false; this.loopStart = 0; this.loopEnd = 0;
      this.when = null; this.offset = 0; this.stopAt = Infinity; this.onended = null; this.rate = 1; this.endTimer = null;
      ctx.sources.push(this);
    }
    start(when = 0, offset = 0) {
      if (this.when != null) throw new Error('InvalidStateError: start dos veces');
      if (!(when >= 0) || !(offset >= 0)) throw new RangeError('start negativo');
      this.when = Math.max(when, this.ctx.currentTime);
      this.offset = offset;
      this.rate = this.playbackRate.base;
      if (this.buffer?.isFake && !this.loop) {
        // sin bucle, la fuente se acaba sola al llegar al final del buffer
        const endAt = this.when + (this.buffer.duration - offset) / this.rate;
        this.naturalEnd = endAt;
        this.endTimer = later(() => this.finish(endAt), (endAt - this.ctx.currentTime) * 1000);
      }
    }
    stop(when = 0) {
      if (this.when == null) throw new Error('InvalidStateError: stop sin start');
      if (this.stopAt < Infinity) throw new Error('InvalidStateError: stop dos veces');
      this.stopAt = Math.max(when, this.ctx.currentTime);
      if (this.endTimer) cancel(this.endTimer);
      later(() => this.finish(this.stopAt), (this.stopAt - this.ctx.currentTime) * 1000);
    }
    finish(t) { if (this.ended) return; this.ended = true; this.endedAt = t; this.onended?.(); }
    playing(t) { return this.when != null && t >= this.when && t < Math.min(this.stopAt, this.naturalEnd ?? Infinity); }
    /** Posición en s de PISTA (el buffer puede ser solo una ventana que empieza en buffer.w0). */
    pos(t) {
      let p = this.offset + (t - this.when) * this.rate;
      if (this.loop && p >= this.loopEnd) p = this.loopStart + ((p - this.loopStart) % (this.loopEnd - this.loopStart));
      return p + (this.buffer?.w0 || 0);
    }
    get startPos() { return this.offset + (this.buffer?.w0 || 0); }
  }
  // Datos de canal "etiquetados": la ventana recortada sabe de qué pista y desde qué muestra viene (sin PCM real)
  class Tagged extends Float32Array {
    subarray(a = 0) { const s = new Tagged(0); s.trackId = this.trackId; s.from = a; return s; }
  }
  const fakeBuffer = (id, sr = 32000) => {
    const d = BY_ID.get(id).duration;
    counters.liveBuffers++;
    counters.maxLiveBuffers = Math.max(counters.maxLiveBuffers, counters.liveBuffers);
    const tag = new Tagged(1);
    tag.trackId = id;
    return { isFake: true, id, w0: 0, duration: d, sampleRate: sr, numberOfChannels: 2, length: Math.round(d * sr), getChannelData: () => tag };
  };
  const windowBuffer = (ch, len, sr) => {
    counters.liveBuffers++;
    counters.trims++;
    counters.maxLiveBuffers = Math.max(counters.maxLiveBuffers, counters.liveBuffers);
    return {
      isFake: true, id: null, w0: 0, duration: len / sr, sampleRate: sr, numberOfChannels: ch, length: len,
      getChannelData: () => new Tagged(1),
      copyToChannel(arr, c, off = 0) { if (c === 0 && off === 0) { this.id = arr.trackId; this.w0 = arr.from / sr; } },
    };
  };
  const decode = (arr, sr) => new Promise((resolve, reject) => {
    counters.decodes++;
    const id = new TextDecoder().decode(new Uint8Array(arr));
    later(() => (BY_ID.has(id) ? resolve(fakeBuffer(id, sr)) : reject(new Error('EncodingError'))), decodeMs(id));
  });
  class Ctx {
    constructor() { this.state = 'running'; this.frozen = null; this.lost = 0; this.sampleRate = 48000; this.nodes = []; this.sources = []; this.destination = new Node(this, 'dest'); this.outputLatency = 0.012; }
    get currentTime() { return this.frozen ?? clock.ms / 1000 + 5 - this.lost; }
    resume() { if (this.state === 'interrupted') return Promise.reject(new Error('interrumpido')); this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    createGain() { const n = new Node(this, 'gain'); n.gain = new Param(this, 1); return n; }
    createBiquadFilter() { const n = new Node(this, 'biquad'); n.type = 'lowpass'; n.frequency = new Param(this, 350); n.Q = new Param(this, 1); n.gain = new Param(this, 0); return n; }
    createDelay() { const n = new Node(this, 'delay'); n.delayTime = new Param(this, 0); return n; }
    createDynamicsCompressor() { const n = new Node(this, 'comp'); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(this, 0); return n; }
    createAnalyser() { const n = new Node(this, 'analyser'); n.fftSize = 2048; return n; }
    createMediaElementSource() { counters.mediaSources++; return new Node(this, 'media'); }
    createBufferSource() { return new Src(this); }
    createOscillator() { const n = new Node(this, 'osc'); n.frequency = new Param(this, 440); n.start = () => {}; n.stop = () => later(() => n.onended?.(), 0); return n; }
    createBuffer(ch, len, sr) { return { length: len, sampleRate: sr, duration: len / sr, numberOfChannels: ch, getChannelData: () => new Float32Array(len) }; }
    decodeAudioData(arr) { return decode(arr, this.sampleRate); }
  }
  globalThis.OfflineAudioContext = class {
    constructor(ch, len, sr) { counters.offlineCtx++; counters.rates.add(sr); this.sampleRate = sr; this.length = len; }
    decodeAudioData(arr) { return decode(arr, this.sampleRate); }
    createBuffer(ch, len, sr) { return windowBuffer(ch, len, sr); }
  };
  const ctx = new Ctx();
  async function advance(sec, each = null) {
    const end = clock.ms + sec * 1000;
    while (clock.ms < end) {
      clock.ms += 10;
      for (let guard = 0; guard < 400; guard++) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = timers[0];
        if (!t || t.at > clock.ms) break;
        if (t.every) t.at += t.every; else timers.shift();
        try { t.fn(); } catch (err) { failures.push(`temporizador: ${err?.stack || err}`); }
        await null;
      }
      await new Promise((r) => setImmediate(r));
      if (each) each(clock.ms / 1000);
    }
  }
  function restore() {
    Object.assign(globalThis, { setTimeout: real.setTimeout, clearTimeout: real.clearTimeout, setInterval: real.setInterval, clearInterval: real.clearInterval });
    if (real.perf) Object.defineProperty(globalThis, 'performance', real.perf);
    globalThis.document = real.document;
    globalThis.addEventListener = real.add;
    globalThis.removeEventListener = real.remove;
    globalThis.dispatchEvent = real.dispatch;
    globalThis.fetch = real.fetch;
    if (real.OAC) globalThis.OfflineAudioContext = real.OAC; else delete globalThis.OfflineAudioContext;
  }
  // Cadena maestra (desde el destino hacia atrás): music ← fade ← duck ← trim ← limitador ← glue ← drive ← lp ← hp ← bus
  function master() {
    const into = (target, kind) => ctx.nodes.find((n) => n.kind === kind && n.outs.has(target));
    const music = into(ctx.destination, 'gain');
    const fade = music && into(music, 'gain');
    const duck = fade && into(fade, 'gain');
    const trim = duck && into(duck, 'gain');
    const limiter = trim && into(trim, 'comp');
    const glue = limiter && into(limiter, 'comp');
    const drive = glue && into(glue, 'gain');
    const lp = drive && into(drive, 'biquad');
    const hp = lp && into(lp, 'biquad');
    const busN = hp && into(hp, 'gain');
    return { limiter, glue, drive, trim, music, fade, duck, lp, hp, bus: busN };
  }
  /** Ganancia de una fuente hasta el bus (producto de las GainNode del camino seco). */
  function srcGain(src, t, m) {
    const walk = (n, depth) => {
      if (n === m.bus) return 1;
      if (depth > 12) return null;
      for (const o of n.outs) {
        const r = walk(o, depth + 1);
        if (r != null) return (n.kind === 'gain' ? n.gain.at(t) : 1) * r;
      }
      return null;
    };
    return walk(src, 0) ?? 0;
  }
  function voices(t) {
    const m = master();
    if (!m.bus) return [];
    return ctx.sources.filter((s) => s.buffer?.isFake && s.playing(t)).map((s) => ({ s, g: srcGain(s, t, m) }));
  }
  function audible(t) {
    const m = master();
    if (!m.fade) return 0;
    let a = 0;
    for (const v of voices(t)) a += v.g;
    return a * m.fade.gain.at(t);
  }
  // iOS: llamada/Siri ⇒ 'interrupted' y el reloj del contexto se para
  const interrupt = () => { ctx.frozen = ctx.currentTime; ctx.state = 'interrupted'; };
  const uninterrupt = () => { ctx.lost = clock.ms / 1000 + 5 - ctx.frozen; ctx.frozen = null; ctx.state = 'running'; };
  return { clock, ctx, counters, advance, restore, master, voices, audible, later, interrupt, uninterrupt };
}

const libTracks = TRACKS.map((t) => ({ ...t, url: `https://br.test/audio/music/${t.id}.m4a` }));
const LIB_BY_ID = new Map(libTracks.map((t) => [t.id, t]));
const simTotals = { beatmix: 0, drops: 0, resumes: 0, holds: 0 };

async function simulateSession(templateId, minutes, seed, simOpts = {}) {
  const sim = makeSim(simOpts);
  const out = {
    worstGap: 0, phase: [], drops: [], resumeErr: [], heardOk: 0, expected: 0, stoppedAtEnd: false, loaded: null, unlocked: null,
    late: 0, rates: [], counters: null, peak: 0, probes: null, resumeDrift: [], holds: [],
  };
  try {
    const { createMusicEngine } = await import('../js/audio/music.js');
    const w = buildWorkout(templateId, { minutes, levels: LEVELS, seed });
    const plan = buildMusicPlan(w, libTracks, { seed });
    const eng = createMusicEngine({ getAudioContext: () => sim.ctx, budgetBytes: BUDGET_MB ? BUDGET_MB * 2 ** 20 : undefined });
    out.unlocked = await Promise.race([eng.unlock(), new Promise((r) => sim.advance(1).then(() => r('t')))]);
    eng.load(plan, LIB_BY_ID).then((v) => { out.loaded = v; });
    await sim.advance(2);
    const t0 = sim.clock.ms / 1000;
    out.started = eng.start(0);
    let lastUpd = 0;
    let lowSince = null;
    const phaseErr = new Map();
    const heard = [];
    const trackCues = plan.cues.filter((c) => c.change === 'track');
    let nextReady = 1;
    let lastJob = 0;
    const jobs = new Map();          // índice de cue → instante (contexto) del cambio programado
    const kinds = {};
    let jobKind = null;
    const cutWin = trackCues.filter((c) => c.transition === 'riser-drop')
      .map((c) => [c.atSec - (60 / BY_ID.get(c.trackId).bpm) / soloRateOf(c) - 0.12, c.atSec + 0.05]);
    const lastHeard = new Map();
    const seenSrc = new Map();
    const probes = [];
    for (const c of trackCues) {
      if (c.transition === 'riser-drop' && c.leadSec >= 2) {
        probes.push({ at: c.atSec - c.leadSec * 0.25, kind: 'hp-up', c });
        probes.push({ at: c.atSec + 0.08, kind: 'hp-open', c });
      }
    }
    probes.sort((a, b) => a.at - b.at);
    out.probes = { total: probes.length, bad: [] };
    // Echo-out: la entrante suena filtrada (lowpass cerrado) justo después del corte y ya ≥ 0,8 en el corte
    const echoSeen = new Set();
    const fqOf = (v, i, at = sim.ctx.currentTime) => { const lp = [...[...v.s.outs][0].outs][0]; const lpN = i === 'hp' ? lp : [...lp.outs][0]; return lpN.frequency.at(at); };
    const rides = new Map();
    const effects0 = true;
    let nextProbe = 0;
    const firstAction = (c) => c.atSec - Math.max(c.leadSec, c.atSec - c.entryAt);
    await sim.advance(w.totalSec + 3, (now) => {
      const t = now - t0;
      const ct = sim.ctx.currentTime;
      if (t - lastUpd >= 0.25) { lastUpd = t; eng.update(t, { status: t <= w.totalSec ? 'running' : 'finished' }); }
      const vs = sim.voices(ct);
      // Filtros por voz: el highpass de la saliente sube en el riser y la entrante entra filtrada tras el eco
      while (nextProbe < probes.length && probes[nextProbe].at <= t) {
        const pr = probes[nextProbe++];
        const loud = vs.filter((v) => v.g > 0.05);
        const fq = (v, i) => { const lp = [...[...v.s.outs][0].outs][0]; const lpN = i === 'hp' ? lp : [...lp.outs][0]; return lpN.frequency.at(ct); };
        let good = false;
        if (pr.kind === 'hp-up') good = loud.some((v) => idOfSrc(v.s) !== pr.c.trackId && fq(v, 'hp') > 120);
        if (pr.kind === 'hp-open') good = loud.some((v) => idOfSrc(v.s) === pr.c.trackId && fq(v, 'hp') < 30);
        if (pr.kind === 'lp-closed') good = loud.some((v) => idOfSrc(v.s) === pr.c.trackId && fq(v, 'lp') < 12000);
        if (!good) out.probes.bad.push(`${pr.kind}@${pr.c.atSec}`);
      }
      // Silencios (fuera del arranque y del fundido final)
      const a = sim.audible(ct);
      if (t > 3.5 && t < w.totalSec - 9) {
        // el último tiempo antes de un drop va en corte a propósito (lo llena el riser, que aquí no se cuenta)
        const cut = cutWin.some(([x, y]) => t >= x && t <= y);
        if (a < 0.15 && !cut) { lowSince ??= t; if (t - lowSince > out.worstGap) { out.worstGap = t - lowSince; out.gapAt = lowSince; } } else lowSince = null;
      }
      const np = eng.nowPlaying();
      if (np && heard[heard.length - 1] !== np.trackId) heard.push(np.trackId);
      // Fase en beatmix: los dos platos audibles van a compás (downbeat con downbeat)
      const loud = vs.filter((v) => v.g > 0.3);
      if (loud.length === 2) {
        const cue = trackCues.find((c) => c.transition === 'beatmix' && t >= c.entryAt - 3 && t <= c.atSec + c.tailSec + 3);
        if (cue && jobKind === 'beatmix' && idOfSrc(loud[0].s) !== idOfSrc(loud[1].s)) {
          const [x, y] = loud;
          const gx = trackGrid(BY_ID.get(idOfSrc(x.s)));
          const gy = trackGrid(BY_ID.get(idOfSrc(y.s)));
          const bx = (x.s.pos(ct) - gx.barOffset) / gx.spb;
          const by = (y.s.pos(ct) - gy.barOffset) / gy.spb;
          const d4 = (((bx - by) % 4) + 4) % 4;
          phaseErr.set(cue, Math.max(phaseErr.get(cue) || 0, Math.min(d4, 4 - d4) * (gx.spb / x.s.rate)));
        }
      }
      // Prefetch: cada pista entrante decodificada antes de su primera acción (y con cuánta antelación)
      while (nextReady < trackCues.length && firstAction(trackCues[nextReady]) <= t) {
        const c = trackCues[nextReady++];
        const st = eng.status();
        if (!st.buffers.ids.includes(c.trackId) && !st.voices.some((v) => v.trackId === c.trackId)) out.late++;
      }
      // Memoria de discos: lo último que se oyó de cada pista (para comparar al retomarla)
      for (const v of vs) {
        if (v.g < 0.05) continue;
        const id = idOfSrc(v.s);
        if (!seenSrc.has(v.s)) seenSrc.set(v.s, lastHeard.get(id) || null);
        lastHeard.set(id, { t: ct, pos: v.s.pos(ct) });
      }
      if (t - lastJob >= 0.25) {
        lastJob = t;
        const j = eng.status().job;
        jobKind = j?.kind || null;
        // Riser y eco: su automatización se comprueba POR ADELANTADO (valores programados en el instante clave)
        if (j && j.idx >= 0 && (j.kind === 'echo-out' || j.kind === 'riser-drop') && !echoSeen.has(j.idx)) {
          echoSeen.add(j.idx);
          const st = eng.status();
          const oId = st.voices.find((v) => v.main)?.trackId;
          const inId = st.voices.find((v) => !v.main && v.startC >= j.first - 1e-6)?.trackId;
          const srcAt = (id, t) => sim.voices(t).find((v) => idOfSrc(v.s) === id);
          const noTrim = (v, t) => (v ? v.g / Math.max(1e-6, [...v.s.outs][0].gain.at(t)) : 0);
          const c = plan.cues[j.idx];
          if (j.kind === 'echo-out') {
            out.probes.total += 2;
            const inBar = trackGrid(BY_ID.get(inId)).barSec / soloRateOf(c);
            const vIn = srcAt(inId, j.swap + 1e-3);
            if (!(noTrim(vIn, j.swap + 1e-3) >= 0.8)) out.probes.bad.push(`eco: entrante ${noTrim(vIn, j.swap + 1e-3).toFixed(2)} en el corte @${c.atSec}`);
            const tq = j.swap + 0.25 * inBar;
            if (!(vIn && fqOf(vIn, 'lp', tq) < 12000 && fqOf(vIn, 'lp', j.swap + 1.05 * inBar) > 15000)) out.probes.bad.push(`eco: lowpass @${c.atSec}`);
          } else if (effects0) {
            out.probes.total += 3;
            const beatIn = trackGrid(BY_ID.get(inId)).spb / soloRateOf(c);
            const lead = Math.min(c.leadSec, j.swap - j.first);
            const tMid = j.swap - 0.5 * lead;
            const tCut = j.swap - 0.4 * beatIn;
            const gMid = noTrim(srcAt(oId, tMid), tMid);
            const gCut = noTrim(srcAt(oId, tCut), tCut);
            if (lead > 2 * beatIn && !(gMid > 0.95)) out.probes.bad.push(`riser: saliente a ${gMid.toFixed(2)} en el filtro @${c.atSec}`);
            if (!(gCut > 0.18 && gCut < 0.32)) out.probes.bad.push(`riser: saliente a ${gCut.toFixed(2)} en el corte @${c.atSec}`);
            const vO = srcAt(oId, j.swap - 0.01);
            if (!(vO && fqOf(vO, 'hp', j.swap - 0.01) <= 610)) out.probes.bad.push(`riser: highpass > 600 Hz @${c.atSec}`);
          }
        }
        // Beatmix hacia una intro floja: la saliente sigue a −3 dB (0,71) a mitad de la espera
        if (j?.kind === 'beatmix' && j.hold > 0 && !echoSeen.has(`h${j.idx}`)) {
          echoSeen.add(`h${j.idx}`);
          const st = eng.status();
          const oId = st.voices.find((v) => v.main)?.trackId;
          const goBar = trackGrid(BY_ID.get(oId)).barSec / (st.voices.find((v) => v.main)?.rate || 1);
          const tH = j.swap + (j.hold / 2) * goBar;
          const vO = sim.voices(tH).find((v) => idOfSrc(v.s) === oId);
          const gO = vO ? vO.g / Math.max(1e-6, [...vO.s.outs][0].gain.at(tH)) : 0;
          out.holds.push(gO);
        }
        if (j) for (const v of eng.status().voices) if (v.ride && !rides.has(v.c0)) rides.set(v.c0, v.ride);
        if (j && j.idx >= 0 && !jobs.has(j.idx)) { jobs.set(j.idx, j.swap); kinds[j.kind] = (kinds[j.kind] || 0) + 1; }
      }
    });
    out.phase = [...phaseErr.values()];
    // Drops y retomas, medidos en el instante real del cambio
    const ctxStart = t0 + 5;
    plan.cues.forEach((c, i) => {
      if (c.change !== 'track' || !jobs.has(i)) return;
      const swap = jobs.get(i);
      const src = sim.ctx.sources.filter((s) => idOfSrc(s) === c.trackId && s.when <= swap + 1e-6 && s.stopAt > swap)
        .sort((a, b) => b.when - a.when)[0];
      if (!src) return;
      const g = trackGrid(BY_ID.get(c.trackId));
      if (c.transition === 'riser-drop' && (c.entry === 'drop' || c.entry === 'hot')) {
        out.drops.push(Math.max(Math.abs(src.pos(swap) - c.offsetSec) / src.rate, Math.abs(swap - (ctxStart + c.atSec))));
      }
      if (c.entry === 'resume') {
        const f = (((src.pos(swap) - g.barOffset) / g.barSec) % 1 + 1) % 1;
        const prev = seenSrc.get(src);
        const drift = prev ? Math.abs(src.startPos - prev.pos) : 0;
        out.resumeErr.push(Math.min(f, 1 - f) * g.barSec / src.rate);
        out.resumeDrift.push(drift / g.barSec);
        if (drift / g.barSec > 1.01 && VERBOSE) line(`      retoma #${i} ${c.transition} ${c.trackId} desde ${src.startPos.toFixed(2)} (se oyó por última vez en ${prev?.pos.toFixed(2)})`);
      }
    });
    const expected = [];
    for (const c of trackCues) if (expected[expected.length - 1] !== c.trackId) expected.push(c.trackId);
    for (const id of heard) if (id === expected[out.heardOk]) out.heardOk++;
    out.expected = expected.length;
    out.stoppedAtEnd = !sim.ctx.sources.some((s) => s.buffer?.isFake && s.playing(sim.ctx.currentTime));
    out.rates = sim.ctx.sources.filter((s) => s.buffer?.isFake).map((s) => s.rate);
    out.rides = [...rides.values()];
    out.peak = eng.status().buffers.peak;
    out.peakBytes = eng.status().buffers.peakBytes;
    out.budget = eng.status().buffers.budget;
    const inf = Object.values(eng.status().buffers.info);
    out.decodes = inf.length;
    out.atCtxRate = inf.filter((x) => x.rate === sim.ctx.sampleRate).length;
    out.trimmed = inf.filter((x) => x.w1 - x.w0 < x.sec - 1).length;
    out.kinds = kinds;
    out.counters = { ...sim.counters };
    eng.destroy();
  } finally { sim.restore(); }
  return out;
}
const idOfSrc = (s) => s.buffer?.id;
const soloRateOf = (c) => Math.min(1.03, Math.max(0.97, c.rate));
const sim0Rate = 48000;

for (const [tpl, minutes, seed] of [['sprint-30-60', 20, 7], ['pyramid', 20, 7], ['progressive', 30, 4], ['aerobic-base', 45, 2], ['long-blocks', 45, 2]]) {
  await asection(`Motor DJ simulado: ${tpl} ${minutes}′ (mezclas, fase, drops, sin silencios)`, async () => {
    const r = await simulateSession(tpl, minutes, seed);
    ok(r.unlocked !== false, `${tpl}: unlock() reanuda el contexto`);
    ok(r.loaded === true && r.started === true, `${tpl}: load() + start(0)`);
    ok(r.worstGap < 0.25, `${tpl}: sin silencios (peor hueco ${r.worstGap.toFixed(2)} s)`);
    ok(r.phase.every((e) => e < 0.017), `${tpl}: beatmix a compás (peor ${(1000 * Math.max(0, ...r.phase)).toFixed(1)} ms)`);
    ok(r.drops.every((e) => e < 0.005), `${tpl}: drop justo en el inicio del tramo (peor ${(1000 * Math.max(0, ...r.drops)).toFixed(1)} ms)`);
    ok(r.resumeErr.every((e) => e < 0.005), `${tpl}: memoria de discos a compás (peor ${(1000 * Math.max(0, ...r.resumeErr)).toFixed(1)} ms)`);
    ok(r.resumeDrift.every((e) => e <= 1.01), `${tpl}: retoma donde se quedó (peor ${Math.max(0, ...r.resumeDrift).toFixed(2)} compases)`);
    ok(r.heardOk >= r.expected * 0.9, `${tpl}: suena la secuencia del plan (${r.heardOk}/${r.expected})`);
    ok(r.stoppedAtEnd, `${tpl}: al terminar la clase la música se para`);
    ok(!r.probes.bad.length, `${tpl}: riser y eco a tiempo (${r.probes.total - r.probes.bad.length}/${r.probes.total}) ${r.probes.bad.slice(0, 3).join(' ')}`);
    ok(r.counters.rateChanges === 0, `${tpl}: playbackRate fijo desde el arranque de cada fuente (${r.counters.rateChanges} cambios)`);
    ok(r.rates.every((x) => x >= 0.97 - 1e-9 && x <= 1.03 + 1e-9), `${tpl}: rates dentro de ±3 % (${Math.min(...r.rates).toFixed(3)}–${Math.max(...r.rates).toFixed(3)})`);
    ok(r.counters.audioEls === 0 && r.counters.mediaSources === 0, `${tpl}: sin <audio> ni MediaElementSource`);
    ok(r.holds.every((x) => x > 0.6 && x < 0.8), `${tpl}: intro floja ⇒ la saliente sigue a −3 dB (${r.holds.map((x) => x.toFixed(2)).join(', ')})`);
    simTotals.holds += r.holds.length;
    ok(r.rides.every((x) => x.db >= 1.5 && x.db <= 6.01 && x.to > x.from), `${tpl}: intros flojas subidas ≤ +6 dB y de vuelta a 0 dB (${r.rides.length})`);
    ok(r.counters.offlineCtx >= 1 && r.counters.offlineCtx === r.counters.rates.size, `${tpl}: un OfflineAudioContext por frecuencia de decodificación (${r.counters.offlineCtx})`);
    ok(r.peak <= 3, `${tpl}: como mucho 3 pistas decodificadas a la vez (${r.peak})`);
    ok(r.peakBytes <= r.budget, `${tpl}: memoria residente dentro del presupuesto (${(r.peakBytes / 2 ** 20).toFixed(0)} de ${(r.budget / 2 ** 20).toFixed(0)} MB)`);
    ok(r.atCtxRate >= r.decodes * 0.5, `${tpl}: la mayoría a la frecuencia del contexto (${r.atCtxRate}/${r.decodes})`);
    ok(r.late === 0, `${tpl}: cada entrante ya decodificada a tiempo (${r.late} tarde)`);
    simTotals.beatmix += r.phase.length;
    simTotals.drops += r.drops.length;
    simTotals.resumes += r.resumeErr.length;
    line(`    FX ${r.probes.total} · beatmix ${r.phase.length} (peor ${(1000 * Math.max(0, ...r.phase)).toFixed(1)} ms) · drops ${r.drops.length} · retomas ${r.resumeErr.length} · hueco máx. ${r.worstGap.toFixed(2)} s${r.worstGap > 0.05 ? ` en ${r.gapAt.toFixed(1)}` : ''} · ${Object.entries(r.kinds).map(([k, v]) => `${k} ${v}`).join(' ')} · pistas ${r.heardOk}/${r.expected} · decodificaciones ${r.counters.decodes} (recortadas ${r.trimmed}, a ${sim0Rate} Hz ${r.atCtxRate}/${r.decodes}) · máx. ${r.peak} en memoria, ${(r.peakBytes / 2 ** 20).toFixed(0)} MB · intros subidas ${r.rides.length} (hasta +${Math.max(0, ...r.rides.map((x) => x.db)).toFixed(1)} dB)`);
  });
}
ok(simTotals.holds >= 1, `beatmix hacia intros flojas con la saliente sostenida (${simTotals.holds})`);
ok(simTotals.beatmix >= 10 && simTotals.drops >= 5 && simTotals.resumes >= 5, `simulación con suficientes beatmix (${simTotals.beatmix}), drops (${simTotals.drops}) y retomas (${simTotals.resumes})`);

await asection('Motor DJ: voz, pausa, salto de tramo, apagar y parar', async () => {
  const sim = makeSim();
  try {
    const { createMusicEngine } = await import('../js/audio/music.js');
    const w = buildWorkout('pyramid', { minutes: 20, levels: LEVELS, seed: 3 });
    const plan = buildMusicPlan(w, libTracks, { seed: 3 });
    const eng = createMusicEngine({ getAudioContext: () => sim.ctx });
    eng.unlock();
    eng.load(plan, libTracks);
    await sim.advance(1.5);
    const t0 = sim.clock.ms / 1000;
    let running = true;
    let off = 0;
    eng.start(0);
    const tick = (now) => { if (running) eng.update(now - t0 - off, { status: 'running' }); };
    let acc = 0;
    const each = (now) => { acc += 0.01; if (acc >= 0.25) { acc = 0; tick(now); } };
    await sim.advance(20, each);
    const m = sim.master();
    const playingNow = () => sim.voices(sim.ctx.currentTime).filter((v) => v.g > 0.05);
    // Ducking
    globalThis.dispatchEvent(new CustomEvent('br:voice', { detail: { speaking: true } }));
    await sim.advance(0.2, each);
    ok(Math.abs(m.duck.gain.value - 10 ** (-11 / 20)) < 0.03, `voz ⇒ −11 dB (${m.duck.gain.value.toFixed(3)})`);
    globalThis.dispatchEvent(new CustomEvent('br:voice', { detail: { speaking: false } }));
    await sim.advance(0.15, each);
    ok(m.duck.gain.value < 0.9, 'la relajación es suave (450 ms)');
    await sim.advance(0.8, each);
    ok(m.duck.gain.value > 0.97, 'tras la voz vuelve a 0 dB');
    // Pausa / reanudar
    const beforePause = sim.clock.ms / 1000 - t0 - off;
    const posBefore = eng.status().pos;
    const idBefore = eng.nowPlaying()?.trackId;
    eng.pause();
    running = false;
    await sim.advance(0.6);
    ok(sim.voices(sim.ctx.currentTime).length === 0, 'pausa: fuentes paradas tras el fundido');
    ok(m.fade.gain.value < 0.01, 'pausa: fundido a silencio');
    ok(eng.nowPlaying()?.trackId === idBefore, 'nowPlaying durante la pausa');
    await sim.advance(5);
    off += 5.6;
    running = true;
    eng.resume();
    await sim.advance(1, each);
    ok(playingNow().length === 1 && playingNow()[0].s.buffer.id === idBefore, 'reanudar: vuelve a sonar la misma pista');
    ok(Math.abs(eng.status().pos - (posBefore + 0.9 * (playingNow()[0]?.s.rate || 1))) < 0.25, `reanudar: desde donde se paró (${eng.status().pos.toFixed(2)} vs ${posBefore.toFixed(2)})`);
    ok(m.fade.gain.value > 0.95, 'reanudar: fundido de entrada');
    const tNow = sim.clock.ms / 1000 - t0 - off;
    ok(Math.abs(eng.status().t - tNow) < 0.1 && Math.abs(tNow - beforePause - 1) < 0.1, 'la línea de tiempo no avanza en pausa');
    // Salto de tramo hacia delante
    const starts = [];
    let acc2 = 0;
    for (const s of w.segments) { starts.push(acc2); acc2 += s.sec; }
    const target = starts.find((s) => s > tNow + 120 && w.segments[starts.indexOf(s)].zone === 'sprint') ?? starts[6];
    off -= target - tNow;
    eng.seek(target);
    // La transición rápida entra en el siguiente downbeat de la saliente: hasta un compás suyo más tras la carga
    const outBarSec = BY_ID.get(idBefore) ? trackGrid(BY_ID.get(idBefore)).barSec / RATE_MIN : 2.6;
    await sim.advance(2.5 + outBarSec, each);
    const ex = plan.cues[Math.max(0, plan.cues.findLastIndex((c) => c.atSec <= target + 1e-6 && c.change === 'track'))];
    ok(eng.nowPlaying()?.trackId === ex.trackId, `seek: suena la pista del tramo (${eng.nowPlaying()?.trackId} vs ${ex.trackId})`);
    ok(playingNow().length === 1, 'seek: una sola fuente sonando tras la transición rápida');
    const bp = eng.beatPhase();
    ok(bp >= 0 && bp < 1, 'beatPhase en [0,1)');
    // Volumen y efectos
    eng.setVolume(0.5);
    await sim.advance(0.5, each);
    ok(Math.abs(m.music.gain.value - 0.5 ** 1.25) < 0.02, `setVolume(0,5) ⇒ ganancia ${(0.5 ** 1.25).toFixed(3)} (−7,5 dB: curva v^(1+(1−v)²))`);
    eng.setVolume(0.8);
    await sim.advance(0.5, each);
    ok(Math.abs(20 * Math.log10(m.music.gain.value) + 2.02) < 0.1, `setVolume(0,8) ⇒ −2 dB (${(20 * Math.log10(m.music.gain.value)).toFixed(2)} dB; antes −3,9)`);
    // Dinámica a nivel fijo antes del volumen y de la voz: glue suave + limitador (techo −3 dB, ataque 1 ms)
    ok(m.glue && m.limiter && m.drive && m.trim, 'maestro: drive → glue → limitador → trim → duck → fade → volumen → destino');
    ok(m.glue && m.glue.ratio.value === 2 && m.glue.threshold.value === -18 && m.glue.attack.value === 0.01, 'glue: −18 dB, 2:1, ataque 10 ms');
    ok(m.limiter && m.limiter.ratio.value === 20 && m.limiter.threshold.value === -3 && m.limiter.attack.value === 0.001, 'limitador: −3 dB, 20:1, ataque 1 ms');
    ok(m.trim && Math.abs(20 * Math.log10(m.trim.gain.value) + 1.7) < 0.01, 'trim −1,7 dB (descuenta la compensación automática del limitador)');
    const dyn = eng.status().dyn;
    ok(dyn && Number.isFinite(dyn.glue) && Number.isFinite(dyn.limiter), 'status().dyn: reducción de ganancia del glue y del limitador');
    // Al 100 % la música suena 2 dB más: el coach la agacha esos 2 dB de más (la voz queda igual de clara)
    eng.setVolume(1);
    globalThis.dispatchEvent(new CustomEvent('br:voice', { detail: { speaking: true } }));
    await sim.advance(0.3, each);
    ok(Math.abs(20 * Math.log10(m.duck.gain.value) + 13.02) < 0.3, `voz al 100 % ⇒ −13 dB (${(20 * Math.log10(m.duck.gain.value)).toFixed(1)} dB)`);
    eng.setVolume(0.8);
    await sim.advance(0.3, each);
    ok(Math.abs(20 * Math.log10(m.duck.gain.value) + 11) < 0.3, `bajar el volumen con la voz sonando re-ajusta el agachado (${(20 * Math.log10(m.duck.gain.value)).toFixed(1)} dB)`);
    globalThis.dispatchEvent(new CustomEvent('br:voice', { detail: { speaking: false } }));
    await sim.advance(1, each);
    eng.setEffects(false);
    // Apagar y encender
    eng.setEnabled(false);
    await sim.advance(1, each);
    ok(sim.voices(sim.ctx.currentTime).length === 0 && eng.nowPlaying() === null, 'setEnabled(false): silencio total');
    eng.setEnabled(true);
    await sim.advance(2.5, each);
    ok(playingNow().length >= 1 && eng.nowPlaying(), 'setEnabled(true): vuelve donde toca');
    // Reloj del contexto parado (iOS 'interrupted'): al volver, se reubica sin romperse
    const idInt = eng.nowPlaying()?.trackId;
    sim.interrupt();
    await sim.advance(3, each);
    sim.uninterrupt();
    await sim.advance(2, each);
    ok(eng.nowPlaying()?.trackId === idInt && Math.abs(eng.status().t - (sim.clock.ms / 1000 - t0 - off)) < 0.1, 'interrupción: se re-ancla al tiempo de clase');
    ok(playingNow().length >= 1, 'tras una interrupción del contexto sigue sonando');
    // Parar
    let stopped = false;
    eng.stop({ fadeSec: 1 }).then(() => { stopped = true; });
    running = false;
    await sim.advance(1.3);
    ok(stopped && sim.voices(sim.ctx.currentTime).length === 0, 'stop(): fundido y parada');
    ok(eng.nowPlaying() === null, 'nowPlaying null tras parar');
    ok(sim.counters.rateChanges === 0, 'ningún cambio de playbackRate en directo');
    eng.destroy();
    eng.destroy();
    ok(true, 'destroy idempotente');
  } finally { sim.restore(); }
});

await asection('Motor DJ: sin Web Audio, pista rota y decodificación lenta', async () => {
  const sim = makeSim({ broken: new Set(), decodeMs: () => 250 });
  try {
    const { createMusicEngine } = await import('../js/audio/music.js');
    const w = buildWorkout('minute-on', { minutes: 20, levels: LEVELS, seed: 9 });
    const plan = buildMusicPlan(w, libTracks, { seed: 9 });
    // Sin AudioContext: nada suena pero nada se rompe
    const eng0 = createMusicEngine({ getAudioContext: () => null });
    let loaded0 = null;
    eng0.unlock();
    eng0.load(plan, LIB_BY_ID).then((v) => { loaded0 = v; });
    await sim.advance(0.5);
    ok(loaded0 === false && eng0.start(0) === false && eng0.nowPlaying() === null, 'sin Web Audio: load/start devuelven false');
    eng0.update(10, { status: 'running' });
    eng0.destroy();
    ok(true, 'sin Web Audio: sin excepciones');
  } finally { sim.restore(); }

  // Pista que no carga: se sustituye por otra del mismo tramo y nunca hay silencio
  const firstChange = plan0().cues.find((c) => c.change === 'track' && c.atSec > 0);
  const sim2 = makeSim({ broken: new Set([firstChange.trackId]) });
  try {
    const { createMusicEngine } = await import('../js/audio/music.js');
    const eng = createMusicEngine({ getAudioContext: () => sim2.ctx });
    eng.unlock();
    eng.load(plan0(), LIB_BY_ID);
    await sim2.advance(1.5);
    const t1 = sim2.clock.ms / 1000;
    eng.start(0);
    let quiet = 0;
    let acc = 0;
    let altHeard = null;
    await sim2.advance(firstChange.atSec + 40, (now) => {
      acc += 0.01;
      if (acc >= 0.25) { acc = 0; eng.update(now - t1, { status: 'running' }); }
      if (now - t1 > 3 && sim2.audible(sim2.ctx.currentTime) < 0.15) quiet++;
      if (now - t1 > firstChange.atSec + 3) altHeard ??= eng.nowPlaying()?.trackId;
    });
    const tier = BY_ID.get(firstChange.trackId).tier;
    ok(quiet * 0.01 < 0.3, `pista rota: nunca silencio (${(quiet * 0.01).toFixed(2)} s)`);
    ok(altHeard && altHeard !== firstChange.trackId && BY_ID.get(altHeard).tier === tier, `pista rota: suena otra del mismo tramo (${altHeard})`);
    ok(eng.status().subst[firstChange.trackId] === altHeard, 'pista rota: queda anotada la sustituta');
    eng.destroy();
  } finally { sim2.restore(); }

  // Decodificación lentísima de la segunda pista: la primera sigue (con bucle de frase) y se cambia al estar lista
  const p0 = plan0();
  const slowId = p0.cues.find((c) => c.change === 'track' && c.atSec > 0).trackId;
  const sim3 = makeSim({ decodeMs: (id) => (id === slowId ? 200000 : 300) });
  try {
    const { createMusicEngine } = await import('../js/audio/music.js');
    const eng = createMusicEngine({ getAudioContext: () => sim3.ctx, decodeTimeoutMs: 400000 });
    eng.unlock();
    eng.load(p0, LIB_BY_ID);
    await sim3.advance(1.5);
    const t1 = sim3.clock.ms / 1000;
    eng.start(0);
    let quiet = 0;
    let acc = 0;
    let loops = 0;
    let lastJob = null;
    let heardSlow = false;
    await sim3.advance(420, (now) => {
      acc += 0.01;
      if (acc >= 0.25) {
        acc = 0;
        eng.update(now - t1, { status: 'running' });
        const j = eng.status().job;
        if (j && j.kind === 'loop' && j.first !== lastJob) { loops++; lastJob = j.first; }
      }
      const T = now - t1;
      const cut = p0.cues.some((c) => c.transition === 'riser-drop' && T > c.atSec - 0.6 && T < c.atSec + 0.05);
      if (T > 3 && !cut && sim3.audible(sim3.ctx.currentTime) < 0.15) quiet++;
      if (eng.nowPlaying()?.trackId === slowId) heardSlow = true;
    });
    ok(quiet * 0.01 < 0.3, `decodificación lenta: nunca silencio (${(quiet * 0.01).toFixed(2)} s)`);
    ok(loops >= 1, `decodificación lenta: la pista actual repite frase en lugar de acabarse (${loops} bucles)`);
    ok(heardSlow, 'decodificación lenta: al estar lista, entra');
    eng.destroy();
  } finally { sim3.restore(); }
});

function plan0() {
  return buildMusicPlan(buildWorkout('minute-on', { minutes: 20, levels: LEVELS, seed: 9 }), libTracks, { seed: 9 });
}

await asection('Almacén de buffers: presupuesto en bytes, ventanas, reintentos, descarga abortada', async () => {
  const { createBufferStore, BUDGET_BYTES } = await import('../js/audio/music-buffers.js');
  // Pistas "importadas" largas (solo existen en este test)
  const base = BY_ID.get('deep-house-paulyudin');
  const fakes = { u_long: 30 * 60, u_mid: 12 * 60 };
  for (const [id, d] of Object.entries(fakes)) BY_ID.set(id, { ...base, id, duration: d });
  const sim = makeSim({ decodeMs: () => 200 });
  try {
    const enc = (id) => new TextEncoder().encode(id).buffer;
    const tr = (id) => ({ ...(BY_ID.get(id)), id, url: `x/${id}.m4a` });
    const fail = new Map();      // id → nº de fallos que quedan
    const hang = new Set();      // id → la descarga no llega nunca (hasta que se aborta)
    const slow = new Map();      // id → ms de descarga
    let aborts = 0;
    const loadData = (t, { signal } = {}) => new Promise((resolve, reject) => {
      signal?.addEventListener?.('abort', () => { aborts++; reject(Object.assign(new Error('abortada'), { name: 'AbortError' })); });
      if (fail.get(t.id) > 0) { fail.set(t.id, fail.get(t.id) - 1); sim.later(() => reject(new Error('red')), 50); return; }
      if (hang.has(t.id)) return;
      sim.later(() => resolve(enc(t.id)), slow.get(t.id) || 50);
    });
    const now = () => sim.clock.ms / 1000;
    const inUse = new Set();
    const score = (id) => (inUse.has(id) ? -1 : Infinity);
    let st = createBufferStore({ getContext: () => sim.ctx, loadData, now });
    // Presupuesto: con una pista sonando, la de 12 min baja de frecuencia y la de 20 min no cabe (sustituta)
    const A = 'deep-house-paulyudin';
    ok(st.request(tr(A), 0, score) === 'loading', 'store: primera petición en curso');
    await sim.advance(1);
    ok(st.has(A) && st.stats().rates[A] === 48000, `store: decodifica a la frecuencia del contexto (${st.stats().rates[A]})`);
    inUse.add(A);
    ok(st.request(tr('u_long'), 30, score) === 'failed' && st.stats().errors.u_long?.reason === 'memoria', 'store: una pista que no cabe ni a 16 kHz se rechaza (sustituta)');
    ok(st.request(tr('u_mid'), 30, score) === 'loading', 'store: la de 12 min se decodifica…');
    await sim.advance(1);
    const r = st.stats();
    ok(st.has('u_mid') && r.rates.u_mid < 48000, `store: … a menos frecuencia (${r.rates.u_mid} Hz)`);
    ok(r.bytes <= BUDGET_BYTES * 1.25, `store: residente ${(r.bytes / 2 ** 20).toFixed(0)} MB dentro del margen`);
    st.releaseAll();
    ok(st.stats().decoded === 0 && st.stats().bytes === 0, 'store: releaseAll suelta todo');
    inUse.clear();
    // Ventana: solo se guarda el trozo que usa el plan
    st = createBufferStore({ getContext: () => sim.ctx, loadData, now, windowFor: () => [30, 90] });
    st.request(tr(A), 0, score);
    await sim.advance(1);
    const wb = st.get(A);
    ok(wb && Math.abs(st.offsetOf(wb) - 30) < 0.01 && Math.abs(wb.duration - 60) < 0.01, `store: ventana [30, 90] s (${st.offsetOf(wb)?.toFixed(2)}, ${wb?.duration?.toFixed(2)} s)`);
    ok(Math.abs(st.stats().bytes - 60 * 48000 * 8) < 48000 * 8, 'store: los bytes son los de la ventana');
    // Reintentos: un fallo de red no deja la pista fuera toda la sesión
    st = createBufferStore({ getContext: () => sim.ctx, loadData, now });
    const B = 'tropical-deep-house-deep-house-music';
    fail.set(B, 1);
    st.request(tr(B), 50, score);
    await sim.advance(0.5);
    ok(st.isFailed(B) && st.request(tr(B), 50, score) === 'failed', 'store: fallo ⇒ en espera de reintento');
    await sim.advance(20.5);
    ok(!st.isFailed(B) && st.request(tr(B), 50, score) === 'loading', 'store: a los 20 s se reintenta');
    await sim.advance(1);
    ok(st.has(B), 'store: el reintento la deja lista');
    const C = 'rapid-drum-and-bass-catch22music';
    fail.set(C, 1);
    st.request(tr(C), 50, score);
    await sim.advance(0.5);
    ok(st.isFailed(C), 'store: otro fallo');
    st.retryNow();
    ok(st.request(tr(C), 50, score) === 'loading', 'store: retryNow (vuelve la red / la app) reintenta ya');
    await sim.advance(1);
    fail.set('the-portal-rizzlas', 9);
    for (let k = 0; k < 4; k++) { st.retryNow(); st.request(tr('the-portal-rizzlas'), 50, score); await sim.advance(0.5); }
    ok(st.stats().errors['the-portal-rizzlas']?.permanent === true, 'store: tras 3 intentos queda descartada');
    // Descarga colgada: se aborta a los 15 s (no a los 60) y libera el turno
    st = createBufferStore({ getContext: () => sim.ctx, loadData, now });
    const D = 'drum-bass-watermello';
    hang.add(D);
    st.request(tr(D), 50, score);
    await sim.advance(14);
    ok(st.loadingId() === D, 'store: descarga en curso a los 14 s');
    await sim.advance(1.5);
    ok(st.loadingId() == null && st.isFailed(D) && st.stats().errors[D]?.reason === 'timeout', 'store: abortada a los 15 s');
    hang.clear();
    // Prioridad: una descarga que se necesita más tarde cede ante la que urge
    const E = 'stylish-deep-electronic-nveravetyanmusic';
    const F = 'synthwave-retro-80s-arpmedia';
    slow.set(E, 10000);
    const need = (id) => (id === E ? 80 : Infinity);
    ok(st.request(tr(E), 80, need) === 'loading', 'store: prefetch lejano en curso');
    await sim.advance(1);
    const a0 = aborts;
    ok(st.request(tr(F), 5, need) === 'loading' && st.loadingId() === F && aborts === a0 + 1, 'store: la urgente aborta la lejana');
    await sim.advance(1);
    ok(st.has(F) && !st.isFailed(E), 'store: la abortada no cuenta como fallo');
    // Red lentísima: una descarga urgente no se aborta (abortar en cadena no dejaría llegar a ninguna)
    const G = 'midnight-synthwave-the-mountain';
    const H = 'bhairav-psytrance-buzzpsy';
    slow.set(G, 30000);
    const a1 = aborts;
    ok(st.request(tr(G), 3, () => 3) === 'loading', 'store: descarga urgente en curso');
    ok(st.request(tr(H), 1, () => 3) === 'busy' && aborts === a1 && st.loadingId() === G, 'store: otra urgente espera (sin abortos en cadena)');
    ok(st.request(tr(H), 1, () => 30) === 'busy', 'store: ni aunque la urgente en curso haga falta 30 s después');
  } finally {
    sim.restore();
    for (const id of Object.keys(fakes)) BY_ID.delete(id);
  }
});

await asection('Motor DJ: reloj atascado, salto a compás, ducking en transición, automatización por delante', async () => {
  const sim = makeSim();
  try {
    const { createMusicEngine } = await import('../js/audio/music.js');
    const w = buildWorkout('pyramid', { minutes: 20, levels: LEVELS, seed: 7 });
    const plan = buildMusicPlan(w, libTracks, { seed: 7 });
    const eng = createMusicEngine({ getAudioContext: () => sim.ctx });
    eng.unlock();
    eng.load(plan, LIB_BY_ID);
    await sim.advance(1.5);
    const t0 = sim.clock.ms / 1000;
    let off = 0;
    eng.start(0);
    let acc = 0;
    const each = (now) => { acc += 0.01; if (acc >= 0.25) { acc = 0; eng.update(now - t0 - off, { status: 'running' }); } };
    await sim.advance(30, each);
    const m = sim.master();
    // Automatización "inmediata": nunca en el lote de audio en curso (≥ 25 ms por delante)
    const ct = sim.ctx.currentTime;
    eng.pause();
    const evs = m.fade.gain.ev.filter((e) => e.t >= ct - 1e-9);
    ok(evs.length && Math.min(...evs.map((e) => e.t)) >= ct + 0.024, `pausa: el fundido empieza ≥ 25 ms por delante (${((Math.min(...evs.map((e) => e.t)) - ct) * 1000).toFixed(1)} ms)`);
    await sim.advance(1);
    off += 1;
    eng.resume();
    await sim.advance(5, each);
    // Reloj del contexto atascado ('running' pero quieto): no se acumulan voces ni saltos
    const seeks0 = eng.status().seeks;
    sim.ctx.frozen = sim.ctx.currentTime;
    await sim.advance(8, each);
    const sa = eng.status();
    ok(sa.stalled === true && sa.stalls === 1, `reloj atascado: detectado (${sa.stalled}, ${sa.stalls})`);
    ok(sa.voices.length <= 6 && sa.seeks === seeks0, `reloj atascado: sin saltos ni voces acumuladas (${sa.voices.length} voces, ${sa.seeks - seeks0} saltos)`);
    ok(sa.ctxLog.some((x) => x.state === 'reloj parado'), 'reloj atascado: queda en el registro');
    sim.uninterrupt();
    await sim.advance(3, each);
    const sb = eng.status();
    ok(!sb.stalled && sb.seeks - seeks0 <= 1, `reloj de vuelta: un solo salto para re-anclar (${sb.seeks - seeks0})`);
    ok(Math.abs(sb.t - (sim.clock.ms / 1000 - t0 - off)) < 0.1 && sim.voices(sim.ctx.currentTime).some((v) => v.g > 0.3), 'reloj de vuelta: suena y va al tiempo de clase');
    // Salto de tramo a otra pista: el centro del fundido cae en un compás de las dos
    const starts = [];
    let a2 = 0;
    for (const s of w.segments) { starts.push(a2); a2 += s.sec; }
    const tNow = sim.clock.ms / 1000 - t0 - off;
    const curId = eng.nowPlaying()?.trackId;
    const target = starts.find((s, k) => s > tNow + 60 && plan.cues[Math.max(0, plan.cues.findLastIndex((c) => c.atSec <= s + 1e-6 && c.change === 'track'))].trackId !== curId);
    off -= target - tNow;
    eng.seek(target);
    await sim.advance(0.3, each);
    const sj = eng.status();
    const inV = sj.voices.find((v) => !v.main && v.startC >= sim.ctx.currentTime - 0.5);
    const outV = sj.voices.find((v) => v.main);
    if (sj.job?.kind === 'fast' && inV && outV) {
      const ph = (v) => { const g = trackGrid(BY_ID.get(v.trackId)); const p = v.p0 + (sj.job.swap - v.c0) * v.rate; const f = (((p - g.barOffset) / g.barSec) % 1 + 1) % 1; return Math.min(f, 1 - f) * g.barSec / v.rate; };
      ok(ph(inV) < 0.002 && ph(outV) < 0.002, `salto: compás con compás en el centro del fundido (${(ph(inV) * 1000).toFixed(1)} / ${(ph(outV) * 1000).toFixed(1)} ms)`);
    } else ok(false, `salto: transición rápida con dos voces (${sj.job?.kind})`);
    await sim.advance(4, each);
    // Ducking −6 dB si la voz cae dentro de una transición filtrada
    let jf = null;
    for (let k = 0; k < 2400 && !jf; k++) {
      await sim.advance(0.25, each);
      const j = eng.status().job;
      if (j && ['riser-drop', 'echo-out', 'filter-fade'].includes(j.kind) && sim.ctx.currentTime > j.first + 0.3 && sim.ctx.currentTime < j.end - 0.6) jf = j;
    }
    if (jf) {
      globalThis.dispatchEvent(new CustomEvent('br:voice', { detail: { speaking: true } }));
      await sim.advance(0.25, each);
      ok(Math.abs(m.duck.gain.value - 10 ** (-10 / 20)) < 0.04, `voz en una transición filtrada ⇒ −10 dB (${(20 * Math.log10(m.duck.gain.value)).toFixed(1)} dB)`);
      globalThis.dispatchEvent(new CustomEvent('br:voice', { detail: { speaking: false } }));
      await sim.advance(1, each);
      ok(m.duck.gain.value > 0.97, 'tras la voz vuelve a 0 dB');
    } else ok(false, 'no se encontró una transición filtrada');
    // Apagar la música suelta los buffers
    eng.setEnabled(false);
    await sim.advance(1, each);
    ok(eng.status().buffers.decoded === 0, `setEnabled(false): sin buffers decodificados (${eng.status().buffers.decoded})`);
    eng.setEnabled(true);
    await sim.advance(4, each);
    ok(sim.voices(sim.ctx.currentTime).some((v) => v.g > 0.3), 'setEnabled(true): vuelve a sonar (redecodifica)');
    eng.destroy();
  } finally { sim.restore(); }
});

// Reanudar a menos de RESUME_FADE (0,6 s) de la primera acción de una mezcla: con el fundido de entrada en la ganancia
// de la voz, la mezcla la reprogramaba (setAt(O.gain, 1, inicio)) → silencio hasta su arranque y golpe a pleno.
await asection('Motor DJ: reanudar justo antes de una mezcla (sin hueco ni golpe)', async () => {
  const w = buildWorkout('pyramid', { minutes: 20, levels: LEVELS, seed: 3 });
  const plan = buildMusicPlan(w, libTracks, { seed: 3 });
  const firstAction = (c) => c.atSec - Math.max(c.leadSec, c.atSec - c.entryAt);
  const cues = plan.cues.filter((c) => c.change === 'track' && c.transition === 'riser-drop').slice(0, 2);
  ok(cues.length === 2, 'Pirámide 20′ s3: hay dos riser-drop para probar');
  for (const c of cues) {
    for (const d of [0.15, 0.45]) {
      const sim = makeSim();
      try {
        const { createMusicEngine } = await import('../js/audio/music.js');
        const eng = createMusicEngine({ getAudioContext: () => sim.ctx });
        eng.unlock();
        eng.load(plan, LIB_BY_ID);
        await sim.advance(1.5);
        const t0 = sim.clock.ms / 1000;
        let off = 0;
        let running = true;
        eng.start(0);
        let acc = 0;
        const each = (now) => { acc += 0.01; if (acc >= 0.25) { acc = 0; if (running) eng.update(now - t0 - off, { status: 'running' }); } };
        await sim.advance(3, each);
        const Tp = firstAction(c) - d;
        off -= Tp - 8 - (sim.clock.ms / 1000 - t0 - off);
        eng.seek(Tp - 8);
        await sim.advance(8, each);
        eng.pause();
        running = false;
        await sim.advance(3);
        off += 3;
        running = true;
        // Nivel real hasta el destino: todas las GainNode de cada camino (también drive, trim, duck, fade y volumen)
        const toDest = (n, t, seen = new Set()) => {
          if (n === sim.ctx.destination) return 1;
          if (seen.has(n) || seen.size > 30) return 0;
          seen.add(n);
          let s = 0;
          for (const o of n.outs) s += toDest(o, t, seen);
          seen.delete(n);
          return (n.kind === 'gain' ? n.gain.at(t) : 1) * s;
        };
        const level = (t) => sim.ctx.sources.filter((s) => s.buffer?.isFake && s.playing(t)).reduce((a, s) => a + toDest(s, t), 0);
        const cRes = sim.ctx.currentTime;
        eng.resume();
        let prev = null;
        let jump = 0;
        let silent = 0;
        await sim.advance(1.5, (now) => {
          each(now);
          const ct = sim.ctx.currentTime;
          const a = level(ct);
          if (prev != null && ct - cRes > 0.08) jump = Math.max(jump, Math.abs(a - prev));
          if (ct - cRes > 0.25 && ct - cRes < 1 && a < 0.05) silent += 0.01;
          prev = a;
        });
        ok(jump < 0.3 && silent < 0.02, `reanudar ${d} s antes de la mezcla de ${c.atSec} s: sin golpe (${jump.toFixed(2)}/10 ms) ni hueco (${silent.toFixed(2)} s)`);
        eng.destroy();
      } finally { sim.restore(); }
    }
  }
});

await asection('Motor DJ: contexto inyectado ({ context, now }) sin temporizadores', async () => {
  const sim = makeSim();
  try {
    const { createMusicEngine } = await import('../js/audio/music.js');
    const plan = buildMusicPlan(buildWorkout('pyramid', { minutes: 20, levels: LEVELS, seed: 7 }), libTracks, { seed: 7 });
    let ticks = 0;
    const realSetInterval = globalThis.setInterval;
    globalThis.setInterval = (...a) => { ticks++; return realSetInterval(...a); };
    const eng = createMusicEngine({ context: sim.ctx, now: () => sim.ctx.currentTime });
    let loaded = null;
    eng.load(plan, LIB_BY_ID).then((v) => { loaded = v; });
    await sim.advance(1);
    eng.start(0);
    const t0 = sim.ctx.currentTime;
    for (let k = 0; k < 4 * 300; k++) { await sim.advance(0.25); eng.update(sim.ctx.currentTime - t0, { status: 'running' }); }
    ok(loaded === true && ticks === 0, `con reloj inyectado no crea su propio bucle (${ticks})`);
    ok(sim.voices(sim.ctx.currentTime).length >= 1 && eng.nowPlaying(), 'con reloj inyectado suena y avanza con update()');
    let stopped = false;
    eng.stop({ fadeSec: 1 }).then(() => { stopped = true; });
    for (let k = 0; k < 8; k++) { await sim.advance(0.25); eng.update(sim.ctx.currentTime - t0, { status: 'finished' }); }
    ok(stopped, 'stop() se resuelve con el reloj inyectado');
    eng.destroy();
  } finally { sim.restore(); }
});

/* ═════════════ 4. Código del motor: sin <audio> ni cambios de velocidad en directo ═════════════ */

section('music.js: AudioBuffers, sin MediaElementSource ni playbackRate en directo', () => {
  const src = readFileSync(join(ROOT, 'js/audio/music.js'), 'utf8');
  const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/createMediaElementSource|createElement\(['"]audio/.test(code), 'sin <audio> ni MediaElementSource');
  ok(/createBufferSource\(\)/.test(code) && /src\.start\(Math\.max\(0, startC\) \+ late, p0 - w0 \+ late \* rate\)/.test(code), 'AudioBufferSourceNode con start(cuándo, desde) (desde = posición − inicio de su ventana)');
  const rateWrites = code.match(/playbackRate\.[a-zA-Z]+/g) || [];
  ok(rateWrites.length === 1 && rateWrites[0] === 'playbackRate.value', `playbackRate solo se fija al crear la fuente (${rateWrites.join(', ')})`);
  ok(!/preservesPitch|currentTime\s*=/.test(code), 'sin preservesPitch ni saltos de currentTime');
  const bsrc = readFileSync(join(ROOT, 'js/audio/music-buffers.js'), 'utf8');
  ok(/BUDGET_BYTES = /.test(bsrc) && /MAX_DECODED = 3/.test(bsrc) && /OfflineAudioContext/.test(bsrc) && /windowFor/.test(bsrc) && /AbortController/.test(bsrc),
    'music-buffers: presupuesto en bytes, como mucho 3, OfflineAudioContext, ventanas y descarga abortable');
});

/* ═════════════ Resultado ═════════════ */

const avgTracks = stats.tracksPerSession.reduce((a, b) => a + b, 0) / Math.max(1, stats.tracksPerSession.length);
line('');
line(`Clases: ${stats.workouts} · cues: ${stats.cues} (pista ${stats.changes.track}, tempo ${stats.changes.tempo}, sin cambio ${stats.changes.none}) · pistas/sesión ${avgTracks.toFixed(1)}`);
line(`Transiciones: ${Object.entries(stats.transitions).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
line(`Retomas (memoria de discos): ${stats.resume} · intra-zona: ${stats.intra} · drops alineados: ${stats.dropAligned} · repeticiones forzadas: ${stats.reuse} · BPM aproximado: ${stats.fallbackBpm}`);
if (VERBOSE) {
  const w = buildWorkout('sprint-30-60', { minutes: 20, levels: LEVELS, seed: 7 });
  line('', 'Ejemplo sprint-30-60 · 20′:', ...describePlan(buildMusicPlan(w, TRACKS, { seed: 7 }), BY_ID).map((s) => `  ${s}`));
}
process.stdout.write(`${report.join('\n')}\n\n`);
if (failures.length || firstFail.size) {
  const all = [...firstFail.values(), ...failures.filter((f) => !/ \d+′ s\d+ (normal|max)$/.test(f))];
  process.stdout.write(`✗ ${failures.length} de ${checks} comprobaciones fallan (${firstFail.size} tipos):\n`);
  for (const f of all.slice(0, 40)) process.stdout.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write(`✓ ${checks} comprobaciones correctas\n`);
