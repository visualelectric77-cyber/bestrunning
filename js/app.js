// BestRunning · arranque de la app: rutas, tab bar, service worker y detalles nativos de iOS.
import { registerRoute, startRouter, navigate, currentRoute } from './core/router.js';
import { loadActiveSession, saveActiveSession, activeSessionSavedAt } from './core/store.js';
import { icon, toast, openSheet } from './ui/components.js';
import { esc, fmt } from './core/utils.js';
import { APP_VERSION } from './version.js';

const RESUME_MAX_MS = 3 * 3600 * 1000;
const STALE_MS = 24 * 3600 * 1000;

/* ───── Rutas ───── */

function routes() {
  registerRoute('#/onboarding', { load: () => import('./screens/onboarding.js'), fullscreen: true });
  registerRoute('#/today', { load: () => import('./screens/today.js'), tab: 'today' });
  registerRoute('#/plan', { load: () => import('./screens/plan.js'), tab: 'plan' });
  registerRoute('#/library', { load: () => import('./screens/library.js'), tab: 'library' });
  registerRoute('#/workout/:id', { load: () => import('./screens/workout.js'), tab: 'library', push: true });
  registerRoute('#/progress', { load: () => import('./screens/progress.js'), tab: 'progress' });
  registerRoute('#/history', { load: () => import('./screens/history.js'), tab: 'progress', push: true });
  registerRoute('#/history/:id', { load: () => import('./screens/history.js'), tab: 'progress', push: true });
  registerRoute('#/settings', { load: () => import('./screens/settings.js'), tab: 'settings' });
  registerRoute('#/settings/:section', { load: () => import('./screens/settings.js'), tab: 'settings', push: true });
  registerRoute('#/play/:id', { load: () => import('./screens/player.js'), fullscreen: true });
  registerRoute('#/summary/:id', { load: () => import('./screens/summary.js'), fullscreen: true });
}

/* ───── Tab bar ───── */

const TABS = [
  { tab: 'today', label: 'Hoy', icon: 'home', href: '#/today' },
  { tab: 'plan', label: 'Plan', icon: 'calendar', href: '#/plan' },
  { tab: 'library', label: 'Clases', icon: 'grid', href: '#/library' },
  { tab: 'progress', label: 'Progreso', icon: 'chart', href: '#/progress' },
  { tab: 'settings', label: 'Perfil', icon: 'person', href: '#/settings' },
];

function renderTabbar() {
  const nav = document.getElementById('tabbar');
  if (!nav) return;
  nav.innerHTML = `<div class="tabbar__inner">${TABS.map(
    (t) =>
      `<button type="button" class="tabbar__item" data-tab="${t.tab}" data-href="${t.href}" aria-label="${t.label}"><span class="tabbar__icon">${icon(t.icon, 24, { stroke: 2 })}</span><span class="tabbar__label">${t.label}</span></button>`,
  ).join('')}</div>`;
}

/* ───── Detalles nativos ───── */

function nativeTweaks() {
  const root = document.documentElement;
  const standalone =
    navigator.standalone === true ||
    (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  root.classList.toggle('is-standalone', standalone);
  root.dataset.version = APP_VERSION;

  // Sin zoom por gestos (pinza) ni doble toque
  const block = (e) => e.preventDefault();
  document.addEventListener('gesturestart', block, { passive: false });
  document.addEventListener('gesturechange', block, { passive: false });
  document.addEventListener('gestureend', block, { passive: false });
  document.addEventListener('dblclick', (e) => {
    if (!e.target.closest?.('input, textarea, [contenteditable="true"]')) e.preventDefault();
  }, { passive: false });

  // Activa :active en iOS
  document.addEventListener('touchstart', () => {}, { passive: true });

  // Sin menú contextual del sistema salvo en campos de texto
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest?.('input, textarea, [contenteditable="true"], .selectable')) e.preventDefault();
  });
}

/* ───── Errores globales ───── */

function errorToasts() {
  let last = 0;
  const show = () => {
    const now = Date.now();
    if (now - last < 5000) return;
    last = now;
    toast('Algo ha fallado. Si se repite, recarga la app.', { kind: 'error', duration: 3600 });
  };
  window.addEventListener('error', (e) => {
    if (e.target && e.target !== window) return; // fallos de carga de recursos
    const msg = String(e.message || '');
    if (/ResizeObserver loop|Script error\.?$/i.test(msg)) return;
    show();
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r && (r.name === 'AbortError' || r.name === 'NotAllowedError')) return; // p. ej. share cancelado
    show();
  });
  // Almacenamiento lleno: un aviso como mucho por minuto (cualquier setState repetido lo volvería a emitir)
  let storageToastAt = -Infinity;
  window.addEventListener('br:storage-error', () => {
    const now = Date.now();
    if (now - storageToastAt < 60000) return;
    storageToastAt = now;
    toast('No se pudo guardar: el almacenamiento está lleno.', { kind: 'error', duration: 4200 });
  });
}

/* ───── Service worker ───── */

