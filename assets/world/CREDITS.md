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
