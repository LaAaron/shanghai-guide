"""Getting the raw material for a link: Instagram and TikTok through Apify, anything else as a web page.

Every fetch returns a Source: some text (caption, transcript, page text, location tags) plus, for videos, a local video
file, and for photo posts, image URLs. Apify actor names and inputs can be overridden in .env (see README).
"""
import html.parser, json, os, re, ssl, tempfile, urllib.error, urllib.parse, urllib.request

try:                                    # Python on a Mac often has no certificates of its own; use certifi's (installed with anthropic)
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    CTX = None

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
MAX_VIDEO_BYTES = 300_000_000
MAX_PAGE_CHARS = 150_000            # ~50-75k tokens; longer pages are cut and the result says so
APIFY = 'https://api.apify.com/v2'


class Source:
    def __init__(self, url, kind):
        self.url, self.kind = url, kind        # kind: instagram | tiktok | web
        self.title = ''
        self.parts = []                        # [(label, text)] sent to Claude as text
        self.video = None                      # local path of the downloaded video
        self.images = []                       # image URLs (photo posts / slideshows)
        self.warnings = []

    def add(self, label, text):
        text = (text or '').strip() if isinstance(text, str) else json.dumps(text, ensure_ascii=False)
        if text and text not in ('[]', '{}', 'null'): self.parts.append((label, text))


def kind_of(url):
    host = urllib.parse.urlsplit(url).netloc.lower()
    if re.search(r'(^|\.)(instagram\.com|instagr\.am)$', host): return 'instagram'
    if re.search(r'(^|\.)tiktok\.com$', host): return 'tiktok'
    return 'web'


