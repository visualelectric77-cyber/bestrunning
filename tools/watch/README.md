# Atajo «BestRunning FC» (versión 2.2)

Una web no puede leer los datos de Salud. Por eso, al terminar un entreno, BestRunning abre el Atajo de iOS **«BestRunning FC»**. El Atajo lee en Salud el pulso del Apple Watch de esa sesión y se lo pasa a la app por el portapapeles. Aquí tienes ese Atajo ya montado y **firmado**.

**El archivo que hay que importar es `tools/watch/out/BestRunning FC.shortcut`** (con espacio).
`out/BestRunning-FC.shortcut` es el mismo archivo con otro nombre.

---

## 0. Novedad de la v2.2: tarda segundos, no minutos

La v2.1 funcionaba, pero en un entreno de 45 min (unas 560 lecturas) tardaba **1-3 minutos** en el iPhone: un «Repetir con cada» ejecutaba una acción «Texto» por cada lectura. La v2.2 **no tiene ningún Repetir**. Cada lista sale de **una sola acción** que trabaja con todas las lecturas a la vez:

| Clave | Cómo se obtiene |
|---|---|
| `t` | **Obtener detalles de muestras de salud** (Fecha de inicio) → **Formatear fecha** (ISO 8601, con hora) → **Combinar texto** (saltos de línea). Una fecha por línea. |
| `bpm` | **Obtener detalles de muestras de salud** (Valor) → **Combinar texto** (saltos de línea). Un valor por línea, **en el mismo orden** que `t`. |
| `n` | **Contar** las muestras. La app comprueba que `t` y `bpm` tienen `n` líneas. |
| `t2` | Reserva: una acción **Texto** con `muestras › Fecha de inicio (ISO 8601)`, la misma agrandización que la v2.1 usaba con «Elemento repetido». Si en el iPhone «Formatear fecha» no recorriera la lista, la app usa `t2`. |

Ya no hay `csv`. La app junta la línea *i* de `t` con la línea *i* de `bpm`. Si las cuentas no cuadran, usa las parejas alineadas y lo avisa; nunca se rompe. El formato antiguo (`csv`) sigue funcionando, así que la v2.1 y el atajo hecho a mano siguen valiendo.

Lo demás no cambia: entrada, búsqueda exacta → amplia (3 días) → diagnóstico del permiso, autodiagnóstico sin entrada y petición por el portapapeles si iOS no pasa la entrada.

**Hay que actualizar la app y el atajo juntos.** Una BestRunning anterior a esta versión no entiende `t`/`bpm`: con el atajo v2.2 solo vería la media, la máxima y la mínima, sin gráfico.

## 0b. Qué falló en la versión 1 y qué cambió en la v2

El 18-10-2026, con el entreno «Correr en cinta» de 11:34 a 12:20, la v1 contestó «No hay pulso del Apple Watch en ese horario». Hay dos causas posibles, y la v2 cubre las dos:

1. **Las fechas de «está entre».** Hay dos formas reales de guardar una variable en un «está entre»: dentro de `Values.Date` / `Values.AnotherDate` (la de un atajo de ejemplo hecho por Apple en 2026, y la que usaba la v1) y en `VariableOverrides.dateValue` / `anotherDateValue` (la de un atajo exportado antiguo). No se sabe cuál lee iOS 26 en Salud, así que la v2 pone **las dos**, apuntando a la misma variable. La v1 además pasaba la lista entera de «Obtener fechas» y no llevaba `Bounded`, que sí llevan todos los atajos de Salud exportados de un iPhone.
2. **El permiso de Salud.** Si al dar permiso se dejó apagado «Frecuencia cardiaca», Salud no da error. Contesta como si no hubiera datos. Apple lo explica así: *«Cuando una app no tiene acceso de lectura, las consultas no devuelven datos»* (Guía de seguridad de las plataformas de Apple).

La v2 hace lo siguiente:

