#!/usr/bin/env node
// BestRunning · pruebas del pulso del Apple Watch (SPEC §12): parseo de lo que copia el Atajo (formatos de iOS en
// español e inglés, entradas rotas), ventana del Atajo, zonas de FC, pulso por nivel y reglas de progresión.
// Uso: node tools/test-watch-hr.mjs   · se repite en varias zonas horarias · sale con código ≠ 0 si algo falla.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.TZ) process.env.TZ = 'Europe/Madrid';
const IS_CHILD = !!process.env.BR_TZ_CHILD;

const W = await import('../js/integrations/watch-hr.js');
const P = await import('../js/training/progression.js');
const {
  parseWatchHr, hrZoneTimes, hrAtLevels, hrFieldsFrom, hrFieldsCleared, hasHrSeries, requestWatchHr, watchHrPayload, watchHrUrl,
  watchHrWindow, isoLocal, SHORTCUT_GUIDE, SHORTCUT_NAME, SHORTCUT_INPUT_KEYS, SHORTCUT_OUTPUT_KEYS, shortcutGuideHtml,
  watchShortcutName, isWatchShortcutReady, hrOverlaySvg, withHrOverlay, hrZonesHtml, hrLevelsHtml, hrStatsHtml, hrZoneOf,
} = W;
const { applyFeedback, hrLevelTrends, coachInsight } = P;
const ZONES_SHORT_JOG = (await import('../js/training/levels.js')).ZONES.jog.short;

let pass = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) pass++;
  else fails.push(msg);
}
const near = (a, b, tol = 1) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const pad = (n) => String(n).padStart(2, '0');
const NNBSP = String.fromCharCode(0x202f);
const NBSP = String.fromCharCode(0xa0);
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const MES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ───────────── Sesión y muestras sintéticas ───────────── */

const START = new Date(2026, 9, 17, 7, 30, 0).getTime(); // sábado 17 oct 2026, 7:30 (hora local)
const DUR = 20 * 60;
const SES = { id: 'ses_test1', startedAt: new Date(START).toISOString(), elapsedSec: DUR, plannedSec: DUR, levelsAtStart: { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 } };

/** Muestras cada `step` s desde el inicio + `off` s: bpm = 100 + (i % 60). */
function samples({ n = 200, step = 6, off = 3, start = START, f = (i) => 100 + (i % 60) } = {}) {
  return Array.from({ length: n }, (_, i) => ({ ms: start + (off + i * step) * 1000, bpm: f(i) }));
}
const S = samples();
const expMax = Math.max(...S.filter((p) => p.ms <= START + DUR * 1000).map((p) => p.bpm));
const expMin = Math.min(...S.filter((p) => p.ms <= START + DUR * 1000).map((p) => p.bpm));

