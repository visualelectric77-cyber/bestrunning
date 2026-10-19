// BestRunning · réplica en canvas 2D del HUD de retransmisión del reproductor (SPEC §16) para las capturas del
// laboratorio 3D (tools/scene-lab.html). Misma rejilla, medidas, tipografía (pila del sistema) y colores que
// css/player.css (.hud-*). Si cambia el HUD real, se cambia aquí también (lo mantiene quien diseña el HUD).
//
//   import { drawHud, hudLayout } from './hud-mock.js';
//   drawHud(ctx2d, w, h, data, 'portrait' | 'landscape');
//   data = { speed, zone, zoneLabel, pace, segRemaining, segProgress, nextLabel, elapsed, remaining, title, segText,
//            distanceKm, kcal, hrText, nowPlaying, profile: [{ zone, sec, speed }], cursor }
//   · speed: km/h (número) o texto ya formateado ('12,1')        · pace: '4:58' (o km/h numérico → se calcula)
//   · segRemaining / elapsed / remaining: segundos o texto       · segProgress / cursor: 0..1 (cursor > 1 = segundos)
//   · nextLabel: 'Trote 8,1 · 0:50' (la parte tras « · » es la duración) · hrText: 'Z4 · 141–158'
//   · nowPlaying: texto o null (sin fila «Sonando», como en modo «Mi música»)
//   Extras opcionales: safe {t,b,l,r} (por defecto las del iPhone Pro Max: vertical 62/34/0/0, horizontal 0/21/62/62;
//   pasa { t:0, b:0, l:0, r:0 } para imitar un navegador), nextZone, paused, bug { lbl, val, sub, color },
//   ghost '+35 m' / '−12 m', record (halo dorado), glow 0..1 (pulso del halo a ritmo).
//   Motion graphics (js/player/motion.js): deck { zone, name, speed, dur, timer 0..1, reveal 0..1 } = tira «Siguiente»
//   sobre el lower third en los últimos 10 s; ticks 0..10 = marcas que sustituyen a la barra del tramo.
// hudLayout(w, h, orientation, data?) devuelve los rectángulos (px CSS) que el HUD real enviaría a setHudRects.
// drawDone(ctx, w, h, { label, title, stats }, orientation, { alpha, rise }) dibuja el rótulo final (.hud-done) que el
// reproductor muestra en el plano final, cuando el resto del HUD se retira.
// Sin DOM: solo usa la API de CanvasRenderingContext2D (vale con OffscreenCanvas).
import { ZONES } from '../js/training/levels.js';

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif';
// v2: cifras en SF Pro Display (no Rounded), peso 700, sin halo; placas casi negras con filo fino (como el HUD real)
const FONT_NUM = '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif';
const C = {
  plate: 'rgba(10, 10, 12, 0.8)',
  edge: 'rgba(84, 84, 88, 0.45)',
  lbl: 'rgba(235, 235, 245, 0.6)',
  ink2: 'rgba(235, 235, 245, 0.8)',
  white: '#ffffff',
  track: 'rgba(255, 255, 255, 0.12)',
};
const PLATE_R = 14;
const SAFE = {
  portrait: { t: 62, b: 34, l: 0, r: 0 },
  landscape: { t: 0, b: 21, l: 62, r: 62 },
};

const zoneColor = (z) => ZONES[z]?.color || '#FF6A1A';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const nf1 = (v) => (Math.round(Number(v) * 10) / 10).toFixed(1).replace('.', ',');
const nf2 = (v) => (Math.round(Number(v) * 100) / 100).toFixed(2).replace('.', ',');
function clock(sec) {
  const s0 = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s0 / 3600);
  const m = Math.floor((s0 % 3600) / 60);
  const s = s0 % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
