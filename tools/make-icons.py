#!/usr/bin/env python3
"""RITMUP · iconos de la web (PWA) y pantallas de arranque (splash) a partir del logotipo «Curva».

Uso:  python3 tools/make-icons.py            (iconos + splash)
      python3 tools/make-icons.py --splash-only
Requiere Pillow (probado con 9.5). No hace falta ningún rasterizador de SVG.

Fuente única: docs/brand-ritmup/curva/ (lo genera docs/brand-ritmup/curva/build.mjs).
  · icon-1024.png  → icon-1024/512/192/180/167/152 y favicon-32 (reducidos con LANCZOS, sin alfa: iOS
                     rellena de negro la transparencia de los apple-touch-icon).
  · icon-1024.svg  → icon.svg tal cual (favicon vectorial y miniatura de «Instala RITMUP» en Hoy).
  · mark.svg       → la «r» de pista (sus trazados M/L/A/Z se aplanan aquí a polígonos) para:
                     icon-512-maskable.png: el mismo azulejo, con la r al 40 % del alto, dentro de la zona segura
                     (círculo central del 80 %) de las máscaras de Android;
                     splash-*.png: negro puro, la r centrada a un 22 % del ancho y sin texto.
Todo lo que se dibuja aquí va a 4× y se reduce con LANCZOS.
"""
import math
import os
import re
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CURVA = os.path.join(ROOT, 'docs', 'brand-ritmup', 'curva')
ICONS = os.path.join(ROOT, 'assets', 'icons')
SPLASH = os.path.join(ROOT, 'assets', 'splash')

SS = 4  # supersampling
EMBER = (0xFF, 0x5A, 0x1F)
SPLASHES = ((1320, 2868), (1290, 2796), (1206, 2622), (1179, 2556))

# Azulejo del icono (icon-1024.svg): degradado vertical #141416 → #000 y un brillo blanco muy leve arriba
BG_TOP, BG_BOTTOM = (0x14, 0x14, 0x16), (0, 0, 0)
HL = ((0.0, 0.07), (0.012, 0.025), (0.30, 0.0))  # (posición, opacidad del blanco)
MARK_W, MARK_H = 68.0, 100.0  # caja de la r en unidades del logotipo
GLOW_SIGMA = 5.05             # desenfoque del halo ember (unidades del logotipo) · opacidad .35
GLOW_ALPHA = 0.35


# ───────────── trazados SVG (solo M, L, A, Z absolutos: los que usa build.mjs) ─────────────

def _arc_points(x0, y0, rx, ry, phi, large, sweep, x1, y1):
    """Arco elíptico de SVG (parametrización por extremos, SVG 1.1 F.6.5) → puntos intermedios y final."""
    if rx == 0 or ry == 0:
        return [(x1, y1)]
    cphi, sphi = math.cos(math.radians(phi)), math.sin(math.radians(phi))
    dx, dy = (x0 - x1) / 2, (y0 - y1) / 2
    x1p, y1p = cphi * dx + sphi * dy, -sphi * dx + cphi * dy
    rx, ry = abs(rx), abs(ry)
    lam = (x1p ** 2) / (rx ** 2) + (y1p ** 2) / (ry ** 2)
    if lam > 1:
        s = math.sqrt(lam)
        rx, ry = rx * s, ry * s
    num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
    den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
    co = math.sqrt(max(0.0, num / den)) if den else 0.0
    if large == sweep:
        co = -co
    cxp, cyp = co * rx * y1p / ry, -co * ry * x1p / rx
    cx = cphi * cxp - sphi * cyp + (x0 + x1) / 2
    cy = sphi * cxp + cphi * cyp + (y0 + y1) / 2

    def ang(ux, uy, vx, vy):
        a = math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
        return a

    t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not sweep and dt > 0:
        dt -= 2 * math.pi
    elif sweep and dt < 0:
        dt += 2 * math.pi
    n = max(8, int(abs(dt) * max(rx, ry) / 0.6))  # ~0,6 unidades por tramo
    pts = []
    for i in range(1, n + 1):
        t = t1 + dt * i / n
        ex, ey = rx * math.cos(t), ry * math.sin(t)
        pts.append((cphi * ex - sphi * ey + cx, sphi * ex + cphi * ey + cy))
    pts[-1] = (x1, y1)
    return pts


