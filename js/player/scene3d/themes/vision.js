// RITMUP · escenario MODO VISIÓN. Tu clase entera dibujada como una escalera de luz: cada tramo es un escalón macizo
// del color de su zona, tan alto como su esfuerzo (velocidad + inclinación) y tan largo como los metros que corres en
// él; con cuesta, el escalón sube. Entre tramos, una rampa suave (nunca una pared) y al final de cada uno su meta: dos
// postes y un travesaño del color de la zona, y LA línea del final, de borde a borde, encima del escalón. La velocidad
// de cada tramo va pintada en el suelo (la tuya se apaga al pisarla). Bajo tus pies la cinta corre a tu velocidad
// real y un anillo late con tu pulso (del color de la zona si vas en ella).
// Cámara propia (sin el director del núcleo): escorzo al entrar en un tramo (se ve el perfil de los escalones), primera
// persona en mitad de los tramos largos y aérea centrada el resto, alejándose en los últimos 30 s de la clase. Final:
// la cámara sube y enseña la escalera entera encendiéndose de principio a meta. Sin destellos (§15.2): los cambios son
// graduales y el brillo lo pone el bloom, dentro de sus límites.
// Coste: ~12 draw calls (cuerpo de escalones y rampas, filos, metas, cinta, suelo, horizonte, 4 cifras, marcador),
// geometría fusionada con el índice del tramo por vértice: los tramos pasados/actual/futuros son uniformes.

export const meta = {
  id: 'vision',
  name: 'Modo visión',
  description: 'Tu clase como una escalera de luz: cada tramo es un escalón a su velocidad, con su meta al final.',
};

const UNIT = 30;          // 1 u = 30 m: varios tramos a la vista
const W = 6;              // ancho del camino (u)
const RAMP = 0.9;         // media rampa entre tramos (u)
const INCL_X = 4;         // la cuesta se exagera ×4 (a escala real un 3 % apenas se vería)
const EFF_INCL = 0.45;    // 1 % de cuesta ≈ 0,45 km/h de esfuerzo (c ≈ 0,45·b del modelo de pulso)
const SLOTS = 4;          // cifras del suelo a la vista: tu tramo y los 3 siguientes
const BELT_FADE = 18;     // los listones de la cinta se apagan a esta distancia (sin centelleo)
const SLAT_M = 1;         // un listón por metro de cinta recorrido

const VERT = /* glsl */ `
attribute vec3 aCol;
attribute float aSeg;
varying vec3 vCol;
varying float vSeg;
varying float vDist;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vCol = aCol; vSeg = aSeg; vDist = length(w.xyz - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// escalones, rampas y filos: lo corrido se apaga, tu tramo a toda luz, lo que viene algo más bajo
const BODY_FRAG = /* glsl */ `
uniform float uCur, uFront, uFogD;
uniform vec3 uFogCol;
varying vec3 vCol;
varying float vSeg;
varying float vDist;
FOG_CHUNK
void main() {
  float k = vSeg < uCur - 0.5 ? 0.16 : (vSeg > uCur + 0.5 ? 0.55 : 1.0);
  if (uFront > -0.5) k = vSeg < uFront ? 1.0 : 0.16;
  vec3 c = mix(vCol * k, uFogCol, fogAmount(vDist, uFogD));
  gl_FragColor = vec4(c, 1.0);
}`;

// metas (aditivas, color HDR: el bloom las enciende sin quemarlas)
const GATE_FRAG = /* glsl */ `
uniform float uCur, uCurK, uPrevK, uFront, uFogD;
varying vec3 vCol;
varying float vSeg;
varying float vDist;
FOG_CHUNK
void main() {
  float k = vSeg < uCur - 1.5 ? 0.04 : (vSeg < uCur - 0.5 ? uPrevK : (vSeg < uCur + 0.5 ? uCurK : 0.32));
  if (uFront > -0.5) k = vSeg < uFront ? 0.9 : 0.06;
  gl_FragColor = vec4(vCol * k * (1.0 - fogAmount(vDist, uFogD)), 1.0);
}`;

const PLANE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// la cinta de tu tramo: listones que corren a tu velocidad real, luces de borde que pasan igual y una franja tenue con
// lo que te queda (todo en un solo plano aditivo, suavizado con fwidth)
const BELT_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uLen, uBelt, uSlat, uCue, uOn;
varying vec2 vUv;
float lineAA(float ph, float w) {
  float fw = fwidth(ph) + 1e-4;
  float f = fract(ph);
  float l = 1.0 - smoothstep(w, w + fw * 1.5, f);
  return l * clamp(1.0 - fw * 2.5, 0.0, 1.0);
}
void main() {
  float s = vUv.y * uLen;                 // u desde tus pies hacia el final del tramo
  float x = (vUv.x - 0.5) * ${W.toFixed(1)};
  float ax = abs(x);
  float near = 1.0 - smoothstep(${(BELT_FADE * 0.6).toFixed(1)}, ${BELT_FADE.toFixed(1)}, s);
  float slat = lineAA(s / uSlat + uBelt, 0.09) * near * (1.0 - smoothstep(${(W / 2 - 0.3).toFixed(2)}, ${(W / 2 - 0.15).toFixed(2)}, ax));
  float fwx = fwidth(x) + 1e-4;
  float railX = 1.0 - smoothstep(0.045, 0.045 + fwx * 1.5, abs(ax - ${(W / 2 - 0.12).toFixed(2)}));
  float dph = s / (uSlat * 2.4) + uBelt / 2.4;
  float dash = (1.0 - smoothstep(0.34, 0.34 + fwidth(dph) * 1.5 + 1e-4, fract(dph))) * near;
  float strip = 1.0 - smoothstep(${(W * 0.21).toFixed(2)}, ${(W * 0.21).toFixed(2)} + fwx * 1.5, ax);
  vec3 c = clamp(uCol * (slat * 0.22 * uCue + railX * dash * 0.7 + strip * 0.09) * uOn, 0.0, 2.0);
  if (c.r != c.r || c.g != c.g || c.b != c.b) c = vec3(0.0);
  gl_FragColor = vec4(c, 1.0);
}`;

