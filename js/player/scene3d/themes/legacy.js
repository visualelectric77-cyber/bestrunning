// BestRunning · escenario 'legacy' — HYPERTRACK v1 (autopista de neón), conservado OCULTO para no romper nada (§15.2).
// Es la escena original portada a la interfaz de escenarios y DESPOJADA de lo que §15 prohíbe: sin destellos de
// pantalla, explosiones, confeti, ondas expansivas, warp, temblores, aberración cromática, rayos ni máscaras del HUD.
// Conserva: cielo por zona con sol retro, rejilla de carriles al ritmo, skyline de la clase (vúmetro con el espectro),
// puertas que se cruzan en el segundo del cambio (el aro es su cuenta atrás), túnel de progreso en tramos intensos,
// carteles KM/MITAD/META, clima por zona, fantasma holográfico, pista dorada de récord, escalera del test VAM y plano de
// dron final (sin fuegos). Módulos en ./legacy/.
import { buildMoods, Mood, ZONE_RANK } from './legacy/moods.js';
import { createSky } from './legacy/sky.js';
import { createTrack, STEP_H } from './legacy/track.js';
import { createSkyline } from './legacy/skyline.js';
import { createGates, createSigns } from './legacy/gates.js';
import { createParticles } from './legacy/particles.js';
import { createGhost } from './legacy/ghost.js';

export const meta = {
  id: 'legacy',
  name: 'Hypertrack v1',
  description: 'Autopista de neón original (oculta).',
};

const CAM_H = 2.1;

