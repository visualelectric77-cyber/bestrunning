# Velocidad estimada por el Apple Watch (12 nov 2026)

RITMUP enseña la velocidad que toca y tú la pones a mano en la cinta: la app no sabía a qué velocidad corres de
verdad. Ahora el Apple Watch lo **estima** y la app lo enseña, lo compara y lo guarda. Es **orientativo** (sale del
braceo, no de la cinta) y **nunca cambia la velocidad de la clase**.

Estado (12 nov 2026): **publicado**. Primero la web 1.30.0 (commit `050be39`) con la build 24 (TestFlight, 22:07) y,
tras la primera prueba del usuario, la web 1.30.1 con la build 25 (ver «Primera prueba en el iPhone»), con su OK. Probado en simulador y en el navegador; **con el reloj de
verdad aún no** (lista más abajo). El repo `native/` tiene la build 24 en el commit `360e7fb`, con push hecho.

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
