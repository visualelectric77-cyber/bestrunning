#!/usr/bin/env node
// BestRunning · genera un pack de voz con ElevenLabs a partir de audio/manifest.json (Node 22, fetch nativo).
// Escribe audio/packs/<id>/<clipId>.mp3 + index.json y registra el pack en audio/packs/packs.json.
//
// Uso: ELEVENLABS_API_KEY=... node tools/generate-voices.mjs --pack <id> --voice <voiceId> [opciones]
import { readFile, writeFile, mkdir, stat, rename, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'audio', 'manifest.json');
const PACKS_DIR = path.join(ROOT, 'audio', 'packs');
const PACKS_JSON = path.join(PACKS_DIR, 'packs.json');
const API = 'https://api.elevenlabs.io/v1/text-to-speech';
const VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true };
const MAX_ATTEMPTS = 6;

const HELP = `Genera un pack de voz de BestRunning con ElevenLabs.

  ELEVENLABS_API_KEY=xxxx node tools/generate-voices.mjs --pack <id> --voice <voiceId> [opciones]

Obligatorias:
  --pack <id>          Carpeta del pack: audio/packs/<id>/ (minúsculas, números, - y _)
  --voice <voiceId>    Id de la voz de ElevenLabs (Voice Library → "Copy voice ID")

Opcionales:
  --name "Nombre"      Nombre visible en Perfil → Voz y audio (por defecto, el id)
  --model <id>         Modelo (por defecto eleven_multilingual_v2)
  --format <fmt>       output_format (por defecto mp3_44100_128)
  --only-missing       Solo genera los clips que aún no existen (para reanudar o tras ampliar el manifiesto)
  --limit <n>          Genera como mucho n clips (pruebas)
  --concurrency <n>    Peticiones en paralelo (por defecto 3)
  --dry-run            No llama a la API: muestra cuántos clips y caracteres se generarían
  -h, --help           Muestra esta ayuda

Antes: node tools/build-audio-manifest.mjs   (regenera audio/manifest.json)
`;

function parseArgs(argv) {
  const o = { pack: '', voice: '', name: '', model: 'eleven_multilingual_v2', format: 'mp3_44100_128',
    onlyMissing: false, limit: Infinity, concurrency: 3, dryRun: false, help: false };
  const val = (i) => {
    const v = argv[i + 1];
    if (v == null || v.startsWith('--')) throw new Error(`Falta el valor de ${argv[i]}`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': o.help = true; break;
      case '--pack': o.pack = val(i); i++; break;
      case '--voice': o.voice = val(i); i++; break;
      case '--name': o.name = val(i); i++; break;
      case '--model': o.model = val(i); i++; break;
      case '--format': o.format = val(i); i++; break;
      case '--only-missing': o.onlyMissing = true; break;
      case '--limit': o.limit = Math.max(1, parseInt(val(i), 10) || 1); i++; break;
      case '--concurrency': o.concurrency = Math.min(8, Math.max(1, parseInt(val(i), 10) || 3)); i++; break;
      case '--dry-run': o.dryRun = true; break;
      default: throw new Error(`Opción desconocida: ${a}`);
    }
  }
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function exists(file) {
  try { return (await stat(file)).size > 0; } catch { return false; }
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

async function writeAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

class ApiError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    this.status = status;
  }
}

async function tts({ text, voice, model, format, key }) {
  const url = `${API}/${encodeURIComponent(voice)}?output_format=${encodeURIComponent(format)}`;
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: model, voice_settings: VOICE_SETTINGS }),
      });
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw err;
      await sleep(backoff(attempt));
      continue;
    }
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const body = await res.text().catch(() => '');
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt >= MAX_ATTEMPTS) throw new ApiError(res.status, body);
    const ra = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff(attempt));
  }
}

