// BestRunning · escena 3D · tipografía de retransmisión (SPEC §15.1): texturas de texto nítidas con canvas 2D,
// estilo F1 TV / Diamond League — versalitas, tracking amplio, SF. Mínima y nunca detrás del HUD (usar ctx.hud).
// Las texturas son sRGB con alfa (fondo transparente). Ojo con el tone mapping (va en el pase final, para toda la
// escena): el blanco puro (1,0) sale gris claro tras ACES a exposición 0,9; para un blanco limpio multiplicad el color
// del material por ~1,3 (makeTextPlane lo hace con `intensity`).

export const FONT_UI = '-apple-system, "SF Pro Text", "SF Pro Display", BlinkMacSystemFont, "Helvetica Neue", system-ui, sans-serif';
export const FONT_ROUNDED = 'ui-rounded, "SF Pro Rounded", -apple-system, "SF Pro Display", system-ui, sans-serif';

function drawTracked(ctx, text, x, y, track, align) {
  if (!track) { ctx.textAlign = align; ctx.fillText(text, x, y); return; }
  const chars = [...text];
  let total = 0;
  for (const ch of chars) total += ctx.measureText(ch).width;
  total += track * (chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  ctx.textAlign = 'left';
  for (const ch of chars) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + track; }
}

function measureTracked(ctx, text, track) {
  const chars = [...text];
  let total = 0;
  for (const ch of chars) total += ctx.measureText(ch).width;
  return total + track * Math.max(0, chars.length - 1);
}

/**
 * Textura de texto. opts:
 *  size=64 (px del lienzo) · weight=600 · font=FONT_UI · caps=true · tracking=0.12 (em) · color='#ffffff'
 *  align='center'|'left'|'right' · lineHeight=1.2 · pad=0.35 (em) · plate=null | { color:'rgba(11,13,18,.85)', radius:0.3 (em), border:'rgba(255,255,255,.08)' }
 *  texture (reutilizar una CanvasTexture existente al cambiar el texto) · THREE (obligatorio salvo con texture)
 * Devuelve una THREE.CanvasTexture con userData = { aspect, width, height }.
 */
export function makeTextTexture(THREE, text, opts = {}) {
  const {
    size = 64, weight = 600, font = FONT_UI, caps = true, tracking = 0.12, color = '#ffffff', align = 'center',
    lineHeight = 1.2, pad = 0.35, plate = null, texture = null, maxAnisotropy = 4,
  } = opts;
  const raw = String(text ?? '');
  const lines = (caps ? raw.toLocaleUpperCase('es-ES') : raw).split('\n');
  const canvas = texture?.image instanceof HTMLCanvasElement ? texture.image : document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontStr = `${weight} ${Math.round(size)}px ${font}`;
  ctx.font = fontStr;
  const track = tracking * size;
  let wMax = 0;
  for (const L of lines) wMax = Math.max(wMax, measureTracked(ctx, L, track));
  const padPx = pad * size;
  const W = Math.min(4096, Math.ceil(wMax + padPx * 2));
  const H = Math.min(4096, Math.ceil(lines.length * size * lineHeight + padPx * 2));
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
    texture?.dispose(); // otro tamaño: la GPU debe reservar de nuevo (se vuelve a subir al usarse)
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (plate) {
    const rad = (plate.radius ?? 0.3) * size;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(0.5, 0.5, W - 1, H - 1, rad); else ctx.rect(0.5, 0.5, W - 1, H - 1);
    ctx.fillStyle = plate.color || 'rgba(11,13,18,0.85)';
    ctx.fill();
    if (plate.border !== false) { ctx.strokeStyle = plate.border || 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke(); }
  }
  ctx.font = fontStr;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  const x = align === 'left' ? padPx : align === 'right' ? W - padPx : W / 2;
  lines.forEach((L, i) => drawTracked(ctx, L, x, padPx + size * lineHeight * (i + 0.5), track, align));
  const tex = texture || new THREE.CanvasTexture(canvas);
  if (!texture) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = maxAnisotropy;
  }
  tex.userData.aspect = W / H;
  tex.userData.width = W;
  tex.userData.height = H;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Plano de texto listo para añadir a la escena: altura `height` en unidades del mundo, ancho según el texto.
 * opts = los de makeTextTexture + { height=1, opacity=1, intensity=1.3 (multiplicador del color tras ACES),
 * depthTest=true, billboard=false }. Devuelve un Mesh con mesh.userData.setText(nuevoTexto).
 */
export function makeTextPlane(THREE, text, opts = {}) {
  const { height = 1, opacity = 1, intensity = 1.3, depthTest = true } = opts;
  const tex = makeTextTexture(THREE, text, opts);
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity, depthWrite: false, depthTest, color: new THREE.Color(intensity, intensity, intensity),
  });
  const mesh = new THREE.Mesh(geo, mat);
  const fit = () => mesh.scale.set(height * tex.userData.aspect, height, 1);
  fit();
  mesh.userData.setText = (t) => { makeTextTexture(THREE, t, { ...opts, texture: tex }); fit(); };
  mesh.userData.dispose = () => { geo.dispose(); mat.dispose(); tex.dispose(); };
  return mesh;
}
