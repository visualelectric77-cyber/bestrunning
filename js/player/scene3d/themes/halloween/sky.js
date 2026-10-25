// NOCHE DE HALLOWEEN · cielo (un triángulo a pantalla completa en el plano lejano, la última pieza opaca): noche negra
// y morada, una luna llena enorme y anaranjada saliendo tras las colinas, jirones de nube con el borde plateado, pocas
// estrellas, colinas lejanas en la bruma, la línea del bosque y, sobre una loma, la casa encantada en silueta con una
// ventana iluminada. De vez en cuando una bandada lejana de murciélagos cruza despacio por delante de la luna (diminuta,
// sin sustos). Todo en ángulos (azimut con el rumbo del camino, elevación), colocado por el escenario según el HUD.
// Una sola llamada de dibujo.

const SKY_VERT = /* glsl */ `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

const SKY_FRAG = /* glsl */ `
uniform mat4 uProjInv, uCamWorld;
uniform vec3 uTop, uHaze, uHill, uWood, uHouseCol, uCloud, uWin, uMoonC;
uniform vec4 uMoon;      // x azimut, y elevación, z radio (rad), w intensidad
uniform vec4 uMoonS;     // disco en pantalla: x, y (NDC), z radio (NDC vertical), w aspecto (ancho / alto)
uniform vec3 uMoonV;     // dirección de la luna (marco del corredor)
uniform vec3 uFogCol;    // niebla del suelo (la base de las colinas se funde con ella)
uniform vec4 uHouse;     // x azimut, y base (elevación), z escala (rad por unidad), w ventana
uniform vec4 uBats;      // x avance 0..1, y opacidad, z aleteo (0 = quietos), w -
uniform float uHeading, uTime, uDetail;
varying vec2 vNdc;
NOISE_CHUNK

float box(vec2 p, vec2 a, vec2 b) { vec2 c = (a + b) * 0.5; vec2 h = (b - a) * 0.5; vec2 d = abs(p - c) - h; return max(d.x, d.y); }
// triángulo con base [x0, x1] en y = y0 y vértice en (ax, ay)
float tri(vec2 p, float x0, float x1, float y0, float ax, float ay) {
  float t = clamp((p.y - y0) / (ay - y0), 0.0, 1.0);
  float l = mix(x0, ax, t); float r = mix(x1, ax, t);
  return max(max(l - p.x, p.x - r), max(y0 - p.y, p.y - ay));
}
// silueta de la casa encantada (unidades de casa; 0 en la base): cuerpo, tejado a dos aguas, torre con aguja, chimenea
float houseD(vec2 p) {
  float d = box(p, vec2(-1.25, -0.2), vec2(0.95, 1.25));
  d = min(d, tri(p, -1.45, 1.1, 1.2, -0.2, 2.05));
  d = min(d, box(p, vec2(0.95, -0.2), vec2(1.55, 2.05)));
  d = min(d, tri(p, 0.82, 1.68, 2.0, 1.25, 3.15));
  d = min(d, box(p, vec2(-0.95, 1.4), vec2(-0.72, 2.15)));
  d = min(d, box(p, vec2(1.22, 3.0), vec2(1.28, 3.35)));    // veleta
  return d;
}