| Paso | Qué hace |
|---|---|
| **Búsqueda 1** | Pulso entre `start` y `end`, con las variables en las dos formas (`Values` y `VariableOverrides`). Toma la **primera** fecha de «Obtener fechas», para no pasar una lista. Lee como mucho 4000 lecturas, las más recientes primero. |
| **Búsqueda 2** (solo si la 1 sale vacía) | Pulso de los **últimos 3 días**. El filtro es fijo, sin variables, así que no puede fallar por las fechas. Lee como mucho **las 2000 lecturas más recientes**. La app se queda solo con las de la sesión. Notificación: **«Copiado (búsqueda amplia). Vuelve a BestRunning y pulsa Pegar»**. |
| **Búsqueda 3** (solo si la 2 también sale vacía) | Busca la lectura de pulso más reciente que haya en Salud, de cualquier fecha. |
| → si encuentra alguna | El permiso está bien. Avisa: «No hay pulso del Apple Watch de este entreno ni de los últimos 3 días. El permiso de Salud está bien: la lectura más reciente es del …». **No copia nada.** |
| → si no encuentra ninguna | **Es el permiso.** Avisa: «Salud no deja leer tu pulso a Atajos. Abre la app Salud › Resumen › tu foto (arriba a la derecha) › Privacidad: Apps › Atajos y activa Frecuencia cardiaca. Luego vuelve a BestRunning e importa otra vez.» **No copia nada.** |
| **Sin entrada** (ejecutado a mano en Atajos) | **Autodiagnóstico** en una alerta: lecturas de hoy, de los últimos 3 días, la más reciente y si el permiso está bien. No copia nada. |

El JSON copiado lleva una clave nueva: `"mode":"window"` (búsqueda exacta) o `"mode":"wide"` (búsqueda amplia). La app no la necesita: la ignora.

## 1. Antes de importar: borra el atajo anterior

En el iPhone ya está la v1, que se llama **«BestRunning FC»**. Puede que siga también el intento hecho a mano, **«BestRunning Fc»**.
- **Borra los dos** antes de importar: Atajos → mantén pulsado el atajo → Eliminar.
- Si no los borras, Atajos puede llamar al nuevo «BestRunning FC 2», y BestRunning no lo encontrará.

## 2. Importar

**En el iPhone** (AirDrop, o guárdalo en Archivos y tócalo):
1. Abre `BestRunning FC.shortcut`. Se abre Atajos con la vista previa.
2. Pulsa **«Añadir atajo»**.
3. Comprueba que se llama exactamente **BestRunning FC**.

**Desde el Mac:** haz doble clic en el archivo y pulsa «Añadir atajo». Llega al iPhone por iCloud si está activado «Sincronizar con iCloud» en Atajos.

Al firmar, Atajos quita el nombre de dentro del archivo, así que el atajo se llama como el archivo. Por eso el archivo bueno es el que lleva espacio. La firma es `shortcuts sign --mode anyone`: no hace falta activar «Permitir atajos no fiables».

## 3. Prueba de un toque (autodiagnóstico)

1. Abre la app **Atajos** y toca **BestRunning FC**, sin nada más.
2. Si iOS pregunta por Salud, activa **«Frecuencia cardiaca»** y pulsa **«Permitir»**. Si el interruptor se queda apagado, no lo leerá nunca.
3. Sale una alerta como esta:
   ```
   Lecturas de Frecuencia cardiaca en Salud:
   · hoy: 412
   · últimos 3 días: 1450

   Permiso de Salud: bien. Lectura más reciente: 18 oct 2026, 14:52.
   ```
   - **Con números distintos de 0:** todo está listo. Importa el pulso desde BestRunning.
   - **Con «No se ve NINGUNA lectura de pulso»:** es el permiso. Arréglalo:
     - **app Salud › Resumen › tu foto (arriba a la derecha) › Privacidad: Apps › Atajos.** En la lista de lectura («Permitir que Atajos lea datos»), activa **Frecuencia cardiaca**.
     - Vuelve a ejecutar la prueba.

## 4. Importar el pulso de un entreno

1. En BestRunning: **Hoy → Ver resumen → tarjeta «Pulso del Apple Watch» → «Importar pulso del Apple Watch»**.
2. Se abre Atajos, que ejecuta «BestRunning FC». Tarda unos segundos: la v2.2 ya no recorre las lecturas una a una.
3. Sale una de estas notificaciones:
   - «Vuelve a BestRunning y pulsa Pegar»: búsqueda exacta.
   - «Copiado (búsqueda amplia). Vuelve a BestRunning y pulsa Pegar»: ha usado la búsqueda amplia. Funciona igual.
   - Un aviso de **permiso** o de **«no hay pulso de este entreno»**: no ha copiado nada, y el mensaje dice por qué.
4. Vuelve a BestRunning y pulsa el botón de la hoja «Pegar datos del Watch». Si iOS pregunta, toca **«Permitir pegar»**.

