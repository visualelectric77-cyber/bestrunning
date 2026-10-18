// BestRunning · catálogo de clases (sin DOM, importable desde Node).
// Cada plantilla construye sus segmentos con build(ctx). Un marco común añade el calentamiento progresivo y la
// vuelta a la calma, ajusta el bloque principal al segundo exacto y limita el sprint al 25 % del bloque principal.
// Las plantillas NO dependen de weekInCycle/cycleIndex (el id de clase no los incluye): solo de minutos, niveles,
// carga, inclinación y la semilla.
import { round1, roundTo, clamp } from '../core/utils.js';
import { ZONES, LEVEL_KEYS, speedForZone, zoneForSpeed, clampSpeed, vamFromLevels } from './levels.js';

export const CATEGORIES = {
  intervals: { key: 'intervals', name: 'Intervalos', color: '#FF375F', icon: 'bolt',
    description: 'Series cortas y potentes para subir tu techo de velocidad y tu VO₂máx.' },
  tempo: { key: 'tempo', name: 'Tempo', color: '#FF9F0A', icon: 'flame',
    description: 'Ritmos cómodamente duros que empujan tu umbral hacia arriba.' },
  endurance: { key: 'endurance', name: 'Resistencia', color: '#30D158', icon: 'route',
    description: 'Minutos de calidad para construir el motor aeróbico y aguantar más.' },
  fartlek: { key: 'fartlek', name: 'Fartlek', color: '#BF5AF2', icon: 'shuffle',
    description: 'Juego de velocidades: cambios variados para que la cinta nunca sea monótona.' },
  hills: { key: 'hills', name: 'Cuestas', color: '#C79A6B', icon: 'mountain',
    description: 'Inclinación para ganar fuerza y potencia sin castigar las articulaciones.' },
  recovery: { key: 'recovery', name: 'Recuperación', color: '#64D2FF', icon: 'leaf',
    description: 'Sesiones suaves para asimilar el trabajo y volver más fuerte.' },
  challenge: { key: 'challenge', name: 'Retos', color: '#FFD60A', icon: 'trophy',
    description: 'Pruebas para medirte y celebrar todo lo que has avanzado.' },
  test: { key: 'test', name: 'Test', color: '#7D7AFF', icon: 'gauge',
    description: 'Test escalonado para medir tu VAM y recalcular tus velocidades.' },
};

/* ───────────── Herramientas de construcción (privadas) ───────────── */

const HARD = new Set(['fast', 'sprint']);
const r5 = (s) => Math.max(0, roundTo(s, 5));
const total = (segs) => segs.reduce((a, s) => a + s.sec, 0);

/** Consejos breves para el coach (técnica, respiración, mentalidad). */
const CUES = {
  warm: ['Empieza suave: deja que el cuerpo se despierte solo', 'Hombros sueltos y respiración tranquila',
    'Sin prisa: en tres minutos estarás listo', 'Pisada ligera, como si la cinta quemara'],
  easy: ['Ritmo de conversación: deberías poder hablar', 'Zona 2: aquí se construye el motor',
    'Cadencia ligera y apoyos silenciosos', 'Postura alta, mirada al frente', 'Disfruta: este ritmo te hace incansable'],
  recovery: ['Recupera: respira hondo y suelta los hombros', 'Baja pulsaciones, la siguiente llega pronto',
    'Bebe un sorbo si lo necesitas', 'Trote suave: recuperar también es entrenar', 'Relaja las manos, como si llevaras un pañuelo'],
  tempo: ['Cómodamente duro: puedes decir frases cortas', 'Encuentra tu ritmo y bloquéalo',
    'Respira desde la barriga, profundo y regular', 'Cadencia alta, pasos cortos', 'Relaja la mandíbula: la tensión sobra'],
  fast: ['Respira 2-2: dos pasos inspiras, dos espiras', 'Hombros abajo, brazos hacia atrás',
    'Rápido pero con técnica: pisada bajo la cadera', 'Empuja la cinta hacia atrás con cada paso', 'Mirada al frente y pecho orgulloso'],
  sprint: ['Brazos rápidos: las piernas los siguen', 'Zancada corta y explosiva, no golpees la cinta',
    'Cuerpo alto, cadera adelantada', 'Treinta segundos de valentía y luego premio', 'Agárrate al ritmo, no a la barra'],
  hill: ['Inclínate un poco desde los tobillos, no desde la cintura', 'Pasos cortos y rápidos en la subida',
    'Brazos activos: te ayudan a subir', 'Mirada arriba, la cima está cerca'],
  first: ['Primera serie: entra con control, no te pases', 'Empieza contenido: lo duro llega después',
    'Encuentra el ritmo en los primeros diez segundos'],
  last: ['¡Última! Vacía el depósito con técnica', 'La última es la que más cuenta',
    'Esta separa el querer del hacer', 'Última: termina más fuerte de lo que empezaste'],
  mind: ['Divide y vencerás: piensa solo en este bloque', 'Dite por dentro: «puedo con esto»',
    'La incomodidad es temporal, el orgullo se queda', 'Cuenta veinte pasos y vuelve a empezar'],
  cool: ['Baja pulsaciones: respira lento y profundo', 'Suelta el cuerpo, has hecho un gran trabajo',
    'Relaja la cara y los hombros: misión cumplida'],
};

/** Herramientas ligadas a un contexto de construcción. */
function kit(ctx) {
  const lv = ctx.levels;
  const tm = ctx.treadmill || {};
  const rng = ctx.rng;
  const maxInc = Math.min(8, Number(tm.maxIncline) || 8);
  const k = {
    ctx, rng,
    L: clamp(Number(ctx.load) || 1, 0.6, 1.4),
    J: lv.jog, R: lv.run, F: lv.fast, S: lv.sprint,
    minutes: ctx.minutes,
    long: ctx.minutes >= 40,
    hasIncline: !!ctx.hasIncline,
    wu: speedForZone('warmup', lv),
    cd: speedForZone('cooldown', lv),
    walk: speedForZone('walk', lv),
    spd: (v) => clampSpeed(v, tm),
    /** Velocidad entre correr (0) y correr rápido (1). */
    between: (f) => round1(lv.run + (lv.fast - lv.run) * f),
    /** Nivel más cercano a una velocidad (para colorear tempos y progresivos). */
    near(v) {
      let best = 'jog';
      let d = Infinity;
      for (const z of LEVEL_KEYS) {
        const x = Math.abs(lv[z] - v);
        if (x < d - 1e-9) { d = x; best = z; }
      }
      return best;
    },
    cue: (type) => rng.pick(CUES[type]),
    inc: (p) => (ctx.hasIncline ? clamp(Math.round(p), 1, maxInc) : 0),
  };
  k.seg = (zone, sec, o = {}) => {
    const v = o.speed != null ? o.speed : speedForZone(zone, lv) + (o.off || 0);
    const s = { zone, speed: k.spd(v), incline: o.incline || 0, sec: r5(sec), label: o.label || ZONES[zone].name, cue: o.cue || '' };
    if (o.block) s.block = o.block;
    if (o.rep) s.rep = { i: o.rep.i, n: o.rep.n };
    if (o.flex) s.flex = true;
    return s;
  };
  /** Tramo definido por velocidad: la zona es el nivel más cercano salvo que se indique. */
  k.at = (speed, sec, o = {}) => k.seg(o.zone || k.near(speed), sec, { ...o, speed });
  k.jog = (sec, o) => k.seg('jog', sec, o);
  k.run = (sec, o) => k.seg('run', sec, o);
  k.fast = (sec, o) => k.seg('fast', sec, o);
  k.sprint = (sec, o) => k.seg('sprint', sec, o);
  k.walkSeg = (sec, o = {}) => k.seg('walk', sec, { label: 'Caminar ligero', speed: k.walk + 0.5, ...o });
  k.rec = (sec, o = {}) => k.seg('jog', sec, { label: 'Recupera', off: -0.2, block: 'Recuperación', ...o });
  /** Relleno elástico: absorbe el tiempo sobrante del bloque principal. */
  k.flex = (o = {}) => k.seg('jog', 0, { label: 'Trote de transición', ...o, flex: true });
  /** Cuesta: velocidad con el mismo esfuerzo que `flat` km/h en llano (ACSM: v·(1 + 4,5·pendiente)). */
  k.hill = (zone, flat, pct, sec, o = {}) => {
    const p = k.inc(pct);
    const speed = p ? round1(flat / (1 + (4.5 * p) / 100)) : flat;
    return k.seg(zone, sec, { label: p ? `Cuesta ${p} %` : 'Subida simulada', ...o, speed, incline: p });
  };
  return k;
}

/** Elige la variante que mejor llena el presupuesto (deja ≥ reserve), con azar entre las casi empatadas. */
function choose(k, variants, lenOf, budget, reserve = 0) {
  const scored = variants.map((v) => ({ v, left: budget - lenOf(v) })).filter((x) => x.left >= reserve);
  if (!scored.length) return variants.reduce((a, b) => (lenOf(b) < lenOf(a) ? b : a));
  scored.sort((a, b) => a.left - b.left);
  const top = scored.filter((x) => x.left <= scored[0].left + 60).slice(0, 3);
  return k.rng.pick(top).v;
}

/** Calentamiento progresivo: 20′ → 3–4 min · 30′ → 5 min · 45–60′ → 6–8 min (con activación si hay calidad). */
function warmup(k, { quality = false, short = false } = {}) {
  const mid = round1((k.wu + k.J) / 2);
  const a = (sec, cue = '') => k.seg('warmup', sec, { speed: k.wu, label: 'Calentamiento suave', cue, block: 'Calentamiento' });
  const b = (sec) => k.seg('warmup', sec, { speed: mid, label: 'Calentamiento', block: 'Calentamiento' });
  const c = (sec) => k.jog(sec, { label: 'Trote suave', block: 'Calentamiento', cue: k.cue('easy') });
  if (k.minutes <= 22) {
    const four = !short && (quality || k.rng.chance(0.5));
    return [a(60, k.cue('warm')), b(60), c(four ? 120 : 60)];
  }
  if (k.minutes <= 37) return [a(90, k.cue('warm')), b(90), c(120)];
  const segs = [a(120, k.cue('warm')), b(120), c(k.rng.pick([120, 180]))];
  if (quality) segs.push(k.run(60, { label: 'Activación', block: 'Calentamiento', cue: 'Despierta las piernas: zancada viva y relajada' }));
  return segs;
}

/** Vuelta a la calma bajando de trote a paso de calma: 20′ → 2 min · 30′ → 3 min · 45–60′ → 4–5 min. */
function cooldown(k) {
  const a = round1(k.J - 0.5);
  const mid = round1((a + k.cd) / 2);
  const s = (speed, sec, cue = '') => k.seg('cooldown', sec, { speed, cue, block: 'Vuelta a la calma' });
  if (k.minutes <= 22) return [s(a, 60, k.cue('cool')), s(k.cd, 60)];
  if (k.minutes <= 37) return [s(a, 60, k.cue('cool')), s(mid, 60), s(k.cd, 60)];
  return [s(a, 90, k.cue('cool')), s(mid, 90), s(k.cd, k.rng.pick([60, 120]))];
}

