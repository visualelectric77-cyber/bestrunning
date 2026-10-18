
## screens-rest → otros grupos (pendiente fuera de mi propiedad)

Arreglado en mi grupo (no tocar sin coordinar): progresión con saltos/fin temprano, regla única
`countsAsSession` (planner.js, usada por stats/logros/semana/día hecho), Test VAM con techo VAM+2, HR del Watch
mapeado a tiempo de clase, `profileChart({ gaps })`, tarjeta de música compartida (`js/integrations/session-music.js`),
reanudar tras recarga en `#/play/<id>` (app.js), pestaña activa según `?from=` (router.js), `--text-3` 0,56.

### Player (js/screens/player.js · js/player/engine.js)
1. **Campos nuevos en la sesión** (los lectores ya existen y son tolerantes si faltan):
   - `session.finishedEarly = !!s.finishedEarly` y `session.skippedSec = Math.round(s.skippedSec)` en el guardado
     (player.js ~2154). progression.js/planner.js los prefieren a la heurística por `speedTrace`.
   - `session.skips = [[desdeSec, hastaSec], …]` en TIEMPO DE CLASE: anotar en engine.skip() (y endTest) el rango
     saltado. summary/history lo pasan a `profileChart({ gaps })`, que oscurece el tramo y corta la línea «Real».
   - `session.timeline = [[wallMs, classSec, running(1|0)], …]`: una entrada al empezar (1), pausar (0), reanudar
     (1), saltar (1, con el nuevo classSec) y terminar (0). Guardarla también en `engine.snapshot()`; al restaurar
     tras recarga añadir `[savedAt, classSecGuardado, 0]` y al reanudar `[Date.now(), classSec, 1]`.
     `watch-hr.js wallToClassMapper()` la usa para alinear el pulso (descarta muestras en pausa).
2. **renderNext**: si `next.stage > 0`, «Escalón N · 8,5» en vez de «1:00 Trote 8,5».
3. **Texto de fin coherente con la sesión**: `coachCall('say','finish')` dice «¡Entrenamiento completado!
   Enhorabuena» aunque la sesión sea del 51 %. Elegir la frase por `session.completed` (o `countsAsSession` de
   js/training/planner.js); si no se completó, usar el grupo «buen trabajo».
