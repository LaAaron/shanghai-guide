#!/bin/bash
# Double-click me (or run ./extractor/run.command): sets up the extractor once, then opens its test page.
#   - first run: creates extractor/.venv and installs the Python packages (about 60 MB, from PyPI)
#   - asks for any missing key and saves it in extractor/.env (never committed); change-keys.command asks again
# Press Ctrl-C in this window to stop.

cd "$(dirname "$0")" || exit 1
PORT=8791

if [ ! -x .venv/bin/python ]; then
  echo "First run: installing the extractor's Python packages (anthropic, opencv-python-headless; about 60 MB from PyPI)…"
  python3 -m venv .venv && .venv/bin/pip install -q --upgrade pip && .venv/bin/pip install -q -r requirements.txt || exit 1
fi

touch .env; chmod 600 .env
ask() {  # ask KEY PREFIX "description" [optional] : prompt for a key if .env does not have it yet
  grep -qE "^$1=.+" .env && return
  [ -n "$4" ] && grep -q "^$1=" .env && return        # an optional key skipped once is not asked for again
  echo; echo "$3"
  while true; do
    read -r -s -p "Paste $1 (it stays hidden), then press Return. Just Return skips it: " v; echo
    v=$(printf '%s' "$v" | tr -d '[:space:]')
    if [ -z "$v" ]; then [ -n "$4" ] && echo "$1=" >> .env; return; fi
    if [ -z "$2" ]; then
      if [ ${#v} -eq 32 ]; then break; else echo "  That is ${#v} characters; AMap keys are 32. Try again."; fi
      continue
    fi
    n=$(printf '%s' "$v" | grep -o "$2" | wc -l | tr -d ' ')
    if [ "${v#$2}" = "$v" ]; then echo "  That does not start with $2. Try again."
    elif [ "$n" -gt 1 ]; then echo "  That looks pasted $n times over. Paste it once, then press Return."
    else break; fi
  done
  grep -v "^$1=" .env > .env.tmp; echo "$1=$v" >> .env.tmp; mv .env.tmp .env; chmod 600 .env
  echo "  Saved: ${v:0:$((${#2}+10))}…${v: -3}, ${#v} characters."
}
ask ANTHROPIC_API_KEY sk-ant- "Claude API key (starts with sk-ant-). See extractor/README.md, step 1."
ask APIFY_TOKEN apify_api_ "Apify API token (starts with apify_api_). Needed for Instagram/TikTok. See extractor/README.md, step 2."
ask AMAP_KEY "" "AMap Web Service key (32 letters/digits). Optional: finds real pins. See extractor/README.md, step 3." optional

OLD=$(lsof -ti tcp:$PORT -sTCP:LISTEN 2>/dev/null)   # an extractor still running from an earlier window
[ -n "$OLD" ] && kill $OLD 2>/dev/null && sleep 1

.venv/bin/python server.py --port "$PORT" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; exit 0' INT TERM EXIT
URL="http://127.0.0.1:$PORT/"
echo "Starting the extractor (the first start can take up to a minute)…"
for i in $(seq 1 120); do                 # wait until the server answers, or stop if it crashed
  curl -s -o /dev/null "$URL" && break
  if ! kill -0 $SERVER 2>/dev/null; then echo; echo "The extractor stopped before it could start. The error is shown above."; exit 1; fi
  sleep 0.5
done
if curl -s -o /dev/null "$URL"; then
  echo "Ready: $URL"; open "$URL"
else
  echo "The extractor has not answered after 60 seconds. Anything above this line is from it."
fi
wait $SERVER
