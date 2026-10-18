#!/usr/bin/env node
// BestRunning · pruebas del Atajo «BestRunning FC» v2.2 generado (tools/watch/build-shortcut.py):
// 1) parseWatchHr acepta el texto EXACTO que copia el Atajo v2.2 (Diccionario → Texto JSON con las listas paralelas
//    t / bpm / n / t2) y el formato antiguo (csv "<ISO 8601>,<valor>" de la v2.1 y del Atajo hecho a mano), con sus
//    variantes realistas (coma decimal del iPhone en español, «.0», Z, unidades, CRLF, listas que no cuadran…);
// 2) la petición de la app; 3) la búsqueda amplia: miles de lecturas de otros días, "mode":"wide", rapidez;
// 4) el Atajo generado (out/BestRunning-FC.json) cumple el contrato: nombre, claves, filtros de Salud, orden;
// 5) simulación del plist generado con un Salud falso: ventana, amplia, sin sesión, SIN PERMISO (no copia nada),
//    autodiagnóstico sin entrada y, v2.2, que no hay Repetir (pocas acciones ejecutadas aunque haya 560 lecturas).
// Uso: node tools/test-watch-shortcut.mjs   · sale con código ≠ 0 si algo falla.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

if (!process.env.TZ) process.env.TZ = 'Europe/Madrid';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = await import('../js/integrations/watch-hr.js');
const { parseWatchHr, watchHrPayload, watchHrUrl, isoLocal, SHORTCUT_NAME, SHORTCUT_INPUT_KEYS, SHORTCUT_OUTPUT_KEYS } = W;

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else fails.push(msg); };

/* ───────────── Sesión falsa: 18 oct 2026, 11:34 (CEST), 47 min ───────────── */

const START = new Date(2026, 9, 18, 11, 34, 0).getTime();
const DUR = 47 * 60;
const SES = { id: 'ses_fc_test', startedAt: new Date(START).toISOString(), elapsedSec: DUR, plannedSec: DUR };

// Muestras del Watch cada 5 s (como en un entreno): sube de 96 a ~170 y baja; desde +5 s hasta el final - 5 s.
const SAMPLES = [];
for (let t = 5; t <= DUR - 5; t += 5) {
  const x = t / DUR;
  SAMPLES.push({ ms: START + t * 1000, bpm: Math.round(96 + 75 * Math.sin(Math.PI * Math.min(1, x * 1.15))) });
}
const VALS = SAMPLES.map((p) => p.bpm);
const EXP_MAX = Math.max(...VALS);
const EXP_MIN = Math.min(...VALS);
const EXP_AVG = VALS.reduce((a, b) => a + b, 0) / VALS.length;

// Lo que hace el Atajo: Texto "[Fecha de inicio ISO 8601],[Valor]" por muestra, combinado con saltos de línea.
const isoZ = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const csvOf = ({ date = isoLocal, val = (b) => String(b), sep = '\n' } = {}) => SAMPLES.map((p) => `${date(p.ms)},${val(p.bpm)}`).join(sep);
// Diccionario → Texto: JSON compacto (claves en el orden del Atajo). Calcular estadísticas da decimales largos.
const dictText = (csv, extra = {}) => JSON.stringify({ v: 1, id: SES.id, avg: EXP_AVG, max: EXP_MAX, min: EXP_MIN, csv, ...extra });

function check(label, text, { avgTol = 1.5, n = SAMPLES.length, warn = null } = {}) {
  const r = parseWatchHr(text, SES);
  ok(r?.ok === true, `${label}: debería parsear (${r?.error || 'sin error'})`);
  if (!r?.ok) return r;
  ok(r.source === 'json' || !text.trim().startsWith('{'), `${label}: fuente ${r.source}`);
  ok(r.samples === n, `${label}: ${r.samples} muestras ≠ ${n}`);
  ok(r.hrMax === EXP_MAX, `${label}: máx ${r.hrMax} ≠ ${EXP_MAX}`);
  ok(r.hrMin === EXP_MIN, `${label}: mín ${r.hrMin} ≠ ${EXP_MIN}`);
  ok(Math.abs(r.hrAvg - EXP_AVG) <= avgTol, `${label}: media ${r.hrAvg} ≉ ${EXP_AVG.toFixed(1)}`);
  const ser = r.hrSeries || [];
  // 5 s entre muestras → 1 punto cada 10 s, ~DUR/10 puntos, en orden y dentro de la sesión
  ok(ser.length >= Math.floor((DUR - 10) / 10) && ser.length <= Math.ceil(DUR / 10) + 1, `${label}: ${ser.length} puntos de serie`);
  ok(ser.every((p, i) => p[0] >= 0 && p[0] <= DUR && (i === 0 || p[0] > ser[i - 1][0])), `${label}: serie ordenada y dentro de la sesión`);
  ok(ser.every((p) => Number.isInteger(p[1]) && p[1] >= EXP_MIN && p[1] <= EXP_MAX), `${label}: valores de serie plausibles`);
  // El punto del minuto 10 debe ser el pulso de las muestras de ese tramo
  const at = ser.find((p) => p[0] === 600);
  const exp600 = Math.round((SAMPLES.find((p) => p.ms === START + 600e3).bpm + SAMPLES.find((p) => p.ms === START + 605e3).bpm) / 2);
  ok(at && Math.abs(at[1] - exp600) <= 1, `${label}: punto t=600 ${at?.[1]} ≉ ${exp600}`);
  if (warn) ok(r.warnings.some((w) => warn.test(w)), `${label}: aviso esperado ${warn}`);
  else ok(!r.warnings.length, `${label}: sin avisos (${r.warnings.join(' | ')})`);
  return r;
}

/* ───────────── 1. Salida del Atajo y variantes ───────────── */

