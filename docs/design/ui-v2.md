# BestRunning · Lenguaje visual v2 («serio, elegante, iOS»)

Fuente de verdad para todas las pantallas. Referencias: Apple Fitness / Actividad, Nike Run Club, Strava (oscuro).
Tipografía primero, monocromo, los datos mandan. **El color solo aparece cuando significa algo.** Es la misma
regla que la app del reloj: negro puro, tipografía y pequeños acentos de color de zona.

Implementado a nivel de sistema en `css/tokens.css`, `css/base.css`, `css/components.css`, `js/ui/components.js`,
`js/ui/charts.js` y la tab bar de `js/app.js`. Las pantallas solo deben **usar** estas piezas y **quitar** lo que se
lista en «Patrones prohibidos».

---

## 1 · Tokens (css/tokens.css)

### Superficies
| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#000000` | fondo de todas las pantallas (sin brillos ambientales) |
| `--surface-1` | `#111113` | tarjetas, listas agrupadas, miniaturas |
| `--surface-2` | `#1C1C1E` | campos, botones secundarios, chips, filas seleccionadas |
| `--surface-3` | `#2C2C2E` | estado pulsado |
| `--surface-4` | `#3A3A3C` | pulsado dentro de hojas |
| `--fill` / `--fill-2` | `rgba(118,118,128,.24/.32)` | botones redondos de barra, búsqueda, segmentado |
| `--material` + `--material-filter` | `rgba(0,0,0,.72)` + `blur(20px) saturate(180%)` | SOLO tab bar, barra compacta y paneles del HUD |

Dentro de `.sheet`, `.dialog` y `.asheet` (fondo `#1C1C1E`) las superficies suben un escalón automáticamente
(`--surface-1/2` = `#2C2C2E`, `--surface-3` = `#3A3A3C`). No hay que hacer nada en las pantallas.

`--surface`, `--bg-elev` son alias heredados de `--surface-1`.

### Separadores
- `--sep: rgba(84,84,88,.45)` con `--hairline` (0,5 px; 1 px en pantallas de densidad 1).
- Receta: `box-shadow: inset 0 calc(-1 * var(--hairline)) 0 var(--sep)` o `border-bottom: var(--hairline) solid var(--sep)`.
- Las tarjetas **no llevan borde**. `--line` (heredado) es casi invisible; no usarlo para bordes nuevos.

### Texto
| Token | Valor | Uso |
|---|---|---|
| `--text` | `#FFFFFF` | primario, cifras |
| `--text-2` | `rgba(235,235,245,.62)` | secundario: subtítulos, unidades, rótulos, valores de lista |
| `--text-3` | `rgba(235,235,245,.55)` | leyendas pequeñas informativas (AA sobre surface-2) |
| `--text-4` | `rgba(235,235,245,.38)` | terciario **solo decorativo**: chevrones, deshabilitado, placeholder |

### Acento y CTA
- `--accent: #FF5A1F` (ember) **sólido, nunca degradado ni brillo**. Solo: pestaña activa, marcador de hoy en la tira
  semanal, relleno de progreso, lo «en vivo»/récord, enlaces (`.btn--ghost`, acciones de encabezado).
- `--cta-bg: #FFFFFF` / `--cta-fg: #000000` / `--cta-bg-pressed: #D1D1D6`: CTA principal estilo Nike.
  Para pasar el CTA a ember en una línea: `--cta-bg: var(--accent); --cta-fg: #fff; --cta-bg-pressed: var(--accent-pressed)`.
- Heredados **neutralizados**: `--accent-grad` = `--accent` (sólido), `--accent-glow` = sin sombra, `--accent-2` =
  `--accent`, `--shadow-1/2` = sin sombra. Cualquier resto en las pantallas ya se ve plano, pero hay que borrarlo.

### Estados
`--ok #30D158` (solo marcas pequeñas de completado), `--warn #FFD60A`, `--danger #FF453A` (texto destructivo),
`--info #64D2FF`, `--switch-on` (interruptor encendido = verde iOS).

