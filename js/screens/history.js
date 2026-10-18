// BestRunning · Historial: lista por meses (buscar, filtrar, deslizar para borrar) y detalle de sesión.
// El detalle incluye el pulso del Apple Watch (importación vía Atajo, línea sobre el perfil, zonas de FC y
// pulso por velocidad) y la música que sonó en la sesión.
import { getState, setState, subscribe } from '../core/store.js';
import { navigate, back } from '../core/router.js';
import { icon, navBar, enableCollapsingHeader, chip, stat, ring, profileChart, zoneBar, openSheet, toast, confirmDialog, actionSheet, categoryColor, celebrate } from '../ui/components.js';
import { haptic } from '../core/haptics.js';
import { FEELINGS, hrLevelTrends } from '../training/progression.js';
import { traceCursorSec, skippedRanges } from '../training/stats.js';
import { evaluateAchievements } from '../training/achievements.js';
import {
  startWatchHrImport, openWatchHrSheet, hasPendingWatchHr, hrFieldsFrom, hrFieldsCleared, hasHrSeries, hrZoneTimes,
  withHrOverlay, hrLegendHtml, hrZonesHtml, hrLevelsHtml, hrMaxHintHtml, ensureWatchHrStyles, isWatchShortcutReady,
  HR_ENTRY_MIN, HR_ENTRY_MAX,
} from '../integrations/watch-hr.js';
import { CATEGORIES } from '../training/templates.js';
import { sessionMusicHtml, hydrateSessionMusic } from '../integrations/session-music.js';
import { ZONES, LEVEL_KEYS, hrZones, hrMaxFromAge, zoneForSpeed } from '../training/levels.js';
import { esc, fmt, todayKey, parseKey, capitalize, pad2, clamp, debounce } from '../core/utils.js';

/* ───────────── utilidades privadas ───────────── */

