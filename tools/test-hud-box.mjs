// RITMUP · marcador del box (js/player/hud-box.js): el modelo de texto con el motor real y todas las AMRAP.
// Lo que se comprueba es lo que hace que quepa y se lea: ningún texto «undefined»/«NaN», y cada dato dentro del largo
// para el que está maquetada la placa (medido en el navegador a 375 y 320 pt con estos mismos largos).
// Uso: node tools/test-hud-box.mjs   (sale con código ≠ 0 si algo falla)
import { TEMPLATES } from '../js/training/templates.js';
import { buildWorkout } from '../js/training/generator.js';
import { createEngine } from '../js/player/engine.js';
import { boxHudModel, LAST_SEC } from '../js/player/hud-box.js';

let failures = 0;
let passes = 0;
const ok = (c, msg) => { if (c) { passes++; return true; } failures++; if (failures <= 25) process.stderr.write(`  ✗ ${msg}\n`); return false; };

// largo máximo de cada dato (caracteres) con el que se ha maquetado y medido la placa
const MAX = { speed: 4, zoneTag: 16, roundLabel: 13, left: 5, cap: 5, pulse: 3, next: 22, resText: 14, resN: 2 };
const AM = TEMPLATES.filter((t) => t.family === 'amrap');
ok(AM.length >= 8, `hay formatos AMRAP (${AM.length})`);

const seen = { amrap: 0, seg: 0, result: 0, last: 0, rest: 0, work: 0 };
for (const t of AM) {
  for (const min of [20, 30, 45, 60]) {
    for (const levels of [{ jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 }, { jog: 10.5, run: 13.2, fast: 15.4, sprint: 17.5 }]) {
      const tm = { hasIncline: !!t.requiresIncline, maxIncline: 12, minSpeed: 1, maxSpeed: 18 };
      const w = buildWorkout(t.id, { minutes: min, levels, seed: 3, hasIncline: tm.hasIncline, treadmill: tm });
      if (!ok(!!w, `${t.id} ${min}′: se construye`)) continue;
      const clk = { t: 1e12 };
      let res = null;
      const eng = createEngine(w, { now: () => clk.t, autoTick: false, treadmill: tm, onEvent: (ty, d) => { if (ty === 'amrapEnd') res = { ...d }; if (ty === 'amrapPhase') res = null; } });
      eng.start();
      const tag = `${t.id} ${min}′`;
      for (let s = 0; s <= w.totalSec + 5; s++) {
        clk.t += 1000; eng.tick();
        const st = eng.getState();
        const m = boxHudModel(st, { title: w.title, hr: s % 7 === 0 ? null : 150 + (s % 40), hrZone: 4, result: res, record: res && s % 2 ? 'new' : null, recordText: '12 rondas + 990 m' });
        seen[m.mode]++;
        const txt = JSON.stringify(m);
        if (/undefined|NaN|null,"zoneTag"/.test(txt)) { ok(false, `${tag} @${s}: texto roto ${txt.slice(0, 160)}`); break; }
        for (const [k, n] of Object.entries(MAX)) if (m[k] != null && String(m[k]).length > n) { ok(false, `${tag} @${s}: ${k} «${m[k]}» pasa de ${n}`); }
        if (m.mode === 'amrap') {
          const a = st.amrap;
          seen[m.phase]++;
          if (m.last) seen.last++;
          if (m.last !== (a.capLeft <= LAST_SEC)) ok(false, `${tag} @${s}: último minuto mal`);
          if (m.phase === 'rest' && m.next === 'A TOPE') ok(false, `${tag} @${s}: «A TOPE» recuperando`);
          if (m.phase === 'work' && m.round !== String(a.round)) ok(false, `${tag} @${s}: ronda`);
          if (m.phase === 'rest' && m.round !== String(a.rounds)) ok(false, `${tag} @${s}: rondas hechas`);
          if (!(m.progress >= -1e-6 && m.progress <= 1 + 1e-6)) ok(false, `${tag} @${s}: barra ${m.progress}`);
          if (m.leftUnit === 'M' && !/^\d+$/.test(m.left)) ok(false, `${tag} @${s}: metros «${m.left}»`);
          if (m.leftUnit === '' && !/^\d+:\d\d$/.test(m.left)) ok(false, `${tag} @${s}: tiempo «${m.left}»`);
        }
        if (m.mode === 'result' && !/^\d+$/.test(m.resN)) ok(false, `${tag} @${s}: resultado «${m.resN}»`);
        if (st.status === 'finished') break;
      }
      eng.destroy();
      ok(true, tag);
    }
  }
}
ok(seen.amrap > 0 && seen.seg > 0 && seen.result > 0, `salen los tres modos (${seen.amrap} / ${seen.seg} / ${seen.result})`);
ok(seen.work > 0 && seen.rest > 0 && seen.last > 0, 'salen trabajo, recuperación y último minuto');

// sin pulso y sin motor: no revienta
const idle = boxHudModel(null, {});
ok(idle.pulse === '—' && idle.pulseZone === null && typeof idle.speed === 'string', 'sin estado ni pulso: placa vacía, sin errores');
const r1 = boxHudModel({ status: 'running', amrap: null }, { result: { rounds: 1, extraM: 0, cap: 540 }, record: null, recordText: '' });
ok(r1.mode === 'result' && r1.resN === '1' && r1.resText === 'RONDA' && r1.resSub === '' && r1.resLabel === 'AMRAP 9′ · RESULTADO', 'resultado de una ronda, sin récord anterior');
const r2 = boxHudModel({ status: 'running', amrap: null }, { result: { rounds: 7, extraM: 120, cap: 720 }, record: 'new', recordText: '6 rondas + 300 m' });
ok(r2.isRecord && r2.resText === 'RONDAS + 120 M' && r2.resSub === '¡NUEVO RÉCORD! · antes 6 rondas + 300 m', 'resultado con récord');

if (failures) { process.stderr.write(`\n✗ ${failures} fallos · ${passes} comprobaciones\n`); process.exit(1); }
process.stdout.write(`✓ marcador del box: ${passes} comprobaciones\n`);
