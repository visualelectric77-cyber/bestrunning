// BestRunning · utilidades compartidas (sin DOM: se puede importar desde Node).
// Fechas en hora LOCAL con claves 'YYYY-MM-DD', formato es-ES y aleatoriedad determinista.

export const DAY_MS = 86400000;

/* ───────────── Números ───────────── */

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
/** Redondea a 0,1 (velocidades). */
export const round1 = (v) => Math.round(v * 10) / 10;
/** Redondea a múltiplos de `step` segundos (por defecto 5 s). */
export const roundTo = (v, step = 5) => Math.round(v / step) * step;
export const sum = (arr, fn = (x) => x) => arr.reduce((a, x) => a + fn(x), 0);

/* ───────────── Fechas (claves locales) ───────────── */

export const pad2 = (n) => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DD' en hora local. */
export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'YYYY-MM-DD' → Date a medianoche local. */
export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return todayKey(d);
}

/** 1 = lunes … 7 = domingo. */
export function weekdayOf(key) {
  const w = parseKey(key).getDay();
  return w === 0 ? 7 : w;
}

/** Lunes de la semana de `key`. */
export const mondayOf = (key) => addDays(key, 1 - weekdayOf(key));

/** Días enteros de a → b (seguro frente a cambios de horario). */
export const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / DAY_MS);

/** Las 7 claves de la semana que empieza en `mondayKey`. */
export const weekDates = (mondayKey) => Array.from({ length: 7 }, (_, i) => addDays(mondayKey, i));

/** Semana ISO 'YYYY-Www'. */
export function isoWeekKey(key) {
  const d = parseKey(key);
  const day = (d.getDay() + 6) % 7; // lunes = 0
  d.setDate(d.getDate() - day + 3); // jueves de esa semana
  const firstThu = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - firstThu) / DAY_MS - 3 + ((firstThu.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${pad2(week)}`;
}

/* ───────────── Formato es-ES ───────────── */

const nf1 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: true });

const WD_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const WD_ABBR = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const WD_NAME = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MONTH_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const MONTH_NAME = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export const fmt = {
  /** 11.5 → '11,5' */
  speed: (v) => nf1.format(v ?? 0),
  /** 3.214 → '3,21' */
  km: (v) => nf2.format(v ?? 0),
  /** 1 decimal genérico */
  dec1: (v) => nf1.format(v ?? 0),
  /** 1234.4 → '1234' (es-ES no agrupa 4 cifras) */
  int: (v) => nf0.format(Math.round(v ?? 0)),
  /** 75 → '1:15' · 3725 → '1:02:05' */
  clock(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  },
  /** 1200 → '20 min' */
  minutes: (sec) => `${Math.round(sec / 60)} min`,
  /** 3900 → '1 h 05 min' · 10800 → '3 h' · 2700 → '45 min' · 40 → '40 s' (3590 → '1 h', nunca '60 min') */
  durationLong(sec) {
    sec = Math.round(sec);
    if (sec < 60) return `${sec} s`;
    const total = Math.round(sec / 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (!h) return `${m} min`;
    return m ? `${h} h ${pad2(m)} min` : `${h} h`;
  },
  /** km/h → ritmo 'm:ss' por km */
  pace(kmh) {
    if (!kmh || kmh <= 0) return '–:––';
    const s = Math.round(3600 / kmh);
    return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
  },
  weekdayShort: (n) => WD_SHORT[n - 1],
  weekdayAbbr: (n) => WD_ABBR[n - 1],
  weekdayName: (n) => WD_NAME[n - 1],
  monthAbbr: (m) => MONTH_ABBR[m],
  monthName: (m) => MONTH_NAME[m],
  /** 'YYYY-MM-DD' → 'vie 17 oct' */
  dateShort(key) {
    const d = parseKey(key);
    return `${WD_ABBR[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`;
  },
  /** 'YYYY-MM-DD' → 'viernes, 17 de octubre' */
  dateLong(key) {
    const d = parseKey(key);
    return `${WD_NAME[(d.getDay() + 6) % 7]}, ${d.getDate()} de ${MONTH_NAME[d.getMonth()]}`;
  },
  /** 'Hoy' · 'Ayer' · 'Mañana' · fecha corta */
  relativeDay(key, today = todayKey()) {
    const diff = daysBetween(today, key);
    if (diff === 0) return 'Hoy';
    if (diff === -1) return 'Ayer';
    if (diff === 1) return 'Mañana';
    return fmt.dateShort(key);
  },
};

/* ───────────── Aleatoriedad determinista ───────────── */

/** FNV-1a 32 bits. */
export function hashStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generador con utilidades. `seed` puede ser número o texto. */
export function makeRng(seed) {
  const next = mulberry32(typeof seed === 'number' ? seed : hashStr(String(seed)));
  const rng = {
    next,
    /** entero en [min, max] */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
  return rng;
}

/* ───────────── Varios ───────────── */

let uidCounter = 0;
export const uid = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}${(uidCounter++ % 1296).toString(36).padStart(2, '0')}`;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escapa texto para interpolarlo en HTML. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const deepClone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
