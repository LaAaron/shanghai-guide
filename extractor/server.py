#!/usr/bin/env python3
"""Local test page for the extractor: paste links, see the places.

    python3 extractor/server.py [--port 8791]        then open http://localhost:8791

Only listens on this computer (127.0.0.1). POST /api/extract {"url": "...", "render": false} returns the same JSON as
`extract.py --json`; GET /api/status checks that each key works (never shows the keys).
"""
import argparse, http.server, json, os, sys, traceback

import extract
import keys

HERE = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.BaseHTTPRequestHandler):
    def send(self, code, body, ctype='application/json; charset=utf-8'):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ('/', '/index.html'):
            self.send(200, open(os.path.join(HERE, 'test.html'), 'rb').read(), 'text/html; charset=utf-8')
        elif self.path == '/api/status':
            self.send(200, {'keys': keys.check_all(),
                            'guides': [{'id': g['id'], 'place': g['place'], 'amapCity': g.get('amapCity')} for g in extract.guide.guides()],
                            'categories': extract.guide.categories()})
        else:
            self.send(404, {'error': 'not found'})

    def do_POST(self):
        if self.path != '/api/extract': return self.send(404, {'error': 'not found'})
        if self.headers.get('Origin') not in (None, 'http://localhost:%d' % self.server.server_port, 'http://127.0.0.1:%d' % self.server.server_port):
            return self.send(403, {'error': 'wrong origin'})           # other websites open in the browser may not use this
        try:
            req = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
            self.send(200, extract.extract(str(req.get('url', '')), bool(req.get('render'))))
        except Exception as e:
            traceback.print_exc()
            self.send(200, {'url': req.get('url') if 'req' in locals() else '', 'error': str(e) or e.__class__.__name__})

    def log_message(self, fmt, *args):
        sys.stderr.write('  %s\n' % (fmt % args))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8791)
    a = ap.parse_args()
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    print('Extractor test page: http://127.0.0.1:%d   (Ctrl-C to stop)' % a.port)
    for k, v in (('ANTHROPIC_API_KEY', 'Claude'), ('APIFY_TOKEN', 'Apify')):
        if not os.environ.get(k): print('  note: %s is not set, so %s calls will fail. See extractor/README.md.' % (k, v))
    try: srv.serve_forever()
    except KeyboardInterrupt: pass


if __name__ == '__main__':
    main()
