// BestRunning · escenario GRAFITO ('blank') — referencia y respaldo de la interfaz de escenarios (SPEC §15.2).
// Un plató oscuro y sobrio: suelo de grafito satinado que refleja un horizonte tenue, calle de carrera con dos
// filetes finos del color de la zona, rayas transversales que pasan a tu velocidad real, y cada cambio de tramo como
// UNA línea fina de luz que viene por el suelo y se cruza justo en el segundo del cambio. Marcas de kilómetro en el
// suelo con tipografía de retransmisión, fantasma como un punto de luz en la calle y oro suave si vas por delante.
// 3 draw calls, shaders baratos, sin asignaciones por fotograma. Úsalo como plantilla para escenarios nuevos.

export const meta = {
  id: 'blank',
  name: 'Grafito',
  description: 'Suelo de grafito y horizonte limpio. Sobrio y el más ligero.',
};

const LANE = 0.62;      // semiancho de la calle (m)
const GATES = 3;        // líneas de cambio de tramo visibles a la vez
const PERIOD = 1200;    // múltiplo de los espaciados del suelo (precisión del flotante)

const SKY_VERT = /* glsl */ `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

const SKY_FRAG = /* glsl */ `
uniform mat4 uProjInv, uCamWorld;
uniform vec3 uTop, uHorizon, uGlow;
uniform float uBass;
varying vec2 vNdc;
void main() {
  vec4 p = uProjInv * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize((uCamWorld * vec4(p.xyz / p.w, 0.0)).xyz);
  float el = dir.y;
  float e = max(el, 0.0);
  vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.42, pow(e, 0.8)));
  float glow = exp(-abs(el) * 18.0);
  col += uGlow * glow * (0.85 + 0.15 * uBass);
  col += (uHorizon * 0.6 + uGlow * 2.0) * exp(-abs(el) * 160.0) * 0.6;  // bruma baja sobre el horizonte
  col += vec3(0.9, 0.95, 1.0) * exp(-abs(el) * 900.0) * 0.016;         // filete del horizonte
  gl_FragColor = vec4(col, 1.0);
}`;

const FLOOR_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FLOOR_FRAG = /* glsl */ `
uniform vec3 uGround, uHorizon, uGlow, uLane, uGhostCol;
uniform float uS, uFogD, uMid, uGhostZ, uGhostA, uLaneK, uAcross, uAcrossBase;
uniform vec4 uGate[${GATES}];     // z (relativo, < 0 delante), intensidad, -, -
uniform vec3 uGateCol[${GATES}];
varying vec3 vW;
NOISE_CHUNK
float bandAA(float v, float c, float w) { float fw = fwidth(v); return 1.0 - smoothstep(w, w + fw * 1.5, abs(v - c)); }
float linesAA(float c, float sp, float w) {
  float fw = fwidth(c);
  float d = abs(fract(c / sp + 0.5) - 0.5) * sp;
  float l = 1.0 - smoothstep(w, w + fw * 1.5, d);
  return l * clamp(1.0 - fw / sp * 2.5, 0.0, 1.0);
}
void main() {
  vec3 toCam = vW - cameraPosition;
  float dist = length(toCam);
  float x = vW.x;
  float ax = abs(x);
  float s = uS - vW.z;
  // material: grafito con variación muy suave
  float n = vnoise(vec2(x * 0.11, s * 0.11)) * 0.6 + vnoise(vec2(x * 1.7, s * 1.7)) * 0.4;
  vec3 col = uGround * (0.82 + 0.36 * n);
  // satinado: refleja el horizonte en ángulos rasantes (Fresnel de Schlick, F0 = 0,04)
  float cosT = clamp(abs(toCam.y) / max(dist, 1e-3), 0.0, 1.0);
  float fr = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
  col = mix(col, uHorizon * 1.1 + uGlow * 0.8, fr * 0.92);
  float near = exp(-dist * 0.016);
  // calle: dos filetes del color de la zona, rayas transversales cada 2 m que pasan a tu velocidad
  float edge = bandAA(ax, LANE, 0.0085);
  // calles vecinas (cada 1,22 m), grises y tenues: lectura de pista de atletismo
  float lx = ax - LANE;
  float nb = lx > 0.3 ? bandAA(mod(lx + 0.61, 1.22), 0.61, 0.006 + dist * 0.00025) * (1.0 - smoothstep(2.0, 6.5, lx)) * exp(-dist * 0.012) : 0.0;
  float tick = linesAA(s, 2.0, 0.008) * (1.0 - smoothstep(LANE - 0.05, LANE + 0.02, ax));
  float gw = 0.006 + dist * 0.0003; // las líneas engordan con la distancia: sin punteado por aliasing
  float grid = max(linesAA(x, 4.0, gw), linesAA(s, 4.0, gw)) * smoothstep(LANE + 0.5, LANE + 1.6, ax) * (1.0 - smoothstep(10.0, 40.0, ax)) * exp(-dist * 0.01);
  col += uLane * edge * uLaneK * (0.55 + 0.45 * near) * (0.92 + 0.16 * uMid);
  col += vec3(0.8, 0.85, 0.95) * (tick * 0.016 + grid * 0.0045 + nb * 0.03) * (0.35 + 0.65 * near);
  // cambios de tramo: una línea fina de luz que viene por el suelo y se cruza en el segundo exacto
  for (int i = 0; i < ${GATES}; i++) {
    float ga = uGate[i].y;
    if (ga > 0.001) {
      float l = bandAA(vW.z, uGate[i].x, 0.022);
      float across = 1.0 - smoothstep(LANE * 0.6, uAcross, ax);
      col += uGateCol[i] * l * ga * (uAcrossBase + 0.95 * across);
    }
  }
  // fantasma: punto de luz en la calle con una estela corta hacia ti
  if (uGhostA > 0.001) {
    float dz = vW.z - uGhostZ;
    float dot2 = exp(-(x * x * 60.0 + dz * dz * 3.0));
    float trail = exp(-max(dz, 0.0) * 0.45) * step(0.0, dz) * exp(-x * x * 400.0);
    col += uGhostCol * (dot2 * 1.1 + trail * 0.12) * uGhostA;
  }
  float fx = dist * uFogD;
  col = mix(col, uHorizon + uGlow * 0.5, 1.0 - exp(-fx * fx));
  gl_FragColor = vec4(col, 1.0);
}`;

export function createTheme(ctx) {
  const { THREE, root, rig, post, timeline: tl, util } = ctx;
  const { clamp, clamp01, smoothstep } = util;
  const C = (hex) => new THREE.Color(hex);

  post.set({ toneMapping: 'aces', exposure: 0.95, bloomStrength: 0.22, bloomThreshold: 0.9, bloomRadius: 0.15, vignette: 0.24 });

  // Cielo: triángulo a pantalla completa en el plano lejano (pintado el último: early-Z)
  const skyU = {
    uProjInv: { value: ctx.camera.projectionMatrixInverse },
    uCamWorld: { value: ctx.camera.matrixWorld },
    uTop: { value: C('#040507') },
    uHorizon: { value: C('#272b35') },
    uGlow: { value: new THREE.Color() },
    uBass: { value: 0 },
  };
  const skyGeo = new THREE.BufferGeometry();
  skyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.ShaderMaterial({
    uniforms: skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, depthWrite: false,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = 1000;
  root.add(sky);

  // Suelo
  const gateArr = [];
  const gateCol = [];
  for (let i = 0; i < GATES; i++) { gateArr.push(new THREE.Vector4(0, 0, 0, 0)); gateCol.push(new THREE.Color()); }
  const floorU = {
    uGround: { value: C('#0e1014') },
    uHorizon: skyU.uHorizon,
    uGlow: skyU.uGlow,
    uLane: { value: new THREE.Color() },
    uGhostCol: { value: C('#9fe3ff') },
    uS: { value: 0 }, uFogD: { value: 0.0075 }, uMid: { value: 0 }, uGhostZ: { value: -30 }, uGhostA: { value: 0 },
    uLaneK: { value: 0.3 }, uAcross: { value: 9 }, uAcrossBase: { value: 0.25 },
    uGate: { value: gateArr },
    uGateCol: { value: gateCol },
  };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.ShaderMaterial({
    uniforms: floorU, vertexShader: FLOOR_VERT,
    fragmentShader: FLOOR_FRAG.replace('NOISE_CHUNK', ctx.shaders.NOISE),
    defines: { LANE: LANE.toFixed(3) },
  }));
  floor.rotation.x = -Math.PI / 2;
  floor.frustumCulled = false;
  root.add(floor);

  // Marca de kilómetro en el suelo (tipografía de retransmisión, tendida sobre la calle)
  const kmPlane = ctx.textPlane('KM 1', { size: 96, weight: 700, tracking: 0.22, height: 0.62, intensity: 0.55, pad: 0.2 });
  kmPlane.rotation.x = -Math.PI / 2;
  kmPlane.position.y = 0.002;
  kmPlane.visible = false;
  kmPlane.renderOrder = 10;
  root.add(kmPlane);
  let kmShown = 0;

  // Paleta del momento
  const ground = C('#0e1014');
  const gold = C('#ffcf5a');
  const laneCol = new THREE.Color();
  const neutral = C('#8a8f99');
  let ghostZ = -30;
  let portrait = true;
  let inFinale = false;
  let hudVersion = -1;
  const rectOf = (kind) => { for (const r of ctx.hud.rects) if (r.kind === kind) return r; return null; };

  /**
   * Encuadre por composición (§15.1, §15.3): cámara nivelada (verticales rectas, estilo plató) y el desplazamiento de
   * lente coloca el horizonte FUERA del número de velocidad. Vertical: justo bajo el bloque de velocidad, para que las
   * calles y las líneas de cambio vivan en la ventana entre el número y el rótulo inferior; el cielo sereno queda tras
   * el número. Horizontal: horizonte alto y punto de fuga sobre la columna derecha; tras el número, suelo oscuro.
   */
  function frameCamera() {
    const T = rig.target;
    const hud = ctx.hud;
    const W = Math.max(1, hud.width);
    const H = Math.max(1, hud.height);
    if (portrait) {
      const sp = rectOf('speed');
      const fy = sp ? clamp(((sp.y + sp.h) / H) + 0.03, 0.33, 0.62) : 0.46;
      T.position.set(0, 1.55, 0);
      T.lookAt.set(0, 1.55, -100);
      T.fov = 62;
      T.shift.set(0, 1 - 2 * fy);
      floorU.uAcross.value = 9;
      floorU.uAcrossBase.value = 0.25;
    } else {
      const top = rectOf('top');
      const seg = rectOf('segment');
      const fy = clamp((top ? (top.y + top.h) / H : 0.1) + 0.12, 0.18, 0.4);
      const fx = seg ? clamp((seg.x + seg.w / 2) / W, 0.55, 0.85) : 0.74;
      T.position.set(0, 1.45, 0);
      T.lookAt.set(0, 1.45, -100);
      T.fov = 40;
      T.shift.set(2 * fx - 1, 1 - 2 * fy);
      floorU.uAcross.value = 3.4;
      floorU.uAcrossBase.value = 0; // la línea no cruza por detrás del número (columna izquierda)
    }
  }
  frameCamera();

  return {
    resize({ aspect }) {
      const p = aspect < 0.9;
      hudVersion = ctx.hud.version;
      if (p !== portrait) { portrait = p; frameCamera(); rig.snap(); } else frameCamera();
    },

    update(f) {
      const sp = f.spectrum;
      if (ctx.hud.version !== hudVersion && !inFinale) { hudVersion = ctx.hud.version; frameCamera(); }
      // color: acento de la zona en los filetes (gradual), oro suave si vas por delante del fantasma
      laneCol.copy(neutral).lerp(f.accent, 0.55).lerp(gold, f.record.amount * 0.7);
      floorU.uLane.value.copy(laneCol);
      floorU.uLaneK.value = 0.26 + 0.06 * f.approach;
      skyU.uGlow.value.copy(f.accent).multiplyScalar(0.02 + 0.008 * f.record.amount);
      skyU.uBass.value = f.reducedMotion ? 0 : sp.bass;
      floorU.uMid.value = f.reducedMotion ? 0 : sp.mid;
      floorU.uGround.value.copy(ground);
      floorU.uS.value = f.S % PERIOD;

      // líneas de cambio de tramo (las 3 siguientes y la recién cruzada mientras se aleja por detrás)
      let k = 0;
      for (let i = Math.max(1, f.segIndex); i < tl.segCount && k < GATES; i++) {
        const T = tl.segStart(i);
        const dt = T - f.t;
        if (dt < -1.5) continue;
        const z = -(tl.visualDistanceAt(T) - f.S);
        if (z < -330) break;
        const nearA = smoothstep(330, 60, -z);
        const cross = dt < 0 ? clamp01(1 + dt / 1.5) : 1;
        const pre = dt > 0 && dt < 3 ? 1 + 0.35 * (1 - dt / 3) : 1;
        gateArr[k].set(z, nearA * cross * pre * 0.95, 0, 0);
        gateCol[k].copy(ctx.zoneColor(tl.segZone(i)));
        k++;
      }
      for (; k < GATES; k++) gateArr[k].set(0, 0, 0, 0);

      // fantasma: delante a distancia comprimida (siempre visible si te saca ventaja); el dato exacto, en el HUD
      const g = f.ghost;
      const ahead = g.active && g.deltaM < -0.5;
      const zT = ahead ? -(5 + 110 * (1 - Math.exp(g.deltaM / 45))) : -5;
      ghostZ += (zT - ghostZ) * (1 - Math.exp(-f.dt * 2));
      floorU.uGhostZ.value = ghostZ;
      // con las luces de tu récord (ctx.ghostLights) se funden el punto del suelo y su estela
      floorU.uGhostA.value += ((ahead && !f.finale && !ctx.ghostLights ? 0.8 : 0) - floorU.uGhostA.value) * (1 - Math.exp(-f.dt * 2));

      // marca del próximo kilómetro
      const km = f.kmNext;
      const Tkm = tl.timeForKm(km);
      if (Number.isFinite(Tkm) && !f.finale) {
        if (km !== kmShown) { kmPlane.userData.setText(`KM ${km}`); kmShown = km; }
        const z = -(tl.visualDistanceAt(Tkm) - f.S);
        const d = -z;
        const a = smoothstep(150, 90, d) * smoothstep(12, 26, d);
        kmPlane.visible = a > 0.01;
        kmPlane.position.set(0, 0.002, z);
        kmPlane.material.opacity = a;
      } else kmPlane.visible = false;

      // final: grúa lenta que se eleva y mira la calle desde arriba
      if (f.finale > 0) {
        const e = util.easeInOutSine(f.finale);
        inFinale = true;
        rig.settle.position = 2.4;
        rig.settle.lookAt = 2.4;
        rig.target.position.set(0, 1.55 + 7 * e, 4 * e);
        rig.target.lookAt.set(0, 1.55 - 3 * e, -60);
      } else if (inFinale) {
        inFinale = false;
        rig.settle.position = 1.1;
        rig.settle.lookAt = 1.1;
        frameCamera();
      }
    },

    event(type) {
      if (type === 'gate') post.pulse(0.04, 1.2); // exposición +4 %, sin destellos
      else if (type === 'seek') ghostZ = -30;
      else if (type === 'finish') post.pulse(0.06, 2.5);
    },

    dispose() {
      kmPlane.userData.dispose?.();
      // el resto (cielo y suelo) lo libera el núcleo al vaciar ctx.root
    },
  };
}
