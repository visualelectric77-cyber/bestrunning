// BestRunning · escena 3D · composición respecto al HUD (SPEC §15.3: SOLO INFORMACIÓN, NUNCA MÁSCARAS).
// A partir de los rectángulos que ocupa el HUD del reproductor (px CSS relativos al lienzo, `setHudRects`) calcula
// dónde hay espacio libre para que un escenario coloque su acción o su tipografía 3D sin quedar detrás de los datos:
//  - rects: rectángulos normalizados { x, y, w, h, r, kind } (kind: 'top' | 'speed' | 'segment' | 'panel' | …)
//  - free:  el mayor rectángulo libre útil (px CSS, origen arriba-izquierda)
//  - band:  en vertical, la mayor banda horizontal libre de ancho casi completo (o null)
//  - speed: el rectángulo del número de velocidad (o null) — zona que debe quedar serena por composición
// Sin setHudRects se usa una disposición por defecto que imita el HUD de retransmisión (§16).
import { clamp01 } from './util.js';

const INFLATE = 6;         // px CSS de margen alrededor de cada bloque
const SAFE_TOP = 0.055;    // isla dinámica / barra de estado
const SAFE_BOTTOM = 0.035; // indicador de inicio
const MAX_RECTS = 48;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

/** Normaliza un rectángulo: admite {x,y,w,h}, {left,top,width,height} o {left,top,right,bottom}. */
export function normRect(r) {
  if (!r || typeof r !== 'object') return null;
  const x = Number.isFinite(num(r.x)) ? num(r.x) : num(r.left);
  const y = Number.isFinite(num(r.y)) ? num(r.y) : num(r.top);
  let w = Number.isFinite(num(r.w)) ? num(r.w) : num(r.width);
  let h = Number.isFinite(num(r.h)) ? num(r.h) : num(r.height);
  if (!Number.isFinite(w) && Number.isFinite(num(r.right))) w = num(r.right) - x;
  if (!Number.isFinite(h) && Number.isFinite(num(r.bottom))) h = num(r.bottom) - y;
  if (![x, y, w, h].every(Number.isFinite) || w < 2 || h < 2) return null;
  const rad = Number.isFinite(num(r.r)) ? num(r.r) : Number.isFinite(num(r.radius)) ? num(r.radius) : 12;
  return { x, y, w, h, r: Math.max(0, rad), kind: typeof r.kind === 'string' ? r.kind : 'panel' };
}

/** Disposición por defecto (px CSS) parecida al HUD de retransmisión de §16. */
export function defaultHudRects(W, H, tv = false) {
  const R = (x0, y0, x1, y1, kind) => ({ x: x0 * W, y: y0 * H, w: (x1 - x0) * W, h: (y1 - y0) * H, r: 12, kind });
  const a = W / H;
  if (tv) {
    return a > 1.1
      ? [R(0.04, 0.18, 0.4, 0.66, 'speed'), R(0.58, 0.72, 0.96, 0.92, 'segment')]
      : [R(0.1, 0.16, 0.9, 0.4, 'speed'), R(0.05, 0.8, 0.95, 0.94, 'segment')];
  }
  if (a > 1.1) {
    return [
      R(0.035, 0.035, 0.965, 0.1, 'top'),
      R(0.04, 0.2, 0.4, 0.72, 'speed'),
      R(0.55, 0.6, 0.965, 0.93, 'segment'),
    ];
  }
  return [
    R(0.045, 0.06, 0.955, 0.095, 'top'),
    R(0.1, 0.17, 0.9, 0.38, 'speed'),
    R(0.045, 0.765, 0.955, 0.94, 'segment'),
  ];
}

