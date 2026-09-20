#!/usr/bin/env python3
"""The shared guide's inbox. The app files GitHub issues; this turns the valid ones into data files.

Issues it understands (title prefix):   [new-spot]  [new-photo]  [remove-photo]
Everything in an issue is UNTRUSTED. It is parsed as JSON, validated field by field, images are decoded and re-encoded
with Pillow, and nothing is ever executed or put into a shell command. Only people in tools/allowed-users.txt count.

Used by .github/workflows/inbox.yml, in two phases so nothing is closed unless the change was really published:

    python3 tools/inbox.py apply     read every open inbox issue (oldest first), change data files, write inbox-results.json
    python3 tools/inbox.py report    comment on and close those issues            (needs GITHUB_TOKEN, GITHUB_REPOSITORY)

It is safe to run repeatedly: anything already in the guide comes back as "duplicate".
Local testing without GitHub:  python3 tools/inbox.py local <spot|photo|remove> <github-login> < issue-body.txt
"""
import base64, binascii, datetime, io, json, os, re, sys, urllib.error, urllib.request

ROOT = os.environ.get('ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS = os.path.join(ROOT, 'inbox-results.json')
MAX_PHOTOS_PER_SPOT = 12
PHOTO_MAX_BYTES = 150_000
PHOTO_MAX_SIDE = 2000
PHOTO_BODY_MAX = 66_000
PENDING_HOURS = 6                      # a photo whose spot has not arrived yet waits this long before it is rejected


class Done(Exception):
    def __init__(self, result, message, name=''):
        self.result, self.message, self.name = result, message, name


class Pending(Exception):
    pass


def rd(rel): return open(os.path.join(ROOT, rel), encoding='utf-8').read()
def wr(rel, s):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f: f.write(s)


def check_user(user):
    allowed = [l.strip().lower() for l in rd('tools/allowed-users.txt').splitlines() if l.strip() and not l.strip().startswith('#')]
    if user.lower() not in allowed:
        raise Done('forbidden', 'Sorry, @%s is not on the list of people who can change this guide, so this was ignored.' % re.sub(r'[^A-Za-z0-9-]', '', user))


def json_block(body, limit):
    if len(body) > limit: raise Done('rejected', 'That submission is too large.')
    m = re.search(r'```json\s*(\{.*?\})\s*```', body, re.S)
    if not m: raise Done('rejected', 'I could not find the details (a ```json block) in this issue.')
    try: raw = json.loads(m.group(1))
    except Exception: raise Done('rejected', 'The details were not valid JSON.')
    if not isinstance(raw, dict): raise Done('rejected', 'The details were not an object.')
    return raw


CTRL = re.compile(r'[\x00-\x1f\x7f  ]')
def text(raw, key, maxlen, required=False):
    v = raw.get(key, '')
    if v is None: v = ''
    if not isinstance(v, str): raise Done('rejected', '"%s" must be text.' % key)
    v = re.sub(r'\s+', ' ', CTRL.sub(' ', v)).strip()
    if required and not v: raise Done('rejected', '"%s" is required.' % key)
    if len(v) > maxlen: raise Done('rejected', '"%s" is too long (max %d characters).' % (key, maxlen))
    return v


def ident(raw, key):
    v = text(raw, key, 64, True)
    if not re.fullmatch(r'[A-Za-z0-9_-]{6,64}', v): raise Done('rejected', 'The %s is not valid.' % key)
    return v


def who(raw, user):
    """Who to credit: the optional first name typed into the app, else the GitHub login."""
    w = re.sub(r'[^A-Za-z0-9 -]', '', text(raw, 'who', 20)).strip()
    return w or re.sub(r'[^A-Za-z0-9-]', '', user)


# ---------------------------------------------------------------- data files
def load_added():
    mm = re.search(r'SG\.ADDED_PLACES = (\[.*\]);', rd('data/added.js'), re.S)
    return json.loads(mm.group(1)) if mm else []

def save_added(added):
    body = ',\n'.join(' ' + json.dumps(a, ensure_ascii=False, separators=(',', ':')) for a in added)
    wr('data/added.js', '/* Spots added through the app and approved by tools/inbox.py. Do not edit by hand. */\nwindow.SG = window.SG || {};\nSG.ADDED_PLACES = [\n' + body + '\n];\n')

def load_photos():
    mm = re.search(r'SG\.PHOTOS = (\{.*\});', rd('data/photos.js'), re.S)
    return json.loads(mm.group(1)) if mm else {}

def save_photos(d):
    wr('data/photos.js', '/* Photos shared through the app and approved by tools/inbox.py (files are in photos/). Do not edit by hand. */\n'
       'window.SG = window.SG || {};\nSG.PHOTOS = ' + json.dumps(d, ensure_ascii=False, indent=1, sort_keys=True) + ';\n')

def known_spot_ids():
    return set(re.findall(r'id:"([^"]+)"', rd('data/places.js'))) | {a.get('id') for a in load_added()}


# ---------------------------------------------------------------- [new-spot]
def handle_spot(user, body, created=None):
    check_user(user)
    raw = json_block(body, 20000)
    cats = re.findall(r'^\s+(\w+):\s*\{\s*label', rd('data/places.js'), re.M)
    spot = {}
    spot['id'] = ident(raw, 'id')
    spot['name'] = text(raw, 'name', 80, True)
    spot['zh'] = text(raw, 'zh', 60)
    spot['cat'] = raw.get('cat')
    if spot['cat'] not in cats: raise Done('rejected', 'Unknown category. Expected one of: %s.' % ', '.join(cats))
    spot['district'] = text(raw, 'district', 40) or 'Unsorted'
    spot['addr'] = text(raw, 'addr', 200)
    spot['note'] = text(raw, 'note', 200)
    lat, lng = raw.get('lat'), raw.get('lng')
    if (lat is None) != (lng is None): raise Done('rejected', 'Give both latitude and longitude, or neither.')
    if lat is not None:
        if isinstance(lat, bool) or isinstance(lng, bool) or not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            raise Done('rejected', 'Latitude and longitude must be numbers.')
        if not (30.4 <= lat <= 32.0 and 120.6 <= lng <= 122.4): raise Done('rejected', 'Those coordinates are outside the Shanghai area this guide covers.')
        lat, lng = round(float(lat), 6), round(float(lng), 6)
    spot['lat'], spot['lng'] = lat, lng
    spot['approx'] = raw.get('approx') is True            # only a real boolean; anything else means "exact"
    spot['by'] = who(raw, user)
    spot['at'] = datetime.date.today().isoformat()

    seed_ids = set(re.findall(r'id:"([^"]+)"', rd('data/places.js')))
    added = load_added()
    if spot['id'] in seed_ids: raise Done('rejected', 'That id clashes with a built-in spot.')
    if any(a.get('id') == spot['id'] for a in added): raise Done('duplicate', '"%s" is already in the guide, nothing changed.' % spot['name'], spot['name'])
    added.append(spot)
    save_added(added)
    raise Done('added', 'Added "%s". It will be live in about a minute; open the app while online and tap "Update ready".' % spot['name'], spot['name'])


# ---------------------------------------------------------------- [new-photo]
def handle_photo(user, body, created=None):
    check_user(user)
    raw = json_block(body, PHOTO_BODY_MAX)
    pid, spot = ident(raw, 'id'), ident(raw, 'spot')
    data = raw.get('data')
    if not isinstance(data, str) or not data: raise Done('rejected', 'There is no image in this submission.')
    manifest = load_photos()
    if any(p.get('id') == pid for l in manifest.values() for p in l): raise Done('duplicate', 'That photo is already in the guide, nothing changed.', pid)
    if spot not in known_spot_ids():
        # the spot may be a few seconds behind (sent just before it): wait for it, but not forever
        age = (datetime.datetime.now(datetime.timezone.utc) - created).total_seconds() / 3600 if created else 0
        if age < PENDING_HOURS: raise Pending()
        raise Done('rejected', 'That photo belongs to a spot that is not in the guide.')
    if len(manifest.get(spot, [])) >= MAX_PHOTOS_PER_SPOT: raise Done('rejected', 'This spot already has %d photos, the most the guide keeps.' % MAX_PHOTOS_PER_SPOT)
    try: blob = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError): raise Done('rejected', 'The image was not valid base64.')
    if len(blob) > PHOTO_MAX_BYTES: raise Done('rejected', 'The image is too large.')
    from PIL import Image                                # Pillow: installed by the workflow
    try:
        img = Image.open(io.BytesIO(blob))
        if img.format != 'JPEG': raise Done('rejected', 'Only JPEG photos are accepted.')
        img.load()
    except Done: raise
    except Exception: raise Done('rejected', 'That did not look like a valid photo.')
    if max(img.size) > PHOTO_MAX_SIDE or min(img.size) < 16: raise Done('rejected', 'The photo dimensions are not accepted.')
    out = io.BytesIO()
    img.convert('RGB').save(out, 'JPEG', quality=82, optimize=True, progressive=False)     # fresh JPEG: drops all metadata and anything hidden
    if out.tell() > PHOTO_MAX_BYTES: raise Done('rejected', 'The image is too large.')
    os.makedirs(os.path.join(ROOT, 'photos'), exist_ok=True)
    with open(os.path.join(ROOT, 'photos', pid + '.jpg'), 'wb') as f: f.write(out.getvalue())
    manifest.setdefault(spot, []).append({'id': pid, 'by': who(raw, user), 'at': datetime.date.today().isoformat(), 'w': img.size[0], 'h': img.size[1]})
    save_photos(manifest)
    raise Done('added', 'Photo added. It will be live in about a minute.', pid)


