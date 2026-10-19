// BestRunning · «Mi plan»: semana del ciclo, reordenar arrastrando (mantener pulsado) y acciones por día.
import { getState, setState, subscribe } from '../core/store.js';
import { navigate } from '../core/router.js';
import { haptic } from '../core/haptics.js';
import {
  icon, navBar, enableCollapsingHeader, intensityDots, profileChart, openSheet, toast, actionSheet, emptyState,
} from '../ui/components.js';
import {
  planWeek, planDay, cycleInfo, alternativesFor, swapDays, setDayOverride, clearDayOverride, nextTestDate, CYCLE_WEEKS,
  seasonInfo, seasonCalendar,
} from '../training/planner.js';
import { EVENTS } from '../training/season.js';
import { CATEGORIES, templatesFor, getTemplate } from '../training/templates.js';
import { buildWorkout } from '../training/generator.js';
import { exportPlanToCalendar } from '../integrations/ics.js';
import {
  todayKey, addDays, mondayOf, parseKey, daysBetween, weekdayOf, fmt, esc, capitalize, hashStr, makeRng,
} from '../core/utils.js';

const MORE_SVG =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>';
const MAX_WEEKS_AHEAD = 12;
const DURATIONS = [20, 30, 45, 60];

/* ───────────── Utilidades privadas ───────────── */

