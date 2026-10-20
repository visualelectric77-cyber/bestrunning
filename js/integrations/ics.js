// BestRunning · exportación del plan a Calendario (iCalendar RFC 5545).
// buildIcs es puro (sin DOM): se puede importar desde Node para tests.
// Todas las horas de los eventos se escriben en UTC ("Z"), calculadas desde la hora local del recordatorio.
import { addDays, todayKey, parseKey, pad2, fmt } from '../core/utils.js';
import { planDay } from '../training/planner.js';
import { groupSegments } from '../training/generator.js';
import { CATEGORIES } from '../training/templates.js';

const CRLF = '\r\n';
const PRODID = '-//RITMUP//Plan de entrenamiento 1.0//ES';

/* ───────────── Utilidades RFC 5545 ───────────── */

/** Escapa un valor TEXT (§3.3.11): \ ; , y saltos de línea. */
function escText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Octetos UTF-8 de un punto de código. */
function utf8Len(ch) {
  const c = ch.codePointAt(0);
  return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
}

/** Pliega una línea de contenido a ≤ 75 octetos (§3.1) sin partir caracteres multibyte. */
function fold(line) {
  let out = '';
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = utf8Len(ch);
    if (len + n > 75) {
      out += cur + CRLF + ' ';
      cur = '';
      len = 1; // el espacio de continuación cuenta
    }
    cur += ch;
    len += n;
  }
  return out + cur;
}

