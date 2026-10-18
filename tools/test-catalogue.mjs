// BestRunning · test del catálogo de clases (Node 22): node tools/test-catalogue.mjs [--verbose]
// Valida el contrato de temporada (family, themes, intensity, durations, event) y construye TODAS las plantillas en
// cada duración admitida (de 5 en 5 minutos) con los niveles del dueño, varias semillas, cargas e inclinación.
// Sale con código ≠ 0 si algo falla.
import { CATEGORIES, TEMPLATES, THEMES, FAMILIES, INTENSITIES, EVENT_KEYS, templatesFor } from '../js/training/templates.js';
import { buildWorkout } from '../js/training/generator.js';
import { ZONES } from '../js/training/levels.js';

const VERBOSE = process.argv.includes('--verbose');
let checks = 0;
let fails = 0;
const failures = [];
function ok(cond, msg) {
  checks++;
  if (!cond) {
    fails++;
    if (failures.length < 60) failures.push(msg);
  }
  return !!cond;
}

const OWNER = { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 };
const OTHERS = [{ jog: 9.1, run: 11.0, fast: 12.6, sprint: 14.4 }, { jog: 7.4, run: 8.6, fast: 9.6, sprint: 10.8 }];
const TM = { minSpeed: 1.0, maxSpeed: 18.0, maxIncline: 12, announceLead: 10 };
const SEEDS = [1, 5, 42, 777, 20261012];
const LOADS = [0.65, 0.8, 1, 1.15, 1.3];
const ORIGINAL = 39;

const minutesFor = (t) => {
  const lo = Math.min(...t.durations);
  const hi = Math.max(...t.durations);
  const out = new Set(t.durations);
  for (let m = lo; m <= hi; m += 5) out.add(m);
  return [...out].sort((a, b) => a - b);
};
const supports = (t, m) => m >= Math.min(...t.durations) && m <= Math.max(...t.durations);

/* ═════════════ 1. Contrato ═════════════ */

ok(TEMPLATES.length >= 104, `≥ 104 plantillas (hay ${TEMPLATES.length})`);
ok(TEMPLATES.length - ORIGINAL >= 65, `≥ 65 plantillas nuevas (hay ${TEMPLATES.length - ORIGINAL})`);
const ids = TEMPLATES.map((t) => t.id);
const titles = TEMPLATES.map((t) => t.title.toLowerCase());
ok(new Set(ids).size === ids.length, `ids únicos (${ids.filter((x, i) => ids.indexOf(x) !== i).join(', ')})`);
ok(new Set(titles).size === titles.length, `títulos únicos (${titles.filter((x, i) => titles.indexOf(x) !== i).join(', ')})`);
ok(THEMES.length === 12 && new Set(THEMES).size === 12, '12 temas de mesociclo');

for (const [i, t] of TEMPLATES.entries()) {
  const tag = t.id;
  ok(/^[a-z0-9-]+$/.test(t.id), `${tag}: id en minúsculas con guiones`);
  ok(t.title && t.subtitle && t.focus && t.description && CATEGORIES[t.category], `${tag}: textos y categoría`);
  ok(typeof t.description === 'string' && t.description.length >= 60, `${tag}: descripción con contenido`);
  ok(FAMILIES.includes(t.family), `${tag}: family «${t.family}» válida`);
  ok(Array.isArray(t.themes) && t.themes.length >= 1 && t.themes.length <= 3 && t.themes.every((x) => THEMES.includes(x)), `${tag}: themes ⊂ THEMES (${t.themes})`);
  ok(new Set(t.themes).size === t.themes.length, `${tag}: themes sin repetir`);
  ok(INTENSITIES.includes(t.intensity), `${tag}: intensity «${t.intensity}»`);
  ok(Array.isArray(t.durations) && t.durations.length && t.durations.every((m) => Number.isInteger(m) && m >= 15 && m <= 90), `${tag}: duraciones`);
  ok(t.event === undefined || EVENT_KEYS.includes(t.event), `${tag}: event válido`);
  ok(t.requiresIncline === (t.category === 'hills'), `${tag}: requiresIncline solo en cuestas`);
  ok(t.family !== 'test' || t.category === 'test', `${tag}: familia test solo en el test`);
  ok(typeof t.build === 'function', `${tag}: build()`);
  const notes = t.coachNotes || [];
  ok(i < ORIGINAL ? notes.length >= 2 && notes.length <= 4 : notes.length >= 2 && notes.length <= 3, `${tag}: coachNotes (${notes.length})`);
  ok(notes.every((n) => typeof n === 'string' && n.length > 10 && /[.!?»]$/.test(n.trim())), `${tag}: coachNotes con frase completa`);
  ok(![t.title, t.subtitle, t.description, t.focus, ...notes].some((s) => /undefined|NaN|TODO|\s{2,}/.test(s)), `${tag}: textos limpios`);
  ok(t.category !== 'hills' || t.themes.includes('Cuestas'), `${tag}: cuestas lleva el tema Cuestas`);
  ok(!t.themes.includes('Cuestas') || t.category === 'hills', `${tag}: el tema Cuestas solo en clases con inclinación`);
}

