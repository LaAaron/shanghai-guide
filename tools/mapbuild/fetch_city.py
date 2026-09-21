"""Pull Overture Maps data for the Shenzhen guide. usage: fetch_city.py A|B|C|DIV"""
import duckdb, pickle, sys, math, time
R = 's3://overturemaps-us-west-2/release/2026-08-19.0'
CLAT, CLNG = 22.5450, 114.0550            # centre (WGS-84): Futian central district
def box(km):
    dlat = km / 110.86; dlng = km / (111.32 * math.cos(math.radians(CLAT))); return CLNG - dlng, CLAT - dlat, CLNG + dlng, CLAT + dlat
def bbf(b): x0, y0, x1, y1 = b; return f"bbox.xmin<{x1} and bbox.xmax>{x0} and bbox.ymin<{y1} and bbox.ymax>{y0}"
which = sys.argv[1]
con = duckdb.connect(); con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; SET threads=4;")
def q(sql):
    t = time.time(); r = con.execute(sql).fetchall(); print('  %d rows in %.0fs' % (len(r), time.time() - t), flush=True); return r
P = lambda th, ty: f"read_parquet('{R}/theme={th}/type={ty}/*', hive_partitioning=1)"
d = {}
if which == 'A':                                     # inner: everything
    b = box(6.6); w = bbf(b)
    d['buildings'] = q(f"select geometry from {P('buildings','building')} where {w}")
    d['water'] = q(f"select geometry, subtype from {P('base','water')} where {w}")
    d['land'] = q(f"select geometry, subtype from {P('base','land')} where {w} and subtype in ('grass','park','meadow')")
    d['land_use'] = q(f"select geometry, subtype, class from {P('base','land_use')} where {w}")
    d['roads'] = q(f"select geometry, subtype, class, names.primary, names.common from {P('transportation','segment')} where {w}")
elif which == 'B':                                   # mid: main roads, water, parks
    b = box(30); w = bbf(b)
    d['buildings'] = []
    d['water'] = q(f"select geometry, subtype from {P('base','water')} where {w}")
    d['land'] = []
    d['land_use'] = q(f"select geometry, subtype, class from {P('base','land_use')} where {w} and subtype in ('park','recreation','golf','protected','garden','zoo')")
    d['roads'] = q(f"select geometry, subtype, class, names.primary, names.common from {P('transportation','segment')} where {w} and subtype='road' and class in ('motorway','trunk','primary','secondary','tertiary')")
elif which == 'C':                                   # outer: overview
    b = box(95); w = bbf(b)
    d['buildings'] = []
    d['water'] = q(f"select geometry, subtype from {P('base','water')} where {w}")
    d['land'] = []; d['land_use'] = []
    d['roads'] = q(f"select geometry, subtype, class, names.primary, names.common from {P('transportation','segment')} where {w} and subtype='road' and class in ('motorway','trunk','primary')")
elif which == 'DIV':
    b = box(95); w = bbf(b)
    d['areas'] = q(f"select geometry, subtype, class, names.primary, names.common, region, country from {P('divisions','division_area')} where {w}")
pickle.dump(d, open(f'city_{which}.pkl', 'wb')); print('saved', which, {k: len(v) for k, v in d.items()}, flush=True)
