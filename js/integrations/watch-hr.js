// BestRunning · pulso del Apple Watch después del entreno, vía un Atajo de iOS (SPEC §12).
// Una web no puede leer HealthKit: el Atajo «BestRunning FC» recibe { v, id, start, end }, busca en Salud las
// muestras de frecuencia cardiaca de esa ventana y devuelve { v, id, avg, max, min, csv } por el portapapeles.
// La parte de datos (parseo, zonas, pulso por nivel) no toca el DOM y se puede importar desde Node.
// Las funciones de interfaz (hoja, superposición, estilos) solo usan el DOM al llamarlas y cargan los
// componentes de forma perezosa, para que progression.js pueda importar este módulo sin arrastrar la UI.
import { pad2, esc, fmt, clamp } from '../core/utils.js';
import { ZONES, LEVEL_KEYS, DEFAULT_LEVELS, hrZones, hrMaxFromAge } from '../training/levels.js';

export const SHORTCUT_NAME = 'BestRunning FC';
/** Claves del diccionario que BestRunning envía al Atajo. */
export const SHORTCUT_INPUT_KEYS = ['v', 'id', 'start', 'end'];
/** Claves del diccionario que el Atajo copia al portapapeles. */
export const SHORTCUT_OUTPUT_KEYS = ['v', 'id', 'avg', 'max', 'min', 'csv'];

export const HR_MIN = 40;
export const HR_MAX = 220;
/** Rango aceptado al anotar el pulso a mano (Resumen e Historial usan el mismo). */
export const HR_ENTRY_MIN = 40;
export const HR_ENTRY_MAX = 240;
const BIN_SEC = 10;            // remuestreo: como mucho 1 punto cada 10 s
const MARGIN_SEC = 60;         // margen de la ventana que se pide al Atajo
const MAX_GAP_SEC = 30;        // huecos mayores no cuentan como tiempo en zona
const PENDING_KEY = 'br.watchhr.pending';
const PENDING_TTL = 20 * 60 * 1000;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isFin = (v) => typeof v === 'number' && Number.isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10;
const hasDOM = () => typeof document !== 'undefined' && typeof window !== 'undefined';
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ═════════════════ Guía del Atajo ═════════════════ */

/** Pasos para crear el Atajo (nombres exactos de las acciones de Atajos en iOS en español). */
export const SHORTCUT_GUIDE = Object.freeze([
  { action: 'Nuevo atajo', detail: `Abre la app Atajos, toca «+» y ponle de nombre exactamente «${SHORTCUT_NAME}».` },
  { action: 'Recibir texto', detail: 'Toca ⓘ y activa la entrada «Texto» (si te pregunta, «Si no hay entrada: Continuar»). BestRunning le pasa el texto al abrirlo como «Entrada del atajo».' },
  { action: 'Obtener diccionario de la entrada', detail: 'Con «Entrada del atajo». Recibe las claves v, id, start y end.' },
  { action: 'Obtener valor del diccionario', detail: 'Tres veces: clave «start», clave «end» y clave «id» (del «Diccionario»). Mantén pulsado cada resultado → Cambiar nombre: start, end, id.' },
  { action: 'Buscar muestras de salud', detail: 'Tipo «Frecuencia cardiaca». Añade el filtro «Fecha de inicio» «está entre» start y end. Ordenar por «Fecha de inicio» · «Más antiguo primero» · sin límite.' },
  { action: 'Calcular estadísticas', detail: 'Tres veces sobre «Muestras de salud»: «Media», «Máximo» y «Mínimo».' },
  { action: 'Repetir con cada', detail: 'Con «Muestras de salud». Dentro, una acción «Texto»: «Elemento repetido» → «Fecha de inicio» (toca la variable → Formato de fecha «ISO 8601», con hora), una coma y «Elemento repetido» → «Valor». Queda: [Fecha de inicio],[Valor]' },
  { action: 'Combinar texto', detail: 'Después de «Finalizar repetición»: combina «Resultados de Repetir» con «Salto de línea».' },
  { action: 'Diccionario', detail: 'Claves: v = 1 (Número) · id = id · avg = Media · max = Máximo · min = Mínimo · csv = Texto combinado.' },
  { action: 'Copiar al portapapeles', detail: 'Copia el «Diccionario».' },
  { action: 'Mostrar notificación', detail: '«Vuelve a BestRunning y pulsa Pegar».' },
  { action: 'Probar', detail: 'En el resumen de una sesión toca «Importar pulso del Apple Watch». La primera vez, permite que Atajos lea «Frecuencia cardiaca» en Salud.' },
]);

/** Ejemplos de lo que entra y sale del Atajo (para la guía de Ajustes). */
export const SHORTCUT_EXAMPLE_INPUT = '{"v":1,"id":"ses_…","start":"2026-10-17T07:29:00+02:00","end":"2026-10-17T07:51:20+02:00"}';
export const SHORTCUT_EXAMPLE_OUTPUT = '{"v":1,"id":"ses_…","avg":142,"max":171,"min":96,"csv":"2026-10-17T07:30:04+02:00,96\\n…"}';

/** Guía como HTML (lista numerada). Usa las clases .whr-guide* (ver ensureWatchHrStyles). */
export function shortcutGuideHtml({ name = SHORTCUT_NAME } = {}) {
  const shown = String(name || SHORTCUT_NAME).trim() || SHORTCUT_NAME;
  const steps = SHORTCUT_GUIDE.map((s, i) => {
    const detail = i === 0 ? s.detail.replace(`«${SHORTCUT_NAME}»`, `«${shown}»`) : s.detail;
    return `<li class="whr-guide__step"><span class="whr-guide__n num">${i + 1}</span><div><b class="whr-guide__act">${esc(s.action)}</b><span class="whr-guide__txt">${esc(detail)}</span></div></li>`;
  }).join('');
  return `<ol class="whr-guide">${steps}</ol>`;
}

/** Nombre del Atajo de pulso según el estado (o el de por defecto). */
export function watchShortcutName(state) {
  const ig = state?.integrations || {};
  const n = [ig.hrShortcut, ig.watchShortcut, ig.watchHrShortcut].map((x) => String(x || '').trim()).find(Boolean);
  return n || SHORTCUT_NAME;
}

/**
 * ¿Parece que el usuario ya tiene el Atajo? Ya importó alguna vez, cambió el nombre en Ajustes (hrShortcut viene
 * relleno por defecto, así que el nombre por defecto no cuenta) o configuró el Atajo de Salud.
 */
export function isWatchShortcutReady(state) {
  const ig = state?.integrations || {};
  if ((Array.isArray(state?.history) ? state.history : []).some(hasHrSeries)) return true;
  if (String(ig.healthShortcut || '').trim()) return true;
  return [ig.hrShortcut, ig.watchShortcut, ig.watchHrShortcut].some((x) => {
    const n = String(x || '').trim();
    return n && n !== SHORTCUT_NAME;
  });
}

/* ═════════════════ Petición al Atajo ═════════════════ */

/** ISO 8601 con la zona horaria local: '2026-10-17T07:30:00+02:00'. */
export function isoLocal(ms) {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${off >= 0 ? '+' : '-'}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
}

/**
 * Ventana real de la sesión en hora de reloj. end = inicio + tiempo activo + pausas
 * (usa endedAt/finishedAt o pausedSec si la sesión los trae).
 */
export function watchHrWindow(session) {
  const startMs = Date.parse(session?.startedAt || '');
  if (!Number.isFinite(startMs)) return null;
  let endMs = Date.parse(session?.endedAt || session?.finishedAt || '');
  if (!Number.isFinite(endMs) || endMs <= startMs) {
    const active = num(session?.elapsedSec) || num(session?.plannedSec);
    endMs = startMs + Math.max(60, active + Math.max(0, num(session?.pausedSec))) * 1000;
  }
  return { startMs, endMs, durSec: (endMs - startMs) / 1000 };
}

/**
 * Traductor hora de reloj (ms) → tiempo de clase (s) de una sesión, o null si cae en una pausa.
 * - Con session.timeline = [[wallMs, classSec, running(1|0)], …] (el motor anota inicio, pausas,
 *   reanudaciones, saltos y restauraciones) el mapeo es exacto y las muestras en pausa se descartan.
 * - Sin timeline (sesiones antiguas): si el reloj y la clase no cuadran (pausas o tramos saltados),
 *   se estira linealmente para que el pulso cubra el mismo tramo que el perfil de velocidad.
 */
export function wallToClassMapper(session, win = watchHrWindow(session)) {
  const tl = (Array.isArray(session?.timeline) ? session.timeline : [])
    .filter((e) => Array.isArray(e) && e.length >= 2 && Number.isFinite(Number(e[0])) && Number.isFinite(Number(e[1])))
    .map((e) => [Number(e[0]), Math.max(0, Number(e[1])), e.length >= 3 ? !!Number(e[2]) : true])
    .sort((a, b) => a[0] - b[0]);
  if (tl.length) {
    return (ms) => {
      if (ms < tl[0][0] - 5000) return null;
      let e = tl[0];
      for (let i = 1; i < tl.length && tl[i][0] <= ms; i++) e = tl[i];
      if (!e[2]) return null;
      return e[1] + Math.max(0, ms - e[0]) / 1000;
    };
  }
  if (!win) return null;
  const tr = Array.isArray(session?.speedTrace) ? session.speedTrace : [];
  const classEnd = Math.max(num(session?.elapsedSec), tr.length ? num(tr[tr.length - 1]?.[0]) : 0);
  const wall = win.durSec;
  if (classEnd > 0 && wall > 0 && Math.abs(classEnd - wall) / wall > 0.05) {
    const k = classEnd / wall;
    return (ms) => Math.max(0, (ms - win.startMs) / 1000) * k;
  }
  return null;
}