// suelo infinito con una rejilla fina que se pierde a lo lejos
const GROUND_FRAG = /* glsl */ `
uniform vec3 uCol, uLine, uFogCol;
uniform float uFogD;
varying vec3 vW;
FOG_CHUNK
void main() {
  vec2 p = vW.xz / 5.0;
  vec2 fw = fwidth(p);
  float d = length(vW.xz - cameraPosition.xz);
  float l = 0.0;
  // a ras de horizonte las derivadas se disparan (y un NaN aquí apagaba el bloom de toda la pantalla): la rejilla
  // solo de cerca y con las derivadas saneadas
  if (d < 440.0 && fw.x == fw.x && fw.y == fw.y && fw.x < 1e3 && fw.y < 1e3) {
    vec2 g = abs(fract(p - 0.5) - 0.5) / max(fw, vec2(1e-4));
    l = 1.0 - min(min(g.x, g.y), 1.0);
  }
  float f = (1.0 - smoothstep(40.0, 420.0, d)) * 0.6;
  vec3 c = mix(uCol, uLine, l * f);
  c = clamp(mix(c, uFogCol, fogAmount(d, uFogD) * 0.85), 0.0, 1.0);
  if (c.r != c.r || c.g != c.g || c.b != c.b) c = uFogCol;
  gl_FragColor = vec4(c, 1.0);
}`;

