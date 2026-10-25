<p align="center"><img src="assets/icons/icon-512.png" width="120" alt="RITMUP"></p>

# RITMUP

**Tu cinta, a otro ritmo.** Clases guiadas para correr en cualquier cinta, la de tu gimnasio o la de casa, con coach
de voz, música que cambia contigo, mundos 3D, tu Apple Watch y la IA de tu iPhone.

- **Web (PWA):** https://visualelectric77-cyber.github.io/bestrunning/
- **App de iPhone y Apple Watch:** en revisión en la App Store (muy pronto).

> El repositorio y la dirección conservan el nombre antiguo del proyecto («bestrunning») a propósito: la app nativa
> carga esta web desde esa dirección.

## Qué hace

- **Una coach que te guía**: Lucía te habla durante toda la clase y te avisa 10 segundos antes de cada cambio, con
  cuenta atrás 3-2-1. **Tú marcas la velocidad**: RITMUP no se conecta a la cinta, así que funciona con cualquiera.
- **Más de 100 clases**: intervalos, tempo, cuestas, fartlek, recuperación, retos y un test para calcular tus
  velocidades.
- **Música DJ**: electrónica elegida por ritmo para cada tramo y mezclada a compás en cada cambio. También con tu
  Spotify, Apple Music o un vídeo de YouTube (beta).
- **Mundos 3D** (Aurora, Cordillera, Estadio) que corren a la velocidad de tu cinta, y tu récord corriendo contigo.
- **Apple Watch**: pulso en directo, modo por pulso (si se dispara, te baja el ritmo) y la clase en la muñeca.
- **IA en tu iPhone, sin nube** (Apple Intelligence): cómo llegas hoy, consejo antes de empezar, resumen de la clase e
  informe semanal.
