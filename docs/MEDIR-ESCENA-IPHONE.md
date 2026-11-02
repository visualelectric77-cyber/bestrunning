# Medir la escena 3D en tu iPhone

Diez minutos en la cinta. Me mandas cuatro capturas y con eso sé si la escena va fina o no en tu iPhone.

## 1. Prepara el iPhone

- **Modo de bajo consumo apagado** (si está encendido, iOS limita todo a 30 fps y la medida no sirve).
- Batería por encima del 30 % y el iPhone sin calentar.
- En RITMUP: **Perfil › Pantalla de entreno › Calidad = Auto**.
- Abre la web y, si sale «Nueva versión disponible», tócalo para actualizar.

## 2. Abre la clase con el panel

El panel solo sale en **Safari** (en la app no hay barra para escribir la dirección). Copia uno de estos
enlaces en Safari; cada uno abre la app con el panel y fuerza ese escenario en todas las clases
(Safari guarda sus datos aparte de la app: si te pide la bienvenida, complétala; no toca nada de la app):

| Orden | Escenario | Enlace |
|---|---|---|
| 1 | Navidad | `https://visualelectric77-cyber.github.io/bestrunning/?debug=music&escena=nieve` |
| 2 | Bosque | `https://visualelectric77-cyber.github.io/bestrunning/?debug=music&escena=bosque` |
| 3 | Neón | `https://visualelectric77-cyber.github.io/bestrunning/?debug=music&escena=neon` |
| 4 | Carrera | `https://visualelectric77-cyber.github.io/bestrunning/?debug=music&escena=carrera` |

Luego: **Clases › cualquier clase › Empezar**. Para pasar al siguiente escenario, termina la clase,
abre el siguiente enlace y empieza otra.

## 3. Cuánto tiempo

**3 minutos por escenario, con la cinta en marcha** (andando vale). Los primeros 10 segundos no cuentan:
la escena está cargando. Haz **una captura de pantalla al llegar a los 3 minutos**.

## 4. Qué mirar

La primera línea del panel (la que empieza por «escena»):

```
escena bosque · 60 fps · cpu 3.1 ms · med (auto, techo med) · dpr 1.6/3 · bajadas 0
```

| Dato | Qué es | Bien |
|---|---|---|
| `60 fps` | imágenes por segundo de los últimos 2 s | 58–60 |
| `cpu 3.1 ms` | lo que tarda el iPhone en preparar cada imagen | menos de 8 |
| `med` | calidad actual: `high`, `med`, `med·88`, `med·78`, `low` o `eco` | `med` o `high` |
| `techo med` | lo más alto que puede subir ahí (`med` en Navidad, Bosque, Neón y Carrera) | — |
| `dpr 1.6/3` | resolución que usa / la de tu pantalla | — |
| `bajadas 0` | cuántas veces ha tenido que bajar la calidad, con cuándo entre paréntesis | 0 |

- `med·88` o `med·78`: ha bajado un poco la resolución para aguantar 60 fps. El escenario se ve igual
  (mismos árboles, lluvia y gente), solo algo menos nítido.
- `low` o `eco`: no llega a 60 fps. Esto es lo que quiero saber.
- `iOS a 30 fps`: el Modo de bajo consumo está encendido. Apágalo y repite.

## 5. Qué mandarme

1. Las **4 capturas** (una por escenario, a los 3 minutos).
2. Tu **modelo de iPhone** (Ajustes › General › Información).
3. Si el iPhone **se calentó** o notaste tirones en la imagen.

Si alguna captura no se lee, escríbeme la línea «escena …» tal cual.
