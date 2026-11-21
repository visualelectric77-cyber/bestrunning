// RITMUP · pruebas de la proyección en directo del test VAM (js/training/vam-projection.js).
// Se simula el pulso de un test entero con un modelo de pulso inventado (el mismo tipo que la app aprende de tus clases)
// y se comprueba qué dice la proyección en cada escalón frente a dónde llega ese pulso al máximo de verdad.
// Uso: node tools/test-vam-projection.mjs   (sale con código ≠ 0 si algo falla)
import { createVamProjection, vamProjectionText } from '../js/training/vam-projection.js';
import { simulate, HR_DT } from '../js/training/hr-dynamics.js';
import { buildWorkout } from '../js/training/generator.js';

let failures = 0;
let passes = 0;
function ok(cond, msg) {
  if (cond) { passes++; return; }
  failures++;
  process.stderr.write(`  ✗ ${msg}\n`);
}
function section(name, fn) {
  process.stdout.write(`• ${name}\n`);
  try { fn(); } catch (err) { failures++; process.stderr.write(`  ✗ excepción: ${err?.stack || err}\n`); }
}

const LEVELS = { jog: 8.5, run: 10, fast: 11.5, sprint: 13 };
const MODEL = { b: 9, c: 2, d: 0.4, tauUp: 70, tauDown: 70, aTypical: 48 };
const HR_MAX = 180;
const W = buildWorkout('test-vam', { minutes: 20, levels: LEVELS, treadmill: { maxSpeed: 18 } });
const STAGES = [];
{
  let acc = 0;
  for (const g of W.segments) { if (g.stage > 0) STAGES.push({ stage: g.stage, speed: g.speed, start: acc, end: acc + g.sec }); acc += g.sec; }
}
const TOTAL = W.segments.reduce((a, g) => a + g.sec, 0);
const TOP = STAGES[STAGES.length - 1].speed;

function inputs() {
  const v = [];
  const g = [];
  const load = [];
  let L = 0;
  for (const s of W.segments) for (let t = 0; t < s.sec; t += HR_DT) { v.push(s.speed); g.push(0); L += (Math.max(0, s.speed - 8.5) * HR_DT) / 60; load.push(L); }
  return { v, g, load };
}

/** Pulso «de verdad» de un test: el modelo con otro día (da), otra pendiente (bk) y saturación cerca del máximo. */
function truth({ da = 0, bk = 1 } = {}) {
  const m = { ...MODEL, b: MODEL.b * bk };
  const a = MODEL.aTypical + da - (m.b - MODEL.b) * 9; // a 9 km/h, lo mismo que el modelo: cambia la pendiente
  const raw = simulate(m, a, inputs(), 95);
  const hr = raw.map((x) => (x > HR_MAX - 8 ? HR_MAX - 8 + 8 * (1 - Math.exp(-(x - (HR_MAX - 8)) / 8)) : x));
  const cross = (target) => {
    const k = raw.findIndex((x) => x >= target);
    if (k < 0) return TOP;
    const t = k * HR_DT;
    const i = STAGES.findIndex((q) => t < q.end);
    if (i < 0) return TOP;
    if (i === 0 || t < STAGES[0].start) return STAGES[0].speed;
    return STAGES[i - 1].speed + (STAGES[i].speed - STAGES[i - 1].speed) * Math.max(0, (t - STAGES[i].start) / 60);
  };
  return { hr, lo: cross(HR_MAX * 0.95), hi: cross(HR_MAX) };
}

function rng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

