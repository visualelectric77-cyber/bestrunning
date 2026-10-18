// BestRunning · Worker (módulo) de análisis musical: saca el cálculo pesado del hilo de la interfaz.
// Entrada:  { type:'analyze', id, pcm: Float32Array (transferible), sampleRate, priorBpm?, loudness?, autoOctave?, keepFeatures? }
// Salidas:  { type:'ready' } al cargar · { type:'progress', id, progress 0..1, stage } ·
//           { type:'result', id, analysis, features? } (rasgos transferidos) · { type:'error', id, message }
import { analyzePcm } from './music-analysis.js';

const scope = globalThis;

scope.addEventListener('message', (ev) => {
  const msg = ev.data || {};
  if (msg.type === 'ping') {
    scope.postMessage({ type: 'ready' });
    return;
  }
  if (msg.type && msg.type !== 'analyze') return;
  const { id = 0, pcm, sampleRate, priorBpm = 125, loudness = null, autoOctave = false, keepFeatures = false } = msg;
  try {
    if (!(pcm instanceof Float32Array) || !pcm.length) throw new Error('PCM vacío');
    let last = -1;
    const onProgress = (p, stage) => {
      if (p - last < 0.02 && p < 1) return;
      last = p;
      scope.postMessage({ type: 'progress', id, progress: p, stage });
    };
    const result = analyzePcm(pcm, sampleRate, { priorBpm, loudness, autoOctave, keepFeatures, onProgress });
    const { features = null, ...analysis } = result;
    const transfer = features ? [features.env.buffer, ...features.bands.map((b) => b.buffer)] : [];
    scope.postMessage({ type: 'result', id, analysis, features }, transfer);
  } catch (e) {
    scope.postMessage({ type: 'error', id, message: String(e?.message || e) });
  }
});

scope.postMessage({ type: 'ready' });
