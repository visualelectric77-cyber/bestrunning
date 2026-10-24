// RITMUP · tests del laboratorio «Clase con vídeo de YouTube»: lectura de enlaces (vídeo, lista, vídeo dentro de lista,
// shorts, live, music.youtube.com, no válidos) y «últimos usados» (js/player/youtube-link.js, puro).
// Uso: node tools/test-youtube.mjs   (sale con código ≠ 0 si algo falla)
import {
  parseYouTubeUrl, parseStart, ytKey, watchUrl, thumbUrl, defaultTitle, isLabOn,
  loadRecent, rememberRecent, setRecentTitle, MAX_RECENT, RECENT_KEY, LAB_KEY,
} from '../js/player/youtube-link.js';

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

const V = 'dQw4w9WgXcQ';
const V2 = 'M7lc1UVf-VE';
const L = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';
const OLAK = 'OLAK5uy_kYV3v3DgVb1zJb6dJ2ZDw8F8o6XvXwXyZ';

function isVideo(url, id = V, extra = {}) {
  const p = parseYouTubeUrl(url);
  ok(p && p.kind === 'video' && p.videoId === id && p.list === null, `${url} → vídeo ${id} (dio ${JSON.stringify(p)})`);
  for (const [k, v] of Object.entries(extra)) ok(p && p[k] === v, `${url} → ${k} = ${v} (dio ${p?.[k]})`);
  return p;
}
function isList(url, { list = L, videoId = null, index = 0, music = false } = {}) {
  const p = parseYouTubeUrl(url);
  ok(p && p.kind === 'playlist' && p.list === list && p.videoId === videoId && p.index === index && p.music === music,
    `${url} → lista ${list} vídeo ${videoId} índice ${index}${music ? ' (music)' : ''} (dio ${JSON.stringify(p)})`);
  return p;
}
function isNull(url) {
  const p = parseYouTubeUrl(url);
  ok(p === null, `${JSON.stringify(url)} → no válido (dio ${JSON.stringify(p)})`);
}

section('vídeos sueltos', () => {
  isVideo(`https://www.youtube.com/watch?v=${V}`);
  isVideo(`https://youtube.com/watch?v=${V}&feature=share`);
  isVideo(`http://www.youtube.com/watch?feature=youtu.be&v=${V}`);
  isVideo(`www.youtube.com/watch?v=${V}`);
  isVideo(`youtube.com/watch?v=${V}`);
  isVideo(`https://m.youtube.com/watch?v=${V}`);
  isVideo(`https://youtu.be/${V}`);
  isVideo(`https://youtu.be/${V}?si=AbCdEf123`);
  isVideo(`youtu.be/${V2}`, V2);
  isVideo(`https://www.youtube.com/embed/${V}`);
  isVideo(`https://www.youtube-nocookie.com/embed/${V}`);
  isVideo(`  https://www.youtube.com/watch?v=${V}  `);
  isVideo(`Mira esto 👉 https://youtu.be/${V} ¡qué ritmo!`);
  isVideo(`HTTPS://WWW.YOUTUBE.COM/watch?v=${V}`);
});

section('shorts y directos', () => {
  isVideo(`https://www.youtube.com/shorts/${V}`);
  isVideo(`https://youtube.com/shorts/${V}?feature=share`);
  isVideo(`https://m.youtube.com/shorts/${V}`);
  isVideo(`https://www.youtube.com/live/${V}`);
  isVideo(`https://www.youtube.com/live/${V}?si=xyz&t=30`, V, { start: 30 });
});

section('YouTube Music', () => {
  isVideo(`https://music.youtube.com/watch?v=${V}`, V, { music: true });
  isVideo(`https://music.youtube.com/watch?v=${V}&feature=share`, V, { music: true });
  isList(`https://music.youtube.com/playlist?list=${L}`, { music: true });
  isList(`https://music.youtube.com/playlist?list=${OLAK}`, { list: OLAK, music: true });
  isList(`https://music.youtube.com/watch?v=${V}&list=${L}`, { videoId: V, music: true });
});

section('listas de reproducción', () => {
  isList(`https://www.youtube.com/playlist?list=${L}`);
  isList(`https://youtube.com/playlist?list=${L}&si=abc`);
  isList(`https://m.youtube.com/playlist?list=${L}`);
  isList(`www.youtube.com/playlist?list=${L}`);
  isList(`https://www.youtube.com/watch?v=${V}&list=${L}`, { videoId: V });
  isList(`https://www.youtube.com/watch?list=${L}&v=${V}`, { videoId: V });
  isList(`https://youtu.be/${V}?list=${L}`, { videoId: V });
  isList(`https://www.youtube.com/embed/${V}?list=${L}`, { videoId: V });
  isList(`https://www.youtube.com/embed/videoseries?list=${L}`);
});

