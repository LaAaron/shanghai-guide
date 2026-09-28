# Link extractor (step 1: backend only)

Paste an Instagram or TikTok link, or any web page / blog link, and get back the places in it, already in the guide's
spot format (the same fields as `data/added.js`), using the guide's categories and districts, for Shanghai and Shenzhen
(and any guide added to `data/guides.js` later).

**It does not touch the app.** Nothing here is loaded by the app, and nothing is added to the guide. Results are shown on
a test page and saved in `extractor/results/` for a later step.

## How it works
1. **Get the material.**
   - Instagram: Apify's `apify/instagram-scraper` returns the caption, video, location tag, hashtags, top comments
     and a transcript when Instagram has one. Photo posts and carousels: the photos are used instead.
   - TikTok: Apify's `clockworks/tiktok-scraper` returns the caption, the video, subtitles and any location (POI) tag.
     Photo slideshows: the photos are used.
   - Any other link: the page is downloaded and its text, title, description and structured data (JSON-LD, which often
     holds addresses) are read. If the page is nearly empty (drawn by JavaScript), it is loaded in a real browser
     through Apify's `apify/website-content-crawler`.
2. **Sample the video**: one frame every 1.5 s, shrunk to 512 px on the long side (about 200 tokens each), and frames
   that look the same as the previous one are dropped. Long videos are sampled more thinly (at most 80 frames).
3. **Ask Claude** (`claude-sonnet-5`) with the text + frames. It reads captions, subtitles, shop signs, menus, prices
   and on-screen text, and returns each place as structured JSON (the API guarantees the shape).
4. **Look each place up on AMap** (高德, optional, needs an AMap key): the pin, district and Chinese address come from
   AMap's place search, in the same GCJ-02 coordinates as the app's map. A place counts as found only when AMap's name
   matches; chains with several branches, weak matches and places AMap does not know are flagged.
5. **Check and format**: category and district are matched to the guide's lists, pins outside the guide's area are
   dropped, ids are made unique, notes are kept to the app's 200-character limit, and places already in the guide are
   marked.

## Setting it up on the Mac (once)
1. Get the keys below (Claude is required; Apify for Instagram/TikTok; AMap for real pins).
2. Double-click `extractor/run.command` (or run `./extractor/run.command` in Terminal). The first time it:
   - installs two Python packages into `extractor/.venv` (`anthropic` and `opencv-python-headless`, about 60 MB from
     PyPI; nothing is installed system-wide),
   - asks for each key and saves it in `extractor/.env` (this file is never committed).
3. It opens **http://localhost:8791**: paste links, one per line, and press **Extract places**.

The test page checks the keys each time it opens and shows **works** or **rejected** (with how the pasted key begins
and its length, never the whole key). To enter keys again, e.g. after making new ones, double-click
`extractor/change-keys.command`.

### Key 1: Claude API key (`ANTHROPIC_API_KEY`)
1. Go to https://platform.claude.com (the Claude Console; the old address console.anthropic.com leads there too) and
   sign up or log in. This is separate from a claude.ai chat subscription: API use is billed on its own.
2. Open **Settings → Billing** and add credit (the minimum top-up is enough for hundreds of links).
3. Open **Settings → API keys** and press **Create key**. Name it e.g. "shanghai-guide extractor".
4. Copy the key right away. It starts with `sk-ant-` and is only shown once.
5. Paste it when `run.command` asks, or put it after `ANTHROPIC_API_KEY=` in `extractor/.env`.

