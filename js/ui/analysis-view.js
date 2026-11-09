// RITMUP · cómo se pinta el análisis: el de cada clase (Resumen e Historial) y el balance de la pestaña Análisis.
import { icon, ring, effortBars, sectionHeader } from './components.js';
import { barChart, lineChart } from './charts.js';
import { esc, fmt, parseKey, daysBetween } from '../core/utils.js';
import { WEEK_TAGS } from '../training/evolution.js';

const FEEL_LEVEL = { easy: 1, ok: 2, hard: 3, max: 4, fail: 5 };
const shortDay = (key) => fmt.dateShort(key).split(' ').slice(1).join(' ');
const STATUS = {
  good: { icon: 'check', text: 'Bien' }, warn: { icon: 'warning', text: 'Ojo' },
  neutral: { icon: 'circle', text: 'Normal' }, learning: { icon: 'hourglass', text: 'Aprendiendo' },
};
const WEEK_STATE = {
  strong: { icon: 'arrow-up', text: 'Fuerte' }, normal: { icon: 'circle', text: 'Normal' },
  weak: { icon: 'arrow-down', text: 'Flojo' }, off: { icon: 'moon', text: 'Parado' },
};
const VERDICT_ICON = { good: 'arrow-up', warn: 'warning', neutral: 'circle', start: 'sparkles', back: 'repeat' };

/** La cifra lleva su signo; el color dice si es mejor o peor (menos pulso en verde, aunque baje). */
const deltaMark = (r) => `<span class="ca-mark num${r.better == null ? '' : r.better ? ' is-good' : ' is-bad'}" aria-label="${r.better == null ? 'Igual' : r.better ? 'Mejor' : 'Peor'}">${esc(r.delta)}</span>`;

const compareRows = (rows) => `<div class="ca-cmp">${rows.map((r) => `<div class="ca-cmp__row">
    <span class="ca-cmp__label">${esc(r.label)}</span>
    <span class="ca-cmp__from num">${esc(r.from)}</span>
    <span class="ca-cmp__arrow" aria-hidden="true">${icon('arrow-right', 12)}</span>
    <b class="ca-cmp__to num">${esc(r.to)}</b>
    <span class="ca-cmp__unit">${esc(r.unit)}</span>
    ${deltaMark(r)}
  </div>`).join('')}</div>`;

/* ═════════════ Una clase ═════════════ */