## 5. Qué hace, acción por acción (como lo verás en Atajos en español)

| # | Acción | Qué hace |
|---|---|---|
| 0 | Comentar | De dónde sale el atajo. |
| 1–10 | **Si** Entrada del atajo **tiene algún valor** → `entrada` · **Si no** → Obtener portapapeles → si **contiene** `"start"` → `entrada` | v2.1: si iOS no pasa la entrada, la app deja la petición en el portapapeles. |
| 11 | **Si** `entrada` **tiene algún valor** | El caso normal. |
| 12 | Obtener diccionario de la entrada | |
| 13–16 | Obtener valor del diccionario `start` → **Obtener fechas de la entrada** → **Obtener ítem de la lista (Primer ítem)** → Definir variable `start` | Inicio de la sesión (con 60 s de margen). |
| 17–20 | Lo mismo con `end` → `end` | |
| 21–22 | Obtener valor del diccionario `id` → Definir variable `id` | |
| 23 | **Buscar muestras médicas**: Tipo es Frecuencia cardiaca · Fecha de inicio **está entre** `start` y `end` (en `Values` y en `VariableOverrides`) · Más reciente primero · Límite 4000 | Búsqueda 1. |
| 24–28 | Definir variable `muestras`, `modo` = «window», `aviso` = «Vuelve a BestRunning y pulsa Pegar» | |
| 29 | **Si** Muestras médicas **no tiene ningún valor** | |
| 30 | **Buscar muestras médicas**: Frecuencia cardiaca · Fecha de inicio **está entre los/as últimos/as 3 días** · Más reciente primero · Límite 2000 | Búsqueda 2. |
| 31–35 | `muestras`, `modo` = «wide», `aviso` = «Copiado (búsqueda amplia)…» | |
| 36 | Terminar si | |
| 37 | **Si** `muestras` **tiene algún valor** | |
| 38–40 | Calcular estadísticas ×3 (Media, Máximo, Mínimo) | La app las recalcula solo con la sesión. |
| 41 | **Contar** `muestras` | `n`. |
| 42 | **Obtener detalles de muestras de salud**: Fecha de inicio de `muestras` | Todas las fechas, en una lista. |
| 43 | **Formatear fecha**: ISO 8601, con hora | Una fecha de texto por cada fecha. |
| 44 | **Combinar texto** (Saltos de línea) | `t`. |
| 45 | **Obtener detalles de muestras de salud**: Valor de `muestras` | Todos los valores, en el mismo orden. |
| 46 | **Combinar texto** (Saltos de línea) | `bpm`. |
| 47 | **Texto**: `muestras › Fecha de inicio (ISO 8601)` | `t2`, la reserva de `t`. |
| 48 | Diccionario | `v`, `id`, `avg`, `max`, `min`, `n`, `t`, `bpm`, `t2`, `mode`. |
| 49–50 | Texto (con el Diccionario) → **Copiar en el portapapeles** | Texto JSON. Es la **única** copia del atajo. |
| 51 | Mostrar notificación `aviso` | |
| 52 | Si no | |
| 53 | Buscar muestras médicas: Frecuencia cardiaca · sin fecha · Límite 1 | Búsqueda 3. |
| 54–58 | Si tiene algún valor → notificación «…el permiso de Salud está bien…» · Si no → notificación de **permiso** | No copia nada. |
| 59 | Terminar si | |
| 60 | **Si no** (sin entrada) | |
| 61–65 | Buscar muestras médicas (Fecha de inicio **es hoy**) → Contar · (últimos 3 días) → Contar · (cualquiera, límite 1) | Autodiagnóstico. |
| 66–72 | Si hay alguna → «Permiso de Salud: bien…» · Si no → texto de permiso | |
| 73 | **Mostrar aviso** | La alerta del apartado 3. |
| 74 | Terminar si | |

Ejemplo de lo que queda en el portapapeles (las listas van de la lectura más reciente a la más antigua):

```
{"v":1,"id":"ses_…","avg":138.47,"max":171,"min":96,"n":563,"t":"2026-10-18T12:20:35+02:00\n2026-10-18T12:20:30+02:00\n…","bpm":"118\n121\n…","t2":"2026-10-18T12:20:35+02:00\n…","mode":"window"}
```

## 6. Si aun así falla: qué mandar

