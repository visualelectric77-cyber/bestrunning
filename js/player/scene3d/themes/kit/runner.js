// RITMUP · kit de los escenarios REALISTAS (costa, desierto, neón, túnel, bosque, navidad) · el CORREDOR.
// Lo que comparten todos: corres en línea recta hacia −z por un mundo que avanza hacia ti a tu velocidad REAL (km/h ÷ 3,6
// m/s, con la misma rampa de la cinta), una cámara a la altura de los ojos compuesta para el HUD (sin máscaras: el
// horizonte justo bajo el número en vertical; bajo y con el punto de fuga en el hueco número | columna en horizontal),
// el ambiente por zona (altura, óptica, exposición), el ENCENDIDO EN CADENA de las luces con el color del tramo nuevo
// (las de delante bajan en los últimos segundos y, al cruzar el cambio, se encienden hacia delante una sola vez) y el
// plano final (grúa lenta hacia arriba). Cada escenario pone su mundo y llama a runner.update(f) al principio de su
// update; luego lee runner.S (m recorridos), runner.fe (avance del final), etc.
// Marco del corredor: tú estás en el origen; srel = −z = metros por delante. Las luces leen el color con waveColor(srel)
// (GLSL de WAVE_GLSL) desde los uniformes de runner.u, compartidos por todos los materiales.

const DEG = Math.PI / 180;
const DTT = 0.25;          // resolución de la tabla de distancia real (s)
const VIS10 = Math.pow(10, 0.85) / 1.35;
/** Inversa exacta de visualSpeed() del núcleo: u/s visuales → km/h reales (conserva la forma de las rampas). */
export const kmhOfVis = (v) => (v > 0 ? Math.pow(v * VIS10, 1 / 1.85) : 0);

const MOOD_KEYS = ['dh', 'fov', 'exp'];
const MOODS = {
  warmup: { dh: 0.02, fov: 0, exp: 1 },
  walk: { dh: 0.03, fov: -1, exp: 1 },
  jog: { dh: 0, fov: 0, exp: 1 },
  run: { dh: -0.01, fov: 0.5, exp: 1.01 },
  fast: { dh: -0.03, fov: 1, exp: 1.02 },
  sprint: { dh: -0.05, fov: 2, exp: 1.03 },
  cooldown: { dh: 0.04, fov: -1, exp: 0.98 },
};

/** GLSL: color y brillo de una luz a srel m por delante (apagado previo al cambio y encendido en cadena hacia delante). */
export const WAVE_GLSL = /* glsl */ `
uniform vec4 uWave;    // x frente de la cadena (srel), y brillo sin encender, z brillo global, w cadena activa
uniform vec4 uWave2;   // x apagado previo al cambio (0..1), y tiempo, z -, w -
uniform vec3 uColOld, uColNew;
vec3 waveColor(float srel, out float br) {
  float on = 1.0;
  float ign = 0.0;
  if (uWave.w > 0.5) {
    on = 1.0 - smoothstep(uWave.x - 3.0, uWave.x + 3.0, srel);
    ign = exp(-pow((srel - uWave.x) / 8.0, 2.0)) * 0.3;
  }
  float pre = 1.0 - uWave2.x * smoothstep(-2.0, 10.0, srel);
  br = uWave.z * (mix(uWave.y, pre, on) + ign);
  return mix(uColOld, uColNew, on);
}
`;

/**
 * @param {object} ctx  contexto del escenario
 * @param {object} [o]
 *   camH (m), fovP / fovL (°, vertical), horizonP (fracción bajo el número), moods, chainSec, chainFar (m), preDim,
 *   finale: (pose, portrait) ⇒ escribe pose { y, z, lookY, lookZ, fov } · title: texto del rótulo del evento o null,
 *   exposure (base), titleColor
 */
