// RITMUP · vigilante del reproductor: en js/screens/player.js casi todo el código vive DESPUÉS del `return cleanup;`
// de mount (funciones izadas). Un `const`, `let` o `class` puesto ahí no se inicializa nunca y usarlo lanza
// «Cannot access … before initialization» en cada tic. Pasó con `dynReady` en la 1.30.0: el modo pulso se quedó mudo.
// Uso: node tools/test-player-scope.mjs   (sale con código ≠ 0 si algo falla)
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = await readFile(path.join(ROOT, 'js/screens/player.js'), 'utf8');
const lines = src.split('\n');
let failures = 0;
const fail = (m) => { failures++; process.stderr.write(`  ✗ ${m}\n`); };

const start = lines.findIndex((l) => /^export (async )?function mount\b|^export const mount\b|^(async )?function mount\b/.test(l));
if (start < 0) fail('no encuentro mount() en player.js');
const ret = lines.findIndex((l, i) => i > start && /^ {2}return cleanup;/.test(l));
if (ret < 0) fail('no encuentro el `return cleanup;` de mount');
let end = lines.findIndex((l, i) => i > ret && /^}/.test(l));
if (end < 0) end = lines.length;
let checked = 0;
if (start >= 0 && ret >= 0) {
  for (let i = ret + 1; i < end; i++) {
    checked++;
    const m = /^ {2}(const|let|class)\s+([A-Za-z_$][\w$]*)/.exec(lines[i]);
    if (m) fail(`player.js:${i + 1} · \`${m[1]} ${m[2]}\` va después del return de mount: nunca se inicializa. Usa \`function\`.`);
  }
  if (checked < 1000) fail(`he revisado solo ${checked} líneas tras el return: ¿ha cambiado la estructura de player.js?`);
}
process.stdout.write(`${failures ? `✗ ${failures} fallos` : '✓ todo bien'} · ${checked} líneas revisadas tras el return de mount\n`);
process.exit(failures ? 1 : 0);
