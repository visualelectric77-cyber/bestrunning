// BestRunning · voz del sistema (Web Speech API) con los apaños que necesita WebKit en iOS.
// No toca window/document al importarse: todo el acceso al navegador va dentro de funciones.
import { numberWords, integerWords, durationWords, nounGender } from './phrases.js';

const LANG = 'es-ES';
const PREFERRED = ['mónica', 'monica', 'marisol', 'jorge', 'lucía', 'lucia', 'elvira', 'álvaro', 'alvaro', 'paulina', 'juan'];
const NOVELTY_RE = /eloquence|\b(eddy|flo|grandma|grandpa|abuel[oa]|reed|rocko|sandy|shelley|bells|bubbles|organ|zarvox|trinoids|whisper|wobble|cellos|jester|bahh|boing|bad news|good news|superstar|albert|fred|junior|kathy|ralph)\b/i;

const live = new Set();       // referencias fuertes: WebKit puede recolectar la utterance y perder onend
const pending = new Set();    // finalizadores de las promesas en curso
let lastCancelAt = 0;
let hooked = false;
let primed = false;
let voiceCount = 0;           // voces sonando ahora (TTS + clips del pack)

const synth = () => globalThis.speechSynthesis || null;
const Utterance = () => globalThis.SpeechSynthesisUtterance || null;
const now = () => (globalThis.performance?.now ? performance.now() : Date.now());
const clampN = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const normLang = (l) => String(l || '').replace('_', '-').toLowerCase();

/** Calidad de una voz: 'premium' | 'enhanced' | 'standard' | 'novelty'. */
export function voiceQuality(voice) {
  if (!voice) return 'standard';
  const id = `${voice.name || ''} ${voice.voiceURI || ''}`.toLowerCase();
  if (/premium/.test(id)) return 'premium';
  if (/enhanced|mejorad|siri|neural|natural/.test(id)) return 'enhanced';
  if (NOVELTY_RE.test(id)) return 'novelty';
  return 'standard';
}

const QUALITY_RANK = { premium: 0, enhanced: 1, standard: 2, novelty: 3 };
const QUALITY_LABEL = { premium: 'Premium', enhanced: 'Mejorada', standard: '', novelty: '' };

function regionRank(v) {
  const l = normLang(v.lang);
  if (l === 'es-es') return 0;
  if (l.startsWith('es-mx')) return 1;
  if (l.startsWith('es-us')) return 2;
  return 3;
}

function nameRank(v) {
  const n = String(v.name || '').toLowerCase();
  const i = PREFERRED.findIndex((p) => n.startsWith(p));
  return i < 0 ? 99 : i;
}

function compareVoices(a, b) {
  return regionRank(a) - regionRank(b)
    || QUALITY_RANK[voiceQuality(a)] - QUALITY_RANK[voiceQuality(b)]
    || nameRank(a) - nameRank(b)
    || (b.localService ? 1 : 0) - (a.localService ? 1 : 0)
    || String(a.name).localeCompare(String(b.name), 'es');
}

function allVoices() {
  try { return synth()?.getVoices?.() || []; } catch { return []; }
}

/**
 * Voces en español, es-ES primero y las mejoradas/premium delante.
 * Cada voz se marca (si el navegador lo permite) con `quality` y `qualityLabel` ('Premium' | 'Mejorada' | '').
 */
export function spanishVoices() {
  const list = allVoices().filter((v) => normLang(v.lang).startsWith('es'));
  for (const v of list) {
    const q = voiceQuality(v);
    try { v.quality = q; v.qualityLabel = QUALITY_LABEL[q]; } catch { /* objeto no extensible */ }
  }
  return list.sort(compareVoices);
}

/** Mejor voz disponible: es-ES premium/mejorada (Mónica, Marisol, Jorge…), evitando las voces de broma. */
export function defaultVoice() {
  const list = spanishVoices();
  return list.find((v) => voiceQuality(v) !== 'novelty') || list[0] || null;
}

