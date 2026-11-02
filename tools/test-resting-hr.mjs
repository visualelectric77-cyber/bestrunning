#!/usr/bin/env node
// RITMUP · pruebas de la FC en reposo que llega de Salud (js/training/resting-hr.js) y de su paso al perfil.
import { restingFromHealth, healthRestPatch, restSourceLabel, restIsAuto } from '../js/training/resting-hr.js';
import { syncRestingFromHealth } from '../js/integrations/ai.js';
import { getState, setState, defaultState } from '../js/core/store.js';
import { hrZones } from '../js/training/levels.js';
import { hrZonesSpec } from '../js/integrations/native-bridge.js';
import { hrZoneOf } from '../js/integrations/watch-hr.js';
import { todayKey } from '../js/core/utils.js';
let n = 0; let bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log(`  ✗ ${m}`); } };
const today = '2026-11-02';
const day = (k, base = new Date(2026, 10, 2)) => { const d = new Date(base); d.setDate(d.getDate() - k); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const serie = (vals) => vals.map((v, k) => [day(k), v]); // vals[0] = hoy

// ── Mediana de los últimos 7 días con dato
ok(restingFromHealth(null, today) === null, 'sin datos: nada');
ok(restingFromHealth(serie([52, 53]), today) === null, 'dos días: pocos');
let r = restingFromHealth(serie([52, 53, 51]), today);
ok(r?.bpm === 52 && r.days === 3 && r.last === today, `tres días: mediana 52 (${JSON.stringify(r)})`);
r = restingFromHealth(serie([50, 51, 52, 53, 54, 55, 70, 40, 40, 40]), today);
ok(r?.bpm === 53 && r.days === 7, `solo los 7 últimos días, un pico no la mueve (${r?.bpm})`);
r = restingFromHealth(serie([50, 51, 52, 53]), today);
ok(r?.bpm === 52, `número par de días: media de los dos centrales redondeada (${r?.bpm})`);
r = restingFromHealth([[day(20), 60], [day(3), 50], [day(10), 55], [day(1), 49], [day(2), 51]], today);
ok(r?.bpm === 51 && r.last === day(1), `desordenados: se ordenan por día (${JSON.stringify(r)})`);
r = restingFromHealth([[day(0), 0], [day(1), 250], ['ayer', 50], [day(2), 'x'], [day(3), 48], [day(4), 49], [day(5), 50]], today);
ok(r?.bpm === 49 && r.days === 3, `descarta valores raros (${JSON.stringify(r)})`);
r = restingFromHealth([[day(0), 60], [day(0), 50], [day(1), 50], [day(2), 50]], today);
ok(r?.bpm === 50 && r.days === 3, 'un día repetido cuenta una vez');
const old = [[day(30), 50], [day(31), 50], [day(32), 50]];
ok(restingFromHealth(old, today) === null, 'datos de hace un mes: no valen');
ok(restingFromHealth(old)?.bpm === 50, 'sin fecha de hoy no se mira la antigüedad');

// ── Regla automática / manual
const m = { resting: serie([48, 49, 50, 50, 51, 52, 50]) };
let p = { hrRest: 62 }; // valor antiguo de la bienvenida (sin origen): se actualiza
let patch = healthRestPatch(p, m, today);
ok(patch?.hrRest === 50 && patch.hrRestSource === 'health' && patch.hrRestDays === 7 && patch.hrRestDay === today, `sin origen: Salud la pone (${JSON.stringify(patch)})`);
ok(healthRestPatch({ ...p, ...patch }, m, today) === null, 'ya al día: no hay cambio');
ok(healthRestPatch({ hrRest: 62, hrRestSource: 'health', hrRestDays: 7, hrRestDay: today }, m, today)?.hrRest === 50, 'de Salud: se actualiza con datos nuevos');
ok(healthRestPatch({ hrRest: 62, hrRestSource: 'manual' }, m, today) === null, 'escrita a mano: no se pisa');
ok(healthRestPatch({ hrRest: null, hrRestSource: null }, m, today)?.hrRest === 50, 'vacía: se rellena');
ok(healthRestPatch({ hrRest: 62 }, { resting: [] }, today) === null, 'sin datos de Salud: se queda la que hay');
ok(restIsAuto({}) && restIsAuto({ hrRestSource: 'health' }) && !restIsAuto({ hrRestSource: 'manual' }), 'restIsAuto');
ok(restSourceLabel({ hrRest: 50, hrRestSource: 'health', hrRestDays: 7 }) === 'De Salud · 7 días', 'etiqueta: de Salud · 7 días');
ok(restSourceLabel({ hrRest: 50, hrRestSource: 'health', hrRestDays: 4 }) === 'De Salud · 4 días', 'etiqueta: menos días');
ok(restSourceLabel({ hrRest: 50, hrRestSource: 'manual' }) === 'Escrita a mano', 'etiqueta: a mano');
ok(restSourceLabel({ hrRest: null }) === '', 'etiqueta: vacía');
ok(defaultState().profile.hrRestSource === null, 'estado por defecto: automática');

// ── Del puente al perfil (store real en memoria) y lo que depende de hrRest
const now = todayKey();
const live = { resting: Array.from({ length: 7 }, (_, k) => [day(k, new Date()), 50]) };
setState((d) => { d.profile = { ...d.profile, hrMax: 180, hrRest: 64, hrRestSource: undefined }; });
const zBefore = hrZonesSpec(getState().profile);
ok(syncRestingFromHealth(live) === true, 'sync: cambia el perfil');
const pf = getState().profile;
ok(pf.hrRest === 50 && pf.hrRestSource === 'health' && pf.hrRestDay === now, `sync: perfil al día (${pf.hrRest}, ${pf.hrRestSource})`);
ok(syncRestingFromHealth(live) === false, 'sync: segunda vez, nada');
const zAfter = hrZonesSpec(getState().profile);
const karv = hrZones(180, 50);
ok(zAfter[0].min === karv[0].min && zAfter[0].min !== zBefore[0].min, `zonas del reloj con la nueva (${zBefore[0].min} → ${zAfter[0].min})`);
ok(hrZoneOf(karv[2].min + 1, getState().profile) === 3, 'zona de un pulso (coach) con la nueva');
setState((d) => { d.profile.hrRest = 58; d.profile.hrRestSource = 'manual'; });
ok(syncRestingFromHealth(live) === false && getState().profile.hrRest === 58, 'sync: la escrita a mano se queda');
ok(syncRestingFromHealth(null) === false, 'sync: sin métricas, nada');

console.log(bad ? `✗ ${n - bad} OK, ${bad} fallos` : `✓ FC en reposo de Salud: ${n} comprobaciones`);
process.exitCode = bad ? 1 : 0;
