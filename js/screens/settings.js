// BestRunning · Pantalla «Perfil» (ajustes): lista agrupada iOS y subpáginas #/settings/<section>.
import { getState, setState, subscribe, resetState, exportState, importState } from '../core/store.js';
import { navigate } from '../core/router.js';
import { icon, listIcon, navBar, enableCollapsingHeader, toggle, stepper, segmented, openSheet, toast, confirmDialog, bgVideo } from '../ui/components.js';
import { haptic } from '../core/haptics.js';
import {
  ZONES, LEVEL_KEYS, MIN_LEVEL_GAP, hrZones, hrMaxFromAge, levelsFromVam, vamFromLevels, estimateVo2max, vo2Category, enforceLevelOrder,
} from '../training/levels.js';
import { CATEGORIES } from '../training/templates.js';
import { planWeek, cycleInfo, CYCLE_WEEKS } from '../training/planner.js';
import { APP_VERSION } from '../version.js';
import { wordmarkSvg } from '../ui/wordmark.js';
// Registro ligero de escenarios (solo metadatos; NO importar scene3d.js aquí: arrastra three.js)
import { listThemes, DEFAULT_THEME } from '../player/scene3d/themes/index.js';
import { AUTO_THEME, autoTheme } from '../player/scene-pick.js';
import { esc, fmt, todayKey, mondayOf, daysBetween, round1, clamp, debounce, capitalize } from '../core/utils.js';
import { isNative, nativeStatus, post as nativePost, healthMissingOf } from '../integrations/native-bridge.js';
import { diagText } from '../core/diag.js';
import { notifyAvailable, notifyConfig, setNotifyConfig } from '../integrations/ai.js';

/* ───────────── utilidades privadas ───────────── */

