# Building a guide's map (how the Shenzhen guide was made)

Needs Python with `duckdb shapely numpy pillow`. Data: Overture Maps (release named in `fetch_city.py`, open data, ODbL, read straight from their public S3 bucket) and OpenStreetMap via Overpass (metro stations). Run in an empty working folder:

1. Edit the centre (`CLAT, CLNG`, WGS-84) in `fetch_city.py` and `build_tiles.py`, and the tile plan (`PLAN`) in `build_tiles.py`.
2. `python fetch_city.py A`, `B`, `C`, `DIV` (inner detail / mid roads and water / overview / district shapes; A is slow because of buildings, about 6 minutes) and `python fetch_metro.py`.
3. `python build_tiles.py` writes `out/tiles.js` (GCJ-02 tile grid; z16 tiles are 512 px, the others 256 px; WebP).
4. `python build_guide.py` writes `out/geo.js`, `out/places.js`, `out/added.js`, `out/labels.js` (change the district names for a different city).
5. `python install_guide.py` copies them to `guides/<id>/` and registers the guide in `data/guides.js` (edit its id, centre, area box, place name in that file), then `python tools/stamp.py`.

The Shenzhen guide covers the Futian centre in detail (zoom 16, about 4 km across), a wider zoom-15 area (12 km), and overview levels out to about 80 km. Road and area *name labels* are not generated yet (`labels.js` is empty).
Outside mainland China, skip the GCJ-02 conversion (`gcj` in `build_tiles.py`) and set `"china": false` in `data/guides.js`.

## Filling gaps in the Shanghai map (done once)
The original Shanghai tiles only covered blocks around the first spots. `shanghai/` holds the scripts that added the missing ones with the same renderer: `plan.py`/`plan2.py` decide which tiles are missing (province-wide at zoom 11-12, within ~30 km of a spot at 13, ~8 km at 14, ~2.5 km at 15, and detail at 16 around spots that had none), `fetch_sh.py` pulls the Overture data, `build_sh.py` draws them and merges with the existing `data/tiles.js` (existing tiles are never replaced). They expect `spots.json` (`[id, lat, lng]` for every spot) and `tiles_existing.json` (the current tile dictionary) in the working folder. Road and area name labels for the newer spots were not generated.
