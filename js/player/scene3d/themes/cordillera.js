// BestRunning · escenario CORDILLERA (SPEC §15.2-1, §15.3, §14.1). La clase convertida en una cordillera nocturna:
// terreno mate oscuro construido con el perfil del entrenamiento (cada intervalo intenso es una cumbre que ves venir,
// las recuperaciones bajan al collado, el test VAM sube en terrazas), leído como un render topográfico de telemetría:
// jerarquía de curvas de nivel antialias (finas, maestras y directoras; acento de la zona cerca de ti, plata lejos),
// filo de luz de luna en las crestas a contraluz y perspectiva aérea (cada sierra más lejana, más clara). Un camino de
// luz fino recorre la cresta; la cámara planea baja a tu velocidad real con muelles críticos; cielo nocturno con
// estrellas, Vía Láctea tenue y una aurora sobria de cuerpo neutro cuyo borde toma el color de la zona.
// Firma: el rótulo topográfico de la próxima cumbre («● SPRINT 13,0») encuadrado en el hueco libre (vertical: entre el
// número y el rótulo inferior; horizontal: arriba a la derecha, sobre el hueco entre el número y la columna de datos).
// Momentos sobrios: cambio de tramo = una línea fina tendida sobre el relieve que cruzas en el segundo exacto + una
// curva de nivel del nuevo acento que baja por las laderas + cambio gradual del acento. Fantasma = una luz pequeña en
// el camino con rótulo de retransmisión; récord = acento dorado sutil. Final = corte limpio de realización a la maqueta
// en relieve de la clase entera (la ruta de principio a fin en los colores de sus zonas) con una deriva lentísima.
// Sin destellos, sin máscaras: la legibilidad sale de la composición.
// Sensación de velocidad (ctx.speedFeel, en el shader del terreno): marcas cada 4 u junto al camino y mojones bajos
// cada 8 u en el borde de la senda; ojo a 3,7 u (antes 4,2) y balanceo de zancada a la escala del mundo.
// ~6 draw calls (cielo, terreno, luz del fantasma, ≤3 rótulos) + postproceso; sin asignaciones por fotograma.
import { createProfile, bendAt, DS, S0, BASE, ZONE_KEYS } from './cordillera/profile.js';
import { NB, TERRAIN_VERT, TERRAIN_FRAG, SKY_VERT, SKY_FRAG, DOT_VERT, DOT_FRAG } from './cordillera/glsl.js';
import { LODS, bandsFor, forwardGeometry, backGeometry, updateBands } from './cordillera/terrain.js';
import { createTag } from './cordillera/tags.js';

export const meta = {
  id: 'cordillera',
  name: 'Cordillera',
  description: 'Tu clase como una cordillera nocturna: cada intervalo, una cumbre.',
};

const RANK = { walk: 0, warmup: 1, cooldown: 1, jog: 2, run: 3, fast: 4, sprint: 5 };
const EYE_ZONE = { walk: 0.35, warmup: 0.3, cooldown: 0.45, jog: 0, run: -0.1, fast: -0.25, sprint: -0.42 };
const FOV_ZONE = { fast: 1.2, sprint: 2.6 };
const LOOK = 170;           // la mirada apunta al camino a esta distancia (u)
const PITCH_L = 110;        // distancia a la que se mide la pendiente para cabecear (u)
const SWEEP_T = 2.8;        // duración de la curva que barre las laderas tras un cambio (s)
const GATE_PASS_T = 1.8;    // la línea recién cruzada se apaga en este tiempo (s)
const BACK_LEN = 2600;      // longitud de la maqueta final (u): la clase entera, comprimida
const BACK_EXAG = 1.55;     // exageración vertical de la maqueta
const MARK_NEAR = 360;      // el rótulo de KM/MITAD/META solo aparece en sus últimos metros (u)
/** Nivel de calidad → detalle de malla (la media tiene su propio LOD: bajar de alta alivia de verdad los vértices). */
const lodFor = (level) => (level >= 3 ? 'high' : level === 2 ? 'med' : level === 1 ? 'low' : 'eco');