### Zonas (solo dentro de visualización de datos)
`--z-warmup #64D2FF` · `--z-walk #AEAEB2` · `--z-jog #30D158` · `--z-run #FFD60A` · `--z-fast #FF9F0A` ·
`--z-sprint #FF375F` · `--z-cooldown #7D7AFF` (mismos valores que `ZONES` en `js/training/levels.js`).
Permitidas en: barras del perfil, tira de tramos, punto de zona (`.zdot`), rótulo de zona del HUD, leyenda de zonas.
Nunca como fondo de tarjeta, borde, brillo o degradado.

### Categorías: SIN color
`--c-intervals … --c-test` y `--cat` valen **gris `#8E8E93`**. La categoría es un rótulo `.eyebrow` (12 px, mayúsculas,
gris). Los chips de filtro son monocromos. `categoryColor()` devuelve ese gris; `categoryName(key)` da el nombre.

### Radios, espaciado, movimiento
- iOS 26: `--r-card 22` (tarjetas/listas, radios concéntricos) · `--r-btn` = cápsula (todos los `.btn`, también
  `--sm`) · `--r-md 12` (miniaturas) · `--r-sm 10` (campos) · `--r-xs 6` (badges) · `--r-pill` (chips, stepper,
  segmentado, búsqueda).
- Rejilla de 8 pt: `--s-1 4` · `--s-2 8` · `--s-3 12` · `--s-4 16` · `--s-5 20` · `--s-6 24` · `--s-8 32` · `--s-10 40` · `--s-12 48`.
  `--gutter` = 16, **20 en Pro Max** (≥ 414 px). `--section-gap: 32px` entre secciones.
- `--ease-out` (entrada), `--ease-ios` (hojas/navegación), `--dur-fast 160` · `--dur 220` · `--dur-slow 320`,
  `--rise 8px`. `--ease-spring` ya no rebota.

### Tipografía (SF Pro; `--font-display` = SF Pro Display para cifras; `--font-rounded` solo si se pide)
| Clase | Tamaño/interlineado | Peso |
|---|---|---|
| `.large-title` | 34/41 | 700 |
| `.title1` | 28/34 | 700 |
| `.title2` | 22/28 | 700 |
| `.title3` | 20/25 | 600 |
| `.headline` | 17/22 | 600 |
| `.body` | 17/22 | 400 |
| `.callout` | 16/21 | 400 |
| `.subhead` | 15/20 | 400 |
| `.footnote` | 13/18 | 400 |
| `.caption` | 12/16 | 400 |
| `.eyebrow` | 12/16 mayúsculas, +0.05em, `--text-2` | 600 |
| `.num` / `.display-num` | SF Pro Display, tabulares, −0.02/−0.03em | 700 |
| `.unit` | 45 % de la cifra, `--text-2` | 600 |

Tokens: `--fs-large/--lh-large`, `--fs-title1/--lh-title1`, … `--fs-caption/--lh-caption`, `--fs-caption2: 11px`.
**Nunca 800.** Nunca texto degradado (`.grad-text` ya pinta blanco). Marca: «Best» blanco sólido, «Running» como mucho
`--accent` sólido.

---

## 2 · Recetas (qué usar)

### Pantalla
```html
<div class="screen">
  ${navBar({ title: 'Hoy' })}                       <!-- large title 34/41 a la izquierda -->
  <p class="subhead muted">Lunes, 19 de octubre</p>  <!-- fecha en gris bajo el título -->
  <section class="section">…</section>               <!-- 32 px entre secciones -->
</div>
```

### Encabezado de sección (FUERA de la tarjeta)
`sectionHeader('Tus velocidades', actionHtml)` → 13 px, mayúsculas, gris, con 16 px de sangría (como iOS).
Acción a la derecha: enlace en acento, 15 px regular. Para un titular que mande: `sectionHeader(t, a, { large: true })`
(Title 2 blanco). Para listas: `<h2 class="list-header">…</h2>` + `.list` + `<p class="list-footer">…</p>`.

### Tarjeta
`.card` = `--surface-1`, radio 16, padding 16, sin borde ni sombra. `.card--hero` = igual con padding 20.
Pulsable: `.card--pressable` (escala 0,985 + opacidad). Dentro: `.eyebrow` → título (`.title1`/`.title2`/`.headline`)
→ texto `.subhead.muted` → fila meta en gris.

