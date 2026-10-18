// BestRunning · escena 3D · fantasma de tu mejor marca (SPEC §14.1-1): matemática de su recorrido (sin three.js).
// trace = [[tSec, km/h], ...] (speedTrace de la sesión anterior). kmAt(t) integra a tramos constantes, como el motor.

export function createGhostTrace() {
  let times = null;
  let speeds = null;
  let cum = null;
  let label = '';

  function idx(t) {
    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid] <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  return {
    get active() { return !!times; },
    get label() { return label; },
    /** g: { trace, label } o null. Devuelve true si queda activo. */
    set(g) {
      times = null; speeds = null; cum = null; label = '';
      const tr = Array.isArray(g?.trace) ? g.trace : null;
      if (!tr) return false;
      const pts = [];
      for (const p of tr) {
        const t = Number(p?.[0]);
        const v = Number(p?.[1]);
        if (Number.isFinite(t) && Number.isFinite(v) && t >= 0 && v >= 0 && v < 40) pts.push([t, v]);
      }
      pts.sort((a, b) => a[0] - b[0]);
      if (pts.length < 2) return false;
      times = new Float64Array(pts.length);
      speeds = new Float64Array(pts.length);
      cum = new Float64Array(pts.length);
      let acc = 0;
      for (let i = 0; i < pts.length; i++) {
        if (i > 0) acc += (pts[i - 1][1] * Math.max(0, pts[i][0] - pts[i - 1][0])) / 3600;
        times[i] = pts[i][0];
        speeds[i] = pts[i][1];
        cum[i] = acc;
      }
      label = typeof g.label === 'string' ? g.label.slice(0, 60) : '';
      return true;
    },
    /** Distancia del fantasma (km) en el segundo t de la clase. */
    kmAt(t) {
      if (!times) return 0;
      const n = times.length;
      if (t <= times[0]) return 0;
      if (t >= times[n - 1]) return cum[n - 1] + (speeds[n - 1] * (t - times[n - 1])) / 3600;
      const i = idx(t);
      return cum[i] + (speeds[i] * (t - times[i])) / 3600;
    },
    /** Velocidad del fantasma (km/h) en t. */
    speedAt(t) {
      if (!times) return 0;
      if (t >= times[times.length - 1]) return speeds[speeds.length - 1];
      if (t <= times[0]) return speeds[0];
      return speeds[idx(t)];
    },
  };
}
