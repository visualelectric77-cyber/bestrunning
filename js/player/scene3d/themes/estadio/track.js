// ESTADIO · geometría de la pista oval (sin three.js ni DOM). Medidas reglamentarias de una pista de 400 m: rectas de
// 84,39 m, radio interior 36,5 m, 8 calles de 1,22 m. Espacio del estadio: centro en el origen, y hacia arriba, rectas
// paralelas al eje x. Se corre en sentido antihorario visto desde arriba (la cuerda/bordillo queda a la IZQUIERDA):
// recta de meta en z > 0 hacia +x, curva 1 en x > 0, recta opuesta en z < 0 hacia −x, curva 2 en x < 0.
// σ = longitud de arco sobre la TRAYECTORIA DE LA CÁMARA (a RC del bordillo), empezando al inicio de la recta de meta.
// La misma σ se calcula en el shader del suelo (radial en las curvas), así líneas y luces casan al centímetro.

export const LANE_W = 1.22;
export const LANES = 8;
export const TRACK_W = LANE_W * LANES;      // 9,76 m
export const A = 42.195;                    // media recta
export const LS = 2 * A;                    // recta (84,39 m)
export const R0 = 36.5;                     // radio del bordillo
export const RC = 1.83;                     // trayectoria de la cámara: centro de la calle 2
export const RCP = R0 + RC;
export const BEND = Math.PI * RCP;          // longitud de una curva sobre la trayectoria
export const LC = 2 * LS + 2 * BEND;        // vuelta sobre la trayectoria (≈ 409,6 m)
export const WALL = 14.3;                   // del bordillo al muro de las vallas (calles + 4,5 m de margen)
export const ROOF_EDGE = 22;                // borde frontal de la cubierta (desde el bordillo)
export const ROOF_Y = 41.2;                 // altura de los focos bajo la cubierta

/** Normaliza σ a [0, LC). */
export const wrapS = (s) => ((s % LC) + LC) % LC;

/** Diferencia σ(b) − σ(a) envuelta a [−LC/2, LC/2). */
export function relS(b, a) {
  let d = (b - a) % LC;
  if (d >= LC / 2) d -= LC;
  else if (d < -LC / 2) d += LC;
  return d;
}

/**
 * Punto de la trayectoria paralela a distancia `r` del bordillo (r > 0 hacia fuera) en el parámetro σ.
 * Escribe en out { x, z, tx, tz } (posición y tangente unitaria en el sentido de carrera).
 */
export function pathPoint(s, r, out) {
  const u = wrapS(s);
  const R = R0 + r;
  if (u < LS) {
    out.x = -A + u; out.z = R; out.tx = 1; out.tz = 0;
  } else if (u < LS + BEND) {
    const ph = (u - LS) / RCP;
    const sn = Math.sin(ph);
    const cs = Math.cos(ph);
    out.x = A + R * sn; out.z = R * cs; out.tx = cs; out.tz = -sn;
  } else if (u < 2 * LS + BEND) {
    out.x = A - (u - LS - BEND); out.z = -R; out.tx = -1; out.tz = 0;
  } else {
    const ph = (u - 2 * LS - BEND) / RCP;
    const sn = Math.sin(ph);
    const cs = Math.cos(ph);
    out.x = -A - R * sn; out.z = -R * cs; out.tx = -cs; out.tz = sn;
  }
  return out;
}

/**
 * Contorno del estadio a distancia `d` del bordillo, muestreado (rectas con 2 puntos, curvas con `nb` tramos).
 * Devuelve [{ x, z, nx, nz, u }] cerrado (el último repite el primero); n = normal hacia fuera, u = longitud de arco
 * a esa distancia. Mismo orden y número de puntos para cualquier d (para extruir perfiles).
 */
export function outline(d, nb = 28) {
  const R = R0 + d;
  const pts = [];
  const push = (x, z, nx, nz) => {
    const prev = pts[pts.length - 1];
    const u = prev ? prev.u + Math.hypot(x - prev.x, z - prev.z) : 0;
    pts.push({ x, z, nx, nz, u });
  };
  push(-A, R, 0, 1);
  for (let i = 0; i <= nb; i++) {
    const ph = (i / nb) * Math.PI;
    push(A + R * Math.sin(ph), R * Math.cos(ph), Math.sin(ph), Math.cos(ph));
  }
  for (let i = 0; i <= nb; i++) {
    const ph = (i / nb) * Math.PI;
    push(-A - R * Math.sin(ph), -R * Math.cos(ph), -Math.sin(ph), -Math.cos(ph));
  }
  return pts;
}

/** Integral de easeInOutCubic en [0, u] (u ∈ [0, 1]). */
export function easeCubicIntegral(u) {
  if (u <= 0) return 0;
  if (u >= 1) return 0.5;
  if (u <= 0.5) return u * u * u * u;
  const w = 2 - 2 * u;
  return u - 0.5 + (w * w * w * w) / 16;
}
