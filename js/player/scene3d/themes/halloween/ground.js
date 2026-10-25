// NOCHE DE HALLOWEEN · suelo: un único plano en el marco del corredor con shader. Camino de tierra húmeda (bordes
// irregulares, dos rodadas encharcadas, charcos que reflejan la luna y las velas), cunetas con hojarasca y hojas
// sueltas de color óxido, y bosque oscuro a los lados. Todo se desplaza a tu velocidad REAL: el grano de la tierra,
// las hojas y los charcos están anclados a la distancia recorrida (S mod 512, texturas periódicas).
// Luz: ambiente morado, charco cálido de cada calabaza (las 2 más cercanas por lado, con su color de vela y el
// encendido en cadena) y su reflejo en lo mojado; reflejo de la luna en los charcos. Niebla de distancia + baja.
// Sensación de velocidad (ctx.speedFeel): contraste del grano, las piedrecitas y las hojas cercanas (uFeel.x).
import { COMMON_GLSL } from './common.js';

const GROUND_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const GROUND_FRAG = /* glsl */ `
uniform vec3 uDirt, uMud, uVerge, uLeafA, uLeafB, uSkyRef;
uniform vec2 uFeel;           // x contraste de las señales cercanas, y -
uniform float uDetail, uLight;
varying vec3 vW;
NOISE_CHUNK
COMMON_CHUNK

// luz de una calabaza (ranura j, lado side) sobre el punto p: difusa (charco de luz) y especular (lo mojado)
void pumpkinLight(float j, float side, vec3 p, vec3 V, vec3 N, float gloss, inout vec3 dif, inout vec3 spe) {
  float srel; float lat; float size; float seed;
  pumpkinSlot(j, side, srel, lat, size, seed);
  float br; vec3 zc = candleAt(srel, br);
  vec3 P = vec3(lat + bendX(srel), 0.26 * size / 0.45, -srel);
  vec3 L = P - p;
  float d2 = dot(L, L);
  float d = sqrt(d2);
  vec3 lc = candleTint(zc) * br * flick(seed) * (size / 0.45);
  float fall = 1.0 / (1.0 + d2 * 1.6) * (1.0 - smoothstep(2.5, 5.5, d));
  dif += lc * fall * 0.55;
  vec3 H = normalize(L / max(d, 1e-3) + V);
  spe += lc * pow(max(dot(N, H), 0.0), gloss) * (1.0 - smoothstep(3.0, 9.0, d)) * 0.9;
}

void main() {
  float srel = -vW.z;
  float r = vW.x - bendX(srel);
  float sa = srel + uSlot.w;                     // metros recorridos (mod 512): ancla de las texturas
  vec3 toCam = vW - cameraPosition;
  float dist = length(toCam);
  vec3 V = -toCam / max(dist, 1e-3);
  float fwS = fwidth(sa) + 1e-5;
  float fwR = fwidth(r) + 1e-5;
  float near = 1.0 - smoothstep(0.012, 0.06, max(fwS, fwR));   // detalle fino solo donde hay píxeles
  float mid = 1.0 - smoothstep(0.08, 0.5, max(fwS, fwR));
  float ar = abs(r);

  // ── forma del camino: borde irregular que serpentea un poco ──
  float wob = (vnoiseP(vec2(sa * 0.125, 3.0), 64.0) - 0.5) * 0.5 + (vnoiseP(vec2(sa * 1.0, r * 1.3), 512.0) - 0.5) * 0.22 * mid;
  float pw = 1.28 + wob;
  float pathM = 1.0 - smoothstep(pw - 0.22, pw + 0.28, ar);

  // ── tierra: manchas grandes, grano y piedrecitas (cerca) ──
  float n1 = vnoiseP(vec2(sa * 0.25, r * 0.4), 128.0);
  float n2 = vnoiseP(vec2(sa * 2.0, r * 2.0), 1024.0);
  float grit = mix(0.5, vnoiseP(vec2(sa * 16.0, r * 16.0), 8192.0), near * uDetail);
  float cue = clamp(uFeel.x, 0.0, 1.5);
  vec3 dirt = uDirt * (0.78 + 0.32 * n1 + 0.28 * (n2 - 0.5) + (0.22 + 0.16 * cue) * (grit - 0.5));
  // piedrecitas claras (flujo óptico cercano): celdas de 25 cm
  vec2 pc = vec2(sa * 4.0, r * 4.0);
  vec2 pid = floor(pc);
  pid.x = mod(pid.x, 2048.0);
  float ph = hash12(pid + 9.0);
  vec2 po = fract(pc) - 0.5 - 0.3 * (vec2(hash12(pid + 1.3), hash12(pid + 5.1)) - 0.5);
  float peb = (1.0 - smoothstep(0.09, 0.16, length(po))) * step(0.78, ph) * near * uDetail * pathM;
  dirt = mix(dirt, uDirt * 2.1, peb * (0.35 + 0.35 * cue));

  // ── rodadas y charcos (lo mojado brilla) ──
  float rut = exp(-pow((ar - 0.55) / 0.17, 2.0)) * (0.55 + 0.45 * n1);
  float pn = vnoiseP(vec2(sa * 0.25, r * 0.8 + 7.0), 128.0) * 0.65 + vnoiseP(vec2(sa * 1.0, r * 2.2 + 1.0), 512.0) * 0.35;
  float pud = smoothstep(0.63, 0.69, pn + 0.14 * rut) * pathM;
  float wet = clamp(0.3 + 0.45 * rut + pud, 0.0, 1.0) * pathM;
  vec3 path = mix(dirt, uMud, 0.4 * rut + 0.45 * pud);

  // ── cunetas: hojarasca oscura con hojas sueltas color óxido (se acumulan junto al borde) ──
  float vn = vnoiseP(vec2(sa * 0.5, r * 0.5 + 3.0), 256.0);
  vec3 verge = uVerge * (0.7 + 0.5 * vn + 0.25 * (n2 - 0.5));
  vec2 lc = vec2(sa * 3.0, r * 3.0);
  vec2 lid = floor(lc);
  vec2 lfr = fract(lc);
  lid.x = mod(lid.x, 1536.0);
  float lh = hash12(lid + 21.0);
  vec2 lo = lfr - 0.5 - 0.35 * (vec2(hash12(lid + 2.7), hash12(lid + 8.3)) - 0.5);
  float ang = lh * 6.2831;
  vec2 lr = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * lo;
  float edgeK = exp(-pow((ar - pw - 0.4) / 0.9, 2.0)) + 0.35;
  float leaf = (1.0 - smoothstep(0.1, 0.17, length(lr * vec2(1.0, 1.9)))) * step(1.0 - 0.5 * edgeK, lh) * mid;
  verge = mix(verge, mix(uLeafA, uLeafB, hash12(lid + 4.4)), leaf * (0.55 + 0.3 * cue));
  vec3 base = mix(verge, path, pathM);
  // las hojas también caen sobre el camino, más sueltas
  base = mix(base, mix(uLeafA, uLeafB, hash12(lid + 4.4)) * 0.8, leaf * pathM * 0.35 * step(0.82, lh));

  // ── normal (ondulación de lo mojado) y luz ──
  vec2 rip = vec2(vnoiseP(vec2(sa * 4.0, r * 6.0), 2048.0), vnoiseP(vec2(sa * 4.0 + 3.0, r * 6.0 + 5.0), 2048.0)) - 0.5;
  rip += (vec2(vnoiseP(vec2(sa * 16.0, r * 16.0 + 2.0), 8192.0), vnoiseP(vec2(sa * 16.0 + 7.0, r * 16.0), 8192.0)) - 0.5) * 0.5 * mid;
  vec3 N = normalize(vec3(rip.x * 0.075 * (1.0 - pud * 0.85), 1.0, rip.y * 0.075 * (1.0 - pud * 0.85)));
  vec3 col = base * (uAmb * 9.0 * uLight + uMoonCol * 0.06 * max(dot(N, uMoonDir), 0.0));
  float gloss = mix(40.0, 900.0, pud);
  vec3 dif = vec3(0.0); vec3 spe = vec3(0.0);
  float jx = (srel - uSlot.y) / uSlot.z;
  float jL = floor(jx + 0.5);
  pumpkinLight(jL, -1.0, vW, V, N, gloss, dif, spe);
  pumpkinLight(jL + (jx + 0.5 - jL > 0.5 ? 1.0 : -1.0), -1.0, vW, V, N, gloss, dif, spe);
  float jxR = jx - 0.5;
  float jR = floor(jxR + 0.5);
  pumpkinLight(jR, 1.0, vW, V, N, gloss, dif, spe);
  pumpkinLight(jR + (jxR + 0.5 - jR > 0.5 ? 1.0 : -1.0), 1.0, vW, V, N, gloss, dif, spe);
  col += base * dif * 4.0;
  float fres = 0.03 + 0.97 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  col += spe * wet * (0.2 + 0.8 * fres) * (0.55 + 0.45 * pud + 0.3 * rut);
  // reflejos de lo mojado: el cielo violeta en rasante y la luna en los charcos
  vec3 Rr = reflect(-V, N);
  float mz = max(dot(Rr, uMoonDir), 0.0);
  col += (uSkyRef * fres + uMoonCol * (pow(mz, 1600.0) * 1.6 + pow(mz, 90.0) * 0.06) * fres * 3.0) * wet;

  col = applyFog(col, vW, V, dist, srel, r);
  gl_FragColor = vec4(col, 1.0);
}`;

export function createGround(ctx, shared) {
  const { THREE } = ctx;
  const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b);
  const u = {
    ...shared,
    uDirt: { value: lin(0.05, 0.036, 0.03) },
    uMud: { value: lin(0.022, 0.016, 0.016) },
    uVerge: { value: lin(0.022, 0.016, 0.017) },
    uLeafA: { value: lin(0.12, 0.04, 0.012) },
    uLeafB: { value: lin(0.065, 0.032, 0.018) },
    uSkyRef: { value: lin(0.03, 0.019, 0.05) },
    uFeel: { value: new THREE.Vector2(1, 1) },
    uDetail: { value: 1 },
    uLight: { value: 1 },
  };
  // plano en XZ del marco del corredor: de 30 m por detrás a 2 km por delante
  const geo = new THREE.PlaneGeometry(2400, 2030, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -985);
  const mat = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: GROUND_VERT,
    fragmentShader: GROUND_FRAG.replace('NOISE_CHUNK', ctx.shaders.NOISE).replace('COMMON_CHUNK', COMMON_GLSL),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'halloween-ground';
  return { mesh, u };
}
