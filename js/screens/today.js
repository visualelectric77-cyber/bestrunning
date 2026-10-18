// BestRunning · «Hoy»: saludo, tira semanal, clase del día, velocidades, semana, ciclo y consejo del coach.
import { getState, subscribe } from '../core/store.js';
import { navigate } from '../core/router.js';
import { haptic } from '../core/haptics.js';
import {
  icon, navBar, enableCollapsingHeader, intensityDots, profileChart, ring, openSheet, sectionHeader, emptyState,
} from '../ui/components.js';
import * as charts from '../ui/charts.js';
import { planWeek, planDay, cycleInfo, nextTestDate, CYCLE_WEEKS } from '../training/planner.js';
import { CATEGORIES, templatesFor, getTemplate } from '../training/templates.js';
import { buildWorkout } from '../training/generator.js';
import * as progression from '../training/progression.js';
import * as stats from '../training/stats.js';
import { ZONES, LEVEL_KEYS } from '../training/levels.js';
import {
  todayKey, addDays, mondayOf, parseKey, daysBetween, weekdayOf, fmt, esc, capitalize, hashStr, round1,
} from '../core/utils.js';
import { openSwapSheet } from './plan.js';

const INSTALL_KEY = 'br.td.installDismissed';

/* ───────────── Utilidades privadas ───────────── */