/** Reparte `diff` segundos (múltiplo de 5) en pasos de 5 s, usando solo los rellenos que puedan quedarse con ≥ 30 s. */
function spread(all, diff) {
  const list = all.slice(0, clamp(Math.floor(diff / 30), 1, all.length));
  const units = Math.round(diff / 5);
  const per = Math.floor(units / list.length);
  let rest = units - per * list.length;
  for (const s of list) {
    s.sec += per * 5 + (rest > 0 ? 5 : 0);
    if (rest > 0) rest--;
  }
}

/** Quita hasta `need` segundos a los segmentos (desde el final) sin bajar de `floor`. Devuelve lo que falta. */
function shrink(list, need, floor) {
  for (let i = list.length - 1; i >= 0 && need > 0; i--) {
    const take = Math.min(need, Math.max(0, list[i].sec - floor));
    list[i].sec -= take;
    need -= take;
  }
  return need;
}

/** Ajusta el bloque principal para que dure exactamente `budget` segundos. */
function fitMain(k, main, budget, depth = 0) {
  let diff = budget - total(main);
  if (diff > 0) {
    const flex = main.filter((s) => s.flex);
    if (flex.length) spread(flex, diff);
    else if (diff >= 30) main.push(k.jog(diff, { label: 'Trote de soltura', cue: k.cue('easy') }));
    else (main.slice().reverse().find((s) => !HARD.has(s.zone)) || main[main.length - 1]).sec += diff;
  } else if (diff < 0) {
    let need = -diff;
    need = shrink(main.filter((s) => s.flex), need, 0);
    need = shrink(main.filter((s) => !s.flex && !HARD.has(s.zone)), need, 30);
    need = shrink(main.filter((s) => HARD.has(s.zone)), need, 30);
    while (need > 0 && main.length > 1) need -= main.pop().sec;
    if (need < 0 && depth < 2) return fitMain(k, main, budget, depth + 1);
  }
  // Los rellenos que se quedan en < 30 s se funden con un tramo tranquilo (vecino si puede ser; nunca alargan un sprint)
  for (let i = main.length - 1; i >= 0; i--) {
    const s = main[i];
    if (!s.flex || s.sec >= 30) continue;
    main.splice(i, 1);
    if (s.sec > 0 && main.length) {
      const nb = [main[i - 1], main[i]].filter(Boolean).find((x) => !HARD.has(x.zone));
      const easy = main.filter((x) => !HARD.has(x.zone));
      const target = nb || (easy.length ? easy.reduce((a, b) => (b.sec > a.sec ? b : a)) : main[main.length - 1]);
      target.sec += s.sec;
    }
  }
  return main;
}

/** Nunca más de ~25 % del bloque principal a sprint ni sprints de más de 60 s seguidos. */
function capSprint(k, main, budget) {
  const toFast = (s) => {
    const flat = k.F + (k.S - k.F) * 0.4;
    s.zone = 'fast';
    s.speed = k.spd(s.incline ? flat / (1 + (4.5 * s.incline) / 100) : flat);
    s.label = s.incline ? s.label : 'Rápido +';
  };
  for (const s of main) if (s.zone === 'sprint' && s.sec > 60) toFast(s);
  const cap = Math.floor((0.25 * budget) / 5) * 5;
  let sp = total(main.filter((s) => s.zone === 'sprint'));
  for (let i = main.length - 1; i >= 0 && sp > cap; i--) {
    if (main[i].zone !== 'sprint') continue;
    sp -= main[i].sec;
    toFast(main[i]);
  }
}

/** Marco común: calentamiento + bloque principal exacto + vuelta a la calma. */
function frame(ctx, mainFn, opts = {}) {
  const k = kit(ctx);
  const wu = warmup(k, opts);
  const cd = cooldown(k);
  const budget = Math.max(60, ctx.minutes * 60 - total(wu) - total(cd));
  const main = fitMain(k, (mainFn(k, budget, { warm: wu, cool: cd }) || []).filter((s) => s.sec > 0 || s.flex), budget);
  capSprint(k, main, budget);
  const all = [...wu, ...main, ...cd];
  const same = (a, b) => a && b && a.zone === b.zone && a.speed === b.speed && a.incline === b.incline && !a.rep && !b.rep;
  for (let i = all.length - 1; i >= 0; i--) {
    const s = all[i];
    if (!s.flex) continue;
    const into = same(all[i - 1], s) ? all[i - 1] : same(all[i + 1], s) ? all[i + 1] : null;
    if (!into) continue;
    into.sec += s.sec;
    if (!into.cue) into.cue = s.cue;
    all.splice(i, 1);
  }
  return all.map(({ flex, work, ...s }) => s);
}

/** Numera las series de trabajo: rep {i, n} en los segmentos marcados con `work`. */
function numberReps(segs, block = null) {
  const work = segs.filter((s) => s.work);
  work.forEach((s, idx) => {
    s.rep = { i: idx + 1, n: work.length };
    if (block && !s.block) s.block = block;
    delete s.work;
  });
  return segs;
}

const ALL = [20, 30, 45, 60];
/** Marca un segmento como serie de trabajo (para numerarlo con rep). */
const W = (s) => { s.work = true; return s; };

/* ═════════════════════════════ PLANTILLAS ═════════════════════════════ */

export const TEMPLATES = [];
const T = (def) => TEMPLATES.push({ requiresIncline: false, durations: ALL, ...def });

/* ───────────── Intervalos ───────────── */

T({
  id: 'pyramid', title: 'Pirámide', subtitle: '30″ · 1′ · 1′30 · 2′… y vuelta a bajar', category: 'intervals', focus: 'VO₂máx y velocidad',
  description: 'Escalones que suben hasta la cima y vuelven a bajar. Abajo, cortos y explosivos; arriba, largos y firmes. Cada peldaño tiene su propia velocidad.',
  coachNotes: ['Los tramos de 30″ son a sprint: brazos rápidos y zancada corta.', 'En la cima no te pases: la bajada también hay que correrla.', 'Recupera siempre trotando, nunca parado: la cinta tarda en volver a arrancar.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const restOf = (w) => r5(clamp((w * 0.8) / k.L, 40, 120));
    const steps = (peak) => {
      const up = [30, 60, 90, 120, 150].filter((w) => w < peak);
      return [...up, peak, ...up.slice().reverse()];
    };
    const len = (st) => st.reduce((a, w, i) => a + w + (i < st.length - 1 ? restOf(w) : 0), 0);
    const gap = 180;
    const peaks = [90, 120, 150];
    const variants = peaks.map((p) => [p]);
    if (k.minutes >= 30) for (const p of peaks) for (const q of peaks) variants.push([p, q]);
    if (k.minutes >= 55) variants.push([90, 120, 90], [120, 120, 90]);
    const lenV = (v) => v.reduce((a, p) => a + len(steps(p)), 0) + gap * (v.length - 1);
    const pick = choose(k, variants, lenV, B);
    const out = [k.flex()];
    pick.forEach((p, pi) => {
      const st = steps(p);
      if (pi) out.push(k.jog(gap, { label: 'Trote entre pirámides', block: 'Transición', cue: k.cue('recovery') }));
      st.forEach((w, i) => {
        const top = w === p;
        const s = w <= 30 ? k.sprint(w, { label: 'Sprint' })
          : w <= 60 ? k.fast(w, { off: round1((k.S - k.F) * 0.4), label: 'Rápido +' })
            : k.fast(w, { off: w >= 150 ? -0.2 : 0, label: top ? 'Cima' : 'Rápido' });
        s.block = `Pirámide ${pi + 1}`;
        s.cue = i === 0 && pi === 0 ? k.cue('first') : top ? k.cue('mind') : w <= 30 ? k.cue('sprint') : '';
        out.push(W(s));
        if (i < st.length - 1) out.push(k.rec(restOf(w)));
      });
    });
    out.push(k.flex({ label: 'Trote de soltura' }));
    return numberReps(out);
  }, { short: true }),
});

T({
  id: 'minute-on', title: 'Minuto a minuto', subtitle: '1′ rápido · 1′ trote', category: 'intervals', focus: 'VO₂máx', durations: [20, 30, 45],
  description: 'El clásico que nunca falla: un minuto rápido, un minuto de trote, y otra vez. Sencillo de entender, exigente de completar.',
  coachNotes: ['Un minuto pasa volando: no salgas a tope en la primera.', 'En el trote, respira profundo y suelta los brazos.', 'Si las últimas cuestan mucho, mantén la técnica antes que la velocidad.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const variant = k.rng.pick(['flat', 'progressive', 'blocks']);
    const reserve = k.L < 0.85 ? 240 : k.L < 1.05 ? 120 : 60;
    const lenN = (n) => n * 120 + (variant === 'blocks' ? Math.floor((n - 1) / 4) * 120 : 0);
    let n = 12;
    while (n > 3 && lenN(n) > B - reserve) n--;
    const out = [k.flex()];
    for (let i = 0; i < n; i++) {
      if (variant === 'blocks' && i && i % 4 === 0) out.push(k.jog(120, { label: 'Pausa activa', block: 'Recuperación', cue: k.cue('mind') }));
      const off = variant === 'progressive' ? round1(-0.2 + (0.4 * i) / Math.max(1, n - 1)) : i === n - 1 ? 0.2 : 0;
      const cue = i === 0 ? k.cue('first') : i === n - 1 ? k.cue('last') : i % 3 === 1 ? k.cue('fast') : '';
      out.push(W(k.fast(60, { off, label: 'Minuto rápido', cue })));
      out.push(k.jog(60, { label: 'Minuto de trote', block: 'Recuperación', cue: i === 1 ? k.cue('recovery') : '' }));
    }
    out.push(k.flex({ label: 'Trote de soltura' }));
    return numberReps(out, 'Series');
  }, { quality: true }),
});

T({
  id: 'sprint-30-60', title: 'Sprints 30/60', subtitle: '30″ sprint · 60″ trote, por bloques', category: 'intervals', focus: 'Velocidad punta', durations: [20, 30, 45],
  description: 'Treinta segundos a tu velocidad de sprint y tiempo de sobra para recuperar. Potencia pura en bloques cortos para subir tu techo.',
  coachNotes: ['La cinta tarda unos segundos en subir: el sprint empieza cuando llegas a la velocidad.', 'Brazos rápidos y a noventa grados, pisada debajo de la cadera.', 'Entre bloques, dos minutos de trote para llegar fresco al siguiente.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const rest = k.L >= 1.1 ? 60 : k.L < 0.85 ? 90 : 75;
    const perSet = k.rng.pick([4, 5, 6]);
    const style = k.rng.pick(['steady', 'build', 'peak']);
    const gap = 120;
    const lenN = (n) => {
      const sets = Math.ceil(n / perSet);
      return n * 30 + (n - sets) * rest + (sets - 1) * gap;
    };
    let n = Math.min(clamp(Math.round(10 * k.L), 4, 12), Math.floor((0.24 * B) / 30));
    while (n > 2 && lenN(n) > B - 60) n--;
    const out = [k.flex()];
    for (let i = 0; i < n; i++) {
      const set = Math.floor(i / perSet);
      const inSet = i % perSet;
      const lastInSet = inSet === perSet - 1 || i === n - 1;
      const off = style === 'build' ? (set === 0 ? -0.3 : 0) : style === 'peak' && lastInSet ? 0.2 : 0;
      const cue = i === 0 ? k.cue('first') : i === n - 1 ? k.cue('last') : inSet === 0 ? k.cue('sprint') : '';
      out.push(W(k.sprint(30, { off, label: 'Sprint', block: `Bloque ${set + 1}`, cue })));
      if (i === n - 1) break;
      out.push(lastInSet
        ? k.jog(gap, { label: 'Trote entre bloques', block: 'Recuperación', cue: k.cue('mind') })
        : k.rec(rest, { off: -0.3 }));
    }
    out.push(k.flex({ label: 'Trote de soltura' }));
    return numberReps(out);
  }, { quality: true }),
});