const safe = (fn, fallback = null) => {
  try {
    const v = fn();
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const feelingMap = () => Object.fromEntries((Array.isArray(FEELINGS) ? FEELINGS : []).map((f) => [f.key, f]));

const catOf = (key) => (CATEGORIES && CATEGORIES[key]) || null;
const catColor = (key) => (catOf(key) ? safe(() => categoryColor(key), `var(--c-${key})`) : 'var(--accent)');

const SEARCH_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>';

function timeOf(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function sortedHistory(s) {
  const list = (Array.isArray(s.history) ? s.history : []).filter((h) => h && h.id);
  return list.slice().sort((a, b) => String(b.startedAt || b.dayKey || '').localeCompare(String(a.startedAt || a.dayKey || '')));
}

function searchText(h, feel) {
  const key = h.dayKey || '';
  const d = key ? parseKey(key) : null;
  return norm([
    h.title,
    catOf(h.category)?.name,
    h.notes,
    key ? fmt.dateLong(key) : '',
    d ? `${fmt.monthName(d.getMonth())} ${d.getFullYear()}` : '',
    feel[h.feeling]?.label,
    h.isTest ? 'test vam' : '',
  ].filter(Boolean).join(' '));
}

/** Segmentos aproximados a partir del trazado real (si no se puede regenerar la clase). */
function traceSegments(ses, levels) {
  const tr = (Array.isArray(ses.speedTrace) ? ses.speedTrace : []).filter((p) => Array.isArray(p) && p.length >= 2 && p[1] > 0);
  const total = ses.elapsedSec || (tr.length ? tr[tr.length - 1][0] : 0);
  const out = [];
  tr.forEach(([t, speed], i) => {
    const end = i + 1 < tr.length ? tr[i + 1][0] : total;
    const sec = Math.max(0, end - t);
    if (!sec) return;
    let zone = safe(() => zoneForSpeed(speed, levels), 'jog');
    if (speed < levels.jog && i === 0) zone = 'warmup';
    else if (speed < levels.jog && i === tr.length - 1) zone = 'cooldown';
    out.push({ zone, speed, incline: 0, sec, label: ZONES[zone]?.name || '' });
  });
  return out;
}

const segCache = new Map();
async function loadSegments(ses) {
  if (segCache.has(ses.id)) return segCache.get(ses.id);
  let segs = null;
  try {
    const gen = await import('../training/generator.js');
    const st = getState();
    const w = gen.workoutFromId(ses.workoutId, { ...st, levels: ses.levelsAtStart || st.levels });
    if (w && Array.isArray(w.segments) && w.segments.length) segs = w.segments;
  } catch {
    segs = null;
  }
  segCache.set(ses.id, segs);
  return segs;
}

/* ───────────── borrar / restaurar ───────────── */

async function deleteSession(id, { onCancel = null, onDone = null } = {}) {
  const s = getState();
  const idx = (s.history || []).findIndex((h) => h.id === id);
  if (idx < 0) return false;
  const ses = s.history[idx];
  haptic('warning');
  const ok = await confirmDialog({
    title: '¿Borrar esta sesión?',
    message: `«${ses.title || 'Entrenamiento'}» del ${ses.dayKey ? fmt.dateShort(ses.dayKey) : ''} desaparecerá del historial y de tus estadísticas.`,
    confirmText: 'Borrar',
    cancelText: 'Cancelar',
    destructive: true,
  });
  if (!ok) {
    onCancel?.();
    return false;
  }
  const snapshot = JSON.parse(JSON.stringify(ses));
  const finish = () => {
    setState((d) => {
      d.history = (d.history || []).filter((h) => h.id !== id);
    });
    haptic('success');
    toast('Sesión borrada · Toca para deshacer', {
      icon: 'trash',
      duration: 4500,
      onClick: () => {
        setState((d) => {
          d.history = d.history || [];
          if (!d.history.some((h) => h.id === snapshot.id)) d.history.splice(Math.min(idx, d.history.length), 0, snapshot);
        });
        haptic('light');
        toast('Sesión recuperada', { icon: 'check', kind: 'success' });
      },
    });
  };
  if (onDone) onDone(finish);
  else finish();
  return true;
}

/* ───────────── deslizar para borrar (pointer events) ───────────── */

function attachSwipe(listEl, { onDelete, onOpen, onLong }) {
  const OPEN = 96;
  const FULL = 0.6;
  let st = null;
  let openRow = null;

  const setX = (row, x, animate) => {
    const c = row.querySelector('.hs-row__content');
    if (!c) return;
    c.style.transition = animate ? '' : 'none';
    c.style.transform = x ? `translate3d(${x}px,0,0)` : '';
    row.style.setProperty('--reveal', String(clamp(-x / OPEN, 0, 1)));
  };
  const close = (row, animate = true) => {
    if (!row) return;
    setX(row, 0, animate);
    row.classList.remove('is-open', 'is-armed');
    if (openRow === row) openRow = null;
  };
  const mark = (row) => {
    row.dataset.justSwiped = '1';
    setTimeout(() => { delete row.dataset.justSwiped; }, 380);
  };

  const down = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const content = e.target.closest('.hs-row__content');
    if (!content) {
      if (openRow && !e.target.closest('.hs-row__actions')) close(openRow);
      return;
    }
    const row = content.closest('.hs-row');
    if (openRow && openRow !== row) close(openRow);
    st = { row, content, pid: e.pointerId, x0: e.clientX, y0: e.clientY, base: row.classList.contains('is-open') ? -OPEN : 0, x: 0, mode: null, armed: false };
    st.longT = setTimeout(() => {
      if (st && !st.mode) {
        st.mode = 'long';
        mark(row);
        haptic('medium');
        onLong(row.dataset.id, row);
      }
    }, 560);
  };

  const move = (e) => {
    if (!st || e.pointerId !== st.pid) return;
    const dx = e.clientX - st.x0;
    const dy = e.clientY - st.y0;
    if (!st.mode) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        st.mode = 'swipe';
        clearTimeout(st.longT);
        try { st.content.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
        st.row.classList.add('is-swiping');
      } else if (Math.abs(dy) > 8) {
        st.mode = 'scroll';
        clearTimeout(st.longT);
        return;
      } else return;
    }
    if (st.mode !== 'swipe') return;
    let x = st.base + dx;
    if (x > 0) x *= 0.2; // resistencia hacia la derecha
    st.x = x;
    setX(st.row, x, false);
    const armed = x < -st.row.clientWidth * FULL;
    if (armed !== st.armed) {
      st.armed = armed;
      st.row.classList.toggle('is-armed', armed);
      haptic(armed ? 'medium' : 'selection');
    }
  };

  const end = (e, cancelled) => {
    if (!st || e.pointerId !== st.pid) return;
    clearTimeout(st.longT);
    const cur = st;
    st = null;
    if (cur.mode !== 'swipe') return;
    const { row } = cur;
    row.classList.remove('is-swiping');
    mark(row);
    if (!cancelled && cur.armed) {
      setX(row, -row.clientWidth, true);
      onDelete(row.dataset.id, row, () => close(row));
      return;
    }
    if (!cancelled && cur.x < -OPEN / 2) {
      setX(row, -OPEN, true);
      row.classList.add('is-open');
      openRow = row;
      haptic('light');
    } else close(row);
  };
  const up = (e) => end(e, false);
  const cancel = (e) => end(e, true);

  const click = (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.preventDefault();
      const row = del.closest('.hs-row');
      onDelete(del.dataset.del, row, () => close(row));
      return;
    }
    const content = e.target.closest('.hs-row__content');
    if (!content) return;
    const row = content.closest('.hs-row');
    if (row.dataset.justSwiped) return;
    if (row.classList.contains('is-open')) {
      close(row);
      return;
    }
    if (openRow) {
      close(openRow);
      return;
    }
    onOpen(row.dataset.id);
  };

  const key = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const content = e.target.closest('.hs-row__content');
    if (!content) return;
    e.preventDefault();
    onOpen(content.closest('.hs-row').dataset.id);
  };

  listEl.addEventListener('pointerdown', down);
  listEl.addEventListener('pointermove', move);
  listEl.addEventListener('pointerup', up);
  listEl.addEventListener('pointercancel', cancel);
  listEl.addEventListener('click', click);
  listEl.addEventListener('keydown', key);
  return () => {
    listEl.removeEventListener('pointerdown', down);
    listEl.removeEventListener('pointermove', move);
    listEl.removeEventListener('pointerup', up);
    listEl.removeEventListener('pointercancel', cancel);
    listEl.removeEventListener('click', click);
    listEl.removeEventListener('keydown', key);
    if (st) clearTimeout(st.longT);
  };
}

/* ───────────── lista ───────────── */

function emptyList() {
  return `<section class="card hs-empty">
    <div class="hs-empty__art" aria-hidden="true">
      <span class="hs-empty__ring"></span><span class="hs-empty__ring hs-empty__ring--2"></span>
      <span class="hs-empty__icon">${icon('clock', 34)}</span>
    </div>
    <h2 class="hs-empty__title">Aún no hay entrenamientos</h2>
    <p class="hs-empty__text">Aquí se irán guardando todas tus sesiones: tiempo, kilómetros, velocidades, cómo te sentiste… Tu diario de cinta, listo para llenarse.</p>
    <button type="button" class="btn btn--primary btn--lg btn--block" data-href="#/today">${icon('play', 20)}<span>Empezar la sesión de hoy</span></button>
  </section>`;
}