// Cobertura para que la temporada pueda rotar sin repetir
const pool = TEMPLATES.filter((t) => t.category !== 'test');
for (const th of THEMES) {
  const n = pool.filter((t) => t.themes.includes(th));
  ok(n.length >= 6, `tema «${th}» con ≥ 6 clases (hay ${n.length})`);
  ok(n.some((t) => supports(t, 20)), `tema «${th}» con clases de 20′`);
  ok(n.some((t) => supports(t, 50)), `tema «${th}» con clases de 50′`);
}
for (const f of FAMILIES.filter((x) => x !== 'test')) ok(pool.filter((t) => t.family === f).length >= 2, `familia ${f} con ≥ 2 clases`);
const at = (m, int, inc = false) => pool.filter((t) => supports(t, m) && t.intensity === int && (!t.requiresIncline || inc) && !t.event).length;
ok(at(20, 'easy') >= 10, `≥ 10 clases suaves de 20′ sin inclinación (hay ${at(20, 'easy')})`);
ok(at(20, 'moderate') >= 10, `≥ 10 clases moderadas de 20′ sin inclinación (hay ${at(20, 'moderate')})`);
ok(at(20, 'hard') >= 20, `≥ 20 clases duras de 20′ sin inclinación (hay ${at(20, 'hard')})`);
ok(at(50, 'easy') >= 5, `≥ 5 clases suaves de 50′ (hay ${at(50, 'easy')})`);
ok(at(50, 'moderate') >= 12, `≥ 12 clases moderadas de 50′ (hay ${at(50, 'moderate')})`);
ok(at(50, 'hard') >= 10, `≥ 10 clases duras de 50′ (hay ${at(50, 'hard')})`);
for (const ev of EVENT_KEYS) ok(TEMPLATES.some((t) => t.event === ev && supports(t, 20)) && TEMPLATES.some((t) => t.event === ev && supports(t, 50)), `evento ${ev} con clase de 20′ y de 50′`);
ok(templatesFor({ theme: 'Cuestas', hasIncline: false }).length === 0, 'templatesFor por tema respeta la inclinación');
ok(templatesFor({ family: 'musica', minutes: 20 }).every((t) => t.family === 'musica') && templatesFor({ family: 'musica', minutes: 20 }).length >= 4, 'templatesFor por familia');
ok(templatesFor({ intensity: 'easy' }).every((t) => t.intensity === 'easy'), 'templatesFor por intensidad');
ok(templatesFor({ event: false }).every((t) => !t.event) && templatesFor({ event: 'navidad' }).every((t) => t.event === 'navidad'), 'templatesFor por evento');
ok(templatesFor({}).length === TEMPLATES.filter((t) => !t.requiresIncline).length, 'templatesFor sin filtros nuevos no cambia');

/* ═════════════ 2. Construcción en cada duración admitida ═════════════ */

