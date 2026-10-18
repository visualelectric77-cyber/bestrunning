// BestRunning · escenario AURORA · rótulos de retransmisión en la escena ("KM 3", "MITAD", "MEJOR MARCA").
// Mismo lenguaje que los "bugs" del HUD (§16): placa oscura #0b0d12 al 86 %, borde de 1 px, radio 8, barra de color de
// 3 px a la izquierda, etiqueta en versalitas con tracking (12 px CSS) y valor en cifras redondeadas (16 px CSS).
// Tamaño CONSTANTE en pantalla y a resolución nativa: el lienzo se dibuja a px CSS × DPR y el plano se coloca, ajustado
// a píxel de dispositivo, en el espacio de la cámara ⇒ nítido como el HUD, nunca 6–8 px ilegibles por la perspectiva.
// Cada rótulo sigue un ancla del mundo (la línea del km en el río, la cabeza del fantasma…) y se coloca en el primer
// hueco libre alrededor (derecha, izquierda o encima), nunca encima del HUD (setHudRects solo como composición).
// Brillo por debajo del umbral del bloom: sin halos.

const PLATE = 'rgba(11, 13, 18, 0.86)';
const EDGE = 'rgba(255, 255, 255, 0.10)';
const LBL = 'rgba(235, 235, 245, 0.74)';
const DEPTH = 10; // u delante de la cámara (sin prueba de profundidad: la distancia solo fija la escala)

