// RITMUP · escenario BOX · lo que reacciona a la AMRAP:
//  · PÓRTICO de la ronda: una estructura de dominadas que cruza la pista con el reloj LED (ronda en verde, lo que queda
//    del tope en rojo). Está clavado en la nave a los METROS que te faltan para acabar la ronda: lo ves venir y lo cruzas
//    justo cuando el motor da la ronda por hecha.
//  · Metros pintados en la pista cada 50 m («100», «50»…) contando hacia el pórtico, la línea de la ronda y, en la
//    recuperación, la línea de salida de la ronda siguiente con su número.
//  · Polvo de magnesio en el aire.
//  · FINAL: corte a la pizarra de tiza con el WOD, un palote por ronda, el resultado y el récord; si lo bates, se
//    enciende la nave entera y suena (se balancea) la campana de récord.
// Entradas: update(f, { S, am }) cada fotograma (am = último estado 'amrap' o null) y los eventos 'amrapEnd'/'finish'.

const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function seg7(g, x, y, w, h, t, digit, on, off) {
  const hw = t / 2;
  const hbar = (cx, cy, len) => { g.beginPath(); g.moveTo(cx - len / 2, cy); g.lineTo(cx - len / 2 + hw, cy - hw); g.lineTo(cx + len / 2 - hw, cy - hw); g.lineTo(cx + len / 2, cy); g.lineTo(cx + len / 2 - hw, cy + hw); g.lineTo(cx - len / 2 + hw, cy + hw); g.closePath(); g.fill(); };
  const vbar = (cx, cy, len) => { g.beginPath(); g.moveTo(cx, cy - len / 2); g.lineTo(cx + hw, cy - len / 2 + hw); g.lineTo(cx + hw, cy + len / 2 - hw); g.lineTo(cx, cy + len / 2); g.lineTo(cx - hw, cy + len / 2 - hw); g.lineTo(cx - hw, cy - len / 2 + hw); g.closePath(); g.fill(); };
  const L = w - t - 4, V = h / 2 - t / 2 - 4;
  const P = { a: () => hbar(x + w / 2, y + hw, L), g: () => hbar(x + w / 2, y + h / 2, L), d: () => hbar(x + w / 2, y + h - hw, L),
    f: () => vbar(x + hw, y + h / 4 + hw / 2, V), b: () => vbar(x + w - hw, y + h / 4 + hw / 2, V), e: () => vbar(x + hw, y + (3 * h) / 4 - hw / 2, V), c: () => vbar(x + w - hw, y + (3 * h) / 4 - hw / 2, V) };
  const lit = digit == null ? '' : SEG[digit];
  for (const k of 'abcdefg') { const is = lit.includes(k); g.fillStyle = is ? on : off; g.shadowBlur = is ? t * 0.9 : 0; P[k](); }
}

