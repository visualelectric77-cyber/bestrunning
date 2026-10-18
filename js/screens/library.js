// BestRunning · «Clases»: buscador, categorías, duración, carruseles por categoría y rejilla.
import { getState, setState, subscribe } from '../core/store.js';
import { haptic } from '../core/haptics.js';
import { icon, navBar, enableCollapsingHeader, workoutCard, chip, segmented, emptyState } from '../ui/components.js';
import { CATEGORIES, TEMPLATES, templatesFor } from '../training/templates.js';
import { buildWorkout, workoutId } from '../training/generator.js';
import { todayKey, esc, hashStr, debounce } from '../core/utils.js';

const DURATIONS = [20, 30, 45, 60];
const SEARCH_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>';

// Caché de clases construidas (se invalida sola al cambiar niveles/cinta porque forman parte de la clave).
const cache = new Map();

/* ───────────── Utilidades privadas ───────────── */

function safe(fn, fallback) {
  try {
    const v = fn();
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

const reducedMotion = () => safe(() => matchMedia('(prefers-reduced-motion: reduce)').matches, false);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ccStyle = (c) => `--cc:var(--c-${CATEGORIES[c] ? c : 'test'})`;
const hrefFor = (w) => `#/workout/${encodeURIComponent(w.id)}?from=library`;

function visibleCats(state) {
  const hasIncline = !!state.treadmill?.hasIncline;
  return Object.keys(CATEGORIES).filter((k) => k !== 'hills' || hasIncline);
}

function validCat(cat, state) {
  return cat === 'all' || visibleCats(state).includes(cat) ? cat : 'all';
}

function durationFor(t, minutes) {
  const ds = Array.isArray(t.durations) && t.durations.length ? t.durations : DURATIONS;
  if (ds.includes(minutes)) return minutes;
  return ds.reduce((best, d) => (Math.abs(d - minutes) < Math.abs(best - minutes) ? d : best), ds[0]);
}

/** Seed estable por plantilla: la misma clase de la biblioteca es siempre igual. */
const seedFor = (id) => (hashStr(`lib-${id}`) % 99991) + 1;

function buildFor(t, minutes, state) {
  const m = durationFor(t, minutes);
  const seed = seedFor(t.id);
  const tm = state.treadmill || {};
  const lv = state.levels || {};
  const key = [t.id, m, seed, lv.jog, lv.run, lv.fast, lv.sprint, tm.hasIncline, tm.minSpeed, tm.maxSpeed, state.profile?.weightKg].join('|');
  if (cache.has(key)) return cache.get(key);
  let w = safe(
    () => buildWorkout(t.id, {
      minutes: m, levels: lv, seed, loadFactor: 1, hasIncline: !!tm.hasIncline, treadmill: tm, weightKg: state.profile?.weightKg,
    }),
    null
  );
  if (w && !w.id) w = { ...w, id: workoutId({ templateId: t.id, minutes: m, seed, loadFactor: 1 }) };
  if (cache.size > 400) cache.clear();
  cache.set(key, w);
  return w;
}

function listFor(cat, minutes, state) {
  const hasIncline = !!state.treadmill?.hasIncline;
  let ts = safe(() => templatesFor({ category: cat, minutes, hasIncline }), []);
  if (!ts.length && cat === 'test') ts = safe(() => templatesFor({ category: 'test', hasIncline }), []);
  return Array.isArray(ts) ? ts : [];
}

function durationsOf(cat, state) {
  const hasIncline = !!state.treadmill?.hasIncline;
  const ts = safe(() => templatesFor({ category: cat, hasIncline }), []);
  const set = new Set();
  for (const t of ts) (t.durations || []).forEach((d) => set.add(d));
  return [...set].sort((a, b) => a - b);
}

function scrollerOf(el) {
  let n = el;
  while (n && n !== document.body) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
    n = n.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

/* ───────────── Pintado ───────────── */

function chipsHtml(state, category) {
  const cats = visibleCats(state);
  const all = chip('Todas', { active: category === 'all', attrs: `data-cat="all" role="tab" aria-selected="${category === 'all'}"` });
  return (
    all +
    cats
      .map((k) =>
        chip(CATEGORIES[k].name, {
          color: CATEGORIES[k].color,
          active: category === k,
          attrs: `data-cat="${k}" role="tab" aria-selected="${category === k}"`,
        })
      )
      .join('')
  );
}

const tile = (w) => `<div class="lb-cell">${workoutCard(w, { variant: 'tile', href: hrefFor(w) })}</div>`;

function featured(state, minutes) {
  const pool = listFor('all', minutes, state).filter((t) => t.category !== 'test');
  if (!pool.length) return '';
  const t = pool[hashStr(`feat-${todayKey()}`) % pool.length];
  const w = buildFor(t, minutes, state);
  if (!w) return '';
  return `<section class="lb-featured">
    <div class="lb-featured__label">${icon('star', 14)} Destacada de hoy</div>
    ${workoutCard(w, { variant: 'hero', href: hrefFor(w) })}
  </section>`;
}

function allView(state, minutes) {
  const sections = visibleCats(state)
    .map((k) => {
      const ws = listFor(k, minutes, state).map((t) => buildFor(t, minutes, state)).filter(Boolean);
      if (!ws.length) return '';
      const c = CATEGORIES[k];
      return `<section class="lb-section" style="${ccStyle(k)}" aria-label="${esc(c.name)}">
        <div class="lb-section__head">
          <span class="lb-section__icon" aria-hidden="true">${icon(c.icon, 16)}</span>
          <div class="lb-section__titles">
            <h2 class="lb-section__title">${esc(c.name)} <span class="lb-section__count">${ws.length}</span></h2>
            ${c.description ? `<p class="lb-section__desc">${esc(c.description)}</p>` : ''}
          </div>
          <button type="button" class="lb-more" data-cat="${k}">Ver todo</button>
        </div>
        <div class="hscroll lb-carousel">${ws.map(tile).join('')}</div>
      </section>`;
    })
    .filter(Boolean);
  if (!sections.length) {
    return emptyState({ icon: 'grid', title: 'Sin clases para esta duración', text: 'Prueba con otra duración.' });
  }
  return featured(state, minutes) + sections.join('');
}

function categoryView(state, cat, minutes) {
  const c = CATEGORIES[cat];
  const ws = listFor(cat, minutes, state).map((t) => buildFor(t, minutes, state)).filter(Boolean);
  const head = `<div class="lb-cathead" style="${ccStyle(cat)}">
    <span class="lb-cathead__icon" aria-hidden="true">${icon(c.icon, 26)}</span>
    <div class="lb-cathead__text">
      <h2 class="lb-cathead__title">${esc(c.name)}</h2>
      ${c.description ? `<p class="lb-cathead__desc">${esc(c.description)}</p>` : ''}
    </div>
    <span class="lb-count num">${ws.length}</span>
  </div>`;
  if (!ws.length) {
    const ds = durationsOf(cat, state).filter((d) => d !== minutes);
    const action = ds.length
      ? `<div class="lb-durs">${ds.map((d) => `<button type="button" class="btn btn--secondary" data-dur="${d}">${d} min</button>`).join('')}</div>`
      : '';
    return head + emptyState({
      icon: c.icon,
      title: `No hay clases de ${c.name.toLowerCase()} de ${minutes} min`,
      text: ds.length ? 'Prueba con otra duración:' : 'Prueba con otra categoría.',
      action,
    });
  }
  return `${head}<div class="lb-grid">${ws.map(tile).join('')}</div>`;
}

/** Plantillas que encajan con todas las palabras de la búsqueda (sin tildes ni mayúsculas). */
function searchHits(state, q, cat) {
  const hasIncline = !!state.treadmill?.hasIncline;
  const words = norm(q).split(/\s+/).filter(Boolean);
  const pool = (Array.isArray(TEMPLATES) ? TEMPLATES : []).filter(
    (t) => (hasIncline || !t.requiresIncline) && (cat === 'all' || t.category === cat)
  );
  return pool.filter((t) => {
    const hay = norm([t.title, t.subtitle, t.focus, t.description, CATEGORIES[t.category]?.name].join(' '));
    return words.every((w) => hay.includes(w));
  });
}

function searchView(state, q, cat, minutes) {
  const ws = searchHits(state, q, cat).map((t) => buildFor(t, minutes, state)).filter(Boolean);
  if (!ws.length && cat !== 'all') {
    // La categoría elegida se recuerda entre visitas: si hay resultados fuera de ella, ofrece buscar en todas
    const n = searchHits(state, q, 'all').length;
    if (n) {
      return emptyState({
        icon: 'grid',
        title: `Nada en ${CATEGORIES[cat]?.name || 'esta categoría'}`,
        text: `Hay ${n} ${n === 1 ? 'clase' : 'clases'} para «${q}» en otras categorías.`,
        action: '<button type="button" class="btn btn--secondary" data-cat="all">Buscar en todas</button>',
      });
    }
  }
  if (!ws.length) {
    return emptyState({
      icon: 'grid',
      title: 'Sin resultados',
      text: `No encontramos clases para «${q}». Prueba con «sprint», «pirámide» o «resistencia».`,
    });
  }
  return `<p class="lb-resultcount">${ws.length} ${ws.length === 1 ? 'clase' : 'clases'}</p><div class="lb-grid">${ws.map(tile).join('')}</div>`;
}

/* ───────────── Pantalla ───────────── */

export function mount(el) {
  const s0 = getState();
  let category = validCat(s0.ui?.libraryCategory || 'all', s0);
  let minutes = DURATIONS.includes(Number(s0.ui?.libraryDuration)) ? Number(s0.ui.libraryDuration) : 20;
  let query = '';
  let first = true;
  let sig = '';

  el.innerHTML = `${navBar({ title: 'Clases', large: true })}
    <div class="container lb">
      <div class="lb-tools">
        <label class="lb-search">
          <span class="lb-search__icon">${SEARCH_SVG}</span>
          <input type="search" class="lb-search__input" placeholder="Buscar: sprint, pirámide, fondo…" enterkeyhint="search"
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Buscar clases">
          <button type="button" class="lb-search__clear" aria-label="Borrar búsqueda" hidden>${icon('close', 12, { stroke: 3 })}</button>
        </label>
        <div class="hscroll lb-chips" role="tablist" aria-label="Categorías"></div>
        <div class="lb-dur">${segmented({
          name: 'lb-dur',
          options: DURATIONS.map((d) => ({ value: d, label: `${d} min` })),
          value: minutes,
        })}</div>
      </div>
      <div class="lb-results" aria-live="polite"></div>
    </div>`;

  const root = el.querySelector('.lb');
  const chipsEl = root.querySelector('.lb-chips');
  const resultsEl = root.querySelector('.lb-results');
  const input = root.querySelector('.lb-search__input');
  const clearBtn = root.querySelector('.lb-search__clear');
  const cleanupHeader = enableCollapsingHeader(el);

  function renderChips() {
    const state = getState();
    chipsEl.innerHTML = chipsHtml(state, category);
    const active = chipsEl.querySelector(`[data-cat="${category}"]`);
    if (active && !first) {
      safe(() => active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }), null);
    }
  }

  function renderResults() {
    const state = getState();
    const q = query.trim();
    let html;
    if (q) html = searchView(state, q, category, minutes);
    else if (category === 'all') html = allView(state, minutes);
    else html = categoryView(state, category, minutes);
    resultsEl.innerHTML = html;
    resultsEl.classList.remove('lb-anim');
    if (!first && !reducedMotion()) {
      void resultsEl.offsetWidth; // reinicia la animación de entrada
      resultsEl.classList.add('lb-anim');
    }
    resultsEl.classList.toggle('stagger', first);
    [...resultsEl.children].forEach((n, i) => n.style.setProperty('--i', Math.min(i, 8)));
    first = false;
  }

  const signature = (s) => {
    const lv = s.levels || {};
    const tm = s.treadmill || {};
    return [lv.jog, lv.run, lv.fast, lv.sprint, tm.hasIncline, tm.minSpeed, tm.maxSpeed, s.profile?.weightKg].join('|');
  };

  function persist() {
    setState((d) => {
      d.ui = d.ui || {};
      d.ui.libraryCategory = category;
      d.ui.libraryDuration = minutes;
    });
  }

  function setCategory(cat, { scrollTop = false } = {}) {
    const next = validCat(cat, getState());
    if (next === category) return;
    category = next;
    haptic('selection');
    renderChips();
    renderResults();
    persist();
    if (scrollTop) {
      const sc = scrollerOf(el);
      safe(() => sc.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }), null);
    }
  }

  function setMinutes(m) {
    if (!DURATIONS.includes(m) || m === minutes) return;
    minutes = m;
    renderResults();
    persist();
  }

  const runSearch = debounce(() => renderResults(), 140);

  const onClick = (e) => {
    const c = e.target.closest('[data-cat]');
    if (c && root.contains(c)) {
      e.preventDefault();
      setCategory(c.dataset.cat, { scrollTop: c.classList.contains('lb-more') });
      return;
    }
    const d = e.target.closest('[data-dur]');
    if (d) {
      const m = Number(d.dataset.dur);
      // Mantén el control segmentado sincronizado volviendo a pintarlo.
      const seg = root.querySelector('.lb-dur');
      if (seg) seg.innerHTML = segmented({ name: 'lb-dur', options: DURATIONS.map((x) => ({ value: x, label: `${x} min` })), value: m });
      haptic('selection');
      setMinutes(m);
      return;
    }
    if (e.target.closest('.lb-search__clear')) {
      input.value = '';
      query = '';
      clearBtn.hidden = true;
      renderResults();
      input.focus();
    }
  };

  const onChange = (e) => {
    if (e.detail && e.detail.name === 'lb-dur') setMinutes(Number(e.detail.value));
  };

  const onInput = () => {
    query = input.value;
    clearBtn.hidden = !query;
    runSearch();
  };
  const onKey = (e) => {
    if (e.key === 'Enter') input.blur();
  };

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  input.addEventListener('input', onInput);
  input.addEventListener('search', onInput);
  input.addEventListener('keydown', onKey);

  renderChips();
  renderResults();
  sig = signature(getState());

  const unsub = subscribe((s) => {
    const st = s || getState();
    const next = signature(st);
    if (next === sig) return;
    sig = next;
    category = validCat(category, st);
    renderChips();
    renderResults();
  });

  return () => {
    unsub?.();
    cleanupHeader?.();
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    input.removeEventListener('input', onInput);
    input.removeEventListener('search', onInput);
    input.removeEventListener('keydown', onKey);
  };
}
