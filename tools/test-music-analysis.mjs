#!/usr/bin/env node
// BestRunning · tests del análisis musical en el dispositivo (Node 22 + ffmpeg): node tools/test-music-analysis.mjs [--quick]
// 1) Pruebas unitarias: FFT, ponderación K y sonoridad, remuestreo, mezcla a mono, tap tempo, etiquetas y títulos.
// 2) Biblioteca: decodifica cada audio/music/*.m4a con ffmpeg y compara js/audio/music-analysis.js con library.json
//    (generado por tools/music/analyze.py):
//    A · 22 050 Hz mono de ffmpeg (misma entrada que Python)  ·  B · 44 100 Hz estéreo → mezcla y remuestreo en JS
//    (la ruta real del iPhone) + sonoridad frente a `ffmpeg ebur128`  ·  Imp · prior 125 + autoOctave (importación).
//    --quick: solo la ruta A. Sale con código ≠ 0 si no se cumplen los objetivos de precisión o de tiempo.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzePcm, analyzeFeatures, resampleTo22050, downmix, measureLoudness, kWeighting,
  gainForLoudness, tapTempo, tierForBpm, retimeAnalysis, spectrumMagnitudes, TIER_PRIOR, ANALYSIS_SR, BEAT_LEAD_SEC,
} from '../js/audio/music-analysis.js';
import { readTags, cleanTitle, MusicImportError, IMPORT_ACCEPT } from '../js/audio/music-import.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUICK = process.argv.includes('--quick');
let failures = 0;
let checks = 0;
const out = (s) => process.stdout.write(s + '\n');
const fail = (msg) => { failures++; if (failures <= 80) out(`  ✗ ${msg}`); };
const ok = (cond, msg) => { checks++; if (!cond) fail(msg); return !!cond; };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: esperado ${b} ± ${tol}, obtenido ${a}`);
const section = (t) => out(`\n▸ ${t}`);

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function ffDecode(file, { rate = 22050, channels = 1 } = {}) {
  const buf = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', String(channels), '-ar', String(rate), '-f', 'f32le', '-'],
    { maxBuffer: 1 << 30 });
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength >> 2);
  if (channels === 1) return [Float32Array.from(all)];
  const n = all.length / channels;
  const chs = Array.from({ length: channels }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) chs[c][i] = all[i * channels + c];
  return chs;
}

/** Sonoridad integrada de referencia con `ffmpeg -af ebur128` (resumen en stderr). */
function ffLoudness(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  const m = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+)\s*LUFS/.exec(r.stderr || '');
  return m ? Number(m[1]) : null;
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  if (saa === 0 && sbb === 0) return 1;
  return sab / Math.sqrt(saa * sbb);
}

/** Diferencia de fase (s) módulo `period`, en [−period/2, period/2). */
function phaseDelta(x, y, period) {
  let d = (((x - y) % period) + period) % period;
  if (d >= period / 2) d -= period;
  return d;
}

const sine = (n, f, sr, amp = 1, ph = 0) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / sr + ph));
const rms = (x, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
};

/* ───────────── 1. Pruebas unitarias ───────────── */

section('FFT real radix-2 (2048) frente a DFT directa');
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const x = Float64Array.from({ length: 2048 }, rnd);
  const mag = spectrumMagnitudes(x);
  let maxErr = 0;
  for (const k of [0, 1, 2, 3, 17, 255, 511, 512, 513, 1000, 1023, 1024]) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < 2048; n++) {
      re += x[n] * Math.cos((2 * Math.PI * k * n) / 2048);
      im -= x[n] * Math.sin((2 * Math.PI * k * n) / 2048);
    }
    maxErr = Math.max(maxErr, Math.abs(Math.hypot(re, im) - mag[k]));
  }
  ok(maxErr < 1e-8, `error máximo FFT ${maxErr}`);
}

section('Ponderación K y sonoridad BS.1770');
{
  const k = kWeighting(48000);
  // Coeficientes publicados en ITU-R BS.1770-4 (48 kHz)
  const ref = { sb: [1.53512485958697, -2.69169618940638, 1.19839281085285], sa: [-1.69065929318241, 0.73248077421585],
    ha: [-1.99004745483398, 0.99007225036621] };
  ref.sb.forEach((v, i) => near(k.shelf.b[i], v, 1e-6, `shelf b${i}`));
  near(k.shelf.a[1], ref.sa[0], 1e-6, 'shelf a1');
  near(k.shelf.a[2], ref.sa[1], 1e-6, 'shelf a2');
  near(k.highpass.a[1], ref.ha[0], 1e-6, 'highpass a1');
  near(k.highpass.a[2], ref.ha[1], 1e-6, 'highpass a2');
  const sr = 44100;
  const tone = sine(sr * 10, 997, sr, 0.1);
  const st = measureLoudness([tone, tone], sr);
  near(st.lufs, -20, 0.15, 'seno 997 Hz a −20 dBFS en estéreo');
  near(st.peakDb, -20, 0.05, 'pico del seno');
  const mono = measureLoudness([tone], sr);
  near(mono.lufs, st.lufs, 0.01, 'un canal = mono dual');
  const withSilence = new Float32Array(sr * 20);
  withSilence.set(tone, 0);
  near(measureLoudness([withSilence, withSilence], sr).lufs, st.lufs, 0.15, 'la puerta absoluta ignora el silencio');
  ok(measureLoudness([new Float32Array(sr * 5)], sr).lufs === -70, 'silencio → −70');
  ok(gainForLoudness(-8, -0.5) === -6, 'pista fuerte → −6 dB');
  ok(gainForLoudness(-20, -10) === 6, 'pista suave con margen → +6 dB');
  ok(gainForLoudness(-20, -2) === 1, 'pista suave con pico alto → solo hasta −1 dBFS');
  ok(gainForLoudness(-40, -30) === 12 && gainForLoudness(5, 0) === -12, 'límite ±12 dB');
  ok(Object.is(gainForLoudness(-13.96, -1), 0), 'sin −0');
}

section('Remuestreo y mezcla a mono');
{
  const n = 44100 * 2;
  const y = resampleTo22050(sine(n, 1000, 44100), 44100);
  ok(y.length === n / 2, `longitud 44,1 k → 22,05 k (${y.length})`);
  near(rms(y, 200, y.length - 200) * Math.SQRT2, 1, 0.01, 'amplitud 1 kHz tras ×2');
  const ref = sine(y.length, 1000, ANALYSIS_SR);
  let err = 0;
  for (let i = 200; i < y.length - 200; i++) err = Math.max(err, Math.abs(y[i] - ref[i]));
  ok(err < 0.01, `forma de onda 1 kHz (error ${err.toFixed(4)})`);
  const alias = resampleTo22050(sine(n, 15000, 44100), 44100);
  ok(20 * Math.log10(rms(alias, 200, alias.length - 200) * Math.SQRT2) < -40, 'rechazo de alias a 15 kHz > 40 dB');
  const y48 = resampleTo22050(sine(48000 * 2, 1000, 48000), 48000);
  near(y48.length, 44100, 1, 'longitud 48 k → 22,05 k');
  near(rms(y48, 300, y48.length - 300) * Math.SQRT2, 1, 0.02, 'amplitud 1 kHz desde 48 k');
  const a48 = resampleTo22050(sine(48000 * 2, 14000, 48000), 48000);
  ok(20 * Math.log10(rms(a48, 300, a48.length - 300) * Math.SQRT2) < -35, 'rechazo de alias 14 kHz desde 48 k');
  const y16 = resampleTo22050(sine(16000 * 2, 500, 16000), 16000);
  near(rms(y16, 300, y16.length - 300) * Math.SQRT2, 1, 0.02, 'amplitud 500 Hz desde 16 k');
  const same = new Float32Array(10);
  ok(resampleTo22050(same, 22050) === same, '22 050 → misma matriz');
  const L = Float32Array.of(1, 0.5, -1);
  const R = Float32Array.of(1, -0.5, 0);
  const m = downmix([L, R]);
  near(m[0], Math.SQRT2, 1e-6, 'mezcla estéreo como ffmpeg -ac 1 (Σ/√2)');
  near(m[1], 0, 1e-6, 'mezcla en contrafase');
  ok(downmix([L])[2] === -1 && downmix([L]) !== L, 'mono → copia');
}

section('Tap tempo y tramos');
{
  let s = 3;
  const jitter = () => (((s = (s * 48271) % 2147483647) / 2147483647) - 0.5) * 16; // ±8 ms
  const taps = Array.from({ length: 16 }, (_, i) => 1000 + i * (60000 / 128) + jitter());
  near(tapTempo(taps), 128, 0.6, '128 BPM con ±8 ms');
  near(tapTempo(taps.map((t) => t / 1000)), 128, 0.6, 'marcas en segundos');
  const missing = taps.filter((_, i) => i !== 7);
  near(tapTempo(missing), 128, 0.6, 'un toque perdido');
  const withPause = [0, 500, 1000, 1500, 9000, ...Array.from({ length: 8 }, (_, i) => 9500 + i * (60000 / 174))];
  near(tapTempo(withPause), 174, 1, 'una pausa larga reinicia la cuenta');
  ok(tapTempo([0, 500, 1000]) === null, 'menos de 4 toques → null');
  ok(tapTempo([]) === null && tapTempo(null) === null, 'sin toques → null');
  ok(tierForBpm(117.99) === 'calm' && tierForBpm(118) === 'jog' && tierForBpm(126) === 'run' && tierForBpm(134) === 'fast'
    && tierForBpm(148) === 'sprint' && tierForBpm(300) === 'sprint', 'rangos de tramo de analyze.py');
}

section('Pista sintética (bombo con ataque a negras, acento cada 4, 126 BPM)');
{
  const sr = ANALYSIS_SR;
  const bpm = 126;
  const spb = 60 / bpm;
  const dur = 100;
  const y = new Float32Array(sr * dur);
  const t0 = 0.4;
  let s = 11;
  const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let b = 0; t0 + b * spb < dur - 0.3; b++) {
    const at = Math.round((t0 + b * spb) * sr);
    const amp = b % 4 === 0 ? 0.9 : 0.55;
    for (let i = 0; i < sr * 0.12 && at + i < y.length; i++) {
      const tt = i / sr;
      y[at + i] += amp * Math.exp(-tt * 30) * Math.sin(2 * Math.PI * (55 + 120 * Math.exp(-tt * 40)) * tt);
      if (i < sr * 0.01) y[at + i] += 0.3 * amp * Math.exp(-tt * 400) * noise(); // ataque
    }
  }
  const a = analyzePcm(y, sr, { keepFeatures: true });
  near(a.bpm, bpm, 0.05, 'BPM');
  // Convención de analyze.py: el beat sale ~BEAT_LEAD_SEC antes del golpe audible
  const d = phaseDelta(a.beatOffset, t0, spb);
  near(d, -BEAT_LEAD_SEC, 0.02, 'fase del tiempo (adelanto documentado)');
  near(phaseDelta(a.barOffset, t0, 4 * spb), -BEAT_LEAD_SEC, 0.02, 'downbeat en el bombo acentuado');
  ok(a.energy.length === a.bars && a.bars > 40, 'energía por compás');
  ok(Number.isFinite(a.gainDb) && Number.isFinite(a.loudnessDb), 'sonoridad y ganancia');
  ok(a.features && a.features.env.length === a.features.nFrames, 'rasgos conservados');
  const forced = analyzeFeatures(a.features, { bpm: 128 });
  ok(forced.bpm === 128 && forced.bars > 0, 'rejilla forzada a 128 BPM');
  const rt = retimeAnalysis({ ...a, duration: dur }, 63);
  ok(rt.bpm === 63 && Math.abs(rt.bars - a.bars / 2) <= 1 && rt.energy.length === rt.bars, `reajuste sin rasgos a medio tempo (${rt.bars} compases)`);
  let threw = false;
  try { analyzePcm(new Float32Array(1000), sr); } catch { threw = true; }
  ok(threw, 'audio demasiado corto → error');
}

section('Títulos y etiquetas');
{
  const cases = [
    ['01 - Strobe (Extended Mix).mp3', 'Strobe (Extended Mix)'],
    ['03 Opus.m4a', 'Opus'],
    ['1-07 Levels.m4a', 'Levels'],
    ['99 Luftballons.mp3', '99 Luftballons'],
    ['Avicii_-_Levels_(Official_Video)_[HQ].mp3', 'Avicii - Levels'],
    ['Pendulum - Watercolour (Lyrics) 320kbps.mp3', 'Pendulum - Watercolour 320kbps'],
    ['Canci%C3%B3n%20de%20prueba.wav', 'Canción de prueba'],
    ['.m4a', 'Canción sin título'],
  ];
  for (const [name, want] of cases) ok(cleanTitle(name) === want, `cleanTitle(${name}) = «${cleanTitle(name)}» (esperado «${want}»)`);
  ok(new MusicImportError('drm', 'x').code === 'drm', 'MusicImportError con código');
  ok(IMPORT_ACCEPT.startsWith('audio/*'), 'accept para el input');
  ok(readTags(new ArrayBuffer(4)).title === '' && readTags(new Uint8Array(0)).artist === '', 'sin etiquetas → vacío');
}

const FF = hasFfmpeg();
if (FF) {
  const dir = mkdtempSync(path.join(tmpdir(), 'br-tags-'));
  try {
    const title = 'Canción Ñandú · ¡Sprint!';
    const artist = 'Señora DJ & Co';
    const mk = (ext, extra = []) => {
      const f = path.join(dir, `t.${ext}`);
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=1', ...extra,
        '-metadata', `title=${title}`, '-metadata', `artist=${artist}`, f]);
      return readTags(readFileSync(f));
    };
    for (const [ext, extra] of [['mp3', []], ['m4a', ['-c:a', 'aac']], ['flac', []], ['wav', []]]) {
      const t = mk(ext, extra);
      ok(t.title === title && t.artist === artist, `etiquetas ${ext}: «${t.title}» / «${t.artist}»`);
    }
    const v23 = path.join(dir, 'v23.mp3');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=1', '-id3v2_version', '3',
      '-metadata', `title=${title}`, '-metadata', `artist=${artist}`, v23]);
    const t23 = readTags(readFileSync(v23));
    ok(t23.title === title && t23.artist === artist, `etiquetas ID3v2.3 (UTF-16): «${t23.title}»`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ───────────── 2. Biblioteca frente a library.json ───────────── */

section(`Biblioteca integrada frente a library.json${QUICK ? ' (--quick: solo ruta A)' : ''}`);
if (!FF) {
  fail('ffmpeg no está disponible: no se puede comprobar la precisión frente a la biblioteca');
} else {
  const lib = JSON.parse(readFileSync(path.join(ROOT, 'audio/music/library.json'), 'utf8'));
  const tracks = lib.tracks || [];
  ok(tracks.length >= 20, `20 pistas en library.json (${tracks.length})`);
  const pad = (s, n) => String(s).slice(0, n).padEnd(n);
  const lpad = (s, n) => String(s).slice(0, n).padStart(n);
  const ms = (x) => `${x >= 0 ? '+' : ''}${Math.round(x * 1000)}`;
  out(`\n  ${pad('pista', 28)} ${pad('tramo', 6)} ${lpad('lib', 6)} │ ${lpad('A bpm', 6)} ${lpad('Δms', 4)} ${pad('bar', 4)} ${lpad('r', 5)} ${lpad('s', 4)}`
    + (QUICK ? '' : ` │ ${lpad('B bpm', 6)} ${lpad('Δms', 4)} ${lpad('r', 5)} │ ${lpad('LUFS', 6)} ${lpad('ff', 5)} ${lpad('gain', 5)} │ ${lpad('imp', 6)}`));
  const stats = { n: 0, bpmA: 0, phA: 0, barA: 0, enA: 0, bpmB: 0, phB: 0, barB: 0, enB: 0, loud: 0, loudN: 0, times: [], octaveImp: 0, sprintN: 0, calmSafe: true };
  const bpmOk = (got, t) => {
    if (Math.abs(got - t.bpm) <= 0.6) return true;
    const sprint = t.curatedTier === 'sprint' || t.tier === 'sprint';
    return sprint && (Math.abs(got * 2 - t.bpm) <= 1.2 || Math.abs(got / 2 - t.bpm) <= 0.3);
  };
  for (const t of tracks) {
    stats.n++;
    const file = path.join(ROOT, t.file);
    const prior = TIER_PRIOR[t.curatedTier] ?? 125;
    const spb = 60 / t.bpm;
    let stereo = null;
    let loud = null;
    if (!QUICK) {
      stereo = ffDecode(file, { rate: 44100, channels: 2 });
      loud = measureLoudness(stereo, 44100);
    }
    // A · misma entrada que analyze.py
    const [pcm] = ffDecode(file);
    const t0 = performance.now();
    const a = analyzePcm(pcm, ANALYSIS_SR, { priorBpm: prior, loudness: loud });
    const secA = (performance.now() - t0) / 1000;
    stats.times.push(secA);
    const okA = bpmOk(a.bpm, t);
    // Fases: con el mismo tempo (o la octava del sprint) comparar módulo un tiempo
    const spbA = 60 / a.bpm;
    const per = Math.min(spb, spbA);
    // Rejilla corregida a mano en analyze.py (HALF_BEAT_SHIFT: bombo a +1/2 tiempo de la fase del peine): se compara
    // la fase del analizador desplazada lo mismo
    const shift = t.gridShift === 'half-beat' ? spb / 2 : 0;
    const dA = phaseDelta(a.beatOffset + shift, t.beatOffset, per);
    const dBarA = phaseDelta(a.barOffset + shift, t.barOffset, per);
    const downA = Math.abs(phaseDelta(a.barOffset, t.barOffset, 4 * Math.max(spb, spbA))) < 0.03;
    const rA = pearson(a.energy, t.energy);
    if (okA) stats.bpmA++;
    if (Math.abs(dA) <= 0.03 && Math.abs(dBarA) <= 0.03) stats.phA++;
    if (downA) stats.barA++;
    if (rA > 0.8) stats.enA++;
    let line = `  ${pad(t.id, 28)} ${pad(t.curatedTier, 6)} ${lpad(t.bpm, 6)} │ ${lpad(a.bpm, 6)}${okA ? ' ' : '✗'}${lpad(ms(dA), 4)} ${pad(downA ? 'ok' : '≠', 4)} ${lpad(rA.toFixed(2), 5)} ${lpad(secA.toFixed(1), 4)}`;
    if (!QUICK) {
      // B · ruta del iPhone: estéreo a 44,1 kHz → mezcla y remuestreo en JS
      const mono = downmix(stereo);
      stereo = null;
      const b = analyzePcm(mono, 44100, { priorBpm: prior, loudness: loud, keepFeatures: true });
      const okB = bpmOk(b.bpm, t);
      const pB = Math.min(spb, 60 / b.bpm);
      const dB = phaseDelta(b.beatOffset + shift, t.beatOffset, pB);
      const dBarB = phaseDelta(b.barOffset + shift, t.barOffset, pB);
      const rB = pearson(b.energy, t.energy);
      if (okB) stats.bpmB++;
      if (Math.abs(dB) <= 0.03 && Math.abs(dBarB) <= 0.03) stats.phB++;
      if (Math.abs(phaseDelta(b.barOffset, t.barOffset, 4 * Math.max(spb, 60 / b.bpm))) < 0.03) stats.barB++;
      if (rB > 0.8) stats.enB++;
      const ff = ffLoudness(file);
      if (ff != null) {
        stats.loudN++;
        if (Math.abs(loud.lufs - ff) <= 0.5) stats.loud++;
      }
      // Imp · importación sin tramo: prior 125 + corrección de octava
      const imp = analyzeFeatures(b.features, { priorBpm: 125, autoOctave: true });
      const sameOctave = Math.abs(imp.bpm - t.bpm) <= 0.6;
      if (t.curatedTier === 'sprint') {
        stats.sprintN++;
        if (sameOctave) stats.octaveImp++;
      }
      if (t.curatedTier === 'calm' && imp.bpm > 150) stats.calmSafe = false;
      line += ` │ ${lpad(b.bpm, 6)}${okB ? ' ' : '✗'}${lpad(ms(dB), 4)} ${lpad(rB.toFixed(2), 5)} │ ${lpad(loud.lufs.toFixed(1), 6)} ${lpad(ff == null ? '–' : ff.toFixed(1), 5)} ${lpad(b.gainDb.toFixed(1), 5)} │ ${lpad(imp.bpm, 6)}${imp.bpmDetected ? '*' : ' '}`;
    }
    out(line);
  }
  const N = stats.n;
  const need = (x, k, label) => ok(x >= k, `${label}: ${x}/${N} (mínimo ${k})`);
  const avg = stats.times.reduce((x, y) => x + y, 0) / Math.max(1, stats.times.length);
  const max = Math.max(...stats.times);
  out(`\n  A · BPM ${stats.bpmA}/${N} · fase ±30 ms ${stats.phA}/${N} · downbeat ${stats.barA}/${N} · energía r>0,8 ${stats.enA}/${N} · ${avg.toFixed(2)} s/pista (máx. ${max.toFixed(2)} s)`);
  need(stats.bpmA, Math.max(1, N - 2), 'A · BPM ±0,6 (u octava en sprint)');
  need(stats.phA, Math.ceil(N * 0.8), 'A · beatOffset/barOffset en fase (±30 ms módulo un tiempo)');
  need(stats.enA, Math.ceil(N * 0.8), 'A · energía por compás correlada (Pearson > 0,8)');
  ok(avg <= 5 && max <= 15, `tiempo de análisis (media ${avg.toFixed(2)} s, máx. ${max.toFixed(2)} s)`);
  if (!QUICK) {
    out(`  B · BPM ${stats.bpmB}/${N} · fase ${stats.phB}/${N} · downbeat ${stats.barB}/${N} · energía ${stats.enB}/${N} · sonoridad ±0,5 dB vs ebur128 ${stats.loud}/${stats.loudN}`);
    out(`  Imp · octava correcta en sprint ${stats.octaveImp}/${stats.sprintN} (* = doblado por autoOctave) · ninguna "calm" enviada a sprint: ${stats.calmSafe ? 'sí' : 'NO'}`);
    need(stats.bpmB, Math.max(1, N - 2), 'B · BPM ±0,6 (u octava en sprint)');
    need(stats.phB, Math.ceil(N * 0.8), 'B · fase');
    need(stats.enB, Math.ceil(N * 0.8), 'B · energía');
    ok(stats.loudN > 0 && stats.loud >= stats.loudN - 2, `B · sonoridad ±0,5 dB frente a ffmpeg ebur128 (${stats.loud}/${stats.loudN})`);
    ok(stats.calmSafe, 'Imp · la corrección de octava no manda pistas tranquilas a sprint');
  }
}

out(`\n${failures ? `✗ ${failures} fallo(s)` : '✓ Todo correcto'} · ${checks} comprobaciones`);
process.exit(failures ? 1 : 0);
