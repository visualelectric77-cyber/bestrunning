// BestRunning · escena 3D · postproceso SOBRIO (SPEC §15.1, §15.3). Escena en HDR lineal (half float, sin MSAA: ver
// QUALITY en scene3d.js) → bloom pequeño SOLO de lo emisivo (umbral ≥ 0,85, intensidad ≤ 0,6, radio pequeño, a
// resolución reducida) → pase final: saturación, viñeta sutil, tone mapping ACES/AgX (exposición ≤ 1,0), sRGB y
// tramado de 1/255 contra las bandas de los degradados oscuros.
// PROHIBIDO aquí (§15.2, §15.3): máscaras o desenfoques por zonas (nada de recortar el fondo detrás del HUD),
// destellos de pantalla, aberración cromática, rayos, líneas de warp. Los límites se imponen al fijar los parámetros:
// ningún escenario puede saltárselos.
import { EffectComposer } from '../../vendor/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from '../../vendor/three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../../vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { clamp } from './util.js';

/** Límites duros de la dirección de arte (§15.1). */
export const POST_LIMITS = Object.freeze({
  exposure: [0.35, 1.0], bloomStrength: [0, 0.6], bloomThreshold: [0.85, 4], bloomRadius: [0, 0.45],
  vignette: [0, 0.45], saturation: [0, 1.15], pulse: 0.1,
});

export const POST_DEFAULTS = Object.freeze({
  toneMapping: 'aces', exposure: 0.9, bloomStrength: 0.32, bloomThreshold: 0.9, bloomRadius: 0.18, vignette: 0.22,
  saturation: 1,
});

const TM_KEYS = ['aces', 'agx', 'neutral'];
const NUM_KEYS = ['exposure', 'bloomStrength', 'bloomThreshold', 'bloomRadius', 'vignette', 'saturation'];

/** Copia en `dst` los ajustes válidos de `o`, siempre dentro de POST_LIMITS. Devuelve dst. */
export function sanitizePost(dst, o) {
  if (!o || typeof o !== 'object') return dst;
  if (typeof o.toneMapping === 'string' && TM_KEYS.includes(o.toneMapping)) dst.toneMapping = o.toneMapping;
  for (const k of NUM_KEYS) {
    const v = Number(o[k]);
    if (Number.isFinite(v)) dst[k] = clamp(v, POST_LIMITS[k][0], POST_LIMITS[k][1]);
  }
  return dst;
}

