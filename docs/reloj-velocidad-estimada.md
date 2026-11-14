# Velocidad estimada por el Apple Watch (12 nov 2026)

RITMUP enseña la velocidad que toca y tú la pones a mano en la cinta: la app no sabía a qué velocidad corres de
verdad. Ahora el Apple Watch lo **estima** y la app lo enseña, lo compara y lo guarda. Es **orientativo** (sale del
braceo, no de la cinta) y **nunca cambia la velocidad de la clase**.

Estado (12 nov 2026): **publicado**. Primero la web 1.30.0 (commit `050be39`) con la build 24 (TestFlight, 22:07) y,
tras la primera prueba del usuario, la web 1.30.1 con la build 25 (ver «Primera prueba en el iPhone»), con su OK. Probado en simulador y en el navegador; **con el reloj de
verdad aún no** (lista más abajo). El repo `native/` tiene la build 25 en el commit `94580a4`, con push hecho.
Desde el 13 nov: la corrección por franjas, la serie, la cadencia, la tarjeta del Resumen, el aprendizaje de todas las
clases y el aviso con voz van en la **web 1.31.0** (commit `e2a523b`, publicada por la sesión principal); no necesitan
build nueva. Una primera clase real ya está corrida con el reloj (13 nov).

## Qué hace

| Dónde | Qué |
|---|---|
| Reloj, pantalla **Clase** | Junto al rótulo KM/H, pequeño: `⌚ ≈6:11 /KM` (el ritmo que calcula el reloj). |
| Reloj, pantalla nueva **Ritmo** (deslizar hacia arriba desde Clase) | `CLASE 10,1` frente a `RELOJ ≈ 9,3`, una regla con la clase en el centro, la franja «vas bien» y un punto donde va tu muñeca, el veredicto («0,8 por debajo» / «Vas como marca la clase» / «0,9 por encima») y debajo el pulso grande con su zona. Colores: verde coincide, azul hielo por debajo, naranja por encima. |
| iPhone, durante la clase | Un chip `⌚ ≈10,3` en la misma línea del ritmo (no añade ninguna fila). Un toque enseña el detalle: km/h, min/km, distancia y cadencia. |
| iPhone, aviso | Si lleva 20 s o más desviado 0,5 km/h o más: «La app marca 10,9 y el Watch calcula unos 10,3: ¿has cambiado la cinta?» y el chip se pone ámbar. Solo en pantalla: la voz y la música no se tocan. |
| Sesión guardada | `session.watchSpeed = { km, avgKmh, appKm, sec, samples, ratio?, factor?, touched? }`: distancia y ritmo medio del reloj y lo que marcó la clase en ese mismo rato. |
| Corrección personal | `state.watchCal = { factor, n, ratios, updatedAt }`: clase / reloj en los tramos estables de las clases en las que **no has tocado la velocidad**. Mediana de las 8 últimas; se usa a partir de 2 clases; siempre entre 0,85 y 1,15. |

## Cómo está hecho

- **Reloj** (`native/BestRunningWatch/Model/PaceMeter.swift`, cuentas puras en `PaceMath.swift`): `CMPedometer`
  (ritmo, distancia y cadencia del sistema, lo mismo que usa Entreno en interior). No sale del
  `HKLiveWorkoutBuilder`: con el iPhone al mando la distancia de Salud es la de la clase y la del reloj va apagada
  (`WorkoutManager.phoneDriven`) para no contarla dos veces, así que el constructor no la tiene. Solo mide con el
  entreno contando y en marcha (en pausa no suma). Cada ~3 s manda `speed` por el camino del pulso (espejo de
  HealthKit y, si no, WatchConnectivity).
- **Protocolo** (`native/Shared/Wire.swift`): tipo nuevo `speed { run?, kmh?, km, cadence?, at, source: "watch" }`,
  cap `live-speed` en `native.hello` y `state.speedFactor` (la corrección ya aprendida, para que el reloj enseñe lo
  mismo que el iPhone). El iPhone reenvía `speed` tal cual a la página (`WatchLink`, `NativeBridge`).
