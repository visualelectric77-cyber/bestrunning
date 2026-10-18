# BestRunning

**Tu entrenador personal de cinta.** BestRunning es una app web progresiva (PWA) para entrenar en cinta de
correr con el iPhone: clases guiadas con un coach de voz que te avisa de cada cambio de velocidad, música
electrónica mezclada a tu ritmo, escenarios 3D a pantalla completa con rótulos de retransmisión y un plan
semanal que se adapta a ti.

Funciona sin conexión, no tiene servidor ni cuentas y todos tus datos se quedan en tu iPhone. Está pensada para
el iPhone 18 Pro Max (Safari / iOS 26), en vertical y en horizontal, y también se ve en la tele por AirPlay.

## Qué incluye

**Entrenar**
- **Plan semanal personalizado**: de lunes a viernes 20 min, el jueves una sesión larga (45–60 min) y un día
  largo el fin de semana. Ciclos de 4 semanas (Base → Construcción → Pico → Descarga + Test VAM).
- **Más de 30 clases**: intervalos, tempo, resistencia, fartlek, cuestas, recuperación, retos y el **Test VAM**
  por escalones (termina con «No puedo más» y recalcula tus velocidades).
- **Tus cuatro marchas** (trotar 8,3 · correr 10,1 · rápido 11,5 · sprint 13,0 km/h de partida) suben poco a
  poco según cómo te sienten las sesiones. Si te saltas tramos o terminas antes, la app no te sube de nivel.

**Durante la clase**
- **HUD de retransmisión**: velocidad gigante y nítida, zona en su color, cuenta atrás del tramo, «Siguiente»,
  mini perfil de la clase, distancia, kcal y zona de pulso objetivo. Los controles aparecen al tocar la pantalla.
  Los momentos (KM, MITAD, SERIE 3/8, RÉCORD) entran como rótulos discretos arriba a la derecha.
- **Escenarios 3D** (Perfil → Pantalla de entreno → Escenario): **Aurora** (recomendado), **Cordillera** (cada
  intervalo es una cumbre que ves venir), **Estadio** (pista de atletismo con luces de ritmo) y **Grafito**
  (el más ligero). El mundo se mueve a la velocidad real de tu cinta. Calidad Auto/Alta/Ahorro/Sin 3D.
- **Coach de voz** «Eva» (voz grabada) que avisa 10 s antes de cada cambio, con cuenta atrás 3-2-1 y pitidos.
  Si falta alguna grabación, usa la voz del iPhone.
- **Música DJ BestRunning**: electrónica elegida por BPM para cada tramo y mezclada a compás en cada cambio.
  También puedes usar tu Spotify o Apple Music («Mi música»).
- **Modo TV** para AirPlay: aún más mínimo (velocidad, zona, cuenta atrás y siguiente).
- **Luces de tu récord**: si ya hiciste esa clase, una hilera de luces en el suelo corre a ritmo de tu mejor sesión; al superarla se vuelve dorada, y el chip te dice si vas por delante («+35 m») o por detrás.

**Después**
- **Resumen**: anillo de cumplimiento, plan frente a real (los tramos saltados aparecen atenuados), tiempo por
  zonas, sensaciones, récords y logros, música que sonó y tarjeta para compartir.
- **Pulso del Apple Watch**: un Atajo lee de Salud el pulso de la sesión y lo pinta sobre el perfil (una web no
  puede leer el reloj en directo).
- **Progreso**: semana, kilómetros, horas, rachas, calendario, evolución de velocidades, VO₂máx estimado.
- **Copia de seguridad** de todos tus datos en un archivo JSON (Perfil → Datos).

Capturas y vídeo de la versión final (solo en tu disco, no se suben a GitHub): `docs/capturas/final/`.

## Probarla en el ordenador

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

## Antes de publicar (cada vez que cambies algo)

```bash
node tools/check-imports.mjs                     # todos los imports existen
for f in tools/test-*.mjs; do node "$f" | tail -1; done   # todas las pruebas en verde
node tools/precache.mjs --bump patch             # nueva versión y lista offline actualizada
```

`--bump patch` sube 1.1.0 → 1.1.1; `--bump minor` sube a 1.2.0; sin `--bump` solo regenera la lista. **No te
saltes el precache**: si no, los iPhone que ya tengan la app instalada seguirán con la versión anterior. Al abrir la
app aparecerá «Nueva versión disponible · Toca para actualizar» (nunca a mitad de un entrenamiento).

