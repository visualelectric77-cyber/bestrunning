// ESTADIO · espectáculo del test VAM: fuegos artificiales sobre la cubierta. Una sola llamada de dibujo (puntos
// aditivos), que solo se pinta mientras hay un estallido en el aire. Cada estallido ocupa una ranura (origen, reloj de
// salida, color, velocidad); las partículas de la ranura salen en todas direcciones, se frenan con el aire y caen.
// Sin Math.random ni relojes propios: el azar viene de ctx.rng y el tiempo, de frame.time (capturas deterministas).
import { FW_VERT, FW_FRAG } from './shaders.js';

export function buildFireworks(THREE, rand, { bursts = 10, per = 120 } = {}) {
  const n = bursts * per;
  const seed = new Float32Array(n * 4);
  // (intercaladas: con calidad baja se pinta solo la primera mitad y todos los estallidos pierden densidad por igual)
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    seed[k] = i % bursts; seed[k + 1] = rand(); seed[k + 2] = rand(); seed[k + 3] = rand();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const uB = [];
  const uBC = [];
  for (let b = 0; b < bursts; b++) { uB.push(new THREE.Vector4(0, 0, 0, -1e6)); uBC.push(new THREE.Vector4(1, 1, 1, 40)); }
  const u = {
    uB: { value: uB }, uBC: { value: uBC }, uTime: { value: 0 }, uPx: { value: 2 },
    uAvoid: { value: new THREE.Vector4(2, 2, 2, 2) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: FW_VERT, fragmentShader: FW_FRAG, defines: { NB: bursts }, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Points(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 30;
  mesh.visible = false;

  // cola de estallidos programados (pocos y de tarde en tarde: aquí sí se puede asignar)
  const queue = [];
  let next = 0;
  let until = -1e9;
  const LIFE = 3.3;
  const glow = new THREE.Color();

  return {
    mesh, u, per, bursts,
    /** Programa un estallido en el reloj `at` (s de animación), en coordenadas del estadio. */
    launch(at, x, y, z, color, speed = 44) {
      queue.push({ at, x, y, z, r: color.r, g: color.g, b: color.b, speed });
    },
    /** Cada fotograma: suelta los que tocan y decide si hay algo que pintar. Devuelve el color medio en el aire. */
    update(time, px, count) {
      for (let i = queue.length - 1; i >= 0; i--) {
        const q = queue[i];
        if (q.at > time) continue;
        queue.splice(i, 1);
        if (time - q.at > 1) continue;                        // llegó tarde (salto de reloj): se descarta
        const k = next++ % bursts;
        uB[k].set(q.x, q.y, q.z, q.at);
        uBC[k].set(q.r, q.g, q.b, q.speed);
        until = Math.max(until, q.at + LIFE);
      }
      const on = time < until;
      mesh.visible = on;
      glow.setRGB(0, 0, 0);
      if (!on) return glow;
      u.uTime.value = time;
      u.uPx.value = px;
      geo.setDrawRange(0, count > 0 ? Math.min(n, count) : n);
      for (let k = 0; k < bursts; k++) {
        const age = time - uB[k].w;
        if (age < 0 || age > LIFE) continue;
        const e = Math.exp(-age * 1.5) * Math.min(1, age / 0.08);
        glow.r += uBC[k].x * e; glow.g += uBC[k].y * e; glow.b += uBC[k].z * e;
      }
      return glow;
    },
    get pending() { return queue.length; },
    clear() { queue.length = 0; until = -1e9; mesh.visible = false; for (const b of uB) b.w = -1e6; },
  };
}