/** Llama a cb(voces) cuando cambia la lista (incluida la primera carga). Devuelve la función para desuscribir. */
export function onVoicesChanged(cb) {
  const s = synth();
  if (!s || typeof cb !== 'function') return () => {};
  const handler = () => { try { cb(spanishVoices()); } catch { /* callback ajeno */ } };
  try { s.addEventListener?.('voiceschanged', handler); } catch { /* sin eventos */ }
  // iOS a veces no emite voiceschanged: sondeo breve hasta que aparezcan voces
  let count = -1;
  let tries = 0;
  const iv = setInterval(() => {
    const c = allVoices().length;
    if (c !== count && c > 0) handler();
    count = c;
    if (++tries >= 24) clearInterval(iv);
  }, 250);
  return () => {
    clearInterval(iv);
    try { s.removeEventListener?.('voiceschanged', handler); } catch { /* nada */ }
  };
}

function findVoice(voiceURI) {
  if (voiceURI) {
    const v = allVoices().find((x) => x.voiceURI === voiceURI || x.name === voiceURI);
    if (v) return v;
  }
  return defaultVoice();
}

function hook() {
  if (hooked) return;
  hooked = true;
  const doc = globalThis.document;
  const revive = () => {
    const s = synth();
    if (!s || doc?.visibilityState === 'hidden') return;
    try { if (s.paused) s.resume(); } catch { /* nada */ }
  };
  try {
    doc?.addEventListener?.('visibilitychange', revive);
    globalThis.addEventListener?.('pageshow', revive);
    globalThis.addEventListener?.('focus', revive);
  } catch { /* sin DOM */ }
}

/**
 * Actividad de voz compartida (TTS y clips): emite `br:voice` { speaking } en window para que la música se
 * agache. Cada inicio emite speaking:true; speaking:false solo cuando ya no queda ninguna voz sonando.
 * Llamar exactamente una vez con false por cada true.
 */
export function signalVoice(on, source = 'tts') {
  const was = voiceCount > 0;
  voiceCount = Math.max(0, voiceCount + (on ? 1 : -1));
  const speaking = voiceCount > 0;
  if (!on && was === speaking) return;
  try {
    const w = typeof window !== 'undefined' ? window : null;
    const CE = globalThis.CustomEvent;
    if (w && typeof w.dispatchEvent === 'function' && typeof CE === 'function') {
      w.dispatchEvent(new CE('br:voice', { detail: { speaking, source } }));
    }
  } catch { /* sin DOM */ }
}

/** true si alguna voz (TTS o clips) está sonando. */
export function isVoiceActive() {
  return voiceCount > 0;
}

/** Duración estimada en segundos de un texto ya normalizado (≈ 14 caracteres/s a velocidad 1). */
export function estimateSpeechSec(text, rate = 1) {
  const len = String(text ?? '').length;
  return (0.35 + len / 14) / clampN(rate, 0.5, 2, 1);
}

/**
 * Habla un texto. Resuelve al terminar, al cancelarse o por tiempo de seguridad (onend no siempre llega en iOS).
 * interrupt: cancela lo que esté sonando antes de hablar.
 */
