// RITMUP · tests del briefing antes de la clase (js/training/briefing.js): node tools/test-briefing.mjs
import { briefingInput } from '../js/training/briefing.js';
import { numbersAreGrounded } from '../js/integrations/ai.js';

let n = 0;
let bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log(`  ✗ ${m}`); } };
const today = '2026-10-26';
const workout = {
  id: 'rodaje~25', title: 'Rodaje con cambios', totalSec: 1500, estDistanceKm: 4.08, maxSpeed: 10.1,
  segments: [
    { zone: 'warmup', speed: 7.1, sec: 240 }, { zone: 'jog', speed: 8.3, sec: 600 },
    { zone: 'run', speed: 10.1, sec: 360 }, { zone: 'jog', speed: 8.3, sec: 120 }, { zone: 'cooldown', speed: 6.5, sec: 180 },
  ],
};
const state = { history: [
  { id: 'a', dayKey: '2026-10-23', elapsedSec: 1500, distanceKm: 4.1, feeling: 'hard' },
  { id: 'b', dayKey: '2026-10-24', elapsedSec: 3000, distanceKm: 7.4, feeling: 'ok' },
], plan: {} };

ok(briefingInput(state, { segments: [] }, { today }) === null, 'sin tramos ⇒ null');
const r = briefingInput(state, workout, { today });
ok(r && r.input.minutes === 25 && r.input.km === 4.1 && r.input.maxKmh === 10.1, 'minutos, km y velocidad máxima');
ok(r.input.zones[0].zone === 'Trotar' && r.input.zones[0].minutes === 12 && r.input.zones[0].kmh === 8.3, `zona principal (dio ${JSON.stringify(r.input.zones)})`);
ok(!r.input.zones.some((z) => /Calent|Enfri|Vuelta/.test(z.zone)), 'sin calentar ni enfriar');
ok(r.input.last.length === 2 && r.input.last[0].daysAgo === 2 && r.input.last[0].feel === 'Cómodo', 'última sesión primero, con su sensación');
ok(!r.input.readiness, 'sin métricas de Salud no hay semáforo');
ok(numbersAreGrounded('Hoy 25 min: el grueso a 8,3 km/h y un cambio a 10,1.', r.allowed), 'cifras reales: vale');
ok(!numbersAreGrounded('Hoy 30 min a 8,5 km/h.', r.allowed), 'cifras inventadas: se descarta');
ok(r.key.startsWith('2026-10-26|rodaje~25|25|'), 'clave del día');
ok(briefingInput(state, workout, { today: '2026-10-27' }).key !== r.key, 'otro día, otra clave');

// player.js: el estado del briefing se declara antes del `return cleanup` de mount (un `let` después daba
// ReferenceError al pintar la Preparación)
const { readFileSync } = await import('node:fs');
const player = readFileSync(new URL('../js/screens/player.js', import.meta.url), 'utf8');
const iLet = player.indexOf('let brief = null');
const iRet = player.indexOf('\n  return cleanup;');
ok(iLet > 0 && iRet > 0 && iLet < iRet, 'player.js: estado del briefing antes del return de mount');
ok(/classBriefing/.test(player) && /numbersAreGrounded\(`\$\{note\.headline\} \$\{note\.body\}`/.test(player), 'player.js: pide classBriefing y comprueba las cifras');

console.log(`${bad ? '✗' : '✓'} briefing: ${n - bad}/${n} comprobaciones`);
process.exit(bad ? 1 : 0);
