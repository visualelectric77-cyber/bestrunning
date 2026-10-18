# BestRunning — Especificación técnica (contratos entre módulos)

> Documento interno de arquitectura. Todos los módulos DEBEN respetar estos contratos al pie de la letra
> (nombres de archivo, exports, firmas, forma de los datos, clases CSS). Si algo no está aquí, decide con
> criterio y documéntalo en un comentario breve en tu código, sin romper ningún contrato.

## 0. Producto

**BestRunning** es una PWA premium para entrenar en cinta de correr, inspirada en la experiencia de la app
Bestcycling (clases guiadas, perfil de intensidad en barras de colores, plan semanal personalizado que se puede
reordenar, progreso), pero solo para correr en cinta. Uso privado del dueño en su iPhone (iPhone 18 Pro Max,
iOS 26+, Safari/WebKit) instalada como app en pantalla de inicio desde GitHub Pages. Tiene Apple Watch.

Usuario: 46 años, hombre. Semana: **L–V 20 min**, **jueves 45–60 min**, **sábado o domingo 45–60 min**
(el otro día del fin de semana es descanso). Velocidades actuales: **trotar 8,3 · correr 10,1 · correr rápido
11,5 · sprint 13,0 km/h**. Objetivo: subir esas velocidades y aguantar más tiempo; intervalos, resistencia,
mejora cardiovascular; sesiones variadas y nada monótonas; un coach de voz que anuncia velocidades y motiva.

Principios:
- **Todo en español de España (es-ES)**. Decimal con coma en pantalla: "11,5 km/h". Tuteo, tono de entrenador cercano y enérgico.
- **Sin build step ni dependencias externas.** ES modules nativos, HTML/CSS/JS a mano, todo local (funciona offline).
- **Rutas relativas** (`./js/...`, nunca `/js/...`) — se sirve en `https://<usuario>.github.io/<repo>/`.
- **Sensación nativa iOS**: tipografía SF, large titles, tab bar con blur, hojas inferiores (bottom sheets),
  animaciones con spring, áreas seguras, sin zoom accidental, sin selección de texto, `touch-action: manipulation`.
- **Premium y espectacular**: tema oscuro, acento degradado naranja→rojo ("ember"), cifras enormes en SF Rounded,
  gráficos SVG cuidados, microinteracciones, confeti en logros. Calidad de app de pago.
- **Realismo de cinta**: la cinta tarda ~5–10 s en cambiar de velocidad ⇒ ningún segmento intenso dura menos de 30 s
  y cada cambio se anuncia con antelación (por defecto 10 s).
- Código limpio, comentado lo justo en español, sin `console.log` de depuración, sin `default export`.

## 1. Árbol de archivos y propietarios

| Propietario | Archivos |
|---|---|
| **YA EXISTEN (no reescribir, solo leer/importar)** | `js/core/utils.js`, `js/training/levels.js`, `css/tokens.css`, `docs/SPEC.md` |
| **A · Shell + sistema de diseño** | `index.html`, `manifest.webmanifest`, `sw.js`, `js/version.js`, `js/app.js`, `js/core/store.js`, `js/core/router.js`, `js/core/haptics.js`, `js/ui/components.js`, `js/ui/charts.js`, `css/base.css`, `css/components.css`, `assets/icons/*`, `assets/splash/*`, `tools/precache.mjs`, `tools/make-icons.py`, `README.md` |
| **B · Motor de entrenamiento** | `js/training/templates.js`, `js/training/generator.js`, `js/training/planner.js`, `js/training/progression.js`, `js/training/achievements.js`, `js/training/stats.js`, `tools/test-training.mjs` |
| **C1 · Audio y coach** | `js/audio/audio-engine.js`, `js/audio/speech.js`, `js/audio/phrases.js`, `js/audio/coach.js`, `tools/build-audio-manifest.mjs`, `tools/generate-voices.mjs`, `tools/test-audio.mjs`, `audio/manifest.json`, `audio/packs/packs.json`, `docs/VOCES.md` |
| **C2 · Reproductor** | `js/player/engine.js`, `js/player/wakelock.js`, `js/player/media-session.js`, `js/screens/player.js`, `js/screens/summary.js`, `js/integrations/share-card.js`, `js/integrations/health.js`, `css/player.css`, `tools/test-engine.mjs` |
| **D1 · Pantallas principales** | `js/screens/onboarding.js`, `js/screens/today.js`, `js/screens/plan.js`, `js/screens/library.js`, `js/screens/workout.js`, `js/integrations/ics.js`, `css/screens-main.css` |
| **D2 · Pantallas de progreso y ajustes** | `js/screens/progress.js`, `js/screens/history.js`, `js/screens/settings.js`, `css/screens-more.css` |

Nadie escribe archivos de otro propietario. Si necesitas algo de otro módulo que no está en este contrato,
impleméntalo localmente en tus archivos (privado) en lugar de editar los ajenos.

Módulos **sin DOM** (importables desde Node para tests): `js/core/utils.js`, `js/training/*.js`,
`js/audio/phrases.js`, la función `buildCueSchedule` de `js/audio/coach.js` (coach.js no debe tocar `window`/`document`
al importarse; acceso a speech/audio solo dentro de funciones), y `js/player/engine.js` (usa solo `Date.now`,
`setInterval`, `clearInterval`; nada de DOM).

## 2. Utilidades ya existentes (leer el código)

`js/core/utils.js` exporta: `DAY_MS, clamp, round1, roundTo, sum, pad2, todayKey, parseKey, addDays, weekdayOf,
mondayOf, daysBetween, weekDates, isoWeekKey, capitalize, fmt, hashStr, mulberry32, makeRng, uid, esc, debounce, deepClone`.
- `fmt.speed(11.5)→'11,5'`, `fmt.km`, `fmt.dec1`, `fmt.int`, `fmt.clock(sec)→'m:ss'`, `fmt.minutes`, `fmt.durationLong`,
  `fmt.pace(kmh)→'5:13'`, `fmt.weekdayShort(1..7)→'L'…'D'`, `fmt.weekdayAbbr`, `fmt.weekdayName`, `fmt.monthAbbr(0..11)`,
  `fmt.monthName`, `fmt.dateShort(key)→'vie 17 oct'`, `fmt.dateLong(key)`, `fmt.relativeDay(key)`.
- Fechas: claves locales `'YYYY-MM-DD'`; `weekdayOf` devuelve **1 = lunes … 7 = domingo**.

`js/training/levels.js` exporta: `ZONES, ZONE_ORDER, LEVEL_KEYS, DEFAULT_LEVELS, LEVEL_RATIOS, MIN_LEVEL_GAP,
speedForZone, levelsFromVam, vamFromLevels, enforceLevelOrder, zoneForSpeed, hrMaxFromAge, hrZones, hrTargetForZone,
paceSeconds, fmtPaceKmh, kcalPerMinute, estimateVo2max, vo2Category, clampSpeed`.
Claves de zona: `'warmup' | 'walk' | 'jog' | 'run' | 'fast' | 'sprint' | 'cooldown'`. Niveles personales: `jog, run, fast, sprint`.

`css/tokens.css`: variables `--bg --bg-elev --surface --surface-2 --surface-3 --glass --glass-strong --line --line-strong
--text --text-2 --text-3 --accent --accent-2 --accent-soft --accent-grad --accent-glow --ok --warn --danger --info
--z-<zona> --c-<categoría> --r-xs..--r-xl --r-pill --s-1..--s-10 --gutter --font --font-display --font-mono --fs-*
--shadow-1 --shadow-2 --ease-out --ease-spring --ease-in-out --dur-fast --dur --dur-slow --safe-t --safe-b --safe-l --safe-r
--tabbar-h --navbar-h --content-max`. Úsalas siempre en lugar de valores sueltos.

## 3. Estado global — `js/core/store.js` (A)

Persistencia en `localStorage` clave `'br.state.v1'`. Al cargar: fusión profunda con `defaultState()` (rellena claves
nuevas). Pide `navigator.storage?.persist?.()` una vez.

```js
export function defaultState()            // ver forma abajo
export function getState()                // objeto actual (tratar como solo lectura)
export function setState(mutator)         // mutator(draft) muta un clon; guarda; notifica; devuelve el nuevo estado
export function subscribe(listener)       // listener(state) → función para desuscribir
export function resetState()              // borra todo y vuelve a defaultState()
export function exportState()             // string JSON bonito (copia de seguridad)
export function importState(json)         // valida mínimamente; true/false
export function saveActiveSession(snap)   // localStorage 'br.active.v1' (snapshot del reproductor) o null para borrar
export function loadActiveSession()       // snapshot | null
```

```js
{
  version: 1,
  onboarded: false,
  createdAt: null,                       // ISO
  profile: { name: '', age: 46, weightKg: 78, sex: 'm', hrMax: 176, hrRest: null },
  levels: { jog: 8.3, run: 10.1, fast: 11.5, sprint: 13.0 },
  levelHistory: [],                      // [{ date:'YYYY-MM-DD', levels:{jog,run,fast,sprint}, reason:'init'|'progression'|'test'|'manual', note:'' }]
  progression: {
    lastBump: {},                        // { jog:'YYYY-MM-DD', ... } última subida por nivel
    okStreak: {},                        // { jog: n, ... } sesiones "cómodas" seguidas usando ese nivel
    hardStreak: 0,                       // sesiones seguidas "al límite"/fallidas
    loadAdjust: 0,                       // −0.15 … +0.15 ajuste fino de carga del plan
    lastTest: null,                      // { date, vam }
    bestVam: null,
  },
  schedule: { weekdayMinutes: 20, thursdayMinutes: 50, weekendDay: 6, weekendMinutes: 50, reminderTime: '07:00' },
                                         // weekendDay: 6 = sábado, 7 = domingo (el otro es descanso)
  plan: { startDate: null, overrides: {} },
                                         // startDate: lunes 'YYYY-MM-DD' del inicio del ciclo 1
                                         // overrides[dateKey] = { templateId?, minutes?, rest?: true }
  treadmill: { hasIncline: false, maxIncline: 12, minSpeed: 1.0, maxSpeed: 18.0, announceLead: 10 },
  audio: { voiceEnabled: true, voiceURI: null, rate: 1.0, pitch: 1.0, volume: 1.0, beeps: true,
           chattiness: 'normal', duckMusic: true, packId: null },   // chattiness: 'minimal'|'normal'|'coach'
  integrations: { watchReminder: true, healthShortcut: '' },
  history: [],                           // Session[] (más antigua primero)
  achievements: {},                      // { [achievementId]: ISO fecha de desbloqueo }
  ui: { libraryDuration: 20, libraryCategory: 'all', progressMetric: 'km' },
}
```

**Session** (registro de un entrenamiento, lo crea C2):
```js
{
  id: 'ses_xxx', workoutId, templateId, title, category,
  startedAt: ISO, dayKey: 'YYYY-MM-DD', planDate: 'YYYY-MM-DD'|null,   // día del plan que cumple
  plannedSec, elapsedSec,                // tiempo activo sin pausas
  completed: bool, completionPct: 0..1,
  distanceKm, avgSpeed, maxSpeed, kcal,
  timeInZone: { warmup, walk, jog, run, fast, sprint, cooldown },      // segundos
  speedTrace: [[tSec, speed], ...],      // puntos de cambio de velocidad (para gráfico real)
  adjustments: { jog: +0.2, ... },       // ajustes manuales netos por zona durante la sesión
  levelsAtStart: { jog, run, fast, sprint },
  feeling: null | 'easy'|'ok'|'hard'|'max'|'fail',   rpe: null | 1..10,
  hrAvg: null, hrMax: null, notes: '',
  isTest: false, test: null | { lastStageSpeed, secondsInLastStage, vam },
  levelChanges: [],                      // [{ level, from, to, reason }] aplicados tras el feedback
}
```

## 4. Router y shell — `js/core/router.js`, `js/app.js`, `index.html` (A)

Router por hash (compatible con GitHub Pages). Rutas con parámetros `:id` y query `?a=b`.

```js
export function registerRoute(pattern, { load, tab = null, fullscreen = false, push = false })
      // load: () => import('./screens/x.js')  (carga perezosa) · tab: 'today'|'plan'|'library'|'progress'|'settings'
export function navigate(path, { replace = false } = {})   // path: '#/today' o '/today'
export function back(fallback = '#/today')                 // history.back() si hay historial propio, si no fallback
export function currentRoute()                             // { path, pattern, params, query, tab, fullscreen }
export function startRouter(outletEl)
```

Contrato de **pantalla** (todos los `js/screens/*.js`):
```js
export function mount(el, { params, query, route }) { /* pinta en el <section class="screen"> recibido */ return cleanup /* opcional */ }
```
- `el` es un `<section class="screen">` nuevo para cada navegación. La pantalla pinta TODO su contenido (incluida su cabecera).
- Las pantallas se re-pintan solas suscribiéndose al store y devuelven una función de limpieza (desuscribir, timers…).
- Navegación declarativa global (la gestiona el router con delegación de eventos en `document`):
  - cualquier elemento con `data-href="#/ruta"` navega al pulsarlo;
  - `data-action="back"` vuelve atrás.