/** Corre el test: lecturas cada `every` s con ruido. → lo que dice la proyección a los 5 s de cada escalón. */
function run(tr, { model = MODEL, every = 3, noise = 4, seed = 11, hrMax = HR_MAX, gap = null, until = TOTAL } = {}) {
  const rnd = rng(seed);
  const pj = createVamProjection({ hrMax, segments: W.segments, model });
  const said = new Array(STAGES.length).fill(undefined);
  const all = [];
  for (let t = 0; t <= until; t++) {
    const inGap = gap && t >= gap[0] && t < gap[1];
    if (t % every === 0 && !inGap) pj.add(t, Math.round(tr.hr[Math.min(tr.hr.length - 1, Math.floor(t / HR_DT))] + (rnd() - 0.5) * noise));
    const p = pj.at(t);
    if (p) all.push({ t, ...p });
    const i = STAGES.findIndex((q) => t === q.start + 5);
    if (i >= 0) said[i] = p;
  }
  return { said, all, pj };
}

const doneAt = (t) => {
  let d = 0;
  for (let i = 0; i < STAGES.length; i++) {
    const q = STAGES[i];
    if (t >= q.end) { d = q.speed; continue; }
    if (t > q.start && i > 0) d = STAGES[i - 1].speed + (q.speed - STAGES[i - 1].speed) * ((t - q.start) / 60);
    break;
  }
  return d;
};

section('El test de la prueba', () => {
  ok(STAGES.length >= 15 && STAGES.every((q) => q.end - q.start === 60), `${STAGES.length} escalones de 1 min`);
  const t = truth();
  ok(t.lo > 11 && t.hi < 16 && t.hi > t.lo, `con el modelo de la prueba, el pulso llega al 95 % en ${t.lo.toFixed(1)} y al máximo en ${t.hi.toFixed(1)}`);
});

section('Con tu modelo de pulso: acierta pronto y no baila', () => {
  for (const [name, o] of [['día normal', {}], ['día alto (+10 ppm)', { da: 10 }], ['día bajo (−6 ppm)', { da: -6 }]]) {
    for (const seed of [3, 11, 29, 71]) {
      const t = truth(o);
      const { said } = run(t, { seed });
      const mid = (t.lo + t.hi) / 2;
      ok(said.slice(0, 4).every((p) => !p), `${name}: en los cuatro primeros escalones no dice nada`);
      const first = said.findIndex((p) => p);
      ok(first === 4, `${name}: habla desde el quinto escalón (${first + 1})`);
      // hasta que te acercas al final previsto, el rango cubre (con medio km/h de margen) dónde llega el pulso de verdad
      const iEnd = STAGES.findIndex((q) => q.speed >= t.lo);
      for (let i = 4; i < iEnd; i++) {
        const p = said[i];
        ok(!!p, `${name} (semilla ${seed}), escalón ${i + 1}: hay proyección`);
        if (!p) continue;
        ok(p.basis === 'model', `${name}, escalón ${i + 1}: con el modelo`);
        ok(p.lo - 0.5 <= mid && mid <= p.hi + 0.5, `${name} (semilla ${seed}), escalón ${i + 1}: ${vamProjectionText(p)} cubre ${mid.toFixed(1)}`);
        ok(Math.abs((p.lo + p.hi) / 2 - mid) <= 0.75, `${name} (semilla ${seed}), escalón ${i + 1}: centro a ≤ 0,75 de la verdad (${vamProjectionText(p)} vs ${mid.toFixed(1)})`);
      }
      const centers = said.slice(4, iEnd).filter(Boolean).map((p) => (p.lo + p.hi) / 2);
      ok(Math.max(...centers) - Math.min(...centers) <= 0.75, `${name} (semilla ${seed}): estable (se mueve ${(Math.max(...centers) - Math.min(...centers)).toFixed(2)})`);
    }
  }
});

section('Si hoy tu pulso sube distinto que en el modelo, se corrige sola', () => {
  for (const [name, bk] of [['25 % más empinado', 1.25], ['20 % menos', 0.8]]) {
    const t = truth({ bk });
    const { said } = run(t, {});
    const mid = (t.lo + t.hi) / 2;
    const iEnd = STAGES.findIndex((q) => q.speed >= t.lo);
    const first = said[4];
    const last = said[iEnd - 1];
    ok(first && last, `${name}: hay proyección al principio y cerca del final`);
    if (!first || !last) continue;
    ok(Math.abs((first.lo + first.hi) / 2 - mid) <= 1.0, `${name}: de entrada, a ≤ 1 km/h (${vamProjectionText(first)} vs ${mid.toFixed(1)})`);
    ok(Math.abs((last.lo + last.hi) / 2 - mid) <= 0.5, `${name}: cerca del final, a ≤ 0,5 (${vamProjectionText(last)} vs ${mid.toFixed(1)})`);
    ok(Math.abs((last.lo + last.hi) / 2 - mid) <= Math.abs((first.lo + first.hi) / 2 - mid) + 0.26, `${name}: no empeora según avanzas`);
  }
});

