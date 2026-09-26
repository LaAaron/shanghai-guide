# Shanghai Guide — notes for Claude Code sessions

Offline map + food guide, a static PWA on GitHub Pages: https://laaaron.github.io/shanghai-guide/ (repo `LaAaron/shanghai-guide`, branch `main`). No build step. The two users are Aaron (`LaAaron`) and Riya (`RiyaLaGivane`, invited as a collaborator 2026-09-26); the app is for a trip to Shanghai.

## How changes reach the live app
- Live app = this repo. A claude.ai chat or artifact is NOT connected to it (the old artifact at claude.ai/artifact/L4rz7xUSab23Z3zZMCNcmt is a dead copy).
- Day to day, spots and photos are added inside the app (+ button, camera button). With the sync key set, the app files GitHub issues and `.github/workflows/inbox.yml` + `tools/inbox.py` add them to `data/added.js`, `data/photos.js`, `photos/`.
- Anything else (bulk imports, code, map data) is done here: edit files, run `python3 tools/stamp.py`, test, commit, push. Phones then fetch only the changed files and show "Update ready".
- Aaron's standing decision covers sessions acting for Aaron only: for this repo, test then commit and push without asking each time, then tell him what changed and the new version (`version.txt`). It does not extend to a session acting for Riya or anyone else — check whose decision applies before assuming it's fine to push without asking.
- **Whose GitHub account is this session actually using?** A local session on Aaron's Mac uses his machine's own `gh`/git login. A claude.ai cloud session uses whichever GitHub account its own connector is authorized against — check this (e.g. `git log -1`, `gh auth status` if available) rather than assuming it matches whoever you're talking to. If a session for Riya finds it is authorized as Aaron (not `RiyaLaGivane`), pushes will succeed but will be authorised by Aaron's account regardless of the commit's author line — tell her this plainly and let her decide whether to switch her Claude account's GitHub connection to her own account at https://claude.ai/connect-github (pushes then need her to be an actual GitHub collaborator, or go via a fork + pull request) before pushing anything on her behalf.
- Git identity for commits: a session acting for Aaron uses `LaAaron <109358337+LaAaron@users.noreply.github.com>` (his existing commits use this). A session acting for Riya or anyone else should set its own local identity for that person (e.g. `git config user.name "RiyaLaGivane"` + a plausible email) — do not commit as `LaAaron` on someone else's behalf.
- Ask before any download from an outside source (state source and size).

## Layout
- `index.html`, `app.css`, `app.js`, `pwa.js`, `sw.js` (generated), `manifest.webmanifest`, `vendor/leaflet.*` (bundled; nothing may load from the internet at runtime: it must work offline in mainland China).
- `data/guides.js` lists the guides (title becomes a switcher when there are 2+): Shanghai and Shenzhen. `guides/shenzhen/` holds the Shenzhen guide (centre Futian; map tiles drawn from Overture Maps by `tools/mapbuild/`, see its README; no road/area name labels yet). The Shanghai guide is `data/places.js` (categories + 88 seed spots), `data/added.js` (spots added later), `data/geo.js`, `data/labels.js`, `data/tiles.js` (8.6 MB of map tiles). `data/photos.js` + `photos/` are shared photos (global).
- `tools/stamp.py` (fingerprints + service worker, run before every commit), `tools/inbox.py` (validates app submissions), `tools/dev.command` / `tools/dev.py` (live-reload preview on the Mac and in the iPhone simulator, http://localhost:8790).

## Traps
- Basemap tiles and pins are GCJ-02 (China's offset system); OpenStreetMap and phone GPS are WGS-84. Convert with `wgs2gcj` in `app.js` (skips points outside China). Mixing them puts things ~500 m off.
- Shanghai's road/area labels and detailed tiles only cover about 1 km around the original 88 spots; spots elsewhere get the coarse map. Shenzhen has detailed tiles only around Futian (about 4 km across) and no name labels yet; more detail is built around its spots when they are known. The original Shanghai tile generator no longer exists.
- Existing spots' pins cannot be moved from inside the app; change coordinates in the data file.
- Testing: the dev server disables the service worker; test offline/update behaviour on the live URL. `xcrun` needs `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`; Device Hub replaces Simulator.app.
