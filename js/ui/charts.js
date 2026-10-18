// BestRunning · gráficos SVG (responsive con viewBox, tipografía del sistema, animación de entrada por CSS).
import { esc, fmt, clamp, todayKey, addDays, mondayOf, parseKey } from '../core/utils.js';

let uidN = 0;
const nextId = (p) => `${p}${++uidN}`;
const r2 = (n) => Math.round(n * 100) / 100;

/** Formato numérico es-ES por defecto (los llamadores pueden pasar el suyo). */
const nfAuto = (v) => {
  if (typeof v !== 'number' || !isFinite(v)) return String(v ?? '');
  const abs = Math.abs(v);
  const d = abs >= 100 || Number.isInteger(v) ? 0 : abs >= 10 ? 1 : 2;
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: d }).format(v);
};
const pickFormat = (f) => (typeof f === 'function' && f !== String ? f : nfAuto);

function niceTicks(min, max, count = 4) {
  if (!isFinite(min) || !isFinite(max)) return { lo: 0, hi: 1, ticks: [0, 1] };
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 2.25 ? 2 : norm < 3.5 ? 2.5 : norm < 7.5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks };
}

/** Curva monótona (Fritsch–Carlson): suave y sin sobrepasar los datos. */
function monotonePath(pts) {
  const n = pts.length;
  if (!n) return '';
  if (n === 1) return `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
  if (n === 2) return `M${r2(pts[0][0])} ${r2(pts[0][1])}L${r2(pts[1][0])} ${r2(pts[1][1])}`;
  const dx = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0;
  }
  const t = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t[i] = 0;
    else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
    }
  }
  let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${r2(pts[i][0] + h)} ${r2(pts[i][1] + t[i] * h)} ${r2(pts[i + 1][0] - h)} ${r2(pts[i + 1][1] - t[i + 1] * h)} ${r2(pts[i + 1][0])} ${r2(pts[i + 1][1])}`;
  }
  return d;
}

function emptyChart(height, text = 'Sin datos todavía') {
  return `<div class="chart chart--empty" style="min-height:${Math.round(height * 0.6)}px"><span>${esc(text)}</span></div>`;
}

/* ═════════════ Líneas ═════════════ */

