// RITMUP · escenario TÚNEL (realista). Un tubo de metal cepillado, de paneles con sus juntas, con anillos de luz cada
// 14 m del color del tramo que iluminan de verdad las paredes y el suelo pulido (luces analíticas con la BRDF física:
// cada anillo deja su brillo especular en el suelo), dos líneas de luz blanca a lo largo del techo y marcas en el suelo
// cada 7 m. Al fondo, la salida: un resplandor suave del color del tramo. Pensado para series y pirámides: sin efecto
// warp ni destellos (§15.2); la velocidad se lee en los anillos y las juntas que pasan.
// A VELOCIDAD REAL: juntas, anillos y marcas avanzan a km/h ÷ 3,6 m/s.
import { createRunner, scrollZ, WAVE_GLSL } from './kit/runner.js';
import { worldUrl, loadTex, envFrom, glowMaterial, halos, addLamps, setInstances } from './kit/world.js';

export const meta = {
  id: 'tunel',
  name: 'Túnel',
  description: 'Un tubo de metal con anillos de luz del color de tu tramo. Para series.',
};

const T = 'tunel';
const R = 4.3;          // radio del tubo
const CY = 2.7;         // altura del eje
const RING_D = 14;      // m entre anillos
const MARK_D = 7;       // m entre marcas del suelo
const SEAM_D = 3.5;     // m entre juntas transversales
const LEN = 900;

// PULSO: una franja fina de luz que recorre el tubo UNA vez, de ti hacia el fondo (§15.2: «una línea de luz fina que
// pasa una vez»; nada de destellos). uPulse = (frente en m por delante, intensidad, grosor del frente, cola).
const PULSE_GLSL = /* glsl */ `
uniform vec4 uPulse;
uniform vec3 uPulseCol;
float pulseBand(float srel) {
  float d = uPulse.x - srel;
  return uPulse.y * (d > 0.0 ? exp(-d / uPulse.w) : exp(-(d * d) / (uPulse.z * uPulse.z)));
}
`;

