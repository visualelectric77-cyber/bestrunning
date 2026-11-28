#!/usr/bin/env node
// RITMUP · música de las AMRAP: node tools/test-music-amrap.mjs   (sin DOM; sale con código ≠ 0 si algo falla)
//   1 · Selección (music-plan.js): en los bloques AMRAP, pistas de energía alta y del estilo que le gusta (dark techno
//       melódico, trance oscuro), entrando por su drop, sin repetir entre bloques de la misma clase y con la rotación
//       de siempre entre sesiones.
//   2 · Reacción en directo (music.js, amrap()): el motor de la clase de verdad (js/player/engine.js, reloj manual) y un
//       WebAudio simulado que evalúa las automatizaciones. En la recuperación la música se retira (paso bajo y algo de
//       volumen, nunca muda), en el trabajo se abre en el pulso tras la subida (riser), los últimos 30 s van a tope y
//       al acabar el tope golpea y vuelve a neutro. Sin saltos de volumen, la voz por encima y versión sencilla.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES } from '../js/training/templates.js';
import { buildWorkout } from '../js/training/generator.js';
import { createEngine } from '../js/player/engine.js';
import { buildMusicPlan, trackGrid, amrapMusicZone, isDarkStyle } from '../js/audio/music-plan.js';
import { AMRAP_MIX as AM } from '../js/audio/music.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = JSON.parse(readFileSync(join(ROOT, 'audio/music/library.json'), 'utf8')).tracks;
const BY_ID = new Map(LIB.map((t) => [t.id, t]));
const LEVELS = { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 };
const TREADMILL = { hasIncline: true, maxIncline: 12, minSpeed: 1, maxSpeed: 18, announceLead: 10 };
const AMRAP_IDS = TEMPLATES.filter((t) => t.family === 'amrap').map((t) => t.id);

let checks = 0;
const failures = [];
const ok = (cond, msg) => { checks++; if (!cond) failures.push(msg); return !!cond; };
const out = (s) => process.stdout.write(`${s}\n`);
const section = (t) => out(`\n▸ ${t}`);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const segStarts = (w) => { const s = []; let a = 0; for (const g of w.segments) { s.push(a); a += g.sec; } return s; };

/* ═════════════ 1 · Selección ═════════════ */

section('Selección: bloques AMRAP con pistas de energía y de su estilo');
ok(AMRAP_IDS.length >= 8, `plantillas AMRAP (${AMRAP_IDS.length})`);
const amrapIds = [];
const baseIds = [];
let blocks = 0;
let multi = 0;
for (const id of AMRAP_IDS) {
  for (const minutes of [20, 30, 45, 60]) {
    for (const seed of [1, 2, 3, 7]) {
      const w = buildWorkout(id, { minutes, levels: LEVELS, seed, hasIncline: true, treadmill: TREADMILL });
      if (!ok(!!w, `${id} ${minutes}′ se construye`)) continue;
      const label = `${id}·${minutes}′·s${seed}`;
      const plan = buildMusicPlan(w, LIB, { seed, recent: false });
      ok(JSON.stringify(plan) === JSON.stringify(buildMusicPlan(w, LIB, { seed, recent: false })), `${label}: determinista`);
      // la misma clase sin la marca AMRAP (mismo tramo musical): la referencia para comparar lo elegido
      const plain = { ...w, segments: w.segments.map((g) => (g.amrap ? { ...g, amrap: undefined, zone: amrapMusicZone(g) } : g)) };
      const ref = buildMusicPlan(plain, LIB, { seed, recent: false });
      const starts = segStarts(w);
      const byBlock = new Map();
      w.segments.forEach((g, i) => {
        if (!g.amrap) return;
        blocks++;
        const own = plan.cues.filter((c) => c.segIndex === i);
        const first = own.find((c) => c.kind === 'segment');
        ok(own.length && own.every((c) => c.amrap === true && c.zone === amrapMusicZone(g)), `${label} s${i}: cues AMRAP marcados y en su tramo musical`);
        ok(first && Math.abs(first.atSec - starts[i]) < 1e-3, `${label} s${i}: cue al empezar el bloque`);
        ok(first?.change === 'track' && first.entry !== 'resume', `${label} s${i}: el bloque empieza con pista nueva (${first?.change}/${first?.entry})`);
        if (first && trackGrid(BY_ID.get(first.trackId)).alignPoints.length) {
          ok(first.entry === 'drop' || first.entry === 'hot', `${label} s${i}: entra por su drop (${first.entry})`);
        }
        const ids = [...new Set(own.filter((c) => c.change === 'track').map((c) => c.trackId))];
        byBlock.set(i, ids);
        amrapIds.push(...ids);
        baseIds.push(...new Set(ref.cues.filter((c) => c.segIndex === i && c.change === 'track').map((c) => c.trackId)));
      });
      // sin repetir entre bloques de la misma clase
      const lists = [...byBlock.values()];
      if (lists.length > 1) {
        multi++;
        const seen = new Set();
        let rep = 0;
        for (const l of lists) { for (const t of l) if (seen.has(t)) rep++; for (const t of l) seen.add(t); }
        ok(rep === 0, `${label}: ninguna pista se repite entre bloques AMRAP (${rep})`);
      }
    }
  }
}
const eOf = (ids) => mean(ids.map((id) => trackGrid(BY_ID.get(id)).meanEnergy));
const darkOf = (ids) => ids.filter((id) => isDarkStyle(BY_ID.get(id))).length / Math.max(1, ids.length);
const dropsOf = (ids) => ids.filter((id) => trackGrid(BY_ID.get(id)).hasDrops).length / Math.max(1, ids.length);
out(`  ${blocks} bloques (${multi} clases con varios) · energía ${eOf(amrapIds).toFixed(3)} (sin marca ${eOf(baseIds).toFixed(3)}) · estilo ${(100 * darkOf(amrapIds)).toFixed(0)} % (${(100 * darkOf(baseIds)).toFixed(0)} %) · con drops ${(100 * dropsOf(amrapIds)).toFixed(0)} % (${(100 * dropsOf(baseIds)).toFixed(0)} %)`);
ok(blocks >= 100 && multi >= 16, `bloques revisados (${blocks}, ${multi} con varios)`);
ok(eOf(amrapIds) > eOf(baseIds), 'más energía media que sin la marca AMRAP');
ok(darkOf(amrapIds) >= darkOf(baseIds) && darkOf(amrapIds) >= 0.7, `sobre todo dark techno / trance oscuro (${(100 * darkOf(amrapIds)).toFixed(0)} %)`);
ok(dropsOf(amrapIds) >= 0.85, `casi todas con drop (${(100 * dropsOf(amrapIds)).toFixed(0)} %)`);

