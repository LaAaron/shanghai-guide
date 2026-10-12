"""Draw zoom-15 and zoom-16 tiles for the extra areas with the app's own renderer (tools/mapbuild/build_tiles.py)
and write them to extra_tiles.json (merge that into guides/shenzhen/tiles.js). Tiles there replace older ones (which stopped at the old detail edge)."""
import sys, os, io, base64, json, math, time
from multiprocessing import Pool
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import build_tiles as bt
from areas import AREAS

def tiles_for(name, z):
    x0, y0, x1, y1 = AREAS[name]
    (gx0, gx1), (gy0, gy1) = bt.gcj(np.array([x0, x1]), np.array([y0, y1]))
    N = 2**z
    tx0, ty1 = int(bt.merc(gy0, gx0)[0]*N), int(bt.merc(gy0, gx0)[1]*N)
    tx1, ty0 = int(bt.merc(gy1, gx1)[0]*N), int(bt.merc(gy1, gx1)[1]*N)
    return [(z, x, y) for x in range(tx0, tx1+1) for y in range(ty0, ty1+1)]

D = None
def init(name):
    global D; D = bt.Data('extra_%s.pkl' % name)
def draw(t):
    z, x, y = t
    im = bt.render(D, z, x, y); b = io.BytesIO(); im.save(b, 'WEBP', quality=72 if z >= 16 else 78, method=6)
    return '%d/%d/%d' % t, base64.b64encode(b.getvalue()).decode()

if __name__ == '__main__':
    out = {}
    for name in AREAS:
        todo = tiles_for(name, 15) + tiles_for(name, 16)
        t0 = time.time()
        with Pool(8, initializer=init, initargs=(name,)) as p:
            for k, v in p.imap_unordered(draw, todo, chunksize=4): out[k] = v
        print('%s: %d tiles in %.0fs, %.1f MB' % (name, len(todo), time.time()-t0, sum(len(out[k]) for k in out)/1e6), flush=True)
    json.dump(out, open('extra_tiles.json', 'w'))
