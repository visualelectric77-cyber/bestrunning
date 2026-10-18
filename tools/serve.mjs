#!/usr/bin/env node
// BestRunning · servidor estático de desarrollo (sin dependencias) con soporte de rangos (206).
// `python3 -m http.server` no admite Range: el <audio> no puede saltar dentro de una pista (seekable vacío) y el
// motor DJ no puede colocar los drops ni retomar discos. Este servidor sí, igual que GitHub Pages.
//   node tools/serve.mjs [puerto=8095] [--host 0.0.0.0]
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a))) || Number(process.env.PORT) || 8095;
const hostIdx = args.indexOf('--host');
const host = hostIdx >= 0 ? args[hostIdx + 1] : '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
};

function send(res, status, body = '', headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, 'Método no permitido'); return; }
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    send(res, 400, 'Ruta no válida');
    return;
  }
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
  // Sin caché HTTP: cada recarga ve los archivos recién editados (el service worker hace su propia caché)
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Last-Modified': st.mtime.toUTCString() };
  const size = st.size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').split(',')[0].trim());
  if (m && (m[1] !== '' || m[2] !== '')) {
    let start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    let end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
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
  process.stdout.write(`BestRunning · http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/ (con rangos 206)\n`);
});
