#!/usr/bin/env python3
"""Add a spot that was submitted through the app (as a GitHub issue) to data/added.js.

Everything in the issue is UNTRUSTED text. It is parsed as JSON data, validated field by field, and written back with
json.dumps. It is never executed, never put in a shell command, and never trusted for anything except the fields below.

Environment: ISSUE_BODY, ISSUE_USER   (optional: GITHUB_OUTPUT, ROOT)
Writes to GITHUB_OUTPUT:  result = added | duplicate | rejected | forbidden,  message = text for the reply,  name = spot name
"""
import datetime, json, os, re, sys

ROOT = os.environ.get('ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
body = os.environ.get('ISSUE_BODY', '') or ''
user = (os.environ.get('ISSUE_USER', '') or '').strip()

def rd(rel): return open(os.path.join(ROOT, rel), encoding='utf-8').read()

def emit(result, message, name=''):
    out = os.environ.get('GITHUB_OUTPUT')
    tag = 'EOF_' + os.urandom(8).hex()
    lines = ['result=%s\n' % result, 'name<<%s\n%s\n%s\n' % (tag, name.replace('\n', ' '), tag), 'message<<%s\n%s\n%s\n' % (tag, message, tag)]
    if out:
        with open(out, 'a', encoding='utf-8') as f: f.writelines(lines)
    print('[%s] %s' % (result, message))
    sys.exit(0)

# 1. who is allowed to add spots?
allowed = [l.strip().lower() for l in rd('tools/allowed-users.txt').splitlines() if l.strip() and not l.strip().startswith('#')]
if user.lower() not in allowed:
    emit('forbidden', 'Sorry, @%s is not on the list of people who can add spots to this guide, so this was ignored.' % re.sub(r'[^A-Za-z0-9-]', '', user))

# 2. pull the JSON block out of the issue body
if len(body) > 20000: emit('rejected', 'That submission is too large.')
m = re.search(r'```json\s*(\{.*?\})\s*```', body, re.S)
if not m: emit('rejected', 'I could not find the spot details (a ```json block) in this issue.')
try: raw = json.loads(m.group(1))
except Exception: emit('rejected', 'The spot details were not valid JSON.')
if not isinstance(raw, dict): emit('rejected', 'The spot details were not an object.')

# 3. validate every field
CTRL = re.compile(r'[\x00-\x1f\x7f  ]')
def text(key, maxlen, required=False):
    v = raw.get(key, '')
    if v is None: v = ''
    if not isinstance(v, str): emit('rejected', '"%s" must be text.' % key)
    v = re.sub(r'\s+', ' ', CTRL.sub(' ', v)).strip()
    if required and not v: emit('rejected', '"%s" is required.' % key)
    if len(v) > maxlen: emit('rejected', '"%s" is too long (max %d characters).' % (key, maxlen))
    return v

cats = re.findall(r'^\s+(\w+):\s*\{\s*label', rd('data/places.js'), re.M)
spot = {}
spot['id'] = text('id', 64, True)
if not re.fullmatch(r'[A-Za-z0-9_-]{6,64}', spot['id']): emit('rejected', 'The spot id is not valid.')
spot['name'] = text('name', 80, True)
spot['zh'] = text('zh', 60)
spot['cat'] = raw.get('cat')
if spot['cat'] not in cats: emit('rejected', 'Unknown category. Expected one of: %s.' % ', '.join(cats))
spot['district'] = text('district', 40) or 'Unsorted'
spot['addr'] = text('addr', 200)
spot['note'] = text('note', 200)
lat, lng = raw.get('lat'), raw.get('lng')
if (lat is None) != (lng is None): emit('rejected', 'Give both latitude and longitude, or neither.')
if lat is not None:
    if isinstance(lat, bool) or isinstance(lng, bool) or not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)): emit('rejected', 'Latitude and longitude must be numbers.')
    if not (30.4 <= lat <= 32.0 and 120.6 <= lng <= 122.4): emit('rejected', 'Those coordinates are outside the Shanghai area this guide covers.')
    lat, lng = round(float(lat), 6), round(float(lng), 6)
spot['lat'], spot['lng'] = lat, lng
spot['approx'] = raw.get('approx') is True            # only a real boolean; anything else means "exact"
spot['by'] = re.sub(r'[^A-Za-z0-9-]', '', user)
spot['at'] = datetime.date.today().isoformat()

# 4. no duplicates
seed_ids = set(re.findall(r'id:"([^"]+)"', rd('data/places.js')))
added_src = rd('data/added.js')
mm = re.search(r'SG\.ADDED_PLACES = (\[.*\]);', added_src, re.S)
added = json.loads(mm.group(1)) if mm else []
if spot['id'] in seed_ids: emit('rejected', 'That id clashes with a built-in spot.')
if any(a.get('id') == spot['id'] for a in added): emit('duplicate', '"%s" is already in the guide, nothing changed.' % spot['name'], spot['name'])

# 5. write it back
added.append(spot)
body_js = ',\n'.join(' ' + json.dumps(a, ensure_ascii=False, separators=(',', ':')) for a in added)
open(os.path.join(ROOT, 'data/added.js'), 'w', encoding='utf-8').write(
    '/* Spots added through the app and approved by tools/add_spot.py. Do not edit by hand. */\nwindow.SG = window.SG || {};\nSG.ADDED_PLACES = [\n' + body_js + '\n];\n')
emit('added', 'Added "%s". It will be live in about a minute; open the app while online and tap "Update ready".' % spot['name'], spot['name'])