section('vídeo dentro de lista con index', () => {
  // La URL cuenta desde 1; la API (loadPlaylist / playerVars.index) desde 0
  isList(`https://www.youtube.com/watch?v=${V}&list=${L}&index=3`, { videoId: V, index: 2 });
  isList(`https://www.youtube.com/watch?v=${V}&list=${L}&index=1`, { videoId: V, index: 0 });
  isList(`https://www.youtube.com/playlist?list=${L}&index=5`, { index: 4 });
  isList(`https://www.youtube.com/watch?v=${V}&list=${L}&index=0`, { videoId: V, index: 0 });
  isList(`https://www.youtube.com/watch?v=${V}&list=${L}&index=abc`, { videoId: V, index: 0 });
  isList(`https://www.youtube.com/watch?v=${V}&list=${L}&index=-2`, { videoId: V, index: 0 });
  const p = parseYouTubeUrl(`https://www.youtube.com/watch?v=${V}&list=${L}&index=3&t=40`);
  ok(p?.start === 0, 'en una lista no se usa t= (lo marca la lista)');
});

section('inicio (t= / start=)', () => {
  isVideo(`https://youtu.be/${V}?t=90`, V, { start: 90 });
  isVideo(`https://www.youtube.com/watch?v=${V}&t=1m30s`, V, { start: 90 });
  isVideo(`https://www.youtube.com/watch?v=${V}&t=1h2m3s`, V, { start: 3723 });
  isVideo(`https://www.youtube.com/watch?v=${V}&start=45`, V, { start: 45 });
  isVideo(`https://www.youtube.com/watch?v=${V}&t=raro`, V, { start: 0 });
  ok(parseStart('') === 0 && parseStart('90s') === 90 && parseStart('2m') === 120 && parseStart('x') === 0, 'parseStart');
});

section('enlaces no válidos', () => {
  for (const u of [
    '', '   ', null, undefined, 42, 'hola', 'dQw4w9WgXcQ',
    'https://vimeo.com/123456', 'https://www.google.com/search?q=youtube',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
    'https://evil.com/?u=youtu.be', 'javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/', 'https://www.youtube.com/watch', 'https://www.youtube.com/watch?v=',
    'https://www.youtube.com/watch?v=corto', 'https://www.youtube.com/watch?v=dQw4w9WgXcQQQ',
    'https://www.youtube.com/watch?v=dQw4w9W<Xc>', 'https://youtu.be/', 'https://youtu.be/abc',
    'https://www.youtube.com/shorts/', 'https://www.youtube.com/live/', 'https://www.youtube.com/@canal',
    'https://www.youtube.com/channel/UC38IQsAvIsxxjztdMZQtwHA', 'https://www.youtube.com/results?search_query=run',
    'https://www.youtube.com/playlist', 'https://www.youtube.com/playlist?list=', 'https://www.youtube.com/playlist?list=WL',
    'https://www.youtube.com/playlist?list=LL', 'https://www.youtube.com/playlist?list=PL<script>',
    'https://music.youtube.com/', 'https://music.youtube.com/channel/UCabc', `ftp://youtube.com/watch?v=${V}`,
    `https://youtube.com/${'x'.repeat(3000)}`,
  ]) isNull(u);
  // un «list» roto no estropea el vídeo; un «v» roto con lista válida deja la lista
  isVideo(`https://www.youtube.com/watch?v=${V}&list=WL`);
  isList(`https://www.youtube.com/watch?v=roto&list=${L}`);
});

section('ayudas', () => {
  const a = parseYouTubeUrl(`https://www.youtube.com/watch?v=${V}&list=${L}&index=3`);
  const b = parseYouTubeUrl(`https://youtu.be/${V}?list=${L}&index=7`);
  ok(ytKey(a) === ytKey(b), 'misma clave para el mismo vídeo en la misma lista');
  ok(ytKey(a) !== ytKey(parseYouTubeUrl(`https://youtu.be/${V}`)), 'vídeo suelto ≠ vídeo dentro de lista');
  ok(watchUrl(a) === `https://www.youtube.com/watch?v=${V}&list=${L}&index=3`, `watchUrl con lista: ${watchUrl(a)}`);
  ok(watchUrl(parseYouTubeUrl(`https://www.youtube.com/playlist?list=${L}`)) === `https://www.youtube.com/playlist?list=${L}`, 'watchUrl de lista');
  ok(watchUrl(parseYouTubeUrl(`https://youtu.be/${V}?t=90`)) === `https://www.youtube.com/watch?v=${V}&t=90s`, 'watchUrl con inicio');
  for (const u of [a, b, parseYouTubeUrl(`https://youtu.be/${V}?t=90`), parseYouTubeUrl(`https://www.youtube.com/playlist?list=${L}&index=2`)]) {
    const back = parseYouTubeUrl(watchUrl(u));
    ok(back && ytKey(back) === ytKey(u) && back.index === u.index && back.start === u.start, `ida y vuelta: ${watchUrl(u)}`);
  }
  ok(thumbUrl(a) === `https://i.ytimg.com/vi/${V}/mqdefault.jpg`, 'miniatura de ytimg');
  ok(thumbUrl(parseYouTubeUrl(`https://www.youtube.com/playlist?list=${L}`)) === null, 'lista sin vídeo: sin miniatura');
  ok(defaultTitle(a) === 'Lista de YouTube' && defaultTitle(parseYouTubeUrl(`https://youtu.be/${V}`)) === 'Vídeo de YouTube', 'títulos por defecto');
});

