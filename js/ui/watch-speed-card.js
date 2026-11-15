// RITMUP · tarjeta «Cadencia y zancada» del Resumen: lo que el Apple Watch mide bien mientras corres, la cadencia
// (pasos por minuto), y la zancada que sale de ella con la velocidad de la clase; en total y por velocidades.
// Hasta el 15 nov esta tarjeta era «Reloj frente a clase» y comparaba la velocidad que calculaba el reloj con la de la
// clase: se quitó porque esa velocidad no es fiable (el reloj la saca de la cadencia, y hay quien cambia de velocidad
// solo con la zancada). Aquí no sale ninguna velocidad ni distancia del reloj.
// Discreta: solo aparece si la sesión tiene cadencia, una línea por franja de velocidad y como mucho cinco. Las cuentas
// están en js/training/watch-speed.js (cadenceSummary); aquí solo se pinta. Estilos: css/player.css (.sm-wsp).
import { fmt, esc } from '../core/utils.js';
import { cadenceSummary } from '../training/watch-speed.js';

const m2 = (v) => `${v.toFixed(2).replace('.', ',')} m`;

/** HTML de la tarjeta, o '' si la sesión no trae cadencia del reloj. (El nombre se conserva: lo importa summary.js.) */
export function watchSpeedCardHtml(session, { index = 5 } = {}) {
  let c = null;
  try { c = cadenceSummary(session); } catch { c = null; }
  if (!c) return '';
  const rows = c.bands.slice(0, 5).map((b) => `
        <div class="sm-wsp__row" role="row">
          <span class="sm-wsp__band" role="cell">${esc(b.appKmh != null ? fmt.speed(b.appKmh) : b.label)}<small>km/h</small></span>
          <span class="sm-wsp__c num" role="cell">${b.cadence}</span>
          <span class="sm-wsp__s num" role="cell">${b.stride != null ? m2(b.stride) : '–'}</span>
        </div>`).join('');
  // Lo que se ve en los números, dicho en una frase (regla fija: corriendo, la cadencia cambia 6 pasos o menos en
  // 2 km/h o más)
  const note = c.flat
    ? 'Corriendo, tu cadencia casi no cambia: cuando vas más rápido, alargas la zancada.'
    : 'La cadencia la mide el reloj; la zancada sale de la velocidad de la clase.';
  return `
      <section class="card sm-card sm-wsp" style="--i:${index}">
        <div class="sm-card__head"><span class="sm-card__title">Cadencia y zancada</span><span class="sm-opt">${c.sim ? 'Simulado' : 'Apple Watch'}</span></div>
        <div class="sm-wsp__total">
          <span><small>Cadencia media</small><b class="num">${c.cadence}</b> pasos/min</span>
          ${c.stride != null ? `<span><small>Zancada media</small><b class="num">${m2(c.stride)}</b></span>` : ''}
        </div>
        ${rows ? `<div class="sm-wsp__table" role="table" aria-label="Cadencia y zancada por velocidades de la clase">
        <div class="sm-wsp__row sm-wsp__row--head" role="row"><span role="columnheader">Clase</span><span role="columnheader">Pasos/min</span><span role="columnheader">Zancada</span></div>${rows}
        </div>` : ''}
        <p class="sm-note sm-wsp__note">${note}</p>
      </section>`;
}