function noResults(q) {
  return `<div class="hs-noresults">
    <span class="hs-noresults__icon">${SEARCH_SVG}</span>
    <b>Sin resultados</b>
    <span class="muted">${q ? `Nada coincide con «${esc(q)}».` : 'No hay sesiones de esta categoría.'}</span>
  </div>`;
}

/**
 * Sesiones «extra» de cada día con varias: las que no cumplen el plan (como el planificador: primero la
 * asignada a ese día, si no la mejor del día) y no estaban asignadas a otro día.
 */
function extraIds(items) {
  const byDay = new Map();
  for (const h of items) {
    if (!h.dayKey) continue;
    if (!byDay.has(h.dayKey)) byDay.set(h.dayKey, []);
    byDay.get(h.dayKey).push(h);
  }
  const score = (x) => { const p = Number(x.completionPct) || 0; return (p >= 0.6 ? 2 : 0) + p; };
  const out = new Set();
  for (const [day, list] of byDay) {
    if (list.length < 2) continue;
    let c = list.filter((x) => x.planDate === day);
    if (!c.length) c = list.filter((x) => !x.planDate);
    const main = c.length ? c.reduce((best, x) => (score(x) >= score(best) ? x : best)) : null;
    for (const x of list) if (x !== main && !x.planDate) out.add(x.id);
  }
  return out;
}

function rowHtml(h, feel, { extra = false, sameDay = false } = {}) {
  const key = h.dayKey || todayKey();
  const d = parseKey(key);
  const cat = catOf(h.category);
  const f = feel[h.feeling];
  const pct = Math.round((Number(h.completionPct) || 0) * 100);
  const partial = !h.completed && pct > 0 && pct < 100;
  const meta = [cat?.name || (h.isTest ? 'Test' : ''), timeOf(h.startedAt), fmt.clock(h.elapsedSec || 0)].filter(Boolean).map(esc).join(' · ');
  return `<div class="hs-row${sameDay ? ' hs-row--sameday' : ''}" data-id="${esc(h.id)}" style="--cc:${catColor(h.category)}">
    <div class="hs-row__actions">
      <button type="button" class="hs-row__del" data-del="${esc(h.id)}" aria-label="Borrar sesión">${icon('trash', 20)}<span>Borrar</span></button>
    </div>
    <div class="hs-row__content" role="button" tabindex="0" aria-label="${esc(h.title || 'Sesión')}${extra ? ' (extra)' : ''}, ${esc(fmt.dateLong(key))}${timeOf(h.startedAt) ? `, ${timeOf(h.startedAt)}` : ''}">
      <div class="hs-row__date"><span>${esc(fmt.weekdayAbbr(((d.getDay() + 6) % 7) + 1))}</span><b class="num">${d.getDate()}</b></div>
      <div class="hs-row__main">
        <div class="hs-row__title"><span class="hs-row__name">${esc(h.title || 'Entrenamiento')}</span>${h.isTest ? '<span class="hs-tag">VAM</span>' : ''}${extra ? '<span class="hs-tag hs-tag--extra">Extra</span>' : ''}</div>
        <div class="hs-row__meta"><span class="hs-row__metatxt">${meta}</span>${h.hrAvg ? `<span class="whr-rowhr" aria-label="Pulso medio ${Number(h.hrAvg) || ''} ppm">${icon('heart', 11, { stroke: 2.6 })}${Number(h.hrAvg) || ''}</span>` : ''}</div>
      </div>
      <div class="hs-row__side">
        <div class="hs-row__km num">${fmt.km(h.distanceKm || 0)}<small>km</small></div>
        <div class="hs-row__feel">${f ? `<span title="${esc(f.label)}">${f.emoji}</span>` : ''}${partial ? `<span class="hs-row__pct num">${pct}\u202F%</span>` : ''}</div>
      </div>
      <span class="hs-row__chev">${icon('chevron-right', 16, { stroke: 2.5 })}</span>
    </div>
  </div>`;
}

function listHtml(items, feel) {
  const extras = extraIds(items);
  const groups = [];
  let cur = null;
  const thisYear = new Date().getFullYear();
  for (const h of items) {
    const d = parseKey(h.dayKey || todayKey());
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    if (!cur || cur.k !== k) {
      cur = { k, label: `${capitalize(fmt.monthName(d.getMonth()))}${d.getFullYear() !== thisYear ? ` ${d.getFullYear()}` : ''}`, items: [] };
      groups.push(cur);
    }
    cur.items.push(h);
  }
  return groups.map((g) => {
    const km = g.items.reduce((a, h) => a + (h.distanceKm || 0), 0);
    const sec = g.items.reduce((a, h) => a + (h.elapsedSec || 0), 0);
    return `<section class="hs-month">
      <div class="hs-month__head">
        <h3>${esc(g.label)}</h3>
        <span>${g.items.length} ${g.items.length === 1 ? 'sesión' : 'sesiones'} · ${fmt.dec1(km)} km · ${esc(fmt.durationLong(sec))}</span>
      </div>
      <div class="hs-group">${g.items.map((h, i) => rowHtml(h, feel, { extra: extras.has(h.id), sameDay: i > 0 && !!h.dayKey && g.items[i - 1].dayKey === h.dayKey })).join('')}</div>
    </section>`;
  }).join('');
}