- Transiciones: View Transitions API si existe (`document.startViewTransition`); push = deslizamiento lateral, cambio de tab = fundido.
  Respeta `prefers-reduced-motion`.
- Rutas fullscreen ocultan la tab bar (`document.body.classList.toggle('is-fullscreen')`).
- Scroll: cada pantalla empieza arriba; al volver a un tab se restaura su scroll si es posible.

Rutas que registra `js/app.js`:
| Ruta | Módulo | tab | fullscreen | push |
|---|---|---|---|---|
| `#/onboarding` | screens/onboarding.js | – | sí | – |
| `#/today` | screens/today.js | today | – | – |
| `#/plan` | screens/plan.js | plan | – | – |
| `#/library` | screens/library.js | library | – | – |
| `#/workout/:id` | screens/workout.js | library | – | sí |
| `#/progress` | screens/progress.js | progress | – | – |
| `#/history` y `#/history/:id` | screens/history.js | progress | – | sí |
| `#/settings` y `#/settings/:section` | screens/settings.js | settings | – | sí (solo con section) |
| `#/play/:id` | screens/player.js | – | sí | – |
| `#/summary/:id` | screens/summary.js | – | sí | – |

`#/play/:id` acepta `?date=YYYY-MM-DD` (día del plan). `#/play/resume` recupera la sesión activa guardada.
Ruta por defecto: `#/today` si `onboarded`, si no `#/onboarding`. Si no está `onboarded`, cualquier ruta salvo onboarding redirige a onboarding.

`index.html`: `<div id="app"><main id="view"></main><nav id="tabbar" class="tabbar">…</nav></div><div id="sheet-root"></div><div id="toast-root"></div>`.
Carga CSS en este orden: `tokens.css, base.css, components.css, screens-main.css, screens-more.css, player.css`.
Un único `<script type="module" src="./js/app.js">`. Meta iOS: `viewport-fit=cover`, `apple-mobile-web-app-capable`,
`mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style=black-translucent`, `apple-mobile-web-app-title=BestRunning`,
`theme-color #08080a`, `format-detection telephone=no`, `apple-touch-icon` 180, `apple-touch-startup-image` (al menos
1320×2868 @3x 440×956 pt, 1290×2796 430×932, 1206×2622 402×874, 1179×2556 393×852), manifest.

Tab bar (5): **Hoy** (icono `home`), **Plan** (`calendar`), **Clases** (`grid`), **Progreso** (`chart`), **Perfil** (`person`).
Fija abajo, fondo `--glass` + `backdrop-filter: blur(24px) saturate(180%)`, altura `--tabbar-h` + `--safe-b`, tab activo en `--accent`.

`js/app.js` además: registra `./sw.js` (scope `./`) y muestra toast "Nueva versión disponible · Toca para actualizar" cuando
haya SW nuevo en espera; si `loadActiveSession()` devuelve una sesión de < 3 h, muestra hoja "Tienes un entrenamiento a medias"
→ Reanudar (`#/play/resume`) / Descartar; bloquea el zoom por gestos (`gesturestart` preventDefault); añade clase `is-standalone`
al `<html>` si `navigator.standalone` o `display-mode: standalone`.

`js/version.js`: `export const APP_VERSION = '1.0.0';` (lo reescribe `tools/precache.mjs`).

`sw.js`: precache de la lista `ASSETS` (cache-first para el shell, `VERSION` en el nombre de caché, limpia cachés viejas,
`skipWaiting` solo cuando la página lo pide por `postMessage({type:'SKIP_WAITING'})`). Para `audio/packs/**` usa
cache-first en tiempo de ejecución (caché aparte `br-audio`). Navegaciones → `index.html` de la caché si no hay red.
`tools/precache.mjs` recorre el proyecto (excluye `docs/`, `tools/`, `.git`, `*.md`, `audio/packs/*/` mp3) y reescribe
el array `ASSETS` entre los marcadores `/*ASSETS:START*/` y `/*ASSETS:END*/`, y `VERSION`/`APP_VERSION` (acepta `--bump patch|minor`).

## 5. Componentes UI — `js/ui/components.js` y `js/ui/charts.js` (A)

Todas devuelven **strings HTML/SVG** (salvo las que abren overlays). Los textos de usuario se escapan con `esc`.

```js
// components.js
export function icon(name, size = 22, { stroke = 2, cls = '' } = {}) // SVG inline estilo SF Symbols (trazo, currentColor)
   // nombres: home calendar grid chart person play pause stop skip-forward skip-back plus minus close check
   // chevron-right chevron-left chevron-down flame bolt heart timer route trophy gear speaker speaker-off lock unlock
   // refresh shuffle drag share download upload watch mountain star info trash edit sparkles leaf gauge target
   // arrow-up arrow-down music bell moon sun medal crown repeat list clock
export function navBar({ title, large = true, back = false, backLabel = 'Atrás', right = '' })
   // Cabecera estilo iOS: barra compacta translúcida fija (aparece al hacer scroll) + large title. Devuelve HTML.
export function enableCollapsingHeader(screenEl)   // activa el comportamiento large-title→compacto; devuelve cleanup
export function intensityDots(level /*1..3*/, color = 'currentColor')
export function chip(text, { color = null, active = false, attrs = '' } = {})
export function stat({ label, value, unit = '', icon: ic = null, color = null, size = 'md' }) // size 'sm'|'md'|'lg'
export function ring({ value /*0..1*/, size = 64, stroke = 7, color = 'var(--accent)', track = 'var(--surface-3)', inner = '' })
export function toggle({ id, checked = false, attrs = '' })               // interruptor iOS (input checkbox)
export function stepper({ id, value, step = 0.1, min, max, unit = '', decimals = 1 })
   // [−] valor [+]; emite evento 'change' burbujeante en el contenedor con detail { id, value }; mantener pulsado acelera
export function segmented({ name, options /*[{value,label}]*/, value })   // control segmentado iOS; evento 'change' detail {name,value}
export function workoutCard(workout, { variant = 'tile', href = null, status = null, dateLabel = '', cta = false } = {})
   // variant 'hero' | 'tile' | 'row'. status: 'done'|'today'|'missed'|'upcoming'|null.
   // hero: degradado por color de categoría, chip categoría, título grande, meta (min · ~km · dots), profileChart, botón Empezar si cta.
   // tile: miniatura profileChart arriba (compacta), título, foco, meta. row: barra de color, título, meta, chevron.
export function profileChart(segments, { height = 120, compact = false, progressSec = null, trace = null,
                                         levels = null, showLevels = false, radius = 3 } = {})
   // ★ El gráfico insignia: barras por segmento (ancho ∝ duración, alto ∝ velocidad, color de zona, esquinas
   // superiores redondeadas, separación 1–2 px). progressSec: parte jugada a color pleno, futura al 35 % y cursor.
   // trace: [[t,speed]…] dibuja línea de velocidad real encima. showLevels: líneas punteadas con las 4 velocidades.
   // SVG 100 % ancho, responsive (viewBox calculado; sin deformar esquinas).
export function zoneBar(timeInZone /*{zona:seg}*/, { showLegend = true } = {})  // barra apilada horizontal + leyenda
export function emptyState({ icon: ic, title, text, action = '' })
export function sectionHeader(title, actionHtml = '')
export function openSheet({ title = '', html = '', onMount = null, actions = [], large = false, dismissible = true, onClose = null, cls = '' })
   // Hoja inferior iOS con asa, arrastre para cerrar, fondo oscurecido. actions: [{label, kind:'primary'|'secondary'|'destructive', onClick(close)}]
   // Devuelve { el, close }. onMount(el, close). cls: clase modificadora en la hoja y en su fondo (p. ej. 'mu-snd').
export function toast(message, { icon: ic = null, kind = 'info', duration = 2600, onClick = null } = {})
export function confirmDialog({ title, message = '', confirmText = 'Aceptar', cancelText = 'Cancelar', destructive = false }) // Promise<boolean>
export function actionSheet({ title = '', options /*[{label,value,icon,destructive}]*/ })   // Promise<value|null>
export function celebrate({ intensity = 1 } = {})   // confeti a pantalla completa (canvas), colores de zona + acento
export function categoryColor(category)            // 'var(--c-<cat>)'
export function zoneColor(zone)                    // 'var(--z-<zona>)'

// charts.js (SVG, responsive, tipografía del sistema, rejilla sutil, animación de entrada CSS)
export function lineChart(series /*[{name,color,points:[{x:number,y:number}]}]*/, { height = 180, yFormat = String, xFormat = String, yMin = null, yMax = null, area = false } = {})
export function barChart(bars /*[{label,value,color?,highlight?}]*/, { height = 160, valueFormat = String } = {})
export function heatmapCalendar(valuesByDay /*{'YYYY-MM-DD':number}*/, { weeks = 16, endKey = todayKey(), color = 'var(--accent)' } = {})
export function sparkline(values, { color = 'var(--accent)', height = 32 } = {})
export function gauge({ value, min, max, label = '', sublabel = '', color = 'var(--accent)' })   // semicírculo
```

`js/core/haptics.js` (A): `export function haptic(kind = 'light')` — `'light'|'medium'|'heavy'|'success'|'warning'|'error'|'selection'`.
En iOS 18+ usa el truco `<label><input type="checkbox" switch></label>` oculto + `label.click()` (vibración del sistema;
para 'success' 2 toques, 'error' 3); fallback `navigator.vibrate`. Nunca lanza excepciones.

### Clases CSS compartidas (`css/base.css` + `css/components.css`, A)
Usa estas clases en las pantallas; los archivos de pantalla solo añaden estilos específicos con prefijo propio.
- Layout: `.screen` (contenedor scroll de pantalla con padding lateral `--gutter`, padding inferior para tab bar + safe area),
  `.screen--fullscreen`, `.container` (max-width `--content-max`, centrado), `.stack` (flex col gap 12), `.stack-lg` (gap 20),
  `.row` (flex row center gap 8), `.spacer` (flex 1), `.grid-2`, `.grid-3`, `.hscroll` (carrusel horizontal con scroll-snap, sin barra).
- Cabeceras: `.navbar`, `.navbar__compact`, `.navbar__large`, `.large-title`, `.eyebrow` (texto pequeño mayúsculas `--text-3`),
  `.section`, `.section-title`.
- Tarjetas: `.card` (fondo `--surface`, radio `--r-lg`, borde `--line`, padding 16), `.card--hero`, `.card--glass`, `.card--pressable` (escala 0.98 al pulsar).
- Botones: `.btn`, `.btn--primary` (degradado `--accent-grad`, glow), `.btn--secondary` (`--surface-2`), `.btn--ghost`, `.btn--danger`,
  `.btn--block` (ancho completo), `.btn--lg` (56 px alto), `.btn-icon` (circular 44 px), `.btn-icon--lg` (72 px).
- Listas iOS agrupadas: `.list` (grupo con radio), `.list__row` (min-height 52, separadores insetados), `.list__icon` (cuadrado redondeado de color),
  `.list__title`, `.list__sub`, `.list__value`, `.list__chev`.
- Datos: `.stat`, `.stat__value` (font-display, tabular-nums), `.stat__unit`, `.stat__label`, `.num` (font-display + tabular-nums), `.muted`, `.dim`.
- Chips/badges: `.chip`, `.chip--active`, `.badge`, `.dots`, `.dot`, `.dot--on`.
- Controles: `.toggle`, `.stepper`, `.segmented`, `.field` (input de texto/numérico estilo iOS), `.field__label`.
- Overlays: `.sheet-backdrop`, `.sheet`, `.sheet__grabber`, `.sheet__title`, `.sheet__actions`, `.toast`, `.dialog`.
- Gráficos: `.profile-chart`, `.zone-bar`, `.chart`.
- Utilidades de zona: `.zc-<zona>` y `.cc-<categoría>` fijan `--zc`/`--cc` al color correspondiente.
- Animaciones utilitarias: `.fade-in`, `.slide-up`, `.pop-in`, `.stagger > *` (aparición escalonada con `--i`).

## 6. Motor de entrenamiento (B)

### 6.1 Modelo
**Segment**
```js
{ zone: 'warmup'|'walk'|'jog'|'run'|'fast'|'sprint'|'cooldown', speed: 11.5 /*km/h, 0,1*/, incline: 0 /*%*/,
  sec: 60 /*múltiplo de 5; intensos ≥ 30*/, label: 'Correr rápido' /*por defecto ZONES[zone].name*/,
  cue: '' /*consejo opcional breve para el coach*/, block: 'Serie' /*opcional*/, rep: { i: 3, n: 8 } /*opcional*/,
  stage: 0 /*solo test: nº de escalón*/ }
```
**Workout**
```js
{ id, templateId, title, subtitle, category, focus, description, coachNotes: [string],
  minutes, totalSec, segments: [Segment], estDistanceKm, estKcal, maxSpeed,
  timeInZone: {zona: seg}, load: number /*puntuación de carga*/, intensity: 1|2|3,
  isTest: false, seed, loadFactor }
```

