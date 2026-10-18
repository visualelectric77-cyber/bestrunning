// BestRunning · comprobaciones estáticas del sistema visual (M7): CSS bien formado, variables definidas,
// reglas de horizontal presentes y accesibilidad básica del onboarding. Uso: node tools/test-layout.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const MINE = ['css/base.css', 'css/components.css', 'css/screens-main.css', 'css/screens-more.css'];

let fails = 0;
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) {
    fails++;
    process.stdout.write(`  ✗ ${msg}\n`);
  }
};

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// 1 · Llaves y paréntesis equilibrados (ignorando comentarios y cadenas)
function balance(css) {
  const src = stripComments(css).replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  let brace = 0;
  let paren = 0;
  for (const ch of src) {
    if (ch === '{') brace++;
    else if (ch === '}') brace--;
    else if (ch === '(') paren++;
    else if (ch === ')') paren--;
    if (brace < 0 || paren < 0) return false;
  }
  return brace === 0 && paren === 0;
}

// 2 · Toda var(--x) sin valor por defecto debe estar definida en algún CSS del proyecto
const allCss = readdirSync(join(ROOT, 'css'))
  .filter((f) => f.endsWith('.css'))
  .map((f) => stripComments(read(`css/${f}`)))
  .join('\n');
const defined = new Set([...allCss.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
// Variables que fijan las propias pantallas en línea (style="--x:…") desde JS
const jsSrc = readdirSync(join(ROOT, 'js'), { recursive: true })
  .filter((f) => String(f).endsWith('.js'))
  .map((f) => read(`js/${f}`))
  .join('\n');
for (const m of jsSrc.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
for (const m of jsSrc.matchAll(/setProperty\(\s*'(--[\w-]+)'/g)) defined.add(m[1]);

for (const file of MINE) {
  const css = read(file);
  ok(balance(css), `${file}: llaves o paréntesis desequilibrados`);
  const src = stripComments(css);
  for (const m of src.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
    if (m[2]) continue;
    ok(defined.has(m[1]), `${file}: var(${m[1]}) no está definida en ningún sitio`);
  }
  ok(!/!important\s*!important/.test(src), `${file}: !important duplicado`);
}

// 3 · Reglas de horizontal (SPEC §13)
const base = stripComments(read('css/base.css'));
const comp = stripComments(read('css/components.css'));
const main = stripComments(read('css/screens-main.css'));
const more = stripComments(read('css/screens-more.css'));
const LAND = /@media \(orientation: landscape\) and \(max-height: 560px\)/;
const WIDE = /@media \(orientation: landscape\) and \(min-width: 640px\)/;
ok(LAND.test(base) && /--tabbar-h:\s*48px/.test(base), 'base.css: tab bar compacta de 48 px en horizontal');
ok(/\.tabbar__item\s*\{[^}]*flex-direction:\s*row/.test(base), 'base.css: icono y etiqueta en línea en horizontal');
ok(/\.large-title\s*\{[^}]*font-size:\s*28px/.test(base), 'base.css: large title más pequeño en horizontal');
ok(/--pad-l:\s*max\(var\(--gutter\),\s*var\(--safe-l\)/.test(base), 'base.css: margen lateral max(--gutter, --safe-l)');
ok(/--pad-r:\s*max\(var\(--gutter\),\s*var\(--safe-r\)/.test(base), 'base.css: margen lateral max(--gutter, --safe-r)');
ok(/top:\s*calc\(-1 \* var\(--safe-t\)\)/.test(comp), 'components.css: la barra compacta se pega cubriendo la zona segura');
ok(LAND.test(comp) && /\.sheet\s*\{[^}]*max-height/.test(comp), 'components.css: hojas con alto máximo en horizontal');
ok(WIDE.test(main), 'screens-main.css: rejillas a dos columnas en horizontal');
for (const sel of ['.td {', '.pn {', '.wk {', '.lb-carousel {', '.ob-step,']) {
  ok(main.includes(sel), `screens-main.css: falta el bloque horizontal de ${sel}`);
}
ok(WIDE.test(more) && more.includes('.pg-body:not(.hs-body) {'), 'screens-more.css: Progreso a dos columnas');
ok(/\.screen:has\(> \.st-body\)\s*\{\s*--content-max:\s*640px/.test(more), 'screens-more.css: Ajustes centrado');
ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.ob-mk/.test(main), 'screens-main.css: el logo respeta reduced-motion');

// 4 · Onboarding: mismo símbolo que el icono y botones con nombre accesible
const ob = read('js/screens/onboarding.js');
const icon = read('assets/icons/icon.svg');
ok(icon.includes('534,246 756,456 534,666') && ob.includes('M534 246L756 456L534 666'), 'onboarding: el chevron del logo coincide con icon.svg');
for (const [x1, x2, y] of [[316, 472, 356], [234, 582, 456], [316, 472, 556]]) {
  ok(icon.includes(`x1="${x1}" y1="${y}" x2="${x2}"`) && ob.includes(`M${x2} ${y}H${x1}`), `onboarding: línea de velocidad y=${y} coincide con icon.svg`);
}
ok(!/class="ob-bar/.test(ob), 'onboarding: ya no quedan las barras del logo antiguo');
for (const m of ob.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
  const attrs = m[1];
  const text = m[2].replace(/\$\{[^}]*\}/g, '').replace(/<[^>]+>/g, '').trim();
  ok(/aria-label=/.test(attrs) || /[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(text), `onboarding: botón sin nombre accesible → <button${attrs.slice(0, 60)}…>`);
}
ok(/ob-next[^"]*"\s+aria-label=/.test(ob) && /nextBtn\.setAttribute\('aria-label'/.test(ob), 'onboarding: el botón principal tiene aria-label y se actualiza por paso');
ok(/attrs:\s*'aria-label="[^"]+"'/.test(ob), 'onboarding: los interruptores llevan aria-label');
ok(/function labelControls/.test(ob), 'onboarding: steppers y segmentados reciben nombre');
ok(!/console\.log|alert\(|confirm\(/.test(ob), 'onboarding: sin console.log/alert/confirm');
ok(!/export default/.test(ob), 'onboarding: sin export default');

process.stdout.write(`${fails ? '✗' : '✓'} test-layout · ${checks} comprobaciones${fails ? ` · ${fails} fallo(s)` : ''}\n`);
process.exit(fails ? 1 : 0);
