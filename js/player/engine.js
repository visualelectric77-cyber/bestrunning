// BestRunning · motor del reproductor (SIN DOM: importable desde Node para tests).
// Reloj acumulado con now() inyectable: inmune al throttling y a la suspensión del JS en iOS.
//
// Convenciones (ampliaciones compatibles con SPEC §8):
// - getState().totalElapsed es la POSICIÓN en la línea de tiempo de la clase (inicio del segmento + segElapsed);
//   es lo que necesitan el coach (cues por segundo desde el inicio) y el cursor del perfil. El tiempo realmente
//   corrido sin pausas va en getState().activeSec (→ Session.elapsedSec).
// - Opciones extra de createEngine: treadmill (recorte de velocidades), weightKg (kcal), autoTick (false en tests),
//   tickMs. Métodos extra: tick() (procesa el reloj ya) y getSegments() (segmentos con velocidades efectivas).
// - onSegment(state, info) con info = { index, prevIndex, reason:'start'|'auto'|'skip'|'restart'|'test', silent }.
import { round1, clamp, uid, todayKey } from '../core/utils.js';
import { ZONES, kcalPerMinute, clampSpeed } from '../training/levels.js';

const TICK_MS = 250;
const EPS = 1e-6;
const ZONE_KEYS = Object.keys(ZONES);

const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;
const emptyZones = () => Object.fromEntries(ZONE_KEYS.map((z) => [z, 0]));