### 6.2 `templates.js`
```js
export const CATEGORIES = {   // key → { key, name, color, icon, description }
  intervals:{name:'Intervalos',color:'#FF375F',icon:'bolt'}, tempo:{name:'Tempo',color:'#FF9F0A',icon:'flame'},
  endurance:{name:'Resistencia',color:'#30D158',icon:'route'}, fartlek:{name:'Fartlek',color:'#BF5AF2',icon:'shuffle'},
  hills:{name:'Cuestas',color:'#C79A6B',icon:'mountain'}, recovery:{name:'Recuperación',color:'#64D2FF',icon:'leaf'},
  challenge:{name:'Retos',color:'#FFD60A',icon:'trophy'}, test:{name:'Test',color:'#7D7AFF',icon:'gauge'} }
export const TEMPLATES = [ { id, title, subtitle, category, focus, description, coachNotes, durations:[20,30,45,60],
                             requiresIncline:false, build(ctx) → Segment[] } ]
export function getTemplate(id)
export function templatesFor({ category = 'all', minutes = null, hasIncline = false })
```
`ctx = { minutes, levels, load /*≈0.7–1.3*/, rng /*makeRng*/, hasIncline, treadmill, weekInCycle, cycleIndex }`.

Reglas de construcción: calentamiento progresivo (20′: 3–4 min en 2–3 escalones desde `speedForZone('warmup')` hasta trote;
45–60′: 6–8 min), vuelta a la calma (20′: 2 min; 45–60′: 4–5 min) bajando de trote a `cooldown`. El bloque principal llena
exactamente el resto. Duraciones múltiplo de 5 s; intensos ≥ 30 s; nunca más de ~25 % del bloque principal a sprint.
`load` alto ⇒ más trabajo/menos recuperación o más repeticiones (sobrecarga progresiva); `load` bajo (descarga) ⇒ lo contrario.
Velocidades derivadas de `ctx.levels` con pequeños desplazamientos permitidos (p. ej. `run + 0.3`), redondeadas a 0,1 y
recortadas a la cinta. `rng` da variedad determinista (mismo seed ⇒ misma clase).

Catálogo mínimo (≥ 30 plantillas, títulos en español, descripciones motivadoras de 1–2 frases, 2–4 `coachNotes`):
- **intervals**: `pyramid` Pirámide (30-60-90-120-90-60-30 s rápido/sprint), `minute-on` Minuto a minuto (1′ rápido/1′ trote),
  `sprint-30-60` Sprints 30/60, `ladder-up` Escalera de velocidad (correr→rápido→sprint→trote), `over-under` Por encima y por debajo,
  `golden-minutes` Minutos de oro, `two-one` Series 2×1, `countdown` Cuenta atrás (3′-2′-1′-30″ cada vez más rápido).
- **tempo**: `cruise` Ritmo crucero, `sandwich` Sándwich, `threshold-3x4` Umbral 3×4, `progressive` Progresivo (+0,3 cada 2′), `cruise-2x6` Crucero 2×6.
- **endurance** (45–60): `long-progressive` Fondo progresivo, `long-blocks` Bloques de resistencia, `long-surges` Largo con cambios,
  `negative-split` Segunda mitad más rápida, `long-ladder` Escalera larga, `aerobic-base` Base aeróbica Z2 (también 20–30).
- **fartlek**: `fartlek-swedish` Fartlek sueco (cambios aleatorios 30″–3′), `speed-play` Juego de 4 velocidades, `surprise` Caja sorpresa.
- **hills** (`requiresIncline:true`): `hills-short` Cuestas cortas, `hill-long` Colina larga, `rollercoaster` Montaña rusa.
- **recovery**: `easy-strides` Suave con rectas (trote + 4–6× 30″ rápido), `recovery-jog` Trote regenerativo.
- **challenge**: `no-stop` Reto sin bajar (todo a correr tras calentar), `sprint-finish` Final explosivo, `challenge-10k` Reto 10K (60′),
  `the-hour` La hora (60′ progresiva), `pyramid-xl` Pirámide XL (45–60).
- **test**: `test-vam` Test VAM escalonado — calentamiento 5′ (hasta trote), escalones de 60 s empezando en `levels.jog − 0.3`
  subiendo 0,5 km/h hasta `treadmill.maxSpeed` (`zone` según `zoneForSpeed`, `stage: n`), y 3′ de vuelta a la calma al final.
  `isTest:true`. El reproductor permite "No puedo más" que salta a la vuelta a la calma.

### 6.3 `generator.js`
```js
export function buildWorkout(templateId, { minutes, levels, seed = 1, loadFactor = 1, hasIncline = false, treadmill, weightKg = 78,
                                           weekInCycle = 1, cycleIndex = 0 }) → Workout
export function workoutId({ templateId, minutes, seed, loadFactor }) → 'pyramid~20~k3j2~108'   // seed en base 36, carga ×100
export function parseWorkoutId(id) → { templateId, minutes, seed, loadFactor } | null
export function workoutFromId(id, state) → Workout | null        // usa state.levels, state.treadmill, state.profile
export function summarizeSegments(segments) → { totalSec, estDistanceKm, estKcal(weightKg), maxSpeed, timeInZone, load, intensity }
export function groupSegments(segments) → [{ kind:'single'|'repeat', times, segments, label }]   // "8 × (0:30 Sprint 13,0 · 1:00 Trote 8,3)"
```
`fitToDuration` interno garantiza `totalSec === minutes*60` (salvo test). `intensity` 1–3 a partir de carga por minuto
(Σ seg × ZONES[z].weight / totalSec: < 1,6 → 1; < 2,3 → 2; si no 3).

### 6.4 `planner.js`
```js
export const CYCLE_WEEKS = ['Base', 'Construcción', 'Pico', 'Descarga + Test']
export function cycleInfo(state, dateKey) → { cycleIndex, weekInCycle /*1..4*/, weekName, isDeload, loadFactor, weeksSinceStart }
   // loadFactor = [1.0, 1.08, 1.16, 0.72][w-1] × (1 + min(cycleIndex, 6) × 0.03) + progression.loadAdjust
export function planDay(state, dateKey) → PlanDay
export function planWeek(state, mondayKey) → PlanDay[7]
export function todayPlan(state, now = new Date()) → PlanDay
export function alternativesFor(state, dateKey, n = 6) → Workout[]   // otras clases para ese día (misma duración)
export function swapDays(draft, dateA, dateB)       // mutador: intercambia lo que toca en ambos días vía overrides
export function setDayOverride(draft, dateKey, { templateId, minutes, rest })
export function clearDayOverride(draft, dateKey)
export function nextTestDate(state, fromKey) → dateKey
```
`PlanDay = { date, weekday, kind:'short'|'long'|'rest'|'test', slot, templateId, minutes, workout: Workout|null,
status:'done'|'today'|'missed'|'upcoming'|'rest', session: Session|null, isOverride }`.
Estructura por defecto: L intervals · M tempo · X fácil (recovery; si `hasIncline`, semanas pares hills) · J endurance
(`thursdayMinutes`) · V fartlek/challenge · día de finde elegido: largo variado (`weekendMinutes`: endurance/challenge/fartlek largo,
distinto del jueves) · el otro día del finde: descanso. Semana 4 (descarga): todo más suave y **viernes `test-vam`**.
Rotación determinista por (semana, slot) evitando repetir la plantilla de la semana anterior en el mismo slot. Seed por día:
`hashStr(dateKey)`. `status 'done'` si hay sesión en `history` con `planDate === date` (o `dayKey === date`) y `completionPct ≥ 0.6`.
Si `plan.startDate` es null, se usa el lunes de la semana actual.

### 6.5 `progression.js`
```js
export function applyFeedback(state, session, { feeling, rpe }) → { levels, changes:[{level,from,to,reason}], progression, message }
   // NO muta. El llamador (summary) guarda con setState.
export function evaluateTest(session) → { vam, levels, vo2max, deltaVam }   // Kuipers: VAM = último escalón completo + 0,5·(seg en el último/60)
export function feelingToRpe(feeling) → número
export const FEELINGS = [ {key:'easy',label:'Muy fácil',emoji:'😌',rpe:3}, {key:'ok',label:'Cómodo',emoji:'🙂',rpe:5},
                          {key:'hard',label:'Exigente',emoji:'😤',rpe:7}, {key:'max',label:'Al límite',emoji:'🥵',rpe:9},
                          {key:'fail',label:'No pude',emoji:'😵',rpe:10} ]
export function coachInsight(state) → string          // frase de análisis para Hoy/Progreso ("Llevas 3 semanas seguidas…")
```
Reglas: niveles "usados" = los que suman ≥ 60 s en la sesión. `easy` ⇒ +0,1 a cada nivel usado (máx. una subida por nivel cada
6 días); `ok` ⇒ suma racha y +0,1 al llegar a 3; `hard` ⇒ mantiene; `max` ⇒ mantiene, y si `hardStreak ≥ 2` −0,1 al nivel más
alto usado y `loadAdjust −0.05`; `fail` (o `completionPct < 0.85`) ⇒ −0,1 al nivel más alto usado y `loadAdjust −0.05`. Si
completó y hubo ajuste manual ≥ +0,2 en un nivel, adopta la mitad. Tope de subida +0,6 km/h por nivel en 28 días. Siempre
`enforceLevelOrder`. `loadAdjust` en [−0.15, +0.15] y vuelve hacia 0 con sesiones `ok`. Mensajes en español.

### 6.6 `achievements.js` y `stats.js`
```js
// achievements.js
export const ACHIEVEMENTS = [ { id, title, description, icon /*nombre de icon()*/, tier:'bronze'|'silver'|'gold', check(state) → bool } ]
   // ≥ 24: primera sesión, 5/10/25/50/100/250 sesiones, 10/50/100/250/500/1000 km, semana completa, rachas 2/4/8/12 semanas,
   // primera de 60′, madrugador (< 7:00), primera subida de nivel, sprint ≥ 14/15 km/h, correr ≥ 11, 10 km en una sesión,
   // primer test, VAM récord, 20 sesiones en un mes, 10 min a sprint acumulados en una sesión…
export function evaluateAchievements(state) → [{ id, ... }]   // los que ya cumplen y aún no están en state.achievements

// stats.js
export function totals(history) → { sessions, km, sec, kcal }
export function weeklyBuckets(history, weeks = 12, endKey = todayKey()) → [{ monday, km, sec, sessions }]
export function streakWeeks(state, now) → número de semanas seguidas cumpliendo ≥ 4 sesiones (semana en curso cuenta si ya llega)
export function dayValues(history) → { 'YYYY-MM-DD': minutos }
export function records(history) → { longestSec, maxDistanceKm, maxAvgSpeed, maxSpeed, bestVam, mostSprintSec } (con sessionId)
export function weekProgress(state, mondayKey) → { doneSessions, plannedSessions, minutes, plannedMinutes, km }
```

`tools/test-training.mjs` (Node 22, `node tools/test-training.mjs`): construye TODAS las plantillas × duraciones permitidas ×
varios seeds/loads y comprueba: total exacto, múltiplos de 5, intensos ≥ 30 s, velocidades dentro de [minSpeed,maxSpeed],
ids reversibles, planWeek de 12 semanas sin huecos, progresión coherente. Sale con código ≠ 0 si algo falla.

## 7. Audio y coach (C1)

Contexto iOS: el audio solo arranca tras un gesto del usuario; la pantalla debe estar encendida (wake lock) porque iOS
suspende el JS en segundo plano; el usuario suele escuchar música (Spotify/Apple Music) a la vez.

```js
// audio-engine.js
export async function unlockAudio()     // EN UN GESTO: crea/reanuda AudioContext, fija navigator.audioSession.type
                                        // ('transient' si duckMusic, si no 'ambient'), reproduce 1 buffer silencioso, calienta speechSynthesis
export function applyAudioSettings(audioSettings)
export function beep(kind = 'tick')     // 'tick' (880 Hz 120 ms) | 'go' (1320 Hz 380 ms) | 'up' (dos tonos ascendentes) | 'down' | 'done' (acorde)
export async function loadPack(packId) → { ok, count, name }   // audio/packs/<packId>/index.json + decodifica mp3 bajo demanda
export function hasClips(ids) → bool
export async function playClips(ids) → Promise<void>          // reproduce secuencia sin huecos (AudioBuffer)
export function isUnlocked() → bool

// speech.js (TTS Web Speech)
export function spanishVoices() → SpeechSynthesisVoice[]       // es-ES primero; marca enhanced/premium
export function defaultVoice() → SpeechSynthesisVoice|null      // prefiere es-ES premium/enhanced (Mónica, Marisol, Jorge…)
export function onVoicesChanged(cb) → unsubscribe
export function speak(text, { rate, pitch, volume, voiceURI, interrupt = false } = {}) → Promise<void>  // resuelve al terminar (con timeout de seguridad)
export function cancelSpeech()
export function speechText(text) → string   // normaliza para TTS: '13,0'→'13', 'km/h'→'kilómetros por hora', '0:30'→'30 segundos'

// phrases.js (SIN DOM)
export const PHRASES = { ... }   // banco ≥ 250 frases en categorías (abajo); plantillas con {speed} {zone} {dur} {i} {n} {km} {name} {title} {min}
export function pick(category, rng, vars)  → { id, text }           // evita repetir las 3 últimas de la categoría
export function fill(template, vars) → string
export function fragmentsOf(template) → ['Sube a', '{speed}', 'kilómetros por hora']
export function numberWords(n) → 'once coma cinco' · integerWords(n) → 'veintiuno' · durationWords(sec) → 'un minuto y treinta segundos'
export function clipIdsFor(phraseId, template, vars) → string[]     // ids de clips para packs de voz
// coach.js
export function buildCueSchedule(workout, { chattiness = 'normal', announceLead = 10, name = '', seed = 1 } = {})
   → [{ at /*seg desde inicio*/, kind, priority /*1 baja … 3 alta*/, text, clips /*string[]|null*/, beep /*'tick'|'go'|null*/, segIndex }]
export function createCoach(workout, settings /*state.audio + {name, announceLead}*/) → {
  update(totalElapsedSec),   // dispara las cues vencidas (descarta las de prioridad baja con > 2 s de retraso)
  seek(totalElapsedSec),     // reposiciona sin hablar (tras saltar segmento o reanudar)
  say(kind, vars),           // cues dinámicas: 'km' {km, pace}, 'pause', 'resume', 'adjust' {speed}, 'finish' {km, min}, 'testEnd', 'countdown'
  setMuted(bool), destroy() }
```
Cola de voz: una frase a la vez; prioridad 3 interrumpe a las inferiores; las de prioridad 1 se descartan si llevan > 2 s esperando
o si hay otra a < 6 s. Con pack de voz cargado y todos los clips disponibles ⇒ `playClips`, si no ⇒ TTS. Pitidos con WebAudio
(funcionan con la música). `beeps` y `voiceEnabled` se respetan.