1. **Captura de la alerta del autodiagnóstico** (apartado 3). Es lo más útil: dice si es el permiso o los datos.
2. La notificación que salió al importar desde BestRunning, o el error de Atajos con la acción resaltada.
3. El mensaje de BestRunning al pulsar Pegar.
4. Si salió «búsqueda amplia», abre el atajo (mantener pulsado → Editar) y haz una captura de la **acción 23**: si «está entre» muestra `start` y `end`, o huecos vacíos.
5. Si BestRunning avisa «Las listas del Atajo no cuadran», di qué números salen en el aviso.

---

## Regenerarlo (para desarrolladores)

```
python3 tools/watch/build-shortcut.py            # v2.2: genera, valida y firma
python3 tools/watch/build-shortcut.py --no-sign  # v2.2 sin firmar
python3 tools/watch/build-shortcut-v21.py        # v2.1 archivada (con Repetir) → tools/watch/out/v21/ (sin firmar; --sign para firmarla)
python3 tools/watch/build-shortcut-v1.py         # v1 archivada → tools/watch/out/v1/ (sin firmar; --sign para firmarla)
node tools/test-watch-shortcut.mjs               # pruebas de la app y del atajo, con simulación (usa también out/v21/)
```

El script solo usa la biblioteca estándar de Python. Los UUID son deterministas.

1. **Valida el plist:**
   - cada `OutputUUID` apunta a una acción anterior;
   - las variables se definen antes de usarse;
   - **v2.2: no hay ningún Repetir**; `t` = Combinar texto (saltos de línea) de Formatear fecha (ISO 8601 con hora) de Obtener detalles (Fecha de inicio) de `muestras`; `bpm` = Combinar texto de Obtener detalles (Valor) de `muestras`; `n` = Contar `muestras` (Número); `t2` = Texto con `muestras › Fecha de inicio (ISO 8601)`;
   - los bloques están bien anidados y no repiten `GroupingIdentifier`;
   - hay 6 búsquedas de Salud, todas de Frecuencia cardiaca;
   - el «está entre» lleva `start`/`end` en `Values.Date`/`AnotherDate` **y** en `VariableOverrides`;
   - cada fila de filtro lleva `Bounded` true y cada búsqueda `WFHKSampleFilteringFillMissing` false (como el atajo de pulso exportado real);
   - los filtros «en los últimos» / «es hoy» son constantes (Number, Unit 16 = día); no se usa la unidad «horas»;
   - la búsqueda amplia va de la más reciente a la más antigua, con límite;
   - las claves de salida son `v, id, avg, max, min, n, t, bpm, t2, mode` (sin `csv`);
   - solo hay una «Copiar al portapapeles»;
   - los rangos `attachmentsByRange` (UTF-16) caen en un `￼`.
2. **Escribe, relee y vuelca:** escribe el binario, lo relee y lo valida otra vez, y pasa `plutil -lint`.
3. **Firma** en `/private/tmp`, porque el servicio de firma no ve el disco externo.

**Comprobado tras firmar (v2.2).** Extraje el contenido del `.shortcut` firmado con `aea decrypt` (la clave pública sale del certificado de la propia firma) y `aa extract`. Las 75 acciones son idénticas a las generadas. La firma solo quita `WFWorkflowName` y cambia `WFWorkflowClientVersion` a 4610.

