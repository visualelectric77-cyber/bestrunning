// BestRunning · cliente mínimo del protocolo DevTools (sin dependencias: WebSocket nativo de Node ≥ 22) y utilidades
// del grabador de vídeos (tools/capture/). Lanza un Chrome headless propio (perfil nuevo = origen limpio), inyecta el
// reloj virtual (vclock.js) y graba fotograma a fotograma con Page.captureScreenshot → ffmpeg (H.264 yuv420p).
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..', '..');
export const OUT = join(ROOT, 'docs', 'launch', 'footage');
export const PORT = Number(process.env.CAP_PORT) || 9420;
const CHROME = process.env.CAP_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function chromeUp(port = PORT) {
  try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); return r.ok; } catch { return false; }
}

/** Lanza Chrome headless (GPU por Metal/ANGLE para WebGL) con un perfil propio. Devuelve cuando responde. */
export async function launchChrome({ port = PORT, profile = process.env.CAP_PROFILE } = {}) {
  if (await chromeUp(port)) return;
  if (!profile) throw new Error('CAP_PROFILE: carpeta del perfil (p. ej. en el scratchpad)');
  mkdirSync(profile, { recursive: true });
  const args = [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars', '--force-color-profile=srgb',
    '--lang=es-ES', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-features=PaintHolding,Translate', '--window-size=500,1000',
    'about:blank',
  ];
  const p = spawn(CHROME, args, { detached: true, stdio: 'ignore' });
  p.unref();
  for (let i = 0; i < 60; i++) { if (await chromeUp(port)) return; await sleep(250); }
  throw new Error('Chrome no responde');
}

export async function connect({ port = PORT, match = null } = {}) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  let t = list.find((x) => x.type === 'page' && (!match || x.url.includes(match))) || list.find((x) => x.type === 'page');
  if (!t) t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pend = new Map();
  const handlers = new Map();
  const logs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { const { res, rej } = pend.get(d.id); pend.delete(d.id); if (d.error) rej(new Error(`${d.error.message} ${d.error.data || ''}`)); else res(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') logs.push(`EXC ${d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text}`.slice(0, 700));
    if (d.method === 'Runtime.consoleAPICalled' && /error|warn/.test(d.params.type)) logs.push(`${d.params.type} ${d.params.args.map((a) => a.value ?? a.description).join(' ')}`.slice(0, 500));
    for (const fn of handlers.get(d.method) || []) fn(d.params);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const on = (method, fn) => { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(fn); };
  await send('Runtime.enable');
  await send('Page.enable');
  const page = {
    send, on, logs, ws, target: t,
    close: () => ws.close(),
    async eval(expression, { timeout = 600000 } = {}) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout, userGesture: true });
      if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      return r.result?.value;
    },
  };
  return page;
}

/** Métricas de iPhone Pro Max (430×932 pt @3 = 1290×2796) con zonas seguras de iOS. */
export async function setPhone(page, { land = false, w = 430, h = 932, dpr = 3, insets: ins = null } = {}) {
  const width = land ? h : w;
  const height = land ? w : h;
  await page.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: dpr, mobile: true,
    screenOrientation: land ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 },
  });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }).catch(() => {});
  // Isla dinámica + indicador de inicio (iPhone Pro Max): vertical 62/34, horizontal 0/21 con 62 a los lados
  // `ins` (opcional) = { top, bottom, side } en vertical para otros modelos (SE: 20/0/0)
  const insets = ins
    ? (land ? { top: 0, bottom: ins.landBottom ?? ins.bottom ?? 0, left: ins.side ?? 0, right: ins.side ?? 0 } : { top: ins.top ?? 0, bottom: ins.bottom ?? 0, left: 0, right: 0 })
    : (land ? { top: 0, bottom: 21, left: 62, right: 62 } : { top: 62, bottom: 34, left: 0, right: 0 });
  let safe = false;
  try { await page.send('Emulation.setSafeAreaInsetsOverride', { insets }); safe = true; } catch { safe = false; }
  return { width, height, safe };
}

/** Registra el reloj virtual para los documentos siguientes (antes que cualquier script de la app). */
export async function installClock(page, cfg) {
  const src = `window.__VC_CFG = ${JSON.stringify(cfg)};\n${readFileSync(join(HERE, 'vclock.js'), 'utf8')}`;
  const r = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: src });
  return r.identifier;
}