function mountList(el) {
  ensureWatchHrStyles();
  el.innerHTML = `${navBar({ title: 'Historial', large: true, back: '#/progress', backLabel: 'Progreso' })}<div class="container stack-lg hs-body" data-body></div>`;
  const body = el.querySelector('[data-body]');
  const offHeader = safe(() => enableCollapsingHeader(el), null);
  const filter = { q: '', cat: 'all' };
  let offSwipe = null;
  let first = true;
  let raf = 0;

  const renderList = () => {
    const s = getState();
    const feel = feelingMap();
    const all = sortedHistory(s);
    const listEl = body.querySelector('[data-list]');
    const sumEl = body.querySelector('[data-summary]');
    if (!listEl) return;
    const q = norm(filter.q);
    const items = all.filter((h) => (filter.cat === 'all' || h.category === filter.cat) && (!q || searchText(h, feel).includes(q)));
    const km = items.reduce((a, h) => a + (h.distanceKm || 0), 0);
    const sec = items.reduce((a, h) => a + (h.elapsedSec || 0), 0);
    if (sumEl) {
      sumEl.innerHTML = `<div class="hs-summary">
        <div><b class="num">${items.length}</b><span>${items.length === 1 ? 'sesión' : 'sesiones'}</span></div>
        <div><b class="num">${fmt.dec1(km)}</b><span>km</span></div>
        ${sec < 3600
          ? `<div><b class="num">${fmt.int(Math.round(sec / 60))}</b><span>min</span></div>`
          : `<div><b class="num">${fmt.dec1(sec / 3600)}</b><span>${Math.round(sec / 360) === 10 ? 'hora' : 'horas'}</span></div>`}
      </div>`;
    }
    listEl.innerHTML = items.length ? listHtml(items, feel) : noResults(filter.q.trim());
  };

  const render = () => {
    raf = 0;
    const s = getState();
    const all = sortedHistory(s);
    offSwipe?.();
    offSwipe = null;
    if (!all.length) {
      body.innerHTML = `<div class="pg-part" style="--i:0">${emptyList()}</div>`;
      body.classList.toggle('stagger', first);
      first = false;
      return;
    }
    const present = new Set(all.map((h) => h.category));
    if (filter.cat !== 'all' && !present.has(filter.cat)) filter.cat = 'all';
    const cats = Object.keys(CATEGORIES || {}).filter((k) => present.has(k));
    const chips = [
      chip('Todas', { active: filter.cat === 'all', attrs: 'data-cat="all" role="button" tabindex="0"' }),
      ...cats.map((k) => chip(CATEGORIES[k].name, { color: catColor(k), active: filter.cat === k, attrs: `data-cat="${esc(k)}" role="button" tabindex="0"` })),
    ].join('');
    const hadFocus = document.activeElement?.matches?.('.hs-search input');
    body.innerHTML = `
      <div class="hs-tools" style="--i:0">
        <label class="hs-search">${SEARCH_SVG}<input type="search" class="hs-search__input" placeholder="Buscar clase, fecha o nota" value="${esc(filter.q)}" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Buscar en el historial"></label>
        ${cats.length > 1 ? `<div class="hs-chips hscroll">${chips}</div>` : ''}
      </div>
      <div data-summary style="--i:1"></div>
      <div data-list class="hs-list" style="--i:2"></div>`;
    body.classList.toggle('stagger', first);
    first = false;
    renderList();
    const listEl = body.querySelector('[data-list]');
    offSwipe = attachSwipe(listEl, {
      onOpen: (id) => {
        haptic('light');
        navigate(`#/history/${encodeURIComponent(id)}`);
      },
      onDelete: (id, row, restore) => {
        deleteSession(id, {
          onCancel: restore,
          onDone: (finish) => {
            if (!row) return finish();
            row.style.height = `${row.offsetHeight}px`;
            requestAnimationFrame(() => {
              row.classList.add('is-removing');
              row.style.height = '0px';
            });
            setTimeout(finish, 280);
          },
        });
      },
      onLong: async (id, row) => {
        const ses = getState().history?.find((h) => h.id === id);
        if (!ses) return;
        const v = await actionSheet({
          title: ses.title || 'Sesión',
          options: [
            { label: 'Ver detalle', value: 'open', icon: 'chevron-right' },
            { label: 'Borrar sesión', value: 'delete', icon: 'trash', destructive: true },
          ],
        });
        if (v === 'open') navigate(`#/history/${encodeURIComponent(id)}`);
        else if (v === 'delete') deleteSession(id);
        row?.classList.remove('is-open');
      },
    });
    if (hadFocus) {
      const inp = body.querySelector('.hs-search input');
      inp?.focus();
    }
  };

  const onInput = debounce((e) => {
    filter.q = e.target.value || '';
    renderList();
  }, 120);

  const onBodyInput = (e) => {
    if (e.target.matches?.('.hs-search input')) onInput(e);
  };
  const onBodyClick = (e) => {
    const c = e.target.closest('[data-cat]');
    if (!c) return;
    const cat = c.dataset.cat;
    if (cat === filter.cat) return;
    filter.cat = cat;
    haptic('selection');
    body.querySelectorAll('[data-cat]').forEach((x) => {
      x.classList.toggle('chip--active', x.dataset.cat === cat);
      x.setAttribute('aria-pressed', String(x.dataset.cat === cat));
    });
    renderList();
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && e.target.matches?.('.hs-search input')) e.target.blur();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[data-cat]')) {
      e.preventDefault();
      e.target.closest('[data-cat]').click();
    }
  };

  body.addEventListener('input', onBodyInput);
  body.addEventListener('click', onBodyClick);
  body.addEventListener('keydown', onKey);
  const unsub = subscribe(() => {
    if (!raf) raf = requestAnimationFrame(render);
  });
  render();

  return () => {
    unsub?.();
    offSwipe?.();
    if (raf) cancelAnimationFrame(raf);
    body.removeEventListener('input', onBodyInput);
    body.removeEventListener('click', onBodyClick);
    body.removeEventListener('keydown', onKey);
    if (typeof offHeader === 'function') offHeader();
  };
}