T({
  id: 'ladder-up', title: 'Escalera de velocidad', subtitle: 'Correr → rápido → sprint → trote', category: 'intervals', focus: 'Cambios de marcha',
  description: 'Cada serie es una escalera sin descansillos: subes de correr a rápido y rematas con un sprint. Después, trote y a por la siguiente.',
  coachNotes: ['Cada peldaño es un cambio de marcha: sube cadencia antes que zancada.', 'El sprint final dura poco: entrégate sin perder la postura.', 'Usa el trote para bajar pulsaciones de verdad.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const rest = r5(clamp(120 / k.L, 90, 180));
    const opts = [];
    for (const a of [90, 120]) for (const b of [60, 90]) for (const c of [30, 45]) for (let n = 1; n <= 6; n++) opts.push({ a, b, c, n });
    const lenOf = (o) => o.n * (o.a + o.b + o.c) + (o.n - 1) * rest;
    const o = choose(k, opts, lenOf, B, 60);
    const out = [k.flex()];
    for (let i = 0; i < o.n; i++) {
      const block = `Escalera ${i + 1}`;
      out.push(W(k.run(o.a, { label: 'Peldaño 1 · Correr', block, cue: i === 0 ? k.cue('first') : k.cue('tempo') })));
      out.push(W(k.fast(o.b, { label: 'Peldaño 2 · Rápido', block, cue: k.cue('fast') })));
      out.push(W(k.sprint(o.c, { label: 'Peldaño 3 · Sprint', block, cue: i === o.n - 1 ? k.cue('last') : k.cue('sprint') })));
      if (i < o.n - 1) out.push(k.rec(rest, { label: 'Trote de recuperación', cue: k.cue('recovery') }));
    }
    out.push(k.flex({ label: 'Trote de soltura' }));
    // rep cuenta escaleras, no peldaños
    const work = out.filter((s) => s.work);
    work.forEach((s, idx) => { s.rep = { i: Math.floor(idx / 3) + 1, n: o.n }; delete s.work; });
    return out;
  }, { quality: true }),
});

T({
  id: 'over-under', title: 'Por encima y por debajo', subtitle: 'Alterna justo bajo y sobre tu umbral', category: 'intervals', focus: 'Umbral y tolerancia',
  description: 'Bloques continuos que oscilan entre un ritmo firme y uno por encima de tu umbral, sin trote entre medias. Enseña a tu cuerpo a limpiar el cansancio en marcha.',
  coachNotes: ['El tramo «por debajo» no es descanso: es recuperar corriendo.', 'Respira profundo y regular: el ritmo de la respiración manda.', 'Si te pasas en el primer bloque lo pagarás en el último.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const gap = r5(clamp(150 / k.L, 90, 210));
    const opts = [];
    for (const u of [90, 120]) for (const o of [45, 60]) for (let c = 3; c <= 5; c++) for (let nb = 1; nb <= 3; nb++) {
      if (nb * c * (u + o) <= 1440) opts.push({ u, o, c, nb });
    }
    const lenOf = (x) => x.nb * x.c * (x.u + x.o) + (x.nb - 1) * gap;
    const x = choose(k, opts, lenOf, B, 60);
    const out = [k.flex()];
    for (let b = 0; b < x.nb; b++) {
      const block = `Bloque ${b + 1}`;
      for (let c = 0; c < x.c; c++) {
        out.push(k.run(x.u, { off: 0.2, label: 'Por debajo', block, cue: c === 0 ? k.cue('tempo') : '' }));
        out.push(W(k.fast(x.o, { off: 0.1, label: 'Por encima', block, cue: c === 0 && b === 0 ? k.cue('first') : c === x.c - 1 ? k.cue('mind') : '' })));
      }
      if (b < x.nb - 1) out.push(k.jog(gap, { label: 'Trote entre bloques', block: 'Recuperación', cue: k.cue('recovery') }));
    }
    out.push(k.flex({ label: 'Trote de soltura' }));
    return numberReps(out);
  }, { quality: true }),
});

T({
  id: 'golden-minutes', title: 'Minutos de oro', subtitle: 'Cada serie acaba con un minuto de oro', category: 'intervals', focus: 'Aguantar velocidad cansado', durations: [20, 30, 45],
  description: 'Corres firme para llegar con las piernas cargadas y entonces llega el minuto de oro, por encima de tu ritmo rápido. Así se aprende a acelerar cuando ya cuesta.',
  coachNotes: ['El tramo de correr prepara el terreno: mantenlo estable.', 'El minuto de oro se corre con la cabeza: técnica y mirada al frente.', 'Recupera trotando suave, que el siguiente minuto también es de oro.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const rest = r5(clamp(90 / k.L, 60, 150));
    const goldOff = k.rng.pick([0.2, 0.3, 0.4]);
    const opts = [];
    for (const base of [120, 150, 180]) for (let n = 1; n <= 8; n++) opts.push({ base, n });
    const lenOf = (o) => o.n * (o.base + 60 + rest) - rest;
    const o = choose(k, opts, lenOf, B, 60);
    const out = [k.flex()];
    for (let i = 0; i < o.n; i++) {
      out.push(k.run(o.base, { label: 'Base firme', block: `Serie ${i + 1}`, cue: i === 0 ? k.cue('tempo') : '' }));
      out.push(W(k.fast(60, { off: goldOff, label: 'Minuto de oro', block: `Serie ${i + 1}`, cue: i === o.n - 1 ? k.cue('last') : k.cue('fast') })));
      if (i < o.n - 1) out.push(k.rec(rest, { cue: i === 0 ? k.cue('recovery') : '' }));
    }
    out.push(k.flex({ label: 'Trote de soltura' }));
    return numberReps(out);
  }, { quality: true }),
});

T({
  id: 'two-one', title: 'Series 2×1', subtitle: '2′ rápido · 1′ trote', category: 'intervals', focus: 'Potencia aeróbica', durations: [20, 30, 45],
  description: 'Dos minutos rápidos por cada minuto de trote. El equilibrio perfecto para mejorar tu potencia aeróbica sin caer en el sprint.',
  coachNotes: ['Dos minutos son largos: el primero controlado, el segundo valiente.', 'Respira en 2-2 durante las series.', 'El minuto de trote es sagrado: no lo recortes.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const rest = k.L >= 0.95 ? 60 : k.L >= 0.8 ? 75 : 90;
    const style = k.rng.pick(['steady', 'negative', 'wave']);
    const n = clamp(Math.floor((B - 60 + rest) / (120 + rest)), 2, 8);
    const out = [k.flex()];
    for (let i = 0; i < n; i++) {
      const off = style === 'negative' ? Math.min(0.3, round1(-0.2 + 0.1 * i))
        : style === 'wave' ? (i % 2 ? 0.2 : 0) : i === n - 1 ? 0.1 : 0;
      out.push(W(k.fast(120, { off, label: 'Dos minutos rápidos', cue: i === 0 ? k.cue('first') : i === n - 1 ? k.cue('last') : k.cue('fast') })));
      if (i < n - 1) out.push(k.jog(rest, { label: 'Minuto de trote', block: 'Recuperación' }));
    }
    out.push(k.flex({ label: 'Trote de soltura' }));
    return numberReps(out, 'Series');
  }, { quality: true }),
});

T({
  id: 'countdown', title: 'Cuenta atrás', subtitle: '3′ · 2′ · 1′ · 30″, cada vez más rápido', category: 'intervals', focus: 'Ritmo y velocidad',
  description: 'Cada tramo dura menos que el anterior y va más rápido. Empiezas con tres minutos firmes y terminas con treinta segundos de sprint: la cuenta atrás perfecta.',
  coachNotes: ['El de tres minutos marca el tono: firme, no a tope.', 'Cuanto más corto el tramo, más rápida la cadencia.', 'Los treinta segundos finales son para soltarlo todo.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const rests = [r5(clamp(90 / k.L, 60, 120)), r5(clamp(75 / k.L, 50, 105)), r5(clamp(60 / k.L, 45, 90))];
    const setLen = 390 + rests[0] + rests[1] + rests[2];
    const gap = 150;
    const n = clamp(Math.floor((B - 60 + gap) / (setLen + gap)), 1, 3);
    const runOff = k.rng.pick([0.3, 0.4, 0.5]);
    const out = [k.flex()];
    for (let s = 0; s < n; s++) {
      const bump = s > 0 && k.rng.chance(0.5) ? 0.1 : 0;
      const block = `Cuenta atrás ${s + 1}`;
      out.push(W(k.run(180, { off: runOff + bump, label: 'Tres minutos', block, cue: s === 0 ? k.cue('tempo') : k.cue('mind') })));
      out.push(k.rec(rests[0]));
      out.push(W(k.fast(120, { off: -0.1 + bump, label: 'Dos minutos', block, cue: k.cue('fast') })));
      out.push(k.rec(rests[1]));
      out.push(W(k.fast(60, { off: 0.3 + bump, label: 'Un minuto', block })));
      out.push(k.rec(rests[2]));
      out.push(W(k.sprint(30, { off: bump, label: 'Treinta segundos', block, cue: s === n - 1 ? k.cue('last') : k.cue('sprint') })));
      if (s < n - 1) out.push(k.jog(gap, { label: 'Trote entre series', block: 'Recuperación', cue: k.cue('recovery') }));
    }
    out.push(k.flex({ label: 'Trote de soltura' }));
    return numberReps(out);
  }, { quality: true }),
});

T({
  id: 'km-repeats', title: 'Series de distancia', subtitle: 'Repeticiones de 400 m a 1,2 km', category: 'intervals', focus: 'Ritmo de carrera',
  description: 'Series medidas en metros, como en la pista: sabes exactamente cuánto te queda. Ideales para interiorizar tu ritmo rápido y hacerlo tuyo.',
  coachNotes: ['Fíjate en la distancia de la cinta: cada serie es una meta concreta.', 'Corre todas al mismo ritmo; la última puede ser un pelín más rápida.', 'Recupera trotando y bebe un sorbo si lo necesitas.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const style = k.rng.pick(['steady', 'build']);
    const dists = k.long ? [0.6, 0.8, 1.0, 1.2] : [0.4, 0.6, 0.8, 1.0];
    const opts = [];
    for (const d of dists) for (let n = 2; n <= 8; n++) {
      const sec = r5((d / k.F) * 3600);
      const rest = r5(clamp((d <= 0.6 ? 75 : 105) / k.L, 60, 150));
      if (n * sec <= 1500) opts.push({ d, n, sec, rest });
    }
    const lenOf = (o) => o.n * o.sec + (o.n - 1) * o.rest;
    const o = choose(k, opts, lenOf, B, 60);
    const name = `${Math.round(o.d * 1000)} m`;
    const out = [k.flex()];
    for (let i = 0; i < o.n; i++) {
      const off = style === 'build' ? Math.min(0.3, round1(0.1 * i - 0.1)) : i === o.n - 1 ? 0.1 : 0;
      out.push(W(k.fast(o.sec, { off, label: `Serie de ${name}`, cue: i === 0 ? k.cue('first') : i === o.n - 1 ? k.cue('last') : k.cue('fast') })));
      if (i < o.n - 1) out.push(k.rec(o.rest));
    }
    out.push(k.flex({ label: 'Trote de soltura' }));
    return numberReps(out, 'Series');
  }, { quality: true }),
});

