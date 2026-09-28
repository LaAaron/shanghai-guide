"""Looking places up on AMap (高德), so pins, districts and Chinese addresses come from a real map, not from memory.

Uses AMap's Web Service place search (https://restapi.amap.com/v3/place/text) with AMAP_KEY from .env. Its coordinates
are GCJ-02, the same system as the app's map. Without a key this step is skipped and Claude's own guesses stay flagged.
"""
import difflib, json, os, re, unicodedata, urllib.parse

import sources

API = 'https://restapi.amap.com/v3/place/text'

DISTRICTS_ZH = {   # AMap district name -> how the guide writes it
    '黄浦区': 'Huangpu', '徐汇区': 'Xuhui', '长宁区': 'Changning', '静安区': "Jing'an", '普陀区': 'Putuo', '虹口区': 'Hongkou',
    '杨浦区': 'Yangpu', '浦东新区': 'Pudong', '闵行区': 'Minhang', '宝山区': 'Baoshan', '嘉定区': 'Jiading', '松江区': 'Songjiang',
    '青浦区': 'Qingpu', '奉贤区': 'Fengxian', '金山区': 'Jinshan', '崇明区': 'Chongming',
    '福田区': 'Futian', '罗湖区': 'Luohu', '南山区': 'Nanshan', '盐田区': 'Yantian', '宝安区': "Bao'an", '龙岗区': 'Longgang',
    '龙华区': 'Longhua', '坪山区': 'Pingshan', '光明区': 'Guangming', '大鹏新区': 'Dapeng',
}
STRONG = 0.75            # name similarity counted as "the same place"


class AmapError(Exception):
    pass


def s(v):
    """AMap writes missing text fields as [] instead of ""."""
    return v if isinstance(v, str) else ''


def core(name):
    """A name without branch brackets, punctuation or spaces: 坤记兄弟牛肉店(福田店) -> 坤记兄弟牛肉店."""
    name = unicodedata.normalize('NFKC', name or '').lower()
    name = re.sub(r'[(\[【（].*?[)\]】）]', '', name)
    return re.sub(r'[\W_]+', '', name)


def similarity(a, b):
    a, b = core(a), core(b)
    if not a or not b: return 0.0
    if a in b or b in a: return max(0.85, min(len(a), len(b)) / max(len(a), len(b)))
    return difflib.SequenceMatcher(None, a, b).ratio()


def search(query, city_code):
    key = os.environ.get('AMAP_KEY')
    url = API + '?' + urllib.parse.urlencode({'key': key, 'keywords': query, 'city': city_code, 'citylimit': 'true',
                                              'offset': 10, 'page': 1, 'extensions': 'base'})
    data = json.loads(sources.get(url)[0])
    if str(data.get('status')) != '1':
        raise AmapError(data.get('info') or 'unknown error')
    return data.get('pois') or []


def lookup(place, g):
    """Returns (best poi or None, score, number of strong matches) for one place Claude found.
    With several branches, the one nearest Claude's own pin (if it gave one) wins."""
    queries = [q for q in dict.fromkeys([place.get('amap_query'), place.get('zh'), place.get('name')]) if q]
    best, score, strong = None, 0.0, {}
    for q in queries:
        pois = search(q, g.get('amapCity', ''))
        if pois and best is None and not re.search(r'[\u4e00-\u9fff]', q):
            best, score = pois[0], 0.3        # English-only name: AMap's names are Chinese, so take its top hit, flagged
        for poi in pois:
            sc = max(similarity(place.get('zh'), s(poi.get('name'))), similarity(place.get('name'), s(poi.get('name'))),
                     similarity(q, s(poi.get('name'))) * 0.9)
            if sc >= STRONG: strong[s(poi.get('id')) or s(poi.get('location'))] = poi
            if sc > score: best, score = poi, sc
        if score >= STRONG: break
    if len(strong) > 1 and place.get('lat') is not None:
        def dist(poi):
            try: lng, lat = (float(x) for x in s(poi.get('location')).split(','))
            except ValueError: return float('inf')
            return (lat - place['lat']) ** 2 + (lng - place['lng']) ** 2
        best = min(strong.values(), key=dist)
    return best, score, len(strong)


def enrich(places, gs):
    """Updates Claude's places in place with what AMap knows. Returns warnings for the whole result."""
    if not os.environ.get('AMAP_KEY'): return ['No AMap key, so pins come from Claude\'s memory only (see README)']
    for p in places:
        g = gs.get(p.get('city'))
        if g is None or not g.get('amapCity'): continue
        try:
            poi, score, n = lookup(p, g)
        except AmapError as e:
            return ['AMap lookup stopped: %s' % e]
        except Exception as e:
            return ['AMap lookup failed (%s)' % e]
        if poi is None:
            p['location_note'] = (p.get('location_note') + ' · ' if p.get('location_note') else '') + 'Not found on AMap'
            continue
        try:
            lng, lat = (float(x) for x in s(poi.get('location')).split(','))
        except ValueError:
            continue
        name, district = s(poi.get('name')), DISTRICTS_ZH.get(s(poi.get('adname')))
        p['amap'] = {'id': s(poi.get('id')), 'name': name, 'address': s(poi.get('address')), 'district': s(poi.get('adname')),
                     'tel': s(poi.get('tel')), 'lat': lat, 'lng': lng, 'match': round(score, 2)}
        p['lat'], p['lng'] = lat, lng
        if district: p['district'] = district
        if not p.get('zh') and score >= STRONG: p['zh'] = name
        zh_addr = s(poi.get('address'))
        if zh_addr and zh_addr not in (p.get('addr') or ''):
            p['addr'] = (p['addr'] + ' · ' + zh_addr) if p.get('addr') else zh_addr
        if score < STRONG:
            p['location_confidence'] = 'approximate'
            p['location_note'] = 'AMap\'s closest match is "%s" — check it is the same place' % name
        elif n > 1 and p.get('location_confidence') != 'exact':
            p['location_confidence'] = 'approximate'
            p['location_note'] = 'Chain: %d branches on AMap; pinned "%s" — check which branch the source means' % (n, name)
        else:
            p['location_confidence'], p['location_note'] = 'exact', ''
    return []