export function createLayout() {
  let given = null;
  let W = 1;
  let H = 1;
  let tv = false;
  let dirty = true;
  const grid = { occ: new Uint8Array(0), heights: new Int32Array(0), stack: new Int32Array(0) };
  const out = {
    rects: [],
    custom: false,
    width: 1,
    height: 1,
    portrait: true,
    free: { x: 0, y: 0, w: 0, h: 0 },
    band: null,
    speed: null,
    version: 0,
  };

  function findFree(list, portrait) {
    const cell = Math.max(6, Math.max(W, H) / 56);
    const cols = Math.max(4, Math.round(W / cell));
    const rows = Math.max(4, Math.round(H / cell));
    const n = cols * rows;
    if (grid.occ.length < n) grid.occ = new Uint8Array(n);
    if (grid.heights.length < cols + 1) { grid.heights = new Int32Array(cols + 1); grid.stack = new Int32Array(cols + 2); }
    const cw = W / cols;
    const ch = H / rows;
    const occ = grid.occ;
    for (let r = 0; r < rows; r++) {
      const cy = (r + 0.5) * ch;
      const safe = cy < H * SAFE_TOP || cy > H * (1 - SAFE_BOTTOM);
      for (let c = 0; c < cols; c++) {
        const cx = (c + 0.5) * cw;
        let o = safe ? 1 : 0;
        if (!o) {
          for (const q of list) {
            if (cx > q.x - INFLATE && cx < q.x + q.w + INFLATE && cy > q.y - INFLATE && cy < q.y + q.h + INFLATE) { o = 1; break; }
          }
        }
        occ[r * cols + c] = o;
      }
    }
    const heights = grid.heights;
    const stack = grid.stack;
    heights.fill(0);
    let best = null;
    let bestScore = 0;
    let band = null;
    let bandScore = 0;
    const consider = (r, h, left, right) => {
      const wPx = (right - left) * cw;
      const hPx = h * ch;
      if (wPx < 40 || hPx < 24) return;
      const y0 = (r - h + 1) * ch;
      const cyN = (y0 + hPx / 2) / H;
      const area = wPx * hPx;
      const wY = portrait ? 1 - 0.55 * clamp01(Math.abs(cyN - 0.55) / 0.35) : 1 - 0.3 * clamp01(Math.abs(cyN - 0.5) / 0.4);
      const s = area * wY;
      if (s > bestScore) { bestScore = s; best = { x: left * cw, y: y0, w: wPx, h: hPx }; }
      if (wPx >= W * 0.6) {
        const sb = hPx * (1 - 0.3 * clamp01(Math.abs(cyN - 0.55) / 0.3));
        if (sb > bandScore) { bandScore = sb; band = { x: left * cw, y: y0, w: wPx, h: hPx }; }
      }
    };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) heights[c] = occ[r * cols + c] ? 0 : heights[c] + 1;
      heights[cols] = 0;
      let sp = 0;
      for (let c = 0; c <= cols; c++) {
        const hc = heights[c];
        while (sp > 0 && heights[stack[sp - 1]] >= hc) {
          const hh = heights[stack[--sp]];
          const left = sp > 0 ? stack[sp - 1] + 1 : 0;
          if (hh > 0) consider(r, hh, left, c);
        }
        stack[sp++] = c;
      }
    }
    return { best, band };
  }

  function rebuild() {
    dirty = false;
    const list = (given && given.length ? given : defaultHudRects(W, H, tv)).slice(0, MAX_RECTS);
    out.rects = list;
    out.custom = !!(given && given.length);
    out.width = W;
    out.height = H;
    out.portrait = W / H < 0.9;
    const { best, band } = findFree(list, out.portrait);
    out.free = best || { x: 0, y: 0, w: 0, h: 0 };
    out.band = out.portrait ? band : null;
    out.speed = null;
    for (const r of list) if (r.kind === 'speed') { out.speed = r; break; }
    out.version++;
  }

  return {
    out,
    setSize(w, h, isTv) {
      if (w === W && h === H && !!isTv === tv) return;
      W = Math.max(1, w);
      H = Math.max(1, h);
      tv = !!isTv;
      dirty = true;
    },
    /** rects: array (px CSS) o null/[] para volver a la disposición por defecto. */
    setRects(rects) {
      if (!Array.isArray(rects) || !rects.length) { given = null; dirty = true; return; }
      const list = [];
      for (const r of rects) { const q = normRect(r); if (q) list.push(q); }
      given = list.length ? list : null;
      dirty = true;
    },
    update() { if (dirty) rebuild(); return out; },
  };
}
