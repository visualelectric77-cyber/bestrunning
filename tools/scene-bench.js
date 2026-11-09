// RITMUP · banco de pruebas de un escenario 3D. Pegar en la consola de tools/scene-lab.html (o con javascript_tool):
//   await bench('vision')                    → { ms por fotograma, llamadas, triángulos } a calidad alta, 880×1912
//   await bench('costa', 420, 600, 'pyramid', 20)
// Pinta N fotogramas seguidos de una escena de captura y espera a la GPU (gl.finish), así no depende de los fps de la
// pestaña. Sirve para comparar antes/después de un cambio: recarga la página entre medidas y haz 3 pasadas.
window.bench = async (theme = 'vision', T = 1060, N = 600, tpl = 'tempo-waves', min = 45) => {
  const core = `${location.origin}/js/player/scene3d.js`;   // ruta de página, no de módulo: este archivo se pega en la consola
  const { createScene3D } = await import(core);
  const p = window.lab.plan({ template: tpl, minutes: min });
  const segs = p.segments.map((s) => ({ zone: s.zone, speed: s.speed, incline: 0, sec: s.sec, label: s.label || 'x', cue: '', block: 'b' }));
  const wk = { id: 'b', title: 'b', segments: segs, totalSec: p.totalSec };
  const cv = document.createElement('canvas');
  const sc = await createScene3D(cv, {
    workout: wk, levels: { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13 }, quality: 'high', reducedMotion: false, tvMode: false, strideBob: true,
    treadmill: { minSpeed: 1, maxSpeed: 18, hasIncline: false, maxIncline: 12 }, theme, snapshot: { width: 440, height: 956, dpr: 2 },
  });
  let i = 0;
  while (i < segs.length - 1 && p.segments[i + 1].start <= T) i++;
  const acc = p.segments[i].start;
  const feed = (t) => sc.setState({ status: 'running', totalElapsed: t, segIndex: i, segElapsed: t - acc, segRemaining: segs[i].sec - (t - acc), currentSpeed: segs[i].speed, distanceKm: 2 });
  feed(T);
  sc.snapshot.sync();
  const gl = sc._debug.renderer.getContext();
  for (let k = 0; k < 120; k++) { feed(T + k / 60); sc.snapshot.step(1 / 60); }
  gl.finish();
  const px = new Uint8Array(4);
  const a = performance.now();
  for (let k = 0; k < N; k++) { feed(T + 2 + k / 60); sc.snapshot.step(1 / 60); }
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.finish();
  const ms = (performance.now() - a) / N;
  const info = sc.getInfo();
  sc.destroy();
  return { theme, T, ms: +ms.toFixed(3), calls: info.calls, tris: info.triangles };
};
