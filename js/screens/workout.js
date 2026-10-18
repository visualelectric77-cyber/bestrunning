// BestRunning · detalle de clase: perfil, cifras, zonas, estructura, consejos, duración, programar y Empezar.
import { getState, setState, subscribe } from '../core/store.js';
import { navigate } from '../core/router.js';
import { haptic } from '../core/haptics.js';
import {
  icon, navBar, enableCollapsingHeader, intensityDots, chip, stat, segmented, profileChart, zoneBar, sectionHeader,
  emptyState, actionSheet, toast,
} from '../ui/components.js';
import { workoutFromId, parseWorkoutId, workoutId, groupSegments } from '../training/generator.js';
import { planDay, setDayOverride } from '../training/planner.js';
import { CATEGORIES, getTemplate } from '../training/templates.js';
import { ZONES, LEVEL_KEYS } from '../training/levels.js';
import { todayKey, addDays, parseKey, weekdayOf, fmt, esc, capitalize } from '../core/utils.js';

const BACK_LABELS = { plan: 'Plan', today: 'Hoy', library: 'Clases', history: 'Historial' };
const BACK_ROUTES = { plan: '#/plan', today: '#/today', library: '#/library', history: '#/history' };
const INTENSITY = ['Suave', 'Moderada', 'Intensa'];

/* ───────────── Utilidades privadas ───────────── */