- **Web**: `js/training/watch-speed.js` (puro: saneado, margen, aviso, lo que se guarda, corrección),
  `js/integrations/native-bridge.js` (`liveSpeed()` en el módulo y en el adaptador; inerte en Safari) y
  `js/screens/player.js` (chip, aviso, guardado). Estilos en `css/player.css` (`.hud-est`).
- **Margen**: con la corrección ya aprendida, 0,5 km/h. Sin ella, 0,5 o el 8 % de la velocidad (lo que sea más),
  porque el reloj puede ir desviado de serie (un 4 % medido) y a 12 km/h eso ya son 0,5. Tras cada cambio de
  velocidad de la clase hay 20 s de asentamiento que no cuentan; un aviso por tramo y como poco 2 min entre avisos.

## Verlo sin correr

- **Web**: abrir la clase con `?debug=speed` (y `&debug=hr` para el pulso simulado). Con `&cinta=-0.6` la cinta
  simulada va 0,6 km/h por debajo de la clase: a los ~40 s el chip se pone ámbar y sale el aviso. Ejemplo:
  `http://localhost:8080/?debug=hr&debug=speed&cinta=-0.6#/play/<id de clase>`.
  Dentro de la app nativa (sin barra de direcciones): `localStorage['br.debug.speed'] = '-0.6'` (o `'1'`).
  Lo simulado no se guarda en la sesión ni enseña nada a la corrección.
- **Reloj** (simulador): `xcrun simctl launch booted com.nachogarcia.bestrunning.watchkitapp -BRDemo ritmo`
  (también `ritmoBien`, `ritmoAlto`, `ritmoSin`, `aodRitmo`; y `clase` para ver el `≈6:11` pequeño).

## Pruebas

- `node tools/test-watch-speed.mjs` (48 comprobaciones: saneado, margen, aviso, falsas alarmas, guardado, corrección).
- `TZ=Europe/Madrid node tools/test-native-bridge.mjs` (sección «Ritmo estimado» y los ejemplos `speed*.json`).
- `native/tools/build.sh wire` y `logic-check` (PaceMath, `speed`, caps).

## Primera prueba en el iPhone (12 nov, parado) y arreglo — web 1.30.1 y build 25

Con la build 24 y la web 1.30.0, sin correr, el usuario vio tres cosas:

- **El chip tardaba mucho en salir.** El podómetro del reloj no manda nada si no detecta pasos, y el chip solo aparecía
  con la primera lectura. (Sin confirmar: si el reloj no había pedido aún el permiso de Movimiento, tampoco habría
  datos hasta contestarlo.)
- **Quieto marcaba «≈4,2», y moviendo las manos «2,3».** El podómetro cuenta también el braceo de estar quieto.
- **El móvil iba por detrás del reloj.** El reloj calcula con cada lectura del podómetro (~2,5 s) y lo pinta al momento,
  pero solo mandaba al iPhone una vez cada 3 s como mucho: con lecturas cada 2,5 s salía una de cada dos, así que el
  iPhone iba hasta ~5 s por detrás. El resto del camino no suma: el iPhone lo pasa a la página sin cola y la página
  lo pinta al llegar (y repasa el chip 4 veces por segundo). Cifras sacadas del código, no medidas en el dispositivo.

Arreglo:

1. **El chip sale desde el principio** de la clase si la app nativa puede mandar el dato (reloj en la app y cap
   `live-speed`), en espera: `⌚ ≈–`, apagado. Un toque explica que parado no marca nada.
2. **Parado no marca velocidad.** Una lectura solo cuenta como «te estás moviendo» si trae ritmo (≥ 3 km/h: por debajo
   nadie anda en una cinta) y, cuando hay cadencia, es de andar o correr (≥ 70 pasos/min).
