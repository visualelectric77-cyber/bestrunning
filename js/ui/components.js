// BestRunning · componentes de interfaz (strings HTML/SVG) y overlays estilo iOS.
import { esc, fmt, clamp } from '../core/utils.js';
import { ZONES, ZONE_ORDER, LEVEL_KEYS } from '../training/levels.js';
import { haptic } from '../core/haptics.js';

const hasDOM = typeof document !== 'undefined';
let uidN = 0;
const nextId = (p) => `${p}${++uidN}`;

function reducedMotion() {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/* ═════════════ Iconos (trazo 24×24, estilo SF Symbols) ═════════════ */

const F = 'fill="currentColor" stroke="none"';
const r2 = (n) => Math.round(n * 100) / 100;

function gearPath() {
  const cx = 12, cy = 12, teeth = 8, rO = 9.4, rI = 7.1;
  const step = (Math.PI * 2) / teeth;
  const pt = (r, a) => `${r2(cx + r * Math.cos(a))} ${r2(cy + r * Math.sin(a))}`;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    d += `${i ? 'L' : 'M'}${pt(rI, a - step * 0.5 + 0.1)}L${pt(rO, a - step * 0.2)}L${pt(rO, a + step * 0.2)}L${pt(rI, a + step * 0.5 - 0.1)}`;
  }
  return `<path d="${d}Z"/><circle cx="12" cy="12" r="3.1"/>`;
}

function sunIcon() {
  let d = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    d += `M${r2(12 + 6.6 * Math.cos(a))} ${r2(12 + 6.6 * Math.sin(a))}L${r2(12 + 8.8 * Math.cos(a))} ${r2(12 + 8.8 * Math.sin(a))}`;
  }
  return `<circle cx="12" cy="12" r="3.8"/><path d="${d}"/>`;
}

const CAL = '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>';

const ICONS = {
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.6V19a1.5 1.5 0 0 0 1.5 1.5H10v-5.2a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8v5.2h2.5A1.5 1.5 0 0 0 18 19V9.6"/>',
  calendar: `${CAL}<path d="M8 14h.01M12 14h.01M16 14h.01M8 17.3h.01M12 17.3h.01"/>`,
  grid: '<rect x="4" y="4" width="6.6" height="6.6" rx="2"/><rect x="13.4" y="4" width="6.6" height="6.6" rx="2"/><rect x="4" y="13.4" width="6.6" height="6.6" rx="2"/><rect x="13.4" y="13.4" width="6.6" height="6.6" rx="2"/>',
  chart: '<rect x="4" y="12.5" width="4" height="7.5" rx="1.3"/><rect x="10" y="8" width="4" height="12" rx="1.3"/><rect x="16" y="3.8" width="4" height="16.2" rx="1.3"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.6-4 3.6-6.5 7.5-6.5s6.9 2.5 7.5 6.5"/>',
  play: `<path ${F} d="M7.5 4.9v14.2c0 .8.9 1.3 1.6.9l11.3-7.1a1 1 0 0 0 0-1.8L9.1 4c-.7-.4-1.6.1-1.6.9z"/>`,
  pause: `<rect ${F} x="6" y="4.5" width="4.2" height="15" rx="1.4"/><rect ${F} x="13.8" y="4.5" width="4.2" height="15" rx="1.4"/>`,
  stop: `<rect ${F} x="5.5" y="5.5" width="13" height="13" rx="3"/>`,
  'skip-forward': `<path ${F} d="M4.5 6.1v11.8c0 .8.9 1.3 1.6.8l8.9-5.9a1 1 0 0 0 0-1.6L6.1 5.3c-.7-.5-1.6 0-1.6.8z"/><path d="M19 5.5v13"/>`,
  'skip-back': `<path ${F} d="M19.5 6.1v11.8c0 .8-.9 1.3-1.6.8L9 12.8a1 1 0 0 1 0-1.6l8.9-5.9c.7-.5 1.6 0 1.6.8z"/><path d="M5 5.5v13"/>`,
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="M5 12.8l4.4 4.4L19 7.2"/>',
  'chevron-right': '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  'chevron-left': '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  'chevron-down': '<path d="M5.5 9.5 12 16l6.5-6.5"/>',
  flame: '<path d="M12 21.5c-4.1 0-7-2.9-7-6.8 0-2.9 1.6-5 3.3-6.8.3 1.6 1.1 2.8 2.3 3.4.1-3.4 1.5-6.4 4.2-8.3.2 2.8 1.5 4.6 3 6.3 1.4 1.6 2.2 3.3 2.2 5.4 0 3.9-3.2 6.8-8 6.8z"/><path d="M12 21.5c-1.9 0-3.1-1.2-3.1-2.9 0-1.6 1-2.6 2.2-3.7.3.9.8 1.5 1.5 1.8.3-1.1.9-1.9 1.8-2.6.8 1 1.6 2.2 1.6 3.9 0 2-1.6 3.5-4 3.5z"/>',
  bolt: '<path d="M13.2 2.8 5.2 13.4h6.3l-1.1 7.8 8.2-10.8h-6.4l1-7.6z"/>',
  heart: '<path d="M12 20.3s-8-4.8-8-10.6C4 7 6 5 8.5 5c1.5 0 2.8.8 3.5 2 .7-1.2 2-2 3.5-2C18 5 20 7 20 9.7c0 5.8-8 10.6-8 10.6z"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.8M9.5 2.8h5M12 2.8V6M18.3 7.2l1.4-1.4"/>',
  route: '<circle cx="6" cy="18" r="2.3"/><circle cx="18" cy="6" r="2.3"/><path d="M8.3 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.7"/>',
  trophy: '<path d="M7.5 4h9v5.5a4.5 4.5 0 0 1-9 0V4z"/><path d="M7.5 6.5H5a.5.5 0 0 0-.5.5c0 2.3 1.4 3.8 3.4 4M16.5 6.5H19a.5.5 0 0 1 .5.5c0 2.3-1.4 3.8-3.4 4M12 14v3.5M8 20.5h8M9.5 20.5c.2-1.8 1.2-3 2.5-3s2.3 1.2 2.5 3"/>',
  gear: gearPath(),
  speaker: '<path d="M4.5 9.3h2.8l4.2-3.8v13l-4.2-3.8H4.5a1 1 0 0 1-1-1v-3.4a1 1 0 0 1 1-1z"/><path d="M15.2 9a4.2 4.2 0 0 1 0 6M17.8 6.4a7.8 7.8 0 0 1 0 11.2"/>',
  'speaker-off': '<path d="M4.5 9.3h2.8l4.2-3.8v13l-4.2-3.8H4.5a1 1 0 0 1-1-1v-3.4a1 1 0 0 1 1-1z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.8"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7M12 14.5v2"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2.8"/><path d="M8 10.5V7.8a4 4 0 0 1 7.6-1.7M12 14.5v2"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4"/><path d="M19.8 4.2v4.4h-4.4"/>',
  shuffle: '<path d="M3.5 7H7c4.6 0 5.4 10 10 10h3.5M3.5 17H7c1.6 0 2.7-1.1 3.6-2.6M13.4 9.6C14.3 8.1 15.4 7 17 7h3.5"/><path d="M18 4.5 20.5 7 18 9.5M18 14.5l2.5 2.5-2.5 2.5"/>',
  drag: '<path d="M5 8.5h14M5 12h14M5 15.5h14"/>',
  share: '<path d="M12 14.5V3.5M8.2 7.2 12 3.4l3.8 3.8"/><path d="M8 10.5H6.5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H16"/>',
  download: '<path d="M12 3.8v11.4M7.6 10.8 12 15.2l4.4-4.4M5 19.8h14"/>',
  upload: '<path d="M12 15.2V3.8M7.6 8.2 12 3.8l4.4 4.4M5 19.8h14"/>',
  watch: '<rect x="6" y="6" width="12" height="12" rx="3.6"/><path d="M8.8 6l.7-3h5l.7 3M8.8 18l.7 3h5l.7-3M12 9.5V12l1.7 1.2"/>',
  mountain: '<path d="M2.5 19.5 9 8l3.6 6.2 2.2-3.2 6.7 8.5z"/><path d="M7.3 11 9 12.5l1.4-1.2"/>',
  star: '<path d="M12 3.6l2.6 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.2 2.7 1-5.7-4.1-4 5.7-.8z"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.3M12 7.9h.01"/>',
  eye: '<path d="M2.6 12S6 5.8 12 5.8 21.4 12 21.4 12 18 18.2 12 18.2 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="2.9"/>',
  trash: '<path d="M4.5 6.6h15M9.6 6.6V4.9c0-.5.4-.9.9-.9h3c.5 0 .9.4.9.9v1.7M6.6 6.6l.8 12a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9l.8-12M10.2 10.6v5.8M13.8 10.6v5.8"/>',
  edit: '<path d="M4.5 19.5l.9-4L15.6 5.3a2.1 2.1 0 0 1 3 3L8.4 18.6l-3.9.9z"/><path d="M13.8 7.1l3.1 3.1"/>',
  sparkles: '<path d="M10 3.5c.6 3.9 2.1 5.4 6 6-3.9.6-5.4 2.1-6 6-.6-3.9-2.1-5.4-6-6 3.9-.6 5.4-2.1 6-6z"/><path d="M18 14.5c.3 1.9 1 2.6 2.9 2.9-1.9.3-2.6 1-2.9 2.9-.3-1.9-1-2.6-2.9-2.9 1.9-.3 2.6-1 2.9-2.9z"/>',
  leaf: '<path d="M5.2 18.8C4.4 10.6 9.3 5 19.6 4.4c.4 9.9-4.8 15-13.2 14.6z"/><path d="M5.2 18.8c2.6-3.8 5.8-6.6 9.6-8.4"/>',
  gauge: '<path d="M4.1 17.5a8.6 8.6 0 1 1 15.8 0"/><path d="M12 14.4l4.2-5"/><circle cx="12" cy="14.6" r="1.6"/>',
  target: `<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="5"/><circle ${F} cx="12" cy="12" r="1.5"/>`,
  'arrow-up': '<path d="M12 19.5V4.8M6 10.6l6-6 6 6"/>',
  'arrow-down': '<path d="M12 4.5v14.7M6 13.4l6 6 6-6"/>',
  music: '<path d="M9 18V6l11-2.2v12.2M9 9.6l11-2.2"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  bell: '<path d="M6 16.5v-5.3a6 6 0 0 1 12 0v5.3l1.6 2H4.4z"/><path d="M10 20.8a2.1 2.1 0 0 0 4 0"/>',
  moon: '<path d="M19.6 14.6A8 8 0 0 1 9.4 4.4a8.2 8.2 0 1 0 10.2 10.2z"/>',
  sun: sunIcon(),
  medal: '<circle cx="12" cy="15" r="5.5"/><path d="M8.6 10.7 6 3.5h4.2L12 7.7l1.8-4.2H18l-2.6 7.2"/><path d="M12 12.6l.8 1.6 1.7.3-1.2 1.2.3 1.7-1.6-.8-1.6.8.3-1.7-1.2-1.2 1.7-.3z"/>',
  crown: '<path d="M4.2 17.5 3 7.8l5 3.8L12 5l4 6.6 5-3.8-1.2 9.7z"/><path d="M4.5 20.5h15"/>',
  repeat: '<path d="M17 3.8l3 3-3 3"/><path d="M4 11.5V10a3.2 3.2 0 0 1 3.2-3.2H20M7 20.2l-3-3 3-3"/><path d="M20 12.5V14a3.2 3.2 0 0 1-3.2 3.2H4"/>',
  list: '<path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10M4.8 6.5h.01M4.8 12h.01M4.8 17.5h.01"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3.1 2"/>',
  // Extras útiles (no contractuales)
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.6 15.6l4.4 4.4"/>',
  ellipsis: `<circle ${F} cx="5.8" cy="12" r="1.8"/><circle ${F} cx="12" cy="12" r="1.8"/><circle ${F} cx="18.2" cy="12" r="1.8"/>`,
  filter: '<path d="M4 6.5h16M7 12h10M10 17.5h4"/>',
  flag: '<path d="M5.5 21V4.5"/><path d="M5.5 4.5h11l-2.2 4 2.2 4h-11"/>',
  'calendar-plus': `${CAL}<path d="M12 12.6v5M9.5 15.1h5"/>`,
  'check-circle': '<circle cx="12" cy="12" r="8.6"/><path d="M8.2 12.3l2.6 2.6 5-5.2"/>',
  'close-circle': '<circle cx="12" cy="12" r="8.6"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13"/><path d="M17.5 13.5v4a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h4"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  pulse: '<path d="M3 12.5h4l2.2-5.5 4 11 2.4-5.5H21"/>',
  runner: '<circle cx="15.2" cy="4.6" r="1.9"/><path d="M13.4 8.4 11.4 13M13.4 8.4l-3.7 1.6-2 2.6M13.4 8.4l2.2 2.6 2.7-.6M11.4 13l2.7 2.6-.9 4.9M11.4 13l-1.8 3.7-3.5.9"/>',
  treadmill: '<path d="M3 17.5h12.6a1.6 1.6 0 0 0 1.5-1.1L20.2 6.5"/><path d="M20.2 6.5H15.6"/><path d="M5.5 20.5h9"/>',
  'arrow-right': '<path d="M4.5 12h14.7M13.4 6l6 6-6 6"/>',
  'arrow-left': '<path d="M19.5 12H4.8M10.6 6l-6 6 6 6"/>',
  warning: '<path d="M10.3 4.6a2 2 0 0 1 3.4 0l7.4 12.8a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3z"/><path d="M12 9.8v4.4M12 17.1h.01"/>',
  question: '<circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6M12 17h.01"/>',
  hourglass: '<path d="M7 3.5h10M7 20.5h10M8 3.5v3.2c0 2 4 3.6 4 5.3 0-1.7 4-3.3 4-5.3V3.5M8 20.5v-3.2c0-2 4-3.6 4-5.3 0 1.7 4 3.3 4 5.3v3.2"/>',
  incline: '<path d="M3.5 19.5h17v-11z"/><path d="M14 19.5v-3.2"/>',
  wifi: '<path d="M2.8 9.3a13.5 13.5 0 0 1 18.4 0M5.8 12.6a9 9 0 0 1 12.4 0M8.9 15.8a4.5 4.5 0 0 1 6.2 0M12 19h.01"/>',
  battery: '<rect x="2.5" y="7.5" width="17" height="9" rx="2.5"/><path d="M21.5 10.5v3M5.5 10.5v3M8.5 10.5v3"/>',
  dumbbell: '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
  circle: '<circle cx="12" cy="12" r="8.6"/>',
};

