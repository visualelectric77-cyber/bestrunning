#!/usr/bin/env python3
"""BestRunning · genera iconos y pantallas de arranque (splash) de forma programática.

Uso:  python3 tools/make-icons.py
Requiere Pillow (probado con 9.5). Todo se dibuja a 4× y se reduce con LANCZOS (antialias).

Logo original: degradado "ember" (#FF9500 → #FF5A1F → #FF2D55 en diagonal) y una marca blanca
de velocidad: chevrón adelante + tres líneas de velocidad + la banda de la cinta con sus rodillos.
"""
import math
import os
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, 'assets', 'icons')
SPLASH = os.path.join(ROOT, 'assets', 'splash')

SS = 4  # supersampling
EMBER = [(0.0, (0xFF, 0x95, 0x00)), (0.48, (0xFF, 0x5A, 0x1F)), (1.0, (0xFF, 0x2D, 0x55))]
BG = (0x08, 0x08, 0x0A)

# Geometría de la marca en una rejilla de 1024 (centro 512,512).
DX, DY = 34, -24
CHEVRON = [(500 + DX, 270 + DY), (722 + DX, 480 + DY), (500 + DX, 690 + DY)]
CHEVRON_W = 124
SPEED_LINES = [  # (x0, x1, y, ancho, opacidad)
    (282 + DX, 438 + DX, 380 + DY, 56, 0.6),
    (200 + DX, 548 + DX, 480 + DY, 64, 1.0),
    (282 + DX, 438 + DX, 580 + DY, 56, 0.6),
]
# Banda de la cinta: barra redondeada que se desvanece hacia atrás (estela de movimiento)
BELT = (226 + DX, 806 + DX, 826 + DY, 38, 0.12, 0.62)  # x0, x1, y, grosor, opacidad inicial, final


def lerp(a, b, t):
    return a + (b - a) * t


def ember_at(t):
    for (t0, c0), (t1, c1) in zip(EMBER, EMBER[1:]):
        if t <= t1:
            k = (t - t0) / (t1 - t0) if t1 > t0 else 0
            return tuple(int(round(lerp(c0[i], c1[i], k))) for i in range(3))
    return EMBER[-1][1]