const asClock = (v) => (typeof v === 'string' ? v : clock(v));
function paceOf(kmh) {
  if (!(kmh > 0)) return '–:––';
  const s = Math.round(3600 / kmh);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ───────────── Medidas (idénticas a css/player.css) ───────────── */
function metricsFor(w, h, orientation, data = {}) {
  const land = orientation === 'landscape';
  const safe = { ...(land ? SAFE.landscape : SAFE.portrait), ...(data.safe || {}) };
  const gx = Math.max(16, safe.l);
  const gxr = Math.max(16, safe.r);
  const short = !land && h <= 760;
  const topY = land ? Math.max(8, safe.t) : safe.t + 8;
  const topH = land || short ? 36 : 38;
  // --speed-fs: vertical clamp(88px, min(33vw, 16dvh), 152px) · horizontal clamp(92px, 34dvh, 168px)
  const speedFs = land ? clamp(h * 0.34, 92, 168) : clamp(Math.min(w * 0.33, h * 0.16), 88, 152);
  const cdFs = land || short ? 44 : 52;
  // Rejilla: ancho máx. 640 en vertical, centrado
  const boxW = land ? w : Math.min(w, 640);
  const x0 = (w - boxW) / 2 + gx;
  const innerW = boxW - gx - gxr;
  const hasNp = data.nowPlaying != null && data.nowPlaying !== false;
  // Lower third y métricas (alturas medidas en el reproductor real)
  const ltPadT = land ? 11 : 13;
  const ltPadB = land ? 10 : 12;
  const headH = 11.5 + 7 + cdFs * 0.86;
  const barGap = land ? 10 : 12;
  const stripGap = land ? 8 : 10;
  const stripH = land ? 30 : short ? 28 : 34;
  const ltH = 1 + ltPadT + headH + barGap + 3 + stripGap + stripH + ltPadB + 1;
  const infoPad = land ? 9 : 10;
  const npH = hasNp ? (land ? 8 + 24.6 : 9 + 25.6) : 0;
  const infoH = 1 + infoPad + 18.7 + npH + infoPad + 1;
  const ctlH = land ? 72 : short ? 8 + 4 + 60 : 84;
  const padB = land ? Math.max(10, safe.b + 4) : safe.b + 10;
  // Columna de datos: en vertical todo el ancho; en horizontal el 44 % derecho (separación 28)
  let colX = x0;
  let colW = innerW;
  let speedX = x0;
  let speedW = innerW;
  if (land) {
    colW = innerW * 0.44 < 320 ? 320 : innerW * 0.44;
    colX = x0 + innerW - colW;
    speedW = innerW - colW - 28;
  }
  const infoY = h - padB - infoH;
  const ltY = infoY - 8 - ltH;
  const ctlY = ltY - ctlH;
  const top = { x: x0, y: topY, w: innerW, h: topH };
  // Bloque de velocidad: centrado en su área con relleno inferior en % del ANCHO del área (12 % / 3 %)
  const areaTop = topY + topH;
  const areaBottom = land ? h - padB : ctlY;
  const padTop = land ? 6 : 8;
  const padBot = speedW * (land ? 0.03 : 0.12);
  const paceGap = Math.max(14, speedFs * 0.15); // --pace-gap: la coma de la cifra baja de su caja
  const coreH = (data.paused ? 24.5 + 14 : 0) + 18 + 8 + speedFs * 0.9 + paceGap + 20.9 + (data.ghost ? 12 + 25 : 0);
  const coreY = areaTop + padTop + Math.max(0, (areaBottom - areaTop - padTop - padBot - coreH) / 2);
  return {
    land, safe, gx, gxr, topY, topH, speedFs, paceGap, cdFs, x0, innerW, hasNp, short,
    ltPadT, headH, barGap, stripGap, stripH, ltH, infoPad, infoH, colX, colW, speedX, speedW,
    top, lt: { x: colX, y: ltY, w: colW, h: ltH }, info: { x: colX, y: infoY, w: colW, h: infoH },
    ctl: { x: colX, y: ctlY, w: colW, h: ctlH }, coreY, coreH, speedCx: speedX + speedW / 2,
  };
}

/** Rectángulos que el HUD real enviaría a scene.setHudRects (información de composición). */
export function hudLayout(w, h, orientation = 'portrait', data = {}) {
  const m = metricsFor(w, h, orientation, { nowPlaying: '', ...data });
  const r = (o, kind, rad = PLATE_R) => ({ x: Math.round(o.x), y: Math.round(o.y), w: Math.round(o.w), h: Math.round(o.h), r: rad, kind });
  const coreW = Math.min(m.speedW, m.speedFs * 2.15);
  return [
    r(m.top, 'top'),
    r({ x: m.speedCx - coreW / 2, y: m.coreY, w: coreW, h: m.coreH }, 'speed', 0),
    r(m.lt, 'segment'),
    r(m.info, 'panel'),
  ];
}

/* ───────────── Primitivas ───────────── */
function font(ctx, weight, size, num = false) {
  ctx.font = `${weight} ${size}px ${num ? FONT_NUM : FONT}`;
}

function rrect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function plate(ctx, o, r = PLATE_R) {
  rrect(ctx, o.x, o.y, o.w, o.h, r);
  ctx.fillStyle = C.plate;
  ctx.fill();
  rrect(ctx, o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1, r - 0.5);
  ctx.strokeStyle = C.edge;
  ctx.lineWidth = 1;
  ctx.stroke();
}

const isDigit = (ch) => ch >= '0' && ch <= '9';
/** Avance de un carácter; con tab, las cifras ocupan todas lo mismo que el «0» (font-variant-numeric: tabular-nums). */
function adv(ctx, ch, tab) {
  return ctx.measureText(tab && isDigit(ch) ? '0' : ch).width;
}

/** Ancho como lo mide CSS: letter-spacing se suma tras CADA carácter (también el último). */
function spacedWidth(ctx, str, spacing = 0, tab = false) {
  const s = String(str ?? '');
  if (!s) return 0;
  if (!spacing && !tab) return ctx.measureText(s).width;
  let w = 0;
  for (const ch of s) w += adv(ctx, ch, tab) + spacing;
  return w;
}

/** Línea base CSS de la fuente actual para una caja de línea centrada en cy (área de contenido centrada). */
function baseOf(ctx, cy) {
  const mt = ctx.measureText('Hg');
  const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1]) || 16;
  const A = Number.isFinite(mt.fontBoundingBoxAscent) ? mt.fontBoundingBoxAscent : size * 0.95;
  const D = Number.isFinite(mt.fontBoundingBoxDescent) ? mt.fontBoundingBoxDescent : size * 0.24;
  return cy + (A - D) / 2;
}