/* ───────────── Tempo ───────────── */

T({
  id: 'cruise', title: 'Ritmo crucero', subtitle: 'Un bloque largo, firme y sostenido', category: 'tempo', focus: 'Umbral aeróbico',
  description: 'Encuentras tu ritmo de crucero y lo bloqueas. Un esfuerzo cómodamente duro que, semana a semana, convierte el ritmo de correr en tu ritmo fácil.',
  coachNotes: ['Cómodamente duro: deberías poder decir frases cortas, no cantar.', 'Elige un punto fijo delante y relaja la cara.', 'Si te sobra energía al final, guárdala para el próximo día.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const off = k.rng.pick([0.2, 0.3, 0.4]);
    const waves = k.rng.chance(0.5);
    const tempo = r5(clamp(B * (k.long ? 0.5 : 0.68) * k.L, 300, 1800));
    const blocks = tempo > 900 && k.long ? [r5(tempo / 2), tempo - r5(tempo / 2)] : [tempo];
    const out = [k.flex(), k.run(120, { off: -0.3, label: 'Entrando en ritmo', cue: k.cue('tempo') })];
    blocks.forEach((len, bi) => {
      const block = blocks.length > 1 ? `Crucero ${bi + 1}` : 'Crucero';
      if (bi) out.push(k.jog(180, { label: 'Trote entre bloques', block: 'Recuperación', cue: k.cue('recovery') }));
      if (!waves) {
        out.push(k.run(len, { off, label: 'Ritmo crucero', block, cue: k.cue('mind') }));
        return;
      }
      let left = len;
      while (left >= 300) {
        out.push(k.run(240, { off, label: 'Ritmo crucero', block, cue: left === len ? k.cue('tempo') : '' }));
        out.push(k.run(60, { off: off + 0.3, label: 'Ola', block }));
        left -= 300;
      }
      if (left >= 30) out.push(k.run(left, { off, label: 'Ritmo crucero', block }));
    });
    out.push(k.flex({ label: 'Trote de soltura' }));
    return out;
  }),
});

T({
  id: 'sandwich', title: 'Sándwich', subtitle: 'Tempo · rápido · tempo, sin parar', category: 'tempo', focus: 'Umbral y cambio de ritmo',
  description: 'Dos rebanadas de tempo con un relleno de ritmo rápido en el centro. Aprendes a subir una marcha y, lo más difícil, a mantener el tempo después.',
  coachNotes: ['La primera rebanada es para encontrar el ritmo, no para lucirse.', 'El relleno es corto: sube cadencia y aguanta.', 'Tras el relleno, vuelve al tempo y respira: es lo que más entrena.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const gap = 180;
    const opts = [];
    for (const b of [180, 240, 300, 360]) for (const f of [90, 120, 180]) for (const ns of k.long ? [1, 2] : [1]) opts.push({ b, f, ns });
    const lenOf = (o) => o.ns * (2 * o.b + o.f) + (o.ns - 1) * gap;
    const o = choose(k, opts, lenOf, B, 60);
    const fillOff = k.rng.pick([0, 0.1]);
    const out = [k.flex()];
    for (let s = 0; s < o.ns; s++) {
      const block = `Sándwich ${s + 1}`;
      out.push(k.run(o.b, { off: 0.2, label: 'Pan · tempo', block, cue: k.cue('tempo') }));
      out.push(W(k.fast(o.f, { off: fillOff, label: 'Relleno · rápido', block, cue: k.cue('fast') })));
      out.push(k.run(o.b, { off: 0.3, label: 'Pan · tempo', block, cue: k.cue('mind') }));
      if (s < o.ns - 1) out.push(k.jog(gap, { label: 'Trote entre sándwiches', block: 'Recuperación', cue: k.cue('recovery') }));
    }
    out.push(k.flex({ label: 'Trote de soltura' }));
    return numberReps(out);
  }),
});

T({
  id: 'threshold-3x4', title: 'Umbral 3×4', subtitle: '3 × 4′ a ritmo umbral', category: 'tempo', focus: 'Umbral anaeróbico', durations: [20, 30, 45],
  description: 'Tres bloques de cuatro minutos justo en tu umbral, ese ritmo que puedes sostener sin que el cansancio se dispare. La sesión que más mueve tu ritmo de 10K.',
  coachNotes: ['Ritmo de umbral: duro pero sostenible, la respiración profunda y regular.', 'Los tres bloques al mismo ritmo: la constancia es el objetivo.', 'En la recuperación, trote suave y hombros sueltos.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const sets = k.minutes >= 40 ? 2 : 1;
    const gap = 180;
    let rest = r5(clamp(90 / k.L, 60, 120));
    let w = 240;
    const lenOf = () => sets * (3 * w + 2 * rest) + (sets - 1) * gap;
    if (lenOf() > B) rest = Math.max(60, r5((B - (sets - 1) * gap) / sets / 2 - 1.5 * w));
    if (lenOf() > B) w = Math.max(120, Math.floor(((B - (sets - 1) * gap) / sets - 2 * rest) / 15) * 5);
    const speed = round1(k.between(0.65) + k.rng.pick([-0.1, 0, 0]));
    const finishUp = k.rng.chance(0.5);
    const out = [k.flex()];
    for (let s = 0; s < sets; s++) {
      for (let i = 0; i < 3; i++) {
        const last = s === sets - 1 && i === 2;
        out.push(W(k.at(speed + (last && finishUp ? 0.2 : 0), w, { label: 'Umbral', block: sets > 1 ? `Serie ${s + 1}` : 'Umbral',
          cue: i === 0 && s === 0 ? k.cue('tempo') : last ? k.cue('last') : k.cue('mind') })));
        if (i < 2) out.push(k.rec(rest, { cue: i === 0 ? k.cue('recovery') : '' }));
      }
      if (s < sets - 1) out.push(k.jog(gap, { label: 'Trote entre series', block: 'Recuperación' }));
    }
    out.push(k.flex({ label: 'Trote de soltura' }));
    return numberReps(out);
  }, { short: true }),
});

T({
  id: 'progressive', title: 'Progresivo', subtitle: '+0,3 km/h cada 2 minutos', category: 'tempo', focus: 'Ritmo progresivo', durations: [20, 30],
  description: 'Cada dos minutos la cinta sube 0,3 km/h. Empiezas cómodo y terminas rozando tu ritmo rápido sin darte cuenta. Constancia y cabeza.',
  coachNotes: ['Las primeras subidas parecen fáciles: confía en el proceso.', 'Cuando cueste, acorta la zancada y sube la cadencia.', 'Los dos últimos escalones se corren con la cabeza.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const end = round1(k.F + (k.L >= 1.1 ? 0.2 : k.L < 0.85 ? -0.4 : 0) + k.rng.pick([-0.1, 0, 0.1]));
    const n = Math.max(3, Math.min(Math.floor((B - 60) / 120), Math.floor((end - k.J) / 0.3) + 1));
    const start = round1(end - 0.3 * (n - 1));
    const out = [k.flex()];
    for (let i = 0; i < n; i++) {
      const sp = round1(start + 0.3 * i);
      const cue = i === n - 2 ? k.cue('mind') : i === n - 1 ? k.cue('last') : i === 0 || i % 2 ? k.cue(sp < k.R - 0.4 ? 'easy' : 'tempo') : '';
      out.push(k.at(sp, 120, { label: `Escalón ${i + 1} de ${n}`, block: 'Progresión', cue }));
    }
    return out;
  }),
});

T({
  id: 'cruise-2x6', title: 'Crucero 2×6', subtitle: '2 × 6′ a ritmo crucero', category: 'tempo', focus: 'Resistencia a ritmo', durations: [20, 30, 45],
  description: 'Dos bloques de seis minutos entre tu ritmo de correr y el rápido. Lo bastante largos para exigir, lo bastante cortos para hacerlos perfectos.',
  coachNotes: ['Primer bloque: busca el ritmo en el primer minuto y fíjalo.', 'Segundo bloque: igual de rápido, aunque cueste más.', 'Mantén los hombros bajos y la mirada al frente.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const sets = k.minutes >= 40 ? 2 : 1;
    const rest = k.L >= 1.1 ? 90 : k.L < 0.85 ? 150 : 120;
    const speed = round1(k.between(0.45) + (k.L < 0.85 ? -0.2 : k.L >= 1.1 ? 0.1 : 0));
    const out = [k.flex()];
    for (let s = 0; s < sets; s++) {
      for (let i = 0; i < 2; i++) {
        out.push(W(k.at(speed + (i === 1 && k.rng.chance(0.4) ? 0.1 : 0), 360, { label: 'Crucero', block: sets > 1 ? `Doble ${s + 1}` : 'Crucero',
          cue: i === 0 ? k.cue('tempo') : k.cue('mind') })));
        if (i === 0) out.push(k.rec(rest, { cue: k.cue('recovery') }));
      }
      if (s < sets - 1) out.push(k.jog(180, { label: 'Trote entre bloques', block: 'Recuperación' }));
    }
    out.push(k.flex({ label: 'Trote de soltura' }));
    return numberReps(out);
  }),
});

T({
  id: 'tempo-waves', title: 'Olas de tempo', subtitle: 'Crestas de umbral y valles a ritmo de correr', category: 'tempo', focus: 'Umbral con recuperación activa',
  description: 'Tempo en oleaje: subes a la cresta y bajas al valle sin dejar de correr. Los valles no son trote, son ritmo firme: aquí se aprende a recuperar en marcha.',
  coachNotes: ['En los valles sigues corriendo: baja pulsaciones sin aflojar del todo.', 'Las crestas deben sentirse duras pero controladas.', 'Respira en 3-3 en los valles y en 2-2 en las crestas.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const opts = [];
    const cap = B * (k.long ? 0.55 : 0.8);
    for (const c of [120, 180, 240]) for (const t of [90, 120]) for (let n = 2; n <= 10; n++) if (n * c + (n - 1) * t <= cap) opts.push({ c, t, n });
    if (!opts.length) opts.push({ c: 120, t: 90, n: 2 });
    const o = choose(k, opts, (x) => x.n * x.c + (x.n - 1) * x.t, B, 60);
    const crest = round1(k.between(0.55) + (k.L >= 1.1 ? 0.1 : k.L < 0.85 ? -0.2 : 0));
    const out = [k.flex()];
    for (let i = 0; i < o.n; i++) {
      out.push(W(k.at(crest, o.c, { label: 'Cresta', block: 'Olas', cue: i === 0 ? k.cue('tempo') : i === o.n - 1 ? k.cue('last') : '' })));
      if (i < o.n - 1) out.push(k.run(o.t, { off: -0.4, label: 'Valle', block: 'Olas', cue: i === 0 ? 'Sigue corriendo: el valle es ritmo, no descanso' : '' }));
    }
    out.push(k.flex({ label: 'Trote de soltura' }));
    return numberReps(out);
  }),
});

