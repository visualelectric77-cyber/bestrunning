// RITMUP · Salud (pestaña de Progreso y sus pantallas de detalle: #/salud/sueno, #/salud/forma, #/salud/carga).
// Todo sale de cálculos fijos (js/training/health-analysis.js y readiness.js), sin IA: si faltan datos, se dice qué falta.
import { getState } from '../core/store.js';
import { icon, navBar, enableCollapsingHeader, segmented, sectionHeader } from '../ui/components.js';
import { lineChart } from '../ui/charts.js';
import { esc, fmt, todayKey, addDays, daysBetween } from '../core/utils.js';
import { isNative } from '../integrations/native-bridge.js';
import { cachedHealthMetrics, fetchHealthMetrics, healthSleepAvailable } from '../integrations/ai.js';
import { readiness } from '../training/readiness.js';
import {
  fitnessTrend, loadBalance, fitnessText, loadText, sleepSummary, sleepVsHr, sleepHrText, vo2Trend, recoveryTrend,
  weeklyAverages, fmtSleep, theilSen,
} from '../training/health-analysis.js';

const safe = (fn, fallback = null) => {
  try { return fn(); } catch { return fallback; }
};
const shortDate = (key) => fmt.dateShort(key).split(' ').slice(1).join(' ');
const DAY_LETTER = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const dayLetter = (key) => { const [y, m, d] = key.split('-').map(Number); return DAY_LETTER[new Date(y, m - 1, d).getDay()]; };
const signed = (v, unit = '') => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt.int(Math.abs(v))}${unit}`;
const FOOT = 'Datos de Salud de tu iPhone y tu Apple Watch, cruzados con tus clases de RITMUP con cálculos fijos. Todo se analiza en tu iPhone y no sale de él. Orientativo: no es un consejo médico.';

/** Todo lo que necesitan las tarjetas y los detalles, calculado una vez. */
function data(s, today) {
  const history = Array.isArray(s.history) ? s.history.filter(Boolean) : [];
  const m = cachedHealthMetrics();
  return {
    history, m, today,
    r: safe(() => readiness(m, today)),
    f: safe(() => fitnessTrend(history, { today, levels: s.levels })),
    l: safe(() => loadBalance(history, { today, profile: s.profile })),
    sl: safe(() => sleepSummary(m, today, 7)),
    c: safe(() => sleepVsHr(history, m, { today, levels: s.levels })),
    v: safe(() => vo2Trend(m, today)),
    rc: safe(() => recoveryTrend(m, today)),
  };
}

const more = (href, label = 'Ver más') => `<button type="button" class="hl-more" data-href="${href}">${esc(label)}${icon('chevron-right', 14)}</button>`;
const stat = (label, value, unit, sub = '', subCls = '') => `<div class="hl-stat">
  <span class="hl-stat__label">${esc(label)}</span>
  <span class="hl-stat__value num">${value}${unit ? `<small> ${esc(unit)}</small>` : ''}</span>
  ${sub ? `<span class="hl-stat__sub num ${subCls}">${sub}</span>` : ''}
