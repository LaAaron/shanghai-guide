#!/bin/bash
# Double-click me to enter the Claude key, Apify token and AMap key again (e.g. after making new ones), then start the extractor.
cd "$(dirname "$0")" || exit 1
touch .env
grep -vE '^(ANTHROPIC_API_KEY|APIFY_TOKEN|AMAP_KEY)=' .env > .env.tmp; mv .env.tmp .env; chmod 600 .env
echo "The old keys are removed from extractor/.env. Paste the new ones below."
exec ./run.command