check('JSON exacto del Atajo (ISO con +02:00, enteros)', dictText(csvOf()));
check('valores «119.0»', dictText(csvOf({ val: (b) => `${b}.0` })));
check('valores con coma decimal del iPhone en español «119,0»', dictText(csvOf({ val: (b) => `${b},0` })));
check('fechas ISO en UTC «Z»', dictText(csvOf({ date: isoZ })));
check('fechas ISO con milisegundos', dictText(csvOf({ date: (ms) => new Date(ms).toISOString() })));
check('valor con unidad «119 lpm»', dictText(csvOf({ val: (b) => `${b} lpm` })));
check('valor con unidad «119 count/min»', dictText(csvOf({ val: (b) => `${b} count/min` })));
check('valor con unidad «119 latidos/min»', dictText(csvOf({ val: (b) => `${b} latidos/min` })));
check('media/máx/mín como texto español «138,47»', dictText(csvOf(), { avg: EXP_AVG.toFixed(2).replace('.', ','), max: `${EXP_MAX}`, min: `${EXP_MIN}` }));
check('JSON con formato (saltos y sangría) y barras escapadas', JSON.stringify({ v: 1, id: SES.id, avg: EXP_AVG, max: EXP_MAX, min: EXP_MIN, csv: csvOf({ val: (b) => `${b} count/min` }) }, null, 2).replace(/\//g, '\\/'));
check('claves en otro orden y v como texto', JSON.stringify({ csv: csvOf(), min: EXP_MIN, max: EXP_MAX, avg: EXP_AVG, id: SES.id, v: '1' }));
check('saltos de línea CRLF', dictText(csvOf({ sep: '\r\n' })));
check('solo el csv (sin Diccionario)', csvOf());
check('portapapeles con espacio y BOM delante', `﻿  ${dictText(csvOf())}\n`);
check('muestras sueltas fuera de la ventana (margen de 60 s del Atajo)', dictText(
  [`${isoLocal(START - 50e3)},88`, csvOf(), `${isoLocal(START + DUR * 1000 + 50e3)},90`].join('\n'),
));
check('id «prueba» (Atajo ejecutado a mano) con la hora de la sesión', dictText(csvOf(), { id: 'prueba' }), { warn: /otra sesión/ });

// Atajo sin lecturas: no copia nada (muestra una notificación); si alguien pega un Diccionario vacío, error claro
{
  const r = parseWatchHr(JSON.stringify({ v: 1, id: SES.id, avg: '', max: '', min: '', csv: '' }), SES);
  ok(r.ok === false && typeof r.error === 'string', 'Diccionario vacío: error claro');
}
// Lo que la app ENVÍA al Atajo no se confunde con la respuesta
{
  const r = parseWatchHr(JSON.stringify(watchHrPayload(SES)), SES);
  ok(r.ok === false && /envía al Atajo/.test(r.error), 'petición pegada por error: mensaje específico');
}

/* ───────────── 1b. Atajo v2.2: listas paralelas t / bpm / n (sin csv) ───────────── */

// Lo que copia la v2.2: «Combinar texto» con saltos de línea de cada lista, en el mismo orden (más recientes primero)
const listsOf = ({ arr = SAMPLES, date = isoLocal, val = (b) => String(b), sep = '\n', tail = '', n = arr.length, t2 = true } = {}) => {
  const t = arr.map((p) => date(p.ms)).join(sep) + tail;
  const o = { n, t, bpm: arr.map((p) => val(p.bpm)).join(sep) + tail };
  if (t2) o.t2 = t;
  return o;
};
const listText = (lists, extra = {}) => JSON.stringify({ v: 1, id: SES.id, avg: EXP_AVG, max: EXP_MAX, min: EXP_MIN, ...lists, mode: 'window', ...extra });
const REV = [...SAMPLES].reverse(); // la búsqueda 1 es «Más reciente primero»

check('v2.2: t/bpm/n/t2 exactos (más recientes primero, +02:00)', listText(listsOf({ arr: REV })));
check('v2.2: sin t2 ni n', listText(listsOf({ t2: false, n: undefined })));
check('v2.2: fechas «Z»', listText(listsOf({ date: isoZ })));
check('v2.2: fechas con milisegundos y Z', listText(listsOf({ date: (ms) => new Date(ms).toISOString() })));
check('v2.2: fechas con desfase -05:00 (otra zona, mismo instante)', listText(listsOf({ date: (ms) => { const d = new Date(ms - 5 * 3600e3); return `${d.toISOString().slice(0, 19)}-05:00`; } })));
check('v2.2: valores con coma decimal «119,0»', listText(listsOf({ val: (b) => `${b},0` })));
check('v2.2: valores con punto decimal «119.0»', listText(listsOf({ val: (b) => `${b}.0` })));
check('v2.2: valores con unidad «119 lpm» / «119 count/min»', listText(listsOf({ val: (b) => (b % 2 ? `${b} lpm` : `${b} count/min`) })));
check('v2.2: CRLF', listText(listsOf({ sep: '\r\n' })));
check('v2.2: salto de línea al final de cada lista', listText(listsOf({ tail: '\n' })));
check('v2.2: n como texto', listText({ ...listsOf(), n: String(SAMPLES.length) }));
check('v2.2: listas JSON (no texto)', listText({ n: SAMPLES.length, t: SAMPLES.map((p) => isoLocal(p.ms)), bpm: SAMPLES.map((p) => p.bpm) }));
check('v2.2: con csv vacío además', listText({ ...listsOf(), csv: '' }));
{
  // Decimales de verdad: los valores con coma deben leerse como 119,5 → 119.5 (y no 119 ni 1195)
  const dec = SAMPLES.map((p, i) => ({ ms: p.ms, bpm: p.bpm + (i % 2 ? 0.5 : 0) }));
  const r = parseWatchHr(listText(listsOf({ arr: dec, val: (b) => String(b).replace('.', ',') })), SES);
  const r2 = parseWatchHr(listText(listsOf({ arr: dec })), SES);
  const exp = dec.reduce((a, p) => a + p.bpm, 0) / dec.length;
  ok(r.ok && Math.abs(r.hrAvg - exp) <= 1.5 && r.hrMax === Math.round(Math.max(...dec.map((p) => p.bpm))), `v2.2: decimales con coma (media ${r.hrAvg} ≈ ${exp.toFixed(1)}, máx ${r.hrMax})`);
  ok(r2.ok && r2.hrAvg === r.hrAvg && r2.hrMax === r.hrMax, 'v2.2: coma y punto decimal dan lo mismo');
}
// Listas que no cuadran: nunca rompe, usa las parejas alineadas y avisa
check('v2.2: n distinto de las listas → aviso', listText({ ...listsOf(), n: SAMPLES.length + 3 }), { warn: /no cuadran/ });
{
  const L = listsOf({ t2: false });
  const short = { ...L, bpm: L.bpm.split('\n').slice(0, -20).join('\n') }; // faltan los 20 últimos pulsos
  const r = parseWatchHr(listText(short), SES);
  ok(r.ok && r.samples === SAMPLES.length - 20 && r.warnings.includes(`Las listas del Atajo no cuadran (${SAMPLES.length} fechas, ${SAMPLES.length - 20} pulsos, n = ${SAMPLES.length}): se usan las ${SAMPLES.length - 20} primeras parejas.`), `v2.2: faltan pulsos al final → ${r.samples} lecturas alineadas y aviso (${r.warnings})`);
  ok(r.ok && r.hrMax === EXP_MAX && r.hrSeries.every((p) => p[0] <= DUR), 'v2.2: con pulsos de menos, los alineados siguen bien');
}
{
  // «Formatear fecha» que no recorriera la lista (una sola fecha) → la app usa t2 y no avisa
  const L = listsOf();
  check('v2.2: t con una sola fecha → usa t2', listText({ ...L, t: L.t.split('\n')[0] }));
  // t con todas las fechas en UNA línea separadas por espacios (otro separador) → se separan por fecha ISO
  check('v2.2: t en una línea separada por espacios', listText({ ...L, t: L.t.replace(/\n/g, ' '), t2: undefined }));
  // t vacío pero csv antiguo presente → csv
  check('v2.2: t/bpm vacíos y csv antiguo → csv', listText({ t: '', bpm: '', n: 0, csv: csvOf() }));
  // t roto (texto ajeno) y csv bueno → csv
  check('v2.2: t ilegible y csv antiguo → csv', listText({ t: 'hola\nque tal', bpm: '1\n2', csv: csvOf() }));
  // basura en t y bpm, sin csv ni estadísticas: error claro, sin excepción
  let r;
  try { r = parseWatchHr(JSON.stringify({ v: 1, id: SES.id, t: 'x\ny', bpm: 'a\nb', n: 2 }), SES); } catch (e) { r = { ok: 'crash ' + e.message }; }
  ok(r.ok === false && typeof r.error === 'string', `v2.2: listas basura → error claro (${r.ok}, ${r.error})`);
  // sin ninguna lectura pero con estadísticas: igual que antes (media sin gráfico)
  r = parseWatchHr(JSON.stringify({ v: 1, id: SES.id, avg: 140, max: 170, min: 95, n: 0, t: '', bpm: '' }), SES);
  ok(r.ok === true && r.hrAvg === 140 && r.hrSeries === null, 'v2.2: listas vacías con estadísticas → solo media/máx');
  // n = 0 con listas vacías y sin estadísticas: error claro
  r = parseWatchHr(JSON.stringify({ v: 1, id: SES.id, avg: '', max: '', min: '', n: 0, t: '', bpm: '' }), SES);
  ok(r.ok === false && typeof r.error === 'string', 'v2.2: todo vacío → error claro');
}
/* ───────────── 2. Petición de la app ───────────── */

{
  const p = watchHrPayload(SES);
  ok(JSON.stringify(Object.keys(p)) === JSON.stringify(SHORTCUT_INPUT_KEYS), `claves de la petición ${Object.keys(p)}`);
  // Hora local con desfase y 60 s de margen (en Madrid: 2026-10-18T11:33:00+02:00 … 12:22:00+02:00)
  const ISO_OFF = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
  ok(ISO_OFF.test(p.start) && Date.parse(p.start) === START - 60e3, `start ${p.start}`);
  ok(ISO_OFF.test(p.end) && Date.parse(p.end) === START + (DUR + 60) * 1000, `end ${p.end}`);
  if (process.env.TZ === 'Europe/Madrid') ok(p.start === '2026-10-18T11:33:00+02:00' && p.end === '2026-10-18T12:22:00+02:00', `Madrid ${p.start} ${p.end}`);
  const url = watchHrUrl(SES);
  ok(url.startsWith('shortcuts://run-shortcut?name=BestRunning%20FC&input=text&text=%7B'), `URL ${url.slice(0, 80)}`);
}

/* ───────────── 3. Búsqueda amplia (v2): miles de lecturas de otros días, en cualquier orden ───────────── */

// Pulso de fondo del Watch (fuera de entrenos) y otro entreno de ayer: nada de eso cae en la sesión.
const SES_LO = START - 120e3;
const SES_HI = START + (DUR + 120) * 1000;
function background(fromMs, toMs, stepSec, bpm = (i) => 62 + (i % 17)) {
  const out = [];
  let i = 0;
  for (let t = fromMs; t <= toMs; t += stepSec * 1000, i++) if (t < SES_LO || t > SES_HI) out.push({ ms: t, bpm: bpm(i) });
  return out;
}
const NOW = START + (DUR + 5 * 60) * 1000; // se importa 5 min después de acabar
const YESTERDAY_RUN = Array.from({ length: 480 }, (_, i) => ({ ms: START - 86400e3 + i * 5000, bpm: 150 + (i % 20) }));
const linesOf = (arr) => arr.map((p) => `${isoLocal(p.ms)},${p.bpm}`).join('\n');
{
  // ~3000 lecturas de otros días + la sesión, de la más reciente a la más antigua (como la búsqueda amplia)
  const other = [...background(NOW - 3 * 86400e3, NOW, 90), ...YESTERDAY_RUN];
  const all = [...other, ...SAMPLES].sort((a, b) => b.ms - a.ms);
  ok(other.length > 3000, `prueba con ${other.length} lecturas fuera de la sesión`);
  const allVals = all.map((p) => p.bpm);
  const payload = JSON.stringify({
    v: 1, id: SES.id, avg: allVals.reduce((a, b) => a + b, 0) / allVals.length, max: Math.max(...allVals), min: Math.min(...allVals),
    csv: linesOf(all), mode: 'wide',
  });
  const t0 = performance.now();
  for (let k = 0; k < 5; k++) parseWatchHr(payload, SES);
  const ms = (performance.now() - t0) / 5;
  // avg/max/min del Diccionario son de 3 días: la app debe recalcularlos solo con la sesión (check lo comprueba)
  check(`búsqueda amplia: ${all.length} lecturas de 3 días, más recientes primero, "mode":"wide"`, payload);
  ok(ms < 400, `parseWatchHr con ${all.length} lecturas tarda ${ms.toFixed(0)} ms (< 400 ms)`);
  // Mezcladas al azar (determinista)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const shuffled = [...all].sort(() => rnd() - 0.5);
  check('búsqueda amplia en desorden', JSON.stringify({ v: 1, id: SES.id, avg: 1, max: 2, min: 1, csv: linesOf(shuffled), mode: 'wide' }));
  // Solo lecturas de otros días: error claro (no «0 lecturas» silencioso)
  const r = parseWatchHr(JSON.stringify({ v: 1, id: SES.id, avg: 70, max: 170, min: 55, csv: linesOf(other.sort((a, b) => b.ms - a.ms)), mode: 'wide' }), SES);
  ok(r.ok === false && /no coinciden con la hora de esta sesión/.test(r.error), `amplia sin la sesión: ${r.error}`);
}

{
  // Búsqueda amplia con listas: miles de lecturas de 3 días, la app se queda con la sesión; rápido
  const other = [...background(NOW - 3 * 86400e3, NOW, 90), ...YESTERDAY_RUN];
  const all = [...other, ...SAMPLES].sort((a, b) => b.ms - a.ms);
  const payload = JSON.stringify({ v: 1, id: SES.id, avg: 80, max: 175, min: 55, ...listsOf({ arr: all }), mode: 'wide' });
  const t0 = performance.now();
  for (let k = 0; k < 5; k++) parseWatchHr(payload, SES);
  const ms = (performance.now() - t0) / 5;
  check(`v2.2: búsqueda amplia con listas (${all.length} lecturas)`, payload);
  ok(ms < 400, `v2.2: parseWatchHr con ${all.length} lecturas en listas tarda ${ms.toFixed(0)} ms (< 400 ms)`);
}

/* ───────────── 4. El Atajo generado: estructura ───────────── */

const DUMP = join(ROOT, 'tools/watch/out/BestRunning-FC.json');
const DUMP_V21 = join(ROOT, 'tools/watch/out/v21/BestRunning-FC.json'); // la v2.1 archivada (con Repetir), para comparar
const V22_KEYS = ['v', 'id', 'avg', 'max', 'min', 'n', 't', 'bpm', 't2', 'mode'];
const MSG_OK = 'Vuelve a BestRunning y pulsa Pegar';
const MSG_WIDE = 'Copiado (búsqueda amplia). Vuelve a BestRunning y pulsa Pegar';
const RE_PERMISSION = /^Salud no deja leer tu pulso a Atajos\. Abre la app Salud › Resumen › tu foto \(arriba a la derecha\) › Privacidad: Apps › Atajos y activa Frecuencia cardiaca\./;
let wf = null;
if (!existsSync(DUMP)) {
  fails.push('falta tools/watch/out/BestRunning-FC.json: ejecuta python3 tools/watch/build-shortcut.py');
} else {
  wf = JSON.parse(readFileSync(DUMP, 'utf8'));
  const acts = wf.WFWorkflowActions || [];
  const id = (a) => a.WFWorkflowActionIdentifier.replace('is.workflow.actions.', '');
  const P = (a) => a.WFWorkflowActionParameters;
  ok(wf.WFWorkflowName === SHORTCUT_NAME, `nombre ${wf.WFWorkflowName} ≠ ${SHORTCUT_NAME}`);
  ok(wf.WFWorkflowInputContentItemClasses.includes('WFStringContentItem'), 'acepta texto');
  ok(wf.WFWorkflowHasShortcutInputVariables === true, 'usa la Entrada del atajo');
  const keysRead = acts.filter((a) => id(a) === 'getvalueforkey').map((a) => P(a).WFDictionaryKey);
  ok(['start', 'end', 'id'].every((k) => keysRead.includes(k)) && keysRead.every((k) => SHORTCUT_INPUT_KEYS.includes(k)), `claves leídas ${keysRead}`);
  const dicts = acts.filter((a) => id(a) === 'dictionary');
  const items = dicts.length ? P(dicts[dicts.length - 1]).WFItems.Value.WFDictionaryFieldValueItems : [];
  ok(dicts.length === 1 && JSON.stringify(items.map((it) => it.WFKey.Value.string)) === JSON.stringify(V22_KEYS), `claves del Diccionario = ${V22_KEYS} (${items.map((it) => it.WFKey.Value.string)})`);
  ok(!items.some((it) => it.WFKey.Value.string === 'csv'), 'v2.2: sin csv');
  ok(items.find((it) => it.WFKey.Value.string === 'n')?.WFItemType === 3, 'n es Número');
  ok(items[0]?.WFItemType === 3 && items[0]?.WFValue.Value.string === '1', 'v = 1 (Número)');
  const hs = acts.filter((a) => id(a) === 'filter.health.quantity');
  ok(hs.length === 6, `${hs.length} búsquedas de Salud (ventana, amplia, cualquiera + 3 de diagnóstico)`);
  ok(hs.every((a) => P(a).WFContentItemFilter.Value.WFActionParameterFilterTemplates.some((t) => t.Property === 'Type' && t.Operator === 4 && t.Values.Enumeration.Value === 'Heart Rate')), 'todas filtran Tipo = Heart Rate');
  // Forma del atajo de pulso exportado de un iPhone real («Heart Rate Data»): Bounded true en cada fila, FillMissing false
  ok(hs.every((a) => P(a).WFContentItemFilter.Value.WFActionParameterFilterTemplates.every((t) => t.Bounded === true) && P(a).WFHKSampleFilteringFillMissing === false), 'filas con Bounded true y FillMissing false (como el export real)');
  ok(hs.every((a) => { const t = P(a).WFContentItemFilter.Value.WFActionParameterFilterTemplates.find((x) => x.Property === 'Type'); return t.Removable === false && JSON.stringify(Object.keys(t.Values)) === '["Enumeration"]'; }), 'fila Tipo idéntica al export real (solo Enumeration)');
  const dateTpl = (a) => P(a).WFContentItemFilter.Value.WFActionParameterFilterTemplates.find((t) => t.Property === 'Start Date');
  const between = dateTpl(hs[0]);
  ok(between?.Operator === 1003 && between.VariableOverrides?.dateValue?.Value?.VariableName === 'start' && between.VariableOverrides?.anotherDateValue?.Value?.VariableName === 'end', 'búsqueda 1: «está entre» start y end en VariableOverrides (forma antigua)');
  ok(between?.Values?.Date?.WFSerializationType === 'WFTextTokenAttachment' && between.Values.Date.Value?.VariableName === 'start' && between.Values.AnotherDate?.Value?.VariableName === 'end', 'búsqueda 1: y también en Values.Date/AnotherDate (forma moderna, ejemplo de Apple)');
  const firsts = acts.filter((a) => id(a) === 'getitemfromlist');
  ok(firsts.length === 2 && firsts.every((a) => P(a).WFItemSpecifier === 'First Item'), 'start/end = primer elemento de «Obtener fechas»');
  const diagToday = dateTpl(hs[3]);
  ok(diagToday?.Operator === 1002 && diagToday.Values.Unit === 16 && !JSON.stringify(diagToday).includes('"Variable"'), 'autodiagnóstico: «es hoy» (sin unidad «horas», no verificada)');
  ok(!JSON.stringify(wf).includes('"Unit":32') && !JSON.stringify(wf).includes('"Unit": 32'), 'no se usa la unidad 32 (horas)');
  const wide = dateTpl(hs[1]);
  ok(wide?.Operator === 1001 && wide.Values.Number === 3 && wide.Values.Unit === 16 && !JSON.stringify(wide).includes('"Variable"'), 'búsqueda 2: «en los últimos 3 días», constante');
  ok(P(hs[1]).WFContentItemSortOrder === 'Latest First' && P(hs[1]).WFContentItemLimitEnabled === true && P(hs[1]).WFContentItemLimitNumber === 2000, 'búsqueda 2: más recientes primero, límite 2000');
  ok(!dateTpl(hs[2]) && P(hs[2]).WFContentItemLimitNumber === 1, 'búsqueda 3: cualquier fecha, límite 1');
  const order = acts.map(id).filter((x) => !['comment', 'conditional', 'setvariable'].includes(x));
  const want = ['detect.dictionary', 'getvalueforkey', 'detect.date', 'getitemfromlist', 'filter.health.quantity', 'filter.health.quantity', 'statistics', 'count', 'properties.health.quantity', 'format.date', 'text.combine', 'properties.health.quantity', 'text.combine', 'gettext', 'dictionary', 'gettext', 'setclipboard', 'notification', 'filter.health.quantity', 'notification', 'notification', 'count', 'count', 'alert'];
  let k = 0;
  for (const x of order) if (x === want[k]) k++;
  ok(k === want.length, `orden de acciones (llega hasta ${want[k] || 'el final'})`);
  ok(acts.filter((a) => id(a) === 'setclipboard').length === 1, 'una sola «Copiar al portapapeles»');
  // v2.2: ningún Repetir; las listas salen de acciones que trabajan con la lista entera
  ok(!acts.some((a) => id(a).startsWith('repeat.')), 'v2.2: sin «Repetir»');
  ok(!JSON.stringify(wf).includes('"Repeat Item"'), 'v2.2: sin «Elemento repetido»');
  const det = acts.filter((a) => id(a) === 'properties.health.quantity');
  ok(det.length === 2 && det.map((a) => P(a).WFContentItemPropertyName).join() === 'Start Date,Value' && det.every((a) => P(a).WFInput.WFSerializationType === 'WFTextTokenAttachment' && P(a).WFInput.Value.VariableName === 'muestras'), '«Obtener detalles de muestras de salud» (Fecha de inicio, Valor) de muestras');
  const fd = acts.find((a) => id(a) === 'format.date');
  ok(fd && P(fd).WFDateFormatStyle === 'ISO 8601' && P(fd).WFISO8601IncludeTime === true && P(fd).WFDate.Value.string === '￼' && Object.values(P(fd).WFDate.Value.attachmentsByRange)[0].OutputUUID === P(det[0]).UUID, '«Formatear fecha» ISO 8601 con hora de la Fecha de inicio');
  const comb = acts.filter((a) => id(a) === 'text.combine');
  ok(comb.length === 2 && comb.every((a) => P(a).WFTextSeparator === 'New Lines') && P(comb[0]).text.Value.OutputUUID === P(fd).UUID && P(comb[1]).text.Value.OutputUUID === P(det[1]).UUID, '«Combinar texto» con saltos de línea: fechas y valores');
  const t2 = acts.find((a) => id(a) === 'gettext' && Object.values(P(a).WFTextActionText.Value.attachmentsByRange || {})[0]?.VariableName === 'muestras');
  const ag = t2 ? Object.values(P(t2).WFTextActionText.Value.attachmentsByRange)[0].Aggrandizements : [];
  ok(t2 && P(t2).WFTextActionText.Value.string === '￼' && ag.some((g) => g.PropertyName === 'Start Date') && ag.some((g) => g.WFDateFormatStyle === 'ISO 8601' && g.WFISO8601IncludeTime === true), 't2: Texto con «muestras › Fecha de inicio (ISO 8601)»');
  // Atajo REAL exportado de un iPhone que hace exactamente esto sin Repetir: «Health Data Export» de Heartbridge
  // (github.com/mm/heartbridge, iCloud 22bb56e73c354d9aa76a3678548dfe3a, cliente 1050.19; su README dice que evita
  // «Repetir con cada» por lento y exporta 8429 lecturas en dos listas paralelas fechas/valores). Sus acciones 6 y 9:
  //   properties.health.quantity {WFContentItemPropertyName:'Start Date', WFInput: WFTextTokenAttachment(Health Samples)}
  //   format.date {WFDate: WFTextTokenString '￼' → ActionOutput OutputName 'Start Date', WFDateFormatStyle, …}
  // y su salida es una LISTA de fechas («dates»: [...]). Aquí se comprueba que las nuestras tienen la misma forma.
  const REAL = {
    details: { WFContentItemPropertyName: 'Start Date', WFInputSer: 'WFTextTokenAttachment', outName: 'Start Date' },
    format: { WFDateSer: 'WFTextTokenString', string: '￼', attOutName: 'Start Date', keys: ['WFDate', 'WFDateFormatStyle', 'WFISO8601IncludeTime'] },
  };
  const detStart = det.find((a) => P(a).WFContentItemPropertyName === REAL.details.WFContentItemPropertyName);
  ok(detStart && P(detStart).WFInput.WFSerializationType === REAL.details.WFInputSer, 'Obtener detalles (Fecha de inicio): misma forma que el atajo real de Heartbridge');
  const fdAtt = fd ? Object.values(P(fd).WFDate.Value.attachmentsByRange || {}) : [];
  ok(fd && P(fd).WFDate.WFSerializationType === REAL.format.WFDateSer && P(fd).WFDate.Value.string === REAL.format.string && fdAtt.length === 1
    && fdAtt[0].Type === 'ActionOutput' && fdAtt[0].OutputName === REAL.format.attOutName && REAL.format.keys.every((k) => k in P(fd)),
  'Formatear fecha: misma forma que el atajo real de Heartbridge (WFDate = salida «Start Date» de Obtener detalles)');
  ok(existsSync(join(ROOT, 'tools/watch/out/BestRunning-FC.shortcut')) && existsSync(join(ROOT, 'tools/watch/out/BestRunning FC.shortcut')), 'existen los .shortcut firmados');
}

/* ───────────── 5. Simulación del Atajo con un Salud falso ─────────────
   Intérprete mínimo de las acciones que usa el Atajo. Ejecuta el plist generado tal cual (bloques, variables,
   agrandizaciones, filtros) contra un almacén de Salud simulado y pasa lo copiado a parseWatchHr. */

const HK = Symbol('hk');
const isList = Array.isArray;
const hasValue = (v) => !(v == null || v === '' || (isList(v) && (!v.length || v.every((x) => !hasValue(x)))));
const asList = (v) => (v == null ? [] : isList(v) ? v : [v]);
const DATE = (ms) => ({ date: ms });
let DECIMAL_COMMA = false; // números como los escribe un iPhone en español («119,5»)
function toText(v) {
  if (v == null) return '';
  if (isList(v)) return v.map(toText).join('\n');
  if (typeof v === 'number') return DECIMAL_COMMA ? String(v).replace('.', ',') : String(v);
  if (typeof v === 'object' && 'date' in v) return isoLocal(v.date);
  if (typeof v === 'object' && v[HK]) return `${v.value} count/min`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function runShortcut(wfx, { input = null, store = [], now = NOW, permission = true, betweenBroken = false, clipboard = '', decimalComma = false, formatDateFirstOnly = false } = {}) {
  const acts = wfx.WFWorkflowActions;
  const out = new Map();
  const vars = new Map();
  const res = { clipboard: null, notes: [], alerts: [], finds: [], steps: 0 };
  DECIMAL_COMMA = decimalComma;
  const clipIn = clipboard; // lo que había en el portapapeles al abrir el Atajo (v2.1: la app deja ahí su petición)
  const blocks = new Map(); // GroupingIdentifier → { start, else, end }
  acts.forEach((a, i) => {
    const p = a.WFWorkflowActionParameters;
    if (p.WFControlFlowMode == null) return;
    const b = blocks.get(p.GroupingIdentifier) || {};
    b[['start', 'else', 'end'][p.WFControlFlowMode]] = i;
    blocks.set(p.GroupingIdentifier, b);
  });
  const ref = (r, item) => {
    let v;
    if (r.Type === 'ExtensionInput') v = input;
    else if (r.Type === 'ActionOutput') { if (!out.has(r.OutputUUID)) throw new Error(`salida ${r.OutputUUID} sin valor`); v = out.get(r.OutputUUID); }
    else if (r.VariableName === 'Repeat Item') v = item;
    else { if (!vars.has(r.VariableName)) throw new Error(`variable ${r.VariableName} sin definir`); v = vars.get(r.VariableName); }
    for (const g of r.Aggrandizements || []) {
      const one = (x) => {
        if (g.Type === 'WFCoercionVariableAggrandizement') { if (!x?.[HK]) throw new Error('coerción a muestra de Salud de algo que no lo es'); return x; }
        if (g.Type === 'WFPropertyVariableAggrandizement') {
          if (g.PropertyName === 'Start Date') return DATE(x.start);
          if (g.PropertyName === 'Value') return x.value;
          throw new Error(`propiedad ${g.PropertyName}`);
        }
        if (g.Type === 'WFDateFormatVariableAggrandizement') return isoLocal(x.date);
        throw new Error(`agrandización ${g.Type}`);
      };
      v = isList(v) ? v.map(one) : one(v);
    }
    return v;
  };
  const val = (f, item) => {
    if (f == null) return null;
    if (f.WFSerializationType === 'WFTextTokenAttachment') return ref(f.Value, item);
    if (f.WFSerializationType === 'WFTextTokenString') {
      const { string, attachmentsByRange = {} } = f.Value;
      const atts = Object.entries(attachmentsByRange).map(([k, r]) => [Number(k.match(/\d+/)[0]), r]).sort((a, b) => a[0] - b[0]);
      if (string === '￼' && atts.length === 1) return ref(atts[0][1], item); // solo una variable: conserva el tipo
      let s = '';
      let last = 0;
      for (const [loc, r] of atts) { s += string.slice(last, loc) + toText(ref(r, item)); last = loc + 1; }
      return s + string.slice(last);
    }
    return f;
  };
  const UNIT_MS = { 16: 86400e3 };
  function find(p, item) {
    if (!permission) { res.finds.push(0); return []; } // sin permiso de lectura HealthKit responde vacío, sin error
    const tpl = p.WFContentItemFilter.Value.WFActionParameterFilterTemplates;
    let list = store.map((s) => ({ [HK]: true, start: s.ms, value: s.bpm }));
    for (const t of tpl) {
      if (t.Property === 'Type') { if (t.Values.Enumeration.Value !== 'Heart Rate') list = []; continue; }
      if (t.Property !== 'Start Date') throw new Error(`filtro ${t.Property}`);
      if (t.Operator === 1003) {
        if (betweenBroken) { list = []; continue; } // como la v1 en el iPhone: «está entre» sin fechas útiles
        // Atajos puede leer cualquiera de las dos formas: deben dar las mismas fechas
        const lo = val(t.Values.Date, item)?.date;
        const hi = val(t.Values.AnotherDate, item)?.date;
        if (lo !== val(t.VariableOverrides.dateValue, item)?.date || hi !== val(t.VariableOverrides.anotherDateValue, item)?.date) throw new Error('Values y VariableOverrides no coinciden');
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error('«está entre» sin fechas');
        list = list.filter((s) => s.start >= lo && s.start <= hi);
      } else if (t.Operator === 1001) {
        const span = t.Values.Number * UNIT_MS[t.Values.Unit];
        list = list.filter((s) => s.start >= now - span && s.start <= now);
      } else if (t.Operator === 1002) {
        const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
        list = list.filter((s) => s.start >= d0.getTime() && s.start <= now);
      } else throw new Error(`operador ${t.Operator}`);
    }
    list.sort((a, b) => (p.WFContentItemSortOrder === 'Latest First' ? b.start - a.start : a.start - b.start));
    if (p.WFContentItemLimitEnabled) list = list.slice(0, p.WFContentItemLimitNumber);
    res.finds.push(list.length);
    return list;
  }
  function exec(from, to, item) {
    let last = null;
    for (let i = from; i < to; i++) {
      const a = acts[i];
      const p = a.WFWorkflowActionParameters;
      const ident = a.WFWorkflowActionIdentifier.replace('is.workflow.actions.', '');
      let o = null;
      res.steps++; // acciones ejecutadas (dentro de un Repetir, una por vuelta): mide el coste en el iPhone
      if (ident === 'conditional') {
        const b = blocks.get(p.GroupingIdentifier);
        if (p.WFControlFlowMode === 0) {
          const v = val(p.WFInput.Variable, item);
          const yes = p.WFCondition === 100 ? hasValue(v) : p.WFCondition === 101 ? !hasValue(v) : p.WFCondition === 99 ? toText(v).includes(p.WFConditionalActionString) : (() => { throw new Error(`condición ${p.WFCondition}`); })();
          if (yes) { exec(i + 1, b.else ?? b.end, item); } else if (b.else != null) { exec(b.else + 1, b.end, item); }
          i = b.end;
        }
        continue;
      }
      if (ident === 'repeat.each') {
        const b = blocks.get(p.GroupingIdentifier);
        const results = asList(val(p.WFInput, item)).map((it) => exec(i + 1, b.end, it));
        out.set(acts[b.end].WFWorkflowActionParameters.UUID, results);
        i = b.end;
        continue;
      }
      switch (ident) {
        case 'comment': break;
        case 'detect.dictionary': o = JSON.parse(toText(val(p.WFInput, item))); break;
        case 'getvalueforkey': o = val(p.WFInput, item)?.[p.WFDictionaryKey] ?? null; break;
        case 'detect.date': { const ms = Date.parse(toText(val(p.WFInput, item))); o = Number.isFinite(ms) ? [DATE(ms)] : []; break; }
        case 'getitemfromlist': if (p.WFItemSpecifier !== 'First Item') throw new Error(p.WFItemSpecifier); o = asList(val(p.WFInput, item))[0] ?? null; break;
        case 'setvariable': vars.set(p.WFVariableName, val(p.WFInput, item)); break;
        case 'gettext': o = val(p.WFTextActionText, item); if (typeof o !== 'string') o = toText(o); break;
        case 'filter.health.quantity': o = find(p, item); break;
        case 'count': o = asList(val(p.Input, item)).length; break;
        // «Obtener detalles de …» (WFContentItemPropertiesAction, inputsMultipleItems = outputsMultipleItems = true en
        // macOS 26.5): una propiedad POR ELEMENTO, en el mismo orden; con un elemento suelto, un valor suelto.
        case 'properties.health.quantity': {
          const one = (x) => {
            if (!x?.[HK]) throw new Error('«Obtener detalles de muestras de salud» de algo que no es una muestra');
            if (p.WFContentItemPropertyName === 'Start Date') return DATE(x.start);
            if (p.WFContentItemPropertyName === 'Value') return x.value;
            throw new Error(`propiedad ${p.WFContentItemPropertyName}`);
          };
          const v = val(p.WFInput, item);
          o = isList(v) ? v.map(one) : one(v);
          break;
        }
        // «Formatear fecha» (WFFormatDateAction, entrada y salida múltiples): un texto por fecha. formatDateFirstOnly
        // simula el caso malo (que solo formateara la primera) para probar la reserva t2.
        case 'format.date': {
          if (p.WFDateFormatStyle !== 'ISO 8601' || p.WFISO8601IncludeTime !== true) throw new Error('formato de fecha no simulado');
          const one = (x) => { if (!x || !('date' in x)) throw new Error('«Formatear fecha» de algo que no es una fecha'); return isoLocal(x.date); };
          const v = val(p.WFDate, item);
          o = isList(v) ? (formatDateFirstOnly ? one(v[0]) : v.map(one)) : one(v);
          break;
        }
        case 'statistics': {
          const xs = asList(val(p.WFInput, item)).map((s) => (s?.[HK] ? s.value : Number(s)));
          o = { Average: xs.reduce((a, b) => a + b, 0) / xs.length, Maximum: Math.max(...xs), Minimum: Math.min(...xs) }[p.WFStatisticsOperation];
          break;
        }
        case 'text.combine': o = asList(val(p.text, item)).map(toText).join(p.WFTextSeparator === 'New Lines' ? '\n' : p.WFTextSeparator); break;
        case 'dictionary': {
          o = {};
          for (const it of p.WFItems.Value.WFDictionaryFieldValueItems) {
            const s = toText(val(it.WFValue, item));
            o[toText(val(it.WFKey, item))] = it.WFItemType === 3 ? Number(s) : s;
          }
          break;
        }
        case 'getclipboard': o = res.clipboard ?? clipIn ?? ''; break;
        case 'setclipboard': res.clipboard = toText(val(p.WFInput, item)); break;
        case 'notification': res.notes.push(toText(val(p.WFNotificationActionBody, item))); break;
        case 'alert': res.alerts.push(toText(val(p.WFAlertActionMessage, item))); break;
        default: throw new Error(`acción no simulada: ${ident}`);
      }
      if (p.UUID) out.set(p.UUID, o);
      last = o;
    }
    return last;
  }
  exec(0, acts.length, null);
  return res;
}

if (wf) {
  const INPUT = JSON.stringify(watchHrPayload(SES));
  const BG3 = background(NOW - 4 * 86400e3, NOW, 300);  // fondo cada 5 min, 4 días
  const STORE = [...BG3, ...YESTERDAY_RUN, ...SAMPLES];
  const sim = (label, opts) => { try { return runShortcut(wf, opts); } catch (e) { fails.push(`${label}: el simulador falla: ${e.message}`); return null; } };
  const modeOf = (txt) => { try { return JSON.parse(txt).mode; } catch { return undefined; } };

  // A · caso normal: la búsqueda exacta funciona
  let r = sim('A', { input: INPUT, store: STORE });
  if (r) {
    ok(r.clipboard && modeOf(r.clipboard) === 'window', `A: copia con mode window (${r.clipboard?.slice(0, 60)})`);
    ok(r.notes.length === 1 && r.notes[0] === MSG_OK, `A: notificación «${r.notes}»`);
    ok(r.finds.length === 1 && r.finds[0] === SAMPLES.length, `A: una sola búsqueda con ${r.finds} lecturas`);
    if (r.clipboard) check('A: lo que copia el Atajo (búsqueda exacta)', r.clipboard);
    let j = {};
    try { j = JSON.parse(r.clipboard); } catch { /* lo cuenta el ok de abajo */ }
    ok(JSON.stringify(Object.keys(j)) === JSON.stringify(V22_KEYS) && !('csv' in j), `A: JSON con ${V22_KEYS} y sin csv (${Object.keys(j)})`);
    const tl = String(j.t || '').split('\n');
    const bl = String(j.bpm || '').split('\n');
    ok(j.n === SAMPLES.length && tl.length === j.n && bl.length === j.n && j.t2 === j.t, `A: n = ${j.n}, ${tl.length} fechas, ${bl.length} pulsos, t2 = t`);
    // Alineación: la línea i de t y la i de bpm son la MISMA lectura (la más reciente primero)
    ok(tl.every((x, i) => x === isoLocal(REV[i].ms)) && bl.every((x, i) => Number(x) === REV[i].bpm), 'A: t[i] y bpm[i] son la misma lectura');
    // Coste: sin Repetir, las acciones ejecutadas no dependen del número de lecturas
    ok(r.steps < 60, `A: ${r.steps} acciones ejecutadas para ${SAMPLES.length} lecturas (sin Repetir)`);
    if (existsSync(DUMP_V21)) {
      const r21 = runShortcut(JSON.parse(readFileSync(DUMP_V21, 'utf8')), { input: INPUT, store: STORE });
      ok(r21.steps > SAMPLES.length && r.steps * 10 < r21.steps, `A: la v2.1 ejecutaba ${r21.steps} acciones, la v2.2 ${r.steps}`);
      // Mismo resultado para la app con la v2.1 (csv) y la v2.2 (listas)
      const a = parseWatchHr(r21.clipboard, SES);
      const b = parseWatchHr(r.clipboard, SES);
      ok(a.ok && b.ok && a.samples === b.samples && a.hrAvg === b.hrAvg && a.hrMax === b.hrMax && a.hrMin === b.hrMin && JSON.stringify(a.hrSeries) === JSON.stringify(b.hrSeries), 'A: la v2.1 (csv) y la v2.2 (listas) dan lo mismo en la app');
    } else fails.push('falta tools/watch/out/v21/BestRunning-FC.json: ejecuta python3 tools/watch/build-shortcut-v21.py');
  }
  // A2 · iPhone en español: valores con coma decimal («119,5») en bpm y en avg
  {
    const dec = SAMPLES.map((p, i) => ({ ms: p.ms, bpm: p.bpm + (i % 4 ? 0 : 0.5) }));
    const r2 = sim('A2', { input: INPUT, store: [...BG3, ...dec], decimalComma: true });
    if (r2) {
      ok(/"bpm":"[^"]*\d,5\\n/.test(r2.clipboard || ''), 'A2: bpm con coma decimal');
      const x = parseWatchHr(r2.clipboard, SES);
      const exp = dec.reduce((a, p) => a + p.bpm, 0) / dec.length;
      ok(x.ok && x.samples === dec.length && Math.abs(x.hrAvg - exp) <= 1.5 && !x.warnings.length, `A2: coma decimal → media ${x.hrAvg} ≈ ${exp.toFixed(1)}`);
    }
  }
  // A3 · el caso malo: «Formatear fecha» solo formatea la primera fecha → t tiene 1 línea; la app usa t2 sin avisar
  r = sim('A3', { input: INPUT, store: STORE, formatDateFirstOnly: true });
  if (r) {
    let j = {};
    try { j = JSON.parse(r.clipboard); } catch { /* */ }
    ok(String(j.t).split('\n').length === 1 && String(j.t2).split('\n').length === SAMPLES.length, 'A3: t con 1 fecha, t2 con todas');
    if (r.clipboard) check('A3: «Formatear fecha» sin recorrer la lista → reserva t2', r.clipboard);
  }
  // B · lo que pasó con la v1: «está entre» no devuelve nada → búsqueda amplia
  r = sim('B', { input: INPUT, store: STORE, betweenBroken: true });
  if (r) {
    ok(r.clipboard && modeOf(r.clipboard) === 'wide', 'B: copia con mode wide');
    ok(r.notes.length === 1 && r.notes[0] === MSG_WIDE, `B: notificación «${r.notes}»`);
    ok(r.finds.length === 2 && r.finds[1] > SAMPLES.length + 400, `B: búsqueda amplia con ${r.finds[1]} lecturas`);
    if (r.clipboard) check('B: lo que copia el Atajo (búsqueda amplia, 3 días)', r.clipboard);
  }
  // B2 · fondo denso (1 lectura/min): la amplia se corta en las 2000 más recientes y la sesión sigue dentro
  r = sim('B2', { input: INPUT, store: [...background(NOW - 4 * 86400e3, NOW, 60), ...SAMPLES], betweenBroken: true });
  if (r) {
    ok(r.finds[1] === 2000, `B2: la amplia devuelve ${r.finds[1]} (límite 2000)`);
    if (r.clipboard) check('B2: amplia con límite 2000', r.clipboard);
  }
  // C · ni en la ventana ni en 3 días, pero Salud sí tiene pulso antiguo → no es el permiso; no copia
  const OLD = { ms: NOW - 6 * 86400e3, bpm: 70 };
  r = sim('C', { input: INPUT, store: [OLD], betweenBroken: false });
  if (r) {
    ok(r.clipboard === null, 'C: no copia nada');
    ok(r.notes.length === 1 && r.notes[0].includes('El permiso de Salud está bien') && r.notes[0].includes(isoLocal(OLD.ms)) && !RE_PERMISSION.test(r.notes[0]), `C: «${r.notes}»`);
  }
  // D · sin permiso de lectura: HealthKit devuelve vacío en TODO → mensaje de permiso; no copia
  r = sim('D', { input: INPUT, store: STORE, permission: false });
  if (r) {
    ok(r.clipboard === null, 'D: sin permiso no copia nada');
    ok(r.notes.length === 1 && RE_PERMISSION.test(r.notes[0]), `D: notificación de permiso «${r.notes}»`);
    ok(r.finds.length === 3, 'D: prueba ventana, amplia y «cualquiera»');
  }
  // F · v2.1: iOS no pasa la entrada de la URL, pero la app dejó la petición en el portapapeles → igual que A
  r = sim('F', { input: null, store: STORE, clipboard: INPUT });
  if (r) {
    ok(r.clipboard && modeOf(r.clipboard) === 'window', `F: sin entrada pero con la petición en el portapapeles copia mode window (${r.clipboard?.slice(0, 50)})`);
    ok(r.alerts.length === 0 && r.notes.length === 1 && r.notes[0] === MSG_OK, `F: sin autodiagnóstico, notificación «${r.notes}»`);
  }
  // F2 · portapapeles con otra cosa (no es la petición): autodiagnóstico, no copia
  r = sim('F2', { input: null, store: STORE, clipboard: 'hola, esto no es json' });
  if (r) ok(r.clipboard == null && r.alerts.length === 1, `F2: con texto ajeno en el portapapeles hace el autodiagnóstico y no copia`);
  // E · sin entrada (desde Atajos): autodiagnóstico, sin copiar
  r = sim('E', { input: null, store: STORE });
  if (r) {
    const d0 = new Date(NOW); d0.setHours(0, 0, 0, 0);
    const n2h = STORE.filter((s) => s.ms >= d0.getTime() && s.ms <= NOW).length;
    const n3d = STORE.filter((s) => s.ms >= NOW - 3 * 86400e3 && s.ms <= NOW).length;
    ok(r.clipboard === null && !r.notes.length && r.alerts.length === 1, 'E: una alerta, nada copiado');
    ok(n2h > SAMPLES.length && r.alerts[0]?.includes(`· hoy: ${n2h}\n`) && r.alerts[0]?.includes(`últimos 3 días: ${n3d}\n`), `E: cuentas ${n2h}/${n3d} en «${r.alerts[0]?.slice(0, 120)}»`);
    ok(r.alerts[0]?.includes('Permiso de Salud: bien'), 'E: permiso bien');
  }
  r = sim('E2', { input: null, store: STORE, permission: false });
  if (r) ok(r.alerts[0]?.includes('· hoy: 0') && RE_PERMISSION.test(r.alerts[0].split('No se ve NINGUNA lectura de pulso. ')[1] || ''), 'E2: autodiagnóstico sin permiso lo dice');
}

if (fails.length) {
  console.error(`✗ ${fails.length} fallos (${pass} ok) · TZ=${process.env.TZ}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`✓ test-watch-shortcut: ${pass} comprobaciones OK · TZ=${process.env.TZ}`);
