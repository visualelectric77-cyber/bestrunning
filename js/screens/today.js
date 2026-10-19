// BestRunning · «Hoy»: saludo, tira semanal, clase del día, velocidades, semana, ciclo y consejo del coach.
import { getState, subscribe } from '../core/store.js';
import { navigate } from '../core/router.js';
import { haptic } from '../core/haptics.js';
import {
  icon, navBar, enableCollapsingHeader, intensityDots, profileChart, ring, openSheet, sectionHeader, emptyState, stat,
  photo, categoryPhotoName,
} from '../ui/components.js';
import { planWeek, planDay, cycleInfo, nextTestDate, CYCLE_WEEKS } from '../training/planner.js';
import { CATEGORIES, templatesFor, getTemplate } from '../training/templates.js';
import { buildWorkout } from '../training/generator.js';
import * as progression from '../training/progression.js';
import * as stats from '../training/stats.js';
import { ZONES, LEVEL_KEYS } from '../training/levels.js';
import {
  todayKey, addDays, mondayOf, parseKey, daysBetween, weekdayOf, fmt, esc, capitalize, hashStr, round1,
} from '../core/utils.js';
import {
  openSwapSheet, seasonOf, seasonLine, seasonChips, sessionsOn, sessionRow, ensureSeasonStyles, eventIntro, altItem,
} from './plan.js';
import { eventOn } from '../training/season.js';

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
    const train = !!(d.workout && d.kind !== 'rest');
    const num = parseKey(d.date).getDate();
    const wd = d.weekday || weekdayOf(d.date);
    const what = train ? d.workout.title : 'descanso';
    const stLabel = { done: 'hecho', missed: 'no realizado', today: 'hoy', upcoming: 'pendiente', rest: '', before: '' }[st] || '';
    const label = `${capitalize(fmt.weekdayName(wd))} ${num}: ${what}${stLabel ? ', ' + stLabel : ''}`;
    return `<button type="button" class="td-day st-${st}${train ? ' has-train' : ''}${isToday ? ' is-today' : ''}${d.date === selected ? ' is-selected' : ''}"
        data-day="${d.date}" aria-pressed="${d.date === selected}" aria-label="${esc(label)}">
      <span class="td-day__wd">${fmt.weekdayShort(wd)}</span>
      <span class="td-day__mark num">${num}</span>
      <span class="td-day__dot" aria-hidden="true"></span>
    </button>`;
  });
  return `<div class="td-strip" role="group" aria-label="Tu semana">${cells.join('')}</div>`;
}

/** Cifra blanca + unidad gris (fila meta de la tarjeta de hoy). */
const metaNum = (v, u) => `<span class="td-meta__item"><b class="num">${v}</b> ${u}</span>`;

function trainHero(day, state, today, animate) {
  const w = day.workout;
  const rel = fmt.relativeDay(day.date, today);
  const missed = viewStatus(day, state) === 'missed';
  const isTest = day.kind === 'test' || w.isTest;
  const status = missed
    ? '<span class="td-hero__status is-missed">No realizada</span>'
    : isTest
      ? '<span class="td-hero__status">Test VAM</span>'
      : day.isOverride
        ? '<span class="td-hero__status">Editada</span>'
        : day.event
          ? `<span class="td-hero__status is-event">${icon('star', 12)} ${esc(day.event.name || 'Especial')}</span>`
          : day.surprise
            ? '<span class="td-hero__status">Sorpresa</span>'
            : '';
  const intro = day.intro || w.intro || '';
  const play = `#/play/${enc(w.id)}?date=${day.date}`;
  const detail = `#/workout/${enc(w.id)}?date=${day.date}&from=today`;
  const meta = [
    metaNum(mins(w), 'min'),
    w.estDistanceKm ? metaNum(`~${fmt.dec1(w.estDistanceKm)}`, 'km') : '',
    w.estKcal ? metaNum(fmt.int(w.estKcal), 'kcal') : '',
  ].filter(Boolean).join('<span class="td-meta__sep" aria-hidden="true">·</span>');
  const goLabel = missed ? 'Hacerla ahora' : 'Empezar';
  // Cabecera fotográfica de su categoría (velo inferior: el título blanco siempre legible); el perfil, debajo
  return `<article class="card td-hero td-hero--photo${animate ? ' td-hero--in' : ''}">
    <div class="td-hero__media">
      ${photo(categoryPhotoName(w.category), { cls: 'td-hero__img', eager: true })}
      <div class="td-hero__top">
        <span class="eyebrow">${esc(rel)} · ${esc(catName(w.category))}</span>
        ${status}
      </div>
      <h2 class="td-hero__title">${esc(w.title)}</h2>
      ${w.subtitle || w.focus ? `<p class="td-hero__sub">${esc(w.subtitle || w.focus)}</p>` : ''}
    </div>
    ${intro ? `<p class="td-hero__intro">${esc(intro)}</p>` : ''}
    <div class="td-meta">${meta}<span class="spacer"></span><span class="td-meta__dots">${intensityDots(w.intensity || 1)}</span></div>
    <button type="button" class="td-hero__chart" data-href="${detail}" aria-label="Ver la estructura de la clase">${profileChart(w.segments || [], { height: 64, levels: state.levels })}</button>
    <div class="td-hero__actions">
      <button type="button" class="btn btn--primary btn--lg td-go" data-href="${play}" aria-label="${esc(`${goLabel}: ${w.title}`)}">${icon('play', 18)}<span>${goLabel}</span></button>
      <button type="button" class="btn btn--secondary btn--lg td-view" data-href="${detail}">Ver clase</button>
      <button type="button" class="btn-icon td-swap" data-swap="${day.date}" aria-label="Cambiar clase">${icon('shuffle', 20)}</button>
    </div>
  </article>`;
}

