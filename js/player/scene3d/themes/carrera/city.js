// CARRERA · la avenida: cielo de ciudad, asfalto (una sola malla con shader: grano, juntas, parches, marcas viales,
// línea azul, pasos de cebra, alfombras de cronometraje y reflejo húmedo de las farolas), fachadas con ventanas
// encendidas (cajas instanciadas), vallas con la lona de RITMUP (una malla), público tras las vallas (siluetas
// instanciadas que aplauden y levantan el móvil) y farolas (fuste, brazo, luminaria y banderola instanciados) con su
// halo en la bruma. Todo en el marco del corredor (ver common.js). 7 llamadas de dibujo.
import {
  DEFINES, SHARED_DECL, BEND, PNOISE, LAMPS, FENCE_X, FENCE_H, CROWD_X, LAMP_X, LAMP_HEAD_X, LAMP_Y, LAMP_P, LAMP_OFF_R,
  BUILD_X,
} from './common.js';

const HEAD = SHARED_DECL + BEND + PNOISE + LAMPS;
export const lin = (THREE, r, g, b) => new THREE.Color().setRGB(r, g, b);

/* ───────────────────────── Cielo: noche de ciudad con la bruma iluminada sobre los tejados ───────────────────────── */

const SKY_VERT = /* glsl */ `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`;
const SKY_FRAG = /* glsl */ `
uniform mat4 uProjInv, uCamWorld;
uniform vec3 uTop, uHaze, uGlow, uGoldCol;
uniform float uGoldK;
varying vec2 vNdc;
NOISE_CHUNK
void main() {
  vec4 p = uProjInv * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize((uCamWorld * vec4(p.xyz / p.w, 0.0)).xyz);
  float el = dir.y;
  vec3 col = mix(uHaze, uTop, smoothstep(0.0, 0.55, el));
  // contaminación lumínica: un velo cálido y liso pegado a los tejados (sin rayos)
  col += uGlow * exp(-max(el, 0.0) * 9.0);
  // nubes bajas apenas iluminadas desde abajo (muy tenues: el cielo es el fondo del número)
  vec2 cp = dir.xz / max(el + 0.18, 0.05) * 1.6;
  float cl = smoothstep(0.45, 0.95, fbm3(cp + vec2(0.0, 0.0)));
  col += uHaze * 0.55 * cl * smoothstep(0.02, 0.2, el) * (1.0 - smoothstep(0.25, 0.7, el));
  col = mix(col, col * uGoldCol * 1.6, uGoldK);
  gl_FragColor = vec4(col, 1.0);
}`;

export function buildSky(THREE, camera, noise) {
  const u = {
    uProjInv: { value: camera.projectionMatrixInverse },
    uCamWorld: { value: camera.matrixWorld },
    uTop: { value: lin(THREE, 0.0009, 0.0011, 0.0022) },
    uHaze: { value: lin(THREE, 0.0068, 0.0058, 0.0058) },
    uGlow: { value: lin(THREE, 0.0105, 0.0072, 0.005) },
    uGoldCol: { value: lin(THREE, 1.0, 0.72, 0.42) },
    uGoldK: { value: 0 },
  };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: u, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG.replace('NOISE_CHUNK', noise), depthWrite: false }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;
  return { mesh, u };
}

/* ───────────────────────── Suelo: asfalto, aceras, marcas, alfombras, reflejo húmedo ───────────────────────── */

const GROUND_VERT = /* glsl */ `
${SHARED_DECL}
${BEND}
varying vec2 vP;
varying vec3 vW;
void main() {
  vP = position.xz;
  vec3 w = bendW(position);
  vW = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const GROUND_FRAG = /* glsl */ `
${HEAD}
uniform vec3 uRoad, uWalk, uCurb, uPaint, uBlue, uMatCol, uSpecCol;
uniform float uSpec, uDetail, uCamH, uWet, uNearSpec;
uniform vec2 uFeel;           // x contraste de las señales cercanas · y separación de las juntas (m)
uniform vec4 uMats;           // z de: SALIDA · META · próximos dos arcos de km (1e5 = ninguno)
varying vec2 vP;
varying vec3 vW;

float band(float d, float hw, float fw) { return 1.0 - smoothstep(hw - fw, hw + fw, d); }

