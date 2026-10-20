// BestRunning · resumen de la sesión (#/summary/:id): celebración, cifras, sensación, FC, notas y progresión.
// Pulso del Apple Watch (SPEC §12): importación vía Atajo + portapapeles, línea de pulso sobre el perfil,
// zonas de FC y pulso por velocidad; las casillas de media/máxima siguen como alternativa manual.
import { fmt, esc, clamp, round1, todayKey, capitalize } from '../core/utils.js';
import { ZONES, LEVEL_KEYS, estimateVo2max, vamFromLevels } from '../training/levels.js';
import { getState, setState, subscribe, lastPersistOk } from '../core/store.js';
import { navigate } from '../core/router.js';
import { icon, profileChart, zoneBar, zoneRibbon, effortBars, ring, openSheet, toast, confirmDialog, celebrate, emptyState } from '../ui/components.js';
import { haptic } from '../core/haptics.js';
import { workoutFromId } from '../training/generator.js';
import { applyFeedback, evaluateTest, FEELINGS, hrLevelTrends, sessionReachedEnd } from '../training/progression.js';
import { evaluateAchievements } from '../training/achievements.js';
import { traceCursorSec, skippedRanges } from '../training/stats.js';
import { sessionMusicHtml, hydrateSessionMusic } from '../integrations/session-music.js';
import { renderShareCard, shareSession } from '../integrations/share-card.js';
import { openHealthShortcut } from '../integrations/health.js';
import {
  startWatchHrImport, openWatchHrSheet, hasPendingWatchHr, hrFieldsFrom, hrFieldsCleared, hasHrSeries, hrZoneTimes,
  withHrOverlay, hrLegendHtml, hrZonesHtml, hrLevelsHtml, hrStatsHtml, hrMaxHintHtml, ensureWatchHrStyles, isWatchShortcutReady,
  HR_ENTRY_MIN, HR_ENTRY_MAX,
} from '../integrations/watch-hr.js';
import { isNative, nativeStatus, healthMissingOf } from '../integrations/native-bridge.js';
import { diagMark } from '../core/diag.js';

const CAT_NAMES = {
  intervals: 'Intervalos', tempo: 'Tempo', endurance: 'Resistencia', fartlek: 'Fartlek',
  hills: 'Cuestas', recovery: 'Recuperación', challenge: 'Retos', test: 'Test',
};
const LOCAL_FEELINGS = [
  { key: 'easy', label: 'Muy fácil', rpe: 3 },
  { key: 'ok', label: 'Cómodo', rpe: 5 },
  { key: 'hard', label: 'Exigente', rpe: 7 },
  { key: 'max', label: 'Al límite', rpe: 9 },
  { key: 'fail', label: 'No pude', rpe: 10 },
];
/** Escala de esfuerzo (v2, monocroma): cinco barras crecientes, encendidas hasta el nivel de la sensación (1–5). */
const FEEL_HINTS = {
  easy: '¡Genial! Si se te sigue haciendo fácil, subiremos el ritmo.',
  ok: 'Perfecto: así es como se progresa. Unas cuantas más así y subimos.',
  hard: 'Exigente es bueno: estás construyendo. Mantenemos las velocidades.',
  max: 'Lo has dado todo. Vigilaremos la carga para que asimiles.',
  fail: 'Pasa a todo el mundo. Ajustaremos un poco para que la próxima salga redonda.',
};
/** Pista bajo las caras: coherente con lo que hará la progresión (sesión a medias o test). */
function feelHint(key, s) {
  if (!key) return 'Lo usamos para ajustar tus velocidades.';
  if (s?.isTest) return 'En el test mandan los escalones: tu sensación queda anotada para el historial.';
  const pct = Number(s?.completionPct);
  if (Number.isFinite(pct) && pct < 0.85) {
    if (key === 'easy' || key === 'ok') return 'Anotado. Como la clase no se completó entera, hoy mantenemos tus velocidades.';
    if (!sessionReachedEnd(s)) return 'Anotado. Terminaste antes y te costó: aligeraremos un poco la próxima.';
  }
  return FEEL_HINTS[key] || '';
}
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const feelings = () => (Array.isArray(FEELINGS) && FEELINGS.length ? FEELINGS : LOCAL_FEELINGS);
const zoneName = (z) => ZONES[z]?.name || z;
const zoneColor = (z) => ZONES[z]?.color || '#ff6a1a';
const WATCH_WAIT_MS = 10 * 60000;  // app nativa: el pulso del reloj suele llegar en segundos; se espera hasta 10 min
/** App nativa con BestRunning instalada en un Apple Watch emparejado (y con permiso de Salud: sin él, el pulso del
 *  reloj no llega nunca y no tiene sentido esperar 10 min; se ofrece el Atajo enseguida). */
const watchManaged = () => {
  const ns = nativeStatus();
  const w = ns?.watch;
  return !!(w && w.paired && w.installed) && healthMissingOf(ns) !== 'denied';
};