export function classAnalysisHtml(a, { planHtml = '' } = {}) {
  if (!a) return '';
  const ex = a.execution;
  const scoreHtml = ex.score != null ? `<div class="ca-hero__ring" role="img" aria-label="Nota de la clase: ${ex.score} de 100, ${esc(ex.label)}">
      ${ring({ value: ex.score / 100, size: 76, stroke: 7, inner: `<span class="ca-hero__score num">${ex.score}</span>` })}
      <span class="ca-hero__label">${esc(ex.label)}</span>
    </div>` : '';
  const checks = a.checks.map((c) => `<div class="ca-check">
      <span class="ca-check__ic ${c.state === 'ok' ? 'is-ok' : 'is-warn'}" aria-hidden="true">${icon(c.state === 'ok' ? 'check' : 'warning', 13, { stroke: 2.6 })}</span>
      <span class="ca-check__txt"><span>${esc(c.label)}</span>${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</span>
      <b class="num">${esc(c.value)}</b>
    </div>`).join('');
  const hero = `<section class="card ca-card ca-hero" style="--i:2">
    <div class="ca-hero__top">
      <div class="ca-hero__head"><div class="eyebrow">Tu clase</div><h2 class="ca-hero__title">${esc(a.headline)}</h2></div>
      ${scoreHtml}
    </div>
    ${a.lead ? `<p class="ca-lead">${esc(a.lead)}</p>` : ''}
    <div class="ca-checks">${checks}</div>
    ${a.goal.purpose ? `<p class="ca-purpose"><b>Buscaba</b> ${esc(a.goal.purpose)}</p>` : ''}
  </section>`;

  const cmp = a.compare ? `<section class="card ca-card" style="--i:2">
    <div class="ca-card__head"><div class="eyebrow">${esc(a.compare.title)}</div>${a.compare.when ? `<span class="ca-hint">${esc(a.compare.when)}</span>` : ''}</div>
    ${compareRows(a.compare.rows)}
    <p class="ca-line ca-line--${esc(a.compare.line.tone)}">${esc(a.compare.line.text)}</p>
  </section>` : '';

  const moments = a.moments.length ? `<section class="card ca-card" style="--i:2">
    <div class="ca-card__head"><div class="eyebrow">Dentro de la clase</div></div>
    <div class="ca-moments">${a.moments.map((m) => `<div class="ca-moment">
      <span class="ca-moment__label">${esc(m.label)}</span>
      <span class="ca-moment__value"><b class="num">${esc(m.value)}</b><small>${esc(m.unit)}</small></span>
      ${m.note ? `<span class="ca-moment__note${m.tone ? ` is-${esc(m.tone)}` : ''}">${esc(m.note)}</span>` : ''}
    </div>`).join('')}</div>
  </section>` : '';

  const nextDay = a.next ? (a.next.days === 1 ? 'Mañana' : capitalizeDay(a.next.date)) : '';
  const hasFoot = a.next || a.load || a.tip || planHtml;
  const foot = hasFoot ? `<section class="card ca-card" style="--i:2">
    <div class="ca-card__head"><div class="eyebrow">Y ahora</div></div>
    ${a.load ? `<p class="ca-foot"><span aria-hidden="true">${icon('flame', 15)}</span><span>${esc(a.load.text)}</span></p>` : ''}
    ${a.tip ? `<p class="ca-foot"><span aria-hidden="true">${icon('info', 15)}</span><span>${esc(a.tip)}</span></p>` : ''}
    ${a.next ? `<div class="ca-next"><span class="ca-next__day">${esc(nextDay)}</span><b>${esc(a.next.title)}</b><span class="ca-next__min num">${a.next.minutes} min</span></div>
      ${a.nextHint ? `<p class="ca-next__hint">${esc(a.nextHint)}</p>` : ''}` : ''}
    ${planHtml}
  </section>` : '';
  return hero + cmp + moments + foot;
}