# ---------------------------------------------------------------- [remove-photo]
def handle_remove(user, body, created=None):
    check_user(user)
    pid = ident(json_block(body, 2000), 'id')
    manifest = load_photos()
    found = False
    for spot in list(manifest):
        keep = [p for p in manifest[spot] if p.get('id') != pid]
        found = found or len(keep) != len(manifest[spot])
        if keep: manifest[spot] = keep
        else: del manifest[spot]
    if not found: raise Done('duplicate', 'That photo is not in the guide (already removed?), nothing changed.', pid)
    path = os.path.join(ROOT, 'photos', pid + '.jpg')
    if os.path.exists(path): os.remove(path)
    save_photos(manifest)
    raise Done('added', 'Photo removed.', pid)


HANDLERS = {'[new-spot]': handle_spot, '[new-photo]': handle_photo, '[remove-photo]': handle_remove}


# ---------------------------------------------------------------- GitHub plumbing
def api(method, path, data=None):
    req = urllib.request.Request('https://api.github.com' + path, method=method, data=json.dumps(data).encode() if data is not None else None, headers={
        'Authorization': 'Bearer ' + os.environ['GITHUB_TOKEN'], 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'shanghai-guide-inbox', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def open_inbox_issues(repo):
    out, page = [], 1
    while True:
        batch = api('GET', '/repos/%s/issues?state=open&sort=created&direction=asc&per_page=100&page=%d' % (repo, page))
        out += [i for i in batch if 'pull_request' not in i]
        if len(batch) < 100: return out
        page += 1


def apply():
    repo = os.environ['GITHUB_REPOSITORY']
    results = []
    for issue in open_inbox_issues(repo):
        title = issue.get('title') or ''
        kind = next((k for k in HANDLERS if title.startswith(k)), None)
        if not kind: continue
        created = datetime.datetime.fromisoformat(issue['created_at'].replace('Z', '+00:00'))
        try:
            HANDLERS[kind](issue['user']['login'], issue.get('body') or '', created)
        except Pending:
            print('#%s waiting for its spot' % issue['number']); continue
        except Done as d:
            results.append({'number': issue['number'], 'kind': kind, 'result': d.result, 'message': d.message, 'name': d.name})
            print('#%s %s [%s] %s' % (issue['number'], kind, d.result, d.message))
    json.dump(results, open(RESULTS, 'w'))
    changed = [r for r in results if r['result'] == 'added']
    out = os.environ.get('GITHUB_OUTPUT')
    if out:
        summary = ', '.join('%s #%d' % (r['kind'].strip('[]'), r['number']) for r in changed)
        with open(out, 'a') as f: f.write('changed=%d\nsummary=%s\n' % (len(changed), summary))


def report():
    repo = os.environ['GITHUB_REPOSITORY']
    for r in json.load(open(RESULTS)):
        ok = r['result'] in ('added', 'duplicate')
        try:
            api('POST', '/repos/%s/issues/%d/comments' % (repo, r['number']), {'body': r['message']})
            api('PATCH', '/repos/%s/issues/%d' % (repo, r['number']), {'state': 'closed', 'state_reason': 'completed' if ok else 'not_planned'})
        except urllib.error.HTTPError as e:
            print('could not close #%d: %s' % (r['number'], e)); sys.exit(1)


def local(kind, user):
    body = sys.stdin.read()
    try: HANDLERS['[%s]' % ('new-' + kind if kind != 'remove' else 'remove-photo')](user, body, None)
    except Done as d: print('[%s] %s' % (d.result, d.message)); return
    except Pending: print('[pending] its spot is not in the guide yet')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'apply': apply()
    elif cmd == 'report': report()
    elif cmd == 'local' and len(sys.argv) == 4: local(sys.argv[2], sys.argv[3])
    else: sys.exit(__doc__)