Programa de cues (por cada cambio de segmento en t = T, salvo el primero):
- `T − announceLead` (si el segmento previo dura ≥ announceLead + 8): pre-aviso "En 10 segundos, sube a 11,5" / "baja a 8,3" /
  "prepárate para el sprint"… (varía según subir/bajar/zona e inclinación).
- `T − 3, T − 2, T − 1`: `beep 'tick'`; `T`: `beep 'go'` + "¡Ahora! Correr rápido, 11,5. Dos minutos." (+ "Serie 3 de 8" si rep;
  + `segment.cue` en modo coach).
- Segmentos ≥ 3 min: aviso de mitad en ~50 %; en modo normal/coach, consejo de técnica/respiración/mente cada ~3–4 min
  (coach: cada ~2 min + motivación); hidratación cada ~15 min en sesiones ≥ 45′.
- Segmentos intensos ≥ 60 s: "Últimos 30 segundos, ¡aguanta!"; sprints: "¡Diez segundos!".
- Inicio: saludo + resumen de la clase (título, duración, 1ª velocidad). Mitad del entrenamiento. "Último bloque". Final: felicitación.
- `minimal`: solo pre-avisos, cambios y final. Sin pitidos si `beeps:false`.
Categorías de `PHRASES`: `intro, warmup, speedUp, slowDown, toSprint, toRecover, toFast, toRun, toJog, cooldown, now, repInfo,
halfSegment, last30, last10, halfWorkout, lastBlock, finish, km, pause, resume, adjust, testStage, testEnd, tips.form,
tips.breath, tips.mind, motivation.general, motivation.hard, hydration, inclineUp, inclineDown`. ≥ 6 variantes por categoría.

Packs de voz (ElevenLabs, futuro): `audio/manifest.json` = `{ version, clips: [{ id, text }] }` (lo genera
`tools/build-audio-manifest.mjs` desde `phrases.js`: fragmentos estáticos + números + velocidades 4,0–20,0 + unidades).
`tools/generate-voices.mjs --pack <id> --voice <voiceId> [--model eleven_multilingual_v2] [--only-missing]` con
`ELEVENLABS_API_KEY` en el entorno → escribe `audio/packs/<id>/<clipId>.mp3` + `index.json` `{ id, name, voiceId, clips:[ids] }`
y añade el pack a `audio/packs/packs.json` (`[]` inicialmente). Concurrencia 3, reintentos en 429/5xx. `docs/VOCES.md` explica todo.

## 8. Reproductor (C2)

```js
// engine.js (SIN DOM)
export function createEngine(workout, { onTick, onSegment, onEvent, now = () => Date.now() } = {}) → {
  start(), pause(), resume(), togglePause(), skip(dir /*+1|-1*/), adjustSpeed(delta /*±0.1*/), endTest(), finish(),
  getState() → { status:'ready'|'running'|'paused'|'finished', segIndex, segment, nextSegment, segElapsed, segRemaining,
                 totalElapsed, totalRemaining, distanceKm, kcal, currentSpeed, avgSpeed, progress /*0..1*/ },
  snapshot() → objeto serializable, destroy() }
export function restoreEngine(snapshot, workout, callbacks) → engine
export function buildSession(workout, engineState, { levels, planDate, startedAt }) → Session
```
Reloj por `Date.now()` acumulado (inmune a throttling): tick cada 250 ms; si el JS estuvo suspendido, al volver procesa
todos los cambios de segmento cruzados (eventos `segment` silenciosos salvo el último). La distancia/kcal se integran por
segmento con la velocidad efectiva (incluidos ajustes). `adjustSpeed` cambia la velocidad del segmento actual **y de los
restantes de la misma zona** en esta sesión, recortado a la cinta, y acumula `adjustments[zone]`. Eventos `onEvent(type, data)`:
`start, pause, resume, segment, km, halfway, lastSegment, finish, testEnd, adjust`.

`wakelock.js`: `requestWakeLock()`, `releaseWakeLock()` (re-adquiere en `visibilitychange`), `isWakeLockSupported()`.
`media-session.js`: `setNowPlaying({ title, subtitle })`, `bindMediaControls({ onPlay, onPause, onNext, onPrev })`, `clearNowPlaying()`.

**Pantalla `#/play/:id`** — la joya de la app:
1. **Preparación**: título, perfil completo, duración/distancia estimada, checklist ("Sube a la cinta y ponla a {velocidad inicial}",
   "Inicia *Cinta de correr* en tu Apple Watch" si `watchReminder`), botón enorme **Empezar** (en el gesto: `unlockAudio`,
   `requestWakeLock`, carga del pack) → cuenta atrás 3-2-1 a pantalla completa con pitidos y voz → arranca.
2. **En marcha (vertical)**: fondo negro con degradado radial animado del color de la zona actual; arriba barra con X (confirmar
   salir), título, "Serie 3/8", tiempo total transcurrido/restante; centro: etiqueta de zona en mayúsculas con su color,
   **velocidad gigante** (SF Rounded ~120 px, tabular) con botones −/+ a los lados, ritmo min/km; anillo o barra de progreso del
   segmento con cuenta atrás grande; chip "Siguiente: Trote 8,3 · 1:00" con flecha ↑/↓ que late en los últimos 10 s; fila de
   métricas (distancia, kcal, FC objetivo "Z4 · 141–158"); `profileChart` completo con cursor; controles ⏮ ⏯ ⏭, candado
   (bloquea toques; mantener 1 s para desbloquear), silencio. Destello de color en cada cambio de segmento + `haptic`.
3. **Horizontal** (iPhone en el soporte de la cinta): dos columnas — izquierda velocidad/tiempo enormes, derecha gráfico + métricas.
4. **Test**: botón grande "No puedo más" durante los escalones → `endTest()`.
5. Guarda `snapshot` cada 5 s con `saveActiveSession`; `#/play/resume` lo restaura. Al terminar: `buildSession`, añade a
   `history`, `saveActiveSession(null)`, `releaseWakeLock`, navega a `#/summary/<id>` (replace).
Al salir antes de tiempo: diálogo "¿Terminar entrenamiento?" → Guardar y salir / Descartar / Seguir.

**Pantalla `#/summary/:id`**: cabecera celebratoria (confeti si completó), anillo de completado, grid de estadísticas
(tiempo, distancia, velocidad media, ritmo medio, kcal, velocidad máx.), `zoneBar`, `profileChart` con `trace` real, selector de
sensación (5 caras de `FEELINGS`), FC media/máx opcionales del Apple Watch, notas, **Guardar** → `applyFeedback` (+ `evaluateTest`
si es test) → `setState` (niveles, `levelHistory`, `progression`, sesión actualizada) → `evaluateAchievements` → hoja con
cambios de nivel ("¡Subimos Correr rápido a 11,6 km/h!") y logros nuevos (confeti). Acciones: compartir tarjeta
(`share-card.js`: canvas 1080×1350 con degradado, logo, título, cifras y perfil → `navigator.share({files})` o descarga),
"Guardar en Salud" vía Atajos si `integrations.healthShortcut` (`health.js`: abre
`shortcuts://run-shortcut?name=<n>&input=text&text=<JSON {fecha,minutos,km,kcal}>`), Volver a Hoy. Si la sesión ya tiene
feeling (vista desde historial), modo solo lectura con opción de editar.

## 9. Pantallas (D1, D2)

Todas: `navBar` + `enableCollapsingHeader`, contenido en `.container`, aparición escalonada, estados vacíos cuidados, textos
en español natural. Suscripción al store para refrescar.

**D1 · `onboarding.js`** (fullscreen, 5 pasos con barra de progreso y transición lateral): 1) Bienvenida con logo animado y
"Tu entrenador personal de cinta" → Empezar. 2) Sobre ti: nombre, edad (46), peso, sexo, FC máx (auto 208−0,7·edad, editable),
FC reposo opcional. 3) Tus velocidades: 4 steppers con color de zona y ritmo, valores 8,3/10,1/11,5/13,0, nota "Las iremos
subiendo contigo". 4) Tu semana: minutos L–V (20), jueves (45/50/55/60), día largo del finde (Sábado/Domingo) y su duración,
¿tu cinta tiene inclinación?, vista previa de la semana con colores de categoría. 5) Voz: probar voz (desbloquea audio),
elegir voz es-ES, nivel de charla, consejo del Apple Watch → **Crear mi plan** (`plan.startDate = mondayOf(hoy)`,
`levelHistory` inicial reason 'init', `onboarded = true`, `createdAt`) → `celebrate()` → `#/today` (replace).

**D1 · `today.js`**: saludo según hora ("Buenos días, Nacho") + fecha larga; avatar con inicial → `#/settings`; chip de racha.
Tira semanal L–D con estado (✓ hecho, anillo hoy, punto descanso, tenue perdido) → toca para ver ese día. **Tarjeta hero** del
día (`workoutCard variant 'hero'`) con Empezar (`#/play/<id>?date=<hoy>`), Ver clase (`#/workout/<id>`), Cambiar
(hoja con `alternativesFor`). Si descanso: tarjeta de descanso con mensaje y "Entrenar igualmente" (sugerencias suaves). Si ya
hecho: tarjeta "¡Hecho!" con cifras y "Otra sesión". Tarjeta "Tus velocidades" (4 mosaicos de zona con km/h, ritmo y flecha de
tendencia vs. hace 4 semanas). "Esta semana" (anillo minutos hechos/planificados, km, sesiones). "Ciclo" (Semana 2 de 4 ·
Construcción, barra de 4 tramos, próximo test). "Consejo del coach" (`coachInsight`). Banner "Instala BestRunning" si no es
standalone (Compartir → Añadir a pantalla de inicio).

**D1 · `plan.js`** ("Mi plan"): selector de semana ← → con rango de fechas y nombre de semana del ciclo; barra de ciclo de 4
semanas; lista de 7 días (tarjeta `row` con día, clase, minutos, color, estado). **Reordenar**: mantener pulsado y arrastrar un
día sobre otro para intercambiar (con animación y `haptic`) + alternativa accesible: menú ⋯ → "Mover a…" (actionSheet de días)
→ `swapDays`. Menú ⋯: Cambiar clase (hoja con alternativas), Duración (20/30/45/60), Marcar descanso / Quitar descanso,
Restablecer día. Botón "Añadir al Calendario" (`ics.js`). Toca día → `#/workout/<id>`.

**D1 · `library.js`** ("Clases"): buscador, chips de categoría (Todas + `CATEGORIES`, ocultar Cuestas si no hay inclinación),
segmentado de duración (20/30/45/60), secciones por categoría con carrusel `hscroll` de `workoutCard tile` (si filtro 'all') o
rejilla (si categoría concreta). Seed estable por plantilla. Persistir filtros en `state.ui`. Tarjetas → `#/workout/<id>`.

**D1 · `workout.js`** (detalle): navBar con atrás; hero con `profileChart` grande (`showLevels`), título, subtítulo, chips
(categoría, foco, intensidad); estadísticas (duración, distancia est., kcal est., vel. máx.); `zoneBar`; descripción;
"Estructura" (`groupSegments`: filas con color, tiempo, velocidad, inclinación); consejos del coach; selector de duración si la
plantilla admite varias (regenera); "Programar para…" (actionSheet de los próximos 7 días → `setDayOverride`); botón fijo
inferior **Empezar** (`#/play/<id>`).

**D1 · `ics.js`**: `export function buildIcs(state, { weeks = 4, fromKey }) → string` (VCALENDAR válido, CRLF, eventos a
`schedule.reminderTime` con duración real, título "BestRunning · <clase>", descripción con estructura, VALARM −10 min) y
`export async function exportPlanToCalendar(state)` (`navigator.share` con File .ics; si no, descarga).