### Botones
| Clase | Aspecto |
|---|---|
| `.btn.btn--primary.btn--lg` | CTA: blanco, texto negro, alto 54, cápsula, 17 px semibold |
| `.btn.btn--secondary(.btn--lg)` | `--surface-2`, texto blanco |
| `.btn.btn--ghost` | solo texto en acento (enlace) |
| `.btn.btn--plain` | solo texto blanco |
| `.btn.btn--danger` | `--surface-2` con texto `--danger` |
| `.btn.btn--accent` | ember sólido (excepcional: récord/en vivo) |
| `.btn-icon` | círculo 44, `--surface-2`, icono blanco |
| `.btn-icon.btn-icon--primary` | círculo blanco con glifo negro (play/pausa) |
| `.btn-icon.btn-icon--glass` | relleno neutro desenfocado (sobre imagen/3D) |

Fila de acciones típica (Hoy): `[btn--primary btn--lg «Empezar»] [btn--secondary btn--lg «Ver clase»] [btn-icon]`.
Los iconos dentro de botones heredan `currentColor` (play negro en el CTA blanco).

### Lista agrupada (Ajustes, «Tus velocidades», detalles)
```html
<h2 class="list-header">Entrenamiento</h2>
<div class="list">
  <a class="list__row" data-href="#/settings/speeds">
    ${listIcon('bolt')}                             <!-- opcional: icono gris, SIN cuadrado -->
    <span class="list__title">Velocidades</span>
    <span class="list__value">8,3 · 10,1 · 11,5</span>
    <span class="list__chev">${icon('chevron-right', 14)}</span>
  </a>
</div>
```
Filas ≥ 50 pt, etiqueta a la izquierda (17 regular), valor a la derecha en gris, chevron terciario, separador fino
sangrado. `listIcon(name, { tone: 'danger' })` solo para una acción destructiva.
Para datos tipo «Trote 8,3 km/h»: fila con `.list__title` + `<span class="list__value"><b class="num">8,3</b><span class="unit">km/h</span></span>`
(un `.zdot` antes del título si el nivel es una zona).

### Métricas (estilo Nike)
`stat({ label, value, unit, size: 'lg' })` → rótulo 13 gris (frase, no mayúsculas), cifra SF Pro Display 700 tabular,
unidad gris al 45 %. La cifra siempre blanca; `stat({ color })` solo tiñe el icono del rótulo (p. ej. corazón).
Rejilla tipográfica: `<div class="stat-grid">${stat(…)}${stat(…)}${stat(…)}</div>` (3 columnas, separadores finos
verticales, cifras de 28 px; `stat--lg` dentro = 34 px) o `.stat-grid.stat-grid--2`. Va dentro de una `.card` o suelta
sobre negro. Nada de mini-tarjetas de color por métrica.

### Chips y filtros
`chip(text, { active, attrs })` → monocromo: sin seleccionar `--surface-2` + texto `--text-2`; seleccionado blanco con
texto negro. El parámetro `color` YA NO tiñe. `chip(text, { color: zoneHex, dot: true })` añade un punto de zona.
Duraciones/opciones excluyentes: `segmented(...)` (pista neutra, pulgar gris).

### Estado / badges
- Completado: `icon('check', 13)` en `--ok` + texto gris («HECHO»). Nada de cápsulas verdes.
- Hoy: texto `--accent` («HOY»).
- `.badge` = ember sólido pequeño (récord, nuevo). `.badge--ok/--warn/--danger/--muted` = `--surface-2` + texto de color.

### Tarjeta de clase `workoutCard(w, { variant })`
- `hero`: rótulo gris de categoría, Title 1, una línea de descripción, meta «20 min · ~3,0 km · 255 kcal» en gris,
  puntos de intensidad blancos, perfil de 64 px, CTA blanco opcional.
- `tile`: miniatura `--surface-1` con «45 min» arriba y el perfil abajo; título 15 semibold, foco gris, meta.
- `row`: miniatura del perfil (56×40) + título + «45 min · Tempo» + estado + chevron.
Ya no existen `.wcard__glow`, `.wcard__bar`, `.wcard__icon`, `.wcard__caticon` ni el chip de categoría teñido.

