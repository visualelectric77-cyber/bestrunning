// RITMUP · intro de arranque «Curva» (≈ 2,45 s, una vez por lanzamiento). Negro puro (empalma con la pantalla de
// arranque nativa), la «r» se dibuja siguiendo la curva de la pista, un corredor ember recorre su calle interior y la
// enciende, florece al llegar, entran i·t·m·u·p, un reflejo cruza la marca y todo se funde con Hoy.
// Sin sonido ni vibración (no toca la sesión de audio de la app nativa); solo transform, opacity y stroke-dashoffset.
// La geometría vive en ./intro-logo.js (generado). Toca en cualquier sitio para saltarla.
// Fuerza: ?intro=1 · Sin intro: ?nointro (o ?cap), navigator.webdriver, reloj virtual del grabador, clase en curso.
import { loadActiveSession, activeSessionSavedAt } from '../core/store.js';
import { LOGO } from './intro-logo.js';

const FLAG = 'ritmup.intro';
const RESUME_MAX_MS = 3 * 3600 * 1000;
const NS = 'http://www.w3.org/2000/svg';

/* Tiempos (ms desde que se monta) */
const T_DRAW = [200, 950];    // la r se dibuja
const T_RUN = [550, 1250];    // el corredor ember
const T_BLOOM = [1220, 1720]; // destello al llegar
const T_END = 2500;           // fuera del DOM

function params() {
  try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); }
}

function shouldPlay() {
  const p = params();
  if (p.get('intro') === '1') return true;
  if (p.has('nointro') || p.has('cap') || p.has('capture') || p.has('shot')) return false;
  if (navigator.webdriver || window.__vc) return false; // capturas automáticas y pruebas
  if (/^#\/(play|summary)\b/.test(location.hash || '')) return false;
  try {
    if (sessionStorage.getItem(FLAG)) return false;
  } catch { /* sin storage: se muestra */ }
  try {
    if (loadActiveSession()) {
      const at = activeSessionSavedAt();
      if (at && Date.now() - at <= RESUME_MAX_MS) return false; // la app va a ofrecer «Reanudar»
    }
  } catch { /* sin sesión guardada */ }
  return true;
}

const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const span = (t, [a, b]) => clamp((t - a) / (b - a));
const inOutCubic = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - 4 * (1 - x) ** 3);
const outCubic = (x) => 1 - (1 - x) ** 3;