export function speak(text, { rate, pitch, volume, voiceURI, interrupt = false } = {}) {
  const s = synth();
  const U = Utterance();
  const spoken = speechText(text);
  if (!s || !U || !spoken.trim()) return Promise.resolve();
  hook();
  if (interrupt) cancelSpeech();
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    let u = null;
    let signaled = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (u) live.delete(u);
      pending.delete(finish);
      if (signaled) signalVoice(false, 'tts');
      resolve();
    };
    pending.add(finish);
    const start = () => {
      if (done) return;
      try {
        u = new U(spoken);
        const v = findVoice(voiceURI);
        if (v) u.voice = v;
        u.lang = v && normLang(v.lang).startsWith('es') ? String(v.lang).replace('_', '-') : LANG;
        u.rate = clampN(rate, 0.5, 2, 1);
        u.pitch = clampN(pitch, 0.5, 2, 1);
        u.volume = clampN(volume, 0, 1, 1);
        u.onend = finish;
        u.onerror = finish;
        live.add(u);
        timer = setTimeout(finish, estimateSpeechSec(spoken, u.rate) * 1600 + 2500);
        if (s.paused) s.resume();
        // se avisa antes de hablar: la música empieza a agacharse mientras arranca la síntesis
        signaled = true;
        signalVoice(true, 'tts');
        s.speak(u);
      } catch {
        finish();
      }
    };
    // Tras cancel() WebKit puede tragarse la siguiente frase si llega demasiado pronto
    const since = now() - lastCancelAt;
    if (since < 120) setTimeout(start, 120 - since);
    else start();
  });
}

/** Corta la voz y resuelve todas las promesas pendientes de speak(). */
export function cancelSpeech() {
  const s = synth();
  lastCancelAt = now();
  try { s?.cancel?.(); } catch { /* nada */ }
  for (const f of [...pending]) f();
  live.clear();
}

/** Desbloquea la síntesis en iOS: debe llamarse dentro de un gesto. Frase casi muda. */
export function primeSpeech() {
  const s = synth();
  const U = Utterance();
  if (!s || !U) return false;
  hook();
  try {
    if (s.paused) s.resume();
    if (!primed) {
      const u = new U('a');
      u.lang = LANG;
      u.volume = 0.01;
      u.rate = 2;
      const v = defaultVoice();
      if (v) u.voice = v;
      const drop = () => live.delete(u);
      u.onend = drop;
      u.onerror = drop;
      live.add(u);
      s.speak(u);
      primed = true;
    }
    return true;
  } catch {
    return false;
  }
}

export function isSpeechAvailable() {
  return !!(synth() && Utterance());
}

/* ───────────── Normalización del texto para TTS ───────────── */

function intToWords(m, offset, str) {
  const n = Number(m);
  if (!Number.isFinite(n) || n >= 1e6) return m;
  const w = /^\s+([\p{L}]+)/u.exec(str.slice(offset + m.length));
  return integerWords(n, w ? nounGender(w[1]) : null);
}

/**
 * Normaliza para la voz: '13,0' → 'trece', '11,5' → 'once coma cinco', 'km/h' → 'kilómetros por hora',
 * '0:30' → 'treinta segundos', '5:13' → 'cinco minutos y trece segundos', '1 serie' → 'una serie'.
 */
export function speechText(text) {
  let s = String(text ?? '');
  if (!s) return '';
  s = s.replace(/\s*km\/h\b/gi, ' kilómetros por hora')
    .replace(/\s*min\/km\b/gi, ' minutos por kilómetro')
    .replace(/(\d+(?:[.,]\d+)?)\s*km\b/gi, (m, n) => (n === '1' ? '1 kilómetro' : `${n} kilómetros`))
    .replace(/(\d)\s*kcal\b/gi, '$1 kilocalorías')
    .replace(/(\d+(?:,\d+)?)\s*%/g, '$1 por ciento')
    .replace(/(\d+)\s*″/g, '$1 segundos')
    .replace(/(\d+)\s*′/g, '$1 minutos')
    .replace(/(\d)\s*[×x]\s*(\d)/g, '$1 por $2')
    .replace(/(\d)\s*\/\s*(\d)/g, '$1, $2')
    .replace(/(^|[^\d:])(\d{1,2}):([0-5]\d)(?::([0-5]\d))?(?![\d:])/g, (m, pre, a, b, c) =>
      pre + durationWords(c != null ? +a * 3600 + +b * 60 + +c : +a * 60 + +b))
    .replace(/(\d+),(\d+)/g, (m, a, b) => (/^0+$/.test(b) ? a : numberWords(Number(`${a}.${b}`), b.length)))
    .replace(/\d+/g, intToWords)
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}