3. **Si no cuadra con la clase, no se enseña.** Con la clase en marcha, una estimación por debajo del 60 % (o por
   encima del 160 %) de lo que marca no es «la cinta a otra velocidad»: es que no estás en ella (parado, en los
   laterales, agarrado a la barra). Ni cifra, ni aviso, ni cuenta para aprender la corrección.
4. **A la par del reloj (build 25).** El reloj manda cada lectura (nunca dos en menos de 1,5 s) y hace él la
   comprobación de «te mueves» (tres lecturas seguidas, ~5–7 s al arrancar); lo dice en `speed.moving` y la página
   enseña la cifra en cuanto llega: el iPhone queda ~1 s por detrás del reloj. Con la build 24 (sin `moving`) la
   comprobación la hace la página con 2 lecturas seguidas (~10 s hasta la primera cifra).
5. **Si te paras, la cifra se va a los 9 s** (antes 15), en el reloj y en el móvil.

Demostración: `?debug=speed&cinta=parado` (reloj simulado quieto moviendo la mano: el chip se queda en `≈–`).
Pruebas: `tools/test-watch-speed.mjs` (73), `logic-check` (216).

## Primera clase real (13 nov) → corrección por franjas, serie, cadencia y tarjeta — publicado en la web 1.31.0

En la primera clase corrida de verdad (20 min, sin tocar la velocidad) el reloj midió de media algo menos que la clase,
pero bastante menos en el bloque rápido: el error del reloj no es un factor único, se queda más corto cuanto más
rápido. Y la sesión solo guardaba el total, así que no se podía comparar por velocidades. Cambios (solo web; el reloj
no necesita build nueva):

1. **Serie en la sesión** — `session.watchSeries = [[s de clase, km/h del reloj sin corregir | null, cadencia | null,
   km/h de la clase], …]`, un punto cada 10 s (≈ 2 KB por 20 min), como mucho 720 puntos (si se llena, se juntan de
   dos en dos). `seriesCompare(serie)` la compara por franjas usando solo tramos estables.
2. **Corrección por franjas** — franjas fijas de 2 km/h de la velocidad de la clase (menos de 6, 6–8, 8–10, 10–12,
   12–14, 14 o más), iguales para todos. `state.watchCal.bands = { '8': { factor, n, ratios }, … }` junto a la
   corrección única de siempre, que sigue valiendo tal cual (lo ya aprendido no se pierde). Una franja se usa con 2
   clases que tengan al menos 2 min estables en ella (esto cambió el mismo día: ver «Ampliación» más abajo); entre dos
   franjas con datos, la recta que las une (sin saltos);
   más allá, vuelve en 2 km/h a la corrección única. `correctSpeed(cal, lectura)` pasa de lo que marca el reloj a
   km/h de cinta. El margen de la corrección pasa de 0,85–1,15 a 0,8–1,25.
   Al reloj le va, cada segundo, la corrección de la velocidad que llevas (`state.speedFactor`): su pantalla Ritmo
   marca lo mismo que el chip sin tocar la app nativa.
3. **Cadencia y zancada** — `session.watchSpeed` gana `cadence` (pasos/min), `stride` (m: velocidad de la clase ÷
   cadencia, en tramos estables), `pairKm` y `bands: { franja: { sec, appKm, km, ratio, cadence, stride } }`.
4. **Tarjeta «Reloj frente a clase» en el Resumen** (`js/ui/watch-speed-card.js`, una línea en `summary.js`): clase,
   reloj y diferencia en total; una línea por franja (velocidad de la clase, lo que marcó el reloj, diferencia,
   pasos/min · zancada); cadencia y zancada medias. Solo sale si la sesión tiene datos del reloj. Las sesiones de
   antes enseñan solo el total.

Demostración: `?debug=speed` — el reloj simulado ahora se queda corto cuanto más rápido (clavado a 7 km/h, un 3,5 %
menos por cada km/h de más) y trae su corrección por franjas; la sesión se guarda marcada como simulada
(`watchSpeed.sim`) para ver la tarjeta, y no enseña nada a la corrección.
Pruebas: `tools/test-watch-speed.mjs` (128).

