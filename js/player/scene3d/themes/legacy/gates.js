// Escenario 'legacy' (Hypertrack v1, oculto) · puertas de tramo y carteles de hitos.
// Cada tramo próximo es un portal octogonal del color de su zona que se atraviesa EXACTAMENTE en el segundo del cambio.
// La propia puerta es la cuenta atrás (nada de números 3D sobre el HUD, §14.1): en los últimos 3 s el octógono se va
// cerrando con luz desde abajo hacia arriba, late en cada segundo y el anillo interior acelera; dos columnas de luz y
// una línea de meta en el suelo siguen en el encuadre hasta el último instante (en vertical la puerta es más alta y
// estrecha, como una puerta de verdad). Los carteles KM n / MITAD / META son arcos y postes de neón; su rótulo va al
// hueco libre (marquee.js).
import { FOG, OUTPUT } from '../../shaders.js';
import { STEP_H, TRACK_HALF } from './track.js';
import { ZONES } from '../../../../training/levels.js';
import { clamp, clamp01, damp, easeOutCubic, lerp } from '../../util.js';

export const GATE_R = 6.3;
const POOL = 4;
const VIEW = 2600;   // distancia a la que asoman las puertas (perforan la niebla como balizas)

const NEON_VERT = /* glsl */ `
varying vec2 vUv;
varying float vDist;
varying float vAng;
void main() {
  vUv = uv;
  vAng = atan(position.y, position.x);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const NEON_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uInt, uTime, uCharge, uDash, uFade, uFogDensity, uChase;
varying vec2 vUv;
varying float vDist;
${FOG}
void main() {
  float chase = pow(fract(vUv.x * uChase - uTime * (0.35 + uCharge * 1.8)), 10.0);
  float dash = uDash > 0.5 ? step(0.42, fract(vUv.x * 40.0)) : 1.0;
  vec3 col = mix(uColor, vec3(1.0), 0.12 + chase * 0.45 + uCharge * 0.15) * (uInt * (1.1 + uCharge * 0.9) + chase * 1.2) * dash;
  float f = fogAmount(vDist, 0.001 * uFogDensity);
  col *= (1.0 - f * 0.85) * uFade;
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}`;

// Anillo principal = cuenta atrás: se llena desde abajo por ambos lados hasta cerrarse arriba en el instante del cambio
const COUNT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uInt, uTime, uFill, uTick, uFade, uFogDensity, uRot, uCounting;
varying vec2 vUv;
varying float vDist;
varying float vAng;
${FOG}
void main() {
  float a = vAng + uRot + 1.5707963;              // 0 = abajo
  a = abs(mod(a + 3.14159265, 6.2831853) - 3.14159265); // 0..π desde abajo
  float front = uFill * 3.14159265;
  float lit = mix(1.0, step(a, front + 0.002), uCounting);
  float lead = exp(-abs(a - front) * 9.0) * uCounting * step(0.001, uFill);
  float chase = pow(fract(vUv.x * 2.0 - uTime * 0.35), 10.0) * (1.0 - uCounting);
  float base = mix(1.0, mix(0.22, 1.25, lit), uCounting);
  vec3 col = mix(uColor, vec3(1.0), 0.12 + lead * 0.7 + chase * 0.45 + uTick * 0.35);
  col *= uInt * base * (1.0 + uTick * 0.5) + lead * 1.1 + chase * 0.6;
  float f = fogAmount(vDist, 0.001 * uFogDensity);
  col *= (1.0 - f * 0.85) * uFade;
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}`;

const MEM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime, uCharge, uFade, uFogDensity, uTick;
varying vec2 vUv;
varying float vDist;
${FOG}
float hexDist(vec2 p) { p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }
vec2 hexCell(vec2 uv) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(uv, s) - s * 0.5;
  vec2 b = mod(uv - s * 0.5, s) - s * 0.5;
  return dot(a, a) < dot(b, b) ? a : b;
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float hex = smoothstep(0.4, 0.5, hexDist(hexCell(p * 6.5)));
  float ripple = 0.5 + 0.5 * sin(r * 16.0 - uTime * (2.5 + uCharge * 10.0));
  float rim = smoothstep(0.7, 1.0, r);
  float a = 0.01 + rim * rim * 0.12 + hex * (0.02 + uCharge * 0.07) * (0.4 + ripple * 0.6) + uTick * 0.06 * (1.0 - r);
  float f = fogAmount(vDist, 0.001 * uFogDensity);
  vec3 col = uColor * a * uFade * (1.0 - f * 0.9) * smoothstep(1.0, 0.97, r);
  col *= smoothstep(4.0, 14.0, vDist) * mix(0.5, 1.0, smoothstep(90.0, 30.0, vDist));
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}`;

