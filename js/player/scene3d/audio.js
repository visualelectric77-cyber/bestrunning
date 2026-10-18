// HYPERTRACK · mundo audio-reactivo (§14.1-2). Lee el espectro real de la mezcla (AnalyserNode del motor DJ) en 64
// bandas logarítmicas (30 Hz–16 kHz) y lo sube cada frame como textura 64×1 (64 bytes): graves → pulso del suelo y del
// sol, medios → vúmetro del skyline, agudos → brillo del polvo. Sin analizador (o en silencio) se simula a partir del
// beat. Ataque rápido, caída lenta: se ve como un ecualizador, sin parpadeos.
import { clamp01 } from './util.js';

const BINS = 64;

export function createSpectrum(THREE) {
  const data = new Uint8Array(BINS);
  const tex = new THREE.DataTexture(data, BINS, 1, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;

  const level = new Float32Array(BINS);
  const seeds = new Float32Array(BINS);
  for (let i = 0; i < BINS; i++) seeds[i] = (i * 0.6180339) % 1;
  const lo = new Int32Array(BINS);
  const hi = new Int32Array(BINS);
  let analyser = null;
  let buf = null;
  let silentFor = 0;
  let real = 0; // 0..1 fundido entre simulado y real
  const out = { bass: 0, mid: 0, high: 0, live: false };

  function mapBins(a) {
    const n = a.frequencyBinCount;
    const sr = a.context?.sampleRate || 44100;
    const nyq = sr / 2;
    for (let k = 0; k < BINS; k++) {
      const f0 = 30 * Math.pow(16000 / 30, k / BINS);
      const f1 = 30 * Math.pow(16000 / 30, (k + 1) / BINS);
      lo[k] = Math.min(n - 1, Math.floor((f0 / nyq) * n));
      hi[k] = Math.min(n, Math.max(lo[k] + 1, Math.ceil((f1 / nyq) * n)));
    }
  }

  return {
    tex,
    out,
    /** node: AnalyserNode | null */
    set(node) {
      analyser = null;
      buf = null;
      if (!node || typeof node.getByteFrequencyData !== 'function' || !(node.frequencyBinCount > 0)) return false;
      try {
        buf = new Uint8Array(node.frequencyBinCount);
        mapBins(node);
        analyser = node;
        silentFor = 0;
        return true;
      } catch {
        analyser = null;
        buf = null;
        return false;
      }
    },
    update(dt, time, beat, energy) {
      let got = false;
      if (analyser) {
        try {
          analyser.getByteFrequencyData(buf);
          let sum = 0;
          for (let k = 0; k < BINS; k++) {
            let m = 0;
            for (let j = lo[k]; j < hi[k]; j++) if (buf[j] > m) m = buf[j];
            const v = m / 255;
            sum += v;
            // ataque inmediato, caída ~6/s
            level[k] = v > level[k] ? v : Math.max(v, level[k] - dt * 1.6);
          }
          silentFor = sum < 0.5 ? silentFor + dt : 0;
          got = silentFor < 1.2;
        } catch {
          analyser = null;
        }
      }
      real += ((got ? 1 : 0) - real) * Math.min(1, dt * 3);
      out.live = got;
      if (!got) {
        // simulación: bombo en graves, medios ondulantes que suben con la intensidad de la zona, agudos con chispa
        for (let k = 0; k < BINS; k++) {
          const s = seeds[k];
          let v;
          if (k < 6) v = 0.25 + beat * 0.7;
          else if (k < 41) v = (0.22 + 0.4 * energy) * (0.55 + 0.45 * Math.sin(time * (1.3 + s * 2.7) + s * 40)) + beat * 0.25 * (1 - k / 41);
          else v = 0.12 + 0.18 * energy * (0.5 + 0.5 * Math.sin(time * (5 + s * 9) + s * 90));
          v = clamp01(v);
          const cur = level[k];
          level[k] = cur + (v - cur) * Math.min(1, dt * (1 - real) * 8);
        }
      }
      let b = 0;
      let m = 0;
      let h = 0;
      for (let k = 0; k < BINS; k++) {
        const v = level[k];
        data[k] = Math.round(clamp01(v) * 255);
        if (k < 6) b += v; else if (k < 41) m += v; else h += v;
      }
      out.bass = b / 6;
      out.mid = m / 35;
      out.high = h / 23;
      tex.needsUpdate = true;
      return out;
    },
    dispose() { tex.dispose(); analyser = null; buf = null; },
  };
}