const FLAT = /* glsl */ `
varying vec3 vW; varying vec2 vUv;
void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

export function createAmrap(ctx, kit) {
  const { THREE, root, util } = ctx;
  const { clamp, clamp01, damp } = util;
  const { U, COMMON, MOD_VERT, MOD_FRAG, propGeometry } = kit;
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const M4 = () => new THREE.Matrix4();
  const disposables = [];

  // material de los objetos sueltos: el de los módulos, con su propia luz (sin horneado: luz media + oclusión por normal)
  const propU = { ...U, uEm: { value: V3(7, 3.4, 1) }, uSpecK: { value: 1.2 }, uLmKv: { value: 1 } };
  const propMat = new THREE.ShaderMaterial({ uniforms: propU, vertexShader: MOD_VERT, fragmentShader: MOD_FRAG, side: THREE.DoubleSide });
  const STEEL = [0.012, 0.012, 0.013];
  const box = (sx, sy, sz, x, y, z, color = STEEL, o = {}) => ({ geo: new THREE.BoxGeometry(sx, sy, sz), matrix: M4().makeTranslation(x, y, z), color, rough: 0.42, lit: 0.55, ...o });
  const tubeX = (r, len, x, y, z, color, o = {}) => ({ geo: new THREE.CylinderGeometry(r, r, len, 10), matrix: M4().makeTranslation(x, y, z).multiply(M4().makeRotationZ(Math.PI / 2)), color, rough: 0.3, lit: 0.6, ...o });

  // ───────────────────────── pórtico con el reloj ─────────────────────────
  const portal = new THREE.Group();
  const WING_L = 2.64, WING_R = 2.975;   // centro de cada marcador lateral (m desde el eje de la pista)
  {
    const parts = [];
    for (const s of [-1, 1]) {
      for (const z of [0, -1.8]) { parts.push(box(0.09, 3.9, 0.09, s * 2.05, 1.95, z)); parts.push(box(0.2, 0.015, 0.2, s * 2.05, 0.008, z)); }
      parts.push(box(0.09, 0.09, 1.89, s * 2.05, 3.86, -0.9)); parts.push(box(0.09, 0.09, 1.89, s * 2.05, 2.62, -0.9));
      parts.push(box(0.09, 2.9, 0.09, s * 3.9, 1.45, 0)); parts.push(box(0.2, 0.015, 0.2, s * 3.9, 0.008, 0));
      parts.push(tubeX(0.017, 1.85, s * 2.975, 2.72, 0, [0.42, 0.42, 0.44], { metal: 1 }));
      parts.push(box(1.85, 0.07, 0.07, s * 2.975, 2.86, 0));
    }
    for (const z of [0, -1.8]) parts.push(box(4.19, 0.09, 0.09, 0, 3.86, z));
    parts.push(tubeX(0.017, 4.1, 0, 2.62, -1.8, [0.42, 0.42, 0.44], { metal: 1 }));
    parts.push(box(3.66, 1.12, 0.16, 0, 3.28, 0.1, [0.01, 0.01, 0.011], { rough: 0.3 }));
    parts.push(box(0.06, 0.5, 0.06, -1.2, 3.62, 0.02)); parts.push(box(0.06, 0.5, 0.06, 1.2, 3.62, 0.02));
    // marcadores a la altura de los ojos en las alas (ronda a la izquierda, tope a la derecha): quedan junto al
    // horizonte, dentro de la franja que deja libre el marcador de la app, a cualquier distancia
    parts.push(box(1.09, 0.99, 0.12, -WING_L, 1.5, 0.06, [0.01, 0.01, 0.011], { rough: 0.3 }));
    parts.push(box(1.8, 0.9, 0.12, WING_R, 1.5, 0.06, [0.01, 0.01, 0.011], { rough: 0.3 }));
    for (const y of [1.14, 1.86]) parts.push(box(1.76, 0.05, 0.05, -2.975, y, 0.0));
    const g = propGeometry(THREE, parts); disposables.push(g);
    const m = new THREE.Mesh(g, propMat); m.frustumCulled = false; portal.add(m);
  }
  const clockCv = document.createElement('canvas'); clockCv.width = 768; clockCv.height = 224;
  const clockTex = new THREE.CanvasTexture(clockCv); clockTex.colorSpace = THREE.SRGBColorSpace; clockTex.anisotropy = 4; disposables.push(clockTex);
  let clockKey = '';
  function drawClock(round, sec) {
    const key = `${round}|${sec}`;
    if (key === clockKey) return; clockKey = key;
    const g = clockCv.getContext('2d');
    g.shadowBlur = 0; g.fillStyle = '#030303'; g.fillRect(0, 0, 768, 224);
    const y = 30, h = 164, w = 92, t = 20;
    g.shadowColor = '#35ff70';
    const r = Math.max(0, Math.min(99, round | 0));
    seg7(g, 40, y, w, h, t, r >= 10 ? Math.floor(r / 10) : null, '#48ff7c', '#061407');
    seg7(g, 40 + w + 18, y, w, h, t, r % 10, '#48ff7c', '#061407');
    g.shadowColor = '#ff2a12';
    const s = Math.max(0, Math.ceil(sec));
    const mm = Math.floor(s / 60), ss = s % 60;
    const x0 = 300;
    const ds = [Math.floor(mm / 10), mm % 10, Math.floor(ss / 10), ss % 10];
    let x = x0;
    for (let i = 0; i < 4; i++) {
      seg7(g, x, y, w, h, t, ds[i], '#ff341c', '#170504');
      x += w + 16;
      if (i === 1) { g.fillStyle = '#ff341c'; g.shadowBlur = 16; g.beginPath(); g.arc(x + 8, y + h * 0.32, 10, 0, 7); g.arc(x + 8, y + h * 0.68, 10, 0, 7); g.fill(); x += 34; }
    }
    clockTex.needsUpdate = true;
  }
  const mkClockMat = () => new THREE.ShaderMaterial({
    uniforms: { ...U, uMap: { value: clockTex }, uGain: { value: 3.2 } },
    vertexShader: FLAT,
    fragmentShader: /* glsl */ `${COMMON}
