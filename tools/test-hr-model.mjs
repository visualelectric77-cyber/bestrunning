#!/usr/bin/env node
// RITMUP · pruebas del modelo pulso–velocidad (js/training/hr-model.js).
import { buildHrModel, sessionHrOffset, steadyPoints } from '../js/training/hr-model.js';
let n = 0; let bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log(`  ✗ ${m}`); } };
const now = Date.parse('2026-10-24T09:00:00Z');
// sesión: 10 min a v1 y 10 min a v2, pulso = 60 + 9·v (+ extra)
const ses = (id, daysAgo, v1, v2, extra = 0) => {
  const hrSeries = [];
  for (let t = 0; t < 1200; t += 10) hrSeries.push([t, Math.round(60 + 9 * (t < 600 ? v1 : v2) + extra)]);
  return { id, startedAt: new Date(now - daysAgo * 86400000).toISOString(), hrSeries, speedTrace: [[0, v1], [600, v2]] };
};
ok(steadyPoints(ses('x', 1, 8, 10)).every(([v]) => v === 8 || v === 10), 'puntos estables con su velocidad');
ok(steadyPoints({ hrSeries: [[0, 140]], speedTrace: [[0, 8]] }).length === 0, 'pocos datos: nada');
const hist = [ses('a', 3, 8, 10), ses('b', 6, 8.5, 11), ses('c', 10, 7.5, 9.5)];
const m = buildHrModel(hist, { now });
ok(m && Math.abs(m.b - 9) < 0.5 && Math.abs(m.at(10) - 150) < 2, `aprende la pendiente (${m && m.b.toFixed(2)}) y el pulso a 10 km/h (${m && m.at(10).toFixed(1)})`);
ok(buildHrModel([ses('a', 3, 8, 10)], { now }) === null, 'una sola sesión: sin modelo');
ok(buildHrModel([ses('a', 90, 8, 10), ses('b', 95, 8, 10)], { now }) === null, 'sesiones viejas no cuentan');
const sick = ses('d', 0, 8.3, 8.3, 9);
const off = sessionHrOffset(sick, buildHrModel(hist, { now, exceptId: 'd' }));
ok(off && off.ppm >= 8 && off.ppm <= 10 && off.speed === 8.3, `día cargado: +${off && off.ppm} ppm a ${off && off.speed} km/h`);
const fine = sessionHrOffset(ses('e', 0, 8.3, 8.3), m);
ok(fine && Math.abs(fine.ppm) <= 1, 'día normal: ~0 ppm');
console.log(bad ? `✗ ${n - bad} OK, ${bad} fallos` : `✓ modelo pulso–velocidad: ${n} comprobaciones`);
process.exitCode = bad ? 1 : 0;