### Ampliación del mismo día: aprende de TODAS las clases desde la primera, y avisa de viva voz

El usuario pidió que aprenda de verdad, de todas las clases desde ya, y que los avisos se oigan (corriendo no da tiempo
a leerlos). Sustituye a lo de «2 clases sin tocar la velocidad»:

- **Qué cuenta:** los tramos estables de cualquier clase (pasados 30 s de cualquier cambio de velocidad, lo haga la
  clase o lo hagas tú a mano), a partir de 6 km/h y con lecturas que cuadren con la clase. Una clase enseña la
  corrección única con 1 min estable y una franja con 30 s.
- **Con qué peso:** cada clase pesa por sus segundos estables (15 min como mucho) y la corrección se encoge hacia «sin
  corregir» mientras haya poco: con W segundos se aplica W / (W + W0) de lo medido, con W0 = 10 min para la única y
  4 min para cada franja (que se encoge hacia la única). Se guarda la mediana ponderada de las 12 últimas clases.
  `watchCal` gana `secs` junto a `ratios`; lo guardado antes (sin segundos) cuenta como 5 min.
- **El margen del aviso** depende de cuánta calibración hay detrás (`conf`, 0…1): 0,5 km/h con toda; hasta el 8 % de
  la velocidad con ninguna.
- **Queda escrito:** `session.watchSpeed.learn` (lo que enseñó esa clase) y, en el diagnóstico, una línea
  `reloj.aprende franja=8–10 km/h min=5 antes=1.009 despues=1.067` por franja (y `franja=todas` para la única).
  La tarjeta del Resumen dice a qué velocidades ha aprendido la clase.
- **Voz:** donde sale el aviso de desvío se llama además a `coachCall('say', 'watchDrift', { dir, speed })`; la frase
  es de la sesión principal (coach.js / pack de Lucía). Si no está grabada, no dice nada.
- **Para el control por pulso y el análisis:** `speedTrack.real(t)` → `{ kmh, raw, cadence, conf, ok, dev }` o null, y
  `seriesReal(serie, cal)` para la serie ya corregida.

Pendiente de esta parte: con una sola clase real no se puede afirmar la tendencia; se irá viendo en el diagnóstico.
Cadencia «por tramo de la clase» (no por franja) se puede sacar de la serie, pero aún no se pinta. Lo publicó la sesión
principal en la 1.31.0 (13 nov, 21:57), junto con su parte: el control por pulso usa `speedTrack.real()` cuando es
fiable y la voz del desvío tiene su propio límite en `coach.js`.

## Primera clase larga real (14 nov, 50 min) → el aviso de desvío se rehace — hecho en local, sin publicar

Leída del iPhone por cable. El aviso de desvío saltó 5 veces en 50 minutos y ninguna era un cambio de cinta (el
usuario oyó «pon la cinta a…» con la cinta ya puesta). Lo que mostró la serie:

- En tramos estables el reloj acierta dentro de ±0,5 km/h entre 8 y 10 km/h (baila un 2 %), pero al trote suave
  después de un bloque rápido marca entre 0,4 y 1,2 km/h de más (baila un 5 %): con la misma cadencia a 7,8 que a 7,3,
  no nota ese paso.
- Al tocar los botones de la cinta para cambiar de velocidad, la lectura se descoloca durante un minuto.
- De un día a otro también cambia: a la misma velocidad, un día midió de menos y otro de más.

Conclusión: su resolución real es de ±0,5 a ±1 km/h según la velocidad; un umbral de 0,5 km/h era ruido. Cambios:

1. **El aviso solo salta con lo que el reloj distingue.** (a) La clase cambia 1,5 km/h o más y, pasado 1 min, el reloj
   se ha movido menos de la cuarta parte de ese cambio (comparado consigo mismo: su sesgo del día no cuenta). (b) Un
   desvío sostenido de 1,5 km/h o del 18 % (un 30 % más sin calibración), 45 s seguidos, pasado 1 min de cualquier
   cambio. Uno por tramo estable y como poco 3 min entre avisos. Repitiendo la clase real: 0 avisos (antes 5).