const ALIASES = {
  settings: 'gear', cog: 'gear', x: 'close', user: 'person', profile: 'person', more: 'ellipsis', dots: 'ellipsis',
  zap: 'bolt', fire: 'flame', stats: 'chart', 'bar-chart': 'chart', volume: 'speaker', mute: 'speaker-off',
  back: 'chevron-left', forward: 'chevron-right', next: 'skip-forward', prev: 'skip-back', delete: 'trash',
  pencil: 'edit', 'x-circle': 'close-circle', checkmark: 'check', run: 'runner', running: 'runner', hr: 'pulse',
  'heart-rate': 'pulse', today: 'home', library: 'grid', progress: 'chart', export: 'share', import: 'download',
  alert: 'warning', help: 'question', reorder: 'drag', time: 'clock', distance: 'route', kcal: 'flame', speed: 'gauge',
};

export function icon(name, size = 22, { stroke = 2, cls = '' } = {}) {
  const key = ALIASES[name] || name;
  const body = ICONS[key] || ICONS.circle;
  const safe = String(key).replace(/[^a-z0-9-]/gi, '');
  return `<svg class="icon icon--${safe}${cls ? ' ' + esc(cls) : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/* ═════════════ Colores ═════════════ */

const CATEGORY_META = {
  intervals: { name: 'Intervalos', icon: 'bolt', color: '#FF375F' },
  tempo: { name: 'Tempo', icon: 'flame', color: '#FF9F0A' },
  endurance: { name: 'Resistencia', icon: 'route', color: '#30D158' },
  fartlek: { name: 'Fartlek', icon: 'shuffle', color: '#BF5AF2' },
  hills: { name: 'Cuestas', icon: 'mountain', color: '#C79A6B' },
  recovery: { name: 'Recuperación', icon: 'leaf', color: '#64D2FF' },
  challenge: { name: 'Retos', icon: 'trophy', color: '#FFD60A' },
  test: { name: 'Test', icon: 'gauge', color: '#7D7AFF' },
};

const safeKey = (k) => String(k ?? '').replace(/[^a-z0-9_-]/gi, '');

export function categoryColor(category) {
  return CATEGORY_META[category] ? `var(--c-${category})` : 'var(--accent)';
}

export function zoneColor(zone) {
  return ZONES[zone] ? `var(--z-${zone})` : 'var(--accent)';
}

/* ═════════════ Cabecera iOS (large title) ═════════════ */

export function navBar({ title, large = true, back = false, backLabel = 'Atrás', right = '' } = {}) {
  const fallback = typeof back === 'string' ? ` data-fallback="${esc(back)}"` : '';
  const backBtn = back
    ? `<button type="button" class="navbar__back" data-action="back"${fallback} aria-label="${esc(backLabel || 'Atrás')}">${icon('chevron-left', 26, { stroke: 2.4 })}<span>${esc(backLabel)}</span></button>`
    : '';
  return `<header class="navbar${large ? ' navbar--large' : ' navbar--inline'}">
  <div class="navbar__compact">
    <div class="navbar__side navbar__side--left">${backBtn}</div>
    <div class="navbar__compact-title" aria-hidden="${large ? 'true' : 'false'}">${esc(title)}</div>
    <div class="navbar__side navbar__side--right">${right}</div>
  </div>
  ${large ? `<div class="navbar__large"><h1 class="large-title">${esc(title)}</h1></div>` : ''}
</header>`;
}

export function enableCollapsingHeader(screenEl) {
  if (!hasDOM || !screenEl) return () => {};
  const hasIO = typeof IntersectionObserver === 'function';
  let io = null;
  let observedTitle = null;
  let nav = null;
  let raf = 0;

  const setCollapsed = (on) => {
    if (!nav || nav.classList.contains('is-collapsed') === on) return;
    nav.classList.toggle('is-collapsed', on);
    const t = nav.querySelector('.navbar__compact-title');
    if (t && nav.classList.contains('navbar--large')) t.setAttribute('aria-hidden', on ? 'false' : 'true');
  };
  const syncScroll = () => {
    if (!nav) return;
    const y = screenEl.scrollTop;
    nav.classList.toggle('is-scrolled', y > 2);
    const title = observedTitle;
    if (title) {
      // Estirado del large title al tirar hacia abajo (rebote iOS)
      if (y < 0) title.style.transform = `scale(${1 + Math.min(-y / 700, 0.1)})`;
      else if (title.style.transform) title.style.transform = '';
    }
    if (!hasIO) setCollapsed(!title || y > (title.offsetTop || 40) + title.offsetHeight * 0.6);
    // Arriba del todo el título grande siempre se ve: nunca dos títulos a la vez
    else if (title && y < 4) setCollapsed(false);
  };

  // (Re)engancha la cabecera: las pantallas pueden repintar su HTML al cambiar el estado.
  const attach = () => {
    const n = screenEl.querySelector('.navbar');
    const title = n ? n.querySelector('.large-title') : null;
    if (n === nav && title === observedTitle) return;
    io?.disconnect();
    io = null;
    nav = n;
    observedTitle = title;
    if (!nav) return;
    if (!title) {
      setCollapsed(true);
    } else if (hasIO) {
      const compact = nav.querySelector('.navbar__compact');
      const h = Math.round(compact ? compact.getBoundingClientRect().height : 44) || 44;
      io = new IntersectionObserver(
        (entries) => {
          const e = entries[entries.length - 1];
          setCollapsed((!e.isIntersecting || e.intersectionRatio < 0.2) && screenEl.scrollTop >= 4);
        },
        { root: screenEl, rootMargin: `-${h}px 0px 0px 0px`, threshold: [0, 0.2, 0.6, 1] },
      );
      io.observe(title);
    }
    syncScroll();
  };

  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      syncScroll();
    });
  };
  screenEl.addEventListener('scroll', onScroll, { passive: true });

  const mo = typeof MutationObserver === 'function'
    ? new MutationObserver(() => {
        if (!nav || !nav.isConnected || (observedTitle && !observedTitle.isConnected)) attach();
      })
    : null;
  mo?.observe(screenEl, { childList: true, subtree: true });
  attach();

  // Al girar (o cambiar el área segura) la altura de la barra compacta cambia: se vuelve a medir
  let resizeT = 0;
  const onResize = () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (!screenEl.isConnected) return;
      io?.disconnect();
      io = null;
      nav = null;
      observedTitle = null;
      attach();
    }, 140);
  };
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', onResize, { passive: true });

  return () => {
    io?.disconnect();
    mo?.disconnect();
    clearTimeout(resizeT);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    screenEl.removeEventListener('scroll', onScroll);
    if (raf) cancelAnimationFrame(raf);
  };
}

/* ═════════════ Piezas pequeñas ═════════════ */

export function intensityDots(level, color = 'currentColor') {
  const n = clamp(Math.round(Number(level) || 1), 1, 3);
  let dots = '';
  for (let i = 1; i <= 3; i++) dots += `<span class="dot${i <= n ? ' dot--on' : ''}"></span>`;
  return `<span class="dots" style="--dot-color:${esc(color)}" role="img" aria-label="Intensidad ${n} de 3">${dots}</span>`;
}

export function chip(text, { color = null, active = false, attrs = '' } = {}) {
  const tag = attrs && attrs.trim() ? 'button' : 'span';
  const type = tag === 'button' ? ' type="button"' : '';
  const style = color ? ` style="--chip-color:${esc(color)}"` : '';
  const cls = `chip${color ? ' chip--tinted' : ''}${active ? ' chip--active' : ''}`;
  // Con role="tab" (aria-selected) no se anuncia además «pulsado»: VoiceOver diría los dos estados
  const pressed = tag === 'button' && !/aria-selected/.test(attrs) ? ` aria-pressed="${active ? 'true' : 'false'}"` : '';
  return `<${tag}${type} class="${cls}"${style}${pressed} ${attrs || ''}>${esc(text)}</${tag}>`;
}

export function stat({ label, value, unit = '', icon: ic = null, color = null, size = 'md' } = {}) {
  const sz = ['sm', 'md', 'lg'].includes(size) ? size : 'md';
  const style = color ? ` style="--stat-color:${esc(color)}"` : '';
  return `<div class="stat stat--${sz}${color ? ' stat--colored' : ''}"${style}>
  <div class="stat__label">${ic ? icon(ic, sz === 'lg' ? 16 : 14, { stroke: 2.2 }) : ''}<span>${esc(label)}</span></div>
  <div class="stat__value">${esc(value ?? '–')}${unit ? `<span class="stat__unit">${esc(unit)}</span>` : ''}</div>
</div>`;
}

export function ring({ value, size = 64, stroke = 7, color = 'var(--accent)', track = 'var(--surface-3)', inner = '' } = {}) {
  const v = clamp(Number(value) || 0, 0, 1);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const grad = color === 'ember' || color === 'var(--accent-grad)';
  const gid = grad ? nextId('rg') : '';
  const strokeStyle = grad ? `url(#${gid})` : esc(color);
  const defs = grad
    ? `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF9500"/><stop offset=".5" stop-color="#FF5A1F"/><stop offset="1" stop-color="#FF2D55"/></linearGradient></defs>`
    : '';
  return `<div class="ring" style="width:${size}px;height:${size}px">
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${defs}
    <circle cx="${cx}" cy="${cx}" r="${r2(r)}" fill="none" style="stroke:${esc(track)}" stroke-width="${stroke}"/>
    <circle class="ring__value" cx="${cx}" cy="${cx}" r="${r2(r)}" fill="none" style="stroke:${strokeStyle};--ring-c:${r2(c)}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${r2(c)}" stroke-dashoffset="${r2(c * (1 - v))}" transform="rotate(-90 ${cx} ${cx})"${v <= 0 ? ' stroke-opacity="0"' : ''}/>
  </svg>
  ${inner ? `<div class="ring__inner">${inner}</div>` : ''}
</div>`;
}

export function toggle({ id, checked = false, attrs = '' } = {}) {
  const idAttr = id ? ` id="${esc(id)}"` : '';
  return `<label class="toggle"><input type="checkbox" switch role="switch"${idAttr}${checked ? ' checked' : ''} ${attrs || ''}><span class="toggle__track" aria-hidden="true"><span class="toggle__thumb"></span></span></label>`;
}

const fmtDec = (v, d) =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false }).format(v);