// Columnas de luz a los lados de la puerta (balizas que se ven desde lejos)
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uFade, uFogDensity, uTick, uCharge;
varying vec2 vUv;
varying float vDist;
${FOG}
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float core = exp(-x * x * 40.0);
  float halo = exp(-x * 4.0) * 0.25;
  float up = pow(1.0 - vUv.y, 1.6);
  vec3 col = mix(uColor, vec3(1.0), core * 0.25) * (core * 0.8 + halo) * up * (0.6 + uCharge * 0.4 + uTick * 0.4);
  float f = fogAmount(vDist, 0.0009 * uFogDensity);
  col *= (1.0 - f * 0.8) * uFade * smoothstep(2.5, 9.0, vDist);
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}`;

// Línea de meta del tramo en el suelo: chevrones que apuntan hacia delante + borde brillante
const LINE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uFade, uFogDensity, uTick, uCharge, uTime;
varying vec2 vUv;
varying float vDist;
${FOG}
void main() {
  vec2 p = vUv;
  float cx = abs(p.x - 0.5) * 2.0;
  float chev = fract(p.x * 14.0 - abs(p.y - 0.5) * 0.0 + (p.y) * 1.2 * sign(p.x - 0.5));
  float stripe = smoothstep(0.42, 0.5, chev) * (1.0 - smoothstep(0.5, 0.58, chev));
  float edgeF = exp(-abs(p.y - 0.92) * 40.0) + exp(-abs(p.y - 0.08) * 40.0) * 0.6;
  vec3 col = uColor * (stripe * 0.5 + edgeF * 1.4) * (0.7 + uCharge * 0.9 + uTick * 1.4);
  col = mix(col, vec3(1.0) * length(col), uTick * 0.25);
  float f = fogAmount(vDist, 0.0012 * uFogDensity);
  col *= (1.0 - f * 0.85) * uFade * (1.0 - cx * cx * 0.3);
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}`;

