// RITMUP · Laboratorio «Clase con vídeo de YouTube» (beta). Fondo opcional de la clase con el reproductor OFICIAL de
// YouTube (IFrame Player API), en lugar del mundo 3D y de la música DJ. Solo se carga con el interruptor del
// laboratorio (localStorage 'ritmup.lab.youtube' === 'on'); el script de YouTube, solo al elegir «Vídeo de YouTube».
//
// Política de YouTube (obligatoria): NADA delante de ninguna parte del reproductor (ni HUD, ni botones, ni velos),
// mínimo 200×200, sin ocultar anuncios ni marca y nunca solo el audio con el vídeo oculto. La disposición está en
// css/youtube.css: el reproductor tiene su propia celda de la rejilla y el HUD va en otra.
//
// Audio: el vídeo suena dentro de su iframe (otro documento, otro origen). El coach (Web Audio) sigue igual; mientras
// habla (señal 'br:voice' de speech.js, la misma con la que music.js agacha la DJ) el vídeo baja a 30 y luego vuelve.
// OJO: en iPhone el volumen de un vídeo lo manda solo el usuario (iOS ignora el volumen por JavaScript), así que allí
// este «agacharse» seguramente no se nota. No se usa mute() a propósito: un vídeo mudo en marcha puede dejar la sesión
// de audio de WebKit en «ambient» (memoria «audio sagrado»).
import { icon } from '../ui/components.js';
import { esc } from '../core/utils.js';
import { defaultTitle, thumbUrl, watchUrl } from './youtube-link.js';

export * from './youtube-link.js';

const API_URL = 'https://www.youtube.com/iframe_api';
const API_TIMEOUT_MS = 15000;
const DUCK_VOL = 30;
const DUCK_RELEASE_MS = 300;     // entre dos frases seguidas del coach el vídeo no sube y baja
const VOICE_STUCK_MS = 20000;    // como music.js: si nunca llega «speaking: false», el vídeo vuelve igual
const TAP_HINT_MS = 4500;        // sin reproducción tras pedirla (iOS sin gesto dentro del iframe): «toca el vídeo»
const MAX_SKIP_ERRORS = 3;       // en una lista, un vídeo que no se puede incrustar se salta (hasta 3 seguidos)
const READY_TIMEOUT_MS = 20000; // el reproductor no llega a estar listo (red mala, bloqueado): fuera
const CHECK_MS = 5000;           // comprobación de «no disponible» que YouTube no siempre avisa con onError
const ST = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

const safe = (fn, d) => { try { return fn(); } catch { return d; } };