export function stepper({ id, value, step = 0.1, min, max, unit = '', decimals = 1 } = {}) {
  const v = Number(value) || 0;
  const lo = min ?? -Infinity;
  const hi = max ?? Infinity;
  const attrs = [
    id ? `id="${esc(id)}" data-id="${esc(id)}"` : '',
    `data-value="${v}"`,
    `data-step="${Number(step) || 1}"`,
    min != null ? `data-min="${Number(min)}"` : '',
    max != null ? `data-max="${Number(max)}"` : '',
    `data-decimals="${Number(decimals) || 0}"`,
  ].join(' ');
  return `<div class="stepper" data-stepper ${attrs} role="group">
  <button type="button" class="stepper__btn" data-step-dir="-1" aria-label="Bajar"${v <= lo ? ' disabled' : ''}>${icon('minus', 20, { stroke: 2.6 })}</button>
  <div class="stepper__value" role="spinbutton" aria-valuenow="${v}"${min != null ? ` aria-valuemin="${min}"` : ''}${max != null ? ` aria-valuemax="${max}"` : ''}><span class="num" data-stepper-value>${fmtDec(v, Number(decimals) || 0)}</span>${unit ? `<span class="stepper__unit">${esc(unit)}</span>` : ''}</div>
  <button type="button" class="stepper__btn" data-step-dir="1" aria-label="Subir"${v >= hi ? ' disabled' : ''}>${icon('plus', 20, { stroke: 2.6 })}</button>
</div>`;
}