T({
  id: 'fast-finish', title: 'Remate rápido', subtitle: 'Rodaje, crucero y final a ritmo rápido', category: 'tempo', focus: 'Terminar fuerte',
  description: 'Vas subiendo de rodaje a crucero y, cuando ya llevas las piernas calientes, rematas con unos minutos a ritmo rápido. Como un final de carrera.',
  coachNotes: ['La primera parte es tranquila a propósito: guarda energía.', 'En el crucero, cadencia estable y respiración regular.', 'El remate se corre con orgullo: es tu sprint de meta.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const z = k.long ? k.rng.pick([240, 300]) : k.rng.pick([150, 180]);
    const part = r5(B * (k.long ? 0.25 : 0.3));
    return [
      k.flex({ label: 'Rodaje', off: 0.2 }),
      k.run(part, { off: -0.4, label: 'Ritmo crucero', cue: k.cue('tempo') }),
      k.run(part, { off: 0.1, label: 'Correr', cue: k.cue('mind') }),
      k.fast(z, { off: k.L >= 1.1 ? 0.1 : 0, label: 'Remate rápido', cue: k.cue('last') }),
    ];
  }),
});

/* ───────────── Resistencia ───────────── */

const LONG = [45, 60];

T({
  id: 'long-progressive', title: 'Fondo progresivo', subtitle: 'De rodaje suave a ritmo de correr', category: 'endurance', focus: 'Resistencia aeróbica', durations: LONG,
  description: 'Un fondo que se va animando por fases: empiezas en rodaje suave y terminas a tu ritmo de correr. Construye resistencia y te enseña a acabar fuerte.',
  coachNotes: ['La primera fase tiene que parecer demasiado fácil.', 'Cada cambio de fase es pequeño: deja que el cuerpo se adapte.', 'Hidrátate a mitad de sesión.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const n = k.rng.pick([4, 5]);
    const endOff = k.L >= 1.1 ? 0.1 : k.L < 0.85 ? -0.4 : -0.1;
    // la mayor parte en zona 2; solo las dos últimas fases suben a ritmo de correr
    const speeds = n === 5 ? [k.J + 0.1, k.J + 0.35, k.J + 0.6, k.R - 0.4, k.R + endOff] : [k.J + 0.1, k.J + 0.5, k.R - 0.4, k.R + endOff];
    const weights = n === 5 ? [1.4, 1.2, 1.0, 0.8, 0.6] : [1.5, 1.2, 0.8, 0.6];
    const wsum = weights.reduce((a, x) => a + x, 0);
    const remate = k.L >= 0.9 && k.rng.chance(0.5) ? 120 : 0;
    const names = n === 5 ? ['Rodaje', 'Rodaje alegre', 'Ritmo medio', 'Ritmo firme', 'Ritmo de correr'] : ['Rodaje', 'Rodaje alegre', 'Ritmo firme', 'Ritmo de correr'];
    const out = [];
    for (let i = 0; i < n; i++) {
      const s = k.at(round1(speeds[i]), r5(((B - remate) * weights[i]) / wsum), { label: `Fase ${i + 1} · ${names[i]}`, block: 'Fondo',
        cue: i === n - 1 ? k.cue('mind') : k.cue(speeds[i] < k.R - 0.6 ? 'easy' : 'tempo') });
      if (i === 0) s.flex = true;
      out.push(s);
    }
    if (remate) out.push(k.run(remate, { off: 0.4, label: 'Remate', block: 'Fondo', cue: k.cue('last') }));
    return out;
  }),
});

T({
  id: 'long-blocks', title: 'Bloques de resistencia', subtitle: 'Bloques largos a ritmo de correr', category: 'endurance', focus: 'Resistencia a ritmo',
  durations: LONG,
  description: 'Bloques de varios minutos a tu ritmo de correr separados por trote. Es la forma más eficaz de aguantar tu velocidad durante más tiempo.',
  coachNotes: ['Cada bloque al mismo ritmo: la regularidad es la clave.', 'En el trote, bebe y relaja los hombros.', 'Si el último bloque se hace largo, cuenta los minutos de uno en uno.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const blk = r5(clamp(300 * k.L, 240, 420));
    const rest = r5(clamp(150 / k.L, 90, 240));
    let n = clamp(Math.round((0.42 * B) / blk), 2, 6);
    while (n > 1 && n * blk + (n - 1) * rest > B - 180) n--;
    const prog = k.rng.chance(0.5);
    const out = [k.flex({ label: 'Rodaje', off: 0.2 })];
    for (let i = 0; i < n; i++) {
      const off = prog ? Math.min(0.1, round1(-0.3 + 0.1 * i)) : k.rng.pick([-0.2, -0.1, 0]);
      out.push(W(k.run(blk, { off, label: 'Bloque de resistencia', cue: i === 0 ? k.cue('tempo') : i === n - 1 ? k.cue('last') : k.cue('mind') })));
      if (i < n - 1) out.push(k.jog(rest, { label: 'Trote', block: 'Recuperación', cue: i === 0 ? k.cue('recovery') : '' }));
    }
    out.push(k.flex({ label: 'Trote de soltura' }));
    return numberReps(out, 'Bloques');
  }),
});

T({
  id: 'long-surges', title: 'Largo con cambios', subtitle: 'Rodaje con un cambio cada pocos minutos', category: 'endurance', focus: 'Resistencia y chispa',
  durations: LONG,
  description: 'Un rodaje largo salpicado de cambios cortos de ritmo. Los minutos pasan volando y tus piernas aprenden a acelerar sin salir de la zona aeróbica.',
  coachNotes: ['Los cambios son cortos: acelera suave, sin tirones.', 'Vuelve al rodaje respirando por la nariz si puedes.', 'Piensa en el siguiente cambio, no en el tiempo que queda.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const every = k.rng.pick([240, 300]);
    const kinds = [
      () => k.run(60, { off: 0.4, label: 'Cambio' }),
      () => k.fast(45, { label: 'Cambio rápido' }),
      () => k.fast(30, { off: 0.3, label: 'Chispazo' }),
      () => k.run(90, { off: 0.2, label: 'Cambio largo' }),
    ];
    const n = clamp(Math.floor((B - 180) / (every + 60)), 3, 12);
    const out = [k.flex({ label: 'Rodaje', off: 0.3 })];
    for (let i = 0; i < n; i++) {
      out.push(k.jog(every - 60, { off: 0.3, label: 'Rodaje', cue: i === 0 ? k.cue('easy') : i % 3 === 2 ? k.cue('mind') : '' }));
      const s = W(k.rng.pick(kinds)());
      if (i === 0) s.cue = 'Acelera suave, sin tirones';
      out.push(s);
    }
    out.push(k.flex({ label: 'Rodaje final', off: 0.1 }));
    return numberReps(out, 'Cambios');
  }),
});

T({
  id: 'negative-split', title: 'Segunda mitad más rápida', subtitle: 'Negative split: la segunda mitad manda', category: 'endurance', focus: 'Gestión del esfuerzo',
  durations: LONG,
  description: 'La primera mitad, tranquila; la segunda, más rápida. Es la estrategia de los mejores en carrera y una lección de paciencia que te hará más fuerte.',
  coachNotes: ['La primera mitad parece lenta a propósito: no la aceleres.', 'En la segunda mitad sube por escalones, sin saltos.', 'Los últimos minutos son tu momento: acaba con ganas.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const half = r5(B / 2);
    const second = B - half;
    const closeOff = k.L >= 1.1 ? 0.2 : k.L < 0.85 ? -0.3 : 0;
    const three = k.rng.chance(0.6);
    const out = [k.flex({ label: 'Primera mitad · rodaje', off: 0.1, cue: k.cue('easy') })];
    if (three) {
      out.push(k.jog(r5(second * 0.45), { off: 0.5, label: 'Segunda mitad · arranque', cue: k.cue('easy') }));
      out.push(k.run(r5(second * 0.35), { off: -0.4, label: 'Segunda mitad · firme', cue: k.cue('tempo') }));
      out.push(k.run(second - r5(second * 0.45) - r5(second * 0.35), { off: closeOff, label: 'Cierre', cue: k.cue('last') }));
    } else {
      out.push(k.jog(r5(second * 0.5), { off: 0.6, label: 'Segunda mitad', cue: k.cue('tempo') }));
      out.push(k.run(second - r5(second * 0.5), { off: closeOff - 0.2, label: 'Cierre', cue: k.cue('last') }));
    }
    out[0].sec = half;
    return out;
  }),
});

T({
  id: 'long-ladder', title: 'Escalera larga', subtitle: 'Sube peldaño a peldaño y vuelve a bajar', category: 'endurance', focus: 'Resistencia variada',
  durations: LONG,
  description: 'Una escalera de ritmos de varios minutos: subes desde el rodaje hasta un ritmo vivo y bajas de nuevo. Variedad continua para una sesión larga que se pasa sola.',
  coachNotes: ['Cada peldaño dura varios minutos: acomódate en cada uno.', 'El peldaño de arriba es el más corto, aprovéchalo.', 'En la bajada, nota cómo lo que antes costaba ahora parece fácil.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const peak = k.rng.chance(0.5) ? k.F : round1(k.R + 0.5);
    const rungs = [
      [k.J + 0.2, 360], [k.J + 0.5, 300], [k.R - 0.3, 240], [k.R, 150], [peak, 90], [k.R - 0.2, 150], [k.R - 0.4, 180], [k.J + 0.5, 300],
    ];
    const base = rungs.reduce((a, r) => a + r[1], 0);
    const scale = clamp((B - 240) / base, 0.6, 1.5);
    const out = [k.flex({ label: 'Rodaje', off: 0.1 })];
    rungs.forEach(([sp, sec], i) => {
      out.push(k.at(round1(sp), Math.max(60, r5(sec * scale)), { label: `Peldaño ${i < 5 ? i + 1 : 9 - i}${i < 4 ? ' ↑' : i > 4 ? ' ↓' : ' · cima'}`,
        block: i < 5 ? 'Subida' : 'Bajada', cue: i === 0 ? k.cue('easy') : i === 4 ? k.cue('mind') : i === 5 ? 'Bajas un peldaño: disfruta del alivio' : '' }));
    });
    out.push(k.flex({ label: 'Rodaje final' }));
    return out;
  }),
});