export async function createTheme(ctx) {
  const { THREE, root, rig, post, camera, scene, util } = ctx;
  const { clamp, clamp01 } = util;
  const tl = ctx.timeline;
  const C = (hex) => new THREE.Color(hex);
  const lin = (k) => Math.pow(k, 2.2);      // un factor de brillo pensado en sRGB, en lineal
  const WHITE = C('#ffffff');

  camera.near = 0.3;
  camera.far = 2600;
  camera.updateProjectionMatrix();
  post.set({ toneMapping: 'agx', exposure: 1, bloomStrength: 0.5, bloomThreshold: 0.88, bloomRadius: 0.35, vignette: 0.3, saturation: 1.05 });

  // cielo: negro azulado con el horizonte apenas iluminado
  {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const g = c.getContext('2d');
    const l = g.createLinearGradient(0, 0, 0, 256);
    l.addColorStop(0, '#03060a'); l.addColorStop(0.42, '#071220'); l.addColorStop(0.5, '#0d1d2e'); l.addColorStop(0.56, '#060b12'); l.addColorStop(1, '#03060a');
    g.fillStyle = l; g.fillRect(0, 0, 4, 256);
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    scene.background = tx;
  }
  const FOG_COL = C('#0a1724');
  const FOG_D = 0.0022;
  scene.fog = new THREE.FogExp2(FOG_COL.clone(), FOG_D);
  const FOG = ctx.shaders.FOG;
  const shader = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({
    uniforms, vertexShader: extra.vert || VERT, fragmentShader: frag.replace('FOG_CHUNK', FOG), ...extra.opts,
  });

  const bodyU = { uCur: { value: 0 }, uFront: { value: -1 }, uFogD: { value: FOG_D }, uFogCol: { value: FOG_COL } };
  const bodyMat = shader(BODY_FRAG, bodyU, { opts: { side: THREE.DoubleSide } });
  const rimMat = shader(BODY_FRAG, bodyU, { opts: { transparent: true, depthWrite: false } });
  const gateU = { uCur: bodyU.uCur, uFront: bodyU.uFront, uCurK: { value: 1 }, uPrevK: { value: 0.1 }, uFogD: bodyU.uFogD };
  const gateMat = shader(GATE_FRAG, gateU, { opts: { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } });

  // suelo y horizonte
  const groundU = { uCol: { value: C('#05090f') }, uLine: { value: C('#1a2a38') }, uFogCol: { value: FOG_COL }, uFogD: { value: FOG_D } };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), shader(GROUND_FRAG, groundU, { vert: PLANE_VERT }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  ground.frustumCulled = false;
  root.add(ground);
  const hzMat = new THREE.MeshBasicMaterial({ color: C('#5fa8d8'), transparent: true, opacity: 0.8, fog: false, blending: THREE.AdditiveBlending, depthWrite: false });
  const hzLine = new THREE.Mesh(new THREE.PlaneGeometry(9000, 1.8), hzMat);
  hzLine.frustumCulled = false;
  root.add(hzLine);
  const hzGlowTex = (() => {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 64;
    const g = c.getContext('2d');
    const l = g.createLinearGradient(0, 64, 0, 0);
    l.addColorStop(0, 'rgba(255,255,255,0.7)'); l.addColorStop(0.25, 'rgba(255,255,255,0.15)'); l.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = l; g.fillRect(0, 0, 4, 64);
    return new THREE.CanvasTexture(c);
  })();
  const hzGlowMat = new THREE.MeshBasicMaterial({ map: hzGlowTex, color: C('#3a7fb0'), transparent: true, opacity: 0.35, fog: false, blending: THREE.AdditiveBlending, depthWrite: false });
  const hzGlow = new THREE.Mesh(new THREE.PlaneGeometry(9000, 40), hzGlowMat);
  hzGlow.frustumCulled = false;
  root.add(hzGlow);

  // la cinta de tu tramo
  const beltU = { uCol: { value: new THREE.Color() }, uLen: { value: 1 }, uBelt: { value: 0 }, uSlat: { value: 0.42 }, uCue: { value: 1 }, uOn: { value: 1 } };
  const beltMat = shader(BELT_FRAG, beltU, { vert: PLANE_VERT, opts: { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 } });
  const beltGeo = new THREE.PlaneGeometry(1, 1);
  beltGeo.translate(0, 0.5, 0);           // y local 0 = tus pies, 1 = final del tramo
  const belt = new THREE.Mesh(beltGeo, beltMat);
  belt.renderOrder = 11;
  belt.frustumCulled = false;
  root.add(belt);

  // tú: un chevrón de luz y el anillo de tu latido
  const chev = new THREE.Shape();
  chev.moveTo(0, 0.6); chev.lineTo(0.45, -0.3); chev.lineTo(0, -0.05); chev.lineTo(-0.45, -0.3); chev.lineTo(0, 0.6);
  const youMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.6), transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, fog: false });
  const you = new THREE.Mesh(new THREE.ShapeGeometry(chev), youMat);
  you.rotation.x = -Math.PI / 2;
  you.renderOrder = 30;
  root.add(you);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.7, 64), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 30;
  root.add(ring);

  // cifras del suelo (tu tramo y los tres siguientes)
  const slots = [];
  for (let k = 0; k < SLOTS; k++) {
    const p = ctx.textPlane(' ', { size: 150, weight: 700, caps: false, tracking: -0.02, height: 1.5, intensity: 1, pad: 0.15 });
    p.material.polygonOffset = true; p.material.polygonOffsetFactor = -2; p.material.polygonOffsetUnits = -4;
    p.renderOrder = 12;
    p.visible = false;
    p.userData.seg = -1;
    root.add(p);
    slots.push(p);
  }
  // META sobre la última meta
  const metaPlane = ctx.textPlane('META', { size: 110, weight: 700, tracking: 0.14, height: 0.95, intensity: 1.6, pad: 0.3, plate: { color: 'rgba(255,255,255,0.06)', radius: 0.15, border: 'rgba(255,255,255,0.2)' } });
  metaPlane.renderOrder = 60;
  root.add(metaPlane);
  const checkTex = (() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 16;
    const g = c.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.1)';
      g.fillRect(i * 8, j * 8, 8, 8);
    }
    return new THREE.CanvasTexture(c);
  })();
  const checkMat = new THREE.MeshBasicMaterial({ map: checkTex, color: new THREE.Color(), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const check = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.55), checkMat);
  check.rotation.x = -Math.PI / 2;
  check.renderOrder = 14;
  root.add(check);

  // ── el mundo de la clase (se reconstruye si cambian las velocidades) ──
  let segs = [];
  let lastI = 0;
  let zEnd = 1;
  let topMax = 1;
  const built = [];       // mallas fusionadas (se liberan al reconstruir)

  function readSegs() {
    const n = tl.segCount;
    const src = Array.isArray(ctx.workout?.segments) ? ctx.workout.segments : [];
    const out = [];
    let z = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0.5, tl.segSpeed(i));
      const sec = tl.segDuration(i);
      const incl = clamp(Number(src[i]?.incline) || 0, 0, 15);
      const len = (v * sec / 3.6) / UNIT;
      out.push({ i, zone: tl.segZone(i), v, sec, incl, len, z0: z, z1: z + len, t0: tl.segStart(i), t1: tl.segEnd(i) });
      z += len;
    }
    return out;
  }

  function build() {
    for (const m of built) { m.geometry.dispose(); root.remove(m); }
    built.length = 0;
    segs = readSegs();
    lastI = segs.length - 1;
    if (!segs.length) return;
    const eff = (s) => s.v + s.incl * EFF_INCL;
    const effMin = Math.min(...segs.map(eff));
    const effMax = Math.max(...segs.map(eff));
    // 1 u por km/h, pero la escalera entera nunca pasa de ~4 u (un sprint no puede ser un muro delante de la cámara)
    const hk = Math.min(1, 4 / Math.max(1e-6, effMax - effMin));
    for (const s of segs) {
      s.h = 0.6 + (eff(s) - effMin) * hk;
      s.zA = s.i > 0 ? s.z0 + 2 * RAMP : s.z0;
      s.zB = s.z1;
      const rise = Math.max(0, s.zB - s.zA) * (s.incl / 100) * INCL_X;
      s.h0 = s.h - rise / 2;
      s.h1 = s.h + rise / 2;
      s.col = ctx.zoneColor(s.zone).clone();
    }
    zEnd = segs[lastI].z1;
    topMax = Math.max(...segs.map((s) => s.h1));

    // cuerpo: escalones (cara de arriba en cuesta, laterales oscuros) y rampas curvas entre ellos
    const P = [], CO = [], SG = [], IX = [];
    const quad = (a, b, c, d, col, seg) => {
      const o = P.length / 3;
      P.push(...a, ...b, ...c, ...d);
      for (let k = 0; k < 4; k++) { CO.push(col.r, col.g, col.b); SG.push(seg); }
      IX.push(o, o + 1, o + 2, o, o + 2, o + 3);
    };
    const kTop = lin(0.32), kSide = lin(0.18), kFront = lin(0.22);
    const tmp = new THREE.Color();
    for (const s of segs) {
      const x0 = -W / 2, x1 = W / 2, za = -s.zA, zb = -s.zB;
      quad([x0, s.h0, za], [x1, s.h0, za], [x1, s.h1, zb], [x0, s.h1, zb], tmp.copy(s.col).multiplyScalar(kTop), s.i);   // arriba
      quad([x0, 0, za], [x0, s.h0, za], [x0, s.h1, zb], [x0, 0, zb], tmp.copy(s.col).multiplyScalar(kSide), s.i);         // izquierda
      quad([x1, 0, zb], [x1, s.h1, zb], [x1, s.h0, za], [x1, 0, za], tmp.copy(s.col).multiplyScalar(kSide), s.i);         // derecha
      if (s.i === 0) quad([x0, 0, za], [x1, 0, za], [x1, s.h0, za], [x0, s.h0, za], tmp.copy(s.col).multiplyScalar(kFront), s.i);
      if (s.i === lastI) quad([x1, 0, zb], [x0, 0, zb], [x0, s.h1, zb], [x1, s.h1, zb], tmp.copy(s.col).multiplyScalar(kFront), s.i);
    }
    const N = 14;
    const smooth = (x) => x * x * (3 - 2 * x);
    const ca = new THREE.Color(), cb = new THREE.Color(), cc = new THREE.Color();
    for (let k = 0; k < lastI; k++) {
      const a = segs[k], b = segs[k + 1];
      const zS = a.zB, zE = b.zA;
      const yAt = (u) => a.h1 + (b.h0 - a.h1) * smooth(u);
      for (let j = 0; j < N; j++) {
        const u0 = j / N, u1 = (j + 1) / N;
        const z0 = -(zS + (zE - zS) * u0), z1 = -(zS + (zE - zS) * u1);
        const y0 = yAt(u0), y1 = yAt(u1);
        ca.copy(a.col).lerp(b.col, (u0 + u1) / 2);
        quad([-W / 2, y0, z0], [W / 2, y0, z0], [W / 2, y1, z1], [-W / 2, y1, z1], cc.copy(ca).multiplyScalar(kTop), b.i);
        quad([-W / 2, 0, z0], [-W / 2, y0, z0], [-W / 2, y1, z1], [-W / 2, 0, z1], cc.copy(ca).multiplyScalar(kSide), b.i);
        quad([W / 2, 0, z1], [W / 2, y1, z1], [W / 2, y0, z0], [W / 2, 0, z0], cc.copy(ca).multiplyScalar(kSide), b.i);
      }
    }
    const bodyGeo = new THREE.BufferGeometry();
    bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    bodyGeo.setAttribute('aCol', new THREE.Float32BufferAttribute(CO, 3));
    bodyGeo.setAttribute('aSeg', new THREE.Float32BufferAttribute(SG, 1));
    bodyGeo.setIndex(IX);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.frustumCulled = false;
    root.add(body);
    built.push(body);

    // filos de arriba (escalones y rampas)
    const LP = [], LC = [], LS = [];
    const seg2 = (p, q, col, seg) => { LP.push(...p, ...q); for (let k = 0; k < 2; k++) { LC.push(col.r, col.g, col.b); LS.push(seg); } };
    for (const s of segs) {
      cc.copy(s.col).multiplyScalar(0.9);
      for (const x of [-W / 2, W / 2]) seg2([x, s.h0 + 0.02, -s.zA], [x, s.h1 + 0.02, -s.zB], cc, s.i);
    }
    for (let k = 0; k < lastI; k++) {
      const a = segs[k], b = segs[k + 1];
      const yAt = (u) => a.h1 + (b.h0 - a.h1) * smooth(u);
      for (let j = 0; j < N; j++) {
        const u0 = j / N, u1 = (j + 1) / N;
        cc.copy(a.col).lerp(b.col, (u0 + u1) / 2).multiplyScalar(0.9);
        for (const x of [-W / 2, W / 2]) seg2([x, yAt(u0) + 0.02, -(a.zB + (b.zA - a.zB) * u0)], [x, yAt(u1) + 0.02, -(a.zB + (b.zA - a.zB) * u1)], cc, b.i);
      }
    }
    const rimGeo = new THREE.BufferGeometry();
    rimGeo.setAttribute('position', new THREE.Float32BufferAttribute(LP, 3));
    rimGeo.setAttribute('aCol', new THREE.Float32BufferAttribute(LC, 3));
    rimGeo.setAttribute('aSeg', new THREE.Float32BufferAttribute(LS, 1));
    const rims = new THREE.LineSegments(rimGeo, rimMat);
    rims.frustumCulled = false;
    rims.renderOrder = 10;
    root.add(rims);
    built.push(rims);

    // metas: postes, travesaño por encima del más alto de los dos tramos y la línea del final encima del escalón
    const GP = [], GC = [], GS = [], GI = [];
    const box = (cx, cy, cz, sx, sy, sz, col, seg) => {
      const o = GP.length / 3;
      const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
      const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      for (const p of v) { GP.push(...p); GC.push(col.r, col.g, col.b); GS.push(seg); }
      const f = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
      for (const [a, b, c, d] of f) GI.push(o + a, o + b, o + c, o + a, o + c, o + d);
    };
    for (const s of segs) {
      const nx = segs[s.i + 1];
      const baseY = s.h1;
      const topY = Math.max(s.h1, nx ? nx.h0 : s.h1) + (s.i === lastI ? 2.6 : 1.4);
      const GH = topY - baseY;
      const ze = -s.z1;
      const glow = cc.copy(s.col).multiplyScalar(1.5);
      box(-W / 2, baseY + GH / 2, ze, 0.14, GH, 0.14, glow, s.i);
      box(W / 2, baseY + GH / 2, ze, 0.14, GH, 0.14, glow, s.i);
      box(0, topY, ze, W + 0.14, 0.16, 0.16, glow, s.i);
      const endC = ca.copy(s.col).lerp(WHITE, 0.2).multiplyScalar(1.4);
      box(0, s.h1 + 0.03, ze + 0.22, W - 0.02, 0.05, 0.4, endC, s.i);
      s.gateTop = topY;
    }
    const gateGeo = new THREE.BufferGeometry();
    gateGeo.setAttribute('position', new THREE.Float32BufferAttribute(GP, 3));
    gateGeo.setAttribute('aCol', new THREE.Float32BufferAttribute(GC, 3));
    gateGeo.setAttribute('aSeg', new THREE.Float32BufferAttribute(GS, 1));
    gateGeo.setIndex(GI);
    const gates = new THREE.Mesh(gateGeo, gateMat);
    gates.frustumCulled = false;
    gates.renderOrder = 40;
    root.add(gates);
    built.push(gates);

    // META y cuadros en la última
    const L = segs[lastI];
    metaPlane.position.set(0, L.gateTop - 0.75, -L.z1 + 0.02);
    metaPlane.material.color.copy(L.col).lerp(WHITE, 0.5).multiplyScalar(1.6);
    check.position.set(0, L.h1 + 0.025, -L.z1 + 0.75);
    checkMat.color.copy(L.col).lerp(WHITE, 0.3).multiplyScalar(1.4);

    // horizonte más allá del final de la clase
    const HZ = -Math.max(1400, zEnd + 500);
    hzLine.position.set(0, 0.9, HZ);
    hzGlow.position.set(0, 20, HZ - 1);
    camera.far = -HZ + 800;
    camera.updateProjectionMatrix();
    for (const p of slots) p.userData.seg = -1;
  }
  build();

  const segAt = (t) => {
    for (const s of segs) if (t < s.t1) return s;
    return segs[lastI];
  };
  const distAt = (t) => {
    const s = segAt(t);
    return s.z0 + (clamp(t, s.t0, s.t1) - s.t0) * (s.v / 3.6) / UNIT;
  };
  const smooth = (x) => x * x * (3 - 2 * x);
  function groundAt(z) {
    let k = 0;
    while (k < lastI && z >= segs[k].z1) k++;
    const g = segs[k];
    if (k > 0 && z < g.z0 + 2 * RAMP) {
      const u = smooth(clamp01((z - g.z0) / (2 * RAMP)));
      return segs[k - 1].h1 + (g.h0 - segs[k - 1].h1) * u;
    }
    return g.h0 + (g.h1 - g.h0) * clamp01((z - g.zA) / Math.max(1e-6, g.zB - g.zA));
  }
  const topAt = (s, z) => s.h0 + (s.h1 - s.h0) * clamp01((z - s.zA) / Math.max(1e-6, s.zB - s.zA));
  const fmtSp = (s) => `${ctx.fmtSpeed(s.v)}${s.incl ? ` · ${String(s.incl).replace('.', ',')} %` : ''}`;

  function placeSlot(p, s, op) {
    if (!s) { p.visible = false; return; }
    if (p.userData.seg !== s.i) {
      p.userData.seg = s.i;
      p.userData.setText(fmtSp(s));
      const h = s.incl ? 1.15 : 1.5;
      p.scale.multiplyScalar(h / p.scale.y);
      p.material.color.copy(s.col).lerp(WHITE, 0.6);
      const zN = Math.min(s.zA + 1.6 + h / 2, (s.zA + s.zB) / 2);
      p.userData.zN = zN;
      p.rotation.set(-Math.PI / 2 + Math.atan2(s.h1 - s.h0, Math.max(1e-6, s.zB - s.zA)), 0, 0);
      p.position.set(0, topAt(s, zN) + 0.02, -zN);
    }
    p.material.opacity = op;
    p.visible = op > 0.01;
  }

  // ── estado ──
  let camMix = 0, sideMix = 0, endMix = 0;
  let camSpan = null;
  let beltPos = 0;
  let beat = 0;
  let hr = null;            // { bpm, min, max, st } desde el reproductor
  let rebuildAt = -1;
  let portrait = true;
  let curIdx = -1;
  const ringCol = new THREE.Color();
  const tmpC = new THREE.Color();
  const hzBase = C('#5fa8d8');
  const anchor = new THREE.Vector3();
  const dbg = {};
  const rectOf = (kind) => { for (const r of ctx.hud.rects || []) if (r.kind === kind) return r; return null; };

  const inst = {
    director: false,
    get _debug() { return { ...dbg, cur: curIdx, segs: segs.length, zEnd }; },
    resize({ aspect }) { portrait = aspect < 0.9; },

    update(f) {
      if (!segs.length) return;
      if (rebuildAt >= 0 && f.time >= rebuildAt) { rebuildAt = -1; build(); }
      const dt = clamp(f.dt, 0, 0.1);
      const t = clamp(f.t, 0, tl.totalSec);
      const s = segAt(Math.min(t, tl.totalSec - 1e-3));
      const d = distAt(t);
      const leftT = Math.max(0, s.t1 - t);
      const inBlock = t - s.t0;
      const classLeft = Math.max(0, tl.totalSec - t);
      const finale = f.finale > 0;
      if (s.i !== curIdx) {
        curIdx = s.i;
        bodyU.uCur.value = s.i;
        hzMat.color.copy(hzBase).lerp(s.col, 0.5);
        hzGlowMat.color.copy(s.col).multiplyScalar(0.5);
      }

      // ── cámara ──
      const remU = Math.max(0, s.z1 - d);
      const span = Math.min(remU, 60);
      camSpan = camSpan == null ? span : camSpan + (span - camSpan) * Math.min(1, dt * 1.5);
      endMix = clamp01(endMix + ((classLeft <= 30 ? 1 : 0) - endMix) * Math.min(1, dt * 0.8));
      const em = smooth(endMix);
      const back = 8 + camSpan * 0.1 + 10 * em;
      const gYou = groundAt(d);
      // por encima de lo que pisas, de lo que dejas detrás y del escalón que viene (siempre se ve por encima de él)
      const nxs = segs[s.i + 1];
      const upNext = nxs ? Math.max(0, nxs.h0 - gYou) * (1 - smooth(clamp01((remU - 4) / 30))) : 0;
      const camY = Math.max(gYou, groundAt(Math.max(0, d - back)), groundAt(Math.max(0, d - back / 2))) + 5.2 + camSpan * 0.14 + 6 * em + upNext * 1.2;
      const still = f.reducedMotion;
      const wantPov = !still && !em && s.sec >= 180 && inBlock > 25 && leftT > 30;
      const wantSide = !still && inBlock <= 6 + (s.sec < 90 ? 14 : 0) && leftT > 20;
      camMix = clamp01(camMix + ((wantPov ? 1 : 0) - camMix) * Math.min(1, dt * 1.1));
      sideMix = clamp01(sideMix + ((wantSide ? 1 : 0) - sideMix) * Math.min(1, dt * 0.9));
      const m = smooth(camMix), sm = smooth(sideMix);
      const T = rig.target;
      if (finale) {
        // final: sube y enseña la escalera entera, de la salida a la meta
        rig.settle.position = 2.6; rig.settle.lookAt = 2.6;
        T.position.set(-48, topMax + 62, 24);
        T.lookAt.set(4, 24, -zEnd * 0.5);
        T.fov = portrait ? 66 : 50;
      } else {
        rig.settle.position = 0.5; rig.settle.lookAt = 0.5;
        const ax = -4.5 * sm, ay = camY + 1.5 * sm, az = -d + back, tx = 1.2 * sm, ty = gYou - 1.5, tz = -d - 70 + 30 * sm;
        const px = 0, py = gYou + 0.85, pz = -d + 0.5, qx = 0, qy = gYou + 0.38, qz = -d - 12;
        const mix = (a, b) => a + (b - a) * m;
        T.position.set(mix(ax, px), mix(ay, py), mix(az, pz));
        T.lookAt.set(mix(tx, qx), mix(ty, qy), mix(tz, qz));
        T.fov = portrait ? 66 : 50;
      }
      // encuadre por composición: tu marcador (o el suelo justo delante, en primera persona) cae al fondo del hueco libre
      // entre la velocidad y el panel de abajo; el desplazamiento de lente lo coloca sin girar la cámara
      if (finale) T.shift.set(0, 0.15);
      else {
        const hud = ctx.hud;
        let yFrac = portrait ? 0.64 : 0.72;
        const H = Math.max(1, hud.height || 1);
        if (hud.band && hud.band.h > 40) yFrac = (hud.band.y + hud.band.h * 0.78) / H;
        else {
          const lt = rectOf('segment');
          if (lt) yFrac = lt.y / H - 0.04;
        }
        yFrac = clamp(yFrac, 0.45, 0.86);
        dbg.yFrac = yFrac; dbg.band = hud.band;
        anchor.set(0, gYou + 0.05, -d - 5 * m).project(camera);
        if (Number.isFinite(anchor.y) && anchor.z < 1) {
          const ndc0 = anchor.y - rig.current.shift.y;
          const ndcX0 = anchor.x - rig.current.shift.x;   // en escorzo, tu marcador sigue centrado
          T.shift.set(clamp(-ndcX0 * sm, -0.6, 0.6), clamp(1 - 2 * yFrac - ndc0, -0.3, 0.9));
          dbg.ndc = anchor.y; dbg.shift = T.shift.y;
        }
      }

      // ── tu marcador y tu latido ──
      you.position.set(0, gYou + 0.05, -d);
      youMat.opacity = 0.95 * (1 - m) * (finale ? 0 : 1);
      ring.position.set(0, gYou + 0.04, -d - 0.05);
      const inZone = hr && hr.bpm > 0 && hr.min > 0 ? hr.bpm >= hr.min && hr.bpm <= hr.max : true;
      if (hr && hr.bpm > 0 && f.running) beat += (dt * hr.bpm) / 60;
      const env = hr && hr.bpm > 0 && !still ? Math.exp(-((beat % 1) * 6)) : 0;
      ring.scale.setScalar(1 + 0.12 * (1 - env));
      tmpC.copy(inZone ? s.col : WHITE);
      ringCol.lerp(tmpC, Math.min(1, dt * 3));
      ringMat.color.copy(ringCol).multiplyScalar(0.9);
      ringMat.opacity = (0.35 + 0.2 * env) * (1 - m) * (finale ? 0 : 1);

      // ── cinta ──
      if (f.running) beltPos += (s.v / 3.6) * dt / SLAT_M;
      const bStart = Math.max(s.zA, d - 3);
      const bLen = Math.max(0.01, s.zB - bStart);
      const ang = Math.atan2(s.h1 - s.h0, Math.max(1e-6, s.zB - s.zA));
      belt.visible = d < s.zB - 0.05 && !finale;
      belt.position.set(0, topAt(s, bStart) + 0.016, -bStart);
      belt.rotation.set(-Math.PI / 2 + ang, 0, 0);
      belt.scale.set(W * 0.96, bLen / Math.cos(ang), 1);
      beltU.uLen.value = bLen;
      beltU.uBelt.value = beltPos % 1000;
      beltU.uSlat.value = 0.42 + (0.13 - 0.42) * m;
      beltU.uCue.value = ctx.speedFeel ? ctx.speedFeel.cue : 1;
      beltU.uCol.value.copy(s.col).lerp(WHITE, 0.3);
      beltU.uOn.value = 1;

      // ── cifras del suelo: la tuya se apaga al llegar a ella; las dos siguientes claras; la tercera, apenas ──
      for (let k = 0; k < SLOTS; k++) {
        const g = segs[s.i + k];
        const op = finale ? 0 : k === 0 ? 0.6 : k <= 2 ? 0.65 : 0.25;
        placeSlot(slots[k], g, op);
        if (k === 0 && g && !finale) slots[0].material.opacity = 0.6 * clamp01((slots[0].userData.zN - d - 2) / 4);
      }

      // ── metas: la tuya se enciende al acercarte y desaparece al cruzarla con la cámara ──
      if (finale) {
        bodyU.uFront.value = f.finale * 1.25 * segs.length;
      } else {
        bodyU.uFront.value = -1;
        const camZ = rig.current.position.z;
        const near = 1 - Math.min(1, leftT / 60);
        gateU.uCurK.value = (0.8 + 0.2 * near) * clamp01((Math.abs(camZ + s.z1) - 0.4) / 2.2);
        const pg = segs[s.i - 1];
        gateU.uPrevK.value = pg ? 0.1 * clamp01((Math.abs(camZ + pg.z1) - 0.4) / 2.2) : 0;
      }
      checkMat.opacity = s.i === lastI || finale ? 0.9 : 0.45;
    },

    event(type, data) {
      if (type === 'timeline') rebuildAt = 0;            // en el siguiente fotograma (las velocidades ya cambiaron)
      else if (type === 'adjust') rebuildAt = 0;
      else if (type === 'seek' || type === 'start') { camSpan = null; rig.snap(); }
      else if (type === 'hr') hr = data && Number(data.bpm) > 0 ? { bpm: Number(data.bpm), min: Number(data.min) || 0, max: Number(data.max) || 0 } : null;
    },

    dispose() {
      for (const p of slots) p.userData.dispose?.();
      metaPlane.userData.dispose?.();
    },
  };
  return inst;
}
