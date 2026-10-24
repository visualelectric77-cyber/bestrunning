#!/usr/bin/env node
// RITMUP · pruebas de marcas estimadas y FC máxima medida (js/training/race-predict.js).
import { predictRaces, fmtRaceTime, measuredHrMax, raisedHrMax } from '../js/training/race-predict.js';
let n = 0; let bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log(`  ✗ ${m}`); } };
const r = predictRaces(16);
ok(r.length === 3 && r[0].key === '5k' && r[2].key === '21k', 'tres distancias');
ok(r.every((x) => x.fastSec < x.slowSec), 'rango rápido < lento');
ok(r[0].fastSec > 18 * 60 && r[0].slowSec < 23 * 60, `5K con VAM 16: ${fmtRaceTime(r[0].fastSec)}–${fmtRaceTime(r[0].slowSec)}`);
ok(r[1].fastSec > r[0].slowSec, '10K más lento que 5K');
ok(predictRaces(0).length === 0 && predictRaces(40).length === 0, 'VAM absurda: nada');
ok(fmtRaceTime(3725) === '1:02:05' && fmtRaceTime(1361) === '22:41', 'formato de tiempo');
const ser = (vals) => ({ hrSeries: vals.map((b, i) => [i * 10, b]) });
ok(measuredHrMax(ser([150, 160, 170, 181, 186, 190])) === 186, 'un pico suelto no cuenta (2.º más alto)');
ok(measuredHrMax(ser([120, 130])) === null, 'pocas lecturas: nada');
ok(measuredHrMax(ser([200, 230, 240, 238, 239, 235])) === null, 'imposible: nada');
ok(raisedHrMax(180, ser([150, 160, 170, 181, 186, 190])) === 186, 'sube si la medida es mayor');
ok(raisedHrMax(190, ser([150, 160, 170, 181, 186, 190])) === null, 'nunca baja');
console.log(bad ? `✗ ${n - bad} OK, ${bad} fallos` : `✓ marcas y FC máx.: ${n} comprobaciones`);
process.exitCode = bad ? 1 : 0;
