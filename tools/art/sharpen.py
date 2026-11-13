#!/usr/bin/env python3
"""sharpen.py: enlarges generated art to 2560 wide and crisps its lines, without the halos plain sharpening leaves.

usage: sharpen.py <art dir>     (reads tools/art/catalog.json, writes <art dir>/sharp/)

Sharpening at two scales, then every pixel is held inside the range of its near neighbours. Lines get harder edges but
never overshoot into a bright or dark rim. This restores no detail the source does not have.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def crisp(img):
    w, h = img.size
    big = img.resize((2560, round(h * 2560 / w)), Image.LANCZOS)
    scale = 2560 / w
    base = np.asarray(big, dtype=np.float32)
    fine = np.asarray(big.filter(ImageFilter.GaussianBlur(0.9 * scale)), dtype=np.float32)
    wide = np.asarray(big.filter(ImageFilter.GaussianBlur(2.6 * scale)), dtype=np.float32)
    gain = 0.5 + 0.35 * min(1, (scale - 1) / 1.5)  # softer sources get more
    out = base + (base - fine) * (gain * 2) + (base - wide) * (gain * 0.5)
    size = int(round(scale * 1.5)) * 2 + 1
    low = np.asarray(big.filter(ImageFilter.MinFilter(size)), dtype=np.float32)
    high = np.asarray(big.filter(ImageFilter.MaxFilter(size)), dtype=np.float32)
    return Image.fromarray(np.clip(np.clip(out, low, high), 0, 255).astype(np.uint8))


def main():
    art = Path(sys.argv[1])
    (art / 'sharp').mkdir(exist_ok=True)
    for rec in json.loads((Path(__file__).parent / 'catalog.json').read_text(encoding='utf-8')):
        stem = rec['orig']
        for src in (art / f'clean/{stem}.png', art / f'chatgpt/{stem}.png', art / f'batch/{stem}.webp'):
            if src.exists():
                break
        crisp(Image.open(src).convert('RGB')).save(art / 'sharp' / f"{rec['id']}.png")
        print(rec['id'], 'from', src.parent.name, flush=True)


if __name__ == '__main__':
    main()