export function createRunner(ctx, o = {}) {
  const { THREE, rig, post, timeline: tl, util, camera } = ctx;
  const { clamp, clamp01, damp, easeInOutSine, easeOutCubic } = util;
  const tlRaw = ctx.tl;
  const camH = o.camH ?? 1.7;
  const moods = { ...MOODS, ...(o.moods || {}) };
  const CHAIN_SEC = o.chainSec ?? 2.6;
  const CHAIN_FAR = o.chainFar ?? 280;
  const PRE_DIM = o.preDim ?? 0.5;
  const EXPO = o.exposure ?? 0.95;

  const u = {
    uWave: { value: new THREE.Vector4(0, 0.4, 1, 0) },
    uWave2: { value: new THREE.Vector4(0, 0, 0, 0) },
    uColOld: { value: new THREE.Color('#30D158') },
    uColNew: { value: new THREE.Color('#30D158') },
  };

  // ── distancia REAL recorrida en función del reloj de la clase (m) ──
  const sigT = { arr: new Float64Array(0), len: 0, ver: -1, vEnd: 0 };
  function buildSig() {
    const n = Math.ceil((tl.totalSec + 130) / DTT) + 2;
    if (sigT.arr.length < n) sigT.arr = new Float64Array(n);
    const Ar = sigT.arr;
    Ar[0] = 0;
    let prev = kmhOfVis(tlRaw.vAt(0)) / 3.6;
    for (let k = 1; k < n; k++) {
      const v = kmhOfVis(tlRaw.vAt(k * DTT)) / 3.6;
      Ar[k] = Ar[k - 1] + (prev + v) * 0.5 * DTT;
      prev = v;
    }
    sigT.len = n;
    sigT.ver = tl.version;
    sigT.vEnd = prev;
  }
  function sigAt(t) {
    if (!(t > 0)) return 0;
    const k = t / DTT;
    const i = Math.floor(k);
    const Ar = sigT.arr;
    if (i >= sigT.len - 1) return Ar[sigT.len - 1] + (t - (sigT.len - 1) * DTT) * sigT.vEnd;
    return Ar[i] + (Ar[i + 1] - Ar[i]) * (k - i);
  }
  buildSig();

  // ── rótulo del evento (cuelga de la cámara, en el hueco libre del HUD) ──
  let title = null;
  if (o.title) {
    const tex = ctx.textTexture(o.title, { size: 72, weight: 600, tracking: 0.34, color: o.titleColor || '#ffffff', pad: 0.3 });
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    title = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    title.frustumCulled = false;
    title.renderOrder = 950;
    title.visible = false;
    title.userData.aspect = tex.userData.aspect;
    ctx.cameraRoot.add(title);
  }
  const titlePos = { x: 0, y: 0, w: 0, h: 0, ok: false };
  let titleA = 0;

  const mood = { ...moods.jog };
  const base = { fov: o.fovP ?? 60, sx: 0, sy: 0 };
  const finalePose = { y: 7, z: 5, lookY: 0.5, lookZ: -45, fov: 56 };
  const st = {
    S: 0, fe: 0, dt: 0, rm: false, lvl: 3, pauseK: 0, portrait: true, readyDim: 1, firstFrame: true,
    horizonY: 0.5, // fracción de pantalla (desde arriba) del horizonte
  };
  let hudVersion = -1;
  let driftErr = 0;
  let introOn = null;
  let chain = null;
  let chainZone = 'jog';
  let finaleInit = false;
  let finaleOn = false;
  let lastRecord = false;
  let clockT = 0;
  const gold = new THREE.Color('#ffd60a');
  const rectOf = (kind) => { for (const r of ctx.hud.rects) if (r.kind === kind) return r; return null; };

  function frameCamera() {
    const W = Math.max(1, ctx.hud.width);
    const H = Math.max(1, ctx.hud.height);
    const sp = rectOf('speed');
    const seg = rectOf('segment');
    const top = rectOf('top');
    const spB = sp ? sp.y + sp.h : H * 0.4;
    if (st.portrait) {
      const fy = clamp(spB / H + (o.horizonP ?? 0.06), 0.42, 0.66);
      base.fov = o.fovP ?? 60; base.sx = 0; base.sy = 1 - 2 * fy;
      st.horizonY = fy;
      if (title) {
        const h = clamp(W * 0.043, 15, 24);
        const w = h * title.userData.aspect;
        const y0 = top ? top.y + top.h : H * 0.1;
        const y1 = sp ? sp.y : H * 0.24;
        titlePos.w = w; titlePos.h = h; titlePos.x = (W - w) / 2; titlePos.y = (y0 + y1) / 2 - h / 2;
        titlePos.ok = y1 - y0 > h + 16 && w < W - 24;
      }
    } else {
      const gapL = sp ? (sp.x + sp.w) / W : 0.46;
      const gapR = seg ? seg.x / W : 0.55;
      const fx = clamp((gapL + gapR) / 2, 0.42, 0.62);
      const fy = clamp(spB / H - 0.03, 0.55, 0.8);
      base.fov = o.fovL ?? 44; base.sx = 2 * fx - 1; base.sy = 1 - 2 * fy;
      st.horizonY = fy;
      if (title) {
        const h = clamp(H * 0.05, 15, 24);
        const w = h * title.userData.aspect;
        titlePos.w = w; titlePos.h = h;
        titlePos.x = seg ? seg.x : W * 0.55;
        titlePos.y = (seg ? seg.y : H * 0.5) - 14 - h;
        titlePos.ok = titlePos.x + w < W - 8;
      }
    }
  }
  frameCamera();

  function placeScreen(mesh, x, y, w, h) {
    const W = Math.max(1, ctx.size.width);
    const H = Math.max(1, ctx.size.height);
    const e = camera.projectionMatrix.elements;
    const ndcX = ((x + w / 2) / W) * 2 - 1;
    const ndcY = 1 - ((y + h / 2) / H) * 2;
    mesh.position.set((ndcX + e[8]) / e[0], (ndcY + e[9]) / e[5], -1);
    mesh.scale.set(((w / W) * 2) / e[0], ((h / H) * 2) / e[5], 1);
    mesh.rotation.set(0, 0, 0);
  }

  function startChain(fromCol, toCol, dim, sec) {
    u.uColOld.value.copy(fromCol);
    u.uColNew.value.copy(toCol);
    u.uWave.value.y = dim;
    chain = { t0: clockT, dur: sec };
  }

  const postOpts = { exposure: EXPO };

  const runner = {
    u, st, base, mood,
    get S() { return st.S; },
    get fe() { return st.fe; },
    get portrait() { return st.portrait; },
    sigAt,

    resize({ aspect }) {
      const p = aspect < 0.9;
      hudVersion = ctx.hud.version;
      if (p !== st.portrait) { st.portrait = p; frameCamera(); rig.snap(); } else frameCamera();
    },

    /** Al principio del update del escenario. Devuelve st. */
    update(f) {
      const dt = f.dt;
      clockT = f.time;
      st.dt = dt;
      st.rm = f.reducedMotion;
      st.lvl = f.qualityLevel | 0;
      if (ctx.hud.version !== hudVersion) { hudVersion = ctx.hud.version; frameCamera(); }
      if (tl.version !== sigT.ver) {
        const before = sigAt(f.t);
        buildSig();
        driftErr += before - sigAt(f.t);
      }
      if (driftErr !== 0 && !f.finale) {
        const step = 0.4 * dt;
        driftErr = Math.abs(driftErr) <= step ? 0 : driftErr - Math.sign(driftErr) * step;
      }
      const target = moods[f.zone] || moods.jog;
      const kM = st.firstFrame ? 1 : 1 - Math.exp(-dt * (st.rm ? 0.6 : 1.1));
      for (let i = 0; i < MOOD_KEYS.length; i++) { const k = MOOD_KEYS[i]; mood[k] += (target[k] - mood[k]) * kM; }
      st.pauseK = damp(st.pauseK, f.paused ? 1 : 0, 1.6, dt);
      if (!f.finale) lastRecord = f.record.on;
      if (st.firstFrame) {
        st.readyDim = f.status === 'ready' ? 0.35 : 1;
        const c = ctx.zoneColor(f.zone);
        u.uColOld.value.copy(c);
        u.uColNew.value.copy(c);
        chainZone = f.zone;
      }
      st.firstFrame = false;

      st.S = f.finale > 0 ? st.S : sigAt(f.t) + driftErr;
      st.fe = f.finale ? easeInOutSine(clamp01(f.finale)) : 0;

      // ── luces: cadena, apagado previo, preparada, pausa ──
      const W = u.uWave.value;
      st.readyDim = damp(st.readyDim, f.status === 'ready' ? 0.35 : 1, f.status === 'ready' ? 1.5 : 0.6, dt);
      if (chain) {
        const p = (f.time - chain.t0) / chain.dur;
        if (p >= 1) { chain = null; W.w = 0; u.uColOld.value.copy(u.uColNew.value); }
        else { W.x = -4 + (CHAIN_FAR + 4) * easeInOutSine(clamp01(p)); W.w = 1; }
      } else W.w = 0;
      if (!chain && !f.finale && chainZone !== f.zone) {
        chainZone = f.zone;
        u.uColOld.value.copy(ctx.zoneColor(f.zone));
        u.uColNew.value.copy(u.uColOld.value);
      }
      const pre = f.finale || chain || f.segIndex + 1 >= tl.segCount ? 0 : f.approach;
      u.uWave2.value.x = PRE_DIM * easeInOutSine(clamp01(pre)) * (st.rm ? 0.6 : 1);
      u.uWave2.value.y = f.time;
      W.z = (f.status === 'ready' && !chain ? st.readyDim : 1) * (1 - 0.2 * st.pauseK) * (1 + 0.25 * st.fe);

      // ── rótulo del evento ──
      if (title) {
        const want = titlePos.ok && !f.finale && (f.status === 'ready' || f.t < 8.5) ? 1 : 0;
        titleA = damp(titleA, want, want ? 1.6 : 2.4, dt);
        if (titleA < 0.004 && !want) titleA = 0;
        title.visible = titleA > 0;
        if (title.visible) {
          placeScreen(title, titlePos.x, titlePos.y, titlePos.w, titlePos.h);
          title.material.opacity = easeOutCubic(clamp01(titleA)) * 0.92;
        }
      }

      // ── cámara ──
      if (introOn === null) introOn = f.t < 1 && !st.rm;
      const T = rig.target;
      const intro = introOn ? 1 - easeOutCubic(clamp01(f.intro)) : 0;
      if (introOn && f.intro >= 1) introOn = false;
      const h = camH + mood.dh + 0.1 * st.pauseK + (o.introRise ?? 2.4) * intro;
      if (f.finale > 0) {
        if (!finaleInit) {
          finaleInit = true; finaleOn = true;
          const fc = lastRecord ? gold : ctx.zoneColor(f.zone);
          startChain(u.uColNew.value, fc, 1, CHAIN_SEC * 1.2);
          if (title) title.visible = false;
        }
        if (o.finale) o.finale(finalePose, st.portrait);
        T.position.set(0, finalePose.y, finalePose.z);
        T.lookAt.set(0, finalePose.lookY, finalePose.lookZ);
        T.fov = finalePose.fov;
        T.shift.set(st.portrait ? 0 : base.sx * 0.5, st.portrait ? 0.1 : -0.12);
        T.roll = 0;
        rig.settle.position = 2.4; rig.settle.lookAt = 2.2; rig.settle.shift = 2; rig.settle.fov = 2.2;
      } else {
        if (finaleOn) {
          finaleOn = false; finaleInit = false;
          rig.settle.position = 1.1; rig.settle.lookAt = 1.1; rig.settle.shift = 1.2; rig.settle.fov = 1.4;
          rig.snap();
        }
        T.position.set(0, h, 0);
        T.lookAt.set(0, h, -100);
        T.fov = base.fov + mood.fov;
        T.roll = 0;
        T.shift.set(base.sx, base.sy);
        if (introOn && f.intro < 0.02) rig.snap();
      }
      rig.bobScale = st.rm || f.finale ? 0 : 1;

      postOpts.exposure = EXPO * mood.exp * (1 + 0.03 * st.fe);
      post.set(postOpts);
      return st;
    },

    event(type, data = {}) {
      switch (type) {
        case 'gate':
          startChain(ctx.zoneColor(data.prevZone || chainZone), ctx.zoneColor(data.zone || 'jog'), 1 - PRE_DIM,
            ctx.reducedMotion ? CHAIN_SEC * 1.4 : CHAIN_SEC);
          chainZone = data.zone || 'jog';
          post.pulse(0.03, 1.4);
          break;
        case 'start': {
          const z = ctx.segments[0]?.zone || 'jog';
          const c = ctx.zoneColor(z);
          startChain(c, c, st.readyDim, CHAIN_SEC * 1.3);
          chainZone = z;
          st.readyDim = 1;
          break;
        }
        case 'seek': driftErr = 0; chain = null; u.uWave.value.w = 0; break;
        case 'km': post.pulse(0.03, 1.4); break;
        case 'halfway': case 'drop': post.pulse(0.04, 1.6); break;
        case 'finish': post.pulse(0.04, 2.5); break;
        default: break;
      }
    },

    debug() { return { S: st.S, chain: !!chain, drift: driftErr, horizonY: st.horizonY }; },
  };
  void DEG;
  return runner;
}

/**
 * Ranuras equiespaciadas a lo largo del camino: posición z del grupo para que los objetos colocados en z = −k·D (k ≥ −back)
 * avancen hacia ti con el mundo. Con un periodo P = n·D se repite el patrón cada P metros.
 */
export function scrollZ(S, P) {
  return ((S % P) + P) % P;
}
