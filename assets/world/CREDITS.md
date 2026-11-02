# RITMUP · recursos de los escenarios realistas

Cielos, texturas y ramas de los escenarios Costa, Desierto, Neón, Túnel, Bosque y Navidad
(`js/player/scene3d/themes/`). Los prepara `tools/world/build-assets.py` a partir de las descargas originales.

No van en el precache: el service worker los guarda en la caché `br-world` la primera vez que se elige cada
escenario, y no los vuelve a pedir. **Si cambias un archivo, cámbiale el nombre**, o los iPhone que ya lo tengan
seguirán usando el viejo.

## Origen y licencias

Todo es **CC0** (dominio público) de [Poly Haven](https://polyhaven.com), salvo `costa/water_nor.jpg`.

| Escenario | Archivo | Origen |
|---|---|---|
| Costa | `sky.jpg`, `env.jpg` | HDRI «Blouberg Sunrise 2» (recorte del panorama tonemapped) |
| Costa | `paving_*` | textura «Rectangular Paving» |
| Costa | `beach_*` | textura «Damp Beach Sand» |
| Costa | `dune_*` | textura «Coast Sand 01» |
| Costa | `water_nor.jpg` | `examples/textures/waternormals.jpg` de three.js r186 (licencia MIT) |
| Desierto | `sky.jpg`, `env.jpg` | HDRI «Qwantani Night (Pure Sky)» |
| Desierto | `sand_*` | textura «Aerial Sand» |
| Desierto | `road_*` | textura «Asphalt 02» |
| Neón | `sky.jpg`, `env.jpg` | HDRI «Shanghai Bund» |
| Neón | `road_*` | textura «Asphalt 02» |
| Neón | `facade_*` | textura «Concrete Tile Facade» |
| Neón | `walk_*` | textura «Patterned Paving 02» |
| Túnel | `env.jpg` | HDRI «Shanghai Bund» (solo reflejos) |
| Bosque | `sky.jpg`, `env.jpg` | HDRI «Kloofendal Misty Morning (Pure Sky)» |
| Bosque | `floor_*` | textura «Forest Floor» |
| Bosque, Navidad | `branch.webp`, `bark.jpg` | modelo «Fir Tree 01»: ramitas recortadas de su atlas `twig_diff` y `twig_alpha`, y su corteza `bark_diff` |
| Navidad | `sky.jpg`, `env.jpg` | HDRI «Kloppenheim 07 (Pure Sky)» |
| Navidad | `snow_*` | textura «Snow 02» |

Los rótulos de Neón (HOTEL, BAR, CINE…) se dibujan en la app. No hay marcas reales.

## Escenarios de siempre con texturas de foto (web 1.14)

| Escenario | Archivo | Origen |
|---|---|---|
| Carrera | (usa `neon/`) | cielo «Shanghai Bund», asfalto «Asphalt 02», aceras «Patterned Paving 02», fachadas «Concrete Tile Facade» |
| Estadio | `tartan_*` | textura «Rubberized Track» |
| Estadio | `grass_*` | textura «Leafy Grass» |
| Cordillera | `rock_*` | textura «Aerial Rocks 02» |
| Cordillera | `snow_*` | textura «Snow 02» |
| Aurora | (usa `desierto/sky.*`) | HDRI «Qwantani Night (Pure Sky)»: estrellas y Vía Láctea |
| Halloween | `mud_*` | textura «Forest Floor» |
| Grafito | `floor_*` | textura «Smooth Concrete Floor» |


## Ciudades reales (prototipos ocultos: Berlín, Berlín 10 km y Madrid)

`ciudad/<ruta>/` (`route.json` y los trozos `c<k>.json`): calles, edificios con su altura, parques, fuentes, árboles y
farolas de **OpenStreetMap**. **© colaboradores de OpenStreetMap**, datos bajo licencia
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) (https://www.openstreetmap.org/copyright). Estos JSON son
una base de datos derivada: se publican con la misma licencia ODbL. La escena muestra «© OpenStreetMap» en una esquina.
Los genera `tools/ciudad/bake.mjs` con las consultas `tools/ciudad/*.overpassql`. Los árboles de parques y bulevares
que OSM no tiene uno a uno los siembra el script, y las fuentes de Cibeles y Neptuno se ponen a mano.
Texturas y cielo: los de Neón, Costa y Bosque (CC0, ver arriba). El público y las hojas se dibujan en la app.