void main() {
  float x = vP.x;
  float z = vP.y;
  float sP = uSLo - z;                 // metros reales (mod 1000, sin costura)
  float ax = abs(x);
  float fwX = max(fwidth(x), 1e-5);
  float fwS = max(fwidth(sP), 1e-5);
  float near = 1.0 - smoothstep(0.03, 0.16, fwS);
  float dist = length(vW - cameraPosition);

  // ── regiones: calzada · bordillo · acera ──
  float road = 1.0 - smoothstep(ROAD_HW - fwX, ROAD_HW + fwX, ax);
  float curb = (1.0 - road) * (1.0 - smoothstep(ROAD_HW + CURB_W - fwX, ROAD_HW + CURB_W + fwX, ax));
  float walk = smoothstep(ROAD_HW + CURB_W - fwX, ROAD_HW + CURB_W + fwX, ax);

  // ── asfalto: manchas grandes, árido, rodaduras pulidas, parches de reparación y juntas ──
  float n1 = pnoise(vec2(x * 0.35, sP * 0.35), 350.0);
  float n2 = pnoise(vec2(x * 2.2, sP * 2.2), 2200.0);
  float g = mix(0.5, pnoise(vec2(x * 13.0, sP * 13.0), 13000.0), near * uDetail);
  float laneC = abs(fract((x + 1.5) / 3.0) - 0.5) * 3.0;          // distancia al centro del carril
  float track = exp(-pow((abs(laneC - 0.0) - 0.85) / 0.28, 2.0)); // rodaduras de los coches
  vec2 pc = floor(vec2((x + 7.5) / 3.0, sP / 9.0));
  float ph = h12(pc + 3.7);
  vec2 pf = fract(vec2((x + 7.5) / 3.0, sP / 9.0));
  float rep = step(0.86, ph) * band(abs(pf.x - 0.5), 0.36, fwX / 3.0) * band(abs(pf.y - 0.5), 0.3 + 0.15 * h12(pc), fwS / 9.0);
  float grainK = 0.16 + 0.12 * clamp(uFeel.x, 0.0, 1.5) * near * uDetail;
  vec3 asph = uRoad * (0.8 + 0.3 * n1 + 0.14 * (n2 - 0.5) + grainK * (g - 0.5)) * (1.0 - 0.1 * track) * (1.0 - 0.22 * rep);
  // juntas transversales (el flujo óptico cercano: sensación de velocidad, contraste uFeel.x)
  float jp = uFeel.y;
  float jd = abs(fract(sP / jp + 0.5 + 0.06 * (n2 - 0.5)) - 0.5) * jp;
  float joint = lineAA(jd, 0.018, fwS) * near * road * clamp(0.25 + 0.55 * uFeel.x, 0.0, 1.1);
  asph *= 1.0 - 0.55 * joint;
  // acera: baldosas de 40 cm con llagas
  vec2 tl = abs(fract(vec2(x, sP) / 0.4) - 0.5) * 0.4;
  float tile = max(lineAA(tl.x, 0.006, fwX), lineAA(tl.y, 0.006, fwS)) * near;
  vec3 walkC = uWalk * (0.86 + 0.2 * n1 + 0.1 * (g - 0.5)) * (1.0 - 0.3 * tile);
  vec3 base = asph * road + uCurb * (0.9 + 0.2 * n2) * curb + walkC * walk;

  // ── marcas viales: discontinuas de carril (3,5 m de cada 10), bordes, línea azul, pasos de cebra ──
  float paint = 0.0;
  float dashS = fract(sP / 10.0);
  float dash = band(abs(dashS - 0.175), 0.175, fwS / 10.0);
  for (int i = 0; i < 4; i++) {
    float lx = -4.5 + 3.0 * float(i);
    paint = max(paint, lineAA(abs(x - lx), 0.075, fwX) * dash);
  }
  paint = max(paint, lineAA(abs(ax - (ROAD_HW - 0.35)), 0.075, fwX));
  float zebra = band(abs(mod(sP, 500.0) - 252.0), 2.0, fwS) * step(abs(fract(x / 1.0) - 0.5), 0.25) * step(ax, ROAD_HW - 0.7);
  paint = max(paint, zebra * 0.9);
  float blue = lineAA(abs(x - BLUE_X), 0.06, fwX) * road;
  // pintura gastada (no plana): el grano la rompe un poco
  float wornP = 0.78 + 0.22 * n2;

  // ── alfombras de cronometraje (SALIDA y META) y líneas de los arcos ──
  float mat = 0.0;
  float line = 0.0;
  for (int i = 0; i < 2; i++) {
    float zm = i == 0 ? uMats.x : uMats.y;
    float dz = z - zm;
    mat = max(mat, band(abs(dz - 1.4), 1.25, fwS) * step(ax, ROAD_HW - 0.2));
    line = max(line, lineAA(abs(dz), 0.09, fwS) * step(ax, ROAD_HW));
  }
  for (int i = 0; i < 2; i++) {
    float zk = i == 0 ? uMats.z : uMats.w;
    line = max(line, lineAA(abs(z - zk), 0.05, fwS) * step(ax, ROAD_HW) * 0.75);
  }
  float rib = 0.75 + 0.25 * step(0.5, fract(sP * 6.0));
  vec3 col = base;
  col = mix(col, uPaint * wornP, paint * road);
  col = mix(col, uBlue * wornP, blue);
  col = mix(col, uMatCol * mix(1.0, rib, near), mat);
  col = mix(col, uPaint, line);

  // ── luz: farolas (difusa), focos de la meta y reflejo húmedo ──
  vec3 P = vec3(x, 0.0, z);
  vec3 N = vec3(0.0, 1.0, 0.0);
  float E = lampsAt(P, N, sP) * uLight;
  float mE = metaLight(P);
  vec3 lampC = uLampCol;
  col *= 0.05 + E * lampC + mE * mix(vec3(1.0, 0.92, 0.8), vec3(1.0, 0.7, 0.36), uGold);

  // agua: charcos (más espejo) sobre un asfalto mojado; las juntas y el árido rompen el reflejo
  float puddle = smoothstep(0.58, 0.78, pnoise(vec2(x * 0.22, sP * 0.22), 220.0)) * road;
  float wet = uWet * (0.55 + 0.45 * puddle) * (1.0 - 0.6 * paint) * (1.0 - 0.5 * mat);
  // rizado del agua: columnas finas a lo largo de la avenida (el reflejo se rompe en vetas verticales, no en manchas)
  float strk = pnoise(vec2(x * 7.0, sP * 0.6), 600.0);
  vec3 Np = normalize(vec3((strk - 0.5) * 0.05 + (n2 - 0.5) * 0.03 + (g - 0.5) * 0.03 * near, 1.0, (g - 0.5) * 0.02 * near));
  vec3 V = normalize(cameraPosition - P);
  float fres = 0.04 + 0.96 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
  float spec = 0.0;
  if (uSpec > 0.0) {
    float sh = mix(320.0, 2200.0, puddle);
    float zr = max(-z, 0.5);
    float f = uCamH / (uCamH + LAMP_Y);
    float dl = zr / f;
    for (int side = 0; side < 2; side++) {
      float sx = side == 0 ? -LAMP_HX : LAMP_HX;
      float off = side == 0 ? 0.0 : LAMP_OFF_R;
      float kc = floor((uSLo + dl - off) / LAMP_P);
      for (int k = -1; k < 2; k++) {
        float sl = (kc + float(k)) * LAMP_P + off;
        vec3 L = vec3(sx, LAMP_Y, -(sl - uSLo));
        vec3 Lv = L - P;
        float d2 = dot(Lv, Lv);
        vec3 H = normalize(Lv * inversesqrt(d2) + V);
        spec += pow(max(dot(Np, H), 0.0), sh) * (sh * 0.003 + 0.6) * 300.0 / (d2 + 500.0);
      }
    }
    // la meta: sus focos también se reflejan en el agua (se ve llegar desde lejos)
    if (uMetaK > 0.0) {
      vec3 L = vec3(0.0, 6.6, uMetaZ + 1.0);
      vec3 Lv = L - P;
      float d2 = dot(Lv, Lv);
      vec3 H = normalize(Lv * inversesqrt(d2) + V);
      spec += pow(max(dot(Np, H), 0.0), sh * 0.5) * (sh * 0.0015 + 0.6) * 1400.0 * uMetaK / (d2 + 900.0);
    }
  }
  col += uSpecCol * lampC * spec * uSpec * wet * mix(0.35, 1.0, fres) * (1.0 - 0.7 * smoothstep(0.2, 0.9, fwS));
  // brillo satinado del asfalto mojado en ángulo rasante: la bruma iluminada de la ciudad
  col += uFogCol * 0.9 * fres * wet;

  // ── niebla ──
  col = mix(col, uFogCol, fogK(dist));
  gl_FragColor = vec4(col, 1.0);
}`;

export function buildGround(THREE, shared) {
  const N = 110;
  const pos = new Float32Array((N + 1) * 2 * 3);
  const idx = [];
  for (let i = 0; i <= N; i++) {
    const z = 40 - 1140 * Math.pow(i / N, 1.7);
    pos.set([-70, 0, z, 70, 0, z], i * 6);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const u = {
    ...shared,
    uRoad: { value: lin(THREE, 0.06, 0.06, 0.064) },
    uWalk: { value: lin(THREE, 0.085, 0.082, 0.078) },
    uCurb: { value: lin(THREE, 0.15, 0.148, 0.142) },
    uPaint: { value: lin(THREE, 0.62, 0.62, 0.6) },
    uBlue: { value: lin(THREE, 0.02, 0.12, 0.62) },
    uMatCol: { value: lin(THREE, 0.012, 0.02, 0.06) },
    uSpecCol: { value: new THREE.Color(1, 1, 1) },
    uSpec: { value: 1 }, uDetail: { value: 1 }, uCamH: { value: 1.7 }, uWet: { value: 1 }, uNearSpec: { value: 1 },
    uFeel: { value: new THREE.Vector2(1, 5) },
    uMats: { value: new THREE.Vector4(1e5, 1e5, 1e5, 1e5) },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, defines: DEFINES });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, u };
}

/* ───────────────────────── Fachadas (cajas instanciadas, ventanas en el shader) ───────────────────────── */

const BUILD_VERT = /* glsl */ `
${SHARED_DECL}
${BEND}
${PNOISE}
attribute vec4 aB;    // x centro (con signo), s base (mod 1000), largo en z, fondo en x
attribute vec4 aB2;   // alto, semilla, tipo (0 primera línea · 1 fondo), alto de planta
varying vec3 vL;      // coordenadas locales en metros (u a lo largo de la fachada, v altura)
varying vec3 vN;
varying vec3 vW;
varying vec3 vP0;
varying float vSeed;
varying float vKind;
varying float vFloorH;
void main() {
  float rel = mod(aB.y - uSLo, 1000.0) - 70.0;
  float cyc = uSHi + floor((uSLo + rel) / 1000.0);
  float hv = aB2.x * (0.72 + 0.56 * h11(aB2.y * 13.1 + cyc * 7.7));
  vec3 size = vec3(aB.w, hv, aB.z);
  vec3 p = vec3(aB.x, 0.0, -rel) + position * size;
  vL = position * size;
  vN = normal;
  vP0 = p;
  vSeed = aB2.y + cyc * 31.0;
  vKind = aB2.z;
  vFloorH = aB2.w;
  vec3 w = bendW(p);
  vW = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const BUILD_FRAG = /* glsl */ `
${HEAD}
uniform vec3 uFacade, uGlass, uWarm, uCool, uShop;
uniform float uLit, uDetail;
varying vec3 vL;
varying vec3 vN;
varying vec3 vW;
varying vec3 vP0;
varying float vSeed;
varying float vKind;
varying float vFloorH;

float boxAA(vec2 q, vec2 hs, vec2 fw) {
  vec2 a = 1.0 - smoothstep(hs - fw, hs + fw, abs(q));
  return a.x * a.y;
}

void main() {
  vec3 N = normalize(vN);
  float side = abs(N.x) > 0.5 ? 1.0 : 0.0;           // cara que mira a la avenida (o a un lateral)
  float top = step(0.5, N.y);
  float u = side > 0.5 ? vL.z : vL.x;
  float v = vL.y;
  float sP = uSLo - vP0.z;
  float dist = length(vW - cameraPosition);
  float fh = vFloorH;
  float colW = mix(1.9, 2.7, h11(vSeed * 1.7));
  vec2 fwq = vec2(fwidth(u), fwidth(v)) + 1e-4;
  float lod = 1.0 - smoothstep(0.25, 0.9, max(fwq.x / colW, fwq.y / fh));  // de lejos, la ventana se promedia
  // ventanas
  float shopH = vKind < 0.5 ? 4.8 : 0.0;
  vec2 cell = vec2(floor(u / colW), floor((v - shopH) / fh));
  vec2 fr = vec2(fract(u / colW), fract((v - shopH) / fh));
  float win = boxAA(fr - vec2(0.5, 0.56), vec2(0.2, 0.25), fwq / vec2(colW, fh));
  float rnd = h12(cell + vec2(vSeed * 3.1, vSeed * 1.3));
  float rowRnd = h12(vec2(cell.y, vSeed));
  float lit = step(rnd, uLit * (0.55 + 0.9 * rowRnd) * mix(1.25, 0.6, smoothstep(8.0, 50.0, v)));
  float tone = h12(cell + 11.0 + vSeed);
  vec3 wc = mix(uWarm, uCool, step(0.72, tone)) * (0.3 + 0.7 * h12(cell + 5.0)) * mix(1.0, 0.5, smoothstep(12.0, 60.0, v));
  float upper = step(shopH + 0.2, v) * (1.0 - top);
  vec3 winC = mix(uGlass, wc, lit);
  float winM = mix(0.42 * (0.35 + uLit), win, lod) * upper * (1.0 - top);
  vec3 winAvg = mix(uGlass, (uWarm + uCool) * 0.3, uLit * 0.6);
  vec3 winCol = mix(winAvg, winC, lod);
  // planta baja: escaparates (algunos encendidos, otros con la persiana bajada)
  float shop = (1.0 - upper) * step(v, shopH) * (1.0 - top) * step(vKind, 0.5);
  vec2 sc = vec2(floor(u / 4.2), 0.0);
  float sr = h12(sc + vSeed * 2.3);
  float sOn = step(0.5, sr);
  float shopHs = max(shopH, 1.0);
  vec2 sfr = vec2(fract(u / 4.2), clamp(v / shopHs, 0.0, 1.0));
  float pane = boxAA(sfr - vec2(0.5, 0.42), vec2(0.43, 0.34), vec2(fwq.x / 4.2, fwq.y / shopHs));
  // interior: más luz abajo (mostradores) y un montante cada 1,4 m
  float mull = 1.0 - 0.7 * lineAA(abs(fract(u / 1.4) - 0.5) * 1.4, 0.03, fwq.x);
  float shT = h12(sc + 21.0);
  vec3 shopTone = shT < 0.6 ? uShop : shT < 0.85 ? uShop.bgr * vec3(0.9, 1.0, 1.25) : uShop * vec3(0.7, 0.85, 1.0);
  vec3 shopIn = shopTone * (0.35 + 0.8 * h12(sc + 9.0)) * mix(1.2, 0.55, sfr.y) * mull;
  vec3 shopC = mix(uFacade * 0.6, shopIn, sOn * pane);
  // fachada: luz de las farolas (las plantas bajas) + un velo de ambiente
  vec3 P = vec3(vP0.x, v, vP0.z);
  float E = lampsAt(P, N, sP) * uLight;
  vec3 fac = uFacade * (0.12 + 0.06 * pnoise(vec2(u * 0.5, v * 0.5), 1e4) + E * uLampCol * 1.7);
  fac *= mix(1.0, 0.55, smoothstep(10.0, 60.0, v));   // las plantas altas, en penumbra
  float slab = lineAA(abs(fract((v - shopH) / fh) - 0.02) * fh, 0.12, fwq.y) * upper * lod;
  fac *= 1.0 + 0.5 * slab;
  vec3 col = fac;
  col = mix(col, winCol, winM);
  col = mix(col, shopC, shop);
  col = mix(col, uFacade * 0.08, top);
  // el fondo (segunda fila): más tenue, se funde con la noche
  col *= mix(1.0, 0.7, vKind);
  col = mix(col, col * vec3(1.15, 0.92, 0.62) * 1.5, uGold * 0.6);
  col = mix(col, uFogCol, fogK(dist));
  gl_FragColor = vec4(col, 1.0);
}`;

export function buildBuildings(THREE, shared, rand) {
  const list = [];
  for (const sgn of [-1, 1]) {
    // primera línea: manzanas de 14–40 m con callejones oscuros entre ellas, en 1000 m exactos
    let s = 0;
    while (s < 1000) {
      let w = 14 + 26 * rand();
      const gap = rand() < 0.22 ? 8 + 8 * rand() : 0.8;
      if (s + w + gap > 1000) w = Math.max(4, 1000 - s - gap);
      const depth = 18 + 10 * rand();
      const set = rand() < 0.25 ? 2.5 * rand() : 0;
      const h = 16 + 34 * Math.pow(rand(), 1.4);
      list.push([sgn * (BUILD_X + set + depth / 2), s + w / 2, w, depth, h, rand() * 100, 0, 3.1 + 0.4 * rand()]);
      s += w + gap;
    }
    // segunda fila: torres del fondo (skyline), más altas y apagadas
    s = 0;
    while (s < 1000) {
      const w = 20 + 40 * rand();
      const gap = 10 + 30 * rand();
      if (s + w > 1000) break;
      const depth = 20 + 20 * rand();
      const h = 35 + 70 * Math.pow(rand(), 1.6);
      list.push([sgn * (BUILD_X + 34 + 30 * rand() + depth / 2), s + w / 2, w, depth, h, rand() * 100, 1, 3.4]);
      s += w + gap;
    }
  }
  const n = list.length;
  const aB = new Float32Array(n * 4);
  const aB2 = new Float32Array(n * 4);
  list.forEach((b, i) => { aB.set(b.slice(0, 4), i * 4); aB2.set(b.slice(4, 8), i * 4); });
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = box.index;
  geo.setAttribute('position', box.attributes.position);
  geo.setAttribute('normal', box.attributes.normal);
  geo.setAttribute('aB', new THREE.InstancedBufferAttribute(aB, 4));
  geo.setAttribute('aB2', new THREE.InstancedBufferAttribute(aB2, 4));
  geo.instanceCount = n;
  const u = {
    ...shared,
    uFacade: { value: lin(THREE, 0.04, 0.039, 0.04) },
    uGlass: { value: lin(THREE, 0.006, 0.007, 0.009) },
    uWarm: { value: lin(THREE, 0.26, 0.15, 0.07) },
    uCool: { value: lin(THREE, 0.12, 0.14, 0.18) },
    uShop: { value: lin(THREE, 0.15, 0.095, 0.05) },
    uLit: { value: 0.24 }, uDetail: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: BUILD_VERT, fragmentShader: BUILD_FRAG, defines: DEFINES });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, u, count: n };
}

