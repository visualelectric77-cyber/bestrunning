// RITMUP · comportamiento de Liquid Glass: la gota de la barra de pestañas (se desliza, se aplasta al viajar y se
// arrastra con el dedo), la luz bajo el dedo en los botones de cristal y el estirón del control segmentado.
// Solo cambia transform y variables CSS: nada de esto se ejecuta durante una clase.
import { haptic } from '../core/haptics.js';

const DRAG_FROM = 8;     // px antes de considerar que arrastras
const MOVE_MS = 150;     // lo que dura el aplastamiento al salir disparada
const RUBBER = 0.28;

function initTabLens() {
  const inner = document.querySelector('#tabbar .tabbar__inner');
  const lens = inner?.querySelector('.tabbar__lens');
  if (!inner || !lens) return;
  const items = [...inner.querySelectorAll('.tabbar__item')];
  let lastX = null;
  let moveTimer = 0;
  let settleTimer = 0;
  let g = null;           // gesto en curso
  let suppress = false;

  const place = (x, width) => {
    lens.style.setProperty('--lx', `${Math.round(x * 100) / 100}px`);
    lens.style.setProperty('--lw', `${width}px`);
  };
  const instantly = (fn) => {
    lens.classList.add('is-instant');
    fn();
    void lens.offsetWidth;
    lens.classList.remove('is-instant');
  };
  const stretch = () => {
    inner.classList.add('is-moving');
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => inner.classList.remove('is-moving'), MOVE_MS);
  };
  const sync = (animate = true) => {
    const active = items.find((it) => it.classList.contains('is-active'));
    lens.classList.toggle('is-off', !active);
    if (!active) return;
    const x = active.offsetLeft;
    const apply = () => place(x, active.offsetWidth);
    if (!animate || lastX === null) instantly(apply);
    else {
      if (x !== lastX) stretch();
      apply();
    }
    lastX = x;
  };

  const nearest = (center) => items.reduce((a, b) => (
    Math.abs(b.offsetLeft + b.offsetWidth / 2 - center) < Math.abs(a.offsetLeft + a.offsetWidth / 2 - center) ? b : a
  ));
  const setOver = (it) => {
    if (g.over === it) return;
    g.over?.classList.remove('is-over');
    g.over = it;
    it.classList.add('is-over');
    haptic('selection');
  };
  const clearGesture = () => {
    if (!g) return;
    g.over?.classList.remove('is-over');
    inner.classList.remove('is-pressed', 'is-dragging');
    g = null;
  };

  inner.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button > 0) return;
    const item = e.target.closest?.('.tabbar__item');
    if (!item) return;
    clearTimeout(settleTimer);
    const left = inner.getBoundingClientRect().left;
    g = { id: e.pointerId, x0: e.clientX, left, offset: e.clientX - left - item.offsetLeft, width: item.offsetWidth, over: null, dragging: false };
    inner.classList.add('is-pressed');
    place(item.offsetLeft, item.offsetWidth);   // responde al tocar, no al soltar
  });

  inner.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    if (!g.dragging) {
      if (Math.abs(e.clientX - g.x0) < DRAG_FROM) return;
      g.dragging = true;
      inner.classList.add('is-dragging');
      try { inner.setPointerCapture(e.pointerId); } catch { /* nada */ }
    }
    const min = items[0].offsetLeft;
    const max = items[items.length - 1].offsetLeft;
    let x = e.clientX - g.left - g.offset;
    if (x < min) x = min - (min - x) * RUBBER;
    else if (x > max) x = max + (x - max) * RUBBER;
    place(x, g.width);
    setOver(nearest(x + g.width / 2));
  });

  const finish = (e) => {
    if (!g || e.pointerId !== g.id) return;
    const { dragging, over } = g;
    clearGesture();
    if (dragging) {
      suppress = true;              // el clic nativo de este gesto no debe contar
      setTimeout(() => { suppress = false; }, 80);
      if (e.type !== 'pointercancel' && over && !over.classList.contains('is-active')) over.click();
      else sync();
    } else if (e.type === 'pointercancel') sync();
    else {
      // Si la pestaña tocada no llega a abrirse, la gota vuelve a la activa
      settleTimer = setTimeout(sync, 420);
    }
  };
  inner.addEventListener('pointerup', finish);
  inner.addEventListener('pointercancel', finish);
  inner.addEventListener('click', (e) => {
    if (suppress && e.isTrusted) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  window.addEventListener('br:route', () => {
    clearTimeout(settleTimer);
    sync();
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => sync(false)).observe(inner);
  sync(false);
}

/** La luz nace donde apoyas el dedo. */
function initTouchLight() {
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.('.navbar__btn, .navbar .btn-icon, .navbar__back, .sheet__close');
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    el.style.setProperty('--px', `${Math.round(((e.clientX - r.left) / r.width) * 100)}%`);
    el.style.setProperty('--py', `${Math.round(((e.clientY - r.top) / r.height) * 100)}%`);
  }, { passive: true, capture: true });
}

/** El pulgar del segmentado se estira al salir hacia su nueva posición. */
function initSegmentStretch() {
  document.addEventListener('click', (e) => {
    const opt = e.target.closest?.('[data-segmented] .segmented__opt');
    if (!opt || opt.classList.contains('is-active')) return;
    const seg = opt.closest('[data-segmented]');
    seg.classList.add('is-moving');
    setTimeout(() => seg.classList.remove('is-moving'), MOVE_MS);
  }, true);
}

let started = false;
export function initLiquid() {
  if (started || typeof document === 'undefined') return;
  started = true;
  initTabLens();
  initTouchLight();
  initSegmentStretch();
}
