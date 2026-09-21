import json, math, sys
sys.path.insert(0, '..')
import plan as P
from plan import merc, have, spots
RAD = {11: None, 12: None, 13: None, 14: 4, 15: 2}
def full_plan():
    p = P.plan(dict(RAD, **{}))
    # z16: only 3x3 around spots that have no z16 tile yet
    N = 2**16; want = set()
    for _, lat, lng in spots:
        mx, my = merc(lat, lng); cx, cy = int(mx*N), int(my*N)
        if (cx, cy) in have.get(16, set()): continue
        want |= {(x, y) for x in range(cx-1, cx+2) for y in range(cy-1, cy+2)}
    p[16] = sorted(want - have.get(16, set())); return p
def components(tiles):
    s = set(tiles); comps = []
    while s:
        seed = s.pop(); comp = [seed]; stack = [seed]
        while stack:
            x, y = stack.pop()
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    n = (x+dx, y+dy)
                    if n in s: s.remove(n); comp.append(n); stack.append(n)
        comps.append(comp)
    return comps
def bbox_gcj(z, tiles):
    N = 2**z; xs = [t[0] for t in tiles]; ys = [t[1] for t in tiles]
    lng0 = min(xs)/N*360-180; lng1 = (max(xs)+1)/N*360-180
    lat = lambda ty: math.degrees(math.atan(math.sinh(math.pi-2*math.pi*ty/N)))
    return lng0, lat(max(ys)+1), lng1, lat(min(ys))
if __name__ == '__main__':
    p = full_plan()
    for z in sorted(p): print('z%d +%d' % (z, len(p[z])))
    # z15/z16 need buildings: union of their tiles at z15 resolution
    t15 = set(p[15]) | {(x//2, y//2) for x, y in p[16]}
    comps = components(t15); print('z15/16 components:', len(comps), sorted(len(c) for c in comps))
    out = []
    for i, c in enumerate(sorted(comps, key=len, reverse=True)):
        x0, y0, x1, y1 = bbox_gcj(15, c)
        # GCJ -> WGS is a shift of about (+0.002 lat, -0.0045 lng); pad generously
        out.append({'name': 'cmp%d' % i, 'tiles': len(c), 'bbox': [round(x0-.0045-.004, 4), round(y0+.002-.004, 4), round(x1-.0045+.004, 4), round(y1+.002+.004, 4)]})
    for o in out: print(o)
    json.dump({'plan': {str(z): v for z, v in p.items()}, 'components': out}, open('plan.json', 'w'))