def diagonal_gradient(size):
    """Degradado ember en diagonal (arriba-izquierda → abajo-derecha)."""
    h = Image.linear_gradient('L').rotate(90).resize((size, size))
    if h.getpixel((0, size // 2)) > 128:  # queremos 0 a la izquierda … 255 a la derecha
        h = ImageChops.invert(h)
    v = Image.linear_gradient('L').resize((size, size))  # 0 arriba … 255 abajo
    t = ImageChops.add(h, v, scale=2.0)  # (x + y) / 2
    lut = [ember_at(i / 255) for i in range(256)]
    r = t.point([c[0] for c in lut])
    g = t.point([c[1] for c in lut])
    b = t.point([c[2] for c in lut])
    return Image.merge('RGB', (r, g, b))


def radial_mask(size, cx, cy, radius, power=1.0):
    """Máscara L: 255 en el centro → 0 en `radius` (en píxeles), con caída suave."""
    # radial_gradient de Pillow vale 0 en el centro y 255 en la esquina (distancia ≈ 181 px):
    # lo reescalamos para que el borde (128 px) sea 0 y todo lo de fuera quede a 0.
    base = Image.radial_gradient('L')
    lut = []
    for i in range(256):
        t = max(0.0, 1.0 - (i / 255 * 181.02) / 128.0)
        t = t * t * (3 - 2 * t)  # smoothstep
        lut.append(int(round(255 * (t ** power))))
    base = base.point(lut)
    d = max(2, int(radius * 2))
    base = base.resize((d, d), Image.BICUBIC)
    w, h = (size, size) if isinstance(size, int) else size
    out = Image.new('L', (w, h), 0)
    out.paste(base, (int(cx - radius), int(cy - radius)))
    return out


def thick_segment(draw, a, b, w, fill=255):
    """Segmento grueso con extremos redondeados exactos (polígono + círculos)."""
    (x0, y0), (x1, y1) = a, b
    dx, dy = x1 - x0, y1 - y0
    ln = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / ln * w / 2, dx / ln * w / 2
    draw.polygon([(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)], fill=fill)
    r = w / 2
    for (x, y) in (a, b):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def mark_mask(size, scale=1.0):
    """Máscara de la marca (blanca) a `size` px, ya supersampleada por quien llama."""
    k = size / 1024.0
    m = Image.new('L', (size, size), 0)

    def tx(x, y):
        return ((512 + (x - 512) * scale) * k, (512 + (y - 512) * scale) * k)

    def stroke_line(p0, p1, w, alpha):
        layer = Image.new('L', (size, size), 0)
        thick_segment(ImageDraw.Draw(layer), tx(*p0), tx(*p1), w * scale * k, int(255 * alpha))
        return layer

    # Líneas de velocidad
    for (x0, x1, y, w, a) in SPEED_LINES:
        m = ImageChops.lighter(m, stroke_line((x0, y), (x1, y), w, a))
    # Banda de la cinta con opacidad creciente hacia delante
    x0, x1, y, w, a0, a1 = BELT
    layer = stroke_line((x0, y), (x1, y), w, 1.0)
    lo, hi = tx(x0 - w / 2, 0)[0], tx(x1 + w / 2, 0)[0]
    rp = Image.new('L', (size, size), 0)
    span = max(1, int(hi - lo))
    strip = Image.linear_gradient('L').rotate(90).resize((span, size))
    if strip.getpixel((0, size // 2)) > 128:
        strip = ImageChops.invert(strip)
    strip = strip.point(lambda v: int(255 * (a0 + (a1 - a0) * (v / 255))))
    rp.paste(strip, (int(lo), 0))
    layer = ImageChops.multiply(layer, rp)
    m = ImageChops.lighter(m, layer)

    # Chevrón: dos brazos con uniones redondeadas
    d = ImageDraw.Draw(m)
    ww = CHEVRON_W * scale * k
    pts = [tx(*p) for p in CHEVRON]
    thick_segment(d, pts[0], pts[1], ww)
    thick_segment(d, pts[1], pts[2], ww)
    return m


def render_icon(px, maskable=False):
    """Icono cuadrado a sangre (iOS aplica su propia máscara)."""
    S = px * SS
    img = diagonal_gradient(S)

    # Luz superior izquierda y sombra inferior derecha para dar volumen
    hl = radial_mask(S, S * 0.22, S * 0.08, S * 0.85, power=1.6)
    white = Image.new('RGB', (S, S), (255, 255, 255))
    img = Image.composite(white, img, hl.point(lambda v: int(v * 0.26)))
    dk = radial_mask(S, S * 1.0, S * 1.05, S * 0.9, power=1.4)
    deep = Image.new('RGB', (S, S), (0xB0, 0x0C, 0x34))
    img = Image.composite(deep, img, dk.point(lambda v: int(v * 0.45)))

    scale = 0.78 if maskable else 1.0
    mm = mark_mask(S, scale)

    # Sombra suave de la marca
    shadow = mm.filter(ImageFilter.GaussianBlur(S * 0.022))
    shadow = ImageChops.offset(shadow, 0, int(S * 0.018))
    shade = Image.new('RGB', (S, S), (0x7A, 0x08, 0x1C))
    img = Image.composite(shade, img, shadow.point(lambda v: int(v * 0.42)))

    # Marca blanca con un brillo cálido muy sutil abajo
    mark_color = Image.new('RGB', (S, S), (255, 255, 255))
    warm = Image.new('RGB', (S, S), (255, 236, 222))
    vg = Image.linear_gradient('L').resize((S, S))
    mark_color = Image.composite(warm, mark_color, vg.point(lambda v: int(v * 0.6)))
    img = Image.composite(mark_color, img, mm)

    return img.resize((px, px), Image.LANCZOS)


def rounded_mask(px, radius_ratio=0.2237):
    S = px * SS
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius_ratio), fill=255)
    return m.resize((px, px), Image.LANCZOS)


def load_font(size, weight='Bold', rounded=True):
    candidates = (
        ['/System/Library/Fonts/SFNSRounded.ttf'] if rounded else []
    ) + ['/System/Library/Fonts/SFNS.ttf', '/System/Library/Fonts/Helvetica.ttc']
    for path in candidates:
        if not os.path.exists(path):
            continue
        try:
            f = ImageFont.truetype(path, size)
            try:
                f.set_variation_by_name(weight)
            except Exception:
                pass
            return f
        except Exception:
            continue
    return ImageFont.load_default()


def render_splash(w, h, icon_img):
    S = SS // 2 or 1  # 2× basta para el texto; el fondo es suave
    W, H = w * S, h * S
    img = Image.new('RGB', (W, H), BG)

    # Resplandor ember radial (sutil) detrás del logo
    cy = H * 0.43
    glow = radial_mask((W, H), W / 2, cy, W * 0.95, power=2.4)
    ember = Image.new('RGB', (W, H), (0xFF, 0x5A, 0x1F))
    img = Image.composite(ember, img, glow.point(lambda v: int(v * 0.30)))
    glow2 = radial_mask((W, H), W / 2, cy, W * 0.45, power=2.0)
    rose = Image.new('RGB', (W, H), (0xFF, 0x2D, 0x55))
    img = Image.composite(rose, img, glow2.point(lambda v: int(v * 0.16)))

    # Logo (tile redondeado) con sombra
    tile = int(W * 0.235)
    ic = icon_img.resize((tile, tile), Image.LANCZOS)
    mask = rounded_mask(tile)
    x0, y0 = (W - tile) // 2, int(cy - tile / 2)
    sh = Image.new('L', (W, H), 0)
    sh.paste(mask, (x0, y0 + int(tile * 0.08)))
    sh = sh.filter(ImageFilter.GaussianBlur(tile * 0.12))
    img = Image.composite(Image.new('RGB', (W, H), (0x30, 0x06, 0x0E)), img, sh.point(lambda v: int(v * 0.85)))
    img.paste(ic, (x0, y0), mask)

    # Marca de texto "BestRunning" ("Running" en ember)
    fs = int(W * 0.082)
    font = load_font(fs, 'Heavy')
    d = ImageDraw.Draw(img)
    t1, t2 = 'Best', 'Running'
    w1 = d.textlength(t1, font=font)
    w2 = d.textlength(t2, font=font)
    tx = (W - (w1 + w2)) / 2
    ty = y0 + tile + int(tile * 0.30)
    d.text((tx, ty), t1, font=font, fill=(245, 245, 247))
    # Texto con degradado
    txt_mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(txt_mask).text((tx + w1, ty), t2, font=font, fill=255)
    # Degradado ajustado a la caja de la palabra
    grad = Image.new('RGB', (W, H), (0xFF, 0x5A, 0x1F))
    bbox = txt_mask.getbbox()
    if bbox:
        gw, gh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        g = diagonal_gradient(max(gw, gh)).resize((gw, gh))
        grad = Image.new('RGB', (W, H))
        grad.paste(g, (bbox[0], bbox[1]))
    img = Image.composite(grad, img, txt_mask)

    # Lema
    fs2 = int(W * 0.034)
    f2 = load_font(fs2, 'Semibold', rounded=False)
    d = ImageDraw.Draw(img)
    tag = 'Tu entrenador personal de cinta'
    tw = d.textlength(tag, font=f2)
    d.text(((W - tw) / 2, ty + fs * 1.45), tag, font=f2, fill=(150, 150, 160))

    return img.resize((w, h), Image.LANCZOS)


def svg_icon():
    """Mismo diseño en SVG (iconos vectoriales, favicon moderno)."""
    lines = []
    for (x0, x1, y, w, a) in SPEED_LINES:
        lines.append(
            f'<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke-width="{w}" stroke-opacity="{a}"/>'
        )
    x0, x1, y, w, a0, a1 = BELT
    belt = f'<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="url(#belt)" stroke-width="{w}"/>'
    belt_grad = (f'<linearGradient id="belt" gradientUnits="userSpaceOnUse" x1="{x0 - w / 2}" y1="0" x2="{x1 + w / 2}" y2="0">'
                 f'<stop offset="0" stop-color="#fff" stop-opacity="{a0}"/><stop offset="1" stop-color="#fff" stop-opacity="{a1}"/>'
                 '</linearGradient>')
    pts = ' '.join(f'{x},{y}' for (x, y) in CHEVRON)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    {belt_grad}
    <linearGradient id="ember" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FF9500"/>
      <stop offset="0.48" stop-color="#FF5A1F"/>
      <stop offset="1" stop-color="#FF2D55"/>
    </linearGradient>
    <radialGradient id="hl" cx="0.22" cy="0.08" r="0.85">
      <stop offset="0" stop-color="#fff" stop-opacity="0.26"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="dk" cx="1" cy="1.05" r="0.9">
      <stop offset="0" stop-color="#B00C34" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#B00C34" stop-opacity="0"/>
    </radialGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="22"/>
      <feOffset dy="18" result="b"/>
      <feFlood flood-color="#7A081C" flood-opacity="0.42"/>
      <feComposite in2="b" operator="in"/>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="1024" height="1024" rx="229" fill="url(#ember)"/>
  <rect width="1024" height="1024" rx="229" fill="url(#hl)"/>
  <rect width="1024" height="1024" rx="229" fill="url(#dk)"/>
  <g filter="url(#sh)" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">
    {''.join(lines)}
    {belt}
    <polyline points="{pts}" stroke-width="{CHEVRON_W}"/>
  </g>
</svg>
'''


def main():
    os.makedirs(ICONS, exist_ok=True)
    os.makedirs(SPLASH, exist_ok=True)

    big = render_icon(1024)
    big.save(os.path.join(ICONS, 'icon-1024.png'), optimize=True)
    for px in (512, 192, 180, 167, 152):
        big.resize((px, px), Image.LANCZOS).save(os.path.join(ICONS, f'icon-{px}.png'), optimize=True)

    render_icon(512, maskable=True).save(os.path.join(ICONS, 'icon-512-maskable.png'), optimize=True)

    # Favicon con esquinas redondeadas (transparente)
    fav = big.resize((32, 32), Image.LANCZOS).convert('RGBA')
    fav.putalpha(rounded_mask(32, 0.24))
    fav.save(os.path.join(ICONS, 'favicon-32.png'), optimize=True)

    with open(os.path.join(ICONS, 'icon.svg'), 'w', encoding='utf-8') as fh:
        fh.write(svg_icon())

    for (w, h) in ((1320, 2868), (1290, 2796), (1206, 2622), (1179, 2556)):
        render_splash(w, h, big).save(os.path.join(SPLASH, f'splash-{w}x{h}.png'), optimize=True)

    print('Iconos y splash generados en assets/icons y assets/splash')


if __name__ == '__main__':
    main()
