// BestRunning · motion graphics del HUD de retransmisión (§16). Módulo aislado: el reproductor lo carga en dinámico
// y, si falla, el HUD sigue igual (cada llamada va en try/catch en player.js y aquí).
// - Cifras rodantes (velocidad gigante y cuenta atrás del tramo): cada dígito que cambia entra deslizando con muelle
//   (~280 ms) y el anterior sale; solo transform/opacity, sin recortes ni filtros (la sombra del número sigue intacta).
//   El texto real del nodo es siempre el valor actual (el dígito saliente vive en ::before → attr(data-o)).
// - «En cola» (on deck): 10 s antes del cambio, una tira fina entra encima del lower third (SIGUIENTE · zona · km/h ·
//   duración) con barra del color de la zona y su propio temporizador; en el cambio baja y se acopla al lower third
//   mientras el contenido anterior sale (relevo limpio con una línea fina del color de la zona).
// - Últimos 10 s: la barra del tramo se convierte en 10 marcas que se apagan una por segundo (con los pitidos).
// - Subtítulos del coach: una línea pequeña encima del lower third (nunca sobre datos); state.visuals.captions.
// - Cabecera de apertura (durante el 3-2-1) y cierre con recuento antes del resumen. Todo saltable con un toque.
// Sin destellos, sin rayos, sin desenfoques, sin máscaras sobre la escena (§15.3). prefers-reduced-motion: fundidos.
import { ZONES } from '../training/levels.js';