- **Un plan hasta tu carrera**: semana a semana hasta tu 5K, 10K o media maratón.
- **Todo conectado**: Isla Dinámica, pantalla de bloqueo, widget, Siri y Apple Salud.
- **Tus datos son tuyos**: sin cuentas, sin anuncios, sin rastreo. Todo se guarda en el iPhone
  ([privacidad](https://visualelectric77-cyber.github.io/bestrunning/legal/privacidad.html)).

## Cómo está hecha

RITMUP la ha dirigido **Nacho Garcia** (año y medio haciendo vibecoding, sin escribir código a mano) y todo el
código, el diseño y las pruebas los ha escrito **[Claude Code](https://claude.com/claude-code) con Claude Opus 5.5**.
Del primer prototipo a enviarla a la App Store: 7 días, 39 versiones de la web y 14 builds de la app nativa.

Son dos piezas:

| Pieza | Qué es | Dónde |
|---|---|---|
| **Web (PWA)** | Toda la experiencia de clase: coach, motor DJ, mundos 3D (three.js), plan, progreso. HTML, CSS y JavaScript sin dependencias ni compilación; funciona sin conexión. | Este repositorio |
| **App nativa** | Swift / SwiftUI para iPhone y Apple Watch: carga esta web y añade HealthKit, el pulso del reloj en directo, Live Activities (Isla Dinámica), widgets, Siri y la IA del iPhone (Foundation Models). | Repositorio privado |

Hay pruebas automáticas para el motor de la clase, el audio, la música, el plan, el pulso y la IA
(`tools/test-*.mjs`, millones de comprobaciones).

*RITMUP no está afiliada a Anthropic ni a Apple. No es un dispositivo médico.*

## Desarrollo

### Probarla en el ordenador

No hace falta instalar nada más que [Node.js](https://nodejs.org) (versión 18 o superior):

```bash
cd /ruta/a/BESTRUNING
node tools/serve.mjs            # http://127.0.0.1:8095
```

Abre `http://127.0.0.1:8095/?nosw=1` en Chrome o Safari. `?nosw=1` desactiva el service worker para ver
siempre los archivos recién editados. Usa este servidor y no `python3 -m http.server`: admite peticiones por
rangos (como GitHub Pages).

Para probarla en el iPhone desde el Mac (misma wifi): `node tools/serve.mjs 8095 --host 0.0.0.0` y abre
`http://<ip-del-mac>:8095/?nosw=1`. Ojo: por `http` el iPhone no mantiene la pantalla encendida (al bloquearse
congela la app y la música se queda repitiendo frase o se corta), ni hay modo offline ni instalación: para
entrenar de verdad usa la versión publicada en GitHub Pages (`https`) o sirve en local con certificado
(`mkcert -install && mkcert <ip-del-mac>`, luego `node tools/serve.mjs 8095 --host 0.0.0.0 --https <ip>.pem <ip>-key.pem`)
y, por si acaso, pon el bloqueo automático en «Nunca». Añade `?debug=music` a la dirección para ver el panel
del motor de música (estado del audio, memoria, fallos) y hacer una captura si algo suena mal.

Laboratorio 3D (ver los escenarios sin entrenar, capturas y vídeos): `node tools/snap-server.mjs` y abre
`http://127.0.0.1:8096/tools/scene-lab.html`.

Motor DJ sin iPhone: con el mismo servidor, `http://127.0.0.1:8096/tools/music-offline.html` renderiza en un
OfflineAudioContext una Pirámide 20′ (a 48 kHz, como el iPhone), unos Bloques de resistencia 45′ y casos difíciles
(red lenta, decodificación lenta, JS dormido, reloj parado) con el plan y el motor reales y mide huecos, clics, baches
relativos y sonoridad (informe y WAV de 3 cambios en `docs/audio-tests/`; `transiciones.mp3` para escucharlos).

### Antes de publicar (cada vez que cambies algo)

```bash
node tools/check-imports.mjs                     # todos los imports existen
for f in tools/test-*.mjs; do node "$f" | tail -1; done   # todas las pruebas en verde
node tools/precache.mjs --bump patch             # nueva versión y lista offline actualizada
```

`--bump patch` sube 1.1.0 → 1.1.1; `--bump minor` sube a 1.2.0; sin `--bump` solo regenera la lista. **No te
saltes el precache**: si no, los iPhone que ya tengan la app instalada seguirán con la versión anterior. Al abrir la
app aparecerá «Nueva versión disponible · Toca para actualizar» (nunca a mitad de un entrenamiento).


## Música DJ

- **Desde el iPhone**: Perfil → Música → **Importar canciones** (desde Archivos). La app analiza en el propio
  teléfono el BPM, los compases y los *drops* y la añade a la mezcla.
- **Para la biblioteca incluida en la app** (en el Mac): copia los audios a `audio/music-src/` con sus datos en
  `audio/music-src/picks.tsv` y ejecuta `python3 tools/music/analyze.py` (necesita `ffmpeg` y `numpy`):
  normaliza a −14 LUFS, codifica AAC, mide BPM/compases/drops y reescribe `audio/music/library.json`. Después,
  `node tools/precache.mjs --bump patch`. Usa solo música con licencia para ello.
- **Añadir pistas sin rehacer las que ya hay**: deja los audios en `audio/music-src/nuevas/` con su
  `manifest.json` (`[{ file, title, artist, url, tier, stated_bpm }]`) y ejecuta
  `nice -n 10 python3 tools/music/analyze.py --new` (`--only=id1,id2` rehace solo esas). Las pistas de
  `library.json` se conservan tal cual. Si una pista sale a doble o mitad de tempo, o con la rejilla a contratiempo,
  se corrige en `FORCE_BPM`, `TIER_OVERRIDE` o `HALF_BEAT_SHIFT` (al principio de `analyze.py`).
- **Variedad**: la app no repite las pistas de tus últimas 5 sesiones mientras haya otras del mismo tramo.

### Créditos de la música

Todas las pistas incluidas son de [Pixabay](https://pixabay.com/music/) bajo la
[Pixabay Content License](https://pixabay.com/service/license-summary/) (uso gratuito sin atribución obligatoria; la damos
igualmente). La misma lista, con enlace a cada ficha, sale en la app en **Perfil → Música → Créditos de la música**
(se genera desde `audio/music/library.json`). Las 35 añadidas el 18-oct-2026 no están registradas en Content ID.
Agrupadas por tramo según su BPM medido:

- **Calma** (8): [Midnight Synthwave](https://pixabay.com/music/synthwave-midnight-synthwave-317752/) — The_Mountain · [Stylish Deep Electronic](https://pixabay.com/music/future-bass-stylish-deep-electronic-262632/) — NverAvetyanMusic · [AMALGAM](https://pixabay.com/music/future-bass-amalgam-217007/) — Rockot · [High-End Hustle – Fashion Luxury Disco](https://pixabay.com/music/upbeat-high-end-hustle-fashion-luxury-disco-253184/) — Rockot · [Synthwave Retro 80s](https://pixabay.com/music/synthwave-synthwave-retro-80s-569468/) — ARPMedia · [191021 – Japan Electronica](https://pixabay.com/music/upbeat-191021-japan-electronica-155533/) — WELC0MEИ0 · [Lo-Fi Disco](https://pixabay.com/music/disco-lo-fi-disco-569618/) — -SunSet- · [Deep House Lounge Music](https://pixabay.com/music/soft-house-deep-house-lounge-music-349539/) — Tunetank
- **Trote** (20): [Crystalline Descent](https://pixabay.com/music/soft-house-crystalline-descent-486700/) — VifotoFreeSounds · [241029 – Techno / Dark / Minimal](https://pixabay.com/music/upbeat-241029-techno-dark-minimal-experimental-game-anime-video-284019/) — WELC0MEИ0 · [Afro House](https://pixabay.com/music/afrobeat-afro-house-455843/) — ArtIssizm · [Deep House Beat](https://pixabay.com/music/deep-house-deep-house-beat-117022/) — deep_house_music · [L'Essence de la Nuit (Luxury Deep House Orchestral Fusion)](https://pixabay.com/music/upbeat-lx27essence-de-la-nuit-luxury-classy-deep-house-orchestral-fusion-367308/) — MeditativeTiger · [Neurobeat](https://pixabay.com/music/upbeat-neurobeat-147786/) — SoundReality · [Feelings (122 BPM) House Instrumental](https://pixabay.com/music/upbeat-feelings-122-bpm-house-instrumental-237389/) — ThisIsBeatKitchen · [Funky Summer House](https://pixabay.com/music/funk-funky-summer-house-565437/) — BerryDeep · [Mystic Deep Dub Techno – Veiled](https://pixabay.com/music/techno-trance-mystic-deep-dub-techno-veiled-no-copyright-music-144828/) — Saturn-3-Music · [Inception Inspired Dark Melodic Techno – Night Trains](https://pixabay.com/music/techno-trance-inception-inspired-dark-melodic-techno-mix-night-trains-155050/) — Saturn-3-Music · [Return Journey (Progressive House)](https://pixabay.com/music/dance-modern-progressive-house-type-beat-return-journey-228193/) — 14584889 · [Techno](https://pixabay.com/music/techno-trance-techno-525024/) — prettyjohn1 · [Deep House](https://pixabay.com/music/deep-house-deep-house-112301/) — PaulYudin · [House Breakbeat](https://pixabay.com/music/house-house-breakbeat-117018/) — deep_house_music · [Melodic Techno #03 (Extended)](https://pixabay.com/music/techno-trance-melodic-techno-03-extended-version-moogify-9867/) — tAUREON · [Techsonik – Chest Hair](https://pixabay.com/music/soft-house-techsonik-chest-hair-470825/) — Kromaspere · [Tropical Deep House](https://pixabay.com/music/deep-house-tropical-deep-house-117020/) — deep_house_music · [Deep House Instrumental](https://pixabay.com/music/upbeat-deep-house-instrumental-354596/) — arnaud136 · [Pulse Check 128 (German Techno Fusion)](https://pixabay.com/music/funk-pulse-check-128-german-techno-fusion-446794/) — DjFunkyPharmacist · [State of Trance](https://pixabay.com/music/techno-trance-mc-quattro-state-of-trance-164560/) — MC_QUATTRO
- **Correr** (9): [BeatKitchen – Lets fly (126 BPM)](https://pixabay.com/music/house-beatkitchen-lets-fly-126-bpm-372671/) — ThisIsBeatKitchen · [Midnight Drift](https://pixabay.com/music/techno-trance-midnight-drift-575776/) — PWLPL · [Modern Deep House](https://pixabay.com/music/deep-house-modern-deep-house-602927/) — ArtIssizm · [Instrumental Rave Music 2](https://pixabay.com/music/techno-trance-instrumental-rave-music-2-199103/) — hasenchat · [Better Machine (Future House)](https://pixabay.com/music/upbeat-better-machine-future-house-128bpm-141511/) — CONATHOR · [Big Room](https://pixabay.com/music/electronic-big-room-119274/) — Dubdown · [Lost in Time (128 BPM) Emotional Trance](https://pixabay.com/music/techno-trance-lost-in-time-128-bpm-emotional-trance-instrumental-237441/) — ThisIsBeatKitchen · [Rizzlas – Melodic Symbiose](https://pixabay.com/music/upbeat-rizzlas-melodic-symbiose-224650/) — Rizzlas · [EURODANCE / HYPERPOP type Beat 132 BPM](https://pixabay.com/music/techno-trance-eurodance-hyperpop-type-beat-132-bpm-prod-wizz-10864/) — van_Wiese
- **Rápido** (6): [Franic (acid trance)](https://pixabay.com/music/techno-trance-franic-acid-trance-395688/) — Placidplace · [Uplifting Trance](https://pixabay.com/music/dance-uplifting-trance-472317/) — Eliveta · [Mantra Psytrance](https://pixabay.com/music/upbeat-mantra-psytrance-366953/) — Lone_Wolf_Productions · [Trance](https://pixabay.com/music/techno-trance-trance-by-kris-klavenes-160629/) — klavo85 · [EURODANCE / HYPERPOP type Beat 140 BPM](https://pixabay.com/music/techno-trance-eurodance-hyperpop-type-beat-140-bpm-prod-wizz-10865/) — van_Wiese · [Pure Trance](https://pixabay.com/music/electro-pure-trance-459528/) — DJDoblina
- **Sprint** (12): [BHAIRAV (Psytrance)](https://pixabay.com/music/techno-trance-bhairav-166323/) — BUZZPSY · [Dancing in Goa](https://pixabay.com/music/techno-trance-dancing-in-goa-236476/) — TwoWingbeats · [Hard core Techno](https://pixabay.com/music/techno-trance-hard-core-techno-380591/) — DJDoblina · [Modern Drum And Bass](https://pixabay.com/music/drum-n-bass-modern-drum-and-bass-592435/) — BerryDeep · [Hard Aggressive Techno](https://pixabay.com/music/techno-trance-hard-aggressive-techno-421103/) — DELOSound · [Rapid Drum and Bass](https://pixabay.com/music/drum-n-bass-rapid-drum-and-bass-full-369486/) — catch22music · [Drum & Bass](https://pixabay.com/music/drum-n-bass-drum-amp-bass-dnb-music-dampb-drum-and-bass-488391/) — Watermello · [Information Flow (Liquid Jungle Breakbeat DnB)](https://pixabay.com/music/drum-n-bass-information-flow-liquid-jungle-breakbeat-drum-and-bass-358432/) — Musinova · [Jump Up (Sport Drum&Bass)](https://pixabay.com/music/drum-n-bass-jump-up-sport-drumampbass-425803/) — ArtIssizm · [Plastique (174 bpm a#min)](https://pixabay.com/music/beats-plastique-174-bpm-amin-4487/) — tobylane · [The Portal](https://pixabay.com/music/techno-trance-rizzlas-the-portal-224647/) — Rizzlas · [TwinFish – Pivot (Drum and Bass)](https://pixabay.com/music/drum-n-bass-twinfish-pivot-drum-and-bass-326341/) — TwinFishAudio

Artistas (42): -SunSet-, 14584889, arnaud136, ARPMedia, ArtIssizm, BerryDeep, BUZZPSY, catch22music, CONATHOR, deep_house_music, DELOSound, DJDoblina, DjFunkyPharmacist, Dubdown, Eliveta, hasenchat, klavo85, Kromaspere, Lone_Wolf_Productions, MC_QUATTRO, MeditativeTiger, Musinova, NverAvetyanMusic, PaulYudin, Placidplace, prettyjohn1, PWLPL, Rizzlas, Rockot, Saturn-3-Music, SoundReality, tAUREON, The_Mountain, ThisIsBeatKitchen, tobylane, Tunetank, TwinFishAudio, TwoWingbeats, van_Wiese, VifotoFreeSounds, Watermello, WELC0MEИ0.


## Estructura del proyecto

```
index.html, manifest.webmanifest, sw.js   Shell de la PWA y service worker (offline)
css/                                       Tokens de diseño, base, componentes, pantallas y reproductor
js/app.js                                  Arranque: rutas, tab bar, actualizaciones
js/core/                                   Estado (localStorage), router, utilidades y vibración
js/ui/                                     Componentes y gráficos (SVG)
js/training/                               Zonas, plantillas, generador, plan, progresión y logros
js/audio/                                  Coach, frases, voz grabada, pitidos y motor de música DJ
js/player/                                 Motor del entreno, wake lock, Media Session y escena 3D (scene3d/)
js/player/scene3d/themes/                  Escenarios: aurora, cordillera, estadio, blank (Grafito)
js/vendor/three/                           three.js (licencia MIT incluida)
js/screens/, js/integrations/              Pantallas; Apple Watch, calendario, tarjeta para compartir
assets/                                    Iconos, pantallas de arranque y miniaturas de escenarios
audio/                                     Voz grabada (packs/) y música DJ (music/)
tools/                                     Servidores, precache, pruebas, laboratorio 3D, voz y música
docs/                                      Especificación técnica y guía de voces
```

Sin dependencias ni compilación: HTML, CSS y JavaScript (módulos ES) tal cual.