const safe = (fn, fallback = null) => {
  try {
    const v = fn();
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

/** Ejecuta algo que puede devolver una promesa sin dejar rechazos sueltos. */
const fire = (fn) => {
  try {
    const r = fn();
    if (r && typeof r.catch === 'function') r.catch(() => {});
    return r;
  } catch {
    return null;
  }
};

const isStandalone = () => safe(
  () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches || document.documentElement.classList.contains('is-standalone'),
  false,
);

const SECTIONS = {
  // «Sobre ti» (como el paso 2 del onboarding): «Perfil → Perfil» se leía repetido
  profile: { title: 'Sobre ti', icon: 'person', color: 'var(--c-tempo)' },
  speeds: { title: 'Velocidades', icon: 'bolt', color: 'var(--c-intervals)' },
  week: { title: 'Mi semana', icon: 'calendar', color: 'var(--c-test)' },
  treadmill: { title: 'Cinta', icon: 'treadmill', color: 'var(--c-endurance)' },
  display: { title: 'Pantalla de entreno', icon: 'mountain', color: 'var(--c-fartlek)' },
  audio: { title: 'Voz y audio', icon: 'speaker', color: 'var(--c-fartlek)' },
  music: { title: 'Música', icon: 'music', color: 'var(--c-fartlek)' },
  watch: { title: 'Apple Watch y Salud', icon: 'watch', color: 'var(--accent-2)' },
  install: { title: 'Instalar en iPhone', icon: 'download', color: 'var(--info)' },
  data: { title: 'Datos', icon: 'upload', color: 'var(--c-hills)' },
  about: { title: 'Acerca de', icon: 'info', color: 'var(--z-walk)' },
};

const GROUPS = [
  { title: 'Entrenamiento', items: ['profile', 'speeds', 'week', 'treadmill', 'display'] },
  { title: 'Coach y música', items: ['audio', 'music', 'watch'] },
  { title: 'App', items: ['install', 'data', 'about'] },
];
/** En la app nativa ya está instalada: fuera «Instalar en iPhone». */
const groupItems = (g) => (isNative() ? g.items.filter((k) => k !== 'install') : g.items);

const CYCLE_NAMES = ['Arranque', 'Progresión', 'Pico', 'Descarga'];
const REASONS = {
  init: { label: 'Inicio', color: 'var(--info)' },
  progression: { label: 'Progresión', color: 'var(--ok)' },
  test: { label: 'Test VAM', color: 'var(--c-test)' },
  manual: { label: 'Manual', color: 'var(--z-walk)' },
};
const CHAT_DESC = {
  minimal: 'Solo lo esencial: avisos de cambio, velocidades y final. Perfecto si vas con tu música a tope.',
  normal: 'Avisos de cambio, mitades, últimos segundos y algún consejo de técnica cada pocos minutos.',
  coach: 'Tu entrenador encima: consejos cada dos minutos, motivación extra en las series duras e hidratación.',
};
const LANGS = {
  'es-ES': 'Español (España)', 'es-MX': 'Español (México)', 'es-US': 'Español (EE. UU.)', 'es-AR': 'Español (Argentina)',
  'es-CO': 'Español (Colombia)', 'es-CL': 'Español (Chile)',
};

const DEFAULT_LEVELS = { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 };

/* Módulos de audio: carga perezosa (solo hacen falta en «Voz y audio» y para probar). */
let speechMod = null;
let audioMod = null;
let speechP = null;
let audioP = null;
let packsCache = null;
const loadSpeech = () => (speechP ||= import('../audio/speech.js').then((m) => (speechMod = m)).catch(() => null));
const loadAudio = () => (audioP ||= import('../audio/audio-engine.js').then((m) => (audioMod = m)).catch(() => null));

/* Fase 2: música, importación, voz grabada y pulso del Watch (todo opcional: si un módulo falta, la página sigue). */
const EVA_ID = 'lucia'; // la voz grabada de la app (antes Eva)
const EVA_NAME = 'Lucía';
/** Nombre visible de un pack: sin el proveedor («Eva Dorado · ElevenLabs» → «Eva»). */
const packName = (p) => (p?.id === EVA_ID ? EVA_NAME : String(p?.name || p?.id || 'Voz').replace(/\s*·\s*ElevenLabs\s*$/i, '').trim() || 'Voz');
const HR_SHORTCUT = 'BestRunning FC';
let musicLibMod = null;
let musicImportMod = null;
let watchMod = null;
let voicePackMod = null;
let musicLibP = null;
let musicImportP = null;
let watchP = null;
let voicePackP = null;
const loadMusicLib = () => (musicLibP ||= import('../audio/music-library.js').then((m) => (musicLibMod = m)).catch(() => null));
const loadMusicImport = () => (musicImportP ||= import('../audio/music-import.js').then((m) => (musicImportMod = m)).catch(() => null));
const loadWatch = () => (watchP ||= import('../integrations/watch-hr.js').then((m) => (watchMod = m)).catch(() => null));
const loadVoicePack = () => (voicePackP ||= import('../audio/voice-pack.js').then((m) => (voicePackMod = m)).catch(() => null));

/** Sesión de audio de iOS (usa audio-engine si ya la exporta; si no, directamente). */
function sessionType(type) {
  try {
    if (typeof audioMod?.setAudioSessionType === 'function') { audioMod.setAudioSessionType(type); return; }
    const s = globalThis.navigator?.audioSession;
    if (s && s.type !== type) s.type = type;
  } catch { /* sin API */ }
}

const packIndexCache = new Map();
const packStatus = {};

/** index.json de un pack → { ok, ids:Set, count, name } (ok = hay clips grabados). Nunca rechaza. */
function fetchPackIndex(id) {
  if (!packIndexCache.has(id)) {
    packIndexCache.set(id, fetch(`./audio/packs/${encodeURIComponent(id)}/index.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const ids = new Set(Array.isArray(j?.clips) ? j.clips.filter((x) => typeof x === 'string') : []);
        return { ok: ids.size > 0, ids, count: ids.size, name: String(j?.name || '') };
      })
      .catch(() => ({ ok: false, ids: new Set(), count: 0, name: '' }))
      .then((st) => { packStatus[id] = st; return st; }));
  }
  return packIndexCache.get(id);
}

async function fetchPacks() {
  if (packsCache) return packsCache;
  let list = [];
  try {
    const r = await fetch('./audio/packs/packs.json', { cache: 'no-cache' });
    const j = r.ok ? await r.json() : [];
    list = (Array.isArray(j) ? j : Array.isArray(j?.packs) ? j.packs : []).filter((p) => p && typeof p.id === 'string');
  } catch {
    list = [];
  }
  // Eva Dorado siempre aparece (es la voz por defecto), aunque sus grabaciones aún no estén en la app
  const eva = list.find((p) => p.id === EVA_ID);
  list = [{ ...(eva || {}), id: EVA_ID, name: EVA_NAME }, ...list.filter((p) => p.id !== EVA_ID)];
  await Promise.all(list.map((p) => fetchPackIndex(p.id)));
  packsCache = list;
  return packsCache;
}

/* ───────────── piezas de UI ───────────── */

const group = (title, rows, note = '') => `<div class="st-group">
  ${title ? `<div class="st-group__title">${esc(title)}</div>` : ''}
  <div class="list">${rows}</div>
  ${note ? `<p class="st-note">${note}</p>` : ''}
</div>`;

const label = (title, sub = '') => `<span class="st-row__label"><span class="list__title">${title}</span>${sub ? `<span class="list__sub">${sub}</span>` : ''}</span>`;

const slot = (id, html) => `<span class="st-slot" data-slot="${id}">${html}</span>`;

const stepRow = (title, sub, id, opts) => `<div class="list__row st-row">${label(title, sub)}<span class="spacer"></span>${slot(id, stepper({ id, ...opts }))}</div>`;

const toggleRow = (id, title, sub, checked) => `<div class="list__row st-row">${label(title, sub)}<span class="spacer"></span>${toggle({ id, checked: !!checked, attrs: `aria-label="${esc(title)}"` })}</div>`;

const segRow = (title, sub, name, options, value) => `<div class="list__row st-row st-row--stack">${label(title, sub)}<div class="st-seg">${segmented({ name, options, value: String(value) })}</div></div>`;

/** v2: icono de fila gris, sin cuadrado de color (el color solo marca lo destructivo). */
const sqIcon = (name, color) => listIcon(name, { tone: color === 'var(--danger)' ? 'danger' : '' });

const steps = (items) => `<ol class="st-steps">${items.map((t, i) => `<li><span class="st-steps__n num">${i + 1}</span><span class="st-steps__t">${t}</span></li>`).join('')}</ol>`;

function memberSince(s) {
  const iso = s.createdAt || s.history?.[0]?.startedAt;
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return `Miembro desde ${fmt.monthName(d.getMonth())} de ${d.getFullYear()}`;
}

function voiceQuality(v) {
  const t = `${v?.name || ''} ${v?.voiceURI || ''}`.toLowerCase();
  if (v?.premium || t.includes('premium')) return 'premium';
  if (v?.enhanced || t.includes('enhanced') || t.includes('mejorad')) return 'enhanced';
  return null;
}

// «Eddy (español (España))» → «Eddy»; «Mónica (mejorada)» → «Mónica» (el idioma y la calidad ya van aparte)
const cleanVoiceName = (n) => String(n || 'Voz')
  .replace(/\s*\((?:español|spanish|espagnol)[^()]*(?:\([^)]*\))?[^()]*\)/gi, ' ')
  .replace(/\s*\((mejorada|mejorado|enhanced|premium|calidad mejorada)\)\s*/gi, ' ')
  .replace(/\s{2,}/g, ' ')
  .trim() || 'Voz';

/** Voces de broma de iOS (Eloquence: Eddy, Flo, Abuela…): se ofrecen aparte, plegadas en «Más voces». */
const NOVELTY_VOICE_RE = /eloquence|speech\.synthesis\.voice|\b(eddy|flo|grandma|grandpa|abuel[oa]|reed|rocko|sandy|shelley)\b/i;
const isNoveltyVoice = (v) => v?.quality === 'novelty' || NOVELTY_VOICE_RE.test(`${v?.voiceURI || ''} ${v?.name || ''}`);

const langLabel = (l) => LANGS[String(l || '').replace('_', '-')] || `Español (${esc(l || '?')})`;

const isEsES = (v) => /^es[-_]ES$/i.test(String(v?.lang || ''));

function voiceLabel(uri) {
  if (!uri) return 'Voz automática';
  const v = speechMod ? safe(() => speechMod.spanishVoices(), []).find((x) => x.voiceURI === uri) : null;
  if (v) return cleanVoiceName(v.name);
  const last = String(uri).split(/[.:/]/).filter(Boolean).pop() || 'Personalizada';
  return capitalize(last.replace(/[-_]compact|[-_]premium|[-_]enhanced/gi, ''));
}

function qualityBadge(q) {
  if (q === 'premium') return '<span class="st-badge st-badge--premium">Premium</span>';
  if (q === 'enhanced') return '<span class="st-badge st-badge--enhanced">Mejorada</span>';
  return '';
}

/* ───────────── niveles: registro manual (una entrada por día como mucho) ───────────── */

function logManualLevels(d) {
  const today = todayKey();
  const levels = Object.fromEntries(LEVEL_KEYS.map((k) => [k, d.levels[k]]));
  if (!Array.isArray(d.levelHistory)) d.levelHistory = [];
  const hist = d.levelHistory;
  const i = hist.findIndex((e) => e && e.date === today && e.reason === 'manual');
  if (i >= 0 && i === hist.length - 1) hist[i] = { ...hist[i], levels };
  else {
    if (i >= 0) hist.splice(i, 1);
    hist.push({ date: today, levels, reason: 'manual', note: '' });
  }
  // Si el cambio deja todo como estaba, la entrada sobra.
  const last = hist[hist.length - 1];
  const prev = hist[hist.length - 2];
  if (prev?.levels && LEVEL_KEYS.every((k) => prev.levels[k] === last.levels[k])) hist.pop();
}

/* ───────────── RAÍZ ───────────── */

function rowSummary(key, s) {
  const p = s.profile || {};
  const lv = s.levels || DEFAULT_LEVELS;
  const sc = s.schedule || {};
  const tm = s.treadmill || {};
  const a = s.audio || {};
  const hist = s.history || [];
  switch (key) {
    case 'profile': return p.name ? esc(p.name) : 'Añade tu nombre';
    case 'speeds': return LEVEL_KEYS.map((k) => fmt.speed(lv[k])).join(' · ');
    case 'week': return `L–V ${sc.weekdayMinutes ?? 20}′ · J ${sc.thursdayMinutes ?? 50}′ · ${sc.weekendDay === 7 ? 'D' : 'S'} ${sc.weekendMinutes ?? 50}′`;
    case 'treadmill': return `${tm.hasIncline ? 'Inclinación · ' : ''}${fmt.speed(tm.maxSpeed ?? 18)} km/h`;
    case 'display': {
      const v = visualsOf(s);
      if (v.quality === 'off') return 'Fondo clásico';
      const q = v.quality !== 'auto' ? ` · ${QUALITY_OPTS.find((o) => o.value === v.quality)?.label || ''}` : '';
      return esc(`${sceneOf(v.theme).name}${q}${v.tvMode ? ' · TV' : ''}`);
    }
    case 'audio': return a.voiceEnabled === false ? 'Coach en silencio' : a.packId === EVA_ID ? EVA_NAME : esc(voiceLabel(a.voiceURI));
    case 'music': {
      const m = s.music || {};
      if (m.mode === 'own') return 'Mi música';
      return m.enabled === false ? 'Apagada' : 'DJ RITMUP';
    }
    case 'watch':
      if (isNative()) return 'App del reloj';
      return s.integrations?.watchReminder === false ? 'Sin recordatorio' : 'Pulso con Atajos';
    case 'install': return isStandalone() ? 'Instalada' : 'Sin instalar';
    case 'data': return `${hist.length} ${hist.length === 1 ? 'sesión' : 'sesiones'}`;
    case 'about': return `v${esc(APP_VERSION)}`;
    default: return '';
  }
}

function rootHtml(s) {
  const p = s.profile || {};
  const name = String(p.name || '').trim();
  const hist = Array.isArray(s.history) ? s.history : [];
  const km = hist.reduce((a, h) => a + (h.distanceKm || 0), 0);
  const vam = safe(() => vamFromLevels(s.levels || DEFAULT_LEVELS), 0);
  const meta = [p.age ? `${p.age} años` : '', p.weightKg ? `${fmt.dec1(p.weightKg).replace(',0', '')} kg` : ''].filter(Boolean).join(' · ');
  const since = memberSince(s);
  const groups = GROUPS.map((g) => group(g.title, groupItems(g).map((k) => {
    const sec = SECTIONS[k];
    return `<div class="list__row st-nav" role="button" tabindex="0" data-href="#/settings/${k}">
      ${listIcon(sec.icon)}
      <span class="list__title">${esc(sec.title)}</span>
      <span class="list__value">${rowSummary(k, s)}</span>
      <span class="list__chev">${icon('chevron-right', 14)}</span>
    </div>`;
  }).join(''))).join('');
  return `<section class="st-hero">
      <button type="button" class="st-avatar" data-href="#/settings/profile" aria-label="Editar perfil">
        <span class="st-avatar__face">${name ? esc(name[0].toUpperCase()) : icon('person', 40)}</span>
      </button>
      <h2 class="st-hero__name">${name ? esc(name) : 'Corredor/a'}</h2>
      <div class="st-hero__meta">${esc(meta)}${since ? `<br>${esc(since)}` : ''}</div>
      <div class="card st-hero__stats">
        <div><b class="num">${hist.length}</b><span>${hist.length === 1 ? 'Sesión' : 'Sesiones'}</span></div>
        <div><b class="num">${fmt.dec1(km)}</b><span>Kilómetros</span></div>
        <div><b class="num">${fmt.speed(vam)}</b><span>VAM km/h</span></div>
      </div>
    </section>
    ${groups}
    <p class="st-foot">RITMUP ${esc(APP_VERSION)}</p>`;
}

/* ───────────── PERFIL ───────────── */

function hrZonesHtml(s) {
  const p = s.profile || {};
  const hrMax = p.hrMax || hrMaxFromAge(p.age || 46);
  const zones = safe(() => hrZones(hrMax, p.hrRest || null), []);
  if (!zones.length) return '';
  const lo = zones[0].min;
  const span = Math.max(1, hrMax - lo);
  const map = { 1: 'Calentar · Calma', 2: 'Trotar', 3: 'Correr', 4: 'Rápido', 5: 'Sprint' };
  const track = zones.map((z) => `<i style="flex:${Math.max(1, z.max - z.min)};--zc:${z.color}"></i>`).join('');
  const rows = zones.map((z) => `<div class="list__row st-hrz">
      <span class="st-hrz__badge num" style="--zc:${z.color}">Z${z.zone}</span>
      <span class="st-hrz__main"><span class="list__title">${esc(String(z.name).replace(/^Z\d\s*·\s*/, ''))}</span><span class="st-hrz__sub">${map[z.zone] || ''}</span></span>
      <span class="st-hrz__range"><b class="num">${z.min}–${z.max}</b><span class="unit">ppm</span></span>
    </div>`).join('');
  return `<div class="st-hrz__track" aria-hidden="true" data-lo="${lo}" data-span="${span}">${track}</div>${rows}`;
}

function hrZonesFoot(s) {
  const p = s.profile || {};
  const hrMax = p.hrMax || hrMaxFromAge(p.age || 46);
  return `${p.hrRest ? `Método Karvonen con FC en reposo de ${p.hrRest}\u00a0ppm` : 'Porcentaje de tu FC máxima'} · FC máx. ${hrMax}\u00a0ppm`;
}

function profileHtml(s) {
  const p = s.profile || {};
  const auto = hrMaxFromAge(p.age || 46);
  return `${group('Tus datos', `
      <label class="list__row st-row">${label('Nombre')}<input id="st-name" class="st-input" type="text" value="${esc(p.name || '')}" placeholder="Tu nombre" maxlength="30" autocomplete="given-name" autocapitalize="words" enterkeyhint="done"></label>
      ${stepRow('Edad', '', 'st-age', { value: p.age || 46, step: 1, min: 14, max: 90, unit: 'años', decimals: 0 })}
      ${stepRow('Peso', '', 'st-weight', { value: p.weightKg || 78, step: 0.5, min: 35, max: 180, unit: 'kg', decimals: 1 })}
      ${segRow('Sexo', '', 'st-sex', [{ value: 'm', label: 'Hombre' }, { value: 'f', label: 'Mujer' }], p.sex === 'f' ? 'f' : 'm')}
    `, 'Los usamos para calcular calorías, zonas de pulso y tu categoría de VO₂máx.')}
    ${group('Frecuencia cardiaca', `
      ${stepRow('FC máxima', 'Pulsaciones por minuto', 'st-hrmax', { value: p.hrMax || auto, step: 1, min: 120, max: 220, unit: 'ppm', decimals: 0 })}
      <div class="list__row st-row st-action st-link" role="button" tabindex="0" data-st="hr-auto">
        <span class="list__title">Calcular por edad</span><span class="list__value" data-hr-auto>${auto} ppm</span>
      </div>
      <label class="list__row st-row">${label('FC en reposo', 'Opcional · nada más despertar')}<input id="st-hrrest" class="st-input st-input--num" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="—" value="${p.hrRest || ''}"><span class="st-unit">ppm</span></label>
    `, 'La FC máxima se estima con la fórmula de Tanaka (208 − 0,7 × edad). Si la conoces por una prueba de esfuerzo, ponla tal cual. Con la FC en reposo usamos el método Karvonen, más personal.')}
    <div class="st-group">
      <div class="st-group__title">Tus zonas de pulso</div>
      <div class="list st-hrzones" data-hrzones>${hrZonesHtml(s)}</div>
      <p class="st-note" data-hrzones-foot>${hrZonesFoot(s)}</p>
    </div>`;
}

/* ───────────── VELOCIDADES ───────────── */

function vamCardHtml(s) {
  const vam = safe(() => vamFromLevels(s.levels || DEFAULT_LEVELS), 0);
  const vo2 = safe(() => estimateVo2max(vam), 0);
  const cat = safe(() => vo2Category(vo2, s.profile?.age || 46, s.profile?.sex || 'm'), null);
  const last = s.progression?.lastTest;
  return `<div class="eyebrow">VAM estimada</div>
    <div class="st-vam__big"><span class="num">${fmt.speed(vam)}</span><span class="unit">km/h</span></div>
    <div class="st-vam__sub">VO₂máx ≈ <b class="num">${fmt.dec1(vo2)}</b>${cat ? ` · ${esc(cat.label)}` : ''}${last?.vam ? ` · último test ${fmt.speed(last.vam)}` : ''}</div>
    <button type="button" class="btn btn--secondary btn--block st-vam__btn" data-st="vam"><span>Recalcular desde tu VAM</span></button>`;
}

function levelHistoryHtml(s) {
  const hist = (Array.isArray(s.levelHistory) ? s.levelHistory : []).filter((e) => e && e.levels);
  if (!hist.length) return `<div class="list__row st-row"><span class="list__sub">Aún no hay cambios registrados. Cada subida quedará aquí.</span></div>`;
  const rows = [];
  for (let i = hist.length - 1; i >= 0 && rows.length < 25; i--) {
    const e = hist[i];
    const prev = hist[i - 1]?.levels || null;
    const lowered = !!prev && LEVEL_KEYS.some((k) => typeof prev[k] === 'number' && typeof e.levels[k] === 'number' && e.levels[k] < prev[k] - 0.04);
    const r = e.reason === 'progression' && lowered ? { label: 'Ajuste' } : (REASONS[e.reason] || REASONS.manual);
    const vals = LEVEL_KEYS.map((k) => {
      const v = e.levels[k];
      const d = prev && typeof prev[k] === 'number' && typeof v === 'number' ? round1(v - prev[k]) : 0;
      const delta = d ? `<i class="${d > 0 ? 'is-up' : 'is-down'}">${d > 0 ? '+' : '−'}${fmt.dec1(Math.abs(d))}</i>` : '';
      return `<span><i class="zdot" style="--zc:var(--z-${k})" aria-hidden="true"></i><b class="num">${typeof v === 'number' ? fmt.speed(v) : '–'}</b>${delta}</span>`;
    }).join('');
    rows.push(`<div class="list__row st-lvh">
      <div class="st-lvh__head"><span class="st-lvh__date">${esc(e.date ? fmt.dateShort(e.date) : '')}</span><span class="st-tag">${r.label}</span>${e.note ? `<span class="st-lvh__note">${esc(e.note)}</span>` : ''}</div>
      <div class="st-lvh__vals">${vals}</div>
    </div>`);
  }
  return rows.join('');
}

function levelStepper(k, v, tm) {
  return stepper({ id: `st-lv-${k}`, value: v, step: 0.1, min: tm.minSpeed ?? 1, max: tm.maxSpeed ?? 18, unit: 'km/h', decimals: 1 });
}

function speedsHtml(s) {
  const lv = s.levels || DEFAULT_LEVELS;
  const tm = s.treadmill || {};
  const rows = LEVEL_KEYS.map((k) => `<div class="list__row st-row st-level">
      <span class="zdot" style="--zc:var(--z-${k})" aria-hidden="true"></span>
      <span class="st-row__label"><span class="list__title">${esc(ZONES[k]?.name || k)}</span><span class="list__sub" data-pace="${k}">Ritmo ${fmt.pace(lv[k])} /km</span></span>
      <span class="spacer"></span>
      ${slot(`st-lv-${k}`, levelStepper(k, lv[k], tm))}
    </div>`).join('');
  return `<section class="card st-vam" data-vam>${vamCardHtml(s)}</section>
    ${group('Tus 4 velocidades', rows, `Cada nivel va al menos ${fmt.dec1(MIN_LEVEL_GAP)} km/h por encima del anterior. Tras cada sesión el coach las ajusta según cómo te hayas sentido; aquí puedes corregirlas a mano.`)}
    <div class="st-group">
      <div class="st-group__title">Historial de cambios</div>
      <div class="list st-lvhist" data-lvhist>${levelHistoryHtml(s)}</div>
    </div>`;
}

function openVamSheet(ctx) {
  const s = getState();
  const tm = s.treadmill || {};
  const start = safe(() => vamFromLevels(s.levels || DEFAULT_LEVELS), 13);
  let vam = start;
  const fit = (v) => {
    const l = levelsFromVam(v);
    for (const k of LEVEL_KEYS) l[k] = round1(clamp(l[k], tm.minSpeed ?? 1, tm.maxSpeed ?? 18));
    return l;
  };
  const preview = (v) => {
    const l = fit(v);
    return LEVEL_KEYS.map((k) => {
      const d = round1(l[k] - (s.levels?.[k] ?? l[k]));
      const delta = d ? `<i class="${d > 0 ? 'is-up' : 'is-down'}">${d > 0 ? '+' : '−'}${fmt.speed(Math.abs(d))}</i>` : '<i>=</i>';
      return `<div class="st-vprev"><span><i class="zdot" style="--zc:var(--z-${k})" aria-hidden="true"></i>${esc(ZONES[k]?.short || k)}</span><b class="num">${fmt.speed(l[k])}</b>${delta}</div>`;
    }).join('');
  };
  let sheetEl = null;
  openSheet({
    title: 'Recalcular desde tu VAM',
    html: `<div class="st-vsheet stack">
      <p class="st-vsheet__text">La VAM es la velocidad máxima que aguantas unos 4–6 minutos. La mide el <b>Test VAM</b> de la semana de descarga, pero si la conoces por otra prueba, introdúcela aquí.</p>
      <div class="st-vsheet__stepper">${stepper({ id: 'st-vam-input', value: start, step: 0.1, min: 8, max: 24, unit: 'km/h', decimals: 1 })}</div>
      <div class="st-vsheet__grid" data-vprev>${preview(start)}</div>
      <p class="st-note">Trotar 64 % · Correr 78 % · Rápido 88,5 % · Sprint 100 % de la VAM.</p>
    </div>`,
    onMount(el) {
      sheetEl = el;
      el.addEventListener('change', (e) => {
        const d = e.detail;
        if (!d || typeof d !== 'object' || d.id !== 'st-vam-input') return;
        vam = Number(d.value) || vam;
        const host = el.querySelector('[data-vprev]');
        if (host) host.innerHTML = preview(vam);
      });
    },
    actions: [
      {
        label: 'Aplicar velocidades',
        kind: 'primary',
        onClick(close) {
          const next = fit(vam);
          ctx.save((d) => {
            d.levels = { ...d.levels, ...next };
            logManualLevels(d);
          });
          haptic('success');
          toast(`Velocidades recalculadas con VAM ${fmt.speed(vam)}`, { icon: 'bolt', kind: 'success' });
          close();
          ctx.render();
        },
      },
      { label: 'Cancelar', kind: 'secondary', onClick: (close) => close() },
    ],
  });
  return sheetEl;
}

/* ───────────── MI SEMANA ───────────── */

const minuteOptions = (base, cur) => [...new Set([...base, Number(cur)].filter((v) => Number.isFinite(v) && v > 0))]
  .sort((a, b) => a - b)
  .map((v) => ({ value: String(v), label: `${v} min` }));

function weekPreviewHtml(s) {
  const sc = s.schedule || {};
  const cats = ['intervals', 'tempo', 'recovery', 'endurance', 'fartlek'];
  // Colores reales del plan de esta semana (los mismos que la vista previa del onboarding y «Mi plan»);
  // la lista fija solo queda de reserva si el planificador fallara
  const real = safe(() => planWeek({ ...s, plan: { ...(s.plan || {}), overrides: {} }, history: [] }, mondayOf(todayKey())), null);
  const realCat = (w) => (Array.isArray(real) && real.length === 7 && real[w - 1]?.kind !== 'rest' ? real[w - 1]?.workout?.category : null) || null;
  let total = 0;
  const days = [1, 2, 3, 4, 5, 6, 7].map((w) => {
    let min = 0;
    let cat = null;
    if (w <= 5) {
      min = w === 4 ? sc.thursdayMinutes ?? 50 : sc.weekdayMinutes ?? 20;
      cat = realCat(w) || cats[w - 1];
    } else if (w === (sc.weekendDay === 7 ? 7 : 6)) {
      min = sc.weekendMinutes ?? 50;
      cat = realCat(w) || 'challenge';
    }
    total += min;
    return `<div class="st-wk__day${min ? '' : ' is-rest'}" style="--h:${clamp(min / 60, 0.08, 1)}" title="${cat ? esc(CATEGORIES?.[cat]?.name || '') : 'Descanso'}">
      <span class="st-wk__bar"></span><b class="num">${min || '·'}</b><span>${fmt.weekdayShort(w)}</span>
    </div>`;
  }).join('');
  return `<div class="st-wk__head"><div class="eyebrow">Tu semana tipo</div><span class="st-wk__total num">${esc(fmt.durationLong(total * 60))}</span></div>
    <div class="st-wk">${days}</div>`;
}

function cycleHtml(s) {
  const today = todayKey();
  const start = s.plan?.startDate || mondayOf(today);
  // Mismas palabras y la misma barra que Mi plan y Hoy (Bloque n de 13 · Arranque/Progresión/Pico/Descarga)
  const ci = safe(() => cycleInfo(s, today), null);
  const weeks = Math.max(0, Math.floor(daysBetween(start, mondayOf(today)) / 7));
  const w = ci?.weekInCycle || (weeks % 4) + 1;
  const names = Array.isArray(CYCLE_WEEKS) && CYCLE_WEEKS.length === 4 ? CYCLE_WEEKS : CYCLE_NAMES;
  const blk = ci?.mesoNumber ? `Bloque ${ci.mesoNumber} de 13` : `Bloque ${Math.floor(weeks / 4) + 1}`;
  const segs = names.map((name, i) => {
    const n = i + 1;
    const cls = [n < w ? 'is-past' : '', n === w ? 'is-current' : ''].join(' ');
    return `<div class="pn-cycle__seg ${cls}"><span class="pn-cycle__track"><span class="pn-cycle__fill"></span></span><span class="pn-cycle__name">${esc(name)}</span></div>`;
  }).join('');
  return `<div class="st-cycle__top">
      <div><div class="eyebrow">${esc(blk)}</div><b class="st-cycle__title">Semana ${w} de 4 · ${esc(ci?.weekName || names[w - 1] || '')}</b></div>
    </div>
    <div class="pn-cycle__bar" role="img" aria-label="${esc(`${blk}, semana ${w} de 4`)}">${segs}</div>
    <p class="st-note">Empezó el ${esc(fmt.dateLong(start))}. Cada bloque sube la carga tres semanas y la cuarta descarga para que asimiles.</p>
    <button type="button" class="btn btn--secondary btn--block" data-st="reset-cycle"><span>Reiniciar ciclo</span></button>`;
}

/** Avisos de la mañana (los programa el iPhone: js/integrations/ai.js → notify.config). */
function notifyHtml() {
  const c = notifyConfig();
  const time = (id, title, sub, v) => `<label class="list__row st-row">${label(title, sub)}<input id="${id}" class="st-input st-time" type="time" value="${esc(v)}"></label>`;
  return group('Avisos', `
      ${toggleRow('st-ntf-on', 'Cómo estás para entrenar', 'Cada mañana: tu semáforo de fatiga y la clase del día', c.enabled)}
      ${time('st-ntf-wd', 'De lunes a viernes', '', c.weekdayTime)}
      ${time('st-ntf-we', 'Fin de semana', '', c.weekendTime)}
      ${toggleRow('st-ntf-pre', 'Antes de correr', '«En 5 min corres» con tu clase', c.preRun)}
      ${time('st-ntf-pre-t', 'Lunes a miércoles y viernes', 'Al salir de pesas', c.preRunTime)}
      ${time('st-ntf-thu', 'Jueves', 'Tu sesión larga', c.thursdayPreRunTime)}
    `, 'Tu iPhone mira de madrugada lo que midió el reloj mientras dormías (pulso en reposo, VFC, temperatura y respiración). Todo se calcula en el iPhone.');
}

function weekHtml(s) {
  const sc = s.schedule || {};
  return `${group('Duración de tus sesiones', `
      ${segRow('Lunes, martes, miércoles y viernes', 'Sesiones cortas y variadas', 'st-wd-min', minuteOptions([15, 20, 25, 30], sc.weekdayMinutes ?? 20), sc.weekdayMinutes ?? 20)}
      ${segRow('Jueves', 'Tu sesión larga entre semana', 'st-thu-min', minuteOptions([45, 50, 55, 60], sc.thursdayMinutes ?? 50), sc.thursdayMinutes ?? 50)}
      ${segRow('Día largo del finde', 'El otro día es descanso', 'st-we-day', [{ value: '6', label: 'Sábado' }, { value: '7', label: 'Domingo' }], sc.weekendDay === 7 ? 7 : 6)}
      ${segRow('Duración del finde', '', 'st-we-min', minuteOptions([45, 50, 55, 60], sc.weekendMinutes ?? 50), sc.weekendMinutes ?? 50)}
    `)}
    <section class="card st-wkcard" data-weekprev>${weekPreviewHtml(s)}</section>
    ${notifyAvailable() ? notifyHtml() : ''}
    ${group('Recordatorio', `
      <label class="list__row st-row">${label('Hora de entrenar', 'Para los eventos del Calendario')}<input id="st-reminder" class="st-input st-time" type="time" value="${esc(sc.reminderTime || '07:00')}"></label>
    `, 'Se usa al añadir tu plan al Calendario desde «Mi plan», con aviso 10 minutos antes.')}
    <div class="st-group">
      <div class="st-group__title">Ciclo de entrenamiento</div>
      <section class="card st-cycle" data-cycle>${cycleHtml(s)}</section>
    </div>`;
}

/* ───────────── CINTA ───────────── */

function treadmillHtml(s) {
  const tm = s.treadmill || {};
  return `${group('Inclinación', `
      ${toggleRow('st-incline', 'Mi cinta tiene inclinación', 'Activa las clases de cuestas', tm.hasIncline)}
      <div class="list__row st-row" data-incline-row${tm.hasIncline ? '' : ' hidden'}>${label('Inclinación máxima')}<span class="spacer"></span>${slot('st-maxinc', stepper({ id: 'st-maxinc', value: tm.maxIncline ?? 12, step: 1, min: 2, max: 20, unit: '%', decimals: 0 }))}</div>
    `, 'Con inclinación, el plan añade clases de cuestas algunas semanas y cambios de pendiente en ciertas clases.')}
    ${group('Velocidad', `
      ${stepRow('Velocidad mínima', '', 'st-minspeed', { value: tm.minSpeed ?? 1, step: 0.5, min: 0.5, max: 8, unit: 'km/h', decimals: 1 })}
      ${stepRow('Velocidad máxima', '', 'st-maxspeed', { value: tm.maxSpeed ?? 18, step: 0.5, min: 10, max: 25, unit: 'km/h', decimals: 1 })}
    `, 'Las clases nunca te pedirán velocidades fuera de este rango.')}
    ${group('Avisos del coach', `
      ${segRow('Antelación de los cambios', 'Cuánto antes te avisa de cada cambio', 'st-lead', [5, 10, 15].map((v) => ({ value: String(v), label: `${v} s` })), tm.announceLead ?? 10)}
    `, 'Tu cinta tarda unos 5–10\u00a0s en cambiar de velocidad. Con 10\u00a0s de aviso empiezas a pulsar a tiempo y llegas justo al «¡Ahora!».')}`;
}

/* ───────────── PANTALLA DE ENTRENO (escenarios 3D §15 + HUD de retransmisión §16) ───────────── */

const VISUAL_DEFAULTS = { quality: 'auto', theme: AUTO_THEME, tvMode: false, strideBob: true, ghost: true };
const QUALITY_OPTS = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'Alta' },
  { value: 'eco', label: 'Ahorro' },
  { value: 'off', label: 'Sin 3D' },
];
const QUALITY_DESC = {
  auto: 'Se adapta sola para ir siempre fluida sin calentar el iPhone. La recomendada.',
  high: 'Máximo detalle a resolución completa. Gasta algo más de batería.',
  eco: '30 fps y efectos mínimos: perfecta con poca batería o en Modo de bajo consumo.',
  off: 'Desactivadas: el fondo oscuro clásico con el color de cada zona. Lo más ligero.',
};
/** Orden de Ajustes → Escenario: el recomendado primero y Grafito (el más ligero) al final. */
const SCENE_ORDER = ['aurora', 'cordillera', 'estadio', 'blank'];
const SCENES = (() => {
  const list = safe(() => listThemes(), []) || [];
  const rank = (id) => { const i = SCENE_ORDER.indexOf(id); return i < 0 ? SCENE_ORDER.length : i; };
  return list.filter((t) => t && t.id && !t.hidden).sort((a, b) => rank(a.id) - rank(b.id));
})();
/** «Automático»: cada clase en su mundo (js/player/scene-pick.js). Primera opción y la predeterminada. */
const AUTO_SCENE = {
  id: AUTO_THEME,
  name: 'Automático',
  description: 'Cada clase en su mundo: cuestas en la Cordillera, series y ritmos en el Estadio, rodajes largos en la Aurora y recuperación en Grafito.',
};
const sceneOf = (id) => (id === AUTO_THEME ? AUTO_SCENE : SCENES.find((t) => t.id === id) || SCENES.find((t) => t.id === DEFAULT_THEME) || SCENES[0] || { id: DEFAULT_THEME, name: 'Aurora', description: '' });
const visualsOf = (s) => {
  const v = { ...VISUAL_DEFAULTS, ...(s?.visuals || {}) };
  // Solo escenarios ofrecidos (nunca el 'legacy' oculto ni valores corruptos)
  if (v.theme !== AUTO_THEME && !SCENES.some((t) => t.id === v.theme)) v.theme = AUTO_THEME;
  return v;
};
// La demo es una Pirámide (series): con Automático se ve el mundo que le toca
const DEMO_CLASS = { category: 'intervals', templateId: 'pyramid' };
const demoWorld = (id) => (id === AUTO_THEME ? autoTheme(DEMO_CLASS).id : sceneOf(id).id);
const demoBadge = (id) => (id === AUTO_THEME ? `AUTOMÁTICO · ${sceneOf(demoWorld(id)).name.toUpperCase()}` : sceneOf(id).name.toUpperCase());
const sceneThumb = (id) => `./assets/scenes/${encodeURIComponent(id)}.jpg`;
const SCENE_NOTE_ON = 'Es el escenario de cada clase; en Preparación puedes cambiarlo solo para esa sesión. Todos se mueven a la velocidad real de tu cinta y dejan los datos siempre por delante.';
const SCENE_NOTE_OFF = 'Activa las animaciones 3D para usar un escenario. Ahora verás el fondo clásico.';

/* Estilos propios de esta página que aún no están en screens-more.css (se inyectan una vez, sin coste). */
const SETTINGS_CSS = `
.st-scenes.is-off{opacity:.45;pointer-events:none}
.st-scene{gap:14px;padding-block:10px;cursor:pointer;-webkit-tap-highlight-color:transparent}
.st-scene:active{background:var(--surface-2)}
.st-scene__thumb{width:56px;height:100px;flex:none;object-fit:cover;object-position:50% 45%;border-radius:10px;background:#05060a;outline:2px solid transparent;outline-offset:2px;transition:outline-color var(--dur-fast,.15s)}
.st-scene__thumb--auto{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:1px;overflow:hidden}
.st-scene__thumb--auto img{width:100%;height:100%;object-fit:cover;object-position:50% 60%;display:block}
.st-scene.is-on .st-scene__thumb{outline:2px solid var(--text);outline-offset:2px}
.st-scene .st-row__label{min-width:0;flex:1}
.st-scene .list__title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.st-scene .list__sub{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.st-scene.is-on .list__title{color:var(--text);font-weight:600}
.st-scene .st-voice__check{margin-left:auto}
@media (orientation:landscape) and (max-height:520px){.st-scene{padding-block:8px}.st-scene__thumb{width:44px;height:72px;border-radius:8px}}
.st-scene.is-on .st-voice__check{color:var(--accent);background:none;box-shadow:none}
.pl-demo__stage[data-scene-bg]{background-size:cover;background-position:50% 50%}
.st-lvh__date{flex:none;white-space:nowrap}
.st-lvh__note{min-width:0}
.mu-apponly.is-off [data-mu-dep]{opacity:.45;pointer-events:none}
.mu-tap .mu-tap__big{font-size:24px;letter-spacing:.06em;white-space:nowrap}
.st-more{border-top:0}
.st-more>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;min-height:44px;padding:10px var(--s-4,16px);color:var(--accent);font-weight:400;font-size:var(--fs-sub,15px);-webkit-tap-highlight-color:transparent}
.st-more>summary::-webkit-details-marker{display:none}
.st-more>summary .st-more__chev{display:inline-flex;transition:transform var(--dur-fast,.15s)}
.st-more[open]>summary .st-more__chev{transform:rotate(90deg)}
`;
function ensureSettingsCss() {
  safe(() => {
    if (typeof document === 'undefined' || document.getElementById('st-extra-css')) return;
    const el = document.createElement('style');
    el.id = 'st-extra-css';
    el.textContent = SETTINGS_CSS;
    document.head.appendChild(el);
  });
}
const webglOk = () => safe(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (!gl) return false;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return true;
}, false);

function qualityNote(q) {
  return esc(QUALITY_DESC[q] || QUALITY_DESC.auto);
}

function sceneRow(t, on) {
  const auto = t.id === AUTO_THEME;
  // Automático: mosaico de los cuatro mundos en la misma miniatura vertical
  const thumb = auto
    ? `<span class="st-scene__thumb st-scene__thumb--auto" aria-hidden="true">${SCENES.slice(0, 4).map((x) => `<img src="${sceneThumb(x.id)}" alt="" loading="lazy" decoding="async">`).join('')}</span>`
    : `<img class="st-scene__thumb" src="${sceneThumb(t.id)}" width="56" height="100" alt="" loading="lazy" decoding="async">`;
  return `<div class="list__row st-row st-scene${on ? ' is-on' : ''}" data-st="scene" data-scene="${esc(t.id)}" role="radio" aria-checked="${on}" tabindex="0">
    ${thumb}
    <span class="st-row__label"><span class="list__title">${esc(t.name)}${auto ? ' <span class="st-badge">Recomendado</span>' : ''}</span><span class="list__sub">${esc(t.description)}</span></span>
    <span class="st-voice__check">${icon('check', 14)}</span>
  </div>`;
}

const demoLabel = (v) => (v.quality === 'off' ? 'Activa las animaciones para verla' : `Ver demo de ${sceneOf(demoWorld(v.theme)).name}`);
const demoBg = (id) => `background-image:radial-gradient(70% 62% at 50% 52%,rgba(5,6,10,.78),rgba(5,6,10,.3)),url('./assets/scenes/${encodeURIComponent(id)}-poster.jpg')`;

/* Animación al abrir (contrato compartido con ../ui/intro.js): localStorage 'ritmup.intro' = 'always' (por defecto,
   también si falta) | 'launch' | 'off'. Aquí solo se lee y se escribe; la intro decide cuándo sonar. */
const INTRO_KEY = 'ritmup.intro';
const INTRO_OPTS = [
  { value: 'always', title: 'Siempre', sub: 'Al abrir la app y al volver a ella tras un rato' },
  { value: 'launch', title: 'Solo al arrancar', sub: 'Cuando la app se abre desde cero' },
  { value: 'off', title: 'Nunca', sub: 'Entras directo, sin animación' },
];
const introPref = () => safe(() => {
  const v = localStorage.getItem(INTRO_KEY);
  return INTRO_OPTS.some((o) => o.value === v) ? v : 'always';
}, 'always');

function introHtml() {
  const cur = introPref();
  const rows = INTRO_OPTS.map((o) => {
    const on = o.value === cur;
    return `<div class="list__row st-row st-voice${on ? ' is-on' : ''}" data-st="intro" data-intro="${o.value}" role="radio" aria-checked="${on}" tabindex="0">
      ${label(esc(o.title), esc(o.sub))}
      <span class="st-voice__check">${icon('check', 14)}</span>
    </div>`;
  }).join('');
  return `<div class="st-group">
      <div class="st-group__title">Animación al abrir</div>
      <div class="list" role="radiogroup" aria-label="Animación al abrir">${rows}</div>
      <p class="st-note">El logotipo de RITMUP dibujándose: dura unos segundos y un toque en la pantalla la salta.</p>
    </div>`;
}

/* Sensación de velocidad del mundo 3D (contrato con ../player/scene3d): localStorage 'ritmup.speedfeel' = 'real' |
   'viva' (por defecto) | 'intensa'. Solo cambia la percepción (marcas cercanas, balanceo, campo de visión); el mundo
   sigue sincronizado con la clase igual. */
const FEEL_KEY = 'ritmup.speedfeel';
const FEEL_OPTS = [
  { value: 'real', title: 'Real', sub: 'Como lo ves en la cinta, sin exagerar nada' },
  { value: 'viva', title: 'Viva', sub: 'Un punto más de sensación de velocidad (recomendada)' },
  { value: 'intensa', title: 'Intensa', sub: 'Se siente como ir más rápido de lo que vas' },
];
const feelPref = () => safe(() => {
  const v = localStorage.getItem(FEEL_KEY);
  return FEEL_OPTS.some((o) => o.value === v) ? v : 'viva';
}, 'viva');

function feelHtml() {
  const cur = feelPref();
  const rows = FEEL_OPTS.map((o) => {
    const on = o.value === cur;
    return `<div class="list__row st-row st-voice${on ? ' is-on' : ''}" data-st="feel" data-feel="${o.value}" role="radio" aria-checked="${on}" tabindex="0">
      ${label(esc(o.title), esc(o.sub))}
      <span class="st-voice__check">${icon('check', 14)}</span>
    </div>`;
  }).join('');
  return `<div class="st-group">
      <div class="st-group__title">Sensación de velocidad</div>
      <div class="list" role="radiogroup" aria-label="Sensación de velocidad">${rows}</div>
      <p class="st-note">El mundo siempre va sincronizado con tu clase; esto solo cambia cuánto se nota la velocidad.</p>
    </div>`;
}

function displayHtml(s) {
  ensureSettingsCss();
  const v = visualsOf(s);
  const canDemo = v.quality !== 'off';
  const sc = sceneOf(v.theme);
  const scenes = SCENES.length ? `<div class="st-group">
      <div class="st-group__title">Escenario</div>
      <div class="list st-scenes${canDemo ? '' : ' is-off'}" role="radiogroup" aria-label="Escenario">${[AUTO_SCENE, ...SCENES].map((t) => sceneRow(t, t.id === sc.id)).join('')}</div>
      <p class="st-note" data-scene-note>${esc(canDemo ? SCENE_NOTE_ON : SCENE_NOTE_OFF)}</p>
    </div>` : '';
  return `${scenes}
    ${group('Animaciones 3D', `
      ${segRow('Calidad', `<span data-vq-note>${qualityNote(v.quality)}</span>`, 'st-vq', QUALITY_OPTS, v.quality)}
      ${toggleRow('st-ghost', 'Luces de tu récord', 'Corres contra tu mejor sesión de esta clase: una hilera de luces marca su ritmo y se vuelve dorada cuando la superas. Los metros, en el chip «vs récord».', v.ghost)}
      ${toggleRow('st-bob', 'Balanceo de cámara', 'La cámara sigue tu zancada, muy sutil. Nunca se mueve con «Reducir movimiento»', v.strideBob)}
      ${toggleRow('st-tvmode', 'Modo TV por defecto', 'Cifras gigantes para verlas en la tele por AirPlay. Un toque muestra todos los datos', v.tvMode)}
      ${toggleRow('st-captions', 'Subtítulos del coach', 'Lo que dice tu coach, en una línea pequeña sobre el rótulo inferior (también con la voz silenciada)', v.captions !== false)}
    `, 'La escena se mueve a la velocidad real de tu cinta y cambia de color con cada tramo. Los datos siempre por delante: cifras nítidas sobre una escena oscura. Con «Reducir movimiento» del iPhone, todo se vuelve sereno.')}
    <section class="card pl-demo" data-demo3d>
      <div class="pl-demo__stage" data-demo-stage data-scene-bg style="${demoBg(demoWorld(sc.id))}">
        <div class="pl-demo__poster" data-demo-poster>
          <span class="pl-demo__badge"><span data-demo-badge>${esc(demoBadge(sc.id))}</span></span>
          <b>Vista previa de 10 segundos</b>
          <span>Una Pirámide real: del trote a tu primer sprint</span>
        </div>
      </div>
      <button type="button" class="btn btn--secondary btn--block pl-demo__btn" data-st="demo3d"${canDemo ? '' : ' disabled'}>${icon('play', 18)}<span>${esc(demoLabel(v))}</span></button>
    </section>
    ${feelHtml()}
    ${introHtml()}`;
}

/** Demo de 10 s en la propia página: la escena real con una Pirámide, entrando en el primer sprint. */
async function runDemo3d(ctx, btn) {
  if (ctx.demo3d) return;
  const stage = ctx.body.querySelector('[data-demo-stage]');
  if (!stage) return;
  const v = visualsOf(getState());
  if (v.quality === 'off') return;
  if (!webglOk()) {
    toast('Este dispositivo no puede mostrar 3D: verás el fondo animado clásico', { icon: 'info' });
    return;
  }
  const run = { alive: true, scene: null, timers: [] };
  ctx.demo3d = run;
  const stop = () => {
    if (!run.alive) return;
    run.alive = false;
    run.timers.forEach((t) => clearTimeout(t));
    try { run.scene?.destroy?.({ releaseContext: true }); } catch { /* nada */ }
    run.scene = null;
    if (ctx.demo3d === run) ctx.demo3d = null;
    const st = ctx.body.querySelector('[data-demo-stage]');
    st?.classList.remove('is-live');
    st?.querySelector('canvas')?.remove();
    const b = ctx.body.querySelector('[data-st="demo3d"]');
    if (b) {
      const vv = visualsOf(getState());
      b.disabled = vv.quality === 'off';
      b.querySelector('span').textContent = demoLabel(vv);
    }
  };
  run.stop = stop;
  ctx.cleanups.push(stop);
  if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Cargando…'; }
  haptic('light');
  try {
    const [sceneMod, genMod] = await Promise.all([import('../player/scene3d.js'), import('../training/generator.js')]);
    if (!run.alive) return;
    const s = getState();
    const wk = genMod.buildWorkout('pyramid', { minutes: 20, levels: s.levels, treadmill: s.treadmill, seed: 7 });
    if (!wk?.segments?.length) throw new Error('sin clase');
    const segs = wk.segments;
    let idx = segs.findIndex((x) => x.zone === 'sprint');
    if (idx < 1) idx = segs.findIndex((x, i) => i > 0 && x.zone === 'fast');
    if (idx < 1) idx = Math.min(1, segs.length - 1);
    const starts = [];
    let acc = 0;
    for (const x of segs) { starts.push(acc); acc += x.sec; }
    const gateT = starts[idx];
    const t0 = Math.max(0, gateT - 6.5);
    const canvas = document.createElement('canvas');
    canvas.className = 'pl-demo__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    stage.appendChild(canvas);
    const reduced = safe(() => matchMedia('(prefers-reduced-motion: reduce)').matches, false);
    run.scene = await sceneMod.createScene3D(canvas, {
      workout: wk, levels: s.levels, quality: v.quality, reducedMotion: reduced, tvMode: false, theme: demoWorld(v.theme),
      strideBob: v.strideBob !== false, treadmill: s.treadmill || null, onError: () => stop(),
    });
    if (!run.alive) { try { run.scene?.destroy?.({ releaseContext: true }); } catch { /* nada */ } return; }
    const sc = run.scene;
    const call = (fn, ...args) => { try { if (typeof sc?.[fn] === 'function') sc[fn](...args); } catch { /* nada */ } };
    const begin = performance.now();
    let segIdx = idx - 1;
    const fired = new Set();
    const feed = () => {
      if (!run.alive) return;
      const T = t0 + (performance.now() - begin) / 1000;
      let i = segIdx;
      while (i + 1 < segs.length && T >= starts[i + 1]) i++;
      if (i !== segIdx) { segIdx = i; call('event', 'segment', { index: i, reason: 'auto' }); }
      const segElapsed = T - starts[segIdx];
      const left = segs[segIdx].sec - segElapsed;
      const n = Math.ceil(left - 1e-3);
      if (n >= 1 && n <= 3 && !fired.has(`${segIdx}:${n}`)) { fired.add(`${segIdx}:${n}`); call('event', 'countdown', { n }); }
      let km = 0;
      for (let k = 0; k < segIdx; k++) km += (segs[k].speed * segs[k].sec) / 3600;
      km += (segs[segIdx].speed * segElapsed) / 3600;
      call('setState', {
        status: 'running', totalElapsed: T, segIndex: segIdx, segElapsed, segRemaining: left,
        currentSpeed: segs[segIdx].speed, distanceKm: km,
      });
      run.timers.push(setTimeout(feed, 250));
    };
    feed();
    stage.classList.add('is-live');
    if (btn) btn.querySelector('span').textContent = 'Demo en marcha…';
    run.timers.push(setTimeout(stop, 10500));
  } catch {
    stop();
    toast('No se pudo cargar la escena 3D en este dispositivo', { icon: 'info' });
  }
}

/* ───────────── VOZ Y AUDIO ───────────── */

function voiceRow(v, on) {
  const uri = v.voiceURI || '';
  const name = cleanVoiceName(v.name);
  return `<div class="list__row st-row st-voice${on ? ' is-on' : ''}" data-voice="${esc(uri)}" role="button" tabindex="0" aria-pressed="${on}">
    <span class="st-voice__check">${icon('check', 14)}</span>
    <span class="st-row__label"><span class="list__title">${esc(name)}</span><span class="list__sub">${langLabel(v.lang)}${v.localService === false ? ' · en línea' : ''}</span></span>
    ${qualityBadge(voiceQuality(v))}
    <button type="button" class="st-play" data-play="${esc(uri)}" aria-label="Escuchar ${esc(name)}">${icon('play', 14)}</button>
  </div>`;
}

function voicesHtml(s) {
  if (!speechMod) return `<div class="list"><div class="list__row st-row"><span class="st-spinner" aria-hidden="true"></span><span class="list__sub">Buscando voces…</span></div></div>`;
  const seen = new Set();
  const voices = (safe(() => speechMod.spanishVoices(), []) || []).filter((v) => v && v.voiceURI && !seen.has(v.voiceURI) && seen.add(v.voiceURI));
  if (!voices.length) {
    return `<div class="list"><div class="list__row st-row">
      ${sqIcon('speaker-off', 'var(--surface-3)', 15)}
      ${label('No encuentro voces en español', 'Descárgalas en Ajustes del iPhone → Accesibilidad → Contenido leído → Voces.')}
    </div></div>`;
  }
  const rank = (v) => ({ premium: 0, enhanced: 1 })[voiceQuality(v)] ?? 2;
  const sorter = (a, b) => rank(a) - rank(b) || cleanVoiceName(a.name).localeCompare(cleanVoiceName(b.name), 'es');
  const sel = s.audio?.voiceURI || null;
  const exists = sel && voices.some((v) => v.voiceURI === sel);
  const def = safe(() => speechMod.defaultVoice(), null);
  const main = voices.filter((v) => !isNoveltyVoice(v));
  const extra = voices.filter(isNoveltyVoice).sort(sorter);
  const es = main.filter(isEsES).sort(sorter);
  const others = main.filter((v) => !isEsES(v)).sort(sorter);
  const extraOpen = !!sel && extra.some((v) => v.voiceURI === sel);
  const auto = `<div class="list__row st-row st-voice${!exists ? ' is-on' : ''}" data-voice="" role="button" tabindex="0" aria-pressed="${!exists}">
    <span class="st-voice__check">${icon('check', 14)}</span>
    <span class="st-row__label"><span class="list__title">Automática</span><span class="list__sub">La mejor disponible${def ? ` · ahora ${esc(cleanVoiceName(def.name))}` : ''}</span></span>
    <span class="st-badge">Recomendada</span>
    <button type="button" class="st-play" data-play="" aria-label="Escuchar la voz automática">${icon('play', 14)}</button>
  </div>`;
  return `<div class="list">${auto}${es.map((v) => voiceRow(v, v.voiceURI === sel)).join('')}</div>
    ${others.length ? `<div class="st-group__title st-group__title--inner">Otras voces en español</div><div class="list">${others.map((v) => voiceRow(v, v.voiceURI === sel)).join('')}</div>` : ''}
    ${extra.length ? `<details class="st-more"${extraOpen ? ' open' : ''}><summary><span class="st-more__chev">${icon('chevron-right', 14)}</span>Más voces (${extra.length})</summary><div class="list">${extra.map((v) => voiceRow(v, v.voiceURI === sel)).join('')}</div></details>` : ''}`;
}

function packsHtml(s, packs) {
  const sel = s.audio?.packId || null;
  const sys = `<div class="list__row st-row st-voice${!sel ? ' is-on' : ''}" data-pack="" role="button" tabindex="0" aria-pressed="${!sel}">
    <span class="st-voice__check">${icon('check', 14)}</span>
    ${label('Voz del sistema', 'Síntesis de voz del iPhone (la que elijas abajo)')}
  </div>`;
  if (packs == null) return `<div class="list__row st-row"><span class="st-spinner" aria-hidden="true"></span><span class="list__sub">Buscando voces grabadas…</span></div>${sys}`;
  const rows = packs.map((p) => {
    const on = sel === p.id;
    const st = packStatus[p.id];
    const ready = !!st?.ok;
    const isEva = p.id === EVA_ID;
    const count = st?.count || (Array.isArray(p.clips) ? p.clips.length : Number(p.count) || 0);
    const sub = ready
      ? `${fmt.int(count)} frases grabadas${isEva ? ' · español de España' : ''}`
      : isEva ? 'Grabaciones en camino · mientras, voz del sistema' : 'Este pack no tiene grabaciones';
    return `<div class="list__row st-row st-voice mu-pack${on ? ' is-on' : ''}${ready ? '' : ' is-pending'}" data-pack="${esc(p.id)}" role="button" tabindex="0" aria-pressed="${on}">
      <span class="st-voice__check">${icon('check', 14)}</span>
      <span class="mu-pack__avatar" aria-hidden="true">${esc(packName(p).charAt(0).toUpperCase() || 'V')}</span>
      ${label(esc(packName(p)), sub)}
      <span class="st-badge${ready ? ' st-badge--premium' : ''}">${ready ? 'Grabada' : 'Pronto'}</span>
    </div>`;
  }).join('');
  return `${rows}${sys}`;
}

function packHintHtml(s) {
  const sel = s.audio?.packId || null;
  if (!sel) return '';
  const st = packStatus[sel];
  if (!st) return '';
  if (st.ok) return `${icon('check', 13)} Voz grabada lista. Si un aviso de cambio no está grabado, lo dirá la voz del sistema.`;
  return `${icon('info', 13)} ${sel === EVA_ID ? 'Las grabaciones de Lucía aún no están en la app.' : 'Este pack aún no tiene grabaciones.'} Mientras tanto, el coach habla con la voz del sistema y, en cuanto lleguen, se usarán solas.`;
}

function audioHtml(s) {
  const a = s.audio || {};
  return `${group('Coach', `
      ${toggleRow('st-voice-on', 'Coach de voz', 'Anuncia cambios, velocidades y te motiva', a.voiceEnabled !== false)}
      ${toggleRow('st-beeps', 'Pitidos de cuenta atrás', '3, 2, 1… ¡ya! en cada cambio', a.beeps !== false)}
      ${toggleRow('st-duck', 'Bajar tu música cuando hablo', 'Solo con «Mi música» (Spotify, Apple Music). Quita el modo silencio del iPhone para oír al coach', a.duckMusic !== false)}
    `)}
    <div class="st-group">
      <div class="st-group__title">Nivel de charla</div>
      <div class="card st-chat">
        <div class="st-seg">${segmented({ name: 'st-chat', options: [{ value: 'minimal', label: 'Mínimo' }, { value: 'normal', label: 'Normal' }, { value: 'coach', label: 'Coach' }], value: a.chattiness || 'normal' })}</div>
        <p class="st-chat__desc" data-chat-desc>${CHAT_DESC[a.chattiness] || CHAT_DESC.normal}</p>
      </div>
    </div>
    <div class="st-group">
      <div class="st-group__title">Voz del coach</div>
      <div class="list" data-packs>${packsHtml(s, packsCache)}</div>
      <p class="st-note mu-pack-hint" data-pack-hint>${packHintHtml(s)}</p>
    </div>
    <div class="st-group">
      <div class="st-group__title">Voz del sistema</div>
      <div class="st-voices" data-voices>${voicesHtml(s)}</div>
      <p class="st-note">Se usa con «Voz del sistema» y como respaldo si falta alguna frase grabada. ¿Más natural? En el iPhone ve a <b>Ajustes → Accesibilidad → Contenido leído → Voces → Español (España)</b> y descarga una voz «Mejorada» o «Premium» (por ejemplo, Mónica).</p>
    </div>
    ${group('Cómo habla', `
      ${stepRow('Velocidad', 'Rapidez al hablar', 'st-rate', { value: a.rate ?? 1, step: 0.05, min: 0.7, max: 1.4, unit: '×', decimals: 2 })}
      ${stepRow('Tono', 'Más grave o más agudo', 'st-pitch', { value: a.pitch ?? 1, step: 0.05, min: 0.7, max: 1.3, unit: '', decimals: 2 })}
      ${stepRow('Volumen de la voz', 'Respecto al del iPhone', 'st-volume', { value: Math.round((a.volume ?? 1) * 100), step: 10, min: 10, max: 100, unit: '%', decimals: 0 })}
    `)}
    <button type="button" class="btn btn--primary btn--lg btn--block st-test" data-st="test-coach">${icon('play', 20)}<span>Probar coach</span></button>
    <p class="st-note st-note--center">El modo silencio del iPhone (botón de Acción o Centro de control) puede silenciar los pitidos. Si no los oyes, desactívalo y sube el volumen.</p>`;
}

/* ───────────── APPLE WATCH Y SALUD ───────────── */

// Respaldo si watch-hr.js no está: mismos pasos que §12 con los nombres de las acciones de Atajos en español
const FALLBACK_GUIDE = [
  'Abre la app «Atajos», toca «+» y llama al atajo exactamente como aparece arriba.',
  'Añade «Recibir» entrada de tipo «Texto» desde «Atajos» (si no hay entrada: «Detener y responder»).',
  'Añade «Obtener diccionario de la entrada» con «Entrada del atajo».',
  'Añade «Buscar muestras de salud»: tipo «Frecuencia cardiaca», «Fecha de inicio» está entre `start` y `end` del diccionario, ordenar por «Fecha de inicio» ascendente, sin límite.',
  'Añade «Calcular estadísticas» tres veces sobre las muestras: «Media», «Máximo» y «Mínimo».',
  'Añade «Repetir con cada» muestra y, dentro, «Texto» con `[Fecha de inicio ISO 8601],[Valor]`.',
  'Tras el bucle, «Combinar texto» con «Salto de línea».',
  'Añade «Diccionario» con `v` = 1, `id` (del diccionario recibido), `avg`, `max`, `min` y `csv` (el texto combinado).',
  'Añade «Copiar al portapapeles» con el diccionario.',
  'Termina con «Mostrar notificación»: «Vuelve a BestRunning y pulsa Pegar». La primera vez, permite el acceso a Salud.',
];

const hrTest = { session: null, opened: 0, result: null, error: null, saved: false, nudged: false };

// El nombre vive en integrations.hrShortcut (lo lee watchShortcutName de watch-hr.js); healthShortcut es «Guardar en Salud»
const shortcutName = (s = getState()) => String(s.integrations?.hrShortcut || '').trim() || HR_SHORTCUT;

/** Sesión para probar el Atajo: la última del historial o, si no hay, los últimos 40 minutos. */
function testSession(s = getState()) {
  const hist = Array.isArray(s.history) ? s.history : [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (h && h.id && h.startedAt && Number(h.elapsedSec) > 0) return h;
  }
  const sec = 40 * 60;
  return { id: 'ses_prueba', title: 'Prueba', isProbe: true, startedAt: new Date(Date.now() - sec * 1000).toISOString(), elapsedSec: sec, plannedSec: sec };
}

/** Texto de guía: se escapa y se resaltan «acciones» y `valores`. */
function richText(t) {
  return esc(String(t ?? ''))
    .replace(/«([^»]{1,90})»/g, '<span class="st-act">$1</span>')
    .replace(/`([^`]{1,90})`/g, '<code>$1</code>');
}

function guideStep(st) {
  if (typeof st === 'string') return richText(st);
  if (!st || typeof st !== 'object') return '';
  const title = st.title ?? st.action ?? st.name ?? '';
  const text = st.text ?? st.detail ?? st.details ?? st.description ?? st.body ?? st.how ?? '';
  const extra = [st.params, st.settings, st.items, st.fields].find(Array.isArray) || null;
  return [
    title ? `<b>${richText(title)}</b>` : '',
    text ? `${title ? '<br>' : ''}${richText(text)}` : '',
    extra ? `<span class="mu-step__list">${extra.map((x) => `<span>${richText(typeof x === 'object' ? Object.values(x).join(': ') : x)}</span>`).join('')}</span>` : '',
  ].join('');
}

function guideHtml(name = shortcutName()) {
  let g = watchMod?.SHORTCUT_GUIDE;
  if (g && !Array.isArray(g) && Array.isArray(g.steps)) g = g.steps;
  const def = String(watchMod?.SHORTCUT_NAME || HR_SHORTCUT);
  // El paso de crear el atajo muestra el nombre que hayas elegido
  const rename = (x) => (typeof x === 'string' ? x.split(`«${def}»`).join(`«${name}»`) : x);
  const list = (Array.isArray(g) && g.length ? g : FALLBACK_GUIDE)
    .map((st) => (st && typeof st === 'object' ? Object.fromEntries(Object.entries(st).map(([k, v]) => [k, rename(v)])) : rename(st)))
    .map(guideStep)
    .filter(Boolean);
  return `${steps(list)}<a class="btn btn--secondary btn--block" href="shortcuts://">${icon('external', 17)}<span>Abrir Atajos</span></a>`;
}

const pad2s = (n) => String(n).padStart(2, '0');

/** ISO local con zona horaria (2026-10-17T07:15:00+02:00). */
function isoLocal(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad2s(d.getMonth() + 1)}-${pad2s(d.getDate())}T${pad2s(d.getHours())}:${pad2s(d.getMinutes())}:${pad2s(d.getSeconds())}${sign}${pad2s(Math.floor(a / 60))}:${pad2s(a % 60)}`;
}

/** Respaldo de requestWatchHr (§12): abre el Atajo con { v:1, id, start, end } y 60 s de margen. */
function openShortcutFallback(session, name) {
  const t0 = new Date(session.startedAt);
  if (Number.isNaN(t0.getTime())) return false;
  const span = Math.max(Number(session.elapsedSec) || 0, Number(session.plannedSec) || 0);
  const payload = { v: 1, id: session.id, start: isoLocal(new Date(t0.getTime() - 60000)), end: isoLocal(new Date(t0.getTime() + (span + 60) * 1000)) };
  try {
    location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(JSON.stringify(payload))}`;
    return true;
  } catch {
    return false;
  }
}

function hrTestHtml(s) {
  const ses = hrTest.session || testSession(s);
  const when = ses.isProbe
    ? 'los últimos 40 minutos'
    : `tu última sesión, «${esc(ses.title || 'Entrenamiento')}»${ses.dayKey ? ` del ${esc(fmt.dateShort(ses.dayKey))}` : ''}`;
  let res = '';
  const r = hrTest.result;
  if (r) {
    const n = Array.isArray(r.hrSeries) ? r.hrSeries.length : 0;
    const canSave = !ses.isProbe && !hrTest.saved && !(Number(ses.hrAvg) > 0);
    res = `<div class="mu-hrres is-ok">
        <span class="mu-hrres__icon">${icon('heart', 18)}</span>
        <div class="mu-hrres__txt"><b>¡El Atajo funciona!</b><span>Media <b class="num">${fmt.int(r.hrAvg)}</b> · máx. <b class="num">${fmt.int(r.hrMax)}</b>${r.hrMin ? ` · mín. <b class="num">${fmt.int(r.hrMin)}</b>` : ''} ppm${n ? ` · ${fmt.int(n)} puntos` : ''}</span></div>
      </div>
      ${canSave ? `<button type="button" class="btn btn--secondary btn--block" data-st="hr-save">${icon('check', 17)}<span>Guardar este pulso en esa sesión</span></button>` : ''}
      ${hrTest.saved ? `<p class="st-note mu-hrres__saved">${icon('check', 13)} Guardado en «${esc(ses.title || 'la sesión')}». Lo verás en su resumen.</p>` : ''}`;
  } else if (hrTest.error) {
    res = `<div class="mu-hrres is-error"><span class="mu-hrres__icon">${icon('warning', 18)}</span><div class="mu-hrres__txt"><span>${esc(hrTest.error)}</span></div></div>`;
  }
  return `<p class="mu-hrtest__txt">Abre el Atajo con ${when}. Al volver, pulsa <b>Pegar resultado</b> para ver qué ha leído de Salud.</p>
    <div class="mu-hrtest__btns">
      <button type="button" class="btn btn--primary" data-st="hr-test">${icon('watch', 18)}<span>Probar Atajo</span></button>
      <button type="button" class="btn btn--secondary${hrTest.opened && !hrTest.result ? ' is-ready' : ''}" data-st="hr-paste">${icon('copy', 17)}<span>Pegar resultado</span></button>
    </div>
    ${res}`;
}

function paintHrTest(ctx) {
  const host = ctx.body.querySelector('[data-hrtest]');
  if (host) host.innerHTML = hrTestHtml(getState());
}

function runHrTest(ctx) {
  const name = shortcutName();
  const ses = testSession();
  Object.assign(hrTest, { session: ses, opened: Date.now(), result: null, error: null, saved: false, nudged: false });
  haptic('medium');
  let ok = false;
  if (typeof watchMod?.requestWatchHr === 'function') {
    try { ok = watchMod.requestWatchHr(ses, name) !== false; } catch { ok = false; }
  }
  if (!ok) ok = openShortcutFallback(ses, name);
  if (!ok) hrTest.error = 'No hemos podido abrir la app Atajos.';
  paintHrTest(ctx);
}

/** Lee el portapapeles (DEBE ser lo primero del gesto) y valida lo que devolvió el Atajo. */
function pasteHrTest(ctx) {
  const p = safe(() => navigator.clipboard?.readText?.(), null);
  if (!p || typeof p.then !== 'function') {
    hrTest.error = 'Este navegador no deja leer el portapapeles.';
    paintHrTest(ctx);
    return;
  }
  p.then(async (text) => {
    const mod = await loadWatch();
    const ses = hrTest.session || testSession();
    let r = null;
    try {
      r = typeof mod?.parseWatchHr === 'function' ? await mod.parseWatchHr(String(text || ''), ses) : null;
    } catch (e) {
      r = { error: String(e?.message || '') };
    }
    if (r && Number(r.hrAvg) > 0) {
      hrTest.result = r;
      hrTest.error = null;
      haptic('success');
    } else {
      hrTest.result = null;
      hrTest.error = (r && (r.error || r.message)) || (text ? 'Lo copiado no son datos de pulso. ¿Terminó el Atajo y salió la notificación?' : 'El portapapeles está vacío: ejecuta antes el Atajo.');
      haptic('error');
    }
    if (ctx.alive) paintHrTest(ctx);
  }).catch(() => {
    hrTest.error = 'No he podido leer el portapapeles. Cuando iOS pregunte, toca «Permitir pegar».';
    if (ctx.alive) paintHrTest(ctx);
  });
}

function saveHrTest(ctx) {
  const r = hrTest.result;
  const ses = hrTest.session;
  if (!r || !ses || ses.isProbe) return;
  const profile = getState().profile || {};
  const fields = safe(() => (typeof watchMod?.hrFieldsFrom === 'function' ? watchMod.hrFieldsFrom(r, profile) : null), null) || {
    hrAvg: Math.round(Number(r.hrAvg)) || null,
    hrMax: Math.round(Number(r.hrMax)) || null,
    hrMin: Math.round(Number(r.hrMin)) || null,
    hrSeries: Array.isArray(r.hrSeries) && r.hrSeries.length ? r.hrSeries : null,
    hrZones: safe(() => (typeof watchMod?.hrZoneTimes === 'function' && Array.isArray(r.hrSeries) ? watchMod.hrZoneTimes(r.hrSeries, profile) : null), null),
  };
  ctx.save((d) => {
    const h = Array.isArray(d.history) ? d.history.find((x) => x && x.id === ses.id) : null;
    if (h) Object.assign(h, fields);
  });
  hrTest.saved = true;
  haptic('success');
  toast('Pulso guardado en la sesión', { icon: 'heart', kind: 'success' });
  paintHrTest(ctx);
}

/** App nativa: estado del reloj (lo cuenta el iPhone en native.hello / native.status) y permiso de Salud. */
function nativeWatchHtml() {
  const ns = nativeStatus();
  const w = ns?.watch;
  let c;
  if (!ns) {
    c = { ok: false, ic: 'watch', title: 'Comprobando tu Apple Watch…', text: 'El iPhone está mirando si tienes un reloj emparejado con RITMUP.' };
  } else if (w?.paired && w?.installed && healthMissingOf(ns)) {
    c = { ok: false, ic: 'heart', title: 'Apple Watch conectado · falta el permiso del pulso', text: 'Sin permiso de Salud, el reloj no puede leer tu pulso en directo ni guardar la clase en Salud.' };
  } else if (w?.paired && w?.installed) {
    c = { ok: true, ic: 'check', title: 'Apple Watch conectado · pulso en directo', text: 'El reloj se abre solo al empezar la clase: vibra antes de cada cambio, te pasa el pulso en directo y guarda el entreno en Salud.' };
  } else if (w?.paired) {
    c = { ok: false, ic: 'download', title: 'Instala RITMUP en el reloj: app Watch › Apps disponibles', text: 'Abre la app Watch del iPhone, baja hasta «Apps disponibles» y toca «Instalar» junto a RITMUP.' };
  } else {
    c = { ok: false, ic: 'watch', title: 'No hay ningún Apple Watch emparejado', text: 'Puedes entrenar igual. Cuando emparejes uno, instala en él RITMUP para tener el pulso en directo.' };
  }
  // 'prompt': aún sale la hoja de Salud (el botón la enseña) · 'denied': ya se dijo que no a algo (el botón abre Ajustes)
  const miss = ns ? healthMissingOf(ns) : null;
  return `<section class="card st-install${c.ok ? ' is-ok' : ''}">
      <span class="st-install__icon">${icon(c.ok ? 'check-circle' : c.ic, 40)}</span>
      <b class="st-install__title">${esc(c.title)}</b>
      <p>${esc(c.text)}</p>
    </section>
    ${miss ? `<div class="st-group">
      <button type="button" class="btn btn--primary btn--lg btn--block" data-st="health-auth">${icon('heart', 18)}<span>${miss === 'denied' ? 'Abrir Ajustes' : 'Permitir acceso a Salud'}</span></button>
      <p class="st-note">${miss === 'denied'
        ? 'Salud no deja a RITMUP leer tu pulso o guardar tus entrenos. En Ajustes: Apps › Salud › Acceso a datos y dispositivos › RITMUP › Activar todo.'
        : 'Para ver tu pulso en directo en el reloj y guardar cada clase en Salud como carrera en interior, con pulso, distancia y calorías. Toca «Activar todo».'}</p>
    </div>` : ''}`;
}

/** Cabecera de Apple Watch: el reloj real con la pantalla «Clase» de BestRunning, en bucle (póster sin movimiento). */
function watchHero() {
  const native = isNative();
  return `<section class="st-watchhero" aria-label="Apple Watch">
      ${bgVideo('watch-loop', { cls: 'st-watchhero__media' })}
      <div class="st-watchhero__text">
        <b>${native ? 'Tu clase, en la muñeca' : 'Tu Apple Watch, en cada clase'}</b>
        <span>${native ? 'Cada cambio con un toque y tu pulso en directo' : 'Graba tu carrera en cinta y trae tu pulso al resumen'}</span>
      </div>
    </section>`;
}

function watchHtml(s) {
  if (isNative()) {
    // App nativa: el estado del reloj arriba; el Atajo queda como respaldo (sin reloj o sin la app del reloj)
    // App nativa: la app del reloj se conecta sola y manda el pulso en directo (sin Atajos ni «Cinta de correr»)
    return `${watchHero()}<div class="stack-lg" data-slot="nwatch">${nativeWatchHtml()}</div>
      <section class="card st-info">
        <div>
          <b class="st-info__title">Pulso en directo, sin hacer nada</b>
          <p>RITMUP en tu Apple Watch se conecta solo al empezar la clase y manda tu pulso al iPhone en directo: lo ves en la clase, por zonas y sobre tu perfil de velocidad en el resumen. Al terminar, el entreno se guarda en Salud.</p>
        </div>
      </section>`;
  }
  return `${watchHero()}${watchShortcutHtml(s)}`;
}

function watchShortcutHtml(s) {
  const ig = s.integrations || {};
  const name = String(ig.hrShortcut || '').trim();
  const shown = esc(name || HR_SHORTCUT);
  const health = String(ig.healthShortcut || '');
  const act = (t) => `<span class="st-act">${t}</span>`;
  return `${group('Durante la clase', `
      ${toggleRow('st-watch', 'Recordarme iniciar el Watch', 'Antes de empezar: Entreno → Cinta de correr', ig.watchReminder !== false)}
    `)}
    <section class="card st-info">
      <div>
        <b class="st-info__title">Pulso del Watch: al terminar, no en directo</b>
        <p>Una web no puede leer el pulso del Apple Watch mientras corres: Safari no da acceso a HealthKit ni al Bluetooth del reloj. La solución pro: el Watch graba tu entreno de <i>Cinta de correr</i> y, al acabar, un <b>Atajo</b> lee de Salud tu frecuencia cardiaca de esa franja y te la trae: media, máxima, gráfico sobre tu perfil de velocidad y tiempo en cada zona.</p>
      </div>
    </section>
    <section class="card mu-hrflow" aria-label="Cómo llega el pulso">
      <div class="mu-hrflow__step"><span>${icon('watch', 20)}</span><b>Watch</b> <small>Graba Cinta de correr</small></div>
      <i class="mu-hrflow__arrow" aria-hidden="true">${icon('chevron-right', 14)}</i>
      <div class="mu-hrflow__step"><span>${icon('zap', 20)}</span><b>Atajo</b> <small>Lee Salud y copia</small></div>
      <i class="mu-hrflow__arrow" aria-hidden="true">${icon('chevron-right', 14)}</i>
      <div class="mu-hrflow__step"><span>${icon('pulse', 20)}</span><b>RITMUP</b> <small>Pegar en el resumen</small></div>
    </section>
    ${group('Atajo de pulso', `
      <label class="list__row st-row">${label('Nombre del Atajo', 'Debe coincidir letra a letra')}<input id="st-hrshortcut" class="st-input" type="text" value="${esc(name || HR_SHORTCUT)}" placeholder="${esc(HR_SHORTCUT)}" maxlength="40" autocapitalize="words" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done"></label>
    `, 'Tras cada entreno, en el resumen pulsa «Importar pulso del Apple Watch»: se abre el Atajo, copia tus datos y, al volver a RITMUP, pulsas Pegar.')}
    <div class="st-group">
      <div class="st-group__title">Crea el Atajo «<span data-shortcut-name>${shown}</span>» (3 minutos)</div>
      <div class="card st-guide" data-guide>${guideHtml(name || HR_SHORTCUT)}</div>
    </div>
    <div class="st-group">
      <div class="st-group__title">Comprobar que funciona</div>
      <section class="card mu-hrtest" data-hrtest>${hrTestHtml(s)}</section>
    </div>
    ${group('Días sin Watch: Guardar en Salud (opcional)', `
      <label class="list__row st-row">${label('Nombre del atajo', 'Vacío = desactivado')}<input id="st-shortcut" class="st-input" type="text" value="${esc(health)}" placeholder="BestRunning Salud" maxlength="40" autocapitalize="words" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done"></label>
    `, `Si un día corres sin el Watch, el resumen puede abrir este otro atajo con la distancia y las calorías: ${act('Obtener diccionario de entrada')} → ${act('Registrar muestra de salud')} (${act('Distancia caminando + corriendo')} en km y ${act('Energía activa')} en kcal). Los días con Watch no lo uses: Salud ya tiene esos datos y contarías los kilómetros dos veces.`)}`;
}

/* ───────────── INSTALAR ───────────── */

function installHtml() {
  const ok = isStandalone();
  const status = ok
    ? `<section class="card st-install is-ok">
        <span class="st-install__icon">${icon('check-circle', 40)}</span>
        <b class="st-install__title">¡RITMUP ya está instalada!</b>
        <p>La estás usando como app: pantalla completa, sin barras de Safari y funcionando sin conexión.</p>
      </section>`
    : `<section class="card st-install">
        <span class="st-install__icon">${icon('download', 40)}</span>
        <b class="st-install__title">Instálala en tu pantalla de inicio</b>
        <p>Diez segundos y la tendrás como una app más, con su icono y a pantalla completa.</p>
      </section>`;
  const benefits = [
    ['bolt', 'Arranque instantáneo desde su icono'],
    ['moon', 'Pantalla siempre encendida durante la clase'],
    ['route', 'Funciona sin conexión en el gimnasio'],
    ['eye', 'Pantalla completa, sin barras de Safari'],
  ].map(([ic, t]) => `<div class="list__row st-benefit">${listIcon(ic)}<span class="list__title">${t}</span></div>`).join('');
  return `${status}
    <div class="st-group">
      <div class="st-group__title">${ok ? 'Si algún día la reinstalas' : 'Paso a paso'}</div>
      <div class="card st-guide">${steps([
        'Abre esta web en <b>Safari</b> (en otros navegadores no se puede instalar).',
        `Toca el botón ${icon('share', 15)} <b>Compartir</b> (en iOS 26 está dentro del menú <b>⋯</b> de la barra).`,
        `Elige ${icon('plus', 15)} <b>Añadir a pantalla de inicio</b>.`,
        'Deja activado <b>Abrir como app web</b> y toca <b>Añadir</b>.',
        'Abre RITMUP desde su icono en la pantalla de inicio. ¡A correr!',
      ])}</div>
    </div>
    <div class="st-group">
      <div class="st-group__title">Por qué merece la pena</div>
      <div class="list st-benefits">${benefits}</div>
      <p class="st-note">La app instalada guarda sus datos aparte de Safari. Si ya entrenaste desde Safari, exporta una copia en <b>Datos</b> y luego impórtala dentro de la app.</p>
    </div>`;
}

/* ───────────── DATOS ───────────── */

function dataHtml(s) {
  const hist = Array.isArray(s.history) ? s.history : [];
  const bytes = safe(() => new Blob([exportState()]).size, 0);
  const firstKey = hist.reduce((m, h) => (h?.dayKey && (!m || h.dayKey < m) ? h.dayKey : m), null);
  return `<section class="card st-datasum">
      <div><b class="num">${hist.length}</b><span>${hist.length === 1 ? 'Sesión' : 'Sesiones'}</span></div>
      <div><b class="num">${firstKey ? esc(fmt.dateShort(firstKey).split(' ').slice(1).join(' ')) : '—'}</b><span>Primera</span></div>
      <div><b class="num">${bytes < 1024 * 1024 ? `${fmt.int(bytes / 1024)}` : fmt.dec1(bytes / 1048576)}<span class="unit">${bytes < 1024 * 1024 ? 'KB' : 'MB'}</span></b><span>Tamaño</span></div>
    </section>
    <p class="st-note st-persist" data-persist></p>
    ${group('Copia de seguridad', `
      <div class="list__row st-row st-action" role="button" tabindex="0" data-st="export">
        ${listIcon('share')}${label('Exportar copia', 'Archivo JSON con todo: plan, historial y ajustes')}<span class="list__chev">${icon('chevron-right', 14)}</span>
      </div>
      <label class="list__row st-row st-action" for="st-import">
        ${listIcon('download')}${label('Importar copia', 'Sustituye los datos actuales por los de la copia')}<span class="list__chev">${icon('chevron-right', 14)}</span>
        <input id="st-import" class="st-file" type="file" accept="application/json,.json">
      </label>
    `, 'Tus datos solo viven en este iPhone: no hay cuentas ni nube. Exporta una copia de vez en cuando (a Archivos o iCloud Drive) y siempre antes de cambiar de móvil.')}
    ${group('Zona peligrosa', `
      <div class="list__row st-row st-action st-danger" role="button" tabindex="0" data-st="reset">
        ${listIcon('trash', { tone: 'danger' })}<span class="list__title">Borrar todos los datos</span>
      </div>
    `, 'Elimina historial, plan, logros y ajustes de este dispositivo y vuelve a empezar desde la bienvenida.')}`;
}

async function exportBackup() {
  let json;
  try {
    json = exportState();
  } catch {
    toast('No he podido preparar la copia', { kind: 'error' });
    return;
  }
  const name = `ritmup-copia-${todayKey()}.json`;
  const file = safe(() => new File([json], name, { type: 'application/json' }), null);
  if (file && navigator.canShare && safe(() => navigator.canShare({ files: [file] }), false)) {
    try {
      await navigator.share({ files: [file], title: 'Copia de RITMUP' });
      haptic('success');
      toast('Copia exportada', { icon: 'check', kind: 'success' });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  try {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    haptic('success');
    toast('Copia descargada', { icon: 'download', kind: 'success' });
  } catch {
    toast('No he podido exportar la copia', { kind: 'error' });
  }
}

const BACKUP_APPS = ['RITMUP', 'BestRunning'];

/** Restaura una copia desde un <input type="file"> (también lo usa la bienvenida de la app nativa). → true si se restauró. */
export async function importBackup(input) {
  const file = input?.files?.[0];
  if (!file) return false;
  let text = '';
  try {
    text = await file.text();
  } catch {
    text = '';
  } finally {
    input.value = '';
  }
  // Se comprueba antes de preguntar: un JSON cualquiera no debe llegar al diálogo de restaurar
  let j = null;
  try {
    j = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    j = null;
  }
  // Copias de antes del cambio de nombre (app: 'BestRunning') y las nuevas (app: 'RITMUP'); las muy antiguas no lo llevan
  const ok = !!j && typeof j === 'object' && !Array.isArray(j) && typeof j.version === 'number'
    && (j.app == null || BACKUP_APPS.includes(j.app))
    && (j.history == null || Array.isArray(j.history));
  if (!ok) {
    haptic('error');
    toast('Ese archivo no es una copia de RITMUP', { kind: 'error' });
    return false;
  }
  const n = Array.isArray(j.history) ? j.history.length : 0;
  const when = typeof j.exportedAt === 'string' && !Number.isNaN(Date.parse(j.exportedAt))
    ? ` del ${fmt.dateLong(todayKey(new Date(j.exportedAt)))}` : '';
  const yes = await confirmDialog({
    title: '¿Restaurar esta copia?',
    message: `La copia${when} tiene ${n} ${n === 1 ? 'sesión' : 'sesiones'}. Sustituirá todos tus datos actuales (historial, plan, velocidades y ajustes) por los de la copia.`,
    confirmText: 'Restaurar',
    cancelText: 'Cancelar',
    destructive: true,
  });
  if (!yes) return false;
  const done = safe(() => importState(text), false);
  if (done) {
    haptic('success');
    toast('Copia restaurada. ¡Todo en su sitio!', { icon: 'check', kind: 'success' });
  } else {
    haptic('error');
    toast('No he podido leer la copia: el archivo no es válido', { kind: 'error' });
  }
  return !!done;
}

async function resetAll() {
  haptic('warning');
  const first = await confirmDialog({
    title: '¿Borrar todos los datos?',
    message: 'Se eliminarán tu historial, tu plan, tus logros y tus ajustes de este dispositivo.',
    confirmText: 'Borrar todo',
    cancelText: 'Cancelar',
    destructive: true,
  });
  if (!first) return;
  const second = await confirmDialog({
    title: '¿Seguro del todo?',
    message: 'No se puede deshacer. Si quieres conservar algo, exporta antes una copia.',
    confirmText: 'Sí, borrar para siempre',
    cancelText: 'Mejor no',
    destructive: true,
  });
  if (!second) return;
  safe(() => resetState());
  haptic('success');
  toast('Datos borrados. Empezamos de cero', { icon: 'trash' });
  navigate('#/onboarding', { replace: true });
}

/* ───────────── ACERCA DE ───────────── */

function aboutHtml(s) {
  const name = String(s.profile?.name || '').trim();
  return `<section class="st-about">
      <h2 class="st-about__name">${wordmarkSvg({ cls: 'st-about__mark' })}</h2>
      <p class="st-about__tag">Tu entrenador personal de cinta</p>
      <span class="st-about__ver">Versión ${esc(APP_VERSION)}</span>
    </section>
    ${group('', `
      <div class="list__row st-row"><span class="list__title">Hecha para</span><span class="list__value">${name ? esc(name) : 'ti'}</span></div>
      <div class="list__row st-row"><span class="list__title">Funciona sin conexión</span><span class="list__value">Sí</span></div>
      <div class="list__row st-row"><span class="list__title">Tus datos</span><span class="list__value">Solo en este dispositivo</span></div>
      <div class="list__row st-row st-action st-link" role="button" tabindex="0" data-st="update"><span class="list__title">Buscar actualizaciones</span></div>
      <div class="list__row st-row st-action st-link" role="button" tabindex="0" data-st="diag"><span class="list__title">Diagnóstico</span><span class="list__value">Copiar</span></div>
    `)}
    <div class="st-group">
      <div class="st-group__title">Créditos</div>
      <div class="card st-credits">
        <p>Diseñada a medida para entrenar en cinta con clases guiadas, perfil de intensidad y un coach que te habla, inspirada en la experiencia de las clases de ciclo indoor.</p>
        <p><b>Ciencia detrás:</b> FC máxima de Tanaka, zonas de Karvonen, VO₂máx de Léger, calorías ACSM y test VAM escalonado.</p>
        <p><b>Voz del coach:</b> Lucía López, <b>voz generada con IA</b> (ElevenLabs v3 en Magnific, con licencia comercial), con la síntesis de voz de Apple como respaldo.</p>
        <p><b>Música:</b> electrónica de artistas de Pixabay (Pixabay Content License; lista completa en Perfil → Música), mezclada en directo por el motor DJ de la app.</p>
        <p><b>Escenarios 3D:</b> three.js (licencia MIT).</p>
        <p><b>Código:</b> escrito con Claude Code (Opus 5.5) en una noche.</p>
      </div>
    </div>
    <section class="card st-warn">
      <span class="st-warn__icon">${icon('info', 18)}</span>
      <p>RITMUP no es un dispositivo médico. Si notas dolor en el pecho, mareo o una falta de aire fuera de lo normal, para la cinta y consulta a tu médico.</p>
    </section>
    <p class="st-foot">Hecho con cariño y muchos kilómetros</p>`;
}

async function checkUpdate() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (!reg) {
      toast('Las actualizaciones llegan solas con la app instalada', { icon: 'info' });
      return;
    }
    await reg.update();
    if (reg.waiting || reg.installing) toast('Hay una versión nueva en camino…', { icon: 'download' });
    else toast('Ya tienes la última versión', { icon: 'check', kind: 'success' });
  } catch {
    toast('No he podido comprobarlo ahora mismo', { kind: 'error' });
  }
}

/* ───────────── voz: pruebas ───────────── */

function speakNow(text, overrides = {}) {
  if (!speechMod) {
    toast('La voz aún se está cargando…', { icon: 'speaker' });
    return Promise.resolve();
  }
  const a = getState().audio || {};
  fire(() => audioMod?.unlockAudio?.());
  const t = safe(() => (typeof speechMod.speechText === 'function' ? speechMod.speechText(text) : text), text);
  const opts = { rate: a.rate ?? 1, pitch: a.pitch ?? 1, volume: a.volume ?? 1, voiceURI: a.voiceURI || null, interrupt: true, ...overrides };
  return Promise.resolve(fire(() => speechMod.speak(t, opts))).catch(() => {});
}

function previewVoice(uri, btn, ctx) {
  const s = getState();
  const name = String(s.profile?.name || '').trim();
  const lv = s.levels || DEFAULT_LEVELS;
  const def = safe(() => speechMod?.defaultVoice?.(), null);
  ctx.body.querySelectorAll('.st-play.is-playing').forEach((b) => b.classList.remove('is-playing'));
  btn?.classList.add('is-playing');
  const text = `Hola${name ? `, ${name}` : ''}. Soy tu coach. Sube a ${fmt.speed(lv.run)} kilómetros por hora. ¡Vamos!`;
  speakNow(text, { voiceURI: uri || def?.voiceURI || null }).finally(() => btn?.classList.remove('is-playing'));
}

async function demoCoach(ctx, btn) {
  const s = getState();
  const a = s.audio || {};
  fire(() => audioMod?.unlockAudio?.());
  fire(() => audioMod?.applyAudioSettings?.(a));
  if (a.voiceEnabled === false && a.beeps === false) {
    toast('Tienes la voz y los pitidos desactivados', { icon: 'speaker-off' });
    return;
  }
  if (a.voiceEnabled !== false && a.packId) {
    if (packStatus[a.packId]?.ok) {
      if (await demoPack(ctx, btn, a.packId)) return;
    } else {
      toast(a.packId === EVA_ID ? 'Lucía aún no está grabada: te habla la voz del sistema' : 'Ese pack no tiene grabaciones: te habla la voz del sistema', { icon: 'info' });
    }
  }
  const token = (ctx.demo = {});
  const alive = () => ctx.demo === token && ctx.alive;
  const name = String(s.profile?.name || '').trim();
  const lv = s.levels || DEFAULT_LEVELS;
  btn?.classList.add('is-busy');
  try {
    if (a.voiceEnabled !== false) await speakNow(`${name ? `¡Vamos, ${name}!` : '¡Vamos!'} En 10 segundos, sube a ${fmt.speed(lv.fast)} kilómetros por hora.`);
    if (!alive()) return;
    if (a.beeps !== false && audioMod?.beep) {
      for (let i = 0; i < 3; i++) {
        fire(() => audioMod.beep('tick'));
        await ctx.sleep(1000);
        if (!alive()) return;
      }
      fire(() => audioMod.beep('go'));
    }
    if (a.voiceEnabled === false) return;
    await speakNow(`¡Ahora! Correr rápido, ${fmt.speed(lv.fast)}. Dos minutos.`);
    if (!alive()) return;
    if (a.chattiness === 'coach') await speakNow('Hombros sueltos, zancada ágil y respira hondo. ¡Esta serie es tuya!');
    else if (a.chattiness !== 'minimal') await speakNow('¡Buen ritmo, sigue así!');
  } finally {
    btn?.classList.remove('is-busy');
  }
}

/* ───────────── MÚSICA ───────────── */

const TIERS = ['calm', 'jog', 'run', 'fast', 'sprint'];
const TIER_FALLBACK = {
  calm: { name: 'Calma', color: 'var(--z-warmup)', range: '90–117', use: 'Calentamiento y vuelta a la calma' },
  jog: { name: 'Trote', color: 'var(--z-jog)', range: '118–125', use: 'Trote y recuperaciones' },
  run: { name: 'Correr', color: 'var(--z-run)', range: '126–133', use: 'Ritmo de carrera' },
  fast: { name: 'Rápido', color: 'var(--z-fast)', range: '134–147', use: 'Series rápidas' },
  sprint: { name: 'Sprint', color: 'var(--z-sprint)', range: '148–190', use: 'Sprints · drum & bass' },
};
const MUSIC_CACHE = 'br-music';
const PREVIEW_SEC = 15;
const MODE_DESC = {
  app: 'Electrónica elegida por BPM para cada tramo y mezclada a compás en cada cambio, como un DJ. Mientras entrenas, Spotify o Apple Music se pausan.',
  own: 'Pon tu Spotify o Apple Music antes de empezar: el coach habla por encima. Quita el modo silencio del iPhone para oírlo (y activa «Bajar tu música cuando hablo» en Voz y audio si quieres que baje mientras habla).',
};
const PHASES = {
  read: 'Leyendo', reading: 'Leyendo', load: 'Leyendo', decode: 'Decodificando', decoding: 'Decodificando',
  resample: 'Preparando', loudness: 'Igualando el volumen', analyze: 'Analizando BPM y compases',
  analyzing: 'Analizando BPM y compases', analysis: 'Analizando BPM y compases', save: 'Guardando', saving: 'Guardando',
  store: 'Guardando', done: 'Lista', skip: 'Ya estaba en tu música', error: 'No se pudo importar', finished: 'Terminando',
};

const isColor = (c) => typeof c === 'string' && /^(#[0-9a-f]{3,8}|var\(--[a-z0-9-]+\)|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(c.trim());
const numOr = (v, d = null) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
// BPM en listas y avisos: entero («112 BPM»); el editor conserva su paso fino en el stepper
const fmtBpm = (b) => {
  const n = numOr(b, 0);
  return n ? String(Math.round(n)) : '–';
};
const fmtMB = (bytes) => {
  const n = numOr(bytes, 0);
  if (n <= 0) return '0 MB';
  if (n < 1024 * 1024) return `${fmt.int(n / 1024)} KB`;
  return `${n >= 100 * 1048576 ? fmt.int(n / 1048576) : fmt.dec1(n / 1048576)} MB`;
};
const isUserTrack = (t) => !!t && (t.user === true || t.source === 'user' || String(t.id).startsWith('u_'));
const tierForBpm = (bpm) => {
  const b = numOr(bpm, 124);
  return b < 118 ? 'calm' : b < 126 ? 'jog' : b < 134 ? 'run' : b < 148 ? 'fast' : 'sprint';
};
const trackTier = (t) => (TIERS.includes(t?.tier) ? t.tier : TIERS.includes(t?.curatedTier) ? t.curatedTier : tierForBpm(t?.bpm));

/** Nombre/color de una zona musical: TIER_INFO de music-library.js si existe, con respaldo local. */
function tierInfo(key) {
  const fb = TIER_FALLBACK[key] || TIER_FALLBACK.jog;
  const src = musicLibMod?.TIER_INFO;
  let t = null;
  if (Array.isArray(src)) t = src.find((x) => x && (x.key === key || x.id === key || x.tier === key)) || null;
  else if (src && typeof src === 'object') t = src[key] || null;
  const name = t && (t.name || t.label || t.title);
  return {
    key,
    name: typeof name === 'string' && name ? name : fb.name,
    color: isColor(t?.color) ? t.color.trim() : fb.color,
    range: fb.range,
    use: typeof t?.desc === 'string' && t.desc ? t.desc : typeof t?.description === 'string' && t.description ? t.description : fb.use,
  };
}

/* Datos de la biblioteca (caché de módulo: sobrevive a los repintados de la página). */
const mlib = { builtIn: null, user: null, loading: null, urls: new Map() };

async function fetchBuiltIn() {
  if (mlib.builtIn) return mlib.builtIn;
  try {
    const r = await fetch('./audio/music/library.json', { cache: 'no-cache' });
    const j = r.ok ? await r.json() : null;
    const list = Array.isArray(j?.tracks) ? j.tracks.filter((t) => t && typeof t.id === 'string') : [];
    if (list.length) mlib.builtIn = list;
    return list;
  } catch {
    return mlib.builtIn || [];
  }
}

async function fetchUserTracks() {
  const mod = await loadMusicImport();
  if (typeof mod?.listUserTracks !== 'function') return [];
  try {
    const list = await mod.listUserTracks();
    return (Array.isArray(list) ? list : []).filter((t) => t && typeof t.id === 'string').map((t) => ({ ...t, user: true }));
  } catch {
    return [];
  }
}

function loadMusicData(force = false) {
  if (force) mlib.loading = null;
  if (!mlib.loading) {
    mlib.loading = Promise.all([fetchBuiltIn(), fetchUserTracks(), loadMusicLib()]).then(([b, u]) => {
      mlib.builtIn = b.length ? b : mlib.builtIn || [];
      mlib.user = u;
      // URLs de las pistas importadas listas de antemano: el play() del preestreno debe ir dentro del gesto
      for (const t of u) {
        if (mlib.urls.has(t.id)) continue;
        Promise.resolve(safe(() => musicImportMod?.userTrackUrl?.(t.id), null))
          .then((url) => { if (typeof url === 'string' && url) mlib.urls.set(t.id, url); })
          .catch(() => {});
      }
      return mlib;
    });
  }
  return mlib.loading;
}

const allTracks = () => [...(mlib.builtIn || []), ...(mlib.user || [])];
const findTrack = (id) => allTracks().find((t) => t.id === id) || null;

function trackUrl(t) {
  if (!t) return null;
  if (isUserTrack(t)) return mlib.urls.get(t.id) || (typeof t.url === 'string' ? t.url : null);
  if (typeof t.url === 'string' && t.url) return t.url;
  const f = String(t.file || `audio/music/${t.id}.m4a`).replace(/^\.?\//, '');
  return `./${f}`;
}

/** Inicio del preestreno: el primer drop; si no hay, el primer bloque «caliente»; si no, el mixIn. */
function previewStart(t) {
  const lib = numOr(safe(() => musicLibMod?.previewStart?.(t), null));
  if (lib != null && lib >= 0) return lib;
  const dur = numOr(t?.duration, 0);
  const cues = t?.cues || {};
  let at = numOr(Array.isArray(cues.drops) ? cues.drops[0] : null);
  if (at == null && Array.isArray(cues.hotBars) && cues.hotBars.length && numOr(t.bpm, 0) > 0) {
    at = numOr(t.barOffset, 0) + cues.hotBars[0] * (240 / Number(t.bpm));
  }
  if (at == null) at = numOr(cues.mixIn, 0);
  return dur > PREVIEW_SEC + 1 ? clamp(at, 0, dur - PREVIEW_SEC) : 0;
}

function energyBars(energy, n = 16) {
  const e = (Array.isArray(energy) ? energy : []).map(Number).filter(Number.isFinite);
  if (!e.length) return '<span class="mu-bars is-empty" aria-hidden="true"></span>';
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * e.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * e.length) / n));
    let mx = 0;
    for (let j = a; j < b && j < e.length; j++) mx = Math.max(mx, e[j]);
    out.push(`<i style="--e:${clamp(mx, 0.08, 1).toFixed(2)}"${mx >= 0.85 ? ' class="is-hot"' : ''}></i>`);
  }
  return `<span class="mu-bars" aria-hidden="true">${out.join('')}</span>`;
}

function trackRow(t, disabled, i) {
  const off = disabled.has(t.id);
  const user = isUserTrack(t);
  const title = String(t.title || t.name || 'Sin título');
  const playing = preview.id === t.id;
  return `<div class="list__row mu-track${off ? ' is-off' : ''}" data-track="${esc(t.id)}">
    <button type="button" class="mu-play${playing ? ' is-playing' : ''}${playing && preview.live ? ' is-live' : ''}" data-preview="${esc(t.id)}" aria-label="Escuchar 15 segundos de ${esc(title)}">
      <span class="mu-play__ring" aria-hidden="true"></span>
      <span class="mu-play__on">${icon('play', 14)}</span><span class="mu-play__off">${icon('stop', 12)}</span>
    </button>
    <span class="mu-track__main">
      <span class="mu-track__title">${esc(title)}</span>
      <span class="mu-track__meta">${user ? '<span class="mu-tag">Tuya</span>' : ''}${esc(t.artist || (user ? 'Importada' : 'Pixabay'))} · <b class="num">${fmtBpm(t.bpm)}</b> BPM</span>
    </span>
    ${energyBars(t.energy)}
    ${user ? `<button type="button" class="mu-more" data-edit-track="${esc(t.id)}" aria-label="Editar ${esc(title)}">${icon('edit', 17)}</button>` : ''}
    <label class="mu-check"><input type="checkbox" id="mu-tr-${i}"${off ? '' : ' checked'} data-track-toggle="${esc(t.id)}" aria-label="Usar ${esc(title)}"><span class="mu-check__mark" aria-hidden="true">${icon('check', 18)}</span></label>
  </div>`;
}

function libraryHtml(s) {
  if (!mlib.builtIn && !mlib.user) {
    return `<div class="list"><div class="list__row st-row"><span class="st-spinner" aria-hidden="true"></span><span class="list__sub">Cargando la biblioteca…</span></div></div>`;
  }
  const m = s.music || {};
  const disabled = new Set(Array.isArray(m.disabled) ? m.disabled : []);
  const tracks = allTracks().filter((t) => (isUserTrack(t) ? m.useImported !== false : m.useBuiltIn !== false));
  if (!tracks.length) {
    return `<div class="card mu-empty">${icon('music', 26)}<b>No hay canciones activas</b><p>Activa «Música incluida» o importa tus canciones para que suene la mezcla.</p></div>`;
  }
  let i = 0;
  return TIERS.map((k) => {
    const list = tracks.filter((t) => trackTier(t) === k).sort((a, b) => numOr(a.bpm, 0) - numOr(b.bpm, 0));
    if (!list.length) return '';
    const info = tierInfo(k);
    const on = list.filter((t) => !disabled.has(t.id)).length;
    return `<div class="st-group mu-tier" style="--tc:${info.color}">
      <div class="mu-tier__head">
        <span class="mu-tier__dot" aria-hidden="true"></span>
        <span class="mu-tier__name">${esc(info.name)}</span>
        <span class="mu-tier__range num">${esc(info.range)} BPM</span>
        <span class="mu-tier__count">${on}/${list.length}</span>
      </div>
      <div class="list">${list.map((t) => trackRow(t, disabled, i++)).join('')}</div>
      <p class="st-note mu-tier__use">${esc(info.use)}</p>
    </div>`;
  }).join('');
}

function heroStatsHtml(s) {
  const m = s.music || {};
  const disabled = new Set(Array.isArray(m.disabled) ? m.disabled : []);
  const active = allTracks().filter((t) => !disabled.has(t.id) && (isUserTrack(t) ? m.useImported !== false : m.useBuiltIn !== false));
  const bpms = active.map((t) => numOr(t.bpm, 0)).filter((b) => b > 0);
  const range = bpms.length ? `${Math.round(Math.min(...bpms))}–${Math.round(Math.max(...bpms))}` : '–';
  const off = offline.status;
  const pct = off && off.total ? Math.round((off.cached / off.total) * 100) : null;
  return `<div><b class="num">${mlib.builtIn || mlib.user ? active.length : '–'}</b><span>Canciones</span></div>
    <div><b class="num">${range}</b><span>BPM</span></div>
    <div><b class="num">${pct == null ? '–' : `${pct} %`}</b><span>Sin conexión</span></div>`;
}

function musicHtml(s) {
  const m = s.music || {};
  const own = m.mode === 'own';
  const vol = Math.round(clamp(numOr(m.volume, 0.8), 0, 1) * 100);
  return `<section class="card mu-hero${own ? ' is-own' : ''}">
      <div class="mu-hero__eq" aria-hidden="true">${'<i></i>'.repeat(9)}</div>
      <div class="eyebrow">DJ RITMUP</div>
      <h2 class="mu-hero__title">Cada tramo, su música</h2>
      <p class="mu-hero__text">Como en una clase de ciclo indoor: el ritmo sube con la intensidad y en cada cambio de tramo mezclamos a compás, sin cortes ni silencios.</p>
      <div class="mu-hero__stats" data-mu-stats>${heroStatsHtml(s)}</div>
    </section>
    <div class="st-group">
      <div class="st-group__title">Qué suena mientras corres</div>
      <div class="card mu-mode">
        <div class="st-seg">${segmented({ name: 'mu-mode', options: [{ value: 'app', label: 'Música RITMUP' }, { value: 'own', label: 'Mi música' }], value: own ? 'own' : 'app' })}</div>
        <p class="mu-mode__desc" data-mu-mode-desc>${MODE_DESC[own ? 'own' : 'app']}</p>
      </div>
    </div>
    <div class="st-group mu-apponly${own ? ' is-dim' : ''}${m.enabled === false ? ' is-off' : ''}" data-mu-apponly>
      <div class="st-group__title">Sonido</div>
      <div class="list">
        ${toggleRow('mu-enabled', 'Música en los entrenamientos', 'También puedes encenderla y apagarla en el reproductor', m.enabled !== false)}
        <div class="list__row st-row st-row--stack mu-volrow" data-mu-dep>
          <div class="mu-vol__head">${label('Volumen de la música')}<span class="mu-vol__val num" data-mu-vol>${vol} %</span></div>
          <div class="mu-vol">
            <span class="mu-vol__ic">${icon('speaker', 16)}</span>
            <input id="mu-volume" class="mu-range" type="range" min="0" max="100" step="1" value="${vol}" style="--v:${vol}%" aria-label="Volumen de la música">
            <span class="mu-vol__ic mu-vol__ic--hi">${icon('speaker', 20)}</span>
          </div>
        </div>
        ${toggleRow('mu-effects', 'Efectos de DJ', 'Subidas de tensión, ecos y barridos de filtro en los cambios', m.effects !== false).replace('<div class="list__row', '<div data-mu-dep class="list__row')}
        ${segRow('Energía', m.energy === 'max' ? 'Pistas más potentes y entradas directas al subidón' : 'Equilibrada: la intensidad sigue a cada tramo', 'mu-energy', [{ value: 'normal', label: 'Normal' }, { value: 'max', label: 'Máxima' }], m.energy === 'max' ? 'max' : 'normal').replace('<div class="list__row', '<div data-mu-dep class="list__row')}
      </div>
      <p class="st-note">80 % es el nivel de partida; al 100 %, algo más fuerte y sin saturar. En plena clase, <b>mantén pulsado ♪</b> para ajustarla. Cuando habla el coach la música baja un momento; los pitidos suenan siempre por encima.</p>
    </div>
    <div class="st-group">
      <div class="st-group__title">Fuentes</div>
      <div class="list">
        ${toggleRow('mu-builtin', 'Usar música incluida', 'Electrónica seleccionada de Pixabay, lista para mezclar', m.useBuiltIn !== false)}
        ${toggleRow('mu-imported', 'Usar mi música', 'Las canciones que importes desde la app Archivos', m.useImported !== false)}
      </div>
    </div>
    <div class="st-group">
      <div class="st-group__title">Importar canciones</div>
      <section class="card mu-import">
        <div class="mu-import__top">
          <p>Elige canciones de la app <b>Archivos</b> (MP3, M4A, WAV…). Las analizamos aquí mismo —BPM, compases y drops— para mezclarlas a tempo. No salen de tu iPhone.</p>
        </div>
        <label class="btn btn--secondary btn--block mu-import__btn${importJob?.running ? ' is-busy' : ''}" for="mu-files">
          <span>${importJob?.running ? 'Importando…' : 'Importar canciones'}</span>
          <input id="mu-files" class="st-file" type="file" accept="audio/*" multiple${importJob?.running ? ' disabled' : ''}>
        </label>
        <div class="mu-import__job" data-mu-import>${importJobHtml()}</div>
      </section>
    </div>
    <div class="st-group">
      <div class="st-group__title">Biblioteca por zonas</div>
      <p class="st-note mu-lib__note">Toca ${icon('play', 11)} para escuchar 15\u00a0s desde el drop. Desactiva las que no te gusten: no volverán a sonar.</p>
    </div>
    <div class="mu-lib" data-mu-library>${libraryHtml(s)}</div>
    <div class="st-group">
      <div class="st-group__title">Sin conexión</div>
      <section class="card mu-offline" data-mu-offline>${offlineHtml()}</section>
    </div>
    <div class="st-group">
      <div class="st-group__title">Créditos de la música</div>
      <div class="card mu-credits" data-mu-credits>${creditsHtml()}</div>
    </div>`;
}

function creditsHtml() {
  const list = mlib.builtIn || [];
  if (!list.length) return '<p class="mu-credits__intro">Música de Pixabay.</p>';
  const rows = list.map((t) => {
    const page = typeof t.page === 'string' && /^https:\/\//i.test(t.page) ? t.page : '';
    const txt = `<b>${esc(t.title || t.id)}</b><span>${esc(t.artist || 'Pixabay')}</span>`;
    return page
      ? `<li><a href="${esc(page)}" target="_blank" rel="noopener noreferrer">${txt}${icon('external', 14)}</a></li>`
      : `<li><span class="mu-credits__row">${txt}</span></li>`;
  }).join('');
  return `<p class="mu-credits__intro">Pistas de <b>Pixabay</b> bajo la ${esc(list[0]?.license || 'Pixabay Content License')}. Gracias a sus artistas:</p><ul class="mu-credits__list">${rows}</ul>`;
}

/* ── Preestreno de 15 s (un <audio> ligero, fuera del motor DJ) ── */
const preview = { audio: null, id: null, timer: 0, fade: 0, live: false, onChange: null };

function stopPreview() {
  const a = preview.audio;
  clearTimeout(preview.timer);
  clearInterval(preview.fade);
  preview.audio = null;
  preview.id = null;
  preview.live = false;
  if (a) {
    try { a.pause(); } catch { /* nada */ }
    try { a.removeAttribute('src'); a.load(); } catch { /* nada */ }
  }
  preview.onChange?.();
}

function startPreview(t) {
  stopPreview();
  const url = trackUrl(t);
  if (!url) {
    toast('Esa canción aún se está preparando. Prueba en un momento', { icon: 'music' });
    return;
  }
  const at = previewStart(t);
  const a = new Audio();
  a.preload = 'auto';
  try { a.preservesPitch = true; a.webkitPreservesPitch = true; } catch { /* nada */ }
  // Fragmento temporal (#t=) + respaldo en loadedmetadata: empieza justo en el drop
  a.src = `${url}${url.startsWith('blob:') ? '' : `#t=${at.toFixed(2)}`}`;
  a.addEventListener('loadedmetadata', () => {
    try { if (Math.abs(a.currentTime - at) > 1) a.currentTime = at; } catch { /* nada */ }
  }, { once: true });
  a.addEventListener('playing', () => {
    if (preview.audio !== a) return;
    preview.live = true;
    preview.onChange?.();
  });
  a.addEventListener('ended', () => { if (preview.audio === a) stopPreview(); });
  a.addEventListener('error', () => {
    if (preview.audio !== a) return;
    stopPreview();
    toast('No he podido reproducir esa canción', { kind: 'error' });
  });
  preview.audio = a;
  preview.id = t.id;
  sessionType('playback');
  const p = safe(() => a.play(), null);
  if (p && typeof p.catch === 'function') {
    p.catch(() => {
      if (preview.audio !== a) return;
      stopPreview();
      toast('Toca otra vez para escuchar', { icon: 'music' });
    });
  }
  preview.timer = setTimeout(() => {
    if (preview.audio !== a) return;
    // Fundido final donde el navegador deja cambiar el volumen (en iOS es fijo y se corta limpio)
    let v = 1;
    preview.fade = setInterval(() => {
      v -= 0.12;
      try { a.volume = Math.max(0, v); } catch { /* nada */ }
      if (v <= 0) stopPreview();
    }, 90);
  }, (PREVIEW_SEC - 1) * 1000);
  preview.onChange?.();
}

function markPreview(ctx) {
  ctx.body.querySelectorAll('.mu-play[data-preview]').forEach((b) => {
    const on = b.dataset.preview === preview.id;
    b.classList.toggle('is-playing', on);
    b.classList.toggle('is-live', on && preview.live);
  });
}

/* ── Importación ── */
let importJob = null; // { running, total, index, name, phase, frac, results, error }

/** Progreso tolerante: { total, index, name, phase, message, frac (del elemento), overall (global 0..1) }. */
function readProgress(args) {
  const [a, b, c] = args;
  const out = {};
  if (a && typeof a === 'object') {
    out.total = numOr(a.total ?? a.count ?? a.of ?? a.n);
    out.index = numOr(a.index ?? a.i ?? a.current ?? a.done ?? a.fileIndex);
    out.name = a.name ?? a.fileName ?? a.file?.name ?? a.title;
    out.phase = a.phase ?? a.stage ?? a.step ?? a.status ?? a.label;
    if (typeof a.message === 'string') out.message = a.message;
    if (a.fileProgress != null) {
      out.frac = numOr(a.fileProgress);
      out.overall = numOr(a.progress);
    } else if (a.fraction != null) out.overall = numOr(a.fraction);
    else out.frac = numOr(a.progress ?? a.pct ?? a.percent ?? a.value);
    if (out.overall != null && out.overall > 1.0001) out.overall /= 100;
  } else if (typeof a === 'number') {
    if (typeof b === 'number' && b > 0) {
      out.index = a;
      out.total = b;
      if (c && typeof c === 'object') Object.assign(out, readProgress([c]), { index: a, total: b });
      else if (typeof c === 'string') out.phase = c;
    } else out.frac = a;
  } else if (typeof a === 'string') out.phase = a;
  if (out.frac != null && out.frac > 1.0001) out.frac /= 100;
  return out;
}

function importJobHtml() {
  const j = importJob;
  if (!j) return '';
  if (j.running) {
    const total = Math.max(1, j.total || 1);
    const idx = clamp(j.index || 0, 0, total);
    const overall = clamp(j.overall ?? (Math.min(idx, total - 1) + clamp(j.frac ?? 0, 0, 1)) / total, 0, 1);
    const phase = PHASES[String(j.phase || '').toLowerCase()] || (j.phase ? capitalize(String(j.phase)) : 'Analizando');
    const detail = [j.name, j.message].filter(Boolean).map(String).join(' · ');
    return `<div class="mu-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(overall * 100)}">
        <div class="mu-progress__top"><span class="st-spinner" aria-hidden="true"></span><b>${esc(phase)}</b><span class="num">${Math.min(idx + 1, total)}/${total}</span></div>
        <div class="mu-progress__bar"><i style="--p:${overall.toFixed(3)}"></i></div>
        ${detail ? `<span class="mu-progress__file">${esc(detail)}</span>` : ''}
      </div>`;
  }
  const res = Array.isArray(j.results) ? j.results : [];
  const ok = res.filter((t) => t && t.id && !t.error);
  const bad = [...res.filter((t) => t && t.error), ...(Array.isArray(j.errors) ? j.errors : []).map((e) => ({ name: e?.name, error: e?.message || 'No se pudo importar' }))];
  const closeBtn = `<button type="button" class="mu-result__close" data-mu-clear aria-label="Cerrar">${icon('close', 14)}</button>`;
  const head = j.error
    ? `<div class="mu-result__head is-error">${icon('warning', 16)}<span>${esc(j.error)}</span></div>`
    : !ok.length && bad.length
      ? `<div class="mu-result__head is-error">${icon('warning', 16)}<span>${bad.length === 1 ? 'No se pudo importar la canción' : 'No se pudo importar ninguna canción'}</span>${closeBtn}</div>`
      : `<div class="mu-result__head">${icon('check-circle', 16)}<span>${ok.length === 1 ? '1 canción importada' : `${ok.length} canciones importadas`}${bad.length ? ` · ${bad.length} con error` : ''}</span>${closeBtn}</div>`;
  const rows = ok.map((t) => {
    const info = tierInfo(trackTier(t));
    return `<li class="mu-result__row" style="--tc:${info.color}">
      <span class="mu-result__main"><b>${esc(t.title || t.name || 'Canción')}</b><span><b class="num">${fmtBpm(t.bpm)}</b> BPM · <span class="mu-result__tier">${esc(info.name)}</span></span></span>
      <button type="button" class="btn btn--secondary mu-result__btn" data-edit-track="${esc(t.id)}">${icon('edit', 15)}<span>Editar</span></button>
      <button type="button" class="mu-more mu-more--danger" data-del-track="${esc(t.id)}" aria-label="Eliminar ${esc(t.title || 'canción')}">${icon('trash', 16)}</button>
    </li>`;
  }).join('');
  const errs = bad.map((t) => `<li class="mu-result__row is-error"><span class="mu-result__main"><b>${esc(t.name || t.title || 'Archivo')}</b><span>${esc(t.error)}</span></span></li>`).join('');
  return `<div class="mu-result">${head}${rows || errs ? `<ul class="mu-result__list">${rows}${errs}</ul>` : ''}${ok.length ? '<p class="st-note mu-result__note">Revisa el BPM: si suena el doble o la mitad de rápido, corrígelo tocando al ritmo.</p>' : ''}</div>`;
}

let musicCtx = null; // contexto vivo de la página Música (para pintar trabajos que acaban tras salir y volver)

function paintMusic(part) {
  const ctx = musicCtx;
  if (!ctx?.alive) return;
  const s = getState();
  const set = (sel, html) => { const n = ctx.body.querySelector(sel); if (n) n.innerHTML = html; };
  if (!part || part === 'library') set('[data-mu-library]', libraryHtml(s));
  if (!part || part === 'library' || part === 'stats') set('[data-mu-stats]', heroStatsHtml(s));
  if (!part || part === 'import') {
    set('[data-mu-import]', importJobHtml());
    const btn = ctx.body.querySelector('.mu-import__btn');
    if (btn) {
      btn.classList.toggle('is-busy', !!importJob?.running);
      const sp = btn.querySelector('span');
      if (sp) sp.textContent = importJob?.running ? 'Importando…' : 'Importar canciones';
      const inp = btn.querySelector('input');
      if (inp) inp.disabled = !!importJob?.running;
    }
  }
  if (!part || part === 'offline') set('[data-mu-offline]', offlineHtml());
  if (!part || part === 'credits') set('[data-mu-credits]', creditsHtml());
  markPreview(ctx);
}

async function runImport(files) {
  const list = files ? Array.from(files) : [];
  if (!list.length || importJob?.running) return;
  const mod = await loadMusicImport();
  if (typeof mod?.importFiles !== 'function') {
    haptic('error');
    toast('La importación aún no está disponible en esta versión de la app', { kind: 'error' });
    return;
  }
  importJob = { running: true, total: list.length, index: 0, name: list[0]?.name || '', phase: 'read', frac: 0, overall: null, message: '', results: [] };
  paintMusic('import');
  let res = null;
  try {
    res = await mod.importFiles(list, (...args) => {
      if (!importJob?.running) return;
      const p = readProgress(args);
      if (p.total) importJob.total = p.total;
      if (p.index != null) importJob.index = p.index;
      if (p.name) importJob.name = String(p.name);
      if (p.phase) importJob.phase = String(p.phase);
      if (p.frac != null) importJob.frac = p.frac;
      if (p.overall != null) importJob.overall = p.overall;
      importJob.message = p.message || '';
      paintMusic('import');
    });
    const list2 = Array.isArray(res) ? res : [];
    importJob = { running: false, results: list2.filter(Boolean), errors: Array.isArray(res?.errors) ? res.errors : [] };
  } catch (e) {
    importJob = { running: false, results: [], error: `No he podido importar: ${String(e?.message || 'formato no compatible').slice(0, 120)}` };
  }
  const ok = (importJob.results || []).filter((t) => t && t.id && !t.error).length;
  haptic(ok ? 'success' : 'error');
  if (!musicCtx?.alive) toast(ok ? `${ok} ${ok === 1 ? 'canción importada' : 'canciones importadas'} a tu música` : 'No se importó ninguna canción', { icon: 'music' });
  await loadMusicData(true);
  paintMusic();
}

/* ── Editar pista importada: BPM, tap tempo y zona ── */
function openTrackSheet(id) {
  const t = findTrack(id);
  if (!t || !isUserTrack(t)) return;
  let bpm = numOr(t.bpm, 124);
  let tier = trackTier(t);
  let bpmSource = 'manual';
  const taps = [];
  const title = String(t.title || t.name || 'Canción');
  const bpmStepper = (v) => stepper({ id: 'mu-bpm', value: Math.round(v * 2) / 2, step: 0.5, min: 60, max: 200, unit: 'BPM', decimals: 1 });
  openSheet({
    title: 'Editar canción',
    html: `<div class="mu-edit">
      <div class="mu-edit__head">
        <span class="mu-edit__art">${icon('music', 22)}</span>
        <span class="mu-edit__name"><b>${esc(title)}</b><span>${esc(t.artist || 'Importada')}</span></span>
        <button type="button" class="mu-play" data-preview="${esc(t.id)}" aria-label="Escuchar">
          <span class="mu-play__ring" aria-hidden="true"></span>
          <span class="mu-play__on">${icon('play', 14)}</span><span class="mu-play__off">${icon('stop', 12)}</span>
        </button>
      </div>
      <div class="mu-edit__block">
        <div class="eyebrow">Tempo</div>
        <div class="mu-edit__bpm"><span class="st-slot" data-mu-bpm>${bpmStepper(bpm)}</span>
          <span class="mu-edit__x"><button type="button" data-bpm-x="0.5">½×</button><button type="button" data-bpm-x="2">2×</button></span>
        </div>
        <button type="button" class="mu-tap" data-tap aria-label="Tap tempo: toca al ritmo">
          <span class="mu-tap__big">TOCA AL RITMO</span>
          <span class="mu-tap__sub" data-tap-info>Pon la canción y toca al ritmo del bombo</span>
        </button>
      </div>
      <div class="mu-edit__block">
        <div class="eyebrow">Zona</div>
        <div class="st-seg">${segmented({ name: 'mu-tier', options: TIERS.map((k) => ({ value: k, label: tierInfo(k).name })), value: tier })}</div>
        <p class="st-note mu-edit__hint" data-tier-hint>${esc(tierInfo(tier).use)}</p>
      </div>
    </div>`,
    actions: [
      {
        label: 'Guardar',
        kind: 'primary',
        async onClick(close) {
          const mod = await loadMusicImport();
          try {
            await mod?.updateUserTrack?.(t.id, { bpm: Math.round(bpm * 100) / 100, bpmSource, tier });
            haptic('success');
            toast(`«${title}» · ${fmtBpm(bpm)} BPM`, { icon: 'check', kind: 'success' });
          } catch (e) {
            toast(e?.message ? String(e.message) : 'No he podido guardar los cambios', { kind: 'error' });
          }
          stopPreview();
          close();
          if (importJob && !importJob.running) {
            importJob.results = (importJob.results || []).map((r) => (r && r.id === t.id ? { ...r, bpm, tier } : r));
          }
          await loadMusicData(true);
          paintMusic();
        },
      },
      {
        label: 'Eliminar canción',
        kind: 'destructive',
        async onClick(close) {
          stopPreview();
          close();
          await removeUserTrack(t.id, title);
        },
      },
    ],
    onMount(el) {
      const info = el.querySelector('[data-tap-info]');
      const pad = el.querySelector('[data-tap]');
      const setBpm = (v, repaint = true, source = 'manual') => {
        bpmSource = source;
        bpm = clamp(Math.round(v * 2) / 2, 60, 200);
        if (repaint) { const slotEl = el.querySelector('[data-mu-bpm]'); if (slotEl) slotEl.innerHTML = bpmStepper(bpm); }
      };
      el.addEventListener('change', (e) => {
        const d = e.detail;
        if (!d || typeof d !== 'object') return;
        if (d.id === 'mu-bpm') setBpm(Number(d.value) || bpm, false);
        else if (d.name === 'mu-tier' && TIERS.includes(d.value)) {
          tier = d.value;
          haptic('selection');
          const h = el.querySelector('[data-tier-hint]');
          if (h) h.textContent = tierInfo(tier).use;
        }
      });
      el.addEventListener('click', (e) => {
        const x = e.target.closest('[data-bpm-x]');
        if (x) {
          haptic('selection');
          setBpm(bpm * Number(x.dataset.bpmX));
          return;
        }
        const pv = e.target.closest('[data-preview]');
        if (pv) {
          haptic('light');
          if (preview.id === t.id) stopPreview();
          else startPreview(t);
        }
      });
      // Tap tempo: mediana de los intervalos de los últimos 16 toques
      pad?.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const now = performance.now();
        if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
        taps.push(now);
        if (taps.length > 16) taps.shift();
        haptic('light');
        pad.classList.remove('is-hit');
        void pad.offsetWidth;
        pad.classList.add('is-hit');
        if (taps.length < 4) {
          if (info) info.textContent = `Sigue tocando… (${taps.length})`;
          return;
        }
        const gaps = taps.slice(1).map((v, i) => v - taps[i]).sort((a, b) => a - b);
        const med = gaps[Math.floor(gaps.length / 2)];
        let v = 60000 / med;
        while (v < 80) v *= 2;
        while (v > 200) v /= 2;
        setBpm(v, true, 'tap');
        if (info) info.textContent = `${fmtBpm(bpm)} BPM · ${taps.length} toques`;
      });
      const prevChange = preview.onChange;
      const mark = () => {
        el.querySelectorAll('.mu-play[data-preview]').forEach((b) => {
          b.classList.toggle('is-playing', preview.id === b.dataset.preview);
          b.classList.toggle('is-live', preview.id === b.dataset.preview && preview.live);
        });
        prevChange?.();
      };
      preview.onChange = mark;
    },
    onClose() {
      stopPreview();
      preview.onChange = () => { if (musicCtx?.alive) markPreview(musicCtx); };
    },
  });
}

async function removeUserTrack(id, title) {
  const yes = await confirmDialog({
    title: '¿Eliminar la canción?',
    message: `«${title}» se borrará de RITMUP (el archivo original sigue en Archivos).`,
    confirmText: 'Eliminar',
    cancelText: 'Cancelar',
    destructive: true,
  });
  if (!yes) return;
  const mod = await loadMusicImport();
  try {
    await mod?.deleteUserTrack?.(id);
    setState((d) => {
      if (d.music && Array.isArray(d.music.disabled)) d.music.disabled = d.music.disabled.filter((x) => x !== id);
    });
    mlib.urls.delete(id);
    if (importJob && !importJob.running) {
      importJob.results = (importJob.results || []).filter((r) => r && r.id !== id);
      if (!importJob.results.length && !importJob.errors?.length && !importJob.error) importJob = null;
    }
    haptic('success');
    toast('Canción eliminada', { icon: 'trash' });
  } catch {
    toast('No he podido eliminarla', { kind: 'error' });
  }
  await loadMusicData(true);
  paintMusic();
}

/* ── Sin conexión: Cache API 'br-music' (y la voz de Eva en 'br-audio') ── */
const offline = { status: null, job: null, usage: null };

const absUrl = (u) => safe(() => new URL(u, location.href).href, u);

function normalizeOffline(r) {
  if (!r || typeof r !== 'object') return null;
  const cached = numOr(r.cached ?? r.cachedCount ?? r.done ?? r.ready ?? r.count);
  const total = numOr(r.total ?? r.totalCount ?? r.of ?? r.tracks);
  if (cached == null || total == null || !total) return null;
  return {
    cached, total,
    bytes: numOr(r.bytes ?? r.cachedBytes ?? r.size ?? r.usedBytes, null),
    totalBytes: numOr(r.totalBytes ?? r.libraryBytes ?? r.fullBytes, null),
  };
}

async function privateOfflineStatus() {
  const list = mlib.builtIn || (await fetchBuiltIn());
  const total = list.length;
  const totalBytes = list.reduce((a, t) => a + (numOr(t.sizeBytes, 0) || 0), 0);
  if (!total || typeof caches === 'undefined') return { cached: 0, total, bytes: 0, totalBytes };
  let cached = 0;
  let bytes = 0;
  try {
    const cache = await caches.open(MUSIC_CACHE);
    for (const t of list) {
      const hit = await cache.match(absUrl(trackUrl(t)), { ignoreSearch: true, ignoreVary: true });
      if (hit) { cached++; bytes += numOr(t.sizeBytes, 0) || 0; }
    }
  } catch { /* sin Cache API */ }
  return { cached, total, bytes, totalBytes };
}

async function refreshOfflineStatus() {
  let st = null;
  try {
    const lib = await loadMusicLib();
    if (typeof lib?.offlineStatus === 'function') st = normalizeOffline(await lib.offlineStatus());
  } catch { st = null; }
  if (!st) st = await privateOfflineStatus();
  if (st.totalBytes == null) st.totalBytes = (mlib.builtIn || []).reduce((a, t) => a + (numOr(t.sizeBytes, 0) || 0), 0);
  offline.status = st;
  try {
    const est = await navigator.storage?.estimate?.();
    offline.usage = numOr(est?.usage, null);
  } catch { offline.usage = null; }
  paintMusic('offline');
  paintMusic('stats');
}

function offlineHtml() {
  const st = offline.status;
  const job = offline.job;
  const full = st && st.total && st.cached >= st.total;
  const pct = job ? clamp(job.frac || 0, 0, 1) : st && st.total ? st.cached / st.total : 0;
  const statusLine = !st
    ? 'Comprobando qué hay guardado…'
    : full ? `Las ${st.total} pistas están en tu iPhone${st.totalBytes ? ` · ${fmtMB(st.totalBytes)}` : ''}`
      : `${st.cached} de ${st.total} pistas guardadas${st.totalBytes ? ` · ${fmtMB(st.bytes || 0)} de ${fmtMB(st.totalBytes)}` : ''}`;
  return `<div class="mu-offline__top">
      <span class="mu-offline__icon${full ? ' is-ok' : ''}">${icon(full ? 'check-circle' : 'download', 24)}</span>
      <div class="mu-offline__txt"><b>${full ? 'Lista para entrenar sin red' : 'Música para el gimnasio sin cobertura'}</b><span data-mu-off-line>${esc(job ? job.text || 'Descargando…' : statusLine)}</span></div>
    </div>
    <div class="mu-progress__bar mu-offline__bar${job ? ' is-active' : ''}"><i style="--p:${pct.toFixed(3)}"></i></div>
    <button type="button" class="btn ${full ? 'btn--secondary' : 'btn--primary'} btn--block mu-offline__btn" data-st="mu-offline"${job ? ' disabled' : ''}>
      ${icon(full ? 'refresh' : 'download', 18)}<span>${job ? 'Descargando…' : full ? 'Comprobar de nuevo' : 'Descargar música para usar sin conexión'}</span>
    </button>
    ${offline.usage ? `<p class="st-note mu-offline__usage">RITMUP ocupa ${fmtMB(offline.usage)} en este iPhone (música, voz y datos).</p>` : ''}`;
}

async function privateCacheAll(onProgress) {
  const list = mlib.builtIn || (await fetchBuiltIn());
  const cache = await caches.open(MUSIC_CACHE);
  const totalBytes = list.reduce((a, t) => a + (numOr(t.sizeBytes, 0) || 0), 0) || 1;
  let done = 0;
  let failed = 0;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const url = absUrl(trackUrl(t));
    try {
      const hit = await cache.match(url, { ignoreSearch: true, ignoreVary: true });
      if (!hit) {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await cache.put(url, res);
      }
    } catch {
      failed++;
    }
    done += numOr(t.sizeBytes, 0) || 0;
    onProgress({ index: i + 1, total: list.length, fraction: done / totalBytes, name: t.title });
  }
  if (failed) throw new Error(`${failed} pistas sin descargar`);
}

