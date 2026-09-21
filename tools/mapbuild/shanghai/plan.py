"""Which Shanghai tiles to add. Municipality box at z11-13; disks around spots at z14-16 (in tiles, Chebyshev radius)."""
import json, math
spots = json.load(open('spots.json')); have = {}
for k in json.load(open('tiles_existing.json')):
    z, x, y = map(int, k.split('/')); have.setdefault(z, set()).add((x, y))
def merc(lat, lng):
    x = (lng + 180) / 360; s = math.sin(math.radians(lat)); return x, .5 - math.log((1+s)/(1-s)) / (4*math.pi)
BOX = (31.90, 120.80, 30.65, 122.20)                       # lat top, lng left, lat bottom, lng right (whole municipality)
# tile-radius around each spot's tile per zoom (None = whole municipality box)
RADIUS = {11: None, 12: None, 13: None, 14: 4, 15: 3, 16: 1}
def plan(radius=RADIUS):
    out = {}
    for z, r in radius.items():
        N = 2**z; want = set()
        if r is None:
            x0, y0 = merc(BOX[0], BOX[1]); x1, y1 = merc(BOX[2], BOX[3])
            want = {(x, y) for x in range(int(x0*N), int(x1*N)+1) for y in range(int(y0*N), int(y1*N)+1)}
        else:
            for _, lat, lng in spots:
                mx, my = merc(lat, lng); cx, cy = int(mx*N), int(my*N)
                want |= {(x, y) for x in range(cx-r, cx+r+1) for y in range(cy-r, cy+r+1)}
        out[z] = sorted(want - have.get(z, set()))
    return out
if __name__ == '__main__':
    p = plan(); est = {11: 2.0, 12: 2.5, 13: 3.0, 14: 3.8, 15: 6, 16: 12}
    tot = 0
    for z in sorted(p):
        kb = len(p[z]) * est[z]; tot += kb; print('z%d: +%d new tiles (have %d)  ~%.1f MB' % (z, len(p[z]), len(have.get(z, ())), kb/1024))
    print('estimated addition ~%.1f MB' % (tot/1024))
