@echo off
rem AeroGuard dashboard: double-click. Serves this folder on http://localhost:8080 and opens the browser.
cd /d "%~dp0"
echo AeroGuard dashboard -^> http://localhost:8080   (close this window to stop)
start "" http://localhost:8080
where py >nul 2>nul && (py -m http.server 8080 --bind 127.0.0.1 & goto :eof)
where python >nul 2>nul && (python -m http.server 8080 --bind 127.0.0.1 & goto :eof)
where node >nul 2>nul && (npx --yes http-server -p 8080 -a 127.0.0.1 -c-1 . & goto :eof)
echo Install Python from https://www.python.org/downloads/ and run this again.
pause
