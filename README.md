# Shanghai Guide (上海攻略)

## 👉 Open the app: https://laaaron.github.io/shanghai-guide/

**Install it on an iPhone (works offline):**
1. Open the link above in **Safari** on the iPhone, on Wi-Fi.
2. Wait until the cloud icon (top right, next to "88 spots") becomes a **green cloud with a tick**. It is saving the map to the phone (about 9 MB, once).
3. Tap the **Share** button → **Add to Home Screen** → **Add**. Open it from the new home-screen icon.

---

## About this repository (for developers)
An offline-first map and food guide. Static files only — no server, no build step.

- `index.html`, `app.css`, `app.js` — the app
- `data/` — the Shanghai guide: spots (`places.js`), metro + district shapes (`geo.js`), road and area names (`labels.js`), map tiles (`tiles.js`, 8.6 MB). `data/guides.js` lists the guides in the app.
- `vendor/` — Leaflet 1.9.4, bundled so nothing loads from the internet
- `sw.js` — service worker: saves every file on the phone and updates only the files that changed
- `guides/shenzhen/` — the Shenzhen guide's data; `tools/mapbuild/` — scripts that build a guide's map (see its README)
- `tools/inbox.py` — the GitHub job that turns app submissions into data (run locally with `python3 tools/inbox.py local spot LaAaron < body.txt`)
- `tools/stamp.py` — run `python3 tools/stamp.py` after editing any file, then push. It refreshes `sw.js` so phones know what changed.

## More than one guide
`data/guides.js` lists the guides. With two or more, the title in the app becomes a switcher (tap it). Each guide names its own data files (spots, `added.js`, metro/district shapes, road/area labels, map tiles), its centre and zoom, the area it covers (also used to check submissions), and whether it is in mainland China (map coordinates in China are GCJ-02 and directions offer AMap). Only the chosen guide's files are loaded, but all guides are saved for offline use. To add one: put its data files in `guides/<id>/` in the same format as `data/`, add an entry to `data/guides.js`, run `python3 tools/stamp.py`, push. Spots added in the app are filed for the guide being shown; photos are shared across guides.

## Adding spots and photos (for the two of us)
Tap **+** to add a spot, or the camera button on any spot to add photos (take one, or choose from your library). Everything is saved on the phone first, so it works offline.

**Automatic sync.** Open the sync button (top right) and paste the sync key once. From then on, anything new is sent by itself when there is a connection: the app files a GitHub issue (`[new-spot]`, `[new-photo]` or `[remove-photo]`) using the key. A GitHub job (`.github/workflows/inbox.yml` running `tools/inbox.py`) checks the sender against `tools/allowed-users.txt`, validates it (photos are decoded and re-encoded, so metadata is dropped), updates `data/added.js`, `data/photos.js` and `photos/`, publishes, then comments on and closes each issue. Everyone's app gets it through the "Update ready" banner. Photos shared this way are about 800 px so they fit in one issue; the original stays on the phone that took it.

**The key** is a fine-grained GitHub token, created by the repo owner, limited to this repository with only **Issues: Read and write**. Without a key the app still works; new things just stay on the phone.

To let someone else add things, add their GitHub username to `tools/allowed-users.txt` (the key is created by the owner, so the sender shown by GitHub is the owner; the optional "Your name" in the app is shown as who added it).

Map data © OpenStreetMap contributors and Overture Maps (ODbL).