**D2 · `progress.js`** ("Progreso"): KPIs (km totales, horas, sesiones, racha en semanas) con `stat` grandes; segmentado
km/minutos + `barChart` de 12 semanas; "Tus velocidades": `lineChart` de los 4 niveles en el tiempo (`levelHistory`), VAM
actual y `gauge` de VO₂máx estimado con categoría por edad (`vo2Category`), "Edad de forma" opcional; `heatmapCalendar` 16
semanas; Récords (de `records`) con enlace a la sesión; Logros: rejilla de medallas (bloqueadas en gris con candado; toca →
hoja con detalle); enlace "Historial completo" → `#/history`.

**D2 · `history.js`**: sin `:id` → lista agrupada por mes (fila: fecha, clase, km, tiempo, color de categoría, cara de
sensación), buscador/filtro por categoría, deslizar o menú para borrar (confirmDialog). Con `:id` → detalle de sesión de solo
lectura (mismo estilo que summary: cifras, zoneBar, profileChart con trace, sensación, FC, notas, cambios de nivel), con
Editar notas/FC/sensación y Borrar.

**D2 · `settings.js`** ("Perfil"): cabecera con avatar grande, nombre, edad, "Miembro desde". Lista agrupada iOS:
- **Perfil**: nombre, edad, peso, sexo, FC máx (botón "Calcular por edad"), FC reposo; zonas de FC calculadas (tabla de color).
- **Velocidades**: 4 steppers (guardan con reason 'manual' en `levelHistory`, una entrada por día como mucho), VAM estimada,
  "Recalcular desde VAM…" (introducir VAM → `levelsFromVam`), historial de cambios.
- **Mi semana**: minutos L–V, jueves, día y minutos del finde, hora de recordatorio, reiniciar ciclo (confirm → `startDate = mondayOf(hoy)`).
- **Cinta**: ¿inclinación?, velocidad mín./máx., antelación de avisos (5/10/15 s).
- **Voz y audio**: voz activada, selector de voz es-ES (lista con "Mejorada"/"Premium" y botón probar), velocidad de habla,
  pitidos, nivel de charla (Mínimo/Normal/Coach), "Bajar la música cuando hablo", Pack de voz (lista de `audio/packs/packs.json`
  + "Voz del sistema"), botón "Probar coach" (frase de ejemplo). Nota: el interruptor de silencio del iPhone puede silenciar los pitidos.
- **Apple Watch y Salud**: recordatorio de iniciar *Cinta de correr* en el Watch; explicación honesta (una web no puede leer el
  pulso del Watch en directo; anota FC media/máx al terminar); nombre del Atajo de Salud + guía paso a paso.
- **Instalar en iPhone**: guía con pasos (Compartir → Añadir a pantalla de inicio) y estado (instalada / no).
- **Datos**: Exportar copia (JSON vía share/descarga), Importar copia (input file), Borrar todo (confirm destructivo doble).
- **Acerca de**: versión (`APP_VERSION`), créditos.
Las subsecciones se abren como `#/settings/<section>` (push) con `section ∈ profile|speeds|week|treadmill|audio|watch|install|data|about`.

## 10. Calidad visual (todos)

- Cifras: `font-family: var(--font-display); font-variant-numeric: tabular-nums; font-weight: 700–800; letter-spacing: -0.02em`.
- Títulos grandes 34 px/800; etiquetas pequeñas en mayúsculas con `letter-spacing: .06em` y `--text-3`.
- Tarjetas con borde `--line` 1 px, degradados sutiles, sombras `--shadow-1`; nada plano y gris sin intención.
- Animaciones: entrada escalonada (`.stagger`), pulsación con escala 0.97 + `--ease-spring`, transiciones de color suaves.
- Accesibilidad: contraste suficiente, `aria-label` en botones de icono, objetivos táctiles ≥ 44 px, `prefers-reduced-motion`.
- Nada de `alert()`/`confirm()` nativos: usa `confirmDialog`/`toast`/`openSheet`.
- Ancho: diseñado para 440 pt (iPhone Pro Max), correcto desde 375 pt; en landscape/iPad se centra con `--content-max`.

## 11. Música DJ por BPM (fase 2)

Objetivo: como en Bestcycling, cada tramo suena con música electrónica acorde a su intensidad, mezclada como un DJ
profesional. Las canciones **no** suenan enteras: en cada cambio de tramo se mezcla a otra pista del ritmo adecuado.
Nivel exigido: **muy pro** (mezclas cuadradas a compás, sin cortes bruscos ni silencios, volumen homogéneo).

### 11.1 Biblioteca
- `audio/music/library.json` (generado por `tools/music/analyze.py`, NO editar a mano):
  `{ version, lufs:-14, tracks:[{ id, file:'audio/music/<id>.m4a', title, artist, source:'Pixabay', page, license,
  curatedTier, tier, sizeBytes, duration, bpm, confidence, beatOffset, barOffset, bars, energy:[0..1 por compás],
  cues:{ mixIn, drops:[seg], outro, hotBars:[índices de compás] } }]}`. Todas normalizadas a −14 LUFS (AAC 160 kbps).
  Opcionales: `statedBpm` (BPM que declara el autor), `forcedBpm` (tempo impuesto en `FORCE_BPM` de analyze.py) y
  `gridShift:'half-beat'` (rejilla movida medio tiempo, `HALF_BEAT_SHIFT`, cuando el peine se engancha a los platos a
  contratiempo y no al bombo).
  55 pistas (20 originales + 35 añadidas el 18-oct-2026 desde `audio/music-src/nuevas/manifest.json` con
  `analyze.py --new`). Por BPM medido: calm 8 (90–117), jog 20 (118–125), run 9 (126–133), fast 6 (135–140),
  sprint 12 (148,5–190; DnB 167–190).
- Pistas importadas por el usuario desde el iPhone (app Archivos): se guardan en IndexedDB (`br-music`, store `tracks`:
  `{ id:'u_…', title, artist, blob, mime, duration, bpm, beatOffset, barOffset, energy, cues, gainDb, tier, addedAt, enabled }`)
  tras analizarlas en el propio iPhone (Worker). Mismo formato de metadatos que la biblioteca integrada + `gainDb`.

### 11.2 BPM objetivo por zona y estiramiento de tempo
| Zona | BPM objetivo | Pool preferido |
|---|---|---|
| warmup | 110 → 120 (sube en cada escalón) | calm, jog |
| walk / cooldown | 112 → 100 (baja) | calm |
| jog | 124 | jog |
| run | 128–130 | jog/run (estiradas) |
| fast | 136–140 | fast (y jog/run estiradas solo si falta) |
| sprint | 172 (DnB) o el nativo si 148–190 | sprint |
El plan calcula `rate = clamp(targetBpm / track.bpm, 0.94, 1.06)`. Una pista es candidata si su BPM estirado cae a ±2 % del
objetivo; si el pool queda vacío, se toma la más cercana (y para sprint se acepta su BPM nativo). **El motor (§11.4) no
estira en directo**: cada voz suena a un rate FIJO recortado a ±3 % (≈ medio semitono), el del plan o, en un beatmix, el que
iguala el tempo de la saliente.

### 11.3 Plan musical — `buildMusicPlan(workout, tracks, { seed, announceLead, prefs }) → MusicPlan` (sin DOM)
`MusicPlan = { cues: [{ segIndex, atSec /*inicio del segmento*/, zone, targetBpm, trackId, offsetSec /*posición en la
pista al llegar atSec*/, rate, transition: 'start'|'beatmix'|'riser-drop'|'echo-out'|'filter-fade', leadSec }] }`
- Un cue por segmento (los segmentos contiguos de la misma zona y BPM comparten pista: sin cambio).
- **Memoria de discos por zona**: al volver a una zona ya usada en la sesión (series sprint/trote), se retoma la misma pista
  donde se quedó (como un DJ alternando dos platos); si queda < 30 s antes de su `outro`, se pasa a la siguiente del pool.
- Tramos intensos (fast/sprint): la primera vez que entra una pista, `offsetSec` se elige para que un **drop** (o el inicio
  de un bloque de `hotBars`) caiga exactamente en `atSec`. La subida (build-up) previa suena durante el pre-aviso.
- Tramos largos: si la pista se acaba antes del final del segmento, cue extra intra-zona a una frontera de frase (16 compases
  antes del `outro`) con `beatmix` hacia otra pista del mismo pool. Nunca repetir pista en una sesión si hay alternativas.
- **Variedad entre sesiones**: `loadLibrary()` marca cada pista con `recentAge` (hace cuántas sesiones sonó, según
  `session.music.tracks` de las últimas `RECENT_SESSIONS` = 5 sesiones con música; `null` si no sonó). Al elegir pista
  nueva, `buildMusicPlan` prefiere las del tramo preferido que no sonaron en esas sesiones; si todas sonaron, la que sonó
  hace más sesiones. Nunca cambia el BPM admitido (siguen las mismas candidatas ±2 %). `opts.recent` permite pasar la
  memoria a mano (Map id → antigüedad, lista de sesiones o lista de ids) y `recent:false` la desactiva. Sin historial
  nuevo el plan es idéntico, así que retomar una clase interrumpida no cambia la música.
- Selección determinista con `seed` (misma clase ⇒ misma música; otro día ⇒ otra mezcla) y con el historial.

### 11.4 Motor DJ — `js/audio/music.js` (+ `js/audio/music-buffers.js`)
**Sobre AudioBuffers** (la versión con dos `<audio>` + `MediaElementSource`, `currentTime` y `playbackRate` corrigiendo la fase
en cada tick daba en iOS silencios en los cambios de tramo y tirones). Mismo `AudioContext` que `audio-engine.js`.
- **Carga** (`music-buffers.js`): cada pista se descarga entera (`fetchTrackData`: caché `br-music` o red; las importadas,
  `blob.arrayBuffer()` de su Blob de IndexedDB, que se vuelve a pedir si iOS lo perdió) y se decodifica en un
  `OfflineAudioContext` propio a la **frecuencia del contexto** (48 kHz en el iPhone: a velocidad 1 no hay remuestreo).
  Memoria acotada en **bytes**: residente + 2× la decodificación en curso + el archivo ≤ 320 MB (≈ el pico del motor
  anterior); si no cabe, se expulsa la que más tarde se va a usar según el plan (Belady) y, si aun así no cabe, esa pista se
  decodifica a 32/24/16 kHz (solo pistas largas o importadas); si ni así, se sustituye. Tras decodificar se guarda solo la
  **ventana** que usa el plan (primera entrada − 2 compases → última salida + 6 compases + 6 % del tiempo que suena), copiada
  a trozos; las voces restan su inicio (`w0`) al arrancar. Como mucho **3** pistas y **1** descarga/decodificación a la vez:
  la descarga se aborta a los 15 s, una petición urgente (< 20 s) aborta una descarga que hace falta más tarde, y los fallos
  se reintentan a los 20 s y 60 s (o ya, al volver la red o la app). Pre-carga: la primera en `load()` y las siguientes hasta
  100 s antes (≥ 45 s garantizados). Si una pista no carga, se sustituye por otra del mismo tramo. `setEnabled(false)` suelta todo.
- **Voz** = `AudioBufferSourceNode` → trim (`gainDb`) → hp → lp → lowShelf 200 Hz (graves) → gain (mezcla) → kill (cortes)
  → dry → bus (y kill → send → eco). `start(cuándo, desde)` en el reloj del contexto (exacto a la muestra) y `playbackRate`
  fijo desde el arranque. Red de seguridad sin JS: `loop` en su última frase de 16 compases.
- **Maestro** (`MASTER` en `music.js`): bus → hp → lp → drive (+0,5 dB) → **glue** (DynamicsCompressor −18 dB, rodilla 12,
  2:1, ataque 10 ms, relajación 250 ms) → **limitador** (−3 dB, rodilla 0, 20:1, 1 ms / 100 ms) → trim (−1,7 dB: descuenta
  la compensación automática del limitador) → duck (voz) → fade (pausa/fin) → music (volumen) → destino (+ `getAnalyser()`,
  con su ventana de dB desplazada +3 dB). La dinámica trabaja SIEMPRE al nivel del 100 %; volumen, voz y pausas atenúan
  después (subir el volumen no aprieta más el limitador). Medido (`docs/audio-tests/volumen-*.json`, estéreo): **80 % ≈
  −14,2 LUFS** integrados (antes −16,5), **100 % ≈ −12,2 LUFS** con true peak ≤ −1,2 dBTP (antes −12,7 LUFS y +0,9 dBTP);
  LRA 4,8 → 3 LU (Pirámide) y 6,1 → 3,8 LU (Bloques); glue ≈ 3 dB de reducción típica, limitador > 1 dB el 13–16 % del
  tiempo y > 3 dB el 0,1–0,2 %. Curva del volumen `volGain(v) = v^(1+(1−v)²)`: 80 % → −2 dB, 50 % → −7,5 dB, 20 % → −23 dB
  (antes v²: −3,9 / −12 / −28 dB); el 0,8 guardado suena ya más fuerte sin migrar nada. Al reanudar, el fundido de entrada
  va en `drive` (antes de la dinámica): con la fuente a pleno el glue y el limitador en reposo apretaban de golpe. No en la
  ganancia de la voz: una mezcla que arranca en ese medio segundo la reprograma (hueco y golpe a pleno).
  Eco: `DelayNode` 3/4 de tiempo ⟲ lowpass/highpass, feedback 0,45. FX (riser + impact) → fx → drive (pasan por la dinámica).
