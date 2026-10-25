// CARRERA · gráficos de canvas 2D: la lona de las vallas (negro con el logotipo de RITMUP en blanco, el símbolo de las
// calles de pista con su barra naranja #FF5A1F y la prueba del día) y el atlas de las pancartas de los arcos (SALIDA,
// KM n, MITAD, ÚLTIMO KM, META). El logotipo es el vectorial de la marca (docs/brand-ritmup/final), no una fuente.
// Cada textura se dibuja una vez; el atlas solo redibuja la fila de un arco cuando ese arco cambia (una vez por km).

const UI = '-apple-system, "SF Pro Display", "SF Pro Text", BlinkMacSystemFont, "Helvetica Neue", system-ui, sans-serif';
export const ORANGE = '#FF5A1F';

// logotipo RITMUP (viewBox 0 −1,4 462 102,8) y símbolo (viewBox 113,67 × 32): tres calles blancas + barra naranja
const WORDMARK = [
  ['0 0', 'M0 0H17V100H0ZM8.5 0H36C58.46 0 66 6.66 66 26.5C66 46.34 58.46 53 36 53H8.5ZM17 14.5V38.5H31.5C44.42 38.5 48 35.9 48 26.5C48 17.1 44.42 14.5 31.5 14.5ZM31 45.03L51.5 45.03L72.5 100L52 100Z'],
  ['85.5 0', 'M0 0H17V100H0Z'],
  ['113.5 0', 'M0 0H64V14.5H0ZM23.5 0H40.5V100H23.5Z'],
  ['184.5 0', 'M0 0H16.5V100H0ZM81.5 0H98V100H81.5ZM0 0L15 0L49 75.56L83 0L98 0L53 100L45 100Z'],
  ['297.5 0', 'M0 0H17.5V50C17.5 79.2 22.61 86.9 42 86.9C61.39 86.9 66.5 79.2 66.5 50V0H84V50C84 88.48 73.44 101.4 42 101.4C10.56 101.4 0 88.48 0 50Z'],
  ['395 0', 'M0 0H17V100H0ZM8.5 0H36C59.21 0 67 7.04 67 28C67 48.96 59.21 56 36 56H8.5ZM17 14.5V41.5H31.5C45.21 41.5 49 38.57 49 28C49 17.43 45.21 14.5 31.5 14.5Z'],
];
const MARK_WHITE = 'M0.8 16H15.2A0.8 0.8 0 0 1 16 16.8V31.2A0.8 0.8 0 0 1 15.2 32H0.8A0.8 0.8 0 0 1 0 31.2V16.8A0.8 0.8 0 0 1 0.8 16ZM21.8 16H36.2A0.8 0.8 0 0 1 37 16.8V31.2A0.8 0.8 0 0 1 36.2 32H21.8A0.8 0.8 0 0 1 21 31.2V16.8A0.8 0.8 0 0 1 21.8 16ZM42.8 16H57.2A0.8 0.8 0 0 1 58 16.8V31.2A0.8 0.8 0 0 1 57.2 32H42.8A0.8 0.8 0 0 1 42 31.2V16.8A0.8 0.8 0 0 1 42.8 16Z';
const MARK_ORANGE = 'M63.8 0H112.87A0.8 0.8 0 0 1 113.67 0.8V15.2A0.8 0.8 0 0 1 112.87 16H63.8A0.8 0.8 0 0 1 63 15.2V0.8A0.8 0.8 0 0 1 63.8 0Z';

let paths = null;
function brandPaths() {
  if (paths) return paths;
  paths = { word: WORDMARK.map(([tr, d]) => { const [x, y] = tr.split(' ').map(Number); return { x, y, p: new Path2D(d) }; }), mw: new Path2D(MARK_WHITE), mo: new Path2D(MARK_ORANGE) };
  return paths;
}

/** Logotipo con su símbolo delante, de alto `h` px, empezando en (x, yTop). Devuelve el ancho dibujado. */
export function drawLockup(ctx, x, yTop, h, white = '#ffffff', measureOnly = false) {
  const P = brandPaths();
  const sm = h / 32 * 0.78;          // el símbolo, algo más bajo que las letras
  const markW = 113.67 * sm;
  const gap = h * 0.42;
  const sw = h / 100;
  const total = markW + gap + 462 * sw;
  if (measureOnly) return total;
  ctx.save();
  ctx.translate(x, yTop + (h - 32 * sm) / 2);
  ctx.scale(sm, sm);
  ctx.fillStyle = white; ctx.fill(P.mw);
  ctx.fillStyle = ORANGE; ctx.fill(P.mo);
  ctx.restore();
  ctx.save();
  ctx.translate(x + markW + gap, yTop + 1.4 * sw);
  ctx.scale(sw, sw);
  ctx.fillStyle = white;
  for (const w of P.word) { ctx.save(); ctx.translate(w.x, w.y); ctx.fill(w.p); ctx.restore(); }
  ctx.restore();
  return total;
}

function tracked(ctx, text, x, y, track, align = 'center') {
  const chars = [...String(text)];
  let total = 0;
  for (const ch of chars) total += ctx.measureText(ch).width;
  total += track * Math.max(0, chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  ctx.textAlign = 'left';
  for (const ch of chars) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + track; }
  return total;
}
function measure(ctx, text, track) {
  let t = 0;
  const chars = [...String(text)];
  for (const ch of chars) t += ctx.measureText(ch).width;
  return t + track * Math.max(0, chars.length - 1);
}