/* ───────────── detalle ───────────── */

function hrZoneOf(bpm, profile) {
  if (!bpm) return null;
  const max = profile?.hrMax || hrMaxFromAge(profile?.age || 46);
  const zones = safe(() => hrZones(max, profile?.hrRest || null), []);
  if (!zones.length) return null;
  if (bpm < zones[0].min) return { ...zones[0], below: true };
  return zones.find((z) => bpm >= z.min && bpm <= z.max) || zones[zones.length - 1];
}

function detailHtml(ses, s, segments) {
  const feel = feelingMap();
  const cat = catOf(ses.category);
  const key = ses.dayKey || todayKey();
  const pct = clamp(Number(ses.completionPct) || (ses.completed ? 1 : 0), 0, 1);
  const elapsed = ses.elapsedSec || 0;
  const avg = ses.avgSpeed || (elapsed ? (ses.distanceKm || 0) / (elapsed / 3600) : 0);
  const levels = ses.levelsAtStart || s.levels || { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13 };
  const f = feel[ses.feeling];
  const parts = [];

  parts.push(`<section class="card hs-hero" style="--cc:${catColor(ses.category)}">
    <div class="hs-hero__glow" aria-hidden="true"></div>
    <div class="hs-hero__top">
      <div class="hs-hero__chips">
        ${cat ? `<span class="hs-hero__chip">${icon(cat.icon || 'bolt', 14)}${esc(cat.name)}</span>` : ''}
        ${ses.isTest ? '<span class="hs-hero__chip">Test VAM</span>' : ''}
      </div>
      <div class="hs-hero__date">${esc(capitalize(fmt.dateLong(key)))}${timeOf(ses.startedAt) ? ` · ${timeOf(ses.startedAt)}` : ''}</div>
    </div>
    <div class="hs-hero__main">
      <div class="hs-hero__ring">${ring({ value: pct, size: 88, stroke: 9, color: pct >= 1 ? 'var(--ok)' : 'var(--accent)', inner: pct >= 1 ? icon('check', 30, { stroke: 3 }) : `<span class="num hs-hero__pct">${Math.round(pct * 100)}<small>%</small></span>` })}</div>
      <div class="hs-hero__big">
        <div class="hs-hero__km num">${fmt.km(ses.distanceKm || 0)}<small>km</small></div>
        <div class="hs-hero__status">${pct >= 1 ? '¡Sesión completada!' : ses.completed ? 'Completada' : `Completada al ${Math.round(pct * 100)}\u202F%`}${ses.plannedSec ? ` · plan ${esc(fmt.minutes(ses.plannedSec))}` : ''}</div>
      </div>
    </div>
  </section>`);

  parts.push(`<section class="hs-stats">
    ${stat({ label: 'Tiempo', value: fmt.clock(elapsed), size: 'md' })}
    ${stat({ label: 'Vel. media', value: fmt.speed(avg), unit: 'km/h', size: 'md' })}
    ${stat({ label: 'Ritmo', value: avg > 0 ? fmt.pace(avg) : '–:––', unit: '/km', size: 'md' })}
    ${stat({ label: 'Vel. máx.', value: fmt.speed(ses.maxSpeed || 0), unit: 'km/h', size: 'md' })}
    ${stat({ label: 'Energía', value: fmt.int(ses.kcal || 0), unit: 'kcal', size: 'md' })}
    ${stat({ label: 'Intenso', value: fmt.clock((ses.timeInZone?.fast || 0) + (ses.timeInZone?.sprint || 0)), size: 'md' })}
  </section>`);

  const trace = Array.isArray(ses.speedTrace) && ses.speedTrace.length ? ses.speedTrace : null;
  const segs = segments && segments.length ? segments : traceSegments(ses, levels);
  const series = hasHrSeries(ses);
  if (segs.length) {
    parts.push(`<section class="card hs-card">
      <div class="hs-card__head"><div class="eyebrow">Perfil de la sesión</div><span class="hs-legend">${trace ? '<i></i>Tu velocidad real' : ''}${series ? hrLegendHtml() : ''}</span></div>
      <div class="hs-profile" data-profile>${profileHtml(ses, segs, levels)}</div>
    </section>`);
  }

  const tiz = ses.timeInZone && Object.values(ses.timeInZone).some((v) => v > 0) ? ses.timeInZone : null;
  if (tiz) {
    parts.push(`<section class="card hs-card">
      <div class="hs-card__head"><div class="eyebrow">Tiempo en cada zona</div></div>
      ${zoneBar(tiz, { showLegend: true })}
    </section>`);
  }

  if (ses.isTest && ses.test) {
    const t = ses.test;
    parts.push(`<section class="card hs-card hs-test">
      <div class="hs-card__head"><div class="eyebrow">Resultado del test</div></div>
      <div class="hs-test__grid">
        <div><b class="num">${fmt.speed(t.vam || 0)}</b><span>VAM km/h</span></div>
        <div><b class="num">${fmt.speed(t.lastStageSpeed || 0)}</b><span>Último escalón</span></div>
        <div><b class="num">${fmt.int(t.secondsInLastStage || 0)}″</b><span>En ese escalón</span></div>
      </div>
    </section>`);
  }

  // Sensación + pulso
  const zAvg = hrZoneOf(ses.hrAvg, s.profile);
  const hasHr = ses.hrAvg || ses.hrMax;
  parts.push(`<section class="hs-duo">
    <div class="card hs-card hs-feelcard">
      <div class="eyebrow">Sensación</div>
      ${f
        ? `<div class="hs-feelcard__emoji">${f.emoji}</div><div class="hs-feelcard__label">${esc(f.label)}</div>${ses.rpe ? `<div class="muted">Esfuerzo ${ses.rpe}/10</div>` : ''}`
        : `<button type="button" class="hs-add" data-hs="edit">${icon('plus', 18)}<span>Añadir</span></button>`}
    </div>
    <div class="card hs-card hs-hrcard">
      <div class="eyebrow">Pulso${series ? ' · Watch' : hasHr ? ' · a mano' : ''}</div>
      ${hasHr
        ? `<div class="hs-hrcard__vals">
             <div>${icon('heart', 16)}<b class="num">${ses.hrAvg || '–'}</b><span>media</span></div>
             <div><b class="num">${ses.hrMax || '–'}</b><span>máx.</span></div>
             ${ses.hrMin ? `<div><b class="num">${ses.hrMin}</b><span>mín.</span></div>` : ''}
           </div>
           ${zAvg ? `<span class="hs-zone" style="--zc:${zAvg.color}">${esc(zAvg.name)}</span>` : ''}`
        : `<button type="button" class="hs-add" data-hs="edit">${icon('watch', 18)}<span>Añadir FC</span></button>`}
    </div>
  </section>`);

  if (series) parts.push(...hrAnalysisParts(ses, s));
  else parts.push(hrCtaHtml(s));

  const changes = Array.isArray(ses.levelChanges) ? ses.levelChanges.filter((c) => c && c.level) : [];
  if (changes.length) {
    parts.push(`<section class="card hs-card">
      <div class="hs-card__head"><div class="eyebrow">Cambios de velocidad</div></div>
      <div class="hs-changes">${changes.map((c) => {
        const up = (c.to || 0) > (c.from || 0);
        return `<div class="hs-change" style="--zc:var(--z-${esc(c.level)})">
          <span class="hs-change__dot"></span>
          <span class="hs-change__name">${esc(ZONES[c.level]?.name || c.level)}</span>
          <span class="hs-change__vals num">${fmt.speed(c.from || 0)} → <b>${fmt.speed(c.to || 0)}</b></span>
          <span class="hs-change__arrow ${up ? 'is-up' : 'is-down'}">${icon(up ? 'arrow-up' : 'arrow-down', 14, { stroke: 3 })}</span>
        </div>`;
      }).join('')}</div>
    </section>`);
  }

  if (levels && LEVEL_KEYS.every((k) => typeof levels[k] === 'number')) {
    parts.push(`<section class="card hs-card">
      <div class="hs-card__head"><div class="eyebrow">Tus velocidades ese día</div></div>
      <div class="hs-levels">${LEVEL_KEYS.map((k) => `<div style="--zc:var(--z-${k})"><span>${esc(ZONES[k]?.short || k)}</span><b class="num">${fmt.speed(levels[k])}</b></div>`).join('')}</div>
    </section>`);
  }

  const music = sessionMusicHtml(ses);
  if (music) parts.push(music);

  parts.push(`<section class="card hs-card hs-notes">
    <div class="hs-card__head"><div class="eyebrow">Notas</div><button type="button" class="btn btn--ghost hs-mini" data-hs="edit">${icon('edit', 15)}<span>Editar</span></button></div>
    ${ses.notes ? `<p class="hs-notes__text">${esc(ses.notes)}</p>` : '<p class="muted">Sin notas. Apunta cómo te fue, qué música llevabas o cualquier detalle que quieras recordar.</p>'}
  </section>`);

  parts.push(`<section class="hs-actions stack">
    ${ses.workoutId ? `<button type="button" class="btn btn--primary btn--lg btn--block" data-href="#/play/${esc(encodeURIComponent(ses.workoutId))}">${icon('repeat', 20)}<span>Repetir esta clase</span></button>` : ''}
    <div class="grid-2">
      <button type="button" class="btn btn--secondary btn--block" data-hs="edit">${icon('edit', 18)}<span>Editar</span></button>
      <button type="button" class="btn btn--danger btn--block" data-hs="delete">${icon('trash', 18)}<span>Borrar</span></button>
    </div>
  </section>`);

  return parts.map((p, i) => `<div class="pg-part" style="--i:${i}">${p}</div>`).join('');
}

