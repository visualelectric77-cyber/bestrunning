// BestRunning · guion del pack de voz grabado (ElevenLabs · Eva Dorado) y compositor de avisos.
// SIN DOM: lo usan tools/voice/generate-pack.mjs (para generar los clips) y coach.js (para encadenarlos).
//
// Cada clip es una unidad de entonación completa: una frase "portadora" que queda en suspenso
// ("¡Atención! Subimos a…") seguida de un número dicho con entonación propia ("Once coma cinco.").
// Así el encadenado suena a entrenador real y no a palabras pegadas.
import { numberWords } from './phrases.js';

export const PACK_ID = 'eva';
export const PACK_NAME = 'Eva Dorado · ElevenLabs';
export const PACK_SPEED_MIN = 6.0;
export const PACK_SPEED_MAX = 15.5;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const speedId = (v) => `s_${Math.round(v * 10)}`;

/* ───────────── Guion (pack esencial ≈ 4.400 caracteres) ───────────── */

const SPEEDS = [];
for (let t = Math.round(PACK_SPEED_MIN * 10); t <= Math.round(PACK_SPEED_MAX * 10); t++) {
  const v = t / 10;
  SPEEDS.push({ id: speedId(v), text: `${cap(numberWords(v))}.`, kind: 'number' });
}

const DURATIONS = [
  [30, 'Treinta segundos.'], [40, 'Cuarenta segundos.'], [45, 'Cuarenta y cinco segundos.'], [60, 'Un minuto.'],
  [75, 'Un minuto y cuarto.'], [90, 'Un minuto y medio.'], [120, 'Dos minutos.'], [150, 'Dos minutos y medio.'],
  [180, 'Tres minutos.'], [240, 'Cuatro minutos.'], [300, 'Cinco minutos.'], [360, 'Seis minutos.'],
  [420, 'Siete minutos.'], [480, 'Ocho minutos.'], [600, 'Diez minutos.'], [720, 'Doce minutos.'],
  [900, 'Quince minutos.'], [1200, 'Veinte minutos.'],
];

const ORDINAL_REP = ['', 'Primera serie.'];
const REPS = [{ id: 'rep_1', text: ORDINAL_REP[1] }];
for (let i = 2; i <= 12; i++) REPS.push({ id: `rep_${i}`, text: `Serie ${numberWords(i, 0)}.` });
REPS.push({ id: 'rep_last', text: '¡Última serie!' });

const KMS = [{ id: 'km_1', text: '¡Primer kilómetro!' }];
for (let k = 2; k <= 12; k++) KMS.push({ id: `km_${k}`, text: `¡Kilómetro ${numberWords(k, 0)}!` });

const STAGES = [];
for (let n = 1; n <= 16; n++) STAGES.push({ id: `stage_${n}`, text: `Escalón ${numberWords(n, 0)}.` });

