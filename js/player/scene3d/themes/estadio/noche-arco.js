// ESTADIO DE NOCHE (modo retransmisión) · ARCO DE META (copia de tools/estadio-bake/arco.js; el crono muestra la clase). Todo procedural (sin modelos externos):
//  · Arco: dos torres de celosía cuadrada de aluminio (cordones Ø50 mm, travesaños y diagonales Ø25 mm), una viga de
//    celosía arriba de 11,8 m con una pantalla LED a cada cara (logo oficial de RITMUP + crono que corre y se para al
//    romperse la cinta), placas de acero con lastre en las bases y focos estroboscópicos en las esquinas. Metal con
//    luz de los focos del estadio, brillo especular y destello del rayo. Una llamada para toda la celosía.
//  · Rayo: descarga ramificada detrás de la grada de enfrente (polilínea con ramas, cintas aditivas que miran a cámara),
//    visible unas décimas con dos o tres pulsos.
import { A } from './track.js';
import { wordmarkSvg, WORDMARK_RATIO } from '../../../../ui/wordmark.js';

export const ARCH = { x: A, z0: 35.55, z1: 47.25, h: 5.6, beamH: 1.0, w: 0.6 };

/** Logo oficial (el de la app) como imagen: blanco con la calle de la «r» en naranja. */
export async function officialLogo(color = '#FFFFFF') {
  const svg = wordmarkSvg({ label: '' }).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/currentColor/g, color);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  return { img, ratio: WORDMARK_RATIO };
}