**`tools/test-watch-shortcut.mjs`**, además de las pruebas del parser:
- **Búsqueda amplia:** más de 3000 lecturas de 3 días, otro entreno de ayer y la sesión, en orden inverso y desordenadas. Con `"mode":"wide"` y avg/max/min de 3 días, la app saca los valores de la sesión. Tarda unos 8 ms con 3500 líneas.
- **Formato v2.2 (`t`/`bpm`/`n`):** listas exactas, sin `t2`/`n`, fechas `Z`, con milisegundos y con otro desfase, coma y punto decimal (y decimales de verdad, 119,5), unidades, CRLF, salto final, listas JSON, `n` distinto (aviso), pulsos de menos (usa las parejas alineadas y avisa), `t` con una sola fecha (usa `t2`), `t` en una línea, `t` vacío o ilegible con `csv` antiguo (usa el `csv`), basura (error claro, sin excepción) y búsqueda amplia con 3500 lecturas. `tools/test-watch-hr.mjs` repite lo esencial en cuatro zonas horarias.
- **Simulador del plist generado:** un intérprete pequeño de estas acciones, con un Salud falso. «Obtener detalles» y «Formatear fecha» trabajan **elemento a elemento sobre la lista** (como dicen sus definiciones en macOS 26.5) y «Combinar texto» une con saltos de línea. Comprueba que la línea *i* de `t` y de `bpm` son la misma lectura, que `n` cuadra, y **cuenta las acciones ejecutadas**: 37 en la v2.2 frente a 595 en la v2.1 (que se simula desde `out/v21/`) con 563 lecturas (una acción «Texto» por lectura), con el mismo resultado en la app. A2: iPhone en español (coma decimal). A3: «Formatear fecha» que solo formateara la primera fecha → la app usa `t2`. Además:
  - A: búsqueda exacta;
  - B: «está entre» vacío, como en la v1 → búsqueda amplia;
  - B2: fondo denso → límite 2000, la sesión sigue dentro;
  - C: solo pulso antiguo → «el permiso está bien», no copia;
  - D: **sin permiso** → mensaje de permiso, **no copia**;
  - E: sin entrada → alerta con las cuentas (hoy y 3 días), también sin permiso.
  - En la búsqueda 1 el simulador comprueba que `Values` y `VariableOverrides` dan las mismas fechas.

## Fuentes

Todo se ha consultado en modo lectura. No se ha ejecutado ninguna herramienta de terceros.

**v2.2 (acciones de lista):**
- **macOS 26.5, `WFActionRegistry` de WorkflowKit**, consultado en local con JavaScript para Automatización (`osascript -l JavaScript`, solo lectura de las definiciones; no ejecuta ningún atajo):
  - todas las «Obtener detalles de …» disponibles en el Mac (`properties.contacts`, `.files`, `.calendarevents`, `.reminders`, `.images`, `.locations`…) son **`WFContentItemPropertiesAction`** con `inputsMultipleItems` = `outputsMultipleItems` = **true**. `properties.health.quantity` existe con nombre «Obtener detalles de muestra médica», pero en el Mac es `WFMissingAction` porque Salud no está en macOS: se supone la misma clase en el iPhone;
  - **`format.date`** = `WFFormatDateAction`, `inputsMultipleItems` = `outputsMultipleItems` = **true**, entrada `WFDate` de tipo `WFDateContentItem`, salida texto; parámetros `WFDateFormatStyle`, `WFISO8601IncludeTime`, `WFTimeFormatStyle`, `WFDateFormat`, `WFDate`, `WFLocale`;
  - **`text.combine`** = `WFTextComponentsAction`, `inputsMultipleItems` = true (parámetros `text`, `WFTextSeparator`);
  - **`count`**: `inputsMultipleItems` = true; **`statistics`**: entrada múltiple;
  - `WFDateFormatVariableAggrandizement` tiene `applyToContentCollection:completionHandler:` (se aplica a la colección entera, base de `t2`).
  - `ActionKit/Localizable.loctable`: «ISO 8601 (WFDateFormatStyle)» e «Include ISO 8601 Time (WFISO8601IncludeTime)».
- **viticci/shortcuts-playground-plugin** (`HEALTHKIT.md`, de exportaciones reales de iOS): `is.workflow.actions.properties.health.quantity` con `WFContentItemPropertyName` (`Type`, `Value`, `Unit`, `Start Date`, `End Date`, `Duration`, `Source`, `Name`) y `WFInput` `WFTextTokenAttachment` a la salida de Buscar muestras médicas. Sus atajos reales («Days In a Month») traen `format.date` con `WFDate` como `WFTextTokenString` de una sola variable, como aquí.
- **Cherri** (`actions/calendar.cherri`): `format.date` con `WFDate`, `WFDateFormatStyle` y el valor `'ISO 8601'`.
- **Atajo real exportado** (suliveevil/My-Siri-Shortcuts, «HRR 心率分析»): «Combinar texto» con `WFTextSeparator` «New Lines» sobre una **lista** (la salida de «Obtener ítems de la lista»).
- **Atajo REAL exportado que hace exactamente esto: «Health Data Export» de Heartbridge** (github.com/mm/heartbridge; iCloud `22bb56e73c354d9aa76a3678548dfe3a`, plist sin firmar descargado solo para leerlo, cliente 1050.19). Exporta pulso **sin Repetir**: su README explica que el «Repetir con cada» lo hacía lento y que manda las fechas en una lista y los valores en otra, en el mismo orden (su ejemplo: 8429 lecturas). Sus acciones:
  - 6: `properties.health.quantity` con `WFContentItemPropertyName` «Start Date» y `WFInput` = `WFTextTokenAttachment` a la salida **entera** de Buscar muestras médicas (nombre de salida «Start Date»);
  - 9: `format.date` con `WFDate` = `WFTextTokenString` «￼» que apunta a esa salida «Start Date» (estilo Custom `yyyy-MM-dd HH:mm:ss`), y su resultado es la **lista** `dates`;
  - 14: los valores con la agrandización `Value` sobre las muestras, que salen como la **lista** `values` alineada con `dates`.
  - Nuestras acciones 42-43 tienen la misma forma (lo comprueba `tools/test-watch-shortcut.mjs`); solo cambia el estilo (`ISO 8601` con hora, el mismo valor que la agrandización de la v2.1 que ya funciona en el iPhone). `t2` queda de reserva barata.