/* ───────────── pulso del Apple Watch ───────────── */

/** Perfil con la línea de pulso superpuesta (misma escala de tiempo). */
function profileHtml(ses, segs, levels) {
  const trace = Array.isArray(ses.speedTrace) && ses.speedTrace.length ? ses.speedTrace : null;
  const chart = profileChart(segs, { height: 150, trace, levels, showLevels: true, progressSec: ses.isTest ? null : traceCursorSec(ses), gaps: skippedRanges(ses) });
  return withHrOverlay(chart, ses, { segments: segs, height: 150 });
}

function hrCtaHtml(s) {
  const ready = isWatchShortcutReady(s);
  return `<section class="card hs-card whr-card whr-glow">
    <div class="whr-cta">
      <div class="whr-cta__row">
        <span class="whr-cta__icon" aria-hidden="true">${icon('watch', 24)}<i class="whr-beat">${icon('heart', 12, { stroke: 2.6 })}</i></span>
        <div><b class="whr-cta__title">Pulso del Apple Watch</b>
          <p class="whr-cta__text">Trae de Salud el pulso de esta sesión con un Atajo: lo verás sobre el perfil, por zonas y a cada velocidad.</p></div>
      </div>
      <button type="button" class="btn btn--secondary btn--lg btn--block whr-cta__btn" data-hs="hr-import">${icon('heart', 20)}<span>Importar pulso del Apple Watch</span></button>
      <div class="whr-cta__links">
        <button type="button" class="btn btn--ghost whr-mini" data-hs="hr-paste">${icon('copy', 15)}<span>Ya lo he copiado</span></button>
        <button type="button" class="btn btn--ghost whr-mini" data-hs="edit">${icon('edit', 15)}<span>Anotar a mano</span></button>
        ${ready ? '' : `<button type="button" class="btn btn--ghost whr-mini" data-href="#/settings/watch">${icon('info', 15)}<span>Cómo crear el Atajo</span></button>`}
      </div>
    </div>
  </section>`;
}