T({
  id: 'aerobic-base', title: 'Base aeróbica Z2', subtitle: 'Rodaje en zona 2, el motor de todo', category: 'endurance', focus: 'Motor aeróbico',
  description: 'Rodaje a ritmo de conversación para construir capilares, mitocondrias y un corazón más eficiente. Parece sencillo; es la base de todo lo demás.',
  coachNotes: ['Deberías poder hablar sin jadear: si no, baja una décima.', 'Cadencia ligera y pisada silenciosa.', 'Con el Apple Watch, intenta quedarte en zona 2 de pulso.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const pattern = k.rng.pick(['steady', 'waves', 'waves', 'climb']);
    const blockLen = k.rng.pick([240, 300, 360]);
    const n = Math.max(1, Math.floor(B / blockLen));
    const offs = { steady: [0], waves: [0, 0.2, 0.4, 0.2, 0, -0.1], climb: [-0.2, 0, 0.2, 0.3] }[pattern];
    const names = { steady: 'Rodaje Z2', waves: 'Ondas Z2', climb: 'Rodaje Z2' };
    const out = [];
    for (let i = 0; i < n; i++) {
      const off = pattern === 'climb' ? offs[Math.min(offs.length - 1, Math.floor((i * offs.length) / n))] : offs[i % offs.length];
      const s = k.jog(blockLen, { off, label: names[pattern], block: 'Base aeróbica', cue: i % 2 === 0 ? k.cue('easy') : '' });
      if (i === n - 1) s.flex = true;
      out.push(s);
    }
    return out;
  }),
});

/* ───────────── Fartlek ───────────── */

T({
  id: 'fartlek-swedish', title: 'Fartlek sueco', subtitle: 'Cambios libres de 30″ a 3′', category: 'fartlek', focus: 'Cambios de ritmo',
  description: 'El juego de velocidad original: cambios de ritmo de distinta duración e intensidad, sin patrón fijo. Nunca sabes qué viene, y eso es lo divertido.',
  coachNotes: ['Escucha los avisos: cada cambio es distinto al anterior.', 'Los cambios largos se corren firmes; los cortos, valientes.', 'Entre cambios, trote suave y respiración profunda.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const out = [k.flex()];
    const sprintCap = 0.2 * B;
    let left = B - 120;
    let sprintSec = 0;
    let last = null;
    for (let i = 0; i < 40; i++) {
      let kinds = ['run', 'run', 'fast', 'fast', 'sprint'].filter((x) => !(x === 'sprint' && sprintSec + 45 > sprintCap));
      if (last && kinds.length > 1 && !k.rng.chance(0.25)) kinds = kinds.filter((x) => x !== last);
      const kind = k.rng.pick(kinds);
      const sec = kind === 'run' ? r5(k.rng.int(60, 180)) : kind === 'fast' ? r5(k.rng.int(45, 120)) : r5(k.rng.int(30, 45));
      const rest = r5(clamp((k.rng.int(60, 120) + (kind === 'sprint' ? 15 : 0)) / k.L, 45, 150));
      if (sec + rest > left) break;
      const s = kind === 'run' ? k.run(sec, { off: k.rng.pick([0, 0.2, 0.4]), label: 'Cambio · correr' })
        : kind === 'fast' ? k.fast(sec, { off: k.rng.pick([-0.1, 0, 0.2]), label: 'Cambio · rápido' })
          : k.sprint(sec, { off: k.rng.pick([-0.2, 0]), label: 'Cambio · sprint' });
      s.cue = i === 0 ? k.cue('first') : k.cue(kind === 'run' ? 'tempo' : kind);
      out.push(W(s), k.rec(rest, { cue: i % 3 === 1 ? k.cue('recovery') : '' }));
      if (kind === 'sprint') sprintSec += sec;
      left -= sec + rest;
      last = kind;
    }
    out.push(k.flex({ label: 'Trote de soltura' }));
    return numberReps(out, 'Cambios');
  }, { quality: true }),
});

T({
  id: 'speed-play', title: 'Juego de 4 velocidades', subtitle: 'Trote, correr, rápido y sprint en orden sorpresa', category: 'fartlek', focus: 'Todas tus marchas',
  description: 'Cada ronda pasa por tus cuatro velocidades en un orden distinto. Un repaso completo de todas tus marchas que mantiene la cabeza despierta.',
  coachNotes: ['Cada ronda cambia el orden: atento a los avisos.', 'Después del rápido o del sprint siempre hay trote para recuperar.', 'Disfruta del juego: aquí no hay una velocidad mala.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const rest = r5(clamp((k.long ? 60 : 45) / k.L, 45, 90));
    const d = k.long ? 90 : 60;
    const gap = k.long ? 60 : 45;
    const roundLen = 2 * d + 60 + 30 + 2 * rest;
    const n = clamp(Math.floor((B + gap - 30) / (roundLen + gap)), 1, 6);
    const make = {
      jog: () => k.jog(d, { off: 0.3, label: 'Trote vivo' }),
      run: () => k.run(d, { off: k.rng.pick([0, 0.2]), label: 'Correr', cue: k.cue('tempo') }),
      fast: () => W(k.fast(60, { label: 'Rápido', cue: k.cue('fast') })),
      sprint: () => W(k.sprint(30, { label: 'Sprint', cue: k.cue('sprint') })),
    };
    const out = [k.flex()];
    for (let r = 0; r < n; r++) {
      const order = k.rng.shuffle(['jog', 'run', 'fast', 'sprint']);
      order.forEach((z, j) => {
        const s = make[z]();
        s.block = `Ronda ${r + 1}`;
        s.rep = { i: r + 1, n };
        out.push(s);
        if ((z === 'fast' || z === 'sprint') && order[j + 1] !== 'jog') out.push(k.rec(rest));
      });
      if (r < n - 1) out.push(k.jog(gap, { label: 'Cambio de ronda', block: 'Recuperación', cue: k.cue('mind') }));
    }
    out.push(k.flex({ label: 'Trote de soltura' }));
    return out.map((s) => { delete s.work; return s; });
  }, { quality: true }),
});

const BOXES = [
  { name: 'Doble minuto', make: (k) => [W(k.fast(60)), k.jog(60, { label: 'Trote' }), W(k.fast(60)), k.rec(90)] },
  { name: 'Chispas', make: (k) => [W(k.sprint(30)), k.rec(90, { off: -0.3 }), W(k.sprint(30)), k.rec(90, { off: -0.3 })] },
  { name: 'Tres de tempo', make: (k) => [W(k.run(180, { off: 0.4, label: 'Tempo' })), k.rec(90)] },
  { name: 'Mini escalera', make: (k) => [W(k.run(60)), W(k.fast(60)), W(k.sprint(30)), k.rec(120)] },
  { name: 'Ola', make: (k) => [W(k.run(90)), W(k.run(60, { off: 0.4 })), W(k.fast(45)), k.rec(90)] },
  { name: 'Aguante', make: (k) => [W(k.run(240, { off: 0.1 })), k.rec(90)] },
  { name: 'Contrarreloj', make: (k) => [W(k.fast(150, { off: -0.2 })), k.rec(120)] },
];

T({
  id: 'surprise', title: 'Caja sorpresa', subtitle: 'Mini retos al azar, uno detrás de otro', category: 'fartlek', focus: 'Variedad y chispa',
  description: 'Cada clase abre cajas distintas: dobles minutos, chispas de sprint, escaleras, tempos… Nunca dos iguales. Perfecta para los días en que la cinta pesa.',
  coachNotes: ['Escucha qué caja se abre: cada una tiene su ritmo.', 'Las cajas cortas se corren con valentía; las largas, con cabeza.', 'Entre caja y caja, trote para llegar con ganas a la siguiente.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const out = [k.flex()];
    let left = B - 90;
    let prev = -1;
    const used = [];
    for (let b = 0; b < 20; b++) {
      const choices = BOXES.map((x, i) => i).filter((i) => i !== prev);
      const fits = choices.filter((i) => total(BOXES[i].make(k)) <= left);
      if (!fits.length) break;
      const idx = k.rng.pick(fits);
      const segs = BOXES[idx].make(k);
      const work = segs.filter((s) => s.work);
      work.forEach((s, j) => {
        delete s.work;
        s.block = `Caja ${b + 1}`;
        if (j === 0) { s.label = `Sorpresa: ${BOXES[idx].name}`; s.cue = k.cue(s.zone === 'sprint' ? 'sprint' : s.zone === 'fast' ? 'fast' : 'tempo'); }
        used.push(s);
        s.rep = { i: b + 1, n: 0 };
      });
      out.push(...segs);
      left -= total(segs);
      prev = idx;
    }
    const n = used.length ? used[used.length - 1].rep.i : 0;
    for (const s of used) s.rep.n = n;
    out.push(k.flex({ label: 'Trote de soltura' }));
    return out;
  }, { quality: true }),
});

T({
  id: 'waves', title: 'Oleaje', subtitle: 'Sube y baja como las olas, sin parar', category: 'fartlek', focus: 'Ritmo continuo variable',
  description: 'Olas continuas: subes poco a poco hasta la cresta a ritmo rápido y vuelves a bajar sin dejar de correr. Un vaivén hipnótico que entrena todo el rango aeróbico.',
  coachNotes: ['Cada ola sube por escalones pequeños: déjate llevar.', 'En la cresta, técnica limpia; en el valle, respira.', 'No hay trote parado: el ritmo baja pero nunca se apaga.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const a = k.rng.pick([90, 120]);
    const b = k.rng.pick([60, 75]);
    const c = k.rng.pick([45, 60]);
    const waveLen = a + 3 * b + c;
    const n = clamp(Math.floor((B - 60) / waveLen), 1, 10);
    const out = [];
    for (let w = 0; w < n; w++) {
      const block = `Ola ${w + 1}`;
      out.push(k.jog(a, { off: 0.3, label: 'Valle', block, cue: w === 0 ? k.cue('easy') : '' }));
      out.push(k.run(b, { off: -0.3, label: 'Subiendo', block }));
      out.push(k.run(b, { off: 0.2, label: 'Casi arriba', block }));
      out.push(W(k.fast(c, { label: 'Cresta', block, cue: w === n - 1 ? k.cue('last') : w === 0 ? k.cue('fast') : '' })));
      out.push(k.run(b, { label: 'Bajando', block }));
    }
    out.push(k.flex({ label: 'Valle final', off: 0.1 }));
    return numberReps(out);
  }),
});

/* ───────────── Cuestas (requieren inclinación) ───────────── */

T({
  id: 'hills-short', title: 'Cuestas cortas', subtitle: 'Subidas de 1′ a 1′30 con fuerte pendiente', category: 'hills', focus: 'Fuerza y potencia', requiresIncline: true,
  description: 'Repeticiones cortas con pendiente marcada: la forma más amable de ganar fuerza en las piernas y potencia en la zancada, sin castigar las articulaciones.',
  coachNotes: ['Inclínate desde los tobillos, no desde la cintura.', 'Brazos activos y pasos cortos en cada subida.', 'Recupera en llano y no te agarres a la barra.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const pct = k.rng.pick([5, 6, 7]);
    const up = k.rng.pick([60, 75, 90]);
    const stairs = k.rng.chance(0.5);
    const rest = r5(clamp(90 / k.L, 75, 150));
    const n = clamp(Math.floor((B - 120 + rest) / (up + rest)), 3, 10);
    const out = [k.flex({ incline: k.inc(1) })];
    for (let i = 0; i < n; i++) {
      const p = stairs ? pct - 1 + (i % 3) : pct;
      out.push(W(k.hill('fast', k.F, p, up, { cue: i === 0 ? k.cue('hill') : i === n - 1 ? k.cue('last') : i % 2 ? k.cue('hill') : '' })));
      if (i < n - 1) out.push(k.rec(rest, { label: 'Recupera en llano', incline: k.inc(1) }));
    }
    out.push(k.flex({ label: 'Trote de soltura', incline: k.inc(1) }));
    return numberReps(out, 'Cuestas');
  }, { quality: true }),
});

