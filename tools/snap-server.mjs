#!/usr/bin/env node
// BestRunning · servidor de desarrollo del laboratorio 3D (sin dependencias).
//  - Estático con soporte de rangos (206), como tools/serve.mjs / GitHub Pages, sin caché HTTP.
//  - POST /__snap/<nombre>.jpg  (cuerpo = JPEG)  → guarda en docs/capturas/3d/<nombre>.jpg
//    (lo usa window.lab.snap() de tools/scene-lab.html para las capturas deterministas).
//  - POST /__snap/<carpeta>/<sub>/<nombre>.jpg → docs/capturas/3d/<carpeta>/<sub>/<nombre>.jpg (subcarpetas creadas
//    al vuelo; cada tramo saneado igual que el nombre). window.lab.record() sube así sus fotogramas:
//    /__snap/rec/<vídeo>/00001.jpg → docs/capturas/3d/rec/<vídeo>/00001.jpg (luego ffmpeg los monta).
//  - GET /__exists/<ruta>  → { exists } (módulos opcionales como tools/hud-mock.js sin errores 404 en consola).
//  - POST /__snap/audio/<nombre>.wav (WAV RIFF) y /__snap/report/<nombre>.json (JSON) → docs/audio-tests/<nombre>.*
//    (los usa tools/music-offline.html: render offline del motor DJ y su informe de huecos/clics/sonoridad).
//   node tools/snap-server.mjs [puerto=8096] [--host 127.0.0.1]
import { createServer } from 'node:http';
import { createReadStream, statSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'capturas', '3d');
const AUDIO_OUT = join(ROOT, 'docs', 'audio-tests');
const MAX_AUDIO = 96 * 1024 * 1024;
const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a))) || Number(process.env.PORT) || 8096;
const hostIdx = args.indexOf('--host');
const host = hostIdx >= 0 ? args[hostIdx + 1] : '127.0.0.1';
const MAX_BODY = 25 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
  '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
};