/** Diccionario que recibe el Atajo: { v:1, id, start, end } con 60 s de margen a cada lado. */
export function watchHrPayload(session) {
  const w = watchHrWindow(session);
  if (!w) return null;
  return {
    v: 1,
    id: String(session?.id || ''),
    start: isoLocal(w.startMs - MARGIN_SEC * 1000),
    end: isoLocal(w.endMs + MARGIN_SEC * 1000),
  };
}

export function watchHrUrl(session, shortcutName = SHORTCUT_NAME) {
  const payload = watchHrPayload(session);
  const name = String(shortcutName || '').trim() || SHORTCUT_NAME;
  if (!payload) return '';
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(JSON.stringify(payload))}`;
}

/** Abre el Atajo con la ventana de la sesión. Devuelve false si no se pudo. */
export function requestWatchHr(session, shortcutName = SHORTCUT_NAME) {
  const url = watchHrUrl(session, shortcutName);
  if (!url || typeof window === 'undefined' || !window.location) return false;
  // Respaldo (Atajo v2.1+): si iOS no le pasa el texto de la URL, el Atajo lee la petición del portapapeles.
  // Tiene que ir dentro del mismo toque; si falla no pasa nada (el Atajo sigue leyendo la URL).
  try {
    const p = navigator.clipboard?.writeText?.(JSON.stringify(watchHrPayload(session)));
    p?.catch?.(() => {});
  } catch { /* sin portapapeles */ }
  try {
    window.location.href = url;
    return true;
  } catch {
    return false;
  }
}

/* ═════════════════ Parseo de la respuesta ═════════════════ */

const MONTHS = {
  ene: 0, enero: 0, jan: 0, january: 0,
  feb: 1, febrero: 1, february: 1,
  mar: 2, marzo: 2, march: 2,
  abr: 3, abril: 3, apr: 3, april: 3,
  may: 4, mayo: 4,
  jun: 5, junio: 5, june: 5,
  jul: 6, julio: 6, july: 6,
  ago: 7, agosto: 7, aug: 7, august: 7,
  sep: 8, sept: 8, septiembre: 8, setiembre: 8, september: 8,
  oct: 9, octubre: 9, october: 9,
  nov: 10, noviembre: 10, november: 10,
  dic: 11, diciembre: 11, dec: 11, december: 11,
};
const WEEKDAY_WORDS = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g;
const WEEKDAY_ABBR_LEAD = /^(lun|mar|mie|jue|vie|sab|dom|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\.?,?\s+(?=\d)/;
const TZ_NAMES = [
  [/\bhora de verano de europa central\b/, 120], [/\bhora estandar de europa central\b/, 60],
  [/\bhora de verano de europa occidental\b/, 60], [/\bhora estandar de europa occidental\b/, 0],
  [/\bcest\b/, 120], [/\bcet\b/, 60], [/\bwest\b/, 60], [/\bwet\b/, 0], [/\bbst\b/, 60],
  [/\bedt\b/, -240], [/\best\b/, -300], [/\bcdt\b/, -300], [/\bcst\b/, -360],
  [/\bmdt\b/, -360], [/\bmst\b/, -420], [/\bpdt\b/, -420], [/\bpst\b/, -480],
];
const UNIT_RE = /\b(?:lpm|bpm|ppm|count\/min|counts\/min|cuentas\/min|beats\s*\/\s*min|beats per minute|(?:latidos|pulsaciones)(?:\s*(?:\/|por)\s*min(?:uto)?)?)\b/gi;
const ISO_RE = /(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(?:\s?(Z|[+-]\d{2}(?::?\d{2})?)(?!\d))?/gi;
const VALUE_IN_RE = /(?:^|[^\d])(\d{2,3}(?:[.,]\d{1,2})?)(?!\d)/g;

const stripAccents = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Unifica espacios raros de iOS (U+202F antes de AM/PM, NBSP…), comillas tipográficas y saltos de línea. */
function normalizeText(t) {
  return String(t ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\u2060]/g, '')
    .replace(/[\u00A0\u202F\u2007\u2009\u2002\u2003]/g, ' ')
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\r\n?|\u2028|\u2029/g, '\n');
}

/** Número tolerante: 142 · '142' · '142,5' · '142.5 lpm'. NaN si no hay. */
function parseNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const m = v.replace(UNIT_RE, ' ').match(/-?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(',', '.')) : NaN;
}

/** Fecha en el reloj local (o con desfase explícito en minutos al este de UTC). */
function makeMs(y, mo, d, h, mi, s, ms, offMin) {
  if (!(mo >= 0 && mo <= 11 && d >= 1 && d <= 31 && h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && s >= 0 && s <= 60)) return NaN;
  const probe = new Date(Date.UTC(y, mo, d));
  if (probe.getUTCDate() !== d) return NaN;
  if (offMin != null) return Date.UTC(y, mo, d, h, mi, s, ms || 0) - offMin * 60000;
  return new Date(y, mo, d, h, mi, s, ms || 0).getTime();
}

function closest(cands, ref) {
  const ok = cands.filter(Number.isFinite);
  if (!ok.length) return NaN;
  if (!Number.isFinite(ref)) return ok[0];
  return ok.reduce((a, b) => (Math.abs(b - ref) < Math.abs(a - ref) ? b : a));
}

/** Fecha de iOS en español o inglés: '17 oct 2026, 7:31:05' · '17/10/26 7:31' · 'Oct 17, 2026 at 7:31:05 AM'… */
function parseLooseDate(str, refMs) {
  let s = stripAccents(String(str).toLowerCase()).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  let ampm = null;
  s = s.replace(/\bde la (manana|madrugada|tarde|noche)\b/, (m, w) => { ampm = w === 'manana' || w === 'madrugada' ? 'a' : 'p'; return ' '; });
  s = s.replace(/\b([ap])\.?\s?m\.?(?=\s|$|[,;])/, (m, a) => { ampm = a; return ' '; });
  let off = null;
  s = s.replace(/\b(?:gmt|utc)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?\b/, (m, sg, h, mm) => {
    off = (sg === '-' ? -1 : 1) * (Number(h) * 60 + Number(mm || 0));
    return ' ';
  });
  if (off == null) s = s.replace(/\b(?:gmt|utc)\b/, () => { off = 0; return ' '; });
  if (off == null) {
    for (const [re, v] of TZ_NAMES) if (re.test(s)) { off = v; s = s.replace(re, ' '); break; }
  }
  // Desfase numérico al final, detrás de la hora: '7:31:05 +02:00'
  if (off == null) {
    s = s.replace(/(\d{1,2}:\d{2}(?::\d{2})?)\s*([+-])(\d{2}):?(\d{2})\s*$/, (m, time, sg, h, mm) => {
      const v = (sg === '-' ? -1 : 1) * (Number(h) * 60 + Number(mm));
      if (Math.abs(v) > 14 * 60) return m;
      off = v;
      return `${time} `;
    });
  }
  s = s.replace(WEEKDAY_WORDS, ' ').replace(WEEKDAY_ABBR_LEAD, '').replace(/\b(a las|a la|at|de|del|el|the)\b/g, ' ');

  const tm = s.match(/\b(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?\b/);
  if (!tm) return null;
  let h = Number(tm[1]);
  const mi = Number(tm[2]);
  const sec = tm[3] != null ? Number(tm[3]) : 0;
  const msPart = tm[4] != null ? Math.round(Number(`0.${tm[4]}`) * 1000) : 0;
  if (ampm) {
    if (h > 12) return null;
    h = (h % 12) + (ampm === 'p' ? 12 : 0);
  }
  const hasSec = tm[3] != null;
  s = `${s.slice(0, tm.index)} ${s.slice(tm.index + tm[0].length)}`.replace(/\s+/g, ' ').trim();

  const ref = Number.isFinite(refMs) ? new Date(refMs) : new Date();
  const build = (y, mo, d) => makeMs(y, mo, d, h, mi, sec, msPart, off);
  const fixYear = (y) => (y < 100 ? 2000 + y : y);
  let ms = NaN;
  let m;
  if ((m = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/))) {
    ms = build(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else if ((m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = fixYear(Number(m[3]));
    // d/m (España) o m/d (EE. UU.): la que caiga más cerca de la sesión
    ms = closest([build(y, b - 1, a), build(y, a - 1, b)], refMs);
  } else {
    const words = s.split(/[^a-z0-9]+/).filter(Boolean);
    const mw = words.find((w) => MONTHS[w] != null);
    if (mw) {
      const nums = words.filter((w) => /^\d+$/.test(w)).map(Number);
      const yIdx = nums.findIndex((n) => n >= 1000);
      let y = yIdx >= 0 ? nums.splice(yIdx, 1)[0] : null;
      const d = nums.find((n) => n >= 1 && n <= 31);
      if (d != null) {
        if (y == null) {
          const rest = nums.filter((n, i) => i !== nums.indexOf(d));
          if (rest.length && rest[0] < 100) y = fixYear(rest[0]);
        }
        const mo = MONTHS[mw];
        if (y != null) ms = build(y, mo, d);
        else ms = closest([-1, 0, 1].map((k) => build(ref.getFullYear() + k, mo, d)), refMs);
      }
    } else {
      // Solo hora (o «hoy/ayer»): el día de la sesión, el más cercano
      let base = 0;
      if (/\b(ayer|yesterday)\b/.test(s)) base = -1;
      else if (/\b(manana|tomorrow)\b/.test(s)) base = 1;
      const cands = (/\b(hoy|today|ayer|yesterday|manana|tomorrow)\b/.test(s) ? [base] : [-1, 0, 1]).map((k) => {
        const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + k);
        return build(d.getFullYear(), d.getMonth(), d.getDate());
      });
      ms = closest(cands, refMs);
    }
  }
  return Number.isFinite(ms) ? { ms, hasSec, hasTz: off != null } : null;
}

/** Fecha ISO de una coincidencia de ISO_RE. */
function isoMatchMs(m) {
  const [, y, mo, d, h, mi, s, frac, tz] = m;
  const msPart = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0;
  let off = null;
  if (tz) {
    if (/^z$/i.test(tz)) off = 0;
    else {
      const t = tz.replace(':', '');
      const v = (t[0] === '-' ? -1 : 1) * (Number(t.slice(1, 3)) * 60 + Number(t.slice(3, 5) || 0));
      if (Math.abs(v) <= 14 * 60) off = v;
    }
  }
  const ms = makeMs(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s || 0), msPart, off);
  return Number.isFinite(ms) ? { ms, hasSec: s != null, hasTz: off != null } : null;
}

/** Muestras de un texto con fechas ISO (las separe lo que las separe: saltos, comas, espacios…). */
function scanIso(text) {
  const matches = [...text.matchAll(ISO_RE)];
  if (!matches.length) return null;
  const firstNum = (seg) => { VALUE_IN_RE.lastIndex = 0; const m = VALUE_IN_RE.exec(seg); return m ? m[1] : null; };
  const lastNum = (seg) => { let last = null; for (const m of seg.matchAll(VALUE_IN_RE)) last = m[1]; return last; };
  const before0 = text.slice(0, matches[0].index);
  const lastM = matches[matches.length - 1];
  const afterLast = text.slice(lastM.index + lastM[0].length);
  const valueFirst = firstNum(before0) != null && firstNum(afterLast.replace(UNIT_RE, ' ')) == null;
  const out = [];
  let skipped = 0;
  matches.forEach((m, i) => {
    const end = m.index + m[0].length;
    const seg = valueFirst
      ? text.slice(i ? matches[i - 1].index + matches[i - 1][0].length : 0, m.index)
      : text.slice(end, i + 1 < matches.length ? matches[i + 1].index : text.length);
    const raw = valueFirst ? lastNum(seg) : firstNum(seg);
    const d = isoMatchMs(m);
    const bpm = raw != null ? Number(raw.replace(',', '.')) : NaN;
    if (!d || !Number.isFinite(bpm)) { skipped++; return; }
    out.push({ ms: d.ms, bpm, hasSec: d.hasSec, hasTz: d.hasTz });
  });
  return { samples: out, skipped };
}

/** Muestras línea a línea con fechas «humanas» de iOS. */
function scanLines(text, refMs) {
  const out = [];
  let skipped = 0;
  for (const line0 of text.split('\n')) {
    const line = line0.replace(UNIT_RE, ' ').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    let got = null;
    const end = line.match(/^(.*?)(?:[\s,;|\t=])(\d{2,3}(?:[.,]\d{1,2})?)\s*[,;|]?\s*$/);
    if (end) {
      const d = parseLooseDate(end[1].replace(/[\s,;|\t-]+$/, ''), refMs);
      if (d) got = { ms: d.ms, bpm: Number(end[2].replace(',', '.')), hasSec: d.hasSec, hasTz: d.hasTz };
    }
    if (!got) {
      const first = line.match(/^(\d{2,3}(?:[.,]\d{1,2})?)\s*[,;|\t]\s*(.+)$/) || line.match(/^(\d{2,3}(?:[.,]\d{1,2})?)\s+(.+)$/);
      if (first) {
        const d = parseLooseDate(first[2], refMs);
        if (d) got = { ms: d.ms, bpm: Number(first[1].replace(',', '.')), hasSec: d.hasSec, hasTz: d.hasTz };
      }
    }
    if (got && Number.isFinite(got.bpm)) out.push(got);
    else skipped++;
  }
  return { samples: out, skipped };
}

/** JSON tolerante: comas finales, saltos de línea sin escapar, JSON dentro de una cadena… */
function escapeRawNewlines(s) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') { out += c + (s[i + 1] ?? ''); i++; continue; }
      if (c === '"') inStr = false;
      else if (c === '\n') { out += '\\n'; continue; }
      else if (c === '\t') { out += '\\t'; continue; }
    } else if (c === '"') inStr = true;
    out += c;
  }
  return out;
}

function tryJson(s) {
  try { return JSON.parse(s); } catch { return undefined; }
}

function extractJson(text) {
  const whole = text.trim();
  let v = tryJson(whole);
  if (typeof v === 'string') v = tryJson(v.trim());
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  const body = text.slice(a, b + 1);
  for (const cand of [body, escapeRawNewlines(body).replace(/,\s*([}\]])/g, '$1'), body.replace(/\\"/g, '"')]) {
    const o = tryJson(cand);
    if (o && typeof o === 'object' && !Array.isArray(o)) return o;
  }
  // Último recurso: pares "clave": valor sueltos
  const o = {};
  for (const m of body.matchAll(/"([A-Za-zÁÉÍÓÚáéíóú_]+)"\s*:\s*("(?:[^"\\]|\\.)*"|[^,}\s]+)/g)) {
    let val = m[2];
    if (val.startsWith('"')) {
      const parsed = tryJson(escapeRawNewlines(val));
      val = typeof parsed === 'string' ? parsed : val.slice(1, -1).replace(/\\n/g, '\n');
    }
    o[m[1]] = val;
  }
  return Object.keys(o).length ? o : null;
}

function pickKey(obj, names) {
  for (const k of Object.keys(obj)) {
    if (names.includes(stripAccents(k.toLowerCase()))) return obj[k];
  }
  return undefined;
}

function csvToText(csv) {
  if (csv == null) return '';
  if (typeof csv === 'string') return csv;
  if (Array.isArray(csv)) {
    return csv.map((x) => {
      if (x && typeof x === 'object' && !Array.isArray(x)) {
        const d = pickKey(x, ['fecha', 'date', 'start', 'startdate', 't', 'time', 'fechadeinicio']);
        const v = pickKey(x, ['valor', 'value', 'bpm', 'hr', 'v']);
        return `${d ?? ''},${v ?? ''}`;
      }
      return Array.isArray(x) ? x.join(',') : String(x);
    }).join('\n');
  }
  return String(csv);
}

const timeLabel = (ms) => {
  const d = new Date(ms);
  return `${d.getHours()}:${pad2(d.getMinutes())}`;
};

function fail(error) {
  return { ok: false, error };
}

/**
 * Lee lo que copió el Atajo y lo asocia a la sesión.
 * Acepta el JSON { v, id, avg, max, min, csv } o solo líneas 'fecha,valor' (ISO o fechas de iOS en español/inglés).
 * → { ok:true, hrAvg, hrMax, hrMin, hrSeries:[[tSec,bpm]]|null, samples, source, warnings } | { ok:false, error }
 */
export function parseWatchHr(text, session) {
  const raw = normalizeText(text);
  if (!raw.trim()) return fail('El portapapeles está vacío. Ejecuta el Atajo y, cuando termine, vuelve y pulsa «Pegar datos del Watch».');
  const win = watchHrWindow(session);
  const refMs = win ? win.startMs : Date.now();
  const warnings = [];

  const json = /[{]/.test(raw) ? extractJson(raw) : null;
  let meta = {};
  let body = raw;
  let source = 'csv';
  if (json) {
    source = 'json';
    meta = {
      id: pickKey(json, ['id']),
      avg: parseNum(pickKey(json, ['avg', 'media', 'promedio', 'average', 'mean'])),
      max: parseNum(pickKey(json, ['max', 'maximo', 'maximum'])),
      min: parseNum(pickKey(json, ['min', 'minimo', 'minimum'])),
    };
    body = normalizeText(csvToText(pickKey(json, ['csv', 'datos', 'muestras', 'samples', 'data', 'series', 'hr'])));
    const hasStats = [meta.avg, meta.max, meta.min].some(Number.isFinite);
    if (!body.trim() && !hasStats) {
      if (pickKey(json, ['start']) != null && pickKey(json, ['end']) != null) {
        return fail('Esto es lo que BestRunning envía al Atajo, no su respuesta. Revisa que el Atajo termine con «Copiar al portapapeles» del Diccionario con avg, max, min y csv.');
      }
      return fail('No reconozco estos datos. El Atajo debe copiar un Diccionario con las claves v, id, avg, max, min y csv.');
    }
  }

  // Muestras
  let scan = scanIso(body);
  if (!scan || !scan.samples.length) {
    const lines = scanLines(body, refMs);
    if (!scan || lines.samples.length) scan = lines;
  }
  let samples = scan.samples;
  const parsedCount = samples.length;
  samples = samples.filter((p) => p.bpm >= HR_MIN && p.bpm <= HR_MAX);
  const implausible = parsedCount - samples.length;
  if (parsedCount && !samples.length) return fail(`Los valores de pulso no son válidos: deben estar entre ${HR_MIN} y ${HR_MAX} ppm.`);
  if (implausible) warnings.push(`Descartadas ${implausible} lecturas fuera de ${HR_MIN}–${HR_MAX} ppm.`);

  // Precisión de minutos: reparte las muestras del mismo minuto (si no, se apilarían en un punto)
  if (samples.length && samples.every((p) => !p.hasSec)) {
    const groups = new Map();
    for (const p of samples) {
      if (!groups.has(p.ms)) groups.set(p.ms, []);
      groups.get(p.ms).push(p);
    }
    for (const [ms, arr] of groups) arr.forEach((p, i) => { p.ms = ms + ((i + 0.5) * 60000) / arr.length; });
  } else {
    // Duplicados exactos (misma hora y valor) fuera
    const seen = new Set();
    samples = samples.filter((p) => {
      const k = `${Math.round(p.ms / 1000)}|${p.bpm}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  samples.sort((a, b) => a.ms - b.ms);

  const idMismatch = !!(meta.id && session?.id && String(meta.id) !== String(session.id));
  let inWin = samples;
  if (win && samples.length) {
    const lo = win.startMs - 5000;
    const hi = win.endMs + 5000;
    inWin = samples.filter((p) => p.ms >= lo && p.ms <= hi);
    // Hora local tomada como UTC (o al revés) en fechas sin zona: se corrige si encaja de lleno
    if (!inWin.length && !idMismatch && samples.every((p) => !p.hasTz)) {
      const offH = -new Date(win.startMs).getTimezoneOffset() / 60;
      for (const k of [offH, -offH].filter((x) => x)) {
        const shifted = samples.filter((p) => p.ms + k * 3600e3 >= lo && p.ms + k * 3600e3 <= hi);
        if (shifted.length >= Math.max(3, samples.length * 0.6)) {
          samples.forEach((p) => { p.ms += k * 3600e3; });
          inWin = shifted;
          warnings.push('Hemos corregido la zona horaria de los datos.');
          break;
        }
      }
    }
  }

  const fmtWin = win ? `${timeLabel(win.startMs)}–${timeLabel(win.endMs)}` : '';
  if (samples.length && !inWin.length) {
    if (idMismatch) return fail('Estos datos son de otra sesión. Abre el Atajo desde esta sesión con «Importar pulso del Apple Watch» y vuelve a pegar.');
    return fail(`Las lecturas del Watch (${timeLabel(samples[0].ms)}–${timeLabel(samples[samples.length - 1].ms)}) no coinciden con la hora de esta sesión (${fmtWin}). ¿Copiaste el pulso de otro entreno?`);
  }
  if (idMismatch) warnings.push('Los datos venían de otra sesión, pero coinciden con la hora de esta.');

  const plaus = (v) => (Number.isFinite(v) && v >= HR_MIN && v <= HR_MAX ? Math.round(v) : null);
  if (inWin.length < 3) {
    const avg = plaus(meta.avg);
    if (!samples.length && avg) {
      // Solo estadísticas (sin csv): sirven, aunque sin gráfico
      let mx = plaus(meta.max);
      let mn = plaus(meta.min);
      if (mx != null && mx < avg) mx = null;
      if (mn != null && mn > avg) mn = null;
      warnings.push('El Atajo no envió las lecturas: tendrás la media y la máxima, pero no el gráfico.');
      return { ok: true, hrAvg: avg, hrMax: mx, hrMin: mn, hrSeries: null, samples: 0, source, warnings };
    }
    if (!parsedCount && !json) {
      return fail('No reconozco estos datos. Ejecuta el Atajo desde esta sesión con «Importar pulso del Apple Watch» y, al volver, pulsa «Pegar datos del Watch».');
    }
    if (!parsedCount) return fail('El Atajo no ha encontrado lecturas de pulso. ¿Grabaste el entreno «Cinta de correr» en el Apple Watch?');
    return fail(`Solo hay ${inWin.length} ${inWin.length === 1 ? 'lectura' : 'lecturas'} de pulso en esta sesión: demasiado pocas. ¿Llevabas el entreno «Cinta de correr» iniciado en el Watch?`);
  }

  // Remuestreo a intervalos de 10 s en TIEMPO DE CLASE (el mismo eje que el perfil y la traza):
  // las pausas no desplazan la línea y los tramos saltados no reciben pulso ajeno.
  const t0 = win ? win.startMs : inWin[0].ms;
  const toClass = wallToClassMapper(session, win);
  const bins = new Map();
  for (const p of inWin) {
    const t = toClass ? toClass(p.ms) : Math.max(0, (p.ms - t0) / 1000);
    if (t == null || !Number.isFinite(t)) continue;
    const b = Math.floor(Math.max(0, t) / BIN_SEC);
    if (!bins.has(b)) bins.set(b, []);
    bins.get(b).push(p.bpm);
  }
  if (bins.size < 3) {
    bins.clear();
    for (const p of inWin) {
      const b = Math.floor(Math.max(0, (p.ms - t0) / 1000) / BIN_SEC);
      if (!bins.has(b)) bins.set(b, []);
      bins.get(b).push(p.bpm);
    }
  }
  const hrSeries = [...bins.entries()].sort((a, b) => a[0] - b[0])
    .map(([b, arr]) => [b * BIN_SEC, Math.round(arr.reduce((x, y) => x + y, 0) / arr.length)]);
  const vals = inWin.map((p) => p.bpm);
  const hrAvg = Math.round(hrSeries.reduce((a, p) => a + p[1], 0) / hrSeries.length);
  const hrMax = Math.round(Math.max(...vals));
  const hrMin = Math.round(Math.min(...vals));
  return { ok: true, hrAvg, hrMax, hrMin, hrSeries, samples: inWin.length, source, warnings };
}

