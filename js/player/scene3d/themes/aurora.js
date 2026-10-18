// BestRunning · escenario AURORA (SPEC §15.2-2, §15.1, §15.3, §16). Abstracto cinematográfico: cortinas de aurora
// boreal sobre una noche azul-negra y un río de partículas finas que viene hacia ti a tu velocidad real, sobre una
// llanura helada que se ve avanzar.
//
// Composición (sin máscaras, §15.3): la cámara es nivelada (verticales rectas) y el desplazamiento de lente coloca el
// horizonte y el punto de fuga en el hueco libre del HUD. Las cortinas se cuelgan en ÁNGULOS calculados a partir del
// HUD: su borde inferior queda SIEMPRE por encima del número (y, en horizontal, del rótulo inferior) y sus rayos se
// extinguen ANTES de la barra superior ⇒ detrás de las cifras y de la barra solo hay cielo oscuro y sereno.
//  · Vertical: aurora en la banda entre la barra superior y la etiqueta de zona; horizonte justo bajo el ritmo; el río
//    ocupa la ventana entre el número y el rótulo inferior.
//  · Horizontal: horizonte a la altura del borde superior de la columna derecha; el río nace en el punto de fuga, en el
//    hueco entre el número y la columna, baja por ese hueco y se abre hacia la franja libre de abajo; la aurora llena el
//    cielo libre de arriba a la derecha (y, más alta y tenue, la franja sobre el número).
// Color = acento (§15.1): el color pleno de la zona solo en el filo inferior de las cortinas y en el río; los rayos son
// índigo-grafito neutro con brillo acotado. Máximo 2 acentos (zona actual y, en los últimos 3 s, la siguiente).
//
// Estados: la zona fija el tono del acento y la "tensión" de las cortinas (calentamiento y calma: anchas, lentas;
// sprint: se tensan, más finas y rápidas, sin subir el brillo global) y la densidad del río; en recuperación respiran
// 4 s/4 s. Momentos sin destellos (§15.2): últimos 3 s → el filo de la aurora vira al color del tramo siguiente
// barriendo el cielo y la frontera de color del río se acerca; cambio → esa frontera (una línea fina) te alcanza en el
// segundo exacto; km → línea fría en el río con un rótulo de retransmisión "KM 3" que se acerca; mitad → línea "MITAD"
// igual y, al cruzarla, una cresta de luz recorre las cortinas una vez; drop → las cortinas se ahondan y el río se
// llena; test VAM → las cortinas suben un peldaño por escalón; final → todo se posa y la cámara se eleva despacio.
// Fantasma: hilo tenue paralelo con cabeza de luz y rótulo "MEJOR MARCA"; por delante de él, el río vira a oro.
// Duelo: con fantasma el río se parte en dos corrientes paralelas (la tuya del color de la zona, la suya blanco plata)
// que se juntan cuando vais igualados y se separan con la distancia real; quien va delante brilla algo más.
// Hora real (sky.js · createDaylight): noche con estrellas, hora azul, amanecer/atardecer con un resplandor cálido
// pegado al horizonte (y su reflejo en la escarcha), día graduado a noche azul. Siempre oscuro: los datos mandan.
// Música por instrumento: bombo → ondas concéntricas finas en la escarcha, confinadas al lecho del río · charles →
// brillo leve de una fracción de las motas · medios → amplitud lenta de las cortinas. Reducido: ondas lentas y raras.
// Sprint (vertical): las dos cortinas delanteras se cruzan en V hacia el punto de fuga y enmarcan el río.
// Coste: 5 draw calls (cielo, estrellas, suelo, cortinas, río) + rótulos ocasionales; sin asignaciones por fotograma.
import { createSky, createDaylight } from './aurora/sky.js';
import { createRibbons } from './aurora/ribbons.js';
import { createRiver } from './aurora/river.js';
import { createGround, RIPS } from './aurora/ground.js';
import { createTags } from './aurora/tags.js';
import { ENERGY, INDIGO, BODY, MEANDER_PERIOD, RIVER_LEN, riverX } from './aurora/common.js';

export const meta = {
  id: 'aurora',
  name: 'Aurora',
  description: 'Auroras sobre la noche y un río de luz que fluye a tu ritmo.',
};

const DEG = Math.PI / 180;
const CAM_H = 1.45;
const GATES = 3;
const NR = 4;
const RECOVERY = { walk: 1, cooldown: 1, warmup: 0.45, jog: 0.5 };