function capitalizeDay(key) {
  const t = fmt.dateShort(key);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* ═════════════ Balance: pestaña Análisis ═════════════ */

const verdictHtml = (v) => `<div class="ca-verdict ca-verdict--${esc(v.tone)}">
    <span class="ca-verdict__ic" aria-hidden="true">${icon(VERDICT_ICON[v.tone] || 'circle', 18, { stroke: 2.4 })}</span>
    <div><h2 class="ca-verdict__title">${esc(v.title)}</h2><p class="ca-verdict__body">${esc(v.body)}</p></div>
  </div>`;

/** Tarjeta corta en la pestaña Entrenos. */
export function reviewTeaserHtml(r) {
  if (!r) return '';
  return `<section class="card ca-card ca-teaser">
    <div class="eyebrow">Cómo vas</div>
    ${verdictHtml(r.verdict)}
    <button type="button" class="btn btn--secondary btn--block" data-pg="review"><span>Ver tu evolución</span></button>
  </section>`;
}

function evolutionCharts(e) {
  const weeks = e.weeks;
  const first = weeks[0].monday;
  const x = (w) => daysBetween(first, w.monday);
  const xFormat = (v) => shortDay(weeks[Math.max(0, Math.min(weeks.length - 1, Math.round(v / 7)))].monday);
  const out = [];
  const hr = weeks.filter((w) => w.hr != null);
  if (hr.length >= 2) {
    const vals = hr.map((w) => w.hr);
    const delta = hr[hr.length - 1].hr - hr[0].hr;
    out.push(`<section class="card ca-card">
      <div class="ca-card__head"><div class="eyebrow">Tu pulso a ${esc(fmt.speed(e.refSpeed))} km/h</div><span class="ca-hint">más bajo es mejor</span></div>
      <div class="ca-chart-head"><b class="num">${hr[hr.length - 1].hr}</b><small>ppm</small>${delta ? `<span class="ca-mark ${delta < 0 ? 'is-good' : 'is-bad'}">${delta < 0 ? '−' : '+'}${Math.abs(delta)}</span><span class="ca-hint">desde ${esc(shortDay(hr[0].monday))}</span>` : ''}</div>
      <div class="pg-chart">${lineChart([{ name: 'Pulso', color: '#FF375F', points: hr.map((w) => ({ x: x(w), y: w.hr })) }], {
        height: 140, xFormat, yFormat: (v) => fmt.int(v),
        yMin: Math.floor((Math.min(...vals) - 5) / 5) * 5, yMax: Math.ceil((Math.max(...vals) + 5) / 5) * 5,
      })}</div>
    </section>`);
  }
  const sp = weeks.filter((w) => w.runSpeed != null);
  if (sp.length >= 2) {
    const vals = sp.map((w) => w.runSpeed);
    const delta = Math.round((vals[vals.length - 1] - vals[0]) * 10) / 10;
    out.push(`<section class="card ca-card">
      <div class="ca-card__head"><div class="eyebrow">Tu velocidad de Correr</div><span class="ca-hint">más alta es mejor</span></div>
      <div class="ca-chart-head"><b class="num">${esc(fmt.speed(vals[vals.length - 1]))}</b><small>km/h</small>${delta ? `<span class="ca-mark ${delta > 0 ? 'is-good' : 'is-bad'}">${delta > 0 ? '+' : '−'}${esc(fmt.speed(Math.abs(delta)))}</span><span class="ca-hint">desde ${esc(shortDay(sp[0].monday))}</span>` : ''}</div>
      <div class="pg-chart">${lineChart([{ name: 'Correr', color: 'var(--z-run)', points: sp.map((w) => ({ x: x(w), y: w.runSpeed })) }], {
        height: 120, xFormat, yFormat: (v) => fmt.speed(v), yMin: Math.floor(Math.min(...vals) - 0.5), yMax: Math.ceil(Math.max(...vals) + 0.5),
      })}</div>
    </section>`);
  }
  return out.join('');
}

function stripHtml(weeks) {
  return `<div class="ca-strip" role="img" aria-label="${weeks.length} semanas: ${weeks.map((w) => WEEK_STATE[w.state].text).join(', ')}">${weeks.map((w) => `<span class="ca-strip__w is-${esc(w.state)}${w.inProgress ? ' is-now' : ''}"></span>`).join('')}</div>
    <div class="ca-strip__legend">${['strong', 'normal', 'weak', 'off'].map((k) => `<span><i class="is-${k}"></i>${WEEK_STATE[k].text}</span>`).join('')}</div>`;
}

function weekRow(w, open) {
  const st = WEEK_STATE[w.state];
  const facts = [
    w.hr != null ? `<span>${icon('heart', 12)}<b class="num">${w.hr}</b> ppm</span>` : '',
    w.avgSpeed > 0 ? `<span><b class="num">${esc(fmt.speed(w.avgSpeed))}</b> km/h</span>` : '',
    w.km > 0 ? `<span><b class="num">${esc(fmt.dec1(w.km))}</b> km</span>` : '',
  ].filter(Boolean).join('');
  const body = w.sessions.length ? `
    ${w.reasons.length ? `<p class="ca-week__why">${esc(w.reasons.join(' · '))}</p>` : ''}
    ${w.state === 'weak' ? tagPicker(w) : ''}
    <div class="ca-week__classes">${w.classes.map((c) => `<button type="button" class="ca-class" data-href="#/history/${esc(encodeURIComponent(c.id))}">
      <span class="ca-class__day">${esc(shortDay(c.day))}</span>
      <span class="ca-class__main"><b>${esc(c.title)}</b><small class="num">${esc(fmt.dec1(c.km))} km · ${esc(fmt.speed(c.avgSpeed))} km/h${c.hrAvg ? ` · ${c.hrAvg} ppm` : ''}</small>${c.note ? `<em>«${esc(c.note)}»</em>` : ''}</span>
      ${c.feeling ? effortBars(FEEL_LEVEL[c.feeling]) : ''}
      ${c.score != null ? `<span class="ca-class__score num">${c.score}</span>` : ''}
      <span class="list__chev">${icon('chevron-right', 13)}</span>
    </button>`).join('')}</div>` : '';
  const head = `<span class="ca-week__state is-${esc(w.state)}">${icon(st.icon, 13, { stroke: 2.6 })}${esc(st.text)}</span>
    <span class="ca-week__main"><b>${esc(w.label)}${w.inProgress ? ' · en curso' : ''}</b>
      ${w.tag ? `<span class="ca-week__tag">${esc(WEEK_TAGS[w.tag])}</span>` : ''}
      ${facts ? `<span class="ca-week__facts">${facts}</span>` : ''}</span>`;
  if (!w.sessions.length) return `<div class="ca-week ca-week--off">${head}</div>`;
  return `<details class="ca-week" data-monday="${esc(w.monday)}"${open ? ' open' : ''}><summary>${head}<span class="ca-week__chev" aria-hidden="true">${icon('chevron-down', 14)}</span></summary>${body}</details>`;
}

function tagPicker(w) {
  return `<div class="ca-tags"><span>¿Qué te pasó?</span><div>${Object.entries(WEEK_TAGS).map(([k, label]) => `<button type="button" class="ca-tag${w.tag === k ? ' is-on' : ''}" aria-pressed="${w.tag === k}" data-week-tag="${esc(k)}" data-week-monday="${esc(w.monday)}">${esc(label)}</button>`).join('')}</div></div>`;
}

function diaryHtml(e) {
  const rows = e.weeks.filter((w) => !(w.inProgress && w.state === 'off')).reverse();
  const shown = rows.slice(0, 6);
  const rest = rows.slice(6);
  const list = (arr, first) => arr.map((w, i) => weekRow(w, first && i === 0)).join('');
  return `<section class="pg-section stack">
    ${sectionHeader('Semana a semana')}
    <div class="card ca-card ca-strip-card">${stripHtml(e.weeks)}${e.hasHr ? `<p class="ca-strip__note">El pulso de cada semana es el que llevas a ${esc(fmt.speed(e.refSpeed))} km/h, para poder compararlas.</p>` : ''}</div>
    <div class="ca-weeks">${list(shown, true)}</div>
    ${rest.length ? `<details class="pg-moremedals ca-more"><summary><span>Ver ${rest.length} ${rest.length === 1 ? 'semana más' : 'semanas más'}</span>${icon('chevron-right', 14)}</summary><div class="ca-weeks">${list(rest, false)}</div></details>` : ''}
  </section>`;
}

function evolutionHtml(e) {
  if (!e) return '';
  const c = e.compare;
  const compare = c ? `<section class="card ca-card">
    <div class="ca-card__head"><div class="eyebrow">Al empezar y ahora</div><span class="ca-hint">desde ${esc(c.since)}</span></div>
    <h3 class="ca-sub ca-sub--${esc(c.tone)}">${esc(c.title)}</h3>
    ${compareRows(c.rows)}
  </section>` : `<section class="card ca-card ca-soon"><div class="eyebrow">Al empezar y ahora</div><p>Cuando lleves cuatro semanas entrenando te enseño cuánto has cambiado desde el principio.</p></section>`;
  const moment = (kind, label, m, ic) => (m ? `<div class="ca-point ca-point--${kind}"><span aria-hidden="true">${icon(ic, 15, { stroke: 2.4 })}</span><div><small>${esc(label)}</small><b>${esc(m.title)}</b><p>${esc(m.text)}</p></div></div>` : '');
  const points = e.best || e.slump ? `<section class="card ca-card ca-points">${moment('best', 'Tu mejor momento', e.best, 'trophy')}${moment('slump', 'Tu último bache', e.slump, 'arrow-down')}</section>` : '';
  return `<section class="pg-section stack">${sectionHeader('Tu evolución')}${compare}${points}${evolutionCharts(e)}</section>${diaryHtml(e)}`;
}

function pillarsHtml(list) {
  return `<section class="pg-section stack">
    ${sectionHeader('Tus cinco claves')}
    <div class="ca-pillars">${list.map((p) => {
    const st = STATUS[p.status] || STATUS.neutral;
    return `<div class="card ca-pillar">
        <div class="ca-pillar__top"><span class="ca-pillar__name">${esc(p.label)}</span><span class="ca-st ca-st--${esc(p.status)}">${icon(st.icon, 12, { stroke: 2.6 })}${esc(st.text)}</span></div>
        <div class="ca-pillar__value num">${esc(p.value)}</div>
        ${p.body ? `<p class="ca-pillar__body">${esc(p.body)}</p>` : ''}
      </div>`;
  }).join('')}</div>
  </section>`;
}

function trendHtml(t) {
  if (!t) return '';
  const bars = t.points.map((p, i) => ({ label: String(parseKey(p.day).getDate()), value: p.score, ...(i === t.points.length - 1 ? { color: 'var(--accent)', highlight: true } : {}) }));
  const dl = t.delta;
  return `<section class="pg-section stack">
    ${sectionHeader('Cómo te salen las clases')}
    <div class="card ca-card">
      <div class="ca-chart-head"><b class="num">${t.avg}</b><small>de 100 de media</small>${dl ? `<span class="ca-mark ${dl > 0 ? 'is-good' : 'is-bad'}">${dl > 0 ? '+' : '−'}${Math.abs(dl)}</span>` : ''}</div>
      <div class="pg-chart">${barChart(bars, { height: 130, valueFormat: (v) => fmt.int(v) })}</div>
    </div>
  </section>`;
}

function typesHtml(t) {
  if (!t?.rows?.length) return '';
  const callouts = [
    t.best ? `<p class="ca-foot"><span aria-hidden="true">${icon('star', 15)}</span><span>Donde mejor te salen: <b>${esc(t.best.name)}</b>, ${t.best.score} de media.</span></p>` : '',
    t.hardest ? `<p class="ca-foot"><span aria-hidden="true">${icon('flame', 15)}</span><span>Las que más te cuestan: <b>${esc(t.hardest.name)}</b>, esfuerzo ${esc(fmt.dec1(t.hardest.rpe))} de 10.</span></p>` : '',
  ].filter(Boolean).join('');
  return `<section class="pg-section stack">
    ${sectionHeader('Por tipo de clase')}
    <div class="card ca-card">
      <div class="ca-types">${t.rows.map((r) => `<div class="ca-type">
        <span class="ca-type__name">${esc(r.name)}<small>${r.n} ${r.n === 1 ? 'clase' : 'clases'} · ${esc(fmt.dec1(r.km))} km</small></span>
        ${r.score != null ? `<span class="ca-type__bar" aria-hidden="true"><i style="width:${r.score}%"></i></span><b class="num">${r.score}</b>` : '<span class="ca-type__bar" aria-hidden="true"></span><b class="num">–</b>'}
      </div>`).join('')}</div>
      ${callouts ? `<div class="ca-callouts">${callouts}</div>` : ''}
    </div>
  </section>`;
}

function actionsHtml(list) {
  if (!list?.length) return '';
  return `<section class="pg-section stack">
    ${sectionHeader('Lo que haría ahora')}
    <div class="list ca-actions">${list.map((a) => {
    const tag = a.href ? `button type="button" data-href="${esc(a.href)}"` : 'div';
    const end = a.href ? 'button' : 'div';
    return `<${tag} class="list__row ca-action"><span class="ca-action__ic" aria-hidden="true">${icon(a.icon, 18)}</span><span class="ca-action__txt"><b>${esc(a.title)}</b><small>${esc(a.text)}</small></span>${a.href ? `<span class="list__chev">${icon('chevron-right', 14)}</span>` : ''}</${end}>`;
  }).join('')}</div>
  </section>`;
}

export function reviewTabHtml(r) {
  if (!r) return '';
  return [
    `<section class="card ca-card ca-teaser"><div class="eyebrow">Cómo vas</div>${verdictHtml(r.verdict)}</section>`,
    actionsHtml(r.actions),
    evolutionHtml(r.evolution),
    pillarsHtml(r.pillars),
    trendHtml(r.trend),
    typesHtml(r.types),
  ].filter(Boolean).map((p) => `<div class="ca-block">${p}</div>`).join('');
}
