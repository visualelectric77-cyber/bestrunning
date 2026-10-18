// BestRunning · Pantalla «Progreso»: KPIs, semanas, velocidades, VO₂máx, constancia, récords y logros.
import { getState, setState, subscribe } from '../core/store.js';
import { icon, navBar, enableCollapsingHeader, segmented, sectionHeader, ring, openSheet, celebrate } from '../ui/components.js';
import { lineChart, barChart, heatmapCalendar, gauge, sparkline } from '../ui/charts.js';
import { haptic } from '../core/haptics.js';
import { totals, weeklyBuckets, streakWeeks, dayValues, records, weekProgress } from '../training/stats.js';
import { ACHIEVEMENTS } from '../training/achievements.js';
import { coachInsight } from '../training/progression.js';
import { ZONES, LEVEL_KEYS, vamFromLevels, estimateVo2max, vo2Category } from '../training/levels.js';
import { esc, fmt, todayKey, mondayOf, addDays, daysBetween, parseKey, clamp, round1 } from '../core/utils.js';
import { hasHrSeries, hrAtLevels, ensureWatchHrStyles, HR_COLOR } from '../integrations/watch-hr.js';
import { topTracks, trackInfo, loadMusicMeta, TIER_COLORS } from '../integrations/session-music.js';

/* ───────────── utilidades privadas ───────────── */

const safe = (fn, fallback = null) => {
  try {
    const v = fn();
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

const reducedMotion = () => safe(() => matchMedia('(prefers-reduced-motion: reduce)').matches, false);

const isoToKey = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : todayKey(d);
};

/** 'YYYY-MM-DD' → '17 oct' */
const shortDate = (key) => fmt.dateShort(key).split(' ').slice(1).join(' ');

const fmtNum = (v, dec) => (dec && Math.abs(v) < 1000 ? fmt.dec1(v) : fmt.int(v));

const TIER_NAME = { bronze: 'Bronce', silver: 'Plata', gold: 'Oro' };
const TIERS = ['bronze', 'silver', 'gold'];
const VO2_COLORS = ['var(--danger)', 'var(--z-fast)', 'var(--z-run)', 'var(--z-jog)', 'var(--info)'];

function ageBand(age) {
  if (age < 30) return 'menores de 30';
  if (age < 40) return 'de 30 a 39 años';
  if (age < 50) return 'de 40 a 49 años';
  if (age < 60) return 'de 50 a 59 años';
  return 'de 60 años o más';
}

/** Edad de forma: edad a la que tu VO₂máx sería el típico (centro de la franja «Bueno»). Orientativa. */
function fitnessAge(vo2, sex) {
  const centers = [25, 35, 45, 55, 65];
  const refs = centers.map((a) => {
    const t = vo2Category(0, a, sex).thresholds;
    return (t[1] + t[2]) / 2;
  });
  let age;
  if (vo2 >= refs[0]) age = 25 - ((vo2 - refs[0]) / Math.max(0.1, refs[0] - refs[1])) * 10;
  else if (vo2 <= refs[4]) age = 65 + ((refs[4] - vo2) / Math.max(0.1, refs[3] - refs[4])) * 10;
  else {
    let i = 0;
    while (i < 3 && vo2 < refs[i + 1]) i++;
    age = centers[i] + (10 * (refs[i] - vo2)) / Math.max(0.1, refs[i] - refs[i + 1]);
  }
  // Por debajo de 25 las tablas no permiten extrapolar con fiabilidad.
  return Math.round(clamp(age, 25, 80));
}

/* Respaldos locales por si stats.js devuelve algo inesperado. */
function localTotals(history) {
  return history.reduce(
    (a, h) => ({ sessions: a.sessions + 1, km: a.km + (h.distanceKm || 0), sec: a.sec + (h.elapsedSec || 0), kcal: a.kcal + (h.kcal || 0) }),
    { sessions: 0, km: 0, sec: 0, kcal: 0 },
  );
}

function localWeekly(history, weeks, endKey) {
  const end = mondayOf(endKey);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) out.push({ monday: addDays(end, -7 * i), km: 0, sec: 0, sessions: 0 });
  const idx = new Map(out.map((b, i) => [b.monday, i]));
  for (const h of history) {
    if (!h?.dayKey) continue;
    const i = idx.get(mondayOf(h.dayKey));
    if (i == null) continue;
    out[i].km += h.distanceKm || 0;
    out[i].sec += h.elapsedSec || 0;
    out[i].sessions += 1;
  }
  return out;
}

function localDayValues(history) {
  const out = {};
  for (const h of history) if (h?.dayKey) out[h.dayKey] = (out[h.dayKey] || 0) + Math.round((h.elapsedSec || 0) / 60);
  return out;
}

function localRecords(history) {
  const best = (fn) => {
    let value = 0;
    let sessionId = null;
    for (const h of history) {
      const x = Number(safe(() => fn(h), 0)) || 0;
      if (x > value) {
        value = x;
        sessionId = h.id;
      }
    }
    return { value, sessionId };
  };
  return {
    longestSec: best((h) => h.elapsedSec),
    maxDistanceKm: best((h) => h.distanceKm),
    maxAvgSpeed: best((h) => ((h.elapsedSec || 0) >= 600 ? h.avgSpeed : 0)),
    maxSpeed: best((h) => h.maxSpeed),
    bestVam: best((h) => h.test?.vam),
    mostSprintSec: best((h) => h.timeInZone?.sprint),
  };
}