export function segmented({ name, options = [], value } = {}) {
  const opts = Array.isArray(options) ? options : [];
  let idx = opts.findIndex((o) => String(o.value) === String(value));
  if (idx < 0) idx = 0;
  const btns = opts
    .map(
      (o, i) =>
        `<button type="button" role="radio" class="segmented__opt${i === idx ? ' is-active' : ''}" aria-checked="${i === idx}" data-value="${esc(o.value)}"${typeof o.value === 'number' ? ' data-type="n"' : ''} data-index="${i}">${esc(o.label ?? o.value)}</button>`,
    )
    .join('');
  return `<div class="segmented" role="radiogroup" data-segmented data-name="${esc(name)}" style="--count:${Math.max(1, opts.length)};--index:${idx}"><span class="segmented__thumb" aria-hidden="true"></span>${btns}</div>`;
}

export function emptyState({ icon: ic = 'sparkles', title = '', text = '', action = '' } = {}) {
  return `<div class="empty-state fade-in">
  <div class="empty-state__icon">${icon(ic || 'sparkles', 34, { stroke: 1.8 })}</div>
  ${title ? `<h3 class="empty-state__title">${esc(title)}</h3>` : ''}
  ${text ? `<p class="empty-state__text">${esc(text)}</p>` : ''}
  ${action ? `<div class="empty-state__action">${action}</div>` : ''}
</div>`;
}

export function sectionHeader(title, actionHtml = '') {
  return `<div class="section-header"><h2 class="section-title">${esc(title)}</h2>${actionHtml ? `<div class="section-header__action">${actionHtml}</div>` : ''}</div>`;
}

/* ═════════════ Gráfico de perfil de intensidad (insignia) ═════════════ */

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixHex(hex, withHex, t) {
  const a = hexToRgb(hex);
  const b = hexToRgb(withHex);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const zoneHex = (z) => (ZONES[z] ? ZONES[z].color : '#FF6A1A');

/** Barra con esquinas superiores redondeadas. */
function barPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  const b = y + h;
  if (rr <= 0.05) return `M${r2(x)} ${r2(b)}V${r2(y)}H${r2(x + w)}V${r2(b)}Z`;
  return `M${r2(x)} ${r2(b)}V${r2(y + rr)}Q${r2(x)} ${r2(y)} ${r2(x + rr)} ${r2(y)}H${r2(x + w - rr)}Q${r2(x + w)} ${r2(y)} ${r2(x + w)} ${r2(y + rr)}V${r2(b)}Z`;
}

export function profileChart(
  segments,
  { height = 120, compact = false, progressSec = null, trace = null, levels = null, showLevels = false, radius = 3, gaps = null } = {},
) {
  const segs = Array.isArray(segments) ? segments.filter((s) => s && Number(s.sec) > 0) : [];
  const W = compact ? 200 : 360;
  const H = Math.max(24, Number(height) || 120);
  if (!segs.length) {
    return `<div class="profile-chart profile-chart--empty${compact ? ' profile-chart--compact' : ''}" role="img" aria-label="Sin perfil"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><line x1="0" y1="${H - 1}" x2="${W}" y2="${H - 1}" stroke="rgba(255,255,255,.12)" stroke-width="2" stroke-dasharray="4 5"/></svg></div>`;
  }

  const total = segs.reduce((a, s) => a + Number(s.sec), 0);
  const traceArr = Array.isArray(trace) ? trace.filter((p) => Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1])) : [];
  const traceEnd = traceArr.length ? Math.max(...traceArr.map((p) => p[0])) : 0;
  const span = Math.max(total, traceEnd) || 1;

  const speeds = segs.map((s) => Number(s.speed) || 0);
  if (traceArr.length) speeds.push(...traceArr.map((p) => p[1]));
  const lv = levels && typeof levels === 'object' ? levels : null;
  const drawLevels = !!(showLevels && lv);
  if (drawLevels) LEVEL_KEYS.forEach((k) => lv[k] && speeds.push(lv[k]));
  const maxS = Math.max(...speeds, 1);
  const minS = Math.min(...speeds.filter((v) => v > 0), maxS);
  const base = Math.max(0, minS * 0.5); // las velocidades bajas siguen siendo visibles
  const top = maxS * 1.02;

  const padT = compact ? 3 : drawLevels ? 10 : 8;
  const padB = 0;
  const chartH = H - padT - padB;
  const xOf = (t) => (t / span) * W;
  const yOf = (s) => {
    const n = clamp((s - base) / Math.max(0.1, top - base), 0.08, 1);
    return padT + chartH * (1 - n);
  };

  const id = nextId('pc');
  const gap = compact ? 1 : 1.6;
  const usedZones = new Set();
  let bars = '';
  let t = 0;
  segs.forEach((s, i) => {
    const x0 = xOf(t);
    const w0 = xOf(t + Number(s.sec)) - x0;
    t += Number(s.sec);
    const g = Math.min(gap, w0 * 0.35);
    const x = x0 + g / 2;
    const w = Math.max(0.4, w0 - g);
    const y = yOf(Number(s.speed) || 0);
    const h = H - padB - y;
    const zone = ZONES[s.zone] ? s.zone : 'jog';
    usedZones.add(zone);
    const delay = Math.min(i * 14, 420);
    bars += `<path class="pc-bar" d="${barPath(x, y, w, h, compact ? Math.min(radius, 2) : radius)}" fill="url(#${id}-${zone})" style="--d:${delay}ms"/>`;
  });

  const defs = [...usedZones]
    .map((z) => {
      const c = zoneHex(z);
      return `<linearGradient id="${id}-${z}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mixHex(c, '#ffffff', 0.28)}"/><stop offset="0.18" stop-color="${c}"/><stop offset="1" stop-color="${mixHex(c, '#08080a', 0.28)}"/></linearGradient>`;
    })
    .join('');

  const hasProgress = progressSec != null && isFinite(progressSec);
  const px = hasProgress ? clamp(xOf(Number(progressSec)), 0, W) : 0;

  // Tramos saltados ([desde, hasta] en tiempo de clase): barras atenuadas y la línea «real» no los cruza
  const gapList = (Array.isArray(gaps) ? gaps : [])
    .map((g) => [Number(g?.[0]), Number(g?.[1])])
    .filter(([a, b]) => isFinite(a) && isFinite(b) && b - a >= 1)
    .sort((a, b) => a[0] - b[0]);
  let runClip = '';
  if (gapList.length) {
    let rects = '';
    let from = 0;
    for (const [a, b] of gapList) {
      if (a > from) rects += `<rect x="${r2(xOf(from)) - 3}" y="-4" width="${r2(xOf(a) - xOf(from)) + 3}" height="${H + 8}"/>`;
      from = Math.max(from, b);
    }
    if (from < span) rects += `<rect x="${r2(xOf(from))}" y="-4" width="${r2(W - xOf(from)) + 3}" height="${H + 8}"/>`;
    runClip = `<clipPath id="${id}-run">${rects}</clipPath>`;
  }

  let body;
  if (runClip && !hasProgress) {
    body = `${runClip}<g class="pc-bars pc-bars--skipped" opacity="0.26">${bars}</g><g class="pc-bars" clip-path="url(#${id}-run)">${bars}</g>`;
  } else if (hasProgress) {
    body = `<g class="pc-bars pc-bars--future" opacity="0.32">${bars}</g>
<clipPath id="${id}-clip"><rect data-pc-clip x="0" y="0" width="${r2(px)}" height="${H}"/></clipPath>
<g class="pc-bars pc-bars--played" clip-path="url(#${id}-clip)">${bars}</g>`;
  } else {
    body = `<g class="pc-bars">${bars}</g>`;
  }

  // Líneas de nivel punteadas con etiqueta
  let levelLines = '';
  if (drawLevels && !compact) {
    LEVEL_KEYS.forEach((k) => {
      if (!lv[k]) return;
      const y = r2(yOf(lv[k]));
      const c = zoneHex(k);
      levelLines += `<g class="pc-level"><line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${c}" stroke-opacity="0.55" stroke-width="1" stroke-dasharray="3 4"/><text x="${W - 3}" y="${r2(y - 3)}" text-anchor="end" fill="${c}" class="pc-level__label">${esc(fmt.speed(lv[k]))}</text></g>`;
    });
  }

  // Traza de velocidad real (escalones)
  let traceSvg = '';
  if (traceArr.length > 1) {
    const pts = traceArr.slice().sort((a, b) => a[0] - b[0]);
    let d = `M${r2(xOf(pts[0][0]))} ${r2(yOf(pts[0][1]))}`;
    for (let i = 1; i < pts.length; i++) {
      d += `H${r2(xOf(pts[i][0]))}V${r2(yOf(pts[i][1]))}`;
    }
    const endT = Math.max(pts[pts.length - 1][0], hasProgress ? Number(progressSec) : total);
    d += `H${r2(xOf(Math.min(endT, span)))}`;
    const clip = runClip ? ` clip-path="url(#${id}-run)"` : '';
    if (runClip && hasProgress) traceSvg = runClip;
    traceSvg += `<g${clip}><path class="pc-trace-shadow" d="${d}" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="${compact ? 2.5 : 4}" stroke-linejoin="round" stroke-linecap="round"/><path class="pc-trace" d="${d}" fill="none" stroke="#fff" stroke-width="${compact ? 1.2 : 1.8}" stroke-linejoin="round" stroke-linecap="round"/></g>`;
  }

  // Cursor (playhead) con brillo
  let playhead = '';
  if (hasProgress) {
    const x = r2(px);
    playhead = `<g class="pc-playhead" data-pc-playhead transform="translate(${x} 0)">
  <rect x="-3" y="${padT - 2}" width="6" height="${H - padT + 2}" rx="3" fill="#fff" opacity="0.18" filter="url(#${id}-glow)"/>
  <rect x="-1" y="${padT - 2}" width="2" height="${H - padT + 2}" rx="1" fill="#fff"/>
  <circle cx="0" cy="${padT}" r="${compact ? 2.5 : 3.6}" fill="#fff" filter="url(#${id}-glow)"/>
</g>`;
  }

  const glow = hasProgress
    ? `<filter id="${id}-glow" x="-200%" y="-20%" width="500%" height="140%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
    : '';

  const mins = Math.round(total / 60);
  const label = `Perfil de intensidad: ${mins} min, velocidad máxima ${fmt.speed(Math.max(...segs.map((s) => Number(s.speed) || 0)))} km/h`;
  const animated = !hasProgress ? ' is-animated' : '';
  return `<div class="profile-chart${compact ? ' profile-chart--compact' : ''}${animated}" role="img" aria-label="${esc(label)}" data-total="${total}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><defs>${defs}${glow}</defs>${levelLines}${body}${traceSvg}${playhead}</svg></div>`;
}