2. **Se aprende cuánto baila el reloj a cada velocidad** (`sds` junto a `ratios` y `secs` en `watchCal`, y `sd` en lo
   que enseña cada clase). `real()` da `err` (km/h de error esperable) y `ok` exige además `err ≤ 0,35`, mirando lo
   peor entre la velocidad que cree el reloj y la que marca la clase. Sin dato (lo guardado antes), se supone un 5 %.
3. Para aprender, el asentamiento pasa de 30 s a 1 min tras cada cambio de velocidad.

Demostración: el aviso ya no sale con `cinta=-0.6`; para verlo, `?debug=speed&cinta=-2.5`.
Pruebas: `tools/test-watch-speed.mjs` (138). La pantalla Ritmo del reloj sigue coloreando con su margen de 0,5 km/h
(haría falta build nueva para cambiarlo).

## Qué falta probar con el reloj de verdad en el gimnasio

1. **Permiso de Movimiento.** La primera vez el reloj pedirá «Movimiento y actividad física» (texto nuevo en
   `Config/BestRunningWatch-Info.plist`). Comprobar que sale con la app delante y que, si se dice que no, la clase,
   el pulso y Salud siguen igual (la pantalla Ritmo dirá «Sin permiso de Movimiento»).
2. **Que llegan lecturas con la clase empezada desde el iPhone** (app del reloj abierta por `startWatchApp`, a veces
   en segundo plano): el chip `⌚ ≈…` debe aparecer en el iPhone a los ~10 s de empezar a correr.
3. **Cuánto se parece a la cinta.** Correr 5 min a 9, 10,5 y 12 km/h sin tocar nada y apuntar lo que marca el chip.
   Si el sistema no da ritmo instantáneo en interior, el reloj lo saca de la distancia de los últimos ~12 s
   (ya está previsto), pero hay que ver cuál de los dos sale.
4. **Retraso.** Cuánto tarda el chip en ponerse al día tras un cambio de tramo (previsto: 10–15 s). Si es más,
   subir `SETTLE_SEC` en `watch-speed.js` para que no salgan avisos de más.
5. **Falsas alarmas y aviso de verdad.** Una clase de intervalos seguida al pie de la letra no debe avisar. Luego,
   dejar la cinta 0,6–1 km/h por debajo un minuto: debe avisar una vez.
6. **Braceo raro.** Agarrarse a la cinta, beber, secarse el sudor: el reloj dejará de ver el braceo y marcará de
   menos. Ver si eso dispara el aviso con demasiada facilidad.
7. **Pausa y reanudar**: la distancia del reloj no debe sumar en pausa.
8. **Corrección personal**: tras 2 clases sin tocar la velocidad, `state.watchCal.factor` debería quedar cerca de
   0,96 (si el reloj mide un 4 % de más) y el chip, clavado con la clase.
9. **Pantalla Ritmo corriendo**: que las dos cifras y el punto se lean bien con la muñeca en movimiento y con la
   pantalla siempre activa.
10. **Batería y enlace**: un mensaje más cada 3 s por el espejo. Comprobar que el pulso sigue llegando igual.

## Para publicar (cuando haya OK)

- Web: `node tools/precache.mjs --bump minor` (mete `js/training/watch-speed.js` en la caché) y publicar como siempre.
  El chip no aparece hasta que el reloj mande lecturas: con la app nativa de ahora (build 23) no cambia nada.
- App: subir `CURRENT_PROJECT_VERSION` a 24 en `native/Config/Base.xcconfig` y TestFlight con la receta de siempre.
  En App Store Connect, el texto del permiso de Movimiento es nuevo: revisar la ficha de privacidad (Forma física).

## No hecho

- Lector Bluetooth FTMS de solo lectura (opcional del encargo): no se ha empezado.
- Enseñar en el Resumen o en el Historial la comparación reloj / clase: los datos ya se guardan en la sesión.