function safe(fn, fallback) {
  try {
    const v = fn();
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

const reducedMotion = () => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

const catName = (c) => CATEGORIES[c]?.name || 'Clase';
const dayName = (key) => fmt.weekdayName(weekdayOf(key));
const idHref = (id) => encodeURIComponent(id);
/** Minutos nominales (en el test VAM totalSec es el máximo teórico hasta la velocidad tope de la cinta). */
const mins = (w) => w?.minutes || Math.round((w?.totalSec || 0) / 60);

/* ───────────── Temporada (compartido con «Hoy») ───────────── */

const THEME_MONTH = {
  ritmo: 'Mes de ritmo constante', tecnica: 'Mes de técnica y cadencia', resistencia: 'Mes de resistencia larga',
  cuestas: 'Mes de cuestas', escaleras: 'Mes de escaleras y pirámides', fartlek: 'Mes de fartlek', velocidad: 'Mes de velocidad',
  musica: 'Mes de música y BPM', explosividad: 'Mes de explosividad', fantasma: 'Mes del desafío fantasma', records: 'Mes de récords',
  mixto: 'Mes mixto', juego: 'Mes de juego libre',
};
const ADAPT_LABEL = { return: 'Vuelta suave', tired: 'Semana más ligera', fresh: 'Vas sobrado' };

export const themeMonth = (t) => (t ? THEME_MONTH[t.key] || `Bloque «${t.name}»` : '');
export const eventIntro = (key) => EVENTS.find((e) => e.key === key)?.intro || '';

/** Info de temporada de la semana de `dateKey` (null antes de empezar o si falla). */
export function seasonOf(state, dateKey) {
  const si = safe(() => seasonInfo(state, dateKey), null);
  return si && si.weeksSinceStart >= 0 && si.phase && si.theme ? si : null;
}

/** «Semana 6 de 52 · Construcción · Mes de cuestas» */
export function seasonLine(si) {
  if (!si) return '';
  const season = si.seasonIndex > 0 ? ` (temporada ${si.seasonIndex + 1})` : '';
  return `Semana ${si.seasonWeek} de 52${season} · ${si.phase.name} · ${themeMonth(si.theme)}`;
}

/** Chips de la semana: descarga, test, evento y adaptación. */
export function seasonChips(si) {
  if (!si) return '';
  const out = [];
  if (si.isDeload) out.push('<span class="br-chip br-chip--deload">Descarga</span>');
  if (si.isTestWeek) out.push('<span class="br-chip br-chip--test">Test VAM</span>');
  if (si.event) out.push(`<span class="br-chip br-chip--event">${esc(si.event.name)}</span>`);
  const ad = ADAPT_LABEL[si.adapt?.mode];
  if (ad) out.push(`<span class="br-chip br-chip--adapt">${ad}</span>`);
  return out.join('');
}

/** Sesiones del historial hechas ese día (planificadas y extra), en orden. */
export function sessionsOn(state, dateKey) {
  const list = Array.isArray(state?.history) ? state.history : [];
  return list
    .filter((s) => s && s.id && (s.dayKey === dateKey || (!s.dayKey && String(s.startedAt || '').slice(0, 10) === dateKey)))
    .sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
}

/**
 * Heredado: los estilos de temporada, sesiones del día y calendario viven ahora en css/screens-main.css (v2).
 * Se mantiene la función para no romper a quien la llame.
 */
export function ensureSeasonStyles() {}

/** Tarjeta de sesión hecha (planificada o extra) que abre su resumen. */
export function sessionRow(s, { planned = false } = {}) {
  const t = s.startedAt ? new Date(s.startedAt) : null;
  const at = t && !Number.isNaN(t.getTime()) ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '';
  const pct = Math.round((Number(s.completionPct) || 0) * 100);
  const meta = [at, fmt.clock(s.elapsedSec || 0), `${fmt.dec1(s.distanceKm || 0)} km`, s.kcal ? `${fmt.int(s.kcal)} kcal` : '', pct && pct < 90 ? `${pct} %` : '']
    .filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('');
  return `<button type="button" class="list__row br-ses" data-href="#/summary/${idHref(s.id)}" aria-label="${esc(`Ver resumen: ${s.title || 'Entrenamiento'}${planned ? '' : ' (extra)'}`)}">
    <span class="br-ses__check" aria-hidden="true">${icon('check', 16)}</span>
    <span class="br-ses__body"><span class="br-ses__title">${esc(s.title || 'Entrenamiento')}</span><span class="br-ses__meta">${meta}</span></span>
    <span class="br-ses__tag">${planned ? 'Plan' : 'Extra'}</span>
    <span class="list__chev" aria-hidden="true">${icon('chevron-right', 14)}</span>
  </button>`;
}

/** 9300 → '2 h 35′' · 2700 → '45 min' */
function hm(sec) {
  const min = Math.round(sec / 60);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}′` : `${h} h`;
}

function rangeLabel(monday) {
  const a = parseKey(monday);
  const b = parseKey(addDays(monday, 6));
  if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${b.getDate()} ${fmt.monthAbbr(b.getMonth())}`;
  return `${a.getDate()} ${fmt.monthAbbr(a.getMonth())} – ${b.getDate()} ${fmt.monthAbbr(b.getMonth())}`;
}

function safePlanDay(state, key) {
  return safe(() => planDay(state, key), null) || {
    date: key, weekday: weekdayOf(key), kind: 'rest', slot: null, templateId: null, minutes: 0,
    workout: null, status: 'rest', session: null, isOverride: false,
  };
}

/** Alternativas de reserva si el planificador no devuelve ninguna (p. ej. en un día de descanso). */
function fallbackAlternatives(state, dateKey, day, n = 6) {
  const minutes = day?.minutes || state.schedule?.weekdayMinutes || 20;
  const hasIncline = !!state.treadmill?.hasIncline;
  const list = safe(() => templatesFor({ category: 'all', minutes, hasIncline }), []).filter(
    (t) => t.category !== 'test' && t.id !== day?.templateId
  );
  const rng = makeRng(hashStr(`alt-${dateKey}`));
  const loadFactor = safe(() => cycleInfo(state, dateKey).loadFactor, 1) || 1;
  const out = [];
  for (const t of rng.shuffle(list)) {
    if (out.length >= n) break;
    const w = safe(
      () => buildWorkout(t.id, {
        minutes, levels: state.levels, seed: hashStr(dateKey), loadFactor, hasIncline,
        treadmill: state.treadmill, weightKg: state.profile?.weightKg,
      }),
      null
    );
    if (w) out.push(w);
  }
  return out;
}

/** Fila de clase alternativa (hojas «Cambiar clase» y «Entrenar igualmente»). Compartida con Hoy. */
export function altItem(w, attrs) {
  const km = w.estDistanceKm ? ` · ~${fmt.dec1(w.estDistanceKm)} km` : '';
  return `<button type="button" class="pn-alt" ${attrs}>
    <span class="pn-alt__body">
      <span class="pn-alt__eyebrow">${esc(catName(w.category))}</span>
      <span class="pn-alt__title">${esc(w.title)}</span>
      <span class="pn-alt__meta">${Math.round(w.totalSec / 60)} min${km} ${intensityDots(w.intensity || 1)}</span>
    </span>
    <span class="pn-alt__chart" aria-hidden="true">${profileChart(w.segments || [], { height: 84, compact: true, tone: 'soft' })}</span>
    <span class="list__chev" aria-hidden="true">${icon('chevron-right', 14)}</span>
  </button>`;
}

const altRow = (w, i) => altItem(w, `data-alt="${i}"`);

/**
 * Hoja «Cambiar clase» con alternativas para un día del plan. Compartida con la pantalla Hoy.
 * Al elegir guarda un override del día (plantilla + minutos).
 */
export function openSwapSheet(dateKey, { onDone = null } = {}) {
  const state = getState();
  const day = safePlanDay(state, dateKey);
  let alts = safe(() => alternativesFor(state, dateKey, 6), []);
  if (!Array.isArray(alts) || !alts.length) alts = fallbackAlternatives(state, dateKey, day);
  const isRest = day.kind === 'rest';
  const when = fmt.relativeDay(dateKey);
  const lead = isRest
    ? `Elige qué te apetece entrenar ${when === 'Hoy' || when === 'Mañana' ? when.toLowerCase() : 'el ' + fmt.dateShort(dateKey)}.`
    : `Misma duración, otro estímulo. Cambia la clase del ${esc(dayName(dateKey))} sin romper tu semana.`;
  const html = alts.length
    ? `<p class="pn-sheet__lead">${lead}</p><div class="pn-alts stagger">${alts.map(altRow).join('')}</div>`
    : emptyState({ icon: 'grid', title: 'Sin alternativas', text: 'No hemos encontrado otras clases para este día.' });

  openSheet({
    title: isRest ? 'Entrenar este día' : 'Cambiar clase',
    html,
    large: alts.length > 3,
    onMount(sheetEl, close) {
      sheetEl.querySelectorAll('.pn-alts > *').forEach((n, i) => n.style.setProperty('--i', i));
      sheetEl.addEventListener('click', (e) => {
        const b = e.target.closest('[data-alt]');
        if (!b) return;
        const w = alts[Number(b.dataset.alt)];
        if (!w) return;
        setState((d) => {
          setDayOverride(d, dateKey, { templateId: w.templateId, minutes: w.minutes || Math.round(w.totalSec / 60) });
        });
        haptic('success');
        close();
        toast(`${capitalize(dayName(dateKey))}: ${w.title}`, { icon: 'shuffle', kind: 'success' });
        onDone?.(w);
      });
    },
    actions: [
      {
        label: 'Ver todas las clases',
        kind: 'secondary',
        onClick: (close) => {
          close();
          navigate('#/library');
        },
      },
    ],
  });
}

/* ───────────── Pintado ───────────── */

function weekHeader(monday, ci, canPrev, canNext, isCurrent) {
  const wk = ci ? `Semana ${ci.weekInCycle} de 4 · ${esc(ci.weekName || CYCLE_WEEKS[ci.weekInCycle - 1] || '')}` : '';
  return `<div class="pn-week">
    <button type="button" class="btn-icon pn-week__nav" data-week="-1" aria-label="Semana anterior" ${canPrev ? '' : 'disabled'}>${icon('chevron-left', 20)}</button>
    <div class="pn-week__label" aria-live="polite">
      <div class="pn-week__range num">${rangeLabel(monday)}</div>
      <div class="pn-week__name">${wk}</div>
    </div>
    <button type="button" class="btn-icon pn-week__nav" data-week="1" aria-label="Semana siguiente" ${canNext ? '' : 'disabled'}>${icon('chevron-right', 20)}</button>
  </div>
  ${isCurrent ? '' : `<div class="pn-week__back"><button type="button" class="pn-link" data-week="0">Volver a esta semana</button></div>`}`;
}

function cycleBar(ci) {
  if (!ci) return '';
  const w = ci.weekInCycle || 1;
  const segs = CYCLE_WEEKS.map((name, i) => {
    const n = i + 1;
    const cls = [n < w ? 'is-past' : '', n === w ? 'is-current' : '', n === 4 ? 'is-test' : ''].join(' ');
    return `<div class="pn-cycle__seg ${cls}"><span class="pn-cycle__track"><span class="pn-cycle__fill"></span></span><span class="pn-cycle__name">${esc(name)}</span></div>`;
  }).join('');
  const blk = ci.mesoNumber ? `Bloque ${ci.mesoNumber} de 13` : `Ciclo ${ci.cycleIndex + 1}`;
  return `<div class="pn-cycle" role="img" aria-label="${blk}, semana ${w} de 4: ${esc(ci.weekName || '')}">
    <div class="pn-cycle__head"><span class="eyebrow">${blk}</span><span class="pn-cycle__load">Carga <b class="num">${Math.round((ci.loadFactor || 1) * 100)}</b> %</span></div>
    <div class="pn-cycle__bar">${segs}</div>
  </div>`;
}

function seasonBlock(si) {
  if (!si) return '';
  const intro = si.event ? eventIntro(si.event.key) : `${si.themeIntro} ${si.weekLine || ''}`;
  const season = si.seasonIndex > 0 ? ` (temporada ${si.seasonIndex + 1})` : '';
  return `<div class="br-season" role="group" aria-label="${esc(seasonLine(si))}">
    <div class="br-season__top"><span class="eyebrow">Semana ${si.seasonWeek} de 52${season} · ${esc(si.phase.name)}</span>${seasonChips(si)}</div>
    <h2 class="br-season__title">${esc(themeMonth(si.theme))}</h2>
    <p class="br-season__intro">${esc(intro.trim())}</p>
  </div>`;
}

function seasonCal(state, monday) {
  const cal = safe(() => seasonCalendar(state, monday), null);
  if (!Array.isArray(cal) || cal.length !== 13) return '';
  const cur = cal.find((m) => m.current);
  const strip = cal.map((m, i) => {
    const cls = m.current ? ' is-current' : cur && m.cycleIndex < cur.cycleIndex ? ' is-past' : '';
    const start = i > 0 && cal[i - 1].phase.key !== m.phase.key ? ' is-phase-start' : '';
    return `<span class="br-cal__seg${cls}${start}" title="${esc(`${m.mesoNumber}. ${m.theme.name}`)}"></span>`;
  }).join('');
  const seen = new Set();
  const legend = cal.filter((m) => !seen.has(m.phase.key) && seen.add(m.phase.key))
    .map((m) => `<span class="${cur && cur.phase.key === m.phase.key ? 'is-current' : ''}">${esc(m.phase.name)}</span>`)
    .join('<i aria-hidden="true">›</i>');
  const rows = cal.map((m) => `<li class="${m.current ? 'is-current' : ''}"><span class="br-cal__n num">${m.mesoNumber}</span>
      <span class="br-cal__name"><b>${esc(m.theme.name)}</b><span>${esc(m.phase.name)}</span></span><small>${esc(fmt.dateShort(m.start))}</small></li>`).join('');
  return `<section class="pn-sec" aria-label="Tu temporada de 52 semanas">
    <h2 class="list-header">Tu temporada</h2>
    <div class="card br-cal">
      <div class="br-cal__head"><b>13 bloques de 4 semanas</b>${cur ? `<span>Bloque <b class="num">${cur.mesoNumber}</b> de 13</span>` : ''}</div>
      <div class="br-cal__strip" aria-hidden="true">${strip}</div>
      <div class="br-cal__legend">${legend}</div>
      <details><summary><span>Ver los 13 bloques</span>${icon('chevron-down', 14)}</summary><ol>${rows}</ol></details>
    </div>
  </section>`;
}

function weekSummary(days) {
  const train = days.filter((d) => d.workout && d.kind !== 'rest');
  const done = days.filter((d) => d.status === 'done').length;
  const sec = train.reduce((a, d) => a + mins(d.workout) * 60, 0);
  const km = train.reduce((a, d) => a + (d.workout.estDistanceKm || 0), 0);
  const min = Math.round(sec / 60);
  const h = Math.floor(min / 60);
  const m = min % 60;
  const time = h ? (m ? `${h}:${String(m).padStart(2, '0')}` : `${h}`) : `${m}`;
  const cell = (label, value, unit) => `<div class="stat"><div class="stat__label"><span>${label}</span></div><div class="stat__value">${value}${unit ? `<span class="stat__unit">${unit}</span>` : ''}</div></div>`;
  return `<div class="card pn-summary" role="group" aria-label="Resumen de la semana: ${done} de ${train.length} sesiones, ${esc(hm(sec))}, unos ${fmt.dec1(km)} km">
    <div class="stat-grid">
      ${cell('Sesiones', `${done}<span class="pn-of">/${train.length}</span>`, '')}
      ${cell('Tiempo', time, h ? 'h' : 'min')}
      ${cell('Distancia est.', `${fmt.dec1(km)}`, 'km')}
    </div>
  </div>`;
}

/** Clave del día en que empezó a usar la app: lo anterior no cuenta como «no realizado». */
function createdKeyOf(state) {
  const d = state.createdAt ? new Date(state.createdAt) : null;
  return d && !Number.isNaN(d.getTime()) ? todayKey(d) : null;
}

function dayRow(day, today, i, createdKey, state) {
  const w = day.workout;
  const isToday = day.date === today;
  const wd = day.weekday || weekdayOf(day.date);
  const dnum = parseKey(day.date).getDate();
  const locked = day.status === 'done';
  const past = daysBetween(today, day.date) < 0;
  const rail = `<div class="pn-day__rail" aria-hidden="true">
      <span class="pn-day__wd">${isToday ? 'Hoy' : fmt.weekdayAbbr(wd)}</span>
      <span class="pn-day__num num">${dnum}</span>
    </div>`;
  const more = `<button type="button" class="pn-card__more" data-more="${day.date}" aria-label="Opciones del ${fmt.weekdayName(wd)}">${MORE_SVG}</button>`;
  const liCls = `pn-day${isToday ? ' is-today' : ''}${past ? ' is-past' : ''}`;
  // Sesiones de ese día que no son la del plan (extra): cada una abre su resumen
  const mainId = w && day.kind !== 'rest' && day.status === 'done' ? day.session?.id : null;
  const others = sessionsOn(state, day.date).filter((s) => s.id !== mainId);
  const extras = others.length
    ? `<div class="br-extras">${others.map((s) => `<button type="button" class="br-extra" data-href="#/summary/${idHref(s.id)}" aria-label="${esc(`Ver resumen de ${s.title || 'entrenamiento'} (extra)`)}">
        ${icon('plus', 14)}<span>Extra</span><b>${esc(s.title || 'Entrenamiento')}</b><span class="num">${fmt.dec1(s.distanceKm || 0)} km</span><span class="br-extra__go">${icon('chevron-right', 13)}</span></button>`).join('')}</div>`
    : '';

  if (!w || day.kind === 'rest') {
    const extra = day.status === 'done' && day.session;
    const sub = extra
      ? `Extra: ${esc(day.session.title || 'entrenamiento')} · ${fmt.dec1(day.session.distanceKm || 0)} km`
      : day.isOverride ? 'Descanso elegido por ti' : 'Recupera y vuelve más fuerte';
    const label = `${capitalize(fmt.weekdayName(wd))} ${dnum}: descanso.${locked ? '' : ' Mantén pulsado para moverlo.'}`;
    return `<li class="${liCls}" style="--i:${i}">${rail}
      <div class="pn-card pn-card--rest${locked ? ' is-locked' : ''}" data-date="${day.date}" data-kind="rest" role="button" tabindex="0" aria-label="${esc(label)}">
        <span class="pn-card__icon" aria-hidden="true">${icon('moon', 18)}</span>
        <div class="pn-card__body">
          <div class="pn-card__title">Descanso</div>
          <div class="pn-card__meta"><span>${sub}</span></div>
        </div>
        ${day.isOverride ? '<span class="pn-badge">Editado</span>' : ''}
        ${more}
      </div>${extras}</li>`;
  }

  let status = day.status || 'upcoming';
  if (status === 'missed' && createdKey && day.date < createdKey) status = 'before';
  const ses = day.session;
  let meta = `<span>${mins(w) || day.minutes} min</span>`;
  if (status === 'done' && ses) {
    meta = `<span class="pn-ok">${icon('check', 13)} Hecho</span><span>${fmt.dec1(ses.distanceKm || 0)} km</span><span>${fmt.clock(ses.elapsedSec || 0)}</span>`;
  } else {
    if (w.estDistanceKm) meta += `<span>~${fmt.dec1(w.estDistanceKm)} km</span>`;
    if (status === 'missed') meta += '<span class="pn-missed">No realizada</span>';
    else meta += intensityDots(w.intensity || 1);
  }
  const badges = `${day.kind === 'test' || w.isTest ? '<span class="pn-badge">Test</span>' : ''}${
    day.event && !day.isOverride ? `<span class="br-chip br-chip--event">${esc(day.event.name || 'Especial')}</span>` : ''}${
    day.surprise && !day.event && !day.isOverride ? '<span class="br-chip br-chip--surprise">Sorpresa</span>' : ''}${
    day.isOverride ? '<span class="pn-badge">Editado</span>' : ''}`;
  const label = `${capitalize(fmt.weekdayName(wd))} ${dnum}: ${w.title}, ${catName(w.category)}, ${mins(w)} minutos.${
    status === 'done' ? ' Hecho.' : status === 'missed' ? ' No realizada.' : ''
  }${locked ? '' : ' Mantén pulsado para moverlo.'}`;

  return `<li class="${liCls}" style="--i:${i}">${rail}
    <div class="pn-card st-${status}${locked ? ' is-locked' : ''}" data-date="${day.date}" data-id="${esc(w.id)}" role="button" tabindex="0" aria-label="${esc(label)}">
      <div class="pn-card__body">
        <div class="pn-card__eyebrow"><span>${esc(catName(w.category))}</span>${badges}</div>
        <div class="pn-card__title">${esc(status === 'done' && ses?.title ? ses.title : w.title)}</div>
        <div class="pn-card__meta">${meta}</div>
      </div>
      <div class="pn-card__chart" aria-hidden="true">${profileChart(w.segments || [], { height: 84, compact: true, tone: isToday ? 'full' : 'soft' })}</div>
      ${more}
    </div>${extras}</li>`;
}

function view(state, monday, today, first) {
  const ci = safe(() => cycleInfo(state, monday), null);
  const days = safe(() => planWeek(state, monday), null);
  const startMonday = state.plan?.startDate ? mondayOf(state.plan.startDate) : mondayOf(today);
  const curMonday = mondayOf(today);
  const minMonday = daysBetween(startMonday, curMonday) >= 0 ? startMonday : curMonday;
  const canPrev = daysBetween(minMonday, monday) > 0;
  const canNext = daysBetween(curMonday, monday) < MAX_WEEKS_AHEAD * 7;

  if (!Array.isArray(days) || days.length !== 7) {
    return `${weekHeader(monday, ci, canPrev, canNext, monday === curMonday)}
      ${emptyState({ icon: 'calendar', title: 'No hemos podido preparar la semana', text: 'Revisa tus ajustes de semana en Perfil e inténtalo de nuevo.', action: '<button type="button" class="btn btn--secondary" data-href="#/settings/week">Ajustes de semana</button>' })}`;
  }

  const si = seasonOf(state, monday);
  let testNote = '';
  const testDay = days.find((d) => d.kind === 'test' || d.workout?.isTest);
  if (testDay) {
    testNote = `<div class="card pn-note">${icon('gauge', 20)}<p><b>Semana de test.</b> Test VAM el ${esc(dayName(testDay.date))} ${parseKey(testDay.date).getDate()}: recalcula tus cuatro velocidades. Los días de alrededor son suaves.</p></div>`;
  } else if (ci?.isDeload) {
    testNote = `<div class="card pn-note">${icon('leaf', 20)}<p><b>Semana de descarga.</b> Menos carga (sobre un 65 %) para asimilar el trabajo del bloque y llegar fresco al siguiente.</p></div>`;
  } else if (monday === curMonday) {
    const nt = safe(() => nextTestDate(state, today), null);
    if (nt) {
      const inDays = daysBetween(today, nt);
      if (inDays > 0) testNote = `<div class="list pn-next"><div class="list__row">${icon('target', 20)}<span class="list__title">Próximo test VAM</span><span class="list__value">${esc(fmt.dateShort(nt))} · <span class="num">${inDays}</span> ${inDays === 1 ? 'día' : 'días'}</span></div></div>`;
    }
  }

  const block = si || ci ? `<div class="card pn-block">${seasonBlock(si)}${cycleBar(ci)}</div>` : '';
  return `
    ${weekHeader(monday, ci, canPrev, canNext, monday === curMonday)}
    ${block}
    ${weekSummary(days)}
    ${testNote}
    <p class="pn-hint">${icon('drag', 15)}<span>Mantén pulsado un día y arrástralo sobre otro para intercambiarlos.</span></p>
    <ol class="pn-days${first ? ' stagger' : ''}" aria-label="Días de la semana">${days.map((d, i) => dayRow(d, today, i, createdKeyOf(state), state)).join('')}</ol>
    ${seasonCal(state, monday)}
    <div class="pn-actions">
      <button type="button" class="btn btn--secondary btn--block btn--lg" data-ics>${icon('calendar', 20)} Añadir al calendario</button>
      <p class="pn-foot">Exporta las próximas 4 semanas a las ${esc(state.schedule?.reminderTime || '07:00')}, con aviso 10 minutos antes.</p>
    </div>`;
}

/* ───────────── Arrastrar para intercambiar ───────────── */

function scrollerOf(el) {
  let n = el;
  while (n && n !== document.body) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
    n = n.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function createDrag(root, { onSwap }) {
  const LONG_MS = 380;
  const SLOP = 9;
  let pending = null;
  let drag = null;
  let raf = 0;
  let lastY = 0;
  let scroller = null;
  let suppress = false; // bloquea el click que sigue a un arrastre o pulsación larga

  const isDoc = () => scroller === document.scrollingElement || scroller === document.documentElement;
  const scrollTop = () => (isDoc() ? window.scrollY : scroller.scrollTop);
  const scrollBy = (v) => (isDoc() ? window.scrollBy(0, v) : (scroller.scrollTop += v));

  function cancelPending() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.card.classList.remove('is-pressing');
    pending = null;
  }

  function onDown(e) {
    if (drag || pending) return;
    suppress = false;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const card = e.target.closest('.pn-card[data-date]');
    if (!card || e.target.closest('.pn-card__more')) return;
    pending = { card, id: e.pointerId, x: e.clientX, y: e.clientY, timer: setTimeout(lift, LONG_MS) };
    card.classList.add('is-pressing');
  }

  function lift() {
    const p = pending;
    pending = null;
    if (!p || !p.card.isConnected) return;
    p.card.classList.remove('is-pressing');
    suppress = true;
    if (p.card.classList.contains('is-locked')) {
      haptic('warning');
      p.card.classList.add('is-shake');
      setTimeout(() => p.card.classList.remove('is-shake'), 420);
      return;
    }
    scroller = scrollerOf(root);
    const list = [...root.querySelectorAll('.pn-card[data-date]')].map((el) => ({
      el, date: el.dataset.date, locked: el.classList.contains('is-locked'), rect: el.getBoundingClientRect(),
    }));
    const self = list.find((c) => c.el === p.card);
    drag = { card: p.card, date: p.card.dataset.date, id: p.id, startY: p.y, startScroll: scrollTop(), list, self, target: null };
    try {
      p.card.setPointerCapture(p.id);
    } catch {
      /* el puntero ya no está activo */
    }
    p.card.classList.add('is-lifted');
    p.card.closest('.pn-day')?.classList.add('is-active');
    root.classList.add('is-dragging');
    haptic('medium');
    move(p.y);
    raf = requestAnimationFrame(tick);
  }

  function move(y) {
    lastY = y;
    const dy = y - drag.startY + (scrollTop() - drag.startScroll);
    drag.card.style.transform = `translate3d(0, ${dy}px, 0) scale(1.035)`;
    const center = drag.self.rect.top + drag.self.rect.height / 2 + dy;
    let target = null;
    for (const c of drag.list) {
      if (c === drag.self) continue;
      if (center >= c.rect.top - 6 && center <= c.rect.bottom + 6) {
        target = c;
        break;
      }
    }
    if (target !== drag.target) {
      drag.target?.el.classList.remove('is-drop-target', 'is-drop-blocked');
      if (target) {
        target.el.classList.add(target.locked ? 'is-drop-blocked' : 'is-drop-target');
        haptic('selection');
      }
      drag.target = target;
    }
  }

  // Desplazamiento automático cerca de los bordes (bajo la cabecera / sobre la tab bar).
  // Bordes medidos de la ventana real (navbar y tab bar), y solo tras mover el dedo: en horizontal
  // (440 px de alto) una tarjeta levantada cerca del borde ya no se desplaza sola.
  function edges() {
    const vh = window.innerHeight;
    const scr = root.closest('.screen');
    // La barra compacta es la parte fija (sticky) de la cabecera; .navbar puede medir 0
    const bars = [scr?.querySelector('.navbar__compact'), scr?.querySelector('.navbar')].filter(Boolean);
    const navB = Math.max(0, ...bars.map((b) => b.getBoundingClientRect().bottom));
    const tab = document.getElementById('tabbar');
    const tabR = tab && getComputedStyle(tab).display !== 'none' ? tab.getBoundingClientRect() : null;
    const tabT = tabR && tabR.height > 0 && tabR.top < vh ? tabR.top : vh;
    const zone = Math.min(56, Math.max(28, (tabT - navB) * 0.14));
    return { top: navB + zone, bottom: tabT - zone };
  }

  function tick() {
    if (!drag) return;
    if (!drag.moved && Math.abs(lastY - drag.startY) > SLOP) drag.moved = true;
    if (!drag.edges) drag.edges = edges();
    const { top: topEdge, bottom: bottomEdge } = drag.edges;
    let v = 0;
    if (drag.moved) {
      if (lastY < topEdge) v = -Math.min(18, (topEdge - lastY) / 5 + 2);
      else if (lastY > bottomEdge) v = Math.min(18, (lastY - bottomEdge) / 5 + 2);
    }
    if (v) {
      const before = scrollTop();
      scrollBy(v);
      if (scrollTop() !== before) move(lastY);
    }
    raf = requestAnimationFrame(tick);
  }

  function onMove(e) {
    if (pending && e.pointerId === pending.id) {
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > SLOP) cancelPending();
      return;
    }
    if (drag && e.pointerId === drag.id) {
      e.preventDefault();
      move(e.clientY);
    }
  }

  function onUp(e) {
    if (pending && e.pointerId === pending.id) {
      cancelPending();
      return;
    }
    if (drag && e.pointerId === drag.id) {
      suppress = true;
      drop(e.type === 'pointerup');
    }
  }

  function drop(ok) {
    cancelAnimationFrame(raf);
    const d = drag;
    drag = null;
    root.classList.remove('is-dragging');
    d.target?.el.classList.remove('is-drop-target', 'is-drop-blocked');
    try {
      d.card.releasePointerCapture(d.id);
    } catch {
      /* nada */
    }
    const t = d.target;
    if (ok && t && !t.locked) {
      haptic('success');
      const commit = () => onSwap(d.date, t.date);
      if (reducedMotion()) {
        commit();
        return;
      }
      const delta = t.rect.top - d.self.rect.top;
      d.card.classList.add('is-settling');
      t.el.classList.add('is-settling', 'is-swapping');
      d.card.style.transform = `translate3d(0, ${delta}px, 0) scale(1)`;
      t.el.style.transform = `translate3d(0, ${-delta}px, 0)`;
      setTimeout(commit, 330);
      return;
    }
    if (ok && t && t.locked) {
      haptic('warning');
      toast('Ese día ya está hecho: no se puede cambiar', { icon: 'lock' });
    }
    d.card.classList.add('is-settling');
    d.card.style.transform = '';
    setTimeout(() => {
      d.card.classList.remove('is-lifted', 'is-settling');
      d.card.closest('.pn-day')?.classList.remove('is-active');
    }, 340);
  }

  const onTouchMove = (e) => {
    if (drag) e.preventDefault();
  };
  const onContext = (e) => {
    if (e.target.closest('.pn-card')) e.preventDefault();
  };

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove, { passive: false });
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('touchmove', onTouchMove, { passive: false });
  root.addEventListener('contextmenu', onContext);

  return {
    get active() {
      return !!drag || !!pending;
    },
    shouldSuppressClick() {
      const s = suppress;
      suppress = false;
      return s;
    },
    destroy() {
      cancelPending();
      cancelAnimationFrame(raf);
      drag = null;
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onUp);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('contextmenu', onContext);
    },
  };
}

