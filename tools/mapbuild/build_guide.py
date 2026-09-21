"""Shenzhen guide data files (everything except the tiles): places, added, geo (metro + districts), labels."""
import json, pickle, re, os, math
import numpy as np, shapely, shapely.wkb
from shapely.geometry import mapping, Point
from shapely.ops import unary_union
from build_tiles import conv, gcj, CLAT, CLNG
OUT = 'out'; os.makedirs(OUT, exist_ok=True)
HDR = 'window.SG = window.SG || {};\n'

# ---- districts (GCJ-02), from Overture division areas
DIST = {'福田区': 'Futian', '罗湖区': 'Luohu', '南山区': 'Nanshan', '盐田区': 'Yantian', '龙华区': 'Longhua', '宝安区': "Bao'an", '龙岗区': 'Longgang', '坪山区': 'Pingshan', '光明区': 'Guangming'}
rows = pickle.load(open('city_DIV.pkl', 'rb'))['areas']
feats, wgs = [], []
for r in rows:
    if r[1] == 'localadmin' and r[6] == 'CN' and r[3] in DIST:
        g = shapely.wkb.loads(bytes(r[0])); wgs.append(g)
        g2 = shapely.transform(g, conv).simplify(0.0004, preserve_topology=True)
        feats.append({'type': 'Feature', 'properties': {'en': DIST[r[3]], 'zh': r[3][:-1]}, 'geometry': json.loads(json.dumps(mapping(g2)))})
def rnd(o):
    return [rnd(x) for x in o] if isinstance(o, (list, tuple)) else round(o, 5)
for f in feats: f['geometry']['coordinates'] = rnd(f['geometry']['coordinates'])
print('districts', [f['properties']['en'] for f in feats])
sz = unary_union(wgs).buffer(0.004)

# ---- metro stations (GCJ-02), from OpenStreetMap, only those inside Shenzhen (not Hong Kong's MTR)
els = json.load(open('metro_raw.json'))['elements']; st = []
for e in els:
    if 'lat' not in e or not sz.contains(Point(e['lon'], e['lat'])): continue
    t = e['tags']; nm = t.get('name:en') or t.get('name') or ''
    if not nm: continue
    lng, lat = gcj(np.array([e['lon']]), np.array([e['lat']])); st.append([nm, round(float(lat[0]), 5), round(float(lng[0]), 5)])
dedup = []
for s in st:
    if not any(s[0] == d[0] and abs(s[1]-d[1]) < .004 and abs(s[2]-d[2]) < .004 for d in dedup): dedup.append(s)
print('metro stations', len(dedup), dedup[:5])

open(f'{OUT}/geo.js', 'w', encoding='utf-8').write('/* Shenzhen metro stations and district shapes (GCJ-02). Districts: Overture Maps; stations: OpenStreetMap contributors (ODbL). */\n' + HDR +
    'SG.METRO_STATIONS = ' + json.dumps(dedup, ensure_ascii=False, separators=(',', ':')) + ';\nSG.SH_DISTRICTS = ' + json.dumps({'type': 'FeatureCollection', 'features': feats}, ensure_ascii=False, separators=(',', ':')) + ';\n')
open(f'{OUT}/labels.js', 'w').write('/* Shenzhen road and area names: added with the detailed map around your spots. */\n' + HDR + 'SG.ROAD_NAMES = [];\nSG.ROAD_POLYS = [];\nSG.AREAS = [];\n')
open(f'{OUT}/added.js', 'w').write('/* Spots added through the app and approved by tools/inbox.py. Do not edit by hand. */\n' + HDR + 'SG.ADDED_PLACES = [\n];\n')
cats = re.search(r'SG\.CATEGORIES = (\{.*?\n *\});', open('/Users/aaron/Documents/shanghai-guide/data/places.js', encoding='utf-8').read(), re.S).group(1)
open(f'{OUT}/places.js', 'w', encoding='utf-8').write('/* Shenzhen guide: categories and starting spots. */\n' + HDR + 'SG.CATEGORIES = ' + cats + ';\nSG.SEED_PLACES = [\n];\n')
print('written')