# ---------------------------------------------------------------- plain HTTP
def get(url, headers=None, limit=None):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'en,zh-CN;q=0.8', **(headers or {})})
    with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
        data = r.read(limit + 1) if limit else r.read()      # read(-1) fails on Python 3.9 (the Mac's)
        if limit and len(data) > limit: raise ValueError('File is larger than %d MB' % (limit // 1_000_000))
        return data, r.headers


def with_token(url):
    """Apify URLs carry the token as ?token= (the method every Apify endpoint accepts)."""
    token = os.environ.get('APIFY_TOKEN')
    if not url.startswith(APIFY) or not token or 'token=' in url: return url
    return url + ('&' if '?' in url else '?') + 'token=' + urllib.parse.quote(token)


def download(url, suffix):
    data, _ = get(with_token(url), None, MAX_VIDEO_BYTES)
    fd, path = tempfile.mkstemp(suffix=suffix, prefix='sg-extract-')
    with os.fdopen(fd, 'wb') as f: f.write(data)
    return path


# ---------------------------------------------------------------- Apify
def apify(actor_env, default_actor, input_env, default_input):
    token = os.environ.get('APIFY_TOKEN')
    if not token: raise RuntimeError('APIFY_TOKEN is not set (needed for Instagram and TikTok links). See extractor/README.md.')
    actor = os.environ.get(actor_env) or default_actor
    payload = default_input
    if os.environ.get(input_env):                             # extra/overriding input fields, as JSON
        payload = {**default_input, **json.loads(os.environ[input_env])}
    url = with_token('%s/acts/%s/run-sync-get-dataset-items?timeout=300' % (APIFY, actor.replace('/', '~')))
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST',
                                 headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=330, context=CTX) as r: items = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError('Apify (%s) said %d: %s' % (actor, e.code, e.read()[:400].decode('utf-8', 'replace')))
    items = [i for i in items if isinstance(i, dict) and not i.get('error')] if isinstance(items, list) else []
    if not items: raise RuntimeError('Apify (%s) returned nothing for this link. Is the post public?' % actor)
    return items[0]


def location_fields(item, prefix=''):
    """Any field anywhere in the item whose name suggests a place (location, poi, address, city...)."""
    out = {}
    for k, v in (item.items() if isinstance(item, dict) else []):
        key = prefix + k
        if re.search(r'location|poi|address|city|place|venue|geo|lat|lng|longitude', k, re.I) and v not in (None, '', [], {}):
            out[key] = v
        elif isinstance(v, dict):
            out.update(location_fields(v, key + '.'))
    return out


def vtt_text(raw):
    lines, prev = [], None
    for ln in raw.splitlines():
        ln = re.sub(r'<[^>]+>', '', ln).strip()
        if not ln or ln == 'WEBVTT' or '-->' in ln or ln.isdigit() or re.match(r'^(NOTE|Kind:|Language:)', ln): continue
        if ln != prev: lines.append(ln)
        prev = ln
    return '\n'.join(lines)


def comments_text(items):
    out = []
    for c in (items or [])[:15]:
        t = c.get('text') if isinstance(c, dict) else None
        if t: out.append('- ' + t)
    return '\n'.join(out)


def from_instagram(url):
    s = Source(url, 'instagram')
    it = apify('APIFY_INSTAGRAM_ACTOR', 'apify/instagram-scraper', 'APIFY_INSTAGRAM_INPUT',
               {'directUrls': [url], 'resultsType': 'posts', 'resultsLimit': 1, 'addParentData': False})
    s.title = '@%s' % it.get('ownerUsername', '') if it.get('ownerUsername') else 'Instagram post'
    s.add('Caption', it.get('caption'))
    s.add('Transcript (speech in the video)', it.get('transcript'))
    s.add('Hashtags', ' '.join('#' + h for h in it.get('hashtags') or []))
    s.add('Tagged accounts', ' '.join('@' + h for h in it.get('mentions') or []))
    s.add('Location tags', location_fields(it))
    s.add('Top comments', comments_text(it.get('latestComments')))
    if it.get('videoUrl'):
        s.video = download(it['videoUrl'], '.mp4')
    for c in it.get('childPosts') or []:                      # carousel: videos are skipped, photos are used
        if c.get('displayUrl') and not c.get('videoUrl'): s.images.append(c['displayUrl'])
    if not s.video and not s.images:
        s.images = list(dict.fromkeys((it.get('images') or []) + ([it['displayUrl']] if it.get('displayUrl') else [])))
    if not it.get('transcript') and s.video:
        s.warnings.append('No transcript from Apify for this video; using caption and on-screen text only')
    return s


def from_tiktok(url):
    s = Source(url, 'tiktok')
    it = apify('APIFY_TIKTOK_ACTOR', 'clockworks/tiktok-scraper', 'APIFY_TIKTOK_INPUT',
               {'postURLs': [url], 'resultsPerPage': 1, 'shouldDownloadVideos': True, 'shouldDownloadSubtitles': True,
                'shouldDownloadCovers': False, 'shouldDownloadSlideshowImages': True})
    meta = it.get('videoMeta') or {}
    author = (it.get('authorMeta') or {}).get('name')
    s.title = '@' + author if author else 'TikTok video'
    s.add('Caption', it.get('text'))
    s.add('Hashtags', ' '.join('#' + (h.get('name') if isinstance(h, dict) else str(h)) for h in it.get('hashtags') or []))
    s.add('Location tags', location_fields(it))
    subs = meta.get('subtitleLinks') or []
    subs.sort(key=lambda x: 0 if str(x.get('language', '')).lower().startswith(('en', 'zh', 'cmn')) else 1)
    for sub in subs[:2]:
        link = sub.get('downloadLink') or sub.get('tiktokLink')
        try:
            s.add('Subtitles (%s)' % sub.get('language', '?'), vtt_text(get(link)[0].decode('utf-8', 'replace')))
        except Exception as e:
            s.warnings.append('Could not download %s subtitles: %s' % (sub.get('language', '?'), e))
    if not subs: s.warnings.append('This TikTok has no subtitles; using caption and on-screen text only')
    video = (it.get('mediaUrls') or [None])[0] or meta.get('downloadAddr')
    s.images = [x if isinstance(x, str) else x.get('downloadLink') or x.get('tiktokLink') for x in it.get('slideshowImageLinks') or []]
    s.images = [x for x in s.images if x]
    if video and not s.images:
        try: s.video = download(video, '.mp4')
        except Exception as e: s.warnings.append('Could not download the video (%s); using text only' % e)
    return s


# ---------------------------------------------------------------- web pages
class PageText(html.parser.HTMLParser):
    SKIP = {'script', 'style', 'noscript', 'svg', 'template', 'iframe', 'head'}
    BLOCK = {'p', 'div', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'table', 'blockquote', 'dd', 'dt'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.depth, self.title, self.meta, self.ld, self._ld, self._t = [], 0, '', {}, [], None, False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'script' and (a.get('type') or '').lower() == 'application/ld+json': self._ld = []
        if tag == 'title': self._t = True
        if tag == 'meta' and a.get('content') and (a.get('property') or a.get('name') or '').lower() in (
                'og:title', 'og:description', 'description', 'og:site_name', 'place:location:latitude', 'place:location:longitude'):
            self.meta[(a.get('property') or a.get('name')).lower()] = a['content']
        if tag in self.SKIP: self.depth += 1
        if tag in self.BLOCK: self.out.append('\n')
        if tag == 'img' and a.get('alt') and not self.depth: self.out.append(' [image: %s] ' % a['alt'])

    def handle_endtag(self, tag):
        if tag == 'script' and self._ld is not None: self.ld.append(''.join(self._ld)); self._ld = None
        if tag == 'title': self._t = False
        if tag in self.SKIP and self.depth: self.depth -= 1
        if tag in self.BLOCK: self.out.append('\n')

    def handle_data(self, d):
        if self._ld is not None: self._ld.append(d)
        if self._t: self.title += d
        if not self.depth: self.out.append(d)

    def text(self):
        t = re.sub(r'[ \t\r\f\v]+', ' ', ''.join(self.out))
        return re.sub(r'\n\s*\n+', '\n\n', t).strip()


def decode(data, headers):
    cs = headers.get_content_charset()
    if not cs:
        m = re.search(rb'<meta[^>]+charset=["\']?([\w-]+)', data[:4000], re.I)
        cs = m.group(1).decode() if m else 'utf-8'
    cs = 'gb18030' if cs.lower() in ('gb2312', 'gbk') else cs
    try: return data.decode(cs, 'replace')
    except LookupError: return data.decode('utf-8', 'replace')


def from_web(url, render=False):
    s = Source(url, 'web')
    text = ''
    if not render:
        try:
            data, headers = get(url, limit=20_000_000)
            p = PageText()
            p.feed(decode(data, headers))
            s.title = (p.meta.get('og:title') or p.title).strip()
            s.add('Page title', s.title)
            s.add('Page description', p.meta.get('og:description') or p.meta.get('description'))
            if 'place:location:latitude' in p.meta:
                s.add('Page geo tags', '%s, %s' % (p.meta['place:location:latitude'], p.meta.get('place:location:longitude')))
            for ld in p.ld[:10]:
                s.add('Structured data on the page (JSON-LD)', ld[:20000])
            text = p.text()
        except Exception as e:
            s.warnings.append('Direct fetch failed (%s)' % e)
    if len(text) < 600 and os.environ.get('APIFY_TOKEN'):      # probably drawn by JavaScript: let a real browser load it
        try:
            it = apify('APIFY_WEB_ACTOR', 'apify/website-content-crawler', 'APIFY_WEB_INPUT',
                       {'startUrls': [{'url': url}], 'maxCrawlPages': 1, 'maxCrawlDepth': 0, 'crawlerType': 'playwright:firefox'})
            text = it.get('text') or it.get('markdown') or text
            s.title = s.title or (it.get('metadata') or {}).get('title', '')
            s.warnings.append('Page needed a browser to load; fetched through Apify')
        except Exception as e:
            s.warnings.append('Browser fetch through Apify failed (%s)' % e)
    if len(text) > MAX_PAGE_CHARS:
        s.warnings.append('Page is very long: only the first %d characters were read' % MAX_PAGE_CHARS)
        text = text[:MAX_PAGE_CHARS]
    if len(text) < 200: s.warnings.append('Very little text on this page; results may be thin')
    s.add('Page text', text)
    return s


def fetch(url, render=False):
    k = kind_of(url)
    return from_instagram(url) if k == 'instagram' else from_tiktok(url) if k == 'tiktok' else from_web(url, render)