/* ───────────── Menú ⋯ ───────────── */

async function chooseDuration(day) {
  const tpl = safe(() => getTemplate(day.templateId), null);
  const cur = mins(day.workout) || day.minutes;
  let opts = Array.isArray(tpl?.durations) && tpl.durations.length ? tpl.durations.slice() : DURATIONS.slice();
  if (!opts.includes(cur)) opts.push(cur);
  opts = [...new Set(opts)].sort((a, b) => a - b);
  if (opts.length < 2) {
    toast('Esta clase tiene duración fija. Prueba «Cambiar clase».', { icon: 'info' });
    return;
  }
  const v = await actionSheet({
    title: 'Duración',
    options: opts.map((m) => ({ label: `${m} min${m === cur ? ' · actual' : ''}`, value: m, icon: m === cur ? 'check' : 'timer' })),
  });
  if (v == null || Number(v) === cur) return;
  setState((d) => {
    setDayOverride(d, day.date, { templateId: day.templateId, minutes: Number(v) });
  });
  haptic('success');
  toast(`${capitalize(dayName(day.date))}: ${v} min`, { icon: 'timer' });
}

async function chooseMoveTarget(day, onSwap) {
  const state = getState();
  const monday = mondayOf(day.date);
  const opts = [];
  for (let i = 0; i < 7; i++) {
    const key = addDays(monday, i);
    if (key === day.date) continue;
    const other = safePlanDay(state, key);
    if (other.status === 'done') continue;
    const what = other.workout && other.kind !== 'rest' ? other.workout.title : 'Descanso';
    opts.push({
      label: `${capitalize(fmt.weekdayName(weekdayOf(key)))} ${parseKey(key).getDate()} · ${what}`,
      value: key,
      icon: other.kind === 'rest' ? 'moon' : 'calendar',
    });
  }
  if (!opts.length) {
    toast('No quedan días libres esta semana', { icon: 'info' });
    return;
  }
  const v = await actionSheet({ title: `Intercambiar el ${dayName(day.date)} con…`, options: opts });
  if (v) onSwap(day.date, v);
}

