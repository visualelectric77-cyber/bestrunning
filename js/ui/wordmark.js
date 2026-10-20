// RITMUP · logotipo «Curva» en línea (SVG) para la interfaz. La geometría vive en ./intro-logo.js (generado por
// docs/brand-ritmup/curva/build.mjs): aquí solo se monta. Blanco (currentColor) con la calle interior de la «r» en ember.
import { LOGO } from './intro-logo.js';

const [VX, VY, VW, VH] = LOGO.viewBox;

/** Proporción del logotipo (ancho / alto de su caja, con ascendentes y descendente). */
export const WORDMARK_RATIO = VW / VH;

/**
 * Logotipo como <svg> en línea. El ancho lo pone el CSS (`cls`); el alto sale de la proporción.
 * `label` vacío = decorativo (aria-hidden), p. ej. cuando el texto ya está al lado para lectores de pantalla.
 */
export function wordmarkSvg({ cls = '', label = 'RITMUP' } = {}) {
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  const letters = LOGO.letters.map((l) => `<path fill-rule="evenodd" transform="translate(${l.x} 0)" d="${l.d}"/>`).join('');
  return `<svg class="wordmark${cls ? ` ${cls}` : ''}" viewBox="${VX} ${VY} ${VW} ${VH}" ${a11y} focusable="false" fill="currentColor">`
    + `<path fill-rule="evenodd" d="${LOGO.r.white}"/><path fill="${LOGO.ember}" d="${LOGO.r.ember}"/>${letters}</svg>`;
}
