#!/bin/bash
# Double-click me (or run ./tools/dev.command): live preview on this Mac AND in the iPhone simulator.
#   - starts a local copy of the app that reloads itself whenever a file changes
#   - boots the iPhone simulator, opens Device Hub, and loads the app in the simulator's Safari
#   - opens the same page in your normal browser
# Press Ctrl-C in this window to stop the preview server.

cd "$(dirname "$0")/.." || exit 1
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
PORT=8790
URL="http://localhost:$PORT/"

# pick the iPhone 18 Pro if it exists, otherwise the first available iPhone
UDID=$(xcrun simctl list devices available | grep -m1 "iPhone 18 Pro (" | grep -Eo '[A-F0-9]{8}(-[A-F0-9]{4}){3}-[A-F0-9]{12}')
[ -z "$UDID" ] && UDID=$(xcrun simctl list devices available | grep -m1 "iPhone" | grep -Eo '[A-F0-9]{8}(-[A-F0-9]{4}){3}-[A-F0-9]{12}')

python3 tools/dev.py --port "$PORT" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; exit 0' INT TERM EXIT
sleep 1

if [ -n "$UDID" ]; then
  xcrun simctl boot "$UDID" 2>/dev/null
  open "/Applications/Xcode.app/Contents/Applications/DeviceHub.app"
  xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1
  xcrun simctl openurl "$UDID" "$URL"
else
  echo "No iPhone simulator found. Install one in Xcode > Settings > Components."
fi
open "$URL"
echo "Preview running. Edit any file and both screens reload."
wait $SERVER