function doneHero(day, today, animate) {
  const s = day.session;
  const rel = fmt.relativeDay(day.date, today);
  const line = DONE_LINES[hashStr(s.id || day.date) % DONE_LINES.length];
  return `<article class="card td-hero td-hero--done${animate ? ' td-hero--in' : ''}">
    <div class="td-hero__top">
      <span class="eyebrow td-done__eyebrow">${icon('check', 13)} ${esc(rel)} · Completado</span>
    </div>
    <h2 class="td-hero__title">${esc(s.title || 'Entrenamiento')}</h2>
    <p class="td-hero__sub">${esc(line)}</p>
    <div class="stat-grid stat-grid--2 td-done__grid">
      ${stat({ label: 'Distancia', value: fmt.dec1(s.distanceKm || 0), unit: 'km' })}
      ${stat({ label: 'Tiempo', value: fmt.clock(s.elapsedSec || 0) })}
      ${stat({ label: 'Velocidad media', value: fmt.speed(s.avgSpeed || 0), unit: 'km/h' })}
      ${stat({ label: 'Energía', value: fmt.int(s.kcal || 0), unit: 'kcal' })}
    </div>
    <div class="td-hero__actions">
      ${s.id ? `<button type="button" class="btn btn--primary btn--lg" data-href="#/summary/${enc(s.id)}">Ver resumen</button>` : ''}
      <button type="button" class="btn btn--secondary btn--lg td-more" data-href="#/library">${icon('plus', 18)}<span>Otra sesión</span></button>
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
    ? `<button type="button" class="td-rest__next" data-href="#/workout/${enc(next.workout.id)}?date=${next.date}&from=today">
        <span class="td-rest__nextbody">
          <span class="eyebrow">${esc(fmt.relativeDay(next.date, today))} · ${esc(catName(next.workout.category))}</span>
          <b>${esc(next.workout.title)}</b>
          <span class="td-rest__nextmeta">${mins(next.workout)} min${next.workout.estDistanceKm ? ` · ~${fmt.dec1(next.workout.estDistanceKm)} km` : ''}</span>
        </span>
        <span class="td-rest__chart" aria-hidden="true">${profileChart(next.workout.segments || [], { height: 84, compact: true, tone: 'soft' })}</span>
        <span class="list__chev" aria-hidden="true">${icon('chevron-right', 14)}</span>
      </button>`
    : '';
  return `<article class="card td-hero td-hero--rest${animate ? ' td-hero--in' : ''}">
    <div class="td-hero__top">
      <span class="eyebrow">${esc(rel)} · Descanso</span>
    </div>
    <h2 class="td-hero__title">Toca recargar</h2>
    <p class="td-hero__sub">${esc(line)}</p>
    ${nextHtml}
    <div class="td-hero__actions">
      <button type="button" class="btn btn--secondary btn--lg btn--block" data-train-anyway="${day.date}">Entrenar igualmente</button>
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
  let moved = false;
  const rows = LEVEL_KEYS.map((k) => {
    const v = lv[k] ?? 0;
    let trend = '';
    let trendLabel = '';
    if (ref && typeof ref[k] === 'number') {
      const d = round1(v - ref[k]);
      if (d) moved = true;
      if (d > 0) {
        trend = `<span class="td-trend is-up">+${fmt.speed(d)}</span>`;
        trendLabel = `, sube ${fmt.speed(d)}`;
      } else if (d < 0) {
        trend = `<span class="td-trend is-down">−${fmt.speed(-d)}</span>`;
        trendLabel = `, baja ${fmt.speed(-d)}`;
      }
    }
    return `<button type="button" class="list__row td-speed" data-href="#/settings/speeds" aria-label="${esc(ZONES[k].name)}: ${fmt.speed(v)} km/h, ${fmt.pace(v)} por kilómetro${trendLabel}">
      <span class="zdot" style="--zc:var(--z-${k})" aria-hidden="true"></span>
      <span class="td-speed__name"><span class="td-speed__title">${esc(ZONES[k].name)}</span><span class="td-speed__pace">${fmt.pace(v)} /km</span></span>
      ${trend}
      <span class="td-speed__val"><b class="num">${fmt.speed(v)}</b><span class="unit">km/h</span></span>
      <span class="list__chev" aria-hidden="true">${icon('chevron-right', 14)}</span>
    </button>`;
  });
  return `<section class="td-section td-speedsec">
    ${sectionHeader('Tus velocidades', moved ? '<span class="td-aside">vs. hace 4 semanas</span>' : '')}
    <div class="list td-speeds">${rows.join('')}</div>
  </section>`;
}