const esMedium = (ms) => { const d = new Date(ms); return `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()}, ${d.getHours()}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const esShort = (ms) => { const d = new Date(ms); return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}, ${d.getHours()}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const esLong = (ms) => { const d = new Date(ms); return `${DIA[d.getDay()]}, ${d.getDate()} de ${MES_L[d.getMonth()]} de ${d.getFullYear()} a las ${d.getHours()}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const enUS = (ms) => {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  return `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${h}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${NNBSP}${d.getHours() < 12 ? 'AM' : 'PM'}`;
};
const enLong = (ms) => {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  return `${DAY[d.getDay()]}, ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${h}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
};
const enUK = (ms) => { const d = new Date(ms); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()} at ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const isoZ = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const isoNoTz = (ms) => isoLocal(ms).slice(0, 19);
const isoCompact = (ms) => { const s = isoLocal(ms); return `${s.slice(0, 10)} ${s.slice(11, 19)} ${s.slice(19).replace(':', '')}`; };
/** Hora de pared de Madrid (CEST en octubre antes del día 25) con su abreviatura, válida en cualquier zona. */
const esCEST = (ms) => { const d = new Date(ms + 2 * 3600e3); return `${d.getUTCDate()} de ${MES_L[d.getUTCMonth()]} de ${d.getUTCFullYear()}, ${d.getUTCHours()}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} CEST`; };

const lines = (fmtDate, { sep = ',', val = (b) => String(b), list = S } = {}) => list.map((p) => `${fmtDate(p.ms)}${sep}${val(p.bpm)}`).join('\n');
const shortcutJson = (csv, extra = {}) => JSON.stringify({ v: 1, id: SES.id, avg: '129,4', max: String(expMax), min: String(expMin), csv, ...extra });

function checkOk(label, res, { avg = null, max = expMax, min = expMin, n = null, tolAvg = 1.5 } = {}) {
  ok(res && res.ok === true, `${label}: debería parsear (${res?.error || 'sin error'})`);
  if (!res?.ok) return;
  ok(Array.isArray(res.hrSeries) && res.hrSeries.length >= 3, `${label}: serie con puntos`);
  const ser = res.hrSeries || [];
  ok(ser.every((p, i) => i === 0 || p[0] - ser[i - 1][0] >= 10), `${label}: como mucho 1 punto cada 10 s`);
  ok(ser.every((p) => p[0] >= 0 && p[0] <= DUR + 10 && Number.isInteger(p[1]) && p[1] >= 40 && p[1] <= 220), `${label}: puntos dentro de la sesión y plausibles`);
  if (max != null) ok(res.hrMax === max, `${label}: máx ${res.hrMax} ≠ ${max}`);
  if (min != null) ok(res.hrMin === min, `${label}: mín ${res.hrMin} ≠ ${min}`);
  if (avg != null) ok(near(res.hrAvg, avg, tolAvg), `${label}: media ${res.hrAvg} ≉ ${avg}`);
  if (n != null) ok(res.samples === n, `${label}: ${res.samples} muestras ≠ ${n}`);
}
function checkFail(label, res, re = null) {
  ok(res && res.ok === false && typeof res.error === 'string' && res.error.length > 15, `${label}: debería fallar con mensaje`);
  if (res?.error) ok(!/undefined|NaN|null|\[object/.test(res.error), `${label}: mensaje limpio (${res.error})`);
  if (re && res?.error) ok(re.test(res.error), `${label}: mensaje esperado ${re} (${res.error})`);
}

const inWin = S.filter((p) => p.ms <= START + DUR * 1000 + 5000);
const expAvg = (() => {
  const bins = new Map();
  for (const p of inWin) { const b = Math.floor((p.ms - START) / 10000); if (!bins.has(b)) bins.set(b, []); bins.get(b).push(p.bpm); }
  const vals = [...bins.values()].map((a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length));
  return vals.reduce((a, b) => a + b, 0) / vals.length;
})();

/* ───────────── 1. Formatos válidos ───────────── */

checkOk('JSON del Atajo (ISO con zona, cadenas con coma decimal)', parseWatchHr(shortcutJson(lines(isoLocal)), SES), { avg: expAvg, n: inWin.length });
checkOk('JSON con números', parseWatchHr(JSON.stringify({ v: 1, id: SES.id, avg: 129.4, max: expMax, min: expMin, csv: lines(isoLocal) }), SES), { avg: expAvg });
checkOk('CSV crudo ISO UTC (Z)', parseWatchHr(lines(isoZ), SES), { avg: expAvg });
checkOk('CSV crudo ISO sin zona (hora local)', parseWatchHr(lines(isoNoTz), SES), { avg: expAvg });
checkOk('ISO con espacio y +0200', parseWatchHr(lines(isoCompact), SES), { avg: expAvg });
checkOk('Español medio «17 oct 2026, 7:30:05» con lpm', parseWatchHr(lines(esMedium, { val: (b) => `${b} lpm` }), SES), { avg: expAvg });
checkOk('Español corto «17/10/26, 7:30:05» con punto y coma', parseWatchHr(lines(esShort, { sep: ';' }), SES), { avg: expAvg });
checkOk('Español largo con día de la semana y «a las»', parseWatchHr(lines(esLong, { sep: ', ', val: (b) => `${b},0 lpm` }), SES), { avg: expAvg });
checkOk('Español largo con CEST', parseWatchHr(lines(esCEST), SES), { avg: expAvg });
checkOk('Inglés EE. UU. «Oct 17, 2026 at 7:30:05 AM» (espacio estrecho)', parseWatchHr(lines(enUS, { val: (b) => `${b} BPM` }), SES), { avg: expAvg });
checkOk('Inglés largo con día de la semana', parseWatchHr(lines(enLong, { sep: ' - ', val: (b) => `${b} count/min` }), SES), { avg: expAvg });
checkOk('Inglés UK «17 Oct 2026 at 07:30:05» con tabulador', parseWatchHr(lines(enUK, { sep: '\t' }), SES), { avg: expAvg });
checkOk('JSON con csv en fechas de iOS en español', parseWatchHr(shortcutJson(lines(esMedium)), SES), { avg: expAvg });
checkOk('Valor primero «98,fecha»', parseWatchHr(S.map((p) => `${p.bpm},${isoLocal(p.ms)}`).join('\n'), SES), { avg: expAvg });
checkOk('Valor primero con fecha en español', parseWatchHr(S.map((p) => `${p.bpm} lpm; ${esMedium(p.ms)}`).join('\n'), SES), { avg: expAvg });
checkOk('Combinado con comas en una sola línea', parseWatchHr(S.map((p) => `${isoLocal(p.ms)},${p.bpm}`).join(','), SES), { avg: expAvg });
checkOk('Combinado con espacios', parseWatchHr(S.map((p) => `${isoLocal(p.ms)},${p.bpm}`).join(' '), SES), { avg: expAvg });
checkOk('Solo hora «7:30:05,98»', parseWatchHr(lines((ms) => { const d = new Date(ms); return `${d.getHours()}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }), SES), { avg: expAvg });
checkOk('Relativo «hoy, 7:30:05»', parseWatchHr(lines((ms) => { const d = new Date(ms); return `hoy, ${d.getHours()}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }), SES), { avg: expAvg });
checkOk('Espacios duros y CRLF', parseWatchHr(lines(esMedium).replace(/ /g, NBSP).replace(/\n/g, '\r\n'), SES), { avg: expAvg });

// Comas decimales en el valor
{
  const dec = S.map((p) => ({ ...p, bpm: p.bpm + 0.5 }));
  const r = parseWatchHr(lines(isoLocal, { list: dec, val: (b) => String(b).replace('.', ',') }), SES);
  checkOk('Valores con coma decimal «98,5»', r, { avg: expAvg + 0.5, max: Math.round(expMax + 0.5), min: Math.round(expMin + 0.5), tolAvg: 1.6 });
}

// Comillas tipográficas (pasado por Notas), texto alrededor, JSON roto o doblemente codificado
{
  const j = shortcutJson(lines(isoLocal));
  let k = 0;
  const smart = j.replace(/"/g, () => (k++ % 2 ? '”' : '“'));
  checkOk('JSON con comillas tipográficas', parseWatchHr(smart, SES), { avg: expAvg });
  checkOk('JSON dentro de texto de notificación', parseWatchHr(`Copiado ✓\n${j}\nVuelve a BestRunning`, SES), { avg: expAvg });
  const rawNl = `{"v":1,"id":"${SES.id}","avg":"129","max":"${expMax}","min":"${expMin}","csv":"${lines(isoLocal)}",}`;
  checkOk('JSON con saltos de línea sin escapar y coma final', parseWatchHr(rawNl, SES), { avg: expAvg });
  checkOk('JSON doblemente codificado', parseWatchHr(JSON.stringify(j), SES), { avg: expAvg });
  checkOk('JSON con csv como lista', parseWatchHr(JSON.stringify({ v: 1, id: SES.id, csv: S.map((p) => `${isoLocal(p.ms)},${p.bpm}`) }), SES), { avg: expAvg });
  checkOk('JSON con csv como lista de objetos', parseWatchHr(JSON.stringify({ v: 1, id: SES.id, csv: S.map((p) => ({ fecha: isoLocal(p.ms), valor: p.bpm })) }), SES), { avg: expAvg });
  checkOk('JSON con claves en español', parseWatchHr(JSON.stringify({ v: 1, id: SES.id, media: 129, 'máximo': expMax, datos: lines(isoLocal) }), SES), { avg: expAvg });
}

// Líneas en blanco, cabecera, duplicados exactos
{
  const body = ['Fecha de inicio,Valor', '', ...S.flatMap((p, i) => (i % 3 ? [`${isoLocal(p.ms)},${p.bpm}`] : [`${isoLocal(p.ms)},${p.bpm}`, `${isoLocal(p.ms)},${p.bpm}`, ''])), '   '].join('\n');
  checkOk('Cabecera, líneas en blanco y duplicados', parseWatchHr(body, SES), { avg: expAvg, n: inWin.length });
}

// Precisión de minutos (fecha de iOS sin segundos): se reparten dentro del minuto
{
  const list = samples({ n: 120, step: 10, off: 0 });
  const r = parseWatchHr(list.map((p) => { const d = new Date(p.ms); return `${d.getDate()} oct 2026 ${d.getHours()}:${pad(d.getMinutes())},${p.bpm}`; }).join('\n'), SES);
  ok(r.ok && r.hrSeries.length >= 100, `Minutos sin segundos: se reparten (${r.hrSeries?.length} puntos)`);
  ok(r.ok && r.hrSeries.every((p, i) => i === 0 || p[0] - r.hrSeries[i - 1][0] >= 10), 'Minutos sin segundos: espaciado ≥ 10 s');
}

// Ambigüedad d/m frente a m/d: se elige la fecha más cercana a la sesión
{
  const st5 = new Date(2026, 9, 5, 7, 30, 0).getTime();
  const ses5 = { ...SES, id: 'ses_5', startedAt: new Date(st5).toISOString() };
  const list = samples({ start: st5 });
  const us = list.map((p) => { const d = new Date(p.ms); const h = d.getHours() % 12 || 12; return `10/5/2026, ${h}:${pad(d.getMinutes())}:${pad(d.getSeconds())} AM,${p.bpm}`; }).join('\n');
  const es = list.map((p) => { const d = new Date(p.ms); return `5/10/2026 ${d.getHours()}:${pad(d.getMinutes())}:${pad(d.getSeconds())},${p.bpm}`; }).join('\n');
  checkOk('Numérica EE. UU. 10/5/2026 (m/d)', parseWatchHr(us, ses5));
  checkOk('Numérica España 5/10/2026 (d/m)', parseWatchHr(es, ses5));
}

// 12 horas en español por la tarde
{
  const st19 = new Date(2026, 9, 17, 19, 30, 0).getTime();
  const ses19 = { ...SES, id: 'ses_19', startedAt: new Date(st19).toISOString() };
  const list = samples({ start: st19 });
  const r = parseWatchHr(list.map((p) => { const d = new Date(p.ms); return `17/10/2026, ${d.getHours() - 12}:${pad(d.getMinutes())}:${pad(d.getSeconds())} p. m.,${p.bpm}`; }).join('\n'), ses19);
  checkOk('12 h «7:30:05 p. m.»', r);
  const r2 = parseWatchHr(list.map((p) => { const d = new Date(p.ms); return `${d.getHours() - 12}:${pad(d.getMinutes())}:${pad(d.getSeconds())} de la tarde,${p.bpm}`; }).join('\n'), ses19);
  checkOk('12 h «de la tarde»', r2);
}

// Atajo v2.2: listas paralelas t / bpm / n (sin csv), en todas las zonas horarias de la batería
{
  const R = [...S].reverse();
  const L = (dateF, valF = (b) => String(b), list = R) => ({ n: list.length, t: list.map((p) => dateF(p.ms)).join('\n'), bpm: list.map((p) => valF(p.bpm)).join('\n') });
  const J = (o) => JSON.stringify({ v: 1, id: SES.id, avg: '129,4', max: String(expMax), min: String(expMin), ...o, mode: 'window' });
  checkOk('v2.2 listas ISO con zona', parseWatchHr(J(L(isoLocal)), SES), { avg: expAvg, n: inWin.length });
  checkOk('v2.2 listas ISO Z con coma decimal', parseWatchHr(J(L(isoZ, (b) => `${b},0`)), SES), { avg: expAvg, n: inWin.length });
  checkOk('v2.2 listas ISO sin zona (hora local) con CRLF y salto final', parseWatchHr(J(L(isoNoTz)).replace(/\\n/g, '\\r\\n').replace(/","bpm"/, '\\n","bpm"'), SES), { avg: expAvg, n: inWin.length });
  checkOk('v2.2 listas con t2 de reserva', parseWatchHr(J({ ...L(isoLocal), t: isoLocal(R[0].ms), t2: L(isoLocal).t }), SES), { avg: expAvg, n: inWin.length });
  const r = parseWatchHr(J({ ...L(isoLocal), n: S.length + 1 }), SES);
  ok(r.ok && r.warnings.some((w) => /no cuadran/.test(w)), 'v2.2 n distinto: avisa y sigue');
  checkOk('v2.2 listas con fechas de iOS en español (no ISO)', parseWatchHr(J(L(esMedium, (b) => `${b} lpm`)), SES), { avg: expAvg, n: inWin.length });
}

// Valores imposibles: se descartan y se avisa
{
  const bad = S.map((p, i) => ({ ...p, bpm: i === 10 ? 250 : i === 11 ? 30 : i === 12 ? 0 : p.bpm }));
  const r = parseWatchHr(lines(isoLocal, { list: bad }), SES);
  ok(r.ok && r.hrMax <= 220 && r.hrMin >= 40, 'Valores imposibles fuera (250, 30, 0)');
  ok(r.ok && r.warnings.some((w) => /Descartadas/.test(w)), 'Aviso de lecturas descartadas');
}

// Muestras fuera de la ventana (márgenes del Atajo): no entran en la serie ni en las cifras
{
  const extra = [{ ms: START - 50000, bpm: 70 }, ...S, { ms: START + (DUR + 50) * 1000, bpm: 210 }];
  const r = parseWatchHr(lines(isoLocal, { list: extra }), SES);
  checkOk('Margen de ±60 s del Atajo excluido', r, { avg: expAvg });
}

// Solo estadísticas (sin csv)
{
  const r = parseWatchHr(JSON.stringify({ v: 1, id: SES.id, avg: '142,6', max: '171', min: '96', csv: '' }), SES);
  ok(r.ok && r.hrAvg === 143 && r.hrMax === 171 && r.hrMin === 96 && r.hrSeries === null, 'Solo media/máx/mín sin lecturas');
  ok(r.ok && r.warnings.length === 1, 'Aviso de que falta el gráfico');
}

// Zona horaria confundida (UTC escrita como hora local, sin «Z»)
if (new Date(START).getTimezoneOffset() !== 0) {
  const utcAsLocal = S.map((p) => `${new Date(p.ms).toISOString().slice(0, 19)},${p.bpm}`).join('\n');
  const r = parseWatchHr(utcAsLocal, SES);
  checkOk('UTC sin «Z» leída como local: se corrige', r, { avg: expAvg });
  ok(r.ok && r.warnings.some((w) => /zona horaria/.test(w)), 'Aviso de zona horaria corregida');
}

// Pausas: la ventana se alarga
{
  const sesP = { ...SES, pausedSec: 120 };
  const w = watchHrWindow(sesP);
  ok(w.durSec === DUR + 120, 'Ventana con pausas: elapsed + pausedSec');
  const late = [...S, ...samples({ n: 15, step: 6, off: DUR + 10 })];
  const r = parseWatchHr(lines(isoLocal, { list: late }), sesP);
  ok(r.ok && r.samples > S.filter((p) => p.ms <= START + DUR * 1000).length, 'Con pausas se aceptan lecturas tras el tiempo activo');
  // …pero la serie va en tiempo de clase: no se sale del perfil de velocidad
  ok(r.ok && r.hrSeries[r.hrSeries.length - 1][0] <= DUR, 'Con pausas (sin timeline) la serie se ajusta al tiempo de clase');
  // Con timeline exacta: pausa de 120 s a los 600 s de clase → las muestras en pausa se descartan
  const tl = [[START, 0, 1], [START + 600e3, 600, 0], [START + 720e3, 600, 1], [START + (DUR + 120) * 1000, DUR, 0]];
  const sesT = { ...sesP, timeline: tl, endedAt: new Date(START + (DUR + 120) * 1000).toISOString() };
  const evenly = samples({ n: (DUR + 120) / 5, step: 5, off: 2, f: (i) => (i * 5 + 2 >= 600 && i * 5 + 2 < 720 ? 90 : 150) });
  const rT = parseWatchHr(lines(isoLocal, { list: evenly }), sesT);
  ok(rT.ok && rT.hrSeries.every((p) => p[1] === 150), 'Timeline: las lecturas en pausa no entran en la serie');
  ok(rT.ok && rT.hrSeries[rT.hrSeries.length - 1][0] >= DUR - 20 && rT.hrSeries[rT.hrSeries.length - 1][0] <= DUR, 'Timeline: la serie termina al final de la clase');
  // Salto de 300 s a los 300 s de clase: lo posterior se desplaza 300 s en tiempo de clase
  const tlS = [[START, 0, 1], [START + 300e3, 600, 1], [START + 900e3, DUR, 0]];
  const rS = parseWatchHr(lines(isoLocal, { list: samples({ n: 170, step: 5, off: 2 }) }), { ...SES, elapsedSec: 900, timeline: tlS, endedAt: new Date(START + 900e3).toISOString() });
  ok(rS.ok && !rS.hrSeries.some((p) => p[0] >= 300 && p[0] < 600), 'Timeline: el tramo saltado queda sin pulso');
  const wE = watchHrWindow({ ...SES, endedAt: new Date(START + 1500e3).toISOString() });
  ok(wE.durSec === 1500, 'Ventana con endedAt');
}

/* ───────────── 2. Entradas rotas ───────────── */

checkFail('Vacío', parseWatchHr('', SES), /vacío/);
checkFail('Solo espacios', parseWatchHr('   \n  ', SES), /vacío/);
checkFail('null', parseWatchHr(null, SES), /vacío/);
checkFail('Texto cualquiera', parseWatchHr('Hola, esto es una lista de la compra', SES), /No reconozco/);
checkFail('URL', parseWatchHr('https://www.apple.com/es/watch/', SES));
checkFail('Solo números', parseWatchHr('98\n99\n100', SES));
checkFail('Nuestra propia petición', parseWatchHr(JSON.stringify(watchHrPayload(SES)), SES), /envía al Atajo/);
checkFail('JSON ajeno', parseWatchHr('{"foo":1,"bar":"x"}', SES), /No reconozco/);
checkFail('Todo imposible', parseWatchHr(lines(isoLocal, { list: S.map((p) => ({ ...p, bpm: 300 })) }), SES), /40 y 220/);
checkFail('Solo 2 lecturas', parseWatchHr(lines(isoLocal, { list: S.slice(0, 2) }), SES), /demasiado pocas/);
checkFail('Csv vacío y sin cifras', parseWatchHr(JSON.stringify({ v: 1, id: SES.id, csv: '' }), SES), /No reconozco/);
{
  const evening = samples({ start: new Date(2026, 9, 17, 18, 0, 0).getTime() });
  checkFail('Otro entreno (otra hora)', parseWatchHr(lines(isoLocal, { list: evening }), SES), /no coinciden/);
  checkFail('Otra sesión (id distinto y otra hora)', parseWatchHr(JSON.stringify({ v: 1, id: 'ses_otra', csv: lines(isoLocal, { list: evening }) }), SES), /otra sesión/);
  const r = parseWatchHr(JSON.stringify({ v: 1, id: 'ses_otra', csv: lines(isoLocal) }), SES);
  ok(r.ok && r.warnings.some((w) => /otra sesión/.test(w)), 'Id distinto pero misma hora: se acepta con aviso');
  checkFail('Fechas imposibles', parseWatchHr('31/02/2026 7:31:05,98\n2026-13-45T07:31:05,99\n99:99,100', SES));
}
ok(parseWatchHr(lines(isoLocal), null).ok, 'Sin sesión no rompe (tiempos relativos a la primera lectura)');
ok(parseWatchHr({ toString: () => 'x' }, SES).ok === false, 'Entrada no textual no rompe');

/* ───────────── 3. Petición al Atajo ───────────── */

{
  const pl = watchHrPayload(SES);
  ok(Object.keys(pl).join(',') === SHORTCUT_INPUT_KEYS.join(','), 'Diccionario de entrada v,id,start,end');
  ok(pl.v === 1 && pl.id === SES.id, 'v=1 e id de la sesión');
  ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(pl.start) && /[+-]\d{2}:\d{2}$/.test(pl.end), 'start/end ISO con zona horaria');
  ok(Date.parse(pl.start) === START - 60000, 'start = inicio − 60 s');
  ok(Date.parse(pl.end) === START + (DUR + 60) * 1000, 'end = inicio + tiempo + 60 s');
  ok(Date.parse(watchHrPayload({ ...SES, pausedSec: 90 }).end) === START + (DUR + 90 + 60) * 1000, 'end incluye las pausas');
  const url = watchHrUrl(SES, SHORTCUT_NAME);
  ok(url.startsWith('shortcuts://run-shortcut?name=BestRunning%20FC&input=text&text='), `URL del Atajo (${url.slice(0, 70)})`);
  const txt = decodeURIComponent(url.split('&text=')[1]);
  ok(JSON.parse(txt).start === pl.start, 'URL lleva el JSON codificado');
  ok(watchHrUrl({ startedAt: 'x' }) === '' && watchHrPayload(null) === null, 'Sesión sin fecha ⇒ sin URL');
  ok(requestWatchHr(SES) === false, 'Sin window no abre nada');
  globalThis.window = { location: { href: '' } };
  ok(requestWatchHr(SES, 'Mi Atajo') === true && window.location.href.includes('name=Mi%20Atajo'), 'requestWatchHr abre shortcuts://');
  ok(requestWatchHr(null) === false, 'requestWatchHr(null) no abre');
  delete globalThis.window;
}

/* ───────────── 4. Guía y nombre del Atajo ───────────── */

{
  ok(SHORTCUT_NAME === 'BestRunning FC', 'Nombre por defecto');
  ok(Array.isArray(SHORTCUT_GUIDE) && SHORTCUT_GUIDE.length >= 10 && SHORTCUT_GUIDE.every((s) => s.action && s.detail), 'Guía con pasos {action, detail}');
  const all = SHORTCUT_GUIDE.map((s) => `${s.action} ${s.detail}`).join(' ');
  for (const a of ['Recibir texto', 'Obtener diccionario de la entrada', 'Obtener valor del diccionario', 'Buscar muestras de salud', 'Calcular estadísticas', 'Repetir con cada', 'Combinar texto', 'Diccionario', 'Copiar al portapapeles', 'Mostrar notificación']) {
    ok(SHORTCUT_GUIDE.some((s) => s.action === a), `Acción de Atajos «${a}»`);
  }
  for (const w of ['Frecuencia cardiaca', 'ISO 8601', 'Fecha de inicio', 'Salto de línea', 'Media', 'Máximo', 'Mínimo', 'Vuelve a BestRunning y pulsa Pegar']) ok(all.includes(w), `La guía menciona «${w}»`);
  for (const k of [...SHORTCUT_INPUT_KEYS, ...SHORTCUT_OUTPUT_KEYS]) ok(new RegExp(`\\b${k}\\b`).test(all), `La guía usa la clave ${k}`);
  const html = shortcutGuideHtml({ name: 'Pulso <Nacho>' });
  ok(html.includes('Pulso &lt;Nacho&gt;') && !html.includes('<Nacho>'), 'Guía HTML escapa el nombre');
  ok(watchShortcutName({ integrations: { hrShortcut: '  Mi FC ' } }) === 'Mi FC' && watchShortcutName({}) === SHORTCUT_NAME, 'watchShortcutName');
  ok(!isWatchShortcutReady({ integrations: { hrShortcut: SHORTCUT_NAME, healthShortcut: '' }, history: [] }), 'Sin configurar ⇒ explicar el Atajo');
  ok(isWatchShortcutReady({ integrations: { hrShortcut: 'Otro' } }), 'Nombre propio ⇒ configurado');
  ok(isWatchShortcutReady({ integrations: { healthShortcut: 'Salud' } }), 'Atajo de Salud ⇒ configurado');
  ok(isWatchShortcutReady({ integrations: {}, history: [{ hrSeries: [[0, 100], [10, 101], [20, 102]] }] }), 'Ya importó ⇒ configurado');
}

/* ───────────── 5. Zonas de FC ───────────── */

{
  const ser = [...Array.from({ length: 20 }, (_, i) => [i * 10, 100]), ...Array.from({ length: 20 }, (_, i) => [200 + i * 10, 130]), ...Array.from({ length: 20 }, (_, i) => [400 + i * 10, 165])];
  const z = hrZoneTimes(ser, { hrMax: 176 });
  ok(z.z1 === 200 && z.z2 === 0 && z.z3 === 200 && z.z4 === 0 && z.z5 === 200, `Zonas % FC máx (${JSON.stringify(z)})`);
  const k = hrZoneTimes(ser, { hrMax: 176, hrRest: 60 });
  ok(k.z1 === 200 && k.z2 === 200 && k.z5 === 200, `Zonas Karvonen con FC reposo (${JSON.stringify(k)})`);
  const g = hrZoneTimes([[0, 120], [10, 120], [130, 120], [140, 120]], { hrMax: 176 });
  ok(g.z2 === 40, `Huecos largos cuentan 10 s (${JSON.stringify(g)})`);
  ok(Object.values(hrZoneTimes(null, {})).every((v) => v === 0), 'Serie vacía ⇒ ceros');
  ok(hrZoneTimes(ser, { age: 46 }).z5 === 200, 'Sin FC máx usa la edad');
  ok(hrZoneOf(170, { hrMax: 176 }) === 5 && hrZoneOf(60, { hrMax: 176 }) === 1, 'hrZoneOf');
  const f = hrFieldsFrom({ hrAvg: 130, hrMax: 165, hrMin: 100, hrSeries: ser }, { hrMax: 176 });
  ok(f.hrZones.z5 === 200 && f.hrSeries !== ser && f.hrSeries.length === 60, 'hrFieldsFrom calcula zonas y copia la serie');
  ok(hrFieldsFrom({ hrAvg: 130, hrSeries: null }, {}).hrZones === null, 'hrFieldsFrom sin serie');
  ok(Object.values(hrFieldsCleared()).every((v) => v === null), 'hrFieldsCleared');
}

/* ───────────── 6. Pulso por nivel ───────────── */

/** Sesión de 20′: calentar 7,1 · trote 8,3 · correr · rápido · trote, con pulso por tramo. */
function levelSession({ id = 'ses_lv', day = '2026-10-12', hr = {}, runSpeed = 10.1, planned = 1200, extra = {} } = {}) {
  const H = { warm: 105, jog: 130, run: 150, fast: 165, jog2: 135, ...hr };
  const t0 = new Date(`${day}T07:00:00`).getTime();
  const trace = [[0, 7.1], [180, 7.1], [180, 8.3], [480, 8.3], [480, runSpeed], [780, runSpeed], [780, 11.5], [900, 11.5], [900, 8.3], [1200, 8.3]];
  const at = (t) => (t < 180 ? H.warm : t < 480 ? H.jog : t < 780 ? (typeof H.run === 'function' ? H.run(t) : H.run) : t < 900 ? H.fast : H.jog2);
  const series = Array.from({ length: 120 }, (_, i) => [i * 10, at(i * 10)]);
  return {
    id, workoutId: null, templateId: 'test', title: 'Prueba', category: 'intervals', startedAt: new Date(t0).toISOString(), dayKey: day,
    planDate: day, plannedSec: planned, elapsedSec: 1200, completed: true, completionPct: 1, distanceKm: 3, avgSpeed: 9, maxSpeed: 11.5, kcal: 250,
    timeInZone: { warmup: 180, walk: 0, jog: 600, run: 300, fast: 120, sprint: 0, cooldown: 0 }, speedTrace: trace, adjustments: {},
    levelsAtStart: { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 }, feeling: null, rpe: null, hrAvg: 140, hrMax: 166, hrMin: 100, hrSeries: series,
    hrZones: null, notes: '', isTest: false, test: null, levelChanges: [], ...extra,
  };
}

{
  const s = levelSession();
  const lv = hrAtLevels(s);
  ok(near(lv.jog?.avg, 132.5, 1.5) && lv.jog.speed === 8.3, `Trote: media ${lv.jog?.avg} a ${lv.jog?.speed}`);
  ok(near(lv.run?.avg, 150, 0.5) && lv.run.speed === 10.1 && lv.run.sec >= 240, `Correr: media ${lv.run?.avg} (${lv.run?.sec} s)`);
  ok(near(lv.fast?.avg, 165, 1) && lv.fast.speed === 11.5, `Rápido: media ${lv.fast?.avg}`);
  ok(!lv.sprint, 'Sin sprint en la sesión');
  ok(!('warmup' in lv), 'El calentamiento no es un nivel');
  const ab = hrAtLevels(s, { above: 161.9 });
  ok(ab.fast.aboveSec >= 80 && ab.run.aboveSec === 0, `Tiempo por encima del 92 % (rápido ${ab.fast.aboveSec} s)`);
  ok(Object.keys(hrAtLevels({ ...s, hrSeries: null })).length === 0, 'Sin serie ⇒ {}');
  ok(Object.keys(hrAtLevels({ ...s, speedTrace: [] })).length === 0, 'Sin traza ⇒ {}');
  ok(Object.keys(hrAtLevels(null)).length === 0, 'null ⇒ {}');
  const adj = hrAtLevels({ ...s, speedTrace: s.speedTrace.map(([t, v]) => [t, v === 10.1 ? 10.3 : v]) });
  ok(adj.run && adj.run.speed === 10.3, 'Ajuste manual (+0,2) sigue contando como correr');
  ok(hasHrSeries(s) && !hasHrSeries({ hrSeries: [[0, 1]] }), 'hasHrSeries');
}

/* ───────────── 7. Gráficos (cadenas) ───────────── */

{
  const s = levelSession();
  const segs = [{ zone: 'warmup', speed: 7.1, sec: 180 }, { zone: 'jog', speed: 8.3, sec: 300 }, { zone: 'run', speed: 10.1, sec: 300 }, { zone: 'fast', speed: 11.5, sec: 120 }, { zone: 'jog', speed: 8.3, sec: 300 }];
  const svg = hrOverlaySvg(s.hrSeries, { segments: segs, trace: s.speedTrace, height: 140 });
  ok(svg.startsWith('<svg') && svg.includes('viewBox="0 0 360 140"') && svg.includes('whr-line'), 'Superposición SVG con el mismo viewBox');
  ok(!/NaN|undefined|Infinity/.test(svg), 'Superposición sin NaN');
  ok(hrOverlaySvg(null, { segments: segs }) === '' && hrOverlaySvg([[0, 100]], { segments: segs }) === '', 'Sin datos ⇒ sin superposición');
  ok(withHrOverlay('<div class="profile-chart"></div>', s, { segments: segs, height: 140 }).includes('whr-overlay'), 'withHrOverlay envuelve el gráfico');
  ok(!withHrOverlay('<div></div>', { hrSeries: null }).includes('<svg'), 'withHrOverlay sin pulso deja solo el gráfico');
  const zh = hrZonesHtml(hrZoneTimes(s.hrSeries, { hrMax: 176 }), { hrMax: 176 });
  ok(zh.includes('Z5') && zh.includes('Z1') && !/NaN|undefined/.test(zh), 'Zonas HTML');
  const lh = hrLevelsHtml(hrAtLevels(s), { hrMax: 176 });
  ok(lh.includes(ZONES_SHORT_JOG) && lh.includes('Correr') && !/NaN|undefined/.test(lh), 'Pulso por velocidad HTML');
  ok(hrLevelsHtml({}, {}).includes('whr-empty') && hrZonesHtml({}, {}).includes('whr-empty'), 'Estados vacíos');
  ok(!/NaN|undefined/.test(hrStatsHtml(s, { hrMax: 176 })) && hrStatsHtml({}, {}).includes('–'), 'Cifras de pulso');
}

/* ───────────── 8. Progresión con pulso ───────────── */

const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
function progState(history = [], over = {}) {
  return {
    version: 1, onboarded: true, createdAt: '2026-09-01T07:00:00.000Z',
    profile: { name: 'Nacho', age: 46, weightKg: 78, sex: 'm', hrMax: 176, hrRest: null },
    levels: { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 },
    levelHistory: [{ date: '2026-09-01', levels: { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 }, reason: 'init', note: '' }],
    progression: { lastBump: {}, okStreak: {}, hardStreak: 0, loadAdjust: 0, lastTest: null, bestVam: null },
    schedule: { weekdayMinutes: 20, thursdayMinutes: 50, weekendDay: 6, weekendMinutes: 50, reminderTime: '07:00' },
    plan: { startDate: '2026-09-28', overrides: {} },
    treadmill: { hasIncline: false, maxIncline: 12, minSpeed: 1, maxSpeed: 18, announceLead: 10 },
    audio: {}, integrations: { watchReminder: true, healthShortcut: '', hrShortcut: SHORTCUT_NAME },
    history, achievements: {}, ui: {}, ...over,
  };
}
const prev3 = (hr = {}, opts = {}) => ['2026-10-05', '2026-10-07', '2026-10-09'].map((day, i) => levelSession({ id: `ses_p${i}`, day, hr: { jog: 130, run: 152, ...hr }, ...opts }));

{
  // Pulso 5 ppm más bajo corriendo a 10,1 ⇒ «muy fácil» para correr
  const cur = levelSession({ id: 'ses_cur', hr: { jog: 129, run: 147 } });
  const st = progState([...prev3(), cur]);
  const tr = hrLevelTrends(st, cur);
  ok(tr.run && tr.run.prevN === 3 && near(tr.run.delta, -5, 0.6), `Tendencia correr: ${tr.run?.delta} ppm con ${tr.run?.prevN} sesiones`);
  ok(tr.jog && tr.jog.prevN === 3 && Math.abs(tr.jog.delta) < 4, `Tendencia trote: ${tr.jog?.delta}`);
  const r = applyFeedback(deepFreeze(st), deepFreeze({ ...cur, feeling: 'ok' }), { feeling: 'ok', rpe: 5 });
  const run = r.changes.find((c) => c.level === 'run');
  ok(run && run.to === 10.2 && run.reason === 'hr', `Pulso más bajo ⇒ sube correr (${JSON.stringify(r.changes)})`);
  ok(!r.changes.some((c) => c.level === 'jog'), 'Trote sin bajada de pulso ⇒ sigue la racha');
  ok(r.progression.okStreak.jog === 1 && r.progression.okStreak.run === 0, `Rachas: ${JSON.stringify(r.progression.okStreak)}`);
  ok(r.progression.lastBump.run === '2026-10-12', 'lastBump de correr');
  ok(/pulso/.test(r.message) && /ppm/.test(r.message) && /10,2/.test(r.message), `Mensaje con el pulso: ${r.message}`);
  ok(r.hr && r.hr.easy.includes('run') && r.hr.blocked === false, 'Resultado expone hr.easy');

  // Solo −3 ppm: no basta
  const cur3 = levelSession({ id: 'ses_c3', hr: { run: 149 } });
  const r3 = applyFeedback(progState([...prev3(), cur3]), cur3, { feeling: 'ok' });
  ok(!r3.changes.length && r3.progression.okStreak.run === 1, '−3 ppm no cuenta como fácil');

  // Solo 2 sesiones comparables: no basta
  const r2 = applyFeedback(progState([...prev3().slice(1), cur]), cur, { feeling: 'ok' });
  ok(!r2.changes.length, 'Con 2 sesiones anteriores no se aplica');

  // A otra velocidad no son comparables
  const prevFast = prev3({}, { runSpeed: 10.5, extra: { levelsAtStart: { jog: 8.3, run: 10.5, fast: 11.5, sprint: 13.0 } } });
  const rv = applyFeedback(progState([...prevFast, cur]), cur, { feeling: 'ok' });
  ok(!rv.changes.length, 'Velocidad distinta ⇒ no comparable');

  // Sesiones largas frente a corta: no comparables
  const prevLong = prev3({}, { planned: 3000 });
  const rl = applyFeedback(progState([...prevLong, cur]), cur, { feeling: 'ok' });
  ok(!rl.changes.length, 'Larga frente a corta ⇒ no comparable');

  // Sesiones posteriores no cuentan como «anteriores»
  const later3 = ['2026-10-14', '2026-10-15', '2026-10-16'].map((day, i) => levelSession({ id: `ses_l${i}`, day, hr: { run: 152 } }));
  ok(!applyFeedback(progState([...later3, cur]), cur, { feeling: 'ok' }).changes.length, 'Solo cuentan las sesiones anteriores');

  // Subida reciente: se respeta el hueco de 6 días
  const stB = progState([...prev3(), cur], { progression: { lastBump: { run: '2026-10-10' }, okStreak: {}, hardStreak: 0, loadAdjust: 0 } });
  const rb = applyFeedback(stB, cur, { feeling: 'ok' });
  ok(!rb.changes.length && /hace muy poco/.test(rb.message), 'Pulso fácil respeta 6 días entre subidas');

  // Con sensación «Exigente» manda la sensación
  ok(!applyFeedback(st, cur, { feeling: 'hard' }).changes.length, 'Exigente ⇒ no sube aunque baje el pulso');
}

{
  // Pulso > 92 % FC máx. (161,9) sostenido corriendo ⇒ no subir
  const hot = levelSession({ id: 'ses_hot', hr: { run: 166 } });
  const st = progState([hot]);
  const r = applyFeedback(deepFreeze(st), deepFreeze(hot), { feeling: 'easy' });
  ok(r.changes.length === 0, `Pulso muy alto corriendo ⇒ sin subidas (${JSON.stringify(r.changes)})`);
  ok(/92 %/.test(r.message) && /correr/.test(r.message), `Mensaje de bloqueo: ${r.message}`);
  ok(r.progression.loadAdjust === 0 && r.hr.blocked === true, 'Bloqueo: sin +0,02 de carga');
  const ro = applyFeedback(progState([hot], { progression: { lastBump: {}, okStreak: { run: 2, jog: 2 }, hardStreak: 0, loadAdjust: 0 } }), hot, { feeling: 'ok' });
  ok(!ro.changes.length && ro.progression.okStreak.run === 2 && ro.progression.okStreak.jog === 2, 'Bloqueo con «Cómodo»: ni racha ni subida');
  const ra = applyFeedback(st, { ...hot, adjustments: { fast: 0.4 } }, { feeling: 'ok' });
  ok(!ra.changes.length, 'Bloqueo también frena la adopción de ajustes manuales');
  const rf = applyFeedback(st, hot, { feeling: 'fail' });
  ok(rf.changes.some((c) => c.to < c.from), 'El bloqueo no impide bajar si fue mal');
  // Pico corto (40 s) por encima: no bloquea
  const spike = levelSession({ id: 'ses_spike', hr: { run: (t) => (t >= 600 && t < 640 ? 170 : 150) } });
  const rs = applyFeedback(progState([spike]), spike, { feeling: 'easy' });
  ok(rs.changes.length > 0 && !rs.hr.blocked, `Pico corto no bloquea (${rs.message})`);
  // Más FC máx. en el perfil ⇒ el mismo pulso ya no bloquea
  const rh = applyFeedback(progState([hot], { profile: { age: 46, hrMax: 186 } }), hot, { feeling: 'easy' });
  ok(rh.changes.length > 0, 'Con FC máx. 186, 166 ppm no bloquea');
}

{
  // Sin pulso: idéntico al comportamiento de siempre
  const plain = levelSession({ id: 'ses_plain', extra: { hrSeries: null, hrAvg: null, hrMax: null } });
  const a = applyFeedback(progState([plain]), plain, { feeling: 'easy' });
  ok(a.changes.length === 3 && a.changes.every((c) => c.reason === 'easy'), `Sin pulso: «muy fácil» sube los niveles usados (${JSON.stringify(a.changes)})`);
  const test = { ...levelSession({ id: 'ses_t' }), isTest: true, test: { lastStageSpeed: 13, secondsInLastStage: 30, vam: 13.3 } };
  ok(applyFeedback(progState([test]), test, { feeling: 'max' }).changes.every((c) => c.reason === 'test'), 'Test VAM no usa reglas de pulso');
}

{
  // coachInsight menciona la tendencia del pulso
  const found = [];
  for (let k = 0; k < 21; k++) {
    const now = new Date(2026, 9, 5 + k, 12, 0, 0);
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const days = [30, 24, 18, 12, 6, 1].map((d) => { const x = new Date(now.getTime() - d * 86400e3); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; });
    const hist = days.map((day, i) => levelSession({ id: `ses_i${i}`, day, hr: { run: 156 - i * 1.2 } }));
    const t = coachInsight(progState(hist), now);
    ok(typeof t === 'string' && t.length > 20 && !/undefined|NaN|null|\[object/.test(t), `coachInsight con pulso (${today}): ${t}`);
    if (/pulso ha bajado \d+ ppm/.test(t)) found.push(t);
  }
  ok(found.length > 0, 'coachInsight menciona que el pulso ha bajado');
  ok(found.every((t) => /10,1 km\/h/.test(t) && /en un mes/.test(t)), `Frase de tendencia: ${found[0]}`);
}

/* ───────────── Resultado ───────────── */

const tzLabel = process.env.TZ;
if (fails.length) {
  console.error(`\n✗ [${tzLabel}] ${fails.length} fallo(s):`);
  for (const f of fails) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ [${tzLabel}] ${pass} comprobaciones correctas`);

if (!IS_CHILD) {
  let bad = 0;
  for (const tz of ['America/New_York', 'Asia/Tokyo', 'UTC']) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, TZ: tz, BR_TZ_CHILD: '1' }, encoding: 'utf8' });
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
    if (r.status !== 0) bad++;
  }
  if (bad) process.exit(1);
}