export function createTags(ctx) {
  const { THREE } = ctx;
  const FONT = ctx.fonts?.ui || '-apple-system, system-ui, sans-serif';
  const FONT_NUM = ctx.fonts?.rounded || FONT;
  const tags = [];
  const tmp = new THREE.Vector3();

  function spaced(c, text, sp) {
    let w = 0;
    for (const ch of text) w += c.measureText(ch).width + sp;
    return text.length ? w - sp : 0;
  }
  function drawSpaced(c, text, x, y, sp) {
    for (const ch of text) { c.fillText(ch, x, y); x += c.measureText(ch).width + sp; }
  }

  function make() {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0, color: new THREE.Color(0.84, 0.84, 0.84),
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.visible = false;
    mesh.renderOrder = 20;
    mesh.frustumCulled = false;
    ctx.cameraRoot.add(mesh);
    const t = { mesh, canvas, tex, mat, kLabel: null, kValue: null, kColor: null, kDpr: 0, w: 0, h: 0, dpr: 0, alpha: 0, label: '', value: '', color: '#ffffff', gap: 8 };
    tags.push(t);
    return t;
  }

  /** Redibuja el lienzo si cambia el texto, el color o la densidad de píxeles. */
  function render(t, dpr) {
    // sin cadenas nuevas por fotograma: se comparan los campos con los del último dibujo
    if (t.kLabel === t.label && t.kValue === t.value && t.kColor === t.color && t.kDpr === dpr) return;
    t.kLabel = t.label;
    t.kValue = t.value;
    t.kColor = t.color;
    t.kDpr = dpr;
    const c = t.canvas.getContext('2d');
    const fl = `700 12px ${FONT}`;
    const fv = `700 16px ${FONT_NUM}`;
    c.font = fl;
    const lbl = t.label.toLocaleUpperCase('es-ES');
    const lw = spaced(c, lbl, 1.7);
    c.font = fv;
    const vw = t.value ? c.measureText(t.value).width : 0;
    const w = Math.ceil(3 + 10 + lw + (t.value ? 8 + vw : 0) + 11);
    const h = 30;
    const W = Math.ceil(w * dpr);
    const H = Math.ceil(h * dpr);
    if (t.canvas.width !== W || t.canvas.height !== H) {
      t.canvas.width = W;
      t.canvas.height = H;
      t.tex.dispose(); // otro tamaño: la GPU reserva de nuevo al usarse
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const r = 8;
    c.beginPath();
    if (typeof c.roundRect === 'function') c.roundRect(0.5, 0.5, w - 1, h - 1, r); else c.rect(0.5, 0.5, w - 1, h - 1);
    c.fillStyle = PLATE;
    c.fill();
    c.strokeStyle = EDGE;
    c.lineWidth = 1;
    c.stroke();
    c.save();
    c.clip();
    c.fillStyle = t.color;
    c.fillRect(0, 0, 3, h);
    c.restore();
    c.textBaseline = 'alphabetic';
    const base = h / 2 + 5.5;
    c.font = fl;
    c.fillStyle = LBL;
    drawSpaced(c, lbl, 13, base - 0.5, 1.7);
    if (t.value) {
      c.font = fv;
      c.fillStyle = '#ffffff';
      c.fillText(t.value, 13 + lw + 8, base);
    }
    t.w = w;
    t.h = h;
    t.dpr = dpr;
    t.tex.needsUpdate = true;
  }

  /** ¿El rectángulo (px CSS) pisa el HUD o se sale de la zona segura? */
  function blocked(x, y, w, h, W, H, m) {
    if (x < 14 || y < H * 0.075 || x + w > W - 14 || y + h > H - H * 0.04) return true;
    for (const q of ctx.hud.rects) {
      if (x + w > q.x - m && x < q.x + q.w + m && y + h > q.y - m && y < q.y + q.h + m) return true;
    }
    return false;
  }

  return {
    create(label, value = '', color = '#ffffff') {
      const t = make();
      t.label = label;
      t.value = value;
      t.color = color;
      return t;
    },
    set(t, label, value = '', color = t.color) { t.label = label; t.value = String(value ?? ''); t.color = color; },
    /**
     * Coloca el rótulo junto al punto del mundo `anchor` (Vector3) con visibilidad objetivo `want` (0..1) y lo funde
     * (k = factor de suavizado del fotograma). Devuelve la opacidad actual.
     */
    place(t, anchor, want, k, f) {
      const W = Math.max(1, f.width);
      const H = Math.max(1, f.height);
      const dpr = f.dpr || 1;
      let ok = false;
      let x = 0;
      let y = 0;
      if (want > 0.001) {
        render(t, dpr);
        tmp.copy(anchor).project(ctx.camera);
        if (tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2) {
          const sx = (tmp.x * 0.5 + 0.5) * W;
          const sy = (0.5 - tmp.y * 0.5) * H;
          // huecos candidatos: a la derecha del ancla, a la izquierda y encima (centrado, cada vez más alto: en
          // horizontal el hueco entre el número y la columna es estrecho y el rótulo flota sobre la línea)
          for (let c = 0; c < 11; c++) {
            const up = c < 2 ? 0 : ((c - 2) / 3) | 0;      // 0, 1, 2 → cada vez más alto
            const al = c < 2 ? 0 : (c - 2) % 3;             // centrado, desplazado a la derecha, a la izquierda
            const cx = c === 0 ? sx + 10 : c === 1 ? sx - 10 - t.w : sx - t.w / 2 + (al === 1 ? t.w * 0.4 : al === 2 ? -t.w * 0.4 : 0);
            const cy = c < 2 ? sy - t.h + 2 : sy - t.h - 10 - up * 26;
            if (!blocked(cx, cy, t.w, t.h, W, H, t.gap)) { ok = true; x = cx; y = cy; break; }
          }
        }
      }
      t.alpha += ((ok ? want : 0) - t.alpha) * k;
      if (t.alpha < 0.01 && !ok) { t.alpha = 0; t.mesh.visible = false; return 0; }
      if (ok) {
        // ajuste a píxel de dispositivo ⇒ texto 1:1, nítido
        x = Math.round(x * dpr) / dpr;
        y = Math.round(y * dpr) / dpr;
        const e = ctx.camera.projectionMatrix.elements;
        const ndcX = ((x + t.w / 2) / W) * 2 - 1;
        const ndcY = 1 - ((y + t.h / 2) / H) * 2;
        t.mesh.position.set(((ndcX + e[8]) * DEPTH) / e[0], ((ndcY + e[9]) * DEPTH) / e[5], -DEPTH);
        t.mesh.scale.set((t.w / W) * 2 * DEPTH / e[0], (t.h / H) * 2 * DEPTH / e[5], 1);
      }
      t.mesh.visible = true;
      t.mat.opacity = t.alpha;
      return t.alpha;
    },
    hide(t) { t.alpha = 0; t.mesh.visible = false; },
    dispose() {
      for (const t of tags) { t.mesh.geometry.dispose(); t.mat.dispose(); t.tex.dispose(); }
      tags.length = 0;
    },
  };
}