### Key 2: Apify API token (`APIFY_TOKEN`), needed for Instagram and TikTok only
1. Go to https://apify.com and sign up (the free plan includes a small monthly credit, enough to try this).
2. Open **Settings → API & Integrations** (https://console.apify.com/settings/integrations).
3. Copy the **Personal API token**. It starts with `apify_api_`.
4. Paste it when `run.command` asks, or put it after `APIFY_TOKEN=` in `extractor/.env`.
5. The actors are pay-per-use and charge the Apify account per post fetched (and a bit more per downloaded TikTok
   video); each actor's page on apify.com shows its current price.

Web page links work without an Apify token (only JavaScript-heavy pages need it).

### Key 3: AMap Web Service key (`AMAP_KEY`), optional, for real pins
AMap's developer site is in Chinese; Safari can translate it (the **aA** button in the address bar → Translate to English).
1. Open https://console.amap.com/dev/key/app and register (注册) or log in. Registration is by mobile phone number with a
   text-message code; AMap may also ask for identity verification (实名认证) before a key can be used.
2. Under **应用管理 → 我的应用** (App management → My apps) press **创建新应用** (Create new app). Any name, type **其他** (Other).
3. On that app press **添加Key** (Add key). Give it a name and choose the service platform **Web服务** (Web Service), not
   Web端/JS API, Android or iOS. Agree to the terms and submit.
4. Copy the **Key**: 32 letters and digits.
5. Double-click `extractor/change-keys.command` and paste it when asked for `AMAP_KEY` (the other two can be pasted again
   too). `run.command` also asks for it once; pressing Return skips it for good.

The free daily allowance of lookups is far more than this needs (each place uses 1–3 lookups).

## Other ways to run it
```
extractor/.venv/bin/python extractor/extract.py https://www.instagram.com/reel/...     # summary in the terminal
extractor/.venv/bin/python extractor/extract.py --json https://some-blog.com/post       # full JSON
extractor/.venv/bin/python extractor/server.py --port 8791                              # just the test page
```
`POST http://localhost:8791/api/extract` with `{"url": "...", "render": false}` returns the same JSON (only from this
computer; the server listens on 127.0.0.1).

## What comes back
```json
{
 "url": "...", "kind": "instagram | tiktok | web", "title": "@account", "summary": "one sentence",
 "places": [{
   "guide": "shanghai",                      // which guide it belongs in; null = outside every guide's area
   "spot": {"id": "jia-jia-tang-bao", "name": "Jia Jia Tang Bao", "zh": "佳家汤包", "cat": "dumplings",
            "district": "Huangpu", "addr": "Huanghe Road No.90, Huangpu", "note": "Crab xiaolongbao ¥50; ...",
            "lat": 31.2363, "lng": 121.4716, "approx": false, "flag": "(only when the location is uncertain)",
            "by": "Link import", "at": "2026-09-28"},
   "confidence": "exact | approximate | unknown",
   "evidence": "caption / sign at 0:12 / subtitles ...",
   "duplicate_of": "id of a spot already in the guide, or null",
   "amap": {"id": "B0FF...", "name": "佳家汤包(黄河路店)", "address": "黄河路90号", "district": "黄浦区", "tel": "...",
            "lat": 31.2363, "lng": 121.4716, "match": 0.92},   // what AMap found; null when not looked up or not found
   "warnings": []
 }],
 "inputs": {"text_parts": ["Caption", "Subtitles (en)"], "frames": 38, "video_seconds": 61.2, "photos": 0},
 "warnings": [], "usage": {"input_tokens": 9800, "output_tokens": 900, "claude_cost_usd": 0.029}, "seconds": 41.0
}
```
`spot` is exactly what `data/added.js` holds. Pins are GCJ-02 (like the app's map). **Any place whose location is not
certain gets `approx: true` and a `flag`**, which the app already shows as a warning. With an AMap key, pins come
from AMap; without one they come from what Claude knows, so check flagged ones with the "Search AMap" button (it opens
amap.com; the uri.amap.com links the app uses only open the AMap app on a phone).

## Cost per link (roughly)
- Claude: a 60-second video is about 10,000 input tokens, about 2–4 US cents; a blog post about 1–3 cents.
  The exact figure is shown with each result.
- Apify: see each actor's page. Web pages that load without a browser cost nothing on Apify.

Settings in `.env` (see `.env.example`): `FRAME_EVERY`, `FRAME_SIZE`, `MAX_FRAMES`, and the Apify actors and their
inputs (if an actor changes its input format, set `APIFY_..._INPUT` with the extra fields as JSON).

## Known limits
- Speech is only used when Apify returns a transcript/subtitles; there is no audio transcription of its own. Most food
  videos show names and prices on screen, which the frames cover.
- Xiaohongshu, Dianping and Douyin links are not supported yet (logins/app-only pages); they are treated as web pages
  and usually return little.
- Instagram and TikTok CDN links expire quickly; the video is downloaded straight away and deleted after sampling.