section('Selección: rotación entre sesiones, pistas desactivadas y música propia');
{
  const w = buildWorkout('amrap-double', { minutes: 45, levels: LEVELS, seed: 3, treadmill: TREADMILL });
  const p1 = buildMusicPlan(w, LIB, { seed: 3, recent: false });
  const am1 = new Set(p1.cues.filter((c) => c.amrap && c.change === 'track').map((c) => c.trackId));
  const p2 = buildMusicPlan(w, LIB, { seed: 3, recent: [[...p1.trackIds]] });
  const am2 = p2.cues.filter((c) => c.amrap && c.change === 'track').map((c) => c.trackId);
  const again = am2.filter((id) => am1.has(id));
  ok(am2.length >= 2 && again.length === 0, `la sesión siguiente no repite las de la AMRAP anterior (${again.join(', ') || 'ninguna'})`);
  // pistas desactivadas (music.disabled: la biblioteca llega sin ellas) y una biblioteca solo con música propia
  const off = new Set([...am1].slice(0, 3));
  const p3 = buildMusicPlan(w, LIB.filter((t) => !off.has(t.id)), { seed: 3, recent: false });
  ok(!p3.cues.some((c) => off.has(c.trackId)) && p3.cues.some((c) => c.amrap), 'sin las pistas desactivadas');
  const mine = LIB.filter((t) => t.curatedTier === 'jog' || t.curatedTier === 'run').slice(0, 10).map((t) => ({ ...t, id: `user-${t.id}`, user: true }));
  const p4 = buildMusicPlan(w, mine, { seed: 3, recent: false });
  ok(p4.cues.length >= w.segments.length && p4.cues.every((c) => c.trackId.startsWith('user-')), 'con solo música propia, también hay plan (con lo que hay)');
}

/* ═════════════ 2 · Reacción en directo ═════════════ */

// WebAudio simulado: AudioParam con automatización evaluable (setValue/lineal/exponencial/objetivo/cancelar)
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

function makeCtx() {
  const ctx = {
    t: 5, state: 'running', sampleRate: 8000, baseLatency: 0, nodes: [], oscs: [], srcs: [],
    get currentTime() { return this.t; },
    resume() { return Promise.resolve(); },
    suspend() { return Promise.resolve(); },
    addEventListener() {}, removeEventListener() {},
  };
  class Node { constructor(kind) { this.kind = kind; this.outs = new Set(); ctx.nodes.push(this); } connect(n) { this.outs.add(n); return n; } disconnect() { this.outs.clear(); } }
  ctx.destination = new Node('dest');
  ctx.createGain = () => { const n = new Node('gain'); n.gain = new Param(ctx, 1); return n; };
  ctx.createBiquadFilter = () => { const n = new Node('biquad'); n.type = 'lowpass'; n.frequency = new Param(ctx, 350); n.Q = new Param(ctx, 1); n.gain = new Param(ctx, 0); return n; };
  ctx.createDelay = () => { const n = new Node('delay'); n.delayTime = new Param(ctx, 0); return n; };
  ctx.createDynamicsCompressor = () => { const n = new Node('comp'); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(ctx, 0); return n; };
  ctx.createAnalyser = () => new Node('analyser');
  ctx.createOscillator = () => {
    const n = new Node('osc');
    n.type = 'sine';
    n.frequency = new Param(ctx, 440);
    n.start = (w) => { n.when = w; ctx.oscs.push(n); };
    n.stop = (w) => { n.stopAt = w; };
    return n;
  };
  ctx.createBufferSource = () => {
    const n = new Node('src');
    n.playbackRate = new Param(ctx, 1);
    n.start = (w, off) => { n.when = w; n.off = off; ctx.srcs.push(n); };
    n.stop = (w) => { n.stopAt = w; };
    return n;
  };
  const fakeBuf = (len, sr) => ({
    length: len, sampleRate: sr, duration: len / sr, numberOfChannels: 1,
    getChannelData: () => ({ subarray: () => new Float32Array(1), [0]: 0 }), copyToChannel() {},
  });
  ctx.createBuffer = (ch, len, sr) => (len < 64 * sr ? { length: len, sampleRate: sr, duration: len / sr, numberOfChannels: ch, getChannelData: () => new Float32Array(len) } : fakeBuf(len, sr));
  ctx.decodeAudioData = (arr, okCb, errCb) => {
    const id = new TextDecoder().decode(new Uint8Array(arr));
    if (id.startsWith('sfx:')) {
      // efecto grabado simulado: 40 ms de relleno (como el AAC) y su forma (golpe/campana: ataque; riser: crece hasta el final)
      const name = id.slice(4);
      const dur = { campana: 1.3, golpe: 1.6, riser: 3.2 }[name];
      if (!dur) { const e = new Error('EncodingError'); errCb?.(e); return Promise.reject(e); }
      const len = Math.round((dur + 0.04) * ctx.sampleRate);
      const data = new Float32Array(len);
      const pad = Math.round(0.04 * ctx.sampleRate);
      for (let i = pad; i < len; i++) {
        const x = (i - pad) / (len - pad);
        data[i] = (name === 'riser' ? 0.02 + 0.6 * x ** 3 : 0.7 * (1 - x) ** 2) * (i % 2 ? 1 : -1);
      }
      const b = { length: len, sampleRate: ctx.sampleRate, duration: len / ctx.sampleRate, numberOfChannels: 1, getChannelData: () => data, sfxName: name };
      okCb?.(b);
      return Promise.resolve(b);
    }
    const t = BY_ID.get(id);
    const b = fakeBuf(Math.round((t?.duration || 200) * ctx.sampleRate), ctx.sampleRate);
    okCb?.(b);
    return Promise.resolve(b);
  };
  return ctx;
}

