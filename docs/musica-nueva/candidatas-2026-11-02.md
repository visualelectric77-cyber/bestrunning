# Música nueva (2-nov-2026): dark techno melódico y trance oscuro

Búsqueda en Pixabay (8 + 12 búsquedas, unas 240 fichas leídas). **Filtro:** sin «AI generated» y sin Content ID.
De 238 fichas, 63 eran IA y 39 tenían Content ID; quedan 33 válidas, de las que salen estas 14 por estilo y duración.
Licencia de todas: [Pixabay Content License](https://pixabay.com/service/license-summary/) (uso gratis, comercial o no,
sin atribución obligatoria; el crédito «by Autor via Pixabay» va en el README). Ninguna lleva voz según sus etiquetas.

| # | Título | Artista | Dur. | Estilo | Tramo previsto | Ficha |
|---|---|---|---|---|---|---|
| 1 | Pulse | Michele303 | 5:53 | Uplifting / melodic trance | rápido | [456174](https://pixabay.com/music/edm-pulse-456174/) |
| 2 | The Dance of the Sun (Melodic Techno, 122 BPM) | Nemeti_Tivadar | 4:12 | Melodic techno | trote | [9601](https://pixabay.com/music/techno-trance-nemeti-tivadar-the-dance-of-the-sun-technodance-melodic-techno-122-bpm-24-bi%C8%9Bi-9601/) ✔ descargada |
| 3 | Celestial Groove | ECO-ART | 3:16 | Melodic techno | correr | [412391](https://pixabay.com/music/techno-trance-celestial-groove-412391/) |
| 4 | Way To Intergalactic | EygeR | 4:24 | Melodic techno / house | correr | [585371](https://pixabay.com/music/techno-trance-eyger-way-to-intergalactic-585371/) |
| 5 | Melodic Techno – EDM Music 001 | RibhavAgrawal | 3:16 | Melodic techno | correr | [290942](https://pixabay.com/music/dance-melodic-techno-edm-music-001-290942/) |
| 6 | BLACKWING | TwistedFox | 2:59 | Dark trance / witch house | correr | [180307](https://pixabay.com/music/techno-trance-blackwing-180307/) |
| 7 | Lonely Wolf – Dark Ravers | Argimirorobles | 6:10 | Dark trance / rave | rápido | [344755](https://pixabay.com/music/techno-trance-lonely-wolf-dark-ravers-344755/) |
| 8 | Illusional Techno | NicochicoOfficial | 3:38 | Dark hypnotic techno | correr | [596670](https://pixabay.com/music/techno-trance-nicochicoofficial-illusional-techno-596670/) |
| 9 | Echoes From Nowhere (Original Mix) | Dopetronic | 7:13 | Dark minimal / deep techno | correr | [321994](https://pixabay.com/music/techno-trance-dopetronic-echoes-from-nowhere-original-mix-gift-track-321994/) |
| 10 | Aliens In My Basement | Dopetronic | 7:05 | Dark / industrial techno | correr | [331356](https://pixabay.com/music/techno-trance-sample-pack-link-in-bio-dopetronic-aliens-in-my-basement-331356/) |
| 11 | Dark Groove – Dark Trance Mix | NaturesEye | 3:53 | Dark trance / psy | rápido | [163958](https://pixabay.com/music/techno-trance-dark-groove-dark-trance-mix-163958/) |
| 12 | Instrumental Hard Trance | hasenchat | 7:00 | Hard trance | rápido | [199097](https://pixabay.com/music/techno-trance-instrumental-hard-trance-199097/) |
| 13 | Distortion (Hard Trance) | Placidplace | 3:26 | Hard trance | rápido | [379046](https://pixabay.com/music/techno-trance-distortion-hard-trance-379046/) |
| 14 | Mørketid | ItsWatR | 4:02 | Dark progressive / deep | trote | [127881](https://pixabay.com/music/deep-house-m%C3%B8rketid-127881/) |

**Estado (2-nov-2026, 15:40): integradas 11.** Descargadas una a una desde la ficha (con el visto bueno del dueño),
normalizadas a −14 LUFS y analizadas con `nice -n 10 python3 tools/music/analyze.py --new`. Biblioteca: 83 pistas.

| Pista | BPM medido | Tramo |
|---|---|---|
| The Dance of the Sun | 122 (declarado 122) | trote |
| Mørketid | 125 | trote |
| Way To Intergalactic | 125 | trote |
| Distortion (Hard Trance) | 125 | trote (se eligió como rápido) |
| Aliens In My Basement | 127 | correr |
| Echoes From Nowhere | 127 | correr |
| Illusional Techno | 135 | rápido |
| Dark Groove – Dark Trance Mix | 135 | rápido |
| Pulse | 136 | rápido |
| Lonely Wolf – Dark Ravers | 138 | rápido |
| Instrumental Hard Trance | 145 | rápido (confianza baja, 2,98, como Pure Trance) |

**Fuera (quedan en el manifiesto con `reserve: true` y su nota):**
- *Celestial Groove* (ECO-ART) y *Melodic Techno – EDM Music 001* (RibhavAgrawal) son **la misma pista**: misma duración y
  correlación ~0,6 con desfase fijo durante toda la canción. Una es una resubida y no se sabe cuál es la original, así que
  no entra ninguna.
- *BLACKWING* (TwistedFox): mide 110 con confianza 4,7, pero la autocorrelación marca ~148 (relación 4:3). Tempo dudoso.
- *Space Rave* (NaturesEye, tanda del 25-oct) volvió a entrar porque `analyze.py --new` no saltaba las reservas. Arreglado:
  ahora las entradas con `reserve: true` no entran en la biblioteca.

Prueba de audio (clase local «Sprints 30/60», `?debug=music`): AudioContext *running*, coach hablando (agache 0,28) y
«Distortion (Hard Trance)» sonando en el trote a ×1,000, −15,8 dBFS, sin fallos de carga.

Descartadas: la serie «Melodic Techno 01–09» de vjgalaxy y casi todo lo reciente de «melodic techno» (marcadas IA);
Evgeny_Bardyuzha, Sound4Stock, Monume, Bransboynd, Sonican (Content ID); «Lost It (Techno Pop)» de EygeR (posible voz);
loops de menos de 2 min (tAUREON #04, DRAGON-STUDIO, van_Wiese).
