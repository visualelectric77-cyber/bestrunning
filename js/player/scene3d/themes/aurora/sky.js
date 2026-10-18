// BestRunning · escenario AURORA · cielo y estrellas.
// Cielo: degradado profundo azul-negro (cénit #020308 → horizonte #0b1020), resplandor muy tenue del color de la zona
// SOLO donde nace el río (no es una banda que cruce por detrás del número), un velo de luz difusa neutra (airglow) en
// la banda de las cortinas para que la aurora no parezca pegada sobre negro y un filete fino en el horizonte. Triángulo a pantalla completa en el plano
// lejano, pintado el último de lo opaco (early-Z). Estrellas: 1 draw call, finas, extinguidas cerca del horizonte, sin
// destellos (centelleo ≤ 10 % y lento).

const SKY_VERT = /* glsl */ `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

const SKY_FRAG = /* glsl */ `
uniform mat4 uProjInv, uCamWorld;
uniform vec3 uZenith, uMid, uHorizon, uAccent;
uniform vec3 uGlowCol, uLine;
uniform vec2 uLineAz;
uniform float uVpAz, uVpK, uBandEl, uBandW, uBandK;
uniform vec3 uSun;     // resplandor del sol bajo (amanecer/atardecer), ya escalado (0 de noche y de día)
uniform float uSunAz;  // azimut del resplandor
varying vec2 vNdc;
void main() {
  vec4 p = uProjInv * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize((uCamWorld * vec4(p.xyz / p.w, 0.0)).xyz);
  float y = dir.y;
  float e = max(y, 0.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, e));
  col = mix(col, uZenith, smoothstep(0.18, 0.85, e));
  float az = atan(dir.x, -dir.z);
  // hora real: sol bajo bajo el horizonte ⇒ franja cálida finísima pegada al horizonte y un rubor amplio y tenue
  float sAz = abs(az - uSunAz);
  col += uSun * (exp(-e * 34.0) * (0.3 + 0.7 * exp(-sAz * 2.4)) + exp(-e * 7.0) * 0.22 * exp(-sAz * 1.3));
  float vp = exp(-abs(az - uVpAz) * 7.0);
  // resplandor donde nace el río (bruma baja, muy contenida) y filete del horizonte (idénticos en el suelo)
  col += uAccent * (exp(-abs(y) * 110.0) * (0.0015 + 0.026 * vp) + exp(-abs(y) * 500.0) * 0.016 * vp) * uVpK;
  // airglow tras las cortinas (neutro, apenas teñido: la zona es un acento, no un lavado)
  float el = asin(clamp(y, -1.0, 1.0));
  float b = (el - uBandEl) / uBandW;
  col += uGlowCol * exp(-b * b) * uBandK;
  // filete del horizonte: una línea fría de ~1 px (antialias con fwidth), solo donde no cruza el número
  float fw = max(fwidth(y), 1e-5);
  col += uLine * (1.0 - smoothstep(0.0, fw * 1.6, abs(y))) * smoothstep(uLineAz.x, uLineAz.y, az);
  gl_FragColor = vec4(col, 1.0);
}`;

const STAR_VERT = /* glsl */ `
attribute vec4 aStar; // brillo, tamaño, fase, velocidad
uniform float uTime, uPx, uAlpha;
varying float vI;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 dir = normalize(position);
  float ext = smoothstep(0.03, 0.32, dir.y);
  float tw = 1.0 + 0.1 * sin(uTime * aStar.w + aStar.z);
  float s = aStar.y * uPx;
  vI = aStar.x * ext * tw * uAlpha * min(1.0, s * s);
  gl_PointSize = max(1.0, s);
}`;

const STAR_FRAG = /* glsl */ `
varying float vI;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(q, q) * 3.2);
  gl_FragColor = vec4(vec3(0.82, 0.88, 1.0) * vI * a, 1.0);
}`;

export function createSky(ctx) {
  const { THREE, root, camera } = ctx;
  const C = (hex) => new THREE.Color(hex);

  const u = {
    uProjInv: { value: camera.projectionMatrixInverse },
    uCamWorld: { value: camera.matrixWorld },
    uZenith: { value: C('#020308') },
    uMid: { value: C('#04060d') },
    uHorizon: { value: C('#0a0f1d') },
    uAccent: { value: new THREE.Color() },
    uGlowCol: { value: new THREE.Color() },
    uLine: { value: new THREE.Color('#141a2c') },
    uLineAz: { value: new THREE.Vector2(-10, -9) },
    uVpAz: { value: 0 },
    uVpK: { value: 1 },
    uBandEl: { value: 0.35 },
    uBandW: { value: 0.12 },
    uBandK: { value: 0.012 },
    uSun: { value: new THREE.Color(0, 0, 0) },
    uSunAz: { value: -0.3 },
  };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const sky = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: u, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, depthWrite: false,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = 1000;
  root.add(sky);

  // Estrellas (semilla fija ⇒ el mismo cielo siempre)
  const R = ctx.rng(7031);
  const N = ctx.qualityLevel >= 2 ? 900 : 520;
  const pos = new Float32Array(N * 3);
  const at = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const az = (R() - 0.5) * Math.PI * 1.6;
    const sy = 0.02 + Math.pow(R(), 0.8) * 0.96; // sin(elevación)
    const cy = Math.sqrt(1 - sy * sy);
    pos[i * 3] = Math.sin(az) * cy * 2400;
    pos[i * 3 + 1] = sy * 2400;
    pos[i * 3 + 2] = -Math.cos(az) * cy * 2400;
    const m = Math.pow(R(), 6);           // casi todas tenues, pocas brillantes
    at[i * 4] = 0.05 + 0.75 * m;
    at[i * 4 + 1] = 0.9 + 1.3 * Math.pow(R(), 3);
    at[i * 4 + 2] = R() * 6.283;
    at[i * 4 + 3] = 0.3 + R() * 0.9;
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sGeo.setAttribute('aStar', new THREE.BufferAttribute(at, 4));
  const su = { uTime: { value: 0 }, uPx: { value: 2 }, uAlpha: { value: 1 } };
  const stars = new THREE.Points(sGeo, new THREE.ShaderMaterial({
    uniforms: su, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  stars.frustumCulled = false;
  stars.renderOrder = 1;
  root.add(stars);

  return {
    u,
    su,
    update(f, accent, look) {
      u.uAccent.value.copy(accent);
      u.uGlowCol.value.copy(look.glow);
      u.uLineAz.value.set(look.lineAz0, look.lineAz1);
      u.uVpAz.value = look.vpAz;
      u.uVpK.value = look.vpK;
      u.uBandEl.value = look.bandEl;
      u.uBandW.value = look.bandW;
      u.uBandK.value = look.bandK;
      su.uTime.value = f.reducedMotion ? 0 : f.time;
      su.uPx.value = f.dpr;
      su.uAlpha.value = look.stars;
      // hora real (daylight.js): degradado del cielo, resplandor del sol bajo y estrellas
      const dl = look.daylight;
      if (dl) {
        u.uZenith.value.copy(dl.zenith);
        u.uMid.value.copy(dl.mid);
        u.uHorizon.value.copy(dl.horizon);
        u.uSun.value.copy(dl.sun).multiplyScalar(look.sunK);
        u.uSunAz.value = look.sunAz;
        su.uAlpha.value = look.stars * dl.stars;
      }
    },
  };
}

// ───────── Luz real de la hora local del dispositivo (createDaylight) ─────────
// El cielo sigue el reloj del iPhone: noche cerrada con estrellas · hora azul previa al alba (las estrellas se retiran,
// el horizonte se aclara en azul profundo) · amanecer (un resplandor cálido muy bajo, pegado al horizonte, y su reflejo
// satinado en la llanura) · día "noche americana" (el día graduado a una noche azul de cine: sigue oscuro, los datos
// mandan) · atardecer cálido · hora azul · noche. Orto y ocaso aproximados para la España peninsular según la fecha.
// Todo es sutil: el resplandor no pasa de ~2 % de luminancia lineal y vive a pocos grados del horizonte.
// Coste: se recalcula una vez por minuto (o al cambiar la hora forzada); por fotograma solo se copian colores.
// Laboratorio: globalThis.__brAuroraHour = 7.6 fuerza la hora (capturas deterministas); undefined ⇒ reloj real.

const TAU = Math.PI * 2;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createDaylight(THREE) {
  const C = (h) => new THREE.Color(h);
  const NIGHT = [C('#020308'), C('#04060d'), C('#0a0f1d')];
  const BLUE = [C('#02051a'), C('#050d2a'), C('#0d1838')];
  const DAY = [C('#030817'), C('#06112b'), C('#0e1a39')];
  const ROSE = C('#b8507e');
  const WARM = C('#ff7438');
  const out = {
    zenith: new THREE.Color(), mid: new THREE.Color(), horizon: new THREE.Color(), sun: new THREE.Color(),
    sunSide: -1, stars: 1, warm: 0, blue: 0, day: 0, hour: 0, phase: 'noche',
  };
  const tmp = new THREE.Color();
  let lastKey = '';
  let lastTime = -1e9;

  function readClock() {
    let d;
    try { d = new Date(); } catch { d = null; }
    const forced = Number(globalThis.__brAuroraHour);
    const hour = Number.isFinite(forced) && globalThis.__brAuroraHour != null ? ((forced % 24) + 24) % 24 : d ? d.getHours() + d.getMinutes() / 60 : 22;
    let doy = 291;
    if (d) { const y0 = new Date(d.getFullYear(), 0, 1); doy = Math.floor((d - y0) / 86400000) + 1; }
    return { hour, doy };
  }

  function compute(hour, doy) {
    const c = Math.cos((TAU * (doy - 355)) / 365);
    const sunrise = 7.65 + 0.95 * c;   // ≈ 8:36 en diciembre, 6:42 en junio (hora oficial)
    const sunset = 19.8 - 2.0 * c;     // ≈ 17:48 en diciembre, 21:48 en junio
    // horas firmadas desde el cruce del horizonte más cercano (+ de día, − de noche)
    const a = hour < sunrise ? hour - sunrise : hour > sunset ? sunset - hour : Math.min(hour - sunrise, sunset - hour);
    const blue = sstep(-1.7, -0.25, a);
    const day = sstep(0.5, 2.2, a);
    const warm = Math.exp(-(((a - 0.1) / 0.8) ** 2));
    for (let i = 0; i < 3; i++) {
      tmp.copy(NIGHT[i]).lerp(BLUE[i], blue).lerp(DAY[i], day);
      (i === 0 ? out.zenith : i === 1 ? out.mid : out.horizon).copy(tmp);
    }
    out.sun.copy(ROSE).lerp(WARM, sstep(-0.9, 0.15, a)).multiplyScalar(warm);
    out.warm = warm;
    out.blue = blue;
    out.day = day;
    out.stars = 1 - 0.86 * sstep(-1.5, 0.3, a);
    out.sunSide = hour < 13.5 ? -1 : 1;
    out.hour = hour;
    out.phase = a < -1.7 ? 'noche' : a < -0.25 ? 'hora azul' : a < 0.9 ? (hour < 13.5 ? 'amanecer' : 'atardecer') : 'día';
  }

  return {
    out,
    /** time: s de animación (monótono). Recalcula como mucho una vez por minuto o si cambia la hora forzada. */
    update(time) {
      const forced = globalThis.__brAuroraHour;
      const key = forced == null ? '' : String(forced);
      if (key === lastKey && time - lastTime < 60 && time >= lastTime) return out;
      lastKey = key;
      lastTime = time;
      try { const { hour, doy } = readClock(); compute(hour, doy); } catch { compute(22, 291); }
      return out;
    },
  };
}
