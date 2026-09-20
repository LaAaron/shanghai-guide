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
- `data/` — the spots (`places.js`), metro + district shapes (`geo.js`), road and area names (`labels.js`), map tiles (`tiles.js`, 8.6 MB)
- `vendor/` — Leaflet 1.9.4, bundled so nothing loads from the internet
- `sw.js` — service worker: saves every file on the phone and updates only the files that changed
- `tools/stamp.py` — run `python3 tools/stamp.py` after editing any file, then push. It refreshes `sw.js` so phones know what changed.

## Adding spots (for the two of us)
Tap **+** in the app, fill it in, and set the location with **Use my location** or **Pick on map**. The spot is saved on your phone at once (it works offline). Then tap **Share** and, on the GitHub page that opens, tap **Submit new issue**. A GitHub job (`.github/workflows/add-spot.yml`) checks the sender against `tools/allowed-users.txt`, validates the spot, adds it to `data/added.js`, publishes, and closes the issue. Everyone's app gets it through the "Update ready" banner.

To let someone else add spots, add their GitHub username to `tools/allowed-users.txt`.

Map data © OpenStreetMap contributors and Overture Maps (ODbL).
