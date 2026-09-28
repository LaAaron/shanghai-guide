#!/bin/bash
# Double-click me (or run ./extractor/run.command): sets up the extractor once, then opens its test page.
#   - first run: creates extractor/.venv and installs the Python packages (about 60 MB, from PyPI)
#   - asks for any missing key and saves it in extractor/.env (never committed)
# Press Ctrl-C in this window to stop.

cd "$(dirname "$0")" || exit 1
PORT=8791

if [ ! -x .venv/bin/python ]; then
  echo "First run: installing the extractor's Python packages (anthropic, opencv-python-headless; about 60 MB from PyPI)…"
  python3 -m venv .venv && .venv/bin/pip install -q --upgrade pip && .venv/bin/pip install -q -r requirements.txt || exit 1
fi

touch .env
ask() {  # ask KEY "description" : prompt for a key if .env does not have it yet
  if ! grep -qE "^$1=.+" .env; then
    echo; echo "$2"; read -r -s -p "Paste $1 (hidden) and press Return, or just Return to skip: " v; echo
    if [ -n "$v" ]; then grep -v "^$1=" .env > .env.tmp; echo "$1=$v" >> .env.tmp; mv .env.tmp .env; chmod 600 .env; fi
  fi
}
ask ANTHROPIC_API_KEY "Claude API key (starts with sk-ant-). See extractor/README.md, step 1."
ask APIFY_TOKEN "Apify API token (starts with apify_api_). Needed for Instagram/TikTok. See extractor/README.md, step 2."

.venv/bin/python server.py --port "$PORT" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; exit 0' INT TERM EXIT
URL="http://127.0.0.1:$PORT/"
echo "Starting the extractor (the first start can take up to a minute)…"
for i in $(seq 1 120); do                 # wait until the server answers, or stop if it crashed
  curl -s -o /dev/null "${URL}api/status" && break
  if ! kill -0 $SERVER 2>/dev/null; then echo; echo "The extractor stopped before it could start. The error is shown above."; exit 1; fi
  sleep 0.5
done
if curl -s -o /dev/null "${URL}api/status"; then
  echo "Ready: $URL"; open "$URL"
else
  echo "The extractor has not answered after 60 seconds. Anything above this line is from it."
fi
wait $SERVER
