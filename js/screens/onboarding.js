// BestRunning · bienvenida y configuración inicial en 5 pasos (pantalla completa).
import { getState, setState, importState } from '../core/store.js';
import { navigate } from '../core/router.js';
import { haptic } from '../core/haptics.js';
import { icon, stepper, segmented, toggle, toast, celebrate } from '../ui/components.js';
import { planWeek } from '../training/planner.js';
import { CATEGORIES } from '../training/templates.js';
import {
  ZONES, LEVEL_KEYS, DEFAULT_LEVELS, enforceLevelOrder, vamFromLevels, hrMaxFromAge, hrZones,
} from '../training/levels.js';
import * as speech from '../audio/speech.js';
import * as audioEngine from '../audio/audio-engine.js';
import { PACK_ID, composeCue } from '../audio/voice-pack.js';
import { todayKey, mondayOf, fmt, esc, clamp, round1 } from '../core/utils.js';
import { isNative, nativeStatus, requestNativeBackup } from '../integrations/native-bridge.js';

const STEPS = ['welcome', 'about', 'speeds', 'week', 'voice'];
const EVA_KEY = 'pack:eva'; // fila de la voz grabada en la lista de voces
const LEVEL_HINTS = {
  jog: 'Cómodo: puedes charlar',
  run: 'Exigente pero sostenible',
  fast: 'Respiración intensa',
  sprint: 'A tope, de 30 a 60 s',
};
const LEVEL_RANGES = { jog: [5, 12], run: [6, 15], fast: [7, 17], sprint: [8, 20] };
const CHAT_DESC = {
  minimal: 'Solo avisos de cambio y el final. Ideal si vas con tu música a tope.',
  normal: 'Avisos, cuenta atrás y algún consejo de técnica y respiración.',
  coach: 'Modo entrenador: más consejos y mucha motivación en los tramos duros.',
};

/* ───────────── Utilidades privadas ───────────── */

