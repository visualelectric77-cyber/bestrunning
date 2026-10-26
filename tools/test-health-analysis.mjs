// Pruebas de js/training/health-analysis.js con clases sintéticas: efectos plantados (tiene que encontrarlos) y azar
// puro (no puede inventarse una mejora). node tools/test-health-analysis.mjs
import { fitnessTrend, sessionHrAt, loadBalance, sessionLoad, fitnessText, loadText } from '../js/training/health-analysis.js';

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('✗', m); } };

// Generador con semilla (resultados repetibles)
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) * Math.SQRT2; };

const LV = { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 };
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = '2026-10-26';
const dayAgo = (n) => key(new Date(2026, 9, 26 - n, 12));

/** Clase de 30 min: tramos jog/run/fast; pulso = base + 7·(v − 10) con retardo y ruido. */
function session(daysAgo, base, noise = 1.5) {
  const plan = [8.3, 10.1, 11.5, 8.3, 10.1, 11.5, 8.3];
  const segSec = 1800 / plan.length;
  const speedTrace = plan.map((v, i) => [Math.round(i * segSec), v]);
  const hrSeries = [];
  const dayNoise = gauss() * noise;
  let hr = base - 20;
  for (let t = 0; t <= 1800; t += 5) {
    const v = plan[Math.min(plan.length - 1, Math.floor(t / segSec))];
    const target = base + 7 * (v - 10) + dayNoise;
    hr += (target - hr) * 0.12;
    hrSeries.push([t, Math.round(hr + gauss() * 1.2)]);
  }
  return { dayKey: dayAgo(daysAgo), elapsedSec: 1800, speedTrace, hrSeries, levelsAtStart: LV };
}

// 1 · Una clase: el pulso a 10 km/h sale cerca del verdadero
{
  const s = session(0, 147, 0);
  const hr = sessionHrAt(s, 10);
  ok(hr != null && Math.abs(hr - 147) < 3, `pulso a 10 km/h ≈ 147 (${hr})`);
}

// 2 · Mejora plantada: de 147 a 141 en 8 semanas, 3 clases por semana → la encuentra
{
  const hist = [];
  for (let w = 7; w >= 0; w--) for (const d of [5, 3, 1]) {
    const daysAgo = w * 7 + d;
    hist.push(session(daysAgo, 141 + 6 * (daysAgo / 56)));
  }
  const f = fitnessTrend(hist, { today: TODAY, levels: LV });
  ok(f.ok && f.verdict === 'better', `detecta la mejora (${JSON.stringify({ v: f.verdict, c: f.change, z: f.z })})`);
  ok(f.ok && Math.abs(f.change + 6) <= 2, `tamaño ≈ −6 ppm (${f.change})`);
  ok(/bajado/.test(fitnessText(f)?.title || ''), 'texto de mejora');
}

// 3 · Empeoramiento plantado → 'worse'
{
  const hist = [];
  for (let w = 7; w >= 0; w--) for (const d of [5, 3, 1]) { const a = w * 7 + d; hist.push(session(a, 147 - 6 * (a / 56))); }
  const f = fitnessTrend(hist, { today: TODAY, levels: LV });
  ok(f.ok && f.verdict === 'worse', `detecta el empeoramiento (${f.verdict}, ${f.change})`);
}

// 4 · Azar puro (sin tendencia): no puede afirmar mejora/empeoramiento más del 5 % de las veces
{
  let claims = 0;
  const runs = 200;
  for (let r = 0; r < runs; r++) {
    const hist = [];
    for (let w = 7; w >= 0; w--) for (const d of [5, 3, 1]) hist.push(session(w * 7 + d, 147, 2.5));
    const f = fitnessTrend(hist, { today: TODAY, levels: LV });
    if (f.ok && f.verdict !== 'same') claims++;
  }
  ok(claims / runs <= 0.05, `falsas alarmas con azar: ${claims}/${runs}`);
}

// 5 · Pocos datos → no enseña nada
{
  const f = fitnessTrend([session(3, 147), session(1, 146)], { today: TODAY, levels: LV });
  ok(!f.ok && f.have === 2, 'pocos datos: ok:false');
  ok(fitnessText(f) === null, 'pocos datos: sin texto');
}

// 6 · Clases sin pulso o de un solo ritmo no cuentan
{
  const flat = session(2, 147);
  flat.speedTrace = [[0, 10.1]];
  ok(sessionHrAt(flat, 10) === null, 'un solo ritmo: null');
  ok(sessionHrAt({ dayKey: TODAY, hrSeries: null, speedTrace: [[0, 10]] }, 10) === null, 'sin pulso: null');
}

// 7 · Carga: TRIMP crece con el pulso; semana muy cargada → 'loaded'; semana floja → 'rested'
{
  const easy = session(0, 125, 0), hard = session(0, 160, 0);
  ok(sessionLoad(hard, { hrMax: 176, hrRest: 60 }) > sessionLoad(easy, { hrMax: 176, hrRest: 60 }), 'TRIMP: más pulso, más carga');
  const base = [];
  for (let d = 27; d >= 7; d -= 2) base.push(session(d, 145));
  const loaded = [...base, ...[6, 5, 4, 3, 2, 1, 0].map((d) => session(d, 155))];
  const rested = [...base, session(3, 140)];
  const balanced = [...base, ...[6, 4, 2, 0].map((d) => session(d, 145))];
  const P = { hrMax: 176, hrRest: 60 };
  ok(loadBalance(loaded, { today: TODAY, profile: P }).status === 'loaded', `semana cargada (${loadBalance(loaded, { today: TODAY, profile: P }).ratio})`);
  ok(loadBalance(rested, { today: TODAY, profile: P }).status === 'rested', `semana floja (${loadBalance(rested, { today: TODAY, profile: P }).ratio})`);
  ok(loadBalance(balanced, { today: TODAY, profile: P }).status === 'balanced', `semana normal (${loadBalance(balanced, { today: TODAY, profile: P }).ratio})`);
  ok(loadText(loadBalance(loaded, { today: TODAY, profile: P }))?.title === 'Cargado', 'texto de carga');
  ok(!loadBalance([session(1, 145)], { today: TODAY, profile: P }).ok, 'carga con pocos datos: ok:false');
}

console.log(fails ? `✗ test-health-analysis: ${fails} fallos de ${checks}` : `✓ test-health-analysis: ${checks} comprobaciones correctas`);
process.exit(fails ? 1 : 0);
