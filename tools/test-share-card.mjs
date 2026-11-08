#!/usr/bin/env node
// RITMUP · la tarjeta para compartir dibuja lo que corriste de verdad. node tools/test-share-card.mjs
import { realProfile } from '../js/integrations/share-card.js';

let n = 0;
let bad = 0;
const ok = (c, msg) => { n++; if (!c) { bad++; console.log(`  ✗ ${msg}`); } };

const plan = [{ zone: 'warmup', speed: 8, sec: 60 }, { zone: 'run', speed: 9.5, sec: 120 }, { zone: 'fast', speed: 9.5, sec: 60 }, { zone: 'cooldown', speed: 7, sec: 60 }];
// la velocidad bajó dentro del tramo «run» y la rampa fue a 8,7 en vez de 9,5
const trace = [[0, 8], [60, 8], [60, 8.7], [110.1, 8.7], [110.1, 8.6], [110.2, 8.2], [180, 8.2], [180, 8.7], [240, 8.7], [240, 6.3], [300, 6.3]];
const p = realProfile({ speedTrace: trace }, plan);
ok(p.some((x) => x.speed === 8.2 && x.zone === 'run'), 'sale la velocidad real a la que bajaste');
ok(p.every((x) => x.speed !== 9.5), 'no sale la velocidad del plan');
ok(p.some((x) => x.speed === 8.7 && x.zone === 'fast'), 'el color es el del tramo que tocaba');
ok(p.every((x) => x.t1 - x.t0 >= 0.5), 'los toques de 0,1 s no son barras');
ok(p.at(-1).t1 === 300, 'acaba donde acabaste');

const early = realProfile({ speedTrace: [[0, 8], [60, 8], [60, 9], [100, 9]] }, plan);
ok(early.at(-1).t1 === 100, 'clase terminada antes: solo lo corrido');

const sk = realProfile({ speedTrace: [[0, 8], [60, 8], [60, 9], [100, 9], [240, 9], [240, 6.3], [300, 6.3]], skips: [[100, 240]] }, plan);
ok(sk.every((x) => !(x.t0 < 200 && x.t1 > 120)), 'lo saltado no se dibuja');
ok(realProfile({ speedTrace: [[0, 8], [60, 8]], skips: [{ from: 10, to: 20 }] }, plan).length === 2, 'saltos con formato {from, to}');

ok(realProfile({}, plan).length === 0, 'sin trazado: el plan como antes');
const noPlan = realProfile({ speedTrace: [[0, 7], [60, 7], [60, 11], [120, 11], [120, 7], [180, 7]] }, []);
ok(noPlan[0].zone === 'warmup' && noPlan[1].zone === 'fast' && noPlan[2].zone === 'cooldown', 'sin plan: zona por velocidad');

console.log(bad ? `✗ ${n - bad} OK, ${bad} fallos` : `✓ tarjeta real: ${n} comprobaciones`);
process.exit(bad ? 1 : 0);