let built = 0;
const sigs = new Map();
const intensityStats = {};
for (const t of TEMPLATES) {
  const test = t.category === 'test';
  const incOpts = t.requiresIncline ? [true, false] : [false, true];
  for (const minutes of minutesFor(t)) {
    for (const [li, levels] of [OWNER, ...OTHERS].entries()) {
      for (const seed of SEEDS) {
        for (const loadFactor of LOADS) {
          for (const hasIncline of incOpts) {
            if (li > 0 && (loadFactor !== 1 || seed > 42)) continue;
            const tag = `${t.id} ${minutes}′ s${seed} c${loadFactor}${hasIncline ? ' inc' : ''}${li ? ` niv${li}` : ''}`;
            let w = null;
            try {
              w = buildWorkout(t.id, { minutes, levels, seed, loadFactor, hasIncline, treadmill: { ...TM, hasIncline }, weightKg: 78 });
            } catch (e) {
              ok(false, `${tag}: lanza ${e.message}`);
              continue;
            }
            built++;
            if (!ok(w && w.segments.length >= 3, `${tag}: segmentos`)) continue;
            const segs = w.segments;
            const sum = segs.reduce((a, s) => a + s.sec, 0);
            if (!test) ok(sum === minutes * 60, `${tag}: total ${sum}s ≠ ${minutes * 60}s`);
            ok(segs[0].zone === 'warmup' && segs[segs.length - 1].zone === 'cooldown', `${tag}: calentamiento y vuelta a la calma`);
            const warm = segs.filter((s) => s.zone === 'warmup').reduce((a, s) => a + s.sec, 0);
            const cool = segs.filter((s) => s.zone === 'cooldown').reduce((a, s) => a + s.sec, 0);
            ok(warm >= 120 && cool >= 120, `${tag}: calentamiento ${warm}s y calma ${cool}s`);
            let fastRun = 0;
            for (const [i, s] of segs.entries()) {
              const where = `${tag} seg ${i} (${s.zone} ${s.sec}s ${s.speed} km/h ${s.incline} %)`;
              ok(ZONES[s.zone], `${where}: zona`);
              ok(Number.isInteger(s.sec) && s.sec % 5 === 0 && s.sec >= 30, `${where}: duración`);
              ok(s.speed >= TM.minSpeed && s.speed <= TM.maxSpeed && Number.isInteger(Math.round(s.speed * 10)) && Math.abs(s.speed * 10 - Math.round(s.speed * 10)) < 1e-9, `${where}: velocidad dentro de la cinta`);
              ok(s.incline >= 0 && s.incline <= 12 && s.incline <= 8, `${where}: inclinación ≤ 8 % (máx. cinta 12 %)`);
              if (!hasIncline || t.category !== 'hills') ok(s.incline === 0, `${where}: inclinación solo en cuestas con cinta inclinable`);
              ok(typeof s.label === 'string' && s.label.trim() && !/undefined|NaN|null/.test(`${s.label} ${s.cue || ''} ${s.block || ''}`), `${where}: etiqueta`);
              if (!test && s.zone === 'sprint') ok(s.sec <= 60, `${where}: sprint ≤ 60 s`);
              if (s.zone === 'walk') ok(s.speed <= 7.5, `${where}: caminar a paso de marcha`);
              if (s.rep) ok(s.rep.i >= 1 && s.rep.i <= s.rep.n, `${where}: rep`);
              fastRun = s.zone === 'fast' ? fastRun + s.sec : 0;
              if (!test) ok(fastRun <= 480, `${where}: rápido continuo ${fastRun}s > 8′`);
            }
            if (t.requiresIncline && hasIncline) ok(segs.some((s) => s.incline >= 2), `${tag}: cuestas con pendiente real`);
            if (li === 0 && seed === 1 && loadFactor === 1 && hasIncline === incOpts[0] && (minutes === 20 || minutes === 50)) {
              const sig = segs.map((s) => `${s.zone}${s.sec}@${s.speed}/${s.incline}`).join('|');
              const key = `${minutes}:${sig}`;
              ok(!sigs.has(key), `${t.id} ${minutes}′: clase idéntica a ${sigs.get(key)}`);
              sigs.set(key, t.id);
            }
            if (li === 0 && loadFactor === 1 && !test) {
              const st = (intensityStats[t.id] ||= { tot: 0, hard: 0, run: 0, n: 0 });
              st.tot += sum;
              st.hard += w.timeInZone.fast + w.timeInZone.sprint;
              st.run += w.timeInZone.run;
              st.n++;
            }
          }
        }
      }
    }
  }
}

