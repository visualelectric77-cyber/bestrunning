// BestRunning · router por hash (compatible con GitHub Pages) con transiciones y navegación declarativa.
import { getState } from './store.js';

const routes = [];
let outlet = null;
let started = false;
let current = null; // ruta montada
let currentEl = null;
let currentCleanup = null;
let renderToken = 0;
let histIdx = 0;
let lastHash = null;
let redirects = 0;
const scrollMemory = new Map(); // hash → scrollTop de su pantalla

/* ───── Utilidades de rutas ───── */

function normalize(path) {
  let p = String(path ?? '').trim();
  if (p.startsWith('#')) p = p.slice(1);
  if (!p.startsWith('/')) p = '/' + p;
  return p;
}

const toHash = (path) => '#' + normalize(path);
const normHash = (hash) => toHash(hash || '/');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(pattern) {
  const clean = normalize(pattern).split('?')[0].replace(/\/+$/, '') || '/';
  const keys = [];
  const body = clean
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        keys.push(part.slice(1));
        return '([^/]+)';
      }
      return escapeRe(part);
    })
    .join('/');
  return { clean, keys, re: new RegExp(`^${body}/?$`) };
}

function parse(hash) {
  const full = normalize(hash || '/');
  const qi = full.indexOf('?');
  const pathPart = (qi >= 0 ? full.slice(0, qi) : full).replace(/\/+$/, '') || '/';
  const qs = qi >= 0 ? full.slice(qi + 1) : '';
  const query = {};
  try {
    for (const [k, v] of new URLSearchParams(qs)) query[k] = v;
  } catch {
    /* query mal formada */
  }
  return { pathPart, query };
}

function match(pathPart) {
  for (const r of routes) {
    const m = r.re.exec(pathPart);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => {
      try {
        params[k] = decodeURIComponent(m[i + 1]);
      } catch {
        params[k] = m[i + 1];
      }
    });
    return { route: r, params };
  }
  return null;
}

function defaultPath() {
  let onboarded = false;
  try {
    onboarded = !!getState().onboarded;
  } catch {
    /* estado ilegible */
  }
  return onboarded ? '/today' : '/onboarding';
}

function prefersReducedMotion() {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function report(err) {
  if (typeof reportError === 'function') reportError(err);
  else setTimeout(() => { throw err; });
}

/* ───── API pública ───── */

export function registerRoute(pattern, { load, tab = null, fullscreen = false, push = false } = {}) {
  const c = compile(pattern);
  routes.push({ pattern: '#' + c.clean, keys: c.keys, re: c.re, load, tab, fullscreen, push });
}

export function navigate(path, { replace = false } = {}) {
  go(path, replace ? 'replace' : 'push', replace);
}

export function back(fallback = '#/today') {
  const st = history.state;
  if (st && st.br && st.idx > 0) {
    history.back();
    return;
  }
  go(fallback || '#/today', 'back', true);
}

export function currentRoute() {
  if (current) return { ...current };
  const { pathPart, query } = parse(location.hash);
  const found = match(pathPart);
  return {
    path: pathPart,
    pattern: found?.route.pattern ?? null,
    params: found?.params ?? {},
    query,
    tab: found?.route.tab ?? null,
    fullscreen: !!found?.route.fullscreen,
  };
}

export function startRouter(outletEl) {
  outlet = outletEl || document.getElementById('view');
  if (started) return;
  started = true;
  try {
    history.scrollRestoration = 'manual';
  } catch {
    /* nada */
  }
  const st = history.state;
  if (st && st.br) histIdx = Number(st.idx) || 0;
  else history.replaceState({ br: true, idx: 0 }, '', location.href);

  window.addEventListener('popstate', onPopState);
  window.addEventListener('hashchange', onHashChange);
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeyDown);
  render('initial');
}

/* ───── Navegación interna ───── */

function go(path, navType, replace) {
  const hash = toHash(path);
  if (!started) {
    location.hash = hash;
    return;
  }
  if (!replace && normHash(location.hash) === normHash(hash)) replace = true; // evita entradas duplicadas
  if (replace) history.replaceState({ br: true, idx: histIdx }, '', hash);
  else {
    histIdx += 1;
    history.pushState({ br: true, idx: histIdx }, '', hash);
  }
  render(navType);
}

function redirect(path) {
  redirects += 1;
  if (redirects > 4) {
    redirects = 0;
    mountFallback(new Error(`Ruta no encontrada: ${path}`));
    return;
  }
  history.replaceState({ br: true, idx: histIdx }, '', toHash(path));
  render('replace');
}