/** Date → 'YYYYMMDDTHHMMSSZ' (UTC). */
function utcStamp(d) {
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

/** 'HH:MM' → [h, m] (07:00 por defecto). */
function parseTime(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  if (!m) return [7, 0];
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const mi = Math.min(59, Math.max(0, Number(m[2])));
  return [h, mi];
}

/** Fecha local (clave + hora) → Date. Respeta el horario de verano local. */
function localDate(key, [h, m]) {
  const d = parseKey(key);
  d.setHours(h, m, 0, 0);
  return d;
}

/* ───────────── Texto de los eventos ───────────── */

function segLine(s) {
  const incl = s.incline ? ` · ${fmt.dec1(s.incline)} %` : '';
  return `${fmt.clock(s.sec)} ${s.label || s.zone} · ${fmt.speed(s.speed)} km/h${incl}`;
}

function structureLines(workout) {
  let groups = null;
  try {
    groups = groupSegments(workout.segments || []);
  } catch {
    groups = null;
  }
  if (!Array.isArray(groups) || !groups.length) return (workout.segments || []).map((s) => `• ${segLine(s)}`);
  return groups.map((g) => {
    if (g.kind === 'repeat' && g.times > 1) {
      const inner = (g.segments || [])
        .map((s) => `${fmt.clock(s.sec)} ${s.label || s.zone} ${fmt.speed(s.speed)}`)
        .join(' · ');
      return `• ${g.times} × (${inner})`;
    }
    const s = (g.segments || [])[0];
    return s ? `• ${segLine(s)}` : `• ${g.label || ''}`;
  });
}

function describe(workout, state) {
  const cat = CATEGORIES[workout.category]?.name || '';
  const km = workout.estDistanceKm ? ` · ~${fmt.dec1(workout.estDistanceKm)} km` : '';
  const lv = state.levels || {};
  const lines = [
    `${cat ? cat + ' · ' : ''}${Math.round((workout.totalSec || workout.minutes * 60) / 60)} min${km}`,
  ];
  if (workout.subtitle) lines.push(workout.subtitle);
  const struct = structureLines(workout);
  // Las clases muy troceadas se resumen para que el evento siga siendo legible.
  if (struct.length > 16) struct.splice(14, struct.length - 15, '• …');
  lines.push('', 'Estructura:', ...struct);
  if (lv.jog) {
    lines.push(
      '',
      `Tus velocidades: trote ${fmt.speed(lv.jog)} · correr ${fmt.speed(lv.run)} · rápido ${fmt.speed(lv.fast)} · sprint ${fmt.speed(lv.sprint)} km/h`
    );
  }
  if (state.integrations?.watchReminder !== false) lines.push('Inicia «Cinta de correr» en tu Apple Watch.');
  lines.push('Abre RITMUP y dale a Empezar. ¡A por ello!');
  return lines.join('\n');
}

function appUrl(workout, dateKey) {
  if (typeof location === 'undefined' || !/^https?:/.test(location.protocol || '')) return null;
  const base = String(location.href).split('#')[0];
  return `${base}#/workout/${encodeURIComponent(workout.id)}?date=${dateKey}&from=plan`;
}

/* ───────────── API ───────────── */

/**
 * VCALENDAR con los entrenamientos de las próximas `weeks` semanas desde `fromKey` (hoy por defecto).
 * Omite descansos y días ya hechos. Evento a `schedule.reminderTime` con la duración real y aviso −10 min.
 */
export function buildIcs(state, { weeks = 4, fromKey } = {}) {
  const from = fromKey || todayKey();
  const time = parseTime(state?.schedule?.reminderTime);
  const now = new Date();
  const stamp = utcStamp(now);
  // SEQUENCE creciente para que una nueva exportación actualice los eventos ya importados.
  const seq = Math.max(0, Math.floor((now.getTime() - Date.UTC(2025, 0, 1)) / 60000));

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:RITMUP',
    `X-WR-CALDESC:${escText('Tu plan de entrenamiento en cinta')}`,
  ];

  const days = Math.max(1, Math.round(weeks * 7));
  for (let i = 0; i < days; i++) {
    const key = addDays(from, i);
    let day = null;
    try {
      day = planDay(state, key);
    } catch {
      day = null;
    }
    const w = day?.workout;
    if (!day || !w || day.kind === 'rest' || day.status === 'rest' || day.status === 'done') continue;

    const start = localDate(key, time);
    const durSec = Math.max(60, Math.round(w.totalSec || (w.minutes || day.minutes || 20) * 60));
    const end = new Date(start.getTime() + durSec * 1000);
    const title = `RITMUP · ${w.title || 'Entrenamiento'}`;
    const url = appUrl(w, key);

    lines.push(
      'BEGIN:VEVENT',
      `UID:br-plan-${key.replace(/-/g, '')}@bestrunning`,
      `DTSTAMP:${stamp}`,
      `SEQUENCE:${seq}`,
      `DTSTART:${utcStamp(start)}`,
      `DTEND:${utcStamp(end)}`,
      `SUMMARY:${escText(title)}`,
      `DESCRIPTION:${escText(describe(w, state))}`,
      `CATEGORIES:${escText(CATEGORIES[w.category]?.name || 'Entrenamiento')}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE'
    );
    if (url) lines.push(`URL:${url}`);
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escText(`En 10 minutos: ${w.title || 'entrenamiento'} (${Math.round(durSec / 60)} min)`)}`,
      'TRIGGER:-PT10M',
      'END:VALARM',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join(CRLF) + CRLF;
}

/**
 * Comparte el plan como archivo .ics (hoja de compartir de iOS) o, si no se puede, lo descarga.
 * Llamar desde un gesto del usuario. Devuelve { ok, method: 'share'|'download'|null, events, cancelled? }.
 */
export async function exportPlanToCalendar(state) {
  const ics = buildIcs(state, { weeks: 4 });
  const events = (ics.match(/BEGIN:VEVENT/g) || []).length;
  const name = `RITMUP-plan-${todayKey()}.ics`;
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });

  let file = null;
  try {
    file = new File([blob], name, { type: 'text/calendar' });
  } catch {
    file = null;
  }

  if (file && typeof navigator !== 'undefined' && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Plan RITMUP' });
      return { ok: true, method: 'share', events };
    } catch (err) {
      if (err?.name === 'AbortError') return { ok: false, method: 'share', events, cancelled: true };
      // Si compartir falla por otro motivo, seguimos con la descarga.
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { ok: true, method: 'download', events };
  } catch {
    return { ok: false, method: null, events };
  }
}