function paceStr(sec) {
  if (!(sec > 0)) return '–:––';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Normaliza los segmentos (copia) descartando los de duración nula. */
function normalizeSegments(workout) {
  return (Array.isArray(workout?.segments) ? workout.segments : [])
    .map((s) => ({
      ...s,
      zone: ZONES[s?.zone] ? s.zone : 'jog',
      speed: round1(Number(s?.speed) || 0),
      incline: Number(s?.incline) || 0,
      sec: Math.max(0, Number(s?.sec) || 0),
    }))
    .filter((s) => s.sec > 0);
}

export function createEngine(workout, options = {}) {
  return makeEngine(workout, options || {}, null);
}

export function restoreEngine(snapshot, workout, callbacks = {}) {
  return makeEngine(workout, callbacks || {}, snapshot && typeof snapshot === 'object' ? snapshot : null);
}

function makeEngine(workout, opts, snap) {
  const {
    onTick = null,
    onSegment = null,
    onEvent = null,
    now = () => Date.now(),
    treadmill = null,
    weightKg = 78,
    autoTick = true,
    tickMs = TICK_MS,
  } = opts;

  const segs = normalizeSegments(workout);
  const n = segs.length;
  const starts = [];
  let totalSec = 0;
  for (const s of segs) { starts.push(totalSec); totalSec += s.sec; }

  const isTest = !!workout?.isTest;
  // Escalones del test: stage > 0; si el generador numerase desde 0, cualquier segmento con stage fuera de calentar/calma.
  const positiveStages = segs.some((s) => Number(s.stage) > 0);
  const isStage = (s) => {
    if (!isTest || !s) return false;
    if (positiveStages) return Number(s.stage) > 0;
    return Number.isFinite(Number(s.stage)) && s.stage !== null && s.stage !== undefined
      && s.zone !== 'warmup' && s.zone !== 'cooldown';
  };

  let cb = { onTick, onSegment, onEvent };
  let status = 'ready';
  let segIndex = 0;
  let segElapsed = 0;
  let activeSec = 0;
  let distanceKm = 0;
  let kcal = 0;
  let timeInZone = emptyZones();
  let speedTrace = [];
  let adjustments = {};
  let kmNotified = 0;
  let kmSplits = [];
  let halfwayDone = false;
  let lastSegDone = false;
  let maxSpeed = 0;
  let startedAt = null;
  let testResult = null;
  let skippedSec = 0;
  let testSkippedSec = 0;
  let finishedEarly = false;
  let lastNow = null;
  let timer = null;
  let destroyed = false;
  let queue = [];

  /* ───────── Restauración ───────── */
  if (snap) {
    const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
    if (Array.isArray(snap.speeds) && snap.speeds.length === n) {
      snap.speeds.forEach((v, i) => { if (Number.isFinite(Number(v))) segs[i].speed = round1(Number(v)); });
    }
    segIndex = clamp(Math.floor(num(snap.segIndex)), 0, Math.max(0, n - 1));
    segElapsed = clamp(num(snap.segElapsed), 0, segs[segIndex]?.sec ?? 0);
    activeSec = Math.max(0, num(snap.activeSec));
    distanceKm = Math.max(0, num(snap.distanceKm));
    kcal = Math.max(0, num(snap.kcal));
    timeInZone = { ...emptyZones() };
    if (snap.timeInZone && typeof snap.timeInZone === 'object') {
      for (const z of ZONE_KEYS) timeInZone[z] = Math.max(0, num(snap.timeInZone[z]));
    }
    speedTrace = Array.isArray(snap.speedTrace)
      ? snap.speedTrace.filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [num(p[0]), num(p[1])])
      : [];
    adjustments = snap.adjustments && typeof snap.adjustments === 'object' ? { ...snap.adjustments } : {};
    kmNotified = Math.max(0, Math.floor(num(snap.kmNotified)));
    kmSplits = Array.isArray(snap.kmSplits) ? snap.kmSplits.map((x) => num(x)) : [];
    halfwayDone = !!snap.halfwayDone;
    lastSegDone = !!snap.lastSegDone;
    maxSpeed = Math.max(0, num(snap.maxSpeed));
    startedAt = typeof snap.startedAt === 'string' ? snap.startedAt : null;
    testResult = snap.testResult && typeof snap.testResult === 'object' ? { ...snap.testResult } : null;
    skippedSec = Math.max(0, num(snap.skippedSec));
    testSkippedSec = Math.max(0, num(snap.testSkippedSec));
    finishedEarly = !!snap.finishedEarly;
    const st = snap.status;
    // Si estaba en marcha, no sabemos qué pasó mientras la app estaba cerrada: se reanuda en pausa.
    status = st === 'finished' ? 'finished' : st === 'ready' ? 'ready' : 'paused';
    if (n === 0) status = 'finished';
  }

  /* ───────── Utilidades internas ───────── */
  const position = () => (n ? starts[segIndex] + segElapsed : 0);
  const emit = (type, data = {}) => queue.push({ type, data });

  function traceAt(t, speed) {
    t = Math.round(t * 10) / 10;
    while (speedTrace.length && speedTrace[speedTrace.length - 1][0] > t) speedTrace.pop();
    const last = speedTrace[speedTrace.length - 1];
    if (!last) { speedTrace.push([t, speed]); return; }
    if (last[1] === speed) return;
    if (last[0] !== t) speedTrace.push([t, last[1]]);
    speedTrace.push([t, speed]);
  }

  function closeTrace() {
    const t = Math.round(position() * 10) / 10;
    const last = speedTrace[speedTrace.length - 1];
    if (last && last[0] < t) speedTrace.push([t, last[1]]);
  }

  function integrate(seg, dt) {
    if (!(dt > 0)) return;
    const before = distanceKm;
    const beforeActive = activeSec;
    activeSec += dt;
    distanceKm += (seg.speed * dt) / 3600;
    kcal += (kcalPerMinute(seg.speed, seg.incline, weightKg) * dt) / 60;
    timeInZone[seg.zone] = (timeInZone[seg.zone] || 0) + dt;
    if (seg.speed > maxSpeed) maxSpeed = seg.speed;
    // Instante exacto de cada km cruzado (para el ritmo del último km)
    for (let k = Math.floor(before + EPS) + 1; k <= Math.floor(distanceKm + EPS); k++) {
      if (seg.speed > 0) kmSplits.push(beforeActive + ((k - before) / seg.speed) * 3600);
    }
  }

  function computeTest(stageIdx, secInStage) {
    const seg = segs[stageIdx];
    if (!seg) return null;
    let prev = null;
    for (let i = stageIdx - 1; i >= 0; i--) if (isStage(segs[i])) { prev = segs[i]; break; }
    if (secInStage >= seg.sec - 0.5) {
      return { lastStageSpeed: seg.speed, secondsInLastStage: 0, vam: round2(seg.speed), stage: Number(seg.stage) || null };
    }
    const lastSpeed = prev ? prev.speed : round1(seg.speed - 0.5);
    const inc = seg.speed - lastSpeed > 0 ? seg.speed - lastSpeed : 0.5;
    const secs = Math.max(0, Math.round(secInStage));
    // Kuipers: último escalón completo + incremento × fracción del escalón en curso
    const vam = round2(lastSpeed + inc * Math.min(1, secInStage / seg.sec));
    return { lastStageSpeed: lastSpeed, secondsInLastStage: secs, vam, stage: Number(seg.stage) || null };
  }

  function moveTo(i, reason) {
    const prevIdx = segIndex;
    const prevSeg = segs[prevIdx];
    if (isTest && !testResult && isStage(prevSeg) && i > prevIdx && !isStage(segs[i])) {
      testResult = computeTest(prevIdx, segElapsed);
    }
    segIndex = i;
    segElapsed = 0;
    traceAt(position(), segs[i].speed);
    emit('segment', { index: i, prevIndex: prevIdx, reason, segment: { ...segs[i] } });
    if (i === n - 1 && !lastSegDone) {
      lastSegDone = true;
      emit('lastSegment', { index: i });
    }
  }

  function finalize(early) {
    if (isTest && !testResult && isStage(segs[segIndex])) testResult = computeTest(segIndex, segElapsed);
    closeTrace();
    status = 'finished';
    finishedEarly = !!early;
    stopTimer();
    emit('finish', {});
  }

  /** Avanza el reloj dt segundos procesando todos los cambios de segmento cruzados. */
  function advance(dt) {
    let guard = 0;
    while (dt > EPS && status === 'running' && guard++ < 100000) {
      const seg = segs[segIndex];
      const left = seg.sec - segElapsed;
      if (dt < left - EPS) {
        integrate(seg, dt);
        segElapsed += dt;
        dt = 0;
      } else {
        integrate(seg, left);
        segElapsed = seg.sec;
        dt -= left;
        if (segIndex >= n - 1) { finalize(false); break; }
        moveTo(segIndex + 1, 'auto');
      }
    }
  }

  function milestones() {
    const kmNow = Math.floor(distanceKm + EPS);
    while (kmNotified < kmNow) {
      kmNotified++;
      const t1 = kmSplits[kmNotified - 1] ?? activeSec;
      const t0 = kmNotified >= 2 ? kmSplits[kmNotified - 2] ?? 0 : 0;
      emit('km', { km: kmNotified, paceSec: Math.round(t1 - t0), pace: paceStr(t1 - t0) });
    }
    if (!halfwayDone && totalSec > 0 && position() >= totalSec / 2 - EPS && status !== 'ready') {
      halfwayDone = true;
      emit('halfway', { totalElapsed: position() });
    }
  }

  /** Vacía la cola de eventos: los 'segment' y 'km' intermedios salen silenciosos; sólo el último avisa. */
  function flush() {
    if (destroyed) { queue = []; return; }
    const events = queue;
    queue = [];
    let lastSeg = -1;
    let lastKm = -1;
    events.forEach((e, i) => {
      if (e.type === 'segment') lastSeg = i;
      if (e.type === 'km') lastKm = i;
    });
    let finishEvt = null;
    let state = null;
    events.forEach((e, i) => {
      if (e.type === 'finish') { finishEvt = e; return; }
      if (e.type === 'segment' || e.type === 'km') e.data.silent = i !== (e.type === 'segment' ? lastSeg : lastKm);
      try { cb.onEvent?.(e.type, e.data); } catch { /* el reproductor no debe caerse por un callback */ }
      if (e.type === 'segment' && i === lastSeg) {
        state = getState();
        try { cb.onSegment?.(state, e.data); } catch { /* idem */ }
      }
    });
    state = getState();
    try { cb.onTick?.(state); } catch { /* idem */ }
    if (finishEvt) {
      try { cb.onEvent?.('finish', state); } catch { /* idem */ }
    }
  }

  /** Procesa el tiempo transcurrido desde el último tick (sin vaciar la cola). */
  function catchUp() {
    if (status !== 'running') return;
    const t = Number(now());
    if (lastNow == null || !Number.isFinite(t)) { lastNow = t; return; }
    const dt = (t - lastNow) / 1000;
    lastNow = t;
    if (dt > 0) advance(dt);
    milestones();
  }

  function startTimer() {
    stopTimer();
    if (autoTick && typeof setInterval === 'function') timer = setInterval(tick, tickMs);
  }

  function stopTimer() {
    if (timer != null) { clearInterval(timer); timer = null; }
  }

  /* ───────── API pública ───────── */
  function tick() {
    if (destroyed || status !== 'running') return;
    catchUp();
    flush();
  }

  function start() {
    if (destroyed || status !== 'ready') return false;
    startedAt = new Date(Number(now()) || Date.now()).toISOString();
    if (n === 0) {
      status = 'running';
      finalize(false);
      flush();
      return true;
    }
    status = 'running';
    lastNow = Number(now());
    traceAt(position(), segs[segIndex].speed);
    startTimer();
    emit('start', { index: segIndex });
    emit('segment', { index: segIndex, prevIndex: -1, reason: 'start', segment: { ...segs[segIndex] } });
    if (n === 1 && !lastSegDone) { lastSegDone = true; emit('lastSegment', { index: 0 }); }
    flush();
    return true;
  }

  function pause() {
    if (destroyed || status !== 'running') return false;
    catchUp();
    if (status !== 'running') { flush(); return false; }
    status = 'paused';
    lastNow = null;
    stopTimer();
    emit('pause', {});
    flush();
    return true;
  }

  function resume() {
    if (destroyed || status !== 'paused') return false;
    status = 'running';
    lastNow = Number(now());
    if (!startedAt) startedAt = new Date(lastNow || Date.now()).toISOString();
    if (!speedTrace.length && segs[segIndex]) traceAt(position(), segs[segIndex].speed);
    startTimer();
    emit('resume', {});
    flush();
    return true;
  }

  function togglePause() {
    if (status === 'running') return pause();
    if (status === 'paused') return resume();
    if (status === 'ready') return start();
    return false;
  }

  function skip(dir = 1) {
    if (destroyed || (status !== 'running' && status !== 'paused')) return false;
    catchUp();
    if (status === 'finished') { flush(); return false; }
    if (dir > 0) {
      if (segIndex >= n - 1) {
        skippedSec += segs[segIndex].sec - segElapsed;
        finalize(true);
        flush();
        return true;
      }
      skippedSec += segs[segIndex].sec - segElapsed;
      moveTo(segIndex + 1, 'skip');
    } else if (segElapsed > 3 || segIndex === 0) {
      // Reinicia el segmento actual
      segElapsed = 0;
      traceAt(position(), segs[segIndex].speed);
      emit('segment', { index: segIndex, prevIndex: segIndex, reason: 'restart', segment: { ...segs[segIndex] } });
    } else {
      moveTo(segIndex - 1, 'skip');
      // Al retroceder un segmento ya no es el último
      if (segIndex < n - 1) lastSegDone = false;
    }
    if (status === 'running') lastNow = Number(now());
    milestones();
    flush();
    return true;
  }

  function adjustSpeed(delta) {
    if (destroyed || (status !== 'running' && status !== 'paused')) return false;
    const d = Number(delta);
    if (!Number.isFinite(d) || d === 0) return false;
    catchUp();
    if (status === 'finished') { flush(); return false; }
    const seg = segs[segIndex];
    const old = seg.speed;
    const next = clampSpeed(old + d, treadmill);
    const applied = round1(next - old);
    if (!applied) { flush(); return false; }
    seg.speed = next;
    for (let i = segIndex + 1; i < n; i++) {
      if (segs[i].zone === seg.zone) segs[i].speed = clampSpeed(segs[i].speed + applied, treadmill);
    }
    adjustments[seg.zone] = round1((adjustments[seg.zone] || 0) + applied);
    if (adjustments[seg.zone] === 0) delete adjustments[seg.zone];
    traceAt(position(), next);
    emit('adjust', { zone: seg.zone, speed: next, delta: applied, total: adjustments[seg.zone] || 0, index: segIndex });
    flush();
    return true;
  }

  function endTest() {
    if (destroyed || !isTest || (status !== 'running' && status !== 'paused')) return false;
    catchUp();
    if (status === 'finished' || !isStage(segs[segIndex])) { flush(); return false; }
    testResult = computeTest(segIndex, segElapsed);
    let lastStage = segIndex;
    for (let i = segIndex; i < n; i++) if (isStage(segs[i])) lastStage = i;
    let target = -1;
    for (let i = segIndex + 1; i < n; i++) if (segs[i].zone === 'cooldown') { target = i; break; }
    if (target === -1 && lastStage + 1 < n) target = lastStage + 1;
    let skipped = segs[segIndex].sec - segElapsed;
    const until = target === -1 ? n : target;
    for (let i = segIndex + 1; i < until; i++) skipped += segs[i].sec;
    testSkippedSec += skipped;
    emit('testEnd', { test: { ...testResult } });
    if (target === -1) {
      finalize(false);
    } else {
      moveTo(target, 'test');
      if (status === 'running') lastNow = Number(now());
    }
    flush();
    return true;
  }

  function finish() {
    if (destroyed || status === 'finished') return false;
    if (status === 'ready') {
      startedAt = startedAt || new Date(Number(now()) || Date.now()).toISOString();
      status = 'paused';
    }
    catchUp();
    if (status !== 'finished') finalize(true);
    flush();
    return true;
  }

  function getState() {
    const seg = segs[segIndex] || null;
    const next = segs[segIndex + 1] || null;
    const pos = position();
    return {
      status,
      segIndex,
      segment: seg ? { ...seg } : null,
      nextSegment: next ? { ...next } : null,
      segElapsed,
      segRemaining: seg ? Math.max(0, seg.sec - segElapsed) : 0,
      totalElapsed: pos,
      totalRemaining: Math.max(0, totalSec - pos),
      distanceKm,
      kcal,
      currentSpeed: status === 'finished' || !seg ? 0 : seg.speed,
      avgSpeed: activeSec > 0 ? distanceKm / (activeSec / 3600) : 0,
      progress: totalSec > 0 ? clamp(pos / totalSec, 0, 1) : status === 'finished' ? 1 : 0,
      // Extras
      totalSec,
      activeSec,
      segCount: n,
      segStart: n ? starts[segIndex] : 0,
      isTest,
      inTestStage: status !== 'finished' && isStage(seg),
      adjustments: { ...adjustments },
      timeInZone: { ...timeInZone },
      speedTrace: speedTrace.map((p) => [p[0], p[1]]),
      maxSpeed,
      kmSplits: kmSplits.slice(),
      startedAt,
      test: testResult ? { ...testResult } : null,
      skippedSec,
      testSkippedSec,
      finishedEarly,
    };
  }

  function getSegments() {
    return segs.map((s) => ({ ...s }));
  }

  function snapshot() {
    return {
      v: 1,
      workoutId: workout?.id ?? null,
      status,
      segIndex,
      segElapsed,
      activeSec,
      distanceKm,
      kcal,
      timeInZone: { ...timeInZone },
      speedTrace: speedTrace.map((p) => [p[0], p[1]]),
      adjustments: { ...adjustments },
      speeds: segs.map((s) => s.speed),
      kmNotified,
      kmSplits: kmSplits.slice(),
      halfwayDone,
      lastSegDone,
      maxSpeed,
      startedAt,
      testResult: testResult ? { ...testResult } : null,
      skippedSec,
      testSkippedSec,
      finishedEarly,
      savedAt: Number(now()) || Date.now(),
    };
  }

  function destroy() {
    stopTimer();
    destroyed = true;
    queue = [];
    cb = { onTick: null, onSegment: null, onEvent: null };
  }

  return {
    start, pause, resume, togglePause, skip, adjustSpeed, endTest, finish,
    getState, snapshot, destroy, tick, getSegments,
  };
}

