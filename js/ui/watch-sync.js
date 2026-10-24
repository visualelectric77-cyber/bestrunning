// RITMUP · aviso «Sincronizando con tu Apple Watch» al terminar una clase en la app nativa.
// Al acabar, el reloj cierra su entreno, lo guarda en Salud y manda al iPhone el pulso de toda la sesión: en clases
// largas tarda, y sin nada en pantalla la app parecía colgada. Este aviso flota arriba hasta que llega el resumen del
// reloj (evento br:native-hr con el id de la sesión) o pasan 2 min. La luz que recorre la calle es una animación CSS de
// transform: la mueve el compositor, así que sigue moviéndose aunque la página esté ocupada.

const MAX_MS = 120000;
const DONE_MS = 1800;

/**
 * Enseña el aviso para la sesión `sessionId`. Devuelve una función que lo quita (al salir del resumen).
 * No hace nada fuera del navegador.
 */
export function showWatchSync(sessionId) {
  if (typeof document === 'undefined' || !sessionId) return () => {};
  document.getElementById('watch-sync')?.remove();
  const el = document.createElement('div');
  el.id = 'watch-sync';
  el.className = 'wsync';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `
    <span class="wsync__ic" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="5" width="12" height="14" rx="3.5"/><path d="M9 5l.6-2.2h4.8L15 5M9 19l.6 2.2h4.8L15 19"/></svg>
    </span>
    <span class="wsync__txt"><b>Sincronizando con tu Apple Watch</b><small>Guardando el entreno y tu pulso en Salud</small></span>
    <span class="wsync__track" aria-hidden="true"><i></i></span>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));

  let gone = false;
  let t1 = 0;
  let t2 = 0;
  const remove = () => {
    if (gone) return;
    gone = true;
    window.removeEventListener('br:native-hr', onDone);
    clearTimeout(t1);
    clearTimeout(t2);
    el.classList.remove('is-in');
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 320);
  };
  const onDone = (e) => {
    if (gone || String(e?.detail?.sessionId || '') !== String(sessionId)) return;
    el.classList.add('is-done');
    const txt = el.querySelector('.wsync__txt');
    if (txt) txt.innerHTML = '<b>Sincronizado con tu Apple Watch</b><small>Entreno y pulso guardados en Salud</small>';
    t2 = setTimeout(remove, DONE_MS);
  };
  window.addEventListener('br:native-hr', onDone);
  t1 = setTimeout(remove, MAX_MS);
  return remove;
}
