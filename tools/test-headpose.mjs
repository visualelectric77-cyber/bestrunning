// RITMUP · tests del seguimiento de cabeza: filtro (js/player/headpose.js) y conversión de la pose de MediaPipe
// (poseFromMatrix de js/player/headtrack.js). Uso: node tools/test-headpose.mjs
import { createHeadFilter, headCamera, deadzone } from '../js/player/headpose.js';

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
const run = (f, from, to, fn, hz = 30) => {
  let last = null;
  for (let t = from; t < to; t += 1 / hz) { f.push(t, fn(t)); last = f.sample(t); }
  return last;
};
const base = { x: 0.03, y: -0.02, z: 0.7, yaw: 0.05, pitch: -0.04 };   // postura habitual (algo descolocada)
const at = (o = {}) => () => ({ ...base, ...o });

section('calibración: la postura habitual es el centro', () => {
  const f = createHeadFilter();
  const p = run(f, 0, 4, at());
  ok(f.ready, 'calibrada tras 1,5 s');
  ok(Math.abs(p.x) < 1e-6 && Math.abs(p.y) < 1e-6 && Math.abs(p.yaw) < 1e-6, 'quieto en tu postura ⇒ sin desplazamiento');
  ok(p.w > 0.99, 'efecto a pleno con cara');
});

section('el rebote de la zancada no pasa; los gestos lentos sí', () => {
  const f = createHeadFilter();
  run(f, 0, 3, at());
  // rebote de 2,8 Hz: ±3 cm vertical y ±1,5 cm lateral (corriendo)
  let maxY = 0; let maxX = 0;
  for (let t = 3; t < 10; t += 1 / 30) {
    f.push(t, { ...base, y: base.y + 0.03 * Math.sin(2 * Math.PI * 2.8 * t), x: base.x + 0.015 * Math.sin(2 * Math.PI * 1.4 * t) });
    const p = f.sample(t);
    if (t > 4) { maxY = Math.max(maxY, Math.abs(p.y)); maxX = Math.max(maxX, Math.abs(p.x)); }
  }
  ok(maxY < 0.004, `rebote vertical filtrado (${(maxY * 100).toFixed(2)} cm)`);
  ok(maxX < 0.012, `vaivén lateral muy atenuado (${(maxX * 100).toFixed(2)} cm)`);
  // asomarse 8 cm a la derecha y quedarse
  const p = run(f, 10, 11.5, at({ x: base.x + 0.08 }));
  ok(p.x > 0.055 && p.x <= 0.08, `asomarse 8 cm se ve (${(p.x * 100).toFixed(1)} cm)`);
  // a los 40 s quieto así, la postura neutra te ha alcanzado: vuelve al centro
  const q = run(f, 11.5, 50, at({ x: base.x + 0.08 }));
  ok(Math.abs(q.x) < 0.01, `si te quedas así, vuelve solo al centro (${(q.x * 100).toFixed(2)} cm)`);
});

section('fluido a 60 fps con muestras a 15 Hz (la cámara de la build 19)', () => {
  const f = createHeadFilter();
  // calibración con muestras a 15 Hz
  for (let i = 0; i <= 45; i++) f.push(i / 15, at()());
  // te asomas 8 cm de golpe; la escena se pinta a 60 fps y la cámara da una muestra cada 4 fotogramas
  let prev = f.sample(3).x; let frozen = 0; let maxJump = 0; let moving = 0;
  for (let k = 1; k <= 60; k++) {
    const t = 3 + k / 60;
    if (k % 4 === 0) f.push(t, { ...base, x: base.x + 0.08 + 0.004 * Math.sin(k) });   // con un poco de ruido de Vision
    const x = f.sample(t).x;
    if (k < 40 && prev > 0) { moving++; if (Math.abs(x - prev) < 1e-7) frozen++; }   // ya en marcha (fuera de la zona muerta)
    maxJump = Math.max(maxJump, Math.abs(x - prev));
    prev = x;
  }
  ok(frozen === 0, `ningún fotograma congelado mientras te mueves (${frozen}/${moving})`);
  ok(maxJump < 0.006, `sin saltos: como mucho ${(maxJump * 1000).toFixed(1)} mm por fotograma`);
  ok(prev > 0.05, `llega a donde te asomas (${(prev * 100).toFixed(1)} cm)`);
});