// riser = oscilador en sierra; golpe = oscilador senoidal (bombo sub). Instantes en s de clase.
const risers = (ctx, base) => ctx.oscs.filter((o) => o.type === 'sawtooth').map((o) => o.when - base);
const hits = (ctx, base) => ctx.oscs.filter((o) => o.type === 'sine').map((o) => o.when - base);

/**
 * Una AMRAP entera con el motor de la clase. opts: { lite, effects, adjustAt, pauseAt, skipAt, voiceAt, energy }.
 * Devuelve lo muestreado cada 50 ms: { T, phase, capLeft, lp, db, amOn } y los eventos.
 */
async function runAmrap(templateId = 'amrap-400', minutes = 20, opts = {}) {
  const { createMusicEngine } = await import('../js/audio/music.js');
  const w = buildWorkout(templateId, { minutes, levels: LEVELS, seed: 1, treadmill: TREADMILL });
  const plan = buildMusicPlan(w, LIB, { seed: 1, recent: false, prefs: { energy: opts.energy || 'normal' } });
  const ctx = makeCtx();
  const realOAC = globalThis.OfflineAudioContext;
  delete globalThis.OfflineAudioContext;
  const bus = new EventTarget();
  globalThis.addEventListener = bus.addEventListener.bind(bus);
  globalThis.removeEventListener = bus.removeEventListener.bind(bus);
  const music = createMusicEngine({
    context: ctx, now: () => ctx.t, loadData: async (t) => new TextEncoder().encode(t.id).buffer, decodeTimeoutMs: 60000,
    ...(opts.sfx ? { loadSfx: async (name) => { if (opts.sfx === 'roto') throw new Error('404'); return new TextEncoder().encode(`sfx:${name}`).buffer; } } : {}),
  });
  if (opts.lite) music.setAmrapOptions({ lite: true, lead: 10 });
  if (opts.effects === false) music.setEffects(false);
  await music.load(plan, new Map(LIB.map((t) => [t.id, t])));
  for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r));
  const events = [];
  let clockMs = 1e6;
  let engine = null;
  engine = createEngine(w, {
    now: () => clockMs, autoTick: false, treadmill: TREADMILL,
    onEvent: (type, d) => {
      if (type !== 'amrapPhase' && type !== 'amrapEnd') return;
      const s = engine.getState();
      events.push({ type, T: s.totalElapsed, d: { ...d } });
      music.amrapEvent(type, d, s.amrap);
    },
  });
  const ai = w.segments.findIndex((g) => g.amrap);
  const st = segStarts(w);
  const capStart = st[ai];
  const capEnd = capStart + w.segments[ai].sec;
  engine.start();
  music.start(0);
  const base0 = ctx.t;
  const samples = [];
  const step = 0.05;
  const from = capStart - 20;
  // salta (sin música) hasta 20 s antes del bloque
  for (let k = 0; k < 2000 && engine.getState().totalElapsed < from - 1; k++) {
    clockMs += 1000; ctx.t += 1; engine.tick();
    const s = engine.getState();
    music.update(s.totalElapsed, s);
    await new Promise((r) => setImmediate(r));
  }
  const fired = new Set();
  let ph = null;
  let ph0 = 0;
  for (let k = 0; k < (capEnd + 15 - from) / step; k++) {
    clockMs += step * 1000;
    ctx.t += step;
    engine.tick();
    const s = engine.getState();
    const T = s.totalElapsed;
    if (k % 5 === 0) { music.update(T, s); await new Promise((r) => setImmediate(r)); }
    const a = s.amrap;
    const once = (key, cond, fn) => { if (cond && !fired.has(key)) { fired.add(key); fn(); } };
    if (opts.adjustAt != null) once('adj', T >= capStart + opts.adjustAt && a?.phase === 'work', () => engine.adjustSpeed(1.5));
    if (opts.pauseAt != null) {
      once('pause', T >= capStart + opts.pauseAt && a?.phase === 'rest', () => { engine.pause(); music.update(T, engine.getState()); });
      if (fired.has('pause') && !fired.has('resume') && s.status === 'paused') {
        // 20 s en pausa (el reloj del contexto sigue)
        ctx.t += 20; clockMs += 20000;
        fired.add('resume');
        engine.resume();
        music.update(engine.getState().totalElapsed, engine.getState());
      }
    }
    if (opts.skipAt != null) once('skip', T >= capStart + opts.skipAt, () => { engine.skip(1); const s2 = engine.getState(); music.seek(s2.totalElapsed); music.update(s2.totalElapsed, s2); });
    if (opts.voiceBefore) once('voiceB', T >= capStart - opts.voiceBefore, () => {
      bus.dispatchEvent(Object.assign(new Event('br:voice'), { detail: { speaking: true } }));
    });
    if (opts.voiceBefore) once('voiceBoff', T >= capStart - 0.2, () => {
      bus.dispatchEvent(Object.assign(new Event('br:voice'), { detail: { speaking: false } }));
    });
    if (opts.voiceAt) once('voice', a && a.phase === 'rest' && a.phaseLeftSec <= opts.voiceAt && a.rounds >= 1, () => {
      bus.dispatchEvent(Object.assign(new Event('br:voice'), { detail: { speaking: true } }));
      samples.voiceT = T;
    });
    const am = music.status().amrap;
    if ((a?.phase || null) !== ph) { ph = a?.phase || null; ph0 = T; }
    samples.push({ T, ph0, phase: a?.phase || null, capLeft: a?.capLeft ?? null, phaseLeft: a?.phaseLeftSec ?? null, lp: am.lpHz, db: am.gainDb, amOn: am.on, status: s.status });
  }
  const base = music.status().ctx ? ctx.t - music.status().t : base0;
  const res = { w, plan, ctx, samples, events, capStart, capEnd, base, status: music.status(), music };
  if (process.env.AMRAP_DEBUG) {
    for (const x of samples.filter((x, i) => i % 20 === 0 || (process.env.AMRAP_NEAR && Math.abs(x.T - Number(process.env.AMRAP_NEAR)) < 0.8))) out(`    ${x.T.toFixed(1)} ${x.phase} left ${x.phaseLeft?.toFixed(1)} cap ${x.capLeft?.toFixed(0)} lp ${x.lp} ${x.db} ${x.amOn ? 'on' : ''} ${x.status}`);
    out(JSON.stringify(res.status.amrap.log));
    out(JSON.stringify(events.map((e) => [e.type, e.T.toFixed(1), e.d.phase])));
  }
  music.destroy();
  if (realOAC) globalThis.OfflineAudioContext = realOAC;
  return res;
}