/** Normaliza una entrada de records(): número suelto u objeto { value, sessionId }. */
function pickRecord(recs, key) {
  const r = recs?.[key];
  if (r == null) return null;
  if (typeof r === 'number') return { value: r, sessionId: recs[`${key}SessionId`] ?? recs.sessionIds?.[key] ?? null };
  if (typeof r === 'object') {
    let value = r.value ?? r[key];
    if (typeof value !== 'number') value = Object.values(r).find((v) => typeof v === 'number') ?? null;
    return { value, sessionId: r.sessionId ?? r.id ?? null };
  }
  return null;
}

/** Puntos de nivel por día (última entrada de cada día) + los niveles actuales hoy. */
function levelSeries(s, today) {
  const hist = (Array.isArray(s.levelHistory) ? s.levelHistory : [])
    .filter((e) => e && typeof e.date === 'string' && e.levels)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byDay = new Map();
  for (const e of hist) if (e.date <= today) byDay.set(e.date, e.levels);
  if (s.levels) byDay.set(today, s.levels);
  return [...byDay.keys()].sort().map((date) => ({ date, levels: byDay.get(date) }));
}

/** Niveles de referencia de hace ~4 semanas (o los primeros registrados). */
function refLevels(series, today) {
  if (!series.length) return null;
  const limit = addDays(today, -28);
  let ref = series[0];
  for (const p of series) if (p.date <= limit) ref = p;
  return ref.levels;
}

function deltaChip(d, unit = '') {
  if (!d || Math.abs(d) < 0.05) return `<span class="pg-delta pg-delta--flat">=</span>`;
  const up = d > 0;
  return `<span class="pg-delta ${up ? 'pg-delta--up' : 'pg-delta--down'}">${icon(up ? 'arrow-up' : 'arrow-down', 11, { stroke: 3 })}${fmt.dec1(Math.abs(d))}${unit}</span>`;
}

