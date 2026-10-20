// RITMUP · intro de arranque v2 «Curva» (≈ 3,2 s). La primera respiración de una clase en los mundos 3D, condensada:
//   0–1,0 s  WARP   pista de noche en un <canvas> 2D (sin three.js): las líneas de calle salen del punto de fuga, la
//                   cámara acelera, luces de ritmo ember con estela larga, LED del suelo, polvo, niebla y horizonte.
//                   Si la foto de Kling (hero-loop.jpg) ya está cargada a los 250 ms, un corte de 0,4 s a la corredora.
//                   NUNCA <video>: en el iPhone puede dejar la sesión de audio en «ambient» (sin coach ni música).
//   1,0–1,5  UP     la pista se levanta y sus líneas se curvan hasta ser la «r» de Curva (calle exterior + interior).
//   1,4–2,1         la r cristaliza con un destello, se coloca en el logotipo y el corredor ember enciende su calle;
//                   entran i·t·m·u·p y un reflejo cruza la marca.
//   2,6–3,2         empujón a través de la marca y fundido con Hoy.
// Sin sonido ni vibración (el vídeo no tiene pista de audio y va silenciado). Toca en cualquier sitio para saltarla.
// Preferencia (Ajustes): localStorage 'ritmup.intro' = 'always' (por defecto: al abrir y al volver tras ≥ 20 s fuera)
// | 'launch' (solo al abrir) | 'off'. Fuerza: ?intro=1 · Nunca: ?nointro, ?cap, navigator.webdriver, reloj virtual,
// #/play, #/summary o una clase guardada a medias. La geometría vive en ./intro-logo.js (generado).
import { loadActiveSession, activeSessionSavedAt } from '../core/store.js';
import { LOGO } from './intro-logo.js';

const PREF = 'ritmup.intro';
const SHOWN = 'ritmup.intro.shown'; // sessionStorage: ya se vio en este arranque (una recarga no la repite)
const RESUME_MAX_MS = 3 * 3600 * 1000;
const AWAY_MS = 20000;
const HARD_MS = 4500;
const CUT_SRC = './assets/media/hero-loop.jpg';
const E = LOGO.ember;

/* Tiempos (s desde el primer fotograma). Los de CSS (letras 1,86 · reflejo 2,2 · empujón 2,6 · marca fuera 2,72–2,96 · negro fuera 2,8–3,22) en intro.css */
const T_CUT = [0.36, 0.74];
const T_MORPH = 0.9;    // la pista se levanta (cada punto de cada línea, del horizonte hacia la cámara)
const T_LOCK = 1.37;    // las líneas encajan en la r
const T_FILL = [1.28, 1.46];
const T_RUN = [1.38, 1.74];
const T_SETTLE = [1.62, 1.98];
const T_SWAP = 2.02;
const T_STILL = 2.5;    // el lienzo ya no cambia: deja de pintar
const T_END = 3.22;

/* Calles: X en la pista (m) → desplazamiento en la r (unidades del logo) · se queda (1) o se funde en el haz (0) · retraso */
const LINES = [
  [-3.66, -16.5, 0, 0.06], [-2.44, -16.5, 0, 0.04], [-1.22, -16.5, 1, 0.012], [0, 0, 1, 0],
  [1.22, 16.5, 1, 0.006], [2.44, 16.5, 0, 0.03], [3.66, 16.5, 0, 0.05], [4.88, 16.5, 0, 0.07],
];
/* Luces de ritmo: X (m), salida (s), duración (s), intensidad */
// (la segunda tanda sale justo tras el corte de vídeo: el mundo nunca se queda quieto antes del «UP»)
const COMETS = [[0.61, 0.15, 0.74, 1], [-0.61, 0.1, 0.8, 0.55], [1.83, 0.2, 0.66, 0.42], [0.61, 0.6, 0.44, 0.95], [-0.61, 0.67, 0.4, 0.5]];
const cometZ = (p) => 2.4 + 150 * p ** 2.1;
const N = 26;          // muestras por línea
const ZN = 1.3;        // m: la línea más cercana (ya fuera de pantalla)
const ZF = 150;        // m: el horizonte
const CAM_X = 0.92;    // la cámara corre por su calle (la ember), un poco a la derecha
const CAM_H = 1.25;
const LED_X = [0.1, 1.12];
const LED_GAP = 1.6;