uniform sampler2D uMap; uniform float uGain; varying vec3 vW; varying vec2 vUv;
void main() {
  vec3 c = texture2D(uMap, vUv).rgb;
  // rejilla de puntos del panel LED, solo de cerca
  float dist = length(cameraPosition - vW);
  vec2 q = fract(vUv * vec2(192.0, 56.0)) - 0.5;
  float dot_ = mix(1.0, smoothstep(0.5, 0.25, length(q)) * 1.5, smoothstep(26.0, 8.0, dist));
  gl_FragColor = vec4(fogged(c * uGain * dot_, dist), 1.0);
}`,
  });
  const clockMat = mkClockMat(), wingMatL = mkClockMat(), wingMatR = mkClockMat();
  const clock = new THREE.Mesh(new THREE.PlaneGeometry(3.44, 1.0), clockMat); clock.position.set(0, 3.28, 0.185); portal.add(clock);
  const sub = (w, h, u0, u1, x, mat) => {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + (u1 - u0) * uv.getX(i));
    disposables.push(g);
    const m = new THREE.Mesh(g, mat); m.position.set(x, 1.5, 0.125); portal.add(m);
  };
  sub(0.97, 0.875, 0.03, 0.34, -WING_L, wingMatL);     // ronda (pegado al poste, lo más cerca de la pista)
  sub(1.72, 0.8, 0.375, 0.99, WING_R, wingMatR);       // lo que queda del tope
  const haloMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uCol: { value: V3(1, 0.1, 0.05) }, uK: { value: 0.5 } },
    vertexShader: FLAT, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    fragmentShader: /* glsl */ `${COMMON}
uniform vec3 uCol; uniform float uK; varying vec3 vW; varying vec2 vUv;
void main() { vec2 d = (vUv - 0.5) * 2.0; float a = exp(-dot(d, d) * 3.2) * (1.0 - smoothstep(0.8, 1.0, length(d)));
  gl_FragColor = vec4(uCol * a * uK * exp(-length(cameraPosition - vW) * uFogD), 1.0); }`,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.0), haloMat); halo.position.set(0.4, 3.28, 0.22); halo.renderOrder = 22; portal.add(halo);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), haloMat.clone()); pool.material.uniforms.uK = { value: 0.12 }; pool.material.uniforms.uCol = { value: V3(1, 0.12, 0.06) };
  for (const k in U) pool.material.uniforms[k] = U[k];
  pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.012, 1.6); pool.renderOrder = 6; portal.add(pool);
  portal.visible = false; root.add(portal);

  // ───────────────────────── pintura en la pista (metros, líneas) ─────────────────────────
  const DECAL_FRAG = /* glsl */ `${COMMON}
