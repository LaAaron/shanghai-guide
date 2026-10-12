"""Fetch full-detail Overture data (like fetch_city.py A) for one extra area. usage: fetch_extra.py luohu|nanshan"""
import duckdb, pickle, sys, time
from areas import AREAS, MARGIN
R = 's3://overturemaps-us-west-2/release/2026-08-19.0'
name = sys.argv[1]; x0, y0, x1, y1 = AREAS[name]; x0 -= MARGIN; y0 -= MARGIN; x1 += MARGIN; y1 += MARGIN
w = f"bbox.xmin<{x1} and bbox.xmax>{x0} and bbox.ymin<{y1} and bbox.ymax>{y0}"
con = duckdb.connect(); con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; SET threads=4;")
P = lambda th, ty: f"read_parquet('{R}/theme={th}/type={ty}/*', hive_partitioning=1)"
def q(sql):
    t = time.time(); r = con.execute(sql).fetchall(); print('  %d rows in %.0fs' % (len(r), time.time() - t), flush=True); return r
d = {}
d['buildings'] = q(f"select geometry from {P('buildings','building')} where {w}")
d['water'] = q(f"select geometry, subtype from {P('base','water')} where {w}")
d['land'] = q(f"select geometry, subtype from {P('base','land')} where {w} and subtype in ('grass','park','meadow')")
d['land_use'] = q(f"select geometry, subtype, class from {P('base','land_use')} where {w}")
d['roads'] = q(f"select geometry, subtype, class, names.primary, names.common from {P('transportation','segment')} where {w}")
pickle.dump(d, open(f'extra_{name}.pkl', 'wb')); print('saved', name, {k: len(v) for k, v in d.items()}, flush=True)
