# Shanghai Guide — notes for Claude Code sessions

Offline map + food guide, a static PWA on GitHub Pages: https://laaaron.github.io/shanghai-guide/ (repo `LaAaron/shanghai-guide`, branch `main`). No build step. The two users are Aaron (`LaAaron`) and Riya (`RiyaLaGivane`); the app is for a trip to Shanghai.

## How changes reach the live app
- Live app = this repo. A claude.ai chat or artifact is NOT connected to it (the old artifact at claude.ai/artifact/L4rz7xUSab23Z3zZMCNcmt is a dead copy).
- Day to day, spots and photos are added inside the app (+ button, camera button). With the sync key set, the app files GitHub issues and `.github/workflows/inbox.yml` + `tools/inbox.py` add them to `data/added.js`, `data/photos.js`, `photos/`.
- Anything else (bulk imports, code, map data) is done here: edit files, run `python3 tools/stamp.py`, test, commit, push. Phones then fetch only the changed files and show "Update ready".
- Aaron's standing decision: for this repo only, test then commit and push without asking each time, then tell him what changed and the new version (`version.txt`). Still ask first before another repo, deleting the repo/branches/history, force-pushing, changing visibility or GitHub settings, or new kinds of automation.
- Commits use the repo-local identity `LaAaron <109358337+LaAaron@users.noreply.github.com>`. Ask before any download from an outside source (state source and size).

## Layout
- `index.html`, `app.css`, `app.js`, `pwa.js`, `sw.js` (generated), `manifest.webmanifest`, `vendor/leaflet.*` (bundled; nothing may load from the internet at runtime: it must work offline in mainland China).
- `data/guides.js` lists the guides (switcher when 2+). The Shanghai guide is `data/places.js` (categories + 88 seed spots), `data/added.js` (spots added later), `data/geo.js`, `data/labels.js`, `data/tiles.js` (8.6 MB of map tiles). `data/photos.js` + `photos/` are shared photos (global).
- `tools/stamp.py` (fingerprints + service worker, run before every commit), `tools/inbox.py` (validates app submissions), `tools/dev.command` / `tools/dev.py` (live-reload preview on the Mac and in the iPhone simulator, http://localhost:8790).

## Traps
- Basemap tiles and pins are GCJ-02 (China's offset system); OpenStreetMap and phone GPS are WGS-84. Convert with `wgs2gcj` in `app.js` (skips points outside China). Mixing them puts things ~500 m off.
- Road/area labels and detailed tiles only cover about 1 km around the original 88 spots; spots elsewhere get the coarse map.
- Existing spots' pins cannot be moved from inside the app; change coordinates in the data file.
- Testing: the dev server disables the service worker; test offline/update behaviour on the live URL. `xcrun` needs `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`; Device Hub replaces Simulator.app.