/* ═════════════ Barra de tiempo en zonas ═════════════ */

export function zoneBar(timeInZone, { showLegend = true } = {}) {
  const tiz = timeInZone && typeof timeInZone === 'object' ? timeInZone : {};
  const zones = ZONE_ORDER.filter((z) => Number(tiz[z]) > 0);
  const total = zones.reduce((a, z) => a + Number(tiz[z]), 0);
  if (!total) {
    return `<div class="zone-bar zone-bar--empty"><div class="zone-bar__track"></div>${showLegend ? '<div class="zone-bar__legend"><span class="muted">Sin datos de zonas</span></div>' : ''}</div>`;
  }
  const segs = zones
    .map((z) => {
      const pct = (Number(tiz[z]) / total) * 100;
      return `<span class="zone-bar__seg" style="flex:${r2(pct)} 1 0;background:${zoneColor(z)}" title="${esc(ZONES[z].name)}"></span>`;
    })
    .join('');
  const legend = showLegend
    ? `<div class="zone-bar__legend">${zones
        .map((z) => {
          const sec = Number(tiz[z]);
          const pct = Math.round((sec / total) * 100);
          return `<span class="zone-bar__key"><i style="background:${zoneColor(z)}"></i><span class="zone-bar__name">${esc(ZONES[z].short)}</span><b class="num">${fmt.clock(sec)}</b><span class="zone-bar__pct">${pct}%</span></span>`;
        })
        .join('')}</div>`
    : '';
  return `<div class="zone-bar" role="img" aria-label="Tiempo en zonas"><div class="zone-bar__track">${segs}</div>${legend}</div>`;
}

/* ═════════════ Tarjeta de clase ═════════════ */

const STATUS = {
  done: { label: 'Hecho', icon: 'check', cls: 'is-done' },
  today: { label: 'Hoy', icon: null, cls: 'is-today' },
  missed: { label: 'Pendiente', icon: null, cls: 'is-missed' },
  upcoming: { label: '', icon: null, cls: 'is-upcoming' },
};

function statusBadge(status) {
  const s = STATUS[status];
  if (!s || !s.label) return '';
  return `<span class="wcard__status wcard__status--${status}">${s.icon ? icon(s.icon, 13, { stroke: 3 }) : ''}${esc(s.label)}</span>`;
}

export function workoutCard(workout, { variant = 'tile', href = null, status = null, dateLabel = '', cta = false } = {}) {
  if (!workout) return '';
  const w = workout;
  const cat = CATEGORY_META[w.category] ? w.category : null;
  const meta = cat ? CATEGORY_META[cat] : { name: w.category || 'Clase', icon: 'runner' };
  const catKey = safeKey(cat || 'none');
  const minutes = w.minutes || Math.round((w.totalSec || 0) / 60);
  const km = Number(w.estDistanceKm) > 0 ? `~${fmt.dec1(w.estDistanceKm)} km` : '';
  const kcal = Number(w.estKcal) > 0 ? `${fmt.int(w.estKcal)} kcal` : '';
  const link = href ? ` data-href="${esc(href)}" role="link" tabindex="0"` : '';
  const st = STATUS[status] ? ` ${STATUS[status].cls}` : '';
  const title = esc(w.title || 'Clase');
  const aria = ` aria-label="${title}${minutes ? `, ${minutes} minutos` : ''}"`;
  const segs = Array.isArray(w.segments) ? w.segments : [];

  if (variant === 'hero') {
    const ctaHref = typeof cta === 'string' ? cta : `#/play/${encodeURIComponent(w.id || '')}`;
    return `<article class="wcard wcard--hero cc-${catKey}${href ? ' card--pressable' : ''}${st}"${link}${href ? aria : ''}>
  <div class="wcard__glow" aria-hidden="true"></div>
  <div class="wcard__top">
    <span class="chip chip--tinted wcard__cat" style="--chip-color:var(--cc)">${icon(meta.icon, 14, { stroke: 2.4 })}${esc(meta.name)}</span>
    <span class="spacer"></span>
    ${dateLabel ? `<span class="wcard__date">${esc(dateLabel)}</span>` : ''}
    ${statusBadge(status)}
  </div>
  <h2 class="wcard__title">${title}</h2>
  ${w.subtitle || w.focus ? `<p class="wcard__sub">${esc(w.subtitle || w.focus)}</p>` : ''}
  <div class="wcard__meta">
    <span>${icon('clock', 15, { stroke: 2.2 })}${minutes} min</span>
    ${km ? `<span>${icon('route', 15, { stroke: 2.2 })}${km}</span>` : ''}
    ${kcal ? `<span>${icon('flame', 15, { stroke: 2.2 })}${kcal}</span>` : ''}
    <span class="spacer"></span>
    ${intensityDots(w.intensity || 1, 'var(--cc)')}
  </div>
  <div class="wcard__chart">${profileChart(segs, { height: 92 })}</div>
  ${cta ? `<button type="button" class="btn btn--primary btn--lg btn--block wcard__cta" data-href="${esc(ctaHref)}">${icon('play', 20)}<span>Empezar</span></button>` : ''}
</article>`;
  }

  if (variant === 'row') {
    return `<article class="wcard wcard--row cc-${catKey}${href ? ' card--pressable' : ''}${st}"${link}${href ? aria : ''}>
  <span class="wcard__bar" aria-hidden="true"></span>
  <span class="wcard__icon" aria-hidden="true">${icon(meta.icon, 18, { stroke: 2.2 })}</span>
  <div class="wcard__body">
    ${dateLabel ? `<div class="wcard__eyebrow">${esc(dateLabel)}</div>` : ''}
    <div class="wcard__title">${title}</div>
    <div class="wcard__meta"><span>${minutes} min</span><span class="wcard__sep">·</span><span>${esc(meta.name)}</span>${intensityDots(w.intensity || 1, 'var(--cc)')}</div>
  </div>
  ${statusBadge(status)}
  ${href ? `<span class="list__chev" aria-hidden="true">${icon('chevron-right', 18, { stroke: 2.4 })}</span>` : ''}
</article>`;
  }

  // tile
  return `<article class="wcard wcard--tile cc-${catKey}${href ? ' card--pressable' : ''}${st}"${link}${href ? aria : ''}>
  <div class="wcard__thumb">
    <span class="wcard__dur">${minutes} min</span>
    ${statusBadge(status) || `<span class="wcard__caticon" aria-hidden="true">${icon(meta.icon, 15, { stroke: 2.4 })}</span>`}
    <div class="wcard__chart">${profileChart(segs, { height: 56, compact: true })}</div>
  </div>
  <div class="wcard__body">
    <div class="wcard__title">${title}</div>
    ${w.focus || w.subtitle ? `<div class="wcard__focus">${esc(w.focus || w.subtitle)}</div>` : ''}
    <div class="wcard__meta">${intensityDots(w.intensity || 1, 'var(--cc)')}${km ? `<span>${km}</span>` : `<span>${esc(meta.name)}</span>`}</div>
  </div>
</article>`;
}

