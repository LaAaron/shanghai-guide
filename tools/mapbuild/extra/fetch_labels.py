"""Fetch named roads, rivers, lakes and parks (with Chinese and English names) for the Shenzhen labels."""
import duckdb, pickle, time
R = 's3://overturemaps-us-west-2/release/2026-08-19.0'
x0, y0, x1, y1 = 113.870, 22.455, 114.175, 22.615          # Futian, Luohu, Nanshan, Shenzhen Bay, Shekou (WGS-84)
w = f"bbox.xmin<{x1} and bbox.xmax>{x0} and bbox.ymin<{y1} and bbox.ymax>{y0}"
con = duckdb.connect(); con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; SET threads=4;")
P = lambda th, ty: f"read_parquet('{R}/theme={th}/type={ty}/*', hive_partitioning=1)"
def q(sql):
    t = time.time(); r = con.execute(sql).fetchall(); print('  %d rows in %.0fs' % (len(r), time.time() - t), flush=True); return r
d = {}
d['roads'] = q(f"select geometry, class, names.primary, names.common['en'] from {P('transportation','segment')} where {w} and subtype='road' and class in ('motorway','trunk','primary','secondary','tertiary','residential','unclassified','living_street')")
d['water'] = q(f"select geometry, subtype, class, names.primary, names.common['en'] from {P('base','water')} where {w} and names.primary is not null")
d['land_use'] = q(f"select geometry, subtype, class, names.primary, names.common['en'] from {P('base','land_use')} where {w} and names.primary is not null")
pickle.dump(d, open('labels_src.pkl', 'wb')); print('saved', {k: len(v) for k, v in d.items()})
