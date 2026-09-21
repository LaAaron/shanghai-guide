"""Metro stations from OpenStreetMap (Overpass API) for the Shenzhen guide -> metro_raw.json (build_guide.py reads it)."""
import urllib.request, urllib.parse, json, time
UA = "shanghai-guide-personal-map/1.0 (one-off data pull)"
bb = "22.40,113.70,22.90,114.70"
q = f'[out:json][timeout:90];(node["station"="subway"]({bb});node["railway"="station"]["subway"="yes"]({bb});node["public_transport"="station"]["subway"="yes"]({bb}););out;'
for i in range(5):
    try:
        req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': UA, 'Accept': '*/*'})
        raw = urllib.request.urlopen(req, timeout=120).read(); break
    except Exception as e: print('retry', i, str(e)[:60]); time.sleep(8 * (i + 1))
json.dump(json.loads(raw), open('metro_raw.json', 'w')); print(len(raw) // 1024, 'KB')
