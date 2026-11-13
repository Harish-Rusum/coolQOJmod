#!/usr/bin/env python3
"""finish.py: turns the images listed in catalog.json into the scenes the add-on ships, and writes
src/shared/scenes.js and LICENSES/scene-credits.md.

usage: finish.py <folder the catalog's files are relative to> <repo root>

Each scene gets the wall (cropped to 16:9, 2560 wide), a thumbnail and three frosted copies for the glass.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

FROST = {'a': (640, 360, 2.2), 'b': (320, 180, 2.5), 'c': (160, 90, 2.5)}


def linear(c):
    c = c / 255
    return np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def hsl_rgb(h, s, l):
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((h / 60) % 2 - 1))
    m = l - c / 2
    seg = [(c, x, 0), (x, c, 0), (0, c, x), (0, x, c), (x, 0, c), (c, 0, x)][int(h // 60) % 6]
    return [int(round((v + m) * 255)) for v in seg]


def analyze(img):
    """The same numbers the Studio works out for an uploaded picture (solve.js analyzePixels)."""
    small = img.convert('RGB').resize((320, 180), Image.BILINEAR)
    px = np.asarray(small, dtype=np.float32).reshape(-1, 3)
    soft = np.asarray(small.filter(ImageFilter.GaussianBlur(1.1)), dtype=np.float32).reshape(-1, 3)
    weight = np.array([0.2126, 0.7152, 0.0722])
    order, soft_order = np.argsort(px @ weight), np.argsort(soft @ weight)
    at = lambda a, o, p: [int(v) for v in a[o[min(len(o) - 1, int(p * len(o)))]]]
    mean = px.mean(axis=0)
    r, g, b = px[:, 0] / 255, px[:, 1] / 255, px[:, 2] / 255
    mx, mn = np.max(px / 255, axis=1), np.min(px / 255, axis=1)
    l = (mx + mn) / 2
    d = mx - mn
    s = np.where(d == 0, 0, d / np.clip(1 - np.abs(2 * l - 1), 1e-5, None))
    h = np.zeros_like(l)
    i0, i1, i2 = (mx == r) & (d > 0), (mx == g) & (d > 0), (mx == b) & (d > 0)
    h[i0] = ((g - b)[i0] / d[i0]) % 6
    h[i1] = (b - r)[i1] / d[i1] + 2
    h[i2] = (r - g)[i2] / d[i2] + 4
    h *= 60
    good = (s > 0.32) & (l > 0.22) & (l < 0.86)
    hist = np.zeros(18)
    np.add.at(hist, (h[good] / 20).astype(int) % 18, (s[good] ** 2) * (1 - np.abs(l[good] - 0.58)))
    ranked = np.argsort(-hist)
    first = int(ranked[0]) if hist.max() > 0 else 0
    second = next((int(k) for k in ranked[1:] if hist[k] > 0 and min(abs(k - first), 18 - abs(k - first)) >= 3), (first + 4) % 18)
    return {
        'mean': [int(v) for v in mean], 'meanLum': round(float(weight @ linear(mean)), 4), 'tone': [int(v) for v in mean],
        'hi': at(px, order, 0.999), 'lo': at(px, order, 0.001), 'hiBlur': at(soft, soft_order, 0.999), 'loBlur': at(soft, soft_order, 0.001),
        'accent': hsl_rgb(first * 20 + 10, 0.85, 0.72), 'accent2': hsl_rgb(second * 20 + 10, 0.8, 0.72),
    }


def trim_bars(img):
    """The 'screencap' look sometimes comes with letterbox bars. They would show as black strips behind the page."""
    a = np.asarray(img.convert('L'), dtype=np.float32)
    rows = a.mean(axis=1)
    h = len(rows)
    top = 0
    while top < h // 5 and rows[top] < 14:
        top += 1
    bottom = h
    while bottom > h - h // 5 and rows[bottom - 1] < 14:
        bottom -= 1
    return img.crop((0, top + (2 if top else 0), img.width, bottom - (2 if bottom < h else 0))) if top or bottom < h else img


def rgb(hex_):
    return [int(hex_[i:i + 2], 16) for i in (1, 3, 5)]


def main():
    src, root = Path(sys.argv[1]), Path(sys.argv[2])
    catalog = json.loads((Path(__file__).parent / 'catalog.json').read_text(encoding='utf-8'))
    out = root / 'scenes'
    out.mkdir(exist_ok=True)
    for old in out.glob('*.webp'):
        old.unlink()
    data = {}
    credits = ['# Scene credits', '', 'All scenes are original images made for this add-on. No series, character or artist was referenced when making them.', '']
    for rec in catalog:
        id_ = rec['id']
        img = trim_bars(Image.open(src / rec['file']).convert('RGB'))
        w, h = img.size
        crop_h = int(w * 9 / 16)
        if crop_h <= h:
            top = (h - crop_h) // 2
            img = img.crop((0, top, w, top + crop_h))
        else:
            crop_w = int(h * 16 / 9)
            left = (w - crop_w) // 2
            img = img.crop((left, 0, left + crop_w, h))
        wall = img.resize((2560, 1440), Image.LANCZOS)
        wall.save(out / f'{id_}.webp', quality=86, method=6)
        wall.resize((480, 270), Image.LANCZOS).save(out / f'{id_}-thumb.webp', quality=80, method=6)
        for level, (fw, fh, sigma) in FROST.items():
            wall.resize((fw, fh), Image.LANCZOS).filter(ImageFilter.GaussianBlur(sigma)).save(out / f'{id_}-frost-{level}.webp', quality=74, method=6)
        stats = analyze(wall)
        if rec.get('accent'):
            stats['accent'], stats['accent2'] = rgb(rec['accent']), rgb(rec['accent2'])
        data[id_] = {'name': rec['name'], 'ambient': rec['ambient'], 'blurb': rec['blurb'], 'stats': stats}
        credits.append(f"- {rec['name']} (`{id_}`): generated with {rec['source']}")
        print(id_, (out / f'{id_}.webp').stat().st_size // 1024, 'KB', flush=True)
    (root / 'src/shared/scenes.js').write_text(
        '/* Generated by tools/art/finish.py: the bundled scenes and their picture analysis. */\n(() => {\n  globalThis.QS = globalThis.QS || {};\n  globalThis.QS.SCENES = '
        + json.dumps(data, ensure_ascii=False, indent=2) + ';\n})();\n', encoding='utf-8')
    (root / 'LICENSES/scene-credits.md').write_text('\n'.join(credits) + '\n', encoding='utf-8')
    print(len(data), 'scenes ready')


if __name__ == '__main__':
    main()