uniform sampler2D uMap; uniform float uA; varying vec3 vW; varying vec2 vUv;
void main() {
  float srel = -vW.z;
  vec3 LT, LN, LD; lights(srel, LT, LN, LD);
  vec2 p = vec2(vW.x, uS + srel);
  vec3 lm = lmFloor(p);
  float a = texture2D(uMap, vUv).a * uA * (0.7 + 0.3 * vnoise(p * 9.0)) * (0.82 + 0.18 * step(0.25, vnoise(p * 37.0)));
  vec3 col = vec3(0.62, 0.62, 0.6) * (lm.r * LT + lm.g * LN + lm.b * LD + uAmb);
  gl_FragColor = vec4(fogged(col, length(cameraPosition - vW)), a);
}`;
  function decal(w, d, cw, ch) {
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 8; disposables.push(tex);
    const mat = new THREE.ShaderMaterial({ uniforms: { ...U, uMap: { value: tex }, uA: { value: 1 } }, vertexShader: FLAT, fragmentShader: DECAL_FRAG, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.y = 0.004; m.visible = false; m.renderOrder = 4; m.frustumCulled = false; root.add(m);
    return { m, cv, tex, key: '' };
  }
  const FONT = '"DIN Condensed", "Bebas Neue", "Arial Narrow", "Helvetica Neue", sans-serif';
  function paintText(dc, text, sub) {
    const key = text + '|' + (sub || '');
    if (dc.key === key) return; dc.key = key;
    const g = dc.cv.getContext('2d'); const W = dc.cv.width, H = dc.cv.height;
    g.clearRect(0, 0, W, H); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.font = `700 ${H * (sub ? 0.72 : 0.92)}px ${FONT}`;
    g.fillText(text, W / 2, H * (sub ? 0.66 : 0.86));
    if (sub) { g.font = `700 ${H * 0.2}px ${FONT}`; g.fillText(sub, W / 2, H * 0.95); }
    dc.tex.needsUpdate = true;
  }
  const marks = [decal(2.5, 2.9, 256, 300), decal(2.5, 2.9, 256, 300), decal(2.5, 2.9, 256, 300)];
  const startDc = decal(2.7, 3.4, 256, 320);
  const lineCv = (dc) => { const g = dc.cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, dc.cv.width, dc.cv.height); dc.tex.needsUpdate = true; };
  const gateLine = decal(3.12, 0.22, 8, 8); lineCv(gateLine);
  const startLine = decal(3.12, 0.12, 8, 8); lineCv(startLine);

  // ───────────────────────── polvo de magnesio ─────────────────────────
  const N_DUST = 420;
  const dust = (() => {
    const rnd = ctx.rng(77);
    const P = new Float32Array(N_DUST * 3), R = new Float32Array(N_DUST * 2);
    for (let i = 0; i < N_DUST; i++) { P[i * 3] = rnd(); P[i * 3 + 1] = rnd(); P[i * 3 + 2] = rnd(); R[i * 2] = rnd(); R[i * 2 + 1] = rnd(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('aRnd', new THREE.BufferAttribute(R, 2));
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U, uSabs: { value: 0 }, uPx: { value: 1 }, uK: { value: 1 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: /* glsl */ `${COMMON}
attribute vec2 aRnd; uniform float uSabs, uPx, uK; varying vec3 vC;
void main() {
  // caja de 12 × 4,6 × 34 m por delante de ti; el polvo queda quieto en la nave (pasa a tu velocidad) y flota despacio
  float zz = mod(position.z * 34.0 - uSabs + sin(uTime * 0.07 + aRnd.x * 40.0) * 0.6, 34.0);
  vec3 p = vec3((position.x - 0.5) * 12.0 + sin(uTime * 0.11 + aRnd.y * 30.0) * 0.35, 0.25 + position.y * 4.4 + sin(uTime * 0.09 + aRnd.x * 17.0) * 0.25, -1.2 - zz);
  vec3 LT, LN, LD; lights(-p.z, LT, LN, LD);
  vec3 lm = lmFloor(vec2(p.x, uS - p.z));
  float fade = smoothstep(0.0, 4.0, zz) * (1.0 - smoothstep(26.0, 34.0, zz));
  vC = (lm.r * LT * 0.9 + lm.g * LN * 0.3 + lm.b * LD * 1.8 + 0.01) * fade * uK * (0.3 + 0.7 * aRnd.x);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uPx * (0.008 + 0.014 * aRnd.y) / max(-mv.z, 0.5), 1.0, 6.0);
}`,
      fragmentShader: /* glsl */ `varying vec3 vC;
void main() { vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(d)); gl_FragColor = vec4(vC * a, 1.0); }`,
    });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 25; root.add(pts); disposables.push(g);
    return pts;
  })();

  // ───────────────────────── pizarra del final y campana de récord ─────────────────────────
  const board = new THREE.Group(); board.visible = false; root.add(board);
  const BW = 1.7, BH = 2.3;
  const boardCv = document.createElement('canvas'); boardCv.width = 768; boardCv.height = 1040;
  const boardTex = new THREE.CanvasTexture(boardCv); boardTex.colorSpace = THREE.SRGBColorSpace; boardTex.anisotropy = 8; disposables.push(boardTex);
  const boardMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uMap: { value: boardTex }, uSpot: { value: 0 }, uSpotCol: { value: V3(1.0, 0.62, 0.32) } },
    vertexShader: FLAT,
    fragmentShader: /* glsl */ `${COMMON}