async function openDayMenu(date, onSwap) {
  const state = getState();
  const day = safePlanDay(state, date);
  const w = day.workout;
  const opts = [];
  if (day.status === 'done') {
    if (day.session?.id) opts.push({ label: 'Ver resumen', value: 'summary', icon: 'chart' });
    if (w) opts.push({ label: 'Ver clase', value: 'view', icon: 'eye' });
  } else {
    if (w && day.kind !== 'rest') opts.push({ label: 'Ver clase', value: 'view', icon: 'eye' });
    opts.push({ label: day.kind === 'rest' ? 'Entrenar este día' : 'Cambiar clase', value: 'change', icon: 'shuffle' });
    if (w && day.kind !== 'rest' && !w.isTest) opts.push({ label: 'Duración…', value: 'duration', icon: 'timer' });
    opts.push({ label: 'Mover a…', value: 'move', icon: 'drag' });
    if (day.kind === 'rest') {
      if (day.isOverride) opts.push({ label: 'Quitar descanso', value: 'unrest', icon: 'bolt' });
    } else {
      opts.push({ label: 'Marcar descanso', value: 'rest', icon: 'moon' });
    }
    if (day.isOverride) opts.push({ label: 'Restablecer día', value: 'reset', icon: 'refresh', destructive: true });
  }
  if (!opts.length) return;
  const v = await actionSheet({ title: capitalize(fmt.dateLong(date)), options: opts });
  switch (v) {
    case 'summary':
      navigate(`#/summary/${encodeURIComponent(day.session.id)}`);
      break;
    case 'view':
      navigate(`#/workout/${idHref(w.id)}?date=${date}&from=plan`);
      break;
    case 'change':
      openSwapSheet(date);
      break;
    case 'duration':
      chooseDuration(day);
      break;
    case 'move':
      chooseMoveTarget(day, onSwap);
      break;
    case 'rest':
      setState((d) => {
        setDayOverride(d, date, { rest: true });
      });
      haptic('light');
      toast(`${capitalize(dayName(date))}: descanso`, { icon: 'moon' });
      break;
    case 'unrest':
    case 'reset':
      setState((d) => {
        clearDayOverride(d, date);
      });
      haptic('light');
      toast(v === 'reset' ? 'Día restablecido' : 'Descanso quitado', { icon: 'refresh' });
      break;
    default:
      break;
  }
}