/* ═════════════════ Análisis ═════════════════ */

/** Serie válida ordenada: [[t,bpm]] con t ≥ 0 y bpm plausible. */
function cleanSeries(series) {
  return (Array.isArray(series) ? series : [])
    .filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number(p[1]) >= HR_MIN && Number(p[1]) <= HR_MAX)
    .map((p) => [Number(p[0]), Number(p[1])])
    .sort((a, b) => a[0] - b[0]);
}

export function hasHrSeries(session) {
  return Array.isArray(session?.hrSeries) && session.hrSeries.length >= 3;
}

function profileHrMax(profile) {
  return num(profile?.hrMax) || hrMaxFromAge(num(profile?.age) || 46);
}

/** Zona de FC (1..5) de un pulso. */
export function hrZoneOf(bpm, profile) {
  const zones = hrZones(profileHrMax(profile), num(profile?.hrRest) || null);
  let z = 1;
  for (const def of zones) if (bpm >= def.min) z = def.zone;
  return z;
}

/** Segundos por zona de FC: { z1, z2, z3, z4, z5 } (por debajo de Z1 cuenta como Z1). */
export function hrZoneTimes(hrSeries, profile) {
  const pts = cleanSeries(hrSeries);
  const out = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  if (!pts.length) return out;
  const zones = hrZones(profileHrMax(profile), num(profile?.hrRest) || null);
  pts.forEach(([t, bpm], i) => {
    const gap = i + 1 < pts.length ? pts[i + 1][0] - t : BIN_SEC;
    const dt = gap <= MAX_GAP_SEC ? Math.max(0, gap) : BIN_SEC;
    let z = 1;
    for (const def of zones) if (bpm >= def.min) z = def.zone;
    out[`z${z}`] += dt;
  });
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

/** Pulso interpolado en t (null si cae en un hueco > 60 s o fuera de la serie). */
function hrAt(pts, t) {
  if (!pts.length || t < pts[0][0] - 5 || t > pts[pts.length - 1][0] + 5) return null;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] <= t) lo = mid; else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  if (t <= a[0]) return a[1];
  if (t >= b[0]) return b[1];
  if (b[0] - a[0] > 60) return null;
  return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
}