/* ───────────────────────── Vallas con la lona de RITMUP (dos tiras en una malla) ───────────────────────── */

const FENCE_VERT = /* glsl */ `
${SHARED_DECL}
${BEND}
attribute float aSide;
varying vec3 vP;
varying vec3 vW;
varying float vSide;
void main() {
  vP = position;
  vSide = aSide;
  vec3 w = bendW(position);
  vW = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const FENCE_FRAG = /* glsl */ `
${HEAD}
uniform sampler2D uMap;
uniform float uCue, uLed, uDetail;
varying vec3 vP;
varying vec3 vW;
varying float vSide;
void main() {
  float sP = uSLo - vP.z;
  float y = vP.y;
  float dist = length(vW - cameraPosition);
  float fwS = max(fwidth(sP), 1e-5);
  float fwY = max(fwidth(y), 1e-5);
  // lona (lee de izquierda a derecha desde la calzada en los dos lados)
  float u = vSide < 0.0 ? sP / 10.0 : -sP / 10.0;
  float v = clamp((y - 0.12) / (FENCE_H - 0.17), 0.0, 1.0);
  vec3 tex = texture2D(uMap, vec2(u, v)).rgb;
  float onBanner = step(0.12, y) * step(y, FENCE_H - 0.05);
  // estructura: postes cada 2,5 m (la señal cercana que da la velocidad), pies y barra superior
  float pd = abs(fract(sP / 2.5 + 0.5) - 0.5) * 2.5;
  float post = lineAA(pd, 0.035, fwS);
  float rail = lineAA(abs(y - (FENCE_H - 0.025)), 0.025, fwY);
  vec3 N = vec3(-sign(vSide), 0.0, 0.0);
  vec3 P = vec3(vP.x, y, vP.z);
  float E = lampsAt(P, N, sP) * uLight + metaLight(P) * 0.8;
  // la luz de las farolas llega desde arriba: la parte alta de la lona algo más iluminada
  E *= 0.75 + 0.35 * smoothstep(0.1, 1.0, y);
  vec3 col = tex * onBanner * (0.03 + 0.6 * E * uLampCol);
  vec3 metal = vec3(0.16) * (0.08 + E * uLampCol);
  col = mix(col, metal * 1.6, rail);
  col = mix(col, metal * (0.4 + 0.6 * clamp(uCue, 0.0, 1.5)), post * (1.0 - rail));
  // filete de LED al pie de la valla con el acento de la zona (emisivo bajo, sin destello)
  float led = lineAA(abs(y - 0.07), 0.018, fwY);
  col += uAccent * led * uLed * exp(-dist * 0.004);
  col = mix(col, col * vec3(1.2, 0.95, 0.65), uGold * 0.5);
  col = mix(col, uFogCol, fogK(dist));
  gl_FragColor = vec4(col, 1.0);
}`;

export function buildFences(THREE, shared, texture) {
  const N = 140;
  const pos = [];
  const side = [];
  const idx = [];
  let base = 0;
  for (const sgn of [-1, 1]) {
    for (let i = 0; i <= N; i++) {
      const z = 30 - 930 * Math.pow(i / N, 1.6);
      pos.push(sgn * FENCE_X, 0, z, sgn * FENCE_X, FENCE_H, z);
      side.push(sgn, sgn);
      if (i < N) {
        const a = base + i * 2;
        // caras hacia la calzada
        if (sgn < 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    base += (N + 1) * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(side), 1));
  geo.setIndex(idx);
  const u = { ...shared, uMap: { value: texture }, uCue: { value: 1 }, uLed: { value: 0.5 }, uDetail: { value: 1 } };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: FENCE_VERT, fragmentShader: FENCE_FRAG, defines: DEFINES });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, u };
}

/* ───────────────────────── Público: siluetas instanciadas tras las vallas ───────────────────────── */

const CROWD_L = 250;
const CROWD_VERT = /* glsl */ `
${SHARED_DECL}
${BEND}
${PNOISE}
${LAMPS}
attribute vec4 aC;    // x (con signo), s base (mod 250), fila, semilla
attribute vec4 aC2;   // alto, ancho de hombros, tinte, fase
uniform float uEnergy, uDens, uMotionK;
varying vec2 vQ;      // metros en el plano de la silueta (x centrado, y desde los pies)
varying float vH;
varying float vSw;
varying float vMode;
varying float vPh;
varying float vLight;
varying float vTint;
varying float vFog;
varying float vDist;
void main() {
  float rel = mod(aC.y - uSLo, ${CROWD_L.toFixed(1)}) - 22.0;
  float cyc = uSHi * 4.0 + floor((uSLo + rel) / ${CROWD_L.toFixed(1)});
  float z = -rel;
  float seed = aC.w + cyc * 17.31;
  // densidad: más público cerca de la SALIDA y, sobre todo, en los últimos metros hacia la META
  float dens = uDens + 0.45 * exp(-abs(z - uStartZ) / 160.0) + 0.6 * exp(-abs(z - uMetaZ) / 380.0) - 0.12 * aC.z;
  float show = step(h11(seed * 1.913), dens);
  float m = h11(seed * 3.77);
  // 0 brazos abajo · 1 aplaude con las manos en alto · 2 graba con el móvil
  float mode = m < 0.09 ? 2.0 : (m < 0.09 + 0.22 * uEnergy ? 1.0 : 0.0);
  vMode = mode;
  vPh = aC2.w + uTime * (1.6 + 0.9 * h11(seed)) * mix(0.35, 1.0, uMotionK) * 6.2832;
  vH = aC2.x;
  vSw = aC2.y;
  vTint = aC2.z;
  float bob = mode > 0.5 && mode < 1.5 ? 0.025 * abs(sin(vPh * 0.5)) * uEnergy * uMotionK : 0.0;
  vec3 c = vec3(aC.x, bob, z);
  vec3 toCam = cameraPosition - c;
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
  float QW = 1.0;
  float QH = vH + 0.45;
  vQ = vec2((position.x - 0.5) * QW, position.y * QH);
  vec3 p = c + right * vQ.x + vec3(0.0, vQ.y, 0.0);
  p *= show;
  float sP = uSLo + rel;
  vec3 N = normalize(vec3(-sign(aC.x), 0.4, 0.0));
  vLight = lampsAt(vec3(c.x, 1.4, c.z), N, sP) * uLight + metaLight(vec3(c.x, 1.4, c.z));
  vec3 w = bendW(p);
  vDist = length(w - cameraPosition);
  vFog = fogK(vDist);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  if (show < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const CROWD_FRAG = /* glsl */ `
${SHARED_DECL}
uniform vec3 uCloth, uCloth2, uBack;
uniform float uEnergy;
varying vec2 vQ;
varying float vH;
varying float vSw;
varying float vMode;
varying float vPh;
varying float vLight;
varying float vTint;
varying float vFog;
varying float vDist;

float sdCap(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a; vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float sdRBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

void main() {
  vec2 q = vQ;
  float H = vH;
  float sh = H - 0.27;                      // línea de hombros
  float d = length((q - vec2(0.0, H - 0.115)) * vec2(1.1, 0.92)) - 0.106;   // cabeza
  d = min(d, sdRBox(q - vec2(0.0, H - 0.24), vec2(0.045, 0.06), 0.02));     // cuello
  // hombros redondeados (una cápsula) y un tronco que se estrecha hacia la cintura
  float hw = vSw * 0.5 - 0.075;
  d = min(d, sdCap(q, vec2(-hw, sh - 0.05), vec2(hw, sh - 0.05), 0.075));
  float taper = mix(0.72, 1.0, smoothstep(sh - 0.7, sh - 0.12, q.y));
  d = min(d, sdRBox(vec2(q.x / taper, q.y - (sh - 0.05) * 0.5), vec2(vSw * 0.38, (sh - 0.05) * 0.5), 0.07));
  vec2 phone = vec2(-9.0);
  // brazos caídos junto al cuerpo (o apoyados en la valla)
  if (vMode < 0.5) {
    for (int i = 0; i < 2; i++) {
      float sg = i == 0 ? -1.0 : 1.0;
      d = min(d, sdCap(q, vec2(sg * (vSw * 0.5 - 0.03), sh - 0.08), vec2(sg * (vSw * 0.5 + 0.0), sh - 0.62), 0.042));
    }
  }
  if (vMode > 1.5) {
    // brazo en alto con el móvil (balanceo lentísimo)
    vec2 sL = vec2(vSw * 0.42, sh - 0.03);
    vec2 hand = vec2(vSw * 0.42 + 0.08 + 0.02 * sin(vPh * 0.15), H + 0.16);
    d = min(d, sdCap(q, sL, mix(sL, hand, 0.5) + vec2(0.06, 0.0), 0.045));
    d = min(d, sdCap(q, mix(sL, hand, 0.5) + vec2(0.06, 0.0), hand, 0.04));
    phone = hand + vec2(0.0, 0.07);
  } else if (vMode > 0.5) {
    // aplausos con las manos sobre la cabeza: se juntan y se separan
    float o = 0.5 + 0.5 * sin(vPh);
    float hx = 0.035 + 0.12 * o * uEnergy;
    float hy = H + 0.2 + 0.04 * o;
    for (int i = 0; i < 2; i++) {
      float sg = i == 0 ? -1.0 : 1.0;
      vec2 s0 = vec2(sg * vSw * 0.42, sh - 0.03);
      vec2 el = vec2(sg * (vSw * 0.5 + 0.06), sh + 0.24);
      vec2 hd = vec2(sg * hx, hy);
      d = min(d, sdCap(q, s0, el, 0.045));
      d = min(d, sdCap(q, el, hd, 0.04));
    }
  }
  float fw = max(fwidth(q.y), 1e-4);
  float a = 1.0 - smoothstep(-fw, fw, d);
  if (a < 0.5) discard;
  // ropa oscura, luz de las farolas desde arriba y un contraluz fino de los escaparates en el borde
  // ropa: abrigos oscuros variados y alguna prenda clara (paleta fija por persona)
  float tt = vTint * 6.0;
  vec3 cloth = tt < 1.0 ? uCloth : tt < 2.0 ? uCloth2 : tt < 3.0 ? vec3(0.02, 0.03, 0.06) : tt < 4.0 ? vec3(0.06, 0.06, 0.065)
    : tt < 5.0 ? vec3(0.025, 0.04, 0.03) : vec3(0.1, 0.095, 0.09);
  float topK = smoothstep(0.2, H, q.y);
  vec3 col = cloth * (0.04 + vLight * uLampCol * (0.35 + 0.65 * topK));
  float rim = 1.0 - smoothstep(0.0, 0.035, -d);
  col += uBack * rim * (1.0 + 0.6 * uGold) * (1.0 - vFog);
  // luz del móvil: constante (nada de destellos)
  vec2 pq = abs(q - phone) - vec2(0.03, 0.048);
  float ph = 1.0 - smoothstep(0.0, fw * 1.5, max(pq.x, pq.y));
  col = mix(col, vec3(0.75, 0.82, 1.0) * 2.6 * exp(-vDist * 0.002), ph);
  col = mix(col, col * vec3(1.2, 1.0, 0.72) * 1.3, uGold * 0.6);
  col = mix(col, uFogCol, vFog);
  gl_FragColor = vec4(col, 1.0);
}`;

export function buildCrowd(THREE, shared, rand) {
  const list = [];
  for (const sgn of [-1, 1]) {
    CROWD_X.forEach((x0, row) => {
      const step = 0.56 + 0.1 * row;
      const n = Math.floor(CROWD_L / step);
      for (let i = 0; i < n; i++) {
        const s = (i + 0.5 * (row % 2) + 0.3 * (rand() - 0.5)) * step;
        const x = sgn * (x0 + 0.18 * (rand() - 0.5));
        list.push({ k: rand(), a: [x, ((s % CROWD_L) + CROWD_L) % CROWD_L, row, rand() * 1000], b: [1.55 + 0.33 * rand(), 0.34 + 0.08 * rand(), rand(), rand() * 6.28] });
      }
    });
  }
  // orden aleatorio: cualquier prefijo es una muestra uniforme (la calidad baja reduce instanceCount)
  list.sort((p, q) => p.k - q.k);
  const n = list.length;
  const aC = new Float32Array(n * 4);
  const aC2 = new Float32Array(n * 4);
  list.forEach((c, i) => { aC.set(c.a, i * 4); aC2.set(c.b, i * 4); });
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('aC', new THREE.InstancedBufferAttribute(aC, 4));
  geo.setAttribute('aC2', new THREE.InstancedBufferAttribute(aC2, 4));
  geo.instanceCount = n;
  const u = {
    ...shared,
    uCloth: { value: lin(THREE, 0.035, 0.037, 0.045) },
    uCloth2: { value: lin(THREE, 0.07, 0.03, 0.03) },
    uBack: { value: lin(THREE, 0.03, 0.022, 0.014) },
    uEnergy: { value: 0.6 }, uDens: { value: 0.66 }, uMotionK: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: CROWD_VERT, fragmentShader: CROWD_FRAG, defines: DEFINES, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, u, count: n };
}

/* ───────────────────────── Farolas: fuste, brazo, luminaria y banderola (instanciadas) ───────────────────────── */

const LAMPS_N = 20; // por lado → 625 m de farolas
const LAMP_VERT = /* glsl */ `
${SHARED_DECL}
${BEND}
${LAMPS}
attribute vec3 aPart;   // x: 0 metal · 1 lente · 2 banderola ; y, z: uv de la banderola
attribute vec2 aL;      // lado (±1), s base
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
varying float vPart;
varying float vAv;
varying float vLit;
void main() {
  float rel = mod(aL.y - uSLo, ${(LAMPS_N * LAMP_P).toFixed(2)}) - 40.0;
  vec3 p = position;
  p.x *= aL.x;
  p.z += -rel;
  vN = normal * vec3(aL.x, 1.0, 1.0);
  vPart = aPart.x;
  vUv = aPart.yz;
  vec3 w = bendW(p);
  vW = w;
  vec4 cl = projectionMatrix * viewMatrix * vec4(w, 1.0);
  gl_Position = cl;
  // composición: la luminaria no brilla de lleno justo detrás del número de velocidad
  vec2 nd = cl.xy / max(cl.w, 1e-3);
  float inside = smoothstep(uAvoid.x - 0.08, uAvoid.x + 0.04, nd.x) * (1.0 - smoothstep(uAvoid.z - 0.04, uAvoid.z + 0.08, nd.x))
    * smoothstep(uAvoid.y - 0.08, uAvoid.y + 0.04, nd.y) * (1.0 - smoothstep(uAvoid.w - 0.04, uAvoid.w + 0.08, nd.y));
  vAv = 1.0 - 0.8 * inside;
  float sP = uSLo + rel;
  vLit = lampsAt(vec3(p.x, p.y, p.z), normalize(vN + vec3(0.0, 0.3, 0.0)), sP) * uLight;
}`;

const LAMP_FRAG = /* glsl */ `
${SHARED_DECL}
${BEND}
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
varying float vPart;
varying float vAv;
varying float vLit;
void main() {
  float dist = length(vW - cameraPosition);
  vec3 col;
  if (vPart > 1.5) {
    // banderola: negro con el símbolo de RITMUP (tres calles blancas y la barra naranja)
    vec2 uv = vUv;
    vec3 ink = vec3(0.012);
    vec2 g = (uv - vec2(0.5, 0.56)) * vec2(1.0, 2.6);
    float bar = step(abs(g.x - 0.12), 0.24) * step(abs(g.y - 0.2), 0.11);
    float sq = 0.0;
    for (int i = 0; i < 3; i++) { float cx = -0.33 + 0.19 * float(i); sq = max(sq, step(abs(g.x - cx), 0.075) * step(abs(g.y + 0.04), 0.075)); }
    col = ink + vec3(0.8, 0.8, 0.8) * sq + vec3(1.0, 0.18, 0.04) * 0.7 * bar;
    col *= 0.06 + 0.5 * vLit * uLampCol;
  } else if (vPart > 0.5) {
    // lente de la luminaria: emisiva (el bloom pone el halo); la bruma la apaga menos que al resto
    // (las cercanas, algo más tenues: su bloom no se convierte en una «luna» en la esquina del encuadre)
    col = uLampCol * 4.2 * uLight * vAv * exp(-dist * 0.0016) * mix(0.3, 1.0, smoothstep(14.0, 70.0, dist));
    col = mix(col, col * vec3(1.15, 0.85, 0.5), uGold * 0.6);
    gl_FragColor = vec4(col, 1.0);
    return;
  } else {
    vec3 N = normalize(vN);
    col = vec3(0.05) * (0.15 + 0.6 * vLit * uLampCol + 0.25 * max(N.y, 0.0));
  }
  col = mix(col, uFogCol, fogK(dist));
  gl_FragColor = vec4(col, 1.0);
}`;

const HALO_VERT = /* glsl */ `
${SHARED_DECL}
${BEND}
attribute vec2 aL;
varying vec2 vUv;
varying float vK;
void main() {
  float rel = mod(aL.y - uSLo, ${(LAMPS_N * LAMP_P).toFixed(2)}) - 40.0;
  vec3 c = bendW(vec3(aL.x * LAMP_HX, LAMP_Y - 0.25, -rel));
  vec4 vc = viewMatrix * vec4(c, 1.0);
  float R = 1.7;
  vc.xy += (position.xy) * R;
  vUv = position.xy;
  vec4 cl = projectionMatrix * vc;
  vec2 nd = cl.xy / max(cl.w, 1e-3);
  float inside = smoothstep(uAvoid.x - 0.1, uAvoid.x + 0.04, nd.x) * (1.0 - smoothstep(uAvoid.z - 0.04, uAvoid.z + 0.1, nd.x))
    * smoothstep(uAvoid.y - 0.1, uAvoid.y + 0.04, nd.y) * (1.0 - smoothstep(uAvoid.w - 0.04, uAvoid.w + 0.1, nd.y));
  float d = length(c - cameraPosition);
  vK = (1.0 - 0.85 * inside) * exp(-d * 0.0035) * smoothstep(8.0, 40.0, d);
  gl_Position = cl;
}`;
const HALO_FRAG = /* glsl */ `
${SHARED_DECL}
varying vec2 vUv;
varying float vK;
void main() {
  float r2 = dot(vUv, vUv);
  float a = exp(-r2 * 5.5) * (1.0 - smoothstep(0.7, 1.0, r2));
  vec3 col = uLampCol * a * 0.06 * vK * uLight;
  col = mix(col, col * vec3(1.15, 0.85, 0.5), uGold * 0.6);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Añade una caja (con normales) a las listas; part = [tipo, u0, v0] (la banderola usa uv propias). */
function pushBox(P, Nn, A, cx, cy, cz, sx, sy, sz, part) {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const faces = [
    [[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]],
    [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]],
    [[0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]]],
    [[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]],
    [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
    [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]],
  ];
  const out = [];
  for (const [n, vs] of faces) {
    const base = P.length / 3;
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    vs.forEach((v, i) => {
      P.push(cx + v[0], cy + v[1], cz + v[2]);
      Nn.push(n[0], n[1], n[2]);
      const pt = typeof part === 'function' ? part(n, i) : part;
      A.push(pt[0], pt[0] === 2 ? uvs[i][0] : 0, pt[0] === 2 ? uvs[i][1] : 0);
    });
    out.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return out;
}

export function buildLamps(THREE, shared) {
  const P = [];
  const Nn = [];
  const A = [];
  const idx = [];
  const add = (...a) => { for (const i of pushBox(P, Nn, A, ...a)) idx.push(i); };
  // fuste en la acera (lado derecho; el izquierdo es su espejo en el shader)
  add(LAMP_X, LAMP_Y / 2, 0, 0.2, LAMP_Y + 0.2, 0.2, [0]);
  add(LAMP_X, 0.45, 0, 0.34, 0.9, 0.34, [0]);
  // brazo hacia la calzada, algo inclinado
  const ax0 = LAMP_HEAD_X + 0.45;
  add((LAMP_X + ax0) / 2, LAMP_Y + 0.18, 0, LAMP_X - ax0, 0.1, 0.12, [0]);
  // luminaria: carcasa plana con la lente hacia abajo
  add(LAMP_HEAD_X, LAMP_Y + 0.06, 0, 1.15, 0.16, 0.42, (n) => (n[1] < -0.5 ? [1] : [0]));
  // banderola de RITMUP en el fuste, perpendicular a la avenida (la ven los corredores)
  add(LAMP_X - 0.55, 4.9, 0, 0.9, 1.7, 0.03, (n) => (Math.abs(n[2]) > 0.5 ? [2] : [0]));
  const lampGeo = new THREE.InstancedBufferGeometry();
  lampGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  lampGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(Nn), 3));
  lampGeo.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(A), 3));
  lampGeo.setIndex(idx);
  const aL = new Float32Array(LAMPS_N * 2 * 2);
  for (let i = 0; i < LAMPS_N; i++) {
    aL.set([-1, i * LAMP_P], i * 4);
    aL.set([1, i * LAMP_P + LAMP_OFF_R], i * 4 + 2);
  }
  const inst = new THREE.InstancedBufferAttribute(aL, 2);
  lampGeo.setAttribute('aL', inst);
  lampGeo.instanceCount = LAMPS_N * 2;
  const u = { ...shared };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: LAMP_VERT, fragmentShader: LAMP_FRAG, defines: DEFINES, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(lampGeo, mat);
  mesh.frustumCulled = false;

  // halo en la bruma (aditivo, una llamada): suave, nunca un destello
  const hGeo = new THREE.InstancedBufferGeometry();
  hGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  hGeo.setIndex([0, 1, 2, 0, 2, 3]);
  hGeo.setAttribute('aL', inst);
  hGeo.instanceCount = LAMPS_N * 2;
  const hMat = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, defines: DEFINES, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(hGeo, hMat);
  halo.frustumCulled = false;
  halo.renderOrder = 30;
  return { mesh, halo, u };
}
