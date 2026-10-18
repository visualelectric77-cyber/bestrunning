#!/usr/bin/env node
// BestRunning · genera el pack de voz grabado con ElevenLabs (por defecto, Eva Dorado) a partir de
// js/audio/voice-pack.js, recorta silencios, iguala sonoridad y deja audio/packs/<pack>/<id>.mp3 + index.json.
//
// La clave NUNCA se pasa por argumentos ni se imprime: se lee de ELEVENLABS_API_KEY o del archivo
// ~/.config/bestrunning/elevenlabs.key (créalo tú: pbpaste > ~/.config/bestrunning/elevenlabs.key).
//
// Uso:
//   node tools/voice/generate-pack.mjs --dry-run                 # cuenta caracteres, no gasta créditos
//   node tools/voice/generate-pack.mjs --samples                 # 3 frases de prueba con 2 estilos
//   node tools/voice/generate-pack.mjs --style v2|v3             # genera lo que falte del pack
//   node tools/voice/generate-pack.mjs --style v2 --only up_1,s_115 --force
import { readFile, writeFile, mkdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACK_SCRIPT, PACK_CHARS, PACK_ID, PACK_NAME } from '../../js/audio/voice-pack.js';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKS_DIR = path.join(ROOT, 'audio', 'packs');
const VOICE_ID = 'RgXx32WYOGrd7gFNifSf'; // Eva Dorado – Warm, Soft and Convincing (español peninsular)

// Estilos de voz. v2 = eleven_multilingual_v2 (estable, natural); v3 = eleven_v3 (más expresivo).
const STYLES = {
  v2: {
    model_id: 'eleven_multilingual_v2',
    voice_settings: { stability: 0.32, similarity_boost: 0.8, style: 0.62, use_speaker_boost: true, speed: 1.06 },
    context: true,
  },
  v3: {
    model_id: 'eleven_v3',
    voice_settings: { stability: 0.5, similarity_boost: 0.8, use_speaker_boost: true },
    context: false,
  },
};

const SAMPLE_IDS = ['up_1', 's_115', 'hard_3'];

/* ───────────── argumentos ───────────── */
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };

async function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const f = path.join(os.homedir(), '.config', 'bestrunning', 'elevenlabs.key');
  if (existsSync(f)) return (await readFile(f, 'utf8')).trim();
  throw new Error('Falta la clave: crea ~/.config/bestrunning/elevenlabs.key (pbpaste > …) o exporta ELEVENLABS_API_KEY.');
}