const METAL_VERT = /* glsl */ `
attribute vec3 iA;
attribute vec3 iB;
attribute float iR;
varying vec3 vN;
varying vec3 vW;
void main() {
  // cilindro unidad a lo largo de y (0..1) → tubo de iA a iB con radio iR
  vec3 ax = iB - iA;
  float L = length(ax);
  vec3 y = ax / max(L, 1e-5);
  vec3 c = cross(abs(y.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), y);
  vec3 x = c / max(length(c), 1e-5);
  vec3 z = cross(x, y);
  vec3 p = iA + x * position.x * iR + y * position.y * L + z * position.z * iR;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * (x * normal.x + y * normal.y + z * normal.z));
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** Fragmento común del metal (aluminio satinado mojado). */
const METAL_FRAG = /* glsl */ `
uniform float uLightAll, uFlash, uPunch, uFogD, uFogMul, uFogBase;
uniform vec3 uFog, uBase;
uniform vec3 uLedPos;   // centro de la pantalla LED (estadio): baña el metal cercano
uniform float uLed;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  // luz de la corona de focos: viene de arriba y de los lados (cuatro direcciones), más el cielo
  vec3 L1 = normalize(vec3(0.0, 1.0, 0.75)); vec3 L2 = normalize(vec3(0.0, 1.0, -0.75));
  vec3 L3 = normalize(vec3(0.8, 0.9, 0.0)); vec3 L4 = normalize(vec3(-0.8, 0.9, 0.0));
  float dif = max(dot(N, L1), 0.0) + max(dot(N, L2), 0.0) + 0.6 * max(dot(N, L3), 0.0) + 0.6 * max(dot(N, L4), 0.0);
  float spec = pow(max(dot(N, normalize(L1 + V)), 0.0), 70.0) + pow(max(dot(N, normalize(L2 + V)), 0.0), 70.0)
    + 0.6 * pow(max(dot(N, normalize(L3 + V)), 0.0), 50.0);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 col = uBase * (0.06 + 0.42 * dif) * (0.04 + uLightAll * (1.0 + 0.4 * uPunch));
  col += vec3(1.0, 0.95, 0.88) * spec * 0.9 * uLightAll + vec3(0.6, 0.62, 0.66) * fres * 0.25 * uLightAll;
  // la pantalla LED tiñe de naranja y blanco el metal de alrededor
  float dl = length(vW - uLedPos);
  col += vec3(1.0, 0.55, 0.3) * uLed * 0.35 * max(dot(N, normalize(uLedPos - vW)), 0.0) / (1.0 + dl * dl * 0.25);
  // el rayo: un blanco azulado que lo recorta todo
  col += vec3(0.8, 0.85, 1.0) * uFlash * (0.25 + 0.75 * max(N.y, 0.0) + fres) * 1.6;
  float dist = length(vW - cameraPosition);
  float fx = dist * uFogD * (uFogBase + (uFogMul - 1.0) * exp(-max(0.5 * (cameraPosition.y + vW.y), 0.0) / 28.0));
  col = mix(col, uFog, 1.0 - exp(-fx * fx));
  col = (col.r == col.r && col.g == col.g && col.b == col.b) ? clamp(col, 0.0, 40.0) : vec3(0.0);
  gl_FragColor = vec4(col, 1.0);
}`;

export async function createArch(THREE, world, U, fogU, RL) {
  const { x: X, z0, z1, h: H, beamH: BH, w: Wd } = ARCH;
  const segs = [];
  const tube = (a, b, r) => segs.push([a[0], a[1], a[2], b[0], b[1], b[2], r]);
  const CH = 0.025; const LC = 0.0125;
  // ── torre de celosía cuadrada entre y0 e y1, centrada en (cx, cz) ──
  function tower(cx, cz, y0, y1) {
    const hw = Wd / 2;
    const cs = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]];
    for (const [dx, dz] of cs) tube([cx + dx, y0, cz + dz], [cx + dx, y1, cz + dz], CH);
    const n = Math.round((y1 - y0) / 0.5);
    for (let i = 0; i <= n; i++) {
      const y = y0 + ((y1 - y0) * i) / n;
      for (let k = 0; k < 4; k++) { const a = cs[k]; const b = cs[(k + 1) % 4]; tube([cx + a[0], y, cz + a[1]], [cx + b[0], y, cz + b[1]], LC); }
      if (i < n) {
        const y2 = y0 + ((y1 - y0) * (i + 1)) / n;
        for (let k = 0; k < 4; k++) {
          const a = cs[k]; const b = cs[(k + 1) % 4];
          const flip = (i + k) % 2;
          tube([cx + (flip ? a : b)[0], y, cz + (flip ? a : b)[1]], [cx + (flip ? b : a)[0], y2, cz + (flip ? b : a)[1]], LC);
        }
      }
    }
  }
  // ── viga de celosía horizontal (a lo largo de z) de sección Wd × BH ──
  function beam(y0, za, zb) {
    const hw = Wd / 2;
    const cs = [[-hw, 0], [hw, 0], [hw, BH], [-hw, BH]];
    for (const [dx, dy] of cs) tube([X + dx, y0 + dy, za], [X + dx, y0 + dy, zb], CH);
    const n = Math.round((zb - za) / 0.5);
    for (let i = 0; i <= n; i++) {
      const z = za + ((zb - za) * i) / n;
      for (let k = 0; k < 4; k++) { const a = cs[k]; const b = cs[(k + 1) % 4]; tube([X + a[0], y0 + a[1], z], [X + b[0], y0 + b[1], z], LC); }
      if (i < n) {
        const z2 = za + ((zb - za) * (i + 1)) / n;
        for (let k = 0; k < 4; k++) {
          const a = cs[k]; const b = cs[(k + 1) % 4];
          const flip = (i + k) % 2;
          tube([X + (flip ? a : b)[0], y0 + (flip ? a : b)[1], z], [X + (flip ? b : a)[0], y0 + (flip ? b : a)[1], z2], LC);
        }
      }
    }
  }
  tower(X, z0, 0.12, H);
  tower(X, z1, 0.12, H);
  beam(H - BH, z0 - Wd / 2, z1 + Wd / 2);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  cyl.translate(0, 0.5, 0);
  const g = new THREE.InstancedBufferGeometry();
  g.index = cyl.index;
  g.setAttribute('position', cyl.attributes.position);
  g.setAttribute('normal', cyl.attributes.normal);
  const iA = new Float32Array(segs.length * 3); const iB = new Float32Array(segs.length * 3); const iR = new Float32Array(segs.length);
  segs.forEach((s, i) => { iA.set(s.slice(0, 3), i * 3); iB.set(s.slice(3, 6), i * 3); iR[i] = s[6]; });
  g.setAttribute('iA', new THREE.InstancedBufferAttribute(iA, 3));
  g.setAttribute('iB', new THREE.InstancedBufferAttribute(iB, 3));
  g.setAttribute('iR', new THREE.InstancedBufferAttribute(iR, 1));
  g.instanceCount = segs.length;
  const ledPos = new THREE.Vector3(X, H - BH / 2, (z0 + z1) / 2);
  const MU = {
    uLightAll: U.uLightAll, uFlash: U.uFlash, uPunch: U.uPunch, uFog: fogU.uFog, uFogD: fogU.uFogD, uFogMul: U.uFogMul, uFogBase: U.uFogBase,
    uBase: { value: new THREE.Color(0.62, 0.64, 0.67) }, uLedPos: { value: ledPos }, uLed: { value: 1 },
  };
  const truss = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: MU, vertexShader: METAL_VERT, fragmentShader: METAL_FRAG }));
  truss.frustumCulled = false;
  truss.layers.enable(RL);
  world.add(truss);

  // ── bases: placa de acero + lastre negro en cada torre (cajas con el mismo metal, más oscuro) ──
  const boxMat = new THREE.ShaderMaterial({
    uniforms: { ...MU, uBase: { value: new THREE.Color(0.08, 0.085, 0.09) } },
    vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: METAL_FRAG,
  });
  for (const z of [z0, z1]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 1.1), boxMat); plate.position.set(X, 0.03, z); world.add(plate);
    const ball = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.42, 0.5), boxMat); ball.position.set(X - 0.62, 0.21, z); world.add(ball);
    const ball2 = ball.clone(); ball2.position.x = X + 0.62; world.add(ball2);
    for (const o of [plate, ball, ball2]) o.layers.enable(RL);
  }

  // ── pantallas LED de la viga (las dos caras): logo oficial + crono ──
  const { img: logo, ratio } = await officialLogo('#FFFFFF');
  const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 176;
  const g2 = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  let lastTxt = '';
  function drawScreen(clock, stopped, flashK) {
    const txt = `${clock}|${stopped}|${Math.round(flashK * 4)}`;
    if (txt === lastTxt) return;
    lastTxt = txt;
    g2.fillStyle = '#020203'; g2.fillRect(0, 0, cv.width, cv.height);
    // logo oficial a la izquierda
    const lh = 104; const lw = lh * ratio;
    g2.drawImage(logo, 70, (cv.height - lh) / 2 + 6, lw, lh);
    // META en el centro, crono a la derecha (DIN, cifras tabulares)
    g2.fillStyle = '#ffffff';
    g2.font = '700 120px "DIN Condensed", "DIN Alternate", sans-serif';
    g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.fillText('META', cv.width * 0.5, cv.height / 2 + 8);
    g2.font = '700 124px "DIN Alternate", "DIN Condensed", sans-serif';
    g2.textAlign = 'right';
    g2.fillStyle = stopped ? (flashK > 0.5 ? '#ffffff' : '#FF5A1F') : '#FF5A1F';
    g2.fillText(clock, cv.width - 70, cv.height / 2 + 8);
    // rejilla de diodos (se ve de cerca)
    g2.fillStyle = 'rgba(0,0,0,0.28)';
    for (let y = 0; y < cv.height; y += 4) g2.fillRect(0, y, cv.width, 1);
    for (let x = 0; x < cv.width; x += 4) g2.fillRect(x, 0, 1, cv.height);
    tex.needsUpdate = true;
  }
  const scrMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uK: { value: 1.6 }, uFog: fogU.uFog, uFogD: fogU.uFogD, uFogMul: U.uFogMul, uFogBase: U.uFogBase },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform sampler2D uMap; uniform float uK, uFogD, uFogMul, uFogBase; uniform vec3 uFog; varying vec2 vUv; varying vec3 vW;
void main(){ vec3 c = texture2D(uMap, vUv).rgb * uK; float dist = length(vW - cameraPosition);
  float fx = dist * uFogD * (uFogBase + (uFogMul - 1.0) * exp(-max(0.5 * (cameraPosition.y + vW.y), 0.0) / 28.0));
  c = mix(c, uFog, (1.0 - exp(-fx * fx)) * 0.6); gl_FragColor = vec4(c, 1.0); }`,
  });
  const sw = z1 - z0 - 0.2; const sh = BH - 0.16;
  for (const side of [-1, 1]) {
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), scrMat);
    // cara −x (la que ve el corredor al llegar) y cara +x (la que se ve desde la grúa)
    scr.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
    scr.position.set(X + side * (Wd / 2 + 0.02), H - BH / 2, (z0 + z1) / 2);
    scr.layers.enable(RL);
    world.add(scr);
    // carcasa negra de la pantalla
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.1, BH - 0.06, sw + 0.12), boxMat);
    box.position.set(X + side * (Wd / 2 - 0.04), H - BH / 2, (z0 + z1) / 2);
    world.add(box);
  }

  // ── focos estroboscópicos en las cuatro esquinas de la viga (destellan con el golpe) ──
  // (se pintan como puntos del shader de las baterías no: aquí, unos discos aditivos simples)
  const sg = new THREE.PlaneGeometry(1, 1);
  const strobeMat = new THREE.ShaderMaterial({
    uniforms: { uK: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec2 vL; void main(){ vL = position.xy * 2.0; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += position.xy * 0.9; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float uK; varying vec2 vL; void main(){ float r2 = dot(vL, vL); float a = (exp(-r2 * 14.0) * 3.0 + exp(-r2 * 3.0) * 0.4) * uK; if (!(a > 0.002)) discard; gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * a, 1.0); }',
  });
  const strobes = [];
  for (const z of [z0 - Wd / 2, z1 + Wd / 2]) for (const dx of [-Wd / 2, Wd / 2]) {
    const s = new THREE.Mesh(sg, strobeMat); s.position.set(X + dx, H + 0.08, z); s.frustumCulled = false; s.renderOrder = 25; s.layers.enable(RL); world.add(s); strobes.push(s);
  }

  return {
    truss,
    update(t, tSnap, tStart, clockText) {
      const run = t < tSnap ? t - tStart : tSnap - tStart;
      const sec = Math.max(0, 56.2 + run);
      const m = Math.floor(sec / 60); const s = sec - m * 60;
      const clock = clockText || `${m}:${s.toFixed(2).padStart(5, '0')}`;
      const after = t - tSnap;
      const blink = after > 0 ? (Math.floor(after * 6) % 2) : 0;
      drawScreen(clock, t >= tSnap, blink);
      scrMat.uniforms.uK.value = 1.6 + (after > 0 && after < 0.25 ? 2.5 * (1 - after / 0.25) : 0);
      strobeMat.uniforms.uK.value = after > 0 ? Math.max(0, Math.sin(after * 40) > 0.3 ? 1 : 0) * Math.exp(-after * 3) * 1.5 : 0;
      MU.uLed.value = 1 + (after > 0 ? 1.5 * Math.exp(-after * 4) : 0);
    },
  };
}

