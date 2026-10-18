# Voces de BestRunning

Cómo habla el coach, cómo mejorar la voz del iPhone y cómo crear (opcionalmente) un pack de voz
profesional con ElevenLabs.

---

## 1. Cómo funciona hoy: la voz del sistema

El coach usa la **síntesis de voz de iOS** (Web Speech API, `speechSynthesis`). Ventajas: gratis,
funciona sin conexión y no ocupa nada en la app.

- La app elige sola la mejor voz en español: primero las de **España (es-ES)** y, dentro de ellas,
  las **Premium** y **Mejoradas** (Mónica, Marisol, Jorge…). Las voces "de broma" (Eddy, Flo, Abuela,
  Abuelo, Reed, Rocko, Sandy, Shelley) van al final.
- Puedes elegir otra en **Perfil → Voz y audio** (las mejores aparecen marcadas como *Mejorada* o
  *Premium*) y ajustar la velocidad de habla.
- Antes de hablar, el texto se normaliza para que suene natural: `11,5` → «once coma cinco»,
  `13,0` → «trece», `1 serie` → «una serie», `21 minutos` → «veintiún minutos»,
  `5:13` → «cinco minutos y trece segundos».

### Truco: descarga una voz mejorada (muy recomendable)

La voz básica que trae el iPhone suena algo metálica. La mejorada es otra cosa:

1. **Ajustes → Accesibilidad → Contenido leído → Voces → Español**.
2. En el grupo de **España**, toca **Mónica** y descarga **«Mónica (mejorada)»** (o la Premium, si
   aparece). También puedes usar **Jorge** si prefieres una voz masculina. Ocupa entre 100 y 400 MB:
   hazlo con wifi.
3. Cierra BestRunning del todo (desliza hacia arriba en el selector de apps) y vuelve a abrirla:
   iOS solo actualiza la lista de voces al arrancar.
4. **Perfil → Voz y audio → Voz** → elige «Mónica · Mejorada» y pulsa **Probar**.

### Música, pitidos y pantalla

- **«Bajar la música cuando hablo»**: la app pide a iOS una sesión de audio *transient*, así que
  Spotify o Apple Music bajan el volumen mientras habla el coach. Desactivado, la sesión es *ambient*
  y la voz se mezcla con la música sin bajarla.
- **Pitidos**: se sintetizan al momento con Web Audio (no son archivos). Tres «tic» a T−3, T−2 y T−1
  y un «¡ya!» más agudo en cada cambio de velocidad. Se oyen por encima de la música.
- **Interruptor de silencio**: con el iPhone en silencio, iOS puede silenciar pitidos y voz.
  Déjalo en sonido mientras entrenas.
- **Primer toque**: iOS solo deja sonar audio después de un gesto. Por eso el botón **Empezar**
  desbloquea el audio y la voz.
- **Pantalla encendida**: con la pantalla bloqueada iOS congela la web. La app pide mantener la
  pantalla encendida. Si aun así se bloquea, al volver el coach se recoloca en el punto correcto sin
  soltar una ráfaga de avisos atrasados: solo repite el cambio vigente.

### Niveles de charla (Perfil → Voz y audio)

| Nivel | Qué dice |
|---|---|
| **Mínimo** | Pre-avisos («En diez segundos, sube a 11,5»), cambios con pitidos y final. |
| **Normal** | Lo anterior + mitad de los bloques largos, «últimos treinta segundos», «¡diez segundos!» en sprints, mitad de la clase, último bloque, un consejo de técnica, respiración o cabeza cada 3–4 min e hidratación cada 15 min en sesiones de 45′ o más. |
| **Coach** | Lo anterior + el consejo propio de cada tramo, un consejo cada ~2 min y motivación en los tramos duros. |

Los cambios se avisan con la antelación de **Perfil → Cinta** (5, 10 o 15 s), porque la cinta tarda
unos segundos en cambiar de velocidad.

---

## 2. Packs de voz con ElevenLabs (opcional)

Un **pack** es una carpeta `audio/packs/<id>/` con un mp3 por cada fragmento de frase («clip») y un
`index.json`. El coach encadena los clips sin huecos («En», «diez segundos», «sube a», «once coma
cinco») con Web Audio. Si a una frase le falta algún clip (tu nombre, el título de una clase nueva o
el consejo libre de un tramo en modo coach), **esa frase se dice con la voz del sistema** y todo
sigue funcionando.

La lista de clips está en `audio/manifest.json`, que se genera con
`tools/build-audio-manifest.mjs` a partir de `js/audio/phrases.js`.

### Paso a paso

