#!/usr/bin/env node
// RITMUP · audio sagrado con YouTube: que el vídeo nunca deje mudo al coach (node tools/test-audio-youtube.mjs).
// 1.7.2: con el vídeo de YouTube sonando dejó de oírse la voz de Lucía en el iPhone. El iframe es otro reproductor
// dentro de la página y puede cambiar la sesión de audio de WebKit sin que navigator.audioSession lo diga, o arrancar
// mudo (y un vídeo mudo deja la sesión en «ambient», que el modo silencio calla). Aquí se comprueba, con un YouTube y
// un WebAudio simulados, todo lo que lo evita:
//   · el vídeo nunca se queda mudo (unMute al sonar) y nunca se llama a mute();
//   · cada vez que el vídeo empieza a sonar se avisa (onPlaying) y el reproductor reafirma la sesión y despierta la voz;
//   · reassertAudio vuelve a pedir el tipo de sesión pasando por 'auto' y despierta la salida (nunca a mitad de frase);
//   · la clase siguiente despierta la salida en Empezar; la voz sube con el vídeo y vuelve a 1 sin él;
//   · ningún <video> en la app.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; process.stdout.write(`  ✗ ${msg}\n`); } return !!cond; };
const eq = (a, b, msg) => ok(a === b, `${msg} (esperado ${JSON.stringify(b)}, dio ${JSON.stringify(a)})`);
const section = (name) => process.stdout.write(`• ${name}\n`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────── Entorno: DOM mínimo, sesión de audio que apunta cada cambio, WebAudio simulado ───────── */
const typeLog = [];
const session = {
  _t: 'auto',
  get type() { return this._t; },
  set type(v) { typeLog.push(v); this._t = v; },
};
globalThis.navigator ??= {};
try { Object.defineProperty(globalThis.navigator, 'audioSession', { value: session, configurable: true }); } catch { globalThis.navigator.audioSession = session; }
globalThis.window = globalThis;
const el = () => ({ className: '', dataset: {}, style: {}, replaceChildren() {}, appendChild() {}, remove() {}, setAttribute() {} });
globalThis.document = {
  visibilityState: 'visible',
  baseURI: 'http://localhost/',
  createElement: el,
  querySelector: () => ({}),
  querySelectorAll: () => [],
  head: { appendChild() {} },
  addEventListener() {},
  removeEventListener() {},
};

const calls = [];
class Param { constructor(v) { this.value = v; } setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {} cancelScheduledValues() {} setTargetAtTime() {} }
class Node { connect() {} disconnect() {} }
class Ctx {
  constructor() { this.state = 'suspended'; this.sampleRate = 48000; this._t = 0; this.destination = new Node(); this._l = []; Ctx.last = this; }
  get currentTime() { return this._t; }
  addEventListener(_, f) { this._l.push(f); }
  resume() { calls.push('resume'); this.state = 'running'; this._l.forEach((f) => f()); return Promise.resolve(); }
  suspend() { calls.push('suspend'); return Promise.resolve(); }
  createGain() { const n = new Node(); n.gain = new Param(1); return n; }
  createDynamicsCompressor() { const n = new Node(); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0); return n; }
  createBuffer() { return { duration: 0, getChannelData: () => new Float32Array(1) }; }
  createBufferSource() { const s = new Node(); s.start = () => {}; s.stop = () => {}; return s; }
  createOscillator() { const n = new Node(); n.frequency = new Param(0); n.start = () => {}; n.stop = () => {}; return n; }
}
globalThis.AudioContext = Ctx;
setInterval(() => { if (Ctx.last?.state === 'running') Ctx.last._t += 0.25; }, 50).unref();

/* ───────── 1 · YouTube: nunca mudo, onPlaying en cada arranque ───────── */
section('YouTube: el vídeo nunca se queda mudo y avisa al empezar a sonar');
let ytPlayer = null;
class FakePlayer {
  constructor(box, opts) {
    this.opts = opts; this.muted = true; this.vol = 100; this.log = []; ytPlayer = this;
    setTimeout(() => opts.events.onReady?.(), 0);
  }
  isMuted() { return this.muted; }
  unMute() { this.log.push('unMute'); this.muted = false; }
  mute() { this.log.push('mute'); this.muted = true; }
  getVolume() { return this.vol; }
  setVolume(v) { this.log.push(`vol:${v}`); this.vol = v; }
  playVideo() { this.log.push('play'); }
  pauseVideo() { this.log.push('pause'); }
  stopVideo() {}
  destroy() {}
  getPlayerState() { return 1; }
  getVideoData() { return { title: 'x', isPlayable: true, video_id: 'M7lc1UVf-VE' }; }
  getPlaylist() { return []; }
  state(s) { this.opts.events.onStateChange?.({ data: s }); }
}
globalThis.YT = { Player: FakePlayer };
const yt = await import('../js/player/youtube.js');
let playingEvents = 0;
const bg = yt.createYouTubeBackground(el(), { kind: 'video', videoId: 'M7lc1UVf-VE', start: 0 }, { onPlaying: () => { playingEvents++; } });
await wait(5);
ok(ytPlayer, 'se crea el reproductor');
bg.play();
ytPlayer.state(1);                       // empieza a sonar (YouTube lo arrancó mudo)
ok(ytPlayer.log.includes('unMute') && !ytPlayer.muted, 'vídeo arrancado mudo ⇒ unMute()');
eq(playingEvents, 1, 'onPlaying al empezar a sonar');
ytPlayer.state(3); ytPlayer.state(1);   // un «buffering» no es un arranque nuevo
eq(playingEvents, 1, 'buffering → sonando no repite onPlaying');
ytPlayer.state(2); ytPlayer.state(1);   // pausa y vuelve
eq(playingEvents, 2, 'pausa → sonando avisa otra vez');
// el coach habla: se agacha (si iOS lo permite), pero nunca mute ni volumen 0
globalThis.dispatchEvent?.(new CustomEvent('br:voice', { detail: { speaking: true } }));
globalThis.dispatchEvent?.(new CustomEvent('br:voice', { detail: { speaking: false } }));
await wait(400);
ok(!ytPlayer.log.includes('mute'), 'nunca se llama a mute()');
ok(!ytPlayer.log.some((x) => x === 'vol:0'), 'nunca volumen 0');
bg.destroy?.();

