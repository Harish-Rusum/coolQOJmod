#!/usr/bin/env python3
"""Subsets the OFL font sources into fonts/*.woff2.

usage: build_fonts.py <dir with the source .ttf files> <output dir>

The Japanese display faces keep kana, punctuation and JIS level 1 kanji, so words typed in the Studio
still render in the chosen face. Text faces keep Latin, Greek and math, which is all the page needs:
Chinese statement text uses the system's own CJK font.
"""
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont


def jis_level1():
    out = set()
    for hi in range(0x88, 0x99):
        for lo in list(range(0x40, 0x7F)) + list(range(0x80, 0xFD)):
            try:
                ch = bytes([hi, lo]).decode('shift_jis')
            except UnicodeDecodeError:
                continue
            if len(ch) == 1 and 0x4E00 <= ord(ch) <= 0x9FFF:
                out.add(ord(ch))
    return out


LATIN = set(range(0x20, 0x7F)) | set(range(0xA0, 0x180)) | set(range(0x2010, 0x2028)) | {0x2030, 0x2039, 0x203A, 0x20AC, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193}
KANA = set(range(0x3000, 0x3100)) | set(range(0xFF00, 0xFF70))
EXTRA_KANJI = {ord(c) for c in '第話編日常修行最終決戦危険度次回予告知番組表道場登場人物完撃破覚醒放送事故判定中審査結果時間切記憶限界再試出撃作画崩壊続同点勝負一閃本編序章特別訓練'}
GREEK = set(range(0x370, 0x400))
MATH = set(range(0x2200, 0x2300)) | set(range(0x2070, 0x20A0)) | {0x2113, 0x2115, 0x2124, 0x211D, 0x2102, 0x211A, 0x27E8, 0x27E9, 0x2026, 0x2032, 0x2033, 0x2308, 0x2309, 0x230A, 0x230B, 0x00D7, 0x00F7, 0x00B7, 0x0338}

JOBS = [
    # source file, output, unicodes, keep variation axes
    ('DelaGothicOne-Regular.ttf', 'dela-gothic.woff2', LATIN | KANA | EXTRA_KANJI | jis_level1()),
    ('ShipporiMinchoB1-ExtraBold.ttf', 'shippori-mincho.woff2', LATIN | KANA | EXTRA_KANJI | jis_level1()),
    ('YujiBoku-Regular.ttf', 'yuji-boku.woff2', LATIN | KANA | EXTRA_KANJI | jis_level1()),
    ('RocknRollOne-Regular.ttf', 'rocknroll.woff2', LATIN | KANA | EXTRA_KANJI | jis_level1()),
    ('MochiyPopOne-Regular.ttf', 'mochiy-pop.woff2', LATIN | KANA | EXTRA_KANJI | jis_level1()),
    ('DotGothic16-Regular.ttf', 'dotgothic.woff2', LATIN | KANA | EXTRA_KANJI | jis_level1()),
    ('ZenKurenaido-Regular.ttf', 'zen-kurenaido.woff2', LATIN | KANA | EXTRA_KANJI | jis_level1()),
    ('KleeOne-SemiBold.ttf', 'klee-one.woff2', LATIN | KANA | EXTRA_KANJI | jis_level1()),
    ('ZenMaruGothic-Black.ttf', 'zen-maru-black.woff2', LATIN | KANA | EXTRA_KANJI | jis_level1()),
    ('ZenMaruGothic-Medium.ttf', 'zen-maru.woff2', LATIN | KANA),
    ('MonaSans[wdth,wght].ttf', 'mona-sans.woff2', LATIN),
    ('JetBrainsMono[wght].ttf', 'jetbrains-mono.woff2', LATIN | set(range(0x2500, 0x2580))),
    ('STIXTwoText[wght].ttf', 'stix-two.woff2', LATIN | GREEK | MATH),
    ('STIXTwoText-Italic[wght].ttf', 'stix-two-italic.woff2', LATIN | GREEK | MATH),
]


def build(src_dir, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    for src, out, codes in JOBS:
        font = TTFont(src_dir / src)
        options = subset.Options()
        options.flavor = 'woff2'
        options.layout_features = ['kern', 'liga', 'ccmp', 'locl', 'mark', 'mkmk', 'calt', 'vert', 'vrt2', 'palt', 'tnum', 'frac', 'sups', 'subs']
        options.notdef_outline = True
        options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
        options.hinting = False
        options.desubroutinize = True
        sub = subset.Subsetter(options)
        sub.populate(unicodes=codes)
        sub.subset(font)
        font.flavor = 'woff2'
        font.save(out_dir / out)
        print(f'{out:28s} {(out_dir / out).stat().st_size / 1024:8.1f} KB')


if __name__ == '__main__':
    build(Path(sys.argv[1]), Path(sys.argv[2]))
