// BestRunning · tarjeta para compartir (canvas 1080×1350) y logo dibujado con trazos.
import { fmt } from '../core/utils.js';
import { ZONES } from '../training/levels.js';

const W = 1080;
const H = 1350;
const PAD = 84;
const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

// Copia local de nombres/colores de categoría (SPEC §6.2) para no depender de templates.js.
const CATS = {
  intervals: ['Intervalos', '#FF375F'], tempo: ['Tempo', '#FF9F0A'], endurance: ['Resistencia', '#30D158'],
  fartlek: ['Fartlek', '#BF5AF2'], hills: ['Cuestas', '#C79A6B'], recovery: ['Recuperación', '#64D2FF'],
  challenge: ['Retos', '#FFD60A'], test: ['Test', '#7D7AFF'],
};

function makeCanvas(w, h) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Array.isArray(r) ? r : [r, r, r, r];
  const [tl, tr, br, bl] = rr.map((v) => Math.max(0, Math.min(v, w / 2, h / 2)));
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

function setSpacing(ctx, px) {
  try { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; } catch { /* sin soporte */ }
}

/**
 * Símbolo de la app, idéntico a assets/icons/icon.svg (rejilla de 1024): azulejo ember, chevron con tres líneas de
 * velocidad y la cinta debajo. Se dibuja escalado sobre (x, y) con lado `size`.
 */