/* ───────── Hoja de estilos (solo con el laboratorio) ───────── */
export function ensureYtCss() {
  try {
    if (document.querySelector('link[data-yt-css]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = new URL('../../css/youtube.css', import.meta.url).href;
    l.dataset.ytCss = '1';
    document.head.appendChild(l);
  } catch { /* sin DOM */ }
}

/* ───────── IFrame Player API, a demanda ───────── */
let apiP = null;
export function loadYouTubeApi(timeoutMs = API_TIMEOUT_MS) {
  const YT0 = globalThis.YT;
  if (YT0 && typeof YT0.Player === 'function') return Promise.resolve(YT0);
  if (apiP) return apiP;
  let script = null;
  apiP = new Promise((resolve, reject) => {
    const prev = globalThis.onYouTubeIframeAPIReady;
    const t = setTimeout(() => reject(new Error('youtube: tiempo agotado')), timeoutMs);
    globalThis.onYouTubeIframeAPIReady = () => {
      clearTimeout(t);
      if (typeof prev === 'function') safe(() => prev());
      if (typeof globalThis.YT?.Player === 'function') resolve(globalThis.YT);
      else reject(new Error('youtube: sin API'));
    };
    script = document.createElement('script');
    script.src = API_URL;
    script.async = true;
    script.onerror = () => { clearTimeout(t); reject(new Error('youtube: no carga')); };
    document.head.appendChild(script);
  }).catch((err) => {
    apiP = null; // el siguiente intento vuelve a pedirlo (sin red en el gimnasio, luego con red)
    safe(() => script?.remove());
    throw err;
  });
  return apiP;
}

/* ───────── Preparación: «Fondo» (Mundo 3D · Vídeo de YouTube) ───────── */
/**
 * st: { bg: 'world'|'youtube', pick, draft, err, recents, own (modo «Mi música»), worldName }
 * Acciones (data-act): yt-bg (data-value), yt-paste, yt-recent (data-i), yt-clear. Campo: [data-yt-input].
 */
export function readyHtml(st = {}) {
  const yt = st.bg === 'youtube';
  const opt = (v, label) => `<button type="button" role="radio" class="segmented__opt${(st.bg === v) ? ' is-active' : ''}" aria-checked="${st.bg === v}" data-act="yt-bg" data-value="${v}">${esc(label)}</button>`;
  const seg = `<div class="segmented pl-ytp__seg" role="radiogroup" aria-label="Fondo de la clase" style="--count:2;--index:${yt ? 1 : 0}"><span class="segmented__thumb" aria-hidden="true"></span>${opt('world', 'Mundo 3D')}${opt('youtube', 'Vídeo de YouTube')}</div>`;
  if (!yt) {
    return `<section class="pl-ready__group pl-ytp" data-slot="yt" style="--i:3">
        <h2 class="list-header">Fondo</h2>${seg}
      </section>`;
  }
  const pick = st.pick;
  const recents = (st.recents || []).filter((r) => !pick || r.videoId !== pick.videoId || r.list !== pick.list);
  const thumb = (it) => {
    const src = thumbUrl(it);
    return src
      ? `<img src="${esc(src)}" width="320" height="180" alt="" decoding="async" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="pl-ytp__ph" aria-hidden="true">${icon('list', 20)}</span>`;
  };
  const kind = (it) => (it.kind === 'playlist' ? (it.videoId ? 'Lista · empieza en este vídeo' : 'Lista de reproducción') : it.music ? 'YouTube Music' : 'Vídeo');
  const pickHtml = pick ? `<div class="pl-ytp__pick">
        <span class="pl-ytp__thumb">${thumb(pick)}</span>
        <span class="pl-ytp__txt"><b>${esc(pick.title || defaultTitle(pick))}</b><small>${esc(kind(pick))} · solo en esta clase</small></span>
        <button type="button" class="pl-ytp__x" data-act="yt-clear" aria-label="Quitar este vídeo">${icon('close', 15)}</button>
      </div>` : '';
  const recHtml = recents.length ? `<div class="pl-ytp__rec">
        <h3 class="pl-ytp__h">Últimos usados</h3>
        <ul class="pl-ytp__list">${recents.map((r) => `<li><button type="button" class="pl-ytp__row" data-act="yt-recent" data-i="${(st.recents || []).indexOf(r)}">
          <span class="pl-ytp__thumb pl-ytp__thumb--sm">${thumb(r)}</span>
          <span class="pl-ytp__txt"><b>${esc(r.title || defaultTitle(r))}</b><small>${esc(kind(r))}</small></span>
        </button></li>`).join('')}</ul>
      </div>` : '';
  const note = st.own
    ? 'Suena el vídeo y el coach habla encima. Su sonido sustituye a tu Spotify o Apple Music en esta clase.'
    : 'Suena el vídeo y el coach habla encima: la música DJ se apaga en esta clase. Con el reproductor oficial de YouTube, anuncios incluidos.';
  return `<section class="pl-ready__group pl-ytp" data-slot="yt" style="--i:3">
      <h2 class="list-header">Fondo</h2>${seg}
      <div class="pl-ytp__box">
        <div class="pl-ytp__field">
          <input class="field" type="url" inputmode="url" enterkeyhint="done" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
            placeholder="Pega un enlace de YouTube" aria-label="Enlace de YouTube" data-yt-input value="${esc(st.draft || '')}">
          <button type="button" class="btn btn--secondary btn--sm pl-ytp__paste" data-act="yt-paste">Pegar</button>
        </div>
        ${st.err ? `<p class="pl-ytp__err" role="alert">${esc(st.err)}</p>` : ''}
        ${pickHtml}
        ${recHtml}
        <p class="pl-ytp__note">${esc(note)}</p>
      </div>
    </section>`;
}

/* ───────── Clase: el reproductor en su recuadro + nuestra barra (debajo, nunca encima) ───────── */
export function liveHtml(pick) {
  const list = !!pick?.list;
  return `<div class="pl-yt" data-ref="ytBox"><div class="pl-yt__host" data-ref="ytHost"></div></div>
    <div class="pl-ytbar" data-ref="ytBar">
      <span class="pl-ytbar__src">
        <span class="pl-ytbar__lbl">${esc(list ? 'Lista de YouTube' : 'YouTube')}</span>
        <span class="pl-ytbar__t" data-ref="ytTitle">${esc(pick?.title && pick.title !== defaultTitle(pick) ? pick.title : 'Cargando el vídeo…')}</span>
        <span class="pl-ytbar__hint" data-ref="ytHint" hidden>Toca el vídeo para que empiece</span>
      </span>
      ${list ? `<button type="button" class="pl-ytbar__btn" data-act="yt-next" aria-label="Siguiente vídeo">${icon('skip-forward', 15)}<span>Siguiente vídeo</span></button>
      <button type="button" class="pl-ytbar__btn pl-ytbar__sw" data-act="yt-shuffle" role="switch" aria-checked="false" aria-label="Aleatorio">${icon('shuffle', 15)}<span>Aleatorio</span></button>` : ''}
    </div>`;
}

/**
 * Reproductor de fondo de la clase. Nunca lanza; si el vídeo no se puede ver, llama a onFail(motivo) UNA vez y se
 * destruye solo (la clase sigue sin él).
 *   host: el nodo vacío donde va el iframe (dentro de .pl-yt)
 *   pick: resultado de parseYouTubeUrl (+ title)
 *   on: { onFail(reason), onTitle(title), onNeedsTap(bool) }
 * Devuelve { play, pause, stop, destroy, next, setShuffle, shuffle, hasList }.
 */
export function createYouTubeBackground(host, pick, on = {}) {
  let player = null;
  let ready = false;
  let dead = false;
  let want = false;           // la clase quiere el vídeo sonando (corriendo) o parado (pausa / cuenta atrás)
  let shuffle = false;
  let loopSet = false;
  let skipErrs = 0;
  let duckPrev = null;        // volumen antes de agacharse (null = sin agachar)
  let relT = null;
  let stuckT = null;
  let tapT = null;
  let lastTitle = '';
  let readyT = null;
  let checkT = null;
  const hasList = !!pick?.list;
  const call = (fn, ...a) => (ready && player && typeof player[fn] === 'function' ? safe(() => player[fn](...a)) : undefined);

  const box = document.createElement('div');
  box.className = 'pl-yt__frame';
  safe(() => host.replaceChildren(box));

  function fail(reason) {
    if (dead) return;
    destroy();
    safe(() => on.onFail?.(reason));
  }

  function noteTitle() {
    const t = String(call('getVideoData')?.title || '').trim();
    if (!t || t === lastTitle) return;
    lastTitle = t;
    safe(() => on.onTitle?.(t));
  }

  /**
   * YouTube no siempre llama a onError: una lista que no existe o es privada deja «Este vídeo no está disponible» sin
   * más (comprobado en Chrome). Si no hay nada que se pueda reproducir, se trata como un error.
   */
  function healthCheck() {
    checkT = null;
    if (dead || !ready) return;
    const s = call('getPlayerState');
    if (s === ST.PLAYING || s === ST.BUFFERING || s === ST.PAUSED) return;
    const vd = call('getVideoData') || {};
    const listEmpty = hasList && !(call('getPlaylist') || []).length;
    if (vd.isPlayable === false || (listEmpty && !vd.video_id)) onErr(listEmpty ? 'lista no disponible' : `no disponible (${vd.errorCode || '?'})`);
  }
  function armCheck(ms = CHECK_MS) {
    clearTimeout(checkT);
    checkT = setTimeout(healthCheck, ms);
  }

  function onErr(code) {
    if (dead) return;
    // En una lista, un vídeo privado o no incrustable se salta; si fallan 3 seguidos (o la lista no existe), fuera
    const listOk = hasList && (call('getPlaylist') || []).length > 1;
    if (listOk && ready && skipErrs < MAX_SKIP_ERRORS && (code === 100 || code === 101 || code === 150 || code === 5 || typeof code === 'string')) {
      skipErrs++;
      call('nextVideo');
      armCheck();
      return;
    }
    fail(`error ${code || '?'}`);
  }

  function armTapHint() {
    clearTimeout(tapT);
    tapT = setTimeout(() => {
      tapT = null;
      if (dead || !want) return;
      const s = call('getPlayerState');
      if (s !== ST.PLAYING && s !== ST.BUFFERING) safe(() => on.onNeedsTap?.(true));
    }, TAP_HINT_MS);
  }

  loadYouTubeApi().then((YT) => {
    if (dead) return;
    const pv = { playsinline: 1, rel: 0, modestbranding: 1, controls: 1, enablejsapi: 1, autoplay: 0 };
    try { pv.origin = globalThis.location.origin; } catch { /* sin location */ }
    if (hasList) {
      pv.listType = 'playlist';
      pv.list = pick.list;
      // (el «index» de playerVars no cuenta como la API: pv 2 → vídeo 1. El índice, con cuePlaylist en onReady)
    } else if (pick.start > 0) pv.start = pick.start;
    const opts = { width: '100%', height: '100%' };
    if (pick.videoId) opts.videoId = pick.videoId; // (videoId: undefined lanza «Invalid video id»: con lista se omite)
    player = new YT.Player(box, {
      ...opts,
      playerVars: pv,
      events: {
        onReady: () => {
          if (dead) return;
          ready = true;
          clearTimeout(readyT);
          armCheck();
          // Lista desde el vídeo N (sin «v»): cuePlaylist cuenta desde 0, como parseYouTubeUrl
          if (hasList && !pick.videoId && pick.index > 0) call('cuePlaylist', { list: pick.list, listType: 'playlist', index: pick.index });
          if (hasList) { call('setLoop', true); if (shuffle) call('setShuffle', true); }
          noteTitle();
          if (want) { call('playVideo'); armTapHint(); }
        },
        onStateChange: (e) => {
          if (dead) return;
          const s = Number(e?.data);
          if (s === ST.PLAYING) {
            skipErrs = 0;
            clearTimeout(tapT);
            tapT = null;
            safe(() => on.onNeedsTap?.(false));
            // setLoop/setShuffle solo valen con la lista ya cargada: se reafirman al primer vídeo que suena
            if (hasList && !loopSet) { loopSet = true; call('setLoop', true); if (shuffle) call('setShuffle', true); }
            if (duckPrev != null) call('setVolume', Math.min(duckPrev, DUCK_VOL));
            noteTitle();
            // el usuario lo puso en marcha con la clase en pausa: se respeta (es su vídeo)
          } else if (s === ST.ENDED && !hasList && want) {
            // Vídeo suelto más corto que la clase: vuelve a empezar (la lista lo hace sola con setLoop)
            call('seekTo', pick.start > 0 ? pick.start : 0, true);
            call('playVideo');
          } else if (s === ST.CUED || s === ST.UNSTARTED) {
            noteTitle();
          }
        },
        onError: (e) => onErr(Number(e?.data) || 0),
      },
    });
  }).catch(() => fail('api'));
  readyT = setTimeout(() => { if (!ready) fail('sin respuesta'); }, READY_TIMEOUT_MS);

  /* ── El coach habla: el vídeo baja a 30 y luego vuelve (misma señal que agacha la música DJ) ── */
  function duck() {
    clearTimeout(relT);
    relT = null;
    if (duckPrev == null) {
      const v = Number(call('getVolume'));
      duckPrev = Number.isFinite(v) ? v : 100;
      if (duckPrev > DUCK_VOL) call('setVolume', DUCK_VOL);
    }
    clearTimeout(stuckT);
    stuckT = setTimeout(unduck, VOICE_STUCK_MS);
  }
  function unduck() {
    clearTimeout(relT);
    clearTimeout(stuckT);
    relT = null;
    stuckT = null;
    if (duckPrev == null) return;
    const v = duckPrev;
    duckPrev = null;
    if (v > DUCK_VOL) call('setVolume', v);
  }
  function onVoice(e) {
    if (dead) return;
    if (e?.detail?.speaking) duck();
    else { clearTimeout(relT); relT = setTimeout(unduck, DUCK_RELEASE_MS); }
  }
  safe(() => globalThis.addEventListener('br:voice', onVoice));

  function play() {
    want = true;
    if (!ready) return; // onReady lo arranca
    call('playVideo');
    armTapHint();
    armCheck(4000);
  }
  function pause() {
    want = false;
    clearTimeout(tapT);
    tapT = null;
    call('pauseVideo');
  }
  function stop() {
    want = false;
    call('stopVideo');
  }
  function destroy() {
    if (dead) return;
    want = false;
    unduck();
    dead = true;
    clearTimeout(tapT);
    clearTimeout(readyT);
    clearTimeout(checkT);
    safe(() => globalThis.removeEventListener('br:voice', onVoice));
    const p = player;
    player = null;
    if (p) {
      if (ready) safe(() => p.stopVideo());
      safe(() => p.destroy());
    }
    ready = false;
    safe(() => host.replaceChildren());
  }
  return {
    play,
    pause,
    stop,
    destroy,
    hasList,
    get shuffle() { return shuffle; },
    next() { if (hasList) { call('nextVideo'); if (want) armTapHint(); } },
    setShuffle(v) { shuffle = !!v; if (hasList) call('setShuffle', shuffle); return shuffle; },
    debug: () => ({ ready, dead, want, state: call('getPlayerState'), vol: call('getVolume'), duckPrev, url: watchUrl(pick) }),
  };
}
