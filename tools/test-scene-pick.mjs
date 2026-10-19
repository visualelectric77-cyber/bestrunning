// BestRunning · tests del escenario automático según la clase (js/player/scene-pick.js) y su migración en el store.
// Uso: node tools/test-scene-pick.mjs   (sale con código ≠ 0 si algo falla)
import { autoTheme, resolveTheme, AUTO_THEME, SCENE_IDS, SCENE_NAMES } from '../js/player/scene-pick.js';
import { THEMES } from '../js/player/scene3d/themes/index.js';
import { TEMPLATES } from '../js/training/templates.js';
import * as store from '../js/core/store.js';

let failures = 0;
let passes = 0;
function ok(cond, msg) {
  if (cond) { passes++; return; }
  failures++;
  process.stderr.write(`  ✗ ${msg}\n`);
}
function section(name, fn) {
  process.stdout.write(`• ${name}\n`);
  try { fn(); } catch (err) { failures++; process.stderr.write(`  ✗ excepción: ${err?.stack || err}\n`); }
}

section('mapa categoría → escenario', () => {
  const t = (category, extra = {}) => autoTheme({ category, ...extra }).id;
  ok(t('hills') === 'cordillera', 'cuestas → Cordillera (montaña)');
  for (const c of ['intervals', 'fartlek', 'tempo', 'test', 'challenge']) ok(t(c) === 'estadio', `${c} → Estadio (pista)`);
  ok(t('endurance') === 'aurora', 'resistencia → Aurora');
  ok(t('recovery') === 'blank', 'recuperación → Grafito');
  ok(t('endurance', { isTest: true }) === 'estadio', 'isTest manda (test en pista)');
  ok(autoTheme({ category: 'rara' }, 'cordillera').id === 'cordillera', 'categoría desconocida → escenario del usuario');
  ok(autoTheme({ category: 'rara' }, 'auto').id === 'aurora', 'sin escenario del usuario → Aurora');
  ok(autoTheme(null).id === 'aurora' && autoTheme(undefined, 'legacy').id === 'aurora', 'entradas vacías o ids no ofrecidos → Aurora');
  ok(autoTheme({ templateId: 'hill-repeats' }).id === 'cordillera', 'sin categoría: la plantilla decide (hill)');
  ok(autoTheme({ category: 'hills' }).reason === 'cuestas en la montaña', 'el porqué se puede leer');
});

section('todas las plantillas del catálogo tienen un mundo propio', () => {
  const ids = new Set(THEMES.filter((x) => !x.hidden).map((x) => x.id));
  ok(SCENE_IDS.every((id) => ids.has(id)) && SCENE_IDS.length === ids.size, 'SCENE_IDS = escenarios visibles del registro 3D');
  ok(SCENE_IDS.every((id) => typeof SCENE_NAMES[id] === 'string'), 'cada escenario tiene nombre');
  let n = 0;
  for (const tpl of TEMPLATES) {
    const r = autoTheme({ category: tpl.category, templateId: tpl.id, isTest: tpl.category === 'test' });
    if (!r.matched) { ok(false, `plantilla sin escenario: ${tpl.id} (${tpl.category})`); continue; }
    ok(ids.has(r.id), `${tpl.id} → escenario existente`);
    n++;
  }
  ok(n > 20, `catálogo recorrido (${n} plantillas)`);
});

section('resolveTheme: preferencia, automático y elección solo para esta clase', () => {
  const hills = { category: 'hills' };
  const r1 = resolveTheme(AUTO_THEME, hills);
  ok(r1.id === 'cordillera' && r1.auto === true && r1.reason, 'auto + cuestas → Cordillera (automático, con porqué)');
  const r2 = resolveTheme('estadio', hills);
  ok(r2.id === 'estadio' && r2.auto === false, 'escenario fijo del usuario → se respeta');
  const r3 = resolveTheme('estadio', hills, AUTO_THEME);
  ok(r3.id === 'cordillera' && r3.auto, 'Automático elegido en Preparación gana a la preferencia');
  const r4 = resolveTheme(AUTO_THEME, hills, 'blank');
  ok(r4.id === 'blank' && !r4.auto, 'un mundo elegido en Preparación gana al automático');
  ok(resolveTheme('basura', { category: 'recovery' }).id === 'blank', 'preferencia corrupta → automático');
  ok(resolveTheme(undefined, { category: 'intervals' }, 'legacy').id === 'estadio', 'elección no ofrecida → se ignora');
});

section('store: escenario automático por defecto y migración', () => {
  ok(store.defaultState().visuals.theme === 'auto', 'por defecto: Automático');
  const old = store.defaultState();
  old.visuals = { quality: 'auto', theme: 'aurora', tvMode: false, strideBob: true, ghost: true };
  ok(store.migrateState(old, 2).visuals.theme === 'auto', 'antiguo por defecto (Aurora sin marca) → Automático');
  const chosen = store.defaultState();
  chosen.visuals = { quality: 'auto', theme: 'estadio', tvMode: false, strideBob: true, ghost: true };
  ok(store.migrateState(chosen, 2).visuals.theme === 'auto', 'rev 3: un mundo elegido a mano antes pasa una vez a Automático');
  const rev2 = store.defaultState();
  rev2.visuals = { ...rev2.visuals, theme: 'estadio', themeRev: 2 };
  ok(store.migrateState(rev2, 2).visuals.theme === 'auto', 'rev 3: Estadio con la marca antigua (rev 2) → Automático');
  const after = store.defaultState();
  after.visuals = { ...after.visuals, theme: 'estadio', themeRev: 3 };
  ok(store.migrateState(after, 2).visuals.theme === 'estadio', 'Estadio elegido tras la migración (marca rev 3) se conserva');
  const aur = store.defaultState();
  aur.visuals = { ...aur.visuals, theme: 'aurora', themeRev: 3 };
  ok(store.migrateState(aur, 2).visuals.theme === 'aurora', 'Aurora elegida tras la migración (marca rev 3) se conserva');
  const bad = store.defaultState();
  bad.visuals = { theme: 'legacy' };
  ok(store.migrateState(bad, 2).visuals.theme === 'auto', 'escenario no ofrecido → Automático');
});

process.stdout.write(`\n${failures ? '✗' : '✓'} escenario automático: ${passes} comprobaciones, ${failures} fallos\n`);
process.exit(failures ? 1 : 0);
