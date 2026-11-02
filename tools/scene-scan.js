// RITMUP · barrido de TODOS los escenarios 3D (se ejecuta en el navegador, desde tools/scene-lab.html o cualquier
// página servida por tools/snap-server.mjs):
//   const { scanAll } = await import('/tools/scene-scan.js');
//   const r = await scanAll({ themes, minutes: 60, step: 45, head: true });
// Para cada escenario crea una escena en modo captura (reloj virtual), recorre una clase larga (pyramid de 60 min ≈
// 10 km: cruza los enlaces de todos los patrones de 200–6000 m) y en cada punto mide la imagen: luminancia media y
// fracción de píxeles casi negros en la franja del suelo (55–92 % de la altura). Un «muro negro» o un objeto que se
// cruza delante de la cámara sale como un pico de negro respecto a la mediana del propio escenario. Con head: true
// repite cada punto con la cabeza desplazada (perspectiva acoplada a los topes) para ver que nada se rompe.
// También anota errores de consola y si el escenario cayó al de respaldo.
import { createScene3D } from '../js/player/scene3d.js';
import { buildWorkout } from '../js/training/generator.js';

const LEVELS = { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 };
const TREADMILL = { minSpeed: 1, maxSpeed: 18, hasIncline: false, maxIncline: 12 };

function workoutFor(theme, minutes) {
  if (theme === 'carrera') {
    const v = 11; const km = 10; const raceSec = Math.round((km / v) * 3600);
    const segs = [
      { zone: 'warmup', speed: 7.2, incline: 0, sec: 120, label: 'Calentamiento', cue: '', block: 'Calentamiento' },
      { zone: 'jog', speed: 8.3, incline: 0, sec: 120, label: 'A la salida', cue: '', block: 'Calentamiento' },
      { zone: 'run', speed: v, incline: 0, sec: raceSec, label: `Carrera ${km}K`, cue: '', block: 'Carrera', race: true },
      { zone: 'cooldown', speed: 6.5, incline: 0, sec: 180, label: 'Vuelta a la calma', cue: '', block: 'Vuelta a la calma' },
    ];
    const total = segs.reduce((a, s) => a + s.sec, 0);
    return { id: 'scan-race', templateId: 'scan-race', title: `Carrera ${km}K`, category: 'race', minutes: Math.round(total / 60), totalSec: total,
      segments: segs, isTest: false, estDistanceKm: km + 0.8, maxSpeed: v, race: { key: `${km}k`, km, label: `${km}K`, start: 240, end: 240 + raceSec } };
  }
  const wk = buildWorkout('pyramid', { minutes, levels: LEVELS, seed: 3, loadFactor: 1, hasIncline: false, treadmill: TREADMILL, weightKg: 78 });
  if (theme === 'halloween') wk.event = 'halloween';
  if (theme === 'nieve') wk.event = 'navidad';
  return wk;
}

function stateAt(wk, t) {
  let a = 0; let i = 0; let km = 0;
  for (; i < wk.segments.length; i++) {
    const s = wk.segments[i];
    if (t < a + s.sec || i === wk.segments.length - 1) { km += (s.speed * Math.max(0, t - a)) / 3600; break; }
    km += (s.speed * s.sec) / 3600; a += s.sec;
  }
  const seg = wk.segments[i];
  return { status: 'running', totalElapsed: t, segIndex: i, segElapsed: t - a, segRemaining: Math.max(0, seg.sec - (t - a)), currentSpeed: seg.speed, distanceKm: km, rate: 1 };
}

function measure(src, W, H) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  let sum = 0; let n = 0; let black = 0; let nb = 0;
  const y0 = Math.floor(H * 0.55); const y1 = Math.floor(H * 0.92);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      const l = (0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]) / 255;
      sum += l; n++;
      if (y >= y0 && y < y1) { nb++; if (l < 0.012) black++; }
    }
  }
  return { lum: +(sum / n).toFixed(4), black: +(black / nb).toFixed(3) };
}

export async function scanTheme(theme, { minutes = 60, step = 45, head = true, w = 180, h = 390, frames = 24 } = {}) {
  const errors = [];
  const onErr = (e) => errors.push(String(e?.message || e?.reason || e));
  addEventListener('error', onErr); addEventListener('unhandledrejection', onErr);
  const wk = workoutFor(theme, minutes);
  const cv = document.createElement('canvas');
  const sc = await createScene3D(cv, { workout: wk, levels: LEVELS, quality: 'high', theme, treadmill: TREADMILL, snapshot: { width: w, height: h, dpr: 1 } });
  let pose = null;
  sc.setHead(() => pose);
  const pts = [];
  try {
    const HEADS = head ? [null, { x: 0.12, y: 0.09, z: -0.1, yaw: 0.45, pitch: 0.3, w: 1 }, { x: -0.12, y: -0.09, z: 0.15, yaw: -0.45, pitch: -0.3, w: 1 }] : [null];
    for (let t = 4; t < wk.totalSec - 2; t += step) {
      for (const hp of HEADS) {
        pose = hp;
        sc.setState(stateAt(wk, t - 0.5)); sc.snapshot.sync();
        for (let k = 0; k < frames; k++) { sc.setState(stateAt(wk, t - 0.5 + k / 60)); sc.snapshot.step(1 / 60); }
        const m = measure(cv, 90, 195);
        pts.push({ t, head: hp ? (hp.x > 0 ? '+' : '-') : '0', ...m });
      }
    }
  } finally {
    const info = sc.getInfo();
    sc.destroy({ releaseContext: true });
    removeEventListener('error', onErr); removeEventListener('unhandledrejection', onErr);
    pts.theme = info.theme;
  }
  // picos de negro respecto a la mediana del propio escenario (por variante de cabeza)
  const flags = [];
  for (const hv of ['0', '+', '-']) {
    const ser = pts.filter((p) => p.head === hv);
    if (!ser.length) continue;
    const med = [...ser.map((p) => p.black)].sort((a, b) => a - b)[Math.floor(ser.length / 2)];
    const medL = [...ser.map((p) => p.lum)].sort((a, b) => a - b)[Math.floor(ser.length / 2)];
    for (const p of ser) {
      if (p.black - med > 0.25 || (medL > 0.02 && p.lum < medL * 0.35)) flags.push({ t: p.t, head: hv, black: p.black, med, lum: p.lum, medL });
    }
  }
  return { theme, ran: pts.theme, n: pts.length, errors, flags, km: +stateAt(wk, wk.totalSec).distanceKm.toFixed(1),
    lum: [Math.min(...pts.map((p) => p.lum)), Math.max(...pts.map((p) => p.lum))], black: [Math.min(...pts.map((p) => p.black)), Math.max(...pts.map((p) => p.black))] };
}

export async function scanAll({ themes, ...o } = {}) {
  const out = [];
  for (const th of themes) {
    try { out.push(await scanTheme(th, o)); } catch (e) { out.push({ theme: th, crash: String(e?.stack || e) }); }
  }
  return out;
}