/* ───────────── Pantalla ───────────── */

export function mount(el, { query } = {}) {
  const today0 = todayKey();
  const qd = query?.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : null;
  let monday = mondayOf(qd || today0);
  let first = true;
  let dirty = false;

  el.innerHTML = `${navBar({
    title: 'Mi plan',
    large: true,
    right: `<button type="button" class="btn-icon" data-ics aria-label="Añadir al calendario">${icon('calendar', 22)}</button>`,
  })}<div class="container pn"></div>`;
  const root = el.querySelector('.pn');
  const cleanupHeader = enableCollapsingHeader(el);
  ensureSeasonStyles();

  const onSwap = (a, b) => {
    setState((d) => {
      swapDays(d, a, b);
    });
    toast(`Intercambiado: ${dayName(a)} ⇄ ${dayName(b)}`, { icon: 'shuffle', kind: 'success' });
  };
  const drag = createDrag(root, { onSwap });

  function render() {
    if (drag.active) {
      dirty = true;
      return;
    }
    dirty = false;
    const state = getState();
    root.innerHTML = view(state, monday, todayKey(), first);
    first = false;
  }

  function changeWeek(delta) {
    const cur = mondayOf(todayKey());
    monday = delta === 0 ? cur : addDays(monday, delta * 7);
    haptic('selection');
    render();
  }

  async function exportIcs(btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await exportPlanToCalendar(getState());
      if (res?.cancelled) return;
      if (res?.ok) {
        haptic('success');
        toast(res.method === 'share' ? `${res.events} entrenamientos listos para tu Calendario` : 'Calendario descargado · ábrelo para añadirlo', { icon: 'calendar', kind: 'success' });
      } else {
        toast('No se pudo exportar el calendario', { icon: 'info', kind: 'error' });
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function openCard(card) {
    const date = card.dataset.date;
    const id = card.dataset.id;
    if (id && card.dataset.kind !== 'rest') {
      haptic('light');
      navigate(`#/workout/${idHref(id)}?date=${date}&from=plan`);
    } else {
      openDayMenu(date, onSwap);
    }
  }

  const onClick = (e) => {
    if (e.target.closest('.pn-card') && drag.shouldSuppressClick()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const wk = e.target.closest('[data-week]');
    if (wk && !wk.disabled) return changeWeek(Number(wk.dataset.week));
    const ics = e.target.closest('[data-ics]');
    if (ics) return exportIcs(ics);
    const more = e.target.closest('[data-more]');
    if (more) {
      haptic('light');
      return openDayMenu(more.dataset.more, onSwap);
    }
    const card = e.target.closest('.pn-card[data-date]');
    if (card) openCard(card);
  };
  const onKey = (e) => {
    const card = e.target.closest?.('.pn-card[data-date]');
    if (!card || e.target !== card) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openCard(card);
    }
  };
  // Tras soltar, repinta si hubo cambios del store durante el arrastre.
  const onPointerEnd = () => setTimeout(() => dirty && render(), 400);

  el.addEventListener('click', onClick, true);
  el.addEventListener('keydown', onKey);
  root.addEventListener('pointerup', onPointerEnd);

  render();
  const unsub = subscribe(render);

  return () => {
    unsub?.();
    drag.destroy();
    cleanupHeader?.();
    el.removeEventListener('click', onClick, true);
    el.removeEventListener('keydown', onKey);
    root.removeEventListener('pointerup', onPointerEnd);
  };
}