/** Frases fijas, agrupadas por uso. La clave del grupo es el prefijo del id. */
const GROUPS = {
  // Portadoras en suspenso: siempre seguidas de un número de velocidad.
  up: ['¡Atención! Subimos a…', 'Prepárate, que subimos a…', 'Cambio: sube a…'],
  down: ['Atento, bajamos a…', 'Ahora vamos a bajar a…'],
  sprintpre: ['¡Prepárate para el sprint! A…'],
  recoverpre: ['Recuperación a la vista: bajamos a…'],
  set: ['Pon la cinta a…'],
  // Arranque de cada tramo, seguido de la velocidad (y la duración si encaja).
  now_sprint: ['¡Ahora! ¡Sprint!', '¡Vamos, a tope!'],
  now_fast: ['¡Ahora! Correr rápido.', '¡Vamos, ritmo rápido!'],
  now_run: ['¡Ahora! A correr.', 'Ritmo de carrera.'],
  now_jog: ['Trote. Recupera.', 'Ahora, trote suave.'],
  now_warmup: ['Seguimos calentando.'],
  now_cooldown: ['Vuelta a la calma.'],
  now_walk: ['Camina.'],
  // Progreso
  halfseg: ['Mitad del bloque. ¡Muy bien!', 'Ya llevas la mitad.'],
  last30: ['¡Últimos treinta segundos! ¡Aguanta!', '¡Treinta segundos y lo tienes!', '¡Venga, que ya queda poco!'],
  last10: ['¡Diez segundos!', '¡Diez segundos, a tope!'],
  halfworkout: ['¡Mitad del entrenamiento! Lo estás haciendo genial.', 'Ecuador de la sesión. ¡Seguimos!'],
  lastblock: ['¡Último bloque! Vamos a por él.', 'Recta final, ¡dalo todo!'],
  cooldownstart: ['¡Buen trabajo! Empezamos la vuelta a la calma.'],
  countdown: ['Tres, dos, uno… ¡vamos!'],
  // Inicio por categoría de clase
  intro_intervals: ['¡Vamos allá! Hoy toca intervalos: series cortas y potentes.'],
  intro_tempo: ['Hoy toca tempo: ritmo alegre y constante. ¡A por ello!'],
  intro_endurance: ['Sesión de resistencia. Paciencia, buen ritmo y a disfrutar.'],
  intro_fartlek: ['¡Hoy toca fartlek! Cambios de ritmo para no aburrirse.'],
  intro_recovery: ['Sesión suave de recuperación. Hoy se corre con calma.'],
  intro_challenge: ['¡Hoy hay reto! Prepárate para darlo todo.'],
  intro_hills: ['¡Hoy toca cuestas! Piernas fuertes y zancada corta.'],
  intro_test: ['Hoy toca test. Escalones de un minuto hasta donde llegues.'],
  watch: ['Recuerda iniciar Cinta de correr en tu reloj.'],
  // Final y estados
  finish: ['¡Entrenamiento completado! Enhorabuena, gran trabajo.', '¡Terminado! Hoy has sumado un poquito más.', '¡Lo has conseguido! Estira un poco y bebe agua.'],
  // final de una sesión que NO se completó (terminada antes o con tramos saltados): nunca «completado»
  finishpartial: ['¡Buen trabajo! Hoy también suma.', 'Sesión terminada. Lo que has hecho hoy cuenta.'],
  pause: ['Pausa. Tómate un respiro.'],
  resume: ['¡Seguimos!', 'Volvemos. ¡Vamos!'],
  // Motivación y técnica
  hard: ['¡Vamos, vamos, vamos!', '¡Esto es lo que te hace más fuerte!', '¡Aprieta, que tú puedes!', '¡No te rindas ahora!', '¡Brazos fuertes, zancada rápida!'],
  good: ['¡Muy bien, sigue así!', 'Vas genial. Mantén este ritmo.', 'Cada sesión cuenta. ¡Hoy también!'],
  form: ['Relaja los hombros y abre el pecho.', 'Pisa suave, debajo de tu cuerpo.', 'Mirada al frente, cuerpo alto.', 'Brazos a noventa grados, de atrás hacia delante.'],
  breath: ['Respira profundo y suelta el aire despacio.', 'Encuentra un ritmo de respiración cómodo.'],
  mind: ['Piensa solo en este bloque. Nada más.', 'Sonríe, que corres mejor.'],
  hydration: ['Buen momento para un trago de agua.'],
  recover: ['Recupera. Respira y prepárate para el siguiente.'],
  // Test VAM
  testprompt: ['Cuando no puedas más, pulsa No puedo más.'],
  testend: ['¡Test terminado! Increíble esfuerzo.'],
  // Comentarios sobre la música (sincronizados con el motor DJ)
  music: ['¡Ahí viene el drop!', '¡Siente el bajo!', '¡Al ritmo del bombo!', 'Pisa al ritmo de la música.', '¡Qué temazo! ¡Vamos!', 'Deja que la música te lleve.'],
};

/** Ids de los comentarios de música por intención (el coach elige según el momento). */
export const MUSIC_CUES = {
  drop: ['music_1'],                       // justo antes de que entre un drop
  energy: ['music_2', 'music_3', 'music_5'], // tramo intenso con la música arriba
  flow: ['music_4', 'music_6'],            // tramos largos/estables
};

/** Portadoras: conservar un poco de cola al recortar para que la pausa antes del número suene natural. */
const SUSPENDED = new Set(['up', 'down', 'sprintpre', 'recoverpre', 'set']);