export function drawLogoMark(ctx, x, y, size) {
  const k = size / 1024;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  // Esquinas circulares (rx 229 del SVG) con arcTo, no con curvas cuadráticas
  const tile = () => {
    ctx.beginPath();
    ctx.moveTo(229, 0);
    ctx.arcTo(1024, 0, 1024, 1024, 229);
    ctx.arcTo(1024, 1024, 0, 1024, 229);
    ctx.arcTo(0, 1024, 0, 0, 229);
    ctx.arcTo(0, 0, 1024, 0, 229);
    ctx.closePath();
  };
  const g = ctx.createLinearGradient(0, 0, 1024, 1024);
  g.addColorStop(0, '#ff9500');
  g.addColorStop(0.48, '#ff5a1f');
  g.addColorStop(1, '#ff2d55');
  tile();
  ctx.fillStyle = g;
  ctx.fill();
  // Brillo arriba a la izquierda y sombra granate abajo a la derecha (como los radialGradient del SVG)
  const hl = ctx.createRadialGradient(225, 82, 0, 225, 82, 870);
  hl.addColorStop(0, 'rgba(255,255,255,0.26)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  tile();
  ctx.fillStyle = hl;
  ctx.fill();
  const dk = ctx.createRadialGradient(1024, 1075, 0, 1024, 1075, 922);
  dk.addColorStop(0, 'rgba(176,12,52,0.45)');
  dk.addColorStop(1, 'rgba(176,12,52,0)');
  tile();
  ctx.fillStyle = dk;
  ctx.fill();
  // Trazos blancos con la sombra suave del icono (los parámetros de sombra no se escalan con la matriz)
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(122,8,28,0.42)';
  ctx.shadowBlur = 44 * k;
  ctx.shadowOffsetY = 18 * k;
  const line = (x1, yy, x2, w, style) => {
    ctx.beginPath();
    ctx.moveTo(x1, yy);
    ctx.lineTo(x2, yy);
    ctx.lineWidth = w;
    ctx.strokeStyle = style;
    ctx.stroke();
  };
  line(316, 356, 472, 56, 'rgba(255,255,255,0.6)');
  line(234, 456, 582, 64, '#ffffff');
  line(316, 556, 472, 56, 'rgba(255,255,255,0.6)');
  const belt = ctx.createLinearGradient(241, 0, 859, 0);
  belt.addColorStop(0, 'rgba(255,255,255,0.12)');
  belt.addColorStop(1, 'rgba(255,255,255,0.62)');
  line(260, 802, 840, 38, belt);
  ctx.beginPath();
  ctx.moveTo(534, 246);
  ctx.lineTo(756, 456);
  ctx.lineTo(534, 666);
  ctx.lineWidth = 124;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.restore();
}

/** Logo como data URL (para Media Session). */
export function logoDataUrl(size = 512) {
  try {
    const c = makeCanvas(size, size);
    if (!c) return '';
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#08080a';
    ctx.fillRect(0, 0, size, size);
    drawLogoMark(ctx, size * 0.1, size * 0.1, size * 0.8);
    return c.toDataURL('image/png');
  } catch {
    return '';
  }
}

function wrapLines(ctx, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width <= maxW || !cur) cur = test;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

function drawProfile(ctx, segments, x, y, w, h) {
  // v2: barras planas del color de su zona, 2 pt de separación y radio 2 (como profileChart), sin degradados
  const segs = (segments || []).filter((s) => s && s.sec > 0);
  if (!segs.length) return;
  const total = segs.reduce((a, s) => a + s.sec, 0);
  const speeds = segs.map((s) => Number(s.speed) || 0);
  const max = Math.max(...speeds);
  const min = Math.min(...speeds);
  const lo = Math.max(0, min - (max - min) * 0.6 - 1);
  const gap = segs.length > 60 ? 2 : 5;
  let cx = x;
  for (const s of segs) {
    const sw = (s.sec / total) * w;
    const bh = Math.max(10, ((s.speed - lo) / Math.max(0.1, max - lo)) * h);
    const bw = Math.max(1, sw - gap);
    roundRect(ctx, cx + Math.min(gap, sw * 0.35) / 2, y + h - bh, bw, bh, [Math.min(5, bw / 2), Math.min(5, bw / 2), 0, 0]);
    ctx.fillStyle = ZONES[s.zone]?.color || '#8E8E93';
    ctx.fill();
    cx += sw;
  }
}

// Foto de campaña de cada categoría (misma elección que la tarjeta de Hoy); flip = la persona pasa a la derecha
const PHOTO = {
  intervals: ['cat-intervals', false], fartlek: ['cat-intervals', false], challenge: ['cat-intervals', false],
  endurance: ['cat-endurance', true], recovery: ['cat-recovery', false], tempo: ['cat-tempo', true],
  hills: ['cat-tempo', true], test: ['cat-tempo', true],
};

/** Carga una imagen del propio sitio (sin contaminar el lienzo). Nunca lanza: null si no llega a tiempo. */
function loadImage(src, ms = 2500) {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(() => resolve(null), ms);
    img.onload = () => { clearTimeout(t); resolve(img); };
    img.onerror = () => { clearTimeout(t); resolve(null); };
    try { img.decoding = 'async'; } catch { /* nada */ }
    img.src = src;
  });
}

