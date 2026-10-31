#!/bin/sh
# Re-renders every clip from real data: web/data/cardano-run.json (the paid preprod run) and aiken-check.json
# (`aiken check` output, JSON). Needs ffmpeg and Playwright's Chromium. Run from anywhere: sh cardano/video/src/render.sh
set -e
cd "$(dirname "$0")"
OUT=..
node -e "
const fs = require('fs');
fs.writeFileSync('data.js', 'window.RUN=' + fs.readFileSync('../../../web/data/cardano-run.json', 'utf8').trim() +
  ';\nwindow.AIKEN=' + JSON.stringify(JSON.parse(fs.readFileSync('aiken-check.json', 'utf8'))) + ';\n');"
i=1
for c in title arch qualify response tx; do node capture.cjs $c "$OUT/$(printf %02d $i)-$c.mp4"; i=$((i+1)); done
(cd ../../../web && python3 -m http.server 8099 >/dev/null 2>&1 & echo $! > /tmp/aeroguard-web.pid)
sleep 1
node site.cjs "$OUT/01b-site.mp4"
node dash.cjs "$OUT/06-dashboard.mp4"
kill "$(cat /tmp/aeroguard-web.pid)" 2>/dev/null || true
i=7
for c in aiken chains policy outro; do node capture.cjs $c "$OUT/$(printf %02d $i)-$c.mp4"; i=$((i+1)); done
sh assemble.sh
echo "rendered into cardano/video/ (the voiced cut in the repo is web/media/cardano.mp4)"