// en la recuperación: retirada (lp, dB) o, si la pista está en un parón, retirada suave (AM.softLp, AM.softDb); entre medias,
// la rampa de 1 s de un cambio de una a otra
const retired = (x, lp, db) => x.lp >= lp - 20 && x.lp <= AM.softLp + 20 && x.db >= db - 0.1 && x.db <= AM.softDb + 0.1;
const atHard = (x, lp, db) => Math.abs(x.lp - lp) <= 20 && Math.abs(x.db - db) <= 0.1;
const workStarts = (r) => r.events.filter((e) => e.type === 'amrapPhase' && e.d.phase === 'work').map((e) => e.T);
const restStarts = (r) => r.events.filter((e) => e.type === 'amrapPhase' && e.d.phase === 'rest').map((e) => e.T);
const maxJumpDb = (r) => {
  let m = 0;
  for (let i = 1; i < r.samples.length; i++) {
    const d = Math.abs(r.samples[i].db - r.samples[i - 1].db);
    if (r.samples[i].status === 'running' && d > m) { m = d; r.jumpAt = r.samples[i].T; }
  }
  return m;
};

section('Reacción en directo: AMRAP 400 de 30′ con el motor de la clase');
{
  const r = await runAmrap('amrap-400', 30);
  const W = workStarts(r);
  const R = restStarts(r);
  const last = r.capEnd - 30;
  ok(R.length >= 4 && W.length >= 3, `rondas simuladas (${R.length} recuperaciones, ${W.length} trabajos)`);
  // recuperación: retirada (paso bajo y volumen antes de la dinámica), nunca muda
  const inRest = r.samples.filter((x) => x.phase === 'rest' && x.T < last - 2 && x.T - x.ph0 >= 2.2 && x.phaseLeft > 3.2);
  const hardN = inRest.filter((x) => atHard(x, AM.restLp, AM.restDb)).length;
  const softN = inRest.filter((x) => atHard(x, AM.softLp, Math.max(AM.restDb, AM.softDb))).length;
  out(`  recuperación: ${hardN} muestras retiradas del todo, ${softN} en parón (suave), ${inRest.length - hardN - softN} en rampa`);
  ok(hardN > 100 && hardN + softN >= 0.9 * inRest.length, 'la recuperación se queda retirada (o suave si la pista está en un parón)');
  ok(inRest.length > 100 && inRest.every((x) => retired(x, AM.restLp, AM.restDb)), `en la recuperación se retira (${inRest.length} muestras; lp ${Math.max(...inRest.map((x) => x.lp))} Hz, ${Math.min(...inRest.map((x) => x.db))}…${Math.max(...inRest.map((x) => x.db))} dB)`);
  ok(r.samples.every((x) => x.db >= AM.restDb - 0.1 && x.lp >= 1000), `nunca muda: como mucho ${AM.restDb} dB y paso bajo ≥ 1 kHz`);
  // trabajo: abierta del todo y a 0 dB (antes de los últimos 30 s)
  const inWork = r.samples.filter((x) => x.phase === 'work' && x.T < last - 2 && x.T > r.capStart + 1 && x.T - x.ph0 >= 0.3 && x.phaseLeft > 0.3);
  ok(inWork.length > 300 && inWork.every((x) => x.lp >= 19000 && Math.abs(x.db) <= 0.05), `en el trabajo se abre del todo (${inWork.length} muestras)`);
  // la apertura llega con el cambio (en el pulso: como mucho medio tiempo de diferencia)
  for (const t of W.filter((x) => x < last - 3)) {
    const near = r.samples.filter((x) => x.T >= t + 0.32 && x.T <= t + 0.5);
    ok(near.length && near.every((x) => x.lp >= 15000 && x.db >= -0.3), `ronda en ${t.toFixed(1)} s: abierta a los 0,3 s del cambio`);
    const before = r.samples.filter((x) => x.T >= t - 0.6 && x.T <= t - 0.3);
    ok(before.length && before.every((x) => x.lp < 15000), `ronda en ${t.toFixed(1)} s: aún cerrada medio segundo antes (subida, no adelanto)`);
  }
  // subida: un riser antes de cada ronda (salvo las que caen en los últimos 30 s) que acaba en el cambio, y su golpe
  const ris = risers(r.ctx, r.base);
  const want = W.filter((t) => t < last - 2 && t > r.capStart + 5);
  const matched = want.filter((t) => ris.some((x) => x < t && t - x <= 3.6 && t - x >= 1));
  ok(matched.length === want.length, `riser antes de cada ronda (${matched.length}/${want.length}; rondas ${want.map((x) => x.toFixed(1))}, risers ${ris.map((x) => x.toFixed(1))})`);
  const hs = hits(r.ctx, r.base);
  ok(want.every((t) => hs.some((x) => Math.abs(x - t) < 0.6)), 'golpe al entrar cada ronda');
  // últimos 30 s: a tope (+1,5 dB, sin filtros) aunque toque recuperar
  const top = r.samples.filter((x) => x.T >= last + 0.1 && x.T < r.capEnd - 0.1 && x.amOn);
  ok(top.length > 400 && top.every((x) => x.lp >= 19000 && Math.abs(x.db - 1.5) <= 0.06), `últimos 30 s a tope (${top.length} muestras)`);
  // final: golpe en el tope y vuelta a neutro
  ok(hs.some((x) => Math.abs(x - r.capEnd) < 0.5), `golpe al acabar el tope (${hs.map((x) => x.toFixed(1)).filter((x) => Math.abs(x - r.capEnd) < 2).join(', ')})`);
  const after = r.samples.filter((x) => x.T >= r.capEnd + 0.6);
  ok(after.length > 50 && after.every((x) => x.lp >= 19500 && Math.abs(x.db) <= 0.01 && !x.amOn), 'después del tope, la mezcla de siempre');
  ok(r.events.some((e) => e.type === 'amrapEnd'), 'evento de final de bloque');
  // sin escalones de volumen (50 ms entre muestras)
  ok(maxJumpDb(r) <= 1.6, `sin saltos de volumen (máx. ${maxJumpDb(r).toFixed(2)} dB en 50 ms, en ${r.jumpAt?.toFixed(1)} s)`);
  out(`  ${R.length} recuperaciones · ${W.length} rondas · ${ris.length} risers · ${hs.length} golpes · ${r.status.amrap.plans} programaciones`);
}