function buildScript() {
  const out = [];
  for (const [g, list] of Object.entries(GROUPS)) {
    list.forEach((text, i) => out.push({ id: `${g}_${i + 1}`, text, kind: SUSPENDED.has(g) ? 'carrier' : 'phrase' }));
  }
  out.push(...SPEEDS);
  for (const [sec, text] of DURATIONS) out.push({ id: `dur_${sec}`, text, kind: 'phrase' });
  out.push(...REPS.map((r) => ({ ...r, kind: 'phrase' })));
  out.push(...KMS.map((r) => ({ ...r, kind: 'phrase' })));
  out.push(...STAGES.map((r) => ({ ...r, kind: 'phrase' })));
  return out;
}

/** Lista completa de clips del pack: [{ id, text, kind: 'carrier'|'number'|'phrase' }]. */
export const PACK_SCRIPT = buildScript();
export const PACK_CHARS = PACK_SCRIPT.reduce((a, c) => a + c.text.length, 0);

/* ───────────── Compositor ───────────── */

const has = (ids, avail) => ids.every((id) => !avail || avail.has(id));
const groupIds = (g) => (GROUPS[g] || []).map((_, i) => `${g}_${i + 1}`);

/** Clip de velocidad (null si está fuera del rango grabado). */
export function speedClip(v) {
  if (v == null || !isFinite(v)) return null;
  const r = Math.round(v * 10) / 10;
  if (r < PACK_SPEED_MIN - 1e-9 || r > PACK_SPEED_MAX + 1e-9) return null;
  return speedId(r);
}

