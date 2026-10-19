// BestRunning · panel de depuración del audio (solo con ?debug=music en la URL). Se carga bajo demanda desde
// player.js y no toca nada del motor: lee music.status() y el contexto de audio-engine dos veces por segundo para que
// el dueño pueda hacer una captura en el iPhone a mitad de clase. Un toque lo pliega o despliega.
import { audioContextInfo } from '../audio/audio-engine.js';
import { isWakeLockSupported } from './wakelock.js';

const mb = (b) => (Number(b) > 0 ? `${Math.round(b / 2 ** 20)}` : '0');
const ms = (s) => `${Math.round((Number(s) || 0) * 1000)}`;
const r1 = (x) => (Number.isFinite(Number(x)) ? (Math.round(Number(x) * 10) / 10).toFixed(1) : '–');
const yes = (v) => (v ? 'sí' : 'NO');

function lines(music) {
  const out = [];
  const nav = globalThis.navigator || {};
  const holdOk = typeof globalThis.AudioParam === 'function' && typeof globalThis.AudioParam.prototype?.cancelAndHoldAtTime === 'function';
  out.push(`https ${yes(globalThis.isSecureContext)} · wakeLock ${yes(isWakeLockSupported())} · sesión ${nav.audioSession?.type ?? '—'} · cancelAndHold ${yes(holdOk)}`);
  const ai = (() => { try { return audioContextInfo(); } catch { return null; } })();
  let st = null;
  try { st = music?.status?.() || null; } catch { st = null; }
  const cx = st?.ctx;
  if (ai || cx) {
    const sr = cx?.sampleRate ?? ai?.sampleRate;
    out.push(`ctx ${st?.ctxState ?? ai?.state} · ${sr} Hz · base ${ms(cx?.baseLatency ?? ai?.baseLatency)} ms · salida ${ms(cx?.outputLatency ?? ai?.outputLatency)} ms`
      + ` · ritmo −${ms(cx?.latency)} ms (${cx?.latencySource ?? '—'}) · hint ${ai?.latencyHint ?? '—'}`);
    if (ai) out.push(`voz: ${ai.clips} clips ≈ ${mb(ai.clipBytes)} MB · tipo ${ai.session}`);
  } else out.push('sin AudioContext todavía');
  if (!st) { out.push('motor de música: no creado (¿«Mi música» o sin empezar?)'); return out; }
  const v = st.voices || [];
  out.push(`motor ${st.state}${st.enabled ? '' : ' (apagado)'} · t ${r1(st.t)} s · cue ${st.cursor}/${st.cues} · voces ${v.length} · saltos ${st.seeks}`
    + ` · reloj ${st.stalled ? 'ATASCADO' : 'ok'}${st.stalls ? ` (${st.stalls})` : ''}`);
  if (st.trackId) out.push(`suena ${st.trackId} · pos ${r1(st.pos)} s · ×${Number(st.rate).toFixed(3)}`);
  // Volumen de la música y nivel real que sale tras su ganancia (¿hay muestras o es silencio?)
  let lvl = '—';
  try {
    const an = music?.getAnalyser?.();
    if (an) {
      const buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const rms = Math.sqrt(s / buf.length);
      lvl = rms > 1e-6 ? `${(20 * Math.log10(rms)).toFixed(1)} dBFS` : 'SILENCIO';
    }
  } catch { lvl = 'error'; }
  out.push(`volumen ${st.volume ?? '—'} (${st.volumeDb ?? '—'} dB) · duck ${st.duckDb ?? '—'} dB · nivel música ${lvl}`);
  if (st.job) out.push(`mezcla ${st.job.kind} #${st.job.idx} · cambio en ${r1(st.job.swap - (cx?.time || 0))} s`);
  for (const x of v) {
    out.push(`  ${x.main ? '▶' : '·'} ${x.trackId} ${r1(x.pos)} s · ${Math.round((x.sr || 0) / 1000)} kHz · ventana ${r1(x.w0)}–${r1(x.wEnd)}${x.ride ? ` · +${x.ride.db} dB` : ''}`);
  }
  const b = st.buffers || {};
  out.push(`buffers ${b.decoded} · ${mb(b.bytes)} / ${mb(b.budget)} MB (pico ${mb(b.peakBytes)})${b.loading ? ` · cargando ${b.loading} (${b.phase})` : ''}${b.aborted ? ` · abortadas ${b.aborted}` : ''}`);
  for (const [id, i] of Object.entries(b.info || {}).slice(-6)) {
    out.push(`  ${id}: ${Math.round(i.rate / 1000)} kHz ${i.mb} MB [${i.w0}–${i.w1}/${i.sec} s] red ${i.fetchMs} ms · dec ${i.decodeMs} ms`);
  }
  const errs = Object.entries(b.errors || {});
  if (errs.length) out.push(`fallos: ${errs.map(([id, e]) => `${id} (${e.tries}× ${e.reason}${e.permanent ? ', fuera' : ''})`).join(' · ')}`);
  const log = st.ctxLog || [];
  if (log.length) out.push(`eventos: ${log.map((e) => `${r1(e.at)} ${e.state}`).join(' · ')}`);
  return out;
}

/** Monta el panel en `host`. Devuelve la función que lo quita. */
export function mountMusicDebug(host, { getMusic } = {}) {
  const doc = globalThis.document;
  if (!doc || !host) return () => {};
  const el = doc.createElement('pre');
  el.className = 'br-music-debug';
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed', left: '8px', top: 'calc(env(safe-area-inset-top, 0px) + 8px)', zIndex: '9999', margin: '0',
    maxWidth: 'calc(100vw - 16px)', maxHeight: '60vh', overflow: 'hidden', padding: '6px 8px', borderRadius: '8px',
    background: 'rgba(0,0,0,.74)', color: '#e8ffe8', font: '10px/1.35 ui-monospace, Menlo, monospace',
    whiteSpace: 'pre-wrap', wordBreak: 'break-all', pointerEvents: 'auto', WebkitUserSelect: 'none', userSelect: 'none',
  });
  let compact = false;
  const toggle = (e) => { e.stopPropagation(); compact = !compact; paint(); };
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('click', toggle);
  function paint() {
    let text;
    try { text = lines(getMusic?.()); } catch (err) { text = [`error: ${err?.message || err}`]; }
    el.textContent = compact ? text.slice(0, 3).join('\n') : text.join('\n');
  }
  host.appendChild(el);
  paint();
  const timer = setInterval(paint, 500);
  return () => {
    clearInterval(timer);
    try { el.remove(); } catch { /* ya fuera */ }
  };
}
