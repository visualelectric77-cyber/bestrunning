#!/usr/bin/env node
// BestRunning · audio con el iPhone bloqueado (app nativa): node tools/test-audio-locked.mjs
// audio-engine.js nunca suspende el AudioContext con la página oculta: un reinicio suspend() + resume() en segundo plano
// podía no volver a arrancar en un iPhone de verdad (clase muda con la pantalla bloqueada). Oculta, solo reanuda si no
// está en marcha y el reinicio completo espera a que la página vuelva a verse (visibilitychange o audio.kick «active»).
// Proceso propio, con documento, ventana y WebAudio simulados desde el principio: el motor engancha sus oyentes una vez.
let checks = 0;
let failures = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; process.stdout.write(`  ✗ ${msg}\n`); } return !!cond; };
const eq = (a, b, msg) => ok(a === b, `${msg}: esperado «${b}», obtenido «${a}»`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (t) => process.stdout.write(`\n▸ ${t}\n`);

/* ───────────── Entorno simulado: app nativa (WKWebView con el puente), documento y WebAudio ───────────── */

const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
globalThis.document = doc;
const win = new EventTarget();
globalThis.window = win;
globalThis.addEventListener = win.addEventListener.bind(win);
globalThis.removeEventListener = win.removeEventListener.bind(win);
globalThis.dispatchEvent = win.dispatchEvent.bind(win);
globalThis.webkit = { messageHandlers: { bestrunning: { postMessage() {} } } };
const stuck = [];
win.addEventListener('br:audio-stuck', () => stuck.push(Date.now()));

const calls = { suspend: 0, resume: 0 };
let frozen = null; // currentTime congelado (salida atascada)
class Param { constructor(v) { this.value = v; } setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {} cancelScheduledValues() {} setTargetAtTime() {} }
class Node { connect() {} disconnect() {} }
class Ctx extends EventTarget {
  constructor() { super(); this.state = 'suspended'; this.sampleRate = 8000; this.t0 = performance.now(); this.destination = new Node(); }
  get currentTime() { return frozen ?? (performance.now() - this.t0) / 1000; }
  set(state) { if (this.state !== state) { this.state = state; this.dispatchEvent(new Event('statechange')); } }
  resume() { calls.resume++; this.set('running'); return Promise.resolve(); }
  suspend() { calls.suspend++; this.set('suspended'); return Promise.resolve(); }
  createGain() { const n = new Node(); n.gain = new Param(1); return n; }
  createDynamicsCompressor() { const n = new Node(); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0); return n; }
  createBuffer(ch, len, sr) { return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { const s = new Node(); s.start = () => {}; s.stop = () => {}; return s; }
}
globalThis.AudioContext = Ctx;

const AE = await import('../js/audio/audio-engine.js');
const info = () => AE.audioContextInfo() || {};
const hide = (fire = true) => { doc.visibilityState = 'hidden'; if (fire) doc.dispatchEvent(new Event('visibilitychange')); };
const show = (fire = true) => { doc.visibilityState = 'visible'; if (fire) doc.dispatchEvent(new Event('visibilitychange')); };
async function until(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(50); }
  return fn();
}

/* ───────────── 1 · A la vista: como siempre (reinicio completo al momento) ───────────── */

section('A la vista');
const unlocked = await AE.unlockAudio();
ok(unlocked && AE.isUnlocked(), 'unlockAudio con WebAudio simulado');
const ctx = AE.getAudioContext(); // la música de la app lo comparte: el audio debe sonar
ok(ctx instanceof Ctx && ctx.state === 'running', 'contexto compartido en marcha');
let s0 = calls.suspend;
ok(AE.kickAudio('interruption'), 'kickAudio(interruption) a la vista');
await sleep(20);
eq(calls.suspend - s0, 1, 'a la vista: reinicio completo (suspend + resume) al momento');
eq(ctx.state, 'running', 'y vuelve a sonar');
eq(info().deferredRestart, null, 'sin reinicio pendiente');
const r0 = info().restarts;

/* ───────────── 2 · Oculta (iPhone bloqueado): nunca suspend() ───────────── */