section('Reacción en directo: cambios de velocidad, pausa, salto y la voz');
{
  // + 1,5 km/h a mitad de un trabajo: la fase acaba antes y la retirada llega con el cambio real
  const r = await runAmrap('amrap-400', 20, { adjustAt: 150 });
  const R = restStarts(r).filter((t) => t > r.capStart + 150 && t < r.capEnd - 40);
  ok(R.length >= 1, 'hay recuperaciones tras el cambio de velocidad');
  for (const t of R) {
    const s = r.samples.filter((x) => x.T >= t + 1.9 && x.T <= t + 2.4);
    ok(s.length && s.every((x) => x.lp <= AM.softLp + 200 && x.db <= AM.softDb + 0.2), `con otra velocidad, se retira al llegar la recuperación (${t.toFixed(1)} s)`);
  }
  ok(maxJumpDb(r) <= 1.6, `sin saltos con el cambio de velocidad (${maxJumpDb(r).toFixed(2)} dB)`);

  // pausa en la recuperación: sigue retirada al volver, y la ronda siguiente se abre con su cambio
  const p = await runAmrap('amrap-400', 20, { pauseAt: 70 });
  const pw = workStarts(p).filter((t) => t > p.capStart + 75 && t < p.capEnd - 40);
  ok(pw.length >= 1 && p.samples.filter((x) => x.T >= pw[0] + 0.35 && x.T <= pw[0] + 1).every((x) => x.lp >= 15000), 'tras una pausa, la ronda siguiente se abre a su hora');
  ok(p.samples.filter((x) => x.status === 'running').every((x) => x.db >= AM.restDb - 0.1), 'tras una pausa nunca muda');

  // saltar el bloque a mitad: a neutro enseguida (sin quedarse filtrada)
  const k = await runAmrap('amrap-400', 20, { skipAt: 100 });
  const sk = k.capStart + 100;
  const later = k.samples.filter((x) => x.T > 0 && x.phase === null && x.T >= k.capStart + 1);
  ok(later.length > 50 && later.slice(12).every((x) => x.lp >= 19500 && Math.abs(x.db) <= 0.01), `saltar el bloque deja la mezcla de siempre (${sk.toFixed(0)} s)`);

  // la voz manda: si Lucía habla justo antes de una ronda, el riser se retira
  const v = await runAmrap('amrap-400', 20, { voiceAt: 2.5 });
  ok(v.samples.voiceT != null, 'la voz habló antes de una ronda');
  const vw = workStarts(v).find((t) => t > v.samples.voiceT);
  const log = v.status.amrap.log.map((x) => x.what);
  ok(vw != null && (log.includes('riser fuera (voz)') || !risers(v.ctx, v.base).some((x) => x > v.samples.voiceT - 3 && x < vw)), 'con la voz sonando, el riser se retira o no se programa');
}