/** Clips del pack de voz al caché de audio, para que Eva también hable sin conexión. */
async function cachePackClips(packId, onProgress) {
  const idx = await fetchPackIndex(packId);
  if (!idx?.ok || typeof caches === 'undefined') return;
  const cache = await caches.open('br-audio');
  const ids = [...idx.ids];
  const base = `./audio/packs/${encodeURIComponent(packId)}/`;
  let n = 0;
  const worker = async () => {
    while (ids.length) {
      const id = ids.shift();
      const url = absUrl(`${base}${encodeURIComponent(id)}.mp3`);
      try {
        if (!(await cache.match(url))) {
          const r = await fetch(url);
          if (r.ok) await cache.put(url, r);
        }
      } catch { /* clip suelto: se bajará al usarlo */ }
      n++;
      onProgress(n / idx.count);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

async function downloadOffline() {
  if (offline.job) return;
  if (typeof caches === 'undefined') {
    toast('Este navegador no permite guardar música sin conexión', { kind: 'error' });
    return;
  }
  offline.job = { frac: 0, text: 'Preparando la descarga…' };
  paintMusic('offline');
  const lib = await loadMusicLib();
  const packId = getState().audio?.packId;
  const withVoice = !!packId && !!(await fetchPackIndex(packId))?.ok;
  const share = withVoice ? 0.9 : 1;
  let ok = true;
  const onMusic = (...args) => {
    const p = readProgress(args);
    let frac = p.overall ?? p.frac;
    if (frac == null && p.total) frac = (p.index || 0) / p.total;
    offline.job.frac = clamp((frac || 0) * share, 0, 1);
    offline.job.text = p.total ? `Descargando música · ${Math.min(p.index || 0, p.total)} de ${p.total} pistas` : 'Descargando música…';
    paintMusic('offline');
  };
  try {
    const r = typeof lib?.cacheAllForOffline === 'function' ? await lib.cacheAllForOffline(onMusic) : await privateCacheAll(onMusic);
    if (r && typeof r === 'object' && r.ok === false) ok = false;
  } catch {
    ok = false;
  }
  if (withVoice) {
    offline.job.text = 'Guardando la voz del coach…';
    paintMusic('offline');
    try {
      await cachePackClips(packId, (f) => { offline.job.frac = share + f * (1 - share); paintMusic('offline'); });
    } catch { /* la voz se bajará al usarla */ }
  }
  offline.job = null;
  haptic(ok ? 'success' : 'warning');
  toast(ok ? 'Música guardada: ya puedes entrenar sin conexión' : 'Faltan algunas pistas: vuelve a intentarlo con wifi', ok ? { icon: 'check', kind: 'success' } : { icon: 'wifi' });
  await refreshOfflineStatus();
}

function saveMusic(ctx, fn) {
  ctx.save((d) => {
    d.music = d.music && typeof d.music === 'object' ? d.music : {};
    fn(d.music);
  });
}

/** Aviso compuesto con clips del pack (sin mezclar con TTS). true si ha sonado. */
async function demoPack(ctx, btn, packId) {
  const [vp, am, idx] = await Promise.all([loadVoicePack(), audioMod ? Promise.resolve(audioMod) : loadAudio(), fetchPackIndex(packId)]);
  if (typeof vp?.composeCue !== 'function' || typeof am?.playClips !== 'function' || !idx?.ok) return false;
  let res = null;
  try { res = await am.loadPack?.(packId); } catch { res = null; }
  if (!res?.ok) return false;
  const s = getState();
  const a = s.audio || {};
  const lv = s.levels || DEFAULT_LEVELS;
  const pick = (l) => l[Math.floor(Math.random() * l.length)];
  const opts = { pick, available: idx.ids };
  const compose = (kind, vars) => safe(() => vp.composeCue(kind, vars, opts), null);
  const pre = compose('pre', { speed: lv.fast, dir: 'up', zone: 'fast' });
  const now = compose('now', { zone: 'fast', speed: lv.fast, sec: 120 });
  const extra = a.chattiness === 'minimal' ? null : compose('motivation', { hard: a.chattiness === 'coach' });
  if (!pre && !now) return false;
  const token = (ctx.demo = {});
  const alive = () => ctx.demo === token && ctx.alive;
  // Si un aviso no puede sonar con clips (archivo aún no subido), ese aviso entero lo dice la voz del sistema
  const play = async (ids) => {
    if (!ids || !alive()) return;
    try {
      await am.playClips(ids);
    } catch {
      const text = safe(() => vp.clipsText?.(ids), '');
      if (text && alive()) await speakNow(text);
    }
  };
  btn?.classList.add('is-busy');
  try {
    await play(pre);
    if (!alive()) return true;
    if (a.beeps !== false && am.beep) {
      for (let i = 0; i < 3; i++) {
        fire(() => am.beep('tick'));
        await ctx.sleep(1000);
        if (!alive()) return true;
      }
      fire(() => am.beep('go'));
    }
    await play(now);
    await play(extra);
  } finally {
    btn?.classList.remove('is-busy');
  }
  return true;
}

/* ───────────── controladores por página ───────────── */

function applyAudio() {
  const a = getState().audio;
  fire(() => audioMod?.applyAudioSettings?.(a));
}

function updateAudioChecks(ctx, attr, value) {
  ctx.body.querySelectorAll(`[${attr}]`).forEach((r) => {
    const on = r.getAttribute(attr) === (value || '');
    r.classList.toggle('is-on', on);
    r.setAttribute('aria-pressed', String(on));
  });
}

async function selectPack(id, ctx) {
  ctx.save((d) => { d.audio.packId = id || null; });
  updateAudioChecks(ctx, 'data-pack', id);
  paintPackHint(ctx);
  haptic('selection');
  if (!id) {
    toast('Usaremos la voz del sistema', { icon: 'speaker' });
    return;
  }
  const mod = audioMod || (await loadAudio());
  let res = null;
  try {
    res = await mod?.loadPack?.(id);
  } catch {
    res = null;
  }
  if (res?.ok) {
    toast(`Voz «${packName({ id, name: res.name })}» lista${res.count ? ` · ${fmt.int(res.count)} frases` : ''}`, { icon: 'check', kind: 'success' });
  } else if (id === EVA_ID) {
    // Eva sigue elegida: en cuanto lleguen sus grabaciones se usarán solas
    toast('Las grabaciones de Lucía aún no están: hasta entonces hablará la voz del sistema', { icon: 'info', duration: 4200 });
  } else {
    ctx.save((d) => { d.audio.packId = null; });
    updateAudioChecks(ctx, 'data-pack', '');
    toast('No he podido cargar ese pack de voz', { kind: 'error' });
  }
  paintPackHint(ctx);
}

function paintPackHint(ctx) {
  const h = ctx.body.querySelector('[data-pack-hint]');
  if (h) h.innerHTML = packHintHtml(getState());
}

const PAGES = {
  root: { render: rootHtml },

  profile: {
    render: profileHtml,
    handle(id, v, ctx) {
      const refreshZones = () => {
        const host = ctx.body.querySelector('[data-hrzones]');
        if (host) host.innerHTML = hrZonesHtml(getState());
        const foot = ctx.body.querySelector('[data-hrzones-foot]');
        if (foot) foot.textContent = hrZonesFoot(getState());
      };
      if (id === 'st-name') {
        ctx.save((d) => { d.profile.name = String(v || '').trim().slice(0, 30); });
      } else if (id === 'st-age') {
        const age = Math.round(Number(v)) || 46;
        const prev = getState().profile || {};
        const wasAuto = !prev.hrMax || prev.hrMax === hrMaxFromAge(prev.age || 46);
        ctx.save((d) => {
          d.profile.age = age;
          if (wasAuto) d.profile.hrMax = hrMaxFromAge(age);
        });
        const lab = ctx.body.querySelector('[data-hr-auto]');
        if (lab) lab.textContent = `${hrMaxFromAge(age)} ppm`;
        if (wasAuto) ctx.setSlot('st-hrmax', stepper({ id: 'st-hrmax', value: hrMaxFromAge(age), step: 1, min: 120, max: 220, unit: 'ppm', decimals: 0 }));
        refreshZones();
      } else if (id === 'st-weight') {
        ctx.save((d) => { d.profile.weightKg = round1(Number(v)) || 78; });
      } else if (id === 'st-sex') {
        haptic('selection');
        ctx.save((d) => { d.profile.sex = v === 'f' ? 'f' : 'm'; });
      } else if (id === 'st-hrmax') {
        ctx.save((d) => { d.profile.hrMax = Math.round(Number(v)) || hrMaxFromAge(d.profile.age || 46); });
        refreshZones();
      } else if (id === 'st-hrrest') {
        const t = String(v || '').trim();
        const n = Number.parseInt(t, 10);
        const input = ctx.body.querySelector('#st-hrrest');
        if (t && (!Number.isFinite(n) || n < 30 || n > 110)) {
          haptic('error');
          toast('La FC en reposo suele estar entre 30 y 110\u00a0ppm', { kind: 'error', icon: 'heart' });
          if (input) input.value = getState().profile?.hrRest || '';
          return;
        }
        ctx.save((d) => { d.profile.hrRest = t ? n : null; });
        refreshZones();
      }
    },
    input(id, v, ctx) {
      if (id === 'st-name') ctx.debounced('name', () => ctx.save((d) => { d.profile.name = String(v || '').trim().slice(0, 30); }));
    },
    action(name, el, ctx) {
      if (name !== 'hr-auto') return;
      const age = getState().profile?.age || 46;
      const hr = hrMaxFromAge(age);
      ctx.save((d) => { d.profile.hrMax = hr; });
      ctx.setSlot('st-hrmax', stepper({ id: 'st-hrmax', value: hr, step: 1, min: 120, max: 220, unit: 'ppm', decimals: 0 }));
      const host = ctx.body.querySelector('[data-hrzones]');
      if (host) host.innerHTML = hrZonesHtml(getState());
      haptic('success');
      toast(`FC máxima: ${hr} ppm (por edad)`, { icon: 'heart' });
    },
  },

  speeds: {
    render: speedsHtml,
    init(ctx) {
      ctx.shown = { ...(getState().levels || DEFAULT_LEVELS) };
    },
    handle(id, raw, ctx) {
      const m = /^st-lv-(\w+)$/.exec(id);
      if (!m || !LEVEL_KEYS.includes(m[1])) return;
      const k = m[1];
      const s = getState();
      const tm = s.treadmill || {};
      const minS = tm.minSpeed ?? 1;
      const maxS = tm.maxSpeed ?? 18;
      let v = round1(clamp(Number(raw), minS, maxS));
      const cur = { ...(s.levels || DEFAULT_LEVELS) };
      let next = enforceLevelOrder({ ...cur, [k]: v });
      const warn = (msg) => {
        if (Date.now() - (ctx.lastWarn || 0) < 2200) return;
        ctx.lastWarn = Date.now();
        haptic('warning');
        toast(msg, { icon: 'info' });
      };
      if (LEVEL_KEYS.some((x) => next[x] > maxS)) {
        // No cabe en la cinta: rebote al valor actual.
        warn(`Con ese valor el sprint superaría el máximo de tu cinta (${fmt.speed(maxS)} km/h)`);
        ctx.shown[k] = cur[k];
        ctx.setSlot(`st-lv-${k}`, levelStepper(k, cur[k], tm));
        return;
      }
      let bounced = false;
      if (next[k] !== v) {
        // Por debajo del nivel anterior + separación mínima: se queda en el mínimo permitido.
        const i = LEVEL_KEYS.indexOf(k);
        warn(`${ZONES[k]?.name || k} debe ir al menos ${fmt.dec1(MIN_LEVEL_GAP)} km/h por encima de ${ZONES[LEVEL_KEYS[i - 1]]?.name || 'el anterior'}`);
        v = next[k];
        bounced = true;
      }
      ctx.save((d) => {
        d.levels = { ...d.levels, ...next };
        logManualLevels(d);
      });
      for (const x of LEVEL_KEYS) {
        // El stepper que el usuario está pulsando no se repinta (salvo rebote) para no cortar la pulsación.
        const repaint = x === k ? bounced : ctx.shown[x] !== next[x];
        if (repaint) ctx.setSlot(`st-lv-${x}`, levelStepper(x, next[x], tm));
        ctx.shown[x] = next[x];
        const pace = ctx.body.querySelector(`[data-pace="${x}"]`);
        if (pace) pace.textContent = `Ritmo ${fmt.pace(next[x])} /km`;
      }
      const after = getState();
      const vamEl = ctx.body.querySelector('[data-vam]');
      if (vamEl) vamEl.innerHTML = vamCardHtml(after);
      ctx.debounced('lvhist', () => {
        const h = ctx.body.querySelector('[data-lvhist]');
        if (h) h.innerHTML = levelHistoryHtml(getState());
      }, 400);
    },
    action(name, el, ctx) {
      if (name === 'vam') {
        haptic('light');
        openVamSheet(ctx);
      }
    },
  },

  week: {
    render: weekHtml,
    handle(id, v, ctx) {
      const n = Number(v);
      const map = { 'st-wd-min': 'weekdayMinutes', 'st-thu-min': 'thursdayMinutes', 'st-we-min': 'weekendMinutes', 'st-we-day': 'weekendDay' };
      if (map[id] && Number.isFinite(n)) {
        haptic('selection');
        ctx.save((d) => { d.schedule[map[id]] = id === 'st-we-day' ? (n === 7 ? 7 : 6) : n; });
        const host = ctx.body.querySelector('[data-weekprev]');
        if (host) host.innerHTML = weekPreviewHtml(getState());
      } else if (id === 'st-reminder' && /^\d{2}:\d{2}/.test(String(v))) {
        ctx.save((d) => { d.schedule.reminderTime = String(v).slice(0, 5); });
      } else if (id === 'st-ntf-on' || id === 'st-ntf-pre') {
        haptic('selection');
        setNotifyConfig(id === 'st-ntf-on' ? { enabled: !!v } : { preRun: !!v });
      } else if (['st-ntf-wd', 'st-ntf-we', 'st-ntf-pre-t', 'st-ntf-thu'].includes(id) && /^\d{2}:\d{2}/.test(String(v))) {
        const key = { 'st-ntf-wd': 'weekdayTime', 'st-ntf-we': 'weekendTime', 'st-ntf-pre-t': 'preRunTime', 'st-ntf-thu': 'thursdayPreRunTime' }[id];
        setNotifyConfig({ [key]: String(v).slice(0, 5) });
      }
    },
    async action(name, el, ctx) {
      if (name !== 'reset-cycle') return;
      const ok = await confirmDialog({
        title: '¿Reiniciar el ciclo?',
        message: 'Tu plan volverá a la semana 1 (Base) desde este lunes. Tu historial y tus velocidades no cambian.',
        confirmText: 'Reiniciar',
        cancelText: 'Cancelar',
      });
      if (!ok) return;
      ctx.save((d) => {
        d.plan = d.plan || { overrides: {} };
        d.plan.startDate = mondayOf(todayKey());
      });
      const host = ctx.body.querySelector('[data-cycle]');
      if (host) host.innerHTML = cycleHtml(getState());
      haptic('success');
      toast('Ciclo reiniciado: semana 1, ¡a construir base!', { icon: 'repeat', kind: 'success' });
    },
  },

  treadmill: {
    render: treadmillHtml,
    handle(id, v, ctx) {
      const s = getState();
      const tm = s.treadmill || {};
      if (id === 'st-incline') {
        haptic('selection');
        ctx.save((d) => { d.treadmill.hasIncline = !!v; });
        const row = ctx.body.querySelector('[data-incline-row]');
        if (row) row.hidden = !v;
      } else if (id === 'st-maxinc') {
        ctx.save((d) => { d.treadmill.maxIncline = Math.round(Number(v)) || 12; });
      } else if (id === 'st-minspeed') {
        let n = round1(Number(v));
        if (n > (tm.maxSpeed ?? 18) - 4) {
          n = round1((tm.maxSpeed ?? 18) - 4);
          ctx.setSlot('st-minspeed', stepper({ id: 'st-minspeed', value: n, step: 0.5, min: 0.5, max: 8, unit: 'km/h', decimals: 1 }));
        }
        ctx.save((d) => { d.treadmill.minSpeed = n; });
      } else if (id === 'st-maxspeed') {
        const n = round1(Number(v));
        ctx.save((d) => { d.treadmill.maxSpeed = n; });
        const top = Math.max(...LEVEL_KEYS.map((k) => s.levels?.[k] || 0));
        if (top > n && Date.now() - (ctx.lastWarn || 0) > 2500) {
          ctx.lastWarn = Date.now();
          haptic('warning');
          toast(`Tu sprint (${fmt.speed(top)}) supera ese máximo: las clases lo recortarán a ${fmt.speed(n)}`, { icon: 'info' });
        }
      } else if (id === 'st-lead') {
        haptic('selection');
        ctx.save((d) => { d.treadmill.announceLead = [5, 10, 15].includes(Number(v)) ? Number(v) : 10; });
      }
    },
  },

  display: {
    render: displayHtml,
    handle(id, v, ctx) {
      const set = (patch) => ctx.save((d) => { d.visuals = { ...VISUAL_DEFAULTS, ...(d.visuals || {}), ...patch }; });
      if (id === 'st-vq') {
        const q = QUALITY_OPTS.some((o) => o.value === v) ? v : 'auto';
        haptic('selection');
        set({ quality: q });
        const note = ctx.body.querySelector('[data-vq-note]');
        if (note) note.textContent = QUALITY_DESC[q];
        if (q === 'off') safe(() => ctx.demo3d?.stop?.());
        const b = ctx.body.querySelector('[data-st="demo3d"]');
        if (b && !ctx.demo3d) {
          b.disabled = q === 'off';
          const t = b.querySelector('span');
          if (t) t.textContent = demoLabel(visualsOf(getState()));
        }
        ctx.body.querySelector('.st-scenes')?.classList.toggle('is-off', q === 'off');
        const sn = ctx.body.querySelector('[data-scene-note]');
        if (sn) sn.textContent = q === 'off' ? SCENE_NOTE_OFF : SCENE_NOTE_ON;
      } else if (id === 'st-ghost') {
        haptic('selection');
        set({ ghost: !!v });
      } else if (id === 'st-bob') {
        haptic('selection');
        set({ strideBob: !!v });
      } else if (id === 'st-tvmode') {
        haptic('selection');
        set({ tvMode: !!v });
      } else if (id === 'st-captions') {
        haptic('selection');
        set({ captions: !!v });
      }
    },
    action(name, el, ctx) {
      if (name === 'demo3d') fire(() => runDemo3d(ctx, el));
      else if (name === 'intro') {
        const v = INTRO_OPTS.some((o) => o.value === el.dataset.intro) ? el.dataset.intro : 'always';
        ctx.body.querySelectorAll('[data-intro]').forEach((r) => {
          const on = r.dataset.intro === v;
          r.classList.toggle('is-on', on);
          r.setAttribute('aria-checked', String(on));
        });
        if (v === introPref()) return;
        haptic('selection');
        safe(() => localStorage.setItem(INTRO_KEY, v));
      } else if (name === 'feel') {
        const v = FEEL_OPTS.some((o) => o.value === el.dataset.feel) ? el.dataset.feel : 'viva';
        ctx.body.querySelectorAll('[data-feel]').forEach((r) => {
          const on = r.dataset.feel === v;
          r.classList.toggle('is-on', on);
          r.setAttribute('aria-checked', String(on));
        });
        if (v === feelPref()) return;
        haptic('selection');
        safe(() => localStorage.setItem(FEEL_KEY, v));
      } else if (name === 'scene') {
        const id = el.dataset.scene === AUTO_THEME ? AUTO_THEME : sceneOf(el.dataset.scene).id;
        const before = visualsOf(getState()).theme;
        ctx.body.querySelectorAll('[data-scene]').forEach((r) => {
          const on = r.dataset.scene === id;
          r.classList.toggle('is-on', on);
          r.setAttribute('aria-checked', String(on));
        });
        const badge = ctx.body.querySelector('[data-demo-badge]');
        if (badge) badge.textContent = demoBadge(id);
        const stage = ctx.body.querySelector('[data-demo-stage]');
        if (stage) stage.style.backgroundImage = demoBg(demoWorld(id)).replace(/^background-image:/, '');
        if (id === before) return;
        haptic('selection');
        ctx.save((d) => { d.visuals = { ...VISUAL_DEFAULTS, ...(d.visuals || {}), theme: id }; });
        const b = ctx.body.querySelector('[data-st="demo3d"]');
        if (b && !ctx.demo3d) { const t = b.querySelector('span'); if (t) t.textContent = demoLabel(visualsOf(getState())); }
        // Demo en marcha: cambia de escenario en caliente
        fire(() => ctx.demo3d?.scene?.setTheme?.(demoWorld(id)));
      }
    },
  },

  audio: {
    render: audioHtml,
    init(ctx) {
      // Carga de voces y packs; repinta solo su contenedor.
      const paintVoices = () => {
        if (!ctx.alive) return;
        const host = ctx.body.querySelector('[data-voices]');
        if (!host) return;
        // conserva «Más voces» abierto si el usuario lo abrió (iOS entrega las voces tarde y se repinta)
        const wasOpen = !!host.querySelector('details.st-more[open]');
        host.innerHTML = voicesHtml(getState());
        if (wasOpen) host.querySelector('details.st-more')?.setAttribute('open', '');
      };
      loadAudio();
      loadSpeech().then((m) => {
        if (!m || !ctx.alive) return;
        paintVoices();
        const off = safe(() => m.onVoicesChanged(paintVoices), null);
        if (typeof off === 'function') ctx.cleanups.push(off);
        // iOS a veces entrega las voces tarde.
        ctx.later(paintVoices, 900);
      });
      fetchPacks().then((packs) => {
        if (!ctx.alive) return;
        const host = ctx.body.querySelector('[data-packs]');
        if (host) host.innerHTML = packsHtml(getState(), packs);
        paintPackHint(ctx);
      });
      loadVoicePack();
    },
    handle(id, v, ctx) {
      const set = (fn) => {
        ctx.save((d) => {
          d.audio = d.audio || {};
          fn(d.audio);
        });
        applyAudio();
      };
      if (id === 'st-voice-on') { haptic('selection'); set((a) => { a.voiceEnabled = !!v; }); }
      else if (id === 'st-beeps') { haptic('selection'); set((a) => { a.beeps = !!v; }); }
      else if (id === 'st-duck') { haptic('selection'); set((a) => { a.duckMusic = !!v; }); }
      else if (id === 'st-chat') {
        const c = ['minimal', 'normal', 'coach'].includes(v) ? v : 'normal';
        haptic('selection');
        set((a) => { a.chattiness = c; });
        const desc = ctx.body.querySelector('[data-chat-desc]');
        if (desc) desc.textContent = CHAT_DESC[c];
      } else if (id === 'st-rate') set((a) => { a.rate = Math.round(clamp(Number(v), 0.5, 2) * 100) / 100; });
      else if (id === 'st-pitch') set((a) => { a.pitch = Math.round(clamp(Number(v), 0.5, 2) * 100) / 100; });
      else if (id === 'st-volume') set((a) => { a.volume = clamp(Math.round(Number(v)) / 100, 0.1, 1); });
    },
    click(e, ctx) {
      const play = e.target.closest('[data-play]');
      if (play) {
        e.stopPropagation();
        haptic('light');
        previewVoice(play.getAttribute('data-play'), play, ctx);
        return true;
      }
      const voice = e.target.closest('[data-voice]');
      if (voice) {
        const uri = voice.getAttribute('data-voice') || null;
        haptic('selection');
        ctx.save((d) => { d.audio.voiceURI = uri; });
        applyAudio();
        updateAudioChecks(ctx, 'data-voice', uri);
        previewVoice(uri, voice.querySelector('.st-play'), ctx);
        return true;
      }
      const pack = e.target.closest('[data-pack]');
      if (pack) {
        selectPack(pack.getAttribute('data-pack') || null, ctx);
        return true;
      }
      return false;
    },
    action(name, el, ctx) {
      if (name === 'test-coach') {
        haptic('medium');
        demoCoach(ctx, el);
      }
    },
  },

  music: {
    render: musicHtml,
    init(ctx) {
      musicCtx = ctx;
      preview.onChange = () => { if (musicCtx?.alive) markPreview(musicCtx); };
      ctx.cleanups.push(() => { if (preview.id) stopPreview(); });
      loadAudio();
      loadMusicData().then(() => {
        if (!ctx.alive) return;
        paintMusic();
        refreshOfflineStatus();
      });
    },
    handle(id, v, ctx, e) {
      const body = ctx.body;
      if (id === 'mu-mode') {
        const mode = v === 'own' ? 'own' : 'app';
        haptic('selection');
        saveMusic(ctx, (m) => { m.mode = mode; });
        const d = body.querySelector('[data-mu-mode-desc]');
        if (d) d.textContent = MODE_DESC[mode];
        body.querySelector('[data-mu-apponly]')?.classList.toggle('is-dim', mode === 'own');
        body.querySelector('.mu-hero')?.classList.toggle('is-own', mode === 'own');
      } else if (id === 'mu-enabled') {
        haptic('selection');
        saveMusic(ctx, (m) => { m.enabled = !!v; });
        body.querySelector('[data-mu-apponly]')?.classList.toggle('is-off', !v);
      } else if (id === 'mu-volume') {
        saveMusic(ctx, (m) => { m.volume = clamp(Math.round(Number(v)) / 100, 0, 1); });
      } else if (id === 'mu-effects') {
        haptic('selection');
        saveMusic(ctx, (m) => { m.effects = !!v; });
      } else if (id === 'mu-energy') {
        const en = v === 'max' ? 'max' : 'normal';
        haptic('selection');
        saveMusic(ctx, (m) => { m.energy = en; });
        const sub = body.querySelector('[data-name="mu-energy"]')?.closest('.list__row')?.querySelector('.list__sub');
        if (sub) sub.textContent = en === 'max' ? 'Pistas más potentes y entradas directas al subidón' : 'Equilibrada: la intensidad sigue a cada tramo';
      } else if (id === 'mu-builtin' || id === 'mu-imported') {
        haptic('selection');
        saveMusic(ctx, (m) => { m[id === 'mu-builtin' ? 'useBuiltIn' : 'useImported'] = !!v; });
        const m = getState().music || {};
        if (m.useBuiltIn === false && m.useImported === false) toast('Sin fuentes de música activas: la clase sonará sin música', { icon: 'music' });
        paintMusic('library');
      } else if (id.startsWith('mu-tr-')) {
        const tid = e?.target?.dataset?.trackToggle;
        if (!tid) return;
        haptic('selection');
        saveMusic(ctx, (m) => {
          const set = new Set(Array.isArray(m.disabled) ? m.disabled : []);
          if (v) set.delete(tid);
          else set.add(tid);
          m.disabled = [...set];
        });
        const row = e.target.closest('.mu-track');
        row?.classList.toggle('is-off', !v);
        const tierEl = row?.closest('.mu-tier');
        const cnt = tierEl?.querySelector('.mu-tier__count');
        if (cnt && tierEl) {
          const rows = tierEl.querySelectorAll('.mu-track');
          const on = [...rows].filter((r) => !r.classList.contains('is-off')).length;
          cnt.textContent = `${on}/${rows.length}`;
          if (!on) toast('Sin pistas activas en esta zona: sonará la más parecida de otra', { icon: 'music' });
        }
        paintMusic('stats');
      } else if (id === 'mu-files') {
        const files = Array.from(v || []);
        if (e?.target) e.target.value = '';
        runImport(files);
      }
    },
    input(id, v, ctx) {
      if (id !== 'mu-volume') return;
      const n = clamp(Math.round(Number(v)) || 0, 0, 100);
      const lab = ctx.body.querySelector('[data-mu-vol]');
      if (lab) lab.textContent = `${n} %`;
      ctx.body.querySelector('#mu-volume')?.style.setProperty('--v', `${n}%`);
      ctx.debounced('mu-volume', () => saveMusic(ctx, (m) => { m.volume = n / 100; }), 250);
    },
    click(e, ctx) {
      const pv = e.target.closest('[data-preview]');
      if (pv) {
        e.stopPropagation();
        haptic('light');
        const t = findTrack(pv.dataset.preview);
        if (!t) return true;
        if (preview.id === t.id) stopPreview();
        else startPreview(t);
        return true;
      }
      const ed = e.target.closest('[data-edit-track]');
      if (ed) {
        haptic('light');
        stopPreview();
        openTrackSheet(ed.dataset.editTrack);
        return true;
      }
      const del = e.target.closest('[data-del-track]');
      if (del) {
        haptic('light');
        const t = findTrack(del.dataset.delTrack);
        removeUserTrack(del.dataset.delTrack, String(t?.title || 'esta canción'));
        return true;
      }
      if (e.target.closest('[data-mu-clear]')) {
        importJob = null;
        paintMusic('import');
        return true;
      }
      return false;
    },
    action(name) {
      if (name === 'mu-offline') {
        haptic('medium');
        downloadOffline();
      }
    },
  },

  watch: {
    render: watchHtml,
    init(ctx) {
      if (isNative()) {
        // Solo se repinta la tarjeta del reloj (la conexión va y viene al bajar la muñeca: el resto no se toca)
        const onStatus = () => { if (ctx.alive) ctx.setSlot('nwatch', nativeWatchHtml()); };
        window.addEventListener('br:native-status', onStatus);
        ctx.cleanups.push(() => window.removeEventListener('br:native-status', onStatus));
      }
      loadWatch().then((m) => {
        if (!m || !ctx.alive) return;
        const g = ctx.body.querySelector('[data-guide]');
        if (g) g.innerHTML = guideHtml();
      });
      const onVis = () => {
        if (document.visibilityState !== 'visible' || !hrTest.opened || hrTest.result || hrTest.nudged) return;
        if (Date.now() - hrTest.opened > 15 * 60 * 1000) return;
        hrTest.nudged = true;
        const b = ctx.body.querySelector('[data-st="hr-paste"]');
        b?.classList.add('is-ready');
        b?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        toast('¿Ya terminó el Atajo? Pulsa «Pegar resultado»', { icon: 'copy' });
      };
      document.addEventListener('visibilitychange', onVis);
      ctx.cleanups.push(() => document.removeEventListener('visibilitychange', onVis));
    },
    handle(id, v, ctx) {
      if (id === 'st-watch') {
        haptic('selection');
        ctx.save((d) => {
          d.integrations = d.integrations || {};
          d.integrations.watchReminder = !!v;
        });
      } else if (id === 'st-hrshortcut') {
        const name = String(v || '').trim().slice(0, 40) || HR_SHORTCUT;
        ctx.save((d) => {
          d.integrations = d.integrations || {};
          d.integrations.hrShortcut = name;
        });
        const input = ctx.body.querySelector('#st-hrshortcut');
        if (input && !String(input.value || '').trim()) input.value = name;
        const g = ctx.body.querySelector('[data-guide]');
        if (g) g.innerHTML = guideHtml(name);
      } else if (id === 'st-shortcut') {
        ctx.save((d) => {
          d.integrations = d.integrations || {};
          d.integrations.healthShortcut = String(v || '').trim().slice(0, 40);
        });
      }
    },
    input(id, v, ctx) {
      if (id === 'st-hrshortcut') {
        const shown = String(v || '').trim() || HR_SHORTCUT;
        ctx.body.querySelectorAll('[data-shortcut-name]').forEach((n) => { n.textContent = shown; });
        ctx.debounced('hrshortcut', () => ctx.save((d) => {
          d.integrations = d.integrations || {};
          d.integrations.hrShortcut = String(v || '').trim().slice(0, 40) || HR_SHORTCUT;
        }));
      } else if (id === 'st-shortcut') {
        ctx.debounced('shortcut', () => ctx.save((d) => {
          d.integrations = d.integrations || {};
          d.integrations.healthShortcut = String(v || '').trim().slice(0, 40);
        }));
      }
    },
    action(name, el, ctx) {
      if (name === 'hr-test') runHrTest(ctx);
      else if (name === 'hr-paste') pasteHrTest(ctx);
      else if (name === 'hr-save') saveHrTest(ctx);
      else if (name === 'health-auth') {
        haptic('medium');
        if (!nativePost('health.authorize', {})) toast('No se ha podido abrir el permiso de Salud', { kind: 'error' });
      }
    },
  },

  install: { render: installHtml },

  data: {
    render: dataHtml,
    init(ctx) {
      const host = ctx.body.querySelector('[data-persist]');
      const p = safe(() => navigator.storage?.persisted?.(), null);
      if (!host) return;
      if (!p || typeof p.then !== 'function') {
        host.innerHTML = `${icon('lock', 13)} Datos guardados en este dispositivo.`;
        return;
      }
      p.then((yes) => {
        if (!ctx.alive) return;
        host.innerHTML = yes
          ? `${icon('lock', 13)} Almacenamiento protegido: el sistema no borrará tus datos.`
          : `${icon('info', 13)} Guardado en este dispositivo. Instala la app para que esté mejor protegido.`;
      }).catch(() => {});
    },
    handle(id, v, ctx, e) {
      if (id === 'st-import') importBackup(e?.target);
    },
    action(name) {
      if (name === 'export') exportBackup();
      else if (name === 'reset') resetAll();
    },
  },

  about: {
    render: aboutHtml,
    action(name) {
      if (name === 'update') {
        haptic('light');
        checkUpdate();
      } else if (name === 'diag') {
        // Registro del final de las clases (js/core/diag.js), para pegarlo en un mensaje
        haptic('light');
        const text = `${APP_VERSION}\n${diagText()}`;
        Promise.resolve(navigator.clipboard?.writeText?.(text))
          .then(() => toast('Diagnóstico copiado: pégalo en un mensaje', { icon: 'copy' }))
          .catch(() => toast('No se ha podido copiar el diagnóstico', { kind: 'error' }));
      }
    },
  },
};

/* ───────────── montaje ───────────── */

export function mount(el, { params } = {}) {
  const key = params?.section && PAGES[params.section] && SECTIONS[params.section] ? params.section : 'root';
  const page = PAGES[key];
  el.classList.add('st-screen', `st-screen--${key}`);
  el.innerHTML = `${navBar({
    title: key === 'root' ? 'Perfil' : SECTIONS[key].title,
    large: true,
    back: key !== 'root' ? '#/settings' : false,
    backLabel: 'Perfil',
  })}<div class="container stack-lg st-body" data-body></div>`;
  const body = el.querySelector('[data-body]');
  const offHeader = safe(() => enableCollapsingHeader(el), null);

  const timers = new Set();
  const debouncers = new Map();
  const ctx = {
    el,
    body,
    key,
    alive: true,
    muting: false,
    selfState: null,
    selfAt: 0,
    shown: {},
    cleanups: [],
    demo: null,
    lastDup: null,
    save(mutator) {
      ctx.muting = true;
      ctx.selfAt = Date.now();
      try {
        ctx.selfState = setState((d) => {
          d.profile = d.profile || {};
          d.schedule = d.schedule || {};
          d.treadmill = d.treadmill || {};
          d.audio = d.audio || {};
          mutator(d);
        });
      } finally {
        ctx.muting = false;
        ctx.selfAt = Date.now();
      }
      return ctx.selfState;
    },
    setSlot(id, html) {
      const s = body.querySelector(`[data-slot="${id}"]`);
      if (s) s.innerHTML = html;
    },
    later(fn, ms) {
      const t = setTimeout(() => {
        timers.delete(t);
        if (ctx.alive) fn();
      }, ms);
      timers.add(t);
      return t;
    },
    sleep(ms) {
      return new Promise((resolve) => ctx.later(resolve, ms));
    },
    debounced(name, fn, ms = 350) {
      if (!debouncers.has(name)) debouncers.set(name, debounce((f) => { if (ctx.alive) f(); }, ms));
      debouncers.get(name)(fn);
    },
    render: null,
  };

  let first = true;
  let raf = 0;
  const render = () => {
    raf = 0;
    ctx.cleanups.splice(0).forEach((f) => safe(f));
    ensureSettingsCss();
    body.innerHTML = page.render(getState(), ctx);
    if (first) {
      body.classList.add('stagger');
      [...body.children].forEach((c, i) => c.style.setProperty('--i', String(i)));
    } else body.classList.remove('stagger');
    first = false;
    page.init?.(ctx);
  };
  ctx.render = render;

  // Valor de un evento 'change': CustomEvent de stepper/segmented o input nativo.
  const readChange = (e) => {
    const d = e.detail;
    if (d && typeof d === 'object' && 'value' in d && (d.id != null || d.name != null)) return [String(d.id ?? d.name), d.value];
    const t = e.target;
    if (!t || !t.tagName) return [null, null];
    if (t.type === 'checkbox') return [t.id || t.name, !!t.checked];
    if (t.type === 'radio') return t.checked ? [t.name, t.value] : [null, null];
    if (t.type === 'file') return [t.id, t.files];
    return 'value' in t ? [t.id || t.name, t.value] : [null, null];
  };

  const onChange = (e) => {
    const [id, value] = readChange(e);
    if (!id || !page.handle) return;
    // Evita procesar dos veces el mismo cambio (evento propio + nativo).
    const sig = `${id}=${typeof value === 'object' ? Math.random() : value}`;
    if (ctx.lastDup && ctx.lastDup.sig === sig && Date.now() - ctx.lastDup.t < 80) return;
    ctx.lastDup = { sig, t: Date.now() };
    page.handle(id, value, ctx, e);
  };

  const onInput = (e) => {
    const t = e.target;
    if (!t?.id || !page.input) return;
    page.input(t.id, t.value, ctx, e);
  };

  const onClick = (e) => {
    if (page.click?.(e, ctx)) return;
    const a = e.target.closest('[data-st]');
    if (a && page.action) page.action(a.dataset.st, a, ctx, e);
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && e.target?.matches?.('input.st-input')) {
      e.target.blur();
      return;
    }
    // Filas con role="button" (no son <button>): activables con teclado.
    if ((e.key === 'Enter' || e.key === ' ') && e.target?.matches?.('[role="button"], [role="radio"]') && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      e.target.click();
    }
  };

  body.addEventListener('change', onChange);
  body.addEventListener('input', onInput);
  body.addEventListener('click', onClick);
  body.addEventListener('keydown', onKey);

  const unsub = subscribe((state) => {
    if (ctx.muting || state === ctx.selfState || Date.now() - ctx.selfAt < 350) return;
    if (!raf) raf = requestAnimationFrame(render);
  });

  render();

  return () => {
    ctx.alive = false;
    ctx.demo = null;
    unsub?.();
    if (raf) cancelAnimationFrame(raf);
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    ctx.cleanups.splice(0).forEach((f) => safe(f));
    if (key === 'audio') safe(() => speechMod?.cancelSpeech?.());
    if (key === 'music') {
      safe(() => stopPreview());
      if (musicCtx === ctx) musicCtx = null;
      sessionType('auto');
    }
    body.removeEventListener('change', onChange);
    body.removeEventListener('input', onInput);
    body.removeEventListener('click', onClick);
    body.removeEventListener('keydown', onKey);
    if (typeof offHeader === 'function') offHeader();
  };
}