/* ═════════════ Overlays: pila, foco y cierre ═════════════ */

const overlayStack = [];
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function overlayRoot() {
  return document.getElementById('sheet-root') || document.body;
}

function trapFocus(container, e) {
  const items = [...container.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (!items.length) {
    e.preventDefault();
    container.focus({ preventScroll: true });
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

if (hasDOM) {
  document.addEventListener('keydown', (e) => {
    const top = overlayStack[overlayStack.length - 1];
    if (!top) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      top.onEscape?.();
    } else if (e.key === 'Tab') {
      trapFocus(top.el, e);
    } else if (e.key === 'Enter' && top.onEnter && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      top.onEnter();
    }
  });
}

function afterTransition(el, fn, ms = 420) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    fn();
  };
  el.addEventListener('transitionend', (e) => e.target === el && finish());
  setTimeout(finish, reducedMotion() ? 0 : ms);
}

/* ═════════════ Hoja inferior (bottom sheet) ═════════════ */

const ACTION_CLS = {
  primary: 'btn btn--primary btn--lg btn--block',
  secondary: 'btn btn--secondary btn--lg btn--block',
  destructive: 'btn btn--danger btn--lg btn--block',
};

export function openSheet({ title = '', html = '', onMount = null, actions = [], large = false, dismissible = true, onClose = null, cls = '' } = {}) {
  if (!hasDOM) return { el: null, close: () => {} };
  const root = overlayRoot();
  const prevFocus = document.activeElement;
  const titleId = nextId('sheet-t');

  const backdrop = document.createElement('div');
  // cls: modificador propio de una hoja (p. ej. 'mu-snd'), en la hoja y en su fondo
  const mod = typeof cls === 'string' && /^[\w-]+$/.test(cls) ? cls : '';
  backdrop.className = `sheet-backdrop${mod ? ` ${mod}` : ''}`;
  const sheet = document.createElement('div');
  sheet.className = `sheet${large ? ' sheet--large' : ''}${mod ? ` ${mod}` : ''}`;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.tabIndex = -1;
  if (title) sheet.setAttribute('aria-labelledby', titleId);

  const acts = Array.isArray(actions) ? actions : [];
  sheet.innerHTML = `${dismissible ? '<div class="sheet__grabber" aria-hidden="true"></div>' : ''}
  ${title || dismissible ? `<div class="sheet__header">${title ? `<h2 class="sheet__title" id="${titleId}">${esc(title)}</h2>` : '<span></span>'}${dismissible ? `<button type="button" class="sheet__close" aria-label="Cerrar">${icon('close', 15, { stroke: 2.8 })}</button>` : ''}</div>` : ''}
  <div class="sheet__body">${html || ''}</div>
  ${acts.length ? `<div class="sheet__actions">${acts.map((a, i) => `<button type="button" class="${ACTION_CLS[a.kind] || ACTION_CLS.secondary}" data-sheet-action="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}`;

  root.append(backdrop, sheet);
  const body = sheet.querySelector('.sheet__body');
  let closed = false;

  const entry = {
    el: sheet,
    onEscape: () => dismissible && close(),
  };
  overlayStack.push(entry);

  function close() {
    if (closed) return;
    closed = true;
    const i = overlayStack.indexOf(entry);
    if (i >= 0) overlayStack.splice(i, 1);
    window.removeEventListener('br:navigate', onNav);
    sheet.style.transform = '';
    backdrop.style.opacity = '';
    sheet.classList.remove('is-open', 'is-dragging');
    backdrop.classList.remove('is-open');
    sheet.classList.add('is-closing');
    afterTransition(sheet, () => {
      sheet.remove();
      backdrop.remove();
    }, 460);
    if (prevFocus && prevFocus.isConnected && typeof prevFocus.focus === 'function') {
      try { prevFocus.focus({ preventScroll: true }); } catch { /* nada */ }
    }
    try { onClose?.(); } catch (err) { setTimeout(() => { throw err; }); }
  }

  const onNav = () => close();
  window.addEventListener('br:navigate', onNav);

  if (dismissible) backdrop.addEventListener('click', close);
  sheet.querySelector('.sheet__close')?.addEventListener('click', close);
  sheet.querySelectorAll('[data-sheet-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const a = acts[Number(btn.dataset.sheetAction)];
      if (!a) return;
      if (typeof a.onClick === 'function') {
        try { a.onClick(close); } catch (err) { setTimeout(() => { throw err; }); }
      } else close();
    });
  });
  backdrop.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  /* Arrastrar para cerrar */
  if (dismissible) {
    let tracking = false;
    let dragging = false;
    let y0 = 0;
    let x0 = 0;
    let dy = 0;
    let samples = [];
    let suppressClick = false;

    const begin = (x, y, target, ts) => {
      if (closed) return;
      if (body.contains(target) && body.scrollTop > 0) return;
      if (target.closest('input, textarea, select, [data-stepper], [data-segmented], .toggle, .hscroll, .no-drag')) return;
      tracking = true;
      dragging = false;
      y0 = y;
      x0 = x;
      dy = 0;
      samples = [[y, ts]];
    };
    const move = (x, y, target, ts, ev) => {
      if (!tracking) return;
      const ddy = y - y0;
      if (!dragging) {
        if (Math.abs(x - x0) > 10 && Math.abs(x - x0) > Math.abs(ddy)) { tracking = false; return; }
        if (ddy > 6 && (!body.contains(target) || body.scrollTop <= 0)) {
          dragging = true;
          sheet.classList.add('is-dragging');
        } else if (ddy < -6) { tracking = false; return; }
        else return;
      }
      ev.preventDefault();
      dy = ddy > 0 ? ddy : ddy * 0.2;
      sheet.style.transform = `translate3d(0, ${r2(dy)}px, 0)`;
      backdrop.style.opacity = String(clamp(1 - dy / (sheet.offsetHeight * 1.1), 0, 1));
      samples.push([y, ts]);
      if (samples.length > 6) samples.shift();
    };
    const end = (cancelled) => {
      if (!tracking) return;
      tracking = false;
      if (!dragging) return;
      dragging = false;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 60);
      sheet.classList.remove('is-dragging');
      const a = samples[0];
      const b = samples[samples.length - 1];
      const v = a && b ? (b[0] - a[0]) / Math.max(1, b[1] - a[1]) : 0;
      if (!cancelled && (dy > Math.min(150, sheet.offsetHeight * 0.32) || (v > 0.55 && dy > 20))) close();
      else {
        sheet.style.transform = '';
        backdrop.style.opacity = '';
      }
    };

    sheet.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      begin(t.clientX, t.clientY, e.target, e.timeStamp);
    }, { passive: true });
    sheet.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (t) move(t.clientX, t.clientY, e.target, e.timeStamp, e);
    }, { passive: false });
    sheet.addEventListener('touchend', () => end(false));
    sheet.addEventListener('touchcancel', () => end(true));
    // Ratón (pruebas en escritorio): solo desde el asa o la cabecera.
    sheet.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || !e.target.closest('.sheet__grabber, .sheet__header')) return;
      if (e.target.closest('button')) return;
      begin(e.clientX, e.clientY, e.target, e.timeStamp);
      const mm = (ev) => move(ev.clientX, ev.clientY, ev.target, ev.timeStamp, ev);
      const mu = () => {
        window.removeEventListener('pointermove', mm);
        window.removeEventListener('pointerup', mu);
        end(false);
      };
      window.addEventListener('pointermove', mm);
      window.addEventListener('pointerup', mu);
    });
    sheet.addEventListener('click', (e) => {
      if (suppressClick) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  // Apertura con spring
  sheet.getBoundingClientRect();
  requestAnimationFrame(() => {
    backdrop.classList.add('is-open');
    sheet.classList.add('is-open');
  });
  haptic('light');

  try {
    onMount?.(sheet, close);
  } catch (err) {
    setTimeout(() => { throw err; });
  }
  // Foco: primer campo de texto si lo hay; si no, la propia hoja.
  setTimeout(() => {
    if (closed) return;
    const field = sheet.querySelector('[autofocus]');
    (field || sheet).focus({ preventScroll: true });
  }, 60);

  return { el: sheet, close };
}

/* ═════════════ Toast ═════════════ */

const TOAST_ICON = { info: 'info', success: 'check-circle', warning: 'warning', error: 'warning' };

export function toast(message, { icon: ic = null, kind = 'info', duration = 2600, onClick = null } = {}) {
  if (!hasDOM) return { el: null, close: () => {} };
  const root = document.getElementById('toast-root') || document.body;
  const el = document.createElement('div');
  const k = TOAST_ICON[kind] ? kind : 'info';
  el.className = `toast toast--${k}${onClick ? ' toast--action' : ''}`;
  el.setAttribute('role', k === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span class="toast__icon">${icon(ic || TOAST_ICON[k], 20, { stroke: 2.3 })}</span><span class="toast__msg">${esc(message)}</span>${onClick ? `<span class="toast__chev">${icon('chevron-right', 16, { stroke: 2.6 })}</span>` : ''}`;

  // Máximo 3 a la vez
  const existing = root.querySelectorAll('.toast:not(.is-out)');
  if (existing.length >= 3) existing[0].dispatchEvent(new CustomEvent('toast:dismiss'));

  root.appendChild(el);
  el.getBoundingClientRect();
  requestAnimationFrame(() => el.classList.add('is-in'));

  let timer = null;
  let gone = false;
  const dismiss = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    el.classList.remove('is-in');
    el.classList.add('is-out');
    afterTransition(el, () => el.remove(), 380);
  };
  const arm = () => {
    clearTimeout(timer);
    if (duration > 0 && Number.isFinite(duration)) timer = setTimeout(dismiss, duration);
  };
  arm();
  el.addEventListener('toast:dismiss', dismiss);

  // Deslizar hacia arriba para descartar
  let y0 = null;
  let dy = 0;
  el.addEventListener('touchstart', (e) => {
    y0 = e.touches[0].clientY;
    dy = 0;
    clearTimeout(timer);
    el.classList.add('is-dragging');
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.min(0, e.touches[0].clientY - y0) + Math.max(0, e.touches[0].clientY - y0) * 0.15;
    el.style.transform = `translate3d(0, ${r2(dy)}px, 0)`;
  }, { passive: true });
  el.addEventListener('touchend', () => {
    el.classList.remove('is-dragging');
    el.style.transform = '';
    y0 = null;
    if (dy < -24) { dy = 0; dismiss(); return; }
    arm();
  });

  el.addEventListener('click', () => {
    if (onClick) {
      haptic('light');
      try { onClick(); } catch (err) { setTimeout(() => { throw err; }); }
    }
    dismiss();
  });
  if (k === 'error') haptic('error');
  else if (k === 'warning') haptic('warning');
  return { el, close: dismiss };
}

/* ═════════════ Alerta (confirmDialog) ═════════════ */

export function confirmDialog({ title = '', message = '', confirmText = 'Aceptar', cancelText = 'Cancelar', destructive = false } = {}) {
  if (!hasDOM) return Promise.resolve(false);
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const tid = nextId('dlg-t');
    const mid = nextId('dlg-m');
    const wrap = document.createElement('div');
    wrap.className = 'dialog-backdrop';
    const stacked = String(confirmText).length > 13 || String(cancelText).length > 13;
    wrap.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="${tid}"${message ? ` aria-describedby="${mid}"` : ''} tabindex="-1">
  <div class="dialog__content">
    <h2 class="dialog__title" id="${tid}">${esc(title)}</h2>
    ${message ? `<p class="dialog__msg" id="${mid}">${esc(message)}</p>` : ''}
  </div>
  <div class="dialog__actions${stacked ? ' dialog__actions--stacked' : ''}">
    <button type="button" class="dialog__btn" data-v="0">${esc(cancelText)}</button>
    <button type="button" class="dialog__btn dialog__btn--strong${destructive ? ' dialog__btn--destructive' : ''}" data-v="1">${esc(confirmText)}</button>
  </div>
</div>`;
    overlayRoot().appendChild(wrap);
    const dlg = wrap.querySelector('.dialog');
    let done = false;
    const entry = { el: dlg, onEscape: () => finish(false), onEnter: () => finish(true) };
    overlayStack.push(entry);

    function finish(v) {
      if (done) return;
      done = true;
      const i = overlayStack.indexOf(entry);
      if (i >= 0) overlayStack.splice(i, 1);
      window.removeEventListener('br:navigate', onNav);
      wrap.classList.remove('is-open');
      wrap.classList.add('is-closing');
      afterTransition(wrap, () => wrap.remove(), 260);
      if (prevFocus && prevFocus.isConnected) {
        try { prevFocus.focus({ preventScroll: true }); } catch { /* nada */ }
      }
      if (v) haptic(destructive ? 'medium' : 'light');
      resolve(v);
    }
    const onNav = () => finish(false);
    window.addEventListener('br:navigate', onNav);
    wrap.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => finish(b.dataset.v === '1')));
    wrap.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

    wrap.getBoundingClientRect();
    requestAnimationFrame(() => wrap.classList.add('is-open'));
    haptic(destructive ? 'warning' : 'light');
    setTimeout(() => !done && wrap.querySelector('[data-v="1"]').focus({ preventScroll: true }), 50);
  });
}