section('Sin modelo (primeros tests): más tarde y con una recta', () => {
  for (const o of [{}, { da: 10 }, { da: -6 }]) {
    const t = truth(o);
    const { said } = run(t, { model: null });
    const mid = (t.lo + t.hi) / 2;
    ok(said.slice(0, 5).every((p) => !p), 'en los cinco primeros escalones no dice nada');
    // desde el sexto o, si el final queda aún muy lejos (día de pulso bajo), desde el séptimo
    const first = said.findIndex((p) => p);
    ok((first === 5 || first === 6) && said[first].basis === 'live', `habla desde el sexto o el séptimo, con tu pulso de hoy (${first + 1})`);
    const iEnd = STAGES.findIndex((q) => q.speed >= t.lo);
    for (let i = Math.max(5, first); i < iEnd; i++) {
      const p = said[i];
      if (!p) { ok(false, `escalón ${i + 1}: sin proyección`); continue; }
      ok(Math.abs((p.lo + p.hi) / 2 - mid) <= (i < 7 ? 1.5 : 1.0), `escalón ${i + 1}: ${vamProjectionText(p)} frente a ${mid.toFixed(1)}`);
    }
    const last = said[iEnd - 1];
    ok(last && Math.abs((last.lo + last.hi) / 2 - mid) <= 0.75, `cerca del final, a ≤ 0,75 (${last ? vamProjectionText(last) : '—'} vs ${mid.toFixed(1)})`);
  }
  // un modelo roto cuenta como no tener modelo
  for (const bad of [{}, { b: 0, tauUp: 70, tauDown: 70, aTypical: 50 }, { b: 9, tauUp: 0, tauDown: 70, aTypical: 50 }, { b: NaN }, 'x', 7]) {
    const { said } = run(truth(), { model: bad });
    ok(said.slice(5).some((p) => p && p.basis === 'live') && !said.some((p) => p && p.basis === 'model'), `modelo roto (${JSON.stringify(bad)}): recta`);
  }
});

section('Frenos de realismo, en cada segundo del test', () => {
  for (const o of [{}, { da: 12 }, { da: -10 }, { bk: 1.4 }, { bk: 0.7 }]) {
    for (const model of [MODEL, null]) {
      const t = truth(o);
      const { all } = run(t, { model, seed: 5 });
      ok(all.length > 200, 'hay proyección durante buena parte del test');
      let good = true;
      let why = '';
      const bad = (msg) => { if (good) { good = false; why = msg; } };
      for (const p of all) {
        const done = doneAt(p.t);
        if (!(p.hi > p.lo)) bad(`rango vacío en ${p.t}`);
        if (p.hi - p.lo < 0.5 - 1e-9 || p.hi - p.lo > 2 + 1e-9) bad(`ancho ${p.hi - p.lo} en ${p.t}`);
        // de 0,5 en 0,5, salvo pegado al último escalón del test (que puede no caer en 0,5)
        const grid = (x) => Math.abs(x * 2 - Math.round(x * 2)) < 1e-9 || Math.abs(x - TOP) < 1e-9 || Math.abs(x - (TOP - 0.5)) < 1e-9;
        if (!grid(p.lo) || !grid(p.hi)) bad(`no va de 0,5 en 0,5 en ${p.t}`);
        if (p.hi > TOP + 1e-9) bad(`pasa del último escalón en ${p.t}`);
        if (p.hi < done - 1e-9) bad(`por debajo de lo ya hecho (${p.hi} < ${done.toFixed(2)}) en ${p.t}`);
        // (en el último escalón el rango es «el anterior – el último» y lo ya hecho cae dentro)
        if (p.lo < done - 0.26 && p.hi < TOP - 1e-9) bad(`el mínimo queda muy por debajo de lo ya hecho (${p.lo} vs ${done.toFixed(2)}) en ${p.t}`);
        if (p.lo - done > 5 + 0.26) bad(`demasiado lejos en ${p.t}`);
      }
      ok(good, `${JSON.stringify(o)} ${model ? 'con' : 'sin'} modelo: ${why || 'bien'}`);
    }
  }
  // quien aguanta más de lo previsto: la proyección va con lo que lleva hecho, nunca por detrás
  const t = truth();
  const { said } = run(t, {});
  const late = said[said.length - 1];
  ok(late && late.lo >= STAGES[STAGES.length - 2].speed - 0.26, `en el último escalón dice ${late ? vamProjectionText(late) : '—'}: lo que llevas hecho`);
});

