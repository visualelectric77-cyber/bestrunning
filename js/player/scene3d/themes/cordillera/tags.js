// CORDILLERA · rótulos de retransmisión en 3D (estilo realidad aumentada de F1 TV): placa oscura pequeña con borde
// fino, versalitas con tracking y un filete vertical hasta el punto del mundo al que se refiere. Tamaño constante en
// pantalla, siempre de cara a la cámara y NUNCA detrás del HUD: se proyecta su rectángulo y, si toca un bloque del
// HUD (ctx.hud.rects), se desvanece. Uno por uso (fantasma, hito, cumbre): 1 draw call cada uno.

const FONT = '-apple-system, "SF Pro Text", "SF Pro Display", BlinkMacSystemFont, "Helvetica Neue", system-ui, sans-serif';
const SCALE = 3;          // px de lienzo por px CSS (nítido a DPR 2–3)
const PLATE_H = 22;       // alto de la placa (px CSS)
const POLE_H = 18;        // filete vertical (px CSS)
const FS = 12;            // cuerpo de letra (px CSS)
const INFLATE = 8;        // margen alrededor del HUD (px CSS)

function tracked(ctx, text, track) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + track;
  return w - track;
}
function drawTracked(ctx, text, x, y, track) {
  for (const ch of text) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + track; }
  return x;
}

/**
 * Crea un rótulo. update(text, value, dotColor) redibuja la textura solo si cambia algo.
 * place(pos, camera, size, rects, dt, want) lo coloca (billboard), comprueba el HUD y funde su opacidad.
 */
