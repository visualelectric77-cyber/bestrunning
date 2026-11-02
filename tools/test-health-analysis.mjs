// Pruebas de js/training/health-analysis.js con clases sintéticas: efectos plantados (tiene que encontrarlos) y azar
// puro (no puede inventarse una mejora). node tools/test-health-analysis.mjs
import { fitnessTrend, sessionHrAt, loadBalance, sessionLoad, fitnessText, loadText, sleepList, sleepSummary, sleepVsHr, sleepHrText, vo2Trend, recoveryTrend, weeklyAverages, fmtSleep } from '../js/training/health-analysis.js';

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

// 6b · Velocidades ajustadas (8,7 / 10,4 / 11,9: ninguna es un nivel guardado) cuentan; las cuestas no
{
  const s1 = session(2, 147, 0);
  s1.speedTrace = s1.speedTrace.map(([t, v]) => [t, v + 0.4]);
  s1.hrSeries = s1.hrSeries.map(([t, h]) => [t, h + Math.round(7 * 0.4)]);
  const hr = sessionHrAt(s1, 10);
  ok(hr != null && Math.abs(hr - 147) < 3, `velocidades ajustadas: cuenta y ≈ 147 (${hr})`);
  const hills = { ...session(2, 147, 0), category: 'hills' };
  ok(sessionHrAt(hills, 10) === null, 'clase de cuestas: no cuenta');
  const f = fitnessTrend([session(3, 147), hills], { today: TODAY, levels: LV });
  ok(f.withHr === 2 && f.have === 1, `cuenta las clases con pulso (${f.withHr}) y las que sirven (${f.have})`);
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

// 8 · Sueño: resumen de 7 noches (media, horas de acostarse y levantarse, frente a las 4 semanas anteriores)
{
  const night = (daysAgo, min, bedH = 23.5) => {
    const day = dayAgo(daysAgo);
    const [y, m, d] = day.split('-').map(Number);
    const start = new Date(y, m - 1, d - 1, Math.floor(bedH), Math.round((bedH % 1) * 60)).getTime();
    return { day, start, end: start + min * 60000, asleep: min, deep: Math.round(min * 0.14), core: Math.round(min * 0.62), rem: Math.round(min * 0.24), awake: 20, stages: true };
  };
  const sleep = [];
  for (let d = 34; d >= 7; d--) sleep.push(night(d, 400));
  for (let d = 6; d >= 0; d--) sleep.push(night(d, 430, d === 3 ? 0.5 : 23.5)); // una noche se acuesta a las 0:30
  sleep.push({ day: 'mal', asleep: 400 }, { day: dayAgo(40), asleep: 60 }); // basura: fuera
  const ss = sleepSummary({ sleep }, TODAY);
  ok(ss.ok && ss.nights.length === 7 && ss.avg === 430 && ss.base === 400 && ss.delta === 30, `sueño: media 7:10 y +30 min (${JSON.stringify({ a: ss.avg, b: ss.base })})`);
  ok(ss.bed === '23:39' && ss.last?.day === TODAY, `sueño: hora media de acostarse sin saltar a medianoche (${ss.bed})`);
  ok(sleepList({ sleep }).length === 35, 'sueño: se descartan noches mal formadas o de menos de 2 h');
  ok(!sleepSummary({ sleep: sleep.slice(0, 3) }, TODAY).ok && !sleepSummary(null, TODAY).ok, 'sueño: sin noches recientes, ok:false');
  ok(fmtSleep(444) === '7:24', 'fmtSleep');
}

// 9 · Sueño ↔ pulso: efecto plantado de +7 ppm tras noches cortas, con la forma mejorando a la vez
function sleepCase(effect, noise = 1.5) {
  const hist = [], sleep = [];
  for (let d = 80; d >= 0; d -= 2) {
    const min = 330 + Math.floor(rnd() * 180); // de 5 h 30 a 8 h 30
    sleep.push({ day: dayAgo(d), start: 0, end: 0, asleep: min, deep: 60, core: 250, rem: 90, awake: 20, stages: true });
    const base = 141 + 6 * (d / 80) + (min < 390 ? effect : 0);
    hist.push(session(d, base, noise));
  }
  return sleepVsHr(hist, { sleep }, { today: TODAY, levels: LV, days: 90 });
}
{
  const c = sleepCase(7);
  ok(c.ok && c.significant && Math.abs(c.diff - 7) <= 2, `detecta +7 ppm tras dormir poco (${JSON.stringify({ d: c.diff, t: c.t, s: c.short, l: c.long })})`);
  ok(/cuesta 7|cuesta 6|cuesta 8/.test(sleepHrText(c)?.title || ''), `texto del cruce (${sleepHrText(c)?.title})`);
  let claims = 0;
  for (let r = 0; r < 200; r++) { const z = sleepCase(0, 2.5); if (z.ok && z.significant) claims++; }
  ok(claims / 200 <= 0.05, `sueño sin efecto: falsas alarmas ${claims}/200`);
  const few = sleepVsHr([session(1, 147)], { sleep: [{ day: dayAgo(1), asleep: 300 }] }, { today: TODAY, levels: LV });
  ok(!few.ok && few.short === 1 && few.long === 0 && few.need === 4, 'cruce con pocas clases: ok:false con lo que falta');
}

// 10 · VO2 máx, recuperación al minuto y medias semanales
{
  const vo2 = [[dayAgo(56), 43.6], [dayAgo(30), 44.1], [dayAgo(2), 44.8]];
  const v = vo2Trend({ vo2 }, TODAY);
  ok(v && v.last === 44.8 && v.change === 1.2 && v.weeks === 8, `VO2: último y cambio (${JSON.stringify(v)})`);
  ok(vo2Trend({ vo2: [[dayAgo(3), 44]] }, TODAY).change === null && vo2Trend({}, TODAY) === null, 'VO2: un solo dato, sin cambio');
  const hrRecovery = [22, 22, 23, 24, 25, 26, 27, 27].map((x, i) => [dayAgo(50 - i * 7), x]);
  const rc = recoveryTrend({ hrRecovery }, TODAY);
  ok(rc && rc.now === 27 && rc.before === 22, `recuperación: ahora y antes (${JSON.stringify({ n: rc?.now, b: rc?.before })})`);
  const hrv = []; for (let d = 55; d >= 0; d--) hrv.push([dayAgo(d), d < 7 ? 62 : 56]);
  const wk = weeklyAverages(hrv, TODAY, 8);
  ok(wk.length === 8 && wk[7].avg === 62 && wk[0].avg === 56, `VFC por semanas (${wk.map((w) => w.avg).join(' ')})`);
}

console.log(fails ? `✗ test-health-analysis: ${fails} fallos de ${checks}` : `✓ test-health-analysis: ${checks} comprobaciones correctas`);
process.exit(fails ? 1 : 0);