/** Nivel personal (jog/run/fast/sprint) de una velocidad, con tolerancia de ±0,45 km/h. */
function levelOfSpeed(speed, levels) {
  let best = null;
  let bestD = Infinity;
  for (const k of LEVEL_KEYS) {
    const d = Math.abs(num(levels[k]) - speed);
    if (d < bestD) { bestD = d; best = k; }
  }
  return bestD <= 0.45 + 1e-9 ? best : null;
}

const hrLevelCache = new WeakMap();

/**
 * Pulso medio en los tramos de cada nivel (según speedTrace y las velocidades del día).
 * Se ignoran los primeros segundos de cada tramo (el corazón tarda en responder).
 * opts.above (ppm): añade aboveSec y aboveLongest (segundos por encima de ese pulso).
 * → { jog?: { avg, max, sec, speed, n, aboveSec?, aboveLongest? }, run?, fast?, sprint? }
 */
export function hrAtLevels(session, { levels = null, above = null } = {}) {
  if (!session || typeof session !== 'object') return {};
  const lv = levels || session.levelsAtStart || DEFAULT_LEVELS;
  const key = `${LEVEL_KEYS.map((k) => num(lv[k])).join('|')}|${above ?? ''}`;
  let cache = hrLevelCache.get(session);
  if (!cache || cache.series !== session.hrSeries || cache.trace !== session.speedTrace) {
    cache = { series: session.hrSeries, trace: session.speedTrace, map: new Map() };
    hrLevelCache.set(session, cache);
  }
  if (cache.map.has(key)) return cache.map.get(key);

  const pts = cleanSeries(session.hrSeries);
  const trace = (Array.isArray(session.speedTrace) ? session.speedTrace : [])
    .filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
    .map((p) => [Number(p[0]), Number(p[1])])
    .sort((a, b) => a[0] - b[0]);
  const out = {};
  if (pts.length >= 3 && trace.length) {
    // Tramos [a, b) por nivel, uniendo los contiguos del mismo nivel
    const traceEnd = Math.max(trace[trace.length - 1][0], num(session.elapsedSec));
    const wins = [];
    trace.forEach(([t, speed], i) => {
      const end = i + 1 < trace.length ? trace[i + 1][0] : traceEnd;
      if (!(end > t)) return;
      const k = levelOfSpeed(speed, lv);
      const last = wins[wins.length - 1];
      if (last && last.k === k && Math.abs(last.b - t) < 1e-6) { last.b = end; last.sd += speed * (end - t); }
      else wins.push({ k, a: t, b: end, sd: speed * (end - t) });
    });
    const acc = {};
    for (const w of wins) {
      if (!w.k) continue;
      const dur = w.b - w.a;
      const lag = Math.min(30, dur * 0.3);
      const A = acc[w.k] || (acc[w.k] = { sum: 0, n: 0, max: 0, sec: 0, sd: 0, dur: 0, above: 0, longest: 0 });
      A.sd += w.sd;
      A.dur += dur;
      let run = 0;
      for (let t = w.a + lag; t < w.b; t += 5) {
        const v = hrAt(pts, t);
        if (v == null) { run = 0; continue; }
        const dt = Math.min(5, w.b - t);
        A.sum += v;
        A.n += 1;
        A.sec += dt;
        A.max = Math.max(A.max, v);
        if (above != null) {
          if (v > above) { A.above += dt; run += dt; A.longest = Math.max(A.longest, run); } else run = 0;
        }
      }
    }
    for (const k of LEVEL_KEYS) {
      const A = acc[k];
      if (!A || !A.n || A.sec < 30) continue;
      out[k] = { avg: Math.round(A.sum / A.n), max: Math.round(A.max), sec: Math.round(A.sec), speed: r1(A.sd / A.dur), n: A.n };
      if (above != null) { out[k].aboveSec = Math.round(A.above); out[k].aboveLongest = Math.round(A.longest); }
    }
  }
  cache.map.set(key, out);
  return out;
}