### Gráficos
- `profileChart(segs, { height, tone })`: barras planas del color de zona, 2 px de separación, radio 2, sin
  degradado. `tone: 'tint'` (zonas al 38 %, para «Plan vs real» con la traza blanca encima), `tone: 'mono'` (gris).
  `progressSec` → lo pendiente al 28 % y cursor blanco de 2 px sin brillo.
- `zoneBar()`: pista de 8 px, tramos con 2 px de separación, leyenda con puntos de 8 px.
- `barChart()`: barras finas (≤ 18 px, radio 3). Sin color propio: destacada en acento, resto gris al 30 %
  (o todas gris claro si ninguna se destaca). Con color propio: las no destacadas al 35 %.
- `lineChart()`: línea de 2 px, relleno plano al 10 % (`area`), punto final sin halo.
- `sparkline()`: solo la línea. `gauge()`: arco sólido de 10 px, mando blanco sin brillo. `ring()`: acento sólido.

### Tira semanal (Hoy/Plan)
Letras del día en `--text-2`, números blancos `.num`, hoy = anillo fino (1,5 px) en `--accent` sin relleno,
hecho = punto blanco de 5 px, previsto = punto gris (`--text-4`) de 5 px. Sin tarjeta resaltada ni colores por categoría.

### Hojas, alertas, toasts
Ya resueltos en el sistema: hoja `#1C1C1E` sin sombra (radio 36, movimiento iOS sin rebote), CTA de hoja blanco,
alerta con botón fuerte blanco y destructivo en texto rojo, action sheet con opciones en blanco, toast de material
oscuro con icono de estado pequeño (sin círculo teñido).

### Estados vacíos
`emptyState({ icon, title, text, action })` → icono gris de 44 px sin contenedor, título Title 3, texto gris.
`'sparkles'` se sustituye automáticamente.

### Iconos
Un único estilo de línea: `icon(name, size)` calcula el trazo óptico (≈ 1,6 px en pantalla a cualquier tamaño) y
**limita** los `stroke` gruesos que pidan las pantallas. Color `--text-2` salvo dentro de botones (heredan). Nunca
dentro de cuadrados/círculos de color. Sin destellos/emoji decorativos.

### Tab bar (iOS 26, Liquid Glass)
Cápsula flotante (`.tabbar__inner`, 62 px; 48 px en horizontal, centrada y con rótulos al lado) separada de los bordes y
sobre el indicador de inicio; el contenido pasa por detrás. Cristal: `rgba(30,30,32,.74)` + `blur(30px) saturate(180%)`,
canto de luz de 0,5 px y una sombra corta (sin halo). Glifos propios con la geometría de SF Symbols en `js/app.js`
(house, calendar, square.grid.2x2, chart.bar, person.crop.circle; trazo 1,6): sin seleccionar = contorno `--text-2`;
seleccionado = variante «.fill» en `--accent` con una lente de cristal (`rgba(255,255,255,.1)`) detrás. Rótulo 10 px.
`view-transition-name` va en la cápsula (en la barra rompería el desenfoque). En pantallas empujadas
(`push: true`) la tab bar se oculta (`body.is-pushed`, `--tabbar-h: 0`). Cambiar de pestaña no lleva háptica.

### Movimiento
Entradas: opacidad + 8 px, 180–320 ms, `--ease-out` (`.fade-in`, `.slide-up`, `.stagger`). Pulsado: escala 0,98 o
opacidad. Sin rebotes, sin `glow-pulse` (neutralizado), sin escalados > 1. Confeti (`celebrate()`) solo para un récord
real: ya es sobrio (blanco/ember/gris, la mitad de piezas).

### HUD de clase
Paneles: `background: var(--material); backdrop-filter: var(--material-filter); box-shadow: inset 0 0 0 var(--hairline) var(--sep)`.
Velocidad en blanco puro (SF Pro Display 700), rótulo de zona en versalitas del color de zona, flecha de siguiente y
controles monocromos (círculos `--fill` desenfocados; play/pausa `.btn-icon--primary`), tira de tramos con los colores
de zona. La legibilidad sobre el 3D manda (no bajar de `--text-2`).

### Resumen
Sin anillo gigante. Héroe: `icon('check')` verde pequeño + «Completado» + fecha/categoría en gris → título `.title1`
→ rejilla tipográfica de métricas (cifras grandes, unidades y rótulos grises, separadores finos) → «Plan vs real» con
`profileChart(segs, { tone: 'tint', trace })` → acciones (`btn--primary` «Guardar», `btn--secondary`).