1. **Cuenta**: crea una cuenta en [elevenlabs.io](https://elevenlabs.io). Un pack completo son unos
   23 000 caracteres, así que basta con el plan **Starter** (30 000 créditos al mes). El plan
   gratuito puede no permitir usar por API las voces de la Voice Library.
2. **API key**: menú de tu perfil → **API Keys** → *Create API Key* (con permiso de *Text to Speech*).
   Cópiala y **no la subas nunca al repositorio**.
3. **Elige la voz**: **Voices → Voice Library**, filtra por idioma *Spanish* y acento de *España*,
   escucha varias y pulsa *Add to my voices*. En **My Voices**, menú ⋯ de la voz → *Copy voice ID*.
4. **Manifiesto** (en la carpeta del proyecto, con Node 22). Si quieres que el coach diga tu nombre
   con la voz del pack, añádelo como extra:

   ```sh
   node tools/build-audio-manifest.mjs --extra "Nacho"
   ```

   Si `js/training/templates.js` ya existe, los títulos de las clases se incluyen solos.
5. **Prueba barata** (20 clips) para escuchar la voz antes de gastar créditos:

   ```sh
   export ELEVENLABS_API_KEY=sk_xxxxxxxx
   node tools/generate-voices.mjs --pack laura --voice <VOICE_ID> --name "Laura" --limit 20
   ```

   Escucha los mp3 de `audio/packs/laura/`.
6. **Pack completo** (reanudable: solo genera lo que falta):

   ```sh
   node tools/generate-voices.mjs --pack laura --voice <VOICE_ID> --name "Laura" --only-missing
   ```

   Hace 3 peticiones en paralelo y reintenta solo ante errores 429 o 5xx. Si se corta, repite el
   mismo comando. `--dry-run` muestra cuántos clips y caracteres se generarían sin llamar a la API.
7. **Revisa** `audio/packs/laura/index.json` (lista de clips) y `audio/packs/packs.json` (el pack
   aparece con `count` y `complete: true`).
8. **Publica**:

   ```sh
   git add audio/manifest.json audio/packs/packs.json audio/packs/laura
   git commit -m "Pack de voz Laura"
   git push
   ```

   GitHub Pages lo publica en uno o dos minutos.
9. **Actívalo en el iPhone**: abre BestRunning (si aparece «Nueva versión disponible», tócalo) →
   **Perfil → Voz y audio → Pack de voz → Laura** → *Probar coach*. Cada clip se descarga la primera
   vez que se usa y queda en caché, así que después funciona sin conexión.
10. **Si cambian las frases** en una versión futura: repite los pasos 4 y 6 con `--only-missing`.
    Solo se generan los clips nuevos. Los antiguos que ya no se usan no molestan.

### Coste y tamaño (manifiesto actual)

| Concepto | Valor aproximado |
|---|---|
| Clips | 1084: 442 fragmentos de frase, 201 enteros, 37 formas «un/una» y «veintiún/veintiuna», 279 decimales (velocidades de 0,1 a 30,9), 124 duraciones y conector «y» |
| Caracteres | ≈ 22 700 (+ tu nombre y los títulos de las clases) |
| Créditos con `eleven_multilingual_v2` | ≈ 23 000 (1 crédito por carácter). Cabe en un mes de Starter. |
| Créditos con `--model eleven_flash_v2_5` | ≈ la mitad, con algo menos de calidad |
| Tamaño en el repositorio | ≈ 20–30 MB en mp3 a 128 kbps (unos 20 KB por clip). Con `--format mp3_44100_64` se queda en la mitad. |
| Descarga en el iPhone | Solo los clips que se usan: una sesión típica necesita 100–200 clips (≈ 2–4 MB) |

Los precios de ElevenLabs cambian: consulta [elevenlabs.io/pricing](https://elevenlabs.io/pricing).

### Detalles técnicos

- `audio/manifest.json`: `{ version, count, chars, titles, extras, clips: [{ id, text }] }`.
- Ids de clip estables:
  - `t_<hash>`: texto libre (fragmentos de frase, zonas, títulos, nombre). FNV-1a del texto en
    minúsculas, así que el mismo texto siempre da el mismo id.
  - `n_<k>`: entero de 0 a 200.
  - `nm_<k>` / `nf_<k>`: formas ante un sustantivo masculino o femenino («un», «veintiún», «una»…).
  - `d_<k>`: decimal k/10 entre 0,1 y 30,9 (los enteros usan `n_`).
  - `dm_<m>`, `ds_<s>`, `dh_<h>`: minutos, segundos y horas; `w_y`: «y».
- `audio/packs/<id>/index.json`:
  `{ id, name, voiceId, model, format, manifestVersion, createdAt, updatedAt, clips: [ids] }`.
- `audio/packs/packs.json`: `[{ id, name, voiceId, model, count, complete, sizeMB, updatedAt }]`
  (empieza como `[]`).
- Antes de sonar, el motor recorta el silencio inicial y final de cada mp3 y deja 50 ms entre clips.
- El service worker guarda `audio/packs/**` con cache-first en una caché aparte (`br-audio`).
- Tests: `node tools/test-audio.mjs` comprueba el banco de frases, los números en palabras, el
  programa de avisos en los tres niveles y que todos los clips existan en el manifiesto.
