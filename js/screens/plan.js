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
const ccStyle = (c) => `--cc:var(--c-${CATEGORIES[c] ? c : 'test'})`;
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
const PHASE_COLOR = { base: 'endurance', construccion: 'hills', especifico: 'tempo', picos: 'intervals', transicion: 'recovery' };
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
  if (si.isDeload) out.push(`<span class="br-chip br-chip--deload">${icon('leaf', 12)} Descarga</span>`);
  if (si.isTestWeek) out.push(`<span class="br-chip br-chip--test">${icon('gauge', 12)} Test VAM</span>`);
  if (si.event) out.push(`<span class="br-chip br-chip--event">${icon('star', 12)} ${esc(si.event.name)}</span>`);
  const ad = ADAPT_LABEL[si.adapt?.mode];
  if (ad) out.push(`<span class="br-chip br-chip--adapt">${icon('pulse', 12)} ${ad}</span>`);
  return out.join('');
}

/** Sesiones del historial hechas ese día (planificadas y extra), en orden. */
export function sessionsOn(state, dateKey) {
  const list = Array.isArray(state?.history) ? state.history : [];
  return list
    .filter((s) => s && s.id && (s.dayKey === dateKey || (!s.dayKey && String(s.startedAt || '').slice(0, 10) === dateKey)))
    .sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
}

let stylesDone = false;
/** Estilos de los bloques de temporada y de sesiones del día (inyectados una vez; viven junto a estas pantallas). */
export function ensureSeasonStyles() {
  if (stylesDone || typeof document === 'undefined') return;
  stylesDone = true;
  if (document.getElementById('br-season-css')) return;
  const st = document.createElement('style');
  st.id = 'br-season-css';
  st.textContent = `
.br-season{display:flex;flex-wrap:wrap;align-items:center;gap:6px;width:100%;margin:0 0 12px;padding:11px 14px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line);color:var(--text-2);font:inherit;font-size:13px;line-height:1.35;text-align:left}
button.br-season{cursor:pointer}
.br-season__line{flex:1 1 100%;display:flex;align-items:center;gap:6px;color:var(--text);font-size:14px;font-weight:700}
.br-season__line svg{flex:none;color:var(--accent)}
.br-season__intro{flex:1 1 100%;margin:2px 0 0;color:var(--text-2)}
.br-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;background:var(--surface-3);color:var(--text-2);font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
.br-chip--deload{background:color-mix(in srgb,var(--c-recovery) 24%,transparent);color:#bfeaff}
.br-chip--test{background:color-mix(in srgb,var(--c-test) 32%,transparent);color:#cfceff}
.br-chip--event{background:var(--accent-soft);color:#ffb37f}
.br-chip--surprise{background:color-mix(in srgb,var(--warn) 20%,transparent);color:#ffe680}
.br-chip--adapt{background:color-mix(in srgb,var(--ok) 20%,transparent);color:#a6f0b9}
.br-event{display:flex;align-items:flex-start;gap:12px;margin:0 0 12px;padding:12px 14px;border-radius:var(--r-md);border:1px solid rgba(255,106,26,.32);background:linear-gradient(135deg,rgba(255,106,26,.2),rgba(255,45,85,.08) 60%,var(--surface));font-size:14px;line-height:1.4;color:var(--text-2)}
.br-event svg{flex:none;margin-top:1px;color:var(--accent)}
.br-event b{display:block;color:var(--text)}
.br-sessions__head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:0 0 8px}
.br-sessions__head h3{margin:0;font-size:17px;font-weight:800;color:var(--text)}
.br-sessions__head span{font-size:12px;color:var(--text-3)}
.br-ses{display:flex;align-items:center;gap:12px;width:100%;min-height:56px;padding:10px 12px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line);color:var(--text);font:inherit;text-align:left;cursor:pointer}
.br-ses+.br-ses{margin-top:8px}
.br-ses__bar{flex:none;width:4px;align-self:stretch;border-radius:2px;background:var(--cc,var(--accent))}
.br-ses__body{flex:1;min-width:0}
.br-ses__title{display:flex;align-items:center;gap:6px;font-size:15px;font-weight:700}
.br-ses__title span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.br-ses__meta{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:2px;font-size:12.5px;color:var(--text-3)}
.br-ses>svg{flex:none;color:var(--text-3)}
.br-ses .br-chip{flex:none}
.pn-day>.br-extras{grid-column:2;display:flex;flex-direction:column;gap:6px}
.br-extra{display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border-radius:12px;background:var(--surface-2);border:1px dashed var(--line-strong);color:var(--text-2);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.br-extra b{color:var(--text);font-weight:700;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.br-extra svg{flex:none}
.br-extra .br-extra__go{margin-left:auto;color:var(--text-3)}
.br-cal{margin:0 0 14px;padding:12px 14px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line)}
.br-cal__head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:8px}
.br-cal__head b{font-size:14px;color:var(--text)}
.br-cal__head span{font-size:12px;color:var(--text-3)}
.br-cal__strip{display:grid;grid-template-columns:repeat(13,minmax(0,1fr));gap:3px}
.br-cal__seg{height:8px;border-radius:3px;background:var(--pc);opacity:.35}
.br-cal__seg.is-past{opacity:.6}
.br-cal__seg.is-current{opacity:1;box-shadow:0 0 10px var(--pc);transform:scaleY(1.4)}
.br-cal__legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:8px;font-size:11.5px;color:var(--text-3)}
.br-cal__legend i{display:inline-block;width:8px;height:8px;margin-right:4px;border-radius:2px;background:var(--pc)}
.br-cal details{margin-top:8px}
.br-cal summary{cursor:pointer;font-size:13px;font-weight:700;color:var(--accent);list-style:none}
.br-cal summary::-webkit-details-marker{display:none}
.br-cal ol{margin:8px 0 0;padding:0;list-style:none}
.br-cal li{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--line);font-size:13px;color:var(--text-2)}
.br-cal li b{color:var(--text);font-weight:700}
.br-cal li.is-current{color:var(--text)}
.br-cal li.is-current b{color:var(--accent)}
.br-cal li i{width:10px;height:10px;border-radius:3px;background:var(--pc)}
.br-cal li small{font-size:11.5px;color:var(--text-3);white-space:nowrap}
.td-hero__intro{margin:0;font-size:13.5px;line-height:1.4;color:rgba(255,255,255,.74);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.td-hero__status svg{vertical-align:-2px}
`;
  document.head.appendChild(st);
}

