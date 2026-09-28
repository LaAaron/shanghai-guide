#!/usr/bin/env python3
"""Pull places out of an Instagram/TikTok link or any web page, in the guide's own spot format.

    python3 extractor/extract.py URL [URL ...]          summary of each link
    python3 extractor/extract.py --json URL             full result as JSON
    python3 extractor/extract.py --render URL           web page: load it in a real browser (through Apify)

Keys come from extractor/.env or the environment (ANTHROPIC_API_KEY, APIFY_TOKEN). Every result is also saved in
extractor/results/. Nothing here changes the app or its data files.
"""
import datetime, json, os, re, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))


def load_env():
    path = os.path.join(HERE, '.env')
    if not os.path.exists(path): return
    for ln in open(path, encoding='utf-8'):
        m = re.match(r'\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$', ln)
        if m and not ln.lstrip().startswith('#'):
            v = m.group(2).strip('\'"')
            if m.group(1).endswith(('_KEY', '_TOKEN')): v = re.sub(r'\s+', '', v)     # a key never contains spaces
            os.environ.setdefault(m.group(1), v)


load_env()                                    # before the imports below: they read settings from the environment
import frames, guide, llm, sources            # noqa: E402


def extract(url, render=False):
    t0 = time.time()
    url = url.strip()
    if not re.match(r'https?://', url): url = 'https://' + url
    if not os.environ.get('ANTHROPIC_API_KEY'):
        raise RuntimeError('ANTHROPIC_API_KEY is not set. See extractor/README.md.')
    src = sources.fetch(url, render)
    shots, photos, every, duration = [], [], 0, 0
    try:
        if src.video:
            shots, duration, every = frames.video_frames(src.video)
        if src.images:
            photos = frames.photos(src.images)
    finally:
        if src.video and os.path.exists(src.video): os.remove(src.video)
    if not src.parts and not shots and not photos:
        raise RuntimeError('Found nothing to read at this link' + (' (%s)' % '; '.join(src.warnings) if src.warnings else ''))
    raw, summary, usage = llm.extract(src, shots, photos, every)
    result = {
        'url': url, 'kind': src.kind, 'title': src.title, 'summary': summary,
        'places': guide.to_spots(raw, url),
        'inputs': {'text_parts': [label for label, _ in src.parts], 'frames': len(shots), 'video_seconds': round(duration, 1),
                   'photos': len(photos)},
        'warnings': src.warnings, 'usage': usage, 'seconds': round(time.time() - t0, 1),
    }
    save(result)
    return result


def save(result):
    d = os.path.join(HERE, 'results')
    os.makedirs(d, exist_ok=True)
    name = re.sub(r'[^a-z0-9]+', '-', re.sub(r'^https?://(www\.)?', '', result['url'].lower()))[:60].strip('-')
    with open(os.path.join(d, '%s-%s.json' % (datetime.datetime.now().strftime('%Y%m%d-%H%M%S'), name)), 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1)


def show(r):
    print('\n%s  [%s] %s' % (r['url'], r['kind'], r['title']))
    print('  %s' % r['summary'])
    i = r['inputs']
    read = [', '.join(i['text_parts']) or 'no text']
    if i['frames']: read.append('%d frames from %.0f s of video' % (i['frames'], i['video_seconds']))
    if i['photos']: read.append('%d photos' % i['photos'])
    print('  read: %s · %d+%d tokens ≈ $%.3f · %.0f s' % ('; '.join(read), r['usage']['input_tokens'],
          r['usage']['output_tokens'], r['usage']['claude_cost_usd'], r['seconds']))
    for w in r['warnings']: print('  ! ' + w)
    for p in r['places']:
        s = p['spot']
        print('  • %s %s  (%s · %s · %s)' % (s['name'], s['zh'], p['guide'] or 'no guide', s['cat'], s['district']))
        if s['addr']: print('      %s' % s['addr'])
        if s['note']: print('      %s' % s['note'])
        print('      pin: %s  %s' % ('%s, %s' % (s['lat'], s['lng']) if s['lat'] is not None else 'none', p['confidence']))
        if s.get('flag'): print('      ⚠ ' + s['flag'])
        if p['duplicate_of']: print('      already in the guide as "%s"' % p['duplicate_of'])
        for w in p['warnings']: print('      ! ' + w)
    if not r['places']: print('  (no places found)')


def main(argv):
    as_json, render = '--json' in argv, '--render' in argv
    urls = [a for a in argv if not a.startswith('--')]
    if not urls: print(__doc__); return 2
    rc = 0
    for u in urls:
        try:
            r = extract(u, render)
            print(json.dumps(r, ensure_ascii=False, indent=1)) if as_json else show(r)
        except Exception as e:
            print('\n%s\n  failed: %s' % (u, e), file=sys.stderr); rc = 1
    return rc


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