export function createGates(THREE, tl) {
  const group = new THREE.Group();
  const zoneColor = {};
  for (const z of Object.keys(ZONES)) zoneColor[z] = new THREE.Color(ZONES[z].color);

  const ringGeo = new THREE.TorusGeometry(GATE_R, 0.17, 6, 8);
  ringGeo.rotateZ(Math.PI / 8);
  const ring2Geo = new THREE.TorusGeometry(GATE_R + 0.55, 0.05, 4, 8);
  ring2Geo.rotateZ(Math.PI / 8);
  const innerGeo = new THREE.TorusGeometry(GATE_R * 0.88, 0.05, 4, 96);
  const memGeo = new THREE.CircleGeometry(GATE_R * 0.9, 48);
  const beamGeo = new THREE.PlaneGeometry(0.9, 46);
  beamGeo.translate(0, 23, 0);
  const lineGeo = new THREE.PlaneGeometry(TRACK_HALF * 2 + 0.8, 1.5);
  lineGeo.rotateX(-Math.PI / 2);

  const baseU = () => ({
    uColor: { value: new THREE.Color() }, uInt: { value: 1 }, uTime: { value: 0 }, uCharge: { value: 0 },
    uFade: { value: 1 }, uFogDensity: { value: 1 }, uTick: { value: 0 },
  });
  const add = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false };
  const neon = (dash = 0, chase = 1) => new THREE.ShaderMaterial({
    uniforms: { ...baseU(), uDash: { value: dash }, uChase: { value: chase } },
    vertexShader: NEON_VERT, fragmentShader: NEON_FRAG, ...add,
  });

  const gates = [];
  for (let k = 0; k < POOL; k++) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(ringGeo, new THREE.ShaderMaterial({
      uniforms: { ...baseU(), uFill: { value: 0 }, uRot: { value: 0 }, uCounting: { value: 0 } },
      vertexShader: NEON_VERT, fragmentShader: COUNT_FRAG, ...add,
    }));
    const ring2 = new THREE.Mesh(ring2Geo, neon(1, 1));
    const inner = new THREE.Mesh(innerGeo, neon(1, 1));
    const mem = new THREE.Mesh(memGeo, new THREE.ShaderMaterial({
      uniforms: baseU(), vertexShader: NEON_VERT, fragmentShader: MEM_FRAG, ...add, side: THREE.DoubleSide,
    }));
    const beamMat = new THREE.ShaderMaterial({ uniforms: baseU(), vertexShader: NEON_VERT, fragmentShader: BEAM_FRAG, ...add, side: THREE.DoubleSide });
    const beamL = new THREE.Mesh(beamGeo, beamMat);
    const beamR = new THREE.Mesh(beamGeo, beamMat);
    const line = new THREE.Mesh(lineGeo, new THREE.ShaderMaterial({
      uniforms: baseU(), vertexShader: NEON_VERT, fragmentShader: LINE_FRAG, ...add,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    }));
    [ring, ring2, inner, mem, beamL, beamR, line].forEach((m) => { m.frustumCulled = false; });
    g.add(ring, ring2, inner, mem);
    group.add(g, beamL, beamR, line);
    g.visible = false;
    beamL.visible = beamR.visible = line.visible = false;
    gates.push({
      g, ring, ring2, inner, mem, beamL, beamR, line, beamMat,
      mats: [ring.material, ring2.material, inner.material, mem.material, beamMat, line.material],
      index: -1, color: new THREE.Color(), fadeIn: 0, zDisp: 0, active: false,
    });
  }

  const next = { idx: -1, dt: Infinity, z: 0, y: 0, color: new THREE.Color(1, 1, 1), fill: 0, tick: 0 };

  function assign(gate, i) {
    gate.color.copy(zoneColor[tl.zones[i]] || zoneColor.jog);
    for (const m of gate.mats) m.uniforms.uColor.value.copy(gate.color);
    gate.index = i;
    gate.fadeIn = 0;
  }

  return {
    object: group,
    zoneColor,
    next,
    update(F) {
      const t = F.localT;
      const cur = F.segIndex;
      const reduced = F.reduced;
      const fogD = F.mood.fogDensity * F.fogMul;
      // puerta adaptada al encuadre: en vertical más estrecha y alta
      const rs = clamp(F.aspect / 0.75, 0.6, 1);
      const sy = lerp(1.35, 1, clamp01((F.aspect - 0.6) / 0.4));
      const halfW = GATE_R * rs * 0.924;
      for (const gate of gates) gate.active = false;
      next.idx = -1;
      next.dt = Infinity;
      if (tl.n > 1 && F.showGates) {
        for (let i = Math.max(1, cur); i <= Math.min(tl.n - 1, cur + 4); i++) {
          const T = tl.starts[i];
          const dtTo = T - t;
          if (dtTo < -0.9) continue;
          const z = -(tl.S(T) - F.sNow);
          if (z < -VIEW) break;
          const gate = gates[i % POOL];
          if (gate.active) continue;
          if (gate.index !== i) { assign(gate, i); gate.zDisp = z; }
          gate.active = true;
          gate.zDisp = F.tlSmooth ? damp(gate.zDisp, z, 8, F.dt) : z;
          const zz = gate.zDisp;
          const stageY = (tl.stage[i] > 0 ? tl.stage[i] : 0) * STEP_H * F.stairAmt - (tl.stage[i] > 0 ? F.stairSink : 0);
          const y = GATE_R * rs * sy * 0.924 - 0.15 + stageY;
          const counting = dtTo > 0 && dtTo <= 3 ? 1 : 0;
          const fill = dtTo > 0 ? clamp01(1 - dtTo / 3) : 1;
          // latido en cada segundo entero de la cuenta atrás (3, 2, 1) y en el cruce
          const sinceTick = dtTo > 0 ? (Math.ceil(dtTo) - dtTo) : 0;
          const tick = dtTo > 0 && dtTo <= 3.02 ? Math.exp(-sinceTick * 7) : 0;
          gate.fadeIn = Math.min(1, gate.fadeIn + F.dt * 2.5);
          let scale = 1;
          let fade = gate.fadeIn;
          if (dtTo < 0) {
            const p = clamp01(-dtTo / 0.9);
            scale = 1 + easeOutCubic(p) * (reduced ? 0.2 : 0.6);
            fade *= 1 - p;
          }
          gate.g.visible = true;
          gate.g.position.set(0, y, zz);
          gate.g.scale.set(rs * scale, rs * sy * scale, 1);
          const charge = fill * counting;
          // el giro sigue (el llenado de la cuenta atrás se calcula en el espacio de la pantalla con uRot)
          gate.ring.rotation.z = reduced ? 0 : (F.time * 0.15) % (Math.PI * 2);
          gate.ring2.rotation.z = -F.time * (0.1 + charge * 0.9);
          gate.inner.rotation.z = -F.time * 0.3 * (1 + charge * 2);
          const beatK = 1 + F.beat * 0.22 * F.mood.pulse;
          for (const m of gate.mats) {
            const u = m.uniforms;
            u.uTime.value = F.time;
            u.uCharge.value = charge;
            u.uFade.value = fade;
            u.uInt.value = beatK;
            u.uFogDensity.value = fogD;
            u.uTick.value = reduced ? tick * 0.4 : tick;
          }
          const ru = gate.ring.material.uniforms;
          ru.uFill.value = fill;
          ru.uRot.value = gate.ring.rotation.z;
          ru.uCounting.value = counting;
          // membrana: fuera cuando está encima (pantalla llena de aditivo) y a media intensidad de lejos
          gate.mem.visible = zz < -4;
          // columnas y línea de meta (siguen en el encuadre hasta el último instante)
          const showSide = dtTo > -0.4;
          gate.beamL.visible = gate.beamR.visible = showSide && F.quality >= 1;
          gate.beamL.position.set(-halfW - 0.6, stageY, zz);
          gate.beamR.position.set(halfW + 0.6, stageY, zz);
          gate.line.visible = showSide && zz < 1.5;
          gate.line.position.set(0, stageY + 0.02, zz);
          gate.line.material.uniforms.uFade.value = fade * clamp01((-zz + 1.5) / 5);
          if (dtTo > 0 && dtTo < next.dt) {
            next.dt = dtTo; next.idx = i; next.z = zz; next.y = y; next.color.copy(gate.color); next.fill = fill; next.tick = tick;
          }
        }
      }
      for (const gate of gates) {
        if (!gate.active) { gate.g.visible = false; gate.beamL.visible = gate.beamR.visible = gate.line.visible = false; }
      }
      return next;
    },
    dispose() {
      ringGeo.dispose(); ring2Geo.dispose(); innerGeo.dispose(); memGeo.dispose(); beamGeo.dispose(); lineGeo.dispose();
      for (const g of gates) for (const m of new Set(g.mats)) m.dispose();
    },
  };
}