const reduced = () => {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
const zc = (z) => ZONES[z]?.color || '#ff6a1a';
const digitsOf = (s) => Number(String(s).replace(/[^\d]/g, '')) || 0;
const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clockOf = (sec) => {
  const t = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const dec = (v, n) => (Number(v) || 0).toFixed(n).replace('.', ',');
const TICKS = 10;

/** Perfil de la clase en SVG (barras del color de su zona). lit=false → barras tenues (capa base del cierre). */
function profileSvg(segments, { h = 56, gap = 0.6, cls = '', lit = true } = {}) {
  const segs = (Array.isArray(segments) ? segments : []).filter((s) => s && Number(s.sec) > 0);
  const total = segs.reduce((a, s) => a + Number(s.sec), 0) || 1;
  const sp = segs.map((s) => Number(s.speed) || 0).filter((v) => v > 0);
  const maxS = Math.max(1, ...sp);
  const base = Math.max(0, (sp.length ? Math.min(...sp) : 0) * 0.6);
  const W = 1000;
  let x = 0;
  let out = '';
  segs.forEach((s, i) => {
    const w = (Number(s.sec) / total) * W;
    const f = maxS > base ? ((Number(s.speed) || 0) - base) / (maxS - base) : 1;
    const bh = Math.max(h * 0.16, h * (0.22 + 0.78 * Math.max(0, Math.min(1, f))));
    const fill = lit ? zc(s.zone) : 'rgba(255,255,255,0.16)';
    out += `<rect class="mo-pb" style="--i:${i};--n:${segs.length}" x="${(x + gap / 2).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(0.6, w - gap).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.2" fill="${fill}"/>`;
    x += w;
  });
  return `<svg class="${cls}" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${out}</svg>`;
}

export function createMotion(root, refs = {}, opts = {}) {
  const hud = refs.hud || root?.querySelector?.('.hud');
  const lt = refs.lt || root?.querySelector?.('.hud-lt');
  if (!root || !hud || !lt) return null;
  const captionsOn = opts.captions !== false;
  const timers = new Set();
  const offs = [];
  let dead = false;
  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); if (!dead) { try { fn(); } catch { /* nada */ } } }, ms);
    timers.add(id);
    return id;
  };
  const clear = (id) => { if (id) { clearTimeout(id); timers.delete(id); } };
  // La tira y el subtítulo cambian la composición: el reproductor vuelve a medir el HUD para la escena 3D
  const layout = () => { try { opts.onLayout?.(); } catch { /* nada */ } };
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
  root.classList.add('has-mo');

  /* ───────── Cifras rodantes ───────── */
  const rollers = new WeakMap();
  let quietUntil = 0;
  function roll(el, text, dir = 0) {
    if (!el) return false;
    const str = String(text ?? '');
    let st = rollers.get(el);
    if (!st) {
      st = { text: el.textContent || '', slots: [], flips: [] };
      rollers.set(el, st);
      el.classList.add('mo-roll');
    }
    if (st.text === str && st.slots.length) return true;
    const old = st.text;
    // durante el relevo del lower third, su cuenta atrás entra con el bloque (sin rodar encima)
    const quiet = performance.now() < quietUntil && lt.contains(el);
    const anim = !quiet && !reduced() && old !== '' && root.isConnected;
    const d = dir || (digitsOf(str) < digitsOf(old) ? -1 : 1);
    // si alguien reescribió el nodo (textContent), las ranuras se rehacen
    if (st.slots.length && (st.slots[0].parentNode !== el || el.childNodes.length !== st.slots.length)) {
      st.slots = [];
      st.text = el.textContent || '';
    }
    if (st.slots.length !== str.length) {
      el.textContent = '';
      st.slots = [];
      st.flips = [];
      for (let i = 0; i < str.length; i++) {
        const s = document.createElement('span');
        s.className = 'mo-d';
        const g = document.createElement('span');
        g.className = 'mo-g';
        s.appendChild(g);
        el.appendChild(s);
        st.slots.push(s);
        st.flips.push(0);
      }
    }
    const off = old.length - str.length;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const s = st.slots[i];
      const g = s.firstChild;
      if (g.textContent === ch) continue;
      const oc = old[i + off] ?? '';
      g.textContent = ch;
      if (anim && oc !== ch) {
        s.setAttribute('data-o', oc);
        st.flips[i] ^= 1;
        s.classList.remove('is-u0', 'is-u1', 'is-d0', 'is-d1');
        s.classList.add(`is-${d < 0 ? 'd' : 'u'}${st.flips[i]}`);
      } else {
        s.removeAttribute('data-o');
        s.classList.remove('is-u0', 'is-u1', 'is-d0', 'is-d1');
      }
    }
    st.text = str;
    return true;
  }

  /* ───────── Capa encima del lower third: «en cola» + subtítulos ───────── */
  const deck = document.createElement('div');
  deck.className = 'mo-deck';
  deck.setAttribute('aria-hidden', 'true');
  deck.innerHTML = `<i class="mo-deck__bar"></i><span class="mo-deck__lbl">Siguiente</span><span class="mo-deck__zone"></span><b class="mo-deck__sp num"></b><span class="mo-deck__u">km/h</span><span class="mo-deck__dur num"></span><i class="mo-deck__timer"><i></i></i>`;
  const dk = {
    zone: deck.querySelector('.mo-deck__zone'),
    sp: deck.querySelector('.mo-deck__sp'),
    dur: deck.querySelector('.mo-deck__dur'),
    timer: deck.querySelector('.mo-deck__timer > i'),
  };
  const cap = document.createElement('div');
  cap.className = 'mo-cap';
  cap.setAttribute('aria-hidden', 'true');
  cap.innerHTML = '<span class="mo-cap__t"></span>';
  const capT = cap.firstChild;
  hud.appendChild(deck);
  hud.appendChild(cap);

  // Marcas de los últimos 10 s y línea de relevo dentro del lower third
  const bar = lt.querySelector('.hud-lt__bar');
  let ticks = null;
  const tickEls = [];
  if (bar) {
    ticks = document.createElement('span');
    ticks.className = 'mo-ticks';
    ticks.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < TICKS; i++) {
      const t = document.createElement('i');
      if (i >= TICKS - 3) t.className = 'is-last';
      ticks.appendChild(t);
      tickEls.push(t);
    }
    bar.appendChild(ticks);
  }
  const wipe = document.createElement('i');
  wipe.className = 'mo-wipe';
  wipe.setAttribute('aria-hidden', 'true');
  lt.appendChild(wipe);

  let deckOn = false;
  let deckKey = '';
  let deckTimerQ = -1;
  let ticksOn = false;
  let lit = -1;
  let capOffPx = -1;

  function setDeckVisible(v) {
    if (deckOn === v) return;
    deckOn = v;
    deck.classList.toggle('is-on', v);
    // mientras la tira está fuera, el bloque SIGUIENTE del lower third se funde (es ese mismo dato, «levantado»)
    lt.classList.toggle('mo-is-deck', v);
    syncCapOffset();
    layout();
  }
  function syncCapOffset() {
    const px = deckOn ? Math.round((deck.offsetHeight || 34) + 6) : 0;
    if (px === capOffPx) return;
    capOffPx = px;
    cap.style.setProperty('--mo-capoff', `${px}px`);
  }

  /** Cada tick del motor (barato: solo escribe cuando algo cambia). */
  function tick(s) {
    if (dead || !s) return;
    const seg = s.segment;
    const next = s.nextSegment;
    const running = s.status === 'running';
    const left = Math.ceil((Number(s.segRemaining) || 0) - 1e-6);
    const soon = !!(seg && next && left <= TICKS && left >= 1 && (running || s.status === 'paused'));
    // «En cola»
    if (soon) {
      const key = `${s.segIndex}|${next.zone}|${next.speed}|${next.sec}`;
      if (key !== deckKey) {
        deckKey = key;
        const isStage = opts.isTest && Number(next.stage) > 0;
        dk.zone.textContent = isStage ? `Escalón ${next.stage}` : (ZONES[next.zone]?.short || ZONES[next.zone]?.name || '');
        dk.sp.textContent = dec(next.speed, 1);
        dk.dur.textContent = clockOf(next.sec);
        deck.style.setProperty('--dc', zc(next.zone));
      }
      const q = Math.round(Math.max(0, Math.min(1, (Number(s.segRemaining) || 0) / TICKS)) * 200) / 200;
      if (q !== deckTimerQ) { deckTimerQ = q; dk.timer.style.transform = `scaleX(${q})`; }
    }
    setDeckVisible(soon && running);
    // Marcas
    const tOn = soon && running;
    if (tOn !== ticksOn) {
      ticksOn = tOn;
      lt.classList.toggle('mo-is-ticks', tOn);
      lit = -1;
    }
    if (tOn && left !== lit) {
      lit = left;
      for (let i = 0; i < TICKS; i++) tickEls[i].classList.toggle('is-off', i >= left);
    }
  }

  /* ───────── Relevo en el cambio de tramo ───────── */
  let ghost = null;
  let ghostT = 0;
  function beforeSegment() {
    if (dead || reduced()) return;
    try {
      const head = lt.querySelector('.hud-lt__head:not(.mo-old)');
      if (!head || root.classList.contains('is-cd')) return;
      if (ghost) { ghost.remove(); ghost = null; clear(ghostT); }
      ghost = head.cloneNode(true);
      ghost.classList.remove('mo-in', 'mo-in2');
      ghost.classList.add('mo-old');
      if (deckOn) ghost.classList.add('mo-nx');
      // la copia saliente es estática: sin rodar cifras (si no, el clon reinicia la animación del dígito y se dobla)
      ghost.querySelectorAll('.mo-d').forEach((d) => { d.classList.remove('is-u0', 'is-u1', 'is-d0', 'is-d1'); d.removeAttribute('data-o'); });
      ghost.setAttribute('aria-hidden', 'true');
      ghost.querySelectorAll('[data-ref]').forEach((n) => n.removeAttribute('data-ref'));
      ghost.removeAttribute('data-ref');
    } catch { ghost = null; }
  }
  function afterSegment(info = {}) {
    if (dead) return;
    const head = lt.querySelector('.hud-lt__head:not(.mo-old)');
    const docking = deckOn;
    deckKey = '';
    if (!info.silent) quietUntil = performance.now() + 450;
    if (ghost && head && !info.silent) {
      head.after(ghost);
      const g = ghost;
      ghostT = later(() => { g.remove(); if (ghost === g) ghost = null; }, 260);
      head.classList.remove('mo-in', 'mo-in2');
      head.classList.add(head.dataset.moFlip === '1' ? 'mo-in2' : 'mo-in');
      head.dataset.moFlip = head.dataset.moFlip === '1' ? '0' : '1';
    } else if (ghost) { ghost = null; }
    if (!info.silent && !reduced()) {
      wipe.classList.remove('is-on', 'is-on2');
      wipe.classList.add(wipe.dataset.f === '1' ? 'is-on2' : 'is-on');
      wipe.dataset.f = wipe.dataset.f === '1' ? '0' : '1';
    }
    if (docking) {
      deck.classList.add('is-dock');
      later(() => deck.classList.remove('is-dock'), 360);
    }
    setDeckVisible(false);
    if (ticksOn) { ticksOn = false; lt.classList.remove('mo-is-ticks'); }
  }

  /* ───────── Subtítulos del coach ───────── */
  let capT1 = 0;
  let capT2 = 0;
  function caption(text) {
    if (dead || !captionsOn) return;
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || root.classList.contains('is-finale')) return;
    clear(capT1);
    clear(capT2);
    const show = () => {
      capT.textContent = t;
      cap.classList.add('is-on');
      syncCapOffset();
      const ms = Math.max(2200, Math.min(7000, 1100 + t.length * 62));
      capT1 = later(() => { cap.classList.remove('is-on'); layout(); }, ms);
      layout();
    };
    if (cap.classList.contains('is-on')) {
      cap.classList.remove('is-on');
      capT2 = later(show, 180);
    } else show();
  }

  /* ───────── Apertura (durante el 3-2-1) ───────── */
  let intro = null;
  function startIntro({ title = '', kicker = '', meta = '', segments = [] } = {}) {
    if (dead || intro) return;
    const el = document.createElement('div');
    el.className = 'mo-title';
    el.setAttribute('aria-hidden', 'true');
    // Palabras (pueden partir línea) con letras sueltas: el «tracking» converge hacia el centro solo con transform
    // v2: el título tal cual (sin mayúsculas forzadas ni tracking de retransmisión), estilo Apple Fitness
    const words = String(title || '').split(/\s+/).filter(Boolean);
    const count = words.reduce((a, w) => a + [...w].length, 0);
    const mid = (count - 1) / 2;
    let li = 0;
    const lt2 = words.map((w) => `<span class="mo-w">${[...w].map((ch) => {
      const i = li++;
      return `<span class="mo-l" style="--k:${(i - mid).toFixed(2)};--i:${i}">${escH(ch)}</span>`;
    }).join('')}</span>`).join(' ');
    el.innerHTML = `
      <span class="mo-title__kick">${escH(kicker)}</span>
      <span class="mo-title__name">${lt2}</span>
      <i class="mo-title__rule"></i>
      <span class="mo-title__prof">${profileSvg(segments, { h: 64, gap: 5, cls: 'mo-title__svg' })}</span>
      <span class="mo-title__meta num">${escH(meta)}</span>`;
    hud.appendChild(el);
    root.classList.add('mo-intro');
    if (reduced()) root.classList.add('mo-intro--calm');
    const end = () => {
      if (!intro) return;
      clear(intro.t);
      root.classList.remove('mo-intro', 'mo-intro--calm', 'mo-intro--skip');
      intro.el.remove();
      intro = null;
    };
    const skip = () => {
      if (!intro || intro.skipped) return;
      intro.skipped = true;
      root.classList.add('mo-intro--skip');
      clear(intro.t);
      intro.t = later(end, 260);
    };
    intro = { el, skipped: false, t: later(end, 3400) };
    const onDown = () => skip();
    on(root, 'pointerdown', onDown, { passive: true });
  }

  /* ───────── Cierre antes del resumen ───────── */
  let outroRaf = 0;
  function outro(ov, { km = 0, sec = 0, kcal = 0, final = null, segments = [] } = {}) {
    if (dead || !ov) return;
    try {
      const stats = ov.querySelector('.hud-done__stats');
      const txt = ov.querySelector('.hud-done__txt');
      if (txt && segments.length) {
        const p = document.createElement('span');
        p.className = 'mo-oprof';
        p.setAttribute('aria-hidden', 'true');
        p.innerHTML = profileSvg(segments, { h: 26, lit: false, cls: 'mo-oprof__base' })
          + `<span class="mo-oprof__lit">${profileSvg(segments, { h: 26, cls: 'mo-oprof__svg' })}</span>`;
        if (stats) stats.after(p); else txt.appendChild(p);
      }
      if (!stats) return;
      const fin = { km: Number(km) || 0, sec: Number(sec) || 0, kcal: Number(kcal) || 0 };
      const label = final
        ? `${final.km} km · ${final.sec} · ${final.kcal} kcal`
        : `${dec(fin.km, 2)} km · ${clockOf(fin.sec)} · ${Math.round(fin.kcal)} kcal`;
      stats.setAttribute('aria-label', label);
      stats.innerHTML = '<b class="mo-cu" data-k="km"></b> km · <b class="mo-cu" data-k="sec"></b> · <b class="mo-cu" data-k="kcal"></b> kcal';
      const cells = { km: stats.querySelector('[data-k="km"]'), sec: stats.querySelector('[data-k="sec"]'), kcal: stats.querySelector('[data-k="kcal"]') };
      const paint = (f) => {
        if (f >= 1 && final) {
          cells.km.textContent = String(final.km ?? dec(fin.km, 2));
          cells.sec.textContent = String(final.sec ?? clockOf(fin.sec));
          cells.kcal.textContent = String(final.kcal ?? Math.round(fin.kcal));
          return;
        }
        cells.km.textContent = dec(fin.km * f, 2);
        cells.sec.textContent = clockOf(Math.floor(fin.sec * f));
        cells.kcal.textContent = String(Math.round(fin.kcal * f));
      };
      // ancho final reservado desde el principio (cifras tabulares y min-width = valor final): sin saltos
      paint(1);
      for (const k of Object.keys(cells)) {
        const w = cells[k].getBoundingClientRect().width;
        if (w > 0) cells[k].style.minWidth = `${Math.ceil(w)}px`;
      }
      if (reduced()) return;
      ov.classList.add('mo-outro');
      const DUR = 1700;
      const DELAY = 260;
      const t0 = performance.now();
      paint(0);
      const frame = (now) => {
        if (dead || !ov.isConnected) return;
        try {
          const x = Math.max(0, Math.min(1, (now - t0 - DELAY) / DUR));
          const f = 1 - (1 - x) ** 3;
          paint(f);
          if (x < 1) outroRaf = requestAnimationFrame(frame);
          else { outroRaf = 0; paint(1); }
        } catch { paint(1); }
      };
      outroRaf = requestAnimationFrame(frame);
    } catch { /* el rótulo final queda tal cual */ }
  }

  function destroy() {
    if (dead) return;
    dead = true;
    for (const id of timers) clearTimeout(id);
    timers.clear();
    if (outroRaf) cancelAnimationFrame(outroRaf);
    for (const f of offs.splice(0)) { try { f(); } catch { /* nada */ } }
    try { deck.remove(); cap.remove(); ticks?.remove(); wipe.remove(); intro?.el?.remove(); ghost?.remove(); } catch { /* nada */ }
    root.classList.remove('has-mo', 'mo-intro', 'mo-intro--calm', 'mo-intro--skip');
    lt.classList.remove('mo-is-deck', 'mo-is-ticks');
  }

  return { roll, tick, beforeSegment, afterSegment, caption, intro: startIntro, outro, destroy };
}