function hrAnalysisParts(ses, s) {
  const trends = safe(() => hrLevelTrends(s, ses), {});
  const zt = safe(() => hrZoneTimes(ses.hrSeries, s.profile), ses.hrZones || null);
  return [
    `<section class="card hs-card whr-card">
      <div class="hs-card__head"><div class="eyebrow">Zonas de pulso</div>
        <span class="whr-src__acts">
          <button type="button" class="btn btn--ghost whr-mini" data-hs="hr-import" aria-label="Volver a importar el pulso">${icon('refresh', 14)}<span>Reimportar</span></button>
          <button type="button" class="btn btn--ghost whr-mini" data-hs="hr-remove" aria-label="Quitar el pulso de esta sesión">${icon('trash', 14)}<span>Quitar</span></button>
        </span></div>
      ${hrZonesHtml(zt, s.profile)}
      ${hrMaxHintHtml(ses, s.profile)}
    </section>`,
    `<section class="card hs-card">
      <div class="hs-card__head"><div class="eyebrow">Pulso por velocidad</div></div>
      ${hrLevelsHtml(trends, s.profile)}
    </section>`,
  ];
}

/* ───────────── música de la sesión (js/integrations/session-music.js) ───────────── */

function notFoundHtml() {
  return `<section class="card hs-empty">
    <div class="hs-empty__art" aria-hidden="true"><span class="hs-empty__ring"></span><span class="hs-empty__icon">${icon('info', 34)}</span></div>
    <h2 class="hs-empty__title">No encuentro esta sesión</h2>
    <p class="hs-empty__text">Puede que se haya borrado. Vuelve al historial para ver el resto de tus entrenamientos.</p>
    <button type="button" class="btn btn--secondary btn--lg btn--block" data-href="#/history">${icon('list', 20)}<span>Ver historial</span></button>
  </section>`;
}

function awardAchievements() {
  let newAch = [];
  try { newAch = (evaluateAchievements(getState()) || []).filter((a) => a && a.id); } catch { newAch = []; }
  if (!newAch.length) return;
  const now = new Date().toISOString();
  setState((d) => {
    if (!d.achievements || typeof d.achievements !== 'object') d.achievements = {};
    for (const a of newAch) if (!d.achievements[a.id]) d.achievements[a.id] = now;
  });
  toast(newAch.length === 1 ? `Logro desbloqueado: ${newAch[0].title || 'nuevo logro'}` : `${newAch.length} logros desbloqueados`, { icon: 'medal', kind: 'success', duration: 3600 });
  safe(() => celebrate({ intensity: 1.2 }));
}

function openEdit(id) {
  const ses = getState().history?.find((h) => h.id === id);
  if (!ses) return;
  const feelings = Array.isArray(FEELINGS) ? FEELINGS : [];
  let feeling = ses.feeling || null;
  let sheetEl = null;
  const faces = feelings.map((f) => `<button type="button" class="hs-face${f.key === feeling ? ' is-on' : ''}" data-feel="${esc(f.key)}" aria-pressed="${f.key === feeling}">
      <span class="hs-face__emoji">${f.emoji}</span><span class="hs-face__label">${esc(f.label)}</span>
    </button>`).join('');
  openSheet({
    title: 'Editar sesión',
    html: `<div class="hs-edit stack">
      <div>
        <div class="field__label">¿Cómo te sentiste?</div>
        <div class="hs-faces" role="group" aria-label="Sensación">${faces}</div>
      </div>
      <div class="grid-2">
        <label class="hs-edit__field"><span class="field__label">FC media</span><input class="field" data-in="hrAvg" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="ppm" value="${ses.hrAvg || ''}"></label>
        <label class="hs-edit__field"><span class="field__label">FC máxima</span><input class="field" data-in="hrMax" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="ppm" value="${ses.hrMax || ''}"></label>
      </div>
      <p class="hs-edit__hint">${icon('watch', 14)} Las encuentras en la app Fitness → Entrenos → tu sesión de cinta.</p>
      <label class="hs-edit__field"><span class="field__label">Notas</span><textarea class="field hs-edit__notes" data-in="notes" rows="3" maxlength="600" placeholder="¿Algo que quieras recordar?">${esc(ses.notes || '')}</textarea></label>
    </div>`,
    onMount(el) {
      sheetEl = el;
      el.querySelectorAll('[data-feel]').forEach((b) => {
        b.addEventListener('click', () => {
          feeling = b.dataset.feel === feeling ? null : b.dataset.feel;
          haptic('selection');
          el.querySelectorAll('[data-feel]').forEach((x) => {
            const on = x.dataset.feel === feeling;
            x.classList.toggle('is-on', on);
            x.setAttribute('aria-pressed', String(on));
          });
        });
      });
    },
    actions: [
      {
        label: 'Guardar cambios',
        kind: 'primary',
        onClick(close) {
          const root = sheetEl || document;
          const read = (k) => root.querySelector(`[data-in="${k}"]`)?.value ?? '';
          const num = (k) => {
            const t = String(read(k)).trim();
            if (!t) return null;
            const n = Number.parseInt(t, 10);
            return Number.isFinite(n) ? n : NaN;
          };
          const hrAvg = num('hrAvg');
          const hrMax = num('hrMax');
          const bad = (v) => v != null && (Number.isNaN(v) || v < HR_ENTRY_MIN || v > HR_ENTRY_MAX);
          if (bad(hrAvg) || bad(hrMax)) {
            haptic('error');
            toast(`Revisa el pulso: debe estar entre ${HR_ENTRY_MIN} y ${HR_ENTRY_MAX} ppm`, { kind: 'error', icon: 'heart' });
            return;
          }
          if (hrAvg && hrMax && hrMax < hrAvg) {
            haptic('error');
            toast('La FC máxima no puede ser menor que la media', { kind: 'error', icon: 'heart' });
            return;
          }
          const notes = String(read('notes')).trim().slice(0, 600);
          const fdef = feelings.find((x) => x.key === feeling);
          setState((d) => {
            const x = (d.history || []).find((h) => h.id === id);
            if (!x) return;
            x.feeling = feeling;
            x.rpe = fdef ? fdef.rpe : null;
            x.hrAvg = hrAvg;
            x.hrMax = hrMax;
            x.notes = notes;
          });
          haptic('success');
          toast('Sesión actualizada', { icon: 'check', kind: 'success' });
          close();
        },
      },
      { label: 'Cancelar', kind: 'secondary', onClick: (close) => close() },
    ],
  });
}

