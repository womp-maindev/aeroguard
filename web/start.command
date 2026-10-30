#!/bin/bash
# AeroGuard dashboard: double-click (macOS) or run ./start.command (Linux). Serves this folder and opens the browser.
# Needs python3 or node, nothing else. Stop with Ctrl+C or by closing the window.
cd "$(dirname "$0")" || exit 1
PORT=8080
while (echo >/dev/tcp/127.0.0.1/$PORT) 2>/dev/null; do PORT=$((PORT + 1)); done
URL="http://localhost:$PORT"
echo "AeroGuard dashboard → $URL   (Ctrl+C to stop)"
( sleep 1; open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null ) &
if command -v python3 >/dev/null; then exec python3 -m http.server "$PORT" --bind 127.0.0.1
elif command -v node >/dev/null; then exec npx --yes http-server -p "$PORT" -a 127.0.0.1 -c-1 .
else echo "Install python3 (macOS: xcode-select --install) or Node.js, then run this again."; read -r; fi