section('topes y zona muerta', () => {
  ok(deadzone(0.005, 0.01) === 0 && Math.abs(deadzone(0.03, 0.01) - 0.02) < 1e-9 && Math.abs(deadzone(-0.03, 0.01) + 0.02) < 1e-9, 'zona muerta suave');
  const f = createHeadFilter();
  run(f, 0, 3, at());
  const p = run(f, 3, 6, at({ x: base.x + 0.5, yaw: base.yaw + 1.5 }));
  ok(p.x <= 0.12 + 1e-9 && p.yaw <= 0.45 + 1e-9, 'nunca más que el tope (el número sigue sobre el cielo)');
});

section('sin cara: se desvanece, sin saltos', () => {
  const f = createHeadFilter();
  run(f, 0, 3, at());
  run(f, 3, 5, at({ x: base.x + 0.08 }));
  let prev = 1; let mono = true; let p = null;
  for (let t = 5; t < 7; t += 1 / 30) { f.push(t, null); p = f.sample(t); if (p.w > prev + 1e-9) mono = false; prev = p.w; }
  ok(mono, 'el peso solo baja');
  ok(p.w === 0, 'a los 2 s sin cara, efecto apagado');
  const f2 = createHeadFilter();
  ok(f2.sample(0).w === 0 && f2.sample(1).x === 0, 'sin muestras: nada');
});

section('cámara de ventana', () => {
  const o = {};
  headCamera({ x: 0.1, y: 0.05, z: 0.05, yaw: 0.2, pitch: 0.1, w: 1 }, o);
  ok(o.dx > 0 && o.dy > 0, 'la cámara se mueve con tu cabeza');
  ok(o.dz < 0, 'te acercas ⇒ la cámara avanza');
  ok(o.yaw < 0, 'giras a tu derecha ⇒ la mirada va a la derecha');
  headCamera({ x: 0.1, y: 0.05, z: 0, yaw: 0.2, pitch: 0, w: 0 }, o);
  ok(o.dx === 0 && o.yaw === 0, 'peso 0 ⇒ sin efecto');
});

const { poseFromMatrix } = await import('../js/player/headtrack.js').catch(() => ({}));
if (typeof poseFromMatrix === 'function') {
  section('pose de MediaPipe: signos', () => {
    // cara a 60 cm, centrada, mirando a la cámara
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -60, 1];
    const p0 = poseFromMatrix(I);
    ok(Math.abs(p0.z - 0.6) < 1e-9 && Math.abs(p0.x) < 1e-9 && Math.abs(p0.yaw) < 1e-9, 'centrada a 0,6 m');
    // te mueves a TU derecha ⇒ en la imagen de la cámara frontal vas a la izquierda (x < 0)
    const p1 = poseFromMatrix([...I.slice(0, 12), -8, 0, -60, 1]);
    ok(p1.x > 0, 'a tu derecha ⇒ x positivo');
    // giras a tu derecha ⇒ la cara apunta a la izquierda de la imagen (columna z con x < 0)
    const a = 0.3;
    const R = [Math.cos(a), 0, Math.sin(a), 0, 0, 1, 0, 0, -Math.sin(a), 0, Math.cos(a), 0, 0, 0, -60, 1];
    ok(poseFromMatrix(R).yaw > 0, 'giras a tu derecha ⇒ yaw positivo');
  });
} else {
  process.stdout.write('  (poseFromMatrix no se puede importar en Node: depende del navegador)\n');
}

process.stdout.write(`\n${failures ? '✗' : '✓'} seguimiento de cabeza: ${passes} comprobaciones, ${failures} fallos\n`);
process.exit(failures ? 1 : 0);
