#!/usr/bin/env node
// BestRunning · comprobación estática de imports/exports (sin dependencias).
// Recorre js/, tools/ y sw.js; resuelve rutas relativas y verifica que cada archivo importado existe
// y que cada nombre importado (o miembro de un namespace) está exportado de verdad.
// Uso: node tools/check-imports.mjs [--verbose]   · sale con código ≠ 0 si hay errores.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');

/* ───────────── Archivos ───────────── */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules' || name === '__pycache__') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(m?js)$/.test(name)) out.push(p);
  }
  return out;
}

const files = [...walk(join(ROOT, 'js')), ...walk(join(ROOT, 'tools'))];
if (existsSync(join(ROOT, 'sw.js'))) files.push(join(ROOT, 'sw.js'));
files.sort();

const rel = (p) => relative(ROOT, p).split(sep).join('/');

/* ───────────── Léxico: enmascara comentarios, cadenas, plantillas y regex ─────────────
   Devuelve un texto de la MISMA longitud donde el contenido de cadenas/plantillas/regex se sustituye por 'x'
   (las comillas se conservan) y los comentarios por espacios. Así las regex de abajo solo ven código real
   y los offsets permiten recuperar el texto original de los especificadores. */

const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'instanceof', 'yield', 'await']);

function mask(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  // Pila de contextos: 'code' (con contador de llaves) o 'tpl'
  const stack = [{ type: 'code', depth: 0 }];
  let lastSig = ''; // último carácter significativo del código
  let lastWord = '';

  const blank = (a, b, ch) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ch; };
  const regexAllowed = () => {
    if (!lastSig) return true;
    if (/[\w$]/.test(lastSig)) return REGEX_KEYWORDS.has(lastWord);
    return !/[)\]]/.test(lastSig);
  };

  while (i < n) {
    const ctx = stack[stack.length - 1];
    if (ctx.type === 'tpl') {
      const c = src[i];
      if (c === '\\') { blank(i, i + 2, 'x'); i += 2; continue; }
      if (c === '`') { stack.pop(); lastSig = '`'; lastWord = ''; i++; continue; }
      if (c === '$' && src[i + 1] === '{') { stack.push({ type: 'code', depth: 0, tpl: true }); i += 2; lastSig = '{'; lastWord = ''; continue; }
      blank(i, i + 1, 'x');
      i++;
      continue;
    }
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const e = src.indexOf('\n', i);
      const end = e === -1 ? n : e;
      blank(i, end, ' ');
      i = end;
      continue;
    }
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e === -1 ? n : e + 2;
      blank(i, end, ' ');
      i = end;
      continue;
    }
    if (c === '\'' || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      blank(i + 1, Math.min(j, n), 'x');
      i = j + 1;
      lastSig = c; lastWord = '';
      continue;
    }
    if (c === '`') { stack.push({ type: 'tpl' }); i++; continue; }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        const ch = src[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        j++;
      }
      blank(i + 1, Math.min(j, n), 'x');
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      i = j;
      lastSig = ')'; lastWord = ''; // tras una regex, '/' sería división
      continue;
    }
    if (c === '{') ctx.depth++;
    if (c === '}') {
      if (ctx.depth === 0 && ctx.tpl) { stack.pop(); i++; continue; }
      ctx.depth--;
    }
    if (/[\w$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      lastWord = src.slice(i, j);
      lastSig = src[j - 1];
      i = j;
      continue;
    }
    if (!/\s/.test(c)) { lastSig = c; lastWord = ''; }
    i++;
  }
  return out.join('');
}

/* ───────────── Análisis de un archivo ───────────── */

const B = '(?:^|[^.\\w$])'; // límite de palabra que excluye `obj.import`

function lineOf(src, idx) {
  let line = 1;
  for (let k = 0; k < idx && k < src.length; k++) if (src[k] === '\n') line++;
  return line;
}

function parseNamedList(list) {
  // 'a, b as c, default as d' → [{ imported:'a', local:'a' }, …]
  return list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/);
    if (!m) return { imported: s, local: s, bad: true };
    return { imported: m[1], local: m[2] || m[1] };
  });
}

