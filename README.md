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
- **Fantasma de tu mejor marca**: si ya hiciste esa clase, verás si vas por delante («+35 m») o por detrás.

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

   La primera subida tarda un poco (unos 120 MB, sobre todo la música). Si `git push` pide contraseña, usa un
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