/** Campos que se guardan en la sesión tras importar. */
export function hrFieldsFrom(result, profile) {
  const series = Array.isArray(result?.hrSeries) && result.hrSeries.length ? result.hrSeries.map((p) => [p[0], p[1]]) : null;
  return {
    hrAvg: result?.hrAvg ?? null,
    hrMax: result?.hrMax ?? null,
    hrMin: result?.hrMin ?? null,
    hrSeries: series,
    hrZones: series ? hrZoneTimes(series, profile) : null,
  };
}

/** Campos a cero para «Quitar pulso». */
export function hrFieldsCleared() {
  return { hrAvg: null, hrMax: null, hrMin: null, hrSeries: null, hrZones: null };
}

/* ═════════════════ Gráficos (cadenas SVG/HTML) ═════════════════ */

export const HR_COLOR = '#FF3B5C';

/** Escala de tiempo idéntica a profileChart: span = max(Σ segmentos, fin de la traza). */
function chartSpan(segments, trace) {
  const segs = Array.isArray(segments) ? segments.filter((s) => s && Number(s.sec) > 0) : [];
  const total = segs.reduce((a, s) => a + Number(s.sec), 0);
  const tr = Array.isArray(trace) ? trace.filter((p) => Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1])) : [];
  const traceEnd = tr.length ? Math.max(...tr.map((p) => p[0])) : 0;
  return Math.max(total, traceEnd) || 0;
}

/** Curva suave (Catmull-Rom → Bézier) por los puntos [[x,y]]. */
function smoothPath(p) {
  if (p.length < 2) return '';
  const f = (v) => Math.round(v * 100) / 100;
  let d = `M${f(p[0][0])} ${f(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/**
 * SVG del pulso para superponer a profileChart (mismo viewBox 360×height y misma escala de tiempo).
 * Va dentro de un contenedor .whr-chart junto al gráfico (ver withHrOverlay).
 */
export function hrOverlaySvg(hrSeries, { segments = null, trace = null, height = 120, animate = true } = {}) {
  const pts = cleanSeries(hrSeries);
  const span = chartSpan(segments, trace) || (pts.length ? pts[pts.length - 1][0] : 0);
  if (pts.length < 3 || !(span > 0)) return '';
  const W = 360;
  const H = Math.max(24, Number(height) || 120);
  const top = 12;
  const bottom = H - 6;
  // Suavizado ligero (media móvil de 3) antes de la curva
  const sm = pts.map((p, i) => {
    const a = pts[i - 1];
    const b = pts[i + 1];
    const near = [p, a && p[0] - a[0] <= 30 ? a : null, b && b[0] - p[0] <= 30 ? b : null].filter(Boolean);
    return [p[0], near.reduce((s, q) => s + q[1], 0) / near.length];
  });
  const vals = sm.map((p) => p[1]);
  let lo = Math.max(HR_MIN, Math.floor((Math.min(...vals) - 6) / 10) * 10);
  let hi = Math.min(HR_MAX, Math.ceil((Math.max(...vals) + 6) / 10) * 10);
  if (hi - lo < 30) { const c = (hi + lo) / 2; lo = Math.max(HR_MIN, Math.floor((c - 15) / 10) * 10); hi = lo + 30; }
  const x = (t) => clamp((t / span) * W, 0, W);
  const y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  // Tramos continuos (se corta en huecos > 45 s)
  const runs = [];
  let cur = [];
  sm.forEach((p, i) => {
    if (p[0] > span + 5) return;
    if (i && p[0] - sm[i - 1][0] > 45 && cur.length) { runs.push(cur); cur = []; }
    cur.push([x(p[0]), y(p[1])]);
  });
  if (cur.length) runs.push(cur);
  const lines = runs.filter((r) => r.length >= 2);
  if (!lines.length) return '';
  const d = lines.map(smoothPath).join('');
  const area = lines.map((r) => `${smoothPath(r)}L${r[r.length - 1][0].toFixed(2)} ${bottom}L${r[0][0].toFixed(2)} ${bottom}Z`).join('');
  // Máximo real (sin suavizar) marcado
  let iMax = 0;
  pts.forEach((p, i) => { if (p[1] > pts[iMax][1] && p[0] <= span) iMax = i; });
  const mx = x(pts[iMax][0]);
  const my = y(Math.min(pts[iMax][1], hi));
  const labelX = clamp(mx, 14, W - 14);
  // La cifra del pico va POR ENCIMA del gráfico (no sobre las barras), unida al punto por una guía fina;
  // junto al eje se desplaza a la derecha para no pisar las marcas de ppm
  const lx = mx < 40 ? mx + 6 : labelX;
  const peakLabel = `<line class="whr-peak__guide" x1="${mx.toFixed(1)}" x2="${mx.toFixed(1)}" y1="-1" y2="${Math.max(0, my - 4).toFixed(1)}"/>`
    + `<text x="${lx.toFixed(1)}" y="-3" text-anchor="${mx < 40 ? 'start' : 'middle'}">${Math.round(pts[iMax][1])}</text>`;
  const ticks = [hi, Math.round((hi + lo) / 2), lo].map((v) => `<g class="whr-tick"><line x1="0" x2="5" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="7" y="${(y(v) + 3).toFixed(1)}">${v}</text></g>`).join('');
  const id = `whr${Math.round(Math.random() * 1e9).toString(36)}`;
  return `<svg class="whr-overlay${animate && !reducedMotion() ? ' is-animated' : ''}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Pulso: máximo ${pts[iMax][1]} ppm" focusable="false">
  <defs><linearGradient id="${id}-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${HR_COLOR}" stop-opacity="0.26"/><stop offset="1" stop-color="${HR_COLOR}" stop-opacity="0"/></linearGradient></defs>
  <path class="whr-area" d="${area}" fill="url(#${id}-a)"/>
  <path class="whr-line-shadow" d="${d}" pathLength="1"/>
  <path class="whr-line" d="${d}" pathLength="1"/>
  ${ticks}
  <g class="whr-peak"><circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="3.4"/>${peakLabel}</g>
</svg>`;
}

/** Envuelve el HTML de profileChart con la superposición de pulso (si hay serie). */
export function withHrOverlay(chartHtml, session, { segments = null, height = 120 } = {}) {
  const ov = hasHrSeries(session) ? hrOverlaySvg(session.hrSeries, { segments, trace: session.speedTrace, height }) : '';
  return `<div class="whr-chart">${chartHtml}${ov}</div>`;
}

/** Leyenda pequeña «— Pulso». */
export function hrLegendHtml() {
  return `<span class="whr-legend"><i></i>Pulso</span>`;
}

/** Barra apilada + filas Z1–Z5 con tiempo, % y rango de ppm. */
export function hrZonesHtml(zoneTimes, profile) {
  const zt = zoneTimes && typeof zoneTimes === 'object' ? zoneTimes : {};
  const defs = hrZones(profileHrMax(profile), num(profile?.hrRest) || null);
  const total = defs.reduce((a, z) => a + num(zt[`z${z.zone}`]), 0);
  if (!total) return '<p class="whr-empty">Sin datos de zonas de pulso.</p>';
  const maxSec = Math.max(...defs.map((z) => num(zt[`z${z.zone}`])));
  const track = defs.filter((z) => num(zt[`z${z.zone}`]) > 0)
    .map((z) => `<span style="flex:${num(zt[`z${z.zone}`])} 1 0;background:${z.color}"></span>`).join('');
  const rows = defs.slice().reverse().map((z, i) => {
    const sec = num(zt[`z${z.zone}`]);
    const pct = Math.round((sec / total) * 100);
    const name = String(z.name).split('·').pop().trim();
    const range = z.zone === 5 ? `> ${z.min}` : `${z.min}–${z.max}`;
    return `<div class="whr-zrow${sec ? '' : ' is-empty'}" style="--zc:${z.color};--i:${i}">
      <span class="whr-zrow__badge num">Z${z.zone}</span>
      <span class="whr-zrow__name">${esc(name)}<small>${range} ppm</small></span>
      <span class="whr-zrow__bar"><i style="width:${maxSec ? Math.max(sec ? 3 : 0, Math.round((sec / maxSec) * 100)) : 0}%"></i></span>
      <span class="whr-zrow__time num">${fmt.clock(sec)}</span>
      <span class="whr-zrow__pct num">${pct}%</span>
    </div>`;
  }).join('');
  return `<div class="whr-zones"><div class="whr-zones__track" role="img" aria-label="Tiempo en zonas de pulso">${track}</div><div class="whr-zones__rows">${rows}</div></div>`;
}

/**
 * Filas «Pulso por velocidad». stats = { jog: { avg, speed, sec, prevAvg?, prevN?, delta? }, … }
 * (hrAtLevels o progression.hrLevelTrends).
 */
export function hrLevelsHtml(stats, profile) {
  const st = stats && typeof stats === 'object' ? stats : {};
  const keys = LEVEL_KEYS.filter((k) => st[k] && st[k].avg > 0);
  if (!keys.length) return '<p class="whr-empty">No hay tramos suficientemente largos a tus velocidades para comparar el pulso.</p>';
  const hrMax = profileHrMax(profile);
  const rows = keys.map((k, i) => {
    const s = st[k];
    const pct = Math.round((s.avg / hrMax) * 100);
    const z = ZONES[k];
    let trend = '';
    if (Number.isFinite(s.delta) && s.prevN > 0) {
      const d = Math.round(s.delta);
      const cls = d <= -2 ? 'is-down' : d >= 2 ? 'is-up' : 'is-flat';
      const txt = d === 0 ? '=' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`;
      trend = `<span class="whr-lv__trend ${cls}" title="Frente a la media de tus ${s.prevN} sesiones anteriores a ${fmt.speed(s.speed)} km/h">${txt}</span>`;
    } else {
      trend = '<span class="whr-lv__trend is-new" title="Primera referencia a esta velocidad">nuevo</span>';
    }
    return `<div class="whr-lv" style="--zc:${z?.color || HR_COLOR};--i:${i}">
      <span class="whr-lv__dot"></span>
      <span class="whr-lv__name">${esc(z?.short || k)}<small class="num">${fmt.speed(s.speed)} km/h · ${fmt.clock(s.sec)}</small></span>
      <span class="whr-lv__bar" aria-hidden="true"><i style="width:${clamp(pct, 0, 100)}%"></i></span>
      <span class="whr-lv__hr num">${s.avg}<small>ppm</small></span>
      ${trend}
    </div>`;
  }).join('');
  const anyTrend = keys.some((k) => st[k].prevN > 0);
  return `<div class="whr-levels">${rows}</div>${anyTrend ? '<p class="whr-foot">Diferencia frente a la media de tus sesiones anteriores a la misma velocidad. Menos pulso al mismo ritmo = más forma.</p>' : ''}`;
}