T({
  id: 'hill-long', title: 'Colina larga', subtitle: 'Subidas largas con pendiente creciente', category: 'hills', focus: 'Fuerza-resistencia', requiresIncline: true,
  description: 'Una colina de varios minutos en la que la pendiente crece por tramos y, arriba, bajada de premio. Fuerza, resistencia y cabeza en el mismo paquete.',
  coachNotes: ['La velocidad baja cuando sube la pendiente: el esfuerzo es lo que cuenta.', 'Mantén la cadencia aunque la zancada se acorte.', 'En la bajada, suelta piernas y recupera.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const profiles = [[2, 4, 6], [2, 3, 4, 5], [3, 4, 5, 6], [2, 4, 5, 6]];
    const opts = [];
    for (const p of profiles) for (const st of [120, 150, 180]) for (let n = 1; n <= 4; n++) opts.push({ p, st, n });
    const desc = 180;
    const lenOf = (o) => o.n * (o.p.length * o.st + desc) - desc;
    const o = choose(k, opts, lenOf, B, 60);
    const out = [k.flex({ incline: k.inc(1) })];
    for (let c = 0; c < o.n; c++) {
      o.p.forEach((pct, j) => {
        const flat = round1(k.J + 0.4 + ((k.R - 0.1 - (k.J + 0.4)) * j) / Math.max(1, o.p.length - 1));
        const s = W(k.hill(k.near(flat), flat, pct, o.st, { block: `Colina ${c + 1}`, cue: j === 0 ? k.cue('hill') : j === o.p.length - 1 ? k.cue('mind') : '' }));
        if (j > 0) delete s.work;
        out.push(s);
      });
      if (c < o.n - 1) out.push(k.jog(desc, { off: -0.2, label: 'Bajada', incline: k.inc(1), block: 'Recuperación', cue: k.cue('recovery') }));
    }
    out.push(k.flex({ label: 'Trote de soltura', incline: k.inc(1) }));
    return numberReps(out, 'Colinas');
  }),
});

T({
  id: 'rollercoaster', title: 'Montaña rusa', subtitle: 'Pendiente que sube y baja sin descanso', category: 'hills', focus: 'Fuerza y ritmo', requiresIncline: true,
  description: 'Subidas y bajadas encadenadas con pendientes distintas, como un recorrido de montaña. Las piernas trabajan en todos los ángulos y la cabeza no se aburre.',
  coachNotes: ['Cada cambio de pendiente se anuncia: anticípate con la cadencia.', 'En las subidas fuertes, pasos cortos y brazos activos.', 'Aprovecha los tramos llanos para respirar hondo.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const loop = [
      ['jog', k.J + 0.3, 2, 90, 'Falso llano'], ['run', k.R, 5, 60, 'Repecho'], ['jog', k.J, 1, 60, 'Llano'],
      ['run', k.R + 0.2, 6, 60, 'Subida fuerte'], ['jog', k.J + 0.3, 3, 90, 'Tendida'], ['fast', k.F, 8, 45, 'Muro'], ['jog', k.J - 0.2, 1, 90, 'Bajada'],
    ];
    const loopLen = loop.reduce((a, x) => a + x[3], 0);
    const n = clamp(Math.round((B - 60) / loopLen), 1, 6);
    const scale = clamp((B - 60) / (n * loopLen), 0.7, 1.4);
    const out = [];
    for (let r = 0; r < n; r++) {
      loop.forEach(([zone, flat, pct, base, name]) => {
        const sec = Math.max(zone === 'jog' ? 45 : 30, r5(base * scale));
        const p = Math.max(1, pct + (zone !== 'jog' ? k.rng.pick([-1, 0, 0]) : 0));
        const s = k.hill(zone, flat, p, sec, { label: k.hasIncline ? `${name} · ${k.inc(p)} %` : name, block: `Vuelta ${r + 1}`,
          cue: zone === 'fast' ? k.cue('hill') : zone === 'run' && r === 0 ? k.cue('hill') : '' });
        out.push(zone === 'fast' ? W(s) : s);
      });
    }
    out.push(k.flex({ label: 'Trote de soltura', incline: k.inc(1) }));
    return numberReps(out, 'Muros');
  }),
});

T({
  id: 'hill-sprints', title: 'Cuestas explosivas', subtitle: 'Arrancadas de 30–45″ en pendiente fuerte', category: 'hills', focus: 'Potencia', requiresIncline: true,
  description: 'Arrancadas cortas y muy intensas con mucha pendiente: potencia de verdad con menos impacto que un sprint en llano. Corto, duro y muy eficaz.',
  coachNotes: ['Explosivo pero con técnica: rodillas arriba y brazos potentes.', 'Recupera del todo antes de la siguiente: la calidad manda.', 'Si notas los gemelos muy cargados, baja un punto de pendiente.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const pct = k.rng.pick([6, 7, 8]);
    const up = k.rng.pick([30, 40, 45]);
    const zone = up <= 30 ? 'sprint' : 'fast';
    const flat = zone === 'sprint' ? k.S : round1(k.F + (k.S - k.F) * 0.5);
    const rest = r5(clamp(105 / k.L, 90, 150));
    let n = clamp(Math.floor((B - 120 + rest) / (up + rest)), 4, 10);
    if (zone === 'sprint') n = Math.min(n, Math.floor((0.24 * B) / up));
    const out = [k.flex({ incline: k.inc(1) })];
    for (let i = 0; i < n; i++) {
      out.push(W(k.hill(zone, flat, pct, up, { label: k.hasIncline ? `Arrancada ${k.inc(pct)} %` : 'Arrancada', cue: i === 0 ? k.cue('hill') : i === n - 1 ? k.cue('last') : '' })));
      if (i < n - 1) out.push(k.rec(rest, { label: 'Recupera en llano', incline: k.inc(1), off: -0.3 }));
    }
    out.push(k.flex({ label: 'Trote de soltura', incline: k.inc(1) }));
    return numberReps(out, 'Arrancadas');
  }, { quality: true }),
});

/* ───────────── Recuperación ───────────── */

T({
  id: 'easy-strides', title: 'Suave con rectas', subtitle: 'Trote suave y 4–6 rectas de 30″', category: 'recovery', focus: 'Recuperación activa y técnica', durations: [20, 30, 45],
  description: 'Rodaje tranquilo con unas pocas rectas de 30 segundos para recordar a las piernas lo que es ir rápido, sin cansarlas. Recuperas y afinas la técnica.',
  coachNotes: ['Las rectas son rápidas pero relajadas: nada de apretar los dientes.', 'Piensa en técnica: pisada bajo la cadera y brazos sueltos.', 'Entre rectas, trote muy suave hasta respirar tranquilo.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const n = k.L < 0.85 ? 4 : k.minutes >= 30 ? 6 : 4 + k.rng.int(0, 1);
    const off = k.rng.pick([0, 0.2, 0.3]);
    const out = [k.flex({ label: 'Rodaje suave', off: -0.1, cue: k.cue('easy') })];
    for (let i = 0; i < n; i++) {
      out.push(W(k.fast(30, { off, label: 'Recta', block: 'Rectas', cue: i === 0 ? 'Rápido pero suelto: técnica antes que fuerza' : '' })));
      out.push(k.jog(90, { off: -0.3, label: 'Trote muy suave', block: 'Rectas' }));
    }
    out.push(k.flex({ label: 'Rodaje final', off: -0.1 }));
    return numberReps(out);
  }),
});

T({
  id: 'recovery-jog', title: 'Trote regenerativo', subtitle: 'Rodaje muy suave para recuperar', category: 'recovery', focus: 'Recuperación',
  description: 'Un trote suave de verdad para que el cuerpo asimile el trabajo de la semana. Hoy ganas por no apretar: sales con las piernas mejor que entraste.',
  coachNotes: ['Más lento de lo que crees: hoy el objetivo es recuperar.', 'Respira por la nariz si puedes.', 'Si te encuentras muy bien, guarda esas ganas para mañana.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const off = k.rng.pick([-0.5, -0.4, -0.3]);
    const len = k.rng.pick([300, 360]);
    const walkBreak = k.minutes >= 30 && k.rng.chance(0.5);
    const n = Math.max(1, Math.floor((B - (walkBreak ? 60 : 0)) / len));
    const out = [];
    for (let i = 0; i < n; i++) {
      if (walkBreak && i === Math.floor(n / 2)) out.push(k.walkSeg(60, { cue: 'Camina ligero, suelta brazos y respira' }));
      const s = k.jog(len, { off: off + (i % 2 ? 0.1 : 0), label: 'Trote regenerativo', cue: i % 2 === 0 ? k.cue('easy') : '' });
      if (i === n - 1) s.flex = true;
      out.push(s);
    }
    return out;
  }),
});

T({
  id: 'walk-jog', title: 'Trote y paseo', subtitle: 'Bloques de trote suave con paseos activos', category: 'recovery', focus: 'Recuperación muy suave', durations: [20, 30, 45],
  description: 'Trote suave con pausas de paseo activo. Para los días de piernas cansadas o cuando entrenas en tu día de descanso: te mueves, te oxigenas y no sumas fatiga.',
  coachNotes: ['El paseo es activo: zancada larga y brazos en movimiento.', 'Vuelve al trote sin prisa, la cinta sube poco a poco.', 'Es una sesión para sumar salud, no cansancio.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const jogLen = k.rng.pick([240, 300]);
    const n = Math.max(1, Math.floor(B / (jogLen + 60)));
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(k.jog(jogLen, { off: -0.3, label: 'Trote suave', cue: i === 0 ? k.cue('easy') : '' }));
      out.push(k.walkSeg(60, { cue: i === 0 ? 'Paseo activo: zancada larga y brazos en marcha' : '' }));
    }
    out.push(k.flex({ label: 'Trote suave', off: -0.3 }));
    return out;
  }),
});

/* ───────────── Retos ───────────── */

T({
  id: 'no-stop', title: 'Reto sin bajar', subtitle: 'Todo a ritmo de correr tras calentar', category: 'challenge', focus: 'Resistencia mental', durations: [20, 30, 45],
  description: 'Calientas y, a partir de ahí, ni un segundo por debajo de tu ritmo de correr hasta la vuelta a la calma. Un reto de cabeza tanto como de piernas.',
  coachNotes: ['Los primeros minutos parecerán fáciles: no aceleres.', 'Cuando cueste, divide el tiempo en bloques de dos minutos.', 'El remate final es opcional… pero te va a encantar.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const style = k.rng.pick(['steady', 'stairs', 'triple']);
    const base = k.L >= 1.1 ? 0.1 : k.L < 0.85 ? -0.3 : 0;
    const body = B - 60;
    const out = [];
    if (style === 'stairs') {
      const t = r5(body / 3);
      out.push(k.run(t, { off: base - 0.2, label: 'Sin bajar · fase 1', cue: k.cue('tempo') }));
      out.push(k.run(t, { off: base, label: 'Sin bajar · fase 2', cue: k.cue('mind') }));
      out.push(k.run(body - 2 * t, { off: base + 0.2, label: 'Sin bajar · fase 3', cue: k.cue('mind') }));
    } else if (style === 'triple') {
      const gap = r5((body - 180) / 4);
      for (let i = 0; i < 3; i++) {
        out.push(k.run(gap, { off: base, label: 'Sin bajar', cue: i === 0 ? k.cue('tempo') : k.cue('mind') }));
        out.push(k.run(60, { off: base + 0.4, label: 'Subidón', cue: i === 0 ? 'Un minuto un poco más vivo y vuelves' : '' }));
      }
      out.push(k.run(body - 3 * gap - 180, { off: base, label: 'Sin bajar' }));
    } else {
      out.push(k.run(body, { off: base, label: 'Sin bajar', cue: k.cue('mind') }));
    }
    out[0].flex = true;
    out.push(k.run(60, { off: base + 0.5, label: 'Remate', cue: k.cue('last') }));
    return out;
  }),
});