/**
 * Texto con letter-spacing y cifras tabulares opcionales, alineado 'left' | 'right' | 'center' en x.
 * y = centro de la caja de línea (o la línea base exacta si se pasa baseline: true). Devuelve el ancho CSS.
 */
function text(ctx, str, x, y, { spacing = 0, align = 'left', color = C.white, maxW = Infinity, tab = false, baseline = false } = {}) {
  let s = String(str ?? '');
  let w = spacedWidth(ctx, s, spacing, tab);
  if (w > maxW) {
    while (s.length > 1 && spacedWidth(ctx, `${s}…`, spacing, tab) > maxW) s = s.slice(0, -1);
    s = `${s.trimEnd()}…`;
    w = spacedWidth(ctx, s, spacing, tab);
  }
  let cx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  const base = baseline ? y : baseOf(ctx, y);
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  if (!spacing && !tab) { ctx.fillText(s, cx, base); return w; }
  for (const ch of s) {
    const a = adv(ctx, ch, tab);
    const real = ctx.measureText(ch).width;
    ctx.fillText(ch, cx + (tab && isDigit(ch) ? (a - real) / 2 : 0), base);
    cx += a + spacing;
  }
  return w;
}

function arrowGlyph(ctx, cx, cy, dir, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (dir === 0) {
    ctx.moveTo(cx - 4.5, cy - 2.2); ctx.lineTo(cx + 4.5, cy - 2.2);
    ctx.moveTo(cx - 4.5, cy + 2.2); ctx.lineTo(cx + 4.5, cy + 2.2);
  } else {
    const s = dir > 0 ? -1 : 1;
    ctx.moveTo(cx, cy - 5 * s); ctx.lineTo(cx, cy + 5 * s);
    ctx.moveTo(cx - 4, cy + 1 * s); ctx.lineTo(cx, cy + 5 * s); ctx.lineTo(cx + 4, cy + 1 * s);
  }
  ctx.stroke();
  ctx.restore();
}

