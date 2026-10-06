"""What the guide already knows: its guides (Shanghai, Shenzhen, ...), categories, districts and existing spots.

Everything is read from the app's own data files, so a new guide in data/guides.js or a new category in a guide's
places.js is picked up without touching this folder. Nothing here writes to the app.
"""
import datetime, json, os, re, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Official districts, written the way the guide already writes them. Districts found in the data files are added too.
DISTRICTS = {
    'shanghai': ['Huangpu', 'Xuhui', 'Changning', "Jing'an", 'Putuo', 'Hongkou', 'Yangpu', 'Pudong', 'Minhang', 'Baoshan',
                 'Jiading', 'Songjiang', 'Qingpu', 'Fengxian', 'Jinshan', 'Chongming'],
    'shenzhen': ['Futian', 'Luohu', 'Nanshan', 'Yantian', "Bao'an", 'Longgang', 'Longhua', 'Pingshan', 'Guangming', 'Dapeng'],
}
LIMITS = {'name': 80, 'zh': 60, 'district': 40, 'addr': 200, 'note': 200, 'flag': 200}   # same as tools/inbox.py


def rd(rel): return open(os.path.join(ROOT, rel), encoding='utf-8').read()


def guides():
    m = re.search(r'SG\.GUIDES = (\[.*\]);', rd('data/guides.js'), re.S)
    return json.loads(m.group(1))


def categories():
    """{id: label} from the first guide's places.js (every guide uses the same categories)."""
    src = rd(guides()[0]['places'])
    return dict(re.findall(r'^\s+(\w+):\s*\{\s*label:\s*"([^"]+)"', src, re.M))


def existing_spots(g):
    """Every spot already in a guide: seed spots plus added ones, as dicts with id, name, zh."""
    out = [{'id': i, 'name': n, 'zh': z} for i, n, z in
           re.findall(r'\{\s*id:"([^"]+)",\s*name:"([^"]*)",\s*zh:"([^"]*)"', rd(g['places']))]
    m = re.search(r'SG\.ADDED_PLACES = (\[.*\]);', rd(g['added']), re.S)
    out += json.loads(m.group(1)) if m else []
    return out


def districts(g):
    seen = DISTRICTS.get(g['id'], [])[:]
    for s in existing_spots(g):
        d = s.get('district')
        if d and d not in seen and d != 'Unsorted': seen.append(d)
    for m in re.findall(r'district:"([^"]+)"', rd(g['places'])):
        if m not in seen: seen.append(m)
    return seen


def in_area(g, lat, lng):
    a = g['area']
    return a['latMin'] <= lat <= a['latMax'] and a['lngMin'] <= lng <= a['lngMax']


def norm(s):
    s = unicodedata.normalize('NFKC', s or '').lower()
    s = re.sub(r'[(（].*?[)）]', '', s)                     # drop "(Raffles City)" style branch names
    return re.sub(r'[\W_]+', '', s)


def find_duplicate(g, name, zh):
    n, z = norm(name), norm(zh)
    for s in existing_spots(g):
        if (n and len(n) > 3 and n == norm(s.get('name'))) or (z and len(z) > 1 and z == norm(s.get('zh'))):
            return s['id']
    return None


def slug(name, g, taken):
    base = re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()).strip('-')[:48]
    if len(base) < 6: base = (base + '-' + g['id']).strip('-')
    sid, n = base, 2
    while sid in taken:
        sid, n = '%s-%d' % (base, n), n + 1
    taken.add(sid)
    return sid


def clip(s, key, warnings):
    s = re.sub(r'\s+', ' ', s or '').strip()
    lim = LIMITS[key]
    if len(s) > lim:
        warnings.append('%s shortened to %d characters' % (key, lim))
        s = s[:lim - 1].rstrip() + '…'
    return s


def to_spots(extracted, source_url):
    """Turn Claude's raw places into guide-ready spots (the same fields as data/added.js), grouped with review info.

    Each result: {guide, spot, confidence, evidence, duplicate_of, warnings}. guide is None for places outside every guide."""
    gs = {g['id']: g for g in guides()}
    cats = categories()
    taken = set()
    for g in gs.values(): taken |= {s['id'] for s in existing_spots(g)}
    today = datetime.date.today().isoformat()
    out = []
    for p in extracted:
        warnings, flags = [], []
        g = gs.get(p.get('city'))
        lat, lng = p.get('lat'), p.get('lng')
        if (lat is None) != (lng is None): lat = lng = None
        if lat is not None:
            home = next((x for x in gs.values() if in_area(x, lat, lng)), None)
            if g is None and home is not None: g = home
            if g is not None and not in_area(g, lat, lng):
                flags.append('Coordinates fall outside %s — pin dropped, check the address' % g['place'])
                lat = lng = None
        conf = p.get('location_confidence') or 'unknown'
        if lat is None: conf = 'unknown' if conf == 'exact' else conf
        cat = p.get('cat') if p.get('cat') in cats else 'meal' if 'meal' in cats else 'other'
        district = p.get('district') or 'Unsorted'
        if g is not None and district not in districts(g) and district not in ('Multiple', 'Unsorted'):
            warnings.append('District "%s" is not one the %s guide uses' % (district, g['place']))
        if conf != 'exact':
            flags.append(p.get('location_note') or {'approximate': 'Approximate location', 'unknown': 'Location not known'}.get(conf, 'Location uncertain'))
        elif p.get('location_note'):
            flags.append(p['location_note'])
        spot = {
            'id': slug(p.get('name') or 'spot', g or {'id': 'spot'}, taken),
            'name': clip(p.get('name'), 'name', warnings),
            'zh': clip(p.get('zh'), 'zh', warnings),
            'cat': cat,
            'district': clip(district, 'district', warnings),
            'addr': clip(p.get('addr'), 'addr', warnings),
            'note': clip(p.get('note'), 'note', warnings),
            'lat': round(float(lat), 6) if lat is not None else None,
            'lng': round(float(lng), 6) if lng is not None else None,
            'approx': conf != 'exact',
        }
        if flags: spot['flag'] = clip(' · '.join(dict.fromkeys(flags)), 'flag', warnings)
        spot['by'], spot['at'] = 'Link import', today
        out.append({
            'guide': g['id'] if g else None,
            'spot': spot,
            'confidence': conf,
            'evidence': p.get('evidence', ''),
            'duplicate_of': find_duplicate(g, spot['name'], spot['zh']) if g else None,
            'amap': p.get('amap'),
            'warnings': warnings + ([] if g else ['Not in any guide area (%s)' % ', '.join(x['place'] for x in gs.values())]),
            'source': source_url,
        })
    return out
