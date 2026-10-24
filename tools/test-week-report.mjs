// RITMUP · tests del informe semanal de la IA (js/training/week-report.js): node tools/test-week-report.mjs
import { weekReportInput } from '../js/training/week-report.js';
import { numbersAreGrounded } from '../js/integrations/ai.js';

let n = 0;
let bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log(`  ✗ ${m}`); } };
const now = new Date('2026-10-24T10:00:00');

ok(weekReportInput({ history: [] }, now) === null, 'sin sesiones esta semana ⇒ null');
ok(weekReportInput({ history: [{ dayKey: '2026-10-14', elapsedSec: 1500, distanceKm: 4 }] }, now) === null, 'solo la semana pasada ⇒ null');

const st = { history: [
  { id: 'a', dayKey: '2026-10-20', elapsedSec: 1500, distanceKm: 4.1 },
  { id: 'b', dayKey: '2026-10-22', elapsedSec: 3000, distanceKm: 8.3 },
  { id: 't', dayKey: '2026-10-23', elapsedSec: 900, distanceKm: 2, isTest: true },
  { id: 'c', dayKey: '2026-10-14', elapsedSec: 1500, distanceKm: 4 },
] };
const r = weekReportInput(st, now, { readiness: 'amber', goal: '10K el 15 de marzo' });
ok(r && r.week === '2026-10-19', 'semana del lunes 19');
ok(r.input.minutes === 75 && r.input.km === 12.4, `minutos y km sin el test (dio ${r.input.minutes} / ${r.input.km})`);
ok(r.input.avgKmh === 9.9 && r.input.longestMin === 50, 'media y clase más larga');
ok(r.input.sessions >= 2, 'sesiones hechas');
ok(r.input.readiness === 'amber' && r.input.goal === '10K el 15 de marzo', 'semáforo y objetivo');
ok(r.input.vsPrev && r.input.vsPrev.km === 8.4 && r.input.vsPrev.minutes === 50, 'frente a la semana anterior');
ok(numbersAreGrounded('Has corrido 12,4 km en 75 min, 8,4 km más que la semana pasada.', r.allowed), 'cifras reales: vale');
ok(!numbersAreGrounded('Has corrido 13 km en 75 min.', r.allowed), 'cifra inventada: se descarta');
ok(numbersAreGrounded('Vas a por tu 10K del 15 de marzo.', r.allowed), 'las cifras del objetivo valen');
ok(r.sig !== weekReportInput({ history: [...st.history, { id: 'd', dayKey: '2026-10-24', elapsedSec: 1200, distanceKm: 3 }] }, now).sig, 'una sesión nueva cambia la firma');

console.log(`${bad ? '✗' : '✓'} informe semanal: ${n - bad}/${n} comprobaciones`);
process.exit(bad ? 1 : 0);