void main() {
  vec4 pp = uProjInv * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize((uCamWorld * vec4(pp.xyz / pp.w, 0.0)).xyz);
  float el = asin(clamp(dir.y, -1.0, 1.0));
  float az = atan(dir.x, -dir.z) + uHeading;
  float ce = cos(el);
  float pw = max(fwidth(el), 1e-5);                       // tamaño del píxel en radianes

  // ── degradado: negro morado arriba, bruma violeta en el horizonte ──
  vec3 col = mix(uHaze, uTop, 1.0 - exp(-max(el + 0.004, 0.0) / 0.075));
  col += uHaze * 0.12 * exp(-max(el, 0.0) / 0.5);   // un resto de bruma muy alto: la noche no es un negro plano

  // ── luna: halo cálido en la bruma (ángulo real a la luna) ──
  float md = acos(clamp(dot(dir, uMoonV), -1.0, 1.0));
  float R = uMoon.z;
  col += uMoonC * uMoon.w * (0.06 * exp(-max(md - R, 0.0) / (R * 0.9)) + 0.022 * exp(-md / (R * 4.5)));
  col += uMoonC * uMoon.w * 0.016 * exp(-abs(az - uMoon.x) / 0.55) * exp(-max(el, 0.0) / 0.06);

  // ── estrellas: pocas, tenues, lejos de la luna y del horizonte ──
  if (el > 0.07 && uDetail > 0.5) {
    vec2 g = vec2(az * 120.0, el * 120.0);
    vec2 id = floor(g);
    float hs = hash12(id + 11.0);
    if (hs > 0.972) {
      vec2 sp = id + 0.2 + 0.6 * vec2(hash12(id + 3.1), hash12(id + 7.7));
      float d = length((g - sp) / 120.0) / pw;
      float tw = 0.75 + 0.25 * sin(uTime * (0.6 + 2.0 * hash12(id)) + hs * 50.0);
      float a = (1.0 - smoothstep(0.35, 1.1, d)) * smoothstep(0.07, 0.25, el) * smoothstep(R * 2.5, R * 6.0, md);
      col += vec3(0.55, 0.52, 0.7) * 0.16 * a * tw * (hs - 0.972) / 0.028;
    }
  }

  // ── disco de la luna, redondo en pantalla (sin la deformación del gran angular): oscurecimiento del borde, mares,
  //    más roja abajo (está baja: mucha atmósfera) ──
  vec2 q = vec2((vNdc.x - uMoonS.x) * uMoonS.w, vNdc.y - uMoonS.y) / max(uMoonS.z, 1e-4);
  float qd = length(q);
  if (qd < 1.1) {
    float limb = sqrt(1.0 - clamp(qd * qd, 0.0, 1.0));
    float mare = fbm3(q * 2.1 + 4.0);
    float mare2 = vnoise(q * 7.0 + 1.3);
    vec3 surf = uMoonC * uMoon.w * (0.62 + 0.38 * limb) * (1.0 - 0.3 * smoothstep(0.42, 0.68, mare) - 0.08 * mare2);
    surf *= mix(vec3(1.0, 0.8, 0.6), vec3(1.0), smoothstep(-0.9, 0.5, q.y));
    float fq = fwidth(qd);
    float a = 1.0 - smoothstep(1.0 - fq, 1.0 + fq, qd);
    col = mix(col, surf, a);
  }

  // ── jirones de nube que cruzan despacio (borde plateado junto a la luna) ──
  if (uDetail > 0.5) {
    float cn = fbm3(vec2(az * 2.6 + uTime * 0.0022, el * 16.0 + 3.0));
    float cd = smoothstep(0.5, 0.74, cn) * smoothstep(0.005, 0.05, el) * (1.0 - smoothstep(0.2, 0.42, el));
    vec3 cc = uCloud + uMoonC * uMoon.w * (0.28 * exp(-md / (R * 1.5)) + 0.04 * exp(-md / (R * 5.0)));
    col = mix(col, cc, cd * 0.82);
  }

  // ── bandada de murciélagos: siluetas diminutas que cruzan por delante de la luna ──
  if (uBats.y > 0.002) {
    float fAz = uMoon.x + R * (6.0 - 12.0 * uBats.x);
    float fEl = uMoon.y + R * (0.32 + 0.14 * sin(uBats.x * 7.0));
    if (abs(az - fAz) < R * 3.0 && abs(el - fEl) < R * 1.6) {
      float bs = R * 0.085;
      float m = 0.0;
      for (int i = 0; i < 7; i++) {
        float fi = float(i);
        vec2 off = vec2(hash11(fi * 3.1 + 1.0) - 0.5, hash11(fi * 7.3 + 2.0) - 0.5) * vec2(R * 3.2, R * 0.6);
        off.y += sin(uTime * 1.3 + fi * 2.1) * R * 0.05;
        float sz = bs * (0.7 + 0.5 * hash11(fi * 5.9));
        vec2 q = vec2((az - fAz - off.x) * ce, el - fEl - off.y) / sz;
        if (abs(q.x) < 1.2 && abs(q.y) < 1.2) {
          float w = uBats.z > 0.0 ? sin(uTime * 13.0 + fi * 1.7) : 0.4;
          float ax = abs(q.x);
          float top = 0.12 + 0.42 * w * ax;
          float bot = top - 0.34 * (1.0 - ax) - 0.1 + 0.09 * abs(sin(ax * 9.0));
          float dw = max(max(q.y - top, bot - q.y), max(ax - 1.0, 0.12 - ax));
          float db = length(q * vec2(1.7, 1.0)) - 0.26;
          float d = min(dw, db) * sz / pw;
          m = max(m, 1.0 - smoothstep(-0.6, 0.6, d));
        }
      }
      col = mix(col, uCloud * 0.6, m * uBats.y);
    }
  }

  // ── colinas lejanas (bruma) y loma de la casa ──
  float hAz = (az - uHouse.x) * ce;
  float hill = 0.006 + 0.009 * vnoise(vec2(az * 2.2, 1.0)) + 0.005 * vnoise(vec2(az * 7.0, 4.0));
  hill += 0.016 * exp(-pow(hAz / 0.07, 2.0));
  float hm = 1.0 - smoothstep(-pw, pw, el - hill);
  vec3 hillC = mix(uHaze, uHill, 0.62) + uMoonC * uMoon.w * 0.012 * exp(-abs(az - uMoon.x) / 0.3);
  col = mix(col, hillC, hm);

  // ── la casa encantada en silueta, con una ventana encendida (y otra en penumbra) ──
  vec2 hp = vec2(hAz, el - uHouse.y) / uHouse.z;
  if (abs(hp.x) < 4.0 && hp.y > -1.0 && hp.y < 4.5) {
    float d = houseD(hp) * uHouse.z / pw;
    float a = 1.0 - smoothstep(-0.7, 0.7, d);
    col = mix(col, uHouseCol, a);
    float w1 = box(hp, vec2(1.13, 1.32), vec2(1.37, 1.66));
    float w2 = box(hp, vec2(-0.7, 0.42), vec2(-0.42, 0.78));
    float flick = 0.88 + 0.12 * sin(uTime * 2.3) * sin(uTime * 0.7 + 1.0);
    float l1 = (1.0 - smoothstep(-0.6, 0.6, w1 * uHouse.z / pw)) * uHouse.w * flick;
    float l2 = (1.0 - smoothstep(-0.6, 0.6, w2 * uHouse.z / pw)) * uHouse.w * 0.22;
    col += uWin * (l1 + l2) * a;
    col += uWin * uHouse.w * 0.05 * exp(-length(hp - vec2(1.25, 1.5)) / 0.9);   // halo tibio de la ventana
  }

  // ── línea del bosque: copas desnudas, recortadas, más oscuras que las colinas (se abre bajo la casa) ──
  float wood = 0.0022 + 0.0035 * vnoise(vec2(az * 30.0, 2.0)) + 0.004 * pow(vnoise(vec2(az * 140.0, 6.0)), 3.0);
  wood *= smoothstep(0.03, 0.09, abs(hAz));
  float wm = 1.0 - smoothstep(-pw, pw, el - wood);
  col = mix(col, mix(uHaze, uWood, 0.85), wm);

  // bruma al pie de las colinas: se funde con la niebla del suelo lejano (sin una raya en el horizonte)
  float mzv = max(dot(dir, uMoonV), 0.0);
  vec3 mist = uFogCol + uMoonC * (0.014 * pow(mzv, 6.0) + 0.03 * pow(mzv, 40.0));
  col = mix(col, mist, exp(-max(el, 0.0) / 0.006) * 0.92);
  col = mix(col, mist, 1.0 - smoothstep(-0.004, 0.0, el));
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky(ctx, shared) {
  const { THREE, camera } = ctx;
  const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b);
  const u = {
    uProjInv: { value: camera.projectionMatrixInverse },
    uCamWorld: { value: camera.matrixWorld },
    uTop: { value: lin(0.0012, 0.0007, 0.0028) },
    uHaze: { value: lin(0.03, 0.019, 0.05) },
    uHill: { value: lin(0.006, 0.004, 0.011) },
    uWood: { value: lin(0.0025, 0.0018, 0.0045) },
    uHouseCol: { value: lin(0.002, 0.0014, 0.0035) },
    uCloud: { value: lin(0.012, 0.007, 0.02) },
    uWin: { value: lin(1.6, 0.72, 0.16) },
    uMoonC: { value: lin(1.0, 0.46, 0.13) },
    uMoon: { value: new THREE.Vector4(0.2, 0.0, 0.06, 1) },
    uMoonS: { value: new THREE.Vector4(0.5, 0, 0.1, 0.46) },
    uMoonV: { value: new THREE.Vector3(0, 0, -1) },
    uFogCol: shared.uFogCol,
    uHouse: { value: new THREE.Vector4(0, 0.006, 0.01, 1) },
    uBats: { value: new THREE.Vector4(0, 0, 1, 0) },
    uHeading: { value: 0 },
    uTime: { value: 0 },
    uDetail: { value: 1 },
  };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG.replace('NOISE_CHUNK', ctx.shaders.NOISE), depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000; // el último de los opacos: solo pinta lo que nada tapa
  mesh.name = 'halloween-sky';
  return { mesh, u };
}