- Todo (fundidos de potencia constante, intercambio de graves, barridos, riser/eco, ducking) son automatizaciones de
  AudioParam programadas por delante (≈ 3 s antes de la primera acción); nada se mueve fotograma a fotograma. Lo
  "inmediato" (pausa, salto, apagar, ducking) va ≥ 25 ms por delante (iOS renderiza a lotes) y los cortes duran ≥ 80 ms.
- Intros flojas: una entrante que cambia en su intro sube su trim lo que le falta para sonar como el cuerpo de la pista
  (por la energía de cada compás, ≤ +6 dB) y vuelve a 0 dB en los 8 compases antes de su primer drop.
- Reloj atascado ('running' sin avanzar > 1 s): no se programa ni se salta nada; en el siguiente toque, suspend()+resume().
  Nunca más de 6 voces. `beatPhase()` resta la latencia de salida (getOutputTimestamp, o outputLatency + baseLatency).
- Tiempo de clase T ↔ reloj del contexto: `c = base + T`; `update(T)` re-ancla `base` suavemente (salto > 1,5 s ⇒ `seek`).
  Un `seek` a otra pista cruza en 1 s con el centro del fundido en el siguiente compás de la saliente y la entrante en el
  suyo (sin dos bombos desfasados).
- iOS: `unlock()` (en el gesto) reanuda el contexto y suena un buffer de 1 muestra; el contexto 'interrupted'/'suspended'
  se reanuda en visibilitychange/pageshow/toque; `navigator.audioSession.type = 'playback'` con la música (`keepSession`).
```js
export function createMusicEngine({ getAudioContext, keepSession, context, now }) → {   // context/now: pruebas offline
  unlock() → Promise<bool>, load(plan, tracksById) → Promise<bool>,  // load decodifica la primera pista
  start(atSec = 0), pause(), resume(), seek(totalSec),   // seek tras saltar segmento: transición rápida (1 s)
  update(totalSec, engineState),  // cada tick: programa transiciones, pre-carga y re-ancla el reloj (sin asignaciones)
  setVolume(0..1), setEnabled(bool), setEffects(bool), setDucking(bool), stop({ fadeSec = 2 } = {}) → Promise,
  nowPlaying() → { title, artist, bpm /*efectivo*/, trackId } | null, getAnalyser(), status(),
  beatPhase() → 0..1 (del reloj del contexto, para animaciones a ritmo), destroy() }
```
Transiciones (cuadradas a compás con `barOffset` + `bpm×rate` de la saliente real):
- `beatmix`: la entrante a la velocidad que iguala la de la saliente (si cabe en ±3 %; con tempo casi igual, mezcla más
  corta para que la deriva en los bordes quede < 0,03 tiempos), compases cuadrados, potencia constante en toda la mezcla e
  **intercambio de graves** en el cambio. Si en el cambio la entrante aún está en una intro floja (energía < 0,6 × la de la
  saliente), la saliente sigue a −3 dB 4–16 compases más (sus graves se van en la primera mitad) hasta el cuerpo o el drop
  de la entrante. Si los tempos no casan ni con ±3 %, pasa a `filter-fade`.
- `riser-drop`: durante `leadSec` la saliente se filtra (highpass hasta 600 Hz, a pleno volumen: el pre-aviso del coach cae
  aquí) mientras crece el riser; en el último tiempo queda a 0,25 bajo el riser (sin efectos no hay corte); en `atSec` la
  entrante entra justo en su drop con "impact".
- `echo-out`: la saliente se despide con eco a compás (seco fuera en 1/16 de compás; realimentación con highpass a 120 Hz);
  la entrante asoma 1/4 de compás antes y está a ≥ 0,8 en el corte, filtrada (lowpass desde 1,5 kHz que se abre en 1 compás),
  en su `mixIn` o donde se dejó (memoria de discos con la posición REAL).
- `filter-fade`: la saliente se cierra (lowpass hasta 1 kHz) y cruzan con potencia constante centrada en el compás del
  cambio (las dos a 0,71 ahí), con los graves de uno en uno; la entrante, desde un lowpass de 1,5 kHz que se abre en un
  compás. Arranque: fundido de 2,5 s desde lowpass. Final: fundido a silencio en los últimos 8 s.
- Pausa: fundido de 0,3 s y fuentes paradas (se guarda la posición); reanudar: fuente nueva ahí con fundido de entrada.
- Si la entrante no está decodificada a tiempo, sigue la actual (con bucle de frase a compás si se acaba) y entra con un
  fundido simple en cuanto esté. **Nunca silencios**.
- **Ducking de voz**: `speech.js` y `audio-engine.playClips` emiten `window.dispatchEvent(new CustomEvent('br:voice',
  { detail: { speaking } }))`; el motor baja la música −11 dB (−10 dB si cae en una transición filtrada) y, por encima del
  80 %, además lo que se haya subido el volumen (100 % → −13 dB): ataque 120 ms, relajación 450 ms. Va tras el limitador, así
  que agacha de verdad. Medido con la voz grabada del coach (pre-aviso «sube a…/sprint» + velocidad, −11,4 LUFS por su
  compresor): voz ≥ 10,9 LU sobre la música agachada (mediana 13–14 LU; antes 8,4 al 80 % y 4,5 al 100 % en los risers) y
  la suma voz + música ≤ −0,55 dBTP (antes hasta +1,4). Los pitidos no ducken.
- Pruebas: `tools/test-music.mjs` (navegador simulado a 48 kHz: mezclas, memoria, reintentos, reloj atascado…) y
  `tools/music-offline.html` (render real en un OfflineAudioContext: Pirámide 20′ a 48 kHz, Bloques 45′ a 44,1 kHz, red a
  3/12 s, decodificación lenta, JS dormido y reloj parado: huecos, clics, baches relativos verificados contra la pista sola
  y sonoridad → `docs/audio-tests/`, con `transiciones.mp3` para escuchar). Mide también niveles: integrada, corto plazo y
  LRA, true peak ×4, reducción de ganancia del glue y del limitador (muestreada en cada paso) y el coach con sus clips
  reales (voz frente a la música agachada y pico de la suma). `?vols=0.8,1&ch=2&lite=1&tag=…&ab=1&master={…}`: volúmenes,
  estéreo, solo niveles, nombre del informe, pasaje A/B de 15 s y ajustes del maestro para probar
  (`volumen-antes.json`, `volumen-despues.json`, `volumen-antes-despues.wav/.mp3`).
- **En el iPhone** (lo que el render offline no ve): abrir por **HTTPS** (GitHub Pages, o `tools/serve.mjs --https` con un
  certificado de mkcert): por http en la red local no hay wake lock ni service worker y la pantalla se apaga y congela la
  app. Con `?debug=music` un panel muestra contexto (estado, Hz, latencias), wake lock, sesión de audio, MB decodificados,
  frecuencia y tiempos de cada pista, fallos y los últimos cambios de estado: captura a mitad de clase, con altavoz y con
  AirPods (el pulso del HUD debe latir con el bombo). Si hay chasquidos con la escena 3D: `?latency=playback`.

### 11.5 Análisis en el iPhone — `js/audio/music-analysis.js` (sin DOM) + `js/audio/music-worker.js` + `js/audio/music-import.js`
`analyzePcm(float32Mono, sampleRate, { priorBpm = 125 }) → { bpm, confidence, beatOffset, barOffset, bars, energy, cues,
loudnessDb, gainDb }` — puerto fiel de `tools/music/analyze.py` (envolvente de onsets por flujo espectral, peine de pulsos con
afinado a 0,01 BPM, downbeat por novedad tímbrica + graves, energía por compás, drops, mixIn, outro, hotBars) + sonoridad
aproximada (RMS con puerta, objetivo −14) → `gainDb` (aplicado al `deckGain`).
`music-import.js`: `importFiles(fileList, onProgress) → [track]` (decodeAudioData, mezcla a mono, remuestreo a 22050, análisis
en Worker, guardado en IndexedDB), `listUserTracks()`, `updateUserTrack(id, patch)` (BPM manual / tap tempo / zona / activar),
`deleteUserTrack(id)`, `userTrackUrl(id)` (objectURL).
`js/audio/music-library.js`: `loadLibrary() → tracks[]` (integradas + usuario activas, con `url`), `cacheAllForOffline(onProgress)`
(Cache API `br-music`), `offlineStatus()`, `TIER_INFO` (nombres en español y colores).

### 11.6 Estado e interfaz
`state.music = { enabled: true, mode: 'app' /*'app'|'own'*/, volume: 0.8 /*curva §11.4: −2 dB*/, effects: true, energy: 'normal' /*'normal'|'max'*/,
useBuiltIn: true, useImported: true, disabled: [] /*ids*/ }`.
- **Reproductor**: botón música (on/off) junto al de silencio; "Sonando: título · 128 BPM" discreto; la velocidad gigante y
  el anillo **laten a ritmo** con `beatPhase()` (escala 1→1,03 y brillo en cada tiempo; desactivado con reduced-motion).
  - **Hoja «Sonido»** (feedback del gimnasio: «la música estaba un poquito bajita»): un toque en ♪ sigue encendiendo/apagando;
    **mantenerlo 450 ms** (anillo que se llena + háptica; también botón derecho/tecla de menú) abre una hoja compacta y opaca
    (`openSheet({ cls: 'mu-snd' })`, sin backdrop-filter, fondo apenas atenuado; en horizontal en la columna derecha para que la
    velocidad siga a la vista) con dos barras grandes de **arrastre relativo** (tocar no salta de valor) y − / + de 52 px
    (de 5 en 5, repetición al mantener): **Música** 0–100 % → `music.setVolume()` y **Voz del coach** 10–100 % →
    `coach.updateSettings({ volume })` (voz y pitidos). Se aplica al instante y se guarda en `state.music.volume` /
    `state.audio.volume` (los mismos de Perfil). Con «Mi música» solo sale la voz. Mientras está abierta los controles se
    recogen; corriendo se cierra sola tras 8 s sin tocarla, en pausa se queda; se cierra tocando fuera, deslizando abajo,
    con ✕ o Escape, y al bloquear o terminar. Descubrimiento: en las 2 primeras clases (`localStorage['br:snd-hint']`, o
    hasta usarla) a los 2,6 s del arranque el aviso «Mantén pulsado ♪ para subir la música» con los controles a la vista y ♪
    latiendo.
- **Perfil → Música** (`#/settings/music`): modo (Música BestRunning / Mi música — Spotify o Apple Music con la voz encima),
  volumen, efectos de DJ, energía, biblioteca agrupada por zona (título, artista, BPM, mini barra de energía, escuchar 15 s
  desde el drop, activar/desactivar), **Importar canciones** (input file `accept="audio/*"` múltiple → progreso de análisis →
  editar BPM/zona, "tap tempo"), "Descargar música para usar sin conexión" con progreso y espacio usado, créditos de Pixabay.
- `sw.js`: no precachea `audio/music/*.m4a`; cache-first en tiempo de ejecución en `br-music`.

## 12. Pulso del Apple Watch vía Atajos (fase 2)

Limitación: una web app en iOS no puede leer HealthKit ni el pulso del Watch en directo (sin Web Bluetooth ni HealthKit).
Solución pro post-entreno: el Watch graba *Cinta de correr*; al terminar, un Atajo lee de Salud las muestras de frecuencia
cardiaca de esa ventana de tiempo y las devuelve a la app por el portapapeles (los enlaces de Atajos abren Safari, no la PWA,
cuyo almacenamiento es distinto).

- `js/integrations/watch-hr.js`:
  - `requestWatchHr(session, shortcutName)` → abre `shortcuts://run-shortcut?name=<n>&input=text&text=<JSON {v:1,id,start,end}>`
    (start/end ISO con zona horaria; end = start + elapsed + pausas, con 60 s de margen a cada lado).
  - `parseWatchHr(text, session)` → acepta el formato del Atajo: JSON `{ v:1, id, avg, max, min, csv }` donde `csv` son líneas
    `fechaISO,valor` (o solo líneas `fechaISO,valor`), tolerante a comas decimales, espacios y formatos de fecha de iOS en
    español; devuelve `{ hrAvg, hrMax, hrMin, hrSeries:[[tSec, bpm]] }` (t relativo al inicio de la sesión, remuestreado a
    1 punto cada 10 s como máximo) o error explicativo.
  - `hrZoneTimes(hrSeries, profile)` → segundos por zona Z1–Z5 (usa `hrZones`).
  - `SHORTCUT_GUIDE` → pasos (en español, nombres exactos de acciones de Atajos en iOS en español) para crear el Atajo
    "BestRunning FC": Recibir texto → Obtener diccionario de la entrada → Buscar muestras de salud (Frecuencia cardiaca, fecha
    de inicio entre `start` y `end`, ordenar por fecha ascendente) → Calcular estadísticas (Media / Máximo / Mínimo) →
    Repetir con cada muestra: Texto `[Fecha de inicio ISO 8601],[Valor]` → Combinar texto (salto de línea) → Diccionario
    {v:1,id,avg,max,min,csv} → Copiar al portapapeles → Mostrar notificación "Vuelve a BestRunning y pulsa Pegar".