export function mount(el, { params = {} } = {}) {
  el.classList.add('screen--fullscreen', 'sm-screen');
  ensureWatchHrStyles();
  const id = String(params.id || '');
  const timers = new Set();
  let disposed = false;
  let stopHr = null;          // escucha de vuelta desde Atajos
  let editing = false;
  let draft = null;           // { feeling, hrAvg, hrMax, notes }
  let celebrated = false;
  let cardBlob = null;
  let cardKey = '';
  let cardPromise = null;
  let saving = false;
  let waitT = null;           // app nativa: fin de la espera del pulso del reloj

  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); if (!disposed) fn(); }, ms);
    timers.add(t);
    return t;
  };

  const findSession = () => (getState().history || []).find((s) => s && s.id === id) || null;

  function workoutFor(session) {
    if (!session?.workoutId) return null;
    try {
      const st = getState();
      // Perfil con las velocidades con las que se entrenó
      const levels = session.levelsAtStart && typeof session.levelsAtStart === 'object' ? session.levelsAtStart : st.levels;
      return workoutFromId(session.workoutId, { ...st, levels });
    } catch {
      return null;
    }
  }

  let session = findSession();
  let workout = workoutFor(session);
  render();
  // La app pudo recargarse mientras estabas en Atajos: retomamos la importación
  if (session && !hasHrSeries(session) && hasPendingWatchHr(id)) later(openHrSheet, 650);

  const unsub = subscribe(() => {
    if (disposed || saving) return;
    const next = findSession();
    // Sólo repinta solo si no hay un formulario a medias
    if (!next) { session = null; render(); return; }
    if (next !== session && (!isFormMode() || !draftDirty())) { session = next; render(); }
  });

  // App nativa: el pulso del reloj (y «Guardado en Salud») llega solo, a veces con el resumen ya abierto. El borrador
  // toma la media y la máxima nuevas: si no, «Guardar» pisaría el pulso recién llegado con las casillas vacías.
  const onNativeHr = (e) => {
    if (disposed || String(e?.detail?.sessionId || '') !== id) return;
    const next = findSession();
    if (!next) return;
    if (draft && next.hrAvg != null) { draft.hrAvg = next.hrAvg ?? null; draft.hrMax = next.hrMax ?? null; }
    const rated = !isFormMode();
    session = next;
    invalidateCard();
    render();
    // Con la sesión ya valorada, los logros de pulso se evalúan aquí (si no, al pulsar Guardar), como con el Atajo
    if (rated && hasHrSeries(next)) later(awardAchievements, 1700);
  };
  window.addEventListener('br:native-hr', onNativeHr);

  return () => {
    disposed = true;
    window.removeEventListener('br:native-hr', onNativeHr);
    unsub();
    stopHr?.();
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };

  /* ═════════════════ Render ═════════════════ */
  function isFormMode() { return !session?.feeling || editing; }
  function draftDirty() {
    if (!draft || !session) return false;
    return draft.feeling !== (session.feeling ?? null) || (draft.notes || '') !== (session.notes || '')
      || draft.hrAvg !== (session.hrAvg ?? null) || draft.hrMax !== (session.hrMax ?? null);
  }

  function render() {
    if (!session) {
      el.innerHTML = `
        <div class="sm sm--empty">
          <header class="sm-top"><button class="sm-iconbtn" data-href="#/today" aria-label="Cerrar">${icon('close', 20)}</button>
            <div class="sm-top__title">Resumen</div><span class="sm-top__spacer"></span></header>
          <div class="sm-scroll"><div class="container sm-content">
            ${emptyState({
              icon: 'info',
              title: 'Sesión no encontrada',
              text: 'Puede que la hayas borrado del historial.',
              action: '<button class="btn btn--primary" data-href="#/today">Volver a Hoy</button>',
            })}
          </div></div>
        </div>`;
      return;
    }
    const form = isFormMode();
    if (form && !draft) {
      draft = { feeling: session.feeling ?? null, hrAvg: session.hrAvg ?? null, hrMax: session.hrMax ?? null, notes: session.notes || '' };
    }
    const st = getState();
    const s = session;
    const pct = clamp(Number(s.completionPct) || 0, 0, 1);
    const pctTxt = `${Math.round(pct * 100)} %`;
    // Estado pequeño del héroe (✓ verde solo si se completó): el título es la clase
    const status = s.isTest ? (pct >= 0.9 ? 'Test completado' : 'Test terminado')
      : s.completed ? 'Entrenamiento completado'
      : `${pctTxt} completado`;
    const done = s.isTest ? pct >= 0.9 : !!s.completed;
    const dateLbl = s.dayKey ? capitalize(fmt.dateLong(s.dayKey)) : '';
    const cat = s.category || workout?.category || null;
    const badges = recordBadges(s, st.history || []);
    const sub = [dateLbl, cat ? (CAT_NAMES[cat] || cat) : '', fmt.durationLong(s.elapsedSec || 0)].filter(Boolean).join(' · ');
    const km = s.distanceKm || 0;
    const sixth = s.hrAvg
      ? statCell({ label: 'Pulso medio', value: fmt.int(s.hrAvg), unit: 'ppm', count: s.hrAvg, kind: 'int' })
      : statCell({ label: 'Completado', value: String(Math.round(pct * 100)), unit: '%', count: Math.round(pct * 100), kind: 'int' });

    el.innerHTML = `
      <div class="sm ${s.completed ? 'sm--done' : ''}">
        <header class="sm-top">
          <button class="sm-iconbtn" data-act="close" aria-label="Cerrar">${icon('close', 17)}</button>
          <div class="sm-top__title">Resumen</div>
          <button class="sm-iconbtn" data-act="share" aria-label="Compartir tarjeta">${icon('share', 18)}</button>
        </header>
        <div class="sm-scroll">
          <div class="container sm-content">
            <div class="sm-side stagger">
            <section class="sm-hero" style="--i:0">
              <div class="sm-hero__status">${done
                ? `<span class="sm-hero__check" aria-hidden="true">${icon('check', 12)}</span>`
                : ring({ value: pct, size: 18, stroke: 2.5, track: 'var(--surface-3)' })}<span>${esc(status)}</span></div>
              <h1 class="sm-hero__title">${esc(s.title || 'Entrenamiento')}</h1>
              <p class="sm-hero__sub">${esc(sub)}</p>
              <div class="sm-hero__big sm-stat" data-count="${Number(km)}" data-kind="km" data-final="${esc(fmt.km(km))}">
                <span class="sm-hero__num">${esc(fmt.km(km))}</span>
                <span class="sm-hero__unit">Kilómetros</span>
              </div>
              ${badges.length ? `<div class="sm-badges">${badges.map((b) => `<span class="sm-badge${b.record ? '' : ' is-muted'}">${icon(b.icon, 15)}${esc(b.text)}</span>`).join('')}</div>` : ''}
            </section>
            </div>
            <div class="sm-main stagger">
            <section class="card sm-stats" style="--i:1">
              <div class="stat-grid">
                ${statCell({ label: 'Tiempo', value: fmt.clock(s.elapsedSec || 0), count: s.elapsedSec || 0, kind: 'clock' })}
                ${statCell({ label: 'Ritmo medio', value: s.avgSpeed > 0 ? fmt.pace(s.avgSpeed) : '–:––', unit: '/km' })}
                ${statCell({ label: 'Kcal', value: fmt.int(s.kcal || 0), count: s.kcal || 0, kind: 'int' })}
                ${statCell({ label: 'Vel. media', value: fmt.speed(s.avgSpeed || 0), unit: 'km/h', count: s.avgSpeed || 0, kind: 'speed' })}
                ${statCell({ label: 'Vel. máx.', value: fmt.speed(s.maxSpeed || 0), unit: 'km/h', count: s.maxSpeed || 0, kind: 'speed' })}
                ${sixth}
              </div>
            </section>

            ${s.isTest ? testCard(s, st) : ''}

            <section class="card sm-card" style="--i:3">
              <div class="sm-card__head"><span class="sm-card__title">Plan vs real</span>
                <span class="sm-legend"><i class="sm-legend__bar"></i>Plan <i class="sm-legend__line"></i>Real${hasHrSeries(s) ? hrLegendHtml() : ''}</span></div>
              <div class="sm-chart">
                ${workout?.segments?.length
                  ? withHrOverlay(profileChart(workout.segments, { height: 140, tone: 'mono', trace: Array.isArray(s.speedTrace) ? s.speedTrace : null, progressSec: s.isTest || s.completed ? null : traceCursorSec(s), gaps: skippedRanges(s) }), s, { segments: workout.segments, height: 140 })
                  : `<p class="muted sm-note">No hay perfil disponible para esta clase.</p>`}
                ${zoneRibbon(workout?.segments)}
              </div>
              ${adjustChips(s)}
            </section>

            <section class="card sm-card" style="--i:4">
              <div class="sm-card__head"><span class="sm-card__title">Tiempo en zonas</span></div>
              ${zoneBar(s.timeInZone || {}, { showLegend: true })}
            </section>

            ${hasHrSeries(s) ? hrAnalysis(s, st) : ''}

            ${form ? formSections(s, st) : readOnlySections(s, st)}
            </div>
          </div>
        </div>
        <div class="sm-cta">
          ${form
            ? `<button class="btn btn--primary btn--lg btn--block sm-save" data-act="save" ${draft?.feeling ? '' : 'aria-disabled="true"'}>
                 <span>${editing ? 'Guardar cambios' : 'Guardar'}</span></button>
               ${editing ? '<button class="btn btn--plain btn--block" data-act="cancel-edit">Cancelar</button>' : ''}`
            : `<button class="btn btn--primary btn--lg btn--block" data-act="home"><span>Volver a Hoy</span></button>`}
        </div>
      </div>`;

    bind();
    countUp();
    hydrateSessionMusic(el, s, () => !disposed);
    // Confeti sobrio solo con un récord personal real (no por terminar ni por la primera sesión)
    if (!celebrated && !s.feeling && badges.some((b) => b.record)) {
      celebrated = true;
      later(() => { try { celebrate({ intensity: 1 }); } catch { /* sin confeti */ } }, 420);
    }
    // Prepara la tarjeta en segundo plano: así compartir no pierde el gesto en iOS
    later(prepareCard, 900);
  }

  /** Celda de la rejilla de métricas (misma estructura que stat(): el recuento busca el texto de la cifra). */
  function statCell({ label, value, unit = '', count = null, kind = '' }) {
    const attrs = count != null && kind ? ` data-count="${Number(count)}" data-kind="${kind}" data-final="${esc(value)}"` : '';
    return `<div class="stat sm-stat"${attrs}>
      <div class="stat__label"><span>${esc(label)}</span></div>
      <div class="stat__value">${esc(value ?? '–')}${unit ? `<span class="stat__unit">${esc(unit)}</span>` : ''}</div>
    </div>`;
  }

  function testCard(s, st) {
    let res = null;
    try { res = evaluateTest(s); } catch { res = null; }
    const vam = res?.vam ?? s.test?.vam ?? null;
    if (!vam) {
      return `<section class="card sm-card sm-test" style="--i:2"><div class="sm-card__title">Test VAM</div>
        <p class="muted sm-note">No llegamos a registrar ningún escalón. Repite el test cuando estés fresco.</p></section>`;
    }
    const vo2 = res?.vo2max ?? estimateVo2max(vam);
    const lv = res?.levels || null;
    const delta = res?.deltaVam;
    return `
      <section class="card sm-card sm-test" style="--i:2">
        <div class="sm-card__head"><span class="sm-card__title">Resultado del test</span></div>
        <div class="sm-test__row">
          <div class="sm-test__big"><span class="num">${fmt.speed(vam)}</span><small>km/h</small><em>VAM</em></div>
          <div class="sm-test__big sm-test__big--alt"><span class="num">${fmt.dec1(vo2)}</span><small>ml/kg/min</small><em>VO₂máx est.</em></div>
        </div>
        ${Number.isFinite(delta) && delta !== 0 ? `<p class="sm-test__delta ${delta > 0 ? 'is-up' : 'is-down'}">${icon(delta > 0 ? 'arrow-up' : 'arrow-down', 14)}${delta > 0 ? '+' : '−'}${fmt.speed(Math.abs(delta))} km/h respecto al anterior</p>` : ''}
        ${lv && !s.feeling ? `
          <div class="sm-test__levels">
            ${LEVEL_KEYS.map((k) => `<div class="sm-test__lv" style="--zc:${zoneColor(k)}"><span>${esc(ZONES[k].short)}</span><b class="num">${fmt.speed(lv[k])}</b></div>`).join('')}
          </div>
          <p class="muted sm-note">Al guardar, ajustaremos tus velocidades a este resultado.</p>` : ''}
      </section>`;
  }

  function adjustChips(s) {
    const adj = Object.entries(s.adjustments || {}).filter(([, v]) => Number(v));
    if (!adj.length) return '';
    return `<div class="sm-adjs">${adj.map(([z, v]) => `<span class="sm-adj" style="--zc:${zoneColor(z)}">${esc(ZONES[z]?.short || z)} <b class="num">${v > 0 ? '+' : '−'}${fmt.speed(Math.abs(v))}</b> km/h</span>`).join('')}</div>`;
  }

  function formSections(s) {
    const f = draft || {};
    return `
      <section class="card sm-card sm-feel" style="--i:5">
        <div class="sm-card__head"><span class="sm-card__title">¿Cómo te has sentido?</span></div>
        <div class="sm-faces" role="radiogroup" aria-label="Sensación">
          ${feelings().map((x, i) => `
            <button class="sm-face ${f.feeling === x.key ? 'is-picked' : ''}" role="radio" aria-checked="${f.feeling === x.key}" aria-label="${esc(x.label)}"
                    data-feel="${esc(x.key)}" style="--i:${i}">
              ${effortBars(i + 1)}
              <span class="sm-face__lbl">${esc(x.label)}</span>
            </button>`).join('')}
        </div>
        <p class="sm-feel__hint" data-feel-hint>${esc(feelHint(f.feeling, s))}</p>
      </section>

      ${pulseCard(s, f)}

      ${sessionMusicHtml(s, { variant: 'summary', index: 7 })}

      <section class="card sm-card" style="--i:7">
        <div class="sm-card__head"><span class="sm-card__title">Notas</span><span class="sm-opt">Opcional</span></div>
        <textarea class="field sm-notes" rows="3" maxlength="500" data-notes
          placeholder="¿Algo que destacar? Molestias, cómo dormiste, la música…">${esc(f.notes || '')}</textarea>
      </section>

      ${extraActions(s, false)}`;
  }

  function readOnlySections(s) {
    const fi = feelings().findIndex((x) => x.key === s.feeling);
    const fx = fi >= 0 ? feelings()[fi] : null;
    const changes = Array.isArray(s.levelChanges) ? s.levelChanges : [];
    return `
      <section class="card sm-card sm-ro" style="--i:5">
        <div class="sm-card__head"><span class="sm-card__title">Sensación</span>
          <button class="btn btn--ghost sm-edit" data-act="edit"><span>Editar</span></button></div>
        <div class="sm-ro__feel">
          ${effortBars(fi >= 0 ? fi + 1 : 0)}
          <div><b>${esc(fx?.label || '—')}</b>${s.rpe ? `<span class="muted"> · Esfuerzo ${s.rpe}/10</span>` : ''}</div>
        </div>
        ${!hasHrSeries(s) && (s.hrAvg || s.hrMax) ? `
          <div class="sm-ro__hr">
            ${s.hrAvg ? `<div>${icon('heart', 16)}<span class="muted">Media</span><b class="num">${s.hrAvg}</b><small>ppm</small></div>` : ''}
            ${s.hrMax ? `<div>${icon('heart', 16)}<span class="muted">Máxima</span><b class="num">${s.hrMax}</b><small>ppm</small></div>` : ''}
          </div>` : ''}
        ${s.notes ? `<p class="sm-ro__notes">${esc(s.notes)}</p>` : ''}
        ${changes.length ? `
          <div class="sm-ro__changes">
            <div class="sm-ro__label">Cambios de nivel</div>
            ${changes.map((c) => levelRow(c)).join('')}
          </div>` : ''}
      </section>
      ${isNative() && !hasHrSeries(s) && watchWaitMs(session) <= 0 ? '' : `<section class="card sm-card whr-card" style="--i:6">
        <div class="sm-card__head"><span class="sm-card__title">Pulso · Apple Watch</span>${hasHrSeries(s) ? `<span class="sm-opt">${hrLabel(s)}</span>` : ''}</div>
        ${hasHrSeries(s) ? hrImported(s) : hrCta()}
      </section>`}
      ${sessionMusicHtml(s, { variant: 'summary', index: 7 })}
      ${extraActions(s, true)}`;
  }

  /* ═════════════════ Pulso del Apple Watch ═════════════════ */
  function manualHr(f) {
    return `<div class="sm-hr">
          <label class="sm-hr__field">
            <span class="field__label">Media</span>
            <span class="sm-hr__box"><input class="field sm-hr__input num" type="number" inputmode="numeric" pattern="[0-9]*" min="40" max="240"
              placeholder="—" data-hr="hrAvg" value="${f.hrAvg ?? ''}" aria-label="Frecuencia cardiaca media"><span class="sm-hr__u">ppm</span></span>
          </label>
          <label class="sm-hr__field">
            <span class="field__label">Máxima</span>
            <span class="sm-hr__box"><input class="field sm-hr__input num" type="number" inputmode="numeric" pattern="[0-9]*" min="40" max="240"
              placeholder="—" data-hr="hrMax" value="${f.hrMax ?? ''}" aria-label="Frecuencia cardiaca máxima"><span class="sm-hr__u">ppm</span></span>
          </label>
        </div>`;
  }

  /** Etiqueta del pulso guardado: el del reloj (app nativa) o el importado con el Atajo. */
  function hrLabel(s) {
    return s?.hrSource ? 'Del Apple Watch' : 'Importado';
  }

  /** App nativa con BestRunning en el reloj: ms que quedan de espera a su pulso (sesión de hace < 10 min sin pulso), o 0.
   *  Sin la app del reloj no hay nada que esperar: se ofrece el Atajo enseguida. */
  function watchWaitMs(s) {
    if (!s || !isNative() || !watchManaged() || hasHrSeries(s)) return 0;
    let end = Date.parse(s.endedAt || '');
    if (!Number.isFinite(end)) end = Date.parse(s.startedAt || '') + ((Number(s.elapsedSec) || 0) + (Number(s.pausedSec) || 0)) * 1000;
    if (!Number.isFinite(end)) return 0;
    return Math.max(0, end + WATCH_WAIT_MS - Date.now());
  }

  /**
   * Tarjeta del pulso. En la app nativa el reloj manda el pulso solo: nada de Atajo ni de «Ya lo he copiado» o
   * «anótalo a mano» (si no llegó, la tarjeta no sale); en Safari, el flujo del Atajo como siempre.
   */
  function pulseCard(s, f) {
    const has = hasHrSeries(s);
    const native = isNative();
    if (native && !has && watchWaitMs(session) <= 0) return '';
    return `<section class="card sm-card whr-card" style="--i:6">
        <div class="sm-card__head"><span class="sm-card__title">Pulso · Apple Watch</span><span class="sm-opt">${has ? hrLabel(s) : native ? '' : 'Opcional'}</span></div>
        ${has ? hrImported(s) : hrCta()}
        ${has
          ? `<details class="whr-details whr-manual-hr"><summary>Corregir a mano</summary>${manualHr(f)}</details>`
          : native ? '' : `<span class="sm-ro__label">O anótalo a mano</span>${manualHr(f)}`}
        <p class="muted sm-note">${native
          ? 'Con BestRunning en el reloj, el pulso llega solo al terminar.'
          : 'Una web no puede leer el pulso del Watch en directo: el Atajo lo trae de Salud al terminar. También ves la media y la máxima en la app Fitness.'}</p>
      </section>`;
  }

  function hrCta() {
    const wait = watchWaitMs(session);
    if (wait > 0) {
      // Pasada la espera, vuelve el botón del Atajo (respaldo si el reloj no llegó a mandar nada)
      if (!waitT) waitT = later(() => { waitT = null; render(); }, wait + 500);
      return `<div class="whr-cta" role="status">
          <div class="whr-cta__row">
            <span class="whr-cta__icon" aria-hidden="true">${icon('watch', 24)}<i class="whr-beat">${icon('heart', 12, { stroke: 2.6 })}</i></span>
            <div><b class="whr-cta__title">Esperando el pulso del Apple Watch…</b>
              <p class="whr-cta__text">Llega solo en cuanto el reloj guarda el entreno en Salud. Mientras, puedes valorar la sesión.</p></div>
          </div>
        </div>`;
    }
    const ready = isWatchShortcutReady(getState());
    return `<div class="whr-cta">
          <div class="whr-cta__row">
            <span class="whr-cta__icon" aria-hidden="true">${icon('watch', 24)}<i class="whr-beat">${icon('heart', 12, { stroke: 2.6 })}</i></span>
            <div><b class="whr-cta__title">Tu corazón, sobre el perfil</b>
              <p class="whr-cta__text">Un Atajo lee de Salud el pulso de esta sesión y lo trae aquí: gráfico, zonas de FC y pulso a cada velocidad.</p></div>
          </div>
          <button type="button" class="btn btn--secondary btn--lg btn--block whr-cta__btn" data-act="hr-import">${icon('heart', 20)}<span>Importar pulso del Apple Watch</span></button>
          <div class="whr-cta__links">
            <button type="button" class="btn btn--ghost whr-mini" data-act="hr-paste">${icon('copy', 15)}<span>Ya lo he copiado</span></button>
            ${ready || isFormMode() ? '' : `<button type="button" class="btn btn--ghost whr-mini" data-href="#/settings/watch">${icon('info', 15)}<span>Cómo crear el Atajo</span></button>`}
          </div>
        </div>`;
  }

  function hrImported(s) {
    const mins = Math.round(((s.hrSeries?.length || 0) * 10) / 60);
    return `${hrStatsHtml(s, getState().profile)}
        ${hrMaxHintHtml(s, getState().profile)}
        <div class="whr-src">${icon('heart', 14)}<span>${mins ? `${mins} min de pulso` : 'Pulso'} · Apple Watch</span>
          <span class="whr-src__acts">
            <button type="button" class="btn btn--ghost whr-mini" data-act="hr-import" aria-label="Volver a importar el pulso">${icon('refresh', 14)}<span>Reimportar</span></button>
            <button type="button" class="btn btn--ghost whr-mini" data-act="hr-remove" aria-label="Quitar el pulso de esta sesión">${icon('trash', 14)}<span>Quitar</span></button>
          </span></div>`;
  }

  function hrAnalysis(s, st) {
    let trends = {};
    try { trends = hrLevelTrends(st, s) || {}; } catch { trends = {}; }
    let zt = null;
    try { zt = hrZoneTimes(s.hrSeries, st.profile); } catch { zt = s.hrZones || null; }
    return `
      <section class="card sm-card" style="--i:5">
        <div class="sm-card__head"><span class="sm-card__title">Zonas de pulso</span><span class="sm-opt">Apple Watch</span></div>
        ${hrZonesHtml(zt, st.profile)}
      </section>
      <section class="card sm-card" style="--i:5">
        <div class="sm-card__head"><span class="sm-card__title">Pulso por velocidad</span></div>
        ${hrLevelsHtml(trends, st.profile)}
      </section>`;
  }

  function hrOpts() {
    // Sin valorar aún, no sacamos al usuario del resumen (la progresión se aplica al pulsar Guardar)
    return { getSession: findSession, getState, onImported: saveHr, showSettingsLink: !isFormMode() };
  }

  function onHrImport() {
    if (!findSession()) return;
    haptic('light');
    stopHr?.();
    stopHr = startWatchHrImport(hrOpts());
  }

  function openHrSheet() {
    if (disposed || !findSession()) return;
    openWatchHrSheet(hrOpts()).catch(() => {});
  }

  /** Guarda el pulso importado en la sesión (y en el borrador, para que «Guardar» no lo pise). */
  function saveHr(res) {
    if (disposed || !findSession()) return false;
    const fields = hrFieldsFrom(res, getState().profile);
    if (draft) { draft.hrAvg = fields.hrAvg; draft.hrMax = fields.hrMax; }
    const wasForm = isFormMode();
    saving = true;
    try {
      setState((d) => {
        const h = (d.history || []).find((x) => x.id === id);
        if (h) Object.assign(h, fields);
      });
    } finally {
      saving = false;
    }
    session = findSession();
    invalidateCard();
    render();
    // Con la sesión ya valorada, los logros se evalúan aquí (si no, al pulsar Guardar)
    if (!wasForm) later(awardAchievements, 1700);
    return true;
  }

  async function onHrRemove() {
    let ok = false;
    try {
      ok = await confirmDialog({
        title: '¿Quitar el pulso?',
        message: 'Se borrarán el gráfico y las zonas de pulso de esta sesión. Podrás volver a importarlo cuando quieras.',
        confirmText: 'Quitar',
        cancelText: 'Cancelar',
        destructive: true,
      });
    } catch { ok = false; }
    if (!ok || disposed) return;
    if (draft) { draft.hrAvg = null; draft.hrMax = null; }
    saving = true;
    try {
      setState((d) => {
        const h = (d.history || []).find((x) => x.id === id);
        if (h) Object.assign(h, hrFieldsCleared());
      });
    } finally {
      saving = false;
    }
    session = findSession();
    invalidateCard();
    haptic('success');
    render();
    toast('Pulso quitado de la sesión', { icon: 'check' });
  }

  function awardAchievements() {
    let newAch = [];
    try { newAch = (evaluateAchievements(getState()) || []).filter((a) => a && a.id); } catch { newAch = []; }
    if (!newAch.length) return;
    const now = new Date().toISOString();
    setState((d) => {
      if (!d.achievements || typeof d.achievements !== 'object') d.achievements = {};
      for (const a of newAch) if (!d.achievements[a.id]) d.achievements[a.id] = now;
    });
    toast(newAch.length === 1 ? `Logro desbloqueado: ${newAch[0].title || 'nuevo logro'}` : `${newAch.length} logros desbloqueados`, { icon: 'medal', kind: 'success', duration: 3600 });
  }

  function extraActions(s) {
    const shortcut = (getState().integrations?.healthShortcut || '').trim();
    // App nativa: el reloj guarda el entreno en Salud él solo (con pulso, distancia y calorías)
    let health;
    if (s?.health?.uuid) health = `<p class="muted sm-note sm-health">${icon('check', 15)} Guardado en Salud</p>`;
    else if (isNative() && watchManaged()) health = `<p class="muted sm-note sm-health">${icon('watch', 15)} Se guarda en Salud desde el reloj</p>`;
    else if (shortcut) health = `<button class="btn btn--secondary btn--block" data-act="health">${icon('heart', 18)}<span>Guardar en Salud</span></button>`;
    else health = `<button class="btn btn--ghost btn--block sm-more__link" data-href="#/settings/watch">${icon('heart', 16)}<span>Configura «Guardar en Salud»</span></button>`;
    return `
      <section class="sm-more" style="--i:8">
        <button class="btn btn--secondary btn--block" data-act="share">${icon('share', 18)}<span>Compartir tarjeta</span></button>
        ${health}
      </section>`;
  }

  function levelRow(c, i = 0, animate = false) {
    const up = Number(c.to) > Number(c.from);
    return `<div class="sm-level ${up ? 'is-up' : 'is-down'}" style="--zc:${zoneColor(c.level)};--i:${i}">
      <span class="sm-level__dot"></span>
      <span class="sm-level__name">${esc(zoneName(c.level))}</span>
      <span class="sm-level__from num">${fmt.speed(c.from)}</span>
      <span class="sm-level__arrow">${icon(up ? 'arrow-up' : 'arrow-down', 14, { stroke: 2.6 })}</span>
      <span class="sm-level__to num" ${animate ? `data-roll-from="${Number(c.from)}" data-roll-to="${Number(c.to)}"` : ''}>${fmt.speed(c.to)}</span>
      <span class="sm-level__unit">km/h</span>
    </div>`;
  }

  /* ═════════════════ Interacción ═════════════════ */
  function bind() {
    const root = el.querySelector('.sm');
    if (!root) return;
    root.addEventListener('click', (e) => {
      const face = e.target.closest('[data-feel]');
      if (face) { pickFeeling(face.dataset.feel, root); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'close' || act === 'home') onClose();
      else if (act === 'save') onSave();
      else if (act === 'share') doShare();
      else if (act === 'health') doHealth();
      else if (act === 'edit') { editing = true; draft = null; haptic('light'); render(); }
      else if (act === 'hr-import') onHrImport();
      else if (act === 'hr-paste') { haptic('light'); openHrSheet(); }
      else if (act === 'hr-remove') onHrRemove();
      else if (act === 'cancel-edit') { editing = false; draft = null; render(); }
    });
    root.querySelectorAll('[data-hr]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const v = parseInt(inp.value, 10);
        draft[inp.dataset.hr] = Number.isFinite(v) ? v : null;
      });
    });
    root.querySelector('[data-notes]')?.addEventListener('input', (e) => { draft.notes = e.target.value; });
  }

  function pickFeeling(key, root) {
    if (!draft) return;
    draft.feeling = key;
    haptic('selection');
    root.querySelectorAll('.sm-face').forEach((b) => {
      const on = b.dataset.feel === key;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('is-picked', on);
      if (on && !reducedMotion()) { b.classList.remove('is-pop'); void b.offsetWidth; b.classList.add('is-pop'); }
    });
    const hint = root.querySelector('[data-feel-hint]');
    if (hint) { hint.textContent = feelHint(key, session); hint.classList.remove('is-in'); void hint.offsetWidth; hint.classList.add('is-in'); }
    root.querySelector('.sm-save')?.removeAttribute('aria-disabled');
  }

  async function onClose() {
    haptic('light');
    if (session && !session.feeling && !editing) {
      let leave = true;
      try {
        leave = await confirmDialog({
          title: '¿Salir sin valorar?',
          message: 'Tu sensación nos ayuda a ajustar tus velocidades. La sesión ya está guardada.',
          confirmText: 'Salir',
          cancelText: 'Valorar',
        });
      } catch { leave = true; }
      if (!leave || disposed) return;
    }
    navigate('#/today');
  }

  function readHr() {
    const ok = (v) => (Number.isFinite(v) && v >= HR_ENTRY_MIN && v <= HR_ENTRY_MAX ? Math.round(v) : null);
    let hrAvg = ok(draft?.hrAvg);
    let hrMax = ok(draft?.hrMax);
    if (hrAvg && hrMax && hrMax < hrAvg) [hrAvg, hrMax] = [hrMax, hrAvg];
    return { hrAvg, hrMax };
  }

  async function onSave() {
    if (saving || !session) return;
    if (!draft?.feeling) {
      haptic('warning');
      toast('Elige primero cómo te has sentido', { icon: 'info' });
      const grid = el.querySelector('.sm-faces');
      if (grid && !reducedMotion()) { grid.classList.remove('is-shake'); void grid.offsetWidth; grid.classList.add('is-shake'); }
      grid?.scrollIntoView?.({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
      return;
    }
    const hrIn = [draft.hrAvg, draft.hrMax].filter((v) => v != null);
    if (hrIn.some((v) => !(v >= HR_ENTRY_MIN && v <= HR_ENTRY_MAX))) {
      haptic('warning');
      toast(`Revisa el pulso: debe estar entre ${HR_ENTRY_MIN} y ${HR_ENTRY_MAX} ppm`, { icon: 'heart' });
      return;
    }
    saving = true;
    const t0 = performance.now();
    diagMark('guardar.toque');
    try {
      if (editing) saveEdit();
      else await saveFirst();
    } finally {
      saving = false;
      diagMark('guardar.hecho', { ms: performance.now() - t0 });
    }
  }

  function saveEdit() {
    const fx = feelings().find((x) => x.key === draft.feeling);
    const { hrAvg, hrMax } = readHr();
    setState((d) => {
      const h = (d.history || []).find((x) => x.id === id);
      if (h) Object.assign(h, { feeling: draft.feeling, rpe: fx?.rpe ?? h.rpe ?? null, hrAvg, hrMax, notes: (draft.notes || '').trim() });
    });
    editing = false;
    draft = null;
    session = findSession();
    invalidateCard();
    // si el almacenamiento falló, el aviso de error ya lo da app.js: no confirmar un guardado que no ocurrió
    if (lastPersistOk()) {
      haptic('success');
      toast('Cambios guardados', { icon: 'check' });
    }
    render();
  }

  async function saveFirst() {
    const st = getState();
    const ses = findSession();
    if (!ses) return;
    const fx = feelings().find((x) => x.key === draft.feeling);
    const rpe = fx?.rpe ?? null;
    const { hrAvg, hrMax } = readHr();
    const notes = (draft.notes || '').trim();
    const updated = { ...ses, feeling: draft.feeling, rpe, hrAvg, hrMax, notes };

    let fb = null;
    try { fb = applyFeedback(st, updated, { feeling: draft.feeling, rpe }); } catch { fb = null; }
    let levels = fb?.levels ? { ...fb.levels } : { ...st.levels };
    let changes = Array.isArray(fb?.changes) ? fb.changes.slice() : [];
    let progression = fb?.progression ? { ...fb.progression } : { ...st.progression };
    let message = fb?.message || '';
    let testRes = null;

    if (ses.isTest) {
      // En un test mandan los escalones, no la sensación
      levels = { ...st.levels };
      changes = [];
      try { testRes = evaluateTest(updated); } catch { testRes = null; }
      let applyTest = !!(testRes?.levels && testRes.vam > 0);
      // Un test cortado sin querer no debe hundir las velocidades: si baja más de un 5 %, preguntamos
      if (applyTest && testRes.vam < vamFromLevels(st.levels) * 0.95) {
        try {
          applyTest = await confirmDialog({
            title: '¿Aplicar este resultado?',
            message: `Tu VAM de hoy (${fmt.speed(testRes.vam)} km/h) está por debajo de tus velocidades actuales. Si no era tu día, puedes mantenerlas.`,
            confirmText: 'Aplicar',
            cancelText: 'Mantener',
          });
        } catch { applyTest = false; }
        if (disposed) return;
      }
      if (applyTest) {
        levels = { ...testRes.levels };
        changes = LEVEL_KEYS
          .filter((k) => round1(Number(levels[k])) !== round1(Number(st.levels[k])))
          .map((k) => ({ level: k, from: st.levels[k], to: levels[k], reason: 'test' }));
        progression = {
          ...progression,
          lastTest: { date: ses.dayKey || todayKey(), vam: testRes.vam },
          bestVam: Math.max(Number(progression.bestVam) || 0, testRes.vam),
        };
        message = `Tu VAM es ${fmt.speed(testRes.vam)} km/h. Hemos recalculado tus cuatro velocidades.`;
      } else if (testRes?.vam > 0) {
        progression = { ...progression, lastTest: { date: ses.dayKey || todayKey(), vam: testRes.vam } };
        message = `Registramos tu VAM de ${fmt.speed(testRes.vam)} km/h y mantenemos tus velocidades.`;
      }
    }

    setState((d) => {
      d.levels = { ...levels };
      d.progression = { ...d.progression, ...progression };
      if (changes.length) {
        if (!Array.isArray(d.levelHistory)) d.levelHistory = [];
        d.levelHistory.push({ date: todayKey(), levels: { ...levels }, reason: ses.isTest ? 'test' : 'progression', note: message || '' });
      }
      const h = (d.history || []).find((x) => x.id === id);
      if (h) {
        Object.assign(h, { feeling: draft.feeling, rpe, hrAvg, hrMax, notes, levelChanges: changes });
        if (ses.isTest && testRes?.vam) h.test = { ...(h.test || {}), vam: testRes.vam };
      }
    });

    let newAch = [];
    try { newAch = (evaluateAchievements(getState()) || []).filter((a) => a && a.id); } catch { newAch = []; }
    if (newAch.length) {
      const now = new Date().toISOString();
      setState((d) => {
        if (!d.achievements || typeof d.achievements !== 'object') d.achievements = {};
        for (const a of newAch) if (!d.achievements[a.id]) d.achievements[a.id] = now;
      });
    }

    draft = null;
    session = findSession();
    invalidateCard();
    haptic('success');
    render();
    showResult({ changes, newAch, message, testRes, feeling: updated.feeling });
  }

  function showResult({ changes, newAch, message, testRes, feeling }) {
    const ups = changes.filter((c) => Number(c.to) > Number(c.from));
    let title = '¡Sesión guardada!';
    if (ups.length === 1) title = `¡Subimos ${zoneName(ups[0].level)} a ${fmt.speed(ups[0].to)} km/h!`;
    else if (ups.length > 1) title = '¡Subimos de nivel!';
    else if (testRes?.vam) title = '¡Test registrado!';
    const keep = !changes.length && !/mantenemos/i.test(message || '')
      ? `<p class="sm-result__keep">${esc(feeling === 'hard' || feeling === 'max' ? 'Mantenemos tus velocidades: toca consolidar.' : 'Mantenemos tus velocidades por ahora. ¡Sigue así!')}</p>`
      : '';
    const html = `
      <div class="sm-result">
        <div class="sm-result__badge ${ups.length ? 'is-up' : ''}">${icon(ups.length ? 'trophy' : newAch.length ? 'medal' : 'check', 44)}</div>
        ${message ? `<p class="sm-result__msg">${esc(message)}</p>` : ''}
        ${changes.length ? `<div class="sm-levels">${changes.map((c, i) => levelRow(c, i, true)).join('')}</div>` : keep}
        ${newAch.length ? `
          <div class="sm-ach">
            <div class="sm-ach__title">${newAch.length === 1 ? 'Logro desbloqueado' : `${newAch.length} logros desbloqueados`}</div>
            ${newAch.slice(0, 3).map((a, i) => `
              <div class="sm-medal sm-medal--${esc(a.tier || 'bronze')}" style="--i:${i}">
                <span class="sm-medal__ic">${icon(a.icon || 'medal', 26)}</span>
                <span class="sm-medal__txt"><b>${esc(a.title || 'Logro')}</b><span>${esc(a.description || '')}</span></span>
              </div>`).join('')}
            ${newAch.length > 3 ? `<p class="muted sm-note">Y ${newAch.length - 3} más: las tienes todas en Progreso.</p>` : ''}
          </div>` : ''}
      </div>`;
    let sheet = null;
    try {
      sheet = openSheet({
        title,
        html,
        actions: [
          { label: 'Compartir', kind: 'secondary', onClick: () => doShare() },
          { label: 'Volver a Hoy', kind: 'primary', onClick: (close) => { close?.(); navigate('#/today'); } },
        ],
        onMount: (sheetEl) => rollLevels(sheetEl),
      });
    } catch { sheet = null; }
    if (!sheet) toast(title, { icon: 'check' });
    // Confeti sobrio solo con un avance real (subes de nivel o nueva VAM), no por un logro suelto
    if (ups.length || testRes?.vam) {
      later(() => { try { celebrate({ intensity: 1 }); } catch { /* sin confeti */ } }, 260);
    }
  }

  /* ═════════════════ Compartir / Salud ═════════════════ */
  function cardKeyFor(s) { return `${s?.id}|${s?.feeling || ''}`; }
  function invalidateCard() { cardBlob = null; cardKey = ''; cardPromise = null; }

  function prepareCard() {
    const s = findSession();
    if (!s) return Promise.resolve(null);
    const key = cardKeyFor(s);
    if (cardBlob && cardKey === key) return Promise.resolve(cardBlob);
    if (cardPromise && cardKey === key) return cardPromise;
    cardKey = key;
    const name = getState().profile?.name || '';
    cardPromise = renderShareCard(s, { workout, name })
      .then((b) => { if (cardKey === key) cardBlob = b; return b; })
      .catch(() => null);
    return cardPromise;
  }

  async function doShare() {
    const s = findSession();
    if (!s) return;
    haptic('light');
    const name = getState().profile?.name || '';
    const ready = cardBlob && cardKey === cardKeyFor(s) ? cardBlob : null;
    let res;
    try {
      res = await shareSession(s, { workout, name, blob: ready || (await prepareCard()) || null });
    } catch { res = 'error'; }
    if (disposed) return;
    if (res === 'blocked') sharePreview(s);
    else if (res === 'downloaded') toast('Imagen guardada en Descargas', { icon: 'download' });
    else if (res === 'error') toast('No hemos podido crear la imagen', { icon: 'info', kind: 'error' });
  }

  /** Si iOS bloqueó el share (gesto caducado), mostramos la tarjeta con un botón que comparte al instante. */
  function sharePreview(s) {
    if (!cardBlob) return;
    let url = '';
    try { url = URL.createObjectURL(cardBlob); } catch { url = ''; }
    const name = getState().profile?.name || '';
    try {
      openSheet({
        title: 'Tu tarjeta',
        large: true,
        html: url ? `<img class="sm-preview" src="${url}" alt="Tarjeta de la sesión">
          <p class="muted sm-note">También puedes mantener pulsada la imagen para guardarla.</p>` : '',
        actions: [{ label: 'Compartir', kind: 'primary', onClick: (close) => { shareSession(s, { workout, name, blob: cardBlob }).then(() => close?.()); } }],
      });
    } catch { /* sin hoja */ }
    if (url) setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  function doHealth() {
    const s = findSession();
    const name = (getState().integrations?.healthShortcut || '').trim();
    if (!s || !name) return;
    haptic('light');
    if (openHealthShortcut(s, name)) toast(`Abriendo el Atajo «${name}»…`, { icon: 'heart' });
    else toast('No se pudo abrir Atajos', { icon: 'info', kind: 'error' });
  }

  /* ═════════════════ Animaciones ═════════════════ */
  function countUp() {
    if (reducedMotion()) return;
    const cells = el.querySelectorAll('.sm-stat[data-count]');
    const fmtBy = {
      clock: (v) => fmt.clock(v), km: (v) => fmt.km(v), speed: (v) => fmt.speed(v), int: (v) => fmt.int(v),
    };
    const jobs = [];
    cells.forEach((cell) => {
      const target = Number(cell.dataset.count);
      const kind = cell.dataset.kind;
      const final = cell.dataset.final;
      if (!(target > 0) || !fmtBy[kind]) return;
      // Busca el nodo de texto que contiene la cifra (sea cual sea la estructura de stat())
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      let node = null;
      while (walker.nextNode()) { if (walker.currentNode.nodeValue.trim() === final) { node = walker.currentNode; break; } }
      if (node) jobs.push({ node, target, f: fmtBy[kind], final });
    });
    if (!jobs.length) return;
    const t0 = performance.now();
    const dur = 1100;
    const stepFn = (t) => {
      if (disposed) return;
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      for (const j of jobs) j.node.nodeValue = p >= 1 ? j.final : j.f(j.target * e);
      if (p < 1) requestAnimationFrame(stepFn);
    };
    requestAnimationFrame(stepFn);
  }

  function rollLevels(sheetEl) {
    const nodes = sheetEl?.querySelectorAll?.('[data-roll-to]') || [];
    if (!nodes.length || reducedMotion()) return;
    nodes.forEach((n, i) => {
      const from = Number(n.dataset.rollFrom);
      const to = Number(n.dataset.rollTo);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return;
      n.textContent = fmt.speed(from);
      later(() => {
        const t0 = performance.now();
        const dur = 700;
        const f = (t) => {
          if (disposed) return;
          const p = Math.min(1, (t - t0) / dur);
          const e = 1 - Math.pow(1 - p, 3);
          n.textContent = fmt.speed(round1(from + (to - from) * e));
          if (p < 1) requestAnimationFrame(f);
          else n.classList.add('is-landed');
        };
        requestAnimationFrame(f);
      }, 380 + i * 160);
    });
  }
}

/** Momento de una sesión (ms) para comparar con las ANTERIORES. */
const sessionTime = (x) => {
  const t = Date.parse(x?.startedAt || '');
  if (Number.isFinite(t)) return t;
  const d = Date.parse(`${x?.dayKey || ''}T12:00:00`);
  return Number.isFinite(d) ? d : 0;
};

/** Insignias de récord personal comparando solo con las sesiones anteriores (no cambian con el tiempo). */
function recordBadges(s, history) {
  const t0 = sessionTime(s);
  const others = history.filter((x) => x && x.id !== s.id && sessionTime(x) < t0);
  if (!others.length) return s.elapsedSec > 0 ? [{ icon: 'star', text: 'Primera sesión', record: false }] : [];
  const out = [];
  const max = (fn) => Math.max(0, ...others.map((x) => Number(fn(x)) || 0));
  if (s.distanceKm > 0.5 && s.distanceKm > max((x) => x.distanceKm)) out.push({ icon: 'trophy', text: 'Récord de distancia', record: true });
  if (s.maxSpeed > 0 && s.maxSpeed > max((x) => x.maxSpeed)) out.push({ icon: 'bolt', text: 'Velocidad récord', record: true });
  if (s.elapsedSec > 600 && s.elapsedSec > max((x) => x.elapsedSec)) out.push({ icon: 'timer', text: 'Sesión más larga', record: true });
  if (s.avgSpeed > 0 && s.elapsedSec >= 900 && s.avgSpeed > max((x) => (x.elapsedSec >= 900 ? x.avgSpeed : 0))) out.push({ icon: 'flame', text: 'Mejor media', record: true });
  return out.slice(0, 3);
}