/* ───────────── Bloques ───────────── */
function drawTop(ctx, m, d) {
  const o = m.top;
  plate(ctx, o);
  const cy = o.y + o.h / 2;
  const el = asClock(d.elapsed ?? 0);
  const rem = `−${asClock(d.remaining ?? 0)}`;
  font(ctx, 700, 15, true);
  const remW = spacedWidth(ctx, rem, 0, true);
  const elW = spacedWidth(ctx, el, 0, true);
  const rightW = elW + 9 + 1 + 9 + remW;
  const rx = o.x + o.w - 14;
  text(ctx, rem, rx, cy, { align: 'right', color: C.ink2, tab: true });
  text(ctx, el, rx - remW - 19, cy, { align: 'right', tab: true });
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.fillRect(rx - remW - 9 - 1, cy - 6, 1, 12);
  // Izquierda: CLASE · tramo
  const leftMax = o.w - 28 - rightW - 14;
  font(ctx, 600, 13, true);
  const sub = d.segText ? String(d.segText) : '';
  const subW = sub ? spacedWidth(ctx, sub, 0, true) : 0;
  font(ctx, 700, 12.5);
  const title = String(d.title || 'Entrenamiento').toUpperCase();
  const tW = text(ctx, title, o.x + 14, cy, { spacing: 1, maxW: Math.max(40, leftMax - (sub ? subW + 9 + 14 : 0)) });
  if (sub) {
    let x = o.x + 14 + tW + 9;
    font(ctx, 600, 13, true);
    text(ctx, '·', x, cy, { color: C.lbl });
    x += ctx.measureText('·').width + 9;
    text(ctx, sub, x, cy, { color: C.ink2, tab: true });
  }
  // Línea de progreso de la clase (hairline) en el borde inferior
  const total = (Number(d.elapsed) || 0) + (Number(d.remaining) || 0);
  const p = typeof d.elapsed === 'number' && total > 0 ? clamp(d.elapsed / total, 0, 1) : 0;
  ctx.save();
  rrect(ctx, o.x, o.y, o.w, o.h, PLATE_R);
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fillRect(o.x, o.y + o.h - 2, o.w, 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillRect(o.x, o.y + o.h - 2, o.w * p, 2);
  ctx.restore();
}

function drawSpeed(ctx, m, d) {
  const zc = zoneColor(d.zone);
  const cx = m.speedCx;
  let y = m.coreY;
  if (d.paused) {
    font(ctx, 700, 10.5);
    const tw = spacedWidth(ctx, 'EN PAUSA', 1.47);
    const bw = 1 + 11 + 11 + 6 + tw + 11 + 1;
    const bx = cx - bw / 2;
    plate(ctx, { x: bx, y, w: bw, h: 24.5 }, 8);
    ctx.fillStyle = C.white;
    ctx.fillRect(bx + 12 + 2.2, y + 8, 2.3, 8.5);
    ctx.fillRect(bx + 12 + 6.5, y + 8, 2.3, 8.5);
    text(ctx, 'EN PAUSA', bx + 12 + 11 + 6, y + 12.25, { spacing: 1.47 });
    y += 24.5 + 14;
  }
  // Etiqueta de zona (color exacto de la zona) con punto
  font(ctx, 700, 15);
  const label = String(d.zoneLabel || ZONES[d.zone]?.name || '').toUpperCase();
  const lw = spacedWidth(ctx, label, 2.4);
  const full = 8 + 9 + lw;
  const lx = cx - full / 2;
  const ly = y + 9;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.arc(lx + 4, ly, 4, 0, Math.PI * 2);
  ctx.fillStyle = zc;
  ctx.fill();
  text(ctx, label, lx + 17, ly, { spacing: 2.4, color: zc, maxW: m.speedW });
  ctx.restore();
  y += 18 + 8;
  // Cifra gigante: halo muy sutil del color de la zona + blanco nítido con sombra suave
  const sp = typeof d.speed === 'number' ? nf1(d.speed) : String(d.speed ?? '0,0');
  const fs = m.speedFs;
  font(ctx, 700, fs, true);
  const spacing = -0.045 * fs;
  const ny = y + (fs * 0.9) / 2;
  ctx.save();
  ctx.globalAlpha = 0; // v2: sin halo de color detrás de la cifra
  ctx.shadowColor = d.record ? 'rgba(255, 214, 10, 0.75)' : zc;
  ctx.shadowBlur = 30;
  text(ctx, sp, cx, ny, { spacing, align: 'center', color: 'rgba(0, 0, 0, 0.01)', tab: true });
  ctx.shadowBlur = 70;
  text(ctx, sp, cx, ny, { spacing, align: 'center', color: 'rgba(0, 0, 0, 0.01)', tab: true });
  ctx.restore();
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 2;
  text(ctx, sp, cx, ny, { spacing, align: 'center', tab: true });
  ctx.restore();
  y += fs * 0.9 + m.paceGap;
  // KM/H · ritmo MIN/KM (alineados por la línea base, como el flex del HUD)
  const pace = typeof d.pace === 'number' ? paceOf(d.pace) : String(d.pace ?? '–:––');
  font(ctx, 700, 11);
  const uW = spacedWidth(ctx, 'KM/H', 1.1);
  const u2W = spacedWidth(ctx, 'MIN/KM', 1.1);
  font(ctx, 700, 19, true);
  const pW = spacedWidth(ctx, pace, 0, true);
  const pb = baseOf(ctx, y + 10.45);
  const rowW = uW + 8 + 3 + 6 + 8 + pW + 8 + u2W;
  let x = cx - rowW / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  font(ctx, 700, 11);
  text(ctx, 'KM/H', x, pb, { spacing: 1.1, color: C.ink2, baseline: true });
  x += uW + 8 + 3;
  ctx.beginPath();
  ctx.arc(x + 1.5, y + 10.45, 1.5, 0, Math.PI * 2);
  ctx.fillStyle = C.ink2;
  ctx.fill();
  x += 3 + 3 + 8;
  font(ctx, 700, 19, true);
  text(ctx, pace, x, pb, { baseline: true, tab: true });
  x += pW + 8;
  font(ctx, 700, 11);
  text(ctx, 'MIN/KM', x, pb, { spacing: 1.1, color: C.ink2, baseline: true });
  ctx.restore();
  y += 20.9;
  if (d.ghost) {
    y += 12;
    font(ctx, 700, 13, true);
    // como el chip real: «+12 m VS RÉCORD» · «−8 m VS RÉCORD» · «= TU RÉCORD» (a la par, |Δ| < 3 m)
    const raw = String(d.ghost);
    const dm = Number(raw.replace('−', '-').replace(/[^\d.-]/g, ''));
    const even = raw.trim() === '=' || (Number.isFinite(dm) && Math.abs(dm) < 3);
    const g = even ? '=' : raw;
    const lbl = even ? 'TU RÉCORD' : 'VS RÉCORD';
    const ahead = !even && !/^[−-]/.test(g);
    const col = even ? '#ffffff' : ahead ? '#ffd60a' : '#bcd8ff';
    font(ctx, 700, 10);
    const gl = spacedWidth(ctx, lbl, 1.2);
    font(ctx, 700, 13, true);
    const vw = ctx.measureText(g).width;
    const gw = 10 + 12 + 6 + vw + 6 + gl + 10;
    plate(ctx, { x: cx - gw / 2, y, w: gw, h: 25 }, 8);
    let gx2 = cx - gw / 2 + 10;
    ctx.fillStyle = col;
    rrect(ctx, gx2 + 1, y + 7, 10, 10, 2);
    ctx.fill();
    gx2 += 12 + 6;
    font(ctx, 700, 13, true);
    text(ctx, g, gx2, y + 12.5, { color: col });
    gx2 += vw + 6;
    font(ctx, 700, 10);
    text(ctx, lbl, gx2, y + 12.5, { spacing: 1.2, color: C.lbl });
  }
}

function nextInfo(d) {
  const prof = Array.isArray(d.profile) ? d.profile.filter((s) => s && Number(s.sec) > 0) : [];
  const total = prof.reduce((a, s) => a + Number(s.sec), 0);
  let idx = -1;
  if (total > 0 && d.cursor != null) {
    const t = Number(d.cursor) > 1 ? Number(d.cursor) : Number(d.cursor) * total;
    let acc = 0;
    for (let i = 0; i < prof.length; i++) {
      acc += Number(prof[i].sec);
      if (t < acc - 1e-6) { idx = i; break; }
    }
    if (idx < 0) idx = prof.length - 1;
  }
  const cur = prof[idx];
  const nxt = idx >= 0 ? prof[idx + 1] : null;
  return { prof, total, cur, nxt };
}

function drawLowerThird(ctx, m, d) {
  const o = m.lt;
  const zc = zoneColor(d.zone);
  const { prof, total, cur, nxt } = nextInfo(d);
  const nc = d.nextZone ? zoneColor(d.nextZone) : nxt ? zoneColor(nxt.zone) : zc;
  plate(ctx, o);
  ctx.fillStyle = zc;
  ctx.fillRect(o.x + 14, o.y, 32, 2);
  const ix = o.x + 15;
  const iw = o.w - 30;
  const hy = o.y + 1 + m.ltPadT;
  // Cuenta atrás
  font(ctx, 700, 10.5);
  text(ctx, 'QUEDA', ix, hy + 5.75, { spacing: 1.05, color: C.lbl });
  const left = asClock(d.segRemaining ?? 0);
  const final = typeof d.segRemaining === 'number' && d.segRemaining <= 3 && !!(nxt || d.nextLabel);
  font(ctx, 700, m.cdFs, true);
  const timeY = hy + 11.5 + 7 + (m.cdFs * 0.86) / 2;
  const tW = text(ctx, left, ix, timeY, { spacing: -0.035 * m.cdFs, color: final ? nc : C.white, tab: true });
  // Siguiente
  const raw = String(d.nextLabel ?? '');
  const parts = raw.split(' · ');
  const dur = parts.length > 1 ? parts.pop() : '';
  const val = parts.join(' · ') || '¡A por el final!';
  const last = !raw;
  const headBottom = hy + m.headH;
  const nvY = headBottom - 1 - 11;
  ctx.save();
  if (d.deck) ctx.globalAlpha *= 0; // la tira «Siguiente» (motion.js) es ese mismo dato levantado: sin duplicados
  font(ctx, 700, 20, true);
  const maxVal = iw - tW - 16 - 22 - 8;
  const vW = text(ctx, val, ix + iw, nvY, { align: 'right', maxW: maxVal, tab: true, spacing: -0.2 });
  const ax = ix + iw - vW - 8 - 11;
  ctx.beginPath();
  ctx.arc(ax, nvY, 11, 0, Math.PI * 2);
  ctx.fillStyle = last ? 'rgba(255, 255, 255, 0.14)' : nc;
  ctx.fill();
  let dir = 0;
  if (cur && nxt) dir = nxt.speed - cur.speed > 0.05 ? 1 : nxt.speed - cur.speed < -0.05 ? -1 : 0;
  else if (d.nextDir) dir = Math.sign(d.nextDir);
  if (last) {
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(ax - 3, nvY + 5); ctx.lineTo(ax - 3, nvY - 5); ctx.lineTo(ax + 4, nvY - 3.5); ctx.lineTo(ax - 3, nvY - 1);
    ctx.stroke();
    ctx.restore();
  } else arrowGlyph(ctx, ax, nvY, dir, '#000');
  font(ctx, 700, 10.5);
  const lbl = last ? 'ÚLTIMO TRAMO' : `SIGUIENTE${dur ? ` · ${dur}` : ''}`;
  text(ctx, lbl, ix + iw, nvY - 11 - 9 - 5.75, { spacing: 1.05, align: 'right', color: C.lbl });
  ctx.restore();
  // Barra de progreso del tramo (color de la zona); últimos 10 s: 10 marcas que se apagan una por segundo (motion.js)
  const by = headBottom + m.barGap;
  const ticks = Number.isFinite(Number(d.ticks)) && d.ticks != null ? clamp(Math.round(Number(d.ticks)), 0, 10) : null;
  if (ticks != null) {
    const tw = (iw - 9 * 3) / 10;
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i >= ticks ? 'rgba(255, 255, 255, 0.13)' : i >= 7 ? nc : zc;
      rrect(ctx, ix + i * (tw + 3), by, tw, 3, 1);
      ctx.fill();
    }
  } else {
    rrect(ctx, ix, by, iw, 3, 2);
    ctx.fillStyle = C.track;
    ctx.fill();
  }
  const sp = ticks != null ? 0 : clamp(Number(d.segProgress) || 0, 0, 1);
  if (sp > 0) {
    ctx.save();
    rrect(ctx, ix, by, iw, 3, 2);
    ctx.clip();
    ctx.fillStyle = zc;
    ctx.fillRect(ix, by, iw * sp, 3);
    ctx.restore();
  }
  // Mini perfil con cursor
  const sy = by + 3 + m.stripGap;
  const sh = m.stripH;
  if (prof.length && total > 0) {
    const speeds = prof.map((s) => Number(s.speed) || 0).filter((v) => v > 0);
    const maxS = Math.max(1, ...speeds);
    const minS = speeds.length ? Math.min(...speeds) : 0;
    const base = Math.max(0, minS * 0.62);
    const cur01 = d.cursor == null ? 0 : Number(d.cursor) > 1 ? Number(d.cursor) / total : Number(d.cursor);
    const cx = ix + iw * clamp(cur01, 0, 1);
    let t = 0;
    for (const s of prof) {
      const x0 = ix + (t / total) * iw;
      const w0 = (Number(s.sec) / total) * iw;
      t += Number(s.sec);
      const gap = Math.min(3 * (iw / 1000), w0 * 0.3);
      const n = clamp(((Number(s.speed) || 0) - base) / Math.max(0.1, maxS - base), 0.12, 1);
      const bh = (4 + 32 * n) * (sh / 36);
      const bx = x0 + gap / 2;
      const bw = Math.max(0.6 * (iw / 1000), w0 - gap);
      ctx.fillStyle = zoneColor(s.zone);
      // futuro atenuado (0,42); lo ya corrido, entero
      if (bx + bw <= cx) {
        ctx.globalAlpha = 1;
        ctx.fillRect(bx, sy + sh - bh, bw, bh);
      } else if (bx >= cx) {
        ctx.globalAlpha = 0.42;
        ctx.fillRect(bx, sy + sh - bh, bw, bh);
      } else {
        ctx.globalAlpha = 1;
        ctx.fillRect(bx, sy + sh - bh, cx - bx, bh);
        ctx.globalAlpha = 0.42;
        ctx.fillRect(cx, sy + sh - bh, bx + bw - cx, bh);
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(5, 6, 8, 0.6)';
    rrect(ctx, cx - 2, sy - 4, 4, sh + 8, 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    rrect(ctx, cx - 1, sy - 3, 2, sh + 6, 1);
    ctx.fill();
  }
}

function drawInfo(ctx, m, d) {
  const o = m.info;
  const zc = zoneColor(d.zone);
  plate(ctx, o);
  const ix = o.x + 15;
  const iw = o.w - 30;
  const my = o.y + 1 + m.infoPad + 18.7 / 2;
  // Grupos: DIST. 0,49 km | KCAL 34 | FC [Z4] 141–158 (justify-content: space-between, separadores de 1 px)
  const hr = String(d.hrText ?? '');
  const hrM = /^\s*(Z\d)\s*[·\-–]?\s*(.*)$/.exec(hr);
  const chip = hrM ? hrM[1] : '';
  const hrVal = hrM ? hrM[2] : hr || '–';
  const items = [
    { lbl: 'DIST.', val: typeof d.distanceKm === 'number' ? nf2(d.distanceKm) : String(d.distanceKm ?? '0,00'), unit: 'km' },
    { lbl: 'KCAL', val: String(typeof d.kcal === 'number' ? Math.round(d.kcal) : d.kcal ?? '0') },
    { lbl: 'FC', chip, val: hrVal },
  ];
  const widths = items.map((it) => {
    font(ctx, 700, 10.5);
    let w = spacedWidth(ctx, it.lbl, 1.05) + 6;
    if (it.chip) { font(ctx, 700, 10, true); w += spacedWidth(ctx, it.chip, 0.2, true) + 10 + 6; }
    font(ctx, 700, 17, true);
    w += spacedWidth(ctx, it.val, -0.17, true);
    if (it.unit) { font(ctx, 600, 11); w += 4 + ctx.measureText(it.unit).width; }
    return w;
  });
  const used = widths.reduce((a, b) => a + b, 0) + 2;
  const gap = Math.max(10, (iw - used) / 4);
  font(ctx, 700, 17, true);
  const mb = baseOf(ctx, my);
  let x = ix;
  items.forEach((it, i) => {
    font(ctx, 700, 10.5);
    x += text(ctx, it.lbl, x, mb, { spacing: 1.05, color: C.lbl, baseline: true }) + 6;
    if (it.chip) {
      font(ctx, 700, 10, true);
      const cw = spacedWidth(ctx, it.chip, 0.2, true) + 10;
      rrect(ctx, x, my - 7, cw, 15.5, 4);
      ctx.fillStyle = zc;
      ctx.fill();
      text(ctx, it.chip, x + 5, my + 0.75, { color: '#000', spacing: 0.2, tab: true });
      x += cw + 6;
    }
    font(ctx, 700, 17, true);
    x += text(ctx, it.val, x, mb, { baseline: true, spacing: -0.17, tab: true });
    if (it.unit) {
      font(ctx, 600, 11);
      x += 4;
      x += text(ctx, it.unit, x, mb, { color: C.ink2, baseline: true });
    }
    if (i < items.length - 1) {
      x += gap;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(x, my - 8, 1, 16);
      x += 1 + gap;
    }
  });
  if (!m.hasNp) return;
  // «Sonando»: una sola línea con elipsis
  const ly = o.y + 1 + m.infoPad + 18.7 + (m.land ? 8 : 9);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fillRect(ix, ly, iw, 1);
  const ty = ly + 1 + (m.land ? 8 : 9) + 15.6 / 2;
  const heights = [0.55, 0.95, 0.6, 0.75];
  ctx.fillStyle = zc;
  heights.forEach((k, i) => {
    const bh = 13 * k;
    rrect(ctx, ix + i * 4.25, ty + 6.5 - bh, 2.75, bh, 1.2);
    ctx.fill();
  });
  font(ctx, 600, 12.5);
  text(ctx, String(d.nowPlaying || ''), ix + 17 + 9, ty, { color: C.ink2, maxW: iw - 26 });
}

function drawBug(ctx, m, b, zc) {
  if (!b) return;
  font(ctx, 700, 11);
  const lbl = String(b.lbl || '').toUpperCase();
  const lw = spacedWidth(ctx, lbl, 1.54);
  font(ctx, 700, 22, true);
  const val = String(b.val ?? '');
  const vw = spacedWidth(ctx, val, -0.22, true);
  font(ctx, 700, 13, true);
  const sw = b.sub ? spacedWidth(ctx, String(b.sub), 0, true) + 9 : 0;
  const w = 1 + 17 + lw + 9 + vw + sw + 14 + 1;
  const h = 1 + 9 + 22 + 9 + 1;
  const x = m.top.x + m.top.w - w;
  const y = m.topY + m.topH + 10;
  plate(ctx, { x, y, w, h }, 10);
  ctx.save();
  rrect(ctx, x, y, w, h, 10);
  ctx.clip();
  ctx.fillStyle = b.color || zc;
  ctx.fillRect(x, y, 3, h);
  ctx.restore();
  font(ctx, 700, 22, true);
  const bb = baseOf(ctx, y + h / 2);
  font(ctx, 700, 11);
  text(ctx, lbl, x + 18, bb, { spacing: 1.54, color: C.lbl, baseline: true });
  font(ctx, 700, 22, true);
  text(ctx, val, x + 18 + lw + 9, bb, { baseline: true, spacing: -0.22, tab: true });
  if (b.sub) {
    font(ctx, 700, 13, true);
    text(ctx, String(b.sub), x + 18 + lw + 9 + vw + 9, bb, { color: C.ink2, baseline: true, tab: true });
  }
}

/**
 * Dibuja el HUD de retransmisión encima de lo que ya haya en el lienzo (la escena). w, h en px CSS: si el lienzo
 * tiene DPR > 1, aplica antes ctx.setTransform(dpr, 0, 0, dpr, 0, 0).
 */
export function drawHud(ctx, w, h, data = {}, orientation = (w > h ? 'landscape' : 'portrait')) {
  if (!ctx || !(w > 0) || !(h > 0)) return;
  const d = data || {};
  const m = metricsFor(w, h, orientation === 'landscape' ? 'landscape' : 'portrait', d);
  ctx.save();
  try {
    drawTop(ctx, m, d);
    drawSpeed(ctx, m, d);
    drawLowerThird(ctx, m, d);
    drawDeck(ctx, m, d.deck);
    drawInfo(ctx, m, d);
    drawBug(ctx, m, d.bug, zoneColor(d.zone));
  } finally {
    ctx.restore();
  }
}

/**
 * Rótulo final (.hud-done de css/player.css): aro con ✓, clase, título, «3,15 km · 20:00 · 269 kcal», botón «Ver
 * resumen» y «Toca la pantalla para saltar». alpha 0..1 y rise (px, entra subiendo como hud-rise).
 */
export function drawDone(ctx, w, h, done = {}, orientation = (w > h ? 'landscape' : 'portrait'), { alpha = 1, rise = 0 } = {}) {
  if (!ctx || !(w > 0) || !(h > 0) || alpha <= 0) return;
  const land = orientation === 'landscape';
  const safe = { ...(land ? SAFE.landscape : SAFE.portrait), ...(done.safe || {}) };
  const gx = Math.max(16, safe.l);
  const gxr = Math.max(16, safe.r);
  const boxW = land ? w : Math.min(w, 640);
  const pw = land ? Math.min((w - gx - gxr) * 0.44, 480) : boxW - gx - gxr;
  const px = land ? w - gxr - pw : (w - boxW) / 2 + gx;
  // columnas como la rejilla CSS: aro 46 · texto 1fr · botón auto, separación 14, relleno 16
  font(ctx, 700, 15);
  const bw = spacedWidth(ctx, 'Ver resumen') + 32;
  const tw = pw - 32 - 46 - bw - 28;
  // el título y las cifras se parten en líneas como en CSS (sin recorte)
  const wrap = (str, spacing = 0) => {
    const out = [];
    let cur = '';
    for (const word of String(str || '').split(' ')) {
      const tryS = cur ? `${cur} ${word}` : word;
      if (cur && spacedWidth(ctx, tryS, spacing) > tw) { out.push(cur); cur = word; } else cur = tryS;
    }
    if (cur) out.push(cur);
    return out;
  };
  font(ctx, 700, 18);
  const titleLines = wrap(done.title || '¡Entrenamiento completado!', -0.18);
  font(ctx, 600, 14, true);
  const statLines = wrap(done.stats || '');
  const txtH = 12 + 5 + titleLines.length * 20.7 + 5 + statLines.length * 16.8;
  const rowH = Math.max(46, 44, txtH);
  const ph = 14 + rowH + 12 + 12 + 12;
  const bottom = land ? Math.max(10, safe.b + 4) : safe.b + 10;
  const py = h - bottom - ph + rise;
  ctx.save();
  try {
    ctx.globalAlpha = clamp(alpha, 0, 1);
    plate(ctx, { x: px, y: py, w: pw, h: ph });
    ctx.fillStyle = '#30D158';
    ctx.fillRect(px + 16, py, 32, 2);
    const cy = py + 14 + rowH / 2;
    // aro con ✓ (se dibuja como .hud-done__prog)
    const cx = px + 16 + 23;
    const r = 21 * 46 / 48;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#30D158';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(done.ring ?? 1, 0, 1)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 7, cy + 0.5); ctx.lineTo(cx - 2, cy + 5.5); ctx.lineTo(cx + 8, cy - 5); ctx.stroke();
    // botón «Ver resumen»
    const bx = px + pw - 16 - bw;
    rrect(ctx, bx, cy - 22, bw, 44, 22);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    font(ctx, 700, 15);
    text(ctx, 'Ver resumen', bx + bw / 2, cy, { align: 'center', color: '#000000' });
    // textos (bloque centrado en la fila)
    const tx = px + 16 + 46 + 14;
    let y = cy - txtH / 2;
    font(ctx, 700, 10.5);
    text(ctx, String(done.label || '').toUpperCase(), tx, y + 6, { spacing: 1.05, color: C.lbl, maxW: tw });
    y += 12 + 5;
    font(ctx, 700, 18);
    for (const ln of titleLines) { text(ctx, ln, tx, y + 10.35, { spacing: -0.18 }); y += 20.7; }
    y += 5;
    font(ctx, 600, 14, true);
    for (const ln of statLines) { text(ctx, ln, tx, y + 8.4, { color: C.ink2, tab: true }); y += 16.8; }
    font(ctx, 600, 11.5);
    text(ctx, 'Toca la pantalla para saltar', px + pw / 2, py + ph - 12 - 6, { align: 'center', color: C.lbl });
  } finally {
    ctx.restore();
  }
}

/** Tira «Siguiente» (.mo-deck de css/motion.css): 36 px, 8 px sobre el lower third, entra con un barrido a la derecha. */
function drawDeck(ctx, m, k) {
  if (!k) return;
  const o = m.lt;
  const reveal = clamp(k.reveal ?? 1, 0, 1);
  if (reveal <= 0) return;
  const dc = zoneColor(k.zone);
  const x = o.x;
  const w = o.w;
  const h = 36;
  const y = o.y - 8 - h;
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(x - 1, y - 1, (w + 2) * reveal, h + 2);
    ctx.clip();
    plate(ctx, { x, y, w, h }, 10);
    const cy = y + h / 2;
    rrect(ctx, x + 12, cy - 8, 3, 16, 2);
    ctx.fillStyle = dc;
    ctx.fill();
    let cx = x + 12 + 3 + 8;
    font(ctx, 700, 10.5);
    cx += text(ctx, 'SIGUIENTE', cx, cy, { spacing: 1.26, color: C.lbl }) + 8;
    // derecha: «11,5 km/h · 1:30»
    font(ctx, 700, 13, true);
    const durTxt = String(k.dur || '');
    let rx = x + w - 12;
    if (durTxt) {
      const dw = text(ctx, durTxt, rx, cy, { align: 'right', color: C.ink2, tab: true });
      rx -= dw + 7;
      text(ctx, '·', rx, cy, { align: 'right', color: C.lbl });
      rx -= ctx.measureText('·').width + 8;
    }
    font(ctx, 600, 11);
    const uw = text(ctx, 'km/h', rx, cy + 1, { align: 'right', color: C.ink2 });
    rx -= uw + 4;
    font(ctx, 700, 18, true);
    const sw = text(ctx, String(k.speed ?? ''), rx, cy, { align: 'right', tab: true, spacing: -0.18 });
    rx -= sw + 8;
    font(ctx, 700, 12.5);
    text(ctx, String(k.name || '').toUpperCase(), cx, cy, { spacing: 1.5, color: dc, maxW: Math.max(10, rx - cx) });
    // temporizador propio (2 px abajo)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(x + 12, y + h - 2, w - 24, 2);
    ctx.fillStyle = dc;
    ctx.fillRect(x + 12, y + h - 2, (w - 24) * clamp(k.timer ?? 0, 0, 1), 2);
  } finally {
    ctx.restore();
  }
}