function onPopState(e) {
  const st = e.state;
  let navType;
  if (st && st.br) {
    const idx = Number(st.idx) || 0;
    navType = idx < histIdx ? 'back' : 'forward';
    histIdx = idx;
    // Gesto de borde de iOS: el sistema ya ha animado la vuelta; no se repite la transición propia
    if (e.hasUAVisualTransition) navType = navType === 'back' ? 'back-ua' : 'forward-ua';
  } else {
    // Cambio manual del hash o <a href="#/…">: lo adoptamos como entrada propia.
    histIdx += 1;
    history.replaceState({ br: true, idx: histIdx }, '', location.href);
    navType = 'push';
  }
  render(navType);
}

function onHashChange() {
  if (normHash(location.hash) === lastHash) return; // ya lo gestionó popstate
  const st = history.state;
  if (!st || !st.br) {
    histIdx += 1;
    history.replaceState({ br: true, idx: histIdx }, '', location.href);
  }
  render('push');
}

async function render(navType) {
  lastHash = normHash(location.hash);
  const { pathPart, query } = parse(location.hash);
  if (pathPart === '/') return redirect(defaultPath());

  let onboarded = true;
  try {
    onboarded = !!getState().onboarded;
  } catch {
    /* nada */
  }
  const onboardingRegistered = routes.some((r) => r.pattern === '#/onboarding');
  if (!onboarded && onboardingRegistered && pathPart !== '/onboarding') return redirect('/onboarding');

  const found = match(pathPart);
  if (!found) return redirect(defaultPath());
  redirects = 0;

  const token = ++renderToken;
  let mod;
  try {
    mod = await found.route.load();
  } catch (err) {
    if (token !== renderToken) return;
    report(err);
    mod = errorModule();
  }
  if (token !== renderToken) return;

  const route = {
    path: pathPart,
    pattern: found.route.pattern,
    params: found.params,
    query,
    tab: found.route.tab,
    fullscreen: !!found.route.fullscreen,
    push: !!found.route.push,
    hash: lastHash,
  };
  swap(mod, route, navType);
}

function transitionType(prev, next, navType) {
  if (!prev || navType === 'initial' || navType === 'back-ua' || navType === 'forward-ua') return 'none';
  if (next.fullscreen && !prev.fullscreen) return 'modal-in';
  if (prev.fullscreen && !next.fullscreen) return navType === 'back' ? 'modal-out' : 'fade';
  if (prev.fullscreen && next.fullscreen) return 'fade';
  if (navType === 'tab') return 'tab';
  if (navType === 'back') return prev.push || prev.tab === next.tab ? 'pop' : 'tab';
  if (next.push && prev.hash !== next.hash) return 'push';
  if (prev.tab !== next.tab) return 'tab';
  return 'fade';
}

function canTransition() {
  return (
    typeof document.startViewTransition === 'function' &&
    !prefersReducedMotion() &&
    document.visibilityState === 'visible'
  );
}

