/* Service worker — offline-first, with per-file updates.
 *
 * ASSETS lists every file with a content fingerprint. Each file is cached under "<path>?v=<fingerprint>".
 * Installing a new version fetches only the fingerprints the cache does not already hold, so an edit to one small
 * file never re-downloads the 9 MB of map data. The app always opens from the cache first and never waits on the
 * network, so a blocked or slow host (e.g. in mainland China) changes nothing: you keep the version you have.
 */
const VERSION = '__VERSION__';
const ASSETS = /*ASSETS*/[];                       // [path, fingerprint, bytes]
const CACHE = 'sg-assets';
const SCOPE = self.registration.scope;
const url = p => new URL(p, SCOPE).href;
const keyOf = a => new Request(url(a[0] + '?v=' + a[1]));
const BY_PATH = Object.fromEntries(ASSETS.map(a => [a[0], a]));
const REPORT = new Request(url('__report'));

async function tell(msg){
  for (const c of await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })) c.postMessage(msg);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const queue = ASSETS.slice(), report = { version: VERSION, fetched: [], reused: [], at: Date.now() };
    let done = 0;
    await tell({ type: 'progress', done, total: ASSETS.length, installing: true });
    async function worker(){
      while (queue.length){
        const a = queue.shift();
        if (await cache.match(keyOf(a))) report.reused.push(a[0]);              // already have exactly this file
        else {
          const res = await fetch(url(a[0] + '?v=' + a[1]), { cache: 'reload' });
          if (!res.ok) throw new Error('Could not fetch ' + a[0] + ' (' + res.status + ')');
          await cache.put(keyOf(a), res);
          report.fetched.push(a[0]);
        }
        done++;
        await tell({ type: 'progress', done, total: ASSETS.length, installing: true });
      }
    }
    await Promise.all([worker(), worker(), worker()]);                           // a failure here aborts the install; next launch resumes
    await cache.put(REPORT, new Response(JSON.stringify(report)));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE), want = new Set(ASSETS.map(a => keyOf(a).url).concat([REPORT.url]));
    for (const req of await cache.keys()) if (!want.has(req.url)) await cache.delete(req);   // drop files this version no longer uses
    await self.clients.claim();
    await tell({ type: 'ready', version: VERSION });
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;                                      // never touch other hosts
  const rel = decodeURIComponent(u.pathname.slice(new URL(SCOPE).pathname.length));
  const asset = req.mode === 'navigate' ? BY_PATH['index.html'] : BY_PATH[rel === '' ? 'index.html' : rel];
  if (!asset) return;                                                            // not one of ours (sw.js, version.txt…): normal network
  event.respondWith((async () => {
    const hit = await (await caches.open(CACHE)).match(keyOf(asset));
    if (hit) return hit;
    try { return await fetch(req); } catch (e) { return new Response('Offline and not cached yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
  })());
});

self.addEventListener('message', event => {
  const d = event.data || {};
  if (d.type === 'skipWaiting') { self.skipWaiting(); return; }
  if (d.type === 'status') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      let have = 0;
      for (const a of ASSETS) if (await cache.match(keyOf(a))) have++;
      let report = null;
      try { report = await (await cache.match(REPORT)).json(); } catch (e) {}
      const target = event.source || (await self.clients.matchAll({ includeUncontrolled: true, type: 'window' }))[0];
      if (target) target.postMessage({ type: 'status', ready: have === ASSETS.length, done: have, total: ASSETS.length, version: VERSION, report });
    })());
  }
});
