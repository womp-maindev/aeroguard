#!/bin/sh
# Renders the API3-track video clips from real data into video/:
#   keeper.json (the keeper's published log, branch keeper-data), keeper/fixtures/IB1314-status-proof.json,
#   forge-test.txt (real `forge test`), rehearse.txt (real `npm run rehearse` on anvil),
#   and the live dashboard (dash.cjs, needs the Base Sepolia RPC: LIVE=1, as in .github/workflows/video.yml).
# Without LIVE=1 the two dashboard clips are taken from $DASH_DIR (05-policies.mp4, 07-lab.mp4) if present.
# Needs ffmpeg and Playwright's Chromium. Run from anywhere: sh video/src/render.sh
set -e
cd "$(dirname "$0")"
OUT=..
[ -f keeper.json ] || git show origin/keeper-data:keeper.json > keeper.json
node build-data.cjs keeper.json
cap() { node capture.cjs "$2" "$OUT/$1-$2.mp4"; }
cap 01 title; cap 02 flow; cap 03 buy; cap 04 keeper
if [ "$LIVE" = 1 ]; then
  (cd ../../web && python3 -m http.server 8099 >/dev/null 2>&1 & echo $! > /tmp/aeroguard-web.pid); sleep 1
  node dash.cjs policies "$OUT/05-dashboard.mp4"
  node dash.cjs lab "$OUT/07-tamper-lab.mp4"
  kill "$(cat /tmp/aeroguard-web.pid)" 2>/dev/null || true
elif [ -n "$DASH_DIR" ]; then
  cp "$DASH_DIR/05-dashboard.mp4" "$DASH_DIR/07-tamper-lab.mp4" "$OUT/"
fi
cap 06 ledger; cap 08 tamper; cap 09 tests; cap 10 rehearsal; cap 11 outro
cd "$OUT"
ls [0-9][0-9]-*.mp4 | sed "s/^/file '/; s/$/'/" > list.txt
ffmpeg -loglevel error -y -f concat -safe 0 -i list.txt -c:v libx264 -crf 18 -pix_fmt yuv420p -r 30 -movflags +faststart aeroguard-api3-full.mp4
rm list.txt
echo "rendered into video/: $(ffprobe -v error -show_entries format=duration -of csv=p=0 aeroguard-api3-full.mp4) s"