export function createTheme(ctx) {
  const { THREE, rig, post, timeline: tl, util, camera } = ctx;
  const { clamp, clamp01, smoothstep, lerp } = util;
  const C = (hex) => new THREE.Color(hex);

  camera.near = 0.3;
  camera.far = 4000;
  ctx.renderer.setClearColor(0x020308, 1);
  post.set({ toneMapping: 'aces', exposure: 0.92, bloomStrength: 0.36, bloomThreshold: 0.88, bloomRadius: 0.3, vignette: 0.28, saturation: 1.02 });

  /* ───────── Piezas ───────── */
  const gateV = [];
  const gateC = [];
  for (let i = 0; i < GATES; i++) { gateV.push(new THREE.Vector4(0, 0, 0, 0)); gateC.push(new THREE.Color()); }
  const shared = {
    uBend: { value: new THREE.Vector4(0, 4, 30, 2.2) },
    uSm: { value: 0 },
    uGate: { value: gateV },
    uGateCol: { value: gateC },
    uKm: { value: new THREE.Vector4(-100, 0, 0, 0) },
    uMark: { value: new THREE.Vector4(-100, 0, 0, 0) },
    uGhost: { value: new THREE.Vector4(1.9, -40, 0, 0) },
  };
  const sky = createSky(ctx);
  const ground = createGround(ctx, shared);
  const ribbons = createRibbons(ctx);
  const river = createRiver(ctx, shared);
  const tags = createTags(ctx);
  const daylight = createDaylight(THREE);

  // Rótulos de retransmisión (≥ 12 px CSS, en espacio libre)
  const kmTag = tags.create('KM', '1', '#cfdcff');
  const halfTag = tags.create('Mitad', '', '#ffffff');
  const ghostTag = tags.create('Mejor marca', '', '#a9dcff');
  ghostTag.gap = 24; // holgura amplia frente al chip «VS RÉCORD» y el ritmo: nunca pegado bajo la cifra
  // En duelo el rótulo solo presenta: ~4 s visibles al empezar y cuando el fantasma toma el mando (histéresis de ±2 m)
  const gTag = { on: false, lead: 0, t: 0 };
  const anchor = new THREE.Vector3();

  /* ───────── Paleta ───────── */
  const indigo = C(INDIGO);
  const bodyBase = C(BODY);
  const gold = C('#ffcf5a');
  const white = C('#ffffff');
  const low = new THREE.Color();
  const body = new THREE.Color();
  const next = new THREE.Color();
  const skyAcc = new THREE.Color();
  const glow = new THREE.Color();
  const amb = new THREE.Color();
  const ambBase = C('#1b2140');
  const riverCol = new THREE.Color();
  const tmpC = new THREE.Color();

  /**
   * Color de zona con luminancia equilibrada: el violeta de la calma o el rojo del sprint (L ≈ 0,25) no deben verse
   * apagados al lado del amarillo (L ≈ 0,7). Se acerca la luminancia a 0,36 sin tocar el tono.
   */
  function balanced(out, c) {
    const L = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    return out.copy(c).multiplyScalar(clamp(Math.pow(0.36 / Math.max(0.05, L), 0.6), 0.72, 1.3));
  }

  /* ───────── Composición ───────── */
  const base = [];
  for (let i = 0; i < NR; i++) base.push({ az: 0, span: 1.5, dist: 300, recede: 0, elev: 16 * DEG, top: 24 * DEG, alpha: 1, fold: 1 });
  const comp = {
    fov: 60, fy: 0.47, vpX: 0.5, shiftY: 0, elTop: 29 * DEG, ceil: 22 * DEG, tierStep: 3 * DEG,
    riverW: 0.7, ghostX: 1.25, bandEl: 20 * DEG, bandW: 3 * DEG, lineAz0: -10, lineAz1: -9, nearFade: 8,
  };
  // Vertical: cuatro capas a lo ancho, cada vez más lejanas, algo más altas y tenues
  const P_CFG = {
    az: [0, 0.14, -0.12, 0.05], span: [1.55, 1.4, 1.45, 1.75], dist: [300, 380, 470, 580], recede: [0, 0.15, -0.15, 0.05],
    lift: [0, 0.7, 1.3, 1.9], alpha: [1, 0.72, 0.52, 0.36], minEl: [0, 0, 0, 0], fold: [1, 1, 1, 1],
  };
  // Horizontal: una cortina baja y luminosa sobre la columna derecha, un arco más alto que cruza el cielo libre, otra
  // capa alta y tenue sobre el número y una lejana a la derecha
  const L_CFG = {
    az: [0.38, 0.2, -0.36, 0.56], span: [0.78, 1.05, 0.62, 0.46], dist: [300, 380, 470, 580], recede: [0.25, 0.12, -0.1, 0.1],
    lift: [0, 1.2, 0.6, 2.4], alpha: [1, 0.62, 0.42, 0.4], minEl: [0.8, 3, 0, 1.5], fold: [1, 0.45, 0.35, 0.7],
  };
  let portrait = true;
  let hudVersion = -1;
  const rectOf = (kind) => { for (const r of ctx.hud.rects) if (r.kind === kind) return r; return null; };

  /**
   * Elevación mínima del borde inferior (rad) para que, con cualquier pliegue, pase por encima de las restricciones
   * que caen dentro de su arco (con un margen por los extremos, que se desvanecen).
   */
  function elevFor(az, span, rec, cons, minEl) {
    let t = Math.tan(minEl);
    const a0 = az - span * 0.5 - 0.04;
    const a1 = az + span * 0.5 + 0.04;
    for (const c of cons) {
      if (c.a < a0 || c.a > a1) continue;
      const r = 1 + rec * ((c.a - az) / span);
      t = Math.max(t, Math.tan(c.el) * Math.max(0.3, r) / Math.max(0.3, Math.cos(c.a)));
    }
    return Math.atan(t);
  }

  function frameCamera() {
    const T = rig.target;
    const W = Math.max(1, ctx.hud.width);
    const H = Math.max(1, ctx.hud.height);
    const aspect = W / H;
    const sp = rectOf('speed');
    const seg = rectOf('segment');
    const top = rectOf('top');
    const cons = [];
    let cfg;
    if (portrait) {
      cfg = P_CFG;
      comp.fov = 60;
      comp.fy = sp ? clamp((sp.y + sp.h) / H + 0.03, 0.36, 0.62) : 0.476;
      comp.vpX = 0.5;
      comp.riverW = 0.62;
      comp.ghostX = 1.15;
      shared.uBend.value.set(0, 4, 30, 2.0);
    } else {
      cfg = L_CFG;
      comp.fov = 42;
      // horizonte a la altura del borde superior de la columna derecha; punto de fuga en el hueco número | columna
      comp.fy = seg ? clamp((seg.y - 4) / H, 0.3, 0.62) : 0.45;
      comp.vpX = sp && seg ? clamp((sp.x + sp.w + seg.x) / 2 / W, 0.4, 0.62) : 0.507;
      comp.riverW = 0.42;
      comp.ghostX = 0.9;
      // cerca de la cámara el río gira hacia la franja libre de abajo a la izquierda (bajo el número)
      shared.uBend.value.set(-1.15, 2, 9.5, 1.0);
    }
    const tanV = Math.tan((comp.fov / 2) * DEG);
    const tanH = tanV * aspect;
    const elAt = (yf) => Math.atan(2 * (comp.fy - yf) * tanV);
    const azAt = (xf) => Math.atan(2 * (xf - comp.vpX) * tanH);
    comp.elTop = elAt(0);
    // techo: los rayos se extinguen antes de la barra superior (la placa nunca queda sobre color)
    // (la punta de los rayos, ya casi apagada, puede asomar tras el tercio inferior de la barra: nunca su parte brillante)
    comp.ceil = top ? elAt((portrait ? top.y + top.h * 0.3 : top.y + top.h + 14) / H) : elAt(0.1);
    if (sp) {
      const e = elAt((sp.y - 14) / H);
      for (let k = 0; k <= 4; k++) cons.push({ a: azAt((sp.x + (sp.w * k) / 4) / W), el: e });
    } else cons.push({ a: 0, el: elAt(0.24) });
    if (!portrait && seg) {
      const e = elAt((seg.y - 16) / H);
      for (let k = 0; k <= 4; k++) cons.push({ a: azAt((seg.x + ((W - seg.x) * k) / 4) / W), el: e });
    }
    comp.shiftY = 1 - 2 * comp.fy;
    comp.cons = cons;
    comp.minEl0 = cfg.minEl[0] * DEG;
    comp.minEl1 = cfg.minEl[1] * DEG;
    T.position.set(0, CAM_H, 0);
    T.lookAt.set(0, CAM_H, -100);
    T.fov = comp.fov;
    T.shift.set(2 * comp.vpX - 1, comp.shiftY);
    for (let i = 0; i < NR; i++) {
      const b = base[i];
      b.az = cfg.az[i];
      b.span = cfg.span[i];
      b.dist = cfg.dist[i];
      b.recede = cfg.recede[i];
      b.elev = Math.min(comp.ceil - (i ? 4 : 3) * DEG, elevFor(b.az, b.span, b.recede, cons, cfg.minEl[i] * DEG) + cfg.lift[i] * DEG);
      b.top = comp.ceil;
      b.alpha = cfg.alpha[i];
      b.fold = cfg.fold[i];
    }
    // banda libre de la aurora (airglow y peldaños del test)
    const lowest = Math.min(base[0].elev, base[1].elev);
    comp.bandEl = (lowest + comp.ceil) / 2;
    comp.bandW = Math.max(2 * DEG, (comp.ceil - lowest) / 2);
    // peldaños del test: tres escalones visibles entre el filo base y el techo (con margen para el pliegue residual)
    comp.tierStep = clamp((comp.ceil - base[0].elev - 2 * DEG) / 3, 1.2 * DEG, 3.6 * DEG);
    // filete del horizonte: en horizontal no cruza por detrás del número (empieza en su borde derecho)
    if (!portrait && sp) { comp.lineAz0 = azAt((sp.x + sp.w - 20) / W); comp.lineAz1 = azAt((sp.x + sp.w + 40) / W); } else { comp.lineAz0 = -10; comp.lineAz1 = -9; }
    // motas cercanas: se apagan antes de saltar demasiados píxeles por fotograma (más lejos en vertical, donde la
    // ventana entre el número y el rótulo inferior está más cerca de la cámara)
    comp.nearFade = portrait ? 10 : 9;
  }
  frameCamera();

  /* ───────── Estado ───────── */
  const R = ctx.rng(90210);
  const jitter = [];    // recolocación por tramo (objetivo y valor suavizado)
  const phase = new Float64Array(NR);
  const rayPhase = new Float64Array(NR);
  for (let i = 0; i < NR; i++) {
    jitter.push({ az: 0, el: 0, ph: 0, tAz: 0, tEl: 0, tPh: 0 });
    phase[i] = R() * 6.283;
    rayPhase[i] = R() * 50;
  }
  const st = {
    energy: 0.3, tension: 0.1, recov: 0.5, drift: 1, drop: 0, wave: -1, tierMix: 0, tierPhase: 0, testEnded: false,
    ghostD: -40, ghostA: 0, snap: true, lastSeg: -1,
  };
  let kmShown = -1;
  let inFinale = false;
  // Música por instrumento: bombo (transitorios de graves) → ondas en la escarcha · charles (agudos) → brillo leve del
  // río · medios → amplitud lenta de las cortinas. Detectores con seguidor lento + refractario (sin asignaciones).
  const kick = { slow: 0, prev: 0, cool: 0, hSlow: 0, hPrev: 0, hCool: 0, hat: 0, hatSeed: 0, mid: 0.3, next: 0 };
  const rips = [];
  for (let i = 0; i < RIPS; i++) rips.push({ age: 99, life: 2.2, x: 0, d0: 0, s0: 0, amp: 0, grow: 5 });
  const duel = { mix: 0, gap: 0 };
  let corridor = 0;
  const rib = { az: 0, span: 0, dist: 0, recede: 0, elev: 0, heightK: 1, top: 0, foldAmp: 0, foldFreq: 0, phase: 0, rayPhase: 0, alpha: 0, tension: 0 };

  function retarget(segIndex) {
    const r = ctx.rng(1000 + segIndex * 7);
    for (let i = 0; i < NR; i++) {
      const j = jitter[i];
      j.tAz = (r() - 0.5) * 0.08;
      j.tEl = r() * 0.8 * DEG;
      j.tPh = (r() - 0.5) * 2.4;
    }
  }
  retarget(0);

  /* ───────── Fotograma ───────── */
  let snapNow = false;
  let dtNow = 0;
  /** Factor de suavizado exponencial del fotograma (1 = salto inmediato tras un corte). */
  const k = (lambda) => (snapNow ? 1 : 1 - Math.exp(-lambda * dtNow));
  const skyLook = { vpAz: 0, vpK: 1, bandEl: 0, bandW: 3 * DEG, bandK: 0, stars: 1, glow, lineAz0: -10, lineAz1: -9, daylight: null, sunK: 0, sunAz: 0 };

  /** Detectores por instrumento (bombo, charles, medios) a partir del espectro del núcleo. */
  function listen(f, sp, dt, reduced) {
    const live = !!sp.live;
    const b = sp.bass;
    const rise = b - kick.prev;
    kick.prev = b;
    kick.slow += (b - kick.slow) * (1 - Math.exp(-dt * 2.2));
    kick.cool -= dt;
    // sin música real (simulación del beat) o con movimiento reducido: ondas mucho más espaciadas y calmadas
    const refr = reduced ? 1.6 : live ? 0.55 : 1.25;
    const running = f.status === 'running' && !inFinale;
    if (running && kick.cool <= 0 && b > 0.32 && b > kick.slow + 0.1 && rise > 0.03) {
      kick.cool = refr;
      const r = rips[kick.next];
      kick.next = (kick.next + 1) % RIPS;
      const d0 = portrait ? 24 : 18;
      r.age = 0;
      r.life = reduced ? 2.6 : 2.2;
      r.grow = reduced ? 2.4 : 5.2;
      r.d0 = d0;
      r.s0 = f.S * (reduced ? 0.5 : 1);
      r.x = riverX(d0, shared.uBend.value, shared.uSm.value);
      r.amp = (reduced ? 0.5 : 1) * clamp(0.55 + (b - kick.slow) * 2.5, 0.55, 1);
    }
    for (let i = 0; i < RIPS; i++) if (rips[i].age < rips[i].life) rips[i].age += dt;
    // charles: transitorio de agudos ⇒ envolvente corta (≈ 70 ms) y otra selección de motas en cada golpe
    const h = sp.high;
    const hr = h - kick.hPrev;
    kick.hPrev = h;
    kick.hSlow += (h - kick.hSlow) * (1 - Math.exp(-dt * 4));
    kick.hCool -= dt;
    if (live && running && kick.hCool <= 0 && h > kick.hSlow + 0.05 && hr > 0.02) {
      kick.hCool = 0.09;
      kick.hat = Math.min(1, 0.45 + (h - kick.hSlow) * 4);
      kick.hatSeed = (kick.hatSeed + 0.618034) % 1;
    }
    kick.hat *= Math.exp(-dt * 14);
    // medios: amplitud lenta de las cortinas (≈ 1,5 s)
    kick.mid += (sp.mid - kick.mid) * (1 - Math.exp(-dt * 0.7));
  }

  /**
   * Pasillo de sprint: la cortina 0 se cuelga a la izquierda y la 1 a la derecha del punto de fuga, con su extremo
   * exterior más cerca (pared que se curva hacia ti) ⇒ enmarcan el río sin bajar nunca por delante del número ni subir
   * por encima del techo (la elevación se recalcula con las restricciones del HUD en cada fotograma).
   */
  function corridorWall(i, p, c, ceil) {
    const side = i === 0 ? -1 : 1;
    const span = portrait ? 0.5 : 0.66;
    const R = -side * (portrait ? 0.28 : 0.4);
    // vertical: las dos paredes se cruzan en el centro (V que converge en el punto de fuga) · horizontal: a cada lado
    p.az = lerp(p.az, side * (portrait ? 0.12 : 0.34), c);
    p.span = lerp(p.span, span, c);
    p.recede = lerp(p.recede, R, c);
    // las dos paredes llevan el filo pleno de la zona (la 1 es, en reposo, una capa de fondo más tenue)
    p.alpha = lerp(p.alpha, 1, c);
    const minEl = elevFor(p.az, p.span, p.recede, comp.cons || [], i === 0 ? comp.minEl0 || 0 : comp.minEl1 || 0) + 0.5 * DEG;
    p.elev = Math.max(lerp(p.elev, minEl, c), minEl);
    // techo: el extremo cercano subiría en ángulo ⇒ se rebaja lo justo para que siga bajo la barra superior
    p.top = Math.min(p.top, Math.atan(Math.tan(ceil) * (1 - Math.abs(p.recede) * 0.5)));
    if (p.top < p.elev + 2 * DEG) p.alpha *= clamp01((p.top - p.elev) / (2 * DEG));
  }

  function update(f) {
    const dt = f.dt;
    const reduced = f.reducedMotion;
    const sp = f.spectrum;
    if (ctx.hud.version !== hudVersion && !inFinale) { hudVersion = ctx.hud.version; frameCamera(); }
    if (f.segIndex !== st.lastSeg) { st.lastSeg = f.segIndex; retarget(f.segIndex); }
    snapNow = st.snap;
    st.snap = false;
    dtNow = dt;
    const intro = smoothstep(0, 1, f.intro);
    const fin = f.finale > 0 ? util.easeInOutSine(f.finale) : 0;

    // Energía de la zona (≈1 s de transición) y respiración en recuperación
    let eT = ENERGY[f.zone] ?? 0.35;
    if (f.isTest && f.stage > 0) eT = Math.min(1, eT + f.stage * 0.012);
    if (f.status === 'finished') eT = 0.06;
    st.energy += (eT - st.energy) * k(1.6);
    const tension = Math.pow(clamp01((st.energy - 0.3) / 0.7), 1.3);
    st.tension = tension;
    const prevRank = f.prevZone ? ctx.zoneRank[f.prevZone] ?? 2 : 0;
    let rT = RECOVERY[f.zone] ?? 0;
    if (f.zone === 'jog' && prevRank >= 3) rT = 1;
    if (f.status === 'finished') rT = 0.6;
    st.recov += (rT - st.recov) * k(0.8);
    const br = (f.breath - 0.5) * 2 * st.recov * (reduced ? 0.6 : 1); // −1..1 (4 s inspirar, 4 s espirar)
    st.drift += ((f.paused ? 0.18 : f.status === 'finished' ? 0.3 : 1) - st.drift) * k(1.5);
    const driftK = st.drift * (reduced ? 0.3 : 1);
    st.drop = Math.max(0, st.drop - dt / 4);
    const drop = st.drop * st.drop;
    try { listen(f, sp, dt, reduced); } catch { /* la escena sigue sin reactividad fina */ }

    // Test VAM: las cortinas suben un peldaño por escalón
    const tierOn = f.isTest && f.stage > 0 && !st.testEnded && f.status !== 'finished';
    st.tierMix += ((tierOn ? 1 : 0) - st.tierMix) * k(tierOn ? 1.4 : 0.5);
    if (tierOn) st.tierPhase += (f.stage - st.tierPhase) * k(reduced ? 1.6 : 3.2);

    // Mitad: una cresta de luz recorre las cortinas una vez (3,5 s)
    let waveAmp = 0;
    let waveU = -1;
    if (st.wave >= 0) {
      st.wave += dt;
      const p = st.wave / 3.5;
      if (p >= 1) st.wave = -1;
      else { waveAmp = Math.sin(Math.PI * p) * (reduced ? 0.2 : 0.35); waveU = -0.2 + 1.4 * p; }
    }

    /* Cortinas */
    const foldSpeed = lerp(0.07, 0.4, st.energy) * driftK;
    const raySpeed = lerp(0.1, 0.5, st.energy) * driftK;
    const ampK = 1 + 0.3 * drop + 0.22 * kick.mid * (reduced ? 0 : 1);
    // pasillo de sprint (vertical): las dos cortinas delanteras se cruzan en V hacia el punto de fuga, con el extremo
    // exterior más cerca de ti, y enmarcan el río. En horizontal la banda libre sobre el número es demasiado estrecha
    // para inclinar las paredes sin apagar el filo ⇒ se queda la composición base (más fuerte).
    corridor += ((portrait && f.zone === 'sprint' && f.status !== 'finished' && !inFinale ? 1 : 0) * (1 - st.tierMix) - corridor) * k(reduced ? 0.7 : 1.1);
    // el techo del final se abre con la cámara (el HUD de resumen ya no usa la barra superior)
    const ceilFin = lerp(comp.ceil, comp.elTop + 4 * DEG, fin);
    for (let i = 0; i < NR; i++) {
      const j = jitter[i];
      const kj = k(reduced ? 1.8 : 3.4);
      j.az += (j.tAz - j.az) * kj;
      j.el += (j.tEl - j.el) * kj;
      j.ph += (j.tPh - j.ph) * kj;
      phase[i] += dt * foldSpeed * (1 + 0.17 * i);
      rayPhase[i] += dt * raySpeed * (1 + 0.11 * i);
      const b = base[i];
      // reposo: cortinas anchas y altas; sprint: más juntas, más cortas y con pliegues más cerrados
      const gap = b.elev - base[0].elev;
      rib.az = b.az + j.az;
      rib.span = b.span;
      rib.dist = b.dist;
      rib.recede = b.recede;
      rib.elev = b.elev - gap * 0.3 * tension + j.el;
      rib.top = ceilFin;
      // altura útil hasta el techo; la respiración y la tensión solo la ACORTAN (nunca invade la barra superior)
      rib.heightK = lerp(1, 0.8, tension) * (1 - 0.08 * (1 - br));
      // en vertical la banda libre es estrecha: pliegues menos profundos y más frecuentes (mismo brillo de canto)
      rib.foldAmp = (portrait ? lerp(0.07, 0.05, tension) : lerp(0.18, 0.1, tension)) * ampK * b.fold;
      rib.foldFreq = (portrait ? lerp(1.6, 2.3, tension) : lerp(1.05, 2.0, tension));
      rib.alpha = b.alpha;
      // Peldaños del test VAM: las cuatro cortinas se apilan en la banda libre (entre el número y el techo) y cada
      // escalón suben UN peldaño; la de arriba se desvanece y entra otra por abajo ⇒ subida continua sin límite.
      if (st.tierMix > 0.001) {
        const slot = (((i + st.tierPhase) % NR) + NR) % NR;
        // el peldaño nuevo se enciende en la base (nunca por debajo: el número sigue limpio) y desde ahí sube
        const ta = smoothstep(0, 0.7, slot) * (1 - smoothstep(NR - 1.6, NR - 0.5, slot));
        const tm = st.tierMix;
        rib.az = lerp(rib.az, base[0].az, tm);
        rib.span = lerp(rib.span, base[0].span, tm);
        rib.dist = lerp(rib.dist, 380, tm);
        rib.recede = lerp(rib.recede, base[0].recede, tm);
        rib.elev = lerp(rib.elev, base[0].elev + Math.max(0, slot - 0.7) * comp.tierStep, tm);
        rib.heightK = lerp(rib.heightK, Math.min(1, (comp.tierStep * 1.6) / Math.max(1.2 * DEG, ceilFin - rib.elev)), tm);
        // escalones limpios y nivelados (casi sin pliegue: un pliegue lento se leería como una cortina inclinada)
        rib.foldAmp = lerp(rib.foldAmp, 0.018, tm);
        rib.foldFreq = lerp(rib.foldFreq, 2.2, tm);
        rib.alpha = lerp(rib.alpha, (0.75 + 0.25 * Math.min(1, f.stage / 14)) * ta, tm);
      }
      rib.alpha *= intro;
      rib.phase = phase[i] + j.ph;
      rib.rayPhase = rayPhase[i];
      rib.tension = clamp01(tension + 0.25 * st.tierMix);
      if (i < 2 && corridor > 0.002) {
        try { corridorWall(i, rib, corridor * (reduced ? 0.35 : 0.6), ceilFin); } catch { corridor = 0; }
      }
      ribbons.set(i, rib);
    }
    const ru = ribbons.u;
    balanced(low, ctx.zoneColor(f.zone)).lerp(gold, f.record.amount * 0.3);
    if (f.nextZone) balanced(next, ctx.zoneColor(f.nextZone)); else next.copy(low);
    ru.uLow.value.copy(low);
    ru.uNext.value.copy(next);
    // cuerpo de los rayos: índigo-grafito neutro, apenas un 10 % del acento (paleta coherente en todas las zonas)
    body.copy(bodyBase).lerp(f.accent, 0.1).lerp(gold, f.record.amount * 0.15);
    ru.uBody.value.copy(body);
    // últimos 3 s: el filo de las cortinas vira al color del tramo siguiente barriendo el cielo (se queda en pausa)
    ru.uNextFront.value = f.nextZone && f.status !== 'finished' ? f.approach * 1.3 : 0;
    ru.uGain.value = 0.34 * (0.92 + 0.16 * st.energy) * (1 + 0.1 * br) * (1 + 0.12 * drop) * (1 + 0.06 * sp.bass * (reduced ? 0 : 1))
      * (1 + 0.05 * f.approach) * (1 - 0.12 * (1 - st.drift)) * (1 + 0.1 * fin);
    ru.uCap.value = 0.85;
    ru.uSpecK.value = reduced ? 0 : 1;
    ru.uWave.value = waveAmp;
    ru.uWaveU.value = waveU;

    /* Cielo */
    skyAcc.copy(f.accent).lerp(gold, f.record.amount * 0.3);
    glow.copy(indigo).lerp(skyAcc, 0.25);
    skyLook.vpK = (0.8 + 0.3 * st.energy) * intro;
    skyLook.bandEl = comp.bandEl;
    skyLook.bandW = comp.bandW;
    skyLook.bandK = (0.004 + 0.002 * st.energy) * (1 + 0.15 * br) * intro;
    skyLook.stars = (0.9 + 0.5 * fin) * (1 - 0.25 * tension);
    skyLook.lineAz0 = comp.lineAz0;
    skyLook.lineAz1 = comp.lineAz1;
    skyLook.daylight = daylight.update(f.time);
    skyLook.sunK = 0.08 * intro;
    skyLook.sunAz = portrait ? skyLook.daylight.sunSide * 0.32 : 0.45;
    sky.update(f, skyAcc, skyLook);

    /* Río */
    const flowK = reduced ? 0.5 : 1;
    const S = f.S * flowK;
    const L = RIVER_LEN;
    const rv = river.u;
    rv.uS.value = ((S % L) + L) % L;
    shared.uSm.value = ((S % MEANDER_PERIOD) + MEANDER_PERIOD) % MEANDER_PERIOD;
    rv.uVel.value = f.visualSpeed * flowK;
    // obturador de 180° (medio fotograma): desenfoque de movimiento real, normalizado en energía y acotado
    rv.uShutter.value = reduced ? 0 : f.quality === 'eco' ? 1 / 60 : 1 / 120;
    rv.uViewport.value.set(f.width * f.dpr, f.height * f.dpr);
    rv.uMaxLen.value = 1.6 * f.dpr;
    rv.uNearFade.value = comp.nearFade;
    rv.uWidth.value = comp.riverW * lerp(1, 0.82, tension);
    river.setDensity(0.55 + 0.45 * st.energy + 0.3 * drop + 0.06 * sp.high, dt, snapNow);
    rv.uGain.value = (0.8 + 0.25 * st.energy) * (1 + 0.1 * br) * intro * (1 - 0.15 * fin);
    rv.uTwinkle.value = reduced ? 0 : 0.03 + 0.05 * sp.high;
    rv.uTime.value = f.time;
    rv.uRecord.value = f.record.amount * 0.6;
    rv.uFade.value = 1;
    balanced(riverCol, ctx.zoneColor(f.zone)).lerp(white, 0.12);
    rv.uCol.value.copy(riverCol);
    rv.uHat.value.set(reduced ? 0 : kick.hat, kick.hatSeed);
    // Duelo con el fantasma: dos corrientes que se juntan (vais igualados) o se separan con la distancia real
    duel.mix += ((f.ghost.active && !f.finale && f.status !== 'finished' ? 1 : 0) - duel.mix) * k(1.2);
    duel.gap += ((f.ghost.active && Number.isFinite(f.ghost.deltaM) ? f.ghost.deltaM : 0) - duel.gap) * k(1.5);
    const youAhead = smoothstep(-10, 10, duel.gap);
    const sep = comp.riverW * lerp(0.4, 2.2, smoothstep(1, 50, Math.abs(duel.gap)));
    rv.uDuel.value.set(duel.mix, sep, lerp(0.9, 0.5, youAhead), lerp(0.95, 1.12, youAhead));
    const ghostLat = lerp(comp.ghostX, sep * 0.5, duel.mix);

    // Fronteras de color de los próximos tramos (y la recién cruzada mientras se aleja)
    let g = 0;
    for (let i = Math.max(1, f.segIndex); i < tl.segCount && g < GATES; i++) {
      const Tg = tl.segStart(i);
      const dtg = Tg - f.t;
      if (dtg < -1.5) continue;
      const d = (tl.visualDistanceAt(Tg) - f.S) * flowK;
      if (d > L + 10) break;
      const nearA = smoothstep(L + 10, L - 50, d);
      const cross = dtg < 0 ? clamp01(1 + dtg / 1.5) : 1;
      gateV[g].set(d, nearA * cross * (0.7 + 0.3 * f.approach), 0, 0);
      balanced(tmpC, ctx.zoneColor(tl.segZone(i))).lerp(white, 0.12);
      gateC[g].copy(tmpC).lerp(gold, rv.uRecord.value);
      g++;
    }
    for (; g < GATES; g++) gateV[g].set(-1000, 0, 0, 0);

    const live = f.status !== 'finished' && !inFinale;
    // Kilómetro: línea fría en el río y rótulo "KM n" que se acerca con ella
    const km = f.kmNext;
    const Tkm = tl.timeForKm(km);
    let dKm = -1000;
    if (Number.isFinite(Tkm) && live) dKm = (tl.visualDistanceAt(Tkm) - f.S) * flowK;
    const kmI = dKm > -3 && dKm < L ? smoothstep(L, L - 70, dKm) * (dKm < 0 ? clamp01(1 + dKm / 3) : 1) : 0;
    shared.uKm.value.set(dKm, kmI * 0.8, 0, 0);
    if (km !== kmShown) { tags.set(kmTag, 'KM', String(km)); kmShown = km; }
    let want = 0;
    if (dKm > 10 && dKm < 150) {
      want = (1 - smoothstep(125, 150, dKm)) * smoothstep(10, 16, dKm) * intro;
      anchor.set(riverX(dKm, shared.uBend.value, shared.uSm.value) + comp.riverW * 1.4, 0, -dKm);
    }
    tags.place(kmTag, anchor, want, k(6), f);

    // Mitad: línea "MITAD" en el río (se cruza en el segundo exacto de la mitad de la clase) y su rótulo
    let dHalf = -1000;
    if (!f.isTest && live && tl.totalSec > 120) dHalf = (tl.visualDistanceAt(tl.totalSec / 2) - f.S) * flowK;
    const hI = dHalf > -3 && dHalf < L ? smoothstep(L, L - 70, dHalf) * (dHalf < 0 ? clamp01(1 + dHalf / 3) : 1) : 0;
    shared.uMark.value.set(dHalf, hI * 0.9, 0, 0);
    want = 0;
    if (dHalf > 10 && dHalf < 150) {
      want = (1 - smoothstep(125, 150, dHalf)) * smoothstep(10, 16, dHalf) * intro;
      anchor.set(riverX(dHalf, shared.uBend.value, shared.uSm.value) + comp.riverW * 1.4, 0, -dHalf);
    }
    tags.place(halfTag, anchor, want, k(6), f);

    // Fantasma: hilo paralelo; cabeza de luz donde va tu mejor marca si te saca ventaja
    const G = f.ghost;
    const ahead = G.active && G.deltaM < -0.5;
    const dT = ahead ? 6 + 105 * (1 - Math.exp(G.deltaM / 45)) : -30;
    st.ghostD += (dT - st.ghostD) * k(1.6);
    // con las luces de tu récord (ctx.ghostLights) se funden el brillo del hilo y su rótulo; uGhost.x (carril) sigue
    st.ghostA += ((G.active && !f.finale && !ctx.ghostLights ? 1 : 0) - st.ghostA) * k(1.5);
    shared.uGhost.value.set(ghostLat, st.ghostD * flowK, st.ghostA, 0);
    want = 0;
    if (st.ghostA > 0.05 && st.ghostD > 9 && st.ghostD < 125) {
      const gd = st.ghostD * flowK;
      want = st.ghostA * smoothstep(9, 14, st.ghostD);
      anchor.set(riverX(gd, shared.uBend.value, shared.uSm.value) + ghostLat + 0.15, 0.14, -gd);
    }
    // Pasada la presentación lo cuentan la corriente plateada y el chip del HUD: nunca dos rótulos del mismo dato
    let tagK = 0;
    try {
      if (G.active && !gTag.on) { gTag.t = 0; gTag.lead = 0; }
      gTag.on = !!G.active;
      if (G.active && Number.isFinite(G.deltaM)) {
        const ld = G.deltaM > 2 ? 1 : G.deltaM < -2 ? -1 : gTag.lead;
        if (ld !== gTag.lead) { if (ld < 0) gTag.t = 0; gTag.lead = ld; }
      }
      if (want > 0.05) gTag.t += Math.max(0, Math.min(0.1, dt || 0));
      tagK = 1 - smoothstep(3.4, 4.4, gTag.t);
    } catch { tagK = 0; }
    tags.place(ghostTag, anchor, want * tagK, k(5), f);

    /* Suelo */
    const gu = ground.u;
    gu.uRiverCol.value.copy(riverCol);
    gu.uGlow.value = (0.05 + 0.03 * st.energy) * (1 + 0.12 * br) * intro;
    gu.uWidth.value = rv.uWidth.value;
    gu.uRecord.value = rv.uRecord.value;
    gu.uHorizon.value.copy(sky.u.uHorizon.value);
    gu.uAccent.value.copy(skyAcc);
    gu.uVpK.value = sky.u.uVpK.value;
    gu.uSg.value = shared.uSm.value;
    amb.copy(ambBase).lerp(skyAcc, 0.12);
    gu.uAmb.value.copy(amb);
    gu.uRelief.value = (0.32 + 0.08 * st.energy) * intro;
    gu.uSun.value.copy(sky.u.uSun.value);
    gu.uSunAz.value = sky.u.uSunAz.value;
    for (let i = 0; i < RIPS; i++) {
      const r = rips[i];
      const v = gu.uRip.value[i];
      if (r.age >= r.life) { v.w = 0; continue; }
      const p = r.age / r.life;
      v.set(r.x, r.d0 - (f.S * flowK - r.s0), 0.6 + r.grow * r.age, r.amp * Math.pow(1 - p, 1.6) * smoothstep(0, 0.1, r.age) * intro);
    }

    /* Cámara: final = se posa todo y la cámara se eleva despacio hacia la aurora */
    if (fin > 0) {
      inFinale = true;
      const T = rig.target;
      rig.settle.position = 2.8;
      rig.settle.lookAt = 2.8;
      rig.settle.shift = 2.8;
      const up = reduced ? 0 : 1.6 * fin;
      T.position.set(0, CAM_H + up, 0);
      T.lookAt.set(0, CAM_H + up, -100);
      T.shift.y = comp.shiftY - (portrait ? 0.3 : 0.22) * fin;
    } else if (inFinale) {
      inFinale = false;
      rig.settle.position = 1.1;
      rig.settle.lookAt = 1.1;
      rig.settle.shift = 1.2;
      frameCamera();
    }
  }

  return {
    resize({ aspect }) {
      const p = aspect < 0.9;
      hudVersion = ctx.hud.version;
      if (p !== portrait) { portrait = p; frameCamera(); rig.snap(); } else frameCamera();
    },

    update,

    event(type, data) {
      switch (type) {
        case 'gate': post.pulse(0.03, 1.4); break;
        case 'seek': st.snap = true; st.ghostD = -30; st.wave = -1; for (const r of rips) r.age = 99; break;
        case 'halfway': st.wave = 0; post.pulse(0.035, 2); break;
        case 'drop': st.drop = 1; post.pulse(0.04, 1.8); break;
        case 'km': post.pulse(0.02, 1.2); break;
        case 'record': if (data?.on) post.pulse(0.035, 1.6); break;
        case 'testStage': post.pulse(0.025, 1.2); break;
        case 'testEnd': st.testEnded = true; post.pulse(-0.04, 2.5); break;
        case 'finish': post.pulse(0.04, 2.5); break;
        case 'quality': {
          const lv = data?.level ?? ctx.qualityLevel;
          river.setQuality(lv);
          ribbons.setQuality(lv);
          break;
        }
        case 'start': st.testEnded = false; break;
        default: break;
      }
      if (type === 'seek' && data && data.to < data.from) st.testEnded = false;
    },

    dispose() {
      tags.dispose();
    },
  };
}
