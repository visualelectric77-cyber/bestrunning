// BestRunning · escena 3D · luces de tu récord · ADAPTADOR DEL CAMINO por escenario.
// Lee (al enganchar, sin tocar el escenario) los uniformes con los que CADA escenario dibuja su camino y reproduce
// EXACTAMENTE su geometría: por dónde va el camino, la altura del suelo y la coordenada del suelo bajo la cámara
// (para clavar los LED al suelo que se ve pasar). Copia de tools/ghost-lab/path.js sin la parte del corredor.
//
//   const path = createPath(THREE);
//   path.bind(theme)            // theme = { id, inst, ctx } → true si lo reconoce
//   path.update(F)              // una vez por fotograma (tras la actualización del escenario y de la cámara)
//   path.head                   // { d, lat, ok } cabeza del fantasma del escenario (lat: carril del hilo en aurora)
//   path.g, path.v              // coordenada del suelo bajo la cámara (u) y su velocidad (u/s, por diferencias)
//   path.point(d, lat, out)     // punto del camino a d u por delante de la cámara y lat u a la derecha →
//                               //   out = { x, y, z, fx, fz (adelante horizontal), slope (dy/dd) }
//
// Cómo dibuja cada escenario su camino (y qué se replica aquí):
//  · aurora     (themes/aurora.js · river.js): x = riverX(d) + lat, y = 0, z = −d; el río avanza a S·flowK
//               (flowK = 0,5 con movimiento reducido). riverX(d, uBend, uSm) es la MISMA función que usa el shader.
//  · cordillera (themes/cordillera.js · profile.js): worldAt(s, x) = (x + bendAt(s) − uBendCam, (R(s) − uRcam)·uExag
//               + uYOff, −(s − S)); la cota R(s) se interpola de la MISMA tabla (textura uProf) que el terreno; la S de
//               la cámara del escenario es f.S + uGhost.z (desfase de la rampa de «No puedo más»).
//  · estadio    (themes/estadio.js · estadio/track.js): σ = uSigCam (m reales, comprimidos); el mundo es el grupo
//               'estadio-world' que el escenario recoloca cada fotograma (tu trayectoria en el origen mirando a −z).
//  · blank      (themes/blank.js, «Grafito»): suelo plano que avanza a S.
import { riverX } from '../themes/aurora/common.js';
import { bendAt } from '../themes/cordillera/profile.js';
import { pathPoint, relS, RC, LANE_W } from '../themes/estadio/track.js';

/** Busca en el árbol del escenario el primer material cuyos uniformes contengan todas las claves (solo al enganchar). */
function findMaterial(root, keys) {
  let hit = null;
  root.traverse((o) => {
    if (hit) return;
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (m?.uniforms && keys.every((k) => k in m.uniforms)) { hit = { mesh: o, material: m, u: m.uniforms }; return; }
    }
  });
  return hit;
}