section('Sin datos, no dice nada', () => {
  const t = truth();
  // el reloj se queda sin pulso dos escalones enteros: calla; cuando vuelve con dos escalones seguidos, habla otra vez
  const gapStart = STAGES[6].start;
  const { said } = run(t, { gap: [gapStart, gapStart + 150] });
  ok(said[5], 'antes del corte hay proyección');
  ok(!said[8], 'tras dos escalones sin pulso, calla');
  ok(said.slice(9, 13).some(Boolean), 'cuando vuelve el pulso, vuelve la proyección');
  // sin pulso en todo el test
  const none = createVamProjection({ hrMax: HR_MAX, segments: W.segments, model: MODEL });
  let any = false;
  for (let s = 0; s <= TOTAL; s += 5) if (none.at(s)) any = true;
  ok(!any, 'sin ninguna lectura: nada');
  ok(none.log().length === 0, 'y nada que guardar');
  // pulso plano (reloj atascado en un valor): sin modelo no encaja y calla
  const flat = createVamProjection({ hrMax: HR_MAX, segments: W.segments, model: null });
  let flatAny = false;
  for (let s = 0; s <= TOTAL; s++) { if (s % 3 === 0) flat.add(s, 140); if (flat.at(s)) flatAny = true; }
  ok(!flatAny, 'pulso plano sin modelo: nada');
  // con modelo: un pulso que baila ±11 ppm sin subir (así es el pulso simulado de la vista previa) tampoco encaja
  for (const model of [MODEL, null]) {
    const wob = createVamProjection({ hrMax: HR_MAX, segments: W.segments, model });
    let n = 0;
    for (let s = 0; s <= TOTAL; s++) { if (s % 5 === 0) wob.add(s, Math.round(150 + 11 * Math.sin(s / 30))); if (wob.at(s)) n++; }
    ok(n === 0, `pulso que baila sin subir, ${model ? 'con' : 'sin'} modelo: nada (${n})`);
    const dn = createVamProjection({ hrMax: HR_MAX, segments: W.segments, model });
    let m = 0;
    for (let s = 0; s <= TOTAL; s++) { if (s % 3 === 0) dn.add(s, 170 - s / 30); if (dn.at(s)) m++; }
    ok(m === 0, `pulso que baja mientras sube la velocidad, ${model ? 'con' : 'sin'} modelo: nada`);
  }
  // pulso que baja escalón a escalón (lecturas de otra persona, sensor suelto)
  const down = createVamProjection({ hrMax: HR_MAX, segments: W.segments, model: null });
  let downAny = false;
  for (let s = 0; s <= TOTAL; s++) { if (s % 3 === 0) down.add(s, 170 - s / 30); if (down.at(s)) downAny = true; }
  ok(!downAny, 'pulso que baja mientras sube la velocidad: nada');
});