/** Cuenta ascendente de las cifras con [data-count]. Devuelve función para cancelar. */
function countUp(root) {
  const nodes = [...root.querySelectorAll('[data-count]')];
  if (!nodes.length || reducedMotion()) {
    nodes.forEach((n) => { n.textContent = fmtNum(Number(n.dataset.count) || 0, Number(n.dataset.dec) || 0); });
    return () => {};
  }
  let raf = 0;
  const t0 = performance.now();
  const dur = 1150;
  const step = (now) => {
    const p = clamp((now - t0) / dur, 0, 1);
    const e = 1 - Math.pow(1 - p, 4);
    for (const n of nodes) n.textContent = fmtNum((Number(n.dataset.count) || 0) * e, Number(n.dataset.dec) || 0);
    if (p < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/* ───────────── bloques de la pantalla ───────────── */

function emptyHero() {
  const bars = [
    ['jog', 34], ['run', 52], ['jog', 40], ['fast', 70], ['jog', 44], ['sprint', 92], ['run', 58], ['fast', 76], ['jog', 46],
  ];
  const w = 18;
  const gap = 8;
  const svgBars = bars
    .map(([z, h], i) => `<rect class="pg-empty__bar" style="--i:${i}" x="${20 + i * (w + gap)}" y="${120 - h}" width="${w}" height="${h}" rx="5" fill="var(--z-${z})"/>`)
    .join('');
  return `<section class="card pg-empty">
    <div class="pg-empty__art" aria-hidden="true">
      <svg viewBox="0 0 270 140" width="100%" height="140">
        <defs>
          <radialGradient id="pgEmptyGlow" cx="50%" cy="80%" r="60%">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.45"/>
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <ellipse cx="135" cy="118" rx="130" ry="60" fill="url(#pgEmptyGlow)"/>
        ${svgBars}
        <line x1="12" y1="121" x2="258" y2="121" stroke="var(--line-strong)" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span class="pg-empty__badge">${icon('trophy', 22)}</span>
    </div>
    <div class="eyebrow">Tu progreso</div>
    <h2 class="pg-empty__title">Tu historia empieza hoy</h2>
    <p class="pg-empty__text">Cada sesión suma: aquí verás tus kilómetros, tus rachas, cómo suben tus velocidades y las medallas que vas ganando.</p>
    <button type="button" class="btn btn--primary btn--lg btn--block" data-href="#/today">${icon('play', 20)}<span>Empezar la sesión de hoy</span></button>
    <p class="pg-empty__hint">${icon('flame', 14)} Completa 4 sesiones en una semana y estrenarás tu primera racha.</p>
  </section>`;
}

function weekCard(s, today) {
  const monday = mondayOf(today);
  let wp = safe(() => weekProgress(s, monday), null);
  if (!wp || typeof wp !== 'object') {
    const week = (s.history || []).filter((h) => h.dayKey >= monday && h.dayKey <= addDays(monday, 6));
    wp = { doneSessions: week.length, plannedSessions: 6, minutes: week.reduce((a, h) => a + (h.elapsedSec || 0) / 60, 0), plannedMinutes: 0, km: week.reduce((a, h) => a + (h.distanceKm || 0), 0) };
  }
  const done = wp.doneSessions || 0;
  const planned = wp.plannedSessions || 0;
  const min = Math.round(wp.minutes || 0);
  const pMin = Math.round(wp.plannedMinutes || 0);
  // El anillo cuenta lo mismo que el titular: sesiones
  const pct = planned ? clamp(done / planned, 0, 1) : pMin ? clamp(min / pMin, 0, 1) : 0;
  const complete = planned > 0 && done >= planned;
  const left = Math.max(0, Math.min(planned - done, Number.isFinite(wp.remainingSessions) ? wp.remainingSessions : planned - done));
  const title = complete ? '¡Semana completada!' : done ? `${done} de ${planned || '–'} sesiones` : left ? 'Semana por estrenar' : 'Semana sin sesiones';
  const sub = complete
    ? 'Has cumplido todo el plan. Eso es constancia de campeón.'
    : left
      ? done
        ? `Te ${left === 1 ? 'queda 1 sesión' : `quedan ${left} sesiones`} para cerrar la semana.`
        : 'Tu primera sesión de la semana te está esperando.'
      : done
        ? `Semana cerrada: ${done} de ${planned}. La próxima, ¡a por todas!`
        : 'El lunes empieza una semana nueva. ¡A por ella!';
  return `<section class="card pg-week${complete ? ' is-complete' : ''}">
    <div class="pg-week__ring">${ring({ value: pct, size: 92, stroke: 10, color: 'var(--accent)', inner: `<span class="pg-week__pct num">${Math.round(pct * 100)}<small>%</small></span>` })}</div>
    <div class="pg-week__info">
      <div class="eyebrow">Esta semana</div>
      <div class="pg-week__title">${esc(title)}</div>
      <div class="pg-week__sub">${esc(sub)}</div>
      <div class="pg-week__meta">
        <span>${icon('timer', 14)}<b class="num">${fmt.int(min)}</b>${pMin ? `<i>/${fmt.int(pMin)}</i>` : ''} min</span>
        <span>${icon('route', 14)}<b class="num">${fmt.dec1(wp.km || 0)}</b> km</span>
      </div>
    </div>
  </section>`;
}

function kpiGrid(s, history, animate) {
  const t = safe(() => totals(history), null) || localTotals(history);
  const streak = Number(safe(() => streakWeeks(s, new Date()), 0)) || 0;
  const items = [
    { label: 'Kilómetros', value: t.km || 0, dec: 1, unit: 'km', ic: 'route', color: 'var(--accent)' },
    { label: 'Horas corriendo', value: (t.sec || 0) / 3600, dec: 1, unit: 'h', ic: 'timer', color: 'var(--z-run)' },
    { label: 'Sesiones', value: t.sessions || history.length, dec: 0, unit: '', ic: 'flame', color: 'var(--z-sprint)' },
    { label: 'Racha', value: streak, dec: 0, unit: streak === 1 ? 'semana' : 'semanas', ic: 'bolt', color: 'var(--z-jog)' },
  ];
  const tiles = items
    .map((k) => `<div class="pg-kpi" style="--kc:${k.color}">
      <span class="pg-kpi__icon">${icon(k.ic, 18)}</span>
      <div class="pg-kpi__value stat__value"><span data-count="${k.value}" data-dec="${k.dec}">${animate ? '0' : fmtNum(k.value, k.dec)}</span>${k.unit ? `<span class="stat__unit">${esc(k.unit)}</span>` : ''}</div>
      <div class="stat__label">${esc(k.label)}</div>
    </div>`)
    .join('');
  return `<section class="pg-kpis">${tiles}</section>`;
}

function insightCard(text) {
  return `<section class="card card--glass pg-insight">
    <span class="pg-insight__icon">${icon('sparkles', 18)}</span>
    <div><div class="eyebrow">El coach dice</div><p class="pg-insight__text">${esc(text)}</p></div>
  </section>`;
}

function weeklyHead(buckets, metric) {
  const val = (b) => (metric === 'min' ? (b.sec || 0) / 60 : b.km || 0);
  const last4 = buckets.slice(-4);
  const prev4 = buckets.slice(-8, -4);
  const avg = last4.reduce((a, b) => a + val(b), 0) / Math.max(1, last4.length);
  const avgPrev = prev4.reduce((a, b) => a + val(b), 0) / Math.max(1, prev4.length);
  let delta = '';
  if (avgPrev > 0) {
    const pct = Math.round(((avg - avgPrev) / avgPrev) * 100);
    const cls = pct > 0 ? 'pg-delta--up' : pct < 0 ? 'pg-delta--down' : 'pg-delta--flat';
    delta = `<span class="pg-delta ${cls}">${pct ? icon(pct > 0 ? 'arrow-up' : 'arrow-down', 11, { stroke: 3 }) : ''}${Math.abs(pct)} %</span><span class="pg-week-head__vs">vs. las 4 anteriores</span>`;
  } else if (avg > 0) {
    delta = `<span class="pg-week-head__vs">¡Buen arranque!</span>`;
  }
  const big = metric === 'min' ? fmt.int(avg) : fmt.dec1(avg);
  return `<div class="pg-big num">${big}<small>${metric === 'min' ? 'min' : 'km'}/semana</small></div>
    <div class="pg-week-head__delta">${delta}</div>`;
}

function weeklyChart(buckets, metric) {
  const last = buckets.length - 1;
  // barChart muestra una etiqueta de cada dos con más de 8 barras: el cambio de mes se compara con la
  // etiqueta VISIBLE anterior (si no, «14» y «28» de octubre perderían su mes)
  const everyOther = buckets.length > 8;
  const visible = (i) => !everyOther || i % 2 === last % 2;
  let prevShown = null;
  const bars = buckets.map((b, i) => {
    const d = parseKey(b.monday);
    let label = String(d.getDate());
    if (visible(i)) {
      if (!prevShown || prevShown.getMonth() !== d.getMonth()) label = `${d.getDate()} ${fmt.monthAbbr(d.getMonth())}`;
      prevShown = d;
    }
    const value = metric === 'min' ? Math.round((b.sec || 0) / 60) : round1(b.km || 0);
    const bar = { label, value };
    if (i === last) {
      bar.color = 'var(--accent)';
      bar.highlight = true;
    }
    return bar;
  });
  return barChart(bars, { height: 170, valueFormat: metric === 'min' ? (v) => fmt.int(v) : (v) => fmt.dec1(v) });
}

function weeklyCard(history, today, metric) {
  const m = metric === 'min' ? 'min' : 'km';
  let buckets = safe(() => weeklyBuckets(history, 12, today), null);
  if (!Array.isArray(buckets) || !buckets.length) buckets = localWeekly(history, 12, today);
  return `<section class="card pg-card pg-weekly">
    <div class="pg-card__head">
      <div class="eyebrow">Últimas 12 semanas</div>
      ${segmented({ name: 'pg-metric', options: [{ value: 'km', label: 'Km' }, { value: 'min', label: 'Minutos' }], value: m })}
    </div>
    <div class="pg-week-head" data-weekly-head>${weeklyHead(buckets, m)}</div>
    <div class="pg-chart" data-weekly-chart>${weeklyChart(buckets, m)}</div>
  </section>`;
}

function speedsSection(s, today) {
  const levels = s.levels || {};
  const series = levelSeries(s, today);
  const ref = refLevels(series, today);
  const tiles = LEVEL_KEYS.map((k) => {
    const z = ZONES[k];
    const cur = levels[k] || 0;
    const d = round1(cur - (ref?.[k] ?? cur));
    const vals = series.map((p) => p.levels?.[k]).filter((v) => typeof v === 'number');
    const spark = vals.length > 1 && new Set(vals).size > 1 ? `<div class="pg-level__spark">${sparkline(vals, { color: `var(--z-${k})`, height: 26 })}</div>` : '';
    return `<div class="pg-level" style="--zc:var(--z-${k})">
      <div class="pg-level__name">${esc(z?.name || k)}</div>
      <div class="pg-level__value num">${fmt.speed(cur)}<small>km/h</small></div>
      <div class="pg-level__meta"><span>${fmt.pace(cur)} /km</span>${deltaChip(d)}</div>
      ${spark}
    </div>`;
  }).join('');

  let chart = '';
  if (series.length >= 2) {
    const first = series[0].date;
    const lows = series.map((p) => p.levels.jog).filter((v) => typeof v === 'number');
    const highs = series.map((p) => p.levels.sprint).filter((v) => typeof v === 'number');
    const yMin = Math.floor(Math.min(...lows) - 0.5);
    const yMax = Math.ceil(Math.max(...highs) + 0.5);
    chart = `<div class="card pg-card">
      <div class="pg-card__head"><div class="eyebrow">Evolución</div><span class="pg-card__hint">desde ${esc(shortDate(first))}</span></div>
      <div class="pg-chart">${lineChart(
        LEVEL_KEYS.map((k) => ({
          name: ZONES[k]?.name || k,
          color: `var(--z-${k})`,
          points: series.filter((p) => typeof p.levels[k] === 'number').map((p) => ({ x: daysBetween(first, p.date), y: p.levels[k] })),
        })),
        { height: 190, yMin, yMax, yFormat: (v) => fmt.speed(v), xFormat: (x) => shortDate(addDays(first, Math.round(x))) },
      )}</div>
    </div>`;
  }

  return `<section class="pg-section stack">
    ${sectionHeader('Tus velocidades', `<button type="button" class="btn btn--ghost pg-link" data-href="#/settings/speeds">Ajustar</button>`)}
    <div class="pg-levels">${tiles}</div>
    ${chart}
    ${vo2Card(s)}
  </section>`;
}

function vo2Data(s) {
  const levels = s.levels || {};
  const vam = Number(safe(() => vamFromLevels(levels), 0)) || 0;
  const vo2 = Number(safe(() => estimateVo2max(vam), 0)) || 0;
  const age = Number(s.profile?.age) || 46;
  const sex = s.profile?.sex === 'f' ? 'f' : 'm';
  const cat = safe(() => vo2Category(vo2, age, sex), null) || { tier: 2, label: 'Bueno', thresholds: [34, 39, 44, 49] };
  const t = cat.thresholds;
  return { vam, vo2, age, sex, cat, t, min: t[0] - 8, max: t[3] + 8, color: VO2_COLORS[cat.tier] || 'var(--accent)', fitAge: fitnessAge(vo2, sex) };
}

function vo2Scale(d) {
  const span = d.max - d.min;
  const edges = [d.min, ...d.t, d.max];
  const segs = VO2_COLORS.map((c, i) => `<span style="flex:${Math.max(0.01, edges[i + 1] - edges[i])};background:${c}"></span>`).join('');
  const pos = clamp(((d.vo2 - d.min) / span) * 100, 1, 99);
  return `<div class="pg-scale" aria-hidden="true"><div class="pg-scale__bar">${segs}</div><span class="pg-scale__mark" style="left:${pos}%"></span></div>`;
}

function vo2Card(s) {
  const d = vo2Data(s);
  const test = s.progression?.lastTest;
  const testKey = test?.date ? (test.date.length > 10 ? isoToKey(test.date) : test.date) : null;
  const ageDiff = d.age - d.fitAge;
  const fitTxt = ageDiff >= 2
    ? `${d.fitAge <= 25 ? 'Al menos ' : ''}${ageDiff} años por debajo de tu edad`
    : ageDiff <= -2 ? 'Hay margen: ¡a por ello!' : 'En línea con tu edad';
  return `<div class="card pg-card pg-vo2" style="--tc:${d.color}">
    <div class="pg-card__head">
      <div class="eyebrow">VO₂máx estimado</div>
      <button type="button" class="pg-info-btn" data-pg="vo2" aria-label="Qué es el VO₂máx">${icon('info', 18)}</button>
    </div>
    <div class="pg-vo2__gauge">${gauge({ value: d.vo2, min: d.min, max: d.max, label: 'ml/kg/min', color: d.color })}</div>
    <div class="pg-vo2__cat"><span class="pg-pill" style="--pc:${d.color}">${esc(d.cat.label)}</span><span class="muted">para ${d.sex === 'f' ? 'mujeres' : 'hombres'} ${esc(ageBand(d.age))}</span></div>
    ${vo2Scale(d)}
    <div class="pg-vo2__facts">
      <div><span class="eyebrow">VAM actual</span><b class="num">${fmt.speed(d.vam)}<small>km/h</small></b><span class="muted">${testKey ? `Último test: ${esc(shortDate(testKey))}` : 'Estimada por tus velocidades'}</span></div>
      <div><span class="eyebrow">Edad de forma</span><b class="num">${d.fitAge <= 25 ? '≤' : '≈'} ${d.fitAge}<small>años</small></b><span class="muted">${esc(fitTxt)}</span></div>
    </div>
    <button type="button" class="btn btn--secondary btn--block pg-vo2__more" data-pg="vo2">${icon('info', 18)}<span>¿Qué significa y cómo subirlo?</span></button>
  </div>`;
}

/* ───────────── Tu corazón (pulso del Apple Watch) y música ───────────── */

const sesDay = (h) => h?.dayKey || isoToKey(h?.startedAt);

/** Pulso medio en los tramos de trote de cada sesión con pulso (últimas 8 semanas). */
function jogHrPoints(s, today) {
  const since = addDays(today, -56);
  const out = [];
  for (const h of (Array.isArray(s.history) ? s.history : [])) {
    if (!h || h.isTest || !hasHrSeries(h)) continue;
    const day = sesDay(h);
    if (!day || day < since || day > today) continue;
    const lv = safe(() => hrAtLevels(h, { levels: h.levelsAtStart || s.levels }), {});
    const j = lv?.jog;
    if (j && j.avg > 0) out.push({ date: day, avg: j.avg, speed: j.speed });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function topMusicHtml(history) {
  const top = safe(() => topTracks(history, 3), []);
  if (!top.length) return '';
  return `<div class="pg-heart__music">
      <div class="eyebrow">Lo que más suena</div>
      <div class="whr-tracks" data-top-music>${topMusicRows(top)}</div>
    </div>`;
}

function topMusicRows(top) {
  return top.map((it, i) => {
    const m = trackInfo(it);
    const sub = [m.artist, `${it.n} ${it.n === 1 ? 'sesión' : 'sesiones'}`].filter(Boolean).join(' · ');
    return `<div class="whr-track" style="--tc:${TIER_COLORS[m.tier] || 'var(--accent)'};--i:${i}">
      <span class="whr-track__n num">${i + 1}</span>
      <span class="whr-track__txt"><b>${esc(m.title)}</b><small>${esc(sub)}</small></span>
      <span class="whr-track__dot" aria-hidden="true"></span>
    </div>`;
  }).join('');
}

function heartSection(s, today) {
  const history = Array.isArray(s.history) ? s.history.filter(Boolean) : [];
  if (!history.length) return '';
  const withHr = history.filter((h) => hasHrSeries(h));
  const music = topMusicHtml(history);
  if (!withHr.length) {
    return `<section class="pg-section stack">
      ${sectionHeader(music ? 'Tu corazón y tu música' : 'Tu corazón')}
      <div class="card pg-card pg-heart pg-heart--empty">
        <div class="pg-heart__icon" aria-hidden="true">${icon('heart', 22)}</div>
        <p class="pg-heart__lead">Con el pulso del Apple Watch verás cómo tu corazón se adapta: a la misma velocidad, cada vez menos pulsaciones.</p>
        <button type="button" class="btn btn--secondary btn--block" data-href="#/settings/watch">${icon('watch', 18)}<span>Importa el pulso de tu próximo entreno</span></button>
        ${music}
      </div>
    </section>`;
  }
  const pts = jogHrPoints(s, today);
  let chart = '';
  let line = '';
  if (pts.length) {
    const last = pts[pts.length - 1];
    // Referencia: la sesión más cercana a 4 semanas antes (al menos 3 semanas atrás)
    const refs = pts.filter((p) => daysBetween(p.date, last.date) >= 21);
    const ref = refs.length ? refs.reduce((a, b) => (Math.abs(daysBetween(b.date, last.date) - 28) < Math.abs(daysBetween(a.date, last.date) - 28) ? b : a)) : null;
    const d = ref ? last.avg - ref.avg : null;
    const weeks = ref ? Math.max(1, Math.round(daysBetween(ref.date, last.date) / 7)) : 0;
    const trend = d == null ? ''
      : d === 0 ? ` · igual que hace ${weeks} semanas`
        : ` · <span class="pg-heart__d ${d < 0 ? 'is-good' : 'is-up'}">${d < 0 ? '−' : '+'}${Math.abs(d)}</span> en ${weeks} ${weeks === 1 ? 'semana' : 'semanas'}`;
    line = `<p class="pg-heart__line">A <b class="num">${fmt.speed(last.speed)}</b> km/h: <b class="num">${fmt.int(last.avg)}</b> ppm${trend}</p>`;
    if (pts.length >= 2) {
      const first = pts[0].date;
      const vals = pts.map((p) => p.avg);
      chart = `<div class="pg-chart">${lineChart(
        [{ name: 'Pulso trotando', color: HR_COLOR, points: pts.map((p) => ({ x: daysBetween(first, p.date), y: p.avg })) }],
        { height: 150, yMin: Math.floor((Math.min(...vals) - 6) / 5) * 5, yMax: Math.ceil((Math.max(...vals) + 6) / 5) * 5, yFormat: (v) => fmt.int(v), xFormat: (x) => shortDate(addDays(first, Math.round(x))) },
      )}</div>`;
    }
  } else {
    const lastHr = withHr[withHr.length - 1];
    line = lastHr.hrAvg ? `<p class="pg-heart__line">Última sesión: <b class="num">${fmt.int(lastHr.hrAvg)}</b> ppm de media${lastHr.hrMax ? ` · máx. <b class="num">${fmt.int(lastHr.hrMax)}</b>` : ''}</p>` : '';
  }
  const n = withHr.length;
  // Sin tramos de trote con pulso la línea habla de la última sesión, no del trote
  const eyebrow = pts.length ? 'Pulso al trotar' : 'Pulso del Apple Watch';
  return `<section class="pg-section stack">
    ${sectionHeader(music ? 'Tu corazón y tu música' : 'Tu corazón')}
    <div class="card pg-card pg-heart">
      <div class="pg-card__head"><div class="eyebrow">${eyebrow}</div><span class="pg-card__hint">${n} ${n === 1 ? 'sesión' : 'sesiones'} con pulso</span></div>
      ${line}
      ${chart || (pts.length ? '<p class="pg-heart__hint">Importa el pulso de unas cuantas sesiones más para ver la tendencia.</p>' : '')}
      ${music}
    </div>
  </section>`;
}

function heatSection(history, today) {
  let values = safe(() => dayValues(history), null);
  if (!values || typeof values !== 'object') values = localDayValues(history);
  const start = addDays(today, -(16 * 7 - 1));
  const active = Object.keys(values).filter((k) => k >= start && k <= today && Number(values[k]) > 0).length;
  return `<section class="pg-section stack">
    ${sectionHeader('Constancia')}
    <div class="card pg-card pg-heat">
      <div class="pg-card__head">
        <div class="pg-heat__count"><b class="num">${active}</b> ${active === 1 ? 'día activo' : 'días activos'}</div>
        <span class="pg-card__hint">últimas 16 semanas</span>
      </div>
      <div class="pg-heat__map">${heatmapCalendar(values, { weeks: 16, endKey: today, color: 'var(--accent)' })}</div>
    </div>
  </section>`;
}

const RECORD_DEFS = [
  { key: 'maxDistanceKm', label: 'Mayor distancia', ic: 'route', color: 'var(--info)', value: (v) => [fmt.km(v), 'km'] },
  { key: 'longestSec', label: 'Sesión más larga', ic: 'timer', color: 'var(--z-jog)', value: (v) => (v >= 3600 ? [fmt.clock(v), 'h'] : [String(Math.round(v / 60)), 'min']) },
  { key: 'maxSpeed', label: 'Velocidad punta', ic: 'bolt', color: 'var(--z-sprint)', value: (v) => [fmt.speed(v), 'km/h'] },
  { key: 'maxAvgSpeed', label: 'Mejor media', ic: 'gauge', color: 'var(--z-run)', value: (v) => [fmt.speed(v), 'km/h'] },
  { key: 'mostSprintSec', label: 'Más tiempo a sprint', ic: 'flame', color: 'var(--z-fast)', value: (v) => [fmt.clock(v), 'min'] },
  { key: 'bestVam', label: 'Mejor VAM', ic: 'target', color: 'var(--c-test)', value: (v) => [fmt.speed(v), 'km/h'] },
];

function recordsSection(history) {
  const recs = safe(() => records(history), null);
  const local = localRecords(history);
  const cards = RECORD_DEFS.map((def) => {
    const e = pickRecord(recs, def.key) || local[def.key];
    const value = Number(e?.value) || 0;
    if (value <= 0) return '';
    const sid = e.sessionId || local[def.key]?.sessionId || null;
    const ses = sid ? history.find((h) => h.id === sid) : null;
    const [v, unit] = def.value(value);
    const attrs = ses ? `data-href="#/history/${esc(encodeURIComponent(ses.id))}"` : '';
    const tag = ses ? 'button type="button"' : 'div';
    const end = ses ? 'button' : 'div';
    return `<${tag} class="pg-record${ses ? ' card--pressable' : ''}" style="--rc:${def.color}" ${attrs}>
      <span class="pg-record__icon">${icon(def.ic, 16)}</span>
      <span class="pg-record__label">${esc(def.label)}</span>
      <span class="pg-record__value num">${esc(v)}<small>${esc(unit)}</small></span>
      <span class="pg-record__date">${ses?.dayKey ? `${esc(shortDate(ses.dayKey))}${icon('chevron-right', 12, { stroke: 2.5 })}` : '&nbsp;'}</span>
    </${end}>`;
  }).filter(Boolean);
  if (!cards.length) return '';
  return `<section class="pg-section stack">
    ${sectionHeader('Récords personales')}
    <div class="pg-records">${cards.join('')}</div>
  </section>`;
}

function medalHtml(a, iso, i, big = false) {
  const tier = TIERS.includes(a.tier) ? a.tier : 'bronze';
  const unlocked = !!iso;
  const days = unlocked ? daysBetween(isoToKey(iso) || todayKey(), todayKey()) : null;
  const fresh = unlocked && days != null && days <= 7;
  const cls = `pg-medal pg-medal--${tier}${unlocked ? '' : ' is-locked'}${big ? ' pg-medal--xl' : ''}`;
  const disc = `<span class="pg-medal__disc">${icon(a.icon || 'medal', big ? 44 : 26, { stroke: 2.2 })}${unlocked ? '' : `<span class="pg-medal__lock">${icon('lock', big ? 16 : 11, { stroke: 2.6 })}</span>`}</span>`;
  if (big) return `<div class="${cls}">${disc}</div>`;
  return `<button type="button" class="${cls}" data-ach="${esc(a.id)}" style="--d:${((i * 0.37) % 4).toFixed(2)}s" aria-label="${esc(a.title)}${unlocked ? '' : ', bloqueado'}">
    ${disc}${fresh ? '<span class="pg-medal__new">Nuevo</span>' : ''}
    <span class="pg-medal__name">${esc(a.title)}</span>
  </button>`;
}

function achievementsSection(s) {
  const list = Array.isArray(ACHIEVEMENTS) ? ACHIEVEMENTS : [];
  if (!list.length) return '';
  const got = s.achievements || {};
  const n = list.filter((a) => got[a.id]).length;
  const pct = Math.round((n / list.length) * 100);
  const text = n === 0
    ? 'Tu primera medalla está a una sesión de distancia.'
    : n === list.length
      ? '¡Colección completa! Eres una leyenda de la cinta.'
      : `Llevas ${n} ${n === 1 ? 'medalla' : 'medallas'}. Te ${list.length - n === 1 ? 'falta 1' : `faltan ${list.length - n}`}: ¡a por ellas!`;
  return `<section class="pg-section stack">
    ${sectionHeader('Logros', `<span class="pg-count-badge num">${n}/${list.length}</span>`)}
    <div class="card pg-card pg-ach">
      <div class="pg-ach__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
      <p class="pg-ach__text">${esc(text)}</p>
      <div class="pg-medals">${list.map((a, i) => medalHtml(a, got[a.id], i)).join('')}</div>
    </div>
  </section>`;
}

function historyLink(count) {
  return `<button type="button" class="card card--pressable pg-history-link" data-href="#/history">
    <span class="pg-history-link__icon">${icon('list', 20)}</span>
    <span class="pg-history-link__text"><b>Historial completo</b><span class="muted">${count} ${count === 1 ? 'sesión registrada' : 'sesiones registradas'}</span></span>
    ${icon('chevron-right', 18)}
  </button>`;
}

function view(s, animate) {
  const history = Array.isArray(s.history) ? s.history.filter(Boolean) : [];
  const today = todayKey();
  const parts = [];
  if (!history.length) {
    parts.push(emptyHero());
  } else {
    parts.push(weekCard(s, today));
    parts.push(kpiGrid(s, history, animate));
    // La tarjeta de semana de arriba ya dice «X de Y sesiones»: el coach no lo repite
    const insight = safe(() => coachInsight(s, new Date(), { skipWeek: true }), '');
    if (insight && typeof insight === 'string') parts.push(insightCard(insight));
    parts.push(weeklyCard(history, today, s.ui?.progressMetric));
  }
  parts.push(speedsSection(s, today));
  if (history.length) parts.push(heartSection(s, today));
  if (history.length) {
    parts.push(heatSection(history, today));
    parts.push(recordsSection(history));
  }
  parts.push(achievementsSection(s));
  if (history.length) parts.push(historyLink(history.length));
  return parts.filter(Boolean).map((p, i) => `<div class="pg-part" style="--i:${i}">${p}</div>`).join('');
}

/* ───────────── hojas ───────────── */

function openMedal(id) {
  const s = getState();
  const list = Array.isArray(ACHIEVEMENTS) ? ACHIEVEMENTS : [];
  const a = list.find((x) => x.id === id);
  if (!a) return;
  const iso = s.achievements?.[id];
  const tier = TIERS.includes(a.tier) ? a.tier : 'bronze';
  const key = isoToKey(iso);
  const ago = key ? daysBetween(key, todayKey()) : null;
  const agoTxt = ago == null ? '' : ago === 0 ? 'hoy' : ago === 1 ? 'ayer' : `hace ${ago} días`;
  const status = iso
    ? `<div class="pg-msheet__status is-done">${icon('check', 16, { stroke: 3 })}<span>Conseguida el ${esc(key ? fmt.dateLong(key) : '')}${agoTxt ? ` · ${esc(agoTxt)}` : ''}</span></div>`
    : `<div class="pg-msheet__status">${icon('lock', 16)}<span>Aún bloqueada. ¡Tú puedes conseguirla!</span></div>`;
  haptic(iso ? 'success' : 'light');
  openSheet({
    title: '',
    html: `<div class="pg-msheet pg-msheet--${tier}${iso ? '' : ' is-locked'}">
      <div class="pg-msheet__halo" aria-hidden="true"></div>
      ${medalHtml(a, iso, 0, true)}
      <div class="pg-msheet__tier">Medalla de ${esc((TIER_NAME[tier] || '').toLowerCase())}</div>
      <h3 class="pg-msheet__title">${esc(a.title)}</h3>
      <p class="pg-msheet__desc">${esc(a.description || '')}</p>
      ${status}
    </div>`,
    actions: [{ label: iso ? '¡Genial!' : 'Entendido', kind: 'primary', onClick: (close) => close() }],
  });
  if (iso && ago != null && ago <= 7 && !reducedMotion()) safe(() => celebrate({ intensity: tier === 'gold' ? 0.7 : 0.45 }));
}

function openVo2Sheet() {
  const d = vo2Data(getState());
  const labels = ['Mejorable', 'Regular', 'Bueno', 'Excelente', 'Superior'];
  const edges = [null, ...d.t, null];
  const rows = labels.map((l, i) => {
    const lo = edges[i];
    const hi = edges[i + 1];
    const range = lo == null ? `< ${hi}` : hi == null ? `≥ ${lo}` : `${lo}–${hi}`;
    return `<div class="pg-vtable__row${i === d.cat.tier ? ' is-current' : ''}" style="--pc:${VO2_COLORS[i]}">
      <span class="pg-vtable__dot"></span><span class="pg-vtable__name">${l}</span>
      <span class="pg-vtable__range num">${range}</span>${i === d.cat.tier ? '<span class="pg-vtable__you">Tú</span>' : ''}
    </div>`;
  }).join('');
  openSheet({
    title: 'Tu VO₂máx',
    large: true,
    html: `<div class="pg-vsheet stack">
      <div class="pg-vsheet__hero" style="--tc:${d.color}">
        <b class="num">${fmt.dec1(d.vo2)}</b><span>ml/kg/min · <em>${esc(d.cat.label)}</em></span>
      </div>
      <p>El <b>VO₂máx</b> es el máximo oxígeno que tu cuerpo puede usar por minuto y por kilo. Es el mejor indicador de tu forma cardiovascular y uno de los que más se relacionan con la salud a largo plazo.</p>
      <p><b>Cómo lo calculamos:</b> a partir de tu VAM (velocidad aeróbica máxima, ${fmt.speed(d.vam)} km/h) con la fórmula de Léger: VO₂máx ≈ 3,5 × VAM. Es una estimación orientativa; un test de laboratorio sería más preciso.</p>
      <div class="eyebrow">Referencia ${esc(d.sex === 'f' ? 'para mujeres' : 'para hombres')} ${esc(ageBand(d.age))}</div>
      <div class="pg-vtable">${rows}</div>
      <p><b>Edad de forma ${d.fitAge <= 25 ? '≤' : '≈'} ${d.fitAge} años:</b> la edad a la que tu VO₂máx sería lo típico. Si es menor que tu edad real, tu motor va por delante del calendario.</p>
      <div class="pg-vsheet__tips">
        <div class="eyebrow">Cómo subirlo</div>
        <div class="pg-tip">${icon('bolt', 16)}<span>Intervalos de 2–4 minutos a ritmo «rápido»: el estímulo más directo.</span></div>
        <div class="pg-tip">${icon('route', 16)}<span>Sesiones largas y suaves (Z2) los jueves y el finde: construyen la base.</span></div>
        <div class="pg-tip">${icon('gauge', 16)}<span>Haz el Test VAM en la semana de descarga para medir tu mejora real cada 4 semanas.</span></div>
        <div class="pg-tip">${icon('moon', 16)}<span>Duerme bien y respeta el descanso: ahí es donde tu cuerpo se adapta.</span></div>
      </div>
    </div>`,
    actions: [{ label: 'Entendido', kind: 'primary', onClick: (close) => close() }],
  });
}

/* ───────────── montaje ───────────── */

export function mount(el) {
  el.classList.add('pg-screen');
  safe(() => ensureWatchHrStyles());
  el.innerHTML = `${navBar({
    title: 'Progreso',
    large: true,
    right: `<button type="button" class="btn-icon pg-nav-btn" data-href="#/history" aria-label="Historial completo">${icon('list', 20)}</button>`,
  })}<div class="container stack-lg pg-body" data-body></div>`;
  const body = el.querySelector('[data-body]');
  const offHeader = safe(() => enableCollapsingHeader(el), null);

  let first = true;
  let raf = 0;
  let stopCount = () => {};
  let selfState = null;
  let selfAt = 0;

  const render = () => {
    raf = 0;
    stopCount();
    const s = getState();
    const animate = first && !reducedMotion();
    body.innerHTML = view(s, animate);
    body.classList.toggle('stagger', first);
    if (animate) stopCount = countUp(body);
    first = false;
    hydrateTopMusic(s);
  };

  // Títulos de «Lo que más suena» desde la biblioteca (y canciones importadas)
  let musicLoaded = false;
  const hydrateTopMusic = (s) => {
    if (musicLoaded || !body.querySelector('[data-top-music]')) return;
    const top = safe(() => topTracks(s.history || [], 3), []);
    const ids = top.map((t) => t.id).filter(Boolean);
    if (!ids.length) return;
    musicLoaded = true;
    loadMusicMeta(ids).then(() => {
      const host = body.isConnected ? body.querySelector('[data-top-music]') : null;
      if (host) host.innerHTML = topMusicRows(safe(() => topTracks(getState().history || [], 3), top));
    }).catch(() => {});
  };

  const updateWeekly = (metric) => {
    const s = getState();
    const history = Array.isArray(s.history) ? s.history : [];
    let buckets = safe(() => weeklyBuckets(history, 12, todayKey()), null);
    if (!Array.isArray(buckets) || !buckets.length) buckets = localWeekly(history, 12, todayKey());
    const head = body.querySelector('[data-weekly-head]');
    const chart = body.querySelector('[data-weekly-chart]');
    if (head) head.innerHTML = weeklyHead(buckets, metric);
    if (chart) chart.innerHTML = weeklyChart(buckets, metric);
  };

  const onClick = (e) => {
    const medal = e.target.closest('[data-ach]');
    if (medal) {
      openMedal(medal.dataset.ach);
      return;
    }
    if (e.target.closest('[data-pg="vo2"]')) {
      haptic('light');
      openVo2Sheet();
    }
  };

  const onChange = (e) => {
    const d = e.detail;
    let name = d && typeof d === 'object' ? d.name : null;
    let value = d && typeof d === 'object' ? d.value : null;
    if (!name && e.target?.name === 'pg-metric' && e.target.checked) {
      name = 'pg-metric';
      value = e.target.value;
    }
    if (name !== 'pg-metric') return;
    const metric = value === 'min' ? 'min' : 'km';
    if ((getState().ui?.progressMetric || 'km') === metric) return;
    haptic('selection');
    selfAt = Date.now();
    selfState = setState((draft) => {
      draft.ui = draft.ui || {};
      draft.ui.progressMetric = metric;
    });
    updateWeekly(metric);
  };

  body.addEventListener('click', onClick);
  body.addEventListener('change', onChange);

  const unsub = subscribe((state) => {
    if (state === selfState || Date.now() - selfAt < 300) return;
    if (!raf) raf = requestAnimationFrame(render);
  });

  render();

  return () => {
    unsub?.();
    stopCount();
    if (raf) cancelAnimationFrame(raf);
    body.removeEventListener('click', onClick);
    body.removeEventListener('change', onChange);
    if (typeof offHeader === 'function') offHeader();
  };
}