section('Reacción en directo: versión sencilla y sin efectos');
{
  const r = await runAmrap('amrap-400', 20, { lite: true });
  const W = workStarts(r);
  const last = r.capEnd - 30;
  ok(risers(r.ctx, r.base).filter((x) => x > r.capStart + 5).length === 0, 'versión sencilla: sin risers');
  ok(hits(r.ctx, r.base).filter((x) => x > r.capStart + 5 && x < r.capEnd - 1).length === 0, 'versión sencilla: sin golpes en las rondas');
  const inRest = r.samples.filter((x) => x.phase === 'rest' && x.T < last - 2 && x.phaseLeft > 1.5 && x.T - x.ph0 >= 3);
  ok(inRest.length > 50 && inRest.every((x) => retired(x, AM.liteLp, AM.liteDb)) && inRest.some((x) => atHard(x, AM.liteLp, AM.liteDb)), `versión sencilla: se retira menos (${AM.liteLp} Hz, ${AM.liteDb} dB)`);
  ok(W.filter((t) => t < last - 3).every((t) => r.samples.filter((x) => x.T >= t + 0.8 && x.T < t + 1.2).every((x) => x.lp >= 15000)), 'versión sencilla: se abre con cada ronda (más despacio)');
  ok(maxJumpDb(r) <= 1, `versión sencilla: rampas suaves (${maxJumpDb(r).toFixed(2)} dB)`);
  const n = await runAmrap('amrap-400', 20, { effects: false });
  ok(n.ctx.oscs.filter((o) => o.when - n.base > n.capStart).length === 0, 'efectos apagados en Ajustes: ni risers ni golpes');
  { const bad = n.samples.filter((x) => x.phase === 'rest' && x.phaseLeft > 4 && x.T - x.ph0 >= 2.2 && x.T < n.capEnd - 32).filter((x) => !retired(x, AM.restLp, AM.restDb)); ok(!bad.length, `efectos apagados: la recuperación se retira igual (${bad.slice(0, 3).map((x) => `${x.T.toFixed(1)}:${x.lp}`)})`); }
  // AMRAP flotante: recuperación a ritmo de correr, se retira menos
  const f = await runAmrap('amrap-float', 20);
  const fr = f.samples.filter((x) => x.phase === 'rest' && x.phaseLeft > 3.3 && x.T < f.capEnd - 33 && x.T - x.ph0 >= 2.2);
  ok(fr.length > 50 && fr.every((x) => retired(x, AM.restLpRun, AM.restDbRun)) && fr.some((x) => atHard(x, AM.restLpRun, AM.restDbRun)), 'AMRAP flotante: recuperación a ritmo de correr, se retira menos');
  // doble AMRAP: los dos bloques reaccionan y entre medias, neutra
  const d = await runAmrap('amrap-double', 20);
  ok(d.events.filter((e) => e.type === 'amrapEnd').length >= 1, 'doble AMRAP: el primer bloque cierra');
}

// efectos grabados programados: { name, at (s de clase en que empieza), peak (s de clase de su punto más fuerte) }
// (los que se reprogramaron o cortó la voz se paran antes de acabar: no cuentan)
const sfxPlayed = (r) => r.ctx.srcs.filter((x) => x.buffer?.sfxName && x.stopAt >= x.when + x.buffer.duration - (x.off || 0) - 0.01).map((x) => {
  const name = x.buffer.sfxName;
  const off = x.off || 0;
  const peakIn = name === 'riser' ? x.buffer.duration - 1 / r.ctx.sampleRate : 0.04;
  return { name, at: x.when - r.base, peak: x.when + (peakIn - off) - r.base, stopAt: x.stopAt - r.base };
});