export function createTag(THREE, { maxAnisotropy = 4, pole = true, flag = false } = {}) {
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAnisotropy;
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0); // ancla abajo en el centro (el punto del filete)
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: true,
    color: new THREE.Color(0.94, 0.94, 0.94), // < umbral del bloom: el texto no "brilla"
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 900;
  mesh.visible = false;
  let key = '';
  let cssW = 40;
  let cssH = PLATE_H + (pole ? POLE_H : 0);
  let alpha = 0;
  let poleX = cssW / 2;     // px CSS desde el borde izquierdo hasta el filete
  const v = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();

  function redraw(text, value, dot) {
    const label = String(text || '').toLocaleUpperCase('es-ES');
    const val = value ? String(value) : '';
    const fs = FS * SCALE;
    const track = 0.14 * fs;
    g.font = `600 ${fs}px ${FONT}`;
    const wl = tracked(g, label, track);
    g.font = `700 ${fs}px ${FONT}`;
    const wv = val ? g.measureText(val).width : 0;
    const padX = 8 * SCALE;
    const dotW = dot ? 11 * SCALE : 0;
    const gap = val ? 7 * SCALE : 0;
    const W = Math.ceil(padX * 2 + dotW + wl + gap + wv);
    const ph = PLATE_H * SCALE;
    const H = Math.ceil(ph + (pole ? POLE_H * SCALE : 0));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; tex.dispose(); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    // placa
    const r = 6 * SCALE;
    g.beginPath();
    if (typeof g.roundRect === 'function') g.roundRect(1, 1, W - 2, ph - 2, r); else g.rect(1, 1, W - 2, ph - 2);
    g.fillStyle = 'rgba(11,13,18,0.86)';
    g.fill();
    g.lineWidth = SCALE * 0.9;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.stroke();
    let x = padX;
    const cy = ph / 2 + 0.5 * SCALE;
    if (dot) {
      g.beginPath();
      g.arc(x + 3 * SCALE, cy - 0.5 * SCALE, 3 * SCALE, 0, Math.PI * 2);
      g.fillStyle = dot;
      g.fill();
      x += dotW;
    }
    g.textBaseline = 'middle';
    g.font = `600 ${fs}px ${FONT}`;
    g.fillStyle = 'rgba(235,235,245,0.82)';
    x = drawTracked(g, label, x, cy, track);
    if (val) {
      g.font = `700 ${fs}px ${FONT}`;
      g.fillStyle = '#ffffff';
      g.fillText(val, x + gap - track * 0, cy);
    }
    if (pole) {
      // filete fino hasta el suelo y un punto en la base (bajo el punto de color si es un banderín)
      const cx = flag && dot ? padX + 3 * SCALE : W / 2;
      poleX = cx / SCALE;
      const grad = g.createLinearGradient(0, ph, 0, H);
      grad.addColorStop(0, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0.2)');
      g.fillStyle = grad;
      g.fillRect(cx - SCALE * 0.5, ph, SCALE, H - ph - 2 * SCALE);
      g.beginPath();
      g.arc(cx, H - 2 * SCALE, 1.6 * SCALE, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.fill();
    }
    tex.needsUpdate = true;
    cssW = W / SCALE;
    cssH = H / SCALE;
    if (!pole) poleX = cssW / 2;
  }

  /** ¿Cabe el rótulo anclado en pos (dentro del encuadre y fuera de todos los bloques del HUD)? Deja la proyección en v. */
  function fitsAt(pos, camera, size, rects) {
    v.copy(pos).project(camera);
    if (v.z > 1 || v.z < -1) return false;
    const W = size.width;
    const H = size.height;
    const sx = (v.x * 0.5 + 0.5) * W;
    const sy = (0.5 - v.y * 0.5) * H;
    const x0 = sx - poleX; const x1 = x0 + cssW; const y0 = sy - cssH; const y1 = sy;
    if (x0 < 6 || x1 > W - 6 || y0 < 6 || y1 > H - 4) return false;
    if (rects) {
      for (let i = 0; i < rects.length; i++) {
        const q = rects[i];
        if (x1 > q.x - INFLATE && x0 < q.x + q.w + INFLATE && y1 > q.y - INFLATE && y0 < q.y + q.h + INFLATE) return false;
      }
    }
    return true;
  }

  return {
    mesh,
    /** ¿Cabría en pos? (para buscar el mejor ancla antes de colocarlo) */
    fits: (pos, camera, size, rects) => fitsAt(pos, camera, size, rects),
    get alpha() { return alpha; },
    update(text, value = '', dot = null) {
      const k = `${text}|${value}|${dot || ''}`;
      if (k === key) return;
      key = k;
      redraw(text, value, dot);
    },
    /**
     * pos: punto del mundo (base del filete) · want: 0..1 visibilidad deseada · rects: HUD (px CSS).
     * Devuelve la opacidad actual.
     */
    place(pos, camera, size, rects, dt, want, lambda = 6) {
      let target = want;
      if (target > 0.001 && !fitsAt(pos, camera, size, rects)) target = 0;
      // entra despacio; si roza el HUD o sale del encuadre, se va rápido
      const lam = target < want ? Math.max(lambda, 12) : lambda;
      alpha += (target - alpha) * (1 - Math.exp(-dt * lam));
      if (alpha < 0.004 && target === 0) alpha = 0;
      mesh.visible = alpha > 0;
      if (!mesh.visible) return alpha;
      mat.opacity = alpha;
      // billboard de tamaño constante en pantalla
      mesh.position.copy(pos);
      mesh.quaternion.copy(camera.quaternion);
      camera.getWorldDirection(fwd);
      const depth = Math.max(0.5, v.copy(pos).sub(camera.position).dot(fwd));
      const worldPerCss = (2 * depth * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, size.height);
      mesh.scale.set(cssW * worldPerCss, cssH * worldPerCss, 1);
      // banderín: el filete (no el centro) cae sobre el punto del mundo
      const off = (cssW / 2 - poleX) * worldPerCss;
      if (off) mesh.position.addScaledVector(right.set(1, 0, 0).applyQuaternion(camera.quaternion), off);
      return alpha;
    },
    hide() { alpha = 0; mesh.visible = false; },
    dispose() { geo.dispose(); mat.dispose(); tex.dispose(); },
  };
}
