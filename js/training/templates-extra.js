// BestRunning · catálogo ampliado para la temporada de 52 semanas (sin DOM, importable desde Node).
// templates.js llama a defineExtraTemplates(api) al final de su catálogo: así estas clases reutilizan el mismo marco
// (calentamiento progresivo, bloque principal ajustado al segundo, tope de sprint y vuelta a la calma) sin
// importaciones circulares. Cada plantilla declara el contrato de temporada: family, themes, intensity y durations.
// Solo usa los niveles del usuario a través del kit (k.J/k.R/k.F/k.S, calentamiento, calma y paso).

export function defineExtraTemplates({ T, frame, W, numberReps, choose, r5, round1, clamp, TH }) {
  const SHORT = [20, 30, 45];
  const QUICK = [20, 30];
  const MID = [30, 45, 60];
  const LONG = [45, 60];
  const ALL = [20, 30, 45, 60];
  /** Ajuste de velocidad según la carga de la semana. */
  const lo = (k, hi = 0.1, low = -0.2) => (k.L >= 1.1 ? hi : k.L < 0.85 ? low : 0);
  /** Repeticiones que caben: n·unidad + (n−1)·descanso ≤ presupuesto − reserva. */
  const fitN = (B, unit, rest, min, max, reserve = 60) => clamp(Math.floor((B - reserve + rest) / (unit + rest)), min, max);
  /** Subida: con inclinación, mismo esfuerzo que `flat` en llano; sin ella, se simula subiendo un poco la velocidad. */
  const up = (k, zone, flat, pct, sec, o = {}) => {
    if (k.hasIncline) {
      const s = k.hill(zone, flat, pct, sec, o);
      if (o.label) s.label = `${o.label} · ${s.incline} %`;
      return s;
    }
    return k.seg(zone, sec, { ...o, speed: round1(flat + 0.1 * pct), label: o.label || 'Subida simulada' });
  };
  const fmtKm = (v) => String(v).replace('.', ',');

  /* ═════════════ Intervalos ═════════════ */

  T({
    id: 'thirty-thirty', title: 'Treinta-treinta', subtitle: '30″ rápido · 30″ trote, por bloques', category: 'intervals',
    family: 'series-cortas', themes: [TH.velocidad, TH.explosividad], intensity: 'hard', durations: SHORT, focus: 'VO₂máx en dosis cortas',
    description: 'El formato favorito de los entrenadores de pista: treinta segundos vivos y treinta de trote, en bloques. El pulso sube y se mantiene alto sin que llegues a ahogarte.',
    coachNotes: ['Los treinta rápidos no son un sprint: un ritmo alegre que puedas repetir.', 'En el trote no te pares: la cinta ya baja lo suficiente.', 'Entre bloques, respira hondo y suelta los brazos.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const per = k.rng.pick([5, 6, 8]);
      const gap = k.rng.pick([120, 150]);
      const off = round1((k.S - k.F) * k.rng.pick([0.3, 0.5]));
      let sets = clamp(Math.floor((B - 60 + gap) / (per * 60 - 30 + gap)), 1, 4);
      if (k.L < 0.85 && sets > 1) sets--;
      const out = [k.flex()];
      for (let s = 0; s < sets; s++) {
        const block = `Bloque ${s + 1}`;
        for (let i = 0; i < per; i++) {
          const cue = s === 0 && i === 0 ? k.cue('first') : s === sets - 1 && i === per - 1 ? k.cue('last') : i === 2 ? k.cue('fast') : '';
          out.push(W(k.fast(30, { off, label: 'Treinta rápidos', block, cue })));
          if (i < per - 1) out.push(k.jog(30, { off: -0.3, label: 'Treinta de trote', block }));
        }
        if (s < sets - 1) out.push(k.jog(gap, { label: 'Pausa entre bloques', block: 'Recuperación', cue: k.cue('recovery') }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'micro-45', title: 'Micro series 45/45', subtitle: '45″ rápido · trote, cada bloque un poco más rápido', category: 'intervals',
    family: 'series-cortas', themes: [TH.velocidad, TH.ritmo], intensity: 'hard', durations: SHORT, focus: 'Velocidad aeróbica',
    description: 'Bloques de micro series de 45 segundos. Cada bloque nuevo sube dos décimas: empiezas cómodo y acabas rozando tu techo sin darte cuenta.',
    coachNotes: ['El primer bloque es de rodaje de piernas: no te pases.', 'Cuando suba la velocidad, sube la cadencia antes que la zancada.', 'Recupera con trote suave y hombros caídos.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const per = k.rng.pick([4, 5]);
      const rest = k.L >= 1.1 ? 45 : k.L < 0.85 ? 75 : 60;
      const gap = k.rng.pick([90, 120]);
      const sets = clamp(Math.floor((B - 60 + gap) / (per * 45 + (per - 1) * rest + gap)), 1, 5);
      const out = [k.flex()];
      for (let s = 0; s < sets; s++) {
        const off = Math.min(0.6, round1(-0.2 + 0.2 * s));
        for (let i = 0; i < per; i++) {
          out.push(W(k.fast(45, { off, label: 'Micro serie', block: `Bloque ${s + 1}`, cue: i === 0 ? (s === 0 ? k.cue('first') : 'Nuevo bloque: dos décimas más') : '' })));
          if (i < per - 1) out.push(k.rec(rest, { block: `Bloque ${s + 1}` }));
        }
        if (s < sets - 1) out.push(k.jog(gap, { label: 'Trote entre bloques', block: 'Recuperación', cue: k.cue('recovery') }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'sprint-clusters', title: 'Racimos de sprints', subtitle: '2–3 sprints juntos y pausa larga', category: 'intervals',
    family: 'series-cortas', themes: [TH.explosividad, TH.velocidad], intensity: 'hard', durations: SHORT, focus: 'Potencia repetida',
    description: 'Los sprints llegan en racimos de dos o tres con poco trote entre ellos, y después una pausa larga de verdad. Entrenas a repetir potencia cuando aún no te has recuperado del todo.',
    coachNotes: ['Dentro del racimo no hay tiempo para pensar: brazos rápidos y a por el siguiente.', 'La pausa larga es para llegar fresco al próximo racimo.', 'Si pierdes la técnica, mejor un sprint menos que uno feo.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const c = k.rng.pick([2, 3]);
      const inner = k.rng.pick([45, 60]);
      const gap = r5(clamp(165 / k.L, 120, 210));
      const maxSpr = Math.max(c, Math.floor((0.24 * B) / 30));
      const lenC = (m) => m * (c * 30 + (c - 1) * inner) + (m - 1) * gap;
      let m = 1;
      while (m < 6 && lenC(m + 1) <= B - 60 && (m + 1) * c <= maxSpr) m++;
      const out = [k.flex()];
      for (let j = 0; j < m; j++) {
        const block = `Racimo ${j + 1}`;
        for (let i = 0; i < c; i++) {
          out.push(W(k.sprint(30, { off: i === c - 1 ? 0.2 : 0, label: i === c - 1 ? 'Último del racimo' : 'Sprint', block,
            cue: j === 0 && i === 0 ? k.cue('first') : i === c - 1 ? k.cue('last') : k.cue('sprint') })));
          if (i < c - 1) out.push(k.rec(inner, { off: -0.3, block }));
        }
        if (j < m - 1) out.push(k.jog(gap, { label: 'Pausa larga', block: 'Recuperación', cue: k.cue('recovery') }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'flying-sprints', title: 'Salidas lanzadas', subtitle: 'Lanzadera a ritmo de correr y sprint lanzado', category: 'intervals',
    family: 'series-cortas', themes: [TH.explosividad, TH.tecnica], intensity: 'hard', durations: SHORT, focus: 'Velocidad punta con técnica',
    description: 'Cada sprint llega lanzado: primero una lanzadera a ritmo vivo para coger cadencia y, sin parar, treinta segundos a tope. Es la forma más limpia de correr rápido.',
    coachNotes: ['En la lanzadera sube la cadencia poco a poco: el sprint llega solo.', 'Cuando la cinta acelere, cuerpo alto y brazos rápidos.', 'Recupera trotando hasta respirar tranquilo.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const lan = k.rng.pick([45, 60, 75]);
      const rest = r5(clamp(90 / k.L, 75, 120));
      const n = Math.min(fitN(B, lan + 30, rest, 3, 10), Math.max(3, Math.floor((0.24 * B) / 30)));
      const out = [k.flex()];
      for (let i = 0; i < n; i++) {
        const block = `Salida ${i + 1}`;
        out.push(k.run(lan, { off: 0.4, label: 'Lanzadera', block, cue: i === 0 ? 'Sube la cadencia poco a poco: el sprint llega lanzado' : '' }));
        out.push(W(k.sprint(30, { label: 'Sprint lanzado', block, cue: i === n - 1 ? k.cue('last') : k.cue('sprint') })));
        if (i < n - 1) out.push(k.rec(rest, { off: -0.3 }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'norwegian-4x4', title: '4×4 noruego', subtitle: '4 × 4′ fuertes con 3′ de trote activo', category: 'intervals',
    family: 'series-largas', themes: [TH.velocidad, TH.resistencia], intensity: 'hard', durations: ALL, focus: 'Corazón y VO₂máx',
    description: 'El protocolo noruego que más se estudia para la salud del corazón: cuatro minutos fuertes, tres de trote activo. En los días cortos se adapta a series de tres minutos.',
    coachNotes: ['Fuerte pero sostenible: al final de cada serie deberías poder hacer una más.', 'En el trote activo el pulso baja, pero no te pares.', 'Con el reloj, busca la zona 4 de pulso en el último minuto de cada serie.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const opts = [];
      for (const w of k.long ? [240] : [180, 240]) for (const r of [120, 150, 180]) for (let n = 2; n <= 4; n++) if (r >= w / 2) opts.push({ w, r, n });
      const o = choose(k, opts, (x) => x.n * x.w + (x.n - 1) * x.r, B, 60);
      const v = round1(k.between(0.75) + lo(k));
      const out = [k.flex({ label: k.long ? 'Rodaje Z2' : 'Trote de transición' })];
      for (let i = 0; i < o.n; i++) {
        out.push(W(k.at(v, o.w, { zone: 'fast', label: o.w === 240 ? 'Cuatro minutos fuertes' : 'Tres minutos fuertes', block: 'Series noruegas',
          cue: i === 0 ? k.cue('first') : i === o.n - 1 ? k.cue('last') : k.cue('mind') })));
        if (i < o.n - 1) out.push(k.jog(o.r, { off: 0.2, label: 'Recuperación activa', block: 'Recuperación', cue: i === 0 ? 'Trote activo: el pulso baja, pero no te pares' : '' }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'three-min-repeats', title: 'Series de 3 minutos', subtitle: '3′ a ritmo rápido con trote corto', category: 'intervals',
    family: 'series-largas', themes: [TH.ritmo, TH.velocidad], intensity: 'hard', durations: ALL, focus: 'Ritmo rápido sostenido',
    description: 'Tres minutos es la distancia justa para que el ritmo rápido se vuelva tuyo. Unos días van iguales, otros en progresión y otros alternando controladas y valientes.',
    coachNotes: ['El primer minuto de cada serie engaña: parece fácil.', 'Respira en 2-2 y mantén la pisada bajo la cadera.', 'El trote es corto a propósito: aprovéchalo bien.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const rest = r5(clamp(105 / k.L, 75, 150));
      const style = k.rng.pick(['steady', 'build', 'alt']);
      const n = fitN(B, 180, rest, 2, 8);
      const out = [k.flex()];
      for (let i = 0; i < n; i++) {
        const off = style === 'build' ? Math.min(0.2, round1(-0.4 + 0.15 * i)) : style === 'alt' ? (i % 2 ? 0 : -0.4) : -0.2;
        out.push(W(k.fast(180, { off, label: style === 'alt' && i % 2 === 0 ? 'Tres minutos controlados' : 'Tres minutos', block: 'Series',
          cue: i === 0 ? k.cue('first') : i === n - 1 ? k.cue('last') : k.cue('fast') })));
        if (i < n - 1) out.push(k.rec(rest));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'cut-down', title: 'Cut-down', subtitle: 'Cuatro tramos sin parar, cada uno más corto y más rápido', category: 'tempo',
    family: 'progresivo', themes: [TH.ritmo, TH.escaleras], intensity: 'hard', durations: ALL, focus: 'Acelerar con fatiga',
    description: 'Un bloque continuo en el que cada tramo dura menos y va más rápido, sin trote entre medias. Terminas el bloque más rápido de lo que lo empezaste: la esencia de correr bien.',
    coachNotes: ['El tramo largo es el más lento: tranquilo, no te adelantes.', 'Cada cambio es pequeño: déjate llevar por la cinta.', 'El último minuto se corre con la cabeza alta.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const scale = k.rng.pick([1, 0.75]);
      const names = scale < 1 ? ['Tramo de 3′', 'Tramo de 2′15', 'Tramo de 1′30', 'Tramo de 45″'] : ['Cuatro minutos', 'Tres minutos', 'Dos minutos', 'Un minuto'];
      const parts = [[240, 'run', -0.2], [180, 'run', 0.3], [120, 'fast', -0.2], [60, 'fast', 0.3]].map(([s, z, o], i) => [r5(s * scale), z, o, names[i]]);
      const setLen = parts.reduce((a, p) => a + p[0], 0);
      const gap = 180;
      const sets = clamp(Math.floor((B - 60 + gap) / (setLen + gap)), 1, 3);
      const bump = lo(k);
      const out = [k.flex()];
      for (let s = 0; s < sets; s++) {
        parts.forEach(([sec, zone, off, label], j) => {
          out.push(k.seg(zone, sec, { off: round1(off + bump), label, block: `Cut-down ${s + 1}`, rep: { i: s + 1, n: sets },
            cue: j === 0 ? (s === 0 ? k.cue('tempo') : k.cue('mind')) : j === 3 ? k.cue('last') : '' }));
        });
        if (s < sets - 1) out.push(k.jog(gap, { label: 'Trote entre bloques', block: 'Recuperación', cue: k.cue('recovery') }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return out;
    }),
  });

  T({
    id: 'long-short', title: 'Largas y cortas', subtitle: 'Una serie larga y una corta, por parejas', category: 'intervals',
    family: 'series-largas', themes: [TH.mixto, TH.velocidad], intensity: 'hard', durations: ALL, focus: 'Ritmo y chispa',
    description: 'Cada pareja junta una serie larga a ritmo rápido controlado con una corta y viva. Entrenas a la vez la resistencia a la velocidad y la chispa.',
    coachNotes: ['La larga se corre con paciencia; la corta, con alegría.', 'No conviertas la corta en un sprint: rápida y suelta.', 'Recupera trotando y piensa solo en la siguiente pareja.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const L1 = k.rng.pick([120, 150, 180]);
      const S1 = k.rng.pick([30, 45]);
      const r1 = r5(clamp(90 / k.L, 60, 120));
      const r2 = r5(clamp(75 / k.L, 45, 105));
      const n = clamp(Math.floor((B - 60 + r2) / (L1 + r1 + S1 + r2)), 1, 6);
      const out = [k.flex()];
      for (let i = 0; i < n; i++) {
        const block = `Pareja ${i + 1}`;
        out.push(W(k.fast(L1, { off: -0.3, label: 'Larga', block, cue: i === 0 ? k.cue('first') : k.cue('mind') })));
        out.push(k.rec(r1));
        out.push(W(k.fast(S1, { off: round1((k.S - k.F) * 0.5), label: 'Corta y viva', block, cue: i === n - 1 ? k.cue('last') : k.cue('fast') })));
        if (i < n - 1) out.push(k.rec(r2));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'pyramid-inverted', title: 'Pirámide invertida', subtitle: 'Largo · corto · sprint… y vuelta a alargar', category: 'intervals',
    family: 'piramide', themes: [TH.escaleras, TH.velocidad], intensity: 'hard', durations: ALL, focus: 'Cambios de ritmo',
    description: 'La pirámide puesta del revés: empiezas con los tramos largos y firmes, bajas hasta un sprint corto y vuelves a subir. La segunda mitad pone a prueba tu cabeza.',
    coachNotes: ['Los tramos largos van a ritmo firme, no a tope.', 'En el vértice, treinta segundos de valentía.', 'Al volver a alargar, mantén la técnica aunque cueste.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const sp = (d) => (d >= 240 ? [k.between(0.35), 'run'] : d >= 180 ? [k.between(0.6), 'run'] : d >= 120 ? [k.F - 0.1, 'fast']
        : d >= 90 ? [k.F + 0.1, 'fast'] : d >= 60 ? [k.F + 0.3, 'fast'] : [k.S, 'sprint']);
      const restOf = (d) => r5(clamp((d * 0.5 + 30) / k.L, 45, 120));
      const shapes = [[120, 60, 30, 60, 120], [180, 90, 30, 90, 180], [180, 120, 60, 30, 60, 120, 180], [240, 180, 120, 60, 30, 60, 120, 180, 240]];
      const len = (st) => st.reduce((a, d, i) => a + d + (i < st.length - 1 ? restOf(d) : 0), 0);
      const st = choose(k, shapes, len, B, 60);
      const out = [k.flex()];
      st.forEach((d, i) => {
        const [v, zone] = sp(d);
        out.push(W(k.at(round1(v), d, { zone, label: d === 30 ? 'Vértice · sprint' : `${d >= 60 ? `${d / 60}′`.replace('.5′', '′30') : `${d}″`}`, block: 'Pirámide invertida',
          cue: i === 0 ? k.cue('first') : d === 30 ? k.cue('sprint') : i === st.length - 1 ? k.cue('last') : '' })));
        if (i < st.length - 1) out.push(k.rec(restOf(d)));
      });
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'speed-pyramid', title: 'Pirámide de velocidad', subtitle: 'Mismo tiempo, velocidad que sube y baja', category: 'intervals',
    family: 'piramide', themes: [TH.escaleras, TH.velocidad], intensity: 'hard', durations: ALL, focus: 'Escala de velocidades',
    description: 'Aquí la pirámide no la dibuja el reloj sino la velocidad: todas las series duran lo mismo y cada una va un poco más rápida hasta la cima. Luego, bajada peldaño a peldaño.',
    coachNotes: ['Fíjate en cómo cambia la sensación con solo unas décimas.', 'En la cima, técnica impecable: es el peldaño más rápido.', 'En la bajada, disfruta: cada serie se hace más fácil.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const dur = k.rng.pick([60, 75]);
      const rest = r5(clamp(60 / k.L, 45, 90));
      const step = k.rng.pick([0.2, 0.3]);
      const maxSteps = fitN(B, dur, rest, 3, 11);
      const upN = clamp(Math.floor((maxSteps + 1) / 2), 2, 6);
      const peak = round1(k.F + 0.4 + lo(k));
      const seq = [];
      for (let j = upN - 1; j > 0; j--) seq.push(j);
      seq.push(0);
      for (let j = 1; j < upN; j++) seq.push(j);
      const out = [k.flex()];
      seq.forEach((j, i) => {
        const v = round1(peak - step * j);
        out.push(W(k.at(v, dur, { zone: v >= k.F - 0.3 ? 'fast' : 'run', label: j === 0 ? `Cima · ${fmtKm(k.spd(v))} km/h` : `Peldaño ${fmtKm(k.spd(v))} km/h`,
          block: i < upN ? 'Subida' : 'Bajada', cue: i === 0 ? k.cue('first') : j === 0 ? k.cue('mind') : i === upN ? 'Bajas un peldaño: corre bonito' : '' })));
        if (i < seq.length - 1) out.push(k.rec(rest));
      });
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'ladder-down', title: 'Escalera descendente', subtitle: 'Sprint → rápido → correr, bajando marchas', category: 'intervals',
    family: 'escalera', themes: [TH.escaleras, TH.explosividad], intensity: 'hard', durations: ALL, focus: 'Correr relajado tras el esfuerzo',
    description: 'Empiezas cada escalera arriba del todo, con un sprint, y vas bajando marchas sin parar. Aprendes a seguir corriendo bonito cuando las piernas ya arden.',
    coachNotes: ['El sprint inicial abre la escalera: entra con decisión.', 'Al bajar a rápido, suelta hombros y respira.', 'El último peldaño, a ritmo de correr, se corre con la cabeza.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const a = k.rng.pick([30, 45]);
      const b = k.rng.pick([60, 90]);
      const c = k.rng.pick([90, 120]);
      const rest = r5(clamp(120 / k.L, 90, 180));
      const n = fitN(B, a + b + c, rest, 1, 6);
      const out = [k.flex()];
      for (let i = 0; i < n; i++) {
        const block = `Escalera ${i + 1}`;
        const rep = { i: i + 1, n };
        out.push(k.sprint(a, { label: 'Arriba · sprint', block, rep, cue: i === 0 ? k.cue('first') : k.cue('sprint') }));
        out.push(k.fast(b, { label: 'Bajas a rápido', block, rep, cue: k.cue('fast') }));
        out.push(k.run(c, { off: 0.2, label: 'Bajas a correr', block, rep, cue: i === n - 1 ? k.cue('last') : '' }));
        if (i < n - 1) out.push(k.rec(rest, { label: 'Trote de recuperación' }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return out;
    }, { quality: true }),
  });

  T({
    id: 'speed-record', title: 'Velocidad punta', subtitle: 'Sprints de 30″ cada vez un poco más rápidos', category: 'intervals',
    family: 'series-cortas', themes: [TH.records, TH.explosividad], intensity: 'hard', durations: SHORT, focus: 'Subir tu techo',
    description: 'Sprints de treinta segundos con recuperación completa. Cada uno arranca un par de décimas por encima del anterior: el último es tu récord de velocidad del día.',
    coachNotes: ['Recupera del todo: aquí manda la calidad.', 'Si un sprint se descompone, repite esa velocidad en el siguiente.', 'Cuerpo alto, brazos rápidos y pisada corta.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const rest = r5(clamp(105 / k.L, 90, 150));
      const step = k.rng.pick([0.2, 0.3]);
      const n = Math.min(fitN(B, 30, rest, 3, 7), Math.max(3, Math.floor((0.24 * B) / 30)));
      const start = k.rng.pick([-0.6, -0.4]);
      const out = [k.flex()];
      for (let i = 0; i < n; i++) {
        const off = Math.min(0.8, round1(start + step * i));
        out.push(W(k.sprint(30, { off, label: i === n - 1 ? 'Sprint récord' : `Punta · ${fmtKm(k.spd(k.S + off))} km/h`, block: 'Velocidad punta',
          cue: i === 0 ? k.cue('first') : i === n - 1 ? k.cue('last') : k.cue('sprint') })));
        if (i < n - 1) out.push(k.rec(rest, { off: -0.3 }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'power-then-steady', title: 'Potencia y fondo', subtitle: 'Sprints al principio y un bloque largo a ritmo', category: 'intervals',
    family: 'series-cortas', themes: [TH.explosividad, TH.resistencia], intensity: 'hard', durations: MID, focus: 'Potencia y resistencia',
    description: 'Primero despiertas las fibras rápidas con unos sprints frescos y después corres un bloque largo a ritmo. Potencia y fondo en la misma sesión, en el orden correcto.',
    coachNotes: ['Los sprints se corren frescos: calidad antes que cantidad.', 'En el bloque largo busca un ritmo que puedas hablar a medias.', 'Hidrátate en la transición.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const m = k.long ? k.rng.pick([5, 6]) : 4;
      const rest = r5(clamp(90 / k.L, 75, 120));
      const out = [k.flex({ label: 'Trote suave' })];
      for (let i = 0; i < m; i++) {
        out.push(W(k.sprint(30, { label: 'Sprint fresco', block: 'Potencia', cue: i === 0 ? k.cue('first') : i === m - 1 ? k.cue('last') : '' })));
        out.push(i < m - 1 ? k.rec(rest, { off: -0.3 }) : k.jog(150, { label: 'Transición al fondo', block: 'Recuperación', cue: 'Respira: ahora toca ritmo largo' }));
      }
      const used = m * 30 + (m - 1) * rest + 150;
      const steady = r5(clamp((B - used) * 0.6 * k.L, 300, 1800));
      const off = round1(-0.3 + lo(k, 0.1, -0.1));
      if (steady > 900) {
        out.push(k.run(r5(steady / 2), { off, label: 'Fondo a ritmo', block: 'Fondo', cue: k.cue('tempo') }));
        out.push(k.run(steady - r5(steady / 2), { off: round1(off + 0.1), label: 'Fondo · segunda mitad', block: 'Fondo', cue: k.cue('mind') }));
      } else out.push(k.run(steady, { off, label: 'Fondo a ritmo', block: 'Fondo', cue: k.cue('tempo') }));
      out.push(k.flex({ label: 'Rodaje final' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'km-ladder', title: 'Escalera de distancias', subtitle: '400 · 800 · 1200 m… como en la pista', category: 'intervals',
    family: 'escalera', themes: [TH.escaleras, TH.ritmo], intensity: 'hard', durations: ALL, focus: 'Ritmo según la distancia',
    description: 'Series medidas en metros que se alargan peldaño a peldaño. Cuanto más larga la distancia, un poco más suave el ritmo: aprendes a repartir el esfuerzo como un corredor de pista.',
    coachNotes: ['Mira la distancia en la cinta: cada serie es una meta concreta.', 'Las largas van un pelín más lentas: no te pases.', 'Recupera trotando lo que te pida cada peldaño.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const shapes = k.long ? [[400, 800, 1200, 800, 400], [400, 800, 1200, 1600], [600, 1000, 1400, 1000, 600], [800, 1200, 1600, 800]]
        : [[400, 800, 400], [400, 600, 800], [600, 800, 600], [400, 800, 1200]];
      const vOf = (d) => Math.max(k.R + 0.4, round1(k.F + 0.3 - 0.25 * (d / 400 - 1) + lo(k)));
      const secOf = (d) => r5((d / 1000 / vOf(d)) * 3600);
      const restOf = (d) => r5(clamp(((d / 400) * 45) / k.L, 60, 180));
      const len = (st) => st.reduce((a, d, i) => a + secOf(d) + (i < st.length - 1 ? restOf(d) : 0), 0);
      const st = choose(k, shapes, len, B, 60);
      const out = [k.flex()];
      st.forEach((d, i) => {
        const sec = secOf(d);
        out.push(W(k.at(vOf(d), sec, { zone: sec > 420 ? 'run' : 'fast', label: `Serie de ${d} m`, block: 'Escalera de distancias',
          cue: i === 0 ? k.cue('first') : i === st.length - 1 ? k.cue('last') : k.cue('fast') })));
        if (i < st.length - 1) out.push(k.rec(restOf(d)));
      });
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'ramp-30', title: 'Rampa de 30 segundos', subtitle: 'Cada 30″ una marcha más, hasta el sprint', category: 'intervals',
    family: 'escalera', themes: [TH.escaleras, TH.explosividad], intensity: 'hard', durations: SHORT, focus: 'Aceleración progresiva',
    description: 'Una rampa continua en la que la cinta sube de marcha cada treinta segundos: trote vivo, correr, rápido y, arriba del todo, sprint. Tres minutos que se pasan volando.',
    coachNotes: ['Cada cambio de marcha: primero cadencia, luego zancada.', 'Los dos últimos escalones son cortos: entrégate.', 'Después, trote largo para volver a empezar fresco.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const all = [[k.J + 0.6, 'jog', 'Trote vivo'], [k.R, 'run', 'Correr'], [k.R + 0.6, 'run', 'Correr alegre'], [k.F, 'fast', 'Rápido'],
        [k.F + 0.5, 'fast', 'Rápido +'], [k.S, 'sprint', 'Sprint']];
      const steps = all.slice(all.length - k.rng.pick([5, 6]));
      const rest = r5(clamp(120 / k.L, 90, 150));
      const n = fitN(B, steps.length * 30, rest, 2, 8);
      const out = [k.flex()];
      for (let i = 0; i < n; i++) {
        steps.forEach(([v, zone, label], j) => out.push(k.at(round1(v), 30, { zone, label, block: `Rampa ${i + 1}`, rep: { i: i + 1, n },
          cue: j === 0 ? (i === 0 ? k.cue('first') : '') : j === steps.length - 1 ? (i === n - 1 ? k.cue('last') : k.cue('sprint')) : '' })));
        if (i < n - 1) out.push(k.rec(rest, { off: -0.3, cue: i === 0 ? k.cue('recovery') : '' }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return out;
    }, { quality: true }),
  });

  T({
    id: 'shrinking-rest', title: 'Descanso menguante', subtitle: 'Mismas series, cada vez menos trote', category: 'intervals',
    family: 'series-cortas', themes: [TH.velocidad, TH.records], intensity: 'hard', durations: SHORT, focus: 'Densidad y tolerancia',
    description: 'Las series no cambian, lo que cambia es el descanso: cada recuperación dura quince segundos menos que la anterior. Al final, las series casi se tocan.',
    coachNotes: ['Las primeras parecen un regalo: guárdate fuerzas.', 'Cuando el descanso se acorte, respira profundo desde la barriga.', 'Mantén la misma velocidad hasta la última.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const work = k.rng.pick([45, 60]);
      const start = r5(clamp(120 / k.L, 90, 150));
      const dec = k.rng.pick([15, 20]);
      const out = [k.flex()];
      let left = B - 60 - work;
      let rest = start;
      let n = 1;
      while (n < 12) {
        const r = Math.max(30, r5(rest));
        if (r + work > left) break;
        left -= r + work;
        rest -= dec;
        n++;
      }
      rest = start;
      for (let i = 0; i < n; i++) {
        out.push(W(k.fast(work, { off: i === n - 1 ? 0.2 : 0, label: 'Serie', block: 'Series', cue: i === 0 ? k.cue('first') : i === n - 1 ? k.cue('last') : i % 2 ? k.cue('fast') : '' })));
        if (i < n - 1) {
          const r = Math.max(30, r5(rest));
          out.push(k.rec(r, { label: `Descanso de ${r}″`, cue: r <= 45 ? k.cue('mind') : '' }));
          rest -= dec;
        }
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'hr-recovery', title: 'Baja pulsaciones', subtitle: 'Series rápidas y recuperación caminando', category: 'intervals',
    family: 'series-largas', themes: [TH.mixto, TH.velocidad], intensity: 'hard', durations: ALL, focus: 'Recuperación del corazón',
    description: 'Tras cada serie rápida caminas un minuto y miras cómo baja el pulso. Cuanto antes baja, más en forma está tu corazón: aquí lo entrenas y lo ves mejorar semana a semana.',
    coachNotes: ['Al caminar, mira el reloj: anota cuánto baja el pulso en un minuto.', 'Vuelve a trotar con suavidad antes de la siguiente serie.', 'Las series son firmes, no a tope.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const work = k.rng.pick([90, 120]);
      const walk = 60;
      const jog = k.rng.pick([30, 60]);
      const n = fitN(B, work, walk + jog, 2, 8);
      const out = [k.flex()];
      for (let i = 0; i < n; i++) {
        out.push(W(k.fast(work, { off: round1(-0.1 + lo(k)), label: 'Serie firme', block: 'Series', cue: i === 0 ? k.cue('first') : i === n - 1 ? k.cue('last') : k.cue('fast') })));
        if (i < n - 1) {
          out.push(k.walkSeg(walk, { label: 'Camina y mira el pulso', block: 'Recuperación', cue: i === 0 ? 'Mira el reloj: cuanto antes baja el pulso, más sano está tu corazón' : '' }));
          out.push(k.jog(jog, { off: -0.4, label: 'Vuelve a trotar', block: 'Recuperación' }));
        }
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  /* ═════════════ Tempo ═════════════ */

  T({
    id: 'pyramid-tempo', title: 'Pirámide de tempo', subtitle: '2′ · 4′ · 6′… a ritmo firme y vuelta', category: 'tempo',
    family: 'piramide', themes: [TH.escaleras, TH.ritmo], intensity: 'moderate', durations: ALL, focus: 'Umbral aeróbico',
    description: 'Una pirámide de bloques de tempo: los cortos un poco más vivos, los largos más templados. Sin sprints ni sufrimiento extremo, pero con mucho trabajo de calidad.',
    coachNotes: ['Ritmo cómodamente duro: frases cortas, no conversación.', 'En la cima piensa en el minuto que corres, no en los que faltan.', 'Recupera trotando suave: un minuto basta.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const shapes = k.long ? [[3, 5, 7, 5, 3], [4, 6, 8, 6, 4], [2, 4, 6, 8, 6, 4, 2], [3, 6, 9, 6, 3]]
        : [[2, 4, 2], [2, 3, 4, 3, 2], [3, 5, 3], [2, 4, 6, 4, 2]];
      const rest = r5(clamp(75 / k.L, 60, 120));
      const len = (st) => st.reduce((a, m) => a + m * 60, 0) + rest * (st.length - 1);
      const st = choose(k, shapes, len, B, 60);
      const peak = Math.max(...st);
      const out = [k.flex()];
      st.forEach((m, i) => {
        const v = round1(k.R + (m <= 2 ? 0.5 : m <= 4 ? 0.35 : m <= 6 ? 0.2 : 0.05) + lo(k));
        out.push(W(k.at(v, m * 60, { zone: 'run', label: m === peak ? `Cima · ${m} min` : `${m} min de tempo`, block: 'Pirámide de tempo',
          cue: i === 0 ? k.cue('tempo') : m === peak ? k.cue('mind') : i === st.length - 1 ? k.cue('last') : '' })));
        if (i < st.length - 1) out.push(k.rec(rest));
      });
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }),
  });

  T({
    id: 'stairs-landing', title: 'Escalera con descansillos', subtitle: 'Tres peldaños, un descansillo y otro tramo más alto', category: 'tempo',
    family: 'escalera', themes: [TH.escaleras, TH.ritmo], intensity: 'moderate', durations: ALL, focus: 'Ritmo progresivo por tramos',
    description: 'Subes tres peldaños de ritmo, descansas un minuto en el descansillo y el siguiente tramo empieza un poco más arriba. Al final estás corriendo a un ritmo que al principio parecía lejos.',
    coachNotes: ['Cada peldaño sube poco: siente el cambio sin forzar.', 'El descansillo es trote suave, no parada.', 'El último tramo es el más alto: técnica antes que velocidad.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const step = k.rng.pick([90, 120]);
      const land = 60;
      const flights = fitN(B, 3 * step, land, 1, 5);
      const out = [k.flex()];
      for (let f = 0; f < flights; f++) {
        const base = round1(k.R - 0.6 + 0.2 * f + lo(k));
        [0, 0.3, 0.6].forEach((d, j) => out.push(k.at(round1(base + d), step, { zone: 'run', label: `Tramo ${f + 1} · peldaño ${j + 1}`, block: `Tramo ${f + 1}`,
          rep: { i: f + 1, n: flights }, cue: j === 0 ? (f === 0 ? k.cue('tempo') : 'Nuevo tramo: empieza un poco más arriba') : j === 2 ? k.cue('mind') : '' })));
        if (f < flights - 1) out.push(k.jog(land, { label: 'Descansillo', block: 'Descansillo', cue: f === 0 ? k.cue('recovery') : '' }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return out;
    }),
  });

  T({
    id: 'tempo-sparks', title: 'Tempo con chispas', subtitle: 'Ritmo firme con un cambio vivo cada pocos minutos', category: 'tempo',
    family: 'tempo', themes: [TH.ritmo, TH.explosividad], intensity: 'moderate', durations: ALL, focus: 'Umbral con cambios',
    description: 'Un tempo firme salpicado de chispas de ritmo rápido. Después de cada chispa vuelves al tempo, que es lo que de verdad entrena: recuperar sin bajar el ritmo.',
    coachNotes: ['Tras cada chispa, vuelve al tempo respirando hondo.', 'La chispa es corta: acelera con la cadencia.', 'Si el tempo se hace largo, cuenta chispas, no minutos.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const every = k.rng.pick([150, 180, 210]);
      const spark = k.rng.pick([30, 45]);
      const tOff = k.rng.pick([0.1, 0.2, 0.3]);
      const tot = r5(clamp(B * (k.long ? 0.6 : 0.75) * k.L, 480, 2400));
      const blocks = k.long && tot > 1200 ? 2 : 1;
      const out = [k.flex()];
      for (let b = 0; b < blocks; b++) {
        const block = blocks > 1 ? `Tempo ${b + 1}` : 'Tempo';
        if (b) out.push(k.jog(180, { label: 'Trote entre bloques', block: 'Recuperación', cue: k.cue('recovery') }));
        let left = r5(tot / blocks);
        let first = true;
        while (left >= every + spark + 30) {
          out.push(k.run(every, { off: tOff, label: 'Tempo', block, cue: first ? k.cue('tempo') : '' }));
          out.push(W(k.fast(spark, { off: 0.3, label: 'Chispa', block, cue: first ? 'Chispa: acelera con la cadencia y vuelve' : '' })));
          left -= every + spark;
          first = false;
        }
        if (left >= 30) out.push(k.run(left, { off: tOff, label: 'Tempo final', block, cue: k.cue('mind') }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }),
  });

  T({
    id: 'threshold-desc', title: 'Umbral descendente', subtitle: 'Series de 6′ a 1′, cada una más rápida', category: 'tempo',
    family: 'umbral', themes: [TH.ritmo, TH.escaleras], intensity: 'hard', durations: ALL, focus: 'Umbral y ritmo de 10K',
    description: 'Series que se acortan mientras la velocidad sube un poco en cada una. Empiezas en tu umbral y terminas por encima de él, con la sensación de ir cada vez más ligero.',
    coachNotes: ['La primera, la más larga, marca el tono: sostenible.', 'Cada serie es más corta: puedes permitirte un poco más.', 'Recupera con trote suave y hombros sueltos.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const seqs = k.long ? [[6, 5, 4, 3, 2], [5, 4, 3, 2, 1], [6, 4, 3, 2], [7, 5, 3, 1]] : [[4, 3, 2], [5, 3, 2], [4, 3, 2, 1], [3, 2, 2, 1]];
      const rest = r5(clamp(90 / k.L, 60, 120));
      const len = (s) => s.reduce((a, m) => a + m * 60, 0) + rest * (s.length - 1);
      const seq = choose(k, seqs, len, B, 60);
      const base = round1(k.between(0.45) + lo(k));
      const out = [k.flex()];
      seq.forEach((m, i) => {
        out.push(W(k.at(round1(base + 0.15 * i), m * 60, { zone: m >= 3 ? 'run' : 'fast', label: `${m} min de umbral`, block: 'Umbral',
          cue: i === 0 ? k.cue('tempo') : i === seq.length - 1 ? k.cue('last') : k.cue('mind') })));
        if (i < seq.length - 1) out.push(k.rec(rest));
      });
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'bpm-ladder', title: 'Escalera de BPM', subtitle: 'De 150 a 170 pasos por minuto al ritmo de la música', category: 'tempo',
    family: 'musica', themes: [TH.musica, TH.tecnica], intensity: 'moderate', durations: ALL, focus: 'Cadencia y ritmo',
    description: 'Cada peldaño sube cinco pasos por minuto y la cinta lo acompaña. Pisa con el bombo de la música: una sesión para afinar tu cadencia sin pensar en la velocidad.',
    coachNotes: ['Un paso por golpe de bombo: deja que la música marque.', 'Cuenta los apoyos de un pie en 30″: a 160 ppm son 40.', 'Al subir de BPM, pasos más cortos, no más largos.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const stepSec = k.rng.pick([120, 150]);
      const gap = 120;
      const ladderSteps = (upN) => upN + 2;
      let upN = 5;
      while (upN > 3 && ladderSteps(upN) * stepSec > B - 60) upN--;
      const bpms = [150, 155, 160, 165, 170].slice(5 - upN);
      const speeds = [k.J + 0.2, k.J + 0.6, k.R - 0.4, k.R, k.R + 0.3].slice(5 - upN);
      const len = ladderSteps(upN) * stepSec;
      const ladders = clamp(Math.floor((B - 60 + gap) / (len + gap)), 1, 3);
      const out = [k.flex()];
      for (let l = 0; l < ladders; l++) {
        const bump = round1(0.1 * l + lo(k, 0.1, -0.1));
        const seq = [...bpms.map((b, i) => [b, speeds[i]]), [bpms[upN - 2], speeds[upN - 2]], [bpms[upN - 3], speeds[upN - 3]]];
        seq.forEach(([bpm, v], i) => out.push(k.at(round1(v + bump), stepSec, { label: `${bpm} pasos por minuto`, block: `Escalera ${l + 1}`,
          cue: i === 0 ? (l === 0 ? 'Pisa con el bombo: un paso por golpe' : 'Otra escalera, ahora un poco más viva') : i === upN - 1 ? k.cue('mind') : i === upN ? 'Bajas BPM: suelta y disfruta' : '' })));
        if (l < ladders - 1) out.push(k.jog(gap, { off: -0.3, label: 'Pausa musical', block: 'Recuperación' }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return out;
    }),
  });

  T({
    id: 'ghost-negative', title: 'Fantasma paciente', subtitle: 'Empiezas detrás de tu fantasma y le pasas al final', category: 'tempo',
    family: 'progresivo', themes: [TH.fantasma, TH.ritmo], intensity: 'moderate', durations: SHORT, focus: 'Paciencia y remate',
    description: 'Tu fantasma sale más rápido que tú y le dejas ir. Poco a poco recortas, le alcanzas y en el último tramo le dejas atrás. Una lección de paciencia con premio.',
    coachNotes: ['Al principio vas detrás a propósito: no le persigas aún.', 'Recorta poco a poco, sin tirones.', 'Cuando le pases, mantén el ritmo hasta el final.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const w = k.rng.pick([[0.4, 0.3, 0.2], [0.35, 0.3, 0.25], [0.45, 0.25, 0.2]]);
      const last = r5(clamp(B * 0.1, 60, 240));
      const body = B - last;
      const sp = [k.R - 0.7, k.R - 0.3, k.R + 0.1];
      const names = ['Detrás del fantasma', 'Le recortas', 'Le alcanzas'];
      const out = sp.map((v, i) => {
        const s = k.at(round1(v + lo(k)), r5(body * w[i]), { label: names[i], block: 'Persecución', cue: i === 0 ? 'Déjale ir: tu momento llega después' : i === 1 ? k.cue('tempo') : k.cue('mind') });
        if (i === 0) s.flex = true;
        return s;
      });
      out.push(k.fast(last, { off: -0.2, label: 'Le dejas atrás', block: 'Remate', cue: k.cue('last') }));
      return out;
    }),
  });

  /* ═════════════ Resistencia ═════════════ */

  T({
    id: 'aerobic-10s', title: 'Bloques aeróbicos', subtitle: 'Bloques de 8–10′ en zona 2 con pausas suaves', category: 'endurance',
    family: 'resistencia', themes: [TH.resistencia, TH.tecnica], intensity: 'easy', durations: LONG, focus: 'Motor aeróbico',
    description: 'El fondo troceado en bloques de ocho a diez minutos en zona 2, con pausas de trote muy suave o paseo. Más fácil de cabeza que un rodaje continuo y igual de bueno para el corazón.',
    coachNotes: ['Zona 2 de verdad: deberías poder hablar sin jadear.', 'En las pausas, bebe y relaja los hombros.', 'Cada bloque es un objetivo pequeño: cuéntalos.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const blk = k.rng.pick([480, 540, 600]);
      const walk = k.rng.chance(0.4);
      const n = fitN(B, blk, 120, 2, 6, 120);
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push(k.jog(blk, { off: round1(0.4 + 0.1 * (i % 3) + lo(k, 0.1, -0.1)), label: `Bloque aeróbico ${i + 1}`, block: 'Bloques Z2', cue: i === 0 ? k.cue('easy') : i % 2 ? k.cue('mind') : '' }));
        if (i < n - 1) {
          if (walk) out.push(k.walkSeg(60, { block: 'Pausa', cue: 'Camina, bebe un sorbo y vuelve' }), k.jog(60, { off: -0.4, label: 'Trote muy suave', block: 'Pausa' }));
          else out.push(k.jog(120, { off: -0.5, label: 'Trote muy suave', block: 'Pausa' }));
        }
      }
      out.push(k.flex({ label: 'Rodaje final' }));
      return out;
    }),
  });

  T({
    id: 'long-strides', title: 'Fondo con rectas', subtitle: 'Rodaje largo y unas rectas para acabar ágil', category: 'endurance',
    family: 'resistencia', themes: [TH.resistencia, TH.tecnica], intensity: 'easy', durations: LONG, focus: 'Resistencia y técnica',
    description: 'Un rodaje largo y tranquilo con un tramo alegre en el centro y, al final, unas rectas rápidas para que las piernas no se olviden de correr rápido. Acabas más ágil de lo que empezaste.',
    coachNotes: ['El rodaje, tranquilo: el trabajo de hoy es el tiempo.', 'Las rectas son rápidas pero sueltas, sin apretar los dientes.', 'Entre rectas, trote muy suave hasta respirar tranquilo.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const m = k.rng.pick([4, 5, 6]);
      const st = k.rng.pick([30, 40]);
      const mid = k.rng.pick([240, 300, 360]);
      const out = [k.flex({ label: 'Rodaje Z2', off: 0.1, cue: k.cue('easy') }), k.jog(mid, { off: 0.5, label: 'Rodaje alegre', cue: 'Un poco más vivo, sin salir de la zona 2' }),
        k.flex({ label: 'Rodaje Z2', off: 0.1 })];
      for (let i = 0; i < m; i++) {
        out.push(W(k.fast(st, { off: -0.2, label: 'Recta', block: 'Rectas', cue: i === 0 ? 'Rápido pero suelto: técnica antes que fuerza' : '' })));
        out.push(k.jog(i < m - 1 ? 90 : 120, { off: -0.3, label: i < m - 1 ? 'Trote muy suave' : 'Rodaje final', block: 'Rectas' }));
      }
      return numberReps(out);
    }),
  });

  T({
    id: 'long-cruise', title: 'Fondo con crucero', subtitle: 'Rodaje, un crucero continuo en el centro y rodaje', category: 'endurance',
    family: 'resistencia', themes: [TH.resistencia, TH.ritmo], intensity: 'moderate', durations: LONG, focus: 'Ritmo en largo',
    description: 'Un fondo con relleno: rodaje para entrar, un crucero continuo de diez a veinte minutos en el centro y rodaje para volver. El crucero llega con las piernas calientes y se nota.',
    coachNotes: ['El primer rodaje prepara el crucero: no lo aceleres.', 'En el crucero, ritmo estable y respiración regular.', 'El rodaje de vuelta también cuenta: suelta y disfruta.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const cr = r5(clamp(B * 0.35 * k.L, 600, 1200));
      const pattern = k.rng.pick([[-0.4, -0.3, -0.2], [-0.3, -0.3, -0.3], [-0.5, -0.3, -0.1]]);
      const t = r5(cr / 3);
      return [
        k.flex({ label: 'Rodaje Z2', off: 0.2, cue: k.cue('easy') }),
        k.run(t, { off: pattern[0], label: 'Crucero · entrada', block: 'Crucero', cue: k.cue('tempo') }),
        k.run(t, { off: pattern[1], label: 'Crucero', block: 'Crucero', cue: k.cue('mind') }),
        k.run(cr - 2 * t, { off: pattern[2], label: 'Crucero · cierre', block: 'Crucero' }),
        k.flex({ label: 'Rodaje de vuelta', off: 0.1, cue: k.cue('easy') }),
      ];
    }),
  });

  T({
    id: 'steady-state', title: 'Estado estable', subtitle: 'Rodaje medio con un minuto alegre de vez en cuando', category: 'endurance',
    family: 'resistencia', themes: [TH.resistencia, TH.ritmo], intensity: 'moderate', durations: MID, focus: 'Aguante a ritmo medio',
    description: 'Un rodaje en la parte alta de tu zona aeróbica, el ritmo que aguantarías mucho tiempo. Cada pocos minutos, un minuto alegre para mantener la cabeza despierta.',
    coachNotes: ['Ritmo medio: algo más que conversación, mucho menos que tempo.', 'En el minuto alegre, alarga un poco la zancada sin apretar.', 'Bebe cada quince minutos.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const blk = k.rng.pick([300, 360, 420]);
      const off = round1(-0.7 + lo(k, 0.1, -0.1));
      const n = Math.max(1, Math.floor((B - 60) / (blk + 60)));
      const out = [k.flex({ label: 'Rodaje', off: 0.3 })];
      for (let i = 0; i < n; i++) {
        out.push(k.run(blk, { off, label: 'Estado estable', block: 'Estado estable', cue: i === 0 ? k.cue('tempo') : i % 2 ? k.cue('mind') : '' }));
        out.push(W(k.run(60, { off: round1(off + 0.4), label: 'Minuto alegre', block: 'Estado estable' })));
      }
      out.push(k.flex({ label: 'Rodaje final', off: 0.2 }));
      return numberReps(out);
    }),
  });

  T({
    id: 'easy-progression', title: 'Progresivo suave', subtitle: 'De trote lento a zona 2 alta, sin forzar', category: 'endurance',
    family: 'progresivo', themes: [TH.ritmo, TH.tecnica], intensity: 'easy', durations: SHORT, focus: 'Aeróbico suave',
    description: 'Un progresivo amable que nunca sale de la zona aeróbica: empieza lento y termina en la parte alta de tu zona 2. Ideal entre días duros para sumar sin cansar.',
    coachNotes: ['Los primeros minutos tienen que parecer demasiado lentos.', 'Cada escalón sube muy poco: casi no lo notarás.', 'Si al final jadeas, baja una décima.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const n = k.rng.pick([4, 5]);
      const top = round1(k.J + k.rng.pick([0.4, 0.5, 0.6]));
      const lowS = round1(k.J - 0.6);
      const out = [];
      for (let i = 0; i < n; i++) {
        const s = k.at(round1(lowS + ((top - lowS) * i) / (n - 1)), r5(B / n), { zone: 'jog', label: `Escalón suave ${i + 1} de ${n}`, block: 'Progresivo suave',
          cue: i === 0 ? k.cue('easy') : i === n - 1 ? 'Último escalón: zona 2 alta, aún puedes hablar' : '' });
        if (i === 0) s.flex = true;
        out.push(s);
      }
      return out;
    }),
  });

  T({
    id: 'playlist-long', title: 'Lista larga', subtitle: 'Canción a canción, con tu tema favorito cada pocas', category: 'endurance',
    family: 'musica', themes: [TH.musica, TH.resistencia], intensity: 'moderate', durations: LONG, focus: 'Resistencia con música',
    description: 'Un fondo que se mide en canciones en lugar de minutos. Alternas temas de rodaje y temas de ritmo, y cada pocas canciones suena «tu canción», la que te hace correr más alegre.',
    coachNotes: ['Piensa en canciones, no en minutos: el tiempo vuela.', 'En «tu canción», sube un poco sin salirte de lo cómodo.', 'Bebe al cambiar de tema cada media hora.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const song = k.rng.pick([195, 210, 225]);
      const fav = k.rng.pick([3, 4]);
      const n = Math.max(2, Math.floor(B / song));
      const out = [];
      for (let i = 0; i < n; i++) {
        const isFav = (i + 1) % fav === 0;
        const s = isFav ? W(k.run(song, { off: round1(0.2 + lo(k)), label: 'Tu canción', block: `Canción ${i + 1}`, cue: 'Suena tu canción: corre con ella' }))
          : i % 2 === 0 ? k.jog(song, { off: 0.3, label: `Canción ${i + 1} · rodaje`, block: `Canción ${i + 1}`, cue: i === 0 ? k.cue('easy') : '' })
            : k.run(song, { off: -0.5, label: `Canción ${i + 1} · ritmo`, block: `Canción ${i + 1}`, cue: i === 1 ? k.cue('tempo') : '' });
        if (i === n - 1) s.flex = true;
        out.push(s);
      }
      return numberReps(out);
    }),
  });

  T({
    id: 'z2-cadence', title: 'Zona 2 con cadencia', subtitle: 'Rodaje suave con minutos de pasos rápidos', category: 'endurance',
    family: 'tecnica', themes: [TH.tecnica, TH.resistencia], intensity: 'easy', durations: ALL, focus: 'Economía de carrera',
    description: 'Rodaje en zona 2 con minutos de cadencia alta a casi la misma velocidad: pasos más cortos y rápidos. Es la forma más barata de correr más ligero y castigar menos las rodillas.',
    coachNotes: ['En la cadencia alta no corres más: das más pasos, más cortos.', 'Apoya bajo la cadera, sin frenar con el talón.', 'Con el reloj, comprueba que sigues en zona 2.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const base = k.rng.pick([180, 240]);
      const cad = k.rng.pick([45, 60]);
      const cues = ['Pasos cortos y rápidos: misma velocidad, más ligereza', 'Imagina que la cinta quema: apoyos breves',
        'Cuenta los pasos de un pie en 30″: busca 42–45', 'Brazos más rápidos: las piernas los siguen'];
      const n = Math.max(1, Math.floor((B - 60) / (base + cad)));
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push(k.jog(base, { off: 0.1, label: 'Rodaje Z2', block: 'Z2', cue: i === 0 ? k.cue('easy') : '' }));
        out.push(W(k.jog(cad, { off: 0.3, label: 'Cadencia alta', block: 'Cadencia', cue: cues[i % cues.length] })));
      }
      out.push(k.flex({ label: 'Rodaje final' }));
      return numberReps(out);
    }),
  });

  T({
    id: 'long-mixed', title: 'Fondo mixto', subtitle: 'Rodaje, bloque de calidad sorpresa y rectas', category: 'endurance',
    family: 'resistencia', themes: [TH.mixto, TH.resistencia], intensity: 'moderate', durations: LONG, focus: 'Resistencia variada',
    description: 'Tres partes: rodaje para entrar, un bloque de calidad que cambia cada vez (tempo, minutos rápidos o crucero) y un final con rectas. El fondo largo que nunca es igual.',
    coachNotes: ['El rodaje inicial guarda energía para el bloque central.', 'El bloque central se anuncia: escucha qué te toca hoy.', 'Las rectas finales, rápidas y sueltas.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const kind = k.rng.pick(['tempo', 'minutes', 'cruise']);
      const mid = [];
      if (kind === 'tempo') for (let i = 0; i < 3; i++) { mid.push(W(k.run(180, { off: 0.3, label: 'Tres de tempo', block: 'Calidad' }))); if (i < 2) mid.push(k.rec(60)); }
      else if (kind === 'minutes') for (let i = 0; i < 6; i++) { mid.push(W(k.fast(60, { off: -0.1, label: 'Minuto rápido', block: 'Calidad' }))); if (i < 5) mid.push(k.jog(60, { label: 'Minuto de trote', block: 'Calidad' })); }
      else for (let i = 0; i < 2; i++) { mid.push(W(k.run(360, { off: -0.1, label: 'Crucero', block: 'Calidad' }))); if (i < 1) mid.push(k.rec(120)); }
      mid[0].cue = kind === 'tempo' ? 'Hoy tocan tres de tempo: firmes y regulares' : kind === 'minutes' ? 'Hoy tocan minutos rápidos: vivos y sueltos' : 'Hoy toca crucero: ritmo estable';
      const out = [k.flex({ label: 'Rodaje Z2', off: 0.2, cue: k.cue('easy') }), k.jog(120, { label: 'Trote antes del bloque' }), ...mid,
        k.flex({ label: 'Rodaje Z2', off: 0.1 })];
      for (let i = 0; i < 3; i++) {
        out.push(W(k.fast(30, { off: -0.3, label: 'Recta', block: 'Rectas' })));
        out.push(k.jog(60, { off: -0.3, label: 'Trote muy suave', block: 'Rectas' }));
      }
      return numberReps(out);
    }),
  });

  /* ═════════════ Fartlek ═════════════ */

  T({
    id: 'long-fartlek', title: 'Fartlek largo', subtitle: 'Rodaje con cambios largos de 2 a 5 minutos', category: 'fartlek',
    family: 'fartlek', themes: [TH.fartlek, TH.resistencia], intensity: 'moderate', durations: LONG, focus: 'Resistencia con ritmo',
    description: 'Un fondo de fin de semana con cambios largos a ritmo de correr que nunca se repiten igual. Ni monótono ni agotador: el juego de velocidad en versión larga.',
    coachNotes: ['Los cambios son largos: entra suave y asiéntate.', 'Entre cambios, rodaje cómodo y bebe si lo necesitas.', 'No hay dos cambios iguales: escucha cada aviso.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const out = [k.flex({ label: 'Rodaje', off: 0.2 })];
      let left = B - 180;
      let runSec = 0;
      for (let i = 0; i < 20; i++) {
        const rest = r5(k.rng.int(150, 240));
        const sec = r5(k.rng.int(120, 300));
        if (rest + sec > left || runSec + sec > 0.5 * B) break;
        out.push(k.jog(rest, { off: 0.2, label: 'Rodaje', cue: i === 0 ? k.cue('easy') : '' }));
        out.push(W(k.run(sec, { off: round1(k.rng.pick([-0.4, -0.2, 0, 0.2]) + lo(k)), label: 'Cambio largo', cue: i === 0 ? 'Primer cambio: entra suave y asiéntate' : i % 2 ? k.cue('tempo') : k.cue('mind') })));
        left -= rest + sec;
        runSec += sec;
      }
      out.push(k.flex({ label: 'Rodaje final' }));
      return numberReps(out, 'Cambios');
    }),
  });

  T({
    id: 'mona-fartlek', title: 'Fartlek Mona', subtitle: '90″ · 60″ · 30″ con flotes al mismo tiempo', category: 'fartlek',
    family: 'fartlek', themes: [TH.fartlek, TH.velocidad], intensity: 'hard', durations: SHORT, focus: 'Velocidad sin parar',
    description: 'Un clásico de los fondistas: cambios de 90, 60 y 30 segundos, cada uno seguido de un flote del mismo tiempo. El flote no es trote: es ritmo de correr suave. Nunca paras de correr.',
    coachNotes: ['El flote es correr suave, no trotar: no te dejes caer.', 'Cuanto más corto el cambio, más rápido.', 'Si los últimos de 30″ cuestan, mantén la técnica.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const variants = [[1, 3, 4], [2, 3, 4], [2, 4, 4], [2, 4, 6], [3, 5, 6], [3, 6, 6]];
      const len = ([a, b, c]) => 2 * (90 * a + 60 * b + 30 * c) - 30;
      const v = choose(k, variants, len, B, 60);
      const fl = round1(k.R - 0.8 + lo(k));
      const pieces = [...Array(v[0]).fill(90), ...Array(v[1]).fill(60), ...Array(v[2]).fill(30)];
      const out = [k.flex()];
      pieces.forEach((d, i) => {
        const off = d === 90 ? -0.1 : d === 60 ? 0.1 : round1((k.S - k.F) * 0.5);
        out.push(W(k.fast(d, { off, label: `Cambio de ${d}″`, block: 'Mona', cue: i === 0 ? k.cue('first') : i === pieces.length - 1 ? k.cue('last') : d !== pieces[i - 1] ? 'Más corto: más rápido' : '' })));
        if (i < pieces.length - 1) out.push(k.at(fl, d, { label: 'Flote', block: 'Mona', cue: i === 0 ? 'Flota: corre suave, sin trotar' : '' }));
      });
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'traffic-lights', title: 'Semáforo', subtitle: 'Rojo trote, ámbar correr, verde rápido', category: 'fartlek',
    family: 'fartlek', themes: [TH.fartlek, TH.mixto], intensity: 'moderate', durations: ALL, focus: 'Atención y cambios',
    description: 'La cinta se convierte en un semáforo: en rojo trotas, en ámbar corres y en verde aceleras. El color cambia sin aviso previo y nunca se repite dos veces seguidas.',
    coachNotes: ['Atento al color: cada cambio es un reflejo.', 'En verde, rápido pero con técnica.', 'En rojo, respira hondo: el verde vuelve pronto.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const make = {
        rojo: () => k.jog(k.rng.pick([60, 90]), { off: -0.3, label: 'Rojo · trote suave' }),
        ambar: () => k.run(k.rng.pick([60, 90, 120]), { off: lo(k), label: 'Ámbar · correr' }),
        verde: () => W(k.fast(k.rng.pick([45, 60, 75]), { off: lo(k), label: 'Verde · rápido' })),
      };
      const out = [k.flex()];
      let left = B - 120;
      let prev = 'rojo';
      for (let i = 0; i < 40; i++) {
        const color = k.rng.pick(Object.keys(make).filter((c) => c !== prev));
        const s = make[color]();
        if (s.sec > left) break;
        if (i === 0) s.cue = 'Atento al color: cada cambio es un reflejo';
        else if (color === 'verde' && i % 3 === 0) s.cue = k.cue('fast');
        out.push(s);
        left -= s.sec;
        prev = color;
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out, 'Semáforo');
    }),
  });

  T({
    id: 'dice-fartlek', title: 'Fartlek de dados', subtitle: 'Tira el dado: el número decide el cambio', category: 'fartlek',
    family: 'fartlek', themes: [TH.fartlek, TH.mixto], intensity: 'hard', durations: ALL, focus: 'Variedad total',
    description: 'Cada cambio sale de una tirada de dado: el uno es un sprint corto y el seis, tres minutos a ritmo de correr. Nunca sabes qué toca, así que nunca te aburres.',
    coachNotes: ['Escucha el número: cada cara tiene su ritmo.', 'Los números bajos son cortos y valientes; los altos, largos y con cabeza.', 'Entre tiradas, trote para llegar con ganas.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const FACES = [null, [30, 'sprint', 0, 'Uno · sprint'], [45, 'fast', 0.4, 'Dos · muy rápido'], [60, 'fast', 0.2, 'Tres · rápido'],
        [90, 'fast', -0.1, 'Cuatro · rápido largo'], [120, 'run', 0.4, 'Cinco · correr alegre'], [180, 'run', 0.2, 'Seis · correr']];
      const out = [k.flex()];
      let left = B - 90;
      let spr = 0;
      for (let i = 0; i < 30; i++) {
        let d = k.rng.int(1, 6);
        if (d === 1 && spr + 30 > 0.2 * B) d = 2;
        const [sec, zone, off, label] = FACES[d];
        const rest = r5(clamp((60 + sec * 0.3) / k.L, 45, 120));
        if (sec + rest > left) break;
        out.push(W(k.seg(zone, sec, { off, label: `Dado: ${label}`, cue: i === 0 ? k.cue('first') : zone === 'sprint' ? k.cue('sprint') : '' })));
        out.push(k.rec(rest));
        if (d === 1) spr += 30;
        left -= sec + rest;
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out, 'Tiradas');
    }, { quality: true }),
  });

  T({
    id: 'song-by-song', title: 'Canción a canción', subtitle: 'Intro, estrofa, estribillo: cada canción es una serie', category: 'fartlek',
    family: 'musica', themes: [TH.musica, TH.fartlek], intensity: 'moderate', durations: ALL, focus: 'Ritmo musical',
    description: 'Cada canción tiene su estructura: intro suave, estrofa a ritmo de correr y un estribillo más vivo antes del final. Corres la música en lugar de mirar el reloj.',
    coachNotes: ['La intro es para colocarte; la estrofa, para asentarte.', 'En el estribillo, sube con la música.', 'Al acabar cada canción, respira y prepárate para la siguiente.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const verse = () => k.rng.pick([60, 90, 120]);
      const out = [k.flex()];
      let left = B - 60;
      for (let i = 0; i < 20; i++) {
        const v = verse();
        const len = 45 + v + 45 + 30;
        if (len > left) break;
        const block = `Canción ${i + 1}`;
        const hot = k.rng.chance(0.5);
        out.push(k.jog(45, { off: 0.3, label: 'Intro', block, cue: i === 0 ? 'Cada canción es una serie: intro, estrofa y estribillo' : '' }));
        out.push(k.run(v, { off: -0.3, label: 'Estrofa', block, cue: i === 0 ? k.cue('tempo') : '' }));
        out.push(W(hot ? k.fast(45, { off: -0.2, label: 'Estribillo', block, cue: k.cue('fast') }) : k.run(45, { off: 0.5, label: 'Estribillo', block })));
        out.push(k.jog(30, { label: 'Final de canción', block }));
        left -= len;
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out, 'Canciones');
    }),
  });

  T({
    id: 'chorus-sprints', title: 'Estribillos', subtitle: 'Dos estribillos explosivos por canción', category: 'fartlek',
    family: 'musica', themes: [TH.musica, TH.explosividad], intensity: 'hard', durations: SHORT, focus: 'Potencia con música',
    description: 'En cada canción hay dos estribillos y los dos se corren fuerte: el primero a sprint, el segundo rápido. Entre medias, estrofa suave y puente para respirar.',
    coachNotes: ['El primer estribillo es el más explosivo: brazos rápidos.', 'El puente es tu respiro: aprovéchalo.', 'Si la música te lleva, déjate, pero sin perder la técnica.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const bridge = k.rng.pick([60, 75]);
      const song = 60 + 30 + bridge + 30 + 30;
      const n = clamp(Math.floor((B - 60) / song), 2, 8);
      const out = [k.flex()];
      for (let i = 0; i < n; i++) {
        const block = `Canción ${i + 1}`;
        out.push(k.jog(60, { off: 0.4, label: 'Estrofa', block }));
        out.push(W(k.sprint(30, { label: 'Estribillo 1', block, cue: i === 0 ? k.cue('first') : k.cue('sprint') })));
        out.push(k.run(bridge, { off: -0.5, label: 'Puente', block }));
        out.push(W(k.fast(30, { off: 0.3, label: 'Estribillo 2', block, cue: i === n - 1 ? k.cue('last') : '' })));
        out.push(k.jog(30, { off: -0.2, label: 'Final de canción', block }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'dj-mix', title: 'Sesión DJ', subtitle: 'Cada tema, un estilo y un ritmo distinto', category: 'fartlek',
    family: 'musica', themes: [TH.musica, TH.mixto], intensity: 'moderate', durations: ALL, focus: 'Ritmos variados',
    description: 'Un DJ mezcla temas de estilos distintos y la cinta los acompaña: chill para trotar, pop para correr, rock para apretar y electrónica para volar. Después de la electrónica, siempre baja el ritmo.',
    coachNotes: ['Cada estilo tiene su velocidad: escucha el cambio de tema.', 'En la electrónica, rápido pero suelto.', 'La balada no es parar: es trotar y respirar.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const STY = {
        chill: [118, (s) => k.jog(s, { off: 0.2, label: 'Chill · 118 BPM' })],
        pop: [135, (s) => k.run(s, { off: -0.4, label: 'Pop · 135 BPM' })],
        rock: [150, (s) => k.run(s, { off: 0.2, label: 'Rock · 150 BPM' })],
        electro: [165, (s) => W(k.fast(Math.min(s, 150), { off: -0.3, label: 'Electrónica · 165 BPM' }))],
        balada: [105, (s) => k.jog(s, { off: -0.3, label: 'Balada · 105 BPM' })],
      };
      const out = [k.flex()];
      let left = B - 60;
      let prev = 'balada';
      for (let i = 0; i < 20; i++) {
        let opts = Object.keys(STY).filter((x) => x !== prev);
        if (prev === 'electro') opts = ['balada', 'chill'];
        const st = k.rng.pick(opts);
        const s = STY[st][1](k.rng.pick([150, 180, 210, 240]));
        if (s.sec > left) break;
        if (i === 0) s.cue = 'Cada tema, un estilo: deja que la música mande';
        out.push(s);
        left -= s.sec;
        prev = st;
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out, 'Electrónica');
    }),
  });

  T({
    id: 'drop-beat', title: 'El drop', subtitle: 'Subidón de 90″ y explosión de 30″', category: 'fartlek',
    family: 'musica', themes: [TH.musica, TH.explosividad], intensity: 'hard', durations: SHORT, focus: 'Acelerar con la música',
    description: 'Como en la música electrónica: un subidón que va creciendo y, cuando llega el drop, explotas treinta segundos. Después, trote para esperar el siguiente.',
    coachNotes: ['El subidón crece poco a poco: no te adelantes al drop.', 'En el drop, todo: brazos, cadencia y mirada al frente.', 'Tras el drop, trote suave y a esperar el siguiente.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const stepsN = k.rng.pick([2, 3]);
      const build = [[k.R - 0.3, 'run'], [k.R + 0.3, 'run'], [k.F - 0.1, 'fast']].slice(3 - stepsN);
      const rest = r5(clamp(90 / k.L, 75, 120));
      const n = Math.min(fitN(B, stepsN * 30 + 30, rest, 2, 8), Math.max(2, Math.floor((0.24 * B) / 30)));
      const out = [k.flex()];
      for (let i = 0; i < n; i++) {
        const block = `Drop ${i + 1}`;
        build.forEach(([v, zone], j) => out.push(k.at(round1(v), 30, { zone, label: `Subidón ${j + 1}`, block, cue: i === 0 && j === 0 ? 'El subidón crece: no te adelantes al drop' : '' })));
        out.push(W(k.sprint(30, { label: 'Drop', block, cue: i === n - 1 ? k.cue('last') : k.cue('sprint') })));
        if (i < n - 1) out.push(k.rec(rest, { label: 'Después del drop', off: -0.3 }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'vinyl', title: 'Cara A y cara B', subtitle: 'Cara A progresiva, cara B con estribillos rápidos', category: 'fartlek',
    family: 'musica', themes: [TH.musica, TH.ritmo], intensity: 'moderate', durations: ALL, focus: 'Ritmo y cambios',
    description: 'Un vinilo con dos caras: en la cara A cada tema va un poco más rápido; das la vuelta al disco y en la cara B cada tema termina con un estribillo a ritmo rápido.',
    coachNotes: ['La cara A sube poco a poco: disfruta del crescendo.', 'Al dar la vuelta al disco, un minuto suave para respirar.', 'En la cara B, cada estribillo se corre alegre y suelto.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const song = k.rng.pick([180, 210]);
      const side = clamp(Math.floor((B - 60) / (2 * song + 30)), 1, 6);
      const out = [k.flex()];
      for (let i = 0; i < side; i++) {
        out.push(k.at(round1(k.J + 0.3 + ((k.R - k.J) * i) / Math.max(1, side)), song, { label: `Cara A · tema ${i + 1}`, block: 'Cara A',
          cue: i === 0 ? 'Cara A: cada tema, un poco más rápido' : '' }));
      }
      out.push(k.jog(60, { off: -0.3, label: 'Cambio de cara', block: 'Cambio de cara', cue: 'Damos la vuelta al disco: respira' }));
      for (let i = 0; i < side; i++) {
        out.push(k.run(song - 60, { off: -0.4, label: `Cara B · tema ${i + 1}`, block: 'Cara B' }));
        out.push(W(k.fast(60, { off: round1(-0.2 + lo(k)), label: 'Estribillo', block: 'Cara B', cue: i === 0 ? k.cue('fast') : i === side - 1 ? k.cue('last') : '' })));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }),
  });

  T({
    id: 'ghost-pique', title: 'Pique con el fantasma', subtitle: 'Ataques cortos y aguantar su rueda, sin trotar', category: 'fartlek',
    family: 'fartlek', themes: [TH.fantasma, TH.fartlek], intensity: 'hard', durations: SHORT, focus: 'Cambios de ritmo en carrera',
    description: 'Tu fantasma y tú os vais atacando: tú cambias de ritmo para escaparte y, después, aguantas su rueda corriendo firme. Nada de trotar dentro de cada bloque.',
    coachNotes: ['El ataque es corto: escápate con la cadencia.', 'A su rueda sigues corriendo: aquí está el entrenamiento.', 'Entre bloques, trote para volver al pique con ganas.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const att = k.rng.pick([30, 45]);
      const hold = k.rng.pick([75, 90]);
      const per = k.rng.pick([3, 4]);
      const gap = 120;
      const blocks = clamp(Math.floor((B - 60 + gap) / (per * (att + hold) + gap)), 1, 4);
      const out = [k.flex()];
      for (let b = 0; b < blocks; b++) {
        const block = `Pique ${b + 1}`;
        for (let i = 0; i < per; i++) {
          out.push(W(k.fast(att, { off: 0.3, label: 'Ataque', block, cue: b === 0 && i === 0 ? 'Ataca: escápate del fantasma con la cadencia' : i === per - 1 ? k.cue('last') : '' })));
          out.push(k.run(hold, { off: round1(-0.2 + lo(k)), label: 'A su rueda', block, cue: b === 0 && i === 0 ? 'Te alcanza: aguanta su rueda sin trotar' : '' }));
        }
        if (b < blocks - 1) out.push(k.jog(gap, { label: 'Trote entre piques', block: 'Recuperación', cue: k.cue('recovery') }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  /* ═════════════ Cuestas (requieren inclinación) ═════════════ */

  T({
    id: 'incline-pyramid', title: 'Pirámide de pendiente', subtitle: 'La inclinación sube hasta la cima y vuelve a bajar', category: 'hills',
    family: 'piramide', themes: [TH.cuestas, TH.escaleras], intensity: 'moderate', durations: ALL, focus: 'Fuerza aeróbica', requiresIncline: true,
    description: 'La pirámide se dibuja con la pendiente: 2, 4, 6… hasta la cima y vuelta a bajar, sin parar. La velocidad se ajusta para que el esfuerzo sea constante.',
    coachNotes: ['La velocidad baja cuando sube la pendiente: el esfuerzo manda.', 'Pasos cortos y brazos activos en la cima.', 'En la bajada, nota cómo respiras mejor.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const shapes = [[2, 4, 6, 4, 2], [2, 4, 6, 8, 6, 4, 2], [1, 3, 5, 7, 5, 3, 1], [2, 3, 4, 5, 6, 5, 4, 3, 2]];
      const st = k.rng.pick([60, 75, 90]);
      const gap = 150;
      const variants = shapes.map((s) => [s]);
      if (k.minutes >= 40) for (const a of shapes) for (const b of shapes.slice(0, 2)) variants.push([a, b]);
      const lenV = (v) => v.reduce((a, s) => a + s.length * st, 0) + gap * (v.length - 1);
      const pick = choose(k, variants, lenV, B, 60);
      const flat = round1(k.R - 0.3 + lo(k));
      const out = [k.flex({ incline: k.inc(1) })];
      pick.forEach((s, pi) => {
        if (pi) out.push(k.jog(gap, { off: -0.3, label: 'Llano entre pirámides', incline: k.inc(1), block: 'Recuperación', cue: k.cue('recovery') }));
        const top = Math.max(...s);
        s.forEach((p, i) => out.push(up(k, 'run', flat, p, st, { label: p === top ? 'Cima' : 'Pendiente', block: `Pirámide ${pi + 1}`, rep: { i: pi + 1, n: pick.length },
          cue: i === 0 ? k.cue('hill') : p === top ? k.cue('mind') : '' })));
      });
      out.push(k.flex({ label: 'Trote de soltura', incline: k.inc(1) }));
      return out;
    }),
  });

  T({
    id: 'stair-climber', title: 'Escalera de pendiente', subtitle: 'Misma velocidad, un punto más de pendiente cada minuto', category: 'hills',
    family: 'escalera', themes: [TH.cuestas, TH.escaleras], intensity: 'moderate', durations: ALL, focus: 'Fuerza progresiva', requiresIncline: true,
    description: 'La cinta no acelera: lo que sube es la pendiente, un piso por minuto. Cada piso cuesta un poco más y arriba del todo estás trabajando como en una serie rápida.',
    coachNotes: ['La velocidad no cambia: deja que la pendiente haga el trabajo.', 'Inclínate desde los tobillos y acorta el paso.', 'En la bajada en llano, suelta piernas y respira.'],
    build: (ctx) => frame(ctx, (k, B) => {
      let top = k.rng.pick([6, 7, 8]);
      const floorSec = k.rng.pick([60, 75]);
      const desc = 120;
      while (top > 3 && top * floorSec > B - 60) top--;
      const speed = round1(k.J + 0.2 + lo(k, 0.2, -0.2));
      const climbs = clamp(Math.floor((B - 60 + desc) / (top * floorSec + desc)), 1, 4);
      const out = [k.flex({ incline: k.inc(1) })];
      for (let c = 0; c < climbs; c++) {
        for (let p = 1; p <= top; p++) {
          const inc = k.inc(p);
          out.push(k.seg(p >= 7 ? 'fast' : p >= 4 ? 'run' : 'jog', floorSec, { speed: k.hasIncline ? speed : round1(speed + 0.15 * p), incline: inc,
            label: k.hasIncline ? `Piso ${p} · ${inc} %` : `Piso ${p}`, block: `Escalera ${c + 1}`, rep: { i: c + 1, n: climbs },
            cue: p === 1 ? (c === 0 ? 'Misma velocidad: deja que la pendiente haga el trabajo' : '') : p === top ? k.cue('last') : p === 4 ? k.cue('hill') : '' }));
        }
        if (c < climbs - 1) out.push(k.jog(desc, { off: -0.4, label: 'Bajada en llano', incline: k.inc(1), block: 'Recuperación', cue: k.cue('recovery') }));
      }
      out.push(k.flex({ label: 'Trote de soltura', incline: k.inc(1) }));
      return out;
    }),
  });

  T({
    id: 'mountain-walk', title: 'Senderismo en cinta', subtitle: 'Marcha en pendiente y trote suave en llano', category: 'hills',
    family: 'cuestas', themes: [TH.cuestas, TH.resistencia], intensity: 'easy', durations: ALL, focus: 'Corazón sin impacto', requiresIncline: true,
    description: 'Tramos de marcha rápida en pendiente alternados con trote suave en llano. El pulso sube a zona 2 sin apenas impacto: perfecto para sumar salud cardiovascular en días suaves.',
    coachNotes: ['Camina activo: zancada firme y brazos en marcha, sin agarrarte.', 'En pendiente, el pulso sube aunque vayas despacio: es normal.', 'El trote en llano es muy suave.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const trail = k.rng.pick([180, 240]);
      const flat = k.rng.pick([90, 120]);
      const pcts = k.rng.pick([[4, 5, 6], [5, 6, 7], [3, 5, 6]]);
      const n = Math.max(1, Math.floor((B - 60) / (trail + flat)));
      const out = [];
      for (let i = 0; i < n; i++) {
        const p = k.inc(pcts[i % 3]);
        out.push(k.hasIncline
          ? k.seg('walk', trail, { speed: round1(k.walk + 0.8), incline: p, label: `Sendero · ${p} %`, block: 'Senderismo', cue: i === 0 ? 'Camina activo: zancada firme, sin agarrarte' : '' })
          : k.jog(trail, { off: 0.2, label: 'Sendero (llano)', block: 'Senderismo', cue: i === 0 ? k.cue('easy') : '' }));
        out.push(k.jog(flat, { off: -0.3, incline: k.inc(1), label: 'Llano trotando', block: 'Senderismo' }));
      }
      out.push(k.flex({ label: 'Trote suave', off: -0.3, incline: k.inc(1) }));
      return out;
    }),
  });

  T({
    id: 'power-hike', title: 'Marcha en rampa', subtitle: 'Rampas fuertes caminando rápido y alguna corriendo', category: 'hills',
    family: 'cuestas', themes: [TH.cuestas, TH.mixto], intensity: 'moderate', durations: ALL, focus: 'Fuerza y pulso alto sin impacto', requiresIncline: true,
    description: 'Rampas de mucha pendiente subidas caminando rápido, como en el monte, y cada tercera rampa corriendo. El corazón trabaja fuerte y las articulaciones apenas lo notan.',
    coachNotes: ['Caminando en rampa: paso largo, empuja con el glúteo.', 'La rampa corriendo es corta: pasos cortos y brazos activos.', 'No te agarres a la barra: falsea el esfuerzo.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const ramp = k.rng.pick([60, 90]);
      const pct = k.rng.pick([7, 8]);
      const rest = r5(clamp(90 / k.L, 60, 120));
      const n = fitN(B, ramp, rest, 3, 12);
      const out = [k.flex({ incline: k.inc(1) })];
      for (let i = 0; i < n; i++) {
        const running = i % 3 === 2;
        const s = running ? up(k, 'run', round1(k.R + 0.3), 6, 45, { label: 'Rampa corriendo', block: 'Rampas', cue: k.cue('hill') })
          : k.hasIncline ? k.seg('walk', ramp, { speed: round1(k.walk + 1.0 + lo(k, 0.2, -0.2)), incline: k.inc(pct), label: `Rampa · marcha rápida · ${k.inc(pct)} %`, block: 'Rampas',
            cue: i === 0 ? 'Paso largo y empuja con el glúteo' : '' })
            : k.run(ramp, { off: 0.3, label: 'Rampa simulada', block: 'Rampas' });
        out.push(W(s));
        if (i < n - 1) out.push(k.jog(rest, { off: -0.3, incline: k.inc(1), label: 'Llano', block: 'Recuperación' }));
      }
      out.push(k.flex({ label: 'Trote de soltura', incline: k.inc(1) }));
      return numberReps(out);
    }),
  });

  T({
    id: 'hill-tempo', title: 'Tempo en subida', subtitle: 'Bloques de tempo con pendiente suave', category: 'hills',
    family: 'cuestas', themes: [TH.cuestas, TH.ritmo], intensity: 'moderate', durations: ALL, focus: 'Fuerza-resistencia', requiresIncline: true,
    description: 'Bloques largos a esfuerzo de tempo con una pendiente suave pero constante. Ganas fuerza sin perder el ritmo, y en llano todo parecerá más fácil.',
    coachNotes: ['El esfuerzo es de tempo aunque la velocidad sea menor.', 'Mantén la cadencia: pasos cortos y regulares.', 'En el llano suave, bebe y suelta los hombros.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const blk = k.long ? k.rng.pick([300, 360, 420]) : k.rng.pick([240, 300]);
      const pct = k.rng.pick([3, 4]);
      const rest = 120;
      const n = fitN(B, blk, rest, 1, 5);
      const out = [k.flex({ incline: k.inc(1) })];
      for (let i = 0; i < n; i++) {
        out.push(W(up(k, 'run', round1(k.R + 0.1 + lo(k)), pct + (i % 2 && k.rng.chance(0.5) ? 1 : 0), blk, { label: 'Tempo en subida', block: 'Tempo en subida',
          cue: i === 0 ? k.cue('tempo') : i === n - 1 ? k.cue('last') : k.cue('hill') })));
        if (i < n - 1) out.push(k.jog(rest, { off: -0.3, incline: k.inc(1), label: 'Llano suave', block: 'Recuperación' }));
      }
      out.push(k.flex({ label: 'Trote de soltura', incline: k.inc(1) }));
      return numberReps(out);
    }),
  });

  T({
    id: 'hill-repeats-long', title: 'Cuestas largas', subtitle: 'Subidas de 2 a 3 minutos a esfuerzo rápido', category: 'hills',
    family: 'cuestas', themes: [TH.cuestas, TH.velocidad], intensity: 'hard', durations: ALL, focus: 'Potencia aeróbica en cuesta', requiresIncline: true,
    description: 'Repeticiones largas en cuesta a esfuerzo de ritmo rápido. Son las series de los corredores de montaña: mucho pulso, mucha fuerza y poco impacto.',
    coachNotes: ['Sube con el esfuerzo, no con la velocidad.', 'En el último minuto de cada subida, brazos más activos.', 'Bajas trotando suave: no recortes la recuperación.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const upSec = k.rng.pick([120, 150, 180]);
      const pct = k.rng.pick([4, 5, 6]);
      const rest = r5(clamp(120 / k.L, 90, 180));
      const n = fitN(B, upSec, rest, 2, 8);
      const out = [k.flex({ incline: k.inc(1) })];
      for (let i = 0; i < n; i++) {
        out.push(W(up(k, 'fast', round1(k.F - 0.3), pct, upSec, { label: 'Cuesta larga', cue: i === 0 ? k.cue('hill') : i === n - 1 ? k.cue('last') : k.cue('mind') })));
        if (i < n - 1) out.push(k.rec(rest, { label: 'Bajada trotando', incline: k.inc(1) }));
      }
      out.push(k.flex({ label: 'Trote de soltura', incline: k.inc(1) }));
      return numberReps(out, 'Cuestas');
    }, { quality: true }),
  });

  T({
    id: 'hill-then-flat', title: 'Subida y llano', subtitle: 'Cuesta fuerte y, sin parar, llano rápido', category: 'hills',
    family: 'cuestas', themes: [TH.cuestas, TH.explosividad], intensity: 'hard', durations: SHORT, focus: 'Transferir fuerza a velocidad', requiresIncline: true,
    description: 'Subes una cuesta fuerte y, al coronar, la cinta se pone en llano y aceleras. La fuerza que acabas de activar se convierte en velocidad: así se nota el trabajo de cuestas.',
    coachNotes: ['En la cuesta, rodillas arriba y pasos cortos.', 'Al llegar al llano, alarga la zancada sin perder cadencia.', 'Recupera del todo: la calidad manda.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const upSec = k.rng.pick([45, 60]);
      const pct = k.rng.pick([6, 7]);
      const flatSec = k.rng.pick([30, 45]);
      const rest = r5(clamp(120 / k.L, 90, 150));
      const n = fitN(B, upSec + flatSec, rest, 2, 8);
      const out = [k.flex({ incline: k.inc(1) })];
      for (let i = 0; i < n; i++) {
        const rep = { i: i + 1, n };
        out.push(up(k, 'fast', round1(k.F + 0.2), pct, upSec, { label: 'Subida', block: `Serie ${i + 1}`, rep, cue: i === 0 ? k.cue('hill') : '' }));
        out.push(k.fast(flatSec, { off: 0.3, incline: 0, label: 'Llano lanzado', block: `Serie ${i + 1}`, rep, cue: i === 0 ? 'Llano: alarga la zancada y vuela' : i === n - 1 ? k.cue('last') : '' }));
        if (i < n - 1) out.push(k.rec(rest, { incline: k.inc(1) }));
      }
      out.push(k.flex({ label: 'Trote de soltura', incline: k.inc(1) }));
      return out;
    }, { quality: true }),
  });

  T({
    id: 'alpine-pass', title: 'Puerto de montaña', subtitle: 'Una subida larga, rampa final y descenso', category: 'hills',
    family: 'cuestas', themes: [TH.cuestas, TH.resistencia], intensity: 'moderate', durations: MID, focus: 'Resistencia en subida', requiresIncline: true,
    description: 'Un puerto entero: aproximación en llano, subida larga con la pendiente creciendo por tramos, una rampa final dura para coronar y descenso para soltar piernas.',
    coachNotes: ['El puerto es largo: sube a ritmo de conversación al principio.', 'En la rampa final, pasos cortos y brazos: ya coronas.', 'En el descenso, bebe y disfruta de las vistas imaginarias.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const steps = k.rng.pick([[1, 2, 3, 4, 5, 6], [2, 3, 4, 5, 6, 7], [1, 2, 4, 5, 6, 7]]);
      const climb = B * 0.62;
      const stepSec = r5(clamp(climb / steps.length, 90, 420));
      const lowF = round1(k.J + 0.4);
      const hiF = round1(k.R - 0.1 + lo(k));
      const out = [k.flex({ label: 'Aproximación', off: 0.2, incline: k.inc(1), cue: k.cue('easy') })];
      steps.forEach((p, i) => {
        const f = round1(lowF + ((hiF - lowF) * i) / (steps.length - 1));
        out.push(up(k, k.near(f), f, p, stepSec, { label: `Tramo ${i + 1}`, block: 'Subida al puerto', cue: i === 0 ? k.cue('hill') : i === steps.length - 1 ? k.cue('mind') : '' }));
      });
      out.push(W(up(k, 'run', round1(k.R + 0.2), 8, 60, { label: 'Rampa final', block: 'Subida al puerto', cue: 'Rampa final: pasos cortos, ya coronas' })));
      out.push(k.jog(180, { off: -0.3, incline: k.inc(1), label: 'Descenso', block: 'Descenso', cue: '¡Puerto coronado! Suelta las piernas' }));
      out.push(k.flex({ label: 'Llano final', incline: k.inc(1) }));
      return numberReps(out);
    }),
  });

  T({
    id: 'hill-fartlek', title: 'Fartlek de montaña', subtitle: 'Repechos, llanos rápidos y falsos llanos al azar', category: 'hills',
    family: 'fartlek', themes: [TH.cuestas, TH.fartlek], intensity: 'moderate', durations: ALL, focus: 'Fuerza y cambios', requiresIncline: true,
    description: 'Un recorrido de montaña inventado cada vez: repechos duros, llanos para acelerar, falsos llanos y bajadas para recuperar. Nunca sabes qué terreno viene después.',
    coachNotes: ['Cada terreno se anuncia: anticípate con la cadencia.', 'En los repechos, pasos cortos; en el llano, suelta la zancada.', 'Las bajadas son para respirar.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const KINDS = {
        repecho: () => W(up(k, 'run', round1(k.R + 0.2), k.rng.pick([5, 6, 7]), k.rng.pick([45, 60, 75]), { label: 'Repecho', cue: k.cue('hill') })),
        llano: () => W(k.fast(k.rng.pick([45, 60]), { incline: 0, label: 'Llano rápido', cue: k.cue('fast') })),
        falso: () => up(k, 'jog', round1(k.J + 0.5), 2, k.rng.pick([90, 120]), { label: 'Falso llano' }),
        bajada: () => k.jog(k.rng.pick([60, 90]), { off: -0.3, incline: k.inc(1), label: 'Bajada' }),
      };
      const out = [k.flex({ incline: k.inc(1) })];
      let left = B - 90;
      let prev = 'bajada';
      for (let i = 0; i < 40; i++) {
        let opts = Object.keys(KINDS).filter((x) => x !== prev);
        if (prev === 'repecho' || prev === 'llano') opts = ['falso', 'bajada'];
        const kind = k.rng.pick(opts);
        const s = KINDS[kind]();
        if (s.sec > left) break;
        out.push(s);
        left -= s.sec;
        prev = kind;
      }
      out.push(k.flex({ label: 'Trote de soltura', incline: k.inc(1) }));
      return numberReps(out, 'Terreno');
    }),
  });

  T({
    id: 'over-under-hill', title: 'Cambios de pendiente', subtitle: 'Misma velocidad, pendiente suave y fuerte alternas', category: 'hills',
    family: 'umbral', themes: [TH.cuestas, TH.ritmo], intensity: 'moderate', durations: ALL, focus: 'Umbral en cuesta', requiresIncline: true,
    description: 'La velocidad no se mueve: lo que cambia es la pendiente, de suave a fuerte y vuelta. Por debajo y por encima de tu umbral sin tocar los botones de velocidad.',
    coachNotes: ['En la pendiente fuerte, acorta el paso y mantén la cadencia.', 'En la suave no te relajes del todo: sigue firme.', 'Respira profundo y regular durante todo el bloque.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const speed = round1(k.R - 0.6 + lo(k));
      const highP = k.rng.pick([5, 6]);
      const a = k.rng.pick([90, 120]);
      const b = k.rng.pick([60, 90]);
      let reps = k.rng.pick([3, 4]);
      const gap = 120;
      while (reps > 2 && reps * (a + b) > B - 60) reps--;
      const blocks = clamp(Math.floor((B - 60 + gap) / (reps * (a + b) + gap)), 1, 4);
      const out = [k.flex({ incline: k.inc(1) })];
      for (let bl = 0; bl < blocks; bl++) {
        const block = `Bloque ${bl + 1}`;
        for (let i = 0; i < reps; i++) {
          out.push(k.seg('run', a, { speed, incline: k.inc(2), label: k.hasIncline ? `Por debajo · ${k.inc(2)} %` : 'Por debajo', block, cue: i === 0 && bl === 0 ? k.cue('tempo') : '' }));
          out.push(W(k.seg('fast', b, { speed: k.hasIncline ? speed : round1(speed + 1.0), incline: k.inc(highP), label: k.hasIncline ? `Por encima · ${k.inc(highP)} %` : 'Por encima',
            block, cue: i === 0 && bl === 0 ? 'La pendiente sube y la velocidad no: acorta el paso' : i === reps - 1 ? k.cue('mind') : '' })));
        }
        if (bl < blocks - 1) out.push(k.jog(gap, { off: -0.3, incline: k.inc(1), label: 'Trote entre bloques', block: 'Recuperación', cue: k.cue('recovery') }));
      }
      out.push(k.flex({ label: 'Trote de soltura', incline: k.inc(1) }));
      return numberReps(out);
    }),
  });

  T({
    id: 'rolling-hills', title: 'Colinas suaves', subtitle: 'Rodaje Z2 con lomas del 1 al 3 %', category: 'hills',
    family: 'resistencia', themes: [TH.cuestas, TH.resistencia], intensity: 'easy', durations: ALL, focus: 'Aeróbico con fuerza suave', requiresIncline: true,
    description: 'Un rodaje en zona 2 por un terreno ondulado de lomas suaves. La velocidad se ajusta para que el esfuerzo no cambie: trabajas fuerza sin salir de la zona fácil.',
    coachNotes: ['El esfuerzo es siempre el mismo: zona 2.', 'En cada loma, pasos un poco más cortos.', 'Es un día suave: si jadeas, baja una décima.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const segSec = k.rng.pick([120, 150, 180]);
      const profile = k.rng.pick([[1, 2, 3, 2], [1, 3, 1, 2], [2, 3, 2, 1]]);
      const n = Math.max(1, Math.floor(B / segSec));
      const out = [];
      for (let i = 0; i < n; i++) {
        const s = up(k, 'jog', round1(k.J + 0.2), profile[i % profile.length], segSec, { label: 'Loma suave', block: 'Colinas', cue: i === 0 ? k.cue('easy') : i % 3 === 2 ? k.cue('hill') : '' });
        if (i === n - 1) s.flex = true;
        out.push(s);
      }
      return out;
    }),
  });

  T({
    id: 'ghost-hill', title: 'El fantasma en la cuesta', subtitle: 'Subes a su rueda y le atacas antes de coronar', category: 'hills',
    family: 'cuestas', themes: [TH.cuestas, TH.fantasma], intensity: 'hard', durations: SHORT, focus: 'Ataque en subida', requiresIncline: true,
    description: 'Cada cuesta es un duelo con tu fantasma: subes a su rueda a ritmo firme y, antes de coronar, le atacas con un punto más de pendiente. Bajada y a por el siguiente duelo.',
    coachNotes: ['A su rueda, sube firme pero guardando algo.', 'En el ataque, brazos potentes y pasos cortos.', 'Baja trotando y recupera de verdad.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const climb = k.rng.pick([90, 120]);
      const attack = k.rng.pick([30, 45]);
      const pct = k.rng.pick([4, 5, 6]);
      const rest = r5(clamp(120 / k.L, 90, 150));
      const n = fitN(B, climb + attack, rest, 2, 7);
      const out = [k.flex({ incline: k.inc(1) })];
      for (let i = 0; i < n; i++) {
        const block = `Duelo ${i + 1}`;
        out.push(up(k, 'run', k.R, pct, climb, { label: 'A su rueda', block, cue: i === 0 ? k.cue('hill') : '' }));
        out.push(W(up(k, 'fast', round1(k.F + 0.2), pct + 1, attack, { label: 'Ataque al fantasma', block, cue: i === n - 1 ? k.cue('last') : 'Ataca: brazos potentes y pasos cortos' })));
        if (i < n - 1) out.push(k.jog(rest, { off: -0.3, incline: k.inc(1), label: 'Bajada', block: 'Recuperación' }));
      }
      out.push(k.flex({ label: 'Trote de soltura', incline: k.inc(1) }));
      return numberReps(out);
    }, { quality: true }),
  });

  /* ═════════════ Recuperación ═════════════ */

  T({
    id: 'breath-jog', title: 'Respira y trota', subtitle: 'Trote suave con un foco de respiración por bloque', category: 'recovery',
    family: 'recuperacion', themes: [TH.tecnica, TH.mixto], intensity: 'easy', durations: SHORT, focus: 'Recuperación y respiración',
    description: 'Un trote suave en el que cada bloque trae un ejercicio de respiración distinto: 3-3, 4-4, por la nariz, con la barriga… Recuperas el cuerpo y aprendes a controlar el aire.',
    coachNotes: ['Más lento de lo que crees: hoy se respira, no se compite.', 'Si un ejercicio te cuesta, vuelve a respirar libre un minuto.', 'Termina con la sensación de que podrías seguir una hora.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const FOCUS = [['Respiración 3-3', 'Tres pasos inspiras, tres espiras'], ['Respiración 4-4', 'Cuatro pasos inspiras, cuatro espiras: más calma'],
        ['Por la nariz', 'Solo por la nariz: si no puedes, vas demasiado rápido'], ['Con la barriga', 'Hincha la barriga al inspirar, no el pecho'],
        ['Suspiro largo', 'Cada minuto, un suspiro largo para soltar tensión'], ['Cuenta lenta', 'Cuenta diez respiraciones lentas y vuelve a empezar']];
      const blk = k.rng.pick([150, 180, 240]);
      const order = k.rng.shuffle(FOCUS);
      const n = Math.max(1, Math.floor(B / blk));
      const out = [];
      for (let i = 0; i < n; i++) {
        const [label, cue] = order[i % order.length];
        const s = k.jog(blk, { off: round1(-0.5 + 0.1 * (i % 3)), label, block: 'Respiración', cue });
        if (i === n - 1) s.flex = true;
        out.push(s);
      }
      return out;
    }),
  });

  T({
    id: 'light-legs', title: 'Piernas ligeras', subtitle: 'Trote suave con soltura cada pocos minutos', category: 'recovery',
    family: 'recuperacion', themes: [TH.tecnica, TH.mixto], intensity: 'easy', durations: QUICK, focus: 'Soltar piernas',
    description: 'Para el día después de un entreno duro: trote suave y, cada pocos minutos, unos segundos de soltura alargando la zancada sin apretar. Sales con las piernas más frescas.',
    coachNotes: ['La soltura no es una serie: zancada larga y relajada.', 'Entre soltura y soltura, trote de verdad suave.', 'Hoy ganas por no apretar.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const every = k.rng.pick([180, 210, 240]);
      const loose = k.rng.pick([30, 45]);
      const n = Math.max(1, Math.floor((B - 30) / (every + loose)));
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push(k.jog(every, { off: -0.4, label: 'Trote suave', block: 'Piernas ligeras', cue: i === 0 ? k.cue('easy') : '' }));
        out.push(k.run(loose, { off: -0.6, label: 'Soltura', block: 'Piernas ligeras', cue: i === 0 ? 'Zancada un pelín más larga, sin apretar' : '' }));
      }
      out.push(k.flex({ label: 'Trote suave', off: -0.4 }));
      return out;
    }),
  });

  T({
    id: 'form-focus', title: 'Cinco focos de técnica', subtitle: 'Postura, brazos, pisada, cadencia y relajación', category: 'recovery',
    family: 'tecnica', themes: [TH.tecnica], intensity: 'easy', durations: SHORT, focus: 'Técnica de carrera',
    description: 'Cada bloque se centra en una sola cosa de tu técnica: la postura, los brazos, la pisada, la cadencia o la relajación. A ritmo suave, para que el cuerpo lo aprenda sin prisas.',
    coachNotes: ['Un solo foco cada vez: no intentes arreglarlo todo junto.', 'Entre focos, trote libre para asimilar.', 'Lo que practiques hoy saldrá solo en los días rápidos.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const FOCI = [['Postura', 'Alto, como si un hilo tirara de tu cabeza'], ['Brazos', 'Codos a 90°: el movimiento nace del hombro'],
        ['Pisada', 'Apoya bajo la cadera, sin frenar con el talón'], ['Cadencia', 'Pasos cortos y rápidos, más ligeros'],
        ['Relajación', 'Suelta la cara, las manos y los hombros'], ['Mirada', 'Mira al frente, no a los pies']];
      const blk = k.rng.pick([90, 120]);
      const rest = 60;
      const order = k.rng.shuffle(FOCI);
      const n = fitN(B, blk, rest, 2, 10);
      const out = [k.flex({ off: -0.2 })];
      for (let i = 0; i < n; i++) {
        const [name, cue] = order[i % order.length];
        out.push(W(k.jog(blk, { off: 0.4, label: `Foco · ${name}`, block: 'Técnica', cue })));
        if (i < n - 1) out.push(k.jog(rest, { off: -0.4, label: 'Trote libre', block: 'Técnica' }));
      }
      out.push(k.flex({ label: 'Trote suave', off: -0.2 }));
      return numberReps(out);
    }),
  });

  T({
    id: 'easy-fartlek', title: 'Fartlek suave', subtitle: 'Juego de ritmos sin salir de la zona fácil', category: 'recovery',
    family: 'fartlek', themes: [TH.fartlek, TH.resistencia], intensity: 'easy', durations: ALL, focus: 'Aeróbico sin monotonía',
    description: 'Un fartlek en miniatura dentro de tu zona 2: la cinta sube y baja unas décimas en tramos de duración variable. El cuerpo descansa y la cabeza no se aburre.',
    coachNotes: ['Todos los cambios son pequeños: siempre puedes hablar.', 'Si el pulso pasa de zona 2, baja una décima.', 'Disfruta del juego: hoy no hay nada que demostrar.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const offs = [-0.5, -0.2, 0.1, 0.3, 0.5];
      const out = [];
      let left = B;
      let prev = null;
      for (let i = 0; i < 40 && left >= 120; i++) {
        const off = k.rng.pick(offs.filter((o) => o !== prev));
        const sec = Math.min(left, r5(k.rng.int(60, 180)));
        out.push(k.jog(sec, { off, label: off >= 0.3 ? 'Trote alegre' : off <= -0.4 ? 'Trote muy suave' : 'Trote', block: 'Fartlek suave', cue: i === 0 ? k.cue('easy') : i % 4 === 3 ? k.cue('easy') : '' }));
        left -= sec;
        prev = off;
      }
      out.push(k.flex({ label: 'Trote final', off: -0.2 }));
      return out;
    }),
  });

  T({
    id: 'easy-music', title: 'Canciones tranquilas', subtitle: 'Rodaje suave con una cadencia distinta por canción', category: 'recovery',
    family: 'musica', themes: [TH.musica, TH.tecnica], intensity: 'easy', durations: ALL, focus: 'Cadencia en zona 2',
    description: 'Un rodaje suave en el que cada canción trae su propia cadencia, de balada a pop alegre, sin salir de la zona 2. Recuperas mientras afinas el paso con la música.',
    coachNotes: ['Un paso por golpe de bombo, sin acelerar la cinta.', 'En las canciones rápidas, pasos más cortos.', 'Zona 2 todo el rato: es un día de recuperar.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const SONGS = [['Balada · 150 ppm', -0.4], ['Pop suave · 155 ppm', -0.1], ['Indie · 160 ppm', 0.2], ['Funk · 165 ppm', 0.3], ['Acústico · 150 ppm', -0.3]];
      const song = k.rng.pick([180, 210, 240]);
      const order = k.rng.shuffle(SONGS);
      const n = Math.max(1, Math.floor(B / song));
      const out = [];
      for (let i = 0; i < n; i++) {
        const [label, off] = order[i % order.length];
        const s = k.jog(song, { off, label, block: `Canción ${i + 1}`, cue: i === 0 ? 'Un paso por golpe de bombo, sin acelerar' : off >= 0.2 ? 'Canción más rápida: pasos más cortos' : '' });
        if (i === n - 1) s.flex = true;
        out.push(s);
      }
      return out;
    }),
  });

  /* ═════════════ Retos ═════════════ */

  T({
    id: 'ghost-duel', title: 'Duelo con tu fantasma', subtitle: 'Una carrera de ataques y respuestas contra tu mejor marca', category: 'challenge',
    family: 'reto', themes: [TH.fantasma, TH.records], intensity: 'hard', durations: SHORT, focus: 'Táctica de carrera',
    description: 'Una carrera de verdad contra tu fantasma: sales juntos, él ataca, respondes, le aguantas y en el último minuto te lo juegas todo en un sprint de meta.',
    coachNotes: ['La salida es controlada: la carrera es larga.', 'Cada ataque es corto: respóndelo con la cadencia.', 'El sprint de meta decide el duelo: dalo todo.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const race = r5(clamp(B * (k.long ? 0.6 : 0.8) * k.L, 480, 1800));
      const out = [k.flex(), k.run(120, { label: 'Salida', block: 'Duelo', cue: 'Salís juntos: controla, la carrera es larga' })];
      let left = race - 120 - 30;
      let i = 0;
      while (left > 0) {
        const a = k.rng.pick([45, 60]);
        const h = k.rng.pick([90, 120, 150]);
        if (a + h > left) break;
        if (k.long && i === 3) { out.push(k.jog(90, { label: 'Respiro', block: 'Duelo', cue: 'Os dais un respiro: aprovéchalo' })); left -= 90; }
        out.push(W(k.fast(a, { off: i % 2 ? 0.2 : 0, label: i % 2 ? 'Contraataque' : 'Ataque', block: 'Duelo', cue: i === 0 ? 'Primer ataque: respóndelo con la cadencia' : '' })));
        out.push(k.run(h, { off: 0.2, label: 'Le aguantas', block: 'Duelo', cue: i === 1 ? k.cue('mind') : '' }));
        left -= a + h;
        i++;
      }
      out.push(W(k.sprint(30, { label: 'Sprint de meta', block: 'Duelo', cue: k.cue('last') })));
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out, 'Duelo');
    }, { quality: true }),
  });

  T({
    id: 'ghost-time-trial', title: 'Contrarreloj del fantasma', subtitle: 'Un bloque a tope sostenible contra tu mejor marca', category: 'challenge',
    family: 'reto', themes: [TH.fantasma, TH.records], intensity: 'hard', durations: ALL, focus: 'Ritmo de competición',
    description: 'Activación, un par de aceleraciones y contrarreloj: un bloque continuo al ritmo más rápido que puedas sostener, dividido en tercios, con un último minuto para dejarlo todo.',
    coachNotes: ['El primer tercio parecerá fácil: no aceleres.', 'En el segundo, la cabeza manda: piensa en el siguiente minuto.', 'El último minuto es para dejarlo todo.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const tt = r5(clamp(B * (k.long ? 0.5 : 0.6) * k.L, 360, 1500));
      const v = round1(k.between(0.3) + lo(k));
      const split = k.rng.pick([[-0.1, 0, 0.1], [0, 0, 0.2], [0, 0.1, 0.1]]);
      const t1 = r5((tt - 60) / 3);
      const t2 = r5((tt - 60) / 3);
      return [
        k.flex(),
        k.fast(30, { off: 0.2, label: 'Aceleración', block: 'Activación' }), k.jog(60, { label: 'Trote', block: 'Activación' }),
        k.fast(30, { off: 0.2, label: 'Aceleración', block: 'Activación' }), k.jog(120, { label: 'Preparado', block: 'Activación', cue: 'Prepárate: en nada sale la contrarreloj' }),
        k.at(round1(v + split[0]), t1, { zone: 'run', label: 'Primer tercio', block: 'Contrarreloj', cue: 'Primer tercio: controla, no aceleres' }),
        k.at(round1(v + split[1]), t2, { zone: 'run', label: 'Segundo tercio', block: 'Contrarreloj', cue: k.cue('mind') }),
        k.at(round1(v + split[2]), tt - 60 - t1 - t2, { zone: 'run', label: 'Último tercio', block: 'Contrarreloj' }),
        k.fast(60, { label: 'Último minuto', block: 'Contrarreloj', cue: k.cue('last') }),
        k.flex({ label: 'Trote de soltura' }),
      ];
    }, { quality: true }),
  });

  T({
    id: 'last-km', title: 'El último kilómetro', subtitle: 'Rodaje, crucero y un último tramo contra tu fantasma', category: 'challenge',
    family: 'reto', themes: [TH.fantasma, TH.ritmo], intensity: 'hard', durations: ALL, focus: 'Rematar fuerte',
    description: 'Todo el entreno prepara un momento: el último tramo, de 800 m a 1,2 km, contra tu fantasma. Primera mitad firme y segunda mitad más rápida para llegar a meta por delante.',
    coachNotes: ['El rodaje y el crucero son para llegar con piernas.', 'La primera mitad del tramo final, firme y paciente.', 'En la segunda mitad, sube y no mires atrás.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const d = k.rng.pick([0.8, 1.0, 1.2]);
      const fin = r5((d / (k.F + 0.1)) * 3600);
      const h1 = r5(fin / 2);
      const name = d === 1 ? 'último kilómetro' : `últimos ${Math.round(d * 1000)} m`;
      return numberReps([
        k.flex({ label: 'Rodaje', off: 0.3, cue: k.cue('easy') }),
        k.run(r5(clamp(B * 0.3, 180, 900)), { off: -0.3, label: 'Ritmo de crucero', block: 'Preparación', cue: k.cue('tempo') }),
        k.jog(60, { label: 'Respira', block: 'Preparación', cue: `Respira: llegan los ${name}` }),
        W(k.fast(h1, { off: -0.1, label: 'Tramo final · primera mitad', block: 'Último tramo', cue: 'Primera mitad: firme y paciente' })),
        W(k.fast(fin - h1, { off: round1(0.2 + lo(k)), label: 'Tramo final · segunda mitad', block: 'Último tramo', cue: k.cue('last') })),
        k.flex({ label: 'Trote de soltura' }),
      ]);
    }),
  });

  T({
    id: 'reto-5k', title: 'Reto 5K', subtitle: 'Cinco kilómetros a ritmo de carrera', category: 'challenge',
    family: 'reto', themes: [TH.records, TH.ritmo], intensity: 'hard', durations: LONG, focus: 'Distancia y ritmo',
    description: 'Cinco kilómetros seguidos a tu ritmo de carrera, kilómetro a kilómetro, con calentamiento y vuelta a la calma incluidos. Tu 5K en casa para medir cómo vas.',
    coachNotes: ['Kilómetro a kilómetro: celebra cada uno.', 'El primero, controlado; el último, con todo lo que te quede.', 'Bebe antes de empezar el reto, no durante.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const v = clamp(round1(k.between(0.3) + lo(k)), round1(k.R - 0.3), round1(k.F - 0.4));
      const offs = k.rng.pick([[0, 0, 0, 0, 0.2], [-0.1, 0, 0, 0.1, 0.2], [0, -0.1, 0, 0.1, 0.1]]);
      const out = [k.flex({ label: 'Rodaje previo', off: 0.2 })];
      offs.forEach((o, i) => {
        const sp = round1(v + o);
        out.push(W(k.at(sp, r5(3600 / sp), { zone: 'run', label: `Km ${i + 1} de 5`, block: 'Reto 5K',
          cue: i === 0 ? 'Primer kilómetro: controla, queda mucho' : i === 4 ? k.cue('last') : k.cue('mind') })));
      });
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }),
  });

  T({
    id: 'the-mile', title: 'La milla', subtitle: '1 609 metros a tope, vuelta a vuelta', category: 'challenge',
    family: 'reto', themes: [TH.records, TH.velocidad], intensity: 'hard', durations: QUICK, focus: 'Velocidad sostenida',
    description: 'La distancia mítica: una milla, cuatro vueltas de pista de 400 metros, cada una un poco más rápida. Corta, intensa y perfecta para comparar tu marca mes a mes.',
    coachNotes: ['La primera vuelta, controlada: la milla se gana al final.', 'En la tercera vuelta duele: es la que separa.', 'La última, con todo.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const laps = k.rng.pick([[[k.between(0.8), 'run'], [k.F - 0.1, 'fast'], [k.F, 'fast'], [k.F + 0.3, 'fast']],
        [[k.between(0.9), 'run'], [k.F, 'fast'], [k.F, 'fast'], [k.F + 0.2, 'fast']]]);
      const out = [k.flex(),
        k.fast(30, { off: 0.2, label: 'Aceleración', block: 'Activación' }), k.jog(60, { label: 'Trote', block: 'Activación' }),
        k.fast(30, { off: 0.2, label: 'Aceleración', block: 'Activación' }), k.jog(90, { label: 'Prepárate', block: 'Activación', cue: 'En nada sale la milla: respira hondo' })];
      laps.forEach(([v, zone], i) => {
        const sp = round1(v + lo(k));
        out.push(W(k.at(sp, r5((0.40225 / sp) * 3600), { zone, label: `Vuelta ${i + 1} de 4`, block: 'La milla',
          cue: i === 0 ? 'Primera vuelta: controlada' : i === 2 ? 'Tercera vuelta: la que separa' : i === 3 ? k.cue('last') : '' })));
      });
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }),
  });

  T({
    id: 'deck-of-cards', title: 'La baraja', subtitle: 'Cada carta decide el palo y la duración del cambio', category: 'challenge',
    family: 'reto', themes: [TH.mixto, TH.fartlek], intensity: 'hard', durations: ALL, focus: 'Variedad y cabeza',
    description: 'Sacamos cartas de la baraja española: oros es rápido, copas es correr alegre, espadas es sprint y bastos es ritmo largo. El número de la carta marca cuánto dura.',
    coachNotes: ['Escucha la carta: el palo dice el ritmo, el número la duración.', 'Las espadas son cortas: valientes.', 'Entre cartas, trote para barajar de nuevo.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const NAMES = ['', 'As', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Sota', 'Caballo', 'Rey'];
      const SUITS = {
        oros: (v) => k.fast(30 + 10 * Math.min(v, 7), { label: '' }),
        copas: (v) => k.run(30 + 15 * v, { off: 0.4, label: '' }),
        espadas: () => k.sprint(30, { label: '' }),
        bastos: (v) => k.run(60 + 20 * v, { off: -0.2, label: '' }),
      };
      const out = [k.flex()];
      let left = B - 90;
      let spr = 0;
      let prev = '';
      for (let i = 0; i < 30; i++) {
        let suit = k.rng.pick(Object.keys(SUITS).filter((s) => s !== prev));
        if (suit === 'espadas' && spr + 30 > 0.2 * B) suit = 'oros';
        const v = k.rng.int(1, 10);
        const s = SUITS[suit](v);
        s.label = `${NAMES[v]} de ${suit}`;
        const rest = r5(clamp((45 + s.sec / 3) / k.L, 45, 120));
        if (s.sec + rest > left) break;
        if (i === 0) s.cue = 'Primera carta: el palo dice el ritmo, el número la duración';
        out.push(W(s), k.rec(rest, { label: 'Barajando' }));
        if (suit === 'espadas') spr += 30;
        left -= s.sec + rest;
        prev = suit;
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out, 'Cartas');
    }, { quality: true }),
  });

  T({
    id: 'combo-double', title: 'Doble sesión', subtitle: 'Minutos rápidos y, después, tempo largo', category: 'challenge',
    family: 'reto', themes: [TH.mixto, TH.velocidad], intensity: 'hard', durations: LONG, focus: 'Velocidad y umbral',
    description: 'Dos entrenos en uno: primero minutos rápidos con minutos de trote y, tras una pausa, un tempo largo con las piernas ya cargadas. El reto de los días con hambre.',
    coachNotes: ['La primera parte no se corre a tope: queda la segunda.', 'En la pausa, bebe y suelta.', 'El tempo con las piernas cargadas es lo que más entrena.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const m = k.rng.pick([6, 8]);
      const out = [k.flex({ label: 'Rodaje' })];
      for (let i = 0; i < m; i++) {
        out.push(W(k.fast(60, { label: 'Minuto rápido', block: 'Parte 1', cue: i === 0 ? k.cue('first') : i === m - 1 ? 'Último minuto de la primera parte' : '' })));
        if (i < m - 1) out.push(k.jog(60, { label: 'Minuto de trote', block: 'Parte 1' }));
      }
      out.push(k.jog(180, { label: 'Cambio de sesión', block: 'Pausa', cue: 'Bebe y suelta: llega el tempo' }));
      const tempo = r5(clamp(B * 0.3 * k.L, 480, 1200));
      const t1 = r5(tempo / 2);
      out.push(k.run(t1, { off: 0.2, label: 'Tempo', block: 'Parte 2', cue: k.cue('tempo') }));
      out.push(k.run(tempo - t1, { off: round1(0.3 + lo(k)), label: 'Tempo · segunda mitad', block: 'Parte 2', cue: k.cue('mind') }));
      out.push(k.flex({ label: 'Rodaje final' }));
      return numberReps(out);
    }, { quality: true }),
  });

  /* ═════════════ Eventos de temporada ═════════════ */

  T({
    id: 'xmas-bells', title: 'Las doce campanadas', subtitle: 'Doce campanadas rápidas para despedir el año', category: 'challenge',
    family: 'reto', themes: [TH.mixto, TH.velocidad], intensity: 'hard', durations: ALL, event: 'navidad', focus: 'Velocidad festiva',
    description: 'Clase de Navidad: en los días largos suenan primero los cuartos y después las doce campanadas, cada una un cambio rápido. Una uva, un cambio: entra en el año nuevo corriendo.',
    coachNotes: ['Una campanada, un cambio: no te comas las uvas antes de tiempo.', 'Entre campanadas, trote para respirar.', 'La duodécima, con todo: ¡feliz año!'],
    build: (ctx) => frame(ctx, (k, B) => {
      const work = k.long ? k.rng.pick([45, 60]) : 30;
      const cuartos = B >= 1500;
      const out = [k.flex()];
      let used = 0;
      if (cuartos) {
        for (let i = 0; i < 4; i++) {
          out.push(k.run(60, { off: 0.3, label: `Cuarto ${i + 1}`, block: 'Los cuartos', cue: i === 0 ? 'Suenan los cuartos: prepárate' : '' }));
          out.push(k.jog(45, { label: 'Trote', block: 'Los cuartos' }));
        }
        used = 4 * 105;
      }
      const rest = r5(clamp((B - 120 - used - 12 * work) / 11, 30, 120));
      for (let i = 0; i < 12; i++) {
        out.push(W(k.fast(work, { off: work === 30 ? round1((k.S - k.F) * 0.4) : 0.1, label: `Campanada ${i + 1}`, block: 'Campanadas',
          cue: i === 0 ? 'Primera campanada: una uva, un cambio' : i === 11 ? '¡Última campanada! Feliz año' : i === 5 ? k.cue('mind') : '' })));
        if (i < 11) out.push(k.rec(rest));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'san-silvestre', title: 'San Silvestre en casa', subtitle: 'La carrera de fin de año, tramo a tramo', category: 'challenge',
    family: 'reto', themes: [TH.records, TH.ritmo], intensity: 'hard', durations: MID, event: 'navidad', focus: 'Carrera popular',
    description: 'Tu San Silvestre particular: salida entre la multitud, avenidas, un repecho, la bajada y una recta de meta para cerrar el año con un sprint. Gorro de Papá Noel opcional.',
    coachNotes: ['La salida es lenta, como entre la multitud: no te agobies.', 'En el repecho, pasos cortos; en la bajada, suelta piernas.', 'La recta de meta es tuya: ¡que se oiga!'],
    build: (ctx) => frame(ctx, (k, B) => {
      const race = r5(clamp(B * 0.75, 900, 2700));
      const prof = k.rng.pick([
        [['Salida', 0.08, -0.4], ['Avenida', 0.3, 0], ['Bulevar', 0.2, 0.2], ['Repecho', 0.08, 0.5], ['Bajada', 0.1, -0.1], ['Último kilómetro', 0.14, 0.3]],
        [['Salida', 0.1, -0.3], ['Paseo', 0.25, -0.1], ['Avenida', 0.25, 0.1], ['Repecho', 0.06, 0.6], ['Bajada', 0.1, 0], ['Último kilómetro', 0.14, 0.3]],
      ]);
      const out = [k.flex()];
      const body = race - 90;
      prof.forEach(([label, w, off], i) => out.push(k.run(r5(body * w), { off: round1(off + lo(k)), label, block: 'San Silvestre',
        cue: i === 0 ? 'Salida entre la multitud: tranquilo, ya habrá sitio' : label === 'Repecho' ? 'Repecho: pasos cortos y brazos' : i === prof.length - 1 ? k.cue('mind') : '' })));
      out.push(W(k.fast(60, { off: 0.2, label: 'Recta de meta', block: 'San Silvestre', cue: 'Se ve la meta: sube el ritmo' })));
      out.push(W(k.sprint(30, { label: 'Meta del año', block: 'San Silvestre', cue: k.cue('last') })));
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out, 'Meta');
    }, { quality: true }),
  });

  T({
    id: 'turron-burner', title: 'Quematurrones', subtitle: 'Menú navideño: entrante, primero y postre', category: 'fartlek',
    family: 'fartlek', themes: [TH.fartlek, TH.mixto], intensity: 'moderate', durations: ALL, event: 'navidad', focus: 'Quemar las fiestas',
    description: 'Una clase de Navidad servida como un menú: entrante a ritmo de correr, un primer plato de cambios rápidos y de postre un par de sprints. Repite plato si el día es largo.',
    coachNotes: ['El entrante abre el apetito: ritmo cómodo.', 'El primer plato son cambios cortos: rápidos y sueltos.', 'El postre es dulce pero corto: dos sprints y a la sobremesa.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const ent = k.rng.pick([120, 150, 180]);
      const plates = k.rng.pick([3, 4]);
      const round = ent + plates * 90 + 2 * 90 + 60;
      const n = clamp(Math.floor((B - 60) / round), 1, 4);
      const out = [k.flex()];
      for (let r = 0; r < n; r++) {
        const block = `Menú ${r + 1}`;
        out.push(k.run(ent, { off: 0.2, label: 'Entrante', block, cue: r === 0 ? 'El entrante abre el apetito: ritmo cómodo' : '' }));
        for (let i = 0; i < plates; i++) {
          out.push(W(k.fast(45, { label: 'Primer plato', block, cue: i === 0 ? k.cue('fast') : '' })));
          out.push(k.jog(45, { off: -0.2, label: 'Trote', block }));
        }
        for (let i = 0; i < 2; i++) {
          out.push(W(k.sprint(30, { label: 'Postre', block, cue: i === 0 ? 'De postre, un sprint dulce' : '' })));
          out.push(k.rec(60, { off: -0.3 }));
        }
        out.push(k.jog(60, { label: 'Sobremesa', block }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });

  T({
    id: 'summer-sunset', title: 'Atardecer de verano', subtitle: 'Rodaje suave con pausas para beber', category: 'endurance',
    family: 'resistencia', themes: [TH.resistencia, TH.tecnica], intensity: 'easy', durations: ALL, event: 'verano', focus: 'Aeróbico con calor',
    description: 'Clase de verano para los días de calor: rodaje suave con pausas de hidratación y unos minutos de brisa algo más alegres. Con calor el pulso sube antes: aquí se respeta.',
    coachNotes: ['Con calor, el mismo ritmo cuesta más: baja una décima si hace falta.', 'En cada pausa, bebe aunque no tengas sed.', 'Ventilador a tope y toalla a mano.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const blk = k.rng.pick([300, 360, 420]);
      const breeze = k.rng.chance(0.5);
      const n = Math.max(1, Math.floor(B / (blk + 60)));
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push(k.jog(blk, { off: -0.2, label: 'Rodaje al atardecer', block: 'Atardecer', cue: i === 0 ? 'Con calor, el mismo ritmo cuesta más: escucha al cuerpo' : '' }));
        out.push(breeze && i % 2 ? k.jog(60, { off: 0.4, label: 'Brisa', block: 'Atardecer' }) : k.jog(60, { off: -0.8, label: 'Sorbo de agua', block: 'Atardecer', cue: 'Baja el ritmo, bebe un sorbo y sigue' }));
      }
      out.push(k.flex({ label: 'Rodaje final', off: -0.2 }));
      return out;
    }),
  });

  T({
    id: 'summer-dip', title: 'Chapuzones', subtitle: 'Zambullida rápida, nado a ritmo y toalla', category: 'fartlek',
    family: 'fartlek', themes: [TH.fartlek, TH.explosividad], intensity: 'moderate', durations: SHORT, event: 'verano', focus: 'Chispa sin pasarse',
    description: 'Clase de verano por ciclos de tres minutos: una zambullida rápida, un rato de nado a ritmo de correr suave y la toalla para secarte trotando. Fresca, corta y divertida.',
    coachNotes: ['La zambullida es corta: entra con decisión.', 'El nado es ritmo cómodo, no trote.', 'En la toalla, respira y bebe si hace calor.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const dive = k.rng.pick([30, 40, 45]);
      const swim = k.rng.pick([75, 90]);
      const cycle = dive + swim + 60;
      const n = clamp(Math.floor((B - 60) / cycle), 2, 12);
      const out = [k.flex()];
      for (let i = 0; i < n; i++) {
        const block = `Chapuzón ${i + 1}`;
        out.push(W(k.fast(dive, { off: 0.3, label: 'Zambullida', block, cue: i === 0 ? 'Zambullida: entra con decisión' : i === n - 1 ? k.cue('last') : '' })));
        out.push(k.run(swim, { off: -0.5, label: 'Nado', block }));
        out.push(k.jog(60, { off: -0.3, label: 'Toalla', block }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }),
  });

  T({
    id: 'anniversary-medley', title: 'Aniversario RITMUP', subtitle: 'Lo mejor del año en una sola clase', category: 'challenge',
    family: 'reto', themes: [TH.mixto, TH.records], intensity: 'hard', durations: ALL, event: 'aniversario', focus: 'Celebración',
    description: 'Clase de aniversario: una pirámide exprés, un crucero de cumpleaños, una vela rápida por cada bloque de la temporada y, para terminar, soplar las velas con un sprint.',
    coachNotes: ['Hoy se celebra: corre con una sonrisa.', 'Las velas son cortas y vivas: una detrás de otra.', 'Para soplar las velas, sprint final con todo.'],
    build: (ctx) => frame(ctx, (k, B) => {
      const candles = k.rng.pick([3, 4, 5]);
      const piece = 30 + 45 + 60 + 45 + 30 + 60 + 180 + 60 + candles * 60 - 30 + 60 + 30;
      const rounds = clamp(Math.floor((B - 60 + 120) / (piece + 120)), 1, 3);
      const out = [k.flex()];
      for (let r = 0; r < rounds; r++) {
        const tag = rounds > 1 ? ` ${r + 1}` : '';
        out.push(W(k.sprint(30, { label: 'Pirámide exprés', block: `Pirámide${tag}`, cue: r === 0 ? '¡Feliz aniversario! Empezamos con una pirámide exprés' : '' })));
        out.push(k.rec(45));
        out.push(W(k.fast(60, { label: 'Pirámide exprés · cima', block: `Pirámide${tag}` })));
        out.push(k.rec(45));
        out.push(W(k.sprint(30, { label: 'Pirámide exprés', block: `Pirámide${tag}` })));
        out.push(k.jog(60, { label: 'Trote', block: 'Recuperación' }));
        out.push(k.run(180, { off: 0.3, label: 'Crucero de cumpleaños', block: `Crucero${tag}`, cue: k.cue('tempo') }));
        out.push(k.jog(60, { label: 'Trote', block: 'Recuperación' }));
        for (let i = 0; i < candles; i++) {
          out.push(W(k.fast(30, { off: 0.3, label: `Vela ${i + 1}`, block: `Velas${tag}`, cue: i === 0 ? 'Una vela por cada bloque de la temporada' : '' })));
          if (i < candles - 1) out.push(k.jog(30, { label: 'Trote', block: `Velas${tag}` }));
        }
        out.push(k.jog(60, { label: 'Pide un deseo', block: 'Recuperación', cue: 'Pide un deseo… y prepárate para soplar' }));
        out.push(W(k.sprint(30, { label: 'Soplar las velas', block: `Velas${tag}`, cue: k.cue('last') })));
        if (r < rounds - 1) out.push(k.jog(120, { label: 'Trote entre rondas', block: 'Recuperación' }));
      }
      out.push(k.flex({ label: 'Trote de soltura' }));
      return numberReps(out);
    }, { quality: true }),
  });
}
