#!/usr/bin/env python3
"""Run this after editing any file in the site folder.

    python3 tools/stamp.py

It fingerprints every cached file and rewrites sw.js (+ version.txt). Phones that already have the app then download
ONLY the files whose fingerprint changed, the next time they open it while online.
"""
import hashlib, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRECACHE = ['index.html', 'app.css', 'app.js', 'pwa.js', 'manifest.webmanifest', 'vendor/leaflet.css', 'vendor/leaflet.js',
            'data/guides.js', 'data/photos.js',
            'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/icon.svg']
# every guide's own data files are saved for offline use, whichever guide is showing
m = re.search(r'SG\.GUIDES = (\[.*\]);', open(os.path.join(ROOT, 'data', 'guides.js'), encoding='utf-8').read(), re.S)
for g in json.loads(m.group(1)):
    PRECACHE += [f for f in g['files'] if f not in PRECACHE]
PHOTOS = sorted('photos/' + f for f in os.listdir(os.path.join(ROOT, 'photos'))) if os.path.isdir(os.path.join(ROOT, 'photos')) else []
PRECACHE += [p for p in PHOTOS if p.endswith('.jpg')]        # shared photos are cached for offline too

def fp(p): return hashlib.sha256(open(os.path.join(ROOT, p), 'rb').read()).hexdigest()[:12]
assets = [[p, fp(p), os.path.getsize(os.path.join(ROOT, p))] for p in PRECACHE]
version = hashlib.sha256(json.dumps(assets).encode()).hexdigest()[:8]
tpl = open(os.path.join(ROOT, 'tools', 'sw.template.js'), encoding='utf-8').read()
open(os.path.join(ROOT, 'sw.js'), 'w', encoding='utf-8').write(tpl.replace('/*ASSETS*/[]', json.dumps(assets)).replace('__VERSION__', version))
open(os.path.join(ROOT, 'version.txt'), 'w').write(version + '\n')
print('version %s  (%d files, %.1f MB)' % (version, len(assets), sum(a[2] for a in assets) / 1e6))