function mountDetail(el, id) {
  const ses0 = getState().history?.find((h) => h.id === id) || null;
  el.innerHTML = `${navBar({
    title: ses0?.title || 'Sesión',
    large: true,
    back: '#/history',
    backLabel: 'Historial',
    right: ses0 ? '<button type="button" class="btn btn--ghost hs-nav-btn" data-hs="edit">Editar</button>' : '',
  })}<div class="container stack-lg hs-body hs-detail" data-body></div>`;
  const body = el.querySelector('[data-body]');
  const offHeader = safe(() => enableCollapsingHeader(el), null);
  let first = true;
  let raf = 0;
  let alive = true;
  let stopHr = null;
  ensureWatchHrStyles();

  const findSes = () => getState().history?.find((h) => h.id === id) || null;
  const saveHr = (res) => {
    if (!alive || !findSes()) return false;
    setState((d) => {
      const x = (d.history || []).find((h) => h.id === id);
      if (x) Object.assign(x, hrFieldsFrom(res, d.profile));
    });
    setTimeout(() => { if (alive) awardAchievements(); }, 1700);
    return true;
  };
  const hrOpts = () => ({ getSession: findSes, getState, onImported: saveHr });

  const render = () => {
    raf = 0;
    const s = getState();
    const ses = s.history?.find((h) => h.id === id);
    if (!ses) {
      body.innerHTML = `<div class="pg-part" style="--i:0">${notFoundHtml()}</div>`;
      el.querySelectorAll('.hs-nav-btn').forEach((b) => b.remove());
      return;
    }
    const cached = segCache.has(ses.id) ? segCache.get(ses.id) : null;
    body.innerHTML = detailHtml(ses, s, cached);
    body.classList.toggle('stagger', first);
    first = false;
    if (!segCache.has(ses.id) && ses.workoutId) {
      loadSegments(ses).then((segs) => {
        if (!alive || !segs) return;
        const host = body.querySelector('[data-profile]');
        const cur = getState().history?.find((h) => h.id === id);
        if (!host || !cur) return;
        host.innerHTML = profileHtml(cur, segs, cur.levelsAtStart || getState().levels);
      });
    }
    hydrateSessionMusic(body, ses, () => alive);
  };

  const onClick = async (e) => {
    const b = e.target.closest('[data-hs]');
    if (!b) return;
    if (b.dataset.hs === 'edit') {
      haptic('light');
      openEdit(id);
    } else if (b.dataset.hs === 'hr-import') {
      haptic('light');
      stopHr?.();
      stopHr = startWatchHrImport(hrOpts());
    } else if (b.dataset.hs === 'hr-paste') {
      haptic('light');
      openWatchHrSheet(hrOpts()).catch(() => {});
    } else if (b.dataset.hs === 'hr-remove') {
      const ok = await confirmDialog({
        title: '¿Quitar el pulso?',
        message: 'Se borrarán el gráfico y las zonas de pulso de esta sesión. Podrás volver a importarlo cuando quieras.',
        confirmText: 'Quitar',
        cancelText: 'Cancelar',
        destructive: true,
      });
      if (!ok || !alive) return;
      setState((d) => {
        const x = (d.history || []).find((h) => h.id === id);
        if (x) Object.assign(x, hrFieldsCleared());
      });
      haptic('success');
      toast('Pulso quitado de la sesión', { icon: 'check' });
    } else if (b.dataset.hs === 'delete') {
      const done = await deleteSession(id);
      if (done) back('#/history');
    }
  };

  el.addEventListener('click', onClick);
  const unsub = subscribe(() => {
    if (!raf) raf = requestAnimationFrame(render);
  });
  render();
  // La app pudo recargarse mientras estabas en Atajos: retomamos la importación
  if (ses0 && !hasHrSeries(ses0) && hasPendingWatchHr(id)) {
    setTimeout(() => { if (alive) openWatchHrSheet(hrOpts()).catch(() => {}); }, 650);
  }

  return () => {
    alive = false;
    stopHr?.();
    unsub?.();
    if (raf) cancelAnimationFrame(raf);
    el.removeEventListener('click', onClick);
    if (typeof offHeader === 'function') offHeader();
  };
}

/* ───────────── montaje ───────────── */

export function mount(el, { params } = {}) {
  el.classList.add('hs-screen');
  const id = params?.id ? safe(() => decodeURIComponent(params.id), params.id) : null;
  return id ? mountDetail(el, id) : mountList(el);
}
