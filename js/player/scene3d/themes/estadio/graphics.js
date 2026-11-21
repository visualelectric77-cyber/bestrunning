// ESTADIO · gráficos de canvas 2D (nítidos, versalitas con tracking de retransmisión): números de calle, rotulación
// pintada en la pista, el rótulo de retransmisión en pantalla («bug»: próximo cambio a N m / resultado del test VAM) y
// el gráfico final de distancia. Sin logotipos en las vallas (nada de texto detrás del HUD).
// Cada función reutiliza su canvas/textura: actualizar el texto no crea objetos nuevos en la GPU.

const UI = '-apple-system, "SF Pro Display", "SF Pro Text", BlinkMacSystemFont, "Helvetica Neue", system-ui, sans-serif';
const NUM = 'ui-rounded, "SF Pro Rounded", -apple-system, "SF Pro Display", system-ui, sans-serif';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tracked(ctx, text, x, y, track, align = 'left') {
  const chars = [...String(text)];
  let total = 0;
  for (const ch of chars) total += ctx.measureText(ch).width;
  total += track * Math.max(0, chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  ctx.textAlign = 'left';
  for (const ch of chars) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + track; }
  return total;
}

function measure(ctx, text, track) {
  let t = 0;
  const chars = [...String(text)];
  for (const ch of chars) t += ctx.measureText(ch).width;
  return t + track * Math.max(0, chars.length - 1);
}

function tex(THREE, c, aniso, mip = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = mip;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = aniso;
  return t;
}

/** Números de calle pintados antes de la línea de meta (1–8, alargados para leerse desde la pista). */
export function laneNumbersTexture(THREE, aniso) {
  const c = canvas(1024, 256);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 1024, 256);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.font = `700 200px ${UI}`;
  for (let i = 0; i < 8; i++) {
    ctx.fillText(String(i + 1), (i + 0.5) * 128 - ctx.measureText(String(i + 1)).width / 2, 132);
  }
  return tex(THREE, c, aniso);
}

/** Rotulación pintada en la calle («300», «1 KM», «MITAD», «ESCALÓN 7»): blanca, alargada como las marcas viales. */
export function makePaint(THREE, aniso) {
  const c = canvas(512, 256);
  const ctx = c.getContext('2d');
  const t = tex(THREE, c, aniso);
  let current = null;
  return {
    texture: t,
    aspect: 2,
    set(text, sub = '') {
      const key = `${text}|${sub}`;
      if (key === current) return;
      current = key;
      ctx.clearRect(0, 0, 512, 256);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      let size = sub ? 132 : 170;
      ctx.font = `800 ${size}px ${NUM}`;
      const tr = -0.02 * size;
      let w = measure(ctx, text, tr);
      if (w > 480) { size = Math.floor(size * (480 / w)); ctx.font = `800 ${size}px ${NUM}`; w = measure(ctx, text, tr); }
      tracked(ctx, text, 256, sub ? 150 : 132, -0.02 * size, 'center');
      if (sub) {
        ctx.font = `700 56px ${UI}`;
        tracked(ctx, sub.toLocaleUpperCase('es-ES'), 256, 46, 9, 'center');
      }
      t.needsUpdate = true;
    },
  };
}

/**
 * Rótulo de retransmisión en pantalla («bug», §16): placa oscura #0b0d12 al 88 %, borde fino, radio 11, barra del color
 * de la zona a la izquierda, etiqueta en versalitas con tracking y valor grande en cifras redondeadas. Se dibuja a
 * SCALE px por px CSS (nítido a DPR 3). Tamaños mínimos: etiqueta 11 px, valor 20 px (VAM: 13 / 34 px).
 */
