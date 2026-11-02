#!/usr/bin/env python3
# RITMUP · prepara los recursos de los escenarios realistas (assets/world/<escenario>/) a partir de las descargas CC0
# de Poly Haven (texturas 1k: <id>_Diffuse.jpg, <id>_nor_gl.jpg, <id>_arm.jpg; panoramas «Tonemapped JPG» 8K).
#   python3 tools/world/build-assets.py <carpeta_descargas>      (contiene tex/ y hdri/)
# Por escenario:
#   sky.jpg + sky.json  recorte del panorama: azimut ±span alrededor del «frente» (columna A°) y elevación [el0, el1];
#                       sky.json guarda el recorte y el color del horizonte (lineal) para la niebla y lo de abajo
#   env.jpg             el panorama entero a 1024×512, girado para que el frente quede en la columna de 90° (u = 0,25,
#                       la dirección −z de three.js): iluminación de entorno (PMREM) y reflejos
#   <set>_diff/_nor/_arm.jpg  juegos PBR a 1024 px
import json, sys, os
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
SRC = sys.argv[1]
ONLY = set(sys.argv[2:])
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'world')

THEMES = {
    'costa': {'sky': ('blouberg_sunrise_2', 190, 80, -1.5, 72), 'sets': {'paving': 'rectangular_paving', 'beach': 'damp_beach_sand', 'dune': 'coast_sand_01'}},
    'desierto': {'sky': ('qwantani_night_puresky', 32, 80, -2, 76), 'sets': {'sand': 'aerial_sand', 'road': 'asphalt_02'}},
    'neon': {'sky': ('shanghai_bund', 196, 70, -2.5, 62), 'sets': {'road': 'asphalt_02', 'facade': 'concrete_tile_facade', 'walk': 'patterned_paving_02'}},
    'tunel': {'env': 'shanghai_bund', 'envA': 196, 'sets': {}},
    'bosque': {'sky': ('kloofendal_misty_morning_puresky', 0, 80, -2, 72), 'sets': {'floor': 'forest_floor'}},
    'nieve': {'sky': ('kloppenheim_07_puresky', 200, 80, -2, 72), 'sets': {'snow': 'snow_02'}},
}

def srgb_to_lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def crop_sky(img, A, span, el0, el1):
    W, H = img.size
    ppd = W / 360.0
    x0 = int(round((A - span) * ppd)); x1 = int(round((A + span) * ppd))
    y0 = int(round((90 - el1) * ppd)); y1 = int(round((90 - el0) * ppd))
    w = x1 - x0
    out = Image.new('RGB', (w, y1 - y0))
    # con vuelta en el azimut
    xs = x0 % W
    first = min(w, W - xs)
    out.paste(img.crop((xs, y0, xs + first, y1)), (0, 0))
    if first < w:
        out.paste(img.crop((0, y0, w - first, y1)), (first, 0))
    # color del horizonte: media de la franja de 0° a 1,5° alrededor del frente
    hy0 = int(round((90 - 1.5) * ppd)) - y0; hy1 = int(round(90 * ppd)) - y0
    band = out.crop((w // 4, max(0, hy0), 3 * w // 4, max(1, hy1))).resize((1, 1), Image.BOX).getpixel((0, 0))
    return out, [round(srgb_to_lin(v), 5) for v in band]

def env(img, A):
    W, H = img.size
    small = img.resize((1024, 512), Image.LANCZOS)
    shift = int(round((A - 90) / 360 * 1024)) % 1024
    out = Image.new('RGB', (1024, 512))
    out.paste(small.crop((shift, 0, 1024, 512)), (0, 0))
    out.paste(small.crop((0, 0, shift, 512)), (1024 - shift, 0))
    return out

cache = {}
def pano(name):
    if name not in cache:
        cache[name] = Image.open(os.path.join(SRC, 'hdri', name + '.jpg')).convert('RGB')
    return cache[name]

for tid, spec in THEMES.items():
    if ONLY and tid not in ONLY:
        continue
    d = os.path.join(OUT, tid)
    os.makedirs(d, exist_ok=True)
    if 'sky' in spec:
        name, A, span, el0, el1 = spec['sky']
        img = pano(name)
        sky, hor = crop_sky(img, A, span, el0, el1)
        q = 86 if tid == 'desierto' else 82
        sky.save(os.path.join(d, 'sky.jpg'), quality=q, optimize=True, progressive=True)
        json.dump({'source': name, 'az': [-span, span], 'el': [el0, el1], 'horizon': hor, 'size': sky.size},
                  open(os.path.join(d, 'sky.json'), 'w'))
        env(img, A).save(os.path.join(d, 'env.jpg'), quality=85)
    elif 'env' in spec:
        env(pano(spec['env']), spec['envA']).save(os.path.join(d, 'env.jpg'), quality=85)
    for key, src in spec['sets'].items():
        for kind, suf, q in (('Diffuse', 'diff', 82), ('nor_gl', 'nor', 88), ('arm', 'arm', 82)):
            im = Image.open(os.path.join(SRC, 'tex', f'{src}_{kind}.jpg')).convert('RGB')
            if im.size[0] > 1024:
                im = im.resize((1024, 1024), Image.LANCZOS)
            im.save(os.path.join(d, f'{key}_{suf}.jpg'), quality=q, optimize=True)
    print(tid, sorted(os.listdir(d)))
