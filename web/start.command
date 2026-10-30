#!/bin/bash
# mac/linux: double-click or `bash start.command`. serves this folder on localhost:8080
# (or next free port) and opens the browser. ctrl+c or close the window to stop
cd "$(dirname "$0")" || exit 1
PORT=8080
while (echo >/dev/tcp/127.0.0.1/$PORT) 2>/dev/null; do PORT=$((PORT + 1)); done
URL="http://localhost:$PORT"
open_url() { open "$1" 2>/dev/null || xdg-open "$1" 2>/dev/null; }

serve() {
  echo ""
  echo "  AeroGuard dashboard -> $URL"
  echo "  Keep this window open while you look. Close it (or Ctrl+C) to stop."
  echo ""
  ( sleep 1; open_url "$URL" ) &
  "$@"
}

# python3 comes with the mac dev tools. if they're missing this just fails, no popup hang
if command -v python3 >/dev/null && python3 -c 'import http.server' 2>/dev/null; then
  serve python3 -m http.server "$PORT" --bind 127.0.0.1
elif command -v node >/dev/null; then
  serve npx --yes http-server -p "$PORT" -a 127.0.0.1 -c-1 .
elif command -v ruby >/dev/null && ruby -run -e 'exit' 2>/dev/null; then
  serve ruby -run -e httpd . -p "$PORT" -b 127.0.0.1
else
  # last resort: open the file directly. works, only the fonts are missing
  echo "No python3/node found: opening index.html directly (fonts fall back to system fonts)."
  open_url "$PWD/index.html"
  sleep 3
fi