function swap(mod, route, navType) {
  const prev = current;
  const type = transitionType(prev, route, navType);
  if (prev && currentEl) scrollMemory.set(prev.hash, currentEl.scrollTop);
  const restoreTo = ['back', 'forward', 'back-ua', 'forward-ua', 'tab'].includes(navType) ? scrollMemory.get(route.hash) || 0 : 0;

  const apply = () => {
    try {
      window.dispatchEvent(new CustomEvent('br:navigate', { detail: { route, prev } }));
    } catch {
      /* nada */
    }
    if (currentCleanup) {
      try {
        currentCleanup();
      } catch (err) {
        report(err);
      }
    }
    currentCleanup = null;
    if (currentEl) currentEl.remove();
    if (!outlet) return;

    const el = document.createElement('section');
    el.className = 'screen' + (route.fullscreen ? ' screen--fullscreen' : '');
    el.dataset.route = route.pattern.replace(/^#\//, '').split('/')[0];
    outlet.appendChild(el);
    currentEl = el;
    current = route;

    document.body.classList.toggle('is-fullscreen', route.fullscreen);
    // iOS: en las pantallas empujadas (no raíz de pestaña) la tab bar se oculta
    document.body.classList.toggle('is-pushed', !route.fullscreen && route.push);
    document.body.dataset.tab = route.tab || '';
    updateTabbar(activeTabFor(route));

    try {
      const res = typeof mod?.mount === 'function' ? mod.mount(el, { params: route.params, query: route.query, route: { ...route } }) : null;
      if (res && typeof res.then === 'function') {
        res
          .then((fn) => {
            if (typeof fn !== 'function') return;
            if (currentEl === el) currentCleanup = fn;
            else fn();
          })
          .catch((err) => {
            report(err);
            if (currentEl === el) renderError(el);
          });
      } else if (typeof res === 'function') currentCleanup = res;
    } catch (err) {
      report(err);
      renderError(el);
    }

    if (restoreTo > 0) {
      el.scrollTop = restoreTo;
      requestAnimationFrame(() => {
        if (currentEl === el && el.scrollTop !== restoreTo) el.scrollTop = restoreTo;
      });
    }
    try {
      window.dispatchEvent(new CustomEvent('br:route', { detail: { route: { ...route }, prev } }));
    } catch {
      /* nada */
    }
  };

  if (type !== 'none' && canTransition()) {
    const root = document.documentElement;
    root.dataset.nav = type;
    try {
      const vt = document.startViewTransition(apply);
      const done = () => {
        if (root.dataset.nav === type) delete root.dataset.nav;
      };
      vt.finished.then(done, done);
      vt.ready?.catch?.(() => {});
    } catch {
      delete root.dataset.nav;
      apply();
    }
  } else {
    apply();
  }
}

/** En pantallas apiladas, resalta la pestaña de origen (?from=today|plan|history…) y no la de registro. */
const FROM_TAB = { today: 'today', plan: 'plan', library: 'library', history: 'progress', progress: 'progress', settings: 'settings' };
function activeTabFor(route) {
  if (route?.push) {
    const from = route.query?.from;
    if (from && FROM_TAB[from]) return FROM_TAB[from];
  }
  return route?.tab ?? null;
}

function updateTabbar(tab) {
  const items = document.querySelectorAll('#tabbar [data-tab]');
  items.forEach((it) => {
    const on = it.dataset.tab === tab;
    it.classList.toggle('is-active', on);
    if (on) it.setAttribute('aria-current', 'page');
    else it.removeAttribute('aria-current');
  });
}

function goTab(tab, href) {
  const root = href || `#/${tab}`;
  // HIG: cambiar de pestaña no lleva háptica (solo los cambios de valor, confirmaciones y errores)
  if (current && current.tab === tab) {
    if (normHash(location.hash) !== normHash(root)) go(root, 'back', false);
    else currentEl?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    return;
  }
  go(root, 'tab', false);
}

/* ───── Delegación global ───── */

const INNER_INTERACTIVE =
  'a[href], button, input, select, textarea, label, summary, [data-action], [role="button"], [role="switch"], [role="link"], [data-stepper], [data-segmented]';

function onClick(e) {
  if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const t = e.target instanceof Element ? e.target : e.target?.parentElement;
  if (!t) return;

  const tabEl = t.closest('#tabbar [data-tab]');
  if (tabEl) {
    e.preventDefault();
    goTab(tabEl.dataset.tab, tabEl.dataset.href || tabEl.getAttribute('href'));
    return;
  }

  const el = t.closest('[data-href], [data-action="back"]');
  if (!el) return;
  if (el.matches('[disabled], [aria-disabled="true"]')) return;
  const inner = t.closest(INNER_INTERACTIVE);
  if (inner && inner !== el && el.contains(inner)) return; // el elemento interior tiene su propia acción

  e.preventDefault();
  if (el.dataset.action === 'back' && !el.dataset.href) {
    back(el.dataset.fallback || '#/today');
    return;
  }
  const href = el.dataset.href;
  if (href) navigate(href, { replace: el.hasAttribute('data-replace') });
}

function onKeyDown(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.matches('a, button, input, select, textarea, summary')) return; // ya generan clic nativo
  if (!t.matches('[data-href], [data-action="back"]')) return;
  e.preventDefault();
  t.click();
}

/* ───── Errores ───── */

function errorHtml() {
  return `<div class="container router-error">
    <div class="empty-state">
      <div class="empty-state__icon"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.4h.01"/></svg></div>
      <h3>No hemos podido abrir esta pantalla</h3>
      <p>Comprueba la conexión e inténtalo de nuevo.</p>
      <div class="row" style="justify-content:center;margin-top:12px">
        <button type="button" class="btn btn--primary" data-router-retry>Reintentar</button>
        <button type="button" class="btn btn--ghost" data-href="#/today" data-replace>Ir a Hoy</button>
      </div>
    </div>
  </div>`;
}

function renderError(el) {
  el.innerHTML = errorHtml();
  el.querySelector('[data-router-retry]')?.addEventListener('click', () => render('replace'));
}

function errorModule() {
  return { mount: (el) => renderError(el) };
}

function mountFallback(err) {
  report(err);
  swap(errorModule(), { path: '/', pattern: '#/', params: {}, query: {}, tab: null, fullscreen: false, push: false, hash: '#/' }, 'replace');
}