const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const span = (t, a, b) => clamp((t - a) / (b - a));
const sstep = (a, b, x) => { const k = span(x, a, b); return k * k * (3 - 2 * k); };
const inOut = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - 4 * (1 - x) ** 3);
const outCubic = (x) => 1 - (1 - x) ** 3;
// Entrada con anticipación (retrocede un poco antes de arrancar) y llegada sin rebote
const antic = (x) => (x < 0.5 ? 0.5 * (2 * x) ** 2 * (2.4 * 2 * x - 1.4) : 0.5 + 0.5 * outCubic(2 * x - 1));
// El corredor: sale con fuerza, frena justo al final de su calle
const runEase = (x) => 1 - (1 - x) ** 3 * (1 + 3 * x); // velocidad máxima a 1/3 del recorrido
const rgba = (r, g, b, a) => `rgba(${r},${g},${b},${a < 0 ? 0 : a > 1 ? 1 : +a.toFixed(3)})`;

function params() {
  try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); }
}

/** 'always' | 'launch' | 'off' (contrato compartido con Ajustes). */
export function introPref() {
  try {
    const v = localStorage.getItem(PREF);
    return v === 'launch' || v === 'off' ? v : 'always';
  } catch { return 'always'; }
}

function inClass() {
  if (/^#\/(play|summary)\b/.test(location.hash || '')) return true;
  try {
    if (loadActiveSession()) {
      const at = activeSessionSavedAt();
      if (at && Date.now() - at <= RESUME_MAX_MS) return true; // la app va a ofrecer «Reanudar»
    }
  } catch { /* sin sesión guardada */ }
  return false;
}

function shouldPlay(resume) {
  const p = params();
  if (p.get('intro') === '1') return true;
  if (p.has('nointro') || p.has('cap') || p.has('capture') || p.has('shot')) return false;
  if (navigator.webdriver || window.__vc) return false; // capturas automáticas y pruebas
  const pref = introPref();
  if (pref === 'off' || (resume && pref !== 'always')) return false;
  if (inClass()) return false;
  if (!resume) {
    try { if (sessionStorage.getItem(SHOWN)) return false; } catch { /* sin storage: se muestra */ }
  }
  return true;
}

function markup(reduced) {
  const [x, y, w, h] = LOGO.viewBox;
  const vb = `${x} ${y} ${w} ${h}`;
  const r = LOGO.r;
  const lettersClip = LOGO.letters.map((l) => `<path transform="translate(${l.x} 0)" d="${l.d}"/>`).join('');
  const letters = LOGO.letters.map((l, i) =>
    `<svg class="ri-l" style="--i:${i}" viewBox="${vb}" aria-hidden="true" focusable="false"><path class="ri-ink" fill-rule="evenodd" transform="translate(${l.x} 0)" d="${l.d}"/></svg>`,
  ).join('');
  const sweepW = w + 260;
  return `<div class="ri-world">
  ${reduced ? '' : '<canvas class="ri-cv" aria-hidden="true"></canvas><div class="ri-cutwrap" aria-hidden="true"><i class="ri-tint"></i></div>'}
  <div class="ri-pos" style="--cy:${(((50 - y) / h) * 100).toFixed(3)}%;--ar:${w} / ${h};--rise:${((12 / h) * 100).toFixed(3)}%">
    <div class="ri-stage">
      <svg class="ri-r" viewBox="${vb}" aria-hidden="true" focusable="false">
        <path class="ri-ink" fill-rule="evenodd" d="${r.white}"/><path fill="${E}" d="${r.ember}"/>
        <path class="ri-sp" d="${r.spine}" fill="none"/><path class="ri-se" d="${r.emberSpine}" fill="none"/>
      </svg>
      ${letters}
      ${reduced ? '' : `<svg class="ri-sheen" viewBox="${vb}" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id="ri-clip"><path d="${r.white}"/>${lettersClip}</clipPath>
          <linearGradient id="ri-g-sheen" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stop-color="#fff"/><stop offset="${((sweepW - 64) / sweepW).toFixed(4)}" stop-color="#fff"/>
            <stop offset="${((sweepW - 30) / sweepW).toFixed(4)}" stop-color="#fff" stop-opacity="0.85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <g clip-path="url(#ri-clip)"><rect class="ri-sweep" style="--x0:${x - sweepW - 20}px;--x1:${x - 40}px" x="0" y="${y - 40}" width="${sweepW}" height="${h + 80}" fill="url(#ri-g-sheen)"/></g>
      </svg>`}
    </div>
  </div>
</div>`;
}

/** Muestras de un trazado SVG por longitud de arco: x, y, normal (a la derecha del avance) y longitud acumulada. */
function sample(path, n) {
  const len = path.getTotalLength();
  const P = new Float32Array(n * 5);
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * len;
    const a = path.getPointAtLength(s);
    const b = path.getPointAtLength(Math.min(len, s + 0.5));
    const c = path.getPointAtLength(Math.max(0, s - 0.5));
    const dx = b.x - c.x;
    const dy = b.y - c.y;
    const d = Math.hypot(dx, dy) || 1;
    P.set([a.x, a.y, -dy / d, dx / d, s], i * 5);
  }
  return { P, len };
}

/** El espectáculo: lienzo + corte de vídeo + logotipo vectorial. Devuelve la función que pinta un fotograma. */
function stage(el, remove) {
  const cv = el.querySelector('.ri-cv');
  const ctx = cv.getContext('2d', { alpha: false });
  const W = el.clientWidth || innerWidth;
  const H = el.clientHeight || innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);

  const svgR = el.querySelector('.ri-r');
  const SP = sample(el.querySelector('.ri-sp'), N);
  const ES = sample(el.querySelector('.ri-se'), 48);
  const pWhite = new Path2D(LOGO.r.white);
  const pEmber = new Path2D(LOGO.r.ember);
  const pSpineE = new Path2D(LOGO.r.emberSpine);
  // Dónde acaba la r: el hueco que le deja el logotipo (medido en el DOM, con la misma maqueta que las letras)
  const vb = LOGO.viewBox;
  const rc = el.querySelector('.ri-stage').getBoundingClientRect();
  const sF = rc.width / vb[2];
  const RF = { s: sF, cx: rc.left + (34 - vb[0]) * sF, cy: rc.top + (50 - vb[1]) * sF };
  // …y dónde se forma: grande, en el centro (34, 50 = centro de la r)
  const sH = Math.min((H * 0.3) / 100, (W * 0.56) / 68);
  const RH = { s: sH, cx: W * 0.5, cy: H * 0.46 };
  const R = { s: sH, ox: 0, oy: 0 };

  // Polvo (determinista)
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const DUST = Array.from({ length: 16 }, () => [-2.6 + rnd() * 6.2, 0.2 + rnd() * 2, rnd() * 30]);

  // Corte de Kling: la foto de la corredora (imagen, nunca <video>), solo si ya está cargada (caché del SW). Nunca
  // espera a la red. El movimiento lo pone la cámara (escala y desplazamiento).
  const wrap = el.querySelector('.ri-cutwrap');
  let vid = null;
  let cut = 0; // 0 pendiente · 1 sí · -1 no
  try {
    vid = new Image();
    vid.className = 'ri-cut';
    vid.alt = '';
    vid.decoding = 'async';
    vid.setAttribute('aria-hidden', 'true');
    vid.src = CUT_SRC;
    wrap.prepend(vid);
  } catch { cut = -1; }
  const dropVideo = () => {
    if (!vid) return;
    vid.remove();
    vid = null;
  };

  const X = new Float32Array(N);
  const Y = new Float32Array(N);
  const HW = new Float32Array(N);
  const A = new Float32Array(N);

  /** Una línea con grosor variable (polígono) y su degradado de niebla a lo largo. */
  function ribbon(n, cA, cB, comp) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const j = i === 0 ? 1 : i;
      const dx = X[j] - X[j - 1];
      const dy = Y[j] - Y[j - 1];
      const d = Math.hypot(dx, dy) || 1;
      const px = (-dy / d) * HW[i];
      const py = (dx / d) * HW[i];
      if (i === 0) ctx.moveTo(X[i] + px, Y[i] + py); else ctx.lineTo(X[i] + px, Y[i] + py);
    }
    for (let i = n - 1; i >= 0; i--) {
      const j = i === 0 ? 1 : i;
      const dx = X[j] - X[j - 1];
      const dy = Y[j] - Y[j - 1];
      const d = Math.hypot(dx, dy) || 1;
      ctx.lineTo(X[i] + (dy / d) * HW[i], Y[i] - (dx / d) * HW[i]);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(X[0], Y[0], X[n - 1], Y[n - 1]);
    for (let k = 0; k <= 4; k++) {
      const i = Math.round((k / 4) * (n - 1));
      const u = k / 4;
      g.addColorStop(u, rgba(cA[0] + (cB[0] - cA[0]) * u, cA[1] + (cB[1] - cA[1]) * u, cA[2] + (cB[2] - cA[2]) * u, A[i]));
    }
    ctx.globalCompositeOperation = comp;
    ctx.fillStyle = g;
    ctx.fill();
  }

  /** Halo con caída casi gaussiana (sin el borde duro de un degradado lineal) de un color [r, g, b]. */
  function soft(x, y, rad, c, a, sy = 1) {
    if (a < 0.004) return;
    glow(x, y, rad, [[0, rgba(c[0], c[1], c[2], a)], [0.2, rgba(c[0], c[1], c[2], 0.66 * a)], [0.4, rgba(c[0], c[1], c[2], 0.3 * a)],
      [0.6, rgba(c[0], c[1], c[2], 0.1 * a)], [0.8, rgba(c[0], c[1], c[2], 0.022 * a)], [1, rgba(c[0], c[1], c[2], 0)]], sy);
  }
  /** Una luz: núcleo blanco caliente, halo ember. */
  function hot(x, y, rad, a, warm = 1) {
    if (a < 0.004) return;
    glow(x, y, rad, [[0, rgba(255, 250, 246, a)], [0.07, rgba(255, 214, 190, 0.92 * a)], [0.16, rgba(255, 140, 90, 0.62 * a * warm)],
      [0.32, rgba(255, 90, 31, 0.26 * a * warm)], [0.55, rgba(255, 90, 31, 0.08 * a * warm)], [0.8, rgba(255, 90, 31, 0.016 * a * warm)], [1, 'rgba(255,90,31,0)']]);
  }
  function glow(x, y, rad, stops, sy = 1) {
    if (rad < 0.5) return;
    ctx.save();
    ctx.translate(x, y);
    if (sy !== 1) ctx.scale(1, sy);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
    for (const [o, c] of stops) g.addColorStop(o, c);
    ctx.fillStyle = g;
    ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
    ctx.restore();
  }

  /** Punto del recorrido ember a la distancia s (unidades del logo), en el lienzo. */
  function onEmber(s) {
    const P = ES.P;
    const n = P.length / 5;
    let i = 1;
    while (i < n - 1 && P[i * 5 + 4] < s) i++;
    const a = (i - 1) * 5;
    const b = i * 5;
    const k = clamp((s - P[a + 4]) / ((P[b + 4] - P[a + 4]) || 1));
    const x = P[a] + (P[b] - P[a]) * k;
    const y = P[a + 1] + (P[b + 1] - P[a + 1]) * k;
    return [R.ox + x * R.s, R.oy + y * R.s, Math.atan2(P[b + 1] - P[a + 1], P[b] - P[a])];
  }

  let camZ = 0;
  let last = -1;
  let swapped = false;

  return function draw(t) {
    const dt = last < 0 ? 0 : Math.min(0.05, Math.max(0, t - last));
    last = t;

    // ── Cámara: arranca, acelera; cabeceo hacia arriba al empezar el «UP»
    const vCam = 48 * sstep(0.06, 0.9, t) ** 1.4;
    camZ += vCam * dt;
    const pitch = inOut(span(t, T_MORPH - 0.04, T_MORPH + 0.34));
    const f = H * 0.9;
    const vx = W * 0.5;
    const vy = H * (0.42 - 0.13 * pitch);
    const ch = CAM_H + 0.014 * Math.sin(t * 17.6) * sstep(0.25, 0.6, t); // la zancada, apenas
    const wk = 1 - sstep(T_MORPH + 0.02, T_MORPH + 0.3, t); // el mundo se retira al levantarse la pista
    const atm = sstep(0.02, 0.3, t) * wk;
    const roll = -0.028 * Math.sin(Math.PI * span(t, 0.05, T_MORPH)); // la cámara se inclina un poco y se nivela antes del «UP»

    // ── Corte de Kling (decisión a los 250 ms; nunca espera)
    if (cut === 0 && t >= 0.25) {
      cut = vid && vid.complete && vid.naturalWidth > 0 ? 1 : -1;
      if (cut < 0) dropVideo();
    }
    if (cut === 1) {
      const on = t >= T_CUT[0] && t < T_CUT[1];
      wrap.style.opacity = on ? '1' : '0';
      if (on) {
        const p = span(t, T_CUT[0], T_CUT[1]);
        vid.style.transform = `scale(${(1.1 + 0.07 * p).toFixed(4)}) translate3d(${(-1.2 * p).toFixed(2)}%,0,0)`;
        return true; // el vídeo tapa el lienzo: no hace falta pintarlo
      }
      if (t >= T_CUT[1] + 0.1) { wrap.remove(); dropVideo(); cut = 2; }
    }

    // ── Transformación de la r: se forma grande en el centro y se coloca en el logotipo
    const se = inOut(span(t, T_SETTLE[0], T_SETTLE[1]));
    R.s = RH.s * (RF.s / RH.s) ** se;
    R.ox = RH.cx + (RF.cx - RH.cx) * se - 34 * R.s;
    R.oy = RH.cy + (RF.cy - RH.cy) * se - 50 * R.s;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (roll) {
      ctx.translate(vx, vy);
      ctx.rotate(roll);
      ctx.translate(-vx, -vy);
    }

    // ── Atmósfera: la pista en la niebla (fría, apenas) y el resplandor del horizonte, que las luces alimentan
    let pool = 0;
    for (const [, s0, d, I] of COMETS) pool += I * sstep(0.6, 1, span(t, s0, s0 + d));
    if (atm > 0.01) {
      const sky = ctx.createLinearGradient(0, vy - H * 0.24, 0, vy);
      sky.addColorStop(0, 'rgba(26,30,38,0)');
      sky.addColorStop(1, rgba(26, 30, 38, atm));
      ctx.fillStyle = sky;
      ctx.fillRect(-W, vy - H * 0.24, W * 3, H * 0.24);
      const fl = ctx.createLinearGradient(0, vy, 0, H);
      fl.addColorStop(0, rgba(26, 30, 38, atm));
      fl.addColorStop(0.16, rgba(10, 11, 13, atm));
      fl.addColorStop(1, rgba(4, 4, 5, atm));
      ctx.fillStyle = fl;
      ctx.fillRect(-W, vy, W * 3, H * 1.5);
      ctx.globalCompositeOperation = 'lighter';
      soft(vx, vy, W * 0.62, [236, 238, 244], 0.1 * atm, 0.26);
      soft(vx, vy, W * 0.42, [255, 120, 66], (0.03 + 0.12 * pool) * atm, 0.34);
      // el primer destello: un alfiler de luz en el punto de fuga del que salen las calles
      const pin = sstep(0, 0.07, t) * (1 - sstep(0.12, 0.42, t));
      hot(vx, vy, 34, pin);
    }

    // ── LED del suelo a los dos lados de la calle: pasan bajo la cámara; la luz de ritmo los enciende al pasar
    const lineIn = sstep(0.04, 0.3, t);
    if (wk * lineIn > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      const main = COMETS[0];
      const pm = span(t, main[1], main[1] + main[2]);
      const zMain = pm > 0 && pm < 1 ? cometZ(pm) : -99;
      const shut = Math.max(0.0001, vCam * 0.004);
      for (const lx of LED_X) {
        for (let n = Math.ceil((camZ + ZN) / LED_GAP); ; n++) {
          const z = n * LED_GAP - camZ;
          if (z > 64) break;
          const i1 = 1 / z;
          const i2 = 1 / (z + shut);
          const fog = Math.exp(-z / 24);
          const hit = Math.max(0, 1 - Math.abs(z - zMain) / 5) * (1 - sstep(0.8, 1, pm));
          ctx.strokeStyle = hit > 0.02 ? rgba(255, 110 + 80 * (1 - hit), 60 + 40 * (1 - hit), (0.3 + 0.7 * hit) * wk * fog ** 0.5) : rgba(255, 214, 196, 0.2 * fog * wk * lineIn);
          ctx.lineWidth = Math.max(0.8, Math.min(3, f * 0.026 * i1));
          ctx.beginPath();
          ctx.moveTo(vx + f * (lx - CAM_X) * i1, vy + f * ch * i1);
          ctx.lineTo(vx + f * (lx - CAM_X) * i2 + 0.01, vy + f * ch * i2);
          ctx.stroke();
        }
      }
    }

    // ── Líneas de calle: salen del punto de fuga; en el «UP» se levantan desde el horizonte y se curvan en la r
    for (let j = 0; j < LINES.length; j++) {
      const [lx, off, keep, lag] = LINES[j];
      const rank = Math.abs(lx - CAM_X) / 1.22;
      const on = outCubic(span(t, 0.04 + 0.022 * rank, 0.3 + 0.03 * rank));
      if (on <= 0) continue;
      const fade = keep ? 1 - sstep(T_LOCK + 0.02, T_LOCK + 0.16, t) : 1 - sstep(T_MORPH - 0.04, T_MORPH + 0.16 + lag, t);
      if (fade <= 0) continue;
      const iNear = 1 / ZF + (1 / ZN - 1 / ZF) * on; // el extremo cercano viaja desde el horizonte
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const iz = iNear + (1 / ZF - iNear) * u;
        const z = 1 / iz;
        let x = vx + f * (lx - CAM_X) * iz;
        let y = vy + f * ch * iz;
        let hw = Math.max(0.35, Math.min(2.4, f * 0.008 * iz));
        let a = 0.92 * Math.exp(-z / 40) * (0.5 + 0.5 * sstep(1.5, 7, z)) * lineIn;
        const t0 = T_MORPH + lag + 0.1 * (1 - u); // el horizonte se levanta primero
        const m = antic(span(t, t0, t0 + 0.36));
        if (m !== 0) {
          const k = i * 5;
          const rx = R.ox + R.s * (SP.P[k] + SP.P[k + 2] * off);
          const ry = R.oy + R.s * (SP.P[k + 1] + SP.P[k + 3] * off);
          x += (rx - x) * m;
          y += (ry - y) * m;
          const mc = clamp(m);
          hw += (0.8 - hw) * mc;
          a += ((keep ? 1 : 0.6) - a) * mc;
        }
        X[i] = x; Y[i] = y; HW[i] = hw; A[i] = a * fade;
      }
      ribbon(N, [246, 246, 248], [120, 132, 152], 'source-over');
      if (on < 1) { // la punta que sale disparada hacia la cámara
        const tip = (1 - on) * lineIn;
        soft(X[0], Y[0], 9, [255, 255, 255], 0.8 * tip);
      }
    }

    // ── Luces de ritmo: corren por su calle hacia el horizonte con una estela larga y encienden el suelo
    if (wk > 0.01) {
      for (const [cx, s0, d, I] of COMETS) {
        const p = span(t, s0, s0 + d);
        if (p <= 0 || p >= 1) continue;
        const zc = cometZ(p);
        const ign = sstep(0, 0.12, p) * wk;
        const fog = Math.exp(-zc / 80);
        const zt = Math.max(ZN, zc - (3 + 40 * sstep(0, 0.6, p)));
        const n = 16;
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1);
          const iz = 1 / zt + (1 / zc - 1 / zt) * u;
          X[i] = vx + f * (cx - CAM_X) * iz;
          Y[i] = vy + f * ch * iz;
          HW[i] = Math.max(0.8, Math.min(14, f * 0.09 * iz)) * (0.3 + 0.7 * u);
          A[i] = I * ign * fog * u ** 2;
        }
        // estela: tres capas (halo ancho, cuerpo, núcleo) = una caída suave sin bordes duros
        for (let i = 0; i < n; i++) A[i] *= 0.13;
        ribbon(n, [255, 60, 10], [255, 90, 31], 'lighter');
        for (let i = 0; i < n; i++) { HW[i] *= 0.45; A[i] *= 2.4; }
        ribbon(n, [255, 70, 20], [255, 110, 56], 'lighter');
        for (let i = 0; i < n; i++) { HW[i] = Math.max(0.45, HW[i] * 0.3); A[i] = Math.min(1, A[i] * 3.2); }
        ribbon(n, [255, 120, 70], [255, 238, 228], 'lighter');
        const hx = X[n - 1];
        const fy = Y[n - 1];
        const rad = Math.max(3, Math.min(52, f * 0.55 / zc));
        soft(hx, fy, rad * 3.4, [255, 90, 31], 0.3 * I * ign * fog, 0.22);
        hot(hx, fy - rad * 0.1, rad * 1.3, ign * (0.6 + 0.4 * I), 0.7 + 0.3 * I);
      }
    }

    // ── Polvo en suspensión, con desenfoque de movimiento
    const dA = 0.3 * wk * sstep(0.16, 0.45, t);
    if (dA > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (const [dx, dy, dz] of DUST) {
        const z = ((dz - camZ) % 30 + 30) % 30 + 1.2;
        const z2 = z + vCam * 0.012;
        const fx = (dx - CAM_X) * f;
        const fy = (ch - dy) * f;
        ctx.strokeStyle = rgba(230, 236, 246, dA * Math.exp(-z / 16));
        ctx.lineWidth = Math.max(0.5, Math.min(1.7, f * 0.004 / z));
        ctx.beginPath();
        ctx.moveTo(vx + fx / z, vy + fy / z);
        ctx.lineTo(vx + fx / z2 + 0.01, vy + fy / z2);
        ctx.stroke();
      }
    }

    // ── La r: cristaliza, el corredor ember enciende su calle y pasa a vector (SVG) en cuanto se asienta
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fill = outCubic(span(t, T_FILL[0], T_FILL[1]));
    const fl = t < T_LOCK ? sstep(T_LOCK - 0.07, T_LOCK, t) : Math.exp(-(t - T_LOCK) / 0.14);
    const q = span(t, T_RUN[0], T_RUN[1]);
    const lit = runEase(q) * ES.len;
    if (!swapped && t >= T_SWAP) {
      swapped = true;
      svgR.style.opacity = '1';
    }
    if (fill > 0 && !swapped) {
      ctx.setTransform(dpr * R.s, 0, 0, dpr * R.s, dpr * R.ox, dpr * R.oy);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = fill;
      ctx.fillStyle = '#dcdcdc';
      ctx.fill(pWhite, 'evenodd');
      ctx.fillStyle = '#161616'; // la calle interior, aún apagada
      ctx.fill(pEmber);
      ctx.globalAlpha = 1;
      if (lit > 0.01) {
        ctx.save();
        ctx.clip(pEmber);
        ctx.strokeStyle = E;
        ctx.lineWidth = 22;
        ctx.lineCap = 'butt';
        ctx.setLineDash([lit, ES.len + 10]);
        ctx.stroke(pSpineE);
        ctx.restore();
      }
      if (fl > 0.01) { // la r al rojo blanco un instante
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55 * fl;
        ctx.fillStyle = '#fff';
        ctx.fill(pWhite, 'evenodd');
        ctx.globalAlpha = 1;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    ctx.globalCompositeOperation = 'lighter';
    // destello al encajar: un florecimiento corto, blanco cálido con borde ember
    if (fl > 0.01) {
      soft(R.ox + 34 * R.s, R.oy + 46 * R.s, Math.max(W, H) * 0.34, [255, 236, 224], 0.3 * fl);
      soft(R.ox + 34 * R.s, R.oy + 46 * R.s, Math.max(W, H) * 0.6, [255, 90, 31], 0.1 * fl);
    }
    // el corredor
    if (q > 0 && t < T_RUN[1] + 0.2) {
      const op = q < 1 ? sstep(0, 0.08, q) : 1 - span(t, T_RUN[1], T_RUN[1] + 0.16);
      if (op > 0.01) {
        ctx.setTransform(dpr * R.s, 0, 0, dpr * R.s, dpr * R.ox, dpr * R.oy);
        ctx.lineCap = 'round';
        const tl = Math.min(lit, 34);
        ctx.setLineDash([tl, ES.len + 40]);
        ctx.lineDashOffset = -(lit - tl);
        ctx.strokeStyle = rgba(255, 90, 31, 0.55 * op);
        ctx.lineWidth = 10;
        ctx.stroke(pSpineE);
        ctx.strokeStyle = rgba(255, 206, 182, 0.85 * op);
        ctx.lineWidth = 3;
        ctx.stroke(pSpineE);
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const [hx, hy] = onEmber(lit);
        const rr = 16 * R.s;
        hot(hx, hy, rr * 2.6, op);
      }
    }
    // la calle ember encendida: un último pulso al final del recorrido
    const bq = span(t, T_RUN[1] - 0.04, T_RUN[1] + 0.56);
    if (bq > 0 && bq < 1) {
      const bo = bq < 0.1 ? bq / 0.1 : 1 - sstep(0.1, 1, bq);
      const [ex, ey] = onEmber(ES.len);
      soft(ex, ey, 70 * R.s * (0.6 + 0.6 * outCubic(bq)), [255, 110, 56], 0.5 * bo);
    }
    return t < T_STILL;
  };
}