section('Entradas raras: nunca lanza', () => {
  const bads = [undefined, null, {}, { hrMax: 0, segments: W.segments }, { hrMax: 180 }, { hrMax: 180, segments: [] }, { hrMax: 180, segments: 'x' },
    { hrMax: NaN, segments: W.segments }, { hrMax: 180, segments: [{ sec: 60, speed: 9, stage: 1 }] }, { hrMax: 180, segments: [null, undefined, {}, { stage: 1 }] },
    { hrMax: 180, segments: W.segments.filter((g) => !(g.stage > 0)) }];
  for (const b of bads) {
    let threw = false;
    let out = 'x';
    try {
      const p = createVamProjection(b);
      p.add(10, 120); p.add('a', 'b'); p.add(NaN, 150); p.add(20, -5); p.add(15, 130); p.add(Infinity, 150);
      out = p.at(500);
      p.at(NaN); p.at(undefined); p.at(-1); p.at(1e9);
      ok(Array.isArray(p.log()), 'log siempre es una lista');
    } catch { threw = true; }
    ok(!threw && out === null, `${JSON.stringify(b)?.slice(0, 60)}: null sin lanzar`);
  }
  // lecturas repetidas, hacia atrás y disparatadas no cuentan
  const p = createVamProjection({ hrMax: HR_MAX, segments: W.segments, model: MODEL });
  const t = truth();
  let threw = false;
  try {
    for (let s = 0; s <= TOTAL; s++) {
      if (s % 3 === 0) {
        p.add(s, Math.round(t.hr[Math.floor(s / HR_DT)]));
        p.add(s, 30); p.add(s - 40, 200); p.add(s, 999); p.add(s, null);
      }
      p.at(s);
    }
  } catch { threw = true; }
  ok(!threw, 'con basura entre las lecturas no lanza');
  const clean = run(t, { noise: 0 }).said;
  const dirty = [];
  const p2 = createVamProjection({ hrMax: HR_MAX, segments: W.segments, model: MODEL });
  for (let s = 0; s <= TOTAL; s++) {
    if (s % 3 === 0) { p2.add(s, Math.round(t.hr[Math.floor(s / HR_DT)])); p2.add(s - 40, 200); p2.add(s, 999); }
    const x = p2.at(s);
    const i = STAGES.findIndex((q) => s === q.start + 5);
    if (i >= 0) dirty[i] = x;
  }
  ok(JSON.stringify(clean.map((x) => x && [x.lo, x.hi])) === JSON.stringify(dirty.map((x) => x && [x.lo, x.hi])), 'y da lo mismo que sin la basura');
});

section('Lo que se guarda y cómo se escribe', () => {
  const { pj, said } = run(truth(), {});
  const log = pj.log();
  ok(log.length >= 1 && log.length <= 60, `se guardan los cambios (${log.length})`);
  ok(log.every((h) => Array.isArray(h) && h.length === 3 && h[0] >= 4 && h[2] > h[1]), 'cada uno: escalones terminados, mínimo y máximo');
  ok(log.every((h, i) => i === 0 || h[0] >= log[i - 1][0]), 'en orden');
  log[0][1] = -1;
  ok(pj.log()[0][1] !== -1, 'log devuelve una copia');
  ok(vamProjectionText({ lo: 13, hi: 14 }) === '13,0–14,0', 'texto «13,0–14,0»');
  ok(vamProjectionText({ lo: 12.5, hi: 13 }) === '12,5–13,0', 'texto «12,5–13,0»');
  ok(vamProjectionText(null) === '' && vamProjectionText({}) === '' && vamProjectionText({ lo: 13, hi: 13 }) === '' && vamProjectionText({ lo: 0, hi: 5 }) === '', 'sin proyección, texto vacío');
  ok(said.filter(Boolean).every((p) => /^\d{1,2},\d–\d{1,2},\d$/.test(vamProjectionText(p))), 'siempre con ese formato');
});

process.stdout.write(`\n${passes} comprobaciones OK, ${failures} fallos\n`);
process.exit(failures ? 1 : 0);
