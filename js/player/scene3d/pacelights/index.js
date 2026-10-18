// BestRunning · escena 3D · LUCES DE TU RÉCORD («Wavelight»): sustituyen la marca propia del fantasma de cada mundo.
//
// Idea: una hilera de LED fija en el suelo del escenario (pasa bajo la cámara a TU velocidad) y una «ventana» de LED
// encendidos que va donde va tu mejor marca. Como los LED están clavados al suelo y la ventana va con el récord, la luz
// recorre la hilera exactamente a ritmo de récord: si te saca ventaja la ves delante; si le recortas, se te acerca;
// cuando le pasas, la ventana cruza la LÍNEA DE PASO (siempre en el hueco libre entre el bloque de velocidad y el
// rótulo inferior), se vuelve dorada y, en el siguiente beat, una sola línea fina de oro recorre la hilera hasta el
// horizonte (≈ 0,9 s) y deja un rescoldo. Luego el chip del HUD lo confirma en texto: primero se ve, luego se lee.
//
//   const pace = createPaceLights({ THREE, scene, camera, renderer, hud, pulse, snap, target });
//   pace.bind(theme) → bool   // false si el escenario no tiene LOOK (legacy conserva su fantasma)
//   pace.update(F)            // cada fotograma, tras rig.update (cámara final con el desplazamiento de lente)
//   pace.event('seek' | 'ghost') · pace.unbind() · pace.dispose() · pace.info() / pace.cost() (depuración)
//
// Reglas: 2 draw calls (emisores con reflejos + cinta); cordillera y 'eco', 1. Sin pases extra (el bloom del núcleo
// hace el brillo). Cero asignaciones en update(): arrays reservados al crear y subidos enteros (≤ 4 KB por atributo;
// los rangos de three ordenan con un cierre nuevo en cada subida).
// Determinista: solo F.time / F.dt / F.beatPhase / F.bpm / F.musicBeat; nada de Math.random / performance.now / Date.
// El grupo vive en `scene` (nunca en el root del escenario): disposeTree del núcleo no lo toca.
import { createPath } from './path.js';
import { createEmitters, createRibbon, LOOKS, GAP_PX } from './lights.js';
import { RC, LANE_W } from '../themes/estadio/track.js';
import { ZONE_RANK } from '../util.js';

const CAP = 256;          // instancias (LED + reflejos, compactados) — la hilera más larga a calidad alta
const NMAX = 128;         // puntos de la hilera (pares de lámparas en cordillera)
const RIB_M = 48;         // secciones de la cinta (49 cortes)
const K = 20;             // muestras del buscador de la línea de paso
const CUE_T = 1.4;        // s de la línea de oro
const COOLDOWN = 45;      // s entre dos líneas de oro (= el del rótulo del HUD)
const STABLE = { top: 1, speed: 1, segment: 1, panel: 1, info: 1 }; // 'transient' y 'controls' no mueven las luces

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, l, dt) => b + (a - b) * Math.exp(-l * dt);
const approach = (from, to, rate, dt) => (to > from ? Math.min(to, from + rate * dt) : Math.max(to, from - rate * dt));
const mod = (a, m) => ((a % m) + m) % m;

/** Escribe una instancia en los arrays de los emisores (sin asignar). */
function put(E, c, x, y, z, tx, ty, tz, len, I, haloK, kind, mix, base, gold) {
  const P = E.iP.array; const T = E.iT.array; const Sx = E.iS.array; const k = c * 4;
  P[k] = x; P[k + 1] = y; P[k + 2] = z; P[k + 3] = I;
  T[k] = tx; T[k + 1] = ty; T[k + 2] = tz; T[k + 3] = len;
  Sx[k] = haloK; Sx[k + 1] = kind; Sx[k + 2] = mix; Sx[k + 3] = base;
  E.iW.array[c] = gold;
}

/**
 * target: () => el render target HDR donde se pinta la escena (post.target; null sin composer). La compilación
 * anticipada debe hacerse contra él: el programa de three depende del destino (tone mapping y espacio de color).
 */
