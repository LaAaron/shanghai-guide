#!/usr/bin/env python3
"""Local preview server with live reload. For development only; the real app never uses this.

    python3 tools/dev.py [--port 8790]

- Serves this folder with caching switched off.
- Every page reloads itself within a second of any file changing (so the desktop browser and the iPhone simulator
  both update as soon as a file is saved).
- The offline service worker is switched off here (and any old one is removed) so you always see the latest files.
"""
import argparse, hashlib, http.server, os, re, socketserver, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = {'.git', 'node_modules', '__pycache__'}

RELOAD = """<script>/* dev live-reload */
(function(){var v=null;function tick(){fetch('/__version',{cache:'no-store'}).then(function(r){return r.text();}).then(function(t){if(v!==null&&t!==v)location.reload();v=t;}).catch(function(){});}
setInterval(tick,700);tick();})();</script>
"""
NO_SW_PREFIX = ("if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(x){x.unregister();});});}"
                "if(window.caches){caches.keys().then(function(k){k.forEach(function(n){caches.delete(n);});});}\n")
SW_KILL = b"self.addEventListener('install',function(){self.skipWaiting();});" \
          b"self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(k){return Promise.all(k.map(function(n){return caches.delete(n);}));}).then(function(){return self.registration.unregister();}));});"


def tree_version():
    """A short fingerprint of every file's size + modified time."""
    h = hashlib.sha1()
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = sorted(d for d in dirs if d not in SKIP)
        for f in sorted(files):
            p = os.path.join(base, f)
            try:
                st = os.stat(p)
            except OSError:
                continue
            h.update(('%s|%d|%d\n' % (os.path.relpath(p, ROOT), st.st_size, st.st_mtime_ns)).encode())
    return h.hexdigest()[:12]


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):            # stay quiet unless something is wrong
        if args and str(args[1]).startswith(('4', '5')) and '/favicon' not in str(args[0]):
            sys.stderr.write('%s\n' % (fmt % args))

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _send(self, body, ctype):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/__version':
            return self._send(tree_version().encode(), 'text/plain')
        if path == '/sw.js':
            return self._send(SW_KILL, 'application/javascript')
        if path in ('/', '/index.html'):
            html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
            html = html.replace('</body>', RELOAD + '</body>', 1)
            return self._send(html.encode('utf-8'), 'text/html; charset=utf-8')
        if path == '/pwa.js':
            js = open(os.path.join(ROOT, 'pwa.js'), encoding='utf-8').read()
            js = js.replace("navigator.serviceWorker.register('sw.js')", "Promise.reject(new Error('service worker off in dev'))")
            return self._send((NO_SW_PREFIX + js).encode('utf-8'), 'application/javascript')
        return super().do_GET()


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8790)
    port = ap.parse_args().port
    with Server(('', port), Handler) as srv:
        print('Live preview on http://localhost:%d/  (Ctrl-C to stop)' % port, flush=True)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print('\nstopped')