export function createTheme(ctx) {
  const { THREE, root, camera, rig, post, tl, util } = ctx;
  const { clamp, clamp01, damp, lerp, easeOutQuart, easeInOutSine } = util;

  camera.near = 0.5;
  camera.far = 7000;
  const moods = buildMoods(THREE);
  const mood = new Mood(THREE).copy(moods[tl.zones[0]] || moods.jog);
  const viewMood = new Mood(THREE).copy(mood);
  const finaleMood = new Mood(THREE).copy(moods.cooldown);
  finaleMood.stars = 1;
  finaleMood.ridge = 1.3;

  const shared = { uSpec: { value: ctx.spectrumTexture } };
  const sky = createSky(THREE, camera);
  const track = createTrack(THREE);
  const skyline = createSkyline(THREE, tl, shared);
  track.initTimeline(tl);
  const gates = createGates(THREE, tl);
  const signs = createSigns(THREE, tl);
  const particles = createParticles(THREE, { quality: ctx.qualityLevel, seed: tl.n * 31 + 7 });
  const ghost = createGhost(THREE);
  root.add(sky.object, track.object, skyline.object, gates.object, signs.object, particles.object, ghost.object);

  post.set({ toneMapping: 'aces', exposure: 0.95, bloomStrength: 0.5, bloomThreshold: 0.86, bloomRadius: 0.24, vignette: 0.3 });

  const gold1 = new THREE.Color('#ffd60a');
  const gold2 = new THREE.Color('#ff9f0a');
  const white = new THREE.Color(1, 1, 1);
  const weather = { rain: 0, snow: 0, fly: 0 };
  const boss = { amt: 0, prog: 0, hot: 0, burst: -1 };
  const vanish = new THREE.Vector2(0.5, 0.43);
  const finaleVanish = new THREE.Vector2(0.5, 0.66);
  const firstStageIdx = Array.prototype.findIndex.call(tl.stage, (s) => s > 0);
  const firstStageT = firstStageIdx >= 0 ? tl.starts[firstStageIdx] : Infinity;
  let bossSeg = -1;
  let stairY = 0;
  let stairAmt = 0;
  let stairSink = 0;
  let testEnded = false;
  let halfDone = false;
  let finaleStart = -1;
  let aspect = 1;
  let wt = 0;
  let layoutVersion = -1;

  // Contexto por fotograma para los módulos v1 (mismo contrato que tenían con el núcleo antiguo)
  const F = {
    dt: 0, time: 0, now: 0, wt: 0, localT: 0, sNow: 0, camS: 0, segIndex: 0, mood: viewMood, beat: 0, beatPhase: 0, breath: 0,
    flash: 0, finale: 0, waveT: -1e4, reduced: false, stairAmt: 0, stairSink: 0, stairRise: 0, stairK: 0.22, warp: 0, charge: 0,
    speedN: 0, motion: 1, pxScale: 600, camPos: camera.position, fogMul: 1, quality: 3, intro: 0, skyT: 0, running: false,
    showGates: true, showSigns: true, kmNext: 1, distOffset: 0, halfDone: false, tl, aspect: 1, timeScale: 0, gold: 0, bass: 0,
    mid: 0, high: 0, weather, boss, stepEnv: 0, stepLock: 0, ripple: 1, launch: -1, white, labelBox: null, viewW: 1, viewH: 1,
    tlSmooth: false, timeForKm: ctx.timeForKm,
  };

  function syncLayout(H, W) {
    const hud = ctx.hud;
    if (hud.version === layoutVersion) return;
    layoutVersion = hud.version;
    // punto de fuga en el hueco libre (vertical: banda entre el número y el rótulo inferior; horizontal: mitad derecha)
    if (hud.portrait && hud.speed) {
      // horizonte justo bajo el bloque de velocidad: la acción vive en la ventana entre el número y el rótulo inferior
      vanish.set(0.5, clamp(1 - ((hud.speed.y + hud.speed.h) / H + 0.12), 0.3, 0.6));
    } else if (hud.portrait && hud.band) {
      vanish.set(0.5, clamp(1 - (hud.band.y + hud.band.h * 0.5) / H, 0.3, 0.6));
    } else if (!hud.portrait && hud.free && hud.free.w > W * 0.25) {
      vanish.set(clamp((hud.free.x + hud.free.w * 0.5) / W, 0.3, 0.72), clamp(1 - (hud.free.y + hud.free.h * 0.5) / H, 0.35, 0.6));
    } else vanish.set(0.5, hud.portrait ? 0.45 : 0.48);
  }

  const onSign = (kind) => { if (kind === 'half') halfDone = true; };

  function baseFov(tv) {
    if (aspect < 0.85) return lerp(80, 70, clamp01((aspect - 0.45) / 0.4)) + (tv ? 4 : 0);
    if (aspect > 1.25) return 50 + (tv ? 4 : 0);
    return 64 + (tv ? 4 : 0);
  }

  return {
    resize(s) {
      aspect = s.aspect;
      F.viewW = s.width;
      F.viewH = s.height;
      layoutVersion = -1;
    },

    update(f) {
      const dt = f.dt;
      const reduced = f.reducedMotion;
      wt += dt * (0.25 + 0.75 * f.timeScale);
      syncLayout(f.height, f.width);
      const seg = f.segIndex;
      const zone = f.zone;

      // Mood: transición suave entre zonas (sin golpes de HYPERDRIVE)
      const charge = f.nextZone && (ZONE_RANK[f.nextZone] ?? 0) > (ZONE_RANK[zone] ?? 0) && f.running ? f.approach : 0;
      const target = f.finale > 0 ? finaleMood : moods[zone] || moods.jog;
      mood.approach(target, 1 - Math.exp(-(f.finale > 0 ? 0.5 : 0.9) * dt));
      viewMood.copy(mood);
      if (f.record.amount > 0.002) {
        viewMood.accent.lerp(gold1, f.record.amount * 0.8);
        viewMood.accent2.lerp(gold2, f.record.amount * 0.6);
      }

      // Test VAM: escalera
      const stage = f.stage;
      if (tl.isTest) {
        const near = f.t > firstStageT - 25;
        const on = near && !testEnded && (stage > 0 || f.t < firstStageT);
        stairAmt = damp(stairAmt, testEnded ? 0 : on ? 1 : 0, testEnded ? 0.9 : 1.2, dt);
        stairY = damp(stairY, testEnded ? 0 : stage * STEP_H, testEnded ? 0.5 : 2.4, dt);
        if (testEnded) stairSink = Math.min(14, stairSink + dt * 2.6);
      }

      // Clima por zona (§14.1-5)
      const recovery = (zone === 'jog' || zone === 'walk') && seg > 0 && (ZONE_RANK[tl.zones[seg - 1]] ?? 0) > (ZONE_RANK[zone] ?? 0);
      const fin = f.finale > 0;
      weather.rain = damp(weather.rain, !fin && zone === 'sprint' ? (reduced ? 0.2 : 0.4) : 0, 0.9, dt);
      weather.snow = damp(weather.snow, fin || zone === 'cooldown' ? 0.6 : 0, 0.7, dt);
      weather.fly = damp(weather.fly, !fin && (recovery || zone === 'walk') ? 0.45 : 0, 0.7, dt);

      // Túnel de progreso en los tramos intensos (§14.1-6), sin estallido
      const isBoss = f.running && !fin && (ZONE_RANK[zone] ?? 0) >= 4 && tl.secs[seg] >= 20 && !(tl.stage[seg] > 0);
      if (isBoss) bossSeg = seg;
      if (bossSeg === seg && isBoss) {
        boss.prog = f.segProgress;
        boss.hot = clamp01(1 - f.segRemaining / 10);
      }
      boss.amt = damp(boss.amt, bossSeg === seg && isBoss ? 1 : 0, 1.6, dt);
      boss.burst = -1;

      // Final: plano de dron
      if (fin && finaleStart < 0) finaleStart = f.time;
      if (!fin) finaleStart = -1;
      const droneP = fin ? f.finale : 0;

      // Contexto para los módulos
      F.dt = dt;
      F.time = f.time;
      F.now = f.time * 1000;
      F.wt = wt;
      F.localT = f.t;
      F.sNow = f.S;
      F.camS = f.S;
      F.segIndex = seg;
      F.beat = f.spectrum.live ? Math.max(f.beat * 0.5, clamp01((f.spectrum.bass - 0.35) * 1.6)) : f.beat;
      F.beatPhase = f.beatPhase;
      F.breath = f.breath;
      F.finale = fin ? Math.min(1, (f.time - finaleStart) * 0.8) : 0;
      F.waveT = fin ? -60 + clamp01((f.time - finaleStart - 0.9) / 3) * (tl.totalSec + 120) : -1e4;
      F.reduced = reduced;
      F.stairAmt = stairAmt;
      F.stairSink = stairSink;
      F.stairRise = stairY;
      F.stairK = track.stairK(aspect);
      F.charge = charge;
      F.speedN = clamp01((f.visualSpeed - 4) / 30);
      F.motion = fin ? 1 - util.easeOutCubic(droneP) : 1;
      F.pxScale = (f.height * f.dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360));
      F.fogMul = fin ? lerp(1, 0.18, easeOutQuart(droneP)) : 1;
      F.quality = f.qualityLevel;
      F.intro = f.intro;
      F.skyT = f.t;
      F.running = f.running;
      F.timeScale = f.timeScale;
      F.showGates = !fin;
      F.showSigns = !fin;
      F.kmNext = f.kmNext;
      F.halfDone = halfDone || f.t > tl.totalSec / 2 + 1;
      F.aspect = aspect;
      F.gold = f.record.amount;
      F.bass = f.spectrum.bass;
      F.mid = f.spectrum.mid;
      F.high = f.spectrum.high;

      sky.update(F);
      track.update(F);
      skyline.update(F);
      gates.update(F);
      const cands = signs.plan(F);
      for (const c of cands) {
        c.merged = false;
        if (!Number.isFinite(c.T) || c.kind === 'meta') continue;
        const i = tl.segAt(c.T);
        const a = i > 0 ? Math.abs(c.T - tl.starts[i]) : Infinity;
        const b = i + 1 < tl.n ? Math.abs(c.T - tl.starts[i + 1]) : Infinity;
        c.merged = Math.min(a, b) < 4;
      }
      signs.update(F, onSign);
      particles.update(F);
      ghost.update(F, f.ghost.deltaM, f.ghost.speed, f.ghost.active && !fin && f.t > 2, tl.isTest ? stairY : 0);

      // Cámara (rig del núcleo): altura del ojo, FOV por zona (moderado) y punto de fuga en el hueco libre
      const T = rig.target;
      const fov = baseFov(f.tvMode) + mood.fov * (reduced ? 0.15 : 0.35);
      if (fin) {
        const L = skyline.length;
        const portrait = aspect < 0.85;
        const theta = (portrait ? Math.PI + 0.22 : Math.PI + 1.05) + (f.time - finaleStart) * (reduced ? 0.02 : 0.045);
        const cz = (f.t - tl.totalSec * (portrait ? 0.58 : 0.5)) * skyline.K;
        const e = easeOutQuart(droneP);
        // el muelle crítico del rig hace la grúa desde la pose de carrera hasta la órbita alta
        rig.settle.position = 3.2;
        rig.settle.lookAt = 2.8;
        T.position.set(Math.sin(theta) * L * 0.5, L * (portrait ? 0.2 : 0.17), cz + Math.cos(theta) * L * 0.5);
        T.lookAt.set(0, 0, cz + (portrait ? L * 0.05 : 0));
        T.fov = lerp(fov, portrait ? 64 : 44, e);
        T.shift.set(lerp(vanish.x, finaleVanish.x, e) * 2 - 1, lerp(vanish.y, finaleVanish.y, e) * 2 - 1);
      } else {
        rig.settle.position = 0.5;
        rig.settle.lookAt = 0.5;
        const camY = CAM_H + stairY + (f.tvMode ? 0.7 : 0);
        const pitch = -0.012 + (f.tvMode ? -0.03 : 0) + stairAmt * 0.07;
        T.position.set(0, camY, 0);
        T.lookAt.set(0, camY + Math.tan(pitch) * 100, -100);
        T.fov = fov;
        T.shift.set(vanish.x * 2 - 1, (vanish.y - stairAmt * 0.04) * 2 - 1);
      }
      post.set({ bloomStrength: Math.min(0.6, 0.4 * mood.bloom), vignette: 0.3 + charge * 0.06 });
    },

    event(type) {
      if (type === 'testEnd' && !testEnded) {
        testEnded = true;
        track.freezeStairs(F.localT, F.time);
      } else if (type === 'gate') post.pulse(0.05, 1.2);
      else if (type === 'quality') particles.setQuality(ctx.qualityLevel);
      else if (type === 'seek') { halfDone = false; rig.snap(); }
    },

    dispose() {
      sky.dispose();
      track.dispose();
      skyline.dispose();
      gates.dispose();
      signs.dispose();
      particles.dispose();
      ghost.dispose();
    },
  };
}