section('Oculta: salida atascada');
hide();
s0 = calls.suspend;
frozen = ctx.currentTime; // el reloj del audio deja de avanzar
ok(await until(() => info().deferredRestart === 'stalled', 6000), `vigilancia oculta: reinicio «stalled» pendiente (${info().deferredRestart})`);
eq(calls.suspend - s0, 0, 'oculta: la vigilancia no suspende el contexto');
eq(ctx.state, 'running', 'oculta: el contexto sigue en marcha');
eq(info().restarts, r0, 'oculta: no cuenta como reinicio hecho');
frozen = null;

section('Oculta: fin de interrupción y reinicio de los servicios de audio');
ok(AE.kickAudio('reset'), 'kickAudio(reset) oculta');
await sleep(20);
eq(calls.suspend - s0, 0, 'reset oculta: sin suspend');
eq(info().deferredRestart, 'reset', 'reset oculta: queda pendiente');
// Llamada de teléfono con la pantalla bloqueada: 'interrupted' → la vigilancia reanuda → 'running' → reinicio pedido
let res0 = calls.resume;
ctx.set('interrupted');
ok(await until(() => ctx.state === 'running' && calls.resume > res0, 2500), 'interrumpido y oculto: la vigilancia lo reanuda (resume)');
await sleep(400);
eq(calls.suspend - s0, 0, 'tras la interrupción, oculta: sin suspend');
eq(info().deferredRestart, 'interruption', 'el reinicio de fin de interrupción queda pendiente');
// Contexto parado por el sistema: con la página oculta solo resume()
res0 = calls.resume;
ctx.set('suspended');
ok(AE.kickAudio('route'), 'kickAudio(route) con el contexto parado');
eq(calls.resume - res0, 1, 'parado y oculto: resume()');
eq(calls.suspend - s0, 0, 'parado y oculto: sin suspend');
eq(ctx.state, 'running', 'parado y oculto: vuelve a estar en marcha');
eq(stuck.length, 0, 'oculta: ningún aviso de «sin sonido» (no hubo reinicios fallidos)');

/* ───────────── 3 · Vuelve a verse: el reinicio pendiente, completo y una vez ───────────── */

section('De vuelta a la vista');
show();
await sleep(20);
eq(calls.suspend - s0, 1, 'al verse: un reinicio completo');
eq(info().deferredRestart, null, 'sin reinicio pendiente');
eq(info().lastRestart, 'interruption+visible', 'el reinicio es el que quedó pendiente');
eq(ctx.state, 'running', 'sonando');
show();
await sleep(20);
eq(calls.suspend - s0, 1, 'otra vez visible: nada que reiniciar');

section('De vuelta por audio.kick «active» (app nativa)');
hide();
AE.kickAudio('reset');
await sleep(20);
eq(calls.suspend - s0, 1, 'oculta: reset sin suspend');
show(false); // la app vuelve delante: el iPhone avisa con audio.kick antes que el visibilitychange
win.dispatchEvent(new CustomEvent('br:audio-kick', { detail: { reason: 'active' } }));
await sleep(20);
eq(calls.suspend - s0, 2, 'audio.kick active con un reinicio pendiente: reinicio completo');
eq(info().lastRestart, 'reset+visible', 'el reinicio pendiente (reset)');
doc.dispatchEvent(new Event('visibilitychange'));
await sleep(20);
eq(calls.suspend - s0, 2, 'el visibilitychange que llega después no repite el reinicio');

section('Pendiente sin audio que hacer sonar');
hide();
AE.kickAudio('interruption');
AE.releaseAudioContext(); // fin de la clase: la música ya no usa el contexto
show();
await sleep(20);
eq(calls.suspend - s0, 2, 'sin audio que deba sonar: no se reinicia al volver');
eq(info().deferredRestart, null, 'y el pendiente se olvida');

process.stdout.write(`\n${failures ? '✗' : '✓'} test-audio-locked: ${checks} comprobaciones, ${failures} fallos\n`);
process.exit(failures ? 1 : 0);