let live = null; // la intro en pantalla (solo una)

/** Monta la intro encima de todo (la app se pinta debajo). Nunca lanza: ante cualquier fallo se retira. */
export function playIntro({ resume = false } = {}) {
  if (live) return;
  let el = null;
  let raf = 0;
  const timers = [];
  const onRoute = () => { if (/^#\/(play|summary)\b/.test(location.hash || '')) remove(); };
  const onHide = () => { if (document.visibilityState === 'hidden') remove(); };
  const remove = () => {
    window.removeEventListener('hashchange', onRoute);
    document.removeEventListener('visibilitychange', onHide);
    timers.forEach(clearTimeout);
    timers.length = 0;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (el) {
      el.querySelectorAll('video').forEach((v) => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* nada */ } });
      el.remove();
    }
    el = null;
    live = null;
  };
  try {
    if (!shouldPlay(resume)) return;
    try { sessionStorage.setItem(SHOWN, '1'); } catch { /* nada */ }
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el = document.createElement('div');
    el.id = 'ritmup-intro';
    el.className = `ri${reduced ? ' ri--still' : ''}${resume ? ' ri--resume' : ''}`;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'RITMUP');
    el.innerHTML = markup(reduced);
    live = remove;
    // Saltar con un toque: fundido corto y fuera
    el.addEventListener('pointerdown', () => {
      if (!el || el.dataset.out) return;
      el.dataset.out = '1';
      try {
        const from = getComputedStyle(el).opacity;
        el.animate([{ opacity: from }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
        timers.push(setTimeout(remove, 240));
      } catch { remove(); }
    }, { passive: true });
    document.body.appendChild(el);
    window.addEventListener('hashchange', onRoute);
    document.addEventListener('visibilitychange', onHide);
    timers.push(setTimeout(remove, HARD_MS)); // red de seguridad

    if (reduced) { // movimiento reducido: el logotipo quieto y un fundido de 0,5 s
      // (con Web Animations: base.css anula los retrasos de las animaciones CSS con «Reducir movimiento»)
      try { el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, delay: 900, easing: 'ease', fill: 'forwards' }); } catch { /* nada */ }
      timers.push(setTimeout(remove, 1450));
      return;
    }
    const draw = stage(el, remove);
    let t0 = -1;
    const frame = (now) => {
      raf = 0;
      if (!el) return;
      try {
        if (t0 < 0) t0 = now; // el primer fotograma, a la vez que arrancan las animaciones CSS
        if (draw((now - t0) / 1000)) raf = requestAnimationFrame(frame);
      } catch {
        remove();
      }
    };
    raf = requestAnimationFrame(frame);
    timers.push(setTimeout(remove, T_END * 1000 + 120));
  } catch {
    remove();
  }
}

/** Al volver a la app tras ≥ 20 s fuera (preferencia 'always'): nunca con una hoja abierta ni sobre una clase. */
export function introOnResume() {
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    try {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (away < AWAY_MS) return;
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
      const ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
      playIntro({ resume: true });
    } catch { /* nada */ }
  });
}

// Deja la foto del corte en la caché (la del service worker) para que el próximo arranque ya la tenga lista.
try {
  setTimeout(() => { try { const im = new Image(); im.decoding = 'async'; im.src = CUT_SRC; } catch { /* nada */ } }, 6000);
} catch { /* sin temporizadores */ }
