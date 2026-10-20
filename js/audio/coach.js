// BestRunning · coach de voz: programa determinista de avisos (buildCueSchedule, sin DOM) y cola de voz en
// tiempo real (createCoach). Al importarse no toca window/document: speech y audio solo dentro de funciones.
// Con el pack grabado (Eva Dorado, voice-pack.js) cargado, cada aviso se compone SOLO con clips; los cambios de
// tramo que no se pueden componer caen enteros a la voz del sistema y el resto se omite (nunca se mezclan).
// En la app nativa de iPhone la clase NO usa nunca la voz del sistema: speechSynthesis suena en el proceso de la app
// (AVSpeechSynthesizer) y activar su sesión de audio podía interrumpir el audio de la página (WebKit) y pausar o
// enmudecer la clase. Allí solo hablan los clips de Eva; si falta un clip, ese aviso se calla (los pitidos siguen).
import { clamp, hashStr, makeRng, todayKey } from '../core/utils.js';
import { ZONES } from '../training/levels.js';
import { PHRASES, pick, pickShortest, fill, clipIdsFor, toNumber } from './phrases.js';
import { speak, cancelSpeech, speechText, estimateSpeechSec } from './speech.js';
import {
  beep, cancelBeeps, hasClips, playClips, stopClips, preloadClips, ensureAudioRunning, applyAudioSettings,
  loadPack, packInfo, clipDuration, clipSequenceSec, estimateClipSec, playCountdown,
} from './audio-engine.js';
import { PACK_SCRIPT, composeCue, speedClip, durationClip, clipsText } from './voice-pack.js';

const MODES = ['minimal', 'normal', 'coach'];
const HARD = new Set(['fast', 'sprint']);
const GAP = 0.6;              // silencio mínimo entre frases (s)
const GAP_MID = 1.5;          // entre dos avisos flexibles de prioridad 2
const GAP_LOW = 3;            // alrededor de las de prioridad 1
const LOW_SPACING = 8;        // en el programa: una de prioridad 1 no arranca a < 8 s de otra
const LOW_LOW_SPACING = 40;   // ni a < 40 s de otra de prioridad 1
const RUNTIME_LOW_SPACING = 6; // en directo: se descarta si hay otra a < 6 s
const BEEP_LOOKAHEAD = 0.35;
const PACK_CLIPS = new Map(PACK_SCRIPT.map((c) => [c.id, c]));
const PACK_IDS = new Set(PACK_CLIPS.keys());
const TIP_GROUPS = new Set(['form', 'breath', 'mind', 'hard', 'good', 'recover', 'music']);
const TIP_MAX_USES = 2;       // con pocas variantes grabadas, mejor callar que repetir el mismo consejo
const SEGMENT_KINDS = new Set(['intro', 'pre', 'change', 'testStage']); // si el pack falla, caen a la voz del sistema
const PACK_FAILS_TO_TTS = 2;  // fallos seguidos del pack antes de pasar toda la sesión a la voz del sistema

/** Dentro de la app nativa de iPhone (WKWebView con el puente «bestrunning»; en Safari no existe). */
const inNativeApp = () => {
  try { return !!globalThis.webkit?.messageHandlers?.bestrunning; } catch { return false; }
};

const r1 = (v) => Math.round(v * 10) / 10;
const ceil1 = (v) => Math.ceil(v * 10 - 1e-6) / 10;
const groupOf = (id) => String(id).replace(/_\d+$/, '');

/** Duración estimada (s) de una frase a velocidad 1. */
export function estimateCueSec(text) {
  return estimateSpeechSec(speechText(text));
}

/** Segmentos saneados; conserva el índice original (segIndex del motor). */
function cleanSegments(workout) {
  const list = Array.isArray(workout?.segments) ? workout.segments : [];
  const out = [];
  list.forEach((s, idx) => {
    const sec = Math.max(0, Math.round(toNumber(s?.sec) || 0));
    if (!sec) return;
    const rep = s?.rep && Number(s.rep.n) > 0 ? { i: Math.round(Number(s.rep.i) || 1), n: Math.round(Number(s.rep.n)) } : null;
    out.push({
      idx,
      zone: ZONES[s?.zone] ? s.zone : 'run',
      speed: r1(toNumber(s?.speed) || 0),
      incline: r1(toNumber(s?.incline) || 0),
      sec,
      cue: typeof s?.cue === 'string' ? s.cue.trim() : '',
      block: typeof s?.block === 'string' ? s.block : '',
      rep,
      stage: Math.max(0, Math.round(Number(s?.stage) || 0)),
    });
  });
  return out;
}

function startsOf(segs) {
  const starts = [];
  let acc = 0;
  for (const s of segs) { starts.push(acc); acc += s.sec; }
  return { starts, total: acc };
}

