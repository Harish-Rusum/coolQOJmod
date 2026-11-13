#!/usr/bin/env python3
"""horde.py: generates scene art through the AI Horde and records how each image was made.

usage: horde.py <out dir> <jobs.json> [--parallel 3]

jobs.json is a list of {"id", "prompt", "model", "seed", "negative"?}. Finished images are skipped on a rerun, and every
image gets its prompt, model and seed written to <out dir>/provenance.json.
"""
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = 'https://aihorde.net/api/v2'
HEADERS = {'apikey': '0000000000', 'Client-Agent': 'sakugo-studio-art-build:0.2:none', 'Content-Type': 'application/json', 'User-Agent': 'sakugo-studio-art-build/0.2'}
NEGATIVE = ('nsfw, nude, cleavage, underwear, child, loli, shota, teenager, school uniform, lowres, bad anatomy, bad hands, '
            'extra fingers, deformed, ugly, text, letters, watermark, signature, logo, username, worst quality, low quality, jpeg artifacts, blurry')
NEEDS_CLIP2 = {'Nova Anime XL', 'Hassaku XL', 'noobEvo'}


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, headers=HEADERS, method=method)
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode())


def submit(job):
    params = {
        'sampler_name': job.get('sampler', 'k_euler_a'), 'cfg_scale': job.get('cfg', 6.5), 'width': job.get('w', 1344), 'height': job.get('h', 768),
        'steps': job.get('steps', 28), 'seed': str(job['seed']), 'n': 1, 'karras': False,
    }
    if job['model'] in NEEDS_CLIP2:
        params['clip_skip'] = 2
    return call('POST', '/generate/async', {
        'prompt': f"{job['prompt']} ### {job.get('negative', NEGATIVE)}", 'params': params, 'nsfw': False, 'censor_nsfw': True,
        'models': [job['model']], 'r2': True, 'slow_workers': True, 'trusted_workers': False,
    })['id']


def fetch(url, path):
    req = urllib.request.Request(url, headers={'User-Agent': HEADERS['User-Agent']})
    with urllib.request.urlopen(req, timeout=120) as res:
        path.write_bytes(res.read())


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    jobs = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
    parallel = int(sys.argv[sys.argv.index('--parallel') + 1]) if '--parallel' in sys.argv else 3
    prov_path = out / 'provenance.json'
    prov = json.loads(prov_path.read_text()) if prov_path.exists() else {}
    todo = [j for j in jobs if not (out / f"{j['id']}.webp").exists()]
    running = {}
    done = len(jobs) - len(todo)
    print(f'{done}/{len(jobs)} already made, {len(todo)} to go', flush=True)
    wait = 0
    while todo or running:
        while todo and len(running) < parallel:
            job = todo[0]
            try:
                running[submit(job)] = job
                todo.pop(0)
                wait = 0
            except urllib.error.HTTPError as e:
                detail = e.read().decode(errors='replace')[:200]
                print('refused', job['id'], e.code, detail, flush=True)
                if e.code == 429 or 'TooManyPrompts' in detail:
                    break
                if e.code in (400, 403):
                    todo.pop(0)  # this one will never be accepted
                else:
                    break
            except Exception as e:  # network hiccup: try again next round
                print('submit error', job['id'], e, flush=True)
                break
        time.sleep(12)
        wait += 12
        for rid, job in list(running.items()):
            try:
                st = call('GET', f'/generate/check/{rid}')
                if st.get('faulted') or st.get('is_possible') is False:
                    print('failed', job['id'], flush=True)
                    del running[rid]
                    continue
                if not st.get('done'):
                    if wait % 120 < 12:
                        print('waiting', job['id'], 'queue', st.get('queue_position'), 'eta', st.get('wait_time'), 'processing', st.get('processing'), flush=True)
                    continue
                res = call('GET', f'/generate/status/{rid}')
                gen = res['generations'][0]
                if gen.get('censored'):
                    print('censored by the worker', job['id'], flush=True)
                    del running[rid]
                    continue
                fetch(gen['img'], out / f"{job['id']}.webp")
                prov[job['id']] = {'model': gen.get('model'), 'seed': gen.get('seed'), 'prompt': job['prompt'], 'service': 'AI Horde'}
                prov_path.write_text(json.dumps(prov, ensure_ascii=False, indent=1))
                done += 1
                del running[rid]
                print(f"made {job['id']} ({done}/{len(jobs)}) with {gen.get('model')}", flush=True)
            except Exception as e:
                print('check error', job['id'], e, flush=True)
    print('finished', done, 'of', len(jobs), flush=True)


if __name__ == '__main__':
    main()