function markup(reduced) {
  const [x, y, w, h] = LOGO.viewBox;
  const vb = `${x} ${y} ${w} ${h}`;
  const r = LOGO.r;
  const E = LOGO.ember;
  const pad = 80;
  const box = `x="${x - pad}" y="${y - pad}" width="${w + 2 * pad}" height="${h + 2 * pad}"`;
  const lettersClip = LOGO.letters.map((l) => `<path transform="translate(${l.x} 0)" d="${l.d}"/>`).join('');
  const letters = LOGO.letters.map((l, i) =>
    `<svg class="ri-l" style="--i:${i}" viewBox="${vb}" aria-hidden="true" focusable="false"><path class="ri-ink" fill-rule="evenodd" transform="translate(${l.x} 0)" d="${l.d}"/></svg>`,
  ).join('');
  // Banda del reflejo: borde de luz fino que deja la marca en blanco puro tras de sí
  const sweepW = w + 260;
  return `<div class="ri-pos" style="--cy:${(((50 - y) / h) * 100).toFixed(3)}%;--ar:${w} / ${h};--rise:${((10 / h) * 100).toFixed(3)}%">
  <div class="ri-stage">
    <svg class="ri-mark" viewBox="${vb}" aria-hidden="true" focusable="false">
      <defs>
        <mask id="ri-m-r" maskUnits="userSpaceOnUse" ${box}><path class="ri-dash" data-k="r" d="${r.spine}" fill="none" stroke="#fff" stroke-width="${r.spineWidth}"/></mask>
        <mask id="ri-m-e" maskUnits="userSpaceOnUse" ${box}><path class="ri-dash" data-k="e" d="${r.emberSpine}" fill="none" stroke="#fff" stroke-width="${r.spineWidth * 0.6}"/></mask>
        <radialGradient id="ri-g-run"><stop offset="0" stop-color="#FFB08A" stop-opacity="0.95"/><stop offset="0.35" stop-color="${E}" stop-opacity="0.55"/><stop offset="1" stop-color="${E}" stop-opacity="0"/></radialGradient>
        <radialGradient id="ri-g-bloom"><stop offset="0" stop-color="#FF9466" stop-opacity="0.9"/><stop offset="0.4" stop-color="${E}" stop-opacity="0.38"/><stop offset="1" stop-color="${E}" stop-opacity="0"/></radialGradient>
      </defs>
      <g mask="url(#ri-m-r)">
        <path class="ri-ink" fill-rule="evenodd" d="${r.white}"/>
        <path fill="${E}" fill-opacity="0.2" d="${r.ember}"/>
      </g>
      <path mask="url(#ri-m-e)" fill="${E}" d="${r.ember}"/>
      <path class="ri-trail" data-l="0.34" d="${r.emberSpine}" fill="none" stroke="${E}" stroke-opacity="0.5" stroke-width="${r.spineWidth * 0.22}" stroke-linecap="round"/>
      <path class="ri-trail" data-l="0.16" d="${r.emberSpine}" fill="none" stroke="#FFC3A6" stroke-opacity="0.9" stroke-width="${r.spineWidth * 0.11}" stroke-linecap="round"/>
      <circle class="ri-bloom" r="54" fill="url(#ri-g-bloom)" opacity="0"/>
      <g class="ri-run" opacity="0">
        <circle r="17" fill="url(#ri-g-run)"/>
        <rect x="-7" y="-2.9" width="14" height="5.8" rx="2.9" fill="#FFF4EE"/>
      </g>
    </svg>
    ${letters}
    ${reduced ? '' : `<svg class="ri-sheen" viewBox="${vb}" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="ri-clip"><path d="${r.white}"/>${lettersClip}</clipPath>
        <linearGradient id="ri-g-sheen" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#fff"/><stop offset="${((sweepW - 64) / sweepW).toFixed(4)}" stop-color="#fff"/>
          <stop offset="${((sweepW - 30) / sweepW).toFixed(4)}" stop-color="#fff" stop-opacity="0.85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <g clip-path="url(#ri-clip)"><rect class="ri-sweep" style="--x0:${x - sweepW - 20}px;--x1:${x - 40}px" x="0" y="${y - 40}" width="${sweepW}" height="${h + 80}" fill="url(#ri-g-sheen)"/></g>
    </svg>`}
  </div>
</div>`;
}

/** Monta la intro encima de todo (la app se pinta debajo). Nunca lanza: ante cualquier fallo se retira. */
export function playIntro() {
  let el = null;
  let raf = 0;
  const timers = [];
  // Si arranca una clase durante la intro (p. ej. desde el reloj), la intro se quita al instante
  const onRoute = () => { if (/^#\/play\b/.test(location.hash || '')) remove(); };
  const remove = () => {
    window.removeEventListener('hashchange', onRoute);
    timers.forEach(clearTimeout);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    el?.remove();
    el = null;
  };
  try {
    if (!shouldPlay()) return;
    try { sessionStorage.setItem(FLAG, '1'); } catch { /* nada */ }
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el = document.createElement('div');
    el.id = 'ritmup-intro';
    el.className = reduced ? 'ri ri--still' : 'ri';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'RITMUP');
    el.innerHTML = markup(reduced);
    // Saltar con un toque: fundido corto y fuera
    el.addEventListener('pointerdown', () => {
      if (!el || el.dataset.out) return;
      el.dataset.out = '1';
      try {
        const from = getComputedStyle(el).opacity;
        el.animate([{ opacity: from }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
        timers.push(setTimeout(remove, 240));
      } catch { remove(); }
    }, { passive: true });
    document.body.appendChild(el);
    window.addEventListener('hashchange', onRoute);
    timers.push(setTimeout(remove, 3500)); // red de seguridad

    const dashR = el.querySelector('.ri-dash[data-k="r"]');
    const dashE = el.querySelector('.ri-dash[data-k="e"]');
    const lenR = dashR.getTotalLength();
    const lenE = dashE.getTotalLength();
    const dash = (p, len, prog) => {
      p.setAttribute('stroke-dasharray', `${len + 1} ${len + 2}`);
      p.setAttribute('stroke-dashoffset', String((1 - prog) * (len + 1)));
    };
    if (reduced) {
      dash(dashR, lenR, 1);
      dash(dashE, lenE, 1);
      el.querySelectorAll('.ri-trail').forEach((t) => t.remove());
      timers.push(setTimeout(remove, 1750));
      return;
    }

    const spineE = el.querySelector('.ri-trail');
    const trails = [...el.querySelectorAll('.ri-trail')].map((t) => ({ t, l: Number(t.dataset.l) * lenE }));
    const run = el.querySelector('.ri-run');
    const bloom = el.querySelector('.ri-bloom');
    const end = spineE.getPointAtLength(lenE);
    bloom.setAttribute('cx', end.x.toFixed(2));
    bloom.setAttribute('cy', end.y.toFixed(2));
    dash(dashR, lenR, 0);
    dash(dashE, lenE, 0);
    trails.forEach(({ t }) => t.setAttribute('opacity', '0'));

    const t0 = performance.now();
    const frame = (now) => {
      raf = 0;
      if (!el) return;
      try {
        const t = now - t0;
        // 1) la r se dibuja por la curva
        dash(dashR, lenR, inOutCubic(span(t, T_DRAW)));
        // 2) el corredor recorre la calle ember y la enciende tras de sí
        const q = span(t, T_RUN);
        const k = inOutCubic(q);
        const s = k * lenE;
        dash(dashE, lenE, k);
        const a = spineE.getPointAtLength(s);
        const b = spineE.getPointAtLength(Math.min(lenE, s + 0.6));
        const c = spineE.getPointAtLength(Math.max(0, s - 0.6));
        const ang = (Math.atan2(b.y - c.y, b.x - c.x) * 180) / Math.PI;
        const runOp = q <= 0 ? 0 : Math.min(1, q / 0.12) * (q < 1 ? 1 : 0);
        const fade = clamp(1 - (t - T_RUN[1]) / 140);
        run.setAttribute('opacity', (q < 1 ? runOp : fade).toFixed(3));
        run.setAttribute('transform', `translate(${a.x.toFixed(2)} ${a.y.toFixed(2)}) rotate(${ang.toFixed(1)})`);
        for (const { t: tr, l } of trails) {
          const len = Math.min(l, s);
          tr.setAttribute('stroke-dasharray', `${len.toFixed(2)} ${lenE + 4}`);
          tr.setAttribute('stroke-dashoffset', String(-(s - len)));
          tr.setAttribute('opacity', (q <= 0 ? 0 : q < 1 ? Math.min(1, q / 0.12) : fade).toFixed(3));
        }
        // 3) destello ember al llegar
        const bq = span(t, T_BLOOM);
        const bo = bq <= 0 || bq >= 1 ? 0 : bq < 0.16 ? bq / 0.16 : 1 - outCubic((bq - 0.16) / 0.84);
        bloom.setAttribute('opacity', bo.toFixed(3));
        bloom.setAttribute('transform', `translate(${end.x} ${end.y}) scale(${(0.35 + 1.05 * outCubic(bq)).toFixed(3)}) translate(${-end.x} ${-end.y})`);
        if (t < T_BLOOM[1] + 40) raf = requestAnimationFrame(frame);
      } catch {
        remove();
      }
    };
    raf = requestAnimationFrame(frame);
    timers.push(setTimeout(remove, T_END));
  } catch {
    remove();
  }
}