function indexAt(starts, segs, t) {
  let lo = 0;
  let hi = starts.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Une varias partes { id, template, vars, text } en una frase con sus clips (null si alguna no tiene). */
function compose(parts) {
  const ps = parts.filter((p) => p && p.text);
  const text = ps.map((p) => p.text).join(' ');
  let clips = [];
  for (const p of ps) {
    const ids = clipIdsFor(p.id, p.template, p.vars);
    if (!ids) { clips = null; break; }
    clips.push(...ids);
  }
  return { text, clips: clips && clips.length ? clips : null, phraseIds: ps.map((p) => p.id) };
}

/**
 * Planificador de huecos: evita solapes entre frases y con los pitidos.
 * Prioridad 1: ≥ 3 s de silencio alrededor, ≥ 8 s entre inicios y ≥ 40 s entre dos de prioridad 1.
 */
function createPlacer(total) {
  const spoken = [];
  const blocks = [];
  const fits = (at, dur, pr, space = 0) => {
    if (at < 0 || at > total) return false;
    if (pr < 3 && at + dur > total - 0.3) return false;
    for (const s of spoken) {
      const low = pr === 1 || s.priority === 1;
      const gap = low ? GAP_LOW : pr === 2 && s.priority === 2 ? GAP_MID : GAP;
      if (at < s.at + s.dur + gap && s.at < at + dur + gap) return false;
      const minStart = Math.max(space, low ? LOW_SPACING : 0, pr === 1 && s.priority === 1 ? LOW_LOW_SPACING : 0);
      if (Math.abs(at - s.at) < minStart) return false;
    }
    if (pr < 3) for (const [a, b] of blocks) if (at < b && a < at + dur) return false;
    return true;
  };
  const find = (pref, lo, hi, dur, pr, space = 0) => {
    const L = Math.max(0, lo);
    const H = Math.min(total, hi);
    if (H < L) return null;
    const p = clamp(pref, L, H);
    for (let k = 0; k < 4000; k++) {
      const d = k * 0.5;
      const cands = k === 0 ? [p] : [p + d, p - d];
      let inRange = false;
      for (const c of cands) {
        if (c < L - 1e-9 || c > H + 1e-9) continue;
        inRange = true;
        const at = r1(c);
        if (fits(at, dur, pr, space)) return at;
      }
      if (!inRange) break;
    }
    return null;
  };
  return { spoken, add: (c) => spoken.push(c), block: (a, b) => blocks.push([a, b]), fits, find };
}

/** Cambios de segmento y momentos fijos (pre-avisos, cambios y final) del programa. */
function transitionsOf(segs, starts, total, lead) {
  const trans = [];
  for (let k = 1; k < segs.length; k++) {
    const p = segs[k - 1];
    const n = segs[k];
    const speedCh = Math.abs(n.speed - p.speed) >= 0.05;
    const inclCh = Math.abs(n.incline - p.incline) >= 0.25;
    const repStart = !!n.rep && n.rep.n > 1 && (!p.rep || p.rep.i !== n.rep.i || p.rep.n !== n.rep.n);
    trans.push({
      k, T: starts[k], p, n, speedCh, inclCh, repStart,
      zoneCh: n.zone !== p.zone,
      hasPre: (speedCh || inclCh) && p.sec >= lead + 8,
    });
  }
  const fixedTimes = [];
  for (const tr of trans) {
    if (tr.hasPre) fixedTimes.push(tr.T - lead);
    if (tr.speedCh || tr.inclCh) fixedTimes.push(tr.T);
  }
  fixedTimes.push(total);
  fixedTimes.sort((a, b) => a - b);
  const nextFixedAfter = (t) => fixedTimes.find((x) => x > t + 1e-6) ?? total;
  return { trans, fixedTimes, nextFixedAfter };
}

/**
 * Programa de avisos de un entrenamiento (determinista para el mismo seed).
 * Cada cue: { at, kind, priority (1 baja … 3 alta), text, clips, beep: 'tick'|'go'|null, segIndex, dur, phraseIds }.
 * segIndex: segmento al que se refiere (en los pre-avisos, el que va a empezar).
 * Con `pack: { available, clipSec }` (ids presentes del pack grabado y, opcional, duración real de un clip)
 * se compone con el pack (ver buildPackSchedule) y cada aviso hablado lleva además `voice: 'pack' | 'tts'`.
 * `watch`: recordatorio del Watch en el inicio · `category`: categoría de la clase (por defecto workout.category) ·
 * `music`: suena la música de la app (comentarios de música grabados entre los consejos).
 */
export function buildCueSchedule(workout, opts = {}) {
  const o = opts || {};
  const base = buildTtsSchedule(workout, o);
  const avail = o.pack ? packAvailability(o.pack) : null;
  if (!avail || !base.length) return base;
  return buildPackSchedule(workout, o, base, avail);
}

/** Programa con la voz del sistema (y clips de un pack antiguo de fragmentos, si lo hubiera). */
function buildTtsSchedule(workout, { chattiness = 'normal', announceLead = 10, name = '', seed = 1, beeps = true } = {}) {
  const segs = cleanSegments(workout);
  if (!segs.length) return [];
  const mode = MODES.includes(chattiness) ? chattiness : 'normal';
  const chatty = mode !== 'minimal';
  const lead = clamp(Math.round(toNumber(announceLead) || 10), 3, 30);
  const rng = makeRng(hashStr(`${seed}|${mode}`));
  const memory = new Map();
  const isTest = !!workout?.isTest || segs.some((s) => s.stage > 0);
  const { starts, total } = startsOf(segs);
  const userName = String(name || '').trim();
  const withName = (p) => (userName && rng.chance(p) ? userName : '');
  const say = (cat, vars, opts = {}) => {
    const p = pick(cat, rng, vars, { memory, ...opts });
    return p.text ? { ...p, vars } : null;
  };
  const shortest = (cat, vars, opts = {}) => {
    const p = pickShortest(cat, vars, opts);
    return p.text ? { ...p, vars } : null;
  };
  const cues = [];
  const placer = createPlacer(total);
  const durOf = (text) => estimateCueSec(text);
  const emit = (cue) => {
    const c = { beep: null, clips: null, phraseIds: [], ...cue, at: r1(cue.at) };
    c.dur = c.text ? r1(durOf(c.text)) : 0;
    cues.push(c);
    if (c.text) placer.add(c);
    return c;
  };
  const segAt = (t) => indexAt(starts, segs, t);

  /* 1 · Transiciones */
  const { trans, fixedTimes, nextFixedAfter } = transitionsOf(segs, starts, total, lead);

  /* 2 · Pre-avisos (T − lead) */
  const recoverForced = (tr) => tr.p.zone === 'sprint' && Math.abs(lead - 10) <= 3;
  const preCategory = (tr) => {
    const { p, n } = tr;
    if (isTest && n.stage > 0) return 'testNext';
    if (n.speed > p.speed) {
      if (n.zone === 'sprint') return rng.chance(0.75) ? 'toSprint' : 'speedUp';
      if (n.zone === 'fast') return rng.chance(0.6) ? 'toFast' : 'speedUp';
      if (n.zone === 'run') return rng.chance(0.5) ? 'toRun' : 'speedUp';
      if (n.zone === 'jog') return rng.chance(0.4) ? 'toJog' : 'speedUp';
      return 'speedUp';
    }
    if (HARD.has(p.zone) && (n.zone === 'jog' || n.zone === 'walk')) {
      return recoverForced(tr) || rng.chance(0.7) ? 'toRecover' : 'slowDown';
    }
    if (n.zone === 'jog') return rng.chance(0.5) ? 'toJog' : 'slowDown';
    if (n.zone === 'run') return rng.chance(0.5) ? 'toRun' : 'slowDown';
    return 'slowDown';
  };
  const inclinePart = (n, withLead, p) => {
    const vars = { incline: n.incline, lead };
    if (withLead) {
      const cat = n.incline === 0 ? 'inclineFlat' : n.incline > p.incline ? 'inclineUp' : 'inclineDown';
      return say(cat, vars, { require: ['lead'] });
    }
    return say(n.incline === 0 ? 'nowFlat' : 'nowIncline', vars);
  };
  for (const tr of trans) {
    if (!tr.hasPre) continue;
    const at = tr.T - lead;
    // debe acabar antes del cambio; tras un sprint con aviso largo, antes del «¡Diez segundos!»
    const beforeLast10 = chatty && tr.p.zone === 'sprint' && tr.p.sec >= 30 && lead - 10 > 3;
    const room = Math.max(1.5, (beforeLast10 ? lead - 10 : lead) - GAP - 0.1);
    const speedVars = { lead, speed: tr.n.speed, stage: tr.n.stage || '' };
    const inclCat = tr.n.incline === 0 ? 'inclineFlat' : tr.n.incline > tr.p.incline ? 'inclineUp' : 'inclineDown';
    const build = (withIncline) => {
      if (tr.speedCh) {
        const main = say(preCategory(tr), speedVars, { require: ['lead', 'speed'] });
        return compose([main, withIncline && tr.inclCh ? inclinePart(tr.n, false, tr.p) : null]);
      }
      return compose([inclinePart(tr.n, true, tr.p)]);
    };
    // la primera variante que quepa; si ninguna, la plantilla más corta
    let best = null;
    for (let tries = 0; tries < 4 && !best; tries++) {
      const c = build(tries < 2);
      if (durOf(c.text) <= room) best = c;
    }
    if (!best) {
      best = tr.speedCh
        ? compose([shortest(tr.n.speed > tr.p.speed ? 'speedUp' : 'slowDown', speedVars, { require: ['lead', 'speed'] })])
        : compose([shortest(inclCat, { incline: tr.n.incline, lead }, { require: ['lead'] })]);
    }
    emit({ at, kind: 'pre', priority: 3, segIndex: tr.n.idx, ...best });
  }

  /* 3 · Cambios (T) con pitidos T−3, T−2, T−1 */
  const changeCategory = (p, n) => {
    if (isTest && n.stage > 0) return 'testStage';
    if (n.zone === 'cooldown') return 'cooldown';
    if (n.zone === 'warmup') return 'warmup';
    if (n.zone === 'sprint') return rng.chance(0.6) ? 'nowSprint' : 'now';
    if (p && HARD.has(p.zone) && (n.zone === 'jog' || n.zone === 'walk')) return rng.chance(0.6) ? 'nowRecover' : 'now';
    return 'now';
  };
  const changeDur = new Map();
  for (const tr of trans) {
    const { p, n, T } = tr;
    const active = tr.speedCh || tr.inclCh;
    if (!active && !tr.zoneCh && !tr.repStart) continue;
    const vars = { zone: n.zone, speed: n.speed, dur: n.sec, stage: n.stage || '', incline: n.incline };
    const main = !tr.speedCh && tr.inclCh
      ? inclinePart(n, false, p)
      : say(changeCategory(p, n), vars, { require: ['speed'] });
    const incl = tr.speedCh && tr.inclCh ? inclinePart(n, false, p) : null;
    let rep = null;
    if (tr.repStart) {
      const rv = { i: n.rep.i, n: n.rep.n, name: withName(0.4) };
      const cat = n.rep.i >= n.rep.n ? 'repLast' : n.rep.i === 1 && rng.chance(0.7) ? 'repFirst' : 'repInfo';
      rep = say(cat, rv);
    }
    const room = nextFixedAfter(T) - T - GAP;
    const options = [[main, incl, rep], [main, incl], [main]];
    let chosen = null;
    for (const o of options) {
      const c = compose(o);
      if (durOf(c.text) <= room) { chosen = c; break; }
    }
    if (!chosen) {
      const cat = !tr.speedCh && tr.inclCh ? (n.incline === 0 ? 'nowFlat' : 'nowIncline') : changeCategory(p, n);
      chosen = compose([shortest(cat, vars, { require: tr.speedCh ? ['speed'] : [] })]);
      if (!chosen.text) chosen = compose([main]);
    }
    if (active) {
      if (beeps) {
        for (const d of [3, 2, 1]) {
          if (T - d > starts[tr.k - 1]) emit({ at: T - d, kind: 'tick', priority: 3, text: '', beep: 'tick', segIndex: n.idx });
        }
        placer.block(T - 3.3, T + 0.1);
      }
      const c = emit({ at: T, kind: 'change', priority: 3, beep: beeps ? 'go' : null, segIndex: n.idx, ...chosen });
      changeDur.set(tr.k, c.dur);
    } else if (chosen.text) {
      // mismo ritmo en la cinta: solo informa (sin pitidos)
      const at = placer.find(T, T, T + 4, durOf(chosen.text), 2);
      if (at != null) {
        const c = emit({ at, kind: 'change', priority: 2, segIndex: n.idx, ...chosen });
        changeDur.set(tr.k, c.dur + (at - T));
      }
    }
  }

  /* 4 · Inicio y final */
  const first = segs[0];
  const introRoom = (fixedTimes.find((x) => x > 0) ?? total) - GAP;
  const startVars = { zone: first.zone, speed: first.speed, dur: first.sec, stage: first.stage || '' };
  let intro = null;
  if (chatty) {
    const title = String(workout?.title || '').trim();
    const iv = { title, min: Math.round(total / 60), speed: first.speed, name: withName(0.6) };
    for (let tries = 0; tries < 4; tries++) {
      const c = compose([isTest ? say('testIntro', iv) : title ? say('intro', iv, { require: ['title'] }) : null]);
      if (c.text && (!intro || durOf(c.text) < durOf(intro.text))) intro = c;
      if (intro && durOf(intro.text) <= introRoom) break;
    }
  }
  if (!intro || !intro.text || durOf(intro.text) > introRoom) {
    intro = compose([say(changeCategory(null, first), startVars, { require: ['speed'] })]);
  }
  const introCue = emit({ at: 0, kind: 'intro', priority: 3, segIndex: first.idx, ...intro });
  changeDur.set(0, introCue.dur);
  emit({ at: total, kind: 'finish', priority: 3, segIndex: segs[segs.length - 1].idx, ...compose([say('finish', { name: withName(0.6) })]) });

  if (chatty) {
    const place = (kind, priority, pref, lo, hi, build, segIndex, { timed = false, space = 0 } = {}) => {
      const draft = build(pref);
      if (!draft?.text) return null;
      const at = placer.find(pref, lo, hi, durOf(draft.text), priority, space);
      if (at == null) return null;
      const fin = timed && Math.abs(at - pref) > 0.01 ? build(at, draft) : draft;
      return emit({ at, kind, priority, segIndex, text: fin.text, clips: fin.clips, phraseIds: fin.phraseIds });
    };
    const simple = (cat, vars = {}, opts) => () => compose([say(cat, vars, opts)]);
    const segEnd = (k) => starts[k] + segs[k].sec;
    const lastIdx = segs.length - 1;

    /* 5 · Últimos 10 s (sprints) y últimos 30 s (intensos ≥ 60 s) */
    segs.forEach((s, k) => {
      if (k === lastIdx) return;
      if (s.zone === 'sprint' && s.sec >= 30) {
        place('last10', 2, segEnd(k) - 10, segEnd(k) - 10.5, segEnd(k) - 9, simple('last10'), s.idx);
      }
      // en el test los escalones son de 1′: bastan el cambio y los últimos 10 s
      if (!(isTest && s.stage > 0) && ((HARD.has(s.zone) && s.sec >= 60) || (s.zone === 'run' && s.sec >= 180))) {
        place('last30', 2, segEnd(k) - 30, segEnd(k) - 31, segEnd(k) - 28, simple('last30'), s.idx);
      }
    });

    /* 6 · Último bloque */
    const lb = lastBlockIndex(segs, isTest);
    if (lb > 0) {
      const T = starts[lb];
      const pref = T + (changeDur.get(lb) || 4) + 1;
      const hi = T + Math.max(0, Math.min(30, segs[lb].sec - lead - 6));
      place('lastBlock', 2, pref, pref, Math.max(pref, hi), simple('lastBlock', { name: withName(0.35) }), segs[lb].idx);
    }

    /* 7 · Mitad del entrenamiento */
    if (!isTest && total >= 600) {
      place('halfWorkout', 2, total / 2, total / 2 - 30, total / 2 + 30, simple('halfWorkout', { name: withName(0.35) }), segs[segAt(total / 2)].idx);
    }

    /* 8 · Consejo propio del segmento (modo coach) */
    if (mode === 'coach') {
      segs.forEach((s, k) => {
        if (!s.cue) return;
        const pref = starts[k] + (changeDur.get(k) || 0) + 0.8;
        const hi = Math.min(pref + 12, segEnd(k) - 4);
        place('segCue', 2, pref, pref, Math.max(pref, hi), () => ({ text: s.cue, clips: null, phraseIds: [] }), s.idx);
      });
    }

    /* 9 · Mitad de segmentos largos */
    segs.forEach((s, k) => {
      if (s.sec < 180 || s.zone === 'warmup' || s.zone === 'cooldown') return;
      const mid = starts[k] + s.sec / 2;
      // el texto dice lo que queda desde el instante final del aviso (misma plantilla si se desplaza)
      const build = (at, draft) => {
        const vars = { dur: Math.max(5, Math.round((segEnd(k) - at) / 5) * 5) };
        const part = draft ? { ...draft.part, vars, text: fill(draft.part.template, vars) } : say('halfSegment', vars);
        return part ? { ...compose([part]), part } : null;
      };
      place('halfSegment', 2, mid, mid - 8, mid + 8, build, s.idx, { timed: true });
    });

    /* 10 · Hidratación (sesiones ≥ 45′) */
    if (total >= 45 * 60 - 30) {
      for (let t = 900; t < total - 300; t += 900) {
        place('hydration', 2, t, t - 150, t + 150, simple('hydration'), segs[segAt(t)].idx, { space: 12 });
      }
    }

    /* 11 · Calentamiento: un consejo tranquilo */
    if (first.zone === 'warmup') {
      const pref = introCue.dur + 12;
      const hi = Math.min(starts[1] ?? total, total) - lead - 4;
      if (hi > pref) place('warmup', 1, pref, pref, hi, simple('warmup', {}), first.idx);
    }

    /* 12 · Motivación en tramos duros (coach) */
    if (mode === 'coach') {
      segs.forEach((s, k) => {
        if (!HARD.has(s.zone) || s.sec < 45 || k === 0) return;
        const mid = starts[k] + s.sec * 0.5;
        place('motivation', 1, mid, mid - s.sec * 0.2, mid + s.sec * 0.2, simple('motivation.hard', { name: withName(0.3) }), s.idx);
      });
    }

    /* 13 · Consejos periódicos (normal ≈ 3–4 min · coach ≈ 2 min + motivación) */
    const notes = (Array.isArray(workout?.coachNotes) ? workout.coachNotes : [])
      .filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
      .slice(0, mode === 'coach' ? 2 : 1);
    const period = mode === 'coach' ? 120 : 210;
    const spread = mode === 'coach' ? 20 : 30;
    let lastCat = '';
    const tipCat = (zone) => {
      let opts;
      if (zone === 'cooldown') opts = ['cooldown', 'tips.breath'];
      else if (zone === 'warmup') opts = ['warmup', 'tips.form'];
      else if (HARD.has(zone)) opts = mode === 'coach' ? ['motivation.hard', 'tips.breath', 'motivation.hard', 'tips.mind'] : ['tips.breath', 'tips.mind'];
      else opts = mode === 'coach' ? ['tips.form', 'motivation.general', 'tips.mind', 'tips.breath', 'motivation.general'] : ['tips.form', 'tips.mind', 'tips.breath'];
      let c = opts[rng.int(0, opts.length - 1)];
      if (c === lastCat && opts.length > 1) c = opts[(opts.indexOf(c) + 1) % opts.length];
      return c;
    };
    for (let target = Math.min(90, period * 0.6); target < total - 40; target += period + rng.int(-spread, spread)) {
      const zone = segs[segAt(target)].zone;
      if (mode === 'normal' && zone === 'sprint') continue;
      const lo = Math.max(20, target - 45);
      const hi = Math.min(total - 25, target + 45);
      if (hi < lo) continue;
      if (notes.length) {
        const note = notes[0];
        const c = place('tip', 1, target, lo, hi, () => ({ text: note, clips: null, phraseIds: [] }), segs[segAt(target)].idx);
        if (c) { notes.shift(); continue; }
      }
      const cat = tipCat(zone);
      const c = place(cat.startsWith('motivation') ? 'motivation' : 'tip', 1, target, lo, hi, simple(cat, { name: withName(0.25) }), segs[segAt(target)].idx);
      if (c) lastCat = cat;
    }
  }

  cues.sort((a, b) => a.at - b.at || b.priority - a.priority);
  return cues;
}

/**
 * Índice del segmento que abre el "último bloque" (o −1). Si hay series, el aviso lo da "Última serie".
 */
function lastBlockIndex(segs, isTest) {
  if (isTest) return -1;
  let a = 0;
  while (a < segs.length && segs[a].zone === 'warmup') a++;
  // El trote final del calentamiento (mismo bloque que el calentamiento) no es parte del bloque principal
  const warmBlock = a > 0 ? segs[a - 1].block : null;
  while (warmBlock && a < segs.length && segs[a].block === warmBlock) a++;
  let b = segs.length - 1;
  while (b >= 0 && segs[b].zone === 'cooldown') b--;
  const coolBlock = b < segs.length - 1 ? segs[b + 1].block : null;
  while (coolBlock && b >= 0 && segs[b].block === coolBlock) b--;
  if (b - a < 2) return -1;
  const main = segs.slice(a, b + 1);
  if (main.some((s) => s.rep && s.rep.n > 1)) return -1;
  const total = segs.reduce((acc, s) => acc + s.sec, 0);
  const startOf = (k) => segs.slice(0, k).reduce((acc, s) => acc + s.sec, 0);
  // "Último bloque" solo tiene sentido en la segunda mitad de la clase
  const ok = (k) => (k >= 0 && startOf(k) >= total * 0.45 ? k : -1);
  const labels = new Set(main.map((s) => s.block).filter(Boolean));
  if (labels.size >= 2) {
    let k = b;
    while (k > a && segs[k - 1].block === segs[b].block) k--;
    return segs[k].block ? ok(k) : -1;
  }
  const hard = [];
  for (let k = a; k <= b; k++) if (HARD.has(segs[k].zone) || segs[k].zone === 'run') hard.push(k);
  return hard.length >= 3 ? ok(hard[hard.length - 1]) : -1;
}

/* ═════════════════ Pack grabado (Eva Dorado) ═════════════════ */

/** Ids del guion presentes en el pack ({ available } o { clips }); null si no hay ninguno. */
function packAvailability(pack) {
  const src = pack?.available ?? pack?.clips;
  if (!src || typeof src[Symbol.iterator] !== 'function' || typeof src === 'string') return null;
  const out = new Set();
  for (const id of src) if (PACK_IDS.has(id)) out.add(id);
  return out.size ? out : null;
}

/**
 * Elector de variantes con semilla. Nunca repite la variante del aviso anterior ni del siguiente (en el tiempo)
 * del mismo grupo, prefiere las menos usadas y limita consejos/motivación/música a TIP_MAX_USES usos por sesión
 * (devuelve null ⇒ el aviso no se compone). setAt(t) fija el momento del aviso que se compone; el uso se apunta
 * con commit() solo cuando el aviso se programa de verdad.
 */
function createPicker(rng) {
  const usage = new Map(); // grupo → { counts: Map<id, n>, seq: [{ at, id }] ordenado por at }
  let at = Infinity;
  const near = (u, t) => {
    const out = { prev: null, next: null };
    for (const e of u.seq) {
      if (e.at <= t) out.prev = e.id;
      else { out.next = e.id; break; }
    }
    return out;
  };
  const allowed = (ids) => {
    const g = groupOf(ids[0]);
    const u = usage.get(g);
    if (!u) return ids;
    const { prev, next } = near(u, at);
    if (TIP_GROUPS.has(g)) return ids.filter((id) => (u.counts.get(id) || 0) < TIP_MAX_USES && id !== prev && id !== next);
    let c = ids.filter((id) => id !== prev && id !== next);
    if (!c.length) c = ids.filter((id) => id !== prev);
    return c.length ? c : ids;
  };
  const pickFn = (ids) => {
    if (!ids || !ids.length) return null;
    let cands = allowed(ids);
    if (!cands.length) return null;
    const u = usage.get(groupOf(ids[0]));
    if (u) {
      const min = Math.min(...cands.map((id) => u.counts.get(id) || 0));
      cands = cands.filter((id) => (u.counts.get(id) || 0) === min);
    }
    return cands[rng.int(0, cands.length - 1)];
  };
  // variante más corta (para avisos con poco hueco), con las mismas reglas
  const shortest = (ids) => {
    const c = ids && ids.length ? allowed(ids) : [];
    return c.length ? c.reduce((a, b) => (estimateClipSec(b) < estimateClipSec(a) ? b : a)) : null;
  };
  const commit = (ids, t = at) => {
    for (const id of ids || []) {
      const g = groupOf(id);
      let u = usage.get(g);
      if (!u) usage.set(g, (u = { counts: new Map(), seq: [] }));
      u.counts.set(id, (u.counts.get(id) || 0) + 1);
      let k = u.seq.length;
      while (k > 0 && u.seq[k - 1].at > t) k--;
      u.seq.splice(k, 0, { at: t, id });
    }
  };
  // ¿algún consejo coincide con el del aviso vecino si se coloca en t?
  const clashes = (ids, t) => (ids || []).some((id) => {
    const u = usage.get(groupOf(id));
    if (!u || !TIP_GROUPS.has(groupOf(id))) return false;
    const { prev, next } = near(u, t);
    return id === prev || id === next;
  });
  const setAt = (t) => { at = Number.isFinite(t) ? t : Infinity; };
  return { pick: pickFn, shortest, commit, clashes, setAt };
}

/**
 * Texto de una secuencia de clips (subtítulos y voz del sistema si el pack falla): como clipsText, pero el
 * número que sigue a una portadora va en minúscula ("Pon la cinta a siete coma uno.").
 */
function packText(ids) {
  const out = [];
  let carrier = false;
  for (const id of ids || []) {
    const c = PACK_CLIPS.get(id);
    if (!c) continue;
    const t = carrier ? c.text.charAt(0).toLowerCase() + c.text.slice(1) : c.text;
    out.push(c.kind === 'carrier' ? t.replace(/…$/, '') : t);
    carrier = c.kind === 'carrier';
  }
  return out.join(' ').replace(/\s+/g, ' ').trim() || clipsText(ids || []);
}

/** Clip de serie para un tramo con series ("Serie tres." / "¡Última serie!"), si está grabado. */
function repClip(rep, avail) {
  if (!rep || rep.n <= 1) return null;
  const id = rep.i >= rep.n ? 'rep_last' : `rep_${rep.i}`;
  return avail.has(id) ? id : null;
}

/**
 * Programa compuesto con el pack grabado. Mismas reglas de tiempo que el de voz del sistema (pre-aviso a
 * T − lead, pitidos, huecos, espaciado de prioridad 1) pero con duraciones de clip (decodificadas si se conocen,
 * si no ≈ 0,075 s por carácter). `base` es el programa de voz del sistema: de él salen, enteros, los cambios de
 * tramo que el pack no puede decir (velocidad fuera de 6,0–15,5, inclinación, clips que faltan).
 */
function buildPackSchedule(workout, opts, base, avail) {
  const { chattiness = 'normal', announceLead = 10, seed = 1, beeps = true, pack = null, watch = false, music = false } = opts || {};
  const segs = cleanSegments(workout);
  const mode = MODES.includes(chattiness) ? chattiness : 'normal';
  const chatty = mode !== 'minimal';
  const lead = clamp(Math.round(toNumber(announceLead) || 10), 3, 30);
  const rng = makeRng(hashStr(`${seed}|${mode}|pack`));
  const picker = createPicker(rng);
  const clipSec = typeof pack?.clipSec === 'function' ? pack.clipSec : null;
  const isTest = !!workout?.isTest || segs.some((s) => s.stage > 0);
  const category = String(opts?.category ?? workout?.category ?? '');
  const { starts, total } = startsOf(segs);
  const { trans, fixedTimes, nextFixedAfter } = transitionsOf(segs, starts, total, lead);
  const segAt = (t) => indexAt(starts, segs, t);
  const has = (id) => !!id && avail.has(id);
  const cc = (kind, vars = {}, pf = picker.pick) => composeCue(kind, vars, { pick: pf, available: avail });
  const seqSec = (ids) => ceil1(clipSequenceSec(ids, clipSec));
  const ttsSec = (text) => ceil1(estimateCueSec(text));
  const tts = (kind, segIndex) => {
    const b = base.find((c) => c.kind === kind && c.segIndex === segIndex && c.text);
    return b ? { text: b.text, clips: null, phraseIds: b.phraseIds || [] } : null;
  };
  const cues = [];
  const placer = createPlacer(total);
  const emit = (cue) => {
    const c = { beep: null, clips: null, phraseIds: [], text: '', ...cue, at: r1(cue.at) };
    if (c.clips) {
      c.text = packText(c.clips);
      c.voice = 'pack';
      c.dur = seqSec(c.clips);
      picker.commit(c.clips, c.at);
    } else if (c.text) {
      c.voice = 'tts';
      c.dur = ttsSec(c.text);
    } else {
      c.dur = 0;
    }
    cues.push(c);
    if (c.text) placer.add(c);
    return c;
  };
  // primera composición que quepa en `room` (s)
  const firstFit = (attempts, room) => {
    for (const make of attempts) {
      const ids = make();
      if (ids && seqSec(ids) <= room) return ids;
    }
    return null;
  };

  /* Pre-avisos (T − lead): "Serie tres. ¡Atención! Subimos a… once coma cinco." */
  const repSaid = new Set();
  for (const tr of trans) {
    if (!tr.hasPre) continue;
    const { p, n } = tr;
    const at = tr.T - lead;
    const beforeLast10 = chatty && p.zone === 'sprint' && p.sec >= 30 && lead - 10 > 3;
    const room = Math.max(1.5, (beforeLast10 ? lead - 10 : lead) - GAP - 0.1);
    let clips = null;
    picker.setAt(at);
    if (tr.speedCh && !tr.inclCh) {
      const vars = {
        speed: n.speed, dir: n.speed > p.speed ? 'up' : 'down',
        zone: isTest && n.stage > 0 ? 'stage' : n.zone,
        fromHard: HARD.has(p.zone), variant: rng.int(0, 1), rep: tr.repStart ? n.rep : null,
      };
      const bare = { ...vars, rep: null };
      clips = firstFit([
        () => cc('pre', vars), () => cc('pre', vars), () => cc('pre', bare), () => cc('pre', bare, picker.shortest),
      ], room);
    }
    const c = clips ? { clips } : tts('pre', n.idx);
    if (!c) continue;
    emit({ at, kind: 'pre', priority: 3, segIndex: n.idx, ...c });
    if (clips && clips.some((id) => id.startsWith('rep_'))) repSaid.add(tr.k);
  }

  /* Cambios (T) con pitidos T−3, T−2, T−1: "¡Ahora! Correr rápido. Once coma cinco. Dos minutos." */
  const cooldownStart = (n, withDur, pf) => {
    const c = cc('cooldown', {}, pf);
    const s = speedClip(n.speed);
    if (!c || !has(s)) return null;
    const d = withDur ? durationClip(n.sec) : null;
    return [...c, s, ...(has(d) ? [d] : [])];
  };
  const changeDur = new Map();
  for (const tr of trans) {
    const { p, n, T } = tr;
    const active = tr.speedCh || tr.inclCh;
    if (!active && !tr.zoneCh && !tr.repStart) continue;
    const room = nextFixedAfter(T) - T - GAP;
    let clips = null;
    picker.setAt(T);
    if (!tr.inclCh) {
      const stage = isTest && n.stage > 0;
      const rep = tr.repStart && !repSaid.has(tr.k) ? repClip(n.rep, avail) : null;
      const jogPick = (inner) => (ids) => {
        // "Trote. Recupera." solo tras un tramo duro; si no, "Ahora, trote suave."
        if (groupOf(ids[0]) === 'now_jog') {
          const want = HARD.has(p.zone) ? 'now_jog_1' : 'now_jog_2';
          if (ids.includes(want)) return want;
        }
        return inner(ids);
      };
      const build = (withDur, withRep, pf0 = picker.pick) => () => {
        const pf = jogPick(pf0);
        let ids = null;
        if (stage) ids = cc('testStage', { stage: n.stage, speed: n.speed }, pf);
        else {
          if (n.zone === 'cooldown' && p.zone !== 'cooldown') ids = cooldownStart(n, withDur, pf);
          if (!ids) ids = cc('now', { zone: n.zone, speed: n.speed, sec: withDur ? n.sec : 0, fromHard: !!(p && HARD.has(p.zone)) }, pf);
        }
        return ids && withRep && rep ? [rep, ...ids] : ids;
      };
      clips = firstFit([
        build(true, true), build(true, true), build(false, true), build(false, false), build(false, false, picker.shortest),
      ], room);
    }
    const c = clips ? { clips } : tts('change', n.idx);
    if (!c) continue;
    if (active) {
      if (beeps) {
        for (const d of [3, 2, 1]) {
          if (T - d > starts[tr.k - 1]) emit({ at: T - d, kind: 'tick', priority: 3, text: '', beep: 'tick', segIndex: n.idx });
        }
        placer.block(T - 3.3, T + 0.1);
      }
      const e = emit({ at: T, kind: 'change', priority: 3, beep: beeps ? 'go' : null, segIndex: n.idx, ...c });
      changeDur.set(tr.k, e.dur);
    } else {
      // mismo ritmo en la cinta: solo informa (sin pitidos)
      const at = placer.find(T, T, T + 4, c.clips ? seqSec(c.clips) : ttsSec(c.text), 2);
      if (at != null) {
        const e = emit({ at, kind: 'change', priority: 2, segIndex: n.idx, ...c });
        changeDur.set(tr.k, e.dur + (at - T));
      }
    }
  }

  /* Inicio: [Watch] + [clase] + "Pon la cinta a…" + velocidad; final */
  const first = segs[0];
  const introRoom = (fixedTimes.find((x) => x > 0) ?? total) - GAP;
  const cat = chatty ? (isTest ? 'test' : category) : '';
  picker.setAt(0);
  const introClips = firstFit([
    () => cc('intro', { speed: first.speed, category: cat, watch: !!watch }),
    () => cc('intro', { speed: first.speed, category: '', watch: !!watch }),
    () => cc('intro', { speed: first.speed, category: cat, watch: false }),
    () => cc('intro', { speed: first.speed, category: '', watch: false }),
  ], introRoom);
  const intro = introClips ? { clips: introClips } : tts('intro', first.idx);
  const introCue = intro ? emit({ at: 0, kind: 'intro', priority: 3, segIndex: first.idx, ...intro }) : null;
  changeDur.set(0, introCue?.dur || 0);
  picker.setAt(total);
  const fin = cc('finish');
  if (fin) emit({ at: total, kind: 'finish', priority: 3, segIndex: segs[segs.length - 1].idx, clips: fin });

  if (chatty) {
    const place = (kind, priority, pref, lo, hi, build, segIndex, { space = 0 } = {}) => {
      picker.setAt(pref);
      let ids = build();
      if (!ids) return null;
      const at = placer.find(pref, lo, hi, seqSec(ids), priority, space);
      if (at == null) return null;
      if (picker.clashes(ids, at)) {
        picker.setAt(at);
        ids = build();
        if (!ids || picker.clashes(ids, at) || !placer.fits(at, seqSec(ids), priority, space)) return null;
      }
      return emit({ at, kind, priority, segIndex, clips: ids });
    };
    const simple = (kind, vars = {}) => () => cc(kind, vars);
    const segEnd = (k) => starts[k] + segs[k].sec;
    const lastIdx = segs.length - 1;

    /* Últimos 10 s (sprints) y últimos 30 s (intensos ≥ 60 s) */
    segs.forEach((s, k) => {
      if (k === lastIdx) return;
      if (s.zone === 'sprint' && s.sec >= 30) {
        place('last10', 2, segEnd(k) - 10, segEnd(k) - 10.5, segEnd(k) - 9, simple('last10'), s.idx);
      }
      if (!(isTest && s.stage > 0) && ((HARD.has(s.zone) && s.sec >= 60) || (s.zone === 'run' && s.sec >= 180))) {
        place('last30', 2, segEnd(k) - 30, segEnd(k) - 31, segEnd(k) - 28, simple('last30'), s.idx);
      }
    });

    /* Último bloque */
    const lb = lastBlockIndex(segs, isTest);
    if (lb > 0) {
      const T = starts[lb];
      const pref = T + (changeDur.get(lb) || 4) + 1;
      const hi = T + Math.max(0, Math.min(30, segs[lb].sec - lead - 6));
      place('lastBlock', 2, pref, pref, Math.max(pref, hi), simple('lastBlock'), segs[lb].idx);
    }

    /* Mitad del entrenamiento */
    if (!isTest && total >= 600) {
      place('halfWorkout', 2, total / 2, total / 2 - 30, total / 2 + 30, simple('halfWorkout'), segs[segAt(total / 2)].idx);
    }

    /* Test: cómo terminar, tras el primer escalón */
    if (isTest) {
      const k = segs.findIndex((s) => s.stage > 0);
      if (k > 0) {
        const T = starts[k];
        const pref = T + (changeDur.get(k) || 3) + 1;
        place('testPrompt', 2, pref, pref, Math.max(pref, T + segs[k].sec - lead - 4), simple('testPrompt'), segs[k].idx);
      }
    }

    /* Mitad de segmentos largos */
    segs.forEach((s, k) => {
      if (s.sec < 180 || s.zone === 'warmup' || s.zone === 'cooldown') return;
      const mid = starts[k] + s.sec / 2;
      place('halfSegment', 2, mid, mid - 8, mid + 8, simple('halfSegment'), s.idx);
    });

    /* Hidratación (sesiones ≥ 45′) */
    if (total >= 45 * 60 - 30) {
      for (let t = 900; t < total - 300; t += 900) {
        place('hydration', 2, t, t - 150, t + 150, simple('hydration'), segs[segAt(t)].idx, { space: 12 });
      }
    }

    /* Calentamiento: un consejo tranquilo */
    if (first.zone === 'warmup') {
      const pref = (introCue?.dur || 0) + 12;
      const hi = Math.min(starts[1] ?? total, total) - lead - 4;
      if (hi > pref) place('warmup', 1, pref, pref, hi, () => cc('tip', { topic: 'breath' }) || cc('tip', { topic: 'form' }), first.idx);
    }

    /* Motivación en tramos duros (coach) */
    if (mode === 'coach') {
      segs.forEach((s, k) => {
        if (!HARD.has(s.zone) || s.sec < 45 || k === 0) return;
        const mid = starts[k] + s.sec * 0.5;
        place('motivation', 1, mid, mid - s.sec * 0.2, mid + s.sec * 0.2, simple('motivation', { hard: true }), s.idx);
      });
    }

    /* Consejos periódicos (normal ≈ 3–4 min · coach ≈ 2 min + motivación) */
    const period = mode === 'coach' ? 120 : 210;
    const spread = mode === 'coach' ? 20 : 30;
    const topicsFor = (k) => {
      const zone = segs[k].zone;
      if (zone === 'cooldown') return ['breath', 'good'];
      if (zone === 'warmup') return ['form', 'breath'];
      if (HARD.has(zone)) {
        const t = mode === 'coach' ? ['hard', 'breath', 'hard', 'mind'] : ['breath', 'mind'];
        return music ? [...t, 'energy'] : t;
      }
      const recovering = k > 0 && HARD.has(segs[k - 1].zone) && (zone === 'jog' || zone === 'walk');
      if (mode === 'coach' && recovering && segs.slice(k + 1).some((s) => HARD.has(s.zone))) return ['recover', 'breath', 'good'];
      const t = mode === 'coach' ? ['form', 'good', 'mind', 'breath', 'good'] : ['form', 'mind', 'breath'];
      return music && segs[k].sec >= 180 ? [...t, 'flow'] : t;
    };
    const tipIds = (topic) => {
      if (topic === 'hard' || topic === 'good') return cc('motivation', { hard: topic === 'hard' });
      if (topic === 'recover') return cc('recover');
      if (topic === 'energy' || topic === 'flow') return cc('music', { mood: topic });
      return cc('tip', { topic });
    };
    let lastTopic = '';
    for (let target = Math.min(90, period * 0.6); target < total - 40; target += period + rng.int(-spread, spread)) {
      const k = segAt(target);
      if (mode === 'normal' && segs[k].zone === 'sprint') continue;
      const lo = Math.max(20, target - 45);
      const hi = Math.min(total - 25, target + 45);
      if (hi < lo) continue;
      const opts2 = topicsFor(k);
      let i0 = rng.int(0, opts2.length - 1);
      if (opts2[i0] === lastTopic && opts2.length > 1) i0 = (i0 + 1) % opts2.length;
      const order = [...opts2.slice(i0), ...opts2.slice(0, i0)];
      let topic = '';
      const build = () => {
        for (const t of order) {
          const ids = tipIds(t);
          if (ids) { topic = t; return ids; }
        }
        return null;
      };
      const c = place('tip', 1, target, lo, hi, build, segs[k].idx);
      if (c) {
        if (topic === 'hard' || topic === 'good') c.kind = 'motivation';
        else if (topic === 'energy' || topic === 'flow') c.kind = 'music';
        lastTopic = topic;
      }
    }
  }

  cues.sort((a, b) => a.at - b.at || b.priority - a.priority);
  return cues;
}

/* ═════════════════ Coach en tiempo real ═════════════════ */

const nowMs = () => (globalThis.performance?.now ? performance.now() : Date.now());

function normalizeSettings(s = {}) {
  return {
    voiceEnabled: s.voiceEnabled !== false,
    beeps: s.beeps !== false,
    chattiness: MODES.includes(s.chattiness) ? s.chattiness : 'normal',
    rate: Number.isFinite(Number(s.rate)) ? Number(s.rate) : 1,
    pitch: Number.isFinite(Number(s.pitch)) ? Number(s.pitch) : 1,
    volume: Number.isFinite(Number(s.volume)) ? Number(s.volume) : 1,
    voiceURI: s.voiceURI || null,
    packId: s.packId || null,
    duckMusic: s.duckMusic !== false,
    name: String(s.name || '').trim(),
    announceLead: Number(s.announceLead) || 10,
    seed: s.seed,
    watchReminder: typeof s.watchReminder === 'boolean' ? s.watchReminder : null,
    music: typeof s.music === 'boolean' ? s.music
      : s.music && typeof s.music === 'object' ? s.music.enabled !== false && (s.music.mode || 'app') === 'app' : null,
    onCue: typeof s.onCue === 'function' ? s.onCue : null,
    // Voz del sistema como respaldo de los clips: sí en Safari, nunca en la app nativa (ver la cabecera)
    systemVoice: typeof s.systemVoice === 'boolean' ? s.systemVoice : !inNativeApp(),
  };
}

/** Recordatorio del Watch: el de los ajustes si viene; si no, el guardado (state.integrations, 'br.state.v1'). */
function watchReminderFrom(cfg) {
  if (typeof cfg.watchReminder === 'boolean') return cfg.watchReminder;
  try {
    const raw = globalThis.localStorage?.getItem?.('br.state.v1');
    const v = raw ? JSON.parse(raw)?.integrations?.watchReminder : undefined;
    if (typeof v === 'boolean') return v;
  } catch { /* sin almacenamiento */ }
  return true;
}

/** Pack grabado cargado y utilizable para packId (o null). */
function voicePackFor(packId) {
  if (!packId) return null;
  try {
    const info = packInfo();
    return info && info.voice && info.id === packId && info.count > 0 ? info : null;
  } catch {
    return null;
  }
}

// say(kind) con el pack: categoría del banco de frases → aviso componible
const PACK_SAY = {
  'motivation.hard': ['motivation', { hard: true }], 'motivation.general': ['motivation', { hard: false }],
  'tips.form': ['tip', { topic: 'form' }], 'tips.breath': ['tip', { topic: 'breath' }], 'tips.mind': ['tip', { topic: 'mind' }],
  hydration: ['hydration', {}], halfWorkout: ['halfWorkout', {}], lastBlock: ['lastBlock', {}], halfSegment: ['halfSegment', {}],
  last30: ['last30', {}], last10: ['last10', {}], cooldown: ['cooldown', {}], recover: ['recover', {}], watch: ['watch', {}],
  testPrompt: ['testPrompt', {}],
};

/**
 * Coach para una sesión. settings = state.audio + { name, announceLead } (+ opcionales: onCue(cue) para subtítulos,
 * watchReminder (si falta, el guardado en el estado), music: true si suena la música de la app). Si settings.packId
 * es un pack grabado, lo carga (o espera a que cargue) y rehace el programa con él.
 * update(t): dispara lo vencido (tolera saltos grandes) · seek(t): reposiciona sin hablar · say(kind, vars): avisos dinámicos.
 */
export function createCoach(workout, settings = {}) {
  let cfg = normalizeSettings(settings);
  try { applyAudioSettings(cfg); } catch { /* sin audio */ }
  const segs = cleanSegments(workout);
  const { starts } = startsOf(segs);
  const seed = cfg.seed != null && Number.isFinite(Number(cfg.seed))
    ? Number(cfg.seed)
    : hashStr(`${workout?.id || workout?.templateId || 'br'}|${workout?.seed ?? 1}|${todayKey()}`);
  // settings.pack = { available, clipSec } simula un pack ya cargado (pruebas)
  const injected = settings && settings.pack && typeof settings.pack === 'object' ? settings.pack : null;
  const watch = watchReminderFrom(cfg);
  let avail = null;          // ids del pack con los que se construyó el programa actual (null = voz del sistema)
  let packBroken = false;
  let packFails = 0;
  let packLoad = null;
  const packOpts = () => {
    if (packBroken) return null;
    if (injected) return injected;
    const info = voicePackFor(cfg.packId);
    return info ? { available: info.clips, clipSec: clipDuration } : null;
  };
  const build = () => {
    const pk = packOpts();
    avail = pk ? packAvailability(pk) : null;
    return buildCueSchedule(workout, {
      chattiness: cfg.chattiness, announceLead: cfg.announceLead, name: cfg.name, seed, beeps: true,
      pack: avail ? pk : null, watch, music: cfg.music === true, category: workout?.category,
    });
  };
  let cues = build();
  const rng = makeRng((seed ^ 0x9e3779b9) >>> 0);
  const picker = createPicker(makeRng((seed ^ 0x5bd1e995) >>> 0));
  const memory = new Map();
  const timers = new Set();
  let speakIdx = 0;
  let beepIdx = 0;
  let lastT = null;
  let muted = false;
  let destroyed = false;
  let queue = [];
  let current = null;
  let gen = 0;
  let finishSaid = false;
  let lastPreload = -Infinity;
  let lastWake = -Infinity;

  const canSpeak = () => !destroyed && !muted && cfg.voiceEnabled;
  const canBeep = () => !destroyed && !muted && cfg.beeps;
  const segAt = (t) => (segs.length ? segs[Math.max(0, indexAt(starts, segs, t))] : null);
  const segIdxAt = (t) => segAt(t)?.idx ?? -1;
  const ttsOpts = () => ({ rate: cfg.rate, pitch: cfg.pitch, volume: cfg.volume, voiceURI: cfg.voiceURI });
  // Voz del sistema solo si se permite (no en la app nativa): si no, el aviso se calla y la cola sigue
  const systemSay = (text) => (cfg.systemVoice ? speak(text, ttsOpts()) : Promise.resolve());
  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); if (!destroyed) fn(); }, ms);
    timers.add(id);
  };
  const notify = (item) => {
    if (!cfg.onCue) return;
    try { cfg.onCue({ at: lastT, kind: item.kind, priority: item.priority, text: item.text, clips: item.clips || null, beep: item.beep || null, segIndex: item.segIndex ?? segIdxAt(lastT ?? 0), voice: item.voice || null }); } catch { /* callback ajeno */ }
  };

  /* ───── pack grabado: carga, reconstrucción y degradación ───── */

  function preloadAhead(t) {
    const ids = [];
    for (let k = speakIdx; k < cues.length && cues[k].at < t + 60; k++) if (cues[k].clips) ids.push(...cues[k].clips);
    if (ids.length) { try { preloadClips(ids); } catch { /* nada */ } }
  }

  function rebuild() {
    if (destroyed) return;
    cues = build();
    if (lastT == null) {
      speakIdx = 0;
      beepIdx = 0;
    } else {
      // lo ya vencido no se repite (ni los pitidos ya programados con antelación)
      speakIdx = firstAfter(lastT);
      beepIdx = firstAfter(lastT + BEEP_LOOKAHEAD);
    }
    if (finishSaid) speakIdx = cues.length;
    lastPreload = -Infinity;
    if (avail) preloadAhead(lastT ?? 0);
  }

  function ensurePack() {
    if (injected || avail || packBroken || !cfg.packId || packLoad) return;
    const id = cfg.packId;
    try {
      packLoad = Promise.resolve(loadPack(id)).then((res) => {
        packLoad = null;
        if (!destroyed && cfg.packId === id && res?.ok && res.voice) rebuild();
      }, () => { packLoad = null; });
    } catch {
      packLoad = null;
    }
  }

  function packFailed() {
    packFails++;
    // Sin voz del sistema (app nativa) el pack nunca se da por roto: mejor reintentar los clips que callar la clase
    if (packFails >= PACK_FAILS_TO_TTS && avail && !packBroken && cfg.systemVoice) {
      packBroken = true; // el resto de la sesión, con la voz del sistema
      rebuild();
    }
  }

  async function deliver(item, g) {
    notify(item);
    if (!canSpeak()) return;
    if (item.voice === 'pack' && item.clips && item.clips.length) {
      try {
        if (item.countdown) await playCountdown(item.clips[0], item.countdown, { startedAt: item.startedAt });
        else await playClips(item.clips);
        packFails = 0;
        return;
      } catch {
        packFailed();
      }
      // el pack ha fallado: un cambio de tramo se dice entero con la voz del sistema; el resto se omite
      if (g === gen && SEGMENT_KINDS.has(item.kind) && item.text) await systemSay(item.text);
      return;
    }
    if (item.voice !== 'tts' && item.clips && item.clips.length && cfg.packId && hasClips(item.clips)) {
      try { await playClips(item.clips); return; } catch { /* sin clips: voz del sistema */ }
      if (g !== gen) return;
    }
    await systemSay(item.text);
  }

  /* ───── cola de voz ───── */

  function interruptCurrent() {
    if (!current) return;
    gen++;
    const c = current;
    current = null;
    try { stopClips(); } catch { /* nada */ }
    if (cfg.systemVoice) { try { cancelSpeech(); } catch { /* nada */ } }
    c.resolve?.();
  }

  function flushQueue() {
    const q = queue;
    queue = [];
    for (const it of q) it.resolve?.();
  }

  function nextItem() {
    queue.sort((a, b) => b.priority - a.priority || a.enq - b.enq);
    while (queue.length) {
      const it = queue.shift();
      const wait = (nowMs() - it.enq) / 1000;
      const stale = (it.priority <= 1 && wait > 2) || (it.priority === 2 && wait > 6) || (it.kind === 'pre' && wait > 3)
        || (it.kind === 'music' && wait > 1.5);
      if (stale) { it.resolve?.(); continue; }
      return it;
    }
    return null;
  }

  function pump() {
    if (current || destroyed) return;
    const it = nextItem();
    if (!it) return;
    current = it;
    const g = gen;
    Promise.resolve()
      .then(() => deliver(it, g))
      .catch(() => {})
      .then(() => {
        if (g !== gen) return; // interrumpida: ya hay otra en marcha
        current = null;
        it.resolve?.();
        pump();
      });
  }

  function nextSpokenWithin(sec) {
    if (lastT == null) return false;
    for (let k = speakIdx; k < cues.length; k++) {
      const c = cues[k];
      if (c.at - lastT > sec) return false;
      if (c.text) return true;
    }
    return false;
  }

  function enqueue(item) {
    return new Promise((resolve) => {
      item.resolve = resolve;
      item.enq = nowMs();
      if (!item.text || destroyed) { resolve(); return; }
      if (!canSpeak()) { notify(item); resolve(); return; }
      if (item.priority <= 1 && (current || queue.length || nextSpokenWithin(RUNTIME_LOW_SPACING))) { resolve(); return; }
      if (item.replace) queue = queue.filter((q) => (q.kind === item.kind ? (q.resolve?.(), false) : true));
      // la cuenta atrás grabada termina su "¡vamos!" antes de lo siguiente (salvo una pausa u otra cuenta atrás)
      const keep = current?.voice === 'pack' && current.kind === 'countdown' && item.kind !== 'pause' && item.kind !== 'countdown';
      if (current && !keep && (item.preempt || (item.priority >= 3 && current.priority < 3))) interruptCurrent();
      queue.push(item);
      pump();
    });
  }

  function fresh(c, late, isLastChange, curIdx) {
    switch (c.kind) {
      case 'change': return isLastChange && c.segIndex === curIdx && late <= 20;
      case 'pre': return late <= 3 && curIdx < c.segIndex;
      case 'intro': return late <= 8;
      case 'finish': return late <= 30 && !finishSaid;
      default:
        if (c.priority <= 1) return late <= 2;
        if (c.priority === 2) return late <= 5 && (c.segIndex == null || c.segIndex === curIdx || c.kind === 'halfWorkout');
        return late <= 3;
    }
  }

  function update(t) {
    if (destroyed || !Number.isFinite(t)) return;
    if (lastT != null && t < lastT - 0.75) { seek(t); return; }
    lastT = t;
    // Pitidos con antelación para clavarlos con el reloj del AudioContext
    while (beepIdx < cues.length && cues[beepIdx].at <= t + BEEP_LOOKAHEAD) {
      const c = cues[beepIdx++];
      if (!c.beep) continue;
      const delay = c.at - t;
      if (delay < -0.6 || !canBeep()) continue;
      try { beep(c.beep, { when: Math.max(0, delay) }); } catch { /* sin audio */ }
    }
    const due = [];
    while (speakIdx < cues.length && cues[speakIdx].at <= t) {
      const c = cues[speakIdx++];
      if (c.text) due.push(c);
    }
    if (due.length) {
      const curIdx = segIdxAt(t);
      let lastChange = -1;
      due.forEach((c, k) => { if (c.kind === 'change') lastChange = k; });
      due.forEach((c, k) => {
        if (!fresh(c, t - c.at, k === lastChange, curIdx)) return;
        if (c.kind === 'finish') finishSaid = true;
        enqueue({ kind: c.kind, priority: c.priority, text: c.text, clips: c.clips, voice: c.voice, beep: c.beep, segIndex: c.segIndex });
      });
    }
    // Despierta el audio antes de los pitidos y precarga los clips de los próximos avisos
    if (t - lastWake > 1) {
      const nb = cues.slice(beepIdx, beepIdx + 6).find((c) => c.beep);
      if (nb && nb.at - t < 2.5 && canBeep()) { lastWake = t; ensureAudioRunning().catch(() => {}); }
    }
    if ((cfg.packId || avail) && t - lastPreload > 5) {
      lastPreload = t;
      preloadAhead(t);
    }
  }

  function firstAfter(t) {
    let k = 0;
    while (k < cues.length && cues[k].at <= t) k++;
    return k;
  }

  function seek(t, { announce = false } = {}) {
    if (destroyed || !Number.isFinite(t)) return;
    lastT = t;
    speakIdx = beepIdx = firstAfter(t);
    flushQueue();
    interruptCurrent();
    try { cancelBeeps(); } catch { /* nada */ }
    if (announce) {
      const idx = segIdxAt(t);
      const c = cues.find((x) => x.kind === 'change' && x.segIndex === idx) || cues.find((x) => x.kind === 'intro' && x.segIndex === idx);
      if (c) enqueue({ kind: 'change', priority: 3, text: c.text, clips: c.clips, voice: c.voice, segIndex: idx });
    }
  }

  /* ───── avisos dinámicos ───── */

  function line(cat, vars, priority, opts = {}) {
    const p = pick(cat, rng, vars, { memory, require: opts.require || [] });
    if (!p.text) return null;
    return {
      kind: opts.kind || cat, priority, text: p.text, clips: clipIdsFor(p.id, p.template, vars),
      segIndex: segIdxAt(lastT ?? 0), preempt: !!opts.preempt, replace: !!opts.replace,
    };
  }
  const go = (item) => (item ? enqueue(item) : Promise.resolve());
  const maybeName = (p) => (cfg.name && rng.chance(p) ? cfg.name : '');
  const pc = (kind, vars = {}) => composeCue(kind, vars, { pick: picker.pick, available: avail });
  function packItem(kind, ids, priority, opts = {}) {
    if (!ids || !ids.length) return null;
    picker.commit(ids);
    return {
      kind, priority, text: packText(ids), clips: ids, voice: 'pack',
      segIndex: segIdxAt(lastT ?? 0), preempt: !!opts.preempt, replace: !!opts.replace,
    };
  }

  function ttsCountdown(n0, spoken, skipMs = 0, resolve = null) {
    for (let k = 0; k <= n0; k++) {
      const delay = k * 1000 - skipMs;
      if (delay < -150 && k < n0) continue;
      later(() => {
        const n = n0 - k;
        if (spoken) {
          const item = n > 0
            ? { kind: 'countdown', priority: 3, text: String(n), clips: [`n_${n}`], preempt: true }
            : line('countdownGo', {}, 3, { kind: 'countdown', preempt: true });
          go(item);
        }
        if (n === 0) resolve?.();
      }, Math.max(0, delay));
    }
  }

  /** Cuenta atrás grabada: un único aviso que coloca cada número en su segundo (o pitidos solos si no hay clip). */
  function countdownPack(n0) {
    const startedAt = nowMs();
    return new Promise((resolve) => {
      later(resolve, n0 * 1000);
      const start = () => {
        if (destroyed || !canSpeak()) return;
        if (avail) {
          const ids = composeCue('countdown', {}, { available: avail });
          if (ids) {
            enqueue({
              kind: 'countdown', priority: 3, preempt: true, voice: 'pack', clips: ids, text: packText(ids),
              countdown: n0, startedAt, segIndex: segIdxAt(lastT ?? 0),
            });
          }
          return;
        }
        ttsCountdown(n0, true, nowMs() - startedAt); // el pack no llegó: voz del sistema para lo que queda
      };
      if (avail || !packLoad) start();
      else Promise.race([packLoad, new Promise((r) => setTimeout(r, 900))]).then(start, start);
    });
  }

  function countdown(from, spoken = true) {
    const n0 = clamp(Math.round(toNumber(from)) || 3, 1, 10);
    if (spoken && (avail || packLoad)) return countdownPack(n0);
    return new Promise((resolve) => ttsCountdown(n0, spoken, 0, resolve));
  }

  function sayPack(kind, v, seg) {
    const speedOf = (x) => { const s = speedClip(toNumber(x)); return s && avail.has(s) ? s : null; };
    switch (kind) {
      case 'km': {
        const km = Math.round(toNumber(v.km));
        if (!Number.isFinite(km)) return Promise.resolve();
        try { preloadClips([`km_${km + 1}`]); } catch { /* nada */ }
        return go(packItem('km', pc('km', { km }), 2, { replace: true }));
      }
      case 'pause':
        flushQueue();
        interruptCurrent();
        try { cancelBeeps(); } catch { /* nada */ }
        return go(packItem('pause', pc('pause'), 3, { preempt: true }));
      case 'resume': {
        const r = pc('resume');
        const s = speedOf(v.speed ?? seg?.speed);
        return go(packItem('resume', r ? [...r, ...(s ? [s] : [])] : null, 3, { preempt: true }));
      }
      case 'adjust': {
        // "Once coma seis." confirma el ajuste
        const s = speedOf(v.speed);
        return go(packItem('adjust', s ? [s] : null, 2, { replace: true }));
      }
      case 'finish':
        if (finishSaid) return Promise.resolve(); // las cifras finales no están grabadas
        finishSaid = true;
        speakIdx = cues.length;
        // «¡Entrenamiento completado!» solo si de verdad se completó (el reproductor pasa `completed`)
        if (v.completed === false) return go(packItem('finish', pc('finishPartial'), 3, { preempt: true }));
        return go(packItem('finish', pc('finish'), 3, { preempt: true }));
      case 'testEnd':
        flushQueue();
        return go(packItem('testEnd', pc('testEnd'), 3, { preempt: true }));
      case 'testStage': {
        const ids = pc('testStage', { stage: Math.round(toNumber(v.stage ?? seg?.stage)), speed: toNumber(v.speed ?? seg?.speed) });
        if (ids) return go(packItem('testStage', ids, 3));
        const t = line('testStage', { stage: v.stage ?? seg?.stage ?? '', speed: v.speed ?? seg?.speed ?? '' }, 3, { require: ['speed'] });
        return go(t ? { ...t, clips: null, voice: 'tts' } : null);
      }
      case 'countdown':
        return countdown(v.n ?? 3, canSpeak());
      case 'music': {
        // comentario a ritmo del DJ: { mood: 'drop' | 'energy' | 'flow' }; solo vale en su momento
        const mood = ['drop', 'energy', 'flow'].includes(v.mood) ? v.mood : 'energy';
        return go(packItem('music', pc('music', { mood }), mood === 'drop' ? 2 : 1, { replace: true }));
      }
      case 'halfway':
        return cues.some((c) => c.kind === 'halfWorkout') ? Promise.resolve() : go(packItem('halfWorkout', pc('halfWorkout'), 2));
      case 'lastSegment':
        return cues.some((c) => c.kind === 'lastBlock') ? Promise.resolve() : go(packItem('lastBlock', pc('lastBlock'), 2));
      default: {
        const m = PACK_SAY[kind];
        return m ? go(packItem(kind, pc(m[0], m[1]), 2)) : Promise.resolve();
      }
    }
  }

  function say(kind, vars = {}) {
    if (destroyed) return Promise.resolve();
    const v = { ...(vars || {}) };
    const seg = segAt(lastT ?? 0);
    if (avail) return sayPack(kind, v, seg);
    switch (kind) {
      case 'km': {
        if (!Number.isFinite(toNumber(v.km))) return Promise.resolve();
        return go(line('km', { km: v.km, pace: v.pace ?? '' }, 2, { require: ['km'], replace: true }));
      }
      case 'pause':
        flushQueue();
        interruptCurrent();
        try { cancelBeeps(); } catch { /* nada */ }
        return go(line('pause', {}, 3, { preempt: true }));
      case 'resume':
        return go(line('resume', { speed: v.speed ?? seg?.speed ?? '' }, 3, { preempt: true }));
      case 'adjust':
        if (!Number.isFinite(toNumber(v.speed))) return Promise.resolve();
        return go(line('adjust', { speed: v.speed }, 2, { require: ['speed'], replace: true }));
      case 'finish': {
        const hasStats = Number.isFinite(toNumber(v.km)) && Number.isFinite(toNumber(v.min));
        const stats = hasStats ? { km: v.km, min: v.min } : {};
        if (finishSaid) return hasStats ? go(line('finishStats', stats, 3, { require: ['km', 'min'] })) : Promise.resolve();
        finishSaid = true;
        speakIdx = cues.length; // el final programado ya no hace falta
        const cat = v.completed === false ? 'finishPartial' : 'finish';
        return go(line(cat, { ...stats, name: maybeName(0.5) }, 3, { kind: 'finish', require: hasStats ? ['km', 'min'] : [], preempt: true }));
      }
      case 'testEnd': {
        flushQueue();
        const tv = { speed: v.speed ?? seg?.speed ?? '', stage: v.stage ?? '', vam: v.vam ?? '' };
        return go(line('testEnd', tv, 3, { preempt: true }));
      }
      case 'testStage':
        return go(line('testStage', { stage: v.stage ?? seg?.stage ?? '', speed: v.speed ?? seg?.speed ?? '' }, 3, { require: ['speed'] }));
      case 'countdown':
        // El reproductor pone los pitidos; aquí solo la voz ("tres, dos, uno, ¡ya!")
        return countdown(v.n ?? 3, canSpeak());
      case 'halfway':
        return cues.some((c) => c.kind === 'halfWorkout') ? Promise.resolve() : go(line('halfWorkout', { name: maybeName(0.3) }, 2));
      case 'lastSegment':
        return cues.some((c) => c.kind === 'lastBlock') ? Promise.resolve() : go(line('lastBlock', { name: maybeName(0.3) }, 2));
      default:
        return PHRASES[kind] ? go(line(kind, { name: maybeName(0.3), ...v }, 2)) : Promise.resolve();
    }
  }

  function setMuted(on) {
    muted = !!on;
    if (muted) {
      flushQueue();
      interruptCurrent();
      try { cancelBeeps(); } catch { /* nada */ }
    }
  }

  function updateSettings(partial = {}) {
    const prev = cfg;
    cfg = normalizeSettings({ ...cfg, ...partial, onCue: partial.onCue ?? cfg.onCue });
    try { applyAudioSettings(cfg); } catch { /* nada */ }
    if (!cfg.voiceEnabled) { flushQueue(); interruptCurrent(); }
    if (cfg.packId !== prev.packId && !injected) {
      packBroken = false;
      packFails = 0;
      rebuild();
      ensurePack();
    } else if ((cfg.music === true) !== (prev.music === true) && avail) {
      rebuild(); // comentarios de música solo mientras suena la de la app
    }
  }

  function destroy() {
    if (destroyed) return;
    flushQueue();
    interruptCurrent();
    try { cancelBeeps(); } catch { /* nada */ }
    destroyed = true;
    for (const id of timers) clearTimeout(id);
    timers.clear();
  }

  if (avail) preloadAhead(0);
  else ensurePack();

  return {
    update, seek, say, setMuted, destroy, updateSettings,
    get cues() { return cues; },
    get muted() { return muted; },
    /** 'pack' si el programa actual usa la voz grabada; 'tts' si usa la del sistema. */
    get voice() { return avail ? 'pack' : 'tts'; },
  };
}