---

### Fotografía y vídeo de campaña (`assets/media/`)
Una sola dirección de arte (negro, luz de borde ember). Se usa poco y siempre con velo para que el texto blanco se lea:
- `photo(name, { cls, pos, eager })` → `<img>` perezosa con tamaño intrínseco; `categoryPhotoName(cat)` da la foto de cada
  categoría (series/fartlek/retos → `cat-intervals`, resistencia → `cat-endurance`, recuperación → `cat-recovery`,
  tempo/cuestas/test → `cat-tempo`, resto → `hero-man`). `bgVideo(name)` → vídeo mudo en bucle que solo corre mientras se
  ve (IntersectionObserver) y nunca con «Reducir movimiento» (queda el póster); `holdBgVideo(v, true)` lo pausa.
- Dónde: bienvenida (`hero-loop.mp4` a sangre), cabecera de la clase de hoy, destacada y cabeceras de categoría en Clases,
  Apple Watch (`watch-loop.mp4`), estados vacíos de Historial y Progreso (`empty.jpg`) y la tarjeta para compartir.
- Nunca: `treadmill-detail.jpg` ni `detail-loop.mp4` (se están regenerando). Nada de `assets/media` entra en el precache:
  el service worker lo guarda al verlo (`br-media`, vídeos con rangos 206).
- `profileChart(segs, { tone: 'soft' })` para miniaturas de listas (gris y solo lo intenso en color); color completo solo
  en Hoy, el detalle y Preparación. Bajo un perfil monocromo con traza real, `zoneRibbon(segs)`.

### Escenario 3D de cada clase
`js/player/scene-pick.js` (puro, con `tools/test-scene-pick.mjs`): `visuals.theme = 'auto'` por defecto (cuestas →
Cordillera, series/fartlek/tempo/test/retos → Estadio, resistencia → Aurora, recuperación → Grafito). Preparación ofrece
«Automático» + los cuatro mundos en miniatura (elegido = anillo blanco de 2 px) solo para esa clase; Perfil › Pantalla de
entreno tiene «Automático» como primera opción. `themeRev 3`: todos pasan una vez a «Automático» (también un mundo
elegido a mano antes); después se respeta cualquier elección nueva.

## 3 · Patrones prohibidos → sustituto

| v1 (quitar) | v2 (usar) |
|---|---|
| `background: var(--accent-grad)` / `linear-gradient(...)` / `radial-gradient(...)` en tarjetas, botones, iconos | `--surface-1` (tarjeta), `--cta-bg` (CTA), `--accent` sólido (progreso/activo) |
| `box-shadow: var(--accent-glow)` / `var(--shadow-1/2)` / `drop-shadow(...)` / `0 0 Npx color` | nada |
| `color-mix(in srgb, var(--cc) N%, …)` como fondo o borde (tintes de categoría) | `--surface-1`/`--surface-2` sin borde |
| `border: 1px solid color-mix(… var(--cc) …)` / bordes de color | sin borde |
| barra lateral de color (`__bar` con `background: var(--cc)`) | nada, o un `.zdot` si es una zona |
| icono en cuadrado de color (`sqIcon`, `.list__icon` con `style="background:…"`, `__icon` con fondo) | `listIcon(name)` (gris, sin fondo) |
| chips de categoría de colores (`chip(…, { color })`, `.chip--tinted`) | `chip()` monocromo; seleccionado blanco/negro |
| texto degradado (`background-clip: text` + `--accent-grad`) | blanco sólido (o `--accent` sólido en «Running») |
| `.btn--primary` naranja con brillo | `.btn--primary` (ya es blanco/negro) |
| anillos/arcos degradados (`ring({ color: 'ember' })`) | `ring({ color: 'var(--accent)' })` |
| `font-weight: 800` / `750` | 700 (títulos, cifras) o 600 (headline, botones) |
| títulos de sección de 22 px 800 dentro de cada bloque | `sectionHeader()` (13 px gris, fuera de la tarjeta) |
| `var(--c-<categoría>)` / `--cc` para pintar algo | `.eyebrow` gris con `categoryName(key)` |
| animaciones con rebote (`--ease-spring` con overshoot, `pop-in` 1.03, `tab-pop`, `pulse` con escala, `st-pulse`, `pg-glow`, `hs-beat`) | `.fade-in` / `.slide-up` / opacidad |
| barras verdes «por defecto» en gráficos | `barChart()` gris + acento en la destacada |
| emoji / `sparkles` decorativos | nada |

