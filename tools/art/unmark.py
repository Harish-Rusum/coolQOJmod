#!/usr/bin/env python3
"""unmark.py: removes the generator's corner sparkle from a set of images that all carry it in the same place.

usage: unmark.py <source dir> <out dir> <file> [<file> ...]

The mark is white laid over the art at some opacity. Comparing many images gives that opacity per pixel, and the blend
can then be undone, which keeps the real pixels underneath instead of painting over them.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def fill(crop, hole, steps=500):
    """What the area under the mark would look like going only by its surroundings."""
    out = crop.copy()
    out[hole] = crop[~hole].mean(axis=0)
    for _ in range(steps):
        avg = (np.roll(out, 1, 0) + np.roll(out, -1, 0) + np.roll(out, 1, 1) + np.roll(out, -1, 1)) / 4
        out[hole] = avg[hole]
    return out


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    names = sys.argv[3:]
    imgs = [np.asarray(Image.open(src / n).convert('RGB'), dtype=np.float32) for n in names]
    h, w = imgs[0].shape[:2]
    y0, y1, x0, x1 = h - 125, h - 5, w - 125, w - 5

    # first pass: where is it. Brighter than its surroundings in most images, at a scale larger than the mark.
    rough = []
    for a in imgs:
        crop = a[y0:y1, x0:x1].mean(axis=2)
        bg = np.asarray(Image.fromarray(crop.astype(np.uint8)).filter(ImageFilter.GaussianBlur(26)), dtype=np.float32)
        rough.append((crop - bg) / np.clip(255 - bg, 20, None))
    shape = np.median(np.stack(rough), axis=0) > 0.09
    hole = np.asarray(Image.fromarray((shape * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.MaxFilter(7)), dtype=np.float32) > 0
    ys, xs = np.nonzero(hole)
    print('mark at x', xs.min() + x0, xs.max() + x0, 'y', ys.min() + y0, ys.max() + y0, 'area', int(hole.sum()))

    # second pass: its opacity, from each image against that image's own surroundings. The median cancels the art.
    samples = []
    for a in imgs:
        crop = a[y0:y1, x0:x1]
        bg = fill(crop, hole)
        samples.append(np.clip((crop - bg) / np.clip(255 - bg, 30, None), 0, 1).mean(axis=2))
    alpha = np.where(hole, np.median(np.stack(samples), axis=0), 0)
    alpha = np.asarray(Image.fromarray((np.clip(alpha, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)), dtype=np.float32) / 255
    print('opacity median', round(float(np.median(alpha[hole])), 3), 'peak', round(float(alpha.max()), 3))

    solid = Image.fromarray((alpha > 0.04).astype(np.uint8) * 255)
    edge = np.asarray(solid.filter(ImageFilter.MaxFilter(5)), dtype=np.float32) > np.asarray(solid.filter(ImageFilter.MinFilter(5)), dtype=np.float32)

    for n, a in zip(names, imgs):
        res = a.copy()
        al = alpha[..., None]
        res[y0:y1, x0:x1] = np.clip((res[y0:y1, x0:x1] - al * 255) / (1 - al), 0, 255)
        # the mark's edge is the one place the opacity estimate is unsure: settle it from the pixels next to it
        fixed = Image.fromarray(res[y0:y1, x0:x1].astype(np.uint8))
        smooth = np.asarray(fixed.filter(ImageFilter.MedianFilter(5)), dtype=np.float32)
        res[y0:y1, x0:x1] = np.where(edge[..., None], smooth, res[y0:y1, x0:x1])
        Image.fromarray(res.astype(np.uint8)).save(out / (Path(n).stem + '.png'))


if __name__ == '__main__':
    main()