/** Crea el registro Session (SPEC §3) a partir del estado final del motor. */
export function buildSession(workout, engineState, { levels = null, planDate = null, startedAt = null } = {}) {
  const es = engineState || {};
  const totalSec = Number(workout?.totalSec) || Number(es.totalSec) || 0;
  const plannedEffective = Math.max(1, (Number(es.totalSec) || totalSec) - (Number(es.testSkippedSec) || 0));
  const elapsed = Math.max(0, Number(es.activeSec ?? es.totalElapsed) || 0);
  const pct = clamp(elapsed / plannedEffective, 0, 1);
  const start = startedAt || es.startedAt || new Date().toISOString();
  let startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) startDate = new Date();

  const tiz = emptyZones();
  for (const z of ZONE_KEYS) tiz[z] = Math.round(Number(es.timeInZone?.[z]) || 0);

  const adjustments = {};
  for (const [z, v] of Object.entries(es.adjustments || {})) {
    const r = round1(Number(v) || 0);
    if (r) adjustments[z] = r;
  }

  const isTest = !!workout?.isTest;
  const test = isTest && es.test
    ? {
      lastStageSpeed: round1(Number(es.test.lastStageSpeed) || 0),
      secondsInLastStage: Math.round(Number(es.test.secondsInLastStage) || 0),
      vam: round2(Number(es.test.vam) || 0),
    }
    : null;

  const distanceKm = round2(Number(es.distanceKm) || 0);
  return {
    id: uid('ses'),
    workoutId: workout?.id ?? null,
    templateId: workout?.templateId ?? null,
    title: workout?.title || 'Entrenamiento',
    category: workout?.category ?? null,
    startedAt: startDate.toISOString(),
    dayKey: todayKey(startDate),
    planDate: planDate || null,
    plannedSec: Math.round(totalSec),
    elapsedSec: Math.round(elapsed),
    completed: pct >= 0.9,
    completionPct: round3(pct),
    distanceKm,
    avgSpeed: elapsed > 0 ? round1(distanceKm / (elapsed / 3600)) : 0,
    maxSpeed: round1(Number(es.maxSpeed) || 0),
    kcal: Math.round(Number(es.kcal) || 0),
    timeInZone: tiz,
    speedTrace: (Array.isArray(es.speedTrace) ? es.speedTrace : []).map((p) => [Math.round(p[0] * 10) / 10, round1(p[1])]),
    adjustments,
    levelsAtStart: levels ? { ...levels } : null,
    feeling: null,
    rpe: null,
    hrAvg: null,
    hrMax: null,
    notes: '',
    isTest,
    test,
    levelChanges: [],
  };
}