function safe(fn, fallback) {
  try {
    const v = fn();
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

const reducedMotion = () => safe(() => matchMedia('(prefers-reduced-motion: reduce)').matches, false);
const withValue = (opts, v) => [...new Set([...opts, v])].filter((x) => x != null).sort((a, b) => a - b);
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';

function voiceQuality(v) {
  const s = `${v?.voiceURI || ''} ${v?.name || ''}`;
  if (v?.premium || /premium/i.test(s)) return 'Premium';
  if (v?.enhanced || /enhanced|mejorad/i.test(s)) return 'Mejorada';
  return '';
}

function hm(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
}

/* ───────────── Logo y fondo ───────────── */

// Mismo símbolo que assets/icons/icon.svg (chevron + líneas de velocidad + cinta sobre degradado ember).
// Los trazos de velocidad van dibujados de derecha a izquierda para que «salgan» del chevron al animarse.
const LOGO = `<div class="ob-logo" aria-hidden="true">
  <div class="ob-logo__halo"></div>
  <div class="ob-lines"><i></i><i></i><i></i><i></i><i></i><i></i></div>
  <svg class="ob-logo__mark" viewBox="0 0 1024 1024" width="128" height="128">
    <defs>
      <linearGradient id="obEmber" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#FF9500"/><stop offset=".48" stop-color="#FF5A1F"/><stop offset="1" stop-color="#FF2D55"/>
      </linearGradient>
      <radialGradient id="obHl" cx=".22" cy=".08" r=".85">
        <stop offset="0" stop-color="#fff" stop-opacity=".26"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="obDk" cx="1" cy="1.05" r=".9">
        <stop offset="0" stop-color="#B00C34" stop-opacity=".45"/><stop offset="1" stop-color="#B00C34" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="obBelt" gradientUnits="userSpaceOnUse" x1="241" y1="0" x2="859" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity=".62"/>
      </linearGradient>
      <linearGradient id="obShine" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".42"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <filter id="obSh" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="22"/><feOffset dy="18" result="b"/>
        <feFlood flood-color="#7A081C" flood-opacity=".42"/><feComposite in2="b" operator="in"/>
        <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <clipPath id="obClip"><rect width="1024" height="1024" rx="229"/></clipPath>
    </defs>
    <rect width="1024" height="1024" rx="229" fill="url(#obEmber)"/>
    <rect width="1024" height="1024" rx="229" fill="url(#obHl)"/>
    <rect width="1024" height="1024" rx="229" fill="url(#obDk)"/>
    <g clip-path="url(#obClip)"><rect class="ob-logo__shine" x="-600" y="-170" width="390" height="1365" fill="url(#obShine)" transform="skewX(-18)"/></g>
    <g filter="url(#obSh)" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">
      <g class="ob-mk-speed">
        <path class="ob-mk ob-mk--l1" d="M472 356H316" stroke-width="56" stroke-opacity=".6" pathLength="1"/>
        <path class="ob-mk ob-mk--l2" d="M582 456H234" stroke-width="64" pathLength="1"/>
        <path class="ob-mk ob-mk--l3" d="M472 556H316" stroke-width="56" stroke-opacity=".6" pathLength="1"/>
      </g>
      <path class="ob-mk ob-mk--belt" d="M260 802H840" stroke="url(#obBelt)" stroke-width="38" pathLength="1"/>
      <g class="ob-mk-chev"><path class="ob-mk ob-mk--chev" d="M534 246L756 456L534 666" stroke-width="124" pathLength="1"/></g>
    </g>
    <path class="ob-mk-run" d="M840 802H260" fill="none" stroke="#fff" stroke-width="38" stroke-linecap="round" pathLength="1"/>
  </svg>
</div>`;

const BG = `<div class="ob-bg" aria-hidden="true">
  <div class="ob-bg__glow"></div>
  <div class="ob-bg__glow ob-bg__glow--b"></div>
  <div class="ob-bg__floor"><div class="ob-bg__belt"></div></div>
</div>`;

/* ───────────── Pantalla ───────────── */

export function mount(el) {
  el.classList.add('screen--fullscreen', 'ob-screen');
  const s0 = getState();
  const p0 = s0.profile || {};
  const age0 = p0.age || 46;
  const draft = {
    profile: {
      name: p0.name || '',
      age: age0,
      weightKg: p0.weightKg || 78,
      sex: p0.sex === 'f' ? 'f' : 'm',
      hrMax: p0.hrMax || hrMaxFromAge(age0),
      hrRest: p0.hrRest ?? null,
    },
    levels: { ...DEFAULT_LEVELS, ...(s0.levels || {}) },
    schedule: { weekdayMinutes: 20, thursdayMinutes: 50, weekendDay: 6, weekendMinutes: 50, reminderTime: '07:00', ...(s0.schedule || {}) },
    treadmill: { hasIncline: false, maxIncline: 12, minSpeed: 1, maxSpeed: 18, announceLead: 10, ...(s0.treadmill || {}) },
    audio: {
      voiceEnabled: true, voiceURI: null, rate: 1, pitch: 1, volume: 1, beeps: true, chattiness: 'normal', duckMusic: true, packId: PACK_ID,
      ...(s0.audio || {}),
    },
    integrations: { watchReminder: true, healthShortcut: '', ...(s0.integrations || {}) },
  };
  let hrAuto = !p0.hrMax || p0.hrMax === hrMaxFromAge(age0);
  let step = 0;
  let busy = false;
  let nativeBusy = false;     // app nativa: importando o recuperando una copia
  let finishing = false;
  let unsubVoices = null;
  const timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };

  el.innerHTML = `<div class="ob" data-step="welcome">
    ${BG}
    <header class="ob-top">
      <button type="button" class="btn-icon ob-back" aria-label="Atrás">${icon('chevron-left', 24)}</button>
      <div class="ob-steps" role="progressbar" aria-label="Progreso" aria-valuemin="1" aria-valuemax="${STEPS.length}" aria-valuenow="1">
        ${STEPS.map(() => '<span><i></i></span>').join('')}
      </div>
      <span class="ob-count num" aria-hidden="true">1/${STEPS.length}</span>
    </header>
    <div class="ob-stage"></div>
    <footer class="ob-foot">
      <button type="button" class="btn btn--primary btn--lg btn--block ob-next" aria-label="Empezar"><span class="ob-next__label">Empezar</span>${icon('chevron-right', 20)}</button>
      <p class="ob-foot__note">Lo dejamos listo en un minuto</p>
    </footer>
  </div>`;

  const ob = el.querySelector('.ob');
  const stage = ob.querySelector('.ob-stage');
  const nextBtn = ob.querySelector('.ob-next');
  const nextLabel = ob.querySelector('.ob-next__label');
  const footNote = ob.querySelector('.ob-foot__note');
  const steps = ob.querySelector('.ob-steps');
  const count = ob.querySelector('.ob-count');

  /* ── Pasos ── */

  function welcomeHtml() {
    return `<div class="ob-welcome">
      <div class="ob-hero">
        ${LOGO}
        <h1 class="ob-brand" tabindex="-1"><span>Best</span><span class="ob-brand__grad">Running</span></h1>
        <p class="ob-tagline">Tu entrenador personal de cinta</p>
      </div>
      <ul class="ob-features">
        <li style="--i:0"><span class="ob-features__icon">${icon('speaker', 20)}</span><span><b>Coach de voz</b> que te avisa antes de cada cambio de velocidad</span></li>
        <li style="--i:1"><span class="ob-features__icon">${icon('calendar', 20)}</span><span><b>Plan semanal</b> variado que se adapta a ti</span></li>
        <li style="--i:2"><span class="ob-features__icon">${icon('arrow-up', 20)}</span><span><b>Más rápido y más tiempo</b>, semana a semana</span></li>
      </ul>
      ${isNative() ? `<div class="ob-native" data-ob-native>${nativeDataHtml()}</div>` : ''}
    </div>`;
  }

  /* App nativa: traer los datos de la web de Safari (copia exportada) o la copia que guarda el propio iPhone. */
  function nativeDataHtml() {
    const st = getState();
    const empty = !st.onboarded && !(Array.isArray(st.history) && st.history.length);
    const b = nativeStatus()?.backup;
    const n = Number(b?.sessions) || 0;
    const when = Number(b?.savedAt) > 0 ? fmt.dateShort(todayKey(new Date(Number(b.savedAt)))) : '';
    const restore = empty && n > 0
      ? `<button type="button" class="btn btn--secondary btn--block ob-native__btn" data-ob-restore>${icon('refresh', 18)}<span>Recuperar tus datos de este iPhone (${esc(when ? `${when} · ` : '')}${n} ${n === 1 ? 'sesión' : 'sesiones'})</span></button>`
      : '';
    return `${restore}
      <label class="btn btn--ghost btn--block ob-native__btn" for="ob-import">${icon('download', 18)}<span>Ya usaba BestRunning: importar copia</span>
        <input id="ob-import" class="st-file" type="file" accept="application/json,.json"></label>`;
  }

  async function importCopy(input) {
    if (nativeBusy) return;
    nativeBusy = true;
    let ok = false;
    try {
      const m = await import('./settings.js');
      ok = await m.importBackup(input);
    } catch { ok = false; }
    nativeBusy = false;
    if (ok) navigate('#/today', { replace: true });
  }

  async function restoreNative(btn) {
    if (nativeBusy) return;
    nativeBusy = true;
    btn?.setAttribute('aria-disabled', 'true');
    haptic('medium');
    let ok = false;
    try {
      const { json } = await requestNativeBackup();
      ok = !!json && importState(json);
    } catch { ok = false; }
    nativeBusy = false;
    btn?.removeAttribute('aria-disabled');
    if (ok) {
      haptic('success');
      toast('Tus datos están de vuelta. ¡A correr!', { icon: 'check', kind: 'success' });
      navigate('#/today', { replace: true });
    } else {
      haptic('error');
      toast('No he podido recuperar la copia de este iPhone', { kind: 'error' });
    }
  }

  function hrMaxSlot() {
    return stepper({ id: 'ob-hrmax', value: draft.profile.hrMax, step: 1, min: 120, max: 220, unit: 'ppm', decimals: 0 });
  }

  function zonesHtml() {
    const zs = safe(() => hrZones(draft.profile.hrMax, draft.profile.hrRest), []);
    return zs
      .map((z) => `<div class="ob-hrz__z" style="--c:${z.color}"><span class="ob-hrz__bar"></span><b>Z${z.zone}</b><span class="num">${z.min}–${z.max}</span></div>`)
      .join('');
  }

  function aboutHtml() {
    const p = draft.profile;
    // En horizontal, las zonas de pulso acompañan a la explicación (izquierda) y se actualizan al tocar los controles.
    return `<div class="ob-step">
      <div class="ob-intro">
        <p class="eyebrow">Paso 2 de 5</p>
        <h1 class="ob-h1" tabindex="-1">Sobre ti</h1>
        <p class="ob-lead">Con esto calculo tus zonas de pulso y las calorías. Podrás cambiarlo cuando quieras.</p>
        <div class="ob-hr">
          <div class="ob-hr__head"><span class="eyebrow">Tus zonas de pulso</span><button type="button" class="ob-link" data-hr-auto ${hrAuto ? 'hidden' : ''}>${icon('refresh', 14)} Calcular por edad</button></div>
          <div class="ob-hrz" data-hrz>${zonesHtml()}</div>
          <p class="ob-note">FC máx. estimada con la fórmula de Tanaka (208&nbsp;−&nbsp;0,7&nbsp;×&nbsp;edad). Si tu Apple Watch te da otra, ajústala.</p>
        </div>
      </div>
      <div class="ob-body">
        <label class="ob-name">
          <span class="field__label">¿Cómo te llamas?</span>
          <input id="ob-name" class="field" type="text" autocomplete="given-name" autocapitalize="words" enterkeyhint="done"
            maxlength="24" placeholder="Tu nombre" value="${esc(p.name)}">
        </label>
        <div class="list ob-list">
          <div class="list__row"><span class="list__title">Edad</span><span class="spacer"></span>${stepper({ id: 'ob-age', value: p.age, step: 1, min: 14, max: 90, unit: 'años', decimals: 0 })}</div>
          <div class="list__row"><span class="list__title">Peso</span><span class="spacer"></span>${stepper({ id: 'ob-weight', value: p.weightKg, step: 1, min: 35, max: 180, unit: 'kg', decimals: 0 })}</div>
          <div class="list__row"><span class="list__title">Sexo</span><span class="spacer"></span>${segmented({ name: 'ob-sex', options: [{ value: 'm', label: 'Hombre' }, { value: 'f', label: 'Mujer' }], value: p.sex })}</div>
          <div class="list__row ob-hrrow">
            <span class="list__title">FC máxima<span class="list__sub" data-hr-hint>${hrAuto ? 'Calculada por tu edad' : 'Ajustada por ti'}</span></span>
            <span class="spacer"></span><span data-slot="hrmax">${hrMaxSlot()}</span>
          </div>
          <div class="list__row">
            <span class="list__title">FC en reposo<span class="list__sub">Opcional · mejora las zonas</span></span>
            <span class="spacer"></span>
            <input id="ob-hrrest" class="field ob-num" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="—"
              aria-label="Frecuencia cardiaca en reposo" value="${p.hrRest ?? ''}"><span class="ob-num__unit">ppm</span>
          </div>
        </div>
      </div>
    </div>`;
  }

  function ladderHtml() {
    const lv = draft.levels;
    const top = Math.max(lv.sprint || 13, 14) + 1;
    return LEVEL_KEYS.map((k) => {
      const h = clamp(((lv[k] || 0) - 5) / (top - 5), 0.12, 1);
      return `<div class="ob-ladder__col" style="--zc:var(--z-${k})">
        <span class="ob-ladder__val num" data-lval="${k}">${fmt.speed(lv[k])}</span>
        <span class="ob-ladder__bar" data-bar="${k}" style="--h:${h.toFixed(3)}"></span>
        <span class="ob-ladder__name">${esc(ZONES[k].short)}</span>
      </div>`;
    }).join('');
  }

  function speedsHtml() {
    const lv = draft.levels;
    const maxT = draft.treadmill.maxSpeed || 18;
    const rows = LEVEL_KEYS.map((k) => {
      const [lo, hi] = LEVEL_RANGES[k];
      return `<div class="ob-speed" style="--zc:var(--z-${k})">
        <span class="ob-speed__dot" aria-hidden="true"></span>
        <div class="ob-speed__text">
          <b>${esc(ZONES[k].name)}</b>
          <small>${esc(LEVEL_HINTS[k])}</small>
          <small class="ob-speed__pace num" data-pace="${k}">${fmt.pace(lv[k])} min/km</small>
        </div>
        ${stepper({ id: `ob-lv-${k}`, value: lv[k], step: 0.1, min: lo, max: Math.min(hi, maxT), unit: 'km/h', decimals: 1 })}
      </div>`;
    }).join('');
    return `<div class="ob-step">
      <div class="ob-intro">
        <p class="eyebrow">Paso 3 de 5</p>
        <h1 class="ob-h1" tabindex="-1">Tus velocidades</h1>
        <p class="ob-lead">Tus cuatro marchas en la cinta. El coach te las cantará en cada cambio.</p>
        <div class="ob-ladder" aria-hidden="true">${ladderHtml()}</div>
      </div>
      <div class="ob-body">
        <div class="ob-speeds">${rows}</div>
        <div class="ob-callout">${icon('sparkles', 18)}<span><b>Las iremos subiendo contigo.</b> Cuando una sesión te resulte cómoda, subimos 0,1 km/h. VAM estimada: <b class="num" data-vam>${fmt.speed(vamFromLevels(lv))}</b> km/h.</span></div>
      </div>
    </div>`;
  }

  function weekPreviewHtml() {
    const base = getState();
    const st = {
      ...base,
      levels: { ...draft.levels },
      schedule: { ...(base.schedule || {}), ...draft.schedule },
      treadmill: { ...(base.treadmill || {}), ...draft.treadmill },
      plan: { startDate: mondayOf(todayKey()), overrides: {} },
      history: [],
    };
    const days = safe(() => planWeek(st, mondayOf(todayKey())), null);
    if (!Array.isArray(days) || days.length !== 7) return '<p class="ob-note">La vista previa estará disponible en tu plan.</p>';
    const cats = [];
    let total = 0;
    let n = 0;
    const cols = days.map((d, i) => {
      const rest = d.kind === 'rest' || !d.workout;
      const cat = rest ? null : d.workout.category;
      const min = rest ? 0 : Math.round((d.workout.totalSec || d.minutes * 60) / 60);
      if (cat && !cats.includes(cat)) cats.push(cat);
      if (!rest) {
        total += min;
        n++;
      }
      const h = Math.min(1, min / 60).toFixed(3);
      return `<div class="ob-wk__day${rest ? ' is-rest' : ''}" style="${cat ? `--cc:var(--c-${cat})` : ''};--i:${i};--h:${h}">
        <span class="ob-wk__barwrap">${rest ? `<span class="ob-wk__rest">${icon('moon', 14)}</span>` : `<span class="ob-wk__bar"></span><span class="ob-wk__min num">${min}′</span>`}</span>
        <span class="ob-wk__wd">${fmt.weekdayShort(i + 1)}</span>
      </div>`;
    }).join('');
    const legend = cats
      .map((c) => `<span class="ob-wk__leg" style="--cc:var(--c-${c})"><i></i>${esc(CATEGORIES[c]?.name || c)}</span>`)
      .join('');
    return `<div class="ob-wk">${cols}</div>
      <div class="ob-wk__legend">${legend}</div>
      <p class="ob-wk__total">${n} sesiones · ${hm(total)} a la semana</p>`;
  }

  function weekHtml() {
    const sc = draft.schedule;
    const minsOpt = (opts, v) => withValue(opts, v).map((m) => ({ value: m, label: `${m}′` }));
    return `<div class="ob-step">
      <div class="ob-intro">
        <p class="eyebrow">Paso 4 de 5</p>
        <h1 class="ob-h1" tabindex="-1">Tu semana</h1>
        <p class="ob-lead">Te preparo ciclos de 4 semanas que suben la carga poco a poco y terminan con un test para medir tu progreso.</p>
        <div class="card ob-preview">
          <span class="eyebrow">Así queda tu semana</span>
          <div data-weekprev>${weekPreviewHtml()}</div>
        </div>
      </div>
      <div class="ob-body">
        <div class="ob-group">
          <div class="ob-group__head">${icon('bolt', 18)}<b>Lunes, martes, miércoles y viernes</b></div>
          ${segmented({ name: 'ob-wd', options: minsOpt([20, 25, 30], sc.weekdayMinutes), value: sc.weekdayMinutes })}
        </div>
        <div class="ob-group">
          <div class="ob-group__head">${icon('route', 18)}<b>Jueves</b><span>Sesión larga</span></div>
          ${segmented({ name: 'ob-thu', options: minsOpt([45, 50, 55, 60], sc.thursdayMinutes), value: sc.thursdayMinutes })}
        </div>
        <div class="ob-group">
          <div class="ob-group__head">${icon('sun', 18)}<b>Fin de semana</b><span>Un día largo, el otro descansas</span></div>
          ${segmented({ name: 'ob-wkday', options: [{ value: 6, label: 'Sábado' }, { value: 7, label: 'Domingo' }], value: sc.weekendDay === 7 ? 7 : 6 })}
          ${segmented({ name: 'ob-wkmin', options: minsOpt([45, 50, 55, 60], sc.weekendMinutes), value: sc.weekendMinutes })}
        </div>
        <div class="list ob-list">
          <div class="list__row">
            <span class="list__icon" style="background:var(--c-hills)">${icon('mountain', 18)}</span>
            <span class="list__title">¿Tu cinta tiene inclinación?<span class="list__sub">Activa las clases de cuestas</span></span>
            <span class="spacer"></span>${toggle({ id: 'ob-incline', checked: !!draft.treadmill.hasIncline, attrs: 'aria-label="Mi cinta tiene inclinación"' })}
          </div>
          <label class="list__row">
            <span class="list__icon" style="background:var(--info)">${icon('clock', 18)}</span>
            <span class="list__title">Hora habitual<span class="list__sub">Para avisos y calendario</span></span>
            <span class="spacer"></span>
            <input id="ob-time" class="ob-time" type="time" value="${esc(sc.reminderTime || '07:00')}" aria-label="Hora habitual de entrenamiento">
          </label>
        </div>
      </div>
    </div>`;
  }

  function voicesHtml() {
    const list = safe(() => (typeof speech.spanishVoices === 'function' ? speech.spanishVoices() : []), []) || [];
    const def = safe(() => (typeof speech.defaultVoice === 'function' ? speech.defaultVoice() : null), null);
    const sel = draft.audio.voiceURI;
    if (!list.length && draft.audio.packId !== PACK_ID) {
      return `<div class="ob-novoice">${icon('info', 18)}<span>Aún no veo voces en español. En el iPhone ve a <b>Ajustes → Accesibilidad → Contenido leído → Voces → Español</b> y descarga una voz «Mejorada» (Mónica o Jorge).</span></div>`;
    }
    const row = (uri, title, sub, badge, active) => `<button type="button" class="list__row ob-voice${active ? ' is-active' : ''}" data-voice="${esc(uri)}" aria-pressed="${active}"
        aria-label="${esc(`${title}${badge ? ` (${badge})` : ''}${sub ? `, ${sub}` : ''}`)}">
        <span class="ob-voice__wave" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="list__title">${esc(title)}<span class="list__sub">${esc(sub)}</span></span>
        <span class="spacer"></span>
        ${badge ? `<span class="badge ob-voice__badge">${esc(badge)}</span>` : ''}
        <span class="ob-voice__check" aria-hidden="true">${icon('check', 18, { stroke: 3 })}</span>
      </button>`;
    // Fase 2: la voz grabada (Eva Dorado) va primero; las del sistema quedan como alternativa y respaldo
    const pack = draft.audio.packId === PACK_ID;
    const rows = [
      row(EVA_KEY, 'Eva', 'Voz grabada, la más natural', 'Recomendada', pack),
      row('', 'Automática', def ? `Voz del iPhone · ${def.name}` : 'Voz del iPhone, la mejor disponible', '', !pack && !sel),
    ];
    for (const v of list.filter((x) => x.quality !== 'novelty').slice(0, 8)) {
      rows.push(row(v.voiceURI, v.name, v.lang, v.qualityLabel ?? voiceQuality(v), !pack && sel === v.voiceURI));
    }
    return `<div class="list ob-voices">${rows.join('')}</div>`;
  }

  function voiceHtml() {
    const a = draft.audio;
    return `<div class="ob-step">
      <div class="ob-intro">
        <p class="eyebrow">Paso 5 de 5</p>
        <h1 class="ob-h1" tabindex="-1">Tu coach de voz</h1>
        <p class="ob-lead">Te avisará ${draft.treadmill.announceLead || 10} segundos antes de cada cambio para que la cinta llegue a tiempo, y te animará cuando más lo necesites.</p>
        <button type="button" class="ob-test" data-voice-test aria-label="Probar voz. Sube el volumen y toca aquí">
          <span class="ob-test__orb" aria-hidden="true">${icon('speaker', 30)}<i></i><i></i></span>
          <span class="ob-test__text"><b>Probar voz</b><small>Sube el volumen y toca aquí</small></span>
        </button>
      </div>
      <div class="ob-body">
        <span class="eyebrow ob-sub">Voz</span>
        <div data-voices>${voicesHtml()}</div>
        <span class="eyebrow ob-sub">Nivel de charla</span>
        ${segmented({ name: 'ob-chat', options: [{ value: 'minimal', label: 'Mínimo' }, { value: 'normal', label: 'Normal' }, { value: 'coach', label: 'Coach' }], value: a.chattiness || 'normal' })}
        <p class="ob-note" data-chat-desc>${esc(CHAT_DESC[a.chattiness] || CHAT_DESC.normal)}</p>
        <div class="card ob-watch">
          <div class="ob-watch__head"><span class="ob-watch__icon">${icon('watch', 22)}</span><b>Tu Apple Watch también cuenta</b></div>
          <p>${isNative()
            ? 'El reloj se abre solo al empezar la clase y te pasa el pulso en directo.'
            : 'Al empezar cada clase, inicia en el reloj el entrenamiento <b>«Cinta de correr»</b>. Una web no puede leer el pulso en directo, así que al terminar lo importamos del Watch con un Atajo y verás tu pulso sobre el gráfico de la clase.'}</p>
          <div class="ob-watch__row"><span>Recordármelo al empezar</span><span class="spacer"></span>${toggle({ id: 'ob-watch', checked: draft.integrations.watchReminder !== false, attrs: 'aria-label="Recordarme iniciar el entrenamiento en el Apple Watch"' })}</div>
        </div>
      </div>
    </div>`;
  }

  const RENDER = [welcomeHtml, aboutHtml, speedsHtml, weekHtml, voiceHtml];

  /* ── Accesibilidad: nombres para los controles genéricos (steppers y segmentados) ── */

  const A11Y = {
    'ob-age': 'Edad',
    'ob-weight': 'Peso',
    'ob-hrmax': 'Frecuencia cardiaca máxima',
    'ob-sex': 'Sexo',
    'ob-wd': 'Minutos de lunes, martes, miércoles y viernes',
    'ob-thu': 'Minutos del jueves',
    'ob-wkday': 'Día largo del fin de semana',
    'ob-wkmin': 'Minutos del día largo',
    'ob-chat': 'Nivel de charla del coach',
  };
  for (const k of LEVEL_KEYS) A11Y[`ob-lv-${k}`] = `Velocidad de ${String(ZONES[k]?.name || k).toLowerCase()}`;

  function labelControls(root) {
    if (!root) return;
    safe(() => {
      root.querySelectorAll('[data-stepper][data-id]').forEach((g) => {
        const name = A11Y[g.dataset.id];
        if (!name) return;
        const low = name.charAt(0).toLowerCase() + name.slice(1);
        g.setAttribute('aria-label', name);
        g.querySelector('[role="spinbutton"]')?.setAttribute('aria-label', name);
        g.querySelector('[data-step-dir="-1"]')?.setAttribute('aria-label', `Bajar ${low}`);
        g.querySelector('[data-step-dir="1"]')?.setAttribute('aria-label', `Subir ${low}`);
      });
      root.querySelectorAll('[data-segmented][data-name]').forEach((g) => {
        const name = A11Y[g.dataset.name];
        if (name) g.setAttribute('aria-label', name);
      });
    }, null);
  }

  /* ── Navegación entre pasos ── */

  function updateChrome() {
    ob.dataset.step = STEPS[step];
    [...steps.children].forEach((s, i) => {
      s.classList.toggle('is-done', i < step);
      s.classList.toggle('is-current', i === step);
    });
    steps.setAttribute('aria-valuenow', String(step + 1));
    steps.setAttribute('aria-valuetext', `Paso ${step + 1} de ${STEPS.length}`);
    count.textContent = `${step + 1}/${STEPS.length}`;
    const label = step === 0 ? 'Empezar' : step === STEPS.length - 1 ? 'Crear mi plan' : 'Siguiente';
    nextLabel.textContent = label;
    nextBtn.setAttribute('aria-label', step === 0 || step === STEPS.length - 1 ? label : `Siguiente: paso ${step + 2} de ${STEPS.length}`);
    footNote.textContent = step === 0 ? 'Lo dejamos listo en un minuto' : step === STEPS.length - 1 ? 'Podrás cambiar todo en Perfil' : '';
    nextBtn.classList.toggle('ob-next--final', step === STEPS.length - 1);
  }

  function afterStep(panel) {
    unsubVoices?.();
    unsubVoices = null;
    if (STEPS[step] === 'voice' && typeof speech.onVoicesChanged === 'function') {
      unsubVoices = safe(() => speech.onVoicesChanged(() => renderVoices()), null);
    }
    panel.querySelectorAll('.ob-speed, .ob-group, .ob-list, .ob-preview, .ob-hr, .ob-test, .ob-watch, .ob-name, .ob-ladder, .ob-callout').forEach((n, i) => {
      n.classList.add('ob-rise');
      n.style.setProperty('--i', i);
    });
    labelControls(panel);
  }

  function goTo(next) {
    if (busy || next < 0 || next >= STEPS.length || next === step) return;
    const dir = next > step ? 'fwd' : 'back';
    const old = stage.querySelector('.ob-panel');
    const panel = document.createElement('div');
    panel.className = `ob-panel ob-panel--${STEPS[next]}`;
    panel.innerHTML = RENDER[next]();
    step = next;
    if (old && !reducedMotion()) {
      busy = true;
      panel.classList.add(`is-in-${dir}`);
      old.classList.add(`is-out-${dir}`);
      stage.appendChild(panel);
      later(() => {
        old.remove();
        panel.classList.remove(`is-in-${dir}`);
        busy = false;
      }, 460);
    } else {
      old?.remove();
      stage.appendChild(panel);
    }
    afterStep(panel);
    updateChrome();
    later(() => panel.querySelector('[tabindex="-1"]')?.focus({ preventScroll: true }), 60);
  }

  function renderVoices() {
    const slot = stage.querySelector('[data-voices]');
    if (slot) slot.innerHTML = voicesHtml();
  }

  function refreshZones() {
    const z = stage.querySelector('[data-hrz]');
    if (z) z.innerHTML = zonesHtml();
    const hint = stage.querySelector('[data-hr-hint]');
    if (hint) hint.textContent = hrAuto ? 'Calculada por tu edad' : 'Ajustada por ti';
    const auto = stage.querySelector('[data-hr-auto]');
    if (auto) auto.hidden = hrAuto;
  }

  function refreshHrMax() {
    const slot = stage.querySelector('[data-slot="hrmax"]');
    if (slot) {
      slot.innerHTML = hrMaxSlot();
      labelControls(slot);
    }
    refreshZones();
  }

  function refreshSpeeds() {
    const lv = draft.levels;
    const top = Math.max(lv.sprint || 13, 14) + 1;
    for (const k of LEVEL_KEYS) {
      const pace = stage.querySelector(`[data-pace="${k}"]`);
      if (pace) pace.textContent = `${fmt.pace(lv[k])} min/km`;
      const bar = stage.querySelector(`[data-bar="${k}"]`);
      if (bar) bar.style.setProperty('--h', clamp(((lv[k] || 0) - 5) / (top - 5), 0.12, 1).toFixed(3));
      const val = stage.querySelector(`[data-lval="${k}"]`);
      if (val) val.textContent = fmt.speed(lv[k]);
    }
    const vam = stage.querySelector('[data-vam]');
    if (vam) vam.textContent = fmt.speed(safe(() => vamFromLevels(lv), 0));
  }

  function refreshPreview() {
    const slot = stage.querySelector('[data-weekprev]');
    if (slot) slot.innerHTML = weekPreviewHtml();
  }

  /* ── Voz ── */

  function unlock() {
    safe(() => {
      const p = audioEngine.unlockAudio?.();
      p?.catch?.(() => {});
    }, null);
  }

  function say(text, btn) {
    if (typeof speech.speak !== 'function') {
      toast('La voz no está disponible en este navegador', { icon: 'speaker-off' });
      return;
    }
    const a = draft.audio;
    btn?.classList.add('is-speaking');
    const p = safe(
      () => speech.speak(text, { voiceURI: a.voiceURI || undefined, rate: a.rate, pitch: a.pitch, volume: a.volume, interrupt: true }),
      null
    );
    Promise.resolve(p)
      .catch(() => {})
      .finally(() => btn?.classList.remove('is-speaking'));
  }

  /** Aviso de ejemplo con las grabaciones de Eva (sin mezclar con la voz del sistema). true si ha sonado. */
  async function playEva(btn) {
    const res = await Promise.resolve(safe(() => audioEngine.loadPack?.(PACK_ID), null)).catch(() => null);
    const info = res?.ok && res.voice ? safe(() => audioEngine.packInfo?.(), null) : null;
    if (!info?.clips || typeof audioEngine.playClips !== 'function') return false;
    const pick = (l) => l[Math.floor(Math.random() * l.length)];
    const opt = { pick, available: info.clips };
    const speed = draft.levels.run;
    const a = safe(() => composeCue('pre', { speed, dir: 'up', zone: 'run' }, opt), null);
    const b = safe(() => composeCue('now', { zone: 'run', speed, sec: 120 }, opt), null);
    const ids = a && b ? [...a, ...b] : a || b;
    if (!ids) return false;
    btn?.classList.add('is-speaking');
    try {
      await audioEngine.playClips(ids);
      return true;
    } catch {
      return false;
    } finally {
      btn?.classList.remove('is-speaking');
    }
  }

  function sayIntro(btn) {
    const n = firstName(draft.profile.name);
    say(
      `¡Hola${n ? `, ${n}` : ''}! Soy tu coach. En 10 segundos, sube a ${fmt.speed(draft.levels.run)} kilómetros por hora. ¡Vamos, que tú puedes!`,
      btn
    );
  }

  function testVoice(btn) {
    unlock(); // en el mismo gesto: iOS solo permite audio tras una interacción
    haptic('light');
    if (draft.audio.packId === PACK_ID) {
      // Sin grabaciones (aún no subidas o sin red): la voz del sistema, como hará el coach
      playEva(btn).then((ok) => { if (!ok) sayIntro(btn); }).catch(() => sayIntro(btn));
    } else sayIntro(btn);
    later(renderVoices, 600); // las voces pueden aparecer tras el primer uso
  }

  function selectVoice(uri, btn) {
    haptic('selection');
    unlock();
    if (uri === EVA_KEY) {
      draft.audio.packId = PACK_ID;
      renderVoices();
      const row = stage.querySelector(`[data-voice="${EVA_KEY}"]`) || btn;
      playEva(row).then((ok) => { if (!ok) say('Hola, soy tu coach. ¡A correr!', row); }).catch(() => {});
      return;
    }
    draft.audio.packId = null;
    draft.audio.voiceURI = uri || null;
    const v = uri ? safe(() => speech.spanishVoices().find((x) => x.voiceURI === uri), null) : null;
    say(`Hola, soy ${v ? firstName(v.name) : 'tu coach'}. ¡A correr!`, btn);
    renderVoices();
  }

  /* ── Siguiente / Crear plan ── */

  function next() {
    if (busy || finishing) return;
    if (STEPS[step] === 'speeds') {
      const fixed = enforceLevelOrder({ ...draft.levels });
      const changed = LEVEL_KEYS.some((k) => fixed[k] !== draft.levels[k]);
      draft.levels = fixed;
      if (changed) {
        toast('He separado tus velocidades al menos 0,8 km/h entre sí', { icon: 'info' });
      }
    }
    if (step < STEPS.length - 1) {
      haptic('light');
      goTo(step + 1);
    } else {
      finish();
    }
  }

  function finish() {
    if (finishing) return;
    finishing = true;
    const today = todayKey();
    const levels = enforceLevelOrder({ ...draft.levels });
    for (const k of LEVEL_KEYS) levels[k] = round1(levels[k]);
    unlock();
    setState((d) => {
      d.profile = { ...(d.profile || {}), ...draft.profile, name: String(draft.profile.name || '').trim() };
      d.levels = { ...levels };
      d.schedule = { ...(d.schedule || {}), ...draft.schedule };
      d.treadmill = { ...(d.treadmill || {}), ...draft.treadmill };
      d.audio = { ...(d.audio || {}), ...draft.audio };
      d.integrations = { ...(d.integrations || {}), ...draft.integrations };
      d.plan = { ...(d.plan || {}), startDate: mondayOf(today), overrides: {} };
      if (!Array.isArray(d.levelHistory)) d.levelHistory = [];
      d.levelHistory.push({
        date: today,
        levels: { ...levels },
        reason: d.levelHistory.length ? 'manual' : 'init',
        note: 'Velocidades iniciales',
      });
      d.onboarded = true;
      d.createdAt = d.createdAt || new Date().toISOString();
    });
    haptic('success');
    safe(() => celebrate({ intensity: 1.2 }), null);
    nextBtn.classList.add('is-done');
    const doneText = `¡Plan creado${firstName(draft.profile.name) ? `, ${firstName(draft.profile.name)}` : ''}!`;
    nextBtn.setAttribute('aria-label', doneText);
    nextBtn.innerHTML = `${icon('check', 22, { stroke: 3 })}<span>${esc(doneText)}</span>`;
    later(() => navigate('#/today', { replace: true }), reducedMotion() ? 300 : 1100);
  }

  /* ── Eventos ── */

  const onClick = (e) => {
    const rb = e.target.closest('[data-ob-restore]');
    if (rb) return restoreNative(rb);
    if (e.target.closest('.ob-next')) return next();
    if (e.target.closest('.ob-back')) {
      haptic('light');
      return goTo(step - 1);
    }
    if (e.target.closest('[data-hr-auto]')) {
      hrAuto = true;
      draft.profile.hrMax = hrMaxFromAge(draft.profile.age);
      haptic('selection');
      return refreshHrMax();
    }
    const test = e.target.closest('[data-voice-test]');
    if (test) return testVoice(test);
    const v = e.target.closest('[data-voice]');
    if (v) return selectVoice(v.dataset.voice, v);
    return undefined;
  };

  const onChange = (e) => {
    const d = e.detail;
    if (d && d.id) {
      const val = Number(d.value);
      if (!Number.isFinite(val)) return;
      if (d.id === 'ob-age') {
        draft.profile.age = Math.round(val);
        if (hrAuto) {
          draft.profile.hrMax = hrMaxFromAge(draft.profile.age);
          refreshHrMax();
        }
      } else if (d.id === 'ob-weight') {
        draft.profile.weightKg = val;
      } else if (d.id === 'ob-hrmax') {
        draft.profile.hrMax = Math.round(val);
        hrAuto = draft.profile.hrMax === hrMaxFromAge(draft.profile.age);
        refreshZones();
      } else if (d.id.startsWith('ob-lv-')) {
        const k = d.id.slice(6);
        if (LEVEL_KEYS.includes(k)) {
          draft.levels[k] = round1(val);
          refreshSpeeds();
        }
      }
      return;
    }
    if (d && d.name) {
      const v = d.value;
      switch (d.name) {
        case 'ob-sex':
          draft.profile.sex = v === 'f' ? 'f' : 'm';
          break;
        case 'ob-wd':
          draft.schedule.weekdayMinutes = Number(v);
          refreshPreview();
          break;
        case 'ob-thu':
          draft.schedule.thursdayMinutes = Number(v);
          refreshPreview();
          break;
        case 'ob-wkday':
          draft.schedule.weekendDay = Number(v) === 7 ? 7 : 6;
          refreshPreview();
          break;
        case 'ob-wkmin':
          draft.schedule.weekendMinutes = Number(v);
          refreshPreview();
          break;
        case 'ob-chat': {
          draft.audio.chattiness = CHAT_DESC[v] ? v : 'normal';
          const desc = stage.querySelector('[data-chat-desc]');
          if (desc) desc.textContent = CHAT_DESC[draft.audio.chattiness];
          break;
        }
        default:
          break;
      }
      return;
    }
    const t = e.target;
    if (t.closest?.('#ob-incline')) {
      const input = t.matches('input') ? t : t.querySelector('input');
      draft.treadmill.hasIncline = !!input?.checked;
      haptic('selection');
      refreshPreview();
    } else if (t.closest?.('#ob-watch')) {
      const input = t.matches('input') ? t : t.querySelector('input');
      draft.integrations.watchReminder = !!input?.checked;
      haptic('selection');
    } else if (t.id === 'ob-time') {
      if (/^\d{2}:\d{2}/.test(t.value)) draft.schedule.reminderTime = t.value.slice(0, 5);
    } else if (t.id === 'ob-import') {
      importCopy(t);
    }
  };

  const onInput = (e) => {
    const t = e.target;
    if (t.id === 'ob-name') {
      draft.profile.name = t.value.slice(0, 24);
    } else if (t.id === 'ob-hrrest') {
      t.value = t.value.replace(/\D/g, '').slice(0, 3);
      const n = Number(t.value);
      draft.profile.hrRest = t.value && n >= 30 && n <= 120 ? n : null;
      refreshZones();
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && e.target.matches?.('input')) e.target.blur();
  };

  ob.addEventListener('click', onClick);
  ob.addEventListener('change', onChange);
  // App nativa: la copia del iPhone puede anunciarse (native.hello) con la bienvenida ya en pantalla
  const onNativeStatus = () => {
    const slot = stage.querySelector('[data-ob-native]');
    if (slot && !nativeBusy) slot.innerHTML = nativeDataHtml();
  };
  if (isNative()) window.addEventListener('br:native-status', onNativeStatus);
  ob.addEventListener('stepper:input', onChange); // valores en vivo mientras se mantiene pulsado
  ob.addEventListener('input', onInput);
  ob.addEventListener('keydown', onKey);

  // Primer paso sin transición.
  const first = document.createElement('div');
  first.className = 'ob-panel ob-panel--welcome';
  first.innerHTML = RENDER[0]();
  stage.appendChild(first);
  updateChrome();

  return () => {
    unsubVoices?.();
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    window.removeEventListener('br:native-status', onNativeStatus);
    ob.removeEventListener('click', onClick);
    ob.removeEventListener('change', onChange);
    ob.removeEventListener('stepper:input', onChange);
    ob.removeEventListener('input', onInput);
    ob.removeEventListener('keydown', onKey);
  };
}