4. **css/player.css ~1203-1221 (`.sm-bg__glow*`)**: el resumen aún tiene un lavado radial marrón; dejar la misma
   base grafito que el HUD (#0b0d12 → #12141a) con, como mucho, un acento fino de `--cc`.
5. **player.mount()**: app.js ya redirige `#/play/<id>` → `#/play/resume` antes de arrancar el router si la
   instantánea es de esa clase; si el player quiere ser autosuficiente, hacer lo mismo cuando `rawId !== 'resume'`
   y `loadActiveSession()?.workoutId === rawId`.

### Settings (js/screens/settings.js)
6. Historial de Velocidades (línea ~65 `progression: { label: 'Progresión', color: 'var(--ok)' }`): si la entrada
   baja algún nivel, etiqueta neutra «Ajuste» (color `var(--text-3)` o `var(--danger)`), no «Progresión» verde.
7. Copys: «Sí, funciona offline» → «Sí, sin conexión» (~1277); «Subidas con «riser», ecos y barridos de filtro…»
   → «Subidas de tensión, ecos y barridos de filtro» (~1616); «entradas directas al drop» → «entradas directas al
   subidón»; botón TAP (~1901) → «TOCA AL RITMO» y nota «…corrígelo tocando al ritmo» (~1810); «No he podido…»
   (~906) → «No hemos podido…».
8. Nombre de zona: «Trote» (~315, ~429, VAM sheet) → usar `ZONES[k].name`/`.short` (ahora `short` de jog es
   «Trotar», igual que el nombre).
9. Música: porcentajes con un solo formato (`62 %` con NNBSP U+202F) y BPM redondeado (`fmt.int`) en la lista de
   la biblioteca y el editor de canción («112,3 BPM» → «112 BPM»).

### Global
10. **sw.js**: hay un módulo nuevo `js/integrations/session-music.js` → ejecutar `node tools/precache.mjs` al final
    (cuando todos los grupos hayan terminado) para que entre en el precache offline.
11. `tools/test-audio.mjs` falla (30) en «parcial: escalón 4/5 compuesto (up_1,s_95)» con el fixture propio del
    test (no depende de plantillas ni de ZONES: lo comprobé revirtiendo mis cambios). Revisar js/audio (coach/
    audio-engine, modificado a las 05:28).

## settings-audio-core → otros grupos

Hecho en mi grupo: selector «Escenario» en Ajustes › Pantalla de entreno (Aurora/Cordillera/Estadio/Grafito con
miniaturas `assets/scenes/<id>.jpg` y póster `<id>-poster.jpg`, demo con el escenario elegido y cambio en caliente),
`visuals.theme` en store (por defecto 'aurora', saneado: 'legacy' o basura → 'aurora'), copys §15/§16, voces de
broma plegadas en «Más voces», Eva sin marca del proveedor, cuenta atrás grabada alineada, respaldo de portadoras
en composeCue, SW (shell cache-first, navegaciones con 2,5 s, renovación de audio al cambiar index/library,
precache de `audio/packs/*/index.json` y precalentado de clips), AudioContext liberado tras la música,
`.nojekyll` y `.gitignore`. También apliqué los puntos 6–9 de «screens-rest → Settings» (Ajuste, copys, Trotar,
NNBSP en %, BPM entero).

1. **tools/test-audio.mjs:596 (aplicar sí o sí; explica los 30 fallos del punto 11 de screens-rest)**. Los escalones
   del Test VAM sin clip grabado (stage_13…16 en el pack real) ya no caen a la voz del sistema: se dicen con Eva como
   «Cambio: sube a… catorce coma cinco.» (up_3 + velocidad). El test exigía `stage_N` siempre. Sustituir la línea por:
   ```js
   if (c.kind === 'change' && w.isTest && n.stage > 0) ok(c.clips[0] === `stage_${n.stage}` || (!avail.has(`stage_${n.stage}`) && /^up_\d$/.test(c.clips[0])), `${tag}: escalón ${n.stage} compuesto (${c.clips})`);
   ```
   (`avail` ya está en el ámbito de `checkPackSchedule`). Con ese cambio test-audio vuelve a verde.
2. **js/screens/player.js:31** `VISUAL_DEFAULTS`: añadir `theme: 'aurora'` (cosmético: store ya da el valor).
3. **Preparación del entreno (workout.js / player.js prep)**: el interruptor «Música DJ BestRunning» escribe
   `music.enabled` global y apaga la música para siempre sin avisar. O hacerlo solo para esta sesión, o rotularlo
   «Música (también en Perfil)».
4. **css/screens-more.css** (opcional): settings.js inyecta una vez `<style id="st-extra-css">` con las reglas de
   `.st-scene*`, `.st-more`, `.st-lvh__date{flex:none;white-space:nowrap}`, `.mu-apponly.is-off [data-mu-dep]` y
   `.mu-tap__big` (24 px para «TOCA AL RITMO»). Si se mueven a la hoja, borrar `SETTINGS_CSS` en settings.js.
5. **js/screens/onboarding.js**: «Eva Dorado · Recomendada» → «Eva · Recomendada» (en Ajustes ya se llama «Eva»;
   el crédito «Eva Dorado (ElevenLabs)» queda en Acerca de).
6. **Voz grabada (decisión del dueño: gasta créditos de ElevenLabs)**: faltan 55 clips del guion (intro_* ×8,
   watch_1, recoverpre_1, stage_13…16, km_9…12, rep_9…12, dur_40/75/360/420/480/720/900/1200, variantes _2/_3…),
   así que la sesión arranca sin saludo ni nombre de clase. Y `countdown_1.mp3` dice «Dos, uno… ¡vamos!» (whisper
   lo confirma; falta «Tres»): ahora suena alineado (dos→+1 s, uno→+2 s, ¡vamos!→+3 s) pero conviene regrabarlo.
   `node tools/voice/generate-pack.mjs --style v3` (lo que falte) y `--only countdown_1 --force`.
7. **Despliegue / README**: último paso antes del commit: `node tools/precache.mjs && node tools/check-imports.mjs`
   (cualquier edición posterior sin ello deja a los iPhone instalados sin la actualización). Ya existe `.nojekyll`;
   `.gitignore` excluye `.claude/`, `docs/capturas/` y `docs/backup/`.

## player-3d → otros grupos (pendiente fuera de mi propiedad)

Hecho en mi grupo (player.js, player.css, js/player/**, hud-mock): avisos del reproductor en un rótulo bajo los bugs
(nunca sobre la barra superior, sin desenfoque; los toasts globales con el reproductor en marcha bajan bajo la fila de
botones y pierden el backdrop-filter), «transcurrido» = tiempo corrido de verdad, MITAD = mitad de la clase, bugs que
se sustituyen tras ⏭, bloque sin número si es único, sin controles fantasma en el «3», escena 3D creada (oculta) en la
preparación + cuenta 3-2-1 desde un único t0, calidad adaptativa por cadencia+coste con histéresis, sesión de audio
'playback' durante todo el entreno con música de la app (hasta que acaba la frase final), modo TV solo por sesión,
música on/off de la preparación/entreno solo por sesión, −/+ y aviso del modo TV que caben en pantalla, «Siguiente»
que nunca recorta la velocidad, «Guardar» del resumen opaco y pulsable, checklist sin recortes, wake lock y Media
Session robustos, registro de escenarios en orden (Aurora, Cordillera, Estadio, Grafito) con textos cortos, y en la
sesión `finishedEarly`, `skippedSec`, `skips` y `timeline` (puntos 1–2 y 4 de «screens-rest → Player»; el 5 ya lo hace
app.js). La sesión NO se borra de la instantánea si el guardado del historial falla (se reintenta al reabrir, sin
duplicar).

1. **js/screens/settings.js · «Bajar la música cuando hablo»**: en iOS (WebKit) 'transient' y 'ambient' acaban los dos
   en la categoría Ambient (obedece al modo silencio y el «ducking» no está garantizado), así que el interruptor
   probablemente no cambia nada en el iPhone. Propuesta de copy: título «Bajar tu música cuando hablo», sub «Solo con
   «Mi música». Quita el modo silencio: con tu música sonando, la voz del coach lo respeta». (Con «Música DJ» la app
   usa 'playback' y el modo silencio ya no calla al coach.) La fila «Modo TV por defecto» queda bien como está: el
   reproductor ya no la reescribe.
2. **js/core/store.js · persist()/setState()**: que informen del fallo (devolver false o relanzar) en vez de solo
   emitir 'br:storage-error'. El reproductor ya lo detecta escuchando ese evento de forma síncrona, pero otros
   guardados (resumen) no. A medio plazo: historial (speedTrace, hrSeries) a IndexedDB.
3. **js/app.js:96 · listener 'br:storage-error'**: limitar el toast a uno por minuto (el reproductor ya espacia sus
   instantáneas a 1/min cuando falla, pero cualquier otro setState repetido inundaría de avisos).
4. **js/audio/music.js · setSession(false) → setAudioSessionType('auto')** al parar/apagar/acabar el plan: con la música
   de la app el reproductor reafirma 'playback' (vigilancia a 1 Hz y tras el fundido final). Más limpio: que music.js
   no baje la sesión si el reproductor la ha fijado (opción `keepSession` o no tocarla en `setEnabled(false)`/`stop`).
5. **js/audio/coach.js · frase final**: el reproductor ya pasa `completed` en `say('finish', { km, min, completed })`;
   falta que coach.js elija «¡Entrenamiento completado!» solo con `completed === true` y si no un grupo «Buen
   trabajo» (punto 3 de «screens-rest → Player»).
6. **Verificar en el iPhone (no se puede en el navegador)**: con el modo silencio activado, (a) Música DJ encendida,
   (b) apagada a mitad, (c) «Mi música»: el coach debe oírse en (a) y (b); en (c) la preparación ya pide quitar el modo
   silencio.

## ship-captain · cierre (05:00–07:00)

Resuelto en esta pasada (todo lo pendiente de las tres secciones anteriores):
- **test-audio** (settings-audio-core 1 / screens-rest 11): aplicada la línea propuesta en `tools/test-audio.mjs`;
  `audio/manifest.json` regenerado (frases nuevas). Todas las `tools/test-*.mjs` en verde.
- **Frase final coherente** (screens-rest 3 / player-3d 5): `coach.js` elige por `completed`. Voz del sistema: grupo
  nuevo `finishPartial` («¡Buen trabajo! Hoy también suma.»…). Pack: grupo nuevo `finishpartial_1/2` en el guion
  (pendiente de grabar) con respaldo `finish_2` («¡Terminado! Hoy has sumado…»); si ninguno está grabado, calla
  antes que decir «¡Entrenamiento completado!» (nunca mezcla Eva con la voz del sistema).
- **music.js `keepSession`** (player-3d 4): con la opción, el motor solo sube la sesión a 'playback' y nunca la baja;
  el reproductor la crea con `keepSession: true` y devuelve él la sesión a 'auto' (la vigilancia a 1 Hz queda de red).
- **store.js** (player-3d 2): `persist()` devuelve false si falla y nuevo `lastPersistOk()`; el resumen ya no confirma
  «Cambios guardados» si no se guardó. **app.js** (player-3d 3): aviso de almacenamiento lleno como mucho 1/min.
- **settings.js** (player-3d 1): «Bajar tu música cuando hablo · Solo con «Mi música»… Quita el modo silencio»; mismo
  criterio en la descripción del modo «Mi música».
- **onboarding.js** (settings-audio-core 5): «Eva · Recomendada».
- Ya hechos por sus dueños y comprobados: VISUAL_DEFAULTS.theme, música de la preparación solo por sesión, campos
  `finishedEarly/skippedSec/skips/timeline`, renderNext «Escalón N», fondo del resumen.
- Se deja como está (opcional): mover `SETTINGS_CSS` a `css/screens-more.css`.
- **Versión 1.1.0** (`node tools/precache.mjs --bump minor`), README de publicación reescrito, `.gitignore` revisado.
- **Laboratorio**: `lab.record()` / `lab.plan()` en `tools/scene-lab.html`, subcarpetas en `tools/snap-server.mjs`,
  `drawDone()` (rótulo final) en `tools/hud-mock.js`. Capturas y vídeos finales en `docs/capturas/final/`.

Queda para el dueño: grabar con ElevenLabs los ~57 clips que faltan (incluidos `finishpartial_1/2`) y regrabar
`countdown_1`; las verificaciones que solo puede hacer un iPhone real (ver README y el resumen de la entrega).
- 07:00 · tras la pasada «motion graphics + director de cámara» de otro grupo (js/player/motion.js, css/motion.css,
  scene3d/director.js…): checks y pruebas en verde, precache regenerado (127 recursos), humo completo en el panel y en
  Chrome sin errores de consola, capturas 01–16 y vídeos rehechos con ese código. Arreglado `.mo-deck__zone`
  (line-height 1 + overflow hidden recortaba las tildes: «RAPIDO» → «RÁPIDO»). `visuals.captions: true` en store.
  `tools/hud-mock.js` dibuja ya la tira «Siguiente» y las 10 marcas de los últimos 10 s (vídeos fieles al HUD real).