/** Rayo ramificado detrás de la grada de enfrente: cintas aditivas que miran a cámara. */
export function createBolt(THREE, world, U, seed = 3, from = [330, 345, 18], dir = [-0.03, -1, 0.0], width = 2.4) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const paths = [];
  function branch(p, dir, len, depth, w) {
    const pts = [p.slice()];
    let q = p.slice();
    const n = Math.round(len / 7);
    for (let i = 0; i < n; i++) {
      q = [q[0] + dir[0] * 7 + (rnd() - 0.5) * 9, q[1] + dir[1] * 7 + (rnd() - 0.5) * 3, q[2] + dir[2] * 7 + (rnd() - 0.5) * 9];
      pts.push(q.slice());
      if (depth < 2 && rnd() < 0.18) branch(q, [dir[0] + (rnd() - 0.5) * 1.2, dir[1] * 0.8, dir[2] + (rnd() - 0.5) * 0.6], len * 0.35, depth + 1, w * 0.45);
    }
    paths.push({ pts, w });
  }
  // de las nubes (≈ 340 m) hasta detrás de la grada de la curva 1: delante del corredor al cruzar la meta
  branch(from, dir, 320, 0, width);
  const pos = []; const side = []; const wid = []; const idx = []; const dirs = [];
  let base = 0;
  for (const { pts, w } of paths) {
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i]; const p1 = pts[i + 1];
      const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      for (const [p, sd] of [[p0, -1], [p0, 1], [p1, -1], [p1, 1]]) { pos.push(...p); side.push(sd); wid.push(w); dirs.push(...d); }
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      base += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(side), 1));
  g.setAttribute('aW', new THREE.BufferAttribute(new Float32Array(wid), 1));
  g.setAttribute('aDir', new THREE.BufferAttribute(new Float32Array(dirs), 3));
  g.setIndex(idx);
  const BU = { uK: { value: 0 } };
  const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: BU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `attribute float aSide; attribute float aW; attribute vec3 aDir; varying float vS; varying float vW;
void main(){ vec4 a = viewMatrix * modelMatrix * vec4(position, 1.0); vec3 d = mat3(viewMatrix) * mat3(modelMatrix) * aDir;
  vec3 sd = cross(normalize(d), normalize(a.xyz)); sd /= max(length(sd), 1e-5);
  a.xyz += sd * aSide * aW * 2.6; vS = aSide; vW = aW; gl_Position = projectionMatrix * a; }`,
    fragmentShader: 'uniform float uK; varying float vS; varying float vW; void main(){ float core = exp(-vS * vS * 9.0); float a = (core * 6.0 + 0.6) * uK * (0.4 + 0.3 * vW); if (!(a > 0.002)) discard; gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * min(a, 20.0), 1.0); }',
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  world.add(mesh);
  return { mesh, set(k) { BU.uK.value = k; mesh.visible = k > 0.001; } };
}