export function createTheme(ctx) {
  const { THREE, root, rig, post, util, camera } = ctx;
  const { clamp, clamp01, smoothstep, damp } = util;
  const tl = ctx.timeline;
  const tlRaw = ctx.tl;
  const ZONES = ctx.palette;
  const prof = createProfile(ctx);
  const maxAniso = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy?.() || 1);

  camera.near = 0.3;
  camera.far = 46000;
  post.set({ toneMapping: 'aces', exposure: 0.95, bloomStrength: 0.3, bloomThreshold: 1.0, bloomRadius: 0.2, vignette: 0.26, saturation: 1 });

  const C = (r, g, b) => new THREE.Color(r, g, b); // valores lineales
  const GOLD = new THREE.Color('#ffcc66');
  const NEUTRAL = C(0.5, 0.52, 0.58);
  const MOON_RUN = new THREE.Vector3(-0.38, 0.16, -0.91).normalize();   // luna baja por delante: filo en las crestas
  const MOON_FIN = new THREE.Vector3(-0.82, 0.5, 0.28).normalize();     // maqueta final: luz rasante lateral

  /* ───────────── Uniformes compartidos (malla delantera y maqueta final) ───────────── */
  const U = {
    uProf: { value: prof.tex },
    uProfInfo: { value: new THREE.Vector3(S0, DS, prof.count) },
    uBand: { value: Array.from({ length: NB }, () => new THREE.Vector3()) },
    uBack: { value: new THREE.Vector4(0, 1, 0, 1) },
    uBack2: { value: new THREE.Vector4(BACK_EXAG, BASE, 0, 0) },
    uAnchor: { value: 0 }, uFrac: { value: 0 }, uRcam: { value: 0 }, uBendCam: { value: 0 }, uYOff: { value: 0 }, uExag: { value: 1 },
    uAlb: { value: C(0.05, 0.054, 0.064) },
    uAmb: { value: C(0.17, 0.2, 0.28) },
    uMoonCol: { value: C(0.55, 0.6, 0.72) },
    uMoonDir: { value: MOON_RUN.clone() },
    uRimCol: { value: C(0.07, 0.086, 0.125) },
    uHaze: { value: C(0.036, 0.046, 0.072) },
    uHazeLow: { value: C(0.046, 0.057, 0.084) },
    uLineCol: { value: C(0.1, 0.114, 0.14) },
    uAccent: { value: new THREE.Color() },
    uPathCur: { value: new THREE.Color() },
    uNext: { value: new THREE.Color() },
    uNeutral: { value: NEUTRAL.clone() },
    uGhostCol: { value: C(0.72, 0.86, 1.0) },
    uGateCol: { value: new THREE.Color() },
    uGate2Col: { value: new THREE.Color() },
    uSweepCol: { value: new THREE.Color() },
    uMarkCol: { value: C(0.62, 0.64, 0.7) },
    uZoneCols: { value: ZONE_KEYS.map((k) => ctx.zoneColor(k).clone()) },
    uGate: { value: new THREE.Vector4() },
    uPath: { value: new THREE.Vector4(1e9, 1e9, 0.4, 1) },
    uSweep: { value: new THREE.Vector4() },
    uMark: { value: new THREE.Vector4() },
    uGhost: { value: new THREE.Vector4() },
    uFog: { value: new THREE.Vector4(1 / 3000, 1 / 1100, 30, 0) },
    uMisc: { value: new THREE.Vector4(0, 0, 0, 1) },
    uLines: { value: new THREE.Vector4(2, 160, 0.2, 1) },
    uRoute: { value: new THREE.Vector2(-1e9, 1e9) },
    uFeel: { value: new THREE.Vector2(1, 1) },
  };
  const NOISE = ctx.shaders.NOISE;
  const terrainMat = (back) => new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: TERRAIN_VERT.replace('NOISE_CHUNK', NOISE),
    fragmentShader: TERRAIN_FRAG.replace('NOISE_CHUNK', NOISE),
    defines: back ? { BACK: 1 } : {},
  });

  /* ───────────── Terreno (LOD por calidad) + maqueta final (creada ya: el núcleo la compila al cargar) ───────────── */
  const geos = {};
  const geoFor = (name) => geos[name] || (geos[name] = forwardGeometry(THREE, LODS[name]));
  let lodName = lodFor(ctx.qualityLevel);
  let bands = bandsFor(LODS[lodName]);
  const terrain = new THREE.Mesh(geoFor(lodName), terrainMat(false));
  terrain.frustumCulled = false;
  terrain.renderOrder = 0;
  root.add(terrain);
  const backMesh = new THREE.Mesh(backGeometry(THREE), terrainMat(true));
  backMesh.frustumCulled = false;
  backMesh.renderOrder = 0;
  backMesh.visible = false;   // compileAsync recorre también lo oculto: sin tirón al empezar el plano final
  root.add(backMesh);

  function setLod(level) {
    const name = lodFor(level);
    if (name === lodName) return;
    lodName = name;
    bands = bandsFor(LODS[name]);
    terrain.geometry = geoFor(name);
  }

  /* ───────────── Cielo ───────────── */
  const skyU = {
    uProjInv: { value: camera.projectionMatrixInverse },
    uCamWorld: { value: camera.matrixWorld },
    uZenith: { value: C(0.0032, 0.0042, 0.0078) },
    uHaze: U.uHaze,
    uGlow: { value: C(0.013, 0.017, 0.028) },
    uMoonDir: U.uMoonDir,
    uAurBody: { value: C(0.5, 0.62, 0.72) },
    uAurHem: { value: new THREE.Color() },
    uAur: { value: new THREE.Vector4(0.035, 0.42, 0, 1) },
    uStars: { value: new THREE.Vector4(1, 0.006, 0, 0) },
  };
  const skyGeo = new THREE.BufferGeometry();
  skyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.ShaderMaterial({
    uniforms: skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG.replace('NOISE_CHUNK', NOISE), depthWrite: false,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = 1000; // el último: solo donde no hay montaña (early-Z)
  root.add(sky);

  /* ───────────── Fantasma: una luz pequeña en el camino ───────────── */
  const dotU = { uCol: { value: U.uGhostCol.value }, uA: { value: 0 } };
  const ghostDot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: dotU, vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  ghostDot.frustumCulled = false;
  ghostDot.renderOrder = 500;
  ghostDot.visible = false;
  root.add(ghostDot);

  /* ───────────── Rótulos de retransmisión ───────────── */
  const tagGhost = createTag(THREE, { maxAnisotropy: maxAniso });
  const tagMark = createTag(THREE, { maxAnisotropy: maxAniso });
  const tagPeak = createTag(THREE, { maxAnisotropy: maxAniso, flag: true });
  root.add(tagGhost.mesh, tagMark.mesh, tagPeak.mesh);

  /* ───────────── Estado ───────────── */
  const st = {
    portrait: true, fx: 0.5, fy: 0.57, fov: 56, eye: 2.7, side: 0.32, hudV: -1, tlv: tl.version,
    eyeS: 2.7, fovAdd: 0, pauseK: 0, yOff: 0, lastR: 0, lastS: 0, time: 0, testEndAt: -1e9, floatPending: false,
    dropAt: -1e9, aurT: 0, aurBase: 0.42, aurAz: 0, aurW: 2, accentR: 160, markKey: 0, peakSeg: -1, peakSpeed: -1, peakU: 0, bass: 0,
    ghostD: 30, ghostTxtAt: -1e9, fin: null, finK: 0, sOff: 0, lastKmh: 0, ramp: null,
  };
  const tmp = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const markPos = new THREE.Vector3();   // cada rótulo conserva su ancla mientras se desvanece
  const peakPos = new THREE.Vector3();
  const probe = new THREE.Vector3();
  const accent = new THREE.Color();
  const zoneHex = {};
  for (const k of Object.keys(ZONES)) zoneHex[k] = ZONES[k].color;
  const rectOf = (kind) => { for (const r of ctx.hud.rects) if (r.kind === kind) return r; return null; };

  /**
   * Composición (§15.1, §15.3): cámara nivelada y desplazamiento de lente.
   * Vertical: horizonte en la ventana entre el número y el rótulo inferior (las cumbres que vienen y su rótulo viven
   * ahí); cielo sereno con estrellas detrás del número y la aurora en la banda alta, bajo la isla.
   * Horizontal: punto de fuga en el hueco entre el número y la columna de datos, a la altura del borde superior de la
   * columna: el camino sube por el hueco, la próxima cumbre y su rótulo quedan arriba a la derecha, en el hueco libre,
   * y la aurora se abre sobre ese lado.
   */
  function frameCamera() {
    const W = Math.max(1, ctx.hud.width || ctx.size.width);
    const H = Math.max(1, ctx.hud.height || ctx.size.height);
    const sp = rectOf('speed');
    if (st.portrait) {
      const lt = rectOf('segment');
      const top = sp ? (sp.y + sp.h) / H : 0.45;
      const bot = lt ? lt.y / H : 0.71;
      st.fy = clamp(top + 0.47 * (bot - top), 0.48, 0.66);
      st.fx = 0.5;
      st.fov = 58;
      st.eye = 3.7;   // (4,2 hasta oct-26: el flujo del suelo ∝ velocidad / altura de ojo; más bajo = más velocidad)
      st.side = 0.32;
      st.aurBase = 0.42;
      st.aurAz = 0;
      st.aurW = 2.2;
      st.accentR = 160;
    } else {
      const seg = rectOf('segment');
      const gapL = sp ? (sp.x + sp.w) / W : 0.46;
      const gapR = seg ? seg.x / W : 0.55;
      st.fx = clamp(gapL + 0.62 * Math.max(0, gapR - gapL), 0.45, 0.78);
      st.fy = seg ? clamp(seg.y / H, 0.3, 0.56) : 0.46;
      st.fov = 44;
      st.eye = 4.6;
      // un pelín a un lado del camino: la senda entra por abajo en el centro del hueco y sube hasta el punto de fuga
      const gapX = (gapL + 0.3 * Math.max(0, gapR - gapL)) * W;
      const dyPx = (1 - st.fy) * H;
      st.side = clamp((st.eye * (st.fx * W - gapX)) / Math.max(40, dyPx), 0, 2.5);
      st.aurBase = 0.13;
      st.aurAz = 0.42;
      st.aurW = 0.55;
      st.accentR = 90;
    }
  }
  frameCamera();

  function worldAt(s, x, out) {
    // (los rótulos solo se ven en carrera, con exageración 1: misma fórmula que el shader cerca del camino)
    return out.set(x + bendAt(s) - U.uBendCam.value, (prof.R(s) - U.uRcam.value) * U.uExag.value + U.uYOff.value, -(s - st.lastS));
  }

  /** ¿Se ve la cima en s1 desde la cámara (en S, a la cota yEye)? Muestrea la cresta entre medias. */
  function peakVisible(S, s1, yEye) {
    const yPeak = prof.R(s1) + 1.5;
    for (let k = 1; k < 10; k++) {
      const u = k / 10;
      if (prof.R(S + (s1 - S) * u) > yEye + (yPeak - yEye) * u + 1) return false;
    }
    return true;
  }

  function nextIntense(from) {
    for (let i = from; i < tlRaw.n; i++) {
      const z = tlRaw.zones[i];
      if (prof.isStage[i] || (RANK[z] ?? 0) >= 3) return i;
    }
    return -1;
  }

  /* ───────────── Fotograma ───────────── */
  function update(f) {
    const dt = f.dt;
    // «No puedo más»: el reloj salta a la vuelta a la calma y la velocidad visual del núcleo bajaría desde el ÚLTIMO
    // escalón del test (el mundo correría unos segundos); aquí baja desde el escalón en el que paraste, como la cinta.
    if (f.running && !st.ramp) st.lastKmh = f.speed;
    if (st.ramp && st.ramp.t0 >= 0 && !(f.finale > 0)) {
      const u = (f.time - st.ramp.t0) / 4;
      if (u >= 1) st.ramp = null;
      else {
        const vOv = st.ramp.from + (tl.visualSpeed(f.speed) - st.ramp.from) * util.easeInOutCubic(clamp01(u));
        st.sOff += (vOv * f.timeScale - f.visualSpeed) * dt;
      }
    } else if (st.ramp && f.time - st.ramp.armedAt > 4 && st.ramp.t0 < 0) st.ramp = null;
    if (!st.ramp && st.sOff !== 0) {
      const stp = (0.05 * Math.max(4, f.visualSpeed) + 0.5) * dt;   // se realinea sin que se note
      st.sOff = Math.abs(st.sOff) <= stp ? 0 : st.sOff - Math.sign(st.sOff) * stp;
    }
    const S = f.S + st.sOff;
    const rm = f.reducedMotion;
    st.time = f.time;
    if (ctx.hud.version !== st.hudV && !st.fin) { st.hudV = ctx.hud.version; frameCamera(); }
    if (f.qualityLevel !== undefined) setLod(f.qualityLevel);

    // Velocidades ajustadas ⇒ la tabla se rehace; la cámara no salta (el desnivel se funde)
    if (f.tlVersion !== st.tlv) {
      const before = prof.R(S);
      prof.rebuild();
      st.tlv = f.tlVersion;
      U.uProf.value = prof.tex;
      U.uProfInfo.value.z = prof.count;
      st.yOff += prof.R(S) - before;
    }
    const Rcam = prof.R(S);
    if (st.floatPending) { st.floatPending = false; st.yOff = Rcam - st.lastR; } // «No puedo más»: baja flotando
    st.yOff = damp(st.yOff, 0, st.yOff < 0 ? 0.75 : 1.6, dt);
    if (Math.abs(st.yOff) < 1e-3) st.yOff = 0;
    st.lastR = Rcam;
    st.lastS = S;

    // Rejilla anclada al mundo y referencias de cámara
    const bandsOut = updateBands(bands, U.uBand.value, S);
    const anchor = bandsOut.anchor;
    U.uAnchor.value = anchor;
    U.uFrac.value = bandsOut.frac;
    U.uRcam.value = Rcam;
    U.uBendCam.value = bendAt(S);
    U.uYOff.value = st.yOff;

    // Color: acento gradual de la zona (oro suave si vas por delante del fantasma)
    const rec = f.record.amount;
    accent.copy(f.accent);
    U.uAccent.value.copy(accent).lerp(GOLD, rec * 0.25);
    U.uPathCur.value.copy(accent).lerp(GOLD, rec * 0.85);
    const seg = f.segIndex;
    const n = tlRaw.n;
    const nxt = seg + 1 < n ? seg + 1 : -1;
    if (nxt >= 0) U.uNext.value.copy(ctx.zoneColor(tlRaw.zones[nxt])); else U.uNext.value.copy(NEUTRAL);
    st.pauseK = damp(st.pauseK, f.paused ? 1 : 0, 1.6, dt);

    // Camino: tramo actual → siguiente (más tenue hasta los últimos 3 s) → neutro
    const P = U.uPath.value;
    P.x = nxt >= 0 ? prof.sb[nxt] - anchor : 1e9;
    P.y = nxt >= 0 && nxt + 1 < n ? prof.sb[nxt + 1] - anchor : 1e9;
    P.z = 0.2 + 0.8 * f.approach;
    P.w = (1 - 0.35 * st.pauseK) * (0.85 + 0.15 * f.timeScale);

    // Línea de cambio de tramo (próxima) y la recién cruzada
    const G = U.uGate.value;
    if (nxt >= 0 && !st.fin) {
      const d = prof.sb[nxt] - S;
      G.x = prof.sb[nxt] - anchor;
      G.y = smoothstep(1100, 160, d) * (0.5 + 0.5 * f.approach);
      U.uGateCol.value.copy(U.uNext.value);
    } else { G.y = 0; }
    if (seg > 0 && f.segElapsed < GATE_PASS_T && !st.fin) {
      const k = 1 - f.segElapsed / GATE_PASS_T;
      G.z = prof.sb[seg] - anchor;
      G.w = k * k;
      U.uGate2Col.value.copy(ctx.zoneColor(f.zone));
    } else G.w = 0;

    // Curva de nivel que baja por las laderas tras el cambio (derivada del reloj: robusta a saltos y capturas)
    const SW = U.uSweep.value;
    if (seg > 0 && f.segElapsed < SWEEP_T && !st.fin) {
      const e = f.segElapsed;
      SW.x = prof.R(prof.sb[seg]) - 0.6 - (rm ? 10 : 19) * e;
      SW.y = smoothstep(0, 0.22, e) * Math.pow(1 - e / SWEEP_T, 1.4) * 0.95;
      U.uSweepCol.value.copy(ctx.zoneColor(f.zone));
    } else SW.y = 0;

    // Hito más cercano por delante: KM n · MITAD · META
    // (markKey: km > 0 · −1 = MITAD · −2 = META; el texto solo se compone cuando cambia)
    let markS = Infinity;
    let markKey = 0;
    const Tkm = tl.timeForKm(f.kmNext);
    if (Number.isFinite(Tkm)) { markS = tl.visualDistanceAt(Tkm); markKey = f.kmNext; }
    const sHalf = tl.visualDistanceAt(tl.totalSec / 2);
    if (sHalf - S > -40 && sHalf < markS) { markS = sHalf; markKey = -1; }
    const sEnd = prof.sb[n];
    if (sEnd - S > -40 && sEnd < markS) { markS = sEnd; markKey = -2; }
    // el de km que acaba de pasar sigue un momento por detrás
    const kmPrev = f.kmNext - 1;
    if (kmPrev >= 1) {
      const Tp = tl.timeForKm(kmPrev);
      const sp = Number.isFinite(Tp) ? tl.visualDistanceAt(Tp) : -Infinity;
      if (S - sp < 40 && sp - S < markS - S) { markS = sp; markKey = kmPrev; }
    }
    const M = U.uMark.value;
    let markA = 0;
    let markTag = 0;
    if (Number.isFinite(markS) && !st.fin) {
      const d = markS - S;
      markA = smoothstep(900, 480, d) * smoothstep(-40, -4, d);
      markTag = smoothstep(MARK_NEAR, MARK_NEAR - 80, d) * smoothstep(-40, -4, d);
      M.x = markS - anchor;
    }
    M.y = markA * 0.9;

    // Fantasma: luz en el camino a la distancia real (comprimida si te saca mucho)
    const g = f.ghost;
    const uPerM = f.speed > 0.5 ? tl.visualSpeed(f.speed) / (f.speed / 3.6) : 4;
    const ahead = g.active ? -g.deltaM * uPerM : -30;
    const gTarget = ahead > 0 ? 900 * (1 - Math.exp(-ahead / 900)) : ahead;
    st.ghostD = damp(st.ghostD, gTarget, 3, dt);
    // con las luces de tu récord (ctx.ghostLights) se apagan la luz, su rótulo y el charco del terreno
    const ghostOn = g.active && st.ghostD > 3 && !st.fin && !ctx.ghostLights;
    const GH = U.uGhost.value;
    GH.x = S + st.ghostD - anchor;
    GH.z = st.sOff; // desfase de la rampa de «No puedo más» (lo leen las luces; el shader no usa .z)
    GH.y = damp(GH.y, ghostOn ? 0.85 : 0, 2.5, dt);

    // Cielo: aurora sobria (cuerpo neutro, borde con el color de la zona), estrellas y Vía Láctea
    const spc = f.spectrum;
    st.bass = damp(st.bass, rm ? 0.3 : spc.bass, 4, dt);
    const drop = Math.max(0, 1 - (st.time - st.dropAt) / 3.5);
    if (!rm) st.aurT += dt * (0.45 + 0.8 * spc.mid) * (1 - 0.5 * st.pauseK);
    const A = skyU.uAur.value;
    const cur = rig.current;
    const pitchNow = Math.atan2(cur.lookAt.y - cur.position.y, Math.max(1, Math.hypot(cur.lookAt.x - cur.position.x, cur.lookAt.z - cur.position.z)));
    // la aurora vive siempre en la banda alta del encuadre: si la cámara cabecea hacia arriba (subida), sube con ella
    A.y = st.fin ? 0.5 : st.aurBase + Math.max(0, pitchNow) * 1.05;
    const intense = clamp01(((RANK[f.zone] ?? 2) - 1) / 4);
    A.x = (0.12 + 0.03 * intense + (rm ? 0 : 0.022 * st.bass + 0.025 * drop * drop)) * (ctx.qualityLevel === 0 ? 0.8 : 1) * (st.fin ? 0.6 : 1);
    A.z = st.aurT;
    A.w = ctx.qualityLevel > 0 ? 1 : 0;
    skyU.uAurHem.value.copy(U.uAccent.value).multiplyScalar(0.75).lerp(skyU.uAurBody.value, 0.18);
    skyU.uStars.value.set(ctx.qualityLevel > 0 ? 1 : 0.7, ctx.qualityLevel > 0 ? 0.012 : 0, st.aurAz, st.aurW);
    const misc = U.uMisc.value;
    misc.y = rec;
    misc.z = rm || !f.musicBeat ? 0 : f.beat;
    misc.w = ctx.qualityLevel > 0 ? 1 : 0;
    U.uLines.value.z = (0.2 + 0.04 * f.approach) * (1 - 0.35 * st.pauseK);
    U.uLines.value.y = st.accentR;
    const feel = ctx.speedFeel;
    U.uFeel.value.set(feel ? feel.cue : 1, feel ? feel.density : 1);

    /* ── Cámara ── */
    const T = rig.target;
    const z = f.zone;
    const introK = rm ? 0 : 1 - util.easeInOutCubic(f.intro);
    const eyeT = st.eye + (EYE_ZONE[z] ?? 0) + 1.1 * st.pauseK + 7 * introK;
    st.eyeS = damp(st.eyeS, eyeT, 0.9, dt);
    st.fovAdd = damp(st.fovAdd, rm ? 0 : FOV_ZONE[z] || 0, 0.6, dt);

    if (f.finale > 0 && !st.fin) startFinale(f);
    else if (!(f.finale > 0) && st.fin) endFinale();

    if (st.fin) {
      finaleCamera(f);
      finaleTags(f);
    } else {
      // la mirada acompaña la pendiente que viene (subidas casi enteras, bajadas a medias): el camino siempre fuga
      // en el mismo punto de la composición y la ladera de una cumbre no sube por detrás del número
      const lx = bendAt(S + LOOK) - U.uBendCam.value;
      const dR = prof.R(S + PITCH_L) - Rcam;
      const ly = st.eyeS + (dR > 0 ? 0.86 : 0.18) * dR * (LOOK / PITCH_L);
      T.position.set(st.side, st.eyeS, 0);
      T.lookAt.set(lx + st.side, ly, -LOOK);
      T.fov = st.fov + st.fovAdd;
      T.roll = 0;
      T.shift.set(2 * st.fx - 1, 1 - 2 * st.fy);
      rig.settle.position = 0.9;
      rig.settle.lookAt = 0.9;
      rig.settle.fov = 1.6;
      rig.settle.shift = 1.2;
      rig.bobScale = 2.2;   // unidades de la cordillera ≈ 2,3× las de los demás escenarios (ojo a 3,7 u)
      U.uExag.value = 1;
      U.uFog.value.w = 0;
      misc.x = 0;
    }

    if (!st.fin) runningTags(f, S, Rcam, nxt, n, ghostOn, markS, markKey, markTag);
  }

  /** Luz del fantasma y rótulos de carrera (fantasma, hito, cumbre). */
  function runningTags(f, S, Rcam, nxt, n, ghostOn, markS, markKey, markTag) {
    const dt = f.dt;
    const g = f.ghost;
    const GH = U.uGhost.value;
    const rects = ctx.hud.rects;
    const size = ctx.size;
    worldAt(S + st.ghostD, 0, pos);
    pos.y += 0.32;
    ghostDot.visible = GH.y > 0.01 && !st.fin;
    if (ghostDot.visible) {
      ghostDot.position.copy(pos);
      ghostDot.quaternion.copy(camera.quaternion);
      const depth = Math.max(0.5, tmp.copy(pos).sub(camera.position).length());
      const s = Math.max(0.35, depth * 0.016);
      ghostDot.scale.set(s, s, 1);
      dotU.uA.value = GH.y;
    }
    // rótulo del fantasma: etiqueta + diferencia (se redibuja como mucho 2 veces por segundo)
    if (ghostOn && st.time - st.ghostTxtAt > 0.5) {
      st.ghostTxtAt = st.time;
      const m = Math.round(g.deltaM);
      tagGhost.update(g.label || 'Mejor marca', `${m > 0 ? '+' : m < 0 ? '−' : ''}${Math.abs(m)} m`);
    }
    pos.y += 0.25;
    tagGhost.place(pos, camera, size, rects, dt, ghostOn && st.ghostD > 12 ? 1 : 0);

    // hito (solo en sus últimos metros: la cumbre es la firma del escenario)
    if (markTag > 0.01) {
      if (markKey !== st.markKey) { st.markKey = markKey; tagMark.update(markKey === -1 ? 'Mitad' : markKey === -2 ? 'Meta' : `KM ${markKey}`); }
      worldAt(markS, 1.5, markPos);
    }
    tagMark.place(markPos, camera, size, rects, dt, markTag > 0.15 && !st.fin ? 1 : 0);

    // cumbre del próximo intervalo: rótulo topográfico «● SPRINT 13,0». Ancla = la cima si su rótulo cabe en el hueco
    // libre; si no (cumbre ya cercana, alta en el encuadre), el punto más alto de la subida que sí cabe (suavizado).
    const j = nextIntense(nxt >= 0 ? nxt : n);
    let peakWant = 0;
    if (j >= 0 && !st.fin) {
      const sTop = prof.isStage[j] ? prof.sb[j] + 34 : prof.peakS[j];
      const sFoot = Math.min(prof.sb[j], sTop);
      const d = sTop - S;
      if (d > 30 && d < 3200) {
        if (j !== st.peakSeg || tlRaw.speeds[j] !== st.peakSpeed) {
          // el texto solo se compone cuando cambia la cumbre (o su velocidad, tras un ajuste)
          const zj = tlRaw.zones[j];
          if (j !== st.peakSeg) st.peakU = 0;
          st.peakSeg = j;
          st.peakSpeed = tlRaw.speeds[j];
          tagPeak.update(prof.isStage[j] ? `Escalón ${tlRaw.stage[j]}` : ZONES[zj]?.short || '', ctx.fmtSpeed(tlRaw.speeds[j]), zoneHex[zj]);
        }
        // de la cima hacia el pie de la subida: el primer punto a la vista cuyo rótulo cabe en el hueco libre
        let uFit = -1;
        const span = Math.max(0, Math.min(sTop - sFoot, sTop - S - 24));
        const yEye = Rcam + st.eyeS;
        for (let k = 0; k <= 8; k++) {
          const u = k / 8;
          const sk = sTop - span * u;
          if (!peakVisible(S, sk, yEye)) continue;
          worldAt(sk, 0, probe);
          probe.y += 1.5;
          if (tagPeak.fits(probe, camera, size, rects)) { uFit = u; break; }
        }
        if (uFit >= 0) {
          st.peakU = tagPeak.alpha > 0.02 ? damp(st.peakU, uFit, 3, dt) : uFit;
          worldAt(sTop - span * st.peakU, 0, peakPos);
          peakPos.y += 1.5;
          peakWant = smoothstep(3200, 2500, d) * smoothstep(30, 90, d);
        }
      }
    }
    // sobriedad: el hito, cuando aparece, tiene prioridad (unos segundos)
    if (tagMark.alpha > 0.05 || markTag > 0.15) peakWant = 0;
    tagPeak.place(peakPos, camera, size, rects, dt, peakWant > 0.3 ? 1 : 0, 3);
  }

  /* ───────────── Plano final: maqueta en relieve de la clase entera ───────────── */

  // en el plano final el HUD se retira y solo queda el rótulo de fin abajo (vertical) o abajo a la derecha (horizontal)
  const finRects = [{ x: 0, y: 0, w: 0, h: 0, kind: 'done' }];
  /** Punto de la ruta en la maqueta (misma fórmula que reliefH en la cresta: h = R). */
  function modelAt(s, out) {
    const B = U.uBack.value;
    return out.set(bendAt(s) * 0.75, (prof.R(s) - BASE) * BACK_EXAG, -(s - B.z) * B.w);
  }
  function finaleTags(f) {
    const W = ctx.size.width;
    const H = ctx.size.height;
    const r = finRects[0];
    if (st.portrait) { r.x = 0; r.y = H * 0.83; r.w = W; r.h = H * 0.17; } else { r.x = W * 0.52; r.y = H * 0.72; r.w = W * 0.48; r.h = H * 0.28; }
    const k = smoothstep(0.35, 0.8, f.finale);
    const n = tlRaw.n;
    modelAt(prof.sb[0], markPos); markPos.y += 4;
    tagGhost.place(markPos, camera, ctx.size, finRects, f.dt, k, 4);
    modelAt(prof.sb[n], peakPos); peakPos.y += 4;
    tagMark.place(peakPos, camera, ctx.size, finRects, f.dt, k, 4);
  }

  /**
   * Corte limpio de realización (como el plano cenital de una retransmisión al cruzar la meta): sin giros de cámara
   * mientras el corredor sigue en la cinta (§15.1, comodidad). La maqueta comprime la clase a BACK_LEN u con relieve
   * exagerado: la ruta de luz de principio a fin en los colores de sus zonas, cada intervalo una cumbre.
   */
  function startFinale(f) {
    const n = tlRaw.n;
    const sEndClass = prof.sb[n];
    // la maqueta sigue más allá de la salida (sierras, sin ruta): su borde nunca entra en el encuadre
    const sStart = prof.sb[0];
    const c = Math.min(1, BACK_LEN / Math.max(200, sEndClass - sStart + 240));
    const s0 = sStart - 240 - 1700 / c;
    const s1 = sEndClass + 150 + 1400 / c;
    const rows = backMesh.geometry.userData.rows || 420;
    U.uBack.value.set(s0, (s1 - s0) / rows, sEndClass, c);
    U.uRoute.value.set(sStart - U.uAnchor.value, sEndClass - U.uAnchor.value);
    U.uBack2.value.set(BACK_EXAG, BASE, (sEndClass - sStart) * c, 0);
    U.uMoonDir.value.copy(MOON_FIN);
    st.fin = { t0: st.time, len: (sEndClass - sStart) * c, c, rm: f.reducedMotion };
    st.finK = 1;
    terrain.visible = false;
    backMesh.visible = true;
    ghostDot.visible = false;
    tagGhost.hide(); tagMark.hide(); tagPeak.hide();
    tagGhost.update('Salida', '', zoneHex[tlRaw.zones[0]]);
    tagMark.update('Meta', '', zoneHex[tlRaw.zones[n - 1]]);
    st.markKey = 0;
    st.ghostTxtAt = -1e9;
    U.uMisc.value.x = 1;
    U.uExag.value = 1;
    U.uFog.value.w = 0.8;
    finaleCamera(f);
    rig.snap();
  }

  function endFinale() {
    st.fin = null; // laboratorio: rebobinar
    st.finK = 0;
    terrain.visible = true;
    backMesh.visible = false;
    U.uMoonDir.value.copy(MOON_RUN);
    U.uMisc.value.x = 0;
    U.uFog.value.w = 0;
    rig.settle.position = 0.9; rig.settle.lookAt = 0.9;
    st.hudV = -1;
    rig.snap();
  }

  /**
   * Pose de la maqueta (meta en el origen, salida hacia +z a len u). Vertical: por encima y más allá de la meta,
   * mirando atrás a lo largo de la clase (la ruta sube por el encuadre de la meta, abajo, a la salida, arriba).
   * Horizontal: tres cuartos lateral (la clase cruza el encuadre en diagonal). Deriva lentísima (≤ 1,5°/s).
   */
  function finaleCamera(f) {
    const F = st.fin;
    const T = rig.target;
    const tF = Math.max(0, st.time - F.t0);
    const Lc = F.len;
    const drift = F.rm ? 0 : Math.min(tF, 30);
    const rise = 1 + 0.004 * drift;
    if (st.portrait) {
      const ang = 0.16 + 0.012 * drift;                       // rad: ~0,7°/s alrededor del centro de la ruta
      const cz = Lc * 0.42;
      const R = Lc * 0.92;
      T.position.set(Math.sin(ang) * R, Lc * 0.6 * rise, cz - Math.cos(ang) * R);
      T.lookAt.set(0, 0, cz);
      T.fov = 44;
      T.shift.set(0, 0.17);
    } else {
      const ang = 0.95 + 0.012 * drift;
      const cz = Lc * 0.5;
      const R = Lc * 0.78;
      T.position.set(Math.sin(ang) * R, Lc * 0.42 * rise, cz - Math.cos(ang) * R);
      T.lookAt.set(0, 0, cz);
      T.fov = 40;
      T.shift.set(-0.06, 0.2);
    }
    T.roll = 0;
    rig.settle.position = 1.2;
    rig.settle.lookAt = 1.2;
    rig.settle.fov = 1.2;
    rig.settle.shift = 1.2;
    rig.bobScale = 0;
  }

  return {
    update,

    resize({ aspect }) {
      const p = aspect < 0.9;
      const changed = p !== st.portrait;
      st.portrait = p;
      st.hudV = ctx.hud.version;
      frameCamera();
      if (changed) rig.snap();
    },

    event(type, data) {
      switch (type) {
        case 'gate': post.pulse(0.03, 1.4); break;             // exposición +3 %: sin destellos
        case 'km': case 'halfway': post.pulse(0.02, 1.2); break;
        case 'drop': st.dropAt = st.time; post.pulse(0.04, 2.2); break;
        case 'testEnd':
          st.testEndAt = st.time;
          st.ramp = { from: tl.visualSpeed(Math.max(0, st.lastKmh)), armedAt: st.time, t0: -1 };
          break;
        case 'seek':
          if (st.time - st.testEndAt < 4) st.floatPending = true;
          if (st.ramp && st.ramp.t0 < 0 && st.time - st.ramp.armedAt < 4) st.ramp.t0 = st.time; else st.sOff = 0;
          st.ghostD = 30;
          break;
        case 'finish': post.pulse(0.04, 2.5); break;
        case 'quality': setLod(Number(data?.level) || 0); break;
        default: break;
      }
    },

    /** Solo laboratorio: estado de los rótulos. */
    get _debug() { return { peak: tagPeak.alpha, mark: tagMark.alpha, ghost: tagGhost.alpha, peakU: st.peakU, lod: lodName, sig: st.lastS }; },

    dispose() {
      tagGhost.dispose(); tagMark.dispose(); tagPeak.dispose();
      for (const k of Object.keys(geos)) if (geos[k] !== terrain.geometry) geos[k].dispose();
      prof.dispose();
      // el resto (mallas en ctx.root, materiales, geometrías activas) lo libera el núcleo
    },
  };
}