function canvasTex(THREE, c, aniso) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = aniso;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/**
 * Lona de valla: 10 m de valla (cuatro paneles de 2,5 m) en 2048 × 224 px. Mitad A: el logotipo; mitad B: la prueba
 * («CARRERA 10K») en naranja o, sin carrera, el logotipo otra vez. Filete naranja abajo.
 */
export function fenceBannerTexture(THREE, aniso, raceLabel) {
  const W = 2048;
  const H = 224;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, W, H);
  // costuras sutiles de los paneles (la valla las marca más fuerte en el shader)
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (let i = 1; i < 4; i++) ctx.fillRect(i * (W / 4) - 1, 0, 2, H);
  const half = W / 2;
  const lh = 74;
  const lw = drawLockup(ctx, 0, 0, lh, '#fff', true);
  drawLockup(ctx, half / 2 - lw / 2, H * 0.44 - lh / 2, lh, '#f2f2f2');
  if (raceLabel) {
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ORANGE;
    ctx.font = `800 92px ${UI}`;
    const txt = String(raceLabel).toLocaleUpperCase('es-ES');
    const sub = 'CARRERA';
    ctx.font = `700 40px ${UI}`;
    const sw = measure(ctx, sub, 9);
    ctx.font = `800 96px ${UI}`;
    const tw = measure(ctx, txt, 2);
    const x0 = half + half / 2 - (sw + 34 + tw) / 2;
    ctx.font = `700 40px ${UI}`;
    ctx.fillStyle = '#d9d9dc';
    tracked(ctx, sub, x0, H * 0.46, 9, 'left');
    ctx.font = `800 96px ${UI}`;
    ctx.fillStyle = ORANGE;
    tracked(ctx, txt, x0 + sw + 34, H * 0.45, 2, 'left');
  } else {
    drawLockup(ctx, half + half / 2 - lw / 2, H * 0.44 - lh / 2, lh, '#f2f2f2');
  }
  ctx.fillStyle = ORANGE;
  ctx.fillRect(0, H - 22, W, 7);
  return canvasTex(THREE, c, aniso);
}

/**
 * Atlas de pancartas de los arcos: ROWS filas de 1024 × 192 (≈ 8,5 m × 1,6 m). style: 'dark' (negro, texto blanco con
 * acento naranja) · 'orange' (lona naranja, texto negro: MITAD y ÚLTIMO KM) · 'meta' (negro, META enorme).
 */
export function makeArchAtlas(THREE, aniso, rows = 4) {
  const W = 1024;
  const RH = 192;
  const c = document.createElement('canvas');
  c.width = W; c.height = RH * rows;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, RH * rows);
  const t = canvasTex(THREE, c, aniso);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.anisotropy = Math.min(aniso, 4);
  const keys = new Array(rows).fill('');
  return {
    texture: t,
    rows,
    /** Dibuja la fila `row`; true si cambió (sube el atlas una vez). */
    set(row, title, sub = '', style = 'dark') {
      const key = `${title}|${sub}|${style}`;
      if (keys[row] === key) return false;
      keys[row] = key;
      const y0 = row * RH;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, y0, W, RH); ctx.clip();
      // 'orange' = aviso (MITAD, ÚLTIMO KM): la misma lona negra con el título en naranja (nada claro tras el HUD)
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, y0, W, RH);
      const ink = style === 'orange' ? ORANGE : '#ffffff';
      ctx.textBaseline = 'middle';
      // el símbolo de RITMUP a la izquierda (salvo en la META, que va limpia y enorme)
      let xL = 54;
      if (style !== 'meta') {
        ctx.fillStyle = ink;
        const lh = 30;
        drawLockupInk(ctx, xL, y0 + RH / 2 - lh / 2, lh, '#ffffff', ORANGE);
      }
      const T = String(title).toLocaleUpperCase('es-ES');
      let size = style === 'meta' ? 150 : 118;
      ctx.font = `800 ${size}px ${UI}`;
      const maxW = style === 'meta' ? 860 : 700;
      let tw = measure(ctx, T, size * 0.06);
      if (tw > maxW) { size = Math.floor(size * maxW / tw); ctx.font = `800 ${size}px ${UI}`; tw = measure(ctx, T, size * 0.06); }
      const cx = style === 'meta' ? W / 2 : 140 + (W - 140) / 2;
      ctx.fillStyle = ink;
      tracked(ctx, T, cx - (sub ? 46 : 0), y0 + RH / 2 + 6, size * 0.06, 'center');
      if (sub) {
        ctx.font = `700 40px ${UI}`;
        ctx.fillStyle = style === 'orange' ? '#e8e8ea' : ORANGE;
        tracked(ctx, String(sub).toLocaleUpperCase('es-ES'), cx + tw / 2 + 14 - 46, y0 + RH / 2 + 6, 6, 'left');
      }
      // filetes
      ctx.fillStyle = ORANGE;
      ctx.fillRect(0, y0 + RH - 12, W, 6);
      ctx.fillRect(0, y0 + 6, W, 6);
      ctx.restore();
      t.needsUpdate = true;
      return true;
    },
  };
}

/** Lockup compacto (símbolo + logotipo) con tinta y color de la barra a elegir. */
function drawLockupInk(ctx, x, yTop, h, ink, bar) {
  const P = brandPaths();
  const sm = h / 32;
  ctx.save();
  ctx.translate(x, yTop);
  ctx.scale(sm, sm);
  ctx.fillStyle = ink; ctx.fill(P.mw);
  ctx.fillStyle = bar; ctx.fill(P.mo);
  ctx.restore();
}
