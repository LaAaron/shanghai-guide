"""Render the Shenzhen basemap tiles (GCJ-02 grid, app style) from the cached Overture data and write guides/shenzhen/tiles.js"""
import math, pickle, io, base64, json, sys, time, os
import numpy as np
from PIL import Image, ImageDraw
import shapely, shapely.wkb
from shapely import STRtree
from shapely.geometry import box

CLAT, CLNG = 22.5450, 114.0550
BG = (247, 242, 239); BUILD = (228, 224, 219); BUILD_EDGE = (214, 210, 205); PARK = (208, 234, 196); WATER = (170, 219, 255)
CASE = (196, 199, 204); ROAD = (255, 255, 255); ARTERIAL = (250, 214, 122); ARTERIAL_CASE = (232, 190, 92)
PARK_SUB = {'park', 'recreation', 'golf', 'protected', 'garden', 'zoo'}
ROAD_W = {'motorway': 22, 'trunk': 20, 'primary': 16, 'secondary': 13, 'tertiary': 10, 'residential': 7, 'living_street': 6, 'unclassified': 7,
          'service': 4, 'pedestrian': 5, 'footway': 2, 'path': 1.5, 'cycleway': 2, 'steps': 2, 'track': 3}
BIG = {'motorway', 'trunk', 'primary'}

# ---- vectorised WGS-84 -> GCJ-02 (same maths as wgs2gcj in app.js)
def gcj(lng, lat):
    x, y = lng - 105, lat - 35
    dl = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*np.sqrt(np.abs(x))
    dl += (20*np.sin(6*x*np.pi) + 20*np.sin(2*x*np.pi))*2/3 + (20*np.sin(y*np.pi) + 40*np.sin(y/3*np.pi))*2/3 + (160*np.sin(y/12*np.pi) + 320*np.sin(y*np.pi/30))*2/3
    dg = 300 + x + 2*y + .1*x*x + .1*x*y + .1*np.sqrt(np.abs(x))
    dg += (20*np.sin(6*x*np.pi) + 20*np.sin(2*x*np.pi))*2/3 + (20*np.sin(x*np.pi) + 40*np.sin(x/3*np.pi))*2/3 + (150*np.sin(x/12*np.pi) + 300*np.sin(x*np.pi/30))*2/3
    a, ee = 6378245.0, 0.00669342162296594323
    rad = lat/180*np.pi; m = np.sin(rad); m = 1 - ee*m*m; sm = np.sqrt(m)
    return lng + dg*180/(a/sm*np.cos(rad)*np.pi), lat + dl*180/((a*(1-ee))/(m*sm)*np.pi)
def conv(a): lng, lat = gcj(a[:, 0], a[:, 1]); return np.column_stack([lng, lat])
def load_wkb(rows, i=0): return shapely.transform(np.array([shapely.wkb.loads(bytes(r[i])) for r in rows], dtype=object), conv) if rows else np.array([], dtype=object)

class Layer:
    def __init__(self, geoms, attrs=None):
        self.g = np.asarray(geoms, dtype=object); self.attrs = attrs if attrs is not None else [None]*len(self.g)
        self.tree = STRtree(self.g) if len(self.g) else None
    def near(self, view):
        if self.tree is None: return []
        return self.tree.query(view)

class Data:
    def __init__(self, path):
        d = pickle.load(open(path, 'rb'))
        self.buildings = Layer(load_wkb(d['buildings']))
        self.water = Layer(load_wkb(d['water']), [r[1] for r in d['water']])
        self.land = Layer(load_wkb(d['land']), [r[1] for r in d['land']])
        lu = [r for r in d['land_use'] if r[1] in PARK_SUB or r[2] in PARK_SUB]
        self.land_use = Layer(load_wkb(lu), [r[1] for r in lu])
        rd = [r for r in d['roads'] if r[1] == 'road']
        self.roads = Layer(load_wkb(rd), [r[2] for r in rd])

def merc(lat, lng):
    x = (lng + 180) / 360; s = math.sin(math.radians(lat)); return x, .5 - math.log((1+s)/(1-s)) / (4*math.pi)
def tile_size(z): return 512 if z >= 16 else 256
def lat_of(ty, N): return math.degrees(math.atan(math.sinh(math.pi - 2*math.pi*ty/N)))

def polys(g):
    if g.geom_type == 'Polygon': yield g
    elif hasattr(g, 'geoms'):
        for p in g.geoms: yield from polys(p)
def lines(g):
    if g.geom_type == 'LineString': yield g
    elif hasattr(g, 'geoms'):
        for p in g.geoms: yield from lines(p)