// Tiras de luz A TRAZOS ancladas al mundo (una barra por panel, el hueco en la junta): antes eran dos líneas continuas
// que no decían nada de la velocidad; ahora los huecos pasan a tu ritmo real por la periferia de la vista.
const DASH_VERT = /* glsl */ `
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const DASH_FRAG = /* glsl */ `
uniform vec3 uTint;
uniform float uMix, uPower, uFogK, uS, uDash, uDuty;
varying vec3 vW;
${WAVE_GLSL}
${PULSE_GLSL}
#include <common>
#include <fog_pars_fragment>
void main() {
  float br; vec3 zc = waveColor(-vW.z, br);
  float q = (vW.z - uS) / uDash;
  float fw = fwidth(q) + 1e-4;
  float on = 1.0 - smoothstep(0.5 * uDuty - fw, 0.5 * uDuty + fw, abs(fract(q) - 0.5));
  on = mix(on, uDuty, clamp(fw * 2.0 - 0.3, 0.0, 1.0));
  vec3 c = mix(uTint, zc, uMix) * br * uPower * (0.05 + 0.95 * on) + uPulseCol * pulseBand(-vW.z) * 1.6;
  gl_FragColor = vec4(c, 1.0);
  #if defined(USE_FOG) && defined(FOG_EXP2)
  float ff = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth * uFogK);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, ff);
  #endif
}`;

/**
 * Juntas de paneles que avanzan con el mundo (parche de MeshStandardMaterial). seamAA: junta de 3,2 cm con antialias
 * que CONSERVA la energía (de lejos se queda en 1 px y se desvanece), cada dirección con SU derivada. Antes las dos
 * usaban la de z y se ensanchaban a negro pleno: las juntas longitudinales eran radios negros gruesos hacia el fondo.
 * El tono de cada panel va de junta a junta y no salta al reiniciarse uS (840 m = 240 paneles).
 */
function panelPatch(mat, uS, pulse, { floor = false } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uS = uS;
    sh.uniforms.uPulse = pulse.uPulse;
    sh.uniforms.uPulseCol = pulse.uPulseCol;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vPW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vPW;
uniform float uS;
${PULSE_GLSL}
float ph(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float seamAA(float d, float f){
  const float W = 0.016;
  float h = 0.5 * f;
  float a = 1.0 - smoothstep(W - h, W + h, d);
  return f > 2.0 * W ? a * 2.0 * W * f / ((W + h) * (W + h)) : a;
}
float gSeam; float gPanel;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    float zz = vPW.z - uS;
    float qz = zz / ${SEAM_D.toFixed(1)};
    float dz = abs(fract(qz + 0.5) - 0.5) * ${SEAM_D.toFixed(1)};
    float fz = fwidth(vPW.z) + 1e-4;
    ${floor
    ? `float ql = vPW.x / 1.1 + 0.5;
    float dl = abs(fract(ql + 0.5) - 0.5) * 1.1;
    float fl = fwidth(vPW.x) + 1e-4;
    float il = floor(ql);`
    : `float ql = atan(vPW.y - ${CY.toFixed(1)}, vPW.x) / (3.14159265 / 10.0) + 0.5;
    float dl = abs(fract(ql + 0.5) - 0.5) * (3.14159265 / 10.0) * ${R.toFixed(1)};
    float fl = length(fwidth(vPW.xy)) + 1e-4;
    float il = mod(floor(ql), 20.0);`}
    vec2 pid = vec2(mod(floor(qz), 240.0), il);
    gSeam = max(seamAA(dz, fz), seamAA(dl, fl));
    gPanel = ph(pid + 3.0);
    diffuseColor.rgb *= (0.82 + 0.3 * gPanel) * (1.0 - 0.85 * gSeam);
  }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = clamp(roughnessFactor * (0.75 + 0.5 * gPanel) + 0.5 * gSeam, 0.04, 1.0);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += uPulseCol * (pulseBand(-vPW.z) * (0.7 + 0.5 * gPanel) * (1.0 - gSeam));`);
  };
  mat.customProgramCacheKey = () => (floor ? 'tunel-floor' : 'tunel-wall');
}