/** Dibuja la imagen cubriendo (x, y, w, h) como object-fit: cover, opcionalmente reflejada. */
function drawCover(ctx, img, x, y, w, h, { flip = false, focusY = 0.4 } = {}) {
  const k = Math.max(w / img.width, h / img.height);
  const dw = img.width * k;
  const dh = img.height * k;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) * focusY;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (flip) {
    ctx.translate(x * 2 + w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

/** Cifra con rótulo (v2): rótulo gris arriba, cifra blanca SF Pro Display 700, unidad gris al 45 %. */
function statBlock(ctx, x, y, label, value, unit) {
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(235,235,245,0.62)';
  ctx.font = `500 28px ${SANS}`;
  setSpacing(ctx, 0);
  ctx.fillText(label, x, y);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 68px ${SANS}`;
  setSpacing(ctx, -1.5);
  ctx.fillText(value, x, y + 74);
  if (unit) {
    const vw = ctx.measureText(value).width;
    setSpacing(ctx, 0);
    ctx.fillStyle = 'rgba(235,235,245,0.62)';
    ctx.font = `600 30px ${SANS}`;
    ctx.fillText(unit, x + vw + 8, y + 74);
  }
  setSpacing(ctx, 0);
}

/** Dibuja la tarjeta y devuelve un Blob PNG (o null si no hay canvas). */
export async function renderShareCard(session, { workout = null, name = '' } = {}) {
  const c = makeCanvas(W, H);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const s = session || {};

  // v2 («serio, elegante»): negro puro, la foto de su categoría arriba fundida en negro, tipografía blanca
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  const PH = 640;
  const [photoName, flip] = PHOTO[s.category] || ['hero-man', false];
  const img = await loadImage(`./assets/media/${photoName}.jpg`);
  if (img) {
    drawCover(ctx, img, 0, 0, W, PH, { flip, focusY: photoName === 'hero-man' ? 0.62 : 0.35 });
    const veil = ctx.createLinearGradient(0, 0, 0, PH);
    veil.addColorStop(0, 'rgba(0,0,0,0.45)');
    veil.addColorStop(0.22, 'rgba(0,0,0,0.05)');
    veil.addColorStop(0.55, 'rgba(0,0,0,0.25)');
    veil.addColorStop(1, '#000000');
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, W, PH);
  }

  // Cabecera: símbolo + «Best» blanco y «Running» ember sólido · fecha
  drawLogoMark(ctx, PAD, PAD - 10, 76);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `700 44px ${SANS}`;
  setSpacing(ctx, -0.8);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Best', PAD + 98, PAD + 42);
  const bw0 = ctx.measureText('Best').width;
  ctx.fillStyle = '#FF5A1F';
  ctx.fillText('Running', PAD + 98 + bw0, PAD + 42);
  setSpacing(ctx, 0);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.font = `500 30px ${SANS}`;
  const dayLabel = s.dayKey ? fmt.dateShort(s.dayKey) : '';
  ctx.fillText(dayLabel, W - PAD, PAD + 40);

  // Categoría · duración (gris, mayúsculas finas) y título
  const [catName] = CATS[s.category] || ['Entrenamiento'];
  const mins = Math.round((Number(s.elapsedSec) || 0) / 60);
  ctx.textAlign = 'left';
  ctx.font = `600 28px ${SANS}`;
  setSpacing(ctx, 1.2);
  ctx.fillStyle = 'rgba(235,235,245,0.72)';
  ctx.font = `700 84px ${SANS}`;
  setSpacing(ctx, -1.5);
  const lines = wrapLines(ctx, s.title || 'Entrenamiento', W - PAD * 2, 2);
  const yT = PH - 30 - (lines.length - 1) * 92;
  ctx.font = `600 28px ${SANS}`;
  setSpacing(ctx, 1.2);
  ctx.fillText(`${catName.toUpperCase()} · ${mins} MIN`, PAD, yT - 96);
  setSpacing(ctx, -1.5);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 84px ${SANS}`;
  lines.forEach((ln, i) => ctx.fillText(ln, PAD, yT + i * 92));
  setSpacing(ctx, 0);

  // Cifra principal: distancia (blanca sólida) y «km» en gris
  const yBig = PH + 230;
  ctx.font = `700 230px ${SANS}`;
  setSpacing(ctx, -6);
  const big = fmt.km(s.distanceKm || 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(big, PAD - 6, yBig);
  const bw = ctx.measureText(big).width;
  setSpacing(ctx, 0);
  ctx.fillStyle = 'rgba(235,235,245,0.62)';
  ctx.font = `600 ${Math.round(230 * 0.36)}px ${SANS}`;
  ctx.fillText('km', PAD + bw + 8, yBig);

  // Cifras: tres columnas con separadores finos
  const colW = (W - PAD * 2) / 3;
  const yS = yBig + 84;
  const pace = s.avgSpeed > 0 ? fmt.pace(s.avgSpeed) : '–:––';
  const hrAvg = Math.round(Number(s.hrAvg) || 0);
  statBlock(ctx, PAD, yS, 'Tiempo', fmt.clock(s.elapsedSec || 0), '');
  statBlock(ctx, PAD + colW + 28, yS, 'Ritmo', pace, '/km');
  // Con el pulso del Apple Watch, el dato real gana a la estimación de kcal
  if (hrAvg >= 40) statBlock(ctx, PAD + colW * 2 + 28, yS, 'Pulso medio', String(hrAvg), 'ppm');
  else statBlock(ctx, PAD + colW * 2 + 28, yS, 'Kcal', fmt.int(s.kcal || 0), '');
  ctx.fillStyle = 'rgba(84,84,88,0.65)';
  ctx.fillRect(PAD + colW + 2, yS - 30, 2, 116);
  ctx.fillRect(PAD + colW * 2 + 2, yS - 30, 2, 116);

  // Perfil de intensidad (el único color: las zonas)
  const yP = H - 228;
  const hP = 104;
  const segs = (workout?.segments?.length ? workout.segments : traceToSegments(s.speedTrace)) || [];
  drawProfile(ctx, segs, PAD, yP, W - PAD * 2, hP);

  // Pie, en gris y sin emojis
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(235,235,245,0.62)';
  ctx.font = `500 28px ${SANS}`;
  ctx.fillText(name ? `${name} · entrenado en cinta` : 'Entrenado en cinta', PAD, H - 64);
  ctx.textAlign = 'right';
  ctx.fillStyle = s.isTest ? '#FF5A1F' : 'rgba(235,235,245,0.62)';
  ctx.font = `600 28px ${SANS}`;
  ctx.fillText(s.isTest ? `VAM ${fmt.speed(s.test?.vam || 0)} km/h` : s.completed ? 'Sesión completada' : `${Math.round((s.completionPct || 0) * 100)} % completado`, W - PAD, H - 64);

  return new Promise((resolve) => {
    try { c.toBlob((b) => resolve(b || null), 'image/png'); } catch { resolve(null); }
  });
}

/** Convierte el speedTrace [[t, v]…] en pseudo-segmentos coloreados por velocidad. */
function traceToSegments(trace) {
  if (!Array.isArray(trace) || trace.length < 2) return [];
  const out = [];
  let started = false;
  for (let i = 0; i < trace.length - 1; i++) {
    const [t0, v] = trace[i];
    const t1 = trace[i + 1][0];
    if (t1 - t0 < 1) continue;
    let zone = v >= 12.5 ? 'sprint' : v >= 11 ? 'fast' : v >= 9.5 ? 'run' : v >= 7.5 ? 'jog' : 'warmup';
    // Lo lento después de haber corrido es vuelta a la calma (morado), no calentamiento (azul)
    if (zone === 'warmup' && started) zone = 'cooldown';
    if (zone !== 'warmup') started = true;
    out.push({ zone, speed: v, sec: t1 - t0 });
  }
  return out;
}

export function shareFileName(session) {
  return `bestrunning-${session?.dayKey || 'sesion'}.png`;
}

export function shareText(session) {
  const s = session || {};
  return `${fmt.km(s.distanceKm || 0)} km en ${fmt.clock(s.elapsedSec || 0)} con BestRunning`;
}

export function downloadBlob(blob, filename) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Comparte la tarjeta. Pasa `blob` ya renderizado para no perder el gesto del usuario en iOS.
 * Devuelve 'shared' | 'cancelled' | 'blocked' (el navegador exige un gesto nuevo) | 'downloaded' | 'error'.
 */
export async function shareSession(session, { workout = null, name = '', blob = null } = {}) {
  let b = blob;
  try {
    if (!b) b = await renderShareCard(session, { workout, name });
  } catch {
    b = null;
  }
  if (!b) return 'error';
  const filename = shareFileName(session);
  let file = null;
  try { file = new File([b], filename, { type: 'image/png' }); } catch { file = null; }
  if (file && navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: 'BestRunning', text: shareText(session) });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      if (err?.name === 'NotAllowedError') return 'blocked';
    }
  }
  return downloadBlob(b, filename) ? 'downloaded' : 'error';
}