def render(D, z, x, y, ss=2):
    S = tile_size(z); N = 2**z; W = S*ss
    lng0, lng1 = x/N*360 - 180, (x+1)/N*360 - 180; lat0, lat1 = lat_of(y+1, N), lat_of(y, N)
    pad = .12*(lng1-lng0); view = box(lng0-pad, lat0-pad, lng1+pad, lat1+pad)
    mpp = 156543.03392*math.cos(math.radians((lat0+lat1)/2))/N/(S/256)
    px = lambda c: ((merc(c[1], c[0])[0]*N - x)*W, (merc(c[1], c[0])[1]*N - y)*W)
    im = Image.new('RGB', (W, W), BG); dr = ImageDraw.Draw(im)
    def fill(g, col, edge=None):
        for p in polys(g):
            dr.polygon([px(c) for c in p.exterior.coords], fill=col, outline=edge)
            for h in p.interiors: dr.polygon([px(c) for c in h.coords], fill=BG)
    for L in (D.land, D.land_use):
        for i in L.near(view): fill(L.g[i], PARK)
    for i in D.water.near(view): fill(D.water.g[i], WATER)
    if z >= 15:
        for i in D.buildings.near(view): fill(D.buildings.g[i], BUILD, BUILD_EDGE if z >= 16 else None)
    def show(cls):
        if z <= 12: return cls in ('motorway', 'trunk', 'primary')
        if z == 13: return cls in ('motorway', 'trunk', 'primary', 'secondary')
        if z == 14: return cls in ('motorway', 'trunk', 'primary', 'secondary', 'tertiary')
        if z == 15: return cls not in ('footway', 'path', 'steps', 'cycleway', 'track', 'pedestrian', 'service')
        return cls != 'steps'
    idx = [i for i in D.roads.near(view) if show(D.roads.attrs[i])]
    idx.sort(key=lambda i: ROAD_W.get(D.roads.attrs[i], 6))
    for casing in (True, False):
        for i in idx:
            cls = D.roads.attrs[i]; big = cls in BIG and z <= 15
            w = max(1.0, (ROAD_W.get(cls, 6)*(.8 if z == 15 else 1) + (3 if casing else 0))/mpp)*ss if z >= 15 else max(1.2, (1.9 if cls in BIG else 1.2)*ss + (1.3*ss if casing else 0))
            col = (ARTERIAL_CASE if casing else ARTERIAL) if big else (CASE if casing else ROAD)
            for ln in lines(D.roads.g[i]): dr.line([px(c) for c in ln.coords], fill=col, width=int(round(w)), joint='curve')
    return im.resize((S, S), Image.LANCZOS)

# ---- which tiles: half-width in tiles around the centre tile, per zoom (also which data set draws them)
CG_LNG, CG_LAT = (lambda a: (a[0][0], a[1][0]))(gcj(np.array([CLNG]), np.array([CLAT])))
PLAN = {16: (3, 'A'), 15: (5, 'A'), 14: (6, 'B'), 13: (6, 'B'), 12: (5, 'C'), 11: (4, 'C')}
def centre_tile(z): mx, my = merc(CG_LAT, CG_LNG); return int(mx*2**z), int(my*2**z)

if __name__ == '__main__':
    out, sets, t0 = {}, {}, time.time()
    for z in sorted(PLAN, reverse=True):
        h, key = PLAN[z]
        if key not in sets: print('loading', key, flush=True); sets[key] = Data(f'city_{key}.pkl')
        cx, cy = centre_tile(z)
        for x in range(cx-h, cx+h+1):
            for y in range(cy-h, cy+h+1):
                im = render(sets[key], z, x, y); b = io.BytesIO(); im.save(b, 'WEBP', quality=72 if z >= 16 else 78, method=6)
                out[f'{z}/{x}/{y}'] = base64.b64encode(b.getvalue()).decode()
        print('z%d done: %d tiles so far, %.1f MB, %.0fs' % (z, len(out), sum(len(v) for v in out.values())/1e6, time.time()-t0), flush=True)
    os.makedirs('out', exist_ok=True)
    open('out/tiles.js', 'w').write('/* Shenzhen basemap tiles, drawn from Overture Maps data (ODbL). Generated: do not edit. */\nwindow.SG = window.SG || {};\nSG.MAP_TILES = ' + json.dumps(out, separators=(',', ':')) + ';\n')
    print('tiles.js: %.1f MB' % (os.path.getsize('out/tiles.js')/1e6))
