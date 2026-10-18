// HYPERTRACK · texturas de texto nítidas con canvas 2D.
// Formato de canal: fondo negro opaco, R = trazo nítido, G = halo difuso. Los shaders tiñen con el color de la zona y
// suman en modo aditivo (el negro no aporta nada), así evitamos problemas de alfa premultiplicado.

export const FONT_DISPLAY = 'ui-rounded, "SF Pro Rounded", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Helvetica Neue", system-ui, sans-serif';

const nf1 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** 13 → '13,0' (coma decimal es-ES). */
export const fmtSpeed = (v) => nf1.format(Number(v) || 0);
/** 90 → '1:30' · 30 → '0:30'. */
export const fmtClock = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Dibuja líneas de texto centradas. lines: [{ text, size, weight, y (0..1), track (px), alpha }]
 * Devuelve el canvas (reutilizable si se pasa `canvas`).
 */
export function drawLabel(lines, { w = 1024, h = 512, canvas = null, glow = 26 } = {}) {
  const c = canvas || makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 1) halo en G
  ctx.globalCompositeOperation = 'lighter';
  for (const L of lines) {
    if (!L.text) continue;
    setFont(ctx, L);
    // halo acotado: nunca debe llegar a los bordes del lienzo (si no, se ve el rectángulo del plano)
    const maxBlur = Math.min(c.width, c.height) * 0.035;
    ctx.shadowColor = 'rgba(0,255,0,1)';
    ctx.shadowBlur = Math.min(maxBlur * 0.5, glow * 0.5 * (L.size / 160));
    ctx.fillStyle = `rgba(0,${Math.round(170 * (L.alpha ?? 1))},0,1)`;
    fillTracked(ctx, L.text, c.width / 2, L.y * c.height, L.track || 0);
    ctx.shadowBlur = Math.min(maxBlur, glow * (L.size / 160));
    fillTracked(ctx, L.text, c.width / 2, L.y * c.height, L.track || 0);
  }
  // 2) trazo nítido en R (o en B para las líneas del color secundario: `alt: true`)
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  for (const L of lines) {
    if (!L.text) continue;
    setFont(ctx, L);
    const v = Math.round(255 * (L.alpha ?? 1));
    ctx.fillStyle = L.alt ? `rgba(0,0,${v},1)` : `rgba(${v},0,0,1)`;
    fillTracked(ctx, L.text, c.width / 2, L.y * c.height, L.track || 0);
  }
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

function setFont(ctx, L) {
  ctx.font = `${L.weight || 800} ${Math.round(L.size)}px ${L.font || FONT_DISPLAY}`;
}

function fillTracked(ctx, text, x, y, track) {
  if (!track) { ctx.fillText(text, x, y); return; }
  const chars = [...text];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + track * (chars.length - 1);
  let cx = x - total / 2;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  chars.forEach((ch, i) => { ctx.fillText(ch, cx, y); cx += widths[i] + track; });
  ctx.textAlign = prev;
}

/** CanvasTexture con mipmaps y anisotropía (nítida de lejos, sin parpadeo). */
export function canvasTexture(THREE, canvas, renderer) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace; // canales de datos (R/G), no color
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  tex.needsUpdate = true;
  return tex;
}

/** Flecha ▲/▼ en los canales R (trazo) y G (halo) del canvas de etiqueta. */
export function drawArrow(ctx, cx, cy, size, up) {
  const s = size;
  const path = () => {
    ctx.beginPath();
    if (up) { ctx.moveTo(cx, cy - s * 0.6); ctx.lineTo(cx + s * 0.55, cy + s * 0.4); ctx.lineTo(cx - s * 0.55, cy + s * 0.4); }
    else { ctx.moveTo(cx, cy + s * 0.6); ctx.lineTo(cx + s * 0.55, cy - s * 0.4); ctx.lineTo(cx - s * 0.55, cy - s * 0.4); }
    ctx.closePath();
  };
  ctx.shadowColor = 'rgba(0,255,0,1)';
  ctx.shadowBlur = s * 0.35;
  ctx.fillStyle = 'rgba(0,200,0,1)';
  path(); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(255,0,0,1)';
  path(); ctx.fill();
}