/* ───────────── API ───────────── */
async function tts(key, clip, style, outFile) {
  const st = STYLES[style];
  const body = { text: clip.text, model_id: st.model_id, language_code: 'es', voice_settings: st.voice_settings, seed: 4242 };
  if (st.context) {
    // Contexto de entonación (no se factura): portadoras quedan en suspenso, números suenan a remate.
    if (clip.kind === 'carrier') body.next_text = 'once coma cinco.';
    if (clip.kind === 'number') body.previous_text = '¡Atención! Subimos a…';
  }
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      await writeFile(outFile, Buffer.from(await res.arrayBuffer()));
      return;
    }
    const txt = (await res.text()).slice(0, 300);
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(30000, 1500 * 2 ** attempt);
      console.warn(`  ${clip.id}: HTTP ${res.status}, reintento en ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`${clip.id}: HTTP ${res.status} ${txt}`);
  }
  throw new Error(`${clip.id}: demasiados reintentos`);
}

async function credits(key) {
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': key } });
    if (!r.ok) return null;
    const j = await r.json();
    return { used: j.character_count, limit: j.character_limit, left: j.character_limit - j.character_count };
  } catch { return null; }
}

/* ───────────── posproceso: recorte + sonoridad + mp3 mono ───────────── */
async function postprocess(raw, out, kind) {
  const tail = kind === 'carrier' ? 0.16 : 0.05;
  const trim = 'silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.01,'
    + 'areverse,silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.02,areverse';
  // 1) medir volumen medio tras recortar
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', raw, '-af', `${trim},volumedetect`, '-f', 'null', '-'], { maxBuffer: 1 << 24 });
  const mean = parseFloat((stderr.match(/mean_volume:\s*(-?[\d.]+)/) || [])[1] ?? '-20');
  const gain = Math.max(-12, Math.min(14, -17 - mean)); // objetivo ≈ −17 dB RMS
  // 2) aplicar recorte, ganancia, limitador suave y cola de silencio; mp3 mono 96 kbps
  const af = `${trim},highpass=f=70,volume=${gain.toFixed(2)}dB,alimiter=limit=0.89:attack=3:release=40,adelay=10,apad=pad_dur=${tail},aformat=sample_fmts=s16p`;
  await run('ffmpeg', ['-hide_banner', '-y', '-i', raw, '-af', af, '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k', '-map_metadata', '-1', out], { maxBuffer: 1 << 24 });
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: n }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } });
  await Promise.all(workers);
}

async function writeIndex(dir, style) {
  const present = [];
  for (const c of PACK_SCRIPT) if (existsSync(path.join(dir, `${c.id}.mp3`))) present.push(c.id);
  const index = { id: PACK_ID, name: PACK_NAME, voiceId: VOICE_ID, model: STYLES[style].model_id, format: 'mp3', clips: present };
  await writeFile(path.join(dir, 'index.json'), JSON.stringify(index, null, 1));
  const listFile = path.join(PACKS_DIR, 'packs.json');
  let list = [];
  try { list = JSON.parse(await readFile(listFile, 'utf8')); } catch { list = []; }
  list = list.filter((p) => p.id !== PACK_ID);
  list.push({ id: PACK_ID, name: PACK_NAME, voiceId: VOICE_ID, model: index.model, count: present.length });
  await writeFile(listFile, JSON.stringify(list, null, 1));
  return present.length;
}

async function main() {
  if (flag('help')) { console.log(await readFile(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).join('\n')); return; }
  console.log(`Pack ${PACK_NAME}: ${PACK_SCRIPT.length} clips, ${PACK_CHARS} caracteres.`);
  if (flag('dry-run')) return;
  const key = await apiKey();
  const before = await credits(key);
  if (before) console.log(`Créditos: ${before.left} libres (${before.used}/${before.limit}).`);

  if (flag('samples')) {
    const clips = PACK_SCRIPT.filter((c) => SAMPLE_IDS.includes(c.id));
    for (const style of ['v2', 'v3']) {
      const dir = path.join(PACKS_DIR, '_samples', style);
      await mkdir(dir, { recursive: true });
      for (const c of clips) {
        const raw = path.join(dir, `${c.id}.raw.mp3`);
        await tts(key, c, style, raw);
        await postprocess(raw, path.join(dir, `${c.id}.mp3`), c.kind);
        await rm(raw);
      }
      // Muestra encadenada tal y como sonará en la cinta
      const list = clips.map((c) => `file '${path.join(dir, `${c.id}.mp3`)}'`).join('\n');
      await writeFile(path.join(dir, 'list.txt'), list);
      await run('ffmpeg', ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-c', 'copy', path.join(PACKS_DIR, '_samples', `muestra-${style}.mp3`)]);
      await rm(path.join(dir, 'list.txt'));
      console.log(`Muestra ${style}: audio/packs/_samples/muestra-${style}.mp3`);
    }
  } else {
    const style = opt('style', 'v2');
    if (!STYLES[style]) throw new Error(`Estilo desconocido: ${style}`);
    const dir = path.join(PACKS_DIR, PACK_ID);
    const rawDir = path.join(dir, '_raw');
    await mkdir(rawDir, { recursive: true });
    const only = opt('only') ? new Set(opt('only').split(',')) : null;
    const todo = PACK_SCRIPT.filter((c) => (!only || only.has(c.id)) && (flag('force') || !existsSync(path.join(dir, `${c.id}.mp3`))));
    const chars = todo.reduce((a, c) => a + c.text.length, 0);
    console.log(`Generando ${todo.length} clips (${chars} caracteres) con ${STYLES[style].model_id}…`);
    if (before && chars > before.left) throw new Error(`No hay créditos suficientes (${chars} > ${before.left}).`);
    let done = 0;
    await pool(todo, 2, async (c) => {
      const raw = path.join(rawDir, `${c.id}.mp3`);
      if (!existsSync(raw) || flag('force')) await tts(key, c, style, raw);
      await postprocess(raw, path.join(dir, `${c.id}.mp3`), c.kind);
      done++;
      if (done % 20 === 0 || done === todo.length) console.log(`  ${done}/${todo.length}`);
    });
    const n = await writeIndex(dir, style);
    console.log(`Pack listo: ${n}/${PACK_SCRIPT.length} clips en audio/packs/${PACK_ID}/`);
  }
  const after = await credits(key);
  if (after) console.log(`Créditos restantes: ${after.left}.`);
}

main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
