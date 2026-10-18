// BestRunning · escena 3D · cámara cinematográfica (SPEC §15.1): el escenario fija una POSE OBJETIVO y el rig la
// sigue con muelles de amortiguación crítica (sin rebotes ni tirones), más un balanceo de zancada opcional y muy sutil
// (nulo con movimiento reducido). El desplazamiento de lente (`shift`) mueve el encuadre sin girar la cámara: sirve
// para colocar el horizonte / punto de fuga en el hueco libre del HUD (vertical: banda superior; horizontal: mitad
// derecha) sin deformar la perspectiva.
import { springTo } from './util.js';

const CH = 10; // pos(3) look(3) fov roll shiftX shiftY (pares valor/velocidad)

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

  const rig = {
    /** Pose objetivo (el escenario la modifica en sitio en cada update o una vez). */
    target,
    /** Tiempos de asentamiento (s). Más alto = más suave/lento. */
    settle,
    /** Multiplicador del balanceo de zancada del núcleo (0 = sin balanceo). 1 u = 1 m ⇒ ~1 cm de rebote. */
    bobScale: 1,
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
      camera.fov = c.fov;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      const e = camera.projectionMatrix.elements;
      e[8] = -c.shift.x;
      e[9] = -c.shift.y;
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      camera.updateMatrixWorld();
    },
  };
  return rig;
}