function memStore(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

section('interruptor del laboratorio', () => {
  ok(isLabOn(memStore()) === false, 'apagado por defecto');
  ok(isLabOn(memStore({ [LAB_KEY]: 'on' })) === true, "'on' lo enciende");
  ok(isLabOn(memStore({ [LAB_KEY]: '1' })) === false, "solo 'on' cuenta");
  ok(isLabOn({ getItem() { throw new Error('bloqueado'); } }) === false, 'almacenamiento bloqueado: apagado');
  ok(isLabOn(null) === false, 'sin almacenamiento: apagado');
});

section('últimos usados', () => {
  const st = memStore();
  ok(loadRecent(st).length === 0, 'vacío al principio');
  const ids = ['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaaa3', 'aaaaaaaaaa4', 'aaaaaaaaaa5', 'aaaaaaaaaa6'];
  ids.forEach((id, i) => rememberRecent(parseYouTubeUrl(`https://youtu.be/${id}`), { title: `Vídeo ${i + 1}`, now: 1000 + i }, st));
  let r = loadRecent(st);
  ok(r.length === MAX_RECENT && MAX_RECENT === 5, `máximo 5 (hay ${r.length})`);
  ok(r[0].videoId === 'aaaaaaaaaa6' && r[0].title === 'Vídeo 6', 'el más reciente, el primero');
  ok(!r.some((x) => x.videoId === 'aaaaaaaaaa1'), 'el más antiguo sale');
  rememberRecent(parseYouTubeUrl(`https://www.youtube.com/watch?v=aaaaaaaaaa3&feature=x`), { now: 2000 }, st);
  r = loadRecent(st);
  ok(r[0].videoId === 'aaaaaaaaaa3' && r.length === 5 && r.filter((x) => x.videoId === 'aaaaaaaaaa3').length === 1, 'sin duplicados: sube al primer puesto');
  ok(r[0].title === 'Vídeo 3', 'conserva el título conocido si no llega otro');
  // listas (con su nombre si la API lo da; si no, «Lista de YouTube»)
  rememberRecent(parseYouTubeUrl(`https://www.youtube.com/playlist?list=${L}`), { now: 3000 }, st);
  r = loadRecent(st);
  ok(r[0].kind === 'playlist' && r[0].list === L && r[0].title === 'Lista de YouTube', 'lista guardada con «Lista de YouTube»');
  rememberRecent(parseYouTubeUrl(`https://music.youtube.com/playlist?list=${OLAK}`), { title: 'Mi mix de cinta', now: 3100 }, st);
  r = loadRecent(st);
  ok(r[0].list === OLAK && r[0].title === 'Mi mix de cinta' && r[0].music === true, 'lista con su nombre (y de YouTube Music)');
  rememberRecent(parseYouTubeUrl(`https://www.youtube.com/watch?v=${V}&list=${L}&index=4`), { now: 3200 }, st);
  r = loadRecent(st);
  ok(r[0].kind === 'playlist' && r[0].videoId === V && r[0].index === 3, 'vídeo dentro de lista (con su índice)');
  ok(r.filter((x) => x.list === L).length === 2, 'la lista entera y «vídeo en la lista» son dos entradas distintas');
  // título del reproductor
  const v = parseYouTubeUrl(`https://youtu.be/${V2}`);
  rememberRecent(v, { now: 4000 }, st);
  ok(loadRecent(st)[0].title === 'Vídeo de YouTube', 'vídeo sin título: «Vídeo de YouTube»');
  ok(setRecentTitle(v, '  Carrera a 170 BPM  ', st) === true && loadRecent(st)[0].title === 'Carrera a 170 BPM', 'el título del reproductor se guarda');
  ok(setRecentTitle(parseYouTubeUrl('https://youtu.be/zzzzzzzzzzz'), 'X', st) === false, 'un vídeo que no está no se añade por el título');
  // datos rotos o manipulados
  ok(loadRecent(memStore({ [RECENT_KEY]: 'no es json' })).length === 0, 'JSON roto → vacío');
  ok(loadRecent(memStore({ [RECENT_KEY]: '{"a":1}' })).length === 0, 'no es una lista → vacío');
  const bad = memStore({ [RECENT_KEY]: JSON.stringify([
    { videoId: '<img onerror=x>' }, { list: 'WL' }, null, 7, { videoId: V, title: 'Bueno' }, { videoId: V, title: 'Repetido' },
  ]) });
  r = loadRecent(bad);
  ok(r.length === 1 && r[0].videoId === V && r[0].title === 'Bueno', 'filtra ids inválidos y duplicados');
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('lleno'); } };
  ok(Array.isArray(loadRecent(broken)) && Array.isArray(rememberRecent(parseYouTubeUrl(`https://youtu.be/${V}`), {}, broken)), 'almacenamiento roto: nunca lanza');
});

process.stdout.write(`\n${passes} comprobaciones correctas, ${failures} fallos\n`);
if (failures) process.exit(1);