section('Efectos grabados: campana, golpe y riser, con criterio y poco');
{
  const r = await runAmrap('amrap-400', 30, { sfx: true });
  const W = workStarts(r);
  const last = r.capEnd - 30;
  const fx = sfxPlayed(r).filter((x) => x.at > r.capStart - 5);
  const bells = fx.filter((x) => x.name === 'campana');
  const golpes = fx.filter((x) => x.name === 'golpe');
  const ris = fx.filter((x) => x.name === 'riser');
  ok(r.status.sfx.loaded.length === 3, `efectos cargados (${r.status.sfx.loaded.join(', ')})`);
  ok(bells.length === 1 && Math.abs(bells[0].at - (r.capStart - 1.3)) < 0.05, `una campana que acaba al empezar el bloque (${bells.map((x) => x.at.toFixed(2))})`);
  ok(bells.every((x) => x.stopAt <= r.capStart + 0.1), 'la campana termina antes de que hable Lucía');
  const want = W.filter((t) => t < last - 2);
  ok(want.every((t) => golpes.some((x) => Math.abs(x.at - t) < 0.6)), `golpe grabado al entrar cada ronda (${golpes.length} golpes: ${golpes.map((x) => x.at.toFixed(1))}; rondas ${want.map((x) => x.toFixed(1))})`);
  ok(golpes.some((x) => Math.abs(x.at - r.capEnd) < 0.5), 'golpe grabado en el «¡Tiempo!» del final del tope');
  ok(want.every((t) => ris.some((x) => Math.abs(x.peak - t) < 0.6)), `riser grabado que culmina en cada ronda (${ris.map((x) => x.peak.toFixed(1))})`);
  ok(!fx.some((x) => x.name !== 'campana' && r.samples.some((s) => s.phase === 'rest' && s.T - s.ph0 > 2 && s.phaseLeft > 4 && Math.abs(s.T - x.at) < 0.06) && Math.abs(x.at - r.capEnd) > 1), 'nada en mitad de las recuperaciones');
  ok(risers(r.ctx, r.base).filter((x) => x > r.capStart + 5 && x < r.capEnd).length === 0, 'con los grabados cargados, sin riser sintetizado en las rondas');
  ok(maxJumpDb(r) <= 1.6, `los efectos no cambian las rampas de la música (${maxJumpDb(r).toFixed(2)} dB)`);
  // con la voz sonando al ir a programarla, no hay campana
  const v = await runAmrap('amrap-400', 20, { sfx: true, voiceBefore: 3.6 });
  ok(!sfxPlayed(v).some((x) => x.name === 'campana'), 'si Lucía habla, no hay campana');
  // efectos apagados: ninguno; versión sencilla: ni campana ni nada en las rondas
  const off = await runAmrap('amrap-400', 20, { sfx: true, effects: false });
  ok(sfxPlayed(off).length === 0 && off.ctx.oscs.length === 0, 'con «efectos» apagado, ningún efecto (ni grabado ni sintetizado)');
  const lite = await runAmrap('amrap-400', 20, { sfx: true, lite: true });
  const lf = sfxPlayed(lite).filter((x) => x.at > lite.capStart - 5);
  ok(!lf.some((x) => x.name === 'campana' || x.name === 'riser') && lf.filter((x) => x.name === 'golpe').length <= 1, `versión sencilla: solo el golpe del final (${lf.map((x) => x.name)})`);
  // si los archivos no cargan, los sintetizados de siempre
  const broken = await runAmrap('amrap-400', 30, { sfx: 'roto' });
  ok(sfxPlayed(broken).length === 0 && risers(broken.ctx, broken.base).filter((x) => x > broken.capStart + 5).length >= 2, 'sin los archivos, riser y golpe sintetizados');
}

section('Clase normal (riser-drop): sin efectos grabados, como siempre');
{
  const { createMusicEngine } = await import('../js/audio/music.js');
  let found = null;
  for (const id of ['pyramid', 'sprint-30-60', 'long-blocks', 'tempo-waves']) {
    const w = buildWorkout(id, { minutes: 30, levels: LEVELS, seed: 7, treadmill: TREADMILL });
    if (!w) continue;
    const plan = buildMusicPlan(w, LIB, { seed: 7, recent: false, prefs: { energy: 'max' } });
    const c = plan.cues.find((x) => x.transition === 'riser-drop' && x.atSec > 60 && x.leadSec >= 3);
    if (c) { found = { w, plan, c }; break; }
  }
  ok(!!found, 'una clase normal con riser-drop');
  if (found) {
    for (const loaded of [true, false]) {
      const ctx = makeCtx();
      const realOAC = globalThis.OfflineAudioContext;
      delete globalThis.OfflineAudioContext;
      const m = createMusicEngine({
        context: ctx, now: () => ctx.t, loadData: async (t) => new TextEncoder().encode(t.id).buffer, decodeTimeoutMs: 60000,
        ...(loaded ? { loadSfx: async (name) => new TextEncoder().encode(`sfx:${name}`).buffer } : {}),
      });
      await m.load(found.plan, new Map(LIB.map((t) => [t.id, t])));
      for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r));
      m.start(0);
      const base = ctx.t;
      for (let T = 0; T < found.c.atSec + 3; T += 0.25) {
        ctx.t = base + T;
        m.update(T, { status: 'running' });
        // (en el móvil la decodificación va ≥ 45 s por delante; aquí la clase corre a toda velocidad: se espera a que acabe)
        for (let k = 0; k < 400 && m.status().buffers.loading; k++) await new Promise((r) => setTimeout(r, 1));
        if (process.env.AMRAP_DEBUG && Math.round(T * 4) % 120 === 0) out(`      T ${T} ${JSON.stringify(m.status().buffers)}`);
      }
      const fx = sfxPlayed({ ctx, base }).filter((x) => Math.abs(x.peak - found.c.atSec) < 1 || Math.abs(x.at - found.c.atSec) < 1);
      if (process.env.AMRAP_DEBUG) out(`    ${found.w.templateId} cue ${JSON.stringify({ at: found.c.atSec, lead: found.c.leadSec, tr: found.c.transition })} jobs ${JSON.stringify(m.status().job)} log ${JSON.stringify(sfxPlayed({ ctx, base }).map((x) => [x.name, x.at.toFixed(1)]))} oscs ${ctx.oscs.map((o) => [o.type, (o.when - base).toFixed(1)]).join(' ')} sfx ${JSON.stringify(m.status().sfx)} st ${JSON.stringify((({ state, cursor, trackId, t, buffers }) => ({ state, cursor, trackId, t, b: buffers?.ids }))(m.status()))}`);
      // las clases normales se quedan como estaban (SFX.riserDrop = false: el platillo no rellenaba el corte, render del 28 nov)
      const synth = ctx.oscs.some((o) => o.type === 'sawtooth' && Math.abs(o.when - base - found.c.atSec) < found.c.leadSec + 1)
        && ctx.oscs.some((o) => o.type === 'sine' && Math.abs(o.when - base - found.c.atSec) < 0.3);
      ok(fx.length === 0 && synth, `riser-drop en ${found.c.atSec} s ${loaded ? 'con' : 'sin'} los efectos cargados: el riser y el golpe sintetizados de siempre`);
      ok(!sfxPlayed({ ctx, base }).length, `clase normal ${loaded ? 'con' : 'sin'} efectos cargados: ningún efecto grabado`);
      m.destroy();
      if (realOAC) globalThis.OfflineAudioContext = realOAC;
    }
  }
}