function parseClause(clause) {
  // default, * as ns, { a, b as c }
  const res = { default: null, namespace: null, named: [] };
  let rest = clause.trim();
  const brace = rest.match(/\{([\s\S]*)\}/);
  if (brace) {
    res.named = parseNamedList(brace[1]);
    rest = rest.replace(brace[0], '');
  }
  const ns = rest.match(/\*\s*as\s+([\w$]+)/);
  if (ns) { res.namespace = ns[1]; rest = rest.replace(ns[0], ''); }
  const def = rest.replace(/,/g, ' ').trim();
  if (def) res.default = def;
  return res;
}

/** Nombres declarados tras `export const|let|var` a partir de `pos`. */
function declaredNames(code, pos) {
  const names = [];
  let i = pos;
  const n = code.length;
  const skipWs = () => { while (i < n && /\s/.test(code[i])) i++; };
  for (;;) {
    skipWs();
    if (code[i] === '{' || code[i] === '[') {
      // patrón de desestructuración
      const open = code[i];
      const close = open === '{' ? '}' : ']';
      let depth = 0;
      const start = i;
      for (; i < n; i++) {
        if (code[i] === open) depth++;
        else if (code[i] === close && --depth === 0) { i++; break; }
      }
      const inner = code.slice(start + 1, i - 1);
      for (const part of inner.split(',')) {
        const p = part.trim().replace(/=.*$/s, '').trim();
        if (!p || p.startsWith('...')) { if (p.startsWith('...')) names.push(p.slice(3).trim()); continue; }
        const m = p.match(/^(?:[\w$]+\s*:\s*)?([\w$]+)$/);
        if (m) names.push(m[1]);
      }
    } else {
      const m = code.slice(i).match(/^[\w$]+/);
      if (!m) break;
      names.push(m[0]);
      i += m[0].length;
    }
    // Saltar el inicializador hasta ',' (otro declarador) o fin de sentencia
    let depth = 0;
    let more = false;
    for (; i < n; i++) {
      const ch = code[i];
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
      else if (depth === 0 && ch === ';') break;
      else if (depth === 0 && ch === ',') { more = true; i++; break; }
      else if (depth === 0 && ch === '\n') {
        const before = code.slice(0, i).trimEnd().slice(-1);
        const after = code.slice(i).trimStart()[0] || '';
        if (!/[,=+\-*/?:|&(<>.!%^~]/.test(before) && !/[.?:+\-*/|&,=(%<>]/.test(after)) break;
      }
    }
    if (!more) break;
  }
  return names;
}

function analyze(file) {
  const src = readFileSync(file, 'utf8');
  const code = mask(src);
  const info = { file, src, code, imports: [], exports: new Set(), starFrom: [], defaultExport: false, dynamicNonLiteral: [] };

  const spec = (q, a, b) => src.slice(a, b); // texto original de la cadena

  // import … from '…'
  let re = new RegExp(`${B}import\\s*([\\w$*{][^;'"\`()]*?)\\s*from\\s*(['"])(x*)\\2`, 'g');
  for (const m of code.matchAll(re)) {
    const start = m.index + m[0].indexOf('import');
    const sStart = m.index + m[0].length - m[3].length - 1;
    const specifier = spec(m[2], sStart, sStart + m[3].length);
    const clause = parseClause(m[1]);
    info.imports.push({ kind: 'static', specifier, clause, line: lineOf(src, start), start, end: m.index + m[0].length });
  }
  // import '…' (efecto lateral)
  re = new RegExp(`${B}import\\s*(['"])(x*)\\1`, 'g');
  for (const m of code.matchAll(re)) {
    const sStart = m.index + m[0].length - m[2].length - 1;
    info.imports.push({ kind: 'side', specifier: src.slice(sStart, sStart + m[2].length), clause: null, line: lineOf(src, m.index + m[0].indexOf('import')) });
  }
  // import('…') dinámico
  re = new RegExp(`${B}import\\s*\\(\\s*`, 'g');
  for (const m of code.matchAll(re)) {
    const at = m.index + m[0].length;
    const q = code[at];
    const line = lineOf(src, at);
    let lit = null;
    if (q === '\'' || q === '"' || q === '`') {
      const close = code.indexOf(q, at + 1);
      const tail = code.slice(close + 1).match(/^\s*\)/);
      const body = src.slice(at + 1, close);
      if (close > at && tail && !(q === '`' && body.includes('${'))) lit = { value: body, end: close + 1 + tail[0].length };
    }
    if (!lit) { info.dynamicNonLiteral.push({ line }); continue; }
    const before = code.slice(Math.max(0, m.index - 80), m.index + 1);
    const imp = { kind: 'dynamic', specifier: lit.value, clause: null, line, bindings: [], members: [] };
    // load: () => import('./screens/x.js') ⇒ debe exportar mount (contrato de pantalla)
    if (/load\s*:\s*(?:async\s*)?\(\s*\)\s*=>\s*(?:\(\s*)?$/.test(before.replace(/[^\S\n]*$/, ''))) imp.members.push({ name: 'mount', line, why: 'route load()' });
    // const X = await import('…') · const { a, b: c } = await import('…')
    const decl = before.match(/(?:const|let|var)\s+([\w$]+|\{[^}]*\})\s*=\s*await\s*$/);
    if (decl) {
      if (decl[1].startsWith('{')) {
        for (const part of decl[1].slice(1, -1).split(',')) {
          const p = part.trim().match(/^([\w$]+)/);
          if (p) imp.members.push({ name: p[1], line, why: 'destructuring' });
        }
      } else imp.bindings.push(decl[1]);
    }
    // import('…').then((m) => …): m es el namespace dentro del callback; `VAR = m` lo exporta al archivo
    const after = code.slice(lit.end);
    const th = after.match(/^\s*\.then\(\s*(?:async\s*)?\(?\s*([\w$]+)\s*\)?\s*=>/);
    if (th) {
      const openAt = lit.end + after.indexOf('(', after.indexOf('.then'));
      let depth = 0;
      let k = openAt;
      for (; k < code.length; k++) {
        if (code[k] === '(') depth++;
        else if (code[k] === ')' && --depth === 0) break;
      }
      const body = code.slice(openAt, k);
      const param = th[1];
      imp.scoped = { name: param, from: openAt, to: k };
      for (const a of body.matchAll(new RegExp(`(?:^|[^.\\w$])([\\w$]+)\\s*=\\s*${param.replace('$', '\\$')}(?![\\w$.])`, 'g'))) imp.bindings.push(a[1]);
    }
    info.imports.push(imp);
  }
  // export … from '…'
  re = new RegExp(`${B}export\\s*(\\*\\s*(?:as\\s+[\\w$]+\\s*)?|\\{[^}]*\\})\\s*from\\s*(['"])(x*)\\2`, 'g');
  for (const m of code.matchAll(re)) {
    const sStart = m.index + m[0].length - m[3].length - 1;
    const specifier = src.slice(sStart, sStart + m[3].length);
    const line = lineOf(src, m.index + m[0].indexOf('export'));
    const what = m[1].trim();
    if (what.startsWith('{')) {
      const named = parseNamedList(what.slice(1, -1));
      info.imports.push({ kind: 'reexport', specifier, clause: { default: null, namespace: null, named }, line });
      for (const x of named) info.exports.add(x.local);
    } else {
      const as = what.match(/as\s+([\w$]+)/);
      if (as) { info.exports.add(as[1]); info.imports.push({ kind: 'reexport-ns', specifier, clause: null, line }); }
      else { info.starFrom.push(specifier); info.imports.push({ kind: 'reexport-star', specifier, clause: null, line }); }
    }
  }
  // Declaraciones exportadas
  for (const m of code.matchAll(new RegExp(`${B}export\\s+(?:async\\s+)?function\\s*\\*?\\s*([\\w$]+)`, 'g'))) info.exports.add(m[1]);
  for (const m of code.matchAll(new RegExp(`${B}export\\s+class\\s+([\\w$]+)`, 'g'))) info.exports.add(m[1]);
  for (const m of code.matchAll(new RegExp(`${B}export\\s+(?:const|let|var)\\s+`, 'g'))) {
    for (const name of declaredNames(code, m.index + m[0].length)) info.exports.add(name);
  }
  for (const m of code.matchAll(new RegExp(`${B}export\\s*\\{([^}]*)\\}(?!\\s*from)`, 'g'))) {
    for (const x of parseNamedList(m[1])) info.exports.add(x.local);
  }
  if (new RegExp(`${B}export\\s+default\\b`).test(code)) { info.defaultExport = true; info.exports.add('default'); }
  // new URL('…', import.meta.url) (recursos junto al módulo) y new Worker(new URL(…)) (punto de entrada de un Worker)
  info.assets = [];
  re = new RegExp(`${B}new\\s+URL\\s*\\(\\s*(['"\`])(x*)\\1\\s*,\\s*import\\.meta\\.url\\s*\\)`, 'g');
  for (const m of code.matchAll(re)) {
    const sStart = m.index + m[0].indexOf(m[1]) + 1;
    const before = code.slice(Math.max(0, m.index - 40), m.index + 1);
    info.assets.push({
      kind: /new\s+(?:Shared)?Worker\s*\(\s*$/.test(before) ? 'worker' : 'url',
      specifier: src.slice(sStart, sStart + m[2].length),
      line: lineOf(src, m.index + m[0].indexOf('new')),
    });
  }
  // fetch('./…') con ruta literal: en el navegador se resuelve contra la página (index.html, raíz del proyecto)
  re = new RegExp(`${B}fetch\\s*\\(\\s*(['"\`])(x*)\\1`, 'g');
  for (const m of code.matchAll(re)) {
    const sStart = m.index + m[0].length - m[2].length - 1;
    const spec = src.slice(sStart, sStart + m[2].length);
    if (spec.startsWith('./')) info.assets.push({ kind: 'fetch', specifier: spec, line: lineOf(src, m.index + m[0].indexOf('fetch')) });
  }
  return info;
}

/* ───────────── Resolución y comprobación ───────────── */

const cache = new Map();
function getInfo(file) {
  if (!cache.has(file)) cache.set(file, analyze(file));
  return cache.get(file);
}

function exportsOf(file, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const info = getInfo(file);
  const all = new Set(info.exports);
  for (const s of info.starFrom) {
    const target = resolve(dirname(file), s);
    if (existsSync(target)) for (const x of exportsOf(target, seen)) if (x !== 'default') all.add(x);
  }
  return all;
}

const errors = [];
const warnings = [];
const notes = [];
let importCount = 0;

/** El operador de propagación `...x` no es un acceso a miembro: se neutraliza (misma longitud) para las regex. */
const noSpread = (code) => code.replace(/\.\.\./g, '   ');

const err = (file, line, msg) => errors.push(`${rel(file)}:${line}  ${msg}`);
const warn = (file, line, msg) => warnings.push(`${rel(file)}:${line}  ${msg}`);
const note = (file, line, msg) => notes.push(`${rel(file)}:${line}  ${msg}`);

function memberAccesses(code, name, from = 0, to = code.length) {
  code = noSpread(code);
  const out = [];
  const re = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\s*(?:\\?\\.|\\.)\\s*([\\w$]+)`, 'g');
  const slice = code.slice(from, to);
  for (const m of slice.matchAll(re)) out.push({ member: m[1], idx: from + m.index });
  return out;
}

for (const file of files) {
  const info = getInfo(file);
  if (info.defaultExport) warn(file, 1, 'usa `export default` (el SPEC pide solo exports con nombre)');
  for (const d of info.dynamicNonLiteral) note(file, d.line, 'import() con especificador no literal (no comprobado)');

  for (const imp of info.imports) {
    importCount++;
    const s = imp.specifier;
    if (s.startsWith('node:') || !/^[./]/.test(s)) {
      if (rel(file).startsWith('js/') || rel(file) === 'sw.js') err(file, imp.line, `especificador no relativo en código de navegador: '${s}'`);
      continue;
    }
    if (s.startsWith('/')) { err(file, imp.line, `ruta absoluta '${s}' (usa rutas relativas './…')`); continue; }
    if (!/\.m?js$/.test(s)) { err(file, imp.line, `'${s}' sin extensión .js (el navegador no la resuelve)`); continue; }
    const target = resolve(dirname(file), s);
    if (!existsSync(target)) { err(file, imp.line, `no existe el archivo '${s}' (→ ${rel(target)})`); continue; }
    const exp = exportsOf(target);
    const tgt = rel(target);

    if (imp.clause) {
      const { named, namespace } = imp.clause;
      if (imp.clause.default && !exp.has('default')) err(file, imp.line, `import por defecto '${imp.clause.default}' pero ${tgt} no tiene export default`);
      for (const x of named) {
        if (x.bad) { err(file, imp.line, `no entiendo el import '${x.imported}'`); continue; }
        if (!exp.has(x.imported)) err(file, imp.line, `'${x.imported}' no está exportado por ${tgt}`);
      }
      // Namespace estático: comprobar los miembros usados
      if (namespace) {
        for (const a of memberAccesses(info.code, namespace)) {
          if (!exp.has(a.member)) err(file, lineOf(info.src, a.idx), `${namespace}.${a.member}: '${a.member}' no está exportado por ${tgt}`);
        }
      }
      // Imports sin usar (informativo)
      if (imp.kind === 'static') {
        const locals = [...named.map((x) => x.local), namespace, imp.clause.default].filter(Boolean);
        const plain = noSpread(info.code);
        const rest = plain.slice(0, imp.start) + ' '.repeat(imp.end - imp.start) + plain.slice(imp.end);
        for (const l of locals) {
          if (!new RegExp(`(?<![\\w$.])${l.replace(/\$/g, '\\$')}(?![\\w$])`).test(rest)) note(file, imp.line, `import sin usar: '${l}' de ${tgt}`);
        }
      }
    }
    if (imp.kind === 'dynamic') {
      for (const m of imp.members) if (!exp.has(m.name)) err(file, m.line, `'${m.name}' (${m.why}) no está exportado por ${tgt}`);
      if (imp.scoped) {
        for (const a of memberAccesses(info.code, imp.scoped.name, imp.scoped.from, imp.scoped.to)) {
          if (!exp.has(a.member)) err(file, lineOf(info.src, a.idx), `${imp.scoped.name}.${a.member}: '${a.member}' no está exportado por ${tgt}`);
        }
      }
      for (const b of imp.bindings) {
        for (const a of memberAccesses(info.code, b)) {
          if (!exp.has(a.member)) err(file, lineOf(info.src, a.idx), `${b}.${a.member}: '${a.member}' no está exportado por ${tgt}`);
        }
      }
    }
  }
}

/* ───────────── Recursos: new URL(…, import.meta.url), Workers y fetch('./…') ───────────── */

for (const file of files) {
  const info = getInfo(file);
  const browser = rel(file).startsWith('js/') || rel(file) === 'sw.js';
  for (const a of info.assets || []) {
    if (a.kind === 'fetch' && !browser) continue;
    const clean = a.specifier.split(/[?#]/)[0];
    if (!clean || /^[a-z]+:/i.test(clean)) continue;
    importCount++;
    if (clean.startsWith('/')) { err(file, a.line, `ruta absoluta '${a.specifier}' (usa rutas relativas)`); continue; }
    const base = a.kind === 'fetch' ? ROOT : dirname(file);
    const target = resolve(base, clean);
    if (!existsSync(target)) { err(file, a.line, `${a.kind === 'worker' ? 'Worker' : a.kind === 'fetch' ? 'fetch' : 'new URL'}: no existe '${a.specifier}' (→ ${rel(target)})`); continue; }
    if (a.kind === 'worker') {
      if (!/\.m?js$/.test(clean)) err(file, a.line, `el Worker '${a.specifier}' no es un módulo .js`);
      else if (!files.includes(target)) note(file, a.line, `Worker fuera de js/: '${a.specifier}' (sus imports no se comprueban)`);
    }
  }
}

/* ───────────── Informe ───────────── */

const out = [];
out.push(`check-imports · ${files.length} archivos · ${importCount} imports/re-exports analizados`);
if (errors.length) { out.push('', `ERRORES (${errors.length}):`, ...errors.map((e) => `  ✗ ${e}`)); }
if (warnings.length) { out.push('', `Avisos (${warnings.length}):`, ...warnings.map((w) => `  ! ${w}`)); }
if (notes.length && VERBOSE) { out.push('', `Notas (${notes.length}):`, ...notes.map((x) => `  · ${x}`)); }
else if (notes.length) out.push('', `Notas: ${notes.length} (imports sin usar / dinámicos no literales; --verbose para verlas)`);
out.push('', errors.length ? `✗ ${errors.length} problema(s)` : '✓ Todo en orden: todos los archivos existen y todos los nombres importados están exportados.');
process.stdout.write(out.join('\n') + '\n');
process.exit(errors.length ? 1 : 0);