function backoff(attempt) {
  return Math.min(30000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
}

async function dirSize(dir) {
  let total = 0;
  try {
    for (const f of await readdir(dir)) if (f.endsWith('.mp3')) total += (await stat(path.join(dir, f))).size;
  } catch { /* carpeta vacía */ }
  return total;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || process.argv.length <= 2) { process.stdout.write(HELP); return; }
  if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(o.pack)) throw new Error('--pack debe ser un id corto: minúsculas, números, - y _ (p. ej. "laura")');
  if (!o.voice) throw new Error('Falta --voice <voiceId>');
  const key = process.env.ELEVENLABS_API_KEY || '';
  if (!o.dryRun && !key) throw new Error('Define ELEVENLABS_API_KEY en el entorno (ElevenLabs → Profile → API Keys)');

  const manifest = await readJson(MANIFEST, null);
  if (!manifest || !Array.isArray(manifest.clips)) throw new Error('No encuentro audio/manifest.json: ejecuta antes node tools/build-audio-manifest.mjs');
  const dir = path.join(PACKS_DIR, o.pack);

  const todo = [];
  for (const c of manifest.clips) {
    if (!c?.id || !c?.text) continue;
    if (o.onlyMissing && await exists(path.join(dir, `${c.id}.mp3`))) continue;
    todo.push(c);
    if (todo.length >= o.limit) break;
  }
  const chars = todo.reduce((n, c) => n + c.text.length, 0);
  process.stdout.write(`Pack «${o.pack}» · voz ${o.voice} · ${o.model} · ${todo.length} clips · ${chars} caracteres\n`);
  if (o.dryRun) { process.stdout.write('(dry-run: no se ha llamado a la API)\n'); return; }
  await mkdir(dir, { recursive: true });

  let done = 0;
  let failed = 0;
  let fatal = null;
  let next = 0;
  const worker = async () => {
    while (!fatal && next < todo.length) {
      const c = todo[next++];
      try {
        const mp3 = await tts({ text: c.text, voice: o.voice, model: o.model, format: o.format, key });
        await writeAtomic(path.join(dir, `${c.id}.mp3`), mp3);
        done++;
      } catch (err) {
        failed++;
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) fatal = err;
        process.stderr.write(`\n✗ ${c.id} («${c.text}»): ${err.message}\n`);
      }
      if ((done + failed) % 10 === 0 || done + failed === todo.length) {
        process.stdout.write(`\r  ${done + failed}/${todo.length} · ${failed} errores`);
      }
    }
  };
  await Promise.all(Array.from({ length: o.concurrency }, worker));
  process.stdout.write('\n');
  if (fatal) throw new Error(`La API rechazó la clave (${fatal.message}). Revisa ELEVENLABS_API_KEY.`);

  // index.json con los clips presentes en disco y en el manifiesto
  const present = [];
  for (const c of manifest.clips) if (await exists(path.join(dir, `${c.id}.mp3`))) present.push(c.id);
  const prevIndex = await readJson(path.join(dir, 'index.json'), {});
  const nowIso = new Date().toISOString();
  const index = {
    id: o.pack,
    name: o.name || prevIndex.name || o.pack,
    voiceId: o.voice,
    model: o.model,
    format: o.format,
    manifestVersion: manifest.version ?? null,
    createdAt: prevIndex.createdAt || nowIso,
    updatedAt: nowIso,
    clips: present,
  };
  await writeAtomic(path.join(dir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

  const packs = await readJson(PACKS_JSON, []);
  const list = Array.isArray(packs) ? packs.filter((p) => p?.id !== o.pack) : [];
  const bytes = await dirSize(dir);
  list.push({
    id: o.pack, name: index.name, voiceId: o.voice, model: o.model, count: present.length,
    complete: present.length === manifest.clips.length, sizeMB: Math.round(bytes / 1e5) / 10, updatedAt: nowIso,
  });
  list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
  await writeAtomic(PACKS_JSON, `${JSON.stringify(list, null, 2)}\n`);

  const missing = manifest.clips.length - present.length;
  process.stdout.write(`✓ ${done} generados · ${failed} errores · ${present.length}/${manifest.clips.length} en el pack (${(bytes / 1e6).toFixed(1)} MB)\n`);
  if (missing) process.stdout.write(`  Faltan ${missing}: repite con --only-missing para completarlo.\n`);
  if (failed) process.exitCode = 2;
}

main().catch((err) => {
  process.stderr.write(`✗ ${err?.message || err}\n`);
  process.exit(1);
});