/** Cifras grandes Media · Máx · Mín. */
export function hrStatsHtml(session, profile) {
  const hrMax = profileHrMax(profile);
  const cell = (label, v, extra = '') => `<div class="whr-stat"><span class="whr-stat__label">${label}</span><b class="whr-stat__value num">${v ?? '–'}</b><span class="whr-stat__unit">ppm${extra}</span></div>`;
  const pctMax = session?.hrMax ? ` · ${Math.round((session.hrMax / hrMax) * 100)} %` : '';
  return `<div class="whr-stats">${cell('Media', session?.hrAvg)}${cell('Máxima', session?.hrMax, pctMax)}${cell('Mínima', session?.hrMin)}</div>`;
}

/** Aviso si el pulso superó la FC máx. del perfil (las zonas estarían desplazadas). */
export function hrMaxHintHtml(session, profile) {
  const hrMax = profileHrMax(profile);
  const seen = num(session?.hrMax);
  if (!(seen > hrMax)) return '';
  return `<p class="whr-hint">Llegaste a ${Math.round(seen)} ppm, por encima de tu FC máx. (${hrMax}). <button type="button" class="whr-hint__link" data-href="#/settings/profile">Actualízala en tu perfil</button> para afinar tus zonas.</p>`;
}

/* ═════════════════ Interfaz: importación ═════════════════ */

function markPending(id) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ id, at: Date.now() })); } catch { /* sin almacenamiento */ }
}
function clearPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* sin almacenamiento */ }
}
/** ¿Hay una importación a medias para esta sesión? (la app pudo recargarse mientras estabas en Atajos). */
export function hasPendingWatchHr(sessionId) {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    if (!p || p.id !== sessionId) return false;
    if (Date.now() - num(p.at) > PENDING_TTL) { clearPending(); return false; }
    return true;
  } catch {
    return false;
  }
}

/**
 * Pulsar «Importar pulso del Apple Watch»: abre el Atajo y, al volver a la app, muestra la hoja de pegar.
 * opts: { getSession, getState, onImported(result) → boolean, shortcutName }. Devuelve una función para cancelar.
 */
export function startWatchHrImport(opts = {}) {
  if (!hasDOM()) return () => {};
  ensureWatchHrStyles();
  const session = opts.getSession?.();
  if (!session) return () => {};
  const name = opts.shortcutName || watchShortcutName(opts.getState?.());
  let hidden = document.visibilityState === 'hidden';
  let done = false;
  let timer = 0;
  const cleanup = () => {
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('pageshow', onFocus);
    clearTimeout(timer);
  };
  const show = () => {
    if (done) return;
    done = true;
    cleanup();
    openWatchHrSheet({ ...opts, shortcutName: name }).catch(() => {});
  };
  const back = () => { clearTimeout(timer); timer = setTimeout(show, 420); };
  function onVis() {
    if (document.visibilityState === 'hidden') { hidden = true; clearTimeout(timer); } else if (hidden) back();
  }
  function onBlur() { hidden = true; clearTimeout(timer); }
  function onFocus() { if (hidden && document.visibilityState !== 'hidden') back(); }
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  window.addEventListener('pageshow', onFocus);
  markPending(session.id);
  const opened = requestWatchHr(session, name);
  // Si Atajos no llega a abrirse (o no estamos en un iPhone), la hoja aparece igualmente
  timer = setTimeout(() => { if (!hidden) show(); }, opened ? 2600 : 0);
  return () => { done = true; cleanup(); };
}

/**
 * Hoja «Pegar datos del Watch». El botón grande lee el portapapeles dentro del gesto (requisito de iOS).
 * Si no se puede leer, ofrece pegar a mano en un recuadro.
 * opts: { getSession, getState, onImported(result) → boolean, shortcutName, showSettingsLink = true }
 */
