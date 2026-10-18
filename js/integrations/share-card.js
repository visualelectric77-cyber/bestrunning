// BestRunning · tarjeta para compartir (canvas 1080×1350) y logo dibujado con trazos.
import { fmt } from '../core/utils.js';
import { ZONES } from '../training/levels.js';

const W = 1080;
const H = 1350;
const PAD = 84;
const ROUNDED = 'ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

// Copia local de nombres/colores de categoría (SPEC §6.2) para no depender de templates.js.
const CATS = {
  intervals: ['Intervalos', '#FF375F'], tempo: ['Tempo', '#FF9F0A'], endurance: ['Resistencia', '#30D158'],
  fartlek: ['Fartlek', '#BF5AF2'], hills: ['Cuestas', '#C79A6B'], recovery: ['Recuperación', '#64D2FF'],
  challenge: ['Retos', '#FFD60A'], test: ['Test', '#7D7AFF'],
};
const FACES = { easy: ['😌', 'Muy fácil'], ok: ['🙂', 'Cómodo'], hard: ['😤', 'Exigente'], max: ['🥵', 'Al límite'], fail: ['😵', 'No pude'] };

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
  const segs = (segments || []).filter((s) => s && s.sec > 0);
  if (!segs.length) return;
  const total = segs.reduce((a, s) => a + s.sec, 0);
  const speeds = segs.map((s) => Number(s.speed) || 0);
  const max = Math.max(...speeds);
  const min = Math.min(...speeds);
  const lo = Math.max(0, min - (max - min) * 0.6 - 1);
  const gap = segs.length > 60 ? 1.5 : 3;
  let cx = x;
  for (const s of segs) {
    const sw = (s.sec / total) * w;
    const bh = Math.max(10, ((s.speed - lo) / Math.max(0.1, max - lo)) * h);
    const color = ZONES[s.zone]?.color || '#ff6a1a';
    const bw = Math.max(1, sw - gap);
    const grad = ctx.createLinearGradient(0, y + h - bh, 0, y + h);
    grad.addColorStop(0, color);
    grad.addColorStop(1, `${color}88`);
    roundRect(ctx, cx, y + h - bh, bw, bh, [Math.min(8, bw / 2), Math.min(8, bw / 2), 2, 2]);
    ctx.fillStyle = grad;
    ctx.fill();
    cx += sw;
  }
}