- Resumen e historial: botón **"Importar pulso del Apple Watch"** → abre el Atajo → al volver la app (visibilitychange)
  muestra hoja "Pegar datos del Watch" (el `navigator.clipboard.readText()` debe ir en el gesto del botón) → guarda en la sesión
  `hrAvg, hrMax, hrMin, hrSeries, hrZones` → gráfico de pulso superpuesto al perfil de velocidad (línea roja con eje propio),
  tiempo en zonas de FC, y "pulso a velocidad" (FC media en tramos de cada nivel).
- `progression.js` puede usar el pulso: si a la misma velocidad la FC media de los tramos de ese nivel baja ≥ 4 ppm respecto
  a la media de las 3 sesiones anteriores comparables ⇒ cuenta como `easy` para ese nivel; si está > 92 % FCmáx sostenido en
  tramos de `run` ⇒ no subir. `coachInsight` menciona tendencias de pulso ("A 10,1 km/h tu pulso ha bajado 6 ppm en un mes").
- Ajustes → Apple Watch y Salud: guía visual paso a paso del Atajo + campo con el nombre del Atajo + botón "Probar Atajo".
- Sesión (§3) añade: `hrMin: null, hrSeries: null, hrZones: null`.

## 13. Fase 2 — reparto y decisiones

Decisiones nuevas (vinculantes):
- `audio-engine.js` exporta además `getAudioContext()` (crea/devuelve el AudioContext compartido; no lo reanuda) y
  `setAudioSessionType(type)` ('playback' | 'transient' | 'ambient' | 'auto').
- `speech.js` (al empezar/terminar cada utterance) y `audio-engine.playClips` (al empezar/terminar la secuencia) emiten
  `window.dispatchEvent(new CustomEvent('br:voice', { detail: { speaking: true|false } }))` (protegido con `typeof window`).
- Pack de voz grabado: `js/audio/voice-pack.js` (YA EXISTE, no reescribir el guion; solo se puede añadir API) define
  `PACK_ID='eva'`, `PACK_SCRIPT`, `composeCue(kind, vars, { pick, available })`, `speedClip`, `durationClip`, `clipsText`.
  Los mp3 estarán en `audio/packs/eva/<id>.mp3` + `index.json` (los genera `tools/voice/generate-pack.mjs`; aún no existen).
  `defaultState().audio.packId = 'eva'`. Si el pack no carga ⇒ voz del sistema (sin errores visibles).
  Con pack cargado, el coach construye TODOS sus avisos con `composeCue` (avisos que no se puedan componer ⇒ se omiten,
  salvo los de cambio de tramo, que caen a la voz del sistema). Nunca mezclar dentro de un mismo aviso clips y TTS.
- Estado nuevo: `defaultState().music` según §11.6; Session añade `hrMin, hrSeries, hrZones` (§12) y `music: { tracks:[ids] }`.
- CSS nuevo de música y pulso en `css/music.css` (enlazado en index.html después de player.css).
- Todas las pantallas deben verse perfectas en **vertical y horizontal** en iPhone (956×440 pt en horizontal con la
  Dynamic Island en un lateral ⇒ usar `max(var(--gutter), var(--safe-l))` / `--safe-r`). En horizontal: tab bar compacta
  (altura 48, icono + etiqueta en línea), large titles más pequeños, rejillas a 2 columnas donde aporte (Hoy: héroe a la
  izquierda y resto a la derecha; Clases: rejilla; Progreso: gráficos en 2 columnas; Ajustes: lista centrada), hojas
  inferiores con alto máximo y scroll interno, resumen post-entreno a 2 columnas.
- El logo dentro de la app (bienvenida, splash, share card) debe ser el mismo símbolo del icono (chevron con líneas de
  velocidad sobre degradado ember, ver `assets/icons/icon.svg`).

| Propietario | Archivos (fase 2) |
|---|---|
| **M1 · Motor DJ** | `js/audio/music.js` (motor), `js/audio/music-plan.js` (buildMusicPlan, sin DOM), `js/audio/music-library.js`, `tools/test-music.mjs` |
| **M2 · Análisis e importación** | `js/audio/music-analysis.js` (sin DOM), `js/audio/music-worker.js`, `js/audio/music-import.js`, `tools/test-music-analysis.mjs` |
| **M3 · Pulso Apple Watch** | `js/integrations/watch-hr.js`, `js/screens/summary.js`, `js/screens/history.js`, `js/training/progression.js`, `tools/test-watch-hr.mjs` |
| **M4 · Voz grabada en el coach** | `js/audio/coach.js`, `js/audio/speech.js`, `js/audio/audio-engine.js`, `tools/test-audio.mjs` |
| **M5 · Integración música/ajustes** | `js/screens/player.js`, `js/screens/settings.js`, `js/core/store.js`, `index.html`, `sw.js`, `css/music.css`, `css/player.css` |
| **M7 · Horizontal y pulido visual** | `css/base.css`, `css/components.css`, `css/screens-main.css`, `css/screens-more.css`, `js/screens/onboarding.js`, `js/ui/components.js` (solo celebrate/navBar/estilos si hace falta) |

## 14. "HYPERTRACK" — escena 3D del entrenamiento (three.js)

Objetivo del usuario: animaciones 3D espectaculares en la pantalla de entrenamiento que hagan *sentir* cada intervalo,
momento y escalón; "que todos en mi gym flipen". Debe verse brutal en el iPhone sobre la cinta (vertical y horizontal) y
también por AirPlay en una tele.

Concepto: corres por una **autopista de neón infinita**. La velocidad del mundo = velocidad real de la cinta (si subes a
13,0, el mundo acelera de verdad). Elementos:
- **Pista**: suelo de rejilla luminosa por shader (líneas que se desplazan, carriles que laten con `beatPhase` de la
  música), niebla de distancia, horizonte con "sol" retro y cielo por shader que cambia con la zona.
- **Puertas de tramo**: cada tramo próximo es un arco/portal del color de su zona situado a una distancia = tiempo que
  falta × velocidad visual, con la velocidad del tramo ("13,0") en un panel (textura de canvas, nítida). Se ven venir las
  2–3 siguientes; **atraviesas la puerta justo en el segundo del cambio** (sincronizado con el "¡Ahora!" del coach).
- **Skyline de la clase**: a ambos lados, el perfil completo del entrenamiento extruido como columnas de luz (InstancedMesh)
  colocadas a lo largo de la pista según su tiempo: corres a través de tu propio gráfico de barras estilo Bestcycling. Las
  ya pasadas se apagan; la actual brilla; las futuras en su color.
