// RITMUP · editor de «tu semana»: qué días corres y cuánto cada uno (bienvenida y Perfil › Mi semana).
import { stepper } from './components.js';
import { esc } from '../core/utils.js';
import { WEEKDAYS, DAY_MIN, DAY_MAX, DAY_STEP } from '../training/week-shape.js';

const LETTER = { 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 7: 'D' };
const NAME = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' };
const SAME = [20, 30, 45, 60];
const FRESH_DAY = 30;

const minutesIdOf = (w) => `wke-min-${w}`;

function noteOf(n) {
  if (n === 7) return 'Sin descanso: te alterno días suaves con solo uno o dos intensos.';
  if (n === 1) return 'Con un día a la semana mantienes la forma. Con dos o tres ya mejorarás.';
  return '';
}

/** Interior del editor (se repinta al marcar días; los minutos se actualizan solos en su control). */
export function weekEditorInner(days) {
  const on = WEEKDAYS.filter((w) => days[w] > 0);
  const chips = WEEKDAYS.map((w) => `<button type="button" class="wke__chip${days[w] > 0 ? ' is-on' : ''}" data-st="wke" data-wke-day="${w}" aria-pressed="${days[w] > 0}" aria-label="${esc(NAME[w])}">${LETTER[w]}</button>`).join('');
  const same = SAME.map((m) => `<button type="button" class="wke__same-btn${on.length && on.every((w) => days[w] === m) ? ' is-on' : ''}" data-st="wke" data-wke-same="${m}">${m}′</button>`).join('');
  const rows = on.map((w) => `<div class="list__row wke__row"><span class="list__title">${esc(NAME[w])}</span><span class="spacer"></span>${stepper({ id: minutesIdOf(w), value: days[w], step: DAY_STEP, min: DAY_MIN, max: DAY_MAX, unit: 'min', decimals: 0 })}</div>`).join('');
  const note = noteOf(on.length);
  return `<div class="wke__head"><b>¿Qué días corres?</b>${on.length < 7 ? '<button type="button" class="wke__link" data-st="wke" data-wke-all>Todos</button>' : ''}</div>
    <div class="wke__chips" role="group" aria-label="Días de entrenamiento">${chips}</div>
    <div class="wke__head wke__head--time"><b>¿Cuánto tiempo?</b></div>
    <div class="wke__same"><span>Igual todos</span><div class="wke__same-row">${same}</div></div>
    <div class="list wke__list">${rows}</div>
    ${note ? `<p class="wke__note">${esc(note)}</p>` : ''}`;
}

export const weekEditorHtml = (days) => `<div class="wke" data-wke>${weekEditorInner(days)}</div>`;

/**
 * Aplica un toque sobre el editor. → null si no era del editor, o los días nuevos.
 * Siempre queda al menos un día marcado.
 */
export function weekEditorTap(el, days) {
  if (!el?.closest?.('[data-wke]') && !el?.matches?.('[data-wke-day],[data-wke-same],[data-wke-all]')) return null;
  const next = { ...days };
  const on = WEEKDAYS.filter((w) => next[w] > 0);
  if (el.dataset.wkeDay) {
    const w = Number(el.dataset.wkeDay);
    if (next[w] > 0) {
      if (on.length === 1) return next;        // el último día no se puede quitar
      next[w] = 0;
    } else next[w] = on.length ? next[on[on.length - 1]] : FRESH_DAY;
    return next;
  }
  if (el.dataset.wkeSame) {
    for (const w of on) next[w] = Number(el.dataset.wkeSame);
    return next;
  }
  if ('wkeAll' in el.dataset) {
    const m = on.length ? Math.min(...on.map((w) => next[w])) : FRESH_DAY;
    for (const w of WEEKDAYS) if (!(next[w] > 0)) next[w] = m;
    return next;
  }
  return null;
}

/** Día al que corresponde un control de minutos, o 0 si no es del editor. */
export function weekEditorDayOf(id) {
  const m = /^wke-min-([1-7])$/.exec(String(id || ''));
  return m ? Number(m[1]) : 0;
}
