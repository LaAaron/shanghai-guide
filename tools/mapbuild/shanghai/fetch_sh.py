"""Overture pulls for the Shanghai fill-in. usage: fetch_sh.py R1|R2|cmpN"""
import duckdb, pickle, sys, json, time, math
sys.path.insert(0, '..')
from plan2 import bbox_gcj
R = 's3://overturemaps-us-west-2/release/2026-08-19.0'
name = sys.argv[1]; pl = json.load(open('plan.json'))
con = duckdb.connect(); con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; SET threads=2;")
def q(sql):
    t = time.time(); r = con.execute(sql).fetchall(); print('  %d rows in %.0fs' % (len(r), time.time() - t), flush=True); return r
P = lambda th, ty: f"read_parquet('{R}/theme={th}/type={ty}/*', hive_partitioning=1)"
def bbf(b): x0, y0, x1, y1 = b; return f"bbox.xmin<{x1} and bbox.xmax>{x0} and bbox.ymin<{y1} and bbox.ymax>{y0}"
PARKS = "('park','recreation','golf','protected','garden','zoo')"
d = {'buildings': [], 'land': []}
if name == 'R1':                                        # whole municipality overview
    w = bbf((120.75, 30.60, 122.25, 31.95))
    d['water'] = q(f"select geometry, subtype from {P('base','water')} where {w}")
    d['land_use'] = q(f"select geometry, subtype, class from {P('base','land_use')} where {w} and subtype in {PARKS}")
    d['roads'] = q(f"select geometry, subtype, class, names.primary, names.common from {P('transportation','segment')} where {w} and subtype='road' and class in ('motorway','trunk','primary','secondary')")
elif name == 'R2':                                      # z14 area: tertiary roads + parks
    x0, y0, x1, y1 = bbox_gcj(14, [tuple(t) for t in pl['plan']['14']]); w = bbf((x0-.0075, y0-.0025, x1-.0015, y1+.0065))
    d['water'] = q(f"select geometry, subtype from {P('base','water')} where {w}")
    d['land_use'] = q(f"select geometry, subtype, class from {P('base','land_use')} where {w} and subtype in {PARKS}")
    d['roads'] = q(f"select geometry, subtype, class, names.primary, names.common from {P('transportation','segment')} where {w} and subtype='road' and class in ('tertiary')")
else:                                                   # a z15/z16 component: everything
    b = next(c['bbox'] for c in pl['components'] if c['name'] == name); w = bbf(b)
    d['buildings'] = q(f"select geometry from {P('buildings','building')} where {w}")
    d['water'] = q(f"select geometry, subtype from {P('base','water')} where {w}")
    d['land'] = q(f"select geometry, subtype from {P('base','land')} where {w} and subtype in ('grass','park','meadow')")
    d['land_use'] = q(f"select geometry, subtype, class from {P('base','land_use')} where {w}")
    d['roads'] = q(f"select geometry, subtype, class, names.primary, names.common from {P('transportation','segment')} where {w}")
pickle.dump(d, open(f'sh_{name}.pkl', 'wb')); print('saved', name, {k: len(v) for k, v in d.items()}, flush=True)