function send(res, status, body = '', headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

/** 'Cordillera Sprint 01.jpg' → 'cordillera-sprint-01.jpg' (solo [a-z0-9._-], sin rutas, máx. 96). null si no vale. */
function safeName(raw) {
  let n = String(raw || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  n = n.replace(/\.jpe?g$/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[-.]+|[-.]+$/g, '');
  if (!n || n.length > 96) return null;
  return `${n}.jpg`;
}

/** 'rec/Aurora Demo/00001.jpg' → ['rec', 'aurora-demo', '00001.jpg'] (máx. 4 tramos, sin '..'). null si no vale. */
function safePath(raw) {
  const parts = String(raw || '').split('/').filter(Boolean);
  if (!parts.length || parts.length > 4) return null;
  const dirs = parts.slice(0, -1).map((d) => (safeName(d) || '').replace(/\.jpg$/, ''));
  const file = safeName(parts[parts.length - 1]);
  if (!file || dirs.some((d) => !d || d.startsWith('.'))) return null;
  return [...dirs, file];
}

function saveSnap(req, res, name) {
  const segs = safePath(name);
  if (!segs) { send(res, 400, 'Nombre no válido'); return; }
  const file = segs.join('/');
  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on('data', (c) => {
    if (aborted) return;
    size += c.length;
    if (size > MAX_BODY) { aborted = true; send(res, 413, 'Demasiado grande'); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (aborted) return;
    const buf = Buffer.concat(chunks);
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) { send(res, 415, 'Se esperaba un JPEG'); return; }
    try {
      const dest = join(OUT, ...segs);
      if (!dest.startsWith(OUT + sep)) { send(res, 403, 'Prohibido'); return; }
      mkdirSync(dirname(dest), { recursive: true });
      const tmp = `${dest}.tmp`;
      writeFileSync(tmp, buf);
      renameSync(tmp, dest);
      send(res, 200, JSON.stringify({ ok: true, file: `docs/capturas/3d/${file}`, bytes: buf.length }), { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (e) {
      send(res, 500, `No se pudo guardar: ${e.message}`);
    }
  });
  req.on('error', () => { if (!aborted) send(res, 400, 'Error de subida'); });
}

/** 'Pirámide 20′.wav' → 'piramide-20.wav' (solo [a-z0-9._-], sin rutas). null si no vale. */
function safeFile(raw, ext) {
  let n = String(raw || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  n = n.replace(new RegExp(`\\.${ext}$`), '').replace(/[^a-z0-9._-]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[-.]+|[-.]+$/g, '');
  if (!n || n.length > 96) return null;
  return `${n}.${ext}`;
}

/** Guarda un WAV o un informe JSON del laboratorio de audio en docs/audio-tests/. */
function saveAudioTest(req, res, kind, raw) {
  const ext = kind === 'audio' ? 'wav' : 'json';
  const name = safeFile(raw, ext);
  if (!name || raw.includes('/')) { send(res, 400, 'Nombre no válido'); return; }
  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on('data', (c) => {
    if (aborted) return;
    size += c.length;
    if (size > MAX_AUDIO) { aborted = true; send(res, 413, 'Demasiado grande'); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (aborted) return;
    const buf = Buffer.concat(chunks);
    if (kind === 'audio' && (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')) {
      send(res, 415, 'Se esperaba un WAV');
      return;
    }
    if (kind === 'report') {
      try { JSON.parse(buf.toString('utf8')); } catch { send(res, 415, 'Se esperaba JSON'); return; }
    }
    try {
      const dest = join(AUDIO_OUT, name);
      if (!dest.startsWith(AUDIO_OUT + sep)) { send(res, 403, 'Prohibido'); return; }
      mkdirSync(AUDIO_OUT, { recursive: true });
      const tmp = `${dest}.tmp`;
      writeFileSync(tmp, buf);
      renameSync(tmp, dest);
      send(res, 200, JSON.stringify({ ok: true, file: `docs/audio-tests/${name}`, bytes: buf.length }), { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (e) {
      send(res, 500, `No se pudo guardar: ${e.message}`);
    }
  });
  req.on('error', () => { if (!aborted) send(res, 400, 'Error de subida'); });
}

createServer((req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    send(res, 400, 'Ruta no válida');
    return;
  }
  if (path.startsWith('/__exists/')) {
    // ¿existe un archivo del proyecto? (el laboratorio lo consulta antes de importar módulos opcionales: sin 404)
    const f = normalize(join(ROOT, path.slice('/__exists'.length)));
    let exists = false;
    if (f.startsWith(ROOT + sep)) { try { exists = statSync(f).isFile(); } catch { exists = false; } }
    send(res, 200, JSON.stringify({ exists }), { 'Content-Type': 'application/json; charset=utf-8' });
    return;
  }
  if (path.startsWith('/__snap/audio/') || path.startsWith('/__snap/report/')) {
    if (req.method !== 'POST') { send(res, 405, 'Usa POST'); return; }
    const kind = path.startsWith('/__snap/audio/') ? 'audio' : 'report';
    saveAudioTest(req, res, kind, path.slice(`/__snap/${kind}/`.length));
    return;
  }
  if (path.startsWith('/__snap/')) {
    if (req.method !== 'POST') { send(res, 405, 'Usa POST'); return; }
    saveSnap(req, res, path.slice('/__snap/'.length));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, 'Método no permitido'); return; }
  let file = normalize(join(ROOT, path));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) { send(res, 403, 'Prohibido'); return; }
  let st;
  try {
    st = statSync(file);
    if (st.isDirectory()) { file = join(file, 'index.html'); st = statSync(file); }
  } catch {
    send(res, 404, 'No encontrado');
    return;
  }
  const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Last-Modified': st.mtime.toUTCString() };
  const size = st.size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').split(',')[0].trim());
  if (m && (m[1] !== '' || m[2] !== '')) {
    const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start >= size || end < start) { send(res, 416, '', { 'Content-Range': `bytes */${size}` }); return; }
    res.writeHead(206, { ...base, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
    return;
  }
  res.writeHead(200, { ...base, 'Content-Length': size });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
}).listen(port, host, () => {
  process.stdout.write(`BestRunning · laboratorio 3D en http://${host}:${port}/tools/scene-lab.html (capturas → docs/capturas/3d/)\n`);
});