def parse_path(d):
    """'M… L… A… Z' → lista de polígonos [(x, y)…] en unidades del logotipo."""
    toks = re.findall(r'[MLAZmlaz]|-?\d*\.?\d+(?:e-?\d+)?', d)
    polys, cur, i, cmd = [], [], 0, None
    x = y = 0.0

    def num():
        nonlocal i
        v = float(toks[i])
        i += 1
        return v

    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd = t
            i += 1
            if cmd in 'Zz':
                if cur:
                    polys.append(cur)
                cur = []
                continue
        if cmd == 'M':
            if cur:
                polys.append(cur)
            x, y = num(), num()
            cur = [(x, y)]
            cmd = 'L'
        elif cmd == 'L':
            x, y = num(), num()
            cur.append((x, y))
        elif cmd == 'A':
            rx, ry, phi, large, sweep, nx, ny = num(), num(), num(), num(), num(), num(), num()
            cur.extend(_arc_points(x, y, rx, ry, phi, int(large), int(sweep), nx, ny))
            x, y = nx, ny
        else:
            raise ValueError(f'comando de trazado no soportado: {cmd}')
    if cur:
        polys.append(cur)
    return polys


def load_mark():
    """Trazados de la r desde docs/brand-ritmup/curva/mark.svg → (blanco, ember)."""
    with open(os.path.join(CURVA, 'mark.svg'), encoding='utf-8') as fh:
        svg = fh.read()
    paths = re.findall(r'<path\s+fill="([^"]+)"[^>]*\sd="([^"]+)"', svg)
    white = [d for fill, d in paths if fill.upper() != '#FF5A1F']
    ember = [d for fill, d in paths if fill.upper() == '#FF5A1F']
    if not white or not ember:
        raise SystemExit('mark.svg: no encuentro los trazados blanco y ember de la r')
    return [p for d in white for p in parse_path(d)], [p for d in ember for p in parse_path(d)]


def mask_of(polys, size, scale, ox, oy):
    """Máscara L de unos polígonos (unión; los de la r no se solapan) en un lienzo `size`, ya supersampleado."""
    m = Image.new('L', size, 0)
    dr = ImageDraw.Draw(m)
    for poly in polys:
        dr.polygon([(ox + px * scale, oy + py * scale) for px, py in poly], fill=255)
    return m


def draw_r(canvas, white, ember, scale, ox, oy, glow=False):
    """Pinta la r (blanca + calle ember) sobre `canvas` (RGB, supersampleado). (ox, oy) = esquina de su caja."""
    size = canvas.size
    em = mask_of(ember, size, scale, ox, oy)
    if glow:
        halo = em.filter(ImageFilter.GaussianBlur(GLOW_SIGMA * scale)).point(lambda v: int(v * GLOW_ALPHA))
        canvas.paste(Image.new('RGB', size, EMBER), (0, 0), halo)
    canvas.paste(Image.new('RGB', size, (255, 255, 255)), (0, 0), mask_of(white, size, scale, ox, oy))
    canvas.paste(Image.new('RGB', size, EMBER), (0, 0), em)


def tile_background(px):
    """Fondo del azulejo de icon-1024.svg a `px` (sin esquinas: iOS y Android ponen su máscara)."""
    col = Image.new('RGB', (1, px))
    for yy in range(px):
        t = yy / max(1, px - 1)
        base = [BG_TOP[c] + (BG_BOTTOM[c] - BG_TOP[c]) * t for c in range(3)]
        a = 0.0
        for (p0, a0), (p1, a1) in zip(HL, HL[1:]):
            if p0 <= t <= p1:
                a = a0 + (a1 - a0) * ((t - p0) / (p1 - p0) if p1 > p0 else 0)
                break
        col.putpixel((0, yy), tuple(int(round(v + (255 - v) * a)) for v in base))
    return col.resize((px, px))