function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (location.protocol !== 'https:' && !local) return;
  // ?nosw=1 (desarrollo): sin service worker ni caché del shell, siempre los archivos recién servidos
  if (/[?&]nosw=1(?:&|$)/.test(location.search)) {
    navigator.serviceWorker.getRegistrations?.()
      .then((regs) => regs.forEach((r) => r.unregister().catch(() => {})))
      .catch(() => {});
    globalThis.caches?.keys?.()
      .then((keys) => keys.filter((k) => k.startsWith('br-shell-')).forEach((k) => caches.delete(k)))
      .catch(() => {});
    return;
  }

  let updateRequested = false;
  let prompted = false;

  const promptUpdate = (worker) => {
    if (!worker || prompted) return;
    const show = () => {
      prompted = true;
      toast('Nueva versión disponible · Toca para actualizar', {
        icon: 'sparkles',
        kind: 'info',
        duration: 0,
        onClick: () => {
          updateRequested = true;
          worker.postMessage({ type: 'SKIP_WAITING' });
        },
      });
    };
    // No interrumpas un entrenamiento: espera a salir del reproductor.
    if (currentRoute().pattern === '#/play/:id') {
      const onRoute = () => {
        if (currentRoute().pattern === '#/play/:id') return;
        window.removeEventListener('br:route', onRoute);
        show();
      };
      window.addEventListener('br:route', onRoute);
    } else show();
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested) return;
    updateRequested = false;
    location.reload();
  });

  const register = () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(nw);
          });
        });
        // Busca actualizaciones al volver a la app
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/* ───── Sesión a medias ───── */

function checkActiveSession() {
  let snap = null;
  try {
    snap = loadActiveSession();
  } catch {
    snap = null;
  }
  if (!snap) return;
  const savedAt = activeSessionSavedAt();
  const age = savedAt ? Date.now() - savedAt : Infinity;
  if (age > STALE_MS) {
    saveActiveSession(null);
    return;
  }
  if (age > RESUME_MAX_MS) return;
  const cur = currentRoute();
  const pattern = cur.pattern;
  if (pattern === '#/summary/:id' || pattern === '#/onboarding') return;
  if (pattern === '#/play/:id') {
    // En el reproductor solo avisamos si se abrió OTRA clase distinta de la que quedó a medias
    let id = String(cur.params?.id || '');
    try { id = decodeURIComponent(id); } catch { /* tal cual */ }
    if (id === 'resume' || id === String(snap.workoutId || '')) return;
  }

  const title = snap.title || snap.workout?.title || snap.workoutTitle || '';
  const elapsed = Number(snap.activeSec ?? snap.totalElapsed ?? snap.elapsed ?? 0) || 0;
  const mins = Math.round(age / 60000);
  const ago = mins < 1 ? 'hace un momento' : mins < 60 ? `hace ${mins} min` : `hace ${fmt.durationLong(age / 1000)}`;
  // Espacios duros entre cifra y unidad: «2 h 01 min» nunca se parte en dos líneas
  const agoHtml = esc(ago).replace(/(\d) (?=h\b|min\b)/g, '$1&nbsp;');
  const detail = [title ? `<strong>${esc(title)}</strong>` : 'Tu entrenamiento', elapsed > 0 ? `llevabas ${esc(fmt.clock(elapsed))}` : '', `guardado ${agoHtml}`]
    .filter(Boolean)
    .join(' · ');

  openSheet({
    title: 'Tienes un entrenamiento a medias',
    html: `<div class="resume-sheet"><div class="resume-sheet__icon">${icon('timer', 30, { stroke: 2 })}</div><p>${detail}.</p><p>¿Seguimos donde lo dejaste? Sube a la cinta antes de reanudar.</p></div>`,
    actions: [
      {
        label: 'Reanudar',
        kind: 'primary',
        onClick: (close) => {
          close();
          navigate('#/play/resume');
        },
      },
      {
        label: 'Descartar',
        kind: 'destructive',
        onClick: (close) => {
          saveActiveSession(null);
          close();
          toast('Entrenamiento descartado', { icon: 'trash' });
        },
      },
    ],
  });
}

/* ───── Arranque ───── */

/**
 * Recarga en mitad de una clase (iOS mata el proceso por memoria WebGL, recarga manual o
 * relanzamiento en la última URL): si la URL es #/play/<id> y hay una instantánea viva de esa
 * misma clase, entramos directamente por #/play/resume para no empezar de cero ni pisarla.
 */
function redirectReloadedPlay() {
  try {
    const m = /^#\/play\/([^?/]+)/.exec(location.hash || '');
    if (!m) return;
    let id = m[1];
    try { id = decodeURIComponent(id); } catch { /* tal cual */ }
    if (id === 'resume') return;
    const snap = loadActiveSession();
    if (!snap || String(snap.workoutId || '') !== id) return;
    const savedAt = activeSessionSavedAt();
    const age = savedAt ? Date.now() - savedAt : Infinity;
    if (age > RESUME_MAX_MS) return;
    history.replaceState(history.state, '', '#/play/resume');
  } catch {
    /* sin almacenamiento: arranque normal */
  }
}

function boot() {
  redirectReloadedPlay();
  nativeTweaks();
  errorToasts();
  renderTabbar();
  routes();
  startRouter(document.getElementById('view'));
  setupServiceWorker();

  requestAnimationFrame(() => {
    document.documentElement.classList.add('is-booted');
    setTimeout(() => document.getElementById('boot')?.remove(), 600);
  });

  setTimeout(checkActiveSession, 700);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