/* ───────────── Carteles de hitos: KM n · MITAD · META ───────────── */

export function createSigns(THREE, tl) {
  const group = new THREE.Group();
  const archGeo = new THREE.TorusGeometry(8.8, 0.17, 6, 56, Math.PI);
  const arch2Geo = new THREE.TorusGeometry(9.6, 0.07, 4, 56, Math.PI);
  const postGeo = new THREE.BoxGeometry(0.22, 1, 0.22);
  const barGeo = new THREE.BoxGeometry(TRACK_HALF * 2 + 3.6, 0.22, 0.22);
  const baseGeo = new THREE.PlaneGeometry(TRACK_HALF * 2 + 0.8, 0.5);
  baseGeo.rotateX(-Math.PI / 2);
  const gold = new THREE.Color('#ffd60a');
  const white = new THREE.Color('#fff1c4');
  const cyan = new THREE.Color('#64d2ff');

  const neon = (chase = 1, dash = 0) => new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color() }, uInt: { value: 1 }, uTime: { value: 0 }, uCharge: { value: 0 },
      uDash: { value: dash }, uFade: { value: 1 }, uFogDensity: { value: 1 }, uChase: { value: chase },
    },
    vertexShader: NEON_VERT, fragmentShader: NEON_FRAG,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });

  const slots = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.Group();
    const arch = new THREE.Mesh(archGeo, neon(3));
    const arch2 = new THREE.Mesh(arch2Geo, neon(1, 1));
    const postL = new THREE.Mesh(postGeo, neon(1));
    const postR = new THREE.Mesh(postGeo, neon(1));
    const bar = new THREE.Mesh(barGeo, neon(2, 1));
    postL.scale.y = postR.scale.y = 9;
    postL.position.set(-(TRACK_HALF + 1.6), 4.5, 0);
    postR.position.set(TRACK_HALF + 1.6, 4.5, 0);
    bar.position.set(0, 9, 0);
    const baseMat = neon(4);
    baseMat.polygonOffset = true;
    baseMat.polygonOffsetFactor = -1;
    baseMat.polygonOffsetUnits = -4;
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.03;
    [arch, arch2, postL, postR, bar, base].forEach((m) => { m.frustumCulled = false; });
    g.add(arch, arch2, postL, postR, bar, base);
    g.visible = false;
    group.add(g);
    slots.push({ g, arch, arch2, postL, postR, bar, base, neons: [arch, arch2, postL, postR, bar, base], key: null, active: false, prevZ: -1e9 });
  }

  function assign(slot, key, kind) {
    slot.key = key;
    slot.kind = kind;
    const color = kind === 'km' ? gold : kind === 'half' ? cyan : white;
    for (const m of slot.neons) m.material.uniforms.uColor.value.copy(color);
    slot.arch.visible = kind !== 'km';
    slot.arch2.visible = kind !== 'km';
    slot.postL.visible = slot.postR.visible = slot.bar.visible = kind === 'km';
    slot.prevZ = -1e9;
  }

  const mk = (key, kind, label) => ({ key, kind, label, T: Infinity, z: 0, ckey: 0, vis: false, slot: null, merged: false });
  const cands = [mk(0, 'km', ''), mk(-1, 'half', 'MITAD'), mk(-2, 'meta', 'META')];

  return {
    object: group,
    cands,
    /** Calcula los instantes de los hitos (antes de update, para que el reproductor de rótulos los vea). */
    plan(F) {
      const km = F.kmNext;
      cands[0].T = km > 0 && F.showSigns ? F.timeForKm(km) : Infinity;
      cands[0].key = km;
      cands[0].label = `KM ${km}`;
      cands[1].T = !tl.isTest && !F.halfDone && F.showSigns ? tl.totalSec / 2 : Infinity;
      cands[2].T = F.showSigns ? tl.totalSec : Infinity;
      return cands;
    },
    /** onCross(kind, km, merged) se llama al atravesar un cartel. Los fusionados con una puerta no muestran estructura. */
    update(F, onCross) {
      const t = F.localT;
      const fogD = F.mood.fogDensity * F.fogMul;
      for (const s of slots) s.active = false;
      for (const c of cands) {
        c.z = 0;
        c.slot = null;
        c.vis = false;
        if (!Number.isFinite(c.T)) continue;
        if (c.T - t < -1.2) continue;
        const z = -(tl.S(c.T) - F.sNow);
        if (z < -VIEW || z > 40) continue;
        c.vis = true;
        c.z = z;
        c.ckey = c.kind === 'km' ? c.key : c.key - 1000;
        for (const s of slots) if (s.key === c.ckey) { c.slot = s; s.active = true; break; }
      }
      for (const c of cands) {
        if (!c.vis || c.slot) continue;
        for (const s of slots) if (!s.active) { c.slot = s; s.active = true; assign(s, c.ckey, c.kind); break; }
      }
      for (const c of cands) {
        const slot = c.slot;
        if (!slot) continue;
        const z = c.z;
        const stageY = tl.isTest ? tl.stage[tl.segAt(c.T)] * STEP_H * F.stairAmt : 0;
        slot.g.visible = !c.merged;
        slot.g.position.set(0, stageY, z);
        if (slot.prevZ < 0 && z >= 0 && slot.prevZ > -400) onCross?.(c.kind, c.kind === 'km' ? c.key : 0, c.merged);
        slot.prevZ = z;
        const near = clamp01((z + 300) / 300);
        const pulse = (1 + F.beat * 0.2 * F.mood.pulse) * (0.45 + 0.55 * clamp01((-z - 4) / 30));
        for (const m of slot.neons) {
          const u = m.material.uniforms;
          u.uTime.value = F.time;
          u.uInt.value = pulse;
          u.uFogDensity.value = fogD;
          u.uCharge.value = near * 0.4;
          u.uFade.value = m === slot.base ? clamp01((-z + 1) / 6) : 1;
        }
      }
      for (const s of slots) if (!s.active) s.g.visible = false;
    },
    dispose() {
      archGeo.dispose(); arch2Geo.dispose(); postGeo.dispose(); barGeo.dispose(); baseGeo.dispose();
      for (const s of slots) for (const m of s.neons) m.material.dispose();
    },
  };
}
