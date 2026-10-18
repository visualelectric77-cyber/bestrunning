#!/usr/bin/env node
// BestRunning · cliente del puente del grabador.  node tools/capture/ctl.mjs '{"op":"eval","js":"1+1"}' [más órdenes…]
// Atajos: node tools/capture/ctl.mjs eval '<js>' · tap '<selector|text=…>' · settle <ms> · shot <archivo>
const port = Number(process.env.CAP_BRIDGE) || 9421;
const a = process.argv.slice(2);
let cmds = [];
if (a[0] && a[0].trim().startsWith('{')) cmds = a.map((x) => JSON.parse(x));
else if (a[0] === 'eval') cmds = [{ op: 'eval', js: a[1] }];
else if (a[0] === 'tap') cmds = [{ op: 'tap', sel: a[1] }];
else if (a[0] === 'settle') cmds = [{ op: 'settle', ms: Number(a[1]) }];
else if (a[0] === 'shot') cmds = [{ op: 'shot', file: a[1] }];
else if (a[0] === 'logs') cmds = [{ op: 'logs' }];
else if (a[0] === 'nav') cmds = [{ op: 'nav', url: a[1] }];
for (const c of cmds) {
  const r = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: JSON.stringify(c) });
  const j = await r.json();
  const v = j.ok ? j.value : `ERROR ${j.error}`;
  console.log(typeof v === 'string' ? v : JSON.stringify(v));
  if (!j.ok) process.exitCode = 1;
}
