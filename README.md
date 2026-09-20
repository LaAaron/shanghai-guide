# Shanghai Guide (上海攻略)

An offline-first map and food guide. Static files only — no server, no build step.

- `index.html`, `app.css`, `app.js` — the app
- `data/` — the spots (`places.js`), metro + district shapes (`geo.js`), road and area names (`labels.js`), map tiles (`tiles.js`, 8.6 MB)
- `vendor/` — Leaflet 1.9.4, bundled so nothing loads from the internet
- `sw.js` — service worker: saves every file on the phone and updates only the files that changed
- `tools/stamp.py` — run `python3 tools/stamp.py` after editing any file, then push. It refreshes `sw.js` so phones know what changed.

Map data © OpenStreetMap contributors and Overture Maps (ODbL).