export async function openWatchHrSheet(opts = {}) {
  if (!hasDOM()) return null;
  ensureWatchHrStyles();
  let ui;
  try { ui = await import('../ui/components.js'); } catch { return null; }
  let haptic = () => {};
  try { haptic = (await import('../core/haptics.js')).haptic || haptic; } catch { /* sin vibración */ }
  const { icon, openSheet } = ui;
  const st = opts.getState?.() || {};
  const name = opts.shortcutName || watchShortcutName(st);
  const ready = isWatchShortcutReady(st);
  const guide = `
    <div class="whr-sheet__guide card">
      <b class="whr-sheet__gtitle">${icon('info', 16)} ${ready ? 'Cómo es el Atajo' : 'Primero, crea el Atajo (2 minutos)'}</b>
      <p class="whr-sheet__gtext">El Atajo «${esc(name)}» lee de Salud el pulso de esta sesión y lo copia para BestRunning. Solo hay que crearlo una vez.</p>
      ${ready ? `<details class="whr-details"><summary>Ver los pasos</summary>${shortcutGuideHtml({ name })}</details>` : shortcutGuideHtml({ name })}
      ${opts.showSettingsLink === false ? '' : `<button type="button" class="btn btn--ghost btn--block whr-sheet__link" data-href="#/settings/watch">${icon('gear', 16)}<span>Guía completa en Ajustes</span></button>`}
    </div>`;
  const html = `
    <div class="whr-sheet${ready ? '' : ' is-setup'}" data-whr-root>
      <div class="whr-sheet__main">
        <div class="whr-sheet__hero">
          <span class="whr-sheet__icon" aria-hidden="true">${icon('watch', 30)}<i class="whr-beat">${icon('heart', 14, { stroke: 2.6 })}</i></span>
          <p class="whr-sheet__lead">Cuando el Atajo termine, tu pulso estará copiado. Pulsa el botón y toca <b>Pegar</b> si iOS te lo pregunta.</p>
        </div>
        <button type="button" class="btn btn--primary btn--lg btn--block whr-paste" data-whr="paste">${icon('copy', 20)}<span>Pegar datos del Watch</span></button>
        <div class="whr-msg" data-whr-msg role="status" aria-live="polite"></div>
        <details class="whr-details whr-manual" data-whr-manual>
          <summary>¿No funciona? Pégalo a mano</summary>
          <textarea class="field whr-manual__text" data-whr-text rows="4" placeholder="Mantén pulsado aquí y elige «Pegar»" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>
          <button type="button" class="btn btn--secondary btn--block" data-whr="use">${icon('check', 18)}<span>Usar este texto</span></button>
        </details>
        <button type="button" class="btn btn--ghost btn--block whr-reopen" data-whr="reopen">${icon('refresh', 17)}<span>Abrir el Atajo otra vez</span></button>
      </div>
      ${guide}
    </div>`;

  let finished = false;
  const sheet = openSheet({
    title: 'Pulso del Apple Watch',
    html,
    large: !ready,
    onClose: () => { if (!finished) clearPending(); },
    onMount: (el, close) => {
      const root = el.querySelector('[data-whr-root]');
      const msg = el.querySelector('[data-whr-msg]');
      const pasteBtn = el.querySelector('[data-whr="paste"]');
      const manual = el.querySelector('[data-whr-manual]');
      const area = el.querySelector('[data-whr-text]');
      const setMsg = (text, kind = 'error') => {
        if (!msg) return;
        msg.className = `whr-msg is-${kind}`;
        msg.innerHTML = text ? `${icon(kind === 'error' ? 'warning' : 'info', 16)}<span>${esc(text)}</span>` : '';
        if (kind === 'error' && !reducedMotion()) { msg.classList.remove('is-shake'); void msg.offsetWidth; msg.classList.add('is-shake'); }
      };
      const busy = (on) => {
        if (!pasteBtn) return;
        pasteBtn.disabled = on;
        pasteBtn.classList.toggle('is-busy', on);
        const lbl = pasteBtn.querySelector('span');
        if (lbl) lbl.textContent = on ? 'Leyendo…' : 'Pegar datos del Watch';
      };
      const handle = (text) => {
        let res;
        try { res = parseWatchHr(text, opts.getSession?.()); } catch { res = fail('No hemos podido leer esos datos.'); }
        if (!res.ok) { haptic('error'); setMsg(res.error, 'error'); return; }
        let saved = false;
        try { saved = opts.onImported?.(res) !== false; } catch { saved = false; }
        if (!saved) { haptic('error'); setMsg('No hemos podido guardar el pulso. Inténtalo otra vez.', 'error'); return; }
        finished = true;
        clearPending();
        haptic('success');
        if (root) {
          root.classList.add('is-done');
          root.innerHTML = `<div class="whr-done">
            <span class="whr-done__check">${icon('check', 38, { stroke: 3 })}</span>
            <b class="whr-done__title">¡Pulso importado!</b>
            <span class="whr-done__nums num">Media ${res.hrAvg ?? '–'} · Máx ${res.hrMax ?? '–'}${res.hrMin ? ` · Mín ${res.hrMin}` : ''} ppm</span>
            <span class="whr-done__sub">${res.samples ? `${res.samples} lecturas del Apple Watch` : 'Resumen del Apple Watch'}${res.warnings?.length ? ` · ${esc(res.warnings[0])}` : ''}</span>
          </div>`;
        }
        setTimeout(() => close(), reducedMotion() ? 900 : 1500);
      };
      pasteBtn?.addEventListener('click', () => {
        // La lectura del portapapeles tiene que arrancar aquí mismo, dentro del gesto
        let p = null;
        try { p = navigator.clipboard?.readText?.(); } catch { p = null; }
        if (!p || typeof p.then !== 'function') {
          if (manual) manual.open = true;
          setMsg('Este navegador no deja leer el portapapeles. Mantén pulsado el recuadro, elige «Pegar» y toca «Usar este texto».', 'info');
          return;
        }
        busy(true);
        p.then((text) => { busy(false); handle(text); }, () => {
          busy(false);
          if (manual) manual.open = true;
          setMsg('iOS no ha dejado pegar. Vuelve a pulsar y toca «Pegar», o pégalo a mano en el recuadro.', 'info');
        });
      });
      el.querySelector('[data-whr="use"]')?.addEventListener('click', () => {
        const t = area?.value || '';
        if (!t.trim()) { haptic('warning'); setMsg('El recuadro está vacío: mantén pulsado dentro y elige «Pegar».', 'info'); area?.focus(); return; }
        handle(t);
      });
      el.querySelector('[data-whr="reopen"]')?.addEventListener('click', () => {
        const s = opts.getSession?.();
        if (!s) return;
        haptic('light');
        markPending(s.id);
        setMsg('');
        if (!requestWatchHr(s, name)) setMsg('No se ha podido abrir Atajos.', 'error');
      });
    },
  });
  return sheet;
}

/* ═════════════════ Estilos (privados de este módulo) ═════════════════ */