section('Robustez: datos raros y sin estado AMRAP');
{
  const { createMusicEngine } = await import('../js/audio/music.js');
  const ctx = makeCtx();
  delete globalThis.OfflineAudioContext;
  const m = createMusicEngine({ context: ctx, now: () => ctx.t, loadData: async (t) => new TextEncoder().encode(t.id).buffer });
  const w = buildWorkout('amrap-400', { minutes: 20, levels: LEVELS, seed: 1, treadmill: TREADMILL });
  await m.load(buildMusicPlan(w, LIB, { seed: 1 }), new Map(LIB.map((t) => [t.id, t])));
  m.start(0);
  let threw = false;
  try {
    for (const bad of [{}, { capLeft: 'x' }, { capLeft: 100, phase: 'rest', phaseLeftSec: NaN, speed: 0 }, { capLeft: 100, phase: 'work', workM: -3, speed: Infinity }, 42, 'a']) {
      m.amrap(bad); ctx.t += 0.2; m.update(ctx.t - 5, { status: 'running', amrap: bad });
    }
    m.amrapEvent('amrapEnd', null); m.amrapEvent('raro', {}); m.setAmrapOptions(null); m.setAmrapOptions({ lead: 'x' });
  } catch { threw = true; }
  ok(!threw, 'datos raros: nunca lanza');
  m.update(ctx.t - 5, { status: 'running', amrap: null });
  ctx.t += 1;
  const a = m.status().amrap;
  ok(a.lpHz >= 19500 && Math.abs(a.gainDb) <= 0.01, `datos raros: termina en la mezcla de siempre (${a.lpHz} Hz, ${a.gainDb} dB)`);
  // update sin el campo amrap (otras clases, otras pruebas): nada cambia
  m.update(ctx.t - 5, { status: 'running' });
  ok(!m.status().amrap.on, 'sin el campo amrap en el estado, no hace nada');
  // vigilante: si el filtro o la ganancia de la AMRAP acabaran fuera de rango (fallo del navegador), a neutro al momento
  m.amrap({ index: 1, phase: 'rest', phaseLeftSec: 40, capLeft: 300, cap: 600, workM: 400, restSec: 60, speed: 8, nextPhase: 'work', nextSpeed: 11.5, zone: 'jog' });
  ctx.t += 2;
  const amp = ctx.nodes.filter((n) => n.kind === 'gain').find((n) => Math.abs(n.gain.value - 10 ** (AM.restDb / 20)) < 1e-3);
  ok(!!amp, 'la ganancia de la AMRAP está en la recuperación');
  if (amp) { amp.gain.cancelScheduledValues(0); amp.gain.setValueAtTime(0.004, ctx.t); }
  ctx.t += 0.1;
  m.update(ctx.t - 5, { status: 'running', amrap: { index: 1, phase: 'rest', phaseLeftSec: 37.9, capLeft: 297.9, cap: 600, workM: 400, restSec: 60, speed: 8, nextPhase: 'work', nextSpeed: 11.5, zone: 'jog' } });
  ctx.t += 0.5;
  const g2 = m.status().amrap;
  ok(g2.guards === 1 && g2.gainDb > -8, `vigilante: vuelve a sonar (${g2.guards} · ${g2.gainDb} dB)`);
  m.destroy();
}

section('Código: todo con automatizaciones (sin temporizadores para sonar) y antes del duck');
{
  const src = readFileSync(join(ROOT, 'js/audio/music.js'), 'utf8');
  const body = src.slice(src.indexOf('AMRAP en directo (bloques'), src.indexOf('/* ───────────── API ───────────── */'));
  ok(body.length > 2000 && !/setTimeout|setInterval|requestAnimationFrame|defer\(/.test(body.replace(/\/\/.*$/gm, '')), 'el control AMRAP no usa temporizadores de JS');
  ok(/g\.bus\.connect\(g\.amLp\)/.test(src) && /g\.amLp\.connect\(g\.amGain\)/.test(src) && /g\.amGain\.connect\(g\.hp\)/.test(src), 'cadena: bus → amLp → amGain → hp (antes de la dinámica y del duck)');
  ok(/g\.trim\.connect\(g\.duck\)/.test(src) && /duckDb: -11/.test(src) && /duckMixDb: -10/.test(src), 'el duck de la voz, igual que siempre');
  ok(!/createMediaElementSource|createElement\(['"](audio|video)|new AudioContext/.test(body), 'sin <audio>/<video> ni AudioContext nuevos');
  const pl = readFileSync(join(ROOT, 'js/screens/player.js'), 'utf8');
  ok(/mcall\('amrapEvent', type, d, s\.amrap\)/.test(pl) && /mcall\('setAmrapOptions'/.test(pl), 'el reproductor engancha los eventos AMRAP y la versión sencilla');
}

out('');
if (failures.length) {
  out(`✗ ${failures.length} de ${checks} comprobaciones fallan:`);
  for (const f of failures.slice(0, 40)) out(`  - ${f}`);
  process.exit(1);
}
out(`✓ test-music-amrap: ${checks} comprobaciones, 0 fallos`);
