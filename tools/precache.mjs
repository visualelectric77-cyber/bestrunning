#!/usr/bin/env node
// BestRunning · regenera la lista de precache del service worker y la versión.
//
//   node tools/precache.mjs                 → reescribe ASSETS y BUILD (hash del contenido)
//   node tools/precache.mjs --bump patch    → además sube la versión 1.0.0 → 1.0.1
//   node tools/precache.mjs --bump minor    → 1.0.1 → 1.1.0   (también acepta major)
//   node tools/precache.mjs --dry-run       → muestra el resultado sin escribir
//
// Excluye docs/, tools/, .git, node_modules, *.md, ficheros ocultos (incluidos los "._*" de macOS en discos
// externos), los mp3 de audio/packs/<pack>/ (su index.json SÍ entra) y la música (audio/music/*.m4a,
// audio/music-src/) que se cachean en tiempo de ejecución o no se publican, y las imágenes de arranque de
// assets/splash/ (iOS las lee al instalar).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SW = join(ROOT, 'sw.js');
const VERSION_FILE = join(ROOT, 'js', 'version.js');

const args = process.argv.slice(2);
const bumpIdx = args.indexOf('--bump');
const bump = bumpIdx >= 0 ? args[bumpIdx + 1] : null;
const dryRun = args.includes('--dry-run');

if (bump && !['patch', 'minor', 'major'].includes(bump)) {
  console.error('Uso: node tools/precache.mjs [--bump patch|minor|major] [--dry-run]');
  process.exit(1);
}

const EXCLUDED_DIRS = new Set(['docs', 'tools', '.git', '.github', '.claude', '.vscode', 'node_modules', 'tests', 'test']);
const EXCLUDED_FILES = new Set(['sw.js', 'CNAME', 'LICENSE', 'package.json', 'package-lock.json']);
const EXCLUDED_EXT = /\.(md|py|mjs|map|log|sh|txt|psd|sketch|zip)$/i;

function isExcluded(rel, isDir) {
  const parts = rel.split(sep);
  const name = parts[parts.length - 1];
  if (name.startsWith('.')) return true; // ocultos y AppleDouble "._*"
  if (isDir) {
    if (parts.length === 1 && EXCLUDED_DIRS.has(name)) return true;
    // audio/packs/<pack>/: solo su index.json va al precache (voz grabada sin conexión desde el primer día);
    // los mp3 se cachean en tiempo de ejecución (br-audio). Carpetas internas (_takes, _samples, _raw…) fuera.
    if (parts[0] === 'audio' && parts[1] === 'packs' && parts.length >= 3 && (parts.length > 3 || name.startsWith('_'))) return true;
    if (parts.length === 2 && parts[0] === 'assets' && parts[1] === 'splash') return true;
    // audio/music-src/: fuentes originales de música (en .gitignore, no se publican)
    if (parts.length === 2 && parts[0] === 'audio' && parts[1] === 'music-src') return true;
    return false;
  }
  if (parts.length === 1 && EXCLUDED_FILES.has(name)) return true;
  if (EXCLUDED_EXT.test(name)) return true;
  if (parts[0] === 'audio' && parts[1] === 'packs' && parts.length === 4 && name !== 'index.json') return true;
  // Audio pesado (packs de voz, música DJ): se cachea en tiempo de ejecución (br-audio / br-music), nunca en el precache
  if (/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i.test(name) && parts[0] === 'audio') return true;
  if (rel === join('assets', 'icons', 'icon-1024.png')) return true; // solo fuente
  return false;
}

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = join(dir, e.name);
    const rel = relative(ROOT, abs);
    const isDir = e.isDirectory();
    if (isExcluded(rel, isDir)) continue;
    if (isDir) walk(abs, out);
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

const toUrl = (rel) => './' + rel.split(sep).join('/');

// Lista ordenada: raíz e index primero, luego CSS, JS y el resto.
const files = walk(ROOT);
const rank = (p) => (p === 'index.html' ? 0 : p === 'manifest.webmanifest' ? 1 : p.startsWith('css') ? 2 : p.startsWith('js') ? 3 : 4);
files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
const urls = ['./', ...files.map(toUrl)];

// Versión
let version = '1.0.0';
if (existsSync(VERSION_FILE)) {
  const m = readFileSync(VERSION_FILE, 'utf8').match(/APP_VERSION\s*=\s*['"](\d+)\.(\d+)\.(\d+)['"]/);
  if (m) version = `${m[1]}.${m[2]}.${m[3]}`;
}
if (bump) {
  let [maj, min, pat] = version.split('.').map(Number);
  if (bump === 'major') { maj++; min = 0; pat = 0; }
  else if (bump === 'minor') { min++; pat = 0; }
  else pat++;
  version = `${maj}.${min}.${pat}`;
}

const versionJs = `// Versión de la app (la reescribe tools/precache.mjs; no editar a mano salvo emergencia).\nexport const APP_VERSION = '${version}';\n`;
const versionRel = join('js', 'version.js');

// Hash del contenido ⇒ cualquier cambio genera un sw.js distinto y los iPhone se actualizan.
const hash = createHash('sha256');
let totalBytes = 0;
for (const f of files) {
  // version.js se hashea con su contenido final (tras --bump)
  const buf = f === versionRel ? Buffer.from(versionJs) : readFileSync(join(ROOT, f));
  totalBytes += buf.length;
  hash.update(f);
  hash.update(buf);
}
const build = hash.digest('hex').slice(0, 10);

if (!existsSync(SW)) {
  console.error('No encuentro sw.js en la raíz del proyecto.');
  process.exit(1);
}
let sw = readFileSync(SW, 'utf8');
const START = '/*ASSETS:START*/';
const END = '/*ASSETS:END*/';
const a = sw.indexOf(START);
const b = sw.indexOf(END);
if (a < 0 || b < a) {
  console.error('sw.js no tiene los marcadores /*ASSETS:START*/ … /*ASSETS:END*/.');
  process.exit(1);
}
const list = `[\n${urls.map((u) => `  ${JSON.stringify(u).replace(/"/g, "'")}`).join(',\n')}\n]`;
sw = sw.slice(0, a + START.length) + list + sw.slice(b);
sw = sw.replace(/const VERSION = ['"][^'"]*['"];/, `const VERSION = '${version}';`);
sw = sw.replace(/const BUILD = ['"][^'"]*['"];/, `const BUILD = '${build}';`);

if (dryRun) {
  console.log(list);
} else {
  writeFileSync(SW, sw);
  const prev = existsSync(VERSION_FILE) ? readFileSync(VERSION_FILE, 'utf8') : '';
  if (prev !== versionJs) writeFileSync(VERSION_FILE, versionJs);
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`BestRunning ${version} · build ${build} · ${urls.length} recursos en precache (${kb(totalBytes)})${dryRun ? ' · simulación' : ''}`);
const expected = [
  'js/screens/onboarding.js', 'js/screens/today.js', 'js/screens/plan.js', 'js/screens/library.js',
  'js/screens/workout.js', 'js/screens/progress.js', 'js/screens/history.js', 'js/screens/settings.js',
  'js/screens/player.js', 'js/screens/summary.js', 'css/screens-main.css', 'css/screens-more.css', 'css/player.css',
];
const missing = expected.filter((f) => !existsSync(join(ROOT, f)));
if (missing.length) console.log(`Aviso: aún faltan ${missing.length} archivo(s): ${missing.join(', ')}`);