export function makeBug(THREE) {
  const SCALE = 3;
  const c = canvas(16, 16);
  const ctx = c.getContext('2d');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  let current = null;
  const out = { texture: t, cssW: 160, cssH: 48 };
  out.set = (label, value, unit, color, big = false) => {
    const key = `${label}|${value}|${unit}|${color}|${big}`;
    if (key === current) return false;
    current = key;
    const lf = (big ? 13 : 11) * SCALE;
    const vf = (big ? 34 : 20) * SCALE;
    const uf = (big ? 14 : 11.5) * SCALE;
    const padL = 22 * SCALE;
    const padR = 16 * SCALE;
    const lbl = String(label).toLocaleUpperCase('es-ES');
    ctx.font = `700 ${lf}px ${UI}`;
    const lw = measure(ctx, lbl, 0.12 * lf);
    ctx.font = `800 ${vf}px ${NUM}`;
    const vw = measure(ctx, value, -0.01 * vf);
    ctx.font = `700 ${uf}px ${UI}`;
    const uw = unit ? measure(ctx, unit, 0.08 * uf) + 7 * SCALE : 0;
    const W = Math.ceil(padL + Math.max(lw, vw + uw) + padR);
    const H = Math.ceil((big ? 70 : 50) * SCALE);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; t.dispose(); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const r = 11 * SCALE;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(1.5, 1.5, W - 3, H - 3, r); else ctx.rect(1.5, 1.5, W - 3, H - 3);
    ctx.fillStyle = 'rgba(11,13,18,0.88)';
    ctx.fill();
    ctx.lineWidth = SCALE;
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.stroke();
    ctx.fillStyle = color || '#ffffff';
    const bh = H - 22 * SCALE;
    if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(10 * SCALE, 11 * SCALE, 3 * SCALE, bh, 1.5 * SCALE); ctx.fill(); } else ctx.fillRect(10 * SCALE, 11 * SCALE, 3 * SCALE, bh);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(235,235,245,0.66)';
    ctx.font = `700 ${lf}px ${UI}`;
    tracked(ctx, lbl, padL, (big ? 22 : 18) * SCALE, 0.12 * lf);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${vf}px ${NUM}`;
    const by = (big ? 58 : 41) * SCALE;
    tracked(ctx, value, padL, by, -0.01 * vf);
    if (unit) {
      ctx.font = `700 ${uf}px ${UI}`;
      ctx.fillStyle = 'rgba(235,235,245,0.75)';
      tracked(ctx, unit, padL + vw + 7 * SCALE, by, 0.08 * uf);
    }
    t.needsUpdate = true;
    out.cssW = W / SCALE;
    out.cssH = H / SCALE;
    return true;
  };
  return out;
}

/**
 * Gráfico de luz proyectado en la pista (test VAM): «ESCALÓN / 11 / 13,0 KM/H» o «TU VAM / 13,2 / KM/H». Tres líneas:
 * etiqueta arriba (la más lejana), el valor enorme y una línea de apoyo abajo. Se estira a lo largo de la pista (el
 * escorzo lo vuelve a encoger), así que aquí se dibuja con proporciones normales.
 */
export function makeFloor(THREE, aniso) {
  const W = 1024;
  const H = 640;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const t = tex(THREE, c, aniso);
  let current = null;
  const fit = (text, font, size, track, max) => {
    ctx.font = `800 ${size}px ${font}`;
    const w = measure(ctx, text, track * size);
    if (w <= max) return size;
    const s2 = Math.floor(size * (max / w));
    ctx.font = `800 ${s2}px ${font}`;
    return s2;
  };
  return {
    texture: t,
    /**
     * aspect = ancho / alto del hueco de PANTALLA donde se proyecta. El lienzo (1,6:1) se estira a ese hueco, así que
     * las letras se dibujan comprimidas a lo ancho para que en pantalla salgan con su proporción. Hueco alto ⇒ tres
     * líneas apiladas; hueco bajo y ancho (HUD del test con pulso y botón) ⇒ una sola línea.
     */
    set(label, value, sub = '', aspect = 1.6) {
      const a = Math.round(Math.max(0.8, Math.min(12, aspect)) * 8) / 8;
      const key = `${label}|${value}|${sub}|${a}`;
      if (key === current) return;
      current = key;
      const L = String(label).toLocaleUpperCase('es-ES');
      const S = String(sub).toLocaleUpperCase('es-ES');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      const sx = 1.6 / a;                 // compresión horizontal
      const WL = W / sx;                  // ancho lógico disponible
      ctx.setTransform(sx, 0, 0, 1, 0, 0);
      if (a <= 2.7) {
        // apilado: etiqueta arriba (la más lejana), el valor enorme y, si hay, una línea de apoyo
        const lf = fit(L, UI, 96, 0.16, WL - 70);
        tracked(ctx, L, WL / 2, 74, 0.16 * lf, 'center');
        const vs = fit(value, NUM, sub ? 330 : 400, -0.02, WL - 60);
        tracked(ctx, value, WL / 2, sub ? 318 : 370, -0.02 * vs, 'center');
        if (sub) {
          const sf = fit(S, UI, 104, 0.1, WL - 70);
          tracked(ctx, S, WL / 2, 560, 0.1 * sf, 'center');
        }
        ctx.fillRect(40 / sx, 136, WL - 80 / sx, 8);
        ctx.fillRect(40 / sx, H - 14, WL - 80 / sx, 8);
      } else {
        // en línea: «ESCALÓN 11 · VAM ≈ 13,0–14,0» a toda la altura del hueco
        const vsz = 470;
        const lsz = 300;
        const ssz = 250;
        const gap = 70;
        ctx.font = `800 ${lsz}px ${UI}`;
        const lw = measure(ctx, L, 0.1 * lsz);
        ctx.font = `800 ${vsz}px ${NUM}`;
        const vw = measure(ctx, value, -0.02 * vsz);
        ctx.font = `800 ${ssz}px ${UI}`;
        const sw = sub ? measure(ctx, S, 0.06 * ssz) + gap * 1.4 : 0;
        const total = lw + gap + vw + sw;
        const k = Math.min(1, (WL - 90) / total);
        ctx.setTransform(sx * k, 0, 0, 1, 0, 0);
        let x = (WL / k - total) / 2;
        const y = H / 2 + 6;
        ctx.font = `800 ${lsz}px ${UI}`;
        tracked(ctx, L, x, y + 30, 0.1 * lsz);
        x += lw + gap;
        ctx.font = `800 ${vsz}px ${NUM}`;
        tracked(ctx, value, x, y, -0.02 * vsz);
        x += vw + gap * 0.7;
        if (sub) {
          ctx.fillRect(x, y - 110, 14, 240);
          x += gap * 0.7;
          ctx.font = `800 ${ssz}px ${UI}`;
          tracked(ctx, S, x, y + 36, 0.06 * ssz);
        }
        ctx.setTransform(sx, 0, 0, 1, 0, 0);
        ctx.fillRect(30 / sx, 18, WL - 60 / sx, 14);
        ctx.fillRect(30 / sx, H - 32, WL - 60 / sx, 14);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      t.needsUpdate = true;
    },
  };
}

/** Gráfico final pintado en el césped: distancia total («6,42 KM») con etiqueta sobria; en el test, tu VAM. */
export function makeFinalGraphic(THREE, aniso) {
  const W = 1024;
  const H = 512;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const t = tex(THREE, c, aniso);
  return {
    texture: t,
    aspect: W / H,
    /** sub (opcional): tercera línea bajo el valor («Nueva marca · +0,2 km/h»); accent: color del valor y del filete. */
    set(value, label, sub = '', accent = '#ffffff') {
      ctx.clearRect(0, 0, W, H);
      ctx.textBaseline = 'middle';
      if (sub) {
        // con tres líneas (test VAM), una placa oscura translúcida detrás: se lee sobre el césped iluminado
        ctx.fillStyle = 'rgba(6,9,14,0.5)';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(40, 8, W - 80, H - 16, 36); else ctx.rect(40, 8, W - 80, H - 16);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(235,235,245,0.8)';
      ctx.font = `700 54px ${UI}`;
      tracked(ctx, String(label).toLocaleUpperCase('es-ES'), W / 2, sub ? 70 : 92, 14, 'center');
      ctx.fillStyle = accent;
      let size = sub ? 236 : 250;
      ctx.font = `800 ${size}px ${NUM}`;
      let w = measure(ctx, value, -6);
      if (w > W - 60) { size = Math.floor(size * ((W - 60) / w)); ctx.font = `800 ${size}px ${NUM}`; }
      tracked(ctx, value, W / 2, sub ? 250 : 300, -0.024 * size, 'center');
      if (sub) {
        ctx.fillStyle = 'rgba(235,235,245,0.92)';
        let sf = 58;
        ctx.font = `700 ${sf}px ${UI}`;
        const sw = measure(ctx, String(sub).toLocaleUpperCase('es-ES'), 8);
        if (sw > W - 60) { sf = Math.floor(sf * ((W - 60) / sw)); ctx.font = `700 ${sf}px ${UI}`; }
        tracked(ctx, String(sub).toLocaleUpperCase('es-ES'), W / 2, 418, 8 * (sf / 58), 'center');
        ctx.fillStyle = accent;
      }
      ctx.fillRect(W / 2 - 60, sub ? 476 : 448, 120, 6);
      t.needsUpdate = true;
    },
  };
}