uniform sampler2D uMap; uniform float uSpot; uniform vec3 uSpotCol; varying vec3 vW; varying vec2 vUv;
void main() {
  vec3 LT, LN, LD; lights(-vW.z, LT, LN, LD);
  vec4 t = texture2D(uMap, vUv);
  // pizarra: verde-negro mate con el polvo de tiza de mil borrados
  float smear = vnoise(vUv * vec2(5.0, 9.0)) * 0.6 + vnoise(vUv * vec2(21.0, 13.0)) * 0.4;
  vec3 slate = vec3(0.016, 0.022, 0.02) * (0.7 + 0.9 * smear);
  vec3 alb = mix(slate, vec3(0.86, 0.86, 0.82), t.a * (0.72 + 0.28 * vnoise(vUv * 260.0)));
  vec2 d = (vUv - vec2(0.5, 0.62)) * vec2(1.0, 1.25);
  float spot = uSpot * (0.8 * exp(-dot(d, d) * 1.5) + 0.12);
  vec3 col = alb * (uSpotCol * spot + (LT + LN + LD) * 0.2 + uAmb);
  gl_FragColor = vec4(fogged(col, length(cameraPosition - vW)), 1.0);
}`,
  });
  const bell = new THREE.Group();
  {
    const WOOD = [0.2, 0.12, 0.055];
    const parts = [
      box(BW + 0.14, 0.07, 0.06, 0, BH + 0.035, 0, WOOD, { rough: 0.55, wood: 1 }), box(BW + 0.14, 0.07, 0.06, 0, -0.035, 0, WOOD, { rough: 0.55, wood: 1 }),
      box(0.07, BH + 0.14, 0.06, -BW / 2 - 0.035, BH / 2, 0, WOOD, { rough: 0.55, wood: 1 }), box(0.07, BH + 0.14, 0.06, BW / 2 + 0.035, BH / 2, 0, WOOD, { rough: 0.55, wood: 1 }),
      box(BW, BH, 0.03, 0, BH / 2, -0.025, [0.012, 0.014, 0.013], { rough: 0.8 }),
      box(BW + 0.3, 0.05, 0.1, 0, -0.1, 0.06, WOOD, { rough: 0.55, wood: 1 }),   // repisa de la tiza
      box(0.1, 0.022, 0.022, -0.3, -0.064, 0.07, [0.8, 0.8, 0.77], { rough: 0.9, lit: 0.8 }), box(0.07, 0.022, 0.022, 0.12, -0.064, 0.08, [0.8, 0.8, 0.77], { rough: 0.9, lit: 0.8 }),
    ];
    const g = propGeometry(THREE, parts); disposables.push(g);
    const tilt = new THREE.Group(); tilt.position.set(0, 0.42, 0); tilt.rotation.x = -0.14;
    const frame = new THREE.Mesh(g, propMat); frame.frustumCulled = false; tilt.add(frame);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), boardMat); face.position.set(0, BH / 2, -0.008); tilt.add(face);
    board.add(tilt);
    // caballete
    const legs = [];
    for (const s of [-1, 1]) {
      legs.push({ geo: new THREE.BoxGeometry(0.06, 2.75, 0.05), matrix: M4().makeTranslation(s * (BW / 2 + 0.035), 1.3, -0.2).multiply(M4().makeRotationX(-0.14)), color: WOOD, rough: 0.55, lit: 0.5, wood: 1 });
      legs.push({ geo: new THREE.BoxGeometry(0.06, 2.6, 0.05), matrix: M4().makeTranslation(s * (BW / 2 + 0.035), 1.2, -0.75).multiply(M4().makeRotationX(0.3)), color: WOOD, rough: 0.55, lit: 0.4, wood: 1 });
    }
    legs.push(box(BW + 0.2, 0.05, 0.05, 0, 0.36, -0.1, WOOD, { rough: 0.55, wood: 1 }));
    const lg = propGeometry(THREE, legs); disposables.push(lg);
    const lm = new THREE.Mesh(lg, propMat); lm.frustumCulled = false; board.add(lm);
    // campana de récord: latón, colgada de un brazo en la esquina
    const prof = [[0.0, 0.2], [0.03, 0.2], [0.045, 0.17], [0.06, 0.1], [0.085, 0.035], [0.115, 0.0], [0.12, -0.012]].map(([r, y]) => new THREE.Vector2(r, y));
    const BR = [0.78, 0.55, 0.2];
    const bparts = [
      { geo: new THREE.LatheGeometry(prof, 22), matrix: M4().makeTranslation(0, -0.2, 0), color: BR, rough: 0.24, metal: 1, lit: 0.9 },
      { geo: new THREE.SphereGeometry(0.028, 10, 8), matrix: M4().makeTranslation(0, -0.215, 0), color: BR, rough: 0.3, metal: 1, lit: 0.9 },
      { geo: new THREE.CylinderGeometry(0.004, 0.004, 0.32, 5), matrix: M4().makeTranslation(0, -0.39, 0), color: [0.4, 0.3, 0.17], rough: 0.9, lit: 0.7 },
      { geo: new THREE.TorusGeometry(0.02, 0.005, 6, 10), matrix: M4().makeTranslation(0, 0.02, 0), color: BR, rough: 0.3, metal: 1, lit: 0.9 },
    ];
    const bg = propGeometry(THREE, bparts); disposables.push(bg);
    const bm = new THREE.Mesh(bg, propMat); bm.frustumCulled = false; bell.add(bm);
    bell.position.set(0.5, BH + 0.5, 0.02);
    const arm = propGeometry(THREE, [box(0.3, 0.035, 0.035, 0.36, BH + 0.54, 0.0, STEEL), box(0.035, 0.5, 0.035, 0.22, BH + 0.3, -0.02, STEEL)]); disposables.push(arm);
    const am_ = new THREE.Mesh(arm, propMat); am_.frustumCulled = false;
    const tilt2 = new THREE.Group(); tilt2.position.set(0, 0.42, 0); tilt2.rotation.x = -0.14; tilt2.add(am_); tilt2.add(bell); board.add(tilt2);
  }
  const CHALK = '"Chalkduster", "Bradley Hand", "Marker Felt", "Comic Sans MS", cursive';
  let result = null;       // { rounds, extraM, best, isRecord, cap, workM, restSec }
  let boardKey = '';
  let wod = null;
  function drawBoard(clock) {
    const step = Math.min(40, Math.floor(clock / 0.12));
    const key = `${step}|${result ? result.rounds + '.' + result.extraM + '.' + result.isRecord : 'x'}`;
    if (key === boardKey) return; boardKey = key;
    const g = boardCv.getContext('2d'); const W = 768, H = 1040;
    g.clearRect(0, 0, W, H); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.textAlign = 'center'; g.lineCap = 'round';
    const show = (t0, dur = 0.5) => clamp01((clock - t0) / dur);
    const text = (s, y, px, a, x = W / 2) => { if (a <= 0) return; g.globalAlpha = a; g.font = `${px}px ${CHALK}`; g.fillText(s, x, y); };
    const r = result;
    const capMin = Math.round(((r?.cap ?? wod?.cap ?? 720)) / 60);
    text(`AMRAP ${capMin}'`, 130, 92, show(0.0));
    const wm = r?.workM ?? wod?.workM, rs = r?.restSec ?? wod?.restSec, rm = r?.restM ?? wod?.restM;
    if (wm) text(`${wm} m  +  ${rs ? rs + ' s' : (rm || 0) + ' m'} de trote`, 205, 40, show(0.25));
    g.globalAlpha = show(0.4); g.lineWidth = 5; g.beginPath(); g.moveTo(120, 240); g.lineTo(648, 244); g.stroke();
    if (r) {
      // un palote por ronda, el quinto cruzado
      const n = r.rounds; const gw = 30, gg = 46;
      const groups = Math.ceil(n / 5);
      const totalW = n * gw + (groups - 1) * gg;
      let x = W / 2 - totalW / 2 + gw / 2;
      g.lineWidth = 9;
      for (let i = 0; i < n; i++) {
        const a = show(0.7 + i * 0.16, 0.14);
        if (a > 0) {
          g.globalAlpha = a;
          if (i % 5 === 4) { g.beginPath(); g.moveTo(x - gw * 4.4, 395); g.lineTo(x - gw * 0.2, 300); g.stroke(); x += gg; }
          else { g.beginPath(); g.moveTo(x + (i % 3) * 2 - 2, 290 + (i % 2) * 5); g.lineTo(x + ((i * 7) % 5) - 2, 400 - (i % 3) * 4); g.stroke(); x += gw; }
        } else x += i % 5 === 4 ? gg : gw;
      }
      const t1 = 0.9 + n * 0.16;
      text(`${n} ${n === 1 ? 'RONDA' : 'RONDAS'}`, 560, 118, show(t1));
      if (r.extraM > 0) text(`+ ${r.extraM} m`, 680, 96, show(t1 + 0.4));
      const t2 = t1 + 1.0;
      g.globalAlpha = show(t2); g.lineWidth = 4; g.beginPath(); g.moveTo(150, 760); g.lineTo(618, 757); g.stroke();
      const b = r.best;
      if (r.isRecord) {
        text('¡NUEVO RÉCORD!', 850, 64, show(t2 + 0.3));
        if (b) text(`antes: ${b.rounds} + ${b.extraM} m`, 925, 36, show(t2 + 0.6) * 0.75);
        g.globalAlpha = show(t2 + 0.5); g.lineWidth = 6; g.beginPath(); g.moveTo(140, 872); g.quadraticCurveTo(384, 892, 630, 868); g.stroke();
      } else if (b) {
        text(`récord: ${b.rounds} + ${b.extraM} m`, 850, 46, show(t2 + 0.3));
      } else text('primera vez: ya tienes marca', 850, 38, show(t2 + 0.3));
    } else text('ENTRENO HECHO', 560, 84, show(0.7));
    g.globalAlpha = 1;
    boardTex.needsUpdate = true;
  }

  // ───────────────────────── la cinta curva: en la salida (en la calle de la derecha) y junto a la pizarra ─────────────────────────
  let cinta = null;
  if (kit.cinta) { cinta = new THREE.Mesh(kit.cinta, propMat); cinta.frustumCulled = false; cinta.visible = false; root.add(cinta); }
  const CINTA_W = 7.5;   // metros de nave donde está aparcada al empezar

  const tmpV = new THREE.Vector3();

  // ───────────────────────── estado ─────────────────────────
  let gateW = null, lastS = 0, finClock = 0, finS = null, lastAm = null, shownRound = 1;
  const BOARD_D = 10.5;

  function placeMarks(S, dist) {
    // múltiplos de 50 m contando hacia el pórtico; los tres más cercanos por delante
    let used = 0;
    if (dist != null) {
      for (let d = Math.floor((dist - 6) / 50) * 50; d >= 50 && used < marks.length; d -= 50) {
        const srel = dist - d;
        if (srel > 150) break;
        const dc = marks[used++];
        paintText(dc, String(d), 'M');
        dc.m.visible = true; dc.m.position.z = -srel; dc.m.material.uniforms.uA.value = clamp01(srel / 3) * 0.92;
      }
    }
    for (; used < marks.length; used++) marks[used].m.visible = false;
  }

  return {
    isRecord: () => !!(result && result.isRecord),
    finaleClock: () => finClock,
    update(f, { S, am }) {
      const dt = f.dt;
      lastS = S;
      dust.visible = (ctx.qualityLevel ?? 2) >= 2 && !f.reducedMotion;
      dust.material.uniforms.uSabs.value = S % 34;
      dust.material.uniforms.uPx.value = (ctx.size?.height || 900) * (ctx.size?.dpr || 2) * 0.9;

      if (am && !f.finale) {
        lastAm = am; wod = { cap: am.cap, workM: am.workM, restSec: am.restSec, restM: am.restM };
        const restLeft = am.phase === 'rest' ? (am.phaseLeftM != null ? am.phaseLeftM : (am.phaseLeftSec * am.speed) / 3.6) : null;
        const dEnd = am.phase === 'work' ? am.phaseLeftM : restLeft + am.workM;
        const target = S + dEnd;
        if (gateW == null || Math.abs(target - gateW) > 30) gateW = target;      // ronda nueva (o salto de reloj)
        else gateW = damp(gateW, target, 4, dt);
        const srel = gateW - S;
        portal.visible = srel < 245 && srel > -3;
        portal.position.z = -srel;
        drawClock(am.round, am.capLeft);
        const last = am.capLeft <= 60;
        const gain = 3.2 * (last && !f.reducedMotion ? 0.85 + 0.3 * Math.pow(1 - (am.capLeft % 1), 2) : 1);
        // Un LED a medias compite con el marcador de la app: el reloj de arriba se APAGA en cuanto su borde superior
        // entra bajo la placa (en vertical), y cada marcador lateral antes de que lo corte el borde de la pantalla.
        const pz = portal.position.z + 0.19;
        let kTop = 1;
        if (f.portrait) {
          let lim = 0.33;
          const H = Math.max(1, ctx.hud.height || 0), W = Math.max(1, ctx.hud.width || 0);
          for (const r of ctx.hud.rects || []) if (r.y < H * 0.25 && r.w > W * 0.5) lim = Math.max(lim, (r.y + r.h) / H + 0.015);
          tmpV.set(0, 3.8, pz).project(ctx.camera);
          const top = (1 - tmpV.y) / 2;
          kTop = tmpV.z > 1 ? 0 : clamp01((top - lim) / 0.02);
        }
        const edge = (x) => { tmpV.set(x, 1.5, pz).project(ctx.camera); return tmpV.z > 1 ? 0 : 1 - clamp01((Math.abs(tmpV.x) - 0.9) / 0.07); };
        const kL = edge(-(WING_L + 0.56)), kR = edge(WING_R + 0.92);
        const ease = (u, k) => { u.value = dt > 0 ? damp(u.value, gain * k, 9, dt) : gain * k; };
        ease(clockMat.uniforms.uGain, kTop); ease(wingMatL.uniforms.uGain, kL); ease(wingMatR.uniforms.uGain, kR);
        haloMat.uniforms.uK.value = 0.5 * clockMat.uniforms.uGain.value / 3.2;
        gateLine.m.visible = portal.visible; gateLine.m.position.z = -srel;
        placeMarks(S, am.phase === 'work' ? srel : null);
        if (restLeft != null) {
          startLine.m.visible = restLeft < 150; startLine.m.position.z = -restLeft;
          startDc.m.visible = restLeft < 150 && restLeft > -2; startDc.m.position.z = -(restLeft + 2.4);
          paintText(startDc, String(am.round), 'RONDA');
          startDc.m.material.uniforms.uA.value = 0.92;
        } else { startLine.m.visible = false; startDc.m.visible = false; }
      } else {
        portal.visible = false; gateLine.m.visible = false; startLine.m.visible = false; startDc.m.visible = false; placeMarks(S, null);
        if (!am) gateW = null;
      }

      if (cinta) {
        if (f.finale > 0 && finS != null) { cinta.visible = !f.portrait; cinta.position.set(1.35, 0, -(finS + BOARD_D - 1.9 - S)); cinta.rotation.y = 0.5; }
        else { cinta.visible = S < CINTA_W + 4; cinta.position.set(1.03, 0, -(CINTA_W - S)); cinta.rotation.y = 0; }
      }
      // final: la pizarra aparece clavada en la pista, delante de ti
      if (f.finale > 0) {
        if (finS == null) { finS = S; finClock = 0; boardKey = ''; }
        finClock += dt;
        board.visible = true;
        board.position.z = -(finS + BOARD_D - S);
        drawBoard(finClock);
        boardMat.uniforms.uSpot.value = damp(boardMat.uniforms.uSpot.value, 1, 2.2, dt);
        const rec = result && result.isRecord && finClock > 2.6;
        const sw = rec && !f.reducedMotion ? Math.sin((finClock - 2.6) * 7.5) * 0.55 * Math.exp(-(finClock - 2.6) * 0.45) : 0;
        bell.rotation.z = sw;
      } else {
        finS = null; board.visible = false; boardMat.uniforms.uSpot.value = 0;
      }
    },
    event(type, data = {}) {
      if (type === 'amrapEnd') result = { rounds: data.rounds | 0, extraM: data.extraM | 0, best: data.best || null, isRecord: !!data.isRecord, cap: data.cap, workM: data.workM, restSec: data.restSec, restM: data.restM };
      if (type === 'seek') { gateW = null; }
    },
    /** Plano final: corte a la pizarra, con un acercamiento muy lento. */
    finaleShot(T, s) {
      const zb = -(BOARD_D - (lastS - (finS ?? lastS)));
      const push = s.still ? 0 : 0.35 * (1 - Math.exp(-s.clock * 0.25));
      const d = (s.portrait ? 5.9 : 3.6) - push;
      T.position.set(s.portrait ? 0.1 : 0.5, 1.5, zb + d);
      T.lookAt.set(0.06, s.portrait ? 1.2 : 1.6, zb);
      T.fov = s.portrait ? 46 : 40;
    },
    dispose() { for (const d of disposables) d.dispose?.(); },
  };
}
