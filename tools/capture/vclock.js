// BestRunning · reloj virtual para grabar vídeos deterministas de la app real (tools/capture/).
// Se inyecta con Page.addScriptToEvaluateOnNewDocument ANTES que la app. Sustituye el tiempo del navegador por un
// reloj que solo avanza cuando el grabador lo pide (window.__vc.advance(ms)): Date, performance.now, setTimeout /
// setInterval, requestAnimationFrame, animaciones CSS / Web Animations, AudioContext.currentTime, <audio>/<video>
// y speechSynthesis. Así cada fotograma del vídeo es exactamente 1/30 s de la app, por lenta que sea la captura.
// No toca la app ni sus archivos: solo vive en la pestaña del Chrome headless del grabador.
// Configuración: window.__VC_CFG = { epoch: ms (Date.now() al empezar), hour: opcional } inyectada antes que esto.
(() => {
  if (window.__vc) return;
  const CFG = window.__VC_CFG || {};
  const rPerf = performance.now.bind(performance);
  const RealDate = Date;
  const rSetTimeout = window.setTimeout.bind(window);
  const SS_KEY = '__vc_state';
  let perf = 1000;                       // performance.now() virtual (ms)
  let epoch0 = Number(CFG.epoch) || RealDate.now();  // Date.now() cuando perf = 0
  // Tras una recarga el tiempo sigue (sessionStorage): nunca va hacia atrás
  try {
    const s = JSON.parse(sessionStorage.getItem(SS_KEY) || 'null');
    if (s && Number.isFinite(s.epochNow)) { epoch0 = s.epochNow - perf; }
  } catch { /* sin storage */ }
  const nowEpoch = () => epoch0 + perf;
  const save = () => { try { sessionStorage.setItem(SS_KEY, JSON.stringify({ epochNow: nowEpoch() })); } catch { /* nada */ } };

  /* ── Date y performance.now ── */
  function VDate(...a) {
    if (!new.target) return new RealDate(nowEpoch()).toString();
    return a.length === 0 ? new RealDate(nowEpoch()) : new RealDate(...a);
  }
  VDate.prototype = RealDate.prototype;
  VDate.now = () => Math.floor(nowEpoch());
  VDate.parse = RealDate.parse;
  VDate.UTC = RealDate.UTC;
  Object.defineProperty(VDate, Symbol.hasInstance, { value: (x) => x instanceof RealDate });
  window.Date = VDate;
  performance.now = () => perf;

  /* ── Temporizadores ── */
  const timers = new Map();
  let seq = 1;
  const add = (fn, ms, args, interval) => {
    const id = seq++;
    const d = Math.max(0, Number(ms) || 0);
    timers.set(id, { id, fn, args, at: perf + d, interval: interval ? Math.max(1, d) : 0, order: id });
    return id;
  };
  window.setTimeout = (fn, ms, ...args) => add(fn, ms, args, false);
  window.setInterval = (fn, ms, ...args) => add(fn, ms, args, true);
  window.clearTimeout = (id) => { timers.delete(id); };
  window.clearInterval = (id) => { timers.delete(id); };
  window.requestIdleCallback = (fn) => add(() => fn({ didTimeout: false, timeRemaining: () => 12 }), 1, [], false);
  window.cancelIdleCallback = (id) => { timers.delete(id); };
  let rafs = [];
  let rafSeq = 1;
  window.requestAnimationFrame = (fn) => { const id = rafSeq++; rafs.push({ id, fn }); return id; };
  window.cancelAnimationFrame = (id) => { rafs = rafs.filter((r) => r.id !== id); };

  // Ceder al navegador para que se vacíen las microtareas (promesas) entre callbacks: MessageChannel es casi inmediato
  const mc = new MessageChannel();
  const waiters = [];
  mc.port1.onmessage = () => { const w = waiters.shift(); if (w) w(); };
  const yieldTask = () => new Promise((r) => { waiters.push(r); mc.port2.postMessage(0); });
  const run = (fn, args) => {
    try {
      if (typeof fn === 'function') fn(...(args || []));
      else if (typeof fn === 'string') (0, eval)(fn);
    } catch (e) { errors.push(String(e && e.stack || e).slice(0, 400)); try { console.error(e); } catch { /* nada */ } }
  };
  const errors = [];

  /* ── Audio Web: AudioContext con reloj virtual y el nativo siempre suspendido (no suena, nada termina solo) ── */
  const vac = new WeakMap();
  const ctxState = (c) => {
    let s = vac.get(c);
    if (!s) { s = { state: 'suspended', acc: 0, since: perf }; vac.set(c, s); }
    return s;
  };
  const BAC = window.BaseAudioContext;
  const OAC = window.OfflineAudioContext;
  if (BAC && window.AudioContext) {
    const isOff = (c) => OAC && c instanceof OAC;
    const ctDesc = Object.getOwnPropertyDescriptor(BAC.prototype, 'currentTime');
    const stDesc = Object.getOwnPropertyDescriptor(BAC.prototype, 'state');
    Object.defineProperty(BAC.prototype, 'currentTime', {
      configurable: true,
      get() {
        if (isOff(this)) return ctDesc.get.call(this);
        const s = ctxState(this);
        return s.acc + (s.state === 'running' ? (perf - s.since) / 1000 : 0);
      },
    });
    Object.defineProperty(BAC.prototype, 'state', {
      configurable: true,
      get() { return isOff(this) ? stDesc.get.call(this) : ctxState(this).state; },
    });
    const AC = window.AudioContext;
    const nSuspend = AC.prototype.suspend;
    const nClose = AC.prototype.close;
    const fire = (c) => { add(() => { try { c.dispatchEvent(new Event('statechange')); } catch { /* nada */ } try { c.onstatechange?.(new Event('statechange')); } catch { /* nada */ } }, 0, [], false); };
    AC.prototype.resume = function resume() {
      const s = ctxState(this);
      if (s.state === 'suspended') { s.state = 'running'; s.since = perf; fire(this); }
      try { nSuspend.call(this).catch(() => {}); } catch { /* nada */ }
      return Promise.resolve();
    };
    AC.prototype.suspend = function suspend() {
      const s = ctxState(this);
      if (s.state === 'running') { s.acc += (perf - s.since) / 1000; s.state = 'suspended'; fire(this); }
      return Promise.resolve();
    };
    AC.prototype.close = function close() {
      const s = ctxState(this);
      if (s.state === 'running') s.acc += (perf - s.since) / 1000;
      s.state = 'closed';
      fire(this);
      try { return nClose.call(this).catch(() => {}); } catch { return Promise.resolve(); }
    };
    AC.prototype.getOutputTimestamp = function getOutputTimestamp() { return { contextTime: this.currentTime, performanceTime: perf }; };
    const Wrapped = function AudioContext(...a) {
      const c = new AC(...a);
      ctxState(c);
      // El nativo puede nacer "running" (gesto): se suspende para que nada suene ni dispare 'ended' en tiempo real
      try { nSuspend.call(c).catch(() => {}); } catch { /* nada */ }
      // Un contexto creado en un gesto arranca como en iOS: 'running'
      const s = ctxState(c);
      if (navigator.userActivation?.isActive) { s.state = 'running'; s.since = perf; }
      return c;
    };
    Wrapped.prototype = AC.prototype;
    window.AudioContext = Wrapped;
    window.webkitAudioContext = Wrapped;
  }

  /* ── <audio>/<video>: reproducción virtual (sin sonido) con currentTime, paused, ended y timeupdate ── */
  const MP = window.HTMLMediaElement && HTMLMediaElement.prototype;
  const playing = new Set();
  const media = new WeakMap();
  if (MP) {
    const ctD = Object.getOwnPropertyDescriptor(MP, 'currentTime');
    const pausedD = Object.getOwnPropertyDescriptor(MP, 'paused');
    const endedD = Object.getOwnPropertyDescriptor(MP, 'ended');
    const rateD = Object.getOwnPropertyDescriptor(MP, 'playbackRate');
    const nPause = MP.pause;
    const ms = (el) => {
      let s = media.get(el);
      if (!s) { s = { pos: 0, playing: false, at: perf, ended: false, lastTU: 0 }; media.set(el, s); }
      return s;
    };
    const rate = (el) => { try { return rateD.get.call(el) || 1; } catch { return 1; } };
    const cur = (el, s) => (s.playing ? s.pos + ((perf - s.at) / 1000) * rate(el) : s.pos);
    const emit = (el, type) => add(() => { try { el.dispatchEvent(new Event(type)); } catch { /* nada */ } }, 0, [], false);
    MP.play = function play() {
      const s = ms(this);
      if (!s.playing) {
        s.pos = cur(this, s);
        const d = this.duration;
        if (s.ended || (Number.isFinite(d) && d > 0 && s.pos >= d)) { s.pos = 0; }
        s.ended = false; s.playing = true; s.at = perf; playing.add(this);
        emit(this, 'play'); emit(this, 'playing');
      }
      try { nPause.call(this); } catch { /* nada */ }
      return Promise.resolve();
    };
    MP.pause = function pause() {
      const s = ms(this);
      if (s.playing) { s.pos = cur(this, s); s.playing = false; playing.delete(this); emit(this, 'pause'); }
      try { nPause.call(this); } catch { /* nada */ }
    };
    Object.defineProperty(MP, 'currentTime', {
      configurable: true,
      get() { return cur(this, ms(this)); },
      set(v) {
        const s = ms(this);
        s.pos = Math.max(0, Number(v) || 0); s.at = perf; s.ended = false;
        try { ctD.set.call(this, s.pos); } catch { /* aún sin datos */ }
        emit(this, 'seeking'); emit(this, 'seeked');
      },
    });
    Object.defineProperty(MP, 'paused', { configurable: true, get() { return !ms(this).playing; } });
    Object.defineProperty(MP, 'ended', { configurable: true, get() { return ms(this).ended; } });
    Object.defineProperty(MP, 'playbackRate', {
      configurable: true,
      get() { return rate(this); },
      set(v) { const s = ms(this); s.pos = cur(this, s); s.at = perf; try { rateD.set.call(this, v); } catch { /* nada */ } },
    });
    void pausedD; void endedD;
  }
  const mediaTick = () => {
    for (const el of [...playing]) {
      const s = media.get(el);
      if (!s || !s.playing) { playing.delete(el); continue; }
      const d = el.duration;
      const p = s.pos + ((perf - s.at) / 1000) * (el.playbackRate || 1);
      if (Number.isFinite(d) && d > 0 && p >= d) {
        if (el.loop) { s.pos = p % d; s.at = perf; } else {
          s.pos = d; s.playing = false; s.ended = true; playing.delete(el);
          try { el.dispatchEvent(new Event('timeupdate')); el.dispatchEvent(new Event('pause')); el.dispatchEvent(new Event('ended')); } catch { /* nada */ }
          continue;
        }
      }
      if (perf - s.lastTU >= 250) { s.lastTU = perf; try { el.dispatchEvent(new Event('timeupdate')); } catch { /* nada */ } }
    }
  };

  /* ── speechSynthesis: voz del sistema simulada (eventos start/end en tiempo virtual, sin sonido) ── */
  try {
    const q = [];
    let speaking = null;
    const next = () => {
      if (speaking || !q.length) return;
      const u = q.shift();
      speaking = u;
      const dur = 400 + String(u.text || '').length * 62 / (u.rate || 1);
      add(() => { try { u.onstart?.({ type: 'start' }); u.dispatchEvent?.(new Event('start')); } catch { /* nada */ } }, 0, [], false);
      add(() => {
        if (speaking !== u) return;
        speaking = null;
        try { u.onend?.({ type: 'end' }); u.dispatchEvent?.(new Event('end')); } catch { /* nada */ }
        next();
      }, dur, [], false);
    };
    const fake = {
      speak(u) { q.push(u); next(); },
      cancel() { q.length = 0; const u = speaking; speaking = null; if (u) { try { u.onend?.({ type: 'end' }); } catch { /* nada */ } } },
      pause() {}, resume() {},
      getVoices: () => [],
      get speaking() { return !!speaking; }, get pending() { return q.length > 0; }, get paused() { return false; },
      onvoiceschanged: null,
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => fake });
  } catch { /* nada */ }

  /* ── Transiciones de vista: fuera (el router cambia de pantalla al instante; el vídeo corta entre planos) ── */
  try { Document.prototype.startViewTransition = undefined; } catch { /* nada */ }

  /* ── Animaciones CSS / Web Animations: en pausa y movidas a mano con el reloj virtual ── */
  const born = new WeakMap();
  function driveAnimations() {
    let list = [];
    try { list = document.getAnimations(); } catch { return 0; }
    for (const a of list) {
      try {
        let b = born.get(a);
        if (b == null) {
          // recién creada (se recorre en cada fotograma): empieza en 0 en el instante virtual actual, aunque el
          // compositor ya la haya hecho avanzar unos ms reales mientras se capturaba el fotograma anterior
          b = perf;
          born.set(a, b);
          a.pause();
        }
        const t = (perf - b) * (a.playbackRate || 1);
        const timing = a.effect?.getComputedTiming?.();
        const end = timing ? Number(timing.endTime) : Infinity;
        if (Number.isFinite(end) && t >= end) { a.finish(); continue; }
        a.currentTime = Math.max(0, t);
      } catch { /* animación ya cancelada */ }
    }
    return list.length;
  }

  /* ── API del grabador ── */
  let busy = false;
  async function advance(ms = 1000 / 30, { raf = true } = {}) {
    if (busy) throw new Error('advance en curso');
    busy = true;
    try {
      const target = perf + Math.max(0, Number(ms) || 0);
      let guard = 0;
      for (;;) {
        let t = null;
        for (const x of timers.values()) if (x.at <= target && (!t || x.at < t.at || (x.at === t.at && x.order < t.order))) t = x;
        if (!t) break;
        if (t.at > perf) perf = t.at;
        if (t.interval) { t.at += t.interval; t.order = seq++; } else timers.delete(t.id);
        run(t.fn, t.args);
        await yieldTask();
        if (++guard > 20000) { errors.push('demasiados temporizadores en un paso'); break; }
      }
      perf = target;
      mediaTick();
      if (raf) {
        const list = rafs;
        rafs = [];
        for (const r of list) run(r.fn, [perf]);
        await yieldTask();
      }
      driveAnimations();
      save();
      return perf;
    } finally {
      busy = false;
    }
  }
  /** Avanza `ms` en pasos de `step` (rAF en cada paso). Para saltar minutos de clase sin grabar. */
  async function fastForward(ms, step = 250) {
    const end = perf + ms;
    while (perf < end - 1e-6) await advance(Math.min(step, end - perf));
    return perf;
  }
  window.__vc = {
    advance, fastForward, driveAnimations,
    get now() { return perf; }, get epoch() { return nowEpoch(); },
    setEpoch(ms) { epoch0 = Number(ms) - perf; save(); },
    pending: () => ({ timers: timers.size, rafs: rafs.length, playing: playing.size }),
    errors, realNow: rPerf, realSetTimeout: rSetTimeout,
  };
  if (CFG.hour != null) globalThis.__brAuroraHour = Number(CFG.hour);
})();