function safe(fn, fallback) {
  try {
    const v = fn();
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

const ccStyle = (c) => `--cc:var(--c-${CATEGORIES[c] ? c : 'test'})`;
const isKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
const minutesOf = (w) => w.minutes || Math.round((w.totalSec || 0) / 60);

function decodeId(raw) {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return String(raw);
  }
}

function dayLabel(key, today, short = false) {
  const rel = fmt.relativeDay(key, today);
  if (rel === 'Hoy' || rel === 'Mañana' || rel === 'Ayer') return rel;
  const wd = short ? fmt.weekdayShort(weekdayOf(key)) : fmt.weekdayName(weekdayOf(key));
  return `${capitalize(wd)} ${parseKey(key).getDate()}`;
}

/* ───────────── Bloques ───────────── */

function axis(totalSec) {
  if (!totalSec) return '';
  const step = totalSec <= 1800 ? 300 : 600;
  const ticks = [];
  for (let t = 0; t <= totalSec - step * 0.4; t += step) ticks.push(t);
  ticks.push(totalSec);
  return `<div class="wk-axis" aria-hidden="true">${ticks
    .map((t, i) => {
      const pos = (t / totalSec) * 100;
      const cls = i === 0 ? ' is-first' : i === ticks.length - 1 ? ' is-last' : '';
      return `<span class="wk-axis__tick${cls}" style="left:${pos.toFixed(2)}%">${Math.round(t / 60)}′</span>`;
    })
    .join('')}</div>`;
}

function heroBlock(w, state, ctx) {
  const c = CATEGORIES[w.category];
  const lv = state.levels || {};
  const chips = [
    chip(c?.name || 'Clase', { color: c?.color || null, active: true }),
    w.focus ? chip(w.focus) : '',
  ].join('');
  const intensity = Math.min(3, Math.max(1, w.intensity || 1));
  const legend = LEVEL_KEYS.map(
    (k) => `<span class="wk-legend__item" style="--zc:var(--z-${k})"><i aria-hidden="true"></i>${esc(ZONES[k].short)} <b class="num">${fmt.speed(lv[k] ?? 0)}</b></span>`
  ).join('');
  const plan = ctx.date
    ? `<div class="wk-plan">${icon('calendar', 14)} Clase del plan · ${esc(dayLabel(ctx.date, ctx.today))}</div>`
    : '';
  return `<section class="wk-hero" style="${ccStyle(w.category)}">
    <div class="wk-hero__glow" aria-hidden="true"></div>
    ${plan}
    <div class="wk-chips">${chips}<span class="wk-int" aria-label="Intensidad ${INTENSITY[intensity - 1].toLowerCase()}">${intensityDots(intensity, 'var(--cc)')}<span>${INTENSITY[intensity - 1]}</span></span></div>
    ${w.subtitle ? `<p class="wk-sub">${esc(w.subtitle)}</p>` : ''}
    <div class="wk-chart">
      ${profileChart(w.segments || [], { height: 172, showLevels: true, levels: lv, radius: 4 })}
      ${axis(w.totalSec)}
    </div>
    <div class="wk-legend">${legend}</div>
  </section>`;
}

function statsBlock(w) {
  return `<div class="card wk-stats">
    ${w.isTest
      ? stat({ label: 'Duración máx.', value: fmt.int(Math.round((w.totalSec || 0) / 60)), unit: 'min', icon: 'timer' })
      : stat({ label: 'Duración', value: fmt.int(minutesOf(w)), unit: 'min', icon: 'timer' })}
    ${stat({ label: 'Distancia est.', value: fmt.dec1(w.estDistanceKm || 0), unit: 'km', icon: 'route' })}
    ${stat({ label: 'Energía est.', value: fmt.int(w.estKcal || 0), unit: 'kcal', icon: 'flame' })}
    ${stat({ label: 'Vel. máx.', value: fmt.speed(w.maxSpeed || 0), unit: 'km/h', icon: 'bolt', color: 'var(--z-sprint)' })}
  </div>`;
}

function durationBlock(w) {
  if (w.isTest) return '';
  const tpl = safe(() => getTemplate(w.templateId), null);
  const cur = minutesOf(w);
  let ds = Array.isArray(tpl?.durations) ? tpl.durations.slice() : [];
  if (ds.length && !ds.includes(cur)) ds.push(cur);
  ds = [...new Set(ds)].sort((a, b) => a - b);
  if (ds.length < 2) return '';
  return `<div class="wk-dur">
    <span class="wk-dur__label">Duración</span>
    ${segmented({ name: 'wk-dur', options: ds.map((d) => ({ value: d, label: `${d} min` })), value: cur })}
  </div>`;
}

function segRow(s) {
  const z = ZONES[s.zone] ? s.zone : 'jog';
  const incl = s.incline ? `<span class="wk-seg__incl">${icon('mountain', 12)} ${fmt.dec1(s.incline)} %</span>` : '';
  return `<div class="wk-seg" style="--zc:var(--z-${z})">
    <span class="wk-seg__bar" aria-hidden="true"></span>
    <span class="wk-seg__label">${esc(s.label || ZONES[z].name)}${incl}</span>
    <span class="wk-seg__dur num">${fmt.clock(s.sec)}</span>
    <span class="wk-seg__speed num">${fmt.speed(s.speed)}<small>km/h</small></span>
  </div>`;
}

function structureBlock(w) {
  const segs = w.segments || [];
  if (!segs.length) return '';
  let groups = safe(() => groupSegments(segs), null);
  if (!Array.isArray(groups) || !groups.length) groups = segs.map((s) => ({ kind: 'single', times: 1, segments: [s] }));
  let t = 0;
  const rows = groups.map((g) => {
    const inner = Array.isArray(g.segments) ? g.segments : [];
    const times = Math.max(1, g.times || 1);
    const groupSec = inner.reduce((a, s) => a + (s.sec || 0), 0) * times;
    const start = fmt.clock(t);
    t += groupSec;
    if (g.kind === 'repeat' && times > 1) {
      const name = inner.find((s) => s.block)?.block || 'Series';
      return `<li class="wk-row wk-row--repeat">
        <span class="wk-row__time num">${start}</span>
        <div class="wk-rep">
          <div class="wk-rep__head"><span class="wk-rep__times num">${times}×</span><span class="wk-rep__name">${esc(name)}</span><span class="wk-rep__total num">${fmt.clock(groupSec)}</span></div>
          ${inner.map(segRow).join('')}
        </div>
      </li>`;
    }
    return inner.map((s) => `<li class="wk-row"><span class="wk-row__time num">${start}</span>${segRow(s)}</li>`).join('');
  });
  return `<section class="wk-section">
    ${sectionHeader('Estructura', `<span class="wk-aside">${segs.length} tramos</span>`)}
    <ol class="wk-struct">${rows.join('')}</ol>
  </section>`;
}

function notesBlock(w, state) {
  const notes = Array.isArray(w.coachNotes) ? w.coachNotes.filter(Boolean) : [];
  const lead = state.treadmill?.announceLead || 10;
  const items = notes.map((n) => `<li>${icon('sparkles', 16)}<span>${esc(n)}</span></li>`);
  items.push(`<li class="wk-notes__tread">${icon('speaker', 16)}<span>Tu coach te avisará ${lead} segundos antes de cada cambio de velocidad: la cinta tarda unos segundos en ajustarse.</span></li>`);
  return `<section class="wk-section">
    ${sectionHeader('Consejos del coach')}
    <ul class="card wk-notes">${items.join('')}</ul>
  </section>`;
}

function warningsBlock(w, state) {
  const tpl = safe(() => getTemplate(w.templateId), null);
  const out = [];
  if (tpl?.requiresIncline && !state.treadmill?.hasIncline) {
    out.push(`<div class="wk-warn">${icon('mountain', 18)}<span>Esta clase usa inclinación. Actívala en <b>Perfil → Cinta</b> si tu cinta la tiene.</span></div>`);
  }
  if (w.isTest) {
    out.push(`<div class="wk-warn wk-warn--test">${icon('gauge', 18)}<span><b>Cómo funciona:</b> tras calentar, sube 0,5 km/h cada minuto. Aguanta todo lo que puedas y pulsa «No puedo más»: pasarás a la vuelta a la calma y calcularemos tu VAM y tus nuevas velocidades.</span></div>`);
  }
  return out.join('');
}

function view(w, state, ctx) {
  return `
    ${heroBlock(w, state, ctx)}
    ${warningsBlock(w, state)}
    ${statsBlock(w)}
    ${durationBlock(w)}
    <section class="wk-section">
      ${sectionHeader('Tiempo por zona')}
      <div class="card wk-zones">${zoneBar(w.timeInZone || {}, { showLegend: true })}</div>
    </section>
    ${w.description ? `<section class="wk-section"><p class="wk-desc">${esc(w.description)}</p></section>` : ''}
    ${structureBlock(w)}
    ${notesBlock(w, state)}
    <div class="wk-more">
      <button type="button" class="btn btn--secondary btn--block btn--lg" data-schedule>${icon('calendar', 20)} Programar para…</button>
    </div>
    <div class="wk-spacer" aria-hidden="true"></div>`;
}

function ctaHtml(w, ctx) {
  const play = `#/play/${encodeURIComponent(w.id)}${ctx.date ? `?date=${ctx.date}` : ''}`;
  return `<div class="wk-cta">
    <button type="button" class="btn btn--primary btn--lg btn--block wk-go" data-href="${play}">${icon('play', 20)}<span>Empezar</span><span class="wk-go__min">${w.isTest ? `≤ ${Math.round((w.totalSec || 0) / 60)}` : minutesOf(w)} min</span></button>
  </div>`;
}

/* ───────────── Programar para… ───────────── */

async function scheduleFor(w) {
  const state = getState();
  const today = todayKey();
  const opts = [];
  for (let i = 0; i < 7; i++) {
    const key = addDays(today, i);
    const d = safe(() => planDay(state, key), null);
    if (d?.status === 'done') continue;
    const now = d?.workout && d.kind !== 'rest' ? d.workout.title : 'Descanso';
    const same = d?.templateId === w.templateId && d.kind !== 'rest';
    opts.push({
      label: `${dayLabel(key, today, true)} · ${same ? 'ya programada' : d?.kind === 'rest' || !d?.workout ? 'en lugar del descanso' : `en lugar de ${now}`}`,
      value: key,
      icon: d?.kind === 'rest' ? 'moon' : 'calendar',
    });
  }
  if (!opts.length) {
    toast('No quedan días libres en la próxima semana', { icon: 'info' });
    return;
  }
  const v = await actionSheet({ title: `Programar «${w.title}» para…`, options: opts });
  if (!v) return;
  setState((d) => {
    setDayOverride(d, v, { templateId: w.templateId, minutes: minutesOf(w) });
  });
  haptic('success');
  const rel = fmt.relativeDay(v, today);
  const when = rel === 'Hoy' ? 'hoy' : rel === 'Mañana' ? 'mañana' : `el ${fmt.weekdayName(weekdayOf(v))} ${parseKey(v).getDate()}`;
  toast(`Programada para ${when} · toca para ver el plan`, {
    icon: 'calendar',
    kind: 'success',
    onClick: () => navigate(`#/plan?date=${v}`),
  });
}

/* ───────────── Pantalla ───────────── */

export function mount(el, { params, query } = {}) {
  let id = decodeId(params?.id);
  const ctx = {
    date: isKey(query?.date) ? query.date : null,
    from: typeof query?.from === 'string' ? query.from : '',
    today: todayKey(),
  };
  let w = id ? safe(() => workoutFromId(id, getState()), null) : null;
  const backLabel = BACK_LABELS[ctx.from] || 'Atrás';
  const backTo = BACK_ROUTES[ctx.from] || '#/library';

  if (!w) {
    el.innerHTML = `${navBar({ title: 'Clase', large: true, back: backTo, backLabel })}
      <div class="container wk">${emptyState({
        icon: 'grid',
        title: 'No encontramos esta clase',
        text: 'Puede que el enlace sea antiguo. Elige otra en la biblioteca.',
        action: '<button type="button" class="btn btn--primary" data-href="#/library">Ver clases</button>',
      })}</div>`;
    const c = enableCollapsingHeader(el);
    return () => c?.();
  }

  el.innerHTML = `${navBar({ title: w.title, large: true, back: backTo, backLabel })}
    <div class="container wk stagger"></div><div class="wk-cta-slot"></div>`;
  const root = el.querySelector('.wk');
  const ctaSlot = el.querySelector('.wk-cta-slot');
  const cleanupHeader = enableCollapsingHeader(el);
  let first = true;

  function render() {
    const state = getState();
    root.classList.toggle('stagger', first);
    root.innerHTML = view(w, state, ctx);
    [...root.children].forEach((n, i) => n.style.setProperty('--i', Math.min(i, 10)));
    ctaSlot.innerHTML = ctaHtml(w, ctx);
    first = false;
  }

  function updateUrl() {
    try {
      const q = [];
      if (ctx.date) q.push(`date=${ctx.date}`);
      if (ctx.from) q.push(`from=${encodeURIComponent(ctx.from)}`);
      history.replaceState(history.state, '', `#/workout/${encodeURIComponent(id)}${q.length ? `?${q.join('&')}` : ''}`);
    } catch {
      /* sin History API: la URL se queda con la duración anterior */
    }
  }

  function changeDuration(minutes) {
    if (!minutes || minutes === minutesOf(w)) return;
    const p = safe(() => parseWorkoutId(id), null);
    if (!p) return;
    const nid = safe(() => workoutId({ ...p, minutes }), null);
    const nw = nid ? safe(() => workoutFromId(nid, getState()), null) : null;
    if (!nw) {
      toast('No se pudo cambiar la duración', { icon: 'info', kind: 'error' });
      return;
    }
    id = nid;
    w = nw;
    updateUrl();
    render();
  }

  const onChange = (e) => {
    if (e.detail && e.detail.name === 'wk-dur') changeDuration(Number(e.detail.value));
  };
  const onClick = (e) => {
    if (e.target.closest('[data-schedule]')) {
      haptic('light');
      scheduleFor(w);
    }
  };
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);

  // Solo se repinta si cambia algo que altera la clase (niveles, cinta, peso).
  const signature = (s) => {
    const lv = s.levels || {};
    const tm = s.treadmill || {};
    return [lv.jog, lv.run, lv.fast, lv.sprint, tm.hasIncline, tm.minSpeed, tm.maxSpeed, tm.announceLead, s.profile?.weightKg].join('|');
  };
  let sig = signature(getState());

  render();
  const unsub = subscribe(() => {
    const st = getState();
    const next = signature(st);
    if (next === sig) return;
    sig = next;
    const nw = safe(() => workoutFromId(id, st), null);
    if (nw) w = nw;
    render();
  });

  return () => {
    unsub?.();
    cleanupHeader?.();
    root.removeEventListener('change', onChange);
    root.removeEventListener('click', onClick);
  };
}