export async function navigate(page, url, { settleMs = 1500, realWait = 1200 } = {}) {
  await page.send('Page.navigate', { url });
  await sleep(realWait);
  await settle(page, settleMs);
}

/** Avanza el reloj virtual `ms` a 60 Hz dejando tiempo real para red y módulos (cargas, decodificación…). */
export async function settle(page, ms = 1000, { step = 1000 / 60, realEvery = 6, realMs = 15 } = {}) {
  let k = 0;
  for (let t = 0; t < ms; t += step) {
    await page.eval(`window.__vc ? __vc.advance(${step}) : 0`);
    if (++k % realEvery === 0) await sleep(realMs);
  }
}

/** Centro de un elemento (CSS px) o null. sel puede ser un selector o un texto ("text=Siguiente"). */
export async function rectOf(page, sel) {
  return page.eval(`(() => {
    const q = ${JSON.stringify(sel)};
    let el = null;
    if (q.startsWith('text=')) {
      const want = q.slice(5).trim().toLowerCase();
      const all = [...document.querySelectorAll('button, a, [role=button], [data-act], [data-href], label, li, .card, h1, h2, h3, span, div')];
      el = all.filter((e) => e.offsetParent !== null && (e.textContent || '').trim().toLowerCase() === want).pop()
        || all.filter((e) => e.offsetParent !== null && (e.textContent || '').trim().toLowerCase().startsWith(want)).pop();
    } else el = document.querySelector(q);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, top: r.top, left: r.left };
  })()`);
}

export async function tapXY(page, x, y) {
  const base = { x, y, button: 'left', clickCount: 1 };
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  await page.eval('window.__vc && __vc.driveAnimations()').catch(() => {});
}

export async function tap(page, sel) {
  const r = await rectOf(page, sel);
  if (!r) throw new Error(`no encuentro ${sel}`);
  await tapXY(page, r.x, r.y);
  return r;
}

export async function shot(page, file, { format = 'jpeg', quality = 92 } = {}) {
  const r = await page.send('Page.captureScreenshot', { format, quality: format === 'jpeg' ? quality : undefined, optimizeForSpeed: false });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

/**
 * Graba `seconds` a `fps` (cada fotograma = 1/fps s de reloj virtual en `sub` subpasos con rAF) y lo codifica con
 * ffmpeg: H.264 High, yuv420p, CRF 14, 30 fps, faststart. perFrame: JS evaluado antes de cada captura con
 * variables p (0..1) y k (n.º de fotograma) — p. ej. para desplazar una lista con suavidad.
 */
export async function record(page, file, { seconds = 5, fps = 30, sub = 2, quality = 94, perFrame = null, before = null, crf = 14, actions = [] } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(fps),
    '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error(`ffmpeg ${c}`)))));
  const n = Math.round(seconds * fps);
  const t0 = Date.now();
  if (before) await page.eval(before);
  try {
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < sub; j++) await page.eval(`__vc.advance(${1000 / (fps * sub)})`);
    if (perFrame) await page.eval(`(() => { const p = ${n > 1 ? k / (n - 1) : 1}; const k = ${k}; ${perFrame} })(); __vc.driveAnimations();`);
    // acciones de usuario reales (ratón por CDP) en fotogramas concretos: { k, tap: selector } | { k, x, y } | { k, js }
    for (const a of actions.filter((x) => x.k === k)) {
      if (a.tap) await tap(page, a.tap);
      else if (a.x != null) await tapXY(page, a.x, a.y);
      if (a.js) await page.eval(`(() => { ${a.js} })(); __vc.driveAnimations();`);
    }
    const r = await page.send('Page.captureScreenshot', { format: 'jpeg', quality });
    if (!ff.stdin.write(Buffer.from(r.data, 'base64'))) await new Promise((res) => ff.stdin.once('drain', res));
  }
  } catch (e) {
    ff.stdin.end();
    await done.catch(() => {});
    throw e;
  }
  ff.stdin.end();
  await done;
  return { file, frames: n, sec: n / fps, realSec: (Date.now() - t0) / 1000 };
}

export function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); return d; }
