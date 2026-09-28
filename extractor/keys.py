"""Checks that the keys in .env actually work, and describes what was pasted without revealing it."""
import json, os, urllib.error, urllib.request

import sources

KEYS = {'anthropic': ('ANTHROPIC_API_KEY', 'sk-ant-', 'Claude key'), 'apify': ('APIFY_TOKEN', 'apify_api_', 'Apify token')}


def shape(value, prefix):
    """e.g. 'sk-ant-api03-0B…AAA, 108 characters' plus any obvious paste mistake."""
    desc = '%s…%s, %d characters' % (value[:len(prefix) + 10], value[-3:], len(value))
    if not value.startswith(prefix): desc += ' — should start with %s' % prefix
    elif value.count(prefix) > 1: desc += ' — looks pasted more than once'
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


def check_all():
    out = {}
    for k, (env, prefix, label) in KEYS.items():
        v = os.environ.get(env, '')
        if not v:
            out[k] = {'label': label, 'ok': False, 'detail': 'missing'}
            continue
        ok, detail = (check_anthropic if k == 'anthropic' else check_apify)(v)
        out[k] = {'label': label, 'ok': ok, 'detail': detail if ok else '%s (%s)' % (detail, shape(v, prefix))}
    return out


if __name__ == '__main__':
    import extract  # noqa: F401  (loads .env)
    for r in check_all().values(): print('%s: %s' % (r['label'], r['detail']))