// La intensidad declarada se corresponde con lo que se corre
for (const t of TEMPLATES) {
  const st = intensityStats[t.id];
  if (!st) continue;
  const hard = st.hard / st.tot;
  const run = st.run / st.tot;
  if (t.intensity === 'easy') ok(hard <= 0.12 && run <= 0.15, `${t.id}: «easy» pero ${Math.round(hard * 100)} % rápido y ${Math.round(run * 100)} % correr`);
  if (t.intensity === 'hard') ok(hard >= 0.05 || run >= 0.45, `${t.id}: «hard» pero solo ${Math.round(hard * 100)} % rápido y ${Math.round(run * 100)} % correr`);
  if (t.intensity === 'moderate') ok(hard + run >= 0.08, `${t.id}: «moderate» sin trabajo de calidad`);
}

/* ═════════════ Informe ═════════════ */

const byCat = Object.keys(CATEGORIES).map((c) => `${CATEGORIES[c].name} ${TEMPLATES.filter((t) => t.category === c).length}`).join(' · ');
console.log(`Catálogo: ${TEMPLATES.length} plantillas (${TEMPLATES.length - ORIGINAL} nuevas) · ${byCat}`);
console.log(`Intensidad: ${INTENSITIES.map((i) => `${i} ${TEMPLATES.filter((t) => t.intensity === i).length}`).join(' · ')}`);
console.log(`Temas: ${THEMES.map((th) => `${th} ${pool.filter((t) => t.themes.includes(th)).length}`).join(' · ')}`);
console.log(`Familias: ${FAMILIES.map((f) => `${f} ${TEMPLATES.filter((t) => t.family === f).length}`).join(' · ')}`);
console.log(`Eventos: ${EVENT_KEYS.map((e) => `${e} ${TEMPLATES.filter((t) => t.event === e).map((t) => t.id).join('/')}`).join(' · ')}`);
console.log(`Construcción: ${built} clases (20′/50′ sin inclinación: suaves ${at(20, 'easy')}/${at(50, 'easy')} · moderadas ${at(20, 'moderate')}/${at(50, 'moderate')} · duras ${at(20, 'hard')}/${at(50, 'hard')})`);
if (VERBOSE) {
  for (const t of TEMPLATES.slice(ORIGINAL)) {
    const w = buildWorkout(t.id, { minutes: supports(t, 20) ? 20 : 50, levels: OWNER, seed: 1, loadFactor: 1, hasIncline: t.requiresIncline, treadmill: { ...TM, hasIncline: t.requiresIncline } });
    console.log(`\n${t.title} (${t.id}) · ${w.minutes}′ · ${t.family} · ${t.intensity} · ${t.themes.join(', ')}${t.event ? ` · evento ${t.event}` : ''}`);
    for (const s of w.segments) console.log(`    ${String(Math.floor(s.sec / 60)).padStart(2)}:${String(s.sec % 60).padStart(2, '0')} ${s.label} ${String(s.speed).replace('.', ',')}${s.incline ? ` · ${s.incline} %` : ''}`);
  }
}
if (fails) {
  console.log(`\n✗ ${fails} de ${checks} comprobaciones fallan:`);
  for (const f of failures) console.log(`  - ${f}`);
  if (fails > failures.length) console.log(`  … y ${fails - failures.length} más`);
  process.exit(1);
}
console.log(`\n✓ ${checks} comprobaciones correctas`);
