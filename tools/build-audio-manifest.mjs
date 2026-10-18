#!/usr/bin/env node
// BestRunning · genera audio/manifest.json: todos los clips que puede necesitar un pack de voz.
// Fragmentos estáticos de js/audio/phrases.js + números, decimales (velocidades 0,1–30,9), duraciones,
// zonas, unidades, títulos de las plantillas (si js/training/templates.js existe) y textos extra (--extra).
//
// Uso: node tools/build-audio-manifest.mjs [--extra "Nacho"]... [--no-titles] [--out audio/manifest.json]
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { manifestClips } from '../js/audio/phrases.js';
import { hashStr } from '../js/core/utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { extras: [], titles: true, out: path.join(ROOT, 'audio', 'manifest.json'), help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--extra') out.extras.push(String(argv[++i] ?? ''));
    else if (a.startsWith('--extra=')) out.extras.push(a.slice(8));
    else if (a === '--no-titles') out.titles = false;
    else if (a === '--out') out.out = path.resolve(ROOT, String(argv[++i] ?? ''));
    else throw new Error(`Opción desconocida: ${a}`);
  }
  out.extras = out.extras.map((s) => s.trim()).filter(Boolean);
  return out;
}

const HELP = `Genera audio/manifest.json (lista de clips { id, text } para packs de voz).

  node tools/build-audio-manifest.mjs [opciones]

  --extra "texto"   Añade un clip de texto libre (repetible). Útil para tu nombre: --extra "Nacho"
  --no-titles       No intenta añadir los títulos de js/training/templates.js
  --out <ruta>      Ruta de salida (por defecto audio/manifest.json)
  -h, --help        Muestra esta ayuda
`;

async function templateTitles() {
  try {
    const mod = await import(pathToFileURL(path.join(ROOT, 'js', 'training', 'templates.js')).href);
    const titles = [];
    for (const t of Array.isArray(mod.TEMPLATES) ? mod.TEMPLATES : []) if (t?.title) titles.push(String(t.title));
    for (const c of Object.values(mod.CATEGORIES || {})) if (c?.name) titles.push(String(c.name));
    return titles;
  } catch {
    return null;
  }
}

function render(manifest) {
  const head = { ...manifest };
  delete head.clips;
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  const clips = manifest.clips.map((c, i) => `    ${JSON.stringify(c)}${i < manifest.clips.length - 1 ? ',' : ''}`);
  return `{\n${lines.join('\n')}\n  "clips": [\n${clips.join('\n')}\n  ]\n}\n`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { process.stdout.write(HELP); return; }
  let titles = [];
  if (opts.titles) {
    const t = await templateTitles();
    if (t) titles = t;
    else process.stdout.write('Aviso: js/training/templates.js aún no se puede importar; el manifiesto va sin títulos de clase.\n');
  }
  const clips = manifestClips({ titles, extras: opts.extras }).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  const chars = clips.reduce((n, c) => n + c.text.length, 0);
  const version = hashStr(clips.map((c) => `${c.id}=${c.text}`).join('\n')).toString(36);
  const manifest = { version, count: clips.length, chars, titles: titles.length, extras: opts.extras.length, clips };
  await mkdir(path.dirname(opts.out), { recursive: true });
  await writeFile(opts.out, render(manifest), 'utf8');
  const rel = path.relative(ROOT, opts.out) || opts.out;
  process.stdout.write(`✓ ${rel}: ${clips.length} clips · ${chars} caracteres · versión ${version}\n`);
}

main().catch((err) => {
  process.stderr.write(`✗ ${err?.message || err}\n`);
  process.exit(1);
});
