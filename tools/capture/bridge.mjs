#!/usr/bin/env node
// BestRunning · puente del grabador: mantiene UNA sesión DevTools abierta con el Chrome headless (la emulación del
// iPhone y el reloj virtual viven mientras dure la sesión) y recibe órdenes por HTTP local (tools/capture/ctl.mjs).
//   CAP_PROFILE=<carpeta> node tools/capture/bridge.mjs [puertoHttp=9421]
// Órdenes (POST / con JSON): { op: 'setup', land, epoch, hour } · { op: 'nav', url, settle } · { op: 'eval', js }
//   { op: 'tap', sel } · { op: 'tapxy', x, y } · { op: 'settle', ms } · { op: 'ff', ms, step } · { op: 'shot', file }
//   { op: 'rec', file, seconds, perFrame, before, sub } · { op: 'logs' } · { op: 'metrics', land }
import { createServer } from 'node:http';
import { launchChrome, connect, setPhone, installClock, navigate, settle, tap, tapXY, shot, record, ROOT } from './cdp.mjs';
import { resolve } from 'node:path';

const port = Number(process.argv[2]) || 9421;
await launchChrome();
let page = await connect();
let clockId = null;
const injIds = [];

async function handle(c) {
  switch (c.op) {
    case 'setup': {
      if (clockId) { await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clockId }).catch(() => {}); clockId = null; }
      // opcional: { w, h, dpr, insets: { top, bottom, side, landBottom }, scheme: 'light'|'dark' } (por defecto Pro Max oscuro)
      const m = await setPhone(page, { land: !!c.land, ...(c.w ? { w: c.w, h: c.h } : {}), ...(c.dpr ? { dpr: c.dpr } : {}), ...(c.insets ? { insets: c.insets } : {}) });
      if (c.clock !== false) clockId = await installClock(page, { epoch: c.epoch ? new Date(c.epoch).getTime() : Date.now(), hour: c.hour ?? null });
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: c.scheme || 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] }).catch(() => {});
      return m;
    }
    case 'metrics': return setPhone(page, { land: !!c.land, ...(c.w ? { w: c.w, h: c.h } : {}), ...(c.insets ? { insets: c.insets } : {}) });
    case 'nav': await navigate(page, c.url, { settleMs: c.settle ?? 1500, realWait: c.realWait ?? 1200 }); return page.eval('location.href');
    case 'eval': return page.eval(c.js);
    case 'tap': return tap(page, c.sel);
    case 'tapxy': await tapXY(page, c.x, c.y); return true;
    case 'settle': await settle(page, c.ms ?? 1000, c.realEvery ? { realEvery: c.realEvery, realMs: c.realMs ?? 15 } : {}); return page.eval('__vc.now');
    case 'ff': return page.eval(`__vc.fastForward(${Number(c.ms) || 0}, ${Number(c.step) || 250})`);
    case 'shot': return shot(page, resolve(ROOT, c.file), { format: c.format || 'jpeg', quality: c.quality || 90 });
    case 'rec': return record(page, resolve(ROOT, c.file), { seconds: c.seconds ?? 5, perFrame: c.perFrame || null, before: c.before || null, sub: c.sub ?? 2, quality: c.quality ?? 94, actions: c.actions || [] });
    case 'logs': { const l = page.logs.splice(0); return l; }
    // guion previo a la app en cada documento nuevo (p. ej. simular la app nativa) · { op: 'inject', js } · { op: 'uninject' }
    case 'inject': injIds.push((await page.send('Page.addScriptToEvaluateOnNewDocument', { source: c.js })).identifier); return injIds.length;
    case 'uninject': for (const id of injIds.splice(0)) await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }).catch(() => {}); return true;
    case 'reconnect': page.close(); page = await connect(); clockId = null; return true;
    default: throw new Error(`orden desconocida ${c.op}`);
  }
}

let chain = Promise.resolve();
createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    chain = chain.then(async () => {
      let out;
      try { out = { ok: true, value: await handle(JSON.parse(body || '{}')) }; } catch (e) { out = { ok: false, error: String(e && e.stack || e) }; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
}).listen(port, '127.0.0.1', () => process.stdout.write(`puente del grabador en http://127.0.0.1:${port}\n`));