/* ═════════════ Action sheet ═════════════ */

export function actionSheet({ title = '', options = [] } = {}) {
  if (!hasDOM) return Promise.resolve(null);
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const opts = Array.isArray(options) ? options : [];
    const wrap = document.createElement('div');
    wrap.className = 'asheet-backdrop';
    wrap.innerHTML = `<div class="asheet" role="dialog" aria-modal="true"${title ? ` aria-label="${esc(title)}"` : ''} tabindex="-1">
  <div class="asheet__group">
    ${title ? `<div class="asheet__title">${esc(title)}</div>` : ''}
    ${opts
      .map(
        (o, i) =>
          `<button type="button" class="asheet__opt${o.destructive ? ' asheet__opt--destructive' : ''}" data-i="${i}">${o.icon ? icon(o.icon, 20, { stroke: 2.1 }) : ''}<span>${esc(o.label)}</span></button>`,
      )
      .join('')}
  </div>
  <button type="button" class="asheet__opt asheet__cancel" data-i="-1">Cancelar</button>
</div>`;
    overlayRoot().appendChild(wrap);
    const panel = wrap.querySelector('.asheet');
    let done = false;
    const entry = { el: panel, onEscape: () => finish(null) };
    overlayStack.push(entry);

    function finish(v) {
      if (done) return;
      done = true;
      const i = overlayStack.indexOf(entry);
      if (i >= 0) overlayStack.splice(i, 1);
      window.removeEventListener('br:navigate', onNav);
      wrap.classList.remove('is-open');
      wrap.classList.add('is-closing');
      afterTransition(panel, () => wrap.remove(), 360);
      if (prevFocus && prevFocus.isConnected) {
        try { prevFocus.focus({ preventScroll: true }); } catch { /* nada */ }
      }
      resolve(v);
    }
    const onNav = () => finish(null);
    window.addEventListener('br:navigate', onNav);
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) {
        if (!e.target.closest('.asheet')) finish(null);
        return;
      }
      const i = Number(b.dataset.i);
      if (i < 0) return finish(null);
      haptic('selection');
      const o = opts[i];
      finish(o ? (o.value !== undefined ? o.value : o.label) : null);
    });
    wrap.addEventListener('touchmove', (e) => {
      if (!e.target.closest('.asheet__group')) e.preventDefault();
    }, { passive: false });

    wrap.getBoundingClientRect();
    requestAnimationFrame(() => wrap.classList.add('is-open'));
    haptic('light');
    setTimeout(() => !done && panel.focus({ preventScroll: true }), 50);
  });
}

