# Descargas del 28-nov-2026: música para las AMRAP y efectos entre bloques

Sale de la lista `candidatas-2026-11-28.md`. **Todavía no está en la app**: no se ha tocado `audio/music/`, `library.json` ni nada de `js/`.

- Música: `audio/music-src/2026-11-28/` (10 pistas). Esa carpeta ya estaba excluida en `.gitignore`.
- Efectos: `audio/sfx-src/2026-11-28/` (12 efectos). **`audio/sfx-src/` se ha añadido a `.gitignore`**, así que no va al repositorio público.
- Licencia: se volvió a comprobar en cada ficha justo antes de bajarla. Las 22 dicen «Pixabay Content License», `isAiGenerated: false` y `hasYoutubeContentId: false`. Ninguna ha cambiado respecto a la lista.
- Sin iniciar sesión, sin CAPTCHA, sin pagar nada. Se bajaron de una en una, con unos segundos entre cada una.

## Cómo se ha medido (sin escuchar)

- **Archivo:** con `ffprobe` y decodificándolo entero con `ffmpeg`, sin errores en ninguno. Todos son MP3 y **la duración coincide con la de la ficha** al milisegundo.
- **Voz:** con `whisper-cli` (modelo `small`, el mismo que se usa para la voz Lucía), canción por canción. En 8 de las 10 solo sale «(upbeat music)». En *Encroachment* y *Hyperdrive*, con detección de idioma automática, whisper repitió **la misma frase en rumano durante toda la pista** (una sobre «material de vídeo» y otra que parece un nombre de artista). Es una alucinación típica de whisper con música sin voz. Al repetirlas forzando inglés, las dos dan solo «(upbeat music)». Por eso ninguna queda como «posible voz». Aun así, whisper no detecta bien los *vocal chops* cortos, así que lo de «sin voz» se confirma escuchando.
- **BPM y energía:** con la función `analyze()` de `tools/music/analyze.py`, la misma que usa la biblioteca, llamada desde un script aparte para no escribir `library.json`. La **energía media** (0–1) es relativa a la propia pista, porque se normaliza a su percentil 95. **% alto** es la parte de compases con energía ≥ 0,8. **LUFS** es la sonoridad real del MP3 antes de normalizar: cuanto más cerca de 0, más fuerte.
  Los BPM marcados con ⚠ hay que revisarlos al integrar. El detector a veces cae en la mitad o en otro múltiplo del tempo, y para eso existe `FORCE_BPM` en `analyze.py`.

## Música (10)