export function createPath(THREE) {
  const head = { d: -1, lat: 0, ok: false };
  const tmpV = new THREE.Vector3();
  const sp = { x: 0, z: 0, tx: 1, tz: 0 };
  const st = { id: null, g: 0, gPrev: 0, v: 0, first: true, flowK: 1, S: 0, sig: 0, sigW: 0 };
  let A = null;   // adaptador activo

  /* ───── aurora ───── */
  function auroraAdapter(theme) {
    const hit = findMaterial(theme.ctx.root, ['uGhost', 'uBend', 'uSm']);
    if (!hit) return null;
    const u = hit.u;
    return {
      id: 'aurora',
      update(F) {
        st.flowK = F.reducedMotion ? 0.5 : 1;
        st.g = F.S * st.flowK;
        const gh = u.uGhost.value;
        head.d = gh.y; head.lat = gh.x;
      },
      point(d, lat, out) {
        const b = u.uBend.value; const sm = u.uSm.value;
        out.x = riverX(d, b, sm) + lat; out.y = 0; out.z = -d;
        const dx = (riverX(d + 0.25, b, sm) - riverX(d - 0.25, b, sm)) / 0.5;
        const l = Math.hypot(dx, 1);
        out.fx = dx / l; out.fz = -1 / l; out.slope = 0;
        return out;
      },
    };
  }

  /* ───── cordillera ───── */
  function cordilleraAdapter(theme) {
    const hit = findMaterial(theme.ctx.root, ['uProf', 'uProfInfo', 'uBendCam', 'uRcam', 'uGhost', 'uAnchor']);
    if (!hit) return null;
    const U = hit.u;
    /** Cota de la cresta: interpola la MISMA tabla que el shader (cordillera/profile.js · R). */
    function R(s) {
      const tex = U.uProf.value;
      const data = tex?.image?.data;
      const info = U.uProfInfo.value;
      if (!data) return 0;
      const count = info.z;
      let k = (s - info.x) / info.y;
      if (k < 0) k = 0;
      if (k > count - 1.001) k = count - 1.001;
      const i = Math.floor(k);
      const f = k - i;
      return data[i * 2] + (data[i * 2 + 2] - data[i * 2]) * f;
    }
    const y = (s) => (R(s) - U.uRcam.value) * U.uExag.value + U.uYOff.value;
    return {
      id: 'cordillera',
      update(F) {
        // S de la cámara del escenario: f.S + el desfase de la rampa de «No puedo más» (lo publica en uGhost.z)
        st.S = F.S + (Number.isFinite(U.uGhost.value.z) ? U.uGhost.value.z : 0);
        st.g = st.S;
        head.d = U.uGhost.value.x + U.uAnchor.value - st.S; head.lat = 0;
      },
      point(d, lat, out) {
        const s = st.S + d;
        const bc = U.uBendCam.value;
        out.x = lat + bendAt(s) - bc; out.y = y(s); out.z = -d;
        const dx = (bendAt(s + 0.5) - bendAt(s - 0.5));
        const l = Math.hypot(dx, 1);
        out.fx = dx / l; out.fz = -1 / l;
        out.slope = (y(s + 1.5) - y(s - 1.5)) / 3;
        return out;
      },
    };
  }

  /* ───── estadio ───── */
  function estadioAdapter(theme) {
    const hit = findMaterial(theme.ctx.root, ['uSigCam', 'uGhost', 'uLaneCam']);
    const world = theme.ctx.root.getObjectByName('estadio-world');
    if (!hit || !world) return null;
    const G = hit.u;
    const LANE = LANE_W * 0.5 - RC;      // calle 1 (centro a 0,61 m del bordillo) respecto a tu trayectoria (calle 2)
    return {
      id: 'estadio',
      update() {
        const w = G.uSigCam.value;
        if (st.first) st.sig = w; else st.sig += relS(w, st.sigW);
        st.sigW = w;
        st.g = st.sig;
        world.updateMatrixWorld();
        head.d = G.uGhost.value.x; head.lat = LANE;
      },
      point(d, lat, out) {
        pathPoint(st.sigW + d, RC + lat, sp);
        tmpV.set(sp.x, 0, sp.z).applyMatrix4(world.matrixWorld);
        out.x = tmpV.x; out.y = 0; out.z = tmpV.z;
        // tangente: girada por la rotación (solo en y) del grupo del mundo
        const a = world.rotation.y;
        const c = Math.cos(a); const s = Math.sin(a);
        out.fx = sp.tx * c + sp.tz * s; out.fz = -sp.tx * s + sp.tz * c; out.slope = 0;
        return out;
      },
    };
  }

  /* ───── blank (Grafito) ───── */
  function blankAdapter(theme) {
    const hit = findMaterial(theme.ctx.root, ['uGhostZ', 'uGhostA', 'uS']);
    if (!hit) return null;
    const u = hit.u;
    return {
      id: 'blank',
      update(F) {
        st.g = F.S;
        head.d = -u.uGhostZ.value; head.lat = 0;
      },
      point(d, lat, out) { out.x = lat; out.y = 0; out.z = -d; out.fx = 0; out.fz = -1; out.slope = 0; return out; },
    };
  }

  const FACTORY = { aurora: auroraAdapter, cordillera: cordilleraAdapter, estadio: estadioAdapter, blank: blankAdapter };

  return {
    head,
    get id() { return A?.id ?? null; },
    get ok() { return !!A; },
    get g() { return st.g; },
    get v() { return st.v; },
    get flowK() { return st.flowK; },
    /** Engancha el adaptador del escenario activo. Devuelve false si el escenario no tiene camino reconocible. */
    bind(theme) {
      A = null;
      st.first = true;
      st.v = 0;
      st.flowK = 1;
      head.ok = false;
      if (!theme?.ctx?.root) return false;
      const f = FACTORY[theme.id];
      try { A = f ? f(theme) : null; } catch { A = null; }
      return !!A;
    },
    unbind() { A = null; head.ok = false; },
    /** Una vez por fotograma. Devuelve true si hubo un salto (seek/cambio): el llamador debe recolocar sin rampas. */
    update(F) {
      if (!A) { head.ok = false; return false; }
      A.update(F);
      head.ok = Number.isFinite(head.d);
      const dt = F.dt > 0 ? F.dt : 0;
      let jump = st.first;
      if (!st.first && dt > 0) {
        const dg = st.g - st.gPrev;
        // salto de reloj (seek) o del recorrido: más de 3 s a 30 u/s
        if (Math.abs(dg) > 90 || dg < -1e-6) jump = true;
        else st.v += ((dg / dt) - st.v) * (st.v === 0 ? 1 : Math.min(1, dt * 30));
      } else if (st.first) st.v = 0;
      st.first = false;
      st.gPrev = st.g;
      return jump;
    },
    point(d, lat, out) { return A ? A.point(d, lat, out) : null; },
  };
}
