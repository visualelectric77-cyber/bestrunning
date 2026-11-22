// BestRunning · escena 3D · cámara cinematográfica (SPEC §15.1): el escenario fija una POSE OBJETIVO y el rig la
// sigue con muelles de amortiguación crítica (sin rebotes ni tirones), más un balanceo de zancada opcional y muy sutil
// (nulo con movimiento reducido). El desplazamiento de lente (`shift`) mueve el encuadre sin girar la cámara: sirve
// para colocar el horizonte / punto de fuga en el hueco libre del HUD (vertical: banda superior; horizontal: mitad
// derecha) sin deformar la perspectiva.
import { springTo } from './util.js';

const CH = 10; // pos(3) look(3) fov roll shiftX shiftY (pares valor/velocidad)
const SCREEN_H = 0.141; // alto útil de la pantalla de un iPhone de 6,1″ (m): escala de la «ventana 3D»
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// VENTANA 3D (laboratorio; tools/holo-lab/README.md). Con «Sigue tu cabeza» y la ventana activadas, la pantalla es un
// cristal de verdad: un plano del mundo a `dist` u de la cámara queda clavado en la pantalla (la lente se descentra con
// tu cabeza), el núcleo pinta un MARCO en ese plano y lo que el escenario deja por delante del cristal pisa el marco y
// parece salirse. Solo actúa en los escenarios que dan su plano (ctx.rig.window.dist > 0); en el resto, y con la
// ventana apagada, la cabeza sigue como siempre (rig.head).
const FRAME_VERT = /* glsl */ `
uniform float uZ;
varying vec2 vN;
void main() { vN = position.xy; gl_Position = vec4(position.xy, uZ, 1.0); }`;
const FRAME_FRAG = /* glsl */ `
uniform vec4 uHole;      // hueco en NDC: izquierda, abajo, derecha, arriba
uniform float uRad, uAspect, uShK;
uniform vec2 uSh[4];     // lo que sale del cristal (un cuadrilátero en NDC, en el sentido de las agujas): da sombra al marco
uniform vec3 uTint;
varying vec2 vN;
float edgeD(vec2 p, vec2 a, vec2 b) { vec2 e = (b - a) * vec2(uAspect, 1.0); return dot((p - a) * vec2(uAspect, 1.0), normalize(vec2(-e.y, e.x) + 1e-6)); }
void main() {
  vec2 c = 0.5 * (uHole.xy + uHole.zw);
  vec2 h = 0.5 * (uHole.zw - uHole.xy) * vec2(uAspect, 1.0);
  vec2 q = abs((vN - c) * vec2(uAspect, 1.0)) - h + uRad;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRad;   // > 0 fuera del hueco
  if (d < 0.0) discard;
  vec3 col = vec3(0.030, 0.032, 0.037) + 0.012 * (vN.y * 0.5 + 0.5);
  col *= 1.0 - 0.45 * exp(-d * 9.0);                                   // el hueco hunde el canto: el marco tiene grosor
  if (uShK > 0.0) {
    // sombra blanda de la pieza que sale, caída hacia abajo a la derecha: sin moverte ya se lee que está por delante
    vec2 p = vN - vec2(0.030, -0.022);
    float sd = max(max(edgeD(p, uSh[0], uSh[1]), edgeD(p, uSh[1], uSh[2])), max(edgeD(p, uSh[2], uSh[3]), edgeD(p, uSh[3], uSh[0])));
    col *= 1.0 - 0.62 * uShK * exp(-max(sd, 0.0) * 13.0);
  }
  col += uTint * 0.045 * exp(-d * 30.0);                               // la luz del mundo se derrama en el canto
  col += (vec3(0.16, 0.17, 0.19) + uTint * 0.16) * (1.0 - smoothstep(0.0, 0.006, d));   // bisel del hueco
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * Fachada de cámara propia de cada escenario (ctx.rig): misma forma que el rig, pero el núcleo solo la aplica mientras
 * su escenario está activo (cargar otro escenario no pisa la cámara del que se ve).
 */
export function createRigFacade(THREE, rig) {
  const f = {
    target: {
      position: new THREE.Vector3(0, 1.6, 0), lookAt: new THREE.Vector3(0, 1.4, -40), fov: 60, roll: 0, shift: new THREE.Vector2(0, 0),
    },
    settle: { position: 1.1, lookAt: 1.1, fov: 1.4, roll: 1.2, shift: 1.2 },
    bobScale: 1,
    snapRequested: true,
    /**
     * Ventana 3D: el escenario que la admite da en cada fotograma `dist` (u de la cámara al cristal; 0 = no la admite),
     * `bottom` (borde inferior del hueco en NDC, −1..1: ahí toca el cristal lo que pisas), `on` (0..1, para retirarla
     * en un plano que no la quiere) y `floorY` (la cámara no baja de esa altura al asomarte). `shadow` (4 puntos NDC
     * x,y en el sentido de las agujas) y `shadowK` (0..1): la pieza que sale del cristal, para su sombra en el marco.
     */
    window: { dist: 0, on: 1, bottom: -0.7, floorY: -1e9, shadowK: 0, shadow: new Float32Array(8) },
    /** ¿Está activada la ventana 3D en Ajustes? (vivo) */
    get windowEnabled() { return rig.window.enabled; },
    /** Peso real de la ventana ahora mismo (0..1): activada × escenario × cara a la vista. */
    get windowWeight() { return rig.window.w; },
    /** Uniforme compartido { value }: profundidad del cristal en gl_FragCoord.z (−1 = sin ventana). Para recortar lo que no debe salirse. */
    get windowDepth() { return rig.window.depth; },
    /** v (mundo) → NDC SIN el desplazamiento de la cabeza; devuelve la distancia a la cámara por su eje (≤ 0: detrás). */
    projectBase(v) { return rig.projectBase(v); },
    get current() { return rig.current; },
    snap() { f.snapRequested = true; },
  };
  return f;
}

/** Vuelca una fachada en el rig real (cada fotograma, antes de rig.update). */
export function applyRigFacade(rig, f) {
  const a = f.target;
  const b = rig.target;
  b.position.copy(a.position);
  b.lookAt.copy(a.lookAt);
  b.fov = Number.isFinite(a.fov) ? a.fov : 60;
  b.roll = Number.isFinite(a.roll) ? a.roll : 0;
  b.shift.copy(a.shift);
  const s = f.settle;
  const r = rig.settle;
  r.position = s.position; r.lookAt = s.lookAt; r.fov = s.fov; r.roll = s.roll; r.shift = s.shift;
  rig.bobScale = Number.isFinite(f.bobScale) ? f.bobScale : 1;
  const w = f.window;
  const rw = rig.window;
  rw.dist = Number.isFinite(w.dist) && w.dist > 0 ? w.dist : 0;
  rw.on = Number.isFinite(w.on) ? clamp01(w.on) : 1;
  rw.bottom = Number.isFinite(w.bottom) ? Math.min(0.2, Math.max(-0.92, w.bottom)) : -0.7;
  rw.floorY = Number.isFinite(w.floorY) ? w.floorY : -1e9;
  rw.shadowK = Number.isFinite(w.shadowK) ? clamp01(w.shadowK) : 0;
  for (let i = 0; i < 4; i++) rw.shadow[i].set(Number(w.shadow[i * 2]) || 0, Number(w.shadow[i * 2 + 1]) || 0);
  if (f.snapRequested) { f.snapRequested = false; rig.snap(); }
}

export function createRig(THREE, camera) {
  const target = {
    position: new THREE.Vector3(0, 1.6, 0),
    lookAt: new THREE.Vector3(0, 1.4, -40),
    fov: 60,
    roll: 0,
    shift: new THREE.Vector2(0, 0),
  };
  // segundos hasta ~98 % del recorrido (muelle crítico) por canal
  const settle = { position: 1.1, lookAt: 1.1, fov: 1.4, roll: 1.2, shift: 1.2 };
  const st = new Float64Array(CH * 2);
  const v = new Float64Array(CH);
  const look = new THREE.Vector3();
  let snapNext = true;
  const baseInv = new THREE.Matrix4();    // vista y proyección SIN la cabeza (composición del escenario)
  const baseProj = new THREE.Matrix4();
  let baseOk = false;
  // marco de la ventana 3D: un triángulo a pantalla completa, a la profundidad del cristal, con el hueco recortado
  const frameGeo = new THREE.BufferGeometry();
  frameGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const frameU = { uZ: { value: 0 }, uHole: { value: new THREE.Vector4(-2, -2, 2, 2) }, uRad: { value: 0 }, uAspect: { value: 1 }, uTint: { value: new THREE.Color(0.2, 0.5, 0.9) }, uShK: { value: 0 },
    uSh: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] } };
  const frame = new THREE.Mesh(frameGeo, new THREE.ShaderMaterial({ uniforms: frameU, vertexShader: FRAME_VERT, fragmentShader: FRAME_FRAG, fog: false, toneMapped: false }));
  frame.name = 'window-frame';
  frame.frustumCulled = false;
  frame.renderOrder = -90;       // tras el cielo, antes que el mundo; escribe profundidad: tapa lo de detrás del cristal
  frame.visible = false;

  const rig = {
    /** Pose objetivo (el escenario la modifica en sitio en cada update o una vez). */
    target,
    /** Tiempos de asentamiento (s). Más alto = más suave/lento. */
    settle,
    /** Multiplicador del balanceo de zancada del núcleo (0 = sin balanceo). 1 u = 1 m ⇒ ~1 cm de rebote. */
    bobScale: 1,
    /**
     * Perspectiva acoplada a la cabeza (scene.setHead; js/player/headpose.js → headCamera): desplazamiento de la cámara
     * en su propio marco (m), giro de la mirada (rad) y distancia de la «ventana» (m): la lente se descentra para que lo
     * que está a `win` m quede quieto en pantalla. Ceros = sin efecto.
     */
    head: { dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, win: 3.2 },
    /**
     * Ventana 3D. enabled: el ajuste (scene.setHeadWindow). px, py, pw: cabeza filtrada (m, ya por su peso) y peso de
     * la cara (el núcleo los pone en cada fotograma). dist, on, bottom, floorY: los da el escenario (fachada). gain: 1 =
     * a escala real de la pantalla; 0,3 ≈ el horizonte se mueve el mismo ángulo que tu cabeza; 0,5 de serie (el usuario
     * la pidió fuerte el 22 nov 2026; sin probar aún en la cinta: scene.setHeadWindow(true, gain) lo cambia). En
     * vertical la cabeza cuenta el 60 %: ahí va el rebote de la zancada que el filtro no quita del todo. w y depth:
     * resultado.
     */
    window: { enabled: false, px: 0, py: 0, pw: 0, dist: 0, on: 1, bottom: -0.7, floorY: -1e9, gain: 0.5, w: 0, depth: { value: -1 }, tint: frameU.uTint.value, shadowK: 0, shadow: frameU.uSh.value },
    /** Malla del marco: el núcleo la añade a la escena. */
    frame,
    /** v (mundo) → NDC sin el desplazamiento de la cabeza (pose del fotograma anterior); devuelve la distancia por el eje. */
    projectBase(v) {
      if (!baseOk) return -1;
      v.applyMatrix4(baseInv);
      const depth = -v.z;
      v.applyMatrix4(baseProj);
      return depth;
    },
    /** Pose actual suavizada (solo lectura). */
    current: { position: new THREE.Vector3(), lookAt: new THREE.Vector3(), fov: 60, roll: 0, shift: new THREE.Vector2() },
    /** Coloca la cámara en la pose objetivo en el próximo fotograma, sin transición (cortes, saltos, cambio de escenario). */
    snap() { snapNext = true; },
    /** Vuelve a la pose por defecto (al cambiar de escenario). */
    reset() {
      target.position.set(0, 1.6, 0);
      target.lookAt.set(0, 1.4, -40);
      target.fov = 60;
      target.roll = 0;
      target.shift.set(0, 0);
      settle.position = 1.1; settle.lookAt = 1.1; settle.fov = 1.4; settle.roll = 1.2; settle.shift = 1.2;
      rig.bobScale = 1;
      rig.window.dist = 0; rig.window.on = 1; rig.window.bottom = -0.7; rig.window.floorY = -1e9; rig.window.shadowK = 0;
      snapNext = true;
    },
    /** Aplica la pose a la cámara. bob = { x, y } en unidades del mundo (ya escalado por bobScale). */
    update(dt, aspect, bobX = 0, bobY = 0) {
      const t = target;
      v[0] = t.position.x; v[1] = t.position.y; v[2] = t.position.z;
      v[3] = t.lookAt.x; v[4] = t.lookAt.y; v[5] = t.lookAt.z;
      v[6] = t.fov; v[7] = t.roll; v[8] = t.shift.x; v[9] = t.shift.y;
      if (snapNext || !(dt > 0)) {
        for (let i = 0; i < CH; i++) { st[i * 2] = v[i]; st[i * 2 + 1] = 0; }
        snapNext = false;
      } else {
        const d = Math.min(dt, 0.1);
        for (let i = 0; i < CH; i++) {
          const s = i < 3 ? settle.position : i < 6 ? settle.lookAt : i === 6 ? settle.fov : i === 7 ? settle.roll : settle.shift;
          springTo(st, i * 2, v[i], s, d);
        }
      }
      const c = rig.current;
      c.position.set(st[0], st[2], st[4]);
      c.lookAt.set(st[6], st[8], st[10]);
      c.fov = Math.min(120, Math.max(10, st[12]));
      c.roll = st[14];
      c.shift.set(st[16], st[18]);
      camera.position.set(c.position.x + bobX, c.position.y + bobY, c.position.z);
      look.copy(c.lookAt);
      look.y += bobY * 0.35; // la mirada acompaña un poco el rebote (sin sensación de cabeceo)
      camera.up.set(0, 1, 0);
      camera.lookAt(look);
      if (c.roll) camera.rotateZ(c.roll);
      camera.updateMatrixWorld();
      baseInv.copy(camera.matrixWorld).invert();
      const hd = rig.head;
      const wn = rig.window;
      const asWindow = wn.enabled && wn.dist > 0;     // este escenario da su cristal: ventana 3D en vez de la cabeza clásica
      let dx = hd.dx;
      let dy = hd.dy;
      let win = hd.win > 0.5 ? hd.win : 3.2;
      if (asWindow) {
        // el cristal mide lo que se ve a `dist` u; tu cabeza se mueve a esa escala (× gain). La cámara no gira ni avanza
        win = Math.max(0.5, wn.dist);
        const g = (wn.gain * 2 * win * Math.tan((c.fov * Math.PI) / 360) * wn.on) / SCREEN_H;
        dx = wn.px * g;
        dy = wn.py * g * 0.6;
        if (dx || dy) {
          camera.translateX(dx);
          camera.translateY(dy);
          if (camera.position.y < wn.floorY) {      // al agacharte, la cámara no se mete en el suelo
            const q = camera.quaternion;
            const upY = Math.max(0.3, 1 - 2 * (q.x * q.x + q.z * q.z));
            const lift = (wn.floorY - camera.position.y) / upY;
            camera.translateY(lift);
            dy += lift;
          }
        }
      } else {
        if (hd.dx || hd.dy || hd.dz) { camera.translateX(hd.dx); camera.translateY(hd.dy); camera.translateZ(hd.dz); }
        if (hd.yaw) camera.rotateY(hd.yaw);
        if (hd.pitch) camera.rotateX(hd.pitch);
      }
      camera.fov = c.fov;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      const e = camera.projectionMatrix.elements;
      baseProj.copy(camera.projectionMatrix);
      baseProj.elements[8] = -c.shift.x;
      baseProj.elements[9] = -c.shift.y;
      baseOk = true;
      e[8] = -(c.shift.x + (e[0] * dx) / win);
      e[9] = -(c.shift.y + (e[5] * dy) / win);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      camera.updateMatrixWorld();
      // marco: entra desde los bordes con el peso de la ventana (cara a la vista × escenario) y se retira igual
      const ww = asWindow ? clamp01(wn.pw) * wn.on : 0;
      wn.w = ww;
      if (ww > 0.002) {
        const k = ww * ww * (3 - 2 * ww);
        const zNdc = (e[10] * -win + e[14]) / win;
        wn.depth.value = zNdc * 0.5 + 0.5;
        const portrait = aspect < 1;
        const mx = portrait ? 0.10 : 0.07;        // márgenes en NDC (la mitad en fracción de pantalla)
        const mt = portrait ? 0.075 : 0.10;
        const out = 1.25;                         // fuera de la pantalla: sin marco
        frameU.uZ.value = zNdc;
        frameU.uHole.value.set(-out + (out - 1 + mx) * k, -out + (out + wn.bottom) * k, out - (out - 1 + mx) * k, out - (out - 1 + mt) * k);
        frameU.uRad.value = 0.06 * k;
        frameU.uAspect.value = aspect;
        frameU.uShK.value = wn.shadowK * k;
        frame.visible = true;
      } else {
        wn.depth.value = -1;
        frame.visible = false;
      }
    },
  };
  return rig;
}
