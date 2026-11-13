#!/usr/bin/env python3
"""Zips the add-on into dist/ for addons.mozilla.org. Tools and the dist folder itself stay out."""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEEP = ['manifest.json', 'README.md', 'LICENSES', 'icons', 'fonts', 'scenes', 'src', 'vendor']
SKIP_SUFFIX = {'.map', '.pyc'}


def main():
    version = json.loads((ROOT / 'manifest.json').read_text())['version']
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    out = dist / f'sakugo-studio-{version}.xpi'
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name in KEEP:
            p = ROOT / name
            files = [p] if p.is_file() else sorted(f for f in p.rglob('*') if f.is_file())
            for f in files:
                if f.suffix in SKIP_SUFFIX or f.name == 'meta.json' or f.name.startswith('.'):
                    continue
                z.write(f, f.relative_to(ROOT).as_posix())
    print(out, f'{out.stat().st_size / 1024 / 1024:.1f} MB')


if __name__ == '__main__':
    main()