/* ───────── 2 · Motor: reassertAudio, Empezar tras YouTube, refuerzo de voz ───────── */
section('Motor de audio: reafirma la sesión y despierta la salida');
const eng = await import('../js/audio/audio-engine.js');
ok(typeof eng.reassertAudio === 'function', 'audio-engine exporta reassertAudio');
ok(typeof eng.setVoiceBoost === 'function', 'audio-engine exporta setVoiceBoost');
eng.setAudioSessionType('playback');
const unlocked = await eng.unlockAudio();
ok(unlocked, 'unlockAudio con WebAudio simulado');
typeLog.length = 0;
calls.length = 0;
eng.reassertAudio('yt-play');
ok(typeLog.length >= 2 && typeLog.at(-2) === 'auto' && typeLog.at(-1) === 'playback', `sesión: 'auto' → 'playback' (dio ${typeLog.join(',')})`);
eq(session.type, 'playback', 'la sesión acaba en playback');
await wait(20);
ok(calls.includes('suspend') && calls.includes('resume'), 'despierta la salida (suspend/resume)');
calls.length = 0;
eng.reassertAudio('yt-play');
await wait(20);
ok(!calls.includes('suspend'), 'dos avisos seguidos no repiten el reinicio (1,5 s)');
// Siguiente clase: Empezar despierta la salida dentro del gesto
calls.length = 0;
typeLog.length = 0;
await eng.unlockAudio();
ok(calls.includes('suspend') && calls.includes('resume'), 'Empezar tras una clase con YouTube despierta la salida');
ok(typeLog.includes('auto') && session.type === 'playback', 'y vuelve a pedir la sesión');
calls.length = 0;
await eng.unlockAudio();
ok(!calls.includes('suspend'), 'sin YouTube de por medio, Empezar no reinicia nada');
eq(eng.setVoiceBoost(1.6), 1.6, 'voz reforzada con el vídeo');
eq(eng.setVoiceBoost(5), 2, 'refuerzo limitado a 2');
eq(eng.setVoiceBoost(1), 1, 'sin vídeo vuelve a 1');

/* ───────── 3 · El reproductor lo usa (cableado) y no hay <video> ───────── */
section('Reproductor: cableado de YouTube con el audio y sin <video>');
const player = await readFile(path.join(ROOT, 'js/screens/player.js'), 'utf8');
ok(/onPlaying:\s*\(\)\s*=>\s*ytReassert\('yt-play'\)/.test(player), 'player.js: onPlaying → ytReassert');
ok(/function ytTeardown\(\)[\s\S]{0,400}ytReassert\('yt-end'/.test(player), 'player.js: al quitar el vídeo se reafirma el audio');
ok(/ytBoost\(true\)/.test(player) && /ytBoost\(false\)/.test(player), 'player.js: refuerzo de voz con y sin vídeo');
const ytSrc = await readFile(path.join(ROOT, 'js/player/youtube.js'), 'utf8');
ok(!/call\('mute'\)|\.mute\(\)/.test(ytSrc), 'youtube.js no llama nunca a mute()');
async function walk(dir) {
  const out = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...await walk(p));
    else if (/\.(js|html)$/.test(d.name) && !d.name.startsWith('._')) out.push(p);
  }
  return out;
}
for (const f of [...await walk(path.join(ROOT, 'js')), path.join(ROOT, 'index.html')]) {
  const src = (await readFile(f, 'utf8')).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/<video[\s>]|createElement\(\s*['"]video['"]\s*\)/i.test(src), `sin <video>: ${path.relative(ROOT, f)}`);
}

process.stdout.write(`\n${failures ? '✗' : '✓'} ${checks - failures}/${checks} comprobaciones\n`);
process.exit(failures ? 1 : 0);