T({
  id: 'sprint-finish', title: 'Final explosivo', subtitle: 'Rodaje firme y un final a sprint', category: 'challenge', focus: 'Velocidad con fatiga',
  description: 'Rodaje y ritmo de correr para cargar las piernas y, cuando parece que todo ha terminado, un final explosivo a sprint. Como llegar a meta en un esprint.',
  coachNotes: ['Dosifica la primera parte: el final lo merece.', 'En los sprints finales, brazos rápidos y mirada al frente.', 'Acaba con una sonrisa: lo has dado todo.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const finale = k.rng.pick(['sprints', 'ladder']);
    const fin = [];
    if (finale === 'sprints') {
      const m = k.long ? 6 : k.minutes >= 30 ? 5 : 4;
      for (let i = 0; i < m; i++) {
        fin.push(W(k.sprint(30, { label: 'Sprint final', block: 'Final explosivo', cue: i === 0 ? k.cue('sprint') : i === m - 1 ? k.cue('last') : '' })));
        if (i < m - 1) fin.push(k.rec(60, { off: -0.3 }));
      }
    } else {
      fin.push(W(k.run(120, { off: 0.3, label: 'Escalera final · correr', block: 'Final explosivo', cue: k.cue('tempo') })));
      fin.push(W(k.fast(90, { label: 'Escalera final · rápido', block: 'Final explosivo', cue: k.cue('fast') })));
      fin.push(W(k.sprint(30, { label: 'Escalera final · sprint', block: 'Final explosivo', cue: k.cue('sprint') })));
      fin.push(k.rec(60, { off: -0.3 }));
      fin.push(W(k.sprint(30, { off: 0.2, label: 'Sprint de meta', block: 'Final explosivo', cue: k.cue('last') })));
    }
    const runBlock = r5(clamp((B - total(fin)) * 0.4, 120, 1200));
    return numberReps([
      k.flex({ label: 'Rodaje', off: 0.3, cue: k.cue('easy') }),
      k.run(runBlock, { label: 'Correr', cue: k.cue('tempo') }),
      k.jog(60, { label: 'Trote antes del final', cue: 'Respira: lo mejor está por llegar' }),
      ...fin,
    ]);
  }, { quality: true }),
});

T({
  id: 'challenge-10k', title: 'Reto 10K', subtitle: '10 kilómetros en una hora', category: 'challenge', focus: 'Distancia y ritmo', durations: [60],
  description: 'Diez kilómetros dentro de la hora, calentamiento y vuelta a la calma incluidos. El ritmo está calculado para que llegues justo: es tu carrera de 10K en casa.',
  coachNotes: ['El ritmo está calculado para los 10 km: no lo subas al principio.', 'Divide el reto en tramos y celebra cada uno.', 'Hidrátate en la mitad y en el último tercio.'],
  build: (ctx) => frame(ctx, (k, B, { warm, cool }) => {
    const km = (segs) => segs.reduce((a, s) => a + (s.speed * s.sec) / 3600, 0);
    const target = (10 - km(warm) - km(cool)) / (B / 3600);
    const v = clamp(round1(target + 0.05), round1(k.R - 0.4), k.between(0.5));
    const offs = [-0.2, -0.1, 0.1, 0, 0.2];
    const part = r5(B / offs.length);
    const out = offs.map((o, i) => k.at(round1(v + o), part, { zone: 'run', label: `Tramo ${i + 1} de ${offs.length}`, block: 'Reto 10K',
      cue: i === 0 ? 'Ritmo calculado: confía en él' : i === offs.length - 1 ? k.cue('last') : k.cue('mind') }));
    out[2].flex = true;
    return out;
  }),
});

T({
  id: 'the-hour', title: 'La hora', subtitle: 'Sesenta minutos progresivos', category: 'challenge', focus: 'Resistencia progresiva', durations: [60],
  description: 'Una hora entera que empieza como un paseo y termina a ritmo vivo. Cada fase un poco más rápida que la anterior. Sesenta minutos que te cambian la cabeza.',
  coachNotes: ['La primera fase es casi un regalo: disfrútala.', 'Bebe en cada cambio de fase a partir de la mitad.', 'La última fase es la recompensa a toda la hora.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const n = 6;
    const start = round1(k.J + 0.2);
    const end = round1(k.R + (k.L >= 1.1 ? 0.5 : k.L < 0.85 ? 0 : 0.3));
    const weights = [1.3, 1.2, 1.1, 0.9, 0.8, 0.7];
    const out = [];
    for (let i = 0; i < n; i++) {
      const s = k.at(round1(start + ((end - start) * i) / (n - 1)), r5((B * weights[i]) / 6), { label: `Fase ${i + 1} de ${n}`, block: 'La hora',
        cue: i === 0 ? k.cue('easy') : i === n - 1 ? k.cue('last') : k.cue('mind') });
      if (i === 0) s.flex = true;
      out.push(s);
    }
    return out;
  }),
});

T({
  id: 'pyramid-xl', title: 'Pirámide XL', subtitle: '1-2-3-4(-5)-…-1 minutos', category: 'challenge', focus: 'Resistencia a velocidad', durations: LONG,
  description: 'La pirámide grande: de uno a cuatro o cinco minutos y vuelta, con la velocidad bajando a medida que el tramo se alarga. Una sesión épica para los días con hambre.',
  coachNotes: ['Los tramos cortos van rápidos; los largos, a ritmo sostenible.', 'La cima es mental: piensa solo en el minuto en el que estás.', 'La bajada se hace más fácil: aprovéchala para correr bonito.'],
  build: (ctx) => frame(ctx, (k, B) => {
    const speedOf = { 1: k.F + 0.3, 2: k.F, 3: k.between(0.6), 4: k.between(0.3), 5: k.R };
    const restOf = (m) => r5(clamp((m * 30) / k.L, 60, 150));
    const shape = (peak) => {
      const up = Array.from({ length: peak - 1 }, (_, i) => i + 1);
      return [...up, peak, ...up.slice().reverse()];
    };
    const len = (st) => st.reduce((a, m, i) => a + m * 60 + (i < st.length - 1 ? restOf(m) : 0), 0);
    const peak = choose(k, [3, 4, 5], (p) => len(shape(p)), B, 60);
    const st = shape(peak);
    const out = [k.flex()];
    st.forEach((m, i) => {
      out.push(W(k.at(round1(speedOf[m]), m * 60, { label: m === peak ? `Cima · ${m} min` : `${m} min`, block: 'Pirámide XL',
        cue: i === 0 ? k.cue('first') : m === peak ? k.cue('mind') : m <= 2 ? k.cue('fast') : k.cue('tempo') })));
      if (i < st.length - 1) out.push(k.rec(restOf(m)));
    });
    out.push(k.flex({ label: 'Trote de soltura' }));
    return numberReps(out);
  }, { quality: true }),
});

/* ───────────── Test ───────────── */

T({
  id: 'test-vam', title: 'Test VAM', subtitle: 'Escalones de 1′ hasta que no puedas más', category: 'test', focus: 'Medir tu VAM', durations: [20, 30],
  description: 'Escalones de un minuto que suben 0,5 km/h cada vez. Corres hasta que no puedas más, pulsas «No puedo más» y calculamos tu VAM para recalcular tus cuatro velocidades.',
  coachNotes: ['Llega descansado: nada de entrenos duros el día anterior.', 'No te agarres a la barra: falsea el resultado.', 'Cuando no puedas mantener la velocidad, pulsa «No puedo más» sin miedo.', 'Inicia «Cinta de correr» en tu Apple Watch para ver el pulso máximo.'],
  build(ctx) {
    const k = kit(ctx);
    const tm = ctx.treadmill || {};
    const maxS = Number(tm.maxSpeed) || 18;
    let sp = round1(k.J - 0.3);
    // Techo del test: tu VAM esperada + 2 km/h (+3 en la versión de 30′), así la duración real se acerca a la
    // anunciada; nunca por debajo de rápido + 1 ni por encima de la cinta.
    const vam = vamFromLevels(ctx.levels);
    const top = Math.min(maxS, Math.max(k.F + 1, vam + (k.minutes >= 30 ? 3 : 2)));
    // El trote de calentamiento queda por debajo del primer escalón (la carga siempre sube)
    const mid = round1((k.wu + Math.min(k.J, sp - 0.3)) / 2);
    const segs = [
      k.seg('warmup', 120, { speed: k.wu, label: 'Calentamiento suave', block: 'Calentamiento', cue: k.cue('warm') }),
      k.seg('warmup', 90, { speed: Math.min(mid, sp - 0.4), label: 'Calentamiento', block: 'Calentamiento' }),
      k.jog(90, { speed: round1(sp - 0.3), label: 'Trote suave', block: 'Calentamiento', cue: 'Prepárate: en nada empieza el primer escalón' }),
    ];
    for (let n = 1; sp <= top + 1e-9 && n <= 30; n++) {
      const cue = n === 1 ? 'Primer escalón: suave, lo duro llega solo'
        : Math.abs(sp - k.F) < 0.26 ? 'Ritmo rápido: aquí empieza el test de verdad'
          : sp > k.S ? 'Aguanta el minuto entero si puedes' : '';
      segs.push(k.seg(zoneForSpeed(sp, ctx.levels), 60, { speed: sp, label: `Escalón ${n}`, block: 'Test', cue }));
      segs[segs.length - 1].stage = n;
      sp = round1(sp + 0.5);
    }
    segs.push(k.seg('cooldown', 90, { speed: round1(k.J - 0.8), block: 'Vuelta a la calma', cue: k.cue('cool') }));
    segs.push(k.seg('cooldown', 90, { speed: k.cd, block: 'Vuelta a la calma' }));
    for (const s of segs) if (s.stage == null) s.stage = 0;
    return segs;
  },
});

/* ───────────── Consultas ───────────── */

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

export function getTemplate(id) {
  return BY_ID.get(id) || null;
}

/** Plantillas filtradas. `minutes` acepta cualquier valor dentro del rango [mín, máx] de sus duraciones. */
export function templatesFor({ category = 'all', minutes = null, hasIncline = false } = {}) {
  const m = minutes == null ? null : Number(minutes);
  return TEMPLATES.filter((t) => {
    if (category && category !== 'all' && t.category !== category) return false;
    if (t.requiresIncline && !hasIncline) return false;
    if (m != null && Number.isFinite(m)) {
      const lo = Math.min(...t.durations);
      const hi = Math.max(...t.durations);
      if (m < lo || m > hi) return false;
    }
    return true;
  });
}