export function createPaceLights({ THREE, scene, camera, renderer, hud, pulse = null, snap = false, target = null }) {
  const root = new THREE.Group();
  root.name = 'pace-lights';
  root.matrixAutoUpdate = false;
  root.visible = false;
  scene.add(root);
  const E = createEmitters(THREE, CAP);
  const R = createRibbon(THREE, RIB_M);
  root.add(R.mesh);
  root.add(E.mesh);
  const path = createPath(THREE);

  const Q = { x: 0, y: 0, z: 0, fx: 0, fz: -1, slope: 0 };
  const v3 = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const colA = new THREE.Color();
  const colB = new THREE.Color();
  const goldC = new THREE.Color();
  // hilera (por punto): posición, tangente, adelante horizontal, pantalla, profundidad
  const pX = new Float32Array(NMAX); const pY = new Float32Array(NMAX); const pZ = new Float32Array(NMAX);
  const pTx = new Float32Array(NMAX); const pTy = new Float32Array(NMAX); const pTz = new Float32Array(NMAX);
  const pFx = new Float32Array(NMAX); const pFz = new Float32Array(NMAX);
  const pSx = new Float32Array(NMAX); const pSy = new Float32Array(NMAX); const pDep = new Float32Array(NMAX);
  const pOk = new Uint8Array(NMAX);
  // buscador
  const sD = new Float32Array(K); const sX = new Float32Array(K); const sY = new Float32Array(K); const sOk = new Uint8Array(K);

  let L = null;
  let themeId = null;
  let bound = false;
  let disposed = false;
  const S = {
    // configuración viva
    q: '', tv: false, refl: false, rib: false, iK: 1, gap: 6,
    // composición
    snap: true, alpha: 0, dS: 0, dVis: 10, dPass: 15, dEnd: 60, tVis: 10, tPass: 15, tEnd: 60, ok: false,
    solveAt: -1e9, hudV: -1, portrait: true, tvS: false, px: 0, py: 0, front: false, W: 0, lat: 0, count: 0, time: 0,
    // momento del oro
    cueT0: -1e9, gCue: 0, cueRM: false, pendingAt: -1, lastPass: -1e9, blockUntil: -1e9, prevOn: false, prevW: NaN,
    prevPhase: 0, evt: false, hide: false, w: -30, goldT0: -1e9,
    // la caza: le estás recortando (0..1) y su intensidad en este fotograma
    closing: 0, chase: 0,
  };

  function configure(F) {
    const eco = F.quality === 'eco';
    S.q = F.quality;
    S.tv = !!F.tvMode;
    const u = E.u;
    colA.set(L.col); colB.set(L.col2); goldC.set(L.gold);
    u.uCol.value.copy(colA); u.uCol2.value.copy(colB); u.uGold.value.copy(goldC);
    u.uBase.value.copy(colA).multiplyScalar(0.05);
    // sin bloom ('eco') el brillo sale de dentro del quad: halo doble, algo menos de núcleo y un mínimo más grueso
    u.uPxMin.value = (L.pxMin + (eco ? 0.4 : 0)) * (S.tv ? 1.3 : 1);
    u.uEPow.value = L.ePow ?? 1;
    u.uHalo.value = (L.halo ?? 0.3) * (eco ? 2 : 1);
    u.uPitch.value = L.pitch;
    u.uAcross.value = L.led[1];
    u.uFlat.value = L.flat ? 1 : 0;
    S.refl = !eco && !!L.refl;
    if (L.refl) { u.uRefl.value = L.refl.I; u.uReflStretch.value = L.refl.stretch; }
    S.iK = eco ? 0.8 : 1;
    S.gap = (GAP_PX[F.quality] || 6) * (L.gapPx || 1);
    E.mat.depthTest = !!L.depth;
    R.mat.depthTest = !!L.depth;
    // por debajo de los rótulos 3D del escenario (aurora los pinta en 20, sin prueba de profundidad)
    E.mesh.renderOrder = L.ro ?? 600;
    R.mesh.renderOrder = (L.ro ?? 600) - 1;
    S.rib = !eco && !!L.rib;
    R.mesh.visible = S.rib;
    if (L.rib) { R.u.uSharp.value = L.rib.sharp; R.u.uTint.value = 1; }
  }

  /** Carril de la hilera (u a la derecha de tu trayectoria). */
  function laneOf() {
    const b = L.lat === 'line' ? LANE_W - RC : L.lat === 'ghost' ? path.head.lat : L.lat;
    return (Number.isFinite(b) ? b : 0) + (L.latOff || 0);
  }

  /** ¿Se ve la hilera a d u (dentro de pantalla y fuera de todo bloque estable del HUD)? Deja la pantalla en S.px/py. */
  function sampleOk(d, lat, Wc, Hc) {
    path.point(d, lat, Q);
    v3.set(Q.x, Q.y + L.y, Q.z).project(camera);
    S.front = v3.z < 1 && v3.z > -1;
    if (!S.front) return 0;
    const px = (v3.x * 0.5 + 0.5) * Wc;
    const py = (0.5 - v3.y * 0.5) * Hc;
    S.px = px; S.py = py;
    if (px < 12 || px > Wc - 12 || py < 12 || py > Hc - 12 || py < 0.06 * Hc) return 0;
    const rects = hud?.rects;
    if (rects) {
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (!r || STABLE[r.kind] !== 1) continue;
        if (px > r.x - 10 && px < r.x + r.w + 10 && py > r.y - 10 && py < r.y + r.h + 10) return 0;
      }
    }
    return 1;
  }

  /**
   * Buscador de la LÍNEA DE PASO: el primer tramo de la hilera (≥ 3 muestras seguidas) que se ve entre los bloques
   * del HUD. dVis = su borde cercano (afinado por bisección), dEnd = el lejano, dPass = el punto al 30 % de su largo
   * en pantalla. Sin hueco: valores de respaldo del escenario. Con prueba de profundidad (cordillera) el tramo acaba
   * en la cresta: lo que queda detrás proyecta por debajo de la silueta ya vista y el terreno lo tapa.
   */
  function solve(F, lat, now) {
    S.solveAt = F.time;
    S.hudV = hud?.version ?? 0;
    S.portrait = !!F.portrait;
    S.tvS = !!F.tvMode;
    const Wc = F.width || 440;
    const Hc = F.height || 956;
    const n0 = L.near[1];
    const ratio = L.dFar / n0;
    let yMin = Infinity;
    for (let k = 0; k < K; k++) {
      sD[k] = n0 * Math.pow(ratio, k / (K - 1));
      sOk[k] = sampleOk(sD[k], lat, Wc, Hc);
      sX[k] = S.px; sY[k] = S.py;
      if (L.depth && S.front) {
        if (S.py > yMin + 2) sOk[k] = 0;          // tras la cresta (aunque el HUD tape la cresta, tapa igual)
        else if (S.py < yMin) yMin = S.py;
      }
    }
    let a = -1;
    let b = -1;
    for (let k = 0; k < K; k++) {
      if (!sOk[k]) continue;
      let e = k;
      while (e + 1 < K && sOk[e + 1]) e++;
      if (e - k + 1 >= 3) { a = k; b = e; break; }
      k = e;
    }
    if (a < 0) {
      S.ok = false;
      S.tVis = L.near[1]; S.tPass = L.passFallback; S.tEnd = L.dFar;
    } else {
      S.ok = true;
      let dv = sD[a];
      if (a > 0) {
        let lo = sD[a - 1];
        let hi = sD[a];
        for (let s = 0; s < 6; s++) { const m = (lo + hi) * 0.5; if (sampleOk(m, lat, Wc, Hc)) hi = m; else lo = m; }
        dv = hi;
      }
      sampleOk(dv, lat, Wc, Hc);
      const x0 = S.px; const y0 = S.py;
      // largo en pantalla del tramo libre y el punto al 30 %
      let total = 0;
      let px = x0; let py = y0;
      for (let k = a; k <= b; k++) { if (sD[k] <= dv) continue; total += Math.hypot(sX[k] - px, sY[k] - py); px = sX[k]; py = sY[k]; }
      const target = 0.3 * total;
      let acc = 0;
      let pd = dv;
      let dPass = sD[b];
      px = x0; py = y0;
      for (let k = a; k <= b; k++) {
        if (sD[k] <= dv) continue;
        const seg = Math.hypot(sX[k] - px, sY[k] - py);
        if (acc + seg >= target) { dPass = pd + (sD[k] - pd) * ((target - acc) / Math.max(seg, 1e-6)); break; }
        acc += seg; px = sX[k]; py = sY[k]; pd = sD[k];
      }
      S.tVis = dv;
      S.tEnd = sD[b];
      S.tPass = Math.max(dPass, dv + 2 * L.pitch);
    }
    if (now) { S.dVis = S.tVis; S.dPass = S.tPass; S.dEnd = S.tEnd; }
  }

  function cancelCue() { S.cueT0 = -1e9; S.pendingAt = -1; }

  function update(F) {
    if (!bound || disposed) return;
    if (S.hide) { root.visible = false; return; }   // solo laboratorio (A/B de coste)
    if (F.quality !== S.q || !!F.tvMode !== S.tv) configure(F);
    const jump = path.update(F);
    const dt = F.dt > 0 ? Math.min(0.1, F.dt) : 0;
    S.time = F.time;
    const G = F.ghost;
    const active = !!G.active && Number.isFinite(G.deltaM);
    // m que te saca el récord (+) / le sacas (−). Sin fantasma activo (final, vuelta a 'ready') se conserva la última
    // ventaja: la hilera se funde donde estaba, sin que la ventana corra hacia la cámara
    const w = active ? -G.deltaM : (Number.isFinite(S.w) ? S.w : -30);
    S.w = w;
    // visibilidad: clase en marcha o en pausa (atenuada), fundidos lineales (0,8 s; 1,2 s en el final)
    const want = active && path.head.ok && (F.status === 'running' || F.status === 'paused') && !(F.finale > 0) ? (F.paused ? 0.55 : 1) : 0;
    const frozen = want === 0;                     // fundido de salida: la composición queda quieta, solo baja la luz
    S.alpha = approach(S.alpha, want, F.finale > 0 ? 1 / 1.2 : 1 / 0.8, dt);
    if (S.evt) { S.evt = false; S.blockUntil = F.time + 2; S.snap = true; cancelCue(); }
    if (S.alpha <= 0.002 || !path.head.ok) {
      root.visible = false;
      S.snap = true; S.prevOn = !!F.record.on; S.prevW = NaN; S.prevPhase = F.beatPhase; S.count = 0;
      cancelCue();
      return;
    }
    root.visible = true;
    const reduced = !!F.reducedMotion;
    const Wc = F.width || 440;
    const Hc = F.height || 956;
    E.u.uRes.value.set(Wc, Hc);
    E.u.uAlpha.value = S.alpha;
    R.u.uAlpha.value = S.alpha;
    const lat = laneOf();
    S.lat = lat;
    const p = L.pitch;
    const g = path.g;
    const amt = F.record.amount;

    // ── línea de paso: al enganchar, al girar / modo TV y tras un salto, al instante; si cambia el HUD o cada 0,5 s,
    //    se recalcula y se acerca ≤ 3 %/s (la ventana nunca resbala contra los LED clavados al suelo). En el fundido
    //    de salida nada se recoloca (ni un salto del plano final): el recolocado pendiente queda para la próxima vez ──
    const snapNow = !frozen && (S.snap || jump || !!F.portrait !== S.portrait || !!F.tvMode !== S.tvS);
    if (snapNow) solve(F, lat, true);
    else if (!frozen) {
      if ((hud?.version ?? 0) !== S.hudV || F.time - S.solveAt > 0.5) solve(F, lat, false);
      S.dVis = approach(S.dVis, S.tVis, 0.03 * S.dVis, dt);
      S.dPass = approach(S.dPass, S.tPass, 0.03 * S.dPass, dt);
      S.dEnd = approach(S.dEnd, S.tEnd, 0.03 * S.dEnd, dt);
    }

    // ── cabeza: la ventaja +3 m (umbral del oro del núcleo) cruza la línea de paso en el MISMO fotograma del récord ──
    const wp = w + 3;
    const Aeff = Math.max(0, Math.min(L.A, 0.85 * (S.dEnd - S.dPass)));
    const dHeadT = wp >= 0 ? S.dPass + Aeff * (1 - Math.exp(-wp / L.s)) : S.dPass + (Aeff / L.s) * wp;
    S.dS = snapNow ? dHeadT : frozen ? S.dS : damp(S.dS, dHeadT, reduced ? 1.5 : 3, dt);
    if (!frozen) S.snap = false;
    const dHead = S.dS;
    const Wd = clamp(L.winK * dHead, L.win, L.winMax);
    const W = Math.max(6 * p, Math.min(Wd, dHead - S.dVis + p));   // se acorta al acercarse: nunca bajo el rótulo
    S.W = W;

    // ── momento del oro: flanco de subida de F.record.on, válido solo corriendo, sin salto y tras el bloqueo ──
    const on = !!F.record.on;
    if (on && !S.prevOn) {
      S.goldT0 = F.time;                           // la ventana se dora YA (antes que el chip); la línea espera al beat
      const valid = F.status === 'running' && !F.paused && Math.abs(w - S.prevW) < 1 && F.time > S.blockUntil && S.alpha > 0.5;
      if (valid && F.time - S.lastPass >= COOLDOWN) S.pendingAt = F.time;   // dentro del enfriamiento: solo el color
    }
    if (S.pendingAt >= 0) {
      if (!on || F.status !== 'running' || F.paused || F.finale > 0) S.pendingAt = -1;
      else {
        const waited = F.time - S.pendingAt;
        // nunca encima del coach (cambio de tramo): espera ≤ 2,5 s; y si el beat está a < 0,35 s, sale en el beat
        const busy = (F.segElapsed < 1.2 || F.timeToNext < 1.5) && waited < 2.5;
        const toBeat = F.bpm > 0 ? ((1 - F.beatPhase) * 60) / F.bpm : 1;
        const wrap = F.beatPhase < S.prevPhase;
        if (!busy && (wrap || !F.musicBeat || toBeat >= 0.35 || waited > 3)) {
          S.pendingAt = -1;
          S.cueT0 = F.time;
          S.gCue = g + S.dPass;                     // el origen de la línea queda clavado al suelo
          S.cueRM = reduced;
          S.lastPass = F.time;
          if (!reduced && themeId !== 'aurora' && pulse) { try { pulse(0.04, 1.8); } catch { /* opcional */ } }
        }
      }
    }
    if (F.paused || F.finale > 0) S.cueT0 = -1e9;
    const tc = F.time - S.cueT0;
    const cueOn = tc >= 0 && tc < CUE_T + 4;
    // oro de la ventana (y de la cinta): en 0,25 s desde el fotograma del récord; al perderlo, se apaga con el núcleo
    const gW = on ? Math.max(amt, smoothstep(0, 0.25, F.time - S.goldT0)) : amt;
    // la línea de oro recorre en 0,9 s el tramo de hilera que SE VE (hasta el horizonte o la cresta), en LED desde su
    // origen; acelera como la perspectiva (en pantalla avanza casi a ritmo constante)
    const run = cueOn ? Math.max(8, (g + S.dEnd - S.gCue) / p) : 0;
    const uc = clamp(tc / 0.9, 0, 1);
    const fi = run * uc * (0.3 + 0.7 * uc);

    // ── la caza: le recortas (> 0,3 m/s) a menos de 12 m, en un tramo de correr o más rápido y lejos de los cambios ⇒
    //    los LED entre tú y la ventana dibujan una pista tenue que se acorta y, con la música, un pulso por beat que
    //    salta LED a LED desde el rótulo hasta la ventana (nunca dorado; desemboca en la línea de paso) ──
    if (dt > 0 && Number.isFinite(S.prevW)) S.closing = damp(S.closing, (S.prevW - w) / dt > 0.3 ? 1 : 0, 2, dt);
    const quiet = F.segElapsed > 1.5 && F.timeToNext > 1.5;
    const chase = !on && w > -3 && F.running && !F.paused && (ZONE_RANK[F.zone] ?? 0) >= 3 && quiet
      ? smoothstep(12, 0, w) * S.closing : 0;
    S.chase = chase;
    const runEnd = dHead - W;
    const pulseOn = chase > 0.01 && F.musicBeat && !reduced && runEnd > S.dVis + 2 * p;
    const bph = F.beatPhase;
    const dfq = pulseOn ? Math.round((g + S.dVis + (runEnd - S.dVis) * bph) / p) * p - g : 0;

    // ── pasada 1: geometría y proyección de la hilera ──
    const n = Math.min(L.n, NMAX);
    const f = Math.max(2 * p, 0.08 * S.dVis);
    const dStart = Math.max(S.dVis - f - p, dHead - L.back);
    const s0 = Math.ceil((g + dStart) / p) * p;
    const gi0 = Math.round(s0 / p);
    camPos.setFromMatrixPosition(camera.matrixWorld);
    for (let i = 0; i < n; i++) {
      const d = s0 + i * p - g;
      path.point(d, lat, Q);
      const y = Q.y + L.y;
      const tl = Math.hypot(Q.fx, Q.slope, Q.fz) || 1;
      const hl = Math.hypot(Q.fx, Q.fz) || 1;
      pX[i] = Q.x; pY[i] = y; pZ[i] = Q.z;
      pTx[i] = Q.fx / tl; pTy[i] = Q.slope / tl; pTz[i] = Q.fz / tl;
      pFx[i] = Q.fx / hl; pFz[i] = Q.fz / hl;
      v3.set(Q.x, y, Q.z).project(camera);
      pOk[i] = v3.z < 1 && v3.z > -1 ? 1 : 0;
      pSx[i] = (v3.x * 0.5 + 0.5) * Wc;
      pSy[i] = (0.5 - v3.y * 0.5) * Hc;
      pDep[i] = Math.hypot(Q.x - camPos.x, y - camPos.y, Q.z - camPos.z);
    }

    // ── pasada 2: intensidades, octavas de LED (fijas al suelo), oro y compactación ──
    const e = p * 0.55;
    // estela de movimiento (obturador de 180°), con el núcleo siempre ≤ ~40 % del paso: puntos de luz, no guiones
    const streak = reduced || F.paused ? 0 : Math.min(Math.abs(path.v) * dt * 0.5, Math.max(0, 0.35 * p - L.led[0]));
    const len = L.led[0] + streak;
    const pair = L.pair || 0;
    const gap = S.gap;
    const iL = L.I * S.iK;
    let c = 0;
    for (let i = 0; i < n && c < CAP; i++) {
      if (!pOk[i]) continue;
      const d = s0 + i * p - g;
      const x = dHead - d;                                         // detrás de la cabeza (+)
      // paso real en pantalla (px CSS) con el vecino
      const jn = i > 0 ? i - 1 : (i + 1 < n ? i + 1 : i);
      const pPx = Math.hypot(pSx[i] - pSx[jn], pSy[i] - pSy[jn]);
      const gi = gi0 + i;
      const lv = clamp(Math.log2(gap / Math.max(pPx, 0.01)), 0, 4);
      const l0 = Math.floor(lv);
      const fr = smoothstep(0.15, 0.85, lv - l0);
      const m0 = 1 << l0;
      const keep0 = mod(gi, m0) === 0;
      if (!keep0) continue;
      const keep1 = mod(gi, 2 * m0) === 0;
      const vis = keep1 ? 1 : 1 - fr;
      if (vis <= 0.001) continue;
      const haloK = smoothstep(4, 10, pPx * m0);

      const win = smoothstep(-e, e, x) * (1 - smoothstep(W - e, W + e, x));
      const trail = x > W ? Math.exp(-(x - W) / L.trail) * 0.4 : 0;
      const headK = x > -e ? Math.exp(-Math.max(0, x) / (p * 1.1)) * L.head * (1 + 0.35 * chase) : 0;
      const nearK = smoothstep(S.dVis - f, S.dVis + 0.3 * f, d) * smoothstep(L.near[0], L.near[1], d);
      const closeK = L.close ? L.close[2] + (1 - L.close[2]) * smoothstep(L.close[0], L.close[1], d) : 1;
      const rowEndK = 1 - smoothstep(0.85 * (n - 1), n - 1, i);
      let I = (win * (1 + headK) + trail * (1 - win)) * iL * nearK * closeK * rowEndK;
      let base = L.baseSpan > 0 ? L.base * Math.exp(-Math.abs(x - W * 0.5) / L.baseSpan) * nearK * rowEndK : 0;
      // reposo dorado (≤ 6 %) cuando vas delante: solo un tramo corto pasada la línea de paso (no pinta la curva entera)
      if (d > S.dPass) base = Math.max(base, 1.2 * amt * Math.exp(-(d - S.dPass) / (L.restSpan || 12)) * nearK * rowEndK);
      if (chase > 0.01 && d >= S.dVis - f && d <= runEnd) {
        base = Math.max(base, 0.6 * chase * nearK * rowEndK);          // pista tenue (fría)
        if (pulseOn) { const q = (d - dfq) / (0.9 * p * m0); I += 0.6 * chase * iL * Math.exp(-q * q) * (0.6 + 0.4 * (1 - bph)) * nearK; }
      }
      let gold = gW;
      if (cueOn) {
        let goldCue;
        if (S.cueRM) goldCue = smoothstep(0, 1, tc);                    // movimiento reducido: fundido a oro en 1 s
        else {
          const jj = (g + d - S.gCue) / p;                               // LED desde el origen de la línea
          const bw = Math.max(2.2, 1.2 * m0);                            // cubre siempre un LED superviviente
          const q = (jj - fi) / bw;
          const fade = tc < CUE_T ? 1 - tc / CUE_T : 0;
          const band = fade > 0 ? Math.exp(-q * q) * Math.sqrt(fade) : 0;
          // cabeza de la línea + cola corta (cometa) y rescoldo por la intensidad (con halo, no por el reposo plano):
          // pico ≤ 1,4× el cuerpo de la ventana
          let lit = 1.05 * band;
          if (jj < fi && fade > 0) {
            const behind = fi - jj;
            lit += 0.35 * Math.exp(-behind / 12) * fade + 0.12 * Math.exp(-behind / 25) * fade;
          }
          I += lit * iL * nearK * rowEndK;
          // por delante de la cabeza, el LED que ya recibe luz de la línea es oro entero (nunca un punto blanco que la
          // preceda); los que aún no la reciben conservan su reposo frío hasta que pasa
          goldCue = jj < 0 ? smoothstep(0, 0.25, tc) : (jj < fi ? 1 : smoothstep(0.02, 0.2, band));
        }
        gold = Math.max(goldCue * (1 - smoothstep(CUE_T + 3, CUE_T + 4, tc)), gW);
      }
      I *= vis * Math.sqrt(m0 * (keep1 ? 1 + fr : 1));
      base *= vis;
      if (I + base < 1e-3) continue;
      const mix = clamp((x - W) / (L.trail * 2.2), 0, 1);
      if (pair > 0) {
        // dos hileras de lámparas a ±pair del camino (mismo índice de suelo y misma proyección)
        const ox = -pFz[i] * pair; const oz = pFx[i] * pair;
        put(E, c++, pX[i] + ox, pY[i], pZ[i] + oz, pTx[i], pTy[i], pTz[i], len, I, haloK, 0, mix, base, gold);
        if (c < CAP) put(E, c++, pX[i] - ox, pY[i], pZ[i] - oz, pTx[i], pTy[i], pTz[i], len, I, haloK, 0, mix, base, gold);
      } else put(E, c++, pX[i], pY[i], pZ[i], pTx[i], pTy[i], pTz[i], len, I, haloK, 0, mix, base, gold);
      if (S.refl && c < CAP) {
        // reflejo solo donde los LED quedan bien separados y no junto a la cámara (sin mancha azul al adelantar)
        const IR = I * smoothstep(gap, 2.5 * gap, pPx * m0) * smoothstep(2.5, 6, pDep[i]);
        if (IR > 1e-3) put(E, c++, pX[i], pY[i] - 2 * L.y, pZ[i], pTx[i], pTy[i], pTz[i], len, IR, 0, 1, mix, 0, gold);
      }
    }
    S.count = c;
    E.geo.instanceCount = c;
    E.mesh.visible = c > 0;
    // subida entera (sin rangos: three los ordena con un cierre nuevo por subida; ≤ 4 KB por atributo)
    E.iP.needsUpdate = true; E.iT.needsUpdate = true; E.iS.needsUpdate = true; E.iW.needsUpdate = true;

    // ── cinta: de la cabeza hacia atrás (estela fina / luz derramada en la pista); se dora con el récord ──
    if (S.rib) {
      const rb = L.rib;
      const m = R.m;
      const pos = R.pos.array; const av = R.av.array;
      const e5 = camera.projectionMatrix.elements[5];
      const rlat = lat + (rb.latOff || 0);
      // la cinta se dora al ritmo de la ventana (con amt a secas era una varilla verdosa entre LED dorados)
      R.u.uCol.value.copy(colA).lerp(goldC, gW);
      R.u.uCol2.value.copy(colB).lerp(goldC, gW);
      R.u.uAlpha.value = S.alpha * (1 - 0.4 * gW);   // dorada, más tenue: hilo bajo los LED, no una varilla naranja
      for (let j = 0; j <= m; j++) {
        const t = j / m;
        const d = dHead + W * 0.15 - t * rb.len;
        path.point(d, rlat, Q);
        const y = Q.y + rb.y;
        let sx; let sy; let sz;
        let hw = rb.w * 0.5;
        if (rb.flat) { const l = Math.hypot(Q.fx, Q.fz) || 1; sx = -Q.fz / l; sy = 0; sz = Q.fx / l; } else {
          // perpendicular a la tangente y a la visual ⇒ cinta de cara a la cámara
          const vx = Q.x - camPos.x; const vy = y - camPos.y; const vz = Q.z - camPos.z;
          const tx = Q.fx; const ty = Q.slope; const tz = Q.fz;
          sx = ty * vz - tz * vy; sy = tz * vx - tx * vz; sz = tx * vy - ty * vx;
          const l = Math.hypot(sx, sy, sz) || 1; sx /= l; sy /= l; sz /= l;
          const depth = Math.max(0.1, Math.hypot(vx, vy, vz));
          const ppw = (e5 * Hc * 0.5) / depth;
          hw = Math.max(hw, ((rb.minPx || 1.2) / ppw) * 0.5);
        }
        const nearK = smoothstep(S.dVis - f, S.dVis + 0.3 * f, d) * smoothstep(L.near[0], L.near[1], d);
        const head = smoothstep(0, 0.05, t);
        const I = head * Math.pow(1 - t, 1.6) * rb.I * nearK * (rb.flat ? 1 : Math.sqrt(Math.min(1, (rb.w * 0.5) / hw)));
        const a = j * 6;
        pos[a] = Q.x + sx * hw; pos[a + 1] = y + sy * hw; pos[a + 2] = Q.z + sz * hw;
        pos[a + 3] = Q.x - sx * hw; pos[a + 4] = y - sy * hw; pos[a + 5] = Q.z - sz * hw;
        const b = j * 4;
        av[b] = 1; av[b + 1] = I; av[b + 2] = -1; av[b + 3] = I;
      }
      R.pos.needsUpdate = true; R.av.needsUpdate = true;
    }
    S.prevOn = on;
    S.prevW = w;
    S.prevPhase = F.beatPhase;
  }

  function bind(theme) {
    unbind();
    if (disposed) return false;
    const look = theme && LOOKS[theme.id];
    if (!look) return false;                      // legacy (oculto) conserva su propio fantasma
    if (!path.bind(theme)) return false;
    L = look;
    themeId = theme.id;
    S.q = ''; S.snap = true; S.alpha = 0; S.solveAt = -1e9; S.prevOn = false; S.prevW = NaN; S.count = 0; S.w = -30;
    cancelCue();
    bound = true;
    // compilación anticipada (sin tirón de 50–150 ms cuando aparece el récord); en capturas se compila al pintar.
    // Contra el destino HDR de la escena: fuera del fotograma el destino es la pantalla y three compilaría la variante
    // con tone mapping y sRGB, que nunca se pinta. compileAsync fija los parámetros en su compile() síncrono
    if (!snap && renderer?.compileAsync) {
      const was = root.visible;
      const prev = renderer.getRenderTarget?.() ?? null;
      try {
        root.visible = true; E.mesh.visible = true; R.mesh.visible = true;
        renderer.setRenderTarget?.((typeof target === 'function' ? target() : null) || null);
        const pr = renderer.compileAsync(root, camera, scene);
        pr?.catch?.(() => {});
      } catch { /* opcional */ }
      try { renderer.setRenderTarget?.(prev); } catch { /* nada */ }
      root.visible = was;
    }
    return true;
  }

  function unbind() {
    bound = false;
    L = null;
    themeId = null;
    path.unbind();
    root.visible = false;
    E.geo.instanceCount = 0;
    S.alpha = 0;
    S.count = 0;
    cancelCue();
  }

  function cost() {
    const out = { calls: 0, triangles: 0, points: 0, lines: 0 };
    if (!root.visible) return out;
    if (E.mesh.visible && E.geo.instanceCount > 0) { out.calls++; out.triangles += 2 * E.geo.instanceCount; }
    if (R.mesh.visible) { out.calls++; out.triangles += 2 * R.m; }
    return out;
  }

  /** Depuración (laboratorio): puede asignar. */
  function info() {
    const proj = (d) => {
      if (!L) return { x: 0, y: 0 };
      path.point(d, S.lat, Q);
      v3.set(Q.x, Q.y + L.y, Q.z).project(camera);
      return { x: +((v3.x * 0.5 + 0.5) * (hud?.width || 440)).toFixed(1), y: +((0.5 - v3.y * 0.5) * (hud?.height || 956)).toFixed(1) };
    };
    const head = proj(S.dS);
    const tail = proj(Math.max(S.dVis, S.dS - S.W));
    const pass = proj(S.dPass);
    const vis = proj(S.dVis);
    const Hh = hud?.height || 956;
    const y0 = Math.min(head.y, tail.y); const y1 = Math.max(head.y, tail.y);
    const cueT = S.time - S.cueT0;
    return {
      theme: themeId, style: 'app', bound, visible: root.visible, opacity: +S.alpha.toFixed(3), alpha: +S.alpha.toFixed(3),
      deltaM: +(-S.w).toFixed(2), dist: +S.dS.toFixed(2), dHead: +S.dS.toFixed(2), W: +S.W.toFixed(2),
      dVis: +S.dVis.toFixed(2), dPass: +S.dPass.toFixed(2), dEnd: +S.dEnd.toFixed(2), solverOk: S.ok,
      yPassPx: pass.y, yVisPx: vis.y, yHeadPx: head.y, count: S.count, cueT: cueT < 1e6 ? +cueT.toFixed(3) : null,
      lastPass: S.lastPass > -1e8 ? +S.lastPass.toFixed(2) : null, pending: S.pendingAt >= 0, gap: S.gap, quality: S.q,
      chase: +S.chase.toFixed(3), closing: +S.closing.toFixed(3),
      vg: +path.v.toFixed(2), push: 0, pushed: false, fitOk: true, lat: +S.lat.toFixed(2), passK: +smoothstep(0, 3, -S.w).toFixed(3),
      kmhGait: 0, ghostDdot: 0, cadence: 0, stance: 0, slip: 0, slipMax: 0, slipMaxPct: 0, slipFrames: 0,
      screen: { x0: Math.min(head.x, tail.x), y0, x1: Math.max(head.x, tail.x), y1, frac: +((y1 - y0) / Hh).toFixed(4) },
      cost: cost(),
    };
  }

  return {
    root,
    bind,
    unbind,
    update,
    /** 'seek' | 'ghost': cabeza y buscador al instante, sin celebración durante 2 s. */
    event(type) { if (type === 'seek' || type === 'ghost') S.evt = true; },
    /** Solo laboratorio: oculta el efecto (A/B de coste con el mismo fotograma). */
    set debugHide(v) { S.hide = !!v; },
    get debugHide() { return S.hide; },
    get active() { return bound; },
    info,
    cost,
    dispose() {
      if (disposed) return;
      unbind();
      disposed = true;
      scene.remove(root);
      for (const o of [E, R]) { try { o.geo.dispose(); o.mat.dispose(); } catch { /* nada */ } }
    },
  };
}