Comprobación rápida en cada CSS de pantalla:
`grep -nE "accent-grad|accent-glow|shadow-[12]|gradient\(|drop-shadow|color-mix\(in srgb, var\(--cc|font-weight: ?8|var\(--c-" css/<archivo>.css`
debe quedar vacío (salvo gradientes dentro de la escena 3D, que no se tocan).

---

## 4 · Estado al cerrar la fundación (qué queda en cada archivo de pantalla)

Ya resuelto por el sistema (sin tocar pantallas): fondo negro sin brillo, tab bar, barra compacta, tarjetas `.card`,
listas e iconos de lista (aunque lleven `style="background:…"`), botones (CTA blanco), chips monocromos, segmentado,
stepper, interruptor, hojas, alertas, action sheets, toasts, estados vacíos, `workoutCard`, todos los gráficos, cifras
en SF Pro Display, y los tokens heredados (`--accent-grad`, `--accent-glow`, `--shadow-*`, `--c-*`) ya pintan plano/gris.

Lo que sigue en CSS/JS de pantalla (líneas que casan con el grep de §3 al cerrar):
`screens-main.css` ≈ 105 · `screens-more.css` ≈ 107 · `player.css` ≈ 40 · `music.css` ≈ 36.

Visto en capturas con los datos reales:
- **Hoy (`td-`)**: avatar naranja con brillo arriba a la derecha → `btn-icon`/`navbar__btn` gris; tarjeta de hoy con
  borde y línea superior de color + caja oscura alrededor del perfil → `.card` sin borde, perfil directo (sin caja);
  tira semanal en tarjeta con «hoy» relleno → receta «Tira semanal»; «Semana 2 de 52…» con bandera naranja → texto
  `.subhead.muted` o fila de lista; «Tus velocidades» en tarjetas → lista agrupada.
- **Clases (`lb-`)**: tarjeta «Retos» con borde y cuadrado de icono → fila `.card` con icono gris sin cuadrado y la
  cifra «12» en blanco; cabeceras de sección con icono de categoría (`lb-section__icon`) → `sectionHeader()`.
- **Progreso (`pg-`)**: tarjetas KPI con degradados de color y cuadrados de icono → `.stat-grid` en una `.card`;
  «Esta semana» con fondo naranja → `.card` + `ring()` acento; «Tus velocidades» con bordes de zona → lista con `.zdot`;
  «El coach dice» con cuadrado naranja y `sparkles` → `.card` con `.eyebrow`; `pg-pill` verde → texto `--text-2`.
- **Perfil (`st-`)**: avatar con anillo degradado y brillo → círculo `--surface-2` de 88 px con inicial/icono blanco;
  fila de 3 métricas → `.stat-grid`; `sqIcon()` → `listIcon()`; color `linear-gradient` de «Pantalla de entreno» → nada;
  `13,0` naranja gigante en Velocidades → blanco (`.display-num`) con unidad gris; barras de zona laterales → `.zdot`.
- **Preparación / HUD / Resumen (`pl-`, `sm-`, `hud-`)**: brillo naranja bajo «Empezar», toggle de música naranja con
  icono en cuadrado degradado, `ring({ color: 'ember' })` gigante del resumen (`summary.js:194`) → receta «Resumen».
- **Iconos `sparkles` decorativos**: `today.js:156,340`, `progress.js:276`, `summary.js:773`, `onboarding.js:333`,
  `settings.js:50,666,1131,1170,1369` → quitar o usar un icono con significado.
- **`chip(…, { color })`** en `history.js:437` y `workout.js:71` → sin `color` (ya no tiñe, pero sobra).

Capturas: `tools/capture` comparte un único Chrome. La app tiene service worker con caché «cache-first»: para ver los
cambios hay que abrir siempre con `?nosw=1` (el `cap.sh` del scratchpad ya lo hace).
