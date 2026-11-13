// RITMUP · tarjeta «Reloj frente a clase» del Resumen: lo que el Apple Watch calculó que corrías, comparado con lo que
// marcó la clase, en total y por franjas de velocidad, con la cadencia y la zancada. Discreta: solo sale si la sesión
// tiene datos del reloj (session.watchSpeed), una línea por franja y como mucho cinco. Las cuentas están en
// js/training/watch-speed.js (watchCompare); aquí solo se pinta. Estilos: css/player.css (.sm-wsp).
import { fmt, esc } from '../core/utils.js';
import { watchCompare } from '../training/watch-speed.js';

const pct = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${String(Math.abs(v)).replace('.', ',')} %`;
const m2 = (v) => `${v.toFixed(2).replace('.', ',')} m`;

/** HTML de la tarjeta, o '' si la sesión no trae nada del reloj. */
export function watchSpeedCardHtml(session, { index = 5 } = {}) {
  let c = null;
  try { c = watchCompare(session); } catch { c = null; }
  if (!c) return '';
  const rows = c.bands.slice(0, 5).map((b) => `
        <div class="sm-wsp__row" role="row">
          <span class="sm-wsp__band" role="cell">${esc(b.appKmh != null ? fmt.speed(b.appKmh) : b.label)}<small>km/h</small></span>
          <span class="sm-wsp__w num" role="cell">${b.watchKmh != null ? `≈${esc(fmt.speed(b.watchKmh))}` : '–'}</span>
          <span class="sm-wsp__d num${Math.abs(b.diffPct) >= 5 ? ' is-far' : ''}" role="cell">${pct(b.diffPct)}</span>
          <span class="sm-wsp__c num" role="cell">${b.cadence ? `${b.cadence}${b.stride ? ` · ${m2(b.stride)}` : ''}` : '–'}</span>
        </div>`).join('');
  const cadence = c.cadence
    ? `<p class="sm-wsp__cad">Cadencia media <b class="num">${c.cadence}</b> pasos/min${c.stride ? ` · zancada <b class="num">${m2(c.stride)}</b>` : ''}</p>`
    : '';
  // Qué ha enseñado esta clase a la corrección (se aprende de todas, en sus tramos estables)
  const list = c.learned.length > 1 ? `${c.learned.slice(0, -1).join(', ')} y ${c.learned[c.learned.length - 1]}` : c.learned[0];
  const learned = c.learned.length
    ? `De esta clase RITMUP ha aprendido tu corrección a ${esc(list)} km/h.`
    : 'RITMUP aprende tu corrección por velocidades con cada clase.';
  return `
      <section class="card sm-card sm-wsp" style="--i:${index}">
        <div class="sm-card__head"><span class="sm-card__title">Reloj frente a clase</span><span class="sm-opt">${c.sim ? 'Simulado' : 'Apple Watch'}</span></div>
        <div class="sm-wsp__total">
          <span><small>Clase</small><b class="num">${esc(fmt.km(c.appKm))}</b> km</span>
          <span><small>Reloj</small><b class="num">≈${esc(fmt.km(c.watchKm))}</b> km</span>
          <span><small>Diferencia</small><b class="num">${pct(c.diffPct)}</b></span>
        </div>
        ${rows ? `<div class="sm-wsp__table" role="table" aria-label="Reloj frente a clase por velocidades">
        <div class="sm-wsp__row sm-wsp__row--head" role="row"><span role="columnheader">Clase</span><span role="columnheader">Reloj</span><span role="columnheader">Dif.</span><span role="columnheader">Pasos/min · zancada</span></div>${rows}
        </div>` : ''}
        ${cadence}
        <p class="sm-note sm-wsp__note">Orientativo: el reloj lo calcula por el braceo, no lo mide de la cinta. ${learned}</p>
      </section>`;
}