- **Ya probado en el iPhone del usuario con la v2.1:** «Combinar texto» (`text`, `WFTextSeparator` «New Lines»), «Contar» y la agrandización `WFDateFormatVariableAggrandizement` ISO 8601 con hora.

**v2 y anteriores:**

- **Atajo de pulso exportado de un iPhone** (github.com/suliveevil/My-Siri-Shortcuts, `assets/backup/Heart Rate Data.txt`): Buscar muestras médicas con `Type` `Heart Rate` (Operator 4, `Bounded` true, solo `Enumeration`), `Start Date` **«en los últimos 2 días» = Operator 1001, `Values` {`Number` 2, `Unit` 16}**, `Bounded` true, `WFHKSampleFilteringFillMissing` false, y después Repetir → texto `fecha,pulso` → Combinar texto. De ahí salen la búsqueda 2, las filas y la unidad día = 16.
- **Atajo de ejemplo hecho por Apple** («Reminder Edits», 2026, citado en github.com/viticci/shortcuts-playground-plugin, `FILTERS.md`/`PARAMETER_TYPES.md`): «está entre» (1003) con la variable **dentro de `Values.AnotherDate`** como `WFTextTokenAttachment`; «es hoy» = 1002. El mismo repositorio (`HEALTHKIT.md`) trae una exportación de iOS 26 de Buscar muestras médicas con «es hoy» y `Values` {`Number` 7, `Unit` 16}. (Su tabla de unidades dice «días = 16384»; las exportaciones reales dicen 16, y es lo que se usa.)
- **Atajo real exportado antiguo** (repositorio github.com/extratone/i, `shortcuts/source/directionstonextevent.json`, Buscar eventos de calendario):
  - «Start Date» `Operator` 1003 con `VariableOverrides: {dateValue, anotherDateValue}`, cada una un `WFTextTokenAttachment` de tipo `Variable`, **sin** `Date`/`AnotherDate`;
  - trae `Number` 1 y `Unit` 16 por defecto.
  - De ahí sale la segunda forma de la búsqueda 1 (`VariableOverrides`).
- **macOS 26.5**, cadenas de la caché dyld (`WorkflowKit/RowTemplateFindFilterParameterState.swift`):
  - `Operator`, `Removable`, `Bounded`, `Hidden`, `Values`, `VariableOverrides`, `anotherDateValue`, `enumerationValue`…, junto a `is.workflow.actions.filter.health.quantity`;
  - `WFContentItemLimitNumber`, `Latest First`, `WFItemSpecifier`, `WFCountType`, `WFAlertActionMessage`, `WFAlertActionCancelButtonShown`;
  - nombres de salida «Item from List», «Count», «Dates».
- **Localizaciones de macOS 26.5:**
  - `ActionKit/Localizable.loctable`: «Contar», «Obtener ítem de la lista», «Primer ítem», «Más reciente primero», «está entre los/as últimos/as», «no tiene ningún valor», «Mostrar aviso»;
  - la ayuda de Buscar muestras médicas: «Permitir que Atajos lea datos» en la app Salud;
  - `HealthKit/Localizable-DataTypes.loctable`: HEART_RATE = «Frecuencia cardiaca».
- **Operadores y unidades de fecha:**
  - 1001 = «está en los últimos», con `Values.Number` y `Values.Unit` (github.com/drewocarr/generate-shortcuts-skill, `FILTERS.md`);
  - unidades = NSCalendarUnit: año 4, mes 8, semana 8192 (`FILTERS.md`); **día 16** (los dos atajos de Salud exportados reales). La hora (32) no se usa: ningún atajo exportado la confirma.