- **Partículas**: estelas de velocidad (longitud ∝ velocidad), polvo de luz flotante.
- **Postproceso**: bloom (UnrealBloom), viñeta, aberración cromática solo en sprint. Calidad adaptativa.
Estados por zona: calentamiento (amanecer suave) · trote/recuperación (aurora azul-verde, partículas lentas, sol que
"respira" 4 s/4 s como guía de respiración) · correr (ámbar, pulsos al ritmo) · rápido (naranja, más estelas, FOV +5) ·
**sprint = HYPERDRIVE** (rojo/magenta, FOV abierto, estrellas en warp, líneas de velocidad en los bordes, micro-temblor a
ritmo, bloom fuerte, aberración cromática) · vuelta a la calma (atardecer violeta, estrellas, desaceleración).
Momentos: últimos 3 s antes de un cambio → la puerta gira y brilla, números 3-2-1 en 3D que vuelan hacia la cámara ·
cruce de puerta → onda expansiva + explosión de partículas del color de la zona + destello · drop de la música → pulso
de toda la escena · km → cartel gigante "KM 3" que atraviesas con confeti 3D · mitad → arco "MITAD" · **test VAM** → la
pista se convierte en una **escalera de luz** que sube un peldaño por escalón (la cámara asciende; al pulsar "No puedo
más" desciende flotando) · **final** → plano de dron que se eleva y revela todo el skyline de la clase desde arriba, con
confeti (perfecto para enseñarlo en el gimnasio).
"Modo TV" (para AirPlay/duplicar pantalla): escena a pantalla completa con HUD mínimo (velocidad gigante, cuenta atrás,
siguiente tramo).

Arquitectura (archivos del agente S1):
- `js/vendor/three/` — three.js vendorizado (versión estable publicada hace ≥ 2 semanas, desde el registro npm), solo
  `three.module.min.js` y los addons necesarios (EffectComposer, RenderPass, UnrealBloomPass, OutputPass, ShaderPass y
  sus shaders), con los `import 'three'` reescritos a rutas relativas (sin import map). Incluir LICENSE.
- `js/player/scene3d.js` (+ submódulos en `js/player/scene3d/`) con la API:
```js
export function isWebGLAvailable() → bool
export async function createScene3D(canvas, { workout, levels, quality = 'auto' /*'auto'|'high'|'eco'|'off'*/,
                                              reducedMotion = false, tvMode = false }) → {
  setState({ status, totalElapsed, segIndex, segElapsed, segRemaining, currentSpeed, distanceKm }), // cada tick (4 Hz); interpola
  setBeat(phase /*0..1*/, bpm),                   // desde el motor DJ (si hay música)
  event(type, data),                              // 'segment' {index} | 'countdown' {n} | 'km' {km} | 'halfway' | 'drop'
                                                  // | 'finish' | 'pause' | 'resume' | 'testStage' {stage} | 'testEnd' | 'adjust' {speed}
  resize(), setQuality(q), setTvMode(bool), destroy() }
```
  Bucle rAF propio; pausa con `document.hidden`; DPR máx. 2; calidad adaptativa (si < 50 fps: baja DPR y resolución del
  bloom; 'eco' = 30 fps sin bloom); `prefers-reduced-motion` ⇒ escena serena sin temblores ni warp; nunca debe tumbar el
  entreno (todo en try/catch; si falla WebGL, el reproductor usa su fondo 2D actual).
- `tools/scene-lab.html` — laboratorio para ver la escena sin entrenar: elegir clase, deslizador de tiempo, velocidad,
  botones para disparar eventos, modo TV, calidad, fps en pantalla.
Integración posterior (agente S2, tras la fase 2): `player.js`/`player.css` (lienzo de fondo bajo el HUD de cristal, eventos
del motor, beat del motor DJ, modo TV), ajuste "Animaciones 3D: Auto/Alta/Ahorro/Desactivadas" en Ajustes, y comentarios de
música del coach (`voice-pack.js` MUSIC_CUES: 'drop' justo antes de un drop alineado al inicio de un tramo intenso,
'energy' en tramos rápidos/sprint con la música arriba, 'flow' en tramos largos estables; máx. 1 cada ~3 min).

### 14.1 Exigencias extra del usuario (vinculantes)
"Debe ser algo espectacular, lo nunca visto en apps de correr; que se vean geniales los fondos 3D y que **no se pierda
nada de los datos**."

**Regla de oro de datos**: la escena es el escenario, el HUD es la estrella. En ningún estado (sprint, cruces de puerta,
confeti, destellos, drop, plano de dron) puede quedar ilegible ni tapado ningún dato del reproductor: velocidad, zona,
cuenta atrás del tramo, siguiente tramo, transcurrido/restante, distancia, kcal, FC objetivo, serie, perfil y controles.
- API extra: `setHudRects(rects)` — rectángulos (px CSS) que ocupa el HUD; la escena oscurece/desenfoca suavemente esas
  zonas (máscara en el postproceso) y nunca dibuja destellos fuertes ni números 3D encima. Los efectos de "momento"
  (3-2-1, KM, MITAD) se colocan en el espacio libre (en vertical, banda superior bajo la Dynamic Island o entre bloques;
  en horizontal, la columna derecha libre) o son translúcidos y breves.
- Contraste mínimo WCAG 4.5:1 del texto del HUD sobre lo que haya detrás en cualquier fotograma (se verifica muestreando
  píxeles en capturas). El brillo de bloom bajo el HUD se limita.

**Ideas "nunca vistas" que hay que implementar** (además de §14):
1. **Fantasma de tu mejor marca**: si existe una sesión anterior de la misma clase/plantilla, un corredor holográfico
   (silueta low-poly luminosa con estela) corre en la pista a la distancia relativa real (tu distancia vs la suya en el mismo
   segundo, a partir de su `speedTrace`); un indicador "+35 m" / "−12 m". API: `setGhost({ trace:[[t,speed]...], label })`.
2. **Mundo audio-reactivo de verdad**: el skyline y la rejilla reaccionan al **espectro real de la música** (AnalyserNode
   del motor DJ): graves → pulso del suelo y del sol, medios → columnas, agudos → partículas. API: `setAnalyser(node|null)`
   (si no hay música, simulación suave a partir del beat).
3. **Cámara a tu zancada**: balanceo sutil sincronizado con una cadencia estimada (≈ 150 + 2,3 × km/h pasos/min, 160–185),
   desactivable y nulo con reduced-motion; nada de mareos.
4. **Pista dorada de récord**: si vas por delante del fantasma o camino de tu mejor distancia en esa clase, la pista y las
   estelas viran a oro y aparece un aura "RÉCORD".
5. **Clima por zona**: lluvia de luz en sprint, nieve de luz en vuelta a la calma, luciérnagas en recuperación.
6. **Barra de "jefe" del intervalo**: en tramos intensos, un túnel de anillos que se van encendiendo a medida que pasa el
   tramo (sensación de progreso física), y al completarlo estallan.

### 14.2 Observaciones del director (Claude) sobre la primera versión — corregir sí o sí
Capturas en el laboratorio (440×956, HUD simulado encima) a las 00:47:
- **Sobreexposición grave**: el bloom/tonemapping lava la escena hasta casi blanco (trote: neblina blanca-verdosa; sprint:
  rosa-blanco). Resultado: textos del HUD como "km/h", el ritmo "7:14 min/km" y los rótulos pequeños quedan ilegibles.
  Esto incumple la regla de oro (§14.1) y además se ve barato.
- Dirección visual obligatoria: **fondo profundo casi negro** (cielo #05060a–#0b0d16 con degradado sutil de la zona), neón
  saturado SOLO en elementos emisivos finos (líneas de pista, aristas de las columnas, portales, estelas), bloom con umbral
  alto (solo lo emisivo brilla), exposición ≈ 0,8–1,0 con tone mapping ACES u OutputPass correcto, niebla oscura. La
  luminancia media detrás del HUD debe quedar < 12 % y nunca saturar a blanco. Nada de "niebla blanca".
- Las columnas del skyline deben leerse como **columnas de cristal oscuro con aristas de neón y cara superior encendida**,
  no como bloques blancos translúcidos.
- El sprint debe ser intenso por **contraste y movimiento** (estrellas en warp, líneas rojas/magenta sobre negro, FOV,
  aberración), no por subir el brillo global.
- Comprobar en cada estado que el texto blanco del HUD (incluido el pequeño en --text-2) mantiene ≥ 4,5:1.

## 15. Escenarios 3D profesionales (sustituye la estética de §14; se mantiene su API y §14.1)

Feedback del usuario tras ver la v1: "Es un poco cutre el túnel con avance 3D; hay cosas de la app que se pierden por tanta
luz blanca." · "**Lo quiero más profesional.**" ⇒ Nada de synthwave/neón de feria, nada de neblina blanca.

### 15.1 Dirección de arte (vinculante)
- Referencias de calidad: Apple Fitness+/Apple Watch, Nike Run Club, gráficos de retransmisión de F1 y de atletismo
  (Diamond League, luces de ritmo "Wavelight"), anuncios de producto premium. Pregunta de control: *¿lo publicaría Apple?*
- Paleta: negros/grafito profundos (#050608–#12141a) y materiales mate o cristal oscuro. Los colores de zona son
  **acentos** (líneas finas, pequeñas luces, reflejos), nunca lavados de pantalla completa. Máximo 2 acentos a la vez.
- Luz: creíble. Tone mapping ACES (o AgX) con exposición ≤ 1,0. Bloom solo en fuentes emisivas pequeñas (umbral ≥ 0,85,
  intensidad ≤ 0,6, radio pequeño). Prohibido el "glow" global, la niebla blanca y los destellos a pantalla completa.
- Movimiento: cámara cinematográfica suavizada (amortiguación crítica), aceleraciones creíbles ligadas a la velocidad real,
  sin temblores (salvo balanceo de zancada opcional y muy sutil). Transiciones de tramo elegantes (barridos de luz finos,
  cambios de color graduales), no explosiones de confeti baratas; los "momentos" son sobrios y precisos.
- Tipografía 3D: mínima, estilo retransmisión (versalitas, tracking amplio, SF), nunca detrás del HUD.
- Datos primero (§14.1): luminancia media detrás de cualquier bloque del HUD ≤ 8 %; máscara `setHudRects` obligatoria.
- Composición: en vertical, la acción visual vive en la banda superior (bajo la Dynamic Island) y en la "ventana" entre la
  tarjeta de cuenta atrás y las métricas; en horizontal, en la mitad derecha. El centro detrás del número gigante, sereno.

### 15.2 Arquitectura de temas
`js/player/scene3d.js` = núcleo (renderer, postproceso sobrio con máscara del HUD, línea temporal, eventos, calidad
adaptativa, espectro de la música, fantasma, cámara, API §14 + §14.1 + `setTheme(name)`). Cada escenario es un plugin en
`js/player/scene3d/themes/<nombre>.js` (+ subcarpeta opcional) con:
```js
export const meta = { id, name /*es*/, description /*es*/ }
export function createTheme(ctx) → { update(frame), event(type, data), resize({ width, height, aspect }), dispose() }
// ctx: { THREE, scene, camera, renderer, root, quality, reducedMotion, palette (ZONES), workout, timeline helpers
//        (segStart(i), segAt(t), zoneAt(t), speedAt(t), distanceAt(t), totalSec), textTexture(text, opts), hud }
// frame: { t, dt, totalElapsed, segIndex, segElapsed, segRemaining, speed, zone, nextZone, timeToNext, beatPhase, bpm,
//          spectrum: { bass, mid, high }, ghost: { active, deltaM, label }, status, tvMode, aspect, hudRects }
```
Escenarios a construir en paralelo (y elegir por jurado; los buenos quedan seleccionables en Ajustes → "Escenario"):
1. **CORDILLERA** — la clase como cordillera: terreno oscuro mate con curvas de nivel finas (estilo topográfico/telemetría
   F1); cada intervalo intenso es una cumbre que se ve venir en el horizonte; un camino de luz fino recorre la cresta; la cámara
   vuela bajo y suave; cielo nocturno con aurora muy tenue que reacciona a la música; el fantasma es un punto de luz en el camino.
2. **AURORA** — abstracto cinematográfico: cortinas de aurora volumétrica y un río de partículas finas sobre negro azulado;
   el flujo acelera con la velocidad; en sprint se tensan, se encienden y se aceleran; en recuperación respiran (4 s/4 s);
   reactivo a la música con elegancia. Ningún lavado blanco.
3. **ESTADIO** — atletismo de élite de noche: pista de grafito con líneas de calle blancas precisas, focos lejanos con
   bokeh, **luces de ritmo tipo Wavelight** en el bordillo que corren a tu velocidad objetivo (y otra hilera para tu fantasma),
   rótulos de retransmisión sobrios con los próximos tramos ("200 m · SPRINT 13,0"), marcas de distancia en la pista.
- Feedback adicional del usuario: "**Los destellos no parecen serios.**" ⇒ PROHIBIDO: destellos de pantalla, ráfagas de
  luz, rayos/god-rays, chispas, explosiones de partículas, confeti 3D, estelas de warp tipo ciencia ficción, aberración
  cromática llamativa. Los cambios de tramo y momentos se comunican con: transición de color gradual del acento, cambio de
  ritmo del movimiento, una línea/plano de luz fino que pasa una vez, tipografía de retransmisión sobria, ligera variación
  de exposición (≤ 10 %). Profesional y serio, como un gráfico deportivo de televisión de primer nivel.
- La v1 (túnel de neón) se conserva solo como tema oculto 'legacy' para no romper nada; no se ofrece en Ajustes.

### 15.3 SIN MÁSCARAS (feedback del usuario con captura, sustituye a la máscara de §14.1 y §15.1)
"**No quiero máscaras que recorten el fondo.**" En su captura se veían rectángulos oscurecidos/desenfocados detrás de los
bloques del HUD y el número de velocidad gigante salía **borroso**. Reglas nuevas, vinculantes:
- PROHIBIDO oscurecer, desenfocar o recortar zonas rectangulares de la escena (nada de máscara por `setHudRects`, nada de
  `backdrop-filter` sobre áreas grandes que dejen ver "cajas" del fondo, nada de desenfoque detrás o encima del número).
  `setHudRects` puede seguir existiendo solo como información de composición (p. ej. para no colocar rótulos 3D detrás del
  HUD), nunca para pintar máscaras.
- El número de velocidad gigante debe verse **nítido** siempre (sin filtros de desenfoque, sin capas translúcidas encima);
  su legibilidad sale de: escena oscura y serena en esa zona por composición (cámara/encuadre/contenido), sombra de texto
  suave y un halo muy sutil del color de la zona.
- Los bloques del HUD (tarjetas) usan su PROPIO fondo de tarjeta (oscuro, semiopaco, bordes redondeados, borde fino) — eso
  es diseño de tarjeta, no máscara — y no deben ser enormes. El fondo 3D debe seguir viéndose continuo e íntegro alrededor.
- La legibilidad global se consigue con escenas profesionales oscuras (§15.1), no con parches.
- La línea "Sonando" nunca puede mostrar dos títulos solapados: al cambiar de pista, fundido cruzado limpio (uno sale, otro
  entra) o recorte con elipsis, en una sola línea.
- La etiqueta de zona (p. ej. "RÁPIDO +") usa SIEMPRE el color de su zona (fast = naranja), nunca otro.

## 16. HUD de retransmisión profesional (sustituye el HUD de tarjetas del reproductor en modo 3D y 2D)
Feedback del usuario sobre la pantalla de entreno (captura en horizontal): "**Es cutre.**" Diagnóstico: demasiadas
tarjetas grandes encima del fondo ⇒ la escena se ve a parches; número de velocidad borroso; recuadros de máscara; textos
solapados. Nuevo enfoque: **la escena es la imagen de televisión a pantalla completa; el HUD son rótulos de retransmisión**
(nivel F1 TV / Diamond League / Apple Fitness+): pocos, pequeños, nítidos, alineados a una rejilla estricta.

- Rótulos ("plates"): fondo propio oscuro #0b0d12 al 80–88 % de opacidad, borde 1 px rgba(255,255,255,.08), radio 10–12,
  **sin backdrop-filter**, sin sombras gordas; tipografía SF con cifras SF Rounded tabulares; versalitas con tracking para
  etiquetas. Máximo 3–4 rótulos visibles en carrera. Márgenes seguros (Dynamic Island, home indicator, laterales en
  horizontal).
- **Velocidad**: número gigante (SF Rounded 800, ~130–150 px en vertical) directamente sobre la escena, SIN rótulo ni
  desenfoque, blanco nítido con sombra suave (0 2px 24px rgba(0,0,0,.55)); encima, la etiqueta de zona en su color en
  versalitas; debajo, el ritmo pequeño. Los botones −/+ son discretos y aparecen con los controles.
- **Lower third** (rótulo inferior único): cuenta atrás del tramo grande + barra de progreso fina del color de la zona +
  "SIGUIENTE · Trote 8,1 · 0:50" + mini perfil de la clase (tira de ~36 px con cursor) — todo dentro del mismo rótulo.
- **Barra superior fina**: clase · tramo "6/18" · transcurrido / restante · línea de progreso de la clase (hairline).
- **Métricas**: una sola línea compacta (distancia · kcal · FC objetivo con chip Z4) en un rótulo estrecho o integrada en el
  lower third. "Sonando: título · 136 BPM" en una línea con elipsis y fundido limpio (nunca dos textos solapados).
- **Controles** (⏮ ⏯ ⏭, candado, voz, música, TV): ocultos mientras corres; un toque en cualquier parte los muestra 4 s con
  fundido; siempre visibles en pausa. En test VAM, "No puedo más" siempre visible (grande, abajo).
- **Momentos** como "bugs" de retransmisión: rótulo pequeño que entra deslizando por arriba a la derecha ("KM 3", "MITAD",
  "SERIE 3/8", "RÉCORD +10 m") 3 s y sale; la cuenta atrás 3-2-1 vive dentro del lower third (cifras que cambian con un
  corte limpio), sin números 3D volando. Sin destellos de pantalla en cambios de tramo: solo cambio gradual del color de
  acento y una línea fina que barre el lower third.
- **Horizontal (956×440)**: velocidad grande a la izquierda (con zona y ritmo), lower third y métricas en la columna derecha
  inferior, barra superior fina; la escena se ve entera; controles al tocar.
- **Modo TV**: aún más mínimo (velocidad, zona, cuenta atrás, siguiente).
- El modo 2D (sin WebGL o "Desactivadas") usa el mismo HUD sobre el fondo degradado oscuro actual.
- El laboratorio 3D dibuja este mismo HUD en sus capturas mediante `tools/hud-mock.js` (export `drawHud(ctx2d, w, h, data,
  orientation)`), mantenido por quien diseñe el HUD para que sea fiel al real.
- Feedback del usuario: "**Los datos son importantes; hay que buscar un equilibrio.**" ⇒ Equilibrio explícito: los datos
  (velocidad, cuenta atrás, siguiente, transcurrido/restante, distancia, kcal, FC objetivo, serie, perfil) siempre completos,
  grandes donde importan y legibles de un vistazo corriendo a 13 km/h; la escena 3D se ve entera y bonita alrededor. Ni
  HUD invasivo de tarjetas gigantes ni datos escondidos por estética. Los jueces evalúan las dos cosas a la vez.