/** Tarjeta de sesión hecha (planificada o extra) que abre su resumen. */
export function sessionRow(s, { planned = false } = {}) {
  const cat = CATEGORIES[s.category] ? s.category : 'test';
  const t = s.startedAt ? new Date(s.startedAt) : null;
  const at = t && !Number.isNaN(t.getTime()) ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '';
  const pct = Math.round((Number(s.completionPct) || 0) * 100);
  const tag = planned ? '<span class="br-chip">Plan</span>' : '<span class="br-chip br-chip--event">Extra</span>';
  const meta = [at, fmt.clock(s.elapsedSec || 0), `${fmt.dec1(s.distanceKm || 0)} km`, s.kcal ? `${fmt.int(s.kcal)} kcal` : '', pct && pct < 90 ? `${pct} %` : '']
    .filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('');
  return `<button type="button" class="br-ses" style="--cc:var(--c-${cat})" data-href="#/summary/${idHref(s.id)}" aria-label="${esc(`Ver resumen: ${s.title || 'Entrenamiento'}${planned ? '' : ' (extra)'}`)}">
    <span class="br-ses__bar" aria-hidden="true"></span>
    <span class="br-ses__body"><span class="br-ses__title"><span>${esc(s.title || 'Entrenamiento')}</span>${tag}</span><span class="br-ses__meta">${meta}</span></span>
    ${icon('chevron-right', 18)}
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

function altRow(w, i) {
  const km = w.estDistanceKm ? ` · ~${fmt.dec1(w.estDistanceKm)} km` : '';
  return `<button type="button" class="pn-alt" data-alt="${i}" style="${ccStyle(w.category)}">
    <span class="pn-alt__bar" aria-hidden="true"></span>
    <span class="pn-alt__body">
      <span class="pn-alt__eyebrow">${esc(catName(w.category))}</span>
      <span class="pn-alt__title">${esc(w.title)}</span>
      <span class="pn-alt__meta">${Math.round(w.totalSec / 60)} min${km} ${intensityDots(w.intensity || 1, 'var(--cc)')}</span>
    </span>
    <span class="pn-alt__chart" aria-hidden="true">${profileChart(w.segments || [], { height: 84, compact: true })}</span>
  </button>`;
}

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
    <button type="button" class="btn-icon pn-week__nav" data-week="-1" aria-label="Semana anterior" ${canPrev ? '' : 'disabled'}>${icon('chevron-left', 22)}</button>
    <div class="pn-week__label" aria-live="polite">
      <div class="pn-week__range num">${rangeLabel(monday)}</div>
      <div class="pn-week__name">${wk}</div>
    </div>
    <button type="button" class="btn-icon pn-week__nav" data-week="1" aria-label="Semana siguiente" ${canNext ? '' : 'disabled'}>${icon('chevron-right', 22)}</button>
  </div>
  ${isCurrent ? '' : `<div class="pn-week__back"><button type="button" class="pn-link" data-week="0">${icon('refresh', 14)} Volver a esta semana</button></div>`}`;
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
    <div class="pn-cycle__head"><span class="eyebrow">${blk}</span><span class="pn-cycle__load">Carga ${Math.round((ci.loadFactor || 1) * 100)} %</span></div>
    <div class="pn-cycle__bar">${segs}</div>
  </div>`;
}

function seasonBlock(si) {
  if (!si) return '';
  const intro = si.event ? eventIntro(si.event.key) : `${si.themeIntro} ${si.weekLine || ''}`;
  return `<div class="br-season" role="group" aria-label="${esc(seasonLine(si))}">
    <span class="br-season__line">${icon('flag', 15)}<span>${esc(seasonLine(si))}</span></span>
    ${seasonChips(si)}
    <p class="br-season__intro">${esc(intro.trim())}</p>
  </div>`;
}

function seasonCal(state, monday) {
  const cal = safe(() => seasonCalendar(state, monday), null);
  if (!Array.isArray(cal) || cal.length !== 13) return '';
  const cur = cal.find((m) => m.current);
  const pc = (m) => `--pc:var(--c-${PHASE_COLOR[m.phase.key] || 'test'})`;
  const strip = cal.map((m) => `<span class="br-cal__seg${m.current ? ' is-current' : cur && m.cycleIndex < cur.cycleIndex ? ' is-past' : ''}" style="${pc(m)}" title="${esc(`${m.mesoNumber}. ${m.theme.name}`)}"></span>`).join('');
  const seen = new Set();
  const legend = cal.filter((m) => !seen.has(m.phase.key) && seen.add(m.phase.key))
    .map((m) => `<span><i style="${pc(m)}"></i>${esc(m.phase.name)}</span>`).join('');
  const rows = cal.map((m) => `<li class="${m.current ? 'is-current' : ''}" style="${pc(m)}"><i aria-hidden="true"></i>
      <span><b>${m.mesoNumber}. ${esc(m.theme.name)}</b> · ${esc(m.phase.name)}</span><small>${esc(fmt.dateShort(m.start))}</small></li>`).join('');
  return `<section class="br-cal" aria-label="Tu temporada de 52 semanas">
    <div class="br-cal__head"><b>Tu temporada</b><span>13 bloques de 4 semanas</span></div>
    <div class="br-cal__strip" aria-hidden="true">${strip}</div>
    <div class="br-cal__legend">${legend}</div>
    <details><summary>Ver los 13 bloques ${icon('chevron-down', 13)}</summary><ol>${rows}</ol></details>
  </section>`;
}

function weekSummary(days) {
  const train = days.filter((d) => d.workout && d.kind !== 'rest');
  const done = days.filter((d) => d.status === 'done').length;
  const sec = train.reduce((a, d) => a + mins(d.workout) * 60, 0);
  const km = train.reduce((a, d) => a + (d.workout.estDistanceKm || 0), 0);
  return `<div class="pn-summary">
    <div class="pn-summary__item"><span class="num">${done}<small>/${train.length}</small></span><span class="pn-summary__label">Sesiones</span></div>
    <div class="pn-summary__item"><span class="num">${hm(sec)}</span><span class="pn-summary__label">Tiempo</span></div>
    <div class="pn-summary__item"><span class="num">~${fmt.dec1(km)}</span><span class="pn-summary__label">km est.</span></div>
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
      <span class="pn-day__wd">${fmt.weekdayAbbr(wd)}</span>
      <span class="pn-day__num num">${dnum}</span>
      ${isToday ? '<span class="pn-day__today">Hoy</span>' : ''}
    </div>`;
  const more = `<button type="button" class="pn-card__more" data-more="${day.date}" aria-label="Opciones del ${fmt.weekdayName(wd)}">${MORE_SVG}</button>`;
  const liCls = `pn-day${isToday ? ' is-today' : ''}${past ? ' is-past' : ''}`;
  // Sesiones de ese día que no son la del plan (extra): cada una abre su resumen
  const mainId = w && day.kind !== 'rest' && day.status === 'done' ? day.session?.id : null;
  const others = sessionsOn(state, day.date).filter((s) => s.id !== mainId);
  const extras = others.length
    ? `<div class="br-extras">${others.map((s) => `<button type="button" class="br-extra" data-href="#/summary/${idHref(s.id)}" aria-label="${esc(`Ver resumen de ${s.title || 'entrenamiento'} (extra)`)}">
        ${icon('plus', 14)}<span>Extra:</span><b>${esc(s.title || 'Entrenamiento')}</b><span>${fmt.dec1(s.distanceKm || 0)} km</span><span class="br-extra__go">${icon('chevron-right', 16)}</span></button>`).join('')}</div>`
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
          <div class="pn-card__meta">${sub}</div>
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
    meta = `<span class="pn-ok">${icon('check', 13, { stroke: 3 })} Hecho</span><span>${fmt.dec1(ses.distanceKm || 0)} km</span><span>${fmt.clock(ses.elapsedSec || 0)}</span>`;
  } else {
    if (w.estDistanceKm) meta += `<span>~${fmt.dec1(w.estDistanceKm)} km</span>`;
    meta += intensityDots(w.intensity || 1, 'var(--cc)');
    if (status === 'missed') meta += '<span class="pn-missed">No realizada</span>';
  }
  const badges = `${day.kind === 'test' || w.isTest ? '<span class="pn-badge pn-badge--test">Test</span>' : ''}${
    day.event && !day.isOverride ? `<span class="br-chip br-chip--event">${esc(day.event.name || 'Especial')}</span>` : ''}${
    day.surprise && !day.event && !day.isOverride ? '<span class="br-chip br-chip--surprise">Sorpresa</span>' : ''}${
    day.isOverride ? '<span class="pn-badge">Editado</span>' : ''}`;
  const label = `${capitalize(fmt.weekdayName(wd))} ${dnum}: ${w.title}, ${catName(w.category)}, ${mins(w)} minutos.${
    status === 'done' ? ' Hecho.' : status === 'missed' ? ' No realizada.' : ''
  }${locked ? '' : ' Mantén pulsado para moverlo.'}`;

  return `<li class="${liCls}" style="--i:${i}">${rail}
    <div class="pn-card st-${status}${locked ? ' is-locked' : ''}" style="${ccStyle(w.category)}" data-date="${day.date}" data-id="${esc(w.id)}" role="button" tabindex="0" aria-label="${esc(label)}">
      <span class="pn-card__bar" aria-hidden="true"></span>
      <div class="pn-card__body">
        <div class="pn-card__eyebrow"><span>${esc(catName(w.category))}</span>${badges}</div>
        <div class="pn-card__title">${esc(status === 'done' && ses?.title ? ses.title : w.title)}</div>
        <div class="pn-card__meta">${meta}</div>
      </div>
      <div class="pn-card__chart" aria-hidden="true">${profileChart(w.segments || [], { height: 84, compact: true })}</div>
      ${status === 'done' ? `<span class="pn-card__check" aria-hidden="true">${icon('check', 12, { stroke: 3.2 })}</span>` : ''}
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
    testNote = `<div class="pn-note pn-note--test">${icon('gauge', 18)}<span><b>Semana de test.</b> Test VAM el ${esc(dayName(testDay.date))} ${parseKey(testDay.date).getDate()}: recalcula tus cuatro velocidades. Los días de alrededor son suaves.</span></div>`;
  } else if (ci?.isDeload) {
    testNote = `<div class="pn-note">${icon('leaf', 18)}<span><b>Semana de descarga.</b> Menos carga (sobre un 65 %) para asimilar el trabajo del bloque y llegar fresco al siguiente.</span></div>`;
  } else if (monday === curMonday) {
    const nt = safe(() => nextTestDate(state, today), null);
    if (nt) {
      const inDays = daysBetween(today, nt);
      if (inDays > 0) testNote = `<div class="pn-note">${icon('target', 18)}<span>Próximo test VAM: <b>${esc(fmt.dateShort(nt))}</b> · en ${inDays} ${inDays === 1 ? 'día' : 'días'}</span></div>`;
    }
  }

  return `
    ${weekHeader(monday, ci, canPrev, canNext, monday === curMonday)}
    ${seasonBlock(si)}
    ${cycleBar(ci)}
    ${weekSummary(days)}
    ${testNote}
    <p class="pn-hint">${icon('drag', 16)} Mantén pulsado un día y arrástralo sobre otro para intercambiarlos.</p>
    <ol class="pn-days${first ? ' stagger' : ''}" aria-label="Días de la semana">${days.map((d, i) => dayRow(d, today, i, createdKeyOf(state), state)).join('')}</ol>
    ${seasonCal(state, monday)}
    <div class="pn-actions">
      <button type="button" class="btn btn--secondary btn--block btn--lg" data-ics>${icon('calendar', 20)} Añadir al Calendario</button>
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
    right: `<button type="button" class="btn-icon" data-ics aria-label="Añadir al Calendario">${icon('calendar', 22)}</button>`,
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
