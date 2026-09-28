"""Checks that the keys in .env actually work, and describes what was pasted without revealing it."""
import json, os, urllib.error, urllib.request

import sources

KEYS = {'anthropic': ('ANTHROPIC_API_KEY', 'sk-ant-', 'Claude key'), 'apify': ('APIFY_TOKEN', 'apify_api_', 'Apify token'),
        'amap': ('AMAP_KEY', '', 'AMap key')}


def shape(value, prefix):
    """e.g. 'sk-ant-api03-0B…AAA, 108 characters' plus any obvious paste mistake."""
    desc = '%s…%s, %d characters' % (value[:len(prefix) + 10], value[-3:], len(value))
    if not value.startswith(prefix): desc += ' — should start with %s' % prefix
    elif prefix and value.count(prefix) > 1: desc += ' — looks pasted more than once'
    elif not prefix and len(value) != 32: desc += ' — AMap keys are 32 characters'
    return desc


def check_anthropic(key):
    import anthropic
    try:
        anthropic.Anthropic(api_key=key, max_retries=0, timeout=20).models.list(limit=1)
        return True, 'works'
    except anthropic.AuthenticationError:
        return False, 'rejected by Claude'
    except anthropic.PermissionDeniedError:
        return False, 'not allowed (check billing/credit in the Claude Console)'
    except Exception as e:
        return None, 'could not check (%s)' % e.__class__.__name__


def check_apify(token):
    try:
        data, _ = sources.get(sources.APIFY + '/users/me?token=' + urllib.request.quote(token))
        return True, 'works (account %s)' % json.loads(data).get('data', {}).get('username', '?')
    except urllib.error.HTTPError as e:
        return (False, 'rejected by Apify') if e.code in (401, 403) else (None, 'could not check (HTTP %d)' % e.code)
    except Exception as e:
        return None, 'could not check (%s)' % e


def check_amap(key):
    import amap
    try:
        os.environ['AMAP_KEY'] = key
        amap.search('人民广场', '310000')
        return True, 'works'
    except amap.AmapError as e:
        msg = str(e)
        hint = {'INVALID_USER_KEY': 'rejected by AMap', 'USERKEY_PLAT_NOMATCH': 'wrong kind of key: make a "Web服务" (Web Service) key',
                'DAILY_QUERY_OVER_LIMIT': 'works, but today\'s free lookups are used up'}.get(msg)
        return (True if msg == 'DAILY_QUERY_OVER_LIMIT' else False), hint or 'AMap said %s' % msg
    except Exception as e:
        return None, 'could not check (%s)' % e


def check_all():
    out = {}
    for k, (env, prefix, label) in KEYS.items():
        v = os.environ.get(env, '')
        if not v:
            out[k] = {'label': label, 'ok': None if k == 'amap' else False, 'detail': 'not set (optional)' if k == 'amap' else 'missing'}
            continue
        ok, detail = {'anthropic': check_anthropic, 'apify': check_apify, 'amap': check_amap}[k](v)
        out[k] = {'label': label, 'ok': ok, 'detail': detail if ok else '%s (%s)' % (detail, shape(v, prefix))}
    return out


if __name__ == '__main__':
    import extract  # noqa: F401  (loads .env)
    for r in check_all().values(): print('%s: %s' % (r['label'], r['detail']))