</div>`;

/* ───────────── Tarjetas (pestaña Salud de Progreso) ───────────── */

function readinessCard({ r, sl }) {
  const last = sl?.ok ? sl.last : null;
  if (!r?.title && !last) return '';
  const dot = r?.level === 'green' ? 'var(--ok)' : r?.level === 'amber' ? 'var(--warn)' : 'var(--danger)';
  const stats = [];
  if (r?.resting) stats.push(stat('Reposo', fmt.int(r.resting.now), 'ppm', `${signed(r.resting.delta)} de lo normal`, r.resting.delta >= 3 ? 'is-warn' : r.resting.delta <= 0 ? 'is-ok' : ''));
  if (r?.hrv) stats.push(stat('VFC', fmt.int(r.hrv.now), 'ms', `${signed(r.hrv.pct)} %`, r.hrv.pct <= -10 ? 'is-warn' : r.hrv.pct >= 0 ? 'is-ok' : ''));
  if (last) stats.push(stat('Sueño', fmtSleep(last.asleep), 'h', sl.base != null ? `${signed(last.asleep - sl.base, ' min')}` : 'anoche'));
  return `<div class="card pg-card pg-health">
    <div class="eyebrow">Recuperación · hoy</div>
    ${r?.title ? `<p class="pg-health__title"><span class="pg-health__dot" style="background:${dot}"></span>${esc(r.title)}</p>
    <p class="pg-health__text">${esc(r.text || '')}</p>` : ''}
    ${stats.length ? `<div class="hl-stats hl-stats--${stats.length}">${stats.join('')}</div>` : ''}
  </div>`;
}

function fitnessChart(f, height = 140) {
  const first = f.points[0].day;
  const vals = f.points.map((p) => p.hr);
  return `<div class="pg-chart">${lineChart(
    [{ name: `Pulso a ${fmt.speed(f.ref)} km/h`, color: 'var(--accent)', points: f.points.map((p) => ({ x: daysBetween(first, p.day), y: p.hr })) }],
    { height, yMin: Math.floor((Math.min(...vals) - 4) / 5) * 5, yMax: Math.ceil((Math.max(...vals) + 4) / 5) * 5, yFormat: (v) => fmt.int(v), xFormat: (x) => shortDate(addDays(first, Math.round(x))) },
  )}</div>`;
}

function fitnessWaiting(f) {
  return `<p class="pg-health__text">${(f.have || 0) >= 6
    ? `Ya tienes <b class="num">${fmt.int(f.have)}</b> clases que sirven. Falta tiempo: entre la primera y la última tiene que haber 2 semanas para ver una tendencia de verdad. ${14 - (f.span || 0) <= 1 ? 'Mañana' : `En <b class="num">${fmt.int(14 - (f.span || 0))}</b> días`} verás tu gráfico.`
    : `Para ver si mejoras necesito <b>6 clases con pulso</b> en al menos 2 semanas, con tramos de 1 minuto o más a distintas velocidades (las de cuestas no cuentan). ${(f.withHr || 0) > 0
      ? `De tus <b class="num">${fmt.int(f.withHr)}</b> clases con pulso de las últimas 10 semanas, sirven <b class="num">${fmt.int(f.have || 0)}</b>.`
      : 'Aún no tienes ninguna: importa el pulso del Apple Watch al terminar la próxima.'}`}</p>`;
}

function watchStats({ v, rc }) {
  const out = [];
  if (v) out.push(stat('VO₂ máx · Watch', fmt.dec1(v.last), '', v.change != null ? `${v.change > 0 ? '+' : v.change < 0 ? '−' : '±'}${fmt.dec1(Math.abs(v.change))} en ${v.weeks} sem.` : 'del Apple Watch', v.change > 0 ? 'is-ok' : ''));
  if (rc) out.push(stat('Recuperación 1 min', `−${fmt.int(rc.now)}`, 'ppm', rc.before != null ? `antes −${fmt.int(rc.before)}` : 'al acabar', rc.before != null && rc.now > rc.before ? 'is-ok' : ''));
  return out.length ? `<div class="hl-stats hl-stats--${out.length}">${out.join('')}</div>` : '';
}

function fitnessCard(d) {
  const { f } = d;
  if (!f) return '';
  const ft = f.ok ? fitnessText(f) : null;
  const body = ft
    ? `<p class="pg-health__title">${esc(ft.title)}</p>${fitnessChart(f)}<p class="pg-health__text">${esc(ft.text)}</p>`
    : fitnessWaiting(f);
  return `<div class="card pg-card pg-health">
    <div class="hl-head"><div class="eyebrow">Tu forma</div>${more('#/salud/forma')}</div>
    ${body}
    ${watchStats(d)}
  </div>`;
}

/** Barras de las noches (horas dormido): la última en acento, las cortas más oscuras. */
function nightBars(nights, { height = 76, labels = true } = {}) {
  const max = Math.max(540, ...nights.map((n) => n.asleep));
  return `<div class="hl-nights" style="--n:${nights.length}" role="img" aria-label="Horas dormidas: ${esc(nights.map((n) => fmtSleep(n.asleep)).join(', '))}">
    ${nights.map((n, i) => `<div class="hl-nights__col">
      <span class="hl-nights__bar${i === nights.length - 1 ? ' is-last' : n.asleep < 390 ? ' is-short' : ''}" style="height:${Math.max(4, Math.round((n.asleep / max) * height))}px"></span>
      ${labels ? `<span class="hl-nights__day">${dayLetter(n.day)}</span>` : ''}
    </div>`).join('')}
  </div>`;
}

function crossText(c) {
  if (!c) return '';
  if (c.ok) {
    const t = sleepHrText(c);
    return `<p class="pg-health__text"><b>${esc(t.title)}.</b> ${esc(t.text)}</p>`;
  }
  return `<p class="pg-health__text">Para saber si dormir poco te afecta al correr necesito <b>4 clases</b> tras noches de menos de 6 h 30 y otras 4 tras noches de 7 h o más. Llevas <b class="num">${fmt.int(c.short)}</b> y <b class="num">${fmt.int(c.long)}</b>.</p>`;
}

function sleepMissing(sl) {
  if (!isNative()) return '';
  if (!healthSleepAvailable()) return 'Tu sueño llegará con la próxima versión de RITMUP para iPhone.';
  if (!sl || (sl.have || 0) === 0) return 'No hay noches en Salud. Duerme con el Apple Watch (con Sueño activado en la app Salud) y aquí verás cuánto duermes y cómo te afecta al correr.';
  return `Esta semana solo hay ${sl.have === 1 ? 'una noche' : `${sl.have} noches`} en Salud: con 3 o más verás tu media. Duerme con el Apple Watch puesto.`;
}

function sleepCard({ sl, c }) {
  if (!sl?.ok) {
    const msg = sleepMissing(sl);
    return msg ? `<div class="card pg-card pg-health"><div class="eyebrow">Sueño</div><p class="pg-health__text">${esc(msg)}</p></div>` : '';
  }
  return `<div class="card pg-card pg-health">
    <div class="hl-head"><div class="eyebrow">Sueño</div>${more('#/salud/sueno')}</div>
    <p class="hl-big num">${fmtSleep(sl.avg)}<small> h</small><span>de media estos 7 días${sl.delta != null ? ` · ${signed(sl.delta, ' min')}` : ''}</span></p>
    ${nightBars(sl.nights)}
    <div class="hl-sep">${icon('moon', 18)}${crossText(c)}</div>
  </div>`;
}

function loadWaiting(l) {
  const days = Math.max(1, 20 - (l.days || 0));
  return `<p class="pg-health__text">Para decirte si estás descansado o cargado comparo tu última semana con tu media del mes: necesito <b>3 semanas</b> de clases. ${l.days >= 7 ? `En <b class="num">${fmt.int(days)}</b> días lo tendrás.` : 'Sigue entrenando y aparecerá aquí.'}</p>`;
}

function gaugeHtml(l, lt) {
  const pos = Math.max(4, Math.min(96, ((l.ratio - 0.4) / 1.4) * 100));
  return `<div class="pg-health__gauge" role="img" aria-label="Carga de la semana frente a tu media: ${esc(lt.title)}"><i style="left:${pos.toFixed(1)}%"></i></div>
    <div class="pg-health__scale"><span>Descansado</span><span>Equilibrado</span><span>Cargado</span></div>`;
}

function loadCard({ l }) {
  if (!l) return '';
  const lt = l.ok ? loadText(l) : null;
  return `<div class="card pg-card pg-health">
    <div class="hl-head"><div class="eyebrow">Carga y descanso</div>${lt ? more('#/salud/carga') : ''}</div>
    ${lt ? `<p class="pg-health__title">${esc(lt.title)}<span class="pg-health__meta">${fmt.int(l.sessions7)} clases · ${fmt.int(l.minutes7)} min en 7 días</span></p>
    ${gaugeHtml(l, lt)}
    <p class="pg-health__text">${esc(lt.text)}</p>` : loadWaiting(l)}
  </div>`;
}

/** Pestaña Salud de Progreso. */
export function healthTab(s, today = todayKey()) {
  const d = data(s, today);
  const cards = [readinessCard(d), fitnessCard(d), sleepCard(d), loadCard(d)].filter(Boolean);
  if (!cards.length) {
    cards.push(`<div class="card pg-card pg-health"><p class="pg-health__text">Haz clases con el Apple Watch y aquí verás tu forma, tu sueño y tu carga, cruzados con tus entrenos.</p></div>`);
  }
  return `<section class="pg-section stack">${cards.join('')}<p class="pg-health__foot">${esc(FOOT)}</p></section>`;
}

/* ───────────── Detalle: Sueño ───────────── */

function stageBars(nights, height = 150) {
  const max = Math.max(540, ...nights.map((n) => n.asleep + n.awake));
  const px = (min) => Math.round((min / max) * height);
  const few = nights.length <= 10;
  return `<div class="hl-stages${few ? '' : ' hl-stages--dense'}" style="--n:${nights.length};--h:${height}px" role="img" aria-label="Fases de sueño por noche">
    ${nights.map((n, i) => {
      const parts = n.stages
        ? [['awake', n.awake], ['rem', n.rem], ['core', n.core], ['deep', n.deep]]
        : [['awake', n.awake], ['asleep', n.asleep]];
      const label = few ? dayLetter(n.day) : (i % 5 === 0 || i === nights.length - 1 ? String(Number(n.day.slice(8))) : '');
      return `<div class="hl-stages__col">
        <div class="hl-stages__stack">${parts.filter(([, v]) => v > 0).map(([k, v]) => `<span class="hl-st--${k}" style="height:${Math.max(2, px(v))}px"></span>`).join('')}</div>
        <span class="hl-stages__day${i === nights.length - 1 ? ' is-last' : ''}">${label}</span>
        ${few ? `<span class="hl-stages__h num">${fmtSleep(n.asleep)}</span>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

function sleepDetail(s, today, range) {
  const d = data(s, today);
  const sl = safe(() => sleepSummary(d.m, today, range));
  if (!sl?.ok) {
    return `<div class="card pg-card pg-health"><p class="pg-health__text">${esc(sleepMissing(sl) || 'Tu sueño se ve en la app de RITMUP para iPhone, con el Apple Watch.')}</p></div>`;
  }
  const anyStages = sl.nights.some((n) => n.stages);
  const avgStage = (k) => Math.round(sl.nights.filter((n) => n.stages).reduce((a, n) => a + n[k], 0) / Math.max(1, sl.nights.filter((n) => n.stages).length));
  const c = d.c;
  const cross = c?.ok
    ? `<div class="card pg-card pg-health">
        <div class="eyebrow">Tu pulso a ${fmt.speed(c.ref)} km/h</div>
        <div class="hl-stats hl-stats--2 hl-stats--flush">
          ${stat('Tras 7 h o más', fmt.int(c.hrLong), 'ppm', `${fmt.int(c.long)} clases`)}
          ${stat('Tras menos de 6 h 30', c.significant && c.diff > 0 ? `<span class="hl-accent">${fmt.int(c.hrShort)}</span>` : fmt.int(c.hrShort), 'ppm', `${fmt.int(c.short)} clases`)}
        </div>
        <p class="pg-health__text"><b>${esc(sleepHrText(c).title)}.</b> ${esc(sleepHrText(c).text)}</p>
      </div>`
    : `<div class="card pg-card pg-health">${crossText(c)}</div>`;
  return `
    <div class="card pg-card pg-health">
      <div class="eyebrow">Media por noche</div>
      <p class="hl-big hl-big--xl num">${fmtSleep(sl.avg)}<small> h</small></p>
      ${sl.bed && sl.wake ? `<p class="pg-health__text">Te duermes hacia las <b class="num">${esc(sl.bed)}</b> y te despiertas a las <b class="num">${esc(sl.wake)}</b>.</p>` : ''}
      ${stageBars(sl.nights)}
      ${anyStages ? `<div class="hl-legend">
        <span><i class="hl-st--deep"></i>Profundo <b class="num">${fmt.int(avgStage('deep'))}′</b></span>
        <span><i class="hl-st--core"></i>Ligero <b class="num">${fmt.int(avgStage('core'))}′</b></span>
        <span><i class="hl-st--rem"></i>REM <b class="num">${fmt.int(avgStage('rem'))}′</b></span>
        <span><i class="hl-st--awake"></i>Despierto <b class="num">${fmt.int(avgStage('awake'))}′</b></span>
      </div>` : ''}
      ${sl.delta != null ? `<p class="pg-health__text">Frente a las 4 semanas anteriores: <b class="num">${signed(sl.delta, ' min')}</b> por noche.</p>` : ''}
    </div>
    ${sectionHeader('Cómo te afecta al correr')}
    ${cross}`;
}

/* ───────────── Detalle: Tu forma ───────────── */

/** Puntos (una clase cada uno) y la recta de tendencia. */
function fitnessScatter(f) {
  const W = 340, H = 180, L = 30, R = 8, T = 10, B = 24;
  const first = f.points[0].day;
  const xs = f.points.map((p) => daysBetween(first, p.day));
  const ys = f.points.map((p) => p.hr);
  const xMax = Math.max(1, xs[xs.length - 1]);
  const lo = Math.floor((Math.min(...ys) - 3) / 5) * 5, hi = Math.ceil((Math.max(...ys) + 3) / 5) * 5;
  const X = (x) => L + (x / xMax) * (W - L - R);
  const Y = (y) => T + ((hi - y) / Math.max(1, hi - lo)) * (H - T - B);
  const { a, b } = theilSen(xs, ys);
  const grid = [];
  for (let v = lo; v <= hi; v += (hi - lo > 20 ? 10 : 5)) grid.push(v);
  return `<svg class="hl-scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pulso a ${esc(fmt.speed(f.ref))} km/h en cada clase, con su tendencia de ${f.first} a ${f.last} ppm">
    ${grid.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="hl-scatter__grid"/><text x="0" y="${(Y(v) + 4).toFixed(1)}" class="hl-scatter__axis">${v}</text>`).join('')}
    ${f.points.map((p, i) => `<circle cx="${X(xs[i]).toFixed(1)}" cy="${Y(p.hr).toFixed(1)}" r="3.5" class="hl-scatter__dot"/>`).join('')}
    <line x1="${X(0).toFixed(1)}" y1="${Y(a).toFixed(1)}" x2="${X(xMax).toFixed(1)}" y2="${Y(a + b * xMax).toFixed(1)}" class="hl-scatter__trend"/>
    <circle cx="${X(xMax).toFixed(1)}" cy="${Y(a + b * xMax).toFixed(1)}" r="5.5" class="hl-scatter__last"/>
    <text x="${L}" y="${H - 4}" class="hl-scatter__axis">${esc(shortDate(first))}</text>
    <text x="${W - R}" y="${H - 4}" text-anchor="end" class="hl-scatter__axis">Hoy</text>
  </svg>`;
}

function spark(values, { w = 130, h = 34 } = {}) {
  if (values.length < 2) return '';
  const lo = Math.min(...values), hi = Math.max(...values);
  const pts = values.map((v, i) => `${(2 + (i / (values.length - 1)) * (w - 4)).toFixed(1)},${(h - 3 - ((v - lo) / Math.max(0.1, hi - lo)) * (h - 6)).toFixed(1)}`).join(' ');
  return `<svg class="hl-spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

function formaDetail(s, today) {
  const d = data(s, today);
  const { f, v, rc } = d;
  const ft = f?.ok ? fitnessText(f) : null;
  const hero = ft
    ? `<div class="card pg-card pg-health">
        <div class="eyebrow">Tu pulso a ${fmt.speed(f.ref)} km/h</div>
        <p class="hl-big hl-big--xl num">${fmt.int(f.last)}<small> ppm</small><span class="${f.verdict === 'better' ? 'is-ok' : f.verdict === 'worse' ? 'is-warn' : ''}">${signed(f.last - f.first)} en ${f.weeks} sem.</span></p>
        ${fitnessScatter(f)}
        <p class="pg-health__text"><b>${esc(ft.title)}.</b> ${esc(ft.text)} Cada punto es una clase: tu pulso en los tramos cerca de ${fmt.speed(f.ref)} km/h. Si la línea baja, tu corazón trabaja menos para correr igual.</p>
      </div>`
    : `<div class="card pg-card pg-health">${f ? fitnessWaiting(f) : ''}</div>`;
  const vo2 = v
    ? `<div class="card pg-card pg-health hl-mini">
        <div class="eyebrow">VO₂ máx</div>
        <p class="hl-big num">${fmt.dec1(v.last)}</p>
        <span class="hl-stat__sub num ${v.change > 0 ? 'is-ok' : ''}">${v.change != null ? `${v.change > 0 ? '+' : v.change < 0 ? '−' : '±'}${fmt.dec1(Math.abs(v.change))} en ${v.weeks} sem.` : shortDate(v.lastDay)}</span>
        ${spark(v.points.map((p) => p.v))}
        <p class="hl-mini__note">Lo estima el Apple Watch al caminar o correr al aire libre.</p>
      </div>`
    : `<div class="card pg-card pg-health hl-mini"><div class="eyebrow">VO₂ máx</div><p class="hl-mini__note">${isNative() ? 'Sin datos en Salud: el Apple Watch lo estima al caminar o correr al aire libre con buena señal de GPS.' : 'Se ve en la app de RITMUP para iPhone.'}</p></div>`;
  const rec = rc
    ? `<div class="card pg-card pg-health hl-mini">
        <div class="eyebrow">Al acabar</div>
        <p class="hl-big num">−${fmt.int(rc.now)}</p>
        <span class="hl-stat__sub num ${rc.before != null && rc.now > rc.before ? 'is-ok' : ''}">${rc.before != null ? `antes −${fmt.int(rc.before)}` : 'ppm en 1 min'}</span>
        ${spark(rc.points.map((p) => p.v))}
        <p class="hl-mini__note">Pulsaciones que bajas en el primer minuto tras entrenar. Cuantas más, mejor.</p>
      </div>`
    : `<div class="card pg-card pg-health hl-mini"><div class="eyebrow">Al acabar</div><p class="hl-mini__note">${isNative() ? 'Aún sin datos: el Apple Watch la mide al terminar cada clase (Salud › Corazón › Recuperación cardiaca).' : 'Se ve en la app de RITMUP para iPhone.'}</p></div>`;
  return `${hero}<div class="hl-pair">${vo2}${rec}</div>`;
}

/* ───────────── Detalle: Carga y descanso ───────────── */

function loadChart(l, hrvWeeks) {
  const W = 340, H = 170, B = 22, T = 12;
  const max = Math.max(1, ...l.weeks.map((w) => w.load));
  const bw = 24, step = (W - 20) / l.weeks.length;
  const X = (i) => 10 + i * step + (step - bw) / 2;
  const bars = l.weeks.map((w, i) => {
    const h = Math.round((w.load / max) * (H - B - T - 10));
    return `<rect x="${X(i).toFixed(1)}" y="${H - B - h}" width="${bw}" height="${Math.max(0, h)}" rx="5" class="hl-load__bar${i === l.weeks.length - 1 ? ' is-last' : ''}"/>
      <text x="${(X(i) + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="hl-scatter__axis">${i === l.weeks.length - 1 ? 'Hoy' : `−${w.from}`}</text>`;
  }).join('');
  const hv = hrvWeeks.map((w, i) => ({ i, v: w.avg })).filter((p) => p.v != null);
  let line = '';
  if (hv.length >= 2) {
    const lo = Math.min(...hv.map((p) => p.v)) - 2, hi = Math.max(...hv.map((p) => p.v)) + 2;
    const Y = (v) => T + ((hi - v) / (hi - lo)) * (H - B - T - 30);
    const pts = hv.map((p) => `${(X(p.i) + bw / 2).toFixed(1)},${Y(p.v).toFixed(1)}`);
    line = `<polyline points="${pts.join(' ')}" class="hl-load__hrv"/>${pts.map((p) => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3.5" class="hl-load__pt"/>`).join('')}`;
  }
  return `<svg class="hl-scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="Carga de cada una de las últimas 8 semanas${line ? ' y tu VFC media' : ''}">${bars}${line}</svg>
    <div class="hl-legend">
      <span><i class="hl-load__key"></i>Carga de la semana</span>
      ${line ? '<span><i class="hl-load__key hl-load__key--line"></i>Tu VFC</span>' : ''}
    </div>`;
}

function cargaDetail(s, today) {
  const d = data(s, today);
  const { l, m } = d;
  if (!l?.ok) return `<div class="card pg-card pg-health">${l ? loadWaiting(l) : ''}</div>`;
  const lt = loadText(l);
  const hrvWeeks = safe(() => weeklyAverages(m?.hrv, today, 8), []) || [];
  const prev = l.weeks.slice(0, -1).filter((w) => w.load > 0);
  const avgPrev = prev.length ? prev.reduce((a, w) => a + w.load, 0) / prev.length : 0;
  const pct = avgPrev > 0 ? Math.round(((l.acute - avgPrev) / avgPrev) * 100) : null;
  const hNow = hrvWeeks[hrvWeeks.length - 1]?.avg;
  const hPrev = hrvWeeks.slice(0, -1).map((w) => w.avg).filter((x) => x != null);
  const hPct = hNow != null && hPrev.length >= 2 ? Math.round(((hNow - hPrev.reduce((a, x) => a + x, 0) / hPrev.length) / (hPrev.reduce((a, x) => a + x, 0) / hPrev.length)) * 100) : null;
  const read = [
    pct != null ? `Esta semana llevas un <b class="num">${Math.abs(pct)} %</b> ${pct >= 0 ? 'más' : 'menos'} carga que la media de las 7 anteriores.` : '',
    hPct != null ? `Tu VFC está un <b class="num">${Math.abs(hPct)} %</b> ${hPct >= 0 ? 'por encima' : 'por debajo'} de tu media${hPct <= -10 ? ': tu cuerpo lo está notando' : hPct >= 0 ? ': lo aguantas bien' : ''}.` : '',
  ].filter(Boolean).join(' ');
  const streak = l.streak || 0;
  const rest = streak >= 3
    ? ['Llevas ' + streak + ' días seguidos entrenando', 'Mañana toca descansar o hacer una clase suave de 20′.']
    : streak > 0
      ? [`${streak === 1 ? 'Hoy has entrenado' : 'Llevas 2 días seguidos'}`, 'Vas bien de descanso: tu cuerpo tiene tiempo de recuperar entre clases.']
      : ['Hoy descansas', 'Los días sin clase es cuando tu cuerpo se adapta y mejora.'];
  return `
    <div class="card pg-card pg-health">
      <div class="eyebrow">Cómo vas</div>
      <p class="hl-big">${esc(lt.title)}</p>
      ${gaugeHtml(l, lt)}
      <p class="pg-health__text">${esc(lt.text)}</p>
    </div>
    <div class="card pg-card pg-health">
      <div class="eyebrow">8 semanas · lo que entrenas${hrvWeeks.some((w) => w.avg != null) ? ' y cómo recuperas' : ''}</div>
      ${loadChart(l, hrvWeeks)}
      ${read ? `<p class="pg-health__text hl-rule">${read}</p>` : ''}
    </div>
    <div class="card pg-card pg-health">
      <div class="hl-stats hl-stats--3">
        ${stat('Clases', fmt.int(l.sessions7), '', 'en 7 días')}
        ${stat('Minutos', fmt.int(l.minutes7), '', 'en 7 días')}
        ${stat('Carga', fmt.int(l.acute), '', pct != null ? `${signed(pct, ' %')}` : '')}
      </div>
    </div>
    <div class="card pg-card pg-health">
      <div class="eyebrow">Descanso</div>
      <p class="pg-health__title">${esc(rest[0])}</p>
      <p class="pg-health__text">${esc(rest[1])}</p>
    </div>
    <p class="pg-health__foot">La carga suma los minutos de cada clase por su intensidad (pulso del Apple Watch; sin pulso, por los minutos). Orientativo: no es un consejo médico.</p>`;
}

/* ───────────── montaje de los detalles ───────────── */

const SECTIONS = { sueno: 'Sueño', forma: 'Tu forma', carga: 'Carga y descanso' };

export function mount(el, { params } = {}) {
  const section = Object.prototype.hasOwnProperty.call(SECTIONS, params?.section) ? params.section : 'forma';
  el.classList.add('pg-screen', 'hl-screen');
  el.innerHTML = `${navBar({ title: SECTIONS[section], large: true, back: '#/progress', backLabel: 'Progreso' })}
    <div class="container stack-lg pg-body" data-body></div>`;
  const body = el.querySelector('[data-body]');
  const offHeader = safe(() => enableCollapsingHeader(el));
  let range = 7;
  let gone = false;
  const render = () => {
    const s = getState();
    const today = todayKey();
    let html = '';
    if (section === 'sueno') {
      html = `${segmented({ name: 'hl-range', options: [{ value: 7, label: '7 noches' }, { value: 30, label: '30 noches' }], value: range })}${safe(() => sleepDetail(s, today, range), '')}`;
    } else if (section === 'forma') html = safe(() => formaDetail(s, today), '');
    else html = safe(() => cargaDetail(s, today), '');
    body.innerHTML = `<section class="pg-section stack hl-detail">${html}${section === 'carga' ? '' : `<p class="pg-health__foot">${esc(FOOT)}</p>`}</section>`;
  };
  const onChange = (e) => {
    if (e.detail?.name !== 'hl-range') return;
    range = Number(e.detail.value) === 30 ? 30 : 7;
    render();
  };
  body.addEventListener('change', onChange);
  render();
  fetchHealthMetrics().then((mm) => { if (mm && !gone) render(); }).catch(() => {});
  return () => {
    gone = true;
    body.removeEventListener('change', onChange);
    if (typeof offHeader === 'function') offHeader();
  };
}