| Archivo | Título original | Autor | Ficha | Duración | Tamaño | BPM | Energía media · % alto · LUFS | ¿Posible voz? | Momento de la clase |
|---|---|---|---|---|---|---|---|---|---|
| `hyperdrive-mode-x.mp3` | Mode X & Dopetronic – Hyperdrive (Original Mix) | MODE_X | [322471](https://pixabay.com/music/techno-trance-mode-x-amp-dopetronic-hyperdrive-original-mix-322471/) | 6:22 | 12,2 MB | 126 | 0,79 · 59 % · −7,4 | No | Rondas AMRAP y final. Entra fuerte desde el principio (mixIn 0,4 s) |
| `dirty-industrial-rave-natureseye.mp3` | Dirty Industrial Rave | NaturesEye | [177919](https://pixabay.com/music/upbeat-dirty-industrial-rave-177919/) | 3:20 | 6,4 MB | 120 ⚠ | 0,78 · 81 % · −9,8 | No | Final a tope: es la más sostenida (81 % de compases altos) |
| `aggressive-techno-freemusicforvideo.mp3` | Aggressive Techno | FreeMusicForVideo | [409194](https://pixabay.com/music/techno-trance-aggressive-techno-409194/) | 3:47 | 7,3 MB | 150 ⚠ | 0,74 · 49 % · −11,6 | No | Rondas |
| `hard-trance-track-klavo85.mp3` | HARD TRANCE TRACK BY KRIS KLAVENES | klavo85 | [160024](https://pixabay.com/music/techno-trance-hard-trance-track-by-kris-klavenes-160024/) | 3:39 | 7,0 MB | 127 ⚠ | 0,77 · 69 % · −18,6 | No | Última ronda o final. Es muy flojo de volumen y habrá que normalizarlo |
| `big-trance-klavo85.mp3` | big trance by kris klavenes | klavo85 | [161372](https://pixabay.com/music/techno-trance-big-trance-by-kris-klavenes-161372/) | 4:21 | 8,4 MB | 139,77 | 0,50 · 9 % · −14,7 | No | Rondas que empiezan con subida: tiene 7 drops detectados, la que más |
| `distance-mrplastic.mp3` | MrPlastic – Distance | mrplastic | [11023](https://pixabay.com/music/techno-trance-mrplastic-distance-11023/) | 5:07 | 9,8 MB | 118 | 0,69 · 27 % · −16,5 | No | Calentamiento o recuperación (la más tranquila) |
| `iron-galaxy-mgyk.mp3` | MG – Iron Galaxy (Cut Version) | MGYK | [222479](https://pixabay.com/music/techno-trance-mg-iron-galaxy-cut-version-222479/) | 5:39 | 10,8 MB | 119 ⚠ | 0,72 · 54 % · −6,7 | No | Entrada a la AMRAP. Tarda en arrancar (mixIn 65 s) |
| `encroachment-trance-jci21.mp3` | Encroachment – Trance | JCI21 | [216242](https://pixabay.com/music/techno-trance-encroachment-trance-216242/) | 5:28 | 10,5 MB | 128 | 0,77 · 58 % · −7,1 | No (whisper alucinó en rumano, ver arriba) | Varias rondas seguidas |
| `hypnotic-djdoblina.mp3` | Hypnotic | DJDoblina | [374108](https://pixabay.com/music/techno-trance-hypnotic-374108/) | 5:18 | 10,2 MB | 136 | 0,71 · 52 % · −7,3 | No | Rondas |
| `seeping-acid-techno-midnighteve.mp3` | Seeping Acid Techno 9 Minute Mix | midnighteve | [149295](https://pixabay.com/music/techno-trance-seeping-acid-techno-9-minute-mix-149295/) | 9:29 | 18,2 MB | 130 | 0,70 · 33 % · −12,8 | No | AMRAP larga (10–12 min) sin cambiar de pista. Entra a los 45 s |

Notas de BPM:
- **Hard Trance Track (127):** parece bajo para un hard trance, que suele ir a 138–150. Puede que el detector haya cogido otro múltiplo.
- **Dirty Industrial Rave (120) e Iron Galaxy (119):** tempo de house para pistas «industrial» y «épica». Puede estar bien, pero conviene compararlo con el peine por bandas de `analyze.py`.
- **Aggressive Techno (150):** es posible en hard techno, pero es el más alto de la tanda. Si el bombo real va a 125, el detector habrá contado de más; hay que comprobarlo antes de asignarle el tramo «sprint».

## Efectos (12)

Los 12 primeros de la lista, quitando *Short crowd cheer* (n.º 12) y poniendo en su lugar *weights dropped* (n.º 13), porque entre los 12 primeros no había ningún choque de discos. Así queda al menos uno de cada tipo pedido.

| Archivo | Tipo | Título original | Autor | Ficha | Duración | Tamaño | Pico / media (dB) | Momento de la clase y notas |
|---|---|---|---|---|---|---|---|---|
| `campana-boxing-bell-1-lazychillzone.mp3` | Campana de ronda | Boxing Bell 1 | LazyChillZone | [232450](https://pixabay.com/sound-effects/film-special-effects-boxing-bell-1-232450/) | 5,07 s | 162 kB | −0,2 / −16,5 | Empieza o acaba la ronda. Cola larga: recortar |
| `campana-doble-cartoon-music.mp3` | Campana de ronda | Boxing bell hit (Double) | cartoon_music | [489811](https://pixabay.com/sound-effects/technology-boxing-bell-hit-double-489811/) | 2,95 s | 94 kB | −6,3 / −25,9 | «Ding-ding» de fin de ronda. El sonido acaba a los 2,2 s |
| `impacto-sub-bass-boom-djartmusic.mp3` | Golpe grave | Sub Bass Boom 1 | DJARTMUSIC | [302682](https://pixabay.com/sound-effects/musical-sub-bass-boom-1-302682/) | 3,76 s | 120 kB | −0,2 / −9,8 | Arranque de ronda, con el drop |
| `impacto-cinematic-boom-universfield.mp3` | Golpe grave | Cinematic Impact Boom 05 | Universfield | [352465](https://pixabay.com/sound-effects/film-special-effects-cinematic-impact-boom-05-352465/) | 2,09 s | 67 kB | −5,1 / −17,8 | Golpe seco al empezar la ronda |
| `riser-hit-audiopapkin.mp3` | Riser corto | Riser Hit sfx 001 | AudioPapkin | [289802](https://pixabay.com/sound-effects/film-special-effects-riser-hit-sfx-001-289802/) | 4,49 s | 144 kB | 0,0 / −16,5 | Últimos segundos de la recuperación: sube y golpea. Llega a 0 dB, habrá que bajarlo |
| `riser-platillo-invertido-fronbondi-skegs.mp3` | Riser corto | SFX – Reversed Ride Cymbal Riser Sound Effect | Fronbondi_Skegs | [359400](https://pixabay.com/sound-effects/film-special-effects-sfx-reversed-ride-cymbal-riser-sound-effect-359400/) | 4,73 s | 151 kB | −0,1 / −32,3 | Subida antes de la ronda. Empieza con 0,7 s de silencio |
| `buzzer-sportif-freesound.mp3` | Bocina / buzzer | buzzer sportif | freesound_community | [96766](https://pixabay.com/sound-effects/film-special-effects-buzzer-sportif-96766/) | 3,41 s | 68 kB | −10,1 / −26,1 | Fin de tiempo. Es el más flojo y de menor calidad (24 kHz, 160 kbps) |
| `bocina-air-horn-waitwhatimsignedin.mp3` | Bocina / buzzer | Air Horn | Waitwhatimsignedin | [273892](https://pixabay.com/sound-effects/film-special-effects-air-horn-273892/) | 1,85 s | 59 kB | −2,3 / −14,8 | Final de la AMRAP (bocina de DJ) |
| `cuenta-atras-race-start-transcendedlifting.mp3` | Cuenta atrás de pitidos | Race Start Beeps | transcendedlifting | [125125](https://pixabay.com/sound-effects/film-special-effects-race-start-beeps-125125/) | 4,05 s | 130 kB | −1,9 / −7,0 | Antes de cada ronda: 4 pitidos, uno por segundo (0, 1, 2 y 3 s) |
| `cuenta-atras-pitidos-cortos-freesound.mp3` | Cuenta atrás de pitidos | Short beep countdown | freesound_community | [81121](https://pixabay.com/sound-effects/film-special-effects-short-beep-countdown-81121/) | 3,53 s | 113 kB | −8,4 / −13,9 | Otra cuenta atrás, también con 4 pitidos a 1 s |
| `publico-crowd-cheer-dragon-studio.mp3` | Ánimo de público | Crowd Cheer | DRAGON-STUDIO | [406646](https://pixabay.com/sound-effects/people-crowd-cheer-406646/) | 4,44 s | 142 kB | 0,0 / −12,9 | Ronda cerrada o récord. Llega a 0 dB |
| `discos-weights-dropped-freesound.mp3` | Choque de discos | weights dropped | freesound_community | [87978](https://pixabay.com/sound-effects/film-special-effects-weights-dropped-87978/) | 1,66 s | 33 kB | −8,9 / −33,9 | Fin de ronda, «suelta la barra». Solo suena de 0,13 a 0,56 s y es de baja calidad (24 kHz) |

Están todos los tipos: campana (2), bocina/buzzer (2), golpe grave (2), riser (2), cuenta atrás (2), público (1) y discos (1).
Quedan sin bajar *Short crowd cheer* (n.º 12) y del n.º 14 al 16 (*Plate load*, *Mega Bass Sub Drop* y *Claps*).


## Estado (28-nov-2026, tarde): integradas en local (sin publicar)

**Música: entran las 10.** Copiadas a `audio/music-src/nuevas/`, añadidas a su `manifest.json` (tanda `amrap-2026-11-28`) y
procesadas con `nice -n 10 python3 tools/music/analyze.py --new`, como las anteriores: −14 LUFS (también *Hard Trance*,
que venía a −18,6, y *Distance*, a −16,5: las dos salen a −14,0/−14,1), m4a AAC 160 kbps y su análisis en `library.json`.
Biblioteca: 93 pistas, +66 MB (465,9 MB en total; se descargan al usarlas, como siempre).

BPM revisado con el peine por bandas (bombo 30–150 Hz, agudos 5–11 kHz) y la autocorrelación del bombo: los cuatro dudosos
**se quedan como los midió el detector, sin `FORCE_BPM`**. *Hard Trance* (127): ni 138–150 ni sus múltiplos tienen periodicidad
(0,03 frente a 0,21 en el bombo). *Dirty Industrial Rave* (120) e *Iron Galaxy* (119): 4/3 (160/159) puntúa la mitad. *Aggressive
Techno* (150): 150 y 75 empatan (mismo pulso) y la autocorrelación del bombo da 148–152; queda en **sprint** (sprint nativo
148–190), así que en las AMRAP rápidas no sale.

| Pista | id | BPM | Tramo medido (elegida para) | mixIn | Drops (s) | Primera zona caliente (entrada en tramos intensos) | m4a |
|---|---|---|---|---|---|---|---|
| Hyperdrive (Original Mix) | `hyperdrive-original-mix-mode-x` | 126 | correr (elegida para rápido) | 1.7 s | 244 | 43.6 s | 8.1 MB |
| Dirty Industrial Rave | `dirty-industrial-rave-natureseye` | 120 | trote (elegida para correr) | 16.2 s | 16, 160 | 16.2 s | 4.2 MB |
| Aggressive Techno | `aggressive-techno-freemusicforvideo` | 150 | sprint (elegida para sprint) | 13.6 s | 121 | 74.4 s | 4.6 MB |
| Hard Trance Track | `hard-trance-track-klavo85` | 127 | correr (elegida para rápido) | 1.6 s | 60, 151 | 1.6 s | 4.6 MB |
| Big Trance | `big-trance-klavo85` | 139.77 | rápido (elegida para rápido) | 14.4 s | 25, 52, 93 … | 24.7 s | 5.5 MB |
| Distance | `distance-mrplastic` | 118 | trote (elegida para trote) | 8.1 s | 79 | 8.1 s | 6.3 MB |
| Iron Galaxy (Cut Version) | `iron-galaxy-cut-version-mgyk` | 119 | trote (elegida para correr) | 65.5 s | 74 | 73.5 s | 7.2 MB |
| Encroachment (Trance) | `encroachment-trance-jci21` | 128 | correr (elegida para rápido) | 9.4 s | — | 30.0 s | 7.0 MB |
| Hypnotic | `hypnotic-djdoblina` | 136 | rápido (elegida para rápido) | 0.8 s | 123 | 2.5 s | 6.5 MB |
| Seeping Acid Techno (9 Minute Mix) | `seeping-acid-techno-9-minute-mix-midnighteve` | 130 | correr (elegida para rápido) | 16.4 s | — | 29.3 s | 12.0 MB |

Puntos de entrada: los pone el análisis. *Iron Galaxy* entra para mezclar a los 65,5 s (antes es su intro, con energía 0,4) y en
un tramo intenso por su drop de 73,5 s. *Seeping Acid* entra para mezclar a los 16,4 s, y en un tramo intenso por su primera
zona caliente (29,3 s). Créditos en el README.

**Efectos: 3 de 12**, recortados y normalizados (pico −3 dBFS) en `audio/sfx/` (m4a mono 128 kbps, 98 kB en total):
- `campana.m4a` (1,3 s) de *Boxing bell hit (Double)*: el «ding-ding» acaba justo al empezar cada bloque AMRAP.
- `golpe.m4a` (1,6 s) de *Cinematic Impact Boom 05*: al abrirse cada ronda, en el «¡Tiempo!» y en el drop de los riser-drop. Se
  prefirió al *Sub Bass Boom* porque este tiene el 96 % de su energía por debajo de 60 Hz: no se oye en el móvil y aprieta al
  limitador.
- `riser.m4a` (3,2 s) de *Reversed Ride Cymbal Riser*: el platillo invertido culmina en el cambio.
- Fuera: *buzzer sportif* y *weights dropped* (baja calidad, 24 kHz). También la *air horn*, que tiene el 58 % de su energía
  entre 0,5 y 2 kHz y taparía el «¡Tiempo!» de Lucía. Fuera también las cuentas atrás, porque ya hay pitidos 3-2-1, y el
  público, porque iría encima de la voz. *Boxing Bell 1* son 3 s de repiques seguidos y *Riser Hit* lleva su propio golpe.
