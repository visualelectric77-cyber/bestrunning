# Repaso a tamaño iPhone · 2 nov 2026

Recorrido completo de la web en el navegador integrado a **390×844 (vertical)** y **844×390 (horizontal)**, con el servidor local (`bestrunning-range`) y el perfil de prueba «Prueba».

Pantallas: Hoy, Plan, Clases, ficha de clase, Preparación, una clase real (Pirámide, 20 min) hasta el final, resumen, Progreso (Entrenos, Salud, Tu forma, Historial), Ajustes con todas sus secciones y la bienvenida con el almacenamiento vacío.

En cada pantalla, además de mirarla, un script buscaba textos cortados, contraste bajo (WCAG), elementos fuera de pantalla y palabras en inglés. **No hubo errores de consola** en todo el recorrido.

Capturas: `antes/` y `despues/` (mismo número = mismo hallazgo).

## Arreglado y publicado

| # | Pantalla | Qué pasaba | Arreglo |
|---|---|---|---|
| 03 | Plan (vertical) | En el día hecho, la línea «✓ Hecho · 2,8 km · 20:00» se partía y dejaba «· 20:00» huérfano en otra línea. | El check verde ya dice «hecho» (y la etiqueta accesible también): queda «✓ 2,8 km · 20:00» en una línea. `js/screens/plan.js` |
| 04 | Plan (horizontal) | En la columna izquierda, «Objetivo de carrera» se partía en dos líneas y el valor salía cortado: «5K · 10K · …». Lo mismo con «jue 10 dic · 38 días» del próximo test. | En horizontal el valor baja debajo del título, como un subtítulo. `css/screens-main.css` |
| 05 | Clases | La cabecera de «Carreras» encuadraba la foto con la cara pegada al borde de abajo y media banda en negro. | Encuadre al 47 %: cabeza y hombros enteros. También quitado el corte a una línea de la descripción de cada sección («…en cada kilómetro y l…»): ahora hasta dos. `js/screens/library.js`, `css/screens-main.css` |
| 06 | Clases (horizontal) | La cabecera de foto 3:1 medía ~270 px: ocupaba toda la altura de la pantalla. | En horizontal, banda 6:1 (134 px). `css/screens-main.css` |
| 07 | Ficha de clase | En clases de más de una hora (15K, media maratón), «1:32:10» no cabía en la columna de la hora y se montaba sobre el punto de color. | Columna más ancha solo cuando la clase pasa de una hora. `js/screens/workout.js`, `css/screens-main.css` |
| 13 | Progreso | «Desde el primer día · Tiempo **0,7 h**». | Por debajo de una hora, en minutos («40 min»). `js/screens/progress.js` |
| 14 | Progreso › Salud | Con cero clases con pulso: «De tus **0** clases con pulso de las últimas 10 semanas, sirven **0**». | «Aún no tienes ninguna: importa el pulso del Apple Watch al terminar la próxima.» `js/screens/health.js` |
| 15 | Bienvenida, paso 5 | Las voces del sistema salían con el código crudo «es-ES», «es-MX». | «Español (España)», «Español (México)», igual que en Perfil › Voz y audio. Solo cambia el texto. `js/screens/onboarding.js` |
| 11 | Fin de clase (reproductor, con tu permiso) | «0,14 km · 1:09 · 12 / kcal»: la palabra «kcal» se iba sola a otra línea. | Cada cifra va en un bloque con su unidad y solo se parte tras el «·»: queda «0,12 km · 1:03 ·» y debajo «11 kcal». `js/player/motion.js`, `js/screens/player.js`, `css/player.css` |
| 17 | Hoy | Con una clase empezada, la cabecera se partía en «HOY HAS / HECHO» y el resumen dejaba «· 42 min» al principio de la segunda línea. | El título no se parte, y el resumen baja a dos líneas alineadas a la derecha con el «·» al final de la primera. `js/screens/today.js`, `css/screens-main.css` |
| 16 | Perfil | «Mi semana: L–V 20′ · J 50′ · S 50′» daba a entender que el jueves también era de 20′. | «6 días · 3 h», el mismo total que «Tu semana tipo». `js/screens/settings.js` |

## Apuntado sin tocar (reproductor, audio o música): pendiente de tu decisión

1. **Clase en marcha** (`antes/09`): «KM/H» y «MIN/KM» bajo la velocidad grande se leen mal sobre los anillos claros del Túnel. Se podría dar más opacidad a esas etiquetas o ponerles una sombra suave.
2. **BPM distintos**: el reproductor decía «Lo-Fi Disco · -SunSet- · 112 BPM» y el resumen «Sonó en tu sesión» decía 115 BPM.
3. **Progreso › Lo que más suena** no incluyó la canción que acababa de sonar (Lo-Fi Disco). Además, los artistas salen con el usuario de Pixabay («NverAvetyanMusic», «deep_house_music»), que queda poco cuidado.
4. **Atajo del Watch**: la guía y el propio Atajo siguen diciendo «Vuelve a BestRunning y pulsa Pegar» y «BestRunning Salud». No lo he cambiado porque el texto tiene que coincidir con el Atajo descargable (`tools/watch/build-shortcut.py`) y con sus tests. Para el cambio de nombre hay que regenerar el Atajo.

## Vistos y correctos

Hoy, Preparación (vertical y horizontal), resumen (vertical y horizontal), Historial, todas las secciones de Ajustes (Sobre ti, Velocidades, Mi semana, Cinta, Pantalla de entreno, Voz y audio, Música, Apple Watch y Salud, Instalar, Datos, Acerca de) y los cinco pasos de la bienvenida en las dos orientaciones.

Detalles menores que se han dejado así:

- La etiqueta «NUEVO» de las medallas tiene un contraste de 3,1:1 (blanco sobre naranja a 9 px).
- La bienvenida enseña «PASO 2 DE 5» y también «2/5» arriba.
- En la clase, el «fantasma» de la cifra que aparece tras el tiempo restante es la animación de cambio de dígito (210 ms). No es un fallo.

Nota sobre las pruebas: el service worker de localhost sirve el CSS de su caché hasta que se desregistra. Para ver los cambios en local hay que desregistrarlo o abrir la web en una pestaña nueva.
