// RITMUP · kit de los escenarios REALISTAS · EL TIEMPO QUE CAMBIA durante la clase (escenarios vivos, web 1.15).
// Todo es función del reloj de la clase (frame.t) o del tiempo de animación (frame.time): capturas deterministas, nada
// de Math.random. Sin destellos ni rayos (§15.2): la lluvia es fina y la intensidad cambia despacio.
import { quickLiveWeather, fetchLiveWeather, weatherPref } from '../../../weather-live.js';

/**
 * Onda lenta 0..1 para el tiempo: sube y baja con periodo `period` (s) y desfase `phase` (rad). `sharp` > 1 alarga
 * los ratos «sin» y acorta los picos (lluvia que va y viene en vez de una mezcla continua).
 */
export function weatherWave(t, period, phase = 0, sharp = 1) {
  const w = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / period + phase);
  return Math.pow(w, sharp);
}

const RAIN_VERT = /* glsl */ `
attribute vec3 aSeed;
attribute float aEnd;          // 0 = cabeza de la gota, 1 = cola (la raya que deja en el obturador)
uniform float uTime, uS, uRain, uWind, uLen;
uniform vec3 uBox;
varying float vA;
void main() {
  vec3 b = uBox;
  float speed = 7.0 + 2.5 * aSeed.x;                    // m/s de caída
  vec3 p;
  p.x = aSeed.x * b.x - b.x * 0.5 + uWind * 0.3 * sin(uTime * 0.3 + aSeed.z * 9.0);
  p.y = b.y - mod(aSeed.y * b.y + uTime * speed, b.y);
  p.z = -mod(aSeed.z * b.z - uS, b.z) + 3.0;           // la lluvia también avanza con el mundo
  p.y += speed * uLen * aEnd;                           // cola hacia arriba (cae hacia abajo)
  p.x -= uWind * uLen * aEnd;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  // solo una fracción de gotas según la intensidad (la misma gota siempre: sin parpadeo)
  float on = step(fract(aSeed.x * 7.31 + aSeed.z * 3.17), uRain);
  vA = on * smoothstep(0.6, 2.5, d) * (1.0 - smoothstep(18.0, 46.0, d));
  gl_Position = projectionMatrix * mv;
  if (on < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const RAIN_FRAG = /* glsl */ `
uniform vec3 uCol;
varying float vA;
void main() { gl_FragColor = vec4(uCol * vA, 1.0); }`;

/** Lluvia fina: rayas de 1 px que caen y avanzan con el mundo. update(f, S, intensidad 0..1). Una llamada de dibujo. */
export function createRain(ctx, { count = 1800, box = [26, 14, 50], color = [0.32, 0.35, 0.42] } = {}) {
  const { THREE } = ctx;
  const r = ctx.rng(4242);
  const pos = new Float32Array(count * 2 * 3);
  const seed = new Float32Array(count * 2 * 3);
  const end = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const a = r(); const b = r(); const c = r();
    for (let k = 0; k < 2; k++) {
      seed.set([a, b, c], (i * 2 + k) * 3);
      end[i * 2 + k] = k;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const u = {
    uTime: { value: 0 }, uS: { value: 0 }, uRain: { value: 0 }, uWind: { value: 1.2 }, uLen: { value: 0.045 },
    uBox: { value: new THREE.Vector3(...box) }, uCol: { value: new THREE.Color().setRGB(...color) },
  };
  const mesh = new THREE.LineSegments(g, new THREE.ShaderMaterial({
    uniforms: u, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 40;
  return {
    mesh, u,
    update(f, S, amount) {
      u.uTime.value = f.time;
      u.uS.value = S % u.uBox.value.z;
      u.uRain.value = f.reducedMotion ? 0 : amount;
      mesh.visible = !f.reducedMotion && amount > 0.01;
    },
  };
}

/* ───────────── tiempo real (js/player/weather-live.js) → escenarios ───────────── */

let live = null;
/** El reproductor fija el tiempo real (o null = cada escenario con su propio tiempo vivo). */
export function setLiveWeather(w) { live = w && typeof w === 'object' ? w : null; }
/** Estado del tiempo real vigente o null: { day, golden, cloud, rain, snow, mist, temp, sunEl, label }. */
export function liveWeather() { return live; }

/**
 * Lo llama cada escenario con tiempo al cargarse: con «Tiempo real» activado en Ajustes pone al instante la hora real y
 * el último tiempo conocido, y consulta el tiempo en segundo plano (y cada 3 min); con «El del escenario», lo borra.
 * Nunca lanza.
 */
let liveReq = 0;
let liveTimer = null;
export function startLiveWeather() {
  const req = ++liveReq;
  clearInterval(liveTimer);
  // al instante (sin red, síncrono): la hora real por la posición del sol y el último tiempo conocido ⇒ desde el
  // primer fotograma, nunca la «hora azul» por esperar a la red
  try { setLiveWeather(quickLiveWeather()); } catch { setLiveWeather(null); }
  const pull = () => {
    if (weatherPref().mode === 'scene') { if (req === liveReq) setLiveWeather(null); return; }
    fetchLiveWeather().then((w) => { if (req === liveReq && w) setLiveWeather(w); }).catch(() => { /* se queda con el último */ });
  };
  pull();
  // cada 3 min: el sol se mueve durante la clase y, si el servicio estaba caído, se reintenta
  liveTimer = setInterval(() => { if (req === liveReq) pull(); else clearInterval(liveTimer); }, 3 * 60 * 1000);
}