function weekCard(state, days, today) {
  const monday = mondayOf(today);
  let wp = typeof stats.weekProgress === 'function' ? safe(() => stats.weekProgress(state, monday), null) : null;
  if (!wp) wp = fallbackWeek(days);
  const planned = wp.plannedMinutes || 0;
  const value = planned ? Math.min(1, (wp.minutes || 0) / planned) : 0;
  const inner = `<span class="td-ring"><span class="td-ring__val num">${fmt.int(wp.minutes || 0)}</span><span class="td-ring__of">de ${fmt.int(planned)} min</span></span>`;
  return `<button type="button" class="card card--pressable td-mini td-weekcard" data-href="#/progress" aria-label="Esta semana: ${fmt.int(wp.minutes || 0)} de ${fmt.int(planned)} minutos">
    <span class="eyebrow">Esta semana</span>
    <div class="td-weekcard__ring">${ring({ value, size: 96, stroke: 8, color: 'var(--accent)', track: 'var(--surface-3)', inner })}</div>
    <div class="td-weekcard__stats">
      <span><b class="num">${wp.doneSessions || 0}<span class="td-of">/${wp.plannedSessions || 0}</span></b><small>sesiones</small></span>
      <span><b class="num">${fmt.dec1(wp.km || 0)}</b><small>km</small></span>
    </div>
  </button>`;
}

function cycleCard(state, today) {
  const ci = safe(() => cycleInfo(state, today), null);
  if (!ci) return '';
  const w = ci.weekInCycle || 1;
  const segs = [1, 2, 3, 4]
    .map((n) => `<span class="td-cycle__seg${n < w ? ' is-past' : ''}${n === w ? ' is-current' : ''}"></span>`)
    .join('');
  const nt = safe(() => nextTestDate(state, today), null);
  let testLine = '';
  if (nt) {
    const dd = daysBetween(today, nt);
    testLine = dd <= 0
      ? 'Test VAM hoy'
      : dd < 7
        ? `Test el ${esc(fmt.weekdayName(weekdayOf(nt)))}`
        : `Test: ${esc(fmt.dateShort(nt))}`;
  }
  const blk = ci.mesoNumber ? `Bloque ${ci.mesoNumber}/13` : `Ciclo ${ci.cycleIndex + 1}`;
  return `<button type="button" class="card card--pressable td-mini td-cycle${ci.isDeload ? ' is-deload' : ''}" data-href="#/plan" aria-label="${blk}, semana ${w} de 4: ${esc(ci.weekName || '')}">
    <span class="eyebrow">${blk}</span>
    <div class="td-cycle__week"><span class="num">${w}</span><span class="td-cycle__of">/4</span></div>
    <div class="td-cycle__name">${esc(ci.weekName || CYCLE_WEEKS[w - 1] || '')}</div>
    <div class="td-cycle__bar" aria-hidden="true">${segs}</div>
    ${testLine ? `<div class="td-cycle__test">${testLine}</div>` : ''}
  </button>`;
}

function coachCard(state) {
  let text = typeof progression.coachInsight === 'function' ? safe(() => progression.coachInsight(state), '') : '';
  if (!text) text = 'La constancia gana a la intensidad. Cumple tus sesiones cortas y el jueves dale un poco más de cuerda.';
  return `<section class="td-section td-coachsec">
    ${sectionHeader('Consejo del coach')}
    <div class="card td-coach"><p class="td-coach__text">${esc(text)}</p></div>
  </section>`;
}