const CSS = `
.whr-chart{position:relative}
.whr-overlay{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
.whr-line,.whr-line-shadow{fill:none;stroke-linecap:round;stroke-linejoin:round}
.whr-line{stroke:${HR_COLOR};stroke-width:2.2;filter:drop-shadow(0 0 3px rgba(255,59,92,.6))}
.whr-line-shadow{stroke:rgba(8,8,10,.62);stroke-width:5}
.whr-overlay.is-animated .whr-line,.whr-overlay.is-animated .whr-line-shadow{stroke-dasharray:1;stroke-dashoffset:1;animation:whr-draw 1.5s var(--ease-out) .35s forwards}
.whr-overlay.is-animated .whr-area,.whr-overlay.is-animated .whr-peak{opacity:0;animation:whr-fade .6s ease 1.4s forwards}
.whr-tick line{stroke:${HR_COLOR};stroke-opacity:.7;stroke-width:1}
.whr-tick text,.whr-peak text{font-family:var(--font-display);font-size:9px;font-weight:800;fill:#ff8a9e;paint-order:stroke;stroke:rgba(8,8,10,.88);stroke-width:3px;stroke-linejoin:round;font-variant-numeric:tabular-nums}
.whr-peak circle{fill:#fff;stroke:${HR_COLOR};stroke-width:2}
.whr-peak text{fill:#fff}
.whr-peak__guide{stroke:#fff;stroke-opacity:.45;stroke-width:1;stroke-dasharray:2 2;vector-effect:non-scaling-stroke}
.whr-chart:has(.whr-peak){margin-top:12px}
.whr-legend{display:inline-flex;align-items:center;gap:6px;margin-left:8px;font:600 12px/1 var(--font);color:var(--text-3)}
.whr-legend i{width:14px;height:3px;border-radius:2px;background:${HR_COLOR};box-shadow:0 0 6px rgba(255,59,92,.7)}
.whr-empty{margin:0;font-size:var(--fs-footnote);line-height:1.4;color:var(--text-3)}
.whr-zones{display:flex;flex-direction:column;gap:12px}
.whr-zones__track{display:flex;gap:2px;height:12px;border-radius:var(--r-pill);overflow:hidden;background:var(--surface-3)}
.whr-zones__track span{min-width:3px}
.whr-zones__rows{display:flex;flex-direction:column;gap:6px}
.whr-zrow{display:grid;grid-template-columns:34px minmax(0,1.1fr) minmax(40px,1fr) auto 38px;align-items:center;gap:10px;min-height:36px;animation:whr-up .42s var(--ease-spring) both;animation-delay:calc(var(--i,0)*60ms + 120ms)}
.whr-zrow.is-empty{opacity:.45}
.whr-zrow__badge{display:grid;place-items:center;height:24px;border-radius:8px;font-size:12px;font-weight:800;color:#0b0b0d;background:var(--zc)}
.whr-zrow__name{display:flex;flex-direction:column;gap:2px;min-width:0;font:600 14px/1.15 var(--font);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.whr-zrow__name small{font-size:11px;font-weight:500;color:var(--text-3)}
.whr-zrow__bar{height:8px;border-radius:var(--r-pill);background:var(--surface-3);overflow:hidden}
.whr-zrow__bar i{display:block;height:100%;border-radius:inherit;background:var(--zc);box-shadow:0 0 10px color-mix(in srgb,var(--zc) 60%,transparent)}
.whr-zrow__time{font-size:15px;font-weight:800;text-align:right}
.whr-zrow__pct{font-size:12px;color:var(--text-3);text-align:right}
.whr-levels{display:flex;flex-direction:column;gap:8px}
.whr-lv{display:grid;grid-template-columns:10px minmax(0,1.2fr) minmax(36px,1fr) auto 46px;align-items:center;gap:10px;min-height:48px;padding:8px 12px;border-radius:var(--r-md);background:color-mix(in srgb,var(--zc) 9%,var(--surface-2));border:1px solid color-mix(in srgb,var(--zc) 22%,transparent);animation:whr-up .42s var(--ease-spring) both;animation-delay:calc(var(--i,0)*70ms + 120ms)}
.whr-lv__dot{width:10px;height:10px;border-radius:50%;background:var(--zc);box-shadow:0 0 10px var(--zc)}
.whr-lv__name{display:flex;flex-direction:column;gap:2px;min-width:0;font:700 15px/1.15 var(--font);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.whr-lv__name small{font-size:12px;font-weight:500;color:var(--text-3)}
.whr-lv__bar{height:6px;border-radius:var(--r-pill);background:rgba(255,255,255,.08);overflow:hidden}
.whr-lv__bar i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--zc),${HR_COLOR})}
.whr-lv__hr{font-size:22px;font-weight:800;letter-spacing:-.02em;text-align:right}
.whr-lv__hr small{margin-left:3px;font:600 11px/1 var(--font);color:var(--text-3)}
.whr-lv__trend{justify-self:end;min-width:40px;padding:5px 7px;border-radius:var(--r-pill);font:800 12px/1 var(--font-display);text-align:center;font-variant-numeric:tabular-nums}
.whr-lv__trend.is-down{color:var(--ok);background:color-mix(in srgb,var(--ok) 16%,transparent)}
.whr-lv__trend.is-up{color:var(--accent);background:var(--accent-soft)}
.whr-lv__trend.is-flat{color:var(--text-2);background:var(--surface-3)}
.whr-lv__trend.is-new{font:600 10px/1 var(--font);color:var(--text-3);background:transparent;border:1px dashed var(--line-strong)}
.whr-foot{margin:8px 0 0;font-size:var(--fs-caption);line-height:1.4;color:var(--text-3)}
.whr-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.whr-stat{display:flex;flex-direction:column;gap:3px;min-width:0;padding:10px 12px;border-radius:var(--r-sm);background:linear-gradient(160deg,rgba(255,59,92,.14),rgba(255,59,92,.03)),var(--surface-2);border:1px solid rgba(255,59,92,.18)}
.whr-stat__label{font:700 10px/1 var(--font);letter-spacing:.07em;text-transform:uppercase;color:var(--text-3)}
.whr-stat__value{font-size:28px;font-weight:800;line-height:1;letter-spacing:-.02em;color:#fff}
.whr-stat__unit{font-size:11px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.whr-hint{margin:0;padding:10px 12px;border-radius:var(--r-sm);font-size:var(--fs-footnote);line-height:1.4;color:var(--text-2);background:rgba(255,214,10,.08);border:1px solid rgba(255,214,10,.22)}
.whr-zones+.whr-hint{margin-top:12px}
.whr-hint__link{padding:0;border:0;background:none;font:inherit;font-weight:600;color:var(--accent);text-decoration:underline;text-underline-offset:2px}
.whr-glow{background-image:radial-gradient(70% 90% at 100% 0%,rgba(255,59,92,.16),transparent 70%)}
.whr-src{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;font-size:var(--fs-caption);color:var(--text-3)}
.whr-src .icon{color:${HR_COLOR}}
.whr-src__acts{display:flex;gap:4px;margin-left:auto}
.whr-mini{min-height:36px;padding:0 10px;gap:5px;font-size:var(--fs-footnote);font-weight:600;color:var(--text-2)}
.whr-cta{position:relative;display:flex;flex-direction:column;gap:12px}
.whr-cta__row{position:relative;display:flex;align-items:flex-start;gap:12px}
.whr-cta__icon{position:relative;flex:none;display:grid;place-items:center;width:48px;height:48px;border-radius:14px;color:#fff;background:linear-gradient(140deg,#ff5e7a,#ff2d55);box-shadow:0 10px 24px -10px rgba(255,45,85,.8)}
.whr-cta__title{display:block;font:700 var(--fs-body)/1.25 var(--font)}
.whr-cta__text{margin:3px 0 0;font-size:var(--fs-footnote);line-height:1.4;color:var(--text-2)}
.whr-cta__btn{position:relative;gap:8px}
.whr-cta__btn .icon{color:${HR_COLOR}}
.whr-cta__links{position:relative;display:flex;flex-wrap:wrap;justify-content:center;gap:4px 14px}
.whr-beat{position:absolute;right:-5px;bottom:-5px;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;color:#fff;background:${HR_COLOR};box-shadow:0 0 0 3px var(--surface);animation:whr-beat 1.1s var(--ease-in-out) infinite}
.whr-manual-hr{margin-top:2px}
.whr-details>summary{display:flex;align-items:center;min-height:44px;cursor:pointer;list-style:none;font:600 var(--fs-sub)/1.2 var(--font);color:var(--accent)}
.whr-details>summary::-webkit-details-marker{display:none}
.whr-details>summary::after{content:'';width:7px;height:7px;margin-left:8px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg) translateY(-2px);transition:transform var(--dur) var(--ease-spring)}
.whr-details[open]>summary::after{transform:rotate(225deg) translate(-2px,0)}
.whr-sheet{display:flex;flex-direction:column;gap:16px;padding-bottom:6px}
.whr-sheet__main{display:flex;flex-direction:column;gap:12px}
.whr-sheet__hero{display:flex;align-items:center;gap:14px}
.whr-sheet__icon{position:relative;flex:none;display:grid;place-items:center;width:58px;height:58px;border-radius:18px;color:#fff;background:linear-gradient(140deg,#3a3a44,#1d1d23);border:1px solid var(--line-strong)}
.whr-sheet__icon .whr-beat{box-shadow:0 0 0 3px rgba(30,30,35,.95)}
.whr-sheet__lead{margin:0;font-size:var(--fs-sub);line-height:1.4;color:var(--text-2)}
.whr-sheet__lead b{color:var(--text)}
.whr-paste{gap:10px;min-height:64px;font-size:19px}
.whr-paste.is-busy{opacity:.7}
.whr-msg{display:none;align-items:flex-start;gap:8px;padding:10px 12px;border-radius:var(--r-sm);font-size:var(--fs-footnote);line-height:1.4}
.whr-msg.is-error,.whr-msg.is-info{display:flex}
.whr-msg.is-error{color:#ffb3bf;background:rgba(255,69,58,.14);border:1px solid rgba(255,69,58,.3)}
.whr-msg.is-info{color:var(--text-2);background:var(--surface-2);border:1px solid var(--line)}
.whr-msg .icon{flex:none;margin-top:1px}
.whr-msg.is-shake{animation:whr-shake .42s ease both}
.whr-manual{display:flex;flex-direction:column}
.whr-manual__text{width:100%;min-height:96px;margin:4px 0 10px;resize:vertical;font:13px/1.35 var(--font-mono)!important;-webkit-user-select:text;user-select:text}
.whr-reopen{gap:8px;color:var(--text-2)}
.whr-sheet__guide{display:flex;flex-direction:column;gap:10px;padding:14px;background:var(--surface-2)}
.whr-sheet__gtitle{display:flex;align-items:center;gap:6px;font:700 var(--fs-sub)/1.25 var(--font)}
.whr-sheet__gtext{margin:0;font-size:var(--fs-footnote);line-height:1.4;color:var(--text-2)}
.whr-sheet__link{gap:6px;color:var(--accent)}
.whr-guide{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}
.whr-guide__step{display:grid;grid-template-columns:24px minmax(0,1fr);gap:10px;align-items:start}
.whr-guide__n{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;font-size:12px;font-weight:800;color:#fff;background:var(--accent-grad)}
.whr-guide__act{display:inline-block;margin-bottom:2px;padding:2px 8px;border-radius:7px;font:700 13px/1.4 var(--font);color:#fff;background:rgba(255,255,255,.1)}
.whr-guide__txt{display:block;font-size:var(--fs-footnote);line-height:1.4;color:var(--text-2)}
.whr-rowhr{display:inline-flex;align-items:center;gap:3px;margin-left:8px;color:#ff6b81;font-weight:700;font-variant-numeric:tabular-nums;vertical-align:-1px}
.whr-tracks{display:flex;flex-direction:column}
.whr-track{display:grid;grid-template-columns:22px minmax(0,1fr) 10px;align-items:center;gap:10px;min-height:48px;padding:6px 0;border-top:1px solid var(--line);animation:whr-up .4s var(--ease-spring) both;animation-delay:calc(var(--i,0)*50ms)}
.whr-track:first-child{border-top:0}
.whr-track__n{font-size:13px;font-weight:700;color:var(--text-3);text-align:center}
.whr-track__txt{display:flex;flex-direction:column;gap:2px;min-width:0}
.whr-track__txt b{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.whr-track__txt small{font-size:12px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.whr-track__dot{width:10px;height:10px;border-radius:50%;background:var(--tc);box-shadow:0 0 10px var(--tc)}
.whr-done{display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px 0 10px;text-align:center}
.whr-done__check{display:grid;place-items:center;width:76px;height:76px;border-radius:50%;color:#fff;background:linear-gradient(140deg,#ff5e7a,#ff2d55);box-shadow:0 14px 36px -12px rgba(255,45,85,.9);animation:whr-pop .6s var(--ease-spring) both}
.whr-done__title{font:800 22px/1.2 var(--font)}
.whr-done__nums{font-size:17px;font-weight:700}
.whr-done__sub{font-size:var(--fs-footnote);color:var(--text-3)}
@media (orientation:landscape) and (max-height:560px){
  .whr-sheet.is-setup{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}
  .whr-sheet__hero{gap:10px}
  .whr-sheet__icon{width:46px;height:46px;border-radius:14px}
  .whr-paste{min-height:56px}
  .whr-zrow{min-height:30px}
}
@keyframes whr-draw{to{stroke-dashoffset:0}}
@keyframes whr-fade{to{opacity:1}}
@keyframes whr-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes whr-pop{0%{transform:scale(.5);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes whr-beat{0%,100%{transform:scale(1)}15%{transform:scale(1.18)}30%{transform:scale(1)}45%{transform:scale(1.12)}}
@keyframes whr-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}50%{transform:translateX(5px)}75%{transform:translateX(-3px)}}
@media (prefers-reduced-motion:reduce){
  .whr-overlay .whr-line,.whr-overlay .whr-line-shadow{animation:none!important;stroke-dasharray:none;stroke-dashoffset:0}
  .whr-overlay .whr-area,.whr-overlay .whr-peak{animation:none!important;opacity:1}
  .whr-zrow,.whr-lv,.whr-track,.whr-done__check,.whr-beat,.whr-msg.is-shake{animation:none!important}
}
`;

/** Inyecta una vez los estilos del pulso (el CSS compartido es de otros módulos). */
export function ensureWatchHrStyles() {
  if (!hasDOM() || document.getElementById('br-watch-hr-css')) return;
  try {
    const style = document.createElement('style');
    style.id = 'br-watch-hr-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  } catch { /* sin estilos propios */ }
}