const FINAL = {
  name: 'SoberFinal',
  uniforms: {
    tDiffuse: { value: null },
    uVig: { value: 0.22 },
    uSat: { value: 1 },
    uAspect: { value: 1 },
    uSeed: { value: 0 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uVig, uSat, uAspect, uSeed;
varying vec2 vUv;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 col = clamp(texture2D(tDiffuse, vUv).rgb, 0.0, 64.0);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, uSat), 0.0);
  // viñeta sutil y redonda respecto al lado corto (no es una máscara: es la caída óptica de una lente)
  vec2 q = (vUv - 0.5) * vec2(max(uAspect, 1.0), max(1.0 / uAspect, 1.0)) * 2.0;
  float r = length(q) / 1.414;
  col *= 1.0 - uVig * smoothstep(0.35, 1.05, r);
#ifdef TONE_MAPPING
  col = toneMapping(col);
#endif
  gl_FragColor = linearToOutputTexel(vec4(col, 1.0));
  gl_FragColor.rgb += (hash12(gl_FragCoord.xy + uSeed) - 0.5) / 255.0;
}`,
};

export function createPost(THREE, renderer, scene, camera) {
  const cur = { ...POST_DEFAULTS };
  let pulse = 0;       // variación de exposición de los "momentos" (≤ 10 %)
  let pulseDecay = 1.5;
  let composer = null;
  let bloom = null;
  let final = null;
  let bloomScale = 0.5;
  let bloomOn = true;
  let samples = 0;
  let w = 1;
  let h = 1;
  let dpr = 1;
  let seed = 0;

  const TM = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping };

  function build() {
    composer = new EffectComposer(renderer);
    composer.renderTarget2.samples = samples;
    composer.setPixelRatio(dpr);
    const rp = new RenderPass(scene, camera);
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), cur.bloomStrength, cur.bloomRadius, cur.bloomThreshold);
    const origSetSize = bloom.setSize.bind(bloom);
    bloom.setSize = (bw, bh) => origSetSize(Math.max(32, Math.round(bw * bloomScale)), Math.max(32, Math.round(bh * bloomScale)));
    bloom.enabled = bloomOn;
    // red de seguridad: un valor desorbitado (Inf de un escenario) no puede inundar la pantalla a través del bloom
    try {
      const hp = bloom.materialHighPassFilter;
      hp.fragmentShader = hp.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = min( texture2D( tDiffuse, vUv ), vec4( 32.0 ) );');
      hp.needsUpdate = true;
    } catch { /* opcional */ }
    final = new ShaderPass(FINAL);
    // último pase a pantalla sin intercambio: el segundo búfer del composer nunca llega a reservarse en la GPU
    final.needsSwap = false;
    composer.addPass(rp);
    composer.addPass(bloom);
    composer.addPass(final);
    composer.setSize(w, h);
  }

  function teardown() {
    if (!composer) return;
    for (const p of composer.passes) p.dispose?.();
    composer.renderTarget1.dispose();
    composer.renderTarget2.dispose();
    composer.dispose();
    composer = null;
    bloom = null;
    final = null;
  }

  const api = {
    /** Parámetros vigentes (solo lectura; usar set()). */
    get settings() { return cur; },
    get built() { return !!composer; },
    get target() { return composer ? composer.readBuffer : null; },
    /**
     * Ajustes del escenario, SIEMPRE dentro de POST_LIMITS: { toneMapping: 'aces'|'agx'|'neutral', exposure,
     * bloomStrength, bloomThreshold, bloomRadius, vignette, saturation }. Las claves que faltan no cambian.
     */
    set(o = {}) { return sanitizePost(cur, o); },
    reset() { Object.assign(cur, POST_DEFAULTS); pulse = 0; },
    /** Variación breve de exposición para un momento (|amount| ≤ 0,1; decae sola en ~decay s). Sin destellos. */
    pulse(amount, decay = 1.5) {
      const a = clamp(Number(amount) || 0, -POST_LIMITS.pulse, POST_LIMITS.pulse);
      if (Math.abs(a) > Math.abs(pulse)) pulse = a;
      pulseDecay = clamp(Number(decay) || 1.5, 0.3, 6);
    },
    /** on = bloom; scale = resolución relativa del bloom; msaa = muestras del destino de la escena (0 o 4). */
    configure(on, scale, msaa = 0) {
      const s = msaa | 0;
      const rebuild = !composer || s !== samples;
      bloomScale = scale || bloomScale;
      bloomOn = !!on;
      samples = s;
      if (rebuild) { teardown(); build(); } else {
        bloom.enabled = bloomOn;
        bloom.setSize(w * dpr, h * dpr);
      }
    },
    /** Libera los render targets (pausa larga en segundo plano); configure() los recrea. */
    release() { teardown(); },
    /** Tras recuperar un contexto WebGL perdido: suelta las referencias sin borrar objetos del contexto viejo. */
    forget() { composer = null; bloom = null; final = null; },
    setSize(cw, ch, pr) {
      w = cw; h = ch; dpr = pr;
      if (composer) { composer.setPixelRatio(pr); composer.setSize(cw, ch); }
    },
    /** dt (s) · extra = { desat (0..1, pausa), exposureMul } */
    render(dt, desat = 0, exposureMul = 1) {
      pulse *= Math.exp(-dt * (3 / pulseDecay));
      if (Math.abs(pulse) < 1e-4) pulse = 0;
      const tm = TM[cur.toneMapping] ?? THREE.ACESFilmicToneMapping;
      if (renderer.toneMapping !== tm) renderer.toneMapping = tm;
      renderer.toneMappingExposure = Math.min(POST_LIMITS.exposure[1], cur.exposure * (1 + pulse) * exposureMul);
      if (!composer) { renderer.render(scene, camera); return; }
      bloom.strength = cur.bloomStrength;
      bloom.radius = cur.bloomRadius;
      bloom.threshold = cur.bloomThreshold;
      bloom.enabled = bloomOn && cur.bloomStrength > 0.001;
      const u = final.uniforms;
      u.uVig.value = cur.vignette;
      u.uSat.value = cur.saturation * (1 - 0.35 * clamp(desat, 0, 1));
      u.uAspect.value = w / Math.max(1, h);
      seed = (seed + 17.17) % 1000;
      u.uSeed.value = seed;
      composer.render(dt);
    },
    dispose() { teardown(); },
  };
  return api;
}