function safe(fn, fallback) {
  try {
    const v = fn();
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

const catName = (c) => CATEGORIES[c]?.name || 'Clase';
const catIcon = (c) => CATEGORIES[c]?.icon || 'bolt';
const ccStyle = (c) => `--cc:var(--c-${CATEGORIES[c] ? c : 'test'})`;
const enc = (id) => encodeURIComponent(id);
/** Minutos nominales (en el test VAM totalSec es el máximo teórico hasta la velocidad tope de la cinta). */
const mins = (w) => w?.minutes || Math.round((w?.totalSec || 0) / 60);

function greeting(name, d = new Date()) {
  const h = d.getHours();
  const g = h >= 5 && h < 13 ? 'Buenos días' : h >= 13 && h < 21 ? 'Buenas tardes' : 'Buenas noches';
  const n = String(name || '').trim().split(/\s+/)[0];
  return n ? `${g}, ${n}` : g;
}

function isStandalone() {
  try {
    return (
      navigator.standalone === true ||
      matchMedia('(display-mode: standalone)').matches ||
      document.documentElement.classList.contains('is-standalone')
    );
  } catch {
    return false;
  }
}

function installDismissed() {
  try {
    return localStorage.getItem(INSTALL_KEY) === '1';
  } catch {
    return false;
  }
}

function dismissInstall() {
  try {
    localStorage.setItem(INSTALL_KEY, '1');
  } catch {
    /* almacenamiento no disponible: se ocultará solo en esta visita */
  }
}

/** Niveles de hace ~4 semanas (o los iniciales si el historial es más corto). */
function referenceLevels(history, today) {
  if (!Array.isArray(history) || !history.length) return null;
  const sorted = history.filter((h) => h?.date && h.levels).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!sorted.length) return null;
  const limit = addDays(today, -28);
  let ref = null;
  for (const h of sorted) if (h.date <= limit) ref = h;
  return (ref || sorted[0]).levels;
}

function fallbackWeek(days) {
  const train = days.filter((d) => d.workout && d.kind !== 'rest');
  const done = days.filter((d) => d.status === 'done' && d.session);
  return {
    doneSessions: done.length,
    plannedSessions: train.length,
    minutes: Math.round(done.reduce((a, d) => a + (d.session.elapsedSec || 0), 0) / 60),
    plannedMinutes: Math.round(train.reduce((a, d) => a + (d.workout.totalSec || 0), 0) / 60),
    km: done.reduce((a, d) => a + (d.session.distanceKm || 0), 0),
  };
}

const REST_LINES = [
  'El cuerpo mejora mientras descansa. Estira 10 minutos, hidrátate y duerme bien.',
  'Hoy no se corre: se asimila. Mañana volverás con las piernas frescas.',
  'Descansar también es entrenar. Un paseo suave y a dormir pronto.',
  'Tus músculos se están reconstruyendo más fuertes. Dales el día.',
  'Recargar pilas es parte del plan. Movilidad suave y mucha agua.',
];

const DONE_LINES = ['¡Así se hace!', 'Otro paso más en tu forma.', 'Cumplido y con nota.', 'Hoy has sumado. Disfrútalo.'];

/* ───────────── Bloques ───────────── */

/** Estado para pintar: los días anteriores a empezar a usar la app no cuentan como «no realizados». */
function viewStatus(day, state) {
  const st = day.status || (day.kind === 'rest' ? 'rest' : 'upcoming');
  if (st !== 'missed' || !state.createdAt) return st;
  const c = new Date(state.createdAt);
  return !Number.isNaN(c.getTime()) && day.date < todayKey(c) ? 'before' : st;
}

function weekStrip(days, today, selected, state) {
  const cells = days.map((d) => {
    const isToday = d.date === today;
    const st = viewStatus(d, state);
    const cat = d.workout && d.kind !== 'rest' ? d.workout.category : null;
    const num = parseKey(d.date).getDate();
    const wd = d.weekday || weekdayOf(d.date);
    const what = cat ? d.workout.title : 'descanso';
    const stLabel = { done: 'hecho', missed: 'no realizado', today: 'hoy', upcoming: 'pendiente', rest: '', before: '' }[st] || '';
    const label = `${capitalize(fmt.weekdayName(wd))} ${num}: ${what}${stLabel ? ', ' + stLabel : ''}`;
    const mark = st === 'done' ? icon('check', 16, { stroke: 3 }) : `<span class="num">${num}</span>`;
    return `<button type="button" class="td-day st-${st}${isToday ? ' is-today' : ''}${d.date === selected ? ' is-selected' : ''}"
        data-day="${d.date}" style="${cat ? ccStyle(cat) : ''}" aria-pressed="${d.date === selected}" aria-label="${esc(label)}">
      <span class="td-day__wd">${fmt.weekdayShort(wd)}</span>
      <span class="td-day__mark">${mark}</span>
      <span class="td-day__dot" aria-hidden="true"></span>
    </button>`;
  });
  return `<div class="td-strip" role="group" aria-label="Tu semana">${cells.join('')}</div>`;
}

function trainHero(day, state, today, animate) {
  const w = day.workout;
  const rel = fmt.relativeDay(day.date, today);
  const missed = viewStatus(day, state) === 'missed';
  const isTest = day.kind === 'test' || w.isTest;
  const chip = missed
    ? '<span class="td-hero__status is-missed">No realizada</span>'
    : isTest
      ? '<span class="td-hero__status is-test">Test VAM</span>'
      : day.isOverride
        ? '<span class="td-hero__status">Editada</span>'
        : '';
  const play = `#/play/${enc(w.id)}?date=${day.date}`;
  const detail = `#/workout/${enc(w.id)}?date=${day.date}&from=today`;
  const km = w.estDistanceKm ? `<span>${icon('route', 15)} ~${fmt.dec1(w.estDistanceKm)} km</span>` : '';
  const kcal = w.estKcal ? `<span>${icon('flame', 15)} ${fmt.int(w.estKcal)} kcal</span>` : '';
  const goLabel = missed ? 'Hacerla ahora' : 'Empezar';
  return `<article class="td-hero${animate ? ' td-hero--in' : ''}" style="${ccStyle(w.category)}">
    <div class="td-hero__aurora" aria-hidden="true"><span></span><span></span></div>
    <div class="td-hero__top">
      <span class="td-hero__eyebrow">${icon(catIcon(w.category), 14)} ${esc(rel)} · ${esc(catName(w.category))}</span>
      ${chip}
    </div>
    <h2 class="td-hero__title">${esc(w.title)}</h2>
    ${w.subtitle || w.focus ? `<p class="td-hero__sub">${esc(w.subtitle || w.focus)}</p>` : ''}
    <div class="td-hero__meta">
      <span>${icon('timer', 15)} ${mins(w)} min</span>${km}${kcal}
      <span class="td-hero__dots" aria-label="Intensidad ${w.intensity || 1} de 3">${intensityDots(w.intensity || 1, '#fff')}</span>
    </div>
    <button type="button" class="td-hero__chart" data-href="${detail}" aria-label="Ver la estructura de la clase">${profileChart(w.segments || [], { height: 92, levels: state.levels })}</button>
    <div class="td-hero__actions">
      <button type="button" class="btn btn--primary btn--lg td-go" data-href="${play}" aria-label="${esc(`${goLabel}: ${w.title}`)}">${icon('play', 20)}<span>${goLabel}</span></button>
      <button type="button" class="btn btn--secondary btn--lg td-view" data-href="${detail}">Ver clase</button>
      <button type="button" class="btn-icon td-swap" data-swap="${day.date}" aria-label="Cambiar clase">${icon('shuffle', 20)}</button>
    </div>
  </article>`;
}

function doneHero(day, today, animate) {
  const s = day.session;
  const rel = fmt.relativeDay(day.date, today);
  const line = DONE_LINES[hashStr(s.id || day.date) % DONE_LINES.length];
  const cell = (v, u, l) => `<div class="td-done__stat"><span class="num">${v}</span><span class="td-done__unit">${u}</span><span class="td-done__label">${l}</span></div>`;
  return `<article class="td-hero td-hero--done${animate ? ' td-hero--in' : ''}" style="--cc:var(--ok)">
    <div class="td-hero__aurora" aria-hidden="true"><span></span><span></span></div>
    <div class="td-hero__top">
      <span class="td-hero__eyebrow">${icon('check', 14, { stroke: 3 })} ${esc(rel)} · completado</span>
      <span class="td-done__badge" aria-hidden="true">${icon('trophy', 22)}</span>
    </div>
    <h2 class="td-hero__title">¡Hecho!</h2>
    <p class="td-hero__sub">${esc(s.title || 'Entrenamiento')} · ${esc(line)}</p>
    <div class="td-done__grid">
      ${cell(fmt.dec1(s.distanceKm || 0), 'km', 'Distancia')}
      ${cell(fmt.clock(s.elapsedSec || 0), '', 'Tiempo')}
      ${cell(fmt.speed(s.avgSpeed || 0), 'km/h', 'Media')}
      ${cell(fmt.int(s.kcal || 0), 'kcal', 'Energía')}
    </div>
    <div class="td-hero__actions">
      ${s.id ? `<button type="button" class="btn btn--secondary btn--lg" data-href="#/summary/${enc(s.id)}">Ver resumen</button>` : ''}
      <button type="button" class="btn btn--primary btn--lg td-go" data-href="#/library">${icon('plus', 20)}<span>Otra sesión</span></button>
    </div>
  </article>`;
}

function nextTraining(state, fromKey) {
  for (let i = 1; i <= 7; i++) {
    const key = addDays(fromKey, i);
    const d = safe(() => planDay(state, key), null);
    if (d?.workout && d.kind !== 'rest') return d;
  }
  return null;
}

function restHero(day, state, today, animate) {
  const rel = fmt.relativeDay(day.date, today);
  const line = REST_LINES[hashStr(day.date) % REST_LINES.length];
  const next = nextTraining(state, day.date);
  const nextHtml = next
    ? `<button type="button" class="td-rest__next" data-href="#/workout/${enc(next.workout.id)}?date=${next.date}&from=today" style="${ccStyle(next.workout.category)}">
        <span class="td-rest__nextbar" aria-hidden="true"></span>
        <span><span class="td-rest__nextlabel">${esc(fmt.relativeDay(next.date, today))}</span><b>${esc(next.workout.title)}</b> · ${mins(next.workout)} min</span>
        ${icon('chevron-right', 18)}
      </button>`
    : '';
  return `<article class="td-hero td-hero--rest${animate ? ' td-hero--in' : ''}" style="--cc:var(--c-recovery)">
    <div class="td-hero__aurora" aria-hidden="true"><span></span><span></span></div>
    <div class="td-hero__top">
      <span class="td-hero__eyebrow">${icon('moon', 14)} ${esc(rel)} · descanso</span>
      <span class="td-rest__moon" aria-hidden="true">${icon('moon', 26)}</span>
    </div>
    <h2 class="td-hero__title">Toca recargar</h2>
    <p class="td-hero__sub">${esc(line)}</p>
    ${nextHtml}
    <div class="td-hero__actions">
      <button type="button" class="btn btn--secondary btn--lg btn--block" data-train-anyway="${day.date}">${icon('leaf', 20)} Entrenar igualmente</button>
    </div>
  </article>`;
}

function heroBlock(day, state, today, animate) {
  if (!day) {
    return emptyState({
      icon: 'calendar',
      title: 'No hemos podido preparar tu día',
      text: 'Revisa tu semana en Perfil o elige una clase de la biblioteca.',
      action: '<button type="button" class="btn btn--primary" data-href="#/library">Ver clases</button>',
    });
  }
  if (day.status === 'done' && day.session) return doneHero(day, today, animate);
  if (day.kind === 'rest' || !day.workout) return restHero(day, state, today, animate);
  return trainHero(day, state, today, animate);
}

function speedsBlock(state, today) {
  const lv = state.levels || {};
  const ref = referenceLevels(state.levelHistory, today);
  const hist = (Array.isArray(state.levelHistory) ? state.levelHistory : []).filter((h) => h?.levels).slice(-12);
  const tiles = LEVEL_KEYS.map((k) => {
    const v = lv[k] ?? 0;
    let trend = '<span class="td-trend is-flat" aria-label="Sin cambios">=</span>';
    if (ref && typeof ref[k] === 'number') {
      const d = round1(v - ref[k]);
      if (d > 0) trend = `<span class="td-trend is-up" aria-label="Sube ${fmt.speed(d)}">${icon('arrow-up', 12, { stroke: 2.8 })}${fmt.speed(d)}</span>`;
      else if (d < 0) trend = `<span class="td-trend is-down" aria-label="Baja ${fmt.speed(-d)}">${icon('arrow-down', 12, { stroke: 2.8 })}${fmt.speed(-d)}</span>`;
    }
    const values = hist.map((h) => h.levels[k]).filter((x) => typeof x === 'number');
    values.push(v);
    const spark = values.length >= 3 && typeof charts.sparkline === 'function'
      ? `<span class="td-speed__spark" aria-hidden="true">${safe(() => charts.sparkline(values, { color: `var(--z-${k})`, height: 22 }), '')}</span>`
      : '';
    return `<button type="button" class="td-speed" style="--zc:var(--z-${k})" data-href="#/settings/speeds" aria-label="${esc(ZONES[k].name)}: ${fmt.speed(v)} km/h">
      <span class="td-speed__glow" aria-hidden="true"></span>
      <span class="td-speed__top"><span class="td-speed__name">${esc(ZONES[k].name)}</span>${trend}</span>
      <span class="td-speed__val"><span class="num">${fmt.speed(v)}</span><span class="td-speed__unit">km/h</span></span>
      <span class="td-speed__pace">${fmt.pace(v)} min/km</span>
      ${spark}
    </button>`;
  });
  return `<section class="td-section">
    ${sectionHeader('Tus velocidades', '<span class="td-aside">vs. hace 4 semanas</span>')}
    <div class="td-speeds">${tiles.join('')}</div>
  </section>`;
}

function weekCard(state, days, today) {
  const monday = mondayOf(today);
  let wp = typeof stats.weekProgress === 'function' ? safe(() => stats.weekProgress(state, monday), null) : null;
  if (!wp) wp = fallbackWeek(days);
  const planned = wp.plannedMinutes || 0;
  const value = planned ? Math.min(1, (wp.minutes || 0) / planned) : 0;
  const inner = `<span class="td-ring"><span class="td-ring__val num">${fmt.int(wp.minutes || 0)}</span><span class="td-ring__of">de ${fmt.int(planned)}′</span></span>`;
  return `<button type="button" class="card card--pressable td-mini td-weekcard" data-href="#/progress" aria-label="Esta semana: ${fmt.int(wp.minutes || 0)} de ${fmt.int(planned)} minutos">
    <span class="eyebrow">Esta semana</span>
    <div class="td-weekcard__ring">${ring({ value, size: 92, stroke: 10, color: 'var(--accent)', inner })}</div>
    <div class="td-weekcard__stats">
      <span><b class="num">${wp.doneSessions || 0}/${wp.plannedSessions || 0}</b><small>sesiones</small></span>
      <span><b class="num">${fmt.dec1(wp.km || 0)}</b><small>km</small></span>
    </div>
  </button>`;
}

function cycleCard(state, today) {
  const ci = safe(() => cycleInfo(state, today), null);
  if (!ci) return '';
  const w = ci.weekInCycle || 1;
  const segs = [1, 2, 3, 4]
    .map((n) => `<span class="td-cycle__seg${n < w ? ' is-past' : ''}${n === w ? ' is-current' : ''}${n === 4 ? ' is-test' : ''}"></span>`)
    .join('');
  const nt = safe(() => nextTestDate(state, today), null);
  let testLine = '';
  if (nt) {
    const dd = daysBetween(today, nt);
    testLine = dd <= 0
      ? `${icon('gauge', 14)} Test VAM hoy`
      : dd < 7
        ? `${icon('gauge', 14)} Test el ${esc(fmt.weekdayName(weekdayOf(nt)))}`
        : `${icon('gauge', 14)} Test: ${esc(fmt.dateShort(nt))}`;
  }
  return `<button type="button" class="card card--pressable td-mini td-cycle${ci.isDeload ? ' is-deload' : ''}" data-href="#/plan" aria-label="Ciclo ${ci.cycleIndex + 1}, semana ${w} de 4: ${esc(ci.weekName || '')}">
    <span class="eyebrow">Ciclo ${ci.cycleIndex + 1}</span>
    <div class="td-cycle__week"><span class="num">${w}</span><span class="td-cycle__of">/4</span></div>
    <div class="td-cycle__name">${esc(ci.weekName || CYCLE_WEEKS[w - 1] || '')}</div>
    <div class="td-cycle__bar" aria-hidden="true">${segs}</div>
    ${testLine ? `<div class="td-cycle__test">${testLine}</div>` : ''}
  </button>`;
}

function coachCard(state) {
  let text = typeof progression.coachInsight === 'function' ? safe(() => progression.coachInsight(state), '') : '';
  if (!text) text = 'La constancia gana a la intensidad. Cumple tus sesiones cortas y el jueves dale un poco más de cuerda.';
  return `<div class="card td-coach">
    <span class="td-coach__icon" aria-hidden="true">${icon('sparkles', 20)}</span>
    <div class="td-coach__body">
      <span class="eyebrow">Consejo del coach</span>
      <p class="td-coach__text">${esc(text)}</p>
    </div>
  </div>`;
}

function installBanner() {
  if (isStandalone() || installDismissed()) return '';
  return `<div class="card td-install" role="note">
    <span class="td-install__logo" aria-hidden="true"></span>
    <div class="td-install__body">
      <b>Instala BestRunning</b>
      <p>Toca <span class="td-install__share">${icon('share', 15)}</span> <b>Compartir</b> y luego <b>«Añadir a pantalla de inicio»</b>. Se abrirá a pantalla completa y funciona sin conexión.</p>
    </div>
    <button type="button" class="btn-icon td-install__close" data-dismiss-install aria-label="Ocultar">${icon('close', 18)}</button>
  </div>`;
}

/* ───────────── Hoja «Entrenar igualmente» ───────────── */

function openTrainAnyway(dateKey) {
  const state = getState();
  const minutes = state.schedule?.weekdayMinutes || 20;
  const hasIncline = !!state.treadmill?.hasIncline;
  const seed = hashStr(`easy-${dateKey}`);
  const opts = { minutes, levels: state.levels, seed, loadFactor: 0.9, hasIncline, treadmill: state.treadmill, weightKg: state.profile?.weightKg };
  const list = [];
  const pool = [
    ...safe(() => templatesFor({ category: 'recovery', minutes, hasIncline }), []),
    safe(() => getTemplate('aerobic-base'), null),
  ].filter(Boolean);
  const seen = new Set();
  for (const t of pool) {
    if (seen.has(t.id) || list.length >= 3) continue;
    seen.add(t.id);
    const w = safe(() => buildWorkout(t.id, opts), null);
    if (w) list.push(w);
  }
  const rows = list
    .map((w, i) => `<button type="button" class="pn-alt" data-easy="${i}" style="${ccStyle(w.category)}">
      <span class="pn-alt__bar" aria-hidden="true"></span>
      <span class="pn-alt__body">
        <span class="pn-alt__eyebrow">${esc(catName(w.category))}</span>
        <span class="pn-alt__title">${esc(w.title)}</span>
        <span class="pn-alt__meta">${Math.round(w.totalSec / 60)} min · ~${fmt.dec1(w.estDistanceKm || 0)} km ${intensityDots(w.intensity || 1, 'var(--cc)')}</span>
      </span>
      <span class="pn-alt__chart" aria-hidden="true">${profileChart(w.segments || [], { height: 84, compact: true })}</span>
    </button>`)
    .join('');
  openSheet({
    title: 'Entrenar igualmente',
    html: `<p class="pn-sheet__lead">Si te apetece moverte, que sea suave: trote cómodo y piernas sueltas. El día fuerte llegará.</p>
      <div class="pn-alts">${rows || '<p class="muted">No hay clases suaves disponibles.</p>'}</div>`,
    onMount(sheetEl, close) {
      sheetEl.addEventListener('click', (e) => {
        const b = e.target.closest('[data-easy]');
        if (!b) return;
        const w = list[Number(b.dataset.easy)];
        if (!w) return;
        haptic('light');
        close();
        navigate(`#/workout/${enc(w.id)}?date=${dateKey}&from=today`);
      });
    },
    actions: [
      {
        label: 'Elegir otra clase para este día',
        kind: 'secondary',
        onClick: (close) => {
          close();
          openSwapSheet(dateKey);
        },
      },
    ],
  });
}

/* ───────────── Pantalla ───────────── */

export function mount(el) {
  const s0 = getState();
  let today = todayKey();
  let selected = today;
  let first = true;
  let heroAnim = false;
  const initial = String(s0.profile?.name || '').trim().charAt(0).toUpperCase();

  el.innerHTML = `${navBar({
    title: greeting(s0.profile?.name),
    large: true,
    right: `<button type="button" class="td-avatar" data-href="#/settings" aria-label="Perfil">${initial ? esc(initial) : icon('person', 20)}</button>`,
  })}<div class="container td"></div>`;
  const root = el.querySelector('.td');
  const cleanupHeader = enableCollapsingHeader(el);

  function render() {
    const state = getState();
    const days = safe(() => planWeek(state, mondayOf(today)), null);
    const list = Array.isArray(days) && days.length === 7 ? days : null;
    let day = list?.find((d) => d.date === selected) || null;
    if (!day) day = safe(() => planDay(state, selected), null);
    const streak = typeof stats.streakWeeks === 'function' ? safe(() => stats.streakWeeks(state, new Date()), 0) : 0;

    const blocks = [
      `<div class="td-head">
        <span class="td-date">${esc(capitalize(fmt.dateLong(today)))}</span>
        ${streak > 0 ? `<span class="td-streak">${icon('flame', 14)} ${streak} ${streak === 1 ? 'semana' : 'semanas'}</span>` : ''}
      </div>`,
      list ? weekStrip(list, today, selected, state) : '',
      heroBlock(day, state, today, heroAnim),
      speedsBlock(state, today),
      `<div class="td-duo">${weekCard(state, list || [], today)}${cycleCard(state, today)}</div>`,
      coachCard(state),
      installBanner(),
    ].filter(Boolean);

    root.classList.toggle('stagger', first);
    root.innerHTML = blocks.map((b, i) => `<div class="td-block" style="--i:${i}">${b}</div>`).join('');
    first = false;
    heroAnim = false;
  }

  const onClick = (e) => {
    const dayBtn = e.target.closest('[data-day]');
    if (dayBtn) {
      const key = dayBtn.dataset.day;
      if (key === selected) return;
      selected = key;
      heroAnim = true;
      haptic('selection');
      render();
      return;
    }
    const swap = e.target.closest('[data-swap]');
    if (swap) {
      haptic('light');
      openSwapSheet(swap.dataset.swap);
      return;
    }
    const easy = e.target.closest('[data-train-anyway]');
    if (easy) {
      haptic('light');
      openTrainAnyway(easy.dataset.trainAnyway);
      return;
    }
    if (e.target.closest('[data-dismiss-install]')) {
      dismissInstall();
      haptic('light');
      render();
    }
  };
  root.addEventListener('click', onClick);

  // Si la app sigue abierta al cambiar de día (o vuelve de segundo plano), se actualiza sola.
  const checkDay = () => {
    const k = todayKey();
    if (k === today) return;
    if (selected === today) selected = k;
    today = k;
    render();
  };
  const onVis = () => document.visibilityState === 'visible' && checkDay();
  const timer = setInterval(checkDay, 60000);
  document.addEventListener('visibilitychange', onVis);

  render();
  const unsub = subscribe(() => render());

  return () => {
    unsub?.();
    cleanupHeader?.();
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVis);
    root.removeEventListener('click', onClick);
  };
}
