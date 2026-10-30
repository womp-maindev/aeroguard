# mini static server for windows, so nobody has to install python
# start.bat runs this. serves this folder on localhost:8080 (or next free port) + opens the browser
# works on powershell 5.1 (comes with windows) and 7. close the window to stop
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$port = 8080
while ($true) {
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://localhost:$port/")
  try { $listener.Start(); break } catch { $listener.Close(); $port++; if ($port -gt 8099) { throw "No free port between 8080 and 8099" } }
}
$url = "http://localhost:$port/"
Write-Host ""
Write-Host "  AeroGuard dashboard -> $url" -ForegroundColor Yellow
Write-Host "  Keep this window open while you look. Close it to stop."
Write-Host ""
if ($env:AEROGUARD_NO_BROWSER -ne '1') { Start-Process $url }
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.md' = 'text/plain; charset=utf-8'; '.svg' = 'image/svg+xml'
  '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.woff2' = 'font/woff2'
}
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '' -or $rel.EndsWith('/')) { $rel = $rel + 'index.html' }
    $path = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $rel))
    if ($path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -and [System.IO.File]::Exists($path)) {
      $bytes = [System.IO.File]::ReadAllBytes($path)
      $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
      if ($types.ContainsKey($ext)) { $res.ContentType = $types[$ext] } else { $res.ContentType = 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-cache')
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
    }
  } catch {
    $res.StatusCode = 500
  } finally {
    $res.Close()
  }
}
