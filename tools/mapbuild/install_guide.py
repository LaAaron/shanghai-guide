"""Copy the generated Shenzhen files into the repo and register the guide."""
import json, re, shutil, os
REPO = '/Users/aaron/Documents/shanghai-guide'
os.makedirs(f'{REPO}/guides/shenzhen', exist_ok=True)
for f in ('places.js', 'added.js', 'geo.js', 'labels.js', 'tiles.js'):
    shutil.copy(f'out/{f}', f'{REPO}/guides/shenzhen/{f}')
p = f'{REPO}/data/guides.js'; s = open(p, encoding='utf-8').read()
g = json.loads(re.search(r'SG\.GUIDES = (\[.*\]);', s, re.S).group(1))
g = [x for x in g if x['id'] != 'shenzhen']
g.append({"id": "shenzhen", "title": "深圳攻略", "subtitle": "Shenzhen Guide", "place": "Shenzhen", "china": True, "amapCity": "440300",
          "center": [22.54228, 114.06011], "zoom": 13,
          "area": {"latMin": 22.40, "latMax": 22.90, "lngMin": 113.70, "lngMax": 114.70},
          "demo": [22.54398, 114.06301, "Shenzhen Civic Center"],
          "places": "guides/shenzhen/places.js", "added": "guides/shenzhen/added.js",
          "files": [f"guides/shenzhen/{f}" for f in ('places.js', 'added.js', 'geo.js', 'labels.js', 'tiles.js')]})
head = s[:s.index('window.SG')]
open(p, 'w', encoding='utf-8').write(head + 'window.SG = window.SG || {};\nSG.GUIDES = [\n' + ',\n'.join(' ' + json.dumps(x, ensure_ascii=False, separators=(',', ':')) for x in g) + '\n];\n')
print('installed', [x['id'] for x in g])
