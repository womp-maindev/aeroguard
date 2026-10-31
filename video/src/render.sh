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
(cd ../../web && python3 -m http.server 8099 >/dev/null 2>&1 & echo $! > /tmp/aeroguard-web.pid); sleep 1
cap 01 title; node hero.cjs "$OUT/02-hero.mp4"; cap 03 flow; cap 04 buy; cap 05 keeper
if [ "$LIVE" = 1 ]; then
  node dash.cjs policies "$OUT/06-dashboard.mp4"
  node dash.cjs lab "$OUT/08-tamper-lab.mp4"
elif [ -n "$DASH_DIR" ]; then
  cp "$DASH_DIR/06-dashboard.mp4" "$DASH_DIR/08-tamper-lab.mp4" "$OUT/"
fi
kill "$(cat /tmp/aeroguard-web.pid)" 2>/dev/null || true
cap 07 ledger; cap 09 tamper; cap 10 tests; cap 11 rehearsal; cap 12 outro
sh assemble.sh