/** Frase de prueba para Perfil → Voz y audio (con el pack grabado si está cargado). */
export function previewCoach(settings = {}, { speed = 11.5 } = {}) {
  const cfg = normalizeSettings(settings);
  try { applyAudioSettings(cfg); } catch { /* nada */ }
  const info = voicePackFor(cfg.packId);
  if (info) {
    // "¡Atención! Subimos a… once coma cinco." + "¡Ahora! Correr rápido. Once coma cinco. Dos minutos."
    const pk = createPicker(makeRng(Date.now() >>> 0));
    const opt = { pick: pk.pick, available: info.clips };
    const a = composeCue('pre', { speed, dir: 'up', zone: 'fast' }, opt);
    const b = composeCue('now', { zone: 'fast', speed, sec: 120 }, opt);
    const ids = a && b ? [...a, ...b] : a || b;
    if (ids) {
      const said = packText(ids);
      return playClips(ids).catch(() => speak(said, { rate: cfg.rate, pitch: cfg.pitch, volume: cfg.volume, voiceURI: cfg.voiceURI, interrupt: true }));
    }
  } else if (cfg.packId) {
    try { Promise.resolve(loadPack(cfg.packId)).catch(() => {}); } catch { /* para la próxima prueba */ }
  }
  const rng = makeRng(Date.now() >>> 0);
  const memory = new Map();
  const a = pick('preview', rng, { name: cfg.name }, { memory });
  const vars = { lead: Number(settings.announceLead) || 10, speed };
  const b = pick('speedUp', rng, vars, { memory, require: ['lead', 'speed'] });
  const text = `${a.text} ${b.text}`.trim();
  const c1 = clipIdsFor(a.id, a.template, { name: cfg.name });
  const c2 = clipIdsFor(b.id, b.template, vars);
  const clips = c1 && c2 ? [...c1, ...c2] : null;
  if (clips && cfg.packId && hasClips(clips)) {
    return playClips(clips).catch(() => speak(text, { ...cfg, interrupt: true }));
  }
  return speak(text, { rate: cfg.rate, pitch: cfg.pitch, volume: cfg.volume, voiceURI: cfg.voiceURI, interrupt: true });
}