## Publicarla en GitHub Pages, paso a paso

1. **Crea el repositorio.** Entra en [github.com](https://github.com) (crea una cuenta si no la tienes) →
   botón **New** → nombre `bestrunning` → **Public** → *sin* README, .gitignore ni licencia → **Create
   repository**.
   - Con una cuenta gratuita, GitHub Pages solo funciona con repositorios **públicos**: el código se puede ver,
     pero tus entrenamientos **nunca** se suben (viven solo en el iPhone). Con GitHub Pro también vale privado.
2. **Sube el proyecto** desde la Terminal del Mac, dentro de la carpeta (el `.gitignore` ya deja fuera los
   `._*` del disco externo, las fuentes de música, las tomas de voz, las capturas y `.claude/`):

   ```bash
   cd /Volumes/PortableSSD/BESTRUNING
   git init
   git add .
   git commit -m "BestRunning 1.1.0"
   git branch -M main
   git remote add origin https://github.com/<tu-usuario>/bestrunning.git
   git push -u origin main
   ```

   La primera subida tarda un poco (unos 260 MB, casi todo la música: 55 pistas, 246 MB). Si `git push` pide contraseña, usa un
   *token* de GitHub (Settings → Developer settings → Personal access tokens) o instala
   [GitHub Desktop](https://desktop.github.com).
3. **Activa Pages.** En el repositorio: **Settings** → **Pages** → *Build and deployment* → *Source*: **Deploy
   from a branch** → rama **main**, carpeta **/ (root)** → **Save**.
4. **Espera 1–2 minutos** (pestaña **Actions** para ver el progreso). Tu app estará en
   `https://<tu-usuario>.github.io/bestrunning/`.

Todas las rutas son relativas y hay un `.nojekyll`, así que funciona tal cual dentro de la subcarpeta.

Para publicar cambios más adelante: los tres comandos de «Antes de publicar» y después

```bash
git add .
git commit -m "Nueva versión"
git push
```

## Instalarla en el iPhone

1. Abre la dirección de tu app en **Safari** (tiene que ser Safari).
2. Pulsa **Compartir** (el cuadrado con la flecha) → **Añadir a pantalla de inicio** → **Añadir**.
3. Abre BestRunning desde el icono: pantalla completa, como una app nativa, y sin conexión.
4. La primera vez, con wifi, deja la app abierta un minuto: descarga la voz de Eva para usarla sin conexión. La
   música se guarda al escucharla o con **Perfil → Música → Descargar música para usar sin conexión**.

Consejos para entrenar:
- **Bloqueo automático en «Nunca»** (Ajustes → Pantalla y brillo) mientras entrenas: la app intenta mantener la
  pantalla encendida, pero iOS puede apagarla.
- Con **Música DJ**, el coach se oye aunque el iPhone esté en silencio. Con **Mi música** (Spotify/Apple Music)
  quita el modo silencio para oír al coach.
- Al empezar, inicia en el Apple Watch el entrenamiento **Cinta de correr**; al terminar puedes importar el
  pulso desde el resumen (la app te guía para instalar el Atajo).

## Voz grabada con ElevenLabs (opcional)

La voz «Eva» está grabada con [ElevenLabs](https://elevenlabs.io) (voz Eva Dorado) y vive en
`audio/packs/eva/`. El guion completo está en `js/audio/voice-pack.js`. Para generar las frases que faltan:

```bash
pbpaste > ~/.config/bestrunning/elevenlabs.key        # tu clave de la API (nunca se escribe en el proyecto)
node tools/voice/generate-pack.mjs --dry-run           # cuenta caracteres: no gasta créditos
node tools/voice/generate-pack.mjs --style v3          # genera solo lo que falta (gasta créditos)
node tools/voice/generate-pack.mjs --style v3 --only countdown_1 --force   # regrabar una frase
node tools/precache.mjs --bump patch
```

Pendiente ahora mismo: unos 55 clips del guion (saludos de inicio por tipo de clase, km 9–12, escalones 13–16,
algunas duraciones, la frase final para sesiones no completadas `finishpartial_*`) y regrabar `countdown_1`
(dice «Dos, uno… ¡vamos!», falta «Tres»). Mientras tanto la app los sustituye por frases equivalentes o calla.
Si grabas tomas largas en la web de ElevenLabs, `python3 tools/voice/split-takes.py` las corta en clips y las
verifica con whisper. Más detalles en [`docs/VOCES.md`](docs/VOCES.md).

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
