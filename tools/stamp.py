#!/usr/bin/env python3
"""Run this after editing any file in the site folder.

    python3 tools/stamp.py

It fingerprints every cached file and rewrites sw.js (+ version.txt). Phones that already have the app then download
ONLY the files whose fingerprint changed, the next time they open it while online.
"""
import hashlib, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRECACHE = ['index.html', 'app.css', 'app.js', 'pwa.js', 'manifest.webmanifest', 'vendor/leaflet.css', 'vendor/leaflet.js',
            'data/places.js', 'data/added.js', 'data/geo.js', 'data/labels.js', 'data/tiles.js',
            'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/icon.svg']

def fp(p): return hashlib.sha256(open(os.path.join(ROOT, p), 'rb').read()).hexdigest()[:12]
assets = [[p, fp(p), os.path.getsize(os.path.join(ROOT, p))] for p in PRECACHE]
version = hashlib.sha256(json.dumps(assets).encode()).hexdigest()[:8]
tpl = open(os.path.join(ROOT, 'tools', 'sw.template.js'), encoding='utf-8').read()
open(os.path.join(ROOT, 'sw.js'), 'w', encoding='utf-8').write(tpl.replace('/*ASSETS*/[]', json.dumps(assets)).replace('__VERSION__', version))
open(os.path.join(ROOT, 'version.txt'), 'w').write(version + '\n')
print('version %s  (%d files, %.1f MB)' % (version, len(assets), sum(a[2] for a in assets) / 1e6))