export function lineChart(series, { height = 180, yFormat = String, xFormat = String, yMin = null, yMax = null, area = false } = {}) {
  const list = (Array.isArray(series) ? series : [])
    .map((s) => ({
      name: s?.name ?? '',
      color: s?.color || 'var(--accent)',
      points: (Array.isArray(s?.points) ? s.points : [])
        .filter((p) => p && isFinite(p.x) && isFinite(p.y))
        .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
        .sort((a, b) => a.x - b.x),
    }))
    .filter((s) => s.points.length);
  if (!list.length) return emptyChart(height);

  const fy = pickFormat(yFormat);
  const fx = pickFormat(xFormat);
  const W = 360;
  const H = Math.max(80, Number(height) || 180);
  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 24;

  const xs = list.flatMap((s) => s.points.map((p) => p.x));
  const ys = list.flatMap((s) => s.points.map((p) => p.y));
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  if (x0 === x1) {
    x0 -= 1;
    x1 += 1;
  }
  const { lo, hi, ticks } = niceTicks(yMin ?? Math.min(...ys), yMax ?? Math.max(...ys), 4);
  const yLo = yMin ?? lo;
  const yHi = yMax ?? hi;
  const X = (x) => padL + ((x - x0) / (x1 - x0)) * (W - padL - padR);
  const Y = (y) => padT + (1 - (y - yLo) / ((yHi - yLo) || 1)) * (H - padT - padB);

  const id = nextId('lc');
  let grid = '';
  ticks
    .filter((v) => v >= yLo - 1e-9 && v <= yHi + 1e-9)
    .forEach((v) => {
      const y = r2(Y(v));
      grid += `<line class="chart__grid" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/><text class="chart__ylabel" x="${padL - 7}" y="${y + 3.5}" text-anchor="end">${esc(fy(v))}</text>`;
    });

  // Etiquetas del eje X: 5 marcas repartidas
  let xl = '';
  const nX = 4;
  for (let i = 0; i <= nX; i++) {
    const v = x0 + ((x1 - x0) * i) / nX;
    const anchor = i === 0 ? 'start' : i === nX ? 'end' : 'middle';
    xl += `<text class="chart__xlabel" x="${r2(X(v))}" y="${H - 6}" text-anchor="${anchor}">${esc(fx(v))}</text>`;
  }

  let defs = '';
  let lines = '';
  list.forEach((s, si) => {
    const pts = s.points.map((p) => [X(p.x), Y(p.y)]);
    const d = monotonePath(pts);
    const color = esc(s.color);
    if (area && pts.length > 1) {
      const gid = `${id}-a${si}`;
      defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${color};stop-opacity:.32"/><stop offset="1" style="stop-color:${color};stop-opacity:0"/></linearGradient>`;
      const baseY = r2(H - padB);
      lines += `<path class="chart__area" d="${d}L${r2(pts[pts.length - 1][0])} ${baseY}L${r2(pts[0][0])} ${baseY}Z" fill="url(#${gid})"/>`;
    }
    if (pts.length > 1) {
      lines += `<path class="chart__line" d="${d}" pathLength="1" fill="none" style="stroke:${color};--i:${si}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    const [lx, ly] = pts[pts.length - 1];
    lines += `<circle class="chart__halo" cx="${r2(lx)}" cy="${r2(ly)}" r="6.5" style="fill:${color}" opacity=".22"/><circle class="chart__dot" cx="${r2(lx)}" cy="${r2(ly)}" r="3.4" style="fill:${color}" stroke="#08080a" stroke-width="1.5"/>`;
  });

  const legend =
    list.length > 1 || list[0].name
      ? `<div class="chart__legend">${list.map((s) => `<span class="chart__key"><i style="background:${esc(s.color)}"></i>${esc(s.name)}</span>`).join('')}</div>`
      : '';

  return `<div class="chart chart--line"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de líneas"><defs>${defs}</defs>${grid}${lines}${xl}</svg>${legend}</div>`;
}

/* ═════════════ Barras ═════════════ */

function topRoundedBar(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  const b = y + h;
  return `M${r2(x)} ${r2(b)}V${r2(y + rr)}Q${r2(x)} ${r2(y)} ${r2(x + rr)} ${r2(y)}H${r2(x + w - rr)}Q${r2(x + w)} ${r2(y)} ${r2(x + w)} ${r2(y + rr)}V${r2(b)}Z`;
}

export function barChart(bars, { height = 160, valueFormat = String } = {}) {
  const list = (Array.isArray(bars) ? bars : []).map((b) => ({
    label: b?.label ?? '',
    value: Math.max(0, Number(b?.value) || 0),
    color: b?.color || null,
    highlight: !!b?.highlight,
  }));
  if (!list.length) return emptyChart(height);
  const fv = pickFormat(valueFormat);
  const W = 360;
  const H = Math.max(80, Number(height) || 160);
  const padT = 20;
  const padB = 22;
  const n = list.length;
  const slot = W / n;
  const bw = Math.min(30, slot * 0.62);
  const max = Math.max(...list.map((b) => b.value));
  const anyHi = list.some((b) => b.highlight);
  const chartH = H - padT - padB;
  const id = nextId('bc');
  const everyOther = n > 8;

  let out = '';
  list.forEach((b, i) => {
    const cx = slot * i + slot / 2;
    const h = max > 0 ? Math.max(b.value > 0 ? 3 : 2, (b.value / max) * chartH) : 2;
    const y = padT + chartH - h;
    const color = esc(b.color || 'var(--accent)');
    const dim = anyHi && !b.highlight;
    // Degradado ember para la barra destacada (o para todas si no hay color propio ni destacadas)
    const fill = (b.highlight && !b.color) || (!anyHi && !b.color) ? `url(#${id}-g)` : color;
    out += `<path class="chart__bar${b.value <= 0 ? ' is-zero' : ''}${b.highlight ? ' is-hi' : ''}" d="${topRoundedBar(cx - bw / 2, y, bw, h, Math.min(7, bw / 2))}" style="fill:${fill};--i:${i}"${dim ? ' opacity=".42"' : ''}/>`;
    const showVal = b.highlight || (!anyHi && i === n - 1);
    if (showVal && b.value > 0) {
      out += `<text class="chart__value" x="${r2(cx)}" y="${r2(y - 6)}" text-anchor="middle">${esc(fv(b.value))}</text>`;
    }
    if (!everyOther || i % 2 === (n - 1) % 2) {
      out += `<text class="chart__xlabel${b.highlight ? ' is-hi' : ''}" x="${r2(cx)}" y="${H - 6}" text-anchor="middle">${esc(b.label)}</text>`;
    }
  });

  const baseY = r2(padT + chartH);
  return `<div class="chart chart--bar"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras"><defs><linearGradient id="${id}-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF9500"/><stop offset=".55" stop-color="#FF5A1F"/><stop offset="1" stop-color="#FF2D55"/></linearGradient></defs><line class="chart__base" x1="0" x2="${W}" y1="${baseY}" y2="${baseY}"/>${out}</svg></div>`;
}

/* ═════════════ Calendario de calor ═════════════ */

export function heatmapCalendar(valuesByDay, { weeks = 16, endKey = todayKey(), color = 'var(--accent)' } = {}) {
  const vals = valuesByDay && typeof valuesByDay === 'object' ? valuesByDay : {};
  const nW = clamp(Math.round(Number(weeks) || 16), 1, 60);
  const end = typeof endKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endKey) ? endKey : todayKey();
  const startMonday = addDays(mondayOf(end), -(nW - 1) * 7);
  const cell = 13;
  const gap = 3.2;
  const step = cell + gap;
  const padL = 16;
  const padT = 15;
  const W = padL + nW * step - gap;
  const H = padT + 7 * step - gap;
  const today = todayKey();

  let max = 0;
  for (let i = 0; i < nW * 7; i++) {
    const k = addDays(startMonday, i);
    if (k > end) break;
    max = Math.max(max, Number(vals[k]) || 0);
  }

  const levelOf = (v) => (v <= 0 || max <= 0 ? 0 : clamp(Math.ceil((v / max) * 4), 1, 4));
  const OP = [0, 0.32, 0.55, 0.78, 1];
  const c = esc(color);
  let cells = '';
  let months = '';
  let lastMonth = -1;
  // Etiquetas de mes: en la columna que contiene el día 1 (y la primera columna, si su mes ocupa ≥ 2
  // columnas; si no, se omite para que el mes siguiente —el que de verdad llena el mapa— sí se lea)
  const monthMarks = [];
  for (let w = 0; w < nW; w++) {
    const monday = addDays(startMonday, w * 7);
    let mark = null;
    for (let d = 0; d < 7; d++) {
      const dd = parseKey(addDays(monday, d));
      if (dd.getDate() === 1) { mark = dd; break; }
    }
    // Primera columna sin día 1: su mes es el del lunes
    if (!mark && w === 0) mark = parseKey(monday);
    if (mark) {
      const m = mark.getMonth();
      if (m !== lastMonth && (w < nW - 1 || mark.getDate() === 1)) {
        monthMarks.push({ w, m });
        lastMonth = m;
      }
    }
  }
  if (monthMarks.length > 1 && monthMarks[0].w === 0 && monthMarks[1].w < 2) monthMarks.shift();
  for (const { w, m } of monthMarks) {
    months += `<text class="chart__xlabel heat__month" x="${r2(padL + w * step)}" y="10">${esc(fmt.monthAbbr(m))}</text>`;
  }
  for (let w = 0; w < nW; w++) {
    const monday = addDays(startMonday, w * 7);
    for (let d = 0; d < 7; d++) {
      const key = addDays(monday, d);
      if (key > end) continue;
      const v = Number(vals[key]) || 0;
      const lvl = levelOf(v);
      const x = r2(padL + w * step);
      const y = r2(padT + d * step);
      const isToday = key === today;
      const style = lvl ? `style="fill:${c};fill-opacity:${OP[lvl]};--i:${w}"` : `style="--i:${w}"`;
      cells += `<rect class="heat__cell${lvl ? '' : ' is-empty'}${isToday ? ' is-today' : ''}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3.5" ${style}><title>${esc(fmt.dateShort(key))}${v ? ` · ${esc(fmt.int(v))}` : ''}</title></rect>`;
    }
  }
  const wd = [
    [0, 'L'],
    [2, 'X'],
    [4, 'V'],
    [6, 'D'],
  ]
    .map(([d, t]) => `<text class="chart__ylabel" x="0" y="${r2(padT + d * step + cell - 3)}">${t}</text>`)
    .join('');

  const legend = `<div class="heat__legend"><span>Menos</span>${OP.map((o, i) => `<i class="${i ? '' : 'is-empty'}" style="${i ? `background:${c};opacity:${o}` : ''}"></i>`).join('')}<span>Más</span></div>`;
  return `<div class="chart chart--heat"><svg viewBox="0 0 ${r2(W)} ${r2(H)}" role="img" aria-label="Calendario de actividad de ${nW} semanas">${months}${wd}${cells}</svg>${legend}</div>`;
}

/* ═════════════ Sparkline ═════════════ */

export function sparkline(values, { color = 'var(--accent)', height = 32 } = {}) {
  const vals = (Array.isArray(values) ? values : []).map(Number).filter((v) => isFinite(v));
  const W = 100;
  const H = Math.max(8, Number(height) || 32);
  const c = esc(color);
  if (vals.length < 2) {
    const y = r2(H / 2);
    return `<svg class="sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px" aria-hidden="true"><line x1="0" x2="${W}" y1="${y}" y2="${y}" style="stroke:${c}" stroke-opacity=".35" stroke-width="2" vector-effect="non-scaling-stroke" stroke-dasharray="3 4"/></svg>`;
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = 2.5;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * W, pad + (1 - (v - min) / ((max - min) || 1)) * (H - pad * 2)]);
  const d = monotonePath(pts);
  const id = nextId('sp');
  return `<svg class="sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${c};stop-opacity:.28"/><stop offset="1" style="stop-color:${c};stop-opacity:0"/></linearGradient></defs><path d="${d}L${W} ${H}L0 ${H}Z" fill="url(#${id})"/><path d="${d}" fill="none" style="stroke:${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

/* ═════════════ Medidor semicircular ═════════════ */

export function gauge({ value, min = 0, max = 100, label = '', sublabel = '', color = 'var(--accent)' } = {}) {
  const v = Number(value);
  const lo = Number(min) || 0;
  const hi = Number(max) > lo ? Number(max) : lo + 1;
  const p = isFinite(v) ? clamp((v - lo) / (hi - lo), 0, 1) : 0;
  const W = 220;
  const H = 128;
  const cx = W / 2;
  const cy = 112;
  const r = 92;
  const sw = 14;
  const id = nextId('gg');
  const pt = (f) => {
    const a = Math.PI * (1 - f);
    return [r2(cx + r * Math.cos(a)), r2(cy - r * Math.sin(a))];
  };
  const [sx, sy] = pt(0);
  const [ex, ey] = pt(1);
  const [vx, vy] = pt(p);
  const c = esc(color);
  const valText = isFinite(v) ? fmt.dec1(v) : '–';
  const ticks = [0.25, 0.5, 0.75]
    .map((f) => {
      const a = Math.PI * (1 - f);
      const x1 = r2(cx + (r - sw / 2 - 5) * Math.cos(a));
      const y1 = r2(cy - (r - sw / 2 - 5) * Math.sin(a));
      const x2 = r2(cx + (r - sw / 2 - 10) * Math.cos(a));
      const y2 = r2(cy - (r - sw / 2 - 10) * Math.sin(a));
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="gauge__tick"/>`;
    })
    .join('');
  return `<div class="chart gauge">
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label || 'Indicador')}: ${esc(valText)}">
    <defs>
      <linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${cx - r}" y1="0" x2="${cx + r}" y2="0">
        <stop offset="0" style="stop-color:${c};stop-opacity:.45"/><stop offset="1" style="stop-color:${c};stop-opacity:1"/>
      </linearGradient>
      <filter id="${id}-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
    </defs>
    <path d="M${sx} ${sy}A${r} ${r} 0 0 1 ${ex} ${ey}" fill="none" class="gauge__track" stroke-width="${sw}" stroke-linecap="round"/>
    ${ticks}
    ${p > 0 ? `<path class="gauge__value" d="M${sx} ${sy}A${r} ${r} 0 0 1 ${vx} ${vy}" pathLength="1" fill="none" stroke="url(#${id})" stroke-width="${sw}" stroke-linecap="round"/>` : ''}
    <circle cx="${vx}" cy="${vy}" r="9" style="fill:${c}" opacity=".55" filter="url(#${id}-glow)" class="gauge__knob-glow"/>
    <circle cx="${vx}" cy="${vy}" r="6" fill="#fff" class="gauge__knob"/>
    <text class="gauge__val" x="${cx}" y="${cy - 14}" text-anchor="middle">${esc(valText)}</text>
    <text class="chart__xlabel" x="${r2(sx)}" y="${H - 1}" text-anchor="middle">${esc(nfAuto(lo))}</text>
    <text class="chart__xlabel" x="${r2(ex)}" y="${H - 1}" text-anchor="middle">${esc(nfAuto(hi))}</text>
  </svg>
  ${label || sublabel ? `<div class="gauge__labels">${label ? `<div class="gauge__label">${esc(label)}</div>` : ''}${sublabel ? `<div class="gauge__sub">${esc(sublabel)}</div>` : ''}</div>` : ''}
</div>`;
}