/** Clip de duración si la duración del tramo coincide (±6 % o ±4 s) con una grabada. */
export function durationClip(sec) {
  let best = null;
  let bestD = Infinity;
  for (const [s] of DURATIONS) {
    const d = Math.abs(s - sec);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best != null && (bestD <= 4 || bestD / best <= 0.06) ? `dur_${best}` : null;
}

const ZONE_GROUP = { sprint: 'now_sprint', fast: 'now_fast', run: 'now_run', jog: 'now_jog', warmup: 'now_warmup', cooldown: 'now_cooldown', walk: 'now_walk' };

/**
 * Grupos de respaldo con el mismo sentido: si el pack no trae ninguna variante del grupo elegido, se usa otra
 * frase grabada equivalente antes que caer a la voz del sistema (nunca se mezcla Eva con el TTS en una sesión).
 */
const FALLBACK_GROUPS = {
  recoverpre: ['down'],          // «Recuperación a la vista: bajamos a…» → «Atento, bajamos a…»
  sprintpre: ['up'],             // «¡Prepárate para el sprint! A…» → «¡Atención! Subimos a…»
  last30: ['last10'],
  halfworkout: ['halfseg'],
  lastblock: ['hard'],
  recover: ['breath'],
  mind: ['form'],
  breath: ['form'],
};

/**
 * Devuelve la secuencia de ids de clip para un aviso, o null si no se puede componer con el pack
 * (el coach usará entonces la voz del sistema para ESE aviso).
 * `pick(list)` elige una variante (determinista si el llamador pasa un rng).
 */
export function composeCue(kind, vars = {}, { pick = (l) => l[0], available = null } = {}) {
  let seq = null;
  const chooseIn = (g) => {
    const ids = groupIds(g).filter((id) => !available || available.has(id));
    return ids.length ? pick(ids) : null;
  };
  // cualquier variante disponible del grupo y, si no hay ninguna, la de su grupo equivalente
  const choose = (g) => {
    const id = chooseIn(g);
    if (id) return id;
    for (const alt of FALLBACK_GROUPS[g] || []) {
      const a = chooseIn(alt);
      if (a) return a;
    }
    return null;
  };
  switch (kind) {
    case 'intro': {
      const s = speedClip(vars.speed);
      const intro = choose(`intro_${vars.category}`) || null;
      const set = choose('set');
      if (!s || !set) return null;
      seq = [...(vars.watch ? [choose('watch')] : []), ...(intro ? [intro] : []), set, s];
      break;
    }
    case 'pre': {
      const s = speedClip(vars.speed);
      if (!s) return null;
      let g = vars.dir === 'down' ? 'down' : 'up';
      if (vars.zone === 'sprint') g = 'sprintpre';
      else if (vars.dir === 'down' && vars.zone === 'jog' && vars.fromHard) g = vars.variant % 2 ? 'recoverpre' : 'down';
      const carrier = choose(g);
      if (!carrier) return null;
      const rep = vars.rep ? (vars.rep.i === vars.rep.n && vars.rep.n > 1 ? 'rep_last' : `rep_${vars.rep.i}`) : null;
      seq = [...(rep && (!available || available.has(rep)) ? [rep] : []), carrier, s];
      break;
    }
    case 'now': {
      const z = choose(ZONE_GROUP[vars.zone] || 'now_run');
      const s = speedClip(vars.speed);
      if (!z || !s) return null;
      const d = vars.sec ? durationClip(vars.sec) : null;
      seq = [z, s, ...(d && (!available || available.has(d)) ? [d] : [])];
      break;
    }
    case 'testStage': {
      const st = vars.stage >= 1 && vars.stage <= 16 ? `stage_${vars.stage}` : null;
      const s = speedClip(vars.speed);
      if (!s) return null;
      if (st && (!available || available.has(st))) seq = [st, s];
      else {
        // escalón sin grabar (13–16 o más): «Cambio: sube a… catorce coma cinco.» con la misma voz
        const ups = groupIds('up').filter((id) => !available || available.has(id));
        const carrier = ups.includes('up_3') ? 'up_3' : ups.length ? pick(ups) : null;
        if (!carrier) return null;
        seq = [carrier, s];
      }
      break;
    }
    case 'km': {
      const id = vars.km >= 1 && vars.km <= 12 ? `km_${Math.round(vars.km)}` : null;
      if (!id) return null;
      seq = [id];
      break;
    }
    case 'tip': seq = [choose(vars.topic === 'breath' ? 'breath' : vars.topic === 'mind' ? 'mind' : 'form')]; break;
    case 'motivation': seq = [choose(vars.hard ? 'hard' : 'good')]; break;
    case 'halfSegment': seq = [choose('halfseg')]; break;
    case 'last30': seq = [choose('last30')]; break;
    case 'last10': seq = [choose('last10')]; break;
    case 'halfWorkout': seq = [choose('halfworkout')]; break;
    case 'lastBlock': seq = [choose('lastblock')]; break;
    case 'cooldown': seq = [choose('cooldownstart')]; break;
    case 'countdown': seq = [choose('countdown')]; break;
    case 'finish': seq = [choose('finish')]; break;
    case 'finishPartial': {
      // sin la frase propia grabada, solo «¡Terminado! Hoy has sumado un poquito más.» (finish_2) vale para una
      // sesión incompleta; si tampoco está, null ⇒ el coach calla antes que decir «¡Entrenamiento completado!»
      const own = chooseIn('finishpartial');
      seq = [own || (!available || available.has('finish_2') ? 'finish_2' : null)];
      break;
    }
    case 'pause': seq = [choose('pause')]; break;
    case 'resume': seq = [choose('resume')]; break;
    case 'hydration': seq = [choose('hydration')]; break;
    case 'recover': seq = [choose('recover')]; break;
    case 'testPrompt': seq = [choose('testprompt')]; break;
    case 'testEnd': seq = [choose('testend')]; break;
    case 'watch': seq = [choose('watch')]; break;
    case 'music': {
      // vars.mood: 'drop' | 'energy' | 'flow'
      const ids = (MUSIC_CUES[vars.mood] || MUSIC_CUES.energy).filter((id) => !available || available.has(id));
      seq = ids.length ? [pick(ids)] : null;
      break;
    }
    default: return null;
  }
  if (!seq || seq.some((x) => !x)) return null;
  return has(seq, available) ? seq : null;
}

/** Texto equivalente de una secuencia (para subtítulos y para el modo sin pack). */
export function clipsText(ids) {
  const byId = new Map(PACK_SCRIPT.map((c) => [c.id, c.text]));
  return ids.map((id) => byId.get(id) || '').join(' ').replace(/…\s+/g, ' ').trim();
}