- **Apple:**
  - Manual de uso del iPhone **iOS 26, es-es**, «Compartir tus datos de salud» (support.apple.com/es-es/guide/iphone/iph5ede58c3d/26.0/ios/26.0): «Toca Resumen y, a continuación, toca tu foto o tus iniciales en la esquina superior derecha. En Privacidad, toca Apps…». Es la ruta del mensaje de permiso. No se da ruta de Ajustes porque ese manual no la documenta para iOS 26;
  - support.apple.com/es-es/108779: Salud › Perfil › Privacidad › Apps;
  - Guía de seguridad (es-es, HealthKit): sin acceso de lectura, las consultas devuelven vacío.
- Las fuentes de la v1 (ScPL, Cherri, iOS-Shortcuts-Reference) siguen valiendo para el resto de acciones: Repetir, Texto, Diccionario, Estadísticas, Notificación, Portapapeles.

## Riesgos que solo se pueden comprobar en el iPhone

- **«Está entre» con variables en Salud.** No hay ningún atajo de Salud exportado con variables en «está entre»: la forma moderna viene de Recordatorios (ejemplo de Apple) y la antigua de Calendario (cliente 1206). La v2 pone las dos.
  - Si iOS 26 no lee ninguna, la búsqueda 1 saldrá vacía y la búsqueda amplia hará el trabajo.
  - Lo verás porque saldrá «búsqueda amplia».
  - Caso peor, no visto pero posible: que la acción 13 dé un **error** en vez de salir vacía. Entonces el atajo se para ahí.
  - Arreglo en 2 toques: Editar → acción 13 → borra la fila «Fecha de inicio está entre». Con eso lee las 4000 lecturas más recientes y la app se queda con las de la sesión.
  - Las dos formas a la vez (`Values` y `VariableOverrides`) no salen juntas en ningún atajo exportado; apuntan a la misma variable, así que da igual cuál lea iOS.
- **Velocidad (v2.2).** Sin Repetir, el atajo ejecuta ~37 acciones tenga 500 o 2000 lecturas (la v2.1, 595 con 563, una por lectura). Cada acción de lista procesa todas las lecturas de una vez; espero unos segundos, pero **no lo he medido en el iPhone**. Lo más lento debería ser la propia búsqueda de Salud.
- **Acciones de lista en Salud (v2.2).** Que «Obtener detalles de muestras de salud» y «Formatear fecha» recorran la lista lo confirman sus definiciones en macOS 26.5 (entrada y salida múltiples) y un atajo de pulso exportado real que hace lo mismo (Heartbridge, ver «Fuentes»); ese atajo es de iOS 14, así que en iOS 26 sigue sin estar medido. Si en el iPhone «Formatear fecha» devolviera una sola fecha, la app usa `t2`. Si «Obtener detalles» diera un error, el atajo se pararía en la acción 42 (lo verías en Atajos con la acción resaltada): habría que volver a la v2.1 (`build-shortcut-v21.py --sign`).
- **Sin Repetir de reserva (decidido en la verificación).** No se añade un «Repetir» que se active cuando las listas no cuadren: (1) el camino de lista tiene ahora un atajo real exportado detrás; (2) un error de una acción para el atajo entero, así que un Repetir posterior nunca llegaría a ejecutarse; (3) comparar números en un «Si» (`Contar líneas` frente a `n`) añadiría una forma de condición que no está probada en este atajo. Los descuadres los resuelve la app (usa `t2` o las parejas que cuadran y lo avisa).
- **App y atajo juntos.** Una BestRunning sin esta versión del parser no lee `t`/`bpm`: con el atajo v2.2 importaría solo media/máx/mín, sin gráfico (y en «búsqueda amplia» esas cifras son de 3 días).
- **Importar días después.** La búsqueda amplia solo mira 3 días y las 2000 lecturas más recientes. Para un entreno más antiguo, la app dirá «Las lecturas del Watch (…) no coinciden con la hora de esta sesión». Pasa solo si falla la búsqueda 1.
- **Fecha de «lectura más reciente».** Se muestra con el formato por defecto de Atajos (por ejemplo «18 oct 2026, 14:52»).
- Siguen los riesgos de la v1: el texto del Valor («119», «119,5» o con unidad; la app acepta los tres), Estadísticas sobre muestras y el icono.