function statBlock(ctx, x, y, label, value, unit, align = 'left') {
  ctx.textAlign = align;
  ctx.fillStyle = 'rgba(235,235,245,0.5)';
  ctx.font = `700 27px ${SANS}`;
  setSpacing(ctx, 3);
  ctx.fillText(label.toUpperCase(), x, y);
  setSpacing(ctx, 0);
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 76px ${ROUNDED}`;
  ctx.fillText(value, x, y + 82);
  if (unit) {
    const vw = ctx.measureText(value).width;
    ctx.fillStyle = 'rgba(235,235,245,0.62)';
    ctx.font = `700 32px ${ROUNDED}`;
    ctx.fillText(unit, x + vw + 10, y + 82);
  }
}

/** Dibuja la tarjeta y devuelve un Blob PNG (o null si no hay canvas). */
export async function renderShareCard(session, { workout = null, name = '' } = {}) {
  const c = makeCanvas(W, H);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const s = session || {};

  // Fondo: negro con brasas naranja→rojo
  ctx.fillStyle = '#08080a';
  ctx.fillRect(0, 0, W, H);
  const g1 = ctx.createRadialGradient(170, 90, 10, 170, 90, 1050);
  g1.addColorStop(0, 'rgba(255,149,0,0.85)');
  g1.addColorStop(0.35, 'rgba(255,90,31,0.42)');
  g1.addColorStop(1, 'rgba(255,45,85,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);
  const g2 = ctx.createRadialGradient(1020, 1260, 10, 1020, 1260, 900);
  g2.addColorStop(0, 'rgba(255,45,85,0.62)');
  g2.addColorStop(1, 'rgba(255,45,85,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(8,8,10,0)');
  shade.addColorStop(0.45, 'rgba(8,8,10,0.35)');
  shade.addColorStop(1, 'rgba(8,8,10,0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
  // Estelas de velocidad
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    ctx.lineWidth = 2 + (i % 3) * 2;
    const yy = 180 + i * 120;
    ctx.beginPath();
    ctx.moveTo(W - 80 - (i % 4) * 90, yy);
    ctx.lineTo(W + 40, yy - 160);
    ctx.stroke();
  }
  ctx.restore();

  // Cabecera: logo + marca + fecha
  drawLogoMark(ctx, PAD, PAD, 92);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 46px ${SANS}`;
  setSpacing(ctx, -1);
  ctx.fillText('BestRunning', PAD + 120, PAD + 62);
  setSpacing(ctx, 0);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.font = `600 32px ${SANS}`;
  const dayLabel = s.dayKey ? fmt.dateShort(s.dayKey) : '';
  ctx.fillText(dayLabel, W - PAD, PAD + 60);

  // Categoría y título
  const [catName, catColor] = CATS[s.category] || ['Entrenamiento', '#ff9f0a'];
  ctx.textAlign = 'left';
  ctx.font = `800 30px ${SANS}`;
  setSpacing(ctx, 5);
  ctx.fillStyle = catColor;
  const mins = Math.round((Number(s.elapsedSec) || 0) / 60);
  ctx.fillText(`${catName.toUpperCase()} · ${mins} MIN`, PAD, 300);
  setSpacing(ctx, 0);
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 88px ${SANS}`;
  setSpacing(ctx, -2);
  const lines = wrapLines(ctx, s.title || 'Entrenamiento', W - PAD * 2, 2);
  lines.forEach((ln, i) => ctx.fillText(ln, PAD, 395 + i * 96));
  setSpacing(ctx, 0);

  // Cifra principal: distancia
  const yBig = lines.length > 1 ? 790 : 720;
  ctx.font = `800 300px ${ROUNDED}`;
  setSpacing(ctx, -10);
  const big = fmt.km(s.distanceKm || 0);
  const bigGrad = ctx.createLinearGradient(PAD, yBig - 240, PAD, yBig);
  bigGrad.addColorStop(0, '#ffffff');
  bigGrad.addColorStop(1, '#ffd2b8');
  ctx.fillStyle = bigGrad;
  ctx.fillText(big, PAD - 8, yBig);
  const bw = ctx.measureText(big).width;
  setSpacing(ctx, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = `800 76px ${ROUNDED}`;
  ctx.fillText('km', PAD + bw + 10, yBig);

  // Estadísticas
  const colW = (W - PAD * 2) / 3;
  const yS1 = yBig + 90;
  const pace = s.avgSpeed > 0 ? fmt.pace(s.avgSpeed) : '–:––';
  statBlock(ctx, PAD, yS1, 'Tiempo', fmt.clock(s.elapsedSec || 0), '');
  statBlock(ctx, PAD + colW, yS1, 'Ritmo', pace, '/km');
  // Con el pulso del Apple Watch importado (§12), el dato real gana a la estimación de kcal
  const hrAvg = Math.round(Number(s.hrAvg) || 0);
  if (hrAvg >= 40) statBlock(ctx, PAD + colW * 2, yS1, 'Pulso medio', String(hrAvg), 'ppm');
  else statBlock(ctx, PAD + colW * 2, yS1, 'Kcal', fmt.int(s.kcal || 0), '');
  const yS2 = yS1 + 150;
  statBlock(ctx, PAD, yS2, 'Vel. media', fmt.speed(s.avgSpeed || 0), 'km/h');
  statBlock(ctx, PAD + colW, yS2, 'Vel. máx.', fmt.speed(s.maxSpeed || 0), 'km/h');
  const face = FACES[s.feeling];
  if (face) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(235,235,245,0.5)';
    ctx.font = `700 27px ${SANS}`;
    setSpacing(ctx, 3);
    ctx.fillText('SENSACIÓN', PAD + colW * 2, yS2);
    setSpacing(ctx, 0);
    ctx.font = `64px ${SANS}`;
    ctx.fillText(face[0], PAD + colW * 2, yS2 + 80);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 30px ${SANS}`;
    ctx.fillText(face[1], PAD + colW * 2 + 80, yS2 + 70);
  } else {
    statBlock(ctx, PAD + colW * 2, yS2, 'Completado', `${Math.round((s.completionPct || 0) * 100)}`, '%');
  }

  // Perfil de intensidad
  const yP = H - 250;
  const hP = 130;
  const segs = (workout?.segments?.length ? workout.segments : traceToSegments(s.speedTrace)) || [];
  // Línea base sutil
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, PAD, yP + hP + 6, W - PAD * 2, 3, 2);
  ctx.fill();
  drawProfile(ctx, segs, PAD, yP, W - PAD * 2, hP);

  // Pie
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(235,235,245,0.55)';
  ctx.font = `600 28px ${SANS}`;
  ctx.fillText(name ? `${name} · entrenado en cinta` : 'Entrenado en cinta', PAD, H - 62);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 28px ${SANS}`;
  ctx.fillText(s.isTest ? `VAM ${fmt.speed(s.test?.vam || 0)} km/h` : s.completed ? '¡Sesión completada! 🔥' : '¡Cada minuto cuenta! 💪', W - PAD, H - 62);

  return new Promise((resolve) => {
    try { c.toBlob((b) => resolve(b || null), 'image/png'); } catch { resolve(null); }
  });
}

/** Convierte el speedTrace [[t, v]…] en pseudo-segmentos coloreados por velocidad. */
function traceToSegments(trace) {
  if (!Array.isArray(trace) || trace.length < 2) return [];
  const out = [];
  for (let i = 0; i < trace.length - 1; i++) {
    const [t0, v] = trace[i];
    const t1 = trace[i + 1][0];
    if (t1 - t0 < 1) continue;
    const zone = v >= 12.5 ? 'sprint' : v >= 11 ? 'fast' : v >= 9.5 ? 'run' : v >= 7.5 ? 'jog' : 'warmup';
    out.push({ zone, speed: v, sec: t1 - t0 });
  }
  return out;
}

export function shareFileName(session) {
  return `bestrunning-${session?.dayKey || 'sesion'}.png`;
}

export function shareText(session) {
  const s = session || {};
  return `¡${fmt.km(s.distanceKm || 0)} km en ${fmt.clock(s.elapsedSec || 0)} con BestRunning! 🔥`;
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