/* ═════════════ Confeti ═════════════ */

const CONFETTI_COLORS = [
  ...Object.values(ZONES).filter((z) => z.key !== 'walk').map((z) => z.color),
  '#FF9500', '#FF5A1F', '#FF2D55', '#FFFFFF',
];

export function celebrate({ intensity = 1 } = {}) {
  if (!hasDOM) return;
  haptic('success');
  if (reducedMotion()) return;
  const k = clamp(Number(intensity) || 1, 0.3, 3);
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = window.innerWidth;
  let H = window.innerHeight;
  const resize = () => {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  document.body.appendChild(canvas);
  window.addEventListener('resize', resize);

  const rand = (a, b) => a + Math.random() * (b - a);
  const parts = [];
  const spawn = (n, x, y, angle, spread, power) => {
    for (let i = 0; i < n; i++) {
      const a = angle + rand(-spread, spread);
      const v = power * rand(0.55, 1.05);
      parts.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        w: rand(6, 11),
        h: rand(9, 16),
        rot: rand(0, Math.PI * 2),
        vr: rand(-0.25, 0.25),
        tilt: rand(0, Math.PI * 2),
        vt: rand(0.05, 0.16),
        shape: Math.random() < 0.18 ? 'circle' : Math.random() < 0.3 ? 'ribbon' : 'rect',
        color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
        drag: rand(0.982, 0.992),
      });
    }
  };
  const n = Math.round(110 * k);
  const power = Math.min(W, 520) * 0.052 + 10;
  spawn(n, -10, H * 0.78, -Math.PI / 3.1, 0.42, power);
  spawn(n, W + 10, H * 0.78, -Math.PI + Math.PI / 3.1, 0.42, power);
  if (k > 1.2) setTimeout(() => spawn(Math.round(60 * k), W / 2, -20, Math.PI / 2, 1.2, 6), 260);

  const start = performance.now();
  let last = start;
  let raf = 0;
  const G = 0.32;
  const frame = (now) => {
    const dt = Math.min(2.5, (now - last) / 16.67);
    last = now;
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (const p of parts) {
      p.vx *= Math.pow(p.drag, dt);
      p.vy = p.vy * Math.pow(p.drag, dt) + G * dt;
      p.x += (p.vx + Math.sin(p.tilt) * 0.6) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.tilt += p.vt * dt;
      if (p.y > H + 30) continue;
      alive++;
      const age = (now - start) / 1000;
      ctx.globalAlpha = age > 3.2 ? Math.max(0, 1 - (age - 3.2) / 0.8) : 1;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      const sy = Math.abs(Math.cos(p.tilt)) * 0.85 + 0.15; // giro 3D aparente
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.ellipse(0, 0, p.w * 0.45, p.w * 0.45 * sy, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'ribbon') {
        ctx.fillRect(-p.w * 0.2, -p.h * 0.75 * sy, p.w * 0.4, p.h * 1.5 * sy);
      } else {
        ctx.fillRect(-p.w / 2, (-p.h / 2) * sy, p.w, p.h * sy);
      }
      ctx.restore();
    }
    if (alive > 0 && now - start < 4200) raf = requestAnimationFrame(frame);
    else cleanup();
  };
  const cleanup = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    canvas.remove();
  };
  raf = requestAnimationFrame(frame);
}

/* ═════════════ Comportamiento global: stepper y segmented ═════════════ */

function stepperApply(box, dir, mult = 1) {
  const step = Number(box.dataset.step) || 1;
  const dec = Number(box.dataset.decimals) || 0;
  const min = box.dataset.min != null ? Number(box.dataset.min) : -Infinity;
  const max = box.dataset.max != null ? Number(box.dataset.max) : Infinity;
  const cur = Number(box.dataset.value) || 0;
  const f = 10 ** Math.max(dec, 0);
  let next = Math.round((cur + dir * step * mult) * f) / f;
  next = clamp(next, min, max);
  if (next === cur) {
    haptic('warning');
    return false;
  }
  box.dataset.value = String(next);
  const out = box.querySelector('[data-stepper-value]');
  if (out) out.textContent = fmtDec(next, dec);
  const sb = box.querySelector('.stepper__value');
  sb?.setAttribute('aria-valuenow', String(next));
  const [down, up] = box.querySelectorAll('[data-step-dir]');
  if (down) down.disabled = next <= min;
  if (up) up.disabled = next >= max;
  // Rebote del número
  if (out && !reducedMotion()) {
    out.classList.remove('is-bump-up', 'is-bump-down');
    void out.offsetWidth;
    out.classList.add(dir > 0 ? 'is-bump-up' : 'is-bump-down');
  }
  haptic('selection');
  // Evento intermedio propio (no 'input', para no chocar con campos de texto); 'change' llega al soltar.
  box.dispatchEvent(new CustomEvent('stepper:input', { bubbles: true, detail: { id: box.dataset.id || box.id || '', value: next } }));
  return true;
}

function emitStepperChange(box) {
  box.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { id: box.dataset.id || box.id || '', value: Number(box.dataset.value) } }));
}

if (hasDOM) {
  let hold = null;

  const stopHold = (commit = true) => {
    if (!hold) return;
    clearTimeout(hold.timer);
    const { box, changed } = hold;
    hold.btn.classList.remove('is-pressed');
    hold = null;
    if (commit && changed && box.isConnected) emitStepperChange(box);
  };

  // El primer paso se aplica al SOLTAR (o al mantener 420 ms), nunca al apoyar el dedo: un desplazamiento
  // que empieza sobre −/+ (pointercancel o el dedo que se mueve) no debe cambiar velocidades, peso o edad.
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest?.('.stepper [data-step-dir]');
    if (!btn || btn.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const box = btn.closest('[data-stepper]');
    if (!box) return;
    e.preventDefault();
    stopHold(true);
    const dir = Number(btn.dataset.stepDir) || 1;
    btn.classList.add('is-pressed');
    hold = { box, btn, dir, count: 0, changed: false, timer: 0, t0: Date.now(), x: e.clientX, y: e.clientY, pid: e.pointerId };
    const tick = () => {
      if (!hold || !box.isConnected) return stopHold(true);
      hold.count++;
      const held = Date.now() - hold.t0;
      const mult = held > 2600 ? 5 : 1;
      const ok = stepperApply(box, dir, mult);
      hold.changed = ok || hold.changed;
      if (!ok) return stopHold(true);
      const delay = Math.max(45, 170 - hold.count * 12);
      hold.timer = setTimeout(tick, delay);
    };
    hold.timer = setTimeout(tick, 420);
  });
  document.addEventListener('pointermove', (e) => {
    if (!hold || hold.count || e.pointerId !== hold.pid) return;
    if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) stopHold(false); // es un desplazamiento, no un toque
  }, { passive: true });
  document.addEventListener('pointerup', (e) => {
    if (!hold) return;
    // Toque corto: un único paso (si se mantuvo, la repetición ya lo aplicó)
    if (!hold.count && e.pointerId === hold.pid && hold.box.isConnected) hold.changed = stepperApply(hold.box, hold.dir) || hold.changed;
    stopHold(true);
  });
  document.addEventListener('pointercancel', () => stopHold(true));
  document.addEventListener('pointerleave', (e) => {
    if (hold && e.target === hold.btn) stopHold(true);
  }, true);

  // Teclado (Enter/Espacio generan click con detail 0)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.stepper [data-step-dir]');
    if (btn && e.detail === 0 && !btn.disabled) {
      const box = btn.closest('[data-stepper]');
      if (box && stepperApply(box, Number(btn.dataset.stepDir) || 1)) emitStepperChange(box);
      return;
    }
    const opt = e.target.closest?.('[data-segmented] .segmented__opt');
    if (!opt) return;
    const seg = opt.closest('[data-segmented]');
    if (opt.classList.contains('is-active')) return;
    const all = [...seg.querySelectorAll('.segmented__opt')];
    const idx = all.indexOf(opt);
    all.forEach((b, i) => {
      b.classList.toggle('is-active', i === idx);
      b.setAttribute('aria-checked', String(i === idx));
    });
    seg.style.setProperty('--index', String(idx));
    haptic('selection');
    const raw = opt.dataset.value;
    const value = opt.dataset.type === 'n' ? Number(raw) : raw;
    seg.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { name: seg.dataset.name || '', value } }));
  });
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest?.('.stepper')) e.preventDefault();
  });
}