function installBanner() {
  if (isStandalone() || installDismissed()) return '';
  return `<div class="card td-install" role="note">
    <span class="td-install__logo" aria-hidden="true"></span>
    <div class="td-install__body">
      <b>Instala BestRunning</b>
      <p>Toca <span class="td-install__share">${icon('share', 15)}</span> <b>Compartir</b> y luego <b>«Añadir a pantalla de inicio»</b>. Se abrirá a pantalla completa y funciona sin conexión.</p>
    </div>
    <button type="button" class="btn-icon td-install__close" data-dismiss-install aria-label="Ocultar">${icon('close', 16)}</button>
  </div>`;
}

/** Cabecera de la tira semanal: «Semana 6 de 52 · Construcción» + chips; abre Mi plan. */
function seasonBar(si) {
  if (!si) return '';
  return `<button type="button" class="td-season" data-href="#/plan" aria-label="${esc(`${seasonLine(si)}. Ver mi plan`)}">
    <span class="td-season__line">Semana ${si.seasonWeek} de 52 · ${esc(si.phase.name)}</span>
    ${seasonChips(si)}
    <span class="td-season__go">Mi plan${icon('chevron-right', 13)}</span>
  </button>`;
}

/** Banner del evento de temporada (Navidad, Verano, Aniversario) de esta semana. */
function eventBanner(si, today) {
  const ev = si?.event;
  if (!ev) return '';
  const wd = fmt.weekdayName(weekdayOf(ev.date));
  let text = eventIntro(ev.key);
  if (ev.date === today) text = 'Hoy toca tu clase especial. ¡A disfrutarla!';
  else if (ev.date > today) text += ` Tu clase especial: el ${wd}.`;
  else if (ev.date < today) {
    if (eventOn(today)?.key !== ev.key) return '';
    text = `Seguimos de celebración. Tu clase especial de esta semana fue el ${wd}.`;
  }
  return `<div class="card br-event" role="note"><span class="eyebrow br-event__eyebrow">${icon('star', 12)} Especial ${esc(ev.name)}</span><p>${esc(text)}</p></div>`;
}

/** Todas las sesiones hechas el día elegido (planificada y extra), cada una con su resumen. */
function sessionsBlock(state, day, dateKey, today) {
  const list = sessionsOn(state, dateKey);
  if (!list.length) return '';
  const heroId = day?.status === 'done' ? day.session?.id : null;
  if (list.length === 1 && list[0].id === heroId) return '';
  const min = Math.round(list.reduce((a, s) => a + (Number(s.elapsedSec) || 0), 0) / 60);
  const km = list.reduce((a, s) => a + (Number(s.distanceKm) || 0), 0);
  const title = dateKey === today ? 'Hoy has hecho' : `Hecho el ${fmt.weekdayName(weekdayOf(dateKey))}`;
  return `<section class="td-section br-sessions" aria-label="${esc(title)}">
    ${sectionHeader(title, `<span class="td-aside">${list.length} ${list.length === 1 ? 'sesión' : 'sesiones'} · ${min} min · ${fmt.dec1(km)} km</span>`)}
    <div class="list br-seslist">${list.map((s) => sessionRow(s, { planned: !!s.planDate })).join('')}</div>
  </section>`;
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
  const rows = list.map((w, i) => altItem(w, `data-easy="${i}"`)).join('');
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
    right: `<button type="button" class="navbar__btn td-avatar" data-href="#/settings" aria-label="Perfil">${initial ? `<span>${esc(initial)}</span>` : icon('person', 18)}</button>`,
  })}<div class="container td"></div>`;
  const root = el.querySelector('.td');
  const cleanupHeader = enableCollapsingHeader(el);
  ensureSeasonStyles();

  function render() {
    const state = getState();
    const days = safe(() => planWeek(state, mondayOf(today)), null);
    const list = Array.isArray(days) && days.length === 7 ? days : null;
    let day = list?.find((d) => d.date === selected) || null;
    if (!day) day = safe(() => planDay(state, selected), null);
    const streak = typeof stats.streakWeeks === 'function' ? safe(() => stats.streakWeeks(state, new Date()), 0) : 0;
    const si = seasonOf(state, today);

    const blocks = [
      `<div class="td-head">
        <span class="td-date">${esc(capitalize(fmt.dateLong(today)))}</span>
        ${streak > 0 ? `<span class="td-streak">${icon('flame', 13)}<b class="num">${streak}</b> ${streak === 1 ? 'semana' : 'semanas'}</span>` : ''}
      </div>`,
      list ? `<section class="td-week">${seasonBar(si)}${weekStrip(list, today, selected, state)}</section>` : seasonBar(si),
      eventBanner(si, today),
      heroBlock(day, state, today, heroAnim),
      safe(() => sessionsBlock(state, day, selected, today), ''),
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