def render_tile(px, r_height_ratio):
    """Azulejo del icono con la r centrada (como icon-1024.svg) y el alto de la r = `r_height_ratio` del lado."""
    white, ember = load_mark()
    big = px * SS
    img = tile_background(big)
    scale = big * r_height_ratio / MARK_H
    # Centro de la caja de la r en el mismo punto que icon-1024.svg (318,14 + 34·5,9392 ; 222,17 + 50·5,9392)
    cx, cy = (318.14 + MARK_W / 2 * 5.9392) / 1024 * big, (222.17 + MARK_H / 2 * 5.9392) / 1024 * big
    draw_r(img, white, ember, scale, cx - MARK_W / 2 * scale, cy - MARK_H / 2 * scale, glow=True)
    return img.resize((px, px), Image.LANCZOS)


def render_splash(w, h):
    """Negro puro y la r centrada a un 22 % del ancho, sin texto (empalma con la intro, también sobre negro)."""
    white, ember = load_mark()
    W, H = w * SS, h * SS
    img = Image.new('RGB', (W, H), (0, 0, 0))
    scale = W * 0.22 / MARK_W
    draw_r(img, white, ember, scale, (W - MARK_W * scale) / 2, (H - MARK_H * scale) / 2)
    return img.resize((w, h), Image.LANCZOS)


def official_icon():
    """icon-1024.png del logotipo, aplanado sobre negro (sin canal alfa)."""
    src = Image.open(os.path.join(CURVA, 'icon-1024.png')).convert('RGBA')
    flat = Image.new('RGB', src.size, (0, 0, 0))
    flat.paste(src, (0, 0), src)
    return flat if flat.size == (1024, 1024) else flat.resize((1024, 1024), Image.LANCZOS)


def rounded_mask(px, radius_ratio=0.2237):
    big = px * SS
    m = Image.new('L', (big, big), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, big - 1, big - 1], radius=big * radius_ratio, fill=255)
    return m.resize((px, px), Image.LANCZOS)


def make_splash():
    os.makedirs(SPLASH, exist_ok=True)
    for (w, h) in SPLASHES:
        render_splash(w, h).save(os.path.join(SPLASH, f'splash-{w}x{h}.png'), optimize=True)


def main():
    if '--splash-only' in sys.argv:
        make_splash()
        print('Splash regenerados en assets/splash')
        return

    os.makedirs(ICONS, exist_ok=True)
    big = official_icon()
    big.save(os.path.join(ICONS, 'icon-1024.png'), optimize=True)
    for px in (512, 192, 180, 167, 152):
        big.resize((px, px), Image.LANCZOS).save(os.path.join(ICONS, f'icon-{px}.png'), optimize=True)

    # Maskable: la r al 40 % del alto, holgada dentro del círculo seguro del 80 %
    render_tile(512, 0.40).save(os.path.join(ICONS, 'icon-512-maskable.png'), optimize=True)

    # Favicon con esquinas redondeadas (transparente fuera)
    fav = big.resize((32, 32), Image.LANCZOS).convert('RGBA')
    fav.putalpha(rounded_mask(32, 0.24))
    fav.save(os.path.join(ICONS, 'favicon-32.png'), optimize=True)

    with open(os.path.join(CURVA, 'icon-1024.svg'), encoding='utf-8') as fh:
        svg = fh.read()
    with open(os.path.join(ICONS, 'icon.svg'), 'w', encoding='utf-8') as fh:
        fh.write(svg if svg.endswith('\n') else svg + '\n')

    make_splash()
    print('Iconos y splash generados en assets/icons y assets/splash (desde docs/brand-ritmup/curva)')


if __name__ == '__main__':
    if '--check' in sys.argv:
        # Comprueba el aplanado de trazados: el azulejo dibujado aquí frente al icon-1024.png oficial
        mine = render_tile(1024, 5.9392 * MARK_H / 1024)
        diff = ImageChops.difference(mine, official_icon()).convert('L')
        hist = diff.histogram()
        n = sum(hist)
        print('diferencia media', round(sum(i * c for i, c in enumerate(hist)) / n, 3), '· píxeles > 32:', sum(hist[33:]))
        mine.save(os.path.join(os.environ.get('TMPDIR', '/tmp'), 'ritmup-tile-check.png'))
    else:
        main()