export async function createTheme(ctx) {
  const { THREE, root, camera, scene, renderer } = ctx;
  camera.near = 0.08;
  camera.far = 1200;
  renderer.setClearColor(0x020203, 1);
  ctx.post.set({ toneMapping: 'aces', exposure: 0.9, bloomStrength: 0.34, bloomThreshold: 0.88, bloomRadius: 0.18, vignette: 0.34, saturation: 1.05 });

  const envTex = await loadTex(ctx, worldUrl(T, 'env.jpg'), { srgb: true, aniso: 1 });
  const runner = createRunner(ctx, {
    exposure: 0.9,
    horizonP: 0.05,
  });   // el plano final lo compone este escenario (abajo, en update)

  scene.environment = envFrom(ctx, envTex);
  scene.environmentIntensity = 0.22;
  scene.fog = new THREE.FogExp2(new THREE.Color(0.004, 0.004, 0.006), 0.011);
  root.add(new THREE.HemisphereLight(new THREE.Color(0.2, 0.22, 0.28), new THREE.Color(0.02, 0.02, 0.03), 0.08));
  const uS = { value: 0 };
  const pulse = { uPulse: { value: new THREE.Vector4(0, 0, 1, 4) }, uPulseCol: { value: new THREE.Color() } };

  // ── tubo y suelo ──
  const tubeGeo = new THREE.CylinderGeometry(R, R, LEN, 96, 1, true);
  tubeGeo.rotateX(Math.PI / 2);
  tubeGeo.translate(0, CY, -LEN / 2 + 20);
  const wallMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.22, 0.23, 0.25), metalness: 0.85, roughness: 0.32, side: THREE.BackSide, envMapIntensity: 1 });
  panelPatch(wallMat, uS, pulse);
  const tube = new THREE.Mesh(tubeGeo, wallMat);
  tube.frustumCulled = false;
  root.add(tube);
  const halfW = Math.sqrt(R * R - CY * CY);
  const floorGeo = new THREE.PlaneGeometry(2 * halfW, LEN).rotateX(-Math.PI / 2).translate(0, 0, -LEN / 2 + 20);
  const floorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.05, 0.052, 0.058), metalness: 0.3, roughness: 0.16, envMapIntensity: 1 });
  panelPatch(floorMat, uS, pulse, { floor: true });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.frustumCulled = false;
  root.add(floor);

  // ── anillos de luz del color del tramo (cada 14 m) ──
  const nRing = Math.ceil(LEN * 0.7 / RING_D) + 2;
  const ringGeo = new THREE.TorusGeometry(R - 0.06, 0.05, 6, 96, Math.PI * 2);
  const ringMat = glowMaterial(ctx, runner, { tint: '#ffffff', mix: 1, power: 3.2, fogK: 0.3 });
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, nRing);
  setInstances(ctx, rings, nRing, (i, t) => { t.p.set(0, CY, 6 - i * RING_D); });
  // marcas del suelo (barras del color del tramo, cada 7 m)
  const nMark = Math.ceil(LEN * 0.7 / MARK_D) + 2;
  const markMat = glowMaterial(ctx, runner, { tint: '#ffffff', mix: 1, power: 2.5, fogK: 0.18 });
  const marks = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.01, 0.08), markMat, nMark);
  setInstances(ctx, marks, nMark, (i, t) => { t.p.set(0, 0.006, 6 - i * MARK_D); });
  const ringGroup = new THREE.Group();
  for (const m of [rings]) { m.frustumCulled = false; ringGroup.add(m); }
  const markGroup = new THREE.Group();
  marks.frustumCulled = false;
  markGroup.add(marks);
  root.add(ringGroup, markGroup);

  // ── tiras de luz blanca a trazos (zócalos: una barra por panel) y guías del suelo (dos trazos por panel) ──
  const dashMaterial = ({ tint, mix, power, fogK, dash, duty }) => {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTint: { value: new THREE.Color(tint) }, uMix: { value: mix },
        uPower: { value: power }, uFogK: { value: fogK }, uDash: { value: dash }, uDuty: { value: duty },
      },
      vertexShader: DASH_VERT, fragmentShader: DASH_FRAG, fog: true,
    });
    Object.assign(m.uniforms, runner.u, pulse, { uS });
    return m;
  };
  const strip = dashMaterial({ tint: '#dfe8ff', mix: 0.12, power: 1.1, fogK: 0.3, dash: SEAM_D, duty: 0.8 });
  // zócalos de luz a ras de suelo (convergen bajo el número, nunca lo cruzan)
  for (const a of [-0.5, Math.PI + 0.5]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, LEN), strip);
    m.position.set(Math.cos(a) * (R - 0.04), CY + Math.sin(a) * (R - 0.04), -LEN / 2 + 20);
    m.rotation.z = a;
    root.add(m);
  }
  const guide = dashMaterial({ tint: '#dfe8ff', mix: 0.0, power: 0.9, fogK: 0.2, dash: SEAM_D / 2, duty: 0.55 });
  for (const x of [-1.25, 1.25]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, LEN), guide);
    m.position.set(x, 0.004, -LEN / 2 + 20);
    root.add(m);
  }
  // la salida: un resplandor lejano del color del tramo
  const exitHalo = halos(ctx, runner, 1, { tint: '#ffffff', mix: 1, size: 7, grow: 0.0, power: 0.35, fogD: 0.0006 });
  setInstances(ctx, exitHalo, 1, (i, t) => { t.p.set(0, CY, -640); });
  exitHalo.frustumCulled = false;
  root.add(exitHalo);

  // luz de los anillos sobre paredes y suelo: 4 hileras (techo, dos laterales, zócalos)
  const rowTop = new THREE.Vector4(0, CY + R - 0.15, RING_D, 0);
  const rowL = new THREE.Vector4(-R + 0.3, CY + 0.6, RING_D, 0);
  const rowR = new THREE.Vector4(R - 0.3, CY + 0.6, RING_D, 0);
  const rowLow = new THREE.Vector4(0, 0.4, RING_D, 0);
  const lampOpts = { tint: '#ffffff', mix: 1, power: 3.2, range: 14 };
  const wallLamps = addLamps(wallMat, ctx, runner, [rowTop, rowL, rowR], lampOpts);
  const floorLamps = addLamps(floorMat, ctx, runner, [rowTop, rowL, rowR, rowLow], { ...lampOpts, power: 2.6 });

  // Mismo «peso» de luz en todos los tramos, despacio (sin saltos de brillo, §15.2):
  // · paredes y suelo: el azul claro, el amarillo y el naranja lavaban el tubo entero (y la cifra) y el rojo y el violeta
  //   lo dejaban casi negro → la potencia de las luces se compensa según lo que luce cada color;
  // · anillos: el bloom corta por luminancia (umbral 0,88). Con potencia fija el azul, el verde, el amarillo y el
  //   naranja lo pasaban de largo (halo gordo detrás de la cifra y de la etiqueta del tramo) y el violeta lo cruzaba de
  //   golpe en el plano final → los colores claros bajan hasta quedar justo por encima del umbral (halo corto, solo en
  //   los anillos cercanos); el rojo y el violeta siguen por debajo, con el anillo limpio (subirlos a la fuerza da un
  //   halo rojo que se come la etiqueta «SPRINT»: probado y descartado);
  // · marcas del suelo: siempre por debajo del umbral. La que pasa bajo la cámara ocupa media pantalla de ancho y, con
  //   bloom, era un resplandor que latía cada 7 m detrás de los paneles de abajo.
  // En el plano final la cámara sube hacia los anillos del techo: se baja un poco para que no deslumbren.
  const eqCol = new THREE.Color();
  let eqInit = false;
  const { clamp, clamp01, smoothstep } = ctx.util;

  // ── pulsos (cuenta atrás 3-2-1 con el color del tramo que viene, cruce de tramo, km, mitad, entrada, final) ──
  // La cuenta atrás y el cruce salen del reloj de la clase (f.timeToNext / f.segElapsed): deterministas, sin depender
  // de que llegue el evento; km / mitad / entrada / final se disparan a mano. Con movimiento reducido no hay pulsos.
  const FAR = 200;
  const man = { t0: -1e9, k: 0, dur: 1.1, col: new THREE.Color() };
  const white = new THREE.Color(0.8, 0.86, 1.0);
  let clock = 0;
  let first = true;
  const firePulse = (col, k, dur = 1.1) => { man.t0 = clock; man.k = k; man.dur = dur; man.col.copy(col); };
  // ── plano final: corte al eje del tubo (simetría de un punto), el mundo sigue deslizándose despacio, vaivén lento ──
  let finClock = 0;
  let finS = 0;
  let finNext = 0;
  let wasFinale = false;

  const inst = {
    director: { scale: 0.7, maxDown: 0.12, orbit: false },
    resize(s) { runner.resize(s); },
    update(f) {
      const st = runner.update(f);
      clock = f.time;
      const finale = f.finale > 0;
      if (finale) {
        if (!wasFinale) { finClock = 0; finS = 0; finNext = 1.6; }
        finClock += f.dt;
        if (!st.rm) finS += f.dt * 2.4 * smoothstep(0, 2.5, finClock);
        const Tg = ctx.rig.target;
        const sway = st.rm ? 0 : smoothstep(2.5, 6, finClock);
        // a ras del suelo pulido: los anillos se reflejan estirados y el tubo se abre por encima
        Tg.position.set(sway * 0.45 * Math.sin(finClock * 0.23), 0.7 + sway * 0.25 * Math.sin(finClock * 0.17), 0);
        Tg.lookAt.set(0, 2.3, -60);
        Tg.fov = st.portrait ? 76 - 6 * st.fe : 54 - 4 * st.fe;
        Tg.roll = sway * 0.05 * Math.sin(finClock * 0.19);
        Tg.shift.set(0, 0);
        ctx.rig.settle.position = 1.2; ctx.rig.settle.lookAt = 1.2; ctx.rig.settle.fov = 2.5;
        if (!wasFinale) ctx.rig.snap();
        if (!st.rm && finClock >= finNext) { finNext = finClock + 3.8; firePulse(runner.u.uColNew.value, 0.7, 1.8); }
      } else if (wasFinale) ctx.rig.target.roll = 0;
      wasFinale = finale;
      if (first) { first = false; if (!st.rm && !finale && f.t < 1.5) firePulse(ctx.zoneColor(f.zone), 0.8, 1.5); }

      const S = st.S + finS;
      uS.value = S % 840;
      ringGroup.position.z = scrollZ(S, RING_D);
      markGroup.position.z = scrollZ(S, MARK_D);
      const z0 = ringGroup.position.z + 6;
      rowTop.w = z0; rowL.w = z0; rowR.w = z0; rowLow.w = z0;
      if (!eqInit) { eqCol.copy(runner.u.uColNew.value); eqInit = true; } else eqCol.lerp(runner.u.uColNew.value, 1 - Math.exp(-f.dt * 0.9));
      const L = Math.max(0.05, 0.2126 * eqCol.r + 0.7152 * eqCol.g + 0.0722 * eqCol.b);
      const m = 0.5 * L + (eqCol.r + eqCol.g + eqCol.b) / 6;
      const fin = 1 - 0.2 * st.fe;
      const k = clamp(Math.pow(0.4 / m, 0.7), 0.72, 1.2) * fin;
      // en el plano final no hay cifra que proteger: los anillos suben hasta florecer (poco a poco, de cerca a lejos)
      ringMat.uniforms.uPower.value = clamp(1 / L, 1.5, 3.2) * fin + (1 / L) * st.fe;
      markMat.uniforms.uPower.value = Math.min(2.5 * k, (0.8 / L) * fin);
      wallLamps.uLampPower.value = 3.2 * k;
      floorLamps.uLampPower.value = 2.6 * k;
      strip.uniforms.uPower.value = 1.1 * fin;

      // pulso vigente
      let ph = -1; let pk = 0; let pc = null;
      if (!st.rm) {
        const ttn = f.timeToNext;
        if (f.running && !finale && ttn > 0 && ttn <= 3 && f.nextZone) {
          const n = Math.ceil(ttn);
          ph = (n - ttn) / 0.9; pk = n === 1 ? 1 : n === 2 ? 0.7 : 0.45; pc = ctx.zoneColor(f.nextZone);
        } else if (f.running && !finale && f.segIndex > 0 && f.segElapsed < 1.3) {
          ph = f.segElapsed / 1.3; pk = 1.15; pc = ctx.zoneColor(f.zone);
        } else if (clock - man.t0 < man.dur) { ph = (clock - man.t0) / man.dur; pk = man.k; pc = man.col; }
      }
      const P = pulse.uPulse.value;
      if (pc && ph >= 0 && ph < 1) {
        // nace a 14 m (nunca ilumina las paredes pegadas a la cámara: eso sería un destello a pantalla completa) y
        // acelera: en pantalla el aro se cierra hacia el fondo a ritmo parejo
        const front = 14 + FAR * ph * ph;
        const lum = Math.max(0.15, 0.2126 * pc.r + 0.7152 * pc.g + 0.0722 * pc.b);
        P.set(front, pk * smoothstep(0, 0.22, ph) * (1 - smoothstep(0.75, 1, ph)), 0.3 + 0.01 * front, 1.2 + 0.06 * front);
        pulse.uPulseCol.value.copy(pc).multiplyScalar(Math.min(1.6, 0.42 / lum));
      } else P.y = 0;
    },
    event(type, data) {
      runner.event(type, data);
      if (ctx.reducedMotion) return;
      if (type === 'km') firePulse(white, 0.6, 1.2);
      else if (type === 'halfway') firePulse(white, 0.8, 1.4);
    },
    get _debug() { return runner.debug(); },
    dispose() {},
  };
  return inst;
}
